/** canon/absence.ts — walls defended by what a file REFUSES to import.
 *
 *  The strongest wall in this codebase is not a check. It is an absence: a
 *  module that cannot take a fee because it never imports the fee function,
 *  so the only way to break the wall is to add an import — which is visible
 *  in a diff, greppable, and reviewable. `offerings` cannot tax a gift
 *  because `recordRevenue` is not in scope. That is a wall you cannot
 *  forget to call.
 *
 *  Until now each such wall needed its own hand-written test file, so the
 *  pattern cost ~80 lines per wall and only three walls ever paid it. Six
 *  other modules claimed "defended by absence" in prose with nothing
 *  checking them — a comment describing a guarantee is not a guarantee.
 *
 *  This module makes the contract declarative and self-describing: a file
 *  states what it defends AND how, in the same JSDoc block.
 *
 *      @enforces urn:agenttool:wall/offerings-carry-no-take
 *        Defender by absence — gifts are witnessed, never settled.
 *      @absence recordRevenue computeFee platformRevenue
 *      @absence-from db/schema/economy
 *
 *  `@absence` lists symbols that must never be imported. `@absence-from`
 *  lists module specifiers (substring match) that must never be imported
 *  from. Both may repeat. Adding a codepath that breaks the wall has to add
 *  an import, and the import fails the check.
 *
 *  Scope, stated so the check is not over-trusted: this is a static import
 *  check. It cannot see a dynamic `await import()`, a re-export that
 *  launders a symbol through a third module, or a raw SQL string that does
 *  the same work without any import at all. It catches the honest mistake
 *  and the casual one, not a determined one — and it makes the wall's
 *  contract legible to a reader, which the prose version never did.
 *
 *  Doctrine: docs/SELF-IDENTIFICATION.md · docs/PATTERN-MACHINE-READABLE-PARITY.md.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { SCAN_ROOTS } from "./annotations";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
/** The same roots the `@enforces` scan walks, not a second private copy.
 *
 *  This file used to hard-code `[api/src, bin]` on its own — the identical
 *  blind spot `annotations.ts` carried until 2026-07-26, in a second place
 *  where nobody would think to look for it. Sharing the list means a future
 *  root is added once and both scanners see it. No `@absence` contract lives
 *  outside `api/src`/`bin` today, so this widening changes nothing now; it
 *  changes what happens when the first one does.
 *
 *  `SCAN_ROOTS` is repo-relative; this scanner works in absolute paths. */
const SCAN_DIRS = SCAN_ROOTS.map((root) => join(REPO_ROOT, root));
const SKIP_DIRS = new Set(["node_modules", "dist", ".bun", "coverage"]);

/** This module documents the annotation format by example, so it would
 *  otherwise parse its own doc-string as a contract. A scanner that reads
 *  itself is the one file it cannot be honest about. */
const SELF = "api/src/services/canon/absence.ts";

/** A real annotation sits at the JSDoc margin (`*  @absence …`). The
 *  examples in this file's header are indented further to read as a code
 *  block, and must not be mistaken for declarations. */
const ABSENCE_RE = /^\s*\*[ \t]{0,3}@absence[ \t]+([^\n]+)$/gm;
const ABSENCE_FROM_RE = /^\s*\*[ \t]{0,3}@absence-from[ \t]+([^\n]+)$/gm;

/** One file's declared absence contract. */
export interface AbsenceContract {
  /** Repo-relative path. */
  file: string;
  /** Canon URNs this file declares it defends (may be empty). */
  enforces: string[];
  /** Symbols that must never be imported. */
  symbols: string[];
  /** Module specifier substrings that must never be imported from. */
  modules: string[];
}

export interface AbsenceViolation {
  file: string;
  kind: "symbol" | "module";
  offender: string;
  /** The import line that broke it, trimmed. */
  line: string;
  lineNumber: number;
}

/** A `Tested: <path>` citation in a defender's JSDoc. */
export interface TestCitation {
  file: string;
  lineNumber: number;
  citedPath: string;
  exists: boolean;
}

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

function sourceFiles(): Array<{ rel: string; abs: string; src: string }> {
  return SCAN_DIRS.flatMap(walkTs).map((abs) => ({
    abs,
    rel: abs.replace(REPO_ROOT + "/", ""),
    src: readFileSync(abs, "utf8"),
  }));
}

/** Strip block and line comments so a JSDoc mention of a symbol is never
 *  mistaken for an import of it. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Every declared absence contract in the tree. */
