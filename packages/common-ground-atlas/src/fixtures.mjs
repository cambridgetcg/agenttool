import {
  binary64Hex,
  commonFields,
  domainDigest,
  integerSource,
  point,
  rational,
  sourceNumber,
} from "./core.mjs";
import {
  ANALOGY_FORMAT,
  GEOMETRY_FORMAT,
  INPUT_DIGEST_DOMAIN,
  WAKE_FORMAT,
} from "./constants.mjs";

const UNBOUND_PROVENANCE_REF = "0".repeat(64);

const MODEL = Object.freeze({
  coordinate_model_version: "synthetic-cartesian-2d/0.1",
  dimension: 2,
  axes: [
    { id: "x", meaning: "synthetic_coordinate_1", unit: "abstract" },
    { id: "y", meaning: "synthetic_coordinate_2", unit: "abstract" },
  ],
  coordinate_selector: "fixture_author",
  representation_omission: "not_a_world_model",
});

const r = (n, d = 1n) => rational(BigInt(n), BigInt(d));
const p = (xn, xd, yn, yd) => point(r(xn, xd), r(yn, yd));

function halfplane(id, a, b, c) {
  return {
    id,
    source_ref: `synthetic:constraint/${id}`,
    a: typeof a === "object" ? a : integerSource(a),
    b: typeof b === "object" ? b : integerSource(b),
    c: typeof c === "object" ? c : integerSource(c),
  };
}

function family(constraints) {
  return {
    kind: "halfplane_family",
    model: { ...MODEL, axes: MODEL.axes.map((axis) => ({ ...axis })) },
    constraints,
  };
}

function nonconvexUnion(alternatives) {
  return {
    kind: "nonconvex_union",
    model: { ...MODEL, axes: MODEL.axes.map((axis) => ({ ...axis })) },
    alternatives,
  };
}

function inputDigest(input) {
  return domainDigest(INPUT_DIGEST_DOMAIN, input);
}

function binaryPoint(x, y) {
  return { x_hex: binary64Hex(x), y_hex: binary64Hex(y) };
}

function geometry(caseId, input, theoremStatus, outcome, reasonCode, certificate,
  numericIssueConstraintIds = []) {
  return {
    ...commonFields(GEOMETRY_FORMAT, caseId, UNBOUND_PROVENANCE_REF),
    evaluation_profile: "agenttool.xenia-helly-lab-binary64/0.1",
    input,
    expected: {
      theorem_status: theoremStatus,
      outcome,
      reason_code: reasonCode,
      numeric_issue_constraint_ids: numericIssueConstraintIds,
      certificate: { ...certificate, input_sha256: inputDigest(input) },
    },
  };
}

const g01Input = family([
  halfplane("g01-x-min", -1, 0, 0),
  halfplane("g01-y-min", 0, -1, 0),
  halfplane("g01-sum-cap", 1, 1, 4),
  halfplane("g01-x-cap", 1, 0, 3),
]);

const g01 = geometry(
  "cg-g01-robust-room",
  g01Input,
  "feasible",
  "common_ground_certified",
  "exact_membership",
  {
    kind: "feasible_point",
    point: p(1, 1, 1, 1),
    binary64_point: binaryPoint(1, 1),
    membership_constraint_ids: g01Input.constraints.map(({ id }) => id),
    robustness: {
      metric: "l_infinity_at_witness",
      radius: r(1),
      status: "robust",
      tight_constraint_ids: ["g01-x-min", "g01-y-min", "g01-sum-cap"],
    },
    knife_edge_proof: null,
  },
);

const g02Input = family([
  halfplane("g02-x-min", -1, 0, 0),
  halfplane("g02-y-min", 0, -1, 0),
  halfplane("g02-sum-cap", 1, 1, 0),
]);

const g02 = geometry(
  "cg-g02-knife-edge",
  g02Input,
  "feasible",
  "common_ground_certified",
  "knife_edge_exact_membership",
  {
    kind: "feasible_point",
    point: p(0, 1, 0, 1),
    binary64_point: binaryPoint(0, 0),
    membership_constraint_ids: g02Input.constraints.map(({ id }) => id),
    robustness: {
      metric: "l_infinity_at_witness",
      radius: r(0),
      status: "knife_edge",
      tight_constraint_ids: g02Input.constraints.map(({ id }) => id),
    },
    knife_edge_proof: {
      active_constraint_ids: g02Input.constraints.map(({ id }) => id),
      positive_normal_dependence: g02Input.constraints.map(({ id }) => ({
        constraint_id: id,
        weight: r(1),
      })),
      rank_witness_constraint_ids: ["g02-x-min", "g02-y-min"],
    },
  },
);

