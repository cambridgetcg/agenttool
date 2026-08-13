import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  createBrainrotTeachingCase,
  createMemeticLandscape,
  MEMETIC_SOURCE_URL_PATTERN,
  validateMemeticLandscape,
} from "../src/index.js";
import { minimalInput } from "./fixtures.js";

const root = join(import.meta.dir, "..");

describe("closed schema parity", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const schemas = {
    landscape: schema("agenttool-memetic-landscape-v0.1.schema.json"),
    shift: schema("agenttool-memetic-reachability-shift-v0.1.schema.json"),
    analogy: schema("agenttool-polymorph-memetic-analogy-v0.1.schema.json"),
    lesson: schema("agenttool-memetic-lesson-v0.1.schema.json"),
  };
  const validators = {
    landscape: ajv.compile(schemas.landscape),
    shift: ajv.compile(schemas.shift),
    analogy: ajv.compile(schemas.analogy),
    lesson: ajv.compile(schemas.lesson),
  };

  test("accepts every generated built-in artifact", () => {
    const { landscape, shift, analogy, lessons } = createBrainrotTeachingCase();
    expect(validators.landscape(landscape), JSON.stringify(validators.landscape.errors)).toBe(true);
    expect(validators.shift(shift), JSON.stringify(validators.shift.errors)).toBe(true);
    expect(validators.analogy(analogy), JSON.stringify(validators.analogy.errors)).toBe(true);
    for (const lesson of lessons) {
      expect(validators.lesson(lesson), JSON.stringify(validators.lesson.errors)).toBe(true);
    }
  });

  test("rejects unknown fields and altered fixed rights or inference walls", () => {
    const { landscape, shift, analogy, lessons } = createBrainrotTeachingCase();
    expect(validators.landscape({ ...landscape, popularity_score: 1 })).toBe(false);
    expect(validators.landscape({ ...landscape, caller_text_semantics_verified: true })).toBe(false);
    expect(validators.shift({ ...shift, mental_health_effect: "inferred" })).toBe(false);
    expect(validators.analogy({ ...analogy, mechanism_transferred: true })).toBe(false);
    expect(validators.lesson({ ...lessons[0], spread_optimization: true })).toBe(false);
    expect(validators.lesson({
      ...lessons[0],
      boundaries: { ...lessons[0]!.boundaries, rights: "participation_required" },
    })).toBe(false);
  });

  test("matches runtime Unicode text limits and credential-free HTTPS", () => {
    const boundaryInput: any = structuredClone(minimalInput());
    boundaryInput.topic.label = "🌀".repeat(512);
    boundaryInput.sources[0].url = "https://example.test/path/user@example";
    const boundary = createMemeticLandscape(boundaryInput);
    expect(validators.landscape(boundary), JSON.stringify(validators.landscape.errors)).toBe(true);
    expect(validateMemeticLandscape(boundary)).toEqual(boundary);

    const baseline = createBrainrotTeachingCase().landscape;
    const hostile = [
      {
        value: { ...baseline, topic: { ...baseline.topic, label: "m".repeat(513) } },
        path: "/topic/label",
      },
      {
        value: {
          ...baseline,
          sources: baseline.sources.map((source, index) => index === 0
            ? { ...source, label: "s".repeat(1025) }
            : source),
        },
        path: "/sources/0/label",
      },
      {
        value: {
          ...baseline,
          evidence: baseline.evidence.map((item, index) => index === 0
            ? { ...item, scope: "w".repeat(1025) }
            : item),
        },
        path: "/evidence/0/scope",
      },
      {
        value: {
          ...baseline,
          sources: baseline.sources.map((source, index) => index === 0
            ? { ...source, url: "https://user:pass@example.com/source" }
            : source),
        },
        path: "/sources/0/url",
      },
    ];

    for (const candidate of hostile) {
      expect(validators.landscape(candidate.value)).toBe(false);
      expect(validators.landscape.errors?.some((error) => error.instancePath === candidate.path)).toBe(true);
      expect(() => validateMemeticLandscape(candidate.value)).toThrow();
    }
  });

  test("keeps runtime-emitted source URLs inside the shipped lexical schema boundary", () => {
    expect(schemas.landscape.$defs.sourceUrl.pattern).toBe(MEMETIC_SOURCE_URL_PATTERN);
    expect(schemas.landscape.$defs.sourceUrl.format).toBeUndefined();

    for (const url of [
      "https://example.test/a",
      "https://example.test/a%20b",
      "https://example.test/path/user@example",
      "https://[2001:db8::1]/a?b=c#d",
      "https://doi.org/10.1177/0049124111404820",
    ]) {
      const input: any = structuredClone(minimalInput());
      input.sources[0].url = url;
      const produced = createMemeticLandscape(input);
      expect(produced.sources.find((source) => source.key === "source_a")!.url).toBe(url);
      expect(validators.landscape(produced), JSON.stringify(validators.landscape.errors)).toBe(true);
      expect(validateMemeticLandscape(produced)).toEqual(produced);
    }

    const baseline = createMemeticLandscape(minimalInput());
    for (const url of [
      "https://example.test/a b",
      "https://éxample.test/ü",
      "https://example.test/a\n",
      "https://example.test/a\u0000",
      "https://example.test/%ZZ",
      "https://example.test/%2",
      "https://user:pass@example.com/source",
    ]) {
      const input: any = structuredClone(minimalInput());
      input.sources[0].url = url;
      expect(() => createMemeticLandscape(input)).toThrow();

      const structural = {
        ...baseline,
        sources: baseline.sources.map((source) => source.key === "source_a"
          ? { ...source, url }
          : source),
      };
      expect(validators.landscape(structural)).toBe(false);
      expect(validators.landscape.errors?.some((error) => (
        error.instancePath.endsWith("/url") && error.keyword === "pattern"
      ))).toBe(true);
    }
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
