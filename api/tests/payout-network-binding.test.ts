import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { shouldWrapInTransaction } from "../scripts/_migrate-one";

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
const apiRoot = fileURLToPath(new URL("..", import.meta.url));

describe("durable payout network identity", () => {
  test("migration preserves legacy rows and freezes assigned identity", () => {
    expect(shouldWrapInTransaction(migration)).toBe(true);
    expect(migration.trimEnd()).not.toMatch(/COMMIT\s*;$/i);
    expect(migration).not.toContain("@no-transaction");
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

  test("resting fresh admission never infers a process network", () => {
    const start = service.indexOf("export async function requestPayout");
    const end = service.indexOf("export async function listPayouts", start);
    const payout = service.slice(start, end);
    const replay = payout.indexOf("replayed: true");
    const resting = payout.indexOf("PAYOUT_ADMISSION_RESTING_ERROR");

    expect(replay).toBeGreaterThan(-1);
    expect(resting).toBeGreaterThan(replay);
    expect(payout).not.toContain("activeNetwork()");
    expect(payout).not.toContain(".insert(cryptoPayouts)");
  });

  test("dispatch, broadcast, and confirmation use only the active bound network", () => {
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

  test("stale payout-only network settings cannot take down unrelated startup", () => {
    const probe =
      "const config = await import('./src/services/economy/config.ts'); " +
      "const network = await import('./src/services/economy/crypto/network.ts'); " +
      "let crypto_error = false; let active = null; " +
      "try { active = network.activeNetwork(); } catch { crypto_error = true; } " +
      "console.log(JSON.stringify({allowed: config.payoutWorkerBootAllowed(), payout_network: config.economyConfig.payout.network, active, crypto_error}));";

    const invalid = spawnSync(process.execPath, ["-e", probe], {
      cwd: apiRoot,
      env: {
        ...process.env,
        CRYPTO_NETWORK: "testnet",
        PAYOUT_NETWORK: "retired-value",
        PAYOUT_WORKER_ENABLED: "true",
      },
      encoding: "utf8",
    });
    expect(invalid.status, invalid.stderr).toBe(0);
    expect(JSON.parse(invalid.stdout.trim())).toEqual({
      allowed: false,
      payout_network: "",
      active: "testnet",
      crypto_error: false,
    });

    const mismatch = spawnSync(process.execPath, ["-e", probe], {
      cwd: apiRoot,
      env: {
        ...process.env,
        CRYPTO_NETWORK: "testnet",
        PAYOUT_NETWORK: "mainnet",
        PAYOUT_WORKER_ENABLED: "true",
      },
      encoding: "utf8",
    });
    expect(mismatch.status, mismatch.stderr).toBe(0);
    expect(JSON.parse(mismatch.stdout.trim())).toEqual({
      allowed: false,
      payout_network: "mainnet",
      active: null,
      crypto_error: true,
    });
  });
});
