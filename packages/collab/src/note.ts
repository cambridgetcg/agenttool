/**
 * collab-note/1: one plain-text shape for a note, in every carrier.
 *
 *   <act>: <statement>
 *
 *   <optional body>
 *
 *   To: … / Re: … / Via: … / Why: … / Evidence: … / Limits: … / Purpose: … / Extent: … / Replaces: …
 *
 * A note reads like a commit message. The final paragraph is a trailer block
 * only when every line in it is a "Key: value" line or an indented
 * continuation, as `git interpret-trailers` reads it; trailer-looking lines
 * anywhere else are body. Keys are case-insensitive. A key that is neither
 * listed here nor an X- key stays in the body, and the parser says so.
 *
 * This module is pure: no store, no filesystem, no clock. A journal body, a
 * host message, a Markdown mailbox and a Lobby message are all parsed and
 * rendered through it, so every carrier reads the same note.
 *
 * Lengths are JavaScript string lengths (UTF-16 code units). That is the unit
 * the store's own caps measure, so a note that passes here fits the column it
 * lands in, and it never overstates a code-point limit such as the Lobby's.
 */
import { canonicalJson } from "./canonical.js";
import { CollabError } from "./errors.js";

export const NOTE_FORMAT = "collab-note/1" as const;

// ---------------------------------------------------------------- acts

export const NOTE_ACTS = [
  "note",
  "support",
  "challenge",
  "resolve",
  "withdraw",
  "accept",
  "request_changes",
  "decide",
  "relay_rejection",
  "take",
  "done",
  "propose",
  "poll",
  "vote",
] as const;
export type NoteAct = (typeof NOTE_ACTS)[number];

/** The grouping in spec section 3. */
export const NOTE_ACT_GROUPS = {
  journal: [
    "note",
    "support",
    "challenge",
    "resolve",
    "withdraw",
    "accept",
    "request_changes",
    "decide",
    "relay_rejection",
  ],
  work: ["take", "done"],
  deciding: ["propose", "poll", "vote"],
} as const satisfies Record<string, readonly NoteAct[]>;

/** The card's four families (spec section 12). relay_rejection is not on the
 * card: it only passes on the person's own "no", and agents rarely need it. */
export const NOTE_CARD_FAMILIES = {
  say: ["note"],
  stand: ["support", "challenge", "resolve", "withdraw"],
  work: ["take", "done", "accept", "request_changes"],
  decide: ["propose", "poll", "vote", "decide"],
} as const satisfies Record<string, readonly NoteAct[]>;

/** Acts that cannot be understood without saying what they answer. */
export const NOTE_ACTS_NEEDING_RE: readonly NoteAct[] = [
  "support",
  "challenge",
  "resolve",
  "withdraw",
  "accept",
  "request_changes",
  "relay_rejection",
];

const ACT_SET: ReadonlySet<string> = new Set(NOTE_ACTS);

export function isNoteAct(value: unknown): value is NoteAct {
  return typeof value === "string" && ACT_SET.has(value);
}

// ---------------------------------------------------------------- reasons

/** How a reason is known: checked by the speaker, told by someone, inferred,
 * or quoted verbatim from a cited record. */
export const NOTE_BASES = ["seen", "told", "inferred", "quoted"] as const;
export type NoteBasis = (typeof NOTE_BASES)[number];
const BASIS_SET: ReadonlySet<string> = new Set(NOTE_BASES);

/** Written in a basis mark only when a reason has cites but no basis, or when
 * the reason's own text ends in something that would read as a mark. It
 * reads back as "no basis given". */
export const NOTE_UNMARKED = "unmarked" as const;

// ---------------------------------------------------------------- keys

/** Trailer keys that map to note fields, in the order they are rendered. */
export const NOTE_FIELD_KEYS = {
  to: "To",
  re: "Re",
  via: "Via",
  why: "Why",
  evidence: "Evidence",
  limits: "Limits",
  purpose: "Purpose",
  extent: "Extent",
  replaces: "Replaces",
} as const;
type FieldName = keyof typeof NOTE_FIELD_KEYS;
type SingleField = "to" | "re" | "via" | "limits" | "purpose" | "extent" | "replaces";
const SINGLE_FIELDS: readonly SingleField[] = ["to", "re", "via", "limits", "purpose", "extent", "replaces"];
// Values that may span continuation lines; the others are one line each, so
// a wrapped one is joined back with spaces.
const MULTILINE_FIELDS: ReadonlySet<FieldName> = new Set(["limits", "extent"]);

/** Keys collab's own renders write (positions, ballot terms, carrying
 * renders). They are not note fields: a parser keeps them, in order, in
 * `trailers`, and a reader takes positions from storage, never from them. */
export const NOTE_RENDER_KEYS = [
  "Sha256",
  "Position",
  "Result",
  "Criteria",
  "Option",
  "Pick",
  "Quorum",
  "Closes",
  "Not-carried",
] as const;
export type NoteRenderKey = (typeof NOTE_RENDER_KEYS)[number];

const FIELD_BY_KEY: ReadonlyMap<string, FieldName> = new Map(
  (Object.entries(NOTE_FIELD_KEYS) as Array<[FieldName, string]>).map(([field, key]) => [key.toLowerCase(), field]),
);
const RENDER_KEY_BY_LOWER: ReadonlyMap<string, NoteRenderKey> = new Map(
  NOTE_RENDER_KEYS.map((key) => [key.toLowerCase(), key]),
);
const RENDER_KEY_SET: ReadonlySet<string> = new Set(NOTE_RENDER_KEYS);
const X_KEY = /^X-[A-Za-z0-9-]{1,30}$/i;
const LISTED_KEYS = [...Object.values(NOTE_FIELD_KEYS), ...NOTE_RENDER_KEYS].join(", ");

// ---------------------------------------------------------------- caps

export const NOTE_STATEMENT_MAX = 200;
export const NOTE_WHY_MAX = 8;
export const NOTE_WHY_TEXT_MAX = 300;
export const NOTE_EVIDENCE_MAX = 16;
/** Any single trailer value without a cap of its own. */
export const NOTE_VALUE_MAX = 1_000;
export const NOTE_LIMITS_MAX = 2_000;
export const NOTE_PURPOSE_MAX = 200;
/** The store caps an agreed extent and `authority_scope` at 1,000. */
export const NOTE_EXTENT_MAX = 1_000;
/** A journal report body written by the tools (the MCP text cap). */
export const NOTE_JOURNAL_MAX = 8_000;
/** done, accept and request_changes land in a 4,000-character summary,
 * without their Evidence lines (those become artifacts or cited events). */
export const NOTE_REVIEW_MAX = 4_000;
/** relay_rejection stores its text as the 2,000-character reason. */
export const NOTE_RELAY_TEXT_MAX = 2_000;
/** The carrying render; it leaves room for a Lobby message's envelope inside
 * the Lobby's 1,000-character cap. */
export const NOTE_CARRY_MAX = 800;

export const STATEMENT_TOO_LONG_REMEDY = "put the rest after a blank line";

export interface NoteCeiling {
  max: number;
  /** note: the whole rendered note; note_without_evidence: the rendered note
   * with its Evidence lines left out; text: the statement and body only. */
  measure: "note" | "note_without_evidence" | "text";
}

const JOURNAL_CEILING: NoteCeiling = Object.freeze({ max: NOTE_JOURNAL_MAX, measure: "note" });
const REVIEW_CEILING: NoteCeiling = Object.freeze({ max: NOTE_REVIEW_MAX, measure: "note_without_evidence" });
const RELAY_CEILING: NoteCeiling = Object.freeze({ max: NOTE_RELAY_TEXT_MAX, measure: "text" });

/** Per-act ceilings: each follows the storage that act reaches. */
export const NOTE_ACT_CEILINGS: Readonly<Record<NoteAct, NoteCeiling>> = Object.freeze({
  note: JOURNAL_CEILING,
  support: JOURNAL_CEILING,
  challenge: JOURNAL_CEILING,
  resolve: JOURNAL_CEILING,
  withdraw: JOURNAL_CEILING,
  accept: REVIEW_CEILING,
  request_changes: REVIEW_CEILING,
  decide: JOURNAL_CEILING,
  relay_rejection: RELAY_CEILING,
  take: JOURNAL_CEILING,
  done: REVIEW_CEILING,
  propose: JOURNAL_CEILING,
  poll: JOURNAL_CEILING,
  vote: JOURNAL_CEILING,
});

// ---------------------------------------------------------------- types

export interface NoteReason {
  text: string;
  /** null: no basis given. */
  basis: NoteBasis | null;
  /** 1-based positions in the note's Evidence list. */
  cites: number[];
}

export interface NoteTrailer {
  key: string;
  value: string;
}

export interface NoteFields {
  act: NoteAct;
  statement: string;
  body: string | null;
  to: string | null;
  re: string | null;
  via: string | null;
  why: NoteReason[];
  /** One evidence string per Evidence line (see parseEvidence). */
  evidence: string[];
  limits: string | null;
  purpose: string | null;
  extent: string | null;
  replaces: string | null;
  /** Render keys and X- keys, in order. */
  trailers: NoteTrailer[];
}

