import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function read(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), "utf8");
}

const migration = read(
  "../migrations/20260726T203000_payout_network_binding.sql",
);
const service = read("../src/services/economy/crypto/index.ts");
const dispatcher = read("../src/workers/payout/dispatcher.ts");
const broadcaster = read("../src/workers/payout/broadcast-worker.ts");
const confirmer = read("../src/workers/payout/confirm-worker.ts");

describe("durable payout network identity", () => {
  test("migration preserves legacy rows for explicit reconciliation and freezes assigned identity", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS network TEXT");
    expect(migration).toContain(
      "CHECK (network IS NULL OR network IN ('testnet', 'mainnet'))",
    );
    expect(migration).toContain("NOT VALID");
    expect(migration).toContain(
      "OLD.network IS NOT NULL AND NEW.network IS DISTINCT FROM OLD.network",
    );
    expect(migration).toContain("crypto_payout_network_immutable");
  });

  test("new payout creation binds active network after replay and worker gates", () => {
    const start = service.indexOf("export async function requestPayout");
    const end = service.indexOf("export async function listPayouts", start);
    const payout = service.slice(start, end);
    const replay = payout.indexOf("replayed: true");
    const workerGate = payout.indexOf("!p.payoutBroadcastConfigured");
    const bind = payout.indexOf("const payoutNetwork = activeNetwork()");
    const insert = payout.indexOf("network: payoutNetwork");

    expect(replay).toBeGreaterThan(-1);
    expect(workerGate).toBeGreaterThan(replay);
    expect(bind).toBeGreaterThan(workerGate);
    expect(insert).toBeGreaterThan(bind);
  });

  test("dispatch, broadcast, and confirmation select only the active bound network", () => {
    expect(dispatcher).toContain("eq(cryptoPayouts.network, network)");
    expect(broadcaster).toContain("meta.network !== network");
    expect(broadcaster).toContain("row.network !== workerNetwork");
    expect(broadcaster).toContain(
      "eq(cryptoPayouts.network, workerNetwork)",
    );
    expect(confirmer).toContain("eq(cryptoPayouts.network, network)");
    expect(confirmer).toContain("current.network !== activeNetwork()");
  });

  test("network mismatch never authorizes refund or reinterpretation", () => {
    const mismatch = broadcaster.indexOf("meta.network !== network");
    const mismatchEnd = broadcaster.indexOf("// ── EVM branch", mismatch);
    const branch = broadcaster.slice(mismatch, mismatchEnd);
    expect(branch).toContain("leaving requested");
    expect(branch).not.toContain("refundPayoutAndFail");
    expect(branch).not.toContain("activeMnemonic");
  });
});
