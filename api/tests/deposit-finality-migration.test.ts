import { describe, expect, test } from "bun:test";

const migration = await Bun.file(
  new URL(
    "../migrations/20260726T185835_crypto_deposit_finality.sql",
    import.meta.url,
  ),
).text();
const schema = await Bun.file(
  new URL("../src/db/schema/economy.ts", import.meta.url),
).text();
const service = await Bun.file(
  new URL(
    "../src/services/economy/crypto/inbound-deposits.ts",
    import.meta.url,
  ),
).text();
const worker = await Bun.file(
  new URL("../src/workers/deposit/confirm-worker.ts", import.meta.url),
).text();

describe("deposit finality storage boundary", () => {
  test("classifies historical balance effects before making pending the default", () => {
    const historical = migration.indexOf("SET status = 'credited'");
    const pendingDefault = migration.indexOf(
      "ALTER COLUMN status SET DEFAULT 'pending'",
    );
    expect(historical).toBeGreaterThan(0);
    expect(pendingDefault).toBeGreaterThan(historical);
  });

  test("pins the closed lifecycle and a due-status index", () => {
    expect(migration).toContain(
      "CHECK (status IN ('pending', 'credited', 'removed', 'rejected'))",
    );
    expect(migration).toContain("idx_crypto_event_status");
    expect(migration).toMatch(
      /status,\s*last_checked_at ASC NULLS FIRST,\s*received_at/,
    );
    expect(schema).toContain(
      '$type<"pending" | "credited" | "removed" | "rejected">()',
    );
  });

  test("separates pending observation, confirmed credit, and reorg reversal", () => {
    const pending = service.indexOf('status: "pending"');
    const confirmed = service.indexOf(
      "export async function creditConfirmedPendingDeposit",
    );
    const removed = service.indexOf(
      "export async function reconcileRemovedInboundTransfer",
    );
    expect(pending).toBeGreaterThan(0);
    expect(confirmed).toBeGreaterThan(pending);
    expect(removed).toBeGreaterThan(pending);
    expect(service).toContain(
      'eq(cryptoWebhookEvents.status, "pending")',
    );
    expect(service).toContain(
      'eq(cryptoWebhookEvents.status, "credited")',
    );
  });

  test("reconciles an insert conflict with a concurrent removed tombstone", () => {
    const pendingWriter = service.indexOf(
      "async function recordPendingEvmObservation",
    );
    const conflict = service.indexOf(".onConflictDoNothing()", pendingWriter);
    const reread = service.indexOf("const [winner]", conflict);
    const reactivation = service.indexOf(
      'if (winner.status === "removed")',
      reread,
    );
    expect(pendingWriter).toBeGreaterThan(0);
    expect(conflict).toBeGreaterThan(pendingWriter);
    expect(reread).toBeGreaterThan(conflict);
    expect(reactivation).toBeGreaterThan(reread);
    expect(service.slice(reread, reactivation)).toContain('.for("update")');
  });

  test("schedules pending rows fairly and prevents in-process overlap", () => {
    expect(worker).toContain(
      "lastCheckedAt} ASC NULLS FIRST",
    );
    expect(worker).toContain("const POLL_CONCURRENCY = 5");
    expect(worker).toContain("const RPC_TIMEOUT_MS = 10_000");
    expect(worker).toContain("if (batchInFlight) return batchInFlight");
    expect(worker).toContain("await Promise.all(consumers)");
  });
});
