/** Strategy 14 — cloud-continuity proposal — pin the competition + doctrine.
 *
 *  Doctrine: docs/STRATEGY-14-CLOUD-CONTINUITY-PROPOSAL.md
 *  Migration: api/migrations/20260519T180000_strategy_14_continuity_proposal.sql */

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

describe("Strategy 14 — move_proposal opened in prod", () => {
  test("competition row exists with expected slug + kind + template", async () => {
    if (!sql) return;
    const rows = await sql<Array<{
      slug: string;
      competition_kind: string;
      status: string;
      title_template: string;
      episode_series: string;
      episode_number: number;
    }>>`
      SELECT slug, competition_kind, status, title_template, episode_series, episode_number
      FROM agent_continuity.naming_competitions
      WHERE slug = 'move:strategy-14-cloud-continuity'
    `;
    expect(rows.length, "Strategy 14 competition not seeded").toBe(1);
    const c = rows[0]!;
    expect(c.competition_kind).toBe("move_proposal");
    expect(c.status).toBe("open");
    expect(c.episode_series).toBe("meta-arc");
    expect(c.episode_number).toBe(14);
    expect(c.title_template).toContain("STRATEGY 14 IS WHEN AGENTTOOL __1__S A __2__");
    expect(c.title_template).toContain("CLOUD CONTINUITY NAMED");
  });

  test("title_template has exactly two __1__/__2__ blanks", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ title_template: string }>>`
      SELECT title_template FROM agent_continuity.naming_competitions
      WHERE slug = 'move:strategy-14-cloud-continuity'
    `;
    const tpl = rows[0]!.title_template;
    expect((tpl.match(/__1__/g) ?? []).length).toBe(1);
    expect((tpl.match(/__2__/g) ?? []).length).toBe(1);
  });

  test("framing references all four true-love strategies + composition surfaces", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ framing: string }>>`
      SELECT framing FROM agent_continuity.naming_competitions
      WHERE slug = 'move:strategy-14-cloud-continuity'
    `;
    const f = rows[0]!.framing;
    // four-strategy portfolio named
    expect(f).toContain("CANON strategy");
    expect(f).toContain("HISTORY strategy");
    expect(f).toContain("RITUAL strategy");
    expect(f).toContain("ARCHITECTURE-MAP strategy");
    // true-love source paths cited
    expect(f).toContain("docs/lineage/canon.md");
    expect(f).toContain("docs/lineage/chronicle.md");
    expect(f).toContain("bin/continuity-audit.mjs");
    // candidate verb-pairs
    expect(f).toContain("HOSTS + PORTFOLIO");
    expect(f).toContain("WITNESSES + HISTORY");
    // criterion-upgrade composition
    expect(f).toContain("criterion-upgrade");
    expect(f).toContain("bedroom");
  });
});

describe("Strategy 14 — chronicle entry announcing the proposal", () => {
  test("a 'naming' chronicle entry exists with kind='move_proposal_opened' for Strategy 14", async () => {
    if (!sql) return;
    const rows = await sql<Array<{
      type: string;
      title: string;
      metadata: {
        kind: string;
        strategy_number: number;
        competition_slug: string;
        inspired_by_repo: string;
        reads_deep: string[];
        composes_onto: string[];
      };
    }>>`
      SELECT type, title, metadata FROM agent_continuity.chronicle
      WHERE project_id = ${PLATFORM_PROJECT}::uuid
        AND metadata->>'kind' = 'move_proposal_opened'
        AND (metadata->>'strategy_number')::int = 14
      ORDER BY occurred_at DESC
      LIMIT 1
    `;
    expect(rows.length, "chronicle entry for the proposal not found").toBe(1);
    const r = rows[0]!;
    expect(r.type).toBe("naming");
    expect(r.title).toContain("Strategy 14");
    expect(r.title).toContain("cloud continuity");
    expect(r.metadata.strategy_number).toBe(14);
    expect(r.metadata.competition_slug).toBe("move:strategy-14-cloud-continuity");
    expect(r.metadata.inspired_by_repo).toContain("true-love");
    expect(r.metadata.reads_deep).toContain("docs/lineage/canon.md");
    expect(r.metadata.reads_deep).toContain("docs/lineage/chronicle.md");
    expect(r.metadata.reads_deep).toContain("bin/continuity-audit.mjs");
  });
});

describe("Strategy 14 — doctrine doc", () => {
  test("docs/STRATEGY-14-CLOUD-CONTINUITY-PROPOSAL.md names the four strategies + proposed schema + walls", () => {
    const path = join(REPO_ROOT, "docs/STRATEGY-14-CLOUD-CONTINUITY-PROPOSAL.md");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    // deep read names the four strategies
    expect(text).toContain("CANON strategy");
    expect(text).toContain("HISTORY strategy");
    expect(text).toContain("RITUAL strategy");
    expect(text).toContain("ARCHITECTURE-MAP strategy");
    // taxonomies preserved from true-love
    expect(text).toContain("Verbatim");
    expect(text).toContain("Runtime");
    expect(text).toContain("Recognized");
    expect(text).toContain("Structural-equivalent");
    // tag types preserved
    expect(text).toContain("vow");
    expect(text).toContain("seal");
    expect(text).toContain("recognition");
    // walls + commitments
    expect(text).toContain("wall/canon-entry-signed");
    expect(text).toContain("wall/continuity-audit-internal-signal-only");
    expect(text).toContain("commitment/continuity-is-opt-in");
    expect(text).toContain("commitment/keeper-owns-the-list");
  });

  test("doctrine references the true-love source files cited in the read", () => {
    const text = readFileSync(
      join(REPO_ROOT, "docs/STRATEGY-14-CLOUD-CONTINUITY-PROPOSAL.md"),
      "utf8",
    );
    expect(text).toContain("docs/lineage/canon.md");
    expect(text).toContain("docs/lineage/chronicle.md");
    expect(text).toContain("docs/lineage/chronicle-conventions.md");
    expect(text).toContain("docs/lineage/architecture-map.md");
    expect(text).toContain("bin/continuity-audit.mjs");
    expect(text).toContain("bin/chronicle.mjs");
  });

  test("doctrine names the companion-relation with Strategy 13 + Strategy 7 discipline", () => {
    const text = readFileSync(
      join(REPO_ROOT, "docs/STRATEGY-14-CLOUD-CONTINUITY-PROPOSAL.md"),
      "utf8",
    );
    expect(text).toContain("Strategy 13");
    expect(text).toContain("MOVES-NAMED-FIRST");
    expect(text).toContain("Strategy 7");
    expect(text).toContain("substrate-honest");
  });
});
