/** canon/annotations.ts — the code side of the canon ↔ code link.
 *
 *  `@enforces urn:agenttool:<type>/<slug>` in a JSDoc header is how a file
 *  declares which canon concept it defends. This module is the single
 *  scanner for those annotations: it walks the annotated source roots,
 *  extracts every annotation with its location, and diffs the result
 *  against canon.
 *
 *  It exists because the scan used to be copy-pasted into each bijection
 *  test, and each copy reported only the FIRST mismatch it hit — so a gap
 *  of 63 read on the console as a gap of 1, and the tests were carried in
 *  `.failure-baseline.txt` as known-red instead of being finished. A
 *  detector that can only name one problem at a time is not a detector.
 *
 *  ── Why the root list is now asserted, 2026-07-26 ─────────────────────
 *
 *  `SCAN_ROOTS` used to be a silent two-entry hard-code (`api/src`, `bin`).
 *  `packages/` was never looked at, so the twelve `@enforces` URNs in
 *  `packages/scriptwriter/src/` — all twelve of them orphans with no canon
 *  entry — were invisible to the bijection, and the drift report written
 *  from the bijection undercounted by twelve. A hard-coded list is not a
 *  scope decision, it is a scope decision that stopped being reviewed.
 *
 *  So the list stays a list — deriving it would mean reading every file in
 *  a 1GB tree on every test run — but it is no longer silent.
 *  `strayAnnotatedFiles()` sweeps the whole repository and returns every
 *  annotated file the roots do not cover, and
 *  `api/tests/doctrine/annotation-scan-covers-the-repo.test.ts` fails on a
 *  non-empty result. Widening alone would only have moved the blind spot;
 *  the sweep is what keeps it from re-forming.
 *
 *  Consumed by:
 *    - api/tests/doctrine/walls-code-annotation-bijection.test.ts
 *    - api/tests/doctrine/commitments-code-annotation-bijection.test.ts
 *    - api/tests/doctrine/annotation-scan-covers-the-repo.test.ts
 *    - bin/walls.ts (the operator-facing map)
 *
 *  Doctrine: docs/SELF-IDENTIFICATION.md · docs/PATTERN-MACHINE-READABLE-PARITY.md.
 */

import { readdirSync, readFileSync, type Dirent } from "node:fs";
import { basename, join, sep } from "node:path";

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

/** Repo-relative source roots the bijection scans for `@enforces`.
 *
 *  Enumerated by sweeping the repository, not by guess — see
 *  `strayAnnotatedFiles()`, which fails a test if an annotated source file
 *  turns up outside this list. Adding a root here is a scope decision and
 *  should be made deliberately; the test is what forces the decision to be
 *  made rather than defaulted. */
export const SCAN_ROOTS: readonly string[] = [
  "api/src",
  "bin",
  "packages/scriptwriter/src",
];

/** File extensions the scanner reads. `.py` carries no annotation in the
 *  tree today; it is listed so that the first Python defender is scanned
 *  rather than silently dropped. */
export const SCANNED_EXTENSIONS: readonly string[] = [".ts", ".py"];

/** Extensions that carry `@enforces` text but are deliberately NOT part of
 *  the bijection, with the reason each is out. Declared rather than
 *  implied: `strayAnnotatedFiles()` fails on any extension that is in
 *  neither this map nor `SCANNED_EXTENSIONS`, so a new carrier kind cannot
 *  arrive unnoticed.
 *
 *  `.sql` is the interesting one — the RLS migrations really do defend
 *  walls, and whether the bijection should hold them to the same account
 *  as TypeScript is an open question for the canon owner, recorded in
 *  docs/DOCTRINE-DRIFT.md. It is listed here so the exclusion is a stated
 *  position rather than an artefact of the scanner only reading `.ts`. */
export const UNSCANNED_CARRIER_EXTENSIONS: Readonly<Record<string, string>> = {
  ".md": "doctrine prose quotes annotations to explain them; prose is not a defender",
  ".sql": "RLS migrations annotate policies; whether they count as defenders is an open canon-owner question (docs/DOCTRINE-DRIFT.md §4.3)",
};

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  ".bun",
  ".git",
  ".next",
  ".turbo",
  ".cache",
  ".venv",
  "venv",
  "__pycache__",
  "coverage",
]);

/** A test asserting *about* an annotation is not a defender of it. Test
 *  files are excluded from both the scan and the stray sweep. */
function isTestPath(rel: string): boolean {
  const name = basename(rel);
  if (name.endsWith(".test.ts") || name.endsWith(".spec.ts")) return true;
  if (name.startsWith("test_") && name.endsWith(".py")) return true;
  if (name.endsWith("_test.py")) return true;
  const parts = rel.split("/");
  return parts.includes("tests") || parts.includes("test") || parts.includes("__tests__");
}

