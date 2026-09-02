/** DB pool watchdog — pins the wedged-pool/DB-down distinction.
 *
 *  Regression pin for the 2026-08-31 outage: Supabase's pooler NLB dropped
 *  the backend without RST/FIN, the shared pool held zombie sockets, every
 *  authed route 502'd for hours, and green DB-free health checks meant
 *  nothing self-healed. The watchdog must exit(1) exactly when the pool is
 *  wedged but the database answers a fresh connection — and never when the
 *  database itself is down. All dependencies are injected; no real database,
 *  no real scheduler. */

import { describe, expect, test } from "bun:test";

import {
  DB_POOL_WATCHDOG_DEFAULTS,
  DB_POOL_WATCHDOG_DISABLE_FLAG,
  startDbPoolWatchdog,
  type DbPoolWatchdogScheduler,
  type FreshProbeObservation,
} from "../src/db/pool-watchdog";

interface ManualScheduler extends DbPoolWatchdogScheduler {
  /** Runs the next pending tick to completion; throws if none is queued. */
  runNext(): Promise<void>;
  pendingCount(): number;
  cancelled: number;
}

function manualScheduler(): ManualScheduler {
  const queue: Array<{ id: number; run: () => Promise<void> }> = [];
  let nextId = 0;
  return {
    cancelled: 0,
    schedule(run) {
      const id = nextId++;
      queue.push({ id, run });
      return id;
    },
    cancel(handle) {
      const index = queue.findIndex((entry) => entry.id === handle);
      if (index >= 0) queue.splice(index, 1);
      this.cancelled += 1;
    },
    async runNext() {
      const entry = queue.shift();
      if (!entry) throw new Error("no tick scheduled");
      await entry.run();
    },
    pendingCount() {
      return queue.length;
    },
  };
}

const onFly = { FLY_MACHINE_ID: "fixture-machine" };

function watchdogHarness(overrides: {
  canary: () => Promise<void>;
  freshProbe?: () => Promise<FreshProbeObservation | void>;
  failureThreshold?: number;
  fastFailureThreshold?: number;
  env?: Readonly<Record<string, string | undefined>>;
}) {
  const scheduler = manualScheduler();
  const exits: number[] = [];
  const lines: string[] = [];
  const handle = startDbPoolWatchdog({
    env: overrides.env ?? onFly,
    failureThreshold: overrides.failureThreshold ?? 3,
    // Single-tier unless a test opts into the fast path explicitly.
    fastFailureThreshold:
      overrides.fastFailureThreshold ?? overrides.failureThreshold ?? 3,
    canaryTimeoutMs: 50,
    probeTimeoutMs: 50,
    maxJitterMs: 0,
    canary: overrides.canary,
    freshProbe:
      overrides.freshProbe ??
      (() => Promise.reject(new Error("fresh probe must not run"))),
    exit: (code) => {
      exits.push(code);
    },
    log: (line) => {
      lines.push(line);
    },
    scheduler,
  });
  return { scheduler, exits, lines, handle };
}

