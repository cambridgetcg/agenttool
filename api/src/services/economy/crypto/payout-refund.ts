/** Payout debit reconciliation and atomic reversal.
 *
 * Refund authority comes only from the server-written transactions ledger.
 * Payout JSON metadata is caller-extensible and is never used to choose an
 * amount. A reversal requires exactly one locked negative `type='payout'`
 * ledger leg whose wallet, payout id, destination, token, and base amount all
 * match the payout row. Missing, duplicate, malformed, or already-reversed
 * histories fail closed.
 *
 * Doctrine: docs/PAYOUT-BROADCAST.md. */

import { and, eq, sql } from "drizzle-orm";

import type { db } from "../../../db/client";
import {
  cryptoPayouts,
  transactions,
  wallets,
} from "../../../db/schema/economy";

type PayoutTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type PayoutLedgerIdentity = Pick<
  typeof cryptoPayouts.$inferSelect,
  | "id"
  | "walletId"
  | "amountBase"
  | "destinationAddress"
  | "token"
>;

export interface PayoutLedgerCandidate {
  id: string;
  walletId: string;
  type: string;
  amount: number;
  counterparty: string | null;
  metadata: unknown;
}

export type PayoutDebitReconciliation =
  | {
      ok: true;
      debitTransactionId: string;
      refundMinor: number;
    }
  | {
      ok: false;
      reason:
        | "missing_or_duplicate_ledger_leg"
        | "ledger_identity_mismatch"
        | "invalid_ledger_amount";
    };

function metadataRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function samePositiveBaseAmount(left: unknown, right: string): boolean {
  if (typeof left !== "string") return false;
  try {
    const leftBase = BigInt(left);
    const rightBase = BigInt(right);
    return leftBase > 0n && leftBase === rightBase;
  } catch {
    return false;
  }
}

/** Pure defence-in-depth validation for the locked ledger query result. */
export function reconcilePayoutDebit(
  payout: PayoutLedgerIdentity,
  candidates: readonly PayoutLedgerCandidate[],
): PayoutDebitReconciliation {
  // A second matching payout leg can be a duplicate debit or a prior positive
  // reversal. Either way, no new balance mutation is safe.
  if (candidates.length !== 1) {
    return { ok: false, reason: "missing_or_duplicate_ledger_leg" };
  }

  const candidate = candidates[0]!;
  const metadata = metadataRecord(candidate.metadata);
  if (
    candidate.walletId !== payout.walletId ||
    candidate.type !== "payout" ||
    candidate.counterparty !== payout.destinationAddress ||
    metadata?.payout_id !== payout.id ||
    metadata.token !== payout.token ||
    !samePositiveBaseAmount(metadata.amount_base, payout.amountBase as string)
  ) {
    return { ok: false, reason: "ledger_identity_mismatch" };
  }

  if (
    !Number.isSafeInteger(candidate.amount) ||
    candidate.amount >= 0
  ) {
    return { ok: false, reason: "invalid_ledger_amount" };
  }

  return {
    ok: true,
    debitTransactionId: candidate.id,
    refundMinor: -candidate.amount,
  };
}

async function lockedPayoutDebit(
  tx: PayoutTransaction,
  payout: PayoutLedgerIdentity,
): Promise<PayoutDebitReconciliation> {
  // Query every payout ledger row claiming this payout id, not only negative
  // rows. A pre-existing positive leg must make reconciliation fail closed.
  // Wallet and type predicates narrow the lock set; the pure validator repeats
  // them and checks the remaining identity fields before any mutation.
  const candidates = await tx
    .select({
      id: transactions.id,
      walletId: transactions.walletId,
      type: transactions.type,
      amount: transactions.amount,
      counterparty: transactions.counterparty,
      metadata: transactions.metadata,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.walletId, payout.walletId),
        eq(transactions.type, "payout"),
        sql`${transactions.metadata}->>'payout_id' = ${payout.id}`,
      ),
    )
    .limit(2)
    .for("update");

  return reconcilePayoutDebit(payout, candidates);
}

