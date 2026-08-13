const EPSILON = 1e-9;
const MAX_CONSTRAINTS = 12;
const MAX_INPUT_MAGNITUDE = 1e9;
const MAX_INPUT_CHARACTERS = 16_384;
const MAX_LABEL_CHARACTERS = 120;
const MIN_NORMAL_BINARY64 = 2.2250738585072014e-308;

export const PRESETS = Object.freeze({
  room: [
    "minimum x | -1 | 0 | 0",
    "minimum y | 0 | -1 | 0",
    "shared ceiling | 1 | 1 | 4",
    "x cap | 1 | 0 | 3",
  ].join("\n"),
  pairwise: [
    "x is nonnegative | -1 | 0 | 0",
    "y is nonnegative | 0 | -1 | 0",
    "sum is at most minus one | 1 | 1 | -1",
  ].join("\n"),
  knife: [
    "x is nonnegative | -1 | 0 | 0",
    "y is nonnegative | 0 | -1 | 0",
    "sum is at most zero | 1 | 1 | 0",
  ].join("\n"),
  invalid: [
    "a circle is not one half-plane | circle | 0 | 1",
    "zero normal has no boundary | 0 | 0 | 2",
  ].join("\n"),
});

function finiteBoundedNumber(value) {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= MAX_INPUT_MAGNITUDE;
}

function nonzeroLiteralUnderflowed(text, value) {
  if (value !== 0) return false;
  const significand = text.trim().replace(/^[+-]/u, "").split(/[eE]/u, 1)[0];
  return /[1-9]/u.test(significand);
}

export function parseConstraintText(source) {
  if (typeof source !== "string") {
    return {
      constraints: [],
      errors: ["Constraint input must be text."],
      numericIssues: [],
    };
  }
  if (source.length > MAX_INPUT_CHARACTERS) {
    return {
      constraints: [],
      errors: [`Constraint input must be at most ${MAX_INPUT_CHARACTERS} characters.`],
      numericIssues: [],
    };
  }

  const constraints = [];
  const errors = [];
  const numericIssues = [];
  const lines = source.split(/\r?\n/u);

  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index].trim();
    if (!raw || raw.startsWith("#")) continue;

    const parts = raw.split("|").map((part) => part.trim());
    if (parts.length !== 4) {
      errors.push(`Line ${index + 1}: use label | a | b | c.`);
      continue;
    }

    const [label, aText, bText, cText] = parts;
    if ([aText, bText, cText].some((value) => value === "")) {
      errors.push(`Line ${index + 1}: a, b, and c cannot be empty.`);
      continue;
    }
    const values = [Number(aText), Number(bText), Number(cText)];
    if (!label) {
      errors.push(`Line ${index + 1}: label cannot be empty.`);
      continue;
    }
    if (label.length > MAX_LABEL_CHARACTERS) {
      errors.push(`Line ${index + 1}: label must be at most ${MAX_LABEL_CHARACTERS} characters.`);
      continue;
    }
    if (!values.every(finiteBoundedNumber)) {
      errors.push(
        `Line ${index + 1}: a, b, and c must be finite numbers with magnitude at most ${MAX_INPUT_MAGNITUDE}.`,
      );
      continue;
    }
    const textPrecisionUnsafe = [aText, bText, cText].some((text, field) =>
      nonzeroLiteralUnderflowed(text, values[field]) ||
      (values[field] !== 0 && Math.abs(values[field]) < MIN_NORMAL_BINARY64)
    );
    if (textPrecisionUnsafe) {
      numericIssues.push(
        `Line ${index + 1}: a nonzero numeric literal underflowed to zero or parsed below normal binary64 range; its half-plane cannot be preserved safely.`,
      );
      continue;
    }
    constraints.push({ label, a: values[0], b: values[1], c: values[2] });
  }

  if (constraints.length > MAX_CONSTRAINTS) {
    errors.push(`Use at most ${MAX_CONSTRAINTS} constraints in this teaching lab.`);
  }

  return {
    constraints: constraints.slice(0, MAX_CONSTRAINTS),
    errors,
    numericIssues,
  };
}

