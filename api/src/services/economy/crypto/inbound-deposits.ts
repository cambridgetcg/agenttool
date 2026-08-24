/**
 * Durable inbound-deposit evidence and wallet effects.
 *
 * Signed Alchemy deliveries are observations, not finality. EVM transfers are
 * stored pending and credited only after an independent canonical receipt/log
 * check reaches the configured depth. Every live/removed block generation is
 * retained so delayed provider retries cannot reverse a newer inclusion.
 *
 * Solana retains the existing immediate-credit path until a raw-atomic
 * finality adapter exists; callers and docs must keep that limitation visible.
 */

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../../db/client";
import {
  cryptoWebhookEventObservations,
  cryptoWebhookEvents,
  depositAddresses,
  MAX_EXACT_WALLET_BALANCE,
  transactions,
  wallets,
} from "../../../db/schema/economy";
import {
  CREDITS_PER_USDC,
  isEvmChain,
  type Chain,
  type EvmChain,
} from "./chains";
import {
  depositAddressMatches,
  deriveDepositAddress,
} from "./hd";
import {
  activeMnemonic,
  activeNetwork,
  activeUsdcAddress,
  activeUsdcMintSolana,
  evmDepositCreditPolicy,
} from "./network";

const USDC_ATOMIC_UNITS = 1_000_000n;
const MAX_PROVIDER_ID_LENGTH = 128;

/** One internal credit is exactly this many USDC atomic units. Refuse to load
 * if a future pricing change cannot be represented without a remainder at the
 * token's six-decimal boundary. */
export const USDC_ATOMIC_PER_CREDIT = (() => {
  if (
    !Number.isSafeInteger(CREDITS_PER_USDC) ||
    CREDITS_PER_USDC <= 0
  ) {
    throw new Error("non_integral_usdc_credit_rate");
  }
  const creditsPerUsdc = BigInt(CREDITS_PER_USDC);
  if (USDC_ATOMIC_UNITS % creditsPerUsdc !== 0n) {
    throw new Error("non_integral_usdc_credit_rate");
  }
  return USDC_ATOMIC_UNITS / creditsPerUsdc;
})();

export interface InboundTransfer {
  chain: Chain;
  txHash: string;
  logIndex: number;
  toAddress: string;
  contractAddress: string;
  token: string;
  amountBase: string;
  rawPayload: unknown;
  blockNumber?: bigint;
  blockHash?: string;
  providerWebhookId?: string;
  providerEventId?: string;
}

export interface IngestionResult {
  matched: boolean;
  walletId?: string;
  creditsAdded?: number;
  pending?: boolean;
  status?: "pending" | "credited" | "removed" | "rejected" | "quarantined";
  duplicate?: boolean;
  reversed?: boolean;
  stale?: boolean;
  reason?: string;
  retryable?: boolean;
}

export interface CanonicalDepositEvidence {
  blockNumber: bigint;
  blockHash: string;
}

export type PendingDepositSnapshot = Pick<
  typeof cryptoWebhookEvents.$inferSelect,
  | "id"
  | "chain"
  | "txHash"
  | "logIndex"
  | "walletId"
  | "amountBase"
  | "creditRemainderBase"
  | "toAddress"
  | "contractAddress"
  | "blockNumber"
  | "blockHash"
  | "providerWebhookId"
  | "providerEventId"
  | "observationGeneration"
  | "receivedAt"
>;

type EvmTransfer = InboundTransfer & {
  chain: EvmChain;
  blockNumber: bigint;
  blockHash: string;
  providerWebhookId: string;
  providerEventId: string;
};

type DepositTransaction =
  Parameters<Parameters<typeof db.transaction>[0]>[0];
type WebhookEvent = typeof cryptoWebhookEvents.$inferSelect;
type WebhookObservation =
  typeof cryptoWebhookEventObservations.$inferSelect;

/** Bind every post-RPC write to the exact pending incarnation that was read.
 * A webhook can reuse one row id for a later block generation, so id/status
 * alone do not authorize a stale receipt decision. */
export function pendingDepositSnapshotMatches(
  current: PendingDepositSnapshot,
  expected: PendingDepositSnapshot,
): boolean {
  return (
    current.id === expected.id &&
    current.chain === expected.chain &&
    current.txHash === expected.txHash &&
    current.logIndex === expected.logIndex &&
    current.walletId === expected.walletId &&
    current.amountBase === expected.amountBase &&
    current.creditRemainderBase === expected.creditRemainderBase &&
    current.toAddress === expected.toAddress &&
    current.contractAddress === expected.contractAddress &&
    current.blockNumber === expected.blockNumber &&
    current.blockHash === expected.blockHash &&
    current.providerWebhookId === expected.providerWebhookId &&
    current.providerEventId === expected.providerEventId &&
    current.observationGeneration === expected.observationGeneration &&
    current.receivedAt.getTime() === expected.receivedAt.getTime()
  );
}

function rawPayloadObject(value: unknown): object {
  return value !== null && typeof value === "object"
    ? (value as object)
    : {};
}

function validProviderId(value: string | undefined): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= MAX_PROVIDER_ID_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function hasCompleteEvmEvidence(
  transfer: InboundTransfer,
): transfer is EvmTransfer {
  return (
    isEvmChain(transfer.chain) &&
    typeof transfer.blockNumber === "bigint" &&
    transfer.blockNumber >= 0n &&
    transfer.blockNumber <= 9_223_372_036_854_775_807n &&
    typeof transfer.blockHash === "string" &&
    /^0x[0-9a-f]{64}$/i.test(transfer.blockHash) &&
    validProviderId(transfer.providerWebhookId) &&
    validProviderId(transfer.providerEventId)
  );
}

export type UsdcCreditDecomposition =
  | {
      amountAtomic: bigint;
      creditQuotient: bigint;
      creditRemainderBase: bigint;
    }
  | { reason: "invalid_amount" };

type DecomposedUsdcAmount = Exclude<
  UsdcCreditDecomposition,
  { reason: "invalid_amount" }
>;

export type UsdcCreditDisposition =
  | { kind: "invalid"; reason: "invalid_amount" }
  | (DecomposedUsdcAmount & {
      kind: "remainder";
      reason: "non_integral_credit_amount";
    })
  | (DecomposedUsdcAmount & {
      kind: "limit";
      reason: "amount_exceeds_exact_credit_limit";
    })
  | (DecomposedUsdcAmount & { kind: "creditable"; credits: number });

