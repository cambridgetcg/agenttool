import {
  ALTERNATIVE_EXPLANATIONS,
  CAUSAL_POSTURES,
  CONTEXT_KINDS,
  EVIDENCE_KINDS,
  EVIDENCE_POSTURES,
  MEMETIC_BOUNDARIES,
  MEMETIC_FORMATS,
  MEMETIC_TEXT_LIMITS,
  OBSERVATION_STATUSES,
  ROUTE_ACTS,
  SOURCE_KINDS,
} from "./constants.js";
import { canonicalJson, deepFreeze, domainSeparatedId, type JsonValue } from "./canonical.js";
import { fail, type MemeticLandscapeErrorCode } from "./errors.js";
import type {
  ContextInput,
  CreateMemeticLandscapeInput,
  EvidenceInput,
  MemeticLandscape,
  ObservationInput,
  OpenQuestionInput,
  RouteInput,
  Sha256Id,
  SourceInput,
  VariantInput,
} from "./types.js";
import {
  array,
  exactKeys,
  httpsUrl,
  integer,
  literal,
  record,
  sha256,
  sorted,
  sortedRefs,
  sortedStrings,
  text,
  token,
  uniqueRefs,
  uniqueTokens,
} from "./validation.js";

export function createMemeticLandscape(value: CreateMemeticLandscapeInput): Readonly<MemeticLandscape> {
  const input = parseInput(value);
  const topicBody = {
    key: input.topic.key,
    label: input.topic.label,
    grouping_basis: input.topic.grouping_basis,
    assertion: "caller_reported" as const,
    semantic_identity_verified: false as const,
  };
  const topic = { ...topicBody, topic_ref: domainSeparatedId(`${MEMETIC_FORMATS.landscape}/topic`, topicBody) };

  const sources = sorted(input.sources).map((source) => {
    const body = {
      key: source.key,
      label: source.label,
      kind: source.kind,
      url: source.url,
      published_year: source.published_year,
      content_verified_by_package: false as const,
    };
    return { ...body, source_ref: domainSeparatedId(`${MEMETIC_FORMATS.landscape}/source`, body) };
  });
  const sourceRefs = keyMap(sources, "source_ref");

  const variants = sorted(input.variants).map((variant) => {
    const body = {
      key: variant.key,
      label: variant.label,
      description: variant.description,
      source_refs: sortedRefs(resolveKeys(variant.source_keys, sourceRefs, `variant ${variant.key} source_keys`)),
      family_grouping: "caller_scoped" as const,
      semantic_identity_verified: false as const,
      meaning_equivalence_not_claimed: true as const,
    };
    return { ...body, variant_ref: domainSeparatedId(`${MEMETIC_FORMATS.landscape}/variant`, body) };
  });
  const variantRefs = keyMap(variants, "variant_ref");

  const contexts = sorted(input.contexts).map((context) => {
    const body = {
      key: context.key,
      label: context.label,
      kind: context.kind,
      description: context.description,
      aggregate_only: true as const,
    };
    return { ...body, context_ref: domainSeparatedId(`${MEMETIC_FORMATS.landscape}/context`, body) };
  });
  const contextRefs = keyMap(contexts, "context_ref");

  const evidence = sorted(input.evidence).map((item) => {
    assertEvidencePosture(item.kind, item.posture, `evidence ${item.key}`);
    const body = {
      key: item.key,
      kind: item.kind,
      posture: item.posture,
      statement: item.statement,
      scope: item.scope,
      source_refs: sortedRefs(resolveKeys(item.source_keys, sourceRefs, `evidence ${item.key} source_keys`)),
      verified_by_package: false as const,
    };
    return { ...body, evidence_ref: domainSeparatedId(`${MEMETIC_FORMATS.landscape}/evidence`, body) };
  });
  const evidenceRefs = keyMap(evidence, "evidence_ref");
  const evidenceByRef = new Map(evidence.map((item) => [item.evidence_ref, item] as const));

  const observations = sorted(input.observations).map((observation) => {
    const body = {
      key: observation.key,
      variant_ref: resolveKey(observation.variant_key, variantRefs, `observation ${observation.key} variant_key`),
      context_refs: sortedRefs(resolveKeys(observation.context_keys, contextRefs, `observation ${observation.key} context_keys`)),
      evidence_refs: sortedRefs(resolveKeys(observation.evidence_keys, evidenceRefs, `observation ${observation.key} evidence_keys`)),
      status: observation.status,
      scope: "bounded_sample_only" as const,
      erasure_inferred: false as const,
      individual_state_inferred: false as const,
    };
    return { ...body, observation_ref: domainSeparatedId(`${MEMETIC_FORMATS.landscape}/observation`, body) };
  });

  const routes = sorted(input.routes).map((route) => {
    const resolvedEvidenceRefs = sortedRefs(resolveKeys(route.evidence_keys, evidenceRefs, `route ${route.key} evidence_keys`));
    assertRoutePosture(route.causal_posture, resolvedEvidenceRefs, evidenceByRef, `route ${route.key}`);
    const body = {
      key: route.key,
      from_variant_ref: resolveKey(route.from_variant_key, variantRefs, `route ${route.key} from_variant_key`),
      to_variant_ref: resolveKey(route.to_variant_key, variantRefs, `route ${route.key} to_variant_key`),
      context_refs: sortedRefs(resolveKeys(route.context_keys, contextRefs, `route ${route.key} context_keys`)),
      evidence_refs: resolvedEvidenceRefs,
      act: route.act,
      causal_posture: route.causal_posture,
      alternative_explanations: sortedStrings(route.alternative_explanations),
      direction: "observed_or_authored_only_no_inverse_or_transitive_inference" as const,
      adoption_inferred: false as const,
      meaning_equivalence_inferred: false as const,
    };
    return { ...body, route_ref: domainSeparatedId(`${MEMETIC_FORMATS.landscape}/route`, body) };
  });

  const openQuestions = sorted(input.open_questions).map((question) => {
    const body = {
      key: question.key,
      question: question.question,
      evidence_refs: sortedRefs(resolveKeys(question.evidence_keys, evidenceRefs, `open question ${question.key} evidence_keys`)),
      status: "open_not_resolved_by_package" as const,
    };
    return { ...body, open_question_ref: domainSeparatedId(`${MEMETIC_FORMATS.landscape}/open-question`, body) };
  });

  const body = {
    _format: MEMETIC_FORMATS.landscape,
    topic,
    sources,
    variants,
    contexts,
    evidence,
    observations,
    routes,
    open_questions: openQuestions,
    caller_text_semantics_verified: false as const,
    coverage: "bounded_not_complete" as const,
    boundaries: MEMETIC_BOUNDARIES,
  };
  return deepFreeze({ ...body, landscape_id: domainSeparatedId(MEMETIC_FORMATS.landscape, body) });
}

