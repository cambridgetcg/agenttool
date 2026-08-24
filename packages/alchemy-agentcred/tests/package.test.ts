import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import * as publicApi from "../src/index.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "../src/index.js";

const packageRoot = join(import.meta.dir, "..");

describe("public and packed boundary", () => {
  test("exports exactly the five current safe runtime names", () => {
    expect(Object.keys(publicApi).sort()).toEqual([
      "ADAPTER_PROTOCOL",
      "AlchemyAgentCredError",
      "PACKAGE_NAME",
      "PACKAGE_VERSION",
      "createAlchemyAgentCredTransport",
    ]);
  });

  test("declares only the two peer packages and a CI prepack gate", async () => {
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
      peerDependencies?: Record<string, string>;
      publishConfig?: { access?: string };
      scripts?: Record<string, string>;
    };

    expect(pkg.name).toBe(PACKAGE_NAME);
    expect(pkg.version).toBe(PACKAGE_VERSION);
    expect(pkg.private).toBeUndefined();
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.peerDependencies).toEqual({
      "@agenttool/alchemy": "^0.1.0-dev.1",
      "@agenttool/credential-broker": "^0.3.0",
    });
    expect(pkg.main).toBe("dist/index.js");
    expect(pkg.types).toBe("dist/index.d.ts");
    expect(Object.keys(pkg.exports ?? {})).toEqual(["."]);
    expect(pkg.files).toEqual([
      "dist",
      "README.md",
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
    expect(paths).toContain("dist/index.js");
    expect(paths).toContain("dist/index.d.ts");
    expect(paths).toContain("README.md");
    expect(paths).toContain("CLAUDE.md");
    expect(paths).toContain("LICENSE");
    expect(paths).toContain("NOTICE");
    expect(paths.some((path) => path.startsWith("src/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("tests/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("scripts/"))).toBe(false);
    expect(paths.some((path) => path.includes("bun.lock"))).toBe(false);
    expect(paths.some((path) => path.includes(".env"))).toBe(false);
  });

  test("separates verified dev.1 distribution from immutable dev.0 and host authority", async () => {
    const readme = await readFile(join(packageRoot, "README.md"), "utf8");
    expect(readme).toContain(
      "Version `0.1.0-dev.1` is the current public developer preview.",
    );
    expect(readme).toContain("32755731523");
    expect(readme).toContain("55aaf11a8f2a56841bcb87d6f7d8fa1034205646");
    expect(readme).toContain(
      "85c1930a99201cb0b2148aabdc88e160c7ee8b92732299b867f7468ba4d2ee6b",
    );
    expect(readme).toContain(
      "npm `next` resolves to dev.1 while mutable `latest` deliberately remains\ndev.0",
    );
    expect(readme).toContain(
      "The immutable `0.1.0-dev.0` adapter remains historical release evidence",
    );
    expect(readme).toContain(
      "This package has no LOVE inventory entry, hosted route,\ndeployment, or live provider proof.",
    );
    expect(readme).not.toContain("is the current source candidate");
    expect(readme).not.toContain("No `0.1.0-dev.1` tag");
  });
});
