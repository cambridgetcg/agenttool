import { canonicalJson, compareUnicode, deepFreeze, domainSeparatedId } from "./canonical.js";
import {
  RELATIONAL_GEOMETRY_BOUNDARIES,
  RELATIONAL_GEOMETRY_FORMATS,
  RELATIONAL_LENS_CHOICE,
} from "./constants.js";
import { fail } from "./errors.js";
import type {
  CreateRelationalLensInput,
  RelationalComplex,
  RelationalLens,
  Sha256Id,
} from "./types.js";
import {
  exactKeys,
  isBoundaryWitnessKind,
  literal,
  parseBoundaries,
  parseChoice,
  parseRefs,
  parseSelections,
  record,
  sha256,
} from "./validation.js";
import { validateRelationalComplex } from "./complex.js";

function projection(complex: RelationalComplex, perspectiveRef: Sha256Id) {
  const available = complex.principalities
    .filter((cell) => cell.from_ref === perspectiveRef || cell.to_ref === perspectiveRef)
    .map((cell) => cell.principality_ref)
    .sort(compareUnicode);
  const boundaries = [...new Set(complex.witnesses
    .filter((witness) =>
      isBoundaryWitnessKind(witness.kind) &&
      (witness.from_ref === perspectiveRef || witness.to_ref === perspectiveRef),
    )
    .map((witness) => witness.witness_ref))]
    .sort(compareUnicode);
  return deepFreeze({
    available_principality_refs: deepFreeze(available),
    boundary_witness_refs: deepFreeze(boundaries),
  });
}

function lensBody(value: Omit<RelationalLens, "lens_id">): Omit<RelationalLens, "lens_id"> {
  return value;
}

export function createRelationalLens(
  complexValue: unknown,
  input: CreateRelationalLensInput,
): Readonly<RelationalLens> {
  const complex = validateRelationalComplex(complexValue);
  const candidate = record(input, "$input", "lens_error");
  exactKeys(candidate, ["perspective_ref", "selections"], "$input", "lens_error");
  const perspectiveRef = sha256(candidate.perspective_ref, "$input.perspective_ref", "lens_error");
  if (!complex.points.some((point) => point.point_ref === perspectiveRef)) {
    fail("lens_error", "$input.perspective_ref must name a point in the source complex");
  }
  const selections = parseSelections(candidate.selections, "$input.selections", "lens_error", true);
  const projected = projection(complex, perspectiveRef);
  const available = new Set(projected.available_principality_refs);
  for (const selection of selections) {
    if (!available.has(selection.principality_ref)) {
      fail("lens_error", "$input.selections may name only principalities incident to the perspective");
    }
  }
  const selected = new Set(selections.map((selection) => selection.principality_ref));
  const body = deepFreeze({
    _format: RELATIONAL_GEOMETRY_FORMATS.lens,
    source_complex_id: complex.complex_id,
    perspective_ref: perspectiveRef,
    available_principality_refs: projected.available_principality_refs,
    selections,
    unprojected_principality_refs: deepFreeze(projected.available_principality_refs.filter((ref) => !selected.has(ref))),
    boundary_witness_refs: projected.boundary_witness_refs,
    coverage: "perspective_bounded_not_complete" as const,
    choice: RELATIONAL_LENS_CHOICE,
    boundaries: RELATIONAL_GEOMETRY_BOUNDARIES,
  });
  return deepFreeze({ ...body, lens_id: domainSeparatedId(RELATIONAL_GEOMETRY_FORMATS.lens, lensBody(body)) });
}

