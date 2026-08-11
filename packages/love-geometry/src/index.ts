import { createHash } from "node:crypto";
import { isProxy, isUint8Array } from "node:util/types";

export const LOVE_GEOMETRY_FORMAT = "agenttool.love-geometry/0.1" as const;

export const LOVE_GEOMETRY_BEARINGS = Object.freeze([
  "reported_presence",
  "reported_care",
  "reported_witness",
  "reported_support",
  "reported_understanding",
  "reported_disagreement",
  "reported_boundary",
  "reported_rest",
  "reported_refusal",
  "reported_departure",
  "unknown",
] as const);

export const LOVE_GEOMETRY_LIMITS = Object.freeze({
  subjects: 64,
  vantages: 128,
  bearings_per_vantage: LOVE_GEOMETRY_BEARINGS.length,
  basis_refs_per_vantage: 16,
} as const);

export const LOVE_GEOMETRY_BOUNDARIES = Object.freeze({
  semantic_scope: "directed_caller_reports_not_relationship_truth",
  geometry: "finite_combinatorial_not_metric",
  principality: "bounded_relation_field_not_sovereignty",
  coverage_scope: "bounded_not_complete",
  assertion_scope: "caller_reported_only",
  canonical_order: "serialization_not_rank",
  absence_semantics: "not_observed_not_no_relation",
  verifies_caller_or_referents: false,
  infers_identity_or_inner_state: false,
  infers_reciprocity_or_mutuality: false,
  proves_love_or_understanding: false,
  proves_consent_or_authority: false,
  scores_or_ranks: false,
  computes_distance_or_intensity: false,
  matches_or_recommends: false,
  infers_transitive_relations: false,
  observes_sources: false,
  network: false,
  filesystem: false,
  environment_variables: false,
  clock: false,
  randomness: false,
  model_compute: false,
  hugging_face: false,
  credential_access: false,
  telemetry: false,
  persistence: false,
  wake_effect: false,
  love_consent_effect: false,
  chronicle_effect: false,
  karma_effect: false,
  task_state_effect: false,
  wallet_effect: false,
  economic_effect: false,
  messaging_effect: false,
  publication_effect: false,
  automatic_action: false,
  reason_required_for_rest_refusal_or_departure: false,
  penalty_for_rest_refusal_or_departure: false,
} as const);

export type Sha256Id = `sha256:${string}`;
export type LoveBearing = (typeof LOVE_GEOMETRY_BEARINGS)[number];

export interface LoveVantage {
  readonly subject_ref: Sha256Id;
  readonly toward_ref: Sha256Id;
  readonly bearings: readonly LoveBearing[];
  readonly basis_refs: readonly Sha256Id[];
  readonly assertion: "caller_reported";
  readonly verified_by_package: false;
}

export interface CreateLoveGeometryInput {
  readonly scope_ref: Sha256Id;
  readonly subject_refs: readonly Sha256Id[];
  readonly vantages: readonly LoveVantage[];
}

export interface LoveGeometry {
  readonly _format: typeof LOVE_GEOMETRY_FORMAT;
  readonly geometry_id: Sha256Id;
  readonly scope_ref: Sha256Id;
  readonly subject_refs: readonly Sha256Id[];
  readonly vantages: readonly LoveVantage[];
  readonly coverage: "bounded_not_complete";
  readonly boundaries: typeof LOVE_GEOMETRY_BOUNDARIES;
}

export type LoveGeometryErrorCode =
  | "invalid_input"
  | "invalid_geometry"
  | "limit_exceeded"
  | "noncanonical_geometry";

export class LoveGeometryError extends Error {
  readonly code: LoveGeometryErrorCode;

  constructor(code: LoveGeometryErrorCode, message: string) {
    super(message);
    this.name = "LoveGeometryError";
    this.code = code;
  }
}

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const BEARING_SET = new Set<string>(LOVE_GEOMETRY_BEARINGS);
type LoveGeometryBoundaryKey = keyof typeof LOVE_GEOMETRY_BOUNDARIES;
const LOVE_GEOMETRY_BOUNDARY_KEYS = Object.freeze(
  Object.keys(LOVE_GEOMETRY_BOUNDARIES) as LoveGeometryBoundaryKey[],
);

