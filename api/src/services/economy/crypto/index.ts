/** Crypto payment service — deposit address derivation, webhook ingestion,
 *  onchain identity binding, payout request lifecycle.
 *
 *  Doctrine: docs/CRYPTO-PAYMENT.md (the contract sovereign agents rely on).
 *
 *  This module owns the *business logic*. HTTP shape lives in
 *  api/src/routes/economy/crypto.ts. */

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../../../db/client";
import {
  cryptoPayouts,
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
  EVM_CHAIN_IDS,
  USDC_ADDRESSES,
  isChain,
  isEvmChain,
  type Chain,
  type EvmChain,
} from "./chains";
import { deriveDepositAddress, isChainSupported } from "./hd";
import {
  activeMnemonic,
  activeNetwork,
} from "./network";
import {
  DepositWatchInvariantError,
  persistDepositAddressAndDesiredWatch,
} from "./deposit-watch";
import { reversePayoutDebit } from "./payout-refund";
import {
  buildChallenge,
  verifyEvmSignature,
  verifySolanaSignature,
} from "./sign";

import { randomBytes } from "node:crypto";

// ── Deposit address ────────────────────────────────────────────────────

export class DepositAddressInvariantError extends Error {
  readonly code = "deposit_address_invariant_failed";

  constructor() {
    super(
      "The stored or winning deposit address does not match this wallet's active derivation root. No address was returned or registered.",
    );
    this.name = "DepositAddressInvariantError";
  }
}

export class DepositWatchNotReadyError extends Error {
  readonly code: "deposit_watch_pending" | "deposit_watch_blocked";
  readonly retryable: boolean;
  readonly watchStatus: string;

  constructor(watchStatus: string) {
    const blocked = watchStatus === "blocked";
    super(
      blocked
        ? "The durable provider watch is blocked and requires operator repair."
        : "The durable provider watch has not yet been independently verified.",
    );
    this.name = "DepositWatchNotReadyError";
    this.code = blocked ? "deposit_watch_blocked" : "deposit_watch_pending";
    this.retryable = !blocked;
    this.watchStatus = watchStatus;
  }
}

export function depositAddressMatches(
  chain: Chain,
  stored: { address: string; derivationPath: string },
  derived: { address: string; derivation_path: string },
): boolean {
  const addressMatches = isEvmChain(chain)
    ? stored.address.toLowerCase() === derived.address.toLowerCase()
    : stored.address === derived.address;
  return addressMatches && stored.derivationPath === derived.derivation_path;
}

