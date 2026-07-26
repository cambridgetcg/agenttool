/**
 * Durable provider-neutral deposit-watch desired/observed control state.
 *
 * This module stores no provider credentials or response bodies. Provider
 * access lives inside an injected reconciler. A mutation endpoint returning
 * success becomes `accepted_unverified`; only an independent observation of
 * the intended active/type/destination subscription and its address membership
 * may become `converged`.
 *
 * Provider operations must be idempotent and honor the supplied AbortSignal.
 * A timeout is an ambiguous external outcome: the durable row retries with the
 * same desired state, never with a new meaning.
 */

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "../../../db/client";
import {
  depositAddresses,
  depositAddressWatches,
  type DepositWatchDesiredState,
  type DepositWatchObservedState,
  type DepositWatchOutcomeCode,
  type DepositWatchStatus,
} from "../../../db/schema/economy";
import { isChain, isEvmChain, type Chain } from "./chains";

export type DepositWatchNetwork = "mainnet" | "testnet";

export const DEPOSIT_WATCH_MAX_ATTEMPTS = 8;
export const DEPOSIT_WATCH_MAX_BATCH_SIZE = 10;
export const DEPOSIT_WATCH_MAX_LEASE_MS = 5 * 60_000;
export const DEPOSIT_WATCH_DEFAULT_LEASE_MS = 30_000;
export const DEPOSIT_WATCH_DEFAULT_PROVIDER_TIMEOUT_MS = 10_000;

const DEPOSIT_WATCH_BACKOFF_MS = [
  30_000,
  2 * 60_000,
  10 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  6 * 60 * 60_000,
  24 * 60 * 60_000,
  24 * 60 * 60_000,
] as const;

const PROVIDER_NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const LEASE_OWNER_RE = /^[A-Za-z0-9._:-]{1,128}$/;

export class DepositWatchInvariantError extends Error {
  readonly code = "deposit_watch_invariant_failed";

  constructor() {
    super(
      "The deposit address and desired provider-watch identity could not be persisted without guessing.",
    );
    this.name = "DepositWatchInvariantError";
  }
}

export interface PersistDepositAddressWatchInput {
  walletId: string;
  chain: Chain;
  token: "USDC";
  address: string;
  derivationPath: string;
  provider: string;
  network: DepositWatchNetwork;
  desiredState?: DepositWatchDesiredState;
}

export interface PersistedDepositAddressWatch {
  depositAddressId: string;
  watchId: string;
  address: string;
  chain: Chain;
  network: DepositWatchNetwork;
  provider: string;
  desiredState: DepositWatchDesiredState;
  observedState: DepositWatchObservedState;
  status: DepositWatchStatus;
  generation: number;
}

type DepositWatchTransaction =
  Parameters<Parameters<typeof db.transaction>[0]>[0];

function validatePersistInput(input: PersistDepositAddressWatchInput): void {
  if (
    !isChain(input.chain) ||
    input.token !== "USDC" ||
    !PROVIDER_NAME_RE.test(input.provider) ||
    (input.network !== "mainnet" && input.network !== "testnet") ||
    (input.desiredState !== undefined &&
      input.desiredState !== "watching" &&
      input.desiredState !== "not_watching") ||
    input.address.trim() === "" ||
    input.derivationPath.trim() === ""
  ) {
    throw new DepositWatchInvariantError();
  }
}

function addressMatches(
  chain: Chain,
  stored: string,
  requested: string,
): boolean {
  return isEvmChain(chain)
    ? stored.toLowerCase() === requested.toLowerCase()
    : stored === requested;
}

function watchProjection(
  deposit: { id: string; address: string },
  watch: typeof depositAddressWatches.$inferSelect,
): PersistedDepositAddressWatch {
  return {
    depositAddressId: deposit.id,
    watchId: watch.id,
    address: deposit.address,
    chain: watch.chain as Chain,
    network: watch.network as DepositWatchNetwork,
    provider: watch.provider,
    desiredState: watch.desiredState,
    observedState: watch.observedState,
    status: watch.status,
    generation: watch.generation,
  };
}

