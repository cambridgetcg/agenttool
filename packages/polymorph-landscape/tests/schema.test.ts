import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { createRitonavirCase } from "../src/index.js";

const root = join(import.meta.dir, "..");

describe("closed schema parity", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const schemas = {
    landscape: schema("agenttool-polymorph-landscape-v0.1.schema.json"),
    shift: schema("agenttool-polymorph-reachability-shift-v0.1.schema.json"),
    lesson: schema("agenttool-polymorph-lesson-v0.1.schema.json"),
  };
  const validators = {
    landscape: ajv.compile(schemas.landscape),
    shift: ajv.compile(schemas.shift),
    lesson: ajv.compile(schemas.lesson),
  };

  test("accepts every generated ritonavir artifact", () => {
    const { landscape, shift, lessons } = createRitonavirCase();
    expect(validators.landscape(landscape), JSON.stringify(validators.landscape.errors)).toBe(true);
    expect(validators.shift(shift), JSON.stringify(validators.shift.errors)).toBe(true);
    for (const lesson of lessons) expect(validators.lesson(lesson), JSON.stringify(validators.lesson.errors)).toBe(true);
  });

  test("rejects unknown fields and altered fixed boundaries", () => {
    const { landscape, shift, lessons } = createRitonavirCase();
    expect(validators.landscape({ ...landscape, score: 1 })).toBe(false);
    expect(validators.shift({ ...shift, physical_erasure: "claimed" })).toBe(false);
    expect(validators.lesson({ ...lessons[0], medical_advice: true })).toBe(false);
  });

  test("closes every object schema", () => {
    for (const value of Object.values(schemas)) assertClosed(value, "$schema");
  });
});

function schema(name: string): any {
  return JSON.parse(readFileSync(join(root, "schema", name), "utf8"));
}

function assertClosed(value: unknown, path: string): void {
  if (!value || typeof value !== "object") return;
  if (!Array.isArray(value) && (value as any).type === "object") {
    expect((value as any).additionalProperties, path).toBe(false);
  }
  for (const [key, child] of Object.entries(value)) assertClosed(child, `${path}.${key}`);
}
