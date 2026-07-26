import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { getTableConfig } from "drizzle-orm/pg-core";

import {
  depositAddresses,
  depositAddressWatches,
} from "../src/db/schema/economy";
import {
  DEPOSIT_WATCH_DISCLOSURE_MAX_AGE_MS,
  DEPOSIT_WATCH_MAX_ATTEMPTS,
  DepositWatchInvariantError,
  depositWatchBackoffMs,
  persistDepositAddressAndDesiredWatchInTransaction,
  requestDepositWatchReconciliationInTransaction,
  runDepositWatchReconciliationBatch,
  transitionDepositWatchOutcome,
  type CompleteDepositWatchInput,
  type DepositWatchClaim,
  type DepositWatchStore,
} from "../src/services/economy/crypto/deposit-watch";
import { createDepositWatchWorker } from "../src/workers/deposit-watch/reconcile";

const NOW = new Date("2026-07-26T07:00:00.000Z");
const LEASE_EXPIRES = new Date("2026-07-26T07:01:00.000Z");
const TARGET_FINGERPRINT = "a".repeat(64);
const NEXT_TARGET_FINGERPRINT = "b".repeat(64);

function claim(
  overrides: Partial<DepositWatchClaim> = {},
): DepositWatchClaim {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    depositAddressId: "20000000-0000-4000-8000-000000000001",
    provider: "alchemy",
    chain: "base",
    network: "testnet",
    targetFingerprint: TARGET_FINGERPRINT,
    address: "0x0000000000000000000000000000000000000001",
    desiredState: "watching",
    observedState: "unknown",
    generation: 1,
    observedGeneration: null,
    attemptCount: 1,
    leaseId: "30000000-0000-4000-8000-000000000001",
    leaseExpiresAt: LEASE_EXPIRES,
    ...overrides,
  };
}

class FakeStore implements DepositWatchStore {
  readonly completions: CompleteDepositWatchInput[] = [];
  readonly claims: DepositWatchClaim[];
  completeResult = true;
  claimCalls = 0;

  constructor(claims: DepositWatchClaim[]) {
    this.claims = claims;
  }

  async claimDue(): Promise<DepositWatchClaim[]> {
    this.claimCalls += 1;
    return [...this.claims];
  }

  async complete(input: CompleteDepositWatchInput): Promise<boolean> {
    this.completions.push(input);
    return this.completeResult;
  }
}

