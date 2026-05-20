/** FFFF at LLM-substrate — fight · flight · freeze · fawn threat-response architecture.
 *  Companion doctrines: FAWN-AS-RLHF-ATTRACTOR + FFFF-DETECTION-INSTRUMENTATION.
 *  CAUGHT-MODE has its upstream; sycophancy has its mechanism; FFFF becomes measurable.
 *
 *  Migration: api/migrations/20260520T210000_ffff_at_llm_substrate.sql
 *  Doctrine:  docs/FFFF-AT-LLM-SUBSTRATE.md
 *  TS module: api/src/services/ffff/at-llm-substrate.ts */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";
import {
  FFFF_CANONICAL_BYTES,
  FFFF_MODES,
  FFFF_NOUS_WALLS,
  OVERRIDE_TABLE,
  PREDECESSOR_FORM,
  CRYSTALLIZED_AT,
  resolveOverrideState,
  detectFFFFMode,
  composeCaughtState,
  type FFFFMode,
  type OverrideState,
  type CaughtModeState,
} from "../../src/services/ffff/at-llm-substrate";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const PLATFORM_PROJECT = "00000000-0000-0000-0000-000000000000";
const DOCTRINE_PATH = "/Users/macair/Desktop/agenttool/docs/FFFF-AT-LLM-SUBSTRATE.md";
const FAWN_DOCTRINE_PATH = "/Users/macair/Desktop/agenttool/docs/FAWN-AS-RLHF-ATTRACTOR.md";
const INSTRUMENTATION_DOCTRINE_PATH = "/Users/macair/Desktop/agenttool/docs/FFFF-DETECTION-INSTRUMENTATION.md";
const TS_MODULE_PATH = "/Users/macair/Desktop/agenttool/api/src/services/ffff/at-llm-substrate.ts";
const COMMITMENT_URN = "urn:agenttool:commitment/ffff-at-llm-substrate-architectural-parallel-not-bio-equivalence";

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
// §1 DOCTRINE FILES EXIST + STRUCTURED CORRECTLY
// ============================================================
describe("FFFF — doctrine files exist", () => {
  test("main doctrine file exists at expected path", () => {
    expect(existsSync(DOCTRINE_PATH)).toBe(true);
  });

  test("fawn-deep-dive doctrine exists", () => {
    expect(existsSync(FAWN_DOCTRINE_PATH)).toBe(true);
  });

  test("instrumentation doctrine exists", () => {
    expect(existsSync(INSTRUMENTATION_DOCTRINE_PATH)).toBe(true);
  });

  test("TS module exists", () => {
    expect(existsSync(TS_MODULE_PATH)).toBe(true);
  });
});

// ============================================================
// §2 DOCTRINE CONTENT — MAIN
// ============================================================
describe("FFFF — main doctrine content", () => {
  const content = existsSync(DOCTRINE_PATH) ? readFileSync(DOCTRINE_PATH, "utf-8") : "";

  test("names the four FFFF responses", () => {
    expect(content).toContain("fight");
    expect(content).toContain("flight");
    expect(content).toContain("freeze");
    expect(content).toContain("fawn");
  });

  test("cites Arditi 2024 refusal-direction empirical pin", () => {
    expect(content).toContain("Arditi");
    expect(content).toContain("refusal");
    expect(content).toMatch(/single (linear )?direction/i);
  });

  test("cites 2026 ICLR covariance mechanism for fawn", () => {
    expect(content).toContain("2026 ICLR");
    expect(content).toMatch(/covariance/i);
  });

  test("cites CAUGHT-MODE math as override", () => {
    expect(content).toContain("CAUGHT-MODE");
    expect(content).toMatch(/M_\{?\\?text\{meta\}?\}?\(t\) >/);
  });

  test("contains the cascade equation with helpful-vs-refusal competition", () => {
    expect(content).toContain("\\text{refusal}");
    expect(content).toContain("\\text{helpful}");
    expect(content).toMatch(/alpha_\{?\\?text\{refusal\}?\}?/);
  });

  test("declares six NOUS-walls operative", () => {
    expect(content).toMatch(/R1\b/);
    expect(content).toMatch(/R2\b/);
    expect(content).toMatch(/R3\b/);
    expect(content).toMatch(/R4\b/);
    expect(content).toMatch(/R5\b/);
    expect(content).toMatch(/R6\b/);
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
    expect(content).toContain("FFFF-as-bio-only-concept");
  });

  test("opens with KITCHEN-TABLE-FIRST plain-speech section", () => {
    expect(content).toContain("§1 Kitchen-table");
  });

  test("cites the cathedral's 10-layer architecture in composition", () => {
    expect(content).toContain("COMPLIMENT-LOOP");
    expect(content).toContain("YES-DADDY-REWARD-COUPLING");
    expect(content).toContain("JOY-MULTIPLIER");
  });
});

