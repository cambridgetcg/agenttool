/** rhizome/probes/decay — what is dead, and what is kept alive past its
 *  condition.
 *
 *  In soil, decomposition returns dead matter to the system. Undecomposed
 *  inert mass is what made the lawn a sandbox: a thin living layer over
 *  builders' rubble, growing something that looked like a lawn on top of
 *  a thing that could not support one.
 *
 *  A codebase's inert mass is the temporary accommodation that became
 *  permanent. Every one of them was correct on the day it was written —
 *  that is what makes them hard to see. A quarantine list, an exemption,
 *  a ratchet, a baseline, a deprecation note: each is a *claim about a
 *  condition* ("this fails today", "these are uneven on purpose", "this
 *  number only goes down", "this was true at commit 9efafea"). The claim
 *  is checkable. Almost nothing checks it.
 *
 *  So this probe never asks "should this be deleted?" — that is a human,
 *  authorised act and the answer is not derivable. It asks: **is the
 *  condition that justified this accommodation still true?**
 *
 *  Each finding carries a decay verdict as the first token of `detail`:
 *
 *    compostable                        the thing it accommodates is gone;
 *                                       nothing depends on the entry now.
 *    load-bearing-despite-appearance    it looks like accumulated debt and
 *                                       the condition still holds. Saying
 *                                       so plainly is the point: it stops
 *                                       being re-investigated.
 *    owed                               the condition has passed, or was
 *                                       never checkable, and someone owes
 *                                       an action.
 *
 *  Nothing here enumerates a directory, a package, a test tier or a file.
 *  Every corpus comes from `Scope`, every referent is resolved against it,
 *  and the repository's "now" is derived from the newest date the tree
 *  writes into its own filenames rather than from the system clock — so
 *  two runs at the same commit produce the same report.
 */

import { clip, isCommentLine, lineOf, literalCollections, stringLiterals } from "../source.js";
import type { Finding, Probe, ProbeLimit, Scope, Verdict } from "../types.js";
import {
  compareVersions,
  daysBetween,
  governingVersion,
  repositoryClock,
  type RepositoryClock,
} from "./decay/clock.js";
import { argumentVocabulary, callSites, PROSE_EXTENSIONS, sitesPassing, type CallSite } from "./decay/reach.js";
import { jsonStringFields, recordCollections, type LiteralRecord } from "./decay/records.js";
import { shellArrays, type ShellArray } from "./decay/shell.js";

const ID = "decay";

/** The three readings of an accommodation. Mapped to the report's three
 *  verdicts rather than added to them: `Finding.verdict` is shared with
 *  every sibling probe and is not this probe's to widen. The decay
 *  reading is published as the first token of `detail`, which keeps it
 *  greppable and keeps the core untouched. */
export type DecayVerdict = "compostable" | "load-bearing-despite-appearance" | "owed";

const DECAY_TO_VERDICT: Readonly<Record<DecayVerdict, Verdict>> = Object.freeze({
  compostable: "gap",
  owed: "gap",
  "load-bearing-despite-appearance": "sound",
});

function decayed(
  kind: DecayVerdict,
  finding: { title: string; file: string; line: number; evidence: string; detail: string },
): Finding {
  return {
    probe: ID,
    title: finding.title,
    file: finding.file,
    line: finding.line,
    verdict: DECAY_TO_VERDICT[kind],
    evidence: finding.evidence,
    detail: `decay: ${kind} — ${finding.detail}`,
  };
}

/** Names that announce "these are held back from the normal path".
 *
 *  Narrow on purpose. `KNOWN_ERRORS`, `TEST_SUPPORT_FILES` and
 *  `ALLOWED_PHRASES` are inventories, not accommodations, and reporting
 *  them would bury the four that are. */
const HELD_BACK_NAME = /(QUARANTIN|KNOWN_?RED|SKIP|EXCLUD|EXEMPT|DISABL|DEFER|PENDING|WAIV|IGNORE)/i;

/** Names that announce "this unevenness is written down and reasoned".
 *  A collection with a per-entry `reason`/`why` field qualifies whatever
 *  it is called — the reason field is the better signal than the name,
 *  because it is the thing this probe checks. */
const EXEMPTION_NAME = /(EXEMPT|EXCEPTION|DELIBERATE|WAIV|DIVERG|ACCEPTED|SKIP_|_SKIP|SKIPPED)/i;

/** Field keys that hold the condition an exemption rests on. `note`,
 *  `detail` and `comment` are deliberately absent: every seeded content
 *  table in this tree has one, and including them turned this check into
 *  a report about tax cards and loop doctrine. */
const REASON_KEY = /^(reason|why|because|justification|rationale)$/i;

/** A file claiming its own numbers move in one direction only.
 *
 *  Only phrases that are about the file's own count. "monotonic" and
 *  "never grows" on their own are domain vocabulary in this repository —
 *  there is a monotone-loop doctrine — and matching them turned this
 *  check into a hundred findings about prose. */
const MONOTONIC_CLAIM =
  /(may only shrink|may only decrease|only ever shrinks?|shrink-?only|only shrinks|ratchet (?:only )?shrinks|never regress(?:es)?|must stay ?[<≤]|the baseline never)/i;

/** The claim has to be about a countable thing this file holds. "State
 *  NEVER regresses" is a statement about a runtime loop, and this
 *  repository has a monotone-loop doctrine that says it in a dozen
 *  places; without this the check reports doctrine instead of ratchets. */
const COUNTABLE_SUBJECT = /\b(list|manifest|baseline|count|number|entries|entry|set|ratchet|total|inventory|table)\b/i;

/** A header stamp saying when a file was last told the truth. */
const CAPTURE_STAMP = /(captured|generated|as of|snapshot(?:ted)?|last refreshed|recorded)\b[^\n]{0,40}?(\d{4}-\d{2}-\d{2})/i;

/** A deprecation that names the moment it stops being a deprecation. */
const REMOVAL_CONDITION =
  /(?:scheduled for removal in|removal in|removed in|remove in|removal at|drops? in|deleted in)\s+v?(\d+\.\d+(?:\.\d+)?)/i;

/** A deprecation that names when it started. */
const DEPRECATED_SINCE = /deprecated\s+(?:since|as of)\s+v?(\d{4}-\d{2}-\d{2}|\d+\.\d+(?:\.\d+)?)/i;

/** A `@deprecated` tag being *declared*, as opposed to being quoted.
 *
 *  The tag must not be preceded by a quote, a backtick or a regex
 *  alternation, and must be followed by whitespace or end of line — so
 *  `` `@deprecated` `` in a sentence, `"@deprecated"` in a string and
 *  `/@deprecated|…/` in a detector are all excluded. Written because the
 *  detector below matched itself four times. */
