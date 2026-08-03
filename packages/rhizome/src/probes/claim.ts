/** rhizome/probes/claim — stated guarantees, and what holds them up.
 *
 *  This repository makes unusually strong architectural commitments in
 *  prose, and — unusually — a real fraction of them are enforced in code.
 *  That is what makes the unenforced ones hard to see. A reader who has
 *  checked three claims and found a signature requirement, a runtime
 *  refusal and a Postgres `CHECK` behind each of them learns to trust the
 *  register, and stops checking the fourth.
 *
 *  The template, verified by hand and reproduced by this probe:
 *
 *    "you cannot self-claim your own foundation"
 *      → api/src/services/memory/tiers.ts `constitutive_requires_attestation`,
 *        the key-ownership binding, the counterparty requirement, and
 *        `attester_self_witness_forbidden`, which rejects even two
 *        identities under one project.
 *
 *    covenant v2 → doctrine → canonical bytes → application verify →
 *      Postgres CHECK. A chain with no gap.
 *
 *  And the model outcome for a guarantee that is *not* held up:
 *
 *    api/src/services/economy/ring1-limits.ts states inside its own
 *    `@enforces` annotation that "resource routes do not currently enforce
 *    them… it is not evidence that cap callsites exist".
 *
 *  An annotation that confesses is better than a silent one, and this
 *  probe reports it as `sound` rather than as a gap. The thing worth
 *  finding is the guarantee that reads as enforced and is not, in either
 *  direction: prose that promises more than the code does, and prose that
 *  promises less.
 *
 *  ## Precision, stated up front
 *
 *  Natural language is not a spec, and this probe does not pretend
 *  otherwise. It never asks "is the sentence true?" — it asks the one
 *  question that is answerable from the tree: **is there a mechanism, and
 *  what kind?** Everything it reports carries the sentence verbatim and
 *  the `file:line` of every occurrence it classified, so a reader can
 *  overrule it in one glance. It reports a ranked shortlist, publishes how
 *  many candidates it suppressed and by what ranking, and treats its own
 *  shortlist boundary as a `limit` finding rather than as the whole set.
 *
 *  ## Every scope here is derived
 *
 *  The document corpus is `Scope.files` filtered by document format, and
 *  that filter is staleness-checked against the corpus itself: a file that
 *  reads as a document and carries an extension outside the set is
 *  reported as a `limit`. The claim register, the mechanism vocabulary and
 *  the confession vocabulary are word lists, not scopes — a missing word
 *  costs a missed claim, never a missed file. The canon registry is found
 *  by parsing every JSON document in the corpus and keeping the ones that
 *  are JSON-LD graphs; its path is nowhere in this file.
 */

import { clip, isCommentLine } from "../source.js";
import type { Finding, Probe, ProbeLimit, Scope } from "../types.js";

const ID = "claim";

/** Extensions read as documents.
 *
 *  Explicit, because "is this file prose?" has no derivation that is not
 *  itself a guess. Staleness-checked rather than trusted: `checkFormatSet`
 *  sweeps the whole corpus for files that read as markdown documents and
 *  carry an extension outside this set, and publishes any it finds as a
 *  `limit` finding. The boundary is therefore reviewable from rhizome's
 *  own output rather than from this line. */
const DOCUMENT_EXTENSIONS: readonly string[] = [".md", ".mdx"];

/** The load-bearing register, weighted by how much of a guarantee each
 *  form asserts. Not a scope: an omission here costs a missed sentence,
 *  and every weight is published in the finding that uses it. */
const REGISTER: ReadonlyArray<{ pattern: RegExp; weight: number; label: string }> = [
  { pattern: /\bmust not\b|\bMUST NOT\b/, weight: 4, label: "must not" },
  { pattern: /\bnever\b/i, weight: 4, label: "never" },
  { pattern: /\bcannot\b|\bcan not\b|\bcan't\b/i, weight: 4, label: "cannot" },
  // `refusal` is a domain noun in this tree — "refusal-language", "the
  // refusal is recorded" — and admitting it made every sentence about the
  // error vocabulary read as a guarantee. Only the verb counts.
  { pattern: /\brefuses\b|\brefuse to\b/i, weight: 4, label: "refuses" },
  { pattern: /\bforbidden\b|\bprohibited\b/i, weight: 4, label: "forbidden" },
  // Bare "reject" is a route name here — "cosign + reject + withdraw
  // endpoints" — so only the inflected verb reads as an assertion.
  { pattern: /\brejects\b|\b(?:is|are) rejected\b/i, weight: 3, label: "rejects" },
  { pattern: /\bimpossible\b|\bno way to\b/i, weight: 3, label: "impossible" },
  { pattern: /\balways\b/i, weight: 3, label: "always" },
  { pattern: /\bimmutable\b|\binsert-only\b|\bappend-only\b/i, weight: 3, label: "immutable" },
  { pattern: /\bguarantees?\b|\bguaranteed\b/i, weight: 3, label: "guarantees" },
  { pattern: /\bis free\b|\bare free\b/i, weight: 3, label: "is free" },
  { pattern: /\bmust\b|\bMUST\b|\bshall\b/, weight: 2, label: "must" },
  { pattern: /\bonly\b/i, weight: 1, label: "only" },
  { pattern: /\bis not\b|\bare not\b|\bdoes not\b|\bdo not\b/i, weight: 1, label: "is not" },
];

/** Prose that says a named thing does not exist yet. Read on its own,
 *  without a guarantee word, because "Still missing: `kms_key_id` column"
 *  is a claim about the tree exactly as much as "K_master never leaves"
 *  is.
 *
 *  Deliberately narrow. An earlier form admitted a bare "pending", which
 *  matched "leaves status at `pending`" — a status value, not an absence
 *  — and turned a correct sentence into a finding. */
const ABSENCE: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\bstill missing\b/i, label: "still missing" },
  { pattern: /\bnot yet\b/i, label: "not yet" },
  { pattern: /\b(?:is|are|remains?) incomplete\b/i, label: "is incomplete" },
  { pattern: /\bnot implemented\b|\bunimplemented\b/i, label: "not implemented" },
  { pattern: /\bdoes not exist\b|\bdo not exist\b/i, label: "does not exist" },
  { pattern: /\bnot currently\b/i, label: "not currently" },
];

/** Text that admits its own gap. Wherever this matches — in the sentence,
 *  in a canon description, or inside an `@enforces` block — the guarantee
 *  is self-declared rather than silent, and this probe says so with
 *  `sound`. A confession is the model outcome, not a defect. */
const CONFESSION: readonly RegExp[] = [
  /\bnot (?:currently|yet) enforced?\b/i,
  /\bdoes not (?:currently )?enforce\b|\bdo not (?:currently )?enforce\b/i,
  /\b(?:not|never) enforced\b|\bunenforced\b/i,
  /\bis not evidence\b|\bnot evidence that\b/i,
  /\bdoes not prove\b|\bdo not prove\b/i,
  /\bnot a guarantee\b|\bno guarantee\b/i,
  /\badvisory only\b|\bremains? advisory\b/i,
  /\bno callsites?\b/i,
  /\bdoes not (?:currently )?(?:gate|block|reject|check)\b/i,
];

/** Words this repository uses to mark an entry as knowingly unenforced.
 *  Read only inside the canon registry and inside annotation blocks: in
 *  running prose, "aspirational" is usually describing something else, and
 *  a changelog that uses the word once should not turn every sentence in
 *  the paragraph into a self-declared gap. */
const DECLARED_STATUS: readonly RegExp[] = [
  /\baspirational\b/i,
  /\bforward-looking\b/i,
  /\b(?:is|are) resting\b|\bresting until\b/i,
];

/** How a mechanism binds. Ordered from "goes red in production" to
 *  "goes red in CI" to "cannot go red at all". */
type Mechanism = "db-constraint" | "signature" | "runtime-refusal" | "type" | "annotation" | "test" | "mention";

/** What each mechanism looks like in the window around an occurrence.
 *  Multi-language on purpose: the same guarantee is held up by `throw new
 *  Error` in a route, `RAISE EXCEPTION` in a trigger and `pytest.raises`
 *  in a test, and a matcher that only understands one of them would
 *  report the other two as prose. */
