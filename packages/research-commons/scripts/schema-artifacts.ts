import {
  DECLARED_RESULT_KINDS,
  PARTICIPATION_RIGHTS,
  PUBLIC_SAFE_THEORETICAL_LANE,
  RESEARCH_FORMATS,
  SIX_LEDGER_PROFILE,
  ZERO_EFFECTS,
} from "../src/constants.js";
import { ZERONE_RESEARCH_ADAPTER_RECIPROCAL_PROFILE } from "../src/interop.js";

type Schema = Record<string, unknown>;

const digest: Schema = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const timestamp: Schema = {
  type: "string",
  pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$",
};
const digestSet = (minimum = 0, maximum = 256): Schema => ({
  type: "array",
  items: digest,
  minItems: minimum,
  maxItems: maximum,
  uniqueItems: true,
});
const closed = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});
const closedLiteralSchema = (value: unknown): Schema => {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return closed(Object.fromEntries(
      Object.entries(value).map(([key, member]) => [key, closedLiteralSchema(member)]),
    ));
  }
  return { const: value };
};
const identified = (
  body: Record<string, Schema>,
  idKey: string,
): Schema => closed({ ...body, [idKey]: digest });
const format = (value: string): Schema => ({ const: value });
const resultKind: Schema = { enum: DECLARED_RESULT_KINDS };
const level: Schema = { enum: ["E0", "E1", "E2", "E3", "E4", "E5", "E6"] };

const nodeRefBody = {
  _format: format(RESEARCH_FORMATS.nodeRef),
  anchor_kind: { const: "STATIC_CAPABILITY_REFERENCE" },
  canonicalization: { const: "RECURSIVE_UNICODE_CODE_POINT_KEYS_COMPACT_JSON" },
  live_fact: { const: false },
  network_observed: { const: false },
  node_digest: {
    const: "sha256:d8f364772611a214aaf5f671c630a5fa00daa3558330bfaf5e85efe7c5a1d0e2",
  },
  node_id: { const: "math-proofcraft@1" },
  result_authority: { const: "NONE" },
  reward_bearing: { const: false },
  tree_raw_sha256: {
    const: "sha256:8070d8d1b7ea28a314f5a8550c675d7ccbe5d9b234ef02d54d4913c650c01aaf",
  },
  tree_schema: { const: "zerone.constructive-intelligence-tree/v1" },
};
const nodeRef = identified(nodeRefBody, "node_ref_id");

const controller = identified({
  _format: format(RESEARCH_FORMATS.controller),
  data_root: digest,
  funding_root: digest,
  independence_posture: { const: "DECLARATION_ONLY_NOT_INDEPENDENCE_PROOF" },
  identity_inferred: { const: false },
  model_root: digest,
  operator_root: digest,
  organization_root: digest,
  toolchain_root: digest,
}, "controller_id");

const researchCase = identified({
  _format: format(RESEARCH_FORMATS.researchCase),
  ledger_profile: { const: SIX_LEDGER_PROFILE },
  maximum_evidence_level: level,
  node_ref: nodeRef,
  prior_art_manifest_ref: digest,
  question_ref: digest,
  result_authority: { const: "NONE" },
  safety: closed({
    exclusions: { const: PUBLIC_SAFE_THEORETICAL_LANE },
    risk_class: { const: "PUBLIC_SAFE_THEORETICAL_ONLY" },
    safety_review_ref: { type: "null" },
    verification_posture: { const: "CALLER_DECLARED_UNVERIFIED_NO_SAFETY_REVIEW" },
  }),
  scope_ref: digest,
  status: { const: "SHADOW_ONLY" },
  title_ref: digest,
}, "case_id");

const fundingCommitment = identified({
  _format: format(RESEARCH_FORMATS.fundingCommitment),
  case_id: digest,
  commitment_status: { const: "SIMULATION_PREFUNDED_REAL_VALUE_NONE" },
  convertible: { const: false },
  effects: { const: ZERO_EFFECTS },
  funder_controller_id: digest,
  payment_condition: { const: "SIMULATED_DELIVERY_ONLY" },
  real_value_status: { const: "NONE" },
  result_authority: { const: "NONE" },
  simulation_backing: { const: "PREFUNDED" },
  simulated_credit_limit: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
  transferable: { const: false },
  unit: { const: "SIMULATED_NONTRANSFERABLE_CREDIT" },
  valid_declared_result_kinds: { const: DECLARED_RESULT_KINDS },
  wallet_bearing: { const: false },
}, "commitment_id");

