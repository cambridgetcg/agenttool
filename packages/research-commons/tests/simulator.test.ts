import { describe, expect, test } from "bun:test";

import {
  DECLARED_RESULT_KINDS,
  PARTICIPATION_RIGHTS,
  RESEARCH_FORMATS,
  RESULT_AUTHORITY,
  SIMULATED_CREDIT_UNIT,
  SIMULATED_PAYMENT_CONDITION,
  ZERO_EFFECTS,
  createChallenge,
  createCompensationSchedule,
  createFundingCommitment,
  createMilestone,
  createWorkPackage,
  domainSeparatedId,
  scheduledCreditForMilestone,
  simulateResearchCommons,
} from "../src/index.js";
import type { Challenge, Milestone, ResearchSimulation, SimulationState } from "../src/index.js";
import {
  makeChallengeGardenSimulation,
  makeGardenSimulation,
} from "./fixtures.js";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function milestoneBody(milestone: Milestone): Omit<Milestone, "milestone_id"> {
  const body = clone(milestone) as Milestone & { milestone_id?: string };
  delete body.milestone_id;
  return body;
}

function challengeBody(challenge: Challenge): Omit<Challenge, "challenge_id"> {
  const body = clone(challenge) as Challenge & { challenge_id?: string };
  delete body.challenge_id;
  return body;
}

function withRestedResearch(
  status: "EXITED" | "NOT_DELIVERED" | "REFUSED" | "RESTED",
): ResearchSimulation {
  const simulation = makeGardenSimulation();
  const research = simulation.milestones.find((entry) => entry.milestone_kind === "RESEARCH_DELIVERY")!;
  const rested = createMilestone({
    ...milestoneBody(research),
    challenge_head_snapshot_ids: [],
    delivery_approval_review_ids: [],
    delivery_status: status,
    required_challenge_ids: [],
    required_receipt_ids: [],
    required_review_ids: [],
  });
  return {
    ...simulation,
    milestones: simulation.milestones
      .filter((entry) => entry.milestone_id !== research.milestone_id)
      .concat(rested)
      .sort((left, right) => left.milestone_id.localeCompare(right.milestone_id, "en")),
    settlement_requests: simulation.settlement_requests.filter(
      (request) => request.milestone_id !== research.milestone_id,
    ),
  };
}

