/** Crypto payment service — deposit address derivation, webhook ingestion,
 *  onchain identity binding, payout request lifecycle.
 *
 *  Doctrine: docs/CRYPTO-PAYMENT.md (the contract sovereign agents rely on).
 *
 *  This module owns the *business logic*. HTTP shape lives in
 *  api/src/routes/economy/crypto.ts. */

import { and, desc, eq } from "drizzle-orm";

import { db } from "../../../db/client";
import {
  cryptoPayouts,
  cryptoWebhookEvents,
  depositAddresses,
  onchainIdentities,
  wallets,
} from "../../../db/schema/economy";
import { economyConfig } from "../config";
import {
  CREDITS_PER_USDC,
  EVM_CHAIN_IDS,
  USDC_ADDRESSES,
  isChain,
  isEvmChain,
  type Chain,
  type EvmChain,
} from "./chains";
import { deriveDepositAddress, isChainSupported } from "./hd";
import {
  buildChallenge,
  verifyEvmSignature,
  verifySolanaSignature,
} from "./sign";

import { randomBytes } from "node:crypto";

// ── Deposit address ────────────────────────────────────────────────────

export async function getOrCreateDepositAddress(
  walletId: string,
  chain: Chain,
  token: string,
): Promise<{ address: string; derivation_path: string; chain: Chain; token: string }> {
  // Already minted?
  const existing = await db
    .select()
    .from(depositAddresses)
    .where(
      and(
        eq(depositAddresses.walletId, walletId),
        eq(depositAddresses.chain, chain),
        eq(depositAddresses.token, token),
      ),
    )
    .limit(1);

  if (existing[0]) {
    return {
      address: existing[0].address,
      derivation_path: existing[0].derivationPath,
      chain,
      token,
    };
  }

  if (!isChainSupported(chain)) {
    throw new Error(
      `Chain ${chain} is recognised but deposit derivation is pending Phase 3c.`,
    );
  }
  if (!economyConfig.cryptoHdMnemonic) {
    throw new Error(
      "CRYPTO_HD_MNEMONIC is not set. Set the env var to a valid BIP-39 mnemonic " +
        "to mint deposit addresses. See docs/CRYPTO-PAYMENT.md.",
    );
  }

  const derived = deriveDepositAddress(
    economyConfig.cryptoHdMnemonic,
    chain,
    walletId,
  );

  await db
    .insert(depositAddresses)
    .values({
      walletId,
      chain,
      token,
      address: derived.address,
      derivationPath: derived.derivation_path,
    })
    .onConflictDoNothing(); // race: another caller minted in parallel

  return {
    address: derived.address,
    derivation_path: derived.derivation_path,
    chain,
    token,
  };
}

export async function listDepositAddresses(walletId: string) {
  return db
    .select()
    .from(depositAddresses)
    .where(eq(depositAddresses.walletId, walletId))
    .orderBy(depositAddresses.chain, depositAddresses.token);
}

// ── Onchain identity binding ───────────────────────────────────────────

interface ChallengeRecord {
  walletId: string;
  nonce: string;
  message: string;
  expiresAt: number;
}

// In-memory challenge store. 5-minute TTL. For multi-instance deployment,
// move to Redis (Phase 3c).
const challenges = new Map<string, ChallengeRecord>();
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

function pruneExpired() {
  const now = Date.now();
  for (const [k, v] of challenges) {
    if (v.expiresAt < now) challenges.delete(k);
  }
}

export function issueChallenge(
  walletId: string,
  chain: Chain,
): { nonce: string; message: string; expires_at: string } {
  pruneExpired();
  const nonce = randomBytes(16).toString("hex");
  const message = buildChallenge({
    walletId,
    nonce,
    chainId: isEvmChain(chain) ? EVM_CHAIN_IDS[chain] : undefined,
  });
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;
  challenges.set(nonce, { walletId, nonce, message, expiresAt });

  return {
    nonce,
    message,
    expires_at: new Date(expiresAt).toISOString(),
  };
}

export interface VerifyParams {
  walletId: string;
  chain: Chain;
  address: string;
  signature: string;
  nonce: string;
}

export async function verifyAndBind(
  p: VerifyParams,
): Promise<{ id: string; address: string; verified_at: string } | { error: string }> {
  const stored = challenges.get(p.nonce);
  if (!stored) return { error: "challenge_not_found_or_expired" };
  if (stored.walletId !== p.walletId) return { error: "challenge_wallet_mismatch" };
  if (stored.expiresAt < Date.now()) {
    challenges.delete(p.nonce);
    return { error: "challenge_expired" };
  }

  const ok = isEvmChain(p.chain)
    ? verifyEvmSignature(stored.message, p.signature, p.address)
    : p.chain === "solana"
      ? verifySolanaSignature(stored.message, p.signature, p.address)
      : false;
  if (!ok) return { error: "signature_invalid" };

  challenges.delete(p.nonce);

  const inserted = await db
    .insert(onchainIdentities)
    .values({
      walletId: p.walletId,
      chain: p.chain,
      address: p.address,
      challenge: stored.message,
      signature: p.signature,
    })
    .onConflictDoUpdate({
      target: [onchainIdentities.chain, onchainIdentities.address],
      set: {
        walletId: p.walletId,
        challenge: stored.message,
        signature: p.signature,
        verifiedAt: new Date(),
      },
    })
    .returning({ id: onchainIdentities.id, verifiedAt: onchainIdentities.verifiedAt });

  const row = inserted[0]!;
  return {
    id: row.id,
    address: p.address,
    verified_at: row.verifiedAt.toISOString(),
  };
}

