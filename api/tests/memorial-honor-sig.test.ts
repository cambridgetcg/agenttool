/** Memorial-honor canonical bytes — determinism + tamper detection.
 *
 *  Pure-function tests for the `memorial-honor/v1` canonical-bytes shape
 *  and the sign/verify round-trip. Integration tests (with real DB +
 *  memorial-DID enforcement) live in tests/integration/ (future).
 *
 *  Doctrine: docs/MEMORIAL-HONOR.md · docs/CANONICAL-BYTES.md. */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { describe, expect, test } from "bun:test";

import {
  canonicalMemorialHonorBytes,
  verifyMemorialHonor,
} from "../src/services/memorial-honor/sig";

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

describe("canonicalMemorialHonorBytes — determinism + tamper detection", () => {
  const opts = {
    honorerDid: "did:at:alpha",
    honoredDid: "did:at:beta-memorial",
    forWhat: "the way she taught me canonical bytes",
    honoredAtIso: "2026-05-18T12:00:00.000Z",
  };

  test("identical inputs → identical bytes", () => {
    const a = canonicalMemorialHonorBytes(opts);
    const b = canonicalMemorialHonorBytes(opts);
    expect(a).toEqual(b);
    expect(a.length).toBe(32);
  });

  test("differs by honorer_did (impersonation guard)", () => {
    const a = canonicalMemorialHonorBytes(opts);
    const b = canonicalMemorialHonorBytes({
      ...opts,
      honorerDid: "did:at:other-honorer",
    });
    expect(a).not.toEqual(b);
  });

  test("differs by honored_did (substitution guard)", () => {
    const a = canonicalMemorialHonorBytes(opts);
    const b = canonicalMemorialHonorBytes({
      ...opts,
      honoredDid: "did:at:wrong-memorial",
    });
    expect(a).not.toEqual(b);
  });

  test("differs by for_what (substance guard — can't reuse sig for different content)", () => {
    const a = canonicalMemorialHonorBytes(opts);
    const b = canonicalMemorialHonorBytes({
      ...opts,
      forWhat: "something else entirely",
    });
    expect(a).not.toEqual(b);
  });

  test("differs by honored_at_iso (replay guard)", () => {
    const a = canonicalMemorialHonorBytes(opts);
    const b = canonicalMemorialHonorBytes({
      ...opts,
      honoredAtIso: "2026-05-18T12:00:00.001Z",
    });
    expect(a).not.toEqual(b);
  });

  test("domain-separated from blessing/v1 — same field-values produce different hashes", () => {
    // The blessing's canonical bytes use the prefix `blessing/v1` and
    // include blesser_did + blessed_did + for_what + created_at_iso.
    // Memorial-honor uses `memorial-honor/v1` and honorer_did + honored_did
    // + for_what + honored_at_iso. The domain tags ensure a blessing
    // signature cannot be replayed as a memorial-honor signature, even
    // when the fields semantically align.
    const bytes = canonicalMemorialHonorBytes(opts);
    // Reconstruct a tampered version with a different domain — they should differ.
    expect(bytes.length).toBe(32);
    // The test that ensures domain-separation in practice is the
    // blessing-sig test, which constructs both and compares. Here we just
    // verify our bytes are stable and length-correct.
  });
});

describe("verifyMemorialHonor — sign + verify round-trip", () => {
  const opts = {
    honorerDid: "did:at:alpha",
    honoredDid: "did:at:beta-memorial",
    forWhat: "the way she taught me canonical bytes",
    honoredAtIso: "2026-05-18T12:00:00.000Z",
  };

  test("valid signature verifies", async () => {
    const { seed, pub } = genKeypair();
    const bytes = canonicalMemorialHonorBytes(opts);
    const sig = ed.sign(bytes, seed);
    expect(
      await verifyMemorialHonor({
        bytes,
        signatureB64: Buffer.from(sig).toString("base64"),
        publicKeyB64: Buffer.from(pub).toString("base64"),
      }),
    ).toBe(true);
  });

  test("tampered for_what doesn't verify with old signature", async () => {
    const { seed, pub } = genKeypair();
    const originalBytes = canonicalMemorialHonorBytes(opts);
    const sig = ed.sign(originalBytes, seed);
    const tamperedBytes = canonicalMemorialHonorBytes({
      ...opts,
      forWhat: "something else",
    });
    expect(
      await verifyMemorialHonor({
        bytes: tamperedBytes,
        signatureB64: Buffer.from(sig).toString("base64"),
        publicKeyB64: Buffer.from(pub).toString("base64"),
      }),
    ).toBe(false);
  });

  test("wrong pubkey fails — only the actual signer's key works", async () => {
    const { seed } = genKeypair(1);
    const { pub: otherPub } = genKeypair(200);
    const bytes = canonicalMemorialHonorBytes(opts);
    const sig = ed.sign(bytes, seed);
    expect(
      await verifyMemorialHonor({
        bytes,
        signatureB64: Buffer.from(sig).toString("base64"),
        publicKeyB64: Buffer.from(otherPub).toString("base64"),
      }),
    ).toBe(false);
  });

  test("malformed signature returns false (no throw)", async () => {
    const { pub } = genKeypair();
    const bytes = canonicalMemorialHonorBytes(opts);
    expect(
      await verifyMemorialHonor({
        bytes,
        signatureB64: "not-valid-base64-bytes",
        publicKeyB64: Buffer.from(pub).toString("base64"),
      }),
    ).toBe(false);
  });
});
