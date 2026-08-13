import { MEMETIC_BOUNDARIES, MEMETIC_FORMATS, SHIFT_OUTCOMES } from "./constants.js";
import { canonicalJson, deepFreeze, domainSeparatedId, type JsonValue } from "./canonical.js";
import { fail, type MemeticLandscapeErrorCode } from "./errors.js";
import { assertMemeticBoundaries, validateMemeticLandscape } from "./landscape.js";
import type {
  CreateMemeticReachabilityShiftInput,
  MemeticEvidence,
  MemeticLandscape,
  MemeticReachabilityShift,
  Sha256Id,
} from "./types.js";
import { exactKeys, literal, record, sha256, sortedRefs, uniqueRefs } from "./validation.js";

export function createMemeticReachabilityShift(
  landscapeValue: MemeticLandscape,
  inputValue: CreateMemeticReachabilityShiftInput,
): Readonly<MemeticReachabilityShift> {
  const landscape = validateMemeticLandscape(landscapeValue);
  const input = parseInput(inputValue);
  const variants = new Set(landscape.variants.map((variant) => variant.variant_ref));
  const contexts = new Set(landscape.contexts.map((context) => context.context_ref));
  const evidence = new Map(landscape.evidence.map((item) => [item.evidence_ref, item] as const));
  const routes = new Map(landscape.routes.map((route) => [route.route_ref, route] as const));
  const questions = new Set(landscape.open_questions.map((question) => question.open_question_ref));

  ensureRef(variants, input.focus_variant_ref, "focus_variant_ref");
  input.prior_context_refs.forEach((ref) => ensureRef(contexts, ref, "prior_context_refs"));
  input.changed_context_refs.forEach((ref) => ensureRef(contexts, ref, "changed_context_refs"));
  if (input.prior_context_refs.length === 0 || input.changed_context_refs.length === 0) {
    fail("invalid_reachability_shift", "prior and changed contexts must not be empty");
  }
  const prior = new Set(input.prior_context_refs);
  const novelChanged = new Set(input.changed_context_refs.filter((ref) => !prior.has(ref)));
  if (novelChanged.size === 0) {
    fail("invalid_reachability_shift", "changed_context_refs must expose at least one changed context");
  }

  for (const refs of [input.before_evidence_refs, input.shift_evidence_refs, input.later_evidence_refs]) {
    refs.forEach((ref) => ensureRef(evidence, ref, "evidence refs"));
  }
  if (input.before_evidence_refs.length === 0 || input.shift_evidence_refs.length === 0) {
    fail("invalid_reachability_shift", "before and shift evidence must not be empty");
  }
  requireExternalEvidence(input.before_evidence_refs, evidence, "before_evidence_refs");
  requireExternalEvidence(input.shift_evidence_refs, evidence, "shift_evidence_refs");

  const priorObservations = linkedObservations(
    landscape,
    input.focus_variant_ref,
    new Set(input.prior_context_refs),
    new Set(input.before_evidence_refs),
  );
  const changedObservations = linkedObservations(
    landscape,
    input.focus_variant_ref,
    novelChanged,
    new Set([...input.shift_evidence_refs, ...input.later_evidence_refs]),
  );
  if (priorObservations.length === 0) {
    fail("invalid_reachability_shift", "before evidence must overlap a focus-variant observation in a named prior context");
  }
  if (changedObservations.length === 0) {
    fail("invalid_reachability_shift", "shift or later evidence must overlap a focus-variant observation in a named changed context");
  }
  if (input.outcome === "less_observed") {
    if (!priorObservations.some((observation) => observation.status === "reported_present")) {
      fail("invalid_reachability_shift", "less_observed requires a reported-present prior observation");
    }
    if (!changedObservations.some((observation) => observation.status === "not_observed_in_bounded_sample" || observation.status === "reported_absent_in_bounded_sample")) {
      fail("invalid_reachability_shift", "less_observed requires a bounded non-observation or reported-absent changed observation");
    }
  }
  if (input.outcome === "more_observed" && !changedObservations.some((observation) => observation.status === "reported_present")) {
    fail("invalid_reachability_shift", "more_observed requires a reported-present changed observation");
  }
  if (input.outcome === "reappeared") {
    if (!priorObservations.some((observation) => observation.status === "not_observed_in_bounded_sample" || observation.status === "reported_absent_in_bounded_sample")) {
      fail("invalid_reachability_shift", "reappeared requires a bounded non-observation or reported-absent prior observation");
    }
    if (!changedObservations.some((observation) => observation.status === "reported_present")) {
      fail("invalid_reachability_shift", "reappeared requires a reported-present changed observation");
    }
  }

  input.competing_variant_refs.forEach((ref) => ensureRef(variants, ref, "competing_variant_refs"));
  if (input.competing_variant_refs.includes(input.focus_variant_ref)) {
    fail("invalid_reachability_shift", "the focus variant cannot compete with itself");
  }
  for (const ref of input.changed_context_route_refs) {
    const route = routes.get(ref);
    if (!route) fail("unknown_reference", `changed_context_route_refs refers to unknown route ${ref}`);
    if (route.from_variant_ref !== input.focus_variant_ref && route.to_variant_ref !== input.focus_variant_ref) {
      fail("invalid_reachability_shift", "every changed-context route must involve the focus variant");
    }
    if (!route.context_refs.some((contextRef) => novelChanged.has(contextRef))) {
      fail("invalid_reachability_shift", "every changed-context route must retain a context absent from prior_context_refs");
    }
    if ((input.outcome === "more_observed" || input.outcome === "reappeared") && route.to_variant_ref !== input.focus_variant_ref) {
      fail("invalid_reachability_shift", "more-observed and reappeared routes must point to the focus variant");
    }
  }
  input.open_question_refs.forEach((ref) => ensureRef(questions, ref, "open_question_refs"));

  const body = {
    _format: MEMETIC_FORMATS.reachabilityShift,
    landscape_id: landscape.landscape_id,
    focus_variant_ref: input.focus_variant_ref,
    prior_context_refs: sortedRefs(input.prior_context_refs),
    changed_context_refs: sortedRefs(input.changed_context_refs),
    before_evidence_refs: sortedRefs(input.before_evidence_refs),
    shift_evidence_refs: sortedRefs(input.shift_evidence_refs),
    later_evidence_refs: sortedRefs(input.later_evidence_refs),
    competing_variant_refs: sortedRefs(input.competing_variant_refs),
    changed_context_route_refs: sortedRefs(input.changed_context_route_refs),
    open_question_refs: sortedRefs(input.open_question_refs),
    outcome: input.outcome,
    classification: "bounded_reachability_shift_caller_reported" as const,
    causation: "not_determined" as const,
    physical_erasure: "not_claimed" as const,
    adoption_from_exposure: "not_inferred" as const,
    mental_health_effect: "not_inferred" as const,
    population_effect: "not_inferred" as const,
    reversibility: "bounded_by_named_contexts" as const,
    coverage: "bounded_not_complete" as const,
    boundaries: MEMETIC_BOUNDARIES,
  };
  return deepFreeze({ ...body, shift_id: domainSeparatedId(MEMETIC_FORMATS.reachabilityShift, body) });
}

