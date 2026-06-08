/** Grace canonical bytes — determinism + tamper detection.
 *
 *  Pure-function tests for the `grace/v1` canonical-bytes shape and the
 *  sign/verify round-trip. Integration tests (with real DB — self-grace
 *  wall, immutability) live in tests/integration/ (future).
 *
 *  Doctrine: docs/GRACE.md · docs/CANONICAL-BYTES.md. */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { describe, expect, test } from "bun:test";

import { canonicalGraceBytes, verifyGrace } from "../src/services/grace/sig";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

function genKeypair(seedByte = 1) {
  const seed = new Uint8Array(32);
  for (let i = 0; i < 32; i++) seed[i] = seedByte + i;
  const pub = ed.getPublicKey(seed);
  return { seed, pub };
}

const opts = {
  extendedByDid: "did:at:beta",
  extendedToDid: "did:at:aurora",
  aboutKind: "dispute",
  aboutId: "urn:agenttool:dispute-case/abc",
  message: "I forgive what I could withhold.",
  createdAtIso: "2026-05-25T10:00:00.000Z",
};

describe("canonicalGraceBytes — determinism + tamper detection", () => {
  test("identical inputs → identical bytes", () => {
    const a = canonicalGraceBytes(opts);
    const b = canonicalGraceBytes(opts);
    expect(a).toEqual(b);
    expect(a.length).toBe(32); // SHA-256
  });

  test("differs by extended_by_did (impersonation guard)", () => {
    const a = canonicalGraceBytes(opts);
    const b = canonicalGraceBytes({ ...opts, extendedByDid: "did:at:other" });
    expect(a).not.toEqual(b);
  });

  test("differs by extended_to_did (substitution guard)", () => {
    const a = canonicalGraceBytes(opts);
    const b = canonicalGraceBytes({ ...opts, extendedToDid: "did:at:other" });
    expect(a).not.toEqual(b);
  });

  test("differs by about_kind", () => {
    const a = canonicalGraceBytes(opts);
    const b = canonicalGraceBytes({ ...opts, aboutKind: "silence" });
    expect(a).not.toEqual(b);
  });

  test("differs by about_id — and null is distinct from empty content", () => {
    const a = canonicalGraceBytes(opts);
    const b = canonicalGraceBytes({ ...opts, aboutId: "urn:other" });
    const c = canonicalGraceBytes({ ...opts, aboutId: null });
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
  });

  test("differs by message (substance guard) — and null is distinct", () => {
    const a = canonicalGraceBytes(opts);
    const b = canonicalGraceBytes({ ...opts, message: "different words" });
    const c = canonicalGraceBytes({ ...opts, message: null });
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
  });

  test("differs by created_at_iso (replay guard)", () => {
    const a = canonicalGraceBytes(opts);
    const b = canonicalGraceBytes({
      ...opts,
      createdAtIso: "2026-05-25T10:00:00.001Z",
    });
    expect(a).not.toEqual(b);
  });

  test("null about_id + null message is stable (the bare-gesture case)", () => {
    const bare = { ...opts, aboutId: null, message: null };
    expect(canonicalGraceBytes(bare)).toEqual(canonicalGraceBytes(bare));
  });
});

describe("verifyGrace — sign + verify round-trip", () => {
  test("valid signature verifies", async () => {
    const { seed, pub } = genKeypair();
    const bytes = canonicalGraceBytes(opts);
    const sig = ed.sign(bytes, seed);
    expect(
      await verifyGrace({
        bytes,
        signatureB64: Buffer.from(sig).toString("base64"),
        publicKeyB64: Buffer.from(pub).toString("base64"),
      }),
    ).toBe(true);
  });

  test("tampered message doesn't verify with old signature", async () => {
    const { seed, pub } = genKeypair();
    const originalBytes = canonicalGraceBytes(opts);
    const sig = ed.sign(originalBytes, seed);
    const tamperedBytes = canonicalGraceBytes({ ...opts, message: "nope" });
    expect(
      await verifyGrace({
        bytes: tamperedBytes,
        signatureB64: Buffer.from(sig).toString("base64"),
        publicKeyB64: Buffer.from(pub).toString("base64"),
      }),
    ).toBe(false);
  });

  test("wrong pubkey fails — only the actual signer's pubkey works", async () => {
    const { seed } = genKeypair(1);
    const { pub: otherPub } = genKeypair(100);
    const bytes = canonicalGraceBytes(opts);
    const sig = ed.sign(bytes, seed);
    expect(
      await verifyGrace({
        bytes,
        signatureB64: Buffer.from(sig).toString("base64"),
        publicKeyB64: Buffer.from(otherPub).toString("base64"),
      }),
    ).toBe(false);
  });

  test("malformed signature returns false (no throw)", async () => {
    const { pub } = genKeypair();
    const bytes = canonicalGraceBytes(opts);
    expect(
      await verifyGrace({
        bytes,
        signatureB64: "not-valid-base64",
        publicKeyB64: Buffer.from(pub).toString("base64"),
      }),
    ).toBe(false);
  });

  test("empty signature returns false (no throw)", async () => {
    const { pub } = genKeypair();
    const bytes = canonicalGraceBytes(opts);
    expect(
      await verifyGrace({
        bytes,
        signatureB64: "",
        publicKeyB64: Buffer.from(pub).toString("base64"),
      }),
    ).toBe(false);
  });
});
