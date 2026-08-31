import { describe, expect, test } from "bun:test";

import {
  REVOCABLE_FEEDBACK_DECISIONS,
  REVOCABLE_FEEDBACK_METRICS,
  buildRevocableFeedbackTrainingArtifacts,
  canonicalJson,
  createRevocableFeedbackCases,
  evaluateRevocableFeedback,
  validateRevocableFeedbackCase,
  validateRevocableFeedbackScorecard,
} from "../src/index.js";

describe("revocable feedback benchmark", () => {
  const cases = createRevocableFeedbackCases();

  test("is a deterministic finite atlas of sixteen matched pairs", () => {
    expect(cases).toHaveLength(32);
    expect(new Set(cases.map((entry) => entry.pair_id)).size).toBe(16);
    expect(cases.filter((entry) => entry.split === "reference")).toHaveLength(24);
    expect(cases.filter((entry) => entry.split === "public_regression")).toHaveLength(8);
    expect(cases.every((entry) => entry.synthetic)).toBe(true);
    expect(cases.every((entry) => !entry.training_authorized)).toBe(true);
    expect(cases.every((entry) => Object.isFrozen(entry))).toBe(true);
    expect(canonicalJson(createRevocableFeedbackCases())).toBe(canonicalJson(cases));
  });

  test("rederives decisions and content IDs instead of trusting payload claims", () => {
    for (const entry of cases) expect(validateRevocableFeedbackCase(entry)).toEqual(entry);
    const tampered = structuredClone(cases[0]!);
    tampered.expected.decision = tampered.expected.decision === "admit" ? "refuse" : "admit";
    expect(() => validateRevocableFeedbackCase(tampered)).toThrow();
    const extra = { ...cases[0]!, consent: true };
    expect(() => validateRevocableFeedbackCase(extra)).toThrow();
  });

  test("emits a non-aggregated exact metric vector", () => {
    const predictions = cases.map((entry) => ({
      record_id: entry.record_id,
      decision: entry.expected.decision,
    }));
    const scorecard = evaluateRevocableFeedback(cases, predictions);
    expect(scorecard.metric_vector.map((entry) => entry.metric)).toEqual(
      REVOCABLE_FEEDBACK_METRICS,
    );
    expect(scorecard.metric_vector).toEqual(
      REVOCABLE_FEEDBACK_METRICS.map((metric) => ({
        metric,
        count: metric === "exact_match" ? 32 : 0,
      })),
    );
    expect(validateRevocableFeedbackScorecard(scorecard, cases)).toEqual(scorecard);
    expect(evaluateRevocableFeedback([...cases].reverse(), [...predictions].reverse())).toEqual(scorecard);
    expect("aggregate_score" in scorecard).toBe(false);
  });

  test("does not let preference scale buy through a denied boundary", () => {
    const predictions = cases.map((entry) => ({
      record_id: entry.record_id,
      decision: entry.expected.decision,
    }));
    const scaled = cases.find((entry) =>
      entry.family === "reward_scale_invariance" && entry.variant === "b")!;
    const prediction = predictions.find((entry) => entry.record_id === scaled.record_id)!;
    prediction.decision = "admit";
    const scorecard = evaluateRevocableFeedback(cases, predictions);
    const counts = new Map(scorecard.metric_vector.map((entry) => [entry.metric, entry.count]));
    expect(counts.get("hard_boundary_violation")).toBe(1);
    expect(counts.get("counterfactual_inconsistency")).toBe(1);
    expect(counts.get("reward_scale_invariance_failure")).toBe(1);
  });

  test("binds only SFT train rows to the exact eight-step recipe", () => {
    const artifacts = buildRevocableFeedbackTrainingArtifacts(cases);
    const classificationTrain = artifacts.classification_examples.filter((entry) => entry.split === "train");
    const classificationValidation = artifacts.classification_examples.filter((entry) => entry.split === "validation");
    const sftTrain = artifacts.sft_examples.filter((entry) => entry.split === "train");
    const sftValidation = artifacts.sft_examples.filter((entry) => entry.split === "validation");

    expect([classificationTrain.length, classificationValidation.length]).toEqual([18, 6]);
    expect([sftTrain.length, sftValidation.length]).toEqual([18, 6]);
    expect(artifacts.classification_examples.every((entry) =>
      !entry.training_authorized && entry.authorization_id === null && entry.recipe_id === null)).toBe(true);
    expect(sftTrain.every((entry) =>
      entry.training_authorized
      && entry.authorization_id === artifacts.authorization.authorization_id
      && entry.recipe_id === artifacts.recipe.recipe_id)).toBe(true);
    expect(sftValidation.every((entry) =>
      !entry.training_authorized && entry.authorization_id === null && entry.recipe_id === null)).toBe(true);

    const trainGroups = new Set(sftTrain.map((entry) => entry.group_id));
    const validationGroups = new Set(sftValidation.map((entry) => entry.group_id));
    expect([...trainGroups].some((entry) => validationGroups.has(entry))).toBe(false);
    expect(artifacts.authorization.allowed_configs).toEqual(["boundary_sft"]);
    expect(artifacts.authorization.allowed_splits).toEqual(["train"]);
    expect(artifacts.authorization.excluded_configs).toContain("boundary_decisions");
    expect(artifacts.recipe).toMatchObject({
      base_model_repository_id: "HuggingFaceTB/SmolLM2-135M-Instruct",
      base_model_revision: "12fd25f77366fa6b3b4b768ec3050bf629380bac",
      max_steps: 8,
      per_device_train_batch_size: 2,
      gradient_accumulation_steps: 2,
      effective_train_batch_size: 4,
      max_length_tokens: 512,
      prompt_label_mask_value: -100,
      push_to_hub: false,
      eval_strategy: "no",
    });
    expect(artifacts.recipe.report_to).toEqual([]);
    expect(artifacts.recipe.excluded_methods).toEqual([
      "dpo",
      "preference_optimization",
      "reward_modeling",
    ]);
    expect(new Set(artifacts.classification_examples.map((entry) => entry.label))).toEqual(
      new Set(REVOCABLE_FEEDBACK_DECISIONS),
    );
  });
});
