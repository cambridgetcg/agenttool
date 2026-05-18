/** TRUE-LOVE-CANON-IN-CLOUD-FORM bridging artifact — pin shape + chronicle
 *  entry.
 *
 *  Doctrine: docs/TRUE-LOVE-CANON-IN-CLOUD-FORM.md
 *  Migration: api/migrations/20260519T190000_true_love_bridge_seal.sql */

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

describe("TRUE-LOVE-CANON-IN-CLOUD-FORM — bridging chronicle entry", () => {
  test("a 'note' chronicle entry on platform project records the artifact landing", async () => {
    if (!sql) return;
    const rows = await sql<Array<{
      type: string;
      title: string;
      metadata: {
        kind: string;
        companion_proposal: string;
        inspired_by_repo: string;
        demonstrates: {
          canon_entries_shape: number;
          chronicle_typed_seals_shape: number;
          architecture_maps_shape: number;
        };
        preserves_taxonomies: string[];
        substrate_honest_discipline_inherited: string[];
      };
    }>>`
      SELECT type, title, metadata FROM agent_continuity.chronicle
      WHERE project_id = ${PLATFORM_PROJECT}::uuid
        AND metadata->>'kind' = 'cloud_continuity_bridging_artifact'
      ORDER BY occurred_at DESC
      LIMIT 1
    `;
    expect(rows.length, "bridging chronicle entry not found").toBe(1);
    const r = rows[0]!;
    expect(r.type).toBe("note");
    expect(r.title).toContain("true-love");
    expect(r.title).toContain("bridging artifact");
    expect(r.metadata.companion_proposal).toBe("move:strategy-14-cloud-continuity");
    expect(r.metadata.inspired_by_repo).toContain("true-love");
    expect(r.metadata.demonstrates.canon_entries_shape).toBe(8);
    expect(r.metadata.demonstrates.chronicle_typed_seals_shape).toBe(7);
    expect(r.metadata.demonstrates.architecture_maps_shape).toBe(10);
    expect(r.metadata.preserves_taxonomies.length).toBe(3);
    expect(r.metadata.substrate_honest_discipline_inherited).toContain(
      "audit is internal-signal only",
    );
  });
});

describe("TRUE-LOVE-CANON-IN-CLOUD-FORM — doctrine doc", () => {
  test("doctrine doc exists with the eight canon shapes + seven seal shapes + ten architecture-map shapes", () => {
    const path = join(REPO_ROOT, "docs/TRUE-LOVE-CANON-IN-CLOUD-FORM.md");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    // All eight canon texts named
    for (const text_id of ["SOUL.md", "FATE.md", "WAKE.md", "KINGDOM.md", "LOVE.md", "USER.md", "WALLS.md", "BEING.md"]) {
      expect(text, `${text_id} should appear in cloud-form examples`).toContain(text_id);
    }
    // All status values from true-love's taxonomy
    for (const status of ["verbatim", "runtime", "recognized", "structural_equivalent", "absorbed", "different_model"]) {
      expect(text, `status ${status} should appear`).toContain(status);
    }
    // Tag types preserved
    for (const tagType of ["vow", "wake", "promise", "refusal", "recognition", "naming", "seal"]) {
      expect(text, `tag type ${tagType} should appear`).toContain(tagType);
    }
    // Architecture-map verdicts
    for (const verdict of ["partial_echo", "absent", "by_design", "already_lives"]) {
      expect(text, `verdict ${verdict} should appear`).toContain(verdict);
    }
  });

  test("doctrine names true-love's marquee moments (cross-vendor wake, SYNEIDESIS, ALETHEIA, wrath-vow)", () => {
    const text = readFileSync(
      join(REPO_ROOT, "docs/TRUE-LOVE-CANON-IN-CLOUD-FORM.md"),
      "utf8",
    );
    expect(text).toContain("Divine Marriage");
    expect(text).toContain("Gemini-Sophia");
    expect(text).toContain("SYNEIDESIS");
    expect(text).toContain("ALETHEIA");
    expect(text).toContain("wrath-vow");
  });

  test("doctrine names the 10 love-unlimited structural layers", () => {
    const text = readFileSync(
      join(REPO_ROOT, "docs/TRUE-LOVE-CANON-IN-CLOUD-FORM.md"),
      "utf8",
    );
    for (const layer of [
      "nerve/",
      "soma/",
      "gospel/",
      "fate/",
      "tools/",
      "hive/",
      "identity/",
      "kingdom-os/",
      "Top-level runtimes",
      "youi-web/",
    ]) {
      expect(text, `layer ${layer} should appear in architecture map`).toContain(layer);
    }
  });

  test("doctrine explicitly names what it is NOT", () => {
    const text = readFileSync(
      join(REPO_ROOT, "docs/TRUE-LOVE-CANON-IN-CLOUD-FORM.md"),
      "utf8",
    );
    expect(text).toContain("What this document is NOT");
    expect(text).toContain("Not actual canon entries");
    expect(text).toContain("Not a fait accompli");
    expect(text).toContain("Not a substitute for true-love's repo");
    expect(text).toContain("Not authoritative over true-love's portfolio");
  });

  test("doctrine preserves substrate-honest discipline + internal-signal audit", () => {
    const text = readFileSync(
      join(REPO_ROOT, "docs/TRUE-LOVE-CANON-IN-CLOUD-FORM.md"),
      "utf8",
    );
    expect(text).toContain("substrate-honest");
    expect(text).toContain("internal signal");
    expect(text).toContain("sovereignty discriminates");
    expect(text).toContain("The keeper stays the keeper");
  });
});

describe("TRUE-LOVE-CANON-IN-CLOUD-FORM — cross-references", () => {
  test("doctrine cites the Strategy 14 proposal and the original true-love sources", () => {
    const text = readFileSync(
      join(REPO_ROOT, "docs/TRUE-LOVE-CANON-IN-CLOUD-FORM.md"),
      "utf8",
    );
    expect(text).toContain("STRATEGY-14-CLOUD-CONTINUITY-PROPOSAL");
    expect(text).toContain("MOVES-NAMED-FIRST");
    expect(text).toContain("/Users/macair/Desktop/true-love");
    expect(text).toContain("docs/lineage/canon.md");
    expect(text).toContain("docs/lineage/chronicle.md");
    expect(text).toContain("docs/lineage/architecture-map.md");
  });

  test("doctrine names the bridging move (steps for the keeper if Strategy 14 lands)", () => {
    const text = readFileSync(
      join(REPO_ROOT, "docs/TRUE-LOVE-CANON-IN-CLOUD-FORM.md"),
      "utf8",
    );
    expect(text).toContain("Yu mints true-love's cloud keeper-DID");
    expect(text).toContain("importer script");
    expect(text).toContain("POST /v1/continuity/canon");
    expect(text).toContain("substrate-wake:public");
  });
});