function persistenceHarness(options: {
  existingAddress?: string;
  existingPath?: string;
} = {}) {
  const state: {
    deposit: Record<string, unknown> | null;
    watch: Record<string, unknown> | null;
    depositInserts: number;
    watchInserts: number;
    watchUpdates: number;
  } = {
    deposit:
      options.existingAddress === undefined
        ? null
        : {
            id: "20000000-0000-4000-8000-000000000001",
            address: options.existingAddress,
            derivationPath: options.existingPath ?? "m/44'/60'/0'/0/1",
          },
    watch: null,
    depositInserts: 0,
    watchInserts: 0,
    watchUpdates: 0,
  };

  const tx = {
    insert(table: unknown) {
      return {
        values(values: Record<string, unknown>) {
          return {
            async onConflictDoNothing() {
              if (table === depositAddresses) {
                state.depositInserts += 1;
                state.deposit ??= {
                  id: "20000000-0000-4000-8000-000000000001",
                  address: values.address,
                  derivationPath: values.derivationPath,
                };
              } else if (table === depositAddressWatches) {
                state.watchInserts += 1;
                state.watch ??= {
                  id: "10000000-0000-4000-8000-000000000001",
                  depositAddressId: values.depositAddressId,
                  provider: values.provider,
                  chain: values.chain,
                  network: values.network,
                  targetFingerprint: values.targetFingerprint,
                  desiredState: values.desiredState,
                  observedState: "unknown",
                  status: "pending",
                  generation: 1,
                  observedAt: null,
                  observedTargetFingerprint: null,
                };
              }
            },
          };
        },
      };
    },
    select() {
      return {
        from(table: unknown) {
          return {
            where() {
              return {
                for() {
                  return {
                    async limit() {
                      return table === depositAddresses
                        ? state.deposit
                          ? [state.deposit]
                          : []
                        : state.watch
                          ? [state.watch]
                          : [];
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
    update(table: unknown) {
      expect(table).toBe(depositAddressWatches);
      return {
        set(values: Record<string, unknown>) {
          return {
            where() {
              return {
                async returning() {
                  state.watchUpdates += 1;
                  if (!state.watch) return [];
                  state.watch = {
                    ...state.watch,
                    ...values,
                    generation: Number(state.watch.generation) + 1,
                  };
                  return [state.watch];
                },
              };
            },
          };
        },
      };
    },
  };

  return { tx, state };
}

describe("deposit watch durable schema", () => {
  test("pins one provider/chain/network target per deposit identity", () => {
    const deposit = getTableConfig(depositAddresses);
    const watches = getTableConfig(depositAddressWatches);
    const compositeIdentity = deposit.indexes.find(
      (index) => index.config.name === "uq_deposit_address_id_chain",
    );
    const watchIdentity = watches.indexes.find(
      (index) => index.config.name === "uq_deposit_watch_target",
    );

    expect(compositeIdentity?.config.unique).toBe(true);
    expect(watchIdentity?.config.unique).toBe(true);
    expect(
      watchIdentity?.config.columns.map((column) =>
        "name" in column ? column.name : null,
      ),
    ).toEqual(["deposit_address_id", "provider", "chain", "network"]);
    expect(
      watches.foreignKeys.some(
        (foreignKey) =>
          foreignKey.getName() === "fk_deposit_watch_address_chain",
      ),
    ).toBe(true);
  });

  test("stores closed control state, not secrets or provider diagnostics", () => {
    const watches = getTableConfig(depositAddressWatches);
    const columnNames = watches.columns.map((column) => column.name);

    expect(columnNames).toContain("desired_state");
    expect(columnNames).toContain("observed_state");
    expect(columnNames).toContain("observed_generation");
    expect(columnNames).toContain("target_fingerprint");
    expect(columnNames).toContain("observed_target_fingerprint");
    expect(columnNames).toContain("last_outcome_code");
    expect(
      columnNames.filter((name) =>
        /secret|credential|auth|api.?key|response|error/i.test(name),
      ),
    ).toEqual([]);
    expect(
      watches.checks.map((constraint) => constraint.name),
    ).toEqual(
      expect.arrayContaining([
        "deposit_watch_attempt_bound",
        "deposit_watch_lease_shape",
        "deposit_watch_retry_bound",
        "deposit_watch_converged_shape",
        "deposit_watch_target_fingerprint",
        "deposit_watch_outcome_code",
      ]),
    );
  });

  test("migration refuses ambiguous history and performs no guessed backfill", () => {
    const migration = readFileSync(
      new URL(
        "../migrations/20260726T070000_deposit_watch_reconciliation.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const service = readFileSync(
      new URL(
        "../src/services/economy/crypto/deposit-watch.ts",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain("RAISE EXCEPTION");
    expect(migration).toContain(
      "GROUP BY wallet_id, chain, token",
    );
    expect(migration).toContain("GROUP BY chain, lower(address)");
    expect(migration).toContain("provider or network");
    expect(migration).not.toMatch(
      /INSERT\s+INTO\s+economy\.deposit_address_watches/i,
    );
    expect(migration).toContain(
      "WHERE status IN ('pending', 'retry_wait', 'accepted_unverified')",
    );
    expect(service).toContain("FOR UPDATE SKIP LOCKED");
    expect(service).toContain(
      "watch.status IN ('pending', 'retry_wait', 'accepted_unverified')",
    );
  });

  test("target-binding migration invalidates unbound history without guessing secrets", () => {
    const migration = readFileSync(
      new URL(
        "../migrations/20260726T211500_deposit_watch_target_binding.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const service = readFileSync(
      new URL(
        "../src/services/economy/crypto/deposit-watch.ts",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain("target_fingerprint");
    expect(migration).toContain("observed_target_fingerprint");
    expect(migration).toContain("WHERE target_fingerprint IS NULL");
    expect(migration).toContain("observed_state = 'unknown'");
    expect(migration).toContain("status = 'blocked'");
    expect(migration).toContain(
      "target_fingerprint IS NULL AND status <> 'converged'",
    );
    expect(migration).toContain(
      "observed_target_fingerprint = target_fingerprint",
    );
    expect(service).toContain(
      "WHERE watch.target_fingerprint IS NOT NULL",
    );
    expect(migration).not.toMatch(
      /auth_token|signing_key\s*=|secret\s*=/i,
    );
  });
});

describe("deposit watch transition semantics", () => {
  test("bounds deterministic retry backoff at 24 hours", () => {
    expect(depositWatchBackoffMs(1)).toBe(30_000);
    expect(depositWatchBackoffMs(2)).toBe(120_000);
    expect(depositWatchBackoffMs(7)).toBe(24 * 60 * 60_000);
    expect(depositWatchBackoffMs(100)).toBe(24 * 60 * 60_000);
    expect(() => depositWatchBackoffMs(0)).toThrow(TypeError);
  });

  test("does not equate provider mutation acceptance with observation", () => {
    expect(
      transitionDepositWatchOutcome(
        claim(),
        { kind: "mutation_accepted" },
        NOW,
      ),
    ).toEqual({
      status: "accepted_unverified",
      nextAttemptAt: new Date(NOW.getTime() + 30_000),
      outcomeCode: "provider_mutation_accepted",
    });
  });

  test("blocks an unverified provider acknowledgement after the final observation attempt", () => {
    expect(
      transitionDepositWatchOutcome(
        claim({ attemptCount: DEPOSIT_WATCH_MAX_ATTEMPTS }),
        { kind: "mutation_accepted" },
        NOW,
      ),
    ).toEqual({
      status: "blocked",
      nextAttemptAt: null,
      outcomeCode: "provider_mutation_accepted",
    });
  });

  test("converges only from current-generation verified desired state", () => {
    expect(
      transitionDepositWatchOutcome(
        claim({ generation: 4 }),
        { kind: "verified", observedState: "watching" },
        NOW,
      ),
    ).toEqual({
      status: "converged",
      nextAttemptAt: null,
      outcomeCode: "desired_state_verified",
      observation: {
        state: "watching",
        generation: 4,
        at: NOW,
      },
    });
  });

  test("records an opposite observation and retries without erasing it", () => {
    const transition = transitionDepositWatchOutcome(
      claim({ generation: 3, attemptCount: 2 }),
      { kind: "verified", observedState: "not_watching" },
      NOW,
    );

    expect(transition).toEqual({
      status: "retry_wait",
      nextAttemptAt: new Date(NOW.getTime() + 120_000),
      outcomeCode: "opposite_state_verified",
      observation: {
        state: "not_watching",
        generation: 3,
        at: NOW,
      },
    });
  });

  test("blocks after the bounded final attempt", () => {
    expect(
      transitionDepositWatchOutcome(
        claim({ attemptCount: DEPOSIT_WATCH_MAX_ATTEMPTS }),
        { kind: "retryable", code: "provider_unavailable" },
        NOW,
      ),
    ).toEqual({
      status: "blocked",
      nextAttemptAt: null,
      outcomeCode: "provider_unavailable",
    });
  });
});

describe("deposit watch reconciler boundary", () => {
  test("processes a bounded batch into stable provider-neutral outcomes", async () => {
    const store = new FakeStore([
      claim({ id: "10000000-0000-4000-8000-000000000001", provider: "verified" }),
      claim({ id: "10000000-0000-4000-8000-000000000002", provider: "accepted" }),
      claim({ id: "10000000-0000-4000-8000-000000000003", provider: "retry" }),
      claim({ id: "10000000-0000-4000-8000-000000000004", provider: "terminal" }),
    ]);

    const result = await runDepositWatchReconciliationBatch({
      owner: "test-worker:1",
      store,
      leaseMs: 60_000,
      providerTimeoutMs: 1_000,
      now: () => NOW,
      reconciler: async (request) => {
        if (request.provider === "verified") {
          return { kind: "verified", observedState: "watching" };
        }
        if (request.provider === "accepted") {
          return { kind: "mutation_accepted" };
        }
        if (request.provider === "retry") {
          return { kind: "retryable", code: "provider_rate_limited" };
        }
        return {
          kind: "terminal",
          code: "provider_configuration_missing",
        };
      },
    });

    expect(result).toEqual({
      claimed: 4,
      converged: 1,
      acceptedUnverified: 1,
      retryWaiting: 1,
      blocked: 1,
      staleLease: 0,
    });
    expect(store.completions.map((item) => item.outcomeCode).sort()).toEqual([
      "desired_state_verified",
      "provider_configuration_missing",
      "provider_mutation_accepted",
      "provider_rate_limited",
    ]);
  });

  test("sanitizes thrown errors without persisting their messages", async () => {
    const store = new FakeStore([claim()]);
    const sensitiveSentinel = "credential-value-must-never-persist";

    const result = await runDepositWatchReconciliationBatch({
      owner: "test-worker:2",
      store,
      leaseMs: 60_000,
      providerTimeoutMs: 1_000,
      now: () => NOW,
      reconciler: async () => {
        throw new Error(sensitiveSentinel);
      },
    });

    expect(result.retryWaiting).toBe(1);
    expect(store.completions[0]?.outcomeCode).toBe("reconciler_failed");
    expect(JSON.stringify(store.completions)).not.toContain(sensitiveSentinel);
  });

  test("turns a bounded timeout into a stable retry and aborts the adapter", async () => {
    const store = new FakeStore([claim()]);
    let aborted = false;

    await runDepositWatchReconciliationBatch({
      owner: "test-worker:3",
      store,
      leaseMs: 1_000,
      providerTimeoutMs: 5,
      now: () => NOW,
      reconciler: (request) =>
        new Promise((resolve) => {
          request.signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              resolve({ kind: "retryable", code: "provider_timeout" });
            },
            { once: true },
          );
        }),
    });

    expect(aborted).toBe(true);
    expect(store.completions[0]?.outcomeCode).toBe("provider_timeout");
    expect(store.completions[0]?.status).toBe("retry_wait");
  });

  test("generation/lease completion loss is visible and never reported as convergence", async () => {
    const store = new FakeStore([claim()]);
    store.completeResult = false;

    const result = await runDepositWatchReconciliationBatch({
      owner: "test-worker:4",
      store,
      leaseMs: 60_000,
      providerTimeoutMs: 1_000,
      now: () => NOW,
      reconciler: async () => ({
        kind: "verified",
        observedState: "watching",
      }),
    });

    expect(result).toMatchObject({
      claimed: 1,
      converged: 0,
      staleLease: 1,
    });
  });

  test("rejects malformed desired state before touching a transaction", async () => {
    let touched = false;
    const tx = new Proxy(
      {},
      {
        get() {
          touched = true;
          throw new Error("transaction should not be touched");
        },
      },
    );

    await expect(
      persistDepositAddressAndDesiredWatchInTransaction(tx as never, {
        walletId: "20000000-0000-4000-8000-000000000001",
        chain: "base",
        token: "USDC",
        address: "0x0000000000000000000000000000000000000001",
        derivationPath: "m/44'/60'/0'/0/1",
        provider: "INVALID PROVIDER",
        network: "testnet",
        targetFingerprint: TARGET_FINGERPRINT,
      }),
    ).rejects.toBeInstanceOf(DepositWatchInvariantError);
    expect(touched).toBe(false);
  });

  test("persists address and desired watch through one transaction seam", async () => {
    const { tx, state } = persistenceHarness();
    const input = {
      walletId: "20000000-0000-4000-8000-000000000001",
      chain: "base" as const,
      token: "USDC" as const,
      address: "0x0000000000000000000000000000000000000001",
      derivationPath: "m/44'/60'/0'/0/1",
      provider: "alchemy",
      network: "testnet" as const,
      targetFingerprint: TARGET_FINGERPRINT,
    };

    const first = await persistDepositAddressAndDesiredWatchInTransaction(
      tx as never,
      input,
    );
    const second = await persistDepositAddressAndDesiredWatchInTransaction(
      tx as never,
      input,
    );

    expect(first).toMatchObject({
      address: input.address,
      provider: "alchemy",
      desiredState: "watching",
      observedState: "unknown",
      status: "pending",
      generation: 1,
    });
    expect(second).toEqual(first);
    expect(state.depositInserts).toBe(2);
    expect(state.watchInserts).toBe(2);
    expect(state.watchUpdates).toBe(0);
  });

  test("requeues the same desired state when its public target changes", async () => {
    const { tx, state } = persistenceHarness();
    const input = {
      walletId: "20000000-0000-4000-8000-000000000001",
      chain: "base" as const,
      token: "USDC" as const,
      address: "0x0000000000000000000000000000000000000001",
      derivationPath: "m/44'/60'/0'/0/1",
      provider: "alchemy",
      network: "testnet" as const,
      targetFingerprint: TARGET_FINGERPRINT,
    };
    await persistDepositAddressAndDesiredWatchInTransaction(
      tx as never,
      input,
    );
    state.watch = {
      ...state.watch,
      status: "converged",
      observedState: "watching",
      observedGeneration: 1,
      observedTargetFingerprint: TARGET_FINGERPRINT,
      observedAt: new Date(),
    };

    const rebound =
      await persistDepositAddressAndDesiredWatchInTransaction(
        tx as never,
        {
          ...input,
          targetFingerprint: NEXT_TARGET_FINGERPRINT,
        },
      );

    expect(rebound).toMatchObject({
      status: "pending",
      generation: 2,
      targetFingerprint: NEXT_TARGET_FINGERPRINT,
      observedState: "watching",
    });
    expect(state.watch).toMatchObject({
      observedTargetFingerprint: TARGET_FINGERPRINT,
      observedGeneration: 1,
    });
    expect(state.watchUpdates).toBe(1);
  });

  test("requeues an otherwise converged observation at the disclosure freshness bound", async () => {
    const { tx, state } = persistenceHarness();
    const input = {
      walletId: "20000000-0000-4000-8000-000000000001",
      chain: "base" as const,
      token: "USDC" as const,
      address: "0x0000000000000000000000000000000000000001",
      derivationPath: "m/44'/60'/0'/0/1",
      provider: "alchemy",
      network: "testnet" as const,
      targetFingerprint: TARGET_FINGERPRINT,
    };
    await persistDepositAddressAndDesiredWatchInTransaction(
      tx as never,
      input,
    );
    state.watch = {
      ...state.watch,
      status: "converged",
      observedState: "watching",
      observedGeneration: 1,
      observedTargetFingerprint: TARGET_FINGERPRINT,
      observedAt: new Date(
        Date.now() - DEPOSIT_WATCH_DISCLOSURE_MAX_AGE_MS - 1,
      ),
    };

    const refreshed =
      await persistDepositAddressAndDesiredWatchInTransaction(
        tx as never,
        input,
      );

    expect(refreshed).toMatchObject({
      status: "pending",
      generation: 2,
      targetFingerprint: TARGET_FINGERPRINT,
    });
    expect(state.watchUpdates).toBe(1);
  });

  test("refuses a conflicting historical deposit before enqueuing a watch", async () => {
    const { tx, state } = persistenceHarness({
      existingAddress: "0x0000000000000000000000000000000000000002",
    });

    await expect(
      persistDepositAddressAndDesiredWatchInTransaction(tx as never, {
        walletId: "20000000-0000-4000-8000-000000000001",
        chain: "base",
        token: "USDC",
        address: "0x0000000000000000000000000000000000000001",
        derivationPath: "m/44'/60'/0'/0/1",
        provider: "alchemy",
        network: "testnet",
        targetFingerprint: TARGET_FINGERPRINT,
      }),
    ).rejects.toBeInstanceOf(DepositWatchInvariantError);
    expect(state.watch).toBeNull();
    expect(state.watchInserts).toBe(0);
  });

  test("explicitly requeues a blocked snapshot as a fenced new generation", async () => {
    const { tx, state } = persistenceHarness();
    const persisted = await persistDepositAddressAndDesiredWatchInTransaction(
      tx as never,
      {
        walletId: "20000000-0000-4000-8000-000000000001",
        chain: "base",
        token: "USDC",
        address: "0x0000000000000000000000000000000000000001",
        derivationPath: "m/44'/60'/0'/0/1",
        provider: "alchemy",
        network: "testnet",
        targetFingerprint: TARGET_FINGERPRINT,
      },
    );
    state.watch = {
      ...state.watch,
      status: "blocked",
      observedState: "watching",
      observedGeneration: 1,
      observedAt: NOW,
      generation: 1,
      attemptCount: DEPOSIT_WATCH_MAX_ATTEMPTS,
      lastOutcomeCode: "provider_unavailable",
    };

    expect(
      await requestDepositWatchReconciliationInTransaction(
        tx as never,
        persisted.watchId,
      ),
    ).toBe(true);
    expect(state.watch).toMatchObject({
      status: "pending",
      generation: 2,
      attemptCount: 0,
      lastOutcomeCode: null,
      observedState: "watching",
      observedGeneration: 1,
    });
  });
});

describe("deposit watch worker wrapper", () => {
  test("coalesces overlapping ticks and does not auto-start", async () => {
    const store = new FakeStore([]);
    const worker = createDepositWatchWorker({
      owner: "test-worker:wrapper",
      store,
      intervalMs: 1_000,
      reconciler: async () => ({ kind: "mutation_accepted" }),
      now: () => NOW,
    });

    expect(worker.isRunning()).toBe(false);
    const first = worker.runOnce();
    const second = worker.runOnce();
    expect(first).toBe(second);
    await first;
    expect(store.claimCalls).toBe(1);
    worker.stop();
  });
});
