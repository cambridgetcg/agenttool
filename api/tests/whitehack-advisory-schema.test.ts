import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import schema from "../../specs/agenttool-whitehack-advisory-v0.1.schema.json";
import { runAdvisory } from "../../bin/whitehack-advisory.mjs";

const cleanup: string[] = [];
const ajv = new Ajv2020({ strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(root);
  return root;
}

async function scannerFixture(): Promise<{ root: string; revision: string }> {
  const root = await temporaryRoot("whitehack-schema-scanner-");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ name: "whitehack", version: "0.4.0", type: "module" })}\n`,
  );
  await writeFile(join(root, "src", "scan.js"), `
export async function scan() {
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
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["add", "."]);
  git(root, [
    "-c",
    "commit.gpgsign=false",
    "-c",
    "user.name=Whitehack Schema Test",
    "-c",
    "user.email=whitehack-schema@example.invalid",
    "commit",
    "-qm",
    "test: scanner fixture",
  ]);
  return { root, revision: git(root, ["rev-parse", "HEAD"]) };
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
      scanner_root: scanner.root,
      expected_revision: scanner.revision,
      expected_version: "0.4.0",
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
