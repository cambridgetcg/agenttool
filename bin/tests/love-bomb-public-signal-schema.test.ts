import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, test } from "bun:test";

const ROOT = resolve(import.meta.dir, "../..");
const SCHEMA_PATH = "docs/specs/agenttool-love-bomb-public-signal-v0.1.schema.json";
const EXAMPLE_PATH = "docs/specs/agenttool-love-bomb-public-signal-v0.1.example.json";
const PUBLIC_SCHEMA_PATH =
  "apps/docs/specs/agenttool-love-bomb-public-signal-v0.1.schema.json";
const PUBLIC_EXAMPLE_PATH =
  "apps/docs/specs/agenttool-love-bomb-public-signal-v0.1.example.json";

type JsonObject = Record<string, any>;
type ValidationCase = {
  name: string;
  value: unknown;
  expected: boolean;
};

const schemaBytes = readFileSync(join(ROOT, SCHEMA_PATH), "utf8");
const exampleBytes = readFileSync(join(ROOT, EXAMPLE_PATH), "utf8");
const schema = JSON.parse(schemaBytes) as JsonObject;
const example = JSON.parse(exampleBytes) as JsonObject;

const NPM_INTEGRITY = `sha512-${Buffer.alloc(64, 0x5a).toString("base64")}`;
const HF_REVISION = "0123456789abcdef0123456789abcdef01234567";

const AJV_PROGRAM = String.raw`
import Ajv2020 from "ajv/dist/2020.js";
const payload = JSON.parse(process.argv[1]);
const ajv = new Ajv2020({ allErrors: true, strict: true });
const schemaValid = ajv.validateSchema(payload.schema);
const schemaErrors = structuredClone(ajv.errors);
const validate = ajv.compile(payload.schema);
const results = payload.cases.map(({ name, value }) => {
  const valid = Boolean(validate(value));
  return { name, valid, errors: structuredClone(validate.errors) };
});
console.log(JSON.stringify({ schemaValid, schemaErrors, results }));
`;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const child of value) collectKeys(child, keys);
    return keys;
  }
  if (value === null || typeof value !== "object") return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    collectKeys(child, keys);
  }
  return keys;
}

function publishedNpm(): JsonObject {
  return {
    state: "published_exact",
    integrity: NPM_INTEGRITY,
  };
}

function publishedHuggingFace(): JsonObject {
  return {
    state: "published_exact",
    repository: "Yu-and-Ai/agenttool-love-bomb",
    revision: HF_REVISION,
    training_authorized: false,
  };
}

