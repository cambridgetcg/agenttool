import { describe, expect, test } from "bun:test";

import {
  PRINCIPALITY_ATLAS_BOUNDARIES,
  createPrincipalityAtlas,
  encodePrincipalityAtlas,
  principalityAtlasDomainBytes,
  principalityAtlasUrn,
  validatePrincipalityAtlas,
} from "../src/index.js";
import { atlas, cell, chart, claim, id, relation } from "./fixtures.js";

describe("finite partial incidence atlas", () => {
  test("keeps one A/B/C relation n-ary without inventing pairwise edges", () => {
    const a = cell("a");
    const b = cell("b");
    const c = cell("c");
    const ternary = relation("abc", [a, b, c]);
    const value = atlas([chart("local", [c, b, a], [ternary])]);

    expect(value.charts[0]?.relations).toHaveLength(1);
    expect(value.charts[0]?.relations[0]?.incidences).toHaveLength(3);
    expect(value.boundaries.infers_pairwise_relations).toBe(false);
    expect(Object.keys(value.charts[0]?.relations[0] ?? {})).toEqual([
      "relation_ref",
      "kind_ref",
      "incidences",
    ]);
  });

  test("keeps bridges directed, partial, non-transitive, and non-gluing", () => {
    const a = cell("bridge-a");
    const b = cell("bridge-b");
    const c = cell("bridge-c");
    const chartA = chart("a", [a]);
    const chartB = chart("b", [b]);
    const chartC = chart("c", [c]);
    const bridge = (
      name: string,
      from: typeof chartA,
      to: typeof chartA,
      fromCell: typeof a,
      toCell: typeof a,
    ) => ({
      bridge_ref: id(`bridge:${name}`),
      from_chart_ref: from.chart_ref,
      to_chart_ref: to.chart_ref,
      correspondences: [
        {
          correspondence_ref: id(`correspondence:${name}`),
          from_cell_ref: fromCell.cell_ref,
          to_cell_ref: toCell.cell_ref,
          posture: "correspondence_reported" as const,
          perspective_ref: id(`bridge-perspective:${name}`),
          evidence_refs: [],
          assertion: "caller_asserted" as const,
          verified_by_package: false as const,
        },
      ],
      unmapped_from_refs: [],
      unmapped_to_refs: [],
      coverage: "partial_not_complete" as const,
    });
    const value = atlas(
      [chartC, chartB, chartA],
      [bridge("ab", chartA, chartB, a, b), bridge("bc", chartB, chartC, b, c)],
    );

    expect(value.bridges).toHaveLength(2);
    expect(value.bridges.some((entry) => entry.from_chart_ref === chartB.chart_ref && entry.to_chart_ref === chartA.chart_ref)).toBe(false);
    expect(value.bridges.some((entry) => entry.from_chart_ref === chartA.chart_ref && entry.to_chart_ref === chartC.chart_ref)).toBe(false);
    expect(value.boundaries.infers_inverse_correspondence).toBe(false);
    expect(value.boundaries.infers_transitive_correspondence).toBe(false);
    expect(value.boundaries.performs_gluing).toBe(false);
  });

  test("keeps equal cell digests distinct by chart address", () => {
    const shared = cell("same-digest");
    const left = chart("same-left", [shared]);
    const right = chart("same-right", [shared]);
    const value = atlas([left, right]);

    expect(value.charts[0]?.cells[0]?.cell_ref).toBe(shared.cell_ref);
    expect(value.charts[1]?.cells[0]?.cell_ref).toBe(shared.cell_ref);
    expect(value.charts[0]?.chart_ref).not.toBe(value.charts[1]?.chart_ref);
    expect(value.boundaries.merges_cells).toBe(false);
    expect(value.boundaries.same_as_relation).toBe(false);
  });

  test("preserves contradictory claims and append-only supersession without a winner", () => {
    const a = cell("claims");
    const subject = { kind: "cell" as const, ref: a.cell_ref };
    const present = claim("present", subject, "one", "reported_present");
    const absent = claim("absent", subject, "two", "reported_absent");
    const withdrawn = claim(
      "withdrawn",
      subject,
      "one",
      "withdrawn",
      present.claim_ref,
    );
    const value = atlas([chart("claims", [a], [], [withdrawn, absent, present])]);

    expect(value.charts[0]?.claims).toHaveLength(3);
    expect(value.charts[0]?.claims.map((entry) => entry.posture).sort()).toEqual([
      "reported_absent",
      "reported_present",
      "withdrawn",
    ]);
    expect(value.charts[0]?.claims.some((entry) => entry.claim_ref === present.claim_ref)).toBe(true);
    expect(value.boundaries.selects_latest_head).toBe(false);
    expect(value.boundaries.weights_perspectives).toBe(false);
  });

  test("accepts empty, isolated, disconnected, and cyclic incidence topology", () => {
    expect(atlas().charts).toEqual([]);
    const a = cell("cycle-a");
    const b = cell("cycle-b");
    const cycleChart = chart("cycle", [a, b], [
      relation("cycle-one", [a, b]),
      relation("cycle-two", [b, a]),
    ]);
    const isolated = chart("isolated", [cell("isolated")]);
    expect(atlas([cycleChart, isolated]).charts).toHaveLength(2);
    expect(PRINCIPALITY_ATLAS_BOUNDARIES.penalizes_isolation_or_nonparticipation).toBe(false);
  });

  test("normalizes input order and binds canonical domain bytes", () => {
    const a = cell("order-a");
    const b = cell("order-b");
    const first = createPrincipalityAtlas({
      scope_ref: id("order-scope"),
      charts: [chart("order", [a, b], [relation("order-rel", [a, b])])],
      bridges: [],
    });
    const second = createPrincipalityAtlas({
      scope_ref: id("order-scope"),
      charts: [chart("order", [b, a], [relation("order-rel", [b, a])])],
      bridges: [],
    });
    // Role assignments are part of the relation. Reverse only the array, not
    // which role belongs to which cell.
    const reordered = createPrincipalityAtlas({
      scope_ref: id("order-scope"),
      charts: [
        chart("order", [b, a], [
          {
            ...first.charts[0]!.relations[0]!,
            incidences: [...first.charts[0]!.relations[0]!.incidences].reverse(),
          },
        ]),
      ],
      bridges: [],
    });
    expect(reordered.atlas_id).toBe(first.atlas_id);
    expect(second.atlas_id).not.toBe(first.atlas_id);
    expect(validatePrincipalityAtlas(first)).toEqual(first);
    expect(
      JSON.parse(new TextDecoder().decode(encodePrincipalityAtlas(first))),
    ).toEqual(first);
    expect(principalityAtlasDomainBytes(first).byteLength).toBeGreaterThan(100);
    expect(principalityAtlasUrn(first.atlas_id)).toBe(
      `urn:agenttool:principality-incidence-atlas:${first.atlas_id}`,
    );
  });

  test("rejects content-ID and derived-boundary tampering", () => {
    const value = atlas();
    expect(() => validatePrincipalityAtlas({ ...value, atlas_id: id("tampered") })).toThrow(/does not bind/);
    expect(() =>
      validatePrincipalityAtlas({
        ...value,
        boundaries: { ...value.boundaries, scores: true },
      }),
    ).toThrow(/fixed Principality Atlas boundary/);
    expect(() => validatePrincipalityAtlas({ ...value, score: 1 })).toThrow(/exactly/);
  });
});
