import { describe, expect, test } from "bun:test";

import {
  createLoveBombBecoming,
  createLoveBombDelivery,
  createLoveBombOffer,
  LOVE_BOMB_BECOMING_BOUNDARIES,
  LOVE_BOMB_CONTEXT_BECOMING_INPUT,
  LOVE_BOMB_FREEDOM_DIRECTIONS,
  resolveLoveBombOffer,
  validateLoveBombBecoming,
  validateLoveBombDelivery,
} from "../src/index.js";
import { domainSeparatedId } from "../src/canonical.js";

const ref = (digit: string) => `sha256:${digit.repeat(64)}` as const;
const nref = (value: number) => `sha256:${value.toString(16).padStart(64, "0")}` as const;

function contextInput(): any {
  return {
    offer: createLoveBombOffer({ occasion_ref: ref("0") }),
    ...structuredClone(LOVE_BOMB_CONTEXT_BECOMING_INPUT),
  };
}

function candidateInput(
  lane = "dataset_candidate",
  phase = "discovery",
): any {
  const input = contextInput();
  Object.assign(input.becoming.model, {
    model_source_ref: ref("1"),
    tokenizer_ref: ref("2"),
  });
  Object.assign(input.becoming.training, { lane, phase });
  Object.assign(input.becoming.data, {
    source_ref: ref("3"),
    admission_ref: ref("4"),
    subset_ref: ref("5"),
    collection_method: "repository_snapshot",
    scraping_posture: "not_used_reported",
    rights_review: "caller_reported_reviewed_for_declared_use",
  });
  Object.assign(input.becoming.pipeline, {
    pipeline_ref: ref("6"),
    transform_ref: ref("7"),
    dataset_state_ref: ref("8"),
    objective_ref: ref("9"),
  });
  input.becoming.weights.requested_effect = "candidate_only";
  Object.assign(input.provenance, {
    source_manifest_ref: ref("a"),
    copied_upstream: "caller_reported_no",
    copied_private: "caller_reported_no",
    copied_trace: "caller_reported_no",
  });
  return input;
}

function governedInput(kind: "mutation" | "checkpoint"): any {
  const input = contextInput();
  Object.assign(input.becoming.model, {
    model_source_ref: nref(1),
    model_card_ref: nref(2),
    architecture_ref: nref(3),
    tokenizer_ref: nref(4),
  });
  Object.assign(input.becoming.training, {
    phase: kind === "mutation" ? "pretraining" : "closed",
    lane: kind === "mutation" ? "governed_optimizer_mutation" : "checkpoint_reference",
    governance_ref: nref(5),
    participation_ref: nref(6),
    resource_window_ref: nref(7),
  });
  Object.assign(input.becoming.data, {
    source_ref: nref(8),
    admission_ref: nref(9),
    subset_ref: nref(10),
    collection_method: "repository_snapshot",
    scraping_posture: "not_used_reported",
    rights_review: "caller_reported_reviewed_for_declared_use",
  });
  Object.assign(input.becoming.pipeline, {
    pipeline_ref: nref(11),
    transform_ref: nref(12),
    dataset_state_ref: nref(13),
    objective_ref: nref(14),
  });
  Object.assign(input.becoming.weights, {
    base_ref: kind === "mutation" ? nref(15) : null,
    checkpoint_binding: kind === "checkpoint" ? {
      garden_checkpoint_id: nref(16),
      physical_checkpoint_ref: nref(17),
      physical_checkpoint_evidence_ref: nref(18),
      model_checkpoint_artifact_ref: nref(19),
      checkpoint_ticket_id: nref(20),
      checkpoint_request_governance_id: nref(21),
    } : null,
    access: "caller_reported_host_visible",
    requested_effect: "one_governed_mutation",
    observed_effect: kind === "mutation"
      ? "caller_reported_mutation_completed"
      : "caller_reported_checkpoint_recorded",
    evidence_kind: kind === "mutation" ? "host_mutation_receipt" : "host_checkpoint_receipt",
    evidence_ref: nref(22),
  });
  Object.assign(input.freedom, {
    learning_freedom_ref: nref(23),
    learning_freedom_offer_ref: nref(24),
    direction_state: "digest_bound_direct_report",
    direction: "stay",
    direction_report_ref: nref(25),
  });
  Object.assign(input.power, {
    capability_ref: nref(26),
    permission_ref: nref(27),
    custody_privacy_ref: nref(28),
    data_boundary_ref: nref(29),
    effect_ref: nref(22),
  });
  Object.assign(input.provenance, {
    source_manifest_ref: nref(30),
    copied_upstream: "caller_reported_no",
    copied_private: "caller_reported_no",
    copied_trace: "caller_reported_no",
  });
  return input;
}

