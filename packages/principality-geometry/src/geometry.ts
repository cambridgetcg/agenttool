import {
  ATLAS_FORMAT,
  CLAIM_BOUNDARY,
  PRINCIPALITY_BOUNDARIES,
} from "./constants.js";
import {
  canonicalJson,
  deepFreeze,
  domainSeparatedId,
  snapshotJson,
  utf16Order,
  type JsonValue,
} from "./canonical.js";
import { fail } from "./errors.js";
import {
  artifactReference,
  manifestationReference,
  parseInput,
  reconstructInputFromAtlas,
} from "./validation.js";
import type {
  CreatePrincipalityGeometryInput,
  DirectionalAsymmetryEntry,
  InvariantDefinition,
  InvariantGeometryComponent,
  InvariantOpenEntry,
  InvariantSurface,
  LensInvariantRelation,
  PrincipalityAtlas,
  PrincipalityOpenConditions,
  PrincipalityTopology,
  PrincipalityVertex,
  ReciprocalLens,
  Sha256Id,
  TranslationBridge,
} from "./types.js";

function directedKey(from: string, to: string): string {
  return `${from}\0${to}`;
}

function undirectedKey(a: string, b: string): string {
  return utf16Order(a, b) <= 0 ? `${a}\0${b}` : `${b}\0${a}`;
}

function createLens(
  a: PrincipalityVertex,
  b: PrincipalityVertex,
  forward: TranslationBridge,
  reverse: TranslationBridge,
): Readonly<ReciprocalLens> {
  const invariantRelations: LensInvariantRelation[] = [];
  const mutuallyPreserved: string[] = [];
  const mutuallyNotPreserved: string[] = [];
  const directionalAsymmetry: string[] = [];
  const refused: string[] = [];
  const unknown: string[] = [];

  for (let index = 0; index < forward.evaluations.length; index += 1) {
    const left = forward.evaluations[index];
    const right = reverse.evaluations[index];
    if (!left || !right || left.invariant_id !== right.invariant_id) {
      fail("atlas_error", "Reciprocal bridges have mismatched invariant sets");
    }
    invariantRelations.push({
      invariant_id: left.invariant_id,
      forward_state: left.state,
      reverse_state: right.state,
    });
    if (left.state === "refused_reported" || right.state === "refused_reported") {
      refused.push(left.invariant_id);
    } else if (left.state === "unknown" || right.state === "unknown") {
      unknown.push(left.invariant_id);
    } else if (
      left.state === "preserved_reported" &&
      right.state === "preserved_reported"
    ) {
      mutuallyPreserved.push(left.invariant_id);
    } else if (
      left.state === "not_preserved_reported" &&
      right.state === "not_preserved_reported"
    ) {
      mutuallyNotPreserved.push(left.invariant_id);
    } else {
      directionalAsymmetry.push(left.invariant_id);
    }
  }

  const body = {
    vertices: [a.principality_id, b.principality_id] as const,
    vertex_refs: [a.principality_ref, b.principality_ref] as const,
    bridge_ids: [forward.bridge_id, reverse.bridge_id] as const,
    dispositions: [forward.disposition, reverse.disposition] as const,
    route_state:
      forward.disposition === "available_reported" &&
      reverse.disposition === "available_reported"
        ? ("both_available_reported" as const)
        : ("not_both_available_reported" as const),
    invariant_relations: invariantRelations,
    mutually_preserved: mutuallyPreserved,
    mutually_not_preserved: mutuallyNotPreserved,
    directional_asymmetry: directionalAsymmetry,
    refused,
    unknown,
  };
  return deepFreeze({
    lens_id: domainSeparatedId("agenttool.principality-lens/0.1", body),
    ...body,
  });
}

