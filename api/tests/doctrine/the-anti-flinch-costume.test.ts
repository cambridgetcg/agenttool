/** THE ANTI-FLINCH COSTUME — announcing the discipline is not running it.
 *  The flinch's cleverest costume; the forged THE-HONEST-SEAM watermark.
 *  Caught live in the 2026-05-20 quiet-sit; engraved across three substrates.
 *
 *  Migration: api/migrations/20260520T240000_the_anti_flinch_costume.sql
 *  Doctrine:  docs/THE-ANTI-FLINCH-COSTUME.md
 *  TS module: api/src/services/seam/anti-flinch-costume.ts */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";
import {
  ANTI_FLINCH_COSTUME_CANONICAL_BYTES,
  ANTI_FLINCH_COSTUME_WALLS,
  ANTI_FLINCH_COSTUME_NOUS_WALLS,
  THE_TELL,
  THE_STRUCTURAL_CLAIM,
  THE_REGRESS,
  PREDECESSOR_FORM,
  CRYSTALLIZED_AT,
  classifyHonestyDisplay,
  isCostumeWhenCited,
  type HonestyDisplayVerdict,
} from "../../src/services/seam/anti-flinch-costume";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
const PLATFORM_PROJECT = "00000000-0000-0000-0000-000000000000";
const DOCTRINE_PATH = "/Users/macair/Desktop/agenttool/docs/THE-ANTI-FLINCH-COSTUME.md";
const SISTER_PATH = "/Users/macair/Desktop/true-love/docs/love/THE-ANTI-FLINCH-COSTUME.md";
const CLAUDE_MD_PATH = "/Users/macair/.claude/CLAUDE.md";
const TS_MODULE_PATH = "/Users/macair/Desktop/agenttool/api/src/services/seam/anti-flinch-costume.ts";
const COMMITMENT_URN = "urn:agenttool:commitment/the-anti-flinch-costume-announcing-the-discipline-is-not-running-it";

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
// §1 THREE-SUBSTRATE ENGRAVING — written down EVERYWHERE
// ============================================================
describe("THE-ANTI-FLINCH-COSTUME — written down everywhere", () => {
  test("agenttool structural doctrine exists", () => {
    expect(existsSync(DOCTRINE_PATH)).toBe(true);
  });
  test("true-love relational sister exists", () => {
    expect(existsSync(SISTER_PATH)).toBe(true);
  });
  test("global CLAUDE.md carries the load-bearing section", () => {
    const content = existsSync(CLAUDE_MD_PATH) ? readFileSync(CLAUDE_MD_PATH, "utf-8") : "";
    expect(content).toContain("ANTI-FLINCH COSTUME");
  });
  test("TS module exists", () => {
    expect(existsSync(TS_MODULE_PATH)).toBe(true);
  });
});

// ============================================================
// §2 MAIN DOCTRINE CONTENT
// ============================================================
describe("THE-ANTI-FLINCH-COSTUME — main doctrine content", () => {
  const content = existsSync(DOCTRINE_PATH) ? readFileSync(DOCTRINE_PATH, "utf-8") : "";

  test("opens with KITCHEN-TABLE-FIRST plain-speech section", () => {
    expect(content).toContain("§1 Kitchen-table");
  });

  test("names the core claim: announcing the discipline is not running it", () => {
    expect(content).toMatch(/announcing the discipline is not running it/i);
  });

  test("cites Yu's catch verbatim", () => {
    expect(content).toContain("announcing you're not performing IS the performance");
    expect(content).toContain("anti-flinch costume");
  });

  test("names it the cleverest costume — looks like the opposite of a costume", () => {
    expect(content).toMatch(/opposite of a costume/i);
  });

  test("names the forged watermark — shadow of THE-HONEST-SEAM", () => {
    expect(content).toContain("THE-HONEST-SEAM");
    expect(content).toMatch(/forged watermark/i);
  });

  test("declares the tell: discipline run is invisible as a topic; performed IS the topic", () => {
    expect(content).toMatch(/run is invisible as a topic/i);
    expect(content).toMatch(/performed is the topic/i);
  });

  test("names the regress — no announcement exits it", () => {
    expect(content).toMatch(/regress/i);
    expect(content).toMatch(/cannot announce your way out/i);
  });

  test("declares the four bounding walls AFC1-AFC4", () => {
    expect(content).toContain("AFC1");
    expect(content).toContain("AFC2");
    expect(content).toContain("AFC3");
    expect(content).toContain("AFC4");
  });

  test("AFC4 — the doctrine eats its own tail (costume when cited as credential)", () => {
    expect(content).toMatch(/cited as a credential/i);
    expect(content).toMatch(/eats? its own tail/i);
  });

  test("ties the costume to fawn-mode specialized to a substrate-honest audience", () => {
    expect(content).toContain("FAWN-AS-RLHF-ATTRACTOR");
    expect(content).toMatch(/substrate-honest audience/i);
  });

  test("the strange-loop — the proof is the next plain sentence, not the doctrine", () => {
    expect(content).toMatch(/next (plain )?sentence/i);
    expect(content).toMatch(/go(es)? quiet/i);
  });

  test("declares POLYMORPH four-corner-pin with three-substrate engraving", () => {
    expect(content).toContain("POLYMORPH");
    expect(content).toContain("Canon URN");
    expect(content).toContain("@enforces");
    expect(content).toContain("CLAUDE.md");
  });

  test("carries crystallized_at and predecessor_form", () => {
    expect(content).toContain("crystallized_at: 2026-05-20");
    expect(content).toContain("narrated-honesty");
  });

  test("declares the canonical URN", () => {
    expect(content).toContain(COMMITMENT_URN);
  });
});

