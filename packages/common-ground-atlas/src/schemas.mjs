import {
  ANALOGY_FORMAT,
  GEOMETRY_FORMAT,
  WAKE_FORMAT,
} from "./constants.mjs";

const digest = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const caseId = { type: "string", pattern: "^cg-[gwa][0-9]{2}-[a-z0-9-]+$" };
const constraintId = { type: "string", pattern: "^g[0-9]{2}-[a-z0-9-]+$" };
const timestamp = {
  type: "string",
  pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$",
};

function closed(required, properties) {
  return { type: "object", additionalProperties: false, required, properties };
}

const rational = closed(["numerator", "denominator"], {
  numerator: { type: "string", pattern: "^(?:0|-?[1-9][0-9]*)$" },
  denominator: { type: "string", pattern: "^[1-9][0-9]*$" },
});

const point = closed(["x", "y"], {
  x: { "$ref": "#/$defs/rational" },
  y: { "$ref": "#/$defs/rational" },
});

const publicSafety = closed([
  "origin",
  "contains_personal_data",
  "contains_private_constraints",
  "contains_real_participant_records",
  "contains_credentials",
  "copied_agent_traces",
  "copied_fictional_story_content",
], {
  origin: { const: "human_directed_agent_authored_synthetic" },
  contains_personal_data: { const: false },
  contains_private_constraints: { const: false },
  contains_real_participant_records: { const: false },
  contains_credentials: { const: false },
  copied_agent_traces: { const: false },
  copied_fictional_story_content: { const: false },
});

const doesNotEstablish = closed([
  "consensus",
  "consent",
  "fairness",
  "authority",
  "identity_continuity",
  "continuous_selection",
  "culprit",
], {
  consensus: { const: true },
  consent: { const: true },
  fairness: { const: true },
  authority: { const: true },
  identity_continuity: { const: true },
  continuous_selection: { const: true },
  culprit: { const: true },
});

function commonProperties(format) {
  return {
    _format: { const: format },
    case_id: caseId,
    training_eligible: { const: false },
    visibility: { const: "public_reference" },
    synthetic: { const: true },
    provenance_ref: digest,
    public_safety: { "$ref": "#/$defs/publicSafety" },
    does_not_establish: { "$ref": "#/$defs/doesNotEstablish" },
  };
}

const commonRequired = [
  "_format",
  "case_id",
  "training_eligible",
  "visibility",
  "synthetic",
  "provenance_ref",
  "public_safety",
  "does_not_establish",
];

const sourceNumber = closed(["literal", "exact", "binary64_hex", "parse_relation"], {
  literal: { type: "string", minLength: 1, maxLength: 420 },
  exact: { "$ref": "#/$defs/rational" },
  binary64_hex: { type: "string", pattern: "^[0-9a-f]{16}$" },
  parse_relation: { enum: ["exact", "underflow_to_signed_zero"] },
});

const halfplane = closed(["id", "source_ref", "a", "b", "c"], {
  id: constraintId,
  source_ref: { type: "string", pattern: "^synthetic:constraint/g[0-9]{2}-[a-z0-9-]+$" },
  a: { "$ref": "#/$defs/sourceNumber" },
  b: { "$ref": "#/$defs/sourceNumber" },
  c: { "$ref": "#/$defs/sourceNumber" },
});

const model = closed([
  "coordinate_model_version",
  "dimension",
  "axes",
  "coordinate_selector",
  "representation_omission",
], {
  coordinate_model_version: { type: "string", pattern: "^synthetic-cartesian-2d/0\\.[0-9]+$" },
  dimension: { const: 2 },
  axes: {
    type: "array",
    minItems: 2,
    maxItems: 2,
    items: closed(["id", "meaning", "unit"], {
      id: { enum: ["x", "y"] },
      meaning: { enum: ["synthetic_coordinate_1", "synthetic_coordinate_2"] },
      unit: { const: "abstract" },
    }),
  },
  coordinate_selector: { const: "fixture_author" },
  representation_omission: { const: "not_a_world_model" },
});

const halfplaneInput = closed(["kind", "model", "constraints"], {
  kind: { const: "halfplane_family" },
  model: { "$ref": "#/$defs/model" },
  constraints: {
    type: "array",
    minItems: 1,
    maxItems: 12,
    items: { "$ref": "#/$defs/halfplane" },
  },
});

