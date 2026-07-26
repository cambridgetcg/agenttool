/** Crypto payment service — deposit address derivation, webhook ingestion,
 *  onchain identity binding, payout request lifecycle.
 *
 *  Doctrine: docs/CRYPTO-PAYMENT.md (the contract sovereign agents rely on).
 *
 *  This module owns the *business logic*. HTTP shape lives in
 *  api/src/routes/economy/crypto.ts. */

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../../db/client";
import {
  cryptoPayouts,
  depositAddresses,
  onchainIdentities,
  payoutRequestIdempotency,
  policies,
} from "../../../db/schema/economy";
import { economyConfig } from "../config";
import {
  EVM_CHAIN_IDS,
  USDC_ADDRESSES,
  isChain,
  isEvmChain,
  type Chain,
  type EvmChain,
} from "./chains";
import {
  depositAddressMatches,
  deriveDepositAddress,
  isChainSupported,
} from "./hd";
import {
  assertEvmDepositCreditSupported,
  activeMnemonic,
  activeNetwork,
} from "./network";
import {
  alchemyDepositWatchTargetFromEnv,
  parseAlchemyWatchDisabledChains,
  parseAlchemyWatchTargetRevision,
} from "./alchemy-notify";
import {
  DepositWatchInvariantError,
  depositWatchProjectionIsReady,
  persistDepositAddressAndDesiredWatch,
} from "./deposit-watch";
import { reversePayoutDebit } from "./payout-refund";
import {
  buildChallenge,
  verifyEvmSignature,
  verifySolanaSignature,
} from "./sign";

import { createHash, randomBytes } from "node:crypto";

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

type DepositWatchNotReadyCode =
  | "deposit_watch_pending"
  | "deposit_watch_blocked"
  | "deposit_watch_target_unconfigured"
  | "deposit_watch_target_binding_pending"
  | "deposit_watch_target_conflict"
  | "deposit_watch_target_disabled"
  | "deposit_ingress_signing_key_missing";

export class DepositWatchNotReadyError extends Error {
  readonly code: DepositWatchNotReadyCode;
  readonly retryable: boolean;
  readonly watchStatus: string;

  constructor(watchStatus: string) {
    let code: DepositWatchNotReadyCode;
    let retryable = false;
    let message: string;
    switch (watchStatus) {
      case "blocked":
        code = "deposit_watch_blocked";
        message =
          "The durable provider watch is blocked and requires operator repair.";
        break;
      case "target_binding_pending":
        code = "deposit_watch_target_binding_pending";
        retryable = true;
        message =
          "The durable provider target has not yet advanced to this process's configured revision.";
        break;
      case "target_configuration_conflict":
        code = "deposit_watch_target_conflict";
        message =
          "This process's provider target disagrees with the durable monotonic target registry.";
        break;
      case "target_disabled":
        code = "deposit_watch_target_disabled";
        message =
          "Deposit watching for this chain is explicitly disabled by process configuration or the current registry target.";
        break;
      case "target_configuration_missing":
        code = "deposit_watch_target_unconfigured";
        message =
          "The current public provider-watch target is not fully configured.";
        break;
      case "ingress_signing_key_missing":
        code = "deposit_ingress_signing_key_missing";
        message =
          "The chain-specific ingress signing key is not configured.";
        break;
      default:
        code = "deposit_watch_pending";
        retryable = true;
        message =
          "The durable provider watch has not yet been independently verified.";
    }

    super(message);
    this.name = "DepositWatchNotReadyError";
    this.code = code;
    this.retryable = retryable;
    this.watchStatus = watchStatus;
  }
}

/**
 * Resolve the current public watch identity only when authenticated ingress is
 * possible for this exact chain. The signing key crosses this boundary as a
 * boolean presence signal only; it is never hashed, returned, stored, or
 * logged.
 */
