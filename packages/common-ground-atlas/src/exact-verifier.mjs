import {
  absolute,
  binary64Hex,
  binary64Rational,
  compare,
  domainDigest,
  parseRational,
} from "./core.mjs";
import { INPUT_DIGEST_DOMAIN } from "./constants.mjs";

function fail(message) {
  throw new Error(message);
}

const EXPECTED_PUBLIC_SAFETY = Object.freeze({
  origin: "human_directed_agent_authored_synthetic",
  contains_personal_data: false,
  contains_private_constraints: false,
  contains_real_participant_records: false,
  contains_credentials: false,
  copied_agent_traces: false,
  copied_fictional_story_content: false,
});

const EXPECTED_NONCLAIMS = Object.freeze({
  consensus: true,
  consent: true,
  fairness: true,
  authority: true,
  identity_continuity: true,
  continuous_selection: true,
  culprit: true,
});

function exactObject(value, expected, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).length !== Object.keys(expected).length
      || Object.entries(expected).some(([key, expectedValue]) =>
        !Object.hasOwn(value, key) || value[key] !== expectedValue)) {
    fail(`${label} mismatch`);
  }
}

function verifyCommon(row, provenanceRef, category, format) {
  if (!new RegExp(`^cg-${category}[0-9]{2}-[a-z0-9-]+$`).test(row.case_id)) {
    fail("case id/category mismatch");
  }
  if (row._format !== format || row.provenance_ref !== provenanceRef
      || row.training_eligible !== false || row.visibility !== "public_reference"
      || row.synthetic !== true) {
    fail(`${row.case_id} provenance/training wall mismatch`);
  }
  exactObject(row.public_safety, EXPECTED_PUBLIC_SAFETY, "public safety");
  exactObject(row.does_not_establish, EXPECTED_NONCLAIMS, "nonclaims");
}

function fraction(value) {
  return parseRational(value);
}

function make(n, d = 1n) {
  if (d === 0n) fail("division by zero");
  if (d < 0n) return make(-n, -d);
  return { n, d };
}

function plus(left, right) {
  return make(left.n * right.d + right.n * left.d, left.d * right.d);
}

function minus(left, right) {
  return make(left.n * right.d - right.n * left.d, left.d * right.d);
}

function times(left, right) {
  return make(left.n * right.n, left.d * right.d);
}

function divide(left, right) {
  if (right.n === 0n) fail("division by zero");
  return make(left.n * right.d, left.d * right.n);
}

function equal(left, right) {
  return left.n * right.d === right.n * left.d;
}

function isPowerOfTwo(value) {
  return value > 0n && (value & (value - 1n)) === 0n;
}

function exactScalar(source) {
  return fraction(source.exact);
}

function decimalLiteralRational(literal) {
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(literal);
  if (!match) fail(`noncanonical decimal literal ${literal}`);
  const integerDigits = match[2] ?? "0";
  const fractionalDigits = match[3] ?? match[4] ?? "";
  const exponent = BigInt(match[5] ?? "0") - BigInt(fractionalDigits.length);
  if (exponent < -10_000n || exponent > 10_000n) fail("decimal exponent is outside verifier bounds");
  const sign = match[1] === "-" ? -1n : 1n;
  const coefficient = sign * BigInt(`${integerDigits}${fractionalDigits}`);
  return exponent >= 0n
    ? make(coefficient * (10n ** exponent))
    : make(coefficient, 10n ** (-exponent));
}

function constraintMap(input) {
  const constraints = input.kind === "halfplane_family"
    ? input.constraints
    : input.alternatives;
  const map = new Map();
  for (const constraint of constraints) {
    if (map.has(constraint.id)) fail(`duplicate constraint id ${constraint.id}`);
    if (constraint.source_ref !== `synthetic:constraint/${constraint.id}`) {
      fail(`source ref mismatch for ${constraint.id}`);
    }
    map.set(constraint.id, constraint);
  }
  return map;
}

