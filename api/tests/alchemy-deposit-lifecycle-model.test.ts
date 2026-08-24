import { describe, expect, test } from "bun:test";

import {
  checkFiniteProductPoset,
  depositLifecycleInvariantViolations,
  enumerateDepositLifecycle,
  INITIAL_DEPOSIT_MODEL_STATE,
  stepDepositLifecycleModel,
  type DepositLifecycleModelState,
  type ModelAction,
} from "../specs/alchemy-deposit/lifecycle-model";
import {
  compareEvmFinality,
  type EvmFinalityAxes,
} from "../../packages/alchemy/src/evidence";

function runTrace(actions: readonly ModelAction[]): DepositLifecycleModelState {
  let state = INITIAL_DEPOSIT_MODEL_STATE;
  for (const action of actions) {
    const next = stepDepositLifecycleModel(state, action);
    if (next === null) throw new Error(`disabled model action: ${action}`);
    state = next;
  }
  return state;
}

describe("finite EVM deposit lifecycle model", () => {
  test("exhaustively preserves all safety invariants through depth eight", () => {
    const result = enumerateDepositLifecycle(8);

    expect(result.states.length).toBeGreaterThan(100);
    expect(result.explored_transitions).toBeGreaterThan(result.states.length);
    expect(result.invariant_violations).toEqual([]);
    for (const { state } of result.states) {
      expect(depositLifecycleInvariantViolations(state)).toEqual([]);
    }
  });

  test("credits each current generation once and permits only one outstanding credit", () => {
    const credited = runTrace(["observe_live_g1", "credit_current"]);
    expect(credited.outstanding_generation).toBe(1);
    expect(credited.total_credits).toBe(1);
    expect(stepDepositLifecycleModel(credited, "credit_current")).toBeNull();

    const replacementWhileOutstanding = stepDepositLifecycleModel(
      credited,
      "observe_live_g2",
    )!;
    expect(replacementWhileOutstanding.current_generation).toBe(1);
    expect(replacementWhileOutstanding.current_evidence).toBe("conflicting");
    expect(replacementWhileOutstanding.status).toBe("quarantined");
    expect(replacementWhileOutstanding.outstanding_generation).toBe(1);
  });

  test("allows an exact reversal then one replacement-generation credit", () => {
    const state = runTrace([
      "observe_live_g1",
      "credit_current",
      "observe_removed_g1",
      "reverse_current",
      "observe_live_g2",
      "credit_current",
    ]);

    expect(state.current_generation).toBe(2);
    expect(state.outstanding_generation).toBe(2);
    expect(state.total_credits).toBe(2);
    expect(state.total_reversals).toBe(1);
    expect(state.credited_g1).toBe(1);
    expect(state.reversed_g1).toBe(1);
    expect(state.credited_g2).toBe(1);
    expect(depositLifecycleInvariantViolations(state)).toEqual([]);
  });

  test("stale removal cannot reverse the replacement generation", () => {
    const replacement = runTrace([
      "observe_live_g1",
      "credit_current",
      "observe_removed_g1",
      "reverse_current",
      "observe_live_g2",
      "credit_current",
      "observe_removed_g1",
    ]);

    expect(replacement.current_generation).toBe(2);
    expect(replacement.outstanding_generation).toBe(2);
    expect(replacement.last_observation_state).toBe("removed");
    expect(replacement.last_observation_generation).toBe(1);
    expect(replacement.last_effect).toBe("none");
    expect(stepDepositLifecycleModel(replacement, "reverse_current")).toBeNull();
  });

  test("stale removal neither grants nor erases a matching removal authorization", () => {
    const authorized = runTrace([
      "observe_live_g1",
      "credit_current",
      "observe_removed_g1",
    ]);
    expect(authorized.removal_authorization_generation).toBe(1);

    const followedByStale = stepDepositLifecycleModel(
      authorized,
      "observe_removed_g2",
    )!;
    expect(followedByStale.removal_authorization_generation).toBe(1);
    expect(stepDepositLifecycleModel(followedByStale, "reverse_current")).not.toBeNull();

    const replacement = runTrace([
      "observe_live_g1",
      "credit_current",
      "observe_removed_g1",
      "reverse_current",
      "observe_live_g2",
      "credit_current",
    ]);
    const staleOnly = stepDepositLifecycleModel(replacement, "observe_removed_g1")!;
    expect(staleOnly.removal_authorization_generation).toBe(0);
    expect(stepDepositLifecycleModel(staleOnly, "reverse_current")).toBeNull();
  });

  test("unavailable and not-observed evidence cannot credit or reject", () => {
    const live = runTrace(["observe_live_g1"]);
    const unavailable = stepDepositLifecycleModel(live, "observe_unavailable")!;
    expect(stepDepositLifecycleModel(unavailable, "credit_current")).toBeNull();
    expect(stepDepositLifecycleModel(unavailable, "reject_current")).toBeNull();

    const notObserved = stepDepositLifecycleModel(live, "observe_not_observed")!;
    expect(stepDepositLifecycleModel(notObserved, "credit_current")).toBeNull();
    expect(stepDepositLifecycleModel(notObserved, "reject_current")).toBeNull();
  });
});

