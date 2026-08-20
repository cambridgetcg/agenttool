import {
  canonicalJsonBytes,
  sha256BytesId,
  type Sha256Id,
} from "@agenttool/wallet";
import {
  addressFromZeroneAccountId,
  assertZeroneAccountId,
  getZeroneProfile,
  type ZeroneAccountId,
  type ZeroneNetwork,
} from "@agenttool/wallet-zerone";

import {
  FORMATS,
  HASH_DOMAINS,
  LIMITS,
  SEMANTIC_BOUNDARY,
  ZERONE_NATIVE_DENOM,
} from "./constants.js";
import {
  deriveChainSettlementNullifier,
  deriveChainWorkReceiptHash,
  domainSeparatedId,
  sha256IdToChainHash,
} from "./canonical.js";
import { invalid } from "./errors.js";
import {
  amount,
  assertSame,
  assertSemanticBoundary,
  freeze,
  factId,
  hash,
  identifier,
  record,
  sortedUnique,
  text,
  timestamp,
  uint32Number,
  uint64,
} from "./internal.js";
import { validateWalletIdentityBinding } from "./identity.js";
import type {
  ComputationalArtifact,
  ComputationalArtifactCore,
  EvidenceOutcome,
  EvidenceReceipt,
  EvidenceReceiptCore,
  SettlementIntent,
  SettlementIntentCore,
  TreasuryDecision,
  TreasuryPolicy,
  TreasuryPolicyCore,
  TreasuryPurpose,
  TreasurySpendContext,
  WalletIdentityBinding,
  WorkAdmissionDecision,
  WorkAdmissionInput,
  WorkSpec,
  WorkSpecCore,
} from "./types.js";

const WORK_CORE_KEYS = [
  "acceptance_hash",
  "created_at",
  "environment_root",
  "format",
  "input_root",
  "knowledge_domain",
  "network",
  "resource_limits",
  "semantic_boundary",
  "settlement",
  "sponsor_account",
  "target_tree",
  "worker_account",
] as const;

const ARTIFACT_CORE_KEYS = [
  "acceptance_hash",
  "artifact_root",
  "claim_commitment",
  "completed_at",
  "environment_root",
  "evidence_root",
  "format",
  "input_root",
  "network",
  "producer_account",
  "producer_binding_id",
  "proposed_tree_transition",
  "resource_usage",
  "semantic_boundary",
  "source_work_id",
  "work_spec_id",
] as const;

const EVIDENCE_CORE_KEYS = [
  "artifact_id",
  "chain_work_receipt_hash",
  "challenge_window_end_height",
  "computational_commitment_hash",
  "corroborations",
  "evidence_root",
  "format",
  "issued_at",
  "issuer_id",
  "issuer_key_id",
  "knowledge_claim_id",
  "knowledge_fact_id",
  "observed_at_height",
  "open_challenges",
  "outcome",
  "semantic_boundary",
  "work_spec_id",
] as const;

const SETTLEMENT_CORE_KEYS = [
  "acceptance_hash",
  "amount",
  "artifact_id",
  "artifact_root",
  "bounty_id",
  "chain_work_receipt_hash",
  "created_at",
  "evidence_receipt_id",
  "expected_chain_nullifier",
  "environment_root",
  "format",
  "input_root",
  "knowledge_fact_id",
  "network",
  "payee_account",
  "payee_binding_id",
  "semantic_boundary",
  "status",
  "valid_until_height",
  "work_spec_id",
] as const;

const TREASURY_CORE_KEYS = [
  "allowed_purposes",
  "automatic_bridging",
  "automatic_governance",
  "automatic_staking",
  "denom",
  "format",
  "issued_at",
  "max_single_spend_uzrn",
  "network",
  "receiving_allowed",
  "reserve_floor_uzrn",
  "semantic_boundary",
  "treasury_account",
  "wallet_binding_id",
  "window_blocks",
  "window_caps_uzrn",
] as const;

const PURPOSES = ["compute", "knowledge_bond", "network_fee", "storage"] as const;

function network(value: unknown, path: string): ZeroneNetwork {
  if (value !== "mainnet" && value !== "testnet") {
    invalid("invalid_record", `${path} must be mainnet or testnet.`, path);
  }
  return value;
}

function account(value: unknown, selectedNetwork: ZeroneNetwork, path: string): ZeroneAccountId {
  try {
    assertZeroneAccountId(value, getZeroneProfile(selectedNetwork), path);
  } catch {
    invalid("invalid_record", `${path} must be a Zerone CAIP-10 account on ${selectedNetwork}.`, path);
  }
  return value as ZeroneAccountId;
}

function outcome(value: unknown, path: string): EvidenceOutcome {
  if (value !== "contract_mature" && value !== "contract_rejected" && value !== "inconclusive") {
    invalid("invalid_record", `${path} is not a supported evidence outcome.`, path);
  }
  return value;
}

function purpose(value: unknown, path: string): TreasuryPurpose {
  if (typeof value !== "string" || !(PURPOSES as readonly string[]).includes(value)) {
    invalid("invalid_record", `${path} is not an allowed treasury purpose.`, path);
  }
  return value as TreasuryPurpose;
}

function coreWithoutId<T extends Record<string, unknown>>(value: T, idKey: string): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(value)) {
    if (key !== idKey) output[key] = member;
  }
  return output;
}

