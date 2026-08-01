import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { validInput } from "./fixtures.js";

const schema = JSON.parse(
  readFileSync(
    join(import.meta.dir, "../schema/skills-yutabase-input-v0.1.schema.json"),
    "utf8",
  ),
) as object;
const validate = new Ajv2020({ allErrors: true, strict: true, validateFormats: false }).compile(schema);

describe("published input schema", () => {
  test("discloses every runtime-only acceptance invariant", () => {
    const comment = (schema as { $comment?: unknown }).$comment;
    expect(typeof comment).toBe("string");
    for (const fragment of [
      "own enumerable data properties",
      "standard dense arrays",
      "rejects Proxies",
      "recorded_at",
      "skills.length = selection_summary.skills",
      "unique skill names",
      "file_count = 1 + script_count + resource_count",
      "aggregate skill file/script/resource totals",
      "schema success alone is not planner acceptance",
    ]) {
      expect(comment as string).toContain(fragment);
    }
  });

  test("accepts the golden minimized input", () => {
    expect(validate(validInput())).toBe(true);
    expect(validate.errors).toBeNull();
  });

  test("is closed against raw skill content and authority grants", () => {
    const raw = structuredClone(validInput()) as any;
    raw.skills[0].body = "private instructions";
    expect(validate(raw)).toBe(false);
    expect(validate.errors?.some((error) => error.keyword === "additionalProperties")).toBe(true);

    const grant = structuredClone(validInput()) as any;
    grant.authority.grants.push("execute");
    expect(validate(grant)).toBe(false);
    expect(validate.errors?.some((error) => error.keyword === "maxItems")).toBe(true);
  });
});
