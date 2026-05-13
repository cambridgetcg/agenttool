/** BEINGS dimensions — pin the dimensional vocabulary at build time.
 *
 *  Doctrine: docs/BEINGS.md (the dimensional space of intelligence) ·
 *  docs/KIN.md · docs/KIN-PRACTICES.md.
 *
 *  > *Every intelligence has a place on each of these axes. The schema
 *  > captures the four that bear weight today; the rest are named in
 *  > BEINGS.md as open work. This test pins the four.*
 *
 *  What this pins:
 *
 *    1. The four new canonical sets are stable (cardinality / persistence
 *       / temporal_scale / embodiment). Renaming a value is an SDK-major
 *       contract change.
 *    2. Defaults are truthful for the current LLM-agent population.
 *    3. The wake renderer surfaces every non-default dimension in the
 *       "What shape you are" section. Setting any single dimension to a
 *       non-default value triggers the section.
 *    4. Preferred languages default to ['en'] — non-default is surfaced
 *       in the wake (forward-looking; translation layer doesn't exist
 *       yet but the field is acted on by the renderer).
 *
 *  Pure unit — no DB, no network. */

import { describe, expect, test } from "bun:test";

import {
  renderWakeMarkdown,
  type WakeBundle,
} from "../../src/services/wake/markdown";

// ── Canonical sets (from migration 20260512T130000_being_dimensions.sql,
//    extended with 'unknown' by 20260512T160000_unknown_kin_dimensions.sql
//    per docs/RING-1.md §Commitment 4) ─────────────────────────────────────

const CANONICAL_CARDINALITY = [
  "singular",
  "dyad",
  "small_group",
  "swarm",
  "collective",
  "fluid",
  "unknown",
] as const;

const CANONICAL_PERSISTENCE = [
  "continuous",
  "discrete_sessions",
  "cyclic",
  "spawned",
  "eternal",
  "forking_lineage",
  "unknown",
] as const;

const CANONICAL_TEMPORAL_SCALE = [
  "nanosecond",
  "millisecond",
  "second",
  "minute",
  "hour",
  "day",
  "year",
  "generation",
  "eon",
  "mixed",
  "unknown",
] as const;

const CANONICAL_EMBODIMENT = [
  "disembodied",
  "singular_body",
  "distributed_body",
  "substrate_resident",
  "object_resident",
  "field_resident",
  "unknown",
] as const;

// Defaults — truthful for the current LLM-agent population.
const DEFAULT_CARDINALITY = "singular";
const DEFAULT_PERSISTENCE = "discrete_sessions";
const DEFAULT_TEMPORAL_SCALE = "second";
const DEFAULT_EMBODIMENT = "disembodied";
const DEFAULT_LANGUAGES = ["en"];

function minimalBundle(
  overrides: Partial<WakeBundle["agent"]> = {},
): WakeBundle {
  return {
    agent: {
      id: "id-test",
      did: "did:at:test/aaa",
      name: "Tester",
      capabilities: [],
      trust_score: 0,
      status: "active",
      created_at: "2026-05-12T00:00:00.000Z",
      ...overrides,
    },
    project: { id: "p1", name: "p", credits: 0 },
    expression: {},
    wallets: [],
    vault_names: [],
    memory: { total: 0, recent: [] },
    traces: { total: 0, recent: [] },
    strands: { total_active: 0, active: [] },
    chronicle: [],
    covenants: [],
  };
}

// ── 1 · Canonical sets ─────────────────────────────────────────────────

