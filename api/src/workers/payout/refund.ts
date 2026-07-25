/** Atomic payout failure refund.
 *
 * Current payout rows carry server-authored GBP debit provenance in
 * `metadata.debited_minor`. That exact debit — not a fresh USDC conversion —
 * is restored when a failure is proved. Rows predating the earned-payout gate
 * use the same conservative amount-base fallback as `cancelPayout`; because
 * those rows did not write a negative payout ledger leg, they do not receive
 * a positive ledger reversal.
 *
 * Doctrine: docs/PAYOUT-BROADCAST.md. */

import { and, eq, sql } from "drizzle-orm";

import type { db } from "../../db/client";
import {
  cryptoPayouts,
  transactions,
  wallets,
} from "../../db/schema/economy";
import { CREDITS_PER_USDC } from "../../services/economy/crypto/chains";

type PayoutTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type PayoutRow = Pick<
  typeof cryptoPayouts.$inferSelect,
  "id" | "walletId" | "amountBase" | "destinationAddress" | "metadata"
>;

export type RefundablePayoutStatus = "requested" | "broadcast";

export interface PayoutRefundPlan {
  refundMinor: number;
  reverseLedger: boolean;
  source: "debited_minor" | "legacy_amount_base";
}

/** Resolve the amount that the server originally debited.
 *
 * The two server markers make `debited_minor` authoritative: requestPayout
 * writes all three after spreading caller metadata. Without those markers,
 * ignore any caller-controlled `debited_minor` and use the legacy fallback
 * from cancelPayout.
 */
export function payoutRefundPlan(row: PayoutRow): PayoutRefundPlan {
  const metadata =
    row.metadata !== null &&
    typeof row.metadata === "object" &&
    !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  const gated =
    metadata.debit_currency === "GBP" &&
    typeof metadata.gbp_usd_rate === "number";

  if (gated) {
    const refundMinor = metadata.debited_minor;
    if (
      typeof refundMinor !== "number" ||
      !Number.isSafeInteger(refundMinor) ||
      refundMinor < 0
    ) {
      throw new Error("invalid_server_authored_debited_minor");
    }
    return {
      refundMinor,
      reverseLedger: true,
      source: "debited_minor",
    };
  }

  // Legacy rows predate both the GBP debit markers and the negative payout
  // ledger leg. This intentionally mirrors cancelPayout's defensive fallback.
  const refundMinor = Math.ceil(
    (Number(row.amountBase) / 1_000_000) * CREDITS_PER_USDC,
  );
  if (!Number.isSafeInteger(refundMinor) || refundMinor < 0) {
    throw new Error("invalid_legacy_payout_refund_amount");
  }
  return {
    refundMinor,
    reverseLedger: false,
    source: "legacy_amount_base",
  };
}

export type RefundPayoutResult =
  | {
      refunded: true;
      refundMinor: number;
      source: PayoutRefundPlan["source"];
    }
  | { refunded: false; reason: "status_race_lost" };

/** Compare-and-swap the terminal status, restore the wallet, and write the
 * positive payout ledger leg through one caller-owned DB transaction.
 *
 * The status CAS happens first and gates every accounting side effect. If a
 * concurrent cancel or confirmer wins, no balance or ledger mutation occurs.
 * Any later statement failure rolls back the status transition as well.
 */
export async function refundPayoutAndFail(
  tx: PayoutTransaction,
  row: PayoutRow,
  expectedStatus: RefundablePayoutStatus,
  error: string,
): Promise<RefundPayoutResult> {
  const plan = payoutRefundPlan(row);

  const updated = await tx
    .update(cryptoPayouts)
    .set({ status: "failed", error })
    .where(
      and(
        eq(cryptoPayouts.id, row.id),
        eq(cryptoPayouts.status, expectedStatus),
      ),
    )
    .returning({ id: cryptoPayouts.id });
  if (updated.length === 0) {
    return { refunded: false, reason: "status_race_lost" };
  }

  await tx
    .update(wallets)
    .set({ balance: sql`${wallets.balance} + ${plan.refundMinor}` })
    .where(eq(wallets.id, row.walletId));

  if (plan.reverseLedger) {
    await tx.insert(transactions).values({
      walletId: row.walletId,
      type: "payout",
      amount: plan.refundMinor,
      counterparty: row.destinationAddress,
      description: `payout failed — refunded ${plan.refundMinor} pence`,
      metadata: {
        payout_id: row.id,
        reverses: "payout",
      },
    });
  }

  return {
    refunded: true,
    refundMinor: plan.refundMinor,
    source: plan.source,
  };
}
