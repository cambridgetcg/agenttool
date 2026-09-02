import { createHash } from "node:crypto";

import { SCHEMAS, UINT64_MAX, UINT256_MAX } from "./constants.js";
import { amount, validateAmount } from "./amounts.js";
import { fail } from "./errors.js";
import {
  deepFreeze,
  enumValue,
  exactKeys,
  identifier,
  positiveDecimal,
  record,
  snapshotJson,
  timestamp,
  uint64Decimal,
} from "./internal.js";
import type {
  ConversionResult,
  EconomicAmount,
  PriceRevision,
  PriceRevisionSeed,
  PriceRounding,
} from "./types.js";
import { UnitRegistry } from "./units.js";

const ROUNDING: readonly PriceRounding[] = ["EXACT_ONLY", "RETURN_REMAINDER"];

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  let a = left;
  let b = right;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

function validatePriceRevisionSeed(
  value: unknown,
  units: UnitRegistry,
): Readonly<PriceRevisionSeed> {
  const item = record(value, "price_revision_seed");
  exactKeys(item, [
    "effective_from",
    "effective_until",
    "input_atomic_per_lot",
    "input_unit_id",
    "output_atomic_per_lot",
    "output_unit_id",
    "price_book_id",
    "revision",
    "rounding",
    "schema",
    "supersedes_price_revision_id",
  ], "price_revision_seed");
  if (item.schema !== SCHEMAS.priceRevision) {
    fail("INVALID_PRICE_REVISION", "price_revision_seed.schema is unsupported.", "price_revision_seed.schema");
  }
  identifier(item.price_book_id, "price_revision.price_book_id");
  const revision = uint64Decimal(item.revision, "price_revision.revision");
  if (revision === "0") fail("INVALID_PRICE_REVISION", "price_revision.revision must be positive.", "price_revision.revision");
  if (typeof item.input_unit_id !== "string" || typeof item.output_unit_id !== "string") {
    fail("INVALID_UNIT", "Price unit ids must be strings.", "price_revision");
  }
  units.get(item.input_unit_id);
  units.get(item.output_unit_id);
  if (item.input_unit_id === item.output_unit_id) {
    fail("INVALID_PRICE_REVISION", "A price revision must convert between distinct units.", "price_revision");
  }
  const inputLot = positiveDecimal(item.input_atomic_per_lot, "price_revision.input_atomic_per_lot");
  const outputLot = positiveDecimal(item.output_atomic_per_lot, "price_revision.output_atomic_per_lot");
  if (greatestCommonDivisor(BigInt(inputLot), BigInt(outputLot)) !== 1n) {
    fail("INVALID_PRICE_REVISION", "Price ratio must be reduced to lowest terms.", "price_revision");
  }
  const from = timestamp(item.effective_from, "price_revision.effective_from");
  if (item.effective_until !== null) {
    const until = timestamp(item.effective_until, "price_revision.effective_until");
    if (Date.parse(until) <= Date.parse(from)) {
      fail("INVALID_PRICE_REVISION", "Price interval must have positive duration.", "price_revision.effective_until");
    }
  }
  if (item.supersedes_price_revision_id !== null) {
    const predecessor = identifier(item.supersedes_price_revision_id, "price_revision.supersedes_price_revision_id");
    if (!/^sha256:[0-9a-f]{64}$/u.test(predecessor)) {
      fail(
        "INVALID_PRICE_REVISION",
        "A predecessor price revision must be a content-derived sha256 identifier.",
        "price_revision.supersedes_price_revision_id",
      );
    }
  }
  enumValue(item.rounding, ROUNDING, "price_revision.rounding");
  return deepFreeze(item as unknown as PriceRevisionSeed);
}

export function derivePriceRevisionId(value: unknown, units: UnitRegistry): string {
  const seed = validatePriceRevisionSeed(value, units);
  const canonicalPayload = JSON.stringify({
    schema: seed.schema,
    price_book_id: seed.price_book_id,
    revision: seed.revision,
    input_unit_id: seed.input_unit_id,
    output_unit_id: seed.output_unit_id,
    input_atomic_per_lot: seed.input_atomic_per_lot,
    output_atomic_per_lot: seed.output_atomic_per_lot,
    effective_from: seed.effective_from,
    effective_until: seed.effective_until,
    supersedes_price_revision_id: seed.supersedes_price_revision_id,
    rounding: seed.rounding,
  });
  return `sha256:${createHash("sha256").update(canonicalPayload, "utf8").digest("hex")}`;
}

export function createPriceRevision(value: unknown, units: UnitRegistry): Readonly<PriceRevision> {
  const seed = validatePriceRevisionSeed(value, units);
  return deepFreeze({ price_revision_id: derivePriceRevisionId(seed, units), ...seed });
}

export function validatePriceRevision(
  value: unknown,
  units: UnitRegistry,
): Readonly<PriceRevision> {
  const item = record(value, "price_revision");
  exactKeys(item, [
    "effective_from",
    "effective_until",
    "input_atomic_per_lot",
    "input_unit_id",
    "output_atomic_per_lot",
    "output_unit_id",
    "price_book_id",
    "price_revision_id",
    "revision",
    "rounding",
    "schema",
    "supersedes_price_revision_id",
  ], "price_revision");
  const id = identifier(item.price_revision_id, "price_revision.price_revision_id");
  const seed = validatePriceRevisionSeed({
    effective_from: item.effective_from,
    effective_until: item.effective_until,
    input_atomic_per_lot: item.input_atomic_per_lot,
    input_unit_id: item.input_unit_id,
    output_atomic_per_lot: item.output_atomic_per_lot,
    output_unit_id: item.output_unit_id,
    price_book_id: item.price_book_id,
    revision: item.revision,
    rounding: item.rounding,
    schema: item.schema,
    supersedes_price_revision_id: item.supersedes_price_revision_id,
  }, units);
  const expected = derivePriceRevisionId(seed, units);
  if (id !== expected) {
    fail(
      "INVALID_PRICE_REVISION",
      "price_revision_id must be the SHA-256 identity of the exact semantic revision payload.",
      "price_revision.price_revision_id",
    );
  }
  return deepFreeze({ price_revision_id: id, ...seed });
}

