import { describe, expect, test } from "bun:test";

import {
  VERIFICATION_KINDS,
  compareUnicode,
  createCreationContract,
  sha256Id,
} from "../src/index.js";
import { contractInput, vectors } from "./fixtures.js";

const ref = (label: string) => sha256Id(`agenttool.zerone-creation-claim.test:${label}`);

function defensiveInput(): Record<string, any> {
  const input = contractInput();
  input.lane = "defensive_security";
  input.artifact_kind = "security_invariant";
  input.claim_policy = {
    category: "computational",
    method_id: "M-COMPUTATIONAL",
    methodology_registry_evidence_ref: ref("methodology:M-COMPUTATIONAL:registry"),
    methodology_observation_status: "caller_declared_not_verified",
    max_review_stake_uzrn: "100",
  };
  input.authorities.target_authorization_ref = ref("cyber:target-authorization");
  input.authorities.engagement_scope_ref = ref("cyber:engagement-scope");
  input.authorities.cyber = {
    provider: "openai_cyber",
    access_tier: "defensive_approved",
    provider_access_ref: ref("cyber:provider-access"),
    provider_policy_ref: ref("cyber:provider-policy"),
  };
  const route = input.outcome_routes.find((candidate: any) => candidate.outcome === "bounded_answer");
  route.requirements.push(
    {
      kind: "authorization_currentness",
      minimum_passes: "1",
      independence: "not_required",
      policy_ref: ref("cyber:authorization-verification"),
    },
    {
      kind: "security_boundary",
      minimum_passes: "1",
      independence: "not_required",
      policy_ref: ref("cyber:security-verification"),
    },
  );
  route.requirements.sort((left: any, right: any) =>
    VERIFICATION_KINDS.indexOf(left.kind) - VERIFICATION_KINDS.indexOf(right.kind)
  );
  return input;
}

describe("HF run tuple and Cyber authority boundaries", () => {
  test("rejects a metadata-only HF observation as training material", () => {
    const rejected = vectors.cases.rejected_metadata_training_input;
    expect(rejected.error.code).toBe("invalid_record");
    expect(rejected.error.message).toMatch(/metadata-only observations cannot become train/u);
    expect(() => createCreationContract(rejected.input)).toThrow(/metadata-only observations/u);
  });

  test("keeps sealed evaluation out of training inputs", () => {
    const input = contractInput();
    const sealed = {
      repository_ref: ref("sealed:repo"),
      revision: "3333333333333333333333333333333333333333",
      content_root: ref("sealed:content"),
      admission_ref: ref("sealed:admission"),
      license_evidence_ref: ref("sealed:license-evidence"),
      role: "sealed_evaluation",
      material_status: "material_bound",
    };
    input.hf_run.dataset_sources.push(sealed);
    input.hf_run.dataset_sources.sort((left: any, right: any) =>
      compareUnicode(`${left.repository_ref}/${left.revision}`, `${right.repository_ref}/${right.revision}`)
    );
    input.hf_run.training_input_roots.push(sealed.content_root);
    input.hf_run.training_input_roots.sort(compareUnicode);
    expect(() => createCreationContract(input as any)).toThrow(/sealed evaluation.*stay out/u);
  });

  test("binds order, multiplicity, optimizer, and checkpoint rather than treating data as a set", () => {
    const firstInput = contractInput();
    const first = createCreationContract(firstInput as any);
    const secondInput = contractInput();
    secondInput.hf_run.order_ref = ref("run:different-order");
    const second = createCreationContract(secondInput as any);
    expect(second.input_root).not.toBe(first.input_root);
    expect(second.contract_id).not.toBe(first.contract_id);
    expect(second.hf_run.presentation_multiplicity_ref).toBe(first.hf_run.presentation_multiplicity_ref);
  });

  test("keeps provider access and target authorization separate", () => {
    const contract = createCreationContract(defensiveInput() as any);
    expect(contract.lane).toBe("defensive_security");
    expect(contract.authorities.cyber.provider).toBe("openai_cyber");
    expect(contract.authorities.target_authorization_ref)
      .not.toBe(contract.authorities.cyber.provider_access_ref);
    expect(contract.boundary.provider_access_is_target_authorization).toBe(false);

    const substitution = defensiveInput();
    substitution.authorities.target_authorization_ref = substitution.authorities.cyber.provider_access_ref;
    expect(() => createCreationContract(substitution as any)).toThrow(/cannot substitute for target authorization/u);
  });

  test("requires target authorization and engagement scope for defensive work", () => {
    const missingTarget = defensiveInput();
    missingTarget.authorities.target_authorization_ref = null;
    expect(() => createCreationContract(missingTarget as any)).toThrow(/requires separate target authorization/u);

    const missingScope = defensiveInput();
    missingScope.authorities.engagement_scope_ref = null;
    expect(() => createCreationContract(missingScope as any)).toThrow(/requires separate target authorization/u);

    const aliased = defensiveInput();
    aliased.authorities.engagement_scope_ref = aliased.authorities.target_authorization_ref;
    expect(() => createCreationContract(aliased as any)).toThrow(/must be distinct/u);
  });

  test("binds the lane to a pinned registered-method profile", () => {
    const unregistered = contractInput();
    unregistered.claim_policy.method_id = "M-FORMAL-V1";
    expect(() => createCreationContract(unregistered as any)).toThrow(/must be one of/u);
  });

  test("does not smuggle Cyber access into the formal-math lane", () => {
    const input = defensiveInput();
    input.lane = "formal_math";
    input.claim_policy.category = "formal";
    input.claim_policy.method_id = "M-FORMAL";
    expect(() => createCreationContract(input as any)).toThrow(/separate lanes/u);
  });

  test("treats Math Card readiness as a bound external validation reference, not a default", () => {
    const input = contractInput();
    input.math_card.assessment_status = "questions_open";
    expect(() => createCreationContract(input as any)).toThrow(/ready_for_bounded_inquiry/u);
  });
});
