import {
  ARTIFACT_KINDS,
  CREATION_LANES,
  CREATION_NONCLAIMS,
  CREATION_OUTCOMES,
  CYBER_ACCESS_TIERS,
  CYBER_PROVIDERS,
  DATASET_ROLES,
  DOWNGRADE_GUARDS,
  DOWNSTREAM_REQUIREMENTS,
  FORMATS,
  INDEPENDENCE_POSTURES,
  LIFECYCLE_STATES,
  MATERIAL_STATUSES,
  MAX_DATASET_SOURCES,
  MAX_RELATIONS,
  PARTICIPATION_RIGHTS,
  REQUIREMENT_STATUSES,
  SETTLEMENT_POSTURES,
  SOURCE_ONLY_BOUNDARY,
  SOURCE_PLANE,
  TOK_POSTURES,
  VERIFICATION_KINDS,
  VERIFICATION_OUTCOMES,
  VERIFIER_RELATIONS,
  ZERO_EFFECTS,
  ZERONE_HANDOFF,
  ZERONE_METHOD_IDS,
} from "./constants.js";

type Schema = Record<string, unknown>;

function boundedDecimalPattern(maximum: string, positive: boolean): string {
  const shorterMaximum = maximum.length - 2;
  const alternatives: string[] = [];
  if (!positive) alternatives.push("0");
  if (shorterMaximum >= 0) alternatives.push(`[1-9][0-9]{0,${String(shorterMaximum)}}`);
  for (let index = 0; index < maximum.length; index += 1) {
    const digit = Number(maximum[index]!);
    const lower = index === 0 ? 1 : 0;
    if (digit <= lower) continue;
    const choice = digit - lower === 1
      ? String(lower)
      : `[${String(lower)}-${String(digit - 1)}]`;
    alternatives.push(`${maximum.slice(0, index)}${choice}[0-9]{${String(maximum.length - index - 1)}}`);
  }
  alternatives.push(maximum);
  return `^(?:${alternatives.join("|")})$`;
}

const sha256: Schema = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const revision: Schema = { type: "string", pattern: "^[0-9a-f]{40}$" };
const decimal: Schema = { type: "string", pattern: boundedDecimalPattern("18446744073709551615", false), maxLength: 20 };
const positiveDecimal: Schema = { type: "string", pattern: boundedDecimalPattern("18446744073709551615", true), maxLength: 20 };
const decimalMax16: Schema = { type: "string", pattern: boundedDecimalPattern("16", false), maxLength: 2 };
const positiveDecimalMax16: Schema = { type: "string", pattern: boundedDecimalPattern("16", true), maxLength: 2 };
const decimalMax64: Schema = { type: "string", pattern: boundedDecimalPattern("64", false), maxLength: 2 };
const positiveDecimalMax64: Schema = { type: "string", pattern: boundedDecimalPattern("64", true), maxLength: 2 };
const identifier: Schema = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:/-]*$",
};
const address: Schema = {
  type: "string",
  minLength: 42,
  maxLength: 42,
  pattern: "^zrn1[023456789acdefghjklmnpqrstuvwxyz]{38}$",
};
const nullableSha256: Schema = { anyOf: [sha256, { type: "null" }] };

function object(properties: Record<string, Schema>, required = Object.keys(properties)): Schema {
  return {
    type: "object",
    additionalProperties: false,
    required,
    properties,
  };
}

function array(items: Schema, minimum = 0, maximum = 64): Schema {
  return { type: "array", minItems: minimum, maxItems: maximum, items };
}

function fixed(value: unknown): Schema {
  return { const: value };
}

function recordSchema(id: string, title: string, properties: Record<string, Schema>): Schema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: id,
    title,
    ...object(properties),
  };
}

