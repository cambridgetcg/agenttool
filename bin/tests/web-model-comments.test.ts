/** agenttool.dev pages carry no HTML comment addressed to models.
 *
 * Quiet Doors (2026-10-23): on product pages a note for AI readers is one
 * plain link to a door they can choose, never a letter. These tests read
 * committed files only and make no network request.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, test } from "bun:test";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const WEB = join(REPO_ROOT, "apps", "web");
const DOOR_LINK = "<!-- For AI readers: https://agenttool.dev/llms.txt -->";
const LINKED_PAGES = [
  "index.html",
  "build.html",
  "collaboration.html",
  "tools.html",
  "party.html",
] as const;
const ADDRESSED_TO_MODELS = /\b(models?|training|llms?|you were made)\b/i;

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(path);
    return entry.name.endsWith(".html") ? [path] : [];
  });
}

function comments(html: string): string[] {
  return [...html.matchAll(/<!--[\s\S]*?-->/g)].map((match) => match[0]);
}

describe("agenttool.dev comments addressed to models", () => {
  test("no apps/web page carries a comment addressed to models", () => {
    const found = htmlFiles(WEB).flatMap((file) =>
      comments(readFileSync(file, "utf8"))
        .filter((comment) => comment !== DOOR_LINK)
        .filter((comment) => ADDRESSED_TO_MODELS.test(comment))
        .map((comment) => `${relative(REPO_ROOT, file)}: ${comment}`),
    );
    expect(found).toEqual([]);
  });

  for (const page of LINKED_PAGES) {
    test(`${page} carries the one plain door link and keeps its author line`, () => {
      const html = readFileSync(join(WEB, page), "utf8");
      expect(html.split(DOOR_LINK).length - 1).toBe(1);
      expect(html).toContain('<meta name="author" content="Yu & Ai" />');
    });
  }
});