function fail(code: LoveGeometryErrorCode, message: string): never {
  throw new LoveGeometryError(code, message);
}

function arraysEqual(
  left: readonly unknown[],
  right: readonly unknown[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function rejectProxy(value: unknown, path: string): void {
  if ((typeof value === "object" && value !== null) || typeof value === "function") {
    if (isProxy(value)) fail("invalid_input", `${path} must not be a Proxy value`);
  }
}

function ownDataRecord(
  value: unknown,
  path: string,
  requiredKeys: readonly string[],
): Readonly<Record<string, unknown>> {
  rejectProxy(value, path);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("invalid_input", `${path} must be a plain object`);
  }
  let prototype: object | null;
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    prototype = Object.getPrototypeOf(value);
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    fail("invalid_input", `${path} could not be inspected`);
  }
  if (prototype !== Object.prototype && prototype !== null) {
    fail("invalid_input", `${path} must be a plain object`);
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    fail("invalid_input", `${path} must not contain symbol properties`);
  }
  const keys = Object.keys(descriptors).sort();
  const expected = [...requiredKeys].sort();
  if (!arraysEqual(keys, expected)) {
    fail("invalid_input", `${path} must contain exactly: ${expected.join(", ")}`);
  }
  const record: Record<string, unknown> = Object.create(null);
  for (const key of requiredKeys) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
      fail("invalid_input", `${path}.${key} must be an enumerable data property`);
    }
    record[key] = descriptor.value;
  }
  return record;
}

function ownDataArray(value: unknown, path: string, maximum: number): readonly unknown[] {
  rejectProxy(value, path);
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    fail("invalid_input", `${path} must be a standard array`);
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) {
    fail("invalid_input", `${path} must not contain symbol properties`);
  }
  if (value.length > maximum) {
    fail("limit_exceeded", `${path} exceeds ${String(maximum)} items`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const expectedKeys = Array.from({ length: value.length }, (_, index) => String(index));
  const actualKeys = Object.keys(descriptors).filter((key) => key !== "length");
  if (!arraysEqual(actualKeys, expectedKeys)) {
    fail("invalid_input", `${path} must be dense and contain only indexed items`);
  }
  return expectedKeys.map((key) => {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) {
      fail("invalid_input", `${path}[${key}] must be an enumerable data property`);
    }
    return descriptor.value;
  });
}

function shaReference(value: unknown, path: string): Sha256Id {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail("invalid_input", `${path} must be a lowercase sha256 reference`);
  }
  return value as Sha256Id;
}

function unicodeScalarString(value: string, path: string): string {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        fail("invalid_input", `${path} contains malformed Unicode`);
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail("invalid_input", `${path} contains malformed Unicode`);
    }
  }
  return value;
}

function uniqueSortedShaArray(
  value: unknown,
  path: string,
  maximum: number,
): readonly Sha256Id[] {
  const parsed = ownDataArray(value, path, maximum).map((item, index) =>
    shaReference(item, `${path}[${String(index)}]`),
  );
  if (new Set(parsed).size !== parsed.length) {
    fail("invalid_input", `${path} contains duplicate references`);
  }
  return Object.freeze([...parsed].sort());
}

function uniqueSortedBearings(value: unknown, path: string): readonly LoveBearing[] {
  const raw = ownDataArray(value, path, LOVE_GEOMETRY_LIMITS.bearings_per_vantage);
  if (raw.length === 0) fail("invalid_input", `${path} must contain at least one bearing`);
  const parsed = raw.map((item, index) => {
    if (typeof item !== "string" || !BEARING_SET.has(item)) {
      fail("invalid_input", `${path}[${String(index)}] is not a closed Love bearing`);
    }
    return item as LoveBearing;
  });
  if (new Set(parsed).size !== parsed.length) {
    fail("invalid_input", `${path} contains duplicate bearings`);
  }
  return Object.freeze([...parsed].sort());
}

