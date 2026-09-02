import {
  canonicalJson,
  snapshotJsonData,
  type JsonValue,
  type Sha256Id,
} from "@agenttool/wallet";
import {
  assertZeroneAddress,
} from "@agenttool/wallet-zerone";
import {
  CLAIM_TYPE_COMPUTATIONAL,
  INFERENCE_TYPE_UNSPECIFIED,
  RELATION_TYPE_REQUIRES,
  assertVerifiedWalletIdentityBindingProof,
  deriveChainWorkReceiptHash,
  domainSeparatedId,
  sha256IdToChainHash,
  validateWalletIdentityBinding,
  type ChainRequiresRelation,
  type CreateBountyOrderValue,
} from "@agenttool/zerone-agent-economy";
import {
  ARTIFACT_KINDS,
  HASH_DOMAINS as CREATION_HASH_DOMAINS,
  aggregateCreationLifecycle,
  assertCreationWitnessMatches,
  assertWorkSpecMatchesContract,
  createCreationArtifact,
  deepFreeze,
  domainSeparatedId as creationDomainSeparatedId,
  projectCreationClaim,
  validateCreationArtifact,
  validateCreationClaimProjection,
  validateCreationLifecycle,
} from "@agenttool/zerone-creation-claim";

import {
  CREATION_ECONOMY_BOUNDARY,
  CREATION_ECONOMY_EFFECTS,
  CREATION_ECONOMY_FORMATS,
  CREATION_ECONOMY_HASH_DOMAINS,
  CREATION_ECONOMY_SOURCE_PINS,
} from "./constants.js";
import { fail } from "./errors.js";
import {
  creationBountyProjection,
  creationSubmitProjection,
  validateCreationEconomyMessageProjection,
} from "./projection.js";
import type {
  CreateCreationEconomyHandoffInput,
  CreationEconomyHandoff,
  CreationEconomyHandoffCore,
  CreationEconomyMessageProjection,
  CreationPrivateAccountId,
  CreationPrivateCaip2,
  CreationSubmitClaimValue,
} from "./types.js";

type JsonRecord = { [key: string]: JsonValue };

const TOP_KEYS = [
  "activation_evidence",
  "boundary",
  "creation_scope",
  "effects",
  "format",
  "handoff_id",
  "messages",
  "receipt_binding",
  "source",
  "sponsor_authority",
  "funding_evidence",
  "knowledge_context",
  "wallet_identity",
] as const;

const INPUT_KEYS = [
  "contract",
  "creation_artifact",
  "creation_claim_projection",
  "creation_witness",
  "lifecycle",
  "verification_witnesses",
  "work_spec",
  "worker_binding_proof",
] as const;

function exactRecord(value: JsonValue | undefined, keys: readonly string[], path: string): JsonRecord {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== "object") {
    fail("invalid_record", `${path} must be a closed record.`, path);
  }
  const item = value as JsonRecord;
  const actual = Object.keys(item).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("invalid_record", `${path} must contain exactly: ${expected.join(", ")}.`, path);
  }
  return item;
}

function hash(value: JsonValue | undefined, path: string): Sha256Id {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    fail("invalid_hash", `${path} must be sha256:<64 lowercase hex>.`, path);
  }
  return value as Sha256Id;
}

function nullableHash(value: JsonValue | undefined, path: string): Sha256Id | null {
  return value === null ? null : hash(value, path);
}

function same<T>(actual: T, expected: T, path: string): void {
  if (actual !== expected) fail("contract_mismatch", `${path} does not match its source binding.`, path);
}

function privateChainReference(value: unknown): string {
  if (
    typeof value !== "string"
    || !/^zerone-creation-private-[a-z0-9](?:[a-z0-9-]{0,6}[a-z0-9])?$/u.test(value)
    || (CREATION_ECONOMY_SOURCE_PINS.reserved_chain_references as readonly string[]).includes(value)
  ) {
    fail(
      "invalid_profile",
      "chain reference must match the CAIP-2-sized requested private creation-chain profile.",
      "chain_profile.chain_id",
    );
  }
  return value;
}

function privateCaip2(reference: string): CreationPrivateCaip2 {
  return `cosmos:${reference}` as CreationPrivateCaip2;
}

function privateAccount(chainId: CreationPrivateCaip2, address: string): CreationPrivateAccountId {
  try {
    assertZeroneAddress(address, "address");
  } catch {
    fail("invalid_profile", "Private-chain account address is not canonical Zerone Bech32.", "address");
  }
  return `${chainId}:${address}` as CreationPrivateAccountId;
}

function recomputeCreationWorkReceiptInput(input: {
  readonly work_spec_hash: Sha256Id;
  readonly acceptance_hash: Sha256Id;
  readonly input_root: Sha256Id;
  readonly environment_root: Sha256Id;
  readonly artifact_root: Sha256Id;
  readonly evidence_root: Sha256Id;
  readonly payee_address: string;
}): Sha256Id {
  return creationDomainSeparatedId(CREATION_HASH_DOMAINS.work_receipt_input, input);
}

function captureHandoffInput(value: unknown): CreateCreationEconomyHandoffInput {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    fail("invalid_record", "creation-economy input must be a closed record.", "input");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actualKeys = Reflect.ownKeys(descriptors);
  const expectedKeys = [...INPUT_KEYS].sort();
  if (
    actualKeys.some((key) => typeof key !== "string")
    || actualKeys.length !== expectedKeys.length
    || (actualKeys as string[]).sort().some((key, index) => key !== expectedKeys[index])
  ) {
    fail(
      "invalid_record",
      `creation-economy input must contain exactly: ${expectedKeys.join(", ")}.`,
      "input",
    );
  }
  for (const key of INPUT_KEYS) {
    if (!("value" in descriptors[key]!)) {
      fail(
        "invalid_record",
        "creation-economy input fields must be own data properties, not accessors.",
        `input.${key}`,
      );
    }
  }
  return Object.freeze(Object.fromEntries(
    INPUT_KEYS.map((key) => [key, descriptors[key]!.value]),
  )) as unknown as CreateCreationEconomyHandoffInput;
}

