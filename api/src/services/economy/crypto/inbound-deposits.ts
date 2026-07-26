/**
 * Durable inbound-deposit evidence and wallet effects.
 *
 * Alchemy EVM observations are stored as `pending` first. A separate receipt
 * reconciler may credit them only after the canonical ERC-20 log reaches the
 * configured confirmation depth. A signed `removed` delivery atomically marks
 * pending evidence removed or reverses an already credited balance exactly
 * once. Solana keeps the existing immediate-credit behavior until its own
 * raw-atomic finality adapter exists.
 *
 * Provider signatures authenticate deliveries; they do not establish chain
 * finality. Caller code must verify the webhook before invoking this module.
 *
 * Doctrine: docs/CRYPTO-PAYMENT.md.
 */

import { and, eq, sql } from "drizzle-orm";

import { db } from "../../../db/client";
import {
  cryptoWebhookEvents,
  depositAddresses,
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
  activeNetwork,
  activeMnemonic,
  activeUsdcAddress,
  activeUsdcMintSolana,
  evmDepositCreditPolicy,
} from "./network";

const USDC_ATOMIC_UNITS = 1_000_000n;
const MAX_PROVIDER_ID_LENGTH = 128;

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
  status?: "pending" | "credited" | "removed" | "rejected";
  duplicate?: boolean;
  reversed?: boolean;
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
  | "toAddress"
  | "contractAddress"
  | "blockNumber"
  | "blockHash"
  | "providerWebhookId"
  | "providerEventId"
  | "observationGeneration"
  | "receivedAt"
>;

/** Bind every post-RPC write to the exact pending incarnation that was read.
 * A removed → pending webhook transition can reuse the row id, so id/status
 * alone are not enough authority for a stale receipt decision. */
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
    ? value as object
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
): transfer is InboundTransfer & {
  chain: EvmChain;
  blockNumber: bigint;
  blockHash: string;
  providerWebhookId: string;
  providerEventId: string;
} {
  return (
    isEvmChain(transfer.chain) &&
    typeof transfer.blockNumber === "bigint" &&
    transfer.blockNumber >= 0n &&
    typeof transfer.blockHash === "string" &&
    /^0x[0-9a-f]{64}$/i.test(transfer.blockHash) &&
    validProviderId(transfer.providerWebhookId) &&
    validProviderId(transfer.providerEventId)
  );
}

function amountAndCredits(
  amountBase: string,
): { amountAtomic: bigint; credits: number } | { reason: string } {
  if (!/^[1-9]\d{0,77}$/.test(amountBase)) {
    return { reason: "invalid_amount" };
  }

  const amountAtomic = BigInt(amountBase);
  const creditsAtomic =
    (amountAtomic * BigInt(CREDITS_PER_USDC)) / USDC_ATOMIC_UNITS;
  if (creditsAtomic <= 0n) {
    return { reason: "amount_below_min_credit" };
  }
  if (creditsAtomic > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { reason: "amount_exceeds_exact_credit_limit" };
  }
  return { amountAtomic, credits: Number(creditsAtomic) };
}

