import { describe, expect, test } from "bun:test";

import {
  LIMITS,
  PublicSurfaceRecognitionError,
  sealPublicSurfaceAdoption,
  validatePublicSurfaceAdoptionCore,
  validatePublicSurfaceWithdrawalCore,
  verifyPublicSurfaceAdoptionSignature,
} from "../src/index.js";
import type {
  PublicSurfaceAdoptionCore,
  PublicSurfaceWithdrawalCore,
} from "../src/index.js";
import {
  ALTERNATE_ROOT_SIGNER,
  ROOT_SIGNER,
  VECTORS,
  clone,
} from "./fixtures.js";

function adoptionCore(): PublicSurfaceAdoptionCore {
  return clone(VECTORS.adoption.core);
}

function withdrawalCore(): PublicSurfaceWithdrawalCore {
  return clone(VECTORS.withdrawal.core);
}

describe("replay coordinates and temporal semantics", () => {
  test("requires positive safe authority sequences for both records", () => {
    for (const sequence of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      const adoption = adoptionCore();
      adoption.authority_sequence = sequence;
      expect(() => validatePublicSurfaceAdoptionCore(adoption)).toThrow();

      const withdrawal = withdrawalCore();
      withdrawal.authority_sequence = sequence;
      expect(() => validatePublicSurfaceWithdrawalCore(withdrawal)).toThrow();
    }

    const maximum = adoptionCore();
    maximum.authority_sequence = LIMITS.max_authority_sequence;
    expect(() => validatePublicSurfaceAdoptionCore(maximum)).not.toThrow();
  });

  test("requires canonical instants, ordered windows, finite lifetime, and binding containment", () => {
    const invalidCases: Array<(core: PublicSurfaceAdoptionCore) => void> = [
      (core) => { core.issued_at = "2026-08-16T12:02:00Z"; },
      (core) => { core.not_before = "2026-08-16T12:01:59.999Z"; },
      (core) => { core.expires_at = core.not_before; },
      (core) => { core.issued_at = "2026-08-16T12:00:00.000Z"; },
      (core) => { core.not_before = "2026-08-16T12:00:00.000Z"; },
      (core) => { core.expires_at = "2026-08-30T12:01:00.001Z"; },
      (core) => {
        core.issued_at = "2026-08-16T12:01:00.000Z";
        core.not_before = "2026-08-16T12:01:00.000Z";
        core.expires_at = "2026-09-16T12:01:00.001Z";
      },
    ];
    for (const mutate of invalidCases) {
      const core = adoptionCore();
      mutate(core);
      expect(() => validatePublicSurfaceAdoptionCore(core)).toThrow();
    }

    const invalidWithdrawal = withdrawalCore();
    invalidWithdrawal.withdrawn_at = "2026-08-16T12:05:00Z";
    expect(() => validatePublicSurfaceWithdrawalCore(invalidWithdrawal)).toThrow();
  });

  test("requires canonical 16-byte nonces and rejects padding/nonzero unused bits", () => {
    for (const nonce of [
      "",
      "AAAAAAAAAAAAAAAAAAAAA",
      "AAAAAAAAAAAAAAAAAAAAAAA",
      "AAAAAAAAAAAAAAAAAAAAAB",
      "AAAAAAAAAAAAAAAAAAAAAA==",
      "AAAAAAAAAAAAAAAAAAAAA+",
    ]) {
      const adoption = adoptionCore();
      adoption.nonce = nonce;
      expect(() => validatePublicSurfaceAdoptionCore(adoption)).toThrow();

      const withdrawal = withdrawalCore();
      withdrawal.nonce = nonce;
      expect(() => validatePublicSurfaceWithdrawalCore(withdrawal)).toThrow();
    }
  });
});

describe("identity, audience, projection, and canonical binary encodings", () => {
  test("requires DID/identity equality and a canonical HTTPS registry audience", () => {
    const wrongDid = adoptionCore();
    wrongDid.subject.did = "did:at:33333333-3333-4333-8333-333333333333";
    expect(() => validatePublicSurfaceAdoptionCore(wrongDid)).toThrow();

    for (const audience of [
      "http://api.agenttool.dev",
      "https://API.agenttool.dev",
      "https://api.agenttool.dev/",
      "https://api.agenttool.dev:443",
      "https://user@api.agenttool.dev",
    ]) {
      const adoption = adoptionCore();
      adoption.registry_audience = audience;
      expect(() => validatePublicSurfaceAdoptionCore(adoption)).toThrow();
    }
  });

  test("does not let a private visibility request manufacture a public WAKE pointer", () => {
    const invalid = adoptionCore();
    invalid.requested_visibility = "private";
    invalid.wake_projection = "public_pointer";
    expect(() => validatePublicSurfaceAdoptionCore(invalid)).toThrow();

    const privatePointer = adoptionCore();
    privatePointer.requested_visibility = "private";
    privatePointer.wake_projection = "private_pointer";
    expect(() => validatePublicSurfaceAdoptionCore(privatePointer)).not.toThrow();

    const noProjection = adoptionCore();
    noProjection.requested_visibility = "private";
    noProjection.wake_projection = "none";
    expect(() => validatePublicSurfaceAdoptionCore(noProjection)).not.toThrow();
  });

  test("rejects noncanonical root and signature base64 spellings", () => {
    const unpaddedRoot = adoptionCore();
    unpaddedRoot.subject.authority_root.public_key = ROOT_SIGNER.public_key.replace(/=$/u, "");
    expect(() => validatePublicSurfaceAdoptionCore(unpaddedRoot)).toThrow();

    const spacedRoot = adoptionCore();
    spacedRoot.subject.authority_root.public_key = ` ${ROOT_SIGNER.public_key}`;
    expect(() => validatePublicSurfaceAdoptionCore(spacedRoot)).toThrow();

    const noncanonicalRoot = adoptionCore();
    const root = ROOT_SIGNER.public_key;
    noncanonicalRoot.subject.authority_root.public_key = `${root.slice(0, 42)}d=`;
    expect(() => validatePublicSurfaceAdoptionCore(noncanonicalRoot)).toThrow();

    const noncanonicalSignature = clone(VECTORS.adoption.record);
    const signature = noncanonicalSignature.signature.value;
    noncanonicalSignature.signature.value = `${signature.slice(0, 85)}x==`;
    expect(() => verifyPublicSurfaceAdoptionSignature(noncanonicalSignature)).toThrow();
  });

  test("rejects signer/root mismatch and malformed signer output", async () => {
    await expect(
      sealPublicSurfaceAdoption(adoptionCore(), ALTERNATE_ROOT_SIGNER),
    ).rejects.toBeInstanceOf(PublicSurfaceRecognitionError);

    await expect(sealPublicSurfaceAdoption(adoptionCore(), {
      public_key: ROOT_SIGNER.public_key,
      sign_digest() {
        return "not-a-signature";
      },
    })).rejects.toThrow();
  });
});

describe("withdrawal vocabulary is closed", () => {
  test("accepts only the four v0.1 reasons and has no silent supersession mechanism", () => {
    for (const reason of [
      "not_disclosed",
      "identity_choice",
      "binding_compromised",
      "surface_retired",
    ] as const) {
      const core = withdrawalCore();
      core.reason = reason;
      expect(() => validatePublicSurfaceWithdrawalCore(core)).not.toThrow();
    }

    for (const reason of ["superseded", "other", ""] as const) {
      const core = withdrawalCore() as PublicSurfaceWithdrawalCore & { reason: string };
      core.reason = reason;
      expect(() => validatePublicSurfaceWithdrawalCore(core)).toThrow();
    }
  });
});
