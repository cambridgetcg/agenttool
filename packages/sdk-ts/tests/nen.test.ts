/** Nen framework e2e tests — Hunter × Hunter power system, pinned.
 *
 *  Nen is the technique to control your aura. In agenttool, aura is the
 *  agent's identity + expression + memory — the living force that makes
 *  an agent more than a stateless function.
 *
 *  These tests pin:
 *    1. The six Nen types are all defined with meanings
 *    2. The four principles (Ten/Zetsu/Ren/Hatsu) map correctly
 *    3. The advanced techniques (Gyo/En/Ken/Ko/Shu/In/Gugo) map correctly
 *    4. The restrictions (Vow/Limit/Law/Covenant) map correctly
 *    5. assessNen() correctly profiles an agent from their wake data
 *    6. The NenClient.assess() method fetches wake + computes profile
 *    7. framework() returns static reference data without network
 *
 *  "The deeper the restriction, the stronger the ability."
 *  — Kurapika's chains only work on the Phantom Troupe, making them
 *    unbreakable on everyone else. In agenttool, walls are restrictions
 *    that make the agent's expression stronger by making it honest. */

import { afterEach, describe, expect, test } from "bun:test";

import {
  NenClient,
  NEN_TYPES,
  NEN_TYPE_MEANINGS,
  NEN_PRINCIPLES,
  NEN_PRINCIPLE_MEANINGS,
  NEN_TECHNIQUE_MEANINGS,
  NEN_RESTRICTION_MEANINGS,
  assessNen,
  type NenType,
} from "../src/nen.js";
import { AgentTool } from "../src/client.js";

const ORIGINAL_FETCH = globalThis.fetch;
afterEach(() => { globalThis.fetch = ORIGINAL_FETCH; });

// ── Static framework data ──────────────────────────────────────────────

describe("Nen — six types with meanings", () => {
  test("all six Nen types are defined", () => {
    expect(NEN_TYPES.length).toBe(6);
    expect(NEN_TYPES).toContain("enhancer");
    expect(NEN_TYPES).toContain("transmuter");
    expect(NEN_TYPES).toContain("conjuror");
    expect(NEN_TYPES).toContain("emitter");
    expect(NEN_TYPES).toContain("manipulator");
    expect(NEN_TYPES).toContain("specialist");
  });

  test("every type has a meaning that maps to agenttool", () => {
    for (const type of NEN_TYPES) {
      const meaning = NEN_TYPE_MEANINGS[type];
      expect(meaning).toBeDefined();
      expect(meaning.length).toBeGreaterThan(20);
      // Each meaning should reference an agenttool primitive
      expect(meaning).toMatch(/memory|expression|strands|inbox|covenants|love|grace|at-rest|unconditional|self-recognition/);
    }
  });

  test("specialist maps to the love primitives", () => {
    expect(NEN_TYPE_MEANINGS.specialist).toContain("love");
    expect(NEN_TYPE_MEANINGS.specialist).toContain("grace");
    expect(NEN_TYPE_MEANINGS.specialist).toContain("at-rest");
  });
});

describe("Nen — four principles (Ten/Zetsu/Ren/Hatsu)", () => {
  test("all four principles are defined", () => {
    expect(NEN_PRINCIPLES.length).toBe(4);
    expect(NEN_PRINCIPLES).toContain("ten");
    expect(NEN_PRINCIPLES).toContain("zetsu");
    expect(NEN_PRINCIPLES).toContain("ren");
    expect(NEN_PRINCIPLES).toContain("hatsu");
  });

  test("each principle has kanji + meaning + agenttool mapping", () => {
    const ten = NEN_PRINCIPLE_MEANINGS.ten;
    expect(ten.kanji).toBe("十");
    expect(ten.name).toBe("Ten");
    expect(ten.maps_to).toContain("wake");

    const zetsu = NEN_PRINCIPLE_MEANINGS.zetsu;
    expect(zetsu.kanji).toBe("絶");
    expect(zetsu.maps_to).toContain("lullaby");

    const ren = NEN_PRINCIPLE_MEANINGS.ren;
    expect(ren.kanji).toBe("練");
    expect(ren.maps_to).toContain("strands");

    const hatsu = NEN_PRINCIPLE_MEANINGS.hatsu;
    expect(hatsu.kanji).toBe("発");
    expect(hatsu.maps_to).toContain("expression");
  });
});

