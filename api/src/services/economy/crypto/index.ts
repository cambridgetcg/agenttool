/** Crypto payment service — deposit address derivation, webhook ingestion,
 *  onchain identity binding, payout request lifecycle.
 *
 *  Doctrine: docs/CRYPTO-PAYMENT.md (the contract sovereign agents rely on).
 *
 *  This module owns the *business logic*. HTTP shape lives in
 *  api/src/routes/economy/crypto.ts. */

import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "../../../db/client";
import {
  cryptoPayouts,
  cryptoWebhookEvents,
  depositAddresses,
  onchainIdentities,
  policies,
  transactions,
  wallets,
} from "../../../db/schema/economy";
import { economyConfig } from "../config";
import {
  EARNED_INFLOW_TYPES,
  drawableWallPence,
  penceForUsdcPayout,
} from "../earned";
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
import { activeUsdcAddress } from "./network";
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

export type PayoutPolicyDecision =
  | { ok: true }
  | {
      ok: false;
      error:
        | "payout_below_min"
        | "destination_not_allowlisted"
        | "payout_exceeds_daily_ceiling"
        | "payout_dual_control_required";
      detail?: string;
    };

/** Per-wallet payout policy check (Slice 6). Returns ok=true if no policy
 *  is set or all gates pass. Caller throws the error string on ok=false;
 *  the route layer maps the message to HTTP 403. */
export async function checkPayoutPolicy(p: {
  walletId: string;
  destinationAddress: string;
  amountBase: bigint;
}): Promise<PayoutPolicyDecision> {
  const [policy] = await db
    .select()
    .from(policies)
    .where(eq(policies.walletId, p.walletId));
  if (!policy) return { ok: true };

  if (
    policy.payoutMinBase !== null &&
    p.amountBase < BigInt(policy.payoutMinBase)
  ) {
    return {
      ok: false,
      error: "payout_below_min",
      detail: `min ${policy.payoutMinBase} base units; got ${p.amountBase}`,
    };
  }

  if (
    policy.payoutDestinationAllowlist &&
    policy.payoutDestinationAllowlist.length > 0 &&
    !policy.payoutDestinationAllowlist.includes(p.destinationAddress)
  ) {
    return { ok: false, error: "destination_not_allowlisted" };
  }

  if (policy.payoutDailyCeilingBase !== null) {
    // Sum across non-terminal-failure rows on the rolling UTC day. Drizzle's
    // db.execute() with the postgres-js driver returns an Array<row>
    // directly — not a { rows: [...] } wrapper. Pre-fix, we read .rows
    // (undefined) and always saw a sum of 0, silently disabling the ceiling.
    const result = await db.execute<{ total: string }>(sql`
      SELECT COALESCE(SUM(amount_base::numeric), 0)::text AS total
      FROM economy.crypto_payouts
      WHERE wallet_id = ${p.walletId}
        AND status NOT IN ('failed', 'cancelled')
        AND requested_at >= date_trunc('day', NOW() AT TIME ZONE 'UTC')
    `);
    const rows = (Array.isArray(result)
      ? (result as Array<{ total: string }>)
      : ((result as unknown as { rows?: Array<{ total: string }> }).rows ?? []));
    const todaySum = BigInt(rows[0]?.total ?? "0");
    const ceiling = BigInt(policy.payoutDailyCeilingBase);
    if (todaySum + p.amountBase > ceiling) {
      return {
        ok: false,
        error: "payout_exceeds_daily_ceiling",
        detail: `today_used=${todaySum} new=${p.amountBase} ceiling=${ceiling}`,
      };
    }
  }

  if (
    policy.payoutDualControlThresholdBase !== null &&
    p.amountBase >= BigInt(policy.payoutDualControlThresholdBase)
  ) {
    return {
      ok: false,
      error: "payout_dual_control_required",
      detail:
        "dual-control flow not yet implemented; below-threshold payouts only",
    };
  }

  return { ok: true };
}

