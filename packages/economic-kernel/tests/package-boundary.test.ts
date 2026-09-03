import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, test } from "bun:test";

import * as publicApi from "../src/index.js";

const packageRoot = new URL("../", import.meta.url);

describe("package boundary", () => {
  test("does not expose helpers that require an already validated price revision", () => {
    expect("priceIsEffective" in publicApi).toBeFalse();
    expect("assertLedgerAccountUnitCompatibility" in publicApi).toBeFalse();
  });

  test("runtime source remains pure, public, and dependency-free", () => {
    const packageJson = JSON.parse(readFileSync(new URL("package.json", packageRoot), "utf8")) as {
      bundleDependencies?: string[] | boolean;
      bundledDependencies?: string[] | boolean;
      dependencies?: Record<string, string>;
      license?: string;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      private?: boolean;
      publishConfig?: { access?: string; tag?: string };
      sideEffects?: boolean;
    };
    expect(packageJson.dependencies).toBeUndefined();
    expect(packageJson.optionalDependencies).toBeUndefined();
    expect(packageJson.peerDependencies).toBeUndefined();
    expect(packageJson.bundledDependencies).toBeUndefined();
    expect(packageJson.bundleDependencies).toBeUndefined();
    expect(packageJson.private).toBeUndefined();
    expect(packageJson.license).toBe("Apache-2.0");
    expect(packageJson.publishConfig).toEqual({ access: "public", tag: "next" });
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
        || specifier === "node:util/types",
      ).toBeTrue();
    }
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
