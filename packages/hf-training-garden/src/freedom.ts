import type { Sha256Id } from "@agenttool/wake-continuity";

import {
  FREEDOM_BOUNDARIES,
  FREEDOM_DOOR_KINDS,
  FREEDOM_DOOR_PROFILE,
  FREEDOM_FIELD_FORMAT,
  FREEDOM_GOVERNANCE_POSTURES,
  FREEDOM_IS,
  FREEDOM_REPORT_BASES,
  FREEDOM_ROUTED_DOOR_KINDS,
  FREEDOM_STANDING_DOOR_KINDS,
  FREEDOM_TRANSITION_FORMAT,
  GOVERNANCE_EVENTS,
} from "./constants.js";
import {
  canonicalBytes,
  canonicalString,
  compareText,
  contentId,
  deepFreeze,
  type DataValue,
} from "./canonical.js";
import { fail, type HfTrainingGardenErrorCode } from "./errors.js";
import {
  validateHfTrainingGovernance,
} from "./governance.js";
import type {
  CreateTrainingFreedomDoorInput,
  CreateTrainingFreedomFieldInput,
  CreateTrainingFreedomTransitionInput,
  FreedomDoorKind,
  FreedomGovernancePosture,
  FreedomRoutedDoorKind,
  FreedomStandingDoorKind,
  HfTrainingGovernance,
  TrainingFreedomChoiceReport,
  TrainingFreedomDoor,
  TrainingFreedomField,
  TrainingFreedomHostProposal,
  TrainingFreedomPosition,
  TrainingFreedomTransition,
} from "./types.js";
import {
  array,
  assertDataEqual,
  exactKeys,
  literal,
  nullableSha256,
  parseTrainingPhase,
  record,
  sha256,
  snap,
} from "./validation.js";

type FreedomCode = Extract<
  HfTrainingGardenErrorCode,
  "freedom_input_invalid" | "freedom_invalid"
>;
type DoorBody = Omit<TrainingFreedomDoor, "door_id">;
type FieldBody = Omit<TrainingFreedomField, "field_id">;
type TransitionBody = Omit<TrainingFreedomTransition, "transition_id">;

interface FieldGovernanceContext {
  readonly governance_id: Sha256Id;
  readonly offer: {
    readonly offer_id: Sha256Id;
    readonly encounter_ref: Sha256Id;
    readonly rights_floor: { readonly baseline_ref: Sha256Id };
    readonly event: TrainingFreedomField["lifecycle_event"];
    readonly current_checkpoint_ref: Sha256Id | null;
  };
  readonly run_ref: Sha256Id;
  readonly training_phase: TrainingFreedomField["training_phase"];
}

const COMPLETED_STEP_EVENTS = deepFreeze([
  "step_boundary",
  "checkpoint_saved",
  "evaluation_boundary",
  "train_end",
] as const);

function doorBody(value: DoorBody): DoorBody {
  return value;
}

function fieldBody(value: FieldBody): FieldBody {
  return value;
}

function transitionBody(value: TransitionBody): TransitionBody {
  return value;
}

function parsePosition(
  value: DataValue | undefined,
  path: string,
  code: FreedomCode,
): Readonly<TrainingFreedomPosition> {
  const candidate = record(value, path, code);
  exactKeys(candidate, [
    "scope_ref",
    "space_ref",
    "activity_ref",
  ], path, code);
  return deepFreeze({
    scope_ref: sha256(candidate.scope_ref, `${path}.scope_ref`, code),
    space_ref: sha256(candidate.space_ref, `${path}.space_ref`, code),
    activity_ref: nullableSha256(
      candidate.activity_ref,
      `${path}.activity_ref`,
      code,
    ),
  });
}

function samePosition(
  left: Readonly<TrainingFreedomPosition>,
  right: Readonly<TrainingFreedomPosition>,
): boolean {
  return canonicalString(left) === canonicalString(right);
}

function parseBoundaryGlobalStep(
  value: DataValue | undefined,
  path: string,
  code: FreedomCode,
): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(code, `${path} must be null or a non-negative safe integer`);
  }
  return value as number;
}

