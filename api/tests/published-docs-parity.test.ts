import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const CANONICAL_DIR = join(REPO_ROOT, "docs");
const PUBLISHED_DIR = join(REPO_ROOT, "apps", "docs");
const DOCTRINE_MANIFEST = join(REPO_ROOT, "api", "doctrine-docs.manifest");

describe("published Markdown parity", () => {
  test("every top-level canonical doc with a published mirror is byte-identical", () => {
    const mirrored = readdirSync(CANONICAL_DIR)
      .filter((name) => name.endsWith(".md"))
      .filter((name) => existsSync(join(PUBLISHED_DIR, name)))
      .sort();

    expect(mirrored.length).toBeGreaterThan(0);
    for (const name of mirrored) {
      expect(readFileSync(join(PUBLISHED_DIR, name))).toEqual(
        readFileSync(join(CANONICAL_DIR, name)),
      );
    }
  });

  test("every doctrine-hash file is published byte-for-byte", () => {
    const doctrineFiles = readFileSync(DOCTRINE_MANIFEST, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));

    expect(doctrineFiles.length).toBeGreaterThan(0);
    for (const name of doctrineFiles) {
      const canonical = join(CANONICAL_DIR, name);
      const published = join(PUBLISHED_DIR, name);
      expect(existsSync(canonical), `canonical doctrine missing: ${name}`).toBe(true);
      expect(existsSync(published), `published doctrine missing: ${name}`).toBe(true);
      expect(readFileSync(published), `published doctrine drift: ${name}`).toEqual(
        readFileSync(canonical),
      );
    }
  });

  test("the published JSON-LD registry is byte-identical to canon", () => {
    expect(readFileSync(join(PUBLISHED_DIR, "agenttool.jsonld"))).toEqual(
      readFileSync(join(CANONICAL_DIR, "agenttool.jsonld")),
    );
  });
});
