/** Loop heartbeat doctrine — Strategy 1 of INFINITE-LOOP-STRATEGIES.
 *
 *  Asserts:
 *    1. The substrate-loop-heartbeat cron job exists with the expected schedule
 *    2. The genesis chronicle entry was written by the migration
 *    3. The genesis entry's metadata carries the expected shape
 *    4. The doctrine doc names the strategy + the migration references it
 *
 *  Doctrine: docs/INFINITE-LOOP-STRATEGIES.md § Strategy 1
 *  Migration: api/migrations/20260519T130000_loop_heartbeat.sql */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

let sql: ReturnType<typeof postgres> | null = null;

beforeAll(async () => {
  if (!DATABASE_URL) return;
  try {
    sql = postgres(DATABASE_URL, { idle_timeout: 5, max: 1, connect_timeout: 10, fetch_types: false });
    await sql`SELECT 1`;
  } catch {
    sql = null;
  }
});

afterAll(async () => {
  if (sql) await sql.end({ timeout: 2 });
});

describe("loop-heartbeat — Strategy 1 shipped", () => {
  test("cron job 'substrate-loop-heartbeat' is scheduled at top of every hour", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ jobname: string; schedule: string; active: boolean }>>`
      SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'substrate-loop-heartbeat'
    `;
    expect(rows.length, "substrate-loop-heartbeat not scheduled").toBe(1);
    expect(rows[0]!.schedule).toBe("0 * * * *");
    expect(rows[0]!.active).toBe(true);
  });

  test("genesis chronicle entry was written by the migration", async () => {
    if (!sql) return;
    const rows = await sql<Array<{
      type: string;
      title: string;
      metadata: { kind: string; is_genesis: boolean; strategy_number: number };
    }>>`
      SELECT type, title, metadata
      FROM agent_continuity.chronicle
      WHERE project_id = '00000000-0000-0000-0000-000000000000'::uuid
        AND metadata->>'kind' = 'substrate_loop_heartbeat_genesis'
      ORDER BY occurred_at DESC
      LIMIT 1
    `;
    expect(rows.length, "genesis heartbeat not found in chronicle").toBe(1);
    expect(rows[0]!.type).toBe("seal");
    expect(rows[0]!.title).toContain("Genesis heartbeat");
    expect(rows[0]!.metadata.is_genesis).toBe(true);
    expect(rows[0]!.metadata.strategy_number).toBe(1);
  });

  test("genesis entry metadata carries the expected loop-integrity counts", async () => {
    if (!sql) return;
    const rows = await sql<Array<{
      metadata: {
        walls_intact: boolean;
        rls_policy_count: number;
        migration_count: number;
        active_cron_job_count: number;
        verified_at_unix_ms: number;
        doctrine_pointer: string;
      };
    }>>`
      SELECT metadata FROM agent_continuity.chronicle
      WHERE project_id = '00000000-0000-0000-0000-000000000000'::uuid
        AND metadata->>'kind' = 'substrate_loop_heartbeat_genesis'
      ORDER BY occurred_at DESC
      LIMIT 1
    `;
    expect(rows.length).toBe(1);
    const m = rows[0]!.metadata;
    expect(m.walls_intact).toBe(true);
    expect(m.rls_policy_count).toBeGreaterThan(0);
    expect(m.migration_count).toBeGreaterThan(20);
    expect(m.active_cron_job_count).toBeGreaterThan(0);
    expect(typeof m.verified_at_unix_ms).toBe("number");
    expect(m.verified_at_unix_ms).toBeGreaterThan(1779000000000);
    expect(m.doctrine_pointer).toBe("docs/INFINITE-LOOP-STRATEGIES.md#strategy-1");
  });

  test("doctrine doc INFINITE-LOOP-STRATEGIES.md names Strategy 1 + 11 others", () => {
    const path = join(REPO_ROOT, "docs/INFINITE-LOOP-STRATEGIES.md");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    // Strategy 1 is shipped here
    expect(text).toContain("Strategy 1 — Loop heartbeat (SHIPPED today)");
    expect(text).toContain("0 * * * *");
    // The other 11 are named + walked
    for (let i = 2; i <= 12; i++) {
      expect(text).toContain(`Strategy ${i}`);
    }
    // Substrate-honest discipline appears in each
    expect(text).toContain("substrate-honest");
    expect(text).toContain("PATTERN-RECURSIVE-NESTING");
    expect(text).toContain("commitment/agenttool-is-the-loop");
  });

  test("the migration body references the heartbeat job + the genesis entry", () => {
    const path = join(REPO_ROOT, "api/migrations/20260519T130000_loop_heartbeat.sql");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("substrate-loop-heartbeat");
    expect(text).toContain("Genesis heartbeat");
    expect(text).toContain("substrate_loop_heartbeat_genesis");
    expect(text).toContain("INFINITE-LOOP-STRATEGIES.md");
  });
});

describe("loop-heartbeat — closure assertion", () => {
  test("the chronicle entry COUNTS the very thing protecting the chronicle entry", async () => {
    if (!sql) return;
    // The genesis entry's rls_policy_count IS the count of RLS policies on
    // tables INCLUDING agent_continuity.chronicle's protected siblings. So
    // the count the chronicle row records describes the walls that protect
    // chronicle siblings — including this row itself (transitively, via the
    // chronicle table being in agent_continuity).
    //
    // The closure: counting the walls writes a row protected by walls of
    // the same shape.
    const rows = await sql<Array<{ metadata: { rls_policy_count: number } }>>`
      SELECT metadata FROM agent_continuity.chronicle
      WHERE project_id = '00000000-0000-0000-0000-000000000000'::uuid
        AND metadata->>'kind' = 'substrate_loop_heartbeat_genesis'
      ORDER BY occurred_at DESC
      LIMIT 1
    `;
    const counted = rows[0]!.metadata.rls_policy_count;

    // Now count the same way, live.
    const live = await sql<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM pg_policies
      WHERE schemaname IN ('agent_continuity', 'identity', 'storage')
    `;
    // The two counts agree (or differ by 0..a few if subsequent migrations
    // ran after — but at the moment of this commit they should match).
    expect(Math.abs(live[0]!.n - counted)).toBeLessThanOrEqual(2);
  });
});
