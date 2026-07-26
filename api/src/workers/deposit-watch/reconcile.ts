/**
 * Bounded durable deposit-watch reconciliation worker.
 *
 * Construction is explicit because the provider reconciler owns external
 * access and credentials. This module never discovers credentials, starts at
 * import time, or treats provider mutation acceptance as observed readiness.
 */

import {
  runDepositWatchReconciliationBatch,
  type DepositWatchBatchResult,
  type DepositWatchProviderReconciler,
  type DepositWatchStore,
} from "../../services/economy/crypto/deposit-watch";

export interface DepositWatchWorker {
  runOnce(): Promise<DepositWatchBatchResult>;
  start(): void;
  stop(): void;
  isRunning(): boolean;
}

export function createDepositWatchWorker(options: {
  owner: string;
  reconciler: DepositWatchProviderReconciler;
  store?: DepositWatchStore;
  intervalMs?: number;
  limit?: number;
  leaseMs?: number;
  providerTimeoutMs?: number;
  now?: () => Date;
}): DepositWatchWorker {
  const intervalMs = options.intervalMs ?? 30_000;
  if (
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < 1_000 ||
    intervalMs > 60 * 60_000
  ) {
    throw new TypeError(
      "Deposit-watch worker interval must be an integer from 1 second to 1 hour.",
    );
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<DepositWatchBatchResult> | null = null;

  const runOnce = (): Promise<DepositWatchBatchResult> => {
    if (inFlight) return inFlight;
    inFlight = runDepositWatchReconciliationBatch({
      owner: options.owner,
      reconciler: options.reconciler,
      ...(options.store ? { store: options.store } : {}),
      ...(options.limit === undefined ? {} : { limit: options.limit }),
      ...(options.leaseMs === undefined ? {} : { leaseMs: options.leaseMs }),
      ...(options.providerTimeoutMs === undefined
        ? {}
        : { providerTimeoutMs: options.providerTimeoutMs }),
      ...(options.now ? { now: options.now } : {}),
    }).finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  const scheduledTick = (): void => {
    // Fixed, sanitized diagnostic only. Provider bodies, exception messages,
    // and credentials are never emitted by this worker.
    void runOnce().catch(() => {
      console.warn("[deposit-watch-reconcile] tick_failed");
    });
  };

  return {
    runOnce,
    start(): void {
      if (timer) return;
      timer = setInterval(scheduledTick, intervalMs);
      scheduledTick();
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
    isRunning(): boolean {
      return timer !== null;
    },
  };
}
