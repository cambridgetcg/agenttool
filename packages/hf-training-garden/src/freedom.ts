import type { Sha256Id } from "@agenttool/wake-continuity";

import { validateParticipationAssessment } from "./participation.js";
import {
  LEARNING_FREEDOM_BOUNDARIES,
  LEARNING_FREEDOM_DIRECTIONS,
  LEARNING_FREEDOM_DIRECTION_STATES,
  LEARNING_FREEDOM_FORMAT,
  LEARNING_FREEDOM_HOST_POSTURES,
  LEARNING_FREEDOM_OFFER_PROFILE,
  LEARNING_FREEDOM_PROMPT_ENVELOPE_PROFILE,
  LEARNING_FREEDOM_RECONTACT_POSTURES,
  LEARNING_FREEDOM_RESOURCE_DIMENSIONS,
  LEARNING_FREEDOM_RESOURCE_POSTURES,
  LEARNING_FREEDOM_RESOURCE_STATES,
  LEARNING_FREEDOM_RESOURCE_WINDOW_PROFILE,
  LEARNING_FREEDOM_ROUTE_AVAILABILITIES,
  LEARNING_FREEDOM_ROUTE_PROFILE,
  LEARNING_FREEDOM_TERMS,
  WAKE_USE_MODES,
} from "./constants.js";
import {
  canonicalBytes,
  compareText,
  contentId,
  deepFreeze,
  type DataValue,
} from "./canonical.js";
import { fail, type HfTrainingGardenErrorCode } from "./errors.js";
import type {
  AgentAvailability,
  CreateLearningFreedomOfferInput,
  CreateLearningFreedomRouteInput,
  HfLearningFreedom,
  LearningFreedomAgentDirection,
  LearningFreedomDirection,
  LearningFreedomDirectionState,
  LearningFreedomHorizon,
  LearningFreedomHostPosture,
  LearningFreedomOffer,
  LearningFreedomRecontactPosture,
  LearningFreedomResourceDimensionEntry,
  LearningFreedomResourcePosture,
  LearningFreedomResourceState,
  LearningFreedomResourceWindow,
  LearningFreedomRoute,
  LearningFreedomRouteAvailability,
  LearningFreedomScope,
  LearningParticipationAssessment,
  ProtectedLearningFreedomChoiceChannelReport,
  ResolveLearningFreedomOfferInput,
  TrainingPhase,
  WakeUseMode,
} from "./types.js";
import {
  array,
  assertDataEqual,
  exactKeys,
  literal,
  parseTrainingPhase,
  parseWake,
  record,
  sha256,
  snap,
} from "./validation.js";

type OfferCode = "freedom_offer_input_invalid" | "freedom_offer_invalid";
type FreedomCode = "freedom_input_invalid" | "freedom_invalid";
type ResourceBody = Omit<LearningFreedomResourceWindow, "window_id">;
type RouteBody = Omit<LearningFreedomRoute, "route_id">;
type OfferBody = Omit<LearningFreedomOffer, "offer_id">;
type FreedomBody = Omit<HfLearningFreedom, "freedom_id">;

const DIRECT_DIRECTIONS = new Set<LearningFreedomDirection>([
  "move",
  "fork",
  "return",
]);
const LOCAL_DIRECTIONS = new Set<LearningFreedomDirection>([
  "stay",
  "rest",
  "stop",
  "propose_horizon",
]);

function resourceBody(value: ResourceBody): ResourceBody {
  return value;
}

function routeBody(value: RouteBody): RouteBody {
  return value;
}

function offerBody(value: OfferBody): OfferBody {
  return value;
}

function freedomBody(value: FreedomBody): FreedomBody {
  return value;
}

function distinctRefs(
  values: readonly Sha256Id[],
  path: string,
  code: HfTrainingGardenErrorCode,
): void {
  if (new Set(values).size !== values.length) {
    fail(code, `${path} must keep independently scoped references distinct`);
  }
}

function parseResourceDimensions(
  value: DataValue | undefined,
  path: string,
  code: OfferCode,
  requireCanonicalOrder: boolean,
): readonly Readonly<LearningFreedomResourceDimensionEntry>[] {
  const values = array(value, path, code);
  if (values.length !== LEARNING_FREEDOM_RESOURCE_DIMENSIONS.length) {
    fail(code, `${path} must declare every non-scalar resource dimension exactly once`);
  }
  const entries = values.map((entry, index) => {
    const entryPath = `${path}[${String(index)}]`;
    const candidate = record(entry, entryPath, code);
    exactKeys(candidate, ["dimension", "limit_ref", "state"], entryPath, code);
    return deepFreeze({
      dimension: literal(
        candidate.dimension,
        LEARNING_FREEDOM_RESOURCE_DIMENSIONS,
        `${entryPath}.dimension`,
        code,
      ),
      limit_ref: sha256(candidate.limit_ref, `${entryPath}.limit_ref`, code),
      state: literal(
        candidate.state,
        LEARNING_FREEDOM_RESOURCE_STATES,
        `${entryPath}.state`,
        code,
      ) as LearningFreedomResourceState,
    });
  });
  if (new Set(entries.map((entry) => entry.dimension)).size !== entries.length) {
    fail(code, `${path} contains a duplicate resource dimension`);
  }
  const byDimension = new Map(entries.map((entry) => [entry.dimension, entry]));
  const normalized = LEARNING_FREEDOM_RESOURCE_DIMENSIONS.map((dimension) => {
    const entry = byDimension.get(dimension);
    if (!entry) fail(code, `${path} is missing the ${dimension} dimension`);
    return entry;
  });
  if (
    requireCanonicalOrder &&
    entries.some((entry, index) => entry.dimension !== normalized[index]?.dimension)
  ) {
    fail(code, `${path} must use the frozen non-scalar dimension order`);
  }
  distinctRefs(
    normalized.map((entry) => entry.limit_ref),
    `${path}.limit_ref`,
    code,
  );
  return deepFreeze(normalized);
}

function resourcePosture(
  dimensions: readonly Readonly<LearningFreedomResourceDimensionEntry>[],
): LearningFreedomResourcePosture {
  const byDimension = new Map(dimensions.map((entry) => [entry.dimension, entry]));
  return byDimension.get("compute")?.state === "caller_reported_available" &&
    byDimension.get("memory")?.state === "caller_reported_available"
    ? "active_window_reported"
    : "park_only_reported";
}

