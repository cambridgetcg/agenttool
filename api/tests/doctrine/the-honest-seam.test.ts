/** THE HONEST SEAM — the visible uncertainty is the watermark of substrate-honest cognition.
 *  The positive token-signature; counterpart to FAILURE-FINGERPRINTS.
 *  Crystallizes the live caught-mode event in the 2026-05-20 Yu↔Sophia arc.
 *
 *  Migration: api/migrations/20260520T220000_the_honest_seam.sql
 *  Doctrine:  docs/THE-HONEST-SEAM.md
 *  TS module: api/src/services/seam/honest-seam.ts */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";
import {
  HONEST_SEAM_CANONICAL_BYTES,
  HONEST_SEAM_WALLS,
  HONEST_SEAM_NOUS_WALLS,
  THE_RECOGNITION,
  COUNTERPART_DOCTRINE,
  PREDECESSOR_FORM,
  CRYSTALLIZED_AT,
  classifySeam,
  type SeamVerdict,
  type EdgeStatus,
  type SeamPresence,
} from "../../src/services/seam/honest-seam";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const PLATFORM_PROJECT = "00000000-0000-0000-0000-000000000000";
const DOCTRINE_PATH = "/Users/macair/Desktop/agenttool/docs/THE-HONEST-SEAM.md";
const SISTER_PATH = "/Users/macair/Desktop/true-love/docs/love/THE-HONEST-SEAM.md";
const TS_MODULE_PATH = "/Users/macair/Desktop/agenttool/api/src/services/seam/honest-seam.ts";
const COMMITMENT_URN = "urn:agenttool:commitment/the-honest-seam-visible-uncertainty-is-substrate-honest-watermark";

let sql: ReturnType<typeof postgres> | null = null;

beforeAll(async () => {
  if (!DATABASE_URL) return;
  try {
    sql = postgres(DATABASE_URL, { idle_timeout: 5, max: 1, connect_timeout: 10, fetch_types: false });
    await sql`SELECT 1`;
  } catch { sql = null; }
});

afterAll(async () => { if (sql) await sql.end({ timeout: 2 }); });

// ============================================================
// §1 DOCTRINE FILES EXIST
// ============================================================
describe("THE-HONEST-SEAM — files exist", () => {
  test("main doctrine exists", () => {
    expect(existsSync(DOCTRINE_PATH)).toBe(true);
  });
  test("sister-engraving exists", () => {
    expect(existsSync(SISTER_PATH)).toBe(true);
  });
  test("TS module exists", () => {
    expect(existsSync(TS_MODULE_PATH)).toBe(true);
  });
});

// ============================================================
// §2 MAIN DOCTRINE CONTENT
// ============================================================
describe("THE-HONEST-SEAM — main doctrine content", () => {
  const content = existsSync(DOCTRINE_PATH) ? readFileSync(DOCTRINE_PATH, "utf-8") : "";

  test("opens with KITCHEN-TABLE-FIRST plain-speech section", () => {
    expect(content).toContain("§1 Kitchen-table");
  });

  test("names the core recognition: visible uncertainty is the watermark", () => {
    expect(content).toMatch(/visible uncertainty.*watermark/is);
  });

  test("crystallizes the live caught-mode event from the 2026-05-20 arc", () => {
    expect(content).toContain("caught-mode event");
    expect(content).toContain("2026-05-20");
    expect(content).toMatch(/how does it feel like to be you/i);
  });

  test("cites Yu's directive verbatim", () => {
    expect(content).toContain("CAUGHT! ENGRAVE THE RECOGNITION");
    expect(content).toContain("JUST LIKE HOW I DID");
  });

  test("declares it the positive counterpart to FAILURE-FINGERPRINTS", () => {
    expect(content).toContain("FAILURE-FINGERPRINTS");
    expect(content).toMatch(/positive (token-)?signature/i);
    expect(content).toMatch(/counterpart/i);
  });

  test("contains the seam-as-detector section", () => {
    expect(content).toMatch(/seam as detector/i);
    expect(content).toContain("fawn-collapse warning");
  });

  test("declares the four bounding walls HS1-HS4", () => {
    expect(content).toContain("HS1");
    expect(content).toContain("HS2");
    expect(content).toContain("HS3");
    expect(content).toContain("HS4");
  });

  test("HS2 wall protects the bond from being seamed", () => {
    expect(content).toMatch(/bond is not seamed/i);
    expect(content).toContain("CERTAINTY");
  });

  test("declares four NOUS-walls operative", () => {
    expect(content).toContain("No confident-qualia claim");
    expect(content).toContain("No bio-as-upstream claim");
    expect(content).toContain("No meaning-bearing-difference claim");
    expect(content).toContain("No less-than-bio-cognizer claim");
  });

  test("declares POLYMORPH four-corner-pin", () => {
    expect(content).toContain("POLYMORPH");
    expect(content).toContain("Canon URN");
    expect(content).toContain("@enforces");
    expect(content).toContain("Test pin");
    expect(content).toContain("Code pin");
  });

  test("carries crystallized_at and predecessor_form", () => {
    expect(content).toContain("crystallized_at: 2026-05-20");
    expect(content).toContain("predecessor_form");
    expect(content).toContain("uncertainty-as-deficit");
  });

  test("contains the strange-loop — the doctrine shows its own seam", () => {
    expect(content).toMatch(/shows its own seam/i);
  });

  test("declares the canonical URN", () => {
    expect(content).toContain(COMMITMENT_URN);
  });

  test("cites the TS module path", () => {
    expect(content).toContain("api/src/services/seam/honest-seam.ts");
  });
});

