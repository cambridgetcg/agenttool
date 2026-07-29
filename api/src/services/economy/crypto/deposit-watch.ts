/**
 * Durable provider-neutral deposit-watch desired/observed control state.
 *
 * This module stores no provider credentials or response bodies. Provider
 * access lives inside an injected reconciler. A mutation endpoint returning
 * success becomes `accepted_unverified`; only an independent observation of
 * the intended active/type/destination subscription and its address membership
 * for the current public target fingerprint and monotonic revision may become
 * `converged`. Address disclosure additionally bounds the age of that
 * observation and starts a new generation when it expires.
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
  depositWatchTargets,
  type DepositWatchDesiredState,
  type DepositWatchObservedState,
  type DepositWatchOutcomeCode,
  type DepositWatchStatus,
  type DepositWatchTargetState,
} from "../../../db/schema/economy";
import { isChain, isEvmChain, type Chain } from "./chains";

export type DepositWatchNetwork = "mainnet" | "testnet";

export const DEPOSIT_WATCH_MAX_ATTEMPTS = 8;
export const DEPOSIT_WATCH_MAX_BATCH_SIZE = 10;
export const DEPOSIT_WATCH_MAX_LEASE_MS = 5 * 60_000;
export const DEPOSIT_WATCH_DEFAULT_LEASE_MS = 30_000;
export const DEPOSIT_WATCH_DEFAULT_PROVIDER_TIMEOUT_MS = 10_000;
export const DEPOSIT_WATCH_DISCLOSURE_MAX_AGE_MS = 10 * 60_000;
export const DEPOSIT_WATCH_REVERIFY_MS = 24 * 60 * 60_000;
export const DEPOSIT_WATCH_UNBOUND_TARGET_FINGERPRINT =
  "c477199a36317357929d98d7597436d83a63f3f2575abb0cf80868c9f60933bb";

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
const TARGET_FINGERPRINT_RE = /^[0-9a-f]{64}$/;
const TARGET_REVISION_MAX = 2_147_483_647;

export class DepositWatchInvariantError extends Error {
  readonly code = "deposit_watch_invariant_failed";

  constructor() {
    super(
      "The deposit address and desired provider-watch identity could not be persisted without guessing.",
    );
    this.name = "DepositWatchInvariantError";
  }
}

export class DepositWatchTargetConflictError extends Error {
  readonly code = "deposit_watch_target_conflict";

  constructor() {
    super(
      "The configured deposit-watch target cannot regress or disagree with the durable target registry.",
    );
    this.name = "DepositWatchTargetConflictError";
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
  /**
   * Rolling compatibility only. Registry-aware request code omits this field;
   * pre-registry binaries may still supply it, but it never selects or changes
   * the durable target head.
   */
  targetFingerprint?: string;
  desiredState?: DepositWatchDesiredState;
}

export interface PersistedDepositAddressWatch {
  depositAddressId: string;
  watchId: string;
  address: string;
  chain: Chain;
  network: DepositWatchNetwork;
  provider: string;
  targetFingerprint: string;
  targetRevision: number;
  targetRegistryState: DepositWatchTargetState;
  desiredState: DepositWatchDesiredState;
  observedState: DepositWatchObservedState;
  status: DepositWatchStatus;
  generation: number;
  observedGeneration: number | null;
  observedTargetFingerprint: string | null;
  observedTargetRevision: number | null;
  observedAt: Date | null;
  nextAttemptAt: Date | null;
  databaseFresh: boolean;
}

type DepositWatchTransaction =
  Parameters<Parameters<typeof db.transaction>[0]>[0];

