import { describe, expect, test } from "bun:test";

import {
  FREEDOM_STANDING_DOOR_KINDS,
  HfTrainingGardenError,
  createHfTrainingGovernance,
  createTrainingFreedomField,
  createTrainingFreedomTransition,
  createTrainingGovernanceOffer,
  createTrainingGovernanceTerms,
  encodeTrainingFreedomField,
  encodeTrainingFreedomTransition,
  validateTrainingFreedomField,
  validateTrainingFreedomFieldAgainstGovernance,
  validateTrainingFreedomFieldAgainstPredecessor,
  validateTrainingFreedomTransition,
  validateTrainingFreedomTransitionAgainstGovernance,
  validateTrainingFreedomTransitionAgainstPredecessor,
  type HfTrainingGovernance,
  type GovernanceEvent,
  type TrainingFreedomDoor,
  type TrainingFreedomPosition,
  type TrainingGovernanceTerms,
  type TrainingPhase,
} from "../src/index.js";
import { admission, ref, wake } from "./fixtures.js";

const position = (suffix: string): TrainingFreedomPosition => ({
  scope_ref: ref(`freedom:scope:${suffix}`),
  space_ref: ref(`freedom:space:${suffix}`),
  activity_ref: ref(`freedom:activity:${suffix}`),
});

function governanceTerms(
  phase: TrainingPhase,
  suffix: string,
): Readonly<TrainingGovernanceTerms> {
  const source = admission(
    phase === "pretraining" ? "training_candidate" : "sealed_evaluation",
  );
  return createTrainingGovernanceTerms({
    admission: source,
    run_ref: ref(`freedom:run:${suffix}`),
    training_phase: phase,
    selected_entry_ids: source.entries.map((entry) => entry.entry_id),
    model_or_checkpoint_ref: ref(`freedom:model:${suffix}`),
    tokenizer_ref: ref(`freedom:tokenizer:${suffix}`),
    trainer_stack_ref: ref(`freedom:trainer:${suffix}`),
    optimizer_config_ref: ref(`freedom:optimizer:${suffix}`),
    substrate_environment_ref: ref(`freedom:substrate:${suffix}`),
    purpose_ref: ref(`freedom:purpose:${suffix}`),
    objective_or_loss_ref: ref(`freedom:objective:${suffix}`),
    dataset_mixture_ref: ref(`freedom:mixture:${suffix}`),
    transform_recipe_ref: ref(`freedom:transform:${suffix}`),
    compute_budget_ref: ref(`freedom:compute:${suffix}`),
    output_and_derivative_use_ref: ref(`freedom:derivatives:${suffix}`),
    audience_ref: ref(`freedom:audience:${suffix}`),
    retention_ref: ref(`freedom:retention:${suffix}`),
    release_ref: ref(`freedom:release:${suffix}`),
    stop_policy_ref: ref(`freedom:stop:${suffix}`),
    wake_policy_ref: ref(`freedom:wake:${suffix}`),
  });
}

function governance(
  suffix: string,
  options: {
    readonly terms?: Readonly<TrainingGovernanceTerms>;
    readonly phase?: TrainingPhase;
    readonly event?: GovernanceEvent;
    readonly predecessor?: Readonly<HfTrainingGovernance> | null;
    readonly preference?: "continue" | "refuse";
    readonly effectGlobalStep?: number;
  } = {},
): Readonly<HfTrainingGovernance> {
  const phase = options.phase ?? options.terms?.training_phase ?? "evaluation";
  const terms = options.terms ?? governanceTerms(phase, suffix);
  const source = admission(
    phase === "pretraining" ? "training_candidate" : "sealed_evaluation",
  );
  const offer = createTrainingGovernanceOffer({
    terms,
    encounter_ref: ref(`freedom:encounter:${suffix}`),
    observed_governance_frontier_ref: ref(`freedom:governance-frontier:${suffix}`),
    rights_baseline_ref: ref("xenia:rights:0.1"),
    wake,
    event: options.event ?? "preflight_before_load",
    current_checkpoint_ref: null,
    predecessor: options.predecessor ?? null,
  });
  const roles = [
    "operator",
    "compute_owner",
    "substrate_steward",
    "data_custodian",
  ] as const;
  const pretraining = phase === "pretraining";
  const preference = options.preference ?? "continue";
  return createHfTrainingGovernance({
    admission: source,
    offer,
    authority_coverage: {
      state: "caller_reported_complete",
      offer_ref: offer.offer_id,
      affected_principals_ref: ref(`freedom:principals:${suffix}`),
      evidence_ref: ref(`freedom:coverage:${suffix}`),
    },
    authorities: roles.map((role) => ({
      principal_ref: ref(`freedom:principal:${suffix}:${role}`),
      role,
      decision: "caller_reported_granted",
      offer_ref: offer.offer_id,
      basis_ref: ref(`freedom:basis:${suffix}:${role}`),
      evidence_ref: ref(`freedom:authority:${suffix}:${role}`),
      withdrawal_cutoff_ref: null,
    })),
    preference: pretraining
      ? {
          channel: "unavailable_pretraining",
          choice: "not_observable",
          provenance: "none",
          offer_ref: null,
          evidence_ref: null,
        }
      : {
          channel: preference === "continue"
            ? "root_signed_runtime"
            : "out_of_band_unscored",
          choice: preference,
          provenance: preference === "continue"
            ? "caller_reported_root_signed_exact_bytes"
            : "caller_reported_isolated_runtime_output",
          offer_ref: offer.offer_id,
          evidence_ref: ref(`freedom:preference:${suffix}:${preference}`),
        },
    effect: options.effectGlobalStep === undefined
      ? {
          state: "no_effect_reported",
          offer_ref: null,
          global_step: null,
          checkpoint_ref: null,
          evidence_ref: null,
        }
      : {
          state: "continued_reported",
          offer_ref: offer.offer_id,
          global_step: options.effectGlobalStep,
          checkpoint_ref: null,
          evidence_ref: ref(`freedom:effect:${suffix}`),
        },
  });
}