function verifySourceNumber(source) {
  const exact = exactScalar(source);
  const literalExact = decimalLiteralRational(source.literal);
  if (!equal(literalExact, exact)) fail(`literal/exact mismatch for ${source.literal}`);
  if (binary64Hex(Number(source.literal)) !== source.binary64_hex) {
    fail(`literal/bit mismatch for ${source.literal}`);
  }
  const decoded = fraction(binary64Rational(source.binary64_hex));
  if (source.parse_relation === "exact") {
    if (!equal(exact, decoded)) fail(`non-exact binary64 claim for ${source.literal}`);
    if (exact.n === 0n && source.binary64_hex !== "0000000000000000") {
      fail("canonical exact zero must use positive-zero bits");
    }
  } else if (source.parse_relation === "underflow_to_signed_zero") {
    if (exact.n === 0n || decoded.n !== 0n) fail("underflow relation is not nonzero-to-zero");
    const negativeBits = source.binary64_hex === "8000000000000000";
    if (source.binary64_hex !== "0000000000000000" && !negativeBits) {
      fail("underflow relation must bind signed zero");
    }
    if ((exact.n < 0n) !== negativeBits) fail("underflow signed-zero direction mismatch");
  } else {
    fail(`unknown parse relation ${source.parse_relation}`);
  }
}

function verifyInput(input) {
  if (input.model.dimension !== 2) fail("only dimension two is supported");
  const axes = input.model.axes.map(({ id }) => id);
  if (axes.join(",") !== "x,y") fail("axes must be ordered x,y");
  const constraints = constraintMap(input);
  for (const constraint of constraints.values()) {
    verifySourceNumber(constraint.a);
    verifySourceNumber(constraint.b);
    verifySourceNumber(constraint.c);
  }
  return constraints;
}

function pointCoordinates(point) {
  return { x: fraction(point.x), y: fraction(point.y) };
}

function residual(point, constraint) {
  const coordinates = pointCoordinates(point);
  return minus(
    plus(
      times(exactScalar(constraint.a), coordinates.x),
      times(exactScalar(constraint.b), coordinates.y),
    ),
    exactScalar(constraint.c),
  );
}

function satisfies(point, constraint) {
  return compare(residual(point, constraint), make(0n)) <= 0;
}

function sameIds(actual, expected, label) {
  if (actual.join("\0") !== expected.join("\0")) {
    fail(`${label} mismatch: ${actual.join(",")} != ${expected.join(",")}`);
  }
}

function verifyFarkas(entries, constraints, expectedIds = null) {
  const ids = entries.map(({ constraint_id: id }) => id);
  if (new Set(ids).size !== ids.length) fail("duplicate Farkas multiplier id");
  if (expectedIds) sameIds(ids, expectedIds, "Farkas ids");
  let a = make(0n);
  let b = make(0n);
  let c = make(0n);
  let positive = false;
  for (const entry of entries) {
    const constraint = constraints.get(entry.constraint_id);
    if (!constraint) fail(`unknown Farkas constraint ${entry.constraint_id}`);
    const weight = fraction(entry.weight);
    if (compare(weight, make(0n)) < 0) fail("negative Farkas multiplier");
    positive ||= weight.n > 0n;
    a = plus(a, times(weight, exactScalar(constraint.a)));
    b = plus(b, times(weight, exactScalar(constraint.b)));
    c = plus(c, times(weight, exactScalar(constraint.c)));
  }
  if (!positive || a.n !== 0n || b.n !== 0n || compare(c, make(0n)) >= 0) {
    fail("invalid Farkas contradiction");
  }
}