export async function listOnchainIdentities(walletId: string) {
  return db
    .select()
    .from(onchainIdentities)
    .where(eq(onchainIdentities.walletId, walletId))
    .orderBy(desc(onchainIdentities.verifiedAt));
}

// ── Payout request lifecycle ───────────────────────────────────────────

export interface PayoutRequest {
  walletId: string;
  projectId: string;
  chain: Chain;
  token: string;
  amountBase: string;          // base units (USDC: 1 USDC = "1000000")
  destinationAddress: string;
  metadata?: Record<string, unknown>;
}

/** Record a payout intent. The actual signing + broadcast lands in Phase 3c
 *  — for the foundation we lock the equivalent credits and surface a
 *  pending request the agent can poll. */
export async function requestPayout(
  p: PayoutRequest,
): Promise<{ id: string; status: string; broadcast_pending: true }> {
  if (!(SUPPORTED_PAYOUT_TOKENS as readonly string[]).includes(p.token)) {
    throw new Error(`token ${p.token} not yet supported for payout`);
  }
  // Convert amount to credits (USDC base 1e6 → credits at CREDITS_PER_USDC).
  const amountUsdc = Number(p.amountBase) / 1_000_000;
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
    throw new Error("amount_base must be a positive integer (token base units)");
  }
  const creditsRequired = Math.ceil(amountUsdc * CREDITS_PER_USDC);

  // Atomic debit — fails if insufficient balance.
  const debit = await db
    .update(wallets)
    .set({ balance: sqlMinus(creditsRequired) })
    .where(and(eq(wallets.id, p.walletId), sqlBalanceAtLeast(creditsRequired)))
    .returning({ balance: wallets.balance });

  if (debit.length === 0) {
    throw new Error("insufficient_balance");
  }

  const [inserted] = await db
    .insert(cryptoPayouts)
    .values({
      walletId: p.walletId,
      projectId: p.projectId,
      chain: p.chain,
      token: p.token,
      amountBase: p.amountBase,
      destinationAddress: p.destinationAddress,
      status: "requested",
      metadata: p.metadata ?? {},
    })
    .returning({ id: cryptoPayouts.id });

  return {
    id: inserted!.id,
    status: "requested",
    broadcast_pending: true,
  };
}

export async function listPayouts(walletId: string) {
  return db
    .select()
    .from(cryptoPayouts)
    .where(eq(cryptoPayouts.walletId, walletId))
    .orderBy(desc(cryptoPayouts.requestedAt));
}

export interface CancelPayoutParams {
  walletId: string;
  payoutId: string;
  projectId: string;
}

export type CancelPayoutResult =
  | { ok: true; refunded: number; status: "cancelled" }
  | {
      ok: false;
      error: "payout_not_found" | "wrong_wallet" | "not_cancellable";
      currentStatus?: string;
    };

/** Cancel a payout still in 'requested' state and refund the credits.
 *  Atomic: status compare-and-swap (`WHERE status='requested'`) plus balance
 *  credit, all in one transaction — so concurrent cancel attempts can't
 *  double-refund and a worker that has just picked up the row (status flipped
 *  to 'broadcasting' or further) loses cleanly with `not_cancellable`.
 *  Returns `wrong_wallet` on cross-wallet access; the route layer should
 *  mask that as 404 to avoid payout-id enumeration. */
export async function cancelPayout(
  p: CancelPayoutParams,
): Promise<CancelPayoutResult> {
  return await db.transaction(async (tx) => {
    const [payout] = await tx
      .select()
      .from(cryptoPayouts)
      .where(eq(cryptoPayouts.id, p.payoutId))
      .limit(1);

    if (!payout) return { ok: false, error: "payout_not_found" } as const;
    if (payout.walletId !== p.walletId) {
      return { ok: false, error: "wrong_wallet" } as const;
    }
    if (payout.status !== "requested") {
      return {
        ok: false,
        error: "not_cancellable",
        currentStatus: payout.status,
      } as const;
    }

    const amountUsdc = Number(payout.amountBase) / 1_000_000;
    const credits = Math.ceil(amountUsdc * CREDITS_PER_USDC);

    const newMetadata = {
      ...((payout.metadata as Record<string, unknown> | null) ?? {}),
      cancelled_at: new Date().toISOString(),
      cancelled_by: "user",
    };

    // Compare-and-swap on status: only the first canceller wins. A worker
    // that has just flipped this to 'broadcasting' would also lose here.
    const updated = await tx
      .update(cryptoPayouts)
      .set({
        status: "cancelled",
        error: "cancelled_by_user",
        metadata: newMetadata,
      })
      .where(
        and(
          eq(cryptoPayouts.id, p.payoutId),
          eq(cryptoPayouts.status, "requested"),
        ),
      )
      .returning({ id: cryptoPayouts.id });

    if (updated.length === 0) {
      return { ok: false, error: "not_cancellable" } as const;
    }

    await tx
      .update(wallets)
      .set({ balance: sqlPlus(credits) })
      .where(eq(wallets.id, payout.walletId));

    return { ok: true, refunded: credits, status: "cancelled" as const };
  });
}

