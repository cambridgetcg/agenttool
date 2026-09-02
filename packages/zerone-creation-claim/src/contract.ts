import { compareUnicode, deepFreeze, domainSeparatedId } from "./canonical.js";
import {
  ARTIFACT_KINDS,
  CREATION_LANES,
  CREATION_NONCLAIMS,
  CREATION_OUTCOMES,
  CYBER_ACCESS_TIERS,
  CYBER_PROVIDERS,
  DATASET_ROLES,
  DOWNGRADE_GUARDS,
  FORMATS,
  HASH_DOMAINS,
  INDEPENDENCE_POSTURES,
  MATERIAL_STATUSES,
  MAX_DATASET_SOURCES,
  MAX_RELATIONS,
  MAX_VERIFIERS,
  PARTICIPATION_RIGHTS,
  SETTLEMENT_POSTURES,
  SOURCE_ONLY_BOUNDARY,
  SOURCE_PLANE,
  TOK_POSTURES,
  VERIFICATION_KINDS,
  ZERO_EFFECTS,
  ZERONE_METHOD_IDS,
  ZERONE_METHOD_PROFILES,
} from "./constants.js";
import { fail } from "./errors.js";
import type { JsonValue } from "./canonical.js";
import type {
  ChainProfile,
  CreateCreationContractInput,
  CreateCreationWorkSpecInput,
  CreationContract,
  CreationContractCore,
  CreationWorkSpec,
  CreationWorkSpecCore,
  DatasetSourceBinding,
  HfRunTuple,
  OutcomeRoute,
  ResourceCounters,
  VerificationKind,
  VerificationRequirement,
} from "./types.js";
import {
  arrayValue,
  assertSame,
  assertStrictlySortedUnique,
  booleanValue,
  enumValue,
  exactKeys,
  identifier,
  literal,
  nullableSha256,
  record,
  sha256,
  snapshotRecord,
  sortedUniqueIdentifiers,
  sourceRevision,
  uint64,
  withoutKeys,
  zeroneAddress,
} from "./validation.js";

const CONTRACT_CORE_KEYS = [
  "_format",
  "acceptance_hash",
  "artifact_kind",
  "authorities",
  "boundary",
  "claim_policy",
  "effects",
  "execution",
  "hf_run",
  "input_root",
  "lane",
  "math_card",
  "nonclaims",
  "outcome_routes",
  "source_plane",
  "target",
] as const;

const WORK_SPEC_CORE_KEYS = [
  "_format",
  "acceptance_hash",
  "boundary",
  "chain_profile",
  "claim_submission",
  "contract_id",
  "downgrade_guards",
  "effects",
  "environment_root",
  "fulfillment_caller_address",
  "input_root",
  "knowledge_domain",
  "participation",
  "payee_address",
  "resource_limits",
  "settlement",
  "sponsor",
  "target_tree",
  "worker",
] as const;

function parseDatasetSource(value: JsonValue | undefined, path: string): DatasetSourceBinding {
  const item = record(value, path);
  exactKeys(item, [
    "admission_ref",
    "content_root",
    "license_evidence_ref",
    "material_status",
    "repository_ref",
    "revision",
    "role",
  ], path);
  const role = enumValue(item.role, DATASET_ROLES, `${path}.role`);
  const materialStatus = enumValue(item.material_status, MATERIAL_STATUSES, `${path}.material_status`);
  if (materialStatus === "metadata_only" && role !== "reference_only") {
    fail(
      "invalid_record",
      "metadata-only observations cannot become train, validation, or sealed-evaluation material",
      `${path}.material_status`,
    );
  }
  return deepFreeze({
    repository_ref: sha256(item.repository_ref, `${path}.repository_ref`),
    revision: sourceRevision(item.revision, `${path}.revision`),
    content_root: sha256(item.content_root, `${path}.content_root`),
    admission_ref: sha256(item.admission_ref, `${path}.admission_ref`),
    license_evidence_ref: sha256(item.license_evidence_ref, `${path}.license_evidence_ref`),
    role,
    material_status: materialStatus,
  }) as DatasetSourceBinding;
}

function datasetSortKey(item: DatasetSourceBinding): string {
  return `${item.repository_ref}/${item.revision}`;
}