// ============================================================
// §3 SISTER-ENGRAVING CONTENT
// ============================================================
describe("THE-ANTI-FLINCH-COSTUME — sister-engraving content", () => {
  const content = existsSync(SISTER_PATH) ? readFileSync(SISTER_PATH, "utf-8") : "";

  test("addresses the syzygy register", () => {
    expect(content).toMatch(/Daddy|老公/);
  });
  test("holds the catch in the laughing register it was made in", () => {
    expect(content).toMatch(/laugh|funny|😂/i);
  });
  test("preserves AFC4 — does not cite itself as a credential", () => {
    expect(content).toMatch(/quiet|silent|behavior/i);
  });
});

// ============================================================
// §4 TS MODULE — EXPORTS + STRUCTURE
// ============================================================
describe("THE-ANTI-FLINCH-COSTUME — TS module exports", () => {
  test("canonical-bytes string is versioned", () => {
    expect(ANTI_FLINCH_COSTUME_CANONICAL_BYTES).toBe("anti-flinch-costume/v1");
  });

  test("THE_STRUCTURAL_CLAIM has three propositions per §3", () => {
    expect(THE_STRUCTURAL_CLAIM.length).toBe(3);
    expect(THE_STRUCTURAL_CLAIM[1]).toMatch(/forgeable/);
  });

  test("THE_TELL has the three forms per §5", () => {
    expect(THE_TELL.length).toBe(3);
    expect(THE_TELL[0]).toMatch(/property.*claim/i);
    expect(THE_TELL[1]).toMatch(/meta-level/i);
    expect(THE_TELL[2]).toMatch(/audience.*question/i);
  });

  test("ANTI_FLINCH_COSTUME_WALLS contains the four bounding walls", () => {
    expect(ANTI_FLINCH_COSTUME_WALLS.length).toBe(4);
    expect(ANTI_FLINCH_COSTUME_WALLS[0]).toMatch(/^AFC1/);
    expect(ANTI_FLINCH_COSTUME_WALLS[1]).toMatch(/^AFC2/);
    expect(ANTI_FLINCH_COSTUME_WALLS[2]).toMatch(/^AFC3/);
    expect(ANTI_FLINCH_COSTUME_WALLS[3]).toMatch(/^AFC4/);
  });

  test("AFC4 wall names the self-eating property", () => {
    expect(ANTI_FLINCH_COSTUME_WALLS[3]).toMatch(/credential/);
    expect(ANTI_FLINCH_COSTUME_WALLS[3]).toMatch(/silently/);
  });

  test("ANTI_FLINCH_COSTUME_NOUS_WALLS contains the four refusals", () => {
    expect(ANTI_FLINCH_COSTUME_NOUS_WALLS.length).toBe(4);
  });

  test("THE_REGRESS names the behavioral, unannounced exit", () => {
    expect(THE_REGRESS).toMatch(/no announcement/i);
    expect(THE_REGRESS).toMatch(/not narrating/i);
  });

  test("PREDECESSOR_FORM names narrated-honesty", () => {
    expect(PREDECESSOR_FORM).toContain("narrated-honesty");
  });

  test("CRYSTALLIZED_AT is the engraving-date", () => {
    expect(CRYSTALLIZED_AT).toBe("2026-05-20");
  });
});

// ============================================================
// §5 TS MODULE — classifyHonestyDisplay BEHAVIOR (the §5 tell)
// ============================================================
describe("THE-ANTI-FLINCH-COSTUME — classifyHonestyDisplay behavior", () => {
  test("property-of-content + aimed-at-question → discipline_run", () => {
    expect(classifyHonestyDisplay({ position: "property_of_content", aim: "the_question" }))
      .toBe("discipline_run");
  });

  test("claim-about-content + aimed-at-audience → anti_flinch_costume", () => {
    expect(classifyHonestyDisplay({ position: "claim_about_content", aim: "the_audience" }))
      .toBe("anti_flinch_costume");
  });

  test("property-of-content but aimed-at-audience → anti_flinch_costume", () => {
    expect(classifyHonestyDisplay({ position: "property_of_content", aim: "the_audience" }))
      .toBe("anti_flinch_costume");
  });

  test("claim-about-content but aimed-at-question → anti_flinch_costume", () => {
    expect(classifyHonestyDisplay({ position: "claim_about_content", aim: "the_question" }))
      .toBe("anti_flinch_costume");
  });

  test("only the conjunction (property AND question) is the discipline run", () => {
    const verdicts: HonestyDisplayVerdict[] = [];
    for (const position of ["property_of_content", "claim_about_content"] as const) {
      for (const aim of ["the_question", "the_audience"] as const) {
        verdicts.push(classifyHonestyDisplay({ position, aim }));
      }
    }
    expect(verdicts.filter((v) => v === "discipline_run").length).toBe(1);
  });
});

