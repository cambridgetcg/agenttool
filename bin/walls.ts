#!/usr/bin/env bun
/** walls — the canon ↔ code map, on demand.
 *
 *  Canon says what agenttool refuses to do. `@enforces` annotations say
 *  which file refuses it. This prints the join, so the question "where in
 *  code is this defended?" has an answer that is not a grep.
 *
 *  Usage:
 *    bin/walls.ts                    # the map: every shipped wall → its defenders
 *    bin/walls.ts --gaps             # only the gaps (exit 1 if any are unaccepted)
 *    bin/walls.ts --commitments      # same, for RingCommitments
 *    bin/walls.ts --all              # walls + commitments
 *    bin/walls.ts --json             # machine-readable
 *    bin/walls.ts --write-manifest   # rewrite the accepted-gap manifest (ratchet)
 *
 *  On --write-manifest: the manifest is the list of gaps that already
 *  existed when the ratchet was installed. It may only ever SHRINK. The
 *  doctrine tests fail on any gap not in it, and fail again if a gap in it
 *  has been fixed without removing the entry — so closing a gap forces the
 *  number down and nothing can quietly re-open one.
 *
 *  Doctrine: docs/SELF-IDENTIFICATION.md · docs/PATTERN-MACHINE-READABLE-PARITY.md.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  bijectionReport,
  formatGaps,
  normalizeUrn,
  type AnnotatedKind,
  type BijectionReport,
} from "../api/src/services/canon/annotations";
import { byType } from "../api/src/services/canon/registry";
import { PLATFORM_SELF } from "../api/src/services/wake/platform-self";

const MANIFEST_PATH = join(
  import.meta.dir,
  "..",
  "api",
  "tests",
  "doctrine",
  "canon-code-gap.manifest.json",
);

const argv = new Set(process.argv.slice(2));
const wantJson = argv.has("--json");
const wantGapsOnly = argv.has("--gaps");
const wantWrite = argv.has("--write-manifest");
const kinds: AnnotatedKind[] = argv.has("--all")
  ? ["wall", "commitment"]
  : argv.has("--commitments")
    ? ["commitment"]
    : ["wall"];

const shippedWallUrns = new Set(PLATFORM_SELF.wall_urns.map(normalizeUrn));

function reportFor(kind: AnnotatedKind): BijectionReport {
  return bijectionReport(kind, kind === "wall" ? shippedWallUrns : undefined);
}

function printMap(report: BijectionReport): void {
  const type = report.kind === "wall" ? "Wall" : "RingCommitment";
  const concepts = byType(type);
  const label = report.kind === "wall" ? "WALLS" : "COMMITMENTS";

  console.log(`\n━━━ ${label} — canon ↔ code ━━━\n`);

  let defended = 0;
  let forwardLooking = 0;
  for (const c of concepts.sort((a, b) => a.urn.localeCompare(b.urn))) {
    const urn = normalizeUrn(c.urn);
    const sites = report.annotations.get(urn) ?? [];
    const shipped =
      report.kind === "wall" ? shippedWallUrns.has(urn) : report.defended.includes(urn) || report.undefended.includes(urn);

    if (sites.length) {
      defended++;
      console.log(`  ✓ ${urn}`);
      if (c.english_name) console.log(`      ${c.english_name}`);
      for (const s of sites) console.log(`      → ${s.file}:${s.line}`);
    } else if (shipped) {
      console.log(`  ✗ ${urn}  — SHIPPED, NO DEFENDER`);
      if (c.english_name) console.log(`      ${c.english_name}`);
    } else {
      forwardLooking++;
    }
  }

  console.log(
    `\n  ${defended} defended · ${report.undefended.length} shipped-undefended · ${forwardLooking} forward-looking · ${report.dangling.length} dangling annotation(s)`,
  );
}

function currentGaps(report: BijectionReport): string[] {
  return [
    ...report.dangling.map((u) => `dangling:${u}`),
    ...report.undefended.map((u) => `undefended:${u}`),
  ].sort();
}

// ── --write-manifest ────────────────────────────────────────────────────

if (wantWrite) {
  const manifest: Record<string, string[]> = {};
  for (const kind of ["wall", "commitment"] as AnnotatedKind[]) {
    manifest[kind] = currentGaps(reportFor(kind));
  }
  const total = Object.values(manifest).reduce((n, g) => n + g.length, 0);
  writeFileSync(
    MANIFEST_PATH,
    JSON.stringify(
      {
        _comment:
          "Accepted canon↔code gaps. This list may only SHRINK. A gap not listed here fails the doctrine tests; a gap listed here that has been fixed ALSO fails, so closing one forces the number down. Regenerate deliberately with `bin/walls.ts --write-manifest`, never to make a red build green.",
        _generated_by: "bin/walls.ts --write-manifest",
        _total: total,
        ...manifest,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`wrote ${MANIFEST_PATH}`);
  console.log(`accepted gaps: ${total}`);
  process.exit(0);
}

// ── report ──────────────────────────────────────────────────────────────

const reports = kinds.map(reportFor);

if (wantJson) {
  console.log(
    JSON.stringify(
      reports.map((r) => ({
        kind: r.kind,
        defended: r.defended,
        undefended: r.undefended,
        dangling: r.dangling,
        annotations: Object.fromEntries(r.annotations),
      })),
      null,
      2,
    ),
  );
  process.exit(0);
}

let anyGap = false;
for (const report of reports) {
  if (!wantGapsOnly) printMap(report);
  const gaps = formatGaps(report);
  if (gaps) {
    anyGap = true;
    console.log(`\n━━━ ${report.kind.toUpperCase()} GAPS ━━━\n`);
    console.log(gaps);
  }
}

if (anyGap && wantGapsOnly) process.exit(1);