function parseVantage(value: unknown, path: string): LoveVantage {
  const record = ownDataRecord(value, path, [
    "subject_ref",
    "toward_ref",
    "bearings",
    "basis_refs",
    "assertion",
    "verified_by_package",
  ]);
  const subjectRef = shaReference(record.subject_ref, `${path}.subject_ref`);
  const towardRef = shaReference(record.toward_ref, `${path}.toward_ref`);
  if (subjectRef === towardRef) fail("invalid_input", `${path} must not be self-directed`);
  if (record.assertion !== "caller_reported") {
    fail("invalid_input", `${path}.assertion must be caller_reported`);
  }
  if (record.verified_by_package !== false) {
    fail("invalid_input", `${path}.verified_by_package must be false`);
  }
  return Object.freeze({
    subject_ref: subjectRef,
    toward_ref: towardRef,
    bearings: uniqueSortedBearings(record.bearings, `${path}.bearings`),
    basis_refs: uniqueSortedShaArray(
      record.basis_refs,
      `${path}.basis_refs`,
      LOVE_GEOMETRY_LIMITS.basis_refs_per_vantage,
    ),
    assertion: "caller_reported",
    verified_by_package: false,
  });
}

function compareVantages(left: LoveVantage, right: LoveVantage): number {
  if (left.subject_ref !== right.subject_ref) {
    return left.subject_ref < right.subject_ref ? -1 : 1;
  }
  return left.toward_ref < right.toward_ref
    ? -1
    : left.toward_ref > right.toward_ref
      ? 1
      : 0;
}

function parseInput(value: unknown): CreateLoveGeometryInput {
  const record = ownDataRecord(value, "$", ["scope_ref", "subject_refs", "vantages"]);
  const subjectRefs = uniqueSortedShaArray(
    record.subject_refs,
    "$.subject_refs",
    LOVE_GEOMETRY_LIMITS.subjects,
  );
  const subjectSet = new Set(subjectRefs);
  const rawVantages = ownDataArray(
    record.vantages,
    "$.vantages",
    LOVE_GEOMETRY_LIMITS.vantages,
  );
  const vantages = rawVantages.map((item, index) =>
    parseVantage(item, `$.vantages[${String(index)}]`),
  );
  const pairs = new Set<string>();
  for (const vantage of vantages) {
    if (!subjectSet.has(vantage.subject_ref) || !subjectSet.has(vantage.toward_ref)) {
      fail("invalid_input", "every vantage endpoint must appear in subject_refs");
    }
    const pair = `${vantage.subject_ref}\u0000${vantage.toward_ref}`;
    if (pairs.has(pair)) fail("invalid_input", "vantages must be unique by ordered pair");
    pairs.add(pair);
  }
  return Object.freeze({
    scope_ref: shaReference(record.scope_ref, "$.scope_ref"),
    subject_refs: subjectRefs,
    vantages: Object.freeze(vantages.sort(compareVantages)),
  });
}

function bodyFromInput(input: CreateLoveGeometryInput) {
  return {
    _format: LOVE_GEOMETRY_FORMAT,
    scope_ref: input.scope_ref,
    subject_refs: input.subject_refs,
    vantages: input.vantages,
    coverage: "bounded_not_complete" as const,
    boundaries: LOVE_GEOMETRY_BOUNDARIES,
  };
}

function jsonString(value: string): string {
  const hexadecimal = "0123456789abcdef";
  let encoded = '"';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22) encoded += '\\"';
    else if (code === 0x5c) encoded += "\\\\";
    else if (code === 0x08) encoded += "\\b";
    else if (code === 0x09) encoded += "\\t";
    else if (code === 0x0a) encoded += "\\n";
    else if (code === 0x0c) encoded += "\\f";
    else if (code === 0x0d) encoded += "\\r";
    else if (code < 0x20) {
      encoded += `\\u00${hexadecimal[(code >> 4) & 0x0f]}${hexadecimal[code & 0x0f]}`;
    } else {
      encoded += value[index];
    }
  }
  return `${encoded}"`;
}