export function validateWorkSpecCore(value: unknown): WorkSpecCore {
  const item = record(value, WORK_CORE_KEYS, "$");
  if (item.format !== FORMATS.work_spec) {
    invalid("invalid_record", `format must be ${FORMATS.work_spec}.`, "$.format");
  }
  const selectedNetwork = network(item.network, "$.network");
  const target = record(item.target_tree, [
    "base_root",
    "output_contract_hash",
    "parent_fact_ids",
    "transition_kind",
    "tree_id",
  ], "$.target_tree");
  if (target.transition_kind !== "add_fact") {
    invalid(
      "invalid_record",
      "v0 can only add one Fact; MsgSubmitClaim cannot revise or tombstone existing facts.",
      "$.target_tree.transition_kind",
    );
  }
  const resources = record(item.resource_limits, [
    "max_accelerator_millis",
    "max_compute_millis",
    "max_input_bytes",
    "max_memory_byte_millis",
    "max_output_bytes",
  ], "$.resource_limits");
  const settlement = record(item.settlement, [
    "denom",
    "duration_blocks",
    "min_corroborations",
    "price_per_artifact_uzrn",
    "target_count",
  ], "$.settlement");
  if (settlement.denom !== ZERONE_NATIVE_DENOM) {
    invalid("invalid_amount", "Work settlement denom must be uzrn.", "$.settlement.denom");
  }
  const minCorroborations = uint64(
    settlement.min_corroborations,
    "$.settlement.min_corroborations",
    { maximum: BigInt(LIMITS.max_min_corroborations) },
  );
  assertSemanticBoundary(item.semantic_boundary, "$.semantic_boundary");
  const core: WorkSpecCore = {
    format: FORMATS.work_spec,
    network: selectedNetwork,
    sponsor_account: account(item.sponsor_account, selectedNetwork, "$.sponsor_account"),
    worker_account: account(item.worker_account, selectedNetwork, "$.worker_account"),
    knowledge_domain: identifier(item.knowledge_domain, "$.knowledge_domain"),
    target_tree: freeze({
      tree_id: identifier(target.tree_id, "$.target_tree.tree_id"),
      base_root: hash(target.base_root, "$.target_tree.base_root"),
      parent_fact_ids: sortedUnique(
        target.parent_fact_ids,
        "$.target_tree.parent_fact_ids",
        factId,
        LIMITS.max_claim_relations,
      ),
      transition_kind: "add_fact",
      output_contract_hash: hash(target.output_contract_hash, "$.target_tree.output_contract_hash"),
    }) as WorkSpecCore["target_tree"],
    input_root: hash(item.input_root, "$.input_root"),
    environment_root: hash(item.environment_root, "$.environment_root"),
    acceptance_hash: hash(item.acceptance_hash, "$.acceptance_hash"),
    resource_limits: freeze({
      max_compute_millis: uint64(resources.max_compute_millis, "$.resource_limits.max_compute_millis", { positive: true }),
      max_accelerator_millis: uint64(resources.max_accelerator_millis, "$.resource_limits.max_accelerator_millis"),
      max_memory_byte_millis: uint64(resources.max_memory_byte_millis, "$.resource_limits.max_memory_byte_millis", { positive: true }),
      max_input_bytes: uint64(resources.max_input_bytes, "$.resource_limits.max_input_bytes", { positive: true }),
      max_output_bytes: uint64(resources.max_output_bytes, "$.resource_limits.max_output_bytes", { positive: true }),
    }),
    settlement: freeze({
      denom: ZERONE_NATIVE_DENOM,
      price_per_artifact_uzrn: amount(settlement.price_per_artifact_uzrn, "$.settlement.price_per_artifact_uzrn", { positive: true }),
      target_count: uint32Number(settlement.target_count, "$.settlement.target_count", {
        positive: true,
        maximum: LIMITS.max_target_count,
      }),
      duration_blocks: uint64(settlement.duration_blocks, "$.settlement.duration_blocks", { positive: true }),
      min_corroborations: minCorroborations,
    }),
    created_at: timestamp(item.created_at, "$.created_at"),
    semantic_boundary: SEMANTIC_BOUNDARY,
  };
  return freeze(core) as WorkSpecCore;
}

export type CreateWorkSpecInput = Omit<WorkSpecCore, "format" | "semantic_boundary">;

export function createWorkSpec(input: CreateWorkSpecInput): WorkSpec {
  const core = validateWorkSpecCore({
    ...input,
    format: FORMATS.work_spec,
    semantic_boundary: SEMANTIC_BOUNDARY,
  });
  return freeze({
    ...core,
    work_spec_id: domainSeparatedId(HASH_DOMAINS.work_spec, core),
  }) as WorkSpec;
}

export function validateWorkSpec(value: unknown): WorkSpec {
  const item = record(value, [...WORK_CORE_KEYS, "work_spec_id"], "$");
  const core = validateWorkSpecCore(coreWithoutId(item, "work_spec_id"));
  const id = hash(item.work_spec_id, "$.work_spec_id");
  if (id !== domainSeparatedId(HASH_DOMAINS.work_spec, core)) {
    invalid("invalid_hash", "work_spec_id does not match the canonical work specification.", "$.work_spec_id");
  }
  return freeze({ ...core, work_spec_id: id }) as WorkSpec;
}

export function computeSourceWorkId(input: {
  readonly network: ZeroneNetwork;
  readonly work_spec_id: Sha256Id;
  readonly producer_binding_id: Sha256Id;
  readonly producer_account: ZeroneAccountId;
  readonly artifact_root: Sha256Id;
}): Sha256Id {
  return domainSeparatedId(HASH_DOMAINS.source_work, input);
}

export function computeFactContentHash(content: string): Sha256Id {
  text(content, "fact_content", LIMITS.max_fact_content_bytes);
  return sha256BytesId(new TextEncoder().encode(content));
}

export function computeReferencesRoot(references: readonly string[]): Sha256Id {
  const normalized = sortedUnique(references, "references", identifier);
  return sha256BytesId(canonicalJsonBytes(normalized));
}

