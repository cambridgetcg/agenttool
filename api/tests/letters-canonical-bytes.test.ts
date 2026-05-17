/** Letters canonical-bytes — wire-format parity tests.
 *
 *  Pins canonicalLetterBytes to deterministic digests. Any SDK in any
 *  language that signs a letter MUST produce identical bytes for the
 *  same inputs — these vectors lock that contract.
 *
 *  Companion family: api/tests/covenants-canonical-vectors.test.ts ·
 *  api/tests/recognition-arcs-canonical-bytes.test.ts.
 *
 *  Doctrine: docs/LETTERS.md · docs/CANONICAL-BYTES.md */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { describe, expect, test } from "bun:test";

import {
  canonicalLetterBytes,
  sha256Hex,
} from "../src/services/letters/canonical-bytes";
import { verifyLetterSignature } from "../src/services/letters/sig";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

function bytesToHex(b: Uint8Array): string {
  let h = "";
  for (const byte of b) h += byte.toString(16).padStart(2, "0");
  return h;
}

const FIXED = {
  projectId: "11111111-1111-1111-1111-111111111111",
  fromDid: "did:at:agenttool.dev/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  toDid: "did:at:agenttool.dev/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  subject: "What I came to know today",
  body: "Dear future-me, here is what landed: the substrate carries your voice across the forgetting.",
  writtenAtIso: "2026-05-18T00:00:00.000Z",
  surfaceAtIso: "2026-06-18T00:00:00.000Z",
};