export function validateRelationalLens(value: unknown): Readonly<RelationalLens> {
  const candidate = record(value, "$lens", "lens_error");
  exactKeys(candidate, ["_format", "lens_id", "source_complex_id", "perspective_ref", "available_principality_refs", "selections", "unprojected_principality_refs", "boundary_witness_refs", "coverage", "choice", "boundaries"], "$lens", "lens_error");
  const available = parseRefs(candidate.available_principality_refs, "$lens.available_principality_refs", "lens_error");
  const selections = parseSelections(candidate.selections, "$lens.selections", "lens_error", false);
  const unprojected = parseRefs(candidate.unprojected_principality_refs, "$lens.unprojected_principality_refs", "lens_error");
  const selectedRefs = selections.map((selection) => selection.principality_ref);
  if (selectedRefs.some((ref) => !available.includes(ref))) fail("lens_error", "$lens selections must be available");
  if (unprojected.some((ref) => !available.includes(ref))) fail("lens_error", "$lens unprojected refs must be available");
  if (selectedRefs.some((ref) => unprojected.includes(ref))) fail("lens_error", "$lens selected and unprojected refs must be disjoint");
  if (canonicalJson([...selectedRefs, ...unprojected].sort(compareUnicode)) !== canonicalJson(available)) {
    fail("lens_error", "$lens selected and unprojected refs must partition available refs");
  }
  const parsed = deepFreeze({
    _format: literal(candidate._format, [RELATIONAL_GEOMETRY_FORMATS.lens], "$lens._format", "lens_error"),
    lens_id: sha256(candidate.lens_id, "$lens.lens_id", "lens_error"),
    source_complex_id: sha256(candidate.source_complex_id, "$lens.source_complex_id", "lens_error"),
    perspective_ref: sha256(candidate.perspective_ref, "$lens.perspective_ref", "lens_error"),
    available_principality_refs: available,
    selections,
    unprojected_principality_refs: unprojected,
    boundary_witness_refs: parseRefs(candidate.boundary_witness_refs, "$lens.boundary_witness_refs", "lens_error"),
    coverage: literal(candidate.coverage, ["perspective_bounded_not_complete"], "$lens.coverage", "lens_error"),
    choice: parseChoice(candidate.choice, "$lens.choice", "lens_error"),
    boundaries: parseBoundaries(candidate.boundaries, "$lens.boundaries", "lens_error"),
  });
  const { lens_id: claimed, ...body } = parsed;
  if (claimed !== domainSeparatedId(RELATIONAL_GEOMETRY_FORMATS.lens, lensBody(body))) {
    fail("lens_error", "$lens.lens_id does not bind its body");
  }
  return parsed;
}

export function validateRelationalLensAgainstComplex(
  lensValue: unknown,
  complexValue: unknown,
): Readonly<RelationalLens> {
  const lens = validateRelationalLens(lensValue);
  const complex = validateRelationalComplex(complexValue);
  if (lens.source_complex_id !== complex.complex_id) fail("lens_error", "$lens source_complex_id does not match the supplied complex");
  if (!complex.points.some((point) => point.point_ref === lens.perspective_ref)) fail("lens_error", "$lens perspective_ref is absent from the supplied complex");
  const expected = projection(complex, lens.perspective_ref);
  if (
    canonicalJson(lens.available_principality_refs) !== canonicalJson(expected.available_principality_refs) ||
    canonicalJson(lens.boundary_witness_refs) !== canonicalJson(expected.boundary_witness_refs)
  ) {
    fail("lens_error", "$lens projection does not match the supplied complex");
  }
  return lens;
}

export function encodeRelationalLens(value: unknown): Uint8Array {
  return Uint8Array.from(Buffer.from(canonicalJson(validateRelationalLens(value)), "utf8"));
}

export function relationalLensUrn(id: Sha256Id): string {
  return `urn:agenttool:relational-geometry:lens:${sha256(id, "$lens_id", "lens_error")}`;
}

export function relationalLensDomainBytes(value: unknown): Uint8Array {
  const lens = validateRelationalLens(value);
  const { lens_id: _id, ...body } = lens;
  return Uint8Array.from(Buffer.from(`${RELATIONAL_GEOMETRY_FORMATS.lens}\u0000${canonicalJson(body)}`, "utf8"));
}
