import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eventHash } from "../src/events.js";
import { ZeroneAgentHostStore, type Sha256Id } from "../src/index.js";
import { fixture, hash, LATER, rewriteEventChain, TIME } from "./helpers.js";

function lateReorgWithReservedSuccessor(
  store: ZeroneAgentHostStore,
  values: ReturnType<typeof fixture>,
  signSuccessor = false,
) {
  store.initialize();
  store.putBindingHead(values.proof, values.currentness, { expected: null, updated_at: TIME });
  const reservedA = store.reserveOperation(values.reserve());
  const signingA = store.recordSignerInvocationBoundary({
    operation_id: reservedA.operation_id,
    expected_revision: reservedA.revision,
    account_snapshot: values.snapshot,
    request_id: "request-direct-late-reorg",
    unsigned_payload_hash: hash("b"),
    external_verification_id: hash("c"),
    at: LATER,
  });
  const signedA = store.recordVerifiedSignedEvidence({
    operation_id: signingA.operation_id,
    expected_revision: signingA.revision,
    tx_hash: "B".repeat(64),
    signed_payload_hash: hash("d"),
    external_verification_id: hash("e"),
    at: "2026-08-20T20:02:00.000Z",
  });
  const confirmedA = store.applyTransactionEvidence({
    status: "found",
    operation_id: signedA.operation_id,
    expected_revision: signedA.revision,
    evidence_id: hash("f"),
    tx_hash: "B".repeat(64),
    height: "1510",
    observed_at_height: "1511",
    block_hash: "D".repeat(64),
    code: 0,
    codespace: "",
    confirmation_depth: 1,
    observed_at: "2026-08-20T20:03:00.000Z",
  });
  const sequence10 = {
    ...values.snapshot,
    sequence: "10",
    balance_uzrn: "880000",
    observed_at_height: "1512",
    block_hash: "E".repeat(64),
    observed_at: "2026-08-20T20:04:00.000Z",
  };
  const settledA = store.applySequenceAdvanceEvidence({
    operation_id: confirmedA.operation_id,
    expected_revision: confirmedA.revision,
    evidence_id: hash("0"),
    snapshot: sequence10,
    observed_at: sequence10.observed_at,
  });
  const reservedB = store.reserveOperation(values.reserve("operation-2", {
    account_snapshot: sequence10,
    created_at: "2026-08-20T20:05:00.000Z",
  }));
  const signingB = signSuccessor
    ? store.recordSignerInvocationBoundary({
        operation_id: reservedB.operation_id,
        expected_revision: reservedB.revision,
        account_snapshot: sequence10,
        request_id: "request-direct-late-reorg-successor",
        unsigned_payload_hash: hash("4"),
        external_verification_id: hash("5"),
        at: "2026-08-20T20:05:30.000Z",
      })
    : null;
  const reorgedA = store.applyCanonicalReorgEvidence({
    operation_id: settledA.operation_id,
    expected_revision: settledA.revision,
    evidence_id: hash("1"),
    tx_hash: "B".repeat(64),
    prior_inclusion_height: "1510",
    prior_inclusion_block_hash: "D".repeat(64),
    canonical_block_hash_at_height: "F".repeat(64),
    observed_at_height: "1513",
    observed_at: "2026-08-20T20:06:00.000Z",
  });
  return { reorgedA, reservedB, signingB, sequence10 };
}

function twoConfirmedOperations(
  store: ZeroneAgentHostStore,
  values: ReturnType<typeof fixture>,
) {
  store.initialize();
  store.putBindingHead(values.proof, values.currentness, { expected: null, updated_at: TIME });
  const reservedA = store.reserveOperation(values.reserve());
  const signingA = store.recordSignerInvocationBoundary({
    operation_id: reservedA.operation_id,
    expected_revision: reservedA.revision,
    account_snapshot: values.snapshot,
    request_id: "request-two-reorgs-a",
    unsigned_payload_hash: hash("b"),
    external_verification_id: hash("c"),
    at: LATER,
  });
  const signedA = store.recordVerifiedSignedEvidence({
    operation_id: signingA.operation_id,
    expected_revision: signingA.revision,
    tx_hash: "B".repeat(64),
    signed_payload_hash: hash("d"),
    external_verification_id: hash("e"),
    at: "2026-08-20T20:02:00.000Z",
  });
  const confirmedA = store.applyTransactionEvidence({
    status: "found",
    operation_id: signedA.operation_id,
    expected_revision: signedA.revision,
    evidence_id: hash("f"),
    tx_hash: "B".repeat(64),
    height: "1510",
    observed_at_height: "1511",
    block_hash: "D".repeat(64),
    code: 0,
    codespace: "",
    confirmation_depth: 1,
    observed_at: "2026-08-20T20:03:00.000Z",
  });
  const sequence10 = {
    ...values.snapshot,
    sequence: "10",
    balance_uzrn: "880000",
    observed_at_height: "1512",
    block_hash: "E".repeat(64),
    observed_at: "2026-08-20T20:04:00.000Z",
  };
  const settledA = store.applySequenceAdvanceEvidence({
    operation_id: confirmedA.operation_id,
    expected_revision: confirmedA.revision,
    evidence_id: hash("0"),
    snapshot: sequence10,
    observed_at: sequence10.observed_at,
  });
  const reservedB = store.reserveOperation(values.reserve("operation-2", {
    account_snapshot: sequence10,
    created_at: "2026-08-20T20:05:00.000Z",
  }));
  const signingB = store.recordSignerInvocationBoundary({
    operation_id: reservedB.operation_id,
    expected_revision: reservedB.revision,
    account_snapshot: sequence10,
    request_id: "request-two-reorgs-b",
    unsigned_payload_hash: hash("4"),
    external_verification_id: hash("5"),
    at: "2026-08-20T20:05:30.000Z",
  });
  const signedB = store.recordVerifiedSignedEvidence({
    operation_id: signingB.operation_id,
    expected_revision: signingB.revision,
    tx_hash: "C".repeat(64),
    signed_payload_hash: hash("6"),
    external_verification_id: hash("7"),
    at: "2026-08-20T20:06:00.000Z",
  });
  const confirmedB = store.applyTransactionEvidence({
    status: "found",
    operation_id: signedB.operation_id,
    expected_revision: signedB.revision,
    evidence_id: hash("8"),
    tx_hash: "C".repeat(64),
    height: "1513",
    observed_at_height: "1514",
    block_hash: "A".repeat(64),
    code: 0,
    codespace: "",
    confirmation_depth: 1,
    observed_at: "2026-08-20T20:07:00.000Z",
  });
  return { settledA, confirmedB, sequence10 };
}

