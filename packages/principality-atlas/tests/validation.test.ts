import { describe, expect, test } from "bun:test";

import { createPrincipalityAtlas } from "../src/index.js";
import { atlas, cell, chart, claim, id, relation } from "./fixtures.js";

describe("semantic validation", () => {
  test("rejects unknown endpoints and duplicate incidences", () => {
    const a = cell("known");
    const unknown = cell("unknown");
    expect(() =>
      atlas([
        chart("bad-endpoint", [a], [relation("bad-endpoint", [a, unknown])]),
      ]),
    ).toThrow(/not a cell in this chart/);
    const duplicate = relation("duplicate-incidence", [a]);
    expect(() =>
      atlas([
        chart("duplicate-incidence", [a], [
          { ...duplicate, incidences: [duplicate.incidences[0]!, duplicate.incidences[0]!] },
        ]),
      ]),
    ).toThrow(/duplicate cell\/role incidences/);
  });

  test("rejects duplicate typed relations and correspondence mappings", () => {
    const a = cell("duplicate-relation-a");
    const b = cell("duplicate-relation-b");
    const first = relation("duplicate-first", [a, b]);
    expect(() =>
      atlas([
        chart("duplicate-relations", [a, b], [
          first,
          { ...first, relation_ref: id("relation:duplicate-second") },
        ]),
      ]),
    ).toThrow(/repeat an identical typed incidence relation/);

    const left = chart("duplicate-map-left", [a]);
    const right = chart("duplicate-map-right", [b]);
    const correspondence = {
      correspondence_ref: id("correspondence:first"),
      from_cell_ref: a.cell_ref,
      to_cell_ref: b.cell_ref,
      posture: "analogy_reported" as const,
      perspective_ref: id("correspondence:perspective"),
      evidence_refs: [],
      assertion: "caller_asserted" as const,
      verified_by_package: false as const,
    };
    expect(() =>
      atlas([left, right], [
        {
          bridge_ref: id("bridge:duplicate-map"),
          from_chart_ref: left.chart_ref,
          to_chart_ref: right.chart_ref,
          correspondences: [
            correspondence,
            { ...correspondence, correspondence_ref: id("correspondence:second") },
          ],
          unmapped_from_refs: [],
          unmapped_to_refs: [],
          coverage: "partial_not_complete",
        },
      ]),
    ).toThrow(/repeat an identical reported correspondence/);
  });

  test("rejects self, unknown, cross-subject, cross-perspective, and cyclic supersession", () => {
    const a = cell("supersession-a");
    const b = cell("supersession-b");
    const subjectA = { kind: "cell" as const, ref: a.cell_ref };
    const subjectB = { kind: "cell" as const, ref: b.cell_ref };
    const base = claim("base", subjectA, "one", "reported_present");
    expect(() =>
      atlas([
        chart("self", [a], [], [
          { ...base, supersedes_claim_ref: base.claim_ref },
        ]),
      ]),
    ).toThrow(/self-supersession/);
    expect(() =>
      atlas([
        chart("unknown", [a], [], [
          { ...base, supersedes_claim_ref: id("claim:missing") },
        ]),
      ]),
    ).toThrow(/unknown supersedes_claim_ref/);
    expect(() =>
      atlas([
        chart("cross-subject", [a, b], [], [
          base,
          claim("cross-subject", subjectB, "one", "reported_absent", base.claim_ref),
        ]),
      ]),
    ).toThrow(/same subject/);
    expect(() =>
      atlas([
        chart("cross-perspective", [a], [], [
          base,
          claim("cross-perspective", subjectA, "two", "reported_absent", base.claim_ref),
        ]),
      ]),
    ).toThrow(/same perspective/);

    const one = claim("cycle-one", subjectA, "cycle", "reported_present", id("claim:cycle-two"));
    const two = claim("cycle-two", subjectA, "cycle", "withdrawn", one.claim_ref);
    expect(() => atlas([chart("cycle", [a], [], [one, two])])).toThrow(/acyclic/);
  });

  test("rejects bridge identity, endpoint, and mapped/unmapped conflicts", () => {
    const a = cell("bridge-validation-a");
    const b = cell("bridge-validation-b");
    const left = chart("bridge-validation-left", [a]);
    const right = chart("bridge-validation-right", [b]);
    const base = {
      bridge_ref: id("bridge:validation"),
      from_chart_ref: left.chart_ref,
      to_chart_ref: right.chart_ref,
      correspondences: [
        {
          correspondence_ref: id("correspondence:validation"),
          from_cell_ref: a.cell_ref,
          to_cell_ref: b.cell_ref,
          posture: "correspondence_reported" as const,
          perspective_ref: id("correspondence:validation-perspective"),
          evidence_refs: [],
          assertion: "caller_asserted" as const,
          verified_by_package: false as const,
        },
      ],
      unmapped_from_refs: [],
      unmapped_to_refs: [],
      coverage: "partial_not_complete" as const,
    };
    expect(() => atlas([left], [{ ...base, to_chart_ref: left.chart_ref }])).toThrow(/distinct charts/);
    expect(() => atlas([left, right], [{ ...base, unmapped_from_refs: [a.cell_ref] }])).toThrow(/both mapped and unmapped/);
    expect(() => atlas([left, right], [{ ...base, unmapped_to_refs: [id("unknown-cell")] }])).toThrow(/belong to their endpoint charts/);
  });

  test("rejects extra semantic fields including consent, authority, score, and sameAs", () => {
    for (const extra of ["consent", "authority", "score", "rank", "sameAs", "latest"] as const) {
      expect(() =>
        createPrincipalityAtlas({
          scope_ref: id(`extra:${extra}`),
          charts: [],
          bridges: [],
          [extra]: false,
        } as never),
      ).toThrow(/must contain exactly/);
    }
  });
});
