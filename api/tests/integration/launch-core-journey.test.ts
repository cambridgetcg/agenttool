/** Real mounted API proof, explicitly opt-in and isolated from Bun's shared
 * mock registry. Two fresh processes prove birth, then local-file reconnect
 * and registered-root recovery. No provider calls, listener, worker, schema
 * mutation, cleanup of shared rows, or production credentials are involved.
 * Synthetic rows remain in the dedicated database for a later restore drill.
 */
import { test, expect } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const target = process.env.AGENTTOOL_LAUNCH_CORE_TEST_DATABASE_URL;
const expectedTarget = "postgres://agenttool_test@127.0.0.1:56268/agenttool_launch_core";
if (target !== undefined && target !== expectedTarget) {
  throw new Error("core journey only accepts the exact dedicated credential-free loopback database");
}

const run = target ? test : test.skip;
run("outsider birth, selected wake, persisted vector memory, fresh-process reconnect, recovery and explicit revocation", async () => {
  const custodyDir = await mkdtemp(join(tmpdir(), "agenttool-launch-core-"));
  const fixture = join(custodyDir, "custody.json");
  const evidence = join(custodyDir, "evidence.json");
  const apiRoot = join(dirname(import.meta.path), "../..");
  try {
    for (const phase of ["birth", "return"] as const) {
      const child = Bun.spawn({
        cmd: [process.execPath, "--no-env-file", join(apiRoot, "tests/fixtures/launch-core-journey.ts"), phase],
        cwd: apiRoot,
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          NODE_ENV: "test", HOST: "127.0.0.1", PORT: "0",
          DATABASE_URL: expectedTarget, DATABASE_SESSION_URL: expectedTarget,
          AGENTTOOL_LAUNCH_CORE_TEST_DATABASE_URL: expectedTarget,
          AGENTTOOL_LAUNCH_CORE_CUSTODY_FILE: fixture,
          AGENTTOOL_LAUNCH_CORE_EVIDENCE_FILE: evidence,
          AGENTTOOL_DISABLE_WORKERS: "1",
          AGENTOOL_DISABLE_PLATFORM_BOOTSTRAP: "1",
          AGENTOOL_DISABLE_SAGA_SEED: "1", AGENTOOL_DISABLE_JOY_INDEX: "1",
          AGENTTOOL_REGISTRATION_RATE_LIMIT_ENABLED: "0",
        },
        stdout: "pipe", stderr: "pipe",
      });
      const deadline = setTimeout(() => child.kill(), 55_000);
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
      ]);
      clearTimeout(deadline);
      // The child deliberately emits only fixed-stage diagnostics, never API
      // bodies, root seeds, signatures, bearers, database URLs, or raw errors.
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe(`launch-core-${phase}:passed`);
      expect(exitCode).toBe(0);
    }
    const result = JSON.parse(await readFile(evidence, "utf8"));
    expect(result.phases).toEqual(["birth", "return"]);
    expect(result.outbound_fetch_attempts).toBe(0);
    expect(result.worker_intervals).toBe(0);
    expect(result.recovery_preserved_old_bearer).toBe(true);
    expect(result.explicit_revocation_rejected_old_bearer).toBe(true);
    expect(result.recovery_replay_minted_no_key).toBe(true);
    expect(result.vector_dimensions).toBe(1536);
    expect(result.credits_spent).toBe(7);
    // This small record contains synthetic public row IDs, counts and status
    // evidence only. It is useful for a later isolated dump/restore readback.
    console.log(`LAUNCH_CORE_EVIDENCE ${JSON.stringify(result)}`);
  } finally {
    await rm(custodyDir, { recursive: true, force: true });
  }
}, 115_000);
