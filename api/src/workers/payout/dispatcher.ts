/** Payout dispatcher — cron poll that finds 'requested' payouts and enqueues
 *  broadcast jobs. BullMQ's `jobId` deduplication (keyed on the payout UUID)
 *  prevents double-enqueue when the worker is still processing a row from a
 *  previous tick.
 *
 *  When Redis is absent (REDIS_DISABLED=1 or no connection), the queue is
 *  null; we fall through to in-process serial processing — calling
 *  `processPayout(id)` directly. Useful for dev environments without Redis;
 *  single-instance only (multi-instance in-process risks nonce collisions
 *  on the same source address).
 *
 *  Doctrine: docs/PAYOUT-BROADCAST-PLAN.md (Slices 1+3). */

import { and, eq, inArray } from "drizzle-orm";

import { db } from "../../db/client";
import { cryptoPayouts } from "../../db/schema/economy";
import { ALL_CHAINS } from "../../services/economy/crypto/chains";
import { processPayout } from "./broadcast-worker";
import { payoutBroadcastQueue } from "./queue";

const POLL_INTERVAL_MS = 10_000;
const BATCH_SIZE = 50;

let interval: ReturnType<typeof setInterval> | null = null;

// Serialize in-process work so overlapping ticks don't double-process the
// same row or race on nonces. Single Promise chain — every tick awaits the
// previous one before starting its batch.
let inProcessMutex: Promise<void> = Promise.resolve();

async function tick() {
  const requested = await db
    .select({ id: cryptoPayouts.id })
    .from(cryptoPayouts)
    .where(
      and(
        eq(cryptoPayouts.status, "requested"),
        inArray(cryptoPayouts.chain, ALL_CHAINS as readonly string[] as string[]),
      ),
    )
    .limit(BATCH_SIZE);

  if (requested.length === 0) return;

  if (payoutBroadcastQueue) {
    for (const row of requested) {
      await payoutBroadcastQueue.add(
        "broadcast",
        { payoutId: row.id },
        { jobId: row.id }, // idempotent: re-add of same id is a no-op
      );
    }
    console.log(
      `[payout-dispatcher] enqueued ${requested.length} broadcast job(s)`,
    );
    return;
  }

  // Redis absent — process in-process serially.
  console.log(
    `[payout-dispatcher] no Redis — processing ${requested.length} job(s) in-process`,
  );
  inProcessMutex = inProcessMutex.then(async () => {
    for (const row of requested) {
      try {
        await processPayout(row.id);
      } catch (err) {
        console.error(
          `[payout-dispatcher] in-process processPayout(${row.id}) failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  });
  await inProcessMutex;
}

export function startPayoutDispatcher() {
  if (interval) return;
  interval = setInterval(() => {
    tick().catch((err) => {
      console.error("[payout-dispatcher] tick error:", err);
    });
  }, POLL_INTERVAL_MS);
  console.log(`💸 payout dispatcher started (poll ${POLL_INTERVAL_MS}ms)`);
}

export function stopPayoutDispatcher() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
