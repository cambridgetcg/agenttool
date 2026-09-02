import { describe, expect, test } from "bun:test";

import type { ZeroneAgentHostStore as ZeroneAgentHostStoreType } from "../src/index.js";
import {
  currentnessForProof,
  fixture,
  hash,
  LATER,
  LegacyGenericTestHostStore as ZeroneAgentHostStore,
  TIME,
} from "./helpers.js";

function refreshBindingForReservation(
  store: ZeroneAgentHostStoreType,
  values: ReturnType<typeof fixture>,
  verifiedAt = "2026-08-20T20:05:01.000Z",
) {
  const prior = store.getBindingHead(values.binding.wallet_id);
  if (prior === null) throw new Error("test binding head is absent");
  const currentness = currentnessForProof(values.proof, {
    verifier_id: "lifecycle-currentness-refresh",
    verified_at: verifiedAt,
    valid_until: "2026-08-20T20:10:01.000Z",
  });
  return store.putBindingHead(values.proof, currentness, {
    expected: {
      wallet_id: prior.wallet_id,
      binding_id: prior.binding.binding_id,
      proof_id: prior.proof.proof_id,
      currentness_id: prior.currentness.currentness_id,
      head_version: prior.head_version,
    },
    updated_at: verifiedAt,
  });
}

function storeAndValues() {
  const values = fixture();
  const store = new ZeroneAgentHostStore(":memory:", {
    create: true,
    allow_in_memory_for_tests: true,
  });
  store.initialize();
  store.putBindingHead(values.proof, values.currentness, { expected: null, updated_at: TIME });
  return { store, values };
}

function makeSigned(store: ZeroneAgentHostStoreType, values: ReturnType<typeof fixture>) {
  const reserved = store.reserveOperation(values.reserve());
  const signing = store.recordSignerInvocationBoundary({
    operation_id: reserved.operation_id,
    expected_revision: reserved.revision,
    account_snapshot: values.snapshot,
    request_id: "request-1",
    unsigned_payload_hash: hash("b"),
    external_verification_id: hash("c"),
    at: LATER,
  });
  return store.recordVerifiedSignedEvidence({
    operation_id: signing.operation_id,
    expected_revision: signing.revision,
    tx_hash: "B".repeat(64),
    signed_payload_hash: hash("d"),
    external_verification_id: hash("e"),
    at: "2026-08-20T20:02:00.000Z",
  });
}