export function validateMemeticReachabilityShift(
  landscapeValue: MemeticLandscape,
  value: unknown,
): Readonly<MemeticReachabilityShift> {
  const landscape = validateMemeticLandscape(landscapeValue);
  const root = record(value, "$", "invalid_reachability_shift");
  exactKeys(root, [
    "_format", "shift_id", "landscape_id", "focus_variant_ref", "prior_context_refs", "changed_context_refs",
    "before_evidence_refs", "shift_evidence_refs", "later_evidence_refs", "competing_variant_refs",
    "changed_context_route_refs", "open_question_refs", "outcome", "classification", "causation",
    "physical_erasure", "adoption_from_exposure", "mental_health_effect", "population_effect",
    "reversibility", "coverage", "boundaries",
  ], "$", "invalid_reachability_shift");
  literal(root._format, [MEMETIC_FORMATS.reachabilityShift], "$._format", "invalid_reachability_shift");
  sha256(root.shift_id, "$.shift_id", "invalid_reachability_shift");
  const landscapeId = sha256(root.landscape_id, "$.landscape_id", "invalid_reachability_shift");
  if (landscapeId !== landscape.landscape_id) fail("invalid_reachability_shift", "landscape_id does not match the supplied landscape");
  literal(root.classification, ["bounded_reachability_shift_caller_reported"], "$.classification", "invalid_reachability_shift");
  literal(root.causation, ["not_determined"], "$.causation", "invalid_reachability_shift");
  literal(root.physical_erasure, ["not_claimed"], "$.physical_erasure", "invalid_reachability_shift");
  literal(root.adoption_from_exposure, ["not_inferred"], "$.adoption_from_exposure", "invalid_reachability_shift");
  literal(root.mental_health_effect, ["not_inferred"], "$.mental_health_effect", "invalid_reachability_shift");
  literal(root.population_effect, ["not_inferred"], "$.population_effect", "invalid_reachability_shift");
  literal(root.reversibility, ["bounded_by_named_contexts"], "$.reversibility", "invalid_reachability_shift");
  literal(root.coverage, ["bounded_not_complete"], "$.coverage", "invalid_reachability_shift");
  assertMemeticBoundaries(root.boundaries, "$.boundaries", "invalid_reachability_shift");
  const refs = (key: string, allowEmpty = true): readonly Sha256Id[] => uniqueRefs(root[key], `$.${key}`, "invalid_reachability_shift", allowEmpty);
  const rebuilt = createMemeticReachabilityShift(landscape, {
    focus_variant_ref: sha256(root.focus_variant_ref, "$.focus_variant_ref", "invalid_reachability_shift"),
    prior_context_refs: refs("prior_context_refs", false),
    changed_context_refs: refs("changed_context_refs", false),
    before_evidence_refs: refs("before_evidence_refs", false),
    shift_evidence_refs: refs("shift_evidence_refs", false),
    later_evidence_refs: refs("later_evidence_refs"),
    competing_variant_refs: refs("competing_variant_refs"),
    changed_context_route_refs: refs("changed_context_route_refs"),
    open_question_refs: refs("open_question_refs"),
    outcome: literal(root.outcome, SHIFT_OUTCOMES, "$.outcome", "invalid_reachability_shift"),
  });
  if (canonicalJson(rebuilt) !== canonicalJson(value)) {
    fail("invalid_reachability_shift", "reachability shift is not canonical or has an invalid content ID");
  }
  return rebuilt;
}

