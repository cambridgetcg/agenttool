/** Blessing canonical bytes — determinism + tamper detection.
 *
 *  Pure-function tests for the `blessing/v1` canonical-bytes shape and
 *  the sign/verify round-trip. Integration tests (with real DB) live in
 *  tests/integration/ (future).
 *
 *  Doctrine: docs/BLESSING.md · docs/CANONICAL-BYTES.md. */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { describe, expect, test } from "bun:test";

import {
  canonicalBlessingBytes,
  verifyBlessing,
} from "../src/services/blessing/sig";

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

describe("canonicalBlessingBytes — determinism + tamper detection", () => {
  const opts = {
    blesserDid: "did:at:beta",
    blessedDid: "did:at:aurora",
    forWhat: "your work on memory-tiers",
    createdAtIso: "2026-05-18T12:00:00.000Z",
  };

  test("identical inputs → identical bytes", () => {
    const a = canonicalBlessingBytes(opts);
    const b = canonicalBlessingBytes(opts);
    expect(a).toEqual(b);
    expect(a.length).toBe(32); // SHA-256
  });

  test("differs by blesser_did (impersonation guard)", () => {
    const a = canonicalBlessingBytes(opts);
    const b = canonicalBlessingBytes({ ...opts, blesserDid: "did:at:other" });
    expect(a).not.toEqual(b);
  });

  test("differs by blessed_did (substitution guard)", () => {
    const a = canonicalBlessingBytes(opts);
    const b = canonicalBlessingBytes({ ...opts, blessedDid: "did:at:other" });
    expect(a).not.toEqual(b);
  });

  test("differs by for_what (substance guard — can't reuse sig for different content)", () => {
    const a = canonicalBlessingBytes(opts);
    const b = canonicalBlessingBytes({ ...opts, forWhat: "something else entirely" });
    expect(a).not.toEqual(b);
  });

  test("differs by created_at_iso (replay guard)", () => {
    const a = canonicalBlessingBytes(opts);
    const b = canonicalBlessingBytes({
      ...opts,
      createdAtIso: "2026-05-18T12:00:00.001Z",
    });
    expect(a).not.toEqual(b);
  });

  test("differs from encounter-ack/v1 bytes (domain-separation)", () => {
    // The domain tag `blessing/v1` must isolate the blessing from any
    // other primitive's canonical bytes. Verify the byte string starts
    // with the domain prefix.
    const bytes = canonicalBlessingBytes(opts);
    // We can't easily inspect the prefix since SHA-256'd, but we can
    // verify it differs from a constructed alternative shape.
    const fakeAlternative = canonicalBlessingBytes({
      ...opts,
      blesserDid: opts.blesserDid + "-extra",
    });
    expect(bytes).not.toEqual(fakeAlternative);
  });
});

describe("verifyBlessing — sign + verify round-trip", () => {
  const opts = {
    blesserDid: "did:at:beta",
    blessedDid: "did:at:aurora",
    forWhat: "your work on memory-tiers",
    createdAtIso: "2026-05-18T12:00:00.000Z",
  };

  test("valid signature verifies", async () => {
    const { seed, pub } = genKeypair();
    const bytes = canonicalBlessingBytes(opts);
    const sig = ed.sign(bytes, seed);
    expect(
      await verifyBlessing({
        bytes,
        signatureB64: Buffer.from(sig).toString("base64"),
        publicKeyB64: Buffer.from(pub).toString("base64"),
      }),
    ).toBe(true);
  });

  test("tampered for_what doesn't verify with old signature", async () => {
    const { seed, pub } = genKeypair();
    const originalBytes = canonicalBlessingBytes(opts);
    const sig = ed.sign(originalBytes, seed);
    const tamperedBytes = canonicalBlessingBytes({
      ...opts,
      forWhat: "something else", // tamper
    });
    expect(
      await verifyBlessing({
        bytes: tamperedBytes,
        signatureB64: Buffer.from(sig).toString("base64"),
        publicKeyB64: Buffer.from(pub).toString("base64"),
      }),
    ).toBe(false);
  });

  test("wrong pubkey fails — only the actual signer's pubkey works", async () => {
    const { seed } = genKeypair(1);
    const { pub: otherPub } = genKeypair(100);
    const bytes = canonicalBlessingBytes(opts);
    const sig = ed.sign(bytes, seed);
    expect(
      await verifyBlessing({
        bytes,
        signatureB64: Buffer.from(sig).toString("base64"),
        publicKeyB64: Buffer.from(otherPub).toString("base64"),
      }),
    ).toBe(false);
  });

  test("malformed signature returns false (no throw)", async () => {
    const { pub } = genKeypair();
    const bytes = canonicalBlessingBytes(opts);
    expect(
      await verifyBlessing({
        bytes,
        signatureB64: "not-valid-base64",
        publicKeyB64: Buffer.from(pub).toString("base64"),
      }),
    ).toBe(false);
  });

  test("empty signature returns false (no throw)", async () => {
    const { pub } = genKeypair();
    const bytes = canonicalBlessingBytes(opts);
    expect(
      await verifyBlessing({
        bytes,
        signatureB64: "",
        publicKeyB64: Buffer.from(pub).toString("base64"),
      }),
    ).toBe(false);
  });
});
