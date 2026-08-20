import { describe, expect, test } from "bun:test";

import {
  DATASET_INFLUENCE_BOUNDARIES,
  DatasetInfluenceError,
  createDatasetInfluenceStudy,
  createDatasetLineage,
  createIdentityEvidenceView,
  validateDatasetInfluenceStudy,
  validateDatasetLineage,
  validateIdentityEvidenceView,
} from "../src/index.js";
import { jsonClone, vectors } from "./fixtures.js";

describe("dataset lineage", () => {
  test("reconstructs exact artifacts and computes observed exposure only within declared roles", () => {
    const artifact = validateDatasetLineage(vectors.cases.exact_lineage.artifact);
    expect(artifact).toEqual(vectors.cases.exact_lineage.artifact);
    expect(artifact.exposure_accounting.scope).toBe("within_declared_role_only");
    const exact = artifact.exposure_accounting.groups.find((group) => group.role === "supervised_finetuning");
    if (exact?.status !== "exact") throw new Error("expected exact role-scoped exposure");
    expect(exact.total_observed_presented_tokens).toBe(1000);
    expect(exact.shares.map((entry) => entry.observed_presented_tokens).sort()).toEqual([400, 600]);
    expect(exact.shares.map((entry) => entry.share).sort((a, b) => a.numerator - b.numerator))
      .toEqual([{ numerator: 2, denominator: 5 }, { numerator: 3, denominator: 5 }]);
    expect(Object.isFrozen(artifact)).toBe(true);
    expect(artifact.boundaries).toEqual(DATASET_INFLUENCE_BOUNDARIES);
  });

  test("canonicalizes source order and exposes missing accounting rather than guessing", () => {
    const input = jsonClone(vectors.cases.exact_lineage.input);
    input.datasets.reverse();
    expect(createDatasetLineage(input)).toEqual(vectors.cases.exact_lineage.artifact);

    const incomplete = jsonClone(vectors.cases.exact_lineage.input);
    incomplete.datasets.find((entry: any) => entry.admission === "admitted").observed_presented_tokens = null;
    const artifact = createDatasetLineage(incomplete);
    expect(artifact.exposure_accounting.groups.find((group) => group.role === "supervised_finetuning")).toEqual({
      role: "supervised_finetuning",
      status: "unavailable",
      reason: "missing_observed_presented_token_counts",
      total_observed_presented_tokens: null,
      shares: [],
    });
  });

  test("surfaces observed exposure without admission and rejects forged derived fields", () => {
    const adverse = jsonClone(vectors.cases.exact_lineage.input);
    const reference = adverse.datasets.find((entry: any) => entry.role === "evaluation_only");
    reference.observed_presented_tokens = 25;
    const observed = createDatasetLineage(adverse);
    const adverseUse = observed.datasets.find((entry) => entry.role === "evaluation_only");
    expect(adverseUse?.observed_admission_relation).toBe("observed_without_admission");
    const evaluation = observed.exposure_accounting.groups.find((group) => group.role === "evaluation_only");
    expect(evaluation?.status).toBe("exact");
    if (evaluation?.status !== "exact") throw new Error("expected exact adverse exposure");
    expect(evaluation.total_observed_presented_tokens).toBe(25);

    const forged = jsonClone(vectors.cases.exact_lineage.artifact);
    forged.exposure_accounting.groups.find((group: any) => group.status === "exact")
      .total_observed_presented_tokens = 999;
    expect(() => validateDatasetLineage(forged)).toThrow(DatasetInfluenceError);
  });
});