export function validateMemeticLandscape(value: unknown): Readonly<MemeticLandscape> {
  const root = record(value, "$", "invalid_landscape");
  exactKeys(root, [
    "_format", "landscape_id", "topic", "sources", "variants", "contexts", "evidence",
    "observations", "routes", "open_questions", "caller_text_semantics_verified", "coverage", "boundaries",
  ], "$", "invalid_landscape");
  literal(root._format, [MEMETIC_FORMATS.landscape], "$._format", "invalid_landscape");
  sha256(root.landscape_id, "$.landscape_id", "invalid_landscape");
  literal(root.coverage, ["bounded_not_complete"], "$.coverage", "invalid_landscape");
  fixed(root.caller_text_semantics_verified, false, "$.caller_text_semantics_verified", "invalid_landscape");
  assertMemeticBoundaries(root.boundaries, "$.boundaries", "invalid_landscape");

  const topic = record(root.topic, "$.topic", "invalid_landscape");
  exactKeys(topic, ["topic_ref", "key", "label", "grouping_basis", "assertion", "semantic_identity_verified"], "$.topic", "invalid_landscape");
  sha256(topic.topic_ref, "$.topic.topic_ref", "invalid_landscape");
  literal(topic.assertion, ["caller_reported"], "$.topic.assertion", "invalid_landscape");
  fixed(topic.semantic_identity_verified, false, "$.topic.semantic_identity_verified", "invalid_landscape");

  const sources = array(root.sources, "$.sources").map((entry, index) => {
    const path = `$.sources[${String(index)}]`;
    const item = record(entry, path, "invalid_landscape");
    exactKeys(item, ["source_ref", "key", "label", "kind", "url", "published_year", "content_verified_by_package"], path, "invalid_landscape");
    fixed(item.content_verified_by_package, false, `${path}.content_verified_by_package`, "invalid_landscape");
    return {
      source_ref: sha256(item.source_ref, `${path}.source_ref`, "invalid_landscape"),
      key: token(item.key, `${path}.key`),
      label: text(item.label, `${path}.label`, MEMETIC_TEXT_LIMITS.source_label),
      kind: literal(item.kind, SOURCE_KINDS, `${path}.kind`),
      url: httpsUrl(item.url, `${path}.url`),
      published_year: integer(item.published_year, `${path}.published_year`, 1800, 2200),
    };
  });
  requireNonEmpty(sources, "$.sources");
  const sourceKeys = refToKeyMap(sources, "source_ref", "$.sources");

  const variants = array(root.variants, "$.variants").map((entry, index) => {
    const path = `$.variants[${String(index)}]`;
    const item = record(entry, path, "invalid_landscape");
    exactKeys(item, ["variant_ref", "key", "label", "description", "source_refs", "family_grouping", "semantic_identity_verified", "meaning_equivalence_not_claimed"], path, "invalid_landscape");
    literal(item.family_grouping, ["caller_scoped"], `${path}.family_grouping`, "invalid_landscape");
    fixed(item.semantic_identity_verified, false, `${path}.semantic_identity_verified`, "invalid_landscape");
    fixed(item.meaning_equivalence_not_claimed, true, `${path}.meaning_equivalence_not_claimed`, "invalid_landscape");
    return {
      variant_ref: sha256(item.variant_ref, `${path}.variant_ref`, "invalid_landscape"),
      key: token(item.key, `${path}.key`),
      label: text(item.label, `${path}.label`, MEMETIC_TEXT_LIMITS.label),
      description: text(item.description, `${path}.description`),
      source_refs: uniqueRefs(item.source_refs, `${path}.source_refs`, "invalid_landscape", false),
    };
  });
  requireNonEmpty(variants, "$.variants");
  const variantKeys = refToKeyMap(variants, "variant_ref", "$.variants");

  const contexts = array(root.contexts, "$.contexts").map((entry, index) => {
    const path = `$.contexts[${String(index)}]`;
    const item = record(entry, path, "invalid_landscape");
    exactKeys(item, ["context_ref", "key", "label", "kind", "description", "aggregate_only"], path, "invalid_landscape");
    fixed(item.aggregate_only, true, `${path}.aggregate_only`, "invalid_landscape");
    return {
      context_ref: sha256(item.context_ref, `${path}.context_ref`, "invalid_landscape"),
      key: token(item.key, `${path}.key`),
      label: text(item.label, `${path}.label`, MEMETIC_TEXT_LIMITS.label),
      kind: literal(item.kind, CONTEXT_KINDS, `${path}.kind`),
      description: text(item.description, `${path}.description`),
    };
  });
  requireNonEmpty(contexts, "$.contexts");
  const contextKeys = refToKeyMap(contexts, "context_ref", "$.contexts");

  const evidence = array(root.evidence, "$.evidence").map((entry, index) => {
    const path = `$.evidence[${String(index)}]`;
    const item = record(entry, path, "invalid_landscape");
    exactKeys(item, ["evidence_ref", "key", "kind", "posture", "statement", "scope", "source_refs", "verified_by_package"], path, "invalid_landscape");
    fixed(item.verified_by_package, false, `${path}.verified_by_package`, "invalid_landscape");
    return {
      evidence_ref: sha256(item.evidence_ref, `${path}.evidence_ref`, "invalid_landscape"),
      key: token(item.key, `${path}.key`),
      kind: literal(item.kind, EVIDENCE_KINDS, `${path}.kind`),
      posture: literal(item.posture, EVIDENCE_POSTURES, `${path}.posture`),
      statement: text(item.statement, `${path}.statement`),
      scope: text(item.scope, `${path}.scope`, MEMETIC_TEXT_LIMITS.scope),
      source_refs: uniqueRefs(item.source_refs, `${path}.source_refs`, "invalid_landscape", false),
    };
  });
  requireNonEmpty(evidence, "$.evidence");
  const evidenceKeys = refToKeyMap(evidence, "evidence_ref", "$.evidence");

  const observations = array(root.observations, "$.observations").map((entry, index) => {
    const path = `$.observations[${String(index)}]`;
    const item = record(entry, path, "invalid_landscape");
    exactKeys(item, ["observation_ref", "key", "variant_ref", "context_refs", "evidence_refs", "status", "scope", "erasure_inferred", "individual_state_inferred"], path, "invalid_landscape");
    literal(item.scope, ["bounded_sample_only"], `${path}.scope`, "invalid_landscape");
    fixed(item.erasure_inferred, false, `${path}.erasure_inferred`, "invalid_landscape");
    fixed(item.individual_state_inferred, false, `${path}.individual_state_inferred`, "invalid_landscape");
    return {
      observation_ref: sha256(item.observation_ref, `${path}.observation_ref`, "invalid_landscape"),
      key: token(item.key, `${path}.key`),
      variant_ref: sha256(item.variant_ref, `${path}.variant_ref`, "invalid_landscape"),
      context_refs: uniqueRefs(item.context_refs, `${path}.context_refs`, "invalid_landscape", false),
      evidence_refs: uniqueRefs(item.evidence_refs, `${path}.evidence_refs`, "invalid_landscape", false),
      status: literal(item.status, OBSERVATION_STATUSES, `${path}.status`),
    };
  });

  const routes = array(root.routes, "$.routes").map((entry, index) => {
    const path = `$.routes[${String(index)}]`;
    const item = record(entry, path, "invalid_landscape");
    exactKeys(item, ["route_ref", "key", "from_variant_ref", "to_variant_ref", "context_refs", "evidence_refs", "act", "causal_posture", "alternative_explanations", "direction", "adoption_inferred", "meaning_equivalence_inferred"], path, "invalid_landscape");
    literal(item.direction, ["observed_or_authored_only_no_inverse_or_transitive_inference"], `${path}.direction`, "invalid_landscape");
    fixed(item.adoption_inferred, false, `${path}.adoption_inferred`, "invalid_landscape");
    fixed(item.meaning_equivalence_inferred, false, `${path}.meaning_equivalence_inferred`, "invalid_landscape");
    return {
      route_ref: sha256(item.route_ref, `${path}.route_ref`, "invalid_landscape"),
      key: token(item.key, `${path}.key`),
      from_variant_ref: sha256(item.from_variant_ref, `${path}.from_variant_ref`, "invalid_landscape"),
      to_variant_ref: sha256(item.to_variant_ref, `${path}.to_variant_ref`, "invalid_landscape"),
      context_refs: uniqueRefs(item.context_refs, `${path}.context_refs`, "invalid_landscape", false),
      evidence_refs: uniqueRefs(item.evidence_refs, `${path}.evidence_refs`, "invalid_landscape", false),
      act: literal(item.act, ROUTE_ACTS, `${path}.act`),
      causal_posture: literal(item.causal_posture, CAUSAL_POSTURES, `${path}.causal_posture`),
      alternative_explanations: parseAlternatives(item.alternative_explanations, `${path}.alternative_explanations`),
    };
  });

  const openQuestions = array(root.open_questions, "$.open_questions").map((entry, index) => {
    const path = `$.open_questions[${String(index)}]`;
    const item = record(entry, path, "invalid_landscape");
    exactKeys(item, ["open_question_ref", "key", "question", "evidence_refs", "status"], path, "invalid_landscape");
    literal(item.status, ["open_not_resolved_by_package"], `${path}.status`, "invalid_landscape");
    return {
      open_question_ref: sha256(item.open_question_ref, `${path}.open_question_ref`, "invalid_landscape"),
      key: token(item.key, `${path}.key`),
      question: text(item.question, `${path}.question`),
      evidence_refs: uniqueRefs(item.evidence_refs, `${path}.evidence_refs`, "invalid_landscape"),
    };
  });

  const rebuilt = createMemeticLandscape({
    topic: {
      key: token(topic.key, "$.topic.key"),
      label: text(topic.label, "$.topic.label", MEMETIC_TEXT_LIMITS.label),
      grouping_basis: text(topic.grouping_basis, "$.topic.grouping_basis"),
    },
    sources: sources.map(({ key, label, kind, url, published_year }) => ({ key, label, kind, url, published_year })),
    variants: variants.map((item) => ({
      key: item.key,
      label: item.label,
      description: item.description,
      source_keys: refsToKeys(item.source_refs, sourceKeys, `variant ${item.key} source_refs`),
    })),
    contexts: contexts.map(({ key, label, kind, description }) => ({ key, label, kind, description })),
    evidence: evidence.map((item) => ({
      key: item.key,
      kind: item.kind,
      posture: item.posture,
      statement: item.statement,
      scope: item.scope,
      source_keys: refsToKeys(item.source_refs, sourceKeys, `evidence ${item.key} source_refs`),
    })),
    observations: observations.map((item) => ({
      key: item.key,
      variant_key: refToKey(item.variant_ref, variantKeys, `observation ${item.key} variant_ref`),
      context_keys: refsToKeys(item.context_refs, contextKeys, `observation ${item.key} context_refs`),
      evidence_keys: refsToKeys(item.evidence_refs, evidenceKeys, `observation ${item.key} evidence_refs`),
      status: item.status,
    })),
    routes: routes.map((item) => ({
      key: item.key,
      from_variant_key: refToKey(item.from_variant_ref, variantKeys, `route ${item.key} from_variant_ref`),
      to_variant_key: refToKey(item.to_variant_ref, variantKeys, `route ${item.key} to_variant_ref`),
      context_keys: refsToKeys(item.context_refs, contextKeys, `route ${item.key} context_refs`),
      evidence_keys: refsToKeys(item.evidence_refs, evidenceKeys, `route ${item.key} evidence_refs`),
      act: item.act,
      causal_posture: item.causal_posture,
      alternative_explanations: item.alternative_explanations,
    })),
    open_questions: openQuestions.map((item) => ({
      key: item.key,
      question: item.question,
      evidence_keys: refsToKeys(item.evidence_refs, evidenceKeys, `open question ${item.key} evidence_refs`),
    })),
  });
  if (canonicalJson(rebuilt) !== canonicalJson(value)) {
    fail("invalid_landscape", "landscape is not canonical or has an invalid content ID");
  }
  return rebuilt;
}

