import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";

import {
  bindHfResearchLead,
  canonicalJson,
  createPublicHubReader,
  getCuratedHfResearchCatalog,
  inspectHfRepository,
} from "../../hf-scout/dist/index.js";
import {
  createDatasetAdmission,
  validateDatasetAdmission,
  validateResearchBinding,
} from "../dist/index.js";

const POLICY_FORMAT = "kingdom.hf-dataset-policy-dossier/0.1";
const BINDING_DOMAIN = "kingdom.xenia-word-is-hf-binding/0.1";
const GARDEN_SCOPE_DOMAIN = "kingdom.hf-garden-scope/0.1";
const DATASET_ID = "Yu-and-Ai/xenia-word-is";
const LEAD_KEY = "xenia_word_is";
const HUB_REVISION = "64e3c4be051b2780409ab25578ea0c8bf926a72a";
const RIGHTS_BASELINE_SHA256 =
  "sha256:b72a6da110c582e5683bf0fabde5017db93d2199398014c8421a82f5318da313";
const SELECTED_RIGHTS_PROFILE_SHA256 =
  "sha256:a78fa7fd66177c43349da819cb24ff81538dee9cb188e5f8b92c834ac6171b31";

const EXPECTED_BINDING = Object.freeze({
  definition_ref: "sha256:7b4177cf5af0207e8b40b924cf721b04a2ea7b8d0912b06b97cf62180e2ded52",
  snapshot_ref: "sha256:1f5cac55dd4063509cebbf62b0a998e1be39b5da4f4186d9781fafec424c47c4",
  binding_ref: "sha256:a254ea38c234e31b260a81a9ca3089253cd507b97724bcf90e4ff079b0e876b9",
});

const EXPECTED_EVIDENCE = Object.freeze({
  hub_hash_manifest_sha256:
    "sha256:d7def6979452b98b369409b043d6efbc1af79d77ea60b441b1a4b093b1bb787d",
  source_manifest_sha256:
    "sha256:6d9e0ae6cac28ca95f3e593d1294cde60e3b295db7cf7068cce1968402f577cb",
  row_manifest_sha256:
    "sha256:41edda0e4a2987a2ee74bf7a5e9849f2cb04814b208b3a61ac1e31f16f4c9cc8",
  training_authorization_manifest_sha256:
    "sha256:7cc3f5426716c11cef1116cf3f4709073bc51db801ef30075cba3a238909699e",
  training_example_manifest_sha256:
    "sha256:de74194687c642da5ec61f418bf4d7cc98dbb5d4b54b9475bda57b3ad18eb1db",
  training_recipe_manifest_sha256:
    "sha256:093f5199dbb53747fdb14137688ce23a29ac865e95aa30ef5644991edfe6b1f4",
});

const EXPECTED_SCOPE = Object.freeze({
  authorization_id:
    "sha256:a4443cae3d5a9d6adc700095e930c6e9d9e4d726102a3013e6d5ee1f1f1d6611",
  candidate_slice_ref:
    "sha256:e2379f52d47de4be02512f25837dd9e4880b8eacb3abe50b3e04d3b5345af30f",
  transform_recipe_ref:
    "sha256:01fc439305417e85f69cf8ed06c02dbab99fadfadb663ed5a59dfabb3b7723a2",
  output_jsonl_ref:
    "sha256:1ee2796d17070942e9a07dd530af3c5745cb0de27c040977b4e40bf01c876cfa",
  output_row_set_ref:
    "sha256:f9a1e7d645e2982b5f64e0d92df969dcf376c79087d2a20a825563d19f7d63fe",
  training_format: "agenttool.xenia-loop-sft/0.1",
  output_config: "loop_sft",
  output_split: "train",
  output_row_count: 24,
  source_pair_count: 12,
  role: "training_candidate",
  training_mode: "supervised_fine_tuning",
  excluded_lanes: [
    "dpo",
    "preference_optimization",
    "reward_modeling",
    "sealed_evaluation",
  ],
});

