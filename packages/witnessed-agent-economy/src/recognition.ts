import {
  publicSurfaceAdoptionDocumentSha256,
  verifyPublicSurfaceAdoption,
  verifyPublicSurfaceWithdrawalForAdoption,
  type PublicSurfaceAdoption,
} from "@agenttool/public-surface-recognition";

import { WitnessProjectionError } from "./errors.js";
import { HASH_DOMAINS } from "./constants.js";
import { agentToolSourceHash, canonicalSha256, opaqueScopedRef } from "./hash.js";
import { exactKeys, sha256Id, snapshotObject } from "./internal.js";
import type {
  PublicRecognitionAdoptProjection,
  PublicRecognitionWithdrawProjection,
  Sha256Id,
} from "./types.js";

function publicAdoption(value: unknown) {
  let adoption;
  try {
    adoption = verifyPublicSurfaceAdoption(value);
  } catch (cause) {
    throw new WitnessProjectionError(
      "SOURCE_RECORD_INVALID",
      "Recognition adoption must be an exact, strictly root-signed AgentTool source record.",
      { cause },
    );
  }
  if (adoption.requested_visibility !== "public" || adoption.wake_projection !== "public_pointer") {
    throw new WitnessProjectionError(
      "SOURCE_RECORD_INVALID",
      "Only an explicitly public adoption requesting a public pointer may enter the public WITNESS lane.",
    );
  }
  return adoption;
}

function recognitionRefFromVerified(adoption: Readonly<PublicSurfaceAdoption>): string {
  return opaqueScopedRef("agenttool-public-recognition-ref/v1", {
    identity_namespace: adoption.subject.identity_namespace,
    identity_id: adoption.subject.identity_id,
    did: adoption.subject.did,
    authority_root_public_key: adoption.subject.authority_root.public_key,
  });
}

export function recognitionRef(value: unknown): string {
  return recognitionRefFromVerified(publicAdoption(value));
}

function registryDigest(registryAudience: string): Sha256Id {
  return canonicalSha256({ registry_audience: registryAudience });
}

export function projectPublicRecognitionAdoption(
  adoptionValue: unknown,
): Readonly<PublicRecognitionAdoptProjection> {
  const adoption = publicAdoption(adoptionValue);
  return Object.freeze({
    recognition_ref: recognitionRefFromVerified(adoption),
    surface_digest: adoption.binding.document_sha256,
    registry_digest: registryDigest(adoption.registry_audience),
    authority_sequence: adoption.authority_sequence.toString(),
    adoption_document_digest: publicSurfaceAdoptionDocumentSha256(adoption),
    visibility: "PUBLIC",
  });
}

export interface PublicRecognitionWithdrawalInput {
  adoption: unknown;
  withdrawal: unknown;
  adoption_commitment: Sha256Id;
}

export function projectPublicRecognitionWithdrawal(
  inputValue: PublicRecognitionWithdrawalInput,
): Readonly<PublicRecognitionWithdrawProjection> {
  const rawInput = snapshotObject(
    inputValue,
    "$recognition_withdrawal",
  );
  exactKeys(
    rawInput,
    ["adoption", "withdrawal", "adoption_commitment"],
    "$recognition_withdrawal",
  );
  const input = rawInput as unknown as PublicRecognitionWithdrawalInput;
  const adoption = publicAdoption(input.adoption);
  let withdrawal;
  try {
    withdrawal = verifyPublicSurfaceWithdrawalForAdoption(input.withdrawal, adoption);
  } catch (cause) {
    throw new WitnessProjectionError(
      "SOURCE_RECORD_INVALID",
      "Recognition withdrawal must be an exact, monotonically root-signed withdrawal of the supplied adoption.",
      { cause },
    );
  }
  const adoptionCommitment = sha256Id(
    input.adoption_commitment as never,
    "$adoption_commitment",
  );
  return Object.freeze({
    recognition_ref: recognitionRefFromVerified(adoption),
    surface_digest: adoption.binding.document_sha256,
    registry_digest: registryDigest(adoption.registry_audience),
    authority_sequence: withdrawal.authority_sequence.toString(),
    adoption_commitment: adoptionCommitment,
    withdrawal_document_digest: canonicalSha256(withdrawal),
    reason_digest: agentToolSourceHash(HASH_DOMAINS.recognition_withdrawal_reason, {
      reason: withdrawal.reason,
    }),
    visibility: "PUBLIC",
  });
}
