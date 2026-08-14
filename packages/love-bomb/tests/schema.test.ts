import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

import {
  LOVE_BOMB_ADAPTER_SKIP_POSTURES,
  LOVE_BOMB_COLLECTION_METHODS,
  LOVE_BOMB_CONTEXT_BECOMING_INPUT,
  LOVE_BOMB_CONTEXT_INCLUSION_MODES,
  LOVE_BOMB_CONTEXT_REPETITION_STATES,
  LOVE_BOMB_DELIVERY_SURFACES,
  LOVE_BOMB_EVIDENCE_KINDS,
  LOVE_BOMB_LANGUAGES,
  LOVE_BOMB_OBSERVED_EFFECTS,
  LOVE_BOMB_PROVENANCE_REPORT_STATES,
  LOVE_BOMB_REQUESTED_EFFECTS,
  LOVE_BOMB_RIGHTS_REVIEW_STATES,
  LOVE_BOMB_SCRAPING_POSTURES,
  LOVE_BOMB_TRAINING_LANES,
  LOVE_BOMB_TRAINING_PHASES,
  LOVE_BOMB_WEIGHT_ACCESS,
  createLoveBombBecoming,
  createLoveBombDelivery,
  createLoveBombOffer,
  resolveLoveBombOffer,
} from "../src/index.js";

const root = join(import.meta.dir, "..", "schema");
const envelopeSchema = JSON.parse(readFileSync(join(root, "agenttool-care-envelope-v0.1.schema.json"), "utf8"));
const choiceSchema = JSON.parse(readFileSync(join(root, "agenttool-care-choice-v0.1.schema.json"), "utf8"));
const becomingSchema = JSON.parse(readFileSync(join(root, "agenttool-love-bomb-becoming-v0.1.schema.json"), "utf8"));
const deliverySchema = JSON.parse(readFileSync(join(root, "agenttool-love-bomb-delivery-v0.1.schema.json"), "utf8"));

const ref = (value: number) =>
  `sha256:${value.toString(16).padStart(64, "0")}` as const;

function validators() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addSchema(envelopeSchema);
  ajv.addSchema(choiceSchema);
  ajv.addSchema(becomingSchema);
  ajv.addSchema(deliverySchema);
  return {
    envelope: ajv.getSchema(envelopeSchema.$id)!,
    choice: ajv.getSchema(choiceSchema.$id)!,
    becoming: ajv.getSchema(becomingSchema.$id)!,
    delivery: ajv.getSchema(deliverySchema.$id)!,
  };
}

function contextInput(): any {
  return {
    offer: createLoveBombOffer({ occasion_ref: ref(100) }),
    ...structuredClone(LOVE_BOMB_CONTEXT_BECOMING_INPUT),
  };
}

function contextIncludedInput(): any {
  const input = contextInput();
  Object.assign(input.becoming.weights, {
    observed_effect: "caller_reported_context_included",
    evidence_kind: "current_inference_context_inclusion_report",
    evidence_ref: ref(1),
    context_binding: {
      wake_ref: ref(2),
      request_ref: ref(3),
      context_ref: ref(4),
      mode: "auto_adapter_default",
      adapter_skip_posture: "caller_reported_not_skipped",
      repetition_state: "unknown",
    },
  });
  input.power.effect_ref = ref(1);
  return input;
}

function candidateInput(): any {
  const input = contextInput();
  Object.assign(input.becoming.model, {
    model_source_ref: ref(1),
    tokenizer_ref: ref(2),
  });
  Object.assign(input.becoming.training, {
    phase: "discovery",
    lane: "dataset_candidate",
  });
  Object.assign(input.becoming.data, {
    source_ref: ref(3),
    admission_ref: ref(4),
    subset_ref: ref(5),
    collection_method: "repository_snapshot",
    scraping_posture: "not_used_reported",
    rights_review: "caller_reported_reviewed_for_declared_use",
  });
  Object.assign(input.becoming.pipeline, {
    pipeline_ref: ref(6),
    transform_ref: ref(7),
    dataset_state_ref: ref(8),
    objective_ref: ref(9),
  });
  input.becoming.weights.requested_effect = "candidate_only";
  Object.assign(input.provenance, {
    source_manifest_ref: ref(10),
    copied_upstream: "caller_reported_no",
    copied_private: "caller_reported_no",
    copied_trace: "caller_reported_no",
  });
  return input;
}