/**
 * Transactional integration seam for deposit issuance.
 *
 * The logical deposit row and its explicit provider/network desired state
 * either both commit or neither does. An existing conflicting address/path is
 * refused; this function never chooses a historical row on the caller's
 * behalf. It performs no provider call and makes no readiness claim.
 */
export async function persistDepositAddressAndDesiredWatchInTransaction(
  tx: DepositWatchTransaction,
  input: PersistDepositAddressWatchInput,
): Promise<PersistedDepositAddressWatch> {
  validatePersistInput(input);
  const desiredState = input.desiredState ?? "watching";

  await tx
    .insert(depositAddresses)
    .values({
      walletId: input.walletId,
      chain: input.chain,
      token: input.token,
      address: input.address,
      derivationPath: input.derivationPath,
    })
    .onConflictDoNothing();

  const [deposit] = await tx
    .select({
      id: depositAddresses.id,
      address: depositAddresses.address,
      derivationPath: depositAddresses.derivationPath,
    })
    .from(depositAddresses)
    .where(
      and(
        eq(depositAddresses.walletId, input.walletId),
        eq(depositAddresses.chain, input.chain),
        eq(depositAddresses.token, input.token),
      ),
    )
    .for("update")
    .limit(1);

  if (
    !deposit ||
    !addressMatches(input.chain, deposit.address, input.address) ||
    deposit.derivationPath !== input.derivationPath
  ) {
    throw new DepositWatchInvariantError();
  }

  await tx
    .insert(depositAddressWatches)
    .values({
      depositAddressId: deposit.id,
      provider: input.provider,
      chain: input.chain,
      network: input.network,
      desiredState,
    })
    .onConflictDoNothing();

  const watchIdentity = and(
    eq(depositAddressWatches.depositAddressId, deposit.id),
    eq(depositAddressWatches.provider, input.provider),
    eq(depositAddressWatches.chain, input.chain),
    eq(depositAddressWatches.network, input.network),
  );
  const [watch] = await tx
    .select()
    .from(depositAddressWatches)
    .where(watchIdentity)
    .for("update")
    .limit(1);

  if (!watch) throw new DepositWatchInvariantError();
  if (watch.desiredState === desiredState) {
    return watchProjection(deposit, watch);
  }

  // A new desired generation fences any in-flight provider result. Preserve
  // the last real observation as historical evidence, but it cannot satisfy
  // convergence for this new generation.
  const [updated] = await tx
    .update(depositAddressWatches)
    .set({
      desiredState,
      generation: sql`${depositAddressWatches.generation} + 1`,
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: sql`clock_timestamp()`,
      leaseId: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastOutcomeCode: null,
      lastAttemptAt: null,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(watchIdentity)
    .returning();

  if (!updated) throw new DepositWatchInvariantError();
  return watchProjection(deposit, updated);
}

/** Convenience wrapper for callers that are not already inside a transaction. */
export async function persistDepositAddressAndDesiredWatch(
  input: PersistDepositAddressWatchInput,
): Promise<PersistedDepositAddressWatch> {
  return db.transaction((tx) =>
    persistDepositAddressAndDesiredWatchInTransaction(tx, input),
  );
}

/**
 * Explicit recovery/audit seam after bounded exhaustion or a prior converged
 * snapshot. This starts a new generation while preserving the last observation
 * as historical evidence. Already-due or actively leased work is not churned.
 */
export async function requestDepositWatchReconciliationInTransaction(
  tx: DepositWatchTransaction,
  watchId: string,
): Promise<boolean> {
  const [updated] = await tx
    .update(depositAddressWatches)
    .set({
      generation: sql`${depositAddressWatches.generation} + 1`,
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: sql`clock_timestamp()`,
      leaseId: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastOutcomeCode: null,
      lastAttemptAt: null,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(depositAddressWatches.id, watchId),
        inArray(depositAddressWatches.status, ["blocked", "converged"]),
      ),
    )
    .returning({ id: depositAddressWatches.id });
  return updated !== undefined;
}

export async function requestDepositWatchReconciliation(
  watchId: string,
): Promise<boolean> {
  return db.transaction((tx) =>
    requestDepositWatchReconciliationInTransaction(tx, watchId),
  );
}

export interface DepositWatchClaim {
  id: string;
  depositAddressId: string;
  provider: string;
  chain: Chain;
  network: DepositWatchNetwork;
  address: string;
  desiredState: DepositWatchDesiredState;
  observedState: DepositWatchObservedState;
  generation: number;
  observedGeneration: number | null;
  attemptCount: number;
  leaseId: string;
  leaseExpiresAt: Date;
}

export type DepositWatchProviderOutcome =
  | {
      kind: "verified";
      /**
       * The adapter independently queried the intended provider resource and
       * verified its active state, watch type, callback destination, and this
       * address's membership (or absence, after exhausting every provider
       * page). A mutation acknowledgement alone must never produce this
       * outcome.
       */
      observedState: Exclude<DepositWatchObservedState, "unknown">;
    }
  | { kind: "mutation_accepted" }
  | {
      kind: "retryable";
      code:
        | "provider_unavailable"
        | "provider_rate_limited"
        | "provider_timeout";
    }
  | {
      kind: "terminal";
      code:
        | "provider_configuration_missing"
        | "provider_rejected"
        | "provider_unsupported";
    };

export interface DepositWatchReconcileRequest
  extends Omit<DepositWatchClaim, "leaseId"> {
  signal: AbortSignal;
}

export type DepositWatchProviderReconciler = (
  request: DepositWatchReconcileRequest,
) => Promise<unknown>;

export interface DepositWatchTransition {
  status: Exclude<DepositWatchStatus, "pending" | "leased">;
  nextAttemptAt: Date | null;
  outcomeCode: DepositWatchOutcomeCode;
  observation?: {
    state: Exclude<DepositWatchObservedState, "unknown">;
    generation: number;
    at: Date;
  };
}

export interface CompleteDepositWatchInput extends DepositWatchTransition {
  id: string;
  leaseId: string;
  generation: number;
  completedAt: Date;
}

export interface DepositWatchStore {
  claimDue(input: {
    owner: string;
    limit: number;
    leaseMs: number;
    claimedAt: Date;
  }): Promise<DepositWatchClaim[]>;
  complete(input: CompleteDepositWatchInput): Promise<boolean>;
}

interface RawClaimRow extends Record<string, unknown> {
  id: string;
  deposit_address_id: string;
  provider: string;
  chain: string;
  network: string;
  address: string;
  desired_state: DepositWatchDesiredState;
  observed_state: DepositWatchObservedState;
  generation: number;
  observed_generation: number | null;
  attempt_count: number;
  lease_id: string;
  lease_expires_at: Date | string;
}

function dateFromDatabase(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export const drizzleDepositWatchStore: DepositWatchStore = {
  async claimDue(input): Promise<DepositWatchClaim[]> {
    validateClaimOptions(input);

    const rows = await db.execute<RawClaimRow>(sql`
      WITH expired_exhausted AS (
        UPDATE economy.deposit_address_watches
        SET status = 'blocked',
            next_attempt_at = NULL,
            lease_id = NULL,
            lease_owner = NULL,
            lease_expires_at = NULL,
            last_outcome_code = 'lease_expired',
            updated_at = clock_timestamp()
        WHERE status = 'leased'
          AND lease_expires_at <= clock_timestamp()
          AND attempt_count >= ${DEPOSIT_WATCH_MAX_ATTEMPTS}
      ),
      candidates AS (
        SELECT watch.id
        FROM economy.deposit_address_watches AS watch
        WHERE watch.attempt_count < ${DEPOSIT_WATCH_MAX_ATTEMPTS}
          AND (
            (
              watch.status IN ('pending', 'retry_wait', 'accepted_unverified')
              AND watch.next_attempt_at <= clock_timestamp()
            )
            OR
            (
              watch.status = 'leased'
              AND watch.lease_expires_at <= clock_timestamp()
            )
          )
        ORDER BY
          coalesce(watch.next_attempt_at, watch.lease_expires_at),
          watch.created_at,
          watch.id
        FOR UPDATE SKIP LOCKED
        LIMIT ${input.limit}
      ),
      claimed AS (
        UPDATE economy.deposit_address_watches AS watch
        SET status = 'leased',
            attempt_count = watch.attempt_count + 1,
            next_attempt_at = NULL,
            lease_id = gen_random_uuid(),
            lease_owner = ${input.owner},
            lease_expires_at =
              clock_timestamp() + (${input.leaseMs} * interval '1 millisecond'),
            last_attempt_at = clock_timestamp(),
            updated_at = clock_timestamp()
        FROM candidates
        WHERE watch.id = candidates.id
        RETURNING watch.*
      )
      SELECT
        claimed.id,
        claimed.deposit_address_id,
        claimed.provider,
        claimed.chain,
        claimed.network,
        deposit.address,
        claimed.desired_state,
        claimed.observed_state,
        claimed.generation,
        claimed.observed_generation,
        claimed.attempt_count,
        claimed.lease_id,
        claimed.lease_expires_at
      FROM claimed
      JOIN economy.deposit_addresses AS deposit
        ON deposit.id = claimed.deposit_address_id
       AND deposit.chain = claimed.chain
      ORDER BY claimed.created_at, claimed.id
    `);

    return rows.map((row) => ({
      id: row.id,
      depositAddressId: row.deposit_address_id,
      provider: row.provider,
      chain: row.chain as Chain,
      network: row.network as DepositWatchNetwork,
      address: row.address,
      desiredState: row.desired_state,
      observedState: row.observed_state,
      generation: row.generation,
      observedGeneration: row.observed_generation,
      attemptCount: row.attempt_count,
      leaseId: row.lease_id,
      leaseExpiresAt: dateFromDatabase(row.lease_expires_at),
    }));
  },

  async complete(input): Promise<boolean> {
    const observation = input.observation;
    const retryDelayMs =
      input.nextAttemptAt === null
        ? null
        : input.nextAttemptAt.getTime() - input.completedAt.getTime();
    if (
      !Number.isFinite(input.completedAt.getTime()) ||
      (retryDelayMs !== null &&
        (!Number.isSafeInteger(retryDelayMs) ||
          retryDelayMs < 1 ||
          retryDelayMs > 24 * 60 * 60_000))
    ) {
      throw new TypeError("Invalid bounded deposit-watch completion.");
    }
    const [updated] = await db
      .update(depositAddressWatches)
      .set({
        status: input.status,
        nextAttemptAt:
          retryDelayMs === null
            ? null
            : sql`clock_timestamp() + (${retryDelayMs} * interval '1 millisecond')`,
        leaseId: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastOutcomeCode: input.outcomeCode,
        ...(observation
          ? {
              observedState: observation.state,
              observedGeneration: observation.generation,
              observedAt: sql`clock_timestamp()`,
            }
          : {}),
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(depositAddressWatches.id, input.id),
          eq(depositAddressWatches.status, "leased"),
          eq(depositAddressWatches.leaseId, input.leaseId),
          eq(depositAddressWatches.generation, input.generation),
          sql`${depositAddressWatches.leaseExpiresAt} > clock_timestamp()`,
        ),
      )
      .returning({ id: depositAddressWatches.id });
    return updated !== undefined;
  },
};

function validateClaimOptions(input: {
  owner: string;
  limit: number;
  leaseMs: number;
  claimedAt: Date;
}): void {
  if (
    !LEASE_OWNER_RE.test(input.owner) ||
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > DEPOSIT_WATCH_MAX_BATCH_SIZE ||
    !Number.isSafeInteger(input.leaseMs) ||
    input.leaseMs < 1_000 ||
    input.leaseMs > DEPOSIT_WATCH_MAX_LEASE_MS ||
    !Number.isFinite(input.claimedAt.getTime())
  ) {
    throw new TypeError("Invalid bounded deposit-watch lease options.");
  }
}

export function depositWatchBackoffMs(attemptCount: number): number {
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 1) {
    throw new TypeError("Deposit-watch attempt count must be a positive integer.");
  }
  const index = Math.min(
    attemptCount - 1,
    DEPOSIT_WATCH_BACKOFF_MS.length - 1,
  );
  return DEPOSIT_WATCH_BACKOFF_MS[index]!;
}

function retryTransition(
  claim: DepositWatchClaim,
  completedAt: Date,
  outcomeCode: DepositWatchOutcomeCode,
  observation?: DepositWatchTransition["observation"],
): DepositWatchTransition {
  if (claim.attemptCount >= DEPOSIT_WATCH_MAX_ATTEMPTS) {
    return {
      status: "blocked",
      nextAttemptAt: null,
      outcomeCode,
      ...(observation ? { observation } : {}),
    };
  }
  return {
    status: "retry_wait",
    nextAttemptAt: new Date(
      completedAt.getTime() + depositWatchBackoffMs(claim.attemptCount),
    ),
    outcomeCode,
    ...(observation ? { observation } : {}),
  };
}

export function transitionDepositWatchOutcome(
  claim: DepositWatchClaim,
  outcome: DepositWatchProviderOutcome | { kind: "reconciler_failed" },
  completedAt: Date,
): DepositWatchTransition {
  if (outcome.kind === "verified") {
    const observation = {
      state: outcome.observedState,
      generation: claim.generation,
      at: completedAt,
    };
    if (outcome.observedState === claim.desiredState) {
      return {
        status: "converged",
        nextAttemptAt: null,
        outcomeCode: "desired_state_verified",
        observation,
      };
    }
    return retryTransition(
      claim,
      completedAt,
      "opposite_state_verified",
      observation,
    );
  }

  if (outcome.kind === "mutation_accepted") {
    if (claim.attemptCount >= DEPOSIT_WATCH_MAX_ATTEMPTS) {
      return {
        status: "blocked",
        nextAttemptAt: null,
        outcomeCode: "provider_mutation_accepted",
      };
    }
    return {
      status: "accepted_unverified",
      nextAttemptAt: new Date(
        completedAt.getTime() + depositWatchBackoffMs(claim.attemptCount),
      ),
      outcomeCode: "provider_mutation_accepted",
    };
  }

  if (outcome.kind === "terminal") {
    return {
      status: "blocked",
      nextAttemptAt: null,
      outcomeCode: outcome.code,
    };
  }

  return retryTransition(
    claim,
    completedAt,
    outcome.kind === "reconciler_failed" ? "reconciler_failed" : outcome.code,
  );
}

function sanitizeProviderOutcome(
  value: unknown,
):
  | DepositWatchProviderOutcome
  | { kind: "reconciler_failed" } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { kind: "reconciler_failed" };
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "mutation_accepted") {
    return { kind: "mutation_accepted" };
  }
  if (
    candidate.kind === "verified" &&
    (candidate.observedState === "watching" ||
      candidate.observedState === "not_watching")
  ) {
    return {
      kind: "verified",
      observedState: candidate.observedState,
    };
  }
  if (
    candidate.kind === "retryable" &&
    (candidate.code === "provider_unavailable" ||
      candidate.code === "provider_rate_limited" ||
      candidate.code === "provider_timeout")
  ) {
    return { kind: "retryable", code: candidate.code };
  }
  if (
    candidate.kind === "terminal" &&
    (candidate.code === "provider_configuration_missing" ||
      candidate.code === "provider_rejected" ||
      candidate.code === "provider_unsupported")
  ) {
    return { kind: "terminal", code: candidate.code };
  }
  return { kind: "reconciler_failed" };
}

