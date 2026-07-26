import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const dispatcher = readFileSync(
  new URL("../src/workers/payout/dispatcher.ts", import.meta.url),
  "utf8",
);
const worker = readFileSync(
  new URL("../src/workers/payout/broadcast-worker.ts", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL(
    "../migrations/20260726T201000_payout_dispatch_fairness.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("payout dispatch fairness", () => {
  test("selects only due requests in least-recent-attempt order", () => {
    expect(dispatcher).toContain("isNull(cryptoPayouts.dispatchAfter)");
    expect(dispatcher).toContain("lte(cryptoPayouts.dispatchAfter, now)");
    expect(dispatcher).toContain(
      "COALESCE(${cryptoPayouts.lastDispatchAttemptAt}, ${cryptoPayouts.requestedAt})",
    );
    expect(dispatcher).toContain("cryptoPayouts.requestedAt");

    const due = dispatcher.indexOf("isNull(cryptoPayouts.dispatchAfter)");
    const order = dispatcher.indexOf(".orderBy(", due);
    const limit = dispatcher.indexOf(".limit(BATCH_SIZE)", order);
    expect(due).toBeGreaterThan(-1);
    expect(order).toBeGreaterThan(due);
    expect(limit).toBeGreaterThan(order);
  });

  test("persists shared cooldown state for both nonce deferral paths", () => {
    const helperStart = worker.indexOf("async function deferRequestedPayout");
    const helperEnd = worker.indexOf(
      "async function markPersistedIdentityBroadcast",
      helperStart,
    );
    const helper = worker.slice(helperStart, helperEnd);
    expect(helper).toContain("lastDispatchAttemptAt: attemptedAt");
    expect(helper).toContain("dispatchAfter: new Date(");
    expect(helper).toContain('eq(cryptoPayouts.status, "requested")');
    expect(helper).toContain(".returning(");

    const conflictStart = worker.indexOf(
      "if (isEvmPayoutNonceConflict(error))",
    );
    const conflictEnd = worker.indexOf("throw error", conflictStart);
    const conflict = worker.slice(conflictStart, conflictEnd);
    expect(conflict).toContain("deferRequestedPayout(");
    expect(conflict).toContain("workerNetwork");
    expect(conflict).toContain('"evm_nonce_contention"');

    const unresolvedStart = worker.indexOf(
      'if (lockResult.reason === "source_nonce_unresolved")',
    );
    const unresolvedEnd = worker.indexOf("console.warn(", unresolvedStart);
    expect(worker.slice(unresolvedStart, unresolvedEnd)).toContain(
      '"evm_source_nonce_unresolved"',
    );
    expect(worker.slice(unresolvedStart, unresolvedEnd)).toContain(
      "deferRequestedPayout(",
    );
  });

  test("schema migration index matches dispatcher ordering", () => {
    const coalesce = migration.indexOf(
      "(COALESCE(last_dispatch_attempt_at, requested_at))",
    );
    const requested = migration.indexOf("requested_at ASC", coalesce);
    const due = migration.indexOf(
      "dispatch_after ASC NULLS FIRST",
      requested,
    );
    expect(migration).toContain("dispatch_after TIMESTAMPTZ");
    expect(migration).toContain("last_dispatch_attempt_at TIMESTAMPTZ");
    expect(coalesce).toBeGreaterThan(-1);
    expect(requested).toBeGreaterThan(coalesce);
    expect(due).toBeGreaterThan(requested);
    expect(migration).toContain("WHERE status = 'requested'");
  });

  test("successful pre-submit CAS clears stale cooldown", () => {
    const phaseOne = worker.indexOf("async function processEvmPayout");
    const persist = worker.indexOf("const updated = await tx", phaseOne);
    const evidence = worker.indexOf("...nonceEvidence", persist);
    const phaseTwo = worker.indexOf("// ── Phase 2: submit", evidence);
    const cas = worker.slice(persist, phaseTwo);

    expect(cas).toContain('status: "broadcasting"');
    expect(cas).toContain("dispatchAfter: null");
    expect(evidence).toBeGreaterThan(persist);
    expect(cas).toContain('eq(cryptoPayouts.status, "requested")');
  });
});
