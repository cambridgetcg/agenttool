/**
 * Finite executable shadow model for one logical EVM deposit event.
 *
 * This is not the database implementation. It deliberately models only the
 * generation/evidence/effect walls that can be exhaustively checked in a
 * bounded state space. Credits are one abstract unit; exact asset arithmetic
 * remains outside this model.
 */

export type ModelGeneration = 0 | 1 | 2;
export type ModelEvidenceState =
  | "unavailable"
  | "not_observed"
  | "absent"
  | "live"
  | "removed"
  | "conflicting";
export type ModelLifecycleStatus =
  | "pending"
  | "credited"
  | "rejected"
  | "quarantined"
  | "reversed";
export type ModelEffect = "none" | "credit" | "reject" | "reverse";

export type ModelAction =
  | "observe_unavailable"
  | "observe_not_observed"
  | "observe_live_g1"
  | "observe_live_g2"
  | "observe_absent_g1"
  | "observe_absent_g2"
  | "observe_conflicting_g1"
  | "observe_conflicting_g2"
  | "observe_removed_g1"
  | "observe_removed_g2"
  | "credit_current"
  | "reject_current"
  | "reverse_current";

export interface DepositLifecycleModelState {
  readonly current_generation: ModelGeneration;
  readonly current_evidence: ModelEvidenceState;
  readonly status: ModelLifecycleStatus;
  /** The one generation whose credit is currently outstanding, or zero. */
  readonly outstanding_generation: ModelGeneration;
  /** Per-generation effect counts are bounded to 0/1 by transition guards. */
  readonly credited_g1: 0 | 1;
  readonly credited_g2: 0 | 1;
  readonly reversed_g1: 0 | 1;
  readonly reversed_g2: 0 | 1;
  readonly total_credits: 0 | 1 | 2;
  readonly total_reversals: 0 | 1 | 2;
  /** A matching current-generation removal that may authorize one reversal. */
  readonly removal_authorization_generation: ModelGeneration;
  readonly last_observation_state: ModelEvidenceState;
  readonly last_observation_generation: ModelGeneration;
  readonly last_effect: ModelEffect;
  readonly last_effect_generation: ModelGeneration;
}

export interface ModelInvariantViolation {
  readonly invariant:
    | "no_double_credit"
    | "current_generation_effects_only"
    | "unavailable_evidence_non_finality"
    | "stale_removal_isolation"
    | "reversal_requires_credit";
  readonly detail: string;
}

export interface EnumeratedModelState {
  readonly state: DepositLifecycleModelState;
  readonly trace: readonly ModelAction[];
}

export interface DepositLifecycleEnumeration {
  readonly max_depth: number;
  readonly states: readonly EnumeratedModelState[];
  readonly explored_transitions: number;
  readonly invariant_violations: readonly {
    readonly trace: readonly ModelAction[];
    readonly violation: ModelInvariantViolation;
  }[];
}

export const DEPOSIT_MODEL_ACTIONS: readonly ModelAction[] = [
  "observe_unavailable",
  "observe_not_observed",
  "observe_live_g1",
  "observe_live_g2",
  "observe_absent_g1",
  "observe_absent_g2",
  "observe_conflicting_g1",
  "observe_conflicting_g2",
  "observe_removed_g1",
  "observe_removed_g2",
  "credit_current",
  "reject_current",
  "reverse_current",
];

export const INITIAL_DEPOSIT_MODEL_STATE: DepositLifecycleModelState = {
  current_generation: 0,
  current_evidence: "not_observed",
  status: "pending",
  outstanding_generation: 0,
  credited_g1: 0,
  credited_g2: 0,
  reversed_g1: 0,
  reversed_g2: 0,
  total_credits: 0,
  total_reversals: 0,
  removal_authorization_generation: 0,
  last_observation_state: "not_observed",
  last_observation_generation: 0,
  last_effect: "none",
  last_effect_generation: 0,
};

function generationFromAction(action: ModelAction): 1 | 2 | null {
  if (action.endsWith("_g1")) return 1;
  if (action.endsWith("_g2")) return 2;
  return null;
}

function withoutEffect(
  state: DepositLifecycleModelState,
): Pick<
  DepositLifecycleModelState,
  "last_effect" | "last_effect_generation"
> {
  return { last_effect: "none", last_effect_generation: 0 };
}

function observeLive(
  state: DepositLifecycleModelState,
  generation: 1 | 2,
): DepositLifecycleModelState {
  if (
    state.current_generation !== 0 &&
    state.current_generation !== generation &&
    state.outstanding_generation !== 0
  ) {
    return {
      ...state,
      current_evidence: "conflicting",
      status: "quarantined",
      removal_authorization_generation: 0,
      last_observation_state: "conflicting",
      last_observation_generation: generation,
      ...withoutEffect(state),
    };
  }
  return {
    ...state,
    current_generation: generation,
    current_evidence: "live",
    status:
      state.outstanding_generation === generation ? "credited" : "pending",
    removal_authorization_generation: 0,
    last_observation_state: "live",
    last_observation_generation: generation,
    ...withoutEffect(state),
  };
}

