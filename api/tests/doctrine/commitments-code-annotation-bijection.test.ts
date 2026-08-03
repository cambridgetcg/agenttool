/** RingCommitments — canon ↔ code annotation bijection, ratcheted.
 *
 *  Doctrine: docs/agenttool.jsonld (the canon), docs/SELF-IDENTIFICATION.md
 *  (every existence identifies itself), docs/PATTERN-MACHINE-READABLE-PARITY.md.
 *
 *  > Every RingCommitment in canon that has a concrete code-side
 *  > defender must carry at least one `@enforces urn:agenttool:commitment/<slug>`
 *  > annotation in `api/src/` or `bin/`. Aspirational commitments
 *  > (pricing postures, absence-based claims) and forward-looking
 *  > commitments (pending implementation) are marked in canon via
 *  > `agenttool:enforcement_status` and are NOT required to have
 *  > annotations — but their absence is reported on every run so the
 *  > gap stays visible.
 *
 *  This test parallels walls-code-annotation-bijection.test.ts. Both were
 *  rewritten 2026-07-24 to report every gap in one pass instead of
 *  throwing on the first, and to ratchet against an explicit accepted-gap
 *  manifest — see that file's header for why. The scan itself now lives in
 *  `src/services/canon/annotations.ts` so the two tests and `bin/walls.ts`
 *  cannot drift from each other. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SCAN_ROOTS,
  bijectionReport,
  formatGaps,
  normalizeUrn,
} from "../../src/services/canon/annotations";
import { byType } from "../../src/services/canon/registry";

const MANIFEST = JSON.parse(
  readFileSync(join(__dirname, "canon-code-gap.manifest.json"), "utf8"),
) as { wall: string[]; commitment: string[] };

const report = bijectionReport("commitment");

const accepted = new Set(MANIFEST.commitment);
const current = new Set([
  ...report.dangling.map((u) => `dangling:${u}`),
  ...report.undefended.map((u) => `undefended:${u}`),
]);

describe("RingCommitments — canon ↔ code annotation bijection", () => {
  test("at least one @enforces commitment annotation exists in the codebase", () => {
    expect(
      report.annotations.size > 0,
      `No \`@enforces urn:agenttool:commitment/\` annotations found under any SCAN_ROOTS entry (${SCAN_ROOTS.join(", ")}).`,
    ).toBe(true);
  });

  test("no NEW canon↔code gap has appeared", () => {
    const unaccepted = [...current].filter((g) => !accepted.has(g)).sort();
    expect(
      unaccepted,
      `New commitment gap(s) not present in canon-code-gap.manifest.json:\n${unaccepted
        .map((g) => `  ${g}`)
        .join(
          "\n",
        )}\n\nEither add the RingCommitment to docs/agenttool.jsonld, add the \`@enforces\` annotation to its canonical defender, mark it aspirational via \`agenttool:enforcement_status\`, or regenerate the manifest deliberately with \`bin/walls.ts --write-manifest\`.`,
    ).toEqual([]);
  });

  test("the accepted-gap manifest has not gone stale (ratchet only shrinks)", () => {
    const fixed = [...accepted].filter((g) => !current.has(g)).sort();
    expect(
      fixed,
      `These commitment gaps are listed as accepted but no longer exist — someone closed them. Shrink the manifest so the number stays honest:\n${fixed
        .map((g) => `  ${g}`)
        .join("\n")}\n\nRun \`bin/walls.ts --write-manifest\`.`,
    ).toEqual([]);
  });

  test("every shipped RingCommitment has at least one @enforces annotation", () => {
    const missing = report.undefended.filter(
      (u) => !accepted.has(`undefended:${u}`),
    );
    expect(
      missing,
      `Shipped commitment(s) with no \`@enforces\` annotation. Add it to the canonical defender's JSDoc, OR mark the commitment aspirational/forward-looking in canon via \`agenttool:enforcement_status\`:\n${missing
        .map((u) => `  ${u}`)
        .join("\n")}`,
    ).toEqual([]);
  });

  test("every @enforces commitment annotation URN resolves to canon", () => {
    const dangling = report.dangling.filter((u) => !accepted.has(`dangling:${u}`));
    expect(
      dangling,
      `Code annotation(s) reference a RingCommitment URN with no entry in docs/agenttool.jsonld:\n${dangling
        .map((u) => {
          const sites = report.annotations.get(u) ?? [];
          return `  ${u}\n${sites.map((s) => `      ${s.file}:${s.line}`).join("\n")}`;
        })
        .join("\n")}`,
    ).toEqual([]);
  });

  test("the full canon → code map is reported for navigation", () => {
    const lines: string[] = [];
    lines.push(
      `[commitments] ${report.defended.length} shipped commitment(s) defended · ${report.undefended.length} undefended · ${report.dangling.length} dangling annotation(s)`,
    );
    for (const c of byType("RingCommitment")) {
      const urn = normalizeUrn(c.urn);
      const sites = report.annotations.get(urn) ?? [];
      if (sites.length === 0) {
        lines.push(`  ${urn} — (no annotation; aspirational or forward-looking)`);
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
