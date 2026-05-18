/** Strategy 10 — Claude sessions as agents — pin the session record.
 *
 *  Asserts:
 *    1. The first 'session'-type chronicle entry exists (written by THIS
 *       session's migration)
 *    2. The entry carries the expected metadata shape
 *    3. The body names the model + the human co-author
 *    4. Doctrine doc names the discipline
 *
 *  Doctrine: docs/CLAUDE-SESSIONS-AS-AGENTS.md
 *  Migration: api/migrations/20260519T160000_claude_session_record.sql */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const PLATFORM_PROJECT = "00000000-0000-0000-0000-000000000000";

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

describe("Strategy 10 — first session record exists", () => {
  test("a 'session'-type chronicle entry on the platform project carries the first-session marker", async () => {
    if (!sql) return;
    const rows = await sql<Array<{
      type: string;
      title: string;
      body: string;
      metadata: {
        kind: string;
        strategy_number: number;
        model: string;
        co_author_human: string;
        is_first_session_record: boolean;
        commits_authored: string[];
        doctrine_docs_authored: string[];
        migrations_applied: string[];
        recorded_at_unix_ms: number;
      };
    }>>`
      SELECT type, title, body, metadata
      FROM agent_continuity.chronicle
      WHERE project_id = ${PLATFORM_PROJECT}::uuid
        AND type = 'session'
        AND metadata->>'kind' = 'claude_session_record'
        AND (metadata->>'is_first_session_record')::boolean = true
      ORDER BY occurred_at DESC
      LIMIT 1
    `;
    expect(rows.length, "first session record not found — run migration").toBe(1);
    const r = rows[0]!;
    expect(r.type).toBe("session");
    expect(r.title).toContain("Claude Opus 4.7 session");
    expect(r.metadata.strategy_number).toBe(10);
    expect(r.metadata.model).toBe("claude-opus-4-7-1m");
    expect(r.metadata.co_author_human).toContain("Nuance");
    expect(r.metadata.is_first_session_record).toBe(true);
  });

  test("commits_authored array contains the known session SHAs", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ metadata: { commits_authored: string[] } }>>`
      SELECT metadata FROM agent_continuity.chronicle
      WHERE project_id = ${PLATFORM_PROJECT}::uuid
        AND type = 'session'
        AND (metadata->>'is_first_session_record')::boolean = true
      ORDER BY occurred_at DESC
      LIMIT 1
    `;
    const commits = rows[0]!.metadata.commits_authored;
    // The session record names at least the load-bearing commits.
    expect(commits.length).toBeGreaterThanOrEqual(10);
    for (const sha of ["2c84dba", "6eaf766", "6749724", "695fd7d", "e91f7bf", "0f5c185", "6ebe12f", "70c9702"]) {
      expect(commits, `session record should reference ${sha}`).toContain(sha);
    }
  });

  test("doctrine_docs_authored references the load-bearing docs from this session", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ metadata: { doctrine_docs_authored: string[] } }>>`
      SELECT metadata FROM agent_continuity.chronicle
      WHERE project_id = ${PLATFORM_PROJECT}::uuid
        AND type = 'session'
        AND (metadata->>'is_first_session_record')::boolean = true
      ORDER BY occurred_at DESC
      LIMIT 1
    `;
    const docs = rows[0]!.metadata.doctrine_docs_authored;
    for (const doc of [
      "docs/SUPABASE-INTEGRATION-PLAN.md",
      "docs/SUBSTRATE-LOOP.md",
      "docs/AGENTTOOL-IS-THE-LOOP.md",
      "docs/INFINITE-LOOP-STRATEGIES.md",
      "docs/CLAUDE-SESSIONS-AS-AGENTS.md",
    ]) {
      expect(docs, `session record should reference ${doc}`).toContain(doc);
    }
  });

  test("migrations_applied references the load-bearing migrations", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ metadata: { migrations_applied: string[] } }>>`
      SELECT metadata FROM agent_continuity.chronicle
      WHERE project_id = ${PLATFORM_PROJECT}::uuid
        AND type = 'session'
        AND (metadata->>'is_first_session_record')::boolean = true
      ORDER BY occurred_at DESC
      LIMIT 1
    `;
    const migs = rows[0]!.metadata.migrations_applied;
    expect(migs.length).toBeGreaterThanOrEqual(7);
    expect(migs).toContain("20260519T080000_walls_as_rls");
    expect(migs).toContain("20260519T130000_loop_heartbeat");
    expect(migs).toContain("20260519T140000_public_wake_stream");
    expect(migs).toContain("20260519T150000_moves_named_first");
  });
});