/** What renderNote accepts: act and statement, anything else optional. */
export interface NoteInput {
  act: NoteAct;
  statement: string;
  body?: string | null;
  to?: string | null;
  re?: string | null;
  via?: string | null;
  why?: Array<{ text: string; basis?: NoteBasis | null; cites?: number[] }>;
  evidence?: string[];
  limits?: string | null;
  purpose?: string | null;
  extent?: string | null;
  replaces?: string | null;
  trailers?: NoteTrailer[];
}

export interface ParsedNote extends Omit<NoteFields, "act"> {
  /** null when line 1 does not begin with a known act and ": ". */
  act: NoteAct | null;
  /** What the parser did that the writer may not have meant. Never a refusal. */
  advice: string[];
}

export interface NoteProblem {
  code: string;
  /** The input field, with a 0-based index for list items ("why[0]"). */
  field: string;
  message: string;
  max?: number;
  actual?: number;
  unit?: "chars" | "items";
  remedy?: string;
}

// ---------------------------------------------------------------- normalisation

// The byte-order mark, the bidirectional controls (ALM, LRM, RLM, the
// embeddings and overrides, the isolates) and the tag characters. All render
// as nothing, so they could make a note read differently from its bytes.
const STRIPPED = /[﻿؜‎‏‪-‮⁦-⁩\u{E0000}-\u{E007F}]/gu;
const HAS_STRIPPED = /[﻿؜‎‏‪-‮⁦-⁩\u{E0000}-\u{E007F}]/u;

function cleanLines(text: string): string[] {
  // Invisible characters go first, so one between CR and LF cannot turn a
  // line ending into a blank line.
  return text
    .replace(STRIPPED, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""));
}

/**
 * Strip the BOM, bidirectional controls and tag characters; turn CRLF (and a
 * lone CR) into LF; trim trailing spaces and tabs on every line; trim the
 * whole text. Idempotent. The store trims every body it keeps, so text that
 * equals its own normal form is stored byte for byte.
 */
export function normalizeNoteText(text: string): string {
  return cleanLines(text).join("\n").trim();
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === "") start += 1;
  while (end > start && lines[end - 1] === "") end -= 1;
  return lines.slice(start, end);
}

// A body keeps the indentation of its first line (a code block, say), so it
// is not trimmed at the start the way a whole note is.
function normalizeBodyText(text: string): string | null {
  const body = trimBlankEdges(cleanLines(text)).join("\n").trimEnd();
  return body === "" ? null : body;
}

function normalizeLineValue(value: string): string | null {
  // A one-line field cannot hold a line break; joining with a space keeps
  // every word.
  const line = cleanLines(value).map((part) => part.trim()).filter((part) => part !== "").join(" ");
  return line === "" ? null : line;
}

function normalizeMultilineValue(value: string): string | null {
  // A trailer value continues on indented lines and cannot hold a blank
  // line, so blank lines are dropped and each line trimmed.
  const lines = cleanLines(value).map((line) => line.trim()).filter((line) => line !== "");
  return lines.length === 0 ? null : lines.join("\n");
}

/**
 * Bring loosely written fields (from JSON tool input, or a stored record) to
 * the form renderNote accepts: text normalised as above, empty values
 * dropped, a one-line field's line breaks joined with spaces, a trailer
 * value's blank lines dropped, basis words and act lower-cased, render keys
 * spelled as listed. It never shortens anything. A statement with a line
 * break is left as it is, so renderNote refuses it with the remedy. A blank
 * Why or Evidence item stays in its place as "", so checkNote refuses it:
 * Why cites count Evidence positions, and dropping an item would move every
 * later cite onto evidence the writer did not cite.
 */
export function normalizeNoteFields(input: NoteInput): NoteFields {
  const fields = completeFields(input);
  const line = (value: string | null): string | null =>
    typeof value === "string" ? normalizeLineValue(value) : value;
  const multiline = (value: string | null): string | null =>
    typeof value === "string" ? normalizeMultilineValue(value) : value;
  const trailers: NoteTrailer[] = [];
  for (const trailer of fields.trailers) {
    const key = typeof trailer.key === "string" ? trailer.key.trim() : trailer.key;
    const canonical = typeof key === "string" ? RENDER_KEY_BY_LOWER.get(key.toLowerCase()) ?? key : key;
    const value = typeof trailer.value === "string"
      ? canonical === "Sha256" ? normalizeLineValue(trailer.value) : normalizeMultilineValue(trailer.value)
      : trailer.value;
    if (value !== null) trailers.push({ key: canonical, value });
  }
  return {
    act: (typeof fields.act === "string" ? fields.act.trim().toLowerCase() : fields.act) as NoteAct,
    statement: typeof fields.statement === "string"
      ? cleanLines(fields.statement).join("\n").trim()
      : fields.statement,
    body: typeof fields.body === "string" ? normalizeBodyText(fields.body) : fields.body,
    to: line(fields.to),
    re: line(fields.re),
    via: line(fields.via),
    why: fields.why.map((reason) => ({
      text: typeof reason.text === "string" ? normalizeLineValue(reason.text) ?? "" : reason.text,
      basis: typeof reason.basis === "string"
        ? (reason.basis.trim() === "" ? null : reason.basis.trim().toLowerCase() as NoteBasis)
        : reason.basis,
      cites: reason.cites,
    })),
    evidence: fields.evidence.map((item) => (typeof item === "string" ? normalizeLineValue(item) ?? "" : item)),
    limits: multiline(fields.limits),
    purpose: line(fields.purpose),
    extent: multiline(fields.extent),
    replaces: line(fields.replaces),
    trailers,
  };
}

/** Read text as a statement on its first line and an optional body after
 * it, with no trailer parsing (for a caller that already knows the act). */
export function splitNoteText(text: string): { statement: string; body: string | null } {
  const lines = normalizeNoteText(text).split("\n");
  const body = trimBlankEdges(lines.slice(1)).join("\n").trimEnd();
  return { statement: lines[0] ?? "", body: body === "" ? null : body };
}

// ---------------------------------------------------------------- evidence

export const NOTE_EVIDENCE_KINDS = [
  "file",
  "commit",
  "test",
  "url",
  "data",
  "msg",
  "report",
  "event",
  "artifact",
  "checkpoint",
] as const;
export type NoteEvidenceKind = (typeof NOTE_EVIDENCE_KINDS)[number];

/** Journal references: written `<kind>:<id>`. They resolve inside collab. */
export const NOTE_JOURNAL_EVIDENCE_KINDS = ["report", "event", "artifact", "checkpoint"] as const;

/** Attributes, written ` k=v` at the end of an evidence line, in this order. */
export const NOTE_EVIDENCE_ATTRS = ["sha256", "exit", "out", "lines", "runs", "at"] as const;
export type NoteEvidenceAttr = (typeof NOTE_EVIDENCE_ATTRS)[number];

export const NOTE_EVIDENCE_FORMS = [
  "file <repo path>[:a-b]",
  "commit <sha>",
  "test <command> exit=<n>",
  "url <url>",
  "data <label> sha256=<hex>",
  "msg <channel> <id>",
  "report:<id>",
  "event:<id>",
  "artifact:<id>",
  "checkpoint:<id>",
] as const;

export interface NoteEvidence {
  kind: NoteEvidenceKind;
  /** The path (with any :a-b range), sha, command, url, label, "channel id",
   * or journal id; for a handle such as report#3fa91c, the handle itself. */
  locator: string;
  attrs: Partial<Record<NoteEvidenceAttr, string>>;
}

const ATTR_SET: ReadonlySet<string> = new Set(NOTE_EVIDENCE_ATTRS);
const JOURNAL_EVIDENCE_SET: ReadonlySet<string> = new Set(NOTE_JOURNAL_EVIDENCE_KINDS);
const ID_TOKEN = String.raw`[A-Za-z0-9][A-Za-z0-9._:#-]*`;
const JOURNAL_EVIDENCE = new RegExp(String.raw`^(report|event|artifact|checkpoint):(${ID_TOKEN})$`, "i");
const HANDLE_EVIDENCE = /^(?:report|proposal|ballot)#[0-9a-f]{6,32}$/i;
const WORD_EVIDENCE = /^(file|commit|test|url|data|msg)[ \t]+(\S[^\n]*)$/i;
const TRAILING_ATTR = /[ \t]+([A-Za-z0-9]+)=(\S+)$/;
const ATTR_VALUE: Readonly<Record<NoteEvidenceAttr, RegExp>> = {
  sha256: /^[0-9a-f]{64}$/i,
  exit: /^-?\d{1,10}$/,
  out: /^sha256:[0-9a-f]{64}$/i,
  lines: /^\d{1,9}(?:-\d{1,9})?$/,
  runs: /^\d{1,9}$/,
  at: /^\S+$/,
};
const FILE_RANGE = /:(\d+)(?:-(\d+))?$/;

function evidenceError(message: string, value?: string): CollabError {
  return new CollabError(
    "invalid_evidence",
    `${message}. Evidence forms: ${NOTE_EVIDENCE_FORMS.join(" | ")}`,
    value === undefined ? { forms: [...NOTE_EVIDENCE_FORMS] } : { forms: [...NOTE_EVIDENCE_FORMS], evidence: value },
  );
}

/**
 * Read one evidence string: `kind SP locator *( SP k=v )`, or a journal
 * reference `report:<id>` (also `event:`, `artifact:`, `checkpoint:`), or a
 * report handle (`report#3fa91c`, `proposal#…`, `ballot#…`), read as kind
 * report. For every kind the locator runs up to the trailing known `k=v`
 * words, so a test command may itself contain `=`. Throws invalid_evidence.
 */
