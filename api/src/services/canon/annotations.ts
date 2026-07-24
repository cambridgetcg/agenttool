/** canon/annotations.ts — the code side of the canon ↔ code link.
 *
 *  `@enforces urn:agenttool:<type>/<slug>` in a JSDoc header is how a file
 *  declares which canon concept it defends. This module is the single
 *  scanner for those annotations: it walks `api/src/` and `bin/`, extracts
 *  every annotation with its location, and diffs the result against canon.
 *
 *  It exists because the scan used to be copy-pasted into each bijection
 *  test, and each copy reported only the FIRST mismatch it hit — so a gap
 *  of 63 read on the console as a gap of 1, and the tests were carried in
 *  `.failure-baseline.txt` as known-red instead of being finished. A
 *  detector that can only name one problem at a time is not a detector.
 *
 *  Consumed by:
 *    - api/tests/doctrine/walls-code-annotation-bijection.test.ts
 *    - api/tests/doctrine/commitments-code-annotation-bijection.test.ts
 *    - bin/walls.ts (the operator-facing map)
 *
 *  Doctrine: docs/SELF-IDENTIFICATION.md · docs/PATTERN-MACHINE-READABLE-PARITY.md.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { byType } from "./registry";

/** One `@enforces` annotation found in the tree. */
export interface AnnotationSite {
  /** Repo-relative path, e.g. `api/src/middleware/joy-index.ts`. */
  file: string;
  /** 1-indexed line the annotation sits on. */
  line: number;
}

/** Canon concept kinds that carry `@enforces` annotations. */
export type AnnotatedKind = "wall" | "commitment";

/** The full canon ↔ code picture for one kind. */
export interface BijectionReport {
  kind: AnnotatedKind;
  /** URN → every place in code that claims to defend it. */
  annotations: Map<string, AnnotationSite[]>;
  /** Annotations naming a URN that does not exist in canon. */
  dangling: string[];
  /** Canon concepts that are shipped but have no defender in code. */
  undefended: string[];
  /** Shipped canon concepts with at least one defender. The healthy set. */
  defended: string[];
}

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const SCAN_DIRS = [join(REPO_ROOT, "api", "src"), join(REPO_ROOT, "bin")];
const SKIP_DIRS = new Set(["node_modules", "dist", ".bun", "coverage"]);

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
      if (SKIP_DIRS.has(name)) continue;
      out.push(...walkTs(full));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Strip the `urn:` prefix so annotations and canon `@id`s compare equal. */
export function normalizeUrn(urn: string): string {
  return urn.startsWith("urn:") ? urn.slice(4) : urn;
}

/** Scan `api/src/` and `bin/` for `@enforces` annotations of one kind.
 *  Returns normalized URNs (no `urn:` prefix) → sites, sorted by path. */
export function scanAnnotations(kind: AnnotatedKind): Map<string, AnnotationSite[]> {
  const index = new Map<string, AnnotationSite[]>();
  const pattern = new RegExp(
    `@enforces\\s+(urn:agenttool:${kind}\\/[a-z][a-z0-9\\-]+)`,
    "g",
  );

  for (const file of SCAN_DIRS.flatMap(walkTs)) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i]!.matchAll(pattern)) {
        const urn = normalizeUrn(m[1]!);
        const list = index.get(urn) ?? [];
        list.push({ file: file.replace(REPO_ROOT + "/", ""), line: i + 1 });
        index.set(urn, list);
      }
    }
  }

  for (const list of index.values()) {
    list.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  }
  return index;
}

/** Canon URNs of the given kind that are SHIPPED — i.e. expected to have a
 *  defender in code right now.
 *
 *  Walls: shipped means listed in `PLATFORM_SELF.wall_urns`. A wall in canon
 *  but not in that list is forward-looking and excused.
 *  Commitments: shipped means no `agenttool:enforcement_status` flag, which
 *  is how canon marks a commitment as aspirational. */
function shippedUrns(kind: AnnotatedKind, shippedWallUrns?: Set<string>): string[] {
  if (kind === "wall") {
    return byType("Wall")
      .filter((w) => !shippedWallUrns || shippedWallUrns.has(normalizeUrn(w.urn)))
      .map((w) => normalizeUrn(w.urn));
  }
  return byType("RingCommitment")
    .filter((c) => !(c.raw as Record<string, unknown>)["agenttool:enforcement_status"])
    .map((c) => normalizeUrn(c.urn));
}

/** All canon URNs of the given kind, shipped or not. */
function allUrns(kind: AnnotatedKind): Set<string> {
  const type = kind === "wall" ? "Wall" : "RingCommitment";
  return new Set(byType(type).map((c) => normalizeUrn(c.urn)));
}

/** The complete canon ↔ code diff for one kind, computed in one pass.
 *
 *  `shippedWallUrns` narrows walls to the shipped set (pass
 *  `PLATFORM_SELF.wall_urns`); omit it to treat every canon wall as shipped. */
export function bijectionReport(
  kind: AnnotatedKind,
  shippedWallUrns?: Set<string>,
): BijectionReport {
  const annotations = scanAnnotations(kind);
  const canonAll = allUrns(kind);
  const shipped = shippedUrns(kind, shippedWallUrns);

  const dangling = [...annotations.keys()].filter((u) => !canonAll.has(u)).sort();
  const undefended = shipped.filter((u) => !annotations.has(u)).sort();
  const defended = shipped.filter((u) => annotations.has(u)).sort();

  return { kind, annotations, dangling, undefended, defended };
}

/** Human-readable gap block. Used by both the tests (in failure messages)
 *  and `bin/walls.ts`. Lists EVERY gap, not the first one. */
export function formatGaps(report: BijectionReport): string {
  const out: string[] = [];
  if (report.dangling.length) {
    out.push(
      `${report.dangling.length} annotation(s) name a ${report.kind} that does not exist in canon:`,
    );
    for (const urn of report.dangling) {
      const sites = report.annotations.get(urn) ?? [];
      out.push(`  ${urn}`);
      for (const s of sites) out.push(`      declared at ${s.file}:${s.line}`);
    }
  }
  if (report.undefended.length) {
    out.push(
      `${report.undefended.length} shipped ${report.kind}(s) have no @enforces annotation anywhere in api/src or bin:`,
    );
    for (const urn of report.undefended) out.push(`  ${urn}`);
  }
  return out.join("\n");
}