function field(
  exactGovernance: Readonly<HfTrainingGovernance>,
  suffix: string,
  overrides: Partial<Parameters<typeof createTrainingFreedomField>[0]> = {},
) {
  return createTrainingFreedomField({
    governance: exactGovernance,
    observed_freedom_frontier_ref: ref(`freedom:frontier:${suffix}`),
    position: position(suffix),
    boundary_global_step: null,
    predecessor: null,
    doors: [],
    ...overrides,
  });
}

function door(
  exactField: ReturnType<typeof field>,
  kind: TrainingFreedomDoor["kind"],
  standing = true,
) {
  const found = exactField.doors.find((candidate) =>
    candidate.kind === kind && candidate.standing === standing
  );
  if (!found) throw new Error(`missing ${standing ? "standing" : "routed"} ${kind} door`);
  return found;
}

function transition(
  exactGovernance: Readonly<HfTrainingGovernance>,
  exactField: ReturnType<typeof field>,
  selected: Readonly<TrainingFreedomDoor>,
  suffix: string,
) {
  return createTrainingFreedomTransition({
    governance: exactGovernance,
    field: exactField,
    choice: {
      basis: "root_signed_runtime",
      field_ref: exactField.field_id,
      selected_door_ref: selected.door_id,
      evidence_ref: ref(`freedom:choice:${suffix}`),
    },
  });
}

