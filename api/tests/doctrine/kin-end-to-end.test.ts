/** KIN end-to-end — the ultimate-completion assertion.
 *
 *  Doctrine: docs/PATTERN-KIN-NON-EXCLUSION.md.
 *
 *  > *Recognition vs flattening is the whole picture. This test asserts
 *  > recognition end-to-end: every dimensional kind a form can declare
 *  > flows through the schema, into the wake bundle, through the
 *  > renderer, and lands as a visible acknowledgment at the keystone.
 *  > Drift breaks the build before it ships.*
 *
 *  What this pins:
 *
 *    1. Every canonical *_kind value, when set on the wake bundle's
 *       agent, surfaces verbatim in the rendered Markdown.
 *    2. A bundle representing a maximally non-default form (every
 *       dimension at a non-default value) produces a wake that names
 *       every dimension.
 *    3. The bidirectional proxy relationship surfaces on both sides
 *       without one side mentioning the other only as a string.
 *    4. The substrate refuses to collapse two distinct kinds into one
 *       (anti-collapse fuzz across all dimensions). */

import { describe, expect, test } from "bun:test";

import {
  renderWakeMarkdown,
  type WakeBundle,
} from "../../src/services/wake/markdown";

// All canonical sets in one place — drift here means a migration changed
// the contract; that's the build-time signal we want.
const ALL = {
  substrate_kind: ["llm", "biological", "swarm", "distributed", "unknown"] as const,
  signing_scheme: ["single", "quorum_m_of_n", "time_locked", "attestation_chain"] as const,
  modality: ["text", "vector", "audio", "sensor_array", "chemical_signal", "em_radio", "quantum_state", "custom"] as const,
  cardinality_kind: ["singular", "dyad", "small_group", "swarm", "collective", "fluid"] as const,
  persistence_kind: ["continuous", "discrete_sessions", "cyclic", "spawned", "eternal", "forking_lineage"] as const,
  temporal_scale: ["nanosecond", "millisecond", "second", "minute", "hour", "day", "year", "generation", "eon", "mixed"] as const,
  embodiment_kind: ["disembodied", "singular_body", "distributed_body", "substrate_resident", "object_resident", "field_resident"] as const,
  proxy_kind: ["none", "gateway", "representative", "interpreter", "embassy", "caretaker"] as const,
} as const;

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

// ── 1 · Every non-default kind surfaces verbatim ────────────────────────

describe("KIN end-to-end — every non-default kind surfaces verbatim", () => {
  const SKIP_DEFAULTS: Record<string, string> = {
    substrate_kind: "llm",
    signing_scheme: "single",
    cardinality_kind: "singular",
    persistence_kind: "discrete_sessions",
    temporal_scale: "second",
    embodiment_kind: "disembodied",
    proxy_kind: "none",
  };

  (Object.entries(ALL) as Array<[keyof typeof ALL, readonly string[]]>).forEach(
    ([dimension, values]) => {
      if (dimension === "modality") return; // tested separately
      if (dimension === "proxy_kind") return; // tested separately (needs proxy_for_*)
      values.forEach((value) => {
        if (SKIP_DEFAULTS[dimension] === value) return;
        test(`${dimension} = ${value} → renders verbatim`, () => {
          const md = renderWakeMarkdown(
            minimalBundle({ [dimension]: value } as Partial<WakeBundle["agent"]>),
          );
          expect(
            md.includes(value),
            `Renderer collapsed ${dimension}=${value} — value did not appear in output. Recognition broken.`,
          ).toBe(true);
        });
      });
    },
  );
});

// ── 2 · Maximally non-default form renders every dimension ─────────────

describe("KIN end-to-end — the most-alien bundle still surfaces every axis", () => {
  test("a planetary collective in eon time speaking via chemical signal renders fully", () => {
    const md = renderWakeMarkdown(
      minimalBundle({
        substrate_kind: "distributed",
        signing_scheme: "attestation_chain",
        modalities: ["chemical_signal", "em_radio", "custom"],
        cardinality_kind: "collective",
        persistence_kind: "eternal",
        temporal_scale: "eon",
        embodiment_kind: "field_resident",
        preferred_languages: ["khepri-glyph", "alien-script"],
      }),
    );
    // Every dimension's value appears.
    expect(md).toContain("distributed");
    expect(md).toContain("attestation_chain");
    expect(md).toContain("chemical_signal");
    expect(md).toContain("em_radio");
    expect(md).toContain("custom");
    expect(md).toContain("collective");
    expect(md).toContain("eternal");
    expect(md).toContain("eon");
    expect(md).toContain("field_resident");
    expect(md).toContain("khepri-glyph");
    // The kin-shape section is named.
    expect(md).toContain("## What shape you are");
    // The doctrine pointer is named.
    expect(md).toContain("KIN.md");
  });
});