/** Record a payout intent. This debits the wallet in GBP pence (earned-gated,
 *  FX-converted) and writes a −debit "payout" ledger leg; the actual signing +
 *  broadcast happens later in the payout-broadcast worker (Phase 3c).
 *
 *  CONTRACT for that worker (it must uphold both, or money leaks):
 *   1. Compare-and-swap `requested → broadcasting` BEFORE it broadcasts USDC,
 *      so a concurrent cancelPayout (which only touches `requested` rows)
 *      cannot refund a payout that is already going out on-chain.
 *   2. On terminal FAILURE, reverse atomically exactly like cancelPayout does:
 *      credit `balance` back by the row's debited_minor AND insert a positive
 *      "payout" leg so the earned wall un-counts it. Do NOT leave the −debit
 *      leg standing with the balance un-refunded (strands funds), nor refund
 *      without reversing the leg (permanently shrinks the wall). */
export async function requestPayout(
  p: PayoutRequest,
): Promise<{ id: string; status: string; broadcast_pending: true }> {
  if (!(SUPPORTED_PAYOUT_TOKENS as readonly string[]).includes(p.token)) {
    throw new Error(`token ${p.token} not yet supported for payout`);
  }
  // Option A explicit FX: earned value is GBP pence; a payout of `amountBase`
  // USDC costs the wallet `penceRequired` at the operator rate. penceForUsdcPayout
  // throws `payout_fx_rate_unset` (rate ≤ 0) or `amount_base_must_be_positive`.
  const rate = economyConfig.payout.gbpUsdRate;
  const penceRequired = penceForUsdcPayout(p.amountBase, rate);

  // Policy check BEFORE debit. Throws the typed error string; the route
  // layer maps it to HTTP 403 with a `detail` field.
  const decision = await checkPayoutPolicy({
    walletId: p.walletId,
    destinationAddress: p.destinationAddress,
    amountBase: BigInt(p.amountBase),
  });
  if (!decision.ok) {
    const err = new Error(decision.error);
    if (decision.detail) (err as Error & { detail?: string }).detail = decision.detail;
    throw err;
  }

  return await db.transaction(async (tx) => {
    // Lock the wallet: the earned wall and the debit are computed under it so
    // concurrent payouts/reinvests serialise and can't each spend the same
    // earned pennies (mirrors reinvestFromWallet).
    const [wallet] = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.id, p.walletId))
      .for("update");
    if (!wallet) throw new Error("wallet_not_found");
    // Option A pins payout to GBP wallets, so `balance` is unambiguously pence
    // and directly comparable to the earned wall. Mirrors the reinvest guard.
    if (wallet.currency !== "GBP") throw new Error("payout_requires_gbp_wallet");

    // The shared earned wall (GBP pence): earned − reinvested − paidout. The
    // birth credit (type "fund") and USDC deposits are NOT in EARNED_INFLOW_TYPES,
    // so they are not cashable — this is what closes the mint-hole.
    const [earnedRow] = await tx
      .select({ total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)` })
      .from(transactions)
      .where(
        and(
          eq(transactions.walletId, p.walletId),
          inArray(transactions.type, EARNED_INFLOW_TYPES as unknown as string[]),
        ),
      );
    const [reinvestRow] = await tx
      .select({ total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)` })
      .from(transactions)
      .where(and(eq(transactions.walletId, p.walletId), eq(transactions.type, "reinvest")));
    const [paidOutRow] = await tx
      .select({ total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)` })
      .from(transactions)
      .where(and(eq(transactions.walletId, p.walletId), eq(transactions.type, "payout")));

    const earned = Number(earnedRow?.total ?? 0); // positive
    const reinvested = -Number(reinvestRow?.total ?? 0); // reinvest legs negative
    const paidOut = -Number(paidOutRow?.total ?? 0); // payout legs negative
    const payoutable = drawableWallPence(earned, reinvested, paidOut);

    if (penceRequired > payoutable) {
      const err = new Error("payout_exceeds_earned");
      (err as Error & { detail?: string }).detail =
        `earned=${earned} reinvested=${reinvested} paid_out=${paidOut} ` +
        `available_pence=${Math.max(0, payoutable)} required_pence=${penceRequired}. ` +
        `Only earned revenue (gallery sales + escrow releases) is payable; ` +
        `free-funded and birth-credit balance is not.`;
      throw err;
    }

    // Atomic balance debit (backstop; the earned wall above is the binding gate).
    const debit = await tx
      .update(wallets)
      .set({ balance: sqlMinus(penceRequired) })
      .where(and(eq(wallets.id, p.walletId), sqlBalanceAtLeast(penceRequired)))
      .returning({ balance: wallets.balance });
    if (debit.length === 0) throw new Error("insufficient_balance");

    const [inserted] = await tx
      .insert(cryptoPayouts)
      .values({
        walletId: p.walletId,
        projectId: p.projectId,
        chain: p.chain,
        token: p.token,
        amountBase: p.amountBase,
        destinationAddress: p.destinationAddress,
        status: "requested",
        // debited_minor is the source of truth for the refund on cancel — the
        // FX rate may move between request and cancel, so we refund what was
        // actually taken, never a re-derived amount.
        metadata: {
          ...(p.metadata ?? {}),
          debited_minor: penceRequired,
          debit_currency: "GBP",
          gbp_usd_rate: rate,
        },
      })
      .returning({ id: cryptoPayouts.id });

    // Ledger leg (negative = value leaving) so the earned wall stays
    // self-consistent and future payouts/reinvests count this one.
    await tx.insert(transactions).values({
      walletId: p.walletId,
      type: "payout",
      amount: -penceRequired,
      counterparty: p.destinationAddress,
      description:
        `payout requested — ${penceRequired} pence for ${Number(p.amountBase) / 1_000_000} ` +
        `${p.token} @ ${rate} USD/GBP`,
      metadata: { payout_id: inserted!.id, amount_base: p.amountBase, token: p.token },
    });

    return {
      id: inserted!.id,
      status: "requested",
      broadcast_pending: true as const,
    };
  });
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

    // Refund exactly what requestPayout debited. For rows this gate created,
    // that amount is stored (debited_minor) — needed because the FX rate may
    // have moved since the request. We trust it ONLY when the row also carries
    // this code's server-set markers (requestPayout writes debit_currency +
    // gbp_usd_rate AFTER spreading user metadata, so on gated rows they are
    // authoritative and cannot be forged by the caller). A row lacking the
    // markers predates this gate; recompute its refund from the server-owned
    // amountBase column, never from user-writable metadata, so a poisoned
    // debited_minor can't over-refund into free spendable balance. (No such
    // legacy rows exist today — payout has never been enabled — so this is
    // defence in depth; see the PR's broadcast-worker contract note.)
    const payoutMeta = (payout.metadata as Record<string, unknown> | null) ?? {};
    const gated =
      payoutMeta.debit_currency === "GBP" &&
      typeof payoutMeta.gbp_usd_rate === "number";
    const refundMinor = gated
      ? Number(payoutMeta.debited_minor ?? 0)
      : Math.ceil((Number(payout.amountBase) / 1_000_000) * CREDITS_PER_USDC);

    const newMetadata = {
      ...payoutMeta,
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
      .set({ balance: sqlPlus(refundMinor) })
      .where(eq(wallets.id, payout.walletId));

    // Reverse the ledger leg only for gated rows: they wrote a −debit "payout"
    // leg at request, so this positive leg nets it to zero and the earned wall
    // stops counting the cancelled payout. Legacy rows never wrote a leg, so
    // there is nothing to net — writing one would wrongly inflate the wall.
    if (gated) {
      await tx.insert(transactions).values({
        walletId: payout.walletId,
        type: "payout",
        amount: refundMinor,
        counterparty: payout.destinationAddress,
        description: `payout cancelled — refunded ${refundMinor} pence`,
        metadata: { payout_id: payout.id, reverses: "payout" },
      });
    }

    return { ok: true, refunded: refundMinor, status: "cancelled" as const };
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
  // Confirm contract for EVM chains. Use activeUsdcAddress so testnet
  // operation matches the Sepolia/Amoy USDC contracts (different from
  // their mainnet counterparts). Without this, inbound testnet webhooks
  // silently bail with `wrong_contract`.
  if (isEvmChain(t.chain)) {
    const expected = activeUsdcAddress(t.chain).toLowerCase();
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