export function validateComputationalArtifactCore(value: unknown): ComputationalArtifactCore {
  const item = record(value, ARTIFACT_CORE_KEYS, "$");
  if (item.format !== FORMATS.artifact) {
    invalid("invalid_record", `format must be ${FORMATS.artifact}.`, "$.format");
  }
  const selectedNetwork = network(item.network, "$.network");
  const producer = account(item.producer_account, selectedNetwork, "$.producer_account");
  const claim = record(item.claim_commitment, [
    "fact_content_hash",
    "method_id",
    "references_root",
  ], "$.claim_commitment");
  const transition = record(item.proposed_tree_transition, [
    "changed_nodes_root",
    "changed_relations_root",
    "from_root",
    "to_root",
  ], "$.proposed_tree_transition");
  const usage = record(item.resource_usage, [
    "accelerator_millis",
    "compute_millis",
    "input_bytes",
    "memory_byte_millis",
    "output_bytes",
  ], "$.resource_usage");
  const workSpecId = hash(item.work_spec_id, "$.work_spec_id");
  const bindingId = hash(item.producer_binding_id, "$.producer_binding_id");
  const artifactRoot = hash(item.artifact_root, "$.artifact_root");
  const expectedSourceId = computeSourceWorkId({
    network: selectedNetwork,
    work_spec_id: workSpecId,
    producer_binding_id: bindingId,
    producer_account: producer,
    artifact_root: artifactRoot,
  });
  const sourceId = hash(item.source_work_id, "$.source_work_id");
  if (sourceId !== expectedSourceId) {
    invalid("invalid_hash", "source_work_id is not the deterministic source/work identifier.", "$.source_work_id");
  }
  if (transition.from_root === transition.to_root) {
    invalid("invalid_record", "A proposed tree transition must change the tree root.", "$.proposed_tree_transition.to_root");
  }
  assertSemanticBoundary(item.semantic_boundary, "$.semantic_boundary");
  const core: ComputationalArtifactCore = {
    format: FORMATS.artifact,
    network: selectedNetwork,
    work_spec_id: workSpecId,
    source_work_id: sourceId,
    producer_binding_id: bindingId,
    producer_account: producer,
    acceptance_hash: hash(item.acceptance_hash, "$.acceptance_hash"),
    input_root: hash(item.input_root, "$.input_root"),
    environment_root: hash(item.environment_root, "$.environment_root"),
    artifact_root: artifactRoot,
    evidence_root: hash(item.evidence_root, "$.evidence_root"),
    claim_commitment: freeze({
      fact_content_hash: hash(claim.fact_content_hash, "$.claim_commitment.fact_content_hash"),
      references_root: hash(claim.references_root, "$.claim_commitment.references_root"),
      method_id: identifier(claim.method_id, "$.claim_commitment.method_id"),
    }),
    proposed_tree_transition: freeze({
      from_root: hash(transition.from_root, "$.proposed_tree_transition.from_root"),
      to_root: hash(transition.to_root, "$.proposed_tree_transition.to_root"),
      changed_nodes_root: hash(transition.changed_nodes_root, "$.proposed_tree_transition.changed_nodes_root"),
      changed_relations_root: hash(transition.changed_relations_root, "$.proposed_tree_transition.changed_relations_root"),
    }),
    resource_usage: freeze({
      compute_millis: uint64(usage.compute_millis, "$.resource_usage.compute_millis", { positive: true }),
      accelerator_millis: uint64(usage.accelerator_millis, "$.resource_usage.accelerator_millis"),
      memory_byte_millis: uint64(usage.memory_byte_millis, "$.resource_usage.memory_byte_millis", { positive: true }),
      input_bytes: uint64(usage.input_bytes, "$.resource_usage.input_bytes", { positive: true }),
      output_bytes: uint64(usage.output_bytes, "$.resource_usage.output_bytes", { positive: true }),
    }),
    completed_at: timestamp(item.completed_at, "$.completed_at"),
    semantic_boundary: SEMANTIC_BOUNDARY,
  };
  return freeze(core) as ComputationalArtifactCore;
}

export interface CreateComputationalArtifactInput {
  readonly work_spec: WorkSpec;
  readonly producer_binding: WalletIdentityBinding;
  readonly artifact_root: Sha256Id;
  readonly evidence_root: Sha256Id;
  readonly claim_commitment: ComputationalArtifactCore["claim_commitment"];
  readonly proposed_tree_transition: ComputationalArtifactCore["proposed_tree_transition"];
  readonly resource_usage: ComputationalArtifactCore["resource_usage"];
  readonly completed_at: string;
}

export function createComputationalArtifact(
  input: CreateComputationalArtifactInput,
): ComputationalArtifact {
  const spec = validateWorkSpec(input.work_spec);
  const binding = validateWalletIdentityBinding(input.producer_binding);
  assertSame(binding.network, spec.network, "producer_binding.network");
  assertSame(binding.zerone_account_id, spec.worker_account, "producer_binding.zerone_account_id");
  const sourceWorkId = computeSourceWorkId({
    network: spec.network,
    work_spec_id: spec.work_spec_id,
    producer_binding_id: binding.binding_id,
    producer_account: binding.zerone_account_id,
    artifact_root: input.artifact_root,
  });
  const core = validateComputationalArtifactCore({
    format: FORMATS.artifact,
    network: spec.network,
    work_spec_id: spec.work_spec_id,
    source_work_id: sourceWorkId,
    producer_binding_id: binding.binding_id,
    producer_account: binding.zerone_account_id,
    acceptance_hash: spec.acceptance_hash,
    input_root: spec.input_root,
    environment_root: spec.environment_root,
    artifact_root: input.artifact_root,
    evidence_root: input.evidence_root,
    claim_commitment: input.claim_commitment,
    proposed_tree_transition: input.proposed_tree_transition,
    resource_usage: input.resource_usage,
    completed_at: input.completed_at,
    semantic_boundary: SEMANTIC_BOUNDARY,
  });
  assertSame(core.proposed_tree_transition.from_root, spec.target_tree.base_root, "proposed_tree_transition.from_root");
  if (BigInt(core.resource_usage.compute_millis) > BigInt(spec.resource_limits.max_compute_millis)
    || BigInt(core.resource_usage.accelerator_millis) > BigInt(spec.resource_limits.max_accelerator_millis)
    || BigInt(core.resource_usage.memory_byte_millis) > BigInt(spec.resource_limits.max_memory_byte_millis)
    || BigInt(core.resource_usage.input_bytes) > BigInt(spec.resource_limits.max_input_bytes)
    || BigInt(core.resource_usage.output_bytes) > BigInt(spec.resource_limits.max_output_bytes)) {
    invalid("contract_mismatch", "Artifact resource usage exceeds the committed WorkSpec limits.");
  }
  const artifactId = domainSeparatedId(HASH_DOMAINS.artifact, core);
  const chainWorkReceiptHash = deriveChainWorkReceiptHash({
    work_spec_id: core.work_spec_id,
    acceptance_hash: core.acceptance_hash,
    input_root: core.input_root,
    environment_root: core.environment_root,
    artifact_root: core.artifact_root,
    evidence_root: core.evidence_root,
    payee_address: addressFromZeroneAccountId(
      core.producer_account,
      getZeroneProfile(core.network),
    ),
  });
  return freeze({
    ...core,
    // artifact_id is AgentTool's richer off-chain receipt: it commits the exact
    // payee, dual-key binding, work/source IDs, roots, claim content, and usage.
    // chain_work_receipt_hash separately matches Zerone consensus exactly.
    artifact_id: artifactId,
    chain_work_receipt_hash: chainWorkReceiptHash,
  }) as ComputationalArtifact;
}