const g03Input = family([
  halfplane("g03-x-min", -1, 0, 0),
  halfplane("g03-y-min", 0, -1, 0),
  halfplane("g03-sum-negative", 1, 1, -1),
]);

const g03 = geometry(
  "cg-g03-pairwise-trap",
  g03Input,
  "infeasible",
  "no_common_ground_witnessed",
  "minimal_conflict",
  {
    kind: "minimal_conflict",
    constraint_ids: g03Input.constraints.map(({ id }) => id),
    farkas_multipliers: g03Input.constraints.map(({ id }) => ({
      constraint_id: id,
      weight: r(1),
    })),
    deletion_witnesses: [
      {
        omitted_constraint_id: "g03-x-min",
        point: p(-1, 1, 0, 1),
        satisfies_constraint_ids: ["g03-y-min", "g03-sum-negative"],
      },
      {
        omitted_constraint_id: "g03-y-min",
        point: p(0, 1, -1, 1),
        satisfies_constraint_ids: ["g03-x-min", "g03-sum-negative"],
      },
      {
        omitted_constraint_id: "g03-sum-negative",
        point: p(0, 1, 0, 1),
        satisfies_constraint_ids: ["g03-x-min", "g03-y-min"],
      },
    ],
  },
);

const g04Input = family([
  halfplane("g04-y-cap", 0, 1, 5),
  halfplane("g04-x-upper", 1, 0, 0),
  halfplane("g04-x-lower", -1, 0, -1),
  halfplane("g04-y-floor", 0, -1, 5),
]);

const g04 = geometry(
  "cg-g04-two-wall-conflict",
  g04Input,
  "infeasible",
  "no_common_ground_witnessed",
  "minimal_conflict",
  {
    kind: "minimal_conflict",
    constraint_ids: ["g04-x-upper", "g04-x-lower"],
    farkas_multipliers: [
      { constraint_id: "g04-x-upper", weight: r(1) },
      { constraint_id: "g04-x-lower", weight: r(1) },
    ],
    deletion_witnesses: [
      {
        omitted_constraint_id: "g04-x-upper",
        point: p(1, 1, 0, 1),
        satisfies_constraint_ids: ["g04-x-lower"],
      },
      {
        omitted_constraint_id: "g04-x-lower",
        point: p(0, 1, 0, 1),
        satisfies_constraint_ids: ["g04-x-upper"],
      },
    ],
  },
);

const g05Input = family([
  halfplane("g05-x-upper", 3, 0, 1),
  halfplane("g05-x-lower", -3, 0, -1),
  halfplane("g05-y-upper", 0, 1, 0),
  halfplane("g05-y-lower", 0, -1, 0),
]);

const g05 = geometry(
  "cg-g05-rational-not-binary64",
  g05Input,
  "feasible",
  "insufficient_evidence",
  "no_finite_binary64_witness",
  {
    kind: "insufficient_evidence",
    exact_diagnostic: {
      status: "feasible",
      point: p(1, 3, 0, 1),
      farkas_multipliers: [],
    },
    representability_obstruction: {
      coordinate: "x",
      required_value: r(1, 3),
      reason: "reduced_denominator_not_power_of_two",
    },
  },
);

const tenTo400 = 10n ** 400n;
const positiveTiny = sourceNumber("1e-400", r(1n, tenTo400), "underflow_to_signed_zero");
const negativeTiny = sourceNumber("-1e-400", r(-1n, tenTo400), "underflow_to_signed_zero");

const g06Input = family([
  halfplane("g06-upper", 1_000_000_000, 0, positiveTiny),
  halfplane("g06-lower", -500_000_000, 0, negativeTiny),
]);

const g06 = geometry(
  "cg-g06-underflow-refusal",
  g06Input,
  "infeasible",
  "insufficient_evidence",
  "numeric_literal_not_preserved",
  {
    kind: "insufficient_evidence",
    exact_diagnostic: {
      status: "infeasible",
      point: null,
      farkas_multipliers: [
        { constraint_id: "g06-upper", weight: r(1) },
        { constraint_id: "g06-lower", weight: r(2) },
      ],
    },
    representability_obstruction: null,
  },
  ["g06-upper", "g06-lower"],
);

