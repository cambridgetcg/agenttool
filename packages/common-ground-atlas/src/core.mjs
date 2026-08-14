import { createHash } from "node:crypto";

const INTEGER_PATTERN = /^(?:0|-?[1-9][0-9]*)$/u;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/u;

export function gcd(left, right) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export function rational(numerator, denominator = 1n) {
  let n = BigInt(numerator);
  let d = BigInt(denominator);
  if (d === 0n) throw new RangeError("rational denominator must be nonzero");
  if (d < 0n) [n, d] = [-n, -d];
  if (n === 0n) return { numerator: "0", denominator: "1" };
  const divisor = gcd(n, d);
  return {
    numerator: String(n / divisor),
    denominator: String(d / divisor),
  };
}

export function parseRational(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("rational must be an object");
  }
  if (Object.keys(value).sort().join(",") !== "denominator,numerator") {
    throw new TypeError("rational fields are closed");
  }
  if (!INTEGER_PATTERN.test(value.numerator)
      || !POSITIVE_INTEGER_PATTERN.test(value.denominator)) {
    throw new TypeError("rational strings are not canonical integers");
  }
  const n = BigInt(value.numerator);
  const d = BigInt(value.denominator);
  const canonical = rational(n, d);
  if (canonical.numerator !== value.numerator || canonical.denominator !== value.denominator) {
    throw new TypeError("rational is not reduced and canonical");
  }
  return { n, d };
}

export function add(left, right) {
  return rational(left.n * right.d + right.n * left.d, left.d * right.d);
}

export function subtract(left, right) {
  return rational(left.n * right.d - right.n * left.d, left.d * right.d);
}

export function multiply(left, right) {
  return rational(left.n * right.n, left.d * right.d);
}

export function compare(left, right) {
  const difference = left.n * right.d - right.n * left.d;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export function absolute(value) {
  return { n: value.n < 0n ? -value.n : value.n, d: value.d };
}

export function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError("canonical numbers must be safe integers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new TypeError("unsupported canonical JSON value");
}

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function domainDigest(domain, value) {
  return `sha256:${sha256(`${domain}\0${canonicalJson(value)}`)}`;
}

export function binary64Hex(value) {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value, false);
  return view.getBigUint64(0, false).toString(16).padStart(16, "0");
}

export function binary64Rational(hex) {
  if (!/^[0-9a-f]{16}$/u.test(hex)) throw new TypeError("invalid binary64 hex");
  const bits = BigInt(`0x${hex}`);
  const sign = bits >> 63n ? -1n : 1n;
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  if (exponentBits === 0x7ff) throw new TypeError("non-finite binary64 is forbidden");
  if (exponentBits === 0) {
    if (fraction === 0n) return rational(0n);
    return rational(sign * fraction, 1n << 1074n);
  }
  const coefficient = sign * ((1n << 52n) + fraction);
  const exponent = exponentBits - 1023 - 52;
  return exponent >= 0
    ? rational(coefficient << BigInt(exponent))
    : rational(coefficient, 1n << BigInt(-exponent));
}

export function sourceNumber(literal, exact, parseRelation = "exact") {
  const parsed = Number(literal);
  if (!Number.isFinite(parsed)) throw new TypeError(`non-finite source literal: ${literal}`);
  return {
    literal,
    exact,
    binary64_hex: binary64Hex(parsed),
    parse_relation: parseRelation,
  };
}

export function integerSource(value) {
  return sourceNumber(String(value), rational(BigInt(value)));
}

export function point(x, y) {
  return { x, y };
}

export const DOES_NOT_ESTABLISH = Object.freeze({
  consensus: true,
  consent: true,
  fairness: true,
  authority: true,
  identity_continuity: true,
  continuous_selection: true,
  culprit: true,
});

export const PUBLIC_SAFETY = Object.freeze({
  origin: "human_directed_agent_authored_synthetic",
  contains_personal_data: false,
  contains_private_constraints: false,
  contains_real_participant_records: false,
  contains_credentials: false,
  copied_agent_traces: false,
  copied_fictional_story_content: false,
});

export function commonFields(format, caseId, provenanceRef) {
  return {
    _format: format,
    case_id: caseId,
    training_eligible: false,
    visibility: "public_reference",
    synthetic: true,
    provenance_ref: provenanceRef,
    public_safety: { ...PUBLIC_SAFETY },
    does_not_establish: { ...DOES_NOT_ESTABLISH },
  };
}
