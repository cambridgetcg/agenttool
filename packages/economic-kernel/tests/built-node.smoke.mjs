import {
  ECONOMIC_KERNEL_PROTOCOL,
  SCHEMAS,
  UnitRegistry,
  amount,
  evaluateEconomicAdmission,
} from "../dist/index.js";

const units = new UnitRegistry([{
  schema: SCHEMAS.unit,
  unit_id: "iso4217:gbp:minor",
  dimension: "FIAT",
  decimals: 2,
  ledger_domain: "ledger:gbp",
  transferability: "TRANSFERABLE",
}]);

if (ECONOMIC_KERNEL_PROTOCOL !== "agenttool.economic-kernel/0.1") throw new Error("protocol mismatch");
if (amount("iso4217:gbp:minor", "9007199254740993", units).amount_atomic !== "9007199254740993") {
  throw new Error("exact amount smoke failed");
}
if (evaluateEconomicAdmission({
  action_digest: `sha256:${"a".repeat(64)}`,
  gate_evidence_ref: "gate:smoke",
  gate_revision: "1",
  evaluated_at: "2026-09-02T00:00:00.000Z",
  valid_until: "2026-09-02T00:01:00.000Z",
  authority: "ALLOW",
  safety: "ALLOW",
  participation: "NOT_REQUIRED",
  payment: "NOT_REQUIRED",
}).outcome !== "ADMIT") {
  throw new Error("admission smoke failed");
}