describe("sticky post-signer lifecycle", () => {
  test("rejects an unknown broadcast evidence status before mutation", () => {
    const { store, values } = storeAndValues();
    const signed = makeSigned(store, values);
    const submitting = store.recordBroadcastInvocationBoundary({
      operation_id: signed.operation_id,
      expected_revision: signed.revision,
      at: "2026-08-20T20:03:00.000Z",
    });
    const before = store.listEvents(submitting.operation_id);
    expect(() => store.recordBroadcastEvidence({
      status: "other",
      operation_id: submitting.operation_id,
      expected_revision: submitting.revision,
      tx_hash: "B".repeat(64),
      evidence_id: hash("f"),
      code: "unknown_status",
      at: "2026-08-20T20:04:00.000Z",
    } as never)).toThrow(/status is not supported/);
    expect(store.listEvents(submitting.operation_id)).toEqual(before);
    expect(store.verify().ok).toBeTrue();
    store.close();
  });

  test("keeps even a reported pre-submit rejection sticky until sequence advances", () => {
    const { store, values } = storeAndValues();
    const signed = makeSigned(store, values);
    const submitting = store.recordBroadcastInvocationBoundary({
      operation_id: signed.operation_id,
      expected_revision: signed.revision,
      at: "2026-08-20T20:03:00.000Z",
    });
    const rejected = store.recordBroadcastEvidence({
      status: "rejected_pre_submit",
      operation_id: submitting.operation_id,
      expected_revision: submitting.revision,
      tx_hash: "B".repeat(64),
      evidence_id: hash("f"),
      code: "transport_asserted_rejection",
      at: "2026-08-20T20:04:00.000Z",
    });
    expect(rejected.status).toBe("rejected_pre_submit_sticky");
    expect(rejected.reservations.every(({ state }) => state === "sticky")).toBeTrue();
    expect(store.getTreasuryExposure(values.profile.chain_id, values.account)).toBe("120000");
    expect(() => store.reserveOperation(values.reserve("operation-2"))).toThrow(/in-flight/);

    const advancedSnapshot = {
      ...values.snapshot,
      sequence: "10",
      balance_uzrn: "980000",
      observed_at_height: "1502",
      block_hash: "C".repeat(64),
      observed_at: "2026-08-20T20:05:00.000Z",
      valid_until: "2026-08-20T20:10:00.000Z",
    };
    const stale = store.applySequenceAdvanceEvidence({
      operation_id: rejected.operation_id,
      expected_revision: rejected.revision,
      evidence_id: hash("0"),
      snapshot: advancedSnapshot,
      observed_at: advancedSnapshot.observed_at,
    });
    expect(stale.status).toBe("sequence_superseded");
    expect(stale.reservations.every(({ state }) => state === "released")).toBeTrue();
    expect(store.getTreasuryExposure(values.profile.chain_id, values.account)).toBe("0");
    expect(store.getAccountState(values.profile.chain_id, values.account)?.held_operation_id).toBeNull();

    const refreshed = refreshBindingForReservation(store, values);
    const next = store.reserveOperation(values.reserve("operation-2", {
      binding_head: {
        wallet_id: refreshed.wallet_id,
        binding_id: refreshed.binding.binding_id,
        proof_id: refreshed.proof.proof_id,
        currentness_id: refreshed.currentness.currentness_id,
        head_version: refreshed.head_version,
      },
      account_snapshot: advancedSnapshot,
      created_at: refreshed.currentness.verified_at,
    }));
    expect(next.sequence).toBe("10");
    expect(store.getCapabilityUsage(hash("9"))).toMatchObject({
      reserved_intents: 1,
      consumed_intents: 1,
    });
    expect(store.verify().ok).toBeTrue();
    store.close();
  });

  test("does not mutate on absent or unavailable transaction lookup", () => {
    const { store, values } = storeAndValues();
    const signed = makeSigned(store, values);
    const beforeEvents = store.listEvents(signed.operation_id);
    const absent = store.applyTransactionEvidence({
      status: "absent",
      operation_id: signed.operation_id,
      expected_revision: signed.revision,
      evidence_id: hash("f"),
      tx_hash: "B".repeat(64),
      observed_at: "2026-08-20T20:03:00.000Z",
    });
    expect(absent).toEqual(signed);
    const unavailable = store.applyTransactionEvidence({
      status: "unavailable",
      operation_id: signed.operation_id,
      expected_revision: signed.revision,
      evidence_id: hash("0"),
      tx_hash: "B".repeat(64),
      code: "rpc_unavailable",
      observed_at: "2026-08-20T20:04:00.000Z",
    });
    expect(unavailable).toEqual(signed);
    expect(store.listEvents(signed.operation_id)).toEqual(beforeEvents);
    store.close();
  });

  test("rejects an unknown transaction evidence status before mutation", () => {
    const { store, values } = storeAndValues();
    const signed = makeSigned(store, values);
    const before = store.listEvents(signed.operation_id);
    expect(() => store.applyTransactionEvidence({
      status: "other",
      operation_id: signed.operation_id,
      expected_revision: signed.revision,
      evidence_id: hash("f"),
      tx_hash: "B".repeat(64),
      observed_at: "2026-08-20T20:03:00.000Z",
    } as never)).toThrow(/status is not supported/);
    expect(store.listEvents(signed.operation_id)).toEqual(before);
    expect(store.verify().ok).toBeTrue();
    store.close();
  });

  test("requires confirmation depth for positive inclusion and keeps the fence afterward", () => {
    const { store, values } = storeAndValues();
    const signed = makeSigned(store, values);
    expect(() => store.applyTransactionEvidence({
      status: "found",
      operation_id: signed.operation_id,
      expected_revision: signed.revision,
      evidence_id: hash("f"),
      tx_hash: "B".repeat(64),
      height: "1510",
      observed_at_height: "1510",
      block_hash: "D".repeat(64),
      code: 0,
      codespace: "",
      confirmation_depth: 1,
      observed_at: "2026-08-20T20:05:00.000Z",
    })).toThrow(/confirmation depth/);
    const confirmed = store.applyTransactionEvidence({
      status: "found",
      operation_id: signed.operation_id,
      expected_revision: signed.revision,
      evidence_id: hash("f"),
      tx_hash: "B".repeat(64),
      height: "1510",
      observed_at_height: "1511",
      block_hash: "D".repeat(64),
      code: 0,
      codespace: "",
      confirmation_depth: 1,
      observed_at: "2026-08-20T20:05:00.000Z",
    });
    expect(confirmed.status).toBe("confirmed_success");
    expect(confirmed.reservations.every(({ state }) => state === "sticky")).toBeTrue();
    expect(store.getTreasuryExposure(values.profile.chain_id, values.account)).toBe("120000");
    expect(store.getAccountState(values.profile.chain_id, values.account)?.held_operation_id)
      .toBe(confirmed.operation_id);
    expect(store.verify().ok).toBeTrue();
    store.close();
  });

  test("keeps signed authorizations in treasury window caps after sequence-safe release", () => {
    const { store, values } = storeAndValues();
    const reserved = store.reserveOperation(values.reserve("operation-1", {
      reservations: [
        { purpose: "compute", amount_uzrn: "250000" },
        { purpose: "network_fee", amount_uzrn: "20000" },
      ],
    }));
    const signing = store.recordSignerInvocationBoundary({
      operation_id: reserved.operation_id,
      expected_revision: reserved.revision,
      account_snapshot: values.snapshot,
      request_id: "request-window",
      unsigned_payload_hash: hash("b"),
      external_verification_id: hash("c"),
      at: LATER,
    });
    const advanced = {
      ...values.snapshot,
      sequence: "10",
      balance_uzrn: "980000",
      observed_at_height: "1502",
      block_hash: "C".repeat(64),
      observed_at: "2026-08-20T20:05:00.000Z",
      valid_until: "2026-08-20T20:10:00.000Z",
    };
    store.applySequenceAdvanceEvidence({
      operation_id: signing.operation_id,
      expected_revision: signing.revision,
      evidence_id: hash("0"),
      snapshot: advanced,
      observed_at: advanced.observed_at,
    });
    const refreshed = refreshBindingForReservation(store, values);
    expect(() => store.reserveOperation(values.reserve("operation-2", {
      binding_head: {
        wallet_id: refreshed.wallet_id,
        binding_id: refreshed.binding.binding_id,
        proof_id: refreshed.proof.proof_id,
        currentness_id: refreshed.currentness.currentness_id,
        head_version: refreshed.head_version,
      },
      account_snapshot: advanced,
      reservations: [{ purpose: "compute", amount_uzrn: "160000" }],
      created_at: refreshed.currentness.verified_at,
    }))).toThrow(/compute treasury window cap/);
    store.close();
  });
});
