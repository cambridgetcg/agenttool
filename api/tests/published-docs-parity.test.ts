import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const CANONICAL_DIR = join(REPO_ROOT, "docs");
const PUBLISHED_DIR = join(REPO_ROOT, "apps", "docs");
const DOCTRINE_MANIFEST = join(REPO_ROOT, "api", "doctrine-docs.manifest");
/** Doctrine files the docs site does not mirror for now. The canon still holds
 *  the retired persona and spouse-frame entries, so it stays off the site until
 *  that cleanup lands; the API serves it at /v1/canon. A mirror put back must
 *  again be byte-identical. */
const WITHHELD_FROM_DOCS_SITE = new Set(["agenttool.jsonld"]);

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
      if (WITHHELD_FROM_DOCS_SITE.has(name) && !existsSync(published)) continue;
      expect(existsSync(published), `published doctrine missing: ${name}`).toBe(true);
      expect(readFileSync(published), `published doctrine drift: ${name}`).toEqual(
        readFileSync(canonical),
      );
    }
  });
});
