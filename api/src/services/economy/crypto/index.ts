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
import {
  activeMnemonic,
  activeUsdcAddress,
  activeUsdcMintSolana,
} from "./network";
import { ensureAlchemyAddressWatched } from "./alchemy-notify";
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
    const expected = deriveDepositAddress(activeMnemonic(), chain, walletId);
    if (!depositAddressMatches(chain, existing[0], expected)) {
      // Existing rows minted under a different mnemonic/network are not safe
      // to advertise: the active payout signer may not control them.
      throw new DepositAddressInvariantError();
    }
    if (isEvmChain(chain)) {
      // The provider update is idempotent. Reassert it on every read so a
      // transient registration failure can be repaired by retrying this
      // endpoint, and so an existing DB row is never mistaken for proof that
      // Alchemy is actually watching the address.
      await ensureAlchemyAddressWatched({
        chain,
        address: existing[0].address,
      });
    }
    return {
      address: existing[0].address,
      derivation_path: existing[0].derivationPath,
      chain,
      token,
    };
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

  if (isEvmChain(chain)) {
    // Do not return deposit instructions until the corresponding Alchemy
    // Address Activity webhook has accepted this address. If registration is
    // unavailable, the DB row remains safe and the next identical GET retries
    // the idempotent provider update.
    await ensureAlchemyAddressWatched({
      chain,
      address: persisted.address,
    });
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

// ── Inbound webhook ingestion ──────────────────────────────────────────

export interface InboundTransfer {
  chain: Chain;
  txHash: string;
  logIndex: number;
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
  retryable?: boolean;
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
  } else if (
    t.chain === "solana" &&
    t.contractAddress !== activeUsdcMintSolana()
  ) {
    return { matched: false, reason: "wrong_contract" };
  }

  // EVM addresses are case-insensitive and use a functional lower(address)
  // predicate backed by the deployment migration's partial index. Solana
  // base58 addresses are case-sensitive and must match exactly.
  const addressPredicate = isEvmChain(t.chain)
    ? sql`lower(${depositAddresses.address}) = lower(${t.toAddress})`
    : eq(depositAddresses.address, t.toAddress);
  const [row] = await db
    .select()
    .from(depositAddresses)
    .where(
      and(
        eq(depositAddresses.chain, t.chain),
        addressPredicate,
      ),
    )
    .limit(1);
  if (!row) return { matched: false, reason: "no_matching_deposit_address" };
  const matchedRow = row;

  // Convert exact base units → credits without passing token value through a
  // floating-point number. The wallet balance is a JavaScript number in the
  // current schema, so reject values beyond its exact integer range.
  let amountAtomic: bigint;
  try {
    amountAtomic = BigInt(t.amountBase);
  } catch {
    return { matched: false, reason: "invalid_amount" };
  }
  if (amountAtomic <= 0n) return { matched: false, reason: "invalid_amount" };
  const creditsAtomic =
    (amountAtomic * BigInt(CREDITS_PER_USDC)) / 1_000_000n;
  if (creditsAtomic <= 0n) {
    return { matched: false, reason: "amount_below_min_credit" };
  }
  if (creditsAtomic > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { matched: false, reason: "amount_exceeds_exact_credit_limit" };
  }
  const creditsToAdd = Number(creditsAtomic);

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
    // Provider delivery must receive a non-2xx response so it retries. Keep
    // the database message out of the model/public response: it can contain
    // infrastructure detail and is not needed to make the retry decision.
    console.error(
      "[crypto-webhook] inbound transfer storage unavailable",
      err instanceof Error ? err.name : "unknown_error",
    );
    return {
      matched: false,
      reason: "storage_unavailable",
      retryable: true,
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