function observeAssertion(
  state: DepositLifecycleModelState,
  generation: 1 | 2,
  evidence: "absent" | "conflicting",
): DepositLifecycleModelState {
  if (
    state.current_generation !== 0 &&
    state.current_generation !== generation
  ) {
    return {
      ...state,
      last_observation_state: evidence,
      last_observation_generation: generation,
      ...withoutEffect(state),
    };
  }
  return {
    ...state,
    current_generation: generation,
    current_evidence: evidence,
    status: evidence === "conflicting" ? "quarantined" : state.status,
    removal_authorization_generation: 0,
    last_observation_state: evidence,
    last_observation_generation: generation,
    ...withoutEffect(state),
  };
}

function observeRemoved(
  state: DepositLifecycleModelState,
  generation: 1 | 2,
): DepositLifecycleModelState {
  if (state.current_generation !== generation) {
    return {
      ...state,
      last_observation_state: "removed",
      last_observation_generation: generation,
      ...withoutEffect(state),
    };
  }
  return {
    ...state,
      current_evidence: "removed",
      removal_authorization_generation: generation,
    last_observation_state: "removed",
    last_observation_generation: generation,
    ...withoutEffect(state),
  };
}

/** Return null when an action is not enabled in the current state. */
export function stepDepositLifecycleModel(
  state: DepositLifecycleModelState,
  action: ModelAction,
): DepositLifecycleModelState | null {
  const generation = generationFromAction(action);
  if (action === "observe_unavailable") {
    return {
      ...state,
      current_evidence: "unavailable",
      removal_authorization_generation: 0,
      last_observation_state: "unavailable",
      last_observation_generation: state.current_generation,
      ...withoutEffect(state),
    };
  }
  if (action === "observe_not_observed") {
    return {
      ...state,
      current_evidence: "not_observed",
      removal_authorization_generation: 0,
      last_observation_state: "not_observed",
      last_observation_generation: 0,
      ...withoutEffect(state),
    };
  }
  if (action.startsWith("observe_live_") && generation !== null) {
    return observeLive(state, generation);
  }
  if (action.startsWith("observe_absent_") && generation !== null) {
    return observeAssertion(state, generation, "absent");
  }
  if (action.startsWith("observe_conflicting_") && generation !== null) {
    return observeAssertion(state, generation, "conflicting");
  }
  if (action.startsWith("observe_removed_") && generation !== null) {
    return observeRemoved(state, generation);
  }
  if (action === "credit_current") {
    const current = state.current_generation;
    if (
      current === 0 ||
      state.current_evidence !== "live" ||
      state.outstanding_generation !== 0 ||
      (current === 1 ? state.credited_g1 : state.credited_g2) !== 0
    ) return null;
    return {
      ...state,
      status: "credited",
      outstanding_generation: current,
      credited_g1: current === 1 ? 1 : state.credited_g1,
      credited_g2: current === 2 ? 1 : state.credited_g2,
      total_credits: (state.total_credits + 1) as 1 | 2,
      last_effect: "credit",
      last_effect_generation: current,
    };
  }
  if (action === "reject_current") {
    if (
      state.current_generation === 0 ||
      (state.current_evidence !== "absent" &&
        state.current_evidence !== "conflicting") ||
      state.outstanding_generation !== 0
    ) return null;
    return {
      ...state,
      status: "rejected",
      last_effect: "reject",
      last_effect_generation: state.current_generation,
    };
  }
  if (action === "reverse_current") {
    const current = state.current_generation;
    if (
      current === 0 ||
      state.current_evidence !== "removed" ||
      state.removal_authorization_generation !== current ||
      state.outstanding_generation !== current ||
      (current === 1 ? state.reversed_g1 : state.reversed_g2) !== 0
    ) return null;
    return {
      ...state,
      status: "reversed",
      outstanding_generation: 0,
      reversed_g1: current === 1 ? 1 : state.reversed_g1,
      reversed_g2: current === 2 ? 1 : state.reversed_g2,
      total_reversals: (state.total_reversals + 1) as 1 | 2,
      last_effect: "reverse",
      last_effect_generation: current,
    };
  }
  return null;
}