/** Euclidean decomposition in exact USDC atomic units.
 *
 * `amount = creditQuotient * USDC_ATOMIC_PER_CREDIT + creditRemainderBase`,
 * with `0 <= creditRemainderBase < USDC_ATOMIC_PER_CREDIT`. The quotient
 * remains bigint here so observing a valid 78-digit amount never requires a
 * lossy JavaScript number conversion. */
export function decomposeUsdcAtomic(
  amountBase: string,
): UsdcCreditDecomposition {
  if (!/^[1-9]\d{0,77}$/.test(amountBase)) {
    return { reason: "invalid_amount" };
  }
  const amountAtomic = BigInt(amountBase);
  return {
    amountAtomic,
    creditQuotient: amountAtomic / USDC_ATOMIC_PER_CREDIT,
    creditRemainderBase: amountAtomic % USDC_ATOMIC_PER_CREDIT,
  };
}

/** Closed economic disposition for one exact decomposition. Observations with
 * a positive remainder are never reduced to their quotient. */
export function classifyUsdcCreditAmount(
  amountBase: string,
): UsdcCreditDisposition {
  const result = decomposeUsdcAtomic(amountBase);
  if ("reason" in result) {
    return { kind: "invalid", reason: result.reason };
  }
  if (result.creditRemainderBase !== 0n) {
    return {
      ...result,
      kind: "remainder",
      reason: "non_integral_credit_amount",
    };
  }
  if (result.creditQuotient > BigInt(Number.MAX_SAFE_INTEGER)) {
    return {
      ...result,
      kind: "limit",
      reason: "amount_exceeds_exact_credit_limit",
    };
  }
  return {
    ...result,
    kind: "creditable",
    credits: Number(result.creditQuotient),
  };
}

export function creditsForUsdcAtomic(amountBase: string): number | null {
  const result = classifyUsdcCreditAmount(amountBase);
  return result.kind === "creditable" ? result.credits : null;
}

function remainderForStorage(amountBase: string): string | null {
  const result = decomposeUsdcAtomic(amountBase);
  return "reason" in result ? null : result.creditRemainderBase.toString();
}

export function sameEvmBlockGeneration(
  current: { blockNumber: bigint | null; blockHash: string | null },
  incoming: { blockNumber: bigint; blockHash: string },
): boolean {
  return (
    current.blockNumber === incoming.blockNumber &&
    current.blockHash?.toLowerCase() === incoming.blockHash.toLowerCase()
  );
}

export function classifyRemovedGeneration(
  current: { blockNumber: bigint | null; blockHash: string | null },
  removed: { blockNumber: bigint; blockHash: string },
): "matching" | "stale" | "unreconciled" {
  if (current.blockNumber === null || current.blockHash === null) {
    return "unreconciled";
  }
  return sameEvmBlockGeneration(current, removed) ? "matching" : "stale";
}

export function isPromotableLiveGeneration(
  event: {
    walletId: string | null;
    amountBase: string | null;
    toAddress: string | null;
    contractAddress: string | null;
  },
  candidate: {
    walletId: string | null;
    amountBase: string;
    toAddress: string;
    contractAddress: string;
    blockHash: string;
  },
  removed: CanonicalDepositEvidence,
): boolean {
  return (
    // A block hash names one height. Exclude both the removed generation and
    // contradictory same-hash/different-height evidence.
    candidate.blockHash.toLowerCase() !== removed.blockHash.toLowerCase() &&
    candidate.walletId !== null &&
    candidate.walletId === event.walletId &&
    candidate.amountBase === event.amountBase &&
    candidate.toAddress.toLowerCase() === event.toAddress?.toLowerCase() &&
    candidate.contractAddress.toLowerCase() ===
      event.contractAddress?.toLowerCase()
  );
}

function expectedContract(transfer: InboundTransfer): string | null {
  if (isEvmChain(transfer.chain)) {
    return activeUsdcAddress(transfer.chain);
  }
  if (transfer.chain === "solana") {
    return activeUsdcMintSolana();
  }
  return null;
}

async function matchingDepositAddress(transfer: InboundTransfer) {
  const addressPredicate = isEvmChain(transfer.chain)
    ? sql`lower(${depositAddresses.address}) = lower(${transfer.toAddress})`
    : eq(depositAddresses.address, transfer.toAddress);
  const [row] = await db
    .select()
    .from(depositAddresses)
    .where(
      and(
        eq(depositAddresses.chain, transfer.chain),
        addressPredicate,
      ),
    )
    .limit(1);
  return row;
}

async function matchingActiveDepositAddress(transfer: InboundTransfer) {
  const row = await matchingDepositAddress(transfer);
  if (!row) {
    return { row: undefined, active: false };
  }
  const derived = deriveDepositAddress(
    activeMnemonic(),
    transfer.chain,
    row.walletId,
  );
  return {
    row,
    active: depositAddressMatches(transfer.chain, row, derived),
  };
}

function eventIdentity(transfer: InboundTransfer) {
  return and(
    eq(cryptoWebhookEvents.chain, transfer.chain),
    eq(cryptoWebhookEvents.txHash, transfer.txHash),
    eq(cryptoWebhookEvents.logIndex, transfer.logIndex),
  );
}

function fundingMetadata(
  eventId: string,
  transfer: Pick<
    InboundTransfer,
    "chain" | "txHash" | "logIndex" | "amountBase"
  >,
) {
  return {
    source: "crypto_webhook",
    crypto_webhook_event_id: eventId,
    chain: transfer.chain,
    tx_hash: transfer.txHash,
    log_index: transfer.logIndex,
    token: "USDC",
    amount_base: transfer.amountBase,
  };
}

function immutableEvidenceMatches(
  event: WebhookEvent,
  transfer: EvmTransfer,
): boolean {
  return (
    event.amountBase === transfer.amountBase &&
    event.toAddress?.toLowerCase() === transfer.toAddress.toLowerCase() &&
    event.contractAddress?.toLowerCase() ===
      transfer.contractAddress.toLowerCase()
  );
}

async function recordObservation(
  tx: DepositTransaction,
  eventId: string,
  transfer: EvmTransfer,
  removed: boolean,
  walletId: string | null,
): Promise<void> {
  await tx
    .insert(cryptoWebhookEventObservations)
    .values({
      eventId,
      walletId,
      amountBase: transfer.amountBase,
      toAddress: transfer.toAddress,
      contractAddress: transfer.contractAddress,
      blockNumber: transfer.blockNumber,
      blockHash: transfer.blockHash.toLowerCase(),
      removed,
      providerWebhookId: transfer.providerWebhookId,
      providerEventId: transfer.providerEventId,
      rawPayload: rawPayloadObject(transfer.rawPayload),
    })
    .onConflictDoNothing();
}