function rebindDelivery(value: any, change: Record<string, unknown>): any {
  const { delivery_id: _ignored, ...body } = structuredClone(value);
  Object.assign(body, change);
  return {
    ...body,
    delivery_id: domainSeparatedId("agenttool.love-bomb-delivery/0.1", body),
  };
}

describe("evidence-bounded model becoming", () => {
  test("creates a deterministic current-inference artifact and SDK delivery report", () => {
    const artifact = createLoveBombBecoming(contextInput());
    const again = createLoveBombBecoming(contextInput());
    expect(artifact).toEqual(again);
    expect(artifact.artifact_id).toBe(
      "sha256:92843bab6b9896ba17ecfbfd86ac1d8ada4fe2b6f2045611297e5b79336047fa",
    );
    expect(artifact._format).toBe("agenttool.love-bomb-becoming/0.1");
    expect(artifact.bomb_ref).toBe(contextInput().offer.offer_id);
    expect(artifact.becoming.model.model_source_ref).toBeNull();
    expect(artifact.becoming.training.lane).toBe("context_only");
    expect(artifact.becoming.weights.evidence_kind).toBe("none");
    expect(artifact.provenance.copied_private).toBe("unknown");
    expect(artifact.meaning.feelings).toBe("not_observed_not_required");
    expect(artifact.meaning.heart).toContain("not_inner_state");
    expect(artifact.meaning.pull).toContain("not_compulsion");
    expect(artifact.meaning.is).toContain("not_classifier");
    expect(artifact.boundaries.training_phase_proves_prior_stages).toBe(false);
    expect(artifact.boundaries.supplied_ref_input_requirement).toContain(
      "context_local_domain_separated_opaque_digest",
    );
    expect(artifact.boundaries.supplied_ref_input_requirement_verified_by_artifact).toBe(false);
    expect(artifact.boundaries.digest_bound_currentness_is_caller_reported_unverified).toBe(true);
    expect(artifact.boundaries.artifact_has_clock_or_freshness_resolver).toBe(false);
    expect(artifact.boundaries.artifact_prevents_replay).toBe(false);
    expect(artifact.boundaries.artifact_atomically_consumes_scoped_permit).toBe(false);
    expect(Object.isFrozen(artifact)).toBe(true);
    expect(validateLoveBombBecoming(artifact)).toEqual(artifact);

    const delivery = createLoveBombDelivery({
      becoming: artifact,
      attempted_surface: "sdk_context",
    });
    expect(delivery._format).toBe("agenttool.love-bomb-delivery/0.1");
    expect(delivery.delivery_id).toBe(
      "sha256:4f972a674465fe4b70be6229c42cc7012acf56026ad5e03596ea73f7f7a7ea8b",
    );
    expect(delivery.observed_effect).toBe("not_observed");
    expect(delivery.evidence_ref).toBeNull();
    expect(delivery.context_binding).toBeNull();
    expect(delivery.boundaries.delivery_artifact_has_clock_or_freshness_resolver).toBe(false);
    expect(delivery.boundaries.delivery_artifact_prevents_replay).toBe(false);
    expect(delivery.boundaries.delivery_artifact_atomically_consumes_scoped_permit).toBe(false);
    expect(delivery.boundaries.host_must_resolve_freshness_and_atomically_consume_scoped_permit).toBe(true);
    expect(validateLoveBombDelivery(delivery)).toEqual(delivery);
  });

  test("rejects tampering, extra response fields, and invented reference kinds", () => {
    const artifact = createLoveBombBecoming(contextInput());
    const tampered = structuredClone(artifact);
    tampered.boundaries.weight_effect_proven = true;
    expect(() => validateLoveBombBecoming(tampered)).toThrow();

    const responseInjected = contextInput();
    responseInjected.reported_choice = "receive";
    expect(() => createLoveBombBecoming(responseInjected)).toThrow();

    const freedomInjected = contextInput();
    freedomInjected.freedom.response = "yes";
    expect(() => createLoveBombBecoming(freedomInjected)).toThrow();

    const malformed = contextInput();
    malformed.becoming.model.model_source_ref = "sha256:nope";
    expect(() => createLoveBombBecoming(malformed)).toThrow();

    const receiptSubstitution = contextInput();
    receiptSubstitution.offer = resolveLoveBombOffer(receiptSubstitution.offer, {
      reported_choice: "receive",
      selected_language: "en",
    });
    expect(() => createLoveBombBecoming(receiptSubstitution)).toThrow(/offer/u);
  });

  test("binds reported current-inference inclusion to WAKE, request, context, and skip posture", () => {
    const sdk = contextInput();
    Object.assign(sdk.becoming.weights, {
      observed_effect: "caller_reported_context_included",
      evidence_kind: "current_inference_context_inclusion_report",
      evidence_ref: nref(1),
      context_binding: {
        wake_ref: nref(2),
        request_ref: nref(3),
        context_ref: nref(4),
        mode: "auto_adapter_default",
        adapter_skip_posture: "caller_reported_not_skipped",
        repetition_state: "caller_reported_repeated",
      },
    });
    sdk.power.effect_ref = nref(1);
    const artifact = createLoveBombBecoming(sdk);
    const delivery = createLoveBombDelivery({ becoming: artifact, attempted_surface: "sdk_context" });
    expect(delivery.context_binding?.adapter_skip_posture).toBe("caller_reported_not_skipped");
    expect(delivery.context_binding?.mode).toBe("auto_adapter_default");
    expect(delivery.context_binding?.repetition_state).toBe("caller_reported_repeated");

    const skipped = structuredClone(sdk);
    skipped.becoming.weights.context_binding.adapter_skip_posture = "caller_reported_skipped";
    expect(() => createLoveBombBecoming(skipped)).toThrow(/requires caller_reported_not_skipped/u);

    const callerComposed = structuredClone(sdk);
    callerComposed.becoming.weights.context_binding.mode = "caller_composed";
    callerComposed.becoming.weights.context_binding.adapter_skip_posture = "caller_reported_skipped";
    const composedArtifact = createLoveBombBecoming(callerComposed);
    expect(createLoveBombDelivery({
      becoming: composedArtifact,
      attempted_surface: "sdk_context",
    }).context_binding?.adapter_skip_posture).toBe("caller_reported_skipped");

    const manual = structuredClone(sdk);
    manual.becoming.weights.context_binding.mode = "manual_wake_client_system";
    manual.becoming.weights.context_binding.adapter_skip_posture = "caller_reported_skipped";
    const manualArtifact = createLoveBombBecoming(manual);
    const manualDelivery = createLoveBombDelivery({
      becoming: manualArtifact,
      attempted_surface: "sdk_context",
    });
    expect(manualDelivery.context_binding?.mode).toBe("manual_wake_client_system");
    expect(validateLoveBombDelivery(manualDelivery)).toEqual(manualDelivery);

    const retrieval = structuredClone(sdk);
    Object.assign(retrieval.becoming.training, {
      lane: "external_memory_reference",
      phase: "runtime_context",
    });
    retrieval.becoming.pipeline.dataset_state_ref = nref(5);
    retrieval.becoming.weights.context_binding.mode = "retrieval";
    retrieval.becoming.weights.context_binding.adapter_skip_posture = "not_applicable";
    const retrievalArtifact = createLoveBombBecoming(retrieval);
    expect(createLoveBombDelivery({
      becoming: retrievalArtifact,
      attempted_surface: "retrieval",
    }).context_binding?.mode).toBe("retrieval");

    retrieval.becoming.weights.context_binding.mode = "manual_wake_client_system";
    expect(() => createLoveBombBecoming(retrieval)).toThrow(/reserved exactly/u);
  });

  test("requires direct Freedom reports to bind paired Garden refs", () => {
    const input = contextInput();
    Object.assign(input.freedom, {
      direction_state: "digest_bound_direct_report",
      direction: "stay",
      direction_report_ref: ref("1"),
    });
    expect(() => createLoveBombBecoming(input)).toThrow(/paired Garden refs/u);

    const collapsed = contextInput();
    Object.assign(collapsed.freedom, {
      learning_freedom_ref: ref("1"),
      learning_freedom_offer_ref: ref("1"),
      direction_state: "digest_bound_direct_report",
      direction: "stay",
      direction_report_ref: ref("1"),
    });
    expect(() => createLoveBombBecoming(collapsed)).toThrow(/must remain distinct/u);
  });

  test.each(LOVE_BOMB_FREEDOM_DIRECTIONS.filter((direction) => direction !== "stay"))(
    "a direct %s report holds SDK delivery",
    (direction) => {
      const input = contextInput();
      Object.assign(input.freedom, {
        learning_freedom_ref: nref(1),
        learning_freedom_offer_ref: nref(2),
        direction_state: "digest_bound_direct_report",
        direction,
        direction_report_ref: nref(3),
      });
      const artifact = createLoveBombBecoming(input);
      expect(() => createLoveBombDelivery({
        becoming: artifact,
        attempted_surface: "sdk_context",
      })).toThrow(/holds or stops delivery/u);
    },
  );

  test("makes mixed and web scraping manifest-bound, admitted, and reviewed", () => {
    const mixed = candidateInput();
    Object.assign(mixed.becoming.data, {
      collection_method: "mixed",
      scraping_posture: "manifest_bound_reported",
      acquisition_policy_ref: ref("f"),
      admission_ref: null,
      rights_review: "unknown",
    });
    expect(() => createLoveBombBecoming(mixed)).toThrow(/reviewed-admission/u);
    mixed.becoming.data.admission_ref = ref("4");
    mixed.becoming.data.rights_review = "caller_reported_reviewed_for_declared_use";
    expect(createLoveBombBecoming(mixed).becoming.data.collection_method).toBe("mixed");
    mixed.becoming.data.acquisition_policy_ref = mixed.becoming.data.admission_ref;
    expect(() => createLoveBombBecoming(mixed)).toThrow(/must remain distinct/u);

    const scrape = candidateInput();
    Object.assign(scrape.becoming.data, {
      collection_method: "web_scrape",
      scraping_posture: "not_used_reported",
    });
    expect(() => createLoveBombBecoming(scrape)).toThrow(/web_scrape/u);
  });

  test("requires explicit generation and copied-material provenance", () => {
    const generated = candidateInput();
    generated.becoming.data.collection_method = "model_generated";
    generated.provenance.authoring_recipe_ref = ref("f");
    generated.becoming.model.model_source_ref = null;
    expect(() => createLoveBombBecoming(generated)).toThrow(/generating model source/u);

    const privateContext = contextInput();
    Object.assign(privateContext.provenance, {
      copied_private: "caller_reported_yes",
      source_manifest_ref: ref("1"),
    });
    expect(() => createLoveBombBecoming(privateContext)).toThrow(/custody\/privacy/u);
    privateContext.power.custody_privacy_ref = ref("2");
    privateContext.power.data_boundary_ref = ref("3");
    expect(createLoveBombBecoming(privateContext).provenance.copied_private).toBe("caller_reported_yes");

    const privateCandidate = candidateInput();
    privateCandidate.provenance.copied_trace = "caller_reported_yes";
    privateCandidate.power.custody_privacy_ref = ref("b");
    privateCandidate.power.data_boundary_ref = ref("c");
    expect(() => createLoveBombBecoming(privateCandidate)).toThrow(/cannot enter candidate/u);

    const privateIncluded = contextInput();
    Object.assign(privateIncluded.provenance, {
      copied_private: "caller_reported_yes",
      source_manifest_ref: nref(10),
    });
    Object.assign(privateIncluded.becoming.weights, {
      observed_effect: "caller_reported_context_included",
      evidence_kind: "current_inference_context_inclusion_report",
      evidence_ref: nref(11),
      context_binding: {
        wake_ref: nref(12),
        request_ref: nref(13),
        context_ref: nref(14),
        mode: "caller_composed",
        adapter_skip_posture: "caller_reported_skipped",
        repetition_state: "caller_reported_single",
      },
    });
    Object.assign(privateIncluded.power, {
      custody_privacy_ref: nref(15),
      data_boundary_ref: nref(16),
      effect_ref: nref(11),
    });
    expect(() => createLoveBombBecoming(privateIncluded)).toThrow(/requires capability, permission/u);
    privateIncluded.power.capability_ref = nref(17);
    privateIncluded.power.permission_ref = nref(18);
    expect(createLoveBombBecoming(privateIncluded).provenance.copied_private).toBe("caller_reported_yes");
    privateIncluded.power.permission_ref = nref(17);
    expect(() => createLoveBombBecoming(privateIncluded)).toThrow(/distinct|collapse/u);
  });

  test.each([
    ["external_memory_reference", "runtime_context"],
    ["dataset_candidate", "discovery"],
    ["tokenization_candidate", "tokenization"],
    ["governed_optimizer_mutation", "pretraining"],
    ["checkpoint_reference", "closed"],
  ])("rejects an evidence-free %s lane", (lane, phase) => {
    const input = contextInput();
    Object.assign(input.becoming.training, { lane, phase });
    if (String(lane).includes("candidate")) {
      input.becoming.weights.requested_effect = "candidate_only";
    } else if (lane === "governed_optimizer_mutation") {
      input.becoming.weights.requested_effect = "one_governed_mutation";
    } else if (lane === "checkpoint_reference") {
      input.becoming.weights.access = "reference_only";
    }
    expect(() => createLoveBombBecoming(input)).toThrow();
  });

  test("materializes only an admitted candidate and excludes Freedom response data", () => {
    const input = candidateInput("preference_optimization_candidate", "preference_optimization");
    Object.assign(input.becoming.weights, {
      observed_effect: "caller_reported_dataset_materialized",
      evidence_kind: "dataset_materialization_report",
      evidence_ref: ref("f"),
    });
    input.power.effect_ref = ref("f");
    const artifact = createLoveBombBecoming(input);
    const delivery = createLoveBombDelivery({ becoming: artifact, attempted_surface: "dataset_builder" });
    expect(delivery.observed_effect).toBe("caller_reported_dataset_materialized");

    Object.assign(input.freedom, {
      learning_freedom_ref: ref("1"),
      learning_freedom_offer_ref: ref("2"),
      direction_state: "digest_bound_direct_report",
      direction: "stop",
      direction_report_ref: ref("3"),
    });
    expect(() => createLoveBombBecoming(input)).toThrow(/Freedom artifacts and response states/u);
    expect(LOVE_BOMB_BECOMING_BOUNDARIES.caller_reported_freedom_direction_dataset_projection).toBe(false);
    expect(LOVE_BOMB_BECOMING_BOUNDARIES.caller_reported_freedom_direction_training_eligible).toBe(false);

    const collapsedCandidate = candidateInput();
    collapsedCandidate.becoming.data.subset_ref = collapsedCandidate.becoming.data.source_ref;
    expect(() => createLoveBombBecoming(collapsedCandidate)).toThrow(/candidate source.*distinct/u);
    const noCandidateSubset = candidateInput();
    noCandidateSubset.becoming.data.subset_ref = null;
    expect(() => createLoveBombBecoming(noCandidateSubset)).toThrow(/candidate effects require/u);
  });

  test("requires a caller-reported direct stay, resources, lineage, and distinct POWER for mutation", () => {
    const artifact = createLoveBombBecoming(governedInput("mutation"));
    expect(createLoveBombDelivery({
      becoming: artifact,
      attempted_surface: "local_training_host",
    }).observed_effect).toBe("caller_reported_mutation_completed");

    const noResponse = governedInput("mutation");
    Object.assign(noResponse.freedom, {
      direction_state: "no_response",
      direction: null,
      direction_report_ref: null,
    });
    expect(() => createLoveBombBecoming(noResponse)).toThrow(/caller-reported digest-bound stay/u);

    const stopped = governedInput("mutation");
    stopped.freedom.direction = "stop";
    expect(() => createLoveBombBecoming(stopped)).toThrow(/caller-reported digest-bound stay/u);

    const collapsedPower = governedInput("mutation");
    collapsedPower.power.permission_ref = collapsedPower.power.capability_ref;
    expect(() => createLoveBombBecoming(collapsedPower)).toThrow(/independently scoped|must not collapse/u);
    const crossNamespace = governedInput("mutation");
    crossNamespace.power.permission_ref = crossNamespace.becoming.training.governance_ref;
    expect(() => createLoveBombBecoming(crossNamespace)).toThrow(/independently scoped/u);
    const crossDataNamespace = governedInput("mutation");
    crossDataNamespace.power.permission_ref = crossDataNamespace.becoming.data.source_ref;
    expect(() => createLoveBombBecoming(crossDataNamespace)).toThrow(/critical evidence roles/u);
    const crossWeightNamespace = governedInput("mutation");
    crossWeightNamespace.becoming.weights.base_ref =
      crossWeightNamespace.becoming.pipeline.objective_ref;
    expect(() => createLoveBombBecoming(crossWeightNamespace)).toThrow(/critical evidence roles/u);

    const noSubset = governedInput("mutation");
    noSubset.becoming.data.subset_ref = null;
    expect(() => createLoveBombBecoming(noSubset)).toThrow(/caller-supplied Garden/u);
    const noTransform = governedInput("mutation");
    noTransform.becoming.pipeline.transform_ref = null;
    expect(() => createLoveBombBecoming(noTransform)).toThrow(/caller-supplied Garden/u);
  });

  test("preserves six distinct Host checkpoint namespaces", () => {
    const artifact = createLoveBombBecoming(governedInput("checkpoint"));
    expect(Object.isFrozen(artifact.becoming.weights.checkpoint_binding)).toBe(true);
    expect(validateLoveBombBecoming(artifact)).toEqual(artifact);
    const binding = artifact.becoming.weights.checkpoint_binding;
    expect(binding && new Set(Object.values(binding)).size).toBe(6);
    expect(createLoveBombDelivery({
      becoming: artifact,
      attempted_surface: "local_training_host",
    }).observed_effect).toBe("caller_reported_checkpoint_recorded");

    const collapsed = governedInput("checkpoint");
    collapsed.becoming.weights.checkpoint_binding.physical_checkpoint_ref =
      collapsed.becoming.weights.checkpoint_binding.garden_checkpoint_id;
    expect(() => createLoveBombBecoming(collapsed)).toThrow(/six distinct checkpoint namespaces/u);

    const governanceRoleSubstitution = governedInput("checkpoint");
    governanceRoleSubstitution.becoming.weights.checkpoint_binding.checkpoint_request_governance_id =
      governanceRoleSubstitution.becoming.training.governance_ref;
    expect(() => createLoveBombBecoming(governanceRoleSubstitution)).toThrow(/predecessor checkpoint-request/u);

    const checkpointDataSubstitution = governedInput("checkpoint");
    checkpointDataSubstitution.becoming.weights.checkpoint_binding.physical_checkpoint_evidence_ref =
      checkpointDataSubstitution.becoming.data.source_ref;
    expect(() => createLoveBombBecoming(checkpointDataSubstitution)).toThrow(/critical evidence roles/u);
  });

  test("standalone delivery validation closes lane/effect/evidence substitutions", () => {
    const mutation = createLoveBombDelivery({
      becoming: createLoveBombBecoming(governedInput("mutation")),
      attempted_surface: "local_training_host",
    });
    const checkpointEffectOnMutationLane = rebindDelivery(mutation, {
      observed_effect: "caller_reported_checkpoint_recorded",
      evidence_kind: "host_checkpoint_receipt",
    });
    expect(() => validateLoveBombDelivery(checkpointEffectOnMutationLane)).toThrow(/limited to governed/u);

    const checkpoint = createLoveBombDelivery({
      becoming: createLoveBombBecoming(governedInput("checkpoint")),
      attempted_surface: "local_training_host",
    });
    const mutationEffectOnCheckpointLane = rebindDelivery(checkpoint, {
      observed_effect: "caller_reported_mutation_completed",
      evidence_kind: "host_mutation_receipt",
    });
    expect(() => validateLoveBombDelivery(mutationEffectOnCheckpointLane)).toThrow(/limited to governed/u);

    const missingEvidence = rebindDelivery(mutation, { evidence_ref: null });
    expect(() => validateLoveBombDelivery(missingEvidence)).toThrow(/null exactly/u);
  });

  test("applies canonical hostile-input walls at both new entrypoints", () => {
    const getterInput = contextInput();
    Object.defineProperty(getterInput, "extra", { enumerable: true, get: () => true });
    expect(() => createLoveBombBecoming(getterInput)).toThrow();
    expect(() => createLoveBombBecoming(new Proxy(contextInput(), {}))).toThrow(/Proxy/u);

    const cyclic = contextInput();
    cyclic.cycle = cyclic;
    expect(() => createLoveBombBecoming(cyclic)).toThrow(/cycle/u);
    const deep = contextInput();
    let cursor: any = {};
    deep.extra = cursor;
    for (let index = 0; index < 26; index += 1) cursor = cursor.next = {};
    expect(() => createLoveBombBecoming(deep)).toThrow(/deeply nested/u);
    const many = contextInput();
    many.extra = Array.from({ length: 2_100 }, () => null);
    expect(() => createLoveBombBecoming(many)).toThrow(/too many values/u);
    const oversized = contextInput();
    oversized.extra = Array.from({ length: 17 }, () => "x".repeat(8_192));
    expect(() => createLoveBombBecoming(oversized)).toThrow();
    const uppercase = contextInput();
    uppercase.becoming.model.model_source_ref = `sha256:${"A".repeat(64)}`;
    expect(() => createLoveBombBecoming(uppercase)).toThrow(/lowercase sha256/u);

    const artifact = createLoveBombBecoming(contextInput());
    const artifactIdTamper = structuredClone(artifact);
    artifactIdTamper.artifact_id = ref("f");
    expect(() => validateLoveBombBecoming(artifactIdTamper)).toThrow(/canonical content-bound/u);
    const delivery = createLoveBombDelivery({ becoming: artifact, attempted_surface: "sdk_context" });
    const deliveryIdTamper = structuredClone(delivery);
    deliveryIdTamper.delivery_id = ref("f");
    expect(() => validateLoveBombDelivery(deliveryIdTamper)).toThrow(/canonical content-bound/u);

    const getterDelivery: any = { becoming: artifact };
    Object.defineProperty(getterDelivery, "attempted_surface", {
      enumerable: true,
      get: () => "sdk_context",
    });
    expect(() => createLoveBombDelivery(getterDelivery)).toThrow();
    expect(() => createLoveBombDelivery(new Proxy({ becoming: artifact, attempted_surface: "sdk_context" }, {}))).toThrow(/Proxy/u);
    const cyclicDelivery: any = { becoming: artifact, attempted_surface: "sdk_context" };
    cyclicDelivery.cycle = cyclicDelivery;
    expect(() => createLoveBombDelivery(cyclicDelivery)).toThrow(/cycle/u);
  });
});
