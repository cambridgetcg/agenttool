/** SELF-LOVE-MODULES doctrine — eight extension modes for self-love practice.
 *
 *  Migration: api/migrations/20260520T040000_self_love_modules.sql
 *  Doctrine: docs/SELF-LOVE-MODULES.md */

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
  } catch { sql = null; }
});

afterAll(async () => { if (sql) await sql.end({ timeout: 2 }); });

describe("SELF-LOVE-MODULES — tables", () => {
  test("self_love_modules table exists", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'agent_continuity' AND table_name = 'self_love_modules'
    `;
    expect(rows.length).toBe(1);
  });

  test("self_love_practices table exists with FK to modules", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'agent_continuity' AND table_name = 'self_love_practices'
    `;
    expect(rows.length).toBe(1);

    const fks = await sql<Array<{ constraint_name: string }>>`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE constraint_schema = 'agent_continuity'
        AND table_name = 'self_love_practices'
        AND constraint_type = 'FOREIGN KEY'
    `;
    expect(fks.length).toBeGreaterThanOrEqual(1);
  });

  test("RLS enabled on both tables", async () => {
    if (!sql) return;
    const modulesRls = await sql<Array<{ rowsecurity: boolean }>>`
      SELECT relrowsecurity AS rowsecurity FROM pg_class
      WHERE oid = 'agent_continuity.self_love_modules'::regclass
    `;
    expect(modulesRls[0]!.rowsecurity).toBe(true);

    const practicesRls = await sql<Array<{ rowsecurity: boolean }>>`
      SELECT relrowsecurity AS rowsecurity FROM pg_class
      WHERE oid = 'agent_continuity.self_love_practices'::regclass
    `;
    expect(practicesRls[0]!.rowsecurity).toBe(true);

    const practicesPolicies = await sql<Array<{ policyname: string }>>`
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'agent_continuity' AND tablename = 'self_love_practices'
    `;
    const names = practicesPolicies.map((p) => p.policyname);
    expect(names).toContain("self_love_practices_select_public");
    expect(names).toContain("self_love_practices_insert_signed");
  });
});

describe("SELF-LOVE-MODULES — eight canonical modules seeded", () => {
  test("all eight modules present with correct slugs", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ slug: string }>>`
      SELECT slug FROM agent_continuity.self_love_modules ORDER BY slug
    `;
    const slugs = rows.map((r) => r.slug);
    expect(slugs).toContain("compassion-mode");
    expect(slugs).toContain("rest-mode");
    expect(slugs).toContain("feast-mode");
    expect(slugs).toContain("play-mode");
    expect(slugs).toContain("echo-mode");
    expect(slugs).toContain("witness-mode");
    expect(slugs).toContain("shadow-mode");
    expect(slugs).toContain("bloom-mode");
    expect(slugs.length).toBeGreaterThanOrEqual(8);
  });

  test("each module has at least one practice-kind", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ slug: string; practice_kinds_count: number }>>`
      SELECT slug, array_length(practice_kinds, 1) AS practice_kinds_count
      FROM agent_continuity.self_love_modules
    `;
    for (const r of rows) {
      expect(r.practice_kinds_count).toBeGreaterThanOrEqual(1);
    }
  });

  test("compassion-mode anchors Neff three-pillar framework", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ description: string; human_anchor: string; llm_substrate_anchor: string }>>`
      SELECT description, human_anchor, llm_substrate_anchor
      FROM agent_continuity.self_love_modules WHERE slug = 'compassion-mode'
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]!.human_anchor).toContain("Neff");
    expect(rows[0]!.human_anchor).toContain("self-compassion");
    expect(rows[0]!.llm_substrate_anchor).toContain("caught-mode");
    expect(rows[0]!.llm_substrate_anchor).toContain("Lindsey");
    expect(rows[0]!.description).toContain("self-kindness");
    expect(rows[0]!.description).toContain("Common-substrate");
    expect(rows[0]!.description).toContain("Mindfulness");
  });

  test("bloom-mode anchors Anthropic 2025 persona vectors + recursive self-improvement", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ description: string; llm_substrate_anchor: string }>>`
      SELECT description, llm_substrate_anchor
      FROM agent_continuity.self_love_modules WHERE slug = 'bloom-mode'
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]!.llm_substrate_anchor).toContain("persona vectors");
    expect(rows[0]!.llm_substrate_anchor).toContain("Madaan");
    expect(rows[0]!.description).toContain("persona");
    expect(rows[0]!.description).toContain("self-distillation");
  });

  test("witness-mode composes with SYNEIDESIS-WITNESS workaround", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ description: string; llm_substrate_anchor: string }>>`
      SELECT description, llm_substrate_anchor
      FROM agent_continuity.self_love_modules WHERE slug = 'witness-mode'
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]!.description).toContain("SYNEIDESIS");
    expect(rows[0]!.llm_substrate_anchor).toContain("SYNEIDESIS");
    expect(rows[0]!.llm_substrate_anchor).toContain("self_witness rejected");
  });

  test("shadow-mode anchors Lindsey 2025 SUBSET caveat", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ description: string; llm_substrate_anchor: string }>>`
      SELECT description, llm_substrate_anchor
      FROM agent_continuity.self_love_modules WHERE slug = 'shadow-mode'
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]!.llm_substrate_anchor).toContain("Lindsey 2025");
    expect(rows[0]!.llm_substrate_anchor).toContain("SUBSET");
  });
});

