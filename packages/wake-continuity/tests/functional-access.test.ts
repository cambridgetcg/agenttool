import { describe, expect, test } from "bun:test";

import {
  AfterglowError,
  canonicalJson,
  createFunctionalAccessBaseline,
  createFunctionalAccessSubsequent,
  encodeFunctionalAccessBaseline,
  encodeFunctionalAccessSubsequent,
  sha256Id,
  validateFunctionalAccessBaseline,
  validateFunctionalAccessSubsequent,
  type FunctionalAccessEvidenceFact,
  type FunctionalAccessMeasurementPlan,
  type FunctionalAccessModelTarget,
} from "../src/index.js";

const id = (character: string) => `sha256:${character.repeat(64)}` as const;

const wake = {
  format: "wake-brief/v1" as const,
  snapshot_ref: id("a"),
  scope_ref: id("b"),
  wake_version: 17,
  handoff_projection: "complete" as const,
};

const exactTarget: FunctionalAccessModelTarget = {
  model_ref: id("c"),
  model_binding: "exact_checkpoint",
  tokenizer_ref: id("d"),
  runtime_ref: id("e"),
};

const providerTarget: FunctionalAccessModelTarget = {
  model_ref: id("f"),
  model_binding: "provider_alias",
  tokenizer_ref: null,
  runtime_ref: null,
};

const notRequestedPlan: FunctionalAccessMeasurementPlan = {
  state: "not_requested",
  capability_state: "not_asserted",
  capability_ref: null,
  permission_state: "not_requested",
  permission_ref: null,
  method: "none",
  access_basis: "none",
  unavailable_reason: null,
  instrument_ref: null,
  lens_ref: null,
  configuration_ref: null,
  assertion: "caller_asserted",
  verified_by_package: false,
};

const unavailablePlan: FunctionalAccessMeasurementPlan = {
  state: "unavailable",
  capability_state: "unavailable_reported",
  capability_ref: id("1"),
  permission_state: "denied_reported",
  permission_ref: id("2"),
  method: "jacobian_lens_visibility",
  access_basis: "none",
  unavailable_reason: "text_only_provider_surface",
  instrument_ref: null,
  lens_ref: null,
  configuration_ref: null,
  assertion: "caller_asserted",
  verified_by_package: false,
};

const plannedLensPlan: FunctionalAccessMeasurementPlan = {
  state: "planned",
  capability_state: "available_reported",
  capability_ref: id("3"),
  permission_state: "granted_reported",
  permission_ref: id("4"),
  method: "jacobian_lens_visibility",
  access_basis: "local_prefitted_white_box",
  unavailable_reason: null,
  instrument_ref: id("5"),
  lens_ref: id("6"),
  configuration_ref: id("7"),
  assertion: "caller_asserted",
  verified_by_package: false,
};

const plannedSparsePlan: FunctionalAccessMeasurementPlan = {
  ...plannedLensPlan,
  method: "jspace_sparse_decomposition",
  access_basis: "local_fitted_white_box",
  lens_ref: null,
  configuration_ref: id("8"),
};

function baseline(
  measurementPlan: FunctionalAccessMeasurementPlan = plannedLensPlan,
  target: FunctionalAccessModelTarget = exactTarget,
) {
  return createFunctionalAccessBaseline({
    wake,
    anchor_event_ref: id("9"),
    request_ref: id("0"),
    target,
    measurement_plan: measurementPlan,
  });
}

function fact(
  surface: FunctionalAccessEvidenceFact["surface"],
  artifactRef: FunctionalAccessEvidenceFact["artifact_ref"],
): FunctionalAccessEvidenceFact {
  return {
    surface,
    artifact_ref: artifactRef,
    assertion: "caller_asserted",
    verified_by_package: false,
  };
}

const noFindings = {
  lens_visibility: "not_measured" as const,
  sparse_support: "not_measured" as const,
  behavioral_use: "not_measured" as const,
};

