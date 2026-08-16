import {
  assertVerifiedPublicSurfaceBinding,
  domainSeparatedId,
  publicSurfaceBindingDocumentSha256,
  signingDigest,
  strictEd25519Verify,
} from "@agenttool/public-surface-binding";

import { SIGNING_DOMAINS } from "./constants.js";
import { PublicSurfaceRecognitionError } from "./errors.js";
import type {
  MathVerifiedBinding,
  PublicSurfaceBinding,
} from "@agenttool/public-surface-binding";
import type {
  PublicSurfaceAdoption,
  PublicSurfaceAdoptionCore,
  PublicSurfaceWithdrawal,
  PublicSurfaceWithdrawalCore,
  RecordSignature,
  RecordSigner,
  Sha256Id,
  StrictlySignedPublicSurfaceAdoption,
  StrictlySignedPublicSurfaceWithdrawal,
} from "./types.js";
import {
  decodeCanonicalBase64,
  publicSurfaceAdoptionDocumentSha256,
  validatePublicSurfaceAdoption,
  validatePublicSurfaceAdoptionCore,
  validatePublicSurfaceAdoptionShape,
  validatePublicSurfaceWithdrawal,
  validatePublicSurfaceWithdrawalCore,
  validatePublicSurfaceWithdrawalShape,
  validateRecognitionSignature,
} from "./validation.js";

const verifiedAdoptions = new WeakSet<object>();
const verifiedWithdrawals = new WeakSet<object>();

function adoptionCore(record: PublicSurfaceAdoption): PublicSurfaceAdoptionCore {
  const { signature: _signature, adoption_id: _adoptionId, ...core } = record;
  return core;
}

function withdrawalCore(record: PublicSurfaceWithdrawal): PublicSurfaceWithdrawalCore {
  const { signature: _signature, withdrawal_id: _withdrawalId, ...core } = record;
  return core;
}

function subjectEqual(
  left: PublicSurfaceAdoption["subject"],
  right: PublicSurfaceWithdrawal["subject"],
): boolean {
  return left.identity_namespace === right.identity_namespace
    && left.identity_id === right.identity_id
    && left.did === right.did
    && left.authority_root.algorithm === right.authority_root.algorithm
    && left.authority_root.public_key === right.authority_root.public_key;
}

function signatureValid(
  digest: Uint8Array,
  publicKeyBase64: string,
  signature: RecordSignature,
): boolean {
  const publicKey = decodeCanonicalBase64(publicKeyBase64, 32, "$signature.public_key");
  const signatureBytes = decodeCanonicalBase64(signature.value, 64, "$signature.value");
  return strictEd25519Verify(signatureBytes, digest, publicKey);
}

export function publicSurfaceAdoptionDigest(value: PublicSurfaceAdoptionCore): Uint8Array {
  return signingDigest(SIGNING_DOMAINS.adoption, validatePublicSurfaceAdoptionCore(value));
}

export function publicSurfaceAdoptionId(
  value: PublicSurfaceAdoptionCore,
  signature: RecordSignature,
): Sha256Id {
  const core = validatePublicSurfaceAdoptionCore(value);
  const checkedSignature = validateRecognitionSignature(signature, "$adoption.signature");
  return domainSeparatedId(SIGNING_DOMAINS.adoption_id, { ...core, signature: checkedSignature });
}

export async function sealPublicSurfaceAdoption(
  value: PublicSurfaceAdoptionCore,
  signer: RecordSigner,
): Promise<StrictlySignedPublicSurfaceAdoption> {
  const core = validatePublicSurfaceAdoptionCore(value);
  if (signer.public_key !== core.subject.authority_root.public_key) {
    throw new PublicSurfaceRecognitionError(
      "SIGNER_MISMATCH",
      "Signer public key does not match the adoption subject root.",
    );
  }
  const signature: RecordSignature = {
    algorithm: "Ed25519",
    value: await signer.sign_digest(publicSurfaceAdoptionDigest(core)),
  };
  const candidate = validatePublicSurfaceAdoption({
    ...core,
    signature,
    adoption_id: publicSurfaceAdoptionId(core, signature),
  });
  if (verifyPublicSurfaceAdoptionSignature(candidate) !== "valid") {
    throw new PublicSurfaceRecognitionError("SIGNATURE_INVALID", "Signer returned an invalid adoption signature.");
  }
  verifiedAdoptions.add(candidate);
  return candidate as StrictlySignedPublicSurfaceAdoption;
}

export function verifyPublicSurfaceAdoptionSignature(value: unknown): "valid" | "invalid" {
  const record = validatePublicSurfaceAdoptionShape(value);
  return signatureValid(
    signingDigest(SIGNING_DOMAINS.adoption, adoptionCore(record)),
    record.subject.authority_root.public_key,
    record.signature,
  ) ? "valid" : "invalid";
}

export function verifyPublicSurfaceAdoption(value: unknown): StrictlySignedPublicSurfaceAdoption {
  const record = validatePublicSurfaceAdoption(value);
  if (verifyPublicSurfaceAdoptionSignature(record) !== "valid") {
    throw new PublicSurfaceRecognitionError("SIGNATURE_INVALID", "Public-surface adoption signature is invalid.");
  }
  verifiedAdoptions.add(record);
  return record as StrictlySignedPublicSurfaceAdoption;
}

