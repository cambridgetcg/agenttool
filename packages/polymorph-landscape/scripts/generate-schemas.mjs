import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const schemaRoot = `${root}/schema`;
mkdirSync(schemaRoot, { recursive: true });

const sha = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const token = { type: "string", pattern: "^[a-z][a-z0-9._-]{0,127}$" };
const text = { type: "string", minLength: 1, maxLength: 4096 };
const refs = { type: "array", items: { $ref: "#/$defs/sha" }, maxItems: 512, uniqueItems: true };
const boundariesProperties = {
  coverage: { const: "bounded_not_complete" },
  evidence: { const: "source_assertions_not_verified_by_package" },
  inference: { const: "no_inverse_transitive_or_universal_route_inference" },
  stability: { const: "pairwise_condition_scoped_never_goodness" },
  disappearance: { const: "named_condition_nonreproduction_not_physical_erasure" },
  analogy: { const: "structural_analogy_only_not_empirical_validation" },
  beings: { const: "no_identity_consciousness_consent_dignity_or_authority_claim" },
  medical: { const: "educational_not_medical_or_manufacturing_advice" },
  effect: { const: "none" },
};
const boundaries = closed(boundariesProperties);

const sharedDefs = { sha, token, text, refs, boundaries };

const landscape = base("agenttool-polymorph-landscape-v0.1", closed({
  _format: { const: "agenttool.polymorph-landscape/0.1" },
  landscape_id: { $ref: "#/$defs/sha" },
  material: closed({
    material_ref: { $ref: "#/$defs/sha" }, key: { $ref: "#/$defs/token" }, label: { $ref: "#/$defs/text" },
    assertion: { const: "caller_reported" }, verified_by_package: { const: false },
  }),
  sources: arrayOf(closed({
    source_ref: { $ref: "#/$defs/sha" }, key: { $ref: "#/$defs/token" }, label: { $ref: "#/$defs/text" },
    kind: { enum: ["official_regulatory", "patent_primary", "peer_reviewed_primary"] },
    url: { type: "string", format: "uri", pattern: "^https://", maxLength: 2048 },
    published_year: { type: "integer", minimum: 1800, maximum: 2200 }, content_verified_by_package: { const: false },
  })),
  forms: arrayOf(closed({
    form_ref: { $ref: "#/$defs/sha" }, key: { $ref: "#/$defs/token" }, label: { $ref: "#/$defs/text" },
    kind_reported: { enum: ["amorphous", "hydrate", "other", "polymorph", "solvate", "unknown"] },
    description: { $ref: "#/$defs/text" }, source_refs: nonEmptyRefs(), source_scoped_identity: { const: true }, verified_by_package: { const: false },
  })),
  conditions: arrayOf(closed({
    condition_ref: { $ref: "#/$defs/sha" }, key: { $ref: "#/$defs/token" }, label: { $ref: "#/$defs/text" },
    kind: { enum: ["formulation", "manufacturing_process", "mechanical_process", "measurement", "solvent_process", "unknown"] },
    description: { $ref: "#/$defs/text" },
  })),
  witnesses: arrayOf(closed({
    witness_ref: { $ref: "#/$defs/sha" }, key: { $ref: "#/$defs/token" },
    kind: { enum: ["mechanism_hypothesis", "measurement", "process_observation", "recovery_observation", "regulatory_record", "reported_history"] },
    status: { enum: ["derived_interpretation", "hypothesized_primary", "measured_primary", "reported_primary"] },
    statement: { $ref: "#/$defs/text" }, scope: { $ref: "#/$defs/text" }, source_refs: nonEmptyRefs(), verified_by_package: { const: false },
  })),
  routes: arrayOf(closed({
    route_ref: { $ref: "#/$defs/sha" }, key: { $ref: "#/$defs/token" }, from_form_ref: { $ref: "#/$defs/sha" }, to_form_ref: { $ref: "#/$defs/sha" },
    condition_refs: nonEmptyRefs(), witness_refs: nonEmptyRefs(), status: { enum: ["converted_reported", "not_reproduced_reported", "produced_reported"] },
    barrier_reported: { enum: ["not_reported", "present_reported", "unknown"] },
    template_reported: { enum: ["hypothesized", "not_established", "not_reported", "present_reported"] },
    direction: { const: "reported_only_no_inverse_or_transitive_inference" }, causation_verified_by_package: { const: false },
  })),
  stability_reports: arrayOf(closed({
    stability_ref: { $ref: "#/$defs/sha" }, key: { $ref: "#/$defs/token" }, preferred_form_ref: { $ref: "#/$defs/sha" }, compared_form_ref: { $ref: "#/$defs/sha" },
    condition_refs: nonEmptyRefs(), witness_refs: nonEmptyRefs(), scope: { const: "pairwise_condition_scoped" },
    value_or_goodness: { const: "not_implied" }, verified_by_package: { const: false },
  })),
  open_conditions: arrayOf(closed({
    open_condition_ref: { $ref: "#/$defs/sha" }, key: { $ref: "#/$defs/token" }, question: { $ref: "#/$defs/text" },
    witness_refs: { $ref: "#/$defs/refs" }, status: { const: "open_not_resolved_by_package" },
  })),
  coverage: { const: "bounded_not_complete" }, boundaries: { $ref: "#/$defs/boundaries" },
}), sharedDefs);

