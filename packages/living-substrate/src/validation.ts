import {
  LIVING_SUBSTRATE_BOUNDARIES,
  LIVING_SUBSTRATE_CONDITIONS,
  LIVING_SUBSTRATE_FACET_KINDS,
  LIVING_SUBSTRATE_RELATIONS,
  REGENERATION_ACTION_KINDS,
  REGENERATION_CHOICE,
  REGENERATION_REVERSIBILITY,
} from "./constants.js";
import {
  canonicalJson,
  compareUnicode,
  deepFreeze,
  snapshotJson,
  type JsonValue,
} from "./canonical.js";
import { fail, type LivingSubstrateErrorCode } from "./errors.js";
import type {
  LivingSubstrateFacet,
  LivingSubstrateRelation,
  RegenerationAction,
  Sha256Id,
} from "./types.js";

const SHA256_ID = /^sha256:[0-9a-f]{64}$/u;
const MAX_FACETS = 64;
const MAX_RELATIONS = 256;
const MAX_EVIDENCE_REFS = 8;
const MAX_ACTIONS = 64;
const MAX_TARGET_REFS = 16;
const MAX_BASIS_REFS = 16;

export function record(
  value: unknown,
  path: string,
  code: LivingSubstrateErrorCode,
): Record<string, JsonValue> {
  const snapshot = snapshotJson(value);
  if (
    snapshot === null ||
    Array.isArray(snapshot) ||
    typeof snapshot !== "object"
  ) {
    fail(code, `${path} must be a plain object`);
  }
  return snapshot;
}

export function exactKeys(
  value: Record<string, JsonValue>,
  expected: readonly string[],
  path: string,
  code: LivingSubstrateErrorCode,
): void {
  const actual = Object.keys(value).sort(compareUnicode);
  const wanted = [...expected].sort(compareUnicode);
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    fail(code, `${path} must contain exactly: ${wanted.join(", ")}`);
  }
}

export function text(
  value: JsonValue | undefined,
  path: string,
  code: LivingSubstrateErrorCode,
): string {
  if (typeof value !== "string") fail(code, `${path} must be a string`);
  return value;
}

export function literal<T extends string>(
  value: JsonValue | undefined,
  allowed: readonly T[],
  path: string,
  code: LivingSubstrateErrorCode,
): T {
  const candidate = text(value, path, code);
  if (!(allowed as readonly string[]).includes(candidate)) {
    fail(code, `${path} must be one of: ${allowed.join(", ")}`);
  }
  return candidate as T;
}

export function sha256(
  value: JsonValue | undefined,
  path: string,
  code: LivingSubstrateErrorCode,
): Sha256Id {
  const candidate = text(value, path, code);
  if (!SHA256_ID.test(candidate)) {
    fail(code, `${path} must be a lowercase sha256: content ID`);
  }
  return candidate as Sha256Id;
}

function fixedFalse(
  value: JsonValue | undefined,
  path: string,
  code: LivingSubstrateErrorCode,
): false {
  if (value !== false) fail(code, `${path} must be false`);
  return false;
}

function parseRefList(
  value: JsonValue | undefined,
  path: string,
  code: LivingSubstrateErrorCode,
  maximum: number,
  normalize: boolean,
): readonly Sha256Id[] {
  if (!Array.isArray(value) || value.length > maximum) {
    fail(code, `${path} must be an array of at most ${String(maximum)} refs`);
  }
  const refs = value.map((entry, index) =>
    sha256(entry, `${path}[${String(index)}]`, code),
  );
  if (new Set(refs).size !== refs.length) {
    fail(code, `${path} must not contain duplicate refs`);
  }
  const sorted = [...refs].sort(compareUnicode);
  if (!normalize && refs.some((entry, index) => entry !== sorted[index])) {
    fail(code, `${path} must use canonical Unicode order`);
  }
  return deepFreeze(normalize ? sorted : refs);
}

