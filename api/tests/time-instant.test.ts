/**
 * time/1 step 3c: strict RFC 3339 instant parsing at API boundaries,
 * tested directly against docs/time/vectors.json, plus raw-byte signature
 * and idempotency-fingerprint parity checks.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import * as ed from "@noble/ed25519";
import { Hono } from "hono";

import { parseSinceParam } from "../src/lib/since-param";
import {
  parseCalendarDateUtcMs,
  parseTimeInstant,
  parseTimeInstantMs,
} from "../src/lib/time-instant";
import { idempotencyRequestFingerprint } from "../src/middleware/idempotency";
import { createCrownRoutes } from "../src/routes/crown";
import publicIdentitiesRouter from "../src/routes/public/identities";
import registerAgentRouter from "../src/routes/register-agent";
import { canonicalCoronationBytes } from "../src/services/crown/canonical-bytes";
import { didKeyFromPublicKey } from "../src/services/crown/did-key";
import { KNOWN_LAWS_VERSIONS } from "../src/services/crown/laws";
import type { CrownStore } from "../src/services/crown/store";
import {
  canonicalIdentityAuthorityBytes,
  canonicalIdentityReadAuthorityBytes,
  verifyIdentityAuthorityProof,
} from "../src/services/identity/authority";
import {
  canonicalDiscoveryBytes,
  canonicalRegisterAgentBytes,
} from "../src/services/identity/crypto";
import { renderPointsMarkdown } from "../src/services/pyramid/wake";

const VECTORS = JSON.parse(
  readFileSync(new URL("../../docs/time/vectors.json", import.meta.url), "utf8"),
) as {
  protocol: string;
  instants: {
    parse: Array<{ input: string; canonical: string | null; reason: string }>;
  };
};

describe("time/1 conformance vectors (docs/time/vectors.json)", () => {
  test("parseTimeInstant and parseTimeInstantMs match every instants.parse vector", () => {
    expect(VECTORS.protocol).toBe("time/1");
    expect(VECTORS.instants.parse.length).toBeGreaterThanOrEqual(35);
    for (const row of VECTORS.instants.parse) {
      expect(parseTimeInstant(row.input)).toBe(row.canonical);
      const ms = parseTimeInstantMs(row.input);
      if (row.canonical === null) {
        expect(ms).toBeNull();
      } else {
        expect(ms).not.toBeNull();
        expect(new Date(ms!).toISOString()).toBe(row.canonical);
      }
    }
  });

  test("parseTimeInstantMs rejects non-strings", () => {
    expect(parseTimeInstantMs(null)).toBeNull();
    expect(parseTimeInstantMs(undefined)).toBeNull();
    expect(parseTimeInstantMs(1795016241123)).toBeNull();
    expect(parseTimeInstantMs({})).toBeNull();
  });
});

describe("parseCalendarDateUtcMs (since-param calendar-date exception)", () => {
  test("accepts valid calendar dates as midnight UTC", () => {
    expect(parseCalendarDateUtcMs("2026-05-01")).toBe(Date.UTC(2026, 4, 1));
    expect(parseCalendarDateUtcMs("2024-02-29")).toBe(Date.UTC(2024, 1, 29));
    const y50 = new Date(0);
    y50.setUTCFullYear(50, 0, 1);
    y50.setUTCHours(0, 0, 0, 0);
    expect(parseCalendarDateUtcMs("0050-01-01")).toBe(y50.getTime());
  });

  test("rejects impossible calendar dates, prose, and date-times", () => {
    for (const bad of [
      "2025-02-29",
      "2026-02-30",
      "2026-04-31",
      "0000-01-01",
      "2026-05-01T12:00:00",
      "2026-05-01T00:00:00Z",
      "May 1 2026",
      "",
    ]) {
      expect(parseCalendarDateUtcMs(bad)).toBeNull();
    }
  });
});

describe("POST /v1/register/agent timestamp boundary & raw-byte parity", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  const baseBody = (timestamp: string) => ({
    display_name: "Sol",
    capabilities: [],
    agent_public_key: key,
    box_public_key: key,
    runtime: { provider: "local", model: "m1" },
    key_proof: {
      timestamp,
      signature: Buffer.alloc(64, 2).toString("base64"),
    },
    pow_nonce: "0",
    registration_nonce: "birth-intent-0000000009",
    registrar: { kind: "self_service" as const },
  });

  test("rejects zone-less, prose, and impossible calendar timestamps with 400", async () => {
    for (const bad of [
      "2026-11-19T12:00:00",
      "May 19 2026 12:00:00 GMT",
      "2026-02-30T12:00:00Z",
    ]) {
      const res = await registerAgentRouter.request("/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(baseBody(bad)),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("validation");
    }
  });

  test("accepts fresh RFC 3339 +00:00 offset past timestamp check and binds exact raw bytes", async () => {
    const offsetNow = new Date().toISOString().replace(/Z$/, "+00:00");
    const res = await registerAgentRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(baseBody(offsetNow)),
    });
    // Passed timestamp validation + freshness and reached PoW check (422) rather than 400/401.
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("pow_required");

    // Canonical signature bytes bind the raw caller timestamp string verbatim (no silent rewrite).
    const rawZ = "2026-11-19T15:37:21.000Z";
    const rawOffset = "2026-11-19T15:37:21.000+00:00";
    const baseCanonical = {
      displayName: "Sol",
      agentPublicKeyB64: key,
      boxPublicKeyB64: key,
      capabilities: [],
      runtimeProvider: "local",
      runtimeModel: "m1",
      runtimeHost: "",
      runtimeContext: "",
      expressionVisibility: "private" as const,
      registrarKind: "self_service" as const,
      parentIdentityId: "",
      registrarBearer: "",
      form: "",
      language: "",
      registrationNonce: "nonce-1234567890123456",
    };
    const bytesZ = canonicalRegisterAgentBytes({ ...baseCanonical, timestamp: rawZ });
    const bytesOffset = canonicalRegisterAgentBytes({ ...baseCanonical, timestamp: rawOffset });
    expect(Buffer.from(bytesZ).equals(Buffer.from(bytesOffset))).toBe(false);
  });
});

describe("POST /public/identities/by-pubkey timestamp boundary & raw-byte parity", () => {
  const seed = Uint8Array.from(Buffer.from("b2".repeat(32), "hex"));
  const pubB64 = Buffer.from(ed.getPublicKey(seed)).toString("base64");

  test("rejects zone-less, prose, and impossible calendar timestamps with 400", async () => {
    for (const bad of [
      "2026-11-19T12:00:00.000",
      "May 19 2026 12:00:00 GMT",
      "2026-02-30T12:00:00Z",
    ]) {
      const res = await publicIdentitiesRouter.request("/by-pubkey", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pubkey: pubB64,
          signature: Buffer.alloc(64, 3).toString("base64"),
          timestamp: bad,
        }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid timestamp (expected ISO-8601)");
    }
  });

  test("accepts fresh RFC 3339 +00:00 past freshness check and binds exact raw string", async () => {
    const offsetNow = new Date().toISOString().replace(/Z$/, "+00:00");
    const res = await publicIdentitiesRouter.request("/by-pubkey", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pubkey: pubB64,
        signature: Buffer.alloc(64, 3).toString("base64"),
        timestamp: offsetNow,
      }),
    });
    // Passed timestamp parse + freshness and reached signature verification (401).
    expect(res.status).toBe(401);

    const a = canonicalDiscoveryBytes({
      derivedPubkeyB64: pubB64,
      timestamp: "2026-11-19T15:37:21.000Z",
    });
    const b = canonicalDiscoveryBytes({
      derivedPubkeyB64: pubB64,
      timestamp: "2026-11-19T15:37:21.000+00:00",
    });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});

describe("identity authority proofs & idempotency fingerprint raw-byte parity", () => {
  const seed = Uint8Array.from(Buffer.from("c3".repeat(32), "hex"));
  const pubB64 = Buffer.from(ed.getPublicKey(seed)).toString("base64");
  const now = new Date("2026-03-02T12:00:00.000Z");

  test("rejects zone-less, prose, and Feb 30 rollover timestamps before signature check", () => {
    for (const bad of [
      "2026-03-02T12:00:00",
      "Mar 2 2026 12:00:00 GMT",
      "2026-02-30T12:00:00Z",
    ]) {
      const result = verifyIdentityAuthorityProof({
        state: {
          identityId: "id-1",
          did: "did:at:test",
          rootPublicKey: pubB64,
          sequence: 0,
        },
        proof: {
          sequence: 1,
          timestamp: bad,
          signature: Buffer.alloc(64, 1).toString("base64"),
        },
        method: "POST",
        requestTarget: "/v1/identities/id-1/keys",
        bodyBytes: new Uint8Array(),
        now,
      });
      expect(result).toEqual({ ok: false, error: "timestamp" });
    }
  });

  test("verifies real Ed25519 signature over exact raw +00:00 string without rewriting", () => {
    const rawOffset = "2026-03-02T12:00:00+00:00";
    const canonical = canonicalIdentityAuthorityBytes({
      identityDid: "did:at:test",
      method: "POST",
      requestTarget: "/v1/identities/id-1/keys",
      bodyBytes: new TextEncoder().encode('{"label":"k"}'),
      sequence: 1,
      timestamp: rawOffset,
    });
    const signature = Buffer.from(ed.sign(canonical, seed)).toString("base64");
    const ok = verifyIdentityAuthorityProof({
      state: {
        identityId: "id-1",
        did: "did:at:test",
        rootPublicKey: pubB64,
        sequence: 0,
      },
      proof: { sequence: 1, timestamp: rawOffset, signature },
      method: "POST",
      requestTarget: "/v1/identities/id-1/keys",
      bodyBytes: new TextEncoder().encode('{"label":"k"}'),
      now,
    });
    expect(ok).toEqual({ ok: true });

    // Read-authority canonical bytes & idempotency fingerprint also preserve raw text verbatim.
    const readZ = canonicalIdentityReadAuthorityBytes({
      identityDid: "did:at:test",
      method: "GET",
      requestTarget: "/v1/memories",
      bodyBytes: new Uint8Array(),
      currentSequence: 1,
      timestamp: "2026-03-02T12:00:00.000Z",
    });
    const readOffset = canonicalIdentityReadAuthorityBytes({
      identityDid: "did:at:test",
      method: "GET",
      requestTarget: "/v1/memories",
      bodyBytes: new Uint8Array(),
      currentSequence: 1,
      timestamp: rawOffset,
    });
    expect(Buffer.from(readZ).equals(Buffer.from(readOffset))).toBe(false);
  });

  test("idempotencyRequestFingerprint binds exact raw authority timestamp header", async () => {
    const mk = (ts: string) =>
      new Request("https://api.agenttool.dev/v1/memories", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-agenttool-authority-sequence": "1",
          "x-agenttool-authority-timestamp": ts,
          "x-agenttool-authority-signature": "sig-fixed",
        },
        body: '{"content":"hello"}',
      });
    const fpZ = await idempotencyRequestFingerprint(mk("2026-03-02T12:00:00.000Z"));
    const fpOffset = await idempotencyRequestFingerprint(mk("2026-03-02T12:00:00+00:00"));
    expect(fpZ).not.toBe(fpOffset);
    expect(fpZ).toBe(await idempotencyRequestFingerprint(mk("2026-03-02T12:00:00.000Z")));
  });
});

describe("crown route rejects Feb 30 rollover and never loosens lowercase t/z", () => {
  const seed = Uint8Array.from(Buffer.from("d4".repeat(32), "hex"));
  const pubB64 = Buffer.from(ed.getPublicKey(seed)).toString("base64");
  const did = didKeyFromPublicKey(pubB64);
  const lawsHash = KNOWN_LAWS_VERSIONS.v1!;

  const emptyStore: CrownStore = {
    async findCurrentByDid() { return null; },
    async findLatestByDid() { return null; },
    async findById() { return null; },
    async listEvents() { return []; },
    async insertCoronation() { throw new Error("should not insert"); },
    async insertEvent() { throw new Error("should not insert"); },
    async listCoronations() { return []; },
    async markAbdicated() {},
    async keeperRemoveBounds() {},
    async isActiveDidAtKey() { return false; },
  };

  test("rejects 2026-02-30T12:00:00Z and lowercase 2026-03-02t12:00:00z with 400", async () => {
    const app = createCrownRoutes({
      store: emptyStore,
      now: () => new Date("2026-03-02T12:00:00.000Z"),
    });
    for (const bad of ["2026-02-30T12:00:00Z", "2026-03-02t12:00:00z"]) {
      const msg = canonicalCoronationBytes({
        did,
        publicKeyB64: pubB64,
        boundsStatement: "My own bounds.",
        lawsHash,
        timestamp: bad,
      });
      const signature = Buffer.from(
        ed.sign(new TextEncoder().encode(msg), seed),
      ).toString("base64");
      const res = await app.request("/coronations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          did,
          public_key: pubB64,
          bounds_statement: "My own bounds.",
          laws_hash: lawsHash,
          timestamp: bad,
          signature,
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("validation");
      expect(body.message).toMatch(/timestamp/i);
    }
  });
});

describe("parseSinceParam rejects naive datetimes, prose, and impossible dates", () => {
  async function runSince(raw: string) {
    const app = new Hono();
    let captured: ReturnType<typeof parseSinceParam> | null = null;
    app.get("/", (c) => {
      captured = parseSinceParam(c);
      return c.text("ok");
    });
    await app.request(`/?since=${encodeURIComponent(raw)}`);
    return captured!;
  }

  test("preserves valid RFC 3339 offsets and bare YYYY-MM-DD calendar date", async () => {
    const withOffset = await runSince("2026-05-01T02:00:00+02:00");
    expect(withOffset.reason).toBe("parsed");
    expect(withOffset.since!.toISOString()).toBe("2026-05-01T00:00:00.000Z");

    const bareDate = await runSince("2026-05-01");
    expect(bareDate.reason).toBe("parsed");
    expect(bareDate.since!.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });

  test("rejects naive datetime, prose, and Feb 30 rollover", async () => {
    for (const bad of [
      "2026-05-01T12:00:00",
      "May 1 2026",
      "2026-02-30",
      "2026-02-30T12:00:00Z",
    ]) {
      const parsed = await runSince(bad);
      expect(parsed.reason).toBe("invalid_format");
      expect(parsed.since).toBeNull();
    }
  });
});

describe("pyramid/wake renderPointsMarkdown UTC Z marker", () => {
  test("includes explicit Z timezone marker on occurredAt line", () => {
    const md = renderPointsMarkdown({
      total: 10,
      by_kind: { test: 10 },
      recent_5: [
        {
          points: 10,
          pointKind: "test",
          occurredAt: new Date("2026-11-19T15:37:21.123Z"),
        },
      ],
      _substrate_honest_note: "private ledger",
    } as Parameters<typeof renderPointsMarkdown>[0]);
    expect(md).toContain("2026-11-19T15:37Z");
  });
});