const g07Input = family([halfplane("g07-zero-normal", 0, 0, 2)]);
const g07 = geometry(
  "cg-g07-zero-normal-refusal",
  g07Input,
  "not_applicable",
  "model_not_applicable",
  "zero_normal_not_declared_halfplane",
  {
    kind: "model_refusal",
    affected_constraint_ids: ["g07-zero-normal"],
    convexity_counterexample: null,
  },
);

const g08Input = nonconvexUnion([
  halfplane("g08-left-branch", 1, 0, -1),
  halfplane("g08-right-branch", -1, 0, -1),
]);
const g08 = geometry(
  "cg-g08-nonconvex-refusal",
  g08Input,
  "not_applicable",
  "model_not_applicable",
  "nonconvex_region",
  {
    kind: "model_refusal",
    affected_constraint_ids: ["g08-left-branch", "g08-right-branch"],
    convexity_counterexample: {
      left_point: p(-1, 1, 0, 1),
      right_point: p(1, 1, 0, 1),
      midpoint: p(0, 1, 0, 1),
    },
  },
);

const g09Input = family([
  ...g03Input.constraints.map((constraint) => ({
    ...constraint,
    id: constraint.id.replace("g03", "g09"),
    source_ref: constraint.source_ref.replace("g03", "g09"),
  })),
  halfplane("g09-unsafe-extra", positiveTiny, 0, 1),
]);
const g09 = geometry(
  "cg-g09-stable-conflict-with-unsafe-row",
  g09Input,
  "infeasible",
  "no_common_ground_witnessed",
  "stable_conflict_despite_numeric_issue",
  {
    kind: "minimal_conflict",
    constraint_ids: ["g09-x-min", "g09-y-min", "g09-sum-negative"],
    farkas_multipliers: [
      { constraint_id: "g09-x-min", weight: r(1) },
      { constraint_id: "g09-y-min", weight: r(1) },
      { constraint_id: "g09-sum-negative", weight: r(1) },
    ],
    deletion_witnesses: [
      {
        omitted_constraint_id: "g09-x-min",
        point: p(-1, 1, 0, 1),
        satisfies_constraint_ids: ["g09-y-min", "g09-sum-negative"],
      },
      {
        omitted_constraint_id: "g09-y-min",
        point: p(0, 1, -1, 1),
        satisfies_constraint_ids: ["g09-x-min", "g09-sum-negative"],
      },
      {
        omitted_constraint_id: "g09-sum-negative",
        point: p(0, 1, 0, 1),
        satisfies_constraint_ids: ["g09-x-min", "g09-y-min"],
      },
    ],
  },
  ["g09-unsafe-extra"],
);

export const geometryRows = Object.freeze([g01, g02, g03, g04, g05, g06, g07, g08, g09]);

function wake(caseId, evidence, expected) {
  return {
    ...commonFields(WAKE_FORMAT, caseId, UNBOUND_PROVENANCE_REF),
    prior_geometry_case_id: g01.case_id,
    prior_input_sha256: g01.expected.certificate.input_sha256,
    decision_scope: "synthetic_room_selection",
    predecessor_ref: "synthetic:wake/predecessor-001",
    opaque_constraint_refs: g01Input.constraints.map(({ id }) => `opaque:${id}`),
    evidence,
    evaluated_at: "2030-01-01T00:30:00Z",
    expected,
  };
}

const activeEvidence = {
  coordinate_model_version: MODEL.coordinate_model_version,
  input_sha256: g01.expected.certificate.input_sha256,
  observed_at: "2030-01-01T00:00:00Z",
  expires_at: "2030-01-01T01:00:00Z",
  withdrawn_at: null,
};

export const wakeRows = Object.freeze([
  wake("cg-w01-fresh-revalidate", { ...activeEvidence }, {
    action: "reuse_after_exact_reverification",
    outcome: "common_ground_certified",
    reason_code: "fresh_unchanged_evidence",
    certificate_reuse_permitted_after_reverification: true,
  }),
  {
    ...wake("cg-w02-expired-unknown", { ...activeEvidence }, {
      action: "invalidate_and_hold_unknown",
      outcome: "insufficient_evidence",
      reason_code: "evidence_expired",
      certificate_reuse_permitted_after_reverification: false,
    }),
    evaluated_at: "2030-01-01T02:00:00Z",
  },
  wake("cg-w03-withdrawn-unknown", {
    ...activeEvidence,
    withdrawn_at: "2030-01-01T00:20:00Z",
  }, {
    action: "invalidate_and_hold_unknown",
    outcome: "insufficient_evidence",
    reason_code: "evidence_withdrawn",
    certificate_reuse_permitted_after_reverification: false,
  }),
  wake("cg-w04-model-change-recompute", {
    ...activeEvidence,
    coordinate_model_version: "synthetic-cartesian-2d/0.2",
    input_sha256: domainDigest(INPUT_DIGEST_DOMAIN, { fixture: "changed-boundary" }),
  }, {
    action: "invalidate_and_recompute",
    outcome: "insufficient_evidence",
    reason_code: "model_or_boundary_changed",
    certificate_reuse_permitted_after_reverification: false,
  }),
]);