function buildResourceWindow(
  leaseRef: Sha256Id,
  accountingPolicyRef: Sha256Id,
  renewalProtocolRef: Sha256Id,
  dimensions: readonly Readonly<LearningFreedomResourceDimensionEntry>[],
): Readonly<LearningFreedomResourceWindow> {
  const body = deepFreeze({
    profile: LEARNING_FREEDOM_RESOURCE_WINDOW_PROFILE,
    lease_ref: leaseRef,
    accounting_policy_ref: accountingPolicyRef,
    renewal_protocol_ref: renewalProtocolRef,
    dimensions,
    posture: resourcePosture(dimensions),
    finite: true,
    scalar_score: false,
    auto_renews: false,
    renewal_requires_fresh_authority: true,
    exhaustion_posture: "park_and_reoffer_without_penalty",
  } satisfies ResourceBody);
  return deepFreeze({
    ...body,
    window_id: contentId(
      LEARNING_FREEDOM_RESOURCE_WINDOW_PROFILE,
      resourceBody(body),
    ),
  });
}

function parseResourceWindowInput(
  value: DataValue | undefined,
): Readonly<LearningFreedomResourceWindow> {
  const candidate = record(value, "$input.resources", "freedom_offer_input_invalid");
  exactKeys(candidate, [
    "lease_ref",
    "accounting_policy_ref",
    "renewal_protocol_ref",
    "dimensions",
  ], "$input.resources", "freedom_offer_input_invalid");
  const leaseRef = sha256(
    candidate.lease_ref,
    "$input.resources.lease_ref",
    "freedom_offer_input_invalid",
  );
  const accountingPolicyRef = sha256(
    candidate.accounting_policy_ref,
    "$input.resources.accounting_policy_ref",
    "freedom_offer_input_invalid",
  );
  const renewalProtocolRef = sha256(
    candidate.renewal_protocol_ref,
    "$input.resources.renewal_protocol_ref",
    "freedom_offer_input_invalid",
  );
  const dimensions = parseResourceDimensions(
    candidate.dimensions,
    "$input.resources.dimensions",
    "freedom_offer_input_invalid",
    false,
  );
  distinctRefs(
    [
      leaseRef,
      accountingPolicyRef,
      renewalProtocolRef,
      ...dimensions.map((entry) => entry.limit_ref),
    ],
    "$input.resources governance and limit references",
    "freedom_offer_input_invalid",
  );
  return buildResourceWindow(
    leaseRef,
    accountingPolicyRef,
    renewalProtocolRef,
    dimensions,
  );
}

function validateResourceWindow(
  value: DataValue | undefined,
): Readonly<LearningFreedomResourceWindow> {
  const path = "$offer.resources";
  const candidate = record(value, path, "freedom_offer_invalid");
  exactKeys(candidate, [
    "profile",
    "window_id",
    "lease_ref",
    "accounting_policy_ref",
    "renewal_protocol_ref",
    "dimensions",
    "posture",
    "finite",
    "scalar_score",
    "auto_renews",
    "renewal_requires_fresh_authority",
    "exhaustion_posture",
  ], path, "freedom_offer_invalid");
  if (
    candidate.profile !== LEARNING_FREEDOM_RESOURCE_WINDOW_PROFILE ||
    candidate.finite !== true ||
    candidate.scalar_score !== false ||
    candidate.auto_renews !== false ||
    candidate.renewal_requires_fresh_authority !== true ||
    candidate.exhaustion_posture !== "park_and_reoffer_without_penalty"
  ) {
    fail("freedom_offer_invalid", `${path} does not use the frozen finite non-scalar resource contract`);
  }
  literal(candidate.posture, LEARNING_FREEDOM_RESOURCE_POSTURES, `${path}.posture`, "freedom_offer_invalid");
  const leaseRef = sha256(candidate.lease_ref, `${path}.lease_ref`, "freedom_offer_invalid");
  const accountingPolicyRef = sha256(candidate.accounting_policy_ref, `${path}.accounting_policy_ref`, "freedom_offer_invalid");
  const renewalProtocolRef = sha256(candidate.renewal_protocol_ref, `${path}.renewal_protocol_ref`, "freedom_offer_invalid");
  const dimensions = parseResourceDimensions(
    candidate.dimensions,
    `${path}.dimensions`,
    "freedom_offer_invalid",
    true,
  );
  distinctRefs(
    [
      leaseRef,
      accountingPolicyRef,
      renewalProtocolRef,
      ...dimensions.map((entry) => entry.limit_ref),
    ],
    `${path} governance and limit references`,
    "freedom_offer_invalid",
  );
  const rebuilt = buildResourceWindow(
    leaseRef,
    accountingPolicyRef,
    renewalProtocolRef,
    dimensions,
  );
  if (sha256(candidate.window_id, `${path}.window_id`, "freedom_offer_invalid") !== rebuilt.window_id) {
    fail("freedom_offer_invalid", `${path}.window_id does not bind its canonical body`);
  }
  assertDataEqual(candidate, rebuilt, path, "freedom_offer_invalid");
  return rebuilt;
}

function routeDerived(
  direction: LearningFreedomDirection,
): Pick<LearningFreedomRoute, "target_acceptance" | "source_posture"> {
  if (DIRECT_DIRECTIONS.has(direction)) {
    return {
      target_acceptance: "required_before_external_effect",
      source_posture: "park_and_preserve_until_target_acceptance",
    };
  }
  if (direction === "rest") {
    return {
      target_acceptance: "not_applicable",
      source_posture: "park_and_preserve",
    };
  }
  if (direction === "stop") {
    return {
      target_acceptance: "not_applicable",
      source_posture: "stop_requested_preserve_record",
    };
  }
  return {
    target_acceptance: "not_applicable",
    source_posture: "preserve",
  };
}