export function normalizeConstraints(input) {
  if (!Array.isArray(input)) {
    return {
      constraints: [],
      errors: ["Constraints must be an array."],
      numericIssues: [],
    };
  }
  if (input.length > MAX_CONSTRAINTS) {
    return {
      constraints: [],
      errors: [`Use at most ${MAX_CONSTRAINTS} constraints in this teaching lab.`],
      numericIssues: [],
    };
  }

  const constraints = [];
  const errors = [];
  const numericIssues = [];
  const labels = new Set();
  input.forEach((candidate, index) => {
    const label = typeof candidate?.label === "string" && candidate.label.trim()
      ? candidate.label.trim()
      : `constraint ${index + 1}`;
    const a = candidate?.a;
    const b = candidate?.b;
    const c = candidate?.c;

    if (label.length > MAX_LABEL_CHARACTERS) {
      errors.push(`${label.slice(0, MAX_LABEL_CHARACTERS)}: label is too long.`);
      return;
    }
    if (labels.has(label)) {
      errors.push(`${label}: labels must be unique so a witness is unambiguous.`);
      return;
    }
    labels.add(label);

    if (![a, b, c].every(finiteBoundedNumber)) {
      errors.push(`${label}: coefficients must be finite bounded numbers.`);
      return;
    }

    const scale = Math.max(Math.abs(a), Math.abs(b));
    if (scale === 0) {
      errors.push(`${label}: a and b cannot both be zero.`);
      return;
    }

    // Scaling before hypot keeps a subnormal-but-valid normal from acquiring a
    // quantized length. Refuse a numeric conclusion when scaling erases a
    // nonzero component or cannot represent the boundary offset: either case
    // changes the represented half-plane rather than merely rounding it.
    const scaled = { a: a / scale, b: b / scale, c: c / scale };
    const unitNorm = Math.hypot(scaled.a, scaled.b);
    const normalized = {
      a: scaled.a / unitNorm,
      b: scaled.b / unitNorm,
      c: scaled.c / unitNorm,
    };
    const lostNonzero = (
      (a !== 0 && normalized.a === 0) ||
      (b !== 0 && normalized.b === 0) ||
      (c !== 0 && normalized.c === 0)
    );
    const normalizedMagnitude = Math.hypot(normalized.a, normalized.b);
    const unsafe = ![scaled.a, scaled.b, scaled.c, unitNorm,
      normalized.a, normalized.b, normalized.c, normalizedMagnitude]
      .every(Number.isFinite) ||
      unitNorm === 0 ||
      lostNonzero ||
      Math.abs(normalizedMagnitude - 1) > 16 * Number.EPSILON;
    if (unsafe) {
      numericIssues.push(
        `${label}: floating-point normalization cannot preserve this half-plane safely at the supplied scale.`,
      );
      return;
    }

    constraints.push({
      label,
      ...normalized,
      original: { a, b, c },
      sourceIndex: index,
    });
  });

  return { constraints, errors, numericIssues };
}

const FLOAT64_BUFFER = new ArrayBuffer(8);
const FLOAT64_VIEW = new DataView(FLOAT64_BUFFER);
const FLOAT64_FRACTION_MASK = (1n << 52n) - 1n;

function exactDyadic(value) {
  if (!Number.isFinite(value)) {
    throw new RangeError("Exact dyadic conversion requires a finite binary64 value.");
  }
  FLOAT64_VIEW.setFloat64(0, value, false);
  const bits = FLOAT64_VIEW.getBigUint64(0, false);
  const sign = (bits >> 63n) === 0n ? 1n : -1n;
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & FLOAT64_FRACTION_MASK;
  if (exponentBits === 0) {
    return { coefficient: sign * fraction, exponent: -1074 };
  }
  return {
    coefficient: sign * ((1n << 52n) + fraction),
    exponent: exponentBits - 1023 - 52,
  };
}

function multiplyDyadics(left, right) {
  return {
    coefficient: left.coefficient * right.coefficient,
    exponent: left.exponent + right.exponent,
  };
}