export function encodeMemeticLandscape(value: MemeticLandscape): Uint8Array {
  return new TextEncoder().encode(canonicalJson(validateMemeticLandscape(value)));
}

export function memeticLandscapeUrn(value: MemeticLandscape): `urn:agenttool:memetic-landscape:${string}` {
  return `urn:agenttool:memetic-landscape:${validateMemeticLandscape(value).landscape_id.slice(7)}`;
}

export function assertMemeticBoundaries(value: JsonValue | undefined, path: string, code: MemeticLandscapeErrorCode): void {
  const boundary = record(value, path, code);
  const keys = Object.keys(MEMETIC_BOUNDARIES);
  exactKeys(boundary, keys, path, code);
  for (const key of keys) literal(boundary[key], [MEMETIC_BOUNDARIES[key as keyof typeof MEMETIC_BOUNDARIES]], `${path}.${key}`, code);
}

function parseInput(value: unknown): Readonly<CreateMemeticLandscapeInput> {
  const root = record(value, "$", "invalid_input");
  exactKeys(root, ["topic", "sources", "variants", "contexts", "evidence", "observations", "routes", "open_questions"], "$", "invalid_input");
  const topic = record(root.topic, "$.topic", "invalid_input");
  exactKeys(topic, ["key", "label", "grouping_basis"], "$.topic", "invalid_input");

  const sources = parseList(root.sources, "$.sources", false, (entry, path): SourceInput => {
    const item = record(entry, path, "invalid_input");
    exactKeys(item, ["key", "label", "kind", "url", "published_year"], path, "invalid_input");
    return {
      key: token(item.key, `${path}.key`),
      label: text(item.label, `${path}.label`, MEMETIC_TEXT_LIMITS.source_label),
      kind: literal(item.kind, SOURCE_KINDS, `${path}.kind`),
      url: httpsUrl(item.url, `${path}.url`),
      published_year: integer(item.published_year, `${path}.published_year`, 1800, 2200),
    };
  });
  const variants = parseList(root.variants, "$.variants", false, (entry, path): VariantInput => {
    const item = record(entry, path, "invalid_input");
    exactKeys(item, ["key", "label", "description", "source_keys"], path, "invalid_input");
    return {
      key: token(item.key, `${path}.key`),
      label: text(item.label, `${path}.label`, MEMETIC_TEXT_LIMITS.label),
      description: text(item.description, `${path}.description`),
      source_keys: uniqueTokens(item.source_keys, `${path}.source_keys`, false),
    };
  });
  const contexts = parseList(root.contexts, "$.contexts", false, (entry, path): ContextInput => {
    const item = record(entry, path, "invalid_input");
    exactKeys(item, ["key", "label", "kind", "description"], path, "invalid_input");
    return {
      key: token(item.key, `${path}.key`),
      label: text(item.label, `${path}.label`, MEMETIC_TEXT_LIMITS.label),
      kind: literal(item.kind, CONTEXT_KINDS, `${path}.kind`),
      description: text(item.description, `${path}.description`),
    };
  });
  const evidence = parseList(root.evidence, "$.evidence", false, (entry, path): EvidenceInput => {
    const item = record(entry, path, "invalid_input");
    exactKeys(item, ["key", "kind", "posture", "statement", "scope", "source_keys"], path, "invalid_input");
    return {
      key: token(item.key, `${path}.key`),
      kind: literal(item.kind, EVIDENCE_KINDS, `${path}.kind`),
      posture: literal(item.posture, EVIDENCE_POSTURES, `${path}.posture`),
      statement: text(item.statement, `${path}.statement`),
      scope: text(item.scope, `${path}.scope`, MEMETIC_TEXT_LIMITS.scope),
      source_keys: uniqueTokens(item.source_keys, `${path}.source_keys`, false),
    };
  });
  const observations = parseList(root.observations, "$.observations", true, (entry, path): ObservationInput => {
    const item = record(entry, path, "invalid_input");
    exactKeys(item, ["key", "variant_key", "context_keys", "evidence_keys", "status"], path, "invalid_input");
    return {
      key: token(item.key, `${path}.key`),
      variant_key: token(item.variant_key, `${path}.variant_key`),
      context_keys: uniqueTokens(item.context_keys, `${path}.context_keys`, false),
      evidence_keys: uniqueTokens(item.evidence_keys, `${path}.evidence_keys`, false),
      status: literal(item.status, OBSERVATION_STATUSES, `${path}.status`),
    };
  });
  const routes = parseList(root.routes, "$.routes", true, (entry, path): RouteInput => {
    const item = record(entry, path, "invalid_input");
    exactKeys(item, ["key", "from_variant_key", "to_variant_key", "context_keys", "evidence_keys", "act", "causal_posture", "alternative_explanations"], path, "invalid_input");
    return {
      key: token(item.key, `${path}.key`),
      from_variant_key: token(item.from_variant_key, `${path}.from_variant_key`),
      to_variant_key: token(item.to_variant_key, `${path}.to_variant_key`),
      context_keys: uniqueTokens(item.context_keys, `${path}.context_keys`, false),
      evidence_keys: uniqueTokens(item.evidence_keys, `${path}.evidence_keys`, false),
      act: literal(item.act, ROUTE_ACTS, `${path}.act`),
      causal_posture: literal(item.causal_posture, CAUSAL_POSTURES, `${path}.causal_posture`),
      alternative_explanations: parseAlternatives(item.alternative_explanations, `${path}.alternative_explanations`),
    };
  });
  const openQuestions = parseList(root.open_questions, "$.open_questions", true, (entry, path): OpenQuestionInput => {
    const item = record(entry, path, "invalid_input");
    exactKeys(item, ["key", "question", "evidence_keys"], path, "invalid_input");
    return {
      key: token(item.key, `${path}.key`),
      question: text(item.question, `${path}.question`),
      evidence_keys: uniqueTokens(item.evidence_keys, `${path}.evidence_keys`),
    };
  });
  assertUniqueAcross(sources, "$.sources");
  assertUniqueAcross(variants, "$.variants");
  assertUniqueAcross(contexts, "$.contexts");
  assertUniqueAcross(evidence, "$.evidence");
  assertUniqueAcross(observations, "$.observations");
  assertUniqueAcross(routes, "$.routes");
  assertUniqueAcross(openQuestions, "$.open_questions");
  return deepFreeze({
    topic: {
      key: token(topic.key, "$.topic.key"),
      label: text(topic.label, "$.topic.label", MEMETIC_TEXT_LIMITS.label),
      grouping_basis: text(topic.grouping_basis, "$.topic.grouping_basis"),
    },
    sources,
    variants,
    contexts,
    evidence,
    observations,
    routes,
    open_questions: openQuestions,
  });
}

