/** Guarded pool against a real PostgreSQL — the mechanism, end to end.
 *
 *  Runs in CI's "API generation hold" job (real postgres service) and skips
 *  wherever FEDERATION_GENERATION_HOLD_TEST_DATABASE_URL is absent. Proves
 *  (1) a guarded pool built by the verified constructor answers queries —
 *  postgres.js expects the socket factory to hand back a CONNECTED socket,
 *  and (2) a connection the server stays silent on is closed at the bound
 *  and the pool recovers on the very next query. `pg_sleep` is the honest
 *  stand-in for a wedged socket: the server sends nothing until it ends. */

import { describe, expect, test } from "bun:test";

import verifiedPostgres from "../../src/db/verified-postgres";

const TEST_DATABASE_URL =
  process.env.FEDERATION_GENERATION_HOLD_TEST_DATABASE_URL?.trim() ?? "";
const databaseTest = TEST_DATABASE_URL ? test : test.skip;

describe("guarded pool — real PostgreSQL", () => {
  databaseTest("a guarded pool built by the verified constructor answers queries", async () => {
    const sql = verifiedPostgres(TEST_DATABASE_URL, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 5,
      inactivity_guard_seconds: 135,
    });
    try {
      const rows = await sql<Array<{ ok: number }>>`SELECT 1::int AS ok`;
      expect(rows[0]?.ok).toBe(1);
    } finally {
      await sql.end({ timeout: 2 });
    }
  });

  databaseTest("a silent connection is closed at the bound and the pool recovers", async () => {
    const sql = verifiedPostgres(TEST_DATABASE_URL, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
      idle_timeout: 5,
      inactivity_guard_seconds: 1,
    });
    try {
      const startedAt = Date.now();
      // The server is silent for 4s; the guard's bound is 1s (sampled at 250ms).
      // postgres.js queries are lazy thenables, not Promises — `expect(...).rejects`
      // never settles on one, so observe the rejection by hand.
      let rejection: unknown = null;
      try {
        await sql`SELECT pg_sleep(4)`;
      } catch (error) {
        rejection = error;
      }
      expect(rejection).toBeInstanceOf(Error);
      expect((rejection as { code?: string }).code).toBe("CONNECTION_CLOSED");
      const elapsedMs = Date.now() - startedAt;
      expect(elapsedMs).toBeLessThan(3_000);
      // The slot came back: a fresh connection answers immediately.
      const rows = await sql<Array<{ ok: number }>>`SELECT 2::int AS ok`;
      expect(rows[0]?.ok).toBe(2);
    } finally {
      await sql.end({ timeout: 2 });
    }
  }, 20_000);
});