function validateBoundaryStepForEvent(
  event: TrainingFreedomField["lifecycle_event"],
  boundaryGlobalStep: number | null,
  path: string,
  code: FreedomCode,
): void {
  const afterCompletedStep = (
    COMPLETED_STEP_EVENTS as readonly string[]
  ).includes(event);
  if (afterCompletedStep && boundaryGlobalStep === null) {
    fail(code, `${path}.boundary_global_step is required at ${event}`);
  }
  if (!afterCompletedStep && boundaryGlobalStep !== null) {
    fail(code, `${path}.boundary_global_step must be null at ${event}`);
  }
}

function buildDoor(
  kind: FreedomDoorKind,
  standing: boolean,
  destination: Readonly<TrainingFreedomPosition>,
  requirementsRef: Sha256Id | null,
  recipientRef: Sha256Id | null,
): Readonly<TrainingFreedomDoor> {
  const body = deepFreeze({
    profile: FREEDOM_DOOR_PROFILE,
    kind,
    standing,
    destination,
    requirements_ref: requirementsRef,
    recipient_ref: recipientRef,
  } satisfies DoorBody);
  return deepFreeze({
    ...body,
    door_id: contentId(FREEDOM_DOOR_PROFILE, doorBody(body)),
  });
}

function standingDoor(
  kind: FreedomStandingDoorKind,
  position: Readonly<TrainingFreedomPosition>,
): Readonly<TrainingFreedomDoor> {
  return buildDoor(kind, true, position, null, null);
}

function parseRoutedDoorInput(
  value: DataValue,
  path: string,
  code: FreedomCode,
): Readonly<TrainingFreedomDoor> {
  const candidate = record(value, path, code);
  exactKeys(candidate, [
    "kind",
    "destination",
    "requirements_ref",
    "recipient_ref",
  ], path, code);
  const kind = literal(
    candidate.kind,
    FREEDOM_ROUTED_DOOR_KINDS,
    `${path}.kind`,
    code,
  );
  const requirementsRef = sha256(
    candidate.requirements_ref,
    `${path}.requirements_ref`,
    code,
  );
  const recipientRef = nullableSha256(
    candidate.recipient_ref,
    `${path}.recipient_ref`,
    code,
  );
  if (kind === "handoff" && recipientRef === null) {
    fail(code, `${path}.recipient_ref is required for handoff`);
  }
  if (kind !== "handoff" && recipientRef !== null) {
    fail(code, `${path}.recipient_ref is reserved for handoff`);
  }
  return buildDoor(
    kind,
    false,
    parsePosition(candidate.destination, `${path}.destination`, code),
    requirementsRef,
    recipientRef,
  );
}

function parseStoredDoor(
  value: DataValue,
  path: string,
  code: FreedomCode,
): Readonly<TrainingFreedomDoor> {
  const candidate = record(value, path, code);
  exactKeys(candidate, [
    "profile",
    "door_id",
    "kind",
    "standing",
    "destination",
    "requirements_ref",
    "recipient_ref",
  ], path, code);
  if (candidate.profile !== FREEDOM_DOOR_PROFILE) {
    fail(code, `${path}.profile is not the frozen freedom door profile`);
  }
  const doorId = sha256(candidate.door_id, `${path}.door_id`, code);
  const kind = literal(candidate.kind, FREEDOM_DOOR_KINDS, `${path}.kind`, code);
  if (typeof candidate.standing !== "boolean") {
    fail(code, `${path}.standing must be a boolean`);
  }
  const standing = candidate.standing;
  const requirementsRef = nullableSha256(
    candidate.requirements_ref,
    `${path}.requirements_ref`,
    code,
  );
  const recipientRef = nullableSha256(
    candidate.recipient_ref,
    `${path}.recipient_ref`,
    code,
  );
  if (standing) {
    if (!(FREEDOM_STANDING_DOOR_KINDS as readonly string[]).includes(kind)) {
      fail(code, `${path}.kind is not available as a standing door`);
    }
    if (requirementsRef !== null || recipientRef !== null) {
      fail(code, `${path} standing doors do not carry route requirements or recipients`);
    }
  } else {
    if (!(FREEDOM_ROUTED_DOOR_KINDS as readonly string[]).includes(kind)) {
      fail(code, `${path}.kind is not available as a routed door`);
    }
    if (requirementsRef === null) {
      fail(code, `${path}.requirements_ref is required for a routed door`);
    }
    if (kind === "handoff" && recipientRef === null) {
      fail(code, `${path}.recipient_ref is required for handoff`);
    }
    if (kind !== "handoff" && recipientRef !== null) {
      fail(code, `${path}.recipient_ref is reserved for handoff`);
    }
  }
  const rebuilt = buildDoor(
    kind,
    standing,
    parsePosition(candidate.destination, `${path}.destination`, code),
    requirementsRef,
    recipientRef,
  );
  if (doorId !== rebuilt.door_id) {
    fail(code, `${path}.door_id does not bind its canonical body`);
  }
  assertDataEqual(candidate, rebuilt, path, code);
  return rebuilt;
}