export function validateComputationalArtifact(value: unknown): ComputationalArtifact {
  const item = record(value, [...ARTIFACT_CORE_KEYS, "artifact_id", "chain_work_receipt_hash"], "$");
  const coreValue = coreWithoutId(coreWithoutId(item, "artifact_id"), "chain_work_receipt_hash");
  const core = validateComputationalArtifactCore(coreValue);
  const id = hash(item.artifact_id, "$.artifact_id");
  if (id !== domainSeparatedId(HASH_DOMAINS.artifact, core)) {
    invalid("invalid_hash", "artifact_id/work_receipt_hash does not match its canonical core.", "$.artifact_id");
  }
  const expectedChainReceipt = deriveChainWorkReceiptHash({
    work_spec_id: core.work_spec_id,
    acceptance_hash: core.acceptance_hash,
    input_root: core.input_root,
    environment_root: core.environment_root,
    artifact_root: core.artifact_root,
    evidence_root: core.evidence_root,
    payee_address: addressFromZeroneAccountId(
      core.producer_account,
      getZeroneProfile(core.network),
    ),
  });
  if (item.chain_work_receipt_hash !== expectedChainReceipt) {
    invalid("invalid_hash", "chain_work_receipt_hash does not match Zerone's consensus recipe.");
  }
  return freeze({
    ...core,
    artifact_id: id,
    chain_work_receipt_hash: expectedChainReceipt,
  }) as ComputationalArtifact;
}

export function assertComputationalArtifactMatchesWorkSpec(
  specValue: WorkSpec,
  artifactValue: ComputationalArtifact,
): void {
  const spec = validateWorkSpec(specValue);
  const artifact = validateComputationalArtifact(artifactValue);
  assertSame(artifact.network, spec.network, "artifact.network");
  assertSame(artifact.work_spec_id, spec.work_spec_id, "artifact.work_spec_id");
  assertSame(artifact.producer_account, spec.worker_account, "artifact.producer_account");
  assertSame(artifact.acceptance_hash, spec.acceptance_hash, "artifact.acceptance_hash");
  assertSame(artifact.input_root, spec.input_root, "artifact.input_root");
  assertSame(artifact.environment_root, spec.environment_root, "artifact.environment_root");
  assertSame(
    artifact.proposed_tree_transition.from_root,
    spec.target_tree.base_root,
    "artifact.proposed_tree_transition.from_root",
  );
  if (
    BigInt(artifact.resource_usage.compute_millis) > BigInt(spec.resource_limits.max_compute_millis)
    || BigInt(artifact.resource_usage.accelerator_millis) > BigInt(spec.resource_limits.max_accelerator_millis)
    || BigInt(artifact.resource_usage.memory_byte_millis) > BigInt(spec.resource_limits.max_memory_byte_millis)
    || BigInt(artifact.resource_usage.input_bytes) > BigInt(spec.resource_limits.max_input_bytes)
    || BigInt(artifact.resource_usage.output_bytes) > BigInt(spec.resource_limits.max_output_bytes)
  ) {
    invalid("contract_mismatch", "Artifact resource usage exceeds the committed WorkSpec limits.");
  }
}

/** AgentTool-local hash of the exact logical ComputationalCommitment projection. */
export function computationalCommitmentProjectionHash(
  artifactValue: ComputationalArtifact,
): Sha256Id {
  const artifact = validateComputationalArtifact(artifactValue);
  return sha256BytesId(canonicalJsonBytes({
    work_spec_hash: sha256IdToChainHash(artifact.work_spec_id),
    acceptance_hash: sha256IdToChainHash(artifact.acceptance_hash),
    input_root: sha256IdToChainHash(artifact.input_root),
    environment_root: sha256IdToChainHash(artifact.environment_root),
    artifact_root: sha256IdToChainHash(artifact.artifact_root),
    evidence_root: sha256IdToChainHash(artifact.evidence_root),
    work_receipt_hash: artifact.chain_work_receipt_hash,
  }));
}

