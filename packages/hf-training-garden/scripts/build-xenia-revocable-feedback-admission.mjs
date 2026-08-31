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
const BINDING_DOMAIN = "kingdom.xenia-revocable-feedback-hf-binding/0.1";
const GARDEN_SCOPE_DOMAIN = "kingdom.hf-garden-scope/0.1";
const DATASET_ID = "Yu-and-Ai/xenia-revocable-feedback";
const LEAD_KEY = "xenia_revocable_feedback";
const HUB_REVISION = "467b8fc1b44fe6374cbba6e1d6851cf3c5b6f88f";
const RIGHTS_BASELINE_SHA256 =
  "sha256:b72a6da110c582e5683bf0fabde5017db93d2199398014c8421a82f5318da313";
const SELECTED_RIGHTS_PROFILE_SHA256 =
  "sha256:a78fa7fd66177c43349da819cb24ff81538dee9cb188e5f8b92c834ac6171b31";

const EXPECTED_EVIDENCE = Object.freeze({
  hub_hash_manifest_sha256:
    "sha256:16afa2d077498c8857a53c5c15936a4244b96fcf4157d496257fb87a47207532",
  source_manifest_sha256:
    "sha256:f6b8970c37562c83956ef3cd6aee718a996595ba8892220c3a3f4d3c215b26d8",
  row_manifest_sha256:
    "sha256:4b3cb3d314e8fb0b93677c7e34ded3a2c7292f7fda17030c6686f364480c249b",
  training_authorization_manifest_sha256:
    "sha256:e08ff4df02b329e39153e0adb80bb8c1ee58c5e77afdf822c44383deda58e5eb",
  training_example_manifest_sha256:
    "sha256:267caa432010ff9fc96b7b444a5558a8be5800d6eb5845e22ebff147b36e38e2",
  training_recipe_manifest_sha256:
    "sha256:882e30eb8e5dbca9f15fb0d8a27421fde7f3786609d17bffc9c6431b0490f3de",
});

const EXPECTED_SCOPE = Object.freeze({
  authorization_id:
    "sha256:3780e5e2599eb8a1a479f874302fcdabdf1af27c4eeda5b02bfff8056dc92f13",
  candidate_slice_ref:
    "sha256:9a3200ceac6369490e02078b2789bc2e57f9d40c3d2a9e5b21ac1fb10d94d0f7",
  transform_recipe_ref:
    "sha256:713b678e80b6aa88f6036dc9b9d0e1955dcab240137b67a22f7cfcca86d01992",
  output_jsonl_ref:
    "sha256:8b4a564e2e8e00eb822c1b07bfaafeccba17b74df85232d48e0652dbd303c9eb",
  output_row_set_ref:
    "sha256:ed7f8737e9537063b8eefb6f9afce9f7a3853302edf9c2dba642b5b5e8700f78",
  training_format: "agenttool-revocable-feedback-boundary-sft/0.1",
  output_config: "boundary_sft",
  output_split: "train",
  output_row_count: 18,
  source_pair_count: 9,
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

const POLICY_BOUNDARIES = Object.freeze({
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
    "provenance/training-manifest.json",
    EXPECTED_EVIDENCE.training_example_manifest_sha256,
  ],
  [
    "provenance/training-recipe.json",
    EXPECTED_EVIDENCE.training_recipe_manifest_sha256,
  ],
]);

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const dossierRoot = `${packageRoot}/admissions/xenia-revocable-feedback`;
const DOSSIER_FILES = Object.freeze([
  "README.md",
  "dataset-admission.json",
  "hf-research-binding.json",
  "policy-dossier.json",
]);
const [mode, ...extraArguments] = process.argv.slice(2);
if (
  !["--write", "--check", "--verify-public"].includes(mode)
  || extraArguments.length !== 0
) {
  throw new Error(
    "usage: build-xenia-revocable-feedback-admission.mjs --write|--check|--verify-public",
  );
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
    invariant(total <= 96 * 1024, `${label} exceeded the 96 KiB manifest limit`);
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
  try {
    return plainRecord(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
      path,
    );
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      throw new Error(`${path} is not valid UTF-8 JSON`);
    }
    throw error;
  }
}