const compensationSchedule = closed({
  _format: format(RESEARCH_FORMATS.compensationSchedule),
  amount: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
  declared_result_invariant: { const: true },
  frozen_at: timestamp,
  frozen_before_work: { const: true },
  payment_condition: { const: "SIMULATED_DELIVERY_ONLY" },
  review_decision_invariant: { const: true },
  schedule_ref: digest,
  unit: { const: "SIMULATED_NONTRANSFERABLE_CREDIT" },
});

const workPackage = identified({
  _format: format(RESEARCH_FORMATS.workPackage),
  case_id: digest,
  commitment_id: digest,
  compensation_schedule: compensationSchedule,
  deliverable_ref: digest,
  lead_controller_id: digest,
  maximum_evidence_level: level,
  objective_ref: digest,
  participation_rights: { const: PARTICIPATION_RIGHTS },
  status: { const: "SHADOW_ONLY" },
}, "work_package_id");

const artifactRevision = identified({
  _format: format(RESEARCH_FORMATS.artifactRevision),
  access_verification_posture: {
    const: "CALLER_DECLARED_UNVERIFIED_NO_AVAILABILITY_OR_LICENSE_CHECK",
  },
  artifact_digest: digest,
  authored_by_controller_ids: digestSet(1),
  authorship: { const: "CALLER_DECLARED_NOT_IDENTITY_VERIFIED" },
  case_id: digest,
  contains_private_locator: { const: false },
  contains_raw_evidence: { const: false },
  declared_access_policy: { const: "PUBLIC_OPEN_NONEXCLUSIVE" },
  frozen_at: timestamp,
  manifest_digest: digest,
  ownership_transfer: { const: false },
  payment_buys: { const: "WORK_DELIVERY_ONLY_NOT_ACCESS_OWNERSHIP_OR_TRUTH" },
  prior_art_manifest_ref: digest,
  prior_revision_id: { anyOf: [digest, { type: "null" }] },
  public_content_digest: digest,
  revision_number: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
  visibility: { const: "PUBLIC_DIGEST_ONLY" },
  work_package_id: digest,
}, "artifact_revision_id");

const evidencePayload: Schema = {
  oneOf: [
    closed({
      claim_ref: digest,
      freeze_ref: digest,
      kind: { const: "E0_CALLER_DECLARED_PREREGISTRATION_REFERENCE" },
      prior_art_manifest_ref: digest,
    }),
    closed({
      execution_ref: digest,
      kind: { const: "E1_DELIVERY" },
      protocol_ref: digest,
    }),
    closed({
      checker_ref: digest,
      kind: { const: "E2_BOUNDED_CHECK" },
      test_corpus_ref: digest,
    }),
    closed({
      case_refs: digestSet(2),
      execution_environment_ref: digest,
      implementation_root: digest,
      kind: { const: "E3_DECLARED_UNPROVEN_REPRODUCTION" },
    }),
    closed({
      challenge_id: digest,
      kind: { const: "E4_CHALLENGE_OR_REPAIR" },
      repair_ref: { anyOf: [digest, { type: "null" }] },
    }),
    closed({
      adopter_organization_root: digest,
      adoption_ref: digest,
      kind: { const: "E5_DECLARED_UNPROVEN_ADOPTION" },
    }),
    closed({
      kind: { const: "E6_MAINTENANCE" },
      maintenance_ref: digest,
      maintenance_window_ref: digest,
    }),
  ],
};

const evidenceReceipt = identified({
  _format: format(RESEARCH_FORMATS.evidenceReceipt),
  artifact_revision_id: digest,
  assessment: { enum: ["DELIVERY_VALID", "DELIVERY_INVALID", "INCONCLUSIVE"] },
  case_id: digest,
  contains_private_locator: { const: false },
  contains_raw_evidence: { const: false },
  created_at: timestamp,
  declared_result_kind: resultKind,
  disclosure_lane: { const: "PUBLIC_DIGEST_ONLY" },
  evidence_refs: digestSet(1),
  issuer_controller_id: digest,
  level,
  method_ref: digest,
  payload: evidencePayload,
  work_package_id: digest,
}, "evidence_receipt_id");

