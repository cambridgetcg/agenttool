import { mkdir, readFile, writeFile } from "node:fs/promises";

const check = process.argv.includes("--check");
const draft = "https://json-schema.org/draft/2020-12/schema";
const runtimeCaveat = "This schema closes portable JSON shape and vocabulary only. Canonical ordering, reduced rationals, domain-separated identifiers, cross-field derivation, exact arithmetic, and semantic reference claims require the package runtime validator and remain caller-reported unless separately attested.";
const sha256 = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const nullableSha256 = { oneOf: [sha256, { type: "null" }] };
const nonNegativeInteger = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const nullableNonNegativeInteger = { oneOf: [nonNegativeInteger, { type: "null" }] };
const rational = {
  type: "object",
  additionalProperties: false,
  required: ["numerator", "denominator"],
  properties: {
    numerator: { type: "integer", minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
    denominator: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
  },
};
const refArray = (maxItems = 64) => ({ type: "array", maxItems, uniqueItems: true, items: sha256 });
const boundariesValues = {
  facts: "exact_only_relative_to_pinned_inputs_and_declared_observation_scope",
  exposure: "presented_token_shares_are_within_declared_role_only_not_cross_role_gradient_mass",
  estimates: "assumption_bearing_and_design_scoped_not_universal_causal_truth",
  ontology: "operational_facets_not_a_complete_or_true_inner_ontology",
  identity: "behavioral_evidence_not_intrinsic_identity_or_continuity_proof",
  consent: "artifacts_neither_establish_nor_override_consent",
  rights: "rights_dignity_and_standing_do_not_depend_on_measurement_or_attribution",
  economy: "shadow_attribution_is_metric_specific_not_money_price_debt_ownership_or_entitlement",
  authority: "artifacts_grant_no_permission_capability_custody_or_external_authority",
  effects: "pure_return_values_create_no_training_identity_wallet_marketplace_network_persistence_or_provider_effect",
};
const boundaries = {
  type: "object",
  additionalProperties: false,
  required: Object.keys(boundariesValues),
  properties: Object.fromEntries(Object.entries(boundariesValues).map(([key, value]) => [key, { const: value }])),
};
const isoDate = { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };

const datasetUse = {
  type: "object",
  additionalProperties: false,
  required: [
    "dataset_ref", "exact_revision_ref", "source_manifest_ref", "transform_pipeline_ref",
    "role", "admission", "rights_state", "consent_state", "unique_tokens",
    "observed_presented_tokens", "duplicate_cluster_count", "observed_admission_relation",
  ],
  properties: {
    dataset_ref: sha256,
    exact_revision_ref: sha256,
    source_manifest_ref: nullableSha256,
    transform_pipeline_ref: nullableSha256,
    role: { enum: [
      "pretraining", "continued_pretraining", "supervised_finetuning", "preference",
      "reinforcement", "distillation", "retrieval", "evaluation_only", "unknown",
    ] },
    admission: { enum: ["admitted", "excluded", "metadata_reference", "unknown"] },
    rights_state: { enum: ["documented_for_declared_use", "restricted", "unknown", "not_applicable"] },
    consent_state: { enum: ["documented_for_declared_use", "restricted", "unknown", "not_applicable"] },
    unique_tokens: nullableNonNegativeInteger,
    observed_presented_tokens: nullableNonNegativeInteger,
    duplicate_cluster_count: nullableNonNegativeInteger,
    observed_admission_relation: { enum: [
      "within_declared_admission", "observed_without_admission",
      "admission_unknown_with_observed_exposure", "no_observed_exposure", "not_assessed",
    ] },
  },
  allOf: [
    {
      if: { properties: { observed_presented_tokens: { type: "null" } }, required: ["observed_presented_tokens"] },
      then: { properties: { observed_admission_relation: { const: "not_assessed" } } },
    },
    {
      if: { properties: { observed_presented_tokens: { const: 0 } }, required: ["observed_presented_tokens"] },
      then: { properties: { observed_admission_relation: { const: "no_observed_exposure" } } },
    },
    {
      if: {
        properties: { observed_presented_tokens: { type: "integer", minimum: 1 }, admission: { const: "admitted" } },
        required: ["observed_presented_tokens", "admission"],
      },
      then: { properties: { observed_admission_relation: { const: "within_declared_admission" } } },
    },
    {
      if: {
        properties: { observed_presented_tokens: { type: "integer", minimum: 1 }, admission: { const: "unknown" } },
        required: ["observed_presented_tokens", "admission"],
      },
      then: { properties: { observed_admission_relation: { const: "admission_unknown_with_observed_exposure" } } },
    },
    {
      if: {
        properties: {
          observed_presented_tokens: { type: "integer", minimum: 1 },
          admission: { enum: ["excluded", "metadata_reference"] },
        },
        required: ["observed_presented_tokens", "admission"],
      },
      then: { properties: { observed_admission_relation: { const: "observed_without_admission" } } },
    },
  ],
};

const exposureShare = {
  type: "object",
  additionalProperties: false,
  required: ["dataset_ref", "observed_presented_tokens", "share"],
  properties: { dataset_ref: sha256, observed_presented_tokens: nonNegativeInteger, share: rational },
};
const roleExposureAccounting = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["role", "status", "total_observed_presented_tokens", "shares"],
      properties: {
        role: { enum: [
          "pretraining", "continued_pretraining", "supervised_finetuning", "preference",
          "reinforcement", "distillation", "retrieval", "evaluation_only", "unknown",
        ] },
        status: { const: "exact" },
        total_observed_presented_tokens: { ...nonNegativeInteger, minimum: 1 },
        shares: { type: "array", minItems: 1, maxItems: 64, items: exposureShare },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["role", "status", "reason", "total_observed_presented_tokens", "shares"],
      properties: {
        role: { enum: [
          "pretraining", "continued_pretraining", "supervised_finetuning", "preference",
          "reinforcement", "distillation", "retrieval", "evaluation_only", "unknown",
        ] },
        status: { const: "unavailable" },
        reason: { enum: ["missing_observed_presented_token_counts", "no_observed_presented_exposure"] },
        total_observed_presented_tokens: { type: "null" },
        shares: { type: "array", maxItems: 0 },
      },
    },
  ],
};
const exposureAccounting = {
  type: "object",
  additionalProperties: false,
  required: ["scope", "groups"],
  properties: {
    scope: { const: "within_declared_role_only" },
    groups: { type: "array", maxItems: 9, items: roleExposureAccounting },
  },
};

