/** rhizome/probes/edge — enumeration boundaries.
 *
 *  The probe for the failure that recurred four times in a row, each round
 *  smaller than the last:
 *
 *    1. a URL-encoding fix landed on 5 clients; 20+ others had the same
 *       hole, unexamined;
 *    2. an at-rest authority fix closed one 428 dead-end; `memory.elevate`
 *       had the identical one, unexamined;
 *    3. the doctrine drift report was numerically exact — and its scanner
 *       hard-coded `SCAN_DIRS = [api/src, bin]`, so it never saw
 *       `packages/`, where 12 orphan annotations sat;
 *    4. that blind spot was fixed in `annotations.ts` — while two doctrine
 *       tests each still carry their own private copy of the old list.
 *
 *  One shape: **an enumeration has a boundary it cannot see, and the
 *  report treats that boundary as the whole set.** A bounded region looks
 *  complete precisely because you cannot see its edge from inside it.
 *
 *  So this probe never asks "is the list right?" — from inside the list
 *  that question has no answer. It asks: **is the scope derived, asserted,
 *  or silently hard-coded?**
 *
 *    derived     the scope is read from the tree at run time. Cannot go
 *                stale. Nothing to report except that it is fine.
 *    asserted    a literal list that is exported, carries a real reason,
 *                and is named by a test that would fail if it went stale.
 *                This is *fine* and is reported as `sound` — the point is
 *                that a reader stops re-investigating it.
 *    hard-coded  a literal list missing one of those three. Reported as a
 *                `gap`, naming which of the three is absent.
 *
 *  Every corpus this probe uses is derived from `Scope`, which is itself
 *  two independent derivations cross-checked. There is no directory list
 *  in this file.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { compileIgnoreFile } from "../gitignore.js";
import { clip, lineOf, literalCollections, literalUnions, stringLiterals } from "../source.js";
import type { Finding, Probe, ProbeLimit, Scope } from "../types.js";

const ID = "edge";

/** JSDoc tags that are syntax, not domain markers. Filtering these out
 *  costs a missed marker at worst; keeping them would make every
 *  commented file look like a scanner. */
const SYNTAX_TAGS = new Set([
  "param", "returns", "return", "throws", "example", "deprecated", "see", "since",
  "type", "typedef", "module", "default", "link", "todo", "internal", "public",
  "private", "override", "template", "property", "author", "license", "file",
  "packagedocumentation", "remarks", "inheritdoc", "constructor", "async", "yields",
]);

/** Names that announce "this is the set of places I look". */
const SCOPE_NAME = /(SCAN|ROOT|ROOTS|DIR|DIRS|PATH|PATHS|SOURCE|SOURCES|TREE|TREES|TARGET|TARGETS|AREA|AREAS)$/i;

/** Names that announce "these are the ones I let through". */
const ALLOWLIST_NAME = /(ALLOW|EXEMPT|IGNORE|SKIP|EXCLUD|EXCLUS|KNOWN|BASELINE|WHITELIST|LEGACY|GRANDFATHER|WAIVER|SUPPRESS)/i;