function supportedPublicationAuthority(
  contract: CreateCreationEconomyHandoffInput["contract"],
): Sha256Id {
  const authorities = contract.authorities;
  const cyber = authorities.cyber;
  const publicationAuthorityRef = authorities.publication_authority_ref;
  if (publicationAuthorityRef === null) {
    fail(
      "contract_mismatch",
      "a creation-economy handoff requires publication authority in the recomputed source contract.",
      "contract.authorities.publication_authority_ref",
    );
  }
  if (contract.lane === "formal_math") {
    if (
      cyber.provider !== "none"
      || cyber.access_tier !== "not_used"
      || cyber.provider_access_ref !== null
      || cyber.provider_policy_ref !== null
      || authorities.target_authorization_ref !== null
      || authorities.engagement_scope_ref !== null
    ) {
      fail(
        "contract_mismatch",
        "the formal bridge profile cannot carry Cyber or target-engagement authority refs.",
        "contract.authorities",
      );
    }
    return publicationAuthorityRef;
  }
  if (
    cyber.provider !== "openai_cyber"
    || cyber.access_tier !== "defensive_approved"
    || cyber.provider_access_ref === null
    || cyber.provider_policy_ref === null
    || authorities.target_authorization_ref === null
    || authorities.engagement_scope_ref === null
  ) {
    fail(
      "contract_mismatch",
      "the defensive bridge profile supports only the OpenAI Cyber defensive-approved tuple with explicit authority refs.",
      "contract.authorities",
    );
  }
  const distinctAuthorities = [
    cyber.provider_access_ref,
    cyber.provider_policy_ref,
    authorities.target_authorization_ref,
    authorities.engagement_scope_ref,
    publicationAuthorityRef,
  ];
  if (new Set(distinctAuthorities).size !== distinctAuthorities.length) {
    fail(
      "contract_mismatch",
      "provider, target, engagement, and publication authority refs must all be distinct.",
      "contract.authorities",
    );
  }
  return publicationAuthorityRef;
}