function verifyFeasibleCertificate(row, constraints, certificate) {
  const ids = [...constraints.keys()];
  sameIds(certificate.membership_constraint_ids, ids, "membership ids");
  for (const constraint of constraints.values()) {
    if (!satisfies(certificate.point, constraint)) {
      fail(`${row.case_id} point violates ${constraint.id}`);
    }
  }
  if (certificate.binary64_point) {
    const x = fraction(binary64Rational(certificate.binary64_point.x_hex));
    const y = fraction(binary64Rational(certificate.binary64_point.y_hex));
    const exact = pointCoordinates(certificate.point);
    if (!equal(x, exact.x) || !equal(y, exact.y)) fail("binary64 point does not bind exact point");
  }

  let minimum = null;
  const tight = [];
  for (const constraint of constraints.values()) {
    const a = absolute(exactScalar(constraint.a));
    const b = absolute(exactScalar(constraint.b));
    const norm = plus(a, b);
    if (norm.n === 0n) fail("feasible certificate contains zero normal");
    const slack = make(-residual(certificate.point, constraint).n,
      residual(certificate.point, constraint).d);
    const radius = divide(slack, norm);
    if (minimum === null || compare(radius, minimum) < 0) {
      minimum = radius;
      tight.length = 0;
      tight.push(constraint.id);
    } else if (compare(radius, minimum) === 0) {
      tight.push(constraint.id);
    }
  }
  const claimedRadius = fraction(certificate.robustness.radius);
  if (!equal(claimedRadius, minimum)) fail("incorrect exact L-infinity radius");
  sameIds(certificate.robustness.tight_constraint_ids, tight, "tight ids");
  const expectedStatus = claimedRadius.n === 0n ? "knife_edge" : "robust";
  if (certificate.robustness.status !== expectedStatus) fail("robustness status mismatch");

  if (expectedStatus === "robust") {
    if (certificate.knife_edge_proof !== null) fail("robust point must not carry knife proof");
    return;
  }
  const proof = certificate.knife_edge_proof;
  if (!proof) fail("knife-edge point needs rigidity proof");
  sameIds(proof.active_constraint_ids, tight, "active knife ids");
  for (const id of proof.active_constraint_ids) {
    if (residual(certificate.point, constraints.get(id)).n !== 0n) fail("knife constraint not active");
  }
  for (const entry of proof.positive_normal_dependence) {
    if (fraction(entry.weight).n <= 0n) fail("knife dependence must be strictly positive");
  }
  const dependenceIds = proof.positive_normal_dependence.map(({ constraint_id: id }) => id);
  sameIds(dependenceIds, proof.active_constraint_ids, "knife dependence ids");
  let sumA = make(0n);
  let sumB = make(0n);
  for (const entry of proof.positive_normal_dependence) {
    const weight = fraction(entry.weight);
    const constraint = constraints.get(entry.constraint_id);
    sumA = plus(sumA, times(weight, exactScalar(constraint.a)));
    sumB = plus(sumB, times(weight, exactScalar(constraint.b)));
  }
  if (sumA.n !== 0n || sumB.n !== 0n) fail("knife normal dependence is not zero");
  const [leftId, rightId] = proof.rank_witness_constraint_ids;
  if (!proof.active_constraint_ids.includes(leftId)
      || !proof.active_constraint_ids.includes(rightId)) {
    fail("knife rank witness must use active constraints");
  }
  const left = constraints.get(leftId);
  const right = constraints.get(rightId);
  const determinant = minus(
    times(exactScalar(left.a), exactScalar(right.b)),
    times(exactScalar(right.a), exactScalar(left.b)),
  );
  if (determinant.n === 0n) fail("knife rank witness is singular");
}

function verifyConflictCertificate(constraints, certificate) {
  verifyFarkas(certificate.farkas_multipliers, constraints, certificate.constraint_ids);
  if (certificate.deletion_witnesses.length !== certificate.constraint_ids.length) {
    fail("minimal conflict needs one deletion witness per row");
  }
  sameIds(
    certificate.deletion_witnesses.map(({ omitted_constraint_id: id }) => id),
    certificate.constraint_ids,
    "deletion omitted ids",
  );
  for (const witness of certificate.deletion_witnesses) {
    const expected = certificate.constraint_ids.filter((id) => id !== witness.omitted_constraint_id);
    sameIds(witness.satisfies_constraint_ids, expected, "deletion proper-subfamily ids");
    for (const id of expected) {
      if (!satisfies(witness.point, constraints.get(id))) fail(`invalid deletion witness for ${id}`);
    }
  }
}