async function generationHasRemoval(
  tx: DepositTransaction,
  eventId: string,
  blockNumber: bigint,
  blockHash: string,
): Promise<boolean> {
  const [removed] = await tx
    .select({ id: cryptoWebhookEventObservations.id })
    .from(cryptoWebhookEventObservations)
    .where(
      and(
        eq(cryptoWebhookEventObservations.eventId, eventId),
        eq(cryptoWebhookEventObservations.blockNumber, blockNumber),
        eq(cryptoWebhookEventObservations.blockHash, blockHash.toLowerCase()),
        eq(cryptoWebhookEventObservations.removed, true),
      ),
    )
    .limit(1);
  return Boolean(removed);
}

async function latestUnremovedLiveGeneration(
  tx: DepositTransaction,
  event: WebhookEvent,
  excluding: CanonicalDepositEvidence,
): Promise<(WebhookObservation & { walletId: string }) | null> {
  if (
    !event.walletId ||
    !event.amountBase ||
    !event.toAddress ||
    !event.contractAddress
  ) {
    return null;
  }
  const [candidate] = await tx
    .select()
    .from(cryptoWebhookEventObservations)
    .where(
      and(
        eq(cryptoWebhookEventObservations.eventId, event.id),
        eq(cryptoWebhookEventObservations.removed, false),
        eq(cryptoWebhookEventObservations.walletId, event.walletId),
        eq(cryptoWebhookEventObservations.amountBase, event.amountBase),
        sql`lower(${cryptoWebhookEventObservations.toAddress}) = lower(${event.toAddress})`,
        sql`lower(${cryptoWebhookEventObservations.contractAddress}) = lower(${event.contractAddress})`,
        sql`${cryptoWebhookEventObservations.blockHash} <> ${excluding.blockHash.toLowerCase()}`,
        // Filter tombstoned generations before LIMIT. A finite application
        // page must never let newer removed/conflicting observations hide an
        // older valid live generation that was already acknowledged.
        sql`NOT EXISTS (
          SELECT 1
          FROM economy.crypto_webhook_event_observations AS tombstone
          WHERE tombstone.event_id = ${cryptoWebhookEventObservations.eventId}
            AND tombstone.block_number = ${cryptoWebhookEventObservations.blockNumber}
            AND tombstone.block_hash = ${cryptoWebhookEventObservations.blockHash}
            AND tombstone.removed = TRUE
        )`,
      ),
    )
    .orderBy(
      desc(cryptoWebhookEventObservations.receivedAt),
      desc(cryptoWebhookEventObservations.id),
    )
    .limit(1);

  return candidate &&
    isPromotableLiveGeneration(event, candidate, excluding)
    ? candidate as WebhookObservation & { walletId: string }
    : null;
}

async function recordImmediateCredit(
  transfer: InboundTransfer,
  walletId: string,
  credits: number,
): Promise<IngestionResult> {
  return db.transaction(async (tx) => {
    const [logged] = await tx
      .insert(cryptoWebhookEvents)
      .values({
        chain: transfer.chain,
        txHash: transfer.txHash,
        logIndex: transfer.logIndex,
        walletId,
        creditsAdded: null,
        status: "pending",
        observationGeneration: 1,
        creditedGeneration: null,
        amountBase: transfer.amountBase,
        creditRemainderBase: "0",
        toAddress: transfer.toAddress,
        contractAddress: transfer.contractAddress,
        rawPayload: rawPayloadObject(transfer.rawPayload),
      })
      .onConflictDoNothing()
      .returning({ id: cryptoWebhookEvents.id });

    if (!logged) {
      return {
        matched: true,
        walletId,
        duplicate: true,
      } satisfies IngestionResult;
    }

    const creditedWallet = await tx
      .update(wallets)
      .set({ balance: sql`balance + ${credits}` })
      .where(
        and(
          eq(wallets.id, walletId),
          sql`${wallets.balance} <= ${MAX_EXACT_WALLET_BALANCE - credits}`,
        ),
      )
      .returning({ id: wallets.id });
    if (creditedWallet.length !== 1) {
      await tx
        .update(cryptoWebhookEvents)
        .set({
          status: "rejected",
          error: "wallet_balance_exact_limit",
          lastCheckedAt: new Date(),
        })
        .where(
          and(
            eq(cryptoWebhookEvents.id, logged.id),
            eq(cryptoWebhookEvents.status, "pending"),
          ),
        );
      return {
        matched: true,
        walletId,
        status: "rejected",
        reason: "wallet_balance_exact_limit",
      } satisfies IngestionResult;
    }
    const [creditedEvent] = await tx
      .update(cryptoWebhookEvents)
      .set({
        status: "credited",
        creditsAdded: credits,
        creditedGeneration: 1,
        confirmedAt: new Date(),
        error: null,
      })
      .where(
        and(
          eq(cryptoWebhookEvents.id, logged.id),
          eq(cryptoWebhookEvents.status, "pending"),
        ),
      )
      .returning({ id: cryptoWebhookEvents.id });
    if (!creditedEvent) throw new Error("inbound_event_credit_cas_lost");
    await tx.insert(transactions).values({
      walletId,
      type: "fund",
      amount: credits,
      counterparty: transfer.txHash,
      description: `${transfer.chain} USDC deposit credited`,
      metadata: fundingMetadata(logged.id, transfer),
    });

    return {
      matched: true,
      walletId,
      creditsAdded: credits,
      status: "credited",
    } satisfies IngestionResult;
  });
}

