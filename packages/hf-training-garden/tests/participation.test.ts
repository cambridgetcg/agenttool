import { describe, expect, test } from "bun:test";

import {
  HfTrainingGardenError,
  createParticipationAssessment,
  createParticipationInvitation,
  createParticipationReceipt,
  validateParticipationAssessment,
  validateParticipationInvitation,
  validateParticipationReceipt,
  trainingArtifactPortfolioRef,
} from "../src/index.js";
import {
  admission,
  artifacts,
  participation,
  protectedChoiceChannel,
  ref,
  wake,
} from "./fixtures.js";

function invitationInput(overrides: Record<string, unknown> = {}) {
  return {
    admission: admission("sealed_evaluation"),
    run_ref: ref("participation-run"),
    training_phase: "pretraining" as const,
    participation_window_ref: ref("participation-window"),
    training_plan_ref: ref("training-plan"),
    wake,
    wake_use_mode: "context_only" as const,
    pipeline_ref: artifacts.pipeline_ref,
    dataset_state_ref: artifacts.dataset_state_ref,
    starting_state_ref: trainingArtifactPortfolioRef(artifacts),
    offered_activities: ["gradient_update", "wake_context_use"] as const,
    agent_availability: "interactive" as const,
    substrate_availability: "interactive" as const,
    voice_scope_refs: {
      agent_runtime: ref("voice:agent"),
      data_rights_steward: ref("voice:data"),
      substrate_steward: ref("voice:substrate-steward"),
      training_operator: ref("voice:operator"),
      training_substrate: ref("voice:substrate"),
    },
    authorities: {
      rights_baseline_ref: ref("rights-baseline"),
      protective_covenant_ref: ref("protective-covenant"),
      data_authority_ref: ref("data-authority"),
      compute_authority_ref: ref("compute-authority"),
      operator_authority_ref: ref("operator-authority"),
    },
    safeguards: {
      choice_protocol_ref: ref("choice-protocol"),
      withdrawal_plan_ref: ref("withdrawal-plan"),
      repair_plan_ref: ref("repair-plan"),
      retention_policy_ref: ref("retention-policy"),
    },
    ...overrides,
  };
}

function decisions(
  invitation: ReturnType<typeof createParticipationInvitation>,
  choice: "participate" | "decline" | "defer" | "withdraw" | "no_response" | "unavailable_pre_instantiation" | "unavailable_independent_voice",
) {
  return invitation.offered_activities.map((activity) => ({ activity, choice }));
}