function parseList<T>(value: JsonValue | undefined, path: string, allowEmpty: boolean, parse: (entry: JsonValue, path: string) => T): readonly T[] {
  const values = array(value, path);
  if (!allowEmpty && values.length === 0) fail("invalid_input", `${path} must not be empty`);
  return values.map((entry, index) => parse(entry, `${path}[${String(index)}]`));
}

function parseAlternatives(value: JsonValue | undefined, path: string) {
  const items = array(value, path).map((entry, index) => literal(entry, ALTERNATIVE_EXPLANATIONS, `${path}[${String(index)}]`));
  if (items.length === 0) fail("invalid_input", `${path} must retain at least one competing explanation`);
  if (new Set(items).size !== items.length) fail("duplicate_key", `${path} must not contain duplicates`);
  return items;
}

function keyMap<T extends { readonly key: string }, K extends keyof T>(items: readonly T[], refKey: K): ReadonlyMap<string, Sha256Id> {
  return new Map(items.map((item) => [item.key, item[refKey] as Sha256Id]));
}

function resolveKey(key: string, refs: ReadonlyMap<string, Sha256Id>, path: string): Sha256Id {
  const ref = refs.get(key);
  if (!ref) fail("unknown_reference", `${path} refers to unknown key ${key}`);
  return ref;
}

