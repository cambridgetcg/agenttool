import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { PACKAGE_NAME, PACKAGE_VERSION } from "../src/index.js";

const packageRoot = join(import.meta.dir, "..");

describe("npm pack surface", () => {
  test("has no runtime dependencies and exports only the library and schema", async () => {
    const pkg = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as Record<string, any>;
    expect(pkg.name).toBe(PACKAGE_NAME);
    expect(pkg.version).toBe(PACKAGE_VERSION);
    expect(pkg.private).toBeUndefined();
    expect(pkg.sideEffects).toBe(false);
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.main).toBe("./dist/index.js");
    expect(pkg.types).toBe("./dist/index.d.ts");
    expect(Object.keys(pkg.exports)).toEqual([".", "./input.schema.json"]);
    expect(pkg.files).toEqual([
      "dist", "schema", "README.md", "PERSISTENCE-CONTRACT.md", "CLAUDE.md", "LICENSE", "NOTICE",
    ]);
    expect(pkg.publishConfig).toEqual({ access: "public", tag: "next" });
    expect(pkg.engines).toEqual({ node: ">=20.19.0", bun: ">=1.3.5" });
    expect(pkg.repository).toEqual({
      type: "git",
      url: "https://github.com/cambridgetcg/agenttool.git",
      directory: "packages/skills-yutabase",
    });
    expect(pkg.scripts.prepack).toBe("bun run ci");
  });

  test("built npm dry-run includes exports and excludes local state", () => {
    const result = Bun.spawnSync({
      cmd: ["npm", "pack", "--ignore-scripts", "--dry-run", "--json"],
      cwd: packageRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout.toString()) as Array<{ files: Array<{ path: string }> }>;
    const paths = report[0]?.files.map((file) => file.path) ?? [];
    for (const path of [
      "package.json", "dist/index.js", "dist/index.d.ts",
      "schema/skills-yutabase-input-v0.1.schema.json", "README.md",
      "PERSISTENCE-CONTRACT.md", "CLAUDE.md", "LICENSE", "NOTICE",
    ]) expect(paths).toContain(path);
    expect(paths.some((path) => path.startsWith("src/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("tests/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("scripts/"))).toBe(false);
    expect(paths.some((path) => path.includes("bun.lock"))).toBe(false);
    expect(paths.some((path) => path.includes(".env"))).toBe(false);
  });
});