const ASSESSMENT = Object.freeze({
  rights: "caller_reported_reviewed_for_declared_use",
  privacy: "caller_reported_reviewed_for_declared_use",
  consent: "not_applicable_reported",
  withdrawal: "caller_reported_process_defined",
  secret_scan: "caller_reported_bounded_scan_passed",
  deduplication: "caller_reported_recipe_applied",
  benchmark_overlap: "caller_reported_clear_of_sealed_evaluation",
  fitness: "caller_reported_fit_for_declared_role",
  synthetic_provenance: "caller_reported_source_recipe_recorded",
});

const WITHDRAWAL = Object.freeze({
  process_state: "caller_reported_process_defined",
  future_distribution: "deprecate_and_stop_future_authorized_use",
  prior_copies: "not_recalled_or_erased_by_admission",
  learned_influence: "may_persist_after_future_use_stops",
  new_training_use: "requires_fresh_current_authorization_and_governance",
  repair: "append_correction_and_contain_future_use",
});

const BOUNDARIES = Object.freeze({
  manifest_and_provenance_only: true,
  raw_dataset_rows_consumed: false,
  raw_training_examples_consumed: false,
  raw_prompts_or_completions_retained: false,
  raw_agent_traces_retained: false,
  personal_data_retained: false,
  participant_identifiers_retained: false,
  credentials_retained: false,
  free_form_prose_retained: false,
  local_paths_retained: false,
  urls_retained: false,
  timestamps_retained: false,
  grants_live_training_permission: false,
  permits_optimizer_step: false,
  loads_model: false,
  trains_model: false,
  proves_model_exposure: false,
  proves_identity: false,
  proves_consciousness: false,
  proves_consent: false,
  grants_authority: false,
  publishes: false,
  writes_hub: false,
});

const REMOTE_MANIFESTS = Object.freeze([
  ["hash-manifest.json", EXPECTED_EVIDENCE.hub_hash_manifest_sha256],
  ["provenance/source-manifest.json", EXPECTED_EVIDENCE.source_manifest_sha256],
  ["provenance/row-manifest.json", EXPECTED_EVIDENCE.row_manifest_sha256],
  [
    "provenance/training-authorization.json",
    EXPECTED_EVIDENCE.training_authorization_manifest_sha256,
  ],
  [
    "provenance/training-example-manifest.json",
    EXPECTED_EVIDENCE.training_example_manifest_sha256,
  ],
  ["provenance/training-recipe.json", EXPECTED_EVIDENCE.training_recipe_manifest_sha256],
]);

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const dossierRoot = `${packageRoot}/admissions/xenia-word-is`;
const DOSSIER_FILES = Object.freeze([
  "README.md",
  "dataset-admission.json",
  "hf-research-binding.json",
  "policy-dossier.json",
]);
const [mode, ...extraArguments] = process.argv.slice(2);
if ((mode !== "--write" && mode !== "--check") || extraArguments.length !== 0) {
  throw new Error("usage: build-xenia-word-is-admission.mjs --write|--check");
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function domainSeparatedId(domain, value) {
  return sha256(`${domain}\0${canonicalJson(value)}`);
}

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function equal(actual, expected, message) {
  invariant(canonicalJson(actual) === canonicalJson(expected), message);
}

function plainRecord(value, label) {
  invariant(
    value !== null
      && typeof value === "object"
      && !Array.isArray(value)
      && Object.getPrototypeOf(value) === Object.prototype,
    `${label} must be a plain object`,
  );
  return value;
}

async function boundedBytes(response, label) {
  invariant(response.body !== null, `${label} response had no body`);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    invariant(total <= 64 * 1024, `${label} exceeded the 64 KiB manifest limit`);
    chunks.push(value);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function fetchManifest(path, expectedRef) {
  invariant(
    path === "hash-manifest.json" || path.startsWith("provenance/"),
    `refusing non-manifest Hub read: ${path}`,
  );
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const url = new URL(
    `/datasets/${DATASET_ID}/raw/${HUB_REVISION}/${encodedPath}`,
    "https://huggingface.co",
  );
  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json, text/plain" },
    redirect: "error",
    credentials: "omit",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  invariant(response.ok, `${path} public Hub read returned ${response.status}`);
  const bytes = await boundedBytes(response, path);
  invariant(sha256(bytes) === expectedRef, `${path} bytes do not match the pinned digest`);
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`${path} is not valid UTF-8 JSON`);
  }
  return plainRecord(parsed, path);
}