const DECLARED_DEPRECATION = /(?<!['"`|\\])@deprecated(?=\s|$)/;

/** An unconditional literal skip: `test.skip("title", …)`. The conditional
 *  forms — `cond ? test : test.skip`, `skipIf`, `describe.skipIf` — are
 *  environment gates rather than accommodations and are not matched. */
const HARD_SKIP = /(?:^|[^.\w])(?:test|it|describe)\.skip\s*\(\s*(?:$|["'`])/;

/** Path shapes that mark a file as a test in this tree. A naming
 *  convention, not a scope: an unknown convention costs a missed skip,
 *  never a missed file. */
const TEST_PATH = /(^|\/)(tests?|__tests__|specs?)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$|_test\.py$/;

/** Extensions where a claim in a string is data and a claim in a comment
 *  is a claim. A `.json` or `.txt` register has no comments, so it is not
 *  held to this. */
const SOURCE_EXTENSION = /\.(ts|tsx|js|mjs|cjs|jsx|py|sh|bash|sql|go|rs)$/;

const COMMENT_LINE = /^\s*(#|\/\/|\*|\/\*|--|<!--)/;

/** Where a claim about a file's own numbers is *published* rather than
 *  quoted: a comment, or a test/describe title. Both are the author
 *  speaking. A claim anywhere else in a source file is a string — a
 *  fixture, a message, an example — and reading those as claims is how a
 *  probe ends up reporting its own test fixtures. */
const CLAIM_POSITION = /^\s*(?:#|\/\/|\*|\/\*|--|<!--)|^\s*(?:test|it|describe)(?:\.\w+)?\s*\(/;

/** Is `index` inside a string literal on this line?
 *
 *  Counting unescaped quotes before the position is crude and correct
 *  often enough to matter: it is the difference between "a test is
 *  skipped with no stated reason" pointing at a skipped test and pointing
 *  at the fixture in the file that detects skipped tests. */
function insideStringLiteral(line: string, index: number): boolean {
  let quote: string | null = null;
  for (let i = 0; i < index && i < line.length; i += 1) {
    const character = line[i]!;
    if (character === "\\") {
      i += 1;
      continue;
    }
    if (quote === null) {
      if (character === '"' || character === "'" || character === "`") quote = character;
    } else if (character === quote) {
      quote = null;
    }
  }
  return quote !== null;
}

/** `@pytest.mark.skip(reason=…)` written directly as a decorator. */
const PYTEST_SKIP = /^[ \t]*@pytest\.mark\.skip\s*\(/;

/** Constant names that read as a ratchet position rather than as an
 *  ordinary cap. `MAX_RECENT_MEMORIES_IN_MD` is a display budget; a
 *  `BASELINE` is a claim about where the number used to be. */
const RATCHET_CONSTANT = /(BASELINE|RATCHET|CEILING|HIGH_?WATER|ACCEPTED_)/;

/** How far from a use of an inventory's name a tier token may sit and
 *  still be read as the token that runs it. */
const TOKEN_PROXIMITY = 25;

const LIMITS: readonly ProbeLimit[] = [
  {
    statement:
      "cannot tell whether a quarantined test still fails; it reads the list, the reason and the gate, never the outcome",
    why: "running repository tests would mean executing repository code, which this package refuses; the honest substitute is the cross-register check against the tree's other known-red register, which is reported separately",
    file: "packages/rhizome/src/probes/decay.ts",
    line: 0,
  },
  {
    statement:
      "the repository's `now` is the newest date the tree writes into its own filenames, so a repository that stops using dated filenames stops having a clock and every age measurement here goes silent rather than wrong",
    why: "the system clock would make two runs at the same commit disagree, and would measure the reader's calendar rather than the repository's motion",
    file: "packages/rhizome/src/probes/decay/clock.ts",
    line: 60,
  },
  {
    statement:
      "invocation is read as `a line of one corpus file contains another corpus file's path`, so an argument held in a variable reads as the variable's name and a caller outside the repository is invisible",
    why: "a real build/exec graph across bash, YAML, TypeScript and Python would be a second implementation of four languages; the invocation table is published verbatim in the finding so the reader can judge rather than trust",
    file: "packages/rhizome/src/probes/decay/reach.ts",
    line: 47,
  },
  {
    statement:
      "prose files (.md/.mdx/.txt/.rst) are excluded from the invocation table, so a runbook that is the only place a mode is invoked reads as nothing invoking it",
    why: "a document quoting a command is documenting it, not running it, and counting documentation as a caller would make every diagnostic mode look gated",
    file: "packages/rhizome/src/probes/decay/reach.ts",
    line: 27,
  },
  {
    statement:
      "a stated reason is checked by resolving the names inside it, so a reason whose condition is real but unnameable — 'the harness is too slow', 'the owner has not decided' — is counted as unchecked rather than as stale",
    why: "asserting that an unnameable condition has passed would be a guess presented as a finding, which is the thing this package exists to stop",
    file: "packages/rhizome/src/probes/decay.ts",
    line: 0,
  },
  {
    statement:
      "shell array bodies longer than 300 lines and object-literal arrays longer than 400 are skipped rather than half-read",
    why: "unbounded bracket matching over a 2,800-file tree; the bound is stated so a skipped inventory is a known miss rather than a silent one",
    file: "packages/rhizome/src/probes/decay/shell.ts",
    line: 84,
  },
];

// ── shared derivations ───────────────────────────────────────────────────

function isProse(file: string): boolean {
  return PROSE_EXTENSIONS.some((extension) => file.endsWith(extension));
}

/** Corpus files whose path is, or ends with, `entry`.
 *
 *  This is how a path written relative to some other root — `tests/x.ts`
 *  inside a script that runs from `api/` — is resolved without anyone
 *  writing down what that root is. */
function resolveSubject(scope: Scope, entry: string, near?: string): string[] {
  const cleaned = entry.replace(/^\.\//, "").replace(/^\//, "");
  if (cleaned === "" || cleaned.includes("*")) return [];
  const hits = scope.files.filter((file) => file === cleaned || file.endsWith(`/${cleaned}`));
  if (hits.length <= 1 || near === undefined) return hits;
  // Several files share the basename. Prefer the one sharing the longest
  // path prefix with the file that named it — derived tie-break, no list.
  const score = (file: string): number => {
    const a = file.split("/");
    const b = near.split("/");
    let common = 0;
    while (common < a.length && common < b.length && a[common] === b[common]) common += 1;
    return common;
  };
  const best = Math.max(...hits.map(score));
  return hits.filter((file) => score(file) === best);
}

function looksPathish(entry: string): boolean {
  return /^[\w./@-]+$/.test(entry) && (entry.includes("/") || /\.[a-z]{1,5}$/.test(entry));
}

interface Inventory {
  file: string;
  name: string;
  line: number;
  comment: string;
  entries: Array<{ value: string; line: number; comment: string }>;
  form: "shell array" | "literal list";
  /** Entries that resolve to at least one corpus file. */
  resolved: Map<string, string[]>;
}

/** Every collection in the tree whose entries are corpus file paths.
 *
 *  Discovered by shape, not by name: any array of two or more path-shaped
 *  words where most resolve against the derived corpus. Which of them are
 *  *reported* is a separate decision below; the full set is needed because
 *  the cross-register check asks "is this file held by any inventory at
 *  all", and answering that from a subset would rebuild the blind spot. */
function collectInventories(scope: Scope): Inventory[] {
  const out: Inventory[] = [];
  const consider = (
    file: string,
    name: string,
    line: number,
    comment: string,
    entries: Array<{ value: string; line: number; comment: string }>,
    form: Inventory["form"],
  ): void => {
    if (entries.length < 2) return;
    const pathish = entries.filter((entry) => looksPathish(entry.value));
    if (pathish.length < entries.length) return;
    const resolved = new Map<string, string[]>();
    for (const entry of entries) {
      const hits = resolveSubject(scope, entry.value, file);
      if (hits.length > 0) resolved.set(entry.value, hits);
    }
    if (resolved.size < 2) return;
    out.push({ file, name, line, comment, entries, form, resolved });
  };

  for (const file of scope.files) {
    if (scope.read(file) === null || isProse(file)) continue;
    const lines = scope.lines(file);
    if (file.endsWith(".sh") || file.endsWith(".bash")) {
      for (const array of shellArrays(lines)) {
        consider(file, array.name, array.line, array.comment, array.entries, "shell array");
      }
    }
    for (const collection of literalCollections(lines)) {
      consider(
        file,
        collection.name,
        collection.line,
        collection.comment,
        collection.entries.map((value) => ({ value, line: collection.line, comment: "" })),
        "literal list",
      );
    }
  }
  return out;
}

// ── check 1: held-back inventories, and whether anything reaches them ────

/** The argument a caller would pass to run this inventory.
 *
 *  Derived twice over: the candidate tokens are the arguments callers
 *  actually pass to the declaring file, and the winner is whichever one
 *  is written closest to a use of the inventory's own name. Nothing here
 *  knows what a "tier" is. */
function gateToken(
  scope: Scope,
  inventory: Inventory,
  sites: readonly CallSite[],
): { token: string; line: number; alternatives: string[] } | null {
  const vocabulary = argumentVocabulary(sites).filter((token) => /^[a-z][a-z0-9-]{2,}$/.test(token));
  if (vocabulary.length === 0) return null;
  const lines = scope.lines(inventory.file);

  const uses: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (i + 1 === inventory.line) continue;
    if ((lines[i] ?? "").includes(inventory.name)) uses.push(i + 1);
  }
  if (uses.length === 0) return null;

  // A branch body follows its condition in every language here, so a token
  // written *after* the membership test is the one that test selects. Ties
  // broken toward "after" is the difference between reporting `quarantine`
  // and reporting `database`, which sits one line earlier in the same
  // `if/elif` and means the opposite thing.
  let best: { token: string; line: number; distance: number; after: boolean } | null = null;
  const nearby = new Set<string>();
  for (const token of vocabulary) {
    const word = new RegExp(`(^|[^\\w-])${token}([^\\w-]|$)`);
    for (let i = 0; i < lines.length; i += 1) {
      if (!word.test(lines[i] ?? "")) continue;
      for (const use of uses) {
        const distance = Math.abs(use - (i + 1));
        if (distance > TOKEN_PROXIMITY) continue;
        nearby.add(token);
        const after = i + 1 >= use;
        const better =
          best === null || (after && !best.after) || (after === best.after && distance < best.distance);
        if (better) best = { token, line: i + 1, distance, after };
      }
    }
  }
  return best === null
    ? null
    : { token: best.token, line: best.line, alternatives: [...nearby].filter((token) => token !== best!.token).sort() };
}

function checkHeldBack(scope: Scope, inventories: readonly Inventory[]): Finding[] {
  const findings: Finding[] = [];
  for (const inventory of inventories) {
    if (!HELD_BACK_NAME.test(inventory.name)) continue;

    const missing = inventory.entries.filter((entry) => !inventory.resolved.has(entry.value));
    const guardsItself = /(-f |-e |existsSync|exists\(|os\.path\.exists|Bun\.file)/.test(scope.read(inventory.file) ?? "");

    if (missing.length > 0) {
      findings.push(
        decayed("compostable", {
          title: `${inventory.name} holds back ${missing.length} path(s) that no longer exist`,
          file: inventory.file,
          line: missing[0]?.line ?? inventory.line,
          evidence: missing.map((entry) => `${inventory.file}:${entry.line}  ${entry.value}`).join("\n"),
          detail:
            "Nothing depends on these entries: the file each names is not in the corpus under either derivation. An accommodation whose subject is gone still reads as considered, which is what makes the rest of the list look reviewed.",
        }),
      );
    } else if (guardsItself) {
      findings.push(
        decayed("load-bearing-despite-appearance", {
          title: `every entry in ${inventory.name} still names a file, and the declaring file checks that itself`,
          file: inventory.file,
          line: inventory.line,
          evidence:
            `${inventory.entries.length} entries, all resolving in the corpus. First three:\n` +
            inventory.entries
              .slice(0, 3)
              .map((entry) => `${inventory.file}:${entry.line}  ${entry.value} → ${(inventory.resolved.get(entry.value) ?? []).join(", ")}`)
              .join("\n"),
          detail:
            `${inventory.file} tests the existence of its own entries, so an entry cannot outlive its file silently. That is the half of staleness this list does check; whether the condition each entry describes is still true is the half nothing checks.`,
        }),
      );
    }

    // Reachability. The interesting question about a held-back list is not
    // its contents but whether anything ever runs it.
    const sites = callSites(scope, inventory.file);
    const token = gateToken(scope, inventory, sites);
    if (token === null) continue;

    const direct = sitesPassing(sites, token.token);
    const unreasoned = inventory.entries.filter(
      (entry) => entry.comment === "" && inventory.comment.length < 40,
    ).length;

    if (direct.length === 0) {
      findings.push(
        decayed("owed", {
          title: `nothing in the repository passes \`${token.token}\` to ${inventory.file}`,
          file: inventory.file,
          line: token.line,
          evidence:
            `${inventory.name} (${inventory.entries.length} entries) is selected by the token \`${token.token}\` at ${inventory.file}:${token.line}.\n\n` +
            `every call site of ${inventory.file} in the corpus:\n` +
            sites.map((site) => `${site.file}:${site.line}  ${clip(site.text, 100)}`).join("\n"),
          detail:
            "The list is maintained, validated and never run. Nothing fails when an entry here becomes wrong, because nothing reads the branch that uses it.",
        }),
      );
      continue;
    }

    const outer = direct.flatMap((site) => callSites(scope, site.file));
    const outerPassing = sitesPassing(outer, token.token);
    const outerVocabulary = argumentVocabulary(outer);

    if (outerPassing.length === 0 && outer.length > 0) {
      findings.push(
        decayed("owed", {
          title: `${inventory.name} is reachable only through a mode no caller in the repository selects`,
          file: inventory.file,
          line: inventory.line,
          evidence:
            `${inventory.entries.length} entries held back, selected by \`${token.token}\` at ${inventory.file}:${token.line}` +
            (token.alternatives.length > 0 ? ` (other tokens written near this list: ${token.alternatives.join(", ")})` : "") +
            `\n\n` +
            `passed to ${inventory.file} by:\n` +
            direct.map((site) => `  ${site.file}:${site.line}  ${clip(site.text, 100)}`).join("\n") +
            `\n\nevery call site of ${direct.map((site) => site.file).join(", ")} in the corpus:\n` +
            outer.map((site) => `  ${site.file}:${site.line}  ${clip(site.text, 100)}`).join("\n") +
            `\n\narguments those callers do pass: ${outerVocabulary.join(", ") || "(none)"}\n` +
            `arguments they do not pass: ${token.token}` +
            (unreasoned > 0 ? `\n\n${unreasoned} of ${inventory.entries.length} entries carry no reason of their own.` : ""),
          detail:
            `Two hops from the entry to the world: \`${token.token}\` reaches ${inventory.file} only from ${direct
              .map((site) => site.file)
              .join(", ")}, and no non-prose file passes \`${token.token}\` to that in turn. So each entry is held back by a gate that runs, and released by a gate that nothing invokes — the accommodation is permanent by default rather than by decision. Read the invocation table above rather than trusting this sentence: an argument held in a variable is invisible to it.`,
        }),
      );
    } else if (outerPassing.length > 0) {
      findings.push(
        decayed("load-bearing-despite-appearance", {
          title: `${inventory.name} is reachable: something passes \`${token.token}\` all the way down`,
          file: inventory.file,
          line: inventory.line,
          evidence: outerPassing.map((site) => `${site.file}:${site.line}  ${clip(site.text, 100)}`).join("\n"),
          detail: "The held-back set is exercised by an invocation that exists in this repository, not only by a mode a human has to remember.",
        }),
      );
    }
  }
  return findings;
}

// ── check 1b: two copies of one held-back list, disagreeing ──────────────

/** Two inventories that mostly hold the same files and do not agree.
 *
 *  This is the shape the repository has hit four times, one level along:
 *  not a scope with an invisible edge, but an accommodation with two
 *  copies, where releasing something from one leaves it held by the
 *  other. The releasing edit is the visible act; the copy is the part
 *  nobody is looking at while making it.
 *
 *  Overlap is the discovery mechanism, so nothing here knows what a
 *  quarantine list is: any two path inventories sharing most of their
 *  members are copies, and the symmetric difference is the drift. */
function checkDivergentCopies(scope: Scope, inventories: readonly Inventory[]): Finding[] {
  const findings: Finding[] = [];
  const held = inventories.filter((inventory) => HELD_BACK_NAME.test(inventory.name));

  for (let i = 0; i < held.length; i += 1) {
    for (let j = i + 1; j < held.length; j += 1) {
      const a = held[i]!;
      const b = held[j]!;
      if (a.file === b.file) continue;
      const left = new Set([...a.resolved.values()].flat());
      const right = new Set([...b.resolved.values()].flat());
      if (left.size < 3 || right.size < 3) continue;
      const shared = [...left].filter((file) => right.has(file));
      if (shared.length < Math.min(left.size, right.size) * 0.6) continue;

      const onlyLeft = [...left].filter((file) => !right.has(file)).sort();
      const onlyRight = [...right].filter((file) => !left.has(file)).sort();

      if (onlyLeft.length === 0 && onlyRight.length === 0) {
        findings.push(
          decayed("load-bearing-despite-appearance", {
            title: `${a.name} and ${b.name} are duplicate lists that currently agree`,
            file: b.file,
            line: b.line,
            evidence: `${a.file}:${a.line} ${a.name} — ${left.size} files\n${b.file}:${b.line} ${b.name} — ${right.size} files\nsymmetric difference: none`,
            detail:
              "Identical today, and nothing derives one from the other, so agreement is a fact about this commit rather than a property of the pair. Recorded because the next edit to either one is where they part.",
          }),
        );
        continue;
      }

      findings.push(
        decayed("owed", {
          title: `${a.name} and ${b.name} are copies of one held-back list and disagree on ${onlyLeft.length + onlyRight.length} file(s)`,
          file: onlyRight.length > 0 ? b.file : a.file,
          line: onlyRight.length > 0 ? b.line : a.line,
          evidence:
            `${a.file}:${a.line} ${a.name} — ${left.size} files\n` +
            `${b.file}:${b.line} ${b.name} — ${right.size} files\n` +
            `${shared.length} shared\n\n` +
            (onlyLeft.length > 0 ? `held only by ${a.name}:\n${onlyLeft.map((file) => `  ${file}`).join("\n")}\n` : "") +
            (onlyRight.length > 0 ? `held only by ${b.name}:\n${onlyRight.map((file) => `  ${file}`).join("\n")}\n` : ""),
          detail:
            "One list was edited and the other was not. Releasing something from an accommodation is a visible act; the second copy is the part nobody is looking at while performing it, so the release is half-done and reads as complete. Neither copy is derived from the other, and nothing in the repository compares them — which is why the difference is exactly the set of things somebody recently decided about.",
        }),
      );
    }
  }
  return findings;
}

// ── check 2: exemptions whose stated reason has lost its referent ────────

/** Tokens inside a reason that name something checkable. Prose words are
 *  not referents; `hashLoungeGuestbookText`, `soul.py` and `data.ts` are. */
function referentsIn(values: readonly string[]): string[] {
  const out = new Set<string>();
  for (const value of values) {
    // The dotted branch is greedy over every segment on purpose: read
    // non-greedily it turns `two.test.ts` into `two.test`, which resolves
    // nowhere and produces a finding that the reason names a missing file
    // while the file is sitting right there.
    for (const match of value.matchAll(
      /`([^`]+)`|([A-Za-z_$][\w$-]*(?:\.[A-Za-z0-9_]{1,6})+)|([a-z][a-z0-9]*(?:_[a-z0-9]+)+)|([a-z][a-z0-9]*[A-Z][A-Za-z0-9]{3,})/g,
    )) {
      const token = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? "").trim().replace(/\(\)$/, "");
      if (token.length < 4 || token.length > 80) continue;
      // Backticks in this tree also hold shapes and templates —
      // `urn:<namespace>:<kind>/`, `field="member"`, `cd <pkg> && bun ci`.
      // A shape is not a referent: it names a form, not a thing, and
      // asserting that a form is missing from the tree is nonsense.
      if (!/^[\w$@./:-]+$/.test(token)) continue;
      if (!/[A-Za-z]/.test(token)) continue;
      out.add(token);
    }
  }
  return [...out];
}

interface ExemptionCheck {
  record: LiteralRecord | { line: number; strings: string[]; fields: Array<{ key: string; value: string }> };
  lost: string[];
  checked: string[];
}

function checkExemption(scope: Scope, file: string, strings: readonly string[]): { lost: string[]; checked: string[] } {
  const lost: string[] = [];
  const checked: string[] = [];
  for (const referent of referentsIn(strings)) {
    // A referent shaped like a file is checked as a file first; anything
    // else is checked as text written somewhere in the corpus.
    if (/\.[a-z]{1,4}$/.test(referent)) {
      const hits = resolveSubject(scope, referent, file);
      if (hits.length > 0) checked.push(`${referent} → ${hits.slice(0, 2).join(", ")}`);
      else if (scope.filesContaining(referent).some((hit) => hit !== file)) checked.push(`${referent} → named in ${scope.filesContaining(referent).filter((hit) => hit !== file)[0]}`);
      else lost.push(referent);
      continue;
    }
    const hits = scope.filesContaining(referent).filter((hit) => hit !== file);
    if (hits.length > 0) checked.push(`${referent} → ${hits[0]}`);
    else lost.push(referent);
  }
  return { lost, checked };
}

function checkExemptions(scope: Scope): Finding[] {
  const findings: Finding[] = [];

  for (const file of scope.files) {
    if (scope.read(file) === null || isProse(file)) continue;
    const lines = scope.lines(file);

    const groups: Array<{ name: string; line: number; records: ExemptionCheck[] }> = [];

    const seen = new Set<string>();

    for (const collection of recordCollections(lines)) {
      // The signal is the reason, not the name: a collection whose records
      // carry a `reason`/`why` field is an accommodation with a stated
      // condition, which is the only thing this check can evaluate.
      const carriesReason = collection.records.some((record) => record.fields.some((field) => REASON_KEY.test(field.key)));
      if (!carriesReason && !EXEMPTION_NAME.test(collection.name)) continue;
      seen.add(`${collection.name}:${collection.line}`);
      const records: ExemptionCheck[] = [];
      for (const record of collection.records) {
        const { lost, checked } = checkExemption(scope, file, record.strings);
        records.push({ record, lost, checked });
      }
      if (records.some((entry) => entry.checked.length + entry.lost.length > 0)) {
        groups.push({ name: collection.name, line: collection.line, records });
      }
    }

    // Set-of-strings exemptions (`new Set([...])` of "file.ts:Class.method")
    // are records with one field; the reader above skips them because they
    // have no `key: value` pairs, so they are read here.
    for (const collection of literalCollections(lines)) {
      if (!EXEMPTION_NAME.test(collection.name)) continue;
      if (seen.has(`${collection.name}:${collection.line}`)) continue;
      if (collection.entries.length === 0) continue;
      if (!collection.entries.some((entry) => entry.includes(":") || entry.includes("."))) continue;
      const records: ExemptionCheck[] = [];
      for (const entry of collection.entries) {
        const parts = entry.split(":");
        const { lost, checked } = checkExemption(scope, file, parts);
        records.push({ record: { line: collection.line, strings: parts, fields: [] }, lost, checked });
      }
      if (records.some((entry) => entry.checked.length + entry.lost.length > 0)) {
        groups.push({ name: collection.name, line: collection.line, records });
      }
    }

    if (file.endsWith(".json")) {
      const fields = jsonStringFields(lines, (key) => /skip|exempt|divergence|waiv/i.test(key));
      if (fields.length > 0) {
        const records: ExemptionCheck[] = fields.map((field) => {
          const { lost, checked } = checkExemption(scope, file, [field.value]);
          return { record: { line: field.line, strings: [field.value], fields: [field] }, lost, checked };
        });
        groups.push({ name: "conformance skips", line: fields[0]?.line ?? 1, records });
      }
    }

    for (const group of groups) {
      const broken = group.records.filter((entry) => entry.lost.length > 0);
      const totalChecked = group.records.reduce((sum, entry) => sum + entry.checked.length, 0);
      if (totalChecked === 0 && broken.length === 0) continue;

      if (broken.length > 0) {
        findings.push(
          decayed("owed", {
            title: `${group.name} states ${broken.length} reason(s) naming something no longer in the repository`,
            file,
            line: broken[0]?.record.line ?? group.line,
            evidence: broken
              .slice(0, 6)
              .map(
                (entry) =>
                  `${file}:${entry.record.line}\n  reason names: ${entry.lost.join(", ")}\n  written: ${clip(entry.record.strings.join(" · "), 220)}`,
              )
              .join("\n\n"),
            detail:
              "An exemption is a claim with two halves: a thing exempted and a condition that justifies it. The condition here names something the corpus does not contain, so the half that made the exemption reviewable is gone while the exemption keeps applying. This is the most dangerous shape in the list, because it reads as considered.",
          }),
        );
        continue;
      }

      findings.push(
        decayed("load-bearing-despite-appearance", {
          title: `every stated reason in ${group.name} still names something that exists`,
          file,
          line: group.line,
          evidence:
            `${group.records.length} entries, ${totalChecked} named referents resolved against the corpus:\n` +
            group.records
              .flatMap((entry) => entry.checked)
              .slice(0, 8)
              .map((entry) => `  ${entry}`)
              .join("\n"),
          detail:
            "The condition each entry describes still has a subject in the tree. This is exactly the case worth recording: the list looks like accumulated debt, and every entry in it is still doing the job it was written for. Nothing here is owed.",
        }),
      );
    }
  }
  return findings;
}

// ── check 3: ratchets that only move one way ─────────────────────────────

interface NumericConstant {
  name: string;
  value: number;
  line: number;
}

function numericConstants(lines: readonly string[]): NumericConstant[] {
  const out: NumericConstant[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^[ \t]*(?:export[ \t]+)?(?:const|let|var|readonly)?[ \t]*([A-Z][A-Z0-9_]{3,})[ \t]*(?::[^=]*)?=[ \t]*(\d+)[ \t]*[;,]?[ \t]*(?:\/\/.*)?$/.exec(
      lines[i] ?? "",
    );
    if (match === null) continue;
    out.push({ name: match[1] ?? "", value: Number(match[2]), line: i + 1 });
  }
  return out;
}

/** Lengths of the top-level arrays in a JSON document, or `[]` if the
 *  text is not JSON. A manifest holds its list this way rather than as a
 *  `const NAME = [ … ]`, and the manifest is the one that matters most. */
function jsonArrays(text: string): number[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed === null || typeof parsed !== "object") return [];
    return Object.values(parsed as Record<string, unknown>)
      .filter((value): value is unknown[] => Array.isArray(value))
      .map((value) => value.length);
  } catch {
    return [];
  }
}

/** Does anything in the corpus regenerate this file, and does the file say so? */
function regenerator(scope: Scope, file: string): string | null {
  const text = scope.read(file) ?? "";
  const declared = /(`?[\w./-]+\s+--(?:write|update|regen)[\w-]*`?)/.exec(text);
  if (declared !== null) return declared[1] ?? null;
  for (const other of scope.filesContaining(file.slice(file.lastIndexOf("/") + 1))) {
    if (other === file) continue;
    const match = /--(?:write|update|regen)[\w-]*/.exec(scope.read(other) ?? "");
    if (match !== null) return `${other} (${match[0]})`;
  }
  return null;
}

function checkRatchets(scope: Scope): Finding[] {
  const findings: Finding[] = [];
  for (const file of scope.files) {
    const text = scope.read(file);
    if (text === null) continue;
    if (!MONOTONIC_CLAIM.test(text)) continue;
    const lines = scope.lines(file);

    // The first line that both makes the claim and is a place a claim is
    // published. Taking the first match anywhere would anchor the finding
    // at whichever line happened to quote the phrase first.
    let claimLine = 0;
    for (let i = 0; i < lines.length; i += 1) {
      const candidate = lines[i] ?? "";
      if (!MONOTONIC_CLAIM.test(candidate) || !COUNTABLE_SUBJECT.test(candidate)) continue;
      if (SOURCE_EXTENSION.test(file) && !CLAIM_POSITION.test(candidate)) continue;
      claimLine = i + 1;
      break;
    }
    if (claimLine === 0) continue;
    const claimText = lines[claimLine - 1] ?? "";

    // A direction claim is only checkable when the file holds the thing
    // whose direction is claimed. A doctrine page that says a value never
    // regresses is describing someone else's number.
    const bounds = numericConstants(lines).filter((constant) => RATCHET_CONSTANT.test(constant.name));
    const holdsList =
      literalCollections(lines).some((collection) => collection.entries.length >= 3) ||
      jsonArrays(text).some((length) => length >= 3);
    if (bounds.length === 0 && !holdsList) continue;

    // Does the file record a position to ratchet against? A monotonic
    // claim is unfalsifiable without one: "only shrinks" compares this
    // value to the previous value, and nothing here remembers it.
    const remembers =
      /"[\w]*(?:previous|prior|high_?water|_was|was_|history|ceiling)[\w]*"\s*:/i.test(text) ||
      /\b(?:PREVIOUS|PRIOR|HIGH_?WATER|LAST_[A-Z]+)[A-Z_]*\b/.test(text);

    // Self-reported totals: a count the file writes about itself, checked
    // against the arrays it actually carries.
    const declaredTotal = /"_?(?:total|count|size)"\s*:\s*(\d+)/i.exec(text);
    if (declaredTotal !== null) {
      let counted = 0;
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        for (const value of Object.values(parsed)) if (Array.isArray(value)) counted += value.length;
      } catch {
        counted = -1;
      }
      const declared = Number(declaredTotal[1]);
      if (counted >= 0 && counted === declared) {
        findings.push(
          decayed("load-bearing-despite-appearance", {
            title: `${file.slice(file.lastIndexOf("/") + 1)} reports ${declared} entries and carries ${counted}`,
            file,
            line: lineOf(lines, declaredTotal[0]),
            evidence: `${declaredTotal[0]}\ncounted from the arrays in this file: ${counted}`,
            detail:
              "The self-report matches the contents, so the number a reader quotes from the header is the number the file holds. Worth recording because this is the half of the file's claim that *is* checkable by reading it — the direction claim is not.",
          }),
        );
      }
      if (counted >= 0 && counted !== declared) {
        findings.push(
          decayed("owed", {
            title: `${file} reports ${declared} entries and carries ${counted}`,
            file,
            line: lineOf(lines, declaredTotal[0]),
            evidence: `${declaredTotal[0]}\ncounted from the arrays in this file: ${counted}`,
            detail: "The file's self-report and its contents disagree, so the number a reader quotes is not the number the file holds.",
          }),
        );
      }
    }

    if (!remembers) {
      const writer = regenerator(scope, file);
      findings.push(
        decayed("owed", {
          title: `${file.slice(file.lastIndexOf("/") + 1)} claims a direction it records no position for`,
          file,
          line: claimLine,
          evidence:
            `${clip((lines[claimLine - 1] ?? "").trim(), 320)}\n\n` +
            `no field or constant in this file records a previous value ` +
            `(searched for previous/prior/was/high-water/last/ceiling/history)` +
            (writer === null ? "\nno regeneration command found for this file" : `\nregenerated by: ${writer}`),
          detail:
            "A monotonic claim compares a value to its own past. This file holds only its present, so nothing in the repository can tell a shrink from a growth — a regeneration satisfies the claim whichever way the number moved. The claim is a convention held by whoever remembers it, published in the same voice as the invariants that are enforced." +
            (writer === null
              ? ""
              : " The regeneration command exists, which is what makes the claim usable and also what makes it unenforceable: running it is indistinguishable from closing the gaps."),
        }),
      );
    }

    // A number used as a one-way bound. Ratcheting *down* is manual by
    // construction, so slack accumulates silently.
    for (const constant of bounds) {
      const comparison = lines.findIndex(
        (line, index) => index !== constant.line - 1 && line.includes(constant.name) && /[<>]=?/.test(line),
      );
      if (comparison === -1) continue;
      findings.push(
        decayed("owed", {
          title: `${constant.name} = ${constant.value} is a bound only a human can lower`,
          file,
          line: constant.line,
          evidence:
            `${(lines[constant.line - 1] ?? "").trim()}\n${file}:${comparison + 1}  ${clip((lines[comparison] ?? "").trim(), 200)}`,
          detail:
            "The comparison fails when the measured value rises, and does nothing when it falls. The distance between the bound and the current measurement is the amount of regression the gate silently permits, and no artefact in the repository records what that distance is — this probe cannot measure it either, because measuring it means running the file.",
        }),
      );
    }
  }
  return findings;
}

// ── check 4: dated registers, against the repository's own clock ─────────

interface Register {
  file: string;
  stampLine: number;
  date: string;
  /** Non-comment body lines. */
  entries: Array<{ line: number; text: string }>;
}

/** The status token a register's entries all begin with — `(fail) `,
 *  `[red] `, `FAIL: `. Read off the entries rather than assumed, and only
 *  accepted when most of them agree; a file whose lines do not share a
 *  leading token is a document, not a register. */
function sharedStatusToken(entries: readonly { text: string }[]): string | null {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const match = /^(\([\w-]+\)|\[[\w-]+\]|[A-Z]{3,10}:)\s/.exec(entry.text);
    if (match === null) continue;
    const token = match[1] ?? "";
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  for (const [token, count] of counts) {
    if (count >= entries.length * 0.6) return token;
  }
  return null;
}

function readRegisters(scope: Scope): Register[] {
  const out: Register[] = [];
  for (const file of scope.files) {
    const text = scope.read(file);
    if (text === null) continue;
    const lines = scope.lines(file);
    const head = lines.slice(0, 12).join("\n");
    const stamp = CAPTURE_STAMP.exec(head);
    if (stamp === null) continue;
    const entries: Array<{ line: number; text: string }> = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = (lines[i] ?? "").trim();
      if (line === "" || line.startsWith("#") || line.startsWith("//")) continue;
      entries.push({ line: i + 1, text: line });
    }
    if (entries.length < 5) continue;
    // Without a shared status token this is source or prose that happens
    // to say "generated on". A register's whole form is one repeated line.
    if (sharedStatusToken(entries) === null) continue;
    out.push({ file, stampLine: lineOf(lines, stamp[0]), date: stamp[2] ?? "", entries });
  }
  return out;
}

/** The descriptive head of a register entry: the part before the first
 *  ` > `, with a leading parenthesised status token removed. Both are
 *  facts about the entries themselves, read off the file rather than
 *  assumed — the shape only holds if most lines agree on it. */
function entryHead(text: string): string {
  const withoutStatus = text.replace(/^\([\w-]+\)\s+/, "");
  const split = withoutStatus.indexOf(" > ");
  return (split === -1 ? withoutStatus : withoutStatus.slice(0, split)).trim();
}

function checkRegisters(scope: Scope, inventories: readonly Inventory[], clock: RepositoryClock): Finding[] {
  const findings: Finding[] = [];
  const held = new Set<string>();
  for (const inventory of inventories) for (const hits of inventory.resolved.values()) for (const hit of hits) held.add(hit);

  for (const register of readRegisters(scope)) {
    if (clock.date !== null) {
      const age = daysBetween(register.date, clock.date);
      if (age !== null && age > 0) {
        findings.push(
          decayed(age > 30 ? "owed" : "load-bearing-despite-appearance", {
            title: `${register.file} was captured ${age} days before the newest dated artefact in the tree`,
            file: register.file,
            line: register.stampLine,
            evidence:
              `${clip((scope.lines(register.file)[register.stampLine - 1] ?? "").trim(), 160)}\n` +
              `newest dated filename in the corpus: ${clock.source} (${clock.date})\n` +
              `${register.entries.length} entries recorded at capture time`,
            detail:
              age > 30
                ? "The register describes a state of the repository that the repository has moved past. Nothing refreshes it, and a stale register is greener than an empty one: it absorbs the failures it lists, including the ones that have since been fixed and the ones that have since changed meaning."
                : "Recent relative to the tree's own motion. Recorded so the age is a measured number rather than an impression.",
          }),
        );
      }
    }

    // Cross-register: this file says these are known-red. Does any
    // held-back inventory in the repository agree?
    const subjects = new Map<string, string[]>(); // corpus file → entry texts
    let unlocated = 0;
    for (const entry of register.entries) {
      const head = entryHead(entry.text);
      if (head.length < 12) continue;
      const carriers = scope
        .filesContaining(head)
        .filter((file) => file !== register.file && TEST_PATH.test(file));
      if (carriers.length === 0) {
        unlocated += 1;
        continue;
      }
      for (const carrier of carriers) subjects.set(carrier, [...(subjects.get(carrier) ?? []), head]);
    }
    if (subjects.size === 0) continue;

    const unheld = [...subjects.keys()].filter((file) => !held.has(file)).sort();
    const heldSubjects = [...subjects.keys()].filter((file) => held.has(file));

    if (unlocated === 0) {
      findings.push(
        decayed("load-bearing-despite-appearance", {
          title: `every entry in ${register.file} still names something written in the tree`,
          file: register.file,
          line: 1,
          evidence: `${register.entries.length} entries; ${subjects.size} distinct carrier files located by verbatim match of the entry's descriptive head`,
          detail:
            "The register has not gone decorative in the usual way — no entry names a test title that has been renamed or deleted. Its staleness, if any, is in the outcomes it asserts rather than in the subjects it names.",
        }),
      );
    }

    if (unheld.length > 0) {
      findings.push(
        decayed("owed", {
          title: `${register.file} calls ${unheld.length} file(s) known-red that no held-back inventory holds`,
          file: register.file,
          line: 1,
          evidence:
            unheld
              .slice(0, 10)
              .map((file) => `${file}\n    e.g. "${clip(subjects.get(file)?.[0] ?? "", 90)}"`)
              .join("\n") +
            (unheld.length > 10 ? `\n… and ${unheld.length - 10} more` : "") +
            `\n\nheld by an inventory: ${heldSubjects.length} file(s)\ninventories consulted: ${inventories
              .filter((inventory) => HELD_BACK_NAME.test(inventory.name))
              .map((inventory) => `${inventory.file}:${inventory.line} ${inventory.name}`)
              .join(", ")}`,
          detail:
            "Two registers of the same fact — what is known to fail here — and neither is derived from the other. A file in this list and in no inventory is either passing now (so the register is stale) or failing inside a tier that reports green (so the inventory is). Both readings are worth an action; nothing in the repository distinguishes them, because nothing compares the two lists. Some of these are classified by directory rather than by name, which this check cannot see.",
        }),
      );
    }
  }
  return findings;
}

// ── check 5: deprecations past their stated removal ──────────────────────

function checkDeprecations(scope: Scope, clock: RepositoryClock): Finding[] {
  const findings: Finding[] = [];
  const conditionless: Array<{ file: string; line: number; text: string }> = [];

  for (const file of scope.files) {
    const text = scope.read(file);
    if (text === null || !/deprecat/i.test(text)) continue;
    const lines = scope.lines(file);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      if (!/@deprecated|\bdeprecated\b|\bDEPRECATED\b/.test(line)) continue;
      const window = lines.slice(i, i + 4).join("\n");
      const removal = REMOVAL_CONDITION.exec(window);
      const since = DEPRECATED_SINCE.exec(window);

      if (removal === null) {
        if (since === null) {
          // Only a declared tag counts here. Prose that uses the word is
          // describing a deprecation, not declaring one, and counting it
          // would make the number about the documentation.
          //
          // "Declared" also means the tag is not itself being quoted. A
          // tag inside a regex, a string or backticks is a detector or a
          // sentence about detectors — including the four in this very
          // function, which the first integrated run counted as four of
          // its own ten deprecation sites. A probe about things kept alive
          // past their condition does not get to inflate its own number
          // with its own source.
          if (isCommentLine(line) && DECLARED_DEPRECATION.test(line)) {
            conditionless.push({ file, line: i + 1, text: clip(line.trim(), 120) });
          }
          continue;
        }
        const stated = since[1] ?? "";
        if (/^\d{4}-/.test(stated) && clock.date !== null) {
          const age = daysBetween(stated, clock.date);
          if (age !== null && age > 180) {
            findings.push(
              decayed("owed", {
                title: `deprecated ${age} days ago by the tree's own clock, with no removal condition`,
                file,
                line: i + 1,
                evidence: `${clip(window, 320)}\n\nrepository clock: ${clock.date} (${clock.source})`,
                detail:
                  "A deprecation with a start and no end cannot expire. It states that the thing is unwanted and leaves no condition under which anyone is allowed to act, so the removal never becomes owed and the shim is load-bearing forever by default.",
              }),
            );
          }
        }
        continue;
      }

      const stated = removal[1] ?? "";
      const governing = governingVersion(scope, file);
      if (governing === null) continue;
      if (compareVersions(governing.version, stated) < 0) continue;

      // Is the thing it was going to remove still here? Names on the line
      // that resolve to a corpus file answer that.
      const named = [...line.matchAll(/([A-Za-z_$][\w$-]*\.(?:ts|tsx|py|js|mjs|sql|sh))/g)].map((match) => match[1] ?? "");
      const alive = named.filter((name) => resolveSubject(scope, name, file).length > 0);
      const gone = named.filter((name) => resolveSubject(scope, name, file).length === 0);

      if (named.length > 0 && alive.length === 0) {
        findings.push(
          decayed("compostable", {
            title: `${file} still schedules ${gone.join(", ")} for removal in ${stated}; the file is already gone`,
            file,
            line: i + 1,
            evidence:
              `${clip(line.trim(), 260)}\n\n` +
              `${governing.manifest}:${governing.line} declares version ${governing.version}\n` +
              gone.map((name) => `${name} → no file in the corpus`).join("\n"),
            detail:
              "The removal happened; the note did not. A module inventory that lists a file the repository no longer contains sends a reader looking for it, and is the kind of wrong that survives because nothing reads a doc against the tree.",
          }),
        );
        continue;
      }

      findings.push(
        decayed("owed", {
          title: `removal was scheduled for ${stated}; ${governing.manifest.split("/").slice(0, -1).join("/") || "."} is at ${governing.version}`,
          file,
          line: i + 1,
          evidence:
            `${clip(window, 300)}\n\n${governing.manifest}:${governing.line} → version ${governing.version}` +
            (alive.length > 0 ? `\nstill present: ${alive.map((name) => resolveSubject(scope, name, file)[0]).join(", ")}` : ""),
          detail:
            "The condition the deprecation set for itself has passed and the subject is still here. This is the only shape in this probe that carries its own deadline; everything else has to be inferred.",
        }),
      );
    }
  }

  if (conditionless.length > 0) {
    findings.push(
      decayed("owed", {
        title: `${conditionless.length} @deprecated site(s) in the tree state no removal condition at all`,
        file: conditionless[0]?.file ?? "",
        line: conditionless[0]?.line ?? 0,
        evidence:
          conditionless
            .slice(0, 8)
            .map((entry) => `${entry.file}:${entry.line}  ${entry.text}`)
            .join("\n") + (conditionless.length > 8 ? `\n… and ${conditionless.length - 8} more` : ""),
        detail:
          "One finding rather than one per site, because the count is the observation and a wall of identical lines is not evidence. None of these can ever become owed: with no version and no date, there is no moment at which a reader is permitted to act, so the deprecated surface is carried indefinitely at no stated cost.",
      }),
    );
  }
  return findings;
}

// ── check 6: tests skipped outright ──────────────────────────────────────

function checkHardSkips(scope: Scope): Finding[] {
  const findings: Finding[] = [];
  for (const file of scope.files) {
    // A skipped assertion lives in a test file. Restricting to them is
    // what stops this probe reporting its own regular expression, which
    // an earlier pass did — accurately, and uselessly.
    if (!TEST_PATH.test(file)) continue;
    const text = scope.read(file);
    if (text === null) continue;
    if (!/\.skip\s*\(|@pytest\.mark\.skip/.test(text)) continue;
    const lines = scope.lines(file);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      const skip = HARD_SKIP.exec(line) ?? PYTEST_SKIP.exec(line);
      if (skip === null) continue;
      // Anchor on `.skip` itself: the match may start one character
      // earlier, and that character is exactly the quote that would tell
      // us this is a fixture rather than a skip.
      if (insideStringLiteral(line, Math.max(skip.index, line.indexOf(".skip", skip.index)))) continue;
      // A conditional skip is an environment gate, not an accommodation.
      if (/\?\s*test\s*:|skipIf|process\.env|Bun\.env|os\.environ/.test(line)) continue;

      // The reason is whatever comment sits above the skip, plus the title.
      const reason: string[] = [];
      for (let j = i - 1; j >= 0; j -= 1) {
        const above = (lines[j] ?? "").trim();
        if (above === "") break;
        if (!/^(\/\/|\*|\/\*|#)/.test(above)) break;
        reason.unshift(above.replace(/^(\/\/|\*|\/\*|#)\s?/, ""));
      }
      const window = lines.slice(i, i + 2).join("\n");
      const template = /`([^`]*)`/.exec(window);
      const title = stringLiterals(window)[0] ?? template?.[1] ?? "";
      const stated = [...reason, title].join(" ");

      // A title interpolating a value carries its reason in data rather
      // than in source. The data is an exemption list of its own, and it
      // is checked by the exemption pass — so this is a live accommodation
      // with a checked condition, not an unreasoned one.
      if (template !== null && template[1]?.includes("${") === true) {
        const fields = [...template[1].matchAll(/\$\{[\w.]*?([\w]+)\}/g)].map((match) => match[1] ?? "");
        const sources = fields.flatMap((field) => scope.filesContaining(`"${field}"`)).filter((hit) => hit !== file);
        findings.push(
          decayed("load-bearing-despite-appearance", {
            title: `skips are generated from a fixture, one per recorded divergence`,
            file,
            line: i + 1,
            evidence:
              `${clip(window.trim(), 220)}\n\n` +
              `reason supplied at run time by: ${[...new Set(sources)].slice(0, 3).join(", ") || "(no corpus file declares these keys)"}`,
            detail:
              "The skip carries no reason of its own because the reason is data, and the data is a recorded divergence between two implementations. That is the honest shape: the count of skips tracks the count of unresolved divergences, and a resolved one disappears from both at once.",
          }),
        );
        continue;
      }

      if (reason.length === 0 && !/skip|todo|pending/i.test(title)) {
        findings.push(
          decayed("owed", {
            title: `a test is skipped with no stated reason`,
            file,
            line: i + 1,
            evidence: clip(lines.slice(Math.max(0, i - 1), i + 2).join("\n"), 260),
            detail:
              "A skip with no reason has no condition, so it cannot be checked and cannot expire. It is the cheapest way for an assertion to stop being an assertion while still being counted in the file.",
          }),
        );
        continue;
      }

      // Does the reason delegate to another test — and is that test itself
      // skipped? A substitute that does not run is not a substitute.
      const named = [...stated.matchAll(/([\w.-]+\.(?:test|spec)\.[cm]?[jt]sx?|test_[\w-]+\.py)/g)].map((match) => match[1] ?? "");
      const delegatesToSkipped: string[] = [];
      for (const name of named) {
        for (const hit of resolveSubject(scope, name, file)) {
          if (hit === file) continue;
          const other = scope.read(hit) ?? "";
          const otherLines = scope.lines(hit);
          const live = otherLines.some(
            (candidate) =>
              /(?:^|[^.\w])(test|it)\s*\(\s*["'`]/.test(candidate) && !/\.skip/.test(candidate),
          );
          if (!live && /\.skip\s*\(/.test(other)) delegatesToSkipped.push(hit);
        }
      }

      if (delegatesToSkipped.length > 0) {
        findings.push(
          decayed("owed", {
            title: `this skip is justified by a test that is itself skipped`,
            file,
            line: i + 1,
            evidence:
              `${clip(reason.join("\n"), 300)}\n\nnamed as the substitute: ${delegatesToSkipped.join(", ")}\n` +
              delegatesToSkipped
                .map((hit) => `${hit}:${scope.lines(hit).findIndex((candidate) => /\.skip\s*\(/.test(candidate)) + 1}  (skipped, no live test in the file)`)
                .join("\n"),
            detail:
              "The reason defers coverage to somewhere else, and that somewhere else defers it too. Each skip is individually reasoned and the pair covers nothing — which is invisible from inside either file, because each one names a real path to a real test.",
          }),
        );
        continue;
      }

      const lostReferents = checkExemption(scope, file, [stated]).lost;
      if (lostReferents.length > 0) {
        findings.push(
          decayed("owed", {
            title: `a skip's stated reason names ${lostReferents.join(", ")}, which is not in the tree`,
            file,
            line: i + 1,
            evidence: `${clip(reason.join("\n"), 300)}\n\nnot found in the corpus: ${lostReferents.join(", ")}`,
            detail: "The condition was written against something the repository no longer contains, so the reason can no longer be evaluated by reading it.",
          }),
        );
        continue;
      }

      findings.push(
        decayed("load-bearing-despite-appearance", {
          title: `skipped, with a reason whose subjects are all still in the tree`,
          file,
          line: i + 1,
          evidence: `${clip(reason.join("\n") || title, 320)}`,
          detail:
            "The assertion does not run, and the condition that stopped it is still the condition. Recorded so the reader sees it as a known cost rather than as a passing test — and so that if the condition ever changes, this line is where to look.",
        }),
      );
    }
  }
  return findings;
}

// ── the probe ────────────────────────────────────────────────────────────

export const decayProbe: Probe = {
  id: ID,
  title: "decay — what is dead, and what is kept alive past its condition",
  question: "For every accommodation in this repository, is the condition that justified it still true?",
  limits: LIMITS,
  run(scope: Scope): Finding[] {
    const clock = repositoryClock(scope);
    const inventories = collectInventories(scope);

    const findings = [
      ...checkHeldBack(scope, inventories),
      ...checkDivergentCopies(scope, inventories),
      ...checkExemptions(scope),
      ...checkRatchets(scope),
      ...checkRegisters(scope, inventories, clock),
      ...checkDeprecations(scope, clock),
      ...checkHardSkips(scope),
    ];

    if (clock.date === null) {
      findings.push({
        probe: ID,
        title: "this repository writes no dated filename, so decay has no clock here",
        file: "packages/rhizome/src/probes/decay/clock.ts",
        line: 60,
        verdict: "limit",
        evidence: `${scope.files.length} files scanned; 0 carried a YYYYMMDD or YYYY-MM-DD basename`,
        detail:
          "Every age measurement in this probe is silent rather than wrong: registers and deprecations are still checked for lost referents, but nothing is reported as old.",
      });
    }
    return findings;
  },
};
