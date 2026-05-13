/** RingCommitments — canon ↔ code annotation bijection, pinned.
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
 *  This test parallels walls-code-annotation-bijection.test.ts. Same
 *  structure: scan source files, build index by URN, gate shipped
 *  entries, report unenforced ones. */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { byType } from "../../src/services/canon/registry";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const SCAN_DIRS = [
  join(REPO_ROOT, "api", "src"),
  join(REPO_ROOT, "bin"),
];

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
      if (name === "node_modules" || name === "dist" || name === ".bun") continue;
      out.push(...walkTs(full));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

function buildAnnotationIndex(): Map<string, Array<{ file: string; line: number }>> {
  const index = new Map<string, Array<{ file: string; line: number }>>();
  const annotationPattern = /@enforces\s+(urn:agenttool:commitment\/[a-z][a-z0-9\-]+)/g;
  for (const file of SCAN_DIRS.flatMap(walkTs)) {
    const src = readFileSync(file, "utf8");
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i]!.matchAll(annotationPattern)) {
        const urn = m[1]!;
        const list = index.get(urn) ?? [];
        list.push({ file, line: i + 1 });
        index.set(urn, list);
      }
    }
  }
  return index;
}

function normalize(urn: string): string {
  return urn.startsWith("urn:") ? urn.slice(4) : urn;
}

describe("RingCommitments — canon ↔ code annotation bijection", () => {
  const annotations = buildAnnotationIndex();
  const commitments = byType("RingCommitment");

  // Split commitments by enforcement_status. Default (no field) =
  // shipped — must have an annotation. "aspirational" / "forward-looking"
  // = not required to have an annotation (reported only).
  const shipped: typeof commitments = [];
  const aspirational: typeof commitments = [];
  const forwardLooking: typeof commitments = [];
  for (const c of commitments) {
    const status = c.raw["agenttool:enforcement_status"];
    if (status === "aspirational") aspirational.push(c);
    else if (status === "forward-looking") forwardLooking.push(c);
    else shipped.push(c);
  }

  test("at least one @enforces commitment annotation exists in the codebase", () => {
    expect(
      annotations.size > 0,
      "No `@enforces urn:agenttool:commitment/` annotations found. Adding annotations is the canon → code link.",
    ).toBe(true);
  });

  test("every shipped RingCommitment has at least one @enforces annotation", () => {
    for (const c of shipped) {
      const list = annotations.get(`urn:${c.urn}`) ?? annotations.get(c.urn) ?? [];
      expect(
        list.length >= 1,
        `Commitment ${c.urn} is shipped (no enforcement_status flag) but has no \`@enforces urn:${c.urn}\` annotation in api/src/ or bin/. Either add the annotation to the canonical defender file's JSDoc, OR mark the commitment as "aspirational" / "forward-looking" in canon via agenttool:enforcement_status.`,
      ).toBe(true);
    }
  });

  test("every @enforces commitment annotation URN resolves to canon", () => {
    const allCommitmentUrns = new Set(commitments.map((c) => c.urn));
    for (const annotatedUrn of annotations.keys()) {
      const short = normalize(annotatedUrn);
      expect(
        allCommitmentUrns.has(short),
        `Annotation references ${annotatedUrn} but no RingCommitment with that URN exists in canon.`,
      ).toBe(true);
    }
  });

  test("annotation locations are reported for navigation", () => {
    const lines: string[] = [];
    lines.push(
      `[commitments-annotation-index] ${shipped.length} shipped · ${aspirational.length} aspirational · ${forwardLooking.length} forward-looking · ${commitments.length} total`,
    );
    for (const c of commitments) {
      const list = annotations.get(`urn:${c.urn}`) ?? annotations.get(c.urn) ?? [];
      const status = c.raw["agenttool:enforcement_status"] ?? "shipped";
      if (list.length === 0) {
        lines.push(`  ${c.urn} [${status}] — no annotation`);
      } else {
        for (const loc of list) {
          const rel = loc.file.replace(REPO_ROOT + "/", "");
          lines.push(`  ${c.urn} [${status}] → ${rel}:${loc.line}`);
        }
      }
    }
    console.log(lines.join("\n"));
    expect(true).toBe(true);
  });
});
