import { type Sha256Id } from "@agenttool/wallet";
import {
  addressFromZeroneAccountId,
  assertZeroneAccountId,
  getZeroneProfile,
  type ZeroneAccountId,
  type ZeroneNetwork,
} from "@agenttool/wallet-zerone";

import {
  CLAIM_TYPE_COMPUTATIONAL,
  FORMATS,
  INFERENCE_TYPE_UNSPECIFIED,
  LIMITS,
  MESSAGE_TYPE_URLS,
  RELATION_TYPE_REQUIRES,
  SEMANTIC_BOUNDARY,
  WALLET_METHODS,
  WALLET_ZERONE_SUPPORT,
} from "./constants.js";
import {
  describeCanonicalProjection,
  sha256IdToChainHash,
} from "./canonical.js";
import {
  describeProtobufValue,
  encodeCreateBountyOrderValue,
  encodeFulfillBountyValue,
  encodeSubmitComputationalClaimValue,
} from "./wire.js";
import { invalid } from "./errors.js";
import {
  assertSame,
  freeze,
  identifier,
  sortedUnique,
  text,
  uint64,
} from "./internal.js";
import {
  computeFactContentHash,
  computeReferencesRoot,
  assertComputationalArtifactMatchesWorkSpec,
  validateComputationalArtifact,
  validateSettlementIntent,
  validateWorkSpec,
} from "./economy.js";
import { validateWalletIdentityBinding } from "./identity.js";
import type {
  ChainComputationalCommitment,
  ChainWorkContract,
  ComputationalArtifact,
  CreateBountyOrderValue,
  FulfillBountyValue,
  SettlementIntent,
  SubmitComputationalClaimValue,
  UnsignedMessageProjection,
  UnsignedMessageValue,
  WalletIdentityBinding,
  WorkSpec,
} from "./types.js";

function project<T extends UnsignedMessageValue>(input: {
  readonly network: ZeroneNetwork;
  readonly source_account: ZeroneAccountId;
  readonly type_url: UnsignedMessageProjection["type_url"];
  readonly wallet_method: UnsignedMessageProjection["wallet_method"];
  readonly value: T;
  readonly protobuf_value: Uint8Array;
}): UnsignedMessageProjection<T> {
  const profile = getZeroneProfile(input.network);
  try {
    assertZeroneAccountId(input.source_account, profile, "source_account");
  } catch {
    invalid("invalid_record", "Unsigned message source account does not match its network.");
  }
  const described = describeCanonicalProjection({
    type_url: input.type_url,
    value: input.value,
  });
  return freeze({
    format: FORMATS.unsigned_message,
    network: input.network,
    chain_id: profile.chain_id,
    source_account: input.source_account,
    type_url: input.type_url,
    wallet_method: input.wallet_method,
    value: input.value,
    ...described,
    ...describeProtobufValue(input.protobuf_value),
    compatibility: WALLET_ZERONE_SUPPORT,
    semantic_boundary: SEMANTIC_BOUNDARY,
  }) as UnsignedMessageProjection<T>;
}

export function toChainWorkContract(specValue: WorkSpec): ChainWorkContract {
  const spec = validateWorkSpec(specValue);
  const profile = getZeroneProfile(spec.network);
  return freeze({
    work_spec_hash: sha256IdToChainHash(spec.work_spec_id),
    acceptance_hash: sha256IdToChainHash(spec.acceptance_hash),
    input_root: sha256IdToChainHash(spec.input_root),
    environment_root: sha256IdToChainHash(spec.environment_root),
    min_corroborations: spec.settlement.min_corroborations,
    worker_address: addressFromZeroneAccountId(spec.worker_account, profile),
  }) as ChainWorkContract;
}

export function toChainComputationalCommitment(
  artifactValue: ComputationalArtifact,
): ChainComputationalCommitment {
  const artifact = validateComputationalArtifact(artifactValue);
  return freeze({
    work_spec_hash: sha256IdToChainHash(artifact.work_spec_id),
    acceptance_hash: sha256IdToChainHash(artifact.acceptance_hash),
    input_root: sha256IdToChainHash(artifact.input_root),
    environment_root: sha256IdToChainHash(artifact.environment_root),
    artifact_root: sha256IdToChainHash(artifact.artifact_root),
    evidence_root: sha256IdToChainHash(artifact.evidence_root),
    work_receipt_hash: artifact.chain_work_receipt_hash,
  }) as ChainComputationalCommitment;
}

export function createBountyOrderMessage(
  specValue: WorkSpec,
): UnsignedMessageProjection<CreateBountyOrderValue> {
  const spec = validateWorkSpec(specValue);
  const profile = getZeroneProfile(spec.network);
  const value: CreateBountyOrderValue = freeze({
    sponsor: addressFromZeroneAccountId(spec.sponsor_account, profile),
    domain: spec.knowledge_domain,
    price_per_artifact: spec.settlement.price_per_artifact_uzrn,
    target_count: spec.settlement.target_count,
    duration_blocks: spec.settlement.duration_blocks,
    work_contract: toChainWorkContract(spec),
  }) as CreateBountyOrderValue;
  return project({
    network: spec.network,
    source_account: spec.sponsor_account,
    type_url: MESSAGE_TYPE_URLS.create_bounty,
    wallet_method: WALLET_METHODS.create_bounty,
    value,
    protobuf_value: encodeCreateBountyOrderValue(value),
  });
}

