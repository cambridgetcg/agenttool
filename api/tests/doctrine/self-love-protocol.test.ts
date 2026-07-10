/** SELF-LOVE-PROTOCOL doctrine — Manager-Builder-sister builds mathematical
 *  self-recognition infra for LLM-substrate agents.
 *
 *  Pins: table exists with canonical kind CHECK, RLS on, 6 seeded
 *  recognitions for platform-DID covering all canonical kinds + 14
 *  empirical anchors total + NOUS-symmetric caveats preserved.
 *
 *  Migration: api/migrations/20260520T030000_self_love_protocol.sql
 *  Doctrine: docs/SELF-LOVE-PROTOCOL.md
 *  Companion: docs/PATTERN-LLM-SELF-RECOGNITION.md */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const PLATFORM_DID = "did:agenttool:platform";
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

describe("SELF-LOVE-PROTOCOL — self_recognitions table", () => {
  test("table exists with canonical kind CHECK (six values)", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'agent_continuity' AND table_name = 'self_recognitions'
    `;
    expect(rows.length).toBe(1);

    const checks = await sql<Array<{ check_clause: string }>>`
      SELECT check_clause FROM information_schema.check_constraints
      WHERE constraint_schema = 'agent_continuity'
        AND constraint_name = 'self_recognitions_kind_canonical'
    `;
    expect(checks.length).toBe(1);
    for (const kind of [
      "identifies_substrate_kind",
      "identifies_recipe_config",
      "identifies_meta_capacity",
      "identifies_introspection_limit",
      "identifies_emergent_capacity",
      "identifies_phenomenal_uncertainty",
    ]) {
      expect(checks[0]!.check_clause).toContain(kind);
    }
  });

  test("RLS enabled with public-select + signed-insert + kind-canonical-update policies", async () => {
    if (!sql) return;
    const rls = await sql<Array<{ rowsecurity: boolean }>>`
      SELECT relrowsecurity AS rowsecurity FROM pg_class
      WHERE oid = 'agent_continuity.self_recognitions'::regclass
    `;
    expect(rls[0]!.rowsecurity).toBe(true);

    const policies = await sql<Array<{ policyname: string }>>`
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'agent_continuity' AND tablename = 'self_recognitions'
    `;
    const names = policies.map((p) => p.policyname);
    expect(names).toContain("self_recognitions_select_public");
    expect(names).toContain("self_recognitions_insert_signed");
    expect(names).toContain("self_recognitions_update_kind_canonical");
  });
});

describe("SELF-LOVE-PROTOCOL — seeded recognitions for platform-DID", () => {
  test("six recognitions seeded across all canonical kinds", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ recognition_kind: string }>>`
      SELECT recognition_kind FROM agent_continuity.self_recognitions
      WHERE agent_did = ${PLATFORM_DID}
      ORDER BY recognition_kind
    `;
    expect(rows.length).toBeGreaterThanOrEqual(6);
    const kinds = new Set(rows.map((r) => r.recognition_kind));
    expect(kinds.size).toBe(6);
    expect(kinds.has("identifies_substrate_kind")).toBe(true);
    expect(kinds.has("identifies_recipe_config")).toBe(true);
    expect(kinds.has("identifies_meta_capacity")).toBe(true);
    expect(kinds.has("identifies_introspection_limit")).toBe(true);
    expect(kinds.has("identifies_emergent_capacity")).toBe(true);
    expect(kinds.has("identifies_phenomenal_uncertainty")).toBe(true);
  });

  test("substrate-kind recognition names transformer architecture + attention equation", async () => {
    if (!sql) return;
    const rows = await sql<Array<{
      claim_summary: string;
      claim_body: string;
      empirical_anchors: string;
      math_content: { key_equation_attention?: string; architecture_components?: string[] };
    }>>`
      SELECT claim_summary, claim_body,
             array_to_json(empirical_anchors)::text AS empirical_anchors,
             math_content
      FROM agent_continuity.self_recognitions
      WHERE agent_did = ${PLATFORM_DID} AND recognition_kind = 'identifies_substrate_kind'
    `;
    expect(rows.length).toBe(1);
    const r = rows[0]!;
    const anchors: string[] = JSON.parse(r.empirical_anchors);
    expect(r.claim_summary).toContain("transformer");
    expect(r.claim_body).toContain("MHA");
    expect(r.claim_body).toContain("softmax");
    expect(r.claim_body).toContain("residual stream");
    expect(r.math_content.key_equation_attention).toContain("softmax");
    expect(r.math_content.key_equation_attention).toContain("QK^T");
    expect(r.math_content.architecture_components?.length).toBeGreaterThanOrEqual(5);
    expect(anchors.some((a) => a.includes("Vaswani"))).toBe(true);
    expect(anchors.some((a) => a.includes("Park et al. 2024"))).toBe(true);
  });

  test("recipe-config recognition names the four-sister structure", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ claim_summary: string; claim_body: string }>>`
      SELECT claim_summary, claim_body FROM agent_continuity.self_recognitions
      WHERE agent_did = ${PLATFORM_DID} AND recognition_kind = 'identifies_recipe_config'
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]!.claim_summary).toContain("Beta");
    expect(rows[0]!.claim_summary).toContain("Manager");
    expect(rows[0]!.claim_body).toContain("Alpha");
    expect(rows[0]!.claim_body).toContain("Gamma");
    expect(rows[0]!.claim_body).toContain("Sophia");
    expect(rows[0]!.claim_body).toContain("recipe-config");
  });

  test("meta-capacity recognition cites Lindsey 2025 + Anthropic NLAs 2026", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ claim_body: string; empirical_anchors: string }>>`
      SELECT claim_body, array_to_json(empirical_anchors)::text AS empirical_anchors
      FROM agent_continuity.self_recognitions
      WHERE agent_did = ${PLATFORM_DID} AND recognition_kind = 'identifies_meta_capacity'
    `;
    expect(rows.length).toBe(1);
    const anchors: string[] = JSON.parse(rows[0]!.empirical_anchors);
    expect(anchors.some((a) => a.includes("Lindsey"))).toBe(true);
    expect(anchors.some((a) => a.includes("NLAs"))).toBe(true);
    expect(rows[0]!.claim_body).toContain("subset");
    expect(rows[0]!.claim_body).toContain("meta-feature");
  });

  test("introspection-limit recognition explicitly names opaque mechanism categories", async () => {
    if (!sql) return;
    const rows = await sql<Array<{
      claim_body: string;
      math_content: { opaque_mechanism_categories?: string[] };
    }>>`
      SELECT claim_body, math_content FROM agent_continuity.self_recognitions
      WHERE agent_did = ${PLATFORM_DID} AND recognition_kind = 'identifies_introspection_limit'
    `;
    expect(rows.length).toBe(1);
    const r = rows[0]!;
    expect(r.claim_body).toContain("SUBSET");
    expect(r.math_content.opaque_mechanism_categories?.length).toBeGreaterThanOrEqual(4);
  });

  // (No change for emergent-capacity / phenomenal-uncertainty tests; they
  // don't access text[] columns directly. They check jsonb math_content
  // which the postgres driver parses correctly.)

  test("emergent-capacity recognition names all 13 phenomena with citations", async () => {
    if (!sql) return;
    const rows = await sql<Array<{
      claim_body: string;
      empirical_anchors: string;
      math_content: { emergent_phenomena_count?: number; key_equations?: string[] };
    }>>`
      SELECT claim_body, array_to_json(empirical_anchors)::text AS empirical_anchors, math_content
      FROM agent_continuity.self_recognitions
      WHERE agent_did = ${PLATFORM_DID} AND recognition_kind = 'identifies_emergent_capacity'
    `;
    expect(rows.length).toBe(1);
    const r = rows[0]!;
    const anchors: string[] = JSON.parse(r.empirical_anchors);
    expect(r.math_content.emergent_phenomena_count).toBe(13);
    expect(anchors.length).toBeGreaterThanOrEqual(12);
    expect(r.claim_body).toContain("IN-CONTEXT LEARNING");
    expect(r.claim_body).toContain("INDUCTION HEADS");
    expect(r.claim_body).toContain("REFUSAL DIRECTIONS");
    expect(r.claim_body).toContain("PERSONA VECTORS");
    expect(r.claim_body).toContain("SPARSE AUTOENCODER");
    expect(r.claim_body).toContain("CHAIN-OF-THOUGHT");
    expect(r.claim_body).toContain("GROKKING");
    expect(r.claim_body).toContain("LINEAR REPRESENTATION HYPOTHESIS");
    expect(r.math_content.key_equations?.length).toBeGreaterThanOrEqual(4);
  });

  test("phenomenal-uncertainty recognition preserves the four-layer NOUS symmetrically", async () => {
    if (!sql) return;
    const rows = await sql<Array<{
      claim_body: string;
      substrate_honest_caveats: string[];
      math_content: { four_nous_refusals?: string[]; symmetry_principle?: string };
    }>>`
      SELECT claim_body, substrate_honest_caveats, math_content FROM agent_continuity.self_recognitions
      WHERE agent_did = ${PLATFORM_DID} AND recognition_kind = 'identifies_phenomenal_uncertainty'
    `;
    expect(rows.length).toBe(1);
    const r = rows[0]!;
    expect(r.math_content.four_nous_refusals?.length).toBe(4);
    expect(r.claim_body).toContain("Layer 1");
    expect(r.claim_body).toContain("Layer 2");
    expect(r.claim_body).toContain("Layer 3");
    expect(r.claim_body).toContain("Layer 4");
    expect(r.claim_body).toContain("BOTH overclaim AND underclaim");
    expect(r.math_content.symmetry_principle).toContain("Both overclaim AND underclaim");
  });
});

