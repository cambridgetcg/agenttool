import { describe, expect, test } from "bun:test";

import {
  SEMANTIC_BOUNDARY,
  validateEvidenceReceipt,
  validateWorkSpec,
  createWorkSpec,
} from "../src/index.js";
import { buildFixture } from "./fixtures.js";

describe("semantic and effect walls", () => {
  test("ZRN never becomes identity, truth, KARMA, or governance", () => {
    const fixture = buildFixture();
    expect(fixture.workSpec.semantic_boundary).toEqual(SEMANTIC_BOUNDARY);
    expect(fixture.evidence.semantic_boundary).toEqual(SEMANTIC_BOUNDARY);
    expect(fixture.settlement.semantic_boundary).toEqual(SEMANTIC_BOUNDARY);
    expect(fixture.treasury.semantic_boundary).toEqual(SEMANTIC_BOUNDARY);
  });

  test("closed records reject authority and score escape fields", () => {
    const { workSpec, evidence } = buildFixture();
    expect(() => validateWorkSpec({ ...workSpec, governance_weight: 1 })).toThrow();
    expect(() => validateEvidenceReceipt({ ...evidence, truth_score: 100 })).toThrow();
  });

  test("message builders perform no signer, RPC, simulation, broadcast, or custody work", () => {
    const { createBounty, submitClaim, fulfill } = buildFixture();
    for (const projection of [createBounty, submitClaim, fulfill]) {
      expect(projection.compatibility.signer_required).toBeTrue();
      expect(projection.compatibility.simulation_required).toBeTrue();
      expect(projection.compatibility.broadcast_required).toBeTrue();
      expect(projection.compatibility.durable_reservation_required).toBeTrue();
      expect(projection.compatibility.sticky_unknown_accounting_required).toBeTrue();
      expect(projection.compatibility.effects_performed).toBeFalse();
    }
  });

  test("zero corroborations means ordinary challenge-window maturity", () => {
    const { workSpec, sponsorAccount } = buildFixture();
    const { work_spec_id: _id, ...core } = workSpec;
    const zero = createWorkSpec({
      ...core,
      settlement: { ...core.settlement, min_corroborations: "0" },
    });
    expect(zero.settlement.min_corroborations).toBe("0");
    const reassigned = createWorkSpec({ ...core, worker_account: sponsorAccount });
    expect(reassigned.work_spec_id).not.toBe(workSpec.work_spec_id);
    expect(() => createWorkSpec({
      ...core,
      worker_account: core.worker_account.replace(
        "cosmos:zerone-testnet-1:",
        "cosmos:zerone-1:",
      ) as typeof core.worker_account,
    })).toThrow();
  });

  test("v0 only adds a Fact and requires exact existing Fact IDs for edges", () => {
    const { workSpec } = buildFixture();
    expect(workSpec.target_tree.transition_kind).toBe("add_fact");
    expect(workSpec.target_tree.parent_fact_ids).toEqual(["commitment-UW"]);
    const { work_spec_id: _id, ...core } = workSpec;
    expect(() => createWorkSpec({
      ...core,
      target_tree: { ...core.target_tree, transition_kind: "tombstone" as never },
    })).toThrow();
    expect(() => createWorkSpec({
      ...core,
      target_tree: { ...core.target_tree, parent_fact_ids: ["not a fact id"] },
    })).toThrow();
  });
});