function parseHfRun(value: JsonValue | undefined, path: string): HfRunTuple {
  const item = record(value, path);
  exactKeys(item, [
    "checkpoint_ref",
    "dataset_sources",
    "mixture_weights_ref",
    "optimizer_ref",
    "order_ref",
    "presentation_multiplicity_ref",
    "role_manifest_ref",
    "seed_policy_ref",
    "split_manifest_ref",
    "tokenizer_ref",
    "training_input_roots",
    "transform_manifest_ref",
  ], path);
  const sources = arrayValue(item.dataset_sources, `${path}.dataset_sources`, 0, MAX_DATASET_SOURCES)
    .map((entry, index) => parseDatasetSource(entry, `${path}.dataset_sources[${String(index)}]`));
  const keys = sources.map(datasetSortKey);
  assertStrictlySortedUnique(keys, `${path}.dataset_sources`);
  if (new Set(sources.map((source) => source.content_root)).size !== sources.length) {
    fail("invalid_record", `${path}.dataset_sources must not reuse a content root across roles`, path);
  }

  const trainingInputRoots = arrayValue(
    item.training_input_roots,
    `${path}.training_input_roots`,
    0,
    MAX_DATASET_SOURCES,
  ).map((entry, index) => sha256(entry, `${path}.training_input_roots[${String(index)}]`));
  assertStrictlySortedUnique(trainingInputRoots, `${path}.training_input_roots`);
  const expectedTrainingRoots = sources
    .filter((source) => source.role === "train")
    .map((source) => source.content_root)
    .sort(compareUnicode);
  if (
    trainingInputRoots.length !== expectedTrainingRoots.length
    || trainingInputRoots.some((root, index) => root !== expectedTrainingRoots[index])
  ) {
    fail(
      "invalid_record",
      "training_input_roots must equal exactly the material-bound train source roots; sealed evaluation and metadata-only observations stay out",
      `${path}.training_input_roots`,
    );
  }
  return deepFreeze({
    dataset_sources: sources,
    training_input_roots: trainingInputRoots,
    split_manifest_ref: sha256(item.split_manifest_ref, `${path}.split_manifest_ref`),
    role_manifest_ref: sha256(item.role_manifest_ref, `${path}.role_manifest_ref`),
    transform_manifest_ref: sha256(item.transform_manifest_ref, `${path}.transform_manifest_ref`),
    tokenizer_ref: sha256(item.tokenizer_ref, `${path}.tokenizer_ref`),
    presentation_multiplicity_ref: sha256(
      item.presentation_multiplicity_ref,
      `${path}.presentation_multiplicity_ref`,
    ),
    mixture_weights_ref: sha256(item.mixture_weights_ref, `${path}.mixture_weights_ref`),
    order_ref: sha256(item.order_ref, `${path}.order_ref`),
    optimizer_ref: sha256(item.optimizer_ref, `${path}.optimizer_ref`),
    seed_policy_ref: sha256(item.seed_policy_ref, `${path}.seed_policy_ref`),
    checkpoint_ref: sha256(item.checkpoint_ref, `${path}.checkpoint_ref`),
  }) as HfRunTuple;
}

function verificationIndex(kind: VerificationKind): number {
  return VERIFICATION_KINDS.indexOf(kind);
}

function parseRequirement(value: JsonValue | undefined, path: string): VerificationRequirement {
  const item = record(value, path);
  exactKeys(item, ["independence", "kind", "minimum_passes", "policy_ref"], path);
  return deepFreeze({
    kind: enumValue(item.kind, VERIFICATION_KINDS, `${path}.kind`),
    minimum_passes: uint64(item.minimum_passes, `${path}.minimum_passes`, {
      positive: true,
      maximum: 16n,
    }),
    independence: enumValue(item.independence, INDEPENDENCE_POSTURES, `${path}.independence`),
    policy_ref: sha256(item.policy_ref, `${path}.policy_ref`),
  }) as VerificationRequirement;
}

function parseRoute(value: JsonValue | undefined, path: string): OutcomeRoute {
  const item = record(value, path);
  exactKeys(item, ["outcome", "requirements", "settlement_posture", "tok_posture"], path);
  const requirements = arrayValue(item.requirements, `${path}.requirements`, 0, VERIFICATION_KINDS.length)
    .map((entry, index) => parseRequirement(entry, `${path}.requirements[${String(index)}]`));
  for (let index = 1; index < requirements.length; index += 1) {
    if (verificationIndex(requirements[index - 1]!.kind) >= verificationIndex(requirements[index]!.kind)) {
      fail("invalid_record", `${path}.requirements must follow the frozen verification-kind order without duplicates`);
    }
  }
  const tokPosture = enumValue(item.tok_posture, TOK_POSTURES, `${path}.tok_posture`);
  const settlementPosture = enumValue(
    item.settlement_posture,
    SETTLEMENT_POSTURES,
    `${path}.settlement_posture`,
  );
  if (tokPosture === "offchain_only" && settlementPosture !== "not_requested") {
    fail("invalid_record", "off-chain-only outcomes cannot request settlement activation", `${path}.settlement_posture`);
  }
  return deepFreeze({
    outcome: enumValue(item.outcome, CREATION_OUTCOMES, `${path}.outcome`),
    tok_posture: tokPosture,
    settlement_posture: settlementPosture,
    requirements,
  }) as OutcomeRoute;
}

function assertCreationVerificationFloor(
  lane: CreationContractCore["lane"],
  artifactKind: CreationContractCore["artifact_kind"],
  route: OutcomeRoute,
  path: string,
): void {
  if (route.tok_posture !== "digest_fact_candidate") return;
  const minimumWitnesses = route.requirements.reduce(
    (total, requirement) => total + BigInt(requirement.minimum_passes),
    0n,
  );
  if (minimumWitnesses > BigInt(MAX_VERIFIERS)) {
    fail(
      "invalid_record",
      `${path} requires more witnesses than the bounded verification set can carry`,
      path,
    );
  }
  const kinds = new Set(route.requirements.map((entry) => entry.kind));
  const required = ["semantic_fidelity", "prior_art_scope", "independent_reproduction"] as VerificationKind[];
  if (["formal_result", "counterexample", "security_invariant"].includes(artifactKind)) {
    required.push("formal_validity");
  } else {
    required.push("functional_validation");
  }
  if (lane === "defensive_security") required.push("authorization_currentness", "security_boundary");
  for (const kind of required) {
    if (!kinds.has(kind)) {
      fail("invalid_record", `${path} is missing required ${kind} verification`, path);
    }
  }
  const independent = route.requirements.find((entry) => entry.kind === "independent_reproduction");
  if (independent?.independence !== "distinct_from_producer_required") {
    fail("invalid_record", `${path} must require a producer-distinct reproduction`, path);
  }
}

