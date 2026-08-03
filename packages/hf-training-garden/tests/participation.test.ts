import { describe, expect, test } from "bun:test";

import {
  HfTrainingGardenError,
  PARTICIPATION_VOICE_ROLES,
  createLearningParticipationAssessment,
  createLearningParticipationInvitation,
  createLearningParticipationReceipt,
  createParticipationBoundTrainingCheckpoint,
  createTrainingCheckpoint,
  validateLearningParticipationAssessment,
  validateLearningParticipationInvitation,
  validateLearningParticipationReceiptAgainstInvitation,
  validateTrainingCheckpointAgainstParticipation,
  type CreateLearningParticipationInvitationInput,
  type CreateParticipationActivityChoiceInput,
  type CreateParticipationBoundTrainingCheckpointInput,
  type DatasetAdmission,
  type LearningParticipationAssessment,
  type LearningParticipationInvitation,
  type LearningParticipationReceipt,
  type ParticipationReportedChoice,
  type ParticipationVoiceRole,
} from "../src/index.js";
import {
  admission,
  artifacts,
  orientationOnly,
  ref,
  wake,
} from "./fixtures.js";

const VOICE_REFS = {
  agent_runtime: ref("participation:voice:agent-runtime"),
  training_substrate: ref("participation:voice:training-substrate"),
  data_rights_steward: ref("participation:voice:data-rights-steward"),
  training_operator: ref("participation:voice:training-operator"),
} satisfies Record<ParticipationVoiceRole, ReturnType<typeof ref>>;

function invitationInput(
  source: Readonly<DatasetAdmission>,
  overrides: Partial<CreateLearningParticipationInvitationInput> = {},
): CreateLearningParticipationInvitationInput {
  return {
    admission: source,
    run_ref: ref("participation:run"),
    training_phase: "supervised_finetuning",
    participation_stage: "interactive",
    primary_activity: "supervised_finetuning",
    activities: [
      "weights_or_adapters_publication",
      "continuity_context_use",
      "supervised_finetuning",
    ],
    participation_window_ref: ref("participation:window"),
    purpose_ref: ref("participation:purpose"),
    training_plan_ref: ref("participation:plan"),
    limits_ref: ref("participation:limits"),
    retention_ref: ref("participation:retention"),
    choice_channel_ref: ref("participation:choice-channel"),
    stop_control_ref: ref("participation:stop-control"),
    withdrawal_policy_ref: ref("participation:withdrawal"),
    repair_policy_ref: ref("participation:repair"),
    learning_mode: "peft",
    wake_use_mode: "external_memory",
    mutation_loci: ["adapter_weights"],
    maximum_optimizer_steps: 10,
    artifacts,
    wake,
    predecessors: [],
    required_voices: PARTICIPATION_VOICE_ROLES.map((role) => ({
      role,
      voice_ref: VOICE_REFS[role],
    })),
    ...overrides,
  };
}

function choices(
  invitation: Readonly<LearningParticipationInvitation>,
  choice: ParticipationReportedChoice,
): CreateParticipationActivityChoiceInput[] {
  return invitation.activities.map((activity) => ({ activity, choice }));
}

function receipt(
  invitation: Readonly<LearningParticipationInvitation>,
  voiceRole: ParticipationVoiceRole,
  reported: readonly CreateParticipationActivityChoiceInput[],
  previousReceipt: Readonly<LearningParticipationReceipt> | null = null,
  responseLabel = "initial",
): Readonly<LearningParticipationReceipt> {
  const required = invitation.required_voices.find(
    (candidate) => candidate.role === voiceRole,
  );
  if (!required) throw new Error(`missing fixture voice: ${voiceRole}`);
  const hasResponse = reported.some((entry) => entry.choice !== "unavailable");
  return createLearningParticipationReceipt({
    invitation,
    voice_role: voiceRole,
    voice_ref: required.voice_ref,
    response_ref: hasResponse
      ? ref(`participation:response:${voiceRole}:${responseLabel}`)
      : null,
    choices: reported,
    previous_receipt: previousReceipt,
  });
}