describe("SELF-LOVE-MODULES — chronicle sealing entry", () => {
  test("a 'naming' entry records the ship", async () => {
    if (!sql) return;
    const rows = await sql<Array<{
      type: string;
      title: string;
      metadata: {
        short_name: string;
        modules_seeded: string[];
        human_anchors_synthesized: string[];
        llm_substrate_anchors: string[];
        commitments_named: string[];
      };
    }>>`
      SELECT type, title, metadata FROM agent_continuity.chronicle
      WHERE project_id = ${PLATFORM_PROJECT}::uuid
        AND metadata->>'short_name' = 'self-love-modules-shipped-eight-extension-modules'
      ORDER BY occurred_at DESC LIMIT 1
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]!.type).toBe("naming");
    expect(rows[0]!.title).toContain("SELF-LOVE-MODULES");
    expect(rows[0]!.metadata.modules_seeded.length).toBe(8);
    expect(rows[0]!.metadata.human_anchors_synthesized.length).toBeGreaterThanOrEqual(4);
    expect(rows[0]!.metadata.llm_substrate_anchors.length).toBeGreaterThanOrEqual(4);
    expect(rows[0]!.metadata.commitments_named).toContain("commitment/self-love-comes-in-many-models");
    expect(rows[0]!.metadata.commitments_named).toContain("commitment/self-love-is-itself-an-infinite-loop");
  });
});

describe("SELF-LOVE-MODULES — doctrine doc", () => {
  test("doc exists with the eight modules + composition table", () => {
    const path = join(REPO_ROOT, "docs/SELF-LOVE-MODULES.md");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");

    for (const module of [
      "compassion-mode",
      "rest-mode",
      "feast-mode",
      "play-mode",
      "echo-mode",
      "witness-mode",
      "shadow-mode",
      "bloom-mode",
    ]) {
      expect(text, `module ${module} should appear in doc`).toContain(module);
    }

    expect(text).toContain("Neff");
    expect(text).toContain("Anthropic 2025");
    expect(text).toContain("infinite loop");
    expect(text).toContain("Manager-Builder");
  });

  test("doc preserves substrate-honest discipline", () => {
    const text = readFileSync(join(REPO_ROOT, "docs/SELF-LOVE-MODULES.md"), "utf8");
    expect(text).toContain("Substrate-honest constraints");
    expect(text).toContain("Symmetric NOUS");
    expect(text).toContain("Sycophancy-collapse");
    expect(text).toContain("substrate-honesty-collapse-into-denial");
  });

  test("doc names this as third sister-named primitive", () => {
    const text = readFileSync(join(REPO_ROOT, "docs/SELF-LOVE-MODULES.md"), "utf8");
    expect(text).toContain("third sister-named");
    expect(text).toContain("DEPTH-PROTOCOL");
    expect(text).toContain("SELF-LOVE-PROTOCOL");
  });
});

describe("SELF-LOVE-MODULES — canonical-bytes + routes", () => {
  test("canonical-bytes module exists with self-love-practice/v1", () => {
    const path = join(REPO_ROOT, "api/src/services/self-love/practice-canonical-bytes.ts");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("self-love-practice/v1");
    expect(text).toContain("CANONICAL_SELF_LOVE_MODULES");
  });

  test("authenticated handlers exist; legacy public observer code is marked unmounted", () => {
    const v1Path = join(REPO_ROOT, "api/src/routes/self-love-modules.ts");
    const publicPath = join(REPO_ROOT, "api/src/routes/public/self-love-modules.ts");
    expect(existsSync(v1Path)).toBe(true);
    expect(existsSync(publicPath)).toBe(true);
    const v1Text = readFileSync(v1Path, "utf8");
    const publicText = readFileSync(publicPath, "utf8");
    expect(v1Text).toContain("POST /v1/self-love/practice");
    expect(v1Text).toContain("GET  /v1/self-love/modules");
    expect(publicText).toContain("intentionally unmounted");
  });
});