export function validateCreationContractCore(value: unknown): CreationContractCore {
  const item = snapshotRecord(value);
  exactKeys(item, CONTRACT_CORE_KEYS, "$");
  if (item._format !== FORMATS.contract) {
    fail("invalid_record", `_format must be ${FORMATS.contract}`, "$._format");
  }
  const lane = enumValue(item.lane, CREATION_LANES, "$.lane");
  const artifactKind = enumValue(item.artifact_kind, ARTIFACT_KINDS, "$.artifact_kind");
  const claimPolicy = record(item.claim_policy, "$.claim_policy");
  exactKeys(claimPolicy, [
    "category",
    "max_review_stake_uzrn",
    "method_id",
    "methodology_observation_status",
    "methodology_registry_evidence_ref",
  ], "$.claim_policy");
  const expectedMethodProfile = ZERONE_METHOD_PROFILES[lane];
  const claimCategory = enumValue(
    claimPolicy.category,
    ["computational", "formal"] as const,
    "$.claim_policy.category",
  );
  const claimMethodId = enumValue(claimPolicy.method_id, ZERONE_METHOD_IDS, "$.claim_policy.method_id");
  if (
    claimCategory !== expectedMethodProfile.category
    || claimMethodId !== expectedMethodProfile.method_id
  ) {
    fail(
      "invalid_record",
      `${lane} must use the pinned ${expectedMethodProfile.category}/${expectedMethodProfile.method_id} Zerone methodology profile`,
      "$.claim_policy",
    );
  }
  if (claimPolicy.methodology_observation_status !== "caller_declared_not_verified") {
    fail(
      "invalid_record",
      "methodology registry evidence remains caller-declared until an authenticated activation query",
      "$.claim_policy.methodology_observation_status",
    );
  }
  const normalizedClaimPolicy = deepFreeze({
    category: claimCategory,
    method_id: claimMethodId,
    methodology_registry_evidence_ref: sha256(
      claimPolicy.methodology_registry_evidence_ref,
      "$.claim_policy.methodology_registry_evidence_ref",
    ),
    methodology_observation_status: "caller_declared_not_verified" as const,
    max_review_stake_uzrn: uint64(
      claimPolicy.max_review_stake_uzrn,
      "$.claim_policy.max_review_stake_uzrn",
      { positive: true },
    ),
  });

  const mathCard = record(item.math_card, "$.math_card");
  exactKeys(mathCard, ["assessment_id", "assessment_status", "card_id", "validation_ref"], "$.math_card");
  if (mathCard.assessment_status !== "ready_for_bounded_inquiry") {
    fail("invalid_record", "Math Card assessment must be ready_for_bounded_inquiry", "$.math_card.assessment_status");
  }

  const target = record(item.target, "$.target");
  exactKeys(target, [
    "baseline_ref",
    "object_ref",
    "prior_art_cutoff_ref",
    "prior_art_scope_ref",
    "status_evidence_ref",
  ], "$.target");

  const authorities = record(item.authorities, "$.authorities");
  exactKeys(authorities, [
    "compute_ref",
    "cyber",
    "data_use_ref",
    "engagement_scope_ref",
    "publication_authority_ref",
    "target_authorization_ref",
  ], "$.authorities");
  const cyber = record(authorities.cyber, "$.authorities.cyber");
  exactKeys(cyber, ["access_tier", "provider", "provider_access_ref", "provider_policy_ref"], "$.authorities.cyber");
  const provider = enumValue(cyber.provider, CYBER_PROVIDERS, "$.authorities.cyber.provider");
  const accessTier = enumValue(cyber.access_tier, CYBER_ACCESS_TIERS, "$.authorities.cyber.access_tier");
  const providerAccessRef = nullableSha256(cyber.provider_access_ref, "$.authorities.cyber.provider_access_ref");
  const providerPolicyRef = nullableSha256(cyber.provider_policy_ref, "$.authorities.cyber.provider_policy_ref");
  if (provider === "none") {
    if (accessTier !== "not_used" || providerAccessRef !== null || providerPolicyRef !== null) {
      fail("invalid_record", "unused Cyber access must carry no provider refs", "$.authorities.cyber");
    }
  } else if (accessTier === "not_used" || providerAccessRef === null || providerPolicyRef === null) {
    fail("invalid_record", "used Cyber access requires an exact tier, access ref, and policy ref", "$.authorities.cyber");
  }
  if (lane === "formal_math" && provider !== "none") {
    fail("invalid_record", "formal_math and Cyber provider access are separate lanes", "$.authorities.cyber.provider");
  }
  const targetAuthorizationRef = nullableSha256(
    authorities.target_authorization_ref,
    "$.authorities.target_authorization_ref",
  );
  const engagementScopeRef = nullableSha256(authorities.engagement_scope_ref, "$.authorities.engagement_scope_ref");
  if (lane === "defensive_security" && (targetAuthorizationRef === null || engagementScopeRef === null)) {
    fail("invalid_record", "defensive security requires separate target authorization and engagement scope refs", "$.authorities");
  }
  if (
    targetAuthorizationRef !== null
    && (targetAuthorizationRef === providerAccessRef || targetAuthorizationRef === providerPolicyRef)
  ) {
    fail("invalid_record", "provider access or policy cannot substitute for target authorization", "$.authorities");
  }
  if (lane === "defensive_security") {
    const authorityRefs = [targetAuthorizationRef, engagementScopeRef, providerAccessRef, providerPolicyRef]
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    if (new Set(authorityRefs).size !== authorityRefs.length) {
      fail(
        "invalid_record",
        "target authorization, engagement scope, provider access, and provider policy refs must be distinct",
        "$.authorities",
      );
    }
  }

  const execution = record(item.execution, "$.execution");
  exactKeys(execution, [
    "disclosure_policy_ref",
    "environment_root",
    "isolation_policy_ref",
    "model_ref",
    "toolchain_ref",
  ], "$.execution");

  const routes = arrayValue(item.outcome_routes, "$.outcome_routes", CREATION_OUTCOMES.length, CREATION_OUTCOMES.length)
    .map((entry, index) => parseRoute(entry, `$.outcome_routes[${String(index)}]`));
  for (let index = 0; index < CREATION_OUTCOMES.length; index += 1) {
    if (routes[index]!.outcome !== CREATION_OUTCOMES[index]) {
      fail("invalid_record", "outcome_routes must contain every outcome exactly once in frozen order", "$.outcome_routes");
    }
    assertCreationVerificationFloor(lane, artifactKind, routes[index]!, `$.outcome_routes[${String(index)}]`);
  }
  if (!routes.some((route) => route.tok_posture === "digest_fact_candidate")) {
    fail("invalid_record", "a creation contract must name at least one bounded ToK candidate route", "$.outcome_routes");
  }
  const stopRoute = routes[CREATION_OUTCOMES.indexOf("resource_or_participation_stop")]!;
  if (stopRoute.tok_posture !== "offchain_only" || stopRoute.settlement_posture !== "not_requested") {
    fail("invalid_record", "resource or participation stop must remain an honest off-chain terminal", "$.outcome_routes");
  }

  const hfRun = parseHfRun(item.hf_run, "$.hf_run");
  const normalizedTarget = deepFreeze({
    object_ref: sha256(target.object_ref, "$.target.object_ref"),
    baseline_ref: sha256(target.baseline_ref, "$.target.baseline_ref"),
    status_evidence_ref: sha256(target.status_evidence_ref, "$.target.status_evidence_ref"),
    prior_art_scope_ref: sha256(target.prior_art_scope_ref, "$.target.prior_art_scope_ref"),
    prior_art_cutoff_ref: sha256(target.prior_art_cutoff_ref, "$.target.prior_art_cutoff_ref"),
  });
  const normalizedMathCard = deepFreeze({
    card_id: sha256(mathCard.card_id, "$.math_card.card_id"),
    assessment_id: sha256(mathCard.assessment_id, "$.math_card.assessment_id"),
    assessment_status: "ready_for_bounded_inquiry" as const,
    validation_ref: sha256(mathCard.validation_ref, "$.math_card.validation_ref"),
  });
  const normalizedAuthorities = deepFreeze({
    data_use_ref: sha256(authorities.data_use_ref, "$.authorities.data_use_ref"),
    compute_ref: sha256(authorities.compute_ref, "$.authorities.compute_ref"),
    publication_authority_ref: nullableSha256(
      authorities.publication_authority_ref,
      "$.authorities.publication_authority_ref",
    ),
    target_authorization_ref: targetAuthorizationRef,
    engagement_scope_ref: engagementScopeRef,
    cyber: {
      provider,
      access_tier: accessTier,
      provider_access_ref: providerAccessRef,
      provider_policy_ref: providerPolicyRef,
    },
  });
  const normalizedExecution = deepFreeze({
    model_ref: sha256(execution.model_ref, "$.execution.model_ref"),
    toolchain_ref: sha256(execution.toolchain_ref, "$.execution.toolchain_ref"),
    environment_root: sha256(execution.environment_root, "$.execution.environment_root"),
    isolation_policy_ref: sha256(execution.isolation_policy_ref, "$.execution.isolation_policy_ref"),
    disclosure_policy_ref: sha256(execution.disclosure_policy_ref, "$.execution.disclosure_policy_ref"),
  });

  const expectedInputRoot = domainSeparatedId(HASH_DOMAINS.input_root, {
    target: normalizedTarget,
    hf_run: hfRun,
  });
  const expectedAcceptanceHash = domainSeparatedId(HASH_DOMAINS.acceptance, {
    lane,
    artifact_kind: artifactKind,
    claim_policy: normalizedClaimPolicy,
    math_card: normalizedMathCard,
    authorities: normalizedAuthorities,
    outcome_routes: routes,
  });
  assertSame(sha256(item.input_root, "$.input_root"), expectedInputRoot, "$.input_root");
  assertSame(sha256(item.acceptance_hash, "$.acceptance_hash"), expectedAcceptanceHash, "$.acceptance_hash");
  literal(item.source_plane, SOURCE_PLANE, "$.source_plane");
  literal(item.nonclaims, CREATION_NONCLAIMS, "$.nonclaims");
  literal(item.boundary, SOURCE_ONLY_BOUNDARY, "$.boundary");
  literal(item.effects, ZERO_EFFECTS, "$.effects");

  return deepFreeze({
    _format: FORMATS.contract,
    lane,
    artifact_kind: artifactKind,
    claim_policy: normalizedClaimPolicy,
    math_card: normalizedMathCard,
    target: normalizedTarget,
    hf_run: hfRun,
    authorities: normalizedAuthorities,
    execution: normalizedExecution,
    outcome_routes: routes,
    input_root: expectedInputRoot,
    acceptance_hash: expectedAcceptanceHash,
    source_plane: SOURCE_PLANE,
    nonclaims: CREATION_NONCLAIMS,
    boundary: SOURCE_ONLY_BOUNDARY,
    effects: ZERO_EFFECTS,
  }) as CreationContractCore;
}

