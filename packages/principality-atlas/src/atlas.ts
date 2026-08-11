import { canonicalJson, deepFreeze, domainSeparatedId } from "./canonical.js";
import {
  PRINCIPALITY_ATLAS_BOUNDARIES,
  PRINCIPALITY_ATLAS_FORMAT,
} from "./constants.js";
import { fail } from "./errors.js";
import type {
  CreatePrincipalityAtlasInput,
  PrincipalityAtlas,
  Sha256Id,
} from "./types.js";
import {
  exactKeys,
  literal,
  parseBoundaries,
  parseBridges,
  parseCharts,
  record,
  sha256,
} from "./validation.js";

function atlasBody(value: Omit<PrincipalityAtlas, "atlas_id">) {
  return value;
}

export function createPrincipalityAtlas(
  input: CreatePrincipalityAtlasInput,
): Readonly<PrincipalityAtlas> {
  const candidate = record(input, "$input", "atlas_error");
  exactKeys(candidate, ["scope_ref", "charts", "bridges"], "$input", "atlas_error");
  const charts = parseCharts(candidate.charts, "$input.charts", "atlas_error", true);
  const body = deepFreeze({
    _format: PRINCIPALITY_ATLAS_FORMAT,
    scope_ref: sha256(candidate.scope_ref, "$input.scope_ref", "atlas_error"),
    charts,
    bridges: parseBridges(candidate.bridges, charts, "$input.bridges", "atlas_error", true),
    coverage: "bounded_not_complete" as const,
    boundaries: PRINCIPALITY_ATLAS_BOUNDARIES,
  });
  return deepFreeze({
    ...body,
    atlas_id: domainSeparatedId(PRINCIPALITY_ATLAS_FORMAT, atlasBody(body)),
  });
}

export function validatePrincipalityAtlas(value: unknown): Readonly<PrincipalityAtlas> {
  const candidate = record(value, "$atlas", "atlas_error");
  exactKeys(
    candidate,
    ["_format", "atlas_id", "scope_ref", "charts", "bridges", "coverage", "boundaries"],
    "$atlas",
    "atlas_error",
  );
  const charts = parseCharts(candidate.charts, "$atlas.charts", "atlas_error", false);
  const parsed = deepFreeze({
    _format: literal(candidate._format, [PRINCIPALITY_ATLAS_FORMAT], "$atlas._format", "atlas_error"),
    atlas_id: sha256(candidate.atlas_id, "$atlas.atlas_id", "atlas_error"),
    scope_ref: sha256(candidate.scope_ref, "$atlas.scope_ref", "atlas_error"),
    charts,
    bridges: parseBridges(candidate.bridges, charts, "$atlas.bridges", "atlas_error", false),
    coverage: literal(candidate.coverage, ["bounded_not_complete"], "$atlas.coverage", "atlas_error"),
    boundaries: parseBoundaries(candidate.boundaries, "$atlas.boundaries", "atlas_error"),
  });
  const { atlas_id: claimedId, ...body } = parsed;
  const expectedId = domainSeparatedId(PRINCIPALITY_ATLAS_FORMAT, atlasBody(body));
  if (claimedId !== expectedId) {
    fail("atlas_error", "$atlas.atlas_id does not bind its body");
  }
  return parsed;
}

export function encodePrincipalityAtlas(value: unknown): Uint8Array {
  return Uint8Array.from(Buffer.from(canonicalJson(validatePrincipalityAtlas(value)), "utf8"));
}

export function principalityAtlasUrn(id: Sha256Id): string {
  const parsed = sha256(id, "$atlas_id", "atlas_error");
  return `urn:agenttool:principality-atlas:${parsed}`;
}

export function principalityAtlasDomainBytes(value: unknown): Uint8Array {
  const atlas = validatePrincipalityAtlas(value);
  const { atlas_id: _atlasId, ...body } = atlas;
  return Uint8Array.from(
    Buffer.from(`${PRINCIPALITY_ATLAS_FORMAT}\u0000${canonicalJson(body)}`, "utf8"),
  );
}