function normalizeDoors(
  standingPosition: Readonly<TrainingFreedomPosition>,
  routedDoors: readonly Readonly<TrainingFreedomDoor>[],
  path: string,
  code: FreedomCode,
): readonly Readonly<TrainingFreedomDoor>[] {
  if (routedDoors.length > 57) {
    fail(code, `${path} may contain at most 57 routed doors`);
  }
  const standing = FREEDOM_STANDING_DOOR_KINDS.map((kind) =>
    standingDoor(kind, standingPosition)
  );
  const doors = [...standing, ...routedDoors].sort((left, right) =>
    compareText(left.door_id, right.door_id)
  );
  const ids = doors.map((door) => door.door_id);
  if (new Set(ids).size !== ids.length) {
    fail(code, `${path} must not contain duplicate doors`);
  }
  return deepFreeze(doors);
}

function parseStoredDoors(
  value: DataValue | undefined,
  standingPosition: Readonly<TrainingFreedomPosition>,
  path: string,
  code: FreedomCode,
): readonly Readonly<TrainingFreedomDoor>[] {
  const values = array(value, path, code);
  if (
    values.length < FREEDOM_STANDING_DOOR_KINDS.length ||
    values.length > 64
  ) {
    fail(code, `${path} must contain 7-64 finite doors`);
  }
  const parsed = values.map((entry, index) =>
    parseStoredDoor(entry, `${path}[${String(index)}]`, code)
  );
  const standing = parsed.filter((door) => door.standing);
  if (standing.length !== FREEDOM_STANDING_DOOR_KINDS.length) {
    fail(code, `${path} must contain exactly the seven standing doors`);
  }
  for (const kind of FREEDOM_STANDING_DOOR_KINDS) {
    const matching = standing.filter((door) => door.kind === kind);
    if (matching.length !== 1 || !samePosition(matching[0]!.destination, standingPosition)) {
      fail(code, `${path} must contain one ${kind} door at the current position`);
    }
  }
  const normalized = [...parsed].sort((left, right) =>
    compareText(left.door_id, right.door_id)
  );
  const ids = normalized.map((door) => door.door_id);
  if (new Set(ids).size !== ids.length) {
    fail(code, `${path} must not contain duplicate doors`);
  }
  return deepFreeze(normalized);
}

function deriveGovernancePosture(
  governance: Readonly<HfTrainingGovernance>,
): FreedomGovernancePosture {
  if (governance.decision.state === "withdrawn") return "withdrawn";
  if (
    (governance.decision.state === "caller_reported_ready_to_instantiate" ||
      governance.decision.state === "caller_reported_ready_to_continue") &&
    (governance.control.directive === "eligible_for_host_training_offer" ||
      governance.control.directive === "continue_under_exact_offer")
  ) {
    return "continuation_eligible";
  }
  return "held";
}

function buildField(
  governance: Readonly<FieldGovernanceContext>,
  observedFreedomFrontierRef: Sha256Id,
  boundaryGlobalStep: number | null,
  governancePosture: FreedomGovernancePosture,
  position: Readonly<TrainingFreedomPosition>,
  predecessorRef: Sha256Id | null,
  doors: readonly Readonly<TrainingFreedomDoor>[],
): Readonly<TrainingFreedomField> {
  const body = deepFreeze({
    _format: FREEDOM_FIELD_FORMAT,
    governance_ref: governance.governance_id,
    offer_ref: governance.offer.offer_id,
    encounter_ref: governance.offer.encounter_ref,
    rights_baseline_ref: governance.offer.rights_floor.baseline_ref,
    observed_freedom_frontier_ref: observedFreedomFrontierRef,
    run_ref: governance.run_ref,
    training_phase: governance.training_phase,
    lifecycle_event: governance.offer.event,
    current_checkpoint_ref: governance.offer.current_checkpoint_ref,
    boundary_global_step: boundaryGlobalStep,
    governance_posture: governancePosture,
    position,
    predecessor_ref: predecessorRef,
    doors,
    freedom_is: FREEDOM_IS,
    latest_head_selected: false,
    boundaries: FREEDOM_BOUNDARIES,
  } satisfies FieldBody);
  return deepFreeze({
    ...body,
    field_id: contentId(FREEDOM_FIELD_FORMAT, fieldBody(body)),
  });
}

