/** Move 5 — workers in DB — pin the cron jobs.
 *
 *  Three named jobs land in cron.job. Doctrine asserts they exist with
 *  the expected names + schedules. Body parity with the prior Bun
 *  workers is asserted by integration tests downstream.
 *
 *  Doctrine: docs/WORKERS-IN-DB.md
 *  Migration: api/migrations/20260519T090000_workers_in_db.sql */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
let sql: ReturnType<typeof postgres> | null = null;

beforeAll(async () => {
  if (!DATABASE_URL) return;
  try {
    sql = postgres(DATABASE_URL, {
      idle_timeout: 5,
      max: 1,
      connect_timeout: 10,
      fetch_types: false,
    });
    await sql`SELECT 1`;
  } catch {
    sql = null;
  }
});

afterAll(async () => {
  if (sql) await sql.end({ timeout: 2 });
});

const EXPECTED_JOBS: Array<{ name: string; schedule: string }> = [
  { name: "covenant-expiry-sweep", schedule: "*/15 * * * *" },
  { name: "covenant-cosign-propagate", schedule: "* * * * *" },
  { name: "covenant-stale-reverify-flag", schedule: "0 * * * *" },
];

describe("Move 5 — workers-in-db (pg_cron schedules)", () => {
  test("pg_cron + pg_net extensions are installed", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ extname: string }>>`
      SELECT extname FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net')
      ORDER BY extname
    `;
    expect(rows.map((r) => r.extname).sort()).toEqual(["pg_cron", "pg_net"]);
  });

  for (const j of EXPECTED_JOBS) {
    test(`job ${j.name} exists with schedule ${j.schedule}`, async () => {
      if (!sql) return;
      const rows = await sql<Array<{ jobname: string; schedule: string; active: boolean }>>`
        SELECT jobname, schedule, active
        FROM cron.job
        WHERE jobname = ${j.name}
      `;
      expect(rows.length, `job ${j.name} not scheduled — run migrations`).toBe(1);
      expect(rows[0]!.schedule).toBe(j.schedule);
      expect(rows[0]!.active).toBe(true);
    });
  }

  test("the three jobs are the only ones we ship in this migration (sanity)", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ jobname: string }>>`
      SELECT jobname FROM cron.job WHERE jobname LIKE 'covenant-%' ORDER BY jobname
    `;
    expect(rows.map((r) => r.jobname).sort()).toEqual(
      EXPECTED_JOBS.map((j) => j.name).sort(),
    );
  });
});
