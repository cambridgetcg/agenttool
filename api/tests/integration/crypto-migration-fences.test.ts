/** Real-Postgres proof for the crypto rolling-upgrade database fences.
 *
 * Opt in with a dedicated, disposable database:
 *
 *   CRYPTO_FENCE_TEST_DATABASE_URL=postgres://... \
 *     bun test tests/integration/crypto-migration-fences.test.ts
 *
 * The suite refuses a database where `economy` already exists, creates only
 * the minimal historical tables needed by the production migrations, and
 * drops that schema on completion.
 *
 * Doctrine: docs/CRYPTO-PAYMENT.md · docs/PAYOUT-BROADCAST.md. */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import postgres, { type Sql } from "postgres";

const TEST_DATABASE_URL =
  process.env.CRYPTO_FENCE_TEST_DATABASE_URL ?? "";
const databaseTest = TEST_DATABASE_URL ? test : test.skip;

const TX_A = `0x${"a".repeat(64)}`;
const TX_B = `0x${"b".repeat(64)}`;
const SOURCE = `0x${"1".repeat(40)}`;

let sql: Sql | undefined;
let ownsSchema = false;

async function expectSqlState(
  operation: () => Promise<unknown>,
  code: "23505" | "23514",
): Promise<void> {
  try {
    await operation();
    throw new Error(`expected PostgreSQL SQLSTATE ${code}`);
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code);
  }
}

beforeAll(async () => {
  if (!TEST_DATABASE_URL) return;

  sql = postgres(TEST_DATABASE_URL, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    prepare: false,
    onnotice: () => undefined,
  });

  const [existing] = await sql<Array<{ economy_schema: string | null }>>`
    SELECT to_regnamespace('economy')::text AS economy_schema
  `;
  if (existing?.economy_schema) {
    throw new Error(
      "CRYPTO_FENCE_TEST_DATABASE_URL must name a disposable database without an economy schema",
    );
  }

  await sql.unsafe(`
    CREATE SCHEMA economy;
    CREATE TABLE economy.crypto_payouts (
      id text PRIMARY KEY,
      status text NOT NULL DEFAULT 'requested',
      chain text NOT NULL,
      tx_hash text,
      requested_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE economy.crypto_webhook_events (
      id text PRIMARY KEY,
      status text NOT NULL
    );
  `);
  ownsSchema = true;

  await sql`
    INSERT INTO economy.crypto_payouts (id, status, chain, tx_hash)
    VALUES ('legacy-ambiguous', 'broadcasting', 'ethereum', ${TX_A})
  `;
  await sql`
    INSERT INTO economy.crypto_payouts (id, status, chain)
    VALUES
      ('old-worker', 'requested', 'ethereum'),
      ('partial-tuple', 'requested', 'ethereum'),
      ('current-worker', 'requested', 'ethereum'),
      ('duplicate-nonce', 'requested', 'ethereum'),
      ('network-legacy', 'requested', 'ethereum')
  `;
  await sql`
    INSERT INTO economy.crypto_webhook_events (id, status)
    VALUES
      ('historical-credit', 'credited'),
      ('legacy-reactivation', 'removed'),
      ('old-confirmer', 'pending'),
      ('wrong-generation', 'removed')
  `;

  for (const migrationName of [
    "20260726T194500_evm_payout_nonce_fence.sql",
    "20260726T200000_deposit_observation_generation.sql",
    "20260726T201000_payout_dispatch_fairness.sql",
    "20260726T203000_payout_network_binding.sql",
  ]) {
    const migration = await Bun.file(
      new URL(`../../migrations/${migrationName}`, import.meta.url),
    ).text();
    await sql.unsafe(migration);
  }
});