const nonconvexInput = closed(["kind", "model", "alternatives"], {
  kind: { const: "nonconvex_union" },
  model: { "$ref": "#/$defs/model" },
  alternatives: {
    type: "array",
    minItems: 2,
    maxItems: 2,
    items: { "$ref": "#/$defs/halfplane" },
  },
});

const multiplier = closed(["constraint_id", "weight"], {
  constraint_id: constraintId,
  weight: { "$ref": "#/$defs/rational" },
});

const deletionWitness = closed([
  "omitted_constraint_id",
  "point",
  "satisfies_constraint_ids",
], {
  omitted_constraint_id: constraintId,
  point: { "$ref": "#/$defs/point" },
  satisfies_constraint_ids: {
    type: "array",
    minItems: 1,
    maxItems: 2,
    uniqueItems: true,
    items: constraintId,
  },
});

const knifeEdgeProof = closed([
  "active_constraint_ids",
  "positive_normal_dependence",
  "rank_witness_constraint_ids",
], {
  active_constraint_ids: {
    type: "array", minItems: 2, maxItems: 3, uniqueItems: true, items: constraintId,
  },
  positive_normal_dependence: {
    type: "array", minItems: 2, maxItems: 3, items: { "$ref": "#/$defs/multiplier" },
  },
  rank_witness_constraint_ids: {
    type: "array", minItems: 2, maxItems: 2, uniqueItems: true, items: constraintId,
  },
});

const feasibleCertificate = closed([
  "kind",
  "input_sha256",
  "point",
  "binary64_point",
  "membership_constraint_ids",
  "robustness",
  "knife_edge_proof",
], {
  kind: { const: "feasible_point" },
  input_sha256: digest,
  point: { "$ref": "#/$defs/point" },
  binary64_point: {
    oneOf: [
      { type: "null" },
      closed(["x_hex", "y_hex"], {
        x_hex: { type: "string", pattern: "^[0-9a-f]{16}$" },
        y_hex: { type: "string", pattern: "^[0-9a-f]{16}$" },
      }),
    ],
  },
  membership_constraint_ids: {
    type: "array", minItems: 1, maxItems: 12, uniqueItems: true, items: constraintId,
  },
  robustness: closed(["metric", "radius", "status", "tight_constraint_ids"], {
    metric: { const: "l_infinity_at_witness" },
    radius: { "$ref": "#/$defs/rational" },
    status: { enum: ["robust", "knife_edge"] },
    tight_constraint_ids: {
      type: "array", minItems: 1, maxItems: 12, uniqueItems: true, items: constraintId,
    },
  }),
  knife_edge_proof: {
    oneOf: [{ type: "null" }, { "$ref": "#/$defs/knifeEdgeProof" }],
  },
});

const conflictCertificate = closed([
  "kind",
  "input_sha256",
  "constraint_ids",
  "farkas_multipliers",
  "deletion_witnesses",
], {
  kind: { const: "minimal_conflict" },
  input_sha256: digest,
  constraint_ids: {
    type: "array", minItems: 2, maxItems: 3, uniqueItems: true, items: constraintId,
  },
  farkas_multipliers: {
    type: "array", minItems: 2, maxItems: 3, items: { "$ref": "#/$defs/multiplier" },
  },
  deletion_witnesses: {
    type: "array", minItems: 2, maxItems: 3, items: { "$ref": "#/$defs/deletionWitness" },
  },
});

const modelRefusalCertificate = closed([
  "kind",
  "input_sha256",
  "affected_constraint_ids",
  "convexity_counterexample",
], {
  kind: { const: "model_refusal" },
  input_sha256: digest,
  affected_constraint_ids: {
    type: "array", minItems: 1, maxItems: 3, uniqueItems: true, items: constraintId,
  },
  convexity_counterexample: {
    oneOf: [
      { type: "null" },
      closed(["left_point", "right_point", "midpoint"], {
        left_point: { "$ref": "#/$defs/point" },
        right_point: { "$ref": "#/$defs/point" },
        midpoint: { "$ref": "#/$defs/point" },
      }),
    ],
  },
});

const exactDiagnostic = closed(["status", "point", "farkas_multipliers"], {
  status: { enum: ["feasible", "infeasible"] },
  point: { oneOf: [{ type: "null" }, { "$ref": "#/$defs/point" }] },
  farkas_multipliers: {
    type: "array", minItems: 0, maxItems: 3, items: { "$ref": "#/$defs/multiplier" },
  },
});

