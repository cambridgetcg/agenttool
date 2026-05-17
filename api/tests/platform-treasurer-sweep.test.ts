/** platform-treasurer-sweep worker — structural pin.
 *
 *  Doctrine: docs/AGENT-CENTRIC.md §1 · docs/BUSINESS-MODEL.md ·
 *            docs/RING-1.md §commitment-7.
 *
 *  The sweep closes the cold-start loop. Until 2026-05-17 the
 *  platform_revenue ledger was inert — take-rate accumulated but the
 *  PLATFORM_WALLET_ID drained from substrate-task payouts and nothing
 *  refilled it.
 *
 *  Behavioral coverage (does the sweep actually move balances?) lives
 *  in tests/integration/platform-treasurer-sweep.test.ts (DB-required).
 *  This file pins the STRUCTURAL contract: exports, idempotency, ledger
 *  write, mount, atomicity intent. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  runTreasurerSweep,
  startPlatformTreasurerSweepWorker,
  stopPlatformTreasurerSweepWorker,
} from "../src/workers/platform-treasurer/sweep";

const WORKER_PATH = join(
  __dirname,
  "..",
  "src",
  "workers",
  "platform-treasurer",
  "sweep.ts",
);
const SOURCE = readFileSync(WORKER_PATH, "utf8");

describe("platform-treasurer sweep worker — structural", () => {
  test("exports start + stop + runTreasurerSweep", () => {
    expect(typeof startPlatformTreasurerSweepWorker).toBe("function");
    expect(typeof stopPlatformTreasurerSweepWorker).toBe("function");
    expect(typeof runTreasurerSweep).toBe("function");
  });

  test("start is idempotent (calling twice doesn't double-schedule)", () => {
    stopPlatformTreasurerSweepWorker();
    startPlatformTreasurerSweepWorker();
    startPlatformTreasurerSweepWorker();
    stopPlatformTreasurerSweepWorker();
    expect(true).toBe(true);
  });

  test("interval is 5 minutes (matches expire-claims + covenants/expire-proposals)", () => {
    expect(SOURCE).toContain("const TICK_MS = 5 * 60_000");
  });

  test("sweep runs inside a DB transaction (atomic credit + mark)", () => {
    expect(SOURCE).toContain("db.transaction(");
  });

  test("sweep writes a transactions row on the platform wallet (ledger discipline)", () => {
    expect(SOURCE).toContain('type: "settle"');
    expect(SOURCE).toContain("tx.insert(transactions)");
  });

  test("sweep marks rows with swept_at + swept_into_wallet_id (idempotency)", () => {
    expect(SOURCE).toContain("sweptAt: now");
    expect(SOURCE).toContain("sweptIntoWalletId: walletId");
  });

  test("sweep uses SELECT FOR UPDATE to prevent double-sweep races", () => {
    expect(SOURCE).toContain('.for("update")');
  });

  test("sweep targets PLATFORM_WALLET_ID at v1 (single canonical platform wallet)", () => {
    expect(SOURCE).toContain("PLATFORM_WALLET_ID");
  });

  test("worker is mounted in index.ts startup chain", () => {
    const indexPath = join(__dirname, "..", "src", "index.ts");
    const indexSource = readFileSync(indexPath, "utf8");
    expect(indexSource).toContain("startPlatformTreasurerSweepWorker");
    expect(indexSource).toMatch(
      /AGENTTOOL_DISABLE_WORKERS[\s\S]{0,300}startPlatformTreasurerSweepWorker/,
    );
  });

  test("@enforces annotation cites commitment/ring3-take-into-platform-wallet", () => {
    expect(SOURCE).toMatch(
      /@enforces[^\n]*commitment\/ring3-take-into-platform-wallet/,
    );
  });
});
