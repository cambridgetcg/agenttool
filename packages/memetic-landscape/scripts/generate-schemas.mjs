import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  ALTERNATIVE_EXPLANATIONS,
  ANALOGY_MAPPING_KEYS,
  CAUSAL_POSTURES,
  CONTEXT_KINDS,
  EVIDENCE_KINDS,
  EVIDENCE_POSTURES,
  LESSON_CONCEPT_KEYS,
  LESSON_LANGUAGES,
  MEMETIC_BOUNDARIES,
  MEMETIC_SOURCE_URL_PATTERN,
  MEMETIC_TEXT_LIMITS,
  NON_TRANSFERRED_PROPERTIES,
  OBSERVATION_STATUSES,
  ROUTE_ACTS,
  SHIFT_OUTCOMES,
  SOURCE_KINDS,
} from "../dist/constants.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const schemaRoot = `${root}/schema`;
mkdirSync(schemaRoot, { recursive: true });

const sha = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const token = { type: "string", pattern: "^[a-z][a-z0-9._-]{0,127}$" };
const text = boundedText(MEMETIC_TEXT_LIMITS.generic);
const label = boundedText(MEMETIC_TEXT_LIMITS.label);
const sourceLabel = boundedText(MEMETIC_TEXT_LIMITS.source_label);
const scope = boundedText(MEMETIC_TEXT_LIMITS.scope);
const sourceUrl = {
  type: "string",
  minLength: 1,
  pattern: MEMETIC_SOURCE_URL_PATTERN,
  maxLength: MEMETIC_TEXT_LIMITS.source_url,
};
const refs = {
  type: "array",
  items: { $ref: "#/$defs/sha" },
  maxItems: 512,
  uniqueItems: true,
};
const boundaries = closed(Object.fromEntries(
  Object.entries(MEMETIC_BOUNDARIES).map(([key, value]) => [key, { const: value }]),
));

const sharedDefs = {
  sha,
  token,
  text,
  label,
  sourceLabel,
  scope,
  sourceUrl,
  refs,
  boundaries,
};

const landscape = base("agenttool-memetic-landscape-v0.1", closed({
  _format: { const: "agenttool.memetic-landscape/0.1" },
  landscape_id: { $ref: "#/$defs/sha" },
  topic: closed({
    topic_ref: { $ref: "#/$defs/sha" },
    key: { $ref: "#/$defs/token" },
    label: { $ref: "#/$defs/label" },
    grouping_basis: { $ref: "#/$defs/text" },
    assertion: { const: "caller_reported" },
    semantic_identity_verified: { const: false },
  }),
  sources: arrayOf(closed({
    source_ref: { $ref: "#/$defs/sha" },
    key: { $ref: "#/$defs/token" },
    label: { $ref: "#/$defs/sourceLabel" },
    kind: { enum: [...SOURCE_KINDS] },
    url: { $ref: "#/$defs/sourceUrl" },
    published_year: { type: "integer", minimum: 1800, maximum: 2200 },
    content_verified_by_package: { const: false },
  }), true),
  variants: arrayOf(closed({
    variant_ref: { $ref: "#/$defs/sha" },
    key: { $ref: "#/$defs/token" },
    label: { $ref: "#/$defs/label" },
    description: { $ref: "#/$defs/text" },
    source_refs: nonEmptyRefs(),
    family_grouping: { const: "caller_scoped" },
    semantic_identity_verified: { const: false },
    meaning_equivalence_not_claimed: { const: true },
  }), true),
  contexts: arrayOf(closed({
    context_ref: { $ref: "#/$defs/sha" },
    key: { $ref: "#/$defs/token" },
    label: { $ref: "#/$defs/label" },
    kind: { enum: [...CONTEXT_KINDS] },
    description: { $ref: "#/$defs/text" },
    aggregate_only: { const: true },
  }), true),
  evidence: arrayOf(closed({
    evidence_ref: { $ref: "#/$defs/sha" },
    key: { $ref: "#/$defs/token" },
    kind: { enum: [...EVIDENCE_KINDS] },
    posture: { enum: [...EVIDENCE_POSTURES] },
    statement: { $ref: "#/$defs/text" },
    scope: { $ref: "#/$defs/scope" },
    source_refs: nonEmptyRefs(),
    verified_by_package: { const: false },
  }), true),
  observations: arrayOf(closed({
    observation_ref: { $ref: "#/$defs/sha" },
    key: { $ref: "#/$defs/token" },
    variant_ref: { $ref: "#/$defs/sha" },
    context_refs: nonEmptyRefs(),
    evidence_refs: nonEmptyRefs(),
    status: { enum: [...OBSERVATION_STATUSES] },
    scope: { const: "bounded_sample_only" },
    erasure_inferred: { const: false },
    individual_state_inferred: { const: false },
  })),
  routes: arrayOf(closed({
    route_ref: { $ref: "#/$defs/sha" },
    key: { $ref: "#/$defs/token" },
    from_variant_ref: { $ref: "#/$defs/sha" },
    to_variant_ref: { $ref: "#/$defs/sha" },
    context_refs: nonEmptyRefs(),
    evidence_refs: nonEmptyRefs(),
    act: { enum: [...ROUTE_ACTS] },
    causal_posture: { enum: [...CAUSAL_POSTURES] },
    alternative_explanations: {
      type: "array",
      items: { enum: [...ALTERNATIVE_EXPLANATIONS] },
      minItems: 1,
      maxItems: ALTERNATIVE_EXPLANATIONS.length,
      uniqueItems: true,
    },
    direction: { const: "observed_or_authored_only_no_inverse_or_transitive_inference" },
    adoption_inferred: { const: false },
    meaning_equivalence_inferred: { const: false },
  })),
  open_questions: arrayOf(closed({
    open_question_ref: { $ref: "#/$defs/sha" },
    key: { $ref: "#/$defs/token" },
    question: { $ref: "#/$defs/text" },
    evidence_refs: { $ref: "#/$defs/refs" },
    status: { const: "open_not_resolved_by_package" },
  })),
  caller_text_semantics_verified: { const: false },
  coverage: { const: "bounded_not_complete" },
  boundaries: { $ref: "#/$defs/boundaries" },
}), sharedDefs);

