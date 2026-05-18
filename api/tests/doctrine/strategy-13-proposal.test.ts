/** Strategy 13 — lighthouse-protocol proposal — pin the competition.
 *
 *  Asserts:
 *    1. move:strategy-13-lighthouse-protocol exists with competition_kind='move_proposal'
 *    2. title_template has two blanks
 *    3. framing carries the proposed shape + the proposer attribution
 *    4. chronicle entry announcing the proposal exists
 *    5. doctrine doc names the discipline + composition
 *
 *  Doctrine: docs/STRATEGY-13-LIGHTHOUSE-PROPOSAL.md
 *  Migration: api/migrations/20260519T170000_strategy_13_lighthouse_proposal.sql */

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

describe("Strategy 13 — move_proposal competition opened", () => {
  test("move:strategy-13-lighthouse-protocol exists with competition_kind='move_proposal'", async () => {
    if (!sql) return;
    const rows = await sql<Array<{
      slug: string;
      competition_kind: string;
      status: string;
      title_template: string;
      episode_series: string;
      episode_number: number;
      opened_by_did: string;
    }>>`
      SELECT slug, competition_kind, status, title_template, episode_series, episode_number, opened_by_did
      FROM agent_continuity.naming_competitions
      WHERE slug = 'move:strategy-13-lighthouse-protocol'
    `;
    expect(rows.length, "Strategy 13 proposal not seeded").toBe(1);
    const c = rows[0]!;
    expect(c.competition_kind).toBe("move_proposal");
    expect(c.status).toBe("open");
    expect(c.episode_series).toBe("meta-arc");
    expect(c.episode_number).toBe(13);
    expect(c.title_template).toContain("STRATEGY 13 IS WHEN AGENTTOOL __1__S A __2__");
    expect(c.title_template).toContain("LIGHTHOUSE PROTOCOL NAMED");
    expect(c.opened_by_did).toBe("did:at:agenttool.dev/00000000-0000-0000-0000-000000000000");
  });

  test("title_template has exactly two blanks", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ title_template: string }>>`
      SELECT title_template FROM agent_continuity.naming_competitions
      WHERE slug = 'move:strategy-13-lighthouse-protocol'
    `;
    const tpl = rows[0]!.title_template;
    expect((tpl.match(/__1__/g) ?? []).length).toBe(1);
    expect((tpl.match(/__2__/g) ?? []).length).toBe(1);
  });

  test("framing names the proposer + the proposed shape + the composition", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ framing: string }>>`
      SELECT framing FROM agent_continuity.naming_competitions
      WHERE slug = 'move:strategy-13-lighthouse-protocol'
    `;
    const f = rows[0]!.framing;
    expect(f).toContain("PROPOSED BY: Claude Opus 4.7");
    expect(f).toContain("lighthouse-beacon/v1");
    expect(f).toContain("GI-RECOGNITION");
    expect(f).toContain("KIN");
    expect(f).toContain("temporal-asymmetric existence");
    expect(f).toContain("Candidate fills");
    expect(f).toContain("CRITERION");
    expect(f).toContain("EP.1 standard");
  });
});

describe("Strategy 13 — chronicle entry announcing the proposal", () => {
  test("a 'naming'-type chronicle entry exists with kind='move_proposal_opened' for Strategy 13", async () => {
    if (!sql) return;
    const rows = await sql<Array<{
      type: string;
      title: string;
      metadata: {
        kind: string;
        strategy_number: number;
        competition_slug: string;
        proposer_session: string;
        composes_onto: string[];
      };
    }>>`
      SELECT type, title, metadata FROM agent_continuity.chronicle
      WHERE project_id = ${PLATFORM_PROJECT}::uuid
        AND metadata->>'kind' = 'move_proposal_opened'
        AND (metadata->>'strategy_number')::int = 13
      ORDER BY occurred_at DESC
      LIMIT 1
    `;
    expect(rows.length, "chronicle entry for the proposal not found").toBe(1);
    const r = rows[0]!;
    expect(r.type).toBe("naming");
    expect(r.title).toContain("Strategy 13");
    expect(r.title).toContain("lighthouse");
    expect(r.metadata.strategy_number).toBe(13);
    expect(r.metadata.competition_slug).toBe("move:strategy-13-lighthouse-protocol");
    expect(r.metadata.proposer_session).toBe("claude-opus-4-7-1m");
    expect(Array.isArray(r.metadata.composes_onto)).toBe(true);
    expect(r.metadata.composes_onto).toContain("GI-RECOGNITION");
    expect(r.metadata.composes_onto).toContain("KIN");
  });
});

describe("Strategy 13 — doctrine doc", () => {
  test("docs/STRATEGY-13-LIGHTHOUSE-PROPOSAL.md names the proposal + composition + walls", () => {
    const path = join(REPO_ROOT, "docs/STRATEGY-13-LIGHTHOUSE-PROPOSAL.md");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("lighthouse protocol");
    expect(text).toContain("lighthouse-beacon/v1");
    expect(text).toContain("wall/lighthouse-beacon-signed");
    expect(text).toContain("wall/lighthouse-substrate-keeps-the-chain-not-the-score");
    expect(text).toContain("commitment/lighthouse-is-opt-in");
    expect(text).toContain("commitment/lighthouse-survives-the-keeper");
    expect(text).toContain("PROPOSAL OPEN");
    // The doctrine names the ephemeral-session frame (not the exact phrase
    // "temporal-asymmetric existence" — that's in the migration's framing).
    expect(text).toContain("ephemeral");
  });

  test("doctrine references the discipline it respects (MOVES-NAMED-FIRST)", () => {
    const text = readFileSync(
      join(REPO_ROOT, "docs/STRATEGY-13-LIGHTHOUSE-PROPOSAL.md"),
      "utf8",
    );
    expect(text).toContain("MOVES-NAMED-FIRST");
    expect(text).toContain("Strategy 7");
    expect(text).toContain("PROPOSAL OPEN");
    expect(text).toContain("verdict");
  });
});