function exactConstraintStatus(point, constraint) {
  const source = constraint.original ?? constraint;
  if (![point.x, point.y, source.a, source.b, source.c].every(Number.isFinite)) {
    return "indeterminate";
  }
  const terms = [
    multiplyDyadics(exactDyadic(source.a), exactDyadic(point.x)),
    multiplyDyadics(exactDyadic(source.b), exactDyadic(point.y)),
    (() => {
      const c = exactDyadic(source.c);
      return { coefficient: -c.coefficient, exponent: c.exponent };
    })(),
  ].filter((term) => term.coefficient !== 0n);
  if (terms.length === 0) return "satisfied";

  const minimumExponent = Math.min(...terms.map((term) => term.exponent));
  const exactResidual = terms.reduce(
    (sum, term) => sum +
      (term.coefficient << BigInt(term.exponent - minimumExponent)),
    0n,
  );
  return exactResidual <= 0n ? "satisfied" : "rejected";
}

function exactIntegerConstraint(constraint) {
  const source = constraint.original ?? constraint;
  const parts = [
    exactDyadic(source.a),
    exactDyadic(source.b),
    exactDyadic(source.c),
  ];
  const minimumExponent = Math.min(
    ...parts.filter((part) => part.coefficient !== 0n)
      .map((part) => part.exponent),
  );
  const integer = parts.map((part) => part.coefficient === 0n
    ? 0n
    : part.coefficient << BigInt(part.exponent - minimumExponent));
  return { a: integer[0], b: integer[1], c: integer[2] };
}

function exactRationalCandidateSatisfies(candidate, constraints) {
  return constraints.every((constraint) =>
    constraint.a * candidate.xNumerator +
      constraint.b * candidate.yNumerator <=
      constraint.c * candidate.denominator
  );
}

function exactFeasibleCandidates(constraints) {
  if (constraints.length === 0) {
    return [{ xNumerator: 0n, yNumerator: 0n, denominator: 1n }];
  }
  const integerConstraints = constraints.map(exactIntegerConstraint);
  const candidates = [{ xNumerator: 0n, yNumerator: 0n, denominator: 1n }];

  for (const constraint of integerConstraints) {
    const denominator = constraint.a * constraint.a + constraint.b * constraint.b;
    candidates.push({
      xNumerator: constraint.a * constraint.c,
      yNumerator: constraint.b * constraint.c,
      denominator,
    });
  }

  for (let left = 0; left < integerConstraints.length; left += 1) {
    for (let right = left + 1; right < integerConstraints.length; right += 1) {
      const first = integerConstraints[left];
      const second = integerConstraints[right];
      let denominator = first.a * second.b - second.a * first.b;
      if (denominator === 0n) continue;
      let xNumerator = first.c * second.b - first.b * second.c;
      let yNumerator = first.a * second.c - first.c * second.a;
      if (denominator < 0n) {
        denominator = -denominator;
        xNumerator = -xNumerator;
        yNumerator = -yNumerator;
      }
      candidates.push({ xNumerator, yNumerator, denominator });
    }
  }

  return candidates.filter((candidate) =>
    exactRationalCandidateSatisfies(candidate, integerConstraints)
  );
}

function exactFamilyFeasible(constraints) {
  return exactFeasibleCandidates(constraints).length > 0;
}