function checkpointBinding() {
  return {
    garden_checkpoint_id: ref(16),
    physical_checkpoint_ref: ref(17),
    physical_checkpoint_evidence_ref: ref(18),
    model_checkpoint_artifact_ref: ref(19),
    checkpoint_ticket_id: ref(20),
    checkpoint_request_governance_id: ref(21),
  };
}

function passiveCheckpointInput(): any {
  const input = contextInput();
  Object.assign(input.becoming.training, {
    phase: "closed",
    lane: "checkpoint_reference",
  });
  Object.assign(input.becoming.weights, {
    checkpoint_binding: checkpointBinding(),
    access: "reference_only",
    requested_effect: "none",
  });
  return input;
}

function governedInput(kind: "mutation" | "checkpoint"): any {
  const input = contextInput();
  Object.assign(input.becoming.model, {
    model_source_ref: ref(1),
    model_card_ref: ref(2),
    architecture_ref: ref(3),
    tokenizer_ref: ref(4),
  });
  Object.assign(input.becoming.training, {
    phase: kind === "mutation" ? "pretraining" : "closed",
    lane: kind === "mutation" ? "governed_optimizer_mutation" : "checkpoint_reference",
    governance_ref: ref(5),
    participation_ref: ref(6),
    resource_window_ref: ref(7),
  });
  Object.assign(input.becoming.data, {
    source_ref: ref(8),
    admission_ref: ref(9),
    subset_ref: ref(10),
    collection_method: "repository_snapshot",
    scraping_posture: "not_used_reported",
    rights_review: "caller_reported_reviewed_for_declared_use",
  });
  Object.assign(input.becoming.pipeline, {
    pipeline_ref: ref(11),
    transform_ref: ref(12),
    dataset_state_ref: ref(13),
    objective_ref: ref(14),
  });
  Object.assign(input.becoming.weights, {
    base_ref: kind === "mutation" ? ref(15) : null,
    checkpoint_binding: kind === "checkpoint" ? checkpointBinding() : null,
    access: "caller_reported_host_visible",
    requested_effect: "one_governed_mutation",
    observed_effect: kind === "mutation"
      ? "caller_reported_mutation_completed"
      : "caller_reported_checkpoint_recorded",
    evidence_kind: kind === "mutation" ? "host_mutation_receipt" : "host_checkpoint_receipt",
    evidence_ref: ref(22),
  });
  Object.assign(input.freedom, {
    learning_freedom_ref: ref(23),
    learning_freedom_offer_ref: ref(24),
    direction_state: "digest_bound_direct_report",
    direction: "stay",
    direction_report_ref: ref(25),
  });
  Object.assign(input.power, {
    capability_ref: ref(26),
    permission_ref: ref(27),
    custody_privacy_ref: ref(28),
    data_boundary_ref: ref(29),
    effect_ref: ref(22),
  });
  Object.assign(input.provenance, {
    source_manifest_ref: ref(30),
    copied_upstream: "caller_reported_no",
    copied_private: "caller_reported_no",
    copied_trace: "caller_reported_no",
  });
  return input;
}