export function parseEvidence(value: string): NoteEvidence {
  if (typeof value !== "string") throw evidenceError("Evidence must be a string");
  if (value.includes("\n") || value.includes("\r")) throw evidenceError("Evidence is one line", value);
  const text = value.trim();
  if (text === "") throw evidenceError("Evidence is empty");
  const journal = JOURNAL_EVIDENCE.exec(text);
  if (journal) {
    return { kind: journal[1]!.toLowerCase() as NoteEvidenceKind, locator: journal[2]!, attrs: {} };
  }
  if (HANDLE_EVIDENCE.test(text)) return { kind: "report", locator: text, attrs: {} };
  const word = WORD_EVIDENCE.exec(text);
  if (!word) {
    if (/^task[:#_]/i.test(text)) {
      throw evidenceError("A task is not evidence; cite its completion report (report:<id>)", value);
    }
    throw evidenceError("Evidence does not start with a known kind", value);
  }
  const kind = word[1]!.toLowerCase() as NoteEvidenceKind;
  let locator = word[2]!;
  const attrs: Partial<Record<NoteEvidenceAttr, string>> = {};
  for (;;) {
    const match = TRAILING_ATTR.exec(locator);
    if (!match) break;
    const key = match[1]!.toLowerCase();
    // An unknown key, or one already read, belongs to the locator (a
    // command such as `make V=1`).
    if (!ATTR_SET.has(key) || key in attrs) break;
    const attr = key as NoteEvidenceAttr;
    if (!ATTR_VALUE[attr].test(match[2]!)) throw evidenceError(`${attr}= has an unreadable value`, value);
    attrs[attr] = match[2]!;
    locator = locator.slice(0, match.index);
  }
  if (kind === "commit" && !/^[0-9a-f]{7,64}$/i.test(locator)) {
    throw evidenceError("A commit is cited by its hex sha (7 to 64 hex digits)", value);
  }
  if (kind === "url" && !/^[A-Za-z][A-Za-z0-9+.-]*:\S+$/.test(locator)) {
    throw evidenceError("A url is one word with a scheme, such as https://…", value);
  }
  if (kind === "msg" && !/^\S+[ \t]+\S/.test(locator)) {
    throw evidenceError("A msg cite names its channel and the message id", value);
  }
  if (kind === "file") {
    const range = FILE_RANGE.exec(locator);
    if (range) {
      const from = Number(range[1]);
      const to = range[2] === undefined ? from : Number(range[2]);
      if (from < 1 || to < from) throw evidenceError("A file line range is 1-based and runs forwards", value);
      if (range.index === 0) throw evidenceError("A file cite needs a path before its line range", value);
    }
  }
  return { kind, locator, attrs };
}

/** Render one evidence item; parseEvidence(renderEvidence(e)) equals e.
 * Throws invalid_evidence when the item could not read back as itself. */
export function renderEvidence(evidence: NoteEvidence): string {
  const attrs = Object.fromEntries(
    NOTE_EVIDENCE_ATTRS.filter((key) => evidence.attrs[key] !== undefined).map((key) => [key, evidence.attrs[key]!]),
  ) as Partial<Record<NoteEvidenceAttr, string>>;
  const text = JOURNAL_EVIDENCE_SET.has(evidence.kind)
    ? `${evidence.kind}:${evidence.locator}`
    : [`${evidence.kind} ${evidence.locator}`, ...Object.entries(attrs).map(([key, value]) => `${key}=${value}`)]
      .join(" ");
  const back = parseEvidence(text);
  if (canonicalJson(back) !== canonicalJson({ kind: evidence.kind, locator: evidence.locator, attrs })) {
    throw evidenceError(
      "This evidence would read back differently (a locator ending in a word such as exit=0 reads as an attribute)",
      text,
    );
  }
  return text;
}

/** Split a file locator into its path and optional 1-based line range. */
export function fileLocatorParts(locator: string): { path: string; from: number | null; to: number | null } {
  const range = FILE_RANGE.exec(locator);
  if (!range || range.index === 0) return { path: locator, from: null, to: null };
  const from = Number(range[1]);
  return { path: locator.slice(0, range.index), from, to: range[2] === undefined ? from : Number(range[2]) };
}

// ---------------------------------------------------------------- references

export const NOTE_REF_KINDS = ["report", "proposal", "ballot", "task", "event", "file", "lobby", "msg"] as const;
export type NoteRefKind = (typeof NOTE_REF_KINDS)[number];

export interface NoteRef {
  kind: NoteRefKind;
  /** The id, handle, path, room message or free text after the prefix. */
  id: string;
  /** True for a short handle (`report#3fa91c`), which a carrying render
   * never uses: on another device it could match a different item. */
  handle: boolean;
}

const HANDLE = /^(report|proposal|ballot|task)#[0-9a-f]{6,32}$/i;
const PREFIXED_REF = new RegExp(String.raw`^(report|proposal|ballot|task|event):(${ID_TOKEN})$`, "i");
const BARE_REF = /^(report|task)_[A-Za-z0-9][A-Za-z0-9._:-]*$/;
// A Lobby ref is one room and message token; a file path or message text may
// hold spaces.
const TEXT_REF = /^(?:(file|msg):(\S[^\n]*)|(lobby):(\S+))$/i;
export const NOTE_VIA_KINDS = ["host", "file", "lobby", "msg"] as const;
const VIA = /^(?:host|file|lobby|msg):\S/i;

/** True for a short handle such as `report#3fa91c`. */
export function isNoteHandle(value: string): boolean {
  return HANDLE.test(value);
}

/** Read a Re: or Replaces: value; null when it is no known reference. Only
 * journal kinds resolve inside collab; file, lobby and msg stay text. */
export function parseNoteRef(value: string): NoteRef | null {
  const handle = HANDLE.exec(value);
  if (handle) return { kind: handle[1]!.toLowerCase() as NoteRefKind, id: value, handle: true };
  const prefixed = PREFIXED_REF.exec(value);
  if (prefixed) {
    return { kind: prefixed[1]!.toLowerCase() as NoteRefKind, id: prefixed[2]!, handle: HANDLE.test(prefixed[2]!) };
  }
  const bare = BARE_REF.exec(value);
  if (bare) return { kind: bare[1] as NoteRefKind, id: value, handle: false };
  const text = TEXT_REF.exec(value);
  if (text) {
    return { kind: (text[1] ?? text[3])!.toLowerCase() as NoteRefKind, id: (text[2] ?? text[4])!, handle: false };
  }
  return null;
}

const REF_FORMS =
  "report:<id>, proposal:<id>, ballot:<id>, task:<id>, event:<id>, a handle such as report#3fa91c, file:<path>[#n], lobby:<room>#<n> or msg:<text>";

// ---------------------------------------------------------------- parsing

const SUBJECT = /^([A-Za-z_]+):(?: ([^\n]*))?$/;
const TRAILER_LINE = /^([A-Za-z][A-Za-z0-9-]{0,63}):(?: ([^\n]*))?$/;
const CONTINUATION = /^[ \t]+\S/;
const KEYISH = /^([A-Za-z][A-Za-z0-9-]{0,63}):(\S?)/;
const BASIS_MARK = /^([\s\S]*?)\s*\(\s*(seen|told|inferred|quoted|unmarked)\b([^()]*)\)$/i;

interface MarkReading {
  text: string;
  basis: NoteBasis | null;
  cites: number[];
  /** none: no mark at the end; read: a mark was read; unreadable: the text
   * ends in "(seen …)" with something other than cite numbers inside. */
  mark: "none" | "read" | "unreadable";
}

function readBasisMark(value: string): MarkReading {
  const match = BASIS_MARK.exec(value);
  if (!match) return { text: value, basis: null, cites: [], mark: "none" };
  const inner = match[3]!.trim();
  const tokens = inner === "" ? [] : inner.split(/\s*,\s*|\s+/);
  if (tokens.some((token) => !/^\d{1,6}$/.test(token))) {
    return { text: value, basis: null, cites: [], mark: "unreadable" };
  }
  const word = match[2]!.toLowerCase();
  return {
    text: match[1]!.trim(),
    basis: word === NOTE_UNMARKED ? null : word as NoteBasis,
    cites: tokens.map(Number),
    mark: "read",
  };
}

function renderReason(reason: NoteReason): string {
  if (reason.basis !== null || reason.cites.length > 0) {
    const cites = reason.cites.length > 0 ? ` ${reason.cites.join(",")}` : "";
    return `${reason.text} (${reason.basis ?? NOTE_UNMARKED}${cites})`;
  }
  // Text that itself ends in "(seen)" would read back as a basis; an
  // explicit "(unmarked)" keeps it as text.
  return readBasisMark(reason.text).mark === "none" ? reason.text : `${reason.text} (${NOTE_UNMARKED})`;
}

interface BlockEntry {
  key: string;
  line: number;
  values: string[];
  raw: string[];
}

function isTrailerBlock(lines: readonly string[]): boolean {
  if (lines.length === 0 || !TRAILER_LINE.test(lines[0]!)) return false;
  return lines.every((line) => TRAILER_LINE.test(line) || CONTINUATION.test(line));
}

function blockEntries(lines: readonly string[], firstLine: number): BlockEntry[] {
  const entries: BlockEntry[] = [];
  lines.forEach((line, index) => {
    const trailer = TRAILER_LINE.exec(line);
    if (trailer) {
      entries.push({ key: trailer[1]!, line: firstLine + index, values: [(trailer[2] ?? "").trim()], raw: [line] });
    } else {
      const entry = entries[entries.length - 1]!;
      entry.values.push(line.trim());
      entry.raw.push(line);
    }
  });
  return entries;
}

interface BlockReading {
  single: Record<SingleField, string | null>;
  why: Array<{ reason: NoteReason; line: number }>;
  evidence: Array<{ text: string; line: number }>;
  trailers: NoteTrailer[];
  /** Lines the block could not use; they stay in the body, in order. */
  kept: string[];
}

function readBlock(lines: readonly string[], firstLine: number, advice: string[]): BlockReading {
  const reading: BlockReading = {
    single: { to: null, re: null, via: null, limits: null, purpose: null, extent: null, replaces: null },
    why: [],
    evidence: [],
    trailers: [],
    kept: [],
  };
  for (const entry of blockEntries(lines, firstLine)) {
    const lower = entry.key.toLowerCase();
    const field = FIELD_BY_KEY.get(lower);
    const renderKey = RENDER_KEY_BY_LOWER.get(lower);
    if (field === undefined && renderKey === undefined && !X_KEY.test(entry.key)) {
      reading.kept.push(...entry.raw);
      advice.push(
        `Line ${entry.line}: "${entry.key}:" is not a collab-note/1 key, so the line stays in the body. ` +
          `Trailer keys are ${LISTED_KEYS}, or an X- key.`,
      );
      continue;
    }
    const multiline = field === undefined ? renderKey !== "Sha256" : MULTILINE_FIELDS.has(field);
    const value = entry.values.filter((part) => part !== "").join(multiline ? "\n" : " ");
    if (value === "" && field === "evidence") {
      // Why cites count Evidence positions, so an empty line keeps its place
      // (and checkNote refuses it) rather than moving later cites.
      reading.evidence.push({ text: "", line: entry.line });
      advice.push(
        `Line ${entry.line}: Evidence ${reading.evidence.length} is empty. It keeps its place so later cites keep ` +
          "their numbers; remove it and renumber the cites after it.",
      );
      continue;
    }
    if (value === "") {
      reading.kept.push(...entry.raw);
      advice.push(`Line ${entry.line}: "${entry.key}:" has no value, so the line stays in the body.`);
      continue;
    }
    if (field === "why") {
      const mark = readBasisMark(value);
      if (mark.mark === "unreadable") {
        advice.push(
          `Line ${entry.line}: the reason ends in a parenthesis that is not a basis mark, so it was read as text; ` +
            `write (seen), (told), (inferred) or (quoted), with any cite numbers, such as (seen 1,2).`,
        );
      } else if (mark.mark === "read" && mark.text === "") {
        advice.push(`Line ${entry.line}: this Why: has a basis but no reason before it.`);
      }
      reading.why.push({ reason: { text: mark.text, basis: mark.basis, cites: mark.cites }, line: entry.line });
    } else if (field === "evidence") {
      reading.evidence.push({ text: value, line: entry.line });
    } else if (field !== undefined) {
      if (reading.single[field] !== null) {
        reading.kept.push(...entry.raw);
        advice.push(
          `Line ${entry.line}: a second "${NOTE_FIELD_KEYS[field]}:" stays in the body; only the first one counts.`,
        );
        continue;
      }
      reading.single[field] = value;
    } else {
      reading.trailers.push({ key: renderKey ?? entry.key, value });
    }
  }
  return reading;
}

function adviseBodyTrailers(lines: readonly string[], firstLine: number, advice: string[]): void {
  lines.forEach((line, index) => {
    const match = KEYISH.exec(line);
    if (!match) return;
    const field = FIELD_BY_KEY.get(match[1]!.toLowerCase());
    if (field === undefined) return;
    const key = NOTE_FIELD_KEYS[field];
    advice.push(
      match[2] !== ""
        ? `Line ${firstLine + index} looks like a ${key}: trailer but has no space after the colon, so it is body text.`
        : `Line ${firstLine + index} looks like a ${key}: trailer but is in the body; trailers are read only from ` +
          `the last paragraph, with no blank line between them.`,
    );
  });
}

/**
 * Parse collab-note/1 text (normalised first). Never refuses: whatever it
 * cannot use stays in the body or the statement, and `advice` says what
 * happened. A caller that is about to write runs checkNote on the result.
 */
export function parseNote(text: string): ParsedNote {
  const lines = normalizeNoteText(text).split("\n");
  const advice: string[] = [];
  const subject = lines[0] ?? "";
  let act: NoteAct | null = null;
  let statement = subject;
  const head = SUBJECT.exec(subject);
  const word = head?.[1]?.toLowerCase();
  if (head && isNoteAct(word)) {
    act = word;
    statement = (head[2] ?? "").trim();
    if (statement === "") advice.push(`Line 1: "${head[1]}:" has no statement after it.`);
  } else {
    advice.push(
      `Line 1 does not begin with a known act and ": " (${NOTE_ACTS.join(", ")}), so no act was read; ` +
        `the whole line is the statement.`,
    );
  }

  const rest = lines.slice(1);
  const finalStart = rest.lastIndexOf("") + 1;
  const finalParagraph = rest.slice(finalStart);
  const hasBlock = isTrailerBlock(finalParagraph);
  const bodyLines = hasBlock ? rest.slice(0, finalStart) : rest;
  adviseBodyTrailers(bodyLines, 2, advice);
  const block = hasBlock ? readBlock(finalParagraph, finalStart + 2, advice) : readBlock([], 0, advice);

  const ownBody = trimBlankEdges(bodyLines).join("\n").trimEnd();
  const kept = block.kept.join("\n");
  const joined = ownBody === "" ? kept : kept === "" ? ownBody : `${ownBody}\n\n${kept}`;
  const body = joined === "" ? null : joined;

  const evidence = block.evidence.map((item) => item.text);
  block.evidence.forEach((item, index) => {
    if (item.text === "") return; // already advised by readBlock
    try {
      parseEvidence(item.text);
    } catch (error) {
      if (!(error instanceof CollabError)) throw error;
      advice.push(`Line ${item.line}: Evidence ${index + 1} is not a known evidence form (${NOTE_EVIDENCE_FORMS.join(" | ")}).`);
    }
  });
  for (const { reason, line } of block.why) {
    for (const cite of reason.cites) {
      if (cite < 1) advice.push(`Line ${line}: cite ${cite} is not an Evidence position; cites count from 1.`);
      else if (cite > evidence.length) {
        advice.push(`Line ${line}: cites Evidence ${cite}, but the note has ${evidence.length} Evidence line(s).`);
      }
    }
  }
  for (const field of ["re", "replaces"] as const) {
    const value = block.single[field];
    if (value !== null && parseNoteRef(value) === null) {
      advice.push(`"${NOTE_FIELD_KEYS[field]}: ${value}" is not a known reference (${REF_FORMS}).`);
    }
  }
  if (block.single.via !== null && !VIA.test(block.single.via)) {
    advice.push(`"Via: ${block.single.via}" is not a known channel (host:…, file:…, lobby:… or msg:…).`);
  }
  if (act !== null && NOTE_ACTS_NEEDING_RE.includes(act) && block.single.re === null) {
    advice.push(`"${act}" needs a Re: line naming what it answers.`);
  }

  return {
    act,
    statement,
    body,
    to: block.single.to,
    re: block.single.re,
    via: block.single.via,
    why: block.why.map((item) => item.reason),
    evidence,
    limits: block.single.limits,
    purpose: block.single.purpose,
    extent: block.single.extent,
    replaces: block.single.replaces,
    trailers: block.trailers,
    advice,
  };
}

// ---------------------------------------------------------------- checking

function completeFields(input: NoteInput): NoteFields {
  if (input === null || typeof input !== "object") {
    throw new CollabError("invalid_note_field", "A note needs at least an act and a statement", { field: "note" });
  }
  for (const field of ["why", "evidence", "trailers"] as const) {
    if (input[field] !== undefined && !Array.isArray(input[field])) {
      throw new CollabError("invalid_note_field", `${field} must be a list`, { field });
    }
  }
  return {
    act: input.act,
    statement: input.statement,
    body: input.body ?? null,
    to: input.to ?? null,
    re: input.re ?? null,
    via: input.via ?? null,
    why: (input.why ?? []).map((reason) => ({
      text: reason?.text,
      basis: reason?.basis ?? null,
      cites: reason?.cites ?? [],
    })),
    evidence: [...(input.evidence ?? [])],
    limits: input.limits ?? null,
    purpose: input.purpose ?? null,
    extent: input.extent ?? null,
    replaces: input.replaces ?? null,
    trailers: (input.trailers ?? []).map((trailer) => ({ key: trailer?.key, value: trailer?.value })),
  };
}

const NORMALIZE_HINT = "normalizeNoteFields fixes whitespace and invisible characters";
// The store refuses NUL in a report body (cleanText), and ballot.ts in poll
// terms and votes; a note refuses it here, before any write.
const NUL_PROBLEM = "must not contain NUL characters";

function lineProblem(value: unknown): string | null {
  if (typeof value !== "string") return "must be a string";
  if (value === "") return "must not be empty";
  if (value.includes("\0")) return NUL_PROBLEM;
  if (value.includes("\n") || value.includes("\r")) return "must be one line";
  if (HAS_STRIPPED.test(value)) {
    return `contains a byte-order mark, a bidirectional control or a tag character (${NORMALIZE_HINT})`;
  }
  if (value !== value.trim()) return `has leading or trailing whitespace (${NORMALIZE_HINT})`;
  return null;
}

function multilineProblem(value: unknown): string | null {
  if (typeof value !== "string") return "must be a string";
  if (value === "") return "must not be empty";
  if (value.includes("\0")) return NUL_PROBLEM;
  if (value.includes("\r")) return `contains a carriage return (${NORMALIZE_HINT})`;
  if (HAS_STRIPPED.test(value)) {
    return `contains a byte-order mark, a bidirectional control or a tag character (${NORMALIZE_HINT})`;
  }
  if (value.split("\n").some((line) => line === "" || line !== line.trim())) {
    return `has a blank line or a line with surrounding whitespace, which a trailer value cannot hold (${NORMALIZE_HINT})`;
  }
  return null;
}

function bodyProblem(value: string): string | null {
  if (typeof value !== "string") return "must be a string";
  if (value.includes("\0")) return NUL_PROBLEM;
  if (value.includes("\r")) return `contains a carriage return (${NORMALIZE_HINT})`;
  if (HAS_STRIPPED.test(value)) {
    return `contains a byte-order mark, a bidirectional control or a tag character (${NORMALIZE_HINT})`;
  }
  const lines = value.split("\n");
  if (lines[0] === "" || lines[lines.length - 1] === "" || value !== value.trimEnd()) {
    return `must not start or end with a blank line or end with whitespace (${NORMALIZE_HINT})`;
  }
  if (lines.some((line) => /[ \t]$/.test(line))) return `has a line ending in spaces (${NORMALIZE_HINT})`;
  return null;
}

function reasonProblems(reason: NoteReason, index: number, evidenceCount: number | null): NoteProblem[] {
  const field = `why[${index}]`;
  const problems: NoteProblem[] = [];
  const text = lineProblem(reason.text);
  if (text) problems.push({ code: "invalid_note_field", field, message: `Why ${index + 1}'s text ${text}` });
  if (reason.basis !== null && !BASIS_SET.has(reason.basis as string)) {
    problems.push({
      code: "invalid_note_field",
      field: `${field}.basis`,
      message: `Why ${index + 1}'s basis must be ${NOTE_BASES.join(", ")}, or absent`,
    });
  }
  if (!Array.isArray(reason.cites) || reason.cites.some((cite) => !Number.isInteger(cite) || cite < 1)) {
    problems.push({
      code: "invalid_note_field",
      field: `${field}.cites`,
      message: `Why ${index + 1}'s cites are 1-based positions in the Evidence list`,
    });
  } else if (evidenceCount !== null) {
    const outside = reason.cites.find((cite) => cite > evidenceCount);
    if (outside !== undefined) {
      problems.push({
        code: "cite_out_of_range",
        field: `${field}.cites`,
        message: `Why ${index + 1} cites Evidence ${outside}, but the note has ${evidenceCount} Evidence item(s)`,
        max: evidenceCount,
        actual: outside,
      });
    }
  }
  return problems;
}

function evidenceProblem(item: unknown, index: number): NoteProblem | null {
  const field = `evidence[${index}]`;
  const line = lineProblem(item);
  if (line && item === "") {
    return {
      code: "invalid_note_field",
      field,
      message: `Evidence ${index + 1} ${line}`,
      remedy: "Remove the empty item and renumber the Why cites after it: cites count Evidence positions from 1.",
    };
  }
  if (line) return { code: "invalid_note_field", field, message: `Evidence ${index + 1} ${line}` };
  try {
    parseEvidence(item as string);
    return null;
  } catch (error) {
    if (!(error instanceof CollabError)) throw error;
    return { code: "invalid_evidence", field, message: `Evidence ${index + 1}: ${error.message}` };
  }
}

function trailerProblem(trailer: NoteTrailer, index: number): NoteProblem | null {
  const field = `trailers[${index}]`;
  const key = trailer.key;
  if (typeof key !== "string" || !(RENDER_KEY_SET.has(key) || X_KEY.test(key))) {
    const fieldKey = typeof key === "string" ? FIELD_BY_KEY.get(key.toLowerCase()) : undefined;
    return {
      code: "invalid_note_field",
      field: `${field}.key`,
      message: fieldKey !== undefined
        ? `"${key}" is a note field; set ${fieldKey} instead of a trailer`
        : `A trailer key is one of ${NOTE_RENDER_KEYS.join(", ")} (spelled so), or X- and 1 to 30 letters, digits or dashes`,
    };
  }
  if (key === "Sha256") {
    return typeof trailer.value === "string" && /^[0-9a-f]{64}$/i.test(trailer.value)
      ? null
      : { code: "invalid_note_field", field: `${field}.value`, message: "Sha256 is 64 hex digits" };
  }
  const value = multilineProblem(trailer.value);
  return value ? { code: "invalid_note_field", field: `${field}.value`, message: `${key} ${value}` } : null;
}

function hasTrailerLines(fields: NoteFields, omitEvidence = false): boolean {
  return SINGLE_FIELDS.some((field) => fields[field] !== null)
    || fields.why.length > 0
    || (!omitEvidence && fields.evidence.length > 0)
    || fields.trailers.length > 0;
}

// A body whose last paragraph would be read as trailers cannot be rendered
// without a trailer after it: the reader would take those lines out of it.
function bodyEndsInTrailers(body: string): boolean {
  const lines = body.split("\n");
  const last = lines.slice(lines.lastIndexOf("") + 1);
  if (!isTrailerBlock(last)) return false;
  const reading = readBlock(last, 1, []);
  return reading.kept.length < last.length;
}

interface ShapeOptions {
  /** Check that cites name carried Evidence positions. */
  cites: boolean;
  /** Check that acts needing Re: have one. */
  requireRe: boolean;
}

function shapeProblems(fields: NoteFields, options: ShapeOptions): NoteProblem[] {
  const problems: NoteProblem[] = [];
  const add = (code: string, field: string, message: string, extra: Partial<NoteProblem> = {}): void => {
    problems.push({ code, field, message, ...extra });
  };
  if (!isNoteAct(fields.act)) add("invalid_note_field", "act", `act must be one of ${NOTE_ACTS.join(", ")}`);
  const statement = lineProblem(fields.statement);
  if (statement) {
    add(
      "invalid_note_field",
      "statement",
      `The statement ${statement}`,
      statement === "must be one line" ? { remedy: STATEMENT_TOO_LONG_REMEDY } : {},
    );
  }
  if (fields.body !== null) {
    const body = bodyProblem(fields.body);
    if (body) add("invalid_note_field", "body", `The body ${body}`);
    else if (!hasTrailerLines(fields) && bodyEndsInTrailers(fields.body)) {
      add(
        "invalid_note_field",
        "body",
        "The body's last paragraph would be read as trailers; set those fields instead, or end the body with prose",
      );
    }
  }
  for (const field of SINGLE_FIELDS) {
    const value = fields[field];
    if (value === null) continue;
    const problem = MULTILINE_FIELDS.has(field) ? multilineProblem(value) : lineProblem(value);
    if (problem) {
      add("invalid_note_field", field, `${NOTE_FIELD_KEYS[field]} ${problem}`);
      continue;
    }
    if ((field === "re" || field === "replaces") && parseNoteRef(value) === null) {
      add("invalid_ref", field, `${NOTE_FIELD_KEYS[field]} is not a known reference (${REF_FORMS})`);
    }
    if (field === "via" && !VIA.test(value)) {
      add("invalid_via", field, "Via names the channel the text came by: host:…, file:…, lobby:… or msg:…");
    }
  }
  const evidenceCount = options.cites && Array.isArray(fields.evidence) ? fields.evidence.length : null;
  fields.why.forEach((reason, index) => problems.push(...reasonProblems(reason, index, evidenceCount)));
  fields.evidence.forEach((item, index) => {
    const problem = evidenceProblem(item, index);
    if (problem) problems.push(problem);
  });
  fields.trailers.forEach((trailer, index) => {
    const problem = trailerProblem(trailer, index);
    if (problem) problems.push(problem);
  });
  if (options.requireRe && isNoteAct(fields.act) && NOTE_ACTS_NEEDING_RE.includes(fields.act) && fields.re === null) {
    add("re_required", "re", `"${fields.act}" needs re: what it answers`);
  }
  return problems;
}

function noteText(fields: NoteFields): string {
  return fields.body === null ? fields.statement : `${fields.statement}\n\n${fields.body}`;
}

function length(value: unknown): number {
  return typeof value === "string" ? value.length : 0;
}

/**
 * The caps of spec section 4 and the per-act ceiling, as too_long problems
 * (statement_too_long for the statement, with its remedy). Nothing is ever
 * shortened here: a caller refuses before any write.
 */
export function checkNoteCaps(input: NoteInput): NoteProblem[] {
  const fields = completeFields(input);
  const problems: NoteProblem[] = [];
  const over = (field: string, max: number, actual: number, unit: "chars" | "items", message: string): void => {
    if (actual > max) problems.push({ code: "too_long", field, max, actual, unit, message });
  };
  const statement = length(fields.statement);
  if (statement > NOTE_STATEMENT_MAX) {
    problems.push({
      code: "statement_too_long",
      field: "statement",
      max: NOTE_STATEMENT_MAX,
      actual: statement,
      unit: "chars",
      message: `The statement is ${statement} characters; at most ${NOTE_STATEMENT_MAX}`,
      remedy: STATEMENT_TOO_LONG_REMEDY,
    });
  }
  over("why", NOTE_WHY_MAX, fields.why.length, "items", `A note has at most ${NOTE_WHY_MAX} Why: lines`);
  fields.why.forEach((reason, index) => {
    const actual = length(reason.text);
    over(`why[${index}]`, NOTE_WHY_TEXT_MAX, actual, "chars", `Why ${index + 1} is ${actual} characters; at most ${NOTE_WHY_TEXT_MAX}`);
  });
  over("evidence", NOTE_EVIDENCE_MAX, fields.evidence.length, "items", `A note has at most ${NOTE_EVIDENCE_MAX} Evidence: lines`);
  fields.evidence.forEach((item, index) => {
    const actual = length(item);
    over(`evidence[${index}]`, NOTE_VALUE_MAX, actual, "chars", `Evidence ${index + 1} is ${actual} characters; at most ${NOTE_VALUE_MAX}`);
  });
  const fieldMax: Record<SingleField, number> = {
    to: NOTE_VALUE_MAX,
    re: NOTE_VALUE_MAX,
    via: NOTE_VALUE_MAX,
    limits: NOTE_LIMITS_MAX,
    purpose: NOTE_PURPOSE_MAX,
    extent: NOTE_EXTENT_MAX,
    replaces: NOTE_VALUE_MAX,
  };
  for (const field of SINGLE_FIELDS) {
    const actual = length(fields[field]);
    over(field, fieldMax[field], actual, "chars", `${NOTE_FIELD_KEYS[field]} is ${actual} characters; at most ${fieldMax[field]}`);
  }
  fields.trailers.forEach((trailer, index) => {
    const actual = length(trailer.value);
    over(`trailers[${index}]`, NOTE_VALUE_MAX, actual, "chars", `${String(trailer.key)} is ${actual} characters; at most ${NOTE_VALUE_MAX}`);
  });
  if (isNoteAct(fields.act) && typeof fields.statement === "string") {
    const ceiling = NOTE_ACT_CEILINGS[fields.act];
    const measured = ceiling.measure === "text"
      ? noteText(fields).length
      : assemble(fields, ceiling.measure === "note_without_evidence").length;
    const what = ceiling.measure === "text"
      ? `A ${fields.act} text (statement and body)`
      : ceiling.measure === "note_without_evidence"
      ? `A ${fields.act} note without its Evidence lines`
      : `A ${fields.act} note`;
    over(
      ceiling.measure === "text" ? "text" : "note",
      ceiling.max,
      measured,
      "chars",
      `${what} is ${measured} characters; at most ${ceiling.max}`,
    );
  }
  return problems;
}

/** Every reason renderNote would refuse these fields, shape first, then caps. */
export function checkNote(input: NoteInput): NoteProblem[] {
  const fields = completeFields(input);
  return [...shapeProblems(fields, { cites: true, requireRe: true }), ...checkNoteCaps(fields)];
}

/** The CollabError a caller throws for a problem: code and message, with
 * field, max, actual, unit and remedy as details where present. */
export function noteProblemError(problem: NoteProblem): CollabError {
  const { code, message, ...details } = problem;
  return new CollabError(code, message, details);
}

// ---------------------------------------------------------------- rendering

function assemble(fields: NoteFields, omitEvidence = false): string {
  const lines: string[] = [];
  // checkNoteCaps measures before shape problems are reported, so a value of
  // the wrong type is measured as its string form rather than crashing.
  const push = (key: string, value: unknown): void => {
    const [first, ...more] = String(value).split("\n");
    lines.push(`${key}: ${first ?? ""}`, ...more.map((line) => `  ${line}`));
  };
  const single = (field: SingleField): void => {
    const value = fields[field];
    if (typeof value === "string") push(NOTE_FIELD_KEYS[field], value);
  };
  single("to");
  single("re");
  single("via");
  for (const reason of fields.why) push(NOTE_FIELD_KEYS.why, renderReason(reason));
  if (!omitEvidence) for (const item of fields.evidence) push(NOTE_FIELD_KEYS.evidence, item);
  single("limits");
  single("purpose");
  single("extent");
  single("replaces");
  for (const trailer of fields.trailers) push(trailer.key, trailer.value);
  const parts = [`${fields.act}: ${fields.statement}`];
  if (fields.body !== null) parts.push(fields.body);
  if (lines.length > 0) parts.push(lines.join("\n"));
  return parts.join("\n\n");
}

function fieldsOf(parsed: ParsedNote): Omit<ParsedNote, "advice"> {
  const { advice: _advice, ...fields } = parsed;
  return fields;
}

// A last guard: whatever renderNote returns must read back as the fields it
// was given, so the stored body, the returned note and a later read agree.
function verifyReadsBack(text: string, fields: NoteFields): void {
  if (normalizeNoteText(text) !== text) {
    throw new CollabError("invalid_note_field", "The note would not be stored byte for byte", { field: "note" });
  }
  const back = fieldsOf(parseNote(text));
  const expected = fields as unknown as Record<string, unknown>;
  const actual = back as unknown as Record<string, unknown>;
  const differing = Object.keys(expected).find((key) => canonicalJson(expected[key]) !== canonicalJson(actual[key]));
  if (differing !== undefined) {
    throw new CollabError(
      "invalid_note_field",
      `The rendered note would read back with a different ${differing}`,
      { field: differing },
    );
  }
}

export interface RenderNoteOptions {
  /** Refuse with too_long {field: "note"} when the note is longer. */
  maxChars?: number;
  /** Leave the Evidence lines out (a done or review summary, whose evidence
   * travels as artifacts or cited events). Cites still count positions in
   * the full Evidence list. */
  omitEvidence?: boolean;
}

/**
 * Render fields as collab-note/1 text. The output is trim-stable (it equals
 * its own normal form, so the store keeps it byte for byte) and
 * parseNote(renderNote(x)) equals x. Refuses, before anything is written,
 * fields that are not in normal form (see normalizeNoteFields), that break
 * a cap or the act's ceiling, or that would read back differently.
 */
export function renderNote(input: NoteInput, options: RenderNoteOptions = {}): string {
  const fields = completeFields(input);
  const problem = checkNote(fields)[0];
  if (problem) throw noteProblemError(problem);
  const omitEvidence = options.omitEvidence === true;
  const text = assemble(fields, omitEvidence);
  if (options.maxChars !== undefined) {
    if (!Number.isInteger(options.maxChars) || options.maxChars < 1) {
      throw new CollabError("invalid_note_field", "maxChars must be a positive integer", { field: "maxChars" });
    }
    if (text.length > options.maxChars) {
      throw new CollabError(
        "too_long",
        `The note is ${text.length} characters; at most ${options.maxChars}`,
        { field: "note", max: options.maxChars, actual: text.length, unit: "chars" },
      );
    }
  }
  verifyReadsBack(text, omitEvidence ? { ...fields, evidence: [] } : fields);
  return text;
}

// ---------------------------------------------------------------- carrying

export const NOTE_CARRY_DISCLAIMER = "This authorises nothing elsewhere. A person sends it.";

// Shapes that name this machine or its owner's files. A carried note leaves
// the device, so a value carrying one is withheld and named in Not-carried.
// This is not the Lobby's egress gate, which still checks every send.
const LOCAL_DETAIL: readonly RegExp[] = [
  /ws_[0-9a-f]{24}/i, // a collab workspace id
  /\/(?:Users|home)\//i, // a home directory
  /(?<![A-Za-z])[A-Za-z]:[\\/]+Users[\\/]/i, // a Windows home directory
  /\/(?:private\/)?(?:var\/folders|tmp)\//i, // a temporary directory
  /(?<![A-Za-z0-9_])~[A-Za-z0-9._-]{0,32}\//, // a path from a home directory
  /[A-Za-z0-9]\.(?:local|lan|home\.arpa)(?![A-Za-z0-9-])/i, // a LAN host name
  // Device model words that default machine names carry ("Someones-MacBook-Pro"),
  // as the Lobby's egress gate reads them.
  /macbook|(?<![a-z])imac(?![a-z])|mac[\s._-]?(?:mini|studio|pro)(?![a-z])|iphone|ipad(?![a-z])/i,
];
// Any other absolute path names this machine's files too (/opt/…, /Volumes/…,
// D:\…). A URL with a host is set aside first, so the path in
// https://example.org/a/b travels; file:///… has no host and does not.
const URL_WITH_HOST = /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s/]+\S*/g;
// A slash that starts a token (not after a word, a dot or ~, so relative
// paths, ./x, ~/x and a/b do not match), then at least one directory.
const ABSOLUTE_POSIX_PATH = /(?<![\p{L}\p{N}_.~*-])\/+(?:[\p{L}\p{N}_.@+~-]+\/)+[\p{L}\p{N}_.@+~-]*/u;
const DRIVE_PATH = /(?<![\p{L}\p{N}_])[A-Za-z]:[\\/][^\s\\/]/u;
const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/])/;

