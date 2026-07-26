/** Payout-confirm worker — periodic poll of 'broadcast' rows. Calls
 *  the chain's receipt endpoint per row; flips to 'confirmed' once the
 *  threshold is met, or 'failed' + refund on revert.
 *
 *  Pattern: setInterval (not BullMQ) because the work is a pure DB+RPC scan
 *  with no per-job state. Each process is single-flight, rows are ordered by
 *  least-recent check, and one batch uses bounded concurrency. Multi-instance
 *  polling can duplicate reads; status-CAS keeps economic effects idempotent.
 *
 *  Doctrine: docs/PAYOUT-BROADCAST-PLAN.md (Slices 2+3). */

import { and, eq, isNull, sql } from "drizzle-orm";
import type { Hex } from "viem";

import { db } from "../../db/client";
import { cryptoPayouts } from "../../db/schema/economy";
import {
  isEvmChain,
  type EvmChain,
} from "../../services/economy/crypto/chains";
import { confirmTx } from "../../services/economy/crypto/sign-evm";
import { confirmSolanaTx } from "../../services/economy/crypto/sign-solana";
import {
  activeNetwork,
  EVM_CONFIRMATION_THRESHOLDS,
} from "../../services/economy/crypto/network";
import { refundPayoutAndFail } from "../../services/economy/crypto/payout-refund";

const POLL_INTERVAL_MS = 30_000;
const POLL_BATCH_SIZE = 50;
const POLL_CONCURRENCY = 5;
const RPC_TIMEOUT_MS = 10_000;

let interval: ReturnType<typeof setInterval> | null = null;
let batchInFlight: Promise<void> | null = null;

type Row = typeof cryptoPayouts.$inferSelect;

/** Atomic refund + status='failed', gated on CAS so concurrent confirmers
 *  can't double-refund. */
async function refundAndFail(row: Row, errReason: string) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(cryptoPayouts)
      .where(eq(cryptoPayouts.id, row.id))
      .for("update")
      .limit(1);
    if (
      !current ||
      current.status !== "broadcast" ||
      current.txHash !== row.txHash ||
      current.network !== row.network ||
      current.network !== activeNetwork()
    ) {
      return {
        refunded: false,
        reason: "status_race_lost",
        terminal: false,
      } as const;
    }
    return refundPayoutAndFail(tx, current, "broadcast", errReason);
  });
}

async function markChecked(
  row: Row,
  evidenceError?: string | null,
): Promise<void> {
  if (!row.network) return;
  const txIdentity =
    row.txHash === null
      ? isNull(cryptoPayouts.txHash)
      : eq(cryptoPayouts.txHash, row.txHash);
  await db
    .update(cryptoPayouts)
    .set({
      lastCheckedAt: new Date(),
      ...(evidenceError === undefined ? {} : { error: evidenceError }),
    })
    .where(
      and(
        eq(cryptoPayouts.id, row.id),
        eq(cryptoPayouts.status, "broadcast"),
        eq(cryptoPayouts.network, row.network),
        txIdentity,
      ),
    );
}

async function confirmEvmRow(row: Row) {
  if (!row.txHash) return;
  const chain = row.chain as EvmChain;
  const threshold = EVM_CONFIRMATION_THRESHOLDS[chain];

  const result = await confirmTx(
    chain,
    row.txHash as Hex,
    threshold,
    RPC_TIMEOUT_MS,
  );
  if (result.status === "confirmed") {
    const updated = await db
      .update(cryptoPayouts)
      .set({
        status: "confirmed",
        confirmedAt: new Date(),
        lastCheckedAt: new Date(),
        error: null,
      })
      .where(
        and(
          eq(cryptoPayouts.id, row.id),
          eq(cryptoPayouts.status, "broadcast"),
          eq(cryptoPayouts.network, row.network!),
          eq(cryptoPayouts.txHash, row.txHash),
        ),
      )
      .returning({ id: cryptoPayouts.id });
    if (updated.length === 0) return;
    console.log(
      `[payout-confirm] ${row.id}: confirmed at block ${result.blockNumber} (${chain})`,
    );
  } else if (result.status === "reverted") {
    const reversal = await refundAndFail(row, "tx_reverted_onchain");
    if (reversal.refunded) {
      console.warn(
        `[payout-confirm] ${row.id}: reverted on-chain (${chain}); refunded ${reversal.refundMinor} pence`,
      );
    } else if (
      reversal.reason === "ledger_unreconciled" &&
      reversal.terminal
    ) {
      console.error(
        `[payout-confirm] ${row.id}: finalized revert (${chain}) but refund ledger is unreconciled; manual review required`,
      );
    }
  } else {
    await markChecked(row, result.evidenceError ?? null);
  }
}