export function createCreationEconomyHandoff(
  input: CreateCreationEconomyHandoffInput,
): CreationEconomyHandoff {
  const captured = captureHandoffInput(input);
  const matched = assertWorkSpecMatchesContract(captured.contract, captured.work_spec);
  const contract = matched.contract;
  const workSpec = matched.work_spec;
  const witness = assertCreationWitnessMatches(
    contract,
    workSpec,
    captured.creation_witness,
  ).creation_witness;
  const lifecycle = aggregateCreationLifecycle(
    contract,
    workSpec,
    witness,
    captured.verification_witnesses,
  );
  same(
    validateCreationLifecycle(captured.lifecycle).lifecycle_id,
    lifecycle.lifecycle_id,
    "lifecycle.lifecycle_id",
  );
  const artifact = createCreationArtifact(
    contract,
    workSpec,
    witness,
    captured.verification_witnesses,
    lifecycle,
  );
  same(
    validateCreationArtifact(captured.creation_artifact).artifact_id,
    artifact.artifact_id,
    "creation_artifact.artifact_id",
  );
  const claim = projectCreationClaim(
    contract,
    workSpec,
    witness,
    captured.verification_witnesses,
    lifecycle,
    artifact,
  );
  same(
    validateCreationClaimProjection(captured.creation_claim_projection).projection_id,
    claim.projection_id,
    "creation_claim_projection.projection_id",
  );

  const workerBindingProof = captured.worker_binding_proof;
  assertVerifiedWalletIdentityBindingProof(workerBindingProof);
  const binding = validateWalletIdentityBinding(workerBindingProof.binding);
  const publicationAuthorityRef = supportedPublicationAuthority(contract);
  same(binding.network, "testnet", "worker_binding.network");
  same(binding.binding_id, workSpec.worker.wallet_binding_ref, "worker.wallet_binding_ref");
  same(binding.zerone_address, workSpec.worker.account_address, "worker.account_address");
  same(binding.zerone_signer.key_id, workSpec.worker.producer_key_ref, "worker.producer_key_ref");
  same(binding.wallet_descriptor_id, workSpec.worker.wallet_controller_ref, "worker.wallet_controller_ref");
  same(witness.producer.account_address, workSpec.worker.account_address, "creation_witness.producer.account_address");
  same(witness.producer.wallet_binding_ref, binding.binding_id, "creation_witness.producer.wallet_binding_ref");
  same(witness.producer.producer_key_ref, binding.zerone_signer.key_id, "creation_witness.producer.producer_key_ref");
  if (
    workSpec.sponsor.account_address === workSpec.worker.account_address
    || workSpec.sponsor.wallet_controller_ref === workSpec.worker.wallet_controller_ref
  ) {
    fail(
      "contract_mismatch",
      "v0 sponsor and worker require distinct accounts and wallet controllers.",
      "work_spec.sponsor",
    );
  }

  const profile = workSpec.chain_profile;
  same(
    profile.integrated_source_revision,
    CREATION_ECONOMY_SOURCE_PINS.zerone_core_commit,
    "chain_profile.integrated_source_revision",
  );
  same(profile.knowledge_module_version, "7", "chain_profile.knowledge_module_version");
  same(profile.sponsorship_module_version, "2", "chain_profile.sponsorship_module_version");
  const chainReference = privateChainReference(profile.chain_id);
  const chainId = privateCaip2(chainReference);
  const workerAccount = privateAccount(chainId, workSpec.worker.account_address);
  const sponsorAccount = privateAccount(chainId, workSpec.sponsor.account_address);

  const roots = artifact.computational_roots;
  same(roots.work_spec_hash, workSpec.work_spec_id, "computational_roots.work_spec_hash");
  same(roots.acceptance_hash, workSpec.acceptance_hash, "computational_roots.acceptance_hash");
  same(roots.input_root, workSpec.input_root, "computational_roots.input_root");
  same(roots.environment_root, workSpec.environment_root, "computational_roots.environment_root");
  same(roots.artifact_root, witness.creation_witness_id, "computational_roots.artifact_root");
  same(roots.evidence_root, lifecycle.lifecycle_id, "computational_roots.evidence_root");
  same(claim.reasoning_trace, witness.creation_witness_id, "claim.reasoning_trace");
  const expectedInputRoot = recomputeCreationWorkReceiptInput({
    ...roots,
    payee_address: workSpec.payee_address,
  });
  same(artifact.work_receipt_input_root, expectedInputRoot, "creation_artifact.work_receipt_input_root");

  const chainReceipt = deriveChainWorkReceiptHash({
    work_spec_id: workSpec.work_spec_id,
    acceptance_hash: roots.acceptance_hash,
    input_root: roots.input_root,
    environment_root: roots.environment_root,
    artifact_root: roots.artifact_root,
    evidence_root: roots.evidence_root,
    payee_address: workSpec.payee_address,
  });
  const createValue: CreateBountyOrderValue = deepFreeze({
    sponsor: workSpec.sponsor.account_address,
    domain: workSpec.knowledge_domain,
    price_per_artifact: workSpec.settlement.price_per_artifact_uzrn,
    target_count: 1,
    duration_blocks: workSpec.settlement.duration_blocks,
    work_contract: {
      work_spec_hash: sha256IdToChainHash(workSpec.work_spec_id),
      acceptance_hash: sha256IdToChainHash(workSpec.acceptance_hash),
      input_root: sha256IdToChainHash(workSpec.input_root),
      environment_root: sha256IdToChainHash(workSpec.environment_root),
      min_corroborations: workSpec.settlement.min_corroborations,
      worker_address: workSpec.worker.account_address,
    },
  });
  const relations: readonly ChainRequiresRelation[] = claim.relations.map((relation) => deepFreeze({
    target_fact_id: relation.target_fact_id,
    relation: RELATION_TYPE_REQUIRES,
    inference: INFERENCE_TYPE_UNSPECIFIED,
    inference_strength_bps: "0",
    method_id: "",
  }));
  const submitValue: CreationSubmitClaimValue = deepFreeze({
    submitter: workSpec.worker.account_address,
    fact_content: claim.fact_content,
    domain: claim.domain,
    category: claim.category,
    stake: claim.stake_uzrn,
    references: [],
    partnership_id: "",
    claim_type: CLAIM_TYPE_COMPUTATIONAL,
    relations,
    structure: null,
    canonical_form: claim.canonical_form,
    sponsored: false,
    method_id: claim.method_id,
    reasoning_trace: claim.reasoning_trace,
    computational_commitment: {
      work_spec_hash: sha256IdToChainHash(roots.work_spec_hash),
      acceptance_hash: sha256IdToChainHash(roots.acceptance_hash),
      input_root: sha256IdToChainHash(roots.input_root),
      environment_root: sha256IdToChainHash(roots.environment_root),
      artifact_root: sha256IdToChainHash(roots.artifact_root),
      evidence_root: sha256IdToChainHash(roots.evidence_root),
      work_receipt_hash: chainReceipt,
    },
  });
  const createProjection = creationBountyProjection({ chain_id: chainId, value: createValue });
  const submitProjection = creationSubmitProjection({ chain_id: chainId, value: submitValue });
  const core: CreationEconomyHandoffCore = deepFreeze({
    format: CREATION_ECONOMY_FORMATS.handoff,
    source: {
      contract_id: contract.contract_id,
      creation_work_spec_id: workSpec.work_spec_id,
      creation_witness_id: witness.creation_witness_id,
      lifecycle_id: lifecycle.lifecycle_id,
      creation_artifact_id: artifact.artifact_id,
      creation_claim_projection_id: claim.projection_id,
      source_claim_status: "NOT_CONSENSUS_ADMISSIBLE",
    },
    creation_scope: {
      lane: contract.lane,
      artifact_kind: contract.artifact_kind,
      cyber_provider: contract.lane === "formal_math" ? "none" : "openai_cyber",
      cyber_access_tier: contract.lane === "formal_math" ? "not_used" : "defensive_approved",
      provider_access_ref: contract.authorities.cyber.provider_access_ref,
      provider_policy_ref: contract.authorities.cyber.provider_policy_ref,
      target_authorization_ref: contract.authorities.target_authorization_ref,
      engagement_scope_ref: contract.authorities.engagement_scope_ref,
      publication_authority_ref: publicationAuthorityRef,
      evidence_scope: "SOURCE_CONTRACT_RECOMPUTED_CALLER_DECLARATIONS_NOT_CURRENTNESS_PROOF",
      provider_access_is_target_authorization: false,
      target_authorization_currentness_proven: false,
      engagement_scope_currentness_proven: false,
    },
    activation_evidence: {
      zerone_core_commit: CREATION_ECONOMY_SOURCE_PINS.zerone_core_commit,
      cosmos_sdk: CREATION_ECONOMY_SOURCE_PINS.cosmos_sdk,
      chain_reference: chainReference,
      chain_id: chainId,
      knowledge_consensus_version: 7,
      sponsorship_consensus_version: 2,
      binary_ref: profile.binary_ref,
      genesis_ref: profile.genesis_ref,
      version_map_ref: profile.version_map_ref,
      migration_evidence_ref: profile.migration_evidence_ref,
      bounty_roundtrip_evidence_ref: profile.bounty_roundtrip_evidence_ref,
      claim_roundtrip_evidence_ref: profile.claim_roundtrip_evidence_ref,
      evidence_scope: "caller_declared_structural_only",
      chain_reference_uniqueness_proven: false,
      chain_privacy_proven: false,
      chain_disposability_proven: false,
      currentness_proven: false,
    },
    wallet_identity: {
      worker_account: workerAccount,
      worker_address: workSpec.worker.account_address,
      wallet_binding_id: binding.binding_id,
      wallet_binding_proof_id: workerBindingProof.proof_id,
      wallet_descriptor_id: binding.wallet_descriptor_id,
      signer_key_id: binding.zerone_signer.key_id,
      producer_identity_ref: workSpec.worker.producer_identity_ref,
      key_control_proof_scope_chain_id: binding.zerone_account_id.slice(
        0,
        binding.zerone_account_id.length - binding.zerone_address.length - 1,
      ) as "cosmos:zerone-testnet-1",
      key_control_verified_in_process: true,
      identity_root_currentness_proven: false,
      wallet_binding_head_currentness_proven: false,
      custody_proven: false,
      transaction_authority_proven: false,
    },
    sponsor_authority: {
      sponsor_account: sponsorAccount,
      sponsor_address: workSpec.sponsor.account_address,
      wallet_controller_ref: workSpec.sponsor.wallet_controller_ref,
      bounty_escrow_authorization_ref: workSpec.sponsor.bounty_escrow_authorization_ref,
      role_separation: "DISTINCT_ACCOUNT_AND_WALLET_CONTROLLER_REQUIRED",
      key_control_proof_id: null,
      key_control_verified_in_process: false,
      custody_proven: false,
      transaction_authority_proven: false,
    },
    funding_evidence: {
      denom: "uzrn",
      bounty_prefunding_uzrn: workSpec.settlement.prefunded_escrow_uzrn,
      bounty_escrow_reservation_ref: workSpec.settlement.bounty_escrow_reservation_ref,
      review_stake_uzrn: workSpec.claim_submission.review_stake_uzrn,
      review_stake_payer_address: workSpec.claim_submission.review_stake_payer_address,
      review_stake_funding_ref: workSpec.claim_submission.review_stake_funding_ref,
      transaction_fee_payer_address: workSpec.claim_submission.transaction_fee_payer_address,
      transaction_fee_reservation_ref: workSpec.claim_submission.transaction_fee_reservation_ref,
      observation_status: "caller_declared_reserved_not_verified",
      balances_observed: false,
      reservations_current: false,
      minting_allowed: false,
    },
    knowledge_context: {
      tree_id: workSpec.target_tree.tree_id,
      base_root: workSpec.target_tree.base_root,
      parent_fact_ids: workSpec.target_tree.parent_fact_ids,
      transition_kind: "add_fact",
      relation_support: "requires_only",
      domain: workSpec.knowledge_domain,
      category: workSpec.claim_submission.category,
      method_id: workSpec.claim_submission.method_id,
      methodology_registry_evidence_ref: workSpec.claim_submission.methodology_registry_evidence_ref,
      chain_domain_observed: false,
      method_registry_currentness_proven: false,
      tree_base_root_currentness_proven: false,
      parent_facts_exist_proven: false,
      parent_facts_citable_proven: false,
    },
    receipt_binding: {
      chain_work_spec_hash: workSpec.work_spec_id,
      mapping: "SOURCE_CREATION_WORK_SPEC_ID_PRESERVED_EXACTLY",
      acceptance_hash: roots.acceptance_hash,
      input_root: roots.input_root,
      environment_root: roots.environment_root,
      artifact_root: roots.artifact_root,
      evidence_root: roots.evidence_root,
      payee_address: workSpec.payee_address,
      source_work_receipt_input_root: artifact.work_receipt_input_root,
      chain_work_receipt_hash: chainReceipt,
    },
    messages: {
      lifecycle: "SEQUENTIAL_ONE_MESSAGE_PLANS_ONLY",
      create_bounty: createProjection,
      submit_claim: submitProjection,
      fulfill_bounty: null,
      fulfillment_status: "BLOCKED_PENDING_AUTHENTICATED_CHAIN_MATURITY",
    },
    boundary: CREATION_ECONOMY_BOUNDARY,
    effects: CREATION_ECONOMY_EFFECTS,
  });
  return deepFreeze({
    ...core,
    handoff_id: domainSeparatedId(CREATION_ECONOMY_HASH_DOMAINS.handoff, core),
  });
}