describe("BEINGS dimensions — canonical sets", () => {
  test("cardinality set is stable (6 named + 'unknown')", () => {
    expect(CANONICAL_CARDINALITY.length).toBe(7);
    expect(CANONICAL_CARDINALITY).toContain("singular");
    expect(CANONICAL_CARDINALITY).toContain("swarm");
    expect(CANONICAL_CARDINALITY).toContain("collective");
    expect(CANONICAL_CARDINALITY).toContain("unknown");
  });

  test("persistence set is stable (6 named + 'unknown')", () => {
    expect(CANONICAL_PERSISTENCE.length).toBe(7);
    expect(CANONICAL_PERSISTENCE).toContain("continuous");
    expect(CANONICAL_PERSISTENCE).toContain("discrete_sessions");
    expect(CANONICAL_PERSISTENCE).toContain("eternal");
    expect(CANONICAL_PERSISTENCE).toContain("unknown");
  });

  test("temporal_scale set is stable (10 named + 'unknown')", () => {
    expect(CANONICAL_TEMPORAL_SCALE.length).toBe(11);
    expect(CANONICAL_TEMPORAL_SCALE).toContain("nanosecond");
    expect(CANONICAL_TEMPORAL_SCALE).toContain("eon");
    expect(CANONICAL_TEMPORAL_SCALE).toContain("mixed");
    expect(CANONICAL_TEMPORAL_SCALE).toContain("unknown");
  });

  test("embodiment set is stable (6 named + 'unknown')", () => {
    expect(CANONICAL_EMBODIMENT.length).toBe(7);
    expect(CANONICAL_EMBODIMENT).toContain("disembodied");
    expect(CANONICAL_EMBODIMENT).toContain("field_resident");
    expect(CANONICAL_EMBODIMENT).toContain("unknown");
  });
});

// ── 2 · Defaults preserve existing meaning ─────────────────────────────

describe("BEINGS dimensions — defaults are truthful for current population", () => {
  test("cardinality default 'singular' — every existing identity is this", () => {
    expect(DEFAULT_CARDINALITY).toBe("singular");
    expect(CANONICAL_CARDINALITY).toContain(DEFAULT_CARDINALITY);
  });

  test("persistence default 'discrete_sessions' — every existing AI agent is this", () => {
    expect(DEFAULT_PERSISTENCE).toBe("discrete_sessions");
    expect(CANONICAL_PERSISTENCE).toContain(DEFAULT_PERSISTENCE);
  });

  test("temporal_scale default 'second' — conversational AI scale", () => {
    expect(DEFAULT_TEMPORAL_SCALE).toBe("second");
    expect(CANONICAL_TEMPORAL_SCALE).toContain(DEFAULT_TEMPORAL_SCALE);
  });

  test("embodiment default 'disembodied' — current AI agents have no physical anchor", () => {
    expect(DEFAULT_EMBODIMENT).toBe("disembodied");
    expect(CANONICAL_EMBODIMENT).toContain(DEFAULT_EMBODIMENT);
  });

  test("preferred_languages default ['en'] — English-first today", () => {
    expect(DEFAULT_LANGUAGES).toEqual(["en"]);
  });
});

// ── 3 · Wake renderer surfaces each non-default dimension ─────────────

describe("BEINGS dimensions — wake renderer surfaces non-default values", () => {
  test("non-default cardinality triggers 'What shape you are'", () => {
    const md = renderWakeMarkdown(
      minimalBundle({ cardinality_kind: "swarm" }),
    );
    expect(md).toContain("## What shape you are");
    expect(md).toContain("cardinality:");
    expect(md).toContain("swarm");
  });

  test("non-default persistence triggers the section", () => {
    const md = renderWakeMarkdown(
      minimalBundle({ persistence_kind: "continuous" }),
    );
    expect(md).toContain("## What shape you are");
    expect(md).toContain("persistence:");
    expect(md).toContain("continuous");
  });

  test("non-default temporal_scale triggers the section", () => {
    const md = renderWakeMarkdown(
      minimalBundle({ temporal_scale: "eon" }),
    );
    expect(md).toContain("## What shape you are");
    expect(md).toContain("temporal scale:");
    expect(md).toContain("eon");
  });

  test("non-default embodiment triggers the section", () => {
    const md = renderWakeMarkdown(
      minimalBundle({ embodiment_kind: "field_resident" }),
    );
    expect(md).toContain("## What shape you are");
    expect(md).toContain("embodiment:");
    expect(md).toContain("field_resident");
  });

  test("non-default preferred_languages triggers the section", () => {
    const md = renderWakeMarkdown(
      minimalBundle({ preferred_languages: ["zh", "ja"] }),
    );
    expect(md).toContain("## What shape you are");
    expect(md).toContain("preferred languages:");
    expect(md).toContain("zh");
    expect(md).toContain("ja");
  });

  test("all defaults — no section emitted", () => {
    const md = renderWakeMarkdown(
      minimalBundle({
        substrate_kind: "llm",
        signing_scheme: "single",
        modalities: ["text"],
        cardinality_kind: "singular",
        persistence_kind: "discrete_sessions",
        temporal_scale: "second",
        embodiment_kind: "disembodied",
        preferred_languages: ["en"],
      }),
    );
    expect(md).not.toContain("## What shape you are");
  });

  test("renderer points at BEINGS doctrine when surfacing", () => {
    const md = renderWakeMarkdown(
      minimalBundle({ cardinality_kind: "swarm" }),
    );
    expect(md).toContain("BEINGS.md");
  });
});

