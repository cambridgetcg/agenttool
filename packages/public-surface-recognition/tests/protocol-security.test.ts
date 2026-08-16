import * as ed25519 from "@noble/ed25519";
import {
  canonicalRecordSha256,
  domainSeparatedId,
  sealPublicSurfaceBinding,
  strictEd25519Verify,
  verifyPublicSurfaceBinding,
} from "@agenttool/public-surface-binding";
import { describe, expect, test } from "bun:test";

import {
  ADOPTION_BOUNDARIES,
  SIGNING_DOMAINS,
  WITHDRAWAL_BOUNDARIES,
  PublicSurfaceRecognitionError,
  publicSurfaceAdoptionDigest,
  sealPublicSurfaceAdoption,
  sealPublicSurfaceWithdrawal,
  validatePublicSurfaceAdoption,
  validatePublicSurfaceWithdrawal,
  verifyPublicSurfaceAdoption,
  verifyPublicSurfaceAdoptionForBinding,
  verifyPublicSurfaceAdoptionSignature,
  verifyPublicSurfaceWithdrawal,
  verifyPublicSurfaceWithdrawalForAdoption,
  verifyPublicSurfaceWithdrawalSignature,
} from "../src/index.js";
import type {
  PublicSurfaceAdoption,
  PublicSurfaceAdoptionCore,
  PublicSurfaceWithdrawal,
  PublicSurfaceWithdrawalCore,
} from "../src/index.js";
import {
  ALTERNATE_ROOT_SIGNER,
  BINDING_SIGNER,
  ROOT_SIGNER,
  VECTORS,
  clone,
  withNobleSha512,
} from "./fixtures.js";

const SHA_OTHER = `sha256:${"f".repeat(64)}`;

function reIdAdoption(record: PublicSurfaceAdoption): PublicSurfaceAdoption {
  const { adoption_id: _adoptionId, ...idInput } = record;
  record.adoption_id = domainSeparatedId(SIGNING_DOMAINS.adoption_id, idInput);
  return record;
}

function reIdWithdrawal(record: PublicSurfaceWithdrawal): PublicSurfaceWithdrawal {
  const { withdrawal_id: _withdrawalId, ...idInput } = record;
  record.withdrawal_id = domainSeparatedId(SIGNING_DOMAINS.withdrawal_id, idInput);
  return record;
}

function expectRecognitionCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("expected recognition error");
  } catch (error) {
    expect(error).toBeInstanceOf(PublicSurfaceRecognitionError);
    expect((error as PublicSurfaceRecognitionError).code).toBe(code);
  }
}

function laxNobleVerify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  return withNobleSha512(() => ed25519.verify(signature, message, publicKey, { zip215: true }));
}

describe("strict root signatures and domain separation", () => {
  test("rejects the ZIP-215 identity forgery that lax cofactored verification accepts", () => {
    const smallOrderPublicKey = new Uint8Array(32);
    smallOrderPublicKey[0] = 1;
    const smallOrderSignature = new Uint8Array(64);
    smallOrderSignature[0] = 1;

    const forged = clone(VECTORS.adoption.record);
    forged.subject.authority_root.public_key = Buffer.from(smallOrderPublicKey).toString("base64");
    forged.signature.value = Buffer.from(smallOrderSignature).toString("base64");
    reIdAdoption(forged);
    const { signature: _signature, adoption_id: _adoptionId, ...core } = forged;
    const digest = publicSurfaceAdoptionDigest(core);

    expect(laxNobleVerify(smallOrderSignature, digest, smallOrderPublicKey)).toBe(true);
    expect(strictEd25519Verify(smallOrderSignature, digest, smallOrderPublicKey)).toBe(false);
    expect(verifyPublicSurfaceAdoptionSignature(forged)).toBe("invalid");
    expectRecognitionCode(() => verifyPublicSurfaceAdoption(forged), "SIGNATURE_INVALID");
  });

  test("rejects adoption/withdrawal cross-domain signature substitution after re-ID", () => {
    const adoptionWithWithdrawalSignature = clone(VECTORS.adoption.record);
    adoptionWithWithdrawalSignature.signature = clone(VECTORS.withdrawal.record.signature);
    reIdAdoption(adoptionWithWithdrawalSignature);
    expect(() => validatePublicSurfaceAdoption(adoptionWithWithdrawalSignature)).not.toThrow();
    expect(verifyPublicSurfaceAdoptionSignature(adoptionWithWithdrawalSignature)).toBe("invalid");

    const withdrawalWithAdoptionSignature = clone(VECTORS.withdrawal.record);
    withdrawalWithAdoptionSignature.signature = clone(VECTORS.adoption.record.signature);
    reIdWithdrawal(withdrawalWithAdoptionSignature);
    expect(() => validatePublicSurfaceWithdrawal(withdrawalWithAdoptionSignature)).not.toThrow();
    expect(verifyPublicSurfaceWithdrawalSignature(withdrawalWithAdoptionSignature)).toBe("invalid");
  });

  test("binds root, registry audience, visibility, sequence, time, and nonce despite re-ID", () => {
    const cases: Array<(record: PublicSurfaceAdoption) => void> = [
      (record) => { record.registry_audience = "https://other.agenttool.dev"; },
      (record) => {
        record.requested_visibility = "private";
        record.wake_projection = "none";
      },
      (record) => { record.authority_sequence += 1; },
      (record) => {
        record.issued_at = "2026-08-16T12:03:00.000Z";
        record.not_before = "2026-08-16T12:03:00.000Z";
      },
      (record) => { record.nonce = "AAAAAAAAAAAAAAAAAAAAAA"; },
      (record) => { record.subject.authority_root.public_key = ALTERNATE_ROOT_SIGNER.public_key; },
    ];

    for (const mutate of cases) {
      const tampered = clone(VECTORS.adoption.record);
      mutate(tampered);
      reIdAdoption(tampered);
      expect(() => validatePublicSurfaceAdoption(tampered)).not.toThrow();
      expect(verifyPublicSurfaceAdoptionSignature(tampered)).toBe("invalid");
      expectRecognitionCode(() => verifyPublicSurfaceAdoption(tampered), "SIGNATURE_INVALID");
    }
  });
});

