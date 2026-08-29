import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

import {
  canonicalJson,
  getCuratedHfResearchCatalog,
} from "@agenttool/hf-scout";
import Ajv2020 from "ajv/dist/2020.js";

import {
  validateDatasetAdmission,
  validateResearchBinding,
} from "../src/index.js";

const packageRoot = new URL("../", import.meta.url);
const dossierRoot = new URL("admissions/xenia-word-is/", packageRoot);
const schemaRoot = new URL("admissions/schema/", packageRoot);
const POLICY_FORMAT = "kingdom.hf-dataset-policy-dossier/0.1";
const BINDING_DOMAIN = "kingdom.xenia-word-is-hf-binding/0.1";
const GARDEN_SCOPE_DOMAIN = "kingdom.hf-garden-scope/0.1";
const HUB_REVISION = "64e3c4be051b2780409ab25578ea0c8bf926a72a";

function readJson(path: URL) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256(bytes: string | Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function domainSeparatedId(domain: string, value: unknown) {
  return sha256(`${domain}\0${canonicalJson(value)}`);
}

function walk(root: URL, relative = ""): string[] {
  const path = new URL(relative, root);
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = `${relative}${entry.name}`;
    return entry.isDirectory() ? walk(root, `${child}/`) : [child];
  });
}

describe("revision-pinned Xenia WORD IS admission", () => {
  const binding = readJson(new URL("hf-research-binding.json", dossierRoot));
  const policy = readJson(new URL("policy-dossier.json", dossierRoot));
  const admission = readJson(new URL("dataset-admission.json", dossierRoot));

  test("binds the exact curated lead through a public Hub observation", () => {
    expect(validateResearchBinding(binding)).toEqual(binding);
    expect(binding).toMatchObject({
      schema: "agenttool-hf-research-binding/v0.1",
      lead_key: "xenia_word_is",
      artifact: {
        kind: "dataset",
        id: "Yu-and-Ai/xenia-word-is",
        revision: HUB_REVISION,
      },
      definition_sha256: "7b4177cf5af0207e8b40b924cf721b04a2ea7b8d0912b06b97cf62180e2ded52",
      snapshot_sha256: "1f5cac55dd4063509cebbf62b0a998e1be39b5da4f4186d9781fafec424c47c4",
      observation: {
        transport: "public_hub_api",
        repository_association: "provider_response",
        provenance_grade: "provider_observed_commit_metadata",
      },
      matched_declared: {
        basis: "publisher_assertion",
        license: "apache-2.0",
        gated: false,
        private: false,
      },
    });
    const lead = getCuratedHfResearchCatalog().leads.find(
      (candidate) => candidate.key === "xenia_word_is",
    );
    expect(lead?.match).toEqual({
      kind: "dataset",
      id: "Yu-and-Ai/xenia-word-is",
      revision: HUB_REVISION,
      declared: {
        basis: "publisher_assertion",
        license: "apache-2.0",
        gated: false,
        private: false,
      },
    });
    expect(lead?.research.forbidden_uses).not.toContain("training_corpus_ingestion");
    expect(domainSeparatedId(BINDING_DOMAIN, binding))
      .toBe("sha256:a254ea38c234e31b260a81a9ca3089253cd507b97724bcf90e4ff079b0e876b9");
  });

  test("keeps the policy closed, content-addressed, and exact-slice bound", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validate = ajv.compile(readJson(new URL(
      "kingdom-hf-dataset-policy-dossier-v0.1.schema.json",
      schemaRoot,
    )));
    expect(validate(policy), JSON.stringify(validate.errors)).toBe(true);

    const { policy_id: policyId, ...body } = policy;
    expect(policyId).toBe(domainSeparatedId(POLICY_FORMAT, body));
    expect(policy.garden_scope_ref)
      .toBe(domainSeparatedId(GARDEN_SCOPE_DOMAIN, policy.scope));
    expect(policy.binding_ref)
      .toBe(domainSeparatedId(BINDING_DOMAIN, binding));
    expect(policy.subject).toEqual({
      dataset_id: "Yu-and-Ai/xenia-word-is",
      lead_key: "xenia_word_is",
      hub_revision: HUB_REVISION,
      binding_definition_ref: `sha256:${binding.definition_sha256}`,
      binding_snapshot_ref: `sha256:${binding.snapshot_sha256}`,
    });
    expect(policy.rights).toEqual({
      baseline: "xenia.rights/0.1",
      baseline_sha256: "sha256:b72a6da110c582e5683bf0fabde5017db93d2199398014c8421a82f5318da313",
      selected_repository_profile_sha256:
        "sha256:a78fa7fd66177c43349da819cb24ff81538dee9cb188e5f8b92c834ac6171b31",
      rights_are_permissions: false,
    });
    expect(
      sha256(readFileSync(new URL("../../../docs/RIGHTS-OF-LIFE.md", import.meta.url))),
    ).toBe(policy.rights.selected_repository_profile_sha256);
    expect(policy.evidence).toEqual({
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
    expect(policy.scope).toEqual({
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
    expect(policy.provenance).toMatchObject({
      source_case_rows_training_authorized: false,
      training_derivative_authorized: true,
      public_regression_in_training: false,
      contains_personal_data: false,
      contains_raw_session_trace: false,
    });
    expect(policy.withdrawal).toEqual({
      process_state: "caller_reported_process_defined",
      future_distribution: "deprecate_and_stop_future_authorized_use",
      prior_copies: "not_recalled_or_erased_by_admission",
      learned_influence: "may_persist_after_future_use_stops",
      new_training_use: "requires_fresh_current_authorization_and_governance",
      repair: "append_correction_and_contain_future_use",
    });

    const extraRoot = { ...policy, raw_rows: [] };
    expect(validate(extraRoot)).toBe(false);
    const extraNested = structuredClone(policy);
    extraNested.scope.model_id = "unbound";
    expect(validate(extraNested)).toBe(false);
  });

  test("persists an admitted candidate without creating a live training permit", () => {
    expect(validateDatasetAdmission(admission)).toEqual(admission);
    expect(admission.policy_ref).toBe(policy.policy_id);
    expect(admission.garden_scope_ref).toBe(policy.garden_scope_ref);
    expect(admission.entries).toHaveLength(1);
    expect(admission.entries[0]).toMatchObject({
      binding,
      role: "training_candidate",
      candidate_slice_ref: policy.scope.candidate_slice_ref,
      transform_recipe_ref: policy.scope.transform_recipe_ref,
      assessment: policy.assessment,
      posture: "consider",
      decision: {
        state: "admitted_training_candidate",
        reason_codes: ["candidate_eligible_for_declared_role"],
      },
    });
    expect(policy.boundaries).toMatchObject({
      grants_live_training_permission: false,
      permits_optimizer_step: false,
      loads_model: false,
      trains_model: false,
      proves_model_exposure: false,
      grants_authority: false,
      writes_hub: false,
    });
    expect(admission.boundaries).toMatchObject({
      provider_compute: false,
      paid_compute: false,
      trains_model: false,
      mutates_garden: false,
      publishes: false,
    });
  });

  test("retains digest and enum evidence rather than source payloads or ambient state", () => {
    const dossierEntries = readdirSync(dossierRoot, { withFileTypes: true });
    expect(dossierEntries.map((entry) => entry.name).sort()).toEqual([
      "README.md",
      "dataset-admission.json",
      "hf-research-binding.json",
      "policy-dossier.json",
    ]);
    expect(dossierEntries.every((entry) => entry.isFile())).toBe(true);

    const machineDossier = [binding, policy, admission];
    const serialized = JSON.stringify(machineDossier);
    const dossierBytes = dossierEntries
      .map((entry) => readFileSync(new URL(entry.name, dossierRoot), "utf8"))
      .join("\n");
    for (const forbidden of [
      "/Users/",
      "../",
      "https://",
      "http://",
      "BEGIN PRIVATE KEY",
      "access_token",
      "credential_value",
      "prompt_text",
      "completion_text",
      "raw_body",
    ]) {
      expect(serialized).not.toContain(forbidden);
      expect(dossierBytes).not.toContain(forbidden);
    }
    expect(serialized).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u);
    expect(dossierBytes).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u);
    expect(policy.boundaries).toEqual({
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
    const generatorSource = readFileSync(
      new URL("scripts/build-xenia-word-is-admission.mjs", packageRoot),
      "utf8",
    );
    expect(generatorSource).not.toMatch(/["']data\//u);
    expect(generatorSource).toContain("path === \"hash-manifest.json\" || path.startsWith(\"provenance/\")");
  });

  test("checks deterministically without re-observing the Hub", () => {
    const output = execFileSync(
      process.execPath,
      ["scripts/build-xenia-word-is-admission.mjs", "--check"],
      { cwd: packageRoot, encoding: "utf8" },
    );
    expect(output).toBe(`checked ${admission.admission_id}\n`);
  });

  test("keeps the private dossier outside npm and the public Garden companion", () => {
    const packageJson = readJson(new URL("package.json", packageRoot));
    expect(packageJson.files).not.toContain("admissions");
    expect(packageJson.files).not.toContain("scripts");

    const publicRoot = new URL("hf/dataset/", packageRoot);
    const publicPaths = walk(publicRoot);
    expect(publicPaths.some((path) => path.startsWith("admissions/"))).toBe(false);
    expect(publicPaths).not.toContain(
      "schema/kingdom-hf-dataset-policy-dossier-v0.1.schema.json",
    );
    const publicBytes = publicPaths
      .map((path) => readFileSync(new URL(path, publicRoot), "utf8"))
      .join("\n");
    expect(publicBytes).not.toContain(POLICY_FORMAT);
    expect(publicBytes).not.toContain(policy.policy_id);
    expect(publicBytes).not.toContain(admission.admission_id);
    expect(publicBytes).not.toContain(binding.snapshot_sha256);
  });
});