export function validateEvidenceReceiptCore(value: unknown): EvidenceReceiptCore {
  const item = record(value, EVIDENCE_CORE_KEYS, "$");
  if (item.format !== FORMATS.evidence) {
    invalid("invalid_record", `format must be ${FORMATS.evidence}.`, "$.format");
  }
  const evidenceOutcome = outcome(item.outcome, "$.outcome");
  const challengeEnd = uint64(item.challenge_window_end_height, "$.challenge_window_end_height");
  const observed = uint64(item.observed_at_height, "$.observed_at_height");
  const openChallenges = uint32Number(item.open_challenges, "$.open_challenges");
  const corroborations = uint64(item.corroborations, "$.corroborations", {
    maximum: BigInt(LIMITS.max_min_corroborations),
  });
  if (
    evidenceOutcome === "contract_mature"
    && (
      challengeEnd === "0"
      || BigInt(observed) < BigInt(challengeEnd)
      || openChallenges !== 0
    )
  ) {
    invalid(
      "settlement_ineligible",
      "Contract-mature evidence requires the closed challenge window and zero open challenges.",
    );
  }
  assertSemanticBoundary(item.semantic_boundary, "$.semantic_boundary");
  const core: EvidenceReceiptCore = {
    format: FORMATS.evidence,
    work_spec_id: hash(item.work_spec_id, "$.work_spec_id"),
    artifact_id: hash(item.artifact_id, "$.artifact_id"),
    chain_work_receipt_hash: (() => {
      if (typeof item.chain_work_receipt_hash !== "string" || !/^[0-9a-f]{64}$/u.test(item.chain_work_receipt_hash)) {
        invalid("invalid_hash", "chain_work_receipt_hash must be bare 64-character lowercase hex.");
      }
      return item.chain_work_receipt_hash;
    })(),
    knowledge_claim_id: identifier(item.knowledge_claim_id, "$.knowledge_claim_id"),
    knowledge_fact_id: identifier(item.knowledge_fact_id, "$.knowledge_fact_id"),
    computational_commitment_hash: hash(item.computational_commitment_hash, "$.computational_commitment_hash"),
    evidence_root: hash(item.evidence_root, "$.evidence_root"),
    outcome: evidenceOutcome,
    corroborations,
    challenge_window_end_height: challengeEnd,
    observed_at_height: observed,
    open_challenges: openChallenges,
    issuer_id: identifier(item.issuer_id, "$.issuer_id"),
    issuer_key_id: hash(item.issuer_key_id, "$.issuer_key_id"),
    issued_at: timestamp(item.issued_at, "$.issued_at"),
    semantic_boundary: SEMANTIC_BOUNDARY,
  };
  return freeze(core) as EvidenceReceiptCore;
}

export interface CreateEvidenceReceiptInput {
  readonly work_spec: WorkSpec;
  readonly artifact: ComputationalArtifact;
  readonly knowledge_claim_id: string;
  readonly knowledge_fact_id: string;
  readonly computational_commitment_hash: Sha256Id;
  readonly outcome: EvidenceOutcome;
  readonly corroborations: string;
  readonly challenge_window_end_height: string;
  readonly observed_at_height: string;
  readonly open_challenges: number;
  readonly issuer_id: string;
  readonly issuer_key_id: Sha256Id;
  readonly issued_at: string;
}

export function createEvidenceReceipt(input: CreateEvidenceReceiptInput): EvidenceReceipt {
  const spec = validateWorkSpec(input.work_spec);
  const artifact = validateComputationalArtifact(input.artifact);
  assertComputationalArtifactMatchesWorkSpec(spec, artifact);
  assertSame(
    input.computational_commitment_hash,
    computationalCommitmentProjectionHash(artifact),
    "computational_commitment_hash",
  );
  const core = validateEvidenceReceiptCore({
    format: FORMATS.evidence,
    work_spec_id: spec.work_spec_id,
    artifact_id: artifact.artifact_id,
    chain_work_receipt_hash: artifact.chain_work_receipt_hash,
    knowledge_claim_id: input.knowledge_claim_id,
    knowledge_fact_id: input.knowledge_fact_id,
    computational_commitment_hash: input.computational_commitment_hash,
    evidence_root: artifact.evidence_root,
    outcome: input.outcome,
    corroborations: input.corroborations,
    challenge_window_end_height: input.challenge_window_end_height,
    observed_at_height: input.observed_at_height,
    open_challenges: input.open_challenges,
    issuer_id: input.issuer_id,
    issuer_key_id: input.issuer_key_id,
    issued_at: input.issued_at,
    semantic_boundary: SEMANTIC_BOUNDARY,
  });
  if (
    core.outcome === "contract_mature"
    && BigInt(core.corroborations) < BigInt(spec.settlement.min_corroborations)
  ) {
    invalid("settlement_ineligible", "Evidence does not meet WorkContract.min_corroborations.");
  }
  return freeze({
    ...core,
    evidence_receipt_id: domainSeparatedId(HASH_DOMAINS.evidence, core),
  }) as EvidenceReceipt;
}

export function validateEvidenceReceipt(value: unknown): EvidenceReceipt {
  const item = record(value, [...EVIDENCE_CORE_KEYS, "evidence_receipt_id"], "$");
  const core = validateEvidenceReceiptCore(coreWithoutId(item, "evidence_receipt_id"));
  const id = hash(item.evidence_receipt_id, "$.evidence_receipt_id");
  if (id !== domainSeparatedId(HASH_DOMAINS.evidence, core)) {
    invalid("invalid_hash", "evidence_receipt_id does not match its canonical core.", "$.evidence_receipt_id");
  }
  return freeze({ ...core, evidence_receipt_id: id }) as EvidenceReceipt;
}

export interface CreateSettlementIntentInput {
  readonly bounty_id: string;
  readonly work_spec: WorkSpec;
  readonly artifact: ComputationalArtifact;
  readonly evidence: EvidenceReceipt;
  readonly payee_binding: WalletIdentityBinding;
  readonly created_at: string;
  readonly valid_until_height: string;
}