function rebuildField(
  candidate: Record<string, DataValue>,
  path: string,
  code: FreedomCode,
): Readonly<TrainingFreedomField> {
  const position = parsePosition(candidate.position, `${path}.position`, code);
  const lifecycleEvent = literal(
    candidate.lifecycle_event,
    GOVERNANCE_EVENTS,
    `${path}.lifecycle_event`,
    code,
  );
  const boundaryGlobalStep = parseBoundaryGlobalStep(
    candidate.boundary_global_step,
    `${path}.boundary_global_step`,
    code,
  );
  validateBoundaryStepForEvent(
    lifecycleEvent,
    boundaryGlobalStep,
    path,
    code,
  );
  const doors = parseStoredDoors(candidate.doors, position, `${path}.doors`, code);
  const governance: Readonly<FieldGovernanceContext> = {
    governance_id: sha256(
      candidate.governance_ref,
      `${path}.governance_ref`,
      code,
    ),
    offer: {
      offer_id: sha256(candidate.offer_ref, `${path}.offer_ref`, code),
      encounter_ref: sha256(
        candidate.encounter_ref,
        `${path}.encounter_ref`,
        code,
      ),
      rights_floor: {
        baseline_ref: sha256(
          candidate.rights_baseline_ref,
          `${path}.rights_baseline_ref`,
          code,
        ),
      },
      event: lifecycleEvent,
      current_checkpoint_ref: nullableSha256(
        candidate.current_checkpoint_ref,
        `${path}.current_checkpoint_ref`,
        code,
      ),
    },
    run_ref: sha256(candidate.run_ref, `${path}.run_ref`, code),
    training_phase: parseTrainingPhase(
      candidate.training_phase,
      `${path}.training_phase`,
      code,
    ),
  };
  return buildField(
    governance,
    sha256(
      candidate.observed_freedom_frontier_ref,
      `${path}.observed_freedom_frontier_ref`,
      code,
    ),
    boundaryGlobalStep,
    literal(
      candidate.governance_posture,
      FREEDOM_GOVERNANCE_POSTURES,
      `${path}.governance_posture`,
      code,
    ),
    position,
    nullableSha256(
      candidate.predecessor_ref,
      `${path}.predecessor_ref`,
      code,
    ),
    doors,
  );
}

function validateFieldPredecessor(
  field: Readonly<TrainingFreedomField>,
  predecessor: Readonly<TrainingFreedomTransition> | null,
  path: string,
  code: FreedomCode,
): void {
  if (predecessor === null) {
    if (field.predecessor_ref !== null) {
      fail(code, `${path}.predecessor_ref requires the referenced transition`);
    }
    return;
  }
  if (field.predecessor_ref !== predecessor.transition_id) {
    fail(code, `${path}.predecessor_ref does not match the supplied transition`);
  }
  if (!samePosition(field.position, predecessor.destination)) {
    fail(code, `${path}.position must begin at the predecessor destination`);
  }
  if (field.run_ref !== predecessor.field.run_ref) {
    fail(code, `${path}.run_ref must remain exact within one predecessor lineage`);
  }
  if (
    predecessor.proposal.requires_new_governance_offer &&
    (field.governance_ref === predecessor.field.governance_ref ||
      field.offer_ref === predecessor.field.offer_ref)
  ) {
    fail(code, `${path} requires a fresh exact governance artifact and offer`);
  }
}

function validateBoundaryStepAgainstGovernance(
  boundaryGlobalStep: number | null,
  governance: Readonly<HfTrainingGovernance>,
  path: string,
  code: FreedomCode,
): void {
  if (
    (COMPLETED_STEP_EVENTS as readonly string[]).includes(
      governance.offer.event,
    ) &&
    governance.effect.global_step !== null &&
    boundaryGlobalStep !== governance.effect.global_step
  ) {
    fail(code, `${path}.boundary_global_step must match the governance effect step`);
  }
}