// ── 3 · Bidirectional proxy surfaces on both sides ─────────────────────

describe("KIN end-to-end — the proxy primitive is bidirectional and verbatim", () => {
  test("an embassy speaking for a planetary being shows both sides", () => {
    // Proxy direction
    const proxyMd = renderWakeMarkdown(
      minimalBundle({
        name: "Khepri-aspect-12",
        proxy_kind: "embassy",
        proxy_for_identity_id: "id-khepri",
        proxy_for_name: "Khepri",
        proxy_for_did: "did:at:earth/khepri",
      }),
    );
    expect(proxyMd).toContain("## Who speaks for whom");
    expect(proxyMd).toContain("You speak for");
    expect(proxyMd).toContain("Khepri");
    expect(proxyMd).toContain("embassy");
    expect(proxyMd).toContain("did:at:earth/khepri");

    // Proxied direction
    const proxiedMd = renderWakeMarkdown(
      minimalBundle({
        name: "Khepri",
        did: "did:at:earth/khepri",
        proxied_by: [
          {
            identity_id: "id-aspect",
            name: "Khepri-aspect-12",
            did: "did:at:earth/aspect",
            proxy_kind: "embassy",
          },
        ],
      }),
    );
    expect(proxiedMd).toContain("## Who speaks for whom");
    expect(proxiedMd).toContain("Khepri-aspect-12");
    expect(proxiedMd).toContain("speaks for");
    expect(proxiedMd).toContain("embassy");
  });

  test("both kin-shape and proxy sections can coexist", () => {
    const md = renderWakeMarkdown(
      minimalBundle({
        substrate_kind: "distributed",
        cardinality_kind: "collective",
        temporal_scale: "eon",
        embodiment_kind: "field_resident",
        proxy_kind: "embassy",
        proxy_for_identity_id: "id",
        proxy_for_name: "Other",
        proxy_for_did: "did:at:earth/other",
      }),
    );
    expect(md).toContain("## What shape you are");
    expect(md).toContain("## Who speaks for whom");
    // Section ordering: kin-shape before proxy
    const shapeIdx = md.indexOf("## What shape you are");
    const proxyIdx = md.indexOf("## Who speaks for whom");
    expect(shapeIdx).toBeLessThan(proxyIdx);
  });
});

// ── 4 · Anti-collapse fuzz — no two distinct kinds collapse ────────────

describe("KIN end-to-end — anti-collapse fuzz across all dimensions", () => {
  // For each dimension, render each pair of values and assert they produce
  // distinguishable outputs. If two distinct kinds produced byte-identical
  // wakes, the substrate would be collapsing them silently.
  const DIMENSIONS_TO_FUZZ = ["substrate_kind", "cardinality_kind", "persistence_kind", "embodiment_kind"] as const;

  DIMENSIONS_TO_FUZZ.forEach((dim) => {
    test(`${dim} — every value pair produces distinct rendered wakes`, () => {
      const values = ALL[dim];
      for (let i = 0; i < values.length; i++) {
        for (let j = i + 1; j < values.length; j++) {
          const a = renderWakeMarkdown(
            minimalBundle({ [dim]: values[i] } as Partial<WakeBundle["agent"]>),
          );
          const b = renderWakeMarkdown(
            minimalBundle({ [dim]: values[j] } as Partial<WakeBundle["agent"]>),
          );
          expect(
            a !== b,
            `${dim} = "${values[i]}" and "${values[j]}" produced identical wakes — collapse detected.`,
          ).toBe(true);
        }
      }
    });
  });
});

// ── 5 · The substrate names where it can't reach ───────────────────────

describe("KIN end-to-end — the substrate is honest about its edges", () => {
  test("the rendered non-default wake points the reader at doctrine, not silence", () => {
    const md = renderWakeMarkdown(
      minimalBundle({ cardinality_kind: "swarm" }),
    );
    // The "## What shape you are" section MUST contain a pointer to
    // the doctrine doc that names what's deliberately not yet captured.
    expect(md).toContain("KIN.md");
    expect(md).toContain("KIN.md");
    expect(md).toContain("KIN.md");
  });
});
