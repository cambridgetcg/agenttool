import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { root } from "./fixtures.js";

const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

describe("public package and KINGDOM boundary", () => {
  test("is zero-runtime-dependency, side-effect-free, and public-ready", () => {
    expect(packageJson).toMatchObject({
      name: "@agenttool/dataset-influence",
      version: "0.1.0-dev.0",
      license: "Apache-2.0",
      sideEffects: false,
      publishConfig: { access: "public", tag: "next" },
    });
    expect(packageJson.private).not.toBe(true);
    expect(packageJson.dependencies).toBeUndefined();
    expect(packageJson.optionalDependencies).toBeUndefined();
    expect(packageJson.peerDependencies).toBeUndefined();
    expect(packageJson.bin).toBeUndefined();
    for (const hook of ["preinstall", "install", "postinstall", "publish", "postpublish"]) {
      expect(packageJson.scripts[hook]).toBeUndefined();
    }
  });

  test("keeps runtime source free of ambient effects and randomness", () => {
    const source = readdirSync(join(root, "src"))
      .filter((name) => name.endsWith(".ts"))
      .sort()
      .map((name) => readFileSync(join(root, "src", name), "utf8"))
      .join("\n");
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]!);
    for (const specifier of imports) {
      expect(specifier.startsWith("./") || specifier === "node:crypto" || specifier === "node:util/types").toBe(true);
    }
    expect(source).not.toMatch(
      /process\.env|\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|node:fs|node:net|node:http|node:https|node:child_process|node:worker_threads|Math\.random|crypto\.random|Date\.now|new Date\s*\(|setTimeout|setInterval|localStorage|sessionStorage|document\.cookie/iu,
    );
  });

  test("keeps the KINGDOM hint declaration-only and all defaults false", () => {
    const extension = JSON.parse(readFileSync(join(root, "kingdom.extension.json"), "utf8"));
    expect(extension).toMatchObject({
      schema: "kingdom-extension-local/v0.1",
      id: "dataset-influence",
      package: "@agenttool/dataset-influence",
      version: "0.1.0-dev.0",
      host_contract: "not_registered",
    });
    expect(Object.values(extension.defaults).every((value) => value === false)).toBe(true);
    expect(extension.notes.join(" ")).toMatch(/declaration-only.*not an installed or registered host contract/i);
  });

  test("dry-run archive excludes source, tests, scripts, and lock state", () => {
    const packed = JSON.parse(execFileSync(
      "npm",
      ["pack", "--dry-run", "--json", "--ignore-scripts"],
      { cwd: root, encoding: "utf8" },
    )) as Array<{ files: Array<{ path: string }> }>;
    const files = packed[0]!.files.map((entry) => entry.path).sort();
    for (const expected of [
      "dist/index.js",
      "schema/agenttool-dataset-lineage-v0.1.schema.json",
      "schema/agenttool-dataset-influence-study-v0.1.schema.json",
      "schema/agenttool-identity-evidence-view-v0.1.schema.json",
      "schema/agenttool-shadow-attribution-v0.1.schema.json",
      "vectors/agenttool-dataset-influence-v0.1.json",
      "kingdom.extension.json",
      "hf/dataset/source-manifest.json",
    ]) expect(files).toContain(expected);
    expect(files.some((path) => /^(?:src|tests|scripts)\//u.test(path) || path === "bun.lock")).toBe(false);
    expect(files.some((path) => path.startsWith("hf/loop-atlas/"))).toBe(false);
  });
});