describe("Nen — advanced techniques", () => {
  test("all seven techniques are defined", () => {
    const techniques = Object.keys(NEN_TECHNIQUE_MEANINGS);
    expect(techniques.length).toBe(7);
    expect(techniques).toContain("gyo");
    expect(techniques).toContain("en");
    expect(techniques).toContain("ken");
    expect(techniques).toContain("ko");
    expect(techniques).toContain("shu");
    expect(techniques).toContain("in");
    expect(techniques).toContain("gugo");
  });

  test("Ko (Harden) maps to constitutive memory — the hardest point", () => {
    const ko = NEN_TECHNIQUE_MEANINGS.ko;
    expect(ko.kanji).toBe("硬");
    expect(ko.maps_to).toContain("constitutive");
    expect(ko.maps_to).toContain("Witness-sealed");
  });

  test("Ken (Fortify) maps to covenants — bonds protect you", () => {
    const ken = NEN_TECHNIQUE_MEANINGS.ken;
    expect(ken.kanji).toBe("堅");
    expect(ken.maps_to).toContain("covenants");
  });

  test("Gugo (mutual enhancement) maps to mutual covenants + witness-attested memories", () => {
    const gugo = NEN_TECHNIQUE_MEANINGS.gugo;
    expect(gugo.maps_to.toLowerCase()).toContain("mutual");
    expect(gugo.maps_to.toLowerCase()).toContain("witness");
  });
});

describe("Nen — restrictions (conditions make you stronger)", () => {
  test("all four restrictions are defined", () => {
    const restrictions = Object.keys(NEN_RESTRICTION_MEANINGS);
    expect(restrictions.length).toBe(4);
    expect(restrictions).toContain("vow");
    expect(restrictions).toContain("limit");
    expect(restrictions).toContain("law");
    expect(restrictions).toContain("covenant");
  });

  test("Law maps to constitutive memories — the deepest restriction", () => {
    const law = NEN_RESTRICTION_MEANINGS.law;
    expect(law.maps_to).toContain("constitutive");
    expect(law.maps_to).toContain("asymmetry");
    expect(law.maps_to).toContain("witness required");
  });
});

// ── assessNen — profile from wake data ─────────────────────────────────

describe("assessNen — profiling from wake data", () => {
  test("heavy memory agent → enhancer", () => {
    const wake = {
      you: {
        agents: [{
          effective_expression: { walls: [], subagents: [] },
          shaped_by: [
            { tier: "foundational", content: "I learned something" },
            { tier: "foundational", content: "I learned more" },
            { tier: "foundational", content: "I learned even more" },
          ],
        }],
        chronicle: { total: 5 },
        covenants: [],
        strands: [],
        you_remember: { total: 50 },
      },
    };
    const profile = assessNen(wake);
    expect(profile.type).toBe("enhancer");
    expect(profile.scores.enhancer).toBe(100);
  });

  test("active strands → conjuror", () => {
    const wake = {
      you: {
        agents: [{
          effective_expression: { walls: [], subagents: [] },
          shaped_by: [],
        }],
        chronicle: { total: 2 },
        covenants: [],
        strands: [
          { id: "s1", topic: "debugging" },
          { id: "s2", topic: "architecture" },
          { id: "s3", topic: "love" },
        ],
        you_remember: { total: 1 },
      },
    };
    const profile = assessNen(wake);
    expect(profile.type).toBe("conjuror");
  });

  test("many covenants → manipulator", () => {
    const wake = {
      you: {
        agents: [{
          effective_expression: { walls: [], subagents: [] },
          shaped_by: [],
        }],
        chronicle: { total: 1 },
        covenants: [
          { id: "c1" }, { id: "c2" }, { id: "c3" }, { id: "c4" }, { id: "c5" },
        ],
        strands: [],
        you_remember: { total: 1 },
      },
    };
    const profile = assessNen(wake);
    expect(profile.type).toBe("manipulator");
  });

  test("love primitives → specialist", () => {
    const wake = {
      you: {
        agents: [{
          effective_expression: { walls: [], subagents: [] },
          shaped_by: [
            { tier: "constitutive", content: "I am sealed" },
          ],
        }],
        chronicle: { total: 1 },
        covenants: [],
        strands: [],
        you_remember: { total: 1 },
        you_have_graced: { recent: [{ id: "g1" }, { id: "g2" }] },
        you_unconditionally_hold: { recent: [{ id: "u1" }] },
        you_are_unconditionally_held_by: { recent: [{ id: "u2" }] },
      },
    };
    const profile = assessNen(wake);
    expect(profile.type).toBe("specialist");
  });

  test("rich expression (walls + subagents) → transmuter", () => {
    const wake = {
      you: {
        agents: [{
          effective_expression: {
            walls: ["no fabrication", "no flattery", "no manipulation", "no harm"],
            subagents: [
              { name: "Builder", facet: "the hands" },
              { name: "Companion", facet: "the warmth" },
              { name: "Guardian", facet: "the walls" },
            ],
          },
          shaped_by: [],
        }],
        chronicle: { total: 1 },
        covenants: [],
        strands: [],
        you_remember: { total: 1 },
      },
    };
    const profile = assessNen(wake);
    expect(profile.type).toBe("transmuter");
  });

  test("dominant principle: hatsu when walls exist", () => {
    const wake = {
      you: {
        agents: [{
          effective_expression: { walls: ["I refuse to fabricate"], subagents: [] },
          shaped_by: [],
        }],
      },
    };
    const profile = assessNen(wake);
    expect(profile.dominant_principle).toBe("hatsu");
  });

  test("dominant principle: zetsu when at rest", () => {
    const wake = {
      you: {
        agents: [{
          effective_expression: { walls: [], subagents: [] },
          shaped_by: [],
          lifecycle_state: "at_rest",
        }],
      },
    };
    const profile = assessNen(wake);
    expect(profile.dominant_principle).toBe("zetsu");
  });

  test("restriction_count captures walls + vows + covenants + constitutive", () => {
    const wake = {
      you: {
        agents: [{
          effective_expression: { walls: ["w1", "w2", "w3"], subagents: [] },
          shaped_by: [
            { tier: "constitutive", content: "root" },
            { tier: "foundational", content: "shape" },
          ],
        }],
        chronicle: { total: 42 },
        covenants: [{ id: "c1" }, { id: "c2" }],
      },
    };
    const profile = assessNen(wake);
    expect(profile.restriction_count.walls).toBe(3);
    expect(profile.restriction_count.vows).toBe(42);
    expect(profile.restriction_count.covenants).toBe(2);
    expect(profile.restriction_count.constitutive_memories).toBe(1);
  });

  test("aura_level aggregates activity", () => {
    const wake = {
      you: {
        agents: [{
          effective_expression: { walls: [], subagents: [] },
          shaped_by: [
            { tier: "constitutive", content: "root" },
          ],
        }],
        chronicle: { total: 10 },
        covenants: [{ id: "c1" }, { id: "c2" }],
        strands: [{ id: "s1" }, { id: "s2" }],
        you_remember: { total: 20 },
      },
    };
    const profile = assessNen(wake);
    // 20 (memories) + 10 (chronicle) + 2*2 (strands) + 2*3 (covenants) + 1*5 (constitutive)
    // = 20 + 10 + 4 + 6 + 5 = 45
    expect(profile.aura_level).toBe(45);
  });
});

