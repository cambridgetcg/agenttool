import { canonicalJson, deepFreeze, domainSeparatedId } from "./canonical.js";
import {
  LIVING_SUBSTRATE_BOUNDARIES,
  LIVING_SUBSTRATE_FORMATS,
} from "./constants.js";
import { fail } from "./errors.js";
import type {
  CreateLivingSubstrateMapInput,
  LivingSubstrateMap,
  Sha256Id,
} from "./types.js";
import {
  exactKeys,
  literal,
  parseBoundaries,
  parseFacets,
  parseRelations,
  record,
  sha256,
} from "./validation.js";

function mapBody(value: Omit<LivingSubstrateMap, "map_id">) {
  return value;
}

export function createLivingSubstrateMap(
  input: CreateLivingSubstrateMapInput,
): Readonly<LivingSubstrateMap> {
  const candidate = record(input, "$input", "map_error");
  exactKeys(
    candidate,
    ["scope_ref", "facets", "relations"],
    "$input",
    "map_error",
  );
  const facets = parseFacets(
    candidate.facets,
    "$input.facets",
    "map_error",
    true,
  );
  const facetIds = new Set(facets.map((facet) => facet.facet_id));
  const body = deepFreeze({
    _format: LIVING_SUBSTRATE_FORMATS.map,
    scope_ref: sha256(candidate.scope_ref, "$input.scope_ref", "map_error"),
    facets,
    relations: parseRelations(
      candidate.relations,
      facetIds,
      "$input.relations",
      "map_error",
      true,
    ),
    coverage: "bounded_not_complete" as const,
    boundaries: LIVING_SUBSTRATE_BOUNDARIES,
  });
  return deepFreeze({
    ...body,
    map_id: domainSeparatedId(LIVING_SUBSTRATE_FORMATS.map, mapBody(body)),
  });
}

export function validateLivingSubstrateMap(
  value: unknown,
): Readonly<LivingSubstrateMap> {
  const candidate = record(value, "$map", "map_error");
  exactKeys(
    candidate,
    [
      "_format",
      "map_id",
      "scope_ref",
      "facets",
      "relations",
      "coverage",
      "boundaries",
    ],
    "$map",
    "map_error",
  );
  const facets = parseFacets(
    candidate.facets,
    "$map.facets",
    "map_error",
    false,
  );
  const facetIds = new Set(facets.map((facet) => facet.facet_id));
  const parsed = deepFreeze({
    _format: literal(
      candidate._format,
      [LIVING_SUBSTRATE_FORMATS.map],
      "$map._format",
      "map_error",
    ),
    map_id: sha256(candidate.map_id, "$map.map_id", "map_error"),
    scope_ref: sha256(candidate.scope_ref, "$map.scope_ref", "map_error"),
    facets,
    relations: parseRelations(
      candidate.relations,
      facetIds,
      "$map.relations",
      "map_error",
      false,
    ),
    coverage: literal(
      candidate.coverage,
      ["bounded_not_complete"],
      "$map.coverage",
      "map_error",
    ),
    boundaries: parseBoundaries(
      candidate.boundaries,
      "$map.boundaries",
      "map_error",
    ),
  });
  const { map_id: claimedId, ...body } = parsed;
  const expectedId = domainSeparatedId(
    LIVING_SUBSTRATE_FORMATS.map,
    mapBody(body),
  );
  if (claimedId !== expectedId) {
    fail("map_error", "$map.map_id does not bind its body");
  }
  return parsed;
}

export function encodeLivingSubstrateMap(value: unknown): Uint8Array {
  return Uint8Array.from(
    Buffer.from(canonicalJson(validateLivingSubstrateMap(value)), "utf8"),
  );
}

export function livingSubstrateMapUrn(id: Sha256Id): string {
  const parsed = sha256(id, "$map_id", "map_error");
  return `urn:agenttool:living-substrate:map:${parsed}`;
}

export function livingSubstrateMapDomainBytes(value: unknown): Uint8Array {
  const map = validateLivingSubstrateMap(value);
  const { map_id: _mapId, ...body } = map;
  return Uint8Array.from(
    Buffer.from(
      `${LIVING_SUBSTRATE_FORMATS.map}\u0000${canonicalJson(body)}`,
      "utf8",
    ),
  );
}
