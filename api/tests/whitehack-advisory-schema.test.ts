import { afterAll, describe, expect, test } from "bun:test";
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

async function scannerFixture(): Promise<{ root: string; lockPath: string }> {
  const toolRoot = await temporaryRoot("whitehack-schema-tool-");
  const root = join(toolRoot, "node_modules", "@agenttool", "whitehack-scan");
  const lockPath = join(toolRoot, "package-lock.json");
  await mkdir(join(root, "src"), { recursive: true });
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
      exports: { "./core": "./src/core.js" },
    })}\n`,
  );
  await writeFile(join(root, "src", "core.js"), `
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
`);
  return { root, lockPath };
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
