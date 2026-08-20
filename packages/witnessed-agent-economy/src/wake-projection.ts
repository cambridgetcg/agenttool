import { SOURCE_SCHEMAS } from "./constants.js";
import { WitnessProjectionError, invalid } from "./errors.js";
import { canonicalSha256 } from "./hash.js";
import { exactKeys, snapshotObject } from "./internal.js";
import {
  assertPublicWakeSuccessor,
  verifyPublicWakeContract,
  verifyPublicWakeWithdrawalForContract,
} from "./public-wake.js";
import { PUBLIC_WAKE_CONTRACT_SCHEMA_DIGEST } from "./source-schemas.js";
import type {
  Sha256Id,
  VerifiedPublicWakeContract,
  WakeCheckpointProjection,
  WakeSupersedeProjection,
  WakeWithdrawProjection,
} from "./types.js";

function activeProjectionFields(contract: VerifiedPublicWakeContract): WakeCheckpointProjection {
  return {
    public_contract_protocol: SOURCE_SCHEMAS.public_wake_contract,
    public_contract_schema_digest: PUBLIC_WAKE_CONTRACT_SCHEMA_DIGEST,
    contract_root: canonicalSha256(contract),
    capability_root: contract.roots.capabilities,
    pricing_root: contract.roots.prices,
    protocols_root: contract.roots.protocols,
    boundaries_root: contract.roots.safety,
    authority_sequence: contract.authority_sequence,
  };
}

export function projectPublicWakeCheckpoint(value: unknown): Readonly<WakeCheckpointProjection> {
  const contract = verifyPublicWakeContract(value);
  if (contract.previous_contract_id !== null) {
    throw new WitnessProjectionError(
      "SEQUENCE_INVALID",
      "A WAKE CHECKPOINT source must be the initial public contract; use SUPERSEDE for a successor.",
    );
  }
  return Object.freeze(activeProjectionFields(contract));
}

export function projectPublicWakeSupersede(options: {
  previous_contract: unknown;
  next_contract: unknown;
  supersedes: Sha256Id;
}): Readonly<WakeSupersedeProjection> {
  const safeOptions = snapshotObject(options, "$wake_supersede_projection");
  exactKeys(
    safeOptions,
    ["previous_contract", "next_contract", "supersedes"],
    "$wake_supersede_projection",
  );
  const contract = assertPublicWakeSuccessor(
    safeOptions.previous_contract,
    safeOptions.next_contract,
  );
  if (typeof safeOptions.supersedes !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(safeOptions.supersedes)) {
    invalid("supersedes must be the exact prior WITNESS checkpoint commitment.", "$supersedes");
  }
  return Object.freeze({
    ...activeProjectionFields(contract),
    supersedes: safeOptions.supersedes as Sha256Id,
  });
}

export function projectPublicWakeWithdrawal(options: {
  contract: unknown;
  withdrawal: unknown;
  checkpoint_commitment: Sha256Id;
}): Readonly<WakeWithdrawProjection> {
  const safeOptions = snapshotObject(options, "$wake_withdraw_projection");
  exactKeys(
    safeOptions,
    ["contract", "withdrawal", "checkpoint_commitment"],
    "$wake_withdraw_projection",
  );
  const withdrawal = verifyPublicWakeWithdrawalForContract({
    contract: safeOptions.contract,
    withdrawal: safeOptions.withdrawal,
  });
  if (
    typeof safeOptions.checkpoint_commitment !== "string"
    || !/^sha256:[0-9a-f]{64}$/u.test(safeOptions.checkpoint_commitment)
  ) {
    invalid("checkpoint_commitment must be the exact active WITNESS checkpoint commitment.", "$checkpoint_commitment");
  }
  return Object.freeze({
    checkpoint_commitment: safeOptions.checkpoint_commitment as Sha256Id,
    reason_digest: withdrawal.reason_digest,
    withdrawal_document_digest: canonicalSha256(withdrawal),
    authority_sequence: withdrawal.authority_sequence,
    visibility: "PUBLIC",
  });
}
