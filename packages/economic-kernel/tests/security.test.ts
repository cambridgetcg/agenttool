import { describe, expect, test } from "bun:test";

import { EconomicKernelError, SCHEMAS, UnitRegistry, amount, evaluateEconomicAdmission, validateAmount } from "../src/index.js";
import { ACTION_DIGEST, GBP, makeUnits } from "./fixtures.js";

describe("hostile-input boundary", () => {
  test("snapshots and deeply freezes caller-owned JSON", () => {
    const input = {
      action_digest: ACTION_DIGEST,
      gate_evidence_ref: "gate:decision-1",
      gate_revision: "1",
      evaluated_at: "2026-09-02T00:00:00.000Z",
      valid_until: "2026-09-02T00:01:00.000Z",
      authority: "ALLOW",
      safety: "ALLOW",
      participation: "ACCEPTED",
      payment: "NOT_REQUIRED",
    };
    const decision = evaluateEconomicAdmission(input);
    input.payment = "UNSATISFIED";
    expect(decision.input.payment).toBe("NOT_REQUIRED");
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.input)).toBe(true);
    expect(() => evaluateEconomicAdmission({ ...input, action_digest: "sha256:not-a-digest" })).toThrow();
  });

  test("rejects proxies and accessor properties", () => {
    const proxy = new Proxy({
      schema: SCHEMAS.amount,
      unit_id: GBP,
      amount_atomic: "1",
    }, {});
    expect(() => amount(GBP, "1", new UnitRegistry([proxy]))).toThrow();

    const hostile: Record<string, unknown> = {
      schema: SCHEMAS.amount,
      unit_id: GBP,
    };
    Object.defineProperty(hostile, "amount_atomic", {
      enumerable: true,
      get: () => "1",
    });
    expect(() => validateAmount(hostile, makeUnits())).toThrow();

    const canary = "secret\nterminal-canary";
    const hostileKey: Record<string, unknown> = {};
    Object.defineProperty(hostileKey, canary, { enumerable: true, get: () => "hidden" });
    try {
      validateAmount(hostileKey, makeUnits());
      throw new Error("hostile accessor was accepted");
    } catch (error) {
      expect(error).toBeInstanceOf(EconomicKernelError);
      expect(String((error as Error).message)).not.toContain(canary);
      expect((error as EconomicKernelError).path).not.toContain(canary);
    }

    let getterRan = false;
    const units = [makeUnits().list()[0]];
    Object.defineProperty(units, "0", {
      enumerable: true,
      configurable: true,
      get: () => {
        getterRan = true;
        return makeUnits().list()[0];
      },
    });
    expect(() => new UnitRegistry(units)).toThrow();
    expect(getterRan).toBe(false);
  });

  test("rejects cycles, custom prototypes, sparse arrays, and unknown fields", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => new UnitRegistry(cyclic)).toThrow();
    const inherited = Object.create({});
    Object.assign(inherited, {
      schema: SCHEMAS.unit,
      unit_id: GBP,
      dimension: "FIAT",
      decimals: 2,
      ledger_domain: "ledger:gbp",
      transferability: "TRANSFERABLE",
    });
    expect(() => new UnitRegistry([inherited])).toThrow();
    const sparse = new Array(2);
    sparse[0] = makeUnits().list()[0];
    expect(() => new UnitRegistry(sparse)).toThrow();
    expect(() => new UnitRegistry(new Array(10_000_000))).toThrow();
    const protoKey = JSON.parse(`{
      "schema":"${SCHEMAS.amount}",
      "unit_id":"${GBP}",
      "amount_atomic":"1",
      "__proto__":7
    }`) as unknown;
    expect(() => validateAmount(protoKey, makeUnits())).toThrow();
    expect(() => evaluateEconomicAdmission({
      action_digest: ACTION_DIGEST,
      gate_evidence_ref: "gate:decision-1",
      gate_revision: "1",
      evaluated_at: "2026-09-02T00:00:00.000Z",
      valid_until: "2026-09-02T00:01:00.000Z",
      authority: "ALLOW",
      safety: "ALLOW",
      participation: "ACCEPTED",
      payment: "NOT_REQUIRED",
      reward: "infinite",
    })).toThrow();
  });

  test("canonical comparison does not depend on ambient locale collation", () => {
    const base = {
      schema: SCHEMAS.amount,
      unit_id: GBP,
      amount_atomic: "1",
    };
    expect(() => validateAmount({ ...base, "e\u0301": 1, "é": 2 }, makeUnits())).toThrow();
    expect(() => validateAmount({ ...base, "é": 2, "e\u0301": 1 }, makeUnits())).toThrow();
  });
});