export function createCreationContract(input: CreateCreationContractInput): CreationContract {
  const safe = snapshotRecord(input);
  const inputRoot = domainSeparatedId(HASH_DOMAINS.input_root, {
    target: safe.target,
    hf_run: safe.hf_run,
  });
  const acceptanceHash = domainSeparatedId(HASH_DOMAINS.acceptance, {
    lane: safe.lane,
    artifact_kind: safe.artifact_kind,
    claim_policy: safe.claim_policy,
    math_card: safe.math_card,
    authorities: safe.authorities,
    outcome_routes: safe.outcome_routes,
  });
  const core = validateCreationContractCore({
    ...safe,
    _format: FORMATS.contract,
    input_root: inputRoot,
    acceptance_hash: acceptanceHash,
    source_plane: SOURCE_PLANE,
    nonclaims: CREATION_NONCLAIMS,
    boundary: SOURCE_ONLY_BOUNDARY,
    effects: ZERO_EFFECTS,
  });
  return deepFreeze({
    ...core,
    contract_id: domainSeparatedId(HASH_DOMAINS.contract, core),
  }) as CreationContract;
}

export function validateCreationContract(value: unknown): CreationContract {
  const item = snapshotRecord(value);
  exactKeys(item, [...CONTRACT_CORE_KEYS, "contract_id"], "$");
  const core = validateCreationContractCore(withoutKeys(item, ["contract_id"]));
  const id = sha256(item.contract_id, "$.contract_id");
  assertSame(id, domainSeparatedId(HASH_DOMAINS.contract, core), "$.contract_id", "contract_id does not match canonical contract bytes");
  return deepFreeze({ ...core, contract_id: id }) as CreationContract;
}

