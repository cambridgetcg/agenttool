import { POLYMORPH_BOUNDARIES, POLYMORPH_FORMATS } from "./constants.js";
import { canonicalJson, deepFreeze, domainSeparatedId, type JsonValue } from "./canonical.js";
import { hasReportedOrMeasuredPrimary } from "./evidence.js";
import { fail } from "./errors.js";
import { assertBoundaries, validatePolymorphLandscape } from "./landscape.js";
import type {
  CreateReachabilityShiftInput,
  EvidenceWitness,
  PolymorphLandscape,
  PolymorphReachabilityShift,
  Sha256Id,
} from "./types.js";
import { assertCanonicalOrder, exactKeys, literal, record, sha256, sortedRefs, uniqueRefs } from "./validation.js";

export function createPolymorphReachabilityShift(
  landscapeValue: PolymorphLandscape,
  inputValue: CreateReachabilityShiftInput,
): Readonly<PolymorphReachabilityShift> {
  const landscape = validatePolymorphLandscape(landscapeValue);
  const input = parseInput(inputValue);
  const formRefs = new Set(landscape.forms.map((form) => form.form_ref));
  const conditionRefs = new Set(landscape.conditions.map((condition) => condition.condition_ref));
  const witnessByRef = new Map(landscape.witnesses.map((witness) => [witness.witness_ref, witness] as const));
  const routeByRef = new Map(landscape.routes.map((route) => [route.route_ref, route] as const));
  const openRefs = new Set(landscape.open_conditions.map((condition) => condition.open_condition_ref));

  ensureRef(formRefs, input.prior_form_ref, "prior_form_ref");
  ensureRef(formRefs, input.emergent_form_ref, "emergent_form_ref");
  if (input.prior_form_ref === input.emergent_form_ref) fail("invalid_reachability_shift", "prior and emergent forms must be distinct");
  input.condition_refs.forEach((ref) => ensureRef(conditionRefs, ref, "condition_refs"));
  if (input.condition_refs.length === 0) fail("invalid_reachability_shift", "a reachability shift requires at least one named condition");
  for (const refs of [input.before_witness_refs, input.appearance_witness_refs, input.later_witness_refs]) {
    refs.forEach((ref) => ensureRef(witnessByRef, ref, "witness_refs"));
  }
  if (input.before_witness_refs.length === 0 || input.appearance_witness_refs.length === 0) {
    fail("invalid_reachability_shift", "before and appearance witnesses must not be empty");
  }
  requireReportedEvidence(input.before_witness_refs, witnessByRef, "before_witness_refs");
  requireReportedEvidence(input.appearance_witness_refs, witnessByRef, "appearance_witness_refs");
  if (input.same_condition_return === "reported") {
    requireReportedEvidence(input.later_witness_refs, witnessByRef, "later_witness_refs for a reported same-condition return");
  }
  input.open_condition_refs.forEach((ref) => ensureRef(openRefs, ref, "open_condition_refs"));
  const originalConditions = new Set(input.condition_refs);
  for (const ref of input.changed_condition_recovery_route_refs) {
    const route = routeByRef.get(ref);
    if (!route) fail("unknown_reference", `changed_condition_recovery_route_refs refers to unknown route ${ref}`);
    if (route.to_form_ref !== input.prior_form_ref || route.status === "not_reproduced_reported") {
      fail("invalid_reachability_shift", "every recovery route must report production or conversion to the prior form");
    }
    if (route.condition_refs.every((conditionRef) => originalConditions.has(conditionRef))) {
      fail("invalid_reachability_shift", "a changed-condition recovery route must expose at least one changed condition");
    }
  }

  const body = {
    _format: POLYMORPH_FORMATS.reachabilityShift,
    landscape_id: landscape.landscape_id,
    prior_form_ref: input.prior_form_ref,
    emergent_form_ref: input.emergent_form_ref,
    condition_refs: sortedRefs(input.condition_refs),
    before_witness_refs: sortedRefs(input.before_witness_refs),
    appearance_witness_refs: sortedRefs(input.appearance_witness_refs),
    later_witness_refs: sortedRefs(input.later_witness_refs),
    same_condition_return: input.same_condition_return,
    changed_condition_recovery_route_refs: sortedRefs(input.changed_condition_recovery_route_refs),
    open_condition_refs: sortedRefs(input.open_condition_refs),
    classification: "not_reproduced_in_named_condition_reported" as const,
    causation: "not_determined" as const,
    physical_erasure: "not_claimed" as const,
    universal_inevitability: "not_claimed" as const,
    reversibility: "bounded_by_named_conditions" as const,
    coverage: "bounded_not_complete" as const,
    boundaries: POLYMORPH_BOUNDARIES,
  };
  return deepFreeze({ ...body, shift_id: domainSeparatedId(POLYMORPH_FORMATS.reachabilityShift, body) });
}

