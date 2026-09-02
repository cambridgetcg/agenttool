import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import { packageRoot } from "./fixtures.js";

describe("package boundary", () => {
  test("runtime source stays dependency-free and comparator-only", () => {
    const packageJson = JSON.parse(readFileSync(new URL("package.json", packageRoot), "utf8")) as {
      bundleDependencies?: string[] | boolean;
      bundledDependencies?: string[] | boolean;
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      sideEffects?: boolean;
    };
    expect(packageJson.dependencies).toBeUndefined();
    expect(packageJson.optionalDependencies).toBeUndefined();
    expect(packageJson.peerDependencies).toBeUndefined();
    expect(packageJson.bundledDependencies).toBeUndefined();
    expect(packageJson.bundleDependencies).toBeUndefined();
    expect(packageJson.sideEffects).toBeFalse();

    const sourceRoot = new URL("src/", packageRoot);
    const sources = readdirSync(sourceRoot)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => readFileSync(new URL(name, sourceRoot), "utf8"))
      .join("\n");
    const imports = [...sources.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]);
    for (const specifier of imports) {
      expect(
        specifier?.startsWith("./")
        || specifier === "node:crypto"
        || specifier === "node:util"
        || specifier === "node:util/types",
      ).toBeTrue();
    }
    expect(sources).not.toContain("@agenttool/economic-kernel");
    for (const forbidden of [
      /\bfetch\s*\(/u,
      /\bprocess\.env\b/u,
      /\bDate\.now\s*\(/u,
      /\bMath\.random\s*\(/u,
      /node:(?:child_process|dns|fs|http|https|net)/u,
      /\beval\s*\(/u,
      /\bnew Function\b/u,
    ]) {
      expect(sources).not.toMatch(forbidden);
    }
  });
});
