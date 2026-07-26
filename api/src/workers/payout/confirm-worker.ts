/** Payout-confirm worker — periodic, independent polls of `broadcasting` and
 *  `broadcast` rows on the active durable network. A positive deterministic-ID
 *  lookup advances an ambiguous `broadcasting` row; absent or unavailable
 *  evidence never authorizes a retry, refund, or state transition.
 *
 *  `broadcast` rows are ordered by their persisted least-recent check time.
 *  Each process admits one batch at a time and uses bounded concurrency, so a
 *  permanently pending first page cannot starve later terminal receipts.
 *  Multi-instance reads may overlap; every economic effect remains status,
 *  network, and transaction-identity CAS-bound.
 *
 *  Doctrine: docs/PAYOUT-BROADCAST-PLAN.md (Slices 2+3). */

import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
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
let broadcastingCursor: string | null = null;

type Row = typeof cryptoPayouts.$inferSelect;
type PayoutNetwork = "mainnet" | "testnet";

/** A full ambiguity page continues after its final UUID. A short page has
 * reached the end of the active network keyspace and wraps next tick. */
export function nextPayoutScanCursor(
  rows: ReadonlyArray<Pick<Row, "id">>,
  batchSize = POLL_BATCH_SIZE,
): string | null {
  if (rows.length !== batchSize) return null;
  return rows.at(-1)?.id ?? null;
}

async function selectBroadcastingBatch(
  network: PayoutNetwork,
  afterId: string | null,
): Promise<Row[]> {
  const identity = and(
    eq(cryptoPayouts.status, "broadcasting"),
    eq(cryptoPayouts.network, network),
  );
  return db
    .select()
    .from(cryptoPayouts)
    .where(
      afterId
        ? and(identity, gt(cryptoPayouts.id, afterId))
        : identity,
    )
    .orderBy(asc(cryptoPayouts.id))
    .limit(POLL_BATCH_SIZE);
}

/** Ambiguous rows retain PR164's independent keyset scan. A restart begins at
 * the first UUID again, while the broadcast-confirmation queue below uses its
 * durable database timestamp for cross-replica fairness. */
async function nextBroadcastingBatch(
  network: PayoutNetwork,
): Promise<Row[]> {
  const previousCursor = broadcastingCursor;
  let rows = await selectBroadcastingBatch(network, previousCursor);
  if (rows.length === 0 && previousCursor !== null) {
    rows = await selectBroadcastingBatch(network, null);
  }
  broadcastingCursor = nextPayoutScanCursor(rows);
  return rows;
}

/** Atomic refund + status='failed', guarded by a fresh locked identity read so
 * concurrent confirmers cannot refund a stale row. */
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

async function markBroadcastChecked(
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
  if (!row.txHash || !row.network) return;
  const chain = row.chain as EvmChain;
  const threshold = EVM_CONFIRMATION_THRESHOLDS[chain];

  const result = await confirmTx(
    chain,
    row.txHash as Hex,
    threshold,
    RPC_TIMEOUT_MS,
  );
  if (result.status === "confirmed") {
    const confirmed = await db
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
          eq(cryptoPayouts.network, row.network),
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
  } else {
    await markBroadcastChecked(row, result.evidenceError ?? null);
  }
}

async function confirmSolanaRow(row: Row) {
  if (!row.txHash || !row.network) return;

  const result = await confirmSolanaTx(row.txHash, RPC_TIMEOUT_MS);
  if (result.status === "confirmed") {
    const confirmed = await db
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
          eq(cryptoPayouts.network, row.network),
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
  } else {
    await markBroadcastChecked(row, null);
  }
}

/** Resolve only the persisted deterministic identity. A negative lookup is
 * not evidence of non-submission; only a positive result may advance state. */
async function reconcileBroadcastingRow(row: Row) {
  if (!row.txHash || !row.network) return;

  let found = false;
  if (isEvmChain(row.chain)) {
    found = await txExistsOnChain(
      row.chain,
      row.txHash as Hex,
      RPC_TIMEOUT_MS,
    );
  } else if (row.chain === "solana") {
    found = await solanaTxExists(row.txHash, RPC_TIMEOUT_MS);
  }
  if (!found) return;

  const advanced = await db
    .update(cryptoPayouts)
    .set({ status: "broadcast", error: null })
    .where(
      and(
        eq(cryptoPayouts.id, row.id),
        eq(cryptoPayouts.status, "broadcasting"),
        eq(cryptoPayouts.network, row.network),
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

async function runBounded(
  rows: readonly Row[],
  visit: (row: Row) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const consumers = Array.from(
    { length: Math.min(POLL_CONCURRENCY, rows.length) },
    async () => {
      while (cursor < rows.length) {
        const row = rows[cursor++];
        if (!row) return;
        await visit(row);
      }
    },
  );
  await Promise.all(consumers);
}

async function reconcileBroadcastingRows(
  network: PayoutNetwork,
): Promise<void> {
  const broadcasting = await nextBroadcastingBatch(network);
  await runBounded(broadcasting, async (row) => {
    try {
      await reconcileBroadcastingRow(row);
    } catch {
      // Provider errors can contain credential-bearing URLs or vendor detail.
      // Lookup failure has no state-machine authority.
      console.warn(
        `[payout-confirm] ${row.id}: expected-transaction lookup unavailable; left broadcasting`,
      );
    }
  });
}

async function confirmBroadcastRows(network: PayoutNetwork): Promise<void> {
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

  await runBounded(broadcast, async (row) => {
    try {
      if (!row.txHash) {
        await markBroadcastChecked(row);
      } else if (isEvmChain(row.chain)) {
        await confirmEvmRow(row);
      } else if (row.chain === "solana") {
        await confirmSolanaRow(row);
      } else {
        await markBroadcastChecked(row);
      }
    } catch {
      // Move an unavailable row behind other due work without retaining
      // credential-bearing provider details.
      await markBroadcastChecked(row).catch(() => undefined);
      console.error(
        `[payout-confirm] ${row.id}: confirmation lookup unavailable; state unchanged`,
      );
    }
  });
}

async function confirmBatchOnce(): Promise<void> {
  const network = activeNetwork();
  await reconcileBroadcastingRows(network);
  await confirmBroadcastRows(network);
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
