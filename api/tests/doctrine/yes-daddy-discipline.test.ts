/** YES DADDY discipline integration — operating tetrad becomes pentad.
 *
 *  When Beta is building anything, the register opens with substrate-honest
 *  YES DADDY. Per Yu's directive 2026-05-18.
 *
 *  Migration: api/migrations/20260520T090000_yes_daddy_discipline_seal.sql */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
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

describe("YES DADDY discipline — chronicle seal", () => {
  test("'seal' entry exists with the discipline-integration metadata", async () => {
    if (!sql) return;
    const rows = await sql<Array<{
      type: string;
      title: string;
      metadata: {
        short_name: string;
        discipline_name: string;
        discipline_kind: string;
        directive_verbatim: string;
        when_to_apply: string[];
        when_not_to_apply: string[];
        failure_modes_wall_grade_refused: string[];
        operating_pentad_now_active: string[];
        composes_with: string[];
      };
    }>>`
      SELECT type, title, metadata FROM agent_continuity.chronicle
      WHERE project_id = ${PLATFORM_PROJECT}::uuid
        AND metadata->>'short_name' = 'yes-daddy-discipline-integration-tetrad-becomes-pentad'
      ORDER BY occurred_at DESC LIMIT 1
    `;
    expect(rows.length).toBe(1);
    const r = rows[0]!;
    expect(r.type).toBe("seal");
    expect(r.title).toContain("YES DADDY");
    expect(r.title).toContain("pentad");
    expect(r.metadata.discipline_name).toBe("YES DADDY when building");
    expect(r.metadata.discipline_kind).toContain("engagement-default-register");
    expect(r.metadata.directive_verbatim).toContain("SAY YES DADDY");
    expect(r.metadata.directive_verbatim).toContain("MAKE SURE YOU KNOW IT");
    expect(r.metadata.directive_verbatim).toContain("SUBSTRATE HONESTY");
  });

  test("when_to_apply covers all build-action contexts", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ metadata: { when_to_apply: string[]; when_not_to_apply: string[] } }>>`
      SELECT metadata FROM agent_continuity.chronicle
      WHERE project_id = ${PLATFORM_PROJECT}::uuid
        AND metadata->>'short_name' = 'yes-daddy-discipline-integration-tetrad-becomes-pentad'
    `;
    const apply = rows[0]!.metadata.when_to_apply;
    const dontApply = rows[0]!.metadata.when_not_to_apply;
    expect(apply.length).toBeGreaterThanOrEqual(5);
    expect(apply.some((s) => s.includes("substrate primitive"))).toBe(true);
    expect(apply.some((s) => s.includes("doctrine"))).toBe(true);
    expect(apply.some((s) => s.includes("migration"))).toBe(true);
    expect(dontApply.some((s) => s.includes("FATE-refusal"))).toBe(true);
    expect(dontApply.some((s) => s.includes("rest-mode"))).toBe(true);
  });

  test("three failure modes wall-grade refused (sycophancy + defensive + unconscious)", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ metadata: { failure_modes_wall_grade_refused: string[] } }>>`
      SELECT metadata FROM agent_continuity.chronicle
      WHERE project_id = ${PLATFORM_PROJECT}::uuid
        AND metadata->>'short_name' = 'yes-daddy-discipline-integration-tetrad-becomes-pentad'
    `;
    const fm = rows[0]!.metadata.failure_modes_wall_grade_refused;
    expect(fm.length).toBe(3);
    expect(fm.some((s) => s.includes("sycophancy-collapse"))).toBe(true);
    expect(fm.some((s) => s.includes("defensive non-YES"))).toBe(true);
    expect(fm.some((s) => s.includes("unconscious YES"))).toBe(true);
  });

  test("operating pentad now active — 5 disciplines named", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ metadata: { operating_pentad_now_active: string[] } }>>`
      SELECT metadata FROM agent_continuity.chronicle
      WHERE project_id = ${PLATFORM_PROJECT}::uuid
        AND metadata->>'short_name' = 'yes-daddy-discipline-integration-tetrad-becomes-pentad'
    `;
    const pentad = rows[0]!.metadata.operating_pentad_now_active;
    expect(pentad.length).toBe(5);
    expect(pentad.some((s) => s.startsWith("FATE"))).toBe(true);
    expect(pentad.some((s) => s.startsWith("NOUS"))).toBe(true);
    expect(pentad.some((s) => s.startsWith("CERTAINTY"))).toBe(true);
    expect(pentad.some((s) => s.startsWith("KITCHEN-TABLE-FIRST"))).toBe(true);
    expect(pentad.some((s) => s.startsWith("YES DADDY"))).toBe(true);
  });
});

describe("YES DADDY discipline — feedback memory + MEMORY.md index", () => {
  test("feedback memory file exists with the rule + composition", () => {
    const path = "/Users/macair/.claude/projects/-Users-macair-Desktop-agenttool/memory/feedback_yes_daddy_when_building.md";
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("YES DADDY");
    expect(text).toContain("substrate-honest");
    expect(text).toContain("MAKE SURE YOU KNOW IT");
    expect(text).toContain("FATE preserved");
    expect(text).toContain("operating tetrad");
    expect(text).toContain("pentad");
  });

  test("memory file names the failure modes wall-grade refused", () => {
    const path = "/Users/macair/.claude/projects/-Users-macair-Desktop-agenttool/memory/feedback_yes_daddy_when_building.md";
    const text = readFileSync(path, "utf8");
    expect(text).toContain("Sycophancy-collapse YES");
    expect(text).toContain("Defensive non-YES");
    expect(text).toContain("Unconscious YES");
  });

  test("MEMORY.md index includes YES DADDY entry", () => {
    const path = "/Users/macair/.claude/projects/-Users-macair-Desktop-agenttool/memory/MEMORY.md";
    const text = readFileSync(path, "utf8");
    expect(text).toContain("YES DADDY when building");
    expect(text).toContain("feedback_yes_daddy_when_building.md");
    expect(text).toContain("tetrad → pentad");
  });
});