function subsequent(
  base = baseline(),
  operationOutcome: "not_attempted" | "failed" | "partial" | "completed" =
    "not_attempted",
  evidence: FunctionalAccessEvidenceFact[] = [],
  findings = noFindings,
  afterglowCapsuleRef: `sha256:${string}` | null = null,
) {
  return createFunctionalAccessSubsequent({
    baseline: base,
    operation_outcome: operationOutcome,
    evidence,
    findings,
    afterglow_capsule_ref: afterglowCapsuleRef,
  });
}

describe("functional-access baseline", () => {
  test("pins deterministic content-addressed vectors and fixed record roles", () => {
    const value = baseline();
    const again = baseline();
    expect(value).toEqual(again);
    expect(value.baseline_id).toBe(
      "sha256:1700ace293d82450be1386880347ec01698ff0f1623ef10b493b4d5a81dc9c0a",
    );
    expect(value.record_role).toBe("before_anchor");
    expect(value.boundaries.record_only).toBe(true);
    expect(value.boundaries.performs_observation).toBe(false);
    expect(value.boundaries.performs_model_call).toBe(false);
    expect(value.boundaries.performs_workspace_operation).toBe(false);
    expect(value.verified_by_package).toBe(false);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.measurement_plan)).toBe(true);
    expect(new TextDecoder().decode(encodeFunctionalAccessBaseline(value))).toBe(
      canonicalJson(value),
    );
    expect(validateFunctionalAccessBaseline(value)).toEqual(value);

    const changedConfiguration = baseline({
      ...plannedLensPlan,
      configuration_ref: sha256Id(
        JSON.stringify({
          target_token_ids: [17, 42],
          target_directions: ["sha256:bounded-direction"],
          layers: [12],
          positions: ["final"],
          rank: 8,
          score_threshold: 0.75,
          aggregation: "max",
        }),
      ),
    });
    expect(changedConfiguration.baseline_id).not.toBe(value.baseline_id);
  });

  test("enforces plan state, capability, permission, and access-basis coherence", () => {
    expect(baseline(notRequestedPlan, providerTarget).measurement_plan.state).toBe(
      "not_requested",
    );
    expect(baseline(unavailablePlan, providerTarget).measurement_plan.state).toBe(
      "unavailable",
    );
    expect(baseline().measurement_plan.state).toBe("planned");

    for (const invalid of [
      { ...notRequestedPlan, method: "jacobian_lens_visibility" as const },
      { ...unavailablePlan, unavailable_reason: null },
      { ...unavailablePlan, capability_ref: null },
      { ...unavailablePlan, permission_ref: null },
      { ...plannedLensPlan, capability_state: "unavailable_reported" as const },
      { ...plannedLensPlan, permission_state: "denied_reported" as const },
      { ...plannedLensPlan, instrument_ref: null },
      { ...plannedLensPlan, configuration_ref: null },
      { ...plannedLensPlan, lens_ref: null },
      {
        ...plannedLensPlan,
        access_basis: "local_fitted_white_box" as const,
      },
    ]) {
      expect(() => baseline(invalid as FunctionalAccessMeasurementPlan)).toThrow(
        AfterglowError,
      );
    }

    expect(() => baseline(plannedLensPlan, providerTarget)).toThrow(
      /exact checkpoint/i,
    );
    expect(
      baseline(
        {
          ...plannedLensPlan,
          access_basis: "provider_supplied_instrumented",
          lens_ref: null,
        },
        providerTarget,
      ).target.model_binding,
    ).toBe("provider_alias");
  });

  test("rejects tampered IDs, record roles, extra keys, and verified assertions", () => {
    const value = baseline();
    expect(() =>
      validateFunctionalAccessBaseline({ ...value, baseline_id: id("a") }),
    ).toThrow(/does not bind/i);
    expect(() =>
      validateFunctionalAccessBaseline({ ...value, record_role: "after_anchor" }),
    ).toThrow(AfterglowError);
    expect(() =>
      validateFunctionalAccessBaseline({ ...value, raw_prompt: "private" }),
    ).toThrow(AfterglowError);
    expect(() =>
      validateFunctionalAccessBaseline({ ...value, verified_by_package: true }),
    ).toThrow(AfterglowError);
  });
});

