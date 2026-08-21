/** Real-Postgres coverage for the deposit-watch target registry.
 *
 * Opt in with a dedicated, disposable database:
 *
 *   DEPOSIT_WATCH_TEST_DATABASE_URL=postgres://... \
 *     bun test tests/integration/deposit-watch-target-registry-postgres.test.ts
 *
 * The suite refuses any database where `economy` already exists. It creates
 * the minimum pre-registry tables, applies the production migration inside one
 * transaction, exercises real row-lock interleavings, and drops only the
 * schema it created.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";
import postgres from "../fixtures/verified-postgres";

import {
  bindDepositWatchTargetsInTransaction,
  createDrizzleDepositWatchStore,
  persistDepositAddressAndDesiredWatchInTransaction,
  type DepositWatchStore,
  type DepositWatchTargetBinding,
} from "../../src/services/economy/crypto/deposit-watch";

const TEST_DATABASE_URL =
  process.env.DEPOSIT_WATCH_TEST_DATABASE_URL ?? "";
const databaseTest = TEST_DATABASE_URL ? test : test.skip;
const SENTINEL =
  "c477199a36317357929d98d7597436d83a63f3f2575abb0cf80868c9f60933bb";
const TARGET_1 = "a".repeat(64);
const TARGET_2 = "b".repeat(64);
const TARGET_3 = "d".repeat(64);
const ADMIN_APPLICATION_NAME = "agenttool-watch-registry-test-admin";
const LOCK_APPLICATION_NAME = "agenttool-watch-registry-test-lock";

let admin: Sql | undefined;
let lockClient: Sql | undefined;
let observerClient: Sql | undefined;
let adminDatabase: ReturnType<typeof drizzle> | undefined;
let lockDatabase: ReturnType<typeof drizzle> | undefined;
let watchStore: DepositWatchStore | undefined;
let ownsEconomySchema = false;
let migratedLegacySnapshot:
  | {
      target_revision: number | null;
      observed_target_revision: number | null;
      status: string;
      last_outcome_code: string | null;
    }
  | undefined;

async function seedDeposit(
  sql: Sql,
  id: string,
  walletId: string,
  address: string,
): Promise<void> {
  await sql`
    INSERT INTO economy.deposit_addresses (
      id,
      wallet_id,
      chain,
      token,
      address,
      derivation_path
    )
    VALUES (
      ${id},
      ${walletId},
      'base',
      'USDC',
      ${address},
      ${"m/44'/60'/0'/0/1"}
    )
  `;
}

function activeTarget(
  targetFingerprint: string,
  targetRevision: number,
): DepositWatchTargetBinding {
  return {
    provider: "alchemy",
    chain: "base",
    network: "testnet",
    state: "active",
    targetFingerprint,
    targetRevision,
  };
}

function disabledTarget(targetRevision: number): DepositWatchTargetBinding {
  return {
    provider: "alchemy",
    chain: "base",
    network: "testnet",
    state: "disabled",
    targetFingerprint: SENTINEL,
    targetRevision,
  };
}

async function bindTargets(
  database: ReturnType<typeof drizzle>,
  bindings: readonly DepositWatchTargetBinding[],
) {
  return database.transaction((tx) =>
    bindDepositWatchTargetsInTransaction(tx as never, bindings)
  );
}

async function persistProductionWatch(
  database: ReturnType<typeof drizzle>,
  serial: number,
) {
  const decimalTail = serial.toString().padStart(12, "0");
  const addressTail = serial.toString(16).padStart(40, "0");
  return database.transaction((tx) =>
    persistDepositAddressAndDesiredWatchInTransaction(tx as never, {
      walletId: `21000000-0000-4000-8000-${decimalTail}`,
      chain: "base",
      token: "USDC",
      address: `0x${addressTail}`,
      derivationPath: `m/44'/60'/0'/0/${serial}`,
      provider: "alchemy",
      network: "testnet",
    })
  );
}

async function waitForClientLock(
  sql: Sql,
  applicationName: string,
): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const [blocked] = await sql<Array<{ blocked: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND application_name = ${applicationName}
          AND wait_event_type = 'Lock'
      ) AS blocked
    `;
    if (blocked?.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `expected PostgreSQL client ${applicationName} to reach a lock wait`,
  );
}

beforeAll(async () => {
  if (!TEST_DATABASE_URL) return;

  admin = postgres(TEST_DATABASE_URL, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    prepare: false,
    connection: {
      application_name: ADMIN_APPLICATION_NAME,
    },
  });
  lockClient = postgres(TEST_DATABASE_URL, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    prepare: false,
    connection: {
      application_name: LOCK_APPLICATION_NAME,
    },
  });
  observerClient = postgres(TEST_DATABASE_URL, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    prepare: false,
    connection: {
      application_name: "agenttool-watch-registry-test-observer",
    },
  });
  adminDatabase = drizzle(admin);
  lockDatabase = drizzle(lockClient);
  watchStore = createDrizzleDepositWatchStore(adminDatabase);

  const [existing] = await admin<Array<{ economy_schema: string | null }>>`
    SELECT to_regnamespace('economy')::text AS economy_schema
  `;
  if (existing?.economy_schema) {
    throw new Error(
      "DEPOSIT_WATCH_TEST_DATABASE_URL must name a disposable database without an economy schema",
    );
  }

  await admin.unsafe("CREATE SCHEMA economy;");
  ownsEconomySchema = true;
  await admin.unsafe(`
    CREATE TABLE economy.deposit_addresses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      wallet_id UUID NOT NULL,
      chain TEXT NOT NULL,
      token TEXT NOT NULL,
      address TEXT NOT NULL,
      derivation_path TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (wallet_id, chain, token),
      UNIQUE (id, chain)
    );

    CREATE TABLE economy.deposit_address_watches (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      deposit_address_id UUID NOT NULL,
      provider TEXT NOT NULL,
      chain TEXT NOT NULL,
      network TEXT NOT NULL,
      target_fingerprint TEXT,
      desired_state TEXT NOT NULL DEFAULT 'watching',
      observed_state TEXT NOT NULL DEFAULT 'unknown',
      status TEXT NOT NULL DEFAULT 'pending',
      generation INTEGER NOT NULL DEFAULT 1,
      observed_generation INTEGER,
      observed_target_fingerprint TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ DEFAULT now(),
      lease_id UUID,
      lease_owner TEXT,
      lease_expires_at TIMESTAMPTZ,
      last_outcome_code TEXT,
      last_attempt_at TIMESTAMPTZ,
      observed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (deposit_address_id, provider, chain, network),
      FOREIGN KEY (deposit_address_id, chain)
        REFERENCES economy.deposit_addresses (id, chain)
        ON DELETE CASCADE,
      CONSTRAINT deposit_watch_target_fingerprint CHECK (true),
      CONSTRAINT deposit_watch_observation_shape CHECK (true),
      CONSTRAINT deposit_watch_schedule_shape CHECK (true),
      CONSTRAINT deposit_watch_converged_shape CHECK (true),
      CONSTRAINT deposit_watch_retry_bound CHECK (true),
      CONSTRAINT deposit_watch_outcome_code CHECK (true)
    );

    CREATE INDEX idx_deposit_watch_due
      ON economy.deposit_address_watches (next_attempt_at, created_at);

    INSERT INTO economy.deposit_addresses (
      id,
      wallet_id,
      chain,
      token,
      address,
      derivation_path
    )
    VALUES (
      '20000000-0000-4000-8000-000000000099',
      '21000000-0000-4000-8000-000000000099',
      'base',
      'USDC',
      '0x0000000000000000000000000000000000000099',
      'm/44''/60''/0''/0/99'
    );

    INSERT INTO economy.deposit_address_watches (
      id,
      deposit_address_id,
      provider,
      chain,
      network,
      target_fingerprint,
      desired_state,
      observed_state,
      status,
      generation,
      observed_generation,
      observed_target_fingerprint,
      observed_at,
      next_attempt_at,
      last_outcome_code
    )
    VALUES (
      '10000000-0000-4000-8000-000000000099',
      '20000000-0000-4000-8000-000000000099',
      'alchemy',
      'base',
      'testnet',
      '${TARGET_1}',
      'watching',
      'watching',
      'converged',
      1,
      1,
      '${TARGET_1}',
      now(),
      NULL,
      'desired_state_verified'
    );
  `);

  const migration = await Bun.file(
    new URL(
      "../../migrations/20260726T214500_deposit_watch_target_registry.sql",
      import.meta.url,
    ),
  ).text();
  await admin.unsafe(`BEGIN;\n${migration}\nCOMMIT;`);

  const [legacy] = await admin<Array<{
    target_revision: number | null;
    observed_target_revision: number | null;
    status: string;
    last_outcome_code: string | null;
  }>>`
    SELECT
      target_revision,
      observed_target_revision,
      status,
      last_outcome_code
    FROM economy.deposit_address_watches
    WHERE id = '10000000-0000-4000-8000-000000000099'
  `;
  migratedLegacySnapshot = legacy;
});

beforeEach(async () => {
  if (!admin) return;
  await admin.unsafe(`
    DELETE FROM economy.deposit_address_watches;
    DELETE FROM economy.deposit_addresses;
    UPDATE economy.deposit_watch_targets
    SET state = 'unbound',
        target_fingerprint = '${SENTINEL}',
        target_revision = 0,
        updated_at = statement_timestamp();
  `);
});

afterAll(async () => {
  try {
    if (admin && ownsEconomySchema) {
      await admin.unsafe("DROP SCHEMA IF EXISTS economy CASCADE;");
    }
  } finally {
    await observerClient?.end({ timeout: 5 });
    await lockClient?.end({ timeout: 5 });
    await admin?.end({ timeout: 5 });
  }
});

describe("deposit-watch target registry — real PostgreSQL", () => {
  databaseTest("migration invalidates legacy evidence and installs a deferred head FK", async () => {
    expect(migratedLegacySnapshot).toEqual({
      target_revision: null,
      observed_target_revision: null,
      status: "blocked",
      last_outcome_code: "target_binding_required",
    });

    const [constraint] = await admin!<Array<{
      condeferrable: boolean;
      condeferred: boolean;
    }>>`
      SELECT condeferrable, condeferred
      FROM pg_constraint
      WHERE conname = 'fk_deposit_watch_registry_head'
    `;
    expect(constraint).toEqual({
      condeferrable: true,
      condeferred: true,
    });

    const binding = activeTarget(TARGET_1, 1);
    await bindTargets(adminDatabase!, [binding]);
    await seedDeposit(
      admin!,
      "20000000-0000-4000-8000-000000000001",
      "21000000-0000-4000-8000-000000000001",
      "0x0000000000000000000000000000000000000001",
    );
    await admin!`
      INSERT INTO economy.deposit_address_watches (
        id,
        deposit_address_id,
        provider,
        chain,
        network,
        target_fingerprint
      )
      VALUES (
        '10000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        'alchemy',
        'base',
        'testnet',
        ${TARGET_1}
      )
    `;

    expect(
      await watchStore!.claimDue({
        owner: "postgres-old-writer:test",
        limit: 1,
        leaseMs: 30_000,
        claimedAt: new Date(),
        targets: [binding],
      }),
    ).toEqual([]);

    let nullableConvergenceRejected = false;
    try {
      await admin!`
        UPDATE economy.deposit_address_watches
        SET observed_state = 'watching',
            observed_generation = generation,
            observed_target_fingerprint = target_fingerprint,
            observed_target_revision = NULL,
            observed_at = statement_timestamp(),
            status = 'converged',
            next_attempt_at = statement_timestamp() + interval '1 hour',
            last_outcome_code = 'desired_state_verified'
        WHERE id = '10000000-0000-4000-8000-000000000001'
      `;
    } catch {
      nullableConvergenceRejected = true;
    }
    expect(nullableConvergenceRejected).toBe(true);

    const prepared = await bindTargets(adminDatabase!, [binding]);
    expect(prepared).toMatchObject({
      conflicts: 0,
      staleBindings: 0,
      updatedWatches: 1,
    });
    const repairedClaims = await watchStore!.claimDue({
      owner: "postgres-new-worker:test",
      limit: 1,
      leaseMs: 30_000,
      claimedAt: new Date(),
      targets: [binding],
    });
    expect(repairedClaims).toHaveLength(1);
    expect(repairedClaims[0]).toMatchObject({
      id: "10000000-0000-4000-8000-000000000001",
      targetFingerprint: TARGET_1,
      targetRevision: 1,
    });
  });

  databaseTest("disclosure uses the database clock for fresh versus expired convergence", async () => {
    const binding = activeTarget(TARGET_1, 1);
    await bindTargets(adminDatabase!, [binding]);
    const persisted = await persistProductionWatch(adminDatabase!, 9);
    const [claim] = await watchStore!.claimDue({
      owner: "postgres-freshness:test",
      limit: 1,
      leaseMs: 30_000,
      claimedAt: new Date(),
      targets: [binding],
    });
    expect(claim?.id).toBe(persisted.watchId);

    const completedAt = new Date();
    expect(
      await watchStore!.complete({
        id: claim!.id,
        leaseId: claim!.leaseId,
        generation: claim!.generation,
        targetFingerprint: TARGET_1,
        targetRevision: 1,
        completedAt,
        status: "converged",
        nextAttemptAt: new Date(completedAt.getTime() + 24 * 60 * 60_000),
        outcomeCode: "desired_state_verified",
        observation: {
          state: "watching",
          generation: claim!.generation,
          at: completedAt,
        },
      }),
    ).toBe(true);

    const fresh = await persistProductionWatch(adminDatabase!, 9);
    expect(fresh).toMatchObject({
      watchId: persisted.watchId,
      status: "converged",
      generation: 1,
      observedGeneration: 1,
      observedTargetFingerprint: TARGET_1,
      observedTargetRevision: 1,
      databaseFresh: true,
    });

    await admin!`
      UPDATE economy.deposit_address_watches
      SET observed_at =
            clock_timestamp() - interval '10 minutes 1 millisecond',
          next_attempt_at = statement_timestamp() + interval '23 hours'
      WHERE id = ${persisted.watchId}
    `;
    const expired = await persistProductionWatch(adminDatabase!, 9);
    expect(expired).toMatchObject({
      watchId: persisted.watchId,
      status: "pending",
      generation: 2,
      observedGeneration: 1,
      observedTargetFingerprint: TARGET_1,
      observedTargetRevision: 1,
      databaseFresh: false,
    });
  });

  databaseTest("parent-head rotation and child rebinding commit atomically", async () => {
    await bindTargets(adminDatabase!, [activeTarget(TARGET_1, 1)]);
    const persisted = await persistProductionWatch(adminDatabase!, 2);
    const prepared = await bindTargets(lockDatabase!, [
      activeTarget(TARGET_2, 2),
    ]);
    expect(prepared).toMatchObject({
      conflicts: 0,
      staleBindings: 0,
      updatedWatches: 1,
    });

    const [row] = await admin!<Array<{
      target_fingerprint: string;
      target_revision: number;
      generation: number;
    }>>`
      SELECT target_fingerprint, target_revision, generation
      FROM economy.deposit_address_watches
      WHERE id = ${persisted.watchId}
    `;
    expect(row).toEqual({
      target_fingerprint: TARGET_2,
      target_revision: 2,
      generation: 2,
    });
  });

  databaseTest("a parent-only head rotation fails at commit and rolls back", async () => {
    await bindTargets(adminDatabase!, [activeTarget(TARGET_1, 1)]);
    const persisted = await persistProductionWatch(adminDatabase!, 6);

    let errorCode: string | undefined;
    try {
      await lockClient!.begin(async (tx) => {
        await tx`
          UPDATE economy.deposit_watch_targets
          SET target_fingerprint = ${TARGET_2},
              target_revision = 2,
              updated_at = statement_timestamp()
          WHERE provider = 'alchemy'
            AND chain = 'base'
            AND network = 'testnet'
        `;
      });
    } catch (error) {
      errorCode = (error as { code?: string }).code;
    }
    expect(errorCode).toBe("23503");

    const [head] = await admin!<Array<{
      target_fingerprint: string;
      target_revision: number;
    }>>`
      SELECT target_fingerprint, target_revision
      FROM economy.deposit_watch_targets
      WHERE provider = 'alchemy'
        AND chain = 'base'
        AND network = 'testnet'
    `;
    const [watch] = await admin!<Array<{
      target_fingerprint: string;
      target_revision: number;
      generation: number;
    }>>`
      SELECT target_fingerprint, target_revision, generation
      FROM economy.deposit_address_watches
      WHERE id = ${persisted.watchId}
    `;
    expect(head).toEqual({
      target_fingerprint: TARGET_1,
      target_revision: 1,
    });
    expect(watch).toEqual({
      target_fingerprint: TARGET_1,
      target_revision: 1,
      generation: 1,
    });
  });

  databaseTest("same-revision conflict persists until a higher revision repairs it", async () => {
    const original = activeTarget(TARGET_1, 1);
    await bindTargets(adminDatabase!, [original]);
    const persisted = await persistProductionWatch(adminDatabase!, 7);

    const conflict = await bindTargets(lockDatabase!, [
      activeTarget(TARGET_2, 1),
    ]);
    expect(conflict).toMatchObject({
      conflicts: 1,
      staleBindings: 0,
      updatedWatches: 1,
    });
    const [conflictedHead] = await admin!<Array<{
      state: string;
      target_fingerprint: string;
      target_revision: number;
    }>>`
      SELECT state, target_fingerprint, target_revision
      FROM economy.deposit_watch_targets
      WHERE provider = 'alchemy'
        AND chain = 'base'
        AND network = 'testnet'
    `;
    const [blockedWatch] = await admin!<Array<{
      status: string;
      generation: number;
      last_outcome_code: string | null;
    }>>`
      SELECT status, generation, last_outcome_code
      FROM economy.deposit_address_watches
      WHERE id = ${persisted.watchId}
    `;
    expect(conflictedHead).toEqual({
      state: "conflicted",
      target_fingerprint: TARGET_1,
      target_revision: 1,
    });
    expect(blockedWatch).toEqual({
      status: "blocked",
      generation: 2,
      last_outcome_code: "provider_target_mismatch",
    });
    expect(
      await watchStore!.claimDue({
        owner: "postgres-conflicted:test",
        limit: 1,
        leaseMs: 30_000,
        claimedAt: new Date(),
        targets: [original],
      }),
    ).toEqual([]);

    const repairedBinding = activeTarget(TARGET_2, 2);
    const repaired = await bindTargets(adminDatabase!, [repairedBinding]);
    expect(repaired).toMatchObject({
      conflicts: 0,
      staleBindings: 0,
      updatedWatches: 1,
    });
    const [repairedWatch] = await admin!<Array<{
      status: string;
      generation: number;
      target_fingerprint: string;
      target_revision: number;
      last_outcome_code: string | null;
    }>>`
      SELECT
        status,
        generation,
        target_fingerprint,
        target_revision,
        last_outcome_code
      FROM economy.deposit_address_watches
      WHERE id = ${persisted.watchId}
    `;
    expect(repairedWatch).toEqual({
      status: "pending",
      generation: 3,
      target_fingerprint: TARGET_2,
      target_revision: 2,
      last_outcome_code: null,
    });
  });

  databaseTest("an explicit disabled tombstone fences a live lease", async () => {
    const active = activeTarget(TARGET_1, 1);
    await bindTargets(adminDatabase!, [active]);
    const persisted = await persistProductionWatch(adminDatabase!, 8);
    const [claim] = await watchStore!.claimDue({
      owner: "postgres-before-disable:test",
      limit: 1,
      leaseMs: 30_000,
      claimedAt: new Date(),
      targets: [active],
    });
    expect(claim?.id).toBe(persisted.watchId);

    const disabled = await bindTargets(lockDatabase!, [disabledTarget(2)]);
    expect(disabled).toMatchObject({
      conflicts: 0,
      staleBindings: 0,
      updatedWatches: 1,
    });
    const [head] = await admin!<Array<{
      state: string;
      target_fingerprint: string;
      target_revision: number;
    }>>`
      SELECT state, target_fingerprint, target_revision
      FROM economy.deposit_watch_targets
      WHERE provider = 'alchemy'
        AND chain = 'base'
        AND network = 'testnet'
    `;
    const [watch] = await admin!<Array<{
      status: string;
      generation: number;
      target_fingerprint: string;
      target_revision: number;
      lease_id: string | null;
      last_outcome_code: string | null;
    }>>`
      SELECT
        status,
        generation,
        target_fingerprint,
        target_revision,
        lease_id,
        last_outcome_code
      FROM economy.deposit_address_watches
      WHERE id = ${persisted.watchId}
    `;
    expect(head).toEqual({
      state: "disabled",
      target_fingerprint: SENTINEL,
      target_revision: 2,
    });
    expect(watch).toEqual({
      status: "blocked",
      generation: 2,
      target_fingerprint: SENTINEL,
      target_revision: 2,
      lease_id: null,
      last_outcome_code: "provider_target_disabled",
    });

    const completedAt = new Date();
    expect(
      await watchStore!.complete({
        id: claim!.id,
        leaseId: claim!.leaseId,
        generation: claim!.generation,
        targetFingerprint: TARGET_1,
        targetRevision: 1,
        completedAt,
        status: "retry_wait",
        nextAttemptAt: new Date(completedAt.getTime() + 30_000),
        outcomeCode: "provider_unavailable",
      }),
    ).toBe(false);
  });

  databaseTest("issuance holding the old head cannot be missed by a concurrent rotation", async () => {
    await bindTargets(adminDatabase!, [activeTarget(TARGET_1, 1)]);

    let releaseIssuance!: () => void;
    let headLocked!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseIssuance = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      headLocked = resolve;
    });

    const issuance = lockClient!.begin(async (tx) => {
      await tx`
        INSERT INTO economy.deposit_addresses (
          id,
          wallet_id,
          chain,
          token,
          address,
          derivation_path
        )
        VALUES (
          '20000000-0000-4000-8000-000000000003',
          '21000000-0000-4000-8000-000000000003',
          'base',
          'USDC',
          '0x0000000000000000000000000000000000000003',
          'm/44''/60''/0''/0/3'
        )
      `;
      await tx`
        SELECT id
        FROM economy.deposit_addresses
        WHERE wallet_id = '21000000-0000-4000-8000-000000000003'
          AND chain = 'base'
          AND token = 'USDC'
        FOR UPDATE
      `;
      await tx`
        INSERT INTO economy.deposit_watch_targets (
          provider,
          chain,
          network,
          state,
          target_fingerprint,
          target_revision
        )
        VALUES (
          'alchemy',
          'base',
          'testnet',
          'unbound',
          ${SENTINEL},
          0
        )
        ON CONFLICT DO NOTHING
      `;
      const [head] = await tx<Array<{
        target_fingerprint: string;
        target_revision: number;
      }>>`
        SELECT target_fingerprint, target_revision
        FROM economy.deposit_watch_targets
        WHERE provider = 'alchemy'
          AND chain = 'base'
          AND network = 'testnet'
        FOR SHARE
      `;
      await tx`
        INSERT INTO economy.deposit_address_watches (
          id,
          deposit_address_id,
          provider,
          chain,
          network,
          target_fingerprint,
          target_revision
        )
        VALUES (
          '10000000-0000-4000-8000-000000000003',
          '20000000-0000-4000-8000-000000000003',
          'alchemy',
          'base',
          'testnet',
          ${head!.target_fingerprint},
          ${head!.target_revision}
        )
      `;
      headLocked();
      await release;
    });
    await locked;

    const rotation = bindTargets(adminDatabase!, [
      activeTarget(TARGET_2, 2),
    ]);
    await waitForClientLock(
      observerClient!,
      ADMIN_APPLICATION_NAME,
    );

    releaseIssuance();
    await issuance;
    await rotation;

    const [watch] = await admin!<Array<{
      target_revision: number;
      target_fingerprint: string;
    }>>`
      SELECT target_revision, target_fingerprint
      FROM economy.deposit_address_watches
      WHERE id = '10000000-0000-4000-8000-000000000003'
    `;
    expect(watch).toEqual({
      target_revision: 2,
      target_fingerprint: TARGET_2,
    });
  });

  databaseTest("issuance waits for a rotation that already owns the head", async () => {
    await bindTargets(adminDatabase!, [activeTarget(TARGET_1, 1)]);

    let releaseRotation!: () => void;
    let headRotated!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseRotation = resolve;
    });
    const rotated = new Promise<void>((resolve) => {
      headRotated = resolve;
    });
    const rotation = lockClient!.begin(async (tx) => {
      await tx`
        UPDATE economy.deposit_watch_targets
        SET target_fingerprint = ${TARGET_2},
            target_revision = 2,
            updated_at = statement_timestamp()
        WHERE provider = 'alchemy'
          AND chain = 'base'
          AND network = 'testnet'
      `;
      headRotated();
      await release;
    });
    await rotated;

    const issuance = persistProductionWatch(adminDatabase!, 5);
    await waitForClientLock(observerClient!, ADMIN_APPLICATION_NAME);

    releaseRotation();
    await rotation;
    const persisted = await issuance;

    const [watch] = await admin!<Array<{
      target_revision: number;
      target_fingerprint: string;
    }>>`
      SELECT target_revision, target_fingerprint
      FROM economy.deposit_address_watches
      WHERE id = ${persisted.watchId}
    `;
    expect(watch).toEqual({
      target_revision: 2,
      target_fingerprint: TARGET_2,
    });
  });

  databaseTest("rotation invalidates a leased old completion and stale local claims", async () => {
    const oldBinding = activeTarget(TARGET_1, 1);
    const currentBinding = activeTarget(TARGET_3, 2);
    await bindTargets(adminDatabase!, [oldBinding]);
    const persisted = await persistProductionWatch(adminDatabase!, 4);
    const [claim] = await watchStore!.claimDue({
      owner: "postgres-old-target:test",
      limit: 1,
      leaseMs: 30_000,
      claimedAt: new Date(),
      targets: [oldBinding],
    });
    expect(claim?.id).toBe(persisted.watchId);

    await bindTargets(lockDatabase!, [currentBinding]);
    const completedAt = new Date();
    expect(
      await watchStore!.complete({
        id: claim!.id,
        leaseId: claim!.leaseId,
        generation: claim!.generation,
        targetFingerprint: TARGET_1,
        targetRevision: 1,
        completedAt,
        status: "converged",
        nextAttemptAt: new Date(completedAt.getTime() + 60 * 60_000),
        outcomeCode: "desired_state_verified",
        observation: {
          state: "watching",
          generation: claim!.generation,
          at: completedAt,
        },
      }),
    ).toBe(false);

    expect(
      await watchStore!.claimDue({
        owner: "postgres-stale-local:test",
        limit: 1,
        leaseMs: 30_000,
        claimedAt: new Date(),
        targets: [oldBinding],
      }),
    ).toEqual([]);
    const currentClaims = await watchStore!.claimDue({
      owner: "postgres-current-local:test",
      limit: 1,
      leaseMs: 30_000,
      claimedAt: new Date(),
      targets: [currentBinding],
    });
    expect(currentClaims).toHaveLength(1);
    expect(currentClaims[0]?.id).toBe(persisted.watchId);
  });
});