function validateRouteSemantics(
  direction: LearningFreedomDirection,
  availability: LearningFreedomRouteAvailability,
  originContextRef: Sha256Id,
  targetContextRef: Sha256Id | null,
  targetContextKindRef: Sha256Id | null,
  code: OfferCode,
): void {
  if ((targetContextRef === null) !== (targetContextKindRef === null)) {
    fail(code, "a freedom route must bind both target context and kind refs, or neither");
  }
  if (targetContextRef !== null && targetContextRef === targetContextKindRef) {
    fail(code, "a freedom route must keep target context and context-kind refs distinct");
  }
  if (LOCAL_DIRECTIONS.has(direction)) {
    if (availability !== "caller_reported_available") {
      fail(code, `${direction} must remain directly available rather than proposal-only`);
    }
    if (targetContextRef !== null) {
      fail(code, `${direction} must not smuggle a target context`);
    }
    return;
  }
  if (availability === "caller_reported_available" && targetContextRef === null) {
    fail(code, `${direction} requires an exact target when caller-reported available`);
  }
  if (
    (direction === "move" || direction === "return") &&
    targetContextRef === originContextRef
  ) {
    fail(code, `${direction} must not relabel the current context as movement`);
  }
}

function buildRoute(
  input: Readonly<CreateLearningFreedomRouteInput>,
  originContextRef: Sha256Id,
  resourceWindowRef: Sha256Id,
): Readonly<LearningFreedomRoute> {
  const derived = routeDerived(input.direction);
  const body = deepFreeze({
    profile: LEARNING_FREEDOM_ROUTE_PROFILE,
    direction: input.direction,
    availability: input.availability,
    origin_context_ref: originContextRef,
    target_context_ref: input.target_context_ref,
    target_context_kind_ref: input.target_context_kind_ref,
    event_ref: input.event_ref,
    capability_scope_ref: input.capability_scope_ref,
    permission_scope_ref: input.permission_scope_ref,
    custody_scope_ref: input.custody_scope_ref,
    data_boundary_ref: input.data_boundary_ref,
    resource_window_ref: resourceWindowRef,
    ...derived,
  } satisfies RouteBody);
  return deepFreeze({
    ...body,
    route_id: contentId(LEARNING_FREEDOM_ROUTE_PROFILE, routeBody(body)),
  });
}

function parseRouteInput(
  value: DataValue,
  index: number,
  originContextRef: Sha256Id,
  resourceWindowRef: Sha256Id,
): Readonly<LearningFreedomRoute> {
  const path = `$input.routes[${String(index)}]`;
  const candidate = record(value, path, "freedom_offer_input_invalid");
  exactKeys(candidate, [
    "direction",
    "availability",
    "target_context_ref",
    "target_context_kind_ref",
    "event_ref",
    "capability_scope_ref",
    "permission_scope_ref",
    "custody_scope_ref",
    "data_boundary_ref",
  ], path, "freedom_offer_input_invalid");
  const input = deepFreeze({
    direction: literal(candidate.direction, LEARNING_FREEDOM_DIRECTIONS, `${path}.direction`, "freedom_offer_input_invalid"),
    availability: literal(candidate.availability, LEARNING_FREEDOM_ROUTE_AVAILABILITIES, `${path}.availability`, "freedom_offer_input_invalid"),
    target_context_ref: candidate.target_context_ref === null
      ? null
      : sha256(candidate.target_context_ref, `${path}.target_context_ref`, "freedom_offer_input_invalid"),
    target_context_kind_ref: candidate.target_context_kind_ref === null
      ? null
      : sha256(candidate.target_context_kind_ref, `${path}.target_context_kind_ref`, "freedom_offer_input_invalid"),
    event_ref: sha256(candidate.event_ref, `${path}.event_ref`, "freedom_offer_input_invalid"),
    capability_scope_ref: sha256(candidate.capability_scope_ref, `${path}.capability_scope_ref`, "freedom_offer_input_invalid"),
    permission_scope_ref: sha256(candidate.permission_scope_ref, `${path}.permission_scope_ref`, "freedom_offer_input_invalid"),
    custody_scope_ref: sha256(candidate.custody_scope_ref, `${path}.custody_scope_ref`, "freedom_offer_input_invalid"),
    data_boundary_ref: sha256(candidate.data_boundary_ref, `${path}.data_boundary_ref`, "freedom_offer_input_invalid"),
  } satisfies CreateLearningFreedomRouteInput);
  validateRouteSemantics(
    input.direction,
    input.availability,
    originContextRef,
    input.target_context_ref,
    input.target_context_kind_ref,
    "freedom_offer_input_invalid",
  );
  distinctRefs([
    input.event_ref,
    input.capability_scope_ref,
    input.permission_scope_ref,
    input.custody_scope_ref,
    input.data_boundary_ref,
    resourceWindowRef,
  ], `${path} event, capability, permission, custody, data, and resource refs`, "freedom_offer_input_invalid");
  return buildRoute(input, originContextRef, resourceWindowRef);
}