describe("exact binding and subject linkage", () => {
  test("rejects a forged binding ID, binding document digest, and binding subject", async () => {
    const forgedBindingId = clone(VECTORS.adoption.core);
    forgedBindingId.binding.document.binding_id = SHA_OTHER;
    await expect(sealPublicSurfaceAdoption(forgedBindingId, ROOT_SIGNER)).rejects.toThrow();

    const forgedDocumentDigest = clone(VECTORS.adoption.core);
    forgedDocumentDigest.binding.document_sha256 = SHA_OTHER;
    await expect(sealPublicSurfaceAdoption(forgedDocumentDigest, ROOT_SIGNER)).rejects.toThrow();

    const source = clone(VECTORS.source_binding.record);
    const { signature: _bindingSignature, binding_id: _bindingId, ...bindingCore } = source;
    bindingCore.subject.identity_id = "33333333-3333-4333-8333-333333333333";
    const otherSubjectBinding = await sealPublicSurfaceBinding(bindingCore, BINDING_SIGNER);
    const mismatchedSubject = clone(VECTORS.adoption.core);
    mismatchedSubject.binding.document = otherSubjectBinding;
    mismatchedSubject.binding.document_sha256 = canonicalRecordSha256(otherSubjectBinding);
    await expect(sealPublicSurfaceAdoption(mismatchedSubject, ROOT_SIGNER)).rejects.toThrow();
  });

  test("refuses another valid binding document even when its subject is the same", async () => {
    const source = clone(VECTORS.source_binding.record);
    const { signature: _bindingSignature, binding_id: _bindingId, ...bindingCore } = source;
    bindingCore.origin = "https://other.agenttool.dev";
    bindingCore.nonce = "AQEBAQEBAQEBAQEBAQEBAQ";
    const alternateBinding = await sealPublicSurfaceBinding(bindingCore, BINDING_SIGNER);
    const verifiedAlternate = verifyPublicSurfaceBinding(alternateBinding);

    expectRecognitionCode(
      () => verifyPublicSurfaceAdoptionForBinding(VECTORS.adoption.record, verifiedAlternate),
      "BINDING_MISMATCH",
    );
  });
});

describe("withdrawal linkage and monotonic coordinates", () => {
  async function sealedWithdrawal(
    mutate: (core: PublicSurfaceWithdrawalCore) => void,
    alternateRoot = false,
  ): Promise<PublicSurfaceWithdrawal> {
    const core = clone(VECTORS.withdrawal.core);
    mutate(core);
    return sealPublicSurfaceWithdrawal(
      core,
      alternateRoot ? ALTERNATE_ROOT_SIGNER : ROOT_SIGNER,
    );
  }

  test("binds adoption ID, adoption document SHA, binding ID, subject, root, and audience", async () => {
    const cases = [
      await sealedWithdrawal((core) => { core.adoption_id = SHA_OTHER; }),
      await sealedWithdrawal((core) => { core.adoption_document_sha256 = SHA_OTHER; }),
      await sealedWithdrawal((core) => { core.binding_id = SHA_OTHER; }),
      await sealedWithdrawal((core) => { core.registry_audience = "https://other.agenttool.dev"; }),
      await sealedWithdrawal((core) => {
        core.subject.identity_id = "33333333-3333-4333-8333-333333333333";
        core.subject.did = "did:at:33333333-3333-4333-8333-333333333333";
      }),
      await sealedWithdrawal((core) => {
        core.subject.authority_root.public_key = ALTERNATE_ROOT_SIGNER.public_key;
      }, true),
    ];

    for (const withdrawal of cases) {
      expectRecognitionCode(
        () => verifyPublicSurfaceWithdrawalForAdoption(withdrawal, VECTORS.adoption.record),
        "ADOPTION_MISMATCH",
      );
    }
  });

  test("requires a later authority sequence and a non-backdated withdrawal", async () => {
    const sameSequence = await sealedWithdrawal((core) => {
      core.authority_sequence = VECTORS.adoption.record.authority_sequence;
    });
    const earlierSequence = await sealedWithdrawal((core) => {
      core.authority_sequence = VECTORS.adoption.record.authority_sequence - 1;
    });
    const backdated = await sealedWithdrawal((core) => {
      core.withdrawn_at = "2026-08-16T12:00:00.000Z";
    });
    for (const withdrawal of [sameSequence, earlierSequence, backdated]) {
      expectRecognitionCode(
        () => verifyPublicSurfaceWithdrawalForAdoption(withdrawal, VECTORS.adoption.record),
        "ADOPTION_MISMATCH",
      );
    }
  });

  test("does not erase history or require the old adoption/binding window to remain current", async () => {
    const lateWithdrawal = await sealedWithdrawal((core) => {
      core.withdrawn_at = "2036-08-16T12:05:00.000Z";
    });
    expect(verifyPublicSurfaceWithdrawalForAdoption(
      lateWithdrawal,
      VECTORS.adoption.record,
    )).toEqual(lateWithdrawal);
    expect(lateWithdrawal.boundaries.external_erasure_effect).toBe(false);
    expect(lateWithdrawal.boundaries.binding_revocation_effect).toBe(false);
  });
});