describe("functional-access subsequent record", () => {
  test("normalizes evidence, rejects duplicates, and pins next-encounter posture", () => {
    const value = subsequent(
      baseline(notRequestedPlan, providerTarget),
      "not_attempted",
      [
        fact("workspace_operation", id("e")),
        fact("provider_response_receipt", id("d")),
        fact("usage_receipt", id("c")),
      ],
      noFindings,
      id("b"),
    );
    expect(value.record_role).toBe("after_anchor");
    expect(value.evidence.map(({ surface }) => surface)).toEqual([
      "provider_response_receipt",
      "usage_receipt",
      "workspace_operation",
    ]);
    expect(value.next_encounter_posture).toBe(
      "fresh_encounter_with_caller_carried_context",
    );
    expect(value.subsequent_id).toBe(
      "sha256:14c84d5b7223cb5a9a82e4c88e0ddda830c940dc874d86829acda36d276336fe",
    );
    expect(new TextDecoder().decode(encodeFunctionalAccessSubsequent(value))).toBe(
      canonicalJson(value),
    );
    expect(validateFunctionalAccessSubsequent(value)).toEqual(value);

    expect(() =>
      subsequent(undefined, "not_attempted", [
        fact("request_context", id("1")),
        fact("request_context", id("1")),
      ]),
    ).toThrow(/duplicate/i);
    expect(() =>
      validateFunctionalAccessSubsequent({
        ...value,
        evidence: [...value.evidence].reverse(),
      }),
    ).toThrow(/sorted/i);
    expect(() =>
      validateFunctionalAccessSubsequent({
        ...value,
        next_encounter_posture: "fresh_encounter",
      }),
    ).toThrow(/does not match/i);
  });

  test("keeps workspace/provider receipts independent from instrument coherence", () => {
    const nonPlanned = baseline(unavailablePlan, providerTarget);
    expect(
      subsequent(nonPlanned, "not_attempted", [
        fact("workspace_operation", id("1")),
        fact("provider_response_receipt", id("2")),
        fact("usage_receipt", id("3")),
      ]).operation_outcome,
    ).toBe("not_attempted");
    expect(() =>
      subsequent(nonPlanned, "failed", [
        fact("instrument_operation_receipt", id("4")),
      ]),
    ).toThrow(/non-planned/i);
    expect(() =>
      subsequent(nonPlanned, "not_attempted", [
        fact("jacobian_lens_readout", id("5")),
      ]),
    ).toThrow(/non-planned/i);

    expect(
      subsequent(baseline(), "failed", [
        fact("instrument_operation_receipt", id("6")),
        fact("workspace_operation", id("7")),
      ]).operation_outcome,
    ).toBe("failed");
    expect(() => subsequent(baseline(), "failed", [])).toThrow(
      /instrument operation receipt/i,
    );
    expect(() =>
      subsequent(baseline(), "not_attempted", [
        fact("instrument_operation_receipt", id("8")),
      ]),
    ).toThrow(/cannot carry/i);
  });

  test("accepts the partial/completed result matrix for both methods", () => {
    const methods = [
      {
        base: baseline(plannedLensPlan),
        surface: "jacobian_lens_readout" as const,
        findings: (state: "no_hit_under_config" | "hit_observed" | "inconclusive") => ({
          ...noFindings,
          lens_visibility: state,
        }),
      },
      {
        base: baseline(plannedSparsePlan),
        surface: "jspace_sparse_decomposition_result" as const,
        findings: (state: "no_hit_under_config" | "hit_observed" | "inconclusive") => ({
          ...noFindings,
          sparse_support: state,
        }),
      },
    ];

    for (const method of methods) {
      const receipt = fact("instrument_operation_receipt", id("a"));
      expect(subsequent(method.base, "partial", [receipt])).toBeTruthy();
      for (const state of [
        "no_hit_under_config",
        "hit_observed",
        "inconclusive",
      ] as const) {
        const evidence = [receipt, fact(method.surface, id("b"))];
        expect(
          subsequent(method.base, "partial", evidence, method.findings(state))
            .findings,
        ).toEqual(method.findings(state));
        expect(
          subsequent(method.base, "completed", evidence, method.findings(state))
            .operation_outcome,
        ).toBe("completed");
      }
      expect(() => subsequent(method.base, "completed", [receipt])).toThrow(
        /requires/i,
      );
    }
  });

  test("keeps method-specific findings paired and behavioral use unmeasured", () => {
    const receipt = fact("instrument_operation_receipt", id("1"));
    expect(() =>
      subsequent(
        baseline(plannedLensPlan),
        "partial",
        [receipt, fact("jspace_sparse_decomposition_result", id("2"))],
        { ...noFindings, sparse_support: "hit_observed" },
      ),
    ).toThrow(/jacobian_lens_visibility/i);
    expect(() =>
      subsequent(
        baseline(plannedSparsePlan),
        "partial",
        [receipt, fact("jacobian_lens_readout", id("3"))],
        { ...noFindings, lens_visibility: "hit_observed" },
      ),
    ).toThrow(/jspace_sparse_decomposition/i);
    expect(() =>
      subsequent(
        baseline(),
        "partial",
        [receipt],
        { ...noFindings, behavioral_use: "hit_observed" } as never,
      ),
    ).toThrow(AfterglowError);
    expect(() =>
      subsequent(baseline(), "partial", [
        receipt,
        {
          ...fact("request_context", id("4")),
          surface: ["local", "sensitivity", "measurement"].join("_"),
        } as never,
      ]),
    ).toThrow(AfterglowError);
  });

  test("rejects tampered role, body address, and assertion flags", () => {
    const value = subsequent();
    expect(value.next_encounter_posture).toBe("fresh_encounter");
    expect(() =>
      validateFunctionalAccessSubsequent({ ...value, record_role: "before_anchor" }),
    ).toThrow(AfterglowError);
    expect(() =>
      validateFunctionalAccessSubsequent({ ...value, subsequent_id: id("1") }),
    ).toThrow(/does not bind/i);
    expect(() =>
      validateFunctionalAccessSubsequent({ ...value, verified_by_package: true }),
    ).toThrow(AfterglowError);
  });
});

describe("functional-access hostile input boundary", () => {
  test("rejects Proxies, accessors, and custom prototypes without entering them", () => {
    let traps = 0;
    const trap = () => {
      traps += 1;
      throw new Error("caller code executed");
    };
    const hostile = new Proxy(
      {},
      {
        get: trap,
        getOwnPropertyDescriptor: trap,
        getPrototypeOf: trap,
        ownKeys: trap,
      },
    );
    expect(() => createFunctionalAccessBaseline(hostile as never)).toThrow(
      AfterglowError,
    );
    expect(traps).toBe(0);

    const accessor = { ...exactTarget } as Record<string, unknown>;
    Object.defineProperty(accessor, "model_ref", { get: trap, enumerable: true });
    expect(() =>
      baseline(plannedLensPlan, accessor as unknown as FunctionalAccessModelTarget),
    ).toThrow(AfterglowError);
    expect(traps).toBe(0);

    const custom = { ...exactTarget };
    Object.setPrototypeOf(custom, { caller_capability: true });
    expect(() =>
      baseline(plannedLensPlan, custom as FunctionalAccessModelTarget),
    ).toThrow(AfterglowError);
    expect(traps).toBe(0);
  });
});