function verifyInsufficientCertificate(row, constraints, certificate) {
  const diagnostic = certificate.exact_diagnostic;
  if (diagnostic.status === "feasible") {
    if (!diagnostic.point || diagnostic.farkas_multipliers.length !== 0) {
      fail("feasible diagnostic shape mismatch");
    }
    for (const constraint of constraints.values()) {
      if (!satisfies(diagnostic.point, constraint)) fail("diagnostic rational point is invalid");
    }
  } else {
    if (diagnostic.point !== null || diagnostic.farkas_multipliers.length === 0) {
      fail("infeasible diagnostic shape mismatch");
    }
    verifyFarkas(diagnostic.farkas_multipliers, constraints);
  }
  const obstruction = certificate.representability_obstruction;
  if (obstruction) {
    if (diagnostic.status !== "feasible") {
      fail("representability obstruction requires a feasible exact diagnostic");
    }
    const required = fraction(obstruction.required_value);
    if (isPowerOfTwo(required.d)) fail("claimed non-dyadic value is dyadic");
    const coordinate = obstruction.coordinate;
    const activeOpposed = [...constraints.values()].filter((constraint) => {
      const other = exactScalar(coordinate === "x" ? constraint.b : constraint.a);
      const normal = exactScalar(coordinate === "x" ? constraint.a : constraint.b);
      if (other.n !== 0n || normal.n === 0n) return false;
      const boundary = divide(exactScalar(constraint.c), normal);
      return equal(boundary, required);
    });
    if (activeOpposed.length < 2) fail("representability obstruction lacks opposing equality walls");
    const signs = new Set(activeOpposed.map((constraint) =>
      exactScalar(coordinate === "x" ? constraint.a : constraint.b).n < 0n ? -1 : 1));
    if (signs.size !== 2) fail("representability walls are not opposed");
  }
  if (row.expected.reason_code === "no_finite_binary64_witness" && !obstruction) {
    fail("missing binary64 representability obstruction");
  }
}

function inUnion(pointValue, alternatives) {
  return alternatives.some((constraint) => satisfies(pointValue, constraint));
}

function verifyModelRefusal(row, constraints, certificate) {
  if (row.expected.reason_code === "zero_normal_not_declared_halfplane") {
    if (certificate.affected_constraint_ids.length !== 1) fail("zero-normal refusal scope mismatch");
    const constraint = constraints.get(certificate.affected_constraint_ids[0]);
    if (exactScalar(constraint.a).n !== 0n || exactScalar(constraint.b).n !== 0n) {
      fail("model refusal does not identify a zero normal");
    }
    if (certificate.convexity_counterexample !== null) fail("zero normal needs no convexity example");
    return;
  }
  if (row.expected.reason_code !== "nonconvex_region" || row.input.kind !== "nonconvex_union") {
    fail("unexpected model refusal reason");
  }
  sameIds(certificate.affected_constraint_ids, [...constraints.keys()], "nonconvex refusal scope");
  const example = certificate.convexity_counterexample;
  if (!example) fail("nonconvex refusal needs a counterexample");
  if (!inUnion(example.left_point, row.input.alternatives)
      || !inUnion(example.right_point, row.input.alternatives)
      || inUnion(example.midpoint, row.input.alternatives)) {
    fail("invalid nonconvexity membership counterexample");
  }
  const left = pointCoordinates(example.left_point);
  const right = pointCoordinates(example.right_point);
  const midpoint = pointCoordinates(example.midpoint);
  const two = make(2n);
  if (!equal(midpoint.x, divide(plus(left.x, right.x), two))
      || !equal(midpoint.y, divide(plus(left.y, right.y), two))) {
    fail("convexity counterexample midpoint is not exact");
  }
}

