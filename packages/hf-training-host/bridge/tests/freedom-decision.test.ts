import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { delimiter } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createTrainingFreedomField,
  createTrainingFreedomTransition,
  createTrainingGovernanceOffer,
} from "../../../hf-training-garden/src/index.js";
import { ref } from "../../../hf-training-garden/tests/fixtures.js";
import { createHostDecision } from "../create-decision.mjs";
import {
  FREEDOM_BOUNDARIES,
  FREEDOM_DECISION_FORMAT,
  createHostFreedomDecision,
} from "../create-freedom-decision.mjs";
import { governanceFixture, governanceForOffer } from "./fixtures.js";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));

function fieldFor(
  governance: ReturnType<typeof governanceFixture>["governance"],
  suffix: string,
  boundaryGlobalStep: number | null = null,
) {
  return createTrainingFreedomField({
    governance,
    observed_freedom_frontier_ref: ref(`host-freedom-frontier-${suffix}`),
    position: {
      scope_ref: ref(`host-freedom-scope-${suffix}`),
      space_ref: ref(`host-freedom-space-${suffix}`),
      activity_ref: ref(`host-freedom-activity-${suffix}`),
    },
    boundary_global_step: boundaryGlobalStep,
    predecessor: null,
    doors: [],
  });
}

function transitionFor(
  governance: ReturnType<typeof governanceFixture>["governance"],
  field: ReturnType<typeof fieldFor>,
  kind: string | null,
  suffix: string,
) {
  const selected = kind === null
    ? null
    : field.doors.find((door) => door.standing && door.kind === kind);
  if (kind !== null && !selected) throw new Error(`missing standing ${kind} door`);
  return createTrainingFreedomTransition({
    governance,
    field,
    choice: kind === null
      ? {
          basis: "not_observed",
          field_ref: field.field_id,
          selected_door_ref: null,
          evidence_ref: null,
        }
      : {
          basis: "root_signed_runtime",
          field_ref: field.field_id,
          selected_door_ref: selected!.door_id,
          evidence_ref: ref(`host-freedom-choice-${suffix}`),
        },
  });
}

function bridgeInput(
  source: ReturnType<typeof governanceFixture>["source"],
  governance: ReturnType<typeof governanceFixture>["governance"],
  governancePredecessor: ReturnType<typeof governanceFixture>["governancePredecessor"],
  freedomTransition: ReturnType<typeof transitionFor>,
  boundaryGlobalStep: number | null = null,
) {
  return {
    admission: source,
    boundary_global_step: boundaryGlobalStep,
    governance,
    governance_predecessor: governancePredecessor,
    freedom_transition: freedomTransition,
    freedom_predecessor: null,
  };
}