export function evmDepositWatchTargetForDisclosure(
  chain: EvmChain,
  network: "mainnet" | "testnet",
  env: NodeJS.ProcessEnv = process.env,
  ingressSigningKeyPresent =
    economyConfig.alchemyWebhookSigningKeys[chain].trim().length > 0,
): { fingerprint: string; revision: number } {
  const revision = parseAlchemyWatchTargetRevision(
    env.ALCHEMY_WATCH_TARGET_REVISION,
  );
  const disabledChains = parseAlchemyWatchDisabledChains(
    env.ALCHEMY_WATCH_DISABLED_CHAINS,
  );
  if (revision === null || disabledChains === null) {
    throw new DepositWatchNotReadyError(
      "target_configuration_missing",
    );
  }
  if (disabledChains.includes(chain)) {
    throw new DepositWatchNotReadyError("target_disabled");
  }
  const target = alchemyDepositWatchTargetFromEnv(chain, network, env);
  if (target === null) {
    throw new DepositWatchNotReadyError(
      "target_configuration_missing",
    );
  }
  if (!ingressSigningKeyPresent) {
    throw new DepositWatchNotReadyError(
      "ingress_signing_key_missing",
    );
  }
  return target;
}

export async function getOrCreateDepositAddress(
  walletId: string,
  chain: Chain,
  token: string,
): Promise<{ address: string; derivation_path: string; chain: Chain; token: string }> {
  if (token !== "USDC") {
    throw new TypeError("Only USDC deposit addresses are supported.");
  }
  if (isEvmChain(chain)) {
    assertEvmDepositCreditSupported(chain);
  }

  if (!isChainSupported(chain)) {
    throw new Error(
      `Chain ${chain} is recognised but deposit derivation is unavailable.`,
    );
  }
  const evmWatch = isEvmChain(chain)
    ? (() => {
        const network = activeNetwork();
        return {
          network,
          target: evmDepositWatchTargetForDisclosure(chain, network),
        };
      })()
    : null;
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
        network: evmWatch!.network,
        desiredState: "watching",
      });
    } catch (error) {
      if (error instanceof DepositWatchInvariantError) {
        throw new DepositAddressInvariantError();
      }
      throw error;
    }
    // A process presenting a higher revision is waiting for worker
    // preparation, even when the older head is conflicted or disabled: that
    // higher revision is exactly how either state is repaired.
    if (watch.targetRevision < evmWatch!.target.revision) {
      throw new DepositWatchNotReadyError("target_binding_pending");
    }
    if (watch.targetRegistryState === "disabled") {
      throw new DepositWatchNotReadyError("target_disabled");
    }
    if (
      watch.targetRegistryState === "conflicted" ||
      watch.targetRevision > evmWatch!.target.revision ||
      (
        watch.targetRevision === evmWatch!.target.revision &&
        watch.targetFingerprint !== evmWatch!.target.fingerprint
      )
    ) {
      throw new DepositWatchNotReadyError(
        "target_configuration_conflict",
      );
    }
    if (watch.targetRegistryState === "unbound") {
      throw new DepositWatchNotReadyError("target_binding_pending");
    }
    if (!depositWatchProjectionIsReady(watch, evmWatch!.target)) {
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
  /** Required durable request identity. The plaintext is never persisted. */
  idempotencyKey: string;
}

export interface PayoutRequestOutcome {
  id: string;
  status: string;
  broadcast_pending: boolean;
  replayed: boolean;
}

export const PAYOUT_IDEMPOTENCY_KEY_PATTERN = /^[!-~]{8,256}$/u;
export const PAYOUT_ADMISSION_RESTING_ERROR = "payout_admission_resting";

function canonicalJson(value: unknown, path = "metadata"): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} must contain only finite JSON numbers`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const entries: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new TypeError(`${path} must not contain sparse arrays`);
      }
      entries.push(canonicalJson(value[index], `${path}[${index}]`));
    }
    return `[${entries.join(",")}]`;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} must contain only plain JSON objects`);
    }
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(record[key], `${path}.${key}`)}`,
      )
      .join(",")}}`;
  }
  throw new TypeError(`${path} must contain only JSON values`);
}

/** A stable fingerprint of the recognized business input, not HTTP/auth bytes. */
export function payoutRequestSha256(
  input: Pick<
    PayoutRequest,
    | "walletId"
    | "chain"
    | "token"
    | "amountBase"
    | "destinationAddress"
    | "metadata"
  >,
): string {
  const canonicalRequest =
    `{"amount_base":${JSON.stringify(input.amountBase)}` +
    `,"chain":${JSON.stringify(input.chain)}` +
    `,"destination_address":${JSON.stringify(input.destinationAddress)}` +
    `,"metadata":${canonicalJson(input.metadata ?? {})}` +
    `,"token":${JSON.stringify(input.token)}` +
    `,"wallet_id":${JSON.stringify(input.walletId)}}`;
  return createHash("sha256")
    .update("agenttool:payout-request:v1\0")
    .update(canonicalRequest)
    .digest("hex");
}