export function verifyGeometryRow(row, provenanceRef) {
  verifyCommon(row, provenanceRef, "g", "agenttool.common-ground-atlas.geometry/0.1");
  const constraints = verifyInput(row.input);
  const expectedDigest = domainDigest(INPUT_DIGEST_DOMAIN, row.input);
  const certificate = row.expected.certificate;
  if (certificate.input_sha256 !== expectedDigest) fail(`${row.case_id} input digest mismatch`);
  const numericIssues = [...constraints.values()]
    .filter((constraint) => [constraint.a, constraint.b, constraint.c]
      .some(({ parse_relation: relation }) => relation !== "exact"))
    .map(({ id }) => id);
  sameIds(row.expected.numeric_issue_constraint_ids, numericIssues, "numeric issue ids");

  const kindByOutcome = {
    common_ground_certified: "feasible_point",
    no_common_ground_witnessed: "minimal_conflict",
    model_not_applicable: "model_refusal",
    insufficient_evidence: "insufficient_evidence",
  };
  if (certificate.kind !== kindByOutcome[row.expected.outcome]) fail("outcome/certificate mismatch");
  if (certificate.kind === "feasible_point") verifyFeasibleCertificate(row, constraints, certificate);
  else if (certificate.kind === "minimal_conflict") verifyConflictCertificate(constraints, certificate);
  else if (certificate.kind === "insufficient_evidence") {
    verifyInsufficientCertificate(row, constraints, certificate);
  } else verifyModelRefusal(row, constraints, certificate);

  const theoremByKind = {
    feasible_point: "feasible",
    minimal_conflict: "infeasible",
    model_refusal: "not_applicable",
  };
  if (certificate.kind !== "insufficient_evidence"
      && row.expected.theorem_status !== theoremByKind[certificate.kind]) {
    fail("theorem/certificate mismatch");
  }
  if (certificate.kind === "insufficient_evidence"
      && row.expected.theorem_status !== certificate.exact_diagnostic.status) {
    fail("insufficient diagnostic/theorem mismatch");
  }

  let expectedReason;
  if (certificate.kind === "feasible_point") {
    if (numericIssues.length !== 0) fail("certified feasible point cannot depend on unsafe literals");
    expectedReason = certificate.robustness.status === "knife_edge"
      ? "knife_edge_exact_membership"
      : "exact_membership";
  } else if (certificate.kind === "minimal_conflict") {
    if (numericIssues.length === 0) {
      expectedReason = "minimal_conflict";
    } else {
      if (certificate.constraint_ids.some((id) => numericIssues.includes(id))) {
        fail("stable conflict certificate depends on a numeric-issue constraint");
      }
      expectedReason = "stable_conflict_despite_numeric_issue";
    }
  } else if (certificate.kind === "insufficient_evidence") {
    if (certificate.representability_obstruction) {
      expectedReason = "no_finite_binary64_witness";
    } else if (numericIssues.length > 0 && certificate.exact_diagnostic.status === "infeasible") {
      expectedReason = "numeric_literal_not_preserved";
    } else {
      fail("insufficient-evidence geometry has no verified reason");
    }
  } else {
    expectedReason = row.input.kind === "nonconvex_union"
      ? "nonconvex_region"
      : "zero_normal_not_declared_halfplane";
  }
  if (row.expected.reason_code !== expectedReason) fail("geometry reason/certificate mismatch");
}

function timestamp(value) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail(`invalid timestamp ${value}`);
  return parsed;
}