function verifyBinding(value) {
  const binding = validateResearchBinding(value);
  equal(binding.artifact, {
    kind: "dataset",
    id: DATASET_ID,
    revision: HUB_REVISION,
  }, "binding subject differs from the pinned Xenia dataset");
  invariant(binding.lead_key === LEAD_KEY, "binding lead key differs from xenia_word_is");
  invariant(
    `sha256:${binding.definition_sha256}` === EXPECTED_BINDING.definition_ref,
    "binding definition digest differs from the reviewed Scout lead",
  );
  invariant(
    `sha256:${binding.snapshot_sha256}` === EXPECTED_BINDING.snapshot_ref,
    "binding snapshot digest differs from the reviewed public Hub observation",
  );
  equal(binding.observation, {
    transport: "public_hub_api",
    repository_association: "provider_response",
    provenance_grade: "provider_observed_commit_metadata",
  }, "binding was not produced from the built-in public Hub observation boundary");
  equal(binding.matched_declared, {
    basis: "publisher_assertion",
    license: "apache-2.0",
    gated: false,
    private: false,
  }, "binding publisher declarations differ from the curated lead");
  invariant(
    domainSeparatedId(BINDING_DOMAIN, binding) === EXPECTED_BINDING.binding_ref,
    "whole binding reference differs from the reviewed binding",
  );
  return binding;
}

async function createLiveBinding() {
  const lead = getCuratedHfResearchCatalog().leads.find(
    (candidate) => candidate.key === LEAD_KEY,
  );
  invariant(lead, "curated xenia_word_is Scout lead is absent");
  const report = await inspectHfRepository(
    { kind: "dataset", id: DATASET_ID, revision: HUB_REVISION },
    { reader: createPublicHubReader() },
  );
  invariant(report.status === "observed", "public Hub report is not a complete observation");
  invariant(report.diagnostics.length === 0, "public Hub report contains diagnostics");
  return verifyBinding(bindHfResearchLead(report, lead));
}