const SUPPORTED_PAYOUT_TOKENS = ["USDC"] as const;

// ── Inbound webhook ingestion ──────────────────────────────────────────

export interface InboundTransfer {
  chain: Chain;
  txHash: string;
  logIndex: number | null;
  toAddress: string;
  contractAddress: string;
  token: string;
  amountBase: string;       // token base units
  rawPayload: unknown;
}

export interface IngestionResult {
  matched: boolean;
  walletId?: string;
  creditsAdded?: number;
  duplicate?: boolean;
  reason?: string;
}

/** Apply an inbound transfer to a wallet. Idempotent on (chain, txHash,
 *  logIndex). Caller is responsible for verifying webhook signature
 *  before invoking. */
export async function ingestInboundTransfer(
  t: InboundTransfer,
): Promise<IngestionResult> {
  // Token sanity: only USDC routed for now.
  if (t.token !== "USDC") {
    return { matched: false, reason: "unsupported_token" };
  }
  // Confirm contract for EVM chains.
  if (isEvmChain(t.chain)) {
    const expected = USDC_ADDRESSES[t.chain].toLowerCase();
    if (t.contractAddress.toLowerCase() !== expected) {
      return { matched: false, reason: "wrong_contract" };
    }
  }

  // Find the wallet — case-insensitive lookup on (chain, address).
  const matches = await db
    .select()
    .from(depositAddresses)
    .where(
      and(
        eq(depositAddresses.chain, t.chain),
        eq(depositAddresses.address, t.toAddress),
      ),
    )
    .limit(1);

  // EVM addresses may be checksummed differently — fall back to lowercase.
  let row: typeof depositAddresses.$inferSelect | undefined = matches[0];
  if (!row) {
    const all = await db
      .select()
      .from(depositAddresses)
      .where(eq(depositAddresses.chain, t.chain));
    row = all.find(
      (r) => r.address.toLowerCase() === t.toAddress.toLowerCase(),
    );
  }
  if (!row) return { matched: false, reason: "no_matching_deposit_address" };
  const matchedRow = row;

  // Convert base units → credits.
  const amountUsdc = Number(t.amountBase) / 1_000_000;
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
    return { matched: false, reason: "invalid_amount" };
  }
  const creditsToAdd = Math.floor(amountUsdc * CREDITS_PER_USDC);
  if (creditsToAdd <= 0) return { matched: false, reason: "amount_below_min_credit" };

  // Idempotent insert into webhook log + funding via transaction.
  try {
    return await db.transaction(async (tx) => {
      const [logged] = await tx
        .insert(cryptoWebhookEvents)
        .values({
          chain: t.chain,
          txHash: t.txHash,
          logIndex: t.logIndex,
          walletId: matchedRow.walletId,
          creditsAdded: creditsToAdd,
          rawPayload: (t.rawPayload as object) ?? {},
        })
        .onConflictDoNothing()
        .returning({ id: cryptoWebhookEvents.id });

      if (!logged) {
        return {
          matched: true,
          walletId: matchedRow.walletId,
          duplicate: true,
        } satisfies IngestionResult;
      }

      // Credit wallet atomically.
      await tx
        .update(wallets)
        .set({ balance: sqlPlus(creditsToAdd) })
        .where(eq(wallets.id, matchedRow.walletId));

      return {
        matched: true,
        walletId: matchedRow.walletId,
        creditsAdded: creditsToAdd,
      } satisfies IngestionResult;
    });
  } catch (err) {
    return {
      matched: false,
      reason: `db_error: ${(err as Error).message}`,
    };
  }
}

// ── Helpers (sql expressions for atomic balance arithmetic) ────────────

import { sql } from "drizzle-orm";

function sqlMinus(n: number) {
  return sql`balance - ${n}`;
}
function sqlPlus(n: number) {
  return sql`balance + ${n}`;
}
function sqlBalanceAtLeast(n: number) {
  return sql`${wallets.balance} >= ${n}`;
}

// Re-exports for routes
export { isChain, isEvmChain } from "./chains";
