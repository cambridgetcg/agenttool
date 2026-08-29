import { describe, expect, test } from "bun:test";

import {
  HfTrainingGardenError,
  createDatasetAdmission,
  encodeDatasetAdmission,
  validateDatasetAdmission,
  validateResearchBinding,
} from "../src/index.js";
import {
  admission,
  binding,
  fullAssessment,
  metadataAssessment,
  ref,
} from "./fixtures.js";

describe("HF dataset admission", () => {
  test("is deterministic and order invariant while preserving exact Scout bindings", () => {
    const entries = [
      {
        binding: binding("datadecide_eval_results"),
        role: "metadata_reference" as const,
        candidate_slice_ref: null,
        transform_recipe_ref: null,
        assessment: metadataAssessment,
        posture: "consider" as const,
      },
      {
        binding: binding("processbench"),
        role: "metadata_reference" as const,
        candidate_slice_ref: null,
        transform_recipe_ref: null,
        assessment: metadataAssessment,
        posture: "consider" as const,
      },
    ];
    const left = createDatasetAdmission({
      garden_scope_ref: ref("garden:order"),
      policy_ref: ref("policy:order"),
      entries,
    });
    const right = createDatasetAdmission({
      garden_scope_ref: ref("garden:order"),
      policy_ref: ref("policy:order"),
      entries: [...entries].reverse(),
    });
    expect(left).toEqual(right);
    expect(validateDatasetAdmission(left)).toEqual(left);
    expect(Buffer.from(encodeDatasetAdmission(left)).toString("utf8")).toContain(left.admission_id);
    expect(Object.isFrozen(left)).toBe(true);
    expect(Object.isFrozen(left.entries)).toBe(true);
  });

  test("admits a separately reviewed sealed evaluation candidate", () => {
    const value = admission("sealed_evaluation");
    expect(value.entries[0]?.decision).toEqual({
      state: "admitted_sealed_evaluation",
      reason_codes: ["candidate_eligible_for_declared_role"],
    });
  });

  test("holds a sealed-evaluation lane absent a matching curated bounded use", () => {
    const value = admission("sealed_evaluation", "datadecide_eval_results");
    expect(value.entries[0]?.decision).toEqual({
      state: "held",
      reason_codes: ["source_not_bounded_for_declared_lane"],
    });
  });

  test("holds a curated training corpus lane when that lead forbids ingestion", () => {
    const value = admission("training_candidate");
    expect(value.entries[0]?.decision.state).toBe("held");
    expect(value.entries[0]?.decision.reason_codes).toContain("source_forbids_training_lane");
  });

  test("holds gated and unknown-license candidates without accepting a gate", () => {
    const gated = admission("sealed_evaluation", "wildguardmix");
    expect(gated.entries[0]?.decision.reason_codes).toContain("gated_source_not_eligible");
    const unknown = admission("sealed_evaluation", "datadecide_ppl_results");
    expect(unknown.entries[0]?.decision.reason_codes).toContain("license_not_declared");
    expect(gated.boundaries.gate_acceptance).toBe(false);
  });

  test("aggregates only reason codes and never rejected source bodies", () => {
    const value = createDatasetAdmission({
      garden_scope_ref: ref("garden:hold"),
      policy_ref: ref("policy:hold"),
      entries: [{
        binding: binding("processbench"),
        role: "sealed_evaluation",
        candidate_slice_ref: null,
        transform_recipe_ref: null,
        assessment: { ...fullAssessment("sealed_evaluation"), secret_scan: "not_performed" },
        posture: "consider",
      }],
    });
    expect(value.entries[0]?.decision).toEqual({
      state: "held",
      reason_codes: [
        "candidate_slice_ref_missing",
        "secret_scan_incomplete",
        "transform_recipe_ref_missing",
      ],
    });
    expect(JSON.stringify(value)).not.toMatch(/prompt_text|transcript_text|credential_value|raw_body/u);
  });

  test("rejects mutable, rewritten, extra-field, and hostile bindings", () => {
    const mutable = structuredClone(binding()) as Record<string, any>;
    mutable.artifact.revision = "main";
    expect(() => validateResearchBinding(mutable)).toThrow(HfTrainingGardenError);

    const rewritten = structuredClone(binding()) as Record<string, any>;
    rewritten.artifact.id = "someone/rewritten";
    expect(() => validateResearchBinding(rewritten)).toThrow(HfTrainingGardenError);

    const extra = structuredClone(admission()) as Record<string, unknown>;
    extra.surprise = true;
    expect(() => validateDatasetAdmission(extra)).toThrow(HfTrainingGardenError);

    const hostile = new Proxy(binding(), {
      ownKeys() {
        throw new Error("must not enter proxy trap");
      },
    });
    expect(() => validateResearchBinding(hostile)).toThrow(HfTrainingGardenError);
  });
});