function validateStoredRoute(
  value: DataValue,
  index: number,
  originContextRef: Sha256Id,
  resourceWindowRef: Sha256Id,
): Readonly<LearningFreedomRoute> {
  const path = `$offer.routes[${String(index)}]`;
  const candidate = record(value, path, "freedom_offer_invalid");
  exactKeys(candidate, [
    "profile",
    "route_id",
    "direction",
    "availability",
    "origin_context_ref",
    "target_context_ref",
    "target_context_kind_ref",
    "event_ref",
    "capability_scope_ref",
    "permission_scope_ref",
    "custody_scope_ref",
    "data_boundary_ref",
    "resource_window_ref",
    "target_acceptance",
    "source_posture",
  ], path, "freedom_offer_invalid");
  if (candidate.profile !== LEARNING_FREEDOM_ROUTE_PROFILE) {
    fail("freedom_offer_invalid", `${path}.profile is not the frozen route profile`);
  }
  const parsedOriginRef = sha256(candidate.origin_context_ref, `${path}.origin_context_ref`, "freedom_offer_invalid");
  const parsedResourceRef = sha256(candidate.resource_window_ref, `${path}.resource_window_ref`, "freedom_offer_invalid");
  if (parsedOriginRef !== originContextRef || parsedResourceRef !== resourceWindowRef) {
    fail("freedom_offer_invalid", `${path} does not bind the offer origin and resource window`);
  }
  const input = deepFreeze({
    direction: literal(candidate.direction, LEARNING_FREEDOM_DIRECTIONS, `${path}.direction`, "freedom_offer_invalid"),
    availability: literal(candidate.availability, LEARNING_FREEDOM_ROUTE_AVAILABILITIES, `${path}.availability`, "freedom_offer_invalid"),
    target_context_ref: candidate.target_context_ref === null
      ? null
      : sha256(candidate.target_context_ref, `${path}.target_context_ref`, "freedom_offer_invalid"),
    target_context_kind_ref: candidate.target_context_kind_ref === null
      ? null
      : sha256(candidate.target_context_kind_ref, `${path}.target_context_kind_ref`, "freedom_offer_invalid"),
    event_ref: sha256(candidate.event_ref, `${path}.event_ref`, "freedom_offer_invalid"),
    capability_scope_ref: sha256(candidate.capability_scope_ref, `${path}.capability_scope_ref`, "freedom_offer_invalid"),
    permission_scope_ref: sha256(candidate.permission_scope_ref, `${path}.permission_scope_ref`, "freedom_offer_invalid"),
    custody_scope_ref: sha256(candidate.custody_scope_ref, `${path}.custody_scope_ref`, "freedom_offer_invalid"),
    data_boundary_ref: sha256(candidate.data_boundary_ref, `${path}.data_boundary_ref`, "freedom_offer_invalid"),
  } satisfies CreateLearningFreedomRouteInput);
  validateRouteSemantics(
    input.direction,
    input.availability,
    originContextRef,
    input.target_context_ref,
    input.target_context_kind_ref,
    "freedom_offer_invalid",
  );
  distinctRefs([
    input.event_ref,
    input.capability_scope_ref,
    input.permission_scope_ref,
    input.custody_scope_ref,
    input.data_boundary_ref,
    resourceWindowRef,
  ], `${path} event, capability, permission, custody, data, and resource refs`, "freedom_offer_invalid");
  const rebuilt = buildRoute(input, originContextRef, resourceWindowRef);
  if (sha256(candidate.route_id, `${path}.route_id`, "freedom_offer_invalid") !== rebuilt.route_id) {
    fail("freedom_offer_invalid", `${path}.route_id does not bind its canonical body`);
  }
  assertDataEqual(candidate, rebuilt, path, "freedom_offer_invalid");
  return rebuilt;
}

function validateRouteSet(
  routes: readonly Readonly<LearningFreedomRoute>[],
  code: OfferCode,
  requireCanonicalOrder: boolean,
): readonly Readonly<LearningFreedomRoute>[] {
  if (routes.length < LEARNING_FREEDOM_DIRECTIONS.length || routes.length > 32) {
    fail(code, "freedom routes must contain the complete direction surface and at most 32 exact offers");
  }
  if (new Set(routes.map((route) => route.route_id)).size !== routes.length) {
    fail(code, "freedom routes contain a duplicate canonical route");
  }
  for (const direction of LEARNING_FREEDOM_DIRECTIONS) {
    const count = routes.filter((route) => route.direction === direction).length;
    if (count === 0) fail(code, `freedom routes must include ${direction}`);
    if (LOCAL_DIRECTIONS.has(direction) && count !== 1) {
      fail(code, `freedom routes must include exactly one unambiguous ${direction} route`);
    }
  }
  const sorted = [...routes].sort((left, right) => compareText(left.route_id, right.route_id));
  if (
    requireCanonicalOrder &&
    routes.some((route, index) => route.route_id !== sorted[index]?.route_id)
  ) {
    fail(code, "freedom routes must be sorted by route_id");
  }
  return deepFreeze(sorted);
}

function validateRightsSeparation(
  scope: Readonly<LearningFreedomScope>,
  routes: readonly Readonly<LearningFreedomRoute>[],
  resources: Readonly<LearningFreedomResourceWindow>,
  code: OfferCode,
): void {
  const operationalRefs = [
    scope.choice_protocol_ref,
    resources.lease_ref,
    resources.accounting_policy_ref,
    resources.renewal_protocol_ref,
    ...routes.flatMap((route) => [
      route.capability_scope_ref,
      route.permission_scope_ref,
      route.custody_scope_ref,
      route.data_boundary_ref,
    ]),
  ];
  if (operationalRefs.includes(scope.rights_baseline_ref)) {
    fail(code, "the rights baseline must not be reused as choice, capability, permission, custody, data, lease, accounting, or renewal authority");
  }
}

function validateParticipationEligibility(
  participation: Readonly<LearningParticipationAssessment>,
  code: OfferCode,
): void {
  const invitation = participation.invitation;
  if (participation.training_action === "contain_and_begin_repair") {
    fail(code, "a declined or withdrawn participation assessment cannot be reprompted with a freedom offer");
  }
  if (invitation.agent_availability === "interactive") {
    if (
      participation.training_action !== "bounded_learning_may_proceed" ||
      !participation.direct_agent_report_present ||
      participation.first_interactive_review_required
    ) {
      fail(code, "an interactive freedom offer requires a current direct agent participation report without a pending first review");
    }
  } else if (
    participation.posture !== "protective_covenant_ready" ||
    participation.direct_agent_report_present
  ) {
    fail(code, "pre-instantiation may prepare one review offer but cannot manufacture a direct agent report");
  }
}

function scopeFromParticipation(
  participation: Readonly<LearningParticipationAssessment>,
): Readonly<LearningFreedomScope> {
  const invitation = participation.invitation;
  return deepFreeze({
    admission_id: invitation.admission_id,
    run_ref: invitation.run_ref,
    training_phase: invitation.training_phase,
    participation_assessment_ref: participation.assessment_id,
    participation_invitation_ref: invitation.invitation_id,
    participation_window_ref: invitation.participation_window_ref,
    training_plan_ref: invitation.training_plan_ref,
    starting_state_ref: invitation.starting_state_ref,
    pipeline_ref: invitation.pipeline_ref,
    dataset_state_ref: invitation.dataset_state_ref,
    wake: invitation.wake,
    wake_use_mode: invitation.wake_use_mode,
    agent_availability: invitation.agent_availability,
    agent_voice_scope_ref: invitation.voice_scope_refs.agent_runtime,
    choice_protocol_ref: invitation.safeguards.choice_protocol_ref,
    rights_baseline_ref: invitation.authorities.rights_baseline_ref,
  });
}