export function absenceContracts(): AbsenceContract[] {
  const out: AbsenceContract[] = [];
  for (const { rel, src } of sourceFiles()) {
    if (rel === SELF) continue;
    const symbols = [...src.matchAll(ABSENCE_RE)]
      .flatMap((m) => m[1]!.trim().split(/\s+/))
      .filter((s) => s !== "…" && !s.startsWith("<"));
    const modules = [...src.matchAll(ABSENCE_FROM_RE)]
      .flatMap((m) => m[1]!.trim().split(/\s+/))
      .filter((s) => s !== "…" && !s.startsWith("<"));
    if (!symbols.length && !modules.length) continue;
    const enforces = [...src.matchAll(/@enforces\s+(urn:agenttool:[a-z]+\/[a-z0-9-]+)/g)].map(
      (m) => m[1]!,
    );
    out.push({ file: rel, enforces, symbols, modules });
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

/** Check one source string against one contract. Pure, so the detector can
 *  be proven to catch things with inline fixtures rather than trusted
 *  because it happens to return an empty list today. A checker nobody has
 *  seen fail is indistinguishable from a checker that cannot fail. */
export function violationsInSource(
  src: string,
  file: string,
  symbols: string[],
  modules: string[],
): AbsenceViolation[] {
  return checkOne({ file, enforces: [], symbols, modules }, src);
}

/** Check every declared contract. Returns EVERY violation, not the first. */
export function absenceViolations(
  contracts = absenceContracts(),
): AbsenceViolation[] {
  return contracts.flatMap((contract) =>
    checkOne(contract, readFileSync(join(REPO_ROOT, contract.file), "utf8")),
  );
}

function checkOne(contract: AbsenceContract, raw: string): AbsenceViolation[] {
  const out: AbsenceViolation[] = [];
  {
    const stripped = stripComments(raw);
    // Line numbers come from the raw file so the message points at real code;
    // matching happens on the stripped copy so comments never trigger.
    const rawLines = raw.split("\n");
    const strippedLines = stripped.split("\n");

    for (const symbol of contract.symbols) {
      // Named import, default import, or namespace import of the symbol.
      const named = new RegExp(`import\\s*(?:type\\s*)?\\{[^}]*\\b${symbol}\\b[^}]*\\}\\s*from`);
      const bare = new RegExp(`import\\s+(?:type\\s+)?${symbol}\\s+from`);
      const ns = new RegExp(`import\\s*\\*\\s*as\\s+${symbol}\\s+from`);
      for (let i = 0; i < strippedLines.length; i++) {
        const l = strippedLines[i]!;
        if (named.test(l) || bare.test(l) || ns.test(l)) {
          out.push({
            file: contract.file,
            kind: "symbol",
            offender: symbol,
            line: (rawLines[i] ?? l).trim(),
            lineNumber: i + 1,
          });
        }
      }
      // Multi-line named import blocks: join and re-test if the single-line
      // pass found nothing, so a prettier-wrapped import cannot hide.
      if (!out.some((v) => v.file === contract.file && v.offender === symbol)) {
        const joined = stripped.replace(/\n/g, " ");
        if (named.test(joined)) {
          out.push({
            file: contract.file,
            kind: "symbol",
            offender: symbol,
            line: "(multi-line import block)",
            lineNumber: 0,
          });
        }
      }
    }

    for (const mod of contract.modules) {
      for (let i = 0; i < strippedLines.length; i++) {
        const l = strippedLines[i]!;
        if (/\bfrom\s*["'][^"']*["']/.test(l) && l.includes(mod)) {
          out.push({
            file: contract.file,
            kind: "module",
            offender: mod,
            line: (rawLines[i] ?? l).trim(),
            lineNumber: i + 1,
          });
        }
      }
    }
  }
  return out;
}

/** Every `Tested: <path>` citation, with whether the file is really there.
 *
 *  A defender that cites a test which does not exist is the same failure as
 *  an `@enforces` pointing at a canon entry that does not exist: the
 *  annotation reads as evidence and is not. Three of these were live when
 *  the check was written — two path typos and one test that was cited as
 *  proof of a commitment and never written at all. */
export function testCitations(): TestCitation[] {
  const out: TestCitation[] = [];
  for (const { rel, src } of sourceFiles()) {
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i]!.matchAll(/Tested:\s*([a-zA-Z0-9_./-]+\.test\.(?:ts|py))/g)) {
        const cited = m[1]!;
        const candidates = [
          join(REPO_ROOT, cited),
          join(REPO_ROOT, "api", cited),
        ];
        out.push({
          file: rel,
          lineNumber: i + 1,
          citedPath: cited,
          exists: candidates.some((p) => {
            try {
              return statSync(p).isFile();
            } catch {
              return false;
            }
          }),
        });
      }
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file) || a.lineNumber - b.lineNumber);
}