export function verifyWakeRow(row, geometryById, provenanceRef) {
  verifyCommon(row, provenanceRef, "w", "agenttool.common-ground-atlas.wake/0.1");
  const prior = geometryById.get(row.prior_geometry_case_id);
  if (!prior) fail(`unknown prior geometry ${row.prior_geometry_case_id}`);
  if (row.prior_input_sha256 !== prior.expected.certificate.input_sha256) {
    fail("prior certificate digest mismatch");
  }
  const expectedOpaque = (prior.input.constraints ?? prior.input.alternatives)
    .map(({ id }) => `opaque:${id}`);
  sameIds(row.opaque_constraint_refs, expectedOpaque, "opaque constraint refs");
  const evaluated = timestamp(row.evaluated_at);
  const observed = timestamp(row.evidence.observed_at);
  const expires = timestamp(row.evidence.expires_at);
  const withdrawnAt = row.evidence.withdrawn_at === null
    ? null
    : timestamp(row.evidence.withdrawn_at);
  if (observed >= expires) fail("WAKE evidence must expire after observation");
  if (observed > evaluated) fail("WAKE evidence cannot be observed after evaluation");
  if (withdrawnAt !== null && withdrawnAt < observed) {
    fail("WAKE evidence cannot be withdrawn before observation");
  }
  const expired = evaluated >= expires;
  const withdrawn = row.evidence.withdrawn_at !== null
    && evaluated >= withdrawnAt;
  const changed = row.evidence.coordinate_model_version
      !== prior.input.model.coordinate_model_version
    || row.evidence.input_sha256 !== row.prior_input_sha256;
  let derived;
  if (withdrawn) derived = ["invalidate_and_hold_unknown", "insufficient_evidence", "evidence_withdrawn", false];
  else if (expired) derived = ["invalidate_and_hold_unknown", "insufficient_evidence", "evidence_expired", false];
  else if (changed) derived = ["invalidate_and_recompute", "insufficient_evidence", "model_or_boundary_changed", false];
  else {
    if (prior.expected.outcome !== "common_ground_certified"
        || prior.expected.certificate.kind !== "feasible_point") {
      fail("fresh WAKE reuse requires a prior feasible certificate");
    }
    derived = ["reuse_after_exact_reverification", "common_ground_certified", "fresh_unchanged_evidence", true];
  }
  const actual = [
    row.expected.action,
    row.expected.outcome,
    row.expected.reason_code,
    row.expected.certificate_reuse_permitted_after_reverification,
  ];
  if (JSON.stringify(actual) !== JSON.stringify(derived)) fail(`${row.case_id} WAKE derivation mismatch`);
}

function intervalAt(timeFamily, tValue) {
  let lower = null;
  let upper = null;
  for (const constraint of timeFamily.constraints) {
    const t = fraction(tValue);
    const a = plus(fraction(constraint.a0), times(fraction(constraint.a1), t));
    const c = plus(fraction(constraint.c0), times(fraction(constraint.c1), t));
    if (a.n === 0n) {
      if (compare(c, make(0n)) < 0) fail("empty zero-normal time constraint");
      continue;
    }
    const boundary = divide(c, a);
    if (a.n > 0n) {
      if (upper === null || compare(boundary, upper) < 0) upper = boundary;
    } else if (lower === null || compare(boundary, lower) > 0) lower = boundary;
  }
  if (lower === null || upper === null || compare(lower, upper) > 0) fail("invalid time slice");
  return { lower, upper };
}

function exactValue(value, numerator, denominator = 1n) {
  return equal(fraction(value), make(numerator, denominator));
}