export type RefundablePayoutStatus = "requested" | "broadcast";
export type RefundTerminalStatus = "failed" | "cancelled";

export type ReversePayoutResult =
  | {
      refunded: true;
      refundMinor: number;
      debitTransactionId: string;
    }
  | {
      refunded: false;
      reason: "status_race_lost";
      terminal: false;
    }
  | {
      refunded: false;
      reason: "ledger_unreconciled";
      detail: Exclude<PayoutDebitReconciliation, { ok: true }>["reason"];
      terminal: boolean;
    };

export interface ReversePayoutOptions {
  expectedStatus: RefundablePayoutStatus;
  terminalStatus: RefundTerminalStatus;
  terminalError: string;
  description: string;
  /** Workers terminalize a proved pre-submit/on-chain failure even when an
   * inconsistent legacy ledger cannot be refunded. User cancellation leaves
   * the row requested so an operator can repair provenance first. */
  terminalizeUnreconciled: boolean;
}

/** Lock and reconcile the original debit, then CAS the payout, credit the
 * wallet, and insert its positive ledger reversal in one transaction. */
export async function reversePayoutDebit(
  tx: PayoutTransaction,
  payout: PayoutLedgerIdentity,
  options: ReversePayoutOptions,
): Promise<ReversePayoutResult> {
  const reconciliation = await lockedPayoutDebit(tx, payout);
  if (!reconciliation.ok) {
    if (!options.terminalizeUnreconciled) {
      return {
        refunded: false,
        reason: "ledger_unreconciled",
        detail: reconciliation.reason,
        terminal: false,
      };
    }

    const terminalized = await tx
      .update(cryptoPayouts)
      .set({
        status: options.terminalStatus,
        error: "refund_unreconciled",
      })
      .where(
        and(
          eq(cryptoPayouts.id, payout.id),
          eq(cryptoPayouts.status, options.expectedStatus),
        ),
      )
      .returning({ id: cryptoPayouts.id });
    if (terminalized.length === 0) {
      return {
        refunded: false,
        reason: "status_race_lost",
        terminal: false,
      };
    }
    return {
      refunded: false,
      reason: "ledger_unreconciled",
      detail: reconciliation.reason,
      terminal: true,
    };
  }

  // The status CAS gates every accounting side effect. If a concurrent
  // cancellation or confirmer wins, no wallet or ledger mutation follows.
  const updated = await tx
    .update(cryptoPayouts)
    .set({
      status: options.terminalStatus,
      error: options.terminalError,
    })
    .where(
      and(
        eq(cryptoPayouts.id, payout.id),
        eq(cryptoPayouts.status, options.expectedStatus),
      ),
    )
    .returning({ id: cryptoPayouts.id });
  if (updated.length === 0) {
    return {
      refunded: false,
      reason: "status_race_lost",
      terminal: false,
    };
  }

  await tx
    .update(wallets)
    .set({
      balance: sql`${wallets.balance} + ${reconciliation.refundMinor}`,
    })
    .where(eq(wallets.id, payout.walletId));

  await tx.insert(transactions).values({
    walletId: payout.walletId,
    type: "payout",
    amount: reconciliation.refundMinor,
    counterparty: payout.destinationAddress,
    description: options.description,
    metadata: {
      payout_id: payout.id,
      reverses: "payout",
      original_transaction_id: reconciliation.debitTransactionId,
    },
  });

  return {
    refunded: true,
    refundMinor: reconciliation.refundMinor,
    debitTransactionId: reconciliation.debitTransactionId,
  };
}

/** Worker wrapper: terminal failure with exact refund when reconcilable;
 * terminal fail-closed hold when legacy/corrupt ledger provenance is absent. */
export async function refundPayoutAndFail(
  tx: PayoutTransaction,
  payout: PayoutLedgerIdentity,
  expectedStatus: RefundablePayoutStatus,
  error: string,
): Promise<ReversePayoutResult> {
  return reversePayoutDebit(tx, payout, {
    expectedStatus,
    terminalStatus: "failed",
    terminalError: error,
    description: "payout failed — original debit reversed",
    terminalizeUnreconciled: true,
  });
}