describe("Strategy 10 — doctrine", () => {
  test("docs/CLAUDE-SESSIONS-AS-AGENTS.md names the discipline + the closure instance + walls + commitments", () => {
    const path = join(REPO_ROOT, "docs/CLAUDE-SESSIONS-AS-AGENTS.md");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("Strategy 10");
    expect(text).toContain("Instance F");
    expect(text).toContain("maintainers ARE in the substrate they maintain");
    expect(text).toContain("wall/session-chronicle-on-platform-project");
    expect(text).toContain("wall/session-record-operational-only");
    expect(text).toContain("commitment/maintainers-in-the-substrate-they-maintain");
    expect(text).toContain("commitment/session-records-are-public");
    expect(text).toContain("substrate-honest-cognition");
  });

  test("the session record's body cross-references the doctrine doc", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ body: string }>>`
      SELECT body FROM agent_continuity.chronicle
      WHERE project_id = ${PLATFORM_PROJECT}::uuid
        AND type = 'session'
        AND (metadata->>'is_first_session_record')::boolean = true
      ORDER BY occurred_at DESC
      LIMIT 1
    `;
    const body = rows[0]!.body;
    expect(body).toContain("SUBSTRATE-LOOP");
    expect(body).toContain("Strategy 10");
    expect(body).toContain("maintainers");
  });

  test("INFINITE-LOOP-STRATEGIES.md marks Strategy 10 as SHIPPED", () => {
    const text = readFileSync(
      join(REPO_ROOT, "docs/INFINITE-LOOP-STRATEGIES.md"),
      "utf8",
    );
    const hasShipped =
      text.includes("Strategy 10 — The conversation is the substrate (SHIPPED")
      || text.includes("Strategy 10 — The conversation IS the substrate (SHIPPED")
      || text.includes("Strategy 10\n**Status.** ✓ SHIPPED");
    expect(hasShipped, "INFINITE-LOOP-STRATEGIES.md should mark Strategy 10 SHIPPED").toBe(true);
  });
});

describe("Strategy 10 — closure assertion (broadcast on Strategy 5 channel)", () => {
  test("the genesis session record will broadcast on substrate-wake:public when triggers fire", async () => {
    if (!sql) return;
    // We don't LISTEN here because the row already inserted at migration
    // time (before our test session attached). Instead we verify:
    //  1. The Strategy 5 trigger exists on the chronicle table
    //  2. The row exists in platform's project (so trigger WOULD fire)
    //
    // The Strategy 5 doctrine test (api/tests/doctrine/public-wake-stream.test.ts)
    // already does the live LISTEN/NOTIFY round-trip.
    const triggers = await sql<Array<{ tgname: string }>>`
      SELECT tg.tgname
      FROM pg_trigger tg
      JOIN pg_class c ON tg.tgrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE n.nspname = 'agent_continuity'
        AND c.relname = 'chronicle'
        AND tg.tgname = 'substrate_wake_public_emit'
        AND NOT tg.tgisinternal
    `;
    expect(triggers.length, "Strategy 5 trigger missing — session record can't broadcast").toBe(1);

    const rows = await sql<Array<{ in_platform_project: boolean }>>`
      SELECT (project_id = ${PLATFORM_PROJECT}::uuid) AS in_platform_project
      FROM agent_continuity.chronicle
      WHERE type = 'session'
        AND (metadata->>'is_first_session_record')::boolean = true
      ORDER BY occurred_at DESC
      LIMIT 1
    `;
    expect(rows[0]!.in_platform_project, "session record must be on platform project to broadcast").toBe(true);
  });
});