function rationalToNumber(numerator, denominator) {
  if (numerator === 0n) return 0;
  if (denominator <= 0n) {
    throw new RangeError("Rational conversion requires a positive denominator.");
  }
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const numeratorBits = absolute.toString(2).length;
  const denominatorBits = denominator.toString(2).length;
  let exponent = numeratorBits - denominatorBits;
  if (exponent >= 0) {
    if (absolute < (denominator << BigInt(exponent))) exponent -= 1;
  } else if ((absolute << BigInt(-exponent)) < denominator) {
    exponent -= 1;
  }

  const roundedQuotient = (shift) => {
    const scaledNumerator = shift >= 0
      ? absolute << BigInt(shift)
      : absolute;
    const scaledDenominator = shift >= 0
      ? denominator
      : denominator << BigInt(-shift);
    let quotient = scaledNumerator / scaledDenominator;
    const remainder = scaledNumerator % scaledDenominator;
    const comparison = 2n * remainder - scaledDenominator;
    if (comparison > 0n || (comparison === 0n && quotient % 2n !== 0n)) {
      quotient += 1n;
    }
    return quotient;
  };

  let bits;
  const signBit = negative ? 1n << 63n : 0n;
  if (exponent >= -1022) {
    let significand = roundedQuotient(52 - exponent);
    if (significand === 1n << 53n) {
      significand >>= 1n;
      exponent += 1;
    }
    if (exponent > 1023) return negative ? -Infinity : Infinity;
    const exponentBits = BigInt(exponent + 1023) << 52n;
    bits = signBit | exponentBits | (significand - (1n << 52n));
  } else {
    const fraction = roundedQuotient(1074);
    if (fraction === 0n) return negative ? -0 : 0;
    // Rounding a value immediately below the normal boundary may produce the
    // minimum normal value; its bit pattern is the same integer 2^52.
    bits = signBit | fraction;
  }

  FLOAT64_VIEW.setBigUint64(0, bits, false);
  return FLOAT64_VIEW.getFloat64(0, false);
}

function adjacentFloat(value, direction) {
  if (!Number.isFinite(value)) return value;
  if (value === 0) return direction > 0 ? Number.MIN_VALUE : -Number.MIN_VALUE;
  FLOAT64_VIEW.setFloat64(0, value, false);
  let bits = FLOAT64_VIEW.getBigUint64(0, false);
  if ((value > 0) === (direction > 0)) bits += 1n;
  else bits -= 1n;
  FLOAT64_VIEW.setBigUint64(0, bits, false);
  return FLOAT64_VIEW.getFloat64(0, false);
}

function findExactlyFeasibleFloat(constraints) {
  for (const candidate of exactFeasibleCandidates(constraints)) {
    const x = rationalToNumber(candidate.xNumerator, candidate.denominator);
    const y = rationalToNumber(candidate.yNumerator, candidate.denominator);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const xCandidates = [x, adjacentFloat(x, -1), adjacentFloat(x, 1)];
    const yCandidates = [y, adjacentFloat(y, -1), adjacentFloat(y, 1)];
    for (const nearbyX of xCandidates) {
      for (const nearbyY of yCandidates) {
        if (!Number.isFinite(nearbyX) || !Number.isFinite(nearbyY)) continue;
        const point = { x: nearbyX, y: nearbyY, kind: "exact_membership_fallback" };
        if (constraints.every((constraint) =>
          exactConstraintStatus(point, constraint) === "satisfied"
        )) return point;
      }
    }
  }
  return null;
}

function evaluateConstraint(point, constraint) {
  const exactStatus = exactConstraintStatus(point, constraint);
  if (exactStatus === "indeterminate") return null;
  const aTerm = constraint.a * point.x;
  const bTerm = constraint.b * point.y;
  const left = aTerm + bTerm;
  const residual = left - constraint.c;
  const semanticTolerance = EPSILON * (1 + Math.abs(constraint.c));
  const roundoffTolerance = 16 * Number.EPSILON * (
    1 + Math.abs(aTerm) + Math.abs(bTerm) + Math.abs(constraint.c)
  );
  return {
    residual,
    semanticTolerance,
    roundoffTolerance,
    diagnosticsFinite: [aTerm, bTerm, left, residual, semanticTolerance, roundoffTolerance]
      .every(Number.isFinite),
    status: exactStatus,
  };
}

export function pointSatisfies(point, constraint) {
  const evaluation = evaluateConstraint(point, constraint);
  return evaluation !== null && evaluation.status === "satisfied";
}

function evaluateCandidate(point, constraints) {
  let rejected = false;
  for (const constraint of constraints) {
    const evaluation = evaluateConstraint(point, constraint);
    if (evaluation === null || evaluation.status === "indeterminate") return "indeterminate";
    if (evaluation.status === "rejected") rejected = true;
  }
  return rejected ? "rejected" : "feasible";
}

