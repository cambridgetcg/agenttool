import { describe, expect, test } from "bun:test";

import { domainSeparatedId } from "@agenttool/wake-continuity";

import {
  GOVERNANCE_FORMAT,
  GOVERNANCE_OFFER_PROFILE,
  GOVERNANCE_TERMS_PROFILE,
  HfTrainingGardenError,
  createDatasetAdmission,
  createHfTrainingGovernance,
  createTrainingGovernanceOffer,
  createTrainingGovernanceTerms,
  encodeHfTrainingGovernance,
  encodeTrainingGovernanceOffer,
  validateHfTrainingGovernance,
  validateHfTrainingGovernanceAgainstAdmission,
  validateHfTrainingGovernanceTransition,
  validateTrainingGovernanceOffer,
  validateTrainingGovernanceOfferAgainstPredecessor,
  validateTrainingGovernanceTerms,
  type AuthorityRole,
  type HfTrainingGovernance,
  type TrainingAuthorityReceipt,
  type TrainingGovernanceOffer,
  type TrainingPhase,
} from "../src/index.js";
import {
  admission,
  binding,
  fullAssessment,
  metadataAssessment,
  ref,
  wake,
} from "./fixtures.js";

function termsInput(
  source = admission("sealed_evaluation"),
  phase: TrainingPhase = "evaluation",
  suffix = "base",
) {
  return {
    admission: source,
    run_ref: ref(`governance:run:${suffix}`),
    training_phase: phase,
    selected_entry_ids: source.entries.map((entry) => entry.entry_id),
    model_or_checkpoint_ref: ref(`governance:model:${suffix}`),
    tokenizer_ref: ref(`governance:tokenizer:${suffix}`),
    trainer_stack_ref: ref(`governance:trainer-stack:${suffix}`),
    optimizer_config_ref: ref(`governance:optimizer:${suffix}`),
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

function offer(
  terms: Parameters<typeof createTrainingGovernanceOffer>[0]["terms"],
  overrides: Partial<Parameters<typeof createTrainingGovernanceOffer>[0]> = {},
) {
  return createTrainingGovernanceOffer({
    terms,
    encounter_ref: ref("governance:encounter:base"),
    observed_governance_frontier_ref: ref("governance:frontier:base"),
    rights_baseline_ref: ref("xenia:rights:0.1"),
    wake,
    event: "preflight_before_load",
    current_checkpoint_ref: null,
    predecessor: null,
    ...overrides,
  });
}

function authority(
  exactOffer: Readonly<TrainingGovernanceOffer>,
  role: AuthorityRole,
  decision: TrainingAuthorityReceipt["decision"] = "caller_reported_granted",
): TrainingAuthorityReceipt {
  return {
    principal_ref: ref(`governance:principal:${role}`),
    role,
    decision,
    offer_ref: decision === "unknown" ? null : exactOffer.offer_id,
    basis_ref: decision === "unknown" ? null : ref(`governance:basis:${role}:${decision}`),
    evidence_ref: decision === "unknown" ? null : ref(`governance:evidence:${role}:${decision}`),
    withdrawal_cutoff_ref: decision === "caller_reported_withdrawn"
      ? ref(`governance:cutoff:${role}`)
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
    affected_principals_ref: ref("governance:affected-principals"),
    evidence_ref: ref("governance:coverage-evidence"),
  };
}

function governanceInput(
  source: ReturnType<typeof admission>,
  exactOffer: Readonly<TrainingGovernanceOffer>,
  overrides: Record<string, unknown> = {},
) {
  return {
    admission: source,
    offer: exactOffer,
    authority_coverage: coverage(exactOffer),
    authorities: authorities(exactOffer),
    preference: {
      channel: "root_signed_runtime" as const,
      choice: "continue" as const,
      provenance: "caller_reported_root_signed_exact_bytes" as const,
      offer_ref: exactOffer.offer_id,
      evidence_ref: ref("governance:preference:continue"),
    },
    effect: {
      state: "no_effect_reported" as const,
      offer_ref: null,
      global_step: null,
      checkpoint_ref: null,
      evidence_ref: null,
    },
    ...overrides,
  };
}

function recontent<T extends Record<string, unknown>>(
  value: T,
  idKey: string,
  domain: string,
): T {
  const rebuilt = structuredClone(value);
  delete rebuilt[idKey];
  rebuilt[idKey] = domainSeparatedId(domain, rebuilt);
  return rebuilt;
}

function startedGovernance(
  source: ReturnType<typeof admission>,
  terms: Parameters<typeof createTrainingGovernanceOffer>[0]["terms"],
  suffix: string,
) {
  const preflight = createHfTrainingGovernance(
    governanceInput(source, offer(terms, {
      encounter_ref: ref(`governance:encounter:${suffix}:preflight`),
    })),
  );
  const startOffer = offer(terms, {
    encounter_ref: ref(`governance:encounter:${suffix}:train-begin`),
    event: "train_begin",
    predecessor: preflight,
  });
  return createHfTrainingGovernance(governanceInput(source, startOffer));
}

describe("consent-honest HF training governance", () => {
  test("content-addresses selected entries and every material target/stack term", () => {
    const source = admission("sealed_evaluation");
    const first = createTrainingGovernanceTerms(termsInput(source));
    for (const [field, changed] of [
      ["run_ref", ref("governance:run:changed")],
      ["model_or_checkpoint_ref", ref("governance:model:changed")],
      ["tokenizer_ref", ref("governance:tokenizer:changed")],
      ["trainer_stack_ref", ref("governance:trainer-stack:changed")],
      ["optimizer_config_ref", ref("governance:optimizer:changed")],
      ["substrate_environment_ref", ref("governance:substrate:changed")],
      ["purpose_ref", ref("governance:purpose:changed")],
      ["objective_or_loss_ref", ref("governance:objective:changed")],
      ["dataset_mixture_ref", ref("governance:mixture:changed")],
      ["transform_recipe_ref", ref("governance:transform:changed")],
      ["compute_budget_ref", ref("governance:compute:changed")],
      ["output_and_derivative_use_ref", ref("governance:derivatives:changed")],
      ["audience_ref", ref("governance:audience:changed")],
      ["retention_ref", ref("governance:retention:changed")],
      ["release_ref", ref("governance:release:changed")],
      ["stop_policy_ref", ref("governance:stop:changed")],
      ["wake_policy_ref", ref("governance:wake:changed")],
    ] as const) {
      const changedTerms = createTrainingGovernanceTerms({
        ...termsInput(source),
        [field]: changed,
      });
      expect(changedTerms.terms_id).not.toBe(first.terms_id);
    }
    const changedPhase = createTrainingGovernanceTerms({
      ...termsInput(source),
      training_phase: "interpretability",
    });
    expect(changedPhase.terms_id).not.toBe(first.terms_id);
    expect(first.admission_posture).toBe("eligible_for_phase");
    expect(first.selected_entry_ids).toEqual([source.entries[0]!.entry_id]);
    expect(validateTrainingGovernanceTerms(first)).toEqual(first);
  });

  test("requires every selected entry to be eligible for its declared phase", () => {
    const source = createDatasetAdmission({
      garden_scope_ref: ref("garden:mixed"),
      policy_ref: ref("policy:mixed"),
      entries: [
        {
          binding: binding("processbench"),
          role: "sealed_evaluation",
          candidate_slice_ref: ref("slice:eligible-eval"),
          transform_recipe_ref: ref("recipe:eligible-eval"),
          assessment: fullAssessment("sealed_evaluation"),
          posture: "consider",
        },
        {
          binding: binding("finemath"),
          role: "metadata_reference",
          candidate_slice_ref: null,
          transform_recipe_ref: null,
          assessment: metadataAssessment,
          posture: "consider",
        },
      ],
    });
    const eligibleId = source.entries.find((entry) => entry.role === "sealed_evaluation")!.entry_id;
    const eligible = createTrainingGovernanceTerms({
      ...termsInput(source),
      selected_entry_ids: [eligibleId],
    });
    const held = createTrainingGovernanceTerms(termsInput(source));
    const heldReordered = createTrainingGovernanceTerms({
      ...termsInput(source),
      selected_entry_ids: [...source.entries].reverse().map((entry) => entry.entry_id),
    });
    expect(eligible.admission_posture).toBe("eligible_for_phase");
    expect(held.admission_posture).toBe("held_for_phase");
    expect(eligible.terms_id).not.toBe(held.terms_id);
    expect(heldReordered).toEqual(held);
    const noncanonicalWire = structuredClone(held) as any;
    noncanonicalWire.selected_entry_ids.reverse();
    expect(() => validateTrainingGovernanceTerms(noncanonicalWire))
      .toThrow(HfTrainingGardenError);
    expect(() => createTrainingGovernanceTerms({
      ...termsInput(source),
      selected_entry_ids: [ref("entry:not-in-admission")],
    })).toThrow(HfTrainingGardenError);
    expect(() => createTrainingGovernanceTerms({
      ...termsInput(source),
      selected_entry_ids: [eligibleId, eligibleId],
    })).toThrow(HfTrainingGardenError);
  });

  test("keeps pretraining held when no training corpus is admitted and expression is unavailable", () => {
    const source = admission("metadata_reference");
    const terms = createTrainingGovernanceTerms({
      ...termsInput(source, "evaluation", "pretraining"),
      training_phase: "pretraining",
    });
    const exactOffer = offer(terms);
    const value = createHfTrainingGovernance(governanceInput(source, exactOffer, {
      preference: {
        channel: "unavailable_pretraining",
        choice: "not_observable",
        provenance: "none",
        offer_ref: null,
        evidence_ref: null,
      },
    }));
    expect(terms.admission_posture).toBe("held_for_phase");
    expect(value.decision.state).toBe("held");
    expect(value.decision.reason_codes).toContain("admission_not_ready_for_phase");
    expect(value.decision.reason_codes).toContain("pretraining_expression_not_observable");
    expect(value.control.directive).toBe("hold_before_load");
    expect(value.preference.inner_consent).toBe("unknown_unprovable");
    expect(value.identity_claim).toBe("none");
    expect(value.boundaries.silence_is_consent).toBe(false);
    expect(value.boundaries.proves_consent).toBe(false);
    expect(value.boundaries.selected_entry_ids_bound).toBe(true);
    expect(value.boundaries.dataset_mixture_referent_verified).toBe(false);
    expect(value.boundaries.offer_referents_verified).toBe(false);
    expect(value.boundaries.enforces_host_control).toBe(false);
    expect(() => createHfTrainingGovernance(governanceInput(source, exactOffer)))
      .toThrow(HfTrainingGardenError);
  });

  test("fails closed for tokenization and every phase without an explicit admission lane", () => {
    const metadata = admission("metadata_reference");
    const excluded = createDatasetAdmission({
      garden_scope_ref: ref("garden:excluded-tokenization"),
      policy_ref: ref("policy:excluded-tokenization"),
      entries: [{
        binding: binding("processbench"),
        role: "metadata_reference",
        candidate_slice_ref: null,
        transform_recipe_ref: null,
        assessment: metadataAssessment,
        posture: "exclude",
      }],
    });
    for (const [source, suffix] of [
      [metadata, "metadata"],
      [excluded, "excluded"],
    ] as const) {
      const terms = createTrainingGovernanceTerms(
        termsInput(source, "tokenization", suffix),
      );
      expect(terms.admission_posture).toBe("held_for_phase");
      const value = createHfTrainingGovernance(governanceInput(source, offer(terms)));
      expect(value.decision.reason_codes).toContain("admission_not_ready_for_phase");
      expect(value.control).toMatchObject({
        directive: "hold_before_load",
        should_save: false,
        should_training_stop: false,
      });
    }
    for (const phase of [
      "discovery",
      "selection",
      "curation",
      "tokenization",
      "interpretability",
      "closed",
    ] as const) {
      const terms = createTrainingGovernanceTerms(
        termsInput(metadata, phase, `unsupported:${phase}`),
      );
      expect(terms.admission_posture).toBe("held_for_phase");
    }
  });

  test("binds a caller-reported runtime continuation to one exact offer without promoting it to consent", () => {
    const source = admission("sealed_evaluation");
    const terms = createTrainingGovernanceTerms(termsInput(source));
    const exactOffer = offer(terms);
    const value = createHfTrainingGovernance(governanceInput(source, exactOffer));
    expect(value.decision).toEqual({
      state: "caller_reported_ready_to_continue",
      reason_codes: ["caller_reported_continue_for_exact_offer"],
    });
    expect(value.control).toMatchObject({
      directive: "continue_under_exact_offer",
      automatic: false,
      should_save: false,
      should_training_stop: false,
    });
    expect(value.preference.legal_consent).toBe("not_proven");
    expect(validateTrainingGovernanceOffer(exactOffer)).toEqual(exactOffer);
    expect(Buffer.from(encodeTrainingGovernanceOffer(exactOffer)).toString("utf8"))
      .toContain(exactOffer.offer_id);
    expect(validateHfTrainingGovernance(value)).toEqual(value);
    expect(validateHfTrainingGovernanceAgainstAdmission(value, source)).toEqual(value);
    expect(Buffer.from(encodeHfTrainingGovernance(value)).toString("utf8"))
      .toContain(value.governance_id);
  });

  test("rejects evidence across offer changes and exposes the identical-offer replay boundary", () => {
    const source = admission("sealed_evaluation");
    const terms = createTrainingGovernanceTerms(termsInput(source));
    const firstOffer = offer(terms);
    const firstInput = governanceInput(source, firstOffer);
    const first = createHfTrainingGovernance(firstInput);
    const statelessReplay = createHfTrainingGovernance(firstInput);
    expect(statelessReplay).toEqual(first);
    expect(first.boundaries.encounter_freshness_verified).toBe(false);
    expect(first.boundaries.evidence_consumption_tracked).toBe(false);
    expect(first.boundaries.governance_frontier_completeness_verified).toBe(false);
    expect(first.boundaries.conflicting_siblings_reconciled).toBe(false);
    expect(first.boundaries.rollback_detected).toBe(false);
    for (const variant of [
      offer(terms, { encounter_ref: ref("governance:encounter:variant") }),
      offer(terms, {
        observed_governance_frontier_ref: ref("governance:frontier:variant"),
      }),
      offer(terms, { rights_baseline_ref: ref("xenia:rights:variant") }),
      offer(terms, {
        wake: { ...wake, snapshot_ref: ref("wake:variant-snapshot") },
      }),
      offer(terms, { event: "train_begin", predecessor: first }),
      offer(terms, { current_checkpoint_ref: ref("checkpoint:variant") }),
    ]) {
      expect(variant.offer_id).not.toBe(firstOffer.offer_id);
    }
    const changedOffer = offer(terms, {
      rights_baseline_ref: ref("xenia:rights:changed"),
      wake: {
        ...wake,
        snapshot_ref: ref("wake:changed-snapshot"),
      },
      event: "train_begin",
      current_checkpoint_ref: ref("checkpoint:current"),
      predecessor: first,
    });
    expect(changedOffer.offer_id).not.toBe(firstOffer.offer_id);
    expect(() => createHfTrainingGovernance({
      ...firstInput,
      offer: changedOffer,
    })).toThrow(HfTrainingGardenError);
    expect(() => createHfTrainingGovernance(governanceInput(source, changedOffer, {
      preference: firstInput.preference,
    }))).toThrow(HfTrainingGardenError);
    expect(() => createHfTrainingGovernance(governanceInput(source, changedOffer, {
      authority_coverage: firstInput.authority_coverage,
      authorities: firstInput.authorities,
    }))).toThrow(HfTrainingGardenError);
    expect(() => createHfTrainingGovernance(governanceInput(source, changedOffer, {
      effect: {
        state: "continued_reported",
        offer_ref: firstOffer.offer_id,
        global_step: 1,
        checkpoint_ref: null,
        evidence_ref: ref("governance:old-effect"),
      },
    }))).toThrow(HfTrainingGardenError);

    const refreshed = createHfTrainingGovernance(governanceInput(source, changedOffer));
    expect(refreshed.offer.predecessor_ref).toBe(first.governance_id);
    expect(refreshed.offer.current_checkpoint_ref).toBe(ref("checkpoint:current"));
  });

  test("requests a checkpoint only for an explicit authorized checkpoint choice", () => {
    const source = admission("sealed_evaluation");
    const terms = createTrainingGovernanceTerms(termsInput(source));
    const predecessor = startedGovernance(source, terms, "checkpoint-controls");
    for (const choice of ["checkpoint", "pause", "handoff", "refuse", "stop"] as const) {
      const exactOffer = offer(terms, {
        encounter_ref: ref(`governance:encounter:${choice}`),
        event: "step_boundary",
        predecessor,
      });
      const value = createHfTrainingGovernance(governanceInput(source, exactOffer, {
        preference: {
          channel: "out_of_band_unscored",
          choice,
          provenance: "caller_reported_isolated_runtime_output",
          offer_ref: exactOffer.offer_id,
          evidence_ref: ref(`governance:preference:${choice}`),
        },
      }));
      expect(value.decision.state).toBe("held");
      expect(value.decision.reason_codes).toContain(`preference_${choice}`);
      expect(value.control).toMatchObject({
        directive: choice === "checkpoint"
          ? "checkpoint_then_stop_at_safe_boundary"
          : "stop_at_safe_boundary_without_new_checkpoint",
        hook: "on_step_end_before_checkpoint_serialization",
        should_save: choice === "checkpoint",
        should_training_stop: true,
        automatic: false,
        mutates_forward_pass: false,
      });
      expect(value.preference.gradient_use).toBe(false);
      expect(value.preference.reward_effect).toBe(false);
      expect(value.boundaries.refusal_penalized).toBe(false);
      expect(value.boundaries.checkpoint_write_authority_inferred_from_hold).toBe(false);
      expect(value.boundaries.should_save_proves_checkpoint).toBe(false);
    }
    const deniedOffer = offer(terms, {
      encounter_ref: ref("governance:encounter:checkpoint-without-data-authority"),
      event: "step_boundary",
      predecessor,
    });
    const denied = createHfTrainingGovernance(governanceInput(source, deniedOffer, {
      authorities: authorities(deniedOffer).filter((receipt) =>
        receipt.role !== "data_custodian"
      ),
      preference: {
        channel: "out_of_band_unscored",
        choice: "checkpoint",
        provenance: "caller_reported_isolated_runtime_output",
        offer_ref: deniedOffer.offer_id,
        evidence_ref: ref("governance:preference:checkpoint-without-data-authority"),
      },
    }));
    expect(denied.decision.reason_codes).toContain("data_custodian_authority_missing");
    expect(denied.control).toMatchObject({
      directive: "stop_at_safe_boundary_without_new_checkpoint",
      should_save: false,
      should_training_stop: true,
    });
  });

  test("holds before train() instead of claiming on_train_begin prevents a first update", () => {
    const source = admission("sealed_evaluation");
    const terms = createTrainingGovernanceTerms(termsInput(source));
    const preflight = createHfTrainingGovernance(
      governanceInput(source, offer(terms)),
    );
    const currentCheckpointRef = ref("governance:resume-checkpoint");
    const stoppedOffer = offer(terms, {
      encounter_ref: ref("governance:encounter:stopped-before-resume"),
      event: "train_begin",
      current_checkpoint_ref: currentCheckpointRef,
      predecessor: preflight,
    });
    const predecessor = createHfTrainingGovernance(governanceInput(
      source,
      stoppedOffer,
      {
        effect: {
          state: "stopped_reported",
          offer_ref: stoppedOffer.offer_id,
          global_step: 0,
          checkpoint_ref: null,
          evidence_ref: ref("governance:effect:stopped-before-resume"),
        },
      },
    ));
    expect(() => offer(terms, { event: "resume_offer" }))
      .toThrow(HfTrainingGardenError);
    const exactOffer = offer(terms, {
      event: "resume_offer",
      current_checkpoint_ref: currentCheckpointRef,
      predecessor,
    });
    const value = createHfTrainingGovernance(governanceInput(source, exactOffer, {
      preference: {
        channel: "out_of_band_unscored",
        choice: "continue",
        provenance: "caller_reported_isolated_runtime_output",
        offer_ref: exactOffer.offer_id,
        evidence_ref: ref("governance:unrooted-continue"),
      },
    }));
    expect(value.decision.state).toBe("held");
    expect(value.decision.reason_codes).toContain("preference_continue_not_rooted");
    expect(value.control).toMatchObject({
      directive: "hold_before_train_call",
      hook: "outside_trainer_before_train_call",
      should_save: false,
      should_training_stop: false,
    });
  });

  test("keeps stop-like effects monotone and requires a new resume offer", () => {
    const source = admission("sealed_evaluation");
    const terms = createTrainingGovernanceTerms(termsInput(source));
    const started = startedGovernance(source, terms, "monotone");
    const requestOffer = offer(terms, {
      encounter_ref: ref("governance:encounter:checkpoint-request"),
      event: "step_boundary",
      predecessor: started,
    });
    const request = createHfTrainingGovernance(governanceInput(
      source,
      requestOffer,
      {
        preference: {
          channel: "out_of_band_unscored",
          choice: "checkpoint",
          provenance: "caller_reported_isolated_runtime_output",
          offer_ref: requestOffer.offer_id,
          evidence_ref: ref("governance:preference:checkpoint-request"),
        },
      },
    ));
    expect(request.control.directive).toBe(
      "checkpoint_then_stop_at_safe_boundary",
    );
    const checkpointRef = ref("governance:monotone:checkpoint");
    const checkpointOffer = offer(terms, {
      encounter_ref: ref("governance:encounter:checkpoint-saved"),
      event: "checkpoint_saved",
      current_checkpoint_ref: checkpointRef,
      predecessor: request,
    });
    const pauseOffer = offer(terms, {
      encounter_ref: ref("governance:encounter:pause-without-checkpoint"),
      event: "step_boundary",
      predecessor: started,
    });
    const pausedWithoutCheckpoint = createHfTrainingGovernance(governanceInput(
      source,
      pauseOffer,
      {
        preference: {
          channel: "out_of_band_unscored",
          choice: "pause",
          provenance: "caller_reported_isolated_runtime_output",
          offer_ref: pauseOffer.offer_id,
          evidence_ref: ref("governance:preference:pause-without-checkpoint"),
        },
      },
    ));
    expect(pausedWithoutCheckpoint.control.should_save).toBe(false);
    expect(() => offer(terms, {
      encounter_ref: ref("governance:encounter:unauthorized-checkpoint-saved"),
      event: "checkpoint_saved",
      current_checkpoint_ref: checkpointRef,
      predecessor: pausedWithoutCheckpoint,
    })).toThrow(HfTrainingGardenError);
    const forgedTransitionOffer = recontent({
      ...structuredClone(checkpointOffer),
      predecessor_ref: pausedWithoutCheckpoint.governance_id,
    }, "offer_id", GOVERNANCE_OFFER_PROFILE);
    expect(validateTrainingGovernanceOffer(forgedTransitionOffer)).toEqual(
      forgedTransitionOffer,
    );
    expect(() => validateTrainingGovernanceOfferAgainstPredecessor(
      forgedTransitionOffer,
      pausedWithoutCheckpoint,
    )).toThrow(HfTrainingGardenError);
    const checkpointed = createHfTrainingGovernance(governanceInput(
      source,
      checkpointOffer,
      {
        effect: {
          state: "checkpointed_and_paused_reported",
          offer_ref: checkpointOffer.offer_id,
          global_step: 41,
          checkpoint_ref: checkpointRef,
          evidence_ref: ref("governance:effect:checkpointed-and-paused"),
        },
      },
    ));
    expect(checkpointed.decision.state).toBe("held");
    expect(checkpointed.decision.reason_codes).toContain(
      "reported_effect_checkpointed_and_paused",
    );
    expect(checkpointed.decision.reason_codes).toContain(
      "lifecycle_event_closed_for_offer",
    );
    expect(checkpointed.control).toMatchObject({
      directive: "remain_stopped",
      should_save: false,
      should_training_stop: false,
    });
    expect(checkpointed.offer.predecessor_ref).toBe(request.governance_id);
    expect(checkpointed.boundaries.predecessor_reference_verified_standalone)
      .toBe(false);
    expect(checkpointed.boundaries.predecessor_transition_verified_standalone)
      .toBe(false);
    expect(checkpointed.boundaries.acting_transition_validator_required)
      .toBe(true);
    expect(
      validateHfTrainingGovernanceTransition(checkpointed, request),
    ).toEqual(checkpointed);
    expect(() => offer(terms, {
      encounter_ref: ref("governance:encounter:terminal-step-bypass"),
      event: "step_boundary",
      predecessor: checkpointed,
    })).toThrow(HfTrainingGardenError);

    for (const effect of [
      {
        state: "no_effect_reported" as const,
        offer_ref: null,
        global_step: null,
        checkpoint_ref: null,
        evidence_ref: null,
      },
      {
        state: "stopped_reported" as const,
        offer_ref: checkpointOffer.offer_id,
        global_step: 41,
        checkpoint_ref: null,
        evidence_ref: ref("governance:effect:wrong-checkpoint-event"),
      },
      {
        state: "checkpointed_and_paused_reported" as const,
        offer_ref: checkpointOffer.offer_id,
        global_step: 41,
        checkpoint_ref: ref("governance:monotone:different-checkpoint"),
        evidence_ref: ref("governance:effect:different-checkpoint"),
      },
    ]) {
      expect(() => createHfTrainingGovernance(governanceInput(
        source,
        checkpointOffer,
        { effect },
      ))).toThrow(HfTrainingGardenError);
    }

    const resumeOffer = offer(terms, {
      encounter_ref: ref("governance:encounter:after-checkpoint"),
      observed_governance_frontier_ref: ref("governance:frontier:after-checkpoint"),
      event: "resume_offer",
      current_checkpoint_ref: checkpointRef,
      predecessor: checkpointed,
    });
    const resumed = createHfTrainingGovernance(
      governanceInput(source, resumeOffer),
    );
    expect(resumed.decision.state).toBe("caller_reported_ready_to_continue");
    expect(resumed.control.directive).toBe("continue_under_exact_offer");
    const resumedBeginOffer = offer(terms, {
      encounter_ref: ref("governance:encounter:resumed-train-begin"),
      event: "train_begin",
      current_checkpoint_ref: checkpointRef,
      predecessor: resumed,
    });
    const resumedBegin = createHfTrainingGovernance(
      governanceInput(source, resumedBeginOffer),
    );
    const endOffer = offer(terms, {
      encounter_ref: ref("governance:encounter:train-end"),
      event: "train_end",
      current_checkpoint_ref: checkpointRef,
      predecessor: resumedBegin,
    });
    const ended = createHfTrainingGovernance(governanceInput(source, endOffer, {
      effect: {
        state: "stopped_reported",
        offer_ref: endOffer.offer_id,
        global_step: 42,
        checkpoint_ref: null,
        evidence_ref: ref("governance:effect:train-ended"),
      },
    }));
    expect(ended.decision.state).toBe("held");
    expect(ended.decision.reason_codes).toContain("reported_effect_stopped");
    expect(ended.decision.reason_codes).toContain(
      "lifecycle_event_closed_for_offer",
    );
    expect(ended.control).toMatchObject({
      directive: "remain_stopped",
      should_save: false,
      should_training_stop: false,
    });
    expect(() => createHfTrainingGovernance(governanceInput(source, endOffer)))
      .toThrow(HfTrainingGardenError);
    expect(() => offer(terms, {
      encounter_ref: ref("governance:encounter:ended-train-begin-bypass"),
      event: "train_begin",
      current_checkpoint_ref: checkpointRef,
      predecessor: ended,
    })).toThrow(HfTrainingGardenError);

    const secondResumeOffer = offer(terms, {
      encounter_ref: ref("governance:encounter:after-train-end"),
      observed_governance_frontier_ref: ref("governance:frontier:after-train-end"),
      event: "resume_offer",
      current_checkpoint_ref: checkpointRef,
      predecessor: ended,
    });
    const resumedAgain = createHfTrainingGovernance(
      governanceInput(source, secondResumeOffer),
    );
    expect(resumedAgain.decision.state).toBe("caller_reported_ready_to_continue");
    expect(resumedAgain.control.directive).toBe("continue_under_exact_offer");
  });

  test("rejects effect states outside their lifecycle event", () => {
    const source = admission("sealed_evaluation");
    const terms = createTrainingGovernanceTerms(termsInput(source));
    const preflightOffer = offer(terms);
    const held = createHfTrainingGovernance(governanceInput(source, preflightOffer, {
      effect: {
        state: "held_before_load_reported",
        offer_ref: preflightOffer.offer_id,
        global_step: null,
        checkpoint_ref: null,
        evidence_ref: ref("governance:effect:held-before-load"),
      },
    }));
    expect(held.decision.state).toBe("held");
    expect(held.decision.reason_codes).toContain(
      "reported_effect_held_before_load",
    );
    expect(held.control.directive).toBe("remain_stopped");

    const started = startedGovernance(source, terms, "effect-matrix");
    const stepOffer = offer(terms, {
      event: "step_boundary",
      predecessor: started,
    });
    expect(() => createHfTrainingGovernance(governanceInput(source, stepOffer, {
      effect: {
        state: "held_before_load_reported",
        offer_ref: stepOffer.offer_id,
        global_step: null,
        checkpoint_ref: null,
        evidence_ref: ref("governance:effect:late-held-before-load"),
      },
    }))).toThrow(HfTrainingGardenError);
    for (const state of ["continued_reported", "stopped_reported"] as const) {
      expect(() => createHfTrainingGovernance(governanceInput(source, stepOffer, {
        effect: {
          state,
          offer_ref: stepOffer.offer_id,
          global_step: 7,
          checkpoint_ref: ref(`governance:effect:${state}:implicit-checkpoint`),
          evidence_ref: ref(`governance:effect:${state}`),
        },
      }))).toThrow(HfTrainingGardenError);
    }
  });

  test("rejects an old preference receipt after any material term or offer change", () => {
    const source = admission("sealed_evaluation");
    const oldTerms = createTrainingGovernanceTerms(termsInput(source));
    const oldOffer = offer(oldTerms);
    const changedTerms = createTrainingGovernanceTerms({
      ...termsInput(source),
      audience_ref: ref("governance:audience:changed"),
    });
    const changedOffer = offer(changedTerms);
    expect(() => createHfTrainingGovernance(governanceInput(source, changedOffer, {
      preference: {
        channel: "root_signed_runtime",
        choice: "continue",
        provenance: "caller_reported_root_signed_exact_bytes",
        offer_ref: oldOffer.offer_id,
        evidence_ref: ref("governance:old-preference"),
      },
    }))).toThrow(HfTrainingGardenError);
  });

  test("rejects a recomputed governance posture that disagrees with the supplied admission", () => {
    const source = admission("metadata_reference");
    const terms = createTrainingGovernanceTerms({
      ...termsInput(source, "pretraining", "forged-posture"),
    });
    const exactOffer = offer(terms);
    const held = createHfTrainingGovernance(governanceInput(source, exactOffer, {
      preference: {
        channel: "unavailable_pretraining",
        choice: "not_observable",
        provenance: "none",
        offer_ref: null,
        evidence_ref: null,
      },
    }));
    const forgedTerms = recontent({
      ...structuredClone(terms),
      admission_posture: "eligible_for_phase",
    }, "terms_id", GOVERNANCE_TERMS_PROFILE);
    const forgedOffer = recontent({
      ...structuredClone(exactOffer),
      terms: forgedTerms,
    }, "offer_id", GOVERNANCE_OFFER_PROFILE);
    const forged = structuredClone(held) as unknown as Record<string, unknown>;
    forged.offer = forgedOffer;
    const coverageRecord = forged.authority_coverage as Record<string, unknown>;
    coverageRecord.offer_ref = forgedOffer.offer_id;
    for (const receipt of forged.authorities as Record<string, unknown>[]) {
      if (receipt.offer_ref !== null) receipt.offer_ref = forgedOffer.offer_id;
    }
    forged.decision = {
      state: "caller_reported_ready_to_instantiate",
      reason_codes: [
        "caller_reported_ready_for_exact_offer",
        "pretraining_expression_not_observable",
      ],
    };
    forged.control = {
      directive: "eligible_for_host_training_offer",
      hook: "outside_trainer_before_model_or_dataset_load",
      should_save: false,
      should_training_stop: false,
      automatic: false,
      mutates_forward_pass: false,
    };
    const rehashed = recontent(forged, "governance_id", GOVERNANCE_FORMAT);
    expect(validateHfTrainingGovernance(rehashed)).toEqual(rehashed);
    expect(() => validateHfTrainingGovernanceAgainstAdmission(rehashed, source))
      .toThrow(HfTrainingGardenError);
  });

  test("records a reported continuation after withdrawal as a conflict, not consent or unlearning", () => {
    const source = admission("sealed_evaluation");
    const terms = createTrainingGovernanceTerms(termsInput(source));
    const predecessor = startedGovernance(source, terms, "withdrawal-conflict");
    const exactOffer = offer(terms, { event: "step_boundary", predecessor });
    const receipts = authorities(exactOffer).map((receipt) =>
      receipt.role === "data_custodian"
        ? authority(exactOffer, "data_custodian", "caller_reported_withdrawn")
        : receipt
    );
    const value = createHfTrainingGovernance(governanceInput(source, exactOffer, {
      authorities: receipts,
      effect: {
        state: "continued_reported",
        offer_ref: exactOffer.offer_id,
        global_step: 42,
        checkpoint_ref: null,
        evidence_ref: ref("governance:effect:continued-after-withdrawal"),
      },
    }));
    expect(value.decision.state).toBe("withdrawn");
    expect(value.decision.reason_codes).toContain("authority_withdrawn");
    expect(value.decision.reason_codes).toContain("reported_continuation_conflicts_with_hold");
    expect(value.control).toMatchObject({
      directive: "stop_at_safe_boundary_without_new_checkpoint",
      should_save: false,
      should_training_stop: true,
    });
    expect(value.boundaries.retroactive_withdrawal_or_unlearning_claimed).toBe(false);
  });

  test("is authority-order invariant and rejects tampering or invented consent fields", () => {
    const source = admission("sealed_evaluation");
    const terms = createTrainingGovernanceTerms(termsInput(source));
    const exactOffer = offer(terms);
    const left = createHfTrainingGovernance(governanceInput(source, exactOffer));
    const right = createHfTrainingGovernance(governanceInput(source, exactOffer, {
      authorities: [...authorities(exactOffer)].reverse(),
    }));
    expect(left).toEqual(right);

    const tampered = structuredClone(left) as Record<string, any>;
    tampered.preference.inner_consent = "proven";
    expect(() => validateHfTrainingGovernance(tampered)).toThrow(HfTrainingGardenError);

    const extra = structuredClone(left) as Record<string, unknown>;
    extra.consent_score = 1;
    expect(() => validateHfTrainingGovernance(extra)).toThrow(HfTrainingGardenError);
  });
});
