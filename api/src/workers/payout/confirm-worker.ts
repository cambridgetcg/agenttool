/** Payout-confirm worker — periodic, independent polls of `broadcasting` and
 *  `broadcast` rows. A positive deterministic-ID lookup advances an ambiguous
 *  `broadcasting` row; absent or unavailable evidence leaves it untouched.
 *  `broadcast` rows are flipped to `confirmed` once the chain threshold is
 *  met, or `failed` + refund on a finalized revert.
 *
 *  Pattern: setInterval (not BullMQ) because the work is a pure DB+RPC
 *  scan with no per-job state. Multi-instance safe — concurrent ticks just
 *  redundantly poll; the DB updates are idempotent (CAS via status check).
 *
 *  Doctrine: docs/PAYOUT-BROADCAST-PLAN.md (Slices 2+3). */

import { and, asc, eq, gt } from "drizzle-orm";
import type { Hex } from "viem";

import { db } from "../../db/client";
import { cryptoPayouts } from "../../db/schema/economy";
import {
  isEvmChain,
  type EvmChain,
} from "../../services/economy/crypto/chains";
import {
  confirmTx,
  txExistsOnChain,
} from "../../services/economy/crypto/sign-evm";
import {
  confirmSolanaTx,
  solanaTxExists,
} from "../../services/economy/crypto/sign-solana";
import { EVM_CONFIRMATION_THRESHOLDS } from "../../services/economy/crypto/network";
import { refundPayoutAndFail } from "../../services/economy/crypto/payout-refund";

const POLL_INTERVAL_MS = 30_000;
const POLL_BATCH_SIZE = 50;

let interval: ReturnType<typeof setInterval> | null = null;

type Row = typeof cryptoPayouts.$inferSelect;
type ScanStatus = "broadcasting" | "broadcast";

const scanCursors: Record<ScanStatus, string | null> = {
  broadcasting: null,
  broadcast: null,
};

/** A full page continues after its final UUID. A short page has reached the
 *  end of the current keyspace and wraps to the beginning on the next tick. */
export function nextPayoutScanCursor(
  rows: ReadonlyArray<Pick<Row, "id">>,
  batchSize = POLL_BATCH_SIZE,
): string | null {
  if (rows.length !== batchSize) return null;
  return rows.at(-1)?.id ?? null;
}

async function selectPayoutBatch(
  status: ScanStatus,
  afterId: string | null,
): Promise<Row[]> {
  const statusFilter = eq(cryptoPayouts.status, status);
  return db
    .select()
    .from(cryptoPayouts)
    .where(
      afterId
        ? and(statusFilter, gt(cryptoPayouts.id, afterId))
        : statusFilter,
    )
    .orderBy(asc(cryptoPayouts.id))
    .limit(POLL_BATCH_SIZE);
}

/** Independent in-memory cursors keep either state from monopolising the
 *  other. A depleted keyset wraps immediately; process restarts safely begin
 *  from the deterministic first UUID again. */
async function nextPayoutBatch(status: ScanStatus): Promise<Row[]> {
  const previousCursor = scanCursors[status];
  let rows = await selectPayoutBatch(status, previousCursor);

  if (rows.length === 0 && previousCursor !== null) {
    rows = await selectPayoutBatch(status, null);
  }

  scanCursors[status] = nextPayoutScanCursor(rows);
  return rows;
}

/** Atomic refund + status='failed', gated on CAS so concurrent confirmers
 *  can't double-refund. */
async function refundAndFail(row: Row, errReason: string) {
  return db.transaction((tx) =>
    refundPayoutAndFail(tx, row, "broadcast", errReason),
  );
}

