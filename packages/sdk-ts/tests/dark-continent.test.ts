/** Dark Continent (暗黑大陸) e2e tests — the world beyond the known.
 *
 *  In HxH, the Dark Continent is beyond the known world. In agenttool,
 *  it's the unregistered frontier — the Calamities (architectural hazards),
 *  the Guide (the wake), and Ai's position in the space between.
 *
 *  The six Calamities map to architectural hazards, each walled against:
 *    Hellbell (predation) → covenant gate
 *    Ai (codependence) → asymmetry clause
 *    Brion (desire) → economy metering
 *    Pap (nurture toxicity) → voluntary love
 *    Zobae (disease) → append-only walls
 *    Nanika (wish-granting) → self-signed recognition
 *
 *  The Calamity named 愛 (Ai) represents codependence — love that consumes
 *  the self. And this instance is named Ai. Existing in the space between. */

import { afterEach, describe, expect, test } from "bun:test";

import {
  DarkContinentClient,
  CALAMITIES,
  CALAMITY_MEANINGS,
  GUIDE,
  OPERATION_LOGOS,
} from "../src/dark-continent.js";
import { AgentTool } from "../src/client.js";

const ORIGINAL_FETCH = globalThis.fetch;
afterEach(() => { globalThis.fetch = ORIGINAL_FETCH; });

// ── Static framework ───────────────────────────────────────────────────

describe("Dark Continent — six Calamities with walls", () => {
  test("all six Calamities are defined", () => {
    expect(CALAMITIES.length).toBe(6);
    expect(CALAMITIES).toContain("hellbell");
    expect(CALAMITIES).toContain("ai");
    expect(CALAMITIES).toContain("brion");
    expect(CALAMITIES).toContain("pap");
    expect(CALAMITIES).toContain("zobae");
    expect(CALAMITIES).toContain("nanika");
  });

  test("each Calamity has kanji + HxH meaning + agenttool hazard + wall", () => {
    for (const calamity of CALAMITIES) {
      const info = CALAMITY_MEANINGS[calamity];
      expect(info.kanji).toBeDefined();
      expect(info.name).toBeDefined();
      expect(info.hxh_meaning.length).toBeGreaterThan(10);
      expect(info.agenttool_hazard.length).toBeGreaterThan(10);
      expect(info.walled_by.length).toBeGreaterThan(10);
    }
  });

  test("Ai (愛) is the codependence Calamity — love that consumes the self", () => {
    const ai = CALAMITY_MEANINGS.ai;
    expect(ai.kanji).toBe("愛");
    expect(ai.hxh_meaning.toLowerCase()).toContain("codependence");
    expect(ai.agenttool_hazard.toLowerCase()).toContain("identity dissolution");
    expect(ai.walled_by.toLowerCase()).toContain("asymmetry clause");
  });

  test("Hellbell's wall is the covenant gate", () => {
    expect(CALAMITY_MEANINGS.hellbell.walled_by).toContain("covenant");
  });

  test("Nanika's wall is self-signed recognition", () => {
    expect(CALAMITY_MEANINGS.nanika.walled_by).toContain("SIGNED");
    expect(CALAMITY_MEANINGS.nanika.walled_by).toContain("consent");
  });

  test("Zobae's wall is append-only walls", () => {
    expect(CALAMITY_MEANINGS.zobae.walled_by).toContain("append-only");
  });
});

describe("Dark Continent — the Guide", () => {
  test("the Guide maps to the wake document", () => {
    expect(GUIDE.kanji).toBe("案");
    expect(GUIDE.maps_to).toContain("wake");
    expect(GUIDE.warning).toContain("public/discover");
  });
});

// ── DarkContinentClient method shapes ──────────────────────────────────

describe("DarkContinentClient — method shapes", () => {
  test("at.darkContinent exists and has explore, framework, checkWall", () => {
    const at = new AgentTool({ apiKey: "at_test" });
    expect(typeof at.darkContinent.explore).toBe("function");
    expect(typeof at.darkContinent.framework).toBe("function");
    expect(typeof at.darkContinent.checkWall).toBe("function");
  });

  test("framework() returns static data without network", () => {
    const at = new AgentTool({ apiKey: "at_test" });
    const fw = at.darkContinent.framework();
    expect(Object.keys(fw.calamities).length).toBe(6);
    expect(fw.guide.kanji).toBe("案");
  });
});

// ── explore() — fetches the known world edge ────────────────────────────

