import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PACKAGE = JSON.parse(
  readFileSync(join(ROOT, "package.json"), "utf8"),
) as Record<string, unknown>;

describe("private source-only package boundary", () => {
  test("has no runtime dependency, publisher hook, CLI, or release wiring", () => {
    expect(PACKAGE.private).toBe(true);
    expect(PACKAGE.dependencies).toBeUndefined();
    expect(PACKAGE.publishConfig).toBeUndefined();
    expect(PACKAGE.bin).toBeUndefined();

    const scripts = PACKAGE.scripts as Record<string, string>;
    for (const hook of [
      "prepack",
      "postpack",
      "prepublish",
      "prepublishOnly",
      "publish",
      "postpublish",
    ]) {
      expect(scripts[hook]).toBeUndefined();
    }
    expect(PACKAGE.files).toEqual([
      "dist",
      "schema",
      "README.md",
      "CLAUDE.md",
      "LICENSE",
      "NOTICE",
    ]);
  });

  test("exposes only built code and three closed schema documents", () => {
    const exports = PACKAGE.exports as Record<string, unknown>;
    expect(Object.keys(exports).sort()).toEqual([
      ".",
      "./boundary",
      "./boundary-analysis.schema.json",
      "./sts",
      "./sts-projection-receipt.schema.json",
      "./trial-receipt.schema.json",
    ]);
  });

  test("keeps ambient I/O, HF clients, credentials, and subprocesses out of runtime", () => {
    const source = readdirSync(join(ROOT, "src"))
      .filter((name) => name.endsWith(".ts"))
      .sort()
      .map((name) => readFileSync(join(ROOT, "src", name), "utf8"))
      .join("\n");
    for (const forbidden of [
      /from\s+["']node:(?:child_process|dgram|dns|fs|http|https|net|tls|worker_threads)["']/u,
      /from\s+["'](?:@huggingface|huggingface_hub)/u,
      /\bfetch\s*\(/u,
      /\bprocess\.env\b/u,
      /\bBun\.(?:file|spawn|spawnSync)\b/u,
    ]) {
      expect(source).not.toMatch(forbidden);
    }
  });

  test("dry-run archive excludes source, tests, fixtures, and lock state", () => {
    const packed = JSON.parse(
      execFileSync(
        "npm",
        ["pack", "--dry-run", "--json", "--ignore-scripts"],
        { cwd: ROOT, encoding: "utf8" },
      ),
    ) as Array<{ files: Array<{ path: string }> }>;
    const files = packed[0]!.files.map((entry) => entry.path).sort();

    for (const expected of [
      "dist/index.js",
      "dist/boundary.js",
      "dist/sts.js",
      "schema/agenttool-trial-receipt-v0.1.schema.json",
      "schema/agenttool-boundary-analysis-v0.1.schema.json",
      "schema/agenttool-sts-projection-receipt-v0.1.schema.json",
    ]) {
      expect(files).toContain(expected);
    }
    expect(
      files.some((path) =>
        /^(?:src|tests|fixtures)\//u.test(path) || path === "bun.lock"),
    ).toBe(false);
  });
});