function addCandidate(candidates, point, kind) {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  const duplicate = candidates.some((candidate) =>
    candidate.x === point.x && candidate.y === point.y
  );
  if (!duplicate) candidates.push({ ...point, kind });
  return true;
}

function boundaryIntersection(left, right) {
  const leftProduct = left.a * right.b;
  const rightProduct = right.a * left.b;
  const determinant = leftProduct - rightProduct;
  // Cancellation can make distinct near-parallel normals look parallel—or
  // even reverse their orientation. A conservative forward-error envelope
  // turns that whole region into numeric uncertainty instead of a conflict.
  const determinantRoundoff = 64 * Number.EPSILON * (
    1 + Math.abs(leftProduct) + Math.abs(rightProduct)
  );
  if (![leftProduct, rightProduct, determinant, determinantRoundoff]
      .every(Number.isFinite) ||
      Math.abs(determinant) <= determinantRoundoff) {
    return { status: "indeterminate" };
  }
  const point = {
    x: (left.c * right.b - left.b * right.c) / determinant,
    y: (left.a * right.c - left.c * right.a) / determinant,
  };
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return { status: "indeterminate" };
  }
  const leftEvaluation = evaluateConstraint(point, left);
  const rightEvaluation = evaluateConstraint(point, right);
  return leftEvaluation?.status === "satisfied" &&
      rightEvaluation?.status === "satisfied"
    ? { status: "point", point }
    : { status: "indeterminate" };
}

function searchFeasiblePoint(constraints) {
  if (constraints.length === 0) {
    return { status: "feasible", point: { x: 0, y: 0, kind: "origin" } };
  }

  const candidates = [];
  let indeterminate = false;
  addCandidate(candidates, { x: 0, y: 0 }, "origin");

  for (const constraint of constraints) {
    // Constraints are normalized, so c(a,b) is the closest boundary point
    // to the origin.
    const projection = {
      x: constraint.c * constraint.a,
      y: constraint.c * constraint.b,
    };
    const projectionEvaluation = evaluateConstraint(projection, constraint);
    if (projectionEvaluation?.status !== "satisfied" ||
        !addCandidate(candidates, projection, "boundary_projection")) {
      indeterminate = true;
    }
  }

  for (let left = 0; left < constraints.length; left += 1) {
    for (let right = left + 1; right < constraints.length; right += 1) {
      const intersection = boundaryIntersection(constraints[left], constraints[right]);
      if (intersection.status === "indeterminate") {
        indeterminate = true;
      } else if (intersection.status === "point" &&
                 !addCandidate(candidates, intersection.point, "boundary_intersection")) {
        indeterminate = true;
      }
    }
  }

  for (const point of candidates) {
    const evaluation = evaluateCandidate(point, constraints);
    if (evaluation === "feasible") return { status: "feasible", point };
    if (evaluation === "indeterminate") indeterminate = true;
  }

  return { status: indeterminate ? "indeterminate" : "infeasible" };
}

export function findFeasiblePoint(constraints) {
  const result = searchFeasiblePoint(constraints);
  return result.status === "feasible" ? result.point : null;
}

function combinations(length, size) {
  const output = [];
  const active = [];
  function visit(start) {
    if (active.length === size) {
      output.push([...active]);
      return;
    }
    for (let index = start; index < length; index += 1) {
      active.push(index);
      visit(index + 1);
      active.pop();
    }
  }
  visit(0);
  return output;
}