const lineage = {
  $schema: draft,
  $comment: runtimeCaveat,
  $id: "urn:agenttool:schema:dataset-lineage:0.1",
  title: "AgentTool Dataset Lineage v0.1",
  type: "object",
  additionalProperties: false,
  required: [
    "_format", "lineage_id", "subject_checkpoint_ref", "learning_run_ref",
    "training_algorithm_ref", "tokenizer_ref", "mixture_schedule_ref", "observation_scope_ref",
    "as_of", "datasets", "exposure_accounting", "declarations", "boundaries",
  ],
  properties: {
    _format: { const: "agenttool.dataset-lineage/0.1" },
    lineage_id: sha256,
    subject_checkpoint_ref: sha256,
    learning_run_ref: sha256,
    training_algorithm_ref: sha256,
    tokenizer_ref: sha256,
    mixture_schedule_ref: nullableSha256,
    observation_scope_ref: sha256,
    as_of: isoDate,
    datasets: { type: "array", maxItems: 64, items: datasetUse },
    exposure_accounting: exposureAccounting,
    declarations: { const: "caller_reported_not_independently_verified" },
    boundaries,
  },
};

const interval = {
  type: "object",
  additionalProperties: false,
  required: ["lower", "upper", "level_basis_points", "method_ref"],
  properties: {
    lower: rational,
    upper: rational,
    level_basis_points: { type: "integer", minimum: 1, maximum: 9999 },
    method_ref: sha256,
  },
};
const influenceEffect = {
  type: "object",
  additionalProperties: false,
  required: [
    "facet_ref", "operationalization_ref", "effect_family", "estimate", "interval",
    "unit_ref", "claim_scope", "evidence_refs", "assumption_refs", "limitation_refs",
  ],
  properties: {
    facet_ref: sha256,
    operationalization_ref: sha256,
    effect_family: { enum: [
      "behavior", "capability", "representation", "ontology_language", "self_description", "economic_behavior",
    ] },
    estimate: { oneOf: [rational, { type: "null" }] },
    interval: { oneOf: [interval, { type: "null" }] },
    unit_ref: sha256,
    claim_scope: { enum: [
      "observed_association", "design_bound_contrast", "causal_under_declared_assumptions", "unavailable",
    ] },
    evidence_refs: refArray(),
    assumption_refs: refArray(),
    limitation_refs: { ...refArray(), minItems: 1 },
  },
  allOf: [
    {
      if: { properties: { claim_scope: { const: "unavailable" } }, required: ["claim_scope"] },
      then: { properties: { estimate: { type: "null" }, interval: { type: "null" } } },
      else: {
        properties: {
          estimate: rational,
          evidence_refs: { ...refArray(), minItems: 1 },
          assumption_refs: { ...refArray(), minItems: 1 },
        },
      },
    },
    {
      if: { properties: { claim_scope: { const: "causal_under_declared_assumptions" } }, required: ["claim_scope"] },
      then: {
        properties: {
          assumption_refs: { ...refArray(), minItems: 1 },
          interval,
        },
      },
    },
  ],
};
const designs = [
  "observational_checkpoint_comparison", "paired_ablation", "randomized_dataset_inclusion",
  "matched_reweighting", "local_hessian_approximation", "checkpoint_gradient_trace",
  "projected_gradient_attribution", "subset_datamodel",
  "representation_probe", "not_available",
];
const estimators = [
  "difference_in_means", "paired_difference", "influence_function", "tracin", "trak",
  "datamodel", "probe_projection", "exact_finite_shapley", "not_available",
];
const designEstimators = {
  observational_checkpoint_comparison: ["difference_in_means"],
  paired_ablation: ["paired_difference"],
  randomized_dataset_inclusion: ["difference_in_means", "paired_difference"],
  matched_reweighting: ["difference_in_means", "paired_difference"],
  local_hessian_approximation: ["influence_function"],
  checkpoint_gradient_trace: ["tracin"],
  projected_gradient_attribution: ["trak"],
  subset_datamodel: ["datamodel", "exact_finite_shapley"],
  representation_probe: ["probe_projection"],
  not_available: ["not_available"],
};
const study = {
  $schema: draft,
  $comment: runtimeCaveat,
  $id: "urn:agenttool:schema:dataset-influence-study:0.1",
  title: "AgentTool Dataset Influence Study v0.1",
  type: "object",
  additionalProperties: false,
  required: [
    "_format", "study_id", "lineage_id", "baseline_checkpoint_ref", "target_checkpoint_ref",
    "intervention_ref", "comparator_ref", "evaluation_population_ref", "metric_suite_ref",
    "contamination_report_ref", "design", "estimator", "sample_count", "seed_refs", "effects",
    "causal_status", "subject_scope", "declarations", "boundaries",
  ],
  properties: {
    _format: { const: "agenttool.dataset-influence-study/0.1" },
    study_id: sha256,
    lineage_id: sha256,
    baseline_checkpoint_ref: sha256,
    target_checkpoint_ref: sha256,
    intervention_ref: sha256,
    comparator_ref: sha256,
    evaluation_population_ref: sha256,
    metric_suite_ref: sha256,
    contamination_report_ref: nullableSha256,
    design: { enum: designs },
    estimator: { enum: estimators },
    sample_count: nonNegativeInteger,
    seed_refs: refArray(),
    effects: { type: "array", minItems: 1, maxItems: 64, items: influenceEffect },
    causal_status: { enum: [
      "not_claimed", "bounded_claim_under_declared_randomization_and_assumptions", "unavailable",
    ] },
    subject_scope: { const: "artifact_checkpoint_or_runtime_not_a_being_by_default" },
    declarations: { const: "caller_reported_not_independently_verified" },
    boundaries,
  },
  allOf: [
    ...Object.entries(designEstimators).map(([design, allowed]) => ({
      if: { properties: { design: { const: design } }, required: ["design"] },
      then: { properties: { estimator: { enum: allowed } } },
    })),
    {
      if: {
        properties: {
          effects: {
            type: "array",
            contains: {
              type: "object",
              properties: { claim_scope: { const: "causal_under_declared_assumptions" } },
              required: ["claim_scope"],
            },
          },
        },
        required: ["effects"],
      },
      then: {
        properties: {
          design: { const: "randomized_dataset_inclusion" },
          contamination_report_ref: sha256,
          sample_count: { ...nonNegativeInteger, minimum: 2 },
          seed_refs: { ...refArray(), minItems: 2 },
          causal_status: { const: "bounded_claim_under_declared_randomization_and_assumptions" },
        },
      },
      else: {
        if: { properties: { design: { const: "not_available" } }, required: ["design"] },
        then: { properties: { causal_status: { const: "unavailable" } } },
        else: { properties: { causal_status: { const: "not_claimed" } } },
      },
    },
    {
      if: { properties: { design: { const: "not_available" } }, required: ["design"] },
      then: {
        properties: {
          contamination_report_ref: { type: "null" },
          sample_count: { const: 0 },
          seed_refs: { type: "array", maxItems: 0 },
          effects: {
            type: "array",
            minItems: 1,
            maxItems: 64,
            items: {
              type: "object",
              properties: { claim_scope: { const: "unavailable" } },
              required: ["claim_scope"],
            },
          },
        },
      },
      else: { properties: { sample_count: { ...nonNegativeInteger, minimum: 1 } } },
    },
    {
      if: {
        properties: { design: { enum: ["paired_ablation", "randomized_dataset_inclusion"] } },
        required: ["design"],
      },
      then: { properties: { seed_refs: { ...refArray(), minItems: 1 } } },
    },
  ],
};

