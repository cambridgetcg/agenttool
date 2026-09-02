import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

import { clone, vectors } from "./fixtures.js";

const root = join(import.meta.dir, "..");
const schemaDir = join(root, "schema");
const schemaFiles = readdirSync(schemaDir).filter((name) => name.endsWith(".schema.json")).sort();
const schemas = Object.fromEntries(schemaFiles.map((name) => [
  name,
  JSON.parse(readFileSync(join(schemaDir, name), "utf8")),
]));

const ready = vectors.cases.ready_formal_creation;
const records: Record<string, any[]> = {
  "agenttool-zerone-creation-contract-v0.1.schema.json": [ready.contract],
  "agenttool-zerone-creation-work-spec-v0.1.schema.json": [ready.work_spec],
  "agenttool-zerone-creation-witness-v0.1.schema.json": [
    ready.creation_witness,
    vectors.cases.honest_resource_stop.creation_witness,
  ],
  "agenttool-zerone-verification-witness-v0.1.schema.json": ready.verification_witnesses,
  "agenttool-zerone-creation-lifecycle-v0.1.schema.json": [
    ready.lifecycle,
    vectors.cases.honest_resource_stop.lifecycle,
  ],
  "agenttool-zerone-creation-artifact-v0.1.schema.json": [ready.artifact],
  "agenttool-zerone-creation-claim-projection-v0.1.schema.json": [ready.projection],
};

describe("closed JSON schemas", () => {
  test("ships exactly one schema per protocol record", () => {
    expect(schemaFiles).toEqual(Object.keys(records).sort());
  });

  test("validates every committed positive vector", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    for (const name of schemaFiles) {
      const validate = ajv.compile(schemas[name]);
      for (const record of records[name]!) {
        expect(validate(record), `${name}: ${ajv.errorsText(validate.errors)}`).toBe(true);
      }
    }
  });

  test("closes every object-shaped schema node", () => {
    for (const [name, schema] of Object.entries(schemas)) {
      const stack: any[] = [schema];
      while (stack.length > 0) {
        const current = stack.pop();
        if (current === null || typeof current !== "object") continue;
        if (current.type === "object") {
          expect(current.additionalProperties, `${name} has an open object`).toBe(false);
        }
        stack.push(...(Array.isArray(current) ? current : Object.values(current)));
      }
    }
  });

  test("rejects unknown fields, out-of-range uint64s, and non-REQUIRES relation values", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const contractValidate = ajv.compile(schemas["agenttool-zerone-creation-contract-v0.1.schema.json"]);
    const contract = clone(ready.contract);
    contract.authorities.cyber.token = "secret";
    expect(contractValidate(contract)).toBe(false);

    const oversized = clone(ready.contract);
    oversized.outcome_routes[0].requirements[0].minimum_passes = "17";
    expect(contractValidate(oversized)).toBe(false);

    const workSpecValidate = ajv.compile(
      schemas["agenttool-zerone-creation-work-spec-v0.1.schema.json"],
    );
    const uint64Overflow = clone(ready.work_spec);
    uint64Overflow.resource_limits.compute_millis = "18446744073709551616";
    expect(workSpecValidate(uint64Overflow)).toBe(false);

    const projectionValidate = ajv.compile(
      schemas["agenttool-zerone-creation-claim-projection-v0.1.schema.json"],
    );
    const projection = clone(ready.projection);
    projection.relations[0].relation = "CONTRADICTS";
    projection.relations[0].relation_value = 2;
    expect(projectionValidate(projection)).toBe(false);
  });
});
