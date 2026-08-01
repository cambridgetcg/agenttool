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

  test("accepts an explicitly classified upstream redacted-name alias", () => {
    const redacted = structuredClone(validInput()) as any;
    redacted.skills[0].name_kind = "redacted_alias";
    redacted.skills[0].name = "<redacted-4096>";
    redacted.selection_summary.redactions = 4096;
    expect(validate(redacted)).toBe(true);
    expect(validate.errors).toBeNull();
  });

  test("rejects name-kind mismatches and malformed or out-of-range aliases", () => {
    const unknownKind = structuredClone(validInput()) as any;
    unknownKind.skills[0].name_kind = "inferred";
    expect(validate(unknownKind)).toBe(false);

    const reportedAlias = structuredClone(validInput()) as any;
    reportedAlias.skills[0].name = "<redacted-1>";
    expect(validate(reportedAlias)).toBe(false);

    const redactedPortable = structuredClone(validInput()) as any;
    redactedPortable.skills[0].name_kind = "redacted_alias";
    expect(validate(redactedPortable)).toBe(false);

    for (const alias of ["<redacted-0>", "<redacted-01>", "<redacted-4097>"]) {
      const malformed = structuredClone(validInput()) as any;
      malformed.skills[0].name_kind = "redacted_alias";
      malformed.skills[0].name = alias;
      expect(validate(malformed)).toBe(false);
    }
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