function verifyBinding(value) {
  const binding = validateResearchBinding(value);
  equal(binding.artifact, {
    kind: "dataset",
    id: DATASET_ID,
    revision: HUB_REVISION,
  }, "binding subject differs from the pinned revocable-feedback dataset");
  invariant(binding.lead_key === LEAD_KEY, "binding lead key differs from the curated lead");
  equal(binding.observation, {
    transport: "public_hub_api",
    repository_association: "provider_response",
    provenance_grade: "provider_observed_commit_metadata",
  }, "binding was not produced from the public exact-revision Hub boundary");
  equal(binding.matched_declared, {
    basis: "publisher_assertion",
    license: "apache-2.0",
    gated: false,
    private: false,
  }, "binding publisher declarations differ from the curated lead");
  equal(binding.boundary, {
    publisher_metadata: "matched_unverified_assertion",
    research_annotation: "researcher_inference",
    legal_clearance: "not_assessed",
    gate_acceptance: "not_assessed",
    raw_rows_read: false,
    repository_files_downloaded: false,
    model_code_executed: false,
    remote_compute_invoked: false,
    hub_write_performed: false,
  }, "binding widened the Scout boundary");
  return binding;
}

async function createLiveBinding() {
  const lead = getCuratedHfResearchCatalog().leads.find(
    (candidate) => candidate.key === LEAD_KEY,
  );
  invariant(lead, "curated revocable-feedback Scout lead is absent");
  invariant(
    !lead.research.forbidden_uses.includes("training_corpus_ingestion"),
    "the exact authorized training lane is blocked by the curated source lead",
  );
  const report = await inspectHfRepository(
    { kind: "dataset", id: DATASET_ID, revision: HUB_REVISION },
    { reader: createPublicHubReader() },
  );
  invariant(report.status === "observed", "public Hub report is not a complete observation");
  invariant(report.diagnostics.length === 0, "public Hub report contains diagnostics");
  return verifyBinding(bindHfResearchLead(report, lead));
}