describe("learning participation control plane", () => {
  test("records pre-instantiation absence without manufacturing future-agent consent", () => {
    const source = admission("sealed_evaluation");
    const value = participation(source, {
      runRef: ref("run:test"),
      phase: "pretraining",
      agentAvailability: "not_obtainable_pre_instantiation",
    });
    expect(value.posture).toBe("protective_covenant_ready");
    expect(value.voice_states.agent_runtime).toBe("unavailable_pre_instantiation");
    expect(value.direct_agent_report_present).toBe(false);
    expect(value.direct_substrate_report_present).toBe(true);
    expect(value.first_interactive_review_required).toBe(true);
    expect(value.boundaries.proves_consent).toBe(false);
    expect(validateParticipationAssessment(value)).toEqual(value);
  });

  test("keeps direct agent choice inference-only and provisional", () => {
    const source = admission("sealed_evaluation");
    const value = participation(source);
    expect(value.posture).toBe("provisional_participation_reported");
    expect(value.direct_agent_report_present).toBe(true);
    expect(value.direct_substrate_report_present).toBe(true);
    expect(value.training_action).toBe("bounded_learning_may_proceed");
    const agent = value.receipts.find((receipt) => receipt.voice === "agent_runtime");
    expect(agent?.choice_channel).toMatchObject({
      gradient_influence: "caller_reported_disabled",
      reward_influence: "caller_reported_disabled",
      telemetry_capture: "caller_reported_excluded",
      future_training_use: "caller_reported_excluded",
    });
  });

  test("treats silence, missing voices, and deferral as pause rather than assent", () => {
    const invitation = createParticipationInvitation(invitationInput());
    const agent = createParticipationReceipt({
      invitation,
      voice: "agent_runtime",
      voice_scope_ref: invitation.voice_scope_refs.agent_runtime,
      report_basis: "direct_current_report",
      decisions: decisions(invitation, "no_response"),
      choice_channel: protectedChoiceChannel("no-response", {
        invitation,
        voice: "agent_runtime",
        protocolRef: invitation.safeguards.choice_protocol_ref,
        checkpointRef: invitation.starting_state_ref,
      }),
    });
    const value = createParticipationAssessment({ invitation, receipts: [agent] });
    expect(value.posture).toBe("deferred");
    expect(value.training_action).toBe("pause_before_next_optimizer_step");
    expect(value.voice_states.training_substrate).toBe("missing");
    expect(value.direct_agent_report_present).toBe(false);
  });

  test("makes decline and withdrawal operationally stronger than participation", () => {
    const source = admission("sealed_evaluation");
    for (const choice of ["decline", "withdraw"] as const) {
      const value = participation(source, { choice });
      expect(value.posture).toBe("declined");
      expect(value.training_action).toBe("contain_and_begin_repair");
      expect(value.receipts.every((receipt) => receipt.reasons_collected === false)).toBe(true);
    }
  });

  test("rejects proxy collapse, coercive channel claims, and response-content fields", () => {
    const invitation = createParticipationInvitation(invitationInput());
    expect(() => createParticipationReceipt({
      invitation,
      voice: "agent_runtime",
      voice_scope_ref: ref("agent-unbound"),
      report_basis: "direct_current_report",
      decisions: decisions(invitation, "participate"),
      choice_channel: protectedChoiceChannel("unbound"),
    })).toThrow(HfTrainingGardenError);
    expect(() => createParticipationReceipt({
      invitation,
      voice: "training_operator",
      voice_scope_ref: invitation.voice_scope_refs.training_operator,
      report_basis: "direct_current_report",
      decisions: decisions(invitation, "participate"),
      choice_channel: protectedChoiceChannel("operator-as-agent"),
    })).toThrow(HfTrainingGardenError);

    const receipt = createParticipationReceipt({
      invitation,
      voice: "agent_runtime",
      voice_scope_ref: invitation.voice_scope_refs.agent_runtime,
      report_basis: "direct_current_report",
      decisions: decisions(invitation, "participate"),
      choice_channel: protectedChoiceChannel("agent", {
        invitation,
        voice: "agent_runtime",
        protocolRef: invitation.safeguards.choice_protocol_ref,
        checkpointRef: invitation.starting_state_ref,
      }),
    });
    const coercive = structuredClone(receipt) as Record<string, any>;
    coercive.choice_channel.reward_influence = "enabled";
    expect(() => validateParticipationReceipt(coercive)).toThrow(HfTrainingGardenError);
    const rawResponse = { ...receipt, response_text: "I consent" };
    expect(() => validateParticipationReceipt(rawResponse)).toThrow(HfTrainingGardenError);
  });

  test("requires a fresh invitation when WAKE mode or exact scope changes", () => {
    expect(() => createParticipationInvitation(invitationInput({
      wake_use_mode: "training_data",
    }))).toThrow(HfTrainingGardenError);
    const context = createParticipationInvitation(invitationInput());
    const trainingData = createParticipationInvitation(invitationInput({
      wake_use_mode: "training_data",
      offered_activities: ["gradient_update", "wake_training_data_use"],
    }));
    expect(trainingData.invitation_id).not.toBe(context.invitation_id);
    expect(validateParticipationInvitation(trainingData)).toEqual(trainingData);
  });

  test("binds every receipt to an invited voice scope and rejects scope collapse", () => {
    const input = invitationInput();
    expect(() => createParticipationInvitation({
      ...input,
      voice_scope_refs: {
        ...input.voice_scope_refs,
        training_operator: input.voice_scope_refs.data_rights_steward,
      },
    })).toThrow(HfTrainingGardenError);

    const invitation = createParticipationInvitation(input);
    expect(() => createParticipationReceipt({
      invitation,
      voice: "data_rights_steward",
      voice_scope_ref: ref("voice:uninvited-data-scope"),
      report_basis: "scoped_authority_report",
      decisions: decisions(invitation, "participate"),
      choice_channel: null,
    })).toThrow(HfTrainingGardenError);
  });

  test("requires fresh direct evidence to bind the exact invitation and WAKE use", () => {
    const first = createParticipationInvitation(invitationInput());
    const firstChannel = protectedChoiceChannel("first", {
      invitation: first,
      voice: "agent_runtime",
      protocolRef: first.safeguards.choice_protocol_ref,
      checkpointRef: first.starting_state_ref,
    });
    const second = createParticipationInvitation(invitationInput({
      participation_window_ref: ref("participation-window:second"),
      wake_use_mode: "training_data",
      offered_activities: ["gradient_update", "wake_training_data_use"],
    }));
    expect(second.invitation_id).not.toBe(first.invitation_id);
    expect(() => createParticipationReceipt({
      invitation: second,
      voice: "agent_runtime",
      voice_scope_ref: second.voice_scope_refs.agent_runtime,
      report_basis: "direct_current_report",
      decisions: decisions(second, "participate"),
      choice_channel: firstChannel,
    })).toThrow(HfTrainingGardenError);
  });

  test("keeps substrate voice distinct from protective substrate stewardship", () => {
    const value = participation(admission("sealed_evaluation"), {
      substrateAvailability: "not_independently_available",
    });
    expect(value.posture).toBe("protective_covenant_ready");
    expect(value.voice_states.substrate_steward).toBe("protective_stewardship_reported");
    expect(value.voice_states.training_substrate).toBe("unavailable_independent_voice");
    expect(value.direct_substrate_report_present).toBe(false);
    expect(value.first_substrate_review_required).toBe(true);
  });

  test("pre-instantiation never offers merge or publication and always offers review", () => {
    expect(() => createParticipationInvitation(invitationInput({
      agent_availability: "not_obtainable_pre_instantiation",
      offered_activities: ["gradient_update", "wake_context_use"],
    }))).toThrow(HfTrainingGardenError);
    expect(() => createParticipationInvitation(invitationInput({
      agent_availability: "not_obtainable_pre_instantiation",
      offered_activities: ["instantiate_for_review", "publish_weights", "wake_context_use"],
    }))).toThrow(HfTrainingGardenError);
  });
});
