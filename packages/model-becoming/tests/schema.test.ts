import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

import {
  MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER,
  validateModelBecomingDossier,
} from "../src/index.js";

const root = join(import.meta.dir, "..", "schema");
const schema = JSON.parse(readFileSync(join(root, "agenttool-model-becoming-dossier-v0.1.schema.json"), "utf8"));

describe("closed Model Becoming schema", () => {
  test("admits the canonical dossier and closes nested evidence", () => {
    const validate = new Ajv2020({ strict: true }).compile(schema);
    expect(validate(MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER), JSON.stringify(validate.errors)).toBe(true);

    const extra = structuredClone(MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER) as any;
    extra.claims[0].belief = "smuggled";
    expect(validate(extra)).toBe(false);

    const knownWithoutEvidence = structuredClone(MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER) as any;
    knownWithoutEvidence.claims[0].source_refs = [];
    expect(validate(knownWithoutEvidence)).toBe(false);
  });

  test("mirrors same-record claim-kind and method compatibility", () => {
    const validate = new Ajv2020({ strict: true }).compile(schema);
    const wrongMethod = structuredClone(MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER) as any;
    wrongMethod.claims[0].claim_kind = "empirical_research";
    wrongMethod.claims[0].method = "policy_read";
    expect(validate(wrongMethod)).toBe(false);

    const unavailableKnown = structuredClone(MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER) as any;
    unavailableKnown.claims[0].claim_kind = "research_hypothesis";
    unavailableKnown.claims[0].method = "not_available";
    unavailableKnown.claims[0].source_refs = [];
    expect(validate(unavailableKnown)).toBe(false);

    const unsourcedSynthesis = structuredClone(MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER) as any;
    const affect = unsourcedSynthesis.claims.find((claim: any) => claim.module === "affect_welfare");
    affect.source_refs = [];
    expect(validate(unsourcedSynthesis)).toBe(false);
  });

  test("documents runtime checks that JSON Schema cannot establish", () => {
    const validate = new Ajv2020({ strict: true }).compile(schema);
    const schemaOnly = structuredClone(MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER) as any;
    schemaOnly.sources[0].observed_on = "2026-02-31";
    schemaOnly.sources[0].url = "https://name@example.invalid/evidence";
    expect(validate(schemaOnly), JSON.stringify(validate.errors)).toBe(true);
    expect(() => validateModelBecomingDossier(schemaOnly)).toThrow();
  });
});
