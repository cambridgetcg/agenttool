import { describe, expect, test } from "bun:test";

import {
  RESEARCH_FORMATS,
  SIX_LEDGER_PROFILE,
  SIX_LEDGER_PROFILE_DIGEST,
  ZERO_EFFECTS,
  ZERO_EFFECT_COUNT,
  ZERONE_TREE_RAW_SHA256,
  MATH_PROOFCRAFT_NODE_SHA256,
  canonicalJson,
  createChallenge,
  createMilestone,
  createNodeRef,
  createPublicProjection,
  sha256Id,
  simulateResearchCommons,
  validateArtifactRevision,
  validateChallenge,
  validateEffectiveController,
  validateEvidenceReceipt,
  validateFundingCommitment,
  validateMilestone,
  validateNodeRef,
  validatePublicProjection,
  validateResearchCase,
  validateResearchSimulation,
  validateReview,
  validateSettlementBundle,
  validateWorkPackage,
} from "../src/index.js";
import { makeGardenSimulation } from "./fixtures.js";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function withoutId<T extends Record<string, unknown>>(value: T, key: string): Record<string, unknown> {
  const body = clone(value);
  delete body[key];
  return body;
}

describe("closed records and public seams", () => {
  test("accepts every frozen Garden record and pins the static capability anchor", () => {
    const simulation = validateResearchSimulation(makeGardenSimulation());
    expect(simulation.cases[0]!.node_ref.tree_raw_sha256).toBe(ZERONE_TREE_RAW_SHA256);
    expect(simulation.cases[0]!.node_ref.node_digest).toBe(MATH_PROOFCRAFT_NODE_SHA256);
    expect(simulation.cases[0]!.node_ref.live_fact).toBeFalse();
    expect(simulation.cases[0]!.node_ref.reward_bearing).toBeFalse();
    expect(simulation.cases[0]!.node_ref.network_observed).toBeFalse();
    expect(simulation.cases[0]!.safety.verification_posture)
      .toBe("CALLER_DECLARED_UNVERIFIED_NO_SAFETY_REVIEW");
    expect(simulation.artifact_revisions[0]!.access_verification_posture)
      .toBe("CALLER_DECLARED_UNVERIFIED_NO_AVAILABILITY_OR_LICENSE_CHECK");
    expect(simulation.evidence_receipts.find((receipt) => receipt.level === "E0")!.payload.kind)
      .toBe("E0_CALLER_DECLARED_PREREGISTRATION_REFERENCE");
  });

  test("exposes exactly 29 false effects and the exact six-ledger digest", () => {
    expect(Object.keys(ZERO_EFFECTS)).toHaveLength(ZERO_EFFECT_COUNT);
    expect(Object.values(ZERO_EFFECTS).every((value) => value === false)).toBeTrue();
    expect(sha256Id(canonicalJson(SIX_LEDGER_PROFILE))).toBe(SIX_LEDGER_PROFILE_DIGEST);
    expect(SIX_LEDGER_PROFILE.shared_unit).toBeFalse();
    expect(SIX_LEDGER_PROFILE.cross_ledger_arithmetic).toBeFalse();
    expect(SIX_LEDGER_PROFILE.cross_ledger_inference).toBeFalse();
    expect(SIX_LEDGER_PROFILE.cross_ledger_conversion).toBeFalse();
    expect(SIX_LEDGER_PROFILE.ledgers.map((entry) => entry.kind)).toEqual([
      "ATTRIBUTION_CREDIT",
      "FUNDING_LIABILITY",
      "GOVERNANCE_AUTHORITY",
      "NOVELTY_PRIORITY",
      "SIGNIFICANCE_CONSEQUENCE",
      "VALIDITY",
    ]);
  });

  test("rejects unknown or missing fields across every identified record category", () => {
    const simulation = makeGardenSimulation();
    const cases: Array<[Record<string, unknown>, (input: unknown) => unknown, string]> = [
      [simulation.cases[0]! as unknown as Record<string, unknown>, validateResearchCase, "case_id"],
      [simulation.controllers[0]! as unknown as Record<string, unknown>, validateEffectiveController, "controller_id"],
      [simulation.funding_commitments[0]! as unknown as Record<string, unknown>, validateFundingCommitment, "commitment_id"],
      [simulation.work_packages[0]! as unknown as Record<string, unknown>, validateWorkPackage, "work_package_id"],
      [simulation.artifact_revisions[0]! as unknown as Record<string, unknown>, validateArtifactRevision, "artifact_revision_id"],
      [simulation.evidence_receipts[0]! as unknown as Record<string, unknown>, validateEvidenceReceipt, "evidence_receipt_id"],
      [simulation.reviews[0]! as unknown as Record<string, unknown>, validateReview, "review_id"],
      [simulation.milestones[0]! as unknown as Record<string, unknown>, validateMilestone, "milestone_id"],
      [simulation.cases[0]!.node_ref as unknown as Record<string, unknown>, validateNodeRef, "node_ref_id"],
    ];
    for (const [record, validator, idKey] of cases) {
      const extra = clone(record);
      extra.unreviewed = false;
      expect(() => validator(extra)).toThrow(/exactly/);
      const missing = clone(record);
      delete missing[idKey];
      expect(() => validator(missing)).toThrow(/exactly/);
      const tampered = clone(record);
      tampered[idKey] = sha256Id(`tampered:${idKey}`);
      expect(() => validator(tampered)).toThrow(/bind/);
    }
  });

  test("requires every explicit false field on settlement and projection inputs", () => {
    const report = simulateResearchCommons(makeGardenSimulation());
    const settlement = clone(report.settlement_bundles[0]!);
    delete (settlement.settlement.effects as unknown as Record<string, boolean>).wallet;
    expect(() => validateSettlementBundle(settlement)).toThrow(/exactly/);

    const projection = clone(report.public_projections[0]!);
    delete (projection.projection.boundaries as unknown as Record<string, boolean>).authoritative;
    expect(() => validatePublicProjection(projection)).toThrow(/exactly/);
    const emptyEffects = clone(report.public_projections[0]!);
    (emptyEffects.projection as unknown as Record<string, unknown>).effects = {};
    expect(() => validatePublicProjection(emptyEffects)).toThrow(/exactly/);
  });

  test("public projection is single-settlement, nonempty, digest-only and E2-capped", () => {
    const report = simulateResearchCommons(makeGardenSimulation());
    const projection = report.public_projections[0]!;
    expect(projection.projection.settlement_bundle_ids).toHaveLength(1);
    expect(projection.projection.public_evidence_receipt_ids).toEqual(
      report.settlement_bundles[0]!.settlement.consumed_receipt_ids,
    );
    const e3 = clone(projection);
    (e3.projection as unknown as Record<string, unknown>).highest_evidence_level = "E3";
    expect(() => validatePublicProjection(e3)).toThrow(/E2 ceiling|bind/);

    expect(() => createNodeRef({
      ...withoutId(projection.projection.node_ref, "node_ref_id"),
      node_id: "/private/research/raw.txt",
    } as never)).toThrow(/closed protocol value/);
    expect(projection.projection.node_ref.node_id).toBe("math-proofcraft@1");
    expect(projection.projection.node_ref.tree_schema).toBe(
      "zerone.constructive-intelligence-tree/v1",
    );
  });

  test("milestone shapes separate delivered work from approval and blocking gates", () => {
    const simulation = makeGardenSimulation();
    const research = simulation.milestones.find((entry) => entry.milestone_kind === "RESEARCH_DELIVERY")!;
    const review = simulation.milestones.find((entry) => entry.milestone_kind === "REVIEW_DELIVERY")!;
    expect(() => createMilestone({
      ...withoutId(research as unknown as Record<string, unknown>, "milestone_id"),
      delivery_approval_review_ids: [],
    } as never)).toThrow(/approval/);
    expect(() => createMilestone({
      ...withoutId(review as unknown as Record<string, unknown>, "milestone_id"),
      required_review_ids: [],
    } as never)).toThrow(/review delivery/);
    const challengeId = sha256Id("challenge");
    expect(() => createMilestone({
      ...withoutId(review as unknown as Record<string, unknown>, "milestone_id"),
      challenge_head_snapshot_ids: [challengeId],
      milestone_kind: "CHALLENGE_DELIVERY",
      required_challenge_ids: [challengeId],
      required_review_ids: [],
    } as never)).toThrow(/own challenge-head gate/);
  });

  test("challenge hold dispositions are explicitly unverified and non-authoritative", () => {
    const simulation = makeGardenSimulation();
    const target = simulation.evidence_receipts[0]!;
    const work = simulation.work_packages[0]!;
    const body = {
      _format: RESEARCH_FORMATS.challenge,
      automatic_slash: false,
      case_id: target.case_id,
      challenge_kind: "FALSIFIER",
      challenge_ref: sha256Id("challenge:public"),
      challenger_controller_id: work.lead_controller_id,
      created_at: "2026-08-16T09:00:00.000Z",
      evidence_refs: [sha256Id("challenge:evidence")],
      good_faith_no_penalty: true,
      prior_challenge_id: sha256Id("challenge:prior"),
      resolution_effect: "SHADOW_DELIVERY_HOLD_ONLY",
      resolution_posture: "CALLER_DECLARED_UNVERIFIED_NO_AUTHORITY",
      resolution_review_id: simulation.reviews[0]!.review_id,
      revision_number: 2,
      scientific_adjudication: false,
      status: "CALLER_DECLARED_HOLD_CONTINUES",
      target_receipt_id: target.evidence_receipt_id,
      work_package_id: work.work_package_id,
    } as const;
    expect(validateChallenge(createChallenge(body)).status).toBe("CALLER_DECLARED_HOLD_CONTINUES");
    expect(() => createChallenge({ ...body, status: "UPHELD" } as never)).toThrow();
    expect(() => createChallenge({ ...body, resolution_posture: "ADJUDICATED" } as never)).toThrow();
  });
});