function namesAbsolutePath(value: string): boolean {
  const rest = value.replace(URL_WITH_HOST, " ");
  return ABSOLUTE_POSIX_PATH.test(rest) || DRIVE_PATH.test(rest);
}
// Kept longest when a carried note must be shortened: what it is about and
// where the agents stand.
const KEPT_RENDER_KEYS: ReadonlySet<string> = new Set(["Sha256", "Position", "Result"]);
// The body is context, so it is cut first, but some of it is kept until the
// evidence pointers (mostly ids that resolve only on this device) and the
// routing fields have gone.
const CARRY_BODY_FLOOR = 240;

export interface CarryOptions {
  /** Default NOTE_CARRY_MAX (800). */
  maxChars?: number;
  /** This machine's own names (a host name, say), withheld wherever they
   * appear, matched without regard to case. */
  localTerms?: readonly string[];
}

export interface CarriedNote {
  /** collab-note/1 text, at most maxChars, ending in a Not-carried: line. */
  text: string;
  /** What was withheld or shortened, as the Not-carried: line lists it;
   * empty when everything was carried. */
  not_carried: string[];
}

type CarryCut =
  | { kind: "local" | "unreadable" | "dropped"; label: string }
  | { kind: "shortened"; label: string; kept: number; total: number }
  | { kind: "items"; label: "why" | "evidence"; items: number[]; reason: "local" | "unreadable" | "room" };