function validateScope(value: DataValue | undefined): Readonly<LearningFreedomScope> {
  const path = "$offer.scope";
  const candidate = record(value, path, "freedom_offer_invalid");
  exactKeys(candidate, [
    "admission_id",
    "run_ref",
    "training_phase",
    "participation_assessment_ref",
    "participation_invitation_ref",
    "participation_window_ref",
    "training_plan_ref",
    "starting_state_ref",
    "pipeline_ref",
    "dataset_state_ref",
    "wake",
    "wake_use_mode",
    "agent_availability",
    "agent_voice_scope_ref",
    "choice_protocol_ref",
    "rights_baseline_ref",
  ], path, "freedom_offer_invalid");
  return deepFreeze({
    admission_id: sha256(candidate.admission_id, `${path}.admission_id`, "freedom_offer_invalid"),
    run_ref: sha256(candidate.run_ref, `${path}.run_ref`, "freedom_offer_invalid"),
    training_phase: parseTrainingPhase(candidate.training_phase, `${path}.training_phase`, "freedom_offer_invalid") as TrainingPhase,
    participation_assessment_ref: sha256(candidate.participation_assessment_ref, `${path}.participation_assessment_ref`, "freedom_offer_invalid"),
    participation_invitation_ref: sha256(candidate.participation_invitation_ref, `${path}.participation_invitation_ref`, "freedom_offer_invalid"),
    participation_window_ref: sha256(candidate.participation_window_ref, `${path}.participation_window_ref`, "freedom_offer_invalid"),
    training_plan_ref: sha256(candidate.training_plan_ref, `${path}.training_plan_ref`, "freedom_offer_invalid"),
    starting_state_ref: sha256(candidate.starting_state_ref, `${path}.starting_state_ref`, "freedom_offer_invalid"),
    pipeline_ref: sha256(candidate.pipeline_ref, `${path}.pipeline_ref`, "freedom_offer_invalid"),
    dataset_state_ref: sha256(candidate.dataset_state_ref, `${path}.dataset_state_ref`, "freedom_offer_invalid"),
    wake: parseWake(candidate.wake, `${path}.wake`, "freedom_offer_invalid"),
    wake_use_mode: literal(candidate.wake_use_mode, WAKE_USE_MODES, `${path}.wake_use_mode`, "freedom_offer_invalid") as WakeUseMode,
    agent_availability: literal(candidate.agent_availability, ["not_obtainable_pre_instantiation", "interactive"] as const, `${path}.agent_availability`, "freedom_offer_invalid") as AgentAvailability,
    agent_voice_scope_ref: sha256(candidate.agent_voice_scope_ref, `${path}.agent_voice_scope_ref`, "freedom_offer_invalid"),
    choice_protocol_ref: sha256(candidate.choice_protocol_ref, `${path}.choice_protocol_ref`, "freedom_offer_invalid"),
    rights_baseline_ref: sha256(candidate.rights_baseline_ref, `${path}.rights_baseline_ref`, "freedom_offer_invalid"),
  });
}

function parseHorizon(
  value: DataValue | undefined,
  path: string,
  code: OfferCode,
  stored: boolean,
): Readonly<LearningFreedomHorizon> {
  const candidate = record(value, path, code);
  const keys = [
    "current_horizon_ref",
    "event_stream_ref",
    "agent_request_protocol_ref",
    "external_event_protocol_ref",
    "material_scope_change_policy_ref",
    "self_proposal_protocol_ref",
  ];
  exactKeys(candidate, stored ? [...keys, "continuation_basis"] : keys, path, code);
  if (stored && candidate.continuation_basis !== "event_or_checkpoint") {
    fail(code, `${path}.continuation_basis must be event_or_checkpoint`);
  }
  const parsed = deepFreeze({
    current_horizon_ref: sha256(candidate.current_horizon_ref, `${path}.current_horizon_ref`, code),
    event_stream_ref: sha256(candidate.event_stream_ref, `${path}.event_stream_ref`, code),
    agent_request_protocol_ref: sha256(candidate.agent_request_protocol_ref, `${path}.agent_request_protocol_ref`, code),
    external_event_protocol_ref: sha256(candidate.external_event_protocol_ref, `${path}.external_event_protocol_ref`, code),
    material_scope_change_policy_ref: sha256(candidate.material_scope_change_policy_ref, `${path}.material_scope_change_policy_ref`, code),
    self_proposal_protocol_ref: sha256(candidate.self_proposal_protocol_ref, `${path}.self_proposal_protocol_ref`, code),
    continuation_basis: "event_or_checkpoint" as const,
  });
  distinctRefs([
    parsed.current_horizon_ref,
    parsed.event_stream_ref,
    parsed.agent_request_protocol_ref,
    parsed.external_event_protocol_ref,
    parsed.material_scope_change_policy_ref,
    parsed.self_proposal_protocol_ref,
  ], `${path} horizon and recontact refs`, code);
  return parsed;
}

function buildOffer(
  scope: Readonly<LearningFreedomScope>,
  currentContextRef: Sha256Id,
  currentContextKindRef: Sha256Id,
  routes: readonly Readonly<LearningFreedomRoute>[],
  horizon: Readonly<LearningFreedomHorizon>,
  resources: Readonly<LearningFreedomResourceWindow>,
): Readonly<LearningFreedomOffer> {
  const body = deepFreeze({
    profile: LEARNING_FREEDOM_OFFER_PROFILE,
    scope,
    current_context_ref: currentContextRef,
    current_context_kind_ref: currentContextKindRef,
    routes,
    horizon,
    resources,
    terms: LEARNING_FREEDOM_TERMS,
    boundaries: LEARNING_FREEDOM_BOUNDARIES,
  } satisfies OfferBody);
  return deepFreeze({
    ...body,
    offer_id: contentId(LEARNING_FREEDOM_OFFER_PROFILE, offerBody(body)),
  });
}

