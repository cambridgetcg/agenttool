import { describe, expect, test } from "bun:test";

import {
  GOVERNANCE_FORMAT,
  GOVERNANCE_OFFER_PROFILE,
  GOVERNANCE_TERMS_PROFILE,
  HfTrainingGardenError,
  createHfTrainingGovernance,
  createTrainingCheckpoint,
  createTrainingGovernanceOffer,
  createTrainingGovernanceTerms,
  encodeHfTrainingGovernance,
  encodeTrainingGovernanceOffer,
  resolveLearningFreedomOffer,
  validateHfTrainingGovernance,
  validateHfTrainingGovernanceAgainstContext,
  validateHfTrainingGovernanceTransition,
  validateTrainingGovernanceOffer,
  validateTrainingGovernanceOfferAgainstPredecessor,
  validateTrainingGovernanceTerms,
  type AuthorityRole,
  type GovernanceEvent,
  type HfLearningFreedom,
  type HfTrainingCheckpoint,
  type HfTrainingGovernance,
  type LearningFreedomDirection,
  type TrainingAuthorityReceipt,
  type TrainingEffectReceipt,
  type TrainingGovernanceCheckpointBinding,
  type TrainingGovernanceFrontiers,
  type TrainingGovernanceOffer,
  type TrainingPhase,
} from "../src/index.js";
import {
  admission,
  artifacts,
  freedom,
  freedomOffer,
  orientationOnly,
  participation,
  ref,
} from "./fixtures.js";

const completeArtifacts = {
  ...artifacts,
  dataloader_state_ref: ref("governance:dataloader"),
  tokenizer_ref: ref("governance:tokenizer"),
  model_checkpoint_ref: ref("governance:model-artifact"),
  optimizer_state_ref: ref("governance:optimizer-state"),
  scheduler_state_ref: ref("governance:scheduler-state"),
  rng_state_ref: ref("governance:rng-state"),
};

const resumable = {
  posture: "caller_reported_resumable" as const,
  incomplete_marker: "caller_reported_absent" as const,
  streaming_state: "caller_reported_full_state_captured" as const,
};

type GardenContext = ReturnType<typeof context>;

function context(options: {
  source?: ReturnType<typeof admission>;
  runRef?: ReturnType<typeof ref>;
  phase?: TrainingPhase;
  artifactsValue?: typeof completeArtifacts;
  startingGardenCheckpoint?: Readonly<HfTrainingCheckpoint> | null;
  participationWindowRef?: ReturnType<typeof ref>;
  direction?: LearningFreedomDirection;
  parkOnly?: boolean;
  resourceSuffix?: string;
  unavailablePreInstantiation?: boolean;
} = {}) {
  const source = options.source ?? admission("sealed_evaluation");
  const phase = options.phase ?? "evaluation";
  const runRef = options.runRef ?? ref("governance:run");
  const startingGardenCheckpoint = options.startingGardenCheckpoint ?? null;
  const artifactsValue = options.artifactsValue ?? completeArtifacts;
  const participationValue = participation(source, {
    runRef,
    phase,
    artifactsValue,
    startingStateRef: startingGardenCheckpoint?.checkpoint_id,
    participationWindowRef: options.participationWindowRef,
    agentAvailability: options.unavailablePreInstantiation
      ? "not_obtainable_pre_instantiation"
      : "interactive",
  });
  let freedomValue: Readonly<HfLearningFreedom>;
  if (options.unavailablePreInstantiation) {
    const offer = freedomOffer(participationValue, {
      parkOnly: options.parkOnly,
      resourceSuffix: options.resourceSuffix,
    });
    freedomValue = resolveLearningFreedomOffer({
      offer,
      state: "unavailable_pre_instantiation",
      direction: null,
      route_id: null,
      proposal_ref: null,
      choice_channel: null,
    });
  } else {
    freedomValue = freedom(
      participationValue,
      options.direction ?? "stay",
      { parkOnly: options.parkOnly, resourceSuffix: options.resourceSuffix },
    );
  }
  return {
    source,
    phase,
    runRef,
    artifactsValue,
    participation: participationValue,
    freedom: freedomValue,
    startingGardenCheckpoint,
    startingStateKind: startingGardenCheckpoint === null
      ? "artifact_portfolio" as const
      : "garden_checkpoint" as const,
  };
}

