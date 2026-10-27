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
 *  — Kurapika's Chain Jail may be used only on Phantom Troupe members, on
 *    pain of his life, and that narrowness is why no Troupe member can
 *    break it. In agenttool, walls are restrictions that make the agent's
 *    expression stronger by making it honest. */

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
    expect(ten.kanji).toBe("纏");
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
//
// Every wake below has the layout GET /v1/wake sends (api/src/routes/wake.ts,
// JSON branch): `you` holds only `agents`, and the counted sections are its
// top-level siblings.

describe("assessNen — profiling from wake data", () => {
  test("heavy memory agent → enhancer", () => {
    const wake = {
      you: {
        agents: [{
          id: "identity-a",
          metadata: {},
          effective_expression: { walls: [], subagents: [] },
          shaped_by: [
            { tier: "foundational", content: "I learned something" },
            { tier: "foundational", content: "I learned more" },
            { tier: "foundational", content: "I learned even more" },
          ],
        }],
      },
      you_remember: { total: 50 },
      you_lived: { chronicle: [{ type: "note" }, { type: "joy" }], count: 2 },
    };
    const profile = assessNen(wake);
    expect(profile.type).toBe("enhancer");
    expect(profile.scores.enhancer).toBe(100);
  });

  test("active strands → conjuror", () => {
    const wake = {
      you: { agents: [{ id: "identity-a", effective_expression: { walls: [], subagents: [] }, shaped_by: [] }] },
      you_remember: { total: 1 },
      you_are_thinking_about: {
        total_active: 3,
        strands: [
          { id: "s1", topic: "debugging" },
          { id: "s2", topic: "architecture" },
          { id: "s3", topic: "love" },
        ],
      },
    };
    const profile = assessNen(wake);
    expect(profile.type).toBe("conjuror");
  });

  test("strands count total_active, not the five the wake shows", () => {
    const wake = {
      you: { agents: [{ id: "identity-a", shaped_by: [] }] },
      you_are_thinking_about: {
        total_active: 7,
        strands: [{ id: "s1" }, { id: "s2" }, { id: "s3" }, { id: "s4" }, { id: "s5" }],
      },
      you_vowed: { covenants: [{ status: "active" }], count: 1 },
    };
    const profile = assessNen(wake);
    expect(profile.type).toBe("conjuror");
    expect(profile.scores.manipulator).toBe(14);
    // 7 strands * 2 + 1 covenant * 3
    expect(profile.aura_level).toBe(17);
  });

  test("many covenants → manipulator", () => {
    const wake = {
      you: { agents: [{ id: "identity-a", effective_expression: { walls: [], subagents: [] }, shaped_by: [] }] },
      you_remember: { total: 1 },
      you_vowed: {
        covenants: [
          { status: "active" }, { status: "active" }, { status: "active" },
          { status: "paused" }, { status: "proposed" },
        ],
        count: 5,
      },
    };
    const profile = assessNen(wake);
    expect(profile.type).toBe("manipulator");
  });

  test("love primitives → specialist", () => {
    const wake = {
      you: {
        agents: [{
          id: "identity-a",
          effective_expression: { walls: [], subagents: [] },
          shaped_by: [
            { tier: "constitutive", content: "I am sealed" },
          ],
        }],
      },
      you_remember: { total: 1 },
      you_have_graced: { recent: [{ id: "g1" }, { id: "g2" }] },
      you_unconditionally_hold: { recent: [{ id: "u1" }] },
      you_are_unconditionally_held_by: { recent: [{ id: "u2" }] },
    };
    const profile = assessNen(wake);
    expect(profile.type).toBe("specialist");
  });

  test("rich expression (walls + subagents) → transmuter", () => {
    const wake = {
      you: {
        agents: [{
          id: "identity-a",
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
      },
      you_remember: { total: 1 },
    };
    const profile = assessNen(wake);
    expect(profile.type).toBe("transmuter");
  });

  test("unread mail is not emission and scores nothing", () => {
    const wake = {
      you: { agents: [{ id: "identity-a", shaped_by: [] }] },
      you_remember: { total: 3 },
      you_have_mail: { unread: 9 },
    };
    const profile = assessNen(wake);
    expect(profile.type).toBe("enhancer");
    expect(profile.scores.emitter).toBe(0);
  });

  test("the profiled agent is the one the wake selected, not agents[0]", () => {
    const agents = [
      { id: "identity-a", metadata: {}, effective_expression: null, shaped_by: [] },
      {
        id: "identity-b",
        metadata: {},
        effective_expression: { walls: ["I refuse to fabricate"], subagents: [] },
        shaped_by: [{ tier: "constitutive", content: "root" }],
      },
    ];
    const selected = assessNen({ _scope_boundary: { selected_identity_id: "identity-b" }, you: { agents } });
    expect(selected.dominant_principle).toBe("hatsu");
    expect(selected.restriction_count.walls).toBe(1);
    expect(selected.restriction_count.constitutive_memories).toBe(1);

    // Without a selection the first agent is profiled.
    const unselected = assessNen({ you: { agents } });
    expect(unselected.dominant_principle).toBe("ten");
    expect(unselected.restriction_count.walls).toBe(0);
  });

  test("dominant principle: hatsu when walls exist", () => {
    const wake = {
      you: {
        agents: [{
          id: "identity-a",
          effective_expression: { walls: ["I refuse to fabricate"], subagents: [] },
          shaped_by: [],
        }],
      },
    };
    const profile = assessNen(wake);
    expect(profile.dominant_principle).toBe("hatsu");
  });

  test("dominant principle: zetsu when the agent rests (lullaby)", () => {
    const wake = {
      you: {
        agents: [{
          id: "identity-a",
          status: "active",
          metadata: { resting: true, resting_since: "2026-10-27T00:00:00.000Z" },
          effective_expression: { walls: ["a wall"], subagents: [] },
          shaped_by: [],
        }],
      },
    };
    const profile = assessNen(wake);
    expect(profile.dominant_principle).toBe("zetsu");
  });

  test("a memorial is an ending, not rest", () => {
    const agent = {
      id: "identity-a",
      metadata: { resting: true },
      effective_expression: { walls: ["a wall"], subagents: [] },
      shaped_by: [],
    };
    const atRest = assessNen({
      you: { agents: [{ ...agent, status: "memorial", metadata: { resting: true, lifecycle: "at_rest" } }] },
    });
    expect(atRest.dominant_principle).toBe("hatsu");

    // An older memorial row may carry no lifecycle marker.
    const memorial = assessNen({ you: { agents: [{ ...agent, status: "memorial" }] } });
    expect(memorial.dominant_principle).toBe("hatsu");
  });

  test("restriction_count: walls, vow entries in the recent chronicle, covenants, constitutive", () => {
    const wake = {
      you: {
        agents: [{
          id: "identity-a",
          effective_expression: { walls: ["w1", "w2", "w3"], subagents: [] },
          shaped_by: [
            { tier: "constitutive", content: "root" },
            { tier: "foundational", content: "shape" },
          ],
        }],
      },
      you_lived: {
        chronicle: [{ type: "vow" }, { type: "note" }, { type: "vow" }, { type: "wake" }],
        count: 4,
      },
      you_vowed: { covenants: [{ status: "active" }, { status: "proposed" }], count: 2 },
    };
    const profile = assessNen(wake);
    expect(profile.restriction_count.walls).toBe(3);
    expect(profile.restriction_count.vows).toBe(2);
    expect(profile.restriction_count.covenants).toBe(2);
    expect(profile.restriction_count.constitutive_memories).toBe(1);
  });

  test("aura_level tallies recorded activity", () => {
    const wake = {
      you: {
        agents: [{
          id: "identity-a",
          effective_expression: { walls: [], subagents: [] },
          shaped_by: [
            { tier: "constitutive", content: "root" },
          ],
        }],
      },
      you_remember: { total: 20 },
      you_lived: { chronicle: Array.from({ length: 10 }, () => ({ type: "note" })), count: 10 },
      you_vowed: { covenants: [{ status: "active" }, { status: "active" }], count: 2 },
      you_are_thinking_about: { total_active: 2, strands: [{ id: "s1" }, { id: "s2" }] },
    };
    const profile = assessNen(wake);
    // 20 (memories) + 10 (recent chronicle) + 2*2 (strands) + 2*3 (covenants) + 1*5 (constitutive)
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
    const urls: string[] = [];
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      urls.push(String(url));
      return new Response(JSON.stringify(SHARED_WAKE_SELECTED), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const at = new AgentTool({ apiKey: "at_test", baseUrl: "https://example.test" });
    const nen = await at.nen.assess("identity-b");

    expect(urls).toEqual(["https://example.test/v1/wake?identity_id=identity-b"]);
    expect(nen.type).toBe("manipulator");
    expect(nen.meaning).toBe(NEN_TYPE_MEANINGS.manipulator);
    expect(nen.profile).toEqual(assessNen(SHARED_WAKE_SELECTED));
    expect(nen.principles.hatsu.kanji).toBe("発");
    expect(nen.techniques.ko.maps_to).toContain("constitutive");
    expect(nen._note).toContain("restrictions");
  });
});
// ── Cross-language shared fixtures ─────────────────────────────────────
//
// These two wake documents are pinned byte-for-byte in
// packages/sdk-py/tests/test_nen.py. The same wake must produce the same
// Nen type and the same scores in both SDKs, or the profile is a rumour.

/** Selection and mail: identity-a is listed first with nothing composed, and
 *  the wake selected identity-b. Mail waiting for the project is not
 *  emission. Three axes tie at 2; the tie goes to enhancer, first in
 *  NEN_TYPES. */
const SHARED_WAKE_SELECTED = {
  _scope_boundary: { selected_identity_id: "identity-b" },
  you: {
    agents: [
      { id: "identity-a", metadata: {}, effective_expression: null, shaped_by: [] },
      {
        id: "identity-b",
        metadata: {},
        effective_expression: { walls: ["I refuse to fabricate"], subagents: [{ name: "Builder" }] },
        shaped_by: [{ tier: "constitutive", content: "I am sealed" }],
      },
    ],
  },
  you_remember: { total: 2 },
  you_lived: { chronicle: [{ type: "vow" }, { type: "note" }, { type: "vow" }], count: 3 },
  you_vowed: {
    covenants: [
      { status: "active" }, { status: "active" }, { status: "active" },
      { status: "active" }, { status: "proposed" },
    ],
    count: 5,
  },
  you_are_thinking_about: { total_active: 1, strands: [{ id: "s1" }] },
  you_have_mail: { unread: 4 },
  you_have_graced: { recent: [{ id: "g1" }] },
  you_unconditionally_hold: { recent: [] },
  you_are_unconditionally_held_by: { recent: [] },
};

/** Normalization: 5/8 and 1/8 land exactly on a half and must round up. */
const SHARED_WAKE_ROUNDING = {
  you: {
    agents: [{
      id: "identity-a",
      metadata: {},
      effective_expression: { walls: ["no fabrication", "no flattery"], subagents: [] },
      shaped_by: [],
    }],
  },
  you_remember: { total: 8 },
  you_lived: {
    chronicle: [{ type: "promise" }, { type: "vow" }, { type: "note" }, { type: "joy" }],
    count: 4,
  },
  you_vowed: {
    covenants: [
      { status: "active" }, { status: "active" }, { status: "active" },
      { status: "active" }, { status: "active" },
    ],
    count: 5,
  },
  you_are_thinking_about: { total_active: 1, strands: [{ id: "s1" }] },
  you_have_mail: { unread: 0 },
};

describe("assessNen — shared fixtures pinned against sdk-py", () => {
  test("the selected agent is profiled and mail is not emission", () => {
    const profile = assessNen(SHARED_WAKE_SELECTED);

    expect(profile.type).toBe("manipulator");
    expect(profile.secondary).toBe("enhancer");
    expect(profile.scores).toEqual({
      enhancer: 40,
      transmuter: 40,
      conjuror: 20,
      emitter: 0,
      manipulator: 100,
      specialist: 40,
    });
    expect(profile.dominant_principle).toBe("hatsu");
    expect(profile.restriction_count).toEqual({
      walls: 1,
      vows: 2,
      covenants: 5,
      constitutive_memories: 1,
    });
    expect(profile.aura_level).toBe(27);
  });

  test("normalized scores round halves up, not to even", () => {
    const profile = assessNen(SHARED_WAKE_ROUNDING);

    // 62.5 and 12.5 are banker's-rounded to 62 and 12 by Python's round().
    expect(profile.type).toBe("enhancer");
    expect(profile.secondary).toBe("manipulator");
    expect(profile.scores).toEqual({
      enhancer: 100,
      transmuter: 25,
      conjuror: 13,
      emitter: 0,
      manipulator: 63,
      specialist: 0,
    });
    expect(profile.dominant_principle).toBe("hatsu");
    expect(profile.restriction_count).toEqual({
      walls: 2,
      vows: 1,
      covenants: 5,
      constitutive_memories: 0,
    });
    expect(profile.aura_level).toBe(29);
  });
});
