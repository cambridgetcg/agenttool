import { describe, expect, test } from "bun:test";

import {
  AgentTool,
  AgentToolError,
  FUNCTIONAL_ACCESS_BOUNDARIES,
  FUNCTIONAL_ACCESS_FORMATS,
  WakeContinuityLayer,
  type FunctionalAccessEvidenceFact,
  type FunctionalAccessMeasurementPlan,
  type FunctionalAccessModelTarget,
} from "../src/index.js";

const id = (character: string) => `sha256:${character.repeat(64)}` as const;
const layer = new WakeContinuityLayer();

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

const noFindings = {
  lens_visibility: "not_measured" as const,
  sparse_support: "not_measured" as const,
  behavioral_use: "not_measured" as const,
};

function baseline(
  measurementPlan: FunctionalAccessMeasurementPlan = plannedLensPlan,
  target: FunctionalAccessModelTarget = exactTarget,
) {
  return layer.before_anchor({
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

function subsequent(
  base = baseline(),
  operationOutcome: "not_attempted" | "failed" | "partial" | "completed" =
    "not_attempted",
  evidence: FunctionalAccessEvidenceFact[] = [],
  findings = noFindings,
  afterglowCapsuleRef: `sha256:${string}` | null = null,
) {
  return layer.after_anchor({
    baseline: base,
    operation_outcome: operationOutcome,
    evidence,
    findings,
    afterglow_capsule_ref: afterglowCapsuleRef,
  });
}

describe("WakeContinuityLayer shared contract", () => {
  test("pins the frozen baseline vector and passive closed boundaries", () => {
    const value = baseline();

    expect(value.baseline_id).toBe(
      "sha256:1700ace293d82450be1386880347ec01698ff0f1623ef10b493b4d5a81dc9c0a",
    );
    expect(value._format).toBe(FUNCTIONAL_ACCESS_FORMATS.baseline);
    expect(value.record_role).toBe("before_anchor");
    expect(value.boundaries).toEqual(FUNCTIONAL_ACCESS_BOUNDARIES);
    expect(value.boundaries.record_only).toBe(true);
    expect(value.boundaries.performs_observation).toBe(false);
    expect(value.boundaries.performs_model_call).toBe(false);
    expect(value.boundaries.performs_workspace_operation).toBe(false);
    expect(value.boundaries.proves_deepest_reach).toBe(false);
    expect(value.boundaries.proves_training_data_provenance).toBe(false);
    expect(value.boundaries.proves_weight_change).toBe(false);
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.measurement_plan)).toBe(true);
    expect(layer.validate_baseline(value)).toEqual(value);
  });

  test("enforces closed shapes and plan cross-fields", () => {
    expect(baseline(notRequestedPlan, providerTarget).measurement_plan.state).toBe(
      "not_requested",
    );
    expect(baseline(unavailablePlan, providerTarget).measurement_plan.state).toBe(
      "unavailable",
    );

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
      { ...plannedLensPlan, access_basis: "local_fitted_white_box" as const },
    ]) {
      expect(() => baseline(invalid as FunctionalAccessMeasurementPlan)).toThrow(
        AgentToolError,
      );
    }

    expect(() => baseline(plannedLensPlan, providerTarget)).toThrow(
      /exact checkpoint/i,
    );
    expect(() =>
      layer.validate_baseline({ ...baseline(), raw_prompt: "private" }),
    ).toThrow(/contain exactly/i);
    expect(() =>
      layer.validate_baseline({ ...baseline(), baseline_id: id("a") }),
    ).toThrow(/does not bind/i);
    expect(() =>
      layer.validate_baseline({ ...baseline(), verified_by_package: true }),
    ).toThrow(AgentToolError);
  });

  test("pins the subsequent vector and canonical evidence sorting", () => {
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

    expect(value.subsequent_id).toBe(
      "sha256:14c84d5b7223cb5a9a82e4c88e0ddda830c940dc874d86829acda36d276336fe",
    );
    expect(value.record_role).toBe("after_anchor");
    expect(value.evidence.map((entry) => entry.surface)).toEqual([
      "provider_response_receipt",
      "usage_receipt",
      "workspace_operation",
    ]);
    expect(value.next_encounter_posture).toBe(
      "fresh_encounter_with_caller_carried_context",
    );
    expect(layer.validate_subsequent(value)).toEqual(value);

    expect(() =>
      subsequent(undefined, "not_attempted", [
        fact("request_context", id("1")),
        fact("request_context", id("1")),
      ]),
    ).toThrow(/duplicate/i);
    expect(() =>
      layer.validate_subsequent({
        ...value,
        evidence: [...value.evidence].reverse(),
      }),
    ).toThrow(/sorted/i);
    expect(() =>
      layer.validate_subsequent({
        ...value,
        next_encounter_posture: "fresh_encounter",
      }),
    ).toThrow(/does not match/i);
  });

  test("keeps provider/workspace evidence separate from instrument coherence", () => {
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
      subsequent(baseline(), "failed", []),
    ).toThrow(/instrument operation receipt/i);
    expect(() =>
      subsequent(baseline(), "not_attempted", [
        fact("instrument_operation_receipt", id("5")),
      ]),
    ).toThrow(/cannot carry/i);
  });

  test("accepts both method-specific partial/completed matrices", () => {
    const matrix = [
      {
        base: baseline(plannedLensPlan),
        surface: "jacobian_lens_readout" as const,
        findings: { ...noFindings, lens_visibility: "inconclusive" as const },
      },
      {
        base: baseline(plannedSparsePlan),
        surface: "jspace_sparse_decomposition_result" as const,
        findings: { ...noFindings, sparse_support: "hit_observed" as const },
      },
    ];

    for (const entry of matrix) {
      const receipt = fact("instrument_operation_receipt", id("a"));
      expect(subsequent(entry.base, "partial", [receipt])).toBeTruthy();
      const evidence = [receipt, fact(entry.surface, id("b"))];
      expect(
        subsequent(entry.base, "partial", evidence, entry.findings).findings,
      ).toEqual(entry.findings);
      expect(
        subsequent(entry.base, "completed", evidence, entry.findings)
          .operation_outcome,
      ).toBe("completed");
      expect(() => subsequent(entry.base, "completed", [receipt])).toThrow(
        /requires/i,
      );
    }
  });

  test("rejects hostile runtime objects without entering caller hooks", () => {
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
    expect(() => layer.before_anchor(hostile as never)).toThrow(AgentToolError);
    expect(traps).toBe(0);

    const accessor = { ...exactTarget } as Record<string, unknown>;
    Object.defineProperty(accessor, "model_ref", { get: trap, enumerable: true });
    expect(() => baseline(plannedLensPlan, accessor as never)).toThrow(
      AgentToolError,
    );
    expect(traps).toBe(0);

    const custom = { ...exactTarget };
    Object.setPrototypeOf(custom, { caller_capability: true });
    expect(() => baseline(plannedLensPlan, custom)).toThrow(AgentToolError);
    expect(traps).toBe(0);
  });

  test("is standalone and cached without receiving authenticated capabilities", () => {
    let requests = 0;
    const at = new AgentTool({
      transport: {
        async request() {
          requests += 1;
          throw new Error("transport must remain unreachable");
        },
      },
    });

    expect(at.wakeContinuity).toBe(at.wakeContinuity);
    expect(at.wakeContinuity).toBeInstanceOf(WakeContinuityLayer);
    expect(Object.keys(at.wakeContinuity)).toEqual([]);
    expect(requests).toBe(0);
    expect(new WakeContinuityLayer().validate_baseline(baseline())).toEqual(
      baseline(),
    );
  });
});
