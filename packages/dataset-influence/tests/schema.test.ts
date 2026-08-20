import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

import {
  DATASET_INFLUENCE_BOUNDARIES,
  DatasetInfluenceError,
  createDatasetInfluenceStudy,
  validateDatasetInfluenceStudy,
  validateDatasetLineage,
  validateIdentityEvidenceView,
  validateShadowAttribution,
} from "../src/index.js";
import { jsonClone, root, vectors } from "./fixtures.js";

const schemas = {
  lineage: JSON.parse(readFileSync(join(root, "schema", "agenttool-dataset-lineage-v0.1.schema.json"), "utf8")),
  study: JSON.parse(readFileSync(join(root, "schema", "agenttool-dataset-influence-study-v0.1.schema.json"), "utf8")),
  identity: JSON.parse(readFileSync(join(root, "schema", "agenttool-identity-evidence-view-v0.1.schema.json"), "utf8")),
  shadow: JSON.parse(readFileSync(join(root, "schema", "agenttool-shadow-attribution-v0.1.schema.json"), "utf8")),
};
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validators = Object.fromEntries(Object.entries(schemas).map(([key, schema]) => [key, ajv.compile(schema)]));

describe("portable closed schemas", () => {
  test("strictly compile and accept every generated artifact", () => {
    const cases = [
      ["lineage", vectors.cases.exact_lineage.artifact, validateDatasetLineage],
      ["study", vectors.cases.randomized_study.artifact, validateDatasetInfluenceStudy],
      ["identity", vectors.cases.revisable_identity_evidence.artifact, validateIdentityEvidenceView],
      ["shadow", vectors.cases.exact_shadow_attribution.artifact, validateShadowAttribution],
    ] as const;
    for (const [name, artifact, validateRuntime] of cases) {
      expect(schemas[name].$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(schemas[name].$comment).toContain("require the package runtime validator");
      expect(schemas[name].$comment).toContain("remain caller-reported");
      expect(validators[name](artifact), JSON.stringify(validators[name].errors)).toBe(true);
      expect(validateRuntime(artifact)).toEqual(artifact as never);
    }
  });

  test("pins every boundary and closes every root", () => {
    for (const schema of Object.values(schemas)) {
      const properties = schema.properties.boundaries.properties;
      for (const [key, value] of Object.entries(DATASET_INFLUENCE_BOUNDARIES)) {
        expect(properties[key].const).toBe(value);
      }
      expect(schema.additionalProperties).toBe(false);
    }

    const widened = jsonClone(vectors.cases.randomized_study.artifact);
    widened.score = 99;
    expect(validators.study(widened)).toBe(false);
    expect(() => validateDatasetInfluenceStudy(widened)).toThrow(DatasetInfluenceError);
  });

  test("schema blocks expressible causal, lineage, and economic crossings", () => {
    const forgedStudy = jsonClone(vectors.cases.randomized_study.artifact);
    forgedStudy.design = "observational_checkpoint_comparison";
    forgedStudy.estimator = "difference_in_means";
    expect(validators.study(forgedStudy), JSON.stringify(validators.study.errors)).toBe(false);

    const forgedStatus = jsonClone(vectors.cases.randomized_study.artifact);
    forgedStatus.effects[0].claim_scope = "design_bound_contrast";
    expect(validators.study(forgedStatus), JSON.stringify(validators.study.errors)).toBe(false);

    for (const mutate of [
      (study: any) => { study.contamination_report_ref = null; },
      (study: any) => { study.effects[0].interval = null; },
      (study: any) => { study.sample_count = 1; study.seed_refs = study.seed_refs.slice(0, 1); },
      (study: any) => { study.seed_refs = []; },
    ]) {
      const invalid = jsonClone(vectors.cases.randomized_study.artifact);
      mutate(invalid);
      expect(validators.study(invalid), JSON.stringify(validators.study.errors)).toBe(false);
    }

    const unavailableInput = jsonClone(vectors.cases.randomized_study.input);
    unavailableInput.design = "not_available";
    unavailableInput.estimator = "not_available";
    unavailableInput.sample_count = 0;
    unavailableInput.seed_refs = [];
    unavailableInput.contamination_report_ref = null;
    unavailableInput.effects = [unavailableInput.effects[0]];
    unavailableInput.effects[0].claim_scope = "unavailable";
    unavailableInput.effects[0].estimate = null;
    unavailableInput.effects[0].interval = null;
    unavailableInput.effects[0].evidence_refs = [];
    unavailableInput.effects[0].assumption_refs = [];
    const unavailable = createDatasetInfluenceStudy(unavailableInput);
    expect(validators.study(unavailable), JSON.stringify(validators.study.errors)).toBe(true);
    const unavailableWithSamples = jsonClone(unavailable);
    unavailableWithSamples.sample_count = 1;
    expect(validators.study(unavailableWithSamples), JSON.stringify(validators.study.errors)).toBe(false);
    const unavailableWithEffect = jsonClone(unavailable);
    unavailableWithEffect.effects[0].claim_scope = "observed_association";
    expect(validators.study(unavailableWithEffect), JSON.stringify(validators.study.errors)).toBe(false);

    const forgedLineage = jsonClone(vectors.cases.exact_lineage.artifact);
    forgedLineage.datasets.find((entry: any) => (entry.observed_presented_tokens ?? 0) > 0)
      .observed_admission_relation = "not_assessed";
    expect(validators.lineage(forgedLineage), JSON.stringify(validators.lineage.errors)).toBe(false);

    const forgedShadow = jsonClone(vectors.cases.exact_shadow_attribution.artifact);
    forgedShadow.authorizes_payment = true;
    expect(validators.shadow(forgedShadow), JSON.stringify(validators.shadow.errors)).toBe(false);
  });

  test("documents semantic checks that remain runtime-only", () => {
    const mismatchedSeeds = jsonClone(vectors.cases.randomized_study.artifact);
    mismatchedSeeds.seed_refs.pop();
    expect(validators.study(mismatchedSeeds), JSON.stringify(validators.study.errors)).toBe(true);
    expect(() => validateDatasetInfluenceStudy(mismatchedSeeds)).toThrow(DatasetInfluenceError);

    const unreduced = jsonClone(vectors.cases.randomized_study.artifact);
    unreduced.effects[0].estimate = { numerator: 2, denominator: 8 };
    expect(validators.study(unreduced), JSON.stringify(validators.study.errors)).toBe(true);
    expect(() => validateDatasetInfluenceStudy(unreduced)).toThrow(DatasetInfluenceError);
  });
});
