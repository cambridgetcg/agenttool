import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  PRINCIPALITY_ATLAS_BOUNDARIES,
  PRINCIPALITY_ATLAS_CLAIM_POSTURES,
  PRINCIPALITY_ATLAS_CORRESPONDENCE_POSTURES,
  PRINCIPALITY_ATLAS_LIMITS,
} from "../src/index.js";

const root = new URL("../", import.meta.url);
const readJson = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const atlasSchema = readJson("schema/agenttool-principality-incidence-atlas-v0.1.schema.json");
const fixtureSchema = readJson("schema/agenttool-principality-incidence-atlas-fixture-v0.1.schema.json");
const invariantSchema = readJson("schema/agenttool-principality-incidence-atlas-invariant-v0.1.schema.json");
const vectors = readJson("vectors/agenttool-principality-incidence-atlas-v0.1.json");

describe("closed portable schemas and vectors", () => {
  test("binds the dev.1 generator without changing the v0.1 wire", () => {
    expect(vectors._format).toBe("agenttool.principality-incidence-atlas-vectors/0.1");
    expect(vectors.generator).toBe("@agenttool/principality-atlas@0.1.0-dev.1");
  });

  test("strictly validates every generated fixture and invariant", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    ajv.addSchema(atlasSchema);
    const validateFixture = ajv.compile(fixtureSchema);
    const validateInvariant = ajv.compile(invariantSchema);
    for (const fixture of vectors.fixtures) {
      expect(validateFixture(fixture), JSON.stringify(validateFixture.errors)).toBe(true);
    }
    for (const invariant of vectors.invariants) {
      expect(validateInvariant(invariant), JSON.stringify(validateInvariant.errors)).toBe(true);
    }
  });

  test("keeps runtime vocabulary, boundaries, and limits in schema parity", () => {
    expect(atlasSchema.$defs.claim.properties.posture.enum).toEqual(PRINCIPALITY_ATLAS_CLAIM_POSTURES);
    expect(atlasSchema.$defs.correspondence.properties.posture.enum).toEqual(PRINCIPALITY_ATLAS_CORRESPONDENCE_POSTURES);
    expect(atlasSchema.properties.charts.maxItems).toBe(PRINCIPALITY_ATLAS_LIMITS.charts);
    expect(atlasSchema.$defs.chart.properties.cells.maxItems).toBe(PRINCIPALITY_ATLAS_LIMITS.cells_per_chart);
    expect(atlasSchema.$defs.relation.properties.incidences.maxItems).toBe(PRINCIPALITY_ATLAS_LIMITS.incidences_per_relation);
    for (const [key, value] of Object.entries(PRINCIPALITY_ATLAS_BOUNDARIES)) {
      expect(atlasSchema.$defs.boundaries.properties[key].const).toBe(value);
    }
  });

  test("closes every object and rejects semantic authority fields", () => {
    for (const definition of [
      atlasSchema,
      atlasSchema.$defs.boundaries,
      atlasSchema.$defs.cell,
      atlasSchema.$defs.incidence,
      atlasSchema.$defs.relation,
      atlasSchema.$defs.claimSubject,
      atlasSchema.$defs.claim,
      atlasSchema.$defs.chart,
      atlasSchema.$defs.correspondence,
      atlasSchema.$defs.bridge,
      fixtureSchema,
      invariantSchema,
    ]) {
      expect(definition.additionalProperties).toBe(false);
    }
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addSchema(atlasSchema);
    const validate = ajv.compile(fixtureSchema);
    expect(validate({ ...vectors.fixtures[0], score: 1 })).toBe(false);
    expect(validate({
      ...vectors.fixtures[0],
      atlas: { ...vectors.fixtures[0].atlas, authority: false },
    })).toBe(false);
  });

  test("pins three synthetic cases and ten boundary invariants", () => {
    expect(vectors.fixtures.map((entry: { case: string }) => entry.case)).toEqual([
      "empty_atlas",
      "nary_plural_claims",
      "directed_partial_bridge",
    ]);
    expect(vectors.invariants).toHaveLength(10);
    expect(vectors.invariants.map((entry: { case: string }) => entry.case)).toContain("digest_linkability_remains");
  });
});