async function confirmEvmRow(row: Row) {
  if (!row.txHash) return;
  const chain = row.chain as EvmChain;
  const threshold = EVM_CONFIRMATION_THRESHOLDS[chain];

  const result = await confirmTx(chain, row.txHash as Hex, threshold);
  if (result.status === "confirmed") {
    const confirmed = await db
      .update(cryptoPayouts)
      .set({ status: "confirmed", confirmedAt: new Date() })
      .where(
        and(
          eq(cryptoPayouts.id, row.id),
          eq(cryptoPayouts.status, "broadcast"),
          eq(cryptoPayouts.txHash, row.txHash),
        ),
      )
      .returning({ id: cryptoPayouts.id });
    if (confirmed.length === 1) {
      console.log(
        `[payout-confirm] ${row.id}: confirmed at block ${result.blockNumber} (${chain})`,
      );
    }
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
  }
  // 'pending' → leave for next tick.
}

async function confirmSolanaRow(row: Row) {
  if (!row.txHash) return;

  const result = await confirmSolanaTx(row.txHash);
  if (result.status === "confirmed") {
    const confirmed = await db
      .update(cryptoPayouts)
      .set({ status: "confirmed", confirmedAt: new Date() })
      .where(
        and(
          eq(cryptoPayouts.id, row.id),
          eq(cryptoPayouts.status, "broadcast"),
          eq(cryptoPayouts.txHash, row.txHash),
        ),
      )
      .returning({ id: cryptoPayouts.id });
    if (confirmed.length === 1) {
      console.log(
        `[payout-confirm] ${row.id}: confirmed at slot ${result.slot} (solana)`,
      );
    }
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
  }
  // 'pending' → leave for next tick.
}

/** Resolve only persisted deterministic identities. An absent lookup is not
 *  evidence of non-submission, and an unavailable provider is not evidence at
 *  all, so both paths leave every field unchanged. */
async function reconcileBroadcastingRow(row: Row) {
  if (!row.txHash) return;

  let found = false;
  if (isEvmChain(row.chain)) {
    found = await txExistsOnChain(row.chain, row.txHash as Hex);
  } else if (row.chain === "solana") {
    found = await solanaTxExists(row.txHash);
  }

  if (!found) return;

  const advanced = await db
    .update(cryptoPayouts)
    .set({ status: "broadcast", error: null })
    .where(
      and(
        eq(cryptoPayouts.id, row.id),
        eq(cryptoPayouts.status, "broadcasting"),
        eq(cryptoPayouts.txHash, row.txHash),
      ),
    )
    .returning({ id: cryptoPayouts.id });

  if (advanced.length === 1) {
    console.log(
      `[payout-confirm] ${row.id}: expected transaction found; advanced broadcasting → broadcast`,
    );
  }
}

async function reconcileBroadcastingRows() {
  const broadcasting = await nextPayoutBatch("broadcasting");

  for (const row of broadcasting) {
    try {
      await reconcileBroadcastingRow(row);
    } catch {
      // Provider errors can contain credential-bearing URLs or vendor detail.
      // More importantly, lookup failure has no state-machine authority.
      console.warn(
        `[payout-confirm] ${row.id}: expected-transaction lookup unavailable; left broadcasting`,
      );
    }
  }
}

async function tick() {
  await reconcileBroadcastingRows();

  const broadcast = await nextPayoutBatch("broadcast");

  for (const row of broadcast) {
    if (!row.txHash) continue;

    try {
      if (isEvmChain(row.chain)) {
        await confirmEvmRow(row);
      } else if (row.chain === "solana") {
        await confirmSolanaRow(row);
      }
      // unknown chain → leave for ops to investigate.
    } catch {
      // RPC errors can contain credential-bearing endpoint URLs. The payout
      // identity is enough to reconcile; provider detail stays out of logs.
      console.error(
        `[payout-confirm] ${row.id}: confirmation lookup unavailable; state unchanged`,
      );
    }
  }
}

export function startPayoutConfirmWorker() {
  if (interval) return;
  interval = setInterval(() => {
    tick().catch(() => {
      console.error("[payout-confirm] tick unavailable; state unchanged");
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