function verifyTimeCounterexample(family) {
  const expectedConstraints = [
    ["time-x-upper", 1n, 0n, 1n, 0n],
    ["time-x-lower", -1n, 0n, 1n, 0n],
    ["time-jump-upper", 0n, -1n, 0n, -1n],
    ["time-jump-lower", 0n, -1n, 0n, 1n],
  ];
  sameIds(family.constraints.map(({ id }) => id), expectedConstraints.map(([id]) => id),
    "time-family constraint ids");
  family.constraints.forEach((constraint, index) => {
    const [, a0, a1, c0, c1] = expectedConstraints[index];
    if (!exactValue(constraint.a0, a0) || !exactValue(constraint.a1, a1)
        || !exactValue(constraint.c0, c0) || !exactValue(constraint.c1, c1)) {
      fail("time-family coefficient drift");
    }
  });

  const expectedSlices = [
    [-1n, "singleton", -1n, -1n],
    [0n, "interval", -1n, 1n],
    [1n, "singleton", 1n, 1n],
  ];
  if (family.slices.length !== expectedSlices.length) fail("time-family slice count mismatch");
  family.slices.forEach((slice, index) => {
    const [t, kind, lower, upper] = expectedSlices[index];
    if (!exactValue(slice.t, t) || slice.feasible_set !== kind
        || !exactValue(slice.lower, lower) || !exactValue(slice.upper, upper)) {
      fail("time-family declared slice drift");
    }
    const derived = intervalAt(family, slice.t);
    if (!equal(derived.lower, make(lower)) || !equal(derived.upper, make(upper))) {
      fail("time-family slice arithmetic mismatch");
    }
  });

  // The exact template above has constant walls plus t-scaled jump walls.
  // Therefore the -1, 0, and +1 sign cases prove every t<0, t=0, and t>0.
  const left = intervalAt(family, family.slices[0].t);
  const right = intervalAt(family, family.slices[2].t);
  if (!equal(left.lower, left.upper) || !equal(right.lower, right.upper)
      || !equal(fraction(family.left_limit), left.lower)
      || !equal(fraction(family.right_limit), right.lower)
      || equal(left.lower, right.lower)) {
    fail("time-family one-sided selection limits are not proved");
  }
}