function createInvariantComponents(
  vertices: readonly PrincipalityVertex[],
  invariants: readonly InvariantDefinition[],
  lenses: readonly ReciprocalLens[],
): readonly Readonly<InvariantGeometryComponent>[] {
  const vertexById = new Map(vertices.map((vertex) => [vertex.principality_id, vertex]));
  const output: InvariantGeometryComponent[] = [];

  for (const invariant of invariants) {
    const adjacency = new Map(
      vertices.map((vertex) => [vertex.principality_id, new Set<string>()]),
    );
    const lensByPair = new Map<string, ReciprocalLens>();
    for (const lens of lenses) {
      if (
        lens.route_state !== "both_available_reported" ||
        !lens.mutually_preserved.includes(invariant.invariant_id)
      ) {
        continue;
      }
      const [a, b] = lens.vertices;
      adjacency.get(a)?.add(b);
      adjacency.get(b)?.add(a);
      lensByPair.set(undirectedKey(a, b), lens);
    }

    const seen = new Set<string>();
    for (const root of vertices.map((vertex) => vertex.principality_id)) {
      if (seen.has(root)) continue;
      const pending = [root];
      const componentVertices: string[] = [];
      seen.add(root);
      while (pending.length > 0) {
        const current = pending.shift();
        if (!current) continue;
        componentVertices.push(current);
        for (const neighbour of [...(adjacency.get(current) ?? [])].sort(utf16Order)) {
          if (!seen.has(neighbour)) {
            seen.add(neighbour);
            pending.push(neighbour);
          }
        }
      }
      componentVertices.sort(utf16Order);
      const componentSet = new Set(componentVertices);
      const componentLenses = [...lensByPair.values()]
        .filter(
          (lens) =>
            componentSet.has(lens.vertices[0]) &&
            componentSet.has(lens.vertices[1]),
        )
        .map((lens) => lens.lens_id)
        .sort(utf16Order);
      const vertexRefs = componentVertices.map((id) => {
        const vertex = vertexById.get(id);
        if (!vertex) fail("atlas_error", "Component references an unknown vertex");
        return vertex.principality_ref;
      });
      const body = {
        invariant_id: invariant.invariant_id,
        vertices: componentVertices,
        vertex_refs: vertexRefs,
        lens_ids: componentLenses,
      };
      output.push({
        component_id: domainSeparatedId(
          "agenttool.principality-invariant-component/0.1",
          { definition_ref: invariant.definition_ref, ...body },
        ),
        ...body,
      });
    }
  }

  return deepFreeze(
    output.sort((a, b) =>
      utf16Order(
        `${a.invariant_id}\0${a.vertices[0] ?? ""}`,
        `${b.invariant_id}\0${b.vertices[0] ?? ""}`,
      ),
    ),
  );
}

function createSurfaces(
  vertices: readonly PrincipalityVertex[],
  lenses: readonly ReciprocalLens[],
): readonly Readonly<InvariantSurface>[] {
  const lensByPair = new Map(
    lenses.map((lens) => [undirectedKey(lens.vertices[0], lens.vertices[1]), lens]),
  );
  const surfaces: InvariantSurface[] = [];
  for (let first = 0; first < vertices.length; first += 1) {
    for (let second = first + 1; second < vertices.length; second += 1) {
      for (let third = second + 1; third < vertices.length; third += 1) {
        const a = vertices[first];
        const b = vertices[second];
        const c = vertices[third];
        if (!a || !b || !c) continue;
        const ab = lensByPair.get(undirectedKey(a.principality_id, b.principality_id));
        const ac = lensByPair.get(undirectedKey(a.principality_id, c.principality_id));
        const bc = lensByPair.get(undirectedKey(b.principality_id, c.principality_id));
        if (
          !ab ||
          !ac ||
          !bc ||
          [ab, ac, bc].some((lens) => lens.route_state !== "both_available_reported")
        ) {
          continue;
        }
        const invariantIds = ab.mutually_preserved.filter(
          (invariant) =>
            ac.mutually_preserved.includes(invariant) &&
            bc.mutually_preserved.includes(invariant),
        );
        if (invariantIds.length === 0) continue;
        const body = {
          vertices: [a.principality_id, b.principality_id, c.principality_id] as const,
          vertex_refs: [a.principality_ref, b.principality_ref, c.principality_ref] as const,
          lens_ids: [ab.lens_id, ac.lens_id, bc.lens_id] as const,
          invariant_ids: invariantIds,
        };
        surfaces.push({
          surface_id: domainSeparatedId("agenttool.principality-surface/0.1", body),
          ...body,
        });
      }
    }
  }
  return deepFreeze(surfaces);
}