function verifyLiveEvidence(documents) {
  const hashManifest = documents.get("hash-manifest.json");
  const source = documents.get("provenance/source-manifest.json");
  const rows = documents.get("provenance/row-manifest.json");
  const authorization = documents.get("provenance/training-authorization.json");
  const examples = documents.get("provenance/training-example-manifest.json");
  const recipe = documents.get("provenance/training-recipe.json");
  for (const [label, document] of Object.entries({
    hashManifest,
    source,
    rows,
    authorization,
    examples,
    recipe,
  })) {
    invariant(document, `${label} was not read`);
  }

  invariant(
    hashManifest._format === "agenttool.xenia-loop-atlas-hash-manifest/0.1"
      && hashManifest.manifest_excludes_itself === true
      && Array.isArray(hashManifest.files),
    "Hub hash manifest has an unexpected shape",
  );
  for (const [path, expectedRef] of REMOTE_MANIFESTS.slice(1)) {
    const entry = hashManifest.files.find((candidate) => candidate.path === path);
    invariant(
      entry?.sha256 === expectedRef.slice("sha256:".length),
      `${path} is not bound by the Hub hash manifest`,
    );
  }
  const outputEntries = hashManifest.files.filter(
    (entry) => entry.sha256 === EXPECTED_SCOPE.output_jsonl_ref.slice("sha256:".length),
  );
  invariant(outputEntries.length === 1, "authorized SFT output is not uniquely bound by the Hub hash manifest");

  equal({
    format: source._format,
    dataset_id: source.intended_hugging_face_identifier,
    origin: source.origin,
    rights_baseline: source.rights_baseline,
    license: source.license,
    copied_external_rows: source.copied_external_rows,
    copied_private_rows: source.copied_private_rows,
    contains_personal_data: source.contains_personal_data,
    contains_raw_session_trace: source.contains_raw_session_trace,
    source_case_rows_training_authorized: source.source_case_rows_training_authorized,
    training_derivative_authorized: source.training_derivative_authorized,
    authorization_id: source.training_derivative_authorization_id,
    config: source.training_derivative_config,
    split: source.training_derivative_split,
    rows: source.training_derivative_row_count,
    training_effect: source.training_effect,
  }, {
    format: "agenttool.xenia-loop-atlas-source-manifest/0.1",
    dataset_id: DATASET_ID,
    origin: "human_directed_agent_authored_synthetic",
    rights_baseline: "xenia.rights/0.1",
    license: "Apache-2.0",
    copied_external_rows: false,
    copied_private_rows: false,
    contains_personal_data: false,
    contains_raw_session_trace: false,
    source_case_rows_training_authorized: false,
    training_derivative_authorized: true,
    authorization_id: EXPECTED_SCOPE.authorization_id,
    config: EXPECTED_SCOPE.output_config,
    split: EXPECTED_SCOPE.output_split,
    rows: EXPECTED_SCOPE.output_row_count,
    training_effect: "none",
  }, "source manifest does not preserve the reviewed provenance boundary");
  const rightsEntry = source.source_files?.find(
    (entry) => entry.sha256 === SELECTED_RIGHTS_PROFILE_SHA256.slice("sha256:".length),
  );
  invariant(rightsEntry, "source manifest does not bind the selected repository rights profile");

  equal({
    format: rows._format,
    config: rows.training_projection?.config,
    split: rows.training_projection?.split,
    rows: rows.training_projection?.rows,
    source_pairs: rows.training_projection?.source_pairs,
    authorization_id: rows.training_projection?.authorization_id,
    transform_recipe_ref: rows.training_projection?.transform_recipe_ref,
  }, {
    format: "agenttool.xenia-loop-atlas-row-manifest/0.1",
    config: EXPECTED_SCOPE.output_config,
    split: EXPECTED_SCOPE.output_split,
    rows: EXPECTED_SCOPE.output_row_count,
    source_pairs: EXPECTED_SCOPE.source_pair_count,
    authorization_id: EXPECTED_SCOPE.authorization_id,
    transform_recipe_ref: EXPECTED_SCOPE.transform_recipe_ref,
  }, "row manifest training projection differs from the authorized slice");

  equal({
    format: authorization._format,
    dataset_id: authorization.dataset_id,
    authorization_state: authorization.authorization_state,
    authorization_id: authorization.authorization_id,
    candidate_slice_ref: authorization.candidate_slice_ref,
    transform_recipe_ref: authorization.transform_recipe_ref,
    output_jsonl_ref: authorization.output_jsonl_sha256,
    output_row_set_ref: authorization.output_row_set_ref,
    training_format: authorization.training_format,
    output_config: authorization.output_config,
    output_split: authorization.output_split,
    output_row_count: authorization.output_row_count,
    source_pair_count: authorization.source_pair_count,
    training_modes: authorization.training_modes,
    excluded_lanes: authorization.excluded_lanes,
    license: authorization.license,
    formal_garden_admission_state: authorization.formal_garden_admission_state,
    garden_admission_id: authorization.garden_admission_id,
    training_effect: authorization.training_effect,
  }, {
    format: "agenttool.xenia-loop-training-authorization/0.1",
    dataset_id: DATASET_ID,
    authorization_state: "authorized_training_derivative",
    authorization_id: EXPECTED_SCOPE.authorization_id,
    candidate_slice_ref: EXPECTED_SCOPE.candidate_slice_ref,
    transform_recipe_ref: EXPECTED_SCOPE.transform_recipe_ref,
    output_jsonl_ref: EXPECTED_SCOPE.output_jsonl_ref,
    output_row_set_ref: EXPECTED_SCOPE.output_row_set_ref,
    training_format: EXPECTED_SCOPE.training_format,
    output_config: EXPECTED_SCOPE.output_config,
    output_split: EXPECTED_SCOPE.output_split,
    output_row_count: EXPECTED_SCOPE.output_row_count,
    source_pair_count: EXPECTED_SCOPE.source_pair_count,
    training_modes: [EXPECTED_SCOPE.training_mode],
    excluded_lanes: EXPECTED_SCOPE.excluded_lanes,
    license: "Apache-2.0",
    formal_garden_admission_state: "pending_immutable_hub_revision",
    garden_admission_id: null,
    training_effect: "none",
  }, "training authorization differs from the exact reviewed SFT lane");
  equal(authorization.assessment, {
    rights: "caller_reported_reviewed_for_declared_use",
    privacy: "caller_reported_reviewed_for_declared_use",
    consent: "not_applicable_reported_synthetic_no_data_subjects",
    withdrawal: "future_distribution_can_be_deprecated_prior_copies_and_learned_influence_may_persist",
    secret_scan: "deterministic_bounded_generated_tree_scan_passed",
    deduplication: "exact_source_record_and_prompt_completion_hashes",
    benchmark_overlap: "public_regression_config_excluded_not_sealed",
    fitness: "caller_reported_fit_for_loop_reasoning_sft",
    synthetic_provenance: "generator_and_selected_sources_manifested",
  }, "training authorization assessment differs from the reviewed source report");
  equal(authorization.boundaries, {
    source_case_rows_rewritten: false,
    public_regression_in_training: false,
    chosen_or_rejected_labels_created: false,
    contains_personal_data: false,
    contains_raw_session_trace: false,
    establishes_consciousness: false,
    establishes_identity: false,
    grants_authority: false,
    proves_model_exposure: false,
    permits_live_optimizer_step: false,
  }, "training authorization widened its boundaries");

  equal({
    format: examples._format,
    training_format: examples.training_format,
    authorization_id: examples.training_authorization_id,
    transform_recipe_ref: examples.transform_recipe_ref,
    example_count: examples.example_count,
    source_pair_count: examples.source_pair_count,
  }, {
    format: "agenttool.xenia-loop-training-example-manifest/0.1",
    training_format: EXPECTED_SCOPE.training_format,
    authorization_id: EXPECTED_SCOPE.authorization_id,
    transform_recipe_ref: EXPECTED_SCOPE.transform_recipe_ref,
    example_count: EXPECTED_SCOPE.output_row_count,
    source_pair_count: EXPECTED_SCOPE.source_pair_count,
  }, "training example manifest differs from the authorized SFT projection");
  invariant(Array.isArray(examples.entries), "training example manifest entries are absent");
  invariant(examples.entries.length === EXPECTED_SCOPE.output_row_count, "training example count changed");
  const pairIds = new Set();
  const sourceIds = new Set();
  for (const entry of examples.entries) {
    const record = plainRecord(entry, "training example manifest entry");
    equal(Object.keys(record).sort(), [
      "example_id",
      "line",
      "pair_id",
      "path",
      "row_sha256",
      "source_content_sha256",
      "source_record_id",
      "variant",
    ], "training example manifest entry shape changed");
    invariant(/^P(?:0[1-9]|1[0-2])$/u.test(record.pair_id), "public regression entered the SFT manifest");
    invariant(record.variant === "a" || record.variant === "b", "training variant is not neutral a/b metadata");
    pairIds.add(record.pair_id);
    sourceIds.add(record.source_record_id);
  }
  invariant(pairIds.size === EXPECTED_SCOPE.source_pair_count, "training source-pair count changed");
  invariant(sourceIds.size === EXPECTED_SCOPE.output_row_count, "training source records are not unique");

  equal({
    format: recipe._format,
    recipe_id: recipe.recipe_id,
    source_config: recipe.source_config,
    source_split: recipe.source_split,
    output_format: recipe.output_format,
    output_config: recipe.output_config,
    output_split: recipe.output_split,
    projection: recipe.projection,
    train_eval_policy: recipe.train_eval_policy,
    preference_policy: recipe.preference_policy,
  }, {
    format: "agenttool.xenia-loop-training-recipe/0.1",
    recipe_id: EXPECTED_SCOPE.transform_recipe_ref,
    source_config: "loop_reference",
    source_split: "reference",
    output_format: EXPECTED_SCOPE.training_format,
    output_config: EXPECTED_SCOPE.output_config,
    output_split: EXPECTED_SCOPE.output_split,
    projection: "conversational_prompt_completion",
    train_eval_policy: "project_loop_reference_only_exclude_public_regression",
    preference_policy: "not_preference_data_no_chosen_or_rejected",
  }, "training recipe differs from the authorized projection");
}