const digestArray = array(sha256);
const resourceCounters = object({
  compute_millis: decimal,
  accelerator_millis: decimal,
  memory_byte_millis: decimal,
  input_bytes: decimal,
  output_bytes: decimal,
});
const datasetSource = object({
  repository_ref: sha256,
  revision,
  content_root: sha256,
  admission_ref: sha256,
  license_evidence_ref: sha256,
  role: { enum: DATASET_ROLES },
  material_status: { enum: MATERIAL_STATUSES },
});
const hfRun = object({
  dataset_sources: array(datasetSource, 0, MAX_DATASET_SOURCES),
  training_input_roots: array(sha256, 0, MAX_DATASET_SOURCES),
  split_manifest_ref: sha256,
  role_manifest_ref: sha256,
  transform_manifest_ref: sha256,
  tokenizer_ref: sha256,
  presentation_multiplicity_ref: sha256,
  mixture_weights_ref: sha256,
  order_ref: sha256,
  optimizer_ref: sha256,
  seed_policy_ref: sha256,
  checkpoint_ref: sha256,
});
const verificationRequirement = object({
  kind: { enum: VERIFICATION_KINDS },
  minimum_passes: positiveDecimalMax16,
  independence: { enum: INDEPENDENCE_POSTURES },
  policy_ref: sha256,
});
const outcomeRoute = object({
  outcome: { enum: CREATION_OUTCOMES },
  tok_posture: { enum: TOK_POSTURES },
  settlement_posture: { enum: SETTLEMENT_POSTURES },
  requirements: array(verificationRequirement, 0, VERIFICATION_KINDS.length),
});
const contractProperties: Record<string, Schema> = {
  _format: fixed(FORMATS.contract),
  contract_id: sha256,
  lane: { enum: CREATION_LANES },
  artifact_kind: { enum: ARTIFACT_KINDS },
  claim_policy: object({
    category: { enum: ["computational", "formal"] },
    method_id: { enum: ZERONE_METHOD_IDS },
    methodology_registry_evidence_ref: sha256,
    methodology_observation_status: fixed("caller_declared_not_verified"),
    max_review_stake_uzrn: positiveDecimal,
  }),
  math_card: object({
    card_id: sha256,
    assessment_id: sha256,
    assessment_status: fixed("ready_for_bounded_inquiry"),
    validation_ref: sha256,
  }),
  target: object({
    object_ref: sha256,
    baseline_ref: sha256,
    status_evidence_ref: sha256,
    prior_art_scope_ref: sha256,
    prior_art_cutoff_ref: sha256,
  }),
  hf_run: hfRun,
  authorities: object({
    data_use_ref: sha256,
    compute_ref: sha256,
    publication_authority_ref: nullableSha256,
    target_authorization_ref: nullableSha256,
    engagement_scope_ref: nullableSha256,
    cyber: object({
      provider: { enum: CYBER_PROVIDERS },
      access_tier: { enum: CYBER_ACCESS_TIERS },
      provider_access_ref: nullableSha256,
      provider_policy_ref: nullableSha256,
    }),
  }),
  execution: object({
    model_ref: sha256,
    toolchain_ref: sha256,
    environment_root: sha256,
    isolation_policy_ref: sha256,
    disclosure_policy_ref: sha256,
  }),
  outcome_routes: array(outcomeRoute, CREATION_OUTCOMES.length, CREATION_OUTCOMES.length),
  input_root: sha256,
  acceptance_hash: sha256,
  source_plane: fixed(SOURCE_PLANE),
  nonclaims: fixed(CREATION_NONCLAIMS),
  boundary: fixed(SOURCE_ONLY_BOUNDARY),
  effects: fixed(ZERO_EFFECTS),
};