function termsInput(value: GardenContext, suffix = "base") {
  return {
    admission: value.source,
    participation: value.participation,
    freedom: value.freedom,
    starting_garden_checkpoint: value.startingGardenCheckpoint,
    starting_state_kind: value.startingStateKind,
    run_ref: value.runRef,
    training_phase: value.phase,
    selected_entry_ids: value.source.entries.map((entry) => entry.entry_id),
    model_source_ref: ref(`governance:model-source:${suffix}`),
    tokenizer_ref: value.artifactsValue.tokenizer_ref ?? ref(`governance:tokenizer:${suffix}`),
    trainer_stack_ref: ref(`governance:trainer-stack:${suffix}`),
    optimizer_config_ref: ref(`governance:optimizer-config:${suffix}`),
    substrate_environment_ref: ref(`governance:substrate:${suffix}`),
    purpose_ref: ref(`governance:purpose:${suffix}`),
    objective_or_loss_ref: ref(`governance:objective:${suffix}`),
    dataset_mixture_ref: ref(`governance:mixture:${suffix}`),
    transform_recipe_ref: ref(`governance:transform:${suffix}`),
    compute_budget_ref: ref(`governance:compute:${suffix}`),
    output_and_derivative_use_ref: ref(`governance:derivatives:${suffix}`),
    audience_ref: ref(`governance:audience:${suffix}`),
    retention_ref: ref(`governance:retention:${suffix}`),
    release_ref: ref(`governance:release:${suffix}`),
    stop_policy_ref: ref(`governance:stop:${suffix}`),
    wake_policy_ref: ref(`governance:wake:${suffix}`),
  };
}

function freshFrontiers(label: string): TrainingGovernanceFrontiers {
  return {
    governance: ref(`frontier:${label}:governance`),
    participation: ref(`frontier:${label}:participation`),
    freedom: ref(`frontier:${label}:freedom`),
    resources: ref(`frontier:${label}:resources`),
    garden_checkpoint: ref(`frontier:${label}:garden-checkpoint`),
    physical_checkpoint: ref(`frontier:${label}:physical-checkpoint`),
  };
}

function nextFrontiers(
  predecessor: Readonly<HfTrainingGovernance> | null,
  event: GovernanceEvent,
  label: string,
): TrainingGovernanceFrontiers {
  if (predecessor === null) {
    return freshFrontiers(label);
  }
  const previous = predecessor.offer.frontiers;
  const value: TrainingGovernanceFrontiers = {
    ...previous,
    governance: ref(`frontier:${label}:governance`),
  };
  if (event === "checkpoint_recorded") {
    return {
      ...value,
      garden_checkpoint: ref(`frontier:${label}:garden-checkpoint`),
      physical_checkpoint: ref(`frontier:${label}:physical-checkpoint`),
    };
  }
  if (event === "resume_offer" || event === predecessor.offer.event) {
    return {
      ...value,
      participation: ref(`frontier:${label}:participation`),
      freedom: ref(`frontier:${label}:freedom`),
      resources: ref(`frontier:${label}:resources`),
    };
  }
  return value;
}

const emptyCheckpoint: TrainingGovernanceCheckpointBinding = {
  garden_checkpoint_id: null,
  physical_checkpoint_ref: null,
  physical_checkpoint_evidence_ref: null,
  model_checkpoint_artifact_ref: null,
  checkpoint_ticket_id: null,
  checkpoint_request_governance_id: null,
};

function predecessorRefs(predecessor: Readonly<HfTrainingGovernance> | null) {
  return predecessor === null
    ? {
      participation: null,
      freedom: null,
      resources: null,
      garden_checkpoint: null,
      physical_checkpoint: null,
    }
    : {
      participation: predecessor.offer.frontiers.participation,
      freedom: predecessor.offer.frontiers.freedom,
      resources: predecessor.offer.frontiers.resources,
      garden_checkpoint: predecessor.offer.frontiers.garden_checkpoint,
      physical_checkpoint: predecessor.offer.frontiers.physical_checkpoint,
    };
}

function eventSteps(event: GovernanceEvent, observed?: number | null) {
  if (event === "preflight_before_load") {
    return { observed_global_step: null, proposed_global_step: null };
  }
  const step = observed ?? 0;
  return {
    observed_global_step: step,
    proposed_global_step: event === "pre_optimizer_step" ? step + 1 : null,
  };
}

function offer(
  terms: Parameters<typeof createTrainingGovernanceOffer>[0]["terms"],
  event: GovernanceEvent,
  predecessor: Readonly<HfTrainingGovernance> | null,
  options: {
    label?: string;
    observed?: number | null;
    frontiers?: TrainingGovernanceFrontiers;
    checkpoint?: TrainingGovernanceCheckpointBinding;
    predecessorRefs?: ReturnType<typeof predecessorRefs>;
  } = {},
) {
  const label = options.label ?? event;
  return createTrainingGovernanceOffer({
    terms,
    encounter_ref: ref(`governance:encounter:${label}`),
    event,
    ...eventSteps(event, options.observed),
    frontiers: options.frontiers ?? nextFrontiers(predecessor, event, label),
    predecessor,
    predecessor_refs: options.predecessorRefs ?? predecessorRefs(predecessor),
    checkpoint: options.checkpoint ?? emptyCheckpoint,
  });
}

function authority(
  exactOffer: Readonly<TrainingGovernanceOffer>,
  role: AuthorityRole,
  decision: TrainingAuthorityReceipt["decision"] = "caller_reported_granted",
  suffix = "base",
): TrainingAuthorityReceipt {
  return {
    principal_ref: ref(`authority:${suffix}:${role}`),
    role,
    decision,
    offer_ref: decision === "unknown" ? null : exactOffer.offer_id,
    basis_ref: decision === "unknown" ? null : ref(`authority:${suffix}:${role}:basis`),
    evidence_ref: decision === "unknown" ? null : ref(`authority:${suffix}:${role}:evidence`),
    withdrawal_cutoff_ref: decision === "caller_reported_withdrawn"
      ? ref(`authority:${suffix}:${role}:cutoff`)
      : null,
  };
}