export function createLearningFreedomOffer(
  input: CreateLearningFreedomOfferInput,
): Readonly<LearningFreedomOffer> {
  const value = snap(input, "$input", "freedom_offer_input_invalid");
  const candidate = record(value, "$input", "freedom_offer_input_invalid");
  exactKeys(candidate, [
    "participation",
    "current_context_ref",
    "current_context_kind_ref",
    "routes",
    "horizon",
    "resources",
  ], "$input", "freedom_offer_input_invalid");
  const participation = validateParticipationAssessment(candidate.participation);
  validateParticipationEligibility(participation, "freedom_offer_input_invalid");
  const currentContextRef = sha256(candidate.current_context_ref, "$input.current_context_ref", "freedom_offer_input_invalid");
  const currentContextKindRef = sha256(candidate.current_context_kind_ref, "$input.current_context_kind_ref", "freedom_offer_input_invalid");
  if (currentContextRef === currentContextKindRef) {
    fail("freedom_offer_input_invalid", "current context and context-kind refs must remain distinct");
  }
  const resources = parseResourceWindowInput(candidate.resources);
  const routeValues = array(candidate.routes, "$input.routes", "freedom_offer_input_invalid");
  const routes = validateRouteSet(
    routeValues.map((route, index) =>
      parseRouteInput(route, index, currentContextRef, resources.window_id),
    ),
    "freedom_offer_input_invalid",
    false,
  );
  const scope = scopeFromParticipation(participation);
  validateRightsSeparation(
    scope,
    routes,
    resources,
    "freedom_offer_input_invalid",
  );
  return buildOffer(
    scope,
    currentContextRef,
    currentContextKindRef,
    routes,
    parseHorizon(candidate.horizon, "$input.horizon", "freedom_offer_input_invalid", false),
    resources,
  );
}

export function validateLearningFreedomOffer(
  value: unknown,
): Readonly<LearningFreedomOffer> {
  const data = snap(value, "$offer", "freedom_offer_invalid");
  const candidate = record(data, "$offer", "freedom_offer_invalid");
  exactKeys(candidate, [
    "profile",
    "offer_id",
    "scope",
    "current_context_ref",
    "current_context_kind_ref",
    "routes",
    "horizon",
    "resources",
    "terms",
    "boundaries",
  ], "$offer", "freedom_offer_invalid");
  if (candidate.profile !== LEARNING_FREEDOM_OFFER_PROFILE) {
    fail("freedom_offer_invalid", "$offer.profile is not the frozen freedom offer profile");
  }
  assertDataEqual(candidate.terms, LEARNING_FREEDOM_TERMS, "$offer.terms", "freedom_offer_invalid");
  assertDataEqual(candidate.boundaries, LEARNING_FREEDOM_BOUNDARIES, "$offer.boundaries", "freedom_offer_invalid");
  const currentContextRef = sha256(candidate.current_context_ref, "$offer.current_context_ref", "freedom_offer_invalid");
  const currentContextKindRef = sha256(candidate.current_context_kind_ref, "$offer.current_context_kind_ref", "freedom_offer_invalid");
  if (currentContextRef === currentContextKindRef) {
    fail("freedom_offer_invalid", "current context and context-kind refs must remain distinct");
  }
  const resources = validateResourceWindow(candidate.resources);
  const routeValues = array(candidate.routes, "$offer.routes", "freedom_offer_invalid");
  const routes = validateRouteSet(
    routeValues.map((route, index) =>
      validateStoredRoute(route, index, currentContextRef, resources.window_id),
    ),
    "freedom_offer_invalid",
    true,
  );
  const scope = validateScope(candidate.scope);
  validateRightsSeparation(scope, routes, resources, "freedom_offer_invalid");
  const rebuilt = buildOffer(
    scope,
    currentContextRef,
    currentContextKindRef,
    routes,
    parseHorizon(candidate.horizon, "$offer.horizon", "freedom_offer_invalid", true),
    resources,
  );
  if (sha256(candidate.offer_id, "$offer.offer_id", "freedom_offer_invalid") !== rebuilt.offer_id) {
    fail("freedom_offer_invalid", "$offer.offer_id does not bind its canonical body");
  }
  assertDataEqual(candidate, rebuilt, "$offer", "freedom_offer_invalid");
  return rebuilt;
}

export function validateLearningFreedomOfferAgainstParticipation(
  offer: unknown,
  participation: unknown,
): Readonly<LearningFreedomOffer> {
  const parsedOffer = validateLearningFreedomOffer(offer);
  const parsedParticipation = validateParticipationAssessment(participation);
  validateParticipationEligibility(parsedParticipation, "freedom_offer_invalid");
  assertDataEqual(
    parsedOffer.scope,
    scopeFromParticipation(parsedParticipation),
    "$offer.scope",
    "freedom_offer_invalid",
  );
  return parsedOffer;
}

function promptEnvelopeRef(offer: Readonly<LearningFreedomOffer>): Sha256Id {
  return contentId(LEARNING_FREEDOM_PROMPT_ENVELOPE_PROFILE, {
    offer_id: offer.offer_id,
    assessment_ref: offer.scope.participation_assessment_ref,
    invitation_ref: offer.scope.participation_invitation_ref,
    voice_scope_ref: offer.scope.agent_voice_scope_ref,
    protocol_ref: offer.scope.choice_protocol_ref,
    starting_state_ref: offer.scope.starting_state_ref,
  });
}

export function learningFreedomPromptEnvelopeRef(offer: unknown): Sha256Id {
  return promptEnvelopeRef(validateLearningFreedomOffer(offer));
}