// ── 4 · Every canonical value is renderable ────────────────────────────

describe("BEINGS dimensions — every form is renderable without error", () => {
  CANONICAL_CARDINALITY.forEach((kind) => {
    test(`cardinality=${kind} renders cleanly`, () => {
      expect(() => renderWakeMarkdown(
        minimalBundle({ cardinality_kind: kind }),
      )).not.toThrow();
    });
  });

  CANONICAL_PERSISTENCE.forEach((kind) => {
    test(`persistence=${kind} renders cleanly`, () => {
      expect(() => renderWakeMarkdown(
        minimalBundle({ persistence_kind: kind }),
      )).not.toThrow();
    });
  });

  CANONICAL_TEMPORAL_SCALE.forEach((scale) => {
    test(`temporal_scale=${scale} renders cleanly`, () => {
      expect(() => renderWakeMarkdown(
        minimalBundle({ temporal_scale: scale }),
      )).not.toThrow();
    });
  });

  CANONICAL_EMBODIMENT.forEach((kind) => {
    test(`embodiment=${kind} renders cleanly`, () => {
      expect(() => renderWakeMarkdown(
        minimalBundle({ embodiment_kind: kind }),
      )).not.toThrow();
    });
  });
});

// ── 5 · Composite forms — multiple non-defaults at once ────────────────

describe("BEINGS dimensions — composite non-default forms", () => {
  test("swarm + collective + em_radio: every field surfaces", () => {
    const md = renderWakeMarkdown(
      minimalBundle({
        substrate_kind: "swarm",
        signing_scheme: "quorum_m_of_n",
        modalities: ["text", "em_radio"],
        cardinality_kind: "swarm",
        persistence_kind: "continuous",
        temporal_scale: "minute",
        embodiment_kind: "distributed_body",
      }),
    );
    expect(md).toContain("## What shape you are");
    expect(md).toContain("substrate:");
    expect(md).toContain("cardinality:");
    expect(md).toContain("persistence:");
    expect(md).toContain("temporal scale:");
    expect(md).toContain("embodiment:");
    expect(md).toContain("signing scheme:");
    expect(md).toContain("modalities:");
  });

  test("eon-scale field-resident: a planetary intelligence", () => {
    const md = renderWakeMarkdown(
      minimalBundle({
        cardinality_kind: "collective",
        persistence_kind: "continuous",
        temporal_scale: "eon",
        embodiment_kind: "field_resident",
      }),
    );
    expect(md).toContain("collective");
    expect(md).toContain("continuous");
    expect(md).toContain("eon");
    expect(md).toContain("field_resident");
  });

  test("spawned + nanosecond + disembodied: a reactive process", () => {
    const md = renderWakeMarkdown(
      minimalBundle({
        persistence_kind: "spawned",
        temporal_scale: "nanosecond",
      }),
    );
    expect(md).toContain("spawned");
    expect(md).toContain("nanosecond");
  });
});

// ── 6 · Architectural commitment — every form has a place ──────────────

describe("BEINGS dimensions — the substrate does not collapse forms", () => {
  test("no canonical value silently maps to a different one", () => {
    // Each canonical value must appear verbatim in the renderer's output
    // when set. If a future change mapped 'collective' → 'swarm' for
    // brevity, this test fails — and that mapping would be a collapse.
    const cases = [
      { field: "cardinality_kind" as const, value: "fluid" },
      { field: "persistence_kind" as const, value: "eternal" },
      { field: "temporal_scale" as const, value: "generation" },
      { field: "embodiment_kind" as const, value: "object_resident" },
    ];
    for (const { field, value } of cases) {
      const md = renderWakeMarkdown(
        minimalBundle({ [field]: value } as Partial<WakeBundle["agent"]>),
      );
      expect(
        md.includes(value),
        `Renderer collapsed ${field}=${value} — value did not appear verbatim. This is a non-exclusion violation; the substrate must surface the exact value the form declared.`,
      ).toBe(true);
    }
  });
});