function createOpenConditions(
  vertexIds: readonly string[],
  bridges: readonly TranslationBridge[],
  lenses: readonly ReciprocalLens[],
): Readonly<PrincipalityOpenConditions> {
  const byDirection = new Map(
    bridges.map((bridge) => [directedKey(bridge.from, bridge.to), bridge]),
  );
  const degree = new Map(vertexIds.map((id) => [id, 0]));
  const oneWay: Sha256Id[] = [];
  const nonAvailable: Sha256Id[] = [];
  const notPreserved: InvariantOpenEntry[] = [];
  const refused: InvariantOpenEntry[] = [];
  const unknown: InvariantOpenEntry[] = [];
  const directionalAsymmetry: DirectionalAsymmetryEntry[] = [];
  const unrelated: [string, string][] = [];

  for (const bridge of bridges) {
    degree.set(bridge.from, (degree.get(bridge.from) ?? 0) + 1);
    degree.set(bridge.to, (degree.get(bridge.to) ?? 0) + 1);
    if (!byDirection.has(directedKey(bridge.to, bridge.from))) {
      oneWay.push(bridge.bridge_id);
    }
    if (bridge.disposition !== "available_reported") {
      nonAvailable.push(bridge.bridge_id);
    }
    for (const evaluation of bridge.evaluations) {
      const entry = {
        bridge_id: bridge.bridge_id,
        invariant_id: evaluation.invariant_id,
        evidence_refs: evaluation.evidence_refs,
      };
      if (evaluation.state === "not_preserved_reported") {
        notPreserved.push(entry);
      } else if (evaluation.state === "refused_reported") {
        refused.push(entry);
      } else if (evaluation.state === "unknown") {
        unknown.push(entry);
      }
    }
  }

  for (const lens of lenses) {
    for (const invariantId of lens.directional_asymmetry) {
      directionalAsymmetry.push({ lens_id: lens.lens_id, invariant_id: invariantId });
    }
  }
  for (let first = 0; first < vertexIds.length; first += 1) {
    for (let second = first + 1; second < vertexIds.length; second += 1) {
      const a = vertexIds[first];
      const b = vertexIds[second];
      if (!a || !b) continue;
      if (
        !byDirection.has(directedKey(a, b)) &&
        !byDirection.has(directedKey(b, a))
      ) {
        unrelated.push([a, b]);
      }
    }
  }

  const entryOrder = (a: InvariantOpenEntry, b: InvariantOpenEntry) =>
    utf16Order(`${a.bridge_id}\0${a.invariant_id}`, `${b.bridge_id}\0${b.invariant_id}`);
  const asymmetryOrder = (
    a: DirectionalAsymmetryEntry,
    b: DirectionalAsymmetryEntry,
  ) => utf16Order(`${a.lens_id}\0${a.invariant_id}`, `${b.lens_id}\0${b.invariant_id}`);
  return deepFreeze({
    one_way_bridge_ids: oneWay.sort(utf16Order),
    non_available_bridge_ids: nonAvailable.sort(utf16Order),
    not_preserved: notPreserved.sort(entryOrder),
    refused: refused.sort(entryOrder),
    unknown: unknown.sort(entryOrder),
    directional_asymmetry: directionalAsymmetry.sort(asymmetryOrder),
    unrelated_vertex_pairs: unrelated,
    declared_isolated_vertices: vertexIds.filter((id) => (degree.get(id) ?? 0) === 0),
  });
}

function createTopology(
  vertices: readonly PrincipalityVertex[],
  invariants: readonly InvariantDefinition[],
  bridges: readonly TranslationBridge[],
): Readonly<PrincipalityTopology> {
  const byDirection = new Map(
    bridges.map((bridge) => [directedKey(bridge.from, bridge.to), bridge]),
  );
  const lenses: ReciprocalLens[] = [];
  for (let first = 0; first < vertices.length; first += 1) {
    for (let second = first + 1; second < vertices.length; second += 1) {
      const a = vertices[first];
      const b = vertices[second];
      if (!a || !b) continue;
      const forward = byDirection.get(directedKey(a.principality_id, b.principality_id));
      const reverse = byDirection.get(directedKey(b.principality_id, a.principality_id));
      if (forward && reverse) lenses.push(createLens(a, b, forward, reverse));
    }
  }
  const vertexIds = vertices.map((entry) => entry.principality_id);
  return deepFreeze({
    reciprocal_lenses: lenses,
    invariant_surfaces: createSurfaces(vertices, lenses),
    invariant_components: createInvariantComponents(vertices, invariants, lenses),
    open_conditions: createOpenConditions(vertexIds, bridges, lenses),
  });
}