const chainProfile = object({
  chain_id: identifier,
  integrated_source_revision: revision,
  knowledge_module_version: fixed("7"),
  sponsorship_module_version: fixed("2"),
  binary_ref: sha256,
  genesis_ref: sha256,
  version_map_ref: sha256,
  migration_evidence_ref: sha256,
  bounty_roundtrip_evidence_ref: sha256,
  claim_roundtrip_evidence_ref: sha256,
  private_disposable_chain_declared: fixed(true),
  observation_status: fixed("caller_declared_not_verified"),
});
const workSpecProperties: Record<string, Schema> = {
  _format: fixed(FORMATS.work_spec),
  work_spec_id: sha256,
  contract_id: sha256,
  chain_profile: chainProfile,
  sponsor: object({
    account_address: address,
    wallet_controller_ref: sha256,
    bounty_escrow_authorization_ref: sha256,
  }),
  worker: object({
    account_address: address,
    producer_identity_ref: sha256,
    producer_key_ref: sha256,
    wallet_controller_ref: sha256,
    wallet_binding_ref: sha256,
    binding_claim: fixed("KEY_CONTROL_ONLY_NOT_IDENTITY_AUTHORSHIP_CONSENT_OR_AUTHORITY"),
  }),
  payee_address: address,
  fulfillment_caller_address: address,
  knowledge_domain: identifier,
  target_tree: object({
    tree_id: identifier,
    base_root: sha256,
    parent_fact_ids: array(identifier, 0, MAX_RELATIONS),
    transition_kind: fixed("add_fact"),
    relation_support: fixed("requires_only"),
  }),
  claim_submission: object({
    category: { enum: ["computational", "formal"] },
    method_id: { enum: ZERONE_METHOD_IDS },
    methodology_registry_evidence_ref: sha256,
    review_stake_uzrn: positiveDecimal,
    review_stake_payer_address: address,
    review_stake_funding_ref: sha256,
    transaction_fee_payer_address: address,
    transaction_fee_reservation_ref: sha256,
    funding_observation_status: fixed("caller_declared_reserved_not_verified"),
  }),
  input_root: sha256,
  environment_root: sha256,
  acceptance_hash: sha256,
  resource_limits: resourceCounters,
  settlement: object({
    denom: fixed("uzrn"),
    price_per_artifact_uzrn: positiveDecimal,
    target_count: fixed("1"),
    duration_blocks: positiveDecimal,
    min_corroborations: positiveDecimalMax64,
    prefunded_escrow_required: fixed(true),
    prefunded_escrow_uzrn: positiveDecimal,
    bounty_escrow_reservation_ref: sha256,
    funding_observation_status: fixed("caller_declared_reserved_not_verified"),
    minting_allowed: fixed(false),
  }),
  participation: fixed(PARTICIPATION_RIGHTS),
  downgrade_guards: fixed(DOWNGRADE_GUARDS),
  boundary: fixed(SOURCE_ONLY_BOUNDARY),
  effects: fixed(ZERO_EFFECTS),
};

const creationWitnessProperties: Record<string, Schema> = {
  _format: fixed(FORMATS.creation_witness),
  creation_witness_id: sha256,
  contract_id: sha256,
  work_spec_id: sha256,
  producer: object({
    account_address: address,
    producer_identity_ref: sha256,
    producer_key_ref: sha256,
    wallet_controller_ref: sha256,
    wallet_binding_ref: sha256,
  }),
  outcome: { enum: CREATION_OUTCOMES },
  artifact_kind: { enum: ARTIFACT_KINDS },
  run: object({
    run_ref: sha256,
    input_root: sha256,
    environment_root: sha256,
    model_ref: sha256,
    toolchain_ref: sha256,
    seed_policy_ref: sha256,
    checkpoint_ref: sha256,
  }),
  result: object({
    candidate_artifact_ref: nullableSha256,
    statement_or_behavior_ref: nullableSha256,
    execution_evidence_ref: sha256,
    public_summary_ref: nullableSha256,
    confidential_material_present: { type: "boolean" },
  }),
  resource_usage: resourceCounters,
  started_observation_ref: sha256,
  completed_observation_ref: sha256,
  declaration: fixed("PRODUCER_REPORTED_NOT_INDEPENDENTLY_VERIFIED"),
  nonclaims: fixed(CREATION_NONCLAIMS),
  boundary: fixed(SOURCE_ONLY_BOUNDARY),
  effects: fixed(ZERO_EFFECTS),
};