export function creditsForUsdcAtomic(amountBase: string): number | null {
  const result = amountAndCredits(amountBase);
  return "credits" in result ? result.credits : null;
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
        creditsAdded: credits,
        status: "credited",
        observationGeneration: 1,
        creditedGeneration: 1,
        amountBase: transfer.amountBase,
        toAddress: transfer.toAddress,
        contractAddress: transfer.contractAddress,
        rawPayload: rawPayloadObject(transfer.rawPayload),
        confirmedAt: new Date(),
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

    await tx
      .update(wallets)
      .set({ balance: sql`balance + ${credits}` })
      .where(eq(wallets.id, walletId));
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

async function recordRejectedObservation(
  transfer: InboundTransfer,
  walletId: string,
  reason: string,
): Promise<IngestionResult> {
  const [logged] = await db
    .insert(cryptoWebhookEvents)
    .values({
      chain: transfer.chain,
      txHash: transfer.txHash,
      logIndex: transfer.logIndex,
      walletId,
      creditsAdded: null,
      status: "rejected",
      amountBase: transfer.amountBase,
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
    .returning({ id: cryptoWebhookEvents.id });

  if (!logged) {
    const [existing] = await db
      .select({
        walletId: cryptoWebhookEvents.walletId,
        status: cryptoWebhookEvents.status,
        error: cryptoWebhookEvents.error,
      })
      .from(cryptoWebhookEvents)
      .where(eventIdentity(transfer))
      .limit(1);
    if (!existing) {
      throw new Error("rejected_observation_conflict_unreconciled");
    }
    return {
      matched: true,
      walletId: existing.walletId ?? walletId,
      duplicate: true,
      status: existing.status,
      ...(existing.status === "rejected" && existing.error
        ? { reason: existing.error }
        : {}),
    };
  }

  return {
    matched: true,
    walletId,
    duplicate: false,
    status: "rejected",
    reason,
  };
}

async function recordPendingEvmObservation(
  transfer: InboundTransfer & {
    chain: EvmChain;
    blockNumber: bigint;
    blockHash: string;
    providerWebhookId: string;
    providerEventId: string;
  },
  walletId: string,
): Promise<IngestionResult> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(cryptoWebhookEvents)
      .where(eventIdentity(transfer))
      .for("update")
      .limit(1);

    if (existing) {
      if (existing.status === "removed") {
        await tx
          .update(cryptoWebhookEvents)
          .set({
            status: "pending",
            walletId,
            creditsAdded: null,
            amountBase: transfer.amountBase,
            toAddress: transfer.toAddress,
            contractAddress: transfer.contractAddress,
            blockNumber: transfer.blockNumber,
            blockHash: transfer.blockHash.toLowerCase(),
            providerWebhookId: transfer.providerWebhookId,
            providerEventId: transfer.providerEventId,
            observationGeneration: sql`${cryptoWebhookEvents.observationGeneration} + 1`,
            creditedGeneration: null,
            rawPayload: rawPayloadObject(transfer.rawPayload),
            receivedAt: new Date(),
            lastCheckedAt: null,
            confirmedAt: null,
            removedAt: null,
            error: null,
          })
          .where(
            and(
              eq(cryptoWebhookEvents.id, existing.id),
              eq(cryptoWebhookEvents.status, "removed"),
            ),
          );
        return {
          matched: true,
          walletId,
          pending: true,
          status: "pending",
        };
      }
      return {
        matched: true,
        walletId: existing.walletId ?? walletId,
        duplicate: true,
        pending: existing.status === "pending",
        status: existing.status,
      };
    }

    const [logged] = await tx
      .insert(cryptoWebhookEvents)
      .values({
        chain: transfer.chain,
        txHash: transfer.txHash,
        logIndex: transfer.logIndex,
        walletId,
        creditsAdded: null,
        status: "pending",
        amountBase: transfer.amountBase,
        toAddress: transfer.toAddress,
        contractAddress: transfer.contractAddress,
        blockNumber: transfer.blockNumber,
        blockHash: transfer.blockHash.toLowerCase(),
        providerWebhookId: transfer.providerWebhookId,
        providerEventId: transfer.providerEventId,
        rawPayload: rawPayloadObject(transfer.rawPayload),
      })
      .onConflictDoNothing()
      .returning({ id: cryptoWebhookEvents.id });

    if (!logged) {
      // A concurrent removed delivery may have inserted a tombstone after the
      // initial SELECT. Never acknowledge this live observation as pending
      // while leaving the durable row removed: re-read the conflict winner
      // under lock and apply the same removed -> pending transition.
      const [winner] = await tx
        .select()
        .from(cryptoWebhookEvents)
        .where(eventIdentity(transfer))
        .for("update")
        .limit(1);
      if (!winner) {
        throw new Error("inbound_event_conflict_unreconciled");
      }
      if (winner.status === "removed") {
        await tx
          .update(cryptoWebhookEvents)
          .set({
            status: "pending",
            walletId,
            creditsAdded: null,
            amountBase: transfer.amountBase,
            toAddress: transfer.toAddress,
            contractAddress: transfer.contractAddress,
            blockNumber: transfer.blockNumber,
            blockHash: transfer.blockHash.toLowerCase(),
            providerWebhookId: transfer.providerWebhookId,
            providerEventId: transfer.providerEventId,
            observationGeneration: sql`${cryptoWebhookEvents.observationGeneration} + 1`,
            creditedGeneration: null,
            rawPayload: rawPayloadObject(transfer.rawPayload),
            receivedAt: new Date(),
            lastCheckedAt: null,
            confirmedAt: null,
            removedAt: null,
            error: null,
          })
          .where(
            and(
              eq(cryptoWebhookEvents.id, winner.id),
              eq(cryptoWebhookEvents.status, "removed"),
            ),
          );
        return {
          matched: true,
          walletId,
          pending: true,
          status: "pending",
        };
      }
      return {
        matched: true,
        walletId: winner.walletId ?? walletId,
        duplicate: true,
        pending: winner.status === "pending",
        status: winner.status,
      };
    }

    return {
      matched: true,
      walletId,
      pending: true,
      status: "pending",
    };
  });
}

