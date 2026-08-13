import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { QUESTION_POSTURES } from "../src/index.js";
import type { GinQuestionAndObject, QuestionPosture } from "../src/index.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PACKAGE = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Record<string, any>;

describe("private source-only package boundary", () => {
  test("exports the named question posture API used by public challenge inputs", () => {
    const posture: QuestionPosture = QUESTION_POSTURES[0];
    const question: GinQuestionAndObject = {
      posture,
      distinction_scope_ref: null,
    };
    expect(question.posture).toBe("bounded_observable_effect_or_declared_model");
  });

  test("has no runtime dependency, publisher hook, CLI, or release wiring", () => {
    expect(PACKAGE.private).toBe(true);
    expect(PACKAGE.dependencies).toBeUndefined();
    expect(PACKAGE.publishConfig).toBeUndefined();
    expect(PACKAGE.bin).toBeUndefined();
    for (const hook of ["prepack", "postpack", "prepublish", "prepublishOnly", "publish", "postpublish"]) {
      expect(PACKAGE.scripts[hook]).toBeUndefined();
    }
    expect(PACKAGE.files).toEqual([
      "dist",
      "schema",
      "vectors",
      "kingdom.extension.json",
      "README.md",
      "CLAUDE.md",
    ]);
  });

  test("keeps runtime imports pure and provider-neutral", () => {
    const source = readdirSync(join(ROOT, "src"))
      .filter((name) => name.endsWith(".ts"))
      .sort()
      .map((name) => readFileSync(join(ROOT, "src", name), "utf8"))
      .join("\n");
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]!);
    for (const specifier of imports) {
      expect(specifier.startsWith("./") || specifier === "node:crypto" || specifier === "node:util/types").toBe(true);
    }
    for (const forbidden of [
      /\bfetch\s*\(/u,
      /\bprocess\.(?:env|cwd|argv)\b/u,
      /\bDate\.now\s*\(/u,
      /from\s+["']node:(?:child_process|dgram|dns|fs|http|https|net|tls|worker_threads)["']/u,
      /from\s+["'](?:@huggingface|huggingface_hub)/u,
    ]) expect(source).not.toMatch(forbidden);
  });

  test("dry-run archive excludes source, tests, scripts, and lock state", () => {
    const packed = JSON.parse(execFileSync(
      "npm",
      ["pack", "--dry-run", "--json", "--ignore-scripts"],
      { cwd: ROOT, encoding: "utf8" },
    )) as Array<{ files: Array<{ path: string }> }>;
    const files = packed[0]!.files.map((entry) => entry.path).sort();
    for (const expected of [
      "dist/index.js",
      "schema/agenttool-gin-reconstruction-v0.1.schema.json",
      "schema/agenttool-gin-challenge-v0.1.schema.json",
      "vectors/gin-reconstruction-v0.1.json",
      "kingdom.extension.json",
    ]) expect(files).toContain(expected);
    expect(files.some((path) => /^(?:src|tests|scripts)\//u.test(path) || path === "bun.lock")).toBe(false);
  });
});