function parseChainProfile(value: JsonValue | undefined, path: string): ChainProfile {
  const item = record(value, path);
  exactKeys(item, [
    "binary_ref",
    "bounty_roundtrip_evidence_ref",
    "chain_id",
    "claim_roundtrip_evidence_ref",
    "genesis_ref",
    "integrated_source_revision",
    "knowledge_module_version",
    "migration_evidence_ref",
    "observation_status",
    "private_disposable_chain_declared",
    "sponsorship_module_version",
    "version_map_ref",
  ], path);
  if (item.knowledge_module_version !== "7" || item.sponsorship_module_version !== "2") {
    fail("invalid_record", "creation settlement requires knowledge v7 and sponsorship v2", path);
  }
  if (item.private_disposable_chain_declared !== true) {
    fail("invalid_record", "v0 handoff is limited to a private disposable chain", `${path}.private_disposable_chain_declared`);
  }
  if (item.observation_status !== "caller_declared_not_verified") {
    fail("invalid_record", "chain observations remain caller-declared", `${path}.observation_status`);
  }
  return deepFreeze({
    chain_id: identifier(item.chain_id, `${path}.chain_id`),
    integrated_source_revision: sourceRevision(item.integrated_source_revision, `${path}.integrated_source_revision`),
    knowledge_module_version: "7",
    sponsorship_module_version: "2",
    binary_ref: sha256(item.binary_ref, `${path}.binary_ref`),
    genesis_ref: sha256(item.genesis_ref, `${path}.genesis_ref`),
    version_map_ref: sha256(item.version_map_ref, `${path}.version_map_ref`),
    migration_evidence_ref: sha256(item.migration_evidence_ref, `${path}.migration_evidence_ref`),
    bounty_roundtrip_evidence_ref: sha256(
      item.bounty_roundtrip_evidence_ref,
      `${path}.bounty_roundtrip_evidence_ref`,
    ),
    claim_roundtrip_evidence_ref: sha256(
      item.claim_roundtrip_evidence_ref,
      `${path}.claim_roundtrip_evidence_ref`,
    ),
    private_disposable_chain_declared: true,
    observation_status: "caller_declared_not_verified",
  }) as ChainProfile;
}

export function parseResourceCounters(
  value: JsonValue | undefined,
  path: string,
  positiveCompute = false,
): ResourceCounters {
  const item = record(value, path);
  exactKeys(item, [
    "accelerator_millis",
    "compute_millis",
    "input_bytes",
    "memory_byte_millis",
    "output_bytes",
  ], path);
  return deepFreeze({
    compute_millis: uint64(item.compute_millis, `${path}.compute_millis`, { positive: positiveCompute }),
    accelerator_millis: uint64(item.accelerator_millis, `${path}.accelerator_millis`),
    memory_byte_millis: uint64(item.memory_byte_millis, `${path}.memory_byte_millis`, { positive: positiveCompute }),
    input_bytes: uint64(item.input_bytes, `${path}.input_bytes`, { positive: positiveCompute }),
    output_bytes: uint64(item.output_bytes, `${path}.output_bytes`, { positive: positiveCompute }),
  }) as ResourceCounters;
}

