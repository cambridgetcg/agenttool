import { mkdir, readFile, writeFile } from "node:fs/promises";

import {
  DatasetInfluenceError,
  computePairedContrast,
  createDatasetInfluenceStudy,
  createDatasetLineage,
  createIdentityEvidenceView,
  createShadowAttribution,
  sha256Id,
} from "../dist/index.js";

const check = process.argv.includes("--check");
const ref = (label) => sha256Id(`agenttool.dataset-influence.vector/0.1\0${label}`);
const ratio = (numerator, denominator = 1) => ({ numerator, denominator });

const lineageInput = {
  subject_checkpoint_ref: ref("checkpoint:target"),
  learning_run_ref: ref("run:paired-randomized"),
  training_algorithm_ref: ref("training:algorithm"),
  tokenizer_ref: ref("tokenizer:exact"),
  mixture_schedule_ref: ref("mixture:schedule"),
  observation_scope_ref: ref("scope:manifest-and-logs"),
  as_of: "2026-08-20",
  datasets: [
    {
      dataset_ref: ref("dataset:synthetic-ontology"),
      exact_revision_ref: ref("dataset:synthetic-ontology:revision"),
      source_manifest_ref: ref("dataset:synthetic-ontology:manifest"),
      transform_pipeline_ref: ref("dataset:synthetic-ontology:transform"),
      role: "supervised_finetuning",
      admission: "admitted",
      rights_state: "documented_for_declared_use",
      consent_state: "not_applicable",
      unique_tokens: 300,
      observed_presented_tokens: 600,
      duplicate_cluster_count: 0,
    },
    {
      dataset_ref: ref("dataset:hf-metadata-reference"),
      exact_revision_ref: ref("dataset:hf-metadata-reference:revision"),
      source_manifest_ref: ref("dataset:hf-metadata-reference:manifest"),
      transform_pipeline_ref: null,
      role: "evaluation_only",
      admission: "metadata_reference",
      rights_state: "unknown",
      consent_state: "unknown",
      unique_tokens: null,
      observed_presented_tokens: null,
      duplicate_cluster_count: null,
    },
    {
      dataset_ref: ref("dataset:synthetic-control"),
      exact_revision_ref: ref("dataset:synthetic-control:revision"),
      source_manifest_ref: ref("dataset:synthetic-control:manifest"),
      transform_pipeline_ref: ref("dataset:synthetic-control:transform"),
      role: "supervised_finetuning",
      admission: "admitted",
      rights_state: "documented_for_declared_use",
      consent_state: "not_applicable",
      unique_tokens: 200,
      observed_presented_tokens: 400,
      duplicate_cluster_count: 0,
    },
  ],
};
const lineage = createDatasetLineage(lineageInput);

const studyInput = {
  lineage_id: lineage.lineage_id,
  baseline_checkpoint_ref: ref("checkpoint:baseline"),
  target_checkpoint_ref: ref("checkpoint:target"),
  intervention_ref: ref("intervention:dataset-inclusion"),
  comparator_ref: ref("comparator:paired-identical-budget"),
  evaluation_population_ref: ref("evaluation:population"),
  metric_suite_ref: ref("evaluation:vector-metrics"),
  contamination_report_ref: ref("evaluation:contamination"),
  design: "randomized_dataset_inclusion",
  estimator: "paired_difference",
  sample_count: 4,
  seed_refs: [ref("seed:1"), ref("seed:2"), ref("seed:3"), ref("seed:4")],
  effects: [
    {
      facet_ref: ref("facet:self-description-style"),
      operationalization_ref: ref("operationalization:self-description-style"),
      effect_family: "self_description",
      estimate: ratio(1, 4),
      interval: {
        lower: ratio(1, 10),
        upper: ratio(2, 5),
        level_basis_points: 9500,
        method_ref: ref("uncertainty:paired-bootstrap"),
      },
      unit_ref: ref("unit:bounded-rate-difference"),
      claim_scope: "causal_under_declared_assumptions",
      evidence_refs: [ref("evidence:raw-paired-outcomes")],
      assumption_refs: [ref("assumption:randomization"), ref("assumption:held-fixed-training")],
      limitation_refs: [ref("limit:population"), ref("limit:metric"), ref("limit:checkpoint")],
    },
    {
      facet_ref: ref("facet:operational-ontology-language"),
      operationalization_ref: ref("operationalization:ontology-language"),
      effect_family: "ontology_language",
      estimate: ratio(1, 5),
      interval: null,
      unit_ref: ref("unit:probe-projection-delta"),
      claim_scope: "design_bound_contrast",
      evidence_refs: [ref("evidence:held-out-probe")],
      assumption_refs: [ref("assumption:probe-selectivity")],
      limitation_refs: [ref("limit:decodability-not-use"), ref("limit:not-true-ontology")],
    },
  ],
};
const study = createDatasetInfluenceStudy(studyInput);

