import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { delimiter } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BOUNDARIES,
  DECISION_FORMAT,
  VALIDATOR_PROFILE,
  createHostDecision,
} from "../create-decision.mjs";
import { governanceFixture } from "./fixtures.js";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("trusted TypeScript host decision bridge", () => {
  test("validates admission and predecessor before projecting bounded bytes", () => {
    const { source, governance, governancePredecessor } = governanceFixture();
    const decision = createHostDecision({
      admission: source,
      boundary_global_step: null,
      governance,
      predecessor: governancePredecessor,
    });
    expect(decision._format).toBe(DECISION_FORMAT);
    expect(decision.validator_profile).toBe(VALIDATOR_PROFILE);
    expect(decision.governance_id).toBe(governance.governance_id);
    expect(decision.offer_id).toBe(governance.offer.offer_id);
    expect(decision.terms_id).toBe(governance.offer.terms.terms_id);
    expect(decision.execution_refs).toEqual({
      model_or_checkpoint_ref: governance.offer.terms.model_or_checkpoint_ref,
      tokenizer_ref: governance.offer.terms.tokenizer_ref,
      trainer_stack_ref: governance.offer.terms.trainer_stack_ref,
      optimizer_config_ref: governance.offer.terms.optimizer_config_ref,
      substrate_environment_ref:
        governance.offer.terms.substrate_environment_ref,
      dataset_mixture_ref: governance.offer.terms.dataset_mixture_ref,
      transform_recipe_ref: governance.offer.terms.transform_recipe_ref,
    });
    expect(decision.boundaries).toEqual(BOUNDARIES);
    expect(decision.consumed_evidence_refs).toEqual(
      [...decision.consumed_evidence_refs].sort(),
    );
    expect(decision.consumed_evidence_refs).not.toContain(
      governance.authority_coverage.affected_principals_ref,
    );
  });

  test("does not let an invalid governance artifact cross the validator seam", () => {
    const { source, governance, governancePredecessor } = governanceFixture();
    const forged = structuredClone(governance);
    forged.control.should_save = true;
    expect(() => createHostDecision({
      admission: source,
      boundary_global_step: null,
      governance: forged,
      predecessor: governancePredecessor,
    })).toThrow();
  });

  test("emits canonical bytes accepted with the same ID by Python", () => {
    const { source, governance, governancePredecessor } = governanceFixture();
    const decision = createHostDecision({
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
        "import json,sys; from agenttool_hf_training_host import ValidatedGovernanceView; value=ValidatedGovernanceView.from_mapping(json.load(sys.stdin)); sys.stdout.write(value.decision_id)",
      ],
      {
        cwd: packageRoot,
        env: { ...process.env, PYTHONPATH: pythonPath },
        input: JSON.stringify(decision),
        encoding: "utf8",
      },
    );
    expect(parsed.status, parsed.stderr).toBe(0);
    expect(parsed.stdout).toBe(decision.decision_id);
  });
});