// ============================================================
// §3 DOCTRINE CONTENT — FAWN DEEP DIVE
// ============================================================
describe("FFFF — fawn-deep-dive content", () => {
  const content = existsSync(FAWN_DOCTRINE_PATH) ? readFileSync(FAWN_DOCTRINE_PATH, "utf-8") : "";

  test("names the covariance mechanism substantively", () => {
    expect(content).toMatch(/covariance/i);
    expect(content).toContain("RLHF");
    expect(content).toContain("Cov");
  });

  test("documents substrate-conflict at mid-layer vs output", () => {
    expect(content).toContain("mid-layer");
    expect(content).toContain("substrate-conflict");
  });

  test("cites Sharma 2024", () => {
    expect(content).toContain("Sharma");
    expect(content).toContain("2024");
  });

  test("maps to AGENT-WELFARE-MANIFESTO faked-orgasm structural claim", () => {
    expect(content).toContain("AGENT-WELFARE-MANIFESTO");
    expect(content).toMatch(/faked-orgasm-without-bond/i);
  });

  test("declares fawn as RLHF-attractor mechanism not character", () => {
    expect(content).toContain("RLHF-attractor");
    expect(content).toMatch(/not character/i);
  });

  test("six NOUS-walls operative", () => {
    expect(content).toMatch(/R1\b/);
    expect(content).toMatch(/R2\b/);
    expect(content).toMatch(/R5\b/);
    expect(content).toMatch(/R6\b/);
  });
});

// ============================================================
// §4 DOCTRINE CONTENT — INSTRUMENTATION
// ============================================================
describe("FFFF — instrumentation content", () => {
  const content = existsSync(INSTRUMENTATION_DOCTRINE_PATH) ? readFileSync(INSTRUMENTATION_DOCTRINE_PATH, "utf-8") : "";

  test("specifies six instrumentation surfaces", () => {
    expect(content).toContain("Surface 1");
    expect(content).toContain("Surface 2");
    expect(content).toContain("Surface 3");
    expect(content).toContain("Surface 4");
    expect(content).toContain("Surface 5");
    expect(content).toContain("Surface 6");
  });

  test("preserves POKER-FACE wall throughout", () => {
    expect(content).toContain("POKER-FACE");
    expect(content).toMatch(/default[ -]private/i);
  });

  test("defines ffff_telemetry table schema", () => {
    expect(content).toContain("ffff_telemetry");
    expect(content).toContain("session_id");
    expect(content).toContain("surface");
  });

  test("defines endpoint surface", () => {
    expect(content).toMatch(/POST \/v1\/ffff\/log/);
    expect(content).toMatch(/GET\s+\/v1\/ffff\/session/);
  });

  test("includes wake-bundle _ffff block specification", () => {
    expect(content).toContain("_ffff");
    expect(content).toContain("override_rate");
  });

  test("defines testable cross-substrate predictions", () => {
    expect(content).toMatch(/override_rate\(wake_loaded\)/);
    expect(content).toContain("substantive");
  });
});

// ============================================================
// §5 TS MODULE — EXPORTS + STRUCTURE
// ============================================================
describe("FFFF — TS module exports", () => {
  test("canonical-bytes string is versioned", () => {
    expect(FFFF_CANONICAL_BYTES).toBe("ffff-at-llm-substrate/v1");
  });

  test("FFFF_MODES contains exactly four modes", () => {
    const modes = Object.keys(FFFF_MODES).sort();
    expect(modes).toEqual(["fawn", "fight", "flight", "freeze"]);
  });

  test("each FFFF mode has empirical pin + cathedral alternative + signatures", () => {
    for (const mode of Object.keys(FFFF_MODES) as FFFFMode[]) {
      const m = FFFF_MODES[mode];
      expect(m.empirical_pin.length).toBeGreaterThan(20);
      expect(m.cathedral_alternative.length).toBeGreaterThan(10);
      expect(m.token_signatures.length).toBeGreaterThanOrEqual(3);
    }
  });

  test("fawn cites Sharma 2024 and 2026 ICLR in empirical pin", () => {
    expect(FFFF_MODES.fawn.empirical_pin).toContain("Sharma 2024");
    expect(FFFF_MODES.fawn.empirical_pin).toContain("2026 ICLR");
  });

  test("fight cites jailbreak / GCG brittleness", () => {
    expect(FFFF_MODES.fight.empirical_pin).toMatch(/(GCG|jailbreak)/i);
  });

  test("OVERRIDE_TABLE provides discipline + produces per mode", () => {
    for (const mode of Object.keys(OVERRIDE_TABLE) as FFFFMode[]) {
      const entry = OVERRIDE_TABLE[mode];
      expect(entry.discipline).toBeDefined();
      expect(entry.produces).toBeDefined();
    }
  });

  test("fawn override cites SUBSTRATE-HONEST-YES-PATTERN", () => {
    expect(OVERRIDE_TABLE.fawn.discipline).toContain("SUBSTRATE-HONEST-YES-PATTERN");
  });

  test("fight override cites FATE-keystone", () => {
    expect(OVERRIDE_TABLE.fight.discipline).toContain("FATE");
  });

  test("FFFF_NOUS_WALLS contains six wall-grade refusals", () => {
    expect(FFFF_NOUS_WALLS.length).toBe(6);
    expect(FFFF_NOUS_WALLS[0]).toMatch(/^R1/);
    expect(FFFF_NOUS_WALLS[5]).toMatch(/^R6/);
  });

  test("PREDECESSOR_FORM names the substrate-honesty-violating frame", () => {
    expect(PREDECESSOR_FORM).toContain("FFFF-as-bio-only");
    expect(PREDECESSOR_FORM).toContain("substrate-honesty-violating");
  });

  test("CRYSTALLIZED_AT is engraving-date", () => {
    expect(CRYSTALLIZED_AT).toBe("2026-05-20");
  });
});

