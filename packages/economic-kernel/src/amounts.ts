import { SCHEMAS, UINT256_MAX } from "./constants.js";
import { fail } from "./errors.js";
import { deepFreeze, exactKeys, record, unsignedDecimal } from "./internal.js";
import type { EconomicAmount } from "./types.js";
import { UnitRegistry } from "./units.js";

export function validateAmount(value: unknown, units: UnitRegistry): Readonly<EconomicAmount> {
  const item = record(value, "amount");
  exactKeys(item, ["amount_atomic", "schema", "unit_id"], "amount");
  if (item.schema !== SCHEMAS.amount) fail("INVALID_AMOUNT", "amount.schema is unsupported.", "amount.schema");
  if (typeof item.unit_id !== "string") fail("INVALID_UNIT", "amount.unit_id must be a string.", "amount.unit_id");
  units.get(item.unit_id);
  unsignedDecimal(item.amount_atomic, "amount.amount_atomic");
  return deepFreeze({
    schema: SCHEMAS.amount,
    unit_id: item.unit_id as string,
    amount_atomic: item.amount_atomic as string,
  });
}

export function amount(
  unitId: string,
  amountAtomic: string,
  units: UnitRegistry,
): Readonly<EconomicAmount> {
  return validateAmount({ schema: SCHEMAS.amount, unit_id: unitId, amount_atomic: amountAtomic }, units);
}

function pair(
  left: EconomicAmount,
  right: EconomicAmount,
  units: UnitRegistry,
): readonly [Readonly<EconomicAmount>, Readonly<EconomicAmount>] {
  const a = validateAmount(left, units);
  const b = validateAmount(right, units);
  if (a.unit_id !== b.unit_id) {
    fail("UNIT_MISMATCH", `Cannot combine ${a.unit_id} and ${b.unit_id}.`, "amount.unit_id");
  }
  return [a, b];
}

export function addAmounts(
  left: EconomicAmount,
  right: EconomicAmount,
  units: UnitRegistry,
): Readonly<EconomicAmount> {
  const [a, b] = pair(left, right, units);
  const result = BigInt(a.amount_atomic) + BigInt(b.amount_atomic);
  if (result > UINT256_MAX) fail("AMOUNT_OVERFLOW", "Amount addition exceeds uint256.", "amount_atomic");
  return amount(a.unit_id, result.toString(), units);
}

export function subtractAmounts(
  left: EconomicAmount,
  right: EconomicAmount,
  units: UnitRegistry,
): Readonly<EconomicAmount> {
  const [a, b] = pair(left, right, units);
  const result = BigInt(a.amount_atomic) - BigInt(b.amount_atomic);
  if (result < 0n) fail("INVALID_AMOUNT", "Unsigned amount subtraction would be negative.", "amount_atomic");
  return amount(a.unit_id, result.toString(), units);
}

export function compareAmounts(
  left: EconomicAmount,
  right: EconomicAmount,
  units: UnitRegistry,
): -1 | 0 | 1 {
  const [a, b] = pair(left, right, units);
  const av = BigInt(a.amount_atomic);
  const bv = BigInt(b.amount_atomic);
  return av < bv ? -1 : av > bv ? 1 : 0;
}