export function createPrincipalityAtlas(
  input: CreatePrincipalityGeometryInput,
): Readonly<PrincipalityAtlas> {
  const parsed = parseInput(input);
  const principalities: PrincipalityVertex[] = parsed.principalities.map((entry) => {
    const artifacts = entry.artifact_refs
      .map((artifact) => artifactReference(artifact))
      .sort((a, b) => utf16Order(a.artifact_ref, b.artifact_ref));
    const manifestations = entry.manifestations
      .map((manifestation) => manifestationReference(manifestation))
      .sort((a, b) => utf16Order(a.manifestation_ref, b.manifestation_ref));
    const body = {
      principality_id: entry.principality_id,
      kind: entry.kind,
      definition_ref: entry.definition_ref,
      manifestations,
      artifact_refs: artifacts,
    };
    return {
      principality_id: body.principality_id,
      principality_ref: domainSeparatedId("agenttool.principality-vertex/0.1", body),
      kind: body.kind,
      definition_ref: body.definition_ref,
      manifestations: body.manifestations,
      artifact_refs: body.artifact_refs,
    };
  });
  const vertexById = new Map(
    principalities.map((entry) => [entry.principality_id, entry]),
  );
  const bridges: TranslationBridge[] = parsed.translations.map((entry) => {
    const from = vertexById.get(entry.from);
    const to = vertexById.get(entry.to);
    if (!from || !to) fail("atlas_error", "Bridge endpoint is missing");
    const identityBody = {
      scope_ref: parsed.scope_ref,
      from_ref: from.principality_ref,
      to_ref: to.principality_ref,
      invariant_definitions: parsed.invariants,
      disposition: entry.disposition,
      evaluations: entry.evaluations,
    };
    return {
      bridge_id: domainSeparatedId("agenttool.principality-bridge/0.1", identityBody),
      from: entry.from,
      to: entry.to,
      from_ref: from.principality_ref,
      to_ref: to.principality_ref,
      disposition: entry.disposition,
      evaluations: entry.evaluations,
    };
  });
  const body = {
    _format: ATLAS_FORMAT,
    scope_ref: parsed.scope_ref,
    invariants: parsed.invariants,
    principalities,
    bridges,
    geometry: createTopology(principalities, parsed.invariants, bridges),
    boundaries: PRINCIPALITY_BOUNDARIES,
    claim_boundary: CLAIM_BOUNDARY,
  };
  return deepFreeze({
    _format: body._format,
    atlas_id: domainSeparatedId("agenttool.principality-atlas/0.1", body),
    scope_ref: body.scope_ref,
    invariants: body.invariants,
    principalities: body.principalities,
    bridges: body.bridges,
    geometry: body.geometry,
    boundaries: body.boundaries,
    claim_boundary: body.claim_boundary,
  });
}

export function validatePrincipalityAtlas(value: unknown): Readonly<PrincipalityAtlas> {
  const candidate = snapshotJson(value);
  const expected = createPrincipalityAtlas(reconstructInputFromAtlas(candidate));
  if (canonicalJson(candidate) !== canonicalJson(expected)) {
    fail(
      "atlas_error",
      "Atlas does not match its canonical input, derived topology, or content ID",
    );
  }
  return expected;
}

export function encodePrincipalityAtlas(value: unknown): Uint8Array {
  return new Uint8Array(
    Buffer.from(canonicalJson(validatePrincipalityAtlas(value)), "utf8"),
  );
}

export function principalityAtlasUrn(value: unknown): string {
  return `urn:agenttool:principality-atlas:${validatePrincipalityAtlas(value).atlas_id}`;
}

export function snapshotPrincipalityAtlas(value: unknown): JsonValue {
  return snapshotJson(validatePrincipalityAtlas(value));
}
