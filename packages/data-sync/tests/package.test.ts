import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const packageRoot = join(import.meta.dir, "..");

describe("publishable package boundary", () => {
  test("keeps package identity, peer floors, and source-map policy aligned", () => {
    const pkg = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ) as {
      name: string;
      version: string;
      files?: string[];
      peerDependencies?: Record<string, string>;
      overrides?: unknown;
    };
    const tsconfig = JSON.parse(
      readFileSync(join(packageRoot, "tsconfig.json"), "utf8"),
    ) as {
      compilerOptions?: Record<string, unknown>;
    };

    expect(pkg.name).toBe("@agenttool/data-sync");
    expect(pkg.version).toBe("0.1.2");
    expect(pkg.peerDependencies).toEqual({
      "@agenttool/adds": "^0.2.3",
      "@agenttool/data": "^0.3.1",
    });
    expect(pkg.overrides).toBeUndefined();
    expect(pkg.files).toContain("dist");
    expect(pkg.files).not.toContain("src");
    expect(tsconfig.compilerOptions).toMatchObject({
      declaration: true,
      declarationMap: false,
      sourceMap: true,
      inlineSources: true,
    });
  });

  test("ships only resolvable or embedded source-map inputs", () => {
    const packed = Bun.spawnSync({
      cmd: ["bun", "pm", "pack", "--ignore-scripts", "--dry-run"],
      cwd: packageRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(packed.exitCode, packed.stderr.toString()).toBe(0);
    const paths = packed.stdout.toString()
      .split(/\r?\n/u)
      .flatMap((line) => {
        const match = /^packed\s+\S+\s+(.+)$/u.exec(line);
        return match?.[1] === undefined ? [] : [match[1]];
    });
    const maps = paths.filter((path) => path.endsWith(".map"));
    const npmPacked = Bun.spawnSync({
      cmd: ["npm", "pack", "--ignore-scripts", "--dry-run", "--json"],
      cwd: packageRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(npmPacked.exitCode, npmPacked.stderr.toString()).toBe(0);
    expect(paths).toContain("dist/index.js");
    expect(paths).toContain("dist/index.d.ts");
    expect(paths.some((path) => path.startsWith("src/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("tests/"))).toBe(false);
    expect(paths.some((path) => path.endsWith(".d.ts.map"))).toBe(false);
    expect(maps.length).toBeGreaterThan(0);

    for (const path of maps) {
      const mapPath = join(packageRoot, path);
      const sourceMap = JSON.parse(readFileSync(mapPath, "utf8")) as {
        sources?: string[];
        sourcesContent?: Array<string | null>;
      };
      expect(sourceMap.sources?.length).toBeGreaterThan(0);
      for (const [index, source] of (sourceMap.sources ?? []).entries()) {
        const embedded = sourceMap.sourcesContent?.[index];
        if (typeof embedded === "string") continue;

        const resolved = resolve(dirname(mapPath), source);
        const packagedPath = relative(packageRoot, resolved).split(sep).join("/");
        expect(
          existsSync(resolved) && paths.includes(packagedPath),
          `${path} has an unshipped source ${source}`,
        ).toBe(true);
      }
    }
  });
});