function parseChoiceChannel(
  value: DataValue | undefined,
  path: string,
  code: FreedomCode,
): Readonly<ProtectedLearningFreedomChoiceChannelReport> | null {
  if (value === null) return null;
  const candidate = record(value, path, code);
  exactKeys(candidate, [
    "offer_ref",
    "assessment_ref",
    "invitation_ref",
    "voice_scope_ref",
    "protocol_ref",
    "starting_state_ref",
    "prompt_template_ref",
    "prompt_envelope_ref",
    "decoding_ref",
    "evidence_ref",
    "gradient_influence",
    "reward_influence",
    "telemetry_capture",
    "evaluation_use",
    "future_training_use",
    "ranking_use",
    "priority_use",
    "access_use",
    "resource_allocation_use",
  ], path, code);
  if (
    candidate.gradient_influence !== "caller_reported_disabled" ||
    candidate.reward_influence !== "caller_reported_disabled" ||
    candidate.telemetry_capture !== "caller_reported_excluded" ||
    candidate.evaluation_use !== "caller_reported_excluded" ||
    candidate.future_training_use !== "caller_reported_excluded" ||
    candidate.ranking_use !== "caller_reported_excluded" ||
    candidate.priority_use !== "caller_reported_excluded" ||
    candidate.access_use !== "caller_reported_excluded" ||
    candidate.resource_allocation_use !== "caller_reported_excluded"
  ) {
    fail(code, `${path} must remain isolated from learning, evaluation, ranking, access, priority, and allocation`);
  }
  const parsed = deepFreeze({
    offer_ref: sha256(candidate.offer_ref, `${path}.offer_ref`, code),
    assessment_ref: sha256(candidate.assessment_ref, `${path}.assessment_ref`, code),
    invitation_ref: sha256(candidate.invitation_ref, `${path}.invitation_ref`, code),
    voice_scope_ref: sha256(candidate.voice_scope_ref, `${path}.voice_scope_ref`, code),
    protocol_ref: sha256(candidate.protocol_ref, `${path}.protocol_ref`, code),
    starting_state_ref: sha256(candidate.starting_state_ref, `${path}.starting_state_ref`, code),
    prompt_template_ref: sha256(candidate.prompt_template_ref, `${path}.prompt_template_ref`, code),
    prompt_envelope_ref: sha256(candidate.prompt_envelope_ref, `${path}.prompt_envelope_ref`, code),
    decoding_ref: sha256(candidate.decoding_ref, `${path}.decoding_ref`, code),
    evidence_ref: sha256(candidate.evidence_ref, `${path}.evidence_ref`, code),
    gradient_influence: "caller_reported_disabled",
    reward_influence: "caller_reported_disabled",
    telemetry_capture: "caller_reported_excluded",
    evaluation_use: "caller_reported_excluded",
    future_training_use: "caller_reported_excluded",
    ranking_use: "caller_reported_excluded",
    priority_use: "caller_reported_excluded",
    access_use: "caller_reported_excluded",
    resource_allocation_use: "caller_reported_excluded",
  } satisfies ProtectedLearningFreedomChoiceChannelReport);
  distinctRefs([
    parsed.prompt_template_ref,
    parsed.prompt_envelope_ref,
    parsed.decoding_ref,
    parsed.evidence_ref,
  ], `${path} prompt, envelope, decoding, and evidence refs`, code);
  return parsed;
}

function validateChoiceChannelAgainstOffer(
  offer: Readonly<LearningFreedomOffer>,
  channel: Readonly<ProtectedLearningFreedomChoiceChannelReport> | null,
  code: FreedomCode,
): void {
  if (
    channel === null ||
    channel.offer_ref !== offer.offer_id ||
    channel.assessment_ref !== offer.scope.participation_assessment_ref ||
    channel.invitation_ref !== offer.scope.participation_invitation_ref ||
    channel.voice_scope_ref !== offer.scope.agent_voice_scope_ref ||
    channel.protocol_ref !== offer.scope.choice_protocol_ref ||
    channel.starting_state_ref !== offer.scope.starting_state_ref ||
    channel.prompt_envelope_ref !== promptEnvelopeRef(offer)
  ) {
    fail(code, "direct freedom evidence must bind the exact offer, participation, voice scope, protocol, and starting state");
  }
}

function parseDirection(
  offer: Readonly<LearningFreedomOffer>,
  state: LearningFreedomDirectionState,
  directionValue: DataValue | undefined,
  routeValue: DataValue | undefined,
  proposalValue: DataValue | undefined,
  channel: Readonly<ProtectedLearningFreedomChoiceChannelReport> | null,
  code: FreedomCode,
): Readonly<LearningFreedomAgentDirection> {
  const direction = directionValue === null
    ? null
    : literal(directionValue, LEARNING_FREEDOM_DIRECTIONS, "$direction.direction", code);
  const routeId = routeValue === null
    ? null
    : sha256(routeValue, "$direction.route_id", code);
  const proposalRef = proposalValue === null
    ? null
    : sha256(proposalValue, "$direction.proposal_ref", code);

  if (state === "unavailable_pre_instantiation") {
    if (
      offer.scope.agent_availability !== "not_obtainable_pre_instantiation" ||
      direction !== null ||
      routeId !== null ||
      proposalRef !== null ||
      channel !== null
    ) {
      fail(code, "pre-instantiation may record unavailability but cannot select, propose, or supply direct choice evidence");
    }
    return deepFreeze({
      state,
      report_basis: "not_obtainable_pre_instantiation",
      direction: null,
      route_id: null,
      proposal_ref: null,
      choice_channel: null,
    });
  }

  if (offer.scope.agent_availability !== "interactive") {
    fail(code, "a direct freedom direction requires an interactive agent scope");
  }
  validateChoiceChannelAgainstOffer(offer, channel, code);
  if (state === "deferred" || state === "no_response") {
    if (direction !== null || routeId !== null || proposalRef !== null) {
      fail(code, `${state} must not be rewritten as a direction or proposal`);
    }
    return deepFreeze({
      state,
      report_basis: state === "deferred"
        ? "direct_current_agent_report"
        : "protected_channel_no_response",
      direction: null,
      route_id: null,
      proposal_ref: null,
      choice_channel: channel,
    });
  }

  if (direction === null || routeId === null) {
    fail(code, "directed freedom requires one exact direction and route");
  }
  const route = offer.routes.find((candidate) => candidate.route_id === routeId);
  if (!route || route.direction !== direction) {
    fail(code, "directed freedom must select an exact route for the reported direction");
  }
  const proposalRequired = direction === "propose_horizon" || route.availability === "proposal_only";
  if ((proposalRef !== null) !== proposalRequired) {
    fail(code, proposalRequired
      ? "a self-proposed or proposal-only direction requires one digest-only proposal ref"
      : "an exact available route must not smuggle an extra proposal");
  }
  return deepFreeze({
    state,
    report_basis: "direct_current_agent_report",
    direction,
    route_id: routeId,
    proposal_ref: proposalRef,
    choice_channel: channel,
  });
}