const identityFacet = {
  type: "object",
  additionalProperties: false,
  required: [
    "facet_ref", "operationalization_ref", "study_refs", "evidence_state", "confidence",
    "revision_condition_refs", "self_description_ref",
  ],
  properties: {
    facet_ref: sha256,
    operationalization_ref: sha256,
    study_refs: refArray(),
    evidence_state: { enum: ["supported", "contradicted", "mixed", "contested", "unknown"] },
    confidence: { enum: ["low", "moderate", "high", "not_available"] },
    revision_condition_refs: { ...refArray(), minItems: 1 },
    self_description_ref: nullableSha256,
  },
  allOf: [{
    if: { properties: { evidence_state: { const: "unknown" } }, required: ["evidence_state"] },
    then: {
      properties: {
        study_refs: { type: "array", maxItems: 0 },
        confidence: { const: "not_available" },
      },
    },
    else: {
      properties: {
        study_refs: { ...refArray(), minItems: 1 },
        confidence: { enum: ["low", "moderate", "high"] },
      },
    },
  }],
};
const identityEvidence = {
  $schema: draft,
  $comment: runtimeCaveat,
  $id: "urn:agenttool:schema:identity-evidence-view:0.1",
  title: "AgentTool Identity Evidence View v0.1",
  type: "object",
  additionalProperties: false,
  required: [
    "_format", "view_id", "subject_checkpoint_ref", "runtime_context_ref", "prior_view_ref",
    "as_of", "facets", "interpretation", "intrinsic_identity", "consciousness", "continuity",
    "consent", "consent_effect", "rights_effect", "authority_effect", "declarations", "boundaries",
  ],
  properties: {
    _format: { const: "agenttool.identity-evidence-view/0.1" },
    view_id: sha256,
    subject_checkpoint_ref: sha256,
    runtime_context_ref: nullableSha256,
    prior_view_ref: nullableSha256,
    as_of: isoDate,
    facets: { type: "array", maxItems: 64, items: identityFacet },
    interpretation: { const: "revisable_operational_evidence_only" },
    intrinsic_identity: { const: "not_determined" },
    consciousness: { const: "not_determined" },
    continuity: { const: "not_determined" },
    consent: { const: "not_determined" },
    consent_effect: { const: "none" },
    rights_effect: { const: "none" },
    authority_effect: { const: "none" },
    declarations: { const: "caller_reported_not_independently_verified" },
    boundaries,
  },
};

