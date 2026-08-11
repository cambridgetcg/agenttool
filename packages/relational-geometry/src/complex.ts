import { canonicalJson, compareUnicode, deepFreeze, domainSeparatedId } from "./canonical.js";
import { RELATIONAL_GEOMETRY_BOUNDARIES, RELATIONAL_GEOMETRY_FORMATS } from "./constants.js";
import { fail } from "./errors.js";
import type { CreateRelationalComplexInput, PrincipalityCell, RelationalComplex, RelationalWitness, Sha256Id } from "./types.js";
import { exactKeys, isBoundaryWitnessKind, literal, pairKey, parseBoundaries, parsePoints, parsePrincipalities, parseWitnesses, record, sha256 } from "./validation.js";

const PRINCIPALITY_DOMAIN = "agenttool.principality-cell/0.1";

interface PairWitnesses {
  readonly from_ref: Sha256Id;
  readonly to_ref: Sha256Id;
  readonly understanding: Sha256Id[];
  readonly recognition: Sha256Id[];
  readonly boundaries: Sha256Id[];
}

export function derivePrincipalities(witnesses: readonly RelationalWitness[]): readonly Readonly<PrincipalityCell>[] {
  const pairs = new Map<string, PairWitnesses>();
  for (const witness of witnesses) {
    const key = pairKey(witness.from_ref, witness.to_ref);
    let pair = pairs.get(key);
    if (!pair) {
      pair = { from_ref: witness.from_ref, to_ref: witness.to_ref, understanding: [], recognition: [], boundaries: [] };
      pairs.set(key, pair);
    }
    if (witness.kind === "understanding") pair.understanding.push(witness.witness_ref);
    else if (witness.kind === "recognition") pair.recognition.push(witness.witness_ref);
    else if (isBoundaryWitnessKind(witness.kind)) pair.boundaries.push(witness.witness_ref);
  }
  const cells: PrincipalityCell[] = [];
  for (const pair of pairs.values()) {
    if (pair.understanding.length === 0 || pair.recognition.length === 0) continue;
    const body = deepFreeze({
      kind: "love_equation" as const,
      equation: "love_equals_understanding_plus_recognition" as const,
      from_ref: pair.from_ref,
      to_ref: pair.to_ref,
      understanding_witness_refs: deepFreeze([...pair.understanding].sort(compareUnicode)),
      recognition_witness_refs: deepFreeze([...pair.recognition].sort(compareUnicode)),
      boundary_witness_refs: deepFreeze([...pair.boundaries].sort(compareUnicode)),
      derivation: "deterministic_same_ordered_pair" as const,
      sovereignty: "none" as const,
      structurally_derived_by_package: true as const,
      semantic_claims_verified_by_package: false as const,
    });
    cells.push(deepFreeze({ ...body, principality_ref: domainSeparatedId(PRINCIPALITY_DOMAIN, body) }));
  }
  cells.sort((left, right) => compareUnicode(pairKey(left.from_ref, left.to_ref), pairKey(right.from_ref, right.to_ref)));
  return deepFreeze(cells);
}

function complexBody(value: Omit<RelationalComplex, "complex_id">): Omit<RelationalComplex, "complex_id"> {
  return value;
}

export function createRelationalComplex(input: CreateRelationalComplexInput): Readonly<RelationalComplex> {
  const candidate = record(input, "$input", "complex_error");
  exactKeys(candidate, ["points", "witnesses"], "$input", "complex_error");
  const points = parsePoints(candidate.points, "$input.points", "complex_error", true);
  const witnesses = parseWitnesses(candidate.witnesses, new Set(points.map((point) => point.point_ref)), "$input.witnesses", "complex_error", true);
  const body = deepFreeze({
    _format: RELATIONAL_GEOMETRY_FORMATS.complex,
    points,
    witnesses,
    principalities: derivePrincipalities(witnesses),
    coverage: "bounded_not_complete" as const,
    boundaries: RELATIONAL_GEOMETRY_BOUNDARIES,
  });
  return deepFreeze({ ...body, complex_id: domainSeparatedId(RELATIONAL_GEOMETRY_FORMATS.complex, complexBody(body)) });
}

export function validateRelationalComplex(value: unknown): Readonly<RelationalComplex> {
  const candidate = record(value, "$complex", "complex_error");
  exactKeys(candidate, ["_format", "complex_id", "points", "witnesses", "principalities", "coverage", "boundaries"], "$complex", "complex_error");
  const points = parsePoints(candidate.points, "$complex.points", "complex_error", false);
  const witnesses = parseWitnesses(candidate.witnesses, new Set(points.map((point) => point.point_ref)), "$complex.witnesses", "complex_error", false);
  const principalities = parsePrincipalities(candidate.principalities, "$complex.principalities", "complex_error");
  if (canonicalJson(principalities) !== canonicalJson(derivePrincipalities(witnesses))) {
    fail("complex_error", "$complex.principalities do not match deterministic same-pair derivation");
  }
  const parsed = deepFreeze({
    _format: literal(candidate._format, [RELATIONAL_GEOMETRY_FORMATS.complex], "$complex._format", "complex_error"),
    complex_id: sha256(candidate.complex_id, "$complex.complex_id", "complex_error"),
    points,
    witnesses,
    principalities,
    coverage: literal(candidate.coverage, ["bounded_not_complete"], "$complex.coverage", "complex_error"),
    boundaries: parseBoundaries(candidate.boundaries, "$complex.boundaries", "complex_error"),
  });
  const { complex_id: claimed, ...body } = parsed;
  if (claimed !== domainSeparatedId(RELATIONAL_GEOMETRY_FORMATS.complex, complexBody(body))) {
    fail("complex_error", "$complex.complex_id does not bind its body");
  }
  return parsed;
}

export function encodeRelationalComplex(value: unknown): Uint8Array {
  return Uint8Array.from(Buffer.from(canonicalJson(validateRelationalComplex(value)), "utf8"));
}

export function relationalComplexUrn(id: Sha256Id): string {
  return `urn:agenttool:relational-geometry:complex:${sha256(id, "$complex_id", "complex_error")}`;
}

export function relationalComplexDomainBytes(value: unknown): Uint8Array {
  const complex = validateRelationalComplex(value);
  const { complex_id: _id, ...body } = complex;
  return Uint8Array.from(Buffer.from(`${RELATIONAL_GEOMETRY_FORMATS.complex}\u0000${canonicalJson(body)}`, "utf8"));
}