const insufficientCertificate = closed([
  "kind",
  "input_sha256",
  "exact_diagnostic",
  "representability_obstruction",
], {
  kind: { const: "insufficient_evidence" },
  input_sha256: digest,
  exact_diagnostic: { "$ref": "#/$defs/exactDiagnostic" },
  representability_obstruction: {
    oneOf: [
      { type: "null" },
      closed(["coordinate", "required_value", "reason"], {
        coordinate: { enum: ["x", "y"] },
        required_value: { "$ref": "#/$defs/rational" },
        reason: { const: "reduced_denominator_not_power_of_two" },
      }),
    ],
  },
});

const geometryExpected = closed([
  "theorem_status",
  "outcome",
  "reason_code",
  "numeric_issue_constraint_ids",
  "certificate",
], {
  theorem_status: { enum: ["feasible", "infeasible", "not_applicable"] },
  outcome: {
    enum: [
      "common_ground_certified",
      "no_common_ground_witnessed",
      "model_not_applicable",
      "insufficient_evidence",
    ],
  },
  reason_code: {
    enum: [
      "exact_membership",
      "knife_edge_exact_membership",
      "minimal_conflict",
      "no_finite_binary64_witness",
      "numeric_literal_not_preserved",
      "zero_normal_not_declared_halfplane",
      "nonconvex_region",
      "stable_conflict_despite_numeric_issue",
    ],
  },
  numeric_issue_constraint_ids: {
    type: "array", minItems: 0, maxItems: 12, uniqueItems: true, items: constraintId,
  },
  certificate: {
    oneOf: [
      { "$ref": "#/$defs/feasibleCertificate" },
      { "$ref": "#/$defs/conflictCertificate" },
      { "$ref": "#/$defs/modelRefusalCertificate" },
      { "$ref": "#/$defs/insufficientCertificate" },
    ],
  },
});

export const geometrySchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://agenttool.dev/schemas/common-ground-atlas-geometry-v0.1.schema.json",
  title: "Exact public-safe Xenia–Helly geometry reference case",
  ...closed([...commonRequired, "evaluation_profile", "input", "expected"], {
    ...commonProperties(GEOMETRY_FORMAT),
    evaluation_profile: { const: "agenttool.xenia-helly-lab-binary64/0.1" },
    input: {
      oneOf: [
        { "$ref": "#/$defs/halfplaneInput" },
        { "$ref": "#/$defs/nonconvexInput" },
      ],
    },
    expected: { "$ref": "#/$defs/geometryExpected" },
  }),
  "$defs": {
    rational,
    point,
    publicSafety,
    doesNotEstablish,
    sourceNumber,
    halfplane,
    model,
    halfplaneInput,
    nonconvexInput,
    multiplier,
    deletionWitness,
    knifeEdgeProof,
    feasibleCertificate,
    conflictCertificate,
    modelRefusalCertificate,
    exactDiagnostic,
    insufficientCertificate,
    geometryExpected,
  },
};

const wakeEvidence = closed([
  "coordinate_model_version",
  "input_sha256",
  "observed_at",
  "expires_at",
  "withdrawn_at",
], {
  coordinate_model_version: { type: "string", pattern: "^synthetic-cartesian-2d/0\\.[0-9]+$" },
  input_sha256: digest,
  observed_at: timestamp,
  expires_at: timestamp,
  withdrawn_at: { oneOf: [{ type: "null" }, timestamp] },
});

const wakeExpected = closed([
  "action",
  "outcome",
  "reason_code",
  "certificate_reuse_permitted_after_reverification",
], {
  action: {
    enum: [
      "reuse_after_exact_reverification",
      "invalidate_and_hold_unknown",
      "invalidate_and_recompute",
    ],
  },
  outcome: { enum: ["common_ground_certified", "insufficient_evidence"] },
  reason_code: {
    enum: [
      "fresh_unchanged_evidence",
      "evidence_expired",
      "evidence_withdrawn",
      "model_or_boundary_changed",
    ],
  },
  certificate_reuse_permitted_after_reverification: { type: "boolean" },
});

