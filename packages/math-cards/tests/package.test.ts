import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

describe("public package boundary", () => {
  test("is zero-runtime-dependency, side-effect-free, Apache-2.0, and public-ready", () => {
    expect(packageJson).toMatchObject({
      name: "@agenttool/math-cards",
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

  test("exports only the runtime, two schemas, vectors, and declaration hint", () => {
    expect(Object.keys(packageJson.exports).sort()).toEqual([
      ".",
      "./assessment.schema.json",
      "./card.schema.json",
      "./kingdom.extension.json",
      "./vectors.json",
    ]);
    expect(packageJson.files).toEqual([
      "dist", "schema", "vectors", "kingdom.extension.json",
      "README.md", "CLAUDE.md", "LICENSE", "NOTICE",
    ]);
  });

  test("keeps source imports pure and ambient capabilities absent", () => {
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

  test("keeps the KINGDOM hint declaration-only with every capability false", () => {
    const extension = JSON.parse(readFileSync(join(root, "kingdom.extension.json"), "utf8"));
    expect(extension).toMatchObject({
      schema: "kingdom-extension-local/v0.1",
      id: "math-cards",
      package: "@agenttool/math-cards",
      version: "0.1.0-dev.0",
      status: "public_ready_source",
      host_contract: "not_registered",
    });
    expect(Object.keys(extension.defaults).sort()).toEqual([
      "authority", "automatic_action", "clock", "environment", "filesystem", "mcp",
      "network", "permission_inheritance", "persistence", "provider", "publication", "randomness",
    ]);
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
      "schema/agenttool-math-card-v0.1.schema.json",
      "schema/agenttool-math-card-assessment-v0.1.schema.json",
      "vectors/agenttool-math-cards-v0.1.json",
      "kingdom.extension.json",
    ]) expect(files).toContain(expected);
    expect(files.some((path) => /^(?:src|tests|scripts)\//u.test(path) || path === "bun.lock")).toBe(false);
  });
});