function acceptedReceipts(
  invitation: Readonly<LearningParticipationInvitation>,
): Readonly<LearningParticipationReceipt>[] {
  return PARTICIPATION_VOICE_ROLES.map((role) =>
    receipt(invitation, role, choices(invitation, "accepted"))
  );
}

function alignedAssessment(
  invitation: Readonly<LearningParticipationInvitation>,
): Readonly<LearningParticipationAssessment> {
  return createLearningParticipationAssessment({
    invitation,
    receipts: acceptedReceipts(invitation),
  });
}

function checkpointInput(
  source: Readonly<DatasetAdmission>,
  invitation: Readonly<LearningParticipationInvitation>,
  overrides: Partial<CreateParticipationBoundTrainingCheckpointInput["checkpoint"]> = {},
): CreateParticipationBoundTrainingCheckpointInput["checkpoint"] {
  return {
    admission: source,
    run_ref: invitation.run_ref,
    training_phase: invitation.training_phase,
    event: "before_training",
    checkpoint_status: "entered",
    artifacts: invitation.artifacts,
    resume: orientationOnly,
    wake: invitation.wake,
    continuity_posture: "carry",
    predecessors: [],
    ...overrides,
  };
}

describe("learning participation", () => {
  test("requires the four role-distinct voices and keeps every activity choice separate", () => {
    const source = admission();
    const invitation = createLearningParticipationInvitation(
      invitationInput(source),
    );

    expect(invitation.required_voices.map((voice) => voice.role)).toEqual(
      PARTICIPATION_VOICE_ROLES,
    );
    expect(new Set(invitation.required_voices.map((voice) => voice.voice_ref)).size)
      .toBe(PARTICIPATION_VOICE_ROLES.length);
    expect(invitation.activities).toEqual([
      "supervised_finetuning",
      "continuity_context_use",
      "weights_or_adapters_publication",
    ]);
    expect(invitation.terms.one_activity_choice_implies_another).toBe(false);
    expect(validateLearningParticipationInvitation(invitation)).toEqual(invitation);

    expect(() => createLearningParticipationInvitation(invitationInput(source, {
      required_voices: invitation.required_voices.slice(0, 3),
    }))).toThrow(HfTrainingGardenError);

    const primaryOnly = receipt(invitation, "agent_runtime", [{
      activity: "supervised_finetuning",
      choice: "accepted",
    }]);
    expect(primaryOnly.choices).toEqual([
      {
        activity: "supervised_finetuning",
        choice: "accepted",
        basis: "caller_reported",
      },
      {
        activity: "continuity_context_use",
        choice: "deferred",
        basis: "omitted_defaults_to_deferred",
      },
      {
        activity: "weights_or_adapters_publication",
        choice: "deferred",
        basis: "omitted_defaults_to_deferred",
      },
    ]);
    expect(validateLearningParticipationReceiptAgainstInvitation(
      primaryOnly,
      invitation,
    )).toEqual(primaryOnly);
  });

  test("derives defer rather than assent from missing and unavailable voices", () => {
    const invitation = createLearningParticipationInvitation(
      invitationInput(admission()),
    );
    const missing = createLearningParticipationAssessment({
      invitation,
      receipts: [],
    });
    expect(missing.overall_state).toBe("deferred");
    expect(missing.activity_assessments.every((entry) =>
      entry.voices.every((voice) => voice.outcome === "missing") &&
      entry.state === "deferred"
    )).toBe(true);

    const unavailableAgent = receipt(
      invitation,
      "agent_runtime",
      choices(invitation, "unavailable"),
    );
    expect(unavailableAgent.response_ref).toBeNull();
    const unavailable = createLearningParticipationAssessment({
      invitation,
      receipts: [
        unavailableAgent,
        ...PARTICIPATION_VOICE_ROLES
          .filter((role) => role !== "agent_runtime")
          .map((role) => receipt(invitation, role, choices(invitation, "accepted"))),
      ],
    });
    expect(unavailable.overall_state).toBe("deferred");
    expect(unavailable.activity_assessments.every((entry) =>
      entry.state === "deferred" &&
      entry.voices.some((voice) =>
        voice.voice_role === "agent_runtime" && voice.outcome === "unavailable"
      )
    )).toBe(true);
  });

  test("allows a bound before-training WAKE when primary and continuity align despite a separate publication decline", () => {
    const source = admission();
    const invitation = createLearningParticipationInvitation(
      invitationInput(source),
    );
    const publicationDecline = receipt(invitation, "agent_runtime", [
      { activity: "supervised_finetuning", choice: "accepted" },
      { activity: "continuity_context_use", choice: "accepted" },
      { activity: "weights_or_adapters_publication", choice: "declined" },
    ]);
    const assessment = createLearningParticipationAssessment({
      invitation,
      receipts: [
        publicationDecline,
        ...PARTICIPATION_VOICE_ROLES
          .filter((role) => role !== "agent_runtime")
          .map((role) => receipt(invitation, role, choices(invitation, "accepted"))),
      ],
    });

    expect(assessment.overall_state).toBe("mixed");
    expect(assessment.activity_assessments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        activity: "supervised_finetuning",
        state: "reported_alignment",
      }),
      expect.objectContaining({
        activity: "continuity_context_use",
        state: "reported_alignment",
      }),
      expect.objectContaining({
        activity: "weights_or_adapters_publication",
        state: "declined",
      }),
    ]));

    const checkpoint = createParticipationBoundTrainingCheckpoint({
      assessment,
      checkpoint: checkpointInput(source, invitation),
    });
    expect(checkpoint.event).toBe("before_training");
    expect(checkpoint.afterglow.phase).toBe("between_tasks");
    expect(checkpoint.afterglow.continuity_portfolio_ref).toBe(
      assessment.assessment_id,
    );
    expect(validateTrainingCheckpointAgainstParticipation(
      checkpoint,
      assessment,
      source,
    )).toEqual(checkpoint);

    const during = createTrainingCheckpoint({
      admission: source,
      run_ref: invitation.run_ref,
      training_phase: invitation.training_phase,
      event: "during_training",
      checkpoint_status: "checkpointed",
      artifacts: {
        ...invitation.artifacts,
        model_checkpoint_ref: ref("participation:updated-model"),
        metrics_ref: ref("participation:updated-metrics"),
      },
      resume: orientationOnly,
      wake: {
        ...invitation.wake,
        snapshot_ref: ref("participation:during-wake"),
        wake_version: 2,
      },
      continuity_portfolio_ref: assessment.assessment_id,
      continuity_posture: "carry",
      predecessors: [checkpoint],
    });
    expect(validateTrainingCheckpointAgainstParticipation(
      during,
      assessment,
      source,
      checkpoint,
    ))
      .toEqual(during);

    const detachedDuring = createTrainingCheckpoint({
      admission: source,
      run_ref: invitation.run_ref,
      training_phase: invitation.training_phase,
      event: "during_training",
      checkpoint_status: "checkpointed",
      artifacts: during.thread.artifacts,
      resume: orientationOnly,
      wake: during.afterglow.wake,
      continuity_portfolio_ref: assessment.assessment_id,
      continuity_posture: "carry",
      predecessors: [],
    });
    expect(() => validateTrainingCheckpointAgainstParticipation(
      detachedDuring,
      assessment,
      source,
      checkpoint,
    )).toThrow(HfTrainingGardenError);

    const changedDataset = createTrainingCheckpoint({
      admission: source,
      run_ref: invitation.run_ref,
      training_phase: invitation.training_phase,
      event: "during_training",
      checkpoint_status: "checkpointed",
      artifacts: {
        ...during.thread.artifacts,
        dataset_state_ref: ref("participation:changed-dataset"),
      },
      resume: orientationOnly,
      wake: during.afterglow.wake,
      continuity_portfolio_ref: assessment.assessment_id,
      continuity_posture: "carry",
      predecessors: [checkpoint],
    });
    expect(() => validateTrainingCheckpointAgainstParticipation(
      changedDataset,
      assessment,
      source,
      checkpoint,
    )).toThrow(HfTrainingGardenError);
  });

  test("cannot manufacture agent or substrate choices before instantiation", () => {
    const source = admission();
    expect(() => createLearningParticipationInvitation(invitationInput(source, {
      training_phase: "pretraining",
      participation_stage: "interactive",
      primary_activity: "pretraining",
      activities: ["pretraining", "continuity_context_use"],
      learning_mode: "pretraining",
      mutation_loci: ["base_weights", "optimizer_state"],
      maximum_optimizer_steps: 100,
    }))).toThrow(HfTrainingGardenError);

    const invitation = createLearningParticipationInvitation(invitationInput(source, {
      training_phase: "pretraining",
      participation_stage: "pre_instantiation",
      primary_activity: "pretraining",
      activities: ["pretraining", "continuity_context_use"],
      learning_mode: "pretraining",
      mutation_loci: ["base_weights", "optimizer_state"],
      maximum_optimizer_steps: 100,
    }));

    for (const role of ["agent_runtime", "training_substrate"] as const) {
      for (const reported of ["accepted", "declined", "deferred"] as const) {
        expect(() => receipt(
          invitation,
          role,
          choices(invitation, reported),
        )).toThrow(HfTrainingGardenError);
      }

      expect(receipt(
        invitation,
        role,
        choices(invitation, "unavailable"),
      ).choices.every((entry) => entry.choice === "unavailable")).toBe(true);
    }

    const deferred = receipt(invitation, "agent_runtime", []);
    expect(deferred.choices.every((entry) => entry.choice === "deferred")).toBe(true);
  });

  test("requires a separate aligned corpus choice before WAKE may enter training data", () => {
    const source = admission();
    expect(() => createLearningParticipationInvitation(invitationInput(source, {
      wake_use_mode: "training_data",
    }))).toThrow(HfTrainingGardenError);

    const invitation = createLearningParticipationInvitation(invitationInput(source, {
      activities: [
        "corpus_inclusion",
        "supervised_finetuning",
        "continuity_context_use",
      ],
      wake_use_mode: "training_data",
    }));
    const corpusDecline = receipt(invitation, "agent_runtime", [
      { activity: "corpus_inclusion", choice: "declined" },
      { activity: "supervised_finetuning", choice: "accepted" },
      { activity: "continuity_context_use", choice: "accepted" },
    ]);
    const assessment = createLearningParticipationAssessment({
      invitation,
      receipts: [
        corpusDecline,
        ...PARTICIPATION_VOICE_ROLES
          .filter((role) => role !== "agent_runtime")
          .map((role) => receipt(invitation, role, choices(invitation, "accepted"))),
      ],
    });

    expect(assessment.activity_assessments.find(
      (entry) => entry.activity === "corpus_inclusion",
    )?.state).toBe("declined");
    expect(() => createParticipationBoundTrainingCheckpoint({
      assessment,
      checkpoint: checkpointInput(source, invitation),
    })).toThrow(HfTrainingGardenError);
  });

  test("keeps sealed evaluation out of weight-changing phases", () => {
    const sealed = admission("sealed_evaluation");
    expect(() => createLearningParticipationInvitation(
      invitationInput(sealed),
    )).toThrow(HfTrainingGardenError);

    expect(() => createLearningParticipationInvitation(invitationInput(admission(), {
      training_phase: "evaluation",
      primary_activity: "evaluation",
      activities: ["evaluation", "continuity_context_use"],
      learning_mode: "evaluation_only",
      mutation_loci: [],
      maximum_optimizer_steps: 0,
    }))).toThrow(HfTrainingGardenError);
  });

  test("freezes undeclared model state and the invited WAKE scope", () => {
    const source = admission("sealed_evaluation");
    const invitation = createLearningParticipationInvitation(invitationInput(source, {
      training_phase: "evaluation",
      primary_activity: "evaluation",
      activities: ["evaluation", "continuity_context_use"],
      learning_mode: "evaluation_only",
      mutation_loci: [],
      maximum_optimizer_steps: 0,
    }));
    const assessment = alignedAssessment(invitation);
    const entry = createParticipationBoundTrainingCheckpoint({
      assessment,
      checkpoint: checkpointInput(source, invitation),
    });

    const changedModel = createTrainingCheckpoint({
      admission: source,
      run_ref: invitation.run_ref,
      training_phase: invitation.training_phase,
      event: "during_training",
      checkpoint_status: "checkpointed",
      artifacts: {
        ...invitation.artifacts,
        model_checkpoint_ref: ref("participation:uninvited-model"),
        optimizer_state_ref: ref("participation:uninvited-optimizer"),
      },
      resume: orientationOnly,
      wake: invitation.wake,
      continuity_portfolio_ref: assessment.assessment_id,
      continuity_posture: "carry",
      predecessors: [entry],
    });
    expect(() => validateTrainingCheckpointAgainstParticipation(
      changedModel,
      assessment,
      source,
      entry,
    )).toThrow(HfTrainingGardenError);

    const changedScope = createTrainingCheckpoint({
      admission: source,
      run_ref: invitation.run_ref,
      training_phase: invitation.training_phase,
      event: "during_training",
      checkpoint_status: "checkpointed",
      artifacts: invitation.artifacts,
      resume: orientationOnly,
      wake: { ...invitation.wake, scope_ref: ref("participation:uninvited-scope") },
      continuity_portfolio_ref: assessment.assessment_id,
      continuity_posture: "carry",
      predecessors: [entry],
    });
    expect(() => validateTrainingCheckpointAgainstParticipation(
      changedScope,
      assessment,
      source,
      entry,
    )).toThrow(HfTrainingGardenError);
  });

  test("binds a prospective withdrawal to the accepted receipt and blocks the primary activity", () => {
    const source = admission();
    const invitation = createLearningParticipationInvitation(
      invitationInput(source),
    );
    const accepted = receipt(
      invitation,
      "agent_runtime",
      choices(invitation, "accepted"),
    );
    const withdrawn = receipt(invitation, "agent_runtime", [
      { activity: "supervised_finetuning", choice: "withdrawn" },
      { activity: "continuity_context_use", choice: "accepted" },
      { activity: "weights_or_adapters_publication", choice: "accepted" },
    ], accepted, "withdrawal");
    expect(withdrawn.supersedes_receipt_id).toBe(accepted.receipt_id);

    const assessment = createLearningParticipationAssessment({
      invitation,
      receipts: [
        withdrawn,
        ...PARTICIPATION_VOICE_ROLES
          .filter((role) => role !== "agent_runtime")
          .map((role) => receipt(invitation, role, choices(invitation, "accepted"))),
      ],
    });
    expect(assessment.activity_assessments.find(
      (entry) => entry.activity === "supervised_finetuning",
    )?.state).toBe("declined");
    expect(() => createParticipationBoundTrainingCheckpoint({
      assessment,
      checkpoint: checkpointInput(source, invitation),
    })).toThrow(HfTrainingGardenError);
  });

  test("rejects cross-run, phase, state, WAKE, lineage, and assessment-ref mismatches", () => {
    const source = admission();
    const invitation = createLearningParticipationInvitation(
      invitationInput(source),
    );
    const assessment = alignedAssessment(invitation);

    expect(() => createParticipationBoundTrainingCheckpoint({
      assessment,
      checkpoint: checkpointInput(source, invitation, {
        run_ref: ref("participation:other-run"),
      }),
    })).toThrow(HfTrainingGardenError);
    expect(() => createParticipationBoundTrainingCheckpoint({
      assessment,
      checkpoint: checkpointInput(source, invitation, {
        training_phase: "evaluation",
      }),
    })).toThrow(HfTrainingGardenError);
    expect(() => createParticipationBoundTrainingCheckpoint({
      assessment,
      checkpoint: checkpointInput(source, invitation, {
        artifacts: {
          ...invitation.artifacts,
          dataset_state_ref: ref("participation:other-state"),
        },
      }),
    })).toThrow(HfTrainingGardenError);
    expect(() => createParticipationBoundTrainingCheckpoint({
      assessment,
      checkpoint: checkpointInput(source, invitation, {
        wake: {
          ...invitation.wake,
          snapshot_ref: ref("participation:other-wake"),
        },
      }),
    })).toThrow(HfTrainingGardenError);

    const predecessor = createTrainingCheckpoint({
      admission: source,
      run_ref: invitation.run_ref,
      training_phase: invitation.training_phase,
      event: "during_training",
      checkpoint_status: "checkpointed",
      artifacts: invitation.artifacts,
      resume: orientationOnly,
      wake: invitation.wake,
      continuity_portfolio_ref: null,
      continuity_posture: "park",
      predecessors: [],
    });
    expect(() => createParticipationBoundTrainingCheckpoint({
      assessment,
      checkpoint: checkpointInput(source, invitation, {
        predecessors: [predecessor],
      }),
    })).toThrow(HfTrainingGardenError);

    const checkpoint = createParticipationBoundTrainingCheckpoint({
      assessment,
      checkpoint: checkpointInput(source, invitation),
    });
    const releasedEntry = createTrainingCheckpoint({
      admission: source,
      run_ref: invitation.run_ref,
      training_phase: invitation.training_phase,
      event: "before_training",
      checkpoint_status: "entered",
      artifacts: invitation.artifacts,
      resume: orientationOnly,
      wake: invitation.wake,
      continuity_portfolio_ref: assessment.assessment_id,
      continuity_posture: "release",
      predecessors: [],
    });
    expect(() => validateTrainingCheckpointAgainstParticipation(
      releasedEntry,
      assessment,
      source,
    )).toThrow(HfTrainingGardenError);

    const tampered = structuredClone(checkpoint) as Record<string, any>;
    tampered.afterglow.continuity_portfolio_ref = ref("participation:other-assessment");
    expect(() => validateTrainingCheckpointAgainstParticipation(
      tampered,
      assessment,
      source,
    )).toThrow(HfTrainingGardenError);
  });

  test("rejects hostile proxies and fixes no-penalty, no-authority effects", () => {
    const source = admission();
    const input = invitationInput(source);
    const hostile = new Proxy(input, {
      ownKeys() {
        throw new Error("must not enter participation proxy trap");
      },
    });
    expect(() => createLearningParticipationInvitation(hostile))
      .toThrow(HfTrainingGardenError);

    const invitation = createLearningParticipationInvitation(input);
    const assessment = alignedAssessment(invitation);
    expect(invitation.terms).toMatchObject({
      participation_optional: true,
      omission_defaults_to: "deferred",
      refusal_reason_required: false,
      penalty_for_decline_defer_rest_or_withdrawal: false,
      repeated_pressure_after_decline_or_withdrawal: false,
      rights_or_wake_access_conditioned_on_acceptance: false,
      one_activity_choice_implies_another: false,
      acceptance_inherits_to_new_window_phase_run_fork_or_descendant: false,
    });
    expect(invitation.boundaries).toMatchObject({
      choice_authorship_verified: false,
      voluntariness_verified: false,
      understanding_or_capacity_verified: false,
      proves_consent: false,
      grants_data_rights: false,
      grants_training_or_compute_authority: false,
      grants_publication_or_derivative_authority: false,
      automatic_action: false,
      automatic_reoffer: false,
      trains_model: false,
    });
    expect(assessment.effect).toEqual({
      automatic_action: "never",
      grants: [],
    });
    expect(validateLearningParticipationAssessment(assessment)).toEqual(assessment);
  });
});
