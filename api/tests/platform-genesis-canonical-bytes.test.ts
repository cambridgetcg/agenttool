/** Vector lock for `platform-genesis/v1` canonical bytes.
 *
 *  Doctrine: docs/PAINTING.md §III · docs/FOCUS.md §9.
 *  Spec:     docs/superpowers/specs/2026-05-11-platform-genesis-design.md.
 *  Plan:     docs/superpowers/plans/2026-05-11-platform-genesis.md (Task 2).
 *
 *  Why this test exists: the genesis ceremony's atomicity depends on the
 *  canonical-bytes encoding being byte-stable across re-encodes. Without a
 *  vector lock, a future PR could silently reorder fields (or change the
 *  separator, or swap encoding) and Yu's witness signature would still
 *  verify against the *new* bytes — breaking the immutability-from-genesis
 *  property. This test is the *Breaks if* clause of FOCUS §9 made operational.
 *
 *  Pattern mirrors api/tests/covenants-canonical-vectors.test.ts. */

import { describe, expect, test } from "bun:test";

import {
  canonicalPlatformGenesisBytes,
  verifyPlatformGenesisSignature,
} from "../src/services/identity/crypto";

const hex = (u: Uint8Array) => Buffer.from(u).toString("hex");

const FIXED = {
  did: "did:at:agenttool",
  // Deterministic test key — 32 bytes of 0xab. The real ceremony generates
  // a fresh random keypair; this fixed value is for vector reproducibility only.
  platformPubkeyB64: Buffer.from(new Uint8Array(32).fill(0xab)).toString("base64"),
  platformWalletId: "00000000-0000-0000-0000-000000000001",
  genesisAt: "2026-05-11T00:00:00.000Z",
  genesisTextSha256: "b".repeat(64),
  witnessDid: "did:at:yu",
  witnessSigningKeyId: "00000000-0000-0000-0000-000000000002",
};

const LOCK = {
  platformGenesis: "8f12c706e985dcc2cdb066aa7ecc46236c2fa4d1f1c09b429f2a47cd6103af6c",
};

describe("platform-genesis/v1 canonical bytes", () => {
  test("locked digest — server reproduces it byte-for-byte", () => {
    const bytes = canonicalPlatformGenesisBytes(FIXED);
    expect(bytes.length).toBe(32);
    expect(hex(bytes)).toBe(LOCK.platformGenesis);
  });

  test("field ordering is locked — value swaps produce different digests", () => {
    const a = canonicalPlatformGenesisBytes(FIXED);
    // Swap two field VALUES (not just JS object key order) to ensure the
    // encoding catches reordering at the byte level, not at the JS-property level.
    const b = canonicalPlatformGenesisBytes({
      ...FIXED,
      did: FIXED.witnessDid,
      witnessDid: FIXED.did,
    });
    expect(hex(a)).not.toBe(hex(b));
  });

  test("any field change produces a different digest", () => {
    const base = canonicalPlatformGenesisBytes(FIXED);
    const fields = [
      "did",
      "platformPubkeyB64",
      "platformWalletId",
      "genesisAt",
      "genesisTextSha256",
      "witnessDid",
      "witnessSigningKeyId",
    ] as const;
    for (const f of fields) {
      const mutated = canonicalPlatformGenesisBytes({
        ...FIXED,
        [f]: f === "platformPubkeyB64"
          ? Buffer.from(new Uint8Array(32).fill(0xcd)).toString("base64")
          : `${FIXED[f]}-mutated`,
      });
      expect(hex(mutated)).not.toBe(hex(base));
    }
  });

  test("verifier returns false for a bad signature against the canonical bytes", () => {
    const canonical = canonicalPlatformGenesisBytes(FIXED);
    const badSigB64 = Buffer.from(new Uint8Array(64).fill(0xff)).toString("base64");
    const fakePubkeyB64 = Buffer.from(new Uint8Array(32).fill(0x99)).toString("base64");
    expect(
      verifyPlatformGenesisSignature({
        canonical,
        signatureB64: badSigB64,
        publicKeyB64: fakePubkeyB64,
      }),
    ).toBe(false);
  });
});