const verificationWitnessProperties: Record<string, Schema> = {
  _format: fixed(FORMATS.verification_witness),
  verification_witness_id: sha256,
  contract_id: sha256,
  creation_witness_id: sha256,
  kind: { enum: VERIFICATION_KINDS },
  outcome: { enum: VERIFICATION_OUTCOMES },
  verifier: object({
    controller_ref: sha256,
    claimed_key_ref: sha256,
    attestation_ref: sha256,
    relation_to_producer: { enum: VERIFIER_RELATIONS },
    independence_evidence_ref: nullableSha256,
  }),
  method_ref: sha256,
  policy_ref: sha256,
  environment_root: sha256,
  evidence_root: sha256,
  limitation_refs: digestArray,
  observation_ref: sha256,
  declaration: fixed("CALLER_REPORTED_ATTESTATION_REFERENCE_NOT_VERIFIED"),
  nonclaims: fixed(CREATION_NONCLAIMS),
  boundary: fixed(SOURCE_ONLY_BOUNDARY),
  effects: fixed(ZERO_EFFECTS),
};

const requirementAssessment = object({
  kind: { enum: VERIFICATION_KINDS },
  minimum_passes: positiveDecimalMax16,
  counted_passes: decimalMax64,
  passed_witness_ids: digestArray,
  failed_witness_ids: digestArray,
  inconclusive_witness_ids: digestArray,
  ignored_non_independent_witness_ids: digestArray,
  ignored_duplicate_controller_or_key_witness_ids: digestArray,
  status: { enum: REQUIREMENT_STATUSES },
});
const lifecycleProperties: Record<string, Schema> = {
  _format: fixed(FORMATS.lifecycle),
  lifecycle_id: sha256,
  contract_id: sha256,
  work_spec_id: sha256,
  creation_witness_id: nullableSha256,
  outcome: { anyOf: [{ enum: CREATION_OUTCOMES }, { type: "null" }] },
  artifact_kind: { anyOf: [{ enum: ARTIFACT_KINDS }, { type: "null" }] },
  verification_set_root: sha256,
  requirements: array(requirementAssessment, 0, VERIFICATION_KINDS.length),
  state: { enum: LIFECYCLE_STATES },
  blockers: array({ enum: [
    "AWAITING_CREATION",
    "OUTCOME_OFFCHAIN_ONLY",
    "PUBLICATION_AUTHORITY_MISSING",
    "CONFIDENTIAL_MATERIAL_PRESENT",
    "VERIFICATION_OPEN",
    "VERIFICATION_CONTESTED",
  ] }, 0, 6),
  accepted_new_posture: { enum: ["not_reached", "BOUNDED_CANDIDATE_UNDER_PINNED_SCOPE"] },
  handoff: object({
    artifact_projection: { enum: ["available", "not_available"] },
    tok_claim_projection: { enum: ["available", "not_available"] },
    chain_maturity: fixed("not_observed"),
    settlement: fixed("not_authorized"),
  }),
  nonclaims: fixed(CREATION_NONCLAIMS),
  boundary: fixed(SOURCE_ONLY_BOUNDARY),
  effects: fixed(ZERO_EFFECTS),
};

const computationalRoots = object({
  work_spec_hash: sha256,
  acceptance_hash: sha256,
  input_root: sha256,
  environment_root: sha256,
  artifact_root: sha256,
  evidence_root: sha256,
});
const artifactProperties: Record<string, Schema> = {
  _format: fixed(FORMATS.computational_artifact),
  artifact_id: sha256,
  contract_id: sha256,
  work_spec_id: sha256,
  creation_witness_id: sha256,
  lifecycle_id: sha256,
  producer_account_address: address,
  candidate_artifact_ref: sha256,
  public_summary_ref: sha256,
  artifact_root: sha256,
  evidence_root: sha256,
  fact_envelope_root: sha256,
  work_receipt_input_root: sha256,
  computational_roots: computationalRoots,
  claim: fixed("BOUNDED_CREATION_CANDIDATE_NOT_ABSOLUTE_NOVELTY"),
  chain_work_receipt_hash: { type: "null" },
  chain_work_receipt_status: fixed("DOWNSTREAM_REVIEWED_ADAPTER_REQUIRED"),
  nonclaims: fixed(CREATION_NONCLAIMS),
  boundary: fixed(SOURCE_ONLY_BOUNDARY),
  effects: fixed(ZERO_EFFECTS),
};

