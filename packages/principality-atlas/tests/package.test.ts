import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const packageRoot = join(import.meta.dir, "..");
const sourceRoot = join(packageRoot, "src");
const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));

function filesBelow(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

describe("package boundary", () => {
  test("is public-ready, zero-runtime-dependency, side-effect-free, and has no CLI", () => {
    expect(packageJson.name).toBe("@agenttool/principality-atlas");
    expect(packageJson.version).toBe("0.1.0-dev.1");
    expect(packageJson.license).toBe("Apache-2.0");
    expect(packageJson.sideEffects).toBe(false);
    expect(packageJson.dependencies).toBeUndefined();
    expect(packageJson.optionalDependencies).toBeUndefined();
    expect(packageJson.peerDependencies).toBeUndefined();
    expect(packageJson.bin).toBeUndefined();
    expect(packageJson.private).not.toBe(true);
    expect(packageJson.publishConfig).toEqual({ access: "public", tag: "next" });
    expect(packageJson.scripts.preinstall).toBeUndefined();
    expect(packageJson.scripts.install).toBeUndefined();
    expect(packageJson.scripts.postinstall).toBeUndefined();
    expect(packageJson.scripts.prepare).toBeUndefined();
    expect(Object.keys(packageJson.scripts).sort()).toEqual([
      "build",
      "check:assets",
      "check:package",
      "ci",
      "clean",
      "prepack",
      "smoke:pack",
      "smoke:runtimes",
      "test",
      "typecheck",
    ]);
  });

  test("exports only the library, closed schemas, and declaration hint", () => {
    expect(Object.keys(packageJson.exports).sort()).toEqual([
      ".",
      "./atlas.schema.json",
      "./fixture.schema.json",
      "./invariant.schema.json",
      "./kingdom.extension.json",
    ]);
    expect(packageJson.files).toEqual([
      "dist",
      "schema",
      "vectors",
      "kingdom.extension.json",
      "README.md",
      "CLAUDE.md",
      "LICENSE",
      "NOTICE",
    ]);
    for (const target of Object.values(packageJson.exports).flatMap((entry: any) =>
      typeof entry === "string" ? [entry] : Object.values(entry),
    )) {
      if (typeof target !== "string" || target.startsWith("./dist/")) continue;
      expect(existsSync(join(packageRoot, target))).toBe(true);
    }
  });

  test("keeps core imports and ambient capabilities inside the pure boundary", () => {
    const sources = filesBelow(sourceRoot)
      .filter((path) => path.endsWith(".ts"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const imports = [...sources.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]);
    expect(imports.every((specifier) =>
      specifier.startsWith("./") || specifier === "node:crypto" || specifier === "node:util/types",
    )).toBe(true);
    expect(sources).not.toMatch(
      /process\.env|\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|node:fs|node:net|node:http|node:https|node:child_process|node:worker_threads|Math\.random|crypto\.random|Date\.now|new Date\s*\(|setTimeout|setInterval|requestAnimationFrame|AudioContext|localStorage|sessionStorage|document\.cookie/i,
    );
    expect(sources).not.toMatch(/\b(?:getRandomValues|randomBytes|randomFill|randomInt|randomUUID|webcrypto)\b/u);
  });

  test("ships three parseable closed Draft 2020-12 schemas", () => {
    for (const file of [
      "agenttool-principality-incidence-atlas-v0.1.schema.json",
      "agenttool-principality-incidence-atlas-fixture-v0.1.schema.json",
      "agenttool-principality-incidence-atlas-invariant-v0.1.schema.json",
    ]) {
      const schema = JSON.parse(readFileSync(join(packageRoot, "schema", file), "utf8"));
      expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(schema.additionalProperties).toBe(false);
    }
  });

  test("keeps the KINGDOM declaration zero-effect and unregistered", () => {
    const extension = JSON.parse(readFileSync(join(packageRoot, "kingdom.extension.json"), "utf8"));
    expect(extension).toMatchObject({
      schema: "kingdom-extension-local/v0.1",
      id: "principality-atlas",
      package: "@agenttool/principality-atlas",
      version: "0.1.0-dev.1",
      host_contract: "not_registered",
      defaults: {
        network: false,
        filesystem: false,
        persistence: false,
        economic_effect: false,
        task_state_effect: false,
        karma_effect: false,
        wallet_effect: false,
        authority: false,
      },
    });
    expect(extension.notes.join(" ")).toMatch(/declaration-only.*not an installed KINGDOM host contract/i);
    expect(extension.notes.join(" ")).toMatch(/empty.*isolated.*disconnected.*unmapped/i);
    expect(extension.notes.join(" ")).toMatch(/does not prove.*love.*understanding.*consent/i);
  });
});