function validatePersistInput(input: PersistDepositAddressWatchInput): void {
  if (
    !isChain(input.chain) ||
    input.token !== "USDC" ||
    !PROVIDER_NAME_RE.test(input.provider) ||
    (input.network !== "mainnet" && input.network !== "testnet") ||
    (input.targetFingerprint !== undefined &&
      !TARGET_FINGERPRINT_RE.test(input.targetFingerprint)) ||
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
  registeredTarget: typeof depositWatchTargets.$inferSelect,
  databaseFresh: boolean,
): PersistedDepositAddressWatch {
  if (
    watch.targetFingerprint === null ||
    watch.targetRevision === null ||
    watch.targetFingerprint !== registeredTarget.targetFingerprint ||
    watch.targetRevision !== registeredTarget.targetRevision
  ) {
    throw new DepositWatchInvariantError();
  }
  return {
    depositAddressId: deposit.id,
    watchId: watch.id,
    address: deposit.address,
    chain: watch.chain as Chain,
    network: watch.network as DepositWatchNetwork,
    provider: watch.provider,
    targetFingerprint: watch.targetFingerprint,
    targetRevision: watch.targetRevision,
    targetRegistryState: registeredTarget.state,
    desiredState: watch.desiredState,
    observedState: watch.observedState,
    status: watch.status,
    generation: watch.generation,
    observedGeneration: watch.observedGeneration,
    observedTargetFingerprint: watch.observedTargetFingerprint,
    observedTargetRevision: watch.observedTargetRevision,
    observedAt: watch.observedAt,
    nextAttemptAt: watch.nextAttemptAt,
    databaseFresh,
  };
}

export function depositWatchProjectionIsReady(
  watch: PersistedDepositAddressWatch,
  currentTarget: {
    fingerprint: string;
    revision: number;
  },
): boolean {
  return (
    watch.databaseFresh &&
    watch.targetRegistryState === "active" &&
    watch.status === "converged" &&
    watch.desiredState === "watching" &&
    watch.observedState === "watching" &&
    watch.targetFingerprint === currentTarget.fingerprint &&
    watch.targetRevision === currentTarget.revision &&
    watch.observedTargetFingerprint === currentTarget.fingerprint &&
    watch.observedTargetRevision === currentTarget.revision &&
    watch.observedGeneration === watch.generation &&
    watch.nextAttemptAt !== null
  );
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

  // Request replicas never activate a real target. They may only ensure the
  // neutral head exists, then share-lock the database decision through the
  // watch insert. A worker rotation takes an update lock and therefore cannot
  // miss a concurrently created watch.
  await tx
    .insert(depositWatchTargets)
    .values({
      provider: input.provider,
      chain: input.chain,
      network: input.network,
      state: "unbound",
      targetFingerprint: DEPOSIT_WATCH_UNBOUND_TARGET_FINGERPRINT,
      targetRevision: 0,
    })
    .onConflictDoNothing();

  const targetIdentity = and(
    eq(depositWatchTargets.provider, input.provider),
    eq(depositWatchTargets.chain, input.chain),
    eq(depositWatchTargets.network, input.network),
  );
  const [registeredTarget] = await tx
    .select()
    .from(depositWatchTargets)
    .where(targetIdentity)
    .for("share")
    .limit(1);
  if (!registeredTarget) throw new DepositWatchInvariantError();

  const targetUnavailableOutcome =
    registeredTarget.state === "disabled"
      ? "provider_target_disabled" as const
      : registeredTarget.state === "conflicted"
        ? "provider_target_mismatch" as const
        : "target_binding_required" as const;

  await tx
    .insert(depositAddressWatches)
    .values({
      depositAddressId: deposit.id,
      provider: input.provider,
      chain: input.chain,
      network: input.network,
      targetFingerprint: registeredTarget.targetFingerprint,
      targetRevision: registeredTarget.targetRevision,
      desiredState,
      ...(registeredTarget.state === "active"
        ? {}
        : {
            status: "blocked" as const,
            nextAttemptAt: null,
            lastOutcomeCode: targetUnavailableOutcome,
          }),
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
  const targetChanged =
    watch.targetFingerprint !== registeredTarget.targetFingerprint ||
    watch.targetRevision !== registeredTarget.targetRevision;
  const desiredStateChanged = watch.desiredState !== desiredState;

  if (registeredTarget.state !== "active") {
    if (
      !targetChanged &&
      !desiredStateChanged &&
      watch.status === "blocked" &&
      watch.lastOutcomeCode === targetUnavailableOutcome
    ) {
      return watchProjection(deposit, watch, registeredTarget, false);
    }
    const [blocked] = await tx
      .update(depositAddressWatches)
      .set({
        desiredState,
        targetFingerprint: registeredTarget.targetFingerprint,
        targetRevision: registeredTarget.targetRevision,
        generation: sql`${depositAddressWatches.generation} + 1`,
        status: "blocked",
        attemptCount: 0,
        nextAttemptAt: null,
        leaseId: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastOutcomeCode: targetUnavailableOutcome,
        lastAttemptAt: null,
        updatedAt: sql`statement_timestamp()`,
      })
      .where(watchIdentity)
      .returning();
    if (!blocked) throw new DepositWatchInvariantError();
    return watchProjection(deposit, blocked, registeredTarget, false);
  }

  if (!targetChanged && !desiredStateChanged) {
    if (watch.status !== "converged") {
      return watchProjection(deposit, watch, registeredTarget, false);
    }

    // This database-clock condition is the disclosure freshness decision.
    // The share/update locks make the returned `databaseFresh` point-in-time
    // evidence rather than a process-clock guess.
    const [expired] = await tx
      .update(depositAddressWatches)
      .set({
        generation: sql`${depositAddressWatches.generation} + 1`,
        status: "pending",
        attemptCount: 0,
        nextAttemptAt: sql`statement_timestamp()`,
        leaseId: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastOutcomeCode: null,
        lastAttemptAt: null,
        updatedAt: sql`statement_timestamp()`,
      })
      .where(
        and(
          watchIdentity,
          eq(depositAddressWatches.status, "converged"),
          sql`(
            ${depositAddressWatches.observedAt} IS NULL
            OR ${depositAddressWatches.observedAt}
              <= clock_timestamp()
                - (${DEPOSIT_WATCH_DISCLOSURE_MAX_AGE_MS}
                  * interval '1 millisecond')
            OR ${depositAddressWatches.nextAttemptAt} IS NULL
            OR ${depositAddressWatches.nextAttemptAt} <= clock_timestamp()
            OR ${depositAddressWatches.observedGeneration}
              <> ${depositAddressWatches.generation}
            OR ${depositAddressWatches.observedTargetFingerprint}
              <> ${registeredTarget.targetFingerprint}
            OR ${depositAddressWatches.observedTargetRevision}
              <> ${registeredTarget.targetRevision}
          )`,
        ),
      )
      .returning();
    return expired
      ? watchProjection(deposit, expired, registeredTarget, false)
      : watchProjection(deposit, watch, registeredTarget, true);
  }

  // The locked registry head or desired state changed. Start a new generation
  // and fence every in-flight provider result while preserving the last
  // observation only as historical evidence.
  const [updated] = await tx
    .update(depositAddressWatches)
    .set({
      desiredState,
      targetFingerprint: registeredTarget.targetFingerprint,
      targetRevision: registeredTarget.targetRevision,
      generation: sql`${depositAddressWatches.generation} + 1`,
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: sql`statement_timestamp()`,
      leaseId: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastOutcomeCode: null,
      lastAttemptAt: null,
      updatedAt: sql`statement_timestamp()`,
    })
    .where(watchIdentity)
    .returning();

  if (!updated) throw new DepositWatchInvariantError();
  return watchProjection(deposit, updated, registeredTarget, false);
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
      nextAttemptAt: sql`statement_timestamp()`,
      leaseId: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      lastOutcomeCode: null,
      lastAttemptAt: null,
      updatedAt: sql`statement_timestamp()`,
    })
    .where(
      and(
        eq(depositAddressWatches.id, watchId),
        inArray(depositAddressWatches.status, ["blocked", "converged"]),
        sql`${depositAddressWatches.targetRevision} >= 1`,
        sql`EXISTS (
          SELECT 1
          FROM economy.deposit_watch_targets AS target
          WHERE target.provider = ${depositAddressWatches.provider}
            AND target.chain = ${depositAddressWatches.chain}
            AND target.network = ${depositAddressWatches.network}
            AND target.state = 'active'
            AND target.target_fingerprint =
              ${depositAddressWatches.targetFingerprint}
            AND target.target_revision =
              ${depositAddressWatches.targetRevision}
        )`,
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

export interface DepositWatchTargetBinding {
  provider: string;
  chain: Chain;
  network: DepositWatchNetwork;
  state: "active" | "disabled";
  targetFingerprint: string;
  targetRevision: number;
}

export interface DepositWatchTargetPreparation {
  updatedWatches: number;
  conflicts: number;
  staleBindings: number;
}

interface TargetDecision {
  binding: DepositWatchTargetBinding;
  head: typeof depositWatchTargets.$inferSelect;
  kind: "accepted" | "conflict" | "stale";
}

function validateTargetBindings(
  bindings: readonly DepositWatchTargetBinding[],
  allowEmpty: boolean,
): void {
  if (
    !Array.isArray(bindings) ||
    (!allowEmpty && bindings.length === 0) ||
    bindings.length > 16
  ) {
    throw new TypeError("Invalid bounded deposit-watch target bindings.");
  }
  const identities = new Set<string>();
  for (const binding of bindings) {
    const identity =
      `${binding.provider}\0${binding.chain}\0${binding.network}`;
    const fingerprintValid =
      TARGET_FINGERPRINT_RE.test(binding.targetFingerprint) &&
      (
        binding.state === "disabled"
          ? binding.targetFingerprint ===
            DEPOSIT_WATCH_UNBOUND_TARGET_FINGERPRINT
          : binding.targetFingerprint !==
            DEPOSIT_WATCH_UNBOUND_TARGET_FINGERPRINT
      );
    if (
      !PROVIDER_NAME_RE.test(binding.provider) ||
      !isChain(binding.chain) ||
      (binding.network !== "mainnet" && binding.network !== "testnet") ||
      (binding.state !== "active" && binding.state !== "disabled") ||
      !fingerprintValid ||
      !Number.isSafeInteger(binding.targetRevision) ||
      binding.targetRevision < 1 ||
      binding.targetRevision > TARGET_REVISION_MAX ||
      identities.has(identity)
    ) {
      throw new TypeError("Invalid bounded deposit-watch target bindings.");
    }
    identities.add(identity);
  }
}

function orderedTargetBindings(
  bindings: readonly DepositWatchTargetBinding[],
): DepositWatchTargetBinding[] {
  return [...bindings].sort((left, right) => {
    const leftIdentity =
      `${left.provider}\0${left.chain}\0${left.network}`;
    const rightIdentity =
      `${right.provider}\0${right.chain}\0${right.network}`;
    return leftIdentity < rightIdentity
      ? -1
      : leftIdentity > rightIdentity
        ? 1
        : 0;
  });
}

/**
 * Prepare exact provider targets before claims.
 *
 * Higher revisions rotate/disable the registry head and every watch in the
 * same transaction. Equal-revision disagreement durably conflicts the head,
 * fences all claims, and requires a higher revision to repair. Lower revisions
 * are inert. The returned counters contain no target values or credentials.
 */
export async function bindDepositWatchTargetsInTransaction(
  tx: DepositWatchTransaction,
  bindings: readonly DepositWatchTargetBinding[],
): Promise<DepositWatchTargetPreparation> {
  validateTargetBindings(bindings, true);
  const decisions: TargetDecision[] = [];

  for (const binding of orderedTargetBindings(bindings)) {
    await tx
      .insert(depositWatchTargets)
      .values({
        provider: binding.provider,
        chain: binding.chain,
        network: binding.network,
        state: binding.state,
        targetFingerprint: binding.targetFingerprint,
        targetRevision: binding.targetRevision,
      })
      .onConflictDoNothing();

    const identity = and(
      eq(depositWatchTargets.provider, binding.provider),
      eq(depositWatchTargets.chain, binding.chain),
      eq(depositWatchTargets.network, binding.network),
    );
    let [head] = await tx
      .select()
      .from(depositWatchTargets)
      .where(identity)
      .for("update")
      .limit(1);
    if (!head) throw new DepositWatchInvariantError();

    if (head.targetRevision > binding.targetRevision) {
      decisions.push({
        binding,
        head,
        kind: "stale",
      });
      continue;
    }

    const exact =
      head.state === binding.state &&
      head.targetRevision === binding.targetRevision &&
      head.targetFingerprint === binding.targetFingerprint;
    if (head.targetRevision === binding.targetRevision) {
      if (exact) {
        decisions.push({
          binding,
          head,
          kind: "accepted",
        });
        continue;
      }

      if (head.state !== "conflicted") {
        const [conflicted] = await tx
          .update(depositWatchTargets)
          .set({
            state: "conflicted",
            updatedAt: sql`statement_timestamp()`,
          })
          .where(
            and(
              eq(depositWatchTargets.id, head.id),
              eq(
                depositWatchTargets.targetRevision,
                binding.targetRevision,
              ),
            ),
          )
          .returning();
        if (!conflicted) throw new DepositWatchInvariantError();
        head = conflicted;
      }
      decisions.push({
        binding,
        head,
        kind: "conflict",
      });
      continue;
    }

    const [advanced] = await tx
      .update(depositWatchTargets)
      .set({
        state: binding.state,
        targetFingerprint: binding.targetFingerprint,
        targetRevision: binding.targetRevision,
        updatedAt: sql`statement_timestamp()`,
      })
      .where(
        and(
          eq(depositWatchTargets.id, head.id),
          sql`${depositWatchTargets.targetRevision} < ${binding.targetRevision}`,
        ),
      )
      .returning();
    if (!advanced) throw new DepositWatchInvariantError();
    decisions.push({
      binding,
      head: advanced,
      kind: "accepted",
    });
  }

  let updatedWatches = 0;
  for (const decision of decisions) {
    const { binding, head } = decision;
    if (decision.kind === "stale") continue;

    if (decision.kind === "conflict") {
      const fenced = await tx
        .update(depositAddressWatches)
        .set({
          generation: sql`${depositAddressWatches.generation} + 1`,
          status: "blocked",
          attemptCount: 0,
          nextAttemptAt: null,
          leaseId: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastOutcomeCode: "provider_target_mismatch",
          lastAttemptAt: null,
          updatedAt: sql`statement_timestamp()`,
        })
        .where(
          and(
            eq(depositAddressWatches.provider, binding.provider),
            eq(depositAddressWatches.chain, binding.chain),
            eq(depositAddressWatches.network, binding.network),
            sql`(
              ${depositAddressWatches.status} <> 'blocked'
              OR ${depositAddressWatches.lastOutcomeCode}
                IS DISTINCT FROM 'provider_target_mismatch'
            )`,
          ),
        )
        .returning({ id: depositAddressWatches.id });
      updatedWatches += fenced.length;
      continue;
    }

    const active = binding.state === "active";
    const updated = await tx
      .update(depositAddressWatches)
      .set({
        targetFingerprint: head.targetFingerprint,
        targetRevision: head.targetRevision,
        generation: sql`CASE
          WHEN ${depositAddressWatches.targetRevision} IS DISTINCT FROM
            ${head.targetRevision}
            OR ${depositAddressWatches.targetFingerprint} IS DISTINCT FROM
              ${head.targetFingerprint}
            THEN ${depositAddressWatches.generation} + 1
          ELSE ${depositAddressWatches.generation}
        END`,
        status: active ? "pending" : "blocked",
        attemptCount: 0,
        nextAttemptAt: active ? sql`statement_timestamp()` : null,
        leaseId: null,
        leaseOwner: null,
        leaseExpiresAt: null,
        lastOutcomeCode: active ? null : "provider_target_disabled",
        lastAttemptAt: null,
        updatedAt: sql`statement_timestamp()`,
      })
      .where(
        and(
          eq(depositAddressWatches.provider, binding.provider),
          eq(depositAddressWatches.chain, binding.chain),
          eq(depositAddressWatches.network, binding.network),
          active
            ? sql`(
                ${depositAddressWatches.targetRevision} IS DISTINCT FROM
                  ${head.targetRevision}
                OR ${depositAddressWatches.targetFingerprint}
                  IS DISTINCT FROM ${head.targetFingerprint}
              )`
            : sql`(
                ${depositAddressWatches.targetRevision} IS DISTINCT FROM
                  ${head.targetRevision}
                OR ${depositAddressWatches.targetFingerprint}
                  IS DISTINCT FROM ${head.targetFingerprint}
                OR ${depositAddressWatches.status} <> 'blocked'
                OR ${depositAddressWatches.lastOutcomeCode}
                  IS DISTINCT FROM 'provider_target_disabled'
              )`,
        ),
      )
      .returning({ id: depositAddressWatches.id });
    updatedWatches += updated.length;
  }

  return {
    updatedWatches,
    conflicts: decisions.filter((decision) => decision.kind === "conflict")
      .length,
    staleBindings: decisions.filter((decision) => decision.kind === "stale")
      .length,
  };
}

export async function bindDepositWatchTargets(
  bindings: readonly DepositWatchTargetBinding[],
): Promise<number> {
  validateTargetBindings(bindings, true);
  const result = await db.transaction((tx) =>
    bindDepositWatchTargetsInTransaction(tx, bindings),
  );
  if (result.conflicts > 0 || result.staleBindings > 0) {
    throw new DepositWatchTargetConflictError();
  }
  return result.updatedWatches;
}

export interface DepositWatchClaim {
  id: string;
  depositAddressId: string;
  provider: string;
  chain: Chain;
  network: DepositWatchNetwork;
  targetFingerprint: string;
  targetRevision: number;
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
        | "provider_timeout"
        | "provider_target_mismatch";
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
  targetFingerprint: string;
  targetRevision: number;
  completedAt: Date;
}

export interface DepositWatchStore {
  claimDue(input: {
    owner: string;
    limit: number;
    leaseMs: number;
    claimedAt: Date;
    targets?: readonly DepositWatchTargetBinding[];
  }): Promise<DepositWatchClaim[]>;
  complete(input: CompleteDepositWatchInput): Promise<boolean>;
}

interface RawClaimRow extends Record<string, unknown> {
  id: string;
  deposit_address_id: string;
  provider: string;
  chain: string;
  network: string;
  target_fingerprint: string;
  target_revision: number;
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

/** Build the live SQL store around an explicit Drizzle connection.
 *
 * Production uses the shared client below; explicit construction keeps the
 * lock/FK protocol executable against a disposable database in integration
 * tests without redirecting process-global database configuration. */
export function createDrizzleDepositWatchStore(
  database: typeof db,
): DepositWatchStore {
  return {
    async claimDue(input): Promise<DepositWatchClaim[]> {
      validateClaimOptions(input);
      const activeTargets = (input.targets ?? []).filter(
        (target) => target.state === "active",
      );
      const targetScope =
        activeTargets.length === 0
          ? sql`FALSE`
          : sql`(${sql.join(
              activeTargets.map((target) =>
                sql`(
                  watch.provider = ${target.provider}
                  AND watch.chain = ${target.chain}
                  AND watch.network = ${target.network}
                  AND watch.target_fingerprint = ${target.targetFingerprint}
                  AND watch.target_revision = ${target.targetRevision}
                )`
              ),
              sql` OR `,
            )})`;

      const rows = await database.execute<RawClaimRow>(sql`
        WITH expired_exhausted AS (
          UPDATE economy.deposit_address_watches AS watch
          SET status = 'blocked',
              next_attempt_at = NULL,
              lease_id = NULL,
              lease_owner = NULL,
              lease_expires_at = NULL,
              last_outcome_code = 'lease_expired',
              updated_at = statement_timestamp()
          WHERE watch.status = 'leased'
            AND watch.lease_expires_at <= clock_timestamp()
            AND watch.attempt_count >= ${DEPOSIT_WATCH_MAX_ATTEMPTS}
            AND ${targetScope}
            AND EXISTS (
              SELECT 1
              FROM economy.deposit_watch_targets AS target
              WHERE target.provider = watch.provider
                AND target.chain = watch.chain
                AND target.network = watch.network
                AND target.state = 'active'
                AND target.target_fingerprint = watch.target_fingerprint
                AND target.target_revision = watch.target_revision
            )
        ),
        candidates AS (
          SELECT watch.id
          FROM economy.deposit_address_watches AS watch
          JOIN economy.deposit_watch_targets AS target
            ON target.provider = watch.provider
           AND target.chain = watch.chain
           AND target.network = watch.network
           AND target.state = 'active'
           AND target.target_fingerprint = watch.target_fingerprint
           AND target.target_revision = watch.target_revision
          WHERE ${targetScope}
            AND watch.target_revision >= 1
            AND watch.attempt_count < ${DEPOSIT_WATCH_MAX_ATTEMPTS}
            AND (
              (
                watch.status IN (
                  'pending',
                  'retry_wait',
                  'accepted_unverified',
                  'converged'
                )
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
          FOR UPDATE OF watch SKIP LOCKED
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
                statement_timestamp() + (${input.leaseMs} * interval '1 millisecond'),
              last_attempt_at = statement_timestamp(),
              updated_at = statement_timestamp()
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
          claimed.target_fingerprint,
          claimed.target_revision,
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
        targetFingerprint: row.target_fingerprint,
        targetRevision: row.target_revision,
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
      const [updated] = await database
        .update(depositAddressWatches)
        .set({
          status: input.status,
          nextAttemptAt:
            retryDelayMs === null
              ? null
              : sql`statement_timestamp() + (${retryDelayMs} * interval '1 millisecond')`,
          leaseId: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastOutcomeCode: input.outcomeCode,
          ...(input.status === "converged"
            ? {
                attemptCount: 0,
                lastAttemptAt: null,
              }
            : {}),
          ...(observation
            ? {
                observedState: observation.state,
                observedGeneration: observation.generation,
                observedTargetFingerprint: input.targetFingerprint,
                observedTargetRevision: input.targetRevision,
                observedAt: sql`statement_timestamp()`,
              }
            : {}),
          updatedAt: sql`statement_timestamp()`,
        })
        .where(
          and(
            eq(depositAddressWatches.id, input.id),
            eq(depositAddressWatches.status, "leased"),
            eq(depositAddressWatches.leaseId, input.leaseId),
            eq(depositAddressWatches.generation, input.generation),
            eq(
              depositAddressWatches.targetFingerprint,
              input.targetFingerprint,
            ),
            eq(
              depositAddressWatches.targetRevision,
              input.targetRevision,
            ),
            sql`${depositAddressWatches.leaseExpiresAt} > clock_timestamp()`,
            sql`EXISTS (
              SELECT 1
              FROM economy.deposit_watch_targets AS target
              WHERE target.provider = ${depositAddressWatches.provider}
                AND target.chain = ${depositAddressWatches.chain}
                AND target.network = ${depositAddressWatches.network}
                AND target.state = 'active'
                AND target.target_fingerprint = ${input.targetFingerprint}
                AND target.target_revision = ${input.targetRevision}
            )`,
          ),
        )
        .returning({ id: depositAddressWatches.id });
      return updated !== undefined;
    },
  };
}

export const drizzleDepositWatchStore = createDrizzleDepositWatchStore(db);

function validateClaimOptions(input: {
  owner: string;
  limit: number;
  leaseMs: number;
  claimedAt: Date;
  targets?: readonly DepositWatchTargetBinding[];
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
  if (input.targets !== undefined) {
    validateTargetBindings(input.targets, true);
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
    if (
      !Number.isSafeInteger(claim.targetRevision) ||
      claim.targetRevision < 1 ||
      claim.targetRevision > TARGET_REVISION_MAX ||
      !TARGET_FINGERPRINT_RE.test(claim.targetFingerprint) ||
      claim.targetFingerprint === DEPOSIT_WATCH_UNBOUND_TARGET_FINGERPRINT
    ) {
      return {
        status: "blocked",
        nextAttemptAt: null,
        outcomeCode: "target_binding_required",
      };
    }
    const observation = {
      state: outcome.observedState,
      generation: claim.generation,
      at: completedAt,
    };
    if (outcome.observedState === claim.desiredState) {
      return {
        status: "converged",
        nextAttemptAt: new Date(
          completedAt.getTime() + DEPOSIT_WATCH_REVERIFY_MS,
        ),
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
      candidate.code === "provider_timeout" ||
      candidate.code === "provider_target_mismatch")
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
        targetFingerprint: claim.targetFingerprint,
        targetRevision: claim.targetRevision,
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
  targets?: readonly DepositWatchTargetBinding[];
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
    ...(options.targets === undefined ? {} : { targets: options.targets }),
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
    ...(options.targets === undefined ? {} : { targets: options.targets }),
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
        targetFingerprint: claim.targetFingerprint,
        targetRevision: claim.targetRevision,
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