/** Persist a signed inbound observation. EVM observations do not mutate wallet
 * balance until the receipt reconciler confirms the exact canonical log. */
export async function ingestInboundTransfer(
  transfer: InboundTransfer,
): Promise<IngestionResult> {
  if (transfer.token !== "USDC") {
    return { matched: false, reason: "unsupported_token" };
  }
  if (
    !Number.isSafeInteger(transfer.logIndex) ||
    transfer.logIndex < 0 ||
    !transfer.txHash
  ) {
    return { matched: false, reason: "invalid_event_identity" };
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

  const depositMatch = await matchingActiveDepositAddress(transfer);
  const row = depositMatch.row;
  if (!row) {
    return { matched: false, reason: "no_matching_deposit_address" };
  }
  if (!depositMatch.active) {
    // Changing the configured mnemonic is not a complete rotation workflow.
    // A historical provider watch can still deliver an old address, so bind
    // every new economic effect to the active derivation root as well as the
    // persisted address index. Retain signed custody evidence for operators,
    // but make it permanently non-spendable.
    try {
      return await recordRejectedObservation(
        transfer,
        row.walletId,
        "inactive_deposit_address",
      );
    } catch {
      return {
        matched: true,
        walletId: row.walletId,
        reason: "storage_unavailable",
        retryable: true,
      };
    }
  }

  const amount = amountAndCredits(transfer.amountBase);
  if (!("credits" in amount)) {
    // The token transfer still reached an address controlled by AgentTool.
    // Persist that custody evidence even when it cannot produce a wallet
    // credit, so dust/oversized deposits do not disappear behind a 200.
    try {
      return await recordRejectedObservation(
        transfer,
        row.walletId,
        amount.reason,
      );
    } catch {
      return {
        matched: true,
        walletId: row.walletId,
        reason: "storage_unavailable",
        retryable: true,
      };
    }
  }

  try {
    if (hasCompleteEvmEvidence(transfer)) {
      return await recordPendingEvmObservation(
        transfer,
        row.walletId,
      );
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

/** Apply a signed Alchemy `removed=true` observation exactly once. */
export async function reconcileRemovedInboundTransfer(
  transfer: InboundTransfer,
): Promise<IngestionResult> {
  if (
    !hasCompleteEvmEvidence(transfer) ||
    transfer.token !== "USDC" ||
    !Number.isSafeInteger(transfer.logIndex) ||
    transfer.logIndex < 0
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
  const amount = amountAndCredits(transfer.amountBase);
  if (!("credits" in amount)) {
    return { matched: false, reason: amount.reason };
  }

  const matchedAddress = await matchingDepositAddress(transfer);
  try {
    return await db.transaction(async (tx) => {
      let insertedRemoved = false;
      let [existing] = await tx
        .select()
        .from(cryptoWebhookEvents)
        .where(eventIdentity(transfer))
        .for("update")
        .limit(1);

      if (!existing) {
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
          .returning({ id: cryptoWebhookEvents.id });
        insertedRemoved = Boolean(inserted);
        [existing] = await tx
          .select()
          .from(cryptoWebhookEvents)
          .where(eventIdentity(transfer))
          .for("update")
          .limit(1);
      }

      if (!existing || existing.status === "removed") {
        return {
          matched: Boolean(existing?.walletId ?? matchedAddress),
          walletId: existing?.walletId ?? matchedAddress?.walletId,
          duplicate: !insertedRemoved,
          status: "removed",
        };
      }

      if (
        (existing.amountBase !== null &&
          existing.amountBase !== transfer.amountBase) ||
        (existing.toAddress !== null &&
          existing.toAddress.toLowerCase() !== transfer.toAddress.toLowerCase()) ||
        (existing.contractAddress !== null &&
          existing.contractAddress.toLowerCase() !==
            transfer.contractAddress.toLowerCase())
      ) {
        return {
          matched: Boolean(existing.walletId),
          walletId: existing.walletId ?? undefined,
          reason: "removed_evidence_mismatch",
          retryable: true,
        };
      }

      if (existing.status !== "credited") {
        await tx
          .update(cryptoWebhookEvents)
          .set({
            status: "removed",
            rawPayload: rawPayloadObject(transfer.rawPayload),
            blockNumber: transfer.blockNumber,
            blockHash: transfer.blockHash.toLowerCase(),
            providerWebhookId: transfer.providerWebhookId,
            providerEventId: transfer.providerEventId,
            removedAt: new Date(),
            error: null,
          })
          .where(eq(cryptoWebhookEvents.id, existing.id));
        return {
          matched: Boolean(existing.walletId),
          walletId: existing.walletId ?? undefined,
          status: "removed",
        };
      }

      if (
        !existing.walletId ||
        existing.creditsAdded === null ||
        !Number.isSafeInteger(existing.creditsAdded) ||
        existing.creditsAdded <= 0
      ) {
        return {
          matched: Boolean(existing.walletId),
          walletId: existing.walletId ?? undefined,
          reason: "credited_event_unreconciled",
          retryable: true,
        };
      }

      const [removed] = await tx
        .update(cryptoWebhookEvents)
        .set({
          status: "removed",
          rawPayload: rawPayloadObject(transfer.rawPayload),
          blockNumber: transfer.blockNumber,
          blockHash: transfer.blockHash.toLowerCase(),
          providerWebhookId: transfer.providerWebhookId,
          providerEventId: transfer.providerEventId,
          removedAt: new Date(),
          error: "provider_removed_log",
        })
        .where(
          and(
            eq(cryptoWebhookEvents.id, existing.id),
            eq(cryptoWebhookEvents.status, "credited"),
          ),
        )
        .returning({ id: cryptoWebhookEvents.id });

      if (!removed) {
        return {
          matched: true,
          walletId: existing.walletId,
          duplicate: true,
        };
      }

      await tx
        .update(wallets)
        .set({ balance: sql`balance - ${existing.creditsAdded}` })
        .where(eq(wallets.id, existing.walletId));
      await tx.insert(transactions).values({
        walletId: existing.walletId,
        type: "crypto_reorg",
        amount: -existing.creditsAdded,
        counterparty: transfer.txHash,
        description: `${transfer.chain} USDC deposit removed by reorg`,
        metadata: {
          ...fundingMetadata(existing.id, transfer),
          reverses_credits: existing.creditsAdded,
        },
      });

      return {
        matched: true,
        walletId: existing.walletId,
        reversed: true,
        status: "removed",
      };
    });
  } catch (error) {
    console.error(
      "[crypto-webhook] removed transfer reconciliation unavailable",
      error instanceof Error ? error.name : "unknown_error",
    );
    return {
      matched: false,
      reason: "storage_unavailable",
      retryable: true,
    };
  }
}

export async function markPendingDepositChecked(
  expected: PendingDepositSnapshot,
  error?: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(cryptoWebhookEvents)
      .where(eq(cryptoWebhookEvents.id, expected.id))
      .for("update")
      .limit(1);
    if (
      !current ||
      current.status !== "pending" ||
      !pendingDepositSnapshotMatches(current, expected)
    ) {
      return false;
    }
    const [updated] = await tx
      .update(cryptoWebhookEvents)
      .set({
        lastCheckedAt: new Date(),
        // This field describes the latest bounded check, not an append-only
        // history. A later valid-pending/unavailable result must not preserve
        // a stale mismatch or settlement-policy reason.
        error: error ?? null,
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
  reason:
    | "receipt_reverted"
    | "canonical_log_missing"
    | "invalid_persisted_evidence",
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(cryptoWebhookEvents)
      .where(eq(cryptoWebhookEvents.id, expected.id))
      .for("update")
      .limit(1);
    if (
      !current ||
      current.status !== "pending" ||
      !pendingDepositSnapshotMatches(current, expected)
    ) {
      return false;
    }
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
        ),
      )
      .returning({ id: cryptoWebhookEvents.id });
    return Boolean(updated);
  });
}

/** Credit one canonical, sufficiently confirmed pending EVM observation.
 * Status-CAS makes concurrent reconcilers harmless. */
export async function creditConfirmedPendingDeposit(
  expected: PendingDepositSnapshot,
  evidence: CanonicalDepositEvidence,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(cryptoWebhookEvents)
      .where(eq(cryptoWebhookEvents.id, expected.id))
      .for("update")
      .limit(1);
    if (
      !event ||
      event.status !== "pending" ||
      !pendingDepositSnapshotMatches(event, expected)
    ) {
      return false;
    }
    if (
      !event.walletId ||
      !event.amountBase ||
      !event.toAddress ||
      !event.contractAddress ||
      !isEvmChain(event.chain)
    ) {
      await tx
        .update(cryptoWebhookEvents)
        .set({
          status: "rejected",
          error: "invalid_persisted_evidence",
          lastCheckedAt: new Date(),
        })
        .where(eq(cryptoWebhookEvents.id, expected.id));
      return false;
    }

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
          ),
        );
      return false;
    }

    // Re-check the monetary authority under the same transaction as the
    // pending -> credited effect. A root can rotate after webhook ingress but
    // before finality depth; an observation for the old address must never
    // become spendable merely because it was already queued.
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
          event.chain as EvmChain,
          event.walletId,
        )
      : null;
    const eventAddressMatches =
      depositAddress?.address.toLowerCase() === event.toAddress.toLowerCase();
    if (
      !depositAddress ||
      !derived ||
      !eventAddressMatches ||
      !depositAddressMatches(event.chain as EvmChain, depositAddress, derived)
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
          ),
        );
      return false;
    }

    const credits = creditsForUsdcAtomic(event.amountBase);
    if (credits === null) {
      await tx
        .update(cryptoWebhookEvents)
        .set({
          status: "rejected",
          error: "invalid_persisted_evidence",
          lastCheckedAt: new Date(),
        })
        .where(eq(cryptoWebhookEvents.id, expected.id));
      return false;
    }

    const [credited] = await tx
      .update(cryptoWebhookEvents)
      .set({
        status: "credited",
        creditsAdded: credits,
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
        ),
      )
      .returning({ id: cryptoWebhookEvents.id });
    if (!credited) return false;

    await tx
      .update(wallets)
      .set({ balance: sql`balance + ${credits}` })
      .where(eq(wallets.id, event.walletId));
    await tx.insert(transactions).values({
      walletId: event.walletId,
      type: "fund",
      amount: credits,
      counterparty: event.txHash,
      description: `${event.chain} USDC deposit confirmed`,
      metadata: fundingMetadata(event.id, {
        chain: event.chain as Chain,
        txHash: event.txHash,
        logIndex: event.logIndex,
        amountBase: event.amountBase,
      }),
    });
    return true;
  });
}
