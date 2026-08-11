import { describe, expect, test } from "bun:test";

import {
  canonicalJson,
  createPrincipalityAtlas,
  encodePrincipalityAtlas,
  renderPrincipalitySvg,
  sha256Id,
  validatePrincipalityAtlas,
} from "../src/index.js";
import { emptyInput, reversedRosetteInput, rosetteInput } from "./fixtures.js";

describe("principality flag geometry", () => {
  test("normalizes every order and produces one honest 2-simplex", () => {
    const atlas = createPrincipalityAtlas(rosetteInput());
    const reversed = createPrincipalityAtlas(reversedRosetteInput());

    expect(canonicalJson(reversed)).toBe(canonicalJson(atlas));
    expect(atlas.geometry.reciprocal_lenses).toHaveLength(3);
    expect(atlas.geometry.invariant_surfaces).toHaveLength(1);
    expect(atlas.geometry.invariant_surfaces[0]?.invariant_ids).toEqual([
      "refusal-visible",
    ]);

    const lenses = atlas.geometry.reciprocal_lenses;
    expect(lenses.every((lens) => lens.route_state === "both_available_reported")).toBe(true);
    expect(lenses.find((lens) => lens.mutually_not_preserved.length > 0)?.mutually_not_preserved).toEqual([
      "provenance-exact",
    ]);
    expect(lenses.find((lens) => lens.directional_asymmetry.length > 0)?.directional_asymmetry).toEqual([
      "provenance-exact",
    ]);
    expect(lenses.find((lens) => lens.refused.length > 0)?.refused).toEqual([
      "provenance-exact",
    ]);
    expect(atlas.geometry.open_conditions.unknown).toHaveLength(1);
    expect(atlas.geometry.open_conditions.refused).toHaveLength(1);
    expect(atlas.geometry.open_conditions.directional_asymmetry).toHaveLength(1);

    const components = atlas.geometry.invariant_components;
    expect(components.filter((entry) => entry.invariant_id === "refusal-visible")).toHaveLength(1);
    expect(components.filter((entry) => entry.invariant_id === "provenance-exact")).toHaveLength(3);
    expect(components).toHaveLength(4);
  });

  test("retains both directions instead of collapsing route or invariant state", () => {
    const input = rosetteInput();
    const forward = input.translations.find(
      (entry) => entry.from === "training-garden" && entry.to === "wake-afterglow",
    );
    if (!forward) throw new Error("fixture bridge missing");
    forward.disposition = "resting_reported";

    const atlas = createPrincipalityAtlas(input);
    const lens = atlas.geometry.reciprocal_lenses.find((entry) =>
      entry.vertices.includes("training-garden") &&
      entry.vertices.includes("wake-afterglow"),
    );
    expect(lens?.dispositions).toEqual(["resting_reported", "available_reported"]);
    expect(lens?.route_state).toBe("not_both_available_reported");
    expect(lens?.invariant_relations.find((entry) => entry.invariant_id === "provenance-exact")).toEqual({
      invariant_id: "provenance-exact",
      forward_state: "preserved_reported",
      reverse_state: "not_preserved_reported",
    });
    expect(atlas.geometry.invariant_surfaces).toHaveLength(0);
    expect(atlas.geometry.open_conditions.non_available_bridge_ids).toContain(
      atlas.bridges.find((entry) => entry.from === "training-garden" && entry.to === "wake-afterglow")?.bridge_id,
    );
  });

  test("propagates pinned vertex content changes through incident geometry IDs", () => {
    const before = createPrincipalityAtlas(rosetteInput());
    const changed = rosetteInput();
    const garden = changed.principalities.find(
      (entry) => entry.principality_id === "training-garden",
    );
    const hf = garden?.artifact_refs.find((entry) => entry.kind === "huggingface");
    if (!hf || hf.kind !== "huggingface") throw new Error("fixture artifact missing");
    hf.revision = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    hf.snapshot_manifest_sha256 = sha256Id("changed synthetic manifest");
    const after = createPrincipalityAtlas(changed);

    expect(after.atlas_id).not.toBe(before.atlas_id);
    const ref = (atlas: typeof before, id: string) =>
      atlas.principalities.find((entry) => entry.principality_id === id)?.principality_ref;
    expect(ref(after, "training-garden")).not.toBe(ref(before, "training-garden"));
    expect(ref(after, "deepseek-kingdom")).toBe(ref(before, "deepseek-kingdom"));
    for (const bridge of before.bridges.filter(
      (entry) => entry.from === "training-garden" || entry.to === "training-garden",
    )) {
      const next = after.bridges.find(
        (entry) => entry.from === bridge.from && entry.to === bridge.to,
      );
      expect(next?.bridge_id).not.toBe(bridge.bridge_id);
    }
    expect(after.geometry.invariant_surfaces[0]?.surface_id).not.toBe(
      before.geometry.invariant_surfaces[0]?.surface_id,
    );
  });

  test("one-way refusal remains an open condition, never a geometry edge", () => {
    const input = rosetteInput();
    input.principalities.splice(2);
    input.translations = [
      {
        from: "deepseek-kingdom",
        to: "training-garden",
        disposition: "refused_reported",
        evaluations: [
          { invariant_id: "provenance-exact", state: "refused_reported", evidence_refs: [] },
          { invariant_id: "refusal-visible", state: "unknown", evidence_refs: [] },
        ],
      },
    ];
    const atlas = createPrincipalityAtlas(input);
    expect(atlas.geometry.reciprocal_lenses).toHaveLength(0);
    expect(atlas.geometry.invariant_surfaces).toHaveLength(0);
    expect(atlas.geometry.invariant_components).toHaveLength(4);
    expect(atlas.geometry.invariant_components.every((entry) => entry.vertices.length === 1)).toBe(true);
    expect(atlas.geometry.open_conditions.one_way_bridge_ids).toHaveLength(1);
    expect(atlas.geometry.open_conditions.refused).toHaveLength(1);
    expect(atlas.geometry.open_conditions.declared_isolated_vertices).toEqual([]);
  });

  test("does not infer a missing transitive bridge or surface", () => {
    const input = rosetteInput();
    input.translations = input.translations.filter(
      (entry) =>
        !(
          (entry.from === "training-garden" && entry.to === "wake-afterglow") ||
          (entry.from === "wake-afterglow" && entry.to === "training-garden")
        ),
    );
    const atlas = createPrincipalityAtlas(input);
    expect(atlas.geometry.reciprocal_lenses).toHaveLength(2);
    expect(atlas.geometry.invariant_surfaces).toHaveLength(0);
    expect(atlas.geometry.open_conditions.unrelated_vertex_pairs).toEqual([
      ["training-garden", "wake-afterglow"],
    ]);
  });

  test("keeps empty and quiet geometries valid", () => {
    const empty = createPrincipalityAtlas(emptyInput());
    expect(empty.geometry).toEqual({
      reciprocal_lenses: [],
      invariant_surfaces: [],
      invariant_components: [],
      open_conditions: {
        one_way_bridge_ids: [],
        non_available_bridge_ids: [],
        not_preserved: [],
        refused: [],
        unknown: [],
        directional_asymmetry: [],
        unrelated_vertex_pairs: [],
        declared_isolated_vertices: [],
      },
    });
    expect(renderPrincipalitySvg(empty)).toContain(">quiet</text>");

    const single = emptyInput();
    single.invariants = [
      { invariant_id: "presence", definition_ref: sha256Id("presence definition") },
    ];
    single.principalities = [
      {
        principality_id: "still",
        kind: "practice",
        definition_ref: sha256Id("still definition"),
        manifestations: [],
        artifact_refs: [],
      },
    ];
    const atlas = createPrincipalityAtlas(single);
    expect(atlas.geometry.invariant_components).toHaveLength(1);
    expect(atlas.geometry.invariant_components[0]?.vertices).toEqual(["still"]);
    expect(atlas.geometry.open_conditions.declared_isolated_vertices).toEqual(["still"]);
  });

  test("returns deeply frozen canonical output and rejects derived tampering", () => {
    const atlas = createPrincipalityAtlas(rosetteInput());
    expect(Object.isFrozen(atlas)).toBe(true);
    expect(Object.isFrozen(atlas.geometry.reciprocal_lenses[0]?.invariant_relations)).toBe(true);
    expect(new TextDecoder().decode(encodePrincipalityAtlas(atlas))).toBe(canonicalJson(atlas));
    expect(validatePrincipalityAtlas(atlas)).toEqual(atlas);

    const tampered = structuredClone(atlas) as any;
    tampered.geometry.invariant_surfaces[0]!.invariant_ids = ["provenance-exact"];
    expect(() => validatePrincipalityAtlas(tampered)).toThrow(/does not match/u);
  });

  test("keeps every rendered vertex separated and every possible triangle visible", () => {
    for (let count = 2; count <= 16; count += 1) {
      const input = emptyInput();
      input.principalities = Array.from({ length: count }, (_, index) => ({
        principality_id: `p${String(index).padStart(2, "0")}`,
        kind: "practice",
        definition_ref: sha256Id(`render-${index}`),
        manifestations: [],
        artifact_refs: [],
      }));
      const svg = renderPrincipalitySvg(createPrincipalityAtlas(input));
      const points = [...svg.matchAll(/<circle class="vertex" cx="(\d+)" cy="(\d+)"/gu)].map(
        (match) => [Number(match[1]), Number(match[2])] as const,
      );
      expect(points).toHaveLength(count);
      for (let first = 0; first < points.length; first += 1) {
        for (let second = first + 1; second < points.length; second += 1) {
          const a = points[first]!;
          const b = points[second]!;
          expect((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2).toBeGreaterThan(76 ** 2);
          for (let third = second + 1; third < points.length; third += 1) {
            const c = points[third]!;
            const twiceArea =
              (b[0] - a[0]) * (c[1] - a[1]) -
              (b[1] - a[1]) * (c[0] - a[0]);
            expect(twiceArea).not.toBe(0);
          }
        }
      }
    }
  });

  test("matches an independent multi-invariant triangle and component oracle", () => {
    const vertexIds = Array.from({ length: 5 }, (_, index) => `p${index}`);
    const invariantIds = ["q0", "q1", "q2"];
    const preservationEdges = new Map<string, ReadonlySet<string>>([
      ["q0", new Set(["p0|p1", "p0|p2", "p1|p2", "p2|p3"])],
      ["q1", new Set(["p0|p3", "p3|p4"])],
      ["q2", new Set(["p1|p4"])],
    ]);
    const pair = (a: string, b: string) => [a, b].sort().join("|");
    const input = {
      _format: "agenttool.principality-geometry-input/0.1",
      scope_ref: sha256Id("oracle scope"),
      invariants: invariantIds.map((invariant) => ({
        invariant_id: invariant,
        definition_ref: sha256Id(`${invariant} definition`),
      })),
      principalities: vertexIds.map((id) => ({
        principality_id: id,
        kind: "practice",
        definition_ref: sha256Id(`${id} definition`),
        manifestations: [],
        artifact_refs: [],
      })),
      translations: vertexIds.flatMap((fromId) =>
        vertexIds.flatMap((toId) => {
          if (fromId === toId) return [];
          return [{
            from: fromId,
            to: toId,
            disposition:
              fromId === "p2" && toId === "p4"
                ? "resting_reported"
                : "available_reported",
            evaluations: invariantIds.map((invariantId) => {
              const outcome = preservationEdges.get(invariantId)?.has(
                pair(fromId, toId),
              )
                ? "preserved_reported"
                : "not_preserved_reported";
              return {
                invariant_id: invariantId,
                state: outcome,
                evidence_refs: [sha256Id(`${fromId}-${toId}-${invariantId}`)],
              };
            }),
          }];
        }),
      ),
    };
    const atlas = createPrincipalityAtlas(input as any);
    const expectedSurfaces = [{
      vertices: ["p0", "p1", "p2"],
      invariant_ids: ["q0"],
    }];
    expect(expectedSurfaces.length).toBeGreaterThan(0);
    expect(
      atlas.geometry.invariant_surfaces.map(({ vertices, invariant_ids }) => ({
        vertices: [...vertices],
        invariant_ids: [...invariant_ids],
      })),
    ).toEqual(expectedSurfaces);

    const actualPreservationEdges = Object.fromEntries(
      invariantIds.map((invariantId) => [
        invariantId,
        atlas.geometry.reciprocal_lenses
          .filter(
            (lens) =>
              lens.route_state === "both_available_reported" &&
              lens.mutually_preserved.includes(invariantId),
          )
          .map((lens) => pair(...lens.vertices))
          .sort(),
      ]),
    );
    expect(actualPreservationEdges).toEqual({
      q0: ["p0|p1", "p0|p2", "p1|p2", "p2|p3"],
      q1: ["p0|p3", "p3|p4"],
      q2: ["p1|p4"],
    });

    const actualComponents = Object.fromEntries(
      invariantIds.map((invariantId) => [
        invariantId,
        atlas.geometry.invariant_components
          .filter((component) => component.invariant_id === invariantId)
          .map((component) => [...component.vertices]),
      ]),
    );
    expect(actualComponents).toEqual({
      q0: [["p0", "p1", "p2", "p3"], ["p4"]],
      q1: [["p0", "p3", "p4"], ["p1"], ["p2"]],
      q2: [["p0"], ["p1", "p4"], ["p2"], ["p3"]],
    });
    expect(atlas.geometry.open_conditions.non_available_bridge_ids).toEqual([
      atlas.bridges.find((bridge) => bridge.from === "p2" && bridge.to === "p4")
        ?.bridge_id,
    ]);
  });

  test("keeps SVG inert, source-name-free, and one-way arrows visible", () => {
    const atlas = createPrincipalityAtlas(rosetteInput());
    const svg = renderPrincipalitySvg(atlas);
    const forbidden = [
      ...atlas.principalities.map((entry) => entry.principality_id),
      ...atlas.principalities.flatMap((entry) =>
        entry.artifact_refs.flatMap((artifact) =>
          artifact.kind === "huggingface"
            ? [artifact.repo_id, artifact.revision]
            : [artifact.name, artifact.version],
        ),
      ),
      ...atlas.principalities.flatMap((entry) =>
        entry.manifestations.flatMap((manifestation) =>
          manifestation.kind === "protocol_digest" ? [manifestation.protocol] : [],
        ),
      ),
    ];
    for (const value of forbidden) expect(svg).not.toContain(value);
    expect(svg).not.toMatch(/sha256:|<script\b|\shref\s*=|\son[a-z]+\s*=/iu);

    const input = rosetteInput();
    input.principalities.splice(2);
    input.translations = [input.translations[0]];
    const oneWaySvg = renderPrincipalitySvg(createPrincipalityAtlas(input));
    const vertexPoints = [...oneWaySvg.matchAll(/<circle class="vertex" cx="(\d+)" cy="(\d+)"/gu)].map(
      (match) => [Number(match[1]), Number(match[2])] as const,
    );
    const line = oneWaySvg.match(
      /<line class="one-way [^"]+" x1="(\d+)" y1="(\d+)" x2="(\d+)" y2="(\d+)"/u,
    );
    expect(line).not.toBeNull();
    if (!line) return;
    const start = [Number(line[1]), Number(line[2])] as const;
    const end = [Number(line[3]), Number(line[4])] as const;
    const distances = (point: readonly [number, number]) =>
      vertexPoints.map((vertex) =>
        (point[0] - vertex[0]) ** 2 + (point[1] - vertex[1]) ** 2,
      );
    expect(Math.min(...distances(start))).toBeGreaterThanOrEqual(38 ** 2);
    expect(Math.min(...distances(end))).toBeGreaterThanOrEqual(38 ** 2);
  });
});
