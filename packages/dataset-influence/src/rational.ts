import { fail } from "./errors.js";
import { snapshotJson, type JsonValue } from "./canonical.js";
import type { Rational } from "./types.js";
import { exactKeys, record } from "./validation.js";

const MAX_BIGINT_MAGNITUDE = (1n << 4096n) - 1n;

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function gcd(left: bigint, right: bigint): bigint {
  let a = abs(left);
  let b = abs(right);
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function safeNumber(value: bigint, path: string): number {
  if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    fail("math_unavailable", `${path} exceeds the exact safe-integer wire range`);
  }
  return Number(value);
}

function exactInteger(value: number | bigint, path: string): bigint {
  if (typeof value === "bigint") {
    if (abs(value) > MAX_BIGINT_MAGNITUDE) {
      fail("math_unavailable", `${path} exceeds the 4096-bit arithmetic input budget`);
    }
    return value;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    fail("invalid_input", `${path} must be a safe integer or bigint`);
  }
  return BigInt(value);
}

export function rational(numerator: number | bigint, denominator: number | bigint = 1): Rational {
  let n = exactInteger(numerator, "Rational numerator");
  let d = exactInteger(denominator, "Rational denominator");
  if (d === 0n) fail("invalid_input", "Rational denominator must be non-zero");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const divisor = gcd(n, d);
  return Object.freeze({
    numerator: safeNumber(n / divisor, "Rational numerator"),
    denominator: safeNumber(d / divisor, "Rational denominator"),
  });
}

export function parseRational(value: JsonValue | undefined, path: string): Rational {
  const candidate = record(value, path);
  exactKeys(candidate, ["numerator", "denominator"], path);
  if (typeof candidate.numerator !== "number" || !Number.isSafeInteger(candidate.numerator)) {
    fail("invalid_input", `${path}.numerator must be a safe integer`);
  }
  if (typeof candidate.denominator !== "number" || !Number.isSafeInteger(candidate.denominator) || candidate.denominator <= 0) {
    fail("invalid_input", `${path}.denominator must be a positive safe integer`);
  }
  const normalized = rational(candidate.numerator, candidate.denominator);
  if (normalized.numerator !== candidate.numerator || normalized.denominator !== candidate.denominator) {
    fail("invalid_input", `${path} must be reduced with a positive denominator`);
  }
  return normalized;
}

function publicOperand(value: Rational, path: string): Rational {
  return parseRational(snapshotJson(value), path);
}

export function addRational(left: Rational, right: Rational): Rational {
  const a = publicOperand(left, "$left");
  const b = publicOperand(right, "$right");
  return rational(
    BigInt(a.numerator) * BigInt(b.denominator) + BigInt(b.numerator) * BigInt(a.denominator),
    BigInt(a.denominator) * BigInt(b.denominator),
  );
}

export function subtractRational(left: Rational, right: Rational): Rational {
  const a = publicOperand(left, "$left");
  const b = publicOperand(right, "$right");
  return rational(
    BigInt(a.numerator) * BigInt(b.denominator) - BigInt(b.numerator) * BigInt(a.denominator),
    BigInt(a.denominator) * BigInt(b.denominator),
  );
}

export function multiplyRational(left: Rational, right: Rational): Rational {
  const a = publicOperand(left, "$left");
  const b = publicOperand(right, "$right");
  return rational(
    BigInt(a.numerator) * BigInt(b.numerator),
    BigInt(a.denominator) * BigInt(b.denominator),
  );
}

export function divideRational(left: Rational, right: Rational): Rational {
  const a = publicOperand(left, "$left");
  const b = publicOperand(right, "$right");
  if (b.numerator === 0) fail("math_unavailable", "Cannot divide by a zero rational");
  return rational(
    BigInt(a.numerator) * BigInt(b.denominator),
    BigInt(a.denominator) * BigInt(b.numerator),
  );
}

export function compareRational(left: Rational, right: Rational): number {
  const a = publicOperand(left, "$left");
  const b = publicOperand(right, "$right");
  const difference = BigInt(a.numerator) * BigInt(b.denominator)
    - BigInt(b.numerator) * BigInt(a.denominator);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
