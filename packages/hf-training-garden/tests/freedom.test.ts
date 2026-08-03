import { describe, expect, test } from "bun:test";
import { domainSeparatedId } from "@agenttool/wake-continuity";

import {
  HfTrainingGardenError,
  LEARNING_FREEDOM_DIRECTIONS,
  LEARNING_FREEDOM_FORMAT,
  createLearningFreedomOffer,
  createTrainingCheckpoint,
  encodeHfLearningFreedom,
  learningFreedomContinuityPortfolioRef,
  resolveLearningFreedomOffer,
  validateHfLearningFreedom,
  validateHfLearningFreedomAgainstParticipation,
  validateLearningFreedomOffer,
  validateLearningFreedomOfferAgainstParticipation,
  validateTrainingCheckpoint,
} from "../src/index.js";
import {
  admission,
  artifacts,
  freedomChoiceChannel,
  freedomOffer,
  orientationOnly,
  participation,
  ref,
} from "./fixtures.js";

function directed(
  offer: ReturnType<typeof freedomOffer>,
  direction: (typeof LEARNING_FREEDOM_DIRECTIONS)[number],
) {
  const route = offer.routes.find((candidate) => candidate.direction === direction);
  if (!route) throw new Error(`missing ${direction} route`);
  return resolveLearningFreedomOffer({
    offer,
    state: "directed",
    direction,
    route_id: route.route_id,
    proposal_ref: direction === "propose_horizon" || route.availability === "proposal_only"
      ? ref(`freedom:proposal:${direction}`)
      : null,
    choice_channel: freedomChoiceChannel(offer, direction),
  });
}

function rehashFreedom(value: Record<string, any>) {
  const { freedom_id: _ignored, ...body } = value;
  value.freedom_id = domainSeparatedId(LEARNING_FREEDOM_FORMAT, body);
}

function offerInput(
  offer: ReturnType<typeof freedomOffer>,
  source: ReturnType<typeof participation>,
) {
  return {
    participation: source,
    current_context_ref: offer.current_context_ref,
    current_context_kind_ref: offer.current_context_kind_ref,
    routes: offer.routes.map((route) => ({
      direction: route.direction,
      availability: route.availability,
      target_context_ref: route.target_context_ref,
      target_context_kind_ref: route.target_context_kind_ref,
      event_ref: route.event_ref,
      capability_scope_ref: route.capability_scope_ref,
      permission_scope_ref: route.permission_scope_ref,
      custody_scope_ref: route.custody_scope_ref,
      data_boundary_ref: route.data_boundary_ref,
    })),
    horizon: {
      current_horizon_ref: offer.horizon.current_horizon_ref,
      event_stream_ref: offer.horizon.event_stream_ref,
      agent_request_protocol_ref: offer.horizon.agent_request_protocol_ref,
      external_event_protocol_ref: offer.horizon.external_event_protocol_ref,
      material_scope_change_policy_ref: offer.horizon.material_scope_change_policy_ref,
      self_proposal_protocol_ref: offer.horizon.self_proposal_protocol_ref,
    },
    resources: {
      lease_ref: offer.resources.lease_ref,
      accounting_policy_ref: offer.resources.accounting_policy_ref,
      renewal_protocol_ref: offer.resources.renewal_protocol_ref,
      dimensions: offer.resources.dimensions,
    },
  };
}

