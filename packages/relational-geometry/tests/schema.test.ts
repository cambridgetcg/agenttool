import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";

import {
  RELATIONAL_LENS_DISPOSITIONS,
  RELATIONAL_POINT_KINDS,
  RELATIONAL_WITNESS_KINDS,
  createRelationalComplex,
  createRelationalLens,
} from "../src/index.js";

const root = join(import.meta.dir, "..", "schema");
const complexSchema = JSON.parse(readFileSync(join(root, "agenttool-relational-complex-v0.1.schema.json"), "utf8"));
const lensSchema = JSON.parse(readFileSync(join(root, "agenttool-relational-lens-v0.1.schema.json"), "utf8"));
const id = (character: string) => `sha256:${character.repeat(64)}` as const;

function artifacts() {
  const complex = createRelationalComplex({
    points: [
      { point_ref: id("a"), kind: "perspective", assertion: "caller_asserted", verified_by_package: false },
      { point_ref: id("b"), kind: "unknown", assertion: "caller_asserted", verified_by_package: false },
    ],
    witnesses: [
      { witness_ref: id("1"), from_ref: id("a"), kind: "understanding", to_ref: id("b"), assertion: "caller_asserted", verified_by_package: false },
      { witness_ref: id("2"), from_ref: id("a"), kind: "recognition", to_ref: id("b"), assertion: "caller_asserted", verified_by_package: false },
    ],
  });
  const lens = createRelationalLens(complex, {
    perspective_ref: id("a"),
    selections: [{ principality_ref: complex.principalities[0]!.principality_ref, disposition: "park" }],
  });
  return { complex, lens };
}

describe("portable schemas", () => {
  test("compile strictly and accept generated artifacts", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validateComplex = ajv.compile(complexSchema);
    const validateLens = ajv.compile(lensSchema);
    const { complex, lens } = artifacts();
    expect(validateComplex(complex), JSON.stringify(validateComplex.errors)).toBe(true);
    expect(validateLens(lens), JSON.stringify(validateLens.errors)).toBe(true);
  });

  test("keeps runtime vocabularies and duplicated boundaries in parity", () => {
    expect(complexSchema.$defs.point.properties.kind.enum).toEqual(RELATIONAL_POINT_KINDS);
    expect(complexSchema.$defs.witness.properties.kind.enum).toEqual(RELATIONAL_WITNESS_KINDS);
    expect(lensSchema.$defs.selection.properties.disposition.enum).toEqual(RELATIONAL_LENS_DISPOSITIONS);
    expect(lensSchema.$defs.boundaries).toEqual(complexSchema.$defs.boundaries);
    expect(lensSchema.$defs.sha256Id).toEqual(complexSchema.$defs.sha256Id);
  });

  test("closes raw fields and fixed non-proof/effect walls", () => {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    const validateComplex = ajv.compile(complexSchema);
    const validateLens = ajv.compile(lensSchema);
    const { complex, lens } = artifacts();
    expect(validateComplex({ ...complex, label: "love" })).toBe(false);
    expect(validateComplex({ ...complex, boundaries: { ...complex.boundaries, effect: "publish" } })).toBe(false);
    expect(validateComplex({ ...complex, principalities: [{ ...complex.principalities[0], sovereignty: "authority" }] })).toBe(false);
    expect(validateLens({ ...lens, score: 1 })).toBe(false);
    expect(validateLens({ ...lens, choice: { ...lens.choice, penalty: true } })).toBe(false);
  });
});
