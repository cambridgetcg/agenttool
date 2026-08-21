/** Real-PostgreSQL proof for the fresh payout admission wall.
 *
 * Opt in with an empty disposable database:
 *
 *   PAYOUT_ADMISSION_TEST_DATABASE_URL=postgres://... \
 *     bun test tests/integration/payout-admission-resting-postgres.test.ts
 *
 * The suite refuses a database where `economy` already exists, creates the
 * minimum current payout tables, applies the production durable-idempotency
 * migration, and drops only the schema it owns. Each HTTP request runs in a
 * fresh subprocess so the production route's singleton Drizzle client cannot
 * inherit another test's database connection.
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { fileURLToPath } from "node:url";
import type { Sql } from "postgres";
import postgres from "../fixtures/verified-postgres";

const TEST_DATABASE_URL =
  process.env.PAYOUT_ADMISSION_TEST_DATABASE_URL?.trim() ?? "";
const databaseTest = TEST_DATABASE_URL ? test : test.skip;

const PROJECT_ID = "00000000-0000-4000-8000-000000000410";
const WALLET_ID = "00000000-0000-4000-8000-000000000411";
const BASELINE_TRANSACTION_ID =
  "00000000-0000-4000-8000-000000000412";
const IDEMPOTENCY_KEY = "payout-postgres-resting-0001";
const STARTING_BALANCE = "424242";
const API_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PROBE_PATH = fileURLToPath(
  new URL(
    "../fixtures/payout-admission-postgres-probe.ts",
    import.meta.url,
  ),
);

let admin: Sql | undefined;
let ownsEconomySchema = false;

type ProbeOutcome = {
  status: number;
  idempotencySupported: string | null;
  body: {
    error?: string;
    payout_admission?: string;
    payout_worker_effective?: boolean;
    message?: string;
  };
};

type DurableState = {
  balance: string;
  reservations: number;
  payouts: number;
  payoutLedgerEntries: number;
  negativeLedgerEntries: number;
  ledger: Array<{
    id: string;
    type: string;
    amount: string;
    description: string | null;
    metadata: Record<string, unknown> | null;
  }>;
};

function requireAdmin(): Sql {
  if (!admin) {
    throw new Error("payout admission database is not initialized");
  }
  return admin;
}

async function readDurableState(): Promise<DurableState> {
  const sql = requireAdmin();
  const [summary] = await sql<Array<{
    balance: string;
    reservations: number;
    payouts: number;
    payout_ledger_entries: number;
    negative_ledger_entries: number;
  }>>`
    SELECT
      wallet.balance::text AS balance,
      (
        SELECT count(*)::int
        FROM economy.payout_request_idempotency
      ) AS reservations,
      (
        SELECT count(*)::int
        FROM economy.crypto_payouts
      ) AS payouts,
      (
        SELECT count(*)::int
        FROM economy.transactions
        WHERE type = 'payout'
      ) AS payout_ledger_entries,
      (
        SELECT count(*)::int
        FROM economy.transactions
        WHERE amount < 0
      ) AS negative_ledger_entries
    FROM economy.wallets AS wallet
    WHERE wallet.id = ${WALLET_ID}
  `;
  if (!summary) throw new Error("payout admission wallet fixture is missing");

  const ledger = await sql<Array<{
    id: string;
    type: string;
    amount: string;
    description: string | null;
    metadata: Record<string, unknown> | null;
  }>>`
    SELECT
      id,
      type,
      amount::text AS amount,
      description,
      metadata
    FROM economy.transactions
    ORDER BY id
  `;

  return {
    balance: summary.balance,
    reservations: summary.reservations,
    payouts: summary.payouts,
    payoutLedgerEntries: summary.payout_ledger_entries,
    negativeLedgerEntries: summary.negative_ledger_entries,
    ledger,
  };
}

async function postFreshPayout(): Promise<ProbeOutcome> {
  const child = Bun.spawn([process.execPath, PROBE_PATH], {
    cwd: API_ROOT,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      LANG: process.env.LANG,
      TZ: process.env.TZ,
      NODE_ENV: "test",
      PAYOUT_ADMISSION_TEST_DATABASE_URL: TEST_DATABASE_URL,
      PAYOUT_ADMISSION_TEST_PROJECT_ID: PROJECT_ID,
      PAYOUT_ADMISSION_TEST_WALLET_ID: WALLET_ID,
      PAYOUT_ADMISSION_TEST_IDEMPOTENCY_KEY: IDEMPOTENCY_KEY,
      AGENTTOOL_DISABLE_WORKERS: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).arrayBuffer();

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, 15_000);
  const exitCode = await child.exited;
  clearTimeout(timeout);

  const [raw] = await Promise.all([stdout, stderr]);
  if (timedOut) {
    throw new Error("payout admission HTTP probe timed out");
  }
  if (exitCode !== 0) {
    throw new Error(
      `payout admission HTTP probe exited non-zero (${exitCode})`,
    );
  }
  try {
    return JSON.parse(raw) as ProbeOutcome;
  } catch {
    throw new Error("payout admission HTTP probe returned invalid JSON");
  }
}

beforeAll(async () => {
  if (!TEST_DATABASE_URL) return;

  admin = postgres(TEST_DATABASE_URL, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    prepare: false,
    onnotice: () => {},
    connection: {
      application_name: "agenttool-payout-admission-resting-test",
    },
  });

  const [existing] = await admin<Array<{ economy_schema: string | null }>>`
    SELECT to_regnamespace('economy')::text AS economy_schema
  `;
  if (existing?.economy_schema) {
    throw new Error(
      "PAYOUT_ADMISSION_TEST_DATABASE_URL must name a disposable database without an economy schema",
    );
  }

  await admin.unsafe("CREATE SCHEMA economy");
  ownsEconomySchema = true;
  await admin.unsafe(`
    CREATE TABLE economy.wallets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL,
      name TEXT NOT NULL,
      agent_id TEXT,
      identity_id TEXT,
      balance BIGINT NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'GBP',
      status TEXT NOT NULL DEFAULT 'active',
      owner_type TEXT NOT NULL DEFAULT 'platform',
      agent_signing_pub_b64 TEXT,
      agent_wallet_index INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE economy.transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      wallet_id UUID NOT NULL REFERENCES economy.wallets(id),
      type TEXT NOT NULL,
      amount BIGINT NOT NULL,
      counterparty TEXT,
      description TEXT,
      escrow_id UUID,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE economy.crypto_payouts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      wallet_id UUID NOT NULL REFERENCES economy.wallets(id),
      project_id UUID NOT NULL,
      chain TEXT NOT NULL,
      network TEXT,
      token TEXT NOT NULL,
      amount_base NUMERIC(78, 0) NOT NULL,
      destination_address TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'requested',
      tx_hash TEXT,
      evm_chain_id NUMERIC(20, 0),
      evm_source_address TEXT,
      evm_nonce NUMERIC(20, 0),
      error TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      dispatch_after TIMESTAMPTZ,
      last_dispatch_attempt_at TIMESTAMPTZ,
      last_checked_at TIMESTAMPTZ,
      confirmed_at TIMESTAMPTZ
    );
  `);

  const migration = await Bun.file(
    new URL(
      "../../migrations/20260726T191500_payout_request_idempotency.sql",
      import.meta.url,
    ),
  ).text();
  await admin.unsafe(migration);
});

beforeEach(async () => {
  if (!admin) return;
  await admin.unsafe(`
    TRUNCATE TABLE
      economy.payout_request_idempotency,
      economy.crypto_payouts,
      economy.transactions,
      economy.wallets
    CASCADE;
  `);
  await admin`
    INSERT INTO economy.wallets (
      id,
      project_id,
      name,
      balance,
      currency,
      status,
      owner_type
    )
    VALUES (
      ${WALLET_ID},
      ${PROJECT_ID},
      'resting-proof',
      ${STARTING_BALANCE},
      'USDC',
      'active',
      'platform'
    )
  `;
  await admin`
    INSERT INTO economy.transactions (
      id,
      wallet_id,
      type,
      amount,
      description,
      metadata
    )
    VALUES (
      ${BASELINE_TRANSACTION_ID},
      ${WALLET_ID},
      'fund',
      ${STARTING_BALANCE},
      'baseline only',
      '{"fixture":true}'::jsonb
    )
  `;
});

afterAll(async () => {
  if (!admin) return;
  try {
    if (ownsEconomySchema) {
      await admin.unsafe("DROP SCHEMA IF EXISTS economy CASCADE");
    }
  } finally {
    await admin.end({ timeout: 5 });
  }
});

describe("fresh payout admission — real PostgreSQL rollback", () => {
  databaseTest(
    "rests twice with the same key and leaves no durable or economic residue",
    async () => {
      const baseline = await readDurableState();
      expect(baseline).toEqual({
        balance: STARTING_BALANCE,
        reservations: 0,
        payouts: 0,
        payoutLedgerEntries: 0,
        negativeLedgerEntries: 0,
        ledger: [
          {
            id: BASELINE_TRANSACTION_ID,
            type: "fund",
            amount: STARTING_BALANCE,
            description: "baseline only",
            metadata: { fixture: true },
          },
        ],
      });

      const first = await postFreshPayout();
      expect(first).toMatchObject({
        status: 503,
        idempotencySupported: "Idempotency-Key",
        body: {
          error: "payout_admission_resting",
          payout_admission: "resting",
          payout_worker_effective: false,
        },
      });
      expect(first.body.message).toMatch(
        /No durable reservation or debit was created/i,
      );
      expect(await readDurableState()).toEqual(baseline);

      const exactKeyRetry = await postFreshPayout();
      expect(exactKeyRetry).toMatchObject({
        status: 503,
        idempotencySupported: "Idempotency-Key",
        body: {
          error: "payout_admission_resting",
          payout_admission: "resting",
          payout_worker_effective: false,
        },
      });
      expect(exactKeyRetry.body.message).toMatch(
        /No durable reservation or debit was created/i,
      );
      expect(await readDurableState()).toEqual(baseline);
    },
    40_000,
  );
});