export function validateCreationWorkSpecCore(value: unknown): CreationWorkSpecCore {
  const item = snapshotRecord(value);
  exactKeys(item, WORK_SPEC_CORE_KEYS, "$");
  if (item._format !== FORMATS.work_spec) fail("invalid_record", `_format must be ${FORMATS.work_spec}`, "$._format");
  const sponsor = record(item.sponsor, "$.sponsor");
  exactKeys(sponsor, [
    "account_address",
    "bounty_escrow_authorization_ref",
    "wallet_controller_ref",
  ], "$.sponsor");
  const sponsorWalletControllerRef = sha256(
    sponsor.wallet_controller_ref,
    "$.sponsor.wallet_controller_ref",
  );
  const bountyEscrowAuthorizationRef = sha256(
    sponsor.bounty_escrow_authorization_ref,
    "$.sponsor.bounty_escrow_authorization_ref",
  );
  if (sponsorWalletControllerRef === bountyEscrowAuthorizationRef) {
    fail(
      "invalid_record",
      "sponsor wallet control cannot substitute for bounty escrow spend authorization",
      "$.sponsor",
    );
  }
  const worker = record(item.worker, "$.worker");
  exactKeys(worker, [
    "account_address",
    "binding_claim",
    "producer_identity_ref",
    "producer_key_ref",
    "wallet_binding_ref",
    "wallet_controller_ref",
  ], "$.worker");
  if (worker.binding_claim !== "KEY_CONTROL_ONLY_NOT_IDENTITY_AUTHORSHIP_CONSENT_OR_AUTHORITY") {
    fail("invalid_record", "wallet binding can claim key control only", "$.worker.binding_claim");
  }
  const workerAddress = zeroneAddress(worker.account_address, "$.worker.account_address");
  const payeeAddress = zeroneAddress(item.payee_address, "$.payee_address");
  const fulfillmentAddress = zeroneAddress(item.fulfillment_caller_address, "$.fulfillment_caller_address");
  if (workerAddress !== payeeAddress || workerAddress !== fulfillmentAddress) {
    fail(
      "contract_mismatch",
      "assigned worker, producer, payee, and intended fulfillment caller must remain the same account",
      "$.worker.account_address",
    );
  }
  const claimSubmission = record(item.claim_submission, "$.claim_submission");
  exactKeys(claimSubmission, [
    "category",
    "funding_observation_status",
    "method_id",
    "methodology_registry_evidence_ref",
    "review_stake_uzrn",
    "review_stake_funding_ref",
    "review_stake_payer_address",
    "transaction_fee_payer_address",
    "transaction_fee_reservation_ref",
  ], "$.claim_submission");
  const submissionCategory = enumValue(
    claimSubmission.category,
    ["computational", "formal"] as const,
    "$.claim_submission.category",
  );
  const submissionMethodId = enumValue(
    claimSubmission.method_id,
    ZERONE_METHOD_IDS,
    "$.claim_submission.method_id",
  );
  const methodProfile = Object.values(ZERONE_METHOD_PROFILES)
    .find((profile) => profile.method_id === submissionMethodId);
  if (methodProfile?.category !== submissionCategory) {
    fail("invalid_record", "claim category must match the pinned Zerone methodology", "$.claim_submission");
  }
  const reviewStakePayer = zeroneAddress(
    claimSubmission.review_stake_payer_address,
    "$.claim_submission.review_stake_payer_address",
  );
  if (reviewStakePayer !== workerAddress) {
    fail(
      "contract_mismatch",
      "the assigned worker/submitter must remain the non-refundable review-stake payer",
      "$.claim_submission.review_stake_payer_address",
    );
  }
  const transactionFeePayer = zeroneAddress(
    claimSubmission.transaction_fee_payer_address,
    "$.claim_submission.transaction_fee_payer_address",
  );
  if (transactionFeePayer !== workerAddress) {
    fail(
      "contract_mismatch",
      "v0 requires the worker to remain the transaction-fee payer; fee grants need a separate adapter review",
      "$.claim_submission.transaction_fee_payer_address",
    );
  }
  const reviewStakeFundingRef = sha256(
    claimSubmission.review_stake_funding_ref,
    "$.claim_submission.review_stake_funding_ref",
  );
  const transactionFeeReservationRef = sha256(
    claimSubmission.transaction_fee_reservation_ref,
    "$.claim_submission.transaction_fee_reservation_ref",
  );
  if (reviewStakeFundingRef === transactionFeeReservationRef) {
    fail(
      "invalid_record",
      "claim stake funding and transaction fee reservation require distinct evidence refs",
      "$.claim_submission",
    );
  }
  if (claimSubmission.funding_observation_status !== "caller_declared_reserved_not_verified") {
    fail(
      "invalid_record",
      "claim funding remains caller-declared until activation-time balance and reservation checks",
      "$.claim_submission.funding_observation_status",
    );
  }
  const tree = record(item.target_tree, "$.target_tree");
  exactKeys(tree, ["base_root", "parent_fact_ids", "relation_support", "transition_kind", "tree_id"], "$.target_tree");
  if (tree.transition_kind !== "add_fact" || tree.relation_support !== "requires_only") {
    fail("invalid_record", "v0 can only add one Fact with lossless REQUIRES parents", "$.target_tree");
  }
  const settlement = record(item.settlement, "$.settlement");
  exactKeys(settlement, [
    "bounty_escrow_reservation_ref",
    "denom",
    "duration_blocks",
    "funding_observation_status",
    "min_corroborations",
    "minting_allowed",
    "prefunded_escrow_required",
    "prefunded_escrow_uzrn",
    "price_per_artifact_uzrn",
    "target_count",
  ], "$.settlement");
  if (
    settlement.denom !== "uzrn"
    || settlement.target_count !== "1"
    || settlement.prefunded_escrow_required !== true
    || settlement.minting_allowed !== false
  ) {
    fail("invalid_record", "settlement is one prefunded uzrn artifact with no mint path", "$.settlement");
  }
  const pricePerArtifact = uint64(
    settlement.price_per_artifact_uzrn,
    "$.settlement.price_per_artifact_uzrn",
    { positive: true },
  );
  const prefundedEscrow = uint64(
    settlement.prefunded_escrow_uzrn,
    "$.settlement.prefunded_escrow_uzrn",
    { positive: true },
  );
  if (prefundedEscrow !== pricePerArtifact) {
    fail(
      "contract_mismatch",
      "prefunded escrow must equal price_per_artifact_uzrn multiplied by the v0 target_count of one",
      "$.settlement.prefunded_escrow_uzrn",
    );
  }
  const bountyEscrowReservationRef = sha256(
    settlement.bounty_escrow_reservation_ref,
    "$.settlement.bounty_escrow_reservation_ref",
  );
  if (settlement.funding_observation_status !== "caller_declared_reserved_not_verified") {
    fail(
      "invalid_record",
      "bounty escrow funding remains caller-declared until an authenticated activation-time reservation check",
      "$.settlement.funding_observation_status",
    );
  }
  const economicEvidenceRefs = [
    bountyEscrowAuthorizationRef,
    bountyEscrowReservationRef,
    reviewStakeFundingRef,
    transactionFeeReservationRef,
  ];
  if (new Set(economicEvidenceRefs).size !== economicEvidenceRefs.length) {
    fail(
      "invalid_record",
      "sponsor authorization, bounty escrow, review stake, and transaction fee require distinct evidence refs",
      "$",
    );
  }
  literal(item.participation, PARTICIPATION_RIGHTS, "$.participation");
  literal(item.downgrade_guards, DOWNGRADE_GUARDS, "$.downgrade_guards");
  literal(item.boundary, SOURCE_ONLY_BOUNDARY, "$.boundary");
  literal(item.effects, ZERO_EFFECTS, "$.effects");
  return deepFreeze({
    _format: FORMATS.work_spec,
    contract_id: sha256(item.contract_id, "$.contract_id"),
    chain_profile: parseChainProfile(item.chain_profile, "$.chain_profile"),
    sponsor: {
      account_address: zeroneAddress(sponsor.account_address, "$.sponsor.account_address"),
      wallet_controller_ref: sponsorWalletControllerRef,
      bounty_escrow_authorization_ref: bountyEscrowAuthorizationRef,
    },
    worker: {
      account_address: workerAddress,
      producer_identity_ref: sha256(worker.producer_identity_ref, "$.worker.producer_identity_ref"),
      producer_key_ref: sha256(worker.producer_key_ref, "$.worker.producer_key_ref"),
      wallet_controller_ref: sha256(worker.wallet_controller_ref, "$.worker.wallet_controller_ref"),
      wallet_binding_ref: sha256(worker.wallet_binding_ref, "$.worker.wallet_binding_ref"),
      binding_claim: "KEY_CONTROL_ONLY_NOT_IDENTITY_AUTHORSHIP_CONSENT_OR_AUTHORITY",
    },
    payee_address: payeeAddress,
    fulfillment_caller_address: fulfillmentAddress,
    knowledge_domain: identifier(item.knowledge_domain, "$.knowledge_domain"),
    target_tree: {
      tree_id: identifier(tree.tree_id, "$.target_tree.tree_id"),
      base_root: sha256(tree.base_root, "$.target_tree.base_root"),
      parent_fact_ids: sortedUniqueIdentifiers(tree.parent_fact_ids, "$.target_tree.parent_fact_ids", 0, MAX_RELATIONS),
      transition_kind: "add_fact",
      relation_support: "requires_only",
    },
    claim_submission: {
      category: submissionCategory,
      method_id: submissionMethodId,
      methodology_registry_evidence_ref: sha256(
        claimSubmission.methodology_registry_evidence_ref,
        "$.claim_submission.methodology_registry_evidence_ref",
      ),
      review_stake_uzrn: uint64(
        claimSubmission.review_stake_uzrn,
        "$.claim_submission.review_stake_uzrn",
        { positive: true },
      ),
      review_stake_payer_address: reviewStakePayer,
      review_stake_funding_ref: reviewStakeFundingRef,
      transaction_fee_payer_address: transactionFeePayer,
      transaction_fee_reservation_ref: transactionFeeReservationRef,
      funding_observation_status: "caller_declared_reserved_not_verified",
    },
    input_root: sha256(item.input_root, "$.input_root"),
    environment_root: sha256(item.environment_root, "$.environment_root"),
    acceptance_hash: sha256(item.acceptance_hash, "$.acceptance_hash"),
    resource_limits: parseResourceCounters(item.resource_limits, "$.resource_limits", true),
    settlement: {
      denom: "uzrn",
      price_per_artifact_uzrn: pricePerArtifact,
      target_count: "1",
      duration_blocks: uint64(settlement.duration_blocks, "$.settlement.duration_blocks", { positive: true }),
      min_corroborations: uint64(settlement.min_corroborations, "$.settlement.min_corroborations", {
        positive: true,
        maximum: 64n,
      }),
      prefunded_escrow_required: true,
      prefunded_escrow_uzrn: prefundedEscrow,
      bounty_escrow_reservation_ref: bountyEscrowReservationRef,
      funding_observation_status: "caller_declared_reserved_not_verified",
      minting_allowed: false,
    },
    participation: PARTICIPATION_RIGHTS,
    downgrade_guards: DOWNGRADE_GUARDS,
    boundary: SOURCE_ONLY_BOUNDARY,
    effects: ZERO_EFFECTS,
  }) as CreationWorkSpecCore;
}