const MECHANISM_SIGNS: ReadonlyArray<{ kind: Mechanism; pattern: RegExp; sqlOnly?: boolean }> = [
  { kind: "db-constraint", pattern: /\bCHECK\s*\(|\bCONSTRAINT\b|\bNOT NULL\b|\bUNIQUE\b|\bREFERENCES\b|\bPRIMARY KEY\b|\bRAISE EXCEPTION\b|\bCREATE TRIGGER\b|\bREVOKE\b/, sqlOnly: true },
  { kind: "signature", pattern: /\bverify(?:Signature|Attestation|Detached|Covenant|Envelope)?\s*\(|ed25519|\bsignedPayload\b|\bsigning_payload\b|canonicalBytes|canonical_bytes|\bsodium\b|\bverify_detached\b/ },
  { kind: "runtime-refusal", pattern: /throw new \w*Error|throw \w+\(|\braise [A-Z]\w*|\bfail\(c,|c\.json\([^\n]*4\d\d|\.status\(4\d\d|HTTPException|\berrors\.\w+\(|abort\(4\d\d/ },
  { kind: "type", pattern: /^\s*(?:export\s+)?(?:type|interface|enum)\s+\w|\bz\.(?:object|enum|literal|union|string|number)\(|\bNOT NULL\b/m },
  { kind: "annotation", pattern: /@enforces\s+urn:/ },
];

/** Occurrences examined per anchor, and lines examined per file. Bounds,
 *  not scopes: they cap how much evidence one claim can generate, and are
 *  published as probe limits. */
const MAX_FILES_PER_ANCHOR = 40;
const MAX_LINES_PER_FILE = 4;
const WINDOW = 8;

/** A "sentence" longer than this is a changelog paragraph, a release note
 *  or a table cell carrying six statements. It is not a guarantee, and
 *  reading it as one makes any register word anywhere in it govern the
 *  whole span. */
const MAX_SENTENCE = 400;

/** A sentence naming more identifiers than this is a listing — "Code:
 *  a.ts · b.ts · c.ts · d.ts" — rather than a claim about any one of
 *  them. */
const MAX_ANCHORS = 4;

/** How near the absence phrase the identifier must sit before the two are
 *  read as being about each other. */
const ABSENCE_PROXIMITY = 200;

/** Readings shown from any one document. Four identifiers named on four
 *  consecutive lines of one spec draft is one observation, not four. */
const MAX_PER_DOCUMENT = 2;

/** How many findings each bucket may contribute. The suppressed remainder
 *  is published by `checkShortlistBoundary` with its count and its
 *  ranking, so the shortlist is a stated boundary rather than the whole
 *  set pretending to be one. */
const BUCKET_CAP: Readonly<Record<string, number>> = Object.freeze({
  "prose-only": 8,
  partial: 8,
  "under-claim": 6,
  "self-declared": 5,
  enforced: 6,
  "canon-unbacked": 10,
  "canon-self-declared": 6,
});

const LIMITS: readonly ProbeLimit[] = [
  {
    statement:
      "it never decides whether a stated guarantee is true — only whether a mechanism of some kind exists near the identifiers the sentence names",
    why: "natural language is not a spec; deciding truth would mean modelling the sentence, and a probe that guesses at meaning produces confident findings a reader cannot check",
    file: "packages/rhizome/src/probes/claim.ts",
    line: 0,
  },
  {
    statement:
      "a guarantee stated without naming any identifier — no backticked span, no CONSTANT_CASE token, no path and no route — is dropped before it is ever classified",
    why: "an anchor is what makes a claim checkable against the tree at all; without one the probe would be pattern-matching English against English",
    file: "packages/rhizome/src/probes/claim.ts",
    line: 0,
  },
  {
    statement:
      "documents are recognised by extension (.md/.mdx), so a guarantee stated in a format outside that set is not read as prose",
    why: "there is no derivation of \"is this file prose?\" that is not itself a guess; the set is staleness-checked instead, and any document-shaped file outside it is published as a finding by this probe",
    file: "packages/rhizome/src/probes/claim.ts",
    line: 69,
  },
  {
    statement:
      "mechanism is judged from a window of 8 lines around each occurrence, so a guarantee enforced two functions away from where its identifier appears reads as a mention",
    why: "following the call graph means parsing and resolving imports across five languages; the window is a stated approximation and every classified occurrence is published with its file:line so a reader can overrule it",
    file: "packages/rhizome/src/probes/claim.ts",
    line: 0,
  },
  {
    statement:
      "only a ranked shortlist is reported; claims below each bucket's cap are counted and not shown",
    why: "a probe that floods a reader is worse than one that surfaces twelve real things, and the ranking plus the suppressed count are published so the boundary is visible from the output",
    file: "packages/rhizome/src/probes/claim.ts",
    line: 0,
  },
  {
    statement:
      "under-claiming is only detected where the doc says something is absent and the named identifier is created by DDL in a migration; a doc that under-states a behaviour is not caught",
    why: "\"the code does more than this sentence says\" has no general test; DDL creation is the one form where absence and presence are both decidable from the tree",
    file: "packages/rhizome/src/probes/claim.ts",
    line: 0,
  },
  {
    statement:
      "a guarantee whose only identifier is a test file is dropped, so a claim stated only as \"this test proves X\" is never classified",
    why: "a sentence naming a test is documenting the suite, and admitting them turned one test README into six findings about filenames that contain the word \"never\"",
    file: "packages/rhizome/src/probes/claim.ts",
    line: 736,
  },
  {
    statement:
      "at most two readings are shown from any one document, so a specification that states six unbacked guarantees contributes two",
    why: "one document repeating a shape is one observation for a reader, and letting it fill a bucket hides the same shape occurring elsewhere; the registry is exempt because it is one file holding hundreds of independent entries",
    file: "packages/rhizome/src/probes/claim.ts",
    line: 181,
  },
  {
    statement:
      "the annotation sweep ignores annotations inside test files, so a canon entry defended only from a test reads as unbound",
    why: "the tests that document the annotation convention quote placeholder urns in their own headers, and counting those made a placeholder look like a binding",
    file: "packages/rhizome/src/probes/claim.ts",
    line: 0,
  },
];

// ── corpus ────────────────────────────────────────────────────────────────

function extensionOf(file: string): string {
  const base = file.slice(file.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "";
}

function isDocument(file: string): boolean {
  return DOCUMENT_EXTENSIONS.includes(extensionOf(file).toLowerCase());
}

/** Files that are documentation in some rendered form. Wider than
 *  `isDocument`, and used for a different purpose: these are excluded from
 *  the mechanism sweep, because a published HTML page quoting an
 *  identifier is documentation restating the claim, not a mechanism
 *  holding it up. Reading `apps/docs/runtime.html` as a signature
 *  requirement is how a documented guarantee ends up vouching for
 *  itself. */
function isProseLike(file: string): boolean {
  return isDocument(file) || /\.(html|htm|txt|rst)$/i.test(file);
}

/** A document whose filename is date-stamped — `2026-05-10-…` — is a
 *  plan or a design note written on a day, not a standing statement about
 *  the substrate. Its claims still count; they rank lower, because a plan
 *  that names a symbol which later got renamed is describing history. */
function isDated(file: string): boolean {
  return /(^|\/)\d{4}-\d{2}-\d{2}[-_]/.test(file);
}

/** Same predicate the rest of this package uses for "a test lives here".
 *  Kept local rather than imported from a sibling probe: reaching into
 *  another probe's file for a private helper is how two copies of a rule
 *  start drifting. It belongs in `src/source.ts`; that is a core change
 *  and this probe does not make core changes. */
function isTestPath(file: string): boolean {
  return (
    /(^|\/)(tests?|__tests__)\//.test(file) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) ||
    /(^|\/)test_[^/]+\.py$/.test(file) ||
    /_test\.py$/.test(file)
  );
}

function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${text.length}:${(h >>> 0).toString(36)}`;
}

/** An inverted index over identifier tokens, built once per run.
 *
 *  `Scope.filesContaining` scans the whole corpus per marker, which is the
 *  right shape for the handful of markers `edge` sweeps and the wrong
 *  shape for the several hundred anchors this probe resolves. The index is
 *  derived from the same corpus, so it introduces no new boundary — it is
 *  the same set, addressed differently. */
class Index {
  private readonly postings = new Map<string, number[]>();

  constructor(private readonly scope: Scope) {
    scope.files.forEach((file, i) => {
      // Documentation is never a mechanism, and it is the bulk of the
      // text here. Leaving it out of the index is not a narrowing of
      // scope: the index answers "where could a mechanism be?", and the
      // document corpus is enumerated separately from the same `Scope`.
      if (isProseLike(file)) return;
      const text = scope.read(file);
      if (text === null) return;
      for (const token of Index.tokens(text)) {
        const list = this.postings.get(token);
        if (list === undefined) this.postings.set(token, [i]);
        else list.push(i);
      }
    });
  }

  /** Identifier pieces, lowercased.
   *
   *  Whole identifiers are not enough. `ChangeEvent` is a real type in
   *  this tree and it is written `AgentDataChangeEvent` at its
   *  declaration, so an index of whole tokens answered "occurs nowhere"
   *  for an identifier occurring in four files — the instrument's own
   *  blind spot, arrived at exactly the way the ones it hunts are. So
   *  every token is also split on `_` and on case boundaries, and the
   *  pieces are indexed alongside it. */
  private static tokens(text: string): Set<string> {
    const out = new Set<string>();
    for (const match of text.matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g)) {
      const token = match[0]!;
      out.add(token.toLowerCase());
      for (const part of token.split(/_+|(?<=[a-z0-9])(?=[A-Z])/)) {
        if (part.length >= 3) out.add(part.toLowerCase());
      }
    }
    return out;
  }

  /** The pieces a needle must be looked up by: its parts, not itself,
   *  because the corpus indexes parts of longer identifiers too. */
  private static query(needle: string): string[] {
    const parts = new Set<string>();
    for (const match of needle.matchAll(/[A-Za-z_][A-Za-z0-9_]{2,}/g)) {
      for (const part of match[0]!.split(/_+|(?<=[a-z0-9])(?=[A-Z])/)) {
        if (part.length >= 3) parts.add(part.toLowerCase());
      }
    }
    return [...parts];
  }

  /** Files whose text contains `needle`, or `null` when the needle has no
   *  piece long enough to index — which is a miss this probe declares
   *  rather than silently treating as "occurs nowhere". */
  files(needle: string): string[] | null {
    const cached = this.answers.get(needle);
    if (cached !== undefined) return cached;
    const answer = this.lookup(needle);
    this.answers.set(needle, answer);
    return answer;
  }

  private readonly answers = new Map<string, string[] | null>();

  private lookup(needle: string): string[] | null {
    const tokens = Index.query(needle)
      // Rarest piece first: intersecting from the smallest posting list
      // keeps the candidate set small, which is what the substring
      // verification below costs money on.
      .sort((a, b) => (this.postings.get(a)?.length ?? 0) - (this.postings.get(b)?.length ?? 0));
    if (tokens.length === 0) return null;
    let candidates: number[] | null = null;
    for (const token of tokens) {
      const list = this.postings.get(token);
      if (list === undefined) return [];
      if (candidates === null) candidates = list;
      else {
        const set = new Set(list);
        candidates = candidates.filter((i) => set.has(i));
      }
      if (candidates.length === 0) return [];
    }
    return (candidates ?? [])
      .map((i) => this.scope.files[i]!)
      .filter((file) => (this.scope.read(file) ?? "").includes(needle));
  }
}

// ── claim extraction ──────────────────────────────────────────────────────

interface Unit {
  line: number;
  text: string;
  /** Character offset in `text` at which each source line begins, paired
   *  with that line's 1-indexed number, so a sentence is attributed to the
   *  line it starts on rather than to the paragraph. */
  offsets: Array<{ at: number; line: number }>;
}

const UNIT_START = /^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|>|\||```|~~~)/;

/** Split a document into units — a paragraph, a list item, a table row, a
 *  heading — preserving the source line each unit begins on. Wrapped
 *  paragraphs are joined so a sentence that spans two lines is read once. */
function proseUnits(lines: readonly string[]): Unit[] {
  const units: Unit[] = [];
  let current: Unit | null = null;
  let fenced = false;
  const flush = (): void => {
    if (current !== null && current.text.trim() !== "") units.push(current);
    current = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? "";
    if (/^\s*(?:```|~~~)/.test(raw)) {
      flush();
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (raw.trim() === "") {
      flush();
      continue;
    }
    if (current === null || UNIT_START.test(raw)) {
      flush();
      current = { line: i + 1, text: raw.trim(), offsets: [{ at: 0, line: i + 1 }] };
      continue;
    }
    current.offsets.push({ at: current.text.length + 1, line: i + 1 });
    current.text = `${current.text} ${raw.trim()}`;
  }
  flush();
  return units;
}

/** Split a unit into sentences, keeping each sentence's source line.
 *  Table rows are split on the cell separator first: a row's cells are
 *  independent statements and joining them produces a sentence nobody
 *  wrote — and then each cell is split again, because a cell routinely
 *  carries two. */
function sentences(unit: Unit): Array<{ line: number; text: string }> {
  const lineAt = (offset: number): number => {
    let line = unit.line;
    for (const mark of unit.offsets) if (mark.at <= offset) line = mark.line;
    return line;
  };

  const pieces: Array<{ at: number; text: string }> = [];
  const split = (text: string, base: number, splitter: RegExp, keep: boolean): void => {
    let start = 0;
    for (const match of text.matchAll(splitter)) {
      const end = match.index! + (keep ? match[0].length : 0);
      pieces.push({ at: base + start, text: text.slice(start, end) });
      start = match.index! + match[0].length;
    }
    pieces.push({ at: base + start, text: text.slice(start) });
  };

  if (unit.text.startsWith("|")) {
    const cells: Array<{ at: number; text: string }> = [];
    let start = 0;
    for (const match of unit.text.matchAll(/\|/g)) {
      cells.push({ at: start, text: unit.text.slice(start, match.index!) });
      start = match.index! + 1;
    }
    cells.push({ at: start, text: unit.text.slice(start) });
    for (const cell of cells) split(cell.text, cell.at, /(?<=[.!?;])\s+(?=[A-Z`*_“"(\[])/g, true);
  } else {
    split(unit.text, 0, /(?<=[.!?;])\s+(?=[A-Z`*_“"(\[])/g, true);
  }

  return pieces
    .map((piece) => ({ line: lineAt(piece.at), text: piece.text.trim() }))
    .filter((piece) => piece.text !== "");
}

/** Is this token specific enough to look for? A backticked `private` is
 *  an English word; a backticked `attester_self_witness_forbidden` is an
 *  address. The test is shape, derived from the token itself: an
 *  identifier carries a separator, a case boundary, a path, or a scheme. */
function isAnchorShaped(token: string): boolean {
  if (token.length < 4 || token.length > 120) return false;
  if (/\s/.test(token)) return false;
  if (token.startsWith("urn:")) return true;
  if (/^\/v\d+\//.test(token)) return true;
  if (/^[A-Za-z_][\w.-]*\/[\w./-]+$/.test(token) && /\.\w{2,5}$/.test(token)) return true; // a path
  if (/^X-[\w-]+$/i.test(token)) return true; // a header
  if (/_/.test(token) && /^[A-Za-z][\w.]*$/.test(token)) return true; // snake_case
  if (/[a-z][A-Z]/.test(token) && /^[A-Za-z][\w.]*$/.test(token)) return true; // camelCase
  if (/^[a-z][\w-]*\.[a-z][\w.]*$/i.test(token) && token.split(".").length >= 2) return true; // dotted
  return false;
}

/** Spans of a sentence that are identifiers rather than English, with the
 *  ones worth looking for extracted.
 *
 *  The split matters more than it looks. `wall-k-master-never-server-side
 *  .test.ts` contains "never"; a sentence that only names that file states
 *  no guarantee, and an earlier form of this probe reported six such lines
 *  from one test README as unenforced "never" claims. So the register is
 *  matched against the sentence with every identifier span removed: the
 *  guarantee has to be asserted in the prose, not spelled inside a
 *  filename. */
function anchorsIn(text: string): { anchors: string[]; prose: string } {
  const spans: Array<[number, number]> = [];
  const raw: Array<{ text: string; templated: boolean }> = [];
  const take = (pattern: RegExp, group: number): void => {
    for (const match of text.matchAll(pattern)) {
      const value = match[group]!;
      spans.push([match.index!, match.index! + match[0].length]);
      raw.push({ text: value, templated: /<[^>]*>|\{[^}]*\}/.test(value) });
    }
  };
  take(/`([^`\n]+)`/g, 1);
  take(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g, 1);
  take(/(\/v\d+\/[\w/:-]+)/g, 1);
  take(/\b(urn:[a-z][\w:/-]+)/g, 1);
  take(/\b([\w.-]+\/[\w./-]*\.(?:ts|tsx|js|py|sql|sh|md|mdx|json|yml|yaml|html))\b/g, 1);

  const anchors = new Set<string>();
  for (const entry of raw) {
    if (entry.templated) continue; // `api/tests/<primitive>.test.ts` is a template, not an address
    const token = entry.text
      .trim()
      .replace(/\(\)$/, "")
      .replace(/^[`'"(\[]+|[`'"),.;:\]]+$/g, "");
    if (token.includes("...") || token.includes("…")) continue; // an elision, not an address
    if (!isAnchorShaped(token)) continue;
    // A reference to another document is a citation, not a mechanism. It
    // would resolve, and resolving to prose is the thing being measured.
    if (DOCUMENT_EXTENSIONS.includes(extensionOf(token).toLowerCase())) continue;
    // A sentence naming a test file is documenting the suite, not stating
    // a guarantee — "`asymmetry-clause.test.ts` proves you cannot
    // self-witness" is a fact about a test. The guarantee it pins is
    // stated elsewhere, and reading these produced a whole test README's
    // worth of findings about filenames that contain the word "never".
    if (isTestPath(token)) continue;
    anchors.add(token);
  }

  let prose = "";
  let at = 0;
  for (const [start, end] of spans.sort((a, b) => a[0] - b[0])) {
    if (start < at) continue;
    prose += `${text.slice(at, start)} `;
    at = end;
  }
  prose += text.slice(at);
  return { anchors: [...anchors], prose };
}

function matchRegister(text: string): { label: string; weight: number } | null {
  let best: { label: string; weight: number } | null = null;
  for (const entry of REGISTER) {
    if (!entry.pattern.test(text)) continue;
    if (best === null || entry.weight > best.weight) best = { label: entry.label, weight: entry.weight };
  }
  return best;
}

function matchAbsence(text: string): string | null {
  for (const entry of ABSENCE) if (entry.pattern.test(text)) return entry.label;
  return null;
}

function matchConfession(text: string, withDeclaredStatus = false): string | null {
  for (const pattern of CONFESSION) {
    const found = pattern.exec(text);
    if (found !== null) return found[0];
  }
  if (!withDeclaredStatus) return null;
  for (const pattern of DECLARED_STATUS) {
    const found = pattern.exec(text);
    if (found !== null) return found[0];
  }
  return null;
}

// ── mechanism resolution ──────────────────────────────────────────────────

interface Occurrence {
  file: string;
  line: number;
  kind: Mechanism;
  quote: string;
}

/** A mechanism has to be *in* code, not quoted by it.
 *
 *  The window classifier reads a neighbourhood as text, and text cannot
 *  tell an implementation from somebody writing about one. A header
 *  comment that quotes `throw new Error("attester_self_witness_forbidden")`
 *  as an example reads exactly like the line it quotes.
 *
 *  This was found the hard way, and by rhizome, about rhizome: this
 *  probe's own source quotes that throw four times in its comments, and
 *  the moment rhizome could read its own file (a stray NUL byte had made
 *  it unreadable) the guarantee those comments were written to illustrate
 *  acquired two phantom mechanisms in a file that implements nothing. An
 *  instrument that perturbs its own measurement by documenting it is the
 *  joke this package exists to stop being.
 *
 *  `annotation` is exempt: an `@enforces` marker is a comment by
 *  construction and is a real artefact in this tree. */
function codeWindow(slice: readonly string[]): string {
  return slice.filter((line) => !isCommentLine(line)).join("\n");
}

function classify(scope: Scope, file: string, index: number): { kind: Mechanism; quote: string } {
  const lines = scope.lines(file);
  const slice = lines.slice(Math.max(0, index - WINDOW), index + WINDOW + 1);
  const window = slice.join("\n");
  const code = codeWindow(slice);
  const sql = file.endsWith(".sql");
  for (const sign of MECHANISM_SIGNS) {
    if (sign.sqlOnly === true && !sql) continue;
    if (sign.pattern.test(sign.kind === "annotation" ? window : code)) {
      return { kind: sign.kind, quote: (lines[index] ?? "").trim() };
    }
  }
  return { kind: "mention", quote: (lines[index] ?? "").trim() };
}

/** A path-shaped anchor resolved against the corpus, allowing the
 *  shortened forms documentation actually writes — `services/economy/
 *  usage.ts` for `api/src/services/economy/usage.ts`. Ambiguous suffixes
 *  resolve to nothing rather than to a guess. */
function resolvePath(scope: Scope, anchor: string): string | null {
  if (!anchor.includes("/") || !/\.\w{2,5}$/.test(anchor)) return null;
  if (scope.files.includes(anchor)) return anchor;
  const matches = scope.files.filter((file) => file.endsWith(`/${anchor}`));
  return matches.length === 1 ? matches[0]! : null;
}

/** The strongest mechanism a whole file carries, for the case where the
 *  anchor names the file itself. Without this, "`services/economy/
 *  usage.ts` … is the reader that was built and never connected" reports
 *  as having no mechanism because no other file quotes that path — which
 *  says nothing about the file. */
function fileMechanism(scope: Scope, file: string): Occurrence | null {
  const lines = scope.lines(file);
  const text = lines.join("\n");
  const code = codeWindow(lines);
  const sql = file.endsWith(".sql");
  for (const sign of MECHANISM_SIGNS) {
    if (sign.sqlOnly === true && !sql) continue;
    if (!sign.pattern.test(sign.kind === "annotation" ? text : code)) continue;
    const at = lines.findIndex((line) => (sign.kind === "annotation" || !isCommentLine(line)) && sign.pattern.test(line));
    return { file, line: at === -1 ? 1 : at + 1, kind: sign.kind, quote: (lines[Math.max(0, at)] ?? "").trim() };
  }
  return isTestPath(file) ? { file, line: 1, kind: "test", quote: lines[0]?.trim() ?? "" } : null;
}

function occurrences(scope: Scope, index: Index, anchor: string): Occurrence[] | null {
  const files = index.files(anchor);
  if (files === null) return null;
  const out: Occurrence[] = [];
  const named = resolvePath(scope, anchor);
  if (named !== null && !isProseLike(named)) {
    const own = fileMechanism(scope, named);
    if (own !== null) out.push(own);
  }
  // Documentation is filtered out BEFORE the cap, not after. An earlier
  // form sliced first, so an identifier quoted in fifty published HTML
  // pages and defined once in `packages/` reported as occurring nowhere —
  // the cap silently became the answer, which is the exact shape this
  // package exists to find.
  for (const file of files.filter((candidate) => !isProseLike(candidate)).slice(0, MAX_FILES_PER_ANCHOR)) {
    const lines = scope.lines(file);
    let found = 0;
    for (let i = 0; i < lines.length && found < MAX_LINES_PER_FILE; i += 1) {
      if (!(lines[i] ?? "").includes(anchor)) continue;
      found += 1;
      const classified = classify(scope, file, i);
      out.push({
        file,
        line: i + 1,
        // A test file is a test, whatever it contains — reading the
        // `throw` inside an assertion as a runtime refusal made a
        // guarantee that IS pinned by a test report as "no test". But a
        // name that appears only in a test's header comment is being
        // mentioned, not asserted, and counting that as a mechanism is
        // how "301 lines, zero callers" read as enforced.
        //
        kind: isTestPath(file)
          ? isCommentLine(lines[i] ?? "")
            ? "mention"
            : "test"
          : classified.kind,
        quote: classified.quote,
      });
    }
  }
  return out;
}

const BINDING: readonly Mechanism[] = ["db-constraint", "signature", "runtime-refusal"];

function describeOccurrences(list: readonly Occurrence[], max = 6): string {
  const order: Mechanism[] = ["db-constraint", "signature", "runtime-refusal", "type", "annotation", "test", "mention"];
  const ranked = [...list].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  return ranked
    .slice(0, max)
    .map((occurrence) => `${occurrence.kind.padEnd(15)} ${occurrence.file}:${occurrence.line}  ${clip(occurrence.quote, 110)}`)
    .join("\n");
}

// ── check 1: prose guarantees ─────────────────────────────────────────────

interface Candidate {
  bucket: keyof typeof BUCKET_CAP;
  score: number;
  /** The thing the finding is about. Two documents citing the same
   *  identifier produce the same reading, and the shortlist shows it
   *  once. */
  subject?: string;
  finding: Finding;
}

interface StatedClaim {
  file: string;
  line: number;
  text: string;
  /** The sentence with every identifier span blanked out — what the
   *  register and the verb test are matched against. */
  prose: string;
  register: { label: string; weight: number } | null;
  absence: string | null;
  anchors: string[];
}

/** Verbs that turn a prohibition into a claim about non-existence.
 *  "the implementation must not introduce `is_autonomous` flags" is held
 *  up by the identifier being absent — the absence *is* the mechanism, and
 *  reporting it as an unbacked claim inverts the reading. */
const INTRODUCE =
  /\b(?:must not|never|cannot|can(?:'|\u2019)?t|no|refuses? to|forbidden to)\s+(?:\w+\s+){0,2}(?:introduc\w+|add|adds|adding|creat\w+|us(?:e|es|ing)|combin\w+|ship|ships|shipping|expos\w+|reintroduc\w+|special-cas\w+|accept\w*|return\w*)\b/i;

/** Files of one kind, one per distinct content.
 *
 *  This repository publishes its docs tree twice — `docs/X.md` and a
 *  symlinked `apps/docs/X.md` that git tracks and the filesystem walk does
 *  not — so every claim would otherwise be reported twice and a reader
 *  would learn to skim. Grouped by content, not by name: the mirror is
 *  discovered rather than assumed, and a future mirror under a third path
 *  collapses the same way. */
function canonicalFiles(scope: Scope, include: (file: string) => boolean): { files: string[]; mirrored: number } {
  const byContent = new Map<string, string[]>();
  for (const file of scope.files) {
    if (!include(file)) continue;
    const text = scope.read(file);
    if (text === null || text.trim() === "") continue;
    const key = hash(text);
    byContent.set(key, [...(byContent.get(key) ?? []), file]);
  }
  const files: string[] = [];
  let mirrored = 0;
  for (const group of byContent.values()) {
    const sorted = [...group].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
    files.push(sorted[0]!);
    mirrored += sorted.length - 1;
  }
  return { files: files.sort(), mirrored };
}

function collectClaims(scope: Scope, documents: readonly string[]): StatedClaim[] {
  const claims: StatedClaim[] = [];
  for (const file of documents) {
    for (const unit of proseUnits(scope.lines(file))) {
      for (const sentence of sentences(unit)) {
        if (sentence.text.length > MAX_SENTENCE) continue;
        const { anchors, prose } = anchorsIn(sentence.text);
        if (anchors.length === 0 || anchors.length > MAX_ANCHORS) continue;
        const register = matchRegister(prose);
        const absence = matchAbsence(prose);
        if (register === null && absence === null) continue;
        claims.push({ file, line: sentence.line, text: sentence.text, prose, register, absence, anchors });
      }
    }
  }
  return claims;
}

function checkProseGuarantees(scope: Scope, index: Index, claims: readonly StatedClaim[]): Candidate[] {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  for (const claim of claims) {
    const key = hash(claim.text);
    if (seen.has(key)) continue;
    seen.add(key);

    // Resolve every anchor, then pick the one that carries the reading.
    //
    // An anchor that resolves nowhere wins outright: "this guarantee names
    // something that is in no source file" is the strongest thing this
    // probe can say, and it must not be hidden by a sibling anchor in the
    // same sentence that happens to resolve. Otherwise the anchor with the
    // strongest mechanism wins, tie-broken by specificity — an identifier
    // in 300 files locates nothing, so the evidence would be unreadable.
    const resolved: Array<{ anchor: string; list: Occurrence[] }> = [];
    for (const anchor of claim.anchors) {
      const list = occurrences(scope, index, anchor);
      if (list === null) continue; // no token long enough to index; a declared miss
      resolved.push({ anchor, list });
    }
    if (resolved.length === 0) continue;

    const strength = (list: readonly Occurrence[]): number => {
      const kinds = new Set(list.map((occurrence) => occurrence.kind));
      return (
        BINDING.filter((kind) => kinds.has(kind)).length * 4 +
        (kinds.has("test") ? 2 : 0) +
        (kinds.has("type") || kinds.has("annotation") ? 1 : 0)
      );
    };
    const empty = resolved.filter((entry) => entry.list.length === 0);
    const best =
      empty.length > 0
        ? empty[0]!
        : [...resolved].sort(
            (a, b) => strength(b.list) - strength(a.list) || a.list.length - b.list.length,
          )[0]!;

    const kinds = new Set(best.list.map((occurrence) => occurrence.kind));
    const binding = BINDING.filter((kind) => kinds.has(kind));
    const tested = kinds.has("test");
    const confession = matchConfession(claim.text);
    const weight = claim.register?.weight ?? 2;
    // A dated plan document ranks below a standing statement: it describes
    // what was true on the day it was written.
    const dated = isDated(claim.file) ? -3 : 0;
    // Specificity: an identifier occurring in nine files locates its
    // mechanism; one occurring in seventy does not, and the evidence block
    // for it is unreadable. Continuous rather than clipped, so the
    // difference between 9 and 70 still counts — a clipped form scored
    // both as zero and let the least locatable claim win its bucket.
    //
    // Counted over the occurrences that carry a mechanism, not over every
    // occurrence. A file that only *mentions* the identifier does not help
    // locate the mechanism, and putting mentions in the denominator means
    // the more a repository talks about a guarantee the less enforced that
    // guarantee looks. Rhizome found this in itself: four sentences in
    // this probe's own comments, quoting `attester_self_witness_forbidden`
    // as the worked example of an enforced guarantee, were enough to push
    // that very guarantee out of the shortlist it was the example for.
    const locating = best.list.filter((occurrence) => occurrence.kind !== "mention");
    const denominator = locating.length > 0 ? locating.length : best.list.length;
    const specificity = best.list.length === 0 ? 4 : 12 / Math.log2(denominator + 2);
    const where = `${claim.file}:${claim.line}`;

    // Under-claiming: the document says a named thing is absent, and a
    // migration creates it. Checked first, because a sentence in the
    // absence register is not a promise that failed — it is a promise the
    // documentation forgot it had kept.
    if (claim.absence !== null) {
      const ddl = best.list.filter(
        (occurrence) =>
          occurrence.file.endsWith(".sql") && /\bADD COLUMN\b|\bCREATE TABLE\b|\bCREATE INDEX\b|\bALTER TABLE\b|\bCREATE TYPE\b/i.test(occurrence.quote),
      );
      // The absence phrase and the identifier have to be about each
      // other. "Amount ≥ `payout_dual_control_threshold_base`. Dual-control
      // flow not yet implemented" is two statements, and only reading them
      // as one turns a correct sentence into a finding.
      const absenceAt = claim.text.search(ABSENCE.find((entry) => entry.label === claim.absence)!.pattern);
      const anchorAt = claim.text.indexOf(best.anchor);
      const near = absenceAt >= 0 && anchorAt >= 0 && Math.abs(absenceAt - anchorAt) <= ABSENCE_PROXIMITY;
      if (ddl.length > 0 && near) {
        candidates.push({
          bucket: "under-claim",
          score: weight + specificity + 4 + dated,
          subject: best.anchor,
          finding: {
            probe: ID,
            title: `documentation states an absence for ${best.anchor}, which a migration creates`,
            file: claim.file,
            line: claim.line,
            verdict: "gap",
            evidence: `"${clip(claim.text, 320)}"\n\nabsence register: ${claim.absence}\nanchor: ${best.anchor}\n\ncreated by DDL in the tree:\n${describeOccurrences(ddl, 4)}`,
            detail:
              "Drift in the under-claiming direction. The reader of this line concludes the substrate does less than it does, which is the failure mode nobody looks for because it is not a broken promise — it is an unclaimed one. " +
              "What was checked: the named identifier is created by a DDL statement in a migration. What was not checked: whether the rest of the sentence is still accurate. Read the evidence rather than the verdict.",
          },
        });
        continue;
      }
    }

    if (confession !== null) {
      candidates.push({
        bucket: "self-declared",
        score: weight + specificity + 2 + dated,
        subject: best.anchor,
        finding: {
          probe: ID,
          title: `the documentation states the limit of its own claim: ${best.anchor}`,
          file: claim.file,
          line: claim.line,
          verdict: "sound",
          evidence: `"${clip(claim.text, 320)}"\n\nconfession: "${confession}"\nanchor: ${best.anchor}\n${best.list.length === 0 ? "no occurrence outside documentation" : describeOccurrences(best.list, 3)}`,
          detail:
            "A guarantee that names its own boundary is not a gap. A reader who arrives here learns what is held up and what is not, in the same sentence, and does not have to re-derive it. Recorded so nobody re-investigates it as drift.",
        },
      });
      continue;
    }

    if (best.list.length === 0) {
      // A prohibition on introducing something is held up by the thing not
      // being there. "the implementation must not introduce `is_autonomous`
      // flags" with `is_autonomous` in no source file is a guarantee that
      // holds, and calling it unbacked reads the evidence backwards.
      if (weight >= 4 && INTRODUCE.test(claim.prose)) {
        candidates.push({
          bucket: "self-declared",
          score: weight + 3 + dated,
          subject: best.anchor,
          finding: {
            probe: ID,
            title: `${best.anchor} is prohibited by this guarantee, and it is in no source file`,
            file: claim.file,
            line: claim.line,
            verdict: "sound",
            evidence: `"${clip(claim.text, 320)}"\n\nregister: ${claim.register?.label}\nanchor: ${best.anchor}\noccurrences outside documentation: none`,
            detail:
              "The guarantee forbids the existence of something, and the something does not exist. The absence is the mechanism. Nothing goes red if it is introduced tomorrow — that would be a separate finding about the missing ratchet — but the claim is true today and is recorded here so it is not re-read as an unbacked promise.",
          },
        });
        continue;
      }
      candidates.push({
        bucket: "prose-only",
        score: weight + 5 + dated,
        subject: best.anchor,
        finding: {
          probe: ID,
          title: `${best.anchor} is named in a guarantee and appears in no source file`,
          file: claim.file,
          line: claim.line,
          verdict: "gap",
          evidence: `"${clip(claim.text, 320)}"\n\nregister: ${claim.register?.label ?? claim.absence}\nanchor: ${best.anchor}\noccurrences outside documentation: none`,
          detail:
            "The strongest form of prose-only. The sentence states a guarantee about something that has no referent anywhere in the tree — no type, no check, no constraint, no test, not even a mention. Either the identifier is spelled differently in code, or the thing it names does not exist.",
        },
      });
      continue;
    }

    // A prohibition whose only occurrences are in tests is pinned by
    // those tests: the test names the forbidden thing in order to assert
    // it is not there. "Never combine … into a `signAndSend` convenience
    // path", with `signAndSend` appearing only in a test, is held up.
    if (weight >= 4 && INTRODUCE.test(claim.prose) && binding.length === 0 && tested && kinds.size === 1) {
      candidates.push({
        bucket: "self-declared",
        score: weight + specificity + 1 + dated,
        subject: best.anchor,
        finding: {
          probe: ID,
          title: `${best.anchor} is prohibited by this guarantee, and only a test names it`,
          file: claim.file,
          line: claim.line,
          verdict: "sound",
          evidence: `"${clip(claim.text, 300)}"\n\nregister: ${claim.register?.label}\nanchor: ${best.anchor}\n${describeOccurrences(best.list, 4)}`,
          detail:
            "The guarantee forbids something, the something is in no source file, and a test names it — which is what a test asserting an absence looks like. The absence is the mechanism and the test is what makes it go red.",
        },
      });
      continue;
    }

    if (binding.length > 0 && tested) {
      // A claim that names the exact refusal the code raises — the
      // sentence says `attester_self_witness_forbidden` and a line says
      // `throw new Error("attester_self_witness_forbidden")` — is the most
      // legible form of an enforced guarantee, and the one worth showing a
      // reader as the calibration.
      const namedRefusal = best.list.some(
        (occurrence) =>
          occurrence.kind === "runtime-refusal" &&
          /throw|raise|fail\(|reject/i.test(occurrence.quote) &&
          occurrence.quote.includes(best.anchor),
      );
      candidates.push({
        bucket: "enforced",
        score: weight + specificity + binding.length + (namedRefusal ? 8 : 0) + dated,
        // One example per distinct chain, not eight copies of the
        // strongest one. The point of showing enforced claims at all is
        // calibration — a reader should see the range of shapes a held-up
        // guarantee takes here, which is why the shortlist keys this
        // bucket on the chain rather than on the identifier.
        subject: binding.join(" + "),
        finding: {
          probe: ID,
          title: `${best.anchor} is held up by ${binding.join(" + ")} and named by a test`,
          file: claim.file,
          line: claim.line,
          verdict: "sound",
          evidence: `"${clip(claim.text, 260)}"\n\nanchor: ${best.anchor}\n${describeOccurrences(best.list)}`,
          detail:
            "The good case, and the reason the bad cases are hard to see. A guarantee with a binding mechanism and something that goes red when it breaks is what this register is supposed to mean. Recorded by name so the calibration is visible: this probe is not reporting everything it looks at.",
        },
      });
      continue;
    }

    if (binding.length > 0 || kinds.has("type") || kinds.has("annotation") || tested) {
      const present = [...kinds].filter((kind) => kind !== "mention");
      const missing =
        binding.length === 0
          ? "no runtime refusal, signature requirement or database constraint was found near any occurrence"
          : "nothing names it in a test, so the mechanism cannot go red";
      candidates.push({
        bucket: "partial",
        score: weight + specificity + dated,
        subject: best.anchor,
        finding: {
          probe: ID,
          title: `${best.anchor} carries ${present.join(", ")} — ${binding.length === 0 ? "no binding mechanism" : "no test"}`,
          file: claim.file,
          line: claim.line,
          verdict: "gap",
          evidence: `"${clip(claim.text, 260)}"\n\nregister: ${claim.register?.label ?? claim.absence}\nanchor: ${best.anchor}\n${describeOccurrences(best.list)}`,
          detail: `Partially enforced: ${missing}. ${where} states this in the load-bearing register, and part of the chain exists. Compare api/src/services/covenants/sig.ts plus the covenant CHECK constraint, where doctrine, canonical bytes, application verify and a database constraint are all present.`,
        },
      });
      continue;
    }

    candidates.push({
      bucket: "prose-only",
      score: weight + specificity + dated,
      subject: best.anchor,
      finding: {
        probe: ID,
        title: `${best.anchor} appears in ${best.list.length} place(s), none of which enforce anything`,
        file: claim.file,
        line: claim.line,
        verdict: "gap",
        evidence: `"${clip(claim.text, 320)}"\n\nregister: ${claim.register?.label ?? claim.absence}\nanchor: ${best.anchor}\n${describeOccurrences(best.list)}`,
        detail:
          "The identifier exists, so the claim is not about nothing — but every occurrence is a mention: a name passed around, logged, or re-documented. Nothing refuses, nothing verifies, nothing constrains, nothing goes red. This is the shape the register teaches a reader to trust.",
      },
    });
  }

  return candidates;
}

// ── check 2: the repository's own guarantee registry ──────────────────────

interface CanonNode {
  urn: string;
  file: string;
  line: number;
  statement: string;
  breaksIf: string;
  status: string | null;
}

/** Every JSON-LD graph in the corpus, found by parsing rather than by
 *  path. A node counts as a stated guarantee when it carries a
 *  "breaks if" field — the repository's own way of writing down what
 *  would violate the commitment, which is the closest thing here to a
 *  falsifiable statement. */
function canonNodes(scope: Scope): CanonNode[] {
  const out: CanonNode[] = [];
  const seen = new Set<string>();
  // Same content-dedupe as the documents: the registry is published twice
  // through the same symlinked mirror, and reading both would double every
  // registry finding and halve the reported bound fraction.
  for (const file of canonicalFiles(scope, (candidate) => /\.jsonld$|\.json$/.test(candidate)).files) {
    const text = scope.read(file);
    if (text === null || !text.includes("@graph") || !text.includes("@context")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const graph = (parsed as Record<string, unknown>)["@graph"];
    const context = (parsed as Record<string, unknown>)["@context"];
    if (!Array.isArray(graph) || typeof context !== "object" || context === null) continue;

    // Prefixes come from the document's own @context, so the urn spelling
    // is the document's, not this probe's.
    const prefixes = new Map<string, string>();
    for (const [key, value] of Object.entries(context as Record<string, unknown>)) {
      if (typeof value === "string" && value.startsWith("urn:")) prefixes.set(key, value);
    }
    if (prefixes.size === 0) continue;

    const lines = scope.lines(file);
    for (const node of graph) {
      if (typeof node !== "object" || node === null) continue;
      const record = node as Record<string, unknown>;
      const id = record["@id"];
      if (typeof id !== "string") continue;
      const colon = id.indexOf(":");
      const expansion = colon === -1 ? undefined : prefixes.get(id.slice(0, colon));
      if (expansion === undefined) continue;
      const urn = expansion + id.slice(colon + 1);
      if (seen.has(urn)) continue;

      const breaksKey = Object.keys(record).find((key) => key.endsWith("breaks_if"));
      if (breaksKey === undefined) continue;
      seen.add(urn);
      const statusKey = Object.keys(record).find((key) => key.endsWith("enforcement_status"));

      let line = 0;
      for (let i = 0; i < lines.length; i += 1) {
        if ((lines[i] ?? "").includes(`"${id}"`)) {
          line = i + 1;
          break;
        }
      }
      out.push({
        urn,
        file,
        line,
        statement: String(record["description"] ?? record["english_name"] ?? ""),
        breaksIf: String(record[breaksKey] ?? ""),
        status: statusKey === undefined ? null : String(record[statusKey] ?? ""),
      });
    }
  }
  return out;
}

/** Annotation markers this tree actually uses to bind code to a urn,
 *  derived from the tree: a token at a comment margin followed by a urn.
 *  Nothing in this file names `@enforces`. */
function annotationMarkers(scope: Scope): string[] {
  const counts = new Map<string, number>();
  for (const file of scope.files) {
    const text = scope.read(file);
    if (text === null) continue;
    for (const match of text.matchAll(/(?:^|\n)[ \t>]*(?:\/\*+|\*|\/\/|#|--|<!--|"""|;)[ \t]*@([a-z][a-z-]{3,})[ \t]+urn:/g)) {
      const marker = `@${match[1]!}`;
      counts.set(marker, (counts.get(marker) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    // Two independent sites, so a single stray `@word urn:…` in one file
    // does not become a vocabulary. Not a scope: the markers themselves
    // come from the tree.
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([marker]) => marker);
}

function checkCanonRegistry(scope: Scope, index: Index): { candidates: Candidate[]; summary: Finding | null } {
  const nodes = canonNodes(scope);
  if (nodes.length === 0) return { candidates: [], summary: null };

  const markers = annotationMarkers(scope);
  const bound = new Map<string, Array<{ file: string; line: number; marker: string; block: string }>>();
  for (const marker of markers) {
    for (const file of scope.filesContaining(marker)) {
      // A test that documents the annotation convention in its own header
      // is not a defender, and the placeholder it quotes
      // (`@enforces urn:agenttool:commitment/<slug>`) is not a urn.
      if (isProseLike(file) || isTestPath(file)) continue;
      const lines = scope.lines(file);
      for (let i = 0; i < lines.length; i += 1) {
        const found = new RegExp(`${marker}\\s+(urn:[\\w:-]+(?:/[\\w.-]+)+)`).exec(lines[i] ?? "");
        if (found === null) continue;
        const urn = found[1]!.replace(/[.,;]$/, "");
        if (urn.endsWith("/")) continue;
        // The block belongs to THIS annotation only. A file that carries
        // four `@enforces` in one header would otherwise attribute the
        // fourth one's caveat to the first, which is how an accurate
        // statement about one wall becomes a false finding about another.
        const rest = lines.slice(i + 1, Math.min(lines.length, i + 14));
        const stop = rest.findIndex((candidate) => /@[a-z][a-z-]{3,}\s/.test(candidate) || candidate.includes("*/"));
        const block = [lines[i] ?? "", ...(stop === -1 ? rest : rest.slice(0, stop))].join("\n");
        bound.set(urn, [...(bound.get(urn) ?? []), { file, line: i + 1, marker, block }]);
      }
    }
  }

  const candidates: Candidate[] = [];
  let boundCount = 0;
  const confessing: string[] = [];

  // Every annotation whose own block states what the binding does NOT buy,
  // whether or not the urn it names is a guarantee entry in the registry.
  //
  // This is the check that finds `ring1-limits.ts`, where the annotation
  // says in its own words that "resource routes do not currently enforce
  // them… it is not evidence that cap callsites exist". That urn is a
  // Ring, not a Wall, so a sweep driven by the registry's guarantee
  // entries would walk straight past the best-behaved unenforced claim in
  // the repository. An annotation that confesses is the outcome to copy,
  // and it is reported by name so it can be copied.
  const explicit = /\b(?:do(?:es)? not (?:currently )?enforce|not (?:currently|yet) enforced|is not evidence|no callsites?)\b/i;
  for (const [urn, sites] of bound) {
    for (const site of sites) {
      const confession = matchConfession(site.block, true);
      if (confession === null) continue;
      confessing.push(`${site.file}:${site.line}  "${confession}"`);
      const node = nodes.find((candidate) => candidate.urn === urn);
      candidates.push({
        bucket: "canon-self-declared",
        score: explicit.test(site.block) ? 8 : 5,
        subject: `${site.file}:${site.line}`,
        finding: {
          probe: ID,
          title: `${urn} is annotated by a block that names the boundary of what it enforces`,
          file: site.file,
          line: site.line,
          verdict: "sound",
          evidence: `${clip(site.block, 560)}${node === undefined ? "" : `\n\ncanon: ${node.file}:${node.line}`}`,
          detail:
            "The annotation binds the code to the canon entry and says, in the same block, what the binding does and does not buy. This is the outcome to copy: a self-declared gap costs a reader one sentence to understand, and a silent one costs them a session to discover.",
        },
      });
      break;
    }
  }

  for (const node of nodes) {
    const sites = bound.get(node.urn) ?? [];
    if (sites.length > 0) {
      boundCount += 1;
      continue;
    }

    const confession = matchConfession(`${node.statement} ${node.breaksIf}`, true);
    if (node.status !== null && node.status !== "") {
      candidates.push({
        bucket: "canon-self-declared",
        score: 3,
        subject: node.urn,
        finding: {
          probe: ID,
          title: `${node.urn} has no code binding and the canon says so: ${node.status}`,
          file: node.file,
          line: node.line,
          verdict: "sound",
          evidence: `statement: ${clip(node.statement, 260)}\nenforcement status: ${node.status}\nannotations found: none (${markers.join(", ") || "no annotation marker in this tree"})`,
          detail:
            "The registry carries a field for exactly this, and this entry uses it. An unenforced commitment that declares itself unenforced is a different object from one that does not.",
        },
      });
      continue;
    }
    if (confession !== null) {
      candidates.push({
        bucket: "canon-self-declared",
        score: 4,
        subject: node.urn,
        finding: {
          probe: ID,
          title: `${node.urn} has no code binding, and its own statement admits it`,
          file: node.file,
          line: node.line,
          verdict: "sound",
          evidence: `statement: ${clip(node.statement, 340)}\n\nconfession: "${confession}"\nannotations found: none`,
          detail:
            "No annotation binds this entry to code, and the entry does not pretend otherwise — the description names what the current implementation does and does not do. The gap is declared, so it is not a gap in the sense this probe hunts.",
        },
      });
      continue;
    }

    // Nothing binds it, nothing declares it. Is it at least named
    // somewhere outside the registry — a test pinning the urn by hand?
    const elsewhere = (index.files(node.urn) ?? []).filter((file) => file !== node.file && !isDocument(file));
    const register = matchRegister(`${node.statement} ${node.breaksIf}`);
    candidates.push({
      bucket: "canon-unbacked",
      score: (register?.weight ?? 1) + (elsewhere.length === 0 ? 3 : 0),
      subject: node.urn,
      finding: {
        probe: ID,
        title:
          elsewhere.length === 0
            ? `${node.urn} states what breaks it and nothing in the tree binds it`
            : `${node.urn} has no annotation; it is named in ${elsewhere.length} non-document file(s)`,
        file: node.file,
        line: node.line,
        verdict: "gap",
        evidence:
          `statement: ${clip(node.statement, 300)}\n\nbreaks if: ${clip(node.breaksIf, 300)}\n\n` +
          `annotation markers in this tree: ${markers.join(", ") || "none"}\n` +
          `sites binding this urn: none\n` +
          (elsewhere.length === 0
            ? "occurrences outside the registry: none"
            : `occurrences outside the registry:\n${elsewhere.slice(0, 4).join("\n")}`),
        detail:
          "The registry entry states a guarantee and states what would break it, which is a testable sentence, and no annotation, constraint or test binds it to anything. " +
          "The registry also carries an enforcement-status field used by other entries to say \"not yet\" out loud; this entry uses neither the field nor an annotation, so its unenforced state is indistinguishable from an enforced one when read from the registry.",
      },
    });
  }

  const summary: Finding = {
    probe: ID,
    title: `${boundCount} of ${nodes.length} registry guarantees are bound to code by an annotation`,
    file: nodes[0]!.file,
    line: 0,
    verdict: "sound",
    evidence:
      `guarantee entries (carrying a "breaks if" statement): ${nodes.length}\n` +
      `bound by ${markers.join(", ") || "no marker"}: ${boundCount}\n` +
      `unbound: ${nodes.length - boundCount}\n` +
      (confessing.length > 0 ? `bound by a block that states its own limit: ${confessing.length}\n${confessing.slice(0, 6).join("\n")}` : ""),
    detail:
      "Calibration, not a score. This is the reason an unenforced claim here is hard to spot: most of them are enforced, so the register reads as trustworthy. The bound/unbound split is derived by matching the registry's own identifiers against annotation markers found in the tree.",
  };

  return { candidates, summary };
}

// ── rhizome's own boundaries, reported ────────────────────────────────────

/** Is the document-format set stale? A file that reads as a markdown
 *  document and carries an extension outside the set is a guarantee this
 *  probe cannot see, so it is published rather than assumed away. */
function checkFormatSet(scope: Scope): Finding[] {
  const outside: string[] = [];
  for (const file of scope.files) {
    if (isDocument(file)) continue;
    const text = scope.read(file);
    if (text === null) continue;
    // Recognised by content, not by a second extension list. An exclusion
    // list here would be a hard-coded enumeration inside the check whose
    // whole job is to find the first one going stale.
    const first = text.split("\n").find((line) => line.trim() !== "") ?? "";
    if (!/^#{1,2} \S/.test(first.trim())) continue;
    if (!/\n#{2,3} \S/.test(text)) continue;
    outside.push(file);
  }
  if (outside.length === 0) {
    return [
      {
        probe: ID,
        title: "no document-shaped file carries an extension outside the set this probe reads",
        file: "packages/rhizome/src/probes/claim.ts",
        line: 69,
        verdict: "sound",
        evidence: `document extensions read: ${DOCUMENT_EXTENSIONS.join(", ")}\nfiles that read as markdown documents and were skipped: 0`,
        detail:
          "The extension set is a boundary this probe chose. It is checked against the corpus on every run rather than trusted: every file whose text has markdown headings and whose extension is outside the set would be listed here.",
      },
    ];
  }
  return [
    {
      probe: ID,
      title: `${outside.length} document-shaped file(s) carry an extension this probe does not read`,
      file: outside[0]!,
      line: 0,
      verdict: "limit",
      evidence: `${outside.slice(0, 10).join("\n")}${outside.length > 10 ? `\n… and ${outside.length - 10} more` : ""}`,
      detail: `Guarantees stated in these files were never extracted. Widening ${DOCUMENT_EXTENSIONS.join("/")} in src/probes/claim.ts would bring them in.`,
    },
  ];
}

function checkShortlistBoundary(counted: Map<string, number>, shown: Map<string, number>, documents: number, mirrored: number, claims: number): Finding {
  const rows = [...counted.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([bucket, total]) => `${bucket.padEnd(20)} ${String(shown.get(bucket) ?? 0).padStart(3)} shown of ${total}`);
  return {
    probe: ID,
    title: `the shortlist shows ${[...shown.values()].reduce((a, b) => a + b, 0)} of ${[...counted.values()].reduce((a, b) => a + b, 0)} classified guarantees`,
    file: "packages/rhizome/src/probes/claim.ts",
    line: 0,
    verdict: "limit",
    evidence:
      `${documents} distinct documents read (${mirrored} further paths are byte-identical mirrors, read once)\n` +
      `${claims} sentences matched the load-bearing register and named at least one identifier\n\n${rows.join("\n")}\n\n` +
      "ranking: register weight (must not / never / cannot = 4 … only = 1) + anchor specificity (fewer files = higher) + bucket bonus",
    detail:
      "A probe that floods a reader is worse than one that surfaces twelve real things, so this is a shortlist and not a sweep. The suppressed remainder is real and unexamined; `--json` shows the same shortlist, not more. Raising a bucket cap in src/probes/claim.ts is how to see the rest.",
  };
}

// ── the probe ─────────────────────────────────────────────────────────────

export const claimProbe: Probe = {
  id: ID,
  title: "claim — documented invariants with no mechanism",
  question: "For every guarantee this repository states in prose, is there a mechanism that enforces it?",
  limits: LIMITS,
  run(scope: Scope): Finding[] {
    const index = new Index(scope);
    const { files: documents, mirrored } = canonicalFiles(scope, isDocument);
    const claims = collectClaims(scope, documents);

    const candidates = [...checkProseGuarantees(scope, index, claims)];
    const canon = checkCanonRegistry(scope, index);
    candidates.push(...canon.candidates);

    const counted = new Map<string, number>();
    for (const candidate of candidates) counted.set(candidate.bucket, (counted.get(candidate.bucket) ?? 0) + 1);

    const shown = new Map<string, number>();
    const findings: Finding[] = [];
    // One reading per identifier per bucket. `cited_commitments` is cited
    // in five documents; showing it five times spends the shortlist on one
    // fact and teaches the reader to skim.
    const spoken = new Set<string>();
    const perDocument = new Map<string, number>();
    for (const candidate of [...candidates].sort((a, b) => b.score - a.score || a.finding.file.localeCompare(b.finding.file))) {
      const used = shown.get(candidate.bucket) ?? 0;
      if (used >= (BUCKET_CAP[candidate.bucket] ?? 0)) continue;
      if (candidate.subject !== undefined) {
        // NUL as the separator, written as an escape rather than as a raw
        // byte. It was a raw byte until the integration run: one 0x00 in
        // this file made rhizome's own binary heuristic classify claim.ts
        // as unreadable, so the corpus held the file and could read none
        // of it — and the three limits claim declares then resolved
        // against a 0-line file and were reported as stale anchors. A
        // probe that cannot be read by the instrument it belongs to is
        // the instrument's blind spot, not the reader's.
        const key = `${candidate.bucket}\u0000${candidate.subject}`;
        if (spoken.has(key)) continue;
        spoken.add(key);
      }
      // …and at most two readings from any one *document*, so a single
      // spec draft naming four identifiers on four consecutive lines
      // cannot spend a whole bucket. The registry is deliberately not
      // subject to this: it is one file holding hundreds of independent
      // guarantees, and capping it per file would be the instrument
      // choosing what to see.
      if (isDocument(candidate.finding.file)) {
        const fromHere = perDocument.get(candidate.finding.file) ?? 0;
        if (fromHere >= MAX_PER_DOCUMENT) continue;
        perDocument.set(candidate.finding.file, fromHere + 1);
      }
      shown.set(candidate.bucket, used + 1);
      findings.push(candidate.finding);
    }

    if (canon.summary !== null) findings.push(canon.summary);
    findings.push(...checkFormatSet(scope));
    findings.push(checkShortlistBoundary(counted, shown, documents.length, mirrored, claims.length));
    return findings;
  },
};