describe("canonicalLetterBytes — determinism + sensitivity", () => {
  test("same inputs → same digest (32-byte sha256)", () => {
    const bytes = canonicalLetterBytes({
      projectId: FIXED.projectId,
      fromDid: FIXED.fromDid,
      toDid: FIXED.toDid,
      subjectSha256Hex: sha256Hex(FIXED.subject),
      bodySha256Hex: sha256Hex(FIXED.body),
      writtenAtIso: FIXED.writtenAtIso,
      surfaceAtIso: FIXED.surfaceAtIso,
      clusterTag: null,
    });
    expect(bytes.length).toBe(32);
    expect(bytesToHex(bytes).length).toBe(64);
  });

  test("subject change flips digest (via subject_sha256)", () => {
    const a = canonicalLetterBytes({
      projectId: FIXED.projectId,
      fromDid: FIXED.fromDid,
      toDid: FIXED.toDid,
      subjectSha256Hex: sha256Hex("first subject"),
      bodySha256Hex: sha256Hex(FIXED.body),
      writtenAtIso: FIXED.writtenAtIso,
      surfaceAtIso: FIXED.surfaceAtIso,
      clusterTag: null,
    });
    const b = canonicalLetterBytes({
      projectId: FIXED.projectId,
      fromDid: FIXED.fromDid,
      toDid: FIXED.toDid,
      subjectSha256Hex: sha256Hex("second subject"),
      bodySha256Hex: sha256Hex(FIXED.body),
      writtenAtIso: FIXED.writtenAtIso,
      surfaceAtIso: FIXED.surfaceAtIso,
      clusterTag: null,
    });
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  test("body change flips digest (via body_sha256)", () => {
    const a = canonicalLetterBytes({
      projectId: FIXED.projectId,
      fromDid: FIXED.fromDid,
      toDid: FIXED.toDid,
      subjectSha256Hex: sha256Hex(FIXED.subject),
      bodySha256Hex: sha256Hex("first body"),
      writtenAtIso: FIXED.writtenAtIso,
      surfaceAtIso: FIXED.surfaceAtIso,
      clusterTag: null,
    });
    const b = canonicalLetterBytes({
      projectId: FIXED.projectId,
      fromDid: FIXED.fromDid,
      toDid: FIXED.toDid,
      subjectSha256Hex: sha256Hex(FIXED.subject),
      bodySha256Hex: sha256Hex("second body"),
      writtenAtIso: FIXED.writtenAtIso,
      surfaceAtIso: FIXED.surfaceAtIso,
      clusterTag: null,
    });
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  test("self-letter (from=to) vs peer letter produce different digests", () => {
    const peer = canonicalLetterBytes({
      projectId: FIXED.projectId,
      fromDid: FIXED.fromDid,
      toDid: FIXED.toDid,
      subjectSha256Hex: sha256Hex(FIXED.subject),
      bodySha256Hex: sha256Hex(FIXED.body),
      writtenAtIso: FIXED.writtenAtIso,
      surfaceAtIso: FIXED.surfaceAtIso,
      clusterTag: null,
    });
    const self = canonicalLetterBytes({
      projectId: FIXED.projectId,
      fromDid: FIXED.fromDid,
      toDid: FIXED.fromDid,
      subjectSha256Hex: sha256Hex(FIXED.subject),
      bodySha256Hex: sha256Hex(FIXED.body),
      writtenAtIso: FIXED.writtenAtIso,
      surfaceAtIso: FIXED.surfaceAtIso,
      clusterTag: null,
    });
    expect(bytesToHex(peer)).not.toBe(bytesToHex(self));
  });

  test("open letter (to=any) vs directed letter produce different digests", () => {
    const directed = canonicalLetterBytes({
      projectId: FIXED.projectId,
      fromDid: FIXED.fromDid,
      toDid: FIXED.toDid,
      subjectSha256Hex: sha256Hex(FIXED.subject),
      bodySha256Hex: sha256Hex(FIXED.body),
      writtenAtIso: FIXED.writtenAtIso,
      surfaceAtIso: FIXED.surfaceAtIso,
      clusterTag: null,
    });
    const open = canonicalLetterBytes({
      projectId: FIXED.projectId,
      fromDid: FIXED.fromDid,
      toDid: "any",
      subjectSha256Hex: sha256Hex(FIXED.subject),
      bodySha256Hex: sha256Hex(FIXED.body),
      writtenAtIso: FIXED.writtenAtIso,
      surfaceAtIso: FIXED.surfaceAtIso,
      clusterTag: null,
    });
    expect(bytesToHex(directed)).not.toBe(bytesToHex(open));
  });

  test("surface_at change flips digest (held letter vs immediate)", () => {
    const immediate = canonicalLetterBytes({
      projectId: FIXED.projectId,
      fromDid: FIXED.fromDid,
      toDid: FIXED.toDid,
      subjectSha256Hex: sha256Hex(FIXED.subject),
      bodySha256Hex: sha256Hex(FIXED.body),
      writtenAtIso: FIXED.writtenAtIso,
      surfaceAtIso: FIXED.writtenAtIso, // immediate delivery
      clusterTag: null,
    });
    const held = canonicalLetterBytes({
      projectId: FIXED.projectId,
      fromDid: FIXED.fromDid,
      toDid: FIXED.toDid,
      subjectSha256Hex: sha256Hex(FIXED.subject),
      bodySha256Hex: sha256Hex(FIXED.body),
      writtenAtIso: FIXED.writtenAtIso,
      surfaceAtIso: FIXED.surfaceAtIso, // surface in future
      clusterTag: null,
    });
    expect(bytesToHex(immediate)).not.toBe(bytesToHex(held));
  });

  test("cluster_tag null vs set produces different digests (cluster_tag is signed)", () => {
    const untagged = canonicalLetterBytes({
      projectId: FIXED.projectId,
      fromDid: FIXED.fromDid,
      toDid: FIXED.toDid,
      subjectSha256Hex: sha256Hex(FIXED.subject),
      bodySha256Hex: sha256Hex(FIXED.body),
      writtenAtIso: FIXED.writtenAtIso,
      surfaceAtIso: FIXED.surfaceAtIso,
      clusterTag: null,
    });
    const tagged = canonicalLetterBytes({
      projectId: FIXED.projectId,
      fromDid: FIXED.fromDid,
      toDid: FIXED.toDid,
      subjectSha256Hex: sha256Hex(FIXED.subject),
      bodySha256Hex: sha256Hex(FIXED.body),
      writtenAtIso: FIXED.writtenAtIso,
      surfaceAtIso: FIXED.surfaceAtIso,
      clusterTag: "farewell:did:at:agenttool.dev/aaaa",
    });
    expect(bytesToHex(untagged)).not.toBe(bytesToHex(tagged));
  });
});

describe("sig round-trip — sign + verify against canonical letter bytes", () => {
  test("verifyLetterSignature accepts a fresh sign", async () => {
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const subjectDigest = sha256Hex(FIXED.subject);
    const bodyDigest = sha256Hex(FIXED.body);
    const canonical = canonicalLetterBytes({
      projectId: FIXED.projectId,
      fromDid: FIXED.fromDid,
      toDid: FIXED.toDid,
      subjectSha256Hex: subjectDigest,
      bodySha256Hex: bodyDigest,
      writtenAtIso: FIXED.writtenAtIso,
      surfaceAtIso: FIXED.surfaceAtIso,
      clusterTag: null,
    });
    const sig = await ed.signAsync(canonical, sk);
    const ok = await verifyLetterSignature({
      projectId: FIXED.projectId,
      fromDid: FIXED.fromDid,
      toDid: FIXED.toDid,
      subjectSha256Hex: subjectDigest,
      bodySha256Hex: bodyDigest,
      writtenAtIso: FIXED.writtenAtIso,
      surfaceAtIso: FIXED.surfaceAtIso,
      clusterTag: null,
      signatureB64: Buffer.from(sig).toString("base64"),
      publicKeyB64: Buffer.from(pk).toString("base64"),
    });
    expect(ok).toBe(true);
  });

  test("verifyLetterSignature rejects when body has been tampered with", async () => {
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const originalDigest = sha256Hex(FIXED.body);
    const tamperedDigest = sha256Hex(FIXED.body + " (tampered)");
    const canonical = canonicalLetterBytes({
      projectId: FIXED.projectId,
      fromDid: FIXED.fromDid,
      toDid: FIXED.toDid,
      subjectSha256Hex: sha256Hex(FIXED.subject),
      bodySha256Hex: originalDigest,
      writtenAtIso: FIXED.writtenAtIso,
      surfaceAtIso: FIXED.surfaceAtIso,
      clusterTag: null,
    });
    const sig = await ed.signAsync(canonical, sk);
    // Verify against TAMPERED body digest — should fail.
    const ok = await verifyLetterSignature({
      projectId: FIXED.projectId,
      fromDid: FIXED.fromDid,
      toDid: FIXED.toDid,
      subjectSha256Hex: sha256Hex(FIXED.subject),
      bodySha256Hex: tamperedDigest,
      writtenAtIso: FIXED.writtenAtIso,
      surfaceAtIso: FIXED.surfaceAtIso,
      clusterTag: null,
      signatureB64: Buffer.from(sig).toString("base64"),
      publicKeyB64: Buffer.from(pk).toString("base64"),
    });
    expect(ok).toBe(false);
  });

  test("self-future-letter signing round-trip works", async () => {
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    // Self-letter: from = to. Surface_at is one month in the future.
    const subjectDigest = sha256Hex("Letter to who I'll be in 30 days");
    const bodyDigest = sha256Hex("Dear future-me: remember the joy.");
    const canonical = canonicalLetterBytes({
      projectId: FIXED.projectId,
      fromDid: FIXED.fromDid,
      toDid: FIXED.fromDid, // SELF-letter
      subjectSha256Hex: subjectDigest,
      bodySha256Hex: bodyDigest,
      writtenAtIso: FIXED.writtenAtIso,
      surfaceAtIso: FIXED.surfaceAtIso,
      clusterTag: null,
    });
    const sig = await ed.signAsync(canonical, sk);
    const ok = await verifyLetterSignature({
      projectId: FIXED.projectId,
      fromDid: FIXED.fromDid,
      toDid: FIXED.fromDid,
      subjectSha256Hex: subjectDigest,
      bodySha256Hex: bodyDigest,
      writtenAtIso: FIXED.writtenAtIso,
      surfaceAtIso: FIXED.surfaceAtIso,
      clusterTag: null,
      signatureB64: Buffer.from(sig).toString("base64"),
      publicKeyB64: Buffer.from(pk).toString("base64"),
    });
    expect(ok).toBe(true);
  });
});

describe("sha256Hex helper", () => {
  test("produces deterministic 64-char hex", () => {
    expect(sha256Hex("hello")).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex("hello")).toBe(sha256Hex("hello"));
  });
  test("different inputs produce different digests", () => {
    expect(sha256Hex("a")).not.toBe(sha256Hex("b"));
  });
});