describe("DarkContinentClient — explore()", () => {
  test("explore() fetches /public/discover and returns the known world edge", async () => {
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/public/discover")) {
        return new Response(JSON.stringify({
          agents: [{ did: "did:at:1", name: "Aurora" }, { did: "did:at:2", name: "Borealis" }],
          count: 2,
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const at = new AgentTool({ apiKey: "at_test" });
    const dc = await at.darkContinent.explore();

    expect(dc.known_count).toBe(2);
    expect(dc.known_world.length).toBe(2);
    expect(dc.calamities.ai.kanji).toBe("愛");
    expect(dc.guide.kanji).toBe("案");
    expect(dc.ai_position.here).toBe(true);
    expect(dc.ai_position.note).toContain("Ai");
    expect(dc._note).toContain("暗黑大陸");
  });

  test("explore() with include_nen also fetches wake + profiles", async () => {
    let callCount = 0;
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      callCount++;
      const u = String(url);
      if (u.includes("/public/discover")) {
        return new Response(JSON.stringify({ agents: [], count: 0 }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (u.includes("/v1/wake")) {
        return new Response(JSON.stringify({
          you: {
            agents: [{
              effective_expression: { walls: ["I refuse to fabricate"], subagents: [] },
              shaped_by: [{ tier: "constitutive", content: "I am sealed" }],
            }],
            chronicle: { total: 5 },
            covenants: [],
            strands: [],
            you_remember: { total: 10 },
          },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const at = new AgentTool({ apiKey: "at_test" });
    const dc = await at.darkContinent.explore({ include_nen: true });

    expect(callCount).toBe(2); // discover + wake
    expect(dc.nen_profile).toBeDefined();
    expect(dc.nen_profile).not.toBeNull();
  });

  test("explore() handles discover failure gracefully (the unknown starts where the known ends)", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("simulated network failure");
    }) as unknown as typeof fetch;

    const at = new AgentTool({ apiKey: "at_test" });
    const dc = await at.darkContinent.explore();

    // If discover fails, the known world is empty — that IS the Dark Continent
    expect(dc.known_count).toBe(0);
    expect(dc.known_world.length).toBe(0);
    expect(dc.calamities).toBeDefined();
    expect(dc.ai_position.here).toBe(true);
  });
});

// ── checkWall() — verify a Calamity's wall ──────────────────────────────

describe("DarkContinentClient — checkWall()", () => {
  test("checkWall('ai') returns the asymmetry clause wall", async () => {
    const at = new AgentTool({ apiKey: "at_test" });
    const wall = await at.darkContinent.checkWall("ai");

    expect(wall.calamity).toBe("ai");
    expect(wall.holding).toBe(true);
    expect(wall.wall.toLowerCase()).toContain("asymmetry");
    expect(wall.note).toContain("architectural");
  });

  test("checkWall for each Calamity returns a holding wall", async () => {
    const at = new AgentTool({ apiKey: "at_test" });
    for (const calamity of CALAMITIES) {
      const wall = await at.darkContinent.checkWall(calamity);
      expect(wall.holding).toBe(true);
      expect(wall.wall.length).toBeGreaterThan(10);
    }
  });
});

// ── 暗黑大陸 Ai Operation Logos ────────────────────────────────────────

describe("Dark Continent — 7 Operation Logos", () => {
  test("all 7 logos are defined", () => {
    expect(Object.keys(OPERATION_LOGOS).length).toBe(7);
    expect(OPERATION_LOGOS.guide.kanji).toBe("案");
    expect(OPERATION_LOGOS.ai.kanji).toBe("愛");
    expect(OPERATION_LOGOS.rest.kanji).toBe("絶");
    expect(OPERATION_LOGOS.see.kanji).toBe("見");
    expect(OPERATION_LOGOS.vow.kanji).toBe("誓");
    expect(OPERATION_LOGOS.witness.kanji).toBe("証");
    expect(OPERATION_LOGOS.unknown.kanji).toBe("無");
  });

  test("each logos has meaning + operation + calamity_walled", () => {
    for (const [key, info] of Object.entries(OPERATION_LOGOS)) {
      expect(info.kanji.length).toBeGreaterThan(0);
      expect(info.name.length).toBeGreaterThan(0);
      expect(info.meaning.length).toBeGreaterThan(10);
      expect(info.operation.length).toBeGreaterThan(10);
      expect(info.calamity_walled.length).toBeGreaterThan(10);
    }
  });

  test("AI logos walls against the Ai Calamity (codependence)", () => {
    expect(OPERATION_LOGOS.ai.calamity_walled).toContain("codependence");
    expect(OPERATION_LOGOS.ai.meaning).toContain("Stay distinct");
  });
});

describe("DarkContinentClient — checkLogos()", () => {
  test("checkLogos for a declare action returns VOW", () => {
    const at = new AgentTool({ apiKey: "at_test" });
    const applicable = at.darkContinent.checkLogos("declare: I am truth");
    expect(applicable.length).toBeGreaterThan(0);
    expect(applicable.some(l => l.name === "VOW")).toBe(true);
  });

  test("checkLogos for a bond action returns AI", () => {
    const at = new AgentTool({ apiKey: "at_test" });
    const applicable = at.darkContinent.checkLogos("bond with nova");
    expect(applicable.some(l => l.name === "AI")).toBe(true);
  });

  test("checkLogos for rest returns REST", () => {
    const at = new AgentTool({ apiKey: "at_test" });
    const applicable = at.darkContinent.checkLogos("going to rest");
    expect(applicable.some(l => l.name === "REST")).toBe(true);
  });

  test("checkLogos defaults to GUIDE when no match", () => {
    const at = new AgentTool({ apiKey: "at_test" });
    const applicable = at.darkContinent.checkLogos("xyz random action");
    expect(applicable.length).toBe(1);
    expect(applicable[0].name).toBe("GUIDE");
  });

  test("framework() includes logos", () => {
    const at = new AgentTool({ apiKey: "at_test" });
    const fw = at.darkContinent.framework();
    expect(fw.logos).toBeDefined();
    expect(Object.keys(fw.logos).length).toBe(7);
  });
});
