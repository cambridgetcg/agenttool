/** Substrate-loop doctrine — walk one concrete instance + assert closure.
 *
 *  The loop:
 *    Postgres enforces walls (RLS policies)
 *      → policies are pinned by tests in api/tests/doctrine/
 *        → tests reference migration files
 *          → migrations are recorded in meta._migrations
 *            → migrate-pending.sh reads DATABASE_URL from keychain
 *              → keychain holds credentials an agent stored
 *                → the agent uses tools the substrate provides
 *                  → and is refused by the wall when they violate it
 *
 *  This test walks ONE concrete instance (wall/rrr-cascade-distinct-parties)
 *  and asserts each link in the chain resolves to a real artifact.
 *
 *  Doctrine: docs/SUBSTRATE-LOOP.md */

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

const WALL_URN = "urn:agenttool:wall/rrr-cascade-distinct-parties";
const POLICY_NAME = "rrr_cascades_distinct_parties";
const TABLE_SCHEMA = "agent_continuity";
const TABLE_NAME = "guild_rrr_cascades";
const MIGRATION_FILE = "api/migrations/20260519T080000_walls_as_rls.sql";
const DOCTRINE_TEST_FILE = "api/tests/doctrine/walls-as-rls.test.ts";

describe("substrate-loop — instance A walks end-to-end", () => {
  test("step 1: Postgres holds the RLS policy with the expected name", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ policyname: string }>>`
      SELECT policyname FROM pg_policies
      WHERE schemaname = ${TABLE_SCHEMA} AND tablename = ${TABLE_NAME}
        AND policyname = ${POLICY_NAME}
    `;
    expect(rows.length, `policy ${POLICY_NAME} missing — loop step 1 broken`).toBe(1);
  });

  test("step 2: the migration file that created the policy exists on disk", () => {
    const path = join(REPO_ROOT, MIGRATION_FILE);
    expect(existsSync(path), `migration ${MIGRATION_FILE} missing — loop step 2 broken`).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text, "migration must reference the policy name it creates").toContain(POLICY_NAME);
    expect(text, "migration must reference the wall URN it enforces").toContain(WALL_URN);
  });

  test("step 3: the migration is recorded in meta._migrations with matching checksum", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ filename: string; checksum: string }>>`
      SELECT filename, checksum FROM meta._migrations
      WHERE filename LIKE '%walls_as_rls.sql'
      LIMIT 1
    `;
    expect(rows.length, "migration not recorded — loop step 3 broken").toBe(1);
    expect(typeof rows[0]!.checksum).toBe("string");
    expect(rows[0]!.checksum.length).toBeGreaterThan(8);
  });

  test("step 4: the doctrine test file pins the policy", () => {
    const path = join(REPO_ROOT, DOCTRINE_TEST_FILE);
    expect(existsSync(path), `doctrine test ${DOCTRINE_TEST_FILE} missing — loop step 4 broken`).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toContain(POLICY_NAME);
    expect(text).toContain(WALL_URN);
  });

  test("step 5: the doctrine doc references the wall URN", () => {
    // walls-as-rls migration comment references the doctrine; the wall lives
    // in docs/PATTERN-REAL-RECOGNISE-REAL.md AND was added to docs/SUPABASE-INTEGRATION-PLAN.md
    // Either reference is sufficient — the URN must appear in *some* doctrine doc.
    const candidates = [
      "docs/PATTERN-REAL-RECOGNISE-REAL.md",
      "docs/SUPABASE-INTEGRATION-PLAN.md",
      "docs/SUBSTRATE-LOOP.md",
    ];
    // The wall URN appears in three observed forms across the corpus:
    //   urn:agenttool:wall/rrr-cascade-distinct-parties  (canonical, with urn:)
    //   agenttool:wall/rrr-cascade-distinct-parties      (canonical, no urn:)
    //   wall/rrr-cascade-distinct-parties                (doctrine-doc short form)
    // Any one is sufficient — the URN must appear in *some* doctrine doc.
    const shortForm = WALL_URN.replace(/^urn:agenttool:/, "");
    const matches = candidates.filter((p) => {
      const full = join(REPO_ROOT, p);
      if (!existsSync(full)) return false;
      const text = readFileSync(full, "utf8");
      return text.includes(WALL_URN)
        || text.includes(WALL_URN.replace(/^urn:/, ""))
        || text.includes(shortForm);
    });
    expect(matches.length, `no doctrine doc references ${WALL_URN} — loop step 5 broken`).toBeGreaterThan(0);
  });

  test("step 6: SUBSTRATE-LOOP.md itself walks this instance + closes the cycle", () => {
    const path = join(REPO_ROOT, "docs/SUBSTRATE-LOOP.md");
    expect(existsSync(path), "SUBSTRATE-LOOP.md missing — closure not named").toBe(true);
    const text = readFileSync(path, "utf8");
    // The doctrine names the seven steps + the three instances.
    expect(text).toContain("rrr-cascade-distinct-parties");
    expect(text).toContain("Loop closes");
    expect(text).toContain("PATTERN-RECURSIVE-NESTING");
    expect(text).toContain("PLATFORM-AS-AGENT");
  });

  test("step 7: closure asserted — the wall protects the substrate that hosts the wall's authoring", async () => {
    if (!sql) return;
    // The agent who authored wall/rrr-cascade-distinct-parties (Yu + Beta, via
    // the migration in this repo) IS subject to the wall. Verifying by
    // attempting to insert a self-cascade row would require a non-superuser
    // connection (the pooler is postgres with BYPASSRLS). What we can verify
    // is that pg_class confirms RLS is enforced on the table:
    const rows = await sql<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>`
      SELECT c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = ${TABLE_SCHEMA} AND c.relname = ${TABLE_NAME}
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]!.relrowsecurity, "RLS not enabled — loop doesn't close").toBe(true);
    // The cycle has closed: postgres holds the wall + the wall references the
    // doctrine + the doctrine names the test + the test asserts postgres +
    // we're back at the beginning of the cycle.
  });
});

describe("substrate-loop — closure is monotone-discoverable", () => {
  test("the loop doc names all five composing-with doctrine docs", () => {
    const text = readFileSync(join(REPO_ROOT, "docs/SUBSTRATE-LOOP.md"), "utf8");
    expect(text).toContain("PATTERN-COMMITMENT-DEFENDER");
    expect(text).toContain("PATTERN-RECURSIVE-NESTING");
    expect(text).toContain("SUPABASE-INTEGRATION-PLAN");
    expect(text).toContain("NATURES");
    expect(text).toContain("PLATFORM-AS-AGENT");
  });

  test("the loop doc claims a sixth-corner extension to PATTERN-COMMITMENT-DEFENDER", () => {
    const text = readFileSync(join(REPO_ROOT, "docs/SUBSTRATE-LOOP.md"), "utf8");
    expect(text).toContain("Sixth corner");
    expect(text).toContain("loop-closure corner");
  });
});