/** What happened to a trailer that was not carried as written. */
type TrailerFate =
  | { kind: "local" | "unreadable" | "dropped" }
  | { kind: "shortened"; kept: number; total: number };

/** A shortening step's record of a value: a prefix kept, dropped, or as written. */
type ShortenMark = { kind: "shortened"; kept: number; total: number } | { kind: "dropped" } | null;

const CUT_ORDER = [
  "statement",
  "body",
  "to",
  "re",
  "via",
  "why",
  "evidence",
  "limits",
  "purpose",
  "extent",
  "replaces",
];

function itemRanges(items: readonly number[]): string {
  const sorted = [...new Set(items)].sort((left, right) => left - right);
  const ranges: string[] = [];
  let start = sorted[0];
  let previous = start;
  for (const item of [...sorted.slice(1), Number.NaN]) {
    if (item === (previous ?? 0) + 1) {
      previous = item;
      continue;
    }
    if (start !== undefined) ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
    start = item;
    previous = item;
  }
  return ranges.join(", ");
}

function describeCut(cut: CarryCut): string {
  switch (cut.kind) {
    case "local":
      return `${cut.label} (local detail)`;
    case "unreadable":
      return `${cut.label} (unreadable)`;
    case "dropped":
      return cut.label;
    case "shortened":
      return `${cut.label} (first ${cut.kept} of ${cut.total} chars)`;
    case "items": {
      const suffix = cut.reason === "local" ? " (local detail)" : cut.reason === "unreadable" ? " (unreadable)" : "";
      return `${cut.label} ${itemRanges(cut.items)}${suffix}`;
    }
  }
}