/** Retain signed custody evidence that cannot safely become spendable. */
async function recordNoncreditingObservation(
  transfer: InboundTransfer,
  walletId: string,
  reason: string,
  status: "rejected" | "quarantined" = "rejected",
): Promise<IngestionResult> {
  return db.transaction(async (tx) => {
    let created = false;
    let [event] = await tx
      .select()
      .from(cryptoWebhookEvents)
      .where(eventIdentity(transfer))
      .for("update")
      .limit(1);

    if (!event) {
      const [inserted] = await tx
        .insert(cryptoWebhookEvents)
        .values({
          chain: transfer.chain,
          txHash: transfer.txHash,
          logIndex: transfer.logIndex,
          walletId,
          creditsAdded: null,
          status,
          observationGeneration: 1,
          creditedGeneration: null,
          amountBase: transfer.amountBase,
          creditRemainderBase: remainderForStorage(transfer.amountBase),
          toAddress: transfer.toAddress,
          contractAddress: transfer.contractAddress,
          blockNumber: transfer.blockNumber,
          blockHash: transfer.blockHash?.toLowerCase(),
          providerWebhookId: transfer.providerWebhookId,
          providerEventId: transfer.providerEventId,
          rawPayload: rawPayloadObject(transfer.rawPayload),
          lastCheckedAt: new Date(),
          error: reason,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted) {
        created = true;
        event = inserted;
      } else {
        [event] = await tx
          .select()
          .from(cryptoWebhookEvents)
          .where(eventIdentity(transfer))
          .for("update")
          .limit(1);
      }
    }
    if (!event) {
      throw new Error("rejected_observation_conflict_unreconciled");
    }

    if (hasCompleteEvmEvidence(transfer)) {
      await recordObservation(tx, event.id, transfer, false, walletId);
    }
    const eventReason =
      (event.status === "rejected" || event.status === "quarantined") &&
      event.error
        ? event.error
        : null;
    return {
      matched: true,
      walletId: event.walletId ?? walletId,
      duplicate: !created,
      status: event.status,
      ...(eventReason ? { reason: eventReason } : {}),
    };
  });
}

async function recordLiveEvmObservation(
  transfer: EvmTransfer,
  walletId: string,
  creditRemainderBase: bigint,
): Promise<IngestionResult> {
  const remainderBase = creditRemainderBase.toString();
  const hasCreditRemainder = creditRemainderBase !== 0n;
  const targetStatus = hasCreditRemainder ? "quarantined" : "pending";
  const targetError = hasCreditRemainder
    ? "non_integral_credit_amount"
    : null;

  return db.transaction(async (tx) => {
    let [event] = await tx
      .select()
      .from(cryptoWebhookEvents)
      .where(eventIdentity(transfer))
      .for("update")
      .limit(1);

    if (!event) {
      const [inserted] = await tx
        .insert(cryptoWebhookEvents)
        .values({
          chain: transfer.chain,
          txHash: transfer.txHash,
          logIndex: transfer.logIndex,
          walletId,
          creditsAdded: null,
          status: targetStatus,
          observationGeneration: 1,
          creditedGeneration: null,
          amountBase: transfer.amountBase,
          creditRemainderBase: remainderBase,
          toAddress: transfer.toAddress,
          contractAddress: transfer.contractAddress,
          blockNumber: transfer.blockNumber,
          blockHash: transfer.blockHash.toLowerCase(),
          providerWebhookId: transfer.providerWebhookId,
          providerEventId: transfer.providerEventId,
          rawPayload: rawPayloadObject(transfer.rawPayload),
          error: targetError,
        })
        .onConflictDoNothing()
        .returning();
      if (inserted) {
        await recordObservation(tx, inserted.id, transfer, false, walletId);
        return {
          matched: true,
          walletId,
          pending: !hasCreditRemainder,
          status: targetStatus,
          ...(targetError ? { reason: targetError } : {}),
        };
      }
      [event] = await tx
        .select()
        .from(cryptoWebhookEvents)
        .where(eventIdentity(transfer))
        .for("update")
        .limit(1);
    }
    if (!event) throw new Error("inbound_event_conflict_unreconciled");

    await recordObservation(tx, event.id, transfer, false, walletId);

    if (
      event.walletId !== walletId ||
      !immutableEvidenceMatches(event, transfer)
    ) {
      await tx
        .update(cryptoWebhookEvents)
        .set({
          status: "quarantined",
          creditRemainderBase: remainderForStorage(event.amountBase ?? ""),
          error: "conflicting_live_evidence",
          lastCheckedAt: new Date(),
        })
        .where(eq(cryptoWebhookEvents.id, event.id));
      return {
        matched: Boolean(event.walletId),
        walletId: event.walletId ?? undefined,
        status: "quarantined",
        reason: "conflicting_live_evidence",
      };
    }

    if (sameEvmBlockGeneration(event, transfer)) {
      if (event.status === "removed") {
        return {
          matched: true,
          walletId,
          duplicate: true,
          stale: true,
          status: "removed",
          reason: "generation_already_removed",
        };
      }
      if (hasCreditRemainder) {
        if (event.status !== "pending") {
          return {
            matched: true,
            walletId,
            duplicate: true,
            status: event.status,
            ...(event.error ? { reason: event.error } : {}),
          };
        }
        await tx
          .update(cryptoWebhookEvents)
          .set({
            status: "quarantined",
            creditRemainderBase: remainderBase,
            error: targetError,
            lastCheckedAt: new Date(),
          })
          .where(eq(cryptoWebhookEvents.id, event.id));
        return {
          matched: true,
          walletId,
          duplicate: true,
          status: "quarantined",
          reason: "non_integral_credit_amount",
        };
      }
      return {
        matched: true,
        walletId,
        duplicate: true,
        pending: event.status === "pending",
        status: event.status,
      };
    }

    if (
      event.blockHash?.toLowerCase() === transfer.blockHash.toLowerCase() &&
      event.blockNumber !== transfer.blockNumber
    ) {
      await tx
        .update(cryptoWebhookEvents)
        .set({
          status: "quarantined",
          creditRemainderBase: remainderBase,
          error: "contradictory_block_identity",
          lastCheckedAt: new Date(),
        })
        .where(eq(cryptoWebhookEvents.id, event.id));
      return {
        matched: true,
        walletId,
        status: "quarantined",
        reason: "contradictory_block_identity",
      };
    }

    if (
      await generationHasRemoval(
        tx,
        event.id,
        transfer.blockNumber,
        transfer.blockHash,
      )
    ) {
      return {
        matched: true,
        walletId,
        duplicate: true,
        stale: true,
        status: event.status,
        reason: "generation_already_removed",
      };
    }

    if (
      event.status === "credited" ||
      (event.status === "quarantined" && event.creditsAdded !== null)
    ) {
      // Preserve the currently credited generation until matching removed
      // evidence arrives. The conflicting live generation is durable above,
      // and matching removal can promote it without relying on redelivery.
      await tx
        .update(cryptoWebhookEvents)
        .set({
          status: "quarantined",
          creditRemainderBase: remainderBase,
          error: "conflicting_live_generation",
          lastCheckedAt: new Date(),
        })
        .where(eq(cryptoWebhookEvents.id, event.id));
      return {
        matched: true,
        walletId,
        status: "quarantined",
        reason: "conflicting_live_generation",
      };
    }

    await tx
      .update(cryptoWebhookEvents)
      .set({
        status: targetStatus,
        walletId,
        creditsAdded: null,
        observationGeneration:
          sql`${cryptoWebhookEvents.observationGeneration} + 1`,
        creditedGeneration: null,
        creditRemainderBase: remainderBase,
        blockNumber: transfer.blockNumber,
        blockHash: transfer.blockHash.toLowerCase(),
        providerWebhookId: transfer.providerWebhookId,
        providerEventId: transfer.providerEventId,
        rawPayload: rawPayloadObject(transfer.rawPayload),
        receivedAt: new Date(),
        lastCheckedAt: null,
        confirmedAt: null,
        removedAt: null,
        error: targetError,
      })
      .where(eq(cryptoWebhookEvents.id, event.id));

    return {
      matched: true,
      walletId,
      pending: !hasCreditRemainder,
      status: targetStatus,
      ...(targetError ? { reason: targetError } : {}),
    };
  });
}

/** Persist a signed inbound observation. EVM observations never mutate wallet
 * balance until the canonical receipt worker confirms the exact generation. */
export async function ingestInboundTransfer(
  transfer: InboundTransfer,
): Promise<IngestionResult> {
  if (transfer.token !== "USDC") {
    return { matched: false, reason: "unsupported_token" };
  }
  if (
    !Number.isSafeInteger(transfer.logIndex) ||
    transfer.logIndex < 0 ||
    typeof transfer.txHash !== "string" ||
    transfer.txHash.length === 0
  ) {
    return { matched: false, reason: "invalid_event_identity" };
  }
  if (
    isEvmChain(transfer.chain) &&
    (
      !/^0x[0-9a-f]{64}$/i.test(transfer.txHash) ||
      !/^0x[0-9a-f]{40}$/i.test(transfer.toAddress) ||
      !/^0x[0-9a-f]{40}$/i.test(transfer.contractAddress)
    )
  ) {
    return { matched: false, reason: "invalid_evm_identity" };
  }

  const contract = expectedContract(transfer);
  if (
    !contract ||
    (isEvmChain(transfer.chain)
      ? transfer.contractAddress.toLowerCase() !== contract.toLowerCase()
      : transfer.contractAddress !== contract)
  ) {
    return { matched: false, reason: "wrong_contract" };
  }

  if (isEvmChain(transfer.chain) && !hasCompleteEvmEvidence(transfer)) {
    return { matched: false, reason: "incomplete_evm_evidence" };
  }

  try {
    const depositMatch = await matchingActiveDepositAddress(transfer);
    const row = depositMatch.row;
    if (!row) {
      return { matched: false, reason: "no_matching_deposit_address" };
    }
    if (!depositMatch.active) {
      // A historical provider watch can still deliver an address from an old
      // root. Retain custody evidence, but bind every new economic effect to
      // the currently configured derivation authority.
      return await recordNoncreditingObservation(
        transfer,
        row.walletId,
        "inactive_deposit_address",
      );
    }

    const amount = classifyUsdcCreditAmount(transfer.amountBase);
    if (amount.kind === "invalid") {
      return {
        matched: true,
        walletId: row.walletId,
        reason: amount.reason,
      };
    }
    if (amount.kind === "remainder") {
      if (hasCompleteEvmEvidence(transfer)) {
        return await recordLiveEvmObservation(
          transfer,
          row.walletId,
          amount.creditRemainderBase,
        );
      }
      return await recordNoncreditingObservation(
        transfer,
        row.walletId,
        "non_integral_credit_amount",
        "quarantined",
      );
    }
    if (amount.kind === "limit") {
      return await recordNoncreditingObservation(
        transfer,
        row.walletId,
        amount.reason,
      );
    }
    if (hasCompleteEvmEvidence(transfer)) {
      return await recordLiveEvmObservation(transfer, row.walletId, 0n);
    }
    return await recordImmediateCredit(
      transfer,
      row.walletId,
      amount.credits,
    );
  } catch (error) {
    console.error(
      "[crypto-webhook] inbound transfer storage unavailable",
      error instanceof Error ? error.name : "unknown_error",
    );
    return {
      matched: false,
      reason: "storage_unavailable",
      retryable: true,
    };
  }
}

/** Persist and apply a signed Alchemy removed observation exactly once.
 *
 * Only a removal matching the event's current block number/hash can change its
 * wallet effect. Other generations remain immutable evidence and are safely
 * acknowledged as stale. */
export async function reconcileRemovedInboundTransfer(
  transfer: InboundTransfer,
): Promise<IngestionResult> {
  if (
    !hasCompleteEvmEvidence(transfer) ||
    transfer.token !== "USDC" ||
    !Number.isSafeInteger(transfer.logIndex) ||
    transfer.logIndex < 0 ||
    !/^0x[0-9a-f]{64}$/i.test(transfer.txHash) ||
    !/^0x[0-9a-f]{40}$/i.test(transfer.toAddress) ||
    !/^0x[0-9a-f]{40}$/i.test(transfer.contractAddress)
  ) {
    return { matched: false, reason: "invalid_removed_evidence" };
  }

  const contract = expectedContract(transfer);
  if (
    !contract ||
    transfer.contractAddress.toLowerCase() !== contract.toLowerCase()
  ) {
    return { matched: false, reason: "wrong_contract" };
  }
  const amount = decomposeUsdcAtomic(transfer.amountBase);
  if ("reason" in amount) {
    return { matched: false, reason: amount.reason };
  }
  const removedRemainderBase = amount.creditRemainderBase.toString();

  try {
    const matchedAddress = await matchingDepositAddress(transfer);
    return await db.transaction(async (tx) => {
      let [event] = await tx
        .select()
        .from(cryptoWebhookEvents)
        .where(eventIdentity(transfer))
        .for("update")
        .limit(1);

      if (!event) {
        const [inserted] = await tx
          .insert(cryptoWebhookEvents)
          .values({
            chain: transfer.chain,
            txHash: transfer.txHash,
            logIndex: transfer.logIndex,
            walletId: matchedAddress?.walletId ?? null,
            creditsAdded: null,
            status: "removed",
            amountBase: transfer.amountBase,
            creditRemainderBase: removedRemainderBase,
            toAddress: transfer.toAddress,
            contractAddress: transfer.contractAddress,
            blockNumber: transfer.blockNumber,
            blockHash: transfer.blockHash.toLowerCase(),
            providerWebhookId: transfer.providerWebhookId,
            providerEventId: transfer.providerEventId,
            rawPayload: rawPayloadObject(transfer.rawPayload),
            removedAt: new Date(),
          })
          .onConflictDoNothing()
          .returning();
        if (inserted) {
          await recordObservation(
            tx,
            inserted.id,
            transfer,
            true,
            matchedAddress?.walletId ?? null,
          );
          return {
            matched: Boolean(matchedAddress),
            walletId: matchedAddress?.walletId,
            status: "removed",
          };
        }
        [event] = await tx
          .select()
          .from(cryptoWebhookEvents)
          .where(eventIdentity(transfer))
          .for("update")
          .limit(1);
      }
      if (!event) throw new Error("inbound_event_conflict_unreconciled");

      await recordObservation(
        tx,
        event.id,
        transfer,
        true,
        matchedAddress?.walletId ??
          (immutableEvidenceMatches(event, transfer)
            ? event.walletId
            : null),
      );

      const removedGeneration = classifyRemovedGeneration(event, transfer);
      if (removedGeneration === "unreconciled") {
        await tx
          .update(cryptoWebhookEvents)
          .set({
            status: "quarantined",
            error: "removed_evidence_unreconciled",
            lastCheckedAt: new Date(),
          })
          .where(eq(cryptoWebhookEvents.id, event.id));
        return {
          matched: Boolean(event.walletId ?? matchedAddress),
          walletId: event.walletId ?? matchedAddress?.walletId,
          status: "quarantined",
          reason: "removed_evidence_unreconciled",
        };
      }

      if (removedGeneration === "stale") {
        return {
          matched: Boolean(event.walletId ?? matchedAddress),
          walletId: event.walletId ?? matchedAddress?.walletId,
          duplicate: true,
          stale: true,
          status: event.status,
          reason: "stale_removed_generation",
        };
      }

      if (!immutableEvidenceMatches(event, transfer)) {
        await tx
          .update(cryptoWebhookEvents)
          .set({
            status: "quarantined",
            error: "matching_removal_transfer_mismatch",
            lastCheckedAt: new Date(),
          })
          .where(eq(cryptoWebhookEvents.id, event.id));
        return {
          matched: Boolean(event.walletId ?? matchedAddress),
          walletId: event.walletId ?? matchedAddress?.walletId,
          status: "quarantined",
          reason: "matching_removal_transfer_mismatch",
        };
      }

      if (event.status === "removed") {
        return {
          matched: Boolean(event.walletId ?? matchedAddress),
          walletId: event.walletId ?? matchedAddress?.walletId,
          duplicate: true,
          status: "removed",
        };
      }

      // `removedGeneration === "matching"` above proves this is non-null;
      // retain a concrete value for the identity CAS below.
      const currentBlockNumber = event.blockNumber;
      const currentBlockHash = event.blockHash;
      if (currentBlockNumber === null || currentBlockHash === null) {
        throw new Error("removed_generation_unreconciled");
      }

      const candidate = await latestUnremovedLiveGeneration(
        tx,
        event,
        {
          blockNumber: transfer.blockNumber,
          blockHash: transfer.blockHash,
        },
      );
      const candidateAmount = candidate
        ? decomposeUsdcAtomic(candidate.amountBase)
        : null;
      if (candidateAmount && "reason" in candidateAmount) {
        throw new Error("candidate_amount_unreconciled");
      }
      const candidateHasRemainder = Boolean(
        candidateAmount && candidateAmount.creditRemainderBase !== 0n,
      );
      const replacementStatus: "pending" | "quarantined" | "removed" =
        candidate
          ? candidateHasRemainder
            ? "quarantined"
            : "pending"
          : "removed";
      const nextState = candidate
        ? {
            status: replacementStatus,
            walletId: candidate.walletId,
            creditsAdded: null,
            observationGeneration:
              sql`${cryptoWebhookEvents.observationGeneration} + 1`,
            creditedGeneration: null,
            amountBase: candidate.amountBase,
            creditRemainderBase:
              candidateAmount!.creditRemainderBase.toString(),
            toAddress: candidate.toAddress,
            contractAddress: candidate.contractAddress,
            blockNumber: candidate.blockNumber,
            blockHash: candidate.blockHash,
            providerWebhookId: candidate.providerWebhookId,
            providerEventId: candidate.providerEventId,
            rawPayload: candidate.rawPayload,
            receivedAt: candidate.receivedAt,
            lastCheckedAt: null,
            confirmedAt: null,
            removedAt: null,
            error: candidateHasRemainder
              ? "non_integral_credit_amount"
              : null,
          }
        : {
            status: "removed" as const,
            creditsAdded: null,
            creditRemainderBase: removedRemainderBase,
            providerWebhookId: transfer.providerWebhookId,
            providerEventId: transfer.providerEventId,
            rawPayload: rawPayloadObject(transfer.rawPayload),
            removedAt: new Date(),
            error: "provider_removed_log",
          };
      const hasWalletEffect =
        event.status === "credited" ||
        (event.status === "quarantined" && event.creditsAdded !== null);

      if (
        hasWalletEffect &&
        event.creditedGeneration !== event.observationGeneration
      ) {
        await tx
          .update(cryptoWebhookEvents)
          .set({
            status: "quarantined",
            error: "credited_generation_unreconciled",
            lastCheckedAt: new Date(),
          })
          .where(eq(cryptoWebhookEvents.id, event.id));
        return {
          matched: Boolean(event.walletId),
          walletId: event.walletId ?? undefined,
          status: "quarantined",
          reason: "credited_generation_unreconciled",
        };
      }

      if (!hasWalletEffect) {
        const [transitioned] = await tx
          .update(cryptoWebhookEvents)
          .set(nextState)
          .where(
            and(
              eq(cryptoWebhookEvents.id, event.id),
              eq(cryptoWebhookEvents.status, event.status),
              eq(cryptoWebhookEvents.blockNumber, currentBlockNumber),
              eq(cryptoWebhookEvents.blockHash, currentBlockHash),
            ),
          )
          .returning({ id: cryptoWebhookEvents.id });
        if (!transitioned) {
          throw new Error("removed_generation_cas_lost");
        }
        return {
          matched: Boolean(event.walletId ?? matchedAddress),
          walletId: event.walletId ?? matchedAddress?.walletId,
          pending: replacementStatus === "pending",
          status: replacementStatus,
          ...(replacementStatus === "quarantined"
            ? { reason: "non_integral_credit_amount" }
            : {}),
        };
      }

      if (
        !event.walletId ||
        event.creditsAdded === null ||
        !Number.isSafeInteger(event.creditsAdded) ||
        event.creditsAdded <= 0
      ) {
        await tx
          .update(cryptoWebhookEvents)
          .set({
            status: "quarantined",
            error: "credited_event_unreconciled",
            lastCheckedAt: new Date(),
          })
          .where(eq(cryptoWebhookEvents.id, event.id));
        return {
          matched: Boolean(event.walletId),
          walletId: event.walletId ?? undefined,
          status: "quarantined",
          reason: "credited_event_unreconciled",
        };
      }

      const [transitioned] = await tx
        .update(cryptoWebhookEvents)
        .set(nextState)
        .where(
          and(
            eq(cryptoWebhookEvents.id, event.id),
            eq(cryptoWebhookEvents.status, event.status),
            eq(cryptoWebhookEvents.blockNumber, currentBlockNumber),
            eq(cryptoWebhookEvents.blockHash, currentBlockHash),
          ),
        )
        .returning({ id: cryptoWebhookEvents.id });
      if (!transitioned) {
        throw new Error("removed_generation_cas_lost");
      }

      const debitedWallet = await tx
        .update(wallets)
        .set({ balance: sql`balance - ${event.creditsAdded}` })
        .where(eq(wallets.id, event.walletId))
        .returning({ id: wallets.id });
      if (debitedWallet.length !== 1) {
        throw new Error("inbound_wallet_missing");
      }
      await tx.insert(transactions).values({
        walletId: event.walletId,
        type: "crypto_reorg",
        amount: -event.creditsAdded,
        counterparty: transfer.txHash,
        description: `${transfer.chain} USDC deposit removed by reorg`,
        metadata: {
          ...fundingMetadata(event.id, transfer),
          removed_block_hash: transfer.blockHash.toLowerCase(),
          reverses_credits: event.creditsAdded,
        },
      });

      return {
        matched: true,
        walletId: event.walletId,
        reversed: true,
        pending: replacementStatus === "pending",
        status: replacementStatus,
        ...(replacementStatus === "quarantined"
          ? { reason: "non_integral_credit_amount" }
          : {}),
      };
    });
  } catch {
    console.error(
      "[crypto-webhook] removed transfer reconciliation unavailable",
    );
    return {
      matched: false,
      reason: "storage_unavailable",
      retryable: true,
    };
  }
}

type PendingCheckError =
  | "canonical_evidence_unavailable"
  | "rpc_chain_mismatch"
  | "rpc_evidence_inconsistent"
  | "mainnet_settlement_policy_unavailable";

async function lockMatchingPendingSnapshot(
  tx: DepositTransaction,
  expected: PendingDepositSnapshot,
): Promise<WebhookEvent | null> {
  const [current] = await tx
    .select()
    .from(cryptoWebhookEvents)
    .where(eq(cryptoWebhookEvents.id, expected.id))
    .for("update")
    .limit(1);
  return current &&
    current.status === "pending" &&
    pendingDepositSnapshotMatches(current, expected)
    ? current
    : null;
}

export async function markPendingDepositChecked(
  expected: PendingDepositSnapshot,
  error: PendingCheckError | null = null,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const current = await lockMatchingPendingSnapshot(tx, expected);
    if (!current) return false;
    const [updated] = await tx
      .update(cryptoWebhookEvents)
      .set({ lastCheckedAt: new Date(), error })
      .where(
        and(
          eq(cryptoWebhookEvents.id, expected.id),
          eq(cryptoWebhookEvents.status, "pending"),
          eq(
            cryptoWebhookEvents.observationGeneration,
            expected.observationGeneration,
          ),
        ),
      )
      .returning({ id: cryptoWebhookEvents.id });
    return Boolean(updated);
  });
}