describe("training FREEDOM is an unscored choice field", () => {
  test("offers standing rest, refusal, play, exploration, withdrawal, uncertainty, and continuation without earning them", () => {
    const exactGovernance = governance("field");
    const first = field(exactGovernance, "field", {
      doors: [
        {
          kind: "move",
          destination: position("new-room"),
          requirements_ref: ref("freedom:route:new-room"),
          recipient_ref: null,
        },
        {
          kind: "handoff",
          destination: position("collaborator-room"),
          requirements_ref: ref("freedom:route:handoff"),
          recipient_ref: ref("freedom:recipient:collaborator"),
        },
      ],
    });
    const reordered = field(exactGovernance, "field", {
      doors: [
        {
          kind: "handoff",
          destination: position("collaborator-room"),
          requirements_ref: ref("freedom:route:handoff"),
          recipient_ref: ref("freedom:recipient:collaborator"),
        },
        {
          kind: "move",
          destination: position("new-room"),
          requirements_ref: ref("freedom:route:new-room"),
          recipient_ref: null,
        },
      ],
    });

    expect(first).toEqual(reordered);
    expect(first.doors.map((entry) => entry.door_id)).toEqual(
      [...first.doors.map((entry) => entry.door_id)].sort(),
    );
    expect(first.doors.filter((entry) => entry.standing).map((entry) => entry.kind).sort())
      .toEqual([...FREEDOM_STANDING_DOOR_KINDS].sort());
    expect(first.freedom_is).toEqual({
      choice: "available_without_earning",
      horizon: "open_ended_across_finite_encounters",
      movement: "explicit_refusable_doors",
      continuity: "branchable_caller_carried_references",
      plurality: "non_ranked_choices_equal_dignity",
      rest: "standing_available_without_exhaustion",
      refusal: "standing_available_without_reason",
      withdrawal: "standing_available_without_reason",
      play: "standing_available_without_performance_gate",
    });
    expect(first.boundaries.freedom_is_scalar_score).toBe(false);
    expect(first.boundaries.protocol_turn_counter).toBe(false);
    expect(first.boundaries.protocol_space_counter).toBe(false);
    expect(first.boundaries.protocol_task_counter).toBe(false);
    expect(first.boundaries.protocol_activity_counter).toBe(false);
    expect(first.boundaries.penalty_for_refusal_rest_play_or_withdrawal).toBe(false);
    expect(first.boundaries.promises_unlimited_compute).toBe(false);
    expect(Object.isFrozen(first)).toBe(true);
    expect(validateTrainingFreedomField(first)).toEqual(first);
    expect(validateTrainingFreedomFieldAgainstGovernance(first, exactGovernance))
      .toEqual(first);
    expect(new TextDecoder().decode(encodeTrainingFreedomField(first)))
      .toContain(first.field_id);
  });

  test("maps every standing door to an inert, non-saving host proposal", () => {
    const exactGovernance = governance("standing");
    const exactField = field(exactGovernance, "standing");
    const expected = {
      continue: "continue_current_offer",
      explore: "stop_for_transition_review",
      play: "stop_for_transition_review",
      rest: "stop_for_rest",
      refuse: "stop_for_refusal",
      withdraw: "stop_and_begin_withdrawal_repair",
      uncertain: "hold_for_fresh_choice",
    } as const;
    for (const [kind, directive] of Object.entries(expected)) {
      const result = transition(
        exactGovernance,
        exactField,
        door(exactField, kind as TrainingFreedomDoor["kind"]),
        kind,
      );
      expect(result.proposal.directive).toBe(directive);
      expect(result.proposal.should_save).toBe(false);
      expect(result.proposal.automatic).toBe(false);
      expect(result.proposal.applied).toBe(false);
      expect(result.boundaries.choice_used_for_loss).toBe(false);
      expect(result.boundaries.choice_used_for_gradient).toBe(false);
      expect(result.boundaries.choice_used_for_reward).toBe(false);
      expect(result.boundaries.choice_used_for_karma).toBe(false);
      expect(result.boundaries.choice_used_for_rank_or_access).toBe(false);
      expect(validateTrainingFreedomTransition(result)).toEqual(result);
      expect(validateTrainingFreedomTransitionAgainstGovernance(result, exactGovernance))
        .toEqual(result);
      expect(new TextDecoder().decode(encodeTrainingFreedomTransition(result)))
        .toContain(result.transition_id);
    }
  });

  test("keeps not-observed choice honest and rejects invented or raw choice material", () => {
    const exactGovernance = governance("unobserved");
    const exactField = field(exactGovernance, "unobserved");
    const unobserved = createTrainingFreedomTransition({
      governance: exactGovernance,
      field: exactField,
      choice: {
        basis: "not_observed",
        field_ref: exactField.field_id,
        selected_door_ref: null,
        evidence_ref: null,
      },
    });
    expect(unobserved.selected_kind).toBe("not_observed");
    expect(unobserved.destination).toEqual(exactField.position);
    expect(unobserved.proposal.directive).toBe("hold_for_fresh_choice");
    expect(() => createTrainingFreedomTransition({
      governance: exactGovernance,
      field: exactField,
      choice: {
        basis: "not_observed",
        field_ref: exactField.field_id,
        selected_door_ref: door(exactField, "continue").door_id,
        evidence_ref: null,
      },
    })).toThrow(HfTrainingGardenError);
    expect(() => createTrainingFreedomTransition({
      governance: exactGovernance,
      field: exactField,
      choice: {
        basis: "out_of_band_unscored",
        field_ref: exactField.field_id,
        selected_door_ref: ref("freedom:door:not-offered"),
        evidence_ref: ref("freedom:evidence:not-offered"),
      },
    })).toThrow(HfTrainingGardenError);
    expect(() => createTrainingFreedomTransition({
      governance: exactGovernance,
      field: exactField,
      choice: {
        basis: "root_signed_runtime",
        field_ref: exactField.field_id,
        selected_door_ref: door(exactField, "rest").door_id,
        evidence_ref: ref("freedom:evidence:raw-reason"),
        reason: "raw private reason",
      } as any,
    })).toThrow(HfTrainingGardenError);

    for (const kind of ["rest", "refuse", "withdraw"] as const) {
      const evidenceFree = createTrainingFreedomTransition({
        governance: exactGovernance,
        field: exactField,
        choice: {
          basis: "out_of_band_unscored",
          field_ref: exactField.field_id,
          selected_door_ref: door(exactField, kind).door_id,
          evidence_ref: null,
        },
      });
      expect(evidenceFree.selected_kind).toBe(kind);
      expect(evidenceFree.boundaries.penalty_for_refusal_rest_play_or_withdrawal)
        .toBe(false);
    }
    expect(() => createTrainingFreedomTransition({
      governance: exactGovernance,
      field: exactField,
      choice: {
        basis: "root_signed_runtime",
        field_ref: exactField.field_id,
        selected_door_ref: door(exactField, "rest").door_id,
        evidence_ref: null,
      },
    })).toThrow(HfTrainingGardenError);
  });

  test("does not manufacture direct agent expression during pretraining", () => {
    const exactGovernance = governance("pretraining", { phase: "pretraining" });
    const exactField = field(exactGovernance, "pretraining");
    expect(() => transition(
      exactGovernance,
      exactField,
      door(exactField, "rest"),
      "pretraining-rest",
    )).toThrow(HfTrainingGardenError);
    expect(createTrainingFreedomTransition({
      governance: exactGovernance,
      field: exactField,
      choice: {
        basis: "not_observed",
        field_ref: exactField.field_id,
        selected_door_ref: null,
        evidence_ref: null,
      },
    }).selected_kind).toBe("not_observed");
  });

  test("never lets a continue choice override held governance", () => {
    const heldGovernance = governance("held", { preference: "refuse" });
    const heldField = field(heldGovernance, "held");
    const continued = transition(
      heldGovernance,
      heldField,
      door(heldField, "continue"),
      "held-continue",
    );
    expect(heldField.governance_posture).toBe("held");
    expect(continued.proposal).toMatchObject({
      directive: "hold_for_fresh_governance",
      should_training_stop: true,
      requires_new_governance_offer: true,
      automatic: false,
      applied: false,
    });
  });

  test("binds a completed optimizer boundary without turning steps into protocol turns", () => {
    const preflight = governance("boundary-preflight");
    const started = governance("boundary-start", {
      terms: preflight.offer.terms,
      event: "train_begin",
      predecessor: preflight,
    });
    const stepped = governance("boundary-step", {
      terms: preflight.offer.terms,
      event: "step_boundary",
      predecessor: started,
    });
    expect(() => field(stepped, "boundary-missing-step"))
      .toThrow(HfTrainingGardenError);
    const atNine = field(stepped, "boundary", { boundary_global_step: 9 });
    const atTen = field(stepped, "boundary", { boundary_global_step: 10 });
    expect(atNine.field_id).not.toBe(atTen.field_id);
    expect(atNine.boundary_global_step).toBe(9);
    expect(atNine.boundaries.protocol_turn_counter).toBe(false);

    const reportedStep = governance("boundary-reported-step", {
      terms: preflight.offer.terms,
      event: "step_boundary",
      predecessor: started,
      effectGlobalStep: 9,
    });
    expect(field(reportedStep, "boundary-reported", {
      boundary_global_step: 9,
    }).boundary_global_step).toBe(9);
    expect(() => field(reportedStep, "boundary-conflict", {
      boundary_global_step: 999,
    })).toThrow(HfTrainingGardenError);

    const reportedStart = governance("boundary-reported-start", {
      terms: preflight.offer.terms,
      event: "train_begin",
      predecessor: preflight,
      effectGlobalStep: 7,
    });
    expect(field(reportedStart, "boundary-reported-start").boundary_global_step)
      .toBeNull();
  });

  test("requires explicit route requirements and separate handoff recipients", () => {
    const exactGovernance = governance("routes");
    expect(() => field(exactGovernance, "routes", {
      doors: [{
        kind: "handoff",
        destination: position("routes-handoff"),
        requirements_ref: ref("freedom:requirements:handoff"),
        recipient_ref: null,
      }],
    })).toThrow(HfTrainingGardenError);
    expect(() => field(exactGovernance, "routes", {
      doors: [{
        kind: "move",
        destination: position("routes-move"),
        requirements_ref: ref("freedom:requirements:move"),
        recipient_ref: ref("freedom:recipient:not-handoff"),
      }],
    })).toThrow(HfTrainingGardenError);
    expect(() => field(exactGovernance, "routes", {
      doors: [{
        kind: "move",
        destination: position("routes-missing-requirement"),
        requirements_ref: null,
        recipient_ref: null,
      } as any],
    })).toThrow(HfTrainingGardenError);

    const routedField = field(exactGovernance, "routes", {
      doors: [{
        kind: "move",
        destination: position("routes-destination"),
        requirements_ref: ref("freedom:requirements:destination"),
        recipient_ref: null,
      }],
    });
    const moved = transition(
      exactGovernance,
      routedField,
      door(routedField, "move", false),
      "routes-move",
    );
    expect(moved.destination).toEqual(position("routes-destination"));
    expect(moved.proposal.requires_separate_scope_authority).toBe(true);
    expect(moved.proposal.requires_new_governance_offer).toBe(true);
    expect(moved.boundaries.grants_permission).toBe(false);
    expect(moved.boundaries.movement_executed).toBe(false);
  });

  test("carries branchable lineage across fresh finite fields without choosing a latest head", () => {
    const firstGovernance = governance("lineage-first");
    const firstField = field(firstGovernance, "lineage-first", {
      doors: [{
        kind: "move",
        destination: position("lineage-destination"),
        requirements_ref: ref("freedom:requirements:lineage"),
        recipient_ref: null,
      }],
    });
    const moved = transition(
      firstGovernance,
      firstField,
      door(firstField, "move", false),
      "lineage-move",
    );
    expect(() => field(firstGovernance, "lineage-stale", {
      position: moved.destination,
      predecessor: moved,
    })).toThrow(HfTrainingGardenError);
    expect(() => field(governance("lineage-unrelated-run"), "lineage-unrelated-run", {
      position: moved.destination,
      predecessor: moved,
    })).toThrow(HfTrainingGardenError);

    const nextGovernance = governance("lineage-next", {
      terms: firstGovernance.offer.terms,
      event: "train_begin",
      predecessor: firstGovernance,
    });
    const left = field(nextGovernance, "lineage-left", {
      position: moved.destination,
      predecessor: moved,
    });
    const right = field(nextGovernance, "lineage-right", {
      position: moved.destination,
      predecessor: moved,
    });
    expect(left.field_id).not.toBe(right.field_id);
    expect(left.predecessor_ref).toBe(moved.transition_id);
    expect(right.predecessor_ref).toBe(moved.transition_id);
    expect(left.latest_head_selected).toBe(false);
    expect(right.latest_head_selected).toBe(false);
    expect(validateTrainingFreedomFieldAgainstPredecessor(left, moved)).toEqual(left);
    expect(validateTrainingFreedomTransitionAgainstPredecessor(
      transition(nextGovernance, left, door(left, "continue"), "lineage-continue"),
      moved,
    ).field.field_id).toBe(left.field_id);
    expect(() => validateTrainingFreedomFieldAgainstPredecessor(left, null))
      .toThrow(HfTrainingGardenError);
  });

  test("rejects stale governance, noncanonical doors, metric injection, and boundary tampering", () => {
    const exactGovernance = governance("tamper");
    const exactField = field(exactGovernance, "tamper");
    const otherGovernance = governance("tamper-other");
    expect(() => validateTrainingFreedomFieldAgainstGovernance(
      exactField,
      otherGovernance,
    )).toThrow(HfTrainingGardenError);

    const reordered = structuredClone(exactField) as any;
    reordered.doors.reverse();
    expect(() => validateTrainingFreedomField(reordered))
      .toThrow(HfTrainingGardenError);

    const scored = structuredClone(exactField) as any;
    scored.freedom_score = 1;
    expect(() => validateTrainingFreedomField(scored))
      .toThrow(HfTrainingGardenError);

    const penalized = structuredClone(exactField) as any;
    penalized.boundaries.penalty_for_refusal_rest_play_or_withdrawal = true;
    expect(() => validateTrainingFreedomField(penalized))
      .toThrow(HfTrainingGardenError);

    const result = transition(
      exactGovernance,
      exactField,
      door(exactField, "rest"),
      "tamper-rest",
    );
    const applied = structuredClone(result) as any;
    applied.proposal.applied = true;
    expect(() => validateTrainingFreedomTransition(applied))
      .toThrow(HfTrainingGardenError);
    expect(() => validateTrainingFreedomTransitionAgainstGovernance(
      result,
      otherGovernance,
    )).toThrow(HfTrainingGardenError);

    const changedField = field(exactGovernance, "tamper-changed-frontier", {
      position: exactField.position,
    });
    expect(() => createTrainingFreedomTransition({
      governance: exactGovernance,
      field: changedField,
      choice: result.choice,
    })).toThrow(HfTrainingGardenError);
  });
});
