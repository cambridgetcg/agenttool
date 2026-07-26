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

  test("the global switch overrides payout opt-in without resolving payout config", () => {
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

  test("payout workers repeat the gate and never bypass a missing queue", () => {
    const worker = readFileSync(
      join(API_ROOT, "src/workers/payout/index.ts"),
      "utf8",
    );
    const dispatcher = readFileSync(
      join(API_ROOT, "src/workers/payout/dispatcher.ts"),
      "utf8",
    );

    expect(worker).toMatch(/if \(!payoutWorkerBootAllowed\(\)\)/);
    expect(dispatcher).toMatch(/queue unavailable.*leaving.*untouched/is);
    expect(dispatcher).not.toMatch(/processPayout\s*\(/);
    expect(dispatcher).not.toMatch(/processing.*in-process/is);
  });
});
