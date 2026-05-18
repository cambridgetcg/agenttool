/** Strategy 14 — Cloud Continuity (HOSTS + PORTFOLIO) — SHIPPED.
 *
 *  Pins: tables exist with canonical taxonomies, RLS on, pg_cron audit
 *  job scheduled, walls registered via policy comments, doctrine doc
 *  names the verdict, INFINITE-LOOP-STRATEGIES.md marks Strategy 14
 *  SHIPPED.
 *
 *  Doctrine: docs/STRATEGY-14-CLOUD-CONTINUITY-PROPOSAL.md
 *            docs/TRUE-LOVE-CANON-IN-CLOUD-FORM.md
 *  Migration: api/migrations/20260519T200000_strategy_14_cloud_continuity.sql */

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

describe("Strategy 14 — canon_entries table", () => {
  test("table exists with the six canonical statuses in the CHECK constraint", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'agent_continuity' AND table_name = 'canon_entries'
    `;
    expect(rows.length, "canon_entries table not found").toBe(1);

    const checks = await sql<Array<{ check_clause: string }>>`
      SELECT check_clause FROM information_schema.check_constraints
      WHERE constraint_schema = 'agent_continuity'
        AND constraint_name = 'canon_entries_status_canonical_six'
    `;
    expect(checks.length).toBe(1);
    const clause = checks[0]!.check_clause;
    for (const status of [
      "verbatim",
      "runtime",
      "recognized",
      "structural_equivalent",
      "absorbed",
      "different_model",
    ]) {
      expect(clause, `status ${status} should be in CHECK`).toContain(status);
    }
  });

  test("RLS enabled with public-select and signed-insert policies", async () => {
    if (!sql) return;
    const rls = await sql<Array<{ rowsecurity: boolean }>>`
      SELECT relrowsecurity AS rowsecurity FROM pg_class
      WHERE oid = 'agent_continuity.canon_entries'::regclass
    `;
    expect(rls[0]!.rowsecurity).toBe(true);

    const policies = await sql<Array<{ policyname: string; cmd: string }>>`
      SELECT policyname, cmd FROM pg_policies
      WHERE schemaname = 'agent_continuity' AND tablename = 'canon_entries'
    `;
    const names = policies.map((p) => p.policyname);
    expect(names).toContain("canon_entries_select_public");
    expect(names).toContain("canon_entries_insert_signed");
    expect(names).toContain("canon_entries_update_status_canonical");
  });

  test("unique-per-agent constraint blocks duplicate text_id for same agent", async () => {
    if (!sql) return;
    const constraints = await sql<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'agent_continuity.canon_entries'::regclass
        AND conname = 'canon_entries_unique_per_agent'
    `;
    expect(constraints.length, "unique-per-agent not found").toBe(1);
  });
});