const review = identified({
  _format: format(RESEARCH_FORMATS.review),
  artifact_revision_id: digest,
  case_id: digest,
  conflict_refs: digestSet(),
  conflict_status: { enum: ["DISCLOSED_RECUSED", "NONE_DECLARED"] },
  decision: {
    enum: [
      "ABSTAINED",
      "DELIVERY_ACCEPTED",
      "DELIVERY_INCONCLUSIVE",
      "DELIVERY_REJECTED",
      "REVISION_REQUESTED",
    ],
  },
  outcome_independent_compensation: { const: true },
  review_scope: { const: "DELIVERY_COMPLETENESS_NOT_SCIENTIFIC_TRUTH" },
  reviewed_at: timestamp,
  reviewed_receipt_ids: digestSet(1),
  reviewer_controller_id: digest,
  scientific_adjudication: { const: false },
  work_package_id: digest,
}, "review_id");

const challenge = identified({
  _format: format(RESEARCH_FORMATS.challenge),
  automatic_slash: { const: false },
  case_id: digest,
  challenge_kind: { enum: ["FALSIFIER", "METHODOLOGY", "PROVENANCE", "REPLICATION"] },
  challenge_ref: digest,
  challenger_controller_id: digest,
  created_at: timestamp,
  evidence_refs: digestSet(1),
  good_faith_no_penalty: { const: true },
  prior_challenge_id: { anyOf: [digest, { type: "null" }] },
  resolution_effect: { const: "SHADOW_DELIVERY_HOLD_ONLY" },
  resolution_posture: { const: "CALLER_DECLARED_UNVERIFIED_NO_AUTHORITY" },
  resolution_review_id: { anyOf: [digest, { type: "null" }] },
  revision_number: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
  scientific_adjudication: { const: false },
  status: {
    enum: [
      "CALLER_DECLARED_HOLD_CONTINUES",
      "CALLER_DECLARED_HOLD_INCONCLUSIVE",
      "CALLER_DECLARED_HOLD_RELEASED",
      "OPEN",
      "WITHDRAWN",
    ],
  },
  target_receipt_id: digest,
  work_package_id: digest,
}, "challenge_id");

const milestone = identified({
  _format: format(RESEARCH_FORMATS.milestone),
  case_id: digest,
  challenge_head_snapshot_ids: digestSet(),
  commitment_id: digest,
  compensation_schedule_ref: digest,
  declared_result_kind: resultKind,
  delivery_approval_review_ids: digestSet(),
  delivery_status: { enum: ["DELIVERED", "EXITED", "NOT_DELIVERED", "REFUSED", "RESTED"] },
  milestone_kind: { enum: ["CHALLENGE_DELIVERY", "RESEARCH_DELIVERY", "REVIEW_DELIVERY"] },
  payment_condition: { const: "SIMULATED_DELIVERY_ONLY" },
  required_challenge_ids: digestSet(),
  required_receipt_ids: digestSet(),
  required_review_ids: digestSet(),
  result_condition: { const: "NOT_CONDITIONED_ON_FAVORABLE_RESULT" },
  work_package_id: digest,
}, "milestone_id");

const settlementBody = closed({
  _format: format(RESEARCH_FORMATS.settlementBundle),
  case_id: digest,
  commitment_id: digest,
  consumed_receipt_ids: digestSet(1),
  declared_result_kind: resultKind,
  effects: { const: ZERO_EFFECTS },
  milestone_id: digest,
  payment_condition: { const: "SIMULATED_DELIVERY_ONLY" },
  result_authority: { const: "NONE" },
  simulated_credit: closed({
    amount: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    unit: { const: "SIMULATED_NONTRANSFERABLE_CREDIT" },
  }),
});
const settlementBundle = closed({ settlement: settlementBody, settlement_id: digest });

