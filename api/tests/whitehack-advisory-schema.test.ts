import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import schema from "../../specs/agenttool-whitehack-advisory-v0.1.schema.json";
import {
  WHITEHACK_INTEGRITY,
  WHITEHACK_PACKAGE,
  WHITEHACK_TARBALL_URL,
  WHITEHACK_VERSION,
  runAdvisory,
} from "../../bin/whitehack-advisory.mjs";

const cleanup: string[] = [];
const ajv = new Ajv2020({ strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(root);
  return root;
}

async function scannerFixture(): Promise<{
  root: string;
  lockPath: string;
  runtimeManifest: Record<string, unknown>;
}> {
  const toolRoot = await temporaryRoot("whitehack-schema-tool-");
  const root = join(toolRoot, "node_modules", "@agenttool", "whitehack-scan");
  const lockPath = join(toolRoot, "package-lock.json");
  await mkdir(join(root, "src", "checks"), { recursive: true });
  await writeFile(join(toolRoot, "package.json"), `${JSON.stringify({
    name: "@agenttool/whitehack-advisory-schema-fixture",
    version: "0.0.0",
    private: true,
    packageManager: "npm@11.17.0",
    devDependencies: { [WHITEHACK_PACKAGE]: WHITEHACK_VERSION },
  }, null, 2)}\n`);
  await writeFile(lockPath, `${JSON.stringify({
    name: "@agenttool/whitehack-advisory-schema-fixture",
    version: "0.0.0",
    lockfileVersion: 3,
    requires: true,
    packages: {
      "": {
        name: "@agenttool/whitehack-advisory-schema-fixture",
        version: "0.0.0",
        devDependencies: { [WHITEHACK_PACKAGE]: WHITEHACK_VERSION },
      },
      [`node_modules/${WHITEHACK_PACKAGE}`]: {
        version: WHITEHACK_VERSION,
        resolved: WHITEHACK_TARBALL_URL,
        integrity: WHITEHACK_INTEGRITY,
        dev: true,
      },
    },
  }, null, 2)}\n`);
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({
      name: WHITEHACK_PACKAGE,
      version: WHITEHACK_VERSION,
      type: "module",
      exports: {
        "./core": {
          types: "./src/core.d.ts",
          default: "./src/core.js",
        },
        "./understanding": {
          types: "./src/understanding.d.ts",
          default: "./src/understanding.js",
        },
        "./math-evidence": {
          types: "./src/math-evidence.d.ts",
          default: "./src/math-evidence.js",
        },
      },
    })}\n`,
  );
  const checkSource = "export const fixtureCheckLoaded = true;\n";
  const coreSource = `
import { fixtureCheckLoaded } from "./checks/fixture-check.js";
void fixtureCheckLoaded;
export const CHECK_MANIFEST = Object.freeze(Array.from(
  { length: 47 },
  (_, index) => Object.freeze({ id: \`fixture-\${index + 1}\` }),
));

export function scanText() {
  return [{
    line: 1,
    check: "schema-check",
    confidence: "medium",
    doctrine: "substrate-honesty",
    principle: 2,
    title: "private_schema_title",
    message: "private_schema_message",
    snippet: "private_schema_snippet",
  }];
}
`;
  const understandingSource = `
import { CHECK_MANIFEST } from "./core.js";
void CHECK_MANIFEST;
export const UNDERSTANDING_DOCUMENT_TYPE = "whitehack-understanding/v1";
`;
  const evidenceProfilesSource = "export const profile = Object.freeze({ version: \"fixture\" });\n";
  const resultSource = "export const RESULT_DOCUMENT_TYPE = \"whitehack-scan-result/v1\";\n";
  const evidenceCapsuleSource = `import { CHECK_MANIFEST } from "./core.js";
import { profile } from "./evidence-capsule-profiles.js";
import { RESULT_DOCUMENT_TYPE } from "./result.js";
void CHECK_MANIFEST;
void profile;
void RESULT_DOCUMENT_TYPE;
`;
  const mathEvidenceSource = `import "./evidence-capsule.js";
export const MATH_EVIDENCE_DOCUMENT_TYPE = "whitehack-math-evidence/v1";
`;
  await writeFile(join(root, "src", "checks", "fixture-check.js"), checkSource);
  await writeFile(join(root, "src", "core.js"), coreSource);
  await writeFile(join(root, "src", "evidence-capsule-profiles.js"), evidenceProfilesSource);
  await writeFile(join(root, "src", "evidence-capsule.js"), evidenceCapsuleSource);
  await writeFile(join(root, "src", "math-evidence.js"), mathEvidenceSource);
  await writeFile(join(root, "src", "result.js"), resultSource);
  await writeFile(join(root, "src", "understanding.js"), understandingSource);
  const sources = [
    ["src/checks/fixture-check.js", checkSource],
    ["src/core.js", coreSource],
    ["src/evidence-capsule-profiles.js", evidenceProfilesSource],
    ["src/evidence-capsule.js", evidenceCapsuleSource],
    ["src/math-evidence.js", mathEvidenceSource],
    ["src/result.js", resultSource],
    ["src/understanding.js", understandingSource],
  ] as const;
  return {
    root,
    lockPath,
    runtimeManifest: {
      document_type: "agenttool-whitehack-runtime-closure/v1",
      package: WHITEHACK_PACKAGE,
      version: WHITEHACK_VERSION,
      source_revision: "c".repeat(40),
      algorithm: "sha256",
      roots: {
        core: "src/core.js",
        "math-evidence": "src/math-evidence.js",
        understanding: "src/understanding.js",
      },
      files: sources.map(([path, source]) => ({
        path,
        sha256: createHash("sha256").update(source).digest("hex"),
      })),
    },
  };
}

afterAll(async () => {
  await Promise.all(cleanup.map((path) => rm(path, { recursive: true, force: true })));
});

describe("agenttool-whitehack-advisory/v0.1 JSON Schema", () => {
  test("strictly validates the bridge's emitted report and rejects raw fields", async () => {
    const scanner = await scannerFixture();
    const source = await temporaryRoot("whitehack-schema-source-");
    await mkdir(join(source, "src"), { recursive: true });
    await writeFile(join(source, "src", "app.ts"), "export const value = 1;\n");

    const report = await runAdvisory({
      root: source,
      paths: ["src/app.ts"],
      scanner_lock: scanner.lockPath,
      scanner_root: scanner.root,
      base: "a".repeat(40),
      head: "b".repeat(40),
      expected_revision: "c".repeat(40),
      expected_runtime_manifest: scanner.runtimeManifest,
    });

    expect(ajv.validateSchema(schema)).toBe(true);
    expect(validate(report), JSON.stringify(validate.errors)).toBe(true);
    expect(report.summary.by_confidence).toEqual({ medium: 1 });
    expect(JSON.stringify(report)).not.toContain("private_schema_");

    const withRawSnippet = structuredClone(report) as Record<string, any>;
    withRawSnippet.findings[0].snippet = "must remain impossible";
    expect(validate(withRawSnippet)).toBe(false);
  });
});