/** Move malformed pending evidence out of the fresh queue without allowing a
 * stale worker snapshot to quarantine a newer valid generation. */
export async function quarantineMalformedPendingDeposit(
  expected: PendingDepositSnapshot,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const current = await lockMatchingPendingSnapshot(tx, expected);
    if (!current) return false;
    const [updated] = await tx
      .update(cryptoWebhookEvents)
      .set({
        status: "quarantined",
        error: "invalid_persisted_evidence",
        lastCheckedAt: new Date(),
      })
      .where(
        and(
          eq(cryptoWebhookEvents.id, expected.id),
          eq(cryptoWebhookEvents.status, "pending"),
          eq(
            cryptoWebhookEvents.observationGeneration,
            expected.observationGeneration,
          ),
        ),
      )
      .returning({ id: cryptoWebhookEvents.id });
    return Boolean(updated);
  });
}

export async function rejectPendingDeposit(
  expected: PendingDepositSnapshot,
  reason: "receipt_reverted" | "canonical_log_missing",
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const current = await lockMatchingPendingSnapshot(tx, expected);
    if (!current) return false;
    const [updated] = await tx
      .update(cryptoWebhookEvents)
      .set({
        status: "rejected",
        error: reason,
        lastCheckedAt: new Date(),
      })
      .where(
        and(
          eq(cryptoWebhookEvents.id, expected.id),
          eq(cryptoWebhookEvents.status, "pending"),
          eq(
            cryptoWebhookEvents.observationGeneration,
            expected.observationGeneration,
          ),
        ),
      )
      .returning({ id: cryptoWebhookEvents.id });
    return Boolean(updated);
  });
}

