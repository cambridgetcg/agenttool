import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  createPolymorphLandscape,
  createRitonavirCase,
  POLYMORPH_SOURCE_URL_PATTERN,
  validatePolymorphLandscape,
} from "../src/index.js";
import { minimalInput } from "./fixtures.js";

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

  test("matches runtime Unicode text limits and credential-free HTTPS", () => {
    const boundaryInput: any = structuredClone(minimalInput());
    boundaryInput.material.label = "🪨".repeat(512);
    boundaryInput.sources[0].url = "https://example.test/path/user@example";
    const boundary = createPolymorphLandscape(boundaryInput);
    expect(validators.landscape(boundary), JSON.stringify(validators.landscape.errors)).toBe(true);
    expect(validatePolymorphLandscape(boundary)).toEqual(boundary);

    const ritonavir = createRitonavirCase().landscape;
    const hostile = [
      {
        value: { ...ritonavir, material: { ...ritonavir.material, label: "m".repeat(600) } },
        path: "/material/label",
      },
      {
        value: {
          ...ritonavir,
          sources: ritonavir.sources.map((source, index) => index === 0
            ? { ...source, label: "s".repeat(1025) }
            : source),
        },
        path: "/sources/0/label",
      },
      {
        value: {
          ...ritonavir,
          witnesses: ritonavir.witnesses.map((witness, index) => index === 0
            ? { ...witness, scope: "w".repeat(1025) }
            : witness),
        },
        path: "/witnesses/0/scope",
      },
      {
        value: {
          ...ritonavir,
          sources: ritonavir.sources.map((source, index) => index === 0
            ? { ...source, url: "https://user:pass@example.com/source" }
            : source),
        },
        path: "/sources/0/url",
      },
    ];

    for (const candidate of hostile) {
      expect(validators.landscape(candidate.value)).toBe(false);
      expect(validators.landscape.errors?.some((error) => error.instancePath === candidate.path)).toBe(true);
      expect(() => validatePolymorphLandscape(candidate.value)).toThrow();
    }

    const overlongInput: any = structuredClone(minimalInput());
    overlongInput.material.label = "m".repeat(600);
    expect(() => createPolymorphLandscape(overlongInput)).toThrow(/512 Unicode code points/);
    const credentialInput: any = structuredClone(minimalInput());
    credentialInput.sources[0].url = "https://user:pass@example.com/source";
    expect(() => createPolymorphLandscape(credentialInput)).toThrow(/without credentials/);
  });

  test("keeps runtime-emitted source URLs inside the exact shipped schema boundary", () => {
    expect(schemas.landscape.$defs.sourceUrl.pattern).toBe(POLYMORPH_SOURCE_URL_PATTERN);
    expect(schemas.landscape.$defs.sourceUrl.format).toBeUndefined();

    for (const url of [
      "https://example.test/a",
      "https://example.test/a%20b",
      "https://example.test/path/user@example",
      "https://[2001:db8::1]/a?b=c#d",
      "https://doi.org/10.1023/A:1011052932607",
    ]) {
      const input: any = structuredClone(minimalInput());
      input.sources[0].url = url;
      const produced = createPolymorphLandscape(input);
      expect(produced.sources.find((source) => source.key === "source_a")!.url).toBe(url);
      expect(validators.landscape(produced), JSON.stringify(validators.landscape.errors)).toBe(true);
      expect(validatePolymorphLandscape(produced)).toEqual(produced);
    }

    const baseline = createPolymorphLandscape(minimalInput());
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
      expect(() => createPolymorphLandscape(input)).toThrow();

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
