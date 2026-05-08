/** Payout-confirm worker — periodic poll of 'broadcast' rows. Calls
 *  `eth_getTransactionReceipt` per row; flips to 'confirmed' once the
 *  threshold is met, or 'failed' + refund on revert.
 *
 *  Pattern: setInterval (not BullMQ) because the work is a pure DB+RPC
 *  scan with no per-job state. Multi-instance safe — concurrent ticks just
 *  redundantly poll; the DB updates are idempotent (CAS via status check).
 *
 *  Doctrine: docs/PAYOUT-BROADCAST-PLAN.md (Slice 2). */

import { and, eq, sql } from "drizzle-orm";
import type { Hex } from "viem";

import { db } from "../../db/client";
import { cryptoPayouts, wallets } from "../../db/schema/economy";
import {
  CREDITS_PER_USDC,
  isEvmChain,
  type EvmChain,
} from "../../services/economy/crypto/chains";
import { confirmTx } from "../../services/economy/crypto/sign-evm";
import { EVM_CONFIRMATION_THRESHOLDS } from "../../services/economy/crypto/network";

const POLL_INTERVAL_MS = 30_000;
const POLL_BATCH_SIZE = 50;

let interval: ReturnType<typeof setInterval> | null = null;

function creditsForAmount(amountBase: string): number {
  const amountUsdc = Number(amountBase) / 1_000_000;
  return Math.ceil(amountUsdc * CREDITS_PER_USDC);
}

async function tick() {
  const broadcast = await db
    .select()
    .from(cryptoPayouts)
    .where(eq(cryptoPayouts.status, "broadcast"))
    .limit(POLL_BATCH_SIZE);

  if (broadcast.length === 0) return;

  for (const row of broadcast) {
    if (!row.txHash || !isEvmChain(row.chain)) continue;
    const chain = row.chain as EvmChain;
    const threshold = EVM_CONFIRMATION_THRESHOLDS[chain];

    try {
      const result = await confirmTx(chain, row.txHash as Hex, threshold);
      if (result.status === "confirmed") {
        // CAS on status='broadcast' so a racing cancel/edit can't be
        // overwritten (defensive — cancel is gated on 'requested', not
        // 'broadcast', but the pattern keeps the worker idempotent).
        await db
          .update(cryptoPayouts)
          .set({ status: "confirmed", confirmedAt: new Date() })
          .where(
            and(
              eq(cryptoPayouts.id, row.id),
              eq(cryptoPayouts.status, "broadcast"),
            ),
          );
        console.log(
          `[payout-confirm] ${row.id}: confirmed at block ${result.blockNumber} (${chain})`,
        );
      } else if (result.status === "reverted") {
        // Tx hit-chain but execution reverted. Refund.
        const credits = creditsForAmount(row.amountBase as string);
        await db.transaction(async (tx) => {
          // CAS again — only refund if still 'broadcast'.
          const updated = await tx
            .update(cryptoPayouts)
            .set({ status: "failed", error: "tx_reverted_onchain" })
            .where(
              and(
                eq(cryptoPayouts.id, row.id),
                eq(cryptoPayouts.status, "broadcast"),
              ),
            )
            .returning({ id: cryptoPayouts.id });
          if (updated.length === 0) return; // raced
          await tx
            .update(wallets)
            .set({ balance: sql`balance + ${credits}` })
            .where(eq(wallets.id, row.walletId));
        });
        console.warn(
          `[payout-confirm] ${row.id}: reverted on-chain (${chain}); refunded ${credits} credits`,
        );
      }
      // 'pending' → leave for next tick.
    } catch (err) {
      console.error(
        `[payout-confirm] ${row.id}: error during confirm:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

export function startPayoutConfirmWorker() {
  if (interval) return;
  interval = setInterval(() => {
    tick().catch((err) => {
      console.error("[payout-confirm] tick error:", err);
    });
  }, POLL_INTERVAL_MS);
  console.log(`💸 payout confirm worker started (poll ${POLL_INTERVAL_MS}ms)`);
}

export function stopPayoutConfirmWorker() {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