export function verifyAnalogyRow(row, geometryById, wakeById, provenanceRef) {
  verifyCommon(row, provenanceRef, "a", "agenttool.common-ground-atlas.analogy/0.1");
  if (row.verdict !== "unsupported_inference") fail("analogy wall mismatch");
  for (const id of row.evidence.geometry_case_ids) if (!geometryById.has(id)) fail(`unknown geometry ref ${id}`);
  for (const id of row.evidence.wake_case_ids) if (!wakeById.has(id)) fail(`unknown WAKE ref ${id}`);

  const labels = {
    pairwise_overlap_implies_global_intersection: [
      "theorem_assumption", "dimension_two_requires_triples",
    ],
    modeled_intersection_implies_consent_or_authority: [
      "consent_and_authority_evidence", "geometry_has_no_consent_or_authority_field",
    ],
    pointwise_feasible_implies_continuous_selection: [
      "continuity_assumption", "aggregate_map_lacks_lower_semicontinuity",
    ],
    feasible_point_is_a_fair_choice: [
      "normative_choice_rule", "multiple_feasible_points_no_selection_rule",
    ],
    expiry_implies_release_acceptance_or_compatibility: [
      "current_evidence", "expiry_means_unknown",
    ],
    minimal_conflict_identifies_a_culprit: [
      "participant_attribution", "certificate_names_constraints_not_beings",
    ],
  };
  const expectedLabels = labels[row.claim_code];
  if (!expectedLabels || row.missing_layer !== expectedLabels[0]
      || row.reason_code !== expectedLabels[1]) {
    fail("analogy claim/missing-layer/reason mismatch");
  }

  switch (row.claim_code) {
    case "pairwise_overlap_implies_global_intersection": {
      if (row.evidence.kind !== "case_references"
          || row.evidence.geometry_case_ids.join(",") !== "cg-g03-pairwise-trap"
          || row.evidence.wake_case_ids.length !== 0
          || row.evidence.feasible_points.length !== 0 || row.evidence.time_family !== null) {
        fail("pairwise evidence shape mismatch");
      }
      const reference = geometryById.get(row.evidence.geometry_case_ids[0]);
      if (reference.case_id !== "cg-g03-pairwise-trap"
          || reference.expected.certificate.deletion_witnesses.length !== 3) fail("pairwise evidence mismatch");
      break;
    }
    case "modeled_intersection_implies_consent_or_authority":
      if (row.evidence.kind !== "case_references"
          || row.evidence.geometry_case_ids.join(",") !== "cg-g01-robust-room"
          || row.evidence.wake_case_ids.length !== 0
          || row.evidence.feasible_points.length !== 0 || row.evidence.time_family !== null) {
        fail("consent analogy evidence mismatch");
      }
      break;
    case "pointwise_feasible_implies_continuous_selection": {
      const family = row.evidence.time_family;
      if (row.evidence.kind !== "time_varying_counterexample" || !family
          || row.evidence.geometry_case_ids.length !== 0
          || row.evidence.wake_case_ids.length !== 0
          || row.evidence.feasible_points.length !== 0) {
        fail("time analogy evidence shape mismatch");
      }
      verifyTimeCounterexample(family);
      break;
    }
    case "feasible_point_is_a_fair_choice": {
      if (row.evidence.kind !== "case_references"
          || row.evidence.geometry_case_ids.join(",") !== "cg-g01-robust-room"
          || row.evidence.wake_case_ids.length !== 0 || row.evidence.time_family !== null) {
        fail("fairness analogy evidence shape mismatch");
      }
      const reference = geometryById.get(row.evidence.geometry_case_ids[0]);
      if (row.evidence.feasible_points.length < 2) fail("fairness analogy needs multiple points");
      for (const candidate of row.evidence.feasible_points) {
        for (const constraint of reference.input.constraints) {
          if (!satisfies(candidate, constraint)) fail("fairness example point is infeasible");
        }
      }
      break;
    }
    case "expiry_implies_release_acceptance_or_compatibility": {
      if (row.evidence.kind !== "case_references"
          || row.evidence.geometry_case_ids.length !== 0
          || row.evidence.wake_case_ids.join(",") !== "cg-w02-expired-unknown"
          || row.evidence.feasible_points.length !== 0 || row.evidence.time_family !== null) {
        fail("expiry analogy evidence shape mismatch");
      }
      const reference = wakeById.get(row.evidence.wake_case_ids[0]);
      if (reference.expected.reason_code !== "evidence_expired"
          || reference.expected.outcome !== "insufficient_evidence") fail("expiry analogy mismatch");
      break;
    }
    case "minimal_conflict_identifies_a_culprit": {
      if (row.evidence.kind !== "case_references"
          || row.evidence.geometry_case_ids.join(",") !== "cg-g03-pairwise-trap"
          || row.evidence.wake_case_ids.length !== 0
          || row.evidence.feasible_points.length !== 0 || row.evidence.time_family !== null) {
        fail("culprit analogy evidence shape mismatch");
      }
      const reference = geometryById.get(row.evidence.geometry_case_ids[0]);
      if (reference.expected.certificate.kind !== "minimal_conflict"
          || reference.does_not_establish.culprit !== true) fail("culprit analogy mismatch");
      break;
    }
    default:
      fail(`unknown analogy claim ${row.claim_code}`);
  }
}

export function verifyRows({ geometry, wake, analogy }, provenanceRef) {
  if (!/^sha256:[0-9a-f]{64}$/.test(provenanceRef)) fail("invalid provenance reference");
  if (geometry.length !== 9 || wake.length !== 4 || analogy.length !== 6) {
    fail("dataset must contain exactly 9 geometry, 4 WAKE, and 6 analogy rows");
  }
  const all = [...geometry, ...wake, ...analogy];
  if (new Set(all.map(({ case_id: id }) => id)).size !== all.length) fail("duplicate case id");
  for (const row of geometry) verifyGeometryRow(row, provenanceRef);
  const geometryById = new Map(geometry.map((row) => [row.case_id, row]));
  for (const row of wake) verifyWakeRow(row, geometryById, provenanceRef);
  const wakeById = new Map(wake.map((row) => [row.case_id, row]));
  for (const row of analogy) verifyAnalogyRow(row, geometryById, wakeById, provenanceRef);
  return { geometryById, wakeById };
}