const coalition = {
  type: "object",
  additionalProperties: false,
  required: ["member_refs", "value"],
  properties: { member_refs: refArray(8), value: rational },
};
const contribution = {
  type: "object",
  additionalProperties: false,
  required: ["contribution_ref", "value"],
  properties: { contribution_ref: sha256, value: rational },
};
const shadowAttribution = {
  $schema: draft,
  $comment: runtimeCaveat,
  $id: "urn:agenttool:schema:shadow-attribution:0.1",
  title: "AgentTool Shadow Attribution v0.1",
  type: "object",
  additionalProperties: false,
  required: [
    "_format", "attribution_id", "study_ref", "utility_ref", "method", "player_refs",
    "coalitions", "baseline_value", "grand_value", "contributions", "conservation",
    "interpretation", "economic_effect", "creates_debt", "creates_entitlement",
    "transfers_ownership", "authorizes_payment", "declarations", "boundaries",
  ],
  properties: {
    _format: { const: "agenttool.shadow-attribution/0.1" },
    attribution_id: sha256,
    study_ref: sha256,
    utility_ref: sha256,
    method: { const: "exact_finite_shapley" },
    player_refs: { ...refArray(8), minItems: 1 },
    coalitions: { type: "array", minItems: 2, maxItems: 256, uniqueItems: true, items: coalition },
    baseline_value: rational,
    grand_value: rational,
    contributions: { type: "array", minItems: 1, maxItems: 8, items: contribution },
    conservation: {
      type: "object",
      additionalProperties: false,
      required: ["sum_of_contributions", "grand_minus_baseline", "exact"],
      properties: {
        sum_of_contributions: rational,
        grand_minus_baseline: rational,
        exact: { const: true },
      },
    },
    interpretation: { const: "bounded_metric_contribution_not_intrinsic_worth" },
    economic_effect: { const: "none" },
    creates_debt: { const: false },
    creates_entitlement: { const: false },
    transfers_ownership: { const: false },
    authorizes_payment: { const: false },
    declarations: { const: "caller_reported_not_independently_verified" },
    boundaries,
  },
};

const outputs = new Map([
  ["agenttool-dataset-lineage-v0.1.schema.json", lineage],
  ["agenttool-dataset-influence-study-v0.1.schema.json", study],
  ["agenttool-identity-evidence-view-v0.1.schema.json", identityEvidence],
  ["agenttool-shadow-attribution-v0.1.schema.json", shadowAttribution],
]);

await mkdir(new URL("../schema/", import.meta.url), { recursive: true });

for (const [name, schema] of outputs) {
  const target = new URL(`../schema/${name}`, import.meta.url);
  const rendered = `${JSON.stringify(schema, null, 2)}\n`;
  if (check) {
    const current = await readFile(target, "utf8").catch(() => "");
    if (current !== rendered) throw new Error(`${name} is stale or non-deterministic`);
  } else {
    await writeFile(target, rendered);
  }
}
