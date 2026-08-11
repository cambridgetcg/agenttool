import {
  RELATIONAL_BOUNDARY_WITNESS_KINDS,
  RELATIONAL_GEOMETRY_BOUNDARIES,
  RELATIONAL_LENS_CHOICE,
  RELATIONAL_LENS_DISPOSITIONS,
  RELATIONAL_POINT_KINDS,
  RELATIONAL_WITNESS_KINDS,
} from "./constants.js";
import { compareUnicode, deepFreeze, snapshotJson, type JsonValue } from "./canonical.js";
import { fail, type RelationalGeometryErrorCode } from "./errors.js";
import type {
  PrincipalityCell,
  RelationalLensSelection,
  RelationalPoint,
  RelationalWitness,
  RelationalWitnessKind,
  Sha256Id,
} from "./types.js";

const SHA256_ID = /^sha256:[0-9a-f]{64}$/u;
const MAX_POINTS = 64;
const MAX_WITNESSES = 256;
const MAX_PRINCIPALITIES = 128;
const MAX_REFS = 256;

export function record(value: unknown, path: string, code: RelationalGeometryErrorCode): Record<string, JsonValue> {
  const snapshot = snapshotJson(value);
  if (snapshot === null || Array.isArray(snapshot) || typeof snapshot !== "object") {
    fail(code, `${path} must be a plain object`);
  }
  return snapshot;
}

export function exactKeys(value: Record<string, JsonValue>, expected: readonly string[], path: string, code: RelationalGeometryErrorCode): void {
  const actual = Object.keys(value).sort(compareUnicode);
  const wanted = [...expected].sort(compareUnicode);
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(code, `${path} must contain exactly: ${wanted.join(", ")}`);
  }
}