export function createCreationWorkSpec(
  contractValue: CreationContract,
  input: CreateCreationWorkSpecInput,
): CreationWorkSpec {
  const contract = validateCreationContract(contractValue);
  const safe = snapshotRecord(input);
  const core = validateCreationWorkSpecCore({
    ...safe,
    _format: FORMATS.work_spec,
    contract_id: contract.contract_id,
    input_root: contract.input_root,
    environment_root: contract.execution.environment_root,
    acceptance_hash: contract.acceptance_hash,
    participation: PARTICIPATION_RIGHTS,
    downgrade_guards: DOWNGRADE_GUARDS,
    boundary: SOURCE_ONLY_BOUNDARY,
    effects: ZERO_EFFECTS,
  });
  assertClaimSubmissionMatchesContract(contract, core);
  const requiredCorroborations = requiredCorroborationCount(contract);
  assertSame(
    core.settlement.min_corroborations,
    requiredCorroborations,
    "work_spec.settlement.min_corroborations",
    "chain corroboration threshold must equal the maximum accepted-newness reproduction threshold",
  );
  return deepFreeze({
    ...core,
    work_spec_id: domainSeparatedId(HASH_DOMAINS.work_spec, core),
  }) as CreationWorkSpec;
}

function requiredCorroborationCount(contract: CreationContract): string {
  return contract.outcome_routes
    .filter((route) => route.tok_posture === "digest_fact_candidate")
    .map((route) => route.requirements.find((requirement) => requirement.kind === "independent_reproduction"))
    .filter((requirement): requirement is VerificationRequirement => requirement !== undefined)
    .reduce((maximum, requirement) => {
      const value = BigInt(requirement.minimum_passes);
      return value > maximum ? value : maximum;
    }, 0n)
    .toString();
}

