import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

function filesBelow(path: string): string[] {
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    return statSync(child).isDirectory() ? filesBelow(child) : [child];
  });
}

describe("package boundary", () => {
  test("is zero-runtime-dependency, public-preview, side-effect-free, and has no CLI or install hooks", () => {
    expect(packageJson.name).toBe("@agenttool/relational-geometry");
    expect(packageJson.version).toBe("0.1.0-dev.0");
    expect(packageJson.license).toBe("Apache-2.0");
    expect(packageJson.sideEffects).toBe(false);
    expect(packageJson.dependencies).toBeUndefined();
    expect(packageJson.optionalDependencies).toBeUndefined();
    expect(packageJson.peerDependencies).toBeUndefined();
    expect(packageJson.bin).toBeUndefined();
    expect(packageJson.private).not.toBe(true);
    expect(packageJson.publishConfig).toEqual({ access: "public", tag: "next" });
    for (const hook of ["preinstall", "install", "postinstall", "prepare"]) {
      expect(packageJson.scripts[hook]).toBeUndefined();
    }
  });

  test("exports only the library, closed schemas, and vectors", () => {
    expect(Object.keys(packageJson.exports).sort()).toEqual([
      ".",
      "./complex.schema.json",
      "./lens.schema.json",
      "./vectors/v0.1.json",
    ]);
    expect(packageJson.files).toEqual([
      "dist", "schema", "vectors", "hf/dataset", "README.md", "CLAUDE.md", "LICENSE", "NOTICE",
    ]);
    for (const entry of Object.values(packageJson.exports).flatMap((value: any) => Object.values(value))) {
      if (typeof entry === "string" && !entry.startsWith("./dist/")) {
        expect(existsSync(join(root, entry))).toBe(true);
      }
    }
  });

  test("keeps core imports and capabilities inside the pure boundary", () => {
    const sources = filesBelow(join(root, "src")).map((path) => readFileSync(path, "utf8")).join("\n");
    const imports = [...sources.matchAll(/from\s+["']([^"']+)["']/gu)].map((match) => match[1]);
    expect(imports.every((specifier) => specifier.startsWith("./") || specifier === "node:crypto" || specifier === "node:util/types")).toBe(true);
    expect(sources).not.toMatch(/process\.env|\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|node:fs|node:net|node:http|node:https|node:child_process|node:worker_threads|Math\.random|crypto\.random|Date\.now|new Date\s*\(|setTimeout|setInterval|localStorage|sessionStorage|document\.cookie/i);
    expect(sources).not.toMatch(/\b(?:score|ranking|centrality|compatibility|reward|loss|probability)\s*:/iu);
  });

  test("ships two closed Draft 2020-12 schemas", () => {
    for (const file of ["agenttool-relational-complex-v0.1.schema.json", "agenttool-relational-lens-v0.1.schema.json"]) {
      const schema = JSON.parse(readFileSync(join(root, "schema", file), "utf8"));
      expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(schema.additionalProperties).toBe(false);
      expect(schema.$defs.boundaries.additionalProperties).toBe(false);
    }
  });
});