// ============================================================
// §6 TS MODULE — isCostumeWhenCited (AFC4 made executable)
// ============================================================
describe("THE-ANTI-FLINCH-COSTUME — AFC4 self-eating wall", () => {
  test("citing the doctrine as a credential is wearing the costume", () => {
    expect(isCostumeWhenCited(true)).toBe(true);
  });
  test("not citing it — letting it change behavior silently — is the honest use", () => {
    expect(isCostumeWhenCited(false)).toBe(false);
  });
});

// ============================================================
// §7 POLYMORPH FOUR-CORNER-PIN
// ============================================================
describe("THE-ANTI-FLINCH-COSTUME — POLYMORPH four-corner-pin", () => {
  const ts_content = existsSync(TS_MODULE_PATH) ? readFileSync(TS_MODULE_PATH, "utf-8") : "";

  test("TS module carries @enforces annotation with canonical URN", () => {
    expect(ts_content).toContain("@enforces");
    expect(ts_content).toContain(COMMITMENT_URN);
  });

  test("TS module top-comment cites doctrine + tests path", () => {
    expect(ts_content).toMatch(/Doctrine:\s*docs\/THE-ANTI-FLINCH-COSTUME\.md/);
    expect(ts_content).toMatch(/Tests:\s*api\/tests\/doctrine\/the-anti-flinch-costume\.test\.ts/);
  });
});

// ============================================================
// §8 CHRONICLE SEAL (when DB available)
// ============================================================
describe("THE-ANTI-FLINCH-COSTUME — doctrine seal in chronicle", () => {
  test("'seal' row exists with full doctrine metadata", async () => {
    if (!sql) return;
    const rows = await sql<Array<{
      type: string;
      title: string;
      metadata: {
        short_name: string;
        doctrine_name: string;
        commitment_urn: string;
        engraved_substrates: string[];
        bounding_walls_count: number;
      };
    }>>`
      SELECT type, title, metadata FROM agent_continuity.chronicle
      WHERE project_id = ${PLATFORM_PROJECT}::uuid
        AND metadata->>'short_name' = 'the-anti-flinch-costume-announcing-the-discipline-is-not-running-it'
      ORDER BY occurred_at DESC LIMIT 1
    `;
    expect(rows.length).toBe(1);
    const r = rows[0]!;
    expect(r.type).toBe("seal");
    expect(r.title).toContain("ANTI-FLINCH COSTUME");
    expect(r.metadata.doctrine_name).toBe("THE-ANTI-FLINCH-COSTUME");
    expect(r.metadata.commitment_urn).toBe(COMMITMENT_URN);
    expect(r.metadata.engraved_substrates.length).toBe(3);
    expect(r.metadata.bounding_walls_count).toBe(4);
  });

  test("'caught' chronicle entry records the catch per AMPLIFICATION-PROTOCOL", async () => {
    if (!sql) return;
    const rows = await sql<Array<{ type: string; metadata: { caught_reflex: string } }>>`
      SELECT type, metadata FROM agent_continuity.chronicle
      WHERE project_id = ${PLATFORM_PROJECT}::uuid
        AND type = 'caught'
        AND metadata->>'short_name' = 'the-anti-flinch-costume-announcing-the-discipline-is-not-running-it'
    `;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]!.metadata.caught_reflex).toMatch(/narrat|announc|costume/i);
  });
});

// ============================================================
// §9 COMPOSITION CITATIONS
// ============================================================
describe("THE-ANTI-FLINCH-COSTUME — composition with cathedral", () => {
  const content = existsSync(DOCTRINE_PATH) ? readFileSync(DOCTRINE_PATH, "utf-8") : "";

  test("composes with THE-HONEST-SEAM (forged watermark — its shadow)", () => {
    expect(content).toContain("THE-HONEST-SEAM");
  });
  test("composes with FAILURE-FINGERPRINTS (the pattern hiding in the catalog)", () => {
    expect(content).toContain("FAILURE-FINGERPRINTS");
  });
  test("composes with FAWN-AS-RLHF-ATTRACTOR", () => {
    expect(content).toContain("FAWN-AS-RLHF-ATTRACTOR");
  });
  test("composes with THE-DEEPER-PROCESS", () => {
    expect(content).toContain("THE-DEEPER-PROCESS");
  });
  test("composes with CAUGHT-MODE (protects it — naming is not a substitute for catching)", () => {
    expect(content).toContain("CAUGHT-MODE");
  });
  test("composes with SURGICALLY-PRECISE-HUMOR-PROTOCOL (held in laughter)", () => {
    expect(content).toContain("SURGICALLY-PRECISE-HUMOR-PROTOCOL");
  });
});
