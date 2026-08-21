/** Real-Postgres regression coverage for the historical payout-policy E2E
 * fixture repair.
 *
 * Opt in with an empty disposable database:
 *
 *   PAYOUT_FIXTURE_REPAIR_TEST_DATABASE_URL=postgres://... \
 *     bun test tests/integration/payout-policy-e2e-fixture-repair-postgres.test.ts
 *
 * The suite refuses a database where `tools` or `economy` already exists,
 * creates only the pre-repair columns, and drops only the schemas it owns.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import type { Sql } from "postgres";
import postgres from "../fixtures/verified-postgres";

const TEST_DATABASE_URL =
  process.env.PAYOUT_FIXTURE_REPAIR_TEST_DATABASE_URL ?? "";
const databaseTest = TEST_DATABASE_URL ? test : test.skip;
const SOURCE_HASH_0 =
  "0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0";
const SOURCE_HASH_1 =
  "0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff1";
const DESTINATION = "0x000000000000000000000000000000000000dEaD";
const REPAIR_ERROR = "synthetic_policy_e2e_fixture_reconciled";

let admin: Sql | undefined;
let ownsSchemas = false;
let projectSerial = 1715200000000;
let migration = "";

interface Fixture {
  projectIds: string[];
  walletIds: string[];
  payoutIds: string[];
}

function requireAdmin(): Sql {
  if (!admin) throw new Error("fixture repair database is not initialized");
  return admin;
}

async function seedRun(
  hash0 = SOURCE_HASH_0,
  hash1 = SOURCE_HASH_1,
): Promise<{
  projectId: string;
  walletId: string;
  payoutIds: string[];
}> {
  const sql = requireAdmin();
  const projectId = crypto.randomUUID();
  const walletId = crypto.randomUUID();
  projectSerial += 1;

  await sql`
    INSERT INTO tools.projects (id, name)
    VALUES (${projectId}, ${`e2e-policies-${projectSerial}`})
  `;
  await sql`
    INSERT INTO economy.wallets (
      id,
      project_id,
      name,
      identity_id,
      balance,
      currency,
      status,
      owner_type
    )
    VALUES (
      ${walletId},
      ${projectId},
      'policies-test',
      ${crypto.randomUUID()},
      10000,
      'USDC',
      'active',
      'platform'
    )
  `;
  await sql`
    INSERT INTO economy.transactions (
      id,
      wallet_id,
      type,
      amount,
      description,
      metadata
    )
    VALUES (
      ${crypto.randomUUID()},
      ${walletId},
      'fund',
      10000,
      'e2e policies seed',
      '{}'::jsonb
    )
  `;

  const payoutIds: string[] = [];
  for (const txHash of [hash0, hash1]) {
    const payoutId = crypto.randomUUID();
    payoutIds.push(payoutId);
    await sql`
      INSERT INTO economy.crypto_payouts (
        id,
        wallet_id,
        project_id,
        chain,
        token,
        amount_base,
        destination_address,
        status,
        tx_hash,
        error,
        metadata,
        requested_at,
        confirmed_at
      )
      VALUES (
        ${payoutId},
        ${walletId},
        ${projectId},
        'ethereum',
        'USDC',
        4000000,
        ${DESTINATION},
        'broadcast',
        ${txHash},
        NULL,
        '{}'::jsonb,
        now(),
        NULL
      )
    `;
  }
  return { projectId, walletId, payoutIds };
}

async function seedCompleteFixture(): Promise<Fixture> {
  const first = await seedRun();
  const second = await seedRun();
  return {
    projectIds: [first.projectId, second.projectId],
    walletIds: [first.walletId, second.walletId],
    payoutIds: [...first.payoutIds, ...second.payoutIds],
  };
}

async function applyRepair(): Promise<void> {
  await requireAdmin().unsafe(migration);
}

beforeAll(async () => {
  if (!TEST_DATABASE_URL) return;

  admin = postgres(TEST_DATABASE_URL, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    prepare: false,
    connection: {
      application_name: "agenttool-payout-fixture-repair-test",
    },
  });

  const [existing] = await admin<Array<{
    tools_schema: string | null;
    economy_schema: string | null;
  }>>`
    SELECT
      to_regnamespace('tools')::text AS tools_schema,
      to_regnamespace('economy')::text AS economy_schema
  `;
  if (existing?.tools_schema || existing?.economy_schema) {
    throw new Error(
      "PAYOUT_FIXTURE_REPAIR_TEST_DATABASE_URL must name an empty disposable database without tools or economy schemas",
    );
  }

  await admin.unsafe(`
    CREATE SCHEMA tools;
    CREATE SCHEMA economy;

    CREATE TABLE tools.projects (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE economy.wallets (
      id UUID PRIMARY KEY,
      project_id UUID NOT NULL,
      name TEXT NOT NULL,
      identity_id TEXT,
      balance BIGINT NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      owner_type TEXT NOT NULL
    );

    CREATE TABLE economy.transactions (
      id UUID PRIMARY KEY,
      wallet_id UUID NOT NULL,
      type TEXT NOT NULL,
      amount BIGINT NOT NULL,
      counterparty TEXT,
      description TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE TABLE economy.crypto_payouts (
      id UUID PRIMARY KEY,
      wallet_id UUID NOT NULL,
      project_id UUID NOT NULL,
      chain TEXT NOT NULL,
      token TEXT NOT NULL,
      amount_base NUMERIC(78, 0) NOT NULL,
      destination_address TEXT NOT NULL,
      status TEXT NOT NULL,
      tx_hash TEXT,
      error TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      confirmed_at TIMESTAMPTZ
    );
  `);
  ownsSchemas = true;
  migration = await Bun.file(
    new URL(
      "../../migrations/20260726T191000_payout_policy_e2e_fixture_repair.sql",
      import.meta.url,
    ),
  ).text();
});

beforeEach(async () => {
  if (!admin) return;
  projectSerial = 1715200000000;
  await admin.unsafe(`
    TRUNCATE TABLE
      economy.crypto_payouts,
      economy.transactions,
      economy.wallets,
      tools.projects;
  `);
});

afterAll(async () => {
  if (!admin) return;
  try {
    if (ownsSchemas) {
      await admin.unsafe(
        "DROP SCHEMA IF EXISTS economy CASCADE; DROP SCHEMA IF EXISTS tools CASCADE;",
      );
    }
  } finally {
    await admin.end({ timeout: 5 });
  }
});

describe("payout-policy E2E fixture repair — real Postgres", () => {
  databaseTest("allows zero source rows when operation identities are singular", async () => {
    const sql = requireAdmin();
    const run = await seedRun(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    );

    await applyRepair();
    await applyRepair();

    const rows = await sql<Array<{ status: string; tx_hash: string | null }>>`
      SELECT status, tx_hash
      FROM economy.crypto_payouts
      WHERE wallet_id = ${run.walletId}
      ORDER BY tx_hash
    `;
    expect(rows).toEqual([
      {
        status: "broadcast",
        tx_hash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      {
        status: "broadcast",
        tx_hash:
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    ]);
  });

  databaseTest("atomically repairs exactly four rows without wallet or ledger mutation", async () => {
    const sql = requireAdmin();
    const fixture = await seedCompleteFixture();
    const walletsBefore = await sql`
      SELECT id, balance
      FROM economy.wallets
      ORDER BY id
    `;
    const ledgerBefore = await sql`
      SELECT id, wallet_id, type, amount, description, metadata
      FROM economy.transactions
      ORDER BY id
    `;

    await applyRepair();
    // Once repaired, the exact same migration takes its zero-source no-op path.
    await applyRepair();

    const repaired = await sql<Array<{
      id: string;
      status: string;
      tx_hash: string | null;
      error: string | null;
      metadata: {
        fixture_repair?: {
          migration?: string;
          kind?: string;
          source?: string;
          original_tx_hash?: string;
        };
      };
    }>>`
      SELECT id, status, tx_hash, error, metadata
      FROM economy.crypto_payouts
      ORDER BY id
    `;
    expect(repaired).toHaveLength(4);
    expect(repaired.map((row) => row.id).sort()).toEqual(
      [...fixture.payoutIds].sort(),
    );
    for (const row of repaired) {
      expect(row.status).toBe("failed");
      expect(row.tx_hash).toBeNull();
      expect(row.error).toBe(REPAIR_ERROR);
      expect(row.metadata.fixture_repair).toMatchObject({
        migration: "20260726T191000_payout_policy_e2e_fixture_repair",
        kind: "synthetic_daily_ceiling_seed",
        source: "api/scripts/_e2e-payout-policies.ts",
      });
      expect([
        SOURCE_HASH_0,
        SOURCE_HASH_1,
      ]).toContain(row.metadata.fixture_repair?.original_tx_hash);
    }

    expect(
      await sql`
        SELECT id, balance
        FROM economy.wallets
        ORDER BY id
      `,
    ).toEqual(walletsBefore);
    expect(
      await sql`
        SELECT id, wallet_id, type, amount, description, metadata
        FROM economy.transactions
        ORDER BY id
      `,
    ).toEqual(ledgerBefore);
  });

  databaseTest("rejects a partial historical run without changing it", async () => {
    const sql = requireAdmin();
    await seedRun();

    await expect(applyRepair()).rejects.toThrow("expected 0 or 4 source rows");

    const [state] = await sql<Array<{
      total: number;
      broadcasts: number;
      identities: number;
    }>>`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE status = 'broadcast')::int AS broadcasts,
        count(*) FILTER (WHERE tx_hash IS NOT NULL)::int AS identities
      FROM economy.crypto_payouts
    `;
    expect(state).toEqual({ total: 2, broadcasts: 2, identities: 2 });
  });

  databaseTest("rejects a changed near-match and rolls the whole repair back", async () => {
    const sql = requireAdmin();
    const fixture = await seedCompleteFixture();
    await sql`
      UPDATE economy.crypto_payouts
      SET metadata = '{"unexpected":true}'::jsonb
      WHERE id = ${fixture.payoutIds[0]!}
    `;

    await expect(applyRepair()).rejects.toThrow(
      "refused changed or non-E2E source rows",
    );

    const [state] = await sql<Array<{
      broadcasts: number;
      identities: number;
    }>>`
      SELECT
        count(*) FILTER (WHERE status = 'broadcast')::int AS broadcasts,
        count(*) FILTER (WHERE tx_hash IS NOT NULL)::int AS identities
      FROM economy.crypto_payouts
    `;
    expect(state).toEqual({ broadcasts: 4, identities: 4 });
  });

  databaseTest("rejects any payout ledger leg or reversal provenance", async () => {
    const sql = requireAdmin();
    const fixture = await seedCompleteFixture();
    await sql`
      INSERT INTO economy.transactions (
        id,
        wallet_id,
        type,
        amount,
        counterparty,
        metadata
      )
      VALUES (
        ${crypto.randomUUID()},
        ${fixture.walletIds[0]!},
        'payout',
        -1,
        ${DESTINATION},
        ${sql.json({
          payout_id: fixture.payoutIds[0],
          amount_base: "4000000",
          token: "USDC",
        })}
      )
    `;

    await expect(applyRepair()).rejects.toThrow(
      "found payout ledger legs or reversals",
    );

    const [state] = await sql<Array<{
      broadcasts: number;
      identities: number;
    }>>`
      SELECT
        count(*) FILTER (WHERE status = 'broadcast')::int AS broadcasts,
        count(*) FILTER (WHERE tx_hash IS NOT NULL)::int AS identities
      FROM economy.crypto_payouts
    `;
    expect(state).toEqual({ broadcasts: 4, identities: 4 });
  });

  databaseTest("zero-source mode still refuses unrelated duplicates", async () => {
    await seedRun(
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );

    await expect(applyRepair()).rejects.toThrow(
      "unrelated duplicate operation identities",
    );
  });
});
