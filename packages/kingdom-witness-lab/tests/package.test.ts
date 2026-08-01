import { describe, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { PACKAGE_NAME, PACKAGE_VERSION } from "../src/index.js";

const ROOT = join(import.meta.dir, "..");

describe("public package boundary", () => {
  test("is a zero-runtime-dependency public preview", async () => {
    const packageJson = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")) as {
      name: string;
      version: string;
      private?: boolean;
      license?: string;
      dependencies?: unknown;
      publishConfig?: unknown;
      exports?: Record<string, unknown>;
      files?: string[];
    };
    expect(packageJson).toMatchObject({
      name: PACKAGE_NAME,
      version: PACKAGE_VERSION,
      license: "Apache-2.0",
    });
    expect(packageJson.dependencies).toBeUndefined();
    expect(packageJson.private).not.toBe(true);
    expect(packageJson.publishConfig).toEqual({ access: "public", tag: "next" });
    expect(Object.keys(packageJson.exports ?? {})).toEqual([
      ".",
      "./research-passport.schema.json",
      "./execution-route-binding.schema.json",
      "./witness-dossier.schema.json",
      "./speculative-trial.schema.json",
      "./deepseek-atlas.schema.json",
      "./deepseek-2026-08-01.json",
    ]);
    expect(packageJson.files).not.toContain("tests");
    expect(packageJson.files).not.toContain("node_modules");
    expect(packageJson.files).toContain("LICENSE");
    expect(packageJson.files).toContain("NOTICE");
  });

  test("runtime source has no ambient credential, network, execution, or write path", async () => {
    const sourceFiles = (await readdir(join(ROOT, "src"))).filter((name) => name.endsWith(".ts"));
    const source = (await Promise.all(
      sourceFiles.map((name) => readFile(join(ROOT, "src", name), "utf8")),
    )).join("\n");
    expect(source).not.toMatch(/process\.env|fetch\(|node:fs|node:child_process|spawn\(|exec\(/u);
    expect(source).not.toMatch(/authorization|bearer|api[_-]?key|token_value|password/u);
    expect(source).not.toMatch(/InferenceClient|snapshotDownload|uploadFile|createRepo|runJob/u);
  });

  test("documents what the mechanism does and does not do", async () => {
    const readme = await readFile(join(ROOT, "README.md"), "utf8");
    expect(readme).toContain("does not browse, download, execute, infer, call a provider");
    expect(readme).toContain("not named `Embassy`");
    expect(readme).toContain("represents nobody");
  });
});