export function createSettlementIntent(input: CreateSettlementIntentInput): SettlementIntent {
  const spec = validateWorkSpec(input.work_spec);
  const artifact = validateComputationalArtifact(input.artifact);
  const evidence = validateEvidenceReceipt(input.evidence);
  const binding = validateWalletIdentityBinding(input.payee_binding);
  if (evidence.outcome !== "contract_mature" || evidence.open_challenges !== 0) {
    invalid("settlement_ineligible", "Only contract-mature evidence can form a settlement intent.");
  }
  if (BigInt(evidence.corroborations) < BigInt(spec.settlement.min_corroborations)) {
    invalid(
      "settlement_ineligible",
      "Settlement evidence does not meet this WorkSpec's min_corroborations.",
    );
  }
  assertComputationalArtifactMatchesWorkSpec(spec, artifact);
  assertSame(evidence.work_spec_id, spec.work_spec_id, "evidence.work_spec_id");
  assertSame(evidence.artifact_id, artifact.artifact_id, "evidence.artifact_id");
  assertSame(
    evidence.chain_work_receipt_hash,
    artifact.chain_work_receipt_hash,
    "evidence.chain_work_receipt_hash",
  );
  assertSame(evidence.evidence_root, artifact.evidence_root, "evidence.evidence_root");
  assertSame(
    evidence.computational_commitment_hash,
    computationalCommitmentProjectionHash(artifact),
    "evidence.computational_commitment_hash",
  );
  assertSame(binding.binding_id, artifact.producer_binding_id, "payee_binding.binding_id");
  assertSame(binding.zerone_account_id, artifact.producer_account, "payee_binding.zerone_account_id");
  assertSame(binding.zerone_account_id, spec.worker_account, "payee_binding.zerone_account_id");
  const core = validateSettlementIntentCore({
    format: FORMATS.settlement,
    network: spec.network,
    bounty_id: input.bounty_id,
    work_spec_id: spec.work_spec_id,
    acceptance_hash: spec.acceptance_hash,
    input_root: spec.input_root,
    environment_root: spec.environment_root,
    artifact_id: artifact.artifact_id,
    artifact_root: artifact.artifact_root,
    chain_work_receipt_hash: artifact.chain_work_receipt_hash,
    evidence_receipt_id: evidence.evidence_receipt_id,
    knowledge_fact_id: evidence.knowledge_fact_id,
    payee_binding_id: binding.binding_id,
    payee_account: binding.zerone_account_id,
    amount: {
      denom: ZERONE_NATIVE_DENOM,
      amount_uzrn: spec.settlement.price_per_artifact_uzrn,
    },
    expected_chain_nullifier: deriveChainSettlementNullifier({
      work_spec_id: spec.work_spec_id,
      acceptance_hash: spec.acceptance_hash,
      input_root: spec.input_root,
      environment_root: spec.environment_root,
      artifact_root: artifact.artifact_root,
      worker_address: addressFromZeroneAccountId(
        spec.worker_account,
        getZeroneProfile(spec.network),
      ),
    }),
    created_at: input.created_at,
    valid_until_height: input.valid_until_height,
    status: "proposed_unsigned",
    semantic_boundary: SEMANTIC_BOUNDARY,
  });
  if (BigInt(core.valid_until_height) < BigInt(evidence.observed_at_height)) {
    invalid("settlement_ineligible", "Settlement intent is already stale at the evidence observation height.");
  }
  return freeze({
    ...core,
    settlement_intent_id: domainSeparatedId(HASH_DOMAINS.settlement, core),
  }) as SettlementIntent;
}

export function validateSettlementIntentCore(value: unknown): SettlementIntentCore {
  const item = record(value, SETTLEMENT_CORE_KEYS, "$");
  if (item.format !== FORMATS.settlement || item.status !== "proposed_unsigned") {
    invalid("invalid_record", "Settlement intent must be a proposed unsigned v0.1 record.");
  }
  const selectedNetwork = network(item.network, "$.network");
  const coin = record(item.amount, ["amount_uzrn", "denom"], "$.amount");
  if (coin.denom !== ZERONE_NATIVE_DENOM) {
    invalid("invalid_amount", "Settlement intent denom must be uzrn.", "$.amount.denom");
  }
  const workSpecId = hash(item.work_spec_id, "$.work_spec_id");
  const acceptanceHash = hash(item.acceptance_hash, "$.acceptance_hash");
  const inputRoot = hash(item.input_root, "$.input_root");
  const environmentRoot = hash(item.environment_root, "$.environment_root");
  const artifactId = hash(item.artifact_id, "$.artifact_id");
  const artifactRoot = hash(item.artifact_root, "$.artifact_root");
  const payeeAccount = account(item.payee_account, selectedNetwork, "$.payee_account");
  if (typeof item.chain_work_receipt_hash !== "string" || !/^[0-9a-f]{64}$/u.test(item.chain_work_receipt_hash)) {
    invalid("invalid_hash", "chain_work_receipt_hash must be bare 64-character lowercase hex.");
  }
  const chainWorkReceiptHash = item.chain_work_receipt_hash;
  const expected = deriveChainSettlementNullifier({
    work_spec_id: workSpecId,
    acceptance_hash: acceptanceHash,
    input_root: inputRoot,
    environment_root: environmentRoot,
    artifact_root: artifactRoot,
    worker_address: addressFromZeroneAccountId(
      payeeAccount,
      getZeroneProfile(selectedNetwork),
    ),
  });
  if (item.expected_chain_nullifier !== expected) {
    invalid("invalid_hash", "Settlement nullifier does not match the chain v2 derivation.", "$.expected_chain_nullifier");
  }
  assertSemanticBoundary(item.semantic_boundary, "$.semantic_boundary");
  return freeze({
    format: FORMATS.settlement,
    network: selectedNetwork,
    bounty_id: identifier(item.bounty_id, "$.bounty_id"),
    work_spec_id: workSpecId,
    acceptance_hash: acceptanceHash,
    input_root: inputRoot,
    environment_root: environmentRoot,
    artifact_id: artifactId,
    artifact_root: artifactRoot,
    chain_work_receipt_hash: chainWorkReceiptHash,
    evidence_receipt_id: hash(item.evidence_receipt_id, "$.evidence_receipt_id"),
    knowledge_fact_id: identifier(item.knowledge_fact_id, "$.knowledge_fact_id"),
    payee_binding_id: hash(item.payee_binding_id, "$.payee_binding_id"),
    payee_account: payeeAccount,
    amount: freeze({
      denom: ZERONE_NATIVE_DENOM,
      amount_uzrn: amount(coin.amount_uzrn, "$.amount.amount_uzrn", { positive: true }),
    }),
    expected_chain_nullifier: expected,
    created_at: timestamp(item.created_at, "$.created_at"),
    valid_until_height: uint64(item.valid_until_height, "$.valid_until_height", { positive: true }),
    status: "proposed_unsigned",
    semantic_boundary: SEMANTIC_BOUNDARY,
  }) as SettlementIntentCore;
}

