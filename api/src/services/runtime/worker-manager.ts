/** runtime/worker-manager.ts — cloud residency for trusted runtimes.
 *
 * The manager reconciles durable runtime lifecycle state into local
 * think-worker processes. Provisioning is deliberately excluded: only an
 * explicit `/start` (or an already-active `running` / `idle` runtime) enrolls
 * a trusted runtime. Stopped, errored, deleted, and merely provisioned rows
 * are parked without a per-runtime polling loop.
 *
 * The dedicated thinker normally runs one reconciler; rolling deployments can
 * overlap two briefly. Cross-machine cycle leases and commit-time fencing in
 * think-worker.ts make that overlap safe. The manager itself never calls an LLM.
 * Doctrine: docs/RUNTIME.md · docs/AUTONOMOUS-MODE.md. */

import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "../../db/client";
import { runtimes } from "../../db/schema/runtime";
import {
  startThinkWorker,
  type ThinkWorkerHandle,
} from "./think-worker";

const DEFAULT_RECONCILE_INTERVAL_MS = 15_000;
const ACTIVE_TRUSTED_STATUSES = ["starting", "running", "idle"];

export interface ManagedTrustedRuntime {
  id: string;
  openingInvitationPending: boolean;
}

export async function discoverActiveTrustedRuntimes(): Promise<
  ManagedTrustedRuntime[]
> {
  const rows = await db
    .select({
      id: runtimes.id,
      openingInvitationPending: runtimes.openingInvitationPending,
    })
    .from(runtimes)
    .where(
      and(
        eq(runtimes.mode, "trusted"),
        inArray(runtimes.status, ACTIVE_TRUSTED_STATUSES),
        isNull(runtimes.deletedAt),
      ),
    );
  return rows;
}

export interface ThinkWorkerManagerOptions {
  reconcileIntervalMs?: number;
  /** Dependency seams keep reconciliation tests hermetic. */
  discoverRuntimes?: () => Promise<readonly ManagedTrustedRuntime[]>;
  startWorker?: (runtimeId: string) => ThinkWorkerHandle;
  onError?: (error: unknown) => void;
}

export interface ThinkWorkerManagerHandle {
  reconcileNow: () => Promise<void>;
  stop: () => Promise<void>;
  workerCount: () => number;
  workerIds: () => string[];
}

export function startThinkWorkerManager(
  options: ThinkWorkerManagerOptions = {},
): ThinkWorkerManagerHandle {
  const intervalMs = Math.max(
    100,
    options.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS,
  );
  const discover =
    options.discoverRuntimes ?? discoverActiveTrustedRuntimes;
  const startWorker = options.startWorker ?? startThinkWorker;
  const onError =
    options.onError ??
    ((error: unknown) => {
      console.warn(
        "[think-worker-manager] reconciliation failed (will retry):",
        error instanceof Error ? error.message : error,
      );
    });

  const workers = new Map<string, ThinkWorkerHandle>();
  let stopped = false;
  let reconcileQueue = Promise.resolve();

  const reconcile = async (): Promise<void> => {
    if (stopped) return;

    // Discovery is all-or-nothing. On a transient DB failure we retain the
    // current worker set rather than interpreting uncertainty as a stop.
    const discovered = await discover();
    if (stopped) return;

    const desired = new Map(
      discovered.map((runtime) => [runtime.id, runtime] as const),
    );

    for (const [runtimeId, runtime] of desired) {
      if (stopped) continue;
      const existing = workers.get(runtimeId);
      if (existing) {
        if (runtime.openingInvitationPending) {
          existing.wake("runtime.start");
        }
        continue;
      }
      try {
        const worker = startWorker(runtimeId);
        workers.set(runtimeId, worker);
        const removeFinished = () => {
          if (workers.get(runtimeId) === worker) workers.delete(runtimeId);
        };
        void worker.done.then(removeFinished, removeFinished);
      } catch (error) {
        onError(error);
      }
    }

    for (const [runtimeId, worker] of workers) {
      if (desired.has(runtimeId)) continue;
      worker.stop();
      workers.delete(runtimeId);
    }
  };

  const reconcileNow = (): Promise<void> => {
    const queued = reconcileQueue.then(reconcile, reconcile);
    reconcileQueue = queued.catch(() => undefined);
    return queued;
  };

  const timer = setInterval(() => {
    void reconcileNow().catch(onError);
  }, intervalMs);
  void reconcileNow().catch(onError);

  return {
    reconcileNow,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      await reconcileQueue;
      const running = [...workers.values()];
      workers.clear();
      for (const worker of running) worker.stop();
      await Promise.allSettled(running.map((worker) => worker.done));
    },
    workerCount: () => workers.size,
    workerIds: () => [...workers.keys()].sort(),
  };
}