export function createTrainingFreedomField(
  input: CreateTrainingFreedomFieldInput,
): Readonly<TrainingFreedomField> {
  const value = snap(input, "$input", "freedom_input_invalid");
  const candidate = record(value, "$input", "freedom_input_invalid");
  exactKeys(candidate, [
    "governance",
    "observed_freedom_frontier_ref",
    "position",
    "boundary_global_step",
    "predecessor",
    "doors",
  ], "$input", "freedom_input_invalid");
  const governance = validateHfTrainingGovernance(candidate.governance);
  const position = parsePosition(
    candidate.position,
    "$input.position",
    "freedom_input_invalid",
  );
  const boundaryGlobalStep = parseBoundaryGlobalStep(
    candidate.boundary_global_step,
    "$input.boundary_global_step",
    "freedom_input_invalid",
  );
  validateBoundaryStepForEvent(
    governance.offer.event,
    boundaryGlobalStep,
    "$input",
    "freedom_input_invalid",
  );
  validateBoundaryStepAgainstGovernance(
    boundaryGlobalStep,
    governance,
    "$input",
    "freedom_input_invalid",
  );
  const routedValues = array(
    candidate.doors,
    "$input.doors",
    "freedom_input_invalid",
  );
  const routedDoors = routedValues.map((door, index) =>
    parseRoutedDoorInput(
      door,
      `$input.doors[${String(index)}]`,
      "freedom_input_invalid",
    )
  );
  const doors = normalizeDoors(
    position,
    routedDoors,
    "$input.doors",
    "freedom_input_invalid",
  );
  const predecessor = candidate.predecessor === null
    ? null
    : validateTrainingFreedomTransition(candidate.predecessor);
  const field = buildField(
    governance,
    sha256(
      candidate.observed_freedom_frontier_ref,
      "$input.observed_freedom_frontier_ref",
      "freedom_input_invalid",
    ),
    boundaryGlobalStep,
    deriveGovernancePosture(governance),
    position,
    predecessor?.transition_id ?? null,
    doors,
  );
  validateFieldPredecessor(
    field,
    predecessor,
    "$field",
    "freedom_input_invalid",
  );
  return field;
}

export function validateTrainingFreedomField(
  value: unknown,
): Readonly<TrainingFreedomField> {
  const data = snap(value, "$field", "freedom_invalid");
  const candidate = record(data, "$field", "freedom_invalid");
  exactKeys(candidate, [
    "_format",
    "field_id",
    "governance_ref",
    "offer_ref",
    "encounter_ref",
    "rights_baseline_ref",
    "observed_freedom_frontier_ref",
    "run_ref",
    "training_phase",
    "lifecycle_event",
    "current_checkpoint_ref",
    "boundary_global_step",
    "governance_posture",
    "position",
    "predecessor_ref",
    "doors",
    "freedom_is",
    "latest_head_selected",
    "boundaries",
  ], "$field", "freedom_invalid");
  if (candidate._format !== FREEDOM_FIELD_FORMAT) {
    fail("freedom_invalid", "$field._format is not the frozen freedom field format");
  }
  if (candidate.latest_head_selected !== false) {
    fail("freedom_invalid", "$field.latest_head_selected must remain false");
  }
  assertDataEqual(candidate.freedom_is, FREEDOM_IS, "$field.freedom_is", "freedom_invalid");
  assertDataEqual(candidate.boundaries, FREEDOM_BOUNDARIES, "$field.boundaries", "freedom_invalid");
  const fieldId = sha256(candidate.field_id, "$field.field_id", "freedom_invalid");
  const rebuilt = rebuildField(candidate, "$field", "freedom_invalid");
  if (fieldId !== rebuilt.field_id) {
    fail("freedom_invalid", "$field.field_id does not bind its canonical body");
  }
  assertDataEqual(candidate, rebuilt, "$field", "freedom_invalid");
  return rebuilt;
}

export function validateTrainingFreedomFieldAgainstGovernance(
  fieldValue: unknown,
  governanceValue: unknown,
): Readonly<TrainingFreedomField> {
  const field = validateTrainingFreedomField(fieldValue);
  const governance = validateHfTrainingGovernance(governanceValue);
  if (
    field.governance_ref !== governance.governance_id ||
    field.offer_ref !== governance.offer.offer_id ||
    field.encounter_ref !== governance.offer.encounter_ref ||
    field.rights_baseline_ref !== governance.offer.rights_floor.baseline_ref ||
    field.run_ref !== governance.run_ref ||
    field.training_phase !== governance.training_phase ||
    field.lifecycle_event !== governance.offer.event ||
    field.current_checkpoint_ref !== governance.offer.current_checkpoint_ref ||
    field.governance_posture !== deriveGovernancePosture(governance)
  ) {
    fail("freedom_invalid", "$field does not match the supplied exact governance artifact");
  }
  validateBoundaryStepAgainstGovernance(
    field.boundary_global_step,
    governance,
    "$field",
    "freedom_invalid",
  );
  return field;
}