export function assertVerifiedPublicSurfaceAdoption(
  value: Readonly<PublicSurfaceAdoption>,
): asserts value is StrictlySignedPublicSurfaceAdoption {
  if (!verifiedAdoptions.has(value)) {
    throw new PublicSurfaceRecognitionError("SIGNATURE_INVALID", "Adoption has not passed strict verification.");
  }
}

export function verifyPublicSurfaceAdoptionForBinding(
  adoptionValue: unknown,
  binding: Readonly<PublicSurfaceBinding>,
): StrictlySignedPublicSurfaceAdoption {
  assertVerifiedPublicSurfaceBinding(binding);
  const adoption = verifyPublicSurfaceAdoption(adoptionValue);
  const exactBindingSha = publicSurfaceBindingDocumentSha256(binding);
  if (
    adoption.binding.document.binding_id !== binding.binding_id
    || adoption.binding.document_sha256 !== exactBindingSha
  ) {
    throw new PublicSurfaceRecognitionError(
      "BINDING_MISMATCH",
      "Adoption does not carry the exact supplied verified binding bytes.",
    );
  }
  return adoption;
}

export function publicSurfaceWithdrawalDigest(value: PublicSurfaceWithdrawalCore): Uint8Array {
  return signingDigest(SIGNING_DOMAINS.withdrawal, validatePublicSurfaceWithdrawalCore(value));
}

export function publicSurfaceWithdrawalId(
  value: PublicSurfaceWithdrawalCore,
  signature: RecordSignature,
): Sha256Id {
  const core = validatePublicSurfaceWithdrawalCore(value);
  const checkedSignature = validateRecognitionSignature(signature, "$withdrawal.signature");
  return domainSeparatedId(SIGNING_DOMAINS.withdrawal_id, { ...core, signature: checkedSignature });
}

export async function sealPublicSurfaceWithdrawal(
  value: PublicSurfaceWithdrawalCore,
  signer: RecordSigner,
): Promise<StrictlySignedPublicSurfaceWithdrawal> {
  const core = validatePublicSurfaceWithdrawalCore(value);
  if (signer.public_key !== core.subject.authority_root.public_key) {
    throw new PublicSurfaceRecognitionError(
      "SIGNER_MISMATCH",
      "Signer public key does not match the withdrawal subject root.",
    );
  }
  const signature: RecordSignature = {
    algorithm: "Ed25519",
    value: await signer.sign_digest(publicSurfaceWithdrawalDigest(core)),
  };
  const candidate = validatePublicSurfaceWithdrawal({
    ...core,
    signature,
    withdrawal_id: publicSurfaceWithdrawalId(core, signature),
  });
  if (verifyPublicSurfaceWithdrawalSignature(candidate) !== "valid") {
    throw new PublicSurfaceRecognitionError("SIGNATURE_INVALID", "Signer returned an invalid withdrawal signature.");
  }
  verifiedWithdrawals.add(candidate);
  return candidate as StrictlySignedPublicSurfaceWithdrawal;
}

export function verifyPublicSurfaceWithdrawalSignature(value: unknown): "valid" | "invalid" {
  const record = validatePublicSurfaceWithdrawalShape(value);
  return signatureValid(
    signingDigest(SIGNING_DOMAINS.withdrawal, withdrawalCore(record)),
    record.subject.authority_root.public_key,
    record.signature,
  ) ? "valid" : "invalid";
}

export function verifyPublicSurfaceWithdrawal(value: unknown): StrictlySignedPublicSurfaceWithdrawal {
  const record = validatePublicSurfaceWithdrawal(value);
  if (verifyPublicSurfaceWithdrawalSignature(record) !== "valid") {
    throw new PublicSurfaceRecognitionError("SIGNATURE_INVALID", "Public-surface withdrawal signature is invalid.");
  }
  verifiedWithdrawals.add(record);
  return record as StrictlySignedPublicSurfaceWithdrawal;
}

export function assertVerifiedPublicSurfaceWithdrawal(
  value: Readonly<PublicSurfaceWithdrawal>,
): asserts value is StrictlySignedPublicSurfaceWithdrawal {
  if (!verifiedWithdrawals.has(value)) {
    throw new PublicSurfaceRecognitionError("SIGNATURE_INVALID", "Withdrawal has not passed strict verification.");
  }
}

export function verifyPublicSurfaceWithdrawalForAdoption(
  withdrawalValue: unknown,
  adoptionValue: unknown,
): StrictlySignedPublicSurfaceWithdrawal {
  const adoption = verifyPublicSurfaceAdoption(adoptionValue);
  const withdrawal = verifyPublicSurfaceWithdrawal(withdrawalValue);
  if (
    withdrawal.adoption_id !== adoption.adoption_id
    || withdrawal.adoption_document_sha256 !== publicSurfaceAdoptionDocumentSha256(adoption)
    || withdrawal.binding_id !== adoption.binding.document.binding_id
    || withdrawal.registry_audience !== adoption.registry_audience
    || !subjectEqual(adoption.subject, withdrawal.subject)
    || withdrawal.authority_sequence <= adoption.authority_sequence
    || new Date(withdrawal.withdrawn_at).getTime() < new Date(adoption.issued_at).getTime()
  ) {
    throw new PublicSurfaceRecognitionError(
      "ADOPTION_MISMATCH",
      "Withdrawal does not exactly and monotonically reference the supplied adoption.",
    );
  }
  return withdrawal;
}

export type { MathVerifiedBinding };