afterAll(async () => {
  if (!sql) return;
  try {
    if (ownsSchema) {
      await sql.unsafe("DROP SCHEMA IF EXISTS economy CASCADE");
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
});

describe("crypto migrations — real PostgreSQL fences", () => {
  databaseTest("enforces complete nonce evidence across rolling workers", async () => {
    if (!sql) throw new Error("crypto fence database is not initialized");

    const [legacyConstraint] = await sql<Array<{ convalidated: boolean }>>`
      SELECT convalidated
      FROM pg_constraint
      WHERE conrelid = 'economy.crypto_payouts'::regclass
        AND conname = 'crypto_payouts_evm_broadcasting_evidence_check'
    `;
    expect(legacyConstraint?.convalidated).toBe(false);

    await expectSqlState(
      () =>
        sql!`
          UPDATE economy.crypto_payouts
          SET status = 'broadcasting', tx_hash = ${TX_B}
          WHERE id = 'old-worker'
        `,
      "23514",
    );
    await expectSqlState(
      () =>
        sql!`
          UPDATE economy.crypto_payouts
          SET evm_chain_id = 1
          WHERE id = 'partial-tuple'
        `,
      "23514",
    );

    await sql`
      UPDATE economy.crypto_payouts
      SET
        status = 'broadcasting',
        tx_hash = ${TX_B},
        evm_chain_id = 1,
        evm_source_address = ${SOURCE},
        evm_nonce = 7
      WHERE id = 'current-worker'
    `;
    await expectSqlState(
      () =>
        sql!`
          UPDATE economy.crypto_payouts
          SET
            evm_chain_id = 1,
            evm_source_address = ${SOURCE},
            evm_nonce = 7
          WHERE id = 'duplicate-nonce'
        `,
      "23505",
    );

    await expectSqlState(
      () =>
        sql!.unsafe(`
          ALTER TABLE economy.crypto_payouts
            VALIDATE CONSTRAINT
              crypto_payouts_evm_broadcasting_evidence_check
        `),
      "23514",
    );
    await sql`
      UPDATE economy.crypto_payouts
      SET status = 'broadcast'
      WHERE id = 'legacy-ambiguous'
    `;
    await sql.unsafe(`
      ALTER TABLE economy.crypto_payouts
        VALIDATE CONSTRAINT
          crypto_payouts_evm_broadcasting_evidence_check
    `);
    const [validated] = await sql<Array<{ convalidated: boolean }>>`
      SELECT convalidated
      FROM pg_constraint
      WHERE conrelid = 'economy.crypto_payouts'::regclass
        AND conname = 'crypto_payouts_evm_broadcasting_evidence_check'
    `;
    expect(validated?.convalidated).toBe(true);

    const [dispatchColumns] = await sql<Array<{ count: string }>>`
      SELECT count(*)::text AS count
      FROM information_schema.columns
      WHERE table_schema = 'economy'
        AND table_name = 'crypto_payouts'
        AND column_name IN ('dispatch_after', 'last_dispatch_attempt_at')
    `;
    expect(dispatchColumns?.count).toBe("2");
  });

  databaseTest("binds credited effects to one observation generation", async () => {
    if (!sql) throw new Error("crypto fence database is not initialized");

    const [historical] = await sql<Array<{
      observation_generation: number;
      credited_generation: number;
    }>>`
      SELECT observation_generation, credited_generation
      FROM economy.crypto_webhook_events
      WHERE id = 'historical-credit'
    `;
    expect(historical).toEqual({
      observation_generation: 1,
      credited_generation: 1,
    });

    await sql`
      UPDATE economy.crypto_webhook_events
      SET status = 'removed'
      WHERE id = 'historical-credit'
    `;
    await sql`
      UPDATE economy.crypto_webhook_events
      SET status = 'pending'
      WHERE id = 'historical-credit'
    `;
    const [reactivatedCredit] = await sql<Array<{
      status: string;
      observation_generation: number;
      credited_generation: number | null;
    }>>`
      SELECT status, observation_generation, credited_generation
      FROM economy.crypto_webhook_events
      WHERE id = 'historical-credit'
    `;
    expect(reactivatedCredit).toEqual({
      status: "pending",
      observation_generation: 2,
      credited_generation: null,
    });

    await sql`
      UPDATE economy.crypto_webhook_events
      SET status = 'pending'
      WHERE id = 'legacy-reactivation'
    `;
    const [legacyReactivation] = await sql<Array<{
      observation_generation: number;
      credited_generation: number | null;
    }>>`
      SELECT observation_generation, credited_generation
      FROM economy.crypto_webhook_events
      WHERE id = 'legacy-reactivation'
    `;
    expect(legacyReactivation).toEqual({
      observation_generation: 2,
      credited_generation: null,
    });

    await expectSqlState(
      () =>
        sql!`
          UPDATE economy.crypto_webhook_events
          SET status = 'credited'
          WHERE id = 'old-confirmer'
        `,
      "23514",
    );
    await sql`
      UPDATE economy.crypto_webhook_events
      SET
        status = 'credited',
        credited_generation = observation_generation
      WHERE id = 'old-confirmer'
    `;

    await expectSqlState(
      () =>
        sql!`
          INSERT INTO economy.crypto_webhook_events
            (id, status, credited_generation)
          VALUES ('invalid-pending', 'pending', 1)
        `,
      "23514",
    );
    await expectSqlState(
      () =>
        sql!`
          INSERT INTO economy.crypto_webhook_events (id, status)
          VALUES ('old-immediate-credit', 'credited')
        `,
      "23514",
    );
    await sql`
      INSERT INTO economy.crypto_webhook_events
        (id, status, observation_generation, credited_generation)
      VALUES ('current-immediate-credit', 'credited', 1, 1)
    `;

    await expectSqlState(
      () =>
        sql!`
          UPDATE economy.crypto_webhook_events
          SET
            status = 'pending',
            observation_generation = observation_generation + 2
          WHERE id = 'wrong-generation'
        `,
      "23514",
    );
    await expectSqlState(
      () =>
        sql!`
          UPDATE economy.crypto_webhook_events
          SET observation_generation = observation_generation + 1
          WHERE id = 'current-immediate-credit'
        `,
      "23514",
    );
  });

  databaseTest("binds each reconciled payout to one immutable network", async () => {
    if (!sql) throw new Error("crypto fence database is not initialized");

    const [legacy] = await sql<Array<{ network: string | null }>>`
      SELECT network
      FROM economy.crypto_payouts
      WHERE id = 'network-legacy'
    `;
    expect(legacy?.network).toBeNull();

    const [constraint] = await sql<Array<{ convalidated: boolean }>>`
      SELECT convalidated
      FROM pg_constraint
      WHERE conrelid = 'economy.crypto_payouts'::regclass
        AND conname = 'crypto_payouts_network_check'
    `;
    expect(constraint?.convalidated).toBe(false);

    await expectSqlState(
      () =>
        sql!`
          UPDATE economy.crypto_payouts
          SET network = 'maybe'
          WHERE id = 'network-legacy'
        `,
      "23514",
    );
    await sql`
      UPDATE economy.crypto_payouts
      SET network = 'testnet'
      WHERE id = 'network-legacy'
    `;
    await expectSqlState(
      () =>
        sql!`
          UPDATE economy.crypto_payouts
          SET network = 'mainnet'
          WHERE id = 'network-legacy'
        `,
      "23514",
    );
  });
});
