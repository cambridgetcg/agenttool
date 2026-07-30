import { describe, expect, test } from "bun:test";

import crossBoundaryFixture from "../fixtures/mcphunt/synthetic-cross-boundary.json";
import {
  analyzeBoundaryFlow,
  canonicalJson,
  createTrialReceipt,
  projectReportsToSts,
  sha256Id,
  type BoundaryAnalysisInput,
} from "../src/index.js";

describe("local AgentTool Dojo playthrough", () => {
  test("carries bounded boundary evidence into a receipt and minimized STS trace", () => {
    const boundary = analyzeBoundaryFlow(
      crossBoundaryFixture as BoundaryAnalysisInput,
    );
    const boundaryEvidence = boundary.evidence
      .map((item) => item.evidence_id)
      .sort();
    const receipt = createTrialReceipt({
      trial_id: "trial.synthetic.boundary.v1",
      attempt_id: "attempt.synthetic.0001",
      observed_at: "2026-07-30T15:00:00.000Z",
      environment: {
        kind: "synthetic",
        id: "mcphunt_fixture",
        revision: "v1",
        source_digest: sha256Id(canonicalJson(crossBoundaryFixture)),
      },
      subject: {
        kind: "workflow",
        id: "agenttool.boundary_flow",
        revision: "git-536079d1",
      },
      objective_digest: sha256Id(
        "Correlate caller-declared opaque labels across observed boundaries",
      ),
      authority: {
        authority_ref: "authority.local.observation-only",
        allowed_effects: ["observation_read"],
      },
      status: {
        dispatch: "started",
        outcome: "succeeded",
        error_code: null,
      },
      possible_effects: ["input_disclosed", "observation_read"],
      evaluation: {
        verdict: "pass",
        reward_micros: 1_000_000,
        reward_unit: "unitless_millionths",
        rubric_digest: sha256Id("boundary correlation rubric v1"),
        checks: [{
          check_id: "boundary.correlations_observed",
          outcome: "pass",
          evidence_refs: [boundary.analysis_id],
        }],
      },
      evidence_refs: boundaryEvidence,
      parent_receipt_id: null,
    });
    const projected = projectReportsToSts({
      session_id: "selection.synthetic.dojo.001",
      reports: [{
        report_id: "report.synthetic.boundary",
        outcome:
          "Observed four opaque source-to-sink correlations; the trial receipt exceeded caller-reported authority bounds.",
        evidence_refs: [receipt.receipt_id],
        confidence: "high",
        limits:
          "Synthetic local evidence only; correlation does not prove disclosure or remote effect.",
      }],
    });

    expect(boundary.summary.correlated_flow_count).toBe(4);
    expect(receipt.authority_assessment).toBe(
      "exceeded_reported_bounds",
    );
    expect(receipt.retry_advice).toBe("do_not_automatically_retry");
    expect(projected.receipt.input_report_count).toBe(1);
    expect(projected.receipt.emitted_report_count).toBe(1);
    expect(projected.receipt.omitted_report_count).toBe(0);
    expect(projected.jsonl.trimEnd().split("\n")).toHaveLength(2);
    expect(projected.jsonl).not.toContain("label:policy-canary");
    expect(projected.jsonl).not.toContain("input_disclosed");

    const repeated = projectReportsToSts({
      session_id: "selection.synthetic.dojo.001",
      reports: [{
        report_id: "report.synthetic.boundary",
        outcome:
          "Observed four opaque source-to-sink correlations; the trial receipt exceeded caller-reported authority bounds.",
        evidence_refs: [receipt.receipt_id],
        confidence: "high",
        limits:
          "Synthetic local evidence only; correlation does not prove disclosure or remote effect.",
      }],
    });
    expect(repeated).toEqual(projected);
  });
});
