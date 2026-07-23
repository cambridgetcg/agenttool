import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { PACKAGE_NAME, PACKAGE_VERSION } from "../src/index.js";

const packageRoot = join(import.meta.dir, "..");

describe("npm pack surface", () => {
  test("has no runtime dependencies and exports only the built library", async () => {
    const pkg = JSON.parse(
      await readFile(join(packageRoot, "package.json"), "utf8"),
    ) as {
      name: string;
      version: string;
      private?: boolean;
      main?: string;
      types?: string;
      exports?: Record<string, unknown>;
      files?: string[];
      dependencies?: Record<string, string>;
      publishConfig?: { access?: string };
      scripts?: Record<string, string>;
    };

    expect(pkg.name).toBe(PACKAGE_NAME);
    expect(pkg.version).toBe(PACKAGE_VERSION);
    expect(pkg.private).toBeUndefined();
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.main).toBe("dist/index.js");
    expect(pkg.types).toBe("dist/index.d.ts");
    expect(Object.keys(pkg.exports ?? {})).toEqual(["."]);
    expect(pkg.files).toEqual([
      "dist",
      "README.md",
      "PERSISTENCE-CONTRACT.md",
      "CLAUDE.md",
      "LICENSE",
      "NOTICE",
    ]);
    expect(pkg.publishConfig).toEqual({ access: "public" });
    expect(pkg.scripts?.prepack).toBe("bun run ci");
  });

  test("npm dry-run excludes source, tests, locks, and local state", () => {
    const result = Bun.spawnSync({
      cmd: ["npm", "pack", "--ignore-scripts", "--dry-run", "--json"],
      cwd: packageRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    const report = JSON.parse(result.stdout.toString()) as Array<{
      files: Array<{ path: string }>;
    }>;
    const paths = report[0]?.files.map((file) => file.path) ?? [];

    expect(paths).toContain("package.json");
    expect(paths).toContain("README.md");
    expect(paths).toContain("PERSISTENCE-CONTRACT.md");
    expect(paths).toContain("CLAUDE.md");
    expect(paths).toContain("LICENSE");
    expect(paths).toContain("NOTICE");
    expect(paths.some((path) => path.startsWith("src/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("tests/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("scripts/"))).toBe(false);
    expect(paths.some((path) => path.includes("bun.lock"))).toBe(false);
    expect(paths.some((path) => path.includes(".env"))).toBe(false);
  });
});