/** Textual signature of a filesystem walk in any of this tree's languages. */
const WALKS_THE_TREE = /readdirSync|readdir\s*\(|opendir|scandir|os\.walk|new Glob\b|globSync|Bun\.Glob|glob\.glob|find\s+-name/;

/** A single line has to name this many members before it reads as the
 *  member set rather than as a sentence that happens to mention three
 *  packages. */
const SINGLE_LINE_THRESHOLD = 6;

/** A line template repeated once per member — `cd <member> && bun run ci`
 *  — reads as an enumeration at this many repeats. */
const REPEATED_LINE_THRESHOLD = 4;

/** Extensions the member-set check does not look at. Prose enumerating
 *  packages goes stale too, but a stale sentence is a documentation
 *  concern, not a guarantee wearing the wrong shape, and reporting every
 *  doc that lists four packages is the severity theatre this package
 *  refuses. Stated here rather than filtered silently, and published as a
 *  probe limit. */
const PROSE_EXTENSIONS: readonly string[] = [".md", ".mdx", ".txt"];

const LIMITS: readonly ProbeLimit[] = [
  {
    statement:
      "reads source as text, not as a parse tree, so an enumeration built by a computed expression, spread, or generated file is invisible to it",
    why: "a TypeScript parser would raise precision on .ts and none on the .py/.sql/.sh/.yml/.json files that carry the same enumerations; a probe that understands one language has an unstated extension boundary, which is the thing being hunted",
    file: "packages/rhizome/src/source.ts",
    line: 1,
  },
  {
    statement: "a literal collection whose body runs longer than 200 lines is skipped rather than half-read",
    why: "unbounded bracket matching over a 2,700-file tree; the bound is stated here so a skipped literal is a known miss rather than a silent one",
    file: "packages/rhizome/src/source.ts",
    line: 103,
  },
  {
    statement:
      "the closed-union check only knows vocabularies spelled `urn:<namespace>:<kind>/`; a closed union over a vocabulary carried some other way is not checked",
    why: "the vocabulary has to be derivable from the tree to be trustworthy, and URNs are the one vocabulary in this repository that is",
    file: "packages/rhizome/src/probes/edge.ts",
    line: 0,
  },
  {
    statement:
      "the member-set check skips .md/.mdx/.txt, so a documentation tree that lists nine of twenty-three packages is not reported",
    why: "a stale sentence is a documentation concern rather than a guarantee wearing the wrong shape, and flagging every doc that names four packages is severity theatre",
    file: "packages/rhizome/src/probes/edge.ts",
    line: 0,
  },
  {
    statement:
      "the skip-list check only counts ignored directories that exist at the repository root, so an ignored directory that only ever appears nested is not reported",
    why: "listing every nested occurrence would mean walking the trees the corpus deliberately excludes, which is the thing being measured",
    file: "packages/rhizome/src/probes/edge.ts",
    line: 0,
  },
  {
    statement:
      "staleness of an allowlist is only checkable for entries that look like repository paths; entries that are opaque ids are counted, not checked",
    why: "an opaque id has no derivable referent, so asserting it is stale would be a guess presented as a finding",
    file: "packages/rhizome/src/probes/edge.ts",
    line: 0,
  },
];

/** Does `marker` sit at an annotation position in this text — the first
 *  token after a comment margin?
 *
 *  This separates `@enforces`, which files write as ` *  @enforces urn:…`,
 *  from `@noble`, which files write as `import … from "@noble/ciphers"`.
 *  Both appear inside a regular expression somewhere; only one is a
 *  vocabulary the tree annotates itself with. Without this, the extension
 *  check reports that a wall test "reads only .ts while @noble is carried
 *  by .lock, .json, .html", which is true and means nothing. */
function carriesAtAnnotationPosition(text: string, marker: string): boolean {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^[\\s>]*(?:/\\*+|\\*|//|#|--|<!--|"""|;)\\s*${escaped}\\b`, "m").test(text);
}

function isTestPath(file: string): boolean {
  return (
    /(^|\/)(tests?|__tests__)\//.test(file) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) ||
    /(^|\/)test_[^/]+\.py$/.test(file) ||
    /_test\.py$/.test(file)
  );
}

function extensionOf(file: string): string {
  const base = file.slice(file.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "";
}

/** Domain markers a file greps *for* — `@enforces`, `@absence` — as
 *  opposed to `@` characters the file merely contains.
 *
 *  The distinction is load-bearing. An earlier version counted every
 *  `@word` in the file and decided `wall-strand-thoughts-never-decrypted
 *  .test.ts` was scanning for `@noble`, which is an npm scope in an import
 *  line. So a marker is only a marker when it appears inside a regular
 *  expression or inside a string literal handed to a matching operation:
 *  the places where a file is doing the searching rather than the
 *  importing. Derived from the file's own text, so the sweep that follows
 *  uses the file's vocabulary and not one this probe invented. */
function markersIn(text: string): string[] {
  const searchContexts: string[] = [];
  for (const match of text.matchAll(/\/((?:[^/\\\n[]|\\.|\[[^\]\n]*\])+)\/[gimsuyd]*/g)) {
    searchContexts.push(match[1]!);
  }
  for (const match of text.matchAll(
    /\.(?:includes|indexOf|startsWith|endsWith|match|matchAll|test|search|split)\(\s*["'`]([^"'`]+)["'`]/g,
  )) {
    searchContexts.push(match[1]!);
  }

  const counts = new Map<string, number>();
  for (const context of searchContexts) {
    for (const match of context.matchAll(/@([a-z][a-z0-9-]{3,})/g)) {
      const tag = match[1]!;
      if (SYNTAX_TAGS.has(tag.toLowerCase())) continue;
      counts.set(`@${tag}`, (counts.get(`@${tag}`) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([marker]) => marker);
}

/** Does any test in the tree name this symbol? That is what makes a
 *  literal list *asserted* rather than merely commented: something goes
 *  red when it stops being true. */
function testsNaming(scope: Scope, symbol: string, declaringFile: string): string[] {
  if (symbol.length < 4) return [];
  // A test that declares its own `SCAN_DIRS` is not checking anyone
  // else's. Counting it would let two identical private copies vouch for
  // each other, which is the failure rather than the check.
  const declaresItself = new RegExp(`(?:const|let|var)\\s+${symbol}\\b`);
  return scope
    .filesContaining(symbol)
    .filter((file) => file !== declaringFile && isTestPath(file))
    .filter((file) => !declaresItself.test(scope.read(file) ?? ""))
    .slice(0, 4);
}

interface DirectoryScope {
  file: string;
  line: number;
  name: string;
  exported: boolean;
  comment: string;
  entries: string[];
  key: string;
  classification: "asserted" | "hard-coded";
  missing: string[];
  tests: string[];
}

function collectDirectoryScopes(scope: Scope): DirectoryScope[] {
  const out: DirectoryScope[] = [];
  for (const file of scope.files) {
    const text = scope.read(file);
    if (text === null) continue;
    const scannerish = WALKS_THE_TREE.test(text);
    const lines = scope.lines(file);
    for (const collection of literalCollections(lines)) {
      if (collection.entries.length < 2) continue;
      if (!collection.entries.every((entry) => scope.directories.has(entry))) continue;
      if (!scannerish && !SCOPE_NAME.test(collection.name)) continue;

      const tests = testsNaming(scope, collection.name, file);
      const missing: string[] = [];
      if (!collection.exported) missing.push("not exported, so nothing outside this file can check it");
      if (collection.comment.length < 80) missing.push("no stated reason for the boundary");
      if (tests.length === 0) missing.push("no test names it, so it cannot go stale loudly");

      out.push({
        file,
        line: collection.line,
        name: collection.name,
        exported: collection.exported,
        comment: collection.comment,
        entries: [...collection.entries].sort(),
        key: [...collection.entries].sort().join(" · "),
        classification: missing.length === 0 ? "asserted" : "hard-coded",
        missing,
        tests,
      });
    }
  }
  return out;
}

/** Check 1 + 2: classify every directory scope, and find the private
 *  copies — the same scope literal living in several files, none of which
 *  learns when one of the others widens. */
function checkDirectoryScopes(scope: Scope, scopes: readonly DirectoryScope[]): Finding[] {
  const findings: Finding[] = [];
  const byKey = new Map<string, DirectoryScope[]>();
  for (const item of scopes) {
    byKey.set(item.key, [...(byKey.get(item.key) ?? []), item]);
  }
  const asserted = scopes.filter((item) => item.classification === "asserted");

  for (const item of scopes) {
    const quote = (scope.lines(item.file).slice(item.line - 1, item.line + item.entries.length + 1) ?? []).join("\n");

    if (item.classification === "asserted") {
      findings.push({
        probe: ID,
        title: `${item.name} is an asserted scope, not a hard-code`,
        file: item.file,
        line: item.line,
        verdict: "sound",
        evidence: `${clip(quote, 300)}\n\nnamed by: ${item.tests.join(", ")}`,
        detail:
          "Literal, but exported, reasoned in a comment above the declaration, and referenced by a test that fails when it goes stale. A bounded scope decided deliberately and re-decided under test is the correct shape; this entry exists so the next reader does not re-investigate it.",
      });
      continue;
    }

    // Is some other module already carrying a wider version of this list?
    const wider = asserted.find(
      (other) => other.entries.length > item.entries.length && item.entries.every((entry) => other.entries.includes(entry)),
    );

    const uncovered = wider ? wider.entries.filter((entry) => !item.entries.includes(entry)) : [];
    const markers = markersIn(scope.read(item.file) ?? "");
    const carrierEvidence: string[] = [];
    for (const marker of markers) {
      for (const carrier of scope.filesContaining(marker)) {
        if (isTestPath(carrier)) continue;
        if (!uncovered.some((entry) => carrier.startsWith(`${entry}/`))) continue;
        if (!carriesAtAnnotationPosition(scope.read(carrier) ?? "", marker)) continue;
        carrierEvidence.push(`${carrier}:${lineOf(scope.lines(carrier), marker)}  ${marker}`);
        if (carrierEvidence.length >= 4) break;
      }
      if (carrierEvidence.length >= 4) break;
    }

    const siblings = (byKey.get(item.key) ?? []).filter((other) => other !== item);
    const detailParts = [`Silently hard-coded: ${item.missing.join("; ")}.`];
    if (siblings.length > 0) {
      detailParts.push(
        `The identical list is spelled out in ${siblings.length} other place(s): ${siblings
          .map((other) => `${other.file}:${other.line}`)
          .join(", ")}. Widening one does not widen the others.`,
      );
    }
    if (wider) {
      detailParts.push(
        `${wider.file}:${wider.line} (${wider.name}) already carries a wider version of this same scope — ${wider.entries.join(", ")}. This copy is narrower by: ${uncovered.join(", ")}.`,
      );
    }

    findings.push({
      probe: ID,
      title:
        wider !== undefined
          ? `${item.name} is a private, narrower copy of ${wider.name}`
          : `${item.name} is a silently hard-coded scope`,
      file: item.file,
      line: item.line,
      verdict: "gap",
      evidence:
        clip(quote, 300) +
        (carrierEvidence.length > 0
          ? `\n\nnot seen by this scope, though it carries what this file greps for:\n${carrierEvidence.join("\n")}`
          : ""),
      detail: detailParts.join(" "),
    });
  }

  return findings;
}

/** Check 3: a closed string union used as an enumeration of an open
 *  vocabulary. The vocabulary is derived from the tree — every
 *  `urn:<namespace>:<kind>/` actually written down — so the union is
 *  measured against reality rather than against another list. */
function checkClosedUnions(scope: Scope): Finding[] {
  const vocabulary = new Map<string, Map<string, string>>(); // namespace → kind → "file:line"
  for (const file of scope.files) {
    const lines = scope.lines(file);
    for (let i = 0; i < lines.length; i += 1) {
      for (const match of (lines[i] ?? "").matchAll(/urn:([a-z][a-z0-9-]*):([a-z][a-z0-9-]*)\//g)) {
        const namespace = match[1]!;
        const kind = match[2]!;
        const kinds = vocabulary.get(namespace) ?? new Map<string, string>();
        if (!kinds.has(kind)) kinds.set(kind, `${file}:${i + 1}`);
        vocabulary.set(namespace, kinds);
      }
    }
  }

  const findings: Finding[] = [];
  for (const file of scope.files) {
    if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
    const text = scope.read(file);
    if (text === null) continue;
    for (const union of literalUnions(scope.lines(file))) {
      for (const [namespace, kinds] of vocabulary) {
        if (kinds.size < 3) continue;
        if (!text.includes(`urn:${namespace}:`)) continue;
        if (!union.members.every((member) => kinds.has(member))) continue;
        const uncovered = [...kinds.keys()].filter((kind) => !union.members.includes(kind));
        if (uncovered.length === 0) continue;

        const sample = uncovered
          .slice(0, 6)
          .map((kind) => `urn:${namespace}:${kind}/…  first written at ${kinds.get(kind)}`);
        findings.push({
          probe: ID,
          title: `${union.name} closes a vocabulary that is open in the tree`,
          file,
          line: union.line,
          verdict: "gap",
          evidence:
            `type ${union.name} = ${union.members.map((member) => `"${member}"`).join(" | ")}\n\n` +
            `urn:${namespace}: kinds actually present in the repository that the union does not admit:\n${sample.join("\n")}`,
          detail:
            `The union enumerates ${union.members.length} of the ${kinds.size} \`${namespace}\` kinds written in this tree. ` +
            "Anything keyed by this type covers only the enumerated kinds, and a kind outside it does not appear as a failure — it appears nowhere at all, which reads as absence of a problem.",
        });
        break;
      }
    }
  }
  return findings;
}

/** Check 4: an extension filter that excludes a carrier of the very
 *  marker the scanner is looking for. Excluding `.md` is often correct;
 *  excluding it *without saying so* is how `.sql` policies stopped
 *  counting as defenders without anyone deciding that they had. */
function checkExtensionFilters(scope: Scope): Finding[] {
  const findings: Finding[] = [];
  for (const file of scope.files) {
    const text = scope.read(file);
    if (text === null || !WALKS_THE_TREE.test(text)) continue;

    const filtered = new Set<string>();
    for (const match of text.matchAll(/endsWith\(\s*["'](\.[a-z0-9]+)["']/g)) filtered.add(match[1]!);
    for (const collection of literalCollections(scope.lines(file))) {
      if (collection.entries.length > 0 && collection.entries.every((entry) => /^\.[a-z0-9]+$/.test(entry))) {
        for (const entry of collection.entries) filtered.add(entry);
      }
    }
    if (filtered.size === 0) continue;

    for (const marker of markersIn(text)) {
      const carriers = scope
        .filesContaining(marker)
        .filter((carrier) => carrier !== file && !isTestPath(carrier))
        .filter((carrier) => carriesAtAnnotationPosition(scope.read(carrier) ?? "", marker));
      if (carriers.length === 0) continue;
      // If nothing inside the filter carries the marker, the marker is not
      // what this walk is looking for and the comparison would be a
      // coincidence dressed as a finding.
      if (!carriers.some((carrier) => filtered.has(extensionOf(carrier)))) continue;
      const byExtension = new Map<string, string>();
      for (const carrier of carriers) {
        const extension = extensionOf(carrier);
        if (filtered.has(extension)) continue;
        if (!byExtension.has(extension)) byExtension.set(extension, carrier);
      }
      if (byExtension.size === 0) continue;

      const undeclared = [...byExtension].filter(([extension]) => !text.includes(`"${extension}"`) && !text.includes(`'${extension}'`));
      const declared = [...byExtension].filter(([extension]) => text.includes(`"${extension}"`) || text.includes(`'${extension}'`));

      if (undeclared.length > 0) {
        findings.push({
          probe: ID,
          title: `scanner reads only ${[...filtered].sort().join(", ")} while ${marker} is carried by ${undeclared.map(([extension]) => extension).join(", ")}`,
          file,
          line: lineOf(scope.lines(file), "endsWith(") || lineOf(scope.lines(file), marker),
          verdict: "gap",
          evidence: undeclared
            .map(([extension, carrier]) => `${extension}  ${carrier}:${lineOf(scope.lines(carrier), marker)}`)
            .join("\n"),
          detail:
            `The extension filter is the scope here, and these carriers fall outside it. The excluded extensions are not named anywhere in ${file}, so the exclusion is an artefact of the filter rather than a stated position. ` +
            "Compare api/src/services/canon/annotations.ts, which declares each excluded carrier extension with the reason it is out.",
        });
      }
      if (declared.length > 0) {
        findings.push({
          probe: ID,
          title: `${file.slice(file.lastIndexOf("/") + 1)} names the carrier extensions it excludes`,
          file,
          line: lineOf(scope.lines(file), declared[0]![0]),
          verdict: "sound",
          evidence: declared.map(([extension, carrier]) => `${extension}  e.g. ${carrier}`).join("\n"),
          detail:
            "These extensions carry the marker and are outside the filter, but the file mentions them by name, so the exclusion is a stated position rather than a silent one.",
        });
      }
      break;
    }
  }
  return findings;
}

/** Check 5: an allowlist entry whose referent no longer exists. Nothing
 *  fails when an exemption outlives its subject; the list just quietly
 *  keeps granting an exemption to nothing. */
function checkAllowlists(scope: Scope): Finding[] {
  const findings: Finding[] = [];
  // "Looks like a repository path" has to mean something checkable, or the
  // check invents staleness. An entry qualifies only when its first
  // segment is a directory that exists at the top of this repository —
  // derived, so `application/octet-stream` and `["dignity-distinctness",
  // "safety-care"]` stop reading as paths without a stop-list.
  const topLevel = new Set([...scope.directories].filter((directory) => !directory.includes("/")));
  const pathish = (entry: string): boolean =>
    entry.includes("/") &&
    !entry.includes(" ") &&
    !entry.startsWith("http") &&
    topLevel.has(entry.slice(0, entry.indexOf("/")));
  const exists = (entry: string): boolean =>
    scope.files.includes(entry) || scope.directories.has(entry) || scope.files.some((file) => file.startsWith(`${entry}/`));

  for (const file of scope.files) {
    const text = scope.read(file);
    if (text === null) continue;

    const candidates: Array<{ name: string; line: number; entries: string[] }> = [];
    if (/\.(json|txt)$/.test(file) && ALLOWLIST_NAME.test(file)) {
      candidates.push({ name: file.slice(file.lastIndexOf("/") + 1), line: 1, entries: stringLiterals(text) });
    }
    for (const collection of literalCollections(scope.lines(file))) {
      if (!ALLOWLIST_NAME.test(collection.name)) continue;
      candidates.push({ name: collection.name, line: collection.line, entries: collection.entries });
    }

    for (const candidate of candidates) {
      const paths = candidate.entries.filter(pathish);
      if (paths.length === 0) continue;
      const stale = paths.filter((entry) => !exists(entry));
      if (stale.length === 0) {
        findings.push({
          probe: ID,
          title: `every path in ${candidate.name} still exists`,
          file,
          line: candidate.line,
          verdict: "sound",
          evidence: paths.slice(0, 6).join("\n"),
          detail: `${paths.length} path-shaped entries, all of which resolve in the tree today. Checked against the derived file corpus, not against another list.`,
        });
        continue;
      }
      findings.push({
        probe: ID,
        title: `${candidate.name} exempts ${stale.length} path(s) that no longer exist`,
        file,
        line: candidate.line,
        verdict: "gap",
        evidence: stale.slice(0, 8).join("\n"),
        detail:
          "An exemption whose subject is gone is not harmless: it is the part of the list nobody re-reads, and it makes the list look reviewed. Nothing in the repository fails when an entry here goes stale.",
      });
    }
  }
  return findings;
}

/** Check 6: an enumeration of workspace members, measured against the
 *  members actually on disk.
 *
 *  The same shape, one level up. The set of packages CI builds, preflight
 *  runs, and the release script publishes is derivable — every directory
 *  holding a `package.json` or `pyproject.toml` — and it is instead
 *  written out by hand in each of those files. Nothing compares the two,
 *  so a package that is never added is not reported as unbuilt; it is
 *  reported as nothing.
 *
 *  Only *machine* enumerations count. Prose that happens to name four
 *  packages is prose. The three admitted forms are: a literal collection
 *  whose entries are members, one line naming three or more, and a line
 *  template repeated once per member — which is what a shell script that
 *  runs the same command in each package looks like. */
function checkMemberEnumerations(scope: Scope): Finding[] {
  const members = new Set<string>();
  for (const file of scope.files) {
    const base = file.slice(file.lastIndexOf("/") + 1);
    if (base !== "package.json" && base !== "pyproject.toml") continue;
    const directory = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
    if (directory === "" || directory.includes("node_modules")) continue;
    members.add(directory);
  }
  if (members.size < 4) return [];
  const all = [...members].sort();

  // `packages/data` is a substring of `packages/data-sync`; a plain
  // includes() would report the second as covering the first and quietly
  // undercount what is missing.
  const mentions = (text: string, member: string): boolean => {
    let from = 0;
    for (;;) {
      const at = text.indexOf(member, from);
      if (at === -1) return false;
      const after = text[at + member.length] ?? "";
      const before = at === 0 ? "" : text[at - 1]!;
      if (!/[\w.@/-]/.test(after) && !/[\w.@-]/.test(before)) return true;
      from = at + 1;
    }
  };

  const findings: Finding[] = [];
  for (const file of scope.files) {
    if (PROSE_EXTENSIONS.some((extension) => file.endsWith(extension))) continue;
    const text = scope.read(file);
    if (text === null) continue;
    const lines = scope.lines(file);
    const listings: Array<{ line: number; form: string; named: Set<string> }> = [];

    for (const collection of literalCollections(lines)) {
      const named = new Set(collection.entries.filter((entry) => members.has(entry)));
      if (named.size >= 3) listings.push({ line: collection.line, form: `the literal list ${collection.name}`, named });
    }

    const templates = new Map<string, { line: number; named: Set<string>; sample: string }>();
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      const onThisLine = all.filter((member) => mentions(line, member));
      if (onThisLine.length >= SINGLE_LINE_THRESHOLD) {
        listings.push({ line: i + 1, form: "a single line naming several members", named: new Set(onThisLine) });
        continue;
      }
      if (onThisLine.length > 1) continue;
      if (onThisLine.length !== 1) continue;
      const member = onThisLine[0]!;
      const template = line.split(member).join("\u0000");
      const existing = templates.get(template);
      if (existing === undefined) {
        templates.set(template, { line: i + 1, named: new Set([member]), sample: line.trim() });
      } else {
        existing.named.add(member);
      }
    }
    for (const [, template] of templates) {
      if (template.named.size < REPEATED_LINE_THRESHOLD) continue;
      listings.push({
        line: template.line,
        form: `a line repeated once per member: ${clip(template.sample, 90)}`,
        named: template.named,
      });
    }

    // One finding per file, over the union of every listing in it. A
    // script that runs three different commands across three overlapping
    // subsets covers all three; reporting only the widest listing would
    // claim a member is absent from a file that plainly names it, which
    // would make the evidence wrong.
    const ordered = listings.sort((a, b) => b.named.size - a.named.size);
    const widest = ordered[0];
    if (widest !== undefined) {
      // Completeness is judged over the whole file, not over the listing
      // that identified it. A script that runs one command in eight
      // packages and a different command in three more covers eleven; the
      // listing is only how the file was recognised as an enumeration.
      const named = new Set(all.filter((member) => mentions(text, member)));
      const listing = {
        line: widest.line,
        named,
        form:
          ordered.length === 1
            ? widest.form
            : `${widest.form}, plus ${ordered.length - 1} more listing(s) in this file`,
      };
      const missing = all.filter((member) => !listing.named.has(member));
      if (missing.length === 0) {
        findings.push({
          probe: ID,
          title: `${file} runs over every workspace member on disk`,
          file,
          line: listing.line,
          verdict: "sound",
          evidence: `${listing.form}\nnames all ${all.length} directories holding a package.json or pyproject.toml`,
          detail:
            "Complete today. It is still a literal list rather than a derived one, so completeness is a fact about this commit, not a property of the file.",
        });
        continue;
      }
      findings.push({
        probe: ID,
        title: `${file} enumerates ${listing.named.size} of ${all.length} workspace members`,
        file,
        line: listing.line,
        verdict: "gap",
        evidence:
          `${listing.form}\n\nabsent, though each has its own manifest on disk:\n` +
          missing.map((member) => `${member}/`).join("\n"),
        detail:
          "The member set is derivable — every directory holding a package.json or pyproject.toml. This file spells it out instead, and nothing compares the two. A member missing here is not reported as skipped; it produces no output at all, which reads the same as passing.",
      });
    }
  }
  return findings;
}

/** Check 7: a scanner's private skip-list against the ignore rules the
 *  repository actually declares.
 *
 *  This is the same shape as the scope list, inverted. `annotations.ts`
 *  sweeps "the WHOLE repository" for stray annotations and hard-codes the
 *  directories it will not enter. The repository's own `.gitignore` names
 *  more of them than the set does, so the sweep descends into ignored
 *  trees — on this machine it walks `.claude/worktrees/`, and every file
 *  in every checked-out worktree is reported as a stray annotation. A
 *  sweep that reports 286 problems that are copies of the same twelve is
 *  not a stricter sweep; it is a sweep nobody can read.
 *
 *  The comparison set is parsed out of the `.gitignore` files in the
 *  corpus, so it cannot go stale relative to the repository. */
function checkSkipLists(scope: Scope): Finding[] {
  const declared = new Map<string, string>(); // directory name → .gitignore that names it
  for (const file of scope.files) {
    if (!file.endsWith(".gitignore")) continue;
    const text = scope.read(file);
    if (text === null) continue;
    const base = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
    for (const rule of compileIgnoreFile(base, text)) {
      if (!rule.directoryOnly || rule.negated || rule.anchored) continue;
      const name = rule.source.trim().replace(/\/$/, "");
      if (!/^[\w.-]+$/.test(name)) continue;
      if (!declared.has(name)) declared.set(name, file);
    }
  }
  if (declared.size === 0) return [];

  const findings: Finding[] = [];
  for (const file of scope.files) {
    const text = scope.read(file);
    if (text === null || !WALKS_THE_TREE.test(text)) continue;
    for (const collection of literalCollections(scope.lines(file))) {
      if (!ALLOWLIST_NAME.test(collection.name)) continue;
      if (collection.entries.length < 2) continue;
      if (!collection.entries.every((entry) => /^[\w.-]+$/.test(entry))) continue;
      if (!collection.entries.some((entry) => declared.has(entry))) continue;

      const missing = [...declared.keys()]
        .filter((name) => !collection.entries.includes(name))
        .filter((name) => existsSync(join(scope.root, name)))
        .sort();
      if (missing.length === 0) {
        findings.push({
          probe: ID,
          title: `${collection.name} covers every directory this repository ignores`,
          file,
          line: collection.line,
          verdict: "sound",
          evidence: collection.entries.join(", "),
          detail:
            "Checked against the directory-only rules parsed out of the .gitignore files in the corpus, so the comparison cannot go stale relative to the repository.",
        });
        continue;
      }
      findings.push({
        probe: ID,
        title: `${collection.name} walks into ${missing.length} director${missing.length === 1 ? "y" : "ies"} the repository ignores`,
        file,
        line: collection.line,
        verdict: "gap",
        evidence:
          `skips: ${collection.entries.join(", ")}\n\npresent at the repository root and ignored by .gitignore, but not skipped here:\n` +
          missing.map((name) => `${name}/  (named in ${declared.get(name) ?? ".gitignore"})`).join("\n"),
        detail:
          "A private skip-list is a scope decision made once and never re-read, while .gitignore keeps being edited. Walking an ignored tree does not fail — it multiplies: every copy of the repository inside it produces its own copy of every finding, and the report grows until it stops being read.",
      });
    }
  }
  return findings;
}

export const edgeProbe: Probe = {
  id: ID,
  title: "edge — enumeration boundaries",
  question: "Where this repository enumerates something, is the scope derived, asserted, or silently hard-coded?",
  limits: LIMITS,
  run(scope: Scope): Finding[] {
    const directoryScopes = collectDirectoryScopes(scope);
    return [
      ...checkDirectoryScopes(scope, directoryScopes),
      ...checkClosedUnions(scope),
      ...checkExtensionFilters(scope),
      ...checkAllowlists(scope),
      ...checkMemberEnumerations(scope),
      ...checkSkipLists(scope),
    ];
  },
};