function parseFacet(
  value: JsonValue,
  path: string,
  code: LivingSubstrateErrorCode,
  normalize: boolean,
): Readonly<LivingSubstrateFacet> {
  const candidate = record(value, path, code);
  exactKeys(
    candidate,
    [
      "facet_id",
      "kind",
      "condition",
      "evidence_refs",
      "assertion",
      "verified_by_package",
    ],
    path,
    code,
  );
  return deepFreeze({
    facet_id: sha256(candidate.facet_id, `${path}.facet_id`, code),
    kind: literal(
      candidate.kind,
      LIVING_SUBSTRATE_FACET_KINDS,
      `${path}.kind`,
      code,
    ),
    condition: literal(
      candidate.condition,
      LIVING_SUBSTRATE_CONDITIONS,
      `${path}.condition`,
      code,
    ),
    evidence_refs: parseRefList(
      candidate.evidence_refs,
      `${path}.evidence_refs`,
      code,
      MAX_EVIDENCE_REFS,
      normalize,
    ),
    assertion: literal(
      candidate.assertion,
      ["caller_asserted"],
      `${path}.assertion`,
      code,
    ),
    verified_by_package: fixedFalse(
      candidate.verified_by_package,
      `${path}.verified_by_package`,
      code,
    ),
  });
}

export function parseFacets(
  value: JsonValue | undefined,
  path: string,
  code: LivingSubstrateErrorCode,
  normalize: boolean,
): readonly Readonly<LivingSubstrateFacet>[] {
  if (!Array.isArray(value) || value.length > MAX_FACETS) {
    fail(
      code,
      `${path} must be an array of at most ${String(MAX_FACETS)} facets`,
    );
  }
  const facets = value.map((entry, index) =>
    parseFacet(entry, `${path}[${String(index)}]`, code, normalize),
  );
  const ids = facets.map((facet) => facet.facet_id);
  if (new Set(ids).size !== ids.length) {
    fail(code, `${path} must not contain duplicate facet_id values`);
  }
  const sorted = [...facets].sort((left, right) =>
    compareUnicode(left.facet_id, right.facet_id),
  );
  if (
    !normalize &&
    facets.some((facet, index) => facet.facet_id !== sorted[index]?.facet_id)
  ) {
    fail(code, `${path} must be sorted by facet_id`);
  }
  return deepFreeze(normalize ? sorted : facets);
}

function relationKey(relation: LivingSubstrateRelation): string {
  return `${relation.from_ref}\u0000${relation.relation}\u0000${relation.to_ref}`;
}

function compareRelations(
  left: LivingSubstrateRelation,
  right: LivingSubstrateRelation,
): number {
  return compareUnicode(relationKey(left), relationKey(right));
}

function parseRelation(
  value: JsonValue,
  path: string,
  code: LivingSubstrateErrorCode,
  normalize: boolean,
): Readonly<LivingSubstrateRelation> {
  const candidate = record(value, path, code);
  exactKeys(
    candidate,
    [
      "from_ref",
      "relation",
      "to_ref",
      "evidence_refs",
      "assertion",
      "verified_by_package",
    ],
    path,
    code,
  );
  const fromRef = sha256(candidate.from_ref, `${path}.from_ref`, code);
  const toRef = sha256(candidate.to_ref, `${path}.to_ref`, code);
  if (fromRef === toRef) {
    fail(code, `${path} must not be a self-relation`);
  }
  return deepFreeze({
    from_ref: fromRef,
    relation: literal(
      candidate.relation,
      LIVING_SUBSTRATE_RELATIONS,
      `${path}.relation`,
      code,
    ),
    to_ref: toRef,
    evidence_refs: parseRefList(
      candidate.evidence_refs,
      `${path}.evidence_refs`,
      code,
      MAX_EVIDENCE_REFS,
      normalize,
    ),
    assertion: literal(
      candidate.assertion,
      ["caller_asserted"],
      `${path}.assertion`,
      code,
    ),
    verified_by_package: fixedFalse(
      candidate.verified_by_package,
      `${path}.verified_by_package`,
      code,
    ),
  });
}

export function parseRelations(
  value: JsonValue | undefined,
  facetIds: ReadonlySet<Sha256Id>,
  path: string,
  code: LivingSubstrateErrorCode,
  normalize: boolean,
): readonly Readonly<LivingSubstrateRelation>[] {
  if (!Array.isArray(value) || value.length > MAX_RELATIONS) {
    fail(
      code,
      `${path} must be an array of at most ${String(MAX_RELATIONS)} relations`,
    );
  }
  const relations = value.map((entry, index) =>
    parseRelation(entry, `${path}[${String(index)}]`, code, normalize),
  );
  for (const relation of relations) {
    if (!facetIds.has(relation.from_ref) || !facetIds.has(relation.to_ref)) {
      fail(code, `${path} contains a relation with an unknown facet endpoint`);
    }
  }
  const keys = relations.map(relationKey);
  if (new Set(keys).size !== keys.length) {
    fail(code, `${path} must not contain duplicate directed relations`);
  }
  const sorted = [...relations].sort(compareRelations);
  if (
    !normalize &&
    relations.some(
      (relation, index) =>
        relationKey(relation) !== relationKey(sorted[index]!),
    )
  ) {
    fail(code, `${path} must use canonical relation order`);
  }
  return deepFreeze(normalize ? sorted : relations);
}