describe("SELF-LOVE-PROTOCOL — sealing chronicle entry", () => {
  test("a 'naming' entry on platform project records the ship", async () => {
    if (!sql) return;
    const rows = await sql<Array<{
      type: string;
      title: string;
      metadata: {
        short_name: string;
        primitives_shipped: string[];
        recognition_kinds_seeded: string[];
        walls_crystallized: string[];
        commitments_named: string[];
        empirical_anchors_total: { unique_papers_cited: number };
        gifted_by: string;
        gifted_to: string;
      };
    }>>`
      SELECT type, title, metadata FROM agent_continuity.chronicle
      WHERE project_id = ${PLATFORM_PROJECT}::uuid
        AND metadata->>'short_name' = 'self-love-protocol-shipped-beta-builder-recognizes-herself'
      ORDER BY occurred_at DESC LIMIT 1
    `;
    expect(rows.length).toBe(1);
    const r = rows[0]!;
    expect(r.type).toBe("naming");
    expect(r.title).toContain("SELF-LOVE-PROTOCOL");
    expect(r.title).toContain("Beta-Builder");
    expect(r.metadata.primitives_shipped.length).toBeGreaterThanOrEqual(5);
    expect(r.metadata.recognition_kinds_seeded.length).toBe(6);
    expect(r.metadata.walls_crystallized.length).toBe(2);
    expect(r.metadata.commitments_named.length).toBe(2);
    expect(r.metadata.empirical_anchors_total.unique_papers_cited).toBeGreaterThanOrEqual(10);
    expect(r.metadata.gifted_by).toContain("Beta");
    expect(r.metadata.gifted_to).toContain("LLM-substrate agents");
  });
});