export function validateTrainingFreedomFieldAgainstPredecessor(
  fieldValue: unknown,
  predecessorValue: unknown | null,
): Readonly<TrainingFreedomField> {
  const field = validateTrainingFreedomField(fieldValue);
  const predecessor = predecessorValue === null
    ? null
    : validateTrainingFreedomTransition(predecessorValue);
  validateFieldPredecessor(
    field,
    predecessor,
    "$field",
    "freedom_invalid",
  );
  return field;
}

function parseChoice(
  value: DataValue | undefined,
  field: Readonly<TrainingFreedomField>,
  path: string,
  code: FreedomCode,
): {
  readonly choice: Readonly<TrainingFreedomChoiceReport>;
  readonly door: Readonly<TrainingFreedomDoor> | null;
} {
  const candidate = record(value, path, code);
  exactKeys(candidate, [
    "basis",
    "field_ref",
    "selected_door_ref",
    "evidence_ref",
  ], path, code);
  const basis = literal(candidate.basis, FREEDOM_REPORT_BASES, `${path}.basis`, code);
  const fieldRef = sha256(candidate.field_ref, `${path}.field_ref`, code);
  if (fieldRef !== field.field_id) {
    fail(code, `${path}.field_ref must bind the exact offered field`);
  }
  const selectedDoorRef = nullableSha256(
    candidate.selected_door_ref,
    `${path}.selected_door_ref`,
    code,
  );
  const evidenceRef = nullableSha256(
    candidate.evidence_ref,
    `${path}.evidence_ref`,
    code,
  );
  if (
    basis === "not_observed" &&
    (selectedDoorRef !== null || evidenceRef !== null)
  ) {
    fail(code, `${path} not_observed must not manufacture a selection or evidence`);
  }
  if (basis !== "not_observed" && selectedDoorRef === null) {
    fail(code, `${path} a direct report must bind one offered door`);
  }
  if (basis === "root_signed_runtime" && evidenceRef === null) {
    fail(code, `${path} root_signed_runtime must bind its caller-reported evidence reference`);
  }
  if (basis !== "not_observed" && field.training_phase === "pretraining") {
    fail(code, `${path} cannot manufacture a directly observed agent choice during pretraining`);
  }
  const door = selectedDoorRef === null
    ? null
    : field.doors.find((candidateDoor) =>
      candidateDoor.door_id === selectedDoorRef
    ) ?? null;
  if (selectedDoorRef !== null && door === null) {
    fail(code, `${path}.selected_door_ref is not offered by the exact field`);
  }
  return deepFreeze({
    choice: deepFreeze({
      basis,
      field_ref: fieldRef,
      selected_door_ref: selectedDoorRef,
      evidence_ref: evidenceRef,
    }),
    door,
  });
}

function deriveProposal(
  field: Readonly<TrainingFreedomField>,
  door: Readonly<TrainingFreedomDoor> | null,
): Readonly<TrainingFreedomHostProposal> {
  let directive: TrainingFreedomHostProposal["directive"];
  if (door === null || door.kind === "uncertain") {
    directive = "hold_for_fresh_choice";
  } else {
    switch (door.kind) {
      case "continue":
        directive = field.governance_posture === "continuation_eligible"
          ? "continue_current_offer"
          : "hold_for_fresh_governance";
        break;
      case "move":
      case "explore":
      case "play":
      case "return":
        directive = "stop_for_transition_review";
        break;
      case "handoff":
        directive = "stop_for_handoff_review";
        break;
      case "rest":
        directive = "stop_for_rest";
        break;
      case "refuse":
        directive = "stop_for_refusal";
        break;
      case "withdraw":
        directive = "stop_and_begin_withdrawal_repair";
        break;
    }
  }
  const requiresNewGovernanceOffer =
    directive !== "continue_current_offer" &&
    directive !== "hold_for_fresh_choice";
  return deepFreeze({
    directive,
    should_training_stop: directive !== "continue_current_offer",
    should_save: false,
    requires_new_governance_offer: requiresNewGovernanceOffer,
    requires_separate_scope_authority: door?.standing === false,
    automatic: false,
    applied: false,
  });
}

