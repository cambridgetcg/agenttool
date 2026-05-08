/** Payout dispatcher — cron poll that finds 'requested' EVM payouts and
 *  enqueues broadcast jobs. BullMQ's `jobId` deduplication (keyed on the
 *  payout UUID) prevents double-enqueue when the worker is still processing
 *  a row from a previous tick.
 *
 *  Solana payouts are intentionally NOT enqueued here — they wait for
 *  Slice 3 to land a Solana broadcast worker.
 *
 *  Doctrine: docs/PAYOUT-BROADCAST-PLAN.md (Slice 1). */

import { and, eq, inArray } from "drizzle-orm";

import { db } from "../../db/client";
import { cryptoPayouts } from "../../db/schema/economy";
import { EVM_CHAINS } from "../../services/economy/crypto/chains";
import { payoutBroadcastQueue } from "./queue";

const POLL_INTERVAL_MS = 10_000;
const BATCH_SIZE = 50;

let interval: ReturnType<typeof setInterval> | null = null;

async function tick() {
  if (!payoutBroadcastQueue) return;

  const requested = await db
    .select({ id: cryptoPayouts.id })
    .from(cryptoPayouts)
    .where(
      and(
        eq(cryptoPayouts.status, "requested"),
        inArray(cryptoPayouts.chain, EVM_CHAINS as readonly string[] as string[]),
      ),
    )
    .limit(BATCH_SIZE);

  if (requested.length === 0) return;

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
