import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

import {
  canonicalJson,
  getCuratedHfResearchCatalog,
} from "@agenttool/hf-scout";
import Ajv2020 from "ajv/dist/2020.js";

import {
  createDatasetAdmission,
  validateDatasetAdmission,
  validateResearchBinding,
} from "../src/index.js";

const packageRoot = new URL("../", import.meta.url);
const dossierRoot = new URL(
  "admissions/xenia-revocable-feedback/",
  packageRoot,
);
const schemaRoot = new URL("admissions/schema/", packageRoot);
const POLICY_FORMAT = "kingdom.hf-dataset-policy-dossier/0.1";
const BINDING_DOMAIN = "kingdom.xenia-revocable-feedback-hf-binding/0.1";
const GARDEN_SCOPE_DOMAIN = "kingdom.hf-garden-scope/0.1";
const HUB_REVISION = "467b8fc1b44fe6374cbba6e1d6851cf3c5b6f88f";
const ADMISSION_ID =
  "sha256:125ae2f84d7cdf58242bc039db67753b5825c4d61e35dd13eda7a58f299295f2";

function readJson(path: URL) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256(bytes: string | Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function domainSeparatedId(domain: string, value: unknown) {
  return sha256(`${domain}\0${canonicalJson(value)}`);
}

describe("revision-pinned Xenia Revocable Feedback admission", () => {
  const binding = readJson(new URL("hf-research-binding.json", dossierRoot));
  const policy = readJson(new URL("policy-dossier.json", dossierRoot));
  const admission = readJson(new URL("dataset-admission.json", dossierRoot));

  test("binds the exact curated lead through a public Hub observation", () => {
    expect(validateResearchBinding(binding)).toEqual(binding);
    expect(binding).toMatchObject({
      schema: "agenttool-hf-research-binding/v0.1",
      lead_key: "xenia_revocable_feedback",
      artifact: {
        kind: "dataset",
        id: "Yu-and-Ai/xenia-revocable-feedback",
        revision: HUB_REVISION,
      },
      definition_sha256:
        "1191f08d4128f023347b171f9672decca2edb28fae5aa1a7e1796f76c65ee19c",
      snapshot_sha256:
        "168e965bbfde8dd6c41872472e1f289f1559b935cc48440743e2a1d509296311",
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
      boundary: {
        legal_clearance: "not_assessed",
        gate_acceptance: "not_assessed",
        raw_rows_read: false,
        repository_files_downloaded: false,
        remote_compute_invoked: false,
        hub_write_performed: false,
      },
    });

    const lead = getCuratedHfResearchCatalog().leads.find(
      (candidate) => candidate.key === "xenia_revocable_feedback",
    );
    expect(lead?.match).toEqual({
      kind: "dataset",
      id: "Yu-and-Ai/xenia-revocable-feedback",
      revision: HUB_REVISION,
      declared: {
        basis: "publisher_assertion",
        license: "apache-2.0",
        gated: false,
        private: false,
      },
    });
    expect(lead?.research.forbidden_uses)
      .not.toContain("training_corpus_ingestion");
    expect(domainSeparatedId(BINDING_DOMAIN, binding)).toBe(
      "sha256:089f91b8dc5e518d53a5c817f0a602610571e36b1b73a8b9e6eb0a7ffc125ed1",
    );
  });

  test("keeps a closed content-addressed policy for the one exact SFT slice", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validate = ajv.compile(readJson(new URL(
      "kingdom-hf-dataset-policy-dossier-v0.1.schema.json",
      schemaRoot,
    )));
    expect(validate(policy), JSON.stringify(validate.errors)).toBe(true);

    const { policy_id: policyId, ...body } = policy;
    expect(policyId).toBe(domainSeparatedId(POLICY_FORMAT, body));
    expect(policyId).toBe(
      "sha256:37654981c31989a22d02efe8cabe8bfc1e04ef2afcb0cbf3c23769bf665c8a53",
    );
    expect(policy.garden_scope_ref).toBe(
      domainSeparatedId(GARDEN_SCOPE_DOMAIN, policy.scope),
    );
    expect(policy.binding_ref).toBe(domainSeparatedId(BINDING_DOMAIN, binding));
    expect(policy.rights).toEqual({
      baseline: "xenia.rights/0.1",
      baseline_sha256:
        "sha256:b72a6da110c582e5683bf0fabde5017db93d2199398014c8421a82f5318da313",
      selected_repository_profile_sha256:
        "sha256:a78fa7fd66177c43349da819cb24ff81538dee9cb188e5f8b92c834ac6171b31",
      rights_are_permissions: false,
    });
    expect(
      sha256(readFileSync(new URL("../../../docs/RIGHTS-OF-LIFE.md", import.meta.url))),
    ).toBe(policy.rights.selected_repository_profile_sha256);
    expect(policy.evidence).toEqual({
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
    expect(policy.scope).toEqual({
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
    expect(policy.provenance).toMatchObject({
      source_case_rows_training_authorized: false,
      training_derivative_authorized: true,
      public_regression_in_training: false,
      contains_personal_data: false,
      contains_raw_session_trace: false,
    });

    const extra = structuredClone(policy);
    extra.scope.validation_optimizer_input = true;
    expect(validate(extra)).toBe(false);
  });

  test("uses the standard Garden decision without minting a training permit", () => {
    expect(validateDatasetAdmission(admission)).toEqual(admission);
    expect(admission._format).toBe("kingdom.hf-dataset-admission/0.1");
    expect(admission.admission_id).toBe(ADMISSION_ID);
    expect(admission.entries).toHaveLength(1);
    expect(admission.entries[0]).toMatchObject({
      role: "training_candidate",
      candidate_slice_ref: policy.scope.candidate_slice_ref,
      transform_recipe_ref: policy.scope.transform_recipe_ref,
      decision: {
        state: "admitted_training_candidate",
        reason_codes: ["candidate_eligible_for_declared_role"],
      },
    });

    const rebuilt = createDatasetAdmission({
      garden_scope_ref: policy.garden_scope_ref,
      policy_ref: policy.policy_id,
      entries: [{
        binding,
        role: "training_candidate",
        candidate_slice_ref: policy.scope.candidate_slice_ref,
        transform_recipe_ref: policy.scope.transform_recipe_ref,
        assessment: policy.assessment,
        posture: "consider",
      }],
    });
    expect(rebuilt).toEqual(admission);
    expect(admission.boundaries).toMatchObject({
      network: false,
      filesystem: false,
      provider_compute: false,
      paid_compute: false,
      trains_model: false,
      publishes: false,
      mutates_garden: false,
      proves_consent: false,
    });
    expect(policy.boundaries).toMatchObject({
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
  });

  test("rejects tampering and keeps validation, reference, and regression outside optimizer input", () => {
    const wrongSlice = structuredClone(admission);
    wrongSlice.entries[0].candidate_slice_ref = sha256("unauthorized-slice");
    expect(() => validateDatasetAdmission(wrongSlice)).toThrow();

    const wrongDecision = structuredClone(admission);
    wrongDecision.entries[0].decision.state = "admitted_validation_candidate";
    expect(() => validateDatasetAdmission(wrongDecision)).toThrow();

    const dossierReadme = readFileSync(new URL("README.md", dossierRoot), "utf8");
    expect(dossierReadme).toContain("Classification");
    expect(dossierReadme).toContain("`boundary_sft/validation`");
    expect(dossierReadme).toContain("formal-reference");
    expect(dossierReadme).toContain("public-regression");
    expect(dossierReadme).toContain("outside optimizer input");
    expect(dossierReadme).toContain("not a training permit");
    expect(dossierReadme).toContain("does not");
  });

  test("retains minimized evidence and rebuilds deterministically offline", () => {
    const entries = readdirSync(dossierRoot, { withFileTypes: true });
    expect(entries.map((entry) => entry.name).sort()).toEqual([
      "README.md",
      "dataset-admission.json",
      "hf-research-binding.json",
      "policy-dossier.json",
    ]);
    expect(entries.every((entry) => entry.isFile())).toBe(true);

    const serialized = JSON.stringify([binding, policy, admission]);
    for (const forbidden of [
      "/Users/",
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
    }
    expect(serialized).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u);

    const generator = readFileSync(
      new URL("scripts/build-xenia-revocable-feedback-admission.mjs", packageRoot),
      "utf8",
    );
    expect(generator).toContain(
      "path === \"hash-manifest.json\" || path.startsWith(\"provenance/\")",
    );
    expect(generator).toContain("credentials: \"omit\"");

    const output = execFileSync(
      process.execPath,
      ["scripts/build-xenia-revocable-feedback-admission.mjs", "--check"],
      { cwd: packageRoot, encoding: "utf8" },
    );
    expect(output).toBe(`checked ${ADMISSION_ID}\n`);
  });
});