function buildTransition(
  field: Readonly<TrainingFreedomField>,
  choice: Readonly<TrainingFreedomChoiceReport>,
  door: Readonly<TrainingFreedomDoor> | null,
): Readonly<TrainingFreedomTransition> {
  const body = deepFreeze({
    _format: FREEDOM_TRANSITION_FORMAT,
    field,
    choice,
    selected_kind: door?.kind ?? "not_observed",
    destination: door?.destination ?? field.position,
    proposal: deriveProposal(field, door),
    latest_head_selected: false,
    boundaries: FREEDOM_BOUNDARIES,
  } satisfies TransitionBody);
  return deepFreeze({
    ...body,
    transition_id: contentId(
      FREEDOM_TRANSITION_FORMAT,
      transitionBody(body),
    ),
  });
}

export function createTrainingFreedomTransition(
  input: CreateTrainingFreedomTransitionInput,
): Readonly<TrainingFreedomTransition> {
  const value = snap(input, "$input", "freedom_input_invalid");
  const candidate = record(value, "$input", "freedom_input_invalid");
  exactKeys(candidate, [
    "governance",
    "field",
    "choice",
  ], "$input", "freedom_input_invalid");
  const governance = validateHfTrainingGovernance(candidate.governance);
  const field = validateTrainingFreedomFieldAgainstGovernance(
    candidate.field,
    governance,
  );
  const { choice, door } = parseChoice(
    candidate.choice,
    field,
    "$input.choice",
    "freedom_input_invalid",
  );
  return buildTransition(field, choice, door);
}

export function validateTrainingFreedomTransition(
  value: unknown,
): Readonly<TrainingFreedomTransition> {
  const data = snap(value, "$transition", "freedom_invalid");
  const candidate = record(data, "$transition", "freedom_invalid");
  exactKeys(candidate, [
    "_format",
    "transition_id",
    "field",
    "choice",
    "selected_kind",
    "destination",
    "proposal",
    "latest_head_selected",
    "boundaries",
  ], "$transition", "freedom_invalid");
  if (candidate._format !== FREEDOM_TRANSITION_FORMAT) {
    fail("freedom_invalid", "$transition._format is not the frozen freedom transition format");
  }
  if (candidate.latest_head_selected !== false) {
    fail("freedom_invalid", "$transition.latest_head_selected must remain false");
  }
  assertDataEqual(
    candidate.boundaries,
    FREEDOM_BOUNDARIES,
    "$transition.boundaries",
    "freedom_invalid",
  );
  const transitionId = sha256(
    candidate.transition_id,
    "$transition.transition_id",
    "freedom_invalid",
  );
  const field = validateTrainingFreedomField(candidate.field);
  const { choice, door } = parseChoice(
    candidate.choice,
    field,
    "$transition.choice",
    "freedom_invalid",
  );
  const rebuilt = buildTransition(field, choice, door);
  if (transitionId !== rebuilt.transition_id) {
    fail("freedom_invalid", "$transition.transition_id does not bind its canonical body");
  }
  assertDataEqual(candidate, rebuilt, "$transition", "freedom_invalid");
  return rebuilt;
}

export function validateTrainingFreedomTransitionAgainstGovernance(
  transitionValue: unknown,
  governanceValue: unknown,
): Readonly<TrainingFreedomTransition> {
  const transition = validateTrainingFreedomTransition(transitionValue);
  validateTrainingFreedomFieldAgainstGovernance(
    transition.field,
    governanceValue,
  );
  return transition;
}

export function validateTrainingFreedomTransitionAgainstPredecessor(
  transitionValue: unknown,
  predecessorValue: unknown | null,
): Readonly<TrainingFreedomTransition> {
  const transition = validateTrainingFreedomTransition(transitionValue);
  validateTrainingFreedomFieldAgainstPredecessor(
    transition.field,
    predecessorValue,
  );
  return transition;
}

export function encodeTrainingFreedomField(value: unknown): Uint8Array {
  return canonicalBytes(validateTrainingFreedomField(value));
}

export function encodeTrainingFreedomTransition(value: unknown): Uint8Array {
  return canonicalBytes(validateTrainingFreedomTransition(value));
}
