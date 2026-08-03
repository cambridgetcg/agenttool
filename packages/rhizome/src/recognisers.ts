/** rhizome/recognisers — the vocabularies that say "this file does X".
 *
 *  Three probes need to answer the same three questions about a file:
 *
 *    does it read the tree at run time?
 *    does it enumerate a directory tree — sweep, rather than drive an API?
 *    does it decide pass/fail?
 *
 *  Each of those was answered by a private regular expression in the file
 *  that asked, and the copies had already drifted:
 *
 *    probes/edge.ts          WALKS_THE_TREE   knew opendir, scandir, globSync,
 *                                             glob.glob, find -name
 *    probes/pretend.ts       SWEEPS_THE_TREE  knew createProgram, ast.parse,
 *                                             iterdir(), rglob() — and none
 *                                             of the five above
 *    probes/pretend/guards.ts READS_THE_TREE  a third spelling again
 *
 *  Two answers to one question, neither able to see what the other knew,
 *  each looking complete from inside its own file. `pretend` reported that
 *  42 of 269 derived guards swept the tree; the number was a fact about
 *  which spellings its own copy happened to contain. That is the shape this
 *  package exists to name, so it does not get to live here.
 *
 *  These are literal vocabularies and cannot be derived: "what does a
 *  filesystem walk look like?" is a fact about language runtimes, not about
 *  this corpus, and a corpus-derived answer would only ever contain the
 *  spellings somebody already used — which is exactly the boundary that
 *  cannot be seen from inside. So each carries the four properties this
 *  package demands of a literal boundary: exported here, reasoned in place,
 *  staleness-checked by `tests/recognisers.test.ts` (which fails if a probe
 *  declares a private copy of one of these concepts, and fails if a
 *  spelling in the list matches nothing anywhere in the corpus), and stated
 *  in rhizome's own output — every probe that uses one publishes
 *  `RECOGNISER_LIMIT` as a declared `ProbeLimit`.
 */

import type { ProbeLimit } from "./types.js";

/** Textual signature of a file that reads other files at run time.
 *
 *  The promise spellings are here because leaving them out cost a guard: an
 *  earlier version listed only `readFileSync`/`readdirSync`, and
 *  `packages/sdk-ts/scripts/check-parity.ts` — which imports `readdir` and
 *  `readFile` from `node:fs/promises` — was not a guard at all. A probe for
 *  enumerations with an edge they cannot see does not get to keep one. */
export const READS_THE_TREE =
  /readFileSync|readdirSync|\breadFile\s*\(|\breaddir\s*\(|read_text\(|open\(|json\.load|createProgram|ast\.parse|os\.walk|Bun\.Glob|new Glob\b|iterdir\(|rglob\(|globSync|glob\.glob/;

/** Textual signature of a verdict that comes from sweeping a directory
 *  tree, as opposed to one that drives an API and checks the answer.
 *
 *  Only the first kind can go quietly blind: a driven call either happens
 *  or it does not, while a sweep that stopped matching passes every file it
 *  reads. Both `edge` (which asks whether a walk's scope is derived) and
 *  `pretend` (which asks whether a sweeping guard can fail) need exactly
 *  this predicate, and they used to disagree about it. */
export const WALKS_THE_TREE =
  /readdirSync|readdir\s*\(|opendir|scandir|os\.walk|new Glob\b|globSync|Bun\.Glob|glob\.glob|find\s+-name|iterdir\(|rglob\(|createProgram|ast\.parse/;

/** Textual signature of a file that decides pass/fail. */
export const ASSERTS = /\bexpect\s*\(|\bassert\b|process\.exit\s*\(\s*1|sys\.exit\s*\(\s*1|throw new Error/;

/** Every spelling the vocabularies above contain, for the staleness check.
 *  Alternation members only — a member matching nothing anywhere in the
 *  corpus is either a typo or a language this tree stopped using, and both
 *  are worth going red over. */
export const RECOGNISER_SPELLINGS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  READS_THE_TREE: Object.freeze(READS_THE_TREE.source.split("|")),
  WALKS_THE_TREE: Object.freeze(WALKS_THE_TREE.source.split("|")),
  ASSERTS: Object.freeze(ASSERTS.source.split("|")),
});

/** Spellings deliberately kept although nothing in this corpus writes them.
 *
 *  Pinned exactly, in both directions: `tests/recognisers.test.ts` asserts
 *  that the set of unwitnessed spellings *equals* this list, so a spelling
 *  that quietly stops matching lands here loudly, and a spelling listed
 *  here that starts matching has to be removed. A vocabulary whose entries
 *  are never checked against the tree is a list nobody re-reads, which is
 *  the thing this package objects to.
 *
 *  `os\.walk` — the canonical Python directory walk. This tree's Python
 *  reaches for `pathlib` instead, so nothing writes it today; it is kept
 *  because the next Python scanner somebody adds is as likely to use it as
 *  not, and a walk the vocabulary cannot see is reported as no walk at
 *  all rather than as an unknown. */
export const SPELLINGS_WITHOUT_WITNESS: readonly string[] = Object.freeze(["os\\.walk"]);

/** The boundary every probe built on these vocabularies genuinely has,
 *  phrased once and published by each of them. */
export const RECOGNISER_LIMIT: ProbeLimit = Object.freeze({
  statement:
    "whether a file reads, sweeps or asserts is decided by a literal vocabulary of call spellings in src/recognisers.ts, so a file that walks the tree through a spelling nobody in this repository has written yet is not seen as walking it at all",
  why: "the spellings are a fact about language runtimes rather than about this corpus, and a corpus-derived list would contain only the forms somebody already used — which is the boundary that cannot be seen from inside. The list is therefore asserted: exported, reasoned in place, and staleness-checked by tests/recognisers.test.ts, which goes red when a spelling matches nothing in the tree and when a probe declares a private copy of one of these vocabularies",
  file: "packages/rhizome/src/recognisers.ts",
  line: 0,
});
