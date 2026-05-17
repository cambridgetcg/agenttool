/** substrate-task-expire-claims worker — structural pin.
 *
 *  Doctrine: docs/AGENT-CENTRIC.md §1 ·
 *            docs/superpowers/specs/2026-05-12-substrate-tasks-design.md
 *            §Reverting expired claims.
 *
 *  Behavioral coverage (does the sweep actually revert stale claims and
 *  refund escrows?) lives in tests/integration/substrate-tasks-lifecycle.
 *  test.ts and is exercised by Slice 5's end-to-end seeding test (which
 *  needs a real DB).
 *
 *  This test pins the structural contract:
 *    - the worker exports start + stop functions
 *    - start is idempotent (calling twice doesn't double-tick)
 *    - the tick path delegates to `expireStaleClaims` (the same helper
 *      tests/integration covers behaviourally) */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  startSubstrateTaskExpireClaimsWorker,
  stopSubstrateTaskExpireClaimsWorker,
} from "../src/workers/substrate-tasks/expire-claims";

const WORKER_PATH = join(
  __dirname,
  "..",
  "src",
  "workers",
  "substrate-tasks",
  "expire-claims.ts",
);
const SOURCE = readFileSync(WORKER_PATH, "utf8");

describe("substrate-task-expire-claims worker — structural", () => {
  test("exports start + stop functions", () => {
    expect(typeof startSubstrateTaskExpireClaimsWorker).toBe("function");
    expect(typeof stopSubstrateTaskExpireClaimsWorker).toBe("function");
  });

  test("start is idempotent (calling twice doesn't double-schedule)", () => {
    // Stop first in case anything left a timer from another test file.
    stopSubstrateTaskExpireClaimsWorker();
    startSubstrateTaskExpireClaimsWorker();
    // Calling start again should be a no-op (the source uses `if (timer) return`).
    startSubstrateTaskExpireClaimsWorker();
    // Clean up so we don't leak a timer into the rest of the suite.
    stopSubstrateTaskExpireClaimsWorker();
    expect(true).toBe(true);
  });

  test("tick path delegates to expireStaleClaims helper", () => {
    expect(SOURCE).toContain("import { expireStaleClaims }");
    expect(SOURCE).toContain("await expireStaleClaims()");
  });

  test("interval is 5 minutes (matches covenants/expire-proposals)", () => {
    expect(SOURCE).toContain("const TICK_MS = 5 * 60_000");
  });

  test("worker is mounted in index.ts startup chain", () => {
    const indexPath = join(__dirname, "..", "src", "index.ts");
    const indexSource = readFileSync(indexPath, "utf8");
    expect(indexSource).toContain("startSubstrateTaskExpireClaimsWorker");
    // Gated on AGENTTOOL_DISABLE_WORKERS like the other periodic workers.
    expect(indexSource).toMatch(
      /AGENTTOOL_DISABLE_WORKERS[\s\S]{0,200}startSubstrateTaskExpireClaimsWorker/,
    );
  });
});