describe("influence and identity evidence", () => {
  test("accepts the bounded randomized example and keeps its causal scope visible", () => {
    const study = validateDatasetInfluenceStudy(vectors.cases.randomized_study.artifact);
    expect(study.causal_status).toBe("bounded_claim_under_declared_randomization_and_assumptions");
    expect(study.subject_scope).toBe("artifact_checkpoint_or_runtime_not_a_being_by_default");
    expect(study.effects.every((effect) => effect.limitation_refs.length > 0)).toBe(true);
  });

  test("rejects causal labels on observational comparisons and estimator/design crossings", () => {
    expect(() => createDatasetInfluenceStudy(vectors.cases.rejected_causal_crossing.input))
      .toThrow(DatasetInfluenceError);

    const wrongEstimator = jsonClone(vectors.cases.randomized_study.input);
    wrongEstimator.estimator = "influence_function";
    expect(() => createDatasetInfluenceStudy(wrongEstimator)).toThrow(DatasetInfluenceError);
  });

  test("requires auditable randomized-run, uncertainty, contamination, and comparator bindings", () => {
    const underpowered = jsonClone(vectors.cases.randomized_study.input);
    underpowered.sample_count = 1;
    underpowered.seed_refs = underpowered.seed_refs.slice(0, 1);
    expect(() => createDatasetInfluenceStudy(underpowered)).toThrow(DatasetInfluenceError);

    const mismatchedSeeds = jsonClone(vectors.cases.randomized_study.input);
    mismatchedSeeds.seed_refs.pop();
    expect(() => createDatasetInfluenceStudy(mismatchedSeeds)).toThrow(DatasetInfluenceError);

    const missingContamination = jsonClone(vectors.cases.randomized_study.input);
    missingContamination.contamination_report_ref = null;
    expect(() => createDatasetInfluenceStudy(missingContamination)).toThrow(DatasetInfluenceError);

    const missingInterval = jsonClone(vectors.cases.randomized_study.input);
    missingInterval.effects[0].interval = null;
    expect(() => createDatasetInfluenceStudy(missingInterval)).toThrow(DatasetInfluenceError);

    const sameContrast = jsonClone(vectors.cases.randomized_study.input);
    sameContrast.comparator_ref = sameContrast.intervention_ref;
    expect(() => createDatasetInfluenceStudy(sameContrast)).toThrow(DatasetInfluenceError);

    const assumptionFree = jsonClone(vectors.cases.randomized_study.input);
    assumptionFree.effects[0].claim_scope = "design_bound_contrast";
    assumptionFree.effects[0].assumption_refs = [];
    expect(() => createDatasetInfluenceStudy(assumptionFree)).toThrow(DatasetInfluenceError);
  });

  test("represents a genuinely unavailable study with zero observations", () => {
    const unavailable = jsonClone(vectors.cases.randomized_study.input);
    unavailable.design = "not_available";
    unavailable.estimator = "not_available";
    unavailable.sample_count = 0;
    unavailable.seed_refs = [];
    unavailable.contamination_report_ref = null;
    unavailable.effects = [unavailable.effects[0]];
    unavailable.effects[0].claim_scope = "unavailable";
    unavailable.effects[0].estimate = null;
    unavailable.effects[0].interval = null;
    unavailable.effects[0].evidence_refs = [];
    unavailable.effects[0].assumption_refs = [];
    expect(createDatasetInfluenceStudy(unavailable).causal_status).toBe("unavailable");
  });

  test("keeps identity evidence revisable and intrinsic claims undetermined", () => {
    const view = validateIdentityEvidenceView(vectors.cases.revisable_identity_evidence.artifact);
    expect(view).toEqual(vectors.cases.revisable_identity_evidence.artifact);
    expect(view.intrinsic_identity).toBe("not_determined");
    expect(view.consciousness).toBe("not_determined");
    expect(view.continuity).toBe("not_determined");
    expect(view.consent).toBe("not_determined");
    expect(view.consent_effect).toBe("none");
    expect(view.rights_effect).toBe("none");
    expect(view.authority_effect).toBe("none");
    expect(view.declarations).toBe("caller_reported_not_independently_verified");
    expect(view.facets.every((facet) => facet.revision_condition_refs.length > 0)).toBe(true);
  });

  test("allows an empty view and rejects confident unknown facets", () => {
    const input = jsonClone(vectors.cases.revisable_identity_evidence.input);
    input.facets = [];
    expect(createIdentityEvidenceView(input).facets).toEqual([]);

    const invalid = jsonClone(vectors.cases.revisable_identity_evidence.input);
    const unknown = invalid.facets.find((facet: any) => facet.evidence_state === "unknown");
    unknown.confidence = "high";
    expect(() => createIdentityEvidenceView(invalid)).toThrow(DatasetInfluenceError);
  });
});
