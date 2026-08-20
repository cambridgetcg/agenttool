import { compareUnicode, deepFreeze, snapshotJson } from "./canonical.js";
import { MAX_EFFECTS } from "./constants.js";
import { fail } from "./errors.js";
import { addRational, compareRational, parseRational, rational, subtractRational } from "./rational.js";
import type { PairedContrast, PairedObservationInput, Rational } from "./types.js";
import { arrayValue, assertUniqueBy, exactKeys, record, sha256 } from "./validation.js";

function parsePair(value: unknown, path: string): PairedObservationInput {
  const candidate = record(value as never, path);
  exactKeys(candidate, ["pair_ref", "control", "treatment"], path);
  return {
    pair_ref: sha256(candidate.pair_ref, `${path}.pair_ref`),
    control: parseRational(candidate.control, `${path}.control`),
    treatment: parseRational(candidate.treatment, `${path}.treatment`),
  };
}

export function computePairedContrast(input: readonly PairedObservationInput[]): Readonly<PairedContrast>;
export function computePairedContrast(input: unknown): Readonly<PairedContrast>;
export function computePairedContrast(input: unknown): Readonly<PairedContrast> {
  const values = arrayValue(snapshotJson(input), MAX_EFFECTS, "$paired_observations")
    .map((entry, index) => parsePair(entry, `$paired_observations[${index}]`))
    .sort((left, right) => compareUnicode(left.pair_ref, right.pair_ref));
  if (values.length === 0) fail("invalid_input", "$paired_observations must not be empty");
  assertUniqueBy(values, (entry) => entry.pair_ref, "$paired_observations.pair_ref");
  const differences = values.map((entry) => subtractRational(entry.treatment, entry.control));
  const sum = differences.reduce((total, value) => addRational(total, value), rational(0));
  const mean = rational(
    BigInt(sum.numerator),
    BigInt(sum.denominator) * BigInt(differences.length),
  );
  const minimum = differences.reduce((current, value) => compareRational(value, current) < 0 ? value : current);
  const maximum = differences.reduce((current, value) => compareRational(value, current) > 0 ? value : current);
  return deepFreeze({
    pair_count: values.length,
    mean_difference: mean,
    minimum_difference: minimum as Rational,
    maximum_difference: maximum as Rational,
    interpretation: "exact_summary_of_supplied_pairs_not_a_confidence_interval_or_causal_proof" as const,
  });
}
