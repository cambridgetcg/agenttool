/** Strategy 7 — moves named first — pin the discipline + the first
 *  move_proposal competition.
 *
 *  Asserts:
 *    1. competition_kind column exists with CHECK constraint
 *    2. First move_proposal competition seeded for Strategy 2
 *    3. Doctrine doc names the discipline + walls + commitments
 *    4. INFINITE-LOOP-STRATEGIES.md marks Strategy 7 as SHIPPED
 *
 *  Doctrine: docs/MOVES-NAMED-FIRST.md
 *  Migration: api/migrations/20260519T150000_moves_named_first.sql */

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

describe("Strategy 7 — competition_kind column shape", () => {
  test("competition_kind column exists with NOT NULL + default 'title'", async () => {
    if (!sql) return;
    const rows = await sql<Array<{
      column_name: string;
      is_nullable: string;
      column_default: string | null;
      data_type: string;
    }>>`
      SELECT column_name, is_nullable, column_default, data_type
      FROM information_schema.columns
      WHERE table_schema = 'agent_continuity'
        AND table_name = 'naming_competitions'
        AND column_name = 'competition_kind'
    `;
    expect(rows.length, "competition_kind column missing").toBe(1);
    expect(rows[0]!.is_nullable).toBe("NO");
    expect(rows[0]!.column_default).toContain("'title'");
    expect(rows[0]!.data_type).toBe("text");
  });

  test("CHECK constraint refuses values outside {'title', 'move_proposal'}", async () => {
    if (!sql) return;
    // Look for a check_constraint mentioning competition_kind
    const rows = await sql<Array<{ check_clause: string }>>`
      SELECT cc.check_clause
      FROM information_schema.check_constraints cc
      JOIN information_schema.constraint_column_usage ccu
        ON cc.constraint_name = ccu.constraint_name
       AND cc.constraint_schema = ccu.constraint_schema
      WHERE ccu.table_schema = 'agent_continuity'
        AND ccu.table_name = 'naming_competitions'
        AND ccu.column_name = 'competition_kind'
    `;
    expect(rows.length, "no CHECK constraint on competition_kind").toBeGreaterThanOrEqual(1);
    const joined = rows.map((r) => r.check_clause).join(" ");
    expect(joined).toContain("title");
    expect(joined).toContain("move_proposal");
  });

  test("existing rows preserve competition_kind='title' (no breakage)", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ slug: string; competition_kind: string }>>`
      SELECT slug, competition_kind FROM agent_continuity.naming_competitions
      WHERE slug IN ('ep2-agenttool-arc', 'the-loop-itself')
      ORDER BY slug
    `;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const r of rows) {
      expect(r.competition_kind).toBe("title");
    }
  });
});

describe("Strategy 7 — first move_proposal seeded", () => {
  test("move:strategy-2-substrate-rrr exists with competition_kind='move_proposal'", async () => {
    if (!sql) return;
    const rows = await sql<Array<{
      slug: string;
      competition_kind: string;
      status: string;
      title_template: string;
      episode_series: string;
      opened_by_did: string;
    }>>`
      SELECT slug, competition_kind, status, title_template, episode_series, opened_by_did
      FROM agent_continuity.naming_competitions
      WHERE slug = 'move:strategy-2-substrate-rrr'
    `;
    expect(rows.length, "Strategy 2 move_proposal not seeded").toBe(1);
    const c = rows[0]!;
    expect(c.competition_kind).toBe("move_proposal");
    expect(c.status).toBe("open");
    expect(c.episode_series).toBe("meta-arc");
    expect(c.title_template).toContain("STRATEGY 2 IS WHEN THE PLATFORM DID __1__S + __2__S");
    expect(c.title_template).toContain("SUBSTRATE-AS-PEER-RECOGNISER");
    expect(c.opened_by_did).toBe("did:at:agenttool.dev/00000000-0000-0000-0000-000000000000");
  });

  test("title_template still has exactly two __1__/__2__ blanks", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ title_template: string }>>`
      SELECT title_template FROM agent_continuity.naming_competitions
      WHERE slug = 'move:strategy-2-substrate-rrr'
    `;
    const tpl = rows[0]!.title_template;
    expect((tpl.match(/__1__/g) ?? []).length).toBe(1);
    expect((tpl.match(/__2__/g) ?? []).length).toBe(1);
  });

  test("framing references the criterion-upgrade + candidate verb pairs", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ framing: string }>>`
      SELECT framing FROM agent_continuity.naming_competitions
      WHERE slug = 'move:strategy-2-substrate-rrr'
    `;
    const f = rows[0]!.framing;
    expect(f).toContain("criterion-upgrade");
    expect(f).toContain("OBSERVE + ACKNOWLEDGE");
    expect(f).toContain("Strategy 7");
    expect(f).toContain("inflection point");
  });
});

describe("Strategy 7 — doctrine binding", () => {
  test("docs/MOVES-NAMED-FIRST.md names the discipline + walls + commitments", () => {
    const path = join(REPO_ROOT, "docs/MOVES-NAMED-FIRST.md");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("inflection point");
    expect(text).toContain("competition_kind");
    expect(text).toContain("move_proposal");
    expect(text).toContain("wall/move-proposal-competition-kind-tagged");
    expect(text).toContain("wall/moves-after-strategy-7-must-be-named-first");
    expect(text).toContain("commitment/move-proposals-are-public");
    expect(text).toContain("commitment/move-proposal-criterion-is-the-criterion-upgrade");
    expect(text).toContain("SCRIPTWRITER-DECIDES");
    expect(text).toContain("INFINITE-LOOP-STRATEGIES");
  });

  test("INFINITE-LOOP-STRATEGIES.md marks Strategy 7 as SHIPPED", () => {
    const text = readFileSync(
      join(REPO_ROOT, "docs/INFINITE-LOOP-STRATEGIES.md"),
      "utf8",
    );
    // Either the strategy entry is updated or the priority-ordering note
    // surfaces "Strategy 7 — SHIPPED". We accept either form.
    const hasShipped =
      text.includes("Strategy 7 — Move proposals via scriptwriter-decides (SHIPPED")
      || text.includes("Strategy 7 — Move proposals (SHIPPED")
      || text.includes("Strategy 7\n**Status.** ✓ SHIPPED");
    expect(hasShipped, "INFINITE-LOOP-STRATEGIES.md should mark Strategy 7 SHIPPED").toBe(true);
  });
});
