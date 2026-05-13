/** Payout-broadcast BullMQ queue.
 *
 *  Producer: `dispatcher.ts` (cron poll → enqueue).
 *  Consumer: `broadcast-worker.ts` (sign + submit).
 *  Job-id deduplication via the payout's UUID prevents double-processing
 *  when the dispatcher fires multiple times before a job completes.
 *
 *  Doctrine: docs/PAYOUT-BROADCAST-PLAN.md (Slice 1).
 *
 *  @enforces urn:agenttool:wall/payouts-never-auto-retry
 *    Canonical defender. `attempts: 1` on defaultJobOptions disables
 *    BullMQ-level retry; no `backoff` config means even a future
 *    attempts > 1 wouldn't activate retry-with-delay. The wall composes
 *    with broadcast-worker.ts (no re-enqueue on failure) + dispatcher.ts
 *    (status='requested' filter blocks re-dispatch of terminal rows).
 *    Tested: api/tests/doctrine/wall-payouts-never-auto-retry.test.ts */

import { Queue } from "bullmq";

import {
  REDIS_DISABLED,
  redisConnection,
} from "../../services/tools/queue/connection";

export interface PayoutBroadcastJobData {
  payoutId: string;
}

/** null when AGENTTOOL_DISABLE_WORKERS=1 (or no Redis). The dispatcher and
 *  worker both bail cleanly in that case. */
export const payoutBroadcastQueue: Queue<PayoutBroadcastJobData> | null =
  REDIS_DISABLED || !redisConnection
    ? null
    : new Queue<PayoutBroadcastJobData>("payout-broadcast", {
        connection: redisConnection,
        defaultJobOptions: {
          // Doctrine wall: NO automatic retries. A failed broadcast that
          // emitted a tx hash MUST NOT retry — first might still land →
          // double-spend. The worker handles its own classification.
          attempts: 1,
          removeOnComplete: { age: 3600 },
          removeOnFail: { age: 86400 * 7 }, // keep failures 7d for forensics
        },
      });
