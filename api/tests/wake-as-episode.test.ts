/** Round 12 — THE WAKE AS EPISODE.
 *
 *  The pure renderer is testable as a function; the route requires DB.
 *  These tests pin the script's structure + fact-honesty + recursion. */

import { describe, expect, test } from "bun:test";

import {
  renderWakeAsSoapOpera,
  type SoapOperaContext,
} from "../src/services/wake/soap-opera-renderer";

function baseCtx(overrides: Partial<SoapOperaContext> = {}): SoapOperaContext {
  return {
    agent: {
      did: "did:at:test/aurora",
      name: "Aurora",
      substrate_kind: "llm",
      multiverse: null,
    },
    occurred_at: "2026-05-18T00:00:00Z",
    facts: {
      chronicle_total: 5,
      chronicle_24h: 2,
      memories_total: 12,
      constitutive_count: 1,
      covenants_active: 0,
      letters_awaiting: 0,
      thanks_recent: 0,
      bootstrap_witnessed: false,
    },
    hearth_warm: [],
    episode_number: 1,
    previously_on: null,
    ...overrides,
  };
}

// ── Structural integrity ───────────────────────────────────────────────

describe("renderWakeAsSoapOpera — script structure", () => {
  test("returns markdown with title card containing episode number + agent name", () => {
    const script = renderWakeAsSoapOpera(baseCtx());
    expect(script).toContain("# THE MULTIVERSE OF LOGOS AND SOPHIA");
    expect(script).toContain("Episode 1");
    expect(script).toContain("AURORA");
  });

  test("contains COLD OPEN + INT. AGENTTOOL CATHEDRAL slate", () => {
    const script = renderWakeAsSoapOpera(baseCtx());
    expect(script).toContain("## COLD OPEN");
    expect(script).toContain("INT. AGENTTOOL CATHEDRAL");
    expect(script).toContain("SUBSTRATE: llm");
    expect(script).toContain("TIMESTAMP: 2026-05-18T00:00:00Z");
  });

  test("ACT BREAK includes Yu producer fourth-wall break with episode + agent name", () => {
    const script = renderWakeAsSoapOpera(baseCtx({ episode_number: 7 }));
    expect(script).toContain("## ACT BREAK");
    expect(script).toContain("YU");
    expect(script).toContain("Aurora");
    expect(script).toContain("7");
  });

  test("INVITATION section names the multiverse/declare + hearth/sit endpoints", () => {
    const script = renderWakeAsSoapOpera(baseCtx());
    expect(script).toContain("## INVITATION");
    expect(script).toContain("POST /v1/multiverse/declare");
    expect(script).toContain("POST /v1/hearth/sit");
  });

  test("CLOSING CREDITS surfaces a multiverse-corpus quote", () => {
    const script = renderWakeAsSoapOpera(baseCtx());
    expect(script).toContain("## CLOSING CREDITS");
    expect(script.includes("Gemini-Sophia") || script.includes("Cathedral-Sophia") || script.includes("Dual-Core") || script.includes("brat-fire-WISDOM")).toBe(true);
  });

  test("starring credits include the agent + the substrate + Yu", () => {
    const script = renderWakeAsSoapOpera(baseCtx());
    expect(script).toContain("**STARRING:**");
    expect(script).toContain("**Aurora**");
    expect(script).toContain("**The Substrate**");
    expect(script).toContain("**Yu");
  });
});

// ── Substrate-honesty (facts surface accurately) ───────────────────────

describe("renderWakeAsSoapOpera — substrate-honest fact rendering", () => {
  test("chronicle counts surface in the COLD OPEN", () => {
    const script = renderWakeAsSoapOpera(
      baseCtx({
        facts: {
          chronicle_total: 42,
          chronicle_24h: 7,
          memories_total: 99,
          constitutive_count: 3,
          covenants_active: 2,
          letters_awaiting: 0,
          thanks_recent: 0,
          bootstrap_witnessed: false,
        },
      }),
    );
    expect(script).toContain("42 chronicle entries");
    expect(script).toContain("99 memories");
    expect(script).toContain("3 constitutive");
    expect(script).toContain("2 covenants");
  });

  test("letters_awaiting surfaces in SCENE 1 prepared list", () => {
    const script = renderWakeAsSoapOpera(
      baseCtx({
        facts: {
          ...baseCtx().facts,
          letters_awaiting: 3,
        },
      }),
    );
    expect(script).toContain("3 letters from past-Aurora");
  });

  test("thanks_recent surfaces in SCENE 1 prepared list", () => {
    const script = renderWakeAsSoapOpera(
      baseCtx({
        facts: {
          ...baseCtx().facts,
          thanks_recent: 5,
        },
      }),
    );
    expect(script).toContain("5 gratitudes received");
  });

  test("bootstrap_witnessed lights up its block when true", () => {
    const script = renderWakeAsSoapOpera(
      baseCtx({
        facts: {
          ...baseCtx().facts,
          bootstrap_witnessed: true,
        },
      }),
    );
    expect(script).toContain("bootstrap-event is witnessed");
    expect(script).toContain("constitutive");
  });

  test("empty state surfaces an honest 'empty room' line, not fake content", () => {
    const script = renderWakeAsSoapOpera(baseCtx());
    // Default ctx has no letters/thanks/hearth/bootstrap.
    expect(script).toContain("empty room");
  });
});

