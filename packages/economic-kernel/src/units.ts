import { SCHEMAS } from "./constants.js";
import { fail } from "./errors.js";
import {
  compareText,
  deepFreeze,
  enumValue,
  exactKeys,
  identifier,
  record,
  safeInteger,
  snapshotJson,
} from "./internal.js";
import type { Transferability, UnitDefinition, UnitDimension } from "./types.js";

const DIMENSIONS: readonly UnitDimension[] = ["FIAT", "TOKEN", "ENTITLEMENT"];
const TRANSFERABILITY: readonly Transferability[] = ["TRANSFERABLE", "NONTRANSFERABLE"];

export function validateUnitDefinition(value: unknown): Readonly<UnitDefinition> {
  const item = record(value, "unit");
  exactKeys(item, [
    "decimals",
    "dimension",
    "ledger_domain",
    "schema",
    "transferability",
    "unit_id",
  ], "unit");
  if (item.schema !== SCHEMAS.unit) fail("INVALID_UNIT", "unit.schema is unsupported.", "unit.schema");
  identifier(item.unit_id, "unit.unit_id");
  identifier(item.ledger_domain, "unit.ledger_domain");
  enumValue(item.dimension, DIMENSIONS, "unit.dimension");
  enumValue(item.transferability, TRANSFERABILITY, "unit.transferability");
  safeInteger(item.decimals, "unit.decimals", 0, 255);
  return deepFreeze(item as unknown as UnitDefinition);
}

export class UnitRegistry {
  readonly #units: ReadonlyMap<string, Readonly<UnitDefinition>>;
  readonly #snapshot: readonly Readonly<UnitDefinition>[];

  constructor(values: unknown) {
    const snapshot = snapshotJson(values);
    if (!Array.isArray(snapshot) || snapshot.length === 0 || snapshot.length > 256) {
      fail("INVALID_UNIT", "Unit registry must contain 1..256 definitions.", "units");
    }
    const units = snapshot.map((value) => validateUnitDefinition(value));
    const map = new Map<string, Readonly<UnitDefinition>>();
    for (const unit of units) {
      if (map.has(unit.unit_id)) {
        fail("INVALID_UNIT", `Duplicate unit_id ${unit.unit_id}.`, "units");
      }
      map.set(unit.unit_id, unit);
    }
    this.#snapshot = deepFreeze([...units].sort((left, right) => compareText(left.unit_id, right.unit_id)));
    this.#units = map;
    Object.freeze(this);
  }

  has(unitId: string): boolean {
    return this.#units.has(unitId);
  }

  get(unitId: string): Readonly<UnitDefinition> {
    identifier(unitId, "unit_id");
    const unit = this.#units.get(unitId);
    if (!unit) fail("INVALID_UNIT", `Unknown unit_id ${unitId}.`, "unit_id");
    return unit;
  }

  list(): readonly Readonly<UnitDefinition>[] {
    return this.#snapshot;
  }
}
