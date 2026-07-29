import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const API_ROOT = join(import.meta.dir, "..");

describe("documented worker off-switch", () => {
  test("AGENTTOOL_DISABLE_WORKERS prevents Redis construction in a fresh process", () => {
    const env = { ...process.env, AGENTTOOL_DISABLE_WORKERS: "1" };
    delete env.AGENTOOL_DISABLE_WORKERS;
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        "const m = await import('./src/services/tools/queue/connection.ts'); console.log(JSON.stringify({ disabled: m.REDIS_DISABLED, connection: m.redisConnection }));",
      ],
      { cwd: API_ROOT, env, encoding: "utf8", timeout: 10_000 },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout.trim())).toEqual({ disabled: true, connection: null });
  });

  test("the old misspelling is absent from runtime source", () => {
    for (const file of ["src/index.ts", "src/services/tools/queue/connection.ts"]) {
      expect(readFileSync(join(API_ROOT, file), "utf8")).not.toContain(
        "AGENTOOL_DISABLE_WORKERS",
      );
    }
  });

  test("payout-only dependencies load after the payout worker gate", () => {
    const source = readFileSync(join(API_ROOT, "src/index.ts"), "utf8");
    const gate = source.indexOf("if (payoutWorkerBootAllowed())");
    const lazyImport = source.indexOf('import("./workers/payout")');

    expect(source).not.toMatch(/^import .*workers\/payout/m);
    expect(gate).toBeGreaterThan(-1);
    expect(lazyImport).toBeGreaterThan(gate);
  });

  test("deposit confirmation dependencies load only behind the global worker gate", () => {
    const source = readFileSync(join(API_ROOT, "src/index.ts"), "utf8");
    const lazyImport = source.indexOf(
      'import("./workers/deposit/confirm-worker")',
    );
    const gate = source.lastIndexOf(
      'if (!envFlag("AGENTTOOL_DISABLE_WORKERS"))',
      lazyImport,
    );

    expect(source).not.toMatch(/^import .*workers\/deposit\/confirm-worker/m);
    expect(gate).toBeGreaterThan(-1);
    expect(lazyImport).toBeGreaterThan(gate);
  });

  test("the global switch overrides payout opt-in", () => {
    const env = {
      ...process.env,
      AGENTTOOL_DISABLE_WORKERS: "1",
      PAYOUT_WORKER_ENABLED: "true",
    };
    delete env.PAYOUT_NETWORK;
    delete env.CRYPTO_HD_MNEMONIC_TESTNET;

    const result = spawnSync(
      process.execPath,
      [
        "-e",
        "const gate = await import('./src/services/economy/config.ts'); console.log(JSON.stringify({ allowed: gate.payoutWorkerBootAllowed() }));",
      ],
      { cwd: API_ROOT, env, encoding: "utf8", timeout: 10_000 },
    );

    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout.trim());
    expect(output.allowed).toBe(false);
  });

  test("fresh-process payout flags cannot reopen the resting worker", () => {
    const env = {
      ...process.env,
      AGENTTOOL_DISABLE_WORKERS: "0",
      PAYOUT_WORKER_ENABLED: "true",
      PAYOUT_NETWORK: "testnet",
      CRYPTO_HD_MNEMONIC_TESTNET:
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
      PAYOUT_GBP_USD_RATE: "1.25",
    };

    const result = spawnSync(
      process.execPath,
      [
        "-e",
        "const gate = await import('./src/services/economy/config.ts'); console.log(JSON.stringify({ configured: gate.economyConfig.payout.workerEnabled, default_allowed: gate.payoutWorkerBootAllowed(), caller_allowed: gate.payoutWorkerBootAllowed(true, false) }));",
      ],
      { cwd: API_ROOT, env, encoding: "utf8", timeout: 10_000 },
    );

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      configured: true,
      default_allowed: false,
      caller_allowed: false,
    });
  });

  test("direct processPayout import rests before database or RPC work", () => {
    const env = {
      ...process.env,
      AGENTTOOL_DISABLE_WORKERS: "1",
      PAYOUT_WORKER_ENABLED: "true",
      DATABASE_URL: "postgresql://127.0.0.1:1/must-not-connect",
    };
    delete env.PAYOUT_NETWORK;
    delete env.CRYPTO_NETWORK;

    const result = spawnSync(
      process.execPath,
      [
        "-e",
        "const worker = await import('./src/workers/payout/broadcast-worker.ts'); await worker.processPayout('00000000-0000-4000-8000-000000000099'); console.log('rested-before-io');",
      ],
      { cwd: API_ROOT, env, encoding: "utf8", timeout: 10_000 },
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("rested-before-io");
    expect(result.stderr).toContain("payout worker resting; row left untouched");
  });

  test("direct dispatcher start rests before database or queue work", () => {
    const env = {
      ...process.env,
      AGENTTOOL_DISABLE_WORKERS: "0",
      PAYOUT_WORKER_ENABLED: "true",
      CRYPTO_NETWORK: "testnet",
      PAYOUT_NETWORK: "testnet",
      DATABASE_URL: "postgresql://127.0.0.1:1/must-not-connect",
      REDIS_URL: "redis://127.0.0.1:1/must-not-connect",
    };

    const result = spawnSync(
      process.execPath,
      [
        "-e",
        "globalThis.setInterval = () => { throw new Error('scheduled-worker-io-poison'); }; const worker = await import('./src/workers/payout/dispatcher.ts'); worker.startPayoutDispatcher(); console.log('rested-before-io');",
      ],
      { cwd: API_ROOT, env, encoding: "utf8", timeout: 10_000 },
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("rested-before-io");
    expect(result.stderr).toContain("[payout-dispatcher] worker resting");
    expect(result.stderr).not.toContain("scheduled-worker-io-poison");
  });

  test("direct confirmer start rests before database or RPC work", () => {
    const env = {
      ...process.env,
      AGENTTOOL_DISABLE_WORKERS: "0",
      PAYOUT_WORKER_ENABLED: "true",
      CRYPTO_NETWORK: "testnet",
      PAYOUT_NETWORK: "testnet",
      DATABASE_URL: "postgresql://127.0.0.1:1/must-not-connect",
      RPC_URL_ETHEREUM_TESTNET: "http://127.0.0.1:1/must-not-connect",
      RPC_URL_SOLANA_TESTNET: "http://127.0.0.1:1/must-not-connect",
    };

    const result = spawnSync(
      process.execPath,
      [
        "-e",
        "globalThis.setInterval = () => { throw new Error('scheduled-worker-io-poison'); }; globalThis.fetch = () => { throw new Error('rpc-io-poison'); }; const worker = await import('./src/workers/payout/confirm-worker.ts'); worker.startPayoutConfirmWorker(); console.log('rested-before-io');",
      ],
      { cwd: API_ROOT, env, encoding: "utf8", timeout: 10_000 },
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("rested-before-io");
    expect(result.stderr).toContain("[payout-confirm] worker resting");
    expect(result.stderr).not.toContain("scheduled-worker-io-poison");
    expect(result.stderr).not.toContain("rpc-io-poison");
  });

  test("payout workers repeat the gate and never bypass a missing queue", () => {
    const worker = readFileSync(
      join(API_ROOT, "src/workers/payout/index.ts"),
      "utf8",
    );
    const dispatcher = readFileSync(
      join(API_ROOT, "src/workers/payout/dispatcher.ts"),
      "utf8",
    );
    const broadcaster = readFileSync(
      join(API_ROOT, "src/workers/payout/broadcast-worker.ts"),
      "utf8",
    );
    const confirmer = readFileSync(
      join(API_ROOT, "src/workers/payout/confirm-worker.ts"),
      "utf8",
    );

    expect(worker).toMatch(/if \(!payoutWorkerBootAllowed\(\)\)/);
    for (const [source, exportedStart] of [
      [dispatcher, "export function startPayoutDispatcher"],
      [confirmer, "export function startPayoutConfirmWorker"],
    ] as const) {
      const start = source.indexOf(exportedStart);
      const directGate = source.indexOf("!payoutWorkerBootAllowed()", start);
      const firstSchedule = source.indexOf("setInterval", start);
      expect(start).toBeGreaterThan(-1);
      expect(directGate).toBeGreaterThan(start);
      expect(firstSchedule).toBeGreaterThan(directGate);
    }
    const processStart = broadcaster.indexOf(
      "export async function processPayout",
    );
    const firstDatabaseRead = broadcaster.indexOf("await db", processStart);
    const directGate = broadcaster.indexOf(
      "!payoutWorkerBootAllowed()",
      processStart,
    );
    expect(directGate).toBeGreaterThan(processStart);
    expect(firstDatabaseRead).toBeGreaterThan(directGate);
    expect(dispatcher).toMatch(/queue unavailable.*leaving.*untouched/is);
    expect(dispatcher).not.toMatch(/processPayout\s*\(/);
    expect(dispatcher).not.toMatch(/processing.*in-process/is);
  });
});