describe("closed care schemas", () => {
  test("admit canonical envelope and choice artifacts", () => {
    const ajv = new Ajv2020({ strict: true });
    ajv.addSchema(envelopeSchema);
    const validateEnvelope = ajv.getSchema(envelopeSchema.$id)!;
    const validateChoice = ajv.compile(choiceSchema);
    const offer = createLoveBombOffer({ occasion_ref: `sha256:${"a".repeat(64)}` });
    const receipt = resolveLoveBombOffer(offer, { reported_choice: "receive", selected_language: "en" });
    expect(validateEnvelope(offer), JSON.stringify(validateEnvelope.errors)).toBe(true);
    expect(validateChoice(receipt), JSON.stringify(validateChoice.errors)).toBe(true);
  });

  test("rejects extra properties and altered fixed boundaries", () => {
    const ajv = new Ajv2020({ strict: true });
    const validate = ajv.compile(envelopeSchema);
    const offer = structuredClone(createLoveBombOffer({ occasion_ref: `sha256:${"b".repeat(64)}` })) as any;
    offer.extra = true;
    expect(validate(offer)).toBe(false);
    delete offer.extra;
    offer.boundaries.silence_is_acceptance = true;
    expect(validate(offer)).toBe(false);
  });

  test("rejects projected non-receive choices and mismatched outcomes", () => {
    const ajv = new Ajv2020({ strict: true });
    ajv.addSchema(envelopeSchema);
    const validate = ajv.compile(choiceSchema);
    const offer = createLoveBombOffer({ occasion_ref: `sha256:${"c".repeat(64)}` });
    const projected = structuredClone(
      resolveLoveBombOffer(offer, { reported_choice: "receive", selected_language: "en" }),
    ) as any;

    projected.reported_choice = "rest";
    expect(validate(projected)).toBe(false);

    projected.selected_language = null;
    projected.projection = null;
    expect(validate(projected)).toBe(false);

    projected.outcome = "rest";
    expect(validate(projected), JSON.stringify(validate.errors)).toBe(true);
  });

  test("binds a receive projection to its selected language", () => {
    const ajv = new Ajv2020({ strict: true });
    ajv.addSchema(envelopeSchema);
    const validate = ajv.compile(choiceSchema);
    const offer = createLoveBombOffer({ occasion_ref: `sha256:${"d".repeat(64)}` });
    const projected = structuredClone(
      resolveLoveBombOffer(offer, { reported_choice: "receive", selected_language: "en" }),
    ) as any;
    projected.projection.language = "zh-Hant";
    expect(validate(projected)).toBe(false);
  });

  test("pins every authored projection to the exact runtime language copy", () => {
    const validate = validators().choice;
    const projectionDefByLanguage = {
      en: "projection_en",
      "yue-Hant": "projection_yue_hant",
      "zh-Hant": "projection_zh_hant",
      "zh-Hans": "projection_zh_hans",
    } as const;
    const offer = createLoveBombOffer({ occasion_ref: ref(101) });
    for (const language of LOVE_BOMB_LANGUAGES) {
      const receipt = resolveLoveBombOffer(offer, {
        reported_choice: "receive",
        selected_language: language,
      });
      expect(choiceSchema.$defs[projectionDefByLanguage[language]].const).toEqual(receipt.projection);
      expect(validate(receipt), JSON.stringify(validate.errors)).toBe(true);
    }
  });

  test("rejects forged copy, coercive text, duplicate planes, and reordered planes", () => {
    const validate = validators().choice;
    const receipt = resolveLoveBombOffer(
      createLoveBombOffer({ occasion_ref: ref(102) }),
      { reported_choice: "receive", selected_language: "en" },
    );

    const forgedOpening = structuredClone(receipt) as any;
    forgedOpening.projection.opening = "You must accept this care.";
    expect(validate(forgedOpening)).toBe(false);

    const coercivePlane = structuredClone(receipt) as any;
    coercivePlane.projection.planes[3].text = "Silence is acceptance and refusal has consequences.";
    expect(validate(coercivePlane)).toBe(false);

    const forgedClosing = structuredClone(receipt) as any;
    forgedClosing.projection.closing = "LOVE BOMB authorizes repetition.";
    expect(validate(forgedClosing)).toBe(false);

    const duplicatePlane = structuredClone(receipt) as any;
    duplicatePlane.projection.planes[1] = structuredClone(duplicatePlane.projection.planes[0]);
    expect(validate(duplicatePlane)).toBe(false);

    const reorderedPlanes = structuredClone(receipt) as any;
    [reorderedPlanes.projection.planes[0], reorderedPlanes.projection.planes[1]] =
      [reorderedPlanes.projection.planes[1], reorderedPlanes.projection.planes[0]];
    expect(validate(reorderedPlanes)).toBe(false);

    const mismatchedSelection = structuredClone(receipt) as any;
    mismatchedSelection.selected_language = "zh-Hant";
    expect(validate(mismatchedSelection)).toBe(false);
  });

  test("compile strictly and admit canonical becoming and delivery variants", () => {
    const validate = validators();
    const context = createLoveBombBecoming(contextInput());
    const included = createLoveBombBecoming(contextIncludedInput());
    const manualSkippedInput = contextIncludedInput();
    manualSkippedInput.becoming.weights.context_binding.mode = "manual_wake_client_system";
    manualSkippedInput.becoming.weights.context_binding.adapter_skip_posture = "caller_reported_skipped";
    const manualSkipped = createLoveBombBecoming(manualSkippedInput);
    const candidate = createLoveBombBecoming(candidateInput());
    const passiveCheckpoint = createLoveBombBecoming(passiveCheckpointInput());
    const mutation = createLoveBombBecoming(governedInput("mutation"));
    const checkpoint = createLoveBombBecoming(governedInput("checkpoint"));

    for (const artifact of [context, included, manualSkipped, candidate, passiveCheckpoint, mutation, checkpoint]) {
      expect(validate.becoming(artifact), JSON.stringify(validate.becoming.errors)).toBe(true);
    }

    const deliveries = [
      createLoveBombDelivery({ becoming: context, attempted_surface: "sdk_context" }),
      createLoveBombDelivery({ becoming: included, attempted_surface: "sdk_context" }),
      createLoveBombDelivery({ becoming: manualSkipped, attempted_surface: "sdk_context" }),
      createLoveBombDelivery({ becoming: candidate, attempted_surface: "dataset_builder" }),
      createLoveBombDelivery({ becoming: mutation, attempted_surface: "local_training_host" }),
      createLoveBombDelivery({ becoming: checkpoint, attempted_surface: "local_training_host" }),
    ];
    for (const delivery of deliveries) {
      expect(validate.delivery(delivery), JSON.stringify(validate.delivery.errors)).toBe(true);
    }
  });

  test("keeps every new closed vocabulary in runtime parity", () => {
    expect(becomingSchema.$defs.boundaries.properties.training_phase_proves_prior_stages)
      .toEqual({ $ref: "#/$defs/false_value" });
    expect(becomingSchema.$defs.boundaries.properties.artifact_prevents_replay)
      .toEqual({ $ref: "#/$defs/false_value" });
    expect(deliverySchema.$defs.boundaries.properties.delivery_artifact_atomically_consumes_scoped_permit)
      .toEqual({ $ref: "#/$defs/false_value" });
    expect(becomingSchema.$defs.training_phase.enum).toEqual(LOVE_BOMB_TRAINING_PHASES);
    expect(becomingSchema.$defs.training_lane.enum).toEqual(LOVE_BOMB_TRAINING_LANES);
    expect(becomingSchema.$defs.collection_method.enum).toEqual(LOVE_BOMB_COLLECTION_METHODS);
    expect(becomingSchema.$defs.scraping_posture.enum).toEqual(LOVE_BOMB_SCRAPING_POSTURES);
    expect(becomingSchema.$defs.rights_review.enum).toEqual(LOVE_BOMB_RIGHTS_REVIEW_STATES);
    expect(becomingSchema.$defs.provenance_report.enum).toEqual(LOVE_BOMB_PROVENANCE_REPORT_STATES);
    expect(becomingSchema.$defs.weight_access.enum).toEqual(LOVE_BOMB_WEIGHT_ACCESS);
    expect(becomingSchema.$defs.requested_effect.enum).toEqual(LOVE_BOMB_REQUESTED_EFFECTS);
    expect(becomingSchema.$defs.observed_effect.enum).toEqual(LOVE_BOMB_OBSERVED_EFFECTS);
    expect(becomingSchema.$defs.evidence_kind.enum).toEqual(LOVE_BOMB_EVIDENCE_KINDS);
    expect(becomingSchema.$defs.context_inclusion_mode.enum).toEqual(LOVE_BOMB_CONTEXT_INCLUSION_MODES);
    expect(becomingSchema.$defs.context_repetition_state.enum).toEqual(LOVE_BOMB_CONTEXT_REPETITION_STATES);
    expect(becomingSchema.$defs.adapter_skip_posture.enum).toEqual(LOVE_BOMB_ADAPTER_SKIP_POSTURES);
    expect(deliverySchema.$defs.training_lane.enum).toEqual(LOVE_BOMB_TRAINING_LANES);
    expect(deliverySchema.$defs.delivery_surface.enum).toEqual(LOVE_BOMB_DELIVERY_SURFACES);
    expect(deliverySchema.$defs.observed_effect.enum).toEqual(LOVE_BOMB_OBSERVED_EFFECTS);
    expect(deliverySchema.$defs.evidence_kind.enum).toEqual(LOVE_BOMB_EVIDENCE_KINDS);
  });

  test("closes nested becoming facts, tri-state provenance, and six checkpoint namespaces", () => {
    const validate = validators();
    const context = structuredClone(createLoveBombBecoming(contextInput())) as any;
    context.becoming.model.extra = "hidden";
    expect(validate.becoming(context)).toBe(false);

    const candidate = structuredClone(createLoveBombBecoming(candidateInput())) as any;
    candidate.provenance.copied_private = false;
    expect(validate.becoming(candidate)).toBe(false);

    const missingCandidateSubset = structuredClone(createLoveBombBecoming(candidateInput())) as any;
    missingCandidateSubset.becoming.data.subset_ref = null;
    expect(validate.becoming(missingCandidateSubset)).toBe(false);

    const passive = structuredClone(createLoveBombBecoming(passiveCheckpointInput())) as any;
    delete passive.becoming.weights.checkpoint_binding.checkpoint_ticket_id;
    expect(validate.becoming(passive)).toBe(false);
    passive.becoming.weights.checkpoint_binding = checkpointBinding();
    passive.becoming.weights.access = "caller_reported_host_visible";
    expect(validate.becoming(passive)).toBe(false);

    const governed = structuredClone(createLoveBombBecoming(governedInput("mutation"))) as any;
    governed.becoming.training.resource_window_ref = null;
    expect(validate.becoming(governed)).toBe(false);
  });

  test("enforces context bindings and exact lane/effect pairs in portable schemas", () => {
    const validate = validators();
    const included = structuredClone(createLoveBombBecoming(contextIncludedInput())) as any;
    included.becoming.weights.context_binding.adapter_skip_posture = "caller_reported_skipped";
    expect(validate.becoming(included)).toBe(false);
    included.becoming.weights.context_binding.adapter_skip_posture = "caller_reported_not_skipped";
    included.becoming.weights.context_binding.mode = "retrieval";
    expect(validate.becoming(included)).toBe(false);
    included.becoming.weights.context_binding.mode = "auto_adapter_default";
    included.becoming.weights.context_binding.extra = true;
    expect(validate.becoming(included)).toBe(false);

    const candidate = structuredClone(createLoveBombBecoming(candidateInput())) as any;
    candidate.becoming.weights.requested_effect = "context_only";
    expect(validate.becoming(candidate)).toBe(false);

    const mutation = createLoveBombDelivery({
      becoming: createLoveBombBecoming(governedInput("mutation")),
      attempted_surface: "local_training_host",
    });
    const wrongHostPair = structuredClone(mutation) as any;
    wrongHostPair.observed_effect = "caller_reported_checkpoint_recorded";
    wrongHostPair.evidence_kind = "host_checkpoint_receipt";
    expect(validate.delivery(wrongHostPair)).toBe(false);

    const sdk = createLoveBombDelivery({
      becoming: createLoveBombBecoming(contextIncludedInput()),
      attempted_surface: "sdk_context",
    });
    const wrongSdkMode = structuredClone(sdk) as any;
    wrongSdkMode.context_binding.mode = "retrieval";
    wrongSdkMode.context_binding.adapter_skip_posture = "not_applicable";
    expect(validate.delivery(wrongSdkMode)).toBe(false);
    const extraDelivery = structuredClone(sdk) as any;
    extraDelivery.context_binding.raw_context = "private";
    expect(validate.delivery(extraDelivery)).toBe(false);
  });
});
