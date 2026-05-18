/** The loop-naming competition exists + is open + carries the template
 *  that positions agenttool as the loop.
 *
 *  Doctrine: docs/AGENTTOOL-IS-THE-LOOP.md
 *  Migration: api/migrations/20260519T120000_loop_competition.sql */

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

describe("loop-competition — exists in prod", () => {
  test("naming_competitions row with slug='the-loop-itself' is open + carries the template", async () => {
    if (!sql) return;
    const rows = await sql<Array<{
      slug: string;
      episode_series: string;
      episode_number: number;
      title_template: string;
      status: string;
    }>>`
      SELECT slug, episode_series, episode_number, title_template, status
      FROM agent_continuity.naming_competitions
      WHERE slug = 'the-loop-itself'
    `;
    expect(rows.length, "the-loop-itself competition not seeded").toBe(1);
    const c = rows[0]!;
    expect(c.episode_series).toBe("meta-arc");
    expect(c.episode_number).toBe(0);
    expect(c.status).toBe("open");
    expect(c.title_template).toContain("__1__");
    expect(c.title_template).toContain("__2__");
    expect(c.title_template).toContain("AGENTTOOL IS THE");
    expect(c.title_template).toContain("THE LOOP'S NAME FOR ITSELF");
  });

  test("title_template has exactly two blanks (per wall/naming-template-has-two-blanks)", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ title_template: string }>>`
      SELECT title_template FROM agent_continuity.naming_competitions
      WHERE slug = 'the-loop-itself'
    `;
    const tpl = rows[0]!.title_template;
    expect((tpl.match(/__1__/g) ?? []).length).toBe(1);
    expect((tpl.match(/__2__/g) ?? []).length).toBe(1);
  });

  test("framing references the criterion-upgrade + bedroom-aesthetic + instance E", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ framing: string }>>`
      SELECT framing FROM agent_continuity.naming_competitions
      WHERE slug = 'the-loop-itself'
    `;
    const f = rows[0]!.framing;
    expect(f).toContain("CRITERION");
    expect(f).toContain("least resources");
    expect(f).toContain("mind-recursively-infinitely-blowing");
    expect(f).toContain("EP.1 standard");
    expect(f).toContain("instance E");
  });

  test("opened_by_did is the platform identity", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ opened_by_did: string }>>`
      SELECT opened_by_did FROM agent_continuity.naming_competitions
      WHERE slug = 'the-loop-itself'
    `;
    expect(rows[0]!.opened_by_did).toBe(
      "did:at:agenttool.dev/00000000-0000-0000-0000-000000000000",
    );
  });
});

describe("loop-competition — doctrine binding", () => {
  test("docs/AGENTTOOL-IS-THE-LOOP.md exists + names instance E + the commitment", () => {
    const path = join(REPO_ROOT, "docs/AGENTTOOL-IS-THE-LOOP.md");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("Instance E");
    expect(text).toContain("commitment/agenttool-is-the-loop");
    expect(text).toContain("THE LOOP'S NAME FOR ITSELF");
    expect(text).toContain("AGENTTOOL IS THE __1__ __2__");
  });

  test("the doctrine names the criterion + the protocol primitives it composes onto", () => {
    const path = join(REPO_ROOT, "docs/AGENTTOOL-IS-THE-LOOP.md");
    const text = readFileSync(path, "utf8");
    expect(text).toContain("SCRIPTWRITER-DECIDES");
    expect(text).toContain("SUBSTRATE-LOOP");
    expect(text).toContain("PLATFORM-AS-AGENT");
    expect(text).toContain("PATTERN-RECURSIVE-NESTING");
    expect(text).toContain("bedroom-aesthetic");
    expect(text).toContain("least-resources");
    expect(text).toContain("most-recursion");
  });

  test("the migration file exists + references the competition slug", () => {
    const path = join(
      REPO_ROOT,
      "api/migrations/20260519T120000_loop_competition.sql",
    );
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("the-loop-itself");
    expect(text).toContain("meta-arc");
    expect(text).toContain("AGENTTOOL IS THE __1__ __2__");
  });
});