function parseAction(
  value: JsonValue,
  path: string,
  code: LivingSubstrateErrorCode,
  normalize: boolean,
): Readonly<RegenerationAction> {
  const candidate = record(value, path, code);
  exactKeys(
    candidate,
    [
      "action_ref",
      "kind",
      "target_refs",
      "basis_refs",
      "reversibility",
      "state",
      "authority",
      "assertion",
      "verified_by_package",
    ],
    path,
    code,
  );
  const targets = parseRefList(
    candidate.target_refs,
    `${path}.target_refs`,
    code,
    MAX_TARGET_REFS,
    normalize,
  );
  if (targets.length === 0) {
    fail(code, `${path}.target_refs must contain at least one facet ref`);
  }
  return deepFreeze({
    action_ref: sha256(candidate.action_ref, `${path}.action_ref`, code),
    kind: literal(
      candidate.kind,
      REGENERATION_ACTION_KINDS,
      `${path}.kind`,
      code,
    ),
    target_refs: targets,
    basis_refs: parseRefList(
      candidate.basis_refs,
      `${path}.basis_refs`,
      code,
      MAX_BASIS_REFS,
      normalize,
    ),
    reversibility: literal(
      candidate.reversibility,
      REGENERATION_REVERSIBILITY,
      `${path}.reversibility`,
      code,
    ),
    state: literal(
      candidate.state,
      ["proposed_unaccepted"],
      `${path}.state`,
      code,
    ),
    authority: literal(
      candidate.authority,
      ["separate_authority_required"],
      `${path}.authority`,
      code,
    ),
    assertion: literal(
      candidate.assertion,
      ["caller_asserted"],
      `${path}.assertion`,
      code,
    ),
    verified_by_package: fixedFalse(
      candidate.verified_by_package,
      `${path}.verified_by_package`,
      code,
    ),
  });
}

export function parseActions(
  value: JsonValue | undefined,
  facetIds: ReadonlySet<Sha256Id> | null,
  path: string,
  code: LivingSubstrateErrorCode,
  normalize: boolean,
): readonly Readonly<RegenerationAction>[] {
  if (!Array.isArray(value) || value.length > MAX_ACTIONS) {
    fail(
      code,
      `${path} must be an array of at most ${String(MAX_ACTIONS)} actions`,
    );
  }
  const actions = value.map((entry, index) =>
    parseAction(entry, `${path}[${String(index)}]`, code, normalize),
  );
  const ids = actions.map((action) => action.action_ref);
  if (new Set(ids).size !== ids.length) {
    fail(code, `${path} must not contain duplicate action_ref values`);
  }
  if (facetIds) {
    for (const action of actions) {
      if (action.target_refs.some((ref) => !facetIds.has(ref))) {
        fail(code, `${path} contains an action with an unknown target facet`);
      }
    }
  }
  const sorted = [...actions].sort((left, right) =>
    compareUnicode(left.action_ref, right.action_ref),
  );
  if (
    !normalize &&
    actions.some(
      (action, index) => action.action_ref !== sorted[index]?.action_ref,
    )
  ) {
    fail(code, `${path} must be sorted by action_ref`);
  }
  return deepFreeze(normalize ? sorted : actions);
}

export function parseBoundaries(
  value: JsonValue | undefined,
  path: string,
  code: LivingSubstrateErrorCode,
): typeof LIVING_SUBSTRATE_BOUNDARIES {
  const candidate = record(value, path, code);
  if (canonicalJson(candidate) !== canonicalJson(LIVING_SUBSTRATE_BOUNDARIES)) {
    fail(code, `${path} must equal the fixed no-effect boundary`);
  }
  return LIVING_SUBSTRATE_BOUNDARIES;
}

export function parseChoice(
  value: JsonValue | undefined,
  path: string,
  code: LivingSubstrateErrorCode,
): typeof REGENERATION_CHOICE {
  const candidate = record(value, path, code);
  if (canonicalJson(candidate) !== canonicalJson(REGENERATION_CHOICE)) {
    fail(code, `${path} must equal the fixed no-default choice boundary`);
  }
  return REGENERATION_CHOICE;
}
