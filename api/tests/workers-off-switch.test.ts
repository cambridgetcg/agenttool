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
});