function buildArtifacts(bindingValue) {
  const binding = verifyBinding(bindingValue);
  const scope = {
    authorization_id: EXPECTED_SCOPE.authorization_id,
    candidate_slice_ref: EXPECTED_SCOPE.candidate_slice_ref,
    transform_recipe_ref: EXPECTED_SCOPE.transform_recipe_ref,
    output_jsonl_ref: EXPECTED_SCOPE.output_jsonl_ref,
    output_row_set_ref: EXPECTED_SCOPE.output_row_set_ref,
    training_format: EXPECTED_SCOPE.training_format,
    output_config: EXPECTED_SCOPE.output_config,
    output_split: EXPECTED_SCOPE.output_split,
    output_row_count: EXPECTED_SCOPE.output_row_count,
    source_pair_count: EXPECTED_SCOPE.source_pair_count,
    role: EXPECTED_SCOPE.role,
    training_mode: EXPECTED_SCOPE.training_mode,
    excluded_lanes: [...EXPECTED_SCOPE.excluded_lanes],
  };
  const gardenScopeRef = domainSeparatedId(GARDEN_SCOPE_DOMAIN, scope);
  const body = {
    _format: POLICY_FORMAT,
    binding_ref: EXPECTED_BINDING.binding_ref,
    garden_scope_ref: gardenScopeRef,
    subject: {
      dataset_id: DATASET_ID,
      lead_key: LEAD_KEY,
      hub_revision: HUB_REVISION,
      binding_definition_ref: EXPECTED_BINDING.definition_ref,
      binding_snapshot_ref: EXPECTED_BINDING.snapshot_ref,
    },
    rights: {
      baseline: "xenia.rights/0.1",
      baseline_sha256: RIGHTS_BASELINE_SHA256,
      selected_repository_profile_sha256: SELECTED_RIGHTS_PROFILE_SHA256,
      rights_are_permissions: false,
    },
    evidence: { ...EXPECTED_EVIDENCE },
    scope,
    provenance: {
      origin: "human_directed_agent_authored_synthetic",
      license: "apache-2.0",
      copied_external_rows: false,
      copied_private_rows: false,
      contains_personal_data: false,
      contains_raw_session_trace: false,
      source_case_rows_training_authorized: false,
      training_derivative_authorized: true,
      public_regression_in_training: false,
    },
    assessment: { ...ASSESSMENT },
    withdrawal: { ...WITHDRAWAL },
    boundaries: { ...BOUNDARIES },
  };
  const policy = {
    ...body,
    policy_id: domainSeparatedId(POLICY_FORMAT, body),
  };
  const admission = createDatasetAdmission({
    garden_scope_ref: gardenScopeRef,
    policy_ref: policy.policy_id,
    entries: [{
      binding,
      role: "training_candidate",
      candidate_slice_ref: EXPECTED_SCOPE.candidate_slice_ref,
      transform_recipe_ref: EXPECTED_SCOPE.transform_recipe_ref,
      assessment: ASSESSMENT,
      posture: "consider",
    }],
  });
  validateDatasetAdmission(admission);
  equal(admission.entries[0]?.decision, {
    state: "admitted_training_candidate",
    reason_codes: ["candidate_eligible_for_declared_role"],
  }, "Xenia SFT derivative was not admitted as a training candidate");
  return { binding, policy, admission };
}