describe("db pool watchdog", () => {
  test("a canary success resets the consecutive-failure count", async () => {
    const outcomes = [false, false, true, false, false]; // never 3 in a row
    let call = 0;
    let probes = 0;
    const { scheduler, exits, lines, handle } = watchdogHarness({
      canary: () =>
        outcomes[call++] ? Promise.resolve() : Promise.reject(new Error("wedged")),
      freshProbe: () => {
        probes += 1;
        return Promise.reject(new Error("fresh probe must not run"));
      },
    });

    for (let i = 0; i < outcomes.length; i++) await scheduler.runNext();
    expect(call).toBe(outcomes.length);
    // The probe count is what pins the reset: without it ticks 4 and 5 reach
    // the threshold and the fresh probe runs (its rejection would be silently
    // absorbed as the DB-down branch, leaving exits/pendingCount unchanged).
    expect(probes).toBe(0);
    expect(lines).toEqual([]);
    expect(exits).toEqual([]);
    expect(scheduler.pendingCount()).toBe(1);
    handle.stop();
  });

  test("wedged pool + healthy fresh probe exits once, loudly", async () => {
    let probes = 0;
    const { scheduler, exits, lines, handle } = watchdogHarness({
      canary: () => Promise.reject(new Error("wedged")),
      freshProbe: () => {
        probes += 1;
        return Promise.resolve();
      },
    });

    await scheduler.runNext(); // failure 1
    await scheduler.runNext(); // failure 2
    expect(probes).toBe(0); // below threshold — no fresh probe yet
    expect(exits).toEqual([]);

    await scheduler.runNext(); // failure 3 → probe → exit
    expect(probes).toBe(1);
    expect(exits).toEqual([1]);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("[db-pool-watchdog]");
    expect(lines[0]).toContain("wedged");
    // Injected exit doesn't kill the process — nothing further may run.
    expect(scheduler.pendingCount()).toBe(0);
    handle.stop();
  });

  test("DB down (both fail) never exits and keeps watching", async () => {
    let probes = 0;
    const { scheduler, exits, lines, handle } = watchdogHarness({
      canary: () => Promise.reject(new Error("wedged")),
      freshProbe: () => {
        probes += 1;
        return Promise.reject(new Error("db down"));
      },
    });

    for (let i = 0; i < 5; i++) await scheduler.runNext();
    expect(exits).toEqual([]);
    expect(probes).toBe(3); // ticks 3, 4, 5 — count is retained, not reset
    expect(lines.every((l) => l.includes("database unreachable"))).toBe(true);
    expect(scheduler.pendingCount()).toBe(1); // still watching
    handle.stop();
  });

  test("DB recovery while the pool stays wedged exits on the next cycle", async () => {
    let dbUp = false;
    const { scheduler, exits, handle } = watchdogHarness({
      canary: () => Promise.reject(new Error("wedged")),
      freshProbe: () => (dbUp ? Promise.resolve() : Promise.reject(new Error("down"))),
    });

    for (let i = 0; i < 4; i++) await scheduler.runNext();
    expect(exits).toEqual([]);
    dbUp = true;
    await scheduler.runNext();
    expect(exits).toEqual([1]);
    handle.stop();
  });

  test("off Fly it never schedules", () => {
    const scheduler = manualScheduler();
    const handle = startDbPoolWatchdog({
      env: {},
      canary: () => Promise.resolve(),
      scheduler,
    });
    expect(handle.started).toBe(false);
    expect(scheduler.pendingCount()).toBe(0);
  });

  test("the env off-switch wins even on Fly", () => {
    const scheduler = manualScheduler();
    const handle = startDbPoolWatchdog({
      env: { ...onFly, [DB_POOL_WATCHDOG_DISABLE_FLAG]: "1" },
      canary: () => Promise.resolve(),
      scheduler,
    });
    expect(handle.started).toBe(false);
    expect(scheduler.pendingCount()).toBe(0);
  });

  test("the bounded timeout fails a never-resolving canary", async () => {
    const { scheduler, exits, lines, handle } = watchdogHarness({
      canary: () => new Promise<void>(() => {}), // hangs forever, like the outage
      freshProbe: () => Promise.resolve(),
      failureThreshold: 1,
    });

    await scheduler.runNext(); // resolves only because the 50ms bound fires
    expect(exits).toEqual([1]);
    expect(lines[0]).toContain("[db-pool-watchdog]");
    handle.stop();
  });

  test("wedge signature — no active sessions for this role — exits at the fast threshold", async () => {
    // 2026-08-31 signature: the app holds zombie sockets while pg_stat_activity
    // shows no sessions for the role. Fresh connection fine, pool dead.
    let probes = 0;
    const { scheduler, exits, lines, handle } = watchdogHarness({
      canary: () => Promise.reject(new Error("wedged")),
      freshProbe: () => {
        probes += 1;
        return Promise.resolve({ activeSessions: 0 });
      },
      failureThreshold: 4,
      fastFailureThreshold: 2,
    });

    await scheduler.runNext(); // failure 1 — below the fast threshold
    expect(probes).toBe(0);
    await scheduler.runNext(); // failure 2 → probe → zero sessions → exit
    expect(probes).toBe(1);
    expect(exits).toEqual([1]);
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("no active sessions");
    expect(scheduler.pendingCount()).toBe(0);
    handle.stop();
  });

  test("saturation signature — live sessions — holds the fast path and exits only at the slow budget", async () => {
    // Codex P1 on #396: ten lock-waiting requests can hold every slot for the
    // permitted 120s statement timeout while a fresh SELECT 1 still answers.
    // Every held slot is a live non-idle session, so the count is non-zero
    // and the original time budget must remain the only exit.
    let probes = 0;
    const { scheduler, exits, lines, handle } = watchdogHarness({
      canary: () => Promise.reject(new Error("saturated")),
      freshProbe: () => {
        probes += 1;
        return Promise.resolve({ activeSessions: 10 });
      },
      failureThreshold: 4,
      fastFailureThreshold: 2,
    });

    await scheduler.runNext(); // 1
    await scheduler.runNext(); // 2 → probe → 10 sessions → hold
    await scheduler.runNext(); // 3 → probe → hold
    expect(probes).toBe(2);
    expect(exits).toEqual([]);
    expect(lines.length).toBe(2);
    expect(lines.every((l) => l.includes("slow, not proven wedged"))).toBe(true);
    expect(scheduler.pendingCount()).toBe(1);

    await scheduler.runNext(); // 4 → slow budget → exit regardless of count
    expect(exits).toEqual([1]);
    expect(lines[2]).toContain("exiting for a clean pool");
    handle.stop();
  });

  test("an unknown session count never takes the fast path", async () => {
    // Reachability proven, catalog query unavailable → null → hold.
    const { scheduler, exits, lines, handle } = watchdogHarness({
      canary: () => Promise.reject(new Error("wedged")),
      freshProbe: () => Promise.resolve(), // void: reachability only
      failureThreshold: 4,
      fastFailureThreshold: 2,
    });

    for (let i = 0; i < 3; i++) await scheduler.runNext();
    expect(exits).toEqual([]);
    expect(lines.every((l) => l.includes("an unknown number of"))).toBe(true);
    await scheduler.runNext(); // 4 → slow budget
    expect(exits).toEqual([1]);
    handle.stop();
  });

  test("production defaults: slow budget stays above the permitted statement timeout, fast path near a minute", () => {
    // Minimum time from the first failed canary to a slow-path exit is
    // threshold × canary bound + (threshold − 1) × cycle (no jitter). It must
    // exceed the 120s statement timeout docs/STACK.md permits, or saturation
    // could be restarted as a wedge (Codex P1 on #396).
    const d = DB_POOL_WATCHDOG_DEFAULTS;
    const slowMinMs =
      d.failureThreshold * d.canaryTimeoutMs +
      (d.failureThreshold - 1) * d.intervalMs;
    expect(slowMinMs).toBeGreaterThan(120_000);
    // Fast path worst case: threshold × canary + (threshold − 1) × (cycle +
    // jitter) + the full probe. Bounded so a fleet-wide wedge costs about a
    // minute of failed authed routes, not three.
    const fastMaxMs =
      d.fastFailureThreshold * d.canaryTimeoutMs +
      (d.fastFailureThreshold - 1) * (d.intervalMs + d.maxJitterMs) +
      d.probeTimeoutMs;
    expect(fastMaxMs).toBeLessThanOrEqual(90_000);
    expect(d.fastFailureThreshold).toBeGreaterThanOrEqual(2);
    expect(d.fastFailureThreshold).toBeLessThanOrEqual(d.failureThreshold);
    // The canary bound stays the load-vs-wedge time discriminator (verify-connections.ts).
    expect(d.canaryTimeoutMs).toBe(15_000);
  });

  test("stop cancels the pending tick", async () => {
    const { scheduler, exits, handle } = watchdogHarness({
      canary: () => Promise.resolve(),
    });
    expect(handle.started).toBe(true);
    await scheduler.runNext();
    expect(scheduler.pendingCount()).toBe(1);
    handle.stop();
    expect(scheduler.pendingCount()).toBe(0);
    expect(exits).toEqual([]);
  });
});