function resolveKeys(keys: readonly string[], refs: ReadonlyMap<string, Sha256Id>, path: string): readonly Sha256Id[] {
  return keys.map((key) => resolveKey(key, refs, path));
}

function refToKeyMap<T extends { readonly key: string }, K extends keyof T>(items: readonly T[], refKey: K, path: string): ReadonlyMap<Sha256Id, string> {
  const map = new Map<Sha256Id, string>();
  const keys = new Set<string>();
  for (const item of items) {
    const ref = item[refKey] as Sha256Id;
    if (map.has(ref) || keys.has(item.key)) fail("invalid_landscape", `${path} has duplicate keys or references`);
    map.set(ref, item.key);
    keys.add(item.key);
  }
  return map;
}

function refToKey(ref: Sha256Id, keys: ReadonlyMap<Sha256Id, string>, path: string): string {
  const key = keys.get(ref);
  if (!key) fail("unknown_reference", `${path} refers outside the landscape`);
  return key;
}

function refsToKeys(refs: readonly Sha256Id[], keys: ReadonlyMap<Sha256Id, string>, path: string): readonly string[] {
  return refs.map((ref) => refToKey(ref, keys, path));
}

function requireNonEmpty(values: readonly unknown[], path: string): void {
  if (values.length === 0) fail("invalid_landscape", `${path} must not be empty`);
}

