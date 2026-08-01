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