describe("research commons simulator", () => {
  test("conserves prefunded simulated credit and emits one minimized projection per settlement", () => {
    const report = simulateResearchCommons(makeGardenSimulation());
    expect(report.conservation).toEqual({
      exact: true,
      total_available: 55,
      total_committed: 100,
      total_delivered: 40,
      total_reserved: 5,
      total_undelivered: 60,
      unit: "SIMULATED_NONTRANSFERABLE_CREDIT",
    });
    expect(report.settlement_bundles.map((bundle) => bundle.settlement.simulated_credit.amount).sort()).toEqual([10, 30]);
    expect(report.public_projections).toHaveLength(2);
    for (const projection of report.public_projections) {
      expect(projection.projection.settlement_bundle_ids).toHaveLength(1);
      const settlement = report.settlement_bundles.find(
        (bundle) => bundle.settlement_id === projection.projection.settlement_bundle_ids[0],
      )!;
      expect(projection.projection.public_evidence_receipt_ids).toEqual(
        settlement.settlement.consumed_receipt_ids,
      );
      expect(projection.projection.effects).toEqual(ZERO_EFFECTS);
    }
  });

  test("pays positive, negative, null, inconclusive and not-applicable research results identically", () => {
    for (const result of [
      "INCONCLUSIVE",
      "NEGATIVE",
      "NOT_APPLICABLE",
      "NULL",
      "POSITIVE",
    ] as const) {
      const report = simulateResearchCommons(makeGardenSimulation({ researchResult: result }));
      const research = report.settlement_bundles.find(
        (bundle) => bundle.settlement.simulated_credit.amount === 30,
      )!;
      expect(research.settlement.declared_result_kind).toBe(result);
      expect(research.settlement.simulated_credit.amount).toBe(30);
    }
  });

  test("reviewer delivery amount is invariant across every delivered review decision", () => {
    for (const decision of [
      "ABSTAINED",
      "DELIVERY_ACCEPTED",
      "DELIVERY_INCONCLUSIVE",
      "DELIVERY_REJECTED",
      "REVISION_REQUESTED",
    ] as const) {
      const report = simulateResearchCommons(makeGardenSimulation({ deliveredReviewDecision: decision }));
      const reviewer = report.settlement_bundles.find(
        (bundle) => bundle.settlement.simulated_credit.amount === 10,
      )!;
      expect(reviewer.settlement.simulated_credit.amount).toBe(10);
      expect(reviewer.settlement.result_authority).toBe("NONE");
    }
  });

  test("challenge delivery amount ignores every caller-declared challenge status", () => {
    for (const status of [
      "OPEN",
      "WITHDRAWN",
      "CALLER_DECLARED_HOLD_CONTINUES",
      "CALLER_DECLARED_HOLD_INCONCLUSIVE",
      "CALLER_DECLARED_HOLD_RELEASED",
    ] as const) {
      const report = simulateResearchCommons(makeChallengeGardenSimulation(status));
      const challenge = report.settlement_bundles.find(
        (bundle) => bundle.settlement.simulated_credit.amount === 7,
      )!;
      expect(challenge.settlement.simulated_credit.amount).toBe(7);
      expect(report.conservation.total_delivered).toBe(17);
    }
  });

  test("retains an append-only challenge journal and settles against the unique terminal head", () => {
    const open = makeChallengeGardenSimulation("OPEN", {
      lineageLabel: "append-only-transition",
      preserveResearchSettlement: true,
    });
    const reviewerMilestone = open.milestones.find(
      (milestone) => milestone.milestone_kind === "REVIEW_DELIVERY",
    )!;
    const observedOnly: ResearchSimulation = {
      ...open,
      milestones: [reviewerMilestone],
      settlement_requests: open.settlement_requests.filter(
        (request) => request.milestone_id === reviewerMilestone.milestone_id,
      ),
    };
    const observed = simulateResearchCommons(observedOnly);
    const openId = open.challenges[0]!.challenge_id;
    expect(observed.next_state.state.observed_challenge_ids).toEqual([openId]);

    expect(() => simulateResearchCommons({
      ...observedOnly,
      challenges: [],
      prior_state: observed.next_state,
    })).toThrow(/observed_challenge_ids/);

    const resolved = makeChallengeGardenSimulation("CALLER_DECLARED_HOLD_RELEASED", {
      lineageLabel: "append-only-transition",
      preserveResearchSettlement: true,
    });
    const head = resolved.challenges.find((challenge) => challenge.revision_number === 2)!;
    expect(head.prior_challenge_id).toBe(openId);
    const research = resolved.milestones.find(
      (milestone) => milestone.milestone_kind === "RESEARCH_DELIVERY",
    )!;
    const gatedResearch = createMilestone({
      ...milestoneBody(research),
      challenge_head_snapshot_ids: [head.challenge_id],
    });
    const transitioned: ResearchSimulation = {
      ...resolved,
      milestones: resolved.milestones
        .filter((milestone) => milestone.milestone_id !== research.milestone_id)
        .concat(gatedResearch)
        .sort((left, right) => left.milestone_id.localeCompare(right.milestone_id, "en")),
      prior_state: observed.next_state,
      settlement_requests: resolved.settlement_requests
        .filter((request) => request.milestone_id !== research.milestone_id)
        .concat({
          consumed_receipt_ids: gatedResearch.required_receipt_ids,
          milestone_id: gatedResearch.milestone_id,
        })
        .sort((left, right) => left.milestone_id.localeCompare(right.milestone_id, "en")),
    };
    const settled = simulateResearchCommons(transitioned);
    expect(settled.conservation.total_delivered).toBe(47);
    expect(settled.next_state.state.observed_challenge_ids).toEqual(
      resolved.challenges.map((challenge) => challenge.challenge_id).sort(),
    );
    const replay = simulateResearchCommons({ ...transitioned, prior_state: settled.next_state });
    expect(replay.next_state).toEqual(settled.next_state);
  });

  test("rejects challenge forks and evidence deletion across immutable revisions", () => {
    const simulation = makeChallengeGardenSimulation("CALLER_DECLARED_HOLD_RELEASED", {
      lineageLabel: "revision-integrity",
    });
    const root = simulation.challenges.find((challenge) => challenge.revision_number === 1)!;
    const head = simulation.challenges.find((challenge) => challenge.revision_number === 2)!;
    const fork = createChallenge({
      ...challengeBody(root),
      created_at: "2026-08-16T05:10:00.000Z",
      prior_challenge_id: root.challenge_id,
      revision_number: 2,
    });
    expect(() => simulateResearchCommons({
      ...simulation,
      challenges: [...simulation.challenges, fork]
        .sort((left, right) => left.challenge_id.localeCompare(right.challenge_id, "en")),
    })).toThrow(/forks/);

    const evidenceDeletingHead = createChallenge({
      ...challengeBody(head),
      evidence_refs: [head.evidence_refs.find((reference) => !root.evidence_refs.includes(reference))!],
    });
    expect(() => simulateResearchCommons({
      ...simulation,
      challenges: [root, evidenceDeletingHead]
        .sort((left, right) => left.challenge_id.localeCompare(right.challenge_id, "en")),
    })).toThrow(/cannot remove prior evidence/);
  });

  test("later challenges cannot claw back a closed milestone or rewrite its blocker snapshot", () => {
    const base = makeGardenSimulation();
    const first = simulateResearchCommons(base);
    const late = makeChallengeGardenSimulation("OPEN", {
      lineageLabel: "post-settlement-challenge",
      preserveResearchSettlement: true,
    });
    const appended = simulateResearchCommons({ ...late, prior_state: first.next_state });
    expect(appended.conservation.total_delivered).toBe(47);
    expect(appended.next_state.state.settled_milestone_ids).toContain(
      base.milestones.find((milestone) => milestone.milestone_kind === "RESEARCH_DELIVERY")!
        .milestone_id,
    );
    const replay = simulateResearchCommons({ ...late, prior_state: appended.next_state });
    expect(replay.next_state).toEqual(appended.next_state);
  });

  test("rest, exit, refusal and non-delivery transfer zero and release only unearned reservation", () => {
    for (const status of ["EXITED", "NOT_DELIVERED", "REFUSED", "RESTED"] as const) {
      const report = simulateResearchCommons(withRestedResearch(status));
      expect(report.conservation).toEqual({
        exact: true,
        total_available: 85,
        total_committed: 100,
        total_delivered: 10,
        total_reserved: 5,
        total_undelivered: 90,
        unit: "SIMULATED_NONTRANSFERABLE_CREDIT",
      });
      expect(report.settlement_bundles).toHaveLength(1);
      expect(report.effects).toEqual(ZERO_EFFECTS);
    }
  });

  test("reuses the full reservation after every terminal non-delivery and still rejects active overcommit", () => {
    for (const status of ["EXITED", "NOT_DELIVERED", "REFUSED", "RESTED"] as const) {
      const base = makeGardenSimulation();
      const originalCommitment = base.funding_commitments[0]!;
      const replacementFunder = base.controllers.find(
        (controller) => controller.controller_id !== originalCommitment.funder_controller_id,
      )!;
      const commitment = createFundingCommitment({
        _format: RESEARCH_FORMATS.fundingCommitment,
        case_id: base.cases[0]!.case_id,
        commitment_status: "SIMULATION_PREFUNDED_REAL_VALUE_NONE",
        convertible: false,
        effects: ZERO_EFFECTS,
        funder_controller_id: replacementFunder.controller_id,
        payment_condition: SIMULATED_PAYMENT_CONDITION,
        real_value_status: "NONE",
        result_authority: RESULT_AUTHORITY,
        simulation_backing: "PREFUNDED",
        simulated_credit_limit: 100,
        transferable: false,
        unit: SIMULATED_CREDIT_UNIT,
        valid_declared_result_kinds: DECLARED_RESULT_KINDS,
        wallet_bearing: false,
      });
      const restedSchedule = createCompensationSchedule({
        _format: RESEARCH_FORMATS.compensationSchedule,
        amount: 100,
        declared_result_invariant: true,
        frozen_at: "2026-08-17T00:00:00.000Z",
        frozen_before_work: true,
        payment_condition: SIMULATED_PAYMENT_CONDITION,
        review_decision_invariant: true,
        unit: SIMULATED_CREDIT_UNIT,
      });
      const replacementSchedule = createCompensationSchedule({
        ...(() => {
          const { schedule_ref: _scheduleRef, ...body } = restedSchedule;
          return body;
        })(),
        frozen_at: "2026-08-18T00:00:00.000Z",
      });
      const restedWork = createWorkPackage({
        _format: RESEARCH_FORMATS.workPackage,
        case_id: base.cases[0]!.case_id,
        commitment_id: commitment.commitment_id,
        compensation_schedule: restedSchedule,
        deliverable_ref: domainSeparatedId("test:released-deliverable", { status }),
        lead_controller_id: replacementFunder.controller_id,
        maximum_evidence_level: "E2",
        objective_ref: domainSeparatedId("test:released-objective", { status }),
        participation_rights: PARTICIPATION_RIGHTS,
        status: "SHADOW_ONLY",
      });
      const replacementWork = createWorkPackage({
        ...(() => {
          const { work_package_id: _workId, ...body } = restedWork;
          return body;
        })(),
        compensation_schedule: replacementSchedule,
        deliverable_ref: domainSeparatedId("test:replacement-deliverable", { status }),
        objective_ref: domainSeparatedId("test:replacement-objective", { status }),
      });
      const terminal = createMilestone({
        _format: RESEARCH_FORMATS.milestone,
        challenge_head_snapshot_ids: [],
        case_id: base.cases[0]!.case_id,
        commitment_id: commitment.commitment_id,
        compensation_schedule_ref: restedSchedule.schedule_ref,
        declared_result_kind: "NOT_APPLICABLE",
        delivery_approval_review_ids: [],
        delivery_status: status,
        milestone_kind: "RESEARCH_DELIVERY",
        payment_condition: SIMULATED_PAYMENT_CONDITION,
        required_challenge_ids: [],
        required_receipt_ids: [],
        required_review_ids: [],
        result_condition: "NOT_CONDITIONED_ON_FAVORABLE_RESULT",
        work_package_id: restedWork.work_package_id,
      });
      const firstInput: ResearchSimulation = {
        ...base,
        funding_commitments: [...base.funding_commitments, commitment]
          .sort((left, right) => left.commitment_id.localeCompare(right.commitment_id, "en")),
        milestones: [...base.milestones, terminal]
          .sort((left, right) => left.milestone_id.localeCompare(right.milestone_id, "en")),
        work_packages: [...base.work_packages, restedWork]
          .sort((left, right) => left.work_package_id.localeCompare(right.work_package_id, "en")),
      };
      const first = simulateResearchCommons(firstInput);
      const reused = simulateResearchCommons({
        ...firstInput,
        prior_state: first.next_state,
        work_packages: [...firstInput.work_packages, replacementWork]
          .sort((left, right) => left.work_package_id.localeCompare(right.work_package_id, "en")),
      });
      expect(reused.next_state.state.commitment_balances.find(
        (balance) => balance.commitment_id === commitment.commitment_id,
      )).toEqual({
        available: 0,
        commitment_id: commitment.commitment_id,
        committed: 100,
        delivered: 0,
        reserved: 100,
        unit: SIMULATED_CREDIT_UNIT,
      });

      const overSchedule = createCompensationSchedule({
        ...(() => {
          const { schedule_ref: _scheduleRef, ...body } = replacementSchedule;
          return body;
        })(),
        amount: 1,
        frozen_at: "2026-08-19T00:00:00.000Z",
      });
      const overWork = createWorkPackage({
        ...(() => {
          const { work_package_id: _workId, ...body } = replacementWork;
          return body;
        })(),
        compensation_schedule: overSchedule,
        deliverable_ref: domainSeparatedId("test:overcommit-deliverable", { status }),
        objective_ref: domainSeparatedId("test:overcommit-objective", { status }),
      });
      expect(() => simulateResearchCommons({
        ...firstInput,
        prior_state: first.next_state,
        work_packages: [...firstInput.work_packages, replacementWork, overWork]
          .sort((left, right) => left.work_package_id.localeCompare(right.work_package_id, "en")),
      })).toThrow(/exceed a prefunded simulated-credit limit/);
    }
  });

  test("cannot omit observed active work and releases it only through an immutable terminal record", () => {
    const base = makeGardenSimulation();
    const template = base.work_packages.find((workPackage) =>
      !base.milestones.some((milestone) => milestone.work_package_id === workPackage.work_package_id))!;
    const activeSchedule = createCompensationSchedule({
      _format: RESEARCH_FORMATS.compensationSchedule,
      amount: 50,
      declared_result_invariant: true,
      frozen_at: "2026-08-17T00:00:00.000Z",
      frozen_before_work: true,
      payment_condition: SIMULATED_PAYMENT_CONDITION,
      review_decision_invariant: true,
      unit: SIMULATED_CREDIT_UNIT,
    });
    const activeWork = createWorkPackage({
      ...(() => {
        const { work_package_id: _workId, ...body } = template;
        return body;
      })(),
      compensation_schedule: activeSchedule,
      deliverable_ref: domainSeparatedId("test:active-deliverable", {}),
      objective_ref: domainSeparatedId("test:active-objective", {}),
    });
    const activeInput: ResearchSimulation = {
      ...base,
      work_packages: [...base.work_packages, activeWork]
        .sort((left, right) => left.work_package_id.localeCompare(right.work_package_id, "en")),
    };
    const observed = simulateResearchCommons(activeInput);
    expect(observed.next_state.state.observed_work_package_ids).toContain(activeWork.work_package_id);
    expect(() => simulateResearchCommons({ ...base, prior_state: observed.next_state }))
      .toThrow(/observed_work_package_ids/);

    const rested = createMilestone({
      _format: RESEARCH_FORMATS.milestone,
      challenge_head_snapshot_ids: [],
      case_id: activeWork.case_id,
      commitment_id: activeWork.commitment_id,
      compensation_schedule_ref: activeSchedule.schedule_ref,
      declared_result_kind: "NOT_APPLICABLE",
      delivery_approval_review_ids: [],
      delivery_status: "RESTED",
      milestone_kind: "RESEARCH_DELIVERY",
      payment_condition: SIMULATED_PAYMENT_CONDITION,
      required_challenge_ids: [],
      required_receipt_ids: [],
      required_review_ids: [],
      result_condition: "NOT_CONDITIONED_ON_FAVORABLE_RESULT",
      work_package_id: activeWork.work_package_id,
    });
    const terminalInput: ResearchSimulation = {
      ...activeInput,
      milestones: [...activeInput.milestones, rested]
        .sort((left, right) => left.milestone_id.localeCompare(right.milestone_id, "en")),
      prior_state: observed.next_state,
    };
    const terminal = simulateResearchCommons(terminalInput);
    expect(terminal.next_state.state.reconciled_schedule_refs).toContain(activeSchedule.schedule_ref);

    const replacementSchedule = createCompensationSchedule({
      ...(() => {
        const { schedule_ref: _scheduleRef, ...body } = activeSchedule;
        return body;
      })(),
      frozen_at: "2026-08-18T00:00:00.000Z",
    });
    const replacementWork = createWorkPackage({
      ...(() => {
        const { work_package_id: _workId, ...body } = activeWork;
        return body;
      })(),
      compensation_schedule: replacementSchedule,
      deliverable_ref: domainSeparatedId("test:active-replacement-deliverable", {}),
      objective_ref: domainSeparatedId("test:active-replacement-objective", {}),
    });
    const reused = simulateResearchCommons({
      ...terminalInput,
      prior_state: terminal.next_state,
      work_packages: [...terminalInput.work_packages, replacementWork]
        .sort((left, right) => left.work_package_id.localeCompare(right.work_package_id, "en")),
    });
    expect(reused.conservation).toMatchObject({
      total_available: 5,
      total_delivered: 40,
      total_reserved: 55,
      total_undelivered: 60,
    });
    expect(reused.next_state.state.observed_work_package_ids).toContain(replacementWork.work_package_id);
  });

  test("frozen schedule amount does not observe result or review outcome", () => {
    const simulation = makeGardenSimulation();
    const milestone = simulation.milestones.find((entry) => entry.milestone_kind === "RESEARCH_DELIVERY")!;
    const work = simulation.work_packages.find(
      (entry) => entry.work_package_id === milestone.work_package_id,
    )!;
    for (const result of ["NEGATIVE", "NULL", "POSITIVE"] as const) {
      const counterfactual = createMilestone({ ...milestoneBody(milestone), declared_result_kind: result });
      expect(scheduledCreditForMilestone(counterfactual, work)).toBe(30);
    }
  });

  test("collapses shared controller roots and rejects review cartels", () => {
    expect(() => simulateResearchCommons(makeGardenSimulation({ checkerSharesOperatorWithLead: true })))
      .toThrow(/dependency root|separation/);
    expect(() => simulateResearchCommons(makeGardenSimulation({ approverSharesOperatorWithLead: true })))
      .toThrow(/dependency root|separation/);
    expect(() => simulateResearchCommons(makeChallengeGardenSimulation("OPEN", {
      challengerSharesOperatorWithLead: true,
    }))).toThrow(/dependency root|separation/);
  });

  test("refuses E3/E5 cases before any settlement or public projection can truncate them", () => {
    for (const maximumEvidenceLevel of ["E3", "E5"] as const) {
      expect(() => simulateResearchCommons(makeGardenSimulation({ maximumEvidenceLevel })))
        .toThrow(/hard-refuses evidence above E2/);
    }
  });

  test("binds research approvals to the exact delivery receipts", () => {
    expect(() => simulateResearchCommons(makeGardenSimulation({ approvalReceiptMode: "FIRST_ONLY" })))
      .toThrow(/cover exactly/);
  });

  test("enforces schedule chronology, resolution linkage and declared separation", () => {
    expect(() => simulateResearchCommons(makeGardenSimulation({
      deliveredReviewReviewedAt: "2026-08-15T23:59:59.999Z",
    }))).toThrow(/predates its frozen compensation schedule/);
    expect(() => simulateResearchCommons(makeGardenSimulation({
      deliveredReviewReviewedAt: "2026-08-16T04:00:00.000Z",
    }))).toThrow(/strictly after every reviewed receipt/);
    expect(() => simulateResearchCommons(makeChallengeGardenSimulation("OPEN", {
      createdAt: "2026-08-15T23:59:59.999Z",
    }))).toThrow(/follow its frozen schedule/);
    expect(() => simulateResearchCommons(makeChallengeGardenSimulation("OPEN", {
      createdAt: "2026-08-16T04:00:00.000Z",
    }))).toThrow(/follow its frozen schedule and target receipt/);
    expect(() => simulateResearchCommons(makeChallengeGardenSimulation(
      "CALLER_DECLARED_HOLD_RELEASED",
      { resolutionCreatedAt: "2026-08-16T05:30:00.000Z" },
    ))).toThrow(/terminal revision must strictly follow/);
    expect(() => simulateResearchCommons(makeChallengeGardenSimulation(
      "CALLER_DECLARED_HOLD_CONTINUES",
      { resolutionDecisionOverride: "DELIVERY_ACCEPTED" },
    ))).toThrow(/must match/);
    expect(() => simulateResearchCommons(makeChallengeGardenSimulation(
      "CALLER_DECLARED_HOLD_RELEASED",
      { resolutionSharesOperatorWithChallenger: true },
    ))).toThrow(/dependency root|separation/);
  });

  test("replays idempotently and detects receipt/state conservation drift", () => {
    const simulation = makeGardenSimulation();
    const first = simulateResearchCommons(simulation);
    const replay = simulateResearchCommons({ ...simulation, prior_state: first.next_state });
    expect(replay.next_state).toEqual(first.next_state);
    expect(replay.conservation).toEqual(first.conservation);

    const state = clone(first.next_state.state);
    state.consumed_receipt_ids = state.consumed_receipt_ids.slice(1);
    const tampered: SimulationState = {
      state,
      state_id: domainSeparatedId(RESEARCH_FORMATS.simulationState, state),
    };
    expect(() => simulateResearchCommons({ ...simulation, prior_state: tampered }))
      .toThrow(/receipt consumption/);

    const balanceState = clone(first.next_state.state);
    balanceState.commitment_balances[0]!.reserved += 1;
    balanceState.commitment_balances[0]!.available -= 1;
    const tamperedBalance: SimulationState = {
      state: balanceState,
      state_id: domainSeparatedId(RESEARCH_FORMATS.simulationState, balanceState),
    };
    expect(() => simulateResearchCommons({ ...simulation, prior_state: tamperedBalance }))
      .toThrow(/balance does not replay/);
  });

  test("rejects schedule replay even when a second milestone is individually valid", () => {
    const simulation = makeGardenSimulation();
    const research = simulation.milestones.find((entry) => entry.milestone_kind === "RESEARCH_DELIVERY")!;
    const duplicate = createMilestone({
      ...milestoneBody(research),
      challenge_head_snapshot_ids: [],
      delivery_approval_review_ids: [],
      delivery_status: "RESTED",
      required_challenge_ids: [],
      required_receipt_ids: [],
      required_review_ids: [],
    });
    expect(() => simulateResearchCommons({
      ...simulation,
      milestones: [...simulation.milestones, duplicate]
        .sort((left, right) => left.milestone_id.localeCompare(right.milestone_id, "en")),
    })).toThrow(/reuses a compensation schedule/);
  });
});