async function confirmSolanaRow(row: Row) {
  if (!row.txHash) return;

  const result = await confirmSolanaTx(row.txHash, RPC_TIMEOUT_MS);
  if (result.status === "confirmed") {
    const updated = await db
      .update(cryptoPayouts)
      .set({
        status: "confirmed",
        confirmedAt: new Date(),
        lastCheckedAt: new Date(),
        error: null,
      })
      .where(
        and(
          eq(cryptoPayouts.id, row.id),
          eq(cryptoPayouts.status, "broadcast"),
          eq(cryptoPayouts.network, row.network!),
          eq(cryptoPayouts.txHash, row.txHash),
        ),
      )
      .returning({ id: cryptoPayouts.id });
    if (updated.length === 0) return;
    console.log(
      `[payout-confirm] ${row.id}: confirmed at slot ${result.slot} (solana)`,
    );
  } else if (result.status === "reverted") {
    const reversal = await refundAndFail(row, "tx_reverted_onchain");
    if (reversal.refunded) {
      console.warn(
        `[payout-confirm] ${row.id}: reverted on-chain (solana); refunded ${reversal.refundMinor} pence`,
      );
    } else if (
      reversal.reason === "ledger_unreconciled" &&
      reversal.terminal
    ) {
      console.error(
        `[payout-confirm] ${row.id}: finalized revert (solana) but refund ledger is unreconciled; manual review required`,
      );
    }
  } else {
    await markChecked(row, null);
  }
}

async function confirmBatchOnce(): Promise<void> {
  const network = activeNetwork();
  const broadcast = await db
    .select()
    .from(cryptoPayouts)
    .where(
      and(
        eq(cryptoPayouts.status, "broadcast"),
        eq(cryptoPayouts.network, network),
      ),
    )
    .orderBy(
      sql`${cryptoPayouts.lastCheckedAt} ASC NULLS FIRST`,
      cryptoPayouts.requestedAt,
    )
    .limit(POLL_BATCH_SIZE);

  if (broadcast.length === 0) return;

  let cursor = 0;
  const consumers = Array.from(
    { length: Math.min(POLL_CONCURRENCY, broadcast.length) },
    async () => {
      while (cursor < broadcast.length) {
        const row = broadcast[cursor++];
        if (!row) return;
        try {
          if (!row.txHash) {
            await markChecked(row);
          } else if (isEvmChain(row.chain)) {
            await confirmEvmRow(row);
          } else if (row.chain === "solana") {
            await confirmSolanaRow(row);
          } else {
            // Unknown chain remains visible for operations but moves behind
            // fresh/due rows rather than monopolizing the first page.
            await markChecked(row);
          }
        } catch (err) {
          await markChecked(row).catch(() => undefined);
          console.error(
            `[payout-confirm] ${row.id}: error during confirm:`,
            err instanceof Error ? err.name : "unknown_error",
          );
        }
      }
    },
  );
  await Promise.all(consumers);
}

async function tick(): Promise<void> {
  if (batchInFlight) return batchInFlight;
  const current = confirmBatchOnce();
  batchInFlight = current;
  try {
    await current;
  } finally {
    if (batchInFlight === current) batchInFlight = null;
  }
}

export function startPayoutConfirmWorker() {
  if (interval) return;
  interval = setInterval(() => {
    tick().catch((err) => {
      console.error(
        "[payout-confirm] tick error:",
        err instanceof Error ? err.name : "unknown_error",
      );
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
