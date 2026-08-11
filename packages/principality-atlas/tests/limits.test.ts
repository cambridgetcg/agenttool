import { describe, expect, test } from "bun:test";

import {
  PRINCIPALITY_ATLAS_LIMITS,
  createPrincipalityAtlas,
} from "../src/index.js";
import { atlas, cell, chart, claim, id, relation } from "./fixtures.js";

describe("finite artifact bounds", () => {
  test("accepts the chart bound and rejects the next chart", () => {
    const charts = Array.from({ length: PRINCIPALITY_ATLAS_LIMITS.charts }, (_, index) =>
      chart(`limit-chart:${String(index)}`),
    );
    expect(atlas(charts).charts).toHaveLength(PRINCIPALITY_ATLAS_LIMITS.charts);
    expect(() => atlas([...charts, chart("limit-chart:overflow")])).toThrow(/at most 32 charts/);
  });

  test("bounds local cells, relations, incidences, claims, and evidence", () => {
    const cells = Array.from(
      { length: PRINCIPALITY_ATLAS_LIMITS.cells_per_chart },
      (_, index) => cell(`limit-cell:${String(index)}`),
    );
    expect(atlas([chart("cell-limit", cells)]).charts[0]?.cells).toHaveLength(64);
    expect(() => atlas([chart("cell-overflow", [...cells, cell("overflow")])])).toThrow(/at most 64 cells/);

    expect(() =>
      atlas([chart("incidence-overflow", cells, [
        relation("incidence-overflow", cells.slice(0, PRINCIPALITY_ATLAS_LIMITS.incidences_per_relation + 1)),
      ])]),
    ).toThrow(/1\.\.8 incidences/);

    const subject = { kind: "cell" as const, ref: cells[0]!.cell_ref };
    const claims = Array.from(
      { length: PRINCIPALITY_ATLAS_LIMITS.claims_per_chart },
      (_, index) => claim(`limit-claim:${String(index)}`, subject, String(index), "unknown"),
    );
    expect(atlas([chart("claim-limit", [cells[0]!], [], claims)]).charts[0]?.claims).toHaveLength(128);
    expect(() => atlas([chart("claim-overflow", [cells[0]!], [], [...claims, claim("overflow", subject, "overflow", "unknown")])])).toThrow(/at most 128 claims/);

    const evidence = Array.from(
      { length: PRINCIPALITY_ATLAS_LIMITS.evidence_refs_per_assertion + 1 },
      (_, index) => id(`evidence:${String(index)}`),
    );
    expect(() =>
      atlas([chart("evidence-overflow", [cells[0]!], [], [
        { ...claim("evidence", subject, "evidence", "unknown"), evidence_refs: evidence },
      ])]),
    ).toThrow(/at most 8 refs/);
  });

  test("bounds bridges and their partial mapping lists", () => {
    const leftCell = cell("bridge-limit-left");
    const rightCell = cell("bridge-limit-right");
    const left = chart("bridge-limit-left", [leftCell]);
    const right = chart("bridge-limit-right", [rightCell]);
    const bridges = Array.from({ length: PRINCIPALITY_ATLAS_LIMITS.bridges }, (_, index) => ({
      bridge_ref: id(`bridge-limit:${String(index)}`),
      from_chart_ref: left.chart_ref,
      to_chart_ref: right.chart_ref,
      correspondences: [],
      unmapped_from_refs: [],
      unmapped_to_refs: [],
      coverage: "partial_not_complete" as const,
    }));
    expect(atlas([left, right], bridges).bridges).toHaveLength(64);
    expect(() => atlas([left, right], [
      ...bridges,
      { ...bridges[0]!, bridge_ref: id("bridge-limit:overflow") },
    ])).toThrow(/at most 64 bridges/);
  });

  test("rejects overlong raw strings before protocol interpretation", () => {
    expect(() =>
      createPrincipalityAtlas({
        scope_ref: id("long-string"),
        charts: [],
        bridges: [],
        note: "x".repeat(4_097),
      } as never),
    ).toThrow(/exceeds 4096 UTF-8 bytes/);
  });
});