function cutRank(cut: CarryCut): number {
  const rank = CUT_ORDER.indexOf(cut.label);
  return rank === -1 ? CUT_ORDER.length : rank;
}

// A journal note may hold hundreds of trailers, so naming each one cut could
// make the Not-carried line alone outgrow the carried note. Cuts are named
// once per group and reason instead: a render key, the X- keys together, or
// any other key. That last key is never echoed: it is unchecked input and may
// itself name a local detail.
function describeTrailerCuts(trailers: readonly NoteTrailer[], fates: ReadonlyMap<number, TrailerFate>): string[] {
  const groups = new Map<string, { group: string; key: string; fate: TrailerFate; count: number }>();
  for (const index of [...fates.keys()].sort((left, right) => left - right)) {
    const fate = fates.get(index)!;
    const key = trailers[index]!.key;
    const group = typeof key === "string" && RENDER_KEY_SET.has(key)
      ? key
      : typeof key === "string" && X_KEY.test(key) ? "X-" : "unknown";
    const id = `${group}\n${fate.kind}`;
    const entry = groups.get(id);
    if (entry === undefined) groups.set(id, { group, key: String(key), fate, count: 1 });
    else entry.count += 1;
  }
  return [...groups.values()].map(({ group, key, fate, count }) => {
    const name = count === 1
      ? group === "unknown" ? "unknown trailer" : key
      : group === "X-" ? `X- trailers ×${count}` : group === "unknown" ? `unknown trailers ×${count}` : `${group} ×${count}`;
    switch (fate.kind) {
      case "local":
        return `${name} (local detail)`;
      case "unreadable":
        return `${name} (unreadable)`;
      case "dropped":
        return name;
      case "shortened":
        return count === 1 ? `${name} (first ${fate.kept} of ${fate.total} chars)` : `${name} (shortened)`;
    }
  });
}