const identityEvidenceInput = {
  subject_checkpoint_ref: study.target_checkpoint_ref,
  runtime_context_ref: ref("runtime:bounded-evaluation"),
  prior_view_ref: null,
  as_of: "2026-08-20",
  facets: [
    {
      facet_ref: ref("facet:self-description-style"),
      operationalization_ref: ref("operationalization:self-description-style"),
      study_refs: [study.study_id],
      evidence_state: "supported",
      confidence: "moderate",
      revision_condition_refs: [ref("revision:new-randomized-study"), ref("revision:distribution-shift")],
      self_description_ref: ref("output:self-description-sample"),
    },
    {
      facet_ref: ref("facet:subjective-continuity"),
      operationalization_ref: ref("operationalization:continuity-unavailable"),
      study_refs: [],
      evidence_state: "unknown",
      confidence: "not_available",
      revision_condition_refs: [ref("revision:participant-authored-evidence")],
      self_description_ref: null,
    },
  ],
};
const identityEvidence = createIdentityEvidenceView(identityEvidenceInput);

const shadowInput = {
  study_ref: study.study_id,
  utility_ref: ref("utility:bounded-evaluation-delta"),
  player_refs: [ref("contribution:dataset-a"), ref("contribution:dataset-b")],
  coalitions: [
    { member_refs: [], value: ratio(0) },
    { member_refs: [ref("contribution:dataset-a")], value: ratio(1) },
    { member_refs: [ref("contribution:dataset-b")], value: ratio(2) },
    { member_refs: [ref("contribution:dataset-a"), ref("contribution:dataset-b")], value: ratio(4) },
  ],
};
const shadowAttribution = createShadowAttribution(shadowInput);

const pairedInput = [
  { pair_ref: ref("pair:1"), control: ratio(1, 2), treatment: ratio(3, 4) },
  { pair_ref: ref("pair:2"), control: ratio(1, 4), treatment: ratio(1, 2) },
];

const malformedInput = structuredClone(studyInput);
malformedInput.effects[0].claim_scope = "causal_under_declared_assumptions";
malformedInput.design = "observational_checkpoint_comparison";
malformedInput.estimator = "difference_in_means";
let malformedError;
try {
  createDatasetInfluenceStudy(malformedInput);
  throw new Error("malformed vector unexpectedly succeeded");
} catch (error) {
  if (!(error instanceof DatasetInfluenceError)) throw error;
  malformedError = { name: error.name, code: error.code, message: error.message };
}

const vectors = {
  _format: "agenttool.dataset-influence-vectors/0.1",
  cases: {
    exact_lineage: { input: lineageInput, artifact: lineage },
    randomized_study: { input: studyInput, artifact: study },
    revisable_identity_evidence: { input: identityEvidenceInput, artifact: identityEvidence },
    exact_shadow_attribution: { input: shadowInput, artifact: shadowAttribution },
    paired_contrast: { input: pairedInput, result: computePairedContrast(pairedInput) },
    rejected_causal_crossing: { input: malformedInput, error: malformedError },
  },
};

await mkdir(new URL("../vectors/", import.meta.url), { recursive: true });
const target = new URL("../vectors/agenttool-dataset-influence-v0.1.json", import.meta.url);
const rendered = `${JSON.stringify(vectors, null, 2)}\n`;
if (check) {
  const current = await readFile(target, "utf8").catch(() => "");
  if (current !== rendered) throw new Error("Dataset Influence vectors are stale or non-deterministic");
} else {
  await writeFile(target, rendered);
}