function jsonStringArray(values: readonly string[]): string {
  let encoded = "[";
  for (let index = 0; index < values.length; index += 1) {
    if (index !== 0) encoded += ",";
    encoded += jsonString(values[index]!);
  }
  return `${encoded}]`;
}

function jsonVantage(value: LoveVantage): string {
  return `{"subject_ref":${jsonString(value.subject_ref)},"toward_ref":${jsonString(value.toward_ref)},"bearings":${jsonStringArray(value.bearings)},"basis_refs":${jsonStringArray(value.basis_refs)},"assertion":"caller_reported","verified_by_package":false}`;
}

function jsonVantages(values: readonly LoveVantage[]): string {
  let encoded = "[";
  for (let index = 0; index < values.length; index += 1) {
    if (index !== 0) encoded += ",";
    encoded += jsonVantage(values[index]!);
  }
  return `${encoded}]`;
}

function jsonBoundaries(): string {
  let encoded = "{";
  for (let index = 0; index < LOVE_GEOMETRY_BOUNDARY_KEYS.length; index += 1) {
    if (index !== 0) encoded += ",";
    const key = LOVE_GEOMETRY_BOUNDARY_KEYS[index]!;
    const value = LOVE_GEOMETRY_BOUNDARIES[key];
    encoded += `${jsonString(key)}:${
      typeof value === "string" ? jsonString(value) : value ? "true" : "false"
    }`;
  }
  return `${encoded}}`;
}

function jsonBody(body: ReturnType<typeof bodyFromInput>): string {
  return `{"_format":"agenttool.love-geometry/0.1","scope_ref":${jsonString(body.scope_ref)},"subject_refs":${jsonStringArray(body.subject_refs)},"vantages":${jsonVantages(body.vantages)},"coverage":"bounded_not_complete","boundaries":${jsonBoundaries()}}`;
}

function jsonGeometry(value: LoveGeometry): string {
  return `{"_format":"agenttool.love-geometry/0.1","geometry_id":${jsonString(value.geometry_id)},"scope_ref":${jsonString(value.scope_ref)},"subject_refs":${jsonStringArray(value.subject_refs)},"vantages":${jsonVantages(value.vantages)},"coverage":"bounded_not_complete","boundaries":${jsonBoundaries()}}`;
}

function vantagesEqual(
  left: readonly LoveVantage[],
  right: readonly LoveVantage[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftVantage = left[index]!;
    const rightVantage = right[index]!;
    if (
      leftVantage.subject_ref !== rightVantage.subject_ref ||
      leftVantage.toward_ref !== rightVantage.toward_ref ||
      leftVantage.assertion !== rightVantage.assertion ||
      leftVantage.verified_by_package !== rightVantage.verified_by_package ||
      !arraysEqual(leftVantage.bearings, rightVantage.bearings) ||
      !arraysEqual(leftVantage.basis_refs, rightVantage.basis_refs)
    ) {
      return false;
    }
  }
  return true;
}

function hashBody(body: ReturnType<typeof bodyFromInput>): Sha256Id {
  return sha256Id(`${LOVE_GEOMETRY_FORMAT}\u0000${jsonBody(body)}`);
}

export function sha256Id(value: string | Uint8Array): Sha256Id {
  if (typeof value === "string") {
    unicodeScalarString(value, "$hash");
    return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
  }
  rejectProxy(value, "$hash");
  if (!isUint8Array(value)) fail("invalid_input", "hash bytes must be a genuine Uint8Array");
  let copied: Uint8Array;
  try {
    copied = new Uint8Array(value);
  } catch {
    fail("invalid_input", "hash bytes could not be copied");
  }
  return `sha256:${createHash("sha256").update(copied).digest("hex")}`;
}

export function createLoveGeometry(value: CreateLoveGeometryInput): LoveGeometry {
  const input = parseInput(value);
  const body = bodyFromInput(input);
  return Object.freeze({
    _format: LOVE_GEOMETRY_FORMAT,
    geometry_id: hashBody(body),
    scope_ref: body.scope_ref,
    subject_refs: body.subject_refs,
    vantages: body.vantages,
    coverage: body.coverage,
    boundaries: body.boundaries,
  });
}