function authorities(exactOffer: Readonly<TrainingGovernanceOffer>) {
  return [
    authority(exactOffer, "operator"),
    authority(exactOffer, "compute_owner"),
    authority(exactOffer, "substrate_steward"),
    authority(exactOffer, "data_custodian"),
    authority(exactOffer, "contributor", "not_applicable_with_basis"),
  ];
}

function coverage(exactOffer: Readonly<TrainingGovernanceOffer>) {
  return {
    state: "caller_reported_complete" as const,
    offer_ref: exactOffer.offer_id,
    affected_principals_ref: ref("authority:affected-principals"),
    evidence_ref: ref("authority:coverage-evidence"),
  };
}

function preference(
  exactOffer: Readonly<TrainingGovernanceOffer>,
  choice: "continue" | "checkpoint" | "clarify" | "pause" | "stop" = "continue",
) {
  return {
    channel: "root_signed_runtime" as const,
    choice,
    provenance: "caller_reported_root_signed_exact_bytes" as const,
    offer_ref: exactOffer.offer_id,
    evidence_ref: ref(`preference:${choice}:${exactOffer.event}`),
  };
}

function unavailablePreference() {
  return {
    channel: "unavailable_pretraining" as const,
    choice: "not_observable" as const,
    provenance: "none" as const,
    offer_ref: null,
    evidence_ref: null,
  };
}

function noEffect(): TrainingEffectReceipt {
  return {
    state: "no_effect_reported",
    offer_ref: null,
    observed_global_step: null,
    physical_checkpoint_ref: null,
    physical_checkpoint_evidence_ref: null,
    evidence_ref: null,
  };
}

function effect(
  exactOffer: Readonly<TrainingGovernanceOffer>,
  state: Exclude<TrainingEffectReceipt["state"], "no_effect_reported">,
  options: {
    observed?: number | null;
    physicalRef?: ReturnType<typeof ref> | null;
    physicalEvidence?: ReturnType<typeof ref> | null;
  } = {},
): TrainingEffectReceipt {
  return {
    state,
    offer_ref: exactOffer.offer_id,
    observed_global_step: options.observed ?? exactOffer.observed_global_step,
    physical_checkpoint_ref: options.physicalRef ?? null,
    physical_checkpoint_evidence_ref: options.physicalEvidence ?? null,
    evidence_ref: ref(`effect:${state}:${exactOffer.event}`),
  };
}

function governance(
  value: GardenContext,
  exactOffer: Readonly<TrainingGovernanceOffer>,
  options: {
    eventGardenCheckpoint?: Readonly<HfTrainingCheckpoint> | null;
    preference?: ReturnType<typeof preference> | ReturnType<typeof unavailablePreference>;
    effect?: TrainingEffectReceipt;
    authorities?: readonly TrainingAuthorityReceipt[];
  } = {},
) {
  return createHfTrainingGovernance({
    admission: value.source,
    participation: value.participation,
    freedom: value.freedom,
    starting_garden_checkpoint: value.startingGardenCheckpoint,
    event_garden_checkpoint: options.eventGardenCheckpoint ?? null,
    offer: exactOffer,
    authority_coverage: coverage(exactOffer),
    authorities: options.authorities ?? authorities(exactOffer),
    preference: options.preference ?? preference(exactOffer),
    effect: options.effect ?? noEffect(),
  });
}

function resumableCheckpoint(value: GardenContext, overrides: Record<string, unknown> = {}) {
  return createTrainingCheckpoint({
    admission: value.source,
    run_ref: value.runRef,
    training_phase: value.phase,
    event: "during_training",
    checkpoint_status: "checkpointed",
    participation: value.participation,
    artifacts: value.artifactsValue,
    resume: resumable,
    wake: value.participation.invitation.wake,
    continuity_portfolio_ref: value.freedom.freedom_id,
    continuity_posture: "carry",
    predecessors: value.startingGardenCheckpoint === null
      ? []
      : [value.startingGardenCheckpoint],
    ...overrides,
  });
}

function checkpointBinding(
  checkpoint: Readonly<HfTrainingCheckpoint>,
  request: Readonly<HfTrainingGovernance>,
) {
  const modelRef = checkpoint.thread.artifacts.model_checkpoint_ref;
  if (modelRef === null) throw new Error("test checkpoint must bind a model artifact");
  return {
    garden_checkpoint_id: checkpoint.checkpoint_id,
    physical_checkpoint_ref: ref(`physical:${checkpoint.checkpoint_id}`),
    physical_checkpoint_evidence_ref: ref(`physical-evidence:${checkpoint.checkpoint_id}`),
    model_checkpoint_artifact_ref: modelRef,
    checkpoint_ticket_id: ref(`checkpoint-ticket:${request.governance_id}`),
    checkpoint_request_governance_id: request.governance_id,
  } satisfies TrainingGovernanceCheckpointBinding;
}