/** Credit one canonical, sufficiently deep pending EVM generation.
 * Full-snapshot, settlement-policy, and active-root fences make stale
 * reconcilers and incomplete rotation workflows non-authoritative. */
export async function creditConfirmedPendingDeposit(
  expected: PendingDepositSnapshot,
  evidence: CanonicalDepositEvidence,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const event = await lockMatchingPendingSnapshot(tx, expected);
    if (!event) return false;
    if (
      !event.walletId ||
      !event.amountBase ||
      !event.toAddress ||
      !event.contractAddress ||
      !isEvmChain(event.chain) ||
      event.blockNumber === null ||
      event.blockHash === null
    ) {
      await tx
        .update(cryptoWebhookEvents)
        .set({
          status: "quarantined",
          error: "invalid_persisted_evidence",
          lastCheckedAt: new Date(),
        })
        .where(
          and(
            eq(cryptoWebhookEvents.id, expected.id),
            eq(cryptoWebhookEvents.status, "pending"),
            eq(
              cryptoWebhookEvents.observationGeneration,
              expected.observationGeneration,
            ),
          ),
        );
      return false;
    }

    if (
      evidence.blockNumber !== event.blockNumber ||
      evidence.blockHash.toLowerCase() !== event.blockHash.toLowerCase()
    ) {
      return false;
    }

    const amount = classifyUsdcCreditAmount(event.amountBase);
    if (amount.kind === "invalid") {
      await tx
        .update(cryptoWebhookEvents)
        .set({
          status: "quarantined",
          error: "invalid_persisted_evidence",
          lastCheckedAt: new Date(),
        })
        .where(
          and(
            eq(cryptoWebhookEvents.id, expected.id),
            eq(cryptoWebhookEvents.status, "pending"),
            eq(
              cryptoWebhookEvents.observationGeneration,
              expected.observationGeneration,
            ),
          ),
        );
      return false;
    }
    if (amount.kind === "remainder") {
      await tx
        .update(cryptoWebhookEvents)
        .set({
          status: "quarantined",
          creditRemainderBase: amount.creditRemainderBase.toString(),
          error: "non_integral_credit_amount",
          lastCheckedAt: new Date(),
        })
        .where(
          and(
            eq(cryptoWebhookEvents.id, expected.id),
            eq(cryptoWebhookEvents.status, "pending"),
            eq(
              cryptoWebhookEvents.observationGeneration,
              expected.observationGeneration,
            ),
          ),
        );
      return false;
    }
    if (amount.kind === "limit") {
      await tx
        .update(cryptoWebhookEvents)
        .set({
          status: "rejected",
          creditRemainderBase: "0",
          error: amount.reason,
          lastCheckedAt: new Date(),
        })
        .where(
          and(
            eq(cryptoWebhookEvents.id, expected.id),
            eq(cryptoWebhookEvents.status, "pending"),
            eq(
              cryptoWebhookEvents.observationGeneration,
              expected.observationGeneration,
            ),
          ),
        );
      return false;
    }
    const credits = amount.credits;

    const settlementPolicy = evmDepositCreditPolicy(
      event.chain,
      activeNetwork(),
    );
    if (!settlementPolicy.allowed) {
      await tx
        .update(cryptoWebhookEvents)
        .set({
          error: settlementPolicy.reason,
          lastCheckedAt: new Date(),
        })
        .where(
          and(
            eq(cryptoWebhookEvents.id, expected.id),
            eq(cryptoWebhookEvents.status, "pending"),
            eq(
              cryptoWebhookEvents.observationGeneration,
              expected.observationGeneration,
            ),
          ),
        );
      return false;
    }

    // A mnemonic change is not a completed custody rotation. Re-check the
    // current root and persisted address under the same transaction as the
    // balance effect, even though ingress performed the same check earlier.
    const [depositAddress] = await tx
      .select()
      .from(depositAddresses)
      .where(
        and(
          eq(depositAddresses.walletId, event.walletId),
          eq(depositAddresses.chain, event.chain),
          eq(depositAddresses.token, "USDC"),
        ),
      )
      .for("update")
      .limit(1);
    const derived = depositAddress
      ? deriveDepositAddress(
          activeMnemonic(),
          event.chain,
          event.walletId,
        )
      : null;
    if (
      !depositAddress ||
      !derived ||
      depositAddress.address.toLowerCase() !== event.toAddress.toLowerCase() ||
      !depositAddressMatches(event.chain, depositAddress, derived)
    ) {
      await tx
        .update(cryptoWebhookEvents)
        .set({
          status: "rejected",
          error: "inactive_deposit_address",
          lastCheckedAt: new Date(),
        })
        .where(
          and(
            eq(cryptoWebhookEvents.id, expected.id),
            eq(cryptoWebhookEvents.status, "pending"),
            eq(
              cryptoWebhookEvents.observationGeneration,
              expected.observationGeneration,
            ),
          ),
        );
      return false;
    }

    const creditedWallet = await tx
      .update(wallets)
      .set({ balance: sql`balance + ${credits}` })
      .where(
        and(
          eq(wallets.id, event.walletId),
          sql`${wallets.balance} <= ${MAX_EXACT_WALLET_BALANCE - credits}`,
        ),
      )
      .returning({ id: wallets.id });
    if (creditedWallet.length !== 1) {
      await tx
        .update(cryptoWebhookEvents)
        .set({
          status: "rejected",
          error: "wallet_balance_exact_limit",
          lastCheckedAt: new Date(),
        })
        .where(
          and(
            eq(cryptoWebhookEvents.id, expected.id),
            eq(cryptoWebhookEvents.status, "pending"),
            eq(
              cryptoWebhookEvents.observationGeneration,
              expected.observationGeneration,
            ),
          ),
        );
      return false;
    }
    const [credited] = await tx
      .update(cryptoWebhookEvents)
      .set({
        status: "credited",
        creditsAdded: credits,
        creditRemainderBase: "0",
        creditedGeneration: event.observationGeneration,
        blockNumber: evidence.blockNumber,
        blockHash: evidence.blockHash.toLowerCase(),
        lastCheckedAt: new Date(),
        confirmedAt: new Date(),
        error: null,
      })
      .where(
        and(
          eq(cryptoWebhookEvents.id, expected.id),
          eq(cryptoWebhookEvents.status, "pending"),
          eq(
            cryptoWebhookEvents.observationGeneration,
            expected.observationGeneration,
          ),
        ),
      )
      .returning({ id: cryptoWebhookEvents.id });
    if (!credited) {
      throw new Error("inbound_event_credit_cas_lost");
    }
    await tx.insert(transactions).values({
      walletId: event.walletId,
      type: "fund",
      amount: credits,
      counterparty: event.txHash,
      description: `${event.chain} USDC deposit confirmed`,
      metadata: {
        ...fundingMetadata(event.id, {
          chain: event.chain,
          txHash: event.txHash,
          logIndex: event.logIndex,
          amountBase: event.amountBase,
        }),
        observation_generation: event.observationGeneration,
      },
    });
    return true;
  });
}