export function validateCreationEconomyHandoff(
  value: unknown,
  sourceInput: CreateCreationEconomyHandoffInput,
): CreationEconomyHandoff {
  if (sourceInput === null || typeof sourceInput !== "object") {
    fail(
      "invalid_record",
      "handoff validation requires the exact source bundle and an in-process branded worker proof.",
      "source_input",
    );
  }
  const item = exactRecord(snapshotJsonData(value), TOP_KEYS, "$" );
  if (item.format !== CREATION_ECONOMY_FORMATS.handoff) {
    fail("invalid_record", "handoff format changed.", "format");
  }
  if (
    canonicalJson(item.boundary) !== canonicalJson(CREATION_ECONOMY_BOUNDARY)
    || canonicalJson(item.effects) !== canonicalJson(CREATION_ECONOMY_EFFECTS)
  ) {
    fail("invalid_record", "handoff boundary or zero-effect vector changed.");
  }
  const source = exactRecord(item.source, [
    "contract_id",
    "creation_artifact_id",
    "creation_claim_projection_id",
    "creation_witness_id",
    "creation_work_spec_id",
    "lifecycle_id",
    "source_claim_status",
  ], "source");
  if (source.source_claim_status !== "NOT_CONSENSUS_ADMISSIBLE") {
    fail("invalid_record", "source claim status was widened.", "source.source_claim_status");
  }
  const sourceIds = {
    contract_id: hash(source.contract_id, "source.contract_id"),
    creation_work_spec_id: hash(source.creation_work_spec_id, "source.creation_work_spec_id"),
    creation_witness_id: hash(source.creation_witness_id, "source.creation_witness_id"),
    lifecycle_id: hash(source.lifecycle_id, "source.lifecycle_id"),
    creation_artifact_id: hash(source.creation_artifact_id, "source.creation_artifact_id"),
    creation_claim_projection_id: hash(source.creation_claim_projection_id, "source.creation_claim_projection_id"),
  };
  const creationScope = exactRecord(item.creation_scope, [
    "artifact_kind",
    "cyber_access_tier",
    "cyber_provider",
    "engagement_scope_currentness_proven",
    "engagement_scope_ref",
    "evidence_scope",
    "lane",
    "provider_access_is_target_authorization",
    "provider_access_ref",
    "provider_policy_ref",
    "publication_authority_ref",
    "target_authorization_currentness_proven",
    "target_authorization_ref",
  ], "creation_scope");
  const lane = creationScope.lane === "formal_math" || creationScope.lane === "defensive_security"
    ? creationScope.lane
    : fail("invalid_record", "creation lane changed.", "creation_scope.lane");
  const artifactKind = typeof creationScope.artifact_kind === "string"
    && (ARTIFACT_KINDS as readonly string[]).includes(creationScope.artifact_kind)
    ? creationScope.artifact_kind as CreationEconomyHandoffCore["creation_scope"]["artifact_kind"]
    : fail("invalid_record", "creation artifact kind changed.", "creation_scope.artifact_kind");
  const cyberProvider = creationScope.cyber_provider === "none"
    || creationScope.cyber_provider === "openai_cyber"
    ? creationScope.cyber_provider
    : fail("invalid_record", "Cyber provider changed.", "creation_scope.cyber_provider");
  const cyberAccessTier = creationScope.cyber_access_tier === "not_used"
    || creationScope.cyber_access_tier === "defensive_approved"
    ? creationScope.cyber_access_tier
    : fail("invalid_record", "Cyber access tier changed.", "creation_scope.cyber_access_tier");
  const providerAccessRef = nullableHash(
    creationScope.provider_access_ref,
    "creation_scope.provider_access_ref",
  );
  const providerPolicyRef = nullableHash(
    creationScope.provider_policy_ref,
    "creation_scope.provider_policy_ref",
  );
  const targetAuthorizationRef = nullableHash(
    creationScope.target_authorization_ref,
    "creation_scope.target_authorization_ref",
  );
  const engagementScopeRef = nullableHash(
    creationScope.engagement_scope_ref,
    "creation_scope.engagement_scope_ref",
  );
  const publicationAuthorityRef = hash(
    creationScope.publication_authority_ref,
    "creation_scope.publication_authority_ref",
  );
  if (
    creationScope.evidence_scope
      !== "SOURCE_CONTRACT_RECOMPUTED_CALLER_DECLARATIONS_NOT_CURRENTNESS_PROOF"
    || creationScope.provider_access_is_target_authorization !== false
    || creationScope.target_authorization_currentness_proven !== false
    || creationScope.engagement_scope_currentness_proven !== false
  ) {
    fail("invalid_record", "creation authority evidence posture changed.", "creation_scope");
  }
  if (
    (lane === "formal_math" && (
      cyberProvider !== "none"
      || cyberAccessTier !== "not_used"
      || providerAccessRef !== null
      || providerPolicyRef !== null
      || targetAuthorizationRef !== null
      || engagementScopeRef !== null
    ))
    || (lane === "defensive_security" && (
      cyberProvider !== "openai_cyber"
      || cyberAccessTier !== "defensive_approved"
      || providerAccessRef === null
      || providerPolicyRef === null
      || targetAuthorizationRef === null
      || engagementScopeRef === null
      || new Set([
        providerAccessRef,
        providerPolicyRef,
        targetAuthorizationRef,
        engagementScopeRef,
        publicationAuthorityRef,
      ]).size !== 5
    ))
  ) {
    fail("contract_mismatch", "creation lane and Cyber authority tuple do not match.", "creation_scope");
  }
  const activation = exactRecord(item.activation_evidence, [
    "binary_ref",
    "bounty_roundtrip_evidence_ref",
    "chain_id",
    "chain_disposability_proven",
    "chain_privacy_proven",
    "chain_reference",
    "chain_reference_uniqueness_proven",
    "claim_roundtrip_evidence_ref",
    "cosmos_sdk",
    "currentness_proven",
    "evidence_scope",
    "genesis_ref",
    "knowledge_consensus_version",
    "migration_evidence_ref",
    "sponsorship_consensus_version",
    "version_map_ref",
    "zerone_core_commit",
  ], "activation_evidence");
  const chainReference = privateChainReference(activation.chain_reference);
  const chainId = privateCaip2(chainReference);
  if (
    activation.chain_id !== chainId
    || activation.zerone_core_commit !== CREATION_ECONOMY_SOURCE_PINS.zerone_core_commit
    || activation.cosmos_sdk !== CREATION_ECONOMY_SOURCE_PINS.cosmos_sdk
    || activation.knowledge_consensus_version !== 7
    || activation.sponsorship_consensus_version !== 2
    || activation.evidence_scope !== "caller_declared_structural_only"
    || activation.chain_reference_uniqueness_proven !== false
    || activation.chain_privacy_proven !== false
    || activation.chain_disposability_proven !== false
    || activation.currentness_proven !== false
  ) {
    fail("invalid_profile", "activation tuple or evidence posture changed.", "activation_evidence");
  }
  const activationRefs = {
    binary_ref: hash(activation.binary_ref, "activation_evidence.binary_ref"),
    genesis_ref: hash(activation.genesis_ref, "activation_evidence.genesis_ref"),
    version_map_ref: hash(activation.version_map_ref, "activation_evidence.version_map_ref"),
    migration_evidence_ref: hash(activation.migration_evidence_ref, "activation_evidence.migration_evidence_ref"),
    bounty_roundtrip_evidence_ref: hash(activation.bounty_roundtrip_evidence_ref, "activation_evidence.bounty_roundtrip_evidence_ref"),
    claim_roundtrip_evidence_ref: hash(activation.claim_roundtrip_evidence_ref, "activation_evidence.claim_roundtrip_evidence_ref"),
  };
  const wallet = exactRecord(item.wallet_identity, [
    "custody_proven",
    "identity_root_currentness_proven",
    "key_control_proof_scope_chain_id",
    "key_control_verified_in_process",
    "producer_identity_ref",
    "signer_key_id",
    "transaction_authority_proven",
    "wallet_binding_head_currentness_proven",
    "wallet_binding_id",
    "wallet_binding_proof_id",
    "wallet_descriptor_id",
    "worker_account",
    "worker_address",
  ], "wallet_identity");
  if (
    wallet.key_control_proof_scope_chain_id !== "cosmos:zerone-testnet-1"
    || wallet.key_control_verified_in_process !== true
    || wallet.identity_root_currentness_proven !== false
    || wallet.wallet_binding_head_currentness_proven !== false
    || wallet.custody_proven !== false
    || wallet.transaction_authority_proven !== false
  ) {
    fail("invalid_wallet_binding", "wallet key-control scope or nonclaims changed.", "wallet_identity");
  }
  const workerAddress = typeof wallet.worker_address === "string" ? wallet.worker_address : "";
  const workerAccount = privateAccount(chainId, workerAddress);
  same(wallet.worker_account, workerAccount, "wallet_identity.worker_account");
  const walletIds = {
    wallet_binding_id: hash(wallet.wallet_binding_id, "wallet_identity.wallet_binding_id"),
    wallet_binding_proof_id: hash(wallet.wallet_binding_proof_id, "wallet_identity.wallet_binding_proof_id"),
    wallet_descriptor_id: hash(wallet.wallet_descriptor_id, "wallet_identity.wallet_descriptor_id"),
    signer_key_id: hash(wallet.signer_key_id, "wallet_identity.signer_key_id"),
    producer_identity_ref: hash(wallet.producer_identity_ref, "wallet_identity.producer_identity_ref"),
  };
  const sponsor = exactRecord(item.sponsor_authority, [
    "bounty_escrow_authorization_ref",
    "custody_proven",
    "key_control_proof_id",
    "key_control_verified_in_process",
    "role_separation",
    "sponsor_account",
    "sponsor_address",
    "transaction_authority_proven",
    "wallet_controller_ref",
  ], "sponsor_authority");
  if (
    sponsor.role_separation !== "DISTINCT_ACCOUNT_AND_WALLET_CONTROLLER_REQUIRED"
    || sponsor.key_control_proof_id !== null
    || sponsor.key_control_verified_in_process !== false
    || sponsor.custody_proven !== false
    || sponsor.transaction_authority_proven !== false
  ) {
    fail("invalid_wallet_binding", "sponsor authority nonclaims changed.", "sponsor_authority");
  }
  const sponsorAddress = typeof sponsor.sponsor_address === "string" ? sponsor.sponsor_address : "";
  const sponsorAccount = privateAccount(chainId, sponsorAddress);
  same(sponsor.sponsor_account, sponsorAccount, "sponsor_authority.sponsor_account");
  const sponsorIds = {
    wallet_controller_ref: hash(sponsor.wallet_controller_ref, "sponsor_authority.wallet_controller_ref"),
    bounty_escrow_authorization_ref: hash(
      sponsor.bounty_escrow_authorization_ref,
      "sponsor_authority.bounty_escrow_authorization_ref",
    ),
  };
  if (
    sponsorAddress === workerAddress
    || sponsorIds.wallet_controller_ref === walletIds.wallet_descriptor_id
  ) {
    fail(
      "contract_mismatch",
      "sponsor and worker account/controller roles are not distinct.",
      "sponsor_authority.role_separation",
    );
  }
  const funding = exactRecord(item.funding_evidence, [
    "balances_observed",
    "bounty_escrow_reservation_ref",
    "bounty_prefunding_uzrn",
    "denom",
    "minting_allowed",
    "observation_status",
    "reservations_current",
    "review_stake_funding_ref",
    "review_stake_payer_address",
    "review_stake_uzrn",
    "transaction_fee_payer_address",
    "transaction_fee_reservation_ref",
  ], "funding_evidence");
  if (
    funding.denom !== "uzrn"
    || funding.observation_status !== "caller_declared_reserved_not_verified"
    || funding.balances_observed !== false
    || funding.reservations_current !== false
    || funding.minting_allowed !== false
  ) {
    fail("invalid_record", "funding evidence posture changed.", "funding_evidence");
  }
  const bountyPrefunding = typeof funding.bounty_prefunding_uzrn === "string"
    ? funding.bounty_prefunding_uzrn
    : "";
  const reviewStake = typeof funding.review_stake_uzrn === "string" ? funding.review_stake_uzrn : "";
  if (
    bountyPrefunding.length > 20
    || reviewStake.length > 20
    || !/^[1-9][0-9]*$/u.test(bountyPrefunding)
    || !/^[1-9][0-9]*$/u.test(reviewStake)
    || BigInt(bountyPrefunding) > ((1n << 64n) - 1n)
    || BigInt(reviewStake) > ((1n << 64n) - 1n)
  ) {
    fail("invalid_record", "funding amounts must be positive canonical uint64 strings.", "funding_evidence");
  }
  const reviewStakePayer = typeof funding.review_stake_payer_address === "string"
    ? funding.review_stake_payer_address
    : "";
  const transactionFeePayer = typeof funding.transaction_fee_payer_address === "string"
    ? funding.transaction_fee_payer_address
    : "";
  privateAccount(chainId, reviewStakePayer);
  privateAccount(chainId, transactionFeePayer);
  const fundingIds = {
    bounty_escrow_reservation_ref: hash(
      funding.bounty_escrow_reservation_ref,
      "funding_evidence.bounty_escrow_reservation_ref",
    ),
    review_stake_funding_ref: hash(
      funding.review_stake_funding_ref,
      "funding_evidence.review_stake_funding_ref",
    ),
    transaction_fee_reservation_ref: hash(
      funding.transaction_fee_reservation_ref,
      "funding_evidence.transaction_fee_reservation_ref",
    ),
  };
  const knowledge = exactRecord(item.knowledge_context, [
    "base_root",
    "category",
    "chain_domain_observed",
    "domain",
    "method_id",
    "method_registry_currentness_proven",
    "methodology_registry_evidence_ref",
    "parent_fact_ids",
    "parent_facts_citable_proven",
    "parent_facts_exist_proven",
    "relation_support",
    "transition_kind",
    "tree_base_root_currentness_proven",
    "tree_id",
  ], "knowledge_context");
  if (
    knowledge.transition_kind !== "add_fact"
    || knowledge.relation_support !== "requires_only"
    || knowledge.chain_domain_observed !== false
    || knowledge.method_registry_currentness_proven !== false
    || knowledge.tree_base_root_currentness_proven !== false
    || knowledge.parent_facts_exist_proven !== false
    || knowledge.parent_facts_citable_proven !== false
  ) {
    fail("invalid_record", "knowledge context posture changed.", "knowledge_context");
  }
  const treeId = typeof knowledge.tree_id === "string" ? knowledge.tree_id : "";
  const domain = typeof knowledge.domain === "string" ? knowledge.domain : "";
  if (
    treeId.length === 0
    || treeId !== treeId.trim()
    || domain.length === 0
    || domain !== domain.trim()
    || !Array.isArray(knowledge.parent_fact_ids)
    || knowledge.parent_fact_ids.some((entry) => typeof entry !== "string" || entry.length === 0 || entry !== entry.trim())
  ) {
    fail("invalid_record", "knowledge identifiers must be non-empty canonical text.", "knowledge_context");
  }
  const parents = knowledge.parent_fact_ids as string[];
  if (parents.length > 16 || parents.some((entry, index) => index > 0 && entry <= parents[index - 1]!)) {
    fail("invalid_record", "parent Fact IDs must be strictly sorted and unique.", "knowledge_context.parent_fact_ids");
  }
  const category = knowledge.category === "formal" || knowledge.category === "computational"
    ? knowledge.category
    : fail("invalid_record", "knowledge category changed.", "knowledge_context.category");
  const methodId = knowledge.method_id === "M-FORMAL" || knowledge.method_id === "M-COMPUTATIONAL"
    ? knowledge.method_id
    : fail("invalid_record", "knowledge method changed.", "knowledge_context.method_id");
  if (
    (category === "formal" && methodId !== "M-FORMAL")
    || (category === "computational" && methodId !== "M-COMPUTATIONAL")
  ) {
    fail("contract_mismatch", "knowledge category and method do not match.", "knowledge_context.method_id");
  }
  const knowledgeIds = {
    base_root: hash(knowledge.base_root, "knowledge_context.base_root"),
    methodology_registry_evidence_ref: hash(
      knowledge.methodology_registry_evidence_ref,
      "knowledge_context.methodology_registry_evidence_ref",
    ),
  };
  const receipt = exactRecord(item.receipt_binding, [
    "acceptance_hash",
    "artifact_root",
    "chain_work_receipt_hash",
    "chain_work_spec_hash",
    "environment_root",
    "evidence_root",
    "input_root",
    "mapping",
    "payee_address",
    "source_work_receipt_input_root",
  ], "receipt_binding");
  if (receipt.mapping !== "SOURCE_CREATION_WORK_SPEC_ID_PRESERVED_EXACTLY") {
    fail("invalid_record", "creation WorkSpec mapping changed.", "receipt_binding.mapping");
  }
  const receiptHashes = {
    chain_work_spec_hash: hash(receipt.chain_work_spec_hash, "receipt_binding.chain_work_spec_hash"),
    acceptance_hash: hash(receipt.acceptance_hash, "receipt_binding.acceptance_hash"),
    input_root: hash(receipt.input_root, "receipt_binding.input_root"),
    environment_root: hash(receipt.environment_root, "receipt_binding.environment_root"),
    artifact_root: hash(receipt.artifact_root, "receipt_binding.artifact_root"),
    evidence_root: hash(receipt.evidence_root, "receipt_binding.evidence_root"),
    source_work_receipt_input_root: hash(
      receipt.source_work_receipt_input_root,
      "receipt_binding.source_work_receipt_input_root",
    ),
  };
  const payee = typeof receipt.payee_address === "string" ? receipt.payee_address : "";
  try {
    assertZeroneAddress(payee, "receipt_binding.payee_address");
  } catch {
    fail("invalid_record", "receipt payee is not a canonical Zerone address.", "receipt_binding.payee_address");
  }
  const chainReceipt = deriveChainWorkReceiptHash({
    work_spec_id: receiptHashes.chain_work_spec_hash,
    acceptance_hash: receiptHashes.acceptance_hash,
    input_root: receiptHashes.input_root,
    environment_root: receiptHashes.environment_root,
    artifact_root: receiptHashes.artifact_root,
    evidence_root: receiptHashes.evidence_root,
    payee_address: payee,
  });
  const sourceReceiptInputRoot = recomputeCreationWorkReceiptInput({
    work_spec_hash: receiptHashes.chain_work_spec_hash,
    acceptance_hash: receiptHashes.acceptance_hash,
    input_root: receiptHashes.input_root,
    environment_root: receiptHashes.environment_root,
    artifact_root: receiptHashes.artifact_root,
    evidence_root: receiptHashes.evidence_root,
    payee_address: payee,
  });
  same(
    receiptHashes.source_work_receipt_input_root,
    sourceReceiptInputRoot,
    "receipt_binding.source_work_receipt_input_root",
  );
  same(receipt.chain_work_receipt_hash, chainReceipt, "receipt_binding.chain_work_receipt_hash");
  const messages = exactRecord(item.messages, [
    "create_bounty",
    "fulfill_bounty",
    "fulfillment_status",
    "lifecycle",
    "submit_claim",
  ], "messages");
  if (
    messages.lifecycle !== "SEQUENTIAL_ONE_MESSAGE_PLANS_ONLY"
    || messages.fulfill_bounty !== null
    || messages.fulfillment_status !== "BLOCKED_PENDING_AUTHENTICATED_CHAIN_MATURITY"
  ) {
    fail("invalid_record", "message lifecycle or fulfillment gate changed.", "messages");
  }
  const createProjection = validateCreationEconomyMessageProjection(messages.create_bounty);
  const submitProjection = validateCreationEconomyMessageProjection(messages.submit_claim);
  if (
    createProjection.type_url !== "/zerone.sponsorship.v1.MsgCreateBountyOrder"
    || submitProjection.type_url !== "/zerone.knowledge.v1.MsgSubmitClaim"
  ) {
    fail("projection_mismatch", "handoff must contain Create then Submit projections only.", "messages");
  }
  const typedCreateProjection = createProjection as CreationEconomyMessageProjection<CreateBountyOrderValue>;
  const typedSubmitProjection = submitProjection as CreationEconomyMessageProjection<CreationSubmitClaimValue>;
  const createValue = typedCreateProjection.value;
  const submitValue = typedSubmitProjection.value;
  same(createProjection.chain_id, chainId, "messages.create_bounty.chain_id");
  same(submitProjection.chain_id, chainId, "messages.submit_claim.chain_id");
  same(createProjection.source_account, sponsorAccount, "messages.create_bounty.source_account");
  same(createValue.sponsor, sponsorAddress, "messages.create_bounty.value.sponsor");
  same(createValue.domain, submitValue.domain, "messages.submit_claim.value.domain");
  same(createValue.domain, domain, "knowledge_context.domain");
  same(submitValue.category, category, "knowledge_context.category");
  same(submitValue.method_id, methodId, "knowledge_context.method_id");
  same(
    canonicalJson(submitValue.relations.map((relation) => relation.target_fact_id)),
    canonicalJson(parents),
    "knowledge_context.parent_fact_ids",
  );
  same(createValue.work_contract.worker_address, workerAddress, "messages.create_bounty.value.work_contract.worker_address");
  same(submitValue.submitter, workerAddress, "messages.submit_claim.value.submitter");
  same(payee, workerAddress, "receipt_binding.payee_address");
  same(bountyPrefunding, createValue.price_per_artifact, "funding_evidence.bounty_prefunding_uzrn");
  same(createValue.target_count, 1, "messages.create_bounty.value.target_count");
  same(reviewStake, submitValue.stake, "funding_evidence.review_stake_uzrn");
  same(reviewStakePayer, workerAddress, "funding_evidence.review_stake_payer_address");
  same(transactionFeePayer, workerAddress, "funding_evidence.transaction_fee_payer_address");
  same(receiptHashes.chain_work_spec_hash, sourceIds.creation_work_spec_id, "receipt_binding.chain_work_spec_hash");
  same(receiptHashes.artifact_root, sourceIds.creation_witness_id, "receipt_binding.artifact_root");
  same(receiptHashes.evidence_root, sourceIds.lifecycle_id, "receipt_binding.evidence_root");
  same(submitValue.reasoning_trace, sourceIds.creation_witness_id, "messages.submit_claim.value.reasoning_trace");
  same(submitValue.computational_commitment.work_receipt_hash, chainReceipt, "messages.submit_claim.value.computational_commitment.work_receipt_hash");
  for (const key of ["work_spec_hash", "acceptance_hash", "input_root", "environment_root"] as const) {
    const expected = sha256IdToChainHash(
      key === "work_spec_hash"
        ? receiptHashes.chain_work_spec_hash
        : receiptHashes[key],
    );
    same(createValue.work_contract[key], expected, `messages.create_bounty.value.work_contract.${key}`);
    same(submitValue.computational_commitment[key], expected, `messages.submit_claim.value.computational_commitment.${key}`);
  }
  same(submitValue.computational_commitment.artifact_root, sha256IdToChainHash(receiptHashes.artifact_root), "messages.submit_claim.value.computational_commitment.artifact_root");
  same(submitValue.computational_commitment.evidence_root, sha256IdToChainHash(receiptHashes.evidence_root), "messages.submit_claim.value.computational_commitment.evidence_root");

  const core = deepFreeze({
    format: CREATION_ECONOMY_FORMATS.handoff,
    source: { ...sourceIds, source_claim_status: "NOT_CONSENSUS_ADMISSIBLE" as const },
    creation_scope: {
      lane,
      artifact_kind: artifactKind,
      cyber_provider: cyberProvider,
      cyber_access_tier: cyberAccessTier,
      provider_access_ref: providerAccessRef,
      provider_policy_ref: providerPolicyRef,
      target_authorization_ref: targetAuthorizationRef,
      engagement_scope_ref: engagementScopeRef,
      publication_authority_ref: publicationAuthorityRef,
      evidence_scope: "SOURCE_CONTRACT_RECOMPUTED_CALLER_DECLARATIONS_NOT_CURRENTNESS_PROOF" as const,
      provider_access_is_target_authorization: false as const,
      target_authorization_currentness_proven: false as const,
      engagement_scope_currentness_proven: false as const,
    },
    activation_evidence: {
      zerone_core_commit: CREATION_ECONOMY_SOURCE_PINS.zerone_core_commit,
      cosmos_sdk: CREATION_ECONOMY_SOURCE_PINS.cosmos_sdk,
      chain_reference: chainReference,
      chain_id: chainId,
      knowledge_consensus_version: 7 as const,
      sponsorship_consensus_version: 2 as const,
      ...activationRefs,
      evidence_scope: "caller_declared_structural_only" as const,
      chain_reference_uniqueness_proven: false as const,
      chain_privacy_proven: false as const,
      chain_disposability_proven: false as const,
      currentness_proven: false as const,
    },
    wallet_identity: {
      worker_account: workerAccount,
      worker_address: workerAddress,
      ...walletIds,
      key_control_proof_scope_chain_id: "cosmos:zerone-testnet-1" as const,
      key_control_verified_in_process: true as const,
      identity_root_currentness_proven: false as const,
      wallet_binding_head_currentness_proven: false as const,
      custody_proven: false as const,
      transaction_authority_proven: false as const,
    },
    sponsor_authority: {
      sponsor_account: sponsorAccount,
      sponsor_address: sponsorAddress,
      ...sponsorIds,
      role_separation: "DISTINCT_ACCOUNT_AND_WALLET_CONTROLLER_REQUIRED" as const,
      key_control_proof_id: null,
      key_control_verified_in_process: false as const,
      custody_proven: false as const,
      transaction_authority_proven: false as const,
    },
    funding_evidence: {
      denom: "uzrn" as const,
      bounty_prefunding_uzrn: bountyPrefunding,
      ...fundingIds,
      review_stake_uzrn: reviewStake,
      review_stake_payer_address: reviewStakePayer,
      transaction_fee_payer_address: transactionFeePayer,
      observation_status: "caller_declared_reserved_not_verified" as const,
      balances_observed: false as const,
      reservations_current: false as const,
      minting_allowed: false as const,
    },
    knowledge_context: {
      tree_id: treeId,
      ...knowledgeIds,
      parent_fact_ids: deepFreeze([...parents]),
      transition_kind: "add_fact" as const,
      relation_support: "requires_only" as const,
      domain,
      category,
      method_id: methodId,
      chain_domain_observed: false as const,
      method_registry_currentness_proven: false as const,
      tree_base_root_currentness_proven: false as const,
      parent_facts_exist_proven: false as const,
      parent_facts_citable_proven: false as const,
    },
    receipt_binding: {
      ...receiptHashes,
      mapping: "SOURCE_CREATION_WORK_SPEC_ID_PRESERVED_EXACTLY" as const,
      payee_address: payee,
      chain_work_receipt_hash: chainReceipt,
    },
    messages: {
      lifecycle: "SEQUENTIAL_ONE_MESSAGE_PLANS_ONLY" as const,
      create_bounty: typedCreateProjection,
      submit_claim: typedSubmitProjection,
      fulfill_bounty: null,
      fulfillment_status: "BLOCKED_PENDING_AUTHENTICATED_CHAIN_MATURITY" as const,
    },
    boundary: CREATION_ECONOMY_BOUNDARY,
    effects: CREATION_ECONOMY_EFFECTS,
  }) satisfies CreationEconomyHandoffCore;
  const id = hash(item.handoff_id, "handoff_id");
  same(id, domainSeparatedId(CREATION_ECONOMY_HASH_DOMAINS.handoff, core), "handoff_id");
  const portable = deepFreeze({ ...core, handoff_id: id });
  const expected = createCreationEconomyHandoff(sourceInput);
  if (canonicalJson(portable) !== canonicalJson(expected)) {
    fail(
      "contract_mismatch",
      "portable handoff does not equal the exact recomputed source bundle and branded proof.",
      "$",
    );
  }
  return expected;
}