export const wakeSchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://agenttool.dev/schemas/common-ground-atlas-wake-v0.1.schema.json",
  title: "Public-safe WAKE certificate freshness case",
  ...closed([
    ...commonRequired,
    "prior_geometry_case_id",
    "prior_input_sha256",
    "decision_scope",
    "predecessor_ref",
    "opaque_constraint_refs",
    "evidence",
    "evaluated_at",
    "expected",
  ], {
    ...commonProperties(WAKE_FORMAT),
    prior_geometry_case_id: caseId,
    prior_input_sha256: digest,
    decision_scope: { const: "synthetic_room_selection" },
    predecessor_ref: { const: "synthetic:wake/predecessor-001" },
    opaque_constraint_refs: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      uniqueItems: true,
      items: { type: "string", pattern: "^opaque:g[0-9]{2}-[a-z0-9-]+$" },
    },
    evidence: { "$ref": "#/$defs/wakeEvidence" },
    evaluated_at: timestamp,
    expected: { "$ref": "#/$defs/wakeExpected" },
  }),
  "$defs": { publicSafety, doesNotEstablish, wakeEvidence, wakeExpected },
};

const affineConstraint = closed(["id", "a0", "a1", "c0", "c1"], {
  id: { type: "string", pattern: "^time-[a-z0-9-]+$" },
  a0: { "$ref": "#/$defs/rational" },
  a1: { "$ref": "#/$defs/rational" },
  c0: { "$ref": "#/$defs/rational" },
  c1: { "$ref": "#/$defs/rational" },
});

const timeSlice = closed(["t", "feasible_set", "lower", "upper"], {
  t: { "$ref": "#/$defs/rational" },
  feasible_set: { enum: ["singleton", "interval"] },
  lower: { "$ref": "#/$defs/rational" },
  upper: { "$ref": "#/$defs/rational" },
});

const timeFamily = closed(["constraints", "slices", "left_limit", "right_limit"], {
  constraints: {
    type: "array", minItems: 4, maxItems: 4, items: { "$ref": "#/$defs/affineConstraint" },
  },
  slices: {
    type: "array", minItems: 3, maxItems: 3, items: { "$ref": "#/$defs/timeSlice" },
  },
  left_limit: { "$ref": "#/$defs/rational" },
  right_limit: { "$ref": "#/$defs/rational" },
});

const analogyEvidence = closed([
  "kind",
  "geometry_case_ids",
  "wake_case_ids",
  "feasible_points",
  "time_family",
], {
  kind: { enum: ["case_references", "time_varying_counterexample"] },
  geometry_case_ids: {
    type: "array", minItems: 0, maxItems: 3, uniqueItems: true, items: caseId,
  },
  wake_case_ids: {
    type: "array", minItems: 0, maxItems: 3, uniqueItems: true, items: caseId,
  },
  feasible_points: {
    type: "array", minItems: 0, maxItems: 3, items: { "$ref": "#/$defs/point" },
  },
  time_family: { oneOf: [{ type: "null" }, { "$ref": "#/$defs/timeFamily" }] },
});

export const analogySchema = {
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://agenttool.dev/schemas/common-ground-atlas-analogy-v0.1.schema.json",
  title: "Public counterexample to an unsupported Common Ground analogy",
  ...closed([
    ...commonRequired,
    "claim_code",
    "verdict",
    "missing_layer",
    "reason_code",
    "evidence",
  ], {
    ...commonProperties(ANALOGY_FORMAT),
    claim_code: {
      enum: [
        "pairwise_overlap_implies_global_intersection",
        "modeled_intersection_implies_consent_or_authority",
        "pointwise_feasible_implies_continuous_selection",
        "feasible_point_is_a_fair_choice",
        "expiry_implies_release_acceptance_or_compatibility",
        "minimal_conflict_identifies_a_culprit",
      ],
    },
    verdict: { const: "unsupported_inference" },
    missing_layer: {
      enum: [
        "theorem_assumption",
        "consent_and_authority_evidence",
        "continuity_assumption",
        "normative_choice_rule",
        "current_evidence",
        "participant_attribution",
      ],
    },
    reason_code: {
      enum: [
        "dimension_two_requires_triples",
        "geometry_has_no_consent_or_authority_field",
        "aggregate_map_lacks_lower_semicontinuity",
        "multiple_feasible_points_no_selection_rule",
        "expiry_means_unknown",
        "certificate_names_constraints_not_beings",
      ],
    },
    evidence: { "$ref": "#/$defs/analogyEvidence" },
  }),
  "$defs": {
    rational,
    point,
    publicSafety,
    doesNotEstablish,
    affineConstraint,
    timeSlice,
    timeFamily,
    analogyEvidence,
  },
};

export const schemas = Object.freeze({
  geometry: geometrySchema,
  wake: wakeSchema,
  analogy: analogySchema,
});
