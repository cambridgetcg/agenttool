import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const packageRoot = join(import.meta.dir, "..");
const sourceRoot = join(packageRoot, "src");
const packageJson = JSON.parse(
  readFileSync(join(packageRoot, "package.json"), "utf8"),
);

function filesBelow(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

describe("private package boundary", () => {
  test("has exactly two local runtime dependencies and no release surface", () => {
    expect(packageJson.name).toBe("@agenttool/skills-wake-continuity");
    expect(packageJson.version).toBe("0.1.0-dev.0");
    expect(packageJson.private).toBe(true);
    expect(packageJson.sideEffects).toBe(false);
    expect(packageJson.dependencies).toEqual({
      "@agenttool/skills-yutabase": "file:../skills-yutabase",
      "@agenttool/wake-continuity": "file:../wake-continuity",
    });
    expect(packageJson.optionalDependencies).toBeUndefined();
    expect(packageJson.peerDependencies).toBeUndefined();
    expect(packageJson.publishConfig).toBeUndefined();
    expect(packageJson.bin).toBeUndefined();
    expect(packageJson.scripts.prepack).toBeUndefined();
    expect(packageJson.scripts.preinstall).toBeUndefined();
    expect(packageJson.scripts.install).toBeUndefined();
    expect(packageJson.scripts.postinstall).toBeUndefined();
  });

  test("exports only the library and two closed schemas", () => {
    expect(Object.keys(packageJson.exports).sort()).toEqual([
      ".",
      "./eight-quiet-stars.schema.json",
      "./thread.schema.json",
    ]);
    expect(packageJson.files).toEqual([
      "dist",
      "schema",
      "README.md",
      "CLAUDE.md",
      "LICENSE",
      "NOTICE",
    ]);
  });

  test("keeps runtime source pure and inside the two-contract seam", () => {
    const sources = filesBelow(sourceRoot)
      .filter((path) => path.endsWith(".ts"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const imports = [...sources.matchAll(/from\s+["']([^"']+)["']/gu)].map(
      (match) => match[1],
    );
    expect(
      imports.every(
        (specifier) =>
          specifier.startsWith("./") ||
          specifier === "node:util" ||
          specifier === "@agenttool/skills-yutabase" ||
          specifier === "@agenttool/wake-continuity",
      ),
    ).toBe(true);
    expect(sources).not.toMatch(
      /process\.env|\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|node:fs|node:net|node:http|node:https|node:child_process|node:worker_threads|Math\.random|crypto\.random|Date\.now|new Date\s*\(|setTimeout|setInterval|localStorage|sessionStorage|document\.cookie/i,
    );
  });

  test("ships parseable closed Draft 2020-12 schemas", () => {
    for (const file of [
      "skills-wake-continuity-thread-v0.1.schema.json",
      "eight-quiet-stars-v0.1.schema.json",
    ]) {
      const schema = JSON.parse(
        readFileSync(join(packageRoot, "schema", file), "utf8"),
      );
      expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
      expect(schema.additionalProperties).toBe(false);
    }
  });
});