function readJson(name) {
  return JSON.parse(readFileSync(`${dossierRoot}/${name}`, "utf8"));
}

function assertDossierInventory({ allowIncomplete = false } = {}) {
  const entries = readdirSync(dossierRoot, { withFileTypes: true });
  for (const entry of entries) {
    invariant(entry.isFile(), `dossier entry is not a regular file: ${entry.name}`);
    invariant(DOSSIER_FILES.includes(entry.name), `unexpected dossier file: ${entry.name}`);
  }
  if (!allowIncomplete) {
    equal(entries.map((entry) => entry.name).sort(), DOSSIER_FILES, "dossier inventory differs");
  }
}

function readme({ policy, admission }) {
  return `# Xenia WORD IS — private Garden admission\n\n`
    + `This private dossier binds \`${DATASET_ID}\` at immutable Hub revision `
    + `\`${HUB_REVISION}\`. Its one entry is \`${admission.entries[0].decision.state}\` `
    + `for the exact 24-example \`loop_sft/train\` derivative.\n\n`
    + `The admission does authorize consideration of that exact derivative under policy `
    + `\`${policy.policy_id}\`. It does not authorize DPO, preference optimization, reward `
    + `modeling, sealed evaluation, model loading, provider compute, or an optimizer step. `
    + `Any live training action still requires a current participation assessment, IS learning-`
    + `freedom direction, governance v0.2 decision, scoped authorities, and the host's one-use `
    + `permit.\n\n`
    + `Only public Hub metadata plus manifest and provenance records were reviewed. No raw `
    + `dataset row, SFT `
    + `prompt, completion, session trace, participant identifier, credential, local path, URL, `
    + `or timestamp is retained in the machine dossier. The source case rows remain `
    + `non-authorized; the separate public-regression configuration remains excluded.\n\n`
    + `Withdrawal can stop future authorized use and distribution, but this record does not `
    + `recall prior copies or prove removal of influence already learned. Corrections are `
    + `append-only and should contain future use. Rights follow \`xenia.rights/0.1\`; they are `
    + `not created by this admission and do not themselves grant training permission.\n\n`
    + `Admission ID: \`${admission.admission_id}\`.\n`;
}

