const SIGNED_INT64_MAX_DECIMAL = "9223372036854775807";
const POSITIVE_DECIMAL = /^[1-9][0-9]*$/;

/**
 * Validate a canonical positive PostgreSQL bigint without parsing unbounded
 * attacker-controlled digits into a JavaScript BigInt.
 */
export function isCanonicalPositiveInt64Decimal(
  value: unknown,
): value is string {
  if (typeof value !== "string" || !POSITIVE_DECIMAL.test(value)) {
    return false;
  }
  return value.length < SIGNED_INT64_MAX_DECIMAL.length ||
    (
      value.length === SIGNED_INT64_MAX_DECIMAL.length &&
      value <= SIGNED_INT64_MAX_DECIMAL
    );
}

/** Validate the same canonical range while also accepting the cursor value 0. */
export function isCanonicalNonnegativeInt64Decimal(
  value: unknown,
): value is string {
  return value === "0" || isCanonicalPositiveInt64Decimal(value);
}