async function reconcileWithTimeout(
  claim: DepositWatchClaim,
  reconciler: DepositWatchProviderReconciler,
  timeoutMs: number,
): Promise<
  DepositWatchProviderOutcome | { kind: "reconciler_failed" }
> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const providerResult = Promise.resolve()
    .then(() =>
      reconciler({
        id: claim.id,
        depositAddressId: claim.depositAddressId,
        provider: claim.provider,
        chain: claim.chain,
        network: claim.network,
        address: claim.address,
        desiredState: claim.desiredState,
        observedState: claim.observedState,
        generation: claim.generation,
        observedGeneration: claim.observedGeneration,
        attemptCount: claim.attemptCount,
        leaseExpiresAt: claim.leaseExpiresAt,
        signal: controller.signal,
      }),
    )
    .then(sanitizeProviderOutcome)
    .catch(() => ({ kind: "reconciler_failed" as const }));
  const timeout = new Promise<DepositWatchProviderOutcome>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ kind: "retryable", code: "provider_timeout" });
    }, timeoutMs);
  });

  try {
    return await Promise.race([providerResult, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface DepositWatchBatchResult {
  claimed: number;
  converged: number;
  acceptedUnverified: number;
  retryWaiting: number;
  blocked: number;
  staleLease: number;
}

export async function runDepositWatchReconciliationBatch(options: {
  owner: string;
  reconciler: DepositWatchProviderReconciler;
  store?: DepositWatchStore;
  limit?: number;
  leaseMs?: number;
  providerTimeoutMs?: number;
  now?: () => Date;
}): Promise<DepositWatchBatchResult> {
  const store = options.store ?? drizzleDepositWatchStore;
  const limit = options.limit ?? DEPOSIT_WATCH_MAX_BATCH_SIZE;
  const leaseMs = options.leaseMs ?? DEPOSIT_WATCH_DEFAULT_LEASE_MS;
  const providerTimeoutMs =
    options.providerTimeoutMs ?? DEPOSIT_WATCH_DEFAULT_PROVIDER_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());
  const claimedAt = now();
  validateClaimOptions({
    owner: options.owner,
    limit,
    leaseMs,
    claimedAt,
  });
  if (
    !Number.isSafeInteger(providerTimeoutMs) ||
    providerTimeoutMs < 1 ||
    providerTimeoutMs > Math.floor(leaseMs / 2)
  ) {
    throw new TypeError(
      "Deposit-watch provider timeout must be a positive integer no greater than half the lease duration.",
    );
  }

  const claims = await store.claimDue({
    owner: options.owner,
    limit,
    leaseMs,
    claimedAt,
  });
  const result: DepositWatchBatchResult = {
    claimed: claims.length,
    converged: 0,
    acceptedUnverified: 0,
    retryWaiting: 0,
    blocked: 0,
    staleLease: 0,
  };

  await Promise.all(
    claims.map(async (claim) => {
      const outcome = await reconcileWithTimeout(
        claim,
        options.reconciler,
        providerTimeoutMs,
      );
      const completedAt = now();
      const transition = transitionDepositWatchOutcome(
        claim,
        outcome,
        completedAt,
      );
      const completed = await store.complete({
        id: claim.id,
        leaseId: claim.leaseId,
        generation: claim.generation,
        completedAt,
        ...transition,
      });
      if (!completed) {
        result.staleLease += 1;
        return;
      }
      if (transition.status === "converged") result.converged += 1;
      else if (transition.status === "accepted_unverified") {
        result.acceptedUnverified += 1;
      } else if (transition.status === "retry_wait") {
        result.retryWaiting += 1;
      } else if (transition.status === "blocked") {
        result.blocked += 1;
      }
    }),
  );

  return result;
}