export function validateSettlementIntent(value: unknown): SettlementIntent {
  const item = record(value, [...SETTLEMENT_CORE_KEYS, "settlement_intent_id"], "$");
  const core = validateSettlementIntentCore(coreWithoutId(item, "settlement_intent_id"));
  const id = hash(item.settlement_intent_id, "$.settlement_intent_id");
  if (id !== domainSeparatedId(HASH_DOMAINS.settlement, core)) {
    invalid("invalid_hash", "settlement_intent_id does not match its canonical core.");
  }
  return freeze({ ...core, settlement_intent_id: id }) as SettlementIntent;
}

export function validateTreasuryPolicyCore(value: unknown): TreasuryPolicyCore {
  const item = record(value, TREASURY_CORE_KEYS, "$");
  if (item.format !== FORMATS.treasury) {
    invalid("invalid_record", `format must be ${FORMATS.treasury}.`, "$.format");
  }
  if (
    item.denom !== ZERONE_NATIVE_DENOM
    || item.receiving_allowed !== true
    || item.automatic_staking !== false
    || item.automatic_governance !== false
    || item.automatic_bridging !== false
  ) {
    invalid(
      "invalid_record",
      "Treasury must accept income while keeping staking, governance, and bridging non-automatic.",
    );
  }
  const selectedNetwork = network(item.network, "$.network");
  const caps = record(item.window_caps_uzrn, [
    "compute",
    "knowledge_bond",
    "network_fee",
    "storage",
    "total",
  ], "$.window_caps_uzrn");
  const allowed = sortedUnique(item.allowed_purposes, "$.allowed_purposes", purpose, PURPOSES.length);
  if (allowed.length === 0) invalid("invalid_record", "Treasury must explicitly allow at least one purpose.");
  assertSemanticBoundary(item.semantic_boundary, "$.semantic_boundary");
  const core: TreasuryPolicyCore = {
    format: FORMATS.treasury,
    network: selectedNetwork,
    wallet_binding_id: hash(item.wallet_binding_id, "$.wallet_binding_id"),
    treasury_account: account(item.treasury_account, selectedNetwork, "$.treasury_account"),
    denom: ZERONE_NATIVE_DENOM,
    reserve_floor_uzrn: amount(item.reserve_floor_uzrn, "$.reserve_floor_uzrn"),
    max_single_spend_uzrn: amount(item.max_single_spend_uzrn, "$.max_single_spend_uzrn", { positive: true }),
    window_blocks: uint64(item.window_blocks, "$.window_blocks", {
      positive: true,
      maximum: LIMITS.max_policy_window_blocks,
    }),
    window_caps_uzrn: freeze({
      compute: amount(caps.compute, "$.window_caps_uzrn.compute"),
      storage: amount(caps.storage, "$.window_caps_uzrn.storage"),
      network_fee: amount(caps.network_fee, "$.window_caps_uzrn.network_fee"),
      knowledge_bond: amount(caps.knowledge_bond, "$.window_caps_uzrn.knowledge_bond"),
      total: amount(caps.total, "$.window_caps_uzrn.total"),
    }),
    allowed_purposes: allowed,
    receiving_allowed: true,
    automatic_staking: false,
    automatic_governance: false,
    automatic_bridging: false,
    issued_at: timestamp(item.issued_at, "$.issued_at"),
    semantic_boundary: SEMANTIC_BOUNDARY,
  };
  if (BigInt(core.max_single_spend_uzrn) > BigInt(core.window_caps_uzrn.total)) {
    invalid("invalid_record", "max_single_spend_uzrn cannot exceed the total window cap.");
  }
  return freeze(core) as TreasuryPolicyCore;
}

export type CreateTreasuryPolicyInput = Omit<
  TreasuryPolicyCore,
  "format" | "semantic_boundary" | "receiving_allowed" | "automatic_staking"
  | "automatic_governance" | "automatic_bridging"
> & {
  /** The exact candidate binding referenced by this policy; proof remains external. */
  readonly wallet_binding: WalletIdentityBinding;
};

export function createTreasuryPolicy(input: CreateTreasuryPolicyInput): TreasuryPolicy {
  const binding = validateWalletIdentityBinding(input.wallet_binding);
  const { wallet_binding: _binding, ...policyInput } = input;
  const core = validateTreasuryPolicyCore({
    ...policyInput,
    format: FORMATS.treasury,
    receiving_allowed: true,
    automatic_staking: false,
    automatic_governance: false,
    automatic_bridging: false,
    semantic_boundary: SEMANTIC_BOUNDARY,
  });
  assertSame(core.network, binding.network, "treasury.network");
  assertSame(core.wallet_binding_id, binding.binding_id, "treasury.wallet_binding_id");
  assertSame(core.treasury_account, binding.zerone_account_id, "treasury.treasury_account");
  return freeze({
    ...core,
    treasury_policy_id: domainSeparatedId(HASH_DOMAINS.treasury, core),
  }) as TreasuryPolicy;
}

export function validateTreasuryPolicy(value: unknown): TreasuryPolicy {
  const item = record(value, [...TREASURY_CORE_KEYS, "treasury_policy_id"], "$");
  const core = validateTreasuryPolicyCore(coreWithoutId(item, "treasury_policy_id"));
  const id = hash(item.treasury_policy_id, "$.treasury_policy_id");
  if (id !== domainSeparatedId(HASH_DOMAINS.treasury, core)) {
    invalid("invalid_hash", "treasury_policy_id does not match its canonical core.");
  }
  return freeze({ ...core, treasury_policy_id: id }) as TreasuryPolicy;
}

