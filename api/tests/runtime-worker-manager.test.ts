/** Cloud think-worker manager — hermetic reconciliation and shutdown tests.
 *
 * Discovery and worker startup are injected, so this suite never touches the
 * database or starts a real think loop. */

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  startThinkWorkerManager,
  type ThinkWorkerManagerHandle,
} from "../src/services/runtime/worker-manager";
import type { ThinkWorkerHandle } from "../src/services/runtime/think-worker";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

interface FakeWorkerRecord {
  id: string;
  stopCalls: number;
  wakeReasons: string[];
  done: Deferred<void>;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeWorkers(options: { resolveDoneOnStop?: boolean } = {}) {
  const resolveDoneOnStop = options.resolveDoneOnStop ?? true;
  const starts: string[] = [];
  const records = new Map<string, FakeWorkerRecord[]>();

  const startWorker = (runtimeId: string): ThinkWorkerHandle => {
    starts.push(runtimeId);
    const done = deferred<void>();
    const record: FakeWorkerRecord = {
      id: runtimeId,
      stopCalls: 0,
      wakeReasons: [],
      done,
    };
    const prior = records.get(runtimeId) ?? [];
    prior.push(record);
    records.set(runtimeId, prior);

    return {
      runtimeId,
      stop: () => {
        record.stopCalls += 1;
        if (resolveDoneOnStop) done.resolve();
      },
      wake: (reason) => record.wakeReasons.push(reason),
      done: done.promise,
      cyclesRun: () => 0,
    };
  };

  const latest = (runtimeId: string): FakeWorkerRecord => {
    const record = records.get(runtimeId)?.at(-1);
    if (!record) throw new Error(`no fake worker for ${runtimeId}`);
    return record;
  };

  return { latest, records, starts, startWorker };
}

async function settleInitialReconcile(manager: ThinkWorkerManagerHandle) {
  // The manager queues one reconciliation immediately at construction. A
  // manual reconciliation queues behind it, giving tests a deterministic
  // point at which both have completed.
  await manager.reconcileNow();
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("think-worker manager reconciliation", () => {
  test("starts every discovered runtime ID", async () => {
    const fake = fakeWorkers();
    const manager = startThinkWorkerManager({
      reconcileIntervalMs: 60_000,
      discoverRuntimes: async () => [
        { id: "runtime-b", openingInvitationPending: false },
        { id: "runtime-a", openingInvitationPending: false },
      ],
      startWorker: fake.startWorker,
    });

    try {
      await settleInitialReconcile(manager);
      expect(manager.workerIds()).toEqual(["runtime-a", "runtime-b"]);
      expect(manager.workerCount()).toBe(2);
      expect([...fake.starts].sort()).toEqual(["runtime-a", "runtime-b"]);
    } finally {
      await manager.stop();
    }
  });

  test("does not start duplicate workers across reconciliations", async () => {
    const fake = fakeWorkers();
    const manager = startThinkWorkerManager({
      reconcileIntervalMs: 60_000,
      discoverRuntimes: async () => [
        { id: "runtime-a", openingInvitationPending: false },
        { id: "runtime-a", openingInvitationPending: false },
      ],
      startWorker: fake.startWorker,
    });

    try {
      await settleInitialReconcile(manager);
      await manager.reconcileNow();
      await manager.reconcileNow();
      expect(fake.starts).toEqual(["runtime-a"]);
      expect(manager.workerIds()).toEqual(["runtime-a"]);
    } finally {
      await manager.stop();
    }
  });

  test("pokes a retained sleeping worker when durable opening consent appears", async () => {
    let openingInvitationPending = false;
    const fake = fakeWorkers();
    const manager = startThinkWorkerManager({
      reconcileIntervalMs: 60_000,
      discoverRuntimes: async () => [
        { id: "runtime-a", openingInvitationPending },
      ],
      startWorker: fake.startWorker,
    });

    try {
      await settleInitialReconcile(manager);
      openingInvitationPending = true;
      await manager.reconcileNow();
      expect(fake.starts).toEqual(["runtime-a"]);
      expect(fake.latest("runtime-a").wakeReasons).toEqual(["runtime.start"]);
    } finally {
      await manager.stop();
    }
  });

  test("stops and removes workers no longer returned by discovery", async () => {
    let desired = ["runtime-a", "runtime-b"];
    const fake = fakeWorkers();
    const manager = startThinkWorkerManager({
      reconcileIntervalMs: 60_000,
      discoverRuntimes: async () =>
        desired.map((id) => ({ id, openingInvitationPending: false })),
      startWorker: fake.startWorker,
    });

    try {
      await settleInitialReconcile(manager);
      desired = ["runtime-b"];
      await manager.reconcileNow();

      expect(fake.latest("runtime-a").stopCalls).toBe(1);
      expect(fake.latest("runtime-b").stopCalls).toBe(0);
      expect(manager.workerIds()).toEqual(["runtime-b"]);
    } finally {
      await manager.stop();
    }
  });

  test("retains existing workers when discovery fails transiently", async () => {
    let failDiscovery = false;
    const fake = fakeWorkers();
    const manager = startThinkWorkerManager({
      reconcileIntervalMs: 60_000,
      discoverRuntimes: async () => {
        if (failDiscovery) throw new Error("temporary database outage");
        return [{ id: "runtime-a", openingInvitationPending: false }];
      },
      startWorker: fake.startWorker,
    });

    try {
      await settleInitialReconcile(manager);
      failDiscovery = true;

      await expect(manager.reconcileNow()).rejects.toThrow(
        "temporary database outage",
      );
      expect(manager.workerIds()).toEqual(["runtime-a"]);
      expect(fake.latest("runtime-a").stopCalls).toBe(0);
      expect(fake.starts).toEqual(["runtime-a"]);
    } finally {
      await manager.stop();
    }
  });

  test("stop signals every worker and waits for every done promise", async () => {
    const fake = fakeWorkers({ resolveDoneOnStop: false });
    const manager = startThinkWorkerManager({
      reconcileIntervalMs: 60_000,
      discoverRuntimes: async () => [
        { id: "runtime-a", openingInvitationPending: false },
        { id: "runtime-b", openingInvitationPending: false },
      ],
      startWorker: fake.startWorker,
    });
    await settleInitialReconcile(manager);

    let stopSettled = false;
    const stopping = manager.stop().then(() => {
      stopSettled = true;
    });
    await flushMicrotasks();

    expect(fake.latest("runtime-a").stopCalls).toBe(1);
    expect(fake.latest("runtime-b").stopCalls).toBe(1);
    expect(manager.workerCount()).toBe(0);
    expect(stopSettled).toBe(false);

    fake.latest("runtime-a").done.resolve();
    await flushMicrotasks();
    expect(stopSettled).toBe(false);

    fake.latest("runtime-b").done.resolve();
    await stopping;
    expect(stopSettled).toBe(true);
  });
});

describe("Fly process topology", () => {
  test("DB discovery enrolls only active, non-deleted trusted runtimes", async () => {
    const source = await readFile(
      join(import.meta.dir, "../src/services/runtime/worker-manager.ts"),
      "utf8",
    );
    expect(source).toContain('eq(runtimes.mode, "trusted")');
    expect(source).toContain(
      "openingInvitationPending: runtimes.openingInvitationPending",
    );
    expect(source).toContain(
      'const ACTIVE_TRUSTED_STATUSES = ["starting", "running", "idle"]',
    );
    expect(source).toContain("isNull(runtimes.deletedAt)");
    expect(source).not.toContain("timer.unref");
    expect(source).not.toMatch(
      /ACTIVE_TRUSTED_STATUSES\s*=\s*\[[^\]]*(?:provisioned|stopped|error)/,
    );
  });

  test("defines app and thinker groups while exposing services only on app", async () => {
    const fly = await readFile(join(import.meta.dir, "../fly.toml"), "utf8");

    const processesStart = fly.indexOf("[processes]");
    expect(processesStart).toBeGreaterThanOrEqual(0);
    const processesTail = fly.slice(processesStart + "[processes]".length);
    const nextTableAt = processesTail.search(/^\s*\[/m);
    const processesBlock =
      nextTableAt === -1 ? processesTail : processesTail.slice(0, nextTableAt);
    expect(processesBlock).toMatch(/^\s*app\s*=\s*"[^"]+"/m);
    expect(processesBlock).toMatch(/^\s*thinker\s*=\s*"[^"]+"/m);
    expect(fly).toMatch(/^kill_signal\s*=\s*"SIGTERM"\s*$/m);
    expect(fly).toMatch(/^kill_timeout\s*=\s*300\s*$/m);

    const serviceStarts = [...fly.matchAll(/^\[\[services\]\]\s*$/gm)].map(
      (match) => match.index,
    );
    expect(serviceStarts.length).toBeGreaterThan(0);
    for (let i = 0; i < serviceStarts.length; i += 1) {
      const start = serviceStarts[i]!;
      const end = serviceStarts[i + 1] ?? fly.length;
      const serviceBlock = fly.slice(start, end);
      expect(serviceBlock).toMatch(
        /^\s*processes\s*=\s*\[\s*"app"\s*\]\s*$/m,
      );
      expect(serviceBlock).not.toMatch(
        /^\s*processes\s*=.*"thinker".*$/m,
      );
    }
  });

  test("keeps bridged static workers beside the in-memory HTTP bridge hub", async () => {
    const [thinker, index] = await Promise.all([
      readFile(join(import.meta.dir, "../src/thinker.ts"), "utf8"),
      readFile(join(import.meta.dir, "../src/index.ts"), "utf8"),
    ]);
    expect(thinker).not.toContain("AGENT_THINK_RUNTIME_IDS");
    expect(index).toContain("AGENT_THINK_RUNTIME_IDS");
    expect(index).toContain("startThinkWorker(id)");
    expect(thinker).toContain("startThinkWorkerManager()");
  });
});