function smallestInfeasibleWitness(constraints) {
  const maximum = Math.min(3, constraints.length);
  // Every half-plane with a nonzero normal is nonempty. Never let numeric
  // candidate generation manufacture an impossible one-row conflict.
  for (let size = 2; size <= maximum; size += 1) {
    for (const indexes of combinations(constraints.length, size)) {
      const subset = indexes.map((index) => constraints[index]);
      if (exactFamilyFeasible(subset)) continue;

      const deletionWitnesses = subset.map((_, removed) => {
        const proper = subset.filter((__, index) => index !== removed);
        const deletionSearch = searchFeasiblePoint(proper);
        const exactFallback = deletionSearch.status === "feasible"
          ? null
          : findExactlyFeasibleFloat(proper);
        return {
          omitted: subset[removed].label,
          point: deletionSearch.status === "feasible"
            ? deletionSearch.point
            : exactFallback,
          searchStatus: deletionSearch.status === "feasible" || exactFallback
            ? "feasible"
            : deletionSearch.status,
          satisfies: proper.map((constraint) => constraint.label),
        };
      });

      if (deletionWitnesses.every((entry) => entry.searchStatus === "feasible")) {
        return { indexes, constraints: subset, deletionWitnesses };
      }
    }
  }
  return null;
}

function residualsAt(point, constraints) {
  return constraints.map((constraint) => {
    const evaluation = evaluateConstraint(point, constraint);
    return {
      label: constraint.label,
      residual: evaluation?.residual ?? Number.POSITIVE_INFINITY,
      slack: -(evaluation?.residual ?? Number.POSITIVE_INFINITY),
      tolerance: evaluation?.semanticTolerance ?? 0,
      roundoffTolerance: evaluation?.roundoffTolerance ?? 0,
    };
  });
}

export function solveCommonGround(input, inputNumericIssues = []) {
  const normalized = normalizeConstraints(input);
  if (normalized.errors.length > 0) {
    return {
      outcome: "model_not_applicable",
      errors: normalized.errors,
      constraints: normalized.constraints,
    };
  }
  const numericIssues = [
    ...(Array.isArray(inputNumericIssues) ? inputNumericIssues : []),
    ...normalized.numericIssues,
  ];
  if (numericIssues.length > 0) {
    // An unrepresentable extra row cannot restore feasibility. Preserve any
    // independently stable conflict already proved by the safely normalized
    // subfamily; otherwise refuse a numeric conclusion about the full family.
    const witness = smallestInfeasibleWitness(normalized.constraints);
    if (witness) {
      return {
        outcome: "no_common_ground_witnessed",
        witness,
        constraints: normalized.constraints,
        numericIssues,
        displayTolerance: EPSILON,
      };
    }
    return {
      outcome: "insufficient_evidence",
      errors: numericIssues,
      constraints: normalized.constraints,
    };
  }
  if (normalized.constraints.length === 0) {
    return {
      outcome: "insufficient_evidence",
      errors: ["Supply at least one current half-plane constraint."],
      constraints: [],
    };
  }

  const search = searchFeasiblePoint(normalized.constraints);
  const exactFallback = search.status === "feasible"
    ? null
    : findExactlyFeasibleFloat(normalized.constraints);
  if (search.status === "feasible" || exactFallback) {
    const point = search.status === "feasible" ? search.point : exactFallback;
    const residuals = residualsAt(point, normalized.constraints);
    return {
      outcome: "common_ground_certified",
      point,
      residuals,
      maximumResidual: Math.max(...residuals.map((entry) => entry.residual)),
      constraints: normalized.constraints,
      displayTolerance: EPSILON,
    };
  }

  const witness = smallestInfeasibleWitness(normalized.constraints);
  if (witness) {
    return {
      outcome: "no_common_ground_witnessed",
      witness,
      constraints: normalized.constraints,
      displayTolerance: EPSILON,
    };
  }

  return {
    outcome: "insufficient_evidence",
    errors: exactFamilyFeasible(normalized.constraints)
      ? [
        "The parsed binary64 family is exactly feasible, but the bounded search found no finite binary64 witness. Use exact rational output.",
      ]
      : [
        "The parsed binary64 family is exactly infeasible, but the lab could not construct finite deletion witnesses for a stable Helly certificate. Use exact rational certificates.",
      ],
    constraints: normalized.constraints,
  };
}

function formatNumber(value) {
  if (Math.abs(value) < 5e-10) return "0";
  const rounded = Number(value.toPrecision(7));
  return String(rounded);
}

function formatCertificateNumber(value) {
  return String(value);
}

