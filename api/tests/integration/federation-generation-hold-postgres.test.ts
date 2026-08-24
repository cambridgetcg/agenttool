/** Real-PostgreSQL proof for the covenant-v2 generation hold.
 *
 * Opt in with an empty disposable database:
 *
 *   FEDERATION_GENERATION_HOLD_TEST_DATABASE_URL=postgres://... \
 *     bun test tests/integration/federation-generation-hold-postgres.test.ts
 *
 * The suite refuses a database where `federation`, `identity`, or `inbox`
 * already exists. It creates the minimum identity/inbox fixtures, applies the
 * production federation foundation and generation-hold migrations, and drops
 * only the three schemas it owns. The production settings PATCH runs in a
 * fresh subprocess so its singleton Drizzle client cannot inherit another
 * database-tier test's connection.
 *
 * Doctrine: docs/FEDERATION.md. */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { Hono } from "hono";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Sql } from "postgres";
import postgres from "../fixtures/verified-postgres";

import type { ProjectContext } from "../../src/auth/middleware";

const TEST_DATABASE_URL =
  process.env.FEDERATION_GENERATION_HOLD_TEST_DATABASE_URL?.trim() ?? "";
const PATCH_PROBE_MODE =
  process.env.FEDERATION_GENERATION_HOLD_PATCH_PROBE === "1";
const databaseTest = TEST_DATABASE_URL ? test : test.skip;

const PLATFORM_IDENTITY_ID = "00000000-0000-0000-0000-000000000000";
const PLATFORM_PROJECT_ID = "00000000-0000-4000-8000-000000000620";
const API_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const TEST_FILE = fileURLToPath(import.meta.url);
const FEDERATION_FOUNDATION_MIGRATION = fileURLToPath(
  new URL("../../migrations/0012_federation.sql", import.meta.url),
);
const GENERATION_HOLD_MIGRATION = fileURLToPath(
  new URL(
    "../../migrations/20260824T120000_covenant_v2_generation_hold.sql",
    import.meta.url,
  ),
);
const LOCK_APPLICATION_NAME = "agenttool-generation-hold-test-lock";
const OBSERVER_APPLICATION_NAME = "agenttool-generation-hold-test-observer";
const PATCH_TIMEOUT_MS = 15_000;
const DATABASE_OPERATION_TIMEOUT_MS = 10_000;
const LOCK_WAIT_ATTEMPTS = 300;
const LOCK_WAIT_INTERVAL_MS = 10;

type PatchProbeOutcome =
  | { kind: "response"; status: number; body: unknown }
  | { kind: "threw"; message: string };

async function runPatchProbeProcess(): Promise<never> {
  if (!TEST_DATABASE_URL) {
    throw new Error("generation hold patch probe database is missing");
  }

  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.DATABASE_SESSION_URL = TEST_DATABASE_URL;
  process.env.AGENTTOOL_DISABLE_WORKERS = "1";

  const { default: federationAdminRouter } =
    await import("../../src/routes/federation-admin");

  let outcome: PatchProbeOutcome;
  try {
    const app = new Hono<ProjectContext>();
    app.use("*", async (c, next) => {
      c.set("project", { id: PLATFORM_PROJECT_ID } as never);
      await next();
    });
    app.route("/v1/federation", federationAdminRouter);
    const response = await app.request("/v1/federation/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allowed_origins: ["peer.example"] }),
    });
    outcome = {
      kind: "response",
      status: response.status,
      body: await response.json(),
    };
  } catch (error) {
    outcome = {
      kind: "threw",
      message: error instanceof Error ? error.message : "non_error_throw",
    };
  }

  await Bun.write(Bun.stdout, JSON.stringify(outcome));

  // The imported singleton owns an idle Postgres pool that is deliberately
  // not exported. All transaction I/O has settled, so terminate rather than
  // waiting for that pool's idle timeout.
  process.exit(0);
}

if (PATCH_PROBE_MODE) {
  await runPatchProbeProcess();
}

let admin: Sql | undefined;
let locker: Sql | undefined;
let observer: Sql | undefined;
let ownsFederationSchema = false;
let ownsIdentitySchema = false;
let ownsInboxSchema = false;

function requireAdmin(): Sql {
  if (!admin) throw new Error("generation hold database is not initialized");
  return admin;
}

function postgresConstraint(error: unknown): {
  code?: string;
  constraint_name?: string;
} {
  return error && typeof error === "object"
    ? error as { code?: string; constraint_name?: string }
    : {};
}