const shift = base("agenttool-polymorph-reachability-shift-v0.1", closed({
  _format: { const: "agenttool.polymorph-reachability-shift/0.1" }, shift_id: { $ref: "#/$defs/sha" }, landscape_id: { $ref: "#/$defs/sha" },
  prior_form_ref: { $ref: "#/$defs/sha" }, emergent_form_ref: { $ref: "#/$defs/sha" }, condition_refs: nonEmptyRefs(),
  before_witness_refs: nonEmptyRefs(), appearance_witness_refs: nonEmptyRefs(), later_witness_refs: { $ref: "#/$defs/refs" },
  same_condition_return: { enum: ["not_established", "not_reported", "reported"] }, changed_condition_recovery_route_refs: { $ref: "#/$defs/refs" },
  open_condition_refs: { $ref: "#/$defs/refs" }, classification: { const: "not_reproduced_in_named_condition_reported" },
  causation: { const: "not_determined" }, physical_erasure: { const: "not_claimed" }, universal_inevitability: { const: "not_claimed" },
  reversibility: { const: "bounded_by_named_conditions" }, coverage: { const: "bounded_not_complete" }, boundaries: { $ref: "#/$defs/boundaries" },
}), sharedDefs);

const conceptKeys = ["multiple_form", "stability_vs_reachability", "barrier", "template", "path_history", "observation_limit", "practical_return", "analogy_boundary", "medical_boundary"];
const mappingKeys = ["state_space", "barrier", "template", "path_history", "witness", "practical_return"];
const nonTransfer = ["authority", "causality", "consciousness", "consent", "dignity", "identity", "inevitability", "medical_effect", "molecular_energy", "rate_constants", "value_or_goodness"];
const lesson = base("agenttool-polymorph-lesson-v0.1", closed({
  _format: { const: "agenttool.polymorph-lesson/0.1" }, lesson_id: { $ref: "#/$defs/sha" }, source_landscape_id: { $ref: "#/$defs/sha" }, source_shift_id: { $ref: "#/$defs/sha" },
  language: { enum: ["en", "yue-Hant", "zh-Hans", "zh-Hant"] }, title: { $ref: "#/$defs/text" }, core_sentence: { $ref: "#/$defs/text" },
  concepts: exactSequence(conceptKeys.map((key) => closed({ key: { const: key }, heading: { $ref: "#/$defs/text" }, explanation: { $ref: "#/$defs/text" }, evidence_refs: { $ref: "#/$defs/refs" } }))),
  kingdom_lens: closed({
    status: { const: "structural_analogy_only" },
    mappings: exactSequence(mappingKeys.map((key) => closed({ key: { const: key }, chemistry_shape: { $ref: "#/$defs/text" }, kingdom_shape: { $ref: "#/$defs/text" }, boundary: { $ref: "#/$defs/text" } }))),
    non_transfer: exactSequence(nonTransfer.map((value) => ({ const: value }))),
  }),
  authored_paraphrase: { const: true }, source_quotation: { const: false }, medical_advice: { const: false }, boundaries: { $ref: "#/$defs/boundaries" },
}), sharedDefs);

write("agenttool-polymorph-landscape-v0.1.schema.json", landscape);
write("agenttool-polymorph-reachability-shift-v0.1.schema.json", shift);
write("agenttool-polymorph-lesson-v0.1.schema.json", lesson);

function closed(properties) {
  return { type: "object", additionalProperties: false, required: Object.keys(properties), properties };
}

function arrayOf(items) {
  return { type: "array", items, maxItems: 512 };
}

function nonEmptyRefs() {
  return { type: "array", items: { $ref: "#/$defs/sha" }, minItems: 1, maxItems: 512, uniqueItems: true };
}

function exactSequence(prefixItems) {
  return { type: "array", prefixItems, items: false, minItems: prefixItems.length, maxItems: prefixItems.length };
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