describe("explicit non-effects", () => {
  test("fixes every training, WAKE, publication, authority, score, and action effect", () => {
    expect(ADOPTION_BOUNDARIES.training_authorized).toBe(false);
    expect(ADOPTION_BOUNDARIES.requires_separate_training_authorization).toBe(true);
    expect(ADOPTION_BOUNDARIES.registry_write_effect).toBe(false);
    expect(ADOPTION_BOUNDARIES.identity_mutation_effect).toBe(false);
    expect(ADOPTION_BOUNDARIES.crawler_effect).toBe(false);
    expect(ADOPTION_BOUNDARIES.observation_counter_effect).toBe(false);
    expect(ADOPTION_BOUNDARIES.training_effect).toBe(false);
    expect(ADOPTION_BOUNDARIES.publication_effect).toBe(false);
    expect(ADOPTION_BOUNDARIES.wake_effect).toBe(false);
    expect(ADOPTION_BOUNDARIES.memory_effect).toBe(false);
    expect(ADOPTION_BOUNDARIES.chronicle_effect).toBe(false);
    expect(ADOPTION_BOUNDARIES.karma_effect).toBe(false);
    expect(ADOPTION_BOUNDARIES.score_effect).toBe(false);
    expect(ADOPTION_BOUNDARIES.automatic_action).toBe(false);
    expect(ADOPTION_BOUNDARIES.authority).toBe("none");
    expect(ADOPTION_BOUNDARIES.delegation).toBe("none");

    expect(WITHDRAWAL_BOUNDARIES.training_unlearning_effect).toBe(false);
    expect(WITHDRAWAL_BOUNDARIES.registry_write_effect).toBe(false);
    expect(WITHDRAWAL_BOUNDARIES.identity_mutation_effect).toBe(false);
    expect(WITHDRAWAL_BOUNDARIES.crawler_effect).toBe(false);
    expect(WITHDRAWAL_BOUNDARIES.observation_counter_effect).toBe(false);
    expect(WITHDRAWAL_BOUNDARIES.training_effect).toBe(false);
    expect(WITHDRAWAL_BOUNDARIES.publication_effect).toBe(false);
    expect(WITHDRAWAL_BOUNDARIES.wake_effect).toBe(false);
    expect(WITHDRAWAL_BOUNDARIES.external_erasure_effect).toBe(false);
    expect(WITHDRAWAL_BOUNDARIES.authority).toBe("none");
    expect(WITHDRAWAL_BOUNDARIES.delegation).toBe("none");
  });

  test("rejects injected effects, project authority, active status, and unknown-as-false claims", () => {
    for (const [field, value] of [
      ["training_authorized", true],
      ["wake_effect", true],
      ["published", true],
      ["project_id", "11111111-1111-4111-8111-111111111111"],
      ["bearer_authorized", true],
      ["registry_verified", true],
      ["current", true],
      ["withdrawal_status", "not_withdrawn"],
    ] as const) {
      const widened = clone(VECTORS.adoption.record) as PublicSurfaceAdoption & Record<string, unknown>;
      widened[field] = value;
      expect(() => validatePublicSurfaceAdoption(widened)).toThrow();
    }

    const training = clone(VECTORS.adoption.record);
    training.boundaries.training_authorized = true;
    expect(() => validatePublicSurfaceAdoption(training)).toThrow();

    const wake = clone(VECTORS.adoption.record);
    wake.boundaries.wake_effect = true;
    expect(() => validatePublicSurfaceAdoption(wake)).toThrow();

    expect("active" in VECTORS.adoption.record).toBe(false);
    expect("withdrawn" in VECTORS.adoption.record).toBe(false);
    expect("registry_verified" in VECTORS.adoption.record).toBe(false);
  });
});