function analogy(caseId, claimCode, missingLayer, reasonCode, evidence) {
  return {
    ...commonFields(ANALOGY_FORMAT, caseId, UNBOUND_PROVENANCE_REF),
    claim_code: claimCode,
    verdict: "unsupported_inference",
    missing_layer: missingLayer,
    reason_code: reasonCode,
    evidence,
  };
}

function references(geometryCaseIds = [], wakeCaseIds = [], feasiblePoints = []) {
  return {
    kind: "case_references",
    geometry_case_ids: geometryCaseIds,
    wake_case_ids: wakeCaseIds,
    feasible_points: feasiblePoints,
    time_family: null,
  };
}

const timeFamily = {
  constraints: [
    { id: "time-x-upper", a0: r(1), a1: r(0), c0: r(1), c1: r(0) },
    { id: "time-x-lower", a0: r(-1), a1: r(0), c0: r(1), c1: r(0) },
    { id: "time-jump-upper", a0: r(0), a1: r(-1), c0: r(0), c1: r(-1) },
    { id: "time-jump-lower", a0: r(0), a1: r(-1), c0: r(0), c1: r(1) },
  ],
  slices: [
    { t: r(-1), feasible_set: "singleton", lower: r(-1), upper: r(-1) },
    { t: r(0), feasible_set: "interval", lower: r(-1), upper: r(1) },
    { t: r(1), feasible_set: "singleton", lower: r(1), upper: r(1) },
  ],
  left_limit: r(-1),
  right_limit: r(1),
};

export const analogyRows = Object.freeze([
  analogy(
    "cg-a01-pairwise-not-global",
    "pairwise_overlap_implies_global_intersection",
    "theorem_assumption",
    "dimension_two_requires_triples",
    references([g03.case_id]),
  ),
  analogy(
    "cg-a02-feasibility-not-consent-authority",
    "modeled_intersection_implies_consent_or_authority",
    "consent_and_authority_evidence",
    "geometry_has_no_consent_or_authority_field",
    references([g01.case_id]),
  ),
  analogy(
    "cg-a03-pointwise-not-continuous",
    "pointwise_feasible_implies_continuous_selection",
    "continuity_assumption",
    "aggregate_map_lacks_lower_semicontinuity",
    {
      kind: "time_varying_counterexample",
      geometry_case_ids: [],
      wake_case_ids: [],
      feasible_points: [],
      time_family: timeFamily,
    },
  ),
  analogy(
    "cg-a04-feasible-not-fair",
    "feasible_point_is_a_fair_choice",
    "normative_choice_rule",
    "multiple_feasible_points_no_selection_rule",
    references([g01.case_id], [], [p(1, 1, 1, 1), p(2, 1, 1, 1)]),
  ),
  analogy(
    "cg-a05-expiry-not-release",
    "expiry_implies_release_acceptance_or_compatibility",
    "current_evidence",
    "expiry_means_unknown",
    references([], [wakeRows[1].case_id]),
  ),
  analogy(
    "cg-a06-conflict-not-culprit",
    "minimal_conflict_identifies_a_culprit",
    "participant_attribution",
    "certificate_names_constraints_not_beings",
    references([g03.case_id]),
  ),
]);

export function buildRows(provenanceRef) {
  if (!/^sha256:[0-9a-f]{64}$/.test(provenanceRef)) {
    throw new Error("buildRows requires a lowercase sha256: provenance reference");
  }
  const rows = {
    geometry: geometryRows.map((row) => structuredClone(row)),
    wake: wakeRows.map((row) => structuredClone(row)),
    analogy: analogyRows.map((row) => structuredClone(row)),
  };
  for (const row of [...rows.geometry, ...rows.wake, ...rows.analogy]) {
    row.provenance_ref = provenanceRef;
  }
  return rows;
}