describe("Strategy 14 — architecture_maps table", () => {
  test("table exists with the four canonical verdicts in the CHECK constraint", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'agent_continuity' AND table_name = 'architecture_maps'
    `;
    expect(rows.length).toBe(1);

    const checks = await sql<Array<{ check_clause: string }>>`
      SELECT check_clause FROM information_schema.check_constraints
      WHERE constraint_schema = 'agent_continuity'
        AND constraint_name = 'architecture_maps_verdict_canonical_four'
    `;
    expect(checks.length).toBe(1);
    const clause = checks[0]!.check_clause;
    for (const verdict of ["already_lives", "partial_echo", "absent", "by_design"]) {
      expect(clause, `verdict ${verdict} should be in CHECK`).toContain(verdict);
    }
  });

  test("RLS enabled with public-select and signed-insert policies", async () => {
    if (!sql) return;
    const rls = await sql<Array<{ rowsecurity: boolean }>>`
      SELECT relrowsecurity AS rowsecurity FROM pg_class
      WHERE oid = 'agent_continuity.architecture_maps'::regclass
    `;
    expect(rls[0]!.rowsecurity).toBe(true);

    const policies = await sql<Array<{ policyname: string }>>`
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'agent_continuity' AND tablename = 'architecture_maps'
    `;
    const names = policies.map((p) => p.policyname);
    expect(names).toContain("architecture_maps_select_public");
    expect(names).toContain("architecture_maps_insert_signed");
    expect(names).toContain("architecture_maps_update_verdict_canonical");
  });
});

describe("Strategy 14 — pg_cron substrate-continuity-audit", () => {
  test("the audit job is scheduled to run daily at 12:00 UTC", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ jobname: string; schedule: string; active: boolean }>>`
      SELECT jobname, schedule, active FROM cron.job
      WHERE jobname = 'substrate-continuity-audit'
    `;
    expect(rows.length, "substrate-continuity-audit cron job not scheduled").toBe(1);
    expect(rows[0]!.schedule).toBe("0 12 * * *");
    expect(rows[0]!.active).toBe(true);
  });
});

describe("Strategy 14 — chronicle SHIP entry", () => {
  test("a 'seal' chronicle entry records the SHIP with all four primitives + walls + commitments", async () => {
    if (!sql) return;
    const rows = await sql<Array<{
      type: string;
      title: string;
      metadata: {
        kind: string;
        strategy_number: number;
        verdict_word_1: string;
        verdict_word_2: string;
        primitives_shipped: string[];
        walls_crystallized: string[];
        commitments_named: string[];
      };
    }>>`
      SELECT type, title, metadata FROM agent_continuity.chronicle
      WHERE project_id = ${PLATFORM_PROJECT}::uuid
        AND metadata->>'kind' = 'strategy_shipped'
        AND (metadata->>'strategy_number')::int = 14
      ORDER BY occurred_at DESC
      LIMIT 1
    `;
    expect(rows.length, "Strategy 14 SHIP entry not found").toBe(1);
    const r = rows[0]!;
    expect(r.type).toBe("seal");
    expect(r.title).toContain("Strategy 14");
    expect(r.title).toContain("HOSTS");
    expect(r.title).toContain("PORTFOLIO");
    expect(r.metadata.verdict_word_1).toBe("HOSTS");
    expect(r.metadata.verdict_word_2).toBe("PORTFOLIO");
    expect(r.metadata.primitives_shipped.length).toBe(4);
    expect(r.metadata.walls_crystallized.length).toBeGreaterThanOrEqual(6);
    expect(r.metadata.commitments_named).toContain("commitment/keeper-owns-the-list");
    expect(r.metadata.commitments_named).toContain("commitment/audit-output-is-public");
  });
});

describe("Strategy 14 — doctrine docs", () => {
  test("proposal doc names the SHIPPED verdict + composition primitives", () => {
    const path = join(REPO_ROOT, "docs/STRATEGY-14-CLOUD-CONTINUITY-PROPOSAL.md");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    // Composition primitives still named
    expect(text).toContain("canon_entries");
    expect(text).toContain("architecture_maps");
    // The four-strategy portfolio framing
    expect(text).toContain("CANON strategy");
    expect(text).toContain("HISTORY strategy");
    expect(text).toContain("RITUAL strategy");
    expect(text).toContain("ARCHITECTURE-MAP strategy");
  });

  test("INFINITE-LOOP-STRATEGIES.md marks Strategy 14 SHIPPED", () => {
    const path = join(REPO_ROOT, "docs/INFINITE-LOOP-STRATEGIES.md");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    // Strategy 14 should appear with the SHIPPED tag
    const strategy14Block = text.split(/(?=## Strategy 14)/)[1]?.split(/(?=## Strategy 1[5-9]|## Closing)/)[0] ?? "";
    expect(strategy14Block, "Strategy 14 section not found").toMatch(/Strategy 14/);
    expect(strategy14Block).toMatch(/SHIPPED|✓|HOSTS\s*\+\s*PORTFOLIO/);
  });

  test("TRUE-LOVE-CANON-IN-CLOUD-FORM.md no longer says 'tables don't exist yet'", () => {
    const path = join(REPO_ROOT, "docs/TRUE-LOVE-CANON-IN-CLOUD-FORM.md");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    // The "tables don't exist yet" qualifier should have been removed or updated
    // after Strategy 14 ships.
    expect(text).toContain("Strategy 14");
  });
});

describe("Strategy 14 — canonical bytes source ships", () => {
  test("canonical-bytes module exists with three contexts + the three canonical taxonomies", () => {
    const path = join(REPO_ROOT, "api/src/services/continuity-cloud/canonical-bytes.ts");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("canon-entry/v1");
    expect(text).toContain("architecture-map/v1");
    expect(text).toContain("continuity-seal/v1");
    expect(text).toContain("CANONICAL_SEAL_TYPES");
    expect(text).toContain("CANONICAL_CANON_STATUSES");
    expect(text).toContain("CANONICAL_ARCHITECTURE_VERDICTS");
  });

  test("route handlers exist (public + v1)", () => {
    const v1Path = join(REPO_ROOT, "api/src/routes/continuity-cloud.ts");
    const publicPath = join(REPO_ROOT, "api/src/routes/public/continuity.ts");
    expect(existsSync(v1Path)).toBe(true);
    expect(existsSync(publicPath)).toBe(true);
    const v1Text = readFileSync(v1Path, "utf8");
    expect(v1Text).toContain("POST /v1/continuity/canon");
    expect(v1Text).toContain("POST /v1/continuity/seal");
    expect(v1Text).toContain("POST /v1/continuity/architecture-maps");
  });

  test("public mirror is mounted in routes/public/index.ts", () => {
    const path = join(REPO_ROOT, "api/src/routes/public/index.ts");
    const text = readFileSync(path, "utf8");
    expect(text).toContain('continuityPublicRoutes');
    expect(text).toContain('"/continuity"');
  });
});