export async function getOrCreateDepositAddress(
  walletId: string,
  chain: Chain,
  token: string,
): Promise<{ address: string; derivation_path: string; chain: Chain; token: string }> {
  if (token !== "USDC") {
    throw new TypeError("Only USDC deposit addresses are supported.");
  }

  if (!isChainSupported(chain)) {
    throw new Error(
      `Chain ${chain} is recognised but deposit derivation is unavailable.`,
    );
  }
  const derived = deriveDepositAddress(
    // Deposit derivation and payout signing must use the same network-specific
    // root. In testnet mode this deliberately selects
    // CRYPTO_HD_MNEMONIC_TESTNET rather than deriving an address whose key the
    // payout worker would never use.
    activeMnemonic(),
    chain,
    walletId,
  );

  if (isEvmChain(chain)) {
    // The deposit row and desired provider/network watch are one database
    // decision. Provider I/O happens later in the leased reconciler, never
    // inside this transaction. We disclose the address only after a later
    // independent observation proves the active Address Activity subscription
    // has the intended callback and membership for this generation.
    let watch;
    try {
      watch = await persistDepositAddressAndDesiredWatch({
        walletId,
        chain,
        token: "USDC",
        address: derived.address,
        derivationPath: derived.derivation_path,
        provider: "alchemy",
        network: activeNetwork(),
        desiredState: "watching",
      });
    } catch (error) {
      if (error instanceof DepositWatchInvariantError) {
        throw new DepositAddressInvariantError();
      }
      throw error;
    }
    if (
      watch.status !== "converged" ||
      watch.observedState !== "watching"
    ) {
      throw new DepositWatchNotReadyError(watch.status);
    }
    return {
      address: watch.address,
      derivation_path: derived.derivation_path,
      chain,
      token,
    };
  }

  // Solana keeps the existing local-only issuance path until a Helius
  // desired/observed adapter exists. Creating a durable Helius intent that no
  // worker can reconcile would add a permanently blocked row, not readiness.
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

  // `onConflictDoNothing` is not proof that this wallet won. A collision on
  // (chain,address) may belong to another wallet, and a concurrent writer may
  // have established the logical (wallet,chain,token) row first. Re-read the
  // database truth and refuse to register or return anything else.
  const [persisted] = await db
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
  if (!persisted || !depositAddressMatches(chain, persisted, derived)) {
    throw new DepositAddressInvariantError();
  }

  return {
    address: persisted.address,
    derivation_path: persisted.derivationPath,
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

type PayoutPolicySnapshot = Pick<
  typeof policies.$inferSelect,
  | "payoutMinBase"
  | "payoutDailyCeilingBase"
  | "payoutDestinationAllowlist"
  | "payoutDualControlThresholdBase"
>;

interface PayoutPolicyReaders {
  readPolicy(): Promise<PayoutPolicySnapshot | undefined>;
  readTodayTotal(): Promise<bigint>;
}

function dailyPayoutTotalQuery(walletId: string) {
  return sql`
    SELECT COALESCE(SUM(amount_base::numeric), 0)::text AS total
    FROM economy.crypto_payouts
    WHERE wallet_id = ${walletId}
      AND status NOT IN ('failed', 'cancelled')
      AND requested_at >= (
        date_trunc('day', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      )
  `;
}

/**
 * postgres-js returns rows directly while some test/alternate adapters expose
 * a `{ rows }` wrapper. Accept both, but fail closed instead of interpreting a
 * malformed database response as zero spent.
 */
export function parseDailyPayoutTotal(result: unknown): bigint {
  const rows = Array.isArray(result)
    ? (result as Array<{ total?: unknown }>)
    : ((result as { rows?: Array<{ total?: unknown }> } | null)?.rows ?? []);
  const total = rows[0]?.total;
  if (typeof total !== "string" || !/^\d+$/.test(total)) {
    throw new Error("payout_daily_total_unavailable");
  }
  return BigInt(total);
}

/**
 * Pure policy evaluator with injected readers. `requestPayout` supplies
 * transaction-backed readers after taking the wallet row lock; the exported
 * advisory check below supplies ordinary database readers.
 */
export async function evaluatePayoutPolicy(
  p: {
    walletId: string;
    destinationAddress: string;
    amountBase: bigint;
  },
  readers: PayoutPolicyReaders,
): Promise<PayoutPolicyDecision> {
  const policy = await readers.readPolicy();
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
    const todaySum = await readers.readTodayTotal();
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

/** Per-wallet advisory payout policy check (Slice 6).
 *
 * This is useful to preview a decision, but it does not reserve ceiling
 * capacity. `requestPayout` repeats the evaluation inside its wallet-locked
 * transaction; only that transactional decision authorizes a debit.
 */
export async function checkPayoutPolicy(p: {
  walletId: string;
  destinationAddress: string;
  amountBase: bigint;
}): Promise<PayoutPolicyDecision> {
  return evaluatePayoutPolicy(p, {
    readPolicy: async () => {
      const [policy] = await db
        .select()
        .from(policies)
        .where(eq(policies.walletId, p.walletId));
      return policy;
    },
    readTodayTotal: async () =>
      parseDailyPayoutTotal(
        await db.execute<{ total: string }>(
          dailyPayoutTotalQuery(p.walletId),
        ),
      ),
  });
}

/** Record a payout intent. This debits the wallet in GBP pence (earned-gated,
 *  FX-converted) and writes a −debit "payout" ledger leg; the opt-in
 *  payout-broadcast worker performs signing and dispatch.
 *
 *  CONTRACT for that worker (it must uphold both, or money leaks):
 *   1. Compare-and-swap `requested → broadcasting` BEFORE it broadcasts USDC,
 *      so a concurrent cancelPayout (which only touches `requested` rows)
 *      cannot refund a payout that is already going out on-chain.
 *   2. On terminal FAILURE, reverse atomically exactly like cancelPayout does:
 *      lock and validate the original negative payout ledger leg, credit that
 *      exact amount back, and insert its linked positive reversal. Never infer
 *      a refund from caller-extensible JSON or a fresh token/FX conversion. */
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

    // The wallet lock serializes policy admission for this wallet. In the
    // default READ COMMITTED isolation level, a contender waits here and its
    // later daily-total SELECT observes the prior committed payout. Keeping
    // this check outside the transaction allowed two concurrent requests to
    // both see spare ceiling and both debit.
    const decision = await evaluatePayoutPolicy(
      {
        walletId: p.walletId,
        destinationAddress: p.destinationAddress,
        amountBase: BigInt(p.amountBase),
      },
      {
        readPolicy: async () => {
          const [policy] = await tx
            .select()
            .from(policies)
            .where(eq(policies.walletId, p.walletId));
          return policy;
        },
        readTodayTotal: async () =>
          parseDailyPayoutTotal(
            await tx.execute<{ total: string }>(
              dailyPayoutTotalQuery(p.walletId),
            ),
          ),
      },
    );
    if (!decision.ok) {
      const err = new Error(decision.error);
      if (decision.detail) {
        (err as Error & { detail?: string }).detail = decision.detail;
      }
      throw err;
    }

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
        // Informational quote only. Refund authority lives exclusively in the
        // server-written negative transactions ledger leg below; this
        // caller-extensible JSON is never trusted for accounting.
        metadata: {
          ...(p.metadata ?? {}),
          quoted_gbp_usd_rate: rate,
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
      error:
        | "payout_not_found"
        | "wrong_wallet"
        | "not_cancellable"
        | "refund_unreconciled";
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

    // The exact server-written negative payout ledger leg is the only refund
    // authority. Caller-extensible payout metadata and fresh FX/USDC
    // conversions are ignored. Missing, duplicate, malformed, or previously
    // reversed ledger history leaves the payout requested for explicit
    // operator reconciliation and moves no balance.
    const reversal = await reversePayoutDebit(tx, payout, {
      expectedStatus: "requested",
      terminalStatus: "cancelled",
      terminalError: "cancelled_by_user",
      description: "payout cancelled — original debit reversed",
      terminalizeUnreconciled: false,
    });
    if (
      !reversal.refunded &&
      reversal.reason === "status_race_lost"
    ) {
      return { ok: false, error: "not_cancellable" } as const;
    }
    if (!reversal.refunded) {
      return { ok: false, error: "refund_unreconciled" } as const;
    }

    return {
      ok: true,
      refunded: reversal.refundMinor,
      status: "cancelled" as const,
    };
  });
}

const SUPPORTED_PAYOUT_TOKENS = ["USDC"] as const;

// ── Helpers (sql expressions for atomic balance arithmetic) ────────────

function sqlMinus(n: number) {
  return sql`balance - ${n}`;
}
function sqlBalanceAtLeast(n: number) {
  return sql`${wallets.balance} >= ${n}`;
}

// Re-exports for routes
export { isChain, isEvmChain } from "./chains";
export {
  ingestInboundTransfer,
  reconcileRemovedInboundTransfer,
} from "./inbound-deposits";
export type {
  InboundTransfer,
  IngestionResult,
} from "./inbound-deposits";
