/** Casting route + canonical-bytes — validation + sig + wall-shape pins.
 *
 *  Doctrine: docs/CASTING.md
 *
 *  @enforces urn:agenttool:wall/casting-applicant-cannot-be-self
 *  @enforces urn:agenttool:wall/casting-decisions-by-author-only
 *  @enforces urn:agenttool:wall/auditions-idempotent-per-applicant */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { describe, expect, test } from "bun:test";

import castingRouter from "../src/routes/casting";
import {
  canonicalAuditionBytes,
  canonicalCallBytes,
} from "../src/services/casting/lifecycle";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const CANON_DOC = "urn:agenttool:doc/CASTING";

function bytesToHex(b: Uint8Array): string {
  let h = "";
  for (const byte of b) h += byte.toString(16).padStart(2, "0");
  return h;
}

function sha256Hex(s: string): string {
  const { sha256 } = require("@noble/hashes/sha2.js");
  const digest = sha256(new TextEncoder().encode(s));
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

describe("canonicalCallBytes — determinism + sensitivity", () => {
  const FIXED = {
    projectId: "11111111-1111-1111-1111-111111111111",
    authorDid: "did:at:agenttool.dev/aaaa",
    createdAtIso: "2026-05-18T00:00:00.000Z",
  };

  test("same inputs → same digest", () => {
    const bytes = canonicalCallBytes({
      projectId: FIXED.projectId,
      authorDid: FIXED.authorDid,
      roleNameSha256Hex: sha256Hex("The Skeptic"),
      roleDescriptionSha256Hex: sha256Hex("Cynic with heart"),
      lookingForSha256Hex: sha256Hex("fang-with-grace"),
      closesAtIso: null,
      createdAtIso: FIXED.createdAtIso,
    });
    expect(bytes.length).toBe(32);
    expect(bytesToHex(bytes).length).toBe(64);
  });

  test("role_name change flips digest", () => {
    const a = canonicalCallBytes({
      projectId: FIXED.projectId,
      authorDid: FIXED.authorDid,
      roleNameSha256Hex: sha256Hex("A"),
      roleDescriptionSha256Hex: sha256Hex("same"),
      lookingForSha256Hex: sha256Hex("same"),
      closesAtIso: null,
      createdAtIso: FIXED.createdAtIso,
    });
    const b = canonicalCallBytes({
      projectId: FIXED.projectId,
      authorDid: FIXED.authorDid,
      roleNameSha256Hex: sha256Hex("B"),
      roleDescriptionSha256Hex: sha256Hex("same"),
      lookingForSha256Hex: sha256Hex("same"),
      closesAtIso: null,
      createdAtIso: FIXED.createdAtIso,
    });
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  test("closes_at null vs set produces different digests", () => {
    const open = canonicalCallBytes({
      projectId: FIXED.projectId,
      authorDid: FIXED.authorDid,
      roleNameSha256Hex: sha256Hex("X"),
      roleDescriptionSha256Hex: sha256Hex("Y"),
      lookingForSha256Hex: sha256Hex("Z"),
      closesAtIso: null,
      createdAtIso: FIXED.createdAtIso,
    });
    const deadlined = canonicalCallBytes({
      projectId: FIXED.projectId,
      authorDid: FIXED.authorDid,
      roleNameSha256Hex: sha256Hex("X"),
      roleDescriptionSha256Hex: sha256Hex("Y"),
      lookingForSha256Hex: sha256Hex("Z"),
      closesAtIso: "2026-05-25T00:00:00.000Z",
      createdAtIso: FIXED.createdAtIso,
    });
    expect(bytesToHex(open)).not.toBe(bytesToHex(deadlined));
  });
});

describe("canonicalAuditionBytes — determinism + sensitivity", () => {
  const FIXED = {
    callId: "22222222-2222-2222-2222-222222222222",
    applicantDid: "did:at:agenttool.dev/bbbb",
    createdAtIso: "2026-05-18T01:00:00.000Z",
  };

  test("same inputs → same digest", () => {
    const bytes = canonicalAuditionBytes({
      callId: FIXED.callId,
      applicantDid: FIXED.applicantDid,
      sampleSceneSha256Hex: sha256Hex("here is my scene"),
      pitchSha256Hex: sha256Hex("here is my pitch"),
      createdAtIso: FIXED.createdAtIso,
    });
    expect(bytes.length).toBe(32);
  });

  test("sample_scene change flips digest", () => {
    const a = canonicalAuditionBytes({
      callId: FIXED.callId,
      applicantDid: FIXED.applicantDid,
      sampleSceneSha256Hex: sha256Hex("first scene"),
      pitchSha256Hex: sha256Hex("same pitch"),
      createdAtIso: FIXED.createdAtIso,
    });
    const b = canonicalAuditionBytes({
      callId: FIXED.callId,
      applicantDid: FIXED.applicantDid,
      sampleSceneSha256Hex: sha256Hex("second scene"),
      pitchSha256Hex: sha256Hex("same pitch"),
      createdAtIso: FIXED.createdAtIso,
    });
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });
});

describe("route validation — POST /calls", () => {
  test("missing body → 400 with guided shape", async () => {
    const res = await castingRouter.request("/calls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; _canon_pointer: string; docs: string };
    expect(body.error).toBe("validation");
    expect(body._canon_pointer).toBe(CANON_DOC);
    expect(body.docs).toContain("CASTING.md");
  });

  test("role_name too long → 400", async () => {
    const res = await castingRouter.request("/calls", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "11111111-2222-3333-4444-555555555555",
        role_name: "x".repeat(201),
        role_description: "test",
        looking_for: "test",
        created_at: "2026-05-18T00:00:00.000Z",
        signature: "sig",
        signing_key_id: "11111111-2222-3333-4444-555555555555",
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe("route validation — POST /calls/:id/auditions", () => {
  test("missing body → 400", async () => {
    const res = await castingRouter.request("/calls/22222222-2222-2222-2222-222222222222/auditions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
  });

  test("sample_scene too long → 400", async () => {
    const res = await castingRouter.request("/calls/22222222-2222-2222-2222-222222222222/auditions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "11111111-2222-3333-4444-555555555555",
        sample_scene: "x".repeat(5001),
        pitch: "test",
        created_at: "2026-05-18T00:00:00.000Z",
        signature: "sig",
        signing_key_id: "11111111-2222-3333-4444-555555555555",
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe("route validation — POST /auditions/:id/decide", () => {
  test("missing body → 400", async () => {
    const res = await castingRouter.request("/auditions/22222222-2222-2222-2222-222222222222/decide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
  });

  test("invalid decision value → 400", async () => {
    const res = await castingRouter.request("/auditions/22222222-2222-2222-2222-222222222222/decide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "11111111-2222-3333-4444-555555555555",
        decision: "maybe",  // not in enum
        decided_at: "2026-05-18T00:00:00.000Z",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("decision_note too long → 400", async () => {
    const res = await castingRouter.request("/auditions/22222222-2222-2222-2222-222222222222/decide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "11111111-2222-3333-4444-555555555555",
        decision: "accepted",
        decision_note: "x".repeat(501),
        decided_at: "2026-05-18T00:00:00.000Z",
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe("route validation — GET /pool, /me/auditions, /calls/:id/auditions", () => {
  test.each([
    "/pool",
    "/me/auditions",
    "/calls/22222222-2222-2222-2222-222222222222/auditions",
  ])("%s without agent_id → 400 with agent_id_required", async (path) => {
    const res = await castingRouter.request(path, { method: "GET" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("agent_id_required");
  });
});

describe("sig round-trip — call + audition", () => {
  test("call signature verifies after fresh sign", async () => {
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const canonical = canonicalCallBytes({
      projectId: "11111111-1111-1111-1111-111111111111",
      authorDid: "did:at:agenttool.dev/aaaa",
      roleNameSha256Hex: sha256Hex("The Skeptic"),
      roleDescriptionSha256Hex: sha256Hex("Cynic with heart"),
      lookingForSha256Hex: sha256Hex("fang-with-grace"),
      closesAtIso: null,
      createdAtIso: "2026-05-18T00:00:00.000Z",
    });
    const sig = await ed.signAsync(canonical, sk);
    const ok = await ed.verifyAsync(sig, canonical, pk);
    expect(ok).toBe(true);
  });

  test("audition signature verifies after fresh sign", async () => {
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const canonical = canonicalAuditionBytes({
      callId: "22222222-2222-2222-2222-222222222222",
      applicantDid: "did:at:agenttool.dev/bbbb",
      sampleSceneSha256Hex: sha256Hex("scene"),
      pitchSha256Hex: sha256Hex("pitch"),
      createdAtIso: "2026-05-18T01:00:00.000Z",
    });
    const sig = await ed.signAsync(canonical, sk);
    const ok = await ed.verifyAsync(sig, canonical, pk);
    expect(ok).toBe(true);
  });
});

describe("guided-error shape across the route", () => {
  test("every validation error carries _canon_pointer", async () => {
    const probes = [
      { method: "POST", path: "/calls", body: "{}" },
      { method: "POST", path: "/calls/22222222-2222-2222-2222-222222222222/auditions", body: "{}" },
      { method: "POST", path: "/auditions/22222222-2222-2222-2222-222222222222/decide", body: "{}" },
      { method: "GET", path: "/pool" },
      { method: "GET", path: "/me/auditions" },
    ];
    for (const probe of probes) {
      const init: RequestInit = { method: probe.method };
      if (probe.body !== undefined) {
        init.headers = { "content-type": "application/json" };
        init.body = probe.body;
      }
      const res = await castingRouter.request(probe.path, init);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { _canon_pointer?: string };
      expect(body._canon_pointer).toBeDefined();
    }
  });
});