function createTextElement(tag, text, className) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function renderResult(result, target) {
  target.replaceChildren();
  target.className = `helly-result outcome-${result.outcome}`;
  target.appendChild(createTextElement("p", result.outcome, "outcome-code"));

  const titles = {
    common_ground_certified: "There is shared room in this model.",
    no_common_ground_witnessed: "A small conflict already closes the room.",
    model_not_applicable: "This input is not the declared half-plane model.",
    insufficient_evidence: "The lab cannot issue a stable result.",
  };
  target.appendChild(createTextElement("h3", titles[result.outcome]));

  if (result.outcome === "common_ground_certified") {
    target.appendChild(createTextElement(
      "p",
      `Witness point: (${formatCertificateNumber(result.point.x)}, ${formatCertificateNumber(result.point.y)}). Every original parsed binary64 inequality passes an exact dyadic membership check.`,
    ));
    target.appendChild(createTextElement(
      "p",
      "This is a feasibility witness—not consensus, consent, a fairness choice, or a robustness optimum.",
      "result-boundary",
    ));
    return;
  }

  if (result.outcome === "no_common_ground_witnessed") {
    const labels = result.witness.constraints.map((constraint) => constraint.label);
    target.appendChild(createTextElement(
      "p",
      `Exact-dyadic Helly witness (${labels.length} constraints): ${labels.join(" · ")}.`,
    ));
    const list = document.createElement("ul");
    for (const entry of result.witness.deletionWitnesses) {
      const point = entry.point;
      list.appendChild(createTextElement(
        "li",
        `Without “${entry.omitted}”: (${formatCertificateNumber(point.x)}, ${formatCertificateNumber(point.y)}) satisfies ${entry.satisfies.join(" + ") || "the empty subfamily"}.`,
      ));
    }
    target.appendChild(list);
    target.appendChild(createTextElement(
      "p",
      "The witness names incompatible constraints, not a culprit. Recheck exact arithmetic before consequential use.",
      "result-boundary",
    ));
    return;
  }

  const list = document.createElement("ul");
  for (const error of result.errors ?? []) list.appendChild(createTextElement("li", error));
  target.appendChild(list);
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function clipPolygon(polygon, constraint) {
  if (polygon.length === 0) return [];
  const output = [];
  const inside = (point) => constraint.a * point.x + constraint.b * point.y <= constraint.c + 1e-8;
  const intersection = (start, end) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const denominator = constraint.a * dx + constraint.b * dy;
    if (Math.abs(denominator) <= EPSILON) return start;
    const t = (constraint.c - constraint.a * start.x - constraint.b * start.y) / denominator;
    return { x: start.x + t * dx, y: start.y + t * dy };
  };

  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    const currentInside = inside(current);
    const previousInside = inside(previous);
    if (currentInside) {
      if (!previousInside) output.push(intersection(previous, current));
      output.push(current);
    } else if (previousInside) {
      output.push(intersection(previous, current));
    }
  }
  return output;
}

function boundarySegment(constraint, limit) {
  const points = [];
  const add = (point) => {
    if (point.x < -limit - EPSILON || point.x > limit + EPSILON ||
        point.y < -limit - EPSILON || point.y > limit + EPSILON) return;
    if (!points.some((candidate) =>
      Math.abs(candidate.x - point.x) < 1e-7 && Math.abs(candidate.y - point.y) < 1e-7
    )) points.push(point);
  };
  if (Math.abs(constraint.b) > EPSILON) {
    add({ x: -limit, y: (constraint.c + constraint.a * limit) / constraint.b });
    add({ x: limit, y: (constraint.c - constraint.a * limit) / constraint.b });
  }
  if (Math.abs(constraint.a) > EPSILON) {
    add({ x: (constraint.c + constraint.b * limit) / constraint.a, y: -limit });
    add({ x: (constraint.c - constraint.b * limit) / constraint.a, y: limit });
  }
  return points.slice(0, 2);
}

