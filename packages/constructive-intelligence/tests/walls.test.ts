import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

test("runtime has no network client, provider SDK, or runtime dependency", () => {
  const root = join(import.meta.dir, "..");
  const source = readdirSync(join(root, "src"))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => readFileSync(join(root, "src", name), "utf8"))
    .join("\n");
  expect(source).not.toMatch(/from ["'](?:node:)?(?:http|https|net|tls|dns|dgram)/u);
  expect(source).not.toMatch(/\bfetch\s*\(/u);
  expect(source).not.toMatch(/\bWebSocket\b/u);
  expect(source).not.toMatch(
    /(?:node:child_process|\bBun\.spawn|\bexecFile|\bexecSync|\bspawnSync)/u,
  );

  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    private?: boolean;
    dependencies?: Record<string, string>;
    publishConfig?: unknown;
    scripts?: Record<string, string>;
  };
  expect(manifest.private).toBe(true);
  expect(manifest.dependencies).toBeUndefined();
  expect(manifest.publishConfig).toBeUndefined();
  expect(manifest.scripts?.prepack).toBeUndefined();

  const repositoryRoot = join(root, "..", "..");
  const publicationSurfaces = [
    ".github/workflows/publish-npm.yml",
    "bin/npm-release.ts",
    "bin/build-love-packages.ts",
  ].map((path) => readFileSync(join(repositoryRoot, path), "utf8"));
  for (const surface of publicationSurfaces) {
    expect(surface).not.toContain("constructive-intelligence");
  }
});
