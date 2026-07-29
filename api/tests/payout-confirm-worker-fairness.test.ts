import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const worker = readFileSync(
  new URL("../src/workers/payout/confirm-worker.ts", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL(
    "../migrations/20260726T193000_payout_confirmation_fairness.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("payout confirmation scheduling", () => {
  test("orders active-network confirmations and records bounded attempts", () => {
    expect(worker).toContain("lastCheckedAt} ASC NULLS FIRST");
    expect(worker).toContain("cryptoPayouts.requestedAt");
    expect(worker).toContain("eq(cryptoPayouts.network, network)");
    expect(worker).toContain("POLL_CONCURRENCY = 5");
    expect(worker).toContain("Promise.all(consumers)");
    expect(worker).toContain("await markBroadcastChecked(row)");
    expect(worker).toContain("RPC_TIMEOUT_MS = 10_000");
    expect(worker).toContain("eq(cryptoPayouts.txHash, row.txHash)");
    expect(migration).toContain("last_checked_at TIMESTAMPTZ");
    expect(migration).toContain("last_checked_at ASC NULLS FIRST");
    expect(migration).toContain("WHERE status = 'broadcast'");
  });

  test("prevents overlapping batches in one process", () => {
    const guard = worker.indexOf("if (batchInFlight) return batchInFlight");
    const start = worker.indexOf("const current = confirmBatchOnce()");
    const clear = worker.indexOf("batchInFlight = null");
    const interval = worker.indexOf("interval = setInterval");

    expect(guard).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(guard);
    expect(clear).toBeGreaterThan(start);
    expect(interval).toBeGreaterThan(clear);
  });

  test("binds every post-RPC effect to network and transaction identity", () => {
    expect(worker).toContain("current.txHash !== row.txHash");
    expect(worker).toContain("current.network !== row.network");
    expect(worker).toContain('.for("update")');
    expect(
      worker.match(/eq\(cryptoPayouts\.txHash, row\.txHash\)/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(3);
    expect(
      worker.match(/eq\(cryptoPayouts\.network, row\.network\)/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(3);
    expect(worker).toContain("returning({ id: cryptoPayouts.id })");
  });

  test("does not log provider error text or objects", () => {
    expect(worker).not.toContain("err.message");
    expect(worker).not.toContain("console.error(\"[payout-confirm] tick error:\", err)");
    expect(worker).toContain(
      "confirmation lookup unavailable; state unchanged",
    );
  });
});