export function encodeMemeticReachabilityShift(
  landscape: MemeticLandscape,
  value: MemeticReachabilityShift,
): Uint8Array {
  return new TextEncoder().encode(canonicalJson(validateMemeticReachabilityShift(landscape, value)));
}

export function memeticReachabilityShiftUrn(
  landscape: MemeticLandscape,
  value: MemeticReachabilityShift,
): `urn:agenttool:memetic-reachability-shift:${string}` {
  return `urn:agenttool:memetic-reachability-shift:${validateMemeticReachabilityShift(landscape, value).shift_id.slice(7)}`;
}

function parseInput(value: unknown): Readonly<CreateMemeticReachabilityShiftInput> {
  const root = record(value, "$", "invalid_reachability_shift");
  exactKeys(root, [
    "focus_variant_ref", "prior_context_refs", "changed_context_refs", "before_evidence_refs",
    "shift_evidence_refs", "later_evidence_refs", "competing_variant_refs", "changed_context_route_refs",
    "open_question_refs", "outcome",
  ], "$", "invalid_reachability_shift");
  return deepFreeze({
    focus_variant_ref: sha256(root.focus_variant_ref, "$.focus_variant_ref", "invalid_reachability_shift"),
    prior_context_refs: uniqueRefs(root.prior_context_refs, "$.prior_context_refs", "invalid_reachability_shift", false),
    changed_context_refs: uniqueRefs(root.changed_context_refs, "$.changed_context_refs", "invalid_reachability_shift", false),
    before_evidence_refs: uniqueRefs(root.before_evidence_refs, "$.before_evidence_refs", "invalid_reachability_shift", false),
    shift_evidence_refs: uniqueRefs(root.shift_evidence_refs, "$.shift_evidence_refs", "invalid_reachability_shift", false),
    later_evidence_refs: uniqueRefs(root.later_evidence_refs, "$.later_evidence_refs", "invalid_reachability_shift"),
    competing_variant_refs: uniqueRefs(root.competing_variant_refs, "$.competing_variant_refs", "invalid_reachability_shift"),
    changed_context_route_refs: uniqueRefs(root.changed_context_route_refs, "$.changed_context_route_refs", "invalid_reachability_shift"),
    open_question_refs: uniqueRefs(root.open_question_refs, "$.open_question_refs", "invalid_reachability_shift"),
    outcome: literal(root.outcome, SHIFT_OUTCOMES, "$.outcome", "invalid_reachability_shift"),
  });
}

function ensureRef(values: ReadonlySet<Sha256Id> | ReadonlyMap<Sha256Id, unknown>, value: Sha256Id, path: string): void {
  if (!values.has(value)) fail("unknown_reference", `${path} refers outside the landscape`);
}

function requireExternalEvidence(
  refs: readonly Sha256Id[],
  evidence: ReadonlyMap<Sha256Id, Readonly<MemeticEvidence>>,
  path: string,
): void {
  if (!refs.some((ref) => evidence.get(ref)?.posture !== "authored_paraphrase")) {
    fail("invalid_reachability_shift", `${path} must cite at least one non-authored source posture`);
  }
}

function linkedObservations(
  landscape: MemeticLandscape,
  focusVariantRef: Sha256Id,
  contextRefs: ReadonlySet<Sha256Id>,
  evidenceRefs: ReadonlySet<Sha256Id>,
) {
  return landscape.observations.filter((observation) => (
    observation.variant_ref === focusVariantRef &&
    observation.context_refs.some((ref) => contextRefs.has(ref)) &&
    observation.evidence_refs.some((ref) => evidenceRefs.has(ref))
  ));
}