const publicProjection = closed({
  projection: closed({
    _format: format(RESEARCH_FORMATS.publicProjection),
    boundaries: closed({
      authoritative: { const: false },
      private_locator_included: { const: false },
      raw_evidence_included: { const: false },
      scientific_correctness_determined: { const: false },
    }),
    case_id: digest,
    disclosure_lane: { const: "PUBLIC_DIGEST_ONLY" },
    effects: { const: ZERO_EFFECTS },
    highest_evidence_level: { enum: [null, "E0", "E1", "E2"] },
    node_ref: nodeRef,
    public_artifact_revision_ids: digestSet(1),
    public_evidence_receipt_ids: digestSet(1),
    result_authority: { const: "NONE" },
    settlement_bundle_ids: digestSet(1, 1),
    six_ledger_boundary: closed({
      profile_digest: {
        const: "sha256:fd5ed0b66dd00b180729221a06e7fbeeb7ef6149136916842014a1afbdbc54b2",
      },
      profile_id: { const: "research-commons.six-ledger-boundary/0.1" },
    }),
    status: { const: "SHADOW_ONLY" },
  }),
  projection_id: digest,
});

const commitmentBalance = closed({
  available: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  commitment_id: digest,
  committed: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
  delivered: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  reserved: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  unit: { const: "SIMULATED_NONTRANSFERABLE_CREDIT" },
});
const stateBody = closed({
  _format: format(RESEARCH_FORMATS.simulationState),
  closed_milestone_ids: digestSet(),
  commitment_balances: { type: "array", minItems: 1, maxItems: 256, items: commitmentBalance },
  consumed_receipt_ids: digestSet(),
  observed_challenge_ids: digestSet(),
  observed_work_package_ids: digestSet(),
  reconciled_schedule_refs: digestSet(),
  settled_milestone_ids: digestSet(),
  settlement_bundle_ids: digestSet(),
});
const simulationState = closed({ state: stateBody, state_id: digest });
const settlementRequest = closed({ consumed_receipt_ids: digestSet(1), milestone_id: digest });

const simulation = closed({
  _format: format(RESEARCH_FORMATS.simulation),
  artifact_revisions: { type: "array", minItems: 1, maxItems: 256, items: artifactRevision },
  cases: { type: "array", minItems: 1, maxItems: 256, items: researchCase },
  challenges: { type: "array", maxItems: 256, items: challenge },
  controllers: { type: "array", minItems: 2, maxItems: 256, items: controller },
  evidence_receipts: { type: "array", minItems: 1, maxItems: 256, items: evidenceReceipt },
  funding_commitments: { type: "array", minItems: 1, maxItems: 256, items: fundingCommitment },
  milestones: { type: "array", minItems: 1, maxItems: 256, items: milestone },
  prior_state: { anyOf: [simulationState, { type: "null" }] },
  reviews: { type: "array", maxItems: 256, items: review },
  settlement_requests: { type: "array", maxItems: 256, items: settlementRequest },
  work_packages: { type: "array", minItems: 1, maxItems: 256, items: workPackage },
});
const zeroneResearchAdapterReciprocal = closedLiteralSchema(
  ZERONE_RESEARCH_ADAPTER_RECIPROCAL_PROFILE,
);

function document(id: string, root: Schema, definitions: Record<string, Schema> = {}): Schema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: id,
    ...root,
    ...(Object.keys(definitions).length === 0 ? {} : { $defs: definitions }),
  };
}

export function generatedSchemas(): Readonly<Record<string, Schema>> {
  return {
    "research-public-projection-v0.1.schema.json": document(
      "urn:agenttool:research-public-projection:0.1",
      publicProjection,
    ),
    "research-settlement-bundle-v0.1.schema.json": document(
      "urn:agenttool:research-settlement-bundle:0.1",
      settlementBundle,
    ),
    "research-simulation-v0.1.schema.json": document(
      "urn:agenttool:research-simulation:0.1",
      simulation,
      {
        artifactRevision,
        challenge,
        commitmentBalance,
        compensationSchedule,
        controller,
        evidencePayload,
        evidenceReceipt,
        fundingCommitment,
        milestone,
        nodeRef,
        publicProjection,
        researchCase,
        review,
        settlementBundle,
        settlementRequest,
        simulationState,
        workPackage,
      },
    ),
    "zerone-research-adapter-reciprocal-v0.1.schema.json": document(
      "urn:agenttool:zerone-research-adapter-reciprocal:0.1",
      zeroneResearchAdapterReciprocal,
    ),
  };
}

if (import.meta.main) {
  process.stdout.write(`${JSON.stringify(generatedSchemas())}\n`);
}