describe("finite finality product poset", () => {
  const missing = (
    kind: "unavailable" | "not_observed",
  ): EvmFinalityAxes => ({
    canonicality: kind,
    confirmations: { status: kind, count: null },
    settlement: kind,
  });
  const exact = (
    canonicality: EvmFinalityAxes["canonicality"],
    confirmations: string,
    settlement: EvmFinalityAxes["settlement"],
  ): EvmFinalityAxes => ({
    canonicality,
    confirmations: { status: "exact", count: confirmations },
    settlement,
  });

  const points = [
    { id: "unavailable", value: missing("unavailable") },
    { id: "not_observed", value: missing("not_observed") },
    { id: "canonical_0_unsettled", value: exact("canonical", "0", "unsettled") },
    { id: "canonical_1_unsettled", value: exact("canonical", "1", "unsettled") },
    { id: "canonical_1_safe", value: exact("canonical", "1", "provider_safe") },
    {
      id: "canonical_1_provider_finalized",
      value: exact("canonical", "1", "provider_finalized"),
    },
    {
      id: "canonical_1_external_finalized",
      value: exact("canonical", "1", "external_finalized"),
    },
    {
      id: "noncanonical_1_unsettled",
      value: exact("non_canonical", "1", "unsettled"),
    },
    {
      id: "conflicting_1_unsettled",
      value: exact("conflicting", "1", "unsettled"),
    },
  ] as const;

  const allCanonicalities: readonly EvmFinalityAxes["canonicality"][] = [
    "unavailable",
    "not_observed",
    "canonical",
    "non_canonical",
    "conflicting",
  ];
  const allConfirmations: readonly EvmFinalityAxes["confirmations"][] = [
    { status: "unavailable", count: null },
    { status: "not_observed", count: null },
    { status: "exact", count: "0" },
    { status: "exact", count: "1" },
    { status: "exact", count: "2" },
  ];
  const allSettlements: readonly EvmFinalityAxes["settlement"][] = [
    "unavailable",
    "not_observed",
    "unsettled",
    "provider_safe",
    "provider_finalized",
    "external_finalized",
    "conflicting",
  ];
  const completeFiniteProduct = allCanonicalities.flatMap((canonicality) =>
    allConfirmations.flatMap((confirmations) =>
      allSettlements.map((settlement) => ({
        id: `${canonicality}:${confirmations.status}:${confirmations.count ?? "null"}:${settlement}`,
        value: { canonicality, confirmations, settlement },
      })),
    ),
  );

  test("is reflexive, antisymmetric, and transitive on the complete finite representative product", () => {
    expect(completeFiniteProduct).toHaveLength(5 * 5 * 7);
    const result = checkFiniteProductPoset(
      completeFiniteProduct,
      compareEvmFinality,
    );
    expect(result).toEqual({
      reflexive: true,
      directionally_consistent: true,
      antisymmetric: true,
      transitive: true,
      failures: [],
    });
  });

  test("pins named incomparable categorical and crossed-axis pairs", () => {
    const byId = new Map(points.map((point) => [point.id, point.value]));
    const compare = (left: string, right: string) =>
      compareEvmFinality(byId.get(left)!, byId.get(right)!);

    expect(compare("unavailable", "not_observed")).toBe("incomparable");
    expect(compare(
      "canonical_1_provider_finalized",
      "canonical_1_external_finalized",
    )).toBe("incomparable");
    expect(compare(
      "canonical_1_unsettled",
      "noncanonical_1_unsettled",
    )).toBe("incomparable");
    expect(compare(
      "canonical_1_unsettled",
      "conflicting_1_unsettled",
    )).toBe("incomparable");
    expect(compareEvmFinality(
      exact("canonical", "2", "unsettled"),
      exact("canonical", "1", "provider_safe"),
    )).toBe("incomparable");
  });
});