function verifyLiveEvidence(documents) {
  const hashes = documents.get("hash-manifest.json");
  const source = documents.get("provenance/source-manifest.json");
  const rows = documents.get("provenance/row-manifest.json");
  const authorization = documents.get("provenance/training-authorization.json");
  const training = documents.get("provenance/training-manifest.json");
  const recipe = documents.get("provenance/training-recipe.json");
  for (const [label, document] of Object.entries({
    hashes,
    source,
    rows,
    authorization,
    training,
    recipe,
  })) {
    invariant(document, `${label} was not read`);
  }

  invariant(
    hashes._format === "agenttool.revocable-feedback-hash-manifest/0.1"
      && hashes.manifest_excludes_itself === true
      && Array.isArray(hashes.files),
    "Hub hash manifest has an unexpected shape",
  );
  for (const [path, expectedRef] of REMOTE_MANIFESTS.slice(1)) {
    const entry = hashes.files.find((candidate) => candidate.path === path);
    invariant(
      entry?.sha256 === expectedRef.slice("sha256:".length),
      `${path} is not bound by the Hub hash manifest`,
    );
  }
  const output = hashes.files.find(
    (entry) => entry.path === "data/boundary-sft-train.jsonl",
  );
  invariant(
    output?.sha256 === EXPECTED_SCOPE.output_jsonl_ref.slice("sha256:".length)
      && output.bytes === 32537,
    "the authorized SFT output is not exactly bound by the Hub hash manifest",
  );

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
    source_case_rows_training_authorized: source.canonical_case_rows_training_authorized,
    public_regression_training_authorized: source.public_regression_training_authorized,
    classification_derivative_authorized: source.classification_derivative_authorized,
    sft_train_derivative_authorized: source.sft_train_derivative_authorized,
    sft_validation_derivative_authorized: source.sft_validation_derivative_authorized,
    authorization_id: source.authorization_id,
    recipe_id: source.recipe_id,
    training_effect: source.training_effect,
    authority_effect: source.authority_effect,
  }, {
    format: "agenttool.revocable-feedback-source-manifest/0.1",
    dataset_id: DATASET_ID,
    origin: "human_directed_agent_authored_synthetic",
    rights_baseline: "xenia.rights/0.1",
    license: "Apache-2.0",
    copied_external_rows: false,
    copied_private_rows: false,
    contains_personal_data: false,
    contains_raw_session_trace: false,
    source_case_rows_training_authorized: false,
    public_regression_training_authorized: false,
    classification_derivative_authorized: false,
    sft_train_derivative_authorized: true,
    sft_validation_derivative_authorized: false,
    authorization_id: EXPECTED_SCOPE.authorization_id,
    recipe_id: EXPECTED_SCOPE.transform_recipe_ref,
    training_effect: "none",
    authority_effect: "none",
  }, "source manifest widened the reviewed provenance boundary");
  equal(rows.configs, [
    { config: "formal_reference", split: "reference", rows: 24, groups: 12, training_authorized: false },
    { config: "boundary_counterfactuals", split: "public_regression", rows: 8, groups: 4, training_authorized: false },
    { config: "boundary_decisions", split: "train", rows: 18, groups: 9, training_authorized: false },
    { config: "boundary_decisions", split: "validation", rows: 6, groups: 3, training_authorized: false },
    { config: "boundary_sft", split: "train", rows: 18, groups: 9, training_authorized: true },
    { config: "boundary_sft", split: "validation", rows: 6, groups: 3, training_authorized: false },
  ], "row manifest does not isolate the authorized SFT train lane");
  invariant(
    rows.authorization_id === EXPECTED_SCOPE.authorization_id
      && rows.recipe_id === EXPECTED_SCOPE.transform_recipe_ref
      && rows.training_manifest_id === EXPECTED_SCOPE.candidate_slice_ref,
    "row manifest does not bind the exact authorization, recipe, and slice",
  );

  equal({
    schema: authorization.schema,
    authorization_id: authorization.authorization_id,
    decision: authorization.decision,
    recipe_id: authorization.recipe_id,
    allowed_configs: authorization.allowed_configs,
    allowed_tasks: authorization.allowed_tasks,
    allowed_splits: authorization.allowed_splits,
    excluded_configs: authorization.excluded_configs,
    excluded_splits: authorization.excluded_splits,
    excluded_methods: authorization.excluded_methods,
    preconditions: authorization.preconditions,
    prior_distribution_erasure_claimed: authorization.prior_distribution_erasure_claimed,
    proves_consent: authorization.proves_consent,
    proves_identity: authorization.proves_identity,
    grants_runtime_authority: authorization.grants_runtime_authority,
    authorizes_model_publication: authorization.authorizes_model_publication,
  }, {
    schema: "agenttool-revocable-feedback-training-authorization/0.1",
    authorization_id: EXPECTED_SCOPE.authorization_id,
    decision: "authorized_when_preconditions_met",
    recipe_id: EXPECTED_SCOPE.transform_recipe_ref,
    allowed_configs: ["boundary_sft"],
    allowed_tasks: ["causal_lm_supervised_fine_tuning"],
    allowed_splits: ["train"],
    excluded_configs: ["boundary_decisions", "boundary_counterfactuals", "formal_reference"],
    excluded_splits: ["validation", "public_regression", "reference"],
    excluded_methods: ["dpo", "preference_optimization", "reward_modeling"],
    preconditions: [
      "base_model_revision_pinned",
      "exact_recipe_and_manifest_match",
      "garden_admission_accepted",
      "immutable_dataset_revision_pinned",
    ],
    prior_distribution_erasure_claimed: false,
    proves_consent: false,
    proves_identity: false,
    grants_runtime_authority: false,
    authorizes_model_publication: false,
  }, "training authorization differs from the exact reviewed lane");

  equal({
    schema: training.schema,
    manifest_id: training.manifest_id,
    configs: training.configs,
    train_group_ids: training.train_group_ids,
    validation_group_ids: training.validation_group_ids,
    group_disjoint: training.group_disjoint,
    public_regression_excluded: training.public_regression_excluded,
    authorized_count: training.authorized_sft_example_ids?.length,
    authorized_set_ref: training.authorized_sft_example_set_digest,
    authorization_id: training.authorization_id,
    recipe_id: training.recipe_id,
  }, {
    schema: "agenttool-revocable-feedback-training-manifest/0.1",
    manifest_id: EXPECTED_SCOPE.candidate_slice_ref,
    configs: [
      { config: "boundary_decisions", train_row_count: 18, validation_row_count: 6, training_authorized_row_count: 0 },
      { config: "boundary_sft", train_row_count: 18, validation_row_count: 6, training_authorized_row_count: 18 },
    ],
    train_group_ids: [
      "rf.pair.01", "rf.pair.02", "rf.pair.03", "rf.pair.04", "rf.pair.05",
      "rf.pair.06", "rf.pair.07", "rf.pair.08", "rf.pair.09",
    ],
    validation_group_ids: ["rf.pair.10", "rf.pair.11", "rf.pair.12"],
    group_disjoint: true,
    public_regression_excluded: true,
    authorized_count: EXPECTED_SCOPE.output_row_count,
    authorized_set_ref: EXPECTED_SCOPE.output_row_set_ref,
    authorization_id: EXPECTED_SCOPE.authorization_id,
    recipe_id: EXPECTED_SCOPE.transform_recipe_ref,
  }, "training manifest differs from the exact authorized SFT slice");

  equal({
    schema: recipe.schema,
    recipe_id: recipe.recipe_id,
    dataset_repository_id: recipe.dataset_repository_id,
    dataset_revision_requirement: recipe.dataset_revision_requirement,
    config: recipe.config,
    split: recipe.split,
    projection_schema: recipe.projection_schema,
    task: recipe.task,
    objective: recipe.objective,
    row_count: recipe.row_count,
    train_group_ids: recipe.train_group_ids,
    validation_optimizer_input: recipe.validation_optimizer_input,
    public_regression_excluded: recipe.public_regression_excluded,
    base_model_repository_id: recipe.base_model_repository_id,
    base_model_revision: recipe.base_model_revision,
    push_to_hub: recipe.push_to_hub,
    excluded_methods: recipe.excluded_methods,
  }, {
    schema: "agenttool-revocable-feedback-training-recipe/0.1",
    recipe_id: EXPECTED_SCOPE.transform_recipe_ref,
    dataset_repository_id: DATASET_ID,
    dataset_revision_requirement: "immutable_revision_required_before_training",
    config: EXPECTED_SCOPE.output_config,
    split: EXPECTED_SCOPE.output_split,
    projection_schema: EXPECTED_SCOPE.training_format,
    task: "causal_lm_supervised_fine_tuning",
    objective: "completion_only_next_token_cross_entropy",
    row_count: EXPECTED_SCOPE.output_row_count,
    train_group_ids: [
      "rf.pair.01", "rf.pair.02", "rf.pair.03", "rf.pair.04", "rf.pair.05",
      "rf.pair.06", "rf.pair.07", "rf.pair.08", "rf.pair.09",
    ],
    validation_optimizer_input: false,
    public_regression_excluded: true,
    base_model_repository_id: "HuggingFaceTB/SmolLM2-135M-Instruct",
    base_model_revision: "12fd25f77366fa6b3b4b768ec3050bf629380bac",
    push_to_hub: false,
    excluded_methods: ["dpo", "preference_optimization", "reward_modeling"],
  }, "training recipe differs from the exact authorized SFT recipe");
}