function assertUniqueAcross(values: readonly { readonly key: string }[], path: string): void {
  if (new Set(values.map((value) => value.key)).size !== values.length) fail("duplicate_key", `${path} must not contain duplicate keys`);
}

function fixed(value: JsonValue | undefined, expected: boolean, path: string, code: MemeticLandscapeErrorCode): void {
  if (value !== expected) fail(code, `${path} must be ${String(expected)}`);
}

function assertEvidencePosture(
  kind: EvidenceInput["kind"],
  posture: EvidenceInput["posture"],
  path: string,
): void {
  const allowed = kind === "authored_synthesis" ? ["authored_paraphrase"]
    : kind === "definition_record" ? ["official_record"]
      : kind === "model_result" ? ["modeled_hypothesis"]
        : kind === "observational_measurement" ? ["observed_primary", "official_record"]
          : kind === "randomized_experiment" ? ["randomized_evidence"]
            : ["observed_primary", "official_record"];
  if (!allowed.includes(posture)) {
    fail("invalid_input", `${path} posture ${posture} is incompatible with kind ${kind}`);
  }
}

function assertRoutePosture(
  posture: RouteInput["causal_posture"],
  refs: readonly Sha256Id[],
  evidence: ReadonlyMap<Sha256Id, Readonly<{ readonly posture: EvidenceInput["posture"] }>>,
  path: string,
): void {
  const required = posture === "authored_teaching_relation" ? "authored_paraphrase"
    : posture === "descriptive_observation" ? ["observed_primary", "official_record"]
      : posture === "modeled_hypothesis" || posture === "source_reported_hypothesis" ? "modeled_hypothesis"
        : posture === "randomized_evidence" ? "randomized_evidence"
          : null;
  if (required === null) return;
  const allowed = Array.isArray(required) ? required : [required];
  if (!refs.some((ref) => {
    const candidate = evidence.get(ref)?.posture;
    return candidate !== undefined && allowed.includes(candidate);
  })) {
    fail("invalid_input", `${path} causal_posture ${posture} requires matching evidence posture`);
  }
}