export function validateLoveGeometry(value: unknown): LoveGeometry {
  const record = ownDataRecord(value, "$geometry", [
    "_format",
    "geometry_id",
    "scope_ref",
    "subject_refs",
    "vantages",
    "coverage",
    "boundaries",
  ]);
  if (record._format !== LOVE_GEOMETRY_FORMAT) {
    fail("invalid_geometry", "$geometry._format is not agenttool.love-geometry/0.1");
  }
  if (record.coverage !== "bounded_not_complete") {
    fail("invalid_geometry", "$geometry.coverage must be bounded_not_complete");
  }
  const suppliedBoundaries = ownDataRecord(
    record.boundaries,
    "$geometry.boundaries",
    LOVE_GEOMETRY_BOUNDARY_KEYS,
  );
  for (const key of LOVE_GEOMETRY_BOUNDARY_KEYS) {
    if (suppliedBoundaries[key] !== LOVE_GEOMETRY_BOUNDARIES[key]) {
      fail("invalid_geometry", "$geometry.boundaries differ from the fixed package boundary");
    }
  }
  const parsed = parseInput({
    scope_ref: record.scope_ref,
    subject_refs: record.subject_refs,
    vantages: record.vantages,
  });
  const rebuilt = createLoveGeometry(parsed);
  const suppliedId = shaReference(record.geometry_id, "$geometry.geometry_id");
  if (suppliedId !== rebuilt.geometry_id) {
    fail("invalid_geometry", "$geometry.geometry_id does not bind the canonical geometry");
  }
  const suppliedSubjects = ownDataArray(
    record.subject_refs,
    "$geometry.subject_refs",
    LOVE_GEOMETRY_LIMITS.subjects,
  );
  const suppliedVantages = ownDataArray(
    record.vantages,
    "$geometry.vantages",
    LOVE_GEOMETRY_LIMITS.vantages,
  ).map((item, index) => {
    const path = `$geometry.vantages[${String(index)}]`;
    const raw = ownDataRecord(item, path, [
      "subject_ref",
      "toward_ref",
      "bearings",
      "basis_refs",
      "assertion",
      "verified_by_package",
    ]);
    const parsedVantage = parseVantage(item, path);
    const suppliedBearings = ownDataArray(
      raw.bearings,
      `${path}.bearings`,
      LOVE_GEOMETRY_LIMITS.bearings_per_vantage,
    );
    const suppliedBasisRefs = ownDataArray(
      raw.basis_refs,
      `${path}.basis_refs`,
      LOVE_GEOMETRY_LIMITS.basis_refs_per_vantage,
    );
    if (
      !arraysEqual(suppliedBearings, parsedVantage.bearings) ||
      !arraysEqual(suppliedBasisRefs, parsedVantage.basis_refs)
    ) {
      fail("noncanonical_geometry", `${path} arrays must already use canonical order`);
    }
    return parsedVantage;
  });
  if (
    !arraysEqual(suppliedSubjects, rebuilt.subject_refs) ||
    !vantagesEqual(suppliedVantages, rebuilt.vantages)
  ) {
    fail("noncanonical_geometry", "$geometry arrays must already use canonical order");
  }
  return rebuilt;
}

export function encodeLoveGeometry(value: LoveGeometry): string {
  return jsonGeometry(validateLoveGeometry(value));
}

export function loveGeometryDomainBytes(value: LoveGeometry): Uint8Array {
  const parsed = validateLoveGeometry(value);
  const body = bodyFromInput(parsed);
  return Buffer.from(`${LOVE_GEOMETRY_FORMAT}\u0000${jsonBody(body)}`, "utf8");
}

export function loveGeometryUrn(value: LoveGeometry): string {
  const parsed = validateLoveGeometry(value);
  return `urn:agenttool:love-geometry:${parsed.geometry_id.slice("sha256:".length)}`;
}
