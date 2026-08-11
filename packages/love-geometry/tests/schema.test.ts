import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

import { createLoveGeometry, sha256Id } from "../src/index.js";

const schema = JSON.parse(
  readFileSync(
    join(import.meta.dir, "..", "schema", "agenttool-love-geometry-v0.1.schema.json"),
    "utf8",
  ),
);
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

describe("portable schema", () => {
  test("accepts a runtime geometry and closes the complete shape", () => {
    const a = sha256Id("schema-a");
    const b = sha256Id("schema-b");
    const geometry = createLoveGeometry({
      scope_ref: sha256Id("schema-scope"),
      subject_refs: [a, b],
      vantages: [
        {
          subject_ref: a,
          toward_ref: b,
          bearings: ["reported_understanding", "reported_disagreement"],
          basis_refs: [],
          assertion: "caller_reported",
          verified_by_package: false,
        },
      ],
    });
    expect(validate(geometry), JSON.stringify(validate.errors)).toBe(true);

    const widened = JSON.parse(JSON.stringify(geometry));
    widened.score = 1;
    expect(validate(widened)).toBe(false);

    const widenedVantage = JSON.parse(JSON.stringify(geometry));
    widenedVantage.vantages[0].intensity = 1;
    expect(validate(widenedVantage)).toBe(false);
  });

  test("is Draft 2020-12 and pins the same closed bearing set", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.$defs.vantage.additionalProperties).toBe(false);
    expect(schema.$defs.bearing.enum).toContain("reported_understanding");
    expect(schema.$defs.bearing.enum).toContain("reported_disagreement");
    expect(schema.$defs.bearing.enum).not.toContain("score");
  });
});