export function validatePriceBookTimeline(
  value: unknown,
  units: UnitRegistry,
): readonly Readonly<PriceRevision>[] {
  const snapshot = snapshotJson(value);
  if (!Array.isArray(snapshot) || snapshot.length === 0 || snapshot.length > 256) {
    fail("INVALID_PRICE_REVISION", "Price book timeline must contain 1..256 revisions.", "price_revisions");
  }
  const revisions = snapshot.map((item) => validatePriceRevision(item, units));
  const ids = new Set<string>();
  for (const revision of revisions) {
    if (ids.has(revision.price_revision_id)) {
      fail("PRICE_BOOK_CONFLICT", `Duplicate price revision id ${revision.price_revision_id}.`, "price_revisions");
    }
    ids.add(revision.price_revision_id);
  }
  const first = revisions[0]!;
  if (first.revision !== "1" || first.supersedes_price_revision_id !== null) {
    fail("PRICE_BOOK_CONFLICT", "A price book must begin at revision 1 with no predecessor.", "price_revisions[0]");
  }
  for (let index = 1; index < revisions.length; index += 1) {
    const previous = revisions[index - 1]!;
    const current = revisions[index]!;
    if (
      current.price_book_id !== first.price_book_id
      || current.input_unit_id !== first.input_unit_id
      || current.output_unit_id !== first.output_unit_id
    ) {
      fail("PRICE_BOOK_CONFLICT", "One price book cannot change identity or unit direction.", `price_revisions[${String(index)}]`);
    }
    const expectedRevision = BigInt(previous.revision) + 1n;
    if (expectedRevision > UINT64_MAX || current.revision !== expectedRevision.toString()) {
      fail("PRICE_BOOK_CONFLICT", "Price revisions must be contiguous and ordered.", `price_revisions[${String(index)}].revision`);
    }
    if (current.supersedes_price_revision_id !== previous.price_revision_id) {
      fail("PRICE_BOOK_CONFLICT", "Price revision must name its exact predecessor.", `price_revisions[${String(index)}].supersedes_price_revision_id`);
    }
    if (previous.effective_until === null) {
      fail("PRICE_BOOK_CONFLICT", "An open-ended price revision cannot have a successor.", `price_revisions[${String(index - 1)}].effective_until`);
    }
    if (Date.parse(previous.effective_until) > Date.parse(current.effective_from)) {
      fail("PRICE_BOOK_CONFLICT", "Price revision intervals must not overlap.", `price_revisions[${String(index)}].effective_from`);
    }
  }
  return deepFreeze(revisions);
}

export function priceIsEffective(revision: PriceRevision, observedAt: string): boolean {
  const at = timestamp(observedAt, "observed_at");
  const instant = Date.parse(at);
  return instant >= Date.parse(revision.effective_from)
    && (revision.effective_until === null || instant < Date.parse(revision.effective_until));
}

export function selectEffectivePriceRevision(
  timeline: unknown,
  observedAt: string,
  units: UnitRegistry,
): Readonly<PriceRevision> {
  const revisions = validatePriceBookTimeline(timeline, units);
  const matches = revisions.filter((revision) => priceIsEffective(revision, observedAt));
  if (matches.length !== 1) {
    fail("PRICE_NOT_EFFECTIVE", "Exactly one price revision must be effective at the observation time.", "observed_at");
  }
  return matches[0]!;
}

export function convertAmount(
  inputValue: EconomicAmount,
  revisionValue: PriceRevision,
  observedAt: string,
  units: UnitRegistry,
): Readonly<ConversionResult> {
  const input = validateAmount(inputValue, units);
  const revision = validatePriceRevision(revisionValue, units);
  if (input.unit_id !== revision.input_unit_id) {
    fail("UNIT_MISMATCH", "Conversion input does not match the price input unit.", "input.unit_id");
  }
  if (!priceIsEffective(revision, observedAt)) {
    fail("PRICE_NOT_EFFECTIVE", "Price revision is not effective at the observation time.", "observed_at");
  }
  const numerator = BigInt(input.amount_atomic) * BigInt(revision.output_atomic_per_lot);
  const denominator = BigInt(revision.input_atomic_per_lot);
  const outputAtomic = numerator / denominator;
  const remainder = numerator % denominator;
  if (outputAtomic > UINT256_MAX) {
    fail("AMOUNT_OVERFLOW", "Converted amount exceeds uint256.", "output.amount_atomic");
  }
  if (remainder !== 0n && revision.rounding === "EXACT_ONLY") {
    fail(
      "NON_INTEGRAL_CONVERSION",
      `Conversion leaves fractional output remainder ${remainder.toString()}/${denominator.toString()}.`,
      "input.amount_atomic",
    );
  }
  if (remainder !== 0n) {
    return deepFreeze({
      schema: SCHEMAS.conversionResult,
      price_revision_id: revision.price_revision_id,
      input,
      exact: false,
      output_unit_id: revision.output_unit_id,
      dividend: numerator.toString(),
      divisor: denominator.toString(),
      remainder: remainder.toString(),
    } satisfies ConversionResult);
  }
  return deepFreeze({
    schema: SCHEMAS.conversionResult,
    price_revision_id: revision.price_revision_id,
    input,
    exact: true,
    output: amount(revision.output_unit_id, outputAtomic.toString(), units),
  } satisfies ConversionResult);
}