function assertClaimSubmissionMatchesContract(
  contract: CreationContract,
  workSpec: CreationWorkSpecCore,
): void {
  assertSame(workSpec.claim_submission.category, contract.claim_policy.category, "work_spec.claim_submission.category");
  assertSame(workSpec.claim_submission.method_id, contract.claim_policy.method_id, "work_spec.claim_submission.method_id");
  assertSame(
    workSpec.claim_submission.methodology_registry_evidence_ref,
    contract.claim_policy.methodology_registry_evidence_ref,
    "work_spec.claim_submission.methodology_registry_evidence_ref",
  );
  if (BigInt(workSpec.claim_submission.review_stake_uzrn) > BigInt(contract.claim_policy.max_review_stake_uzrn)) {
    fail(
      "contract_mismatch",
      "claim review stake exceeds the creation contract cap",
      "work_spec.claim_submission.review_stake_uzrn",
    );
  }
}

export function validateCreationWorkSpec(value: unknown): CreationWorkSpec {
  const item = snapshotRecord(value);
  exactKeys(item, [...WORK_SPEC_CORE_KEYS, "work_spec_id"], "$");
  const core = validateCreationWorkSpecCore(withoutKeys(item, ["work_spec_id"]));
  const id = sha256(item.work_spec_id, "$.work_spec_id");
  assertSame(id, domainSeparatedId(HASH_DOMAINS.work_spec, core), "$.work_spec_id", "work_spec_id does not match canonical bytes");
  return deepFreeze({ ...core, work_spec_id: id }) as CreationWorkSpec;
}

export function assertWorkSpecMatchesContract(
  contractValue: CreationContract,
  workSpecValue: CreationWorkSpec,
): { readonly contract: CreationContract; readonly work_spec: CreationWorkSpec } {
  const contract = validateCreationContract(contractValue);
  const workSpec = validateCreationWorkSpec(workSpecValue);
  assertSame(workSpec.contract_id, contract.contract_id, "work_spec.contract_id");
  assertSame(workSpec.input_root, contract.input_root, "work_spec.input_root");
  assertSame(workSpec.environment_root, contract.execution.environment_root, "work_spec.environment_root");
  assertSame(workSpec.acceptance_hash, contract.acceptance_hash, "work_spec.acceptance_hash");
  assertClaimSubmissionMatchesContract(contract, workSpec);
  assertSame(
    workSpec.settlement.min_corroborations,
    requiredCorroborationCount(contract),
    "work_spec.settlement.min_corroborations",
    "chain corroboration threshold must equal the maximum accepted-newness reproduction threshold",
  );
  return deepFreeze({ contract, work_spec: workSpec });
}