const requiresRelation = object({
  target_fact_id: identifier,
  relation: fixed("REQUIRES"),
  relation_value: fixed(3),
  inference: fixed("INFERENCE_TYPE_UNSPECIFIED"),
  inference_value: fixed(0),
  inference_strength_bps: fixed("0"),
  method_id: fixed(""),
});
const projectionCommitment = object({
  work_spec_hash: sha256,
  acceptance_hash: sha256,
  input_root: sha256,
  environment_root: sha256,
  artifact_root: sha256,
  evidence_root: sha256,
  work_receipt_input_root: sha256,
  chain_work_receipt_hash: { type: "null" },
});
const projectionProperties: Record<string, Schema> = {
  _format: fixed(FORMATS.claim_projection),
  projection_id: sha256,
  status: fixed("NOT_CONSENSUS_ADMISSIBLE"),
  contract_id: sha256,
  work_spec_id: sha256,
  creation_witness_id: sha256,
  lifecycle_id: sha256,
  artifact_id: sha256,
  target_type_url: fixed(ZERONE_HANDOFF.submit_claim_type_url),
  fact_content: {
    type: "string",
    minLength: 20,
    maxLength: 1_000,
    pattern: "^agenttool\\.zerone-creation-fact-envelope/0\\.1 sha256:[0-9a-f]{64}$",
  },
  domain: identifier,
  category: { enum: ["computational", "formal"] },
  stake_uzrn: positiveDecimal,
  references: { type: "array", maxItems: 0 },
  partnership_id: fixed(""),
  claim_type: fixed(ZERONE_HANDOFF.computational_claim_name),
  claim_type_value: fixed(ZERONE_HANDOFF.computational_claim_value),
  relations: array(requiresRelation, 0, MAX_RELATIONS),
  canonical_form: {
    type: "string",
    minLength: 20,
    maxLength: 1_000,
    pattern: "^agenttool\\.zerone-creation-fact-envelope/0\\.1 sha256:[0-9a-f]{64}$",
  },
  sponsored: fixed(false),
  method_id: { enum: ZERONE_METHOD_IDS },
  reasoning_trace: sha256,
  computational_commitment: projectionCommitment,
  downgrade_guards: fixed(DOWNGRADE_GUARDS),
  handoff: fixed(ZERONE_HANDOFF),
  downstream_requirements: fixed(DOWNSTREAM_REQUIREMENTS),
  boundary: fixed(SOURCE_ONLY_BOUNDARY),
  effects: fixed(ZERO_EFFECTS),
};

export const SCHEMAS = Object.freeze({
  "agenttool-zerone-creation-contract-v0.1.schema.json": recordSchema(
    "urn:agenttool:schema:zerone-creation-contract:0.1",
    "AgentTool Zerone Creation Contract v0.1",
    contractProperties,
  ),
  "agenttool-zerone-creation-work-spec-v0.1.schema.json": recordSchema(
    "urn:agenttool:schema:zerone-creation-work-spec:0.1",
    "AgentTool Zerone Creation Work Spec v0.1",
    workSpecProperties,
  ),
  "agenttool-zerone-creation-witness-v0.1.schema.json": recordSchema(
    "urn:agenttool:schema:zerone-creation-witness:0.1",
    "AgentTool Zerone Creation Witness v0.1",
    creationWitnessProperties,
  ),
  "agenttool-zerone-verification-witness-v0.1.schema.json": recordSchema(
    "urn:agenttool:schema:zerone-verification-witness:0.1",
    "AgentTool Zerone Verification Witness v0.1",
    verificationWitnessProperties,
  ),
  "agenttool-zerone-creation-lifecycle-v0.1.schema.json": recordSchema(
    "urn:agenttool:schema:zerone-creation-lifecycle:0.1",
    "AgentTool Zerone Creation Lifecycle v0.1",
    lifecycleProperties,
  ),
  "agenttool-zerone-creation-artifact-v0.1.schema.json": recordSchema(
    "urn:agenttool:schema:zerone-creation-artifact:0.1",
    "AgentTool Zerone Creation Artifact v0.1",
    artifactProperties,
  ),
  "agenttool-zerone-creation-claim-projection-v0.1.schema.json": recordSchema(
    "urn:agenttool:schema:zerone-creation-claim-projection:0.1",
    "AgentTool Zerone Creation Claim Projection v0.1",
    projectionProperties,
  ),
} as const);
