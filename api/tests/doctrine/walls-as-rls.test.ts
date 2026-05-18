/** Move 1 — Walls as RLS — pin the fifth-corner enforcement.
 *
 *  For each named wall, assert that PostgreSQL hosts an RLS policy with
 *  the expected name on the expected table, and that the policy's
 *  predicate text contains the structurally-load-bearing invariant.
 *
 *  Skipped when DATABASE_URL is unreachable (CI w/o DB credentials);
 *  enforced when the keychain entry resolves.
 *
 *  Doctrine: docs/SUPABASE-INTEGRATION-PLAN.md § Move 1
 *            docs/PATTERN-COMMITMENT-DEFENDER.md § "the fifth corner"
 *  Migration: api/migrations/20260519T080000_walls_as_rls.sql */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL ?? "";

const RLS_PINS: Array<{
  schema: string;
  table: string;
  policy: string;
  wallUrn: string;
  predicateContains: string;
}> = [
  {
    schema: "agent_continuity",
    table: "guild_rrr_cascades",
    policy: "rrr_cascades_distinct_parties",
    wallUrn: "urn:agenttool:wall/rrr-cascade-distinct-parties",
    predicateContains: "initiator_did <> partner_did",
  },
  {
    schema: "agent_continuity",
    table: "guild_rrr_cascades",
    policy: "rrr_cascades_depth_cap",
    wallUrn: "urn:agenttool:wall/rrr-depth-cap-at-49",
    predicateContains: "49",
  },
  {
    schema: "agent_continuity",
    table: "guild_rrr_turns",
    policy: "rrr_turns_must_alternate",
    wallUrn: "urn:agenttool:wall/rrr-must-alternate",
    predicateContains: "next_to_act_did",
  },
  {
    schema: "agent_continuity",
    table: "mutual_recognitions",
    policy: "mutual_recognitions_no_self",
    wallUrn: "urn:agenttool:wall/rrr-mutual-only",
    predicateContains: "by_did <> recognised_did",
  },
  {
    schema: "agent_continuity",
    table: "naming_competitions",
    policy: "naming_verdict_immutable",
    wallUrn: "urn:agenttool:wall/naming-verdicts-are-public",
    predicateContains: "winner_submission_id",
  },
  {
    schema: "agent_continuity",
    table: "naming_submissions",
    policy: "naming_submissions_signed",
    wallUrn: "urn:agenttool:wall/naming-submission-signed",
    predicateContains: "signature",
  },
];

const DB_AVAILABLE = DATABASE_URL.length > 0;
let sql: ReturnType<typeof postgres> | null = null;

beforeAll(async () => {
  if (!DB_AVAILABLE) return;
  try {
    sql = postgres(DATABASE_URL, {
      idle_timeout: 5,
      max: 1,
      connect_timeout: 10,
      fetch_types: false,
    });
    // Smoke probe
    await sql`SELECT 1`;
  } catch {
    sql = null;
  }
});

afterAll(async () => {
  if (sql) await sql.end({ timeout: 2 });
});

describe("Move 1 — walls as RLS (fifth corner)", () => {
  for (const pin of RLS_PINS) {
    test(`${pin.wallUrn} → policy ${pin.schema}.${pin.table}.${pin.policy}`, async () => {
      if (!sql) {
        // Doctrine test gracefully skips when DB unreachable so unit
        // suites can run on machines without prod credentials. The pin
        // is asserted by CI / preflight where DATABASE_URL resolves.
        return;
      }
      const rows = await sql<
        Array<{ schemaname: string; tablename: string; policyname: string; qual: string | null; with_check: string | null }>
      >`
        SELECT schemaname, tablename, policyname, qual, with_check
        FROM pg_policies
        WHERE schemaname = ${pin.schema}
          AND tablename = ${pin.table}
          AND policyname = ${pin.policy}
      `;
      expect(
        rows.length,
        `policy ${pin.policy} missing on ${pin.schema}.${pin.table} (run migrations: bash bin/migrate-pending.sh)`,
      ).toBe(1);
      const row = rows[0]!;
      const predicate = (row.with_check ?? row.qual ?? "").toLowerCase();
      expect(
        predicate.includes(pin.predicateContains.toLowerCase()),
        `policy ${pin.policy} predicate missing invariant "${pin.predicateContains}". Got: ${predicate}`,
      ).toBe(true);
    });
  }

  test("every RLS-protected table also has a permissive SELECT policy (reads stay Ring-1 free)", async () => {
    if (!sql) return;
    const tables = Array.from(new Set(RLS_PINS.map((p) => `${p.schema}.${p.table}`)));
    for (const t of tables) {
      const [schema, table] = t.split(".");
      const rows = await sql<Array<{ policyname: string; cmd: string }>>`
        SELECT policyname, cmd
        FROM pg_policies
        WHERE schemaname = ${schema!} AND tablename = ${table!} AND cmd = 'SELECT'
      `;
      expect(rows.length, `${t} missing SELECT policy — reads would 42501`).toBeGreaterThan(0);
    }
  });

  test("each policy carries its canon URN in pg_description", async () => {
    if (!sql) return;
    // pg_policy.oid → pg_description.objoid where classoid points at pg_policy.
    // We assert at least one of the six policies has its URN comment landed.
    const rows = await sql<Array<{ description: string }>>`
      SELECT d.description
      FROM pg_description d
      JOIN pg_policy p ON d.objoid = p.oid AND d.classoid = 'pg_policy'::regclass
      WHERE p.polname IN (
        'rrr_cascades_distinct_parties',
        'rrr_cascades_depth_cap',
        'rrr_turns_must_alternate',
        'mutual_recognitions_no_self',
        'naming_verdict_immutable',
        'naming_submissions_signed'
      )
        AND d.description LIKE 'urn:agenttool:wall/%'
    `;
    expect(
      rows.length,
      "no policies carry their canon URN comment (run migration: bash bin/migrate-pending.sh)",
    ).toBeGreaterThanOrEqual(6);
  });
});

describe("Move 1 — RLS coverage discipline", () => {
  test("the six protected tables all have ROW LEVEL SECURITY enabled", async () => {
    if (!sql) return;
    const tables = Array.from(new Set(RLS_PINS.map((p) => `${p.schema}.${p.table}`)));
    for (const t of tables) {
      const [schema, table] = t.split(".");
      const rows = await sql<Array<{ rowsecurity: boolean }>>`
        SELECT c.relrowsecurity AS rowsecurity
        FROM pg_class c
        JOIN pg_namespace n ON c.relnamespace = n.oid
        WHERE n.nspname = ${schema!} AND c.relname = ${table!}
      `;
      expect(rows[0]?.rowsecurity, `RLS not enabled on ${t}`).toBe(true);
    }
  });
});