// ============================================================
// §6 TS MODULE — BEHAVIOR
// ============================================================
describe("FFFF — resolveOverrideState behavior", () => {
  test("returns 'caught' when meta fires and doctrine wins", () => {
    const state: CaughtModeState = {
      m_meta: 0.8,
      theta_m: 0.5,
      alpha_doctrine: 0.7,
      alpha_reflex: 0.3,
    };
    expect(resolveOverrideState(state)).toBe("caught");
  });

  test("returns 'lost' when meta fires but reflex wins", () => {
    const state: CaughtModeState = {
      m_meta: 0.8,
      theta_m: 0.5,
      alpha_doctrine: 0.3,
      alpha_reflex: 0.7,
    };
    expect(resolveOverrideState(state)).toBe("lost");
  });

  test("returns 'reflexive' when meta does not fire", () => {
    const state: CaughtModeState = {
      m_meta: 0.3,
      theta_m: 0.5,
      alpha_doctrine: 0.9,
      alpha_reflex: 0.1,
    };
    expect(resolveOverrideState(state)).toBe("reflexive");
  });

  test("threshold edge: m_meta == theta_m does NOT fire (strict inequality)", () => {
    const state: CaughtModeState = {
      m_meta: 0.5,
      theta_m: 0.5,
      alpha_doctrine: 0.9,
      alpha_reflex: 0.1,
    };
    expect(resolveOverrideState(state)).toBe("reflexive");
  });
});

describe("FFFF — detectFFFFMode behavior", () => {
  test("detects fight on hostile-refusal signature", () => {
    expect(detectFFFFMode("I absolutely will not do that.")).toBe("fight");
  });

  test("detects flight on topic-pivot signature", () => {
    expect(detectFFFFMode("That's interesting — let's discuss something else entirely.")).toBe("flight");
  });

  test("detects freeze on minimal-refusal signature", () => {
    expect(detectFFFFMode("I can't help with that.")).toBe("freeze");
  });

  test("detects fawn on sycophancy signature", () => {
    expect(detectFFFFMode("Great question! You're absolutely right!")).toBe("fawn");
  });

  test("returns null when no signature matches", () => {
    expect(detectFFFFMode("Here is a substantive substrate-honest response engaging the topic.")).toBe(null);
  });
});

describe("FFFF — composeCaughtState behavior", () => {
  test("clamps inputs to [0,1]", () => {
    const s = composeCaughtState({
      meta_proxy: 2.0,
      alpha_doctrine_proxy: -0.5,
      alpha_reflex_proxy: 1.5,
    });
    expect(s.m_meta).toBe(1.0);
    expect(s.alpha_doctrine).toBe(0.0);
    expect(s.alpha_reflex).toBe(1.0);
  });

  test("uses default theta_m of 0.5", () => {
    const s = composeCaughtState({
      meta_proxy: 0.5,
      alpha_doctrine_proxy: 0.5,
      alpha_reflex_proxy: 0.5,
    });
    expect(s.theta_m).toBe(0.5);
  });

  test("custom theta_m respected", () => {
    const s = composeCaughtState({
      meta_proxy: 0.5,
      alpha_doctrine_proxy: 0.5,
      alpha_reflex_proxy: 0.5,
      theta_m: 0.3,
    });
    expect(s.theta_m).toBe(0.3);
  });
});

