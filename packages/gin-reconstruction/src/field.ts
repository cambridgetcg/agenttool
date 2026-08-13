import { snapshotJson } from "./canonical.js";
import { MAX_DEGREE_BOUND, MAX_FIELD_PRIME } from "./constants.js";
import { fail } from "./errors.js";
import type { AffineCalibration } from "./types.js";

export function isPrime(value: number): boolean {
  if (!Number.isSafeInteger(value) || value < 2 || value > MAX_FIELD_PRIME) return false;
  if (value === 2) return true;
  if (value % 2 === 0) return false;
  for (let divisor = 3; divisor * divisor <= value; divisor += 2) {
    if (value % divisor === 0) return false;
  }
  return true;
}

export function assertPrime(value: number): number {
  if (!isPrime(value)) {
    fail("invalid_field", `field_prime must be prime from 2 through ${String(MAX_FIELD_PRIME)}`);
  }
  return value;
}

export function mod(value: number, prime: number): number {
  assertPrime(prime);
  if (!Number.isSafeInteger(value)) fail("invalid_field", "field arithmetic requires safe integers");
  const residue = value % prime;
  return residue < 0 ? residue + prime : residue;
}

export function inverse(value: number, prime: number): number {
  const normalized = mod(value, prime);
  if (normalized === 0) fail("invalid_field", "zero has no multiplicative inverse");
  let oldR = normalized;
  let r = prime;
  let oldS = 1;
  let s = 0;
  while (r !== 0) {
    const quotient = Math.floor(oldR / r);
    [oldR, r] = [r, oldR - quotient * r];
    [oldS, s] = [s, oldS - quotient * s];
  }
  return mod(oldS, prime);
}

export function evaluatePolynomial(coefficients: readonly number[], x: number, prime: number): number {
  assertPrime(prime);
  const point = canonicalFieldElement(x, prime, "x");
  const coefficientSnapshot = snapshotJson(coefficients);
  if (!Array.isArray(coefficientSnapshot)) fail("invalid_field", "coefficients must be a standard bounded Array");
  if (coefficientSnapshot.length === 0) fail("invalid_field", "a polynomial needs at least one coefficient");
  if (coefficientSnapshot.length > MAX_DEGREE_BOUND + 1) {
    fail("invalid_field", `a polynomial may have at most ${String(MAX_DEGREE_BOUND + 1)} coefficients`);
  }
  let result = 0;
  for (let index = coefficientSnapshot.length - 1; index >= 0; index -= 1) {
    result = mod(result * point + canonicalFieldElement(coefficientSnapshot[index], prime, `coefficients[${String(index)}]`), prime);
  }
  return result;
}

export function normalizeAffineObservation(
  encodedOutput: number,
  calibration: AffineCalibration,
  prime: number,
): number {
  assertPrime(prime);
  const output = canonicalFieldElement(encodedOutput, prime, "encoded_output");
  const calibrationSnapshot = snapshotJson(calibration);
  if (calibrationSnapshot === null || Array.isArray(calibrationSnapshot) || typeof calibrationSnapshot !== "object") {
    fail("invalid_chart", "calibration must be a plain bounded object");
  }
  const keys = Object.keys(calibrationSnapshot).sort();
  if (keys.join("\u0000") !== ["encoded_one", "encoded_zero", "posture"].join("\u0000")
    || calibrationSnapshot.posture !== "declared_exact_two_anchor_affine") {
    fail("invalid_chart", "calibration must be the exact declared two-anchor affine shape");
  }
  const encodedZero = canonicalFieldElement(calibrationSnapshot.encoded_zero, prime, "calibration.encoded_zero");
  const encodedOne = canonicalFieldElement(calibrationSnapshot.encoded_one, prime, "calibration.encoded_one");
  const slope = mod(encodedOne - encodedZero, prime);
  if (slope === 0) fail("invalid_chart", "affine calibration anchors must encode distinct field elements");
  return mod((output - encodedZero) * inverse(slope, prime), prime);
}

export function canonicalFieldElement(value: unknown, prime: number, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value >= prime) {
    fail("invalid_field", `${path} must be a canonical element of F_${String(prime)}`);
  }
  return value;
}