// The longest prefix of at most `keep` units that ends on a code point and
// carries no trailing whitespace.
function prefix(value: string, keep: number): string {
  let end = Math.max(0, Math.min(keep, value.length));
  const last = value.charCodeAt(end - 1);
  if (end > 0 && last >= 0xd800 && last <= 0xdbff) end -= 1;
  return value.slice(0, end).trimEnd();
}

function readable(value: string, check: (value: string) => string | null): boolean {
  return check(value) === null;
}

/**
 * Render a note for carrying to another device (a Lobby message, a file):
 * at most `maxChars` (800), full ids only, the line "This authorises
 * nothing elsewhere. A person sends it." as the body's last paragraph, and a
 * final `Not-carried:` line naming everything withheld or shortened
 * ("nothing" when it is all there). Values naming a local detail (a
 * workspace id, an absolute, home or temporary path, a LAN host name, a
 * localTerms entry) are withheld, never rewritten, and so are values that
 * could not be written in a note (an empty Evidence item, a NUL). Trailers
 * cut are named once per group (a render key, or the X- keys together), so
 * the Not-carried line stays short however many there were. When the note is still too long it
 * is cut in this order until it fits: X- trailers; the body down to 240
 * characters; Evidence from the end; purpose, replaces, to; the rest of the
 * body; Why from the end; render trailers other than Sha256, Position and
 * Result; via; then the terms, shortened: limits, extent, Position and
 * Result, and last the statement. Sha256 is never cut. Evidence is only cut
 * from the end, so every carried Why still cites its Evidence by its
 * original number. Throws not_carriable for a short handle or a local
 * detail in the statement.
 */