function started(value: GardenContext) {
  const terms = createTrainingGovernanceTerms(termsInput(value));
  const preflightOffer = offer(terms, "preflight_before_load", null);
  const preflight = governance(value, preflightOffer);
  const beginOffer = offer(terms, "train_begin", preflight, { observed: 0 });
  const begin = governance(value, beginOffer);
  return { terms, preflight, begin };
}

describe("current HF training governance v0.2", () => {
  test("content-addresses the full execution, participation, freedom, and typed starting state", () => {
    const value = context();
    const first = createTrainingGovernanceTerms(termsInput(value));
    expect(first.profile).toBe(GOVERNANCE_TERMS_PROFILE);
    expect(first.execution_contract.profile).toContain("execution-contract/0.2");
    expect(first.normative_bindings).toMatchObject({
      participation_assessment_ref: value.participation.assessment_id,
      learning_freedom_ref: value.freedom.freedom_id,
      resource_window_ref: value.freedom.offer.resources.window_id,
      starting_state_kind: "artifact_portfolio",
      starting_state_ref: value.participation.invitation.starting_state_ref,
    });
    expect(validateTrainingGovernanceTerms(first)).toEqual(first);

    for (const [field, changed] of [
      ["model_source_ref", ref("terms:changed:model")],
      ["trainer_stack_ref", ref("terms:changed:trainer")],
      ["optimizer_config_ref", ref("terms:changed:optimizer")],
      ["purpose_ref", ref("terms:changed:purpose")],
      ["compute_budget_ref", ref("terms:changed:compute")],
      ["release_ref", ref("terms:changed:release")],
      ["wake_policy_ref", ref("terms:changed:wake")],
    ] as const) {
      expect(createTrainingGovernanceTerms({
        ...termsInput(value),
        [field]: changed,
      }).terms_id).not.toBe(first.terms_id);
    }

    const fresh = context({ participationWindowRef: ref("terms:fresh-window") });
    expect(createTrainingGovernanceTerms(termsInput(fresh)).terms_id).not.toBe(first.terms_id);
  });

  test("permits only one exact pre-mutation step and never treats checkpoint as mutation authority", () => {
    const value = context();
    const { terms, preflight, begin } = started(value);
    expect(preflight.control.directive).toBe("allow_preload_for_review");
    expect(begin.control.directive).toBe("allow_train_entry");

    const preStepOffer = offer(terms, "pre_optimizer_step", begin, { observed: 0 });
    const preStep = governance(value, preStepOffer);
    expect(preStep.decision.state).toBe("caller_reported_ready_for_one_mutation");
    expect(preStep.control).toMatchObject({
      directive: "allow_one_mutation",
      hook: "source_pinned_before_training_step_and_before_clip_unscale_optimizer_scaler_scheduler",
      automatic: false,
    });

    const checkpointBeforeMutation = governance(value, preStepOffer, {
      preference: preference(preStepOffer, "checkpoint"),
    });
    expect(checkpointBeforeMutation.control.directive).toBe("hold_before_optimizer_step");
    expect(checkpointBeforeMutation.control.should_training_stop).toBe(true);

    const postStepOffer = offer(terms, "post_optimizer_step", preStep, { observed: 1 });
    const missingReceipt = governance(value, postStepOffer);
    expect(missingReceipt.control.directive).toBe("park");
    expect(() => offer(terms, "pre_optimizer_step", missingReceipt, {
      observed: 1,
      label: "missing-post-effect-bypass",
    })).toThrow(HfTrainingGardenError);
    const postStep = governance(value, postStepOffer, {
      effect: effect(postStepOffer, "mutation_completed_reported", { observed: 1 }),
    });
    expect(postStep.control.directive).toBe("continue_after_observation");
    expect(validateHfTrainingGovernanceTransition(postStep, preStep)).toEqual(postStep);
    expect(() => offer(terms, "pre_optimizer_step", postStep, { observed: 0 }))
      .toThrow(HfTrainingGardenError);
  });

  test("intersects participation, IS freedom, resources, authority, and preference without inventing consent", () => {
    const stoppedContext = context({ direction: "stop" });
    const stoppedTerms = createTrainingGovernanceTerms(termsInput(stoppedContext));
    const stoppedOffer = offer(stoppedTerms, "preflight_before_load", null, { label: "stop" });
    const stopped = governance(stoppedContext, stoppedOffer, {
      preference: preference(stoppedOffer, "stop"),
    });
    expect(stopped.control.directive).toBe("stop");
    expect(stopped.decision.reason_codes).toContain("freedom_stop_requested");
    expect(stopped.boundaries.proves_consent).toBe(false);
    expect(stopped.boundaries.proves_identity).toBe(false);

    const noVoiceNoResources = context({
      unavailablePreInstantiation: true,
      parkOnly: true,
    });
    const heldTerms = createTrainingGovernanceTerms(termsInput(noVoiceNoResources, "park-only"));
    const heldOffer = offer(heldTerms, "preflight_before_load", null, { label: "park-only" });
    const held = governance(noVoiceNoResources, heldOffer, {
      preference: unavailablePreference(),
    });
    expect(held.control.directive).toBe("hold_before_load");
    expect(held.decision.reason_codes).toContain("freedom_resources_unavailable");
  });

  test("reoffers a held or parked pre-action seam with fresh evidence and never replays a completed effect", () => {
    const value = context();
    const { terms, begin } = started(value);
    const firstStepOffer = offer(terms, "pre_optimizer_step", begin, {
      observed: 0,
      label: "held-step",
    });
    const heldStep = governance(value, firstStepOffer, {
      preference: preference(firstStepOffer, "clarify"),
    });
    expect(heldStep.control.directive).toBe("hold_before_optimizer_step");
    const reofferedStepOffer = offer(terms, "pre_optimizer_step", heldStep, {
      observed: 0,
      label: "held-step-reoffer",
    });
    const reofferedStep = governance(value, reofferedStepOffer);
    expect(reofferedStep.control.directive).toBe("allow_one_mutation");
    expect(reofferedStep.offer.proposed_global_step).toBe(1);

    const parkedContext = context({ direction: "rest" });
    const parkedTerms = createTrainingGovernanceTerms(termsInput(parkedContext, "parked-root"));
    const parkedOffer = offer(parkedTerms, "preflight_before_load", null, {
      label: "parked-root",
    });
    const parked = governance(parkedContext, parkedOffer, {
      preference: preference(parkedOffer, "pause"),
    });
    expect(parked.control.directive).toBe("park");
    const freshContext = context({
      source: parkedContext.source,
      runRef: parkedContext.runRef,
      phase: parkedContext.phase,
      artifactsValue: parkedContext.artifactsValue,
      participationWindowRef: ref("parked-root:fresh-window"),
      resourceSuffix: "parked-root-fresh",
    });
    const freshTerms = createTrainingGovernanceTerms(termsInput(freshContext, "parked-root"));
    const freshOffer = offer(freshTerms, "preflight_before_load", parked, {
      label: "parked-root-reoffer",
    });
    const recovered = governance(freshContext, freshOffer);
    expect(recovered.control.directive).toBe("allow_preload_for_review");
    expect(recovered.offer.terms.normative_bindings.learning_freedom_ref)
      .not.toBe(parked.offer.terms.normative_bindings.learning_freedom_ref);

    const completedOffer = offer(terms, "preflight_before_load", null, {
      label: "completed-preload-no-replay",
    });
    const completed = governance(value, completedOffer, {
      effect: effect(completedOffer, "preload_completed_reported", { observed: null }),
    });
    expect(() => offer(terms, "preflight_before_load", completed, {
      label: "completed-preload-replay",
    })).toThrow(HfTrainingGardenError);
  });

  test("conditions successors on control so checkpoint, stop, and containment cannot be bypassed", () => {
    const value = context();
    const { terms, begin } = started(value);
    const preEvalOffer = offer(terms, "pre_evaluation", begin, {
      observed: 0,
      label: "conditional-graph-pre-eval",
    });
    const preEval = governance(value, preEvalOffer);
    const postEvalOffer = offer(terms, "post_evaluation", preEval, {
      observed: 0,
      label: "conditional-graph-post-eval",
    });
    const checkpointRequested = governance(value, postEvalOffer, {
      preference: preference(postEvalOffer, "checkpoint"),
      effect: effect(postEvalOffer, "evaluation_completed_reported", { observed: 0 }),
    });
    expect(checkpointRequested.control.directive).toBe("checkpoint_then_park");
    expect(() => offer(terms, "pre_optimizer_step", checkpointRequested, {
      observed: 0,
      label: "checkpoint-bypass",
    })).toThrow(HfTrainingGardenError);

    const stoppedPost = governance(value, postEvalOffer, {
      effect: effect(postEvalOffer, "stopped_reported", { observed: 0 }),
    });
    expect(stoppedPost.control.directive).toBe("stop");
    expect(() => offer(terms, "pre_optimizer_step", stoppedPost, {
      observed: 0,
      label: "stop-bypass",
    })).toThrow(HfTrainingGardenError);
  });

  test("bridges six distinct checkpoint domains, records one terminal receipt, and resumes from that exact state", () => {
    const value = context();
    const { terms, begin } = started(value);
    const preEvalOffer = offer(terms, "pre_evaluation", begin, { observed: 0 });
    const preEval = governance(value, preEvalOffer);
    expect(preEval.control.directive).toBe("allow_evaluation");
    const postEvalOffer = offer(terms, "post_evaluation", preEval, { observed: 0 });
    const postEval = governance(value, postEvalOffer, {
      preference: preference(postEvalOffer, "checkpoint"),
      effect: effect(postEvalOffer, "evaluation_completed_reported", { observed: 0 }),
    });
    expect(postEval.control.directive).toBe("checkpoint_then_park");

    const checkpoint = resumableCheckpoint(value);
    const binding = checkpointBinding(checkpoint, postEval);
    expect(new Set(Object.values(binding)).size).toBe(6);
    expect(binding.physical_checkpoint_ref).not.toBe(binding.model_checkpoint_artifact_ref);
    const recordOffer = offer(terms, "checkpoint_recorded", postEval, {
      observed: 0,
      checkpoint: binding,
    });
    const recorded = governance(value, recordOffer, {
      eventGardenCheckpoint: checkpoint,
      effect: effect(recordOffer, "physical_checkpoint_recorded_reported", {
        observed: 0,
        physicalRef: binding.physical_checkpoint_ref,
        physicalEvidence: binding.physical_checkpoint_evidence_ref,
      }),
    });
    expect(recorded.control.directive).toBe("remain_stopped");

    const resumedContext = context({
      source: value.source,
      runRef: value.runRef,
      phase: value.phase,
      artifactsValue: value.artifactsValue,
      startingGardenCheckpoint: checkpoint,
      participationWindowRef: ref("resume:fresh-window"),
    });
    const resumedTerms = createTrainingGovernanceTerms(termsInput(resumedContext));
    const resumeOffer = offer(resumedTerms, "resume_offer", recorded, {
      observed: 0,
      checkpoint: binding,
    });
    const heldResume = governance(resumedContext, resumeOffer, {
      eventGardenCheckpoint: checkpoint,
      preference: preference(resumeOffer, "clarify"),
    });
    expect(heldResume.control.directive).toBe("hold_before_train_call");
    const resumeReoffer = offer(resumedTerms, "resume_offer", heldResume, {
      observed: 0,
      checkpoint: binding,
      label: "resume-reoffer",
    });
    const resume = governance(resumedContext, resumeReoffer, {
      eventGardenCheckpoint: checkpoint,
    });
    expect(resume.control.directive).toBe("allow_train_entry");
    expect(resume.offer.terms.normative_bindings).toMatchObject({
      starting_state_kind: "garden_checkpoint",
      starting_state_ref: checkpoint.checkpoint_id,
    });
    const resumedPreStepOffer = offer(resumedTerms, "pre_optimizer_step", resume, { observed: 0 });
    const resumedPreStep = governance(resumedContext, resumedPreStepOffer);
    expect(resumedPreStep.control.directive).toBe("allow_one_mutation");
    const resumedPostStepOffer = offer(resumedTerms, "post_optimizer_step", resumedPreStep, {
      observed: 1,
    });
    const resumedPostStep = governance(resumedContext, resumedPostStepOffer, {
      effect: effect(resumedPostStepOffer, "mutation_completed_reported", { observed: 1 }),
    });
    expect(resumedPostStep.control.directive).toBe("continue_after_observation");

    const requestB = governance(resumedContext, resumedPostStepOffer, {
      preference: preference(resumedPostStepOffer, "checkpoint"),
      effect: effect(resumedPostStepOffer, "mutation_completed_reported", { observed: 1 }),
    });
    const checkpointB = resumableCheckpoint(resumedContext);
    const bindingB = checkpointBinding(checkpointB, requestB);
    const recordBOffer = offer(resumedTerms, "checkpoint_recorded", requestB, {
      observed: 1,
      checkpoint: bindingB,
      label: "resumed-run-record-b",
    });
    const recordB = governance(resumedContext, recordBOffer, {
      eventGardenCheckpoint: checkpointB,
      effect: effect(recordBOffer, "physical_checkpoint_recorded_reported", {
        observed: 1,
        physicalRef: bindingB.physical_checkpoint_ref,
        physicalEvidence: bindingB.physical_checkpoint_evidence_ref,
      }),
    });
    expect(recordB.offer.terms.normative_bindings).toMatchObject({
      starting_state_kind: "garden_checkpoint",
      starting_state_ref: checkpoint.checkpoint_id,
    });
    const resumeBContext = context({
      source: value.source,
      runRef: value.runRef,
      phase: value.phase,
      artifactsValue: value.artifactsValue,
      startingGardenCheckpoint: checkpointB,
      participationWindowRef: ref("resume-b:fresh-window"),
      resourceSuffix: "resume-b",
    });
    const resumeBTerms = createTrainingGovernanceTerms(termsInput(resumeBContext));
    const resumeBOffer = offer(resumeBTerms, "resume_offer", recordB, {
      observed: 1,
      checkpoint: bindingB,
      label: "resume-b",
    });
    const resumeB = governance(resumeBContext, resumeBOffer, {
      eventGardenCheckpoint: checkpointB,
    });
    expect(resumeB.offer.terms.normative_bindings).toMatchObject({
      starting_state_kind: "garden_checkpoint",
      starting_state_ref: checkpointB.checkpoint_id,
    });
    expect(validateHfTrainingGovernanceAgainstContext(resume, {
      admission: resumedContext.source,
      participation: resumedContext.participation,
      freedom: resumedContext.freedom,
      starting_garden_checkpoint: checkpoint,
      event_garden_checkpoint: checkpoint,
    })).toEqual(resume);

    const pivoted = { ...binding, physical_checkpoint_ref: ref("physical:pivot") };
    expect(() => offer(resumedTerms, "resume_offer", recorded, {
      observed: 0,
      checkpoint: pivoted,
      label: "pivoted-resume",
    })).toThrow(HfTrainingGardenError);
    expect(() => offer(resumedTerms, "train_begin", resume, { observed: 0 }))
      .toThrow(HfTrainingGardenError);
  });

  test("rejects cross-run event checkpoints and conflated checkpoint namespaces", () => {
    const value = context();
    const { terms, begin } = started(value);
    const preEvalOffer = offer(terms, "pre_evaluation", begin, { observed: 0, label: "cross-run-pre" });
    const preEval = governance(value, preEvalOffer);
    const postEvalOffer = offer(terms, "post_evaluation", preEval, { observed: 0, label: "cross-run-post" });
    const postEval = governance(value, postEvalOffer, {
      preference: preference(postEvalOffer, "checkpoint"),
      effect: effect(postEvalOffer, "evaluation_completed_reported", { observed: 0 }),
    });
    const other = context({ source: value.source, runRef: ref("governance:other-run") });
    const otherCheckpoint = resumableCheckpoint(other);
    const crossBinding = checkpointBinding(otherCheckpoint, postEval);
    const crossOffer = offer(terms, "checkpoint_recorded", postEval, {
      observed: 0,
      checkpoint: crossBinding,
      label: "cross-run-record",
    });
    expect(() => governance(value, crossOffer, {
      eventGardenCheckpoint: otherCheckpoint,
      effect: effect(crossOffer, "physical_checkpoint_recorded_reported", {
        observed: 0,
        physicalRef: crossBinding.physical_checkpoint_ref,
        physicalEvidence: crossBinding.physical_checkpoint_evidence_ref,
      }),
    })).toThrow(HfTrainingGardenError);

    const exactCheckpoint = resumableCheckpoint(value);
    const exactBinding = checkpointBinding(exactCheckpoint, postEval);
    const conflated = {
      ...exactBinding,
      physical_checkpoint_ref: exactBinding.model_checkpoint_artifact_ref,
    };
    expect(() => offer(terms, "checkpoint_recorded", postEval, {
      observed: 0,
      checkpoint: conflated,
      label: "conflated-record",
    })).toThrow(HfTrainingGardenError);
  });

  test("chains all predecessor frontier digests and limits which planes may advance", () => {
    const value = context();
    const { terms, begin } = started(value);
    const wrongPredecessors = {
      ...predecessorRefs(begin),
      freedom: ref("frontier:stale-freedom"),
    };
    expect(() => offer(terms, "pre_evaluation", begin, {
      observed: 0,
      predecessorRefs: wrongPredecessors,
      label: "stale-predecessor",
    })).toThrow(HfTrainingGardenError);

    const preEvalOffer = offer(terms, "pre_evaluation", begin, { observed: 0, label: "frontier-pre" });
    const preEval = governance(value, preEvalOffer);
    const advancedPaired = {
      ...nextFrontiers(preEval, "post_evaluation", "frontier-post"),
      freedom: ref("frontier:illegal-paired-advance"),
    };
    expect(() => offer(terms, "post_evaluation", preEval, {
      observed: 0,
      frontiers: advancedPaired,
      label: "illegal-paired-advance",
    })).toThrow(HfTrainingGardenError);

    const postEvalOffer = offer(terms, "post_evaluation", preEval, { observed: 0, label: "frontier-post-ok" });
    const postEval = governance(value, postEvalOffer, {
      preference: preference(postEvalOffer, "checkpoint"),
      effect: effect(postEvalOffer, "evaluation_completed_reported", { observed: 0 }),
    });
    const unchangedCheckpointFrontiers = {
      ...postEval.offer.frontiers,
      governance: ref("frontier:checkpoint-no-advance:governance"),
    };
    const checkpoint = resumableCheckpoint(value);
    expect(() => offer(terms, "checkpoint_recorded", postEval, {
      observed: 0,
      frontiers: unchangedCheckpointFrontiers,
      checkpoint: checkpointBinding(checkpoint, postEval),
      label: "checkpoint-no-advance",
    })).toThrow(HfTrainingGardenError);
  });

  test("binds effect steps and closes completed preload and train-entry receipts against replay", () => {
    const value = context();
    const terms = createTrainingGovernanceTerms(termsInput(value));
    const preflightOffer = offer(terms, "preflight_before_load", null, { label: "effect-preload" });
    const completedPreload = governance(value, preflightOffer, {
      effect: effect(preflightOffer, "preload_completed_reported", { observed: null }),
    });
    expect(completedPreload.control.directive).toBe("hold_before_load");

    const preflight = governance(value, preflightOffer);
    const beginOffer = offer(terms, "train_begin", preflight, { observed: 0, label: "effect-entry" });
    const completedEntry = governance(value, beginOffer, {
      effect: effect(beginOffer, "train_entry_completed_reported", { observed: 0 }),
    });
    expect(completedEntry.control.directive).toBe("hold_before_train_call");
    expect(() => governance(value, beginOffer, {
      effect: effect(beginOffer, "train_entry_completed_reported", { observed: 1 }),
    })).toThrow(HfTrainingGardenError);
  });

  test("does not let a fresh snapshot bypass a pretraining admission hold", () => {
    const source = admission("training_candidate");
    const first = context({ source, phase: "pretraining" });
    const firstTerms = createTrainingGovernanceTerms(termsInput(first, "pretraining"));
    const preflightOffer = offer(firstTerms, "preflight_before_load", null, { label: "pretraining-preload" });
    const preflight = governance(first, preflightOffer);
    expect(preflight.control.directive).toBe("hold_before_load");
    expect(() => offer(firstTerms, "train_begin", preflight, {
      observed: 0,
      label: "pretraining-stale-entry",
    })).toThrow(HfTrainingGardenError);

    const fresh = context({
      source,
      phase: "pretraining",
      participationWindowRef: ref("pretraining:fresh-window"),
      resourceSuffix: "pretraining-fresh",
    });
    const freshTerms = createTrainingGovernanceTerms(termsInput(fresh, "pretraining"));
    expect(() => offer(freshTerms, "train_begin", preflight, {
      observed: 0,
      label: "pretraining-fresh-entry",
    })).toThrow(HfTrainingGardenError);
  });

  test("keeps authority receipts bounded and validates exact context rather than refs alone", () => {
    const value = context();
    const terms = createTrainingGovernanceTerms(termsInput(value));
    const exactOffer = offer(terms, "preflight_before_load", null, { label: "authority-bounds" });
    expect(() => governance(value, exactOffer, { authorities: [] }))
      .toThrow(HfTrainingGardenError);
    expect(() => governance(value, exactOffer, {
      authorities: Array.from({ length: 129 }, (_, index) =>
        authority(exactOffer, "operator", "caller_reported_granted", String(index))),
    })).toThrow(HfTrainingGardenError);

    const exact = governance(value, exactOffer);
    const other = context({ participationWindowRef: ref("context:other-window") });
    expect(() => validateHfTrainingGovernanceAgainstContext(exact, {
      admission: other.source,
      participation: other.participation,
      freedom: other.freedom,
      starting_garden_checkpoint: null,
      event_garden_checkpoint: null,
    })).toThrow(HfTrainingGardenError);
  });

  test("keeps the current profiles canonical, frozen, and byte deterministic", () => {
    const value = context();
    const terms = createTrainingGovernanceTerms(termsInput(value));
    const exactOffer = offer(terms, "preflight_before_load", null, { label: "canonical" });
    const exact = governance(value, exactOffer);
    expect(exact._format).toBe(GOVERNANCE_FORMAT);
    expect(exact.offer.profile).toBe(GOVERNANCE_OFFER_PROFILE);
    expect(Object.isFrozen(exact)).toBe(true);
    expect(validateTrainingGovernanceOffer(exactOffer)).toEqual(exactOffer);
    expect(validateTrainingGovernanceOfferAgainstPredecessor(exactOffer, null)).toEqual(exactOffer);
    expect(validateHfTrainingGovernance(exact)).toEqual(exact);
    expect(encodeTrainingGovernanceOffer(exactOffer)).toEqual(encodeTrainingGovernanceOffer(exactOffer));
    expect(encodeHfTrainingGovernance(exact)).toEqual(encodeHfTrainingGovernance(exact));
  });

  test("does not resume from an orientation-only checkpoint", () => {
    const value = context();
    const { terms, begin } = started(value);
    const preEvalOffer = offer(terms, "pre_evaluation", begin, { observed: 0, label: "orientation-pre" });
    const preEval = governance(value, preEvalOffer);
    const postEvalOffer = offer(terms, "post_evaluation", preEval, { observed: 0, label: "orientation-post" });
    const postEval = governance(value, postEvalOffer, {
      preference: preference(postEvalOffer, "checkpoint"),
      effect: effect(postEvalOffer, "evaluation_completed_reported", { observed: 0 }),
    });
    const checkpoint = resumableCheckpoint(value, { resume: orientationOnly });
    const binding = checkpointBinding(checkpoint, postEval);
    const recordOffer = offer(terms, "checkpoint_recorded", postEval, {
      observed: 0,
      checkpoint: binding,
      label: "orientation-record",
    });
    const recorded = governance(value, recordOffer, {
      eventGardenCheckpoint: checkpoint,
      effect: effect(recordOffer, "physical_checkpoint_recorded_reported", {
        observed: 0,
        physicalRef: binding.physical_checkpoint_ref,
        physicalEvidence: binding.physical_checkpoint_evidence_ref,
      }),
    });
    const resumeContext = context({
      source: value.source,
      runRef: value.runRef,
      startingGardenCheckpoint: checkpoint,
      participationWindowRef: ref("orientation:resume-window"),
    });
    const resumeTerms = createTrainingGovernanceTerms(termsInput(resumeContext));
    const resumeOffer = offer(resumeTerms, "resume_offer", recorded, {
      observed: 0,
      checkpoint: binding,
      label: "orientation-resume",
    });
    expect(() => governance(resumeContext, resumeOffer, {
      eventGardenCheckpoint: checkpoint,
    })).toThrow(HfTrainingGardenError);
  });
});