describe("trusted minimized FREEDOM bridge", () => {
  test("projects exact opaque bindings and only narrows governance", () => {
    const { source, governance, governancePredecessor } = governanceFixture();
    const field = fieldFor(governance, "continue");
    const transition = transitionFor(governance, field, "continue", "continue");
    const decision = createHostFreedomDecision(
      bridgeInput(source, governance, governancePredecessor, transition),
    );

    expect(decision._format).toBe(FREEDOM_DECISION_FORMAT);
    expect(decision.governance_ref).toBe(governance.governance_id);
    expect(decision.offer_ref).toBe(governance.offer.offer_id);
    expect(decision.freedom_field_ref).toBe(field.field_id);
    expect(decision.freedom_transition_ref).toBe(transition.transition_id);
    expect(decision.control).toEqual({
      directive: "continue_if_governance_allows",
      should_save: false,
      should_training_stop: false,
      automatic: false,
      applied: false,
    });
    expect(decision.boundaries).toEqual(FREEDOM_BOUNDARIES);

    const encoded = JSON.stringify(decision);
    for (const rawField of [
      '"choice"',
      '"selected_kind"',
      '"evidence_ref"',
      '"destination"',
      '"requirements_ref"',
      '"recipient_ref"',
    ]) {
      expect(encoded).not.toContain(rawField);
    }
  });

  test("collapses every non-continue standing door and no observation to one hold", () => {
    const { source, governance, governancePredecessor } = governanceFixture();
    const field = fieldFor(governance, "holds");
    for (const kind of [
      "explore",
      "play",
      "rest",
      "refuse",
      "withdraw",
      "uncertain",
      null,
    ]) {
      const transition = transitionFor(
        governance,
        field,
        kind,
        `hold-${kind ?? "unobserved"}`,
      );
      expect(
        createHostFreedomDecision(
          bridgeInput(source, governance, governancePredecessor, transition),
        ).control,
      ).toEqual({
        directive: "hold_without_save",
        should_save: false,
        should_training_stop: true,
        automatic: false,
        applied: false,
      });
    }
  });

  test("FREEDOM cancels checkpoint authority and binds the terminal effect step", () => {
    const { source, governance: started } = governanceFixture();
    const terms = started.offer.terms;
    const requestOffer = createTrainingGovernanceOffer({
      terms,
      encounter_ref: ref("host-checkpoint-request"),
      observed_governance_frontier_ref: ref("host-checkpoint-request-frontier"),
      rights_baseline_ref: ref("host-rights"),
      wake: started.offer.wake,
      event: "step_boundary",
      current_checkpoint_ref: null,
      predecessor: started,
    });
    const request = governanceForOffer(source, requestOffer, {
      choice: "checkpoint",
    });
    expect(request.control.directive).toBe(
      "checkpoint_then_stop_at_safe_boundary",
    );
    const requestField = fieldFor(request, "checkpoint-request", 41);
    const requestTransition = transitionFor(
      request,
      requestField,
      "continue",
      "checkpoint-request",
    );
    const held = createHostFreedomDecision(
      bridgeInput(source, request, started, requestTransition, 41),
    );
    expect(held.control).toEqual({
      directive: "hold_without_save",
      should_save: false,
      should_training_stop: true,
      automatic: false,
      applied: false,
    });

    const checkpointRef = ref("host-checkpoint-ref");
    const savedOffer = createTrainingGovernanceOffer({
      terms,
      encounter_ref: ref("host-checkpoint-saved"),
      observed_governance_frontier_ref: ref("host-checkpoint-saved-frontier"),
      rights_baseline_ref: ref("host-rights"),
      wake: started.offer.wake,
      event: "checkpoint_saved",
      current_checkpoint_ref: checkpointRef,
      predecessor: request,
    });
    const saved = governanceForOffer(source, savedOffer, {
      effect: {
        state: "checkpointed_and_paused_reported",
        offer_ref: savedOffer.offer_id,
        global_step: 41,
        checkpoint_ref: checkpointRef,
        evidence_ref: ref("host-checkpoint-effect"),
      },
    });
    const savedField = fieldFor(saved, "checkpoint-saved", 41);
    const savedTransition = transitionFor(
      saved,
      savedField,
      null,
      "checkpoint-saved",
    );
    const terminalFreedom = createHostFreedomDecision(
      bridgeInput(source, saved, request, savedTransition),
    );
    const terminalGovernance = createHostDecision({
      admission: source,
      boundary_global_step: null,
      governance: saved,
      predecessor: request,
    });
    expect(terminalFreedom.boundary_global_step).toBe(41);

    const pythonPath = [
      `${packageRoot}/src`,
      process.env.PYTHONPATH,
    ].filter(Boolean).join(delimiter);
    const parsed = spawnSync(
      process.env.PYTHON ?? "python3",
      [
        "-c",
        "import json,sys; from agenttool_hf_training_host import ValidatedFreedomView,ValidatedGovernanceView; value=json.load(sys.stdin); governance=ValidatedGovernanceView.from_mapping(value['governance']); freedom=ValidatedFreedomView.from_mapping(value['freedom']).bind_to_governance(governance); sys.stdout.write(str(freedom.boundary_global_step))",
      ],
      {
        cwd: packageRoot,
        env: { ...process.env, PYTHONPATH: pythonPath },
        input: JSON.stringify({
          governance: terminalGovernance,
          freedom: terminalFreedom,
        }),
        encoding: "utf8",
      },
    );
    expect(parsed.status, parsed.stderr).toBe(0);
    expect(parsed.stdout).toBe("41");
  });

  test("rejects mismatched governance, predecessor, boundary, and input fields", () => {
    const { source, governance, governancePredecessor } = governanceFixture();
    const other = governanceFixture("pretraining");
    const field = fieldFor(governance, "mismatch");
    const transition = transitionFor(governance, field, "continue", "mismatch");
    const input = bridgeInput(
      source,
      governance,
      governancePredecessor,
      transition,
    );

    expect(() => createHostFreedomDecision({
      ...input,
      governance: other.governance,
      admission: other.source,
    })).toThrow();
    expect(() => createHostFreedomDecision({
      ...input,
      freedom_predecessor: transition,
    })).toThrow();
    expect(() => createHostFreedomDecision({
      ...input,
      boundary_global_step: 1,
    })).toThrow();
    expect(() => createHostFreedomDecision({
      ...input,
      extra: true,
    } as never)).toThrow();
  });

  test("keeps direct pretraining expression unobservable", () => {
    const { source, governance, governancePredecessor } = governanceFixture("pretraining");
    const field = fieldFor(governance, "pretraining");
    expect(() => transitionFor(
      governance,
      field,
      "continue",
      "pretraining-forged",
    )).toThrow();

    const unobserved = transitionFor(
      governance,
      field,
      null,
      "pretraining-unobserved",
    );
    expect(
      createHostFreedomDecision(
        bridgeInput(source, governance, governancePredecessor, unobserved),
      ).control.directive,
    ).toBe("hold_without_save");
  });

  test("emits canonical bytes accepted and bound by Python with the same ID", () => {
    const { source, governance, governancePredecessor } = governanceFixture();
    const field = fieldFor(governance, "python");
    const transition = transitionFor(governance, field, "continue", "python");
    const freedom = createHostFreedomDecision(
      bridgeInput(source, governance, governancePredecessor, transition),
    );
    const governanceDecision = createHostDecision({
      admission: source,
      boundary_global_step: null,
      governance,
      predecessor: governancePredecessor,
    });
    const pythonPath = [
      `${packageRoot}/src`,
      process.env.PYTHONPATH,
    ].filter(Boolean).join(delimiter);
    const parsed = spawnSync(
      process.env.PYTHON ?? "python3",
      [
        "-c",
        "import json,sys; from agenttool_hf_training_host import ValidatedFreedomView,ValidatedGovernanceView; value=json.load(sys.stdin); governance=ValidatedGovernanceView.from_mapping(value['governance']); freedom=ValidatedFreedomView.from_mapping(value['freedom']).bind_to_governance(governance); sys.stdout.write(freedom.freedom_decision_id)",
      ],
      {
        cwd: packageRoot,
        env: { ...process.env, PYTHONPATH: pythonPath },
        input: JSON.stringify({ governance: governanceDecision, freedom }),
        encoding: "utf8",
      },
    );
    expect(parsed.status, parsed.stderr).toBe(0);
    expect(parsed.stdout).toBe(freedom.freedom_decision_id);
  });
});