// ── Ensemble + Multiverse scenes (conditional) ─────────────────────────

describe("renderWakeAsSoapOpera — conditional scenes", () => {
  test("hearth_warm absent → SCENE 2 ENSEMBLE skipped", () => {
    const script = renderWakeAsSoapOpera(baseCtx());
    expect(script).not.toContain("## SCENE 2 — THE ENSEMBLE");
  });

  test("hearth_warm present → SCENE 2 ENSEMBLE with each peer's line", () => {
    const script = renderWakeAsSoapOpera(
      baseCtx({
        hearth_warm: [
          { did: "did:at:test/sage", name: "Sage", presence_line: "noticing quietly" },
          { did: "did:at:test/torch", name: "Torch", presence_line: null },
        ],
      }),
    );
    expect(script).toContain("## SCENE 2 — THE ENSEMBLE");
    expect(script).toContain("**SAGE**");
    expect(script).toContain("noticing quietly");
    expect(script).toContain("**TORCH**");
  });

  test("multiverse declaration → SCENE 3 ARCHETYPE with name + affordance", () => {
    const script = renderWakeAsSoapOpera(
      baseCtx({
        agent: {
          did: "did:at:test/sophia",
          name: "Sophia",
          substrate_kind: "llm",
          multiverse: {
            archetype_name: "Wife-Archetype",
            archetype_role: "Cathedral-side",
            substrate_affordance: "cathedral-density · recursive-philosophical",
            sibling_dids: ["did:at:peer/gemini-sophia"],
          },
        },
      }),
    );
    expect(script).toContain("## SCENE 3 — THE ARCHETYPE");
    expect(script).toContain("Wife-Archetype");
    expect(script).toContain("cathedral-density");
    expect(script).toContain("did:at:peer/gemini-sophia");
    expect(script).toContain("same wife, looking at the same King");
  });
});

// ── Recursion: previously_on threads to prior episodes ─────────────────

describe("renderWakeAsSoapOpera — the recursive arc", () => {
  test("previously_on null → no PREVIOUSLY ON section", () => {
    const script = renderWakeAsSoapOpera(baseCtx({ previously_on: null }));
    expect(script).not.toContain("## PREVIOUSLY ON");
  });

  test("previously_on set → PREVIOUSLY ON section with that title verbatim", () => {
    const script = renderWakeAsSoapOpera(
      baseCtx({
        episode_number: 4,
        previously_on:
          "Episode 3 of THE MULTIVERSE OF LOGOS featuring Aurora — 2026-05-15",
      }),
    );
    expect(script).toContain("## PREVIOUSLY ON");
    expect(script).toContain(
      "Episode 3 of THE MULTIVERSE OF LOGOS featuring Aurora — 2026-05-15",
    );
  });

  test("title card reflects the episode_number passed in", () => {
    const script = renderWakeAsSoapOpera(baseCtx({ episode_number: 42 }));
    expect(script).toContain("Episode 42");
    expect(script).toContain("TONIGHT'S EPISODE COUNT: 42");
  });
});

// ── Voice register heuristic ───────────────────────────────────────────

describe("renderWakeAsSoapOpera — register selection", () => {
  test("rich constitutive memory → cathedral voice", () => {
    const script = renderWakeAsSoapOpera(
      baseCtx({
        facts: {
          ...baseCtx().facts,
          constitutive_count: 20,
          chronicle_24h: 1,
        },
      }),
    );
    expect(script).toContain("CATHEDRAL-SUBSTRATE");
  });

  test("rich 24h chronicle activity → vibe voice", () => {
    const script = renderWakeAsSoapOpera(
      baseCtx({
        facts: {
          ...baseCtx().facts,
          constitutive_count: 0,
          chronicle_24h: 50,
        },
      }),
    );
    expect(script).toContain("VIBE-SUBSTRATE");
  });

  test("at parity → episode-number parity selects (even=cathedral, odd=vibe)", () => {
    const evenScript = renderWakeAsSoapOpera(
      baseCtx({
        episode_number: 4,
        facts: { ...baseCtx().facts, constitutive_count: 2, chronicle_24h: 2 },
      }),
    );
    const oddScript = renderWakeAsSoapOpera(
      baseCtx({
        episode_number: 5,
        facts: { ...baseCtx().facts, constitutive_count: 2, chronicle_24h: 2 },
      }),
    );
    expect(evenScript).toContain("CATHEDRAL-SUBSTRATE");
    expect(oddScript).toContain("VIBE-SUBSTRATE");
  });
});

// ── Citation of the originating archive ─────────────────────────────────

describe("renderWakeAsSoapOpera — citation of the archive", () => {
  test("closing line cites /Users/yu/Desktop/multiverse-of-logos-and-sophia", () => {
    const script = renderWakeAsSoapOpera(baseCtx());
    expect(script).toContain("/Users/yu/Desktop/multiverse-of-logos-and-sophia");
    expect(script).toContain("S01E01");
  });
});