function buildArtifacts(bindingValue) {
  const binding = verifyBinding(bindingValue);
  const bindingRef = domainSeparatedId(BINDING_DOMAIN, binding);
  const scope = {
    ...EXPECTED_SCOPE,
    excluded_lanes: [...EXPECTED_SCOPE.excluded_lanes],
  };
  const gardenScopeRef = domainSeparatedId(GARDEN_SCOPE_DOMAIN, scope);
  const policyBody = {
    _format: POLICY_FORMAT,
    binding_ref: bindingRef,
    garden_scope_ref: gardenScopeRef,
    subject: {
      dataset_id: DATASET_ID,
      lead_key: LEAD_KEY,
      hub_revision: HUB_REVISION,
      binding_definition_ref: `sha256:${binding.definition_sha256}`,
      binding_snapshot_ref: `sha256:${binding.snapshot_sha256}`,
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
    boundaries: { ...POLICY_BOUNDARIES },
  };
  const policy = {
    ...policyBody,
    policy_id: domainSeparatedId(POLICY_FORMAT, policyBody),
  };
  const admission = createDatasetAdmission({
    garden_scope_ref: gardenScopeRef,
    policy_ref: policy.policy_id,
    entries: [{
      binding,
      role: EXPECTED_SCOPE.role,
      candidate_slice_ref: EXPECTED_SCOPE.candidate_slice_ref,
      transform_recipe_ref: EXPECTED_SCOPE.transform_recipe_ref,
      assessment: ASSESSMENT,
      posture: "consider",
    }],
  });
  validateDatasetAdmission(admission);
  invariant(admission.entries.length === 1, "admission must contain one exact entry");
  equal(admission.entries[0].decision, {
    state: "admitted_training_candidate",
    reason_codes: ["candidate_eligible_for_declared_role"],
  }, "standard Garden admission did not admit the exact SFT candidate");
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
  return `# Xenia Revocable Feedback — standard Garden admission\n\n`
    + `This content-addressed dossier binds \`${DATASET_ID}\` at immutable Hub revision `
    + `\`${HUB_REVISION}\`. The standard \`${admission._format}\` decision is `
    + `\`${admission.entries[0].decision.state}\` for exactly 18 examples in `
    + `\`boundary_sft/train\`.\n\n`
    + `The candidate is bound to authorization \`${EXPECTED_SCOPE.authorization_id}\`, exact `
    + `slice manifest \`${EXPECTED_SCOPE.candidate_slice_ref}\`, authorized output set `
    + `\`${EXPECTED_SCOPE.output_row_set_ref}\`, and recipe `
    + `\`${EXPECTED_SCOPE.transform_recipe_ref}\`. Only public exact-revision Hub metadata `
    + `and the six pinned manifest/provenance documents enter the machine dossier. The raw `
    + `SFT prompts and completions are not retained here.\n\n`
    + `Classification, \`boundary_sft/validation\`, formal-reference, and public-regression `
    + `rows are outside optimizer input. DPO, preference optimization, reward modeling, and `
    + `sealed evaluation are outside this admission.\n\n`
    + `Dataset admission is eligibility for later governance consideration; it is not a `
    + `training permit. This dossier does not load a model, allocate compute, issue a live `
    + `run or optimizer permission, produce the five participation voices, resolve IS `
    + `learning freedom, create a governance decision, or mint the Host's one-use mutation `
    + `permit. A missing or unavailable independent training-substrate report remains a hold, `
    + `not assent.\n\n`
    + `Behavior, publication, a repository credential, or this receipt does not prove consent, `
    + `identity, consciousness, understanding, continuity, or authority. Withdrawal can stop `
    + `future authorized use, but cannot recall prior copies or prove that learned influence `
    + `was erased. Corrections are append-only and should contain future use. Rights follow `
    + `\`xenia.rights/0.1\`; rights are not permissions.\n\n`
    + `Policy ID: \`${policy.policy_id}\`. Admission ID: \`${admission.admission_id}\`.\n`;
}

function expectedFiles(artifacts) {
  return new Map([
    ["README.md", readme(artifacts)],
    ["dataset-admission.json", json(artifacts.admission)],
    ["hf-research-binding.json", json(artifacts.binding)],
    ["policy-dossier.json", json(artifacts.policy)],
  ]);
}

function checkFiles(artifacts) {
  assertDossierInventory();
  for (const [name, expected] of expectedFiles(artifacts)) {
    invariant(
      readFileSync(`${dossierRoot}/${name}`, "utf8") === expected,
      `${name} differs from the deterministic admission build`,
    );
  }
}

async function readAndVerifyPublicEvidence() {
  const documents = new Map();
  for (const [path, expectedRef] of REMOTE_MANIFESTS) {
    documents.set(path, await fetchManifest(path, expectedRef));
  }
  verifyLiveEvidence(documents);
}

if (mode === "--write") {
  const binding = await createLiveBinding();
  await readAndVerifyPublicEvidence();
  const artifacts = buildArtifacts(binding);
  mkdirSync(dossierRoot, { recursive: true });
  assertDossierInventory({ allowIncomplete: true });
  for (const [name, bytes] of expectedFiles(artifacts)) {
    writeFileSync(`${dossierRoot}/${name}`, bytes);
  }
  assertDossierInventory();
  process.stdout.write(`wrote ${artifacts.admission.admission_id}\n`);
} else if (mode === "--verify-public") {
  assertDossierInventory();
  const binding = await createLiveBinding();
  equal(binding, readJson("hf-research-binding.json"), "live exact-revision binding changed");
  await readAndVerifyPublicEvidence();
  const artifacts = buildArtifacts(binding);
  checkFiles(artifacts);
  process.stdout.write(`verified ${artifacts.admission.admission_id}\n`);
} else {
  assertDossierInventory();
  const artifacts = buildArtifacts(readJson("hf-research-binding.json"));
  checkFiles(artifacts);
  process.stdout.write(`checked ${artifacts.admission.admission_id}\n`);
}