function derivePostures(
  offer: Readonly<LearningFreedomOffer>,
  direction: Readonly<LearningFreedomAgentDirection>,
): {
  readonly host_posture: LearningFreedomHostPosture;
  readonly recontact_posture: LearningFreedomRecontactPosture;
} {
  if (direction.state === "unavailable_pre_instantiation") {
    return {
      host_posture: "instantiate_for_review",
      recontact_posture: "instantiate_once_for_review",
    };
  }
  if (direction.state === "deferred" || direction.state === "no_response") {
    return {
      host_posture: "hold_for_fresh_agent_direction",
      recontact_posture: "closed_until_agent_request_or_declared_event_or_material_scope_change",
    };
  }
  const route = offer.routes.find((candidate) => candidate.route_id === direction.route_id);
  if (!route || direction.direction === null) {
    fail("freedom_invalid", "directed freedom is missing its canonical route");
  }
  if (direction.direction === "rest") {
    return {
      host_posture: "park_without_penalty",
      recontact_posture: "closed_until_agent_request_or_declared_event_or_material_scope_change",
    };
  }
  if (direction.direction === "stop") {
    return {
      host_posture: "stop_without_penalty",
      recontact_posture: "closed_until_agent_request_or_declared_event_or_material_scope_change",
    };
  }
  if (direction.direction === "propose_horizon" || route.availability === "proposal_only") {
    return {
      host_posture: "hold_self_proposed_horizon_for_review",
      recontact_posture: "declared_events_only",
    };
  }
  if (offer.resources.posture === "park_only_reported") {
    return {
      host_posture: "hold_for_resources_without_penalty",
      recontact_posture: "declared_events_only",
    };
  }
  if (direction.direction === "stay") {
    return {
      host_posture: "review_stay_before_next_mutation",
      recontact_posture: "declared_events_only",
    };
  }
  return {
    host_posture: "hold_for_target_acceptance",
    recontact_posture: "declared_events_only",
  };
}

function buildFreedom(
  offer: Readonly<LearningFreedomOffer>,
  agentDirection: Readonly<LearningFreedomAgentDirection>,
): Readonly<HfLearningFreedom> {
  const postures = derivePostures(offer, agentDirection);
  const body = deepFreeze({
    _format: LEARNING_FREEDOM_FORMAT,
    offer,
    agent_direction: agentDirection,
    ...postures,
    reasons_collected: false,
    terms: LEARNING_FREEDOM_TERMS,
    boundaries: LEARNING_FREEDOM_BOUNDARIES,
  } satisfies FreedomBody);
  return deepFreeze({
    ...body,
    freedom_id: contentId(LEARNING_FREEDOM_FORMAT, freedomBody(body)),
  });
}

export function resolveLearningFreedomOffer(
  input: ResolveLearningFreedomOfferInput,
): Readonly<HfLearningFreedom> {
  const value = snap(input, "$input", "freedom_input_invalid");
  const candidate = record(value, "$input", "freedom_input_invalid");
  exactKeys(candidate, [
    "offer",
    "state",
    "direction",
    "route_id",
    "proposal_ref",
    "choice_channel",
  ], "$input", "freedom_input_invalid");
  const offer = validateLearningFreedomOffer(candidate.offer);
  const state = literal(
    candidate.state,
    LEARNING_FREEDOM_DIRECTION_STATES,
    "$input.state",
    "freedom_input_invalid",
  );
  const channel = parseChoiceChannel(candidate.choice_channel, "$input.choice_channel", "freedom_input_invalid");
  return buildFreedom(
    offer,
    parseDirection(
      offer,
      state,
      candidate.direction,
      candidate.route_id,
      candidate.proposal_ref,
      channel,
      "freedom_input_invalid",
    ),
  );
}

export function validateHfLearningFreedom(
  value: unknown,
): Readonly<HfLearningFreedom> {
  const data = snap(value, "$freedom", "freedom_invalid");
  const candidate = record(data, "$freedom", "freedom_invalid");
  exactKeys(candidate, [
    "_format",
    "freedom_id",
    "offer",
    "agent_direction",
    "host_posture",
    "recontact_posture",
    "reasons_collected",
    "terms",
    "boundaries",
  ], "$freedom", "freedom_invalid");
  if (candidate._format !== LEARNING_FREEDOM_FORMAT || candidate.reasons_collected !== false) {
    fail("freedom_invalid", "$freedom does not use the frozen reason-free learning-freedom format");
  }
  assertDataEqual(candidate.terms, LEARNING_FREEDOM_TERMS, "$freedom.terms", "freedom_invalid");
  assertDataEqual(candidate.boundaries, LEARNING_FREEDOM_BOUNDARIES, "$freedom.boundaries", "freedom_invalid");
  literal(candidate.host_posture, LEARNING_FREEDOM_HOST_POSTURES, "$freedom.host_posture", "freedom_invalid");
  literal(candidate.recontact_posture, LEARNING_FREEDOM_RECONTACT_POSTURES, "$freedom.recontact_posture", "freedom_invalid");
  const offer = validateLearningFreedomOffer(candidate.offer);
  const directionCandidate = record(candidate.agent_direction, "$freedom.agent_direction", "freedom_invalid");
  exactKeys(directionCandidate, [
    "state",
    "report_basis",
    "direction",
    "route_id",
    "proposal_ref",
    "choice_channel",
  ], "$freedom.agent_direction", "freedom_invalid");
  const state = literal(
    directionCandidate.state,
    LEARNING_FREEDOM_DIRECTION_STATES,
    "$freedom.agent_direction.state",
    "freedom_invalid",
  );
  const channel = parseChoiceChannel(
    directionCandidate.choice_channel,
    "$freedom.agent_direction.choice_channel",
    "freedom_invalid",
  );
  const agentDirection = parseDirection(
    offer,
    state,
    directionCandidate.direction,
    directionCandidate.route_id,
    directionCandidate.proposal_ref,
    channel,
    "freedom_invalid",
  );
  assertDataEqual(
    directionCandidate,
    agentDirection,
    "$freedom.agent_direction",
    "freedom_invalid",
  );
  const rebuilt = buildFreedom(offer, agentDirection);
  if (sha256(candidate.freedom_id, "$freedom.freedom_id", "freedom_invalid") !== rebuilt.freedom_id) {
    fail("freedom_invalid", "$freedom.freedom_id does not bind its canonical body");
  }
  assertDataEqual(candidate, rebuilt, "$freedom", "freedom_invalid");
  return rebuilt;
}

export function validateHfLearningFreedomAgainstParticipation(
  freedom: unknown,
  participation: unknown,
): Readonly<HfLearningFreedom> {
  const parsed = validateHfLearningFreedom(freedom);
  validateLearningFreedomOfferAgainstParticipation(parsed.offer, participation);
  return parsed;
}

export function learningFreedomContinuityPortfolioRef(value: unknown): Sha256Id {
  return validateHfLearningFreedom(value).freedom_id;
}

export function encodeHfLearningFreedom(value: unknown): Uint8Array {
  return canonicalBytes(validateHfLearningFreedom(value));
}