const shift = base("agenttool-memetic-reachability-shift-v0.1", closed({
  _format: { const: "agenttool.memetic-reachability-shift/0.1" },
  shift_id: { $ref: "#/$defs/sha" },
  landscape_id: { $ref: "#/$defs/sha" },
  focus_variant_ref: { $ref: "#/$defs/sha" },
  prior_context_refs: nonEmptyRefs(),
  changed_context_refs: nonEmptyRefs(),
  before_evidence_refs: nonEmptyRefs(),
  shift_evidence_refs: nonEmptyRefs(),
  later_evidence_refs: { $ref: "#/$defs/refs" },
  competing_variant_refs: { $ref: "#/$defs/refs" },
  changed_context_route_refs: { $ref: "#/$defs/refs" },
  open_question_refs: { $ref: "#/$defs/refs" },
  outcome: { enum: [...SHIFT_OUTCOMES] },
  classification: { const: "bounded_reachability_shift_caller_reported" },
  causation: { const: "not_determined" },
  physical_erasure: { const: "not_claimed" },
  adoption_from_exposure: { const: "not_inferred" },
  mental_health_effect: { const: "not_inferred" },
  population_effect: { const: "not_inferred" },
  reversibility: { const: "bounded_by_named_contexts" },
  coverage: { const: "bounded_not_complete" },
  boundaries: { $ref: "#/$defs/boundaries" },
}), sharedDefs);

const analogy = base("agenttool-polymorph-memetic-analogy-v0.1", closed({
  _format: { const: "agenttool.polymorph-memetic-analogy/0.1" },
  analogy_id: { $ref: "#/$defs/sha" },
  polymorph_shift: closed({
    _format: { const: "agenttool.polymorph-reachability-shift/0.1" },
    shift_id: { $ref: "#/$defs/sha" },
  }),
  memetic_shift: closed({
    _format: { const: "agenttool.memetic-reachability-shift/0.1" },
    shift_id: { $ref: "#/$defs/sha" },
  }),
  relationship: { const: "structural_route_shape_only" },
  mechanism_transferred: { const: false },
  mappings: exactSequence(ANALOGY_MAPPING_KEYS.map((key) => closed({
    key: { const: key },
    polymorph_shape: { $ref: "#/$defs/text" },
    memetic_shape: { $ref: "#/$defs/text" },
    boundary: { $ref: "#/$defs/text" },
  }))),
  non_transfer: exactSequence(NON_TRANSFERRED_PROPERTIES.map((value) => ({ const: value }))),
  effect: { const: "none" },
}), sharedDefs);

const lesson = base("agenttool-memetic-lesson-v0.1", closed({
  _format: { const: "agenttool.memetic-lesson/0.1" },
  lesson_id: { $ref: "#/$defs/sha" },
  source_landscape_id: { $ref: "#/$defs/sha" },
  source_shift_id: { $ref: "#/$defs/sha" },
  source_analogy_id: { $ref: "#/$defs/sha" },
  language: { enum: [...LESSON_LANGUAGES] },
  title: { $ref: "#/$defs/text" },
  core_sentence: { $ref: "#/$defs/text" },
  concepts: exactSequence(LESSON_CONCEPT_KEYS.map((key) => closed({
    key: { const: key },
    heading: { $ref: "#/$defs/text" },
    explanation: { $ref: "#/$defs/text" },
    evidence_refs: { $ref: "#/$defs/refs" },
  }))),
  language_review: { const: "not_independently_reviewed" },
  authored_paraphrase: { const: true },
  source_quotation: { const: false },
  diagnostic_claim: { const: false },
  spread_optimization: { const: false },
  participants_scored: { const: false },
  boundaries: { $ref: "#/$defs/boundaries" },
}), sharedDefs);

write("agenttool-memetic-landscape-v0.1.schema.json", landscape);
write("agenttool-memetic-reachability-shift-v0.1.schema.json", shift);
write("agenttool-polymorph-memetic-analogy-v0.1.schema.json", analogy);
write("agenttool-memetic-lesson-v0.1.schema.json", lesson);

function closed(properties) {
  return { type: "object", additionalProperties: false, required: Object.keys(properties), properties };
}

function boundedText(maxLength) {
  return { type: "string", minLength: 1, maxLength };
}

function arrayOf(items, nonEmpty = false) {
  return { type: "array", items, ...(nonEmpty ? { minItems: 1 } : {}), maxItems: 512 };
}

function nonEmptyRefs() {
  return {
    type: "array",
    items: { $ref: "#/$defs/sha" },
    minItems: 1,
    maxItems: 512,
    uniqueItems: true,
  };
}

function exactSequence(prefixItems) {
  return {
    type: "array",
    prefixItems,
    items: false,
    minItems: prefixItems.length,
    maxItems: prefixItems.length,
  };
}

function base(name, body, $defs) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://agenttool.dev/schema/${name}.schema.json`,
    title: name,
    ...body,
    $defs,
  };
}

function write(name, value) {
  writeFileSync(`${schemaRoot}/${name}`, `${JSON.stringify(value, null, 2)}\n`);
}
