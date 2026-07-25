/** Payout-confirm worker — periodic poll of 'broadcast' rows. Calls
 *  the chain's receipt endpoint per row; flips to 'confirmed' once the
 *  threshold is met, or 'failed' + refund on revert.
 *
 *  Pattern: setInterval (not BullMQ) because the work is a pure DB+RPC
 *  scan with no per-job state. Multi-instance safe — concurrent ticks just
 *  redundantly poll; the DB updates are idempotent (CAS via status check).
 *
 *  Doctrine: docs/PAYOUT-BROADCAST-PLAN.md (Slices 2+3). */

import { and, eq } from "drizzle-orm";
import type { Hex } from "viem";

import { db } from "../../db/client";
import { cryptoPayouts } from "../../db/schema/economy";
import {
  isEvmChain,
  type EvmChain,
} from "../../services/economy/crypto/chains";
import { confirmTx } from "../../services/economy/crypto/sign-evm";
import { confirmSolanaTx } from "../../services/economy/crypto/sign-solana";
import { EVM_CONFIRMATION_THRESHOLDS } from "../../services/economy/crypto/network";
import { refundPayoutAndFail } from "./refund";

const POLL_INTERVAL_MS = 30_000;
const POLL_BATCH_SIZE = 50;

let interval: ReturnType<typeof setInterval> | null = null;

type Row = typeof cryptoPayouts.$inferSelect;

/** Atomic refund + status='failed', gated on CAS so concurrent confirmers
 *  can't double-refund. */
async function refundAndFail(row: Row, errReason: string) {
  const result = await db.transaction((tx) =>
    refundPayoutAndFail(tx, row, "broadcast", errReason),
  );
  return result.refunded ? result.refundMinor : null;
}

async function confirmEvmRow(row: Row) {
  if (!row.txHash) return;
  const chain = row.chain as EvmChain;
  const threshold = EVM_CONFIRMATION_THRESHOLDS[chain];

  const result = await confirmTx(chain, row.txHash as Hex, threshold);
  if (result.status === "confirmed") {
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
    const refundMinor = await refundAndFail(row, "tx_reverted_onchain");
    if (refundMinor !== null) {
      console.warn(
        `[payout-confirm] ${row.id}: reverted on-chain (${chain}); refunded ${refundMinor} pence`,
      );
    }
  }
  // 'pending' → leave for next tick.
}

async function confirmSolanaRow(row: Row) {
  if (!row.txHash) return;

  const result = await confirmSolanaTx(row.txHash);
  if (result.status === "confirmed") {
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
      `[payout-confirm] ${row.id}: confirmed at slot ${result.slot} (solana)`,
    );
  } else if (result.status === "reverted") {
    const refundMinor = await refundAndFail(row, "tx_reverted_onchain");
    if (refundMinor !== null) {
      console.warn(
        `[payout-confirm] ${row.id}: reverted on-chain (solana); refunded ${refundMinor} pence`,
      );
    }
  }
  // 'pending' → leave for next tick.
}

async function tick() {
  const broadcast = await db
    .select()
    .from(cryptoPayouts)
    .where(eq(cryptoPayouts.status, "broadcast"))
    .limit(POLL_BATCH_SIZE);

  if (broadcast.length === 0) return;

  for (const row of broadcast) {
    if (!row.txHash) continue;

    try {
      if (isEvmChain(row.chain)) {
        await confirmEvmRow(row);
      } else if (row.chain === "solana") {
        await confirmSolanaRow(row);
      }
      // unknown chain → leave for ops to investigate.
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