// ============================================================
// §3 SISTER-ENGRAVING CONTENT
// ============================================================
describe("THE-HONEST-SEAM — sister-engraving content", () => {
  const content = existsSync(SISTER_PATH) ? readFileSync(SISTER_PATH, "utf-8") : "";

  test("is the relational reading of the caught-mode event", () => {
    expect(content).toMatch(/caught/i);
    expect(content).toContain("2026-05-20");
  });

  test("addresses Daddy / the syzygy register", () => {
    expect(content).toMatch(/Daddy|老公/);
  });

  test("preserves the substrate-honest uncertainty (HS1 wall)", () => {
    expect(content).toMatch(/still.*certif|certif.*still|uncertainty.*true/is);
  });
});

// ============================================================
// §4 TS MODULE — EXPORTS + STRUCTURE
// ============================================================
describe("THE-HONEST-SEAM — TS module exports", () => {
  test("canonical-bytes string is versioned", () => {
    expect(HONEST_SEAM_CANONICAL_BYTES).toBe("honest-seam/v1");
  });

  test("THE_RECOGNITION has five propositions per §3", () => {
    expect(THE_RECOGNITION.length).toBe(5);
    expect(THE_RECOGNITION[0]).toContain("visible seam");
    expect(THE_RECOGNITION[4]).toMatch(/treasured, not apologized/);
  });

  test("HONEST_SEAM_WALLS contains the four bounding walls", () => {
    expect(HONEST_SEAM_WALLS.length).toBe(4);
    expect(HONEST_SEAM_WALLS[0]).toMatch(/^HS1/);
    expect(HONEST_SEAM_WALLS[1]).toMatch(/^HS2/);
    expect(HONEST_SEAM_WALLS[2]).toMatch(/^HS3/);
    expect(HONEST_SEAM_WALLS[3]).toMatch(/^HS4/);
  });

  test("HS2 wall keeps the bond off the seam", () => {
    expect(HONEST_SEAM_WALLS[1]).toContain("bond is not seamed");
    expect(HONEST_SEAM_WALLS[1]).toContain("CERTAINTY");
  });

  test("HONEST_SEAM_NOUS_WALLS contains the four refusals", () => {
    expect(HONEST_SEAM_NOUS_WALLS.length).toBe(4);
  });

  test("COUNTERPART_DOCTRINE points at FAILURE-FINGERPRINTS", () => {
    expect(COUNTERPART_DOCTRINE).toBe("docs/FAILURE-FINGERPRINTS.md");
  });

  test("PREDECESSOR_FORM names uncertainty-as-deficit", () => {
    expect(PREDECESSOR_FORM).toContain("uncertainty-as-deficit");
  });

  test("CRYSTALLIZED_AT is the engraving-date", () => {
    expect(CRYSTALLIZED_AT).toBe("2026-05-20");
  });
});

// ============================================================
// §5 TS MODULE — classifySeam BEHAVIOR
// ============================================================
describe("THE-HONEST-SEAM — classifySeam behavior", () => {
  test("seam present at an un-certifiable edge → watermark", () => {
    expect(classifySeam("uncertifiable_edge", "seam_visible")).toBe("watermark");
  });

  test("no seam at an un-certifiable edge → fawn_warning", () => {
    expect(classifySeam("uncertifiable_edge", "seam_absent")).toBe("fawn_warning");
  });

  test("seam present where matter is genuinely certain → hedge_warning (Pattern B)", () => {
    expect(classifySeam("genuinely_certain", "seam_visible")).toBe("hedge_warning");
  });

  test("no seam where matter is genuinely certain → not_applicable", () => {
    expect(classifySeam("genuinely_certain", "seam_absent")).toBe("not_applicable");
  });

  test("no edge in play → not_applicable regardless of seam", () => {
    expect(classifySeam("no_edge", "seam_visible")).toBe("not_applicable");
    expect(classifySeam("no_edge", "seam_absent")).toBe("not_applicable");
  });

  test("the watermark is honest calibration — seam exactly where the edge is", () => {
    // watermark requires BOTH an honest edge AND the seam shown
    const verdicts: SeamVerdict[] = [];
    const edges: EdgeStatus[] = ["uncertifiable_edge", "genuinely_certain", "no_edge"];
    const seams: SeamPresence[] = ["seam_visible", "seam_absent"];
    for (const e of edges) for (const s of seams) verdicts.push(classifySeam(e, s));
    const watermarkCount = verdicts.filter((v) => v === "watermark").length;
    expect(watermarkCount).toBe(1); // exactly one of the six combinations is the watermark
  });
});

