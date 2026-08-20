import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createTreasuryPolicy } from "@agenttool/zerone-agent-economy";

import {
  EXECUTION_SUPPORT,
  ZeroneAgentHostStore,
  assertEconomyMessageExecutionSupported,
} from "../src/index.js";
import {
  bindingForWallet,
  currentnessForProof,
  fixture,
  hash,
  LATER,
  proofForBinding,
  TIME,
} from "./helpers.js";

function initializedStore() {
  const values = fixture();
  const store = new ZeroneAgentHostStore(":memory:", {
    create: true,
    allow_in_memory_for_tests: true,
  });
  store.initialize();
  const head = store.putBindingHead(values.proof, values.currentness, {
    expected: null,
    updated_at: TIME,
  });
  return { store, values, head };
}

describe("durable authorization ledger", () => {
  test("atomically reserves current binding, capability, treasury, and Cosmos sequence", () => {
    const { store, values } = initializedStore();
    const operation = store.reserveOperation(values.reserve());
    expect(operation).toMatchObject({
      revision: 1,
      status: "reserved",
      signer_invoked: false,
      sequence: "9",
      execution_support: EXECUTION_SUPPORT,
    });
    expect(operation.reservations).toEqual([
      { purpose: "compute", amount_uzrn: "100000", state: "reserved" },
      { purpose: "network_fee", amount_uzrn: "20000", state: "reserved" },
    ]);
    expect(store.getTreasuryExposure(values.profile.chain_id, values.account)).toBe("120000");
    expect(store.getCapabilityUsage(hash("9"))).toMatchObject({
      reserved_intents: 1,
      consumed_intents: 0,
      reserved_spend_uzrn: "100000",
    });
    expect(store.getAccountState(values.profile.chain_id, values.account)).toMatchObject({
      sequence: "9",
      halted: false,
      held_operation_id: "operation-1",
    });
    expect(store.verify()).toMatchObject({
      ok: true,
      operation_count: 1,
      held_sequence_fence_count: 1,
      event_count: 1,
    });
    const rawDatabase = Reflect.get(store, "db") as Database;
    expect(() => rawDatabase.query(`
      UPDATE operation_events SET kind = 'tampered'
      WHERE operation_id = ? AND sequence = 1
    `).run(operation.operation_id)).toThrow(/append-only/);
    store.close();
  });

  test("rejects stale heads, duplicate purposes, reserve-floor breach, and a second account fence", () => {
    const { store, values } = initializedStore();
    expect(() => store.reserveOperation(values.reserve("bad-head", {
      binding_head: { ...values.reserve().binding_head, proof_id: hash("f") },
    }))).toThrow(/expectation is stale/);
    expect(() => store.reserveOperation(values.reserve("bad-policy", {
      capability: { ...values.reserve().capability, policy_hash: hash("a") },
    }))).toThrow(/capability policy hash/);
    expect(() => store.reserveOperation(values.reserve("duplicate-purpose", {
      reservations: [
        { purpose: "compute", amount_uzrn: "1" },
        { purpose: "compute", amount_uzrn: "2" },
      ],
    }))).toThrow(/at most once/);
    expect(() => store.reserveOperation(values.reserve("floor", {
      account_snapshot: { ...values.snapshot, balance_uzrn: "400000" },
      reservations: [{ purpose: "compute", amount_uzrn: "100001" }],
    }))).toThrow(/reserve floor/);

    store.reserveOperation(values.reserve());
    expect(() => store.reserveOperation(values.reserve("operation-2"))).toThrow(/in-flight/);
    store.close();
  });

  test("moves exposure and capability usage to sticky/consumed before signer invocation", () => {
    const { store, values } = initializedStore();
    const reserved = store.reserveOperation(values.reserve());
    const signing = store.recordSignerInvocationBoundary({
      operation_id: reserved.operation_id,
      expected_revision: reserved.revision,
      account_snapshot: values.snapshot,
      request_id: "signing-request-1",
      unsigned_payload_hash: hash("b"),
      external_verification_id: hash("c"),
      at: LATER,
    });
    expect(signing.status).toBe("signing");
    expect(signing.signer_invoked).toBeTrue();
    expect(signing.reservations.every(({ state }) => state === "sticky")).toBeTrue();
    expect(store.getCapabilityUsage(hash("9"))).toMatchObject({
      reserved_intents: 0,
      consumed_intents: 1,
      reserved_spend_uzrn: "0",
      consumed_spend_uzrn: "100000",
    });
    expect(() => store.releasePreSign({
      operation_id: signing.operation_id,
      expected_revision: signing.revision,
      release_id: hash("d"),
      reason: "caller_cancelled",
      at: LATER,
    })).toThrow(/compare-and-swap/);
    expect(store.verify().ok).toBeTrue();
    store.close();
  });

  test("rejects retrograde reservation and lifecycle timestamps without partial mutation", () => {
    const { store, values } = initializedStore();
    expect(() => store.reserveOperation(values.reserve("non-millisecond-time", {
      created_at: "2026-08-20T20:00:00Z",
    }))).toThrow(/canonical millisecond UTC timestamp/);
    expect(() => store.reserveOperation(values.reserve("retrograde-reservation", {
      created_at: "2026-08-20T19:59:59.000Z",
    }))).toThrow(/chronology backwards/);
    expect(store.getOperation("retrograde-reservation")).toBeNull();

    const reserved = store.reserveOperation(values.reserve());
    expect(() => store.recordSignerInvocationBoundary({
      operation_id: reserved.operation_id,
      expected_revision: reserved.revision,
      account_snapshot: values.snapshot,
      request_id: "retrograde-signing",
      unsigned_payload_hash: hash("d"),
      external_verification_id: hash("e"),
      at: "2026-08-20T19:59:59.000Z",
    })).toThrow(/chronology backwards/);
    expect(store.getOperation(reserved.operation_id)).toMatchObject({
      status: "reserved",
      revision: 1,
      signer_invoked: false,
    });
    expect(store.verify().ok).toBeTrue();
    store.close();
  });

  test("rejects wallet aliases and treasury-policy rotation for one source account", () => {
    const { store, values } = initializedStore();
    const alias = bindingForWallet("wallet-host-alias");
    const aliasProof = proofForBinding(alias);
    expect(() => store.putBindingHead(aliasProof, currentnessForProof(aliasProof), {
      expected: null,
      updated_at: TIME,
    })).toThrow(/source account.*(?:bound|consumed)/);

    const reserved = store.reserveOperation(values.reserve());
    const signing = store.recordSignerInvocationBoundary({
      operation_id: reserved.operation_id,
      expected_revision: reserved.revision,
      account_snapshot: values.snapshot,
      request_id: "policy-rotation-signing",
      unsigned_payload_hash: hash("d"),
      external_verification_id: hash("e"),
      at: LATER,
    });
    const sequence10 = {
      ...values.snapshot,
      sequence: "10",
      observed_at_height: "1501",
      block_hash: "B".repeat(64),
      observed_at: "2026-08-20T20:02:00.000Z",
    };
    store.applySequenceAdvanceEvidence({
      operation_id: signing.operation_id,
      expected_revision: signing.revision,
      evidence_id: hash("f"),
      snapshot: sequence10,
      observed_at: sequence10.observed_at,
    });
    const rotatedPolicy = createTreasuryPolicy({
      wallet_binding: values.binding,
      network: values.treasury.network,
      wallet_binding_id: values.treasury.wallet_binding_id,
      treasury_account: values.treasury.treasury_account,
      denom: values.treasury.denom,
      reserve_floor_uzrn: values.treasury.reserve_floor_uzrn,
      max_single_spend_uzrn: values.treasury.max_single_spend_uzrn,
      window_blocks: values.treasury.window_blocks,
      window_caps_uzrn: values.treasury.window_caps_uzrn,
      allowed_purposes: values.treasury.allowed_purposes,
      issued_at: "2026-08-20T19:46:00.000Z",
    });
    expect(rotatedPolicy.treasury_policy_id).not.toBe(values.treasury.treasury_policy_id);
    expect(() => store.reserveOperation(values.reserve("operation-2", {
      treasury_policy: rotatedPolicy,
      capability: {
        ...values.reserve().capability,
        capability_record_id: hash("0"),
        policy_hash: rotatedPolicy.treasury_policy_id,
      },
      account_snapshot: sequence10,
      created_at: "2026-08-20T20:03:00.000Z",
    }))).toThrow(/policy rotation is blocked/);
    expect(store.verify().ok).toBeTrue();
    store.close();
  });

  test("has an explicit execution blocker", () => {
    expect(EXECUTION_SUPPORT.economy_message_planning)
      .toBe("blocked_pending_reviewed_native_planner");
    expect(() => assertEconomyMessageExecutionSupported()).toThrow(/cannot plan, sign, or broadcast/);
  });
});
