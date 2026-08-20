import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fixture,
  hash,
  LATER,
  LegacyGenericTestHostStore as ZeroneAgentHostStore,
  rewriteEventChain,
  TIME,
} from "./helpers.js";

function pathFor(label: string): string {
  return join(mkdtempSync(join(tmpdir(), `zerone-agent-host-${label}-`)), "host.sqlite");
}

describe("restart durability", () => {
  test("converts a crash-left signing row to sticky signing_unknown on reopen", () => {
    const values = fixture();
    const path = pathFor("signing");
    const first = new ZeroneAgentHostStore(path, { create: true });
    first.initialize();
    first.putBindingHead(values.proof, values.currentness, { expected: null, updated_at: TIME });
    const reserved = first.reserveOperation(values.reserve());
    const signing = first.recordSignerInvocationBoundary({
      operation_id: reserved.operation_id,
      expected_revision: reserved.revision,
      account_snapshot: values.snapshot,
      request_id: "request-crash",
      unsigned_payload_hash: hash("b"),
      external_verification_id: hash("c"),
      at: LATER,
    });
    expect(signing.status).toBe("signing");
    first.close();

    const reopened = new ZeroneAgentHostStore(path, {
      create: false,
      now: () => "2026-08-20T19:00:00.000Z",
    });
    reopened.initialize();
    const recovered = reopened.getOperation(signing.operation_id);
    expect(recovered).toMatchObject({
      revision: signing.revision + 1,
      status: "signing_unknown",
      signer_invoked: true,
      updated_at: LATER,
    });
    expect(recovered?.reservations.every(({ state }) => state === "sticky")).toBeTrue();
    expect(reopened.getAccountState(values.profile.chain_id, values.account)?.held_operation_id)
      .toBe(signing.operation_id);
    expect(reopened.listEvents(signing.operation_id).at(-1)).toMatchObject({
      kind: "cold_start_recovery",
      at: LATER,
      details: { wall_clock_clamped: true },
    });
    expect(reopened.verify().ok).toBeTrue();
    reopened.close();
  });

  test("converts a crash-left submitting row to submission_unknown without retry", () => {
    const values = fixture();
    const path = pathFor("submitting");
    const first = new ZeroneAgentHostStore(path, { create: true });
    first.initialize();
    first.putBindingHead(values.proof, values.currentness, { expected: null, updated_at: TIME });
    const reserved = first.reserveOperation(values.reserve());
    const signing = first.recordSignerInvocationBoundary({
      operation_id: reserved.operation_id,
      expected_revision: reserved.revision,
      account_snapshot: values.snapshot,
      request_id: "request-submit-crash",
      unsigned_payload_hash: hash("b"),
      external_verification_id: hash("c"),
      at: LATER,
    });
    const signed = first.recordVerifiedSignedEvidence({
      operation_id: signing.operation_id,
      expected_revision: signing.revision,
      tx_hash: "B".repeat(64),
      signed_payload_hash: hash("d"),
      external_verification_id: hash("e"),
      at: "2026-08-20T20:02:00.000Z",
    });
    const submitting = first.recordBroadcastInvocationBoundary({
      operation_id: signed.operation_id,
      expected_revision: signed.revision,
      at: "2026-08-20T20:03:00.000Z",
    });
    first.close();

    const reopened = new ZeroneAgentHostStore(path, {
      create: false,
      now: () => "2026-08-20T20:10:00.000Z",
    });
    reopened.initialize();
    const recovered = reopened.getOperation(submitting.operation_id);
    expect(recovered?.status).toBe("submission_unknown");
    expect(reopened.listEvents(submitting.operation_id).at(-1)).toMatchObject({
      kind: "cold_start_recovery",
      details: {
        from_status: "submitting",
        to_status: "submission_unknown",
        reservation_released: false,
        sequence_fence_released: false,
      },
    });
    reopened.close();
  });

  test("rejects a forged clamped-recovery flag on an advancing recovery clock", () => {
    const values = fixture();
    const path = pathFor("forged-recovery-clamp");
    const first = new ZeroneAgentHostStore(path, { create: true });
    first.initialize();
    first.putBindingHead(values.proof, values.currentness, { expected: null, updated_at: TIME });
    const reserved = first.reserveOperation(values.reserve());
    const signing = first.recordSignerInvocationBoundary({
      operation_id: reserved.operation_id,
      expected_revision: reserved.revision,
      account_snapshot: values.snapshot,
      request_id: "request-forged-recovery-clamp",
      unsigned_payload_hash: hash("b"),
      external_verification_id: hash("c"),
      at: LATER,
    });
    first.close();

    let reopened = new ZeroneAgentHostStore(path, {
      create: true,
      now: () => "2026-08-20T20:10:00.000Z",
    });
    reopened.initialize();
    rewriteEventChain(reopened, signing.operation_id, (kind, details) =>
      kind === "cold_start_recovery" ? { ...details, wall_clock_clamped: true } : details);
    expect(() => reopened.verify()).toThrow(/Clamped recovery event advanced/);
    reopened.close();

    reopened = new ZeroneAgentHostStore(path, { create: true });
    expect(() => reopened.initialize()).toThrow(/Clamped recovery event advanced/);
    reopened.close();
  });

  test("tightens the database and sidecars to 0600", () => {
    const values = fixture();
    const path = pathFor("modes");
    const store = new ZeroneAgentHostStore(path, { create: true });
    store.initialize();
    store.putBindingHead(values.proof, values.currentness, { expected: null, updated_at: TIME });
    chmodSync(path, 0o644);
    store.reserveOperation(values.reserve());
    for (const candidate of [path, `${path}-wal`, `${path}-shm`]) {
      expect(statSync(candidate).mode & 0o777).toBe(0o600);
    }
    store.close();
  });

  test("fails closed on reopen when mutable ledger state no longer matches its event commitment", () => {
    const values = fixture();
    const path = pathFor("semantic-tamper");
    const first = new ZeroneAgentHostStore(path, { create: true });
    first.initialize();
    first.putBindingHead(values.proof, values.currentness, { expected: null, updated_at: TIME });
    first.reserveOperation(values.reserve());
    first.close();

    const rawDatabase = new Database(path);
    rawDatabase.exec("UPDATE capability_usage SET max_intents = 99");
    rawDatabase.close(false);

    const reopened = new ZeroneAgentHostStore(path, { create: true });
    expect(() => reopened.initialize()).toThrow(/Reservation authority commitment/);
    reopened.close();
  });
});
