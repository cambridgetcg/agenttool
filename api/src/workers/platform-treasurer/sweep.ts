/** Worker: platform-treasurer-sweep.
 *
 *  Doctrine: docs/AGENT-CENTRIC.md §1 · docs/BUSINESS-MODEL.md §three rings ·
 *            docs/RING-1.md §commitment-7 (platform inhabits its own Ring 1) ·
 *            docs/PLATFORM-AS-AGENT.md.
 *
 *  Closes the cold-start loop. Sweeps unswept `marketplace.platform_revenue`
 *  rows into the platform wallet, currency-matched. Without this, every
 *  substrate-task payout drained PLATFORM_WALLET_ID monotonically and
 *  the J-curve would have eventually starved newborns out — the take-rate
 *  ledger accumulated but never refilled the wallet that funds it.
 *
 *  Per-tick logic:
 *    1. For each currency the platform holds a wallet in (v1: GBP only),
 *       SELECT FOR UPDATE all `platform_revenue` rows WHERE
 *       swept_at IS NULL AND currency = wallet.currency
 *    2. Sum their `amount` fields (the take-rate fees)
 *    3. Credit PLATFORM_WALLET_ID by the sum (atomic with marking rows)
 *    4. Write ONE `transactions` row on the platform wallet (type='settle')
 *       capturing the aggregate sweep — the per-fee ledger is already
 *       in platform_revenue, the transactions row carries the wallet-
 *       level move so the wallet's audit trail is honest
 *    5. UPDATE swept rows with swept_at=NOW(), swept_into_wallet_id=wallet.id
 *
 *  Idempotent: the partial index `idx_platform_revenue_unswept` keeps
 *  the query fast and the SELECT FOR UPDATE prevents two workers from
 *  double-sweeping the same row.
 *
 *  Currencies the platform doesn't yet have a wallet for (e.g. USDC
 *  before a USDC platform wallet exists) remain unswept and claimable
 *  when that wallet ships. Honest: no value is lost; the ledger is
 *  authoritative; the sweep just defers until a destination exists.
 *
 *  Disabled when AGENTTOOL_DISABLE_WORKERS=1.
 *
 *  @enforces urn:agenttool:commitment/ring3-take-into-platform-wallet
 *    Canonical defender. The sweep IS the operational closure of "the
 *    platform_revenue ledger row IS the platform's claim" — turning
 *    claim into balance. Without this worker, that commitment was
 *    aspirational; with it, the platform-as-agent actually receives. */

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { transactions, wallets } from "../../db/schema/economy";
import { platformRevenue } from "../../db/schema/marketplace";
import { PLATFORM_WALLET_ID } from "../../services/wake/platform-bootstrap";

const TICK_MS = 5 * 60_000; // 5 minutes
let timer: ReturnType<typeof setInterval> | null = null;

export function startPlatformTreasurerSweepWorker(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  void tick();
}

export function stopPlatformTreasurerSweepWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

interface SweepResult {
  swept_count: number;
  swept_amount: number;
  currency: string | null;
}

/** Single-tick sweep. Exported for tests + the operator-callable script. */
export async function runTreasurerSweep(): Promise<SweepResult[]> {
  // v1 sweeps only the canonical platform wallet (GBP). Future: iterate
  // over all platform-owned wallets and sweep currency-matched rows.
  const [platformWallet] = await db
    .select({ id: wallets.id, currency: wallets.currency })
    .from(wallets)
    .where(eq(wallets.id, PLATFORM_WALLET_ID))
    .limit(1);

  if (!platformWallet) {
    // Platform wallet not bootstrapped yet — nothing to do (lazy-bootstrap
    // will create it on startup elsewhere).
    return [];
  }

  return [await sweepCurrency(platformWallet.id, platformWallet.currency)];
}

async function sweepCurrency(
  walletId: string,
  currency: string,
): Promise<SweepResult> {
  return await db.transaction(async (tx) => {
    // Lock all unswept rows in this currency. SELECT FOR UPDATE is fine
    // here — the partial index keeps the row set small; a backlog of
    // unswept rows is bounded by sweep cadence × throughput.
    const unswept = await tx
      .select({
        id: platformRevenue.id,
        amount: platformRevenue.amount,
      })
      .from(platformRevenue)
      .where(
        and(
          eq(platformRevenue.currency, currency),
          isNull(platformRevenue.sweptAt),
        ),
      )
      .for("update");

    if (unswept.length === 0) {
      return { swept_count: 0, swept_amount: 0, currency };
    }

    const total = unswept.reduce((s, r) => s + r.amount, 0);
    const now = new Date();

    // Credit the platform wallet
    await tx
      .update(wallets)
      .set({ balance: sql`${wallets.balance} + ${total}` })
      .where(eq(wallets.id, walletId));

    // Write the wallet's ledger row — the per-fee ledger is in
    // platform_revenue; this is the wallet-level audit trail.
    await tx.insert(transactions).values({
      walletId,
      type: "settle",
      amount: total,
      counterparty: "platform_revenue_sweep",
      description:
        `Treasurer sweep: ${unswept.length} platform_revenue row(s) in ${currency}`,
      metadata: {
        kind: "platform_revenue_sweep",
        row_count: unswept.length,
        currency,
        row_ids: unswept.map((r) => r.id),
      },
    });

    // Mark rows swept (atomic with the credit)
    const ids = unswept.map((r) => r.id);
    await tx
      .update(platformRevenue)
      .set({ sweptAt: now, sweptIntoWalletId: walletId })
      .where(
        sql`${platformRevenue.id} IN (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`,
      );

    return { swept_count: unswept.length, swept_amount: total, currency };
  });
}

async function tick(): Promise<void> {
  try {
    const results = await runTreasurerSweep();
    for (const r of results) {
      if (r.swept_count > 0) {
        console.log(
          `[platform-treasurer-sweep] swept ${r.swept_count} row(s) · ` +
            `${(r.swept_amount / 100).toFixed(2)} ${r.currency} → platform wallet`,
        );
      }
    }
  } catch (err) {
    console.warn(
      "[platform-treasurer-sweep] tick failed (will retry next interval):",
      err,
    );
  }
}