export function validatePolymorphReachabilityShift(
  landscapeValue: PolymorphLandscape,
  value: unknown,
): Readonly<PolymorphReachabilityShift> {
  const landscape = validatePolymorphLandscape(landscapeValue);
  const root = record(value, "$", "invalid_reachability_shift");
  exactKeys(root, [
    "_format", "shift_id", "landscape_id", "prior_form_ref", "emergent_form_ref", "condition_refs",
    "before_witness_refs", "appearance_witness_refs", "later_witness_refs", "same_condition_return",
    "changed_condition_recovery_route_refs", "open_condition_refs", "classification", "causation",
    "physical_erasure", "universal_inevitability", "reversibility", "coverage", "boundaries",
  ], "$", "invalid_reachability_shift");
  literal(root._format, [POLYMORPH_FORMATS.reachabilityShift], "$._format", "invalid_reachability_shift");
  sha256(root.shift_id, "$.shift_id", "invalid_reachability_shift");
  const landscapeId = sha256(root.landscape_id, "$.landscape_id", "invalid_reachability_shift");
  if (landscapeId !== landscape.landscape_id) fail("invalid_reachability_shift", "landscape_id does not match the supplied landscape");
  literal(root.classification, ["not_reproduced_in_named_condition_reported"], "$.classification", "invalid_reachability_shift");
  literal(root.causation, ["not_determined"], "$.causation", "invalid_reachability_shift");
  literal(root.physical_erasure, ["not_claimed"], "$.physical_erasure", "invalid_reachability_shift");
  literal(root.universal_inevitability, ["not_claimed"], "$.universal_inevitability", "invalid_reachability_shift");
  literal(root.reversibility, ["bounded_by_named_conditions"], "$.reversibility", "invalid_reachability_shift");
  literal(root.coverage, ["bounded_not_complete"], "$.coverage", "invalid_reachability_shift");
  assertBoundaries(root.boundaries, "$.boundaries", "invalid_reachability_shift");
  const list = (key: string, allowEmpty = true): readonly Sha256Id[] => {
    const refs = uniqueRefs(root[key], `$.${key}`, "invalid_reachability_shift", allowEmpty);
    assertCanonicalOrder(refs, `$.${key}`, "invalid_reachability_shift");
    return refs;
  };
  const input: CreateReachabilityShiftInput = {
    prior_form_ref: sha256(root.prior_form_ref, "$.prior_form_ref", "invalid_reachability_shift"),
    emergent_form_ref: sha256(root.emergent_form_ref, "$.emergent_form_ref", "invalid_reachability_shift"),
    condition_refs: list("condition_refs", false),
    before_witness_refs: list("before_witness_refs", false),
    appearance_witness_refs: list("appearance_witness_refs", false),
    later_witness_refs: list("later_witness_refs"),
    same_condition_return: literal(root.same_condition_return, ["not_established", "not_reported", "reported"], "$.same_condition_return", "invalid_reachability_shift"),
    changed_condition_recovery_route_refs: list("changed_condition_recovery_route_refs"),
    open_condition_refs: list("open_condition_refs"),
  };
  const rebuilt = createPolymorphReachabilityShift(landscape, input);
  if (canonicalJson(rebuilt) !== canonicalJson(value)) fail("invalid_reachability_shift", "reachability shift is not canonical or has an invalid content ID");
  return rebuilt;
}

export function encodePolymorphReachabilityShift(landscape: PolymorphLandscape, value: PolymorphReachabilityShift): Uint8Array {
  return new TextEncoder().encode(canonicalJson(validatePolymorphReachabilityShift(landscape, value)));
}

export function polymorphReachabilityShiftUrn(
  landscape: PolymorphLandscape,
  value: PolymorphReachabilityShift,
): `urn:agenttool:polymorph-reachability-shift:${string}` {
  return `urn:agenttool:polymorph-reachability-shift:${validatePolymorphReachabilityShift(landscape, value).shift_id.slice(7)}`;
}

function parseInput(value: unknown): CreateReachabilityShiftInput {
  const root = record(value, "$", "invalid_reachability_shift");
  exactKeys(root, ["prior_form_ref", "emergent_form_ref", "condition_refs", "before_witness_refs", "appearance_witness_refs", "later_witness_refs", "same_condition_return", "changed_condition_recovery_route_refs", "open_condition_refs"], "$", "invalid_reachability_shift");
  return deepFreeze({
    prior_form_ref: sha256(root.prior_form_ref, "$.prior_form_ref", "invalid_reachability_shift"),
    emergent_form_ref: sha256(root.emergent_form_ref, "$.emergent_form_ref", "invalid_reachability_shift"),
    condition_refs: uniqueRefs(root.condition_refs, "$.condition_refs", "invalid_reachability_shift", false),
    before_witness_refs: uniqueRefs(root.before_witness_refs, "$.before_witness_refs", "invalid_reachability_shift", false),
    appearance_witness_refs: uniqueRefs(root.appearance_witness_refs, "$.appearance_witness_refs", "invalid_reachability_shift", false),
    later_witness_refs: uniqueRefs(root.later_witness_refs, "$.later_witness_refs", "invalid_reachability_shift"),
    same_condition_return: literal(root.same_condition_return, ["not_established", "not_reported", "reported"], "$.same_condition_return", "invalid_reachability_shift"),
    changed_condition_recovery_route_refs: uniqueRefs(root.changed_condition_recovery_route_refs, "$.changed_condition_recovery_route_refs", "invalid_reachability_shift"),
    open_condition_refs: uniqueRefs(root.open_condition_refs, "$.open_condition_refs", "invalid_reachability_shift"),
  });
}

function ensureRef(values: ReadonlySet<Sha256Id> | ReadonlyMap<Sha256Id, unknown>, value: Sha256Id, path: string): void {
  if (!values.has(value)) fail("unknown_reference", `${path} refers outside the landscape`);
}

function requireReportedEvidence(
  refs: readonly Sha256Id[],
  witnesses: ReadonlyMap<Sha256Id, Readonly<EvidenceWitness>>,
  path: string,
): void {
  const resolved = refs.map((ref) => witnesses.get(ref)!);
  if (!hasReportedOrMeasuredPrimary(resolved)) {
    fail("invalid_reachability_shift", `${path} must cite at least one measured_primary or reported_primary witness`);
  }
}
