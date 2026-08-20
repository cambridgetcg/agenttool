import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ZeroneAgentHostStore,
  resolveAndPutBindingHead,
} from "../src/index.js";
import { fixture, hash, LATER, TIME } from "./helpers.js";

test("persists injected proof currentness and rejects a reservation after proof/revocation CAS advances", async () => {
  const values = fixture();
  const store = new ZeroneAgentHostStore(":memory:", {
    create: true,
    allow_in_memory_for_tests: true,
  });
  store.initialize();
  const first = await resolveAndPutBindingHead({
    store,
    binding: values.binding,
    resolver: {
      async resolveCurrentProof(binding) {
        expect(binding.binding_id).toBe(values.binding.binding_id);
        return values.proof;
      },
    },
    expected: null,
    updated_at: TIME,
  });
  const reserved = store.reserveOperation(values.reserve());
  const nextProof = {
    ...values.proof,
    proof_id: hash("f"),
    wallet_revocation_nonce: 1,
    verified_at: LATER,
  };
  const second = store.putBindingHead(values.binding, nextProof, {
    expected: {
      wallet_id: first.wallet_id,
      binding_id: first.binding.binding_id,
      proof_id: first.proof.proof_id,
      head_version: first.head_version,
    },
    updated_at: LATER,
  });
  expect(second).toMatchObject({
    head_version: 2,
    proof: { proof_id: hash("f"), wallet_revocation_nonce: 1 },
  });
  expect(() => store.recordSignerInvocationBoundary({
    operation_id: reserved.operation_id,
    expected_revision: reserved.revision,
    account_snapshot: values.snapshot,
    request_id: "stale-proof-request",
    unsigned_payload_hash: hash("b"),
    external_verification_id: hash("c"),
    at: LATER,
  })).toThrow(/authority changed/);
  expect(() => store.putBindingHead(values.binding, nextProof, {
    expected: {
      wallet_id: first.wallet_id,
      binding_id: first.binding.binding_id,
      proof_id: first.proof.proof_id,
      head_version: first.head_version,
    },
    updated_at: LATER,
  })).toThrow(/expectation is stale/);
  store.close();
});

test("replays the binding head that was current at the signer boundary", () => {
  const values = fixture();
  const path = join(mkdtempSync(join(tmpdir(), "zerone-host-signer-head-")), "host.sqlite");
  let store = new ZeroneAgentHostStore(path, { create: true });
  store.initialize();
  const first = store.putBindingHead(values.binding, values.proof, {
    expected: null,
    updated_at: TIME,
  });
  const reserved = store.reserveOperation(values.reserve());
  const signing = store.recordSignerInvocationBoundary({
    operation_id: reserved.operation_id,
    expected_revision: reserved.revision,
    account_snapshot: values.snapshot,
    request_id: "historical-head-signer",
    unsigned_payload_hash: hash("b"),
    external_verification_id: hash("c"),
    at: LATER,
  });
  store.recordVerifiedSignedEvidence({
    operation_id: signing.operation_id,
    expected_revision: signing.revision,
    tx_hash: "B".repeat(64),
    signed_payload_hash: hash("d"),
    external_verification_id: hash("e"),
    at: "2026-08-20T20:02:00.000Z",
  });
  const refreshedProof = {
    ...values.proof,
    proof_id: hash("f"),
    verified_at: "2026-08-20T20:00:30.000Z",
  };
  store.putBindingHead(values.binding, refreshedProof, {
    expected: {
      wallet_id: first.wallet_id,
      binding_id: first.binding.binding_id,
      proof_id: first.proof.proof_id,
      head_version: first.head_version,
    },
    updated_at: "2026-08-20T20:03:00.000Z",
  });
  const rawDatabase = Reflect.get(store, "db") as Database;
  rawDatabase.exec("DROP TRIGGER binding_history_no_update");
  rawDatabase.query(`UPDATE binding_history SET recorded_at = ? WHERE proof_id = ?`)
    .run("2026-08-20T20:00:30.000Z", refreshedProof.proof_id);
  rawDatabase.query(`UPDATE binding_heads SET updated_at = ? WHERE wallet_id = ?`)
    .run("2026-08-20T20:00:30.000Z", values.binding.wallet_id);
  rawDatabase.exec(`
    CREATE TRIGGER binding_history_no_update
    BEFORE UPDATE ON binding_history
    BEGIN
      SELECT RAISE(ABORT, 'binding history is append-only');
    END
  `);
  expect(() => store.verify()).toThrow(/did not use the current historical binding head/);
  store.close();

  store = new ZeroneAgentHostStore(path, { create: true });
  expect(() => store.initialize()).toThrow(/did not use the current historical binding head/);
  store.close();
});