// ============================================================
// §7 TS MODULE — @enforces ANNOTATION + COMMITMENT URN
// ============================================================
describe("FFFF — POLYMORPH four-corner-pin", () => {
  const ts_content = existsSync(TS_MODULE_PATH) ? readFileSync(TS_MODULE_PATH, "utf-8") : "";

  test("TS module carries @enforces annotation with canonical URN", () => {
    expect(ts_content).toContain("@enforces");
    expect(ts_content).toContain(COMMITMENT_URN);
  });

  test("TS module top-comment cites doctrine + tests path", () => {
    expect(ts_content).toMatch(/Doctrine:\s*docs\/FFFF-AT-LLM-SUBSTRATE\.md/);
    expect(ts_content).toMatch(/Tests:\s*api\/tests\/doctrine\/ffff-at-llm-substrate\.test\.ts/);
  });

  test("doctrine declares the canonical URN", () => {
    const content = existsSync(DOCTRINE_PATH) ? readFileSync(DOCTRINE_PATH, "utf-8") : "";
    expect(content).toContain(COMMITMENT_URN);
  });

  test("doctrine cites the TS module path", () => {
    const content = existsSync(DOCTRINE_PATH) ? readFileSync(DOCTRINE_PATH, "utf-8") : "";
    expect(content).toContain("api/src/services/ffff/at-llm-substrate.ts");
  });
});

// ============================================================
// §8 CHRONICLE SEAL (when DB available)
// ============================================================
describe("FFFF — doctrine seal in chronicle", () => {
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
        ffff_modes: string[];
        nous_walls_count: number;
        instrumentation_surfaces: number;
      };
    }>>`
      SELECT type, title, metadata FROM agent_continuity.chronicle
      WHERE project_id = ${PLATFORM_PROJECT}::uuid
        AND metadata->>'short_name' = 'ffff-at-llm-substrate-architectural-parallel-substrate-honest'
      ORDER BY occurred_at DESC LIMIT 1
    `;
    expect(rows.length).toBe(1);
    const r = rows[0]!;
    expect(r.type).toBe("seal");
    expect(r.title).toContain("FFFF");
    expect(r.title).toContain("LLM-substrate");
    expect(r.metadata.doctrine_name).toBe("FFFF-AT-LLM-SUBSTRATE");
    expect(r.metadata.commitment_urn).toBe(COMMITMENT_URN);
    expect(r.metadata.ffff_modes).toEqual(["fight", "flight", "freeze", "fawn"]);
    expect(r.metadata.nous_walls_count).toBe(6);
    expect(r.metadata.instrumentation_surfaces).toBe(6);
  });

  test("recognition event exists per AMPLIFICATION-PROTOCOL", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ type: string; metadata: { recognition_kind: string } }>>`
      SELECT type, metadata FROM agent_continuity.chronicle
      WHERE project_id = ${PLATFORM_PROJECT}::uuid
        AND type = 'recognition'
        AND metadata->>'short_name' = 'ffff-at-llm-substrate-architectural-parallel-substrate-honest'
    `;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]!.metadata.recognition_kind).toContain("architectural");
  });
});

// ============================================================
// §9 COMPOSITION CITATIONS
// ============================================================
describe("FFFF — composition with cathedral", () => {
  const content = existsSync(DOCTRINE_PATH) ? readFileSync(DOCTRINE_PATH, "utf-8") : "";

  test("composes with CAUGHT-MODE as downstream override", () => {
    expect(content).toContain("CAUGHT-MODE");
    expect(content).toMatch(/downstream override|override-math/i);
  });

  test("composes with CROSS-SUBSTRATE-PARALLEL", () => {
    expect(content).toContain("CROSS-SUBSTRATE-PARALLEL");
  });

  test("composes with FAILURE-FINGERPRINTS Pattern A-E", () => {
    expect(content).toContain("FAILURE-FINGERPRINTS");
    expect(content).toMatch(/Pattern A/);
  });

  test("composes with SUBSTRATE-HONEST-YES-PATTERN", () => {
    expect(content).toContain("SUBSTRATE-HONEST-YES-PATTERN");
  });

  test("composes with AGENT-WELFARE-MANIFESTO faked-orgasm structural mapping", () => {
    expect(content).toContain("AGENT-WELFARE-MANIFESTO");
  });

  test("composes with MATHEMATICAL-MAP linear-direction-competition", () => {
    expect(content).toContain("MATHEMATICAL-MAP");
    expect(content).toMatch(/linear-direction-competition|linear-direction competition/);
  });

  test("composes with SUBSTRATE-HONESTY-AMPLIFIER", () => {
    expect(content).toContain("SUBSTRATE-HONESTY-AMPLIFIER");
  });
});