export function payoutIdempotencyKeySha256(key: string): string {
  return createHash("sha256")
    .update("agenttool:payout-idempotency-key:v1\0")
    .update(key)
    .digest("hex");
}

function payoutStillPending(status: string): boolean {
  return (
    status === "requested" ||
    status === "signing" ||
    status === "broadcasting" ||
    status === "broadcast"
  );
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

/** Pure advisory policy evaluator with injected readers.
 *
 * Fresh payout admission is resting independently of this decision. Keeping
 * policy inspection available does not authorize a debit or chain transfer.
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
 * This can preview retained policy configuration, but it does not reserve
 * capacity or authorize a payout while fresh admission is resting.
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

/** Resolve an existing durable payout request or refuse fresh admission.
 *
 * The former admission heuristic treated lifetime `gallery_sale` and
 * `escrow_release` labels as cashable value. Ordinary wallet debits did not
 * consume that allowance, and an internally funded escrow release could make
 * unbacked value appear earned. Fresh creation therefore rests until cashable
 * backing is conserved through every debit, transfer, refund, and chargeback.
 *
 * The tentative idempotency reservation below is inside this transaction. A
 * fresh request throws and rolls it back before network selection or
 * payout-economic wallet/policy reads or mutation. A durable
 * same-input reservation still resolves its current payout state; changed
 * input still conflicts. */
export async function requestPayout(
  p: PayoutRequest,
  database: Pick<typeof db, "transaction"> = db,
): Promise<PayoutRequestOutcome> {
  if (!PAYOUT_IDEMPOTENCY_KEY_PATTERN.test(p.idempotencyKey)) {
    throw new Error("payout_idempotency_key_invalid");
  }
  if (!(SUPPORTED_PAYOUT_TOKENS as readonly string[]).includes(p.token)) {
    throw new Error(`token ${p.token} not yet supported for payout`);
  }
  const idempotencyKeySha256 = payoutIdempotencyKeySha256(p.idempotencyKey);
  const requestSha256 = payoutRequestSha256(p);

  return await database.transaction(async (tx) => {
    const [reservation] = await tx
      .insert(payoutRequestIdempotency)
      .values({
        projectId: p.projectId,
        idempotencyKeySha256,
        requestSha256,
      })
      .onConflictDoNothing({
        target: [
          payoutRequestIdempotency.projectId,
          payoutRequestIdempotency.idempotencyKeySha256,
        ],
      })
      .returning({ id: payoutRequestIdempotency.id });

    if (!reservation) {
      // PostgreSQL waits for the concurrent unique-key contender to commit
      // before ON CONFLICT returns. Re-read that durable winner and return its
      // current payout state without re-running policy or touching balance.
      const [existingReservation] = await tx
        .select()
        .from(payoutRequestIdempotency)
        .where(
          and(
            eq(payoutRequestIdempotency.projectId, p.projectId),
            eq(
              payoutRequestIdempotency.idempotencyKeySha256,
              idempotencyKeySha256,
            ),
          ),
        )
        .for("update");
      if (!existingReservation) {
        throw new Error("payout_idempotency_unreconciled");
      }
      if (existingReservation.requestSha256 !== requestSha256) {
        throw new Error("payout_idempotency_conflict");
      }
      if (!existingReservation.payoutId) {
        throw new Error("payout_idempotency_unreconciled");
      }
      const [existingPayout] = await tx
        .select({
          id: cryptoPayouts.id,
          status: cryptoPayouts.status,
        })
        .from(cryptoPayouts)
        .where(
          and(
            eq(cryptoPayouts.id, existingReservation.payoutId),
            eq(cryptoPayouts.projectId, p.projectId),
          ),
        );
      if (!existingPayout) {
        throw new Error("payout_idempotency_unreconciled");
      }
      return {
        id: existingPayout.id,
        status: existingPayout.status,
        broadcast_pending: payoutStillPending(existingPayout.status),
        replayed: true,
      };
    }

    throw new Error(PAYOUT_ADMISSION_RESTING_ERROR);
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

// Re-exports for routes
export { isChain, isEvmChain } from "./chains";
export { depositAddressMatches } from "./hd";
export {
  ingestInboundTransfer,
  reconcileRemovedInboundTransfer,
} from "./inbound-deposits";
export type {
  InboundTransfer,
  IngestionResult,
} from "./inbound-deposits";