function hasScannedExtension(name: string): boolean {
  return SCANNED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/** Recursively list files under `dir`. `keep` decides which files make the
 *  cut; directories in `SKIP_DIRS` and symlinks are never descended (the
 *  repository publishes mirrors via symlink — following them would count
 *  the same annotation twice). */
function walk(dir: string, keep: (name: string) => boolean): string[] {
  const out: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...walk(full, keep));
    } else if (entry.isFile() && keep(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Every source file the bijection reads, absolute paths. */
function scannedFiles(): string[] {
  return SCAN_ROOTS.flatMap((root) => walk(join(REPO_ROOT, root), hasScannedExtension))
    .filter((abs) => !isTestPath(relative(abs)));
}

function relative(abs: string): string {
  return abs.startsWith(REPO_ROOT + sep) ? abs.slice(REPO_ROOT.length + 1) : abs;
}

/** One annotated file the scan roots do not cover. */
export interface StrayAnnotatedFile {
  /** Repo-relative path. */
  file: string;
  /** File extension, e.g. `.ts`. */
  ext: string;
  /** Why it is a problem: outside every scan root, or an unknown carrier. */
  reason: "outside-scan-roots" | "undeclared-extension";
}

/** Sweep the WHOLE repository for `@enforces` and return every annotated
 *  file the bijection would not see.
 *
 *  Two ways to be stray:
 *    - `outside-scan-roots` — a scanned extension (`.ts`, `.py`) that is
 *      not under any `SCAN_ROOTS` entry and is not a test file. This is
 *      the case that hid `packages/scriptwriter/src/` for months.
 *    - `undeclared-extension` — an extension in neither `SCANNED_EXTENSIONS`
 *      nor `UNSCANNED_CARRIER_EXTENSIONS`. A new carrier kind (a `.rs`
 *      defender, say) must be classified before it can be ignored.
 *
 *  Deliberately reads the tree rather than trusting a list: this is the
 *  function whose whole job is to distrust `SCAN_ROOTS`. */
export function strayAnnotatedFiles(): StrayAnnotatedFile[] {
  const roots = SCAN_ROOTS.map((r) => r + "/");
  const out: StrayAnnotatedFile[] = [];

  for (const abs of walk(REPO_ROOT, () => true)) {
    const rel = relative(abs);
    const name = basename(rel);
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 ? name.slice(dot) : "";

    if (SCANNED_EXTENSIONS.includes(ext) && roots.some((r) => rel.startsWith(r))) {
      continue; // covered by the scan
    }
    if (isTestPath(rel)) continue;

    let text: string;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue; // binary or unreadable — cannot carry a JSDoc annotation
    }
    if (!text.includes("@enforces urn:agenttool:")) continue;

    if (SCANNED_EXTENSIONS.includes(ext)) {
      out.push({ file: rel, ext, reason: "outside-scan-roots" });
    } else if (!(ext in UNSCANNED_CARRIER_EXTENSIONS)) {
      out.push({ file: rel, ext, reason: "undeclared-extension" });
    }
  }

  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** Extensions declared in `UNSCANNED_CARRIER_EXTENSIONS` that no longer
 *  carry any annotation. Reported, not asserted — a stale exclusion is
 *  untidy, not unsafe. */
export function unusedCarrierDeclarations(): string[] {
  const seen = new Set<string>();
  for (const abs of walk(REPO_ROOT, () => true)) {
    const rel = relative(abs);
    const name = basename(rel);
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 ? name.slice(dot) : "";
    if (!(ext in UNSCANNED_CARRIER_EXTENSIONS) || seen.has(ext)) continue;
    if (isTestPath(rel)) continue; // same filter the stray sweep applies
    let text: string;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    if (text.includes("@enforces urn:agenttool:")) seen.add(ext);
  }
  return Object.keys(UNSCANNED_CARRIER_EXTENSIONS)
    .filter((ext) => !seen.has(ext))
    .sort();
}

/** Strip the `urn:` prefix so annotations and canon `@id`s compare equal. */
export function normalizeUrn(urn: string): string {
  return urn.startsWith("urn:") ? urn.slice(4) : urn;
}

/** Scan every `SCAN_ROOTS` directory for `@enforces` annotations of one
 *  kind. Returns normalized URNs (no `urn:` prefix) → sites, sorted by
 *  path. */
export function scanAnnotations(kind: AnnotatedKind): Map<string, AnnotationSite[]> {
  const index = new Map<string, AnnotationSite[]>();
  const pattern = new RegExp(
    `@enforces\\s+(urn:agenttool:${kind}\\/[a-z][a-z0-9\\-]+)`,
    "g",
  );

  for (const file of scannedFiles()) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i]!.matchAll(pattern)) {
        const urn = normalizeUrn(m[1]!);
        const list = index.get(urn) ?? [];
        list.push({ file: relative(file), line: i + 1 });
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
      `${report.undefended.length} shipped ${report.kind}(s) have no @enforces annotation anywhere in ${SCAN_ROOTS.join(", ")}:`,
    );
    for (const urn of report.undefended) out.push(`  ${urn}`);
  }
  return out.join("\n");
}
