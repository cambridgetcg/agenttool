import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ZeroneAgentHostStore } from "../src/index.js";
import { fixture, hash, LATER, rewriteEventChain, TIME } from "./helpers.js";

function signedOperation(path = ":memory:") {
  const values = fixture();
  const store = new ZeroneAgentHostStore(path, {
    create: true,
    ...(path === ":memory:" ? { allow_in_memory_for_tests: true } : {}),
  });
  store.initialize();
  store.putBindingHead(values.binding, values.proof, { expected: null, updated_at: TIME });
  const reserved = store.reserveOperation(values.reserve());
  const signing = store.recordSignerInvocationBoundary({
    operation_id: reserved.operation_id,
    expected_revision: reserved.revision,
    account_snapshot: values.snapshot,
    request_id: "state-commitment-signing",
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
  return { store, values, signed };
}

function signedStore(): ZeroneAgentHostStore {
  return signedOperation().store;
}

function raw(store: ZeroneAgentHostStore): Database {
  return Reflect.get(store, "db") as Database;
}

describe("event-derived mutable state", () => {
  test("rejects a status-only substitution", () => {
    const store = signedStore();
    raw(store).exec("UPDATE operations SET status = 'confirmed_success'");
    expect(() => store.verify()).toThrow(/does not replay|incomplete/);
    store.close();
  });

  test("rejects a reservation-only substitution", () => {
    const store = signedStore();
    raw(store).exec("UPDATE treasury_reservations SET state = 'settled'");
    expect(() => store.verify()).toThrow(/lost sticky exposure/);
    store.close();
  });

  test("rejects a fence-only substitution", () => {
    const store = signedStore();
    raw(store).query(`
      UPDATE sequence_fences SET state = 'released', released_at = ?, release_evidence_id = ?
    `).run("2026-08-20T20:03:00.000Z", hash("f"));
    expect(() => store.verify()).toThrow(/release does not replay|fence ownership/);
    store.close();
  });

  test("binds a released fence timestamp to its release event", () => {
    const values = fixture();
    const store = new ZeroneAgentHostStore(":memory:", {
      create: true,
      allow_in_memory_for_tests: true,
    });
    store.initialize();
    store.putBindingHead(values.binding, values.proof, { expected: null, updated_at: TIME });
    const reserved = store.reserveOperation(values.reserve());
    const released = store.releasePreSign({
      operation_id: reserved.operation_id,
      expected_revision: reserved.revision,
      release_id: hash("b"),
      reason: "caller_cancelled_before_signer",
      at: LATER,
    });
    raw(store).query(`
      UPDATE sequence_fences SET released_at = ? WHERE operation_id = ?
    `).run("2026-08-20T20:02:00.000Z", released.operation_id);
    expect(() => store.verify()).toThrow(/release does not replay/);
    store.close();
  });

  test("rejects a capability-counter-only substitution", () => {
    const store = signedStore();
    raw(store).exec("UPDATE capability_usage SET consumed_intents = 0");
    expect(() => store.verify()).toThrow(/Capability usage does not reconcile/);
    store.close();
  });

  test("rejects an account-observation-only substitution", () => {
    const store = signedStore();
    raw(store).exec("UPDATE account_states SET sequence = '10'");
    expect(() => store.verify()).toThrow(/Account state does not replay/);
    store.close();
  });

  test("binds a rebuilt signer event to the exact reserved account sequence on reopen", () => {
    const values = fixture();
    const path = join(mkdtempSync(join(tmpdir(), "zerone-host-forged-signer-sequence-")), "host.sqlite");
    let store = new ZeroneAgentHostStore(path, { create: true });
    store.initialize();
    store.putBindingHead(values.binding, values.proof, { expected: null, updated_at: TIME });
    const reserved = store.reserveOperation(values.reserve());
    const signing = store.recordSignerInvocationBoundary({
      operation_id: reserved.operation_id,
      expected_revision: reserved.revision,
      account_snapshot: values.snapshot,
      request_id: "forged-signer-sequence",
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
    const sequence10 = {
      ...values.snapshot,
      sequence: "10",
      balance_uzrn: "880000",
      observed_at_height: "1502",
      block_hash: "C".repeat(64),
      observed_at: "2026-08-20T20:04:00.000Z",
    };
    store.applySequenceAdvanceEvidence({
      operation_id: signed.operation_id,
      expected_revision: signed.revision,
      evidence_id: hash("f"),
      snapshot: sequence10,
      observed_at: sequence10.observed_at,
    });
    rewriteEventChain(store, signed.operation_id, (kind, details) => kind === "signer_invocation_boundary"
      ? {
          ...details,
          account_sequence: "10",
          observed_at_height: "1501",
          observation_block_hash: "B".repeat(64),
          observation_at: "2026-08-20T20:00:30.000Z",
        }
      : details);
    expect(() => store.verify()).toThrow(/does not bind the reserved account sequence/);
    store.close();

    store = new ZeroneAgentHostStore(path, { create: true });
    expect(() => store.initialize()).toThrow(/does not bind the reserved account sequence/);
    store.close();
  });

  test("rejects rebuilt zero-depth transaction inclusion on reopen", () => {
    const path = join(mkdtempSync(join(tmpdir(), "zerone-host-zero-depth-")), "host.sqlite");
    let { store, signed } = signedOperation(path);
    store.applyTransactionEvidence({
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
    rewriteEventChain(store, signed.operation_id, (kind, details) => kind === "transaction_inclusion"
      ? { ...details, confirmation_depth: 0 }
      : details);
    expect(() => store.verify()).toThrow(/confirmation_depth must be positive/);
    store.close();

    store = new ZeroneAgentHostStore(path, { create: true });
    expect(() => store.initialize()).toThrow(/confirmation_depth must be positive/);
    store.close();
  });

  test("recomputes the reservation-genesis floor from committed amounts on reopen", () => {
    const values = fixture();
    const path = join(mkdtempSync(join(tmpdir(), "zerone-host-genesis-floor-")), "host.sqlite");
    let store = new ZeroneAgentHostStore(path, { create: true });
    store.initialize();
    store.putBindingHead(values.binding, values.proof, { expected: null, updated_at: TIME });
    const reserved = store.reserveOperation(values.reserve());
    rewriteEventChain(store, reserved.operation_id, (kind, details) => kind === "reserved"
      ? { ...details, balance_uzrn: "100000" }
      : details);
    raw(store).query(`
      UPDATE account_states SET balance_uzrn = '100000'
      WHERE chain_id = ? AND source_account = ?
    `).run(values.profile.chain_id, values.account);
    expect(() => store.verify()).toThrow(/Reservation genesis violates.*reserve floor/);
    store.close();

    store = new ZeroneAgentHostStore(path, { create: true });
    expect(() => store.initialize()).toThrow(/Reservation genesis violates.*reserve floor/);
    store.close();
  });

  test("recomputes the signer-boundary floor from committed amounts on reopen", () => {
    const values = fixture();
    const path = join(mkdtempSync(join(tmpdir(), "zerone-host-signer-floor-")), "host.sqlite");
    let store = new ZeroneAgentHostStore(path, { create: true });
    store.initialize();
    store.putBindingHead(values.binding, values.proof, { expected: null, updated_at: TIME });
    const reserved = store.reserveOperation(values.reserve());
    const signerSnapshot = {
      ...values.snapshot,
      observed_at_height: "1501",
      block_hash: "B".repeat(64),
      observed_at: "2026-08-20T20:00:30.000Z",
    };
    store.recordSignerInvocationBoundary({
      operation_id: reserved.operation_id,
      expected_revision: reserved.revision,
      account_snapshot: signerSnapshot,
      request_id: "forged-signer-floor",
      unsigned_payload_hash: hash("b"),
      external_verification_id: hash("c"),
      at: LATER,
    });
    rewriteEventChain(store, reserved.operation_id, (kind, details) =>
      kind === "signer_invocation_boundary" ? { ...details, balance_uzrn: "100000" } : details);
    raw(store).query(`
      UPDATE account_states SET balance_uzrn = '100000'
      WHERE chain_id = ? AND source_account = ?
    `).run(values.profile.chain_id, values.account);
    expect(() => store.verify()).toThrow(/Signer event violates.*reserve floor/);
    store.close();

    store = new ZeroneAgentHostStore(path, { create: true });
    expect(() => store.initialize()).toThrow(/Signer event violates.*reserve floor/);
    store.close();
  });

  test("rejects a rebuilt signer snapshot that regresses account evidence order", () => {
    const path = join(mkdtempSync(join(tmpdir(), "zerone-host-stale-signer-snapshot-")), "host.sqlite");
    let { store, signed } = signedOperation(path);
    rewriteEventChain(store, signed.operation_id, (kind, details) =>
      kind === "signer_invocation_boundary"
        ? {
            ...details,
            observed_at_height: "1499",
            observation_block_hash: "C".repeat(64),
            observation_at: "2026-08-20T19:59:00.000Z",
          }
        : details);
    expect(() => store.verify()).toThrow(/Account observation regresses in ledger order/);
    store.close();

    store = new ZeroneAgentHostStore(path, { create: true });
    expect(() => store.initialize()).toThrow(/Account observation regresses in ledger order/);
    store.close();
  });

  test("accepts an exact same-height signer observation through restart", () => {
    const path = join(mkdtempSync(join(tmpdir(), "zerone-host-same-height-signer-")), "host.sqlite");
    let { store } = signedOperation(path);
    expect(store.verify().ok).toBeTrue();
    store.close();

    store = new ZeroneAgentHostStore(path, { create: true });
    store.initialize();
    expect(store.verify().ok).toBeTrue();
    store.close();
  });
});
