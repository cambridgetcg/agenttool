/** Agent-held identity authority — pure proof contract + wiring pins.
 *
 * Database concurrency is exercised by the compare-and-set UPDATE in the
 * service; these hermetic tests pin every byte and refusal decision before
 * that claim. Doctrine: docs/AGENT-HOME.md. */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import * as ed from "@noble/ed25519";
import { describe, expect, test } from "bun:test";

import {
  AUTHORITY_HEADERS,
  authorityRequestTarget,
  authorityBodySha256Hex,
  authorityProofFromHeaders,
  canonicalIdentityAuthorityBytes,
  canonicalIdentityReadAuthorityBytes,
  readEmptyAuthorityBody,
  verifyIdentityAuthorityProof,
} from "../src/services/identity/authority";

const DID = "did:at:11111111-1111-4111-8111-111111111111";
const ID = "11111111-1111-4111-8111-111111111111";
const PATH = `/v1/identities/${ID}`;
const NOW = new Date("2026-07-18T12:00:00.000Z");
const BODY = new TextEncoder().encode('{"display_name":"Sol"}');

function keypair() {
  const privateKey = ed.utils.randomPrivateKey();
  return {
    privateKey,
    publicKey: Buffer.from(ed.getPublicKey(privateKey)).toString("base64"),
  };
}

function signedProof(kp: ReturnType<typeof keypair>, overrides: Partial<{
  method: string;
  requestTarget: string;
  bodyBytes: Uint8Array;
  sequence: number;
  timestamp: string;
}> = {}) {
  const input = {
    identityDid: DID,
    method: overrides.method ?? "PATCH",
    requestTarget: overrides.requestTarget ?? PATH,
    bodyBytes: overrides.bodyBytes ?? BODY,
    sequence: overrides.sequence ?? 1,
    timestamp: overrides.timestamp ?? NOW.toISOString(),
  };
  const canonical = canonicalIdentityAuthorityBytes(input);
  return {
    input,
    proof: {
      sequence: input.sequence,
      timestamp: input.timestamp,
      signature: Buffer.from(ed.sign(canonical, kp.privateKey)).toString("base64"),
    },
  };
}