function renderPlot(result, svg) {
  const width = 640;
  const height = 480;
  const limit = 6;
  const mapX = (x) => ((x + limit) / (2 * limit)) * width;
  const mapY = (y) => height - ((y + limit) / (2 * limit)) * height;

  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    "Coordinate view from minus six to six showing the modeled half-plane boundaries and any feasible region or witness point.",
  );

  for (let coordinate = -6; coordinate <= 6; coordinate += 1) {
    svg.appendChild(svgElement("line", {
      x1: mapX(coordinate), y1: 0, x2: mapX(coordinate), y2: height,
      class: coordinate === 0 ? "axis" : "grid-line",
    }));
    svg.appendChild(svgElement("line", {
      x1: 0, y1: mapY(coordinate), x2: width, y2: mapY(coordinate),
      class: coordinate === 0 ? "axis" : "grid-line",
    }));
  }

  let polygon = [
    { x: -limit, y: -limit }, { x: limit, y: -limit },
    { x: limit, y: limit }, { x: -limit, y: limit },
  ];
  for (const constraint of result.constraints ?? []) {
    polygon = clipPolygon(polygon, constraint);
  }
  if (polygon.length >= 3) {
    svg.appendChild(svgElement("polygon", {
      points: polygon.map((point) => `${mapX(point.x)},${mapY(point.y)}`).join(" "),
      class: "feasible-region",
    }));
  }

  const witnessLabels = new Set(
    result.outcome === "no_common_ground_witnessed"
      ? result.witness.constraints.map((constraint) => constraint.label)
      : [],
  );
  for (const constraint of result.constraints ?? []) {
    const segment = boundarySegment(constraint, limit);
    if (segment.length !== 2) continue;
    const line = svgElement("line", {
      x1: mapX(segment[0].x), y1: mapY(segment[0].y),
      x2: mapX(segment[1].x), y2: mapY(segment[1].y),
      class: witnessLabels.has(constraint.label) ? "constraint-line witness-line" : "constraint-line",
    });
    const title = svgElement("title");
    title.textContent = constraint.label;
    line.appendChild(title);
    svg.appendChild(line);
  }

  if (result.outcome === "common_ground_certified" &&
      Math.abs(result.point.x) <= limit && Math.abs(result.point.y) <= limit) {
    svg.appendChild(svgElement("circle", {
      cx: mapX(result.point.x), cy: mapY(result.point.y), r: 7, class: "witness-point",
    }));
  }
}

function renderConstraintList(result, target) {
  target.replaceChildren();
  for (const constraint of result.constraints ?? []) {
    const item = document.createElement("li");
    const name = createTextElement("strong", constraint.label);
    const equation = createTextElement(
      "code",
      `${formatNumber(constraint.a)}x + ${formatNumber(constraint.b)}y ≤ ${formatNumber(constraint.c)}`,
    );
    item.append(name, equation);
    target.appendChild(item);
  }
}

export function initializeLab(root = document) {
  const input = root.getElementById("helly-constraints");
  const solveButton = root.getElementById("helly-solve");
  const resultTarget = root.getElementById("helly-result");
  const plot = root.getElementById("helly-plot");
  const constraintList = root.getElementById("helly-normalized");
  if (!input || !solveButton || !resultTarget || !plot || !constraintList) return;

  const solve = () => {
    const parsed = parseConstraintText(input.value);
    const result = parsed.errors.length > 0
      ? { outcome: "model_not_applicable", errors: parsed.errors, constraints: [] }
      : solveCommonGround(parsed.constraints, parsed.numericIssues);
    renderResult(result, resultTarget);
    renderPlot(result, plot);
    renderConstraintList(result, constraintList);
  };

  for (const button of root.querySelectorAll("[data-helly-preset]")) {
    button.addEventListener("click", () => {
      const preset = button.getAttribute("data-helly-preset");
      if (preset && Object.hasOwn(PRESETS, preset)) {
        input.value = PRESETS[preset];
        solve();
      }
    });
  }
  solveButton.addEventListener("click", solve);
  input.value = PRESETS.room;
  solve();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initializeLab(document), { once: true });
  } else {
    initializeLab(document);
  }
}