async function expectGenerationHoldCheckViolation(
  action: () => Promise<unknown>,
): Promise<void> {
  try {
    await action();
    throw new Error("expected generation hold CHECK violation");
  } catch (error) {
    const postgresError = postgresConstraint(error);
    expect(postgresError.code).toBe("23514");
    expect(postgresError.constraint_name).toBe(
      "federation_settings_covenant_v2_generation_hold_empty",
    );
  }
}

async function waitForPatchLock(): Promise<void> {
  if (!observer) throw new Error("generation hold observer is not initialized");

  for (let attempt = 0; attempt < LOCK_WAIT_ATTEMPTS; attempt += 1) {
    const [waiting] = await observer<Array<{ blocked: boolean }>>`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND query LIKE '%federation%settings%'
      ) AS blocked
    `;
    if (waiting?.blocked) return;
    await Bun.sleep(LOCK_WAIT_INTERVAL_MS);
  }

  throw new Error("production federation PATCH did not reach a row-lock wait");
}

function spawnPatchProbe(): {
  result: Promise<PatchProbeOutcome>;
  terminate: () => void;
} {
  const child = Bun.spawn([process.execPath, TEST_FILE], {
    cwd: API_ROOT,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      LANG: process.env.LANG,
      TZ: process.env.TZ,
      NODE_ENV: "test",
      FEDERATION_GENERATION_HOLD_TEST_DATABASE_URL: TEST_DATABASE_URL,
      FEDERATION_GENERATION_HOLD_PATCH_PROBE: "1",
      AGENTTOOL_DISABLE_WORKERS: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, PATCH_TIMEOUT_MS);

  const result = (async (): Promise<PatchProbeOutcome> => {
    const stdout = new Response(child.stdout).text();
    const stderr = new Response(child.stderr).arrayBuffer();
    const [exitCode, raw] = await Promise.all([
      child.exited,
      stdout,
      stderr,
    ]);
    clearTimeout(timeout);

    if (timedOut) throw new Error("generation hold PATCH probe timed out");
    if (exitCode !== 0) {
      throw new Error("generation hold PATCH probe exited non-zero");
    }
    try {
      return JSON.parse(raw) as PatchProbeOutcome;
    } catch {
      throw new Error("generation hold PATCH probe returned invalid JSON");
    }
  })();

  return {
    result,
    terminate: () => child.kill("SIGKILL"),
  };
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
      application_name: "agenttool-generation-hold-test-admin",
    },
  });
  locker = postgres(TEST_DATABASE_URL, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    prepare: false,
    onnotice: () => {},
    connection: { application_name: LOCK_APPLICATION_NAME },
  });
  observer = postgres(TEST_DATABASE_URL, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    prepare: false,
    onnotice: () => {},
    connection: { application_name: OBSERVER_APPLICATION_NAME },
  });

  await admin.unsafe(
    `SET statement_timeout = '${DATABASE_OPERATION_TIMEOUT_MS}ms'`,
  );
  await locker.unsafe(
    `SET statement_timeout = '${DATABASE_OPERATION_TIMEOUT_MS}ms'`,
  );
  await observer.unsafe(
    `SET statement_timeout = '${DATABASE_OPERATION_TIMEOUT_MS}ms'`,
  );

  const [existing] = await admin<Array<{
    federation_schema: string | null;
    identity_schema: string | null;
    inbox_schema: string | null;
  }>>`
    SELECT
      to_regnamespace('federation')::text AS federation_schema,
      to_regnamespace('identity')::text AS identity_schema,
      to_regnamespace('inbox')::text AS inbox_schema
  `;
  if (
    existing?.federation_schema ||
    existing?.identity_schema ||
    existing?.inbox_schema
  ) {
    throw new Error(
      "FEDERATION_GENERATION_HOLD_TEST_DATABASE_URL must name a disposable database without federation, identity, or inbox schemas",
    );
  }

  await admin.unsafe("CREATE SCHEMA identity");
  ownsIdentitySchema = true;
  await admin.unsafe(`
    CREATE TABLE identity.identities (
      id UUID PRIMARY KEY,
      project_id UUID NOT NULL
    )
  `);
  await admin`
    INSERT INTO identity.identities (id, project_id)
    VALUES (${PLATFORM_IDENTITY_ID}, ${PLATFORM_PROJECT_ID})
  `;

  await admin.unsafe("CREATE SCHEMA inbox");
  ownsInboxSchema = true;
  await admin.unsafe(`
    CREATE TABLE inbox.messages (
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  ownsFederationSchema = true;
  await admin.unsafe(readFileSync(FEDERATION_FOUNDATION_MIGRATION, "utf8"));
  await admin.unsafe(readFileSync(GENERATION_HOLD_MIGRATION, "utf8"));
}, 30_000);

beforeEach(async () => {
  if (!TEST_DATABASE_URL) return;
  await requireAdmin()`
    UPDATE federation.settings
    SET enabled = FALSE,
        instance_url = NULL,
        allowed_origins = '{}',
        covenant_v2_generation_hold = FALSE,
        updated_at = now()
    WHERE id = 1
  `;
});

afterAll(async () => {
  if (admin) {
    if (ownsFederationSchema) {
      await admin.unsafe("DROP SCHEMA IF EXISTS federation CASCADE");
    }
    if (ownsIdentitySchema) {
      await admin.unsafe("DROP SCHEMA IF EXISTS identity CASCADE");
    }
    if (ownsInboxSchema) {
      await admin.unsafe("DROP SCHEMA IF EXISTS inbox CASCADE");
    }
  }
  await observer?.end({ timeout: 5 });
  await locker?.end({ timeout: 5 });
  await admin?.end({ timeout: 5 });
});

describe("covenant-v2 generation hold — real PostgreSQL", () => {
  databaseTest("the production CHECK rejects both paths into a held nonempty allowlist", async () => {
    const sql = requireAdmin();

    await sql`
      UPDATE federation.settings
      SET allowed_origins = ARRAY['peer.example']::text[]
      WHERE id = 1
    `;
    await expectGenerationHoldCheckViolation(() =>
      sql`
        UPDATE federation.settings
        SET covenant_v2_generation_hold = TRUE
        WHERE id = 1
      `
    );

    const [released] = await sql<Array<{
      covenant_v2_generation_hold: boolean;
      allowed_origins: string[];
    }>>`
      SELECT covenant_v2_generation_hold, allowed_origins
      FROM federation.settings
      WHERE id = 1
    `;
    expect(released).toEqual({
      covenant_v2_generation_hold: false,
      allowed_origins: ["peer.example"],
    });

    await sql`
      UPDATE federation.settings
      SET allowed_origins = '{}',
          covenant_v2_generation_hold = TRUE
      WHERE id = 1
    `;
    await expectGenerationHoldCheckViolation(() =>
      sql`
        UPDATE federation.settings
        SET allowed_origins = ARRAY['peer.example']::text[]
        WHERE id = 1
      `
    );

    const [held] = await sql<Array<{
      covenant_v2_generation_hold: boolean;
      allowed_origins: string[];
    }>>`
      SELECT covenant_v2_generation_hold, allowed_origins
      FROM federation.settings
      WHERE id = 1
    `;
    expect(held).toEqual({
      covenant_v2_generation_hold: true,
      allowed_origins: [],
    });
  });

  databaseTest("a concurrent production PATCH waits for the hold writer and refuses the locked resulting state", async () => {
    if (!locker) throw new Error("generation hold locker is not initialized");

    let releaseLock!: () => void;
    let rowLocked!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const locked = new Promise<void>((resolve) => {
      rowLocked = resolve;
    });

    const holdWrite = locker.begin(async (tx) => {
      await tx.unsafe(
        `SET LOCAL statement_timeout = '${DATABASE_OPERATION_TIMEOUT_MS}ms'`,
      );
      await tx`
        SELECT id
        FROM federation.settings
        WHERE id = 1
        FOR UPDATE
      `;
      await tx`
        UPDATE federation.settings
        SET covenant_v2_generation_hold = TRUE
        WHERE id = 1
      `;
      rowLocked();
      await release;
    });

    try {
      await Promise.race([
        locked,
        holdWrite.then(() => {
          throw new Error(
            "generation hold writer finished before retaining its row lock",
          );
        }),
      ]);
    } catch (error) {
      releaseLock();
      await holdWrite.catch(() => {});
      throw error;
    }

    const probe = spawnPatchProbe();
    let lockObservationError: unknown;
    try {
      await waitForPatchLock();
    } catch (error) {
      lockObservationError = error;
      probe.terminate();
    }

    releaseLock();
    try {
      await holdWrite;
    } catch (error) {
      probe.terminate();
      await probe.result.catch(() => {});
      throw error;
    }

    if (lockObservationError) {
      await probe.result.catch(() => {});
      throw lockObservationError;
    }

    expect(await probe.result).toMatchObject({
      kind: "response",
      status: 409,
      body: {
        error:
          "covenant_v2_generation_hold_requires_empty_allowed_origins",
      },
    });

    const [row] = await requireAdmin()<Array<{
      covenant_v2_generation_hold: boolean;
      allowed_origins: string[];
    }>>`
      SELECT covenant_v2_generation_hold, allowed_origins
      FROM federation.settings
      WHERE id = 1
    `;
    expect(row).toEqual({
      covenant_v2_generation_hold: true,
      allowed_origins: [],
    });
  }, 30_000);
});