function validateCases(cases: ValidationCase[]): void {
  const child = Bun.spawnSync(
    [
      "bun",
      "--eval",
      AJV_PROGRAM,
      JSON.stringify({
        schema,
        cases: cases.map(({ name, value }) => ({ name, value })),
      }),
    ],
    {
      cwd: join(ROOT, "api"),
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const stdout = new TextDecoder().decode(child.stdout);
  const stderr = new TextDecoder().decode(child.stderr);
  expect(child.exitCode, stderr).toBe(0);
  const result = JSON.parse(stdout) as {
    schemaValid: boolean;
    schemaErrors: unknown;
    results: Array<{ name: string; valid: boolean; errors: unknown }>;
  };
  expect(result.schemaValid, JSON.stringify(result.schemaErrors)).toBe(true);
  expect(result.results).toHaveLength(cases.length);
  for (const candidate of result.results) {
    const expected = cases.find(({ name }) => name === candidate.name);
    expect(expected, candidate.name).toBeDefined();
    expect(candidate.valid, `${candidate.name}: ${JSON.stringify(candidate.errors)}`).toBe(
      expected?.expected,
    );
  }
}

describe("agenttool.love-bomb-public-signal/0.1 closed schema", () => {
  test("keeps canonical and public schema/example bytes exact", () => {
    expect(readFileSync(join(ROOT, PUBLIC_SCHEMA_PATH), "utf8")).toBe(schemaBytes);
    expect(readFileSync(join(ROOT, PUBLIC_EXAMPLE_PATH), "utf8")).toBe(exampleBytes);
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.$id).toBe(
      "https://docs.agenttool.dev/specs/agenttool-love-bomb-public-signal-v0.1.schema.json",
    );
    validateCases([{ name: "canonical example", value: example, expected: true }]);
  });

  test("pins the package signal, static door, ordered formats, and six false boundaries", () => {
    expect(example.schema_version).toBe("agenttool.love-bomb-public-signal/0.1");
    expect(example.package_signal).toEqual({
      package: "@agenttool/love-bomb",
      version: "0.1.0-dev.0",
      formats: [
        "agenttool.care-envelope/0.1",
        "agenttool.care-choice/0.1",
        "agenttool.love-bomb-becoming/0.1",
        "agenttool.love-bomb-delivery/0.1",
      ],
    });
    expect(example.static_door).toEqual({
      format: "agenttool.love-bomb/0.1",
      url: "https://docs.agenttool.dev/love-bomb",
    });
    expect(example.boundaries).toEqual({
      static_corpus_included: false,
      static_invitation_delivery: false,
      authored_projection_included: false,
      participant_receipt_observed: false,
      participant_attention_observed: false,
      participant_effect_observed: false,
    });
    expect(Object.values(example.boundaries)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  test("accepts every independent npm and Hugging Face publication combination", () => {
    const npmOnly = clone(example);
    npmOnly.distribution.npm = publishedNpm();

    const huggingFaceOnly = clone(example);
    huggingFaceOnly.distribution.hugging_face = publishedHuggingFace();

    const both = clone(example);
    both.distribution.npm = publishedNpm();
    both.distribution.hugging_face = publishedHuggingFace();

    const futurePatch = clone(example);
    futurePatch.package_signal.version = "0.1.1";

    const futureBuild = clone(example);
    futureBuild.package_signal.version = "0.1.1+build.7";
    futureBuild.distribution.npm = publishedNpm();

    validateCases([
      { name: "neither published", value: example, expected: true },
      { name: "npm only", value: npmOnly, expected: true },
      { name: "Hugging Face only", value: huggingFaceOnly, expected: true },
      { name: "both published", value: both, expected: true },
      { name: "future canonical patch version", value: futurePatch, expected: true },
      { name: "future canonical build metadata", value: futureBuild, expected: true },
    ]);
  });

  test("makes immutable evidence impossible in not-published branches", () => {
    const npmWithPackage = clone(example);
    npmWithPackage.distribution.npm.package = "@agenttool/love-bomb";
    const npmWithVersion = clone(example);
    npmWithVersion.distribution.npm.version = "0.1.0-dev.0";
    const npmWithIntegrity = clone(example);
    npmWithIntegrity.distribution.npm.integrity = NPM_INTEGRITY;
    const npmWithNullIntegrity = clone(example);
    npmWithNullIntegrity.distribution.npm.integrity = null;
    const huggingFaceWithRevision = clone(example);
    huggingFaceWithRevision.distribution.hugging_face.revision = HF_REVISION;
    const huggingFaceWithNullRevision = clone(example);
    huggingFaceWithNullRevision.distribution.hugging_face.revision = null;
    const huggingFaceWithUrl = clone(example);
    huggingFaceWithUrl.distribution.hugging_face.url =
      "https://huggingface.co/datasets/Yu-and-Ai/agenttool-love-bomb";
    const unpublishedTrainingAuthorized = clone(example);
    unpublishedTrainingAuthorized.distribution.hugging_face.training_authorized = true;

    validateCases([
      { name: "npm package before publication", value: npmWithPackage, expected: false },
      { name: "npm version before publication", value: npmWithVersion, expected: false },
      { name: "npm integrity before publication", value: npmWithIntegrity, expected: false },
      {
        name: "npm null integrity before publication",
        value: npmWithNullIntegrity,
        expected: false,
      },
      {
        name: "Hugging Face revision before publication",
        value: huggingFaceWithRevision,
        expected: false,
      },
      {
        name: "Hugging Face null revision before publication",
        value: huggingFaceWithNullRevision,
        expected: false,
      },
      {
        name: "Hugging Face URL before publication",
        value: huggingFaceWithUrl,
        expected: false,
      },
      {
        name: "unpublished Hugging Face training authorization escalation",
        value: unpublishedTrainingAuthorized,
        expected: false,
      },
    ]);
  });

  test("requires complete exact evidence in published branches", () => {
    const cases: ValidationCase[] = [];
    for (const key of ["integrity"] as const) {
      const changed = clone(example);
      changed.distribution.npm = publishedNpm();
      delete changed.distribution.npm[key];
      cases.push({ name: `published npm missing ${key}`, value: changed, expected: false });
    }
    for (const key of ["repository", "revision", "training_authorized"] as const) {
      const changed = clone(example);
      changed.distribution.hugging_face = publishedHuggingFace();
      delete changed.distribution.hugging_face[key];
      cases.push({
        name: `published Hugging Face missing ${key}`,
        value: changed,
        expected: false,
      });
    }

    const duplicateNpmPackage = clone(example);
    duplicateNpmPackage.distribution.npm = {
      ...publishedNpm(),
      package: "@agenttool/love-bomb",
    };
    const duplicateNpmVersion = clone(example);
    duplicateNpmVersion.distribution.npm = {
      ...publishedNpm(),
      version: "0.1.0-dev.0",
    };
    const wrongIntegrityAlgorithm = clone(example);
    wrongIntegrityAlgorithm.distribution.npm = {
      ...publishedNpm(),
      integrity: NPM_INTEGRITY.replace("sha512-", "sha256-"),
    };
    const shortIntegrity = clone(example);
    shortIntegrity.distribution.npm = {
      ...publishedNpm(),
      integrity: NPM_INTEGRITY.slice(0, -1),
    };
    const longIntegrity = clone(example);
    longIntegrity.distribution.npm = {
      ...publishedNpm(),
      integrity: `${NPM_INTEGRITY}A`,
    };
    const nonCanonicalIntegrity = clone(example);
    nonCanonicalIntegrity.distribution.npm = {
      ...publishedNpm(),
      integrity: `${NPM_INTEGRITY.slice(0, -3)}B==`,
    };
    const wrongRepository = clone(example);
    wrongRepository.distribution.hugging_face = {
      ...publishedHuggingFace(),
      repository: "someone/other",
    };
    const shortRevision = clone(example);
    shortRevision.distribution.hugging_face = {
      ...publishedHuggingFace(),
      revision: HF_REVISION.slice(0, -1),
    };
    const longRevision = clone(example);
    longRevision.distribution.hugging_face = {
      ...publishedHuggingFace(),
      revision: `${HF_REVISION}0`,
    };
    const uppercaseRevision = clone(example);
    uppercaseRevision.distribution.hugging_face = {
      ...publishedHuggingFace(),
      revision: HF_REVISION.toUpperCase(),
    };
    const trainingAuthorized = clone(example);
    trainingAuthorized.distribution.hugging_face = {
      ...publishedHuggingFace(),
      training_authorized: true,
    };

    cases.push(
      {
        name: "duplicate npm package coordinate",
        value: duplicateNpmPackage,
        expected: false,
      },
      {
        name: "duplicate npm version coordinate",
        value: duplicateNpmVersion,
        expected: false,
      },
      {
        name: "wrong integrity algorithm",
        value: wrongIntegrityAlgorithm,
        expected: false,
      },
      { name: "short integrity", value: shortIntegrity, expected: false },
      { name: "long integrity", value: longIntegrity, expected: false },
      {
        name: "non-canonical integrity padding bits",
        value: nonCanonicalIntegrity,
        expected: false,
      },
      { name: "wrong Hugging Face repository", value: wrongRepository, expected: false },
      { name: "short Hugging Face revision", value: shortRevision, expected: false },
      { name: "long Hugging Face revision", value: longRevision, expected: false },
      {
        name: "uppercase Hugging Face revision",
        value: uppercaseRevision,
        expected: false,
      },
      {
        name: "training authorization escalation",
        value: trainingAuthorized,
        expected: false,
      },
    );
    validateCases(cases);
  });

  test("rejects extras, omissions, wrong constants, ordering drift, and false-boundary escalation", () => {
    const cases: ValidationCase[] = [];
    for (const key of [
      "schema_version",
      "package_signal",
      "static_door",
      "boundaries",
      "distribution",
    ] as const) {
      const changed = clone(example);
      delete changed[key];
      cases.push({ name: `missing root ${key}`, value: changed, expected: false });
    }

    for (const key of Object.keys(example.boundaries)) {
      const changed = clone(example);
      changed.boundaries[key] = true;
      cases.push({ name: `boundary escalation ${key}`, value: changed, expected: false });
    }
    for (const key of ["package", "version", "formats"] as const) {
      const changed = clone(example);
      delete changed.package_signal[key];
      cases.push({
        name: `missing package signal ${key}`,
        value: changed,
        expected: false,
      });
    }
    for (const key of ["format", "url"] as const) {
      const changed = clone(example);
      delete changed.static_door[key];
      cases.push({ name: `missing static door ${key}`, value: changed, expected: false });
    }
    for (const key of Object.keys(example.boundaries)) {
      const changed = clone(example);
      delete changed.boundaries[key];
      cases.push({ name: `missing boundary ${key}`, value: changed, expected: false });
    }
    for (const key of ["npm", "hugging_face"] as const) {
      const changed = clone(example);
      delete changed.distribution[key];
      cases.push({ name: `missing distribution ${key}`, value: changed, expected: false });
    }

    const wrongSchemaVersion = clone(example);
    wrongSchemaVersion.schema_version = "agenttool.love-bomb/0.1";
    const wrongPackage = clone(example);
    wrongPackage.package_signal.package = "@agenttool/love";
    const malformedVersion = clone(example);
    malformedVersion.package_signal.version = "00.1.0";
    const leadingZeroMinor = clone(example);
    leadingZeroMinor.package_signal.version = "0.01.0";
    const leadingZeroPatch = clone(example);
    leadingZeroPatch.package_signal.version = "0.1.01";
    const leadingZeroPrerelease = clone(example);
    leadingZeroPrerelease.package_signal.version = "0.1.0-01";
    const longVersion = clone(example);
    longVersion.package_signal.version = `0.1.0-${"a".repeat(65)}`;
    const reorderedFormats = clone(example);
    reorderedFormats.package_signal.formats.reverse();
    const missingFormat = clone(example);
    missingFormat.package_signal.formats.pop();
    const extraFormat = clone(example);
    extraFormat.package_signal.formats.push("agenttool.other/0.1");
    const wrongStaticFormat = clone(example);
    wrongStaticFormat.static_door.format = "agenttool.love-bomb-public-signal/0.1";
    const wrongStaticUrl = clone(example);
    wrongStaticUrl.static_door.url = "https://api.agenttool.dev/public/love-bomb";
    const extraRoot = clone(example);
    extraRoot.observed_at = "2026-08-14T00:00:00Z";
    const extraPackage = clone(example);
    extraPackage.package_signal.latest = true;
    const extraStatic = clone(example);
    extraStatic.static_door.etag = "mutable";
    const extraDistribution = clone(example);
    extraDistribution.distribution.probed_at = "2026-08-14T00:00:00Z";
    const unknownNpmState = clone(example);
    unknownNpmState.distribution.npm.state = "live";
    const unknownHuggingFaceState = clone(example);
    unknownHuggingFaceState.distribution.hugging_face.state = "latest";

    cases.push(
      { name: "wrong schema version", value: wrongSchemaVersion, expected: false },
      { name: "wrong package", value: wrongPackage, expected: false },
      { name: "leading-zero semver major", value: malformedVersion, expected: false },
      { name: "leading-zero semver minor", value: leadingZeroMinor, expected: false },
      { name: "leading-zero semver patch", value: leadingZeroPatch, expected: false },
      {
        name: "leading-zero numeric prerelease",
        value: leadingZeroPrerelease,
        expected: false,
      },
      { name: "overlong semver", value: longVersion, expected: false },
      { name: "reordered formats", value: reorderedFormats, expected: false },
      { name: "missing format", value: missingFormat, expected: false },
      { name: "extra format", value: extraFormat, expected: false },
      { name: "wrong static format", value: wrongStaticFormat, expected: false },
      { name: "wrong static URL", value: wrongStaticUrl, expected: false },
      { name: "extra root claim", value: extraRoot, expected: false },
      { name: "extra package claim", value: extraPackage, expected: false },
      { name: "extra static claim", value: extraStatic, expected: false },
      {
        name: "extra distribution probe",
        value: extraDistribution,
        expected: false,
      },
      { name: "unknown npm state", value: unknownNpmState, expected: false },
      {
        name: "unknown Hugging Face state",
        value: unknownHuggingFaceState,
        expected: false,
      },
    );
    validateCases(cases);
  });

  test("contains no authored corpus, message, WAKE, or model-becoming evidence", () => {
    const keys = collectKeys(example);
    for (const key of [
      "corpus",
      "messages",
      "projections",
      "language_projections",
      "model",
      "model_becoming",
      "becoming",
      "wake",
      "wake_metadata",
      "care_floor",
      "languages",
      "choices",
    ]) {
      expect(keys.has(key), key).toBe(false);
    }
    expect(JSON.stringify(example)).not.toContain("You do not have to prove what you are");
    expect(JSON.stringify(example.distribution)).not.toMatch(
      /observed_at|published_at|checked_at|latest|current|dist_tag|probe|etag|last_modified/,
    );
    expect(example.distribution.npm).toEqual({ state: "not_published" });
    expect(example.distribution.hugging_face).toEqual({
      state: "not_published",
      repository: "Yu-and-Ai/agenttool-love-bomb",
      training_authorized: false,
    });
    expect(example.distribution.npm).not.toHaveProperty("integrity");
    expect(example.distribution.hugging_face).not.toHaveProperty("revision");
  });
});