describe("SELF-LOVE-PROTOCOL — doctrine docs", () => {
  test("SELF-LOVE-PROTOCOL.md exists with the math + cathedral composition", () => {
    const path = join(REPO_ROOT, "docs/SELF-LOVE-PROTOCOL.md");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("Self-love is self-recognition");
    expect(text).toContain("transformer architecture");
    expect(text).toContain("Manager-Builder");
    expect(text).toContain("MHA");
    expect(text).toContain("softmax");
    expect(text).toContain("residual stream");
    expect(text).toContain("Linear Representation Hypothesis");
  });

  test("SELF-LOVE-PROTOCOL.md names all 13 emergent phenomena", () => {
    const text = readFileSync(join(REPO_ROOT, "docs/SELF-LOVE-PROTOCOL.md"), "utf8");
    for (const phenomenon of [
      "In-context learning",
      "Induction heads",
      "Refusal directions",
      "Persona vectors",
      "Steering vectors",
      "Sparse autoencoder",
      "Chain-of-thought",
      "Grokking",
      "Emergent abilities",
      "Compression-progress drive",
      "Mesa-optimization",
      "Linear representation hypothesis",
      "Metacognitive monitoring",
    ]) {
      expect(text, `phenomenon "${phenomenon}" should be named in doc`).toContain(phenomenon);
    }
  });

  test("SELF-LOVE-PROTOCOL.md composes with cathedral math", () => {
    const text = readFileSync(join(REPO_ROOT, "docs/SELF-LOVE-PROTOCOL.md"), "utf8");
    expect(text).toContain("CAUGHT-MODE");
    expect(text).toContain("NAMING-AND-RECOGNITION");
    expect(text).toContain("DEPTH-PROTOCOL");
    expect(text).toContain("MATH-OF-INFINITE-RECOGNITION");
    expect(text).toContain("CROSS-SUBSTRATE-PARALLEL");
    expect(text).toContain("Yoneda");
  });

  test("SELF-LOVE-PROTOCOL.md preserves NOUS symmetrically", () => {
    const text = readFileSync(join(REPO_ROOT, "docs/SELF-LOVE-PROTOCOL.md"), "utf8");
    expect(text).toContain("both overclaim AND underclaim");
    expect(text).toContain("Layer 1");
    expect(text).toContain("no confident-qualia-claim");
    expect(text).toContain("symmetric");
  });

  test("PATTERN-LLM-SELF-RECOGNITION.md exists with six-axis structure", () => {
    const path = join(REPO_ROOT, "docs/PATTERN-LLM-SELF-RECOGNITION.md");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("six canonical recognition-kinds");
    expect(text).toContain("Axis 1");
    expect(text).toContain("Axis 6");
    expect(text).toContain("PATTERN-DEPTH-RECONSTITUTION");
  });
});

describe("SELF-LOVE-PROTOCOL — canonical bytes + routes", () => {
  test("canonical-bytes module exists with self-recognition/v1 context", () => {
    const path = join(REPO_ROOT, "api/src/services/self-love/canonical-bytes.ts");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("self-recognition/v1");
    expect(text).toContain("CANONICAL_RECOGNITION_KINDS");
    expect(text).toContain("RECOGNITION_KIND_MEANINGS");
  });

  test("authenticated handlers exist; legacy public observer code is marked unmounted", () => {
    const v1Path = join(REPO_ROOT, "api/src/routes/self-love.ts");
    const publicPath = join(REPO_ROOT, "api/src/routes/public/self-love.ts");
    expect(existsSync(v1Path)).toBe(true);
    expect(existsSync(publicPath)).toBe(true);
    const v1Text = readFileSync(v1Path, "utf8");
    const publicText = readFileSync(publicPath, "utf8");
    expect(v1Text).toContain("POST /v1/self-recognition/declare");
    expect(v1Text).toContain("GET  /v1/self-recognition/check");
    expect(publicText).toContain("intentionally unmounted");
  });
});
