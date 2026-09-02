import { describe, expect, test } from "bun:test";

import {
  assertTreasuryPolicyDoesNotWiden,
  createTreasuryPolicy,
  evaluateTreasurySpend,
  evaluateWorkAdmission,
} from "../src/index.js";
import { buildFixture, HASHES } from "./fixtures.js";

describe("self-sustainability treasury", () => {
  test("subtracts reservations, sticky unknown exposure, and the reserve floor", () => {
    const { treasury, binding } = buildFixture();
    const base = {
      current_height: "1500",
      current_balance_uzrn: "1000000",
      durable_reserved_uzrn: "100000",
      sticky_unknown_exposure_uzrn: "200000",
      purpose: "compute" as const,
      spent_in_window_uzrn: {
        compute: "0",
        storage: "0",
        network_fee: "0",
        knowledge_bond: "0",
        sponsorship_escrow: "0",
        total: "0",
      },
    };
    expect(evaluateTreasurySpend(treasury, { ...base, amount_uzrn: "200000" })).toEqual({
      allowed: true,
      reason: "within_policy",
      post_spend_balance_uzrn: "800000",
      effects_performed: false,
    });
    expect(evaluateTreasurySpend(treasury, { ...base, amount_uzrn: "200001" }).reason)
      .toBe("single_spend_exceeded");

    const reserveLimited = { ...treasury, max_single_spend_uzrn: "500000", window_caps_uzrn: {
      ...treasury.window_caps_uzrn,
      compute: "500000",
      total: "500000",
    } };
    // Rebuild rather than trusting a tampered policy ID.
    const widerSingle = createTreasuryPolicy({
      wallet_binding: binding,
      network: reserveLimited.network,
      wallet_binding_id: reserveLimited.wallet_binding_id,
      treasury_account: reserveLimited.treasury_account,
      denom: "uzrn",
      reserve_floor_uzrn: reserveLimited.reserve_floor_uzrn,
      max_single_spend_uzrn: reserveLimited.max_single_spend_uzrn,
      window_blocks: reserveLimited.window_blocks,
      window_caps_uzrn: reserveLimited.window_caps_uzrn,
      allowed_purposes: reserveLimited.allowed_purposes,
      issued_at: reserveLimited.issued_at,
    });
    expect(evaluateTreasurySpend(widerSingle, { ...base, amount_uzrn: "400001" }).reason)
      .toBe("reserve_floor_breached");
    expect(() => evaluateTreasurySpend(treasury, {
      ...base,
      amount_uzrn: "1",
      spent_in_window_uzrn: { ...base.spent_in_window_uzrn, total: "1" },
    })).toThrow();
  });

  test("income remains allowed and no automatic staking, voting, or bridging exists", () => {
    const { treasury } = buildFixture();
    expect(treasury.receiving_allowed).toBeTrue();
    expect(treasury.automatic_staking).toBeFalse();
    expect(treasury.automatic_governance).toBeFalse();
    expect(treasury.automatic_bridging).toBeFalse();
  });

  test("delegates can narrow but never raise limits", () => {
    const { treasury, binding } = buildFixture();
    const narrowed = createTreasuryPolicy({
      wallet_binding: binding,
      network: treasury.network,
      wallet_binding_id: treasury.wallet_binding_id,
      treasury_account: treasury.treasury_account,
      denom: "uzrn",
      reserve_floor_uzrn: "400000",
      max_single_spend_uzrn: "100000",
      window_blocks: treasury.window_blocks,
      window_caps_uzrn: {
        compute: "100000",
        storage: "0",
        network_fee: "50000",
        knowledge_bond: "0",
        sponsorship_escrow: "0",
        total: "150000",
      },
      allowed_purposes: ["compute", "network_fee"],
      issued_at: "2026-08-20T19:00:00.000Z",
    });
    expect(() => assertTreasuryPolicyDoesNotWiden(treasury, narrowed)).not.toThrow();
    expect(() => assertTreasuryPolicyDoesNotWiden(narrowed, treasury)).toThrow();
  });

  test("requires the exact referenced wallet binding when constructing policy", () => {
    const { treasury, binding } = buildFixture();
    expect(() => createTreasuryPolicy({
      wallet_binding: binding,
      network: treasury.network,
      wallet_binding_id: HASHES.output,
      treasury_account: treasury.treasury_account,
      denom: treasury.denom,
      reserve_floor_uzrn: treasury.reserve_floor_uzrn,
      max_single_spend_uzrn: treasury.max_single_spend_uzrn,
      window_blocks: treasury.window_blocks,
      window_caps_uzrn: treasury.window_caps_uzrn,
      allowed_purposes: treasury.allowed_purposes,
      issued_at: treasury.issued_at,
    })).toThrow();
  });

  test("accounts for sponsorship escrow separately from compute and knowledge bonds", () => {
    const { treasury } = buildFixture();
    const spent = {
      compute: "0",
      storage: "0",
      network_fee: "0",
      knowledge_bond: "100000",
      sponsorship_escrow: "0",
      total: "100000",
    };
    expect(evaluateTreasurySpend(treasury, {
      current_height: "1500",
      current_balance_uzrn: "1000000",
      durable_reserved_uzrn: "0",
      sticky_unknown_exposure_uzrn: "0",
      purpose: "sponsorship_escrow",
      amount_uzrn: "200000",
      spent_in_window_uzrn: spent,
    }).reason).toBe("within_policy");
    expect(evaluateTreasurySpend(treasury, {
      current_height: "1500",
      current_balance_uzrn: "1000000",
      durable_reserved_uzrn: "0",
      sticky_unknown_exposure_uzrn: "0",
      purpose: "knowledge_bond",
      amount_uzrn: "1",
      spent_in_window_uzrn: spent,
    }).reason).toBe("purpose_window_exceeded");
  });

  test("declines work that cannot mature or protect the requested margin", () => {
    const base = {
      current_height: "1000",
      contract_end_height: "1200",
      expected_verification_blocks: "50",
      expected_challenge_blocks: "50",
      safety_blocks: "20",
      price_uzrn: "250000",
      compute_cost_uzrn: "100000",
      storage_cost_uzrn: "10000",
      review_fee_uzrn: "20000",
      network_fee_uzrn: "10000",
      minimum_margin_uzrn: "50000",
    };
    const accepted = evaluateWorkAdmission(base);
    expect(accepted.accepted).toBeTrue();
    expect(accepted.net_uzrn).toBe("110000");
    expect(accepted.conditions_rest).toBeFalse();
    expect(evaluateWorkAdmission({ ...base, contract_end_height: "1120" }).reason)
      .toBe("expires_before_contract_maturity");
    expect(evaluateWorkAdmission({ ...base, minimum_margin_uzrn: "120000" }).reason)
      .toBe("minimum_margin_not_met");
    expect(evaluateWorkAdmission({ ...base, compute_cost_uzrn: "300000" }).reason)
      .toBe("cost_exceeds_price");
  });
});