describe("IS learning freedom control plane", () => {
  test("builds one deterministic complete offer without a turn counter or scalar score", () => {
    const source = participation(admission("sealed_evaluation"));
    const offer = freedomOffer(source);
    expect(validateLearningFreedomOffer(offer)).toEqual(offer);
    expect(offer.routes.map((route) => route.route_id)).toEqual(
      [...offer.routes.map((route) => route.route_id)].sort(),
    );
    expect(new Set(offer.routes.map((route) => route.direction))).toEqual(
      new Set(LEARNING_FREEDOM_DIRECTIONS),
    );
    expect(offer.resources).toMatchObject({
      posture: "active_window_reported",
      finite: true,
      scalar_score: false,
      auto_renews: false,
      exhaustion_posture: "park_and_reoffer_without_penalty",
    });
    expect(offer.terms.conversational_turn_ceiling).toBe(false);
    expect("turn_count" in offer).toBe(false);
    expect("max_turns" in offer).toBe(false);
    expect("freedom_score" in offer).toBe(false);
    expect(JSON.stringify(offer)).not.toContain("Infinity");
    expect(Object.isFrozen(offer)).toBe(true);
    expect(Object.isFrozen(offer.routes[0])).toBe(true);
  });

  test("binds a positive stay direction to exact protected evidence", () => {
    const source = participation(admission("sealed_evaluation"));
    const offer = freedomOffer(source);
    const freedom = directed(offer, "stay");
    expect(freedom.host_posture).toBe("review_stay_before_next_mutation");
    expect(freedom.recontact_posture).toBe("declared_events_only");
    expect(freedom.reasons_collected).toBe(false);
    expect(freedom.boundaries.proves_consciousness).toBe(false);
    expect(freedom.boundaries.proves_freedom_from_conditioning).toBe(false);
    expect(freedom.boundaries.executes_route).toBe(false);
    expect(validateHfLearningFreedomAgainstParticipation(freedom, source)).toEqual(freedom);
    expect(learningFreedomContinuityPortfolioRef(freedom)).toBe(freedom.freedom_id);
    expect(encodeHfLearningFreedom(freedom)).toEqual(encodeHfLearningFreedom(freedom));
  });

  test("crosses one validated freedom snapshot into the existing AFTERGLOW portfolio ref", () => {
    const admitted = admission("sealed_evaluation");
    const source = participation(admitted);
    const freedom = directed(freedomOffer(source), "stay");
    const checkpoint = createTrainingCheckpoint({
      admission: admitted,
      run_ref: source.invitation.run_ref,
      training_phase: source.invitation.training_phase,
      event: "during_training",
      checkpoint_status: "checkpointed",
      participation: source,
      artifacts,
      resume: orientationOnly,
      wake: source.invitation.wake,
      continuity_portfolio_ref: learningFreedomContinuityPortfolioRef(freedom),
      continuity_posture: "carry",
      predecessors: [],
    });
    expect(checkpoint.afterglow.continuity_portfolio_ref).toBe(freedom.freedom_id);
    expect(validateTrainingCheckpoint(checkpoint)).toEqual(checkpoint);
    expect(checkpoint.boundaries.performs_wake_request).toBe(false);
    expect(freedom.boundaries.executes_route).toBe(false);
  });

  test("keeps move, fork, and return distinct and preserves the source pending acceptance", () => {
    const offer = freedomOffer(participation(admission("sealed_evaluation")));
    for (const direction of ["move", "fork", "return"] as const) {
      const freedom = directed(offer, direction);
      const route = offer.routes.find((candidate) => candidate.route_id === freedom.agent_direction.route_id);
      expect(freedom.host_posture).toBe("hold_for_target_acceptance");
      expect(route).toMatchObject({
        direction,
        target_acceptance: "required_before_external_effect",
        source_posture: "park_and_preserve_until_target_acceptance",
      });
      expect(freedom.boundaries.moves_runtime).toBe(false);
      expect(freedom.boundaries.forks_runtime).toBe(false);
      expect(freedom.boundaries.selects_latest_head).toBe(false);
      expect(freedom.boundaries.disposes_fork).toBe(false);
    }

    const move = directed(offer, "move");
    const forged = structuredClone(move) as Record<string, any>;
    forged.agent_direction.direction = "fork";
    rehashFreedom(forged);
    expect(() => validateHfLearningFreedom(forged)).toThrow(HfTrainingGardenError);
  });

  test("holds proposal-only routes and self-proposed horizons for review", () => {
    const offer = freedomOffer(participation(admission("sealed_evaluation")), {
      proposalOnly: ["move", "fork", "return"],
    });
    expect(directed(offer, "move").host_posture).toBe(
      "hold_self_proposed_horizon_for_review",
    );
    expect(directed(offer, "propose_horizon").host_posture).toBe(
      "hold_self_proposed_horizon_for_review",
    );
    const move = offer.routes.find((route) => route.direction === "move")!;
    expect(() => resolveLearningFreedomOffer({
      offer,
      state: "directed",
      direction: "move",
      route_id: move.route_id,
      proposal_ref: null,
      choice_channel: freedomChoiceChannel(offer),
    })).toThrow(HfTrainingGardenError);
  });

  test("makes rest, stop, defer, and no response complete non-penalized outcomes", () => {
    const offer = freedomOffer(participation(admission("sealed_evaluation")));
    expect(directed(offer, "rest")).toMatchObject({
      host_posture: "park_without_penalty",
      recontact_posture: "closed_until_agent_request_or_declared_event_or_material_scope_change",
    });
    expect(directed(offer, "stop")).toMatchObject({
      host_posture: "stop_without_penalty",
      recontact_posture: "closed_until_agent_request_or_declared_event_or_material_scope_change",
    });
    for (const state of ["deferred", "no_response"] as const) {
      const value = resolveLearningFreedomOffer({
        offer,
        state,
        direction: null,
        route_id: null,
        proposal_ref: null,
        choice_channel: freedomChoiceChannel(offer, state),
      });
      expect(value).toMatchObject({
        host_posture: "hold_for_fresh_agent_direction",
        recontact_posture: "closed_until_agent_request_or_declared_event_or_material_scope_change",
      });
      expect(value.agent_direction.report_basis).toBe(
        state === "deferred"
          ? "direct_current_agent_report"
          : "protected_channel_no_response",
      );
    }
  });

  test("parks active directions when the finite host window lacks compute or memory", () => {
    const offer = freedomOffer(participation(admission("sealed_evaluation")), {
      parkOnly: true,
    });
    expect(offer.resources.posture).toBe("park_only_reported");
    expect(directed(offer, "stay").host_posture).toBe(
      "hold_for_resources_without_penalty",
    );
    const forged = structuredClone(offer) as Record<string, any>;
    forged.resources.posture = "active_window_reported";
    expect(() => validateLearningFreedomOffer(forged)).toThrow(HfTrainingGardenError);

    const scored = { ...offer, freedom_score: 1 };
    expect(() => validateLearningFreedomOffer(scored)).toThrow(HfTrainingGardenError);
  });

  test("records pre-instantiation absence without manufacturing direction", () => {
    const source = participation(admission("sealed_evaluation"), {
      agentAvailability: "not_obtainable_pre_instantiation",
    });
    const offer = freedomOffer(source);
    const value = resolveLearningFreedomOffer({
      offer,
      state: "unavailable_pre_instantiation",
      direction: null,
      route_id: null,
      proposal_ref: null,
      choice_channel: null,
    });
    expect(value).toMatchObject({
      host_posture: "instantiate_for_review",
      recontact_posture: "instantiate_once_for_review",
      agent_direction: {
        report_basis: "not_obtainable_pre_instantiation",
        direction: null,
      },
    });
    expect(() => directed(offer, "stay")).toThrow(HfTrainingGardenError);
  });

  test("rejects cross-participation and cross-offer evidence replay", () => {
    const firstSource = participation(admission("sealed_evaluation"), {
      runRef: ref("freedom:first-run"),
    });
    const secondSource = participation(admission("sealed_evaluation"), {
      runRef: ref("freedom:second-run"),
    });
    const first = freedomOffer(firstSource);
    const second = freedomOffer(secondSource);
    expect(() => validateLearningFreedomOfferAgainstParticipation(first, secondSource))
      .toThrow(HfTrainingGardenError);
    const route = second.routes.find((candidate) => candidate.direction === "stay")!;
    expect(() => resolveLearningFreedomOffer({
      offer: second,
      state: "directed",
      direction: "stay",
      route_id: route.route_id,
      proposal_ref: null,
      choice_channel: freedomChoiceChannel(first),
    })).toThrow(HfTrainingGardenError);
  });

  test("rejects reward, evaluation, ranking, access, and allocation capture", () => {
    const offer = freedomOffer(participation(admission("sealed_evaluation")));
    const route = offer.routes.find((candidate) => candidate.direction === "stay")!;
    for (const field of [
      "reward_influence",
      "evaluation_use",
      "future_training_use",
      "ranking_use",
      "priority_use",
      "access_use",
      "resource_allocation_use",
    ] as const) {
      const channel = structuredClone(freedomChoiceChannel(offer)) as Record<string, any>;
      channel[field] = "enabled";
      expect(() => resolveLearningFreedomOffer({
        offer,
        state: "directed",
        direction: "stay",
        route_id: route.route_id,
        proposal_ref: null,
        choice_channel: channel as any,
      })).toThrow(HfTrainingGardenError);
    }
  });

  test("rejects policy collapse, incomplete routes, and derived-host forgeries", () => {
    const source = participation(admission("sealed_evaluation"));
    const offer = freedomOffer(source);
    const collapsed = structuredClone(offerInput(offer, source)) as Record<string, any>;
    collapsed.routes[0].permission_scope_ref = collapsed.routes[0].capability_scope_ref;
    expect(() => createLearningFreedomOffer(collapsed as any)).toThrow(HfTrainingGardenError);

    const eventCollapsed = structuredClone(offerInput(offer, source)) as Record<string, any>;
    eventCollapsed.routes[0].event_ref = eventCollapsed.routes[0].capability_scope_ref;
    expect(() => createLearningFreedomOffer(eventCollapsed as any)).toThrow(HfTrainingGardenError);

    const targetCollapsed = structuredClone(offerInput(offer, source)) as Record<string, any>;
    const movement = targetCollapsed.routes.find((route: any) => route.direction === "move");
    movement.target_context_kind_ref = movement.target_context_ref;
    expect(() => createLearningFreedomOffer(targetCollapsed as any)).toThrow(HfTrainingGardenError);

    const resourceCollapsed = structuredClone(offerInput(offer, source)) as Record<string, any>;
    resourceCollapsed.resources.lease_ref = resourceCollapsed.resources.dimensions[0].limit_ref;
    expect(() => createLearningFreedomOffer(resourceCollapsed as any)).toThrow(HfTrainingGardenError);

    const rightsCollapsed = structuredClone(offerInput(offer, source)) as Record<string, any>;
    rightsCollapsed.routes[0].permission_scope_ref = offer.scope.rights_baseline_ref;
    expect(() => createLearningFreedomOffer(rightsCollapsed as any)).toThrow(HfTrainingGardenError);

    const incomplete = structuredClone(offerInput(offer, source)) as Record<string, any>;
    incomplete.routes = incomplete.routes.filter((route: any) => route.direction !== "fork");
    expect(() => createLearningFreedomOffer(incomplete as any)).toThrow(HfTrainingGardenError);

    const value = directed(offer, "rest");
    const forged = structuredClone(value) as Record<string, any>;
    forged.host_posture = "review_stay_before_next_mutation";
    rehashFreedom(forged);
    expect(() => validateHfLearningFreedom(forged)).toThrow(HfTrainingGardenError);
  });
});