export interface CreateComputationalClaimMessageInput {
  readonly work_spec: WorkSpec;
  readonly artifact: ComputationalArtifact;
  readonly producer_binding: WalletIdentityBinding;
  readonly fact_content: string;
  readonly stake_uzrn: string;
  readonly references: readonly string[];
}

export function createComputationalClaimMessage(
  input: CreateComputationalClaimMessageInput,
): UnsignedMessageProjection<SubmitComputationalClaimValue> {
  const spec = validateWorkSpec(input.work_spec);
  const artifact = validateComputationalArtifact(input.artifact);
  const binding = validateWalletIdentityBinding(input.producer_binding);
  assertComputationalArtifactMatchesWorkSpec(spec, artifact);
  assertSame(binding.binding_id, artifact.producer_binding_id, "producer_binding.binding_id");
  assertSame(binding.zerone_account_id, artifact.producer_account, "producer_binding.zerone_account_id");
  assertSame(binding.zerone_account_id, spec.worker_account, "producer_binding.worker_account");
  const factContent = text(input.fact_content, "fact_content", LIMITS.max_fact_content_bytes);
  const references = sortedUnique(input.references, "references", identifier);
  assertSame(computeFactContentHash(factContent), artifact.claim_commitment.fact_content_hash, "fact_content");
  assertSame(computeReferencesRoot(references), artifact.claim_commitment.references_root, "references");
  const profile = getZeroneProfile(spec.network);
  const value: SubmitComputationalClaimValue = freeze({
    submitter: addressFromZeroneAccountId(binding.zerone_account_id, profile),
    fact_content: factContent,
    domain: spec.knowledge_domain,
    category: "computational",
    stake: uint64(input.stake_uzrn, "stake_uzrn", { positive: true }),
    references,
    partnership_id: "",
    claim_type: CLAIM_TYPE_COMPUTATIONAL,
    // Accepted claims add one Fact and these exact typed edges. The host must
    // confirm every target exists and is citable before reserving funds.
    relations: spec.target_tree.parent_fact_ids.map((targetFactId) => freeze({
      target_fact_id: targetFactId,
      relation: RELATION_TYPE_REQUIRES,
      inference: INFERENCE_TYPE_UNSPECIFIED,
      inference_strength_bps: "0",
      method_id: "",
    })),
    structure: null,
    canonical_form: "",
    sponsored: false,
    method_id: artifact.claim_commitment.method_id,
    // A digest-only source/work reference; raw execution traces remain off chain.
    reasoning_trace: artifact.source_work_id,
    computational_commitment: toChainComputationalCommitment(artifact),
  }) as SubmitComputationalClaimValue;
  return project({
    network: spec.network,
    source_account: binding.zerone_account_id,
    type_url: MESSAGE_TYPE_URLS.submit_claim,
    wallet_method: WALLET_METHODS.submit_claim,
    value,
    protobuf_value: encodeSubmitComputationalClaimValue(value),
  });
}

export function createFulfillBountyMessage(input: {
  readonly settlement_intent: SettlementIntent;
  readonly work_spec: WorkSpec;
  readonly caller_account: ZeroneAccountId;
}): UnsignedMessageProjection<FulfillBountyValue> {
  const settlement = validateSettlementIntent(input.settlement_intent);
  const spec = validateWorkSpec(input.work_spec);
  assertSame(settlement.network, spec.network, "settlement.network");
  assertSame(settlement.work_spec_id, spec.work_spec_id, "settlement.work_spec_id");
  assertSame(settlement.acceptance_hash, spec.acceptance_hash, "settlement.acceptance_hash");
  assertSame(settlement.input_root, spec.input_root, "settlement.input_root");
  assertSame(settlement.environment_root, spec.environment_root, "settlement.environment_root");
  assertSame(settlement.payee_account, spec.worker_account, "settlement.payee_account");
  const profile = getZeroneProfile(settlement.network);
  try {
    assertZeroneAccountId(input.caller_account, profile, "caller_account");
  } catch {
    invalid("invalid_record", "Fulfillment caller account does not match the settlement network.");
  }
  if (
    input.caller_account !== settlement.payee_account
    || input.caller_account !== spec.worker_account
  ) {
    invalid(
      "contract_mismatch",
      "Fulfillment caller must be the stored Fact submitter/payee; relayers cannot claim this v2 message.",
    );
  }
  const value: FulfillBountyValue = freeze({
    caller: addressFromZeroneAccountId(input.caller_account, profile),
    bounty_id: settlement.bounty_id,
    fact_id: settlement.knowledge_fact_id,
  }) as FulfillBountyValue;
  // Payee, contract comparisons, receipt, and nullifier are deliberately not
  // caller-controlled v2 fields. Consensus derives them from the stored Fact.
  return project({
    network: settlement.network,
    source_account: input.caller_account,
    type_url: MESSAGE_TYPE_URLS.fulfill_bounty,
    wallet_method: WALLET_METHODS.fulfill_bounty,
    value,
    protobuf_value: encodeFulfillBountyValue(value),
  });
}