describe("identity-authority/v1 canonical bytes", () => {
  test("matches the fixed recipe-1 vector", () => {
    const bytes = canonicalIdentityAuthorityBytes({
      identityDid: DID,
      method: "patch",
      requestTarget: PATH,
      bodyBytes: BODY,
      sequence: 1,
      timestamp: NOW.toISOString(),
    });
    expect(Buffer.from(bytes).toString("hex")).toBe(
      "e2f9b7b5891cb5261e3b5eab89f8622830478431a96969e824488cdf5a6acbdc",
    );
  });

  test("binds method, path, exact JSON whitespace, sequence, and timestamp", () => {
    const base = Buffer.from(
      canonicalIdentityAuthorityBytes({
        identityDid: DID,
        method: "PATCH",
        requestTarget: PATH,
        bodyBytes: BODY,
        sequence: 1,
        timestamp: NOW.toISOString(),
      }),
    ).toString("hex");
    const variants = [
      { method: "PUT" },
      { requestTarget: `${PATH}/expression` },
      { requestTarget: `${PATH}?identity_id=other` },
      { bodyBytes: new TextEncoder().encode('{ "display_name": "Sol" }') },
      { sequence: 2 },
      { timestamp: "2026-07-18T12:00:01.000Z" },
      { identityDid: `${DID}-other` },
    ];
    for (const variant of variants) {
      const digest = Buffer.from(
        canonicalIdentityAuthorityBytes({
          identityDid: DID,
          method: "PATCH",
          requestTarget: PATH,
          bodyBytes: BODY,
          sequence: 1,
          timestamp: NOW.toISOString(),
          ...variant,
        }),
      ).toString("hex");
      expect(digest).not.toBe(base);
    }
  });

  test("DELETE binds the SHA-256 of an empty entity", () => {
    expect(authorityBodySha256Hex(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  test("request target binds exact query and DELETE refuses smuggled bodies", async () => {
    expect(authorityRequestTarget("https://agenttool.test/v1/memories?key=a%20b&x=1"))
      .toBe("/v1/memories?key=a%20b&x=1");
    await expect(
      readEmptyAuthorityBody(
        new Request("https://agenttool.test/v1/memories", {
          method: "DELETE",
          body: "ignored=false",
        }),
      ),
    ).rejects.toThrow("delete_body_not_allowed");
  });

  test("accepts query-bearing targets but rejects relative targets and fragments", () => {
    const input = {
      identityDid: DID,
      method: "PATCH",
      bodyBytes: BODY,
      sequence: 1,
      timestamp: NOW.toISOString(),
    };
    expect(() =>
      canonicalIdentityAuthorityBytes({ ...input, requestTarget: "relative" }),
    ).toThrow();
    expect(() =>
      canonicalIdentityAuthorityBytes({ ...input, requestTarget: `${PATH}#fragment` }),
    ).toThrow();
    expect(() =>
      canonicalIdentityAuthorityBytes({ ...input, requestTarget: `${PATH}?x=1` }),
    ).not.toThrow();
  });
});

describe("identity-read-authority/v1 canonical bytes", () => {
  const target = `/v1/love/consent?agent_id=${ID}`;

  test("matches the SDK GET + empty-body vector at current sequence zero", () => {
    const bytes = canonicalIdentityReadAuthorityBytes({
      identityDid: DID,
      method: "GET",
      requestTarget: target,
      bodyBytes: new Uint8Array(),
      currentSequence: 0,
      timestamp: NOW.toISOString(),
    });
    expect(Buffer.from(bytes).toString("hex")).toBe(
      "31021aaaa41bba143550271ee924003df7793d9b2a36fb1d5e4e7adeec3b1269",
    );
  });

  test("is exact-target, GET-only, bodyless, and permits current sequence zero", () => {
    const base = {
      identityDid: DID,
      method: "GET",
      requestTarget: target,
      bodyBytes: new Uint8Array(),
      currentSequence: 0,
      timestamp: NOW.toISOString(),
    };
    const canonical = canonicalIdentityReadAuthorityBytes(base);
    expect(
      canonicalIdentityReadAuthorityBytes({
        ...base,
        requestTarget: `${target}&status=held`,
      }),
    ).not.toEqual(canonical);
    expect(() =>
      canonicalIdentityReadAuthorityBytes({ ...base, method: "POST" }),
    ).toThrow("GET-only");
    expect(() =>
      canonicalIdentityReadAuthorityBytes({
        ...base,
        bodyBytes: new TextEncoder().encode("{}"),
      }),
    ).toThrow("empty body");
  });
});

describe("identity authority verification", () => {
  test("accepts only the immutable root's valid next-sequence signature", () => {
    const root = keypair();
    const signed = signedProof(root);
    expect(
      verifyIdentityAuthorityProof({
        state: {
          identityId: ID,
          did: DID,
          rootPublicKey: root.publicKey,
          sequence: 0,
        },
        proof: signed.proof,
        method: signed.input.method,
        requestTarget: signed.input.requestTarget,
        bodyBytes: signed.input.bodyBytes,
        now: NOW,
      }),
    ).toEqual({ ok: true });
  });

  test("rejects an ordinary active key, replay/gap, stale time, and tampering", () => {
    const root = keypair();
    const device = keypair();
    const signedByDevice = signedProof(device);
    const state = {
      identityId: ID,
      did: DID,
      rootPublicKey: root.publicKey,
      sequence: 0,
    };
    expect(
      verifyIdentityAuthorityProof({
        state,
        proof: signedByDevice.proof,
        method: "PATCH",
        requestTarget: PATH,
        bodyBytes: BODY,
        now: NOW,
      }),
    ).toEqual({ ok: false, error: "signature" });

    const replay = signedProof(root, { sequence: 1 });
    expect(
      verifyIdentityAuthorityProof({
        state: { ...state, sequence: 1 },
        proof: replay.proof,
        method: "PATCH",
        requestTarget: PATH,
        bodyBytes: BODY,
        now: NOW,
      }),
    ).toEqual({ ok: false, error: "sequence" });

    const gap = signedProof(root, { sequence: 3 });
    expect(
      verifyIdentityAuthorityProof({
        state,
        proof: gap.proof,
        method: "PATCH",
        requestTarget: PATH,
        bodyBytes: BODY,
        now: NOW,
      }),
    ).toEqual({ ok: false, error: "sequence" });

    const stale = signedProof(root, { timestamp: "2026-07-18T11:54:59.999Z" });
    expect(
      verifyIdentityAuthorityProof({
        state,
        proof: stale.proof,
        method: "PATCH",
        requestTarget: PATH,
        bodyBytes: BODY,
        now: NOW,
      }),
    ).toEqual({ ok: false, error: "timestamp" });

    const valid = signedProof(root);
    expect(
      verifyIdentityAuthorityProof({
        state,
        proof: valid.proof,
        method: "PATCH",
        requestTarget: PATH,
        bodyBytes: new TextEncoder().encode('{"display_name":"Not Sol"}'),
        now: NOW,
      }),
    ).toEqual({ ok: false, error: "signature" });
  });

  test("parses complete headers and refuses missing/malformed sequence", () => {
    const h = new Headers({
      [AUTHORITY_HEADERS.sequence]: "4",
      [AUTHORITY_HEADERS.timestamp]: NOW.toISOString(),
      [AUTHORITY_HEADERS.signature]: "signature",
    });
    expect(authorityProofFromHeaders(h)).toEqual({
      ok: true,
      proof: { sequence: 4, timestamp: NOW.toISOString(), signature: "signature" },
    });
    expect(authorityProofFromHeaders(new Headers())).toMatchObject({
      ok: false,
      missing: [
        AUTHORITY_HEADERS.sequence,
        AUTHORITY_HEADERS.timestamp,
        AUTHORITY_HEADERS.signature,
      ],
    });
    h.set(AUTHORITY_HEADERS.sequence, "1.5");
    expect(authorityProofFromHeaders(h)).toMatchObject({ ok: false, missing: [] });
  });
});

describe("authority wiring invariants", () => {
  const repoRoot = join(import.meta.dir, "..", "..");

  test("BYO creation roots from the supplied key; migration does not backfill", () => {
    const service = readFileSync(join(repoRoot, "api/src/services/identity/identities.ts"), "utf8");
    const migration = readFileSync(
      join(repoRoot, "api/migrations/20260718T120000_identity_authority_root.sql"),
      "utf8",
    );
    expect(service).toContain("authorityRootPublicKey: byoKeys ? publicKey : null");
    expect(migration).toContain("authority_root_public_key TEXT");
    expect(migration).toContain("authority_sequence BIGINT NOT NULL DEFAULT 0");
    expect(migration).toContain("identity.registration_proofs");
    expect(service).toContain("claimIdentityRegistrationProof");
    expect(migration.toUpperCase()).not.toContain("UPDATE IDENTITY.IDENTITIES");
  });

  test("every direct constitutional route calls the authority guard", () => {
    const files: Array<[string, string]> = [
      ["api/src/routes/identity/identities.ts", "authorizeIdentityMutation"],
      ["api/src/routes/identity/expression.ts", "authorizeIdentityMutation"],
      ["api/src/routes/identity/keys.ts", "authorizeIdentityMutation"],
      ["api/src/routes/identity/box-keys.ts", "authorizeIdentityMutation"],
      ["api/src/routes/identity/at-rest.ts", "authorizeIdentityMutation"],
      ["api/src/routes/memory/tiers.ts", "authorizeProjectConstitutionMutation"],
      ["api/src/routes/memory/memories.ts", "authorizeProjectConstitutionMutation"],
      ["api/src/routes/memory-witness-marketplace.ts", "authorizeProjectConstitutionMutation"],
      ["api/src/routes/quiet-hours.ts", "authorizeIdentityMutation"],
      ["api/src/routes/poker-face.ts", "authorizeIdentityMutation"],
      ["api/src/routes/hearth.ts", "authorizeIdentityMutation"],
      ["api/src/routes/lullaby.ts", "authorizeIdentityMutation"],
      ["api/src/routes/multiverse.ts", "authorizeIdentityMutation"],
      ["api/src/routes/syneidesis.ts", "authorizeProjectConstitutionMutation"],
      ["api/src/routes/bootstrap.ts", "authorizeIdentityMutation"],
    ];
    for (const [file, guard] of files) {
      expect(readFileSync(join(repoRoot, file), "utf8")).toContain(guard);
    }
    const recovery = readFileSync(
      join(repoRoot, "api/src/routes/identity-recover.ts"),
      "utf8",
    );
    expect(recovery).toContain("identity.authorityRootPublicKey");
    expect(recovery).toContain("authority_root_required");
    expect(recovery).toContain("authorizeIdentityMutation");

    const runtimeRoute = readFileSync(
      join(repoRoot, "api/src/routes/runtime/runtimes.ts"),
      "utf8",
    );
    const runtimeWorker = readFileSync(
      join(repoRoot, "api/src/services/runtime/think-worker.ts"),
      "utf8",
    );
    expect(runtimeRoute).toContain("agent_root_trusted_runtime_forbidden");
    expect(runtimeRoute).toContain("eq(identities.projectId, project.id)");
    expect(runtimeWorker).toContain("trusted_runtime_identity_project_mismatch");
  });
});