function twoUnresolvedReorgs(
  store: ZeroneAgentHostStore,
  values: ReturnType<typeof fixture>,
  secondReorg: {
    readonly observed_at_height?: string;
    readonly observed_at?: string;
  } = {},
) {
  const { settledA, confirmedB, sequence10 } = twoConfirmedOperations(store, values);
  const reorgedA = store.applyCanonicalReorgEvidence({
    operation_id: settledA.operation_id,
    expected_revision: settledA.revision,
    evidence_id: hash("1"),
    tx_hash: "B".repeat(64),
    prior_inclusion_height: "1510",
    prior_inclusion_block_hash: "D".repeat(64),
    canonical_block_hash_at_height: "F".repeat(64),
    observed_at_height: "1515",
    observed_at: "2026-08-20T20:08:00.000Z",
  });
  const reorgedB = store.applyCanonicalReorgEvidence({
    operation_id: confirmedB.operation_id,
    expected_revision: confirmedB.revision,
    evidence_id: hash("2"),
    tx_hash: "C".repeat(64),
    prior_inclusion_height: "1513",
    prior_inclusion_block_hash: "A".repeat(64),
    canonical_block_hash_at_height: "9".repeat(64),
    observed_at_height: secondReorg.observed_at_height ?? "1516",
    observed_at: secondReorg.observed_at ?? "2026-08-20T20:09:00.000Z",
  });
  const sequence11 = {
    ...sequence10,
    sequence: "11",
    balance_uzrn: "860000",
    observed_at_height: "1517",
    block_hash: "8".repeat(64),
    observed_at: "2026-08-20T20:10:00.000Z",
  };
  return {
    reorgedA,
    reorgedB,
    sequence11,
    reorgEvidenceA: hash("1"),
    reorgEvidenceB: hash("2"),
  };
}

function twoUnresolvedReorgsWithThirdFence(
  store: ZeroneAgentHostStore,
  values: ReturnType<typeof fixture>,
) {
  const { settledA, confirmedB, sequence10 } = twoConfirmedOperations(store, values);
  const sequence11 = {
    ...sequence10,
    sequence: "11",
    balance_uzrn: "760000",
    observed_at_height: "1515",
    block_hash: "8".repeat(64),
    observed_at: "2026-08-20T20:08:00.000Z",
  };
  const settledB = store.applySequenceAdvanceEvidence({
    operation_id: confirmedB.operation_id,
    expected_revision: confirmedB.revision,
    evidence_id: hash("3"),
    snapshot: sequence11,
    observed_at: sequence11.observed_at,
  });
  const thirdAuthorization = {
    trust_boundary: "trusted_injected_wallet_authorization_projection/0.1" as const,
    external_verification_id: hash("c"),
    intent_record_id: hash("d"),
    simulation_record_id: hash("e"),
    plan_reference_id: hash("f"),
  };
  const reservedC = store.reserveOperation(values.reserve("operation-3", {
    authorization: thirdAuthorization,
    account_snapshot: sequence11,
    created_at: "2026-08-20T20:09:00.000Z",
  }));
  const reorgedA = store.applyCanonicalReorgEvidence({
    operation_id: settledA.operation_id,
    expected_revision: settledA.revision,
    evidence_id: hash("1"),
    tx_hash: "B".repeat(64),
    prior_inclusion_height: "1510",
    prior_inclusion_block_hash: "D".repeat(64),
    canonical_block_hash_at_height: "F".repeat(64),
    observed_at_height: "1517",
    observed_at: "2026-08-20T20:10:00.000Z",
  });
  const reorgedB = store.applyCanonicalReorgEvidence({
    operation_id: settledB.operation_id,
    expected_revision: settledB.revision,
    evidence_id: hash("2"),
    tx_hash: "C".repeat(64),
    prior_inclusion_height: "1513",
    prior_inclusion_block_hash: "A".repeat(64),
    canonical_block_hash_at_height: "9".repeat(64),
    observed_at_height: "1518",
    observed_at: "2026-08-20T20:11:00.000Z",
  });
  const sequence12 = {
    ...sequence11,
    sequence: "12",
    balance_uzrn: "740000",
    observed_at_height: "1519",
    block_hash: "7".repeat(64),
    observed_at: "2026-08-20T20:12:00.000Z",
  };
  const resolvedC = store.applySequenceAdvanceEvidence({
    operation_id: reservedC.operation_id,
    expected_revision: reservedC.revision,
    evidence_id: hash("4"),
    snapshot: sequence12,
    observed_at: sequence12.observed_at,
  });
  return { reorgedA, reorgedB, resolvedC, sequence10, sequence11 };
}