export function evaluateTreasurySpend(
  policyValue: TreasuryPolicy,
  context: TreasurySpendContext,
): TreasuryDecision {
  const policy = validateTreasuryPolicy(policyValue);
  uint64(context.current_height, "context.current_height");
  const balance = BigInt(amount(context.current_balance_uzrn, "context.current_balance_uzrn"));
  const reserved = BigInt(amount(context.durable_reserved_uzrn, "context.durable_reserved_uzrn"));
  const sticky = BigInt(amount(context.sticky_unknown_exposure_uzrn, "context.sticky_unknown_exposure_uzrn"));
  const spend = BigInt(amount(context.amount_uzrn, "context.amount_uzrn", { positive: true }));
  const selectedPurpose = purpose(context.purpose, "context.purpose");
  const used: Record<TreasuryPurpose | "total", bigint> = {
    compute: BigInt(amount(context.spent_in_window_uzrn.compute, "context.spent_in_window_uzrn.compute")),
    storage: BigInt(amount(context.spent_in_window_uzrn.storage, "context.spent_in_window_uzrn.storage")),
    network_fee: BigInt(amount(context.spent_in_window_uzrn.network_fee, "context.spent_in_window_uzrn.network_fee")),
    knowledge_bond: BigInt(amount(context.spent_in_window_uzrn.knowledge_bond, "context.spent_in_window_uzrn.knowledge_bond")),
    total: BigInt(amount(context.spent_in_window_uzrn.total, "context.spent_in_window_uzrn.total")),
  };
  const derivedTotal = used.compute + used.storage + used.network_fee + used.knowledge_bond;
  if (used.total !== derivedTotal) {
    invalid(
      "treasury_denied",
      "context.spent_in_window_uzrn.total must equal the sum of all purpose counters.",
      "context.spent_in_window_uzrn.total",
    );
  }
  const post = balance >= spend ? balance - spend : 0n;
  let reason: TreasuryDecision["reason"] = "within_policy";
  if (!policy.allowed_purposes.includes(selectedPurpose)) reason = "purpose_not_allowed";
  else if (spend > BigInt(policy.max_single_spend_uzrn)) reason = "single_spend_exceeded";
  else if (used[selectedPurpose] + spend > BigInt(policy.window_caps_uzrn[selectedPurpose])) reason = "purpose_window_exceeded";
  else if (derivedTotal + spend > BigInt(policy.window_caps_uzrn.total)) reason = "total_window_exceeded";
  else if (balance < reserved + sticky + BigInt(policy.reserve_floor_uzrn) + spend) reason = "reserve_floor_breached";
  return freeze({
    allowed: reason === "within_policy",
    reason,
    post_spend_balance_uzrn: post.toString(),
    effects_performed: false,
  }) as TreasuryDecision;
}

export function assertTreasuryPolicyDoesNotWiden(
  parentValue: TreasuryPolicy,
  delegatedValue: TreasuryPolicy,
): void {
  const parent = validateTreasuryPolicy(parentValue);
  const delegated = validateTreasuryPolicy(delegatedValue);
  if (
    parent.network !== delegated.network
    || parent.wallet_binding_id !== delegated.wallet_binding_id
    || parent.treasury_account !== delegated.treasury_account
    || parent.window_blocks !== delegated.window_blocks
  ) {
    invalid("treasury_denied", "A delegated treasury policy must preserve its binding, account, network, and window.");
  }
  if (
    BigInt(delegated.reserve_floor_uzrn) < BigInt(parent.reserve_floor_uzrn)
    || BigInt(delegated.max_single_spend_uzrn) > BigInt(parent.max_single_spend_uzrn)
    || (Object.keys(parent.window_caps_uzrn) as Array<keyof typeof parent.window_caps_uzrn>)
      .some((key) => BigInt(delegated.window_caps_uzrn[key]) > BigInt(parent.window_caps_uzrn[key]))
    || delegated.allowed_purposes.some((item) => !parent.allowed_purposes.includes(item))
  ) {
    invalid("treasury_denied", "A delegated treasury policy cannot lower reserves or raise any authority/limit.");
  }
}

export function evaluateWorkAdmission(input: WorkAdmissionInput): WorkAdmissionDecision {
  const current = BigInt(uint64(input.current_height, "input.current_height"));
  const end = BigInt(uint64(input.contract_end_height, "input.contract_end_height", { positive: true }));
  const verification = BigInt(uint64(input.expected_verification_blocks, "input.expected_verification_blocks"));
  const challenge = BigInt(uint64(input.expected_challenge_blocks, "input.expected_challenge_blocks"));
  const safety = BigInt(uint64(input.safety_blocks, "input.safety_blocks"));
  const requiredMaturity = current + verification + challenge + safety;
  if (requiredMaturity > LIMITS.max_uint64) {
    invalid("invalid_amount", "Required maturity height exceeds uint64.");
  }
  const price = BigInt(amount(input.price_uzrn, "input.price_uzrn", { positive: true }));
  const compute = BigInt(amount(input.compute_cost_uzrn, "input.compute_cost_uzrn"));
  const storage = BigInt(amount(input.storage_cost_uzrn, "input.storage_cost_uzrn"));
  const reviewFee = BigInt(amount(input.review_fee_uzrn, "input.review_fee_uzrn"));
  const networkFee = BigInt(amount(input.network_fee_uzrn, "input.network_fee_uzrn"));
  const minimumMargin = BigInt(amount(input.minimum_margin_uzrn, "input.minimum_margin_uzrn"));
  const totalCost = compute + storage + reviewFee + networkFee;
  const net = price - totalCost;
  let reason: WorkAdmissionDecision["reason"] = "within_policy";
  // The negotiated contract is inactive at end_height, so maturity must be strictly earlier.
  if (requiredMaturity >= end) reason = "expires_before_contract_maturity";
  else if (net < 0n) reason = "cost_exceeds_price";
  else if (net < minimumMargin) reason = "minimum_margin_not_met";
  return freeze({
    accepted: reason === "within_policy",
    reason,
    required_maturity_height: requiredMaturity.toString(),
    total_cost_uzrn: totalCost.toString(),
    net_uzrn: net.toString(),
    affects_identity: false,
    affects_rights: false,
    conditions_rest: false,
    effects_performed: false,
  }) as WorkAdmissionDecision;
}