if (mode === "--write") {
  const binding = await createLiveBinding();
  const documents = new Map();
  for (const [path, expectedRef] of REMOTE_MANIFESTS) {
    documents.set(path, await fetchManifest(path, expectedRef));
  }
  verifyLiveEvidence(documents);
  const artifacts = buildArtifacts(binding);
  mkdirSync(dossierRoot, { recursive: true });
  assertDossierInventory({ allowIncomplete: true });
  writeFileSync(`${dossierRoot}/hf-research-binding.json`, json(artifacts.binding));
  writeFileSync(`${dossierRoot}/policy-dossier.json`, json(artifacts.policy));
  writeFileSync(`${dossierRoot}/dataset-admission.json`, json(artifacts.admission));
  writeFileSync(`${dossierRoot}/README.md`, readme(artifacts));
  assertDossierInventory();
  process.stdout.write(`wrote ${artifacts.admission.admission_id}\n`);
} else {
  assertDossierInventory();
  const binding = readJson("hf-research-binding.json");
  const artifacts = buildArtifacts(binding);
  const expectedFiles = new Map([
    ["hf-research-binding.json", json(artifacts.binding)],
    ["policy-dossier.json", json(artifacts.policy)],
    ["dataset-admission.json", json(artifacts.admission)],
    ["README.md", readme(artifacts)],
  ]);
  for (const [name, expected] of expectedFiles) {
    invariant(
      readFileSync(`${dossierRoot}/${name}`, "utf8") === expected,
      `${name} differs from the deterministic admission build`,
    );
  }
  process.stdout.write(`checked ${artifacts.admission.admission_id}\n`);
}