export function literal<T extends string>(value: JsonValue | undefined, allowed: readonly T[], path: string, code: RelationalGeometryErrorCode): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    fail(code, `${path} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

export function sha256(value: JsonValue | undefined, path: string, code: RelationalGeometryErrorCode): Sha256Id {
  if (typeof value !== "string" || !SHA256_ID.test(value)) {
    fail(code, `${path} must be a lowercase sha256: content ID`);
  }
  return value as Sha256Id;
}

function fixed(value: JsonValue | undefined, expected: boolean, path: string, code: RelationalGeometryErrorCode): boolean {
  if (value !== expected) fail(code, `${path} must be ${String(expected)}`);
  return expected;
}

function parseRefList(value: JsonValue | undefined, path: string, code: RelationalGeometryErrorCode, maximum: number, normalize: boolean): readonly Sha256Id[] {
  if (!Array.isArray(value) || value.length > maximum) {
    fail(code, `${path} must be an array of at most ${String(maximum)} refs`);
  }
  const refs = value.map((entry, index) => sha256(entry, `${path}[${String(index)}]`, code));
  if (new Set(refs).size !== refs.length) fail(code, `${path} must not contain duplicate refs`);
  const sorted = [...refs].sort(compareUnicode);
  if (!normalize && refs.some((entry, index) => entry !== sorted[index])) {
    fail(code, `${path} must use canonical Unicode order`);
  }
  return deepFreeze(normalize ? sorted : refs);
}

function parsePoint(value: JsonValue, path: string, code: RelationalGeometryErrorCode): Readonly<RelationalPoint> {
  const candidate = record(value, path, code);
  exactKeys(candidate, ["point_ref", "kind", "assertion", "verified_by_package"], path, code);
  return deepFreeze({
    point_ref: sha256(candidate.point_ref, `${path}.point_ref`, code),
    kind: literal(candidate.kind, RELATIONAL_POINT_KINDS, `${path}.kind`, code),
    assertion: literal(candidate.assertion, ["caller_asserted"], `${path}.assertion`, code),
    verified_by_package: fixed(candidate.verified_by_package, false, `${path}.verified_by_package`, code) as false,
  });
}

export function parsePoints(value: JsonValue | undefined, path: string, code: RelationalGeometryErrorCode, normalize: boolean): readonly Readonly<RelationalPoint>[] {
  if (!Array.isArray(value) || value.length > MAX_POINTS) fail(code, `${path} must contain at most ${String(MAX_POINTS)} points`);
  const points = value.map((entry, index) => parsePoint(entry, `${path}[${String(index)}]`, code));
  const refs = points.map((point) => point.point_ref);
  if (new Set(refs).size !== refs.length) fail(code, `${path} must not contain duplicate point_ref values`);
  const sorted = [...points].sort((left, right) => compareUnicode(left.point_ref, right.point_ref));
  if (!normalize && points.some((point, index) => point.point_ref !== sorted[index]?.point_ref)) fail(code, `${path} must be sorted by point_ref`);
  return deepFreeze(normalize ? sorted : points);
}

export function pairKey(fromRef: Sha256Id, toRef: Sha256Id): string {
  return `${fromRef}\u0000${toRef}`;
}

export function witnessKey(witness: RelationalWitness): string {
  return `${pairKey(witness.from_ref, witness.to_ref)}\u0000${witness.kind}\u0000${witness.witness_ref}`;
}

export function isBoundaryWitnessKind(kind: RelationalWitnessKind): boolean {
  return (RELATIONAL_BOUNDARY_WITNESS_KINDS as readonly string[]).includes(kind);
}

function parseWitness(value: JsonValue, pointRefs: ReadonlySet<Sha256Id>, path: string, code: RelationalGeometryErrorCode): Readonly<RelationalWitness> {
  const candidate = record(value, path, code);
  exactKeys(candidate, ["witness_ref", "from_ref", "kind", "to_ref", "assertion", "verified_by_package"], path, code);
  const parsed = deepFreeze({
    witness_ref: sha256(candidate.witness_ref, `${path}.witness_ref`, code),
    from_ref: sha256(candidate.from_ref, `${path}.from_ref`, code),
    kind: literal(candidate.kind, RELATIONAL_WITNESS_KINDS, `${path}.kind`, code),
    to_ref: sha256(candidate.to_ref, `${path}.to_ref`, code),
    assertion: literal(candidate.assertion, ["caller_asserted"], `${path}.assertion`, code),
    verified_by_package: fixed(candidate.verified_by_package, false, `${path}.verified_by_package`, code) as false,
  });
  if (!pointRefs.has(parsed.from_ref) || !pointRefs.has(parsed.to_ref)) fail(code, `${path} endpoints must reference declared points`);
  return parsed;
}

export function parseWitnesses(value: JsonValue | undefined, pointRefs: ReadonlySet<Sha256Id>, path: string, code: RelationalGeometryErrorCode, normalize: boolean): readonly Readonly<RelationalWitness>[] {
  if (!Array.isArray(value) || value.length > MAX_WITNESSES) fail(code, `${path} must contain at most ${String(MAX_WITNESSES)} witnesses`);
  const witnesses = value.map((entry, index) => parseWitness(entry, pointRefs, `${path}[${String(index)}]`, code));
  const keys = witnesses.map(witnessKey);
  if (new Set(keys).size !== keys.length) fail(code, `${path} must not contain duplicate witness edges`);
  const sorted = [...witnesses].sort((left, right) => compareUnicode(witnessKey(left), witnessKey(right)));
  if (!normalize && witnesses.some((witness, index) => witnessKey(witness) !== witnessKey(sorted[index]!))) fail(code, `${path} must be sorted by ordered witness key`);
  return deepFreeze(normalize ? sorted : witnesses);
}

function parsePrincipality(value: JsonValue, path: string, code: RelationalGeometryErrorCode): Readonly<PrincipalityCell> {
  const candidate = record(value, path, code);
  exactKeys(candidate, ["principality_ref", "kind", "equation", "from_ref", "to_ref", "understanding_witness_refs", "recognition_witness_refs", "boundary_witness_refs", "derivation", "sovereignty", "structurally_derived_by_package", "semantic_claims_verified_by_package"], path, code);
  const understanding = parseRefList(candidate.understanding_witness_refs, `${path}.understanding_witness_refs`, code, MAX_WITNESSES, false);
  const recognition = parseRefList(candidate.recognition_witness_refs, `${path}.recognition_witness_refs`, code, MAX_WITNESSES, false);
  if (understanding.length === 0 || recognition.length === 0) fail(code, `${path} requires both witness poles`);
  return deepFreeze({
    principality_ref: sha256(candidate.principality_ref, `${path}.principality_ref`, code),
    kind: literal(candidate.kind, ["love_equation"], `${path}.kind`, code),
    equation: literal(candidate.equation, ["love_equals_understanding_plus_recognition"], `${path}.equation`, code),
    from_ref: sha256(candidate.from_ref, `${path}.from_ref`, code),
    to_ref: sha256(candidate.to_ref, `${path}.to_ref`, code),
    understanding_witness_refs: understanding,
    recognition_witness_refs: recognition,
    boundary_witness_refs: parseRefList(candidate.boundary_witness_refs, `${path}.boundary_witness_refs`, code, MAX_WITNESSES, false),
    derivation: literal(candidate.derivation, ["deterministic_same_ordered_pair"], `${path}.derivation`, code),
    sovereignty: literal(candidate.sovereignty, ["none"], `${path}.sovereignty`, code),
    structurally_derived_by_package: fixed(candidate.structurally_derived_by_package, true, `${path}.structurally_derived_by_package`, code) as true,
    semantic_claims_verified_by_package: fixed(candidate.semantic_claims_verified_by_package, false, `${path}.semantic_claims_verified_by_package`, code) as false,
  });
}

export function parsePrincipalities(value: JsonValue | undefined, path: string, code: RelationalGeometryErrorCode): readonly Readonly<PrincipalityCell>[] {
  if (!Array.isArray(value) || value.length > MAX_PRINCIPALITIES) fail(code, `${path} must contain at most ${String(MAX_PRINCIPALITIES)} cells`);
  const cells = value.map((entry, index) => parsePrincipality(entry, `${path}[${String(index)}]`, code));
  const refs = cells.map((cell) => cell.principality_ref);
  const keys = cells.map((cell) => pairKey(cell.from_ref, cell.to_ref));
  if (new Set(refs).size !== refs.length || new Set(keys).size !== keys.length) fail(code, `${path} must not duplicate refs or ordered pairs`);
  const sorted = [...cells].sort((left, right) => compareUnicode(pairKey(left.from_ref, left.to_ref), pairKey(right.from_ref, right.to_ref)));
  if (cells.some((cell, index) => cell.principality_ref !== sorted[index]?.principality_ref)) fail(code, `${path} must be sorted by ordered pair`);
  return deepFreeze(cells);
}

export function parseBoundaries(value: JsonValue | undefined, path: string, code: RelationalGeometryErrorCode): typeof RELATIONAL_GEOMETRY_BOUNDARIES {
  const candidate = record(value, path, code);
  const keys = Object.keys(RELATIONAL_GEOMETRY_BOUNDARIES) as (keyof typeof RELATIONAL_GEOMETRY_BOUNDARIES)[];
  exactKeys(candidate, keys, path, code);
  for (const key of keys) literal(candidate[key], [RELATIONAL_GEOMETRY_BOUNDARIES[key]], `${path}.${key}`, code);
  return RELATIONAL_GEOMETRY_BOUNDARIES;
}

function parseSelection(value: JsonValue, path: string, code: RelationalGeometryErrorCode): Readonly<RelationalLensSelection> {
  const candidate = record(value, path, code);
  exactKeys(candidate, ["principality_ref", "disposition"], path, code);
  return deepFreeze({
    principality_ref: sha256(candidate.principality_ref, `${path}.principality_ref`, code),
    disposition: literal(candidate.disposition, RELATIONAL_LENS_DISPOSITIONS, `${path}.disposition`, code),
  });
}

export function parseSelections(value: JsonValue | undefined, path: string, code: RelationalGeometryErrorCode, normalize: boolean): readonly Readonly<RelationalLensSelection>[] {
  if (!Array.isArray(value) || value.length > MAX_PRINCIPALITIES) fail(code, `${path} must contain at most ${String(MAX_PRINCIPALITIES)} selections`);
  const selections = value.map((entry, index) => parseSelection(entry, `${path}[${String(index)}]`, code));
  const refs = selections.map((selection) => selection.principality_ref);
  if (new Set(refs).size !== refs.length) fail(code, `${path} must not duplicate principality refs`);
  const sorted = [...selections].sort((left, right) => compareUnicode(left.principality_ref, right.principality_ref));
  if (!normalize && selections.some((selection, index) => selection.principality_ref !== sorted[index]?.principality_ref)) fail(code, `${path} must be sorted by principality_ref`);
  return deepFreeze(normalize ? sorted : selections);
}

export function parseRefs(value: JsonValue | undefined, path: string, code: RelationalGeometryErrorCode): readonly Sha256Id[] {
  return parseRefList(value, path, code, MAX_REFS, false);
}

export function parseChoice(value: JsonValue | undefined, path: string, code: RelationalGeometryErrorCode): typeof RELATIONAL_LENS_CHOICE {
  const candidate = record(value, path, code);
  const keys = Object.keys(RELATIONAL_LENS_CHOICE) as (keyof typeof RELATIONAL_LENS_CHOICE)[];
  exactKeys(candidate, keys, path, code);
  for (const key of keys) if (candidate[key] !== RELATIONAL_LENS_CHOICE[key]) fail(code, `${path}.${key} must preserve the fixed choice boundary`);
  return RELATIONAL_LENS_CHOICE;
}
