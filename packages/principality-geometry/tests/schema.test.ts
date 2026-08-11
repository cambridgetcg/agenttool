import { readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020.js";

import { createPrincipalityAtlas, validatePrincipalityAtlas } from "../src/index.js";
import { rosetteInput } from "./fixtures.js";

function schema(name: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(new URL(`../schema/${name}`, import.meta.url), "utf8"),
  ) as Record<string, unknown>;
}

const inputSchema = schema("agenttool-principality-geometry-input-v0.1.schema.json");
const atlasSchema = schema("agenttool-principality-atlas-v0.1.schema.json");

describe("closed Draft 2020-12 schemas", () => {
  test("compile strictly and accept canonical runtime values", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validateInput = ajv.compile(inputSchema);
    const validateAtlas = ajv.compile(atlasSchema);
    const input = rosetteInput();
    const atlas = createPrincipalityAtlas(input);

    expect(validateInput(input), JSON.stringify(validateInput.errors)).toBe(true);
    expect(validateAtlas(atlas), JSON.stringify(validateAtlas.errors)).toBe(true);
  });

  test("reject extra fields and noncanonical SRI padding in both layers", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validateInput = ajv.compile(inputSchema);
    const extra = rosetteInput();
    extra.extra = true;
    expect(validateInput(extra)).toBe(false);

    const sri = rosetteInput();
    const canonical = sri.principalities[0].artifact_refs[1].integrity;
    sri.principalities[0].artifact_refs[1].integrity = `${canonical.slice(0, -3)}R==`;
    expect(validateInput(sri)).toBe(false);
  });

  test("keeps runtime derivation authoritative beyond shape validation", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validateAtlasShape = ajv.compile(atlasSchema);
    const atlas = structuredClone(createPrincipalityAtlas(rosetteInput())) as any;
    atlas.geometry.invariant_surfaces[0].invariant_ids = ["provenance-exact"];
    expect(validateAtlasShape(atlas)).toBe(true);
    expect(() => validatePrincipalityAtlas(atlas)).toThrow(/does not match/u);
  });

  test("closes every object-bearing schema node", () => {
    function visit(value: unknown, path: string): void {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
        return;
      }
      const record = value as Record<string, unknown>;
      if (record.type === "object") {
        expect(record.additionalProperties, path).toBe(false);
      }
      for (const [key, nested] of Object.entries(record)) {
        visit(nested, `${path}.${key}`);
      }
    }
    visit(inputSchema, "$input");
    visit(atlasSchema, "$atlas");
  });
});