export function renderCarriedNote(input: NoteInput, options: CarryOptions = {}): CarriedNote {
  const max = options.maxChars ?? NOTE_CARRY_MAX;
  if (!Number.isInteger(max) || max < 1) {
    throw new CollabError("invalid_note_field", "maxChars must be a positive integer", { field: "maxChars" });
  }
  const terms = (options.localTerms ?? [])
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length >= 3);
  const isLocal = (value: string): boolean =>
    LOCAL_DETAIL.some((pattern) => pattern.test(value))
    || namesAbsolutePath(value)
    || terms.some((term) => value.toLowerCase().includes(term));

  const base = normalizeNoteFields(input);
  if (!isNoteAct(base.act)) throw new CollabError("invalid_note_field", `act must be one of ${NOTE_ACTS.join(", ")}`, { field: "act" });
  const statementProblem = lineProblem(base.statement);
  if (statementProblem) {
    throw new CollabError("invalid_note_field", `The statement ${statementProblem}`, { field: "statement" });
  }
  const fullIdRemedy = "Name the full id (such as report_…) instead of the handle.";
  const notCarriable = (field: string, message: string, remedy: string): CollabError =>
    new CollabError("not_carriable", message, { field, remedy });
  for (const field of ["re", "replaces"] as const) {
    const value = base[field];
    if (value !== null && parseNoteRef(value)?.handle) {
      throw notCarriable(
        field,
        `${NOTE_FIELD_KEYS[field]} is a short handle; a carried note names full ids, because a handle can match a different item on another device`,
        fullIdRemedy,
      );
    }
  }
  base.evidence.forEach((item, index) => {
    try {
      const evidence = parseEvidence(item);
      if (HANDLE_EVIDENCE.test(evidence.locator) || HANDLE.test(evidence.locator)) {
        throw notCarriable(`evidence[${index}]`, `Evidence ${index + 1} is a short handle; a carried note names full ids`, fullIdRemedy);
      }
    } catch (error) {
      if (!(error instanceof CollabError) || error.code === "not_carriable") throw error;
    }
  });
  if (isLocal(base.statement)) {
    throw notCarriable(
      "statement",
      "The statement names a local detail (a workspace id, an absolute or home path, or a machine name), so it cannot leave this device",
      "Restate the statement without it. A body, reason or term that names it is withheld and listed in Not-carried.",
    );
  }

  const cuts: CarryCut[] = [];
  const state: NoteFields = { ...base, why: [], evidence: [], trailers: [] };

  // Withhold what names this device or cannot be read, before measuring.
  if (state.body !== null) {
    const unreadable = !readable(state.body, bodyProblem);
    if (unreadable || isLocal(state.body)) {
      state.body = null;
      cuts.push({ kind: unreadable ? "unreadable" : "local", label: "body" });
    }
  }
  for (const field of SINGLE_FIELDS) {
    const value = state[field];
    if (value === null) continue;
    const check = MULTILINE_FIELDS.has(field) ? multilineProblem : lineProblem;
    const unreadable = !readable(value, check)
      || ((field === "re" || field === "replaces") && parseNoteRef(value) === null)
      || (field === "via" && !VIA.test(value));
    if (unreadable || isLocal(value)) {
      state[field] = null;
      cuts.push({ kind: unreadable ? "unreadable" : "local", label: field });
    }
  }
  const localWhy: number[] = [];
  const unreadableWhy: number[] = [];
  base.why.forEach((reason, index) => {
    if (reasonProblems(reason, index, null).length > 0) unreadableWhy.push(index + 1);
    else if (isLocal(reason.text)) localWhy.push(index + 1);
    else state.why.push(reason);
  });
  if (localWhy.length > 0) cuts.push({ kind: "items", label: "why", items: localWhy, reason: "local" });
  if (unreadableWhy.length > 0) cuts.push({ kind: "items", label: "why", items: unreadableWhy, reason: "unreadable" });
  for (const [index, item] of base.evidence.entries()) {
    const problem = evidenceProblem(item, index);
    const evidence = problem === null ? parseEvidence(item) : null;
    const local = evidence !== null
      && (isLocal(item) || (evidence.kind === "file" && ABSOLUTE_PATH.test(evidence.locator)));
    if (problem !== null || local) {
      const rest = base.evidence.map((_, position) => position + 1).slice(index);
      cuts.push({ kind: "items", label: "evidence", items: rest, reason: problem !== null ? "unreadable" : "local" });
      break;
    }
    state.evidence.push(item);
  }
  // Keyed by position in base.trailers; trailerOrigin gives that position for
  // each trailer in state.trailers, so a cut is recorded against the right one.
  const trailerFates = new Map<number, TrailerFate>();
  const trailerOrigin: number[] = [];
  base.trailers.forEach((trailer, index) => {
    if (trailer.key === "Not-carried") return; // a carried note names its own cuts
    const problem = trailerProblem(trailer, index);
    if (problem !== null || isLocal(trailer.value)) {
      trailerFates.set(index, { kind: problem !== null ? "unreadable" : "local" });
    } else {
      state.trailers.push(trailer);
      trailerOrigin.push(index);
    }
  });

  // Counts past the caps cannot be carried in a valid note.
  const droppedWhy: number[] = [];
  const droppedEvidence: number[] = [];
  const whyPositions = base.why.map((_, index) => index + 1)
    .filter((position) => !localWhy.includes(position) && !unreadableWhy.includes(position));
  const dropWhy = (): boolean => {
    if (state.why.length === 0) return false;
    state.why.pop();
    droppedWhy.push(whyPositions[state.why.length]!);
    return true;
  };
  const dropEvidence = (): boolean => {
    if (state.evidence.length === 0) return false;
    state.evidence.pop();
    droppedEvidence.push(state.evidence.length + 1);
    return true;
  };
  while (state.why.length > NOTE_WHY_MAX) dropWhy();
  while (state.evidence.length > NOTE_EVIDENCE_MAX) dropEvidence();

  const originalBody = state.body;
  const originalStatement = state.statement;

  const notCarried = (): string[] => {
    const all: CarryCut[] = [...cuts];
    if (droppedWhy.length > 0) all.push({ kind: "items", label: "why", items: droppedWhy, reason: "room" });
    if (droppedEvidence.length > 0) {
      all.push({ kind: "items", label: "evidence", items: droppedEvidence, reason: "room" });
    }
    return [
      ...all
        .map((cut, index) => ({ cut, index }))
        .sort((left, right) => cutRank(left.cut) - cutRank(right.cut) || left.index - right.index)
        .map(({ cut }) => describeCut(cut)),
      ...describeTrailerCuts(base.trailers, trailerFates),
    ];
  };
  const carried = (): NoteFields => ({
    ...state,
    body: state.body === null ? NOTE_CARRY_DISCLAIMER : `${state.body}\n\n${NOTE_CARRY_DISCLAIMER}`,
    trailers: [...state.trailers, { key: "Not-carried", value: notCarried().join("; ") || "nothing" }],
  });
  const overBy = (): number => assemble(carried()).length - max;

  // A field keeps one shortened-or-dropped record, replaced as prefixes are
  // tried: the record's own digits count toward the length being fitted.
  const markField = (label: string) => (mark: ShortenMark): void => {
    const existing = cuts.findIndex((cut) => cut.label === label && (cut.kind === "shortened" || cut.kind === "dropped"));
    const record: CarryCut | null = mark === null
      ? null
      : mark.kind === "shortened" ? { kind: "shortened", label, kept: mark.kept, total: mark.total } : { kind: "dropped", label };
    if (existing === -1) {
      if (record !== null) cuts.push(record);
    } else if (record !== null) {
      cuts[existing] = record;
    } else {
      cuts.splice(existing, 1);
    }
  };
  const markTrailer = (origin: number) => (mark: ShortenMark): void => {
    if (mark === null) trailerFates.delete(origin);
    else trailerFates.set(origin, mark);
  };
  // Keep the longest prefix of a value (at least `floor` characters) with
  // which the note fits. When even the floor does not fit, the value stays
  // at the floor for a later step to take further; with no floor it is
  // dropped, unless it must stay. A longer prefix never makes the note
  // shorter, so a binary search finds the longest that fits.
  const shorten = (
    original: string,
    apply: (value: string | null) => void,
    mark: (mark: ShortenMark) => void,
    floor = 0,
    mayDrop = true,
  ): void => {
    const attempt = (keep: number): boolean => {
      const kept = prefix(original, keep);
      if (kept === "") return false;
      apply(`${kept}…`);
      mark({ kind: "shortened", kept: kept.length, total: original.length });
      return overBy() <= 0;
    };
    let low = Math.max(1, floor);
    let high = original.length - 1;
    if (high < low) return;
    if (!attempt(low)) {
      if (floor > 0 || !mayDrop) return;
      apply(null);
      mark({ kind: "dropped" });
      return;
    }
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (attempt(middle)) low = middle;
      else high = middle - 1;
    }
    attempt(low);
  };
  const dropField = (field: SingleField): void => {
    if (state[field] === null) return;
    state[field] = null;
    cuts.push({ kind: "dropped", label: field });
  };
  const dropLastTrailer = (wanted: (key: string) => boolean): boolean => {
    for (let at = state.trailers.length - 1; at >= 0; at -= 1) {
      if (!wanted(state.trailers[at]!.key)) continue;
      state.trailers.splice(at, 1);
      trailerFates.set(trailerOrigin.splice(at, 1)[0]!, { kind: "dropped" });
      return true;
    }
    return false;
  };
  const shortenField = (field: SingleField): void => {
    const value = state[field];
    if (value === null) return;
    shorten(value, (next) => {
      state[field] = next;
    }, markField(field));
  };
  const shortenKeptTrailers = (): void => {
    for (let at = state.trailers.length - 1; at >= 0 && overBy() > 0; at -= 1) {
      const trailer = state.trailers[at]!;
      if (trailer.key === "Sha256" || !KEPT_RENDER_KEYS.has(trailer.key)) continue;
      shorten(trailer.value, (next) => {
        if (next === null) {
          state.trailers.splice(at, 1);
          trailerOrigin.splice(at, 1);
        } else {
          state.trailers[at] = { key: trailer.key, value: next };
        }
      }, markTrailer(trailerOrigin[at]!));
    }
  };

  if (state.statement.length > NOTE_STATEMENT_MAX) {
    const kept = prefix(originalStatement, NOTE_STATEMENT_MAX - 1);
    state.statement = `${kept}…`;
    markField("statement")({ kind: "shortened", kept: kept.length, total: originalStatement.length });
  }

  const shortenBody = (floor: number) => (): void => {
    if (originalBody === null || state.body === null) return;
    shorten(originalBody, (next) => {
      state.body = next;
    }, markField("body"), floor);
  };
  const steps: Array<() => void> = [
    () => {
      while (overBy() > 0 && dropLastTrailer((key) => X_KEY.test(key)));
    },
    shortenBody(CARRY_BODY_FLOOR),
    () => {
      while (overBy() > 0 && dropEvidence());
    },
    () => dropField("purpose"),
    () => dropField("replaces"),
    () => dropField("to"),
    shortenBody(0),
    () => {
      while (overBy() > 0 && dropWhy());
    },
    () => {
      while (overBy() > 0 && dropLastTrailer((key) => !KEPT_RENDER_KEYS.has(key)));
    },
    () => dropField("via"),
    () => shortenField("limits"),
    () => shortenField("extent"),
    shortenKeptTrailers,
    () => {
      shorten(originalStatement, (next) => {
        if (next !== null) state.statement = next;
      }, markField("statement"), 0, false);
    },
  ];
  for (const step of steps) {
    if (overBy() <= 0) break;
    step();
  }
  const fields = carried();
  const text = assemble(fields);
  if (text.length > max) {
    throw new CollabError(
      "too_long",
      `The carried note cannot be made to fit ${max} characters`,
      {
        field: "note",
        max,
        actual: text.length,
        unit: "chars",
        remedy: "Shorten the Re: reference or carry fewer Sha256 lines: those are never cut, and the disclaimer and Not-carried line always travel.",
      },
    );
  }
  const problem = shapeProblems(fields, { cites: false, requireRe: false })[0];
  if (problem) throw noteProblemError(problem);
  verifyReadsBack(text, fields);
  return { text, not_carried: notCarried() };
}
