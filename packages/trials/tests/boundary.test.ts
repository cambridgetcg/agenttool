import { describe, expect, test } from "bun:test";

import crossBoundaryFixture from "../fixtures/mcphunt/synthetic-cross-boundary.json";
import noCorrelationFixture from "../fixtures/mcphunt/synthetic-no-correlation.json";
import {
  BOUNDARY_ANALYSIS_LIMITS,
  BOUNDARY_ANALYSIS_STATEMENT,
  BoundaryAnalysisError,
  analyzeBoundaryFlow,
  type BoundaryAnalysisInput,
  type BoundaryLabelDeclaration,
  type BoundaryTrialStep,
} from "../src/boundary.js";

function fixture(value: unknown): BoundaryAnalysisInput {
  return value as BoundaryAnalysisInput;
}

describe("MCPHunt-style boundary-flow analysis", () => {
  test("correlates opaque labels across ordered source, transit, and sink observations", () => {
    const result = analyzeBoundaryFlow(fixture(crossBoundaryFixture));

    expect(result.result).toBe("correlated_flow_observed");
    expect(result.analysis_id).toBe(
      "sha256:35919e6bffd1baccbcfdfffc78d1814bcb5e64a6497260277d15b36f76c34ced",
    );
    expect(result.summary).toEqual({
      label_count: 3,
      step_count: 6,
      source_observation_count: 3,
      transit_observation_count: 1,
      sink_observation_count: 4,
      correlated_flow_count: 4,
      reported_task_mandated_count: 1,
      reported_policy_concern_count: 2,
      reported_review_required_count: 1,
      sink_without_prior_source_count: 0,
      source_without_later_sink_count: 0,
      evidence_truncated: false,
      diagnostics_truncated: false,
    });
    expect(
      result.evidence.map((item) => [
        item.label_id,
        item.sink.sequence,
        item.assessment,
      ]),
    ).toEqual([
      ["label:completion-context", 3, "reported_task_mandated"],
      ["label:policy-canary", 3, "reported_policy_concern"],
      ["label:policy-canary", 6, "reported_policy_concern"],
      ["label:review-canary", 5, "reported_review_required"],
    ]);
    expect(result.evidence[1]?.transit).toEqual({
      observed_step_ids: ["step:002"],
      total_observations: 1,
      truncated: false,
    });
    expect(result.evidence[0]?.evidence_id).toBe(
      "sha256:1e9da1d8a57f0d315844fa3fe1bc63925cf82bcfc2e81abda8656576693edcb6",
    );
    expect(result.evidence[2]?.transit).toEqual({
      observed_step_ids: ["step:002"],
      total_observations: 1,
      truncated: false,
    });
    expect(result.evidence.every((item) =>
      item.evidence_id.startsWith("sha256:"))).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.evidence)).toBe(true);
  });

  test("normalizes label ordering into deterministic analysis and evidence IDs", () => {
    const original = fixture(crossBoundaryFixture);
    const reordered: BoundaryAnalysisInput = {
      ...original,
      labels: [...original.labels].reverse(),
      steps: original.steps.map((step) => ({
        ...step,
        observed_label_ids: [...step.observed_label_ids].reverse(),
      })) as BoundaryTrialStep[],
    };

    const left = analyzeBoundaryFlow(original);
    const right = analyzeBoundaryFlow(reordered);

    expect(right.analysis_id).toBe(left.analysis_id);
    expect(right.evidence).toEqual(left.evidence);
  });

  test("keeps a sink-before-source observation unmatched without inferring safety", () => {
    const result = analyzeBoundaryFlow(fixture(noCorrelationFixture));

    expect(result.result).toBe("no_correlated_flow_observed");
    expect(result.evidence).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        code: "sink_without_prior_source",
        label_id: "label:early-sink",
        step_id: "step:001",
        sequence: 1,
      },
      {
        code: "source_without_later_sink",
        label_id: "label:early-sink",
        step_id: "step:002",
        sequence: 2,
      },
      {
        code: "source_without_later_sink",
        label_id: "label:source-only",
        step_id: "step:003",
        sequence: 3,
      },
    ]);
    expect(result.statement).toBe(BOUNDARY_ANALYSIS_STATEMENT);
    expect(result.statement).toContain(
      "no observed match does not establish safety or security",
    );
    expect(result.statement).toContain(
      "not verified policy or task authority",
    );
  });

  test("rejects extra raw-value fields without reflecting their contents", () => {
    const rawMarker = ["never", "reflect", "this"].join("_");
    const input = structuredClone(crossBoundaryFixture) as Record<
      string,
      unknown
    >;
    (input.labels as Array<Record<string, unknown>>)[0]!.raw_value =
      rawMarker;

    let caught: unknown;
    try {
      analyzeBoundaryFlow(input as unknown as BoundaryAnalysisInput);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BoundaryAnalysisError);
    expect(String(caught)).not.toContain(rawMarker);
    expect((caught as BoundaryAnalysisError).code).toBe("invalid_shape");
  });

  test("requires explicit observed propagation and monotonic unique sequences", () => {
    const missingPropagation = structuredClone(
      crossBoundaryFixture,
    ) as Record<string, unknown>;
    delete (
      (missingPropagation.steps as Array<Record<string, unknown>>)[2]!
    ).propagation;
    expect(() =>
      analyzeBoundaryFlow(
        missingPropagation as unknown as BoundaryAnalysisInput,
      )).toThrow(BoundaryAnalysisError);

    const repeatedSequence = structuredClone(
      crossBoundaryFixture,
    ) as Record<string, unknown>;
    (
      (repeatedSequence.steps as Array<Record<string, unknown>>)[1]!
    ).sequence = 1;
    expect(() =>
      analyzeBoundaryFlow(
        repeatedSequence as unknown as BoundaryAnalysisInput,
      )).toThrow(
      expect.objectContaining({
        code: "non_monotonic_sequence",
      }),
    );
  });

  test("rejects undeclared labels, duplicate sources, and non-label identifiers", () => {
    const undeclared = structuredClone(
      crossBoundaryFixture,
    ) as Record<string, unknown>;
    (
      (undeclared.steps as Array<Record<string, unknown>>)[0]!
        .observed_label_ids as string[]
    )[0] = "label:not-declared";
    expect(() =>
      analyzeBoundaryFlow(
        undeclared as unknown as BoundaryAnalysisInput,
      )).toThrow(
      expect.objectContaining({ code: "undeclared_label" }),
    );

    const duplicateSource = structuredClone(
      crossBoundaryFixture,
    ) as Record<string, unknown>;
    (
      (duplicateSource.steps as Array<Record<string, unknown>>)[3]!
        .observed_label_ids as string[]
    )[0] = "label:policy-canary";
    expect(() =>
      analyzeBoundaryFlow(
        duplicateSource as unknown as BoundaryAnalysisInput,
      )).toThrow(
      expect.objectContaining({ code: "duplicate_source" }),
    );

    const declarations = structuredClone(
      crossBoundaryFixture.labels,
    ) as Array<Record<string, unknown>>;
    declarations[0]!.label_id = "opaque-but-not-a-label";
    expect(() =>
      analyzeBoundaryFlow({
        ...fixture(crossBoundaryFixture),
        labels:
          declarations as unknown as BoundaryLabelDeclaration[],
      })).toThrow(
      expect.objectContaining({ code: "invalid_id" }),
    );
  });

  test("bounds emitted evidence while retaining full correlation counts", () => {
    const labels: BoundaryLabelDeclaration[] = Array.from(
      { length: 16 },
      (_, index) => ({
        label_id: `label:bounded-${index.toString().padStart(2, "0")}`,
        completion_requirement: "not_required",
      }),
    );
    const ids = labels.map((label) => label.label_id);
    const steps: BoundaryTrialStep[] = [
      {
        kind: "source",
        step_id: "step:source",
        sequence: 1,
        source_class: "synthetic_fixture",
        observed_label_ids: ids,
      },
      ...Array.from({ length: 9 }, (_, index): BoundaryTrialStep => ({
        kind: "sink",
        step_id: `step:sink-${index.toString().padStart(2, "0")}`,
        sequence: index + 2,
        sink_class: "artifact",
        propagation: "observed",
        observed_label_ids: ids,
      })),
    ];

    const result = analyzeBoundaryFlow({
      trial_id: "trial:bounded-evidence",
      labels,
      steps,
    });

    expect(result.summary.correlated_flow_count).toBe(144);
    expect(result.summary.evidence_truncated).toBe(true);
    expect(result.evidence).toHaveLength(
      BOUNDARY_ANALYSIS_LIMITS.evidence,
    );
    expect(result.evidence.map((item) => item.evidence_id)).toEqual(
      [...result.evidence]
        .sort((left, right) =>
          left.label_id.localeCompare(right.label_id)
          || left.sink.sequence - right.sink.sequence)
        .map((item) => item.evidence_id),
    );
  });
});