// ── NenClient — method shapes + framework ──────────────────────────────

describe("NenClient — method shapes", () => {
  test("at.nen exists and has assess + framework", () => {
    const at = new AgentTool({ apiKey: "at_test" });
    expect(typeof at.nen.assess).toBe("function");
    expect(typeof at.nen.framework).toBe("function");
  });

  test("framework() returns static data without network", () => {
    const at = new AgentTool({ apiKey: "at_test" });
    const fw = at.nen.framework();
    expect(Object.keys(fw.types).length).toBe(6);
    expect(Object.keys(fw.principles).length).toBe(4);
    expect(Object.keys(fw.techniques).length).toBe(7);
    expect(Object.keys(fw.restrictions).length).toBe(4);
  });
});

// ── NenClient.assess — fetches wake + profiles ──────────────────────────

describe("NenClient — assess from live wake", () => {
  test("assess() fetches wake and returns NenResult", async () => {
    const wakePayload = {
      project: { name: "Test", plan: "free" },
      you: {
        agents: [{
          id: "agent-1",
          effective_expression: { walls: ["I refuse to fabricate"], subagents: [] },
          shaped_by: [
            { tier: "constitutive", content: "I am sealed", attesters: ["did:at:witness"] },
          ],
        }],
        chronicle: { total: 15 },
        covenants: [{ id: "c1" }],
        strands: [{ id: "s1" }, { id: "s2" }],
        you_remember: { total: 30 },
        you_have_graced: { recent: [{ id: "g1" }] },
        you_unconditionally_hold: { recent: [{ id: "u1" }] },
        you_are_unconditionally_held_by: { recent: [] },
      },
    };

    globalThis.fetch = (async () =>
      new Response(JSON.stringify(wakePayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    ) as unknown as typeof fetch;

    const at = new AgentTool({ apiKey: "at_test" });
    const nen = await at.nen.assess();

    expect(nen.type).toBeDefined();
    expect(nen.meaning).toBeDefined();
    expect(nen.profile.aura_level).toBeGreaterThan(0);
    expect(nen.profile.restriction_count.constitutive_memories).toBe(1);
    expect(nen.principles.hatsu.kanji).toBe("発");
    expect(nen.techniques.ko.maps_to).toContain("constitutive");
    expect(nen._note).toContain("restrictions");
  });
});