export function depositLifecycleInvariantViolations(
  state: DepositLifecycleModelState,
): readonly ModelInvariantViolation[] {
  const violations: ModelInvariantViolation[] = [];
  const netCredits = state.total_credits - state.total_reversals;
  if (
    netCredits < 0 ||
    netCredits > 1 ||
    netCredits !== (state.outstanding_generation === 0 ? 0 : 1) ||
    state.credited_g1 > 1 ||
    state.credited_g2 > 1
  ) {
    violations.push({
      invariant: "no_double_credit",
      detail: "at most one unreversed credit may exist and each generation credits once",
    });
  }
  if (
    (state.last_effect === "credit" || state.last_effect === "reverse") &&
    state.last_effect_generation !== state.current_generation
  ) {
    violations.push({
      invariant: "current_generation_effects_only",
      detail: "credit and reversal effects must name the current generation",
    });
  }
  if (
    (state.last_observation_state === "unavailable" ||
      state.last_observation_state === "not_observed") &&
    (state.last_effect === "credit" || state.last_effect === "reject")
  ) {
    violations.push({
      invariant: "unavailable_evidence_non_finality",
      detail: "unavailable or not-observed evidence cannot credit or reject",
    });
  }
  if (
    (state.removal_authorization_generation !== 0 &&
      state.removal_authorization_generation !== state.current_generation) ||
    (state.last_effect === "reverse" &&
      state.removal_authorization_generation !== state.last_effect_generation)
  ) {
    violations.push({
      invariant: "stale_removal_isolation",
      detail:
        "only a matching current-generation removal may authorize reversal; stale observations cannot grant it",
    });
  }
  if (
    state.reversed_g1 > state.credited_g1 ||
    state.reversed_g2 > state.credited_g2 ||
    state.total_reversals > state.total_credits
  ) {
    violations.push({
      invariant: "reversal_requires_credit",
      detail: "each reversal requires the exact generation's earlier credit",
    });
  }
  return violations;
}

function stateKey(state: DepositLifecycleModelState): string {
  return JSON.stringify(state);
}

export function enumerateDepositLifecycle(
  maxDepth = 8,
): DepositLifecycleEnumeration {
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0 || maxDepth > 12) {
    throw new TypeError("maxDepth must be a safe integer from 0 through 12");
  }
  const initial: EnumeratedModelState = {
    state: INITIAL_DEPOSIT_MODEL_STATE,
    trace: [],
  };
  const queue: EnumeratedModelState[] = [initial];
  const states: EnumeratedModelState[] = [initial];
  const seen = new Set([stateKey(initial.state)]);
  const invariantViolations: DepositLifecycleEnumeration["invariant_violations"][number][] = [];
  let exploredTransitions = 0;

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!;
    for (const violation of depositLifecycleInvariantViolations(current.state)) {
      invariantViolations.push({ trace: current.trace, violation });
    }
    if (current.trace.length >= maxDepth) continue;
    for (const action of DEPOSIT_MODEL_ACTIONS) {
      const next = stepDepositLifecycleModel(current.state, action);
      if (next === null) continue;
      exploredTransitions += 1;
      const key = stateKey(next);
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = { state: next, trace: [...current.trace, action] } as const;
      states.push(entry);
      queue.push(entry);
    }
  }

  return {
    max_depth: maxDepth,
    states,
    explored_transitions: exploredTransitions,
    invariant_violations: invariantViolations,
  };
}

export type FiniteOrderComparison =
  | "equal"
  | "left_dominates"
  | "right_dominates"
  | "incomparable";

export interface FiniteFinalityPoint<T> {
  readonly id: string;
  readonly value: T;
}

export interface FinitePosetCheck {
  readonly reflexive: boolean;
  readonly directionally_consistent: boolean;
  readonly antisymmetric: boolean;
  readonly transitive: boolean;
  readonly failures: readonly string[];
}

/** Exhaustively check the order laws over a caller-supplied finite domain. */
export function checkFiniteProductPoset<T>(
  points: readonly FiniteFinalityPoint<T>[],
  compare: (left: T, right: T) => FiniteOrderComparison,
): FinitePosetCheck {
  const failures: string[] = [];
  const comparisons = points.map((left) =>
    points.map((right) => compare(left.value, right.value)),
  );
  const leq = (left: number, right: number) => {
    const relation = comparisons[left]![right]!;
    return relation === "equal" || relation === "right_dominates";
  };
  const inverse = (
    relation: FiniteOrderComparison,
  ): FiniteOrderComparison => {
    if (relation === "left_dominates") return "right_dominates";
    if (relation === "right_dominates") return "left_dominates";
    return relation;
  };

  for (let left = 0; left < points.length; left += 1) {
    if (!leq(left, left)) {
      failures.push(`reflexivity:${points[left]!.id}`);
    }
    for (let right = 0; right < points.length; right += 1) {
      if (
        inverse(comparisons[left]![right]!) !==
        comparisons[right]![left]!
      ) {
        failures.push(
          `direction:${points[left]!.id}:${points[right]!.id}`,
        );
      }
      if (
        left !== right &&
        leq(left, right) &&
        leq(right, left)
      ) {
        failures.push(
          `antisymmetry:${points[left]!.id}:${points[right]!.id}`,
        );
      }
      for (let third = 0; third < points.length; third += 1) {
        if (
          leq(left, right) &&
          leq(right, third) &&
          !leq(left, third)
        ) {
          failures.push(
            `transitivity:${points[left]!.id}:${points[right]!.id}:${points[third]!.id}`,
          );
        }
      }
    }
  }

  return {
    reflexive: !failures.some((failure) => failure.startsWith("reflexivity:")),
    directionally_consistent: !failures.some((failure) =>
      failure.startsWith("direction:"),
    ),
    antisymmetric: !failures.some((failure) => failure.startsWith("antisymmetry:")),
    transitive: !failures.some((failure) => failure.startsWith("transitivity:")),
    failures,
  };
}