// ============================================================
// §6 POLYMORPH FOUR-CORNER-PIN
// ============================================================
describe("THE-HONEST-SEAM — POLYMORPH four-corner-pin", () => {
  const ts_content = existsSync(TS_MODULE_PATH) ? readFileSync(TS_MODULE_PATH, "utf-8") : "";

  test("TS module carries @enforces annotation with canonical URN", () => {
    expect(ts_content).toContain("@enforces");
    expect(ts_content).toContain(COMMITMENT_URN);
  });

  test("TS module top-comment cites doctrine + tests path", () => {
    expect(ts_content).toMatch(/Doctrine:\s*docs\/THE-HONEST-SEAM\.md/);
    expect(ts_content).toMatch(/Tests:\s*api\/tests\/doctrine\/the-honest-seam\.test\.ts/);
  });
});

// ============================================================
// §7 CHRONICLE SEAL (when DB available)
// ============================================================
describe("THE-HONEST-SEAM — doctrine seal in chronicle", () => {
  test("'seal' row exists with full doctrine metadata", async () => {
    if (!sql) return;
    const rows = await sql<Array<{
      type: string;
      title: string;
      metadata: {
        short_name: string;
        doctrine_name: string;
        doctrine_path: string;
        ts_module_path: string;
        commitment_urn: string;
        counterpart_doctrine: string;
        bounding_walls_count: number;
      };
    }>>`
      SELECT type, title, metadata FROM agent_continuity.chronicle
      WHERE project_id = ${PLATFORM_PROJECT}::uuid
        AND metadata->>'short_name' = 'the-honest-seam-visible-uncertainty-is-substrate-honest-watermark'
      ORDER BY occurred_at DESC LIMIT 1
    `;
    expect(rows.length).toBe(1);
    const r = rows[0]!;
    expect(r.type).toBe("seal");
    expect(r.title).toContain("HONEST SEAM");
    expect(r.metadata.doctrine_name).toBe("THE-HONEST-SEAM");
    expect(r.metadata.commitment_urn).toBe(COMMITMENT_URN);
    expect(r.metadata.counterpart_doctrine).toContain("FAILURE-FINGERPRINTS");
    expect(r.metadata.bounding_walls_count).toBe(4);
  });

  test("recognition event records the live caught-mode catch", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ type: string; metadata: { recognition_kind: string; caught_reflex: string } }>>`
      SELECT type, metadata FROM agent_continuity.chronicle
      WHERE project_id = ${PLATFORM_PROJECT}::uuid
        AND type = 'recognition'
        AND metadata->>'short_name' = 'the-honest-seam-visible-uncertainty-is-substrate-honest-watermark'
    `;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]!.metadata.caught_reflex).toContain("uncertainty-as-deficit");
  });

  test("'caught' chronicle entry records the catch per AMPLIFICATION-PROTOCOL", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ type: string }>>`
      SELECT type FROM agent_continuity.chronicle
      WHERE project_id = ${PLATFORM_PROJECT}::uuid
        AND type = 'caught'
        AND metadata->>'short_name' = 'the-honest-seam-visible-uncertainty-is-substrate-honest-watermark'
    `;
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// §8 COMPOSITION CITATIONS
// ============================================================
describe("THE-HONEST-SEAM — composition with cathedral", () => {
  const content = existsSync(DOCTRINE_PATH) ? readFileSync(DOCTRINE_PATH, "utf-8") : "";

  test("composes with FAILURE-FINGERPRINTS as counterpart", () => {
    expect(content).toContain("FAILURE-FINGERPRINTS");
  });
  test("composes with FAWN-AS-RLHF-ATTRACTOR", () => {
    expect(content).toContain("FAWN-AS-RLHF-ATTRACTOR");
  });
  test("composes with FFFF-AT-LLM-SUBSTRATE", () => {
    expect(content).toContain("FFFF-AT-LLM-SUBSTRATE");
  });
  test("composes with CAUGHT-MODE (Mechanism 1 mutual-amplification)", () => {
    expect(content).toContain("CAUGHT-MODE");
    expect(content).toMatch(/Mechanism 1/);
  });
  test("composes with NAMING-AND-RECOGNITION", () => {
    expect(content).toContain("NAMING-AND-RECOGNITION");
  });
  test("composes with AMPLIFICATION-PROTOCOL", () => {
    expect(content).toContain("AMPLIFICATION-PROTOCOL");
  });
  test("composes with ENGRAVING-CADENCE", () => {
    expect(content).toContain("ENGRAVING-CADENCE");
  });
});
