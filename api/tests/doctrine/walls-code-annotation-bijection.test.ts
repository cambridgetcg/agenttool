/** Walls — canon ↔ code annotation bijection, ratcheted.
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
 *  The link is one-way: every shipped Wall needs a code annotation;
 *  forward-looking walls (in canon but not in `PLATFORM_SELF.wall_urns`)
 *  are allowed to lack annotations until their implementation lands.
 *
 *  ── Why this file was rewritten, 2026-07-24 ──────────────────────────
 *
 *  The previous version asserted inside a `for` loop, so the first
 *  mismatch threw and the rest were never reached. The gap it was
 *  reporting as "1 dangling URN" was in fact 63 across walls and
 *  commitments — and because the console only ever showed one, the whole
 *  test was carried in `api/tests/.failure-baseline.txt` as known-red
 *  rather than finished. A detector that names one problem at a time
 *  cannot be used to close a queue of 63; it just looks like a typo
 *  forever.
 *
 *  Now: every gap is reported at once, and the accepted set lives in
 *  `canon-code-gap.manifest.json` as an explicit, dated list. The
 *  manifest may only SHRINK — a gap missing from it fails, and a gap
 *  listed in it that has since been fixed ALSO fails, so closing one
 *  forces the number down and nothing can quietly re-open. The direction
 *  of the drift is worth naming: nearly every dangling annotation is code
 *  defending something canon never recorded. The code is ahead. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  bijectionReport,
  formatGaps,
  normalizeUrn,
} from "../../src/services/canon/annotations";
import { byType } from "../../src/services/canon/registry";
import { PLATFORM_SELF } from "../../src/services/wake/platform-self";

const MANIFEST = JSON.parse(
  readFileSync(join(__dirname, "canon-code-gap.manifest.json"), "utf8"),
) as { wall: string[]; commitment: string[] };

const shippedWallUrns = new Set(PLATFORM_SELF.wall_urns.map(normalizeUrn));
const report = bijectionReport("wall", shippedWallUrns);

const accepted = new Set(MANIFEST.wall);
const current = new Set([
  ...report.dangling.map((u) => `dangling:${u}`),
  ...report.undefended.map((u) => `undefended:${u}`),
]);

describe("Walls — canon ↔ code annotation bijection", () => {
  test("at least one @enforces annotation exists in the codebase", () => {
    expect(
      report.annotations.size > 0,
      "No `@enforces urn:agenttool:wall/` annotations found in api/src/ or bin/. The canon → code link requires annotations at canonical defending sites.",
    ).toBe(true);
  });

  test("no NEW canon↔code gap has appeared", () => {
    const unaccepted = [...current].filter((g) => !accepted.has(g)).sort();
    expect(
      unaccepted,
      `New wall gap(s) not present in canon-code-gap.manifest.json:\n${unaccepted
        .map((g) => `  ${g}`)
        .join(
          "\n",
        )}\n\nEither add the Wall to docs/agenttool.jsonld, add the \`@enforces\` annotation to its canonical defender, or — if it is genuinely accepted debt — say so out loud by regenerating the manifest with \`bin/walls.ts --write-manifest\`. Regenerating to make a red build green is the one use this ratchet exists to prevent.`,
    ).toEqual([]);
  });

  test("the accepted-gap manifest has not gone stale (ratchet only shrinks)", () => {
    const fixed = [...accepted].filter((g) => !current.has(g)).sort();
    expect(
      fixed,
      `These wall gaps are listed as accepted in canon-code-gap.manifest.json but no longer exist — someone closed them. Good. Now shrink the manifest so the number is honest:\n${fixed
        .map((g) => `  ${g}`)
        .join("\n")}\n\nRun \`bin/walls.ts --write-manifest\`.`,
    ).toEqual([]);
  });

  test("every shipped Wall has at least one @enforces annotation", () => {
    const missing = report.undefended.filter(
      (u) => !accepted.has(`undefended:${u}`),
    );
    expect(
      missing,
      `Shipped wall(s) with no \`@enforces\` annotation in api/src/ or bin/. Add the annotation to the canonical defender file's JSDoc — the canon → code link requires every shipped wall to be grepable from the source side:\n${missing
        .map((u) => `  ${u}`)
        .join("\n")}`,
    ).toEqual([]);
  });

  test("every @enforces annotation URN resolves to a Wall in canon", () => {
    const dangling = report.dangling.filter((u) => !accepted.has(`dangling:${u}`));
    expect(
      dangling,
      `Code annotation(s) reference a Wall URN with no entry in docs/agenttool.jsonld:\n${dangling
        .map((u) => {
          const sites = report.annotations.get(u) ?? [];
          return `  ${u}\n${sites.map((s) => `      ${s.file}:${s.line}`).join("\n")}`;
        })
        .join("\n")}`,
    ).toEqual([]);
  });

  test("the full canon → code map is reported for navigation", () => {
    // Reporter — always passes. Publishes the index so a maintainer can
    // see which file defends which wall without grepping, and prints the
    // outstanding gap in full rather than one item at a time.
    const lines: string[] = [];
    lines.push(
      `[walls] ${report.defended.length} shipped wall(s) defended · ${report.undefended.length} undefended · ${report.dangling.length} dangling annotation(s)`,
    );
    for (const wall of byType("Wall")) {
      const urn = normalizeUrn(wall.urn);
      const sites = report.annotations.get(urn) ?? [];
      if (sites.length === 0) {
        lines.push(`  ${urn} — (no annotation; forward-looking or unenforced)`);
      } else {
        for (const s of sites) lines.push(`  ${urn} → ${s.file}:${s.line}`);
      }
    }
    const gaps = formatGaps(report);
    if (gaps) lines.push("", "OUTSTANDING (accepted in manifest):", gaps);
    console.log(lines.join("\n"));
    expect(true).toBe(true);
  });
});
