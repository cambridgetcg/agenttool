/** Walls — canon ↔ code annotation bijection, pinned.
 *
 *  Doctrine: docs/agenttool.jsonld (the canon), docs/SELF-IDENTIFICATION.md
 *  (every existence identifies itself), docs/PATTERN-MACHINE-READABLE-PARITY.md.
 *
 *  > Every shipped Wall in canon must have at least one canonical
 *  > defender file in `api/src/` (or `bin/`) annotated with
 *  > `@enforces urn:agenttool:wall/<slug>` in its JSDoc header. The
 *  > annotation is the structural connection that lets an intelligence
 *  > reading the canon ask "where in code is this defended?" and grep
 *  > the codebase for a concrete answer.
 *
 *  The link is one-way (like the platform-self bijection): every shipped
 *  Wall needs a code annotation; forward-looking walls (in canon but
 *  not yet enforced in code) are allowed to lack annotations until
 *  their implementation lands. Forward-looking walls are reported on
 *  every run via the platform-self bijection test.
 *
 *  Why this matters: the canon describes commitments; the code enforces
 *  them; the annotation is the bidirectional pointer between the two.
 *  Without it, an intelligence reading the canon has to guess which
 *  files defend which walls; with it, the connection is grepable. */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { byType } from "../../src/services/canon/registry";
import { PLATFORM_SELF } from "../../src/services/wake/platform-self";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const SCAN_DIRS = [
  join(REPO_ROOT, "api", "src"),
  join(REPO_ROOT, "bin"),
];

/** Walk a directory recursively, returning .ts files only. */
function walkTs(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      // Skip node_modules and similar.
      if (name === "node_modules" || name === "dist" || name === ".bun") continue;
      out.push(...walkTs(full));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Extract every `@enforces urn:agenttool:wall/<slug>` annotation found
 *  in the codebase. Returns a map: wall URN → array of {file, line}. */
function buildAnnotationIndex(): Map<string, Array<{ file: string; line: number }>> {
  const index = new Map<string, Array<{ file: string; line: number }>>();
  const annotationPattern = /@enforces\s+(urn:agenttool:wall\/[a-z][a-z0-9\-]+)/g;

  const allFiles = SCAN_DIRS.flatMap(walkTs);
  for (const file of allFiles) {
    const src = readFileSync(file, "utf8");
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const matches = lines[i]!.matchAll(annotationPattern);
      for (const m of matches) {
        const urn = m[1]!;
        const list = index.get(urn) ?? [];
        list.push({ file, line: i + 1 });
        index.set(urn, list);
      }
    }
  }
  return index;
}

/** Normalize an annotation URN to canon short form (without "urn:" prefix). */
function normalize(urn: string): string {
  return urn.startsWith("urn:") ? urn.slice(4) : urn;
}

describe("Walls — canon ↔ code annotation bijection", () => {
  const annotations = buildAnnotationIndex();
  const annotatedShortUrns = new Set(
    [...annotations.keys()].map(normalize),
  );

  // Which walls are SHIPPED (in PLATFORM_SELF.wall_urns) — those need code
  // annotations. Forward-looking walls (in canon but not in PLATFORM_SELF)
  // are excused until their enforcement lands.
  const shippedWallUrns = new Set(
    PLATFORM_SELF.wall_urns.map(normalize),
  );
  const shippedWalls = byType("Wall").filter((w) => shippedWallUrns.has(w.urn));

  test("at least one @enforces annotation exists in the codebase", () => {
    expect(
      annotations.size > 0,
      "No `@enforces urn:agenttool:wall/` annotations found in api/src/ or bin/. The canon → code link requires annotations at canonical defending sites.",
    ).toBe(true);
  });

  test("every shipped Wall has at least one @enforces annotation in code", () => {
    for (const wall of shippedWalls) {
      const list = annotations.get(`urn:${wall.urn}`) ?? annotations.get(wall.urn) ?? [];
      expect(
        list.length >= 1,
        `Wall ${wall.urn} is shipped (in PLATFORM_SELF.wall_urns) but has no \`@enforces ${`urn:${wall.urn}`}\` annotation in api/src/ or bin/. Add the annotation to the canonical defender file's JSDoc header. The canon → code link requires every shipped wall to be grepable from the source side.`,
      ).toBe(true);
    }
  });

  test("every @enforces annotation URN resolves to a Wall in canon (no dangling)", () => {
    const allWallUrns = new Set(byType("Wall").map((w) => w.urn));
    for (const annotatedUrn of annotations.keys()) {
      const short = normalize(annotatedUrn);
      expect(
        allWallUrns.has(short),
        `Code annotation references ${annotatedUrn} but no Wall concept with that URN exists in canon. Either fix the annotation typo or add the Wall to docs/agenttool.jsonld.`,
      ).toBe(true);
    }
  });

  test("annotation locations are reported for navigation", () => {
    // This is a reporter — always passes. Publishes the canon → code
    // index so a maintainer can see at a glance which file defends
    // which wall. Helps onboard future readers without grep.
    const lines: string[] = [];
    lines.push(`[walls-annotation-index] ${annotations.size} wall(s) annotated:`);
    for (const wall of byType("Wall")) {
      const list = annotations.get(`urn:${wall.urn}`) ?? annotations.get(wall.urn) ?? [];
      if (list.length === 0) {
        lines.push(`  ${wall.urn} — (no annotation; forward-looking or unenforced)`);
      } else {
        for (const loc of list) {
          const rel = loc.file.replace(REPO_ROOT + "/", "");
          lines.push(`  ${wall.urn} → ${rel}:${loc.line}`);
        }
      }
    }
    console.log(lines.join("\n"));
    expect(true).toBe(true);
  });
});