describe("confirmation and positive reorg evidence", () => {
  test("restores sticky exposure and halts the account after canonical replacement", () => {
    const values = fixture();
    const store = new ZeroneAgentHostStore(":memory:", {
      create: true,
      allow_in_memory_for_tests: true,
    });
    store.initialize();
    store.putBindingHead(values.proof, values.currentness, { expected: null, updated_at: TIME });
    const reserved = store.reserveOperation(values.reserve());
    const signing = store.recordSignerInvocationBoundary({
      operation_id: reserved.operation_id,
      expected_revision: reserved.revision,
      account_snapshot: values.snapshot,
      request_id: "request-reorg",
      unsigned_payload_hash: hash("b"),
      external_verification_id: hash("c"),
      at: LATER,
    });
    const signed = store.recordVerifiedSignedEvidence({
      operation_id: signing.operation_id,
      expected_revision: signing.revision,
      tx_hash: "B".repeat(64),
      signed_payload_hash: hash("d"),
      external_verification_id: hash("e"),
      at: "2026-08-20T20:02:00.000Z",
    });
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
      observed_at: "2026-08-20T20:03:00.000Z",
    });
    expect(store.getTreasuryExposure(values.profile.chain_id, values.account)).toBe("120000");

    expect(() => store.applyCanonicalReorgEvidence({
      operation_id: confirmed.operation_id,
      expected_revision: confirmed.revision,
      evidence_id: hash("0"),
      tx_hash: "B".repeat(64),
      prior_inclusion_height: "1510",
      prior_inclusion_block_hash: "D".repeat(64),
      canonical_block_hash_at_height: "D".repeat(64),
      observed_at_height: "1512",
      observed_at: "2026-08-20T20:04:00.000Z",
    })).toThrow(/does not positively replace/);

    const reorged = store.applyCanonicalReorgEvidence({
      operation_id: confirmed.operation_id,
      expected_revision: confirmed.revision,
      evidence_id: hash("0"),
      tx_hash: "B".repeat(64),
      prior_inclusion_height: "1510",
      prior_inclusion_block_hash: "D".repeat(64),
      canonical_block_hash_at_height: "E".repeat(64),
      observed_at_height: "1512",
      observed_at: "2026-08-20T20:04:00.000Z",
    });
    expect(reorged.status).toBe("reorged");
    expect(reorged.reservations.every(({ state }) => state === "sticky")).toBeTrue();
    expect(store.getTreasuryExposure(values.profile.chain_id, values.account)).toBe("120000");
    expect(store.getAccountState(values.profile.chain_id, values.account)).toMatchObject({
      halted: true,
      held_operation_id: reorged.operation_id,
    });
    const cachedPreReorgSequence = {
      ...values.snapshot,
      sequence: "10",
      observed_at_height: "1511",
      block_hash: "C".repeat(64),
      observed_at: "2026-08-20T20:03:30.000Z",
    };
    expect(() => store.applySequenceAdvanceEvidence({
      operation_id: reorged.operation_id,
      expected_revision: reorged.revision,
      evidence_id: hash("6"),
      snapshot: cachedPreReorgSequence,
      observed_at: cachedPreReorgSequence.observed_at,
    })).toThrow(/not causally newer/);
    expect(() => store.applyTransactionEvidence({
      status: "found",
      operation_id: reorged.operation_id,
      expected_revision: reorged.revision,
      evidence_id: hash("7"),
      tx_hash: "B".repeat(64),
      height: "1510",
      observed_at_height: "1511",
      block_hash: "D".repeat(64),
      code: 0,
      codespace: "",
      confirmation_depth: 1,
      observed_at: "2026-08-20T20:03:00.000Z",
    })).toThrow(/causally newer.*new inclusion/);
    expect(() => store.reserveOperation(values.reserve("operation-2"))).toThrow(/halted|in-flight/);
    expect(store.verify().ok).toBeTrue();
    store.close();
  });

  test("models included failure separately and releases only after positive sequence advance", () => {
    const values = fixture();
    const store = new ZeroneAgentHostStore(":memory:", {
      create: true,
      allow_in_memory_for_tests: true,
    });
    store.initialize();
    store.putBindingHead(values.proof, values.currentness, { expected: null, updated_at: TIME });
    const reserved = store.reserveOperation(values.reserve());
    const signing = store.recordSignerInvocationBoundary({
      operation_id: reserved.operation_id,
      expected_revision: reserved.revision,
      account_snapshot: values.snapshot,
      request_id: "request-failed",
      unsigned_payload_hash: hash("b"),
      external_verification_id: hash("c"),
      at: LATER,
    });
    const signed = store.recordVerifiedSignedEvidence({
      operation_id: signing.operation_id,
      expected_revision: signing.revision,
      tx_hash: "B".repeat(64),
      signed_payload_hash: hash("d"),
      external_verification_id: hash("e"),
      at: "2026-08-20T20:02:00.000Z",
    });
    const failed = store.applyTransactionEvidence({
      status: "found",
      operation_id: signed.operation_id,
      expected_revision: signed.revision,
      evidence_id: hash("f"),
      tx_hash: "B".repeat(64),
      height: "1510",
      observed_at_height: "1511",
      block_hash: "D".repeat(64),
      code: 7,
      codespace: "knowledge",
      confirmation_depth: 1,
      observed_at: "2026-08-20T20:03:00.000Z",
    });
    expect(failed.status).toBe("confirmed_failed");
    expect(failed.reservations).toEqual([
      { purpose: "compute", amount_uzrn: "100000", state: "sticky" },
      { purpose: "network_fee", amount_uzrn: "20000", state: "sticky" },
    ]);
    expect(store.getAccountState(values.profile.chain_id, values.account)?.held_operation_id)
      .toBe(failed.operation_id);

    const advanced = {
      ...values.snapshot,
      sequence: "10",
      balance_uzrn: "980000",
      observed_at_height: "1512",
      block_hash: "E".repeat(64),
      observed_at: "2026-08-20T20:04:00.000Z",
    };
    const released = store.applySequenceAdvanceEvidence({
      operation_id: failed.operation_id,
      expected_revision: failed.revision,
      evidence_id: hash("0"),
      snapshot: advanced,
      observed_at: advanced.observed_at,
    });
    expect(released.status).toBe("confirmed_failed");
    expect(released.reservations).toEqual([
      { purpose: "compute", amount_uzrn: "100000", state: "released" },
      { purpose: "network_fee", amount_uzrn: "20000", state: "settled" },
    ]);
    expect(store.getAccountState(values.profile.chain_id, values.account)?.held_operation_id).toBeNull();
    expect(store.verify().ok).toBeTrue();
    store.close();
  });

  test("hands a newer released fence back to an older sticky late-reorg operation", () => {
    const values = fixture();
    const path = join(mkdtempSync(join(tmpdir(), "zerone-host-reorg-handoff-")), "host.sqlite");
    let store = new ZeroneAgentHostStore(path, { create: true });
    store.initialize();
    store.putBindingHead(values.proof, values.currentness, { expected: null, updated_at: TIME });
    const reservedA = store.reserveOperation(values.reserve());
    const signingA = store.recordSignerInvocationBoundary({
      operation_id: reservedA.operation_id,
      expected_revision: reservedA.revision,
      account_snapshot: values.snapshot,
      request_id: "request-late-reorg",
      unsigned_payload_hash: hash("b"),
      external_verification_id: hash("c"),
      at: LATER,
    });
    const signedA = store.recordVerifiedSignedEvidence({
      operation_id: signingA.operation_id,
      expected_revision: signingA.revision,
      tx_hash: "B".repeat(64),
      signed_payload_hash: hash("d"),
      external_verification_id: hash("e"),
      at: "2026-08-20T20:02:00.000Z",
    });
    const confirmedA = store.applyTransactionEvidence({
      status: "found",
      operation_id: signedA.operation_id,
      expected_revision: signedA.revision,
      evidence_id: hash("f"),
      tx_hash: "B".repeat(64),
      height: "1510",
      observed_at_height: "1511",
      block_hash: "D".repeat(64),
      code: 0,
      codespace: "",
      confirmation_depth: 1,
      observed_at: "2026-08-20T20:03:00.000Z",
    });
    const sequence10 = {
      ...values.snapshot,
      sequence: "10",
      balance_uzrn: "880000",
      observed_at_height: "1512",
      block_hash: "E".repeat(64),
      observed_at: "2026-08-20T20:04:00.000Z",
    };
    const settledA = store.applySequenceAdvanceEvidence({
      operation_id: confirmedA.operation_id,
      expected_revision: confirmedA.revision,
      evidence_id: hash("0"),
      snapshot: sequence10,
      observed_at: sequence10.observed_at,
    });
    const reservedB = store.reserveOperation(values.reserve("operation-2", {
      account_snapshot: sequence10,
      created_at: "2026-08-20T20:05:00.000Z",
    }));
    const reorgedA = store.applyCanonicalReorgEvidence({
      operation_id: settledA.operation_id,
      expected_revision: settledA.revision,
      evidence_id: hash("1"),
      tx_hash: "B".repeat(64),
      prior_inclusion_height: "1510",
      prior_inclusion_block_hash: "D".repeat(64),
      canonical_block_hash_at_height: "F".repeat(64),
      observed_at_height: "1513",
      observed_at: "2026-08-20T20:06:00.000Z",
    });
    expect(store.getAccountState(values.profile.chain_id, values.account)).toMatchObject({
      halted: true,
      held_operation_id: reservedB.operation_id,
    });
    expect(() => store.applyTransactionEvidence({
      status: "found",
      operation_id: reorgedA.operation_id,
      expected_revision: reorgedA.revision,
      evidence_id: hash("4"),
      tx_hash: "B".repeat(64),
      height: "1513",
      observed_at_height: "1514",
      block_hash: "C".repeat(64),
      code: 0,
      codespace: "",
      confirmation_depth: 1,
      observed_at: "2026-08-20T20:06:30.000Z",
    })).toThrow(/must own the account sequence fence/);

    const sequence11 = {
      ...sequence10,
      sequence: "11",
      balance_uzrn: "860000",
      observed_at_height: "1514",
      block_hash: "A".repeat(64),
      observed_at: "2026-08-20T20:07:00.000Z",
    };
    store.applySequenceAdvanceEvidence({
      operation_id: reservedB.operation_id,
      expected_revision: reservedB.revision,
      evidence_id: hash("2"),
      snapshot: sequence11,
      observed_at: sequence11.observed_at,
    });
    expect(store.verify().ok).toBeTrue();
    expect(store.getAccountState(values.profile.chain_id, values.account)).toMatchObject({
      halted: true,
      held_operation_id: reorgedA.operation_id,
    });
    store.close();
    store = new ZeroneAgentHostStore(path, { create: true });
    store.initialize();
    expect(store.getAccountState(values.profile.chain_id, values.account)).toMatchObject({
      halted: true,
      held_operation_id: reorgedA.operation_id,
    });
    const resolvedA = store.applySequenceAdvanceEvidence({
      operation_id: reorgedA.operation_id,
      expected_revision: reorgedA.revision,
      evidence_id: hash("3"),
      snapshot: sequence11,
      observed_at: sequence11.observed_at,
    });
    expect(resolvedA.status).toBe("sequence_superseded");
    expect(store.getAccountState(values.profile.chain_id, values.account)).toMatchObject({
      halted: false,
      held_operation_id: null,
    });
    expect(store.verify().ok).toBeTrue();
    store.close();
  });

  test("resolves a released late-reorg exposure while a newer fence remains held", () => {
    const values = fixture();
    const path = join(mkdtempSync(join(tmpdir(), "zerone-host-direct-reorg-resolution-")), "host.sqlite");
    let store = new ZeroneAgentHostStore(path, { create: true });
    const { reorgedA, reservedB, sequence10 } = lateReorgWithReservedSuccessor(store, values);
    const directEvidence = {
      ...sequence10,
      observed_at_height: "1514",
      block_hash: "A".repeat(64),
      observed_at: "2026-08-20T20:07:00.000Z",
    };
    const resolvedA = store.applySequenceAdvanceEvidence({
      operation_id: reorgedA.operation_id,
      expected_revision: reorgedA.revision,
      evidence_id: hash("3"),
      snapshot: directEvidence,
      observed_at: directEvidence.observed_at,
    });
    expect(resolvedA.status).toBe("sequence_superseded");
    expect(store.listEvents(resolvedA.operation_id).at(-1)?.details).toMatchObject({
      evidence_id: hash("3"),
      sequence_fence_released: false,
    });
    expect(store.getAccountState(values.profile.chain_id, values.account)).toMatchObject({
      halted: false,
      held_operation_id: reservedB.operation_id,
    });
    expect(store.verify().ok).toBeTrue();
    store.close();

    store = new ZeroneAgentHostStore(path, { create: true });
    store.initialize();
    expect(store.verify().ok).toBeTrue();
    const rawDatabase = Reflect.get(store, "db") as Database;
    rawDatabase.query(`
      UPDATE sequence_fences SET release_evidence_id = ? WHERE operation_id = ?
    `).run(hash("3"), resolvedA.operation_id);
    expect(() => store.verify()).toThrow(/release does not replay/);
    store.close();
  });

  test("rejects a higher reorg observation height whose halt time regresses", () => {
    const values = fixture();
    const store = new ZeroneAgentHostStore(":memory:", {
      create: true,
      allow_in_memory_for_tests: true,
    });
    expect(() => twoUnresolvedReorgs(store, values, {
      observed_at_height: "1516",
      observed_at: "2026-08-20T20:07:30.000Z",
    })).toThrow(/strictly newer in height and time/);
    expect(store.getAccountState(values.profile.chain_id, values.account)).toMatchObject({
      halted: true,
      halted_at_height: "1515",
      halt_evidence_id: hash("1"),
      held_operation_id: "operation-2",
    });
    expect(store.verify().ok).toBeTrue();
    store.close();
  });

  test("rejects an equal-height halt epoch even when its observation time advances", () => {
    const values = fixture();
    const store = new ZeroneAgentHostStore(":memory:", {
      create: true,
      allow_in_memory_for_tests: true,
    });
    expect(() => twoUnresolvedReorgs(store, values, {
      observed_at_height: "1515",
      observed_at: "2026-08-20T20:09:00.000Z",
    })).toThrow(/strictly newer in height and time/);
    expect(store.getAccountState(values.profile.chain_id, values.account)).toMatchObject({
      halted: true,
      halted_at_height: "1515",
      halt_evidence_id: hash("1"),
      held_operation_id: "operation-2",
    });
    expect(store.verify().ok).toBeTrue();
    store.close();
  });

  test("fails closed on reopen for forged incomparable unresolved halt epochs", () => {
    const values = fixture();
    const path = join(mkdtempSync(join(tmpdir(), "zerone-host-forged-reorg-clock-")), "host.sqlite");
    let store = new ZeroneAgentHostStore(path, { create: true });
    const { reorgedB } = twoUnresolvedReorgs(store, values);
    const rawDatabase = Reflect.get(store, "db") as Database;
    const event = rawDatabase.query(`
      SELECT ledger_sequence, sequence, kind, details_json, previous_event_hash
      FROM operation_events WHERE operation_id = ? ORDER BY sequence DESC LIMIT 1
    `).get(reorgedB.operation_id) as {
      ledger_sequence: number;
      sequence: number;
      kind: string;
      details_json: string;
      previous_event_hash: Sha256Id;
    };
    const alteredAt = "2026-08-20T20:07:30.000Z";
    const alteredEventHash = eventHash({
      ledger_sequence: event.ledger_sequence,
      operation_id: reorgedB.operation_id,
      sequence: event.sequence,
      kind: event.kind,
      at: alteredAt,
      details: JSON.parse(event.details_json) as Record<string, unknown>,
      previous_event_hash: event.previous_event_hash,
    });
    rawDatabase.exec("DROP TRIGGER operation_events_no_update");
    rawDatabase.query(`
      UPDATE operation_events SET at = ?, event_hash = ?
      WHERE operation_id = ? AND sequence = ?
    `).run(alteredAt, alteredEventHash, reorgedB.operation_id, event.sequence);
    rawDatabase.query(`
      UPDATE operations SET updated_at = ?, event_head_hash = ? WHERE operation_id = ?
    `).run(alteredAt, alteredEventHash, reorgedB.operation_id);
    rawDatabase.query(`
      UPDATE account_states SET halted_at = ? WHERE chain_id = ? AND source_account = ?
    `).run(alteredAt, values.profile.chain_id, values.account);
    rawDatabase.exec(`
      CREATE TRIGGER operation_events_no_update
      BEFORE UPDATE ON operation_events
      BEGIN
        SELECT RAISE(ABORT, 'operation events are append-only');
      END
    `);
    expect(() => store.verify()).toThrow(/not strictly ordered in height and time/);
    store.close();

    store = new ZeroneAgentHostStore(path, { create: true });
    expect(() => store.initialize()).toThrow(/not strictly ordered in height and time/);
    store.close();
  });

  test("keeps durable ledger order when cross-operation timestamps arrive out of order", () => {
    const values = fixture();
    const path = join(mkdtempSync(join(tmpdir(), "zerone-host-account-timeline-")), "host.sqlite");
    let store = new ZeroneAgentHostStore(path, { create: true });
    const {
      reorgedA,
      signingB,
      sequence10,
    } = lateReorgWithReservedSuccessor(store, values, true);
    if (signingB === null) throw new Error("test setup did not cross the signer boundary");
    const sequence11 = {
      ...sequence10,
      sequence: "11",
      balance_uzrn: "860000",
      observed_at_height: "1514",
      block_hash: "A".repeat(64),
      observed_at: "2026-08-20T20:07:00.000Z",
    };
    store.applySequenceAdvanceEvidence({
      operation_id: signingB.operation_id,
      expected_revision: signingB.revision,
      evidence_id: hash("2"),
      snapshot: sequence11,
      observed_at: sequence11.observed_at,
    });
    store.applySequenceAdvanceEvidence({
      operation_id: reorgedA.operation_id,
      expected_revision: reorgedA.revision,
      evidence_id: hash("3"),
      snapshot: sequence11,
      observed_at: sequence11.observed_at,
    });
    expect(store.verify().ok).toBeTrue();
    store.close();

    store = new ZeroneAgentHostStore(path, { create: true });
    store.initialize();
    expect(store.verify().ok).toBeTrue();
    rewriteEventChain(
      store,
      signingB.operation_id,
      (_kind, details) => details,
      (kind, at) => kind === "signer_invocation_boundary"
        ? "2026-08-20T20:06:30.000Z"
        : at,
    );
    const rawDatabase = Reflect.get(store, "db") as Database;
    rawDatabase.query(`
      UPDATE capability_usage SET updated_at = ? WHERE capability_record_id = ?
    `).run("2026-08-20T20:06:30.000Z", values.reserve().capability.capability_record_id);
    expect(store.verify().ok).toBeTrue();
    store.close();

    store = new ZeroneAgentHostStore(path, { create: true });
    store.initialize();
    expect(store.verify().ok).toBeTrue();
    store.close();
  });

  test("uses the persisted ledger order to disambiguate equal-time halt boundaries", () => {
    const values = fixture();
    const path = join(mkdtempSync(join(tmpdir(), "zerone-host-equal-time-order-")), "host.sqlite");
    let store = new ZeroneAgentHostStore(path, { create: true });
    const {
      reorgedA,
      signingB,
      sequence10,
    } = lateReorgWithReservedSuccessor(store, values, true);
    if (signingB === null) throw new Error("test setup did not cross the signer boundary");
    const sequence11 = {
      ...sequence10,
      sequence: "11",
      balance_uzrn: "860000",
      observed_at_height: "1514",
      block_hash: "A".repeat(64),
      observed_at: "2026-08-20T20:07:00.000Z",
    };
    store.applySequenceAdvanceEvidence({
      operation_id: signingB.operation_id,
      expected_revision: signingB.revision,
      evidence_id: hash("2"),
      snapshot: sequence11,
      observed_at: sequence11.observed_at,
    });
    store.applySequenceAdvanceEvidence({
      operation_id: reorgedA.operation_id,
      expected_revision: reorgedA.revision,
      evidence_id: hash("3"),
      snapshot: sequence11,
      observed_at: sequence11.observed_at,
    });
    rewriteEventChain(
      store,
      signingB.operation_id,
      (_kind, details) => details,
      (kind, at) => kind === "signer_invocation_boundary"
        ? "2026-08-20T20:06:00.000Z"
        : at,
    );
    let rawDatabase = Reflect.get(store, "db") as Database;
    rawDatabase.query(`
      UPDATE capability_usage SET updated_at = ? WHERE capability_record_id = ?
    `).run("2026-08-20T20:06:00.000Z", values.reserve().capability.capability_record_id);
    expect(store.verify().ok).toBeTrue();
    store.close();

    store = new ZeroneAgentHostStore(path, { create: true });
    store.initialize();
    expect(store.verify().ok).toBeTrue();
    rawDatabase = Reflect.get(store, "db") as Database;
    const signerLedger = rawDatabase.query(`
      SELECT ledger_sequence FROM operation_events
      WHERE operation_id = ? AND kind = 'signer_invocation_boundary'
    `).get(signingB.operation_id) as { ledger_sequence: number };
    const reorgLedger = rawDatabase.query(`
      SELECT ledger_sequence FROM operation_events
      WHERE operation_id = ? AND kind = 'canonical_reorg'
    `).get(reorgedA.operation_id) as { ledger_sequence: number };
    rawDatabase.exec("DROP TRIGGER operation_events_no_update");
    rawDatabase.query(`UPDATE operation_events SET ledger_sequence = -1 WHERE ledger_sequence = ?`)
      .run(signerLedger.ledger_sequence);
    rawDatabase.query(`UPDATE operation_events SET ledger_sequence = ? WHERE ledger_sequence = ?`)
      .run(signerLedger.ledger_sequence, reorgLedger.ledger_sequence);
    rawDatabase.query(`UPDATE operation_events SET ledger_sequence = ? WHERE ledger_sequence = -1`)
      .run(reorgLedger.ledger_sequence);
    rawDatabase.exec(`
      CREATE TRIGGER operation_events_no_update
      BEFORE UPDATE ON operation_events
      BEGIN
        SELECT RAISE(ABORT, 'operation events are append-only');
      END
    `);
    rewriteEventChain(store, signingB.operation_id, (_kind, details) => details);
    rewriteEventChain(store, reorgedA.operation_id, (_kind, details) => details);
    expect(() => store.verify()).toThrow(/Signer event crossed an account halt/);
    store.close();

    store = new ZeroneAgentHostStore(path, { create: true });
    expect(() => store.initialize()).toThrow(/Signer event crossed an account halt/);
    store.close();
  });

  test("rejects rebuilt sequence evidence that predates the reorg halt", () => {
    const values = fixture();
    const path = join(mkdtempSync(join(tmpdir(), "zerone-host-stale-sequence-replay-")), "host.sqlite");
    let store = new ZeroneAgentHostStore(path, { create: true });
    const { reorgedA, sequence10 } = lateReorgWithReservedSuccessor(store, values);
    const resolution = {
      ...sequence10,
      observed_at_height: "1514",
      block_hash: "A".repeat(64),
      observed_at: "2026-08-20T20:07:00.000Z",
    };
    store.applySequenceAdvanceEvidence({
      operation_id: reorgedA.operation_id,
      expected_revision: reorgedA.revision,
      evidence_id: hash("3"),
      snapshot: resolution,
      observed_at: resolution.observed_at,
    });
    rewriteEventChain(store, reorgedA.operation_id, (kind, details) =>
      kind === "sequence_advanced"
        ? {
            ...details,
            observed_at_height: "1512",
            block_hash: "E".repeat(64),
          }
        : details);
    const rawDatabase = Reflect.get(store, "db") as Database;
    rawDatabase.query(`
      UPDATE account_states SET observed_at_height = '1512', block_hash = ?, observed_at = ?
      WHERE chain_id = ? AND source_account = ?
    `).run(
      "E".repeat(64),
      resolution.observed_at,
      values.profile.chain_id,
      values.account,
    );
    expect(() => store.verify()).toThrow(/Sequence evidence predates its reorg epoch|predates its durable halt/);
    store.close();

    store = new ZeroneAgentHostStore(path, { create: true });
    expect(() => store.initialize()).toThrow(/Sequence evidence predates its reorg epoch|predates its durable halt/);
    store.close();
  });

  test("rejects rebuilt reorg evidence older than the account observation it replaces", () => {
    const values = fixture();
    const path = join(mkdtempSync(join(tmpdir(), "zerone-host-stale-reorg-replay-")), "host.sqlite");
    let store = new ZeroneAgentHostStore(path, { create: true });
    store.initialize();
    store.putBindingHead(values.proof, values.currentness, { expected: null, updated_at: TIME });
    const reserved = store.reserveOperation(values.reserve());
    const signerSnapshot = {
      ...values.snapshot,
      observed_at_height: "1513",
      block_hash: "C".repeat(64),
      observed_at: "2026-08-20T20:00:30.000Z",
    };
    const signing = store.recordSignerInvocationBoundary({
      operation_id: reserved.operation_id,
      expected_revision: reserved.revision,
      account_snapshot: signerSnapshot,
      request_id: "stale-reorg-signer",
      unsigned_payload_hash: hash("b"),
      external_verification_id: hash("c"),
      at: LATER,
    });
    const signed = store.recordVerifiedSignedEvidence({
      operation_id: signing.operation_id,
      expected_revision: signing.revision,
      tx_hash: "B".repeat(64),
      signed_payload_hash: hash("d"),
      external_verification_id: hash("e"),
      at: "2026-08-20T20:02:00.000Z",
    });
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
      observed_at: "2026-08-20T20:03:00.000Z",
    });
    const reorged = store.applyCanonicalReorgEvidence({
      operation_id: confirmed.operation_id,
      expected_revision: confirmed.revision,
      evidence_id: hash("0"),
      tx_hash: "B".repeat(64),
      prior_inclusion_height: "1510",
      prior_inclusion_block_hash: "D".repeat(64),
      canonical_block_hash_at_height: "E".repeat(64),
      observed_at_height: "1514",
      observed_at: "2026-08-20T20:04:00.000Z",
    });
    rewriteEventChain(store, reorged.operation_id, (kind, details) =>
      kind === "canonical_reorg" ? { ...details, observed_at_height: "1512" } : details);
    const rawDatabase = Reflect.get(store, "db") as Database;
    rawDatabase.query(`
      UPDATE account_states SET halted_at_height = '1512'
      WHERE chain_id = ? AND source_account = ?
    `).run(values.profile.chain_id, values.account);
    expect(() => store.verify()).toThrow(/Canonical reorg evidence predates|Reorg event is stale/);
    store.close();

    store = new ZeroneAgentHostStore(path, { create: true });
    expect(() => store.initialize()).toThrow(/Canonical reorg evidence predates|Reorg event is stale/);
    store.close();
  });

  test("requires a fence handoff to the earliest unresolved Cosmos sequence liability", () => {
    const values = fixture();
    const path = join(mkdtempSync(join(tmpdir(), "zerone-host-deterministic-handoff-")), "host.sqlite");
    let store = new ZeroneAgentHostStore(path, { create: true });
    const {
      reorgedA,
      reorgedB,
      resolvedC,
      sequence10,
    } = twoUnresolvedReorgsWithThirdFence(store, values);
    expect(store.getAccountState(values.profile.chain_id, values.account)).toMatchObject({
      halted: true,
      held_operation_id: reorgedA.operation_id,
    });
    expect(store.verify().ok).toBeTrue();
    rewriteEventChain(store, resolvedC.operation_id, (kind, details) =>
      kind === "sequence_advanced"
        ? { ...details, account_halt_handoff_operation_id: reorgedB.operation_id }
        : details);
    const rawDatabase = Reflect.get(store, "db") as Database;
    rawDatabase.query(`
      UPDATE sequence_fences SET state = 'released', released_at = ?, release_evidence_id = ?
      WHERE operation_id = ?
    `).run(sequence10.observed_at, hash("0"), reorgedA.operation_id);
    rawDatabase.query(`
      UPDATE sequence_fences SET state = 'held', released_at = NULL, release_evidence_id = NULL
      WHERE operation_id = ?
    `).run(reorgedB.operation_id);
    expect(() => store.verify()).toThrow(/did not hand off to the earliest unresolved sequence liability/);
    store.close();

    store = new ZeroneAgentHostStore(path, { create: true });
    expect(() => store.initialize()).toThrow(/did not hand off to the earliest unresolved sequence liability/);
    store.close();
  });

  test("hands the fence to the earlier Cosmos sequence despite inverse reorg arrival", () => {
    const values = fixture();
    const path = join(mkdtempSync(join(tmpdir(), "zerone-host-sequence-liability-order-")), "host.sqlite");
    let store = new ZeroneAgentHostStore(path, { create: true });
    const { settledA, confirmedB, sequence10 } = twoConfirmedOperations(store, values);
    const sequence11 = {
      ...sequence10,
      sequence: "11",
      balance_uzrn: "760000",
      observed_at_height: "1515",
      block_hash: "8".repeat(64),
      observed_at: "2026-08-20T20:08:00.000Z",
    };
    const settledB = store.applySequenceAdvanceEvidence({
      operation_id: confirmedB.operation_id,
      expected_revision: confirmedB.revision,
      evidence_id: hash("3"),
      snapshot: sequence11,
      observed_at: sequence11.observed_at,
    });
    const reorgedB = store.applyCanonicalReorgEvidence({
      operation_id: settledB.operation_id,
      expected_revision: settledB.revision,
      evidence_id: hash("2"),
      tx_hash: "C".repeat(64),
      prior_inclusion_height: "1513",
      prior_inclusion_block_hash: "A".repeat(64),
      canonical_block_hash_at_height: "9".repeat(64),
      observed_at_height: "1516",
      observed_at: "2026-08-20T20:09:00.000Z",
    });
    const reorgedA = store.applyCanonicalReorgEvidence({
      operation_id: settledA.operation_id,
      expected_revision: settledA.revision,
      evidence_id: hash("1"),
      tx_hash: "B".repeat(64),
      prior_inclusion_height: "1510",
      prior_inclusion_block_hash: "D".repeat(64),
      canonical_block_hash_at_height: "F".repeat(64),
      observed_at_height: "1517",
      observed_at: "2026-08-20T20:10:00.000Z",
    });
    expect(store.getAccountState(values.profile.chain_id, values.account)).toMatchObject({
      halted: true,
      held_operation_id: reorgedB.operation_id,
    });
    const resolution = {
      ...sequence11,
      balance_uzrn: "740000",
      observed_at_height: "1518",
      block_hash: "7".repeat(64),
      observed_at: "2026-08-20T20:11:00.000Z",
    };
    const resolvedB = store.applySequenceAdvanceEvidence({
      operation_id: reorgedB.operation_id,
      expected_revision: reorgedB.revision,
      evidence_id: hash("4"),
      snapshot: resolution,
      observed_at: resolution.observed_at,
    });
    expect(store.listEvents(resolvedB.operation_id).at(-1)?.details).toMatchObject({
      account_halt_handoff_operation_id: reorgedA.operation_id,
    });
    expect(store.getAccountState(values.profile.chain_id, values.account)).toMatchObject({
      halted: true,
      halted_at_height: "1517",
      halt_evidence_id: hash("1"),
      held_operation_id: reorgedA.operation_id,
    });
    expect(store.verify().ok).toBeTrue();
    store.close();

    store = new ZeroneAgentHostStore(path, { create: true });
    store.initialize();
    expect(store.verify().ok).toBeTrue();
    const durableA = store.getOperation(reorgedA.operation_id);
    if (durableA === null) throw new Error("Expected earlier sequence liability");
    store.applySequenceAdvanceEvidence({
      operation_id: durableA.operation_id,
      expected_revision: durableA.revision,
      evidence_id: hash("5"),
      snapshot: resolution,
      observed_at: resolution.observed_at,
    });
    expect(store.getAccountState(values.profile.chain_id, values.account)).toMatchObject({
      halted: false,
      held_operation_id: null,
    });
    expect(store.verify().ok).toBeTrue();
    store.close();
  });

  test("retains a re-included operation's explicit reorg epoch through conflicting resolution", () => {
    const values = fixture();
    const path = join(mkdtempSync(join(tmpdir(), "zerone-host-reincluded-reorg-")), "host.sqlite");
    let store = new ZeroneAgentHostStore(path, { create: true });
    const { settledA, confirmedB, sequence10 } = twoConfirmedOperations(store, values);
    const reopen = (): void => {
      store.close();
      store = new ZeroneAgentHostStore(path, { create: true });
      store.initialize();
      expect(store.verify().ok).toBeTrue();
    };
    const sequence11 = {
      ...sequence10,
      sequence: "11",
      balance_uzrn: "760000",
      observed_at_height: "1515",
      block_hash: "8".repeat(64),
      observed_at: "2026-08-20T20:08:00.000Z",
    };
    const settledB = store.applySequenceAdvanceEvidence({
      operation_id: confirmedB.operation_id,
      expected_revision: confirmedB.revision,
      evidence_id: hash("3"),
      snapshot: sequence11,
      observed_at: sequence11.observed_at,
    });
    const reorgedB = store.applyCanonicalReorgEvidence({
      operation_id: settledB.operation_id,
      expected_revision: settledB.revision,
      evidence_id: hash("2"),
      tx_hash: "C".repeat(64),
      prior_inclusion_height: "1513",
      prior_inclusion_block_hash: "A".repeat(64),
      canonical_block_hash_at_height: "9".repeat(64),
      observed_at_height: "1516",
      observed_at: "2026-08-20T20:09:00.000Z",
    });
    expect(reorgedB.unresolved_reorg_event_sequence).not.toBeNull();
    expect(reorgedB.unresolved_reorg_evidence_id).toBe(hash("2"));
    reopen();

    const reincludedB = store.applyTransactionEvidence({
      status: "found",
      operation_id: reorgedB.operation_id,
      expected_revision: reorgedB.revision,
      evidence_id: hash("4"),
      tx_hash: "C".repeat(64),
      height: "1517",
      observed_at_height: "1518",
      block_hash: "7".repeat(64),
      code: 0,
      codespace: "",
      confirmation_depth: 1,
      observed_at: "2026-08-20T20:10:00.000Z",
    });
    expect(reincludedB.status).toBe("confirmed_success");
    expect(reincludedB.unresolved_reorg_event_sequence)
      .toBe(reorgedB.unresolved_reorg_event_sequence);
    expect(reincludedB.unresolved_reorg_evidence_id).toBe(hash("2"));
    expect(store.getAccountState(values.profile.chain_id, values.account)).toMatchObject({
      halted: true,
      held_operation_id: reincludedB.operation_id,
    });
    reopen();

    const reorgedA = store.applyCanonicalReorgEvidence({
      operation_id: settledA.operation_id,
      expected_revision: settledA.revision,
      evidence_id: hash("1"),
      tx_hash: "B".repeat(64),
      prior_inclusion_height: "1510",
      prior_inclusion_block_hash: "D".repeat(64),
      canonical_block_hash_at_height: "F".repeat(64),
      observed_at_height: "1519",
      observed_at: "2026-08-20T20:11:00.000Z",
    });
    expect(store.getAccountState(values.profile.chain_id, values.account)).toMatchObject({
      halted: true,
      halt_evidence_id: hash("1"),
      held_operation_id: reincludedB.operation_id,
    });
    reopen();

    const resolution = {
      ...sequence11,
      balance_uzrn: "740000",
      observed_at_height: "1520",
      block_hash: "6".repeat(64),
      observed_at: "2026-08-20T20:12:00.000Z",
    };
    const resolvedA = store.applySequenceAdvanceEvidence({
      operation_id: reorgedA.operation_id,
      expected_revision: reorgedA.revision,
      evidence_id: hash("5"),
      snapshot: resolution,
      observed_at: resolution.observed_at,
    });
    expect(resolvedA.unresolved_reorg_event_sequence).toBeNull();
    expect(store.listEvents(resolvedA.operation_id).at(-1)?.details).toMatchObject({
      account_halt_handoff_operation_id: reincludedB.operation_id,
    });
    expect(store.getAccountState(values.profile.chain_id, values.account)).toMatchObject({
      halted: true,
      halted_at_height: "1516",
      halt_evidence_id: hash("2"),
      held_operation_id: reincludedB.operation_id,
    });
    reopen();

    const durableB = store.getOperation(reincludedB.operation_id);
    if (durableB === null) throw new Error("Expected re-included operation");
    const resolvedB = store.applySequenceAdvanceEvidence({
      operation_id: durableB.operation_id,
      expected_revision: durableB.revision,
      evidence_id: hash("a"),
      snapshot: resolution,
      observed_at: resolution.observed_at,
    });
    expect(resolvedB.status).toBe("confirmed_success");
    expect(resolvedB.unresolved_reorg_event_sequence).toBeNull();
    expect(store.getAccountState(values.profile.chain_id, values.account)).toMatchObject({
      halted: false,
      halt_evidence_id: null,
      held_operation_id: null,
    });
    reopen();
    store.close();
  });

  test("preserves the latest unresolved halt epoch when the older reorg resolves first", () => {
    const values = fixture();
    const path = join(mkdtempSync(join(tmpdir(), "zerone-host-two-reorgs-old-first-")), "host.sqlite");
    let store = new ZeroneAgentHostStore(path, { create: true });
    const {
      reorgedA,
      reorgedB,
      sequence11,
      reorgEvidenceB,
    } = twoUnresolvedReorgs(store, values);
    expect(store.getAccountState(values.profile.chain_id, values.account)).toMatchObject({
      halted: true,
      halted_at_height: "1516",
      halt_evidence_id: reorgEvidenceB,
      held_operation_id: reorgedB.operation_id,
    });

    const resolvedA = store.applySequenceAdvanceEvidence({
      operation_id: reorgedA.operation_id,
      expected_revision: reorgedA.revision,
      evidence_id: hash("3"),
      snapshot: sequence11,
      observed_at: sequence11.observed_at,
    });
    expect(resolvedA.status).toBe("sequence_superseded");
    expect(store.getAccountState(values.profile.chain_id, values.account)).toMatchObject({
      halted: true,
      halted_at_height: "1516",
      halt_evidence_id: reorgEvidenceB,
      held_operation_id: reorgedB.operation_id,
    });
    expect(store.verify().ok).toBeTrue();
    store.close();

    store = new ZeroneAgentHostStore(path, { create: true });
    store.initialize();
    expect(store.verify().ok).toBeTrue();
    const resolvedB = store.applySequenceAdvanceEvidence({
      operation_id: reorgedB.operation_id,
      expected_revision: reorgedB.revision,
      evidence_id: hash("a"),
      snapshot: sequence11,
      observed_at: sequence11.observed_at,
    });
    expect(resolvedB.status).toBe("sequence_superseded");
    expect(store.getAccountState(values.profile.chain_id, values.account)).toMatchObject({
      halted: false,
      halted_at_height: null,
      halt_evidence_id: null,
      held_operation_id: null,
    });
    expect(store.verify().ok).toBeTrue();
    store.close();

    store = new ZeroneAgentHostStore(path, { create: true });
    store.initialize();
    expect(store.verify().ok).toBeTrue();
    store.close();
  });

  test("restores the remaining older halt epoch when the newer reorg resolves first", () => {
    const values = fixture();
    const path = join(mkdtempSync(join(tmpdir(), "zerone-host-two-reorgs-new-first-")), "host.sqlite");
    let store = new ZeroneAgentHostStore(path, { create: true });
    const {
      reorgedA,
      reorgedB,
      sequence11,
      reorgEvidenceA,
    } = twoUnresolvedReorgs(store, values);

    const resolvedB = store.applySequenceAdvanceEvidence({
      operation_id: reorgedB.operation_id,
      expected_revision: reorgedB.revision,
      evidence_id: hash("3"),
      snapshot: sequence11,
      observed_at: sequence11.observed_at,
    });
    expect(resolvedB.status).toBe("sequence_superseded");
    expect(store.getAccountState(values.profile.chain_id, values.account)).toMatchObject({
      halted: true,
      halted_at_height: "1515",
      halt_evidence_id: reorgEvidenceA,
      held_operation_id: reorgedA.operation_id,
    });
    expect(store.verify().ok).toBeTrue();
    store.close();

    store = new ZeroneAgentHostStore(path, { create: true });
    store.initialize();
    expect(store.getAccountState(values.profile.chain_id, values.account)).toMatchObject({
      halted: true,
      halted_at_height: "1515",
      halt_evidence_id: reorgEvidenceA,
      held_operation_id: reorgedA.operation_id,
    });
    expect(store.verify().ok).toBeTrue();
    const resolvedA = store.applySequenceAdvanceEvidence({
      operation_id: reorgedA.operation_id,
      expected_revision: reorgedA.revision,
      evidence_id: hash("4"),
      snapshot: sequence11,
      observed_at: sequence11.observed_at,
    });
    expect(resolvedA.status).toBe("sequence_superseded");
    expect(store.getAccountState(values.profile.chain_id, values.account)).toMatchObject({
      halted: false,
      halted_at_height: null,
      halt_evidence_id: null,
      held_operation_id: null,
    });
    expect(store.verify().ok).toBeTrue();
    store.close();

    store = new ZeroneAgentHostStore(path, { create: true });
    store.initialize();
    expect(store.verify().ok).toBeTrue();
    store.close();
  });
});
