#!/usr/bin/env bun
// @bun

// src/host.ts
import { existsSync as existsSync6 } from "fs";
import { parseArgs as parseArgs2 } from "util";

// src/database-path.ts
import { homedir } from "os";
import { isAbsolute, join, resolve } from "path";
function defaultDatabasePath(env = process.env) {
  const dataHome = env.XDG_DATA_HOME;
  const base = dataHome ? isAbsolute(dataHome) ? dataHome : resolve(dataHome) : join(homedir(), ".local", "share");
  return join(base, "agenttool", "collab.sqlite");
}
function resolveDatabasePath(env = process.env) {
  return env.AGENTOOL_COLLAB_DB ?? defaultDatabasePath(env);
}

// src/errors.ts
class CollabError extends Error {
  code;
  details;
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = "CollabError";
  }
}

// src/protocol.ts
var COLLAB_PROTOCOL = "agenttool.collab/0.1";
var LEGACY_COLLAB_PROTOCOL = COLLAB_PROTOCOL;
var COLLAB_COORDINATION_PROTOCOL = "agenttool.collab/0.2";
var COLLAB_SESSION_PROTOCOL = "agenttool.collab.session/0.1";
var SESSION_STALE_AFTER_MS = 6 * 60 * 60 * 1000;
var EVIDENCE_REF_PREFIXES = ["artifact:", "event:", "report:", "checkpoint:"];
var EVIDENCE_REFS_DESCRIPTION = "Evidence references point inside this workspace's journal and start with artifact:, event:, " + "report:, or checkpoint: (a task's base_checkpoint_digest or result_checkpoint_digest), " + 'for example "artifact:artifact_<id>".';
var CONSENT_RULE = "consent/v1";
var CONSENT_RULE_V2 = "consent/v2";
var CONSENT_RULES = [CONSENT_RULE, CONSENT_RULE_V2];
var PROPOSAL_BYTES_PROTOCOL = "agenttool.collab-proposal/1";
var DEFAULT_PROPOSAL_CONSULT_SECONDS = 6 * 60 * 60;
var MIN_PROPOSAL_CONSULT_SECONDS = 10 * 60;
var MAX_PROPOSAL_CONSULT_SECONDS = 7 * 24 * 60 * 60;
var PERSON_ACT_PROTOCOL = "agenttool.collab-person-act/1";
var PERSON_SET_ASIDE_PROTOCOL = "agenttool.collab-person-set-aside/1";
var DEFAULT_WAIT_EVENT_LIMIT = 10;
var MAX_WAIT_EVENT_LIMIT = 50;
var MAX_WAIT_PAGE_BYTES = 256 * 1024;
var MAX_WAIT_RESPONSE_BYTES = 1024 * 1024;
var MAX_WAIT_ANCHOR_BYTES = 8 * 1024 * 1024;

// src/seat-ref.ts
var MAX_SEAT_REF = 200;
var SEAT_REF = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]*$/;
function validateSeatRef(value) {
  if (value.length === 0 || value.length > MAX_SEAT_REF || !SEAT_REF.test(value)) {
    throw new CollabError("invalid_seat_ref", `seat_ref is 1 to ${MAX_SEAT_REF} characters: letters, digits and . _ : @ / + -, starting with a letter or digit`);
  }
  return value;
}

// src/session-file.ts
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "fs";
import { dirname, resolve as resolve2 } from "path";
function readSessionCredentialFile(pathInput) {
  const path = resolve2(pathInput);
  try {
    assertPrivateDirectory(dirname(path));
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || !isOwnedByCurrentUser(stat.uid)) {
      throw new CollabError("session_file_unsafe", "Session credential path must be a private regular file owned by this user", { operation: "read_session_credential_file" });
    }
    if ((stat.mode & 63) !== 0) {
      throw new CollabError("session_file_not_private", "Session credential file must not be accessible by group or other users", { operation: "read_session_credential_file" });
    }
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed.format !== "agenttool.collab/session-file/1" || typeof parsed.session_id !== "string" || typeof parsed.session_token !== "string" || !Number.isInteger(parsed.generation) || parsed.generation < 1 || parsed.last_cursor !== undefined && (typeof parsed.last_cursor?.epoch_id !== "string" || !Number.isInteger(parsed.last_cursor?.sequence) || parsed.last_cursor.sequence < 0 || typeof parsed.last_cursor?.hash !== "string" || !/^[a-f0-9]{64}$/.test(parsed.last_cursor.hash))) {
      throw new CollabError("session_file_invalid", "Session credential file has an unsupported or malformed format", { operation: "read_session_credential_file" });
    }
    return {
      session_id: parsed.session_id,
      session_token: parsed.session_token,
      generation: parsed.generation,
      last_cursor: parsed.last_cursor
    };
  } catch (error) {
    if (error instanceof CollabError)
      throw error;
    throw new CollabError("session_file_read_failed", "Could not read the local session credential file", { operation: "read_session_credential_file" });
  }
}
function removeSessionCredentialFile(pathInput) {
  const path = resolve2(pathInput);
  try {
    if (!existsSync(path))
      return;
    assertPrivateDirectory(dirname(path));
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || !isOwnedByCurrentUser(stat.uid)) {
      throw new CollabError("session_file_unsafe", "Refusing to remove a non-regular session credential path", { operation: "remove_session_credential_file" });
    }
    unlinkSync(path);
  } catch (error) {
    if (error instanceof CollabError)
      throw error;
    throw new CollabError("session_file_remove_failed", "The session ended, but its revoked local credential file could not be removed", { operation: "remove_session_credential_file" });
  }
}
function assertPrivateDirectory(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !isOwnedByCurrentUser(stat.uid) || (stat.mode & 63) !== 0) {
    throw new CollabError("session_directory_not_private", "Session credential directory must be a private non-symlink directory owned by this user", { operation: "validate_session_credential_directory" });
  }
}
function isOwnedByCurrentUser(uid) {
  return typeof process.getuid !== "function" || uid === process.getuid();
}

// src/store-notes.ts
import { randomUUID as randomUUID2 } from "crypto";
import { realpathSync as realpathSync2 } from "fs";

// src/ballot.ts
import { createHash } from "crypto";

// src/canonical.ts
function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}
function sortValue(value) {
  if (Array.isArray(value))
    return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, child]) => [key, sortValue(child)]);
    return Object.fromEntries(entries);
  }
  return value;
}

// src/note.ts
var NOTE_FORMAT = "collab-note/1";
var NOTE_ACTS = [
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
  "vote"
];
var NOTE_ACTS_NEEDING_RE = [
  "support",
  "challenge",
  "resolve",
  "withdraw",
  "accept",
  "request_changes",
  "relay_rejection"
];
var ACT_SET = new Set(NOTE_ACTS);
function isNoteAct(value) {
  return typeof value === "string" && ACT_SET.has(value);
}
var NOTE_BASES = ["seen", "told", "inferred", "quoted"];
var BASIS_SET = new Set(NOTE_BASES);
var NOTE_UNMARKED = "unmarked";
var NOTE_FIELD_KEYS = {
  to: "To",
  re: "Re",
  via: "Via",
  why: "Why",
  evidence: "Evidence",
  limits: "Limits",
  purpose: "Purpose",
  extent: "Extent",
  replaces: "Replaces"
};
var MULTILINE_FIELDS = new Set(["limits", "extent"]);
var NOTE_RENDER_KEYS = [
  "Sha256",
  "Position",
  "Result",
  "Criteria",
  "Option",
  "Pick",
  "Quorum",
  "Closes",
  "Not-carried"
];
var FIELD_BY_KEY = new Map(Object.entries(NOTE_FIELD_KEYS).map(([field, key]) => [key.toLowerCase(), field]));
var RENDER_KEY_BY_LOWER = new Map(NOTE_RENDER_KEYS.map((key) => [key.toLowerCase(), key]));
var RENDER_KEY_SET = new Set(NOTE_RENDER_KEYS);
var X_KEY = /^X-[A-Za-z0-9-]{1,30}$/i;
var LISTED_KEYS = [...Object.values(NOTE_FIELD_KEYS), ...NOTE_RENDER_KEYS].join(", ");
var NOTE_JOURNAL_MAX = 8000;
var NOTE_REVIEW_MAX = 4000;
var NOTE_RELAY_TEXT_MAX = 2000;
var JOURNAL_CEILING = Object.freeze({ max: NOTE_JOURNAL_MAX, measure: "note" });
var REVIEW_CEILING = Object.freeze({ max: NOTE_REVIEW_MAX, measure: "note_without_evidence" });
var RELAY_CEILING = Object.freeze({ max: NOTE_RELAY_TEXT_MAX, measure: "text" });
var NOTE_ACT_CEILINGS = Object.freeze({
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
  vote: JOURNAL_CEILING
});
var STRIPPED = /[\uFEFF\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\u{E0000}-\u{E007F}]/gu;
function cleanLines(text) {
  return text.replace(STRIPPED, "").replace(/\r\n?/g, `
`).split(`
`).map((line) => line.replace(/[ \t]+$/, ""));
}
function normalizeNoteText(text) {
  return cleanLines(text).join(`
`).trim();
}
function trimBlankEdges(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === "")
    start += 1;
  while (end > start && lines[end - 1] === "")
    end -= 1;
  return lines.slice(start, end);
}
var NOTE_JOURNAL_EVIDENCE_KINDS = ["report", "event", "artifact", "checkpoint"];
var NOTE_EVIDENCE_ATTRS = ["sha256", "exit", "out", "lines", "runs", "at"];
var NOTE_EVIDENCE_FORMS = [
  "file <repo path>[:a-b]",
  "commit <sha>",
  "test <command> exit=<n>",
  "url <url>",
  "data <label> sha256=<hex>",
  "msg <channel> <id>",
  "report:<id>",
  "event:<id>",
  "artifact:<id>",
  "checkpoint:<id>"
];
var ATTR_SET = new Set(NOTE_EVIDENCE_ATTRS);
var JOURNAL_EVIDENCE_SET = new Set(NOTE_JOURNAL_EVIDENCE_KINDS);
var ID_TOKEN = String.raw`[A-Za-z0-9][A-Za-z0-9._:#-]*`;
var JOURNAL_EVIDENCE = new RegExp(String.raw`^(report|event|artifact|checkpoint):(${ID_TOKEN})$`, "i");
var HANDLE_EVIDENCE = /^(?:report|proposal|ballot)#[0-9a-f]{6,32}$/i;
var WORD_EVIDENCE = /^(file|commit|test|url|data|msg)[ \t]+(\S[^\n]*)$/i;
var TRAILING_ATTR = /[ \t]+([A-Za-z0-9]+)=(\S+)$/;
var ATTR_VALUE = {
  sha256: /^[0-9a-f]{64}$/i,
  exit: /^-?\d{1,10}$/,
  out: /^sha256:[0-9a-f]{64}$/i,
  lines: /^\d{1,9}(?:-\d{1,9})?$/,
  runs: /^\d{1,9}$/,
  at: /^\S+$/
};
var FILE_RANGE = /:(\d+)(?:-(\d+))?$/;
function evidenceError(message, value) {
  return new CollabError("invalid_evidence", `${message}. Evidence forms: ${NOTE_EVIDENCE_FORMS.join(" | ")}`, value === undefined ? { forms: [...NOTE_EVIDENCE_FORMS] } : { forms: [...NOTE_EVIDENCE_FORMS], evidence: value });
}
function parseEvidence(value) {
  if (typeof value !== "string")
    throw evidenceError("Evidence must be a string");
  if (value.includes(`
`) || value.includes("\r"))
    throw evidenceError("Evidence is one line", value);
  const text = value.trim();
  if (text === "")
    throw evidenceError("Evidence is empty");
  const journal = JOURNAL_EVIDENCE.exec(text);
  if (journal) {
    return { kind: journal[1].toLowerCase(), locator: journal[2], attrs: {} };
  }
  if (HANDLE_EVIDENCE.test(text))
    return { kind: "report", locator: text, attrs: {} };
  const word = WORD_EVIDENCE.exec(text);
  if (!word) {
    if (/^task[:#_]/i.test(text)) {
      throw evidenceError("A task is not evidence; cite its completion report (report:<id>)", value);
    }
    throw evidenceError("Evidence does not start with a known kind", value);
  }
  const kind = word[1].toLowerCase();
  let locator = word[2];
  const attrs = {};
  for (;; ) {
    const match = TRAILING_ATTR.exec(locator);
    if (!match)
      break;
    const key = match[1].toLowerCase();
    if (!ATTR_SET.has(key) || key in attrs)
      break;
    const attr = key;
    if (!ATTR_VALUE[attr].test(match[2]))
      throw evidenceError(`${attr}= has an unreadable value`, value);
    attrs[attr] = match[2];
    locator = locator.slice(0, match.index);
  }
  if (kind === "commit" && !/^[0-9a-f]{7,64}$/i.test(locator)) {
    throw evidenceError("A commit is cited by its hex sha (7 to 64 hex digits)", value);
  }
  if (kind === "url" && !/^[A-Za-z][A-Za-z0-9+.-]*:\S+$/.test(locator)) {
    throw evidenceError("A url is one word with a scheme, such as https://\u2026", value);
  }
  if (kind === "msg" && !/^\S+[ \t]+\S/.test(locator)) {
    throw evidenceError("A msg cite names its channel and the message id", value);
  }
  if (kind === "file") {
    const range = FILE_RANGE.exec(locator);
    if (range) {
      const from = Number(range[1]);
      const to = range[2] === undefined ? from : Number(range[2]);
      if (from < 1 || to < from)
        throw evidenceError("A file line range is 1-based and runs forwards", value);
      if (range.index === 0)
        throw evidenceError("A file cite needs a path before its line range", value);
    }
  }
  return { kind, locator, attrs };
}
var HANDLE = /^(report|proposal|ballot|task)#[0-9a-f]{6,32}$/i;
var PREFIXED_REF = new RegExp(String.raw`^(report|proposal|ballot|task|event):(${ID_TOKEN})$`, "i");
var BARE_REF = /^(report|task)_[A-Za-z0-9][A-Za-z0-9._:-]*$/;
var TEXT_REF = /^(?:(file|msg):(\S[^\n]*)|(lobby):(\S+))$/i;
var VIA = /^(?:host|file|lobby|msg):\S/i;
function parseNoteRef(value) {
  const handle = HANDLE.exec(value);
  if (handle)
    return { kind: handle[1].toLowerCase(), id: value, handle: true };
  const prefixed = PREFIXED_REF.exec(value);
  if (prefixed) {
    return { kind: prefixed[1].toLowerCase(), id: prefixed[2], handle: HANDLE.test(prefixed[2]) };
  }
  const bare = BARE_REF.exec(value);
  if (bare)
    return { kind: bare[1], id: value, handle: false };
  const text = TEXT_REF.exec(value);
  if (text) {
    return { kind: (text[1] ?? text[3]).toLowerCase(), id: text[2] ?? text[4], handle: false };
  }
  return null;
}
var REF_FORMS = "report:<id>, proposal:<id>, ballot:<id>, task:<id>, event:<id>, a handle such as report#3fa91c, file:<path>[#n], lobby:<room>#<n> or msg:<text>";
var SUBJECT = /^([A-Za-z_]+):(?: ([^\n]*))?$/;
var TRAILER_LINE = /^([A-Za-z][A-Za-z0-9-]{0,63}):(?: ([^\n]*))?$/;
var CONTINUATION = /^[ \t]+\S/;
var KEYISH = /^([A-Za-z][A-Za-z0-9-]{0,63}):(\S?)/;
var BASIS_MARK = /^([\s\S]*?)\s*\(\s*(seen|told|inferred|quoted|unmarked)\b([^()]*)\)$/i;
function readBasisMark(value) {
  const match = BASIS_MARK.exec(value);
  if (!match)
    return { text: value, basis: null, cites: [], mark: "none" };
  const inner = match[3].trim();
  const tokens = inner === "" ? [] : inner.split(/\s*,\s*|\s+/);
  if (tokens.some((token) => !/^\d{1,6}$/.test(token))) {
    return { text: value, basis: null, cites: [], mark: "unreadable" };
  }
  const word = match[2].toLowerCase();
  return {
    text: match[1].trim(),
    basis: word === NOTE_UNMARKED ? null : word,
    cites: tokens.map(Number),
    mark: "read"
  };
}
function isTrailerBlock(lines) {
  if (lines.length === 0 || !TRAILER_LINE.test(lines[0]))
    return false;
  return lines.every((line) => TRAILER_LINE.test(line) || CONTINUATION.test(line));
}
function blockEntries(lines, firstLine) {
  const entries = [];
  lines.forEach((line, index) => {
    const trailer = TRAILER_LINE.exec(line);
    if (trailer) {
      entries.push({ key: trailer[1], line: firstLine + index, values: [(trailer[2] ?? "").trim()], raw: [line] });
    } else {
      const entry = entries[entries.length - 1];
      entry.values.push(line.trim());
      entry.raw.push(line);
    }
  });
  return entries;
}
function readBlock(lines, firstLine, advice) {
  const reading = {
    single: { to: null, re: null, via: null, limits: null, purpose: null, extent: null, replaces: null },
    why: [],
    evidence: [],
    trailers: [],
    kept: []
  };
  for (const entry of blockEntries(lines, firstLine)) {
    const lower = entry.key.toLowerCase();
    const field = FIELD_BY_KEY.get(lower);
    const renderKey = RENDER_KEY_BY_LOWER.get(lower);
    if (field === undefined && renderKey === undefined && !X_KEY.test(entry.key)) {
      reading.kept.push(...entry.raw);
      advice.push(`Line ${entry.line}: "${entry.key}:" is not a collab-note/1 key, so the line stays in the body. ` + `Trailer keys are ${LISTED_KEYS}, or an X- key.`);
      continue;
    }
    const multiline = field === undefined ? renderKey !== "Sha256" : MULTILINE_FIELDS.has(field);
    const value = entry.values.filter((part) => part !== "").join(multiline ? `
` : " ");
    if (value === "" && field === "evidence") {
      reading.evidence.push({ text: "", line: entry.line });
      advice.push(`Line ${entry.line}: Evidence ${reading.evidence.length} is empty. It keeps its place so later cites keep ` + "their numbers; remove it and renumber the cites after it.");
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
        advice.push(`Line ${entry.line}: the reason ends in a parenthesis that is not a basis mark, so it was read as text; ` + `write (seen), (told), (inferred) or (quoted), with any cite numbers, such as (seen 1,2).`);
      } else if (mark.mark === "read" && mark.text === "") {
        advice.push(`Line ${entry.line}: this Why: has a basis but no reason before it.`);
      }
      reading.why.push({ reason: { text: mark.text, basis: mark.basis, cites: mark.cites }, line: entry.line });
    } else if (field === "evidence") {
      reading.evidence.push({ text: value, line: entry.line });
    } else if (field !== undefined) {
      if (reading.single[field] !== null) {
        reading.kept.push(...entry.raw);
        advice.push(`Line ${entry.line}: a second "${NOTE_FIELD_KEYS[field]}:" stays in the body; only the first one counts.`);
        continue;
      }
      reading.single[field] = value;
    } else {
      reading.trailers.push({ key: renderKey ?? entry.key, value });
    }
  }
  return reading;
}
function adviseBodyTrailers(lines, firstLine, advice) {
  lines.forEach((line, index) => {
    const match = KEYISH.exec(line);
    if (!match)
      return;
    const field = FIELD_BY_KEY.get(match[1].toLowerCase());
    if (field === undefined)
      return;
    const key = NOTE_FIELD_KEYS[field];
    advice.push(match[2] !== "" ? `Line ${firstLine + index} looks like a ${key}: trailer but has no space after the colon, so it is body text.` : `Line ${firstLine + index} looks like a ${key}: trailer but is in the body; trailers are read only from ` + `the last paragraph, with no blank line between them.`);
  });
}
function parseNote(text) {
  const lines = normalizeNoteText(text).split(`
`);
  const advice = [];
  const subject = lines[0] ?? "";
  let act = null;
  let statement = subject;
  const head = SUBJECT.exec(subject);
  const word = head?.[1]?.toLowerCase();
  if (head && isNoteAct(word)) {
    act = word;
    statement = (head[2] ?? "").trim();
    if (statement === "")
      advice.push(`Line 1: "${head[1]}:" has no statement after it.`);
  } else {
    advice.push(`Line 1 does not begin with a known act and ": " (${NOTE_ACTS.join(", ")}), so no act was read; ` + `the whole line is the statement.`);
  }
  const rest = lines.slice(1);
  const finalStart = rest.lastIndexOf("") + 1;
  const finalParagraph = rest.slice(finalStart);
  const hasBlock = isTrailerBlock(finalParagraph);
  const beforeBlock = hasBlock ? rest.slice(0, finalStart) : rest;
  adviseBodyTrailers(beforeBlock, 2, advice);
  const block = hasBlock ? readBlock(finalParagraph, finalStart + 2, advice) : readBlock([], 0, advice);
  const unused = hasBlock && block.kept.length === finalParagraph.length;
  const bodyLines = unused ? rest : beforeBlock;
  if (unused)
    block.kept = [];
  const ownBody = trimBlankEdges(bodyLines).join(`
`).trimEnd();
  const kept = block.kept.join(`
`);
  const joined = ownBody === "" ? kept : kept === "" ? ownBody : `${ownBody}

${kept}`;
  const body = joined === "" ? null : joined;
  const evidence = block.evidence.map((item) => item.text);
  block.evidence.forEach((item, index) => {
    if (item.text === "")
      return;
    try {
      parseEvidence(item.text);
    } catch (error) {
      if (!(error instanceof CollabError))
        throw error;
      advice.push(`Line ${item.line}: Evidence ${index + 1} is not a known evidence form (${NOTE_EVIDENCE_FORMS.join(" | ")}).`);
    }
  });
  for (const { reason, line } of block.why) {
    for (const cite of reason.cites) {
      if (cite < 1)
        advice.push(`Line ${line}: cite ${cite} is not an Evidence position; cites count from 1.`);
      else if (cite > evidence.length) {
        advice.push(`Line ${line}: cites Evidence ${cite}, but the note has ${evidence.length} Evidence line(s).`);
      }
    }
  }
  for (const field of ["re", "replaces"]) {
    const value = block.single[field];
    if (value !== null && parseNoteRef(value) === null) {
      advice.push(`"${NOTE_FIELD_KEYS[field]}: ${value}" is not a known reference (${REF_FORMS}).`);
    }
  }
  if (block.single.via !== null && !VIA.test(block.single.via)) {
    advice.push(`"Via: ${block.single.via}" is not a known channel (host:\u2026, file:\u2026, lobby:\u2026 or msg:\u2026).`);
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
    advice
  };
}
var LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
function hasLoneSurrogate(text) {
  return LONE_SURROGATE.test(text);
}
var KEPT_RENDER_KEYS = new Set(["Sha256", "Position", "Result"]);

// src/ballot.ts
var BALLOT_COMMITMENT_PROTOCOL = "agenttool.collab-ballot/1";
var BALLOT_METHOD = "approval/1";
var MIN_BALLOT_OPTIONS = 2;
var MAX_BALLOT_OPTIONS = 9;
var MAX_BALLOT_OPTION_KEY = 32;
var MAX_BALLOT_OPTION_LABEL = 120;
var MAX_BALLOT_QUESTION = 500;
var MAX_BALLOT_CRITERIA = 2000;
var MIN_BALLOT_CLOSE_SECONDS = 60;
var MAX_BALLOT_CLOSE_SECONDS = 7 * 24 * 60 * 60;
var MIN_ELECTORATE_UNITS = 2;
var MAX_ELECTORATE_UNITS = 16;
var MIN_BALLOT_QUORUM = 2;
var DEFAULT_BALLOT_QUORUM = 2;
var MAX_REVEALED_ENTRY_BYTES = 8 * 1024;
var MAX_CASTS_PER_SESSION = 3;
var BALLOT_SEALING = "Sealed means no collab tool, event or doorbell shows a vote before the close. It does not hide a vote from a process running as the same user that reads the seal files, from the voter's own host transcript, or from agents who message each other outside collab. Turnout, timing and the size of each seal file are visible. Any process that can read a session's credential file can cast for that session's unit. Notes on an open ballot are folded by collab_inbox only; legacy tools and older builds show them.";
var BALLOT_AUTHORISES = "Nothing. A top choice is the agents' recorded preference: not a decision and not agreement. It adds nothing to what you were already allowed to do. A direction-level choice goes to collab_propose, where every voice may still object and the person decides.";
var BALLOT_SPLIT_NOTE = "A split among agents is not agreement.";
var BALLOT_SAME_FAMILY_NOTE = "all counted units declare the same model family: shared support is not independent confirmation";
var BALLOT_TIE_NEXT = {
  say: "the opener may poll again on the tied options or put one to collab_propose"
};
var BALLOT_BASES = NOTE_BASES;
function ballotUnitId(voiceIds) {
  return `unit_${sha256(canonicalJson(sortedUnique(voiceIds))).slice(0, 32)}`;
}
function electorateSha256(units) {
  return sha256(canonicalJson(units));
}
function buildElectorate(sessions) {
  const byId = new Map;
  for (const session of sessions) {
    if (!nonEmptyString(session.session_id) || !nonEmptyString(session.voice_id) || typeof session.name !== "string") {
      throw new CollabError("invalid_electorate", "every electorate session needs a session_id, a voice_id and a name");
    }
    const seatRef = nonEmptyString(session.seat_ref) ? session.seat_ref : null;
    const prior = byId.get(session.session_id);
    if (prior) {
      if (prior.voice_id !== session.voice_id || prior.seat_ref !== seatRef) {
        throw new CollabError("invalid_electorate", `session ${session.session_id} is listed twice with different lineage or seat`);
      }
      continue;
    }
    byId.set(session.session_id, { ...session, seat_ref: seatRef });
  }
  const parent = new Map;
  const find = (voice) => {
    let root = voice;
    while (parent.get(root) !== root)
      root = parent.get(root);
    let next = voice;
    while (next !== root) {
      const up = parent.get(next);
      parent.set(next, root);
      next = up;
    }
    return root;
  };
  const union = (left, right) => {
    const a = find(left);
    const b = find(right);
    if (a === b)
      return;
    if (a < b)
      parent.set(b, a);
    else
      parent.set(a, b);
  };
  const firstVoiceBySeat = new Map;
  for (const session of byId.values()) {
    if (!parent.has(session.voice_id))
      parent.set(session.voice_id, session.voice_id);
    if (session.seat_ref === null)
      continue;
    const first = firstVoiceBySeat.get(session.seat_ref);
    if (first === undefined)
      firstVoiceBySeat.set(session.seat_ref, session.voice_id);
    else
      union(first, session.voice_id);
  }
  const groups = new Map;
  for (const session of byId.values()) {
    const root = find(session.voice_id);
    const group = groups.get(root);
    if (group)
      group.push(session);
    else
      groups.set(root, [session]);
  }
  const units = [...groups.values()].map((group) => {
    const voiceIds = sortedUnique(group.map((session) => session.voice_id));
    const unit = {
      unit_id: ballotUnitId(voiceIds),
      voice_ids: voiceIds,
      session_ids: sortedUnique(group.map((session) => session.session_id)),
      seat_refs: sortedUnique(group.flatMap((session) => session.seat_ref === null ? [] : [session.seat_ref])),
      names: sortedUnique(group.map((session) => session.name))
    };
    const models = sortedUnique(group.flatMap((session) => {
      const model = typeof session.model === "string" ? session.model.trim() : "";
      return model ? [model] : [];
    }));
    if (models.length === 1)
      unit.model = models[0];
    else if (models.length > 1)
      unit.models = models;
    return unit;
  }).sort((left, right) => compare(left.unit_id, right.unit_id));
  return { units, electorate_sha256: electorateSha256(units) };
}
function classifyCaster(units, caster) {
  const listed = units.find((unit) => unit.voice_ids.includes(caster.voice_id));
  if (listed)
    return { counts_as: "counted", unit_id: listed.unit_id };
  const late = { counts_as: "late", unit_id: ballotUnitId([caster.voice_id]) };
  const seatRef = caster.seat_ref;
  if (nonEmptyString(seatRef)) {
    const sameHandle = units.find((unit) => unit.seat_refs.includes(seatRef));
    if (sameHandle)
      late.same_handle_as = sameHandle.unit_id;
  }
  return late;
}
function unitBasis(units) {
  const unhandled = units.filter((unit) => unit.seat_refs.length === 0).length;
  return `A unit is one attested session lineage, or several lineages that declared the same unverified host handle. ${unhandled} of ${units.length} units declared no handle and are counted per lineage. This does not show one mind, one model or one operator. A process can hold several sessions; sessions started through the legacy session tool without attestation are separate units.`;
}
var OPTION_KEY = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
function validatePollTerms(input, context) {
  const advice = [];
  const question = textField(input.question, "question", MAX_BALLOT_QUESTION, { required: true, multiline: true });
  const options = pollOptions(input.options);
  const criteria = textField(input.criteria, "criteria", MAX_BALLOT_CRITERIA, { required: false, multiline: true });
  if (criteria === null) {
    advice.push("No criteria given: say what makes an option acceptable, so every voter judges the same question.");
  }
  let pick;
  if (input.pick !== undefined && input.pick !== null) {
    if (!Number.isInteger(input.pick) || input.pick < 1 || input.pick > options.length) {
      refuse("invalid_pick", `pick is an integer from 1 to ${options.length}, the number of options`, {
        field: "pick",
        min: 1,
        max: options.length
      }, { say: `Set pick from 1 to ${options.length}, or leave it out to let voters approve any number of options.` });
    }
    pick = input.pick;
    if (pick === 1)
      advice.push("pick 1 makes this a plurality vote: no voter can say that either of two options would do.");
  }
  const closesAt = ballotClosesAt(input.closes, context.now);
  let closeWhenAllCast = false;
  if (input.close_when_all_cast !== undefined && input.close_when_all_cast !== null) {
    if (typeof input.close_when_all_cast !== "boolean") {
      refuse("invalid_close_when_all_cast", "close_when_all_cast is true or false", { field: "close_when_all_cast" }, {
        say: "Leave close_when_all_cast out to keep the ballot sealed until its deadline."
      });
    }
    closeWhenAllCast = input.close_when_all_cast;
  }
  checkElectorateSize(context.units, { poll_input: input, sessions: context.sessions });
  const quorum = ballotQuorum(input.quorum, context.units.length);
  const terms = {
    question,
    options,
    method: BALLOT_METHOD,
    quorum,
    closes_at: closesAt,
    close_when_all_cast: closeWhenAllCast
  };
  if (criteria !== null)
    terms.criteria = criteria;
  if (pick !== undefined)
    terms.pick = pick;
  return { terms, advice };
}
function checkElectorateSize(units, context = {}) {
  if (units.length < MIN_ELECTORATE_UNITS) {
    refuse("electorate_too_small", `A ballot needs at least ${MIN_ELECTORATE_UNITS} units in its electorate, and the electorate is fixed when the ballot opens; ${units.length} is here now`, {
      units: units.length,
      min: MIN_ELECTORATE_UNITS
    }, {
      say: "There is no one else here to poll yet. Open the poll once another agent has arrived (collab_arrive shows who is here); until then say it with collab_note, or put a direction-level question to collab_propose."
    });
  }
  if (units.length > MAX_ELECTORATE_UNITS) {
    const voters = mostRecentlySeenVoters(units, context.sessions ?? []);
    const remedy = voters && context.poll_input ? { tool: "collab_poll", input: { ...definedEntries(context.poll_input), voters } } : { say: `Name at most ${MAX_ELECTORATE_UNITS} voters with voters.` };
    refuse("electorate_too_large", `A ballot counts at most ${MAX_ELECTORATE_UNITS} units; this electorate has ${units.length}`, {
      units: units.length,
      max: MAX_ELECTORATE_UNITS
    }, remedy);
  }
}
function ballotQuorum(value, electorateSize) {
  if (value === undefined || value === null)
    return DEFAULT_BALLOT_QUORUM;
  if (!Number.isInteger(value) || value < MIN_BALLOT_QUORUM || value > electorateSize) {
    refuse("invalid_quorum", `quorum is an integer from ${MIN_BALLOT_QUORUM} to ${electorateSize}, the number of units in the electorate`, {
      field: "quorum",
      min: MIN_BALLOT_QUORUM,
      max: electorateSize
    }, { say: `Set quorum from ${MIN_BALLOT_QUORUM} to ${electorateSize}, or leave it out for ${DEFAULT_BALLOT_QUORUM}.` });
  }
  return value;
}
var DURATION = /^(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/;
var ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
function ballotClosesAt(closes, now) {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs))
    throw new CollabError("invalid_now", "now must be an ISO time");
  let closesMs = null;
  if (typeof closes === "number" && Number.isInteger(closes)) {
    closesMs = nowMs + closes * 1000;
  } else if (typeof closes === "string") {
    const text = closes.trim().toLowerCase();
    const duration = DURATION.exec(text);
    if (/^\d+$/.test(text)) {
      closesMs = nowMs + Number(text) * 1000;
    } else if (text !== "" && duration) {
      const [days, hours, minutes, seconds] = duration.slice(1).map((part) => Number(part ?? 0));
      closesMs = nowMs + (((days * 24 + hours) * 60 + minutes) * 60 + seconds) * 1000;
    } else if (ISO_INSTANT.test(closes.trim())) {
      const parsed = Date.parse(closes.trim());
      if (Number.isFinite(parsed))
        closesMs = parsed;
    }
  }
  const window = closesMs === null ? null : closesMs - nowMs;
  if (closesMs === null || window === null || window < MIN_BALLOT_CLOSE_SECONDS * 1000 || window > MAX_BALLOT_CLOSE_SECONDS * 1000) {
    refuse("invalid_closes", "closes is a duration from 1 minute to 7 days, or an ISO time inside that window", {
      field: "closes",
      min_seconds: MIN_BALLOT_CLOSE_SECONDS,
      max_seconds: MAX_BALLOT_CLOSE_SECONDS
    }, { say: 'Set closes to a duration such as "30m", "2h" or "1d", from 1 minute to 7 days.' });
  }
  return new Date(closesMs).toISOString();
}
function pollOptions(value) {
  const bounds = { field: "options", min: MIN_BALLOT_OPTIONS, max: MAX_BALLOT_OPTIONS };
  if (!Array.isArray(value) || value.length < MIN_BALLOT_OPTIONS || value.length > MAX_BALLOT_OPTIONS) {
    refuse("invalid_options", `options is a list of ${MIN_BALLOT_OPTIONS} to ${MAX_BALLOT_OPTIONS} {key, label}`, bounds, {
      say: `Give ${MIN_BALLOT_OPTIONS} to ${MAX_BALLOT_OPTIONS} options. A yes-or-no question about proceeding belongs to collab_propose.`
    });
  }
  const seen = new Set;
  return value.map((option, index) => {
    const field = `options[${index}]`;
    if (option === null || typeof option !== "object" || Array.isArray(option)) {
      refuse("invalid_options", `${field} must be {key, label}`, { field }, { say: "Give each option as {key, label}." });
    }
    const record = option;
    const key = typeof record.key === "string" ? record.key.trim() : "";
    if (!key || key.length > MAX_BALLOT_OPTION_KEY || !OPTION_KEY.test(key)) {
      refuse("invalid_options", `${field}.key is 1 to ${MAX_BALLOT_OPTION_KEY} letters, digits, _ or -, starting with a letter or digit`, {
        field: `${field}.key`,
        max: MAX_BALLOT_OPTION_KEY
      }, { say: 'Use short option keys such as "a", "b", "keep" or "split-2".' });
    }
    const folded = key.toLowerCase();
    if (seen.has(folded)) {
      refuse("invalid_options", `option key "${key}" is used twice (keys are compared without case)`, { field: `${field}.key` }, {
        say: "Give every option a different key."
      });
    }
    seen.add(folded);
    const label = textField(record.label, `${field}.label`, MAX_BALLOT_OPTION_LABEL, {
      required: true,
      multiline: false,
      code: "invalid_options"
    });
    return { key, label };
  });
}
function mostRecentlySeenVoters(units, sessions) {
  const seenAt = (session) => {
    const parsed = typeof session.last_seen_at === "string" ? Date.parse(session.last_seen_at) : Number.NaN;
    return Number.isFinite(parsed) ? parsed : null;
  };
  const latest = units.map((unit) => {
    let best = null;
    for (const session of sessions) {
      if (!unit.session_ids.includes(session.session_id))
        continue;
      const at = seenAt(session);
      if (at === null)
        continue;
      if (best === null || at > best.at || at === best.at && session.session_id < best.session_id) {
        best = { session_id: session.session_id, at };
      }
    }
    return best;
  });
  if (latest.some((entry) => entry === null))
    return null;
  return latest.sort((left, right) => right.at - left.at || compare(left.session_id, right.session_id)).slice(0, MAX_ELECTORATE_UNITS).map((entry) => entry.session_id);
}
function normalizeBallotVoters(value) {
  if (value === undefined || value === null)
    return null;
  if (!Array.isArray(value) || value.length === 0 || value.some((voter) => !nonEmptyString(voter) || voter.trim() !== voter)) {
    refuse("invalid_voters", "voters is a non-empty list of session ids or names", { field: "voters" }, {
      say: "Leave voters out for the default electorate, or list the sessions to poll."
    });
  }
  return [...new Set(value)];
}
var PLACEHOLDER_ENTRY_IDS = {
  ballot_id: "report_00000000-0000-0000-0000-000000000000",
  cast_id: "00000000-0000-0000-0000-000000000000",
  unit_id: `unit_${"0".repeat(32)}`,
  session_id: "session_00000000-0000-0000-0000-000000000000"
};
function nextCastSeq(previousCasts) {
  if (previousCasts >= MAX_CASTS_PER_SESSION) {
    refuse("cast_limit", `A session may cast at most ${MAX_CASTS_PER_SESSION} times in one ballot`, {
      max: MAX_CASTS_PER_SESSION
    }, { say: "Your latest cast stands; it is revealed at the close." });
  }
  return previousCasts + 1;
}
var SALT = /^[0-9a-f]{64}$/;
function ballotCommitment(input) {
  if (!SALT.test(input.salt)) {
    throw new CollabError("invalid_salt", "a ballot salt is 32 random bytes as 64 lowercase hex characters");
  }
  return sha256(canonicalJson({
    protocol: BALLOT_COMMITMENT_PROTOCOL,
    workspace_id: input.workspace_id,
    ballot_id: input.ballot_id,
    cast_id: input.cast_id,
    unit_id: input.unit_id,
    session_id: input.session_id,
    vote: input.vote,
    salt: input.salt
  }));
}
function openSeal(file, cast, context) {
  if (!isPlainObject(file))
    return { state: "seal_unreadable" };
  const { cast_id, journal_realpath, session_id, unit_id, salt, vote } = file;
  if (typeof cast_id !== "string" || typeof journal_realpath !== "string" || typeof session_id !== "string" || typeof unit_id !== "string" || typeof salt !== "string" || !SALT.test(salt) || !isSealedVote(vote)) {
    return { state: "seal_unreadable" };
  }
  if (cast_id !== cast.cast_id || session_id !== cast.session_id || unit_id !== cast.unit_id)
    return { state: "seal_mismatch" };
  const commitment = ballotCommitment({
    workspace_id: context.workspace_id,
    ballot_id: context.ballot_id,
    cast_id,
    unit_id,
    session_id,
    vote,
    salt
  });
  if (commitment !== cast.commitment)
    return { state: "seal_mismatch" };
  return {
    state: "ok",
    vote,
    salt,
    owned: context.journal_realpath === undefined || context.journal_realpath === journal_realpath
  };
}
function resolveCasts(units, casts, context) {
  const unitById = new Map(units.map((unit) => [unit.unit_id, unit]));
  const listed = casts.map((cast) => unitById.get(cast.unit_id)?.voice_ids.includes(cast.voice_id) === true);
  const latestByVoice = new Map;
  const castingVoices = new Map;
  casts.forEach((cast, index) => {
    if (!listed[index])
      return;
    latestByVoice.set(voiceKey(cast), index);
    const voices = castingVoices.get(cast.unit_id) ?? new Set;
    voices.add(cast.voice_id);
    castingVoices.set(cast.unit_id, voices);
  });
  return casts.map((cast, index) => {
    let status;
    if (!listed[index])
      status = "late";
    else if (latestByVoice.get(voiceKey(cast)) !== index)
      status = "replaced";
    else if ((castingVoices.get(cast.unit_id)?.size ?? 0) > 1)
      status = "unit_conflict";
    else if (cast.seal.state !== "ok")
      status = cast.seal.state;
    else
      status = "counted";
    const entry = {
      ballot_id: context.ballot_id,
      cast_id: cast.cast_id,
      unit_id: cast.unit_id,
      session_id: cast.session_id,
      cast_seq: cast.cast_seq,
      commitment: cast.commitment,
      status
    };
    if (cast.seal.state !== "ok")
      return entry;
    const revealed = { ...entry, salt: cast.seal.salt, vote: cast.seal.vote };
    if (revealedEntryBytes(revealed) <= MAX_REVEALED_ENTRY_BYTES)
      return revealed;
    return status === "counted" ? { ...entry, status: "seal_unreadable" } : entry;
  });
}
function revealedEntryBytes(entry) {
  return Buffer.byteLength(canonicalJson(entry), "utf8");
}
function revealedEntriesSha256(entries) {
  return sha256(canonicalJson(entries));
}
function unitOutcomes(units, entries) {
  return units.map((unit) => {
    const own = entries.filter((entry) => entry.unit_id === unit.unit_id && entry.status !== "late");
    if (own.length === 0)
      return { unit_id: unit.unit_id, state: "not_cast" };
    const counted = own.filter((entry) => entry.status === "counted");
    const conflicts = own.filter((entry) => entry.status === "unit_conflict");
    if (conflicts.length > 0 || counted.length > 1) {
      return { unit_id: unit.unit_id, state: "unit_conflict", entries: [...conflicts, ...counted] };
    }
    const only = counted[0];
    if (only !== undefined) {
      if (only.vote === undefined)
        return { unit_id: unit.unit_id, state: "seal_unreadable", entry: only };
      const entry = only;
      return { unit_id: unit.unit_id, state: "counted", entry, abstained: entry.vote.choice.length === 0 };
    }
    const latest = own[own.length - 1];
    const state = latest.status === "seal_unreadable" || latest.status === "seal_mismatch" ? latest.status : "seal_missing";
    return { unit_id: unit.unit_id, state, entry: latest };
  });
}
function ballotResult(input) {
  const sessions = input.sessions ?? {};
  const nameOf = (sessionId) => sessions[sessionId]?.name ?? sessionId;
  const keys = input.terms.options.map((option) => option.key);
  const unitIds = new Set(input.units.map((unit) => unit.unit_id));
  const outcomes = unitOutcomes(input.units, input.entries);
  const counted = outcomes.filter((outcome) => outcome.state === "counted");
  const approvals = counted.map((outcome) => ({
    entry: outcome.entry,
    name: nameOf(outcome.entry.session_id),
    keys: keys.filter((key) => outcome.entry.vote.choice.includes(key)),
    lineage: lineageOf(outcome.entry, sessions, input.units)
  })).sort((left, right) => compare(left.name, right.name) || compare(left.entry.unit_id, right.entry.unit_id));
  const quorum = { needed: input.terms.quorum, met: counted.length >= input.terms.quorum, counted: counted.length };
  const tallies = keys.map((key) => approvals.filter((approval) => approval.keys.includes(key)).length);
  const most = Math.max(0, ...tallies);
  let status;
  let top = [];
  if (input.withdrawn)
    status = "withdrawn";
  else if (!quorum.met)
    status = "inconclusive";
  else if (most === 0)
    status = "no_approval";
  else {
    top = keys.filter((_, index) => tallies[index] === most);
    status = top.length > 1 ? "tied" : "top_choice";
  }
  const topSet = new Set(top);
  const answered = new Set(approvals.filter((approval) => approval.keys.some((key) => topSet.has(key))).flatMap((approval) => approval.entry.vote.evidence.map(evidenceKey)));
  const options = input.terms.options.map((option) => {
    const voters = approvals.filter((approval) => approval.keys.includes(option.key));
    const unique = new Map;
    for (const voter of voters) {
      for (const item of voter.entry.vote.evidence) {
        const key = evidenceKey(item);
        if (answered.has(key))
          continue;
        const view2 = unique.get(key);
        if (view2 === undefined)
          unique.set(key, { evidence: item, cited_by: [voter.name] });
        else if (!view2.cited_by.includes(voter.name))
          view2.cited_by.push(voter.name);
      }
    }
    return {
      key: option.key,
      label: option.label,
      units: voters.length,
      voters: voters.map((voter) => voter.name),
      reasons: voters.flatMap((voter) => voter.entry.vote.why.map((reason) => ({
        by: voter.name,
        text: reason.text,
        basis: reason.basis ?? null,
        cites: [...reason.cites],
        cited: reason.cites.flatMap((cite) => {
          const item = voter.entry.vote.evidence[cite - 1];
          return item === undefined ? [] : [item];
        })
      }))),
      no_reason_given: voters.filter((voter) => voter.entry.vote.why.length === 0).map((voter) => voter.name),
      unique_evidence: [...unique.values()]
    };
  });
  const approvalSets = new Set(approvals.filter((approval) => approval.keys.length > 0).map((approval) => approval.keys.join(`
`)));
  const split = approvalSets.size > 1;
  const lineages = {};
  for (const label of sortedUnique(approvals.map((approval) => approval.lineage.label))) {
    lineages[label] = approvals.filter((approval) => approval.lineage.label === label).length;
  }
  const notes = [];
  const oneFamily = (values) => values.length >= 2 && values.every((family) => family !== null && family === values[0]);
  if (oneFamily(approvals.map((approval) => approval.lineage.family))) {
    notes.push(BALLOT_SAME_FAMILY_NOTE);
  } else {
    for (const key of top) {
      const supporting = approvals.filter((approval) => approval.keys.includes(key)).map((approval) => approval.lineage.family);
      if (oneFamily(supporting)) {
        notes.push(`every unit approving ${key} declares the same model family (${supporting[0]}): their agreement is not independent confirmation`);
      }
    }
  }
  if (split)
    notes.push(BALLOT_SPLIT_NOTE);
  const view = (entry) => {
    const result2 = {
      cast_id: entry.cast_id,
      unit_id: entry.unit_id,
      session_id: entry.session_id,
      name: nameOf(entry.session_id),
      cast_seq: entry.cast_seq
    };
    if (entry.vote !== undefined)
      result2.choice = [...entry.vote.choice];
    return result2;
  };
  const late = input.entries.filter((entry) => entry.status === "late" || !unitIds.has(entry.unit_id)).map((entry) => {
    const result2 = view(entry);
    const seatRef = sessions[entry.session_id]?.seat_ref;
    if (nonEmptyString(seatRef)) {
      const sameHandle = input.units.find((unit) => unit.seat_refs.includes(seatRef));
      if (sameHandle)
        result2.same_handle_as = sameHandle.unit_id;
    }
    return result2;
  });
  const listedWith = (status2) => input.entries.filter((entry) => entry.status === status2 && unitIds.has(entry.unit_id)).map(view);
  const delivered = new Set(input.delivered_session_ids ?? []);
  const result = {
    status,
    split,
    turnout: {
      cast: outcomes.filter((outcome) => outcome.state !== "not_cast").length,
      electorate: input.units.length,
      delivery_recorded: input.units.filter((unit) => unit.session_ids.some((id) => delivered.has(id))).length
    },
    quorum,
    options,
    top,
    abstained: approvals.filter((approval) => approval.keys.length === 0).map((approval) => approval.name),
    late,
    replaced: listedWith("replaced"),
    unit_conflicts: listedWith("unit_conflict"),
    seal_missing: listedWith("seal_missing"),
    seal_unreadable: listedWith("seal_unreadable"),
    seal_mismatch: listedWith("seal_mismatch"),
    left_out: [...input.left_out ?? []],
    lineages,
    notes,
    unit_basis: unitBasis(input.units),
    sealing: BALLOT_SEALING,
    authorises: BALLOT_AUTHORISES
  };
  if (status === "tied")
    result.next = { ...BALLOT_TIE_NEXT };
  return result;
}
function modelFamily(label) {
  const head = label.trim().toLowerCase().split(/[\s\-_/:.@]/)[0];
  return head ? head : null;
}
function lineageOf(entry, sessions, units) {
  const session = sessions[entry.session_id];
  const declared = (entry.vote.model ?? session?.model ?? "").trim();
  if (declared)
    return { label: declared, family: modelFamily(declared) };
  const seatRefs = nonEmptyString(session?.seat_ref) ? [session.seat_ref] : units.find((unit) => unit.unit_id === entry.unit_id)?.seat_refs ?? [];
  const prefixes = sortedUnique(seatRefs.flatMap((seatRef) => {
    const colon = seatRef.indexOf(":");
    return colon > 0 ? [seatRef.slice(0, colon)] : [];
  }));
  const prefix = prefixes.length === 1 ? prefixes[0] : undefined;
  if (prefix !== undefined)
    return { label: `host:${prefix}`, family: modelFamily(prefix) };
  return { label: "undeclared", family: null };
}
function evidenceText(item) {
  return typeof item === "string" ? item : item.text;
}
function evidenceKey(item) {
  if (typeof item !== "string" && nonEmptyString(item.kind) && nonEmptyString(item.locator)) {
    return `ref:${canonicalJson({
      kind: item.kind,
      locator: item.locator,
      lines: item.lines ?? null,
      sha256: item.sha256 ?? null,
      exit: item.exit ?? null
    })}`;
  }
  return `text:${evidenceText(item).replace(/\s+/g, " ").trim()}`;
}
function textField(value, field, max, options) {
  const code = options.code ?? `invalid_${field}`;
  const fix = { say: `Give ${field} as plain text${options.multiline ? "" : " on one line"}.` };
  if (value === undefined || value === null) {
    if (options.required)
      refuse(code, `${field} is required`, { field }, fix);
    return null;
  }
  if (typeof value !== "string")
    refuse(code, `${field} must be text`, { field }, fix);
  const text = normalizeNoteText(value);
  if (!text) {
    if (options.required)
      refuse(code, `${field} must not be empty`, { field }, fix);
    return null;
  }
  if (text.includes("\x00"))
    refuse(code, `${field} must not contain NUL characters`, { field }, fix);
  if (hasLoneSurrogate(text)) {
    refuse(code, `${field} must be well-formed Unicode text (it holds half of a character, as when an emoji is cut in two)`, { field }, {
      say: `Send ${field} again with every character whole.`
    });
  }
  if (!options.multiline && text.includes(`
`))
    refuse(code, `${field} must be one line`, { field }, fix);
  if (text.length > max) {
    refuse("too_long", `${field} exceeds ${max} characters`, { field, max }, {
      say: `Shorten ${field} to at most ${max} characters.`
    });
  }
  return text;
}
function isSealedVote(value) {
  if (!isPlainObject(value) || !jsonClean(value))
    return false;
  const { choice, why, evidence, shared, model } = value;
  if (!Array.isArray(choice) || choice.some((key) => typeof key !== "string"))
    return false;
  if (!Array.isArray(evidence) || evidence.some((item) => typeof item !== "string" && !(isPlainObject(item) && typeof item.text === "string"))) {
    return false;
  }
  if (!Array.isArray(why) || why.some((reason) => !isPlainObject(reason) || typeof reason.text !== "string" || !(reason.basis === undefined || BALLOT_BASES.includes(reason.basis)) || !Array.isArray(reason.cites) || reason.cites.some((cite) => !Number.isInteger(cite)))) {
    return false;
  }
  return (shared === undefined || typeof shared === "string") && (model === undefined || typeof model === "string");
}
function jsonClean(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number")
    return Number.isSafeInteger(value);
  if (Array.isArray(value))
    return value.every(jsonClean);
  if (isPlainObject(value)) {
    return Object.entries(value).every(([key, child]) => !/^(0|[1-9]\d*)$/.test(key) && jsonClean(child));
  }
  return false;
}
function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function voiceKey(cast) {
  return `${cast.unit_id}
${cast.voice_id}`;
}
function definedEntries(record) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}
function nonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}
function sortedUnique(values) {
  return [...new Set(values)].sort(compare);
}
function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
function refuse(code, message, details, remedy) {
  throw new CollabError(code, message, { ...details, remedy });
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

// src/ballot-seal.ts
import {
  chmodSync as chmodSync2,
  closeSync as closeSync2,
  existsSync as existsSync2,
  fsyncSync as fsyncSync2,
  lstatSync as lstatSync2,
  mkdirSync as mkdirSync2,
  openSync as openSync2,
  readdirSync,
  readFileSync as readFileSync2,
  renameSync as renameSync2,
  rmdirSync,
  unlinkSync as unlinkSync2,
  writeSync
} from "fs";
import { dirname as dirname2, join as join2 } from "path";
var SEAL_DIRECTORY = "collab-ballots";
var BALLOT_ID = /^report_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
var CAST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function sealRoot(journalRealpath) {
  return join2(dirname2(journalRealpath), SEAL_DIRECTORY);
}
function sealDirectory(journalRealpath, ballotId) {
  if (!BALLOT_ID.test(ballotId))
    throw new CollabError("invalid_ballot_id", "A ballot id is the poll report's id");
  return join2(sealRoot(journalRealpath), ballotId);
}
function sealPath(journalRealpath, ballotId, castId) {
  if (!CAST_ID.test(castId))
    throw new CollabError("invalid_cast_id", "A cast id is a random uuid");
  return join2(sealDirectory(journalRealpath, ballotId), `${castId}.json`);
}
function readSealFile(path) {
  try {
    if (!existsSync2(path))
      return { state: "missing" };
    const stat = lstatSync2(path);
    if (!stat.isFile() || stat.isSymbolicLink())
      return { state: "unreadable" };
    return { state: "read", value: JSON.parse(readFileSync2(path, "utf8")) };
  } catch {
    return { state: "unreadable" };
  }
}
function removeSealFile(path) {
  removeQuietly(path);
}
function listSealFiles(journalRealpath, ballotId) {
  try {
    const directory = sealDirectory(journalRealpath, ballotId);
    if (!existsSync2(directory))
      return [];
    return readdirSync(directory).filter((name) => name.endsWith(".json") && CAST_ID.test(name.slice(0, -".json".length))).map((name) => name.slice(0, -".json".length));
  } catch {
    return [];
  }
}
var TEMPORARY = /^\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;
function listSealTemporaries(journalRealpath, ballotId) {
  try {
    const directory = sealDirectory(journalRealpath, ballotId);
    if (!existsSync2(directory))
      return [];
    return readdirSync(directory).filter((name) => TEMPORARY.test(name)).map((name) => join2(directory, name));
  } catch {
    return [];
  }
}
function listSealBallots(journalRealpath) {
  try {
    const root = sealRoot(journalRealpath);
    if (!existsSync2(root) || !lstatSync2(root).isDirectory())
      return [];
    return readdirSync(root).filter((name) => BALLOT_ID.test(name));
  } catch {
    return [];
  }
}
function removeEmptySealDirectory(journalRealpath, ballotId) {
  try {
    const directory = sealDirectory(journalRealpath, ballotId);
    if (existsSync2(directory) && readdirSync(directory).length === 0)
      rmdirSync(directory);
  } catch {}
}
function removeQuietly(path) {
  try {
    unlinkSync2(path);
  } catch {}
}

// src/store.ts
import { Database } from "bun:sqlite";
import { createHash as createHash5, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import {
  chmodSync as chmodSync3,
  closeSync as closeSync4,
  existsSync as existsSync4,
  lstatSync as lstatSync4,
  mkdirSync as mkdirSync3,
  openSync as openSync4
} from "fs";
import { dirname as dirname3, isAbsolute as isAbsolute3, join as join3, posix, resolve as resolve4 } from "path";

// src/passkey.ts
import { createHash as createHash2, createPublicKey, verify } from "crypto";
var FLAG_USER_PRESENT = 1;
var FLAG_USER_VERIFIED = 4;
var BASE64URL = /^[A-Za-z0-9_-]*$/;
function base64urlDecode(value, field, maxBytes = 64 * 1024) {
  if (typeof value !== "string" || !BASE64URL.test(value) || value.length === 0) {
    throw new CollabError("passkey_assertion_invalid", `${field} must be non-empty base64url`);
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length > maxBytes) {
    throw new CollabError("passkey_assertion_invalid", `${field} exceeds ${maxBytes} bytes`);
  }
  return bytes;
}
function sha2562(bytes) {
  return createHash2("sha256").update(bytes).digest();
}
function personActChallenge(input) {
  const challenge_bytes = canonicalJson({ protocol: PERSON_ACT_PROTOCOL, ...input });
  return { challenge_bytes, challenge: sha2562(challenge_bytes).toString("base64url") };
}
var ASSERTION_FIELDS = new Set(["credential_id", "authenticator_data", "client_data_json", "signature", "user_handle"]);
function normalizePasskeyAssertion(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CollabError("passkey_assertion_invalid", "The assertion must be a JSON object");
  }
  const input = value;
  const unknown = Object.keys(input).filter((key) => !ASSERTION_FIELDS.has(key));
  if (unknown.length > 0) {
    throw new CollabError("passkey_assertion_invalid", "The assertion has fields WebAuthn does not define", { fields: unknown });
  }
  const field = (name, maxBytes) => {
    base64urlDecode(input[name], name, maxBytes);
    return input[name];
  };
  const userHandle = input.user_handle === undefined || input.user_handle === null ? null : field("user_handle", 64);
  return {
    credential_id: field("credential_id", 1023),
    authenticator_data: field("authenticator_data", 4096),
    client_data_json: field("client_data_json", 4096),
    signature: field("signature", 256),
    user_handle: userHandle
  };
}
function normalizePasskeyEnrollment(input) {
  base64urlDecode(input.credential_id, "credential_id", 1023);
  if (typeof input.public_key_spki !== "string") {
    throw new CollabError("passkey_key_invalid", "public_key_spki must be base64url DER");
  }
  parsePasskeyPublicKey(input.public_key_spki);
  if (input.algorithm !== -7) {
    throw new CollabError("passkey_key_invalid", "Only ES256 (COSE algorithm -7) passkeys are supported");
  }
  const scope = validatePasskeyScope(input.rp_id, input.origin);
  let label = null;
  if (input.label !== undefined && input.label !== null) {
    if (typeof input.label !== "string" || input.label.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(input.label)) {
      throw new CollabError("passkey_label_invalid", "label must be at most 80 characters without control characters");
    }
    label = input.label.trim() || null;
  }
  return {
    credential_id: input.credential_id,
    public_key_spki: input.public_key_spki,
    algorithm: -7,
    ...scope,
    label
  };
}
function parsePasskeyPublicKey(spki) {
  const der = base64urlDecode(spki, "public_key_spki", 1024);
  let key;
  try {
    key = createPublicKey({ key: der, format: "der", type: "spki" });
  } catch {
    throw new CollabError("passkey_key_invalid", "public_key_spki is not a DER SubjectPublicKeyInfo");
  }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new CollabError("passkey_key_invalid", "Only ES256 (P-256) passkeys are supported");
  }
  return key;
}
function passkeyFingerprint(spki) {
  return sha2562(base64urlDecode(spki, "public_key_spki", 1024)).toString("hex");
}
function validatePasskeyScope(rpId, origin) {
  if (typeof rpId !== "string" || !/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/.test(rpId)) {
    throw new CollabError("passkey_scope_invalid", "rp_id must be a lowercase host name");
  }
  let url;
  try {
    url = new URL(String(origin));
  } catch {
    throw new CollabError("passkey_scope_invalid", "origin must be a URL origin");
  }
  const secure = url.protocol === "https:" || url.protocol === "http:" && url.hostname === "localhost";
  const hostMatches = url.hostname === rpId || url.hostname.endsWith(`.${rpId}`);
  if (!secure || !hostMatches || url.origin !== origin) {
    throw new CollabError("passkey_scope_invalid", "origin must be an https origin (or http://localhost) whose host is rp_id or one of its subdomains");
  }
  return { rp_id: rpId, origin: url.origin };
}
function verifyPasskeyAssertion(input) {
  const { passkey, assertion } = input;
  if (assertion.credential_id !== passkey.credential_id) {
    throw new CollabError("passkey_not_enrolled", "The assertion names a different credential");
  }
  const clientDataBytes = base64urlDecode(assertion.client_data_json, "client_data_json");
  const authenticatorData = base64urlDecode(assertion.authenticator_data, "authenticator_data");
  const signature = base64urlDecode(assertion.signature, "signature", 256);
  let clientData;
  try {
    const parsed = JSON.parse(clientDataBytes.toString("utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("not an object");
    clientData = parsed;
  } catch {
    throw new CollabError("passkey_assertion_invalid", "client_data_json is not a JSON object");
  }
  if (clientData.type !== "webauthn.get") {
    throw new CollabError("passkey_assertion_invalid", "client data type must be webauthn.get");
  }
  if (clientData.challenge !== input.expected_challenge) {
    throw new CollabError("passkey_challenge_mismatch", "The assertion signs a different act; request a fresh challenge for the current state");
  }
  if (clientData.origin !== passkey.origin || clientData.crossOrigin === true) {
    throw new CollabError("passkey_origin_mismatch", "The assertion came from another origin");
  }
  if (authenticatorData.length < 37) {
    throw new CollabError("passkey_assertion_invalid", "authenticator_data is too short");
  }
  if (!authenticatorData.subarray(0, 32).equals(sha2562(passkey.rp_id))) {
    throw new CollabError("passkey_rp_mismatch", "The assertion is for another relying party");
  }
  const flags = authenticatorData[32];
  if ((flags & FLAG_USER_PRESENT) === 0 || (flags & FLAG_USER_VERIFIED) === 0) {
    throw new CollabError("passkey_user_not_verified", "The authenticator did not report user presence and user verification");
  }
  const signCount = authenticatorData.readUInt32BE(33);
  if ((signCount !== 0 || passkey.sign_count !== 0) && signCount <= passkey.sign_count) {
    throw new CollabError("passkey_counter_regressed", "The signature counter did not increase");
  }
  const signed = Buffer.concat([authenticatorData, sha2562(clientDataBytes)]);
  const valid = verify("sha256", signed, { key: parsePasskeyPublicKey(passkey.public_key_spki), dsaEncoding: "der" }, signature);
  if (!valid)
    throw new CollabError("passkey_signature_invalid", "The passkey signature does not verify");
  return { sign_count: signCount };
}

// src/proposal.ts
function proposalBytes(content, rule = CONSENT_RULE) {
  return canonicalJson({ protocol: PROPOSAL_BYTES_PROTOCOL, rule, ...content });
}
function aiPosition(input) {
  const closed = Date.parse(input.now) >= Date.parse(input.closes_at);
  const others = [...new Set(input.snapshot_voice_ids)].filter((voice) => voice !== input.author_voice_id).sort();
  const lone = others.length === 0;
  const qualifying_support_indexes = input.support_voice_ids.flatMap((voice, index) => lone || voice !== input.author_voice_id ? [index] : []);
  const supported = new Set(qualifying_support_indexes.map((index) => input.support_voice_ids[index]));
  const awaiting_voice_ids = others.filter((voice) => !supported.has(voice));
  const result = (position) => ({
    position,
    closed,
    qualifying_support_indexes,
    awaiting_voice_ids
  });
  if (input.obsoleted)
    return result(input.obsoleted);
  const hasSupport = qualifying_support_indexes.length > 0;
  if (!closed) {
    if (input.unresolved_challenge)
      return result("challenged");
    return result(hasSupport && awaiting_voice_ids.length === 0 ? "consented" : "open");
  }
  if (input.unresolved_challenge)
    return result("split");
  return result(hasSupport ? "consented" : "lapsed");
}

// src/consent-v2.ts
import { createHash as createHash3 } from "crypto";
var CONSENT_RULE_VARIABLES = ["AGENTOOL_COLLAB_CONSENT_RULE", "AGENTTOOL_COLLAB_CONSENT_RULE"];
var MAX_SET_ASIDE_REASON = 2000;
var CHALLENGE_CONTENT_PROTOCOL = "agenttool.collab-challenge-content/1";
function isConsentRule(value) {
  return CONSENT_RULES.includes(value);
}
function validateConsentRule(value) {
  if (!isConsentRule(value)) {
    throw new CollabError("invalid_consent_rule", `The consent rule must be ${CONSENT_RULES.join(" | ")}`);
  }
  return value;
}
function consentRuleFromEnvironment(environment) {
  const values = CONSENT_RULE_VARIABLES.map((name) => ({ name, value: environment[name] })).filter((entry) => entry.value !== undefined && entry.value !== "");
  for (const { name, value } of values) {
    if (!isConsentRule(value)) {
      throw new CollabError("invalid_consent_rule", `${name} must be ${CONSENT_RULES.join(" | ")}, not ${JSON.stringify(value)}`);
    }
  }
  if (values.length === 2 && values[0].value !== values[1].value) {
    throw new CollabError("conflicting_consent_rule", `AGENTOOL_COLLAB_CONSENT_RULE and AGENTTOOL_COLLAB_CONSENT_RULE disagree; set one of them to ${CONSENT_RULES.join(" | ")}`);
  }
  return values[0]?.value ?? CONSENT_RULE;
}
function challengeContentBytes(report) {
  return canonicalJson({
    protocol: CHALLENGE_CONTENT_PROTOCOL,
    id: report.id,
    workspace_id: report.workspace_id,
    task_id: report.task_id,
    from_session_id: report.from_session_id,
    from_actor: report.from_actor,
    to_session_id: report.to_session_id,
    kind: report.kind,
    body: report.body,
    evidence_refs: report.evidence_refs,
    confidence: report.confidence,
    confidence_basis: report.confidence_basis,
    limits: report.limits,
    relation: report.relation,
    target_report_id: report.target_report_id,
    created_at: report.created_at
  });
}
function challengeContentSha256(report) {
  return createHash3("sha256").update(challengeContentBytes(report)).digest("hex");
}
function setAsideChallenge(input) {
  const challenge_bytes = canonicalJson({ protocol: PERSON_SET_ASIDE_PROTOCOL, act: "set_aside", ...input });
  return { challenge_bytes, challenge: createHash3("sha256").update(challenge_bytes).digest("base64url") };
}
function normalizeSetAsideReason(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > MAX_SET_ASIDE_REASON || text.includes("\x00")) {
    throw setAsideRefusal("invalid_reason", {});
  }
  return text;
}
var REFUSALS = {
  rule_has_no_set_aside: {
    message: "This proposal opened under consent/v1, which has no set-aside: only each challenge's own voice can lift it",
    remedy: "Reject it at the desk if it should not go ahead. A proposal opened by a host configured with " + "AGENTOOL_COLLAB_CONSENT_RULE=consent/v2 can have an absent voice's challenge set aside; a proposal keeps the rule it opened under."
  },
  proposal_not_on_table: {
    message: "A withdrawn or superseded proposal is no longer on the table",
    remedy: "Read the proposal that replaced it, if any, and act there."
  },
  challenge_not_standing: {
    message: "That report is not a standing challenge to this proposal",
    remedy: "Only a challenge that still stands can be set aside; `person proposals --workspace <id> --proposal <id>` lists them under set_aside_options."
  },
  already_set_aside: {
    message: "This challenge was already set aside; a set-aside is final and applies to one challenge once",
    remedy: "Nothing more is needed for it. A new challenge on the proposal stands as usual and is judged on its own."
  },
  challenger_present: {
    message: "A session of the challenger's voice is live, so it can answer and lift its own challenge",
    remedy: "Ask that session to resolve or withdraw it (a desk note: `person say --workspace <id> --proposal <id> --body <text>`), " + "or reject the proposal. A session stops being live 6 hours after its last activity, or when it ends."
  },
  invalid_reason: {
    message: `A set-aside needs a reason of 1 to ${MAX_SET_ASIDE_REASON} characters`,
    remedy: "Give --reason with why this objection should no longer block; it is signed with the act and shown beside the challenge."
  },
  proposal_hash_mismatch: {
    message: "The act names different proposal bytes; read the proposal status again",
    remedy: "Run the command again, so the current bytes are shown before you confirm."
  },
  challenge_hash_mismatch: {
    message: "The act names a challenge text other than the one in the journal",
    remedy: "Run the command again, so the objection is shown as the journal holds it."
  },
  ai_position_changed: {
    message: "The agents' position changed since it was shown; read the proposal status again",
    remedy: "Run the command again, so the current position is shown before you confirm."
  }
};
function setAsideRefusal(code, details, message) {
  const refusal = REFUSALS[code];
  return new CollabError(code, message ?? refusal.message, { ...details, remedy: refusal.remedy });
}

// src/repository.ts
import { createHash as createHash4 } from "crypto";
import {
  closeSync as closeSync3,
  constants as fsConstants,
  existsSync as existsSync3,
  fstatSync,
  lstatSync as lstatSync3,
  openSync as openSync3,
  readlinkSync,
  readSync,
  realpathSync,
  statSync
} from "fs";
import { isAbsolute as isAbsolute2, relative, resolve as resolve3, sep } from "path";
import { spawnSync } from "child_process";
var GIT_TIMEOUT_MS = 5000;
var MAX_GIT_OUTPUT = 1024 * 1024;
var MAX_UNTRACKED_FILES = 1e4;
var MAX_UNTRACKED_BYTES = 64 * 1024 * 1024;
var MAX_UNTRACKED_HASH_MS = 2000;
var MAX_SUCCESSOR_PATHS = 128;
var MAX_SUCCESSOR_BYTES = 64 * 1024 * 1024;
var MAX_SUCCESSOR_INSPECT_MS = 5000;
var GIT_OBJECT_ID = /^[0-9a-f]{40,64}$/;
var RAW_DIFF_HEADER = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) ([A-Z])$/;

class RepositoryProbeTimeout extends Error {
  constructor() {
    super("Repository discovery exhausted its Git time budget");
  }
}
function inspectRepository(rootInput, explicitRepositoryKey, metadataOnly = false, options = {}) {
  const requested = resolve3(rootInput);
  if (!existsSync3(requested) || !statSync(requested).isDirectory()) {
    throw new CollabError("workspace_not_directory", "Workspace root must be an existing directory", { root_path: requested });
  }
  const requestedRoot = realpathSync(requested);
  const topLevel = gitOutput(requestedRoot, ["rev-parse", "--show-toplevel"], options);
  const rootPath = topLevel && existsSync3(topLevel) ? realpathSync(topLevel) : requestedRoot;
  const explicitKey = explicitRepositoryKey?.trim();
  if (!topLevel) {
    const repositoryKey2 = explicitKey ? `explicit:${sha2563(explicitKey)}` : `local-path:${sha2563(rootPath)}`;
    return {
      requested_root_path: requestedRoot,
      root_path: rootPath,
      repository_key: repositoryKey2,
      git_common_dir_hash: null,
      worktree_fingerprint: `path:${sha2563(rootPath)}`,
      checkpoint: {
        worktree_id: worktreeId(rootPath, `path:${rootPath}`),
        head_sha: null,
        branch: null,
        dirty: null,
        captured_at: new Date().toISOString()
      }
    };
  }
  const commonDirOutput = gitOutput(rootPath, ["rev-parse", "--path-format=absolute", "--git-common-dir"], options) ?? gitOutput(rootPath, ["rev-parse", "--git-common-dir"], options);
  const gitDirOutput = gitOutput(rootPath, ["rev-parse", "--path-format=absolute", "--git-dir"], options) ?? gitOutput(rootPath, ["rev-parse", "--git-dir"], options);
  if (!commonDirOutput || !gitDirOutput) {
    throw new CollabError("git_identity_unavailable", "Git recognized the repository but its local identity could not be resolved", { root_path: rootPath });
  }
  const commonDir = realpathIfPresent(resolveGitPath(rootPath, commonDirOutput));
  const gitDir = realpathIfPresent(resolveGitPath(rootPath, gitDirOutput));
  const commonDirHash = sha2563(commonDir);
  const repositoryKey = explicitKey ? `explicit:${sha2563(explicitKey)}` : `local-git:${commonDirHash}`;
  const fingerprint = `git:${sha2563(`${commonDir}\x00${gitDir}`)}`;
  const id = worktreeId(rootPath, fingerprint);
  return {
    requested_root_path: requestedRoot,
    root_path: rootPath,
    repository_key: repositoryKey,
    portable_repository_key: explicitKey || options.portable === false ? null : portableRepositoryKey(rootPath, options),
    git_common_dir_hash: commonDirHash,
    worktree_fingerprint: fingerprint,
    checkpoint: metadataOnly ? { worktree_id: id, head_sha: null, branch: null, dirty: null, captured_at: new Date().toISOString() } : captureRepoCheckpoint(rootPath, id)
  };
}
function portableRepositoryKey(rootPath, optionsOrDeadline = {}) {
  const options = typeof optionsOrDeadline === "number" ? { deadline: optionsOrDeadline } : optionsOrDeadline;
  const origin = gitOutput(rootPath, ["config", "--get-all", "remote.origin.url"], options);
  const remote = origin ?? gitOutput(rootPath, ["config", "--get-all", "remote.github.url"], options);
  const canonical = remote ? canonicalRepositoryRemote(remote) : null;
  if (!canonical || gitOutput(rootPath, ["rev-parse", "--is-shallow-repository"], options) !== "false")
    return null;
  const roots = successorGit(rootPath, ["rev-list", "--max-parents=0", "HEAD"], MAX_GIT_OUTPUT, options);
  if (roots.timed_out && options.deadline !== undefined)
    throw new RepositoryProbeTimeout;
  if (!roots.ok)
    return null;
  const root = roots.stdout.toString("utf8").trim();
  if (!GIT_OBJECT_ID.test(root))
    return null;
  return `git-root-remote:v1:${sha2563(`${root}\x00${canonical}`)}`;
}
function canonicalRepositoryRemote(value) {
  if (/[\s\x00-\x1f\x7f]/.test(value) || value.includes("::") || value.includes("://") && !/^(https?|ssh|git):\/\//i.test(value))
    return null;
  let host;
  let path;
  let port = "";
  try {
    if (/^(https?|ssh|git):\/\//i.test(value)) {
      const url = new URL(value);
      if (url.search || url.hash)
        return null;
      host = url.hostname.toLowerCase();
      path = url.pathname;
      port = url.port && !(url.protocol === "ssh:" && url.port === "22" || url.protocol === "git:" && url.port === "9418") ? `:${url.port}` : "";
    } else {
      const scp = /^(?:[^/@:]+@)?([^/:]+):(.+)$/.exec(value);
      if (!scp)
        return null;
      host = scp[1].toLowerCase();
      path = scp[2];
    }
    path = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
    if (!host || !path || path.split("/").some((part) => !part || part === "." || part === "..") || /[%\\?#]/.test(path))
      return null;
    return `${host}${port}/${path.toLowerCase()}`;
  } catch {
    return null;
  }
}
function captureRepoCheckpoint(rootPath, id) {
  const head = gitOutput(rootPath, ["rev-parse", "--verify", "HEAD"]);
  if (!head) {
    return {
      worktree_id: id,
      head_sha: null,
      branch: null,
      dirty: null,
      captured_at: new Date().toISOString()
    };
  }
  const branch = gitOutput(rootPath, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const pathStateBefore = gitBytes(rootPath, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all"
  ]);
  const indexDigest = gitDigest(rootPath, ["ls-files", "-s", "-z"]);
  const trackedState = gitBytes(rootPath, [
    "diff",
    "--no-ext-diff",
    "--binary",
    "HEAD",
    "--"
  ]);
  const untrackedPaths = gitBytes(rootPath, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z"
  ]);
  const untrackedDigest = untrackedPaths.ok ? digestUntrackedContent(rootPath, untrackedPaths.stdout) : null;
  const pathStateAfter = gitBytes(rootPath, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all"
  ]);
  const stablePathState = pathStateBefore.ok && pathStateAfter.ok && pathStateBefore.stdout.equals(pathStateAfter.stdout);
  return {
    worktree_id: id,
    head_sha: /^[0-9a-f]{40,64}$/i.test(head) ? head.toLowerCase() : null,
    branch,
    dirty: pathStateAfter.ok ? pathStateAfter.stdout.length > 0 : null,
    algorithm: "git-state/v1",
    index_sha256: indexDigest,
    state_sha256: trackedState.ok && stablePathState && untrackedDigest ? sha256Bytes(Buffer.concat([
      trackedState.stdout,
      Buffer.from([0]),
      pathStateAfter.stdout,
      Buffer.from([0]),
      Buffer.from(untrackedDigest, "hex")
    ])) : null,
    source: "server_observed",
    captured_at: new Date().toISOString()
  };
}
function inspectSuccessorCommit(rootPath, commitSha, parentSha) {
  const refuse2 = (reason) => ({
    ok: false,
    commit_sha: commitSha,
    reason
  });
  if (!GIT_OBJECT_ID.test(commitSha) || !GIT_OBJECT_ID.test(parentSha)) {
    return refuse2("The checkpoint HEADs are not Git object IDs");
  }
  const commitObject = successorGit(rootPath, ["cat-file", "commit", commitSha]);
  if (!commitObject.ok)
    return refuse2(`Git could not read commit ${commitSha}`);
  const headerEnd = commitObject.stdout.indexOf(`

`);
  const parents = commitObject.stdout.subarray(0, headerEnd === -1 ? commitObject.stdout.length : headerEnd).toString("utf8").split(`
`).filter((line) => line.startsWith("parent ")).map((line) => line.slice("parent ".length));
  if (parents.length > 1) {
    return refuse2(`HEAD ${commitSha} is a merge commit, not one fast-forward commit`);
  }
  if (parents[0] !== parentSha) {
    const descends = successorGitExitCode(rootPath, [
      "merge-base",
      "--is-ancestor",
      parentSha,
      commitSha
    ]) === 0;
    return refuse2(descends ? `HEAD ${commitSha} is more than one commit ahead of the result checkpoint HEAD ${parentSha}` : `HEAD ${commitSha} does not descend from the result checkpoint HEAD ${parentSha}`);
  }
  const diff = successorGit(rootPath, [
    "diff-tree",
    "-r",
    "-z",
    "--raw",
    "--no-renames",
    "--ignore-submodules=none",
    parentSha,
    commitSha,
    "--"
  ]);
  const fields = diff.ok ? splitNul(diff.stdout) : null;
  if (!fields || fields.length % 2 !== 0) {
    return refuse2(`Git could not list the paths commit ${commitSha} changes`);
  }
  if (fields.length / 2 > MAX_SUCCESSOR_PATHS) {
    return refuse2(`Commit ${commitSha} changes more than ${MAX_SUCCESSOR_PATHS} paths`);
  }
  const budget = { bytes: MAX_SUCCESSOR_BYTES, deadline: Date.now() + MAX_SUCCESSOR_INSPECT_MS };
  const changes = [];
  for (let index = 0;index < fields.length; index += 2) {
    const header = RAW_DIFF_HEADER.exec(fields[index].toString("utf8"));
    const pathBytes = fields[index + 1];
    if (!header || !safeGitRelativePath(pathBytes)) {
      return refuse2(`Git reported a change in commit ${commitSha} that cannot be read safely`);
    }
    const path = pathBytes.toString("utf8");
    const [, oldMode, mode, , blob, status] = header;
    const modeVouched = status === "A" || status === "M" && oldMode === mode;
    if (status === "D" || mode !== "100644" && mode !== "100755" || !modeVouched) {
      changes.push({ path, blob_sha256: null });
      continue;
    }
    if (Date.now() > budget.deadline || budget.bytes <= 0) {
      return refuse2(`Inspecting commit ${commitSha} exceeded its bounds`);
    }
    const content = successorGit(rootPath, ["cat-file", "blob", blob], budget.bytes);
    if (!content.ok) {
      return refuse2(`Git could not read the committed bytes of ${path} within the inspection bounds`);
    }
    budget.bytes -= content.stdout.length;
    changes.push({ path, blob_sha256: sha256Bytes(content.stdout) });
  }
  return { ok: true, commit_sha: commitSha, parent_sha: parentSha, changes };
}
var MAX_CITED_FILE_BYTES = 16 * 1024 * 1024;
function worktreeId(rootPath, fingerprint) {
  return `wt_${sha2563(`${rootPath}\x00${fingerprint}`).slice(0, 24)}`;
}
function resolveGitPath(rootPath, value) {
  return value.startsWith("/") ? value : resolve3(rootPath, value);
}
function realpathIfPresent(path) {
  return existsSync3(path) ? realpathSync(path) : resolve3(path);
}
function gitOutput(rootPath, args, options = {}) {
  const result = runGit(rootPath, args, options);
  if (result.timed_out && options.deadline !== undefined)
    throw new RepositoryProbeTimeout;
  if (!result.ok)
    return null;
  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
}
function runGit(rootPath, args, options) {
  const timeout = gitTimeout(options);
  if (timeout <= 0)
    return { ok: false, timed_out: true, stdout: "" };
  const result = spawnRepositoryGit(["-C", rootPath, ...args], {
    encoding: "utf8",
    timeout,
    maxBuffer: MAX_GIT_OUTPUT,
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }
  }, options);
  return {
    ok: result.status === 0 && !result.error,
    timed_out: result.error?.code === "ETIMEDOUT",
    stdout: typeof result.stdout === "string" ? result.stdout : ""
  };
}
function gitDigest(rootPath, args) {
  const result = gitBytes(rootPath, args);
  return result.ok ? sha256Bytes(result.stdout) : null;
}
function gitBytes(rootPath, args, maxBuffer = MAX_GIT_OUTPUT) {
  const result = spawnSync("git", ["-C", rootPath, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer,
    stdio: ["ignore", "pipe", "ignore"]
  });
  return {
    ok: result.status === 0 && !result.error,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0)
  };
}
var SUCCESSOR_GIT_ARGS = ["-c", "core.commitGraph=false", "--no-replace-objects"];
function successorGitEnv() {
  return { ...process.env, GIT_GRAFT_FILE: "/dev/null/agenttool-collab-no-grafts" };
}
function successorGit(rootPath, args, maxBuffer = MAX_GIT_OUTPUT, options = {}) {
  const timeout = gitTimeout(options);
  if (timeout <= 0)
    return { ok: false, timed_out: true, stdout: Buffer.alloc(0) };
  const result = spawnRepositoryGit(["-C", rootPath, ...SUCCESSOR_GIT_ARGS, ...args], {
    timeout,
    maxBuffer,
    stdio: ["ignore", "pipe", "ignore"],
    env: successorGitEnv()
  }, options);
  return {
    ok: result.status === 0 && !result.error,
    timed_out: result.error?.code === "ETIMEDOUT",
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0)
  };
}
function spawnRepositoryGit(args, options, probe) {
  return probe.spawn ? probe.spawn(args, options) : spawnSync("git", args, options);
}
function gitTimeout(options) {
  return options.deadline === undefined ? GIT_TIMEOUT_MS : Math.min(GIT_TIMEOUT_MS, Math.ceil(options.deadline - (options.now ?? (() => performance.now()))()));
}
function successorGitExitCode(rootPath, args) {
  const result = spawnSync("git", ["-C", rootPath, ...SUCCESSOR_GIT_ARGS, ...args], {
    timeout: GIT_TIMEOUT_MS,
    stdio: ["ignore", "ignore", "ignore"],
    env: successorGitEnv()
  });
  return result.error ? null : result.status;
}
function digestUntrackedContent(rootPath, paths) {
  const entries = splitNul(paths);
  if (!entries || entries.length > MAX_UNTRACKED_FILES)
    return null;
  const budget = {
    remainingBytes: MAX_UNTRACKED_BYTES,
    deadline: Date.now() + MAX_UNTRACKED_HASH_MS
  };
  const aggregate = createHash4("sha256");
  aggregate.update("agenttool.collab/untracked-state/v1\x00");
  for (const entry of entries) {
    if (Date.now() > budget.deadline)
      return null;
    if (!safeGitRelativePath(entry))
      return null;
    const absolute = Buffer.concat([
      Buffer.from(rootPath),
      Buffer.from("/"),
      entry
    ]);
    let stat;
    try {
      stat = lstatSync3(absolute);
      aggregate.update(lengthPrefix(entry.length));
      aggregate.update(entry);
      if (stat.isSymbolicLink()) {
        const target = readlinkSync(absolute, { encoding: "buffer" });
        if (target.length > budget.remainingBytes || Date.now() > budget.deadline) {
          return null;
        }
        budget.remainingBytes -= target.length;
        aggregate.update("symlink\x00");
        aggregate.update(lengthPrefix(target.length));
        aggregate.update(target);
      } else if (stat.isFile()) {
        const digest = digestStableFile(absolute, budget);
        if (!digest)
          return null;
        aggregate.update("file\x00");
        aggregate.update(lengthPrefix(stat.mode & 73));
        aggregate.update(digest);
      } else {
        return null;
      }
    } catch {
      return null;
    }
  }
  return aggregate.digest("hex");
}
function digestStableFile(path, budget) {
  let descriptor = null;
  try {
    descriptor = openSync3(path, "r");
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size > budget.remainingBytes || Date.now() > budget.deadline)
      return null;
    const hash = createHash4("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    while (true) {
      if (Date.now() > budget.deadline)
        return null;
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0)
        break;
      hash.update(buffer.subarray(0, count));
    }
    const after = fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mode !== after.mode || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
      return null;
    budget.remainingBytes -= before.size;
    return hash.digest();
  } catch {
    return null;
  } finally {
    if (descriptor !== null)
      closeSync3(descriptor);
  }
}
function splitNul(value) {
  if (value.length === 0)
    return [];
  const entries = [];
  let start = 0;
  for (let index = 0;index < value.length; index += 1) {
    if (value[index] !== 0)
      continue;
    if (index === start)
      return null;
    entries.push(value.subarray(start, index));
    start = index + 1;
  }
  return start === value.length ? entries : null;
}
function safeGitRelativePath(value) {
  if (value.length === 0 || value[0] === 47)
    return false;
  let start = 0;
  for (let index = 0;index <= value.length; index += 1) {
    if (index !== value.length && value[index] !== 47)
      continue;
    const component = value.subarray(start, index);
    if (component.length === 0 || component.length === 1 && component[0] === 46 || component.length === 2 && component[0] === 46 && component[1] === 46)
      return false;
    start = index + 1;
  }
  return true;
}
function lengthPrefix(value) {
  const prefix = Buffer.allocUnsafe(8);
  prefix.writeBigUInt64BE(BigInt(value));
  return prefix;
}
function sha2563(value) {
  return createHash4("sha256").update(value).digest("hex");
}
function sha256Bytes(value) {
  return createHash4("sha256").update(value).digest("hex");
}

// src/store.ts
var GENESIS_HASH = "0".repeat(64);
var APPLICATION_ID = 1096041292;
var HARDENED_PREVIEW_SCHEMA_VERSION = 2;
var SCHEMA_VERSION = 3;
var DEFAULT_LEASE_SECONDS = 15 * 60;
var MAX_LEASE_SECONDS = 60 * 60;
var REPOSITORY_DISCOVERY_MS = 250;
var MAX_TEXT = 8000;
var MAX_REPORT_BODY = 9000;
var MAX_DEPENDENCIES = 128;
var MAX_PATH_SCOPES = 128;
var MAX_PATH_SCOPE_LENGTH = 500;
var MAX_PATH_SCOPES_TOTAL = 16000;
var MAX_REPORT_REFS = 128;
var MAX_REPORT_REF_LENGTH = 2000;
var DEFAULT_PRESENCE_SECONDS = 2 * 60;
var MAX_PRESENCE_SECONDS = 60 * 60;
var MAX_SESSION_CAPABILITIES = 32;
var MAX_SESSION_CAPABILITY_LENGTH = 100;
var DEFAULT_SESSION_LIST_LIMIT = 100;
var MAX_SESSION_LIST_LIMIT = 500;
var DEFAULT_NEXT_EVENT_LIMIT = 50;
var MAX_NEXT_EVENT_LIMIT = 50;
var SESSION_TOKEN_BYTES = 32;
var SESSION_END_RECOVERY_NOTE = "collab_session_end with release_leases released this expired lease from its own session";
var PRESENCE_SESSION_COLUMNS = [
  "id",
  "workspace_id",
  "epoch_id",
  "client_instance_id",
  "actor_label",
  "actor_key",
  "runtime_kind",
  "provider_label",
  "model_label",
  "declared_capabilities_json",
  "version",
  "joined_at",
  "last_seen_at",
  "presence_expires_at",
  "left_at"
];
var COORDINATION_SESSION_COLUMNS = [
  "id",
  "workspace_id",
  "worktree_id",
  "actor",
  "role",
  "parent_session_id",
  "status",
  "generation",
  "token_hash",
  "joined_at",
  "last_seen_at",
  "ended_at",
  "cursor_epoch_id",
  "cursor_sequence",
  "cursor_hash",
  "cursor_version",
  "reset_generation",
  "cursor_recovery_required"
];
var SQLITE_BUSY_RETRY_MS = 15000;
var V2_GUARD_TRIGGERS = [
  "tasks_v2_insert_guard",
  "tasks_v2_update_guard",
  "tasks_v2_delete_guard",
  "artifacts_v2_insert_guard",
  "handoffs_v2_insert_guard"
];

class CollabStoreCore {
  db;
  now;
  filesystemPath;
  migrationFailpoint;
  revealFailpoint;
  repositoryDiscovery;
  eventReader;
  closed = false;
  ambientReceiptPlan = null;
  constructor(path, options = {}) {
    this.now = options.now ?? (() => new Date);
    this.migrationFailpoint = options.migration_failpoint;
    this.revealFailpoint = options.reveal_failpoint;
    this.repositoryDiscovery = {
      ...options.repository_discovery,
      budget_ms: options.repository_discovery?.budget_ms ?? REPOSITORY_DISCOVERY_MS,
      now: options.repository_discovery?.now ?? (() => performance.now())
    };
    const databasePath = path === ":memory:" ? path : resolve4(path);
    if (databasePath !== ":memory:") {
      const parent = dirname3(databasePath);
      const parentAlreadyExisted = existsSync4(parent);
      mkdirSync3(parent, { recursive: true, mode: 448 });
      if (!parentAlreadyExisted)
        chmodSync3(parent, 448);
      if (existsSync4(databasePath)) {
        assertSafeDatabaseFile(databasePath);
      } else {
        try {
          const descriptor = openSync4(databasePath, "wx", 384);
          closeSync4(descriptor);
        } catch (error) {
          if (error.code !== "EEXIST")
            throw error;
          assertSafeDatabaseFile(databasePath);
        }
      }
      this.filesystemPath = databasePath;
    }
    this.db = new Database(databasePath, { create: true, strict: true });
    try {
      this.db.exec("PRAGMA busy_timeout = 5000");
      this.preflightDatabase();
      this.initialize();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close() {
    this.closed = true;
    this.eventReader?.close();
    this.eventReader = undefined;
    this.db.close();
  }
  nonblockingEventReader() {
    if (this.closed)
      throw new CollabError("store_closed", "The collaboration store is closed");
    if (!this.filesystemPath) {
      if (this.db.inTransaction) {
        throw new CollabError("event_read_busy", "Finish the active transaction before observing events");
      }
      return this.db;
    }
    if (!this.eventReader) {
      const reader = new Database(this.filesystemPath, { readonly: true, strict: true });
      try {
        reader.exec("PRAGMA busy_timeout = 0; PRAGMA query_only = ON");
        this.eventReader = reader;
      } catch (error) {
        reader.close();
        throw error;
      }
    }
    return this.eventReader;
  }
  defaultSessionCredentialPath(sessionId) {
    if (!this.filesystemPath) {
      throw new CollabError("session_file_path_required", "An explicit credential file path is required for an in-memory database");
    }
    const id = validateId(sessionId, "session_id");
    return join3(dirname3(this.filesystemPath), "collab-sessions", `${id}.json`);
  }
  initialize() {
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    const legacyPreparation = this.prepareLegacyMigration();
    const migrate = this.db.transaction(() => {
      const applicationId = pragmaNumber(this.db, "application_id");
      const userVersion = pragmaNumber(this.db, "user_version");
      if (applicationId !== 0 && applicationId !== APPLICATION_ID) {
        throw new CollabError("database_application_mismatch", "The SQLite file belongs to another application", { expected_application_id: APPLICATION_ID, actual_application_id: applicationId });
      }
      if (userVersion > SCHEMA_VERSION) {
        throw new CollabError("database_version_too_new", "The collaboration database was created by a newer package version", { supported_schema_version: SCHEMA_VERSION, actual_schema_version: userVersion });
      }
      const tables = this.tableNames();
      if (tables.length === 0) {
        this.createLegacySchema();
        this.migrationFailpoint?.("legacy_schema_created");
      } else {
        this.validateLegacyOrV2Shape(userVersion);
      }
      const versionAfterLock = pragmaNumber(this.db, "user_version");
      if (versionAfterLock < HARDENED_PREVIEW_SCHEMA_VERSION) {
        this.migrateToV2(legacyPreparation);
      } else if (versionAfterLock === HARDENED_PREVIEW_SCHEMA_VERSION) {
        this.migrateHardenedPreviewToV3();
      }
      this.validateV2Shape("coordination_sessions", [
        HARDENED_PREVIEW_SCHEMA_VERSION,
        SCHEMA_VERSION
      ]);
      this.validateAllJournals();
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS repository_aliases (
          worktree_id TEXT PRIMARY KEY REFERENCES worktrees(id),
          portable_key TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS repository_aliases_key_idx ON repository_aliases(portable_key);
        CREATE TABLE IF NOT EXISTS repository_discovery (
          worktree_id TEXT PRIMARY KEY REFERENCES worktrees(id),
          fingerprint TEXT NOT NULL,
          outcome TEXT NOT NULL CHECK (outcome IN ('checked', 'unresolvable'))
        );
        CREATE TABLE IF NOT EXISTS session_lease_lapses (
          lease_id TEXT PRIMARY KEY,
          effective_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS proposal_terms (
          report_id TEXT PRIMARY KEY REFERENCES reports(id),
          workspace_id TEXT NOT NULL REFERENCES workspaces(id),
          rule TEXT NOT NULL,
          criteria TEXT NOT NULL,
          extent TEXT NOT NULL,
          known_conflicts TEXT,
          origin TEXT NOT NULL CHECK (origin IN ('ai', 'person_relayed')),
          topic TEXT,
          closes_at TEXT NOT NULL,
          voices_json TEXT NOT NULL,
          author_voice_id TEXT NOT NULL,
          proposal_sha256 TEXT NOT NULL,
          opened_event_id TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS proposal_terms_workspace_idx
          ON proposal_terms(workspace_id, created_at);
        CREATE TABLE IF NOT EXISTS proposal_person_acts (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id),
          proposal_report_id TEXT NOT NULL REFERENCES proposal_terms(report_id),
          proposal_sha256 TEXT NOT NULL,
          act TEXT NOT NULL CHECK (act IN ('agree', 'reject')),
          party TEXT NOT NULL CHECK (party IN ('person')),
          basis TEXT NOT NULL CHECK (basis IN ('relayed_by_session', 'controlling_terminal', 'user_verified_passkey')),
          reason TEXT,
          -- No foreign key: additive tables never reference the session table,
          -- which the schema-2 preview upgrade renames.
          relayed_by_session_id TEXT,
          ai_snapshot_json TEXT NOT NULL,
          proof_json TEXT,
          created_at TEXT NOT NULL,
          event_sequence INTEGER NOT NULL,
          CHECK (act = 'reject' OR basis <> 'relayed_by_session')
        );
        CREATE INDEX IF NOT EXISTS proposal_person_acts_proposal_idx
          ON proposal_person_acts(proposal_report_id, event_sequence);
        CREATE TABLE IF NOT EXISTS person_passkeys (
          credential_id TEXT PRIMARY KEY,
          public_key_spki TEXT NOT NULL,
          algorithm INTEGER NOT NULL CHECK (algorithm = -7),
          rp_id TEXT NOT NULL,
          origin TEXT NOT NULL,
          label TEXT,
          fingerprint TEXT NOT NULL,
          sign_count INTEGER NOT NULL DEFAULT 0,
          enrolled_at TEXT NOT NULL,
          revoked_at TEXT
        );
        CREATE TABLE IF NOT EXISTS person_addressed_reports (
          report_id TEXT PRIMARY KEY REFERENCES reports(id),
          workspace_id TEXT NOT NULL REFERENCES workspaces(id)
        );
        CREATE TABLE IF NOT EXISTS session_parent_attestations (
          session_id TEXT PRIMARY KEY,
          parent_session_id TEXT NOT NULL,
          basis TEXT NOT NULL CHECK (basis IN ('same_mcp_process')),
          attested_at TEXT NOT NULL
        );
        -- Collab Notes view state (spec 8.1): what the notes surface last showed
        -- each session. Never journaled and never cited, so it can be lost or
        -- rebuilt without harm; no foreign keys, so older builds never see it.
        CREATE TABLE IF NOT EXISTS note_marks (
          workspace_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          shown_through_sequence INTEGER NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (workspace_id, session_id)
        );
        CREATE TABLE IF NOT EXISTS note_shown (
          workspace_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          item_id TEXT NOT NULL,
          shown_at TEXT NOT NULL,
          PRIMARY KEY (workspace_id, session_id, item_id)
        );
        -- Which ballots may still need a reveal, so housekeeping finds due
        -- ones without scanning events. state is open or closed.
        CREATE TABLE IF NOT EXISTS note_ballots (
          workspace_id TEXT NOT NULL,
          ballot_id TEXT NOT NULL,
          closes_at TEXT NOT NULL,
          state TEXT NOT NULL,
          PRIMARY KEY (workspace_id, ballot_id)
        );
        CREATE INDEX IF NOT EXISTS note_ballots_state_idx ON note_ballots(workspace_id, state, closes_at);
        -- consent/v2 set-asides: one row per proposal.challenge_set_aside
        -- event, rebuilt from those events on every open, so losing it loses
        -- nothing the journal records. No foreign keys; older builds ignore it.
        CREATE TABLE IF NOT EXISTS proposal_set_asides (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL,
          proposal_report_id TEXT NOT NULL,
          challenge_report_id TEXT NOT NULL,
          set_aside_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          event_sequence INTEGER NOT NULL,
          UNIQUE (workspace_id, challenge_report_id)
        );
        CREATE INDEX IF NOT EXISTS proposal_set_asides_proposal_idx
          ON proposal_set_asides(workspace_id, proposal_report_id, event_sequence);
      `);
      this.db.exec(`
        INSERT OR IGNORE INTO note_ballots (workspace_id, ballot_id, closes_at, state)
        SELECT workspace_id, entity_id, json_extract(payload_json, '$.closes_at'), 'open' FROM events
        WHERE type = 'ballot.opened' AND json_type(payload_json, '$.closes_at') = 'text';
        UPDATE note_ballots SET state = 'closed' WHERE state <> 'closed' AND EXISTS (
          SELECT 1 FROM events e WHERE e.workspace_id = note_ballots.workspace_id
            AND e.type = 'ballot.closed' AND e.entity_id = note_ballots.ballot_id
        );
        INSERT OR IGNORE INTO proposal_set_asides (
          id, workspace_id, proposal_report_id, challenge_report_id, set_aside_json, created_at, event_sequence
        )
        SELECT json_extract(payload_json, '$.set_aside.id'), workspace_id, entity_id,
          json_extract(payload_json, '$.set_aside.challenge_report_id'), json_extract(payload_json, '$.set_aside'),
          occurred_at, sequence
        FROM events
        WHERE type = 'proposal.challenge_set_aside'
          AND json_type(payload_json, '$.set_aside.id') = 'text'
          AND json_type(payload_json, '$.set_aside.challenge_report_id') = 'text'
        ORDER BY workspace_id, sequence;
      `);
      if (this.tableNames().includes("proposal_rejections") && this.db.query(`SELECT 1 FROM proposal_rejections LIMIT 1`).get()) {
        throw new CollabError("preview_journal_unsupported", "This journal holds rejections from the unreleased consent preview; use a fresh journal");
      }
      this.db.exec(`PRAGMA application_id = ${APPLICATION_ID}`);
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
    retrySqliteBusy(() => migrate.immediate());
    if (this.db.filename !== ":memory:") {
      retrySqliteBusy(() => this.db.exec("PRAGMA journal_mode = WAL"));
    }
    this.tightenFileModes();
  }
  preflightDatabase() {
    const applicationId = pragmaNumber(this.db, "application_id");
    const userVersion = pragmaNumber(this.db, "user_version");
    if (applicationId !== 0 && applicationId !== APPLICATION_ID) {
      throw new CollabError("database_application_mismatch", "The SQLite file belongs to another application", { expected_application_id: APPLICATION_ID, actual_application_id: applicationId });
    }
    if (userVersion > SCHEMA_VERSION) {
      throw new CollabError("database_version_too_new", "The collaboration database was created by a newer package version", { supported_schema_version: SCHEMA_VERSION, actual_schema_version: userVersion });
    }
    if (this.tableNames().length > 0) {
      this.validateLegacyOrV2Shape(userVersion);
      if (userVersion >= HARDENED_PREVIEW_SCHEMA_VERSION) {
        this.db.transaction(() => this.validateAllJournals()).deferred();
      }
    }
  }
  prepareLegacyMigration() {
    if (this.tableNames().length === 0 || pragmaNumber(this.db, "user_version") >= HARDENED_PREVIEW_SCHEMA_VERSION)
      return [];
    const workspaces = this.db.query(`
      SELECT id, root_path FROM workspaces ORDER BY id
    `).all();
    const prepared = workspaces.map((workspace) => ({
      ...workspace,
      identity: safeRepositoryIdentity(workspace.root_path)
    }));
    assertDistinctLegacyWorktreeIdentities(prepared);
    return prepared;
  }
  createLegacySchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        epoch_id TEXT NOT NULL,
        root_path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        event_head_sequence INTEGER NOT NULL DEFAULT 0,
        event_head_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT NOT NULL,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL CHECK(status IN ('open', 'claimed', 'blocked', 'completed')),
        dependencies_json TEXT NOT NULL,
        path_scopes_json TEXT NOT NULL,
        assignee TEXT,
        lease_id TEXT,
        lease_expires_at TEXT,
        blocker TEXT,
        latest_progress TEXT,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE INDEX IF NOT EXISTS tasks_workspace_status_idx
        ON tasks(workspace_id, status, lease_expires_at);
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('file', 'commit', 'test', 'data', 'url', 'other')),
        uri TEXT NOT NULL,
        sha256 TEXT,
        media_type TEXT,
        label TEXT,
        attached_by TEXT NOT NULL,
        attached_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id, task_id) REFERENCES tasks(workspace_id, id)
      );
      CREATE INDEX IF NOT EXISTS artifacts_task_idx ON artifacts(workspace_id, task_id, attached_at);
      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        topic TEXT NOT NULL,
        decision TEXT NOT NULL,
        rationale TEXT,
        recorded_by TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS decisions_workspace_idx ON decisions(workspace_id, recorded_at);
      CREATE TABLE IF NOT EXISTS handoffs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        from_actor TEXT NOT NULL,
        to_actor TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'declined', 'expired')),
        offered_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        resolved_at TEXT,
        FOREIGN KEY (workspace_id, task_id) REFERENCES tasks(workspace_id, id)
      );
      CREATE INDEX IF NOT EXISTS handoffs_target_idx
        ON handoffs(workspace_id, to_actor, status, expires_at);
      CREATE TABLE IF NOT EXISTS events (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        epoch_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        id TEXT NOT NULL UNIQUE,
        protocol TEXT NOT NULL,
        type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        actor TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        prev_hash TEXT NOT NULL,
        hash TEXT NOT NULL,
        PRIMARY KEY (workspace_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS mutations (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        actor TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        operation TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, actor, idempotency_key)
      );
    `);
  }
  migrateToV2(preparedWorkspaces) {
    if (this.hasColumn("workspaces", "repository_key")) {
      throw new CollabError("database_partial_migration", "The collaboration database has v0.2 columns without a committed schema version");
    }
    const journalHeads = this.db.query(`
      SELECT id, epoch_id, event_head_sequence, event_head_hash
      FROM workspaces ORDER BY id
    `).all();
    const currentWorkspaces = this.db.query(`
      SELECT id, root_path FROM workspaces ORDER BY id
    `).all();
    if (canonicalJson(currentWorkspaces) !== canonicalJson(preparedWorkspaces.map(({ id, root_path }) => ({ id, root_path })))) {
      throw new CollabError("migration_source_changed", "Legacy workspace roots changed while migration identities were prepared; retry startup");
    }
    const identities = new Map(preparedWorkspaces.map((workspace) => [workspace.id, workspace.identity]));
    this.db.exec(`
      ALTER TABLE workspaces
        ADD COLUMN repository_key TEXT NOT NULL DEFAULT '';

      ALTER TABLE tasks
        ADD COLUMN coordination_mode TEXT NOT NULL DEFAULT 'legacy_v1'
        CHECK(coordination_mode IN ('legacy_v1', 'session_v2'));
      ALTER TABLE tasks
        ADD COLUMN work_mode TEXT NOT NULL DEFAULT 'coordination'
        CHECK(work_mode IN ('coordination', 'read_only', 'edit'));
      ALTER TABLE tasks
        ADD COLUMN completion_policy TEXT NOT NULL DEFAULT 'reported'
        CHECK(completion_policy IN ('reported', 'accepted'));
      ALTER TABLE tasks
        ADD COLUMN review_status TEXT NOT NULL DEFAULT 'legacy_unreviewed'
        CHECK(review_status IN ('legacy_unreviewed', 'not_required', 'pending', 'accepted', 'changes_requested'));
      ALTER TABLE tasks ADD COLUMN review_generation INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE tasks ADD COLUMN expected_base_sha TEXT;
      ALTER TABLE tasks ADD COLUMN base_checkpoint_json TEXT;
      ALTER TABLE tasks ADD COLUMN result_checkpoint_json TEXT;
      ALTER TABLE tasks ADD COLUMN completion_report_id TEXT;
      ALTER TABLE tasks ADD COLUMN assignee_session_id TEXT;
      ALTER TABLE tasks ADD COLUMN claim_worktree_id TEXT;
      ALTER TABLE tasks ADD COLUMN reported_by TEXT;
      ALTER TABLE tasks ADD COLUMN reported_by_session_id TEXT;
      ALTER TABLE tasks ADD COLUMN reported_at TEXT;
      ALTER TABLE tasks ADD COLUMN accepted_by TEXT;
      ALTER TABLE tasks ADD COLUMN accepted_by_session_id TEXT;
      ALTER TABLE tasks ADD COLUMN accepted_at TEXT;

      ALTER TABLE artifacts ADD COLUMN attached_by_session_id TEXT;
      ALTER TABLE handoffs ADD COLUMN from_session_id TEXT;
      ALTER TABLE handoffs ADD COLUMN to_session_id TEXT;
      ALTER TABLE events ADD COLUMN session_id TEXT;

      CREATE TABLE repositories (
        key TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );
      CREATE TABLE worktrees (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        repository_key TEXT NOT NULL REFERENCES repositories(key),
        root_path TEXT NOT NULL UNIQUE,
        git_common_dir_hash TEXT,
        fingerprint TEXT NOT NULL,
        branch TEXT,
        head_sha TEXT,
        dirty INTEGER,
        registered_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE INDEX worktrees_repository_idx
        ON worktrees(repository_key, workspace_id);

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        epoch_id TEXT NOT NULL,
        client_instance_id TEXT NOT NULL,
        actor_label TEXT NOT NULL,
        actor_key TEXT NOT NULL UNIQUE,
        runtime_kind TEXT NOT NULL,
        provider_label TEXT,
        model_label TEXT,
        declared_capabilities_json TEXT NOT NULL,
        version INTEGER NOT NULL,
        joined_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        presence_expires_at TEXT NOT NULL,
        left_at TEXT,
        UNIQUE (workspace_id, client_instance_id)
      );
      CREATE INDEX IF NOT EXISTS sessions_workspace_presence_idx
        ON sessions(workspace_id, left_at, presence_expires_at);

      CREATE TABLE coordination_sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        worktree_id TEXT NOT NULL REFERENCES worktrees(id),
        actor TEXT NOT NULL,
        role TEXT,
        parent_session_id TEXT REFERENCES coordination_sessions(id),
        status TEXT NOT NULL CHECK(status IN ('active', 'ended')),
        generation INTEGER NOT NULL,
        token_hash TEXT NOT NULL,
        joined_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        ended_at TEXT,
        cursor_epoch_id TEXT NOT NULL,
        cursor_sequence INTEGER NOT NULL,
        cursor_hash TEXT NOT NULL,
        cursor_version INTEGER NOT NULL DEFAULT 0,
        reset_generation INTEGER NOT NULL DEFAULT 0,
        cursor_recovery_required INTEGER NOT NULL DEFAULT 0
          CHECK(cursor_recovery_required IN (0, 1))
      );
      CREATE INDEX coordination_sessions_workspace_status_idx
        ON coordination_sessions(workspace_id, status, last_seen_at);

      CREATE TABLE reports (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        task_id TEXT,
        from_session_id TEXT REFERENCES coordination_sessions(id),
        from_actor TEXT NOT NULL,
        to_session_id TEXT REFERENCES coordination_sessions(id),
        kind TEXT NOT NULL CHECK(kind IN ('observation', 'inference', 'proposal', 'decision')),
        body TEXT NOT NULL,
        evidence_refs_json TEXT NOT NULL,
        confidence TEXT NOT NULL CHECK(confidence IN ('high', 'medium', 'low', 'unknown')),
        confidence_basis TEXT,
        limits TEXT,
        relation TEXT NOT NULL CHECK(relation IN ('informs', 'supports', 'challenges', 'corrects', 'withdraws', 'supersedes', 'resolves')),
        target_report_id TEXT REFERENCES reports(id),
        authority_scope TEXT,
        authority_basis TEXT,
        created_at TEXT NOT NULL,
        event_sequence INTEGER NOT NULL,
        FOREIGN KEY (workspace_id, task_id) REFERENCES tasks(workspace_id, id)
      );
      CREATE INDEX reports_workspace_event_idx
        ON reports(workspace_id, event_sequence);
      CREATE INDEX reports_target_idx ON reports(target_report_id);

      CREATE TABLE task_reviews (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        review_generation INTEGER NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('accepted', 'changes_requested')),
        summary TEXT NOT NULL,
        reviewer_actor TEXT NOT NULL,
        reviewer_session_id TEXT NOT NULL REFERENCES coordination_sessions(id),
        created_at TEXT NOT NULL,
        event_sequence INTEGER NOT NULL,
        UNIQUE(workspace_id, task_id, review_generation),
        FOREIGN KEY (workspace_id, task_id) REFERENCES tasks(workspace_id, id)
      );

      CREATE TABLE task_recoveries (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        prior_lease_id TEXT NOT NULL,
        prior_session_id TEXT,
        recovered_by_session_id TEXT NOT NULL REFERENCES coordination_sessions(id),
        action TEXT NOT NULL CHECK(action IN ('takeover', 'release', 'block')),
        note TEXT NOT NULL,
        prior_checkpoint_json TEXT,
        new_lease_id TEXT,
        recovered_at TEXT NOT NULL,
        event_sequence INTEGER NOT NULL,
        UNIQUE(workspace_id, task_id, prior_lease_id),
        FOREIGN KEY (workspace_id, task_id) REFERENCES tasks(workspace_id, id)
      );

      CREATE TABLE session_cursor_resets (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES coordination_sessions(id),
        from_epoch_id TEXT NOT NULL,
        from_sequence INTEGER NOT NULL,
        from_hash TEXT NOT NULL,
        to_epoch_id TEXT NOT NULL,
        to_sequence INTEGER NOT NULL,
        to_hash TEXT NOT NULL,
        reason TEXT NOT NULL,
        reset_generation INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE v2_write_guard (
        nonce TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL CHECK(enabled = 1)
      );

      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        protocol TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    this.migrationFailpoint?.("v2_tables_created");
    const now = this.timestamp();
    const workspaces = this.db.query(`
      SELECT id, root_path FROM workspaces ORDER BY created_at, id
    `).all();
    for (const workspace of workspaces) {
      const identity = identities.get(workspace.id);
      if (!identity) {
        throw new CollabError("migration_identity_missing", "A prepared legacy repository identity is missing", { workspace_id: workspace.id });
      }
      this.db.query(`INSERT OR IGNORE INTO repositories (key, created_at) VALUES (?, ?)`).run(identity.repository_key, now);
      this.db.query(`UPDATE workspaces SET repository_key = ? WHERE id = ?`).run(identity.repository_key, workspace.id);
      this.db.query(`
        INSERT INTO worktrees (
          id, workspace_id, repository_key, root_path, git_common_dir_hash, fingerprint,
          branch, head_sha, dirty, registered_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(identity.checkpoint.worktree_id, workspace.id, identity.repository_key, identity.root_path, identity.git_common_dir_hash, identity.worktree_fingerprint, identity.checkpoint.branch, identity.checkpoint.head_sha, booleanToSql(identity.checkpoint.dirty), now, now);
    }
    this.migrationFailpoint?.("v1_rows_backfilled");
    this.db.exec(`
      CREATE INDEX workspaces_repository_idx ON workspaces(repository_key);

      CREATE TRIGGER tasks_v2_insert_guard
      BEFORE INSERT ON tasks
      WHEN NEW.coordination_mode = 'session_v2'
        AND NOT EXISTS (SELECT 1 FROM v2_write_guard WHERE enabled = 1)
      BEGIN
        SELECT RAISE(ABORT, 'agenttool_collab_v2_write_requires_v2_client');
      END;

      CREATE TRIGGER tasks_v2_update_guard
      BEFORE UPDATE ON tasks
      WHEN (OLD.coordination_mode = 'session_v2' OR NEW.coordination_mode = 'session_v2')
        AND NOT EXISTS (SELECT 1 FROM v2_write_guard WHERE enabled = 1)
      BEGIN
        SELECT RAISE(ABORT, 'agenttool_collab_v2_write_requires_v2_client');
      END;

      CREATE TRIGGER tasks_v2_delete_guard
      BEFORE DELETE ON tasks
      WHEN OLD.coordination_mode = 'session_v2'
        AND NOT EXISTS (SELECT 1 FROM v2_write_guard WHERE enabled = 1)
      BEGIN
        SELECT RAISE(ABORT, 'agenttool_collab_v2_write_requires_v2_client');
      END;

      CREATE TRIGGER artifacts_v2_insert_guard
      BEFORE INSERT ON artifacts
      WHEN EXISTS (
        SELECT 1 FROM tasks
        WHERE workspace_id = NEW.workspace_id AND id = NEW.task_id
          AND coordination_mode = 'session_v2'
      )
        AND NOT EXISTS (SELECT 1 FROM v2_write_guard WHERE enabled = 1)
      BEGIN
        SELECT RAISE(ABORT, 'agenttool_collab_v2_write_requires_v2_client');
      END;

      CREATE TRIGGER handoffs_v2_insert_guard
      BEFORE INSERT ON handoffs
      WHEN EXISTS (
        SELECT 1 FROM tasks
        WHERE workspace_id = NEW.workspace_id AND id = NEW.task_id
          AND coordination_mode = 'session_v2'
      )
        AND NOT EXISTS (SELECT 1 FROM v2_write_guard WHERE enabled = 1)
      BEGIN
        SELECT RAISE(ABORT, 'agenttool_collab_v2_write_requires_v2_client');
      END;
    `);
    this.migrationFailpoint?.("v2_guards_created");
    const headsAfter = this.db.query(`
      SELECT id, epoch_id, event_head_sequence, event_head_hash
      FROM workspaces ORDER BY id
    `).all();
    if (canonicalJson(headsAfter) !== canonicalJson(journalHeads)) {
      throw new CollabError("migration_journal_changed", "Migration attempted to change a pre-existing journal head");
    }
    const foreignKeyFailures = this.db.query(`PRAGMA foreign_key_check`).all();
    if (foreignKeyFailures.length > 0) {
      throw new CollabError("migration_foreign_key_failure", "Migration would leave invalid foreign-key references", { failures: foreignKeyFailures.length });
    }
    const integrity = this.db.query(`PRAGMA integrity_check`).get();
    if (integrity.integrity_check !== "ok") {
      throw new CollabError("migration_integrity_failure", "SQLite integrity verification failed during migration");
    }
    const insertMigration = this.db.query(`
      INSERT INTO schema_migrations (version, protocol, applied_at)
      VALUES (?, ?, ?)
    `);
    insertMigration.run(HARDENED_PREVIEW_SCHEMA_VERSION, COLLAB_COORDINATION_PROTOCOL, now);
    insertMigration.run(SCHEMA_VERSION, COLLAB_COORDINATION_PROTOCOL, now);
    this.migrationFailpoint?.("v2_verified");
  }
  migrateHardenedPreviewToV3() {
    this.validateV2Shape("sessions", [HARDENED_PREVIEW_SCHEMA_VERSION]);
    const journalHeads = this.db.query(`
      SELECT id, epoch_id, event_head_sequence, event_head_hash
      FROM workspaces ORDER BY id
    `).all();
    const sessionRows = this.db.query(`
      SELECT * FROM sessions ORDER BY id
    `).all();
    this.db.exec(`
      ALTER TABLE sessions RENAME TO coordination_sessions;
      DROP INDEX sessions_workspace_status_idx;
      CREATE INDEX coordination_sessions_workspace_status_idx
        ON coordination_sessions(workspace_id, status, last_seen_at);

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        epoch_id TEXT NOT NULL,
        client_instance_id TEXT NOT NULL,
        actor_label TEXT NOT NULL,
        actor_key TEXT NOT NULL UNIQUE,
        runtime_kind TEXT NOT NULL,
        provider_label TEXT,
        model_label TEXT,
        declared_capabilities_json TEXT NOT NULL,
        version INTEGER NOT NULL,
        joined_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        presence_expires_at TEXT NOT NULL,
        left_at TEXT,
        UNIQUE (workspace_id, client_instance_id)
      );
      CREATE INDEX sessions_workspace_presence_idx
        ON sessions(workspace_id, left_at, presence_expires_at);
    `);
    this.migrationFailpoint?.("v3_session_planes_created");
    const migratedRows = this.db.query(`
      SELECT * FROM coordination_sessions ORDER BY id
    `).all();
    if (canonicalJson(migratedRows) !== canonicalJson(sessionRows)) {
      throw new CollabError("migration_session_rows_changed", "Credential-bound preview session rows changed during the v0.3 table rename");
    }
    const headsAfter = this.db.query(`
      SELECT id, epoch_id, event_head_sequence, event_head_hash
      FROM workspaces ORDER BY id
    `).all();
    if (canonicalJson(headsAfter) !== canonicalJson(journalHeads)) {
      throw new CollabError("migration_journal_changed", "Migration attempted to change a pre-existing journal head");
    }
    this.db.query(`
      INSERT INTO schema_migrations (version, protocol, applied_at)
      VALUES (?, ?, ?)
    `).run(SCHEMA_VERSION, COLLAB_COORDINATION_PROTOCOL, this.timestamp());
    if (this.db.query("PRAGMA foreign_key_check").all().length > 0) {
      throw new CollabError("migration_foreign_key_failure", "Migration would leave invalid foreign-key references");
    }
    const integrity = this.db.query("PRAGMA integrity_check").get();
    if (integrity.integrity_check !== "ok") {
      throw new CollabError("migration_integrity_failure", "SQLite integrity verification failed during migration");
    }
    this.migrationFailpoint?.("v3_verified");
  }
  tableNames() {
    const rows = this.db.query(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all();
    return rows.map((row) => row.name);
  }
  hasColumn(table, column) {
    return this.tableColumns(table).includes(column);
  }
  tableColumns(table) {
    const rows = this.db.query(`PRAGMA table_info(${quoteIdentifier(table)})`).all();
    return rows.map((row) => row.name);
  }
  hasExactColumns(table, columns) {
    return canonicalJson(this.tableColumns(table)) === canonicalJson(columns);
  }
  validateLegacyOrV2Shape(userVersion) {
    const required = {
      workspaces: [
        "id",
        "epoch_id",
        "root_path",
        "name",
        "created_at",
        "event_head_sequence",
        "event_head_hash"
      ],
      tasks: [
        "id",
        "workspace_id",
        "title",
        "description",
        "status",
        "dependencies_json",
        "path_scopes_json",
        "assignee",
        "lease_id",
        "lease_expires_at",
        "blocker",
        "latest_progress",
        "version",
        "created_at",
        "updated_at",
        "completed_at"
      ],
      artifacts: [
        "id",
        "workspace_id",
        "task_id",
        "kind",
        "uri",
        "sha256",
        "media_type",
        "label",
        "attached_by",
        "attached_at"
      ],
      decisions: [
        "id",
        "workspace_id",
        "topic",
        "decision",
        "rationale",
        "recorded_by",
        "recorded_at"
      ],
      handoffs: [
        "id",
        "workspace_id",
        "task_id",
        "from_actor",
        "to_actor",
        "summary",
        "status",
        "offered_at",
        "expires_at",
        "resolved_at"
      ],
      events: [
        "workspace_id",
        "epoch_id",
        "sequence",
        "id",
        "protocol",
        "type",
        "entity_id",
        "actor",
        "occurred_at",
        "payload_json",
        "prev_hash",
        "hash"
      ],
      mutations: [
        "workspace_id",
        "actor",
        "idempotency_key",
        "operation",
        "request_hash",
        "response_json",
        "created_at"
      ]
    };
    this.requireColumns(required, "The SQLite file is not a complete agenttool collaboration database");
    const names = new Set(this.tableNames());
    const hasV2Marker = names.has("coordination_sessions") || names.has("schema_migrations") || this.hasColumn("workspaces", "repository_key") || this.hasColumn("tasks", "coordination_mode") || this.hasColumn("events", "session_id");
    if (userVersion < HARDENED_PREVIEW_SCHEMA_VERSION) {
      if (hasV2Marker || pragmaNumber(this.db, "application_id") !== 0 || names.has("sessions") && !this.hasExactColumns("sessions", PRESENCE_SESSION_COLUMNS)) {
        throw new CollabError("database_partial_migration", "The collaboration database has unrecognized hardened objects without a committed schema version");
      }
      return;
    }
    if (userVersion === HARDENED_PREVIEW_SCHEMA_VERSION) {
      if (names.has("coordination_sessions")) {
        throw new CollabError("database_partial_migration", "The hardened preview database has an unexpected coordination-session table name");
      }
      this.validateV2Shape("sessions", [HARDENED_PREVIEW_SCHEMA_VERSION]);
      return;
    }
    if (userVersion === SCHEMA_VERSION) {
      this.validateV2Shape("coordination_sessions", [
        HARDENED_PREVIEW_SCHEMA_VERSION,
        SCHEMA_VERSION
      ]);
    }
  }
  validateV2Shape(sessionTable, expectedMigrationVersions) {
    const required = {
      workspaces: ["repository_key"],
      tasks: [
        "coordination_mode",
        "work_mode",
        "completion_policy",
        "review_status",
        "review_generation",
        "expected_base_sha",
        "base_checkpoint_json",
        "result_checkpoint_json",
        "completion_report_id",
        "assignee_session_id",
        "claim_worktree_id",
        "reported_by",
        "reported_by_session_id",
        "reported_at",
        "accepted_by",
        "accepted_by_session_id",
        "accepted_at"
      ],
      artifacts: ["attached_by_session_id"],
      handoffs: ["from_session_id", "to_session_id"],
      events: ["session_id"],
      repositories: ["key", "created_at"],
      worktrees: [
        "id",
        "workspace_id",
        "repository_key",
        "root_path",
        "git_common_dir_hash",
        "fingerprint",
        "branch",
        "head_sha",
        "dirty",
        "registered_at",
        "last_seen_at"
      ],
      [sessionTable]: [...COORDINATION_SESSION_COLUMNS],
      reports: [
        "id",
        "workspace_id",
        "task_id",
        "from_session_id",
        "from_actor",
        "to_session_id",
        "kind",
        "body",
        "evidence_refs_json",
        "confidence",
        "confidence_basis",
        "limits",
        "relation",
        "target_report_id",
        "authority_scope",
        "authority_basis",
        "created_at",
        "event_sequence"
      ],
      task_reviews: [
        "id",
        "workspace_id",
        "task_id",
        "review_generation",
        "outcome",
        "summary",
        "reviewer_actor",
        "reviewer_session_id",
        "created_at",
        "event_sequence"
      ],
      task_recoveries: [
        "id",
        "workspace_id",
        "task_id",
        "prior_lease_id",
        "prior_session_id",
        "recovered_by_session_id",
        "action",
        "note",
        "prior_checkpoint_json",
        "new_lease_id",
        "recovered_at",
        "event_sequence"
      ],
      session_cursor_resets: [
        "id",
        "session_id",
        "from_epoch_id",
        "from_sequence",
        "from_hash",
        "to_epoch_id",
        "to_sequence",
        "to_hash",
        "reason",
        "reset_generation",
        "created_at"
      ],
      v2_write_guard: ["nonce", "enabled"],
      schema_migrations: ["version", "protocol", "applied_at"]
    };
    this.requireColumns(required, "The hardened collaboration schema is incomplete");
    if (!this.hasExactColumns(sessionTable, COORDINATION_SESSION_COLUMNS)) {
      throw new CollabError("database_schema_mismatch", "The credential-bound coordination session table has an unexpected shape");
    }
    if (sessionTable === "coordination_sessions" && !this.hasExactColumns("sessions", PRESENCE_SESSION_COLUMNS)) {
      throw new CollabError("database_schema_mismatch", "The self-declared presence session table has an unexpected shape");
    }
    const triggers = this.db.query(`
      SELECT name, sql FROM sqlite_master
      WHERE type = 'trigger' AND name IN (${V2_GUARD_TRIGGERS.map(() => "?").join(", ")})
    `).all(...V2_GUARD_TRIGGERS);
    const byName = new Map(triggers.map((trigger) => [trigger.name, trigger.sql ?? ""]));
    for (const trigger of V2_GUARD_TRIGGERS) {
      const sql = byName.get(trigger);
      if (!sql || !sql.includes("v2_write_guard") || !sql.includes("agenttool_collab_v2_write_requires_v2_client")) {
        throw new CollabError("database_schema_mismatch", "A required v0.2 write guard is missing or malformed", { trigger });
      }
    }
    const migrationRows = this.db.query(`
      SELECT version, protocol FROM schema_migrations ORDER BY version
    `).all();
    if (canonicalJson(migrationRows.map((row) => row.version)) !== canonicalJson(expectedMigrationVersions) || migrationRows.some((row) => row.protocol !== COLLAB_COORDINATION_PROTOCOL)) {
      throw new CollabError("database_migration_receipt_invalid", "The collaboration schema migration ledger is missing or inconsistent");
    }
    const staleGuards = this.db.query(`SELECT COUNT(*) AS count FROM v2_write_guard`).get();
    if (staleGuards.count !== 0) {
      throw new CollabError("database_write_guard_invalid", "The v0.2 write guard contains unexpected persistent state");
    }
    if (this.db.query(`PRAGMA foreign_key_check`).all().length > 0) {
      throw new CollabError("database_foreign_key_failure", "The collaboration database contains invalid foreign-key references");
    }
  }
  requireColumns(required, message) {
    const names = new Set(this.tableNames());
    for (const [table, columns] of Object.entries(required)) {
      if (!names.has(table)) {
        throw new CollabError("database_schema_mismatch", message, {
          missing_table: table
        });
      }
      for (const column of columns) {
        if (!this.hasColumn(table, column)) {
          throw new CollabError("database_schema_mismatch", message, {
            table,
            missing_column: column
          });
        }
      }
    }
  }
  validateAllJournals() {
    const workspaces = this.db.query(`SELECT id FROM workspaces ORDER BY id`).all();
    for (const workspace of workspaces) {
      if (!this.verifyJournalRows(workspace.id)) {
        throw new CollabError("database_journal_invalid", "A workspace event journal failed hash-chain verification", { workspace_id: workspace.id });
      }
    }
  }
  tightenFileModes() {
    if (!this.filesystemPath)
      return;
    for (const path of [this.filesystemPath, `${this.filesystemPath}-wal`, `${this.filesystemPath}-shm`]) {
      if (!existsSync4(path))
        continue;
      const stat = lstatSync4(path);
      if (!stat.isFile() || stat.isSymbolicLink() || typeof process.getuid === "function" && stat.uid !== process.getuid()) {
        throw new CollabError("database_sidecar_unsafe", "A collaboration database or sidecar path is not a regular file owned by this user", { operation: "tighten_database_file_mode" });
      }
      chmodSync3(path, 384);
    }
  }
  discoverRepositoryKey(budget, probe) {
    const now = this.repositoryDiscovery.now();
    const fullSlice = budget.deadline === undefined;
    budget.deadline ??= now + this.repositoryDiscovery.budget_ms;
    if (now >= budget.deadline)
      return;
    try {
      return probe({ ...this.repositoryDiscovery, deadline: budget.deadline });
    } catch (error) {
      if (error instanceof RepositoryProbeTimeout && !fullSlice)
        return;
      return null;
    }
  }
  prepareRepositoryAliases(budget) {
    const rows = this.db.query(`
      SELECT w.* FROM worktrees w
      LEFT JOIN repository_discovery d ON d.worktree_id = w.id AND d.fingerprint = w.fingerprint
      WHERE d.worktree_id IS NULL AND w.repository_key LIKE 'local-git:%'
      ORDER BY w.id
    `).iterate();
    const prepared = [];
    for (const row of rows) {
      const key = this.discoverRepositoryKey(budget, (options) => {
        const identity = inspectRepository(row.root_path, undefined, true, options);
        if (identity.repository_key === row.repository_key && identity.worktree_fingerprint === row.fingerprint) {
          return identity.portable_repository_key ?? null;
        }
        return null;
      });
      if (key === undefined)
        break;
      prepared.push({ row, key });
    }
    return prepared;
  }
  recordRepositoryAlias(worktreeId2, key) {
    if (key)
      this.db.query(`INSERT OR IGNORE INTO repository_aliases (worktree_id, portable_key) VALUES (?, ?)`).run(worktreeId2, key);
  }
  recordRepositoryDiscovery(worktreeId2, fingerprint, key) {
    if (key === undefined)
      return;
    this.recordRepositoryAlias(worktreeId2, key);
    this.db.query(`INSERT INTO repository_discovery (worktree_id, fingerprint, outcome) VALUES (?, ?, ?)
      ON CONFLICT(worktree_id) DO UPDATE SET fingerprint = excluded.fingerprint, outcome = excluded.outcome`).run(worktreeId2, fingerprint, key ? "checked" : "unresolvable");
  }
  repositoryPartitions(identity) {
    return this.db.query(`
      SELECT DISTINCT w.id FROM workspaces w
      LEFT JOIN worktrees t ON t.workspace_id = w.id
      WHERE w.repository_key = ? OR t.repository_key = ?
      ORDER BY w.created_at, w.id
    `).all(identity.repository_key, identity.repository_key);
  }
  portableRepositoryWorkspace(key) {
    if (!key)
      return;
    const pending = this.db.query(`SELECT 1 FROM worktrees w LEFT JOIN repository_discovery d
      ON d.worktree_id = w.id AND d.fingerprint = w.fingerprint
      WHERE d.worktree_id IS NULL AND w.repository_key LIKE 'local-git:%' LIMIT 1`).get();
    if (pending)
      return;
    const matches = this.db.query(`SELECT DISTINCT w.workspace_id AS id FROM worktrees w
      JOIN repository_aliases a ON a.worktree_id = w.id WHERE a.portable_key = ? LIMIT 2`).all(key);
    return matches.length === 1 ? matches[0] : undefined;
  }
  openWorkspace(input) {
    const actor = validateActor(input.actor);
    const identity = inspectRepository(input.root_path, input.repository_key, false, { portable: false });
    const budget = {};
    const cached = this.db.query(`SELECT a.portable_key FROM repository_discovery d
      LEFT JOIN repository_aliases a ON a.worktree_id = d.worktree_id
      WHERE d.worktree_id = ? AND d.fingerprint = ?`).get(identity.checkpoint.worktree_id, identity.worktree_fingerprint);
    const registered = this.db.query(`SELECT 1 FROM worktrees WHERE root_path = ?`).get(identity.root_path);
    const aliases = !registered && this.repositoryPartitions(identity).length === 0 && identity.repository_key.startsWith("local-git:") ? this.prepareRepositoryAliases(budget) : [];
    identity.portable_repository_key = cached ? cached.portable_key : identity.repository_key.startsWith("local-git:") ? this.discoverRepositoryKey(budget, (options) => portableRepositoryKey(identity.root_path, options)) : null;
    const created = this.db.transaction(() => {
      const now = this.timestamp();
      for (const { row, key } of aliases) {
        const current = this.requireWorktreeRow(row.id);
        if (current.root_path !== row.root_path || current.fingerprint !== row.fingerprint || current.repository_key !== row.repository_key || current.workspace_id !== row.workspace_id) {
          continue;
        }
        this.recordRepositoryDiscovery(row.id, row.fingerprint, key);
      }
      const existingWorktree = this.db.query(`
        SELECT * FROM worktrees WHERE root_path = ?
      `).get(identity.root_path);
      if (existingWorktree) {
        if (existingWorktree.repository_key !== identity.repository_key || existingWorktree.fingerprint !== identity.worktree_fingerprint) {
          throw new CollabError("worktree_identity_changed", "This path now resolves to a different repository/worktree identity", {
            root_path: identity.root_path,
            registered_worktree_id: existingWorktree.id
          });
        }
        this.recordRepositoryDiscovery(existingWorktree.id, identity.worktree_fingerprint, identity.portable_repository_key);
        this.touchWorktree(existingWorktree, identity.checkpoint, now);
        return this.requireWorkspace(existingWorktree.workspace_id);
      }
      const partitions = this.repositoryPartitions(identity);
      if (partitions.length > 1) {
        throw new CollabError("repository_partitioned", "Multiple preserved journals require explicit reconciliation", {
          workspace_ids: partitions.map((partition) => partition.id)
        });
      }
      const repositoryWorkspace = partitions[0] ?? this.portableRepositoryWorkspace(identity.portable_repository_key);
      const id = repositoryWorkspace?.id ?? `ws_${sha2564(identity.repository_key).slice(0, 24)}`;
      const existing = this.getWorkspace(id);
      if (existing && !repositoryWorkspace) {
        throw new CollabError("workspace_identity_collision", "Workspace identity collision");
      }
      if (existing) {
        this.registerWorktree(existing.id, identity, now, actor, true);
        this.recordRepositoryDiscovery(identity.checkpoint.worktree_id, identity.worktree_fingerprint, identity.portable_repository_key);
        return this.requireWorkspace(existing.id);
      }
      const epochId = `epoch_${randomUUID()}`;
      const name = cleanText(input.name ?? identity.root_path.split("/").at(-1) ?? id, "name", 200);
      this.db.query(`INSERT OR IGNORE INTO repositories (key, created_at) VALUES (?, ?)`).run(identity.repository_key, now);
      this.db.query(`
        INSERT INTO workspaces
          (id, epoch_id, root_path, repository_key, name, created_at,
            event_head_sequence, event_head_hash)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?)
      `).run(id, epochId, identity.root_path, identity.repository_key, name, now, GENESIS_HASH);
      this.registerWorktree(id, identity, now, actor, false);
      this.recordRepositoryDiscovery(identity.checkpoint.worktree_id, identity.worktree_fingerprint, identity.portable_repository_key);
      this.appendEvent(id, "workspace.opened", id, actor, {
        root_path: identity.root_path,
        repository_key: identity.repository_key,
        worktree_id: identity.checkpoint.worktree_id,
        name,
        rights_profile: "xenia.rights/0.1"
      });
      return this.requireWorkspace(id);
    }).immediate();
    this.tightenFileModes();
    return created;
  }
  getWorkspace(workspaceId, db = this.db) {
    const row = db.query(`
      SELECT id, epoch_id, root_path, repository_key, name, created_at,
        event_head_sequence, event_head_hash
      FROM workspaces WHERE id = ?
    `).get(workspaceId);
    return row ? { ...row } : null;
  }
  getWorktree(workspaceId, rootPath) {
    const identity = inspectRepository(rootPath);
    const row = this.db.query(`
      SELECT * FROM worktrees WHERE workspace_id = ? AND root_path = ?
    `).get(workspaceId, identity.root_path);
    return row ? worktreeFromRow(row) : null;
  }
  joinSession(input) {
    const normalized = {
      workspace_id: validateId(input.workspace_id, "workspace_id"),
      client_instance_id: validateId(input.client_instance_id, "client_instance_id"),
      actor_label: validateActor(input.actor_label),
      runtime_kind: validateRuntimeKind(input.runtime_kind),
      provider_label: optionalText(input.provider_label, "provider_label", 100),
      model_label: optionalText(input.model_label, "model_label", 200),
      declared_capabilities: normalizeSessionCapabilities(input.declared_capabilities ?? []),
      ttl_seconds: validatePresenceTtl(input.ttl_seconds)
    };
    const workspace = this.requireWorkspace(normalized.workspace_id);
    const transaction = this.db.transaction(() => {
      const existing = this.readPresenceSessionByClient(normalized.workspace_id, normalized.client_instance_id);
      if (existing) {
        requireMatchingPresenceSessionJoin(existing, normalized);
        if (existing.left_at) {
          throw new CollabError("session_instance_ended", "This presence session already left; use a new client_instance_id", { session_id: existing.id });
        }
        return presenceSessionFromRow(existing, this.timestamp());
      }
      const now = this.timestamp();
      const id = `session_${randomUUID()}`;
      const actorKey = `session:${id}`;
      this.db.query(`
        INSERT INTO sessions (
          id, workspace_id, epoch_id, client_instance_id, actor_label, actor_key,
          runtime_kind, provider_label, model_label, declared_capabilities_json,
          version, joined_at, last_seen_at, presence_expires_at, left_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL)
      `).run(id, workspace.id, workspace.epoch_id, normalized.client_instance_id, normalized.actor_label, actorKey, normalized.runtime_kind, normalized.provider_label, normalized.model_label, canonicalJson(normalized.declared_capabilities), now, now, addSeconds(now, normalized.ttl_seconds));
      return presenceSessionFromRow(this.requirePresenceSessionRow(id), now);
    });
    const session = transaction.immediate();
    this.tightenFileModes();
    return session;
  }
  getSession(sessionId) {
    return presenceSessionFromRow(this.requirePresenceSessionRow(validateId(sessionId, "session_id")), this.timestamp());
  }
  listSessions(workspaceId, presence, limit) {
    const id = validateId(workspaceId, "workspace_id");
    this.requireWorkspace(id);
    if (presence !== undefined && presence !== "live" && presence !== "stale" && presence !== "left") {
      throw new CollabError("invalid_presence", "presence must be live, stale, or left");
    }
    const observedAt = this.timestamp();
    const boundedLimit = validateSessionListLimit(limit);
    let rows;
    if (presence === "live") {
      rows = this.db.query(`
        SELECT * FROM sessions
        WHERE workspace_id = ? AND left_at IS NULL AND presence_expires_at > ?
        ORDER BY joined_at DESC, id DESC LIMIT ?
      `).all(id, observedAt, boundedLimit);
    } else if (presence === "stale") {
      rows = this.db.query(`
        SELECT * FROM sessions
        WHERE workspace_id = ? AND left_at IS NULL AND presence_expires_at <= ?
        ORDER BY joined_at DESC, id DESC LIMIT ?
      `).all(id, observedAt, boundedLimit);
    } else if (presence === "left") {
      rows = this.db.query(`
        SELECT * FROM sessions
        WHERE workspace_id = ? AND left_at IS NOT NULL
        ORDER BY joined_at DESC, id DESC LIMIT ?
      `).all(id, boundedLimit);
    } else {
      rows = this.db.query(`
        SELECT * FROM sessions
        WHERE workspace_id = ?
        ORDER BY joined_at DESC, id DESC LIMIT ?
      `).all(id, boundedLimit);
    }
    return rows.map((row) => presenceSessionFromRow(row, observedAt));
  }
  heartbeatSession(input) {
    const normalized = {
      session_id: validateId(input.session_id, "session_id"),
      idempotency_key: validateIdempotencyKey(input.idempotency_key),
      expected_version: validateExpectedVersion(input.expected_version),
      ttl_seconds: validatePresenceTtl(input.ttl_seconds)
    };
    const initial = this.requirePresenceSessionRow(normalized.session_id);
    return this.mutate(initial.workspace_id, initial.actor_key, normalized.idempotency_key, "session.heartbeat", normalized, () => {
      const row = this.requirePresenceSessionRow(normalized.session_id);
      requirePresenceSessionVersion(row, normalized.expected_version);
      if (row.left_at) {
        throw new CollabError("session_left", "An explicitly left presence session cannot heartbeat", { session_id: row.id });
      }
      const now = this.timestamp();
      this.db.query(`
          UPDATE sessions
          SET version = ?, last_seen_at = ?, presence_expires_at = ?
          WHERE id = ?
        `).run(row.version + 1, now, addSeconds(now, normalized.ttl_seconds), row.id);
      return presenceSessionFromRow(this.requirePresenceSessionRow(row.id), now);
    });
  }
  leaveSession(input) {
    const normalized = {
      session_id: validateId(input.session_id, "session_id"),
      idempotency_key: validateIdempotencyKey(input.idempotency_key),
      expected_version: validateExpectedVersion(input.expected_version)
    };
    const initial = this.requirePresenceSessionRow(normalized.session_id);
    return this.mutate(initial.workspace_id, initial.actor_key, normalized.idempotency_key, "session.leave", normalized, () => {
      const row = this.requirePresenceSessionRow(normalized.session_id);
      requirePresenceSessionVersion(row, normalized.expected_version);
      const now = this.timestamp();
      if (!row.left_at) {
        this.db.query(`
            UPDATE sessions SET version = ?, left_at = ? WHERE id = ?
          `).run(row.version + 1, now, row.id);
      }
      return presenceSessionFromRow(this.requirePresenceSessionRow(row.id), now);
    });
  }
  startSession(input) {
    const id = `session_${randomUUID()}`;
    const actor = input.actor !== undefined ? validateActor(input.actor) : derivedActor(input.actor_prefix, id);
    const role = optionalText(input.role, "role", 200);
    const seatRef = input.seat_ref == null ? null : validateSeatRef(input.seat_ref);
    const model = input.model === undefined ? null : validateModelLabel(input.model);
    const identity = inspectRepository(input.root_path, input.repository_key, true, { portable: false });
    const workspace = this.openWorkspace({
      root_path: input.root_path,
      actor,
      repository_key: input.repository_key
    });
    const worktreeRow = this.db.query(`
      SELECT * FROM worktrees WHERE workspace_id = ? AND root_path = ?
    `).get(workspace.id, identity.root_path);
    if (!worktreeRow) {
      throw new CollabError("worktree_not_found", "The session worktree was not registered");
    }
    const parentSessionId = input.parent_session_id ? validateId(input.parent_session_id, "parent_session_id") : null;
    const joined = this.db.transaction(() => {
      const partitions = this.repositoryPartitions(identity);
      if (partitions.length > 1) {
        throw new CollabError("repository_partitioned", "Multiple preserved journals require explicit reconciliation before session start", {
          workspace_ids: partitions.map((partition) => partition.id)
        });
      }
      if (parentSessionId) {
        const parent = this.requireCoordinationSessionRow(parentSessionId);
        if (parent.workspace_id !== workspace.id) {
          throw new CollabError("parent_session_mismatch", "A parent session must belong to the same workspace");
        }
      }
      const now = this.timestamp();
      const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
      const generation = 1;
      this.db.query(`
        INSERT INTO coordination_sessions (
          id, workspace_id, worktree_id, actor, role, parent_session_id, status,
          generation, token_hash, joined_at, last_seen_at, ended_at,
          cursor_epoch_id, cursor_sequence, cursor_hash, cursor_version, reset_generation
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, NULL, ?, 0, ?, 0, 0)
      `).run(id, workspace.id, worktreeRow.id, actor, role, parentSessionId, generation, hashSessionToken(token), now, now, workspace.epoch_id, GENESIS_HASH);
      if (parentSessionId && input.parent_attested === true) {
        this.db.query(`
          INSERT INTO session_parent_attestations (session_id, parent_session_id, basis, attested_at)
          VALUES (?, ?, 'same_mcp_process', ?)
        `).run(id, parentSessionId, now);
      }
      this.appendEvent(workspace.id, "session.joined", id, actor, {
        worktree_id: worktreeRow.id,
        role,
        parent_session_id: parentSessionId,
        ...seatRef ? { seat_ref: seatRef } : {},
        ...model ? { model } : {},
        identity_boundary: "session_credentials_fence_cooperating_local_clients_but_do_not_authenticate_a_person_or_model"
      }, id);
      return this.sessionHandle(this.requireCoordinationSessionRow(id), token, this.requireWorkspace(workspace.id), worktreeRow);
    }).immediate();
    this.tightenFileModes();
    return joined;
  }
  resumeSession(credential, options = {}) {
    const sessionId = validateId(credential.session_id, "session_id");
    const resumed = this.db.transaction(() => {
      const row = this.authenticateResumeToken(sessionId, credential.session_token);
      const now = this.timestamp();
      this.recordSessionLeaseLapses(row, now);
      const nextGeneration = row.generation + 1;
      const persistedCursor = {
        epoch_id: row.cursor_epoch_id,
        sequence: row.cursor_sequence,
        hash: row.cursor_hash
      };
      let recovery = row.cursor_recovery_required !== 0 ? {
        required: true,
        cause: "host_cursor_mismatch",
        persisted_cursor: persistedCursor,
        host_cursor: credential.last_cursor ?? null,
        expected_cursor_version: row.cursor_version
      } : undefined;
      try {
        this.validateEventAnchor(row.workspace_id, persistedCursor);
      } catch (error) {
        if (error instanceof CollabError) {
          recovery = {
            required: true,
            cause: "persisted_cursor_invalid",
            persisted_cursor: persistedCursor,
            host_cursor: credential.last_cursor ?? null,
            expected_cursor_version: row.cursor_version
          };
        } else {
          throw error;
        }
      }
      if (!recovery && credential.last_cursor) {
        try {
          const known = this.validateEventAnchor(row.workspace_id, credential.last_cursor);
          if (known.epoch_id !== persistedCursor.epoch_id || known.sequence !== persistedCursor.sequence || known.hash !== persistedCursor.hash) {
            recovery = {
              required: true,
              cause: "host_cursor_mismatch",
              persisted_cursor: persistedCursor,
              host_cursor: known,
              expected_cursor_version: row.cursor_version
            };
          }
        } catch (error) {
          if (error instanceof CollabError) {
            recovery = {
              required: true,
              cause: "host_cursor_invalid",
              persisted_cursor: persistedCursor,
              host_cursor: credential.last_cursor,
              expected_cursor_version: row.cursor_version
            };
          } else {
            throw error;
          }
        }
      }
      if (recovery && !options.allow_cursor_recovery) {
        throw new CollabError("cursor_reset_required", "The host and persisted session cursors require an explicit audited reset", { ...recovery });
      }
      const changed = this.db.query(`
        UPDATE coordination_sessions
        SET generation = ?, last_seen_at = ?, cursor_recovery_required = ?
        WHERE id = ? AND generation = ? AND status = 'active'
      `).run(nextGeneration, now, recovery ? 1 : 0, sessionId, row.generation);
      if (changed.changes !== 1) {
        throw new CollabError("session_auth_failed", "Session credentials are invalid");
      }
      this.appendEvent(row.workspace_id, "session.resumed", row.id, row.actor, {
        worktree_id: row.worktree_id,
        generation: nextGeneration,
        cursor_recovery_required: recovery?.required ?? false,
        cursor_recovery_cause: recovery?.cause ?? null
      }, row.id);
      const next = this.requireCoordinationSessionRow(row.id);
      const workspace = this.requireWorkspace(row.workspace_id);
      const worktree = this.requireWorktreeRow(row.worktree_id);
      const handle = this.sessionHandle(next, credential.session_token, workspace, worktree);
      if (recovery) {
        handle.cursor_recovery = recovery;
        handle.credential.last_cursor = credential.last_cursor;
      }
      return handle;
    }).immediate();
    this.tightenFileModes();
    return resumed;
  }
  endSession(input) {
    return this.endSessionWithReleases(input).session;
  }
  endSessionWithReleases(input) {
    const reason = optionalText(input.reason, "reason", 2000);
    if (input.release_leases !== undefined && typeof input.release_leases !== "boolean") {
      throw new CollabError("invalid_release_leases", "release_leases must be a boolean");
    }
    const releaseLeases = input.release_leases === true;
    if (input.release_summary !== undefined && !releaseLeases) {
      throw new CollabError("invalid_release_summary", "release_summary applies only together with release_leases: true");
    }
    const releaseSummary = optionalText(input.release_summary, "release_summary", 2000);
    const ended = this.db.transaction(() => {
      const row = this.authenticateSession(input, { allow_cursor_recovery: true });
      const now = this.timestamp();
      const releasedLeases = [];
      if (releaseLeases) {
        const held = this.db.query(`
          SELECT * FROM tasks
          WHERE workspace_id = ? AND assignee_session_id = ?
            AND status = 'claimed' AND lease_id IS NOT NULL
          ORDER BY id
        `).all(row.workspace_id, row.id);
        if (held.length > 0) {
          const releaseNote = releaseSummary ?? reason;
          const guardNonce = `guard_${randomUUID()}`;
          this.db.query(`INSERT INTO v2_write_guard (nonce, enabled) VALUES (?, 1)`).run(guardNonce);
          try {
            for (const task of held) {
              const leaseId = task.lease_id;
              const expired = this.isExpired(task, row, now);
              if (expired) {
                const lapsed = this.expireSessionLeaseForRecovery(task, row, now);
                this.recordRecoveryWithoutTakeover(task, row, {
                  prior: lapsed.prior,
                  expiry_version: lapsed.expiryVersion,
                  action: "release",
                  recovery_note: releaseNote ?? SESSION_END_RECOVERY_NOTE,
                  blocker: null,
                  now
                });
                releasedLeases.push({ task_id: task.id, lease_id: leaseId, via: "recovery" });
              } else {
                this.clearSessionClaim(task, row, "task.released", {
                  summary: releaseNote,
                  released_by_session_end: true
                });
                releasedLeases.push({ task_id: task.id, lease_id: leaseId, via: "release" });
              }
            }
          } finally {
            this.db.query(`DELETE FROM v2_write_guard WHERE nonce = ?`).run(guardNonce);
          }
        }
      }
      const refusal = this.liveLeaseRefusal(row.workspace_id, row.id, now);
      if (refusal)
        throw refusal;
      const incomingHandoffs = this.db.query(`
        SELECT * FROM handoffs
        WHERE workspace_id = ? AND to_session_id = ? AND status = 'pending'
        ORDER BY offered_at, id
      `).all(row.workspace_id, row.id);
      for (const handoff of incomingHandoffs) {
        this.db.query(`
          UPDATE handoffs SET status = 'expired', resolved_at = ? WHERE id = ?
        `).run(now, handoff.id);
        this.appendEvent(row.workspace_id, "handoff.expired", handoff.id, row.actor, {
          task_id: handoff.task_id,
          reason: "target_session_ended"
        }, row.id);
      }
      const changed = this.db.query(`
        UPDATE coordination_sessions
        SET status = 'ended', ended_at = ?, last_seen_at = ?, generation = generation + 1,
          token_hash = ?
        WHERE id = ? AND generation = ? AND status = 'active'
      `).run(now, now, hashSessionToken(randomBytes(SESSION_TOKEN_BYTES).toString("base64url")), row.id, row.generation);
      if (changed.changes !== 1) {
        throw new CollabError("session_auth_failed", "Session credentials are invalid");
      }
      this.appendEvent(row.workspace_id, "session.ended", row.id, row.actor, { reason }, row.id);
      return {
        session: this.sessionProjection(this.requireCoordinationSessionRow(row.id)),
        released_leases: releasedLeases
      };
    }).immediate();
    this.tightenFileModes();
    return ended;
  }
  listCoordinationSessions(workspaceId, status) {
    const workspace = this.requireWorkspace(workspaceId);
    const rows = status ? this.db.query(`
          SELECT * FROM coordination_sessions
          WHERE workspace_id = ? AND status = ?
          ORDER BY joined_at, id
        `).all(workspace.id, status) : this.db.query(`
          SELECT * FROM coordination_sessions
          WHERE workspace_id = ?
          ORDER BY joined_at, id
        `).all(workspace.id);
    const observedAt = this.timestamp();
    return rows.map((row) => this.sessionProjection(row, observedAt));
  }
  getCoordinationSession(sessionId) {
    const id = validateId(sessionId, "session_id");
    const row = this.db.query(`SELECT * FROM coordination_sessions WHERE id = ?`).get(id);
    return row ? this.sessionProjection(row) : null;
  }
  sessionSeatRef(sessionId) {
    const id = validateId(sessionId, "session_id");
    const row = this.db.query(`
      SELECT json_extract(payload_json, '$.seat_ref') AS seat_ref FROM events
      WHERE type = 'session.joined' AND entity_id = ?
    `).get(id);
    return typeof row?.seat_ref === "string" ? row.seat_ref : null;
  }
  activeSessionIdsForSeatRefs(seatRefs) {
    const refs = [...new Set(seatRefs.map(validateSeatRef))];
    if (refs.length === 0)
      return [];
    const rows = this.db.query(`
      SELECT s.id FROM coordination_sessions s
      JOIN events e ON e.type = 'session.joined' AND e.entity_id = s.id
      WHERE s.status = 'active'
        AND json_extract(e.payload_json, '$.seat_ref') IN (${refs.map(() => "?").join(", ")})
      ORDER BY s.joined_at, s.id
    `).all(...refs);
    return rows.map((row) => row.id);
  }
  preflightSessionEnd(credential) {
    const sessionId = validateId(credential.session_id, "session_id");
    const row = this.authenticateResumeToken(sessionId, credential.session_token);
    const refusal = this.liveLeaseRefusal(row.workspace_id, row.id, this.timestamp(), true);
    if (refusal)
      throw refusal;
  }
  acknowledgeSessionCursor(input) {
    const acknowledged = this.db.transaction(() => {
      const row = this.authenticateSession(input);
      const anchor = this.validateEventAnchor(row.workspace_id, input.anchor);
      this.recordSessionLeaseLapses(row, this.timestamp());
      if (anchor.epoch_id !== row.cursor_epoch_id) {
        throw new CollabError("cursor_epoch_mismatch", "The cursor belongs to another journal epoch");
      }
      if (anchor.sequence < row.cursor_sequence) {
        throw new CollabError("cursor_regression", "A session cursor cannot move backwards", {
          current_sequence: row.cursor_sequence
        });
      }
      if (anchor.sequence === row.cursor_sequence) {
        if (anchor.hash !== row.cursor_hash) {
          throw new CollabError("cursor_fork_detected", "The cursor sequence now resolves to a different journal hash");
        }
        this.db.query(`UPDATE coordination_sessions SET last_seen_at = ? WHERE id = ?`).run(this.timestamp(), row.id);
        return this.sessionProjection(this.requireCoordinationSessionRow(row.id));
      }
      if (row.cursor_version !== input.expected_cursor_version) {
        throw new CollabError("cursor_version_conflict", "The session cursor changed", {
          expected_cursor_version: input.expected_cursor_version,
          current_cursor_version: row.cursor_version
        });
      }
      const now = this.timestamp();
      const changed = this.db.query(`
        UPDATE coordination_sessions
        SET cursor_epoch_id = ?, cursor_sequence = ?, cursor_hash = ?,
          cursor_version = cursor_version + 1, last_seen_at = ?
        WHERE id = ? AND generation = ? AND cursor_version = ? AND status = 'active'
      `).run(anchor.epoch_id, anchor.sequence, anchor.hash, now, row.id, row.generation, row.cursor_version);
      if (changed.changes !== 1) {
        throw new CollabError("cursor_version_conflict", "The session cursor changed");
      }
      return this.sessionProjection(this.requireCoordinationSessionRow(row.id));
    }).immediate();
    this.tightenFileModes();
    return acknowledged;
  }
  resetSessionCursor(input) {
    const reason = cleanText(input.reason, "reason", 2000);
    this.mutateAsSession(input, input.idempotency_key, "cursor.reset.v2", {
      expected_cursor_version: input.expected_cursor_version,
      target: input.target,
      reason
    }, (row) => {
      if (row.cursor_version !== input.expected_cursor_version) {
        throw new CollabError("cursor_version_conflict", "The session cursor changed");
      }
      const target = this.validateEventAnchor(row.workspace_id, input.target);
      const now = this.timestamp();
      const resetGeneration = row.reset_generation + 1;
      const id = `cursor_reset_${randomUUID()}`;
      this.db.query(`
        INSERT INTO session_cursor_resets (
          id, session_id, from_epoch_id, from_sequence, from_hash,
          to_epoch_id, to_sequence, to_hash, reason, reset_generation, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, row.id, row.cursor_epoch_id, row.cursor_sequence, row.cursor_hash, target.epoch_id, target.sequence, target.hash, reason, resetGeneration, now);
      const changed = this.db.query(`
        UPDATE coordination_sessions
        SET cursor_epoch_id = ?, cursor_sequence = ?, cursor_hash = ?,
          cursor_version = cursor_version + 1, reset_generation = ?, last_seen_at = ?,
          cursor_recovery_required = 0
        WHERE id = ? AND generation = ? AND cursor_version = ? AND status = 'active'
      `).run(target.epoch_id, target.sequence, target.hash, resetGeneration, now, row.id, row.generation, row.cursor_version);
      if (changed.changes !== 1) {
        throw new CollabError("cursor_version_conflict", "The session cursor changed");
      }
      this.appendEvent(row.workspace_id, "session.cursor_reset", id, row.actor, {
        from: {
          epoch_id: row.cursor_epoch_id,
          sequence: row.cursor_sequence,
          hash: row.cursor_hash
        },
        to: target,
        reason,
        reset_generation: resetGeneration
      }, row.id);
      return this.sessionProjection(this.requireCoordinationSessionRow(row.id));
    }, { allow_cursor_recovery: true });
    const current = this.authenticateSession(input, {
      allow_cursor_recovery: true
    });
    if (current.cursor_recovery_required !== 0) {
      throw new CollabError("cursor_reset_receipt_stale", "This reset receipt predates the current recovery fence; use a new idempotency key", {
        persisted_cursor: {
          epoch_id: current.cursor_epoch_id,
          sequence: current.cursor_sequence,
          hash: current.cursor_hash
        },
        expected_cursor_version: current.cursor_version
      });
    }
    return this.sessionProjection(current);
  }
  workspaceStatus(workspaceId) {
    const workspace = this.requireWorkspace(workspaceId);
    const tasks = this.listTasks(workspaceId);
    const counts = { open: 0, claimed: 0, blocked: 0, completed: 0 };
    let expiredClaims = 0;
    for (const task of tasks) {
      if (task.effective_status === "lease_expired") {
        counts.open += 1;
        expiredClaims += 1;
      } else if (task.effective_status === "recovery_required") {
        counts.claimed += 1;
        expiredClaims += 1;
      } else {
        counts[task.status] += 1;
      }
    }
    const decisions = this.db.query(`
      SELECT id, workspace_id, topic, decision, rationale, recorded_by, recorded_at
      FROM decisions WHERE workspace_id = ? ORDER BY recorded_at DESC, id DESC LIMIT 10
    `).all(workspaceId);
    return {
      workspace,
      counts,
      expired_claims: expiredClaims,
      active_claims: tasks.filter((task) => task.effective_status === "claimed"),
      blocked_tasks: tasks.filter((task) => task.status === "blocked"),
      pending_reviews: tasks.filter((task) => task.review_status === "pending"),
      active_sessions: this.listCoordinationSessions(workspaceId, "active"),
      recent_decisions: decisions.map(decisionFromRow),
      recent_reports: this.listReports(workspaceId, { limit: 20 })
    };
  }
  createTask(input) {
    const sessionOnly = input;
    if (sessionOnly.work_mode !== undefined || sessionOnly.completion_policy !== undefined || sessionOnly.expected_base_sha !== undefined) {
      throw new CollabError("session_required_for_v2_task_options", "work_mode, completion_policy, and expected_base_sha require createTaskForSession");
    }
    const normalized = {
      ...normalizeMutation(input),
      workspace_id: input.workspace_id,
      id: input.id ? validateId(input.id, "task_id") : undefined,
      title: cleanText(input.title, "title", 300),
      description: optionalText(input.description, "description", MAX_TEXT),
      dependencies: normalizeDependencies(input.dependencies ?? []),
      path_scopes: normalizePathScopes(input.path_scopes ?? [])
    };
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "task.create", normalized, () => {
      this.requireWorkspace(input.workspace_id);
      const id = normalized.id ?? `task_${randomUUID()}`;
      if (normalized.dependencies.includes(id)) {
        throw new CollabError("invalid_dependency", "A task cannot depend on itself", { task_id: id });
      }
      for (const dependency of normalized.dependencies)
        this.requireTaskRow(input.workspace_id, dependency);
      if (this.readTaskRow(input.workspace_id, id)) {
        throw new CollabError("task_exists", `Task '${id}' already exists`, { task_id: id });
      }
      const now = this.timestamp();
      this.db.query(`
        INSERT INTO tasks (
          id, workspace_id, title, description, status, dependencies_json, path_scopes_json,
          assignee, lease_id, lease_expires_at, blocker, latest_progress, version,
          created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, 'open', ?, ?, NULL, NULL, NULL, NULL, NULL, 1, ?, ?, NULL)
      `).run(id, input.workspace_id, normalized.title, normalized.description, canonicalJson(normalized.dependencies), canonicalJson(normalized.path_scopes), now, now);
      this.appendEvent(input.workspace_id, "task.created", id, normalized.actor, {
        title: normalized.title,
        description: normalized.description,
        dependencies: normalized.dependencies,
        path_scopes: normalized.path_scopes,
        version: 1
      });
      return this.requireTask(input.workspace_id, id);
    });
  }
  createTaskForSession(input) {
    const normalized = {
      idempotency_key: validateIdempotencyKey(input.idempotency_key),
      id: input.id ? validateId(input.id, "task_id") : undefined,
      title: cleanText(input.title, "title", 300),
      description: optionalText(input.description, "description", MAX_TEXT),
      dependencies: normalizeDependencies(input.dependencies ?? []),
      path_scopes: normalizePathScopes(input.path_scopes ?? []),
      work_mode: input.work_mode ?? "edit",
      completion_policy: input.completion_policy,
      expected_base_sha: input.expected_base_sha ? validateGitObjectId(input.expected_base_sha) : null
    };
    if (!["coordination", "read_only", "edit"].includes(normalized.work_mode)) {
      throw new CollabError("invalid_work_mode", "Unsupported task work mode");
    }
    if (normalized.work_mode === "edit" && normalized.path_scopes.length === 0) {
      throw new CollabError("edit_scope_required", "Edit tasks require at least one repository-relative path scope");
    }
    const completionPolicy = normalized.completion_policy ?? (normalized.work_mode === "edit" ? "accepted" : "reported");
    if (!["reported", "accepted"].includes(completionPolicy)) {
      throw new CollabError("invalid_completion_policy", "Unsupported completion policy");
    }
    const request = { ...normalized, completion_policy: completionPolicy };
    return this.mutateAsSession(input, normalized.idempotency_key, "task.create.v2", request, (session) => {
      const id = normalized.id ?? `task_${randomUUID()}`;
      if (normalized.dependencies.includes(id)) {
        throw new CollabError("invalid_dependency", "A task cannot depend on itself", {
          task_id: id
        });
      }
      for (const dependency of normalized.dependencies) {
        this.requireTaskRow(session.workspace_id, dependency);
      }
      if (this.readTaskRow(session.workspace_id, id)) {
        throw new CollabError("task_exists", `Task '${id}' already exists`, { task_id: id });
      }
      const now = this.timestamp();
      this.db.query(`
        INSERT INTO tasks (
          id, workspace_id, title, description, status, dependencies_json, path_scopes_json,
          coordination_mode, work_mode, completion_policy, review_status, review_generation,
          expected_base_sha, base_checkpoint_json, result_checkpoint_json, completion_report_id,
          assignee, assignee_session_id, claim_worktree_id, lease_id, lease_expires_at,
          blocker, latest_progress, reported_by, reported_by_session_id, reported_at,
          accepted_by, accepted_by_session_id, accepted_at, version,
          created_at, updated_at, completed_at
        ) VALUES (
          ?, ?, ?, ?, 'open', ?, ?,
          'session_v2', ?, ?, 'not_required', 0,
          ?, NULL, NULL, NULL,
          NULL, NULL, NULL, NULL, NULL,
          NULL, NULL, NULL, NULL, NULL,
          NULL, NULL, NULL, 1,
          ?, ?, NULL
        )
      `).run(id, session.workspace_id, normalized.title, normalized.description, canonicalJson(normalized.dependencies), canonicalJson(normalized.path_scopes), normalized.work_mode, completionPolicy, normalized.expected_base_sha, now, now);
      this.appendEvent(session.workspace_id, "task.created", id, session.actor, {
        title: normalized.title,
        description: normalized.description,
        dependencies: normalized.dependencies,
        path_scopes: normalized.path_scopes,
        work_mode: normalized.work_mode,
        completion_policy: completionPolicy,
        expected_base_sha: normalized.expected_base_sha,
        version: 1
      }, session.id);
      return this.requireTask(session.workspace_id, id);
    });
  }
  claimTaskForSession(input) {
    const taskId = validateId(input.task_id, "task_id");
    const expectedVersion = validateExpectedVersion(input.expected_version);
    const ttl = validateTtl(input.ttl_seconds);
    const request = { task_id: taskId, expected_version: expectedVersion, ttl_seconds: ttl };
    const replay = this.readSessionMutationReceipt(input, input.idempotency_key, "task.claim.v2", request);
    if (replay.found)
      return replay.value;
    const preparedCheckpoint = this.captureSessionWorktree(input);
    return this.mutateAsSession(input, input.idempotency_key, "task.claim.v2", request, (session) => {
      let row = this.requireTaskRow(session.workspace_id, taskId);
      this.requireVersion(row, expectedVersion);
      if (this.isExpired(row)) {
        if (row.assignee_session_id) {
          throw new CollabError("recovery_required", "An expired session lease requires an explicit recovery note", this.recoveryBundle(row));
        }
        row = this.expireClaim(row, "system:clock");
      }
      if (row.status === "completed") {
        throw new CollabError("task_completed", "Completed tasks cannot be claimed", {
          review_status: row.review_status
        });
      }
      if (row.status === "blocked") {
        throw new CollabError("task_blocked", "Blocked tasks must be unblocked before claiming", {
          blocker: row.blocker
        });
      }
      if (row.status === "claimed") {
        throw new CollabError("task_claimed", "Task already has an active claim", {
          assignee: row.assignee,
          assignee_session_id: row.assignee_session_id,
          lease_expires_at: row.lease_expires_at
        });
      }
      if (row.work_mode === "edit" && parseStringArray(row.path_scopes_json).length === 0) {
        throw new CollabError("edit_scope_required", "Edit tasks require path scopes");
      }
      this.requireDependenciesComplete(row);
      this.requirePathsAvailable(row);
      const worktree = this.requirePreparedWorktree(session, preparedCheckpoint);
      const checkpoint = preparedCheckpoint.checkpoint;
      this.requireExpectedBase(row, checkpoint);
      const now = this.timestamp();
      const leaseId = `lease_${randomUUID()}`;
      const expiresAt = addSeconds(now, ttl);
      const version = row.version + 1;
      this.db.query(`
        UPDATE tasks
        SET coordination_mode = 'session_v2',
          status = 'claimed', assignee = ?, assignee_session_id = ?,
          claim_worktree_id = ?, lease_id = ?, lease_expires_at = ?,
          blocker = NULL, base_checkpoint_json = ?,
          result_checkpoint_json = NULL, completion_report_id = NULL,
          review_status = 'not_required',
          reported_by = NULL, reported_by_session_id = NULL, reported_at = NULL,
          accepted_by = NULL, accepted_by_session_id = NULL, accepted_at = NULL,
          completed_at = NULL, version = ?, updated_at = ?
        WHERE workspace_id = ? AND id = ?
      `).run(session.actor, session.id, worktree.id, leaseId, expiresAt, canonicalJson(checkpoint), version, now, row.workspace_id, row.id);
      this.appendEvent(row.workspace_id, "task.claimed", row.id, session.actor, {
        lease_id: leaseId,
        lease_expires_at: expiresAt,
        worktree_id: worktree.id,
        base_checkpoint: checkpoint,
        version,
        checkpoint_boundary: "server_observed_local_git_state_is_evidence_not_atomic_attribution_or_a_filesystem_lock"
      }, session.id);
      return this.requireTask(row.workspace_id, row.id);
    });
  }
  recoverTaskForSession(input) {
    const taskId = validateId(input.task_id, "task_id");
    const expectedVersion = validateExpectedVersion(input.expected_version);
    const recoveryNote = cleanText(input.recovery_note, "recovery_note", 4000);
    const action = input.action ?? "takeover";
    if (!["takeover", "release", "block"].includes(action)) {
      throw new CollabError("invalid_recovery_action", "Recovery action is invalid");
    }
    const blocker = optionalText(input.blocker, "blocker", 2000);
    if (action === "block" && !blocker) {
      throw new CollabError("recovery_blocker_required", "Blocking recovery requires a blocker");
    }
    const ttl = validateTtl(input.ttl_seconds);
    const request = {
      task_id: taskId,
      expected_version: expectedVersion,
      recovery_note: recoveryNote,
      action,
      blocker,
      ttl_seconds: ttl
    };
    const replay = this.readSessionMutationReceipt(input, input.idempotency_key, "task.recover.v2", request);
    if (replay.found)
      return replay.value;
    const preparedCheckpoint = action === "takeover" ? this.captureSessionWorktree(input) : null;
    return this.mutateAsSession(input, input.idempotency_key, "task.recover.v2", request, (session) => {
      const row = this.requireTaskRow(session.workspace_id, taskId);
      this.requireVersion(row, expectedVersion);
      if (!this.isExpired(row, row.assignee_session_id === session.id ? session : undefined) || !row.lease_id || !row.assignee_session_id) {
        throw new CollabError("recovery_not_required", "Only an expired session-owned lease can be explicitly recovered");
      }
      const now = this.timestamp();
      const { prior, expiryVersion } = this.expireSessionLeaseForRecovery(row, session, now);
      if (action !== "takeover") {
        return this.recordRecoveryWithoutTakeover(row, session, {
          prior,
          expiry_version: expiryVersion,
          action,
          recovery_note: recoveryNote,
          blocker,
          now
        });
      }
      const worktree = this.requirePreparedWorktree(session, preparedCheckpoint);
      const checkpoint = preparedCheckpoint.checkpoint;
      const opened = this.requireTaskRow(row.workspace_id, row.id);
      this.requireDependenciesComplete(opened);
      this.requirePathsAvailable(opened);
      this.requireExpectedBase(opened, checkpoint);
      const leaseId = `lease_${randomUUID()}`;
      const leaseExpiresAt = addSeconds(now, ttl);
      const version = expiryVersion + 1;
      this.db.query(`
        UPDATE tasks
        SET status = 'claimed', assignee = ?, assignee_session_id = ?,
          claim_worktree_id = ?, lease_id = ?, lease_expires_at = ?,
          blocker = NULL, base_checkpoint_json = ?, version = ?, updated_at = ?
        WHERE workspace_id = ? AND id = ?
      `).run(session.actor, session.id, worktree.id, leaseId, leaseExpiresAt, canonicalJson(checkpoint), version, now, row.workspace_id, row.id);
      const event = this.appendEvent(row.workspace_id, "task.recovered", row.id, session.actor, {
        prior_lease: prior,
        recovery_note: recoveryNote,
        recovery_checkpoint: checkpoint,
        lease_id: leaseId,
        lease_expires_at: leaseExpiresAt,
        version,
        note: "Recovery acknowledges an expired coordination lease; it does not accept or attribute prior work."
      }, session.id);
      this.db.query(`
        INSERT INTO task_recoveries (
          id, workspace_id, task_id, prior_lease_id, prior_session_id,
          recovered_by_session_id, action, note, prior_checkpoint_json,
          new_lease_id, recovered_at, event_sequence
        ) VALUES (?, ?, ?, ?, ?, ?, 'takeover', ?, ?, ?, ?, ?)
      `).run(`recovery_${randomUUID()}`, row.workspace_id, row.id, prior.lease_id, prior.session_id, session.id, recoveryNote, prior.checkpoint ? canonicalJson(prior.checkpoint) : null, leaseId, now, event.sequence);
      return this.requireTask(row.workspace_id, row.id);
    });
  }
  renewLeaseForSession(input) {
    const normalized = normalizeSessionRenewInput(input);
    const ttl = validateTtl(input.ttl_seconds);
    return this.mutateAsSession(input, normalized.idempotency_key, "task.renew.v2", { ...normalized.request, ttl_seconds: ttl }, (session) => {
      const row = this.requireTaskRow(session.workspace_id, normalized.task_id);
      this.requireActiveSessionLease(row, session, normalized.lease_id);
      const now = this.timestamp();
      const candidate = addSeconds(now, ttl);
      const expiresAt = row.lease_expires_at && row.lease_expires_at > candidate ? row.lease_expires_at : candidate;
      const version = row.version;
      this.db.query(`
          UPDATE tasks SET lease_expires_at = ?, version = ?, updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(expiresAt, version, now, row.workspace_id, row.id);
      this.appendEvent(row.workspace_id, "task.lease_renewed", row.id, session.actor, {
        lease_id: normalized.lease_id,
        lease_expires_at: expiresAt,
        version
      }, session.id);
      return this.requireTask(row.workspace_id, row.id);
    });
  }
  progressTaskForSession(input) {
    const normalized = normalizeSessionLeaseInput(input);
    const message = cleanText(input.message, "message", 2000);
    return this.mutateAsSession(input, normalized.idempotency_key, "task.progress.v2", { ...normalized.request, message }, (session) => {
      const row = this.requireTaskRow(session.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveSessionLease(row, session, normalized.lease_id);
      const now = this.timestamp();
      const version = row.version + 1;
      this.db.query(`
          UPDATE tasks SET latest_progress = ?, version = ?, updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(message, version, now, row.workspace_id, row.id);
      this.appendEvent(row.workspace_id, "task.progressed", row.id, session.actor, {
        message,
        version
      }, session.id);
      return this.requireTask(row.workspace_id, row.id);
    });
  }
  releaseTaskForSession(input) {
    const normalized = normalizeSessionLeaseInput(input);
    const summary = optionalText(input.summary, "summary", 2000);
    return this.mutateAsSession(input, normalized.idempotency_key, "task.release.v2", { ...normalized.request, summary }, (session) => {
      const row = this.requireTaskRow(session.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveSessionLease(row, session, normalized.lease_id);
      return this.clearSessionClaim(row, session, "task.released", { summary });
    });
  }
  blockTaskForSession(input) {
    const normalized = normalizeSessionLeaseInput(input);
    const blocker = cleanText(input.blocker, "blocker", 2000);
    return this.mutateAsSession(input, normalized.idempotency_key, "task.block.v2", { ...normalized.request, blocker }, (session) => {
      const row = this.requireTaskRow(session.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveSessionLease(row, session, normalized.lease_id);
      const now = this.timestamp();
      const version = row.version + 1;
      this.db.query(`
          UPDATE tasks
          SET status = 'blocked', assignee = NULL, assignee_session_id = NULL,
            claim_worktree_id = NULL, lease_id = NULL, lease_expires_at = NULL,
            blocker = ?, version = ?, updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(blocker, version, now, row.workspace_id, row.id);
      this.expirePendingHandoffs(row.workspace_id, row.id, now, session.actor, "task_blocked");
      this.appendEvent(row.workspace_id, "task.blocked", row.id, session.actor, {
        blocker,
        version
      }, session.id);
      return this.requireTask(row.workspace_id, row.id);
    });
  }
  unblockTaskForSession(input) {
    const taskId = validateId(input.task_id, "task_id");
    const expectedVersion = validateExpectedVersion(input.expected_version);
    const note = optionalText(input.note, "note", 2000);
    return this.mutateAsSession(input, input.idempotency_key, "task.unblock.v2", { task_id: taskId, expected_version: expectedVersion, note }, (session) => {
      const row = this.requireTaskRow(session.workspace_id, taskId);
      this.requireVersion(row, expectedVersion);
      if (row.status !== "blocked") {
        throw new CollabError("task_not_blocked", "Only blocked tasks can be unblocked");
      }
      const now = this.timestamp();
      const version = row.version + 1;
      this.db.query(`
          UPDATE tasks
          SET status = 'open', blocker = NULL, review_status = 'not_required',
            version = ?, updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(version, now, row.workspace_id, row.id);
      this.appendEvent(row.workspace_id, "task.unblocked", row.id, session.actor, {
        note,
        version
      }, session.id);
      return this.requireTask(row.workspace_id, row.id);
    });
  }
  attachArtifactForSession(input) {
    const normalized = normalizeSessionLeaseInput(input);
    const artifactInput = {
      kind: validateArtifactKind(input.kind),
      uri: cleanText(input.uri, "uri", 2000),
      sha256: input.sha256 ? validateSha256(input.sha256) : null,
      media_type: optionalText(input.media_type, "media_type", 200),
      label: optionalText(input.label, "label", 300)
    };
    return this.mutateAsSession(input, normalized.idempotency_key, "artifact.attach.v2", { ...normalized.request, ...artifactInput }, (session) => {
      const row = this.requireTaskRow(session.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveSessionLease(row, session, normalized.lease_id);
      const now = this.timestamp();
      const id = `artifact_${randomUUID()}`;
      this.db.query(`
          INSERT INTO artifacts (
            id, workspace_id, task_id, kind, uri, sha256, media_type, label,
            attached_by, attached_by_session_id, attached_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, row.workspace_id, row.id, artifactInput.kind, artifactInput.uri, artifactInput.sha256, artifactInput.media_type, artifactInput.label, session.actor, session.id, now);
      const version = row.version + 1;
      this.db.query(`
          UPDATE tasks SET version = ?, updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(version, now, row.workspace_id, row.id);
      const artifact = this.requireArtifact(id);
      this.appendEvent(row.workspace_id, "artifact.attached", row.id, session.actor, {
        artifact,
        version
      }, session.id);
      return { task: this.requireTask(row.workspace_id, row.id), artifact };
    });
  }
  completeTaskForSession(input) {
    const normalized = normalizeSessionLeaseInput(input);
    const summary = cleanText(input.summary, "summary", 4000);
    const confidence = validateReportConfidence(input.confidence ?? "unknown");
    const confidenceBasis = optionalText(input.confidence_basis, "confidence_basis", 2000);
    const limits = optionalText(input.limits, "limits", 2000);
    const evidenceRefs = normalizeEvidenceRefs(input.evidence_refs ?? []);
    const reviewRequestedSessionId = input.review_requested_session_id === undefined ? null : validateId(input.review_requested_session_id, "review_requested_session_id");
    const request = {
      ...normalized.request,
      summary,
      confidence,
      confidence_basis: confidenceBasis,
      limits,
      evidence_refs: evidenceRefs,
      ...reviewRequestedSessionId ? { review_requested_session_id: reviewRequestedSessionId } : {}
    };
    const replay = this.readSessionMutationReceipt(input, normalized.idempotency_key, "task.complete.v2", request);
    if (replay.found)
      return replay.value;
    const preparedCheckpoint = this.captureSessionWorktree(input);
    return this.mutateAsSession(input, normalized.idempotency_key, "task.complete.v2", request, (session) => {
      const row = this.requireTaskRow(session.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveSessionLease(row, session, normalized.lease_id);
      for (const reference of evidenceRefs) {
        this.requireEvidenceRef(row.workspace_id, reference);
      }
      if (reviewRequestedSessionId) {
        this.requireRequestedReviewer(row, session, reviewRequestedSessionId);
      }
      this.requirePreparedWorktree(session, preparedCheckpoint);
      const checkpoint = preparedCheckpoint.checkpoint;
      const report = this.appendReportInternal(session, {
        task_id: row.id,
        to_session_id: null,
        kind: "observation",
        body: summary,
        evidence_refs: evidenceRefs,
        confidence,
        confidence_basis: confidenceBasis,
        limits,
        relation: "informs",
        target_report_id: null,
        authority_scope: null,
        authority_basis: null
      });
      const now = this.timestamp();
      const version = row.version + 1;
      const reviewGeneration = row.review_generation + 1;
      const reviewStatus = row.completion_policy === "accepted" ? "pending" : "not_required";
      this.db.query(`
          UPDATE tasks
          SET status = 'completed', review_status = ?, review_generation = ?,
            assignee = NULL, assignee_session_id = NULL, claim_worktree_id = NULL,
            lease_id = NULL, lease_expires_at = NULL, blocker = NULL,
            latest_progress = ?, result_checkpoint_json = ?, completion_report_id = ?,
            reported_by = ?, reported_by_session_id = ?, reported_at = ?,
            accepted_by = NULL, accepted_by_session_id = NULL, accepted_at = NULL,
            version = ?, updated_at = ?, completed_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(reviewStatus, reviewGeneration, summary, canonicalJson(checkpoint), report.id, session.actor, session.id, now, version, now, now, row.workspace_id, row.id);
      this.expirePendingHandoffs(row.workspace_id, row.id, now, session.actor, "task_reported_complete");
      this.appendEvent(row.workspace_id, reviewStatus === "pending" ? "task.reported_complete" : "task.completed", row.id, session.actor, {
        completion_report_id: report.id,
        completion_policy: row.completion_policy,
        review_status: reviewStatus,
        review_generation: reviewGeneration,
        result_checkpoint: checkpoint,
        summary,
        version,
        note: reviewStatus === "pending" ? "Reported completion does not satisfy dependencies until a distinct session accepts it." : "Reported completion satisfies this task's explicit reported-only policy; it is not external acceptance.",
        ...reviewRequestedSessionId ? { review_requested_session_id: reviewRequestedSessionId } : {}
      }, session.id);
      if (reviewRequestedSessionId) {
        this.appendReportInternal(session, {
          task_id: row.id,
          to_session_id: reviewRequestedSessionId,
          kind: "proposal",
          body: `Review requested: please review the reported completion of task ${row.id} ` + `(${row.title}) with collab_task_review. This is a request, not a reservation; ` + "any distinct session may still review.",
          evidence_refs: [`report:${report.id}`],
          confidence: "unknown",
          confidence_basis: null,
          limits: null,
          relation: "informs",
          target_report_id: null,
          authority_scope: null,
          authority_basis: null
        });
      }
      return this.requireTask(row.workspace_id, row.id);
    });
  }
  getTask(workspaceId, taskId) {
    const task = this.requireTask(workspaceId, taskId);
    task.artifacts = this.listArtifacts(workspaceId, taskId);
    return task;
  }
  listTasks(workspaceId, status) {
    this.requireWorkspace(workspaceId);
    const rows = status ? this.db.query(`
          SELECT * FROM tasks WHERE workspace_id = ? AND status = ? ORDER BY created_at, id
        `).all(workspaceId, status) : this.db.query(`
          SELECT * FROM tasks WHERE workspace_id = ? ORDER BY created_at, id
        `).all(workspaceId);
    return rows.map((row) => this.taskFromRow(row));
  }
  claimTask(input) {
    const normalized = {
      ...normalizeVersionedMutation(input),
      workspace_id: input.workspace_id,
      task_id: validateId(input.task_id, "task_id"),
      ttl_seconds: validateTtl(input.ttl_seconds)
    };
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "task.claim", normalized, () => {
      let row = this.requireTaskRow(input.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      const priorAssignee = row.assignee;
      const expired = this.isExpired(row);
      if (expired) {
        row = this.expireClaim(row, normalized.actor);
      }
      if (row.status === "completed")
        throw new CollabError("task_completed", "Completed tasks cannot be claimed");
      if (row.status === "blocked")
        throw new CollabError("task_blocked", "Blocked tasks must be unblocked before claiming", { blocker: row.blocker });
      if (row.status === "claimed") {
        throw new CollabError("task_claimed", "Task already has an active claim", {
          assignee: row.assignee,
          lease_expires_at: row.lease_expires_at
        });
      }
      this.requireDependenciesComplete(row);
      this.requirePathsAvailable(row);
      const now = this.timestamp();
      const leaseId = `lease_${randomUUID()}`;
      const expiresAt = addSeconds(now, normalized.ttl_seconds);
      const nextVersion = row.version + 1;
      this.db.query(`
        UPDATE tasks SET status = 'claimed', assignee = ?, lease_id = ?, lease_expires_at = ?,
          blocker = NULL, version = ?, updated_at = ?
        WHERE workspace_id = ? AND id = ?
      `).run(normalized.actor, leaseId, expiresAt, nextVersion, now, input.workspace_id, normalized.task_id);
      this.appendEvent(input.workspace_id, "task.claimed", normalized.task_id, normalized.actor, {
        lease_id: leaseId,
        lease_expires_at: expiresAt,
        previous_assignee: expired ? priorAssignee : null,
        version: nextVersion
      });
      return this.requireTask(input.workspace_id, normalized.task_id);
    });
  }
  renewLease(input) {
    if (input.expected_version !== undefined)
      validateExpectedVersion(input.expected_version);
    const normalized = {
      ...normalizeMutation(input),
      task_id: validateId(input.task_id, "task_id"),
      lease_id: validateId(input.lease_id, "lease_id"),
      ...input.expected_version === undefined ? {} : { expected_version: input.expected_version }
    };
    const ttl = validateTtl(input.ttl_seconds);
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "task.renew", { ...normalized, ttl_seconds: ttl }, () => {
      const row = this.requireTaskRow(input.workspace_id, normalized.task_id);
      this.requireActiveLease(row, normalized.actor, normalized.lease_id);
      const now = this.timestamp();
      const candidate = addSeconds(now, ttl);
      const expiresAt = row.lease_expires_at && row.lease_expires_at > candidate ? row.lease_expires_at : candidate;
      const version = row.version;
      this.db.query(`
        UPDATE tasks SET lease_expires_at = ?, version = ?, updated_at = ?
        WHERE workspace_id = ? AND id = ?
      `).run(expiresAt, version, now, input.workspace_id, normalized.task_id);
      this.appendEvent(input.workspace_id, "task.lease_renewed", normalized.task_id, normalized.actor, {
        lease_id: normalized.lease_id,
        lease_expires_at: expiresAt,
        version
      });
      return this.requireTask(input.workspace_id, normalized.task_id);
    });
  }
  progressTask(input) {
    const normalized = { ...normalizeLeaseInput(input), message: cleanText(input.message, "message", 2000) };
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "task.progress", normalized, () => {
      const row = this.requireTaskRow(input.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveLease(row, normalized.actor, normalized.lease_id);
      const now = this.timestamp();
      const version = row.version + 1;
      this.db.query(`
        UPDATE tasks SET latest_progress = ?, version = ?, updated_at = ?
        WHERE workspace_id = ? AND id = ?
      `).run(normalized.message, version, now, input.workspace_id, normalized.task_id);
      this.appendEvent(input.workspace_id, "task.progressed", normalized.task_id, normalized.actor, {
        message: normalized.message,
        version
      });
      return this.requireTask(input.workspace_id, normalized.task_id);
    });
  }
  releaseTask(input) {
    const normalized = { ...normalizeLeaseInput(input), summary: optionalText(input.summary, "summary", 2000) };
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "task.release", normalized, () => {
      const row = this.requireTaskRow(input.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveLease(row, normalized.actor, normalized.lease_id);
      return this.clearClaim(row, normalized.actor, "task.released", { summary: normalized.summary });
    });
  }
  blockTask(input) {
    const normalized = { ...normalizeLeaseInput(input), blocker: cleanText(input.blocker, "blocker", 2000) };
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "task.block", normalized, () => {
      const row = this.requireTaskRow(input.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveLease(row, normalized.actor, normalized.lease_id);
      const now = this.timestamp();
      const version = row.version + 1;
      this.db.query(`
        UPDATE tasks SET status = 'blocked', assignee = NULL, lease_id = NULL,
          lease_expires_at = NULL, blocker = ?, version = ?, updated_at = ?
        WHERE workspace_id = ? AND id = ?
      `).run(normalized.blocker, version, now, input.workspace_id, normalized.task_id);
      this.expirePendingHandoffs(input.workspace_id, normalized.task_id, now, normalized.actor, "task_blocked");
      this.appendEvent(input.workspace_id, "task.blocked", normalized.task_id, normalized.actor, {
        blocker: normalized.blocker,
        version
      });
      return this.requireTask(input.workspace_id, normalized.task_id);
    });
  }
  unblockTask(input) {
    const normalized = {
      ...normalizeVersionedMutation(input),
      workspace_id: input.workspace_id,
      task_id: validateId(input.task_id, "task_id"),
      note: optionalText(input.note, "note", 2000)
    };
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "task.unblock", normalized, () => {
      const row = this.requireTaskRow(input.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      if (row.status !== "blocked")
        throw new CollabError("task_not_blocked", "Only blocked tasks can be unblocked");
      const now = this.timestamp();
      const version = row.version + 1;
      this.db.query(`
        UPDATE tasks SET status = 'open', blocker = NULL, version = ?, updated_at = ?
        WHERE workspace_id = ? AND id = ?
      `).run(version, now, input.workspace_id, normalized.task_id);
      this.appendEvent(input.workspace_id, "task.unblocked", normalized.task_id, normalized.actor, {
        note: normalized.note,
        version
      });
      return this.requireTask(input.workspace_id, normalized.task_id);
    });
  }
  completeTask(input) {
    const normalized = { ...normalizeLeaseInput(input), summary: cleanText(input.summary, "summary", 4000) };
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "task.complete", normalized, () => {
      const row = this.requireTaskRow(input.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveLease(row, normalized.actor, normalized.lease_id);
      const now = this.timestamp();
      const version = row.version + 1;
      this.db.query(`
        UPDATE tasks SET status = 'completed', assignee = NULL, lease_id = NULL,
          lease_expires_at = NULL, blocker = NULL, latest_progress = ?, version = ?,
          updated_at = ?, completed_at = ?
        WHERE workspace_id = ? AND id = ?
      `).run(normalized.summary, version, now, now, input.workspace_id, normalized.task_id);
      this.expirePendingHandoffs(input.workspace_id, normalized.task_id, now, normalized.actor, "task_completed");
      this.appendEvent(input.workspace_id, "task.completed", normalized.task_id, normalized.actor, {
        completion_basis: "actor_reported",
        note: "Completion records the reporting actor's outcome; it is not coordinator review or acceptance.",
        summary: normalized.summary,
        version
      });
      return this.requireTask(input.workspace_id, normalized.task_id);
    });
  }
  attachArtifact(input) {
    const normalized = {
      ...normalizeLeaseInput(input),
      kind: input.kind,
      uri: cleanText(input.uri, "uri", 2000),
      sha256: input.sha256 ? validateSha256(input.sha256) : null,
      media_type: optionalText(input.media_type, "media_type", 200),
      label: optionalText(input.label, "label", 300)
    };
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "artifact.attach", normalized, () => {
      const row = this.requireTaskRow(input.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveLease(row, normalized.actor, normalized.lease_id);
      const now = this.timestamp();
      const id = `artifact_${randomUUID()}`;
      this.db.query(`
        INSERT INTO artifacts
          (id, workspace_id, task_id, kind, uri, sha256, media_type, label, attached_by, attached_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.workspace_id, normalized.task_id, normalized.kind, normalized.uri, normalized.sha256, normalized.media_type, normalized.label, normalized.actor, now);
      const version = row.version + 1;
      this.db.query(`UPDATE tasks SET version = ?, updated_at = ? WHERE workspace_id = ? AND id = ?`).run(version, now, input.workspace_id, normalized.task_id);
      const artifact = this.requireArtifact(id);
      this.appendEvent(input.workspace_id, "artifact.attached", normalized.task_id, normalized.actor, {
        artifact,
        version
      });
      return { task: this.requireTask(input.workspace_id, normalized.task_id), artifact };
    });
  }
  recordDecision(input) {
    const normalized = {
      ...normalizeMutation(input),
      workspace_id: input.workspace_id,
      topic: cleanText(input.topic, "topic", 500),
      decision: cleanText(input.decision, "decision", 4000),
      rationale: optionalText(input.rationale, "rationale", 4000)
    };
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "decision.record", normalized, () => {
      this.requireWorkspace(input.workspace_id);
      const id = `decision_${randomUUID()}`;
      const now = this.timestamp();
      this.db.query(`
        INSERT INTO decisions (id, workspace_id, topic, decision, rationale, recorded_by, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.workspace_id, normalized.topic, normalized.decision, normalized.rationale, normalized.actor, now);
      const decision = this.requireDecision(id);
      this.appendEvent(input.workspace_id, "decision.recorded", id, normalized.actor, { decision });
      return decision;
    });
  }
  appendReportForSession(input) {
    const normalized = {
      task_id: input.task_id ? validateId(input.task_id, "task_id") : null,
      to_session_id: input.to_session_id ? validateId(input.to_session_id, "to_session_id") : null,
      kind: validateReportKind(input.kind),
      body: cleanText(input.body, "body", MAX_REPORT_BODY),
      evidence_refs: normalizeEvidenceRefs(input.evidence_refs ?? []),
      confidence: validateReportConfidence(input.confidence ?? "unknown"),
      confidence_basis: optionalText(input.confidence_basis, "confidence_basis", 2000),
      limits: optionalText(input.limits, "limits", 2000),
      relation: validateReportRelation(input.relation ?? "informs"),
      target_report_id: input.target_report_id ? validateId(input.target_report_id, "target_report_id") : null,
      authority_scope: optionalText(input.authority_scope, "authority_scope", 1000),
      authority_basis: optionalText(input.authority_basis, "authority_basis", 2000),
      ...input.to_person === true ? { to_person: true } : {}
    };
    return this.mutateAsSession(input, input.idempotency_key, "report.append.v2", normalized, (session) => {
      this.validateReportInput(session, normalized);
      this.refuseProposalRewrite(normalized);
      return this.appendReportInternal(session, normalized);
    });
  }
  openProposalForSession(input) {
    const normalized = {
      ...normalizeProposalTerms(input),
      task_id: input.task_id ? validateId(input.task_id, "task_id") : null,
      confidence: validateReportConfidence(input.confidence ?? "unknown"),
      confidence_basis: optionalText(input.confidence_basis, "confidence_basis", 2000),
      limits: optionalText(input.limits, "limits", 2000),
      origin: validateProposalOrigin(input.origin ?? "ai"),
      supersedes_report_id: input.supersedes_report_id ? validateId(input.supersedes_report_id, "supersedes_report_id") : null,
      ...ruleRequestField(input.rule)
    };
    return this.mutateAsSession(input, input.idempotency_key, "proposal.open.v1", normalized, (session) => {
      const reportInput = {
        task_id: normalized.task_id,
        to_session_id: null,
        kind: "proposal",
        body: normalized.question,
        evidence_refs: normalized.evidence_refs,
        confidence: normalized.confidence,
        confidence_basis: normalized.confidence_basis,
        limits: normalized.limits,
        relation: normalized.supersedes_report_id ? "supersedes" : "informs",
        target_report_id: normalized.supersedes_report_id,
        authority_scope: null,
        authority_basis: null
      };
      this.validateReportInput(session, reportInput);
      if (normalized.supersedes_report_id) {
        this.requireOpenToRevision(session.workspace_id, normalized.supersedes_report_id);
      }
      return this.openProposalInternal(session, this.consentVoice(session.id), reportInput, {
        ...normalized,
        rule: normalized.rule ?? CONSENT_RULE
      });
    });
  }
  openPersonProposal(input) {
    const normalized = { ...normalizeProposalTerms(input), ...ruleRequestField(input.rule) };
    const idempotencyKey = validateIdempotencyKey(input.idempotency_key);
    return this.mutate(input.workspace_id, PERSON_DESK_ACTOR, idempotencyKey, "person.proposal.open.v1", normalized, () => {
      for (const reference of normalized.evidence_refs)
        this.requireEvidenceRef(input.workspace_id, reference);
      const reportInput = {
        task_id: null,
        to_session_id: null,
        kind: "proposal",
        body: normalized.question,
        evidence_refs: normalized.evidence_refs,
        confidence: "unknown",
        confidence_basis: null,
        limits: PERSON_DESK_LIMITS,
        relation: "informs",
        target_report_id: null,
        authority_scope: null,
        authority_basis: null
      };
      return this.openProposalInternal({ workspace_id: input.workspace_id, actor: PERSON_DESK_ACTOR, id: null }, PERSON_VOICE_ID, reportInput, { ...normalized, origin: "person_relayed", supersedes_report_id: null, rule: normalized.rule ?? CONSENT_RULE });
    });
  }
  withdrawPersonProposal(input) {
    const normalized = {
      proposal_report_id: validateId(input.proposal_report_id, "proposal_report_id"),
      reason: cleanText(input.reason, "reason", 2000)
    };
    const idempotencyKey = validateIdempotencyKey(input.idempotency_key);
    return this.mutate(input.workspace_id, PERSON_DESK_ACTOR, idempotencyKey, "person.proposal.withdraw.v1", normalized, () => {
      const proposal = this.requireReport(normalized.proposal_report_id);
      this.requireProposalTerms(input.workspace_id, proposal.id);
      if (proposal.from_session_id !== null || proposal.from_actor !== PERSON_DESK_ACTOR) {
        throw new CollabError("report_author_mismatch", "The desk withdraws only proposals it opened; an agent withdraws its own");
      }
      if (this.proposalRetirement(input.workspace_id, proposal.id)) {
        throw new CollabError("proposal_not_on_table", "This proposal was already withdrawn or superseded");
      }
      this.appendReportInternal({ workspace_id: input.workspace_id, actor: PERSON_DESK_ACTOR, id: null }, {
        task_id: proposal.task_id,
        to_session_id: null,
        kind: "observation",
        body: normalized.reason,
        evidence_refs: [],
        confidence: "unknown",
        confidence_basis: null,
        limits: PERSON_DESK_LIMITS,
        relation: "withdraws",
        target_report_id: proposal.id,
        authority_scope: null,
        authority_basis: null,
        about_proposal_id: proposal.id
      });
      return this.proposalStatusInternal(input.workspace_id, proposal.id);
    });
  }
  openProposalInternal(author, authorVoiceId, reportInput, terms) {
    const now = this.timestamp();
    const voices = this.liveVoiceSnapshot(author.workspace_id, now);
    const report = this.appendReportInternal(author, reportInput);
    const closesAt = new Date(Date.parse(now) + terms.consult_seconds * 1000).toISOString();
    const proposalSha256 = sha2564(proposalBytes({
      workspace_id: author.workspace_id,
      report_id: report.id,
      task_id: report.task_id,
      question: report.body,
      criteria: terms.criteria,
      extent: terms.extent,
      relies_on: report.evidence_refs,
      known_conflicts: terms.known_conflicts,
      limits: report.limits,
      origin: terms.origin,
      topic: terms.topic,
      closes_at: closesAt,
      supersedes_report_id: terms.supersedes_report_id
    }, terms.rule));
    const event = this.appendEvent(author.workspace_id, "proposal.opened", report.id, author.actor, {
      rule: terms.rule,
      proposal_sha256: proposalSha256,
      criteria: terms.criteria,
      extent: terms.extent,
      known_conflicts: terms.known_conflicts,
      origin: terms.origin,
      topic: terms.topic,
      closes_at: closesAt,
      voices,
      author_voice_id: authorVoiceId
    }, author.id);
    this.db.query(`
      INSERT INTO proposal_terms (
        report_id, workspace_id, rule, criteria, extent, known_conflicts, origin,
        topic, closes_at, voices_json, author_voice_id, proposal_sha256,
        opened_event_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(report.id, author.workspace_id, terms.rule, terms.criteria, terms.extent, terms.known_conflicts, terms.origin, terms.topic, closesAt, canonicalJson(voices), authorVoiceId, proposalSha256, event.id, now);
    return this.proposalStatusInternal(author.workspace_id, report.id);
  }
  relayProposalRejectionForSession(input) {
    const normalized = {
      proposal_report_id: validateId(input.proposal_report_id, "proposal_report_id"),
      proposal_sha256: validateSha256(input.proposal_sha256),
      reason: cleanText(input.reason, "reason", 2000)
    };
    return this.mutateAsSession(input, input.idempotency_key, "proposal.reject.relay.v1", normalized, (session) => {
      const terms = this.requireProposalTerms(session.workspace_id, normalized.proposal_report_id);
      return this.recordPersonAct({
        workspace_id: terms.workspace_id,
        proposal_report_id: terms.report_id,
        proposal_sha256: normalized.proposal_sha256,
        act: "reject",
        reason: normalized.reason,
        basis: "relayed_by_session",
        actor: session.actor,
        session_id: session.id,
        proof: null,
        expected_ai_snapshot: null
      });
    });
  }
  personActChallenge(input) {
    const act = validatePersonAct(input.act);
    const reason = normalizeActReason(act, input.reason);
    const transaction = this.db.transaction(() => {
      const terms = this.requireProposalTermsById(validateId(input.proposal_report_id, "proposal_report_id"));
      const status = this.proposalStatusInternal(terms.workspace_id, terms.report_id);
      this.refuseUnrecordableAct(status, act, "user_verified_passkey");
      const prior = this.personActCount(terms.report_id);
      const aiSnapshot = aiSnapshotOf(status);
      return {
        workspace_id: terms.workspace_id,
        proposal_report_id: terms.report_id,
        proposal_sha256: terms.proposal_sha256,
        act,
        reason,
        prior_person_acts: prior,
        ai_snapshot: aiSnapshot,
        ...personActChallenge({
          act,
          workspace_id: terms.workspace_id,
          proposal_report_id: terms.report_id,
          proposal_sha256: terms.proposal_sha256,
          prior_person_acts: prior,
          reason,
          ai_snapshot: aiSnapshot
        }),
        passkeys: this.listPersonPasskeys().filter((key) => key.revoked_at === null).map((key) => ({
          credential_id: key.credential_id,
          rp_id: key.rp_id,
          origin: key.origin,
          label: key.label,
          fingerprint: key.fingerprint
        }))
      };
    });
    return transaction.deferred();
  }
  recordPersonActAtTerminal(input) {
    const act = validatePersonAct(input.act);
    const reason = normalizeActReason(act, input.reason);
    const transaction = this.db.transaction(() => {
      const terms = this.requireProposalTermsById(validateId(input.proposal_report_id, "proposal_report_id"));
      return this.recordPersonAct({
        workspace_id: terms.workspace_id,
        proposal_report_id: terms.report_id,
        proposal_sha256: validateSha256(input.proposal_sha256),
        act,
        reason,
        basis: "controlling_terminal",
        actor: PERSON_TERMINAL_ACTOR,
        session_id: null,
        proof: null,
        expected_ai_snapshot: input.expected_ai_snapshot
      });
    });
    const status = transaction.immediate();
    this.tightenFileModes();
    return status;
  }
  recordPersonActWithPasskey(input) {
    const act = validatePersonAct(input.act);
    const reason = normalizeActReason(act, input.reason);
    const assertion = normalizePasskeyAssertion(input.assertion);
    const transaction = this.db.transaction(() => {
      const terms = this.requireProposalTermsById(validateId(input.proposal_report_id, "proposal_report_id"));
      const passkey = this.listPersonPasskeys().find((key) => key.credential_id === assertion.credential_id && key.revoked_at === null);
      if (!passkey) {
        throw new CollabError("passkey_not_enrolled", "No active enrolled passkey has this credential id");
      }
      const status2 = this.proposalStatusInternal(terms.workspace_id, terms.report_id);
      const aiSnapshot = aiSnapshotOf(status2);
      const derived = personActChallenge({
        act,
        workspace_id: terms.workspace_id,
        proposal_report_id: terms.report_id,
        proposal_sha256: terms.proposal_sha256,
        prior_person_acts: this.personActCount(terms.report_id),
        reason,
        ai_snapshot: aiSnapshot
      });
      const { sign_count } = verifyPasskeyAssertion({
        passkey,
        assertion,
        expected_challenge: derived.challenge
      });
      this.db.query(`UPDATE person_passkeys SET sign_count = ? WHERE credential_id = ?`).run(sign_count, passkey.credential_id);
      return this.recordPersonAct({
        workspace_id: terms.workspace_id,
        proposal_report_id: terms.report_id,
        proposal_sha256: terms.proposal_sha256,
        act,
        reason,
        basis: "user_verified_passkey",
        actor: PERSON_PASSKEY_ACTOR,
        session_id: null,
        proof: {
          ...assertion,
          public_key_spki: passkey.public_key_spki,
          rp_id: passkey.rp_id,
          origin: passkey.origin,
          challenge_bytes: derived.challenge_bytes,
          challenge: derived.challenge,
          sign_count
        },
        expected_ai_snapshot: aiSnapshot
      });
    });
    const status = transaction.immediate();
    this.tightenFileModes();
    return status;
  }
  personSetAsideChallenge(input) {
    const reason = normalizeSetAsideReason(input.reason);
    const challengeId = validateId(input.challenge_report_id, "challenge_report_id");
    return this.db.transaction(() => {
      const terms = this.requireProposalTermsById(validateId(input.proposal_report_id, "proposal_report_id"));
      const facts = this.setAsideFacts(terms, challengeId, reason);
      return {
        ...facts.bytes,
        act: "set_aside",
        objection: { ...facts.challenge, author_basis: "self_declared" },
        challenger: facts.challenger,
        ...setAsideChallenge(facts.bytes),
        passkeys: this.listPersonPasskeys().filter((key) => key.revoked_at === null).map((key) => ({
          credential_id: key.credential_id,
          rp_id: key.rp_id,
          origin: key.origin,
          label: key.label,
          fingerprint: key.fingerprint
        }))
      };
    }).deferred();
  }
  recordSetAsideAtTerminal(input) {
    const reason = normalizeSetAsideReason(input.reason);
    const challengeId = validateId(input.challenge_report_id, "challenge_report_id");
    const transaction = this.db.transaction(() => {
      const terms = this.requireProposalTermsById(validateId(input.proposal_report_id, "proposal_report_id"));
      return this.recordSetAside(terms, challengeId, reason, {
        basis: "controlling_terminal",
        actor: PERSON_TERMINAL_ACTOR,
        proof: null,
        proposal_sha256: validateSha256(input.proposal_sha256),
        challenge_sha256: validateSha256(input.challenge_sha256),
        expected_ai_snapshot: input.expected_ai_snapshot
      });
    });
    const status = transaction.immediate();
    this.tightenFileModes();
    return status;
  }
  recordSetAsideWithPasskey(input) {
    const reason = normalizeSetAsideReason(input.reason);
    const challengeId = validateId(input.challenge_report_id, "challenge_report_id");
    const assertion = normalizePasskeyAssertion(input.assertion);
    const transaction = this.db.transaction(() => {
      const terms = this.requireProposalTermsById(validateId(input.proposal_report_id, "proposal_report_id"));
      const passkey = this.listPersonPasskeys().find((key) => key.credential_id === assertion.credential_id && key.revoked_at === null);
      if (!passkey) {
        throw new CollabError("passkey_not_enrolled", "No active enrolled passkey has this credential id");
      }
      const facts = this.setAsideFacts(terms, challengeId, reason);
      const derived = setAsideChallenge(facts.bytes);
      const { sign_count } = verifyPasskeyAssertion({ passkey, assertion, expected_challenge: derived.challenge });
      this.db.query(`UPDATE person_passkeys SET sign_count = ? WHERE credential_id = ?`).run(sign_count, passkey.credential_id);
      return this.recordSetAside(terms, challengeId, reason, {
        basis: "user_verified_passkey",
        actor: PERSON_PASSKEY_ACTOR,
        proof: {
          ...assertion,
          public_key_spki: passkey.public_key_spki,
          rp_id: passkey.rp_id,
          origin: passkey.origin,
          challenge_bytes: derived.challenge_bytes,
          challenge: derived.challenge,
          sign_count
        },
        proposal_sha256: facts.bytes.proposal_sha256,
        challenge_sha256: facts.bytes.challenge_sha256,
        expected_ai_snapshot: facts.bytes.ai_snapshot
      });
    });
    const status = transaction.immediate();
    this.tightenFileModes();
    return status;
  }
  personSetAsideOptions(workspaceId, proposalIds) {
    this.requireWorkspace(workspaceId);
    return this.db.transaction(() => {
      const options = {};
      for (const proposalId of proposalIds) {
        const terms = this.requireProposalTerms(workspaceId, validateId(proposalId, "proposal_report_id"));
        if (terms.rule !== CONSENT_RULE_V2)
          continue;
        const status = this.proposalStatusInternal(workspaceId, terms.report_id);
        options[terms.report_id] = status.ai.unresolved_challenge_report_ids.map((challengeId) => {
          const challenge = this.requireReport(challengeId);
          const presence = this.challengerPresence(workspaceId, challenge.from_session_id);
          let refusal = null;
          try {
            this.refuseUnrecordableSetAside(status, challenge, presence);
          } catch (error) {
            if (!(error instanceof CollabError))
              throw error;
            refusal = { error: error.code, message: error.message };
          }
          return {
            challenge_report_id: challengeId,
            by: { session: challenge.from_session_id, name: challenge.from_actor, basis: "self_declared" },
            can_set_aside: refusal === null,
            refusal,
            challenger: presence
          };
        });
      }
      return options;
    }).deferred();
  }
  enrollPersonPasskey(input) {
    const enrollment = normalizePasskeyEnrollment(input);
    const transaction = this.db.transaction(() => {
      if (this.db.query(`SELECT 1 FROM person_passkeys WHERE credential_id = ?`).get(enrollment.credential_id)) {
        throw new CollabError("passkey_already_enrolled", "This credential id is already enrolled");
      }
      this.db.query(`
        INSERT INTO person_passkeys (
          credential_id, public_key_spki, algorithm, rp_id, origin, label,
          fingerprint, sign_count, enrolled_at, revoked_at
        ) VALUES (?, ?, -7, ?, ?, ?, ?, 0, ?, NULL)
      `).run(enrollment.credential_id, enrollment.public_key_spki, enrollment.rp_id, enrollment.origin, enrollment.label, passkeyFingerprint(enrollment.public_key_spki), this.timestamp());
    });
    transaction.immediate();
    this.tightenFileModes();
    return this.listPersonPasskeys().find((key) => key.credential_id === enrollment.credential_id);
  }
  listPersonPasskeys() {
    return this.db.query(`SELECT * FROM person_passkeys ORDER BY enrolled_at, credential_id`).all().map((row) => ({ ...row, algorithm: -7 }));
  }
  revokePersonPasskey(credentialId) {
    const transaction = this.db.transaction(() => {
      const changed = this.db.query(`
        UPDATE person_passkeys SET revoked_at = ? WHERE credential_id = ? AND revoked_at IS NULL
      `).run(this.timestamp(), credentialId);
      if (changed.changes === 0) {
        throw new CollabError("passkey_not_enrolled", "No active enrolled passkey has this credential id");
      }
    });
    transaction.immediate();
    this.tightenFileModes();
    return this.listPersonPasskeys().find((key) => key.credential_id === credentialId);
  }
  appendPersonNote(input) {
    const normalized = {
      body: cleanText(input.body, "body", MAX_REPORT_BODY),
      proposal_report_id: input.proposal_report_id ? validateId(input.proposal_report_id, "proposal_report_id") : null
    };
    const idempotencyKey = validateIdempotencyKey(input.idempotency_key);
    return this.mutate(input.workspace_id, PERSON_DESK_ACTOR, idempotencyKey, "person.note.v1", normalized, () => {
      let toSessionId = null;
      if (normalized.proposal_report_id) {
        const terms = this.requireProposalTerms(input.workspace_id, normalized.proposal_report_id);
        toSessionId = this.requireReport(terms.report_id).from_session_id;
      }
      return this.appendReportInternal({ workspace_id: input.workspace_id, actor: PERSON_DESK_ACTOR, id: null }, {
        task_id: null,
        to_session_id: toSessionId,
        kind: "observation",
        body: normalized.body,
        evidence_refs: normalized.proposal_report_id ? [`report:${normalized.proposal_report_id}`] : [],
        confidence: "unknown",
        confidence_basis: null,
        limits: PERSON_DESK_LIMITS,
        relation: "informs",
        target_report_id: null,
        authority_scope: null,
        authority_basis: null,
        ...normalized.proposal_report_id ? { about_proposal_id: normalized.proposal_report_id } : {}
      });
    });
  }
  personInbox(workspaceId) {
    this.requireWorkspace(workspaceId);
    const transaction = this.db.transaction(() => {
      const context = this.proposalReadContext(workspaceId);
      const settled = new Set(["consented", "split", "lapsed"]);
      const candidates = this.db.query(`
        SELECT t.report_id FROM proposal_terms t JOIN reports r ON r.id = t.report_id
        WHERE t.workspace_id = ?
          AND NOT EXISTS (SELECT 1 FROM proposal_person_acts a WHERE a.proposal_report_id = t.report_id)
        ORDER BY r.event_sequence DESC
        LIMIT ?
      `).all(workspaceId, MAX_INBOX_SCAN);
      const awaiting = [];
      const unreadable = [];
      for (const row of candidates) {
        if (awaiting.length >= MAX_INBOX_PROPOSALS)
          break;
        const status = this.readProposalStatus(context, row.report_id, unreadable);
        if (status && settled.has(status.ai.position))
          awaiting.push(status);
      }
      const addressed = this.db.query(`
        SELECT r.* FROM person_addressed_reports p JOIN reports r ON r.id = p.report_id
        WHERE p.workspace_id = ? ORDER BY r.event_sequence DESC LIMIT 50
      `).all(workspaceId).map(reportFromRow);
      return { workspace_id: workspaceId, awaiting_person: awaiting, addressed_reports: addressed, unreadable };
    });
    return transaction.deferred();
  }
  personInboxSummary() {
    return this.listWorkspaces().map((workspace) => {
      const inbox = this.personInbox(workspace.id);
      return {
        workspace_id: workspace.id,
        awaiting_person: inbox.awaiting_person.length,
        addressed_reports: inbox.addressed_reports.length,
        latest_report_id: inbox.addressed_reports[0]?.id ?? null
      };
    });
  }
  listWorkspaces() {
    return this.db.query(`SELECT id, name, root_path, created_at FROM workspaces ORDER BY created_at, id`).all();
  }
  proposalStatus(workspaceId, proposalReportId) {
    this.requireWorkspace(workspaceId);
    const id = validateId(proposalReportId, "proposal_report_id");
    this.requireProposalTerms(workspaceId, id);
    return this.db.transaction(() => this.proposalStatusInternal(workspaceId, id)).deferred();
  }
  proposalStatusById(proposalReportId) {
    const terms = this.requireProposalTermsById(validateId(proposalReportId, "proposal_report_id"));
    return this.db.transaction(() => this.proposalStatusInternal(terms.workspace_id, terms.report_id)).deferred();
  }
  listProposalStatuses(workspaceId, options = {}) {
    this.requireWorkspace(workspaceId);
    const limit = options.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new CollabError("invalid_limit", "Proposal limit must be between 1 and 50");
    }
    return this.db.transaction(() => {
      const context = this.proposalReadContext(workspaceId);
      const rows = this.db.query(`
        SELECT t.report_id FROM proposal_terms t
        JOIN reports r ON r.id = t.report_id
        WHERE t.workspace_id = ?
        ORDER BY r.event_sequence DESC
        LIMIT ?
      `).all(workspaceId, limit);
      const unreadable = [];
      const proposals = rows.map((row) => this.readProposalStatus(context, row.report_id, unreadable)).filter((status) => status !== null);
      return { proposals, unreadable };
    }).deferred();
  }
  readProposalStatus(context, reportId, unreadable) {
    try {
      return this.proposalStatusInternal(context.workspaceId, reportId, context);
    } catch (error) {
      if (!(error instanceof CollabError))
        throw error;
      unreadable.push({ proposal_report_id: reportId, error: error.code });
      return null;
    }
  }
  refuseUnrecordableAct(status, act, basis) {
    if (status.ai.position === "withdrawn" || status.ai.position === "superseded") {
      throw new CollabError("proposal_not_on_table", "A withdrawn or superseded proposal is no longer on the table", { position: status.ai.position, obsoleted_by_report_id: status.ai.obsoleted_by_report_id });
    }
    const latest = status.person.acts.at(-1) ?? null;
    if (act === "agree") {
      if (basis === "relayed_by_session") {
        throw new CollabError("consent_not_relayable", "A person's agreement is never recorded through a session");
      }
      if (status.ai.position !== "consented") {
        throw new CollabError("ai_not_consented", "The agents have not consented; a person agrees only after they settle", { position: status.ai.position });
      }
      if (latest?.act === "agree") {
        throw new CollabError("already_agreed", "The latest person act already agrees to these bytes");
      }
      return;
    }
    if (latest?.act === "reject" && (basis === "relayed_by_session" || latest.basis !== "relayed_by_session")) {
      throw new CollabError("already_rejected", "The latest person act already rejects these bytes");
    }
  }
  recordPersonAct(input) {
    const current = this.proposalStatusInternal(input.workspace_id, input.proposal_report_id);
    if (current.proposal_sha256 !== input.proposal_sha256) {
      throw new CollabError("proposal_hash_mismatch", "The act names different proposal bytes; read the proposal status again", { proposal_sha256: current.proposal_sha256 });
    }
    this.refuseUnrecordableAct(current, input.act, input.basis);
    const aiSnapshot = aiSnapshotOf(current);
    if (input.expected_ai_snapshot && canonicalJson(input.expected_ai_snapshot) !== canonicalJson(aiSnapshot)) {
      throw new CollabError("ai_position_changed", "The agents' position changed since it was shown; read the proposal status again", { ai_snapshot: aiSnapshot });
    }
    const id = `person_act_${randomUUID()}`;
    const now = this.timestamp();
    const personAct = {
      id,
      proposal_report_id: input.proposal_report_id,
      proposal_sha256: input.proposal_sha256,
      act: input.act,
      party: "person",
      basis: input.basis,
      reason: input.reason,
      relayed_by_session_id: input.basis === "relayed_by_session" ? input.session_id : null,
      ai_snapshot: aiSnapshot,
      proof: input.proof
    };
    const event = this.appendEvent(input.workspace_id, input.act === "agree" ? "proposal.agreed" : "proposal.rejected", input.proposal_report_id, input.actor, { person_act: personAct }, input.session_id);
    this.db.query(`
      INSERT INTO proposal_person_acts (
        id, workspace_id, proposal_report_id, proposal_sha256, act, party, basis,
        reason, relayed_by_session_id, ai_snapshot_json, proof_json, created_at, event_sequence
      ) VALUES (?, ?, ?, ?, ?, 'person', ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.workspace_id, input.proposal_report_id, input.proposal_sha256, input.act, input.basis, input.reason, personAct.relayed_by_session_id, canonicalJson(aiSnapshot), input.proof ? canonicalJson(input.proof) : null, now, event.sequence);
    return this.proposalStatusInternal(input.workspace_id, input.proposal_report_id);
  }
  setAsideFacts(terms, challengeId, reason) {
    const status = this.proposalStatusInternal(terms.workspace_id, terms.report_id);
    const row = this.db.query(`SELECT * FROM reports WHERE id = ?`).get(challengeId);
    const challenge = row ? reportFromRow(row) : null;
    const presence = this.challengerPresence(terms.workspace_id, challenge?.from_session_id ?? null);
    this.refuseUnrecordableSetAside(status, challenge, presence);
    return {
      status,
      challenge,
      challenger: { voice_id: presence.voice_id, session_ids: presence.session_ids, last_seen_at: presence.last_seen_at },
      bytes: {
        workspace_id: terms.workspace_id,
        proposal_report_id: terms.report_id,
        proposal_sha256: terms.proposal_sha256,
        challenge_report_id: challengeId,
        challenge_sha256: challengeContentSha256(challenge),
        reason,
        prior_person_acts: this.personActCount(terms.report_id),
        prior_set_asides: this.setAsideCount(terms.workspace_id, terms.report_id),
        ai_snapshot: aiSnapshotOf(status)
      }
    };
  }
  refuseUnrecordableSetAside(status, challenge, presence) {
    const proposalId = status.proposal.id;
    if (status.rule !== CONSENT_RULE_V2) {
      throw setAsideRefusal("rule_has_no_set_aside", { proposal_report_id: proposalId, rule: status.rule });
    }
    if (status.ai.position === "withdrawn" || status.ai.position === "superseded") {
      throw setAsideRefusal("proposal_not_on_table", {
        position: status.ai.position,
        obsoleted_by_report_id: status.ai.obsoleted_by_report_id
      });
    }
    if (!challenge || challenge.workspace_id !== status.proposal.workspace_id || challenge.relation !== "challenges" || challenge.target_report_id !== proposalId) {
      throw setAsideRefusal("challenge_not_standing", {
        challenge_report_id: challenge?.id ?? null,
        challenge_state: "not_a_challenge_to_this_proposal"
      }, "That report is not a challenge to this proposal");
    }
    const earlier = (status.set_asides ?? []).find((entry) => entry.challenge_report_id === challenge.id);
    if (earlier) {
      throw setAsideRefusal("already_set_aside", {
        challenge_report_id: challenge.id,
        set_aside_id: earlier.id,
        set_aside_at: earlier.created_at
      });
    }
    if (!status.ai.unresolved_challenge_report_ids.includes(challenge.id)) {
      throw setAsideRefusal("challenge_not_standing", {
        challenge_report_id: challenge.id,
        challenge_state: "withdrawn_or_lifted_by_its_voice"
      }, "That challenge no longer stands: it was withdrawn or lifted by its own voice");
    }
    if (presence.live_sessions.length > 0) {
      throw setAsideRefusal("challenger_present", {
        challenge_report_id: challenge.id,
        live_sessions: presence.live_sessions
      });
    }
  }
  recordSetAside(terms, challengeId, reason, act) {
    if (act.proposal_sha256 !== terms.proposal_sha256) {
      throw setAsideRefusal("proposal_hash_mismatch", { proposal_sha256: terms.proposal_sha256 });
    }
    const facts = this.setAsideFacts(terms, challengeId, reason);
    if (act.challenge_sha256 !== facts.bytes.challenge_sha256) {
      throw setAsideRefusal("challenge_hash_mismatch", { challenge_sha256: facts.bytes.challenge_sha256 });
    }
    if (canonicalJson(act.expected_ai_snapshot) !== canonicalJson(facts.bytes.ai_snapshot)) {
      throw setAsideRefusal("ai_position_changed", { ai_snapshot: facts.bytes.ai_snapshot });
    }
    const record = {
      id: `set_aside_${randomUUID()}`,
      proposal_report_id: terms.report_id,
      proposal_sha256: terms.proposal_sha256,
      challenge_report_id: challengeId,
      challenge_sha256: facts.bytes.challenge_sha256,
      party: "person",
      basis: act.basis,
      reason,
      prior_person_acts: facts.bytes.prior_person_acts,
      prior_set_asides: facts.bytes.prior_set_asides,
      ai_snapshot: facts.bytes.ai_snapshot,
      challenger: facts.challenger,
      proof: act.proof
    };
    const event = this.appendEvent(terms.workspace_id, "proposal.challenge_set_aside", terms.report_id, act.actor, { set_aside: record });
    this.db.query(`
      INSERT INTO proposal_set_asides (
        id, workspace_id, proposal_report_id, challenge_report_id, set_aside_json, created_at, event_sequence
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(record.id, terms.workspace_id, terms.report_id, challengeId, canonicalJson(record), event.occurred_at, event.sequence);
    return this.proposalStatusInternal(terms.workspace_id, terms.report_id);
  }
  challengerPresence(workspaceId, challengerSessionId) {
    if (challengerSessionId === null)
      return { voice_id: null, session_ids: [], last_seen_at: null, live_sessions: [] };
    const observedAt = this.timestamp();
    const voice = this.consentVoice(challengerSessionId);
    const members = this.db.query(`
      SELECT id, actor, status, last_seen_at FROM coordination_sessions WHERE workspace_id = ? ORDER BY id
    `).all(workspaceId).filter((row) => this.consentVoice(row.id) === voice);
    return {
      voice_id: voice,
      session_ids: members.map((row) => row.id),
      last_seen_at: members.map((row) => row.last_seen_at).sort().at(-1) ?? null,
      live_sessions: members.filter((row) => sessionLiveness(row, observedAt) === "live").map((row) => ({ id: row.id, actor: row.actor, last_seen_at: row.last_seen_at }))
    };
  }
  setAsideCount(workspaceId, proposalReportId) {
    return this.db.query(`SELECT COUNT(*) AS count FROM proposal_set_asides WHERE workspace_id = ? AND proposal_report_id = ?`).get(workspaceId, proposalReportId).count;
  }
  proposalSetAsides(workspaceId, proposalReportId) {
    return this.db.query(`
      SELECT s.* FROM proposal_set_asides s
      JOIN reports r ON r.id = s.challenge_report_id
        AND r.workspace_id = s.workspace_id AND r.target_report_id = s.proposal_report_id AND r.relation = 'challenges'
      WHERE s.workspace_id = ? AND s.proposal_report_id = ? ORDER BY s.event_sequence
    `).all(workspaceId, proposalReportId).map(proposalSetAsideFromRow);
  }
  personActCount(proposalReportId) {
    return this.db.query(`SELECT COUNT(*) AS count FROM proposal_person_acts WHERE proposal_report_id = ?`).get(proposalReportId).count;
  }
  requireProposalTermsById(reportId) {
    const row = this.db.query(`SELECT workspace_id FROM proposal_terms WHERE report_id = ?`).get(reportId);
    if (!row) {
      throw new CollabError("proposal_not_found", "No proposal with consent terms has this report id", { proposal_report_id: reportId });
    }
    return this.requireProposalTerms(row.workspace_id, reportId);
  }
  proposalReadContext(workspaceId) {
    return { workspaceId, obsoleted: this.activeObsoletionTargets(workspaceId), voices: new Map };
  }
  proposalRetirement(workspaceId, reportId) {
    return this.db.query(`
      SELECT id, relation, event_sequence FROM reports
      WHERE workspace_id = ? AND target_report_id = ?
        AND relation IN ('withdraws', 'corrects', 'supersedes')
      ORDER BY event_sequence
      LIMIT 1
    `).get(workspaceId, reportId);
  }
  standingProposalChallenges(context, reportId, setAside = new Set) {
    const challenges = this.db.query(`
      SELECT id, from_session_id FROM reports
      WHERE workspace_id = ? AND target_report_id = ? AND relation = 'challenges'
      ORDER BY event_sequence
    `).all(context.workspaceId, reportId);
    const standing = [];
    for (const challenge of challenges) {
      if (context.obsoleted.has(challenge.id))
        continue;
      const answers = this.db.query(`
        SELECT id, relation, from_session_id FROM reports
        WHERE workspace_id = ? AND target_report_id = ? AND relation = 'resolves'
      `).all(context.workspaceId, challenge.id);
      const challengerVoice = challenge.from_session_id ? this.consentVoice(challenge.from_session_id, context) : null;
      const resolved = challengerVoice !== null && answers.some((answer) => !context.obsoleted.has(answer.id) && answer.from_session_id !== null && this.consentVoice(answer.from_session_id, context) === challengerVoice);
      if (!resolved && !setAside.has(challenge.id))
        standing.push(challenge.id);
    }
    return standing;
  }
  proposalStatusInternal(workspaceId, reportId, context = this.proposalReadContext(workspaceId)) {
    const proposal = this.requireReport(reportId);
    const terms = this.requireProposalTerms(workspaceId, reportId);
    const bytes = proposalBytes({
      workspace_id: workspaceId,
      report_id: proposal.id,
      task_id: proposal.task_id,
      question: proposal.body,
      criteria: terms.criteria,
      extent: terms.extent,
      relies_on: proposal.evidence_refs,
      known_conflicts: terms.known_conflicts,
      limits: proposal.limits,
      origin: terms.origin,
      topic: terms.topic,
      closes_at: terms.closes_at,
      supersedes_report_id: proposal.relation === "supersedes" ? proposal.target_report_id : null
    }, terms.rule);
    if (sha2564(bytes) !== terms.proposal_sha256) {
      throw new CollabError("proposal_terms_invalid", "Stored proposal bytes no longer match their recorded hash", { proposal_report_id: reportId });
    }
    const retirement = this.proposalRetirement(workspaceId, reportId);
    const supports = this.db.query(`
      SELECT id, from_session_id FROM reports
      WHERE workspace_id = ? AND target_report_id = ? AND relation = 'supports'
      ORDER BY event_sequence
    `).all(workspaceId, reportId).filter((support) => support.from_session_id !== null && !context.obsoleted.has(support.id));
    const setAsides = terms.rule === CONSENT_RULE_V2 ? this.proposalSetAsides(workspaceId, reportId) : null;
    const challengeIds = this.standingProposalChallenges(context, reportId, new Set(setAsides?.map((entry) => entry.challenge_report_id) ?? []));
    const computed = aiPosition({
      now: this.timestamp(),
      closes_at: terms.closes_at,
      obsoleted: retirement ? retirement.relation === "withdraws" ? "withdrawn" : "superseded" : null,
      unresolved_challenge: challengeIds.length > 0,
      author_voice_id: terms.author_voice_id,
      snapshot_voice_ids: terms.voices.map((voice) => voice.voice_id),
      support_voice_ids: supports.map((support) => this.consentVoice(support.from_session_id, context))
    });
    const acts = this.db.query(`
      SELECT * FROM proposal_person_acts
      WHERE workspace_id = ? AND proposal_report_id = ?
      ORDER BY event_sequence
    `).all(workspaceId, reportId).map(proposalPersonActFromRow);
    const latest = acts.at(-1) ?? null;
    const state = latest === null ? "awaiting" : latest.act === "agree" ? "agreed" : "rejected";
    const agreement = latest?.act === "agree" ? latest : null;
    return {
      rule: terms.rule,
      proposal,
      terms,
      proposal_bytes: bytes,
      proposal_sha256: terms.proposal_sha256,
      ai: {
        position: computed.position,
        closed: computed.closed,
        unresolved_challenge_report_ids: challengeIds,
        qualifying_support_report_ids: computed.qualifying_support_indexes.map((index) => supports[index].id),
        awaiting_voice_ids: computed.awaiting_voice_ids,
        obsoleted_by_report_id: retirement?.id ?? null,
        basis: "computed_from_journal"
      },
      person: { state, acts },
      ...setAsides ? { set_asides: setAsides } : {},
      agreement,
      may_proceed: agreement !== null && retirement === null,
      authority_boundary: "an_agreement_authorises_only_the_proposal_extent"
    };
  }
  requireProposalTerms(workspaceId, reportId) {
    const row = this.db.query(`
      SELECT * FROM proposal_terms WHERE workspace_id = ? AND report_id = ?
    `).get(workspaceId, reportId);
    if (!row) {
      throw new CollabError("proposal_not_found", "No proposal with consent terms has this report id in this workspace", { proposal_report_id: reportId });
    }
    return proposalTermsFromRow(row);
  }
  requireOpenToRevision(workspaceId, reportId) {
    const terms = this.db.query(`
      SELECT 1 FROM proposal_terms WHERE workspace_id = ? AND report_id = ?
    `).get(workspaceId, reportId);
    if (!terms)
      return;
    if (this.proposalRetirement(workspaceId, reportId)) {
      throw new CollabError("proposal_not_on_table", "This proposal was already withdrawn or superseded", { proposal_report_id: reportId });
    }
  }
  refuseProposalRewrite(input) {
    if (input.relation !== "corrects" && input.relation !== "supersedes" && input.relation !== "withdraws")
      return;
    if (!input.target_report_id)
      return;
    const isTermed = (id) => this.db.query(`SELECT 1 FROM proposal_terms WHERE report_id = ?`).get(id) !== null;
    if (input.relation !== "withdraws" && isTermed(input.target_report_id)) {
      throw new CollabError("proposal_terms_fixed", "A proposal with consent terms is fixed by its hash. Withdraw it, or open a revision with " + "collab_proposal_open and supersedes_report_id");
    }
    const target = this.db.query(`SELECT relation, target_report_id FROM reports WHERE id = ?`).get(input.target_report_id);
    if (target?.target_report_id && ["withdraws", "corrects", "supersedes"].includes(target.relation) && !isTermed(input.target_report_id) && isTermed(target.target_report_id)) {
      throw new CollabError("proposal_retired", "This report retired a proposal, and a retirement is final; open a new proposal instead");
    }
  }
  tableVoices(workspaceId) {
    this.requireWorkspace(workspaceId);
    const now = this.timestamp();
    const rows = this.db.query(`
      SELECT id, actor, role, status, last_seen_at FROM coordination_sessions
      WHERE workspace_id = ? AND status = 'active'
      ORDER BY last_seen_at DESC, id
    `).all(workspaceId);
    const voices = new Map;
    for (const row of rows) {
      const voiceId = this.consentVoice(row.id);
      voices.set(voiceId, [...voices.get(voiceId) ?? [], {
        id: row.id,
        actor: row.actor,
        role: row.role,
        liveness: sessionLiveness(row, now),
        last_seen_at: row.last_seen_at
      }]);
    }
    return [...voices.entries()].map(([voice_id, sessions]) => ({ voice_id, sessions }));
  }
  liveVoiceSnapshot(workspaceId, observedAt) {
    const rows = this.db.query(`
      SELECT id, status, last_seen_at FROM coordination_sessions
      WHERE workspace_id = ? AND status = 'active'
      ORDER BY id
    `).all(workspaceId);
    const voices = new Map;
    for (const row of rows) {
      if (sessionLiveness(row, observedAt) !== "live")
        continue;
      const voiceId = this.consentVoice(row.id);
      voices.set(voiceId, [...voices.get(voiceId) ?? [], row.id]);
    }
    return [...voices.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([voice_id, live_session_ids]) => ({ voice_id, live_session_ids: live_session_ids.sort() }));
  }
  consentVoice(sessionId, context) {
    const cached = context?.voices.get(sessionId);
    if (cached)
      return cached;
    let current = sessionId;
    for (let depth = 0;depth < 256; depth += 1) {
      const row = this.db.query(`SELECT parent_session_id FROM session_parent_attestations WHERE session_id = ?`).get(current);
      if (!row)
        break;
      current = row.parent_session_id;
    }
    context?.voices.set(sessionId, current);
    return current;
  }
  listReports(workspaceId, options = {}) {
    this.requireWorkspace(workspaceId);
    const after = options.after_event_sequence ?? 0;
    const limit = options.limit ?? 100;
    if (!Number.isInteger(after) || after < 0) {
      throw new CollabError("invalid_cursor", "Report cursor must be a non-negative integer");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new CollabError("invalid_limit", "Report limit must be between 1 and 500");
    }
    const taskId = options.task_id ? validateId(options.task_id, "task_id") : null;
    const toSessionId = options.to_session_id ? validateId(options.to_session_id, "to_session_id") : null;
    const rows = this.db.query(`
      SELECT * FROM reports
      WHERE workspace_id = ?
        AND event_sequence > ?
        AND (? IS NULL OR task_id = ?)
        AND (? IS NULL OR to_session_id = ?)
      ORDER BY event_sequence
      LIMIT ?
    `).all(workspaceId, after, taskId, taskId, toSessionId, toSessionId, limit);
    return rows.map(reportFromRow);
  }
  reviewTaskForSession(input) {
    const taskId = validateId(input.task_id, "task_id");
    const expectedVersion = validateExpectedVersion(input.expected_version);
    if (input.outcome !== "accept" && input.outcome !== "request_changes") {
      throw new CollabError("invalid_review_outcome", "Review outcome is invalid");
    }
    const summary = cleanText(input.summary, "summary", 4000);
    const evidenceRefs = normalizeEvidenceRefs(input.evidence_refs ?? []);
    const confidence = validateReportConfidence(input.confidence ?? "unknown");
    const confidenceBasis = optionalText(input.confidence_basis, "confidence_basis", 2000);
    const limits = optionalText(input.limits, "limits", 2000);
    const request = {
      task_id: taskId,
      expected_version: expectedVersion,
      outcome: input.outcome,
      summary,
      evidence_refs: evidenceRefs,
      ...confidence === "unknown" ? {} : { confidence },
      ...confidenceBasis === null ? {} : { confidence_basis: confidenceBasis },
      ...limits === null ? {} : { limits }
    };
    const replay = this.readSessionMutationReceipt(input, input.idempotency_key, "task.review.v2", request);
    if (replay.found)
      return replay.value;
    const preparedCheckpoint = input.outcome === "accept" ? this.captureReviewCheckpoint(input, taskId) : null;
    return this.mutateAsSession(input, input.idempotency_key, "task.review.v2", request, (session) => {
      const row = this.requireTaskRow(session.workspace_id, taskId);
      if (row.completion_policy !== "accepted" || row.review_status !== "pending") {
        throw this.taskNotPendingReviewError(row, session.id);
      }
      this.requireVersion(row, expectedVersion);
      if (!row.reported_by_session_id || !row.completion_report_id) {
        throw new CollabError("review_state_invalid", "Task completion review metadata is incomplete");
      }
      if (row.reported_by_session_id === session.id) {
        throw new CollabError("self_review_forbidden", "A distinct session must review reported completion");
      }
      for (const reference of evidenceRefs)
        this.requireEvidenceRef(row.workspace_id, reference);
      if (input.outcome === "accept" && this.hasObsoletedCompletionReport(row.workspace_id, row.completion_report_id)) {
        throw new CollabError("completion_report_obsolete", "The reported completion was withdrawn, corrected, or superseded; request changes before a new completion report", { completion_report_id: row.completion_report_id });
      }
      if (input.outcome === "accept" && this.hasUnresolvedChallenges(row.workspace_id, row.completion_report_id)) {
        throw new CollabError("completion_challenged", "Reported completion has an unresolved challenge", { completion_report_id: row.completion_report_id });
      }
      let hostCommit = null;
      if (input.outcome === "accept") {
        const resultCheckpoint = parseCheckpoint(row.result_checkpoint_json);
        if (resultCheckpoint?.source === "server_observed") {
          if (!preparedCheckpoint || checkpointDigest(preparedCheckpoint.result_checkpoint) !== checkpointDigest(resultCheckpoint)) {
            throw new CollabError("worktree_observation_stale", "The completion checkpoint changed after review preparation");
          }
          this.requirePreparedRegisteredWorktree(row.workspace_id, resultCheckpoint.worktree_id, preparedCheckpoint.observed_worktree);
          const observed = preparedCheckpoint.observed_worktree.checkpoint;
          requireCompleteGitCheckpoint(resultCheckpoint);
          requireCompleteGitCheckpoint(observed);
          if (!checkpointStateMatches(resultCheckpoint, observed)) {
            const basis = this.hostCommitSuccessorBasis(row, preparedCheckpoint);
            if ("refusal" in basis) {
              throw gitCheckpointStaleError(row.id, resultCheckpoint, observed, basis.refusal);
            }
            hostCommit = basis;
          }
        }
      }
      const report = this.appendReportInternal(session, {
        task_id: row.id,
        to_session_id: row.reported_by_session_id,
        kind: input.outcome === "accept" ? "observation" : "inference",
        body: summary,
        evidence_refs: [
          `report:${row.completion_report_id}`,
          ...evidenceRefs.filter((reference) => reference !== `report:${row.completion_report_id}`)
        ],
        confidence,
        confidence_basis: confidenceBasis,
        limits,
        relation: input.outcome === "accept" ? "supports" : "challenges",
        target_report_id: row.completion_report_id,
        authority_scope: "local_task_coordination_review",
        authority_basis: "distinct active collaboration session"
      });
      const now = this.timestamp();
      const reviewId = `review_${randomUUID()}`;
      const version = row.version + 1;
      const outcome = input.outcome === "accept" ? "accepted" : "changes_requested";
      if (input.outcome === "accept") {
        this.db.query(`
          UPDATE tasks
          SET review_status = 'accepted', accepted_by = ?, accepted_by_session_id = ?,
            accepted_at = ?, version = ?, updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(session.actor, session.id, now, version, now, row.workspace_id, row.id);
      } else {
        this.db.query(`
          UPDATE tasks
          SET status = 'open', review_status = 'changes_requested',
            accepted_by = NULL, accepted_by_session_id = NULL, accepted_at = NULL,
            version = ?, updated_at = ?, completed_at = NULL
          WHERE workspace_id = ? AND id = ?
        `).run(version, now, row.workspace_id, row.id);
      }
      const event = this.appendEvent(row.workspace_id, input.outcome === "accept" ? "task.accepted" : "task.changes_requested", row.id, session.actor, {
        review_id: reviewId,
        review_report_id: report.id,
        completion_report_id: row.completion_report_id,
        review_generation: row.review_generation,
        outcome,
        summary,
        version,
        authority_boundary: "acceptance_is_local_coordination_review_not_merge_deploy_truth_or_external_authority",
        ...hostCommit ? {
          checkpoint_basis: "host_commit_successor",
          host_commit_sha: hostCommit.commit_sha,
          host_commit_artifact_ids: hostCommit.artifact_ids,
          checkpoint_boundary: "server_observed_successor_commit_is_local_evidence_not_a_commit_signature_attribution_or_an_atomic_git_sqlite_lock"
        } : {}
      }, session.id);
      this.db.query(`
        INSERT INTO task_reviews (
          id, workspace_id, task_id, review_generation, outcome, summary,
          reviewer_actor, reviewer_session_id, created_at, event_sequence
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(reviewId, row.workspace_id, row.id, row.review_generation, outcome, summary, session.actor, session.id, now, event.sequence);
      return {
        task: this.requireTask(row.workspace_id, row.id),
        review: this.requireReview(reviewId),
        report
      };
    });
  }
  offerHandoff(input) {
    const normalized = {
      ...normalizeLeaseInput(input),
      to_actor: validateActor(input.to_actor),
      summary: cleanText(input.summary, "summary", 4000),
      ttl_seconds: validateTtl(input.ttl_seconds)
    };
    if (normalized.to_actor === normalized.actor) {
      throw new CollabError("invalid_handoff", "A handoff target must be a different actor");
    }
    this.expireElapsedHandoffs(input.workspace_id, normalized.actor, normalized.task_id);
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "handoff.offer", normalized, () => {
      const row = this.requireTaskRow(input.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveLease(row, normalized.actor, normalized.lease_id);
      const pending = this.db.query(`
        SELECT id FROM handoffs WHERE workspace_id = ? AND task_id = ? AND status = 'pending' AND expires_at > ?
      `).get(input.workspace_id, normalized.task_id, this.timestamp());
      if (pending)
        throw new CollabError("handoff_pending", "Task already has a pending handoff", { handoff_id: pending.id });
      const now = this.timestamp();
      const id = `handoff_${randomUUID()}`;
      const expiresAt = [addSeconds(now, normalized.ttl_seconds), row.lease_expires_at].sort()[0];
      this.db.query(`
        INSERT INTO handoffs
          (id, workspace_id, task_id, from_actor, to_actor, summary, status, offered_at, expires_at, resolved_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL)
      `).run(id, input.workspace_id, normalized.task_id, normalized.actor, normalized.to_actor, normalized.summary, now, expiresAt);
      const version = row.version + 1;
      this.db.query(`UPDATE tasks SET version = ?, updated_at = ? WHERE workspace_id = ? AND id = ?`).run(version, now, input.workspace_id, normalized.task_id);
      const offer = this.requireHandoff(id);
      this.appendEvent(input.workspace_id, "handoff.offered", id, normalized.actor, {
        offer,
        task_version: version,
        note: "An offer is an invitation; the coordination lease remains with the current holder until acceptance."
      });
      return { handoff: offer, task: this.requireTask(input.workspace_id, normalized.task_id) };
    });
  }
  respondHandoff(input) {
    if (input.response !== "accept" && input.response !== "decline") {
      throw new CollabError("invalid_handoff_response", "Handoff response must be 'accept' or 'decline'");
    }
    const normalized = {
      ...normalizeVersionedMutation(input),
      workspace_id: input.workspace_id,
      handoff_id: validateId(input.handoff_id, "handoff_id"),
      response: input.response,
      ttl_seconds: validateTtl(input.ttl_seconds)
    };
    this.expireElapsedHandoffs(input.workspace_id, "system:clock");
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "handoff.respond", normalized, () => {
      const offer = this.requireHandoff(normalized.handoff_id);
      if (offer.workspace_id !== input.workspace_id)
        throw new CollabError("handoff_not_found", "Handoff was not found in this workspace");
      if (offer.to_actor !== normalized.actor)
        throw new CollabError("handoff_not_recipient", "Only the named recipient may respond");
      if (offer.status === "expired")
        throw new CollabError("handoff_expired", "The handoff has expired");
      if (offer.status !== "pending")
        throw new CollabError("handoff_resolved", "Handoff has already been resolved", { status: offer.status });
      const row = this.requireTaskRow(input.workspace_id, offer.task_id);
      this.requireVersion(row, normalized.expected_version);
      if (this.timestamp() >= offer.expires_at || this.isExpired(row)) {
        throw new CollabError("handoff_expired", "The handoff or source lease has expired");
      }
      this.requireActiveLease(row, offer.from_actor, row.lease_id ?? "");
      const now = this.timestamp();
      const version = row.version + 1;
      if (normalized.response === "decline") {
        this.db.query(`UPDATE handoffs SET status = 'declined', resolved_at = ? WHERE id = ?`).run(now, offer.id);
        this.db.query(`UPDATE tasks SET version = ?, updated_at = ? WHERE workspace_id = ? AND id = ?`).run(version, now, input.workspace_id, row.id);
        this.appendEvent(input.workspace_id, "handoff.declined", offer.id, normalized.actor, {
          task_id: row.id,
          task_version: version
        });
      } else {
        const leaseId = `lease_${randomUUID()}`;
        const leaseExpiresAt = addSeconds(now, normalized.ttl_seconds);
        this.db.query(`UPDATE handoffs SET status = 'accepted', resolved_at = ? WHERE id = ?`).run(now, offer.id);
        this.db.query(`
          UPDATE tasks SET assignee = ?, lease_id = ?, lease_expires_at = ?, version = ?, updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(normalized.actor, leaseId, leaseExpiresAt, version, now, input.workspace_id, row.id);
        this.appendEvent(input.workspace_id, "handoff.accepted", offer.id, normalized.actor, {
          task_id: row.id,
          from_actor: offer.from_actor,
          to_actor: normalized.actor,
          lease_id: leaseId,
          lease_expires_at: leaseExpiresAt,
          task_version: version
        });
      }
      return { handoff: this.requireHandoff(offer.id), task: this.requireTask(input.workspace_id, row.id) };
    });
  }
  offerHandoffForSession(input) {
    const normalized = normalizeSessionLeaseInput(input);
    const toSessionId = validateId(input.to_session_id, "to_session_id");
    const summary = cleanText(input.summary, "summary", 4000);
    const ttl = validateTtl(input.ttl_seconds);
    if (toSessionId === input.session_id) {
      throw new CollabError("invalid_handoff", "A handoff target must be a different session");
    }
    return this.mutateAsSession(input, normalized.idempotency_key, "handoff.offer.v2", { ...normalized.request, to_session_id: toSessionId, summary, ttl_seconds: ttl }, (session) => {
      const target = this.requireCoordinationSessionRow(toSessionId);
      if (target.workspace_id !== session.workspace_id || target.status !== "active") {
        throw new CollabError("handoff_target_unavailable", "The target must be an active session in the same workspace");
      }
      const row = this.requireTaskRow(session.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveSessionLease(row, session, normalized.lease_id);
      const now = this.timestamp();
      const pending = this.db.query(`
          SELECT id FROM handoffs
          WHERE workspace_id = ? AND task_id = ? AND status = 'pending' AND expires_at > ?
        `).get(row.workspace_id, row.id, now);
      if (pending) {
        throw new CollabError("handoff_pending", "Task already has a pending handoff", {
          handoff_id: pending.id
        });
      }
      const id = `handoff_${randomUUID()}`;
      const expiresAt = addSeconds(now, ttl);
      this.db.query(`
          INSERT INTO handoffs (
            id, workspace_id, task_id, from_actor, from_session_id,
            to_actor, to_session_id, summary, status, offered_at, expires_at, resolved_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL)
        `).run(id, row.workspace_id, row.id, session.actor, session.id, target.actor, target.id, summary, now, expiresAt);
      const version = row.version + 1;
      this.db.query(`
          UPDATE tasks SET version = ?, updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(version, now, row.workspace_id, row.id);
      const handoff = this.requireHandoff(id);
      this.appendEvent(row.workspace_id, "handoff.offered", id, session.actor, {
        handoff,
        task_version: version,
        note: "The current session keeps its coordination lease until the target explicitly accepts."
      }, session.id);
      return { handoff, task: this.requireTask(row.workspace_id, row.id) };
    });
  }
  respondHandoffForSession(input) {
    const handoffId = validateId(input.handoff_id, "handoff_id");
    const expectedVersion = validateExpectedVersion(input.expected_version);
    if (input.response !== "accept" && input.response !== "decline") {
      throw new CollabError("invalid_handoff_response", "Handoff response is invalid");
    }
    const ttl = validateTtl(input.ttl_seconds);
    const request = {
      handoff_id: handoffId,
      expected_version: expectedVersion,
      response: input.response,
      ttl_seconds: ttl
    };
    const replay = this.readSessionMutationReceipt(input, input.idempotency_key, "handoff.respond.v2", request);
    if (replay.found)
      return replay.value;
    const preparedCheckpoint = input.response === "accept" ? this.captureSessionWorktree(input) : null;
    return this.mutateAsSession(input, input.idempotency_key, "handoff.respond.v2", request, (session) => {
      const offer = this.requireHandoff(handoffId);
      if (offer.workspace_id !== session.workspace_id || offer.to_session_id !== session.id) {
        throw new CollabError("handoff_not_recipient", "Only the named target session may respond");
      }
      if (offer.status !== "pending") {
        throw new CollabError(offer.status === "expired" ? "handoff_expired" : "handoff_resolved", "Handoff is no longer pending", { status: offer.status });
      }
      const row = this.requireTaskRow(session.workspace_id, offer.task_id);
      this.requireVersion(row, expectedVersion);
      if (this.timestamp() >= offer.expires_at || this.isExpired(row)) {
        throw new CollabError("handoff_expired", "The offer or source lease expired");
      }
      if (row.assignee_session_id !== offer.from_session_id || row.lease_id === null) {
        throw new CollabError("handoff_source_changed", "The source lease changed");
      }
      const now = this.timestamp();
      const version = row.version + 1;
      if (input.response === "decline") {
        this.db.query(`
            UPDATE handoffs SET status = 'declined', resolved_at = ? WHERE id = ?
          `).run(now, offer.id);
        this.db.query(`
            UPDATE tasks SET version = ?, updated_at = ?
            WHERE workspace_id = ? AND id = ?
          `).run(version, now, row.workspace_id, row.id);
        this.appendEvent(row.workspace_id, "handoff.declined", offer.id, session.actor, {
          task_id: row.id,
          task_version: version
        }, session.id);
      } else {
        const worktree = this.requirePreparedWorktree(session, preparedCheckpoint);
        const checkpoint = preparedCheckpoint.checkpoint;
        this.requireExpectedBase(row, checkpoint);
        const leaseId = `lease_${randomUUID()}`;
        const leaseExpiresAt = addSeconds(now, ttl);
        this.db.query(`
            UPDATE handoffs SET status = 'accepted', resolved_at = ? WHERE id = ?
          `).run(now, offer.id);
        this.db.query(`
            UPDATE tasks
            SET assignee = ?, assignee_session_id = ?, claim_worktree_id = ?,
              lease_id = ?, lease_expires_at = ?, base_checkpoint_json = ?,
              version = ?, updated_at = ?
            WHERE workspace_id = ? AND id = ?
          `).run(session.actor, session.id, worktree.id, leaseId, leaseExpiresAt, canonicalJson(checkpoint), version, now, row.workspace_id, row.id);
        this.appendEvent(row.workspace_id, "handoff.accepted", offer.id, session.actor, {
          task_id: row.id,
          from_session_id: offer.from_session_id,
          to_session_id: session.id,
          lease_id: leaseId,
          lease_expires_at: leaseExpiresAt,
          base_checkpoint: checkpoint,
          task_version: version
        }, session.id);
      }
      return {
        handoff: this.requireHandoff(offer.id),
        task: this.requireTask(row.workspace_id, row.id)
      };
    });
  }
  nextForActor(workspaceId, actorInput, afterSequence = 0, eventLimit = DEFAULT_NEXT_EVENT_LIMIT) {
    const actor = validateActor(actorInput);
    const boundedEventLimit = validateNextEventLimit(eventLimit);
    this.expireElapsedHandoffs(workspaceId, "system:clock");
    const read = this.db.transaction(() => {
      const events = this.readEventPage(workspaceId, afterSequence, boundedEventLimit);
      const tasks = this.listTasks(workspaceId);
      const offers = this.db.query(`
        SELECT * FROM handoffs
        WHERE workspace_id = ? AND to_actor = ? AND status = 'pending' AND expires_at > ?
        ORDER BY offered_at, id
      `).all(workspaceId, actor, this.timestamp());
      const { claimable, conflicted } = this.projectAvailableTasks(workspaceId, tasks, (task) => task.effective_status === "lease_expired" && task.assignee_session_id === null);
      const reportRows = this.db.query(`
        SELECT * FROM reports
        WHERE workspace_id = ? AND event_sequence > ? AND event_sequence <= ?
        ORDER BY event_sequence
      `).all(workspaceId, afterSequence, events.next_anchor.sequence);
      return {
        actor,
        session: null,
        own_claims: tasks.filter((task) => task.effective_status === "claimed" && task.assignee === actor),
        ready_tasks: claimable,
        claimable_tasks: claimable,
        conflicted_tasks: conflicted,
        handoff_offers: offers.map((row) => ({
          handoff: handoffFromRow(row),
          task: this.requireTask(workspaceId, row.task_id)
        })),
        recovery_required: recoveryRequiredFirst(tasks, () => false),
        reports: reportRows.map(reportFromRow),
        events,
        projection_scope: "snapshot_head",
        reports_scope: "event_page"
      };
    });
    return read.deferred();
  }
  nextForSession(input) {
    const authenticatedPoll = this.db.transaction(() => {
      const authenticated = this.authenticateSession(input);
      const stored = {
        epoch_id: authenticated.cursor_epoch_id,
        sequence: authenticated.cursor_sequence,
        hash: authenticated.cursor_hash
      };
      try {
        this.validateEventAnchor(authenticated.workspace_id, stored);
      } catch (error) {
        if (error instanceof CollabError) {
          throw new CollabError("cursor_reset_required", "The persisted session cursor no longer matches this journal", { cursor: stored, cause: error.code });
        }
        throw error;
      }
      if (input.known_cursor) {
        const known = input.known_cursor;
        try {
          this.validateEventAnchor(authenticated.workspace_id, known);
        } catch (error) {
          if (error instanceof CollabError) {
            throw new CollabError("cursor_reset_required", "The caller's last-known cursor no longer matches this journal", { cursor: known, cause: error.code });
          }
          throw error;
        }
      }
      if (input.after_sequence !== undefined) {
        requireBoundAfterSequence(input.after_sequence, authenticated);
      }
      const eventLimit2 = validateNextEventLimit(input.event_limit);
      this.recordSessionLeaseLapses(authenticated, this.timestamp());
      this.db.query(`UPDATE coordination_sessions SET last_seen_at = ? WHERE id = ?`).run(this.timestamp(), authenticated.id);
      return {
        row: this.requireCoordinationSessionRow(authenticated.id),
        event_limit: eventLimit2
      };
    }).immediate();
    const { row, event_limit: eventLimit } = authenticatedPoll;
    this.expireElapsedHandoffs(row.workspace_id, "system:clock");
    const read = this.db.transaction(() => {
      const current = this.authenticateSession(input);
      const events = this.readEventPage(current.workspace_id, current.cursor_sequence, eventLimit);
      const tasks = this.listTasks(current.workspace_id);
      const { claimable, conflicted } = this.projectAvailableTasks(current.workspace_id, tasks, () => false);
      const handoffs = this.db.query(`
        SELECT * FROM handoffs
        WHERE workspace_id = ? AND to_session_id = ? AND status = 'pending' AND expires_at > ?
        ORDER BY offered_at, id
      `).all(current.workspace_id, current.id, this.timestamp());
      const reportRows = this.db.query(`
        SELECT * FROM reports
        WHERE workspace_id = ? AND event_sequence > ? AND event_sequence <= ?
          AND (to_session_id IS NULL OR to_session_id = ?)
        ORDER BY event_sequence
      `).all(current.workspace_id, current.cursor_sequence, events.next_anchor.sequence, current.id);
      return {
        actor: current.actor,
        session: this.sessionProjection(current),
        own_claims: tasks.filter((task) => task.effective_status === "claimed" && task.assignee_session_id === current.id),
        ready_tasks: claimable,
        claimable_tasks: claimable,
        conflicted_tasks: conflicted,
        handoff_offers: handoffs.map((handoff) => ({
          handoff: handoffFromRow(handoff),
          task: this.requireTask(current.workspace_id, handoff.task_id)
        })),
        recovery_required: recoveryRequiredFirst(tasks, (task) => task.assignee_session_id === current.id),
        reports: reportRows.map(reportFromRow),
        events,
        projection_scope: "snapshot_head",
        reports_scope: "event_page"
      };
    });
    return read.deferred();
  }
  eventsSince(workspaceId, afterSequence = 0, limit = 100) {
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new CollabError("invalid_cursor", "Event cursor must be a non-negative integer");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new CollabError("invalid_limit", "Event limit must be between 1 and 500");
    }
    const readPage = this.db.transaction(() => this.readEventPage(workspaceId, afterSequence, limit));
    return readPage.deferred();
  }
  eventsAfterAnchorForSession(input) {
    const limit = validateNextEventLimit(input.event_limit ?? DEFAULT_WAIT_EVENT_LIMIT);
    try {
      const db = this.nonblockingEventReader();
      const authenticateRead = () => {
        const session = this.authenticateSession(input, {}, db);
        if (session.workspace_id !== input.workspace_id) {
          throw new CollabError("session_workspace_mismatch", "The bound session belongs to another workspace");
        }
        const stored = {
          epoch_id: session.cursor_epoch_id,
          sequence: session.cursor_sequence,
          hash: session.cursor_hash
        };
        try {
          this.validateEventAnchor(session.workspace_id, stored, db, MAX_WAIT_ANCHOR_BYTES);
          if (input.last_cursor) {
            const known = this.validateEventAnchor(session.workspace_id, input.last_cursor, db, MAX_WAIT_ANCHOR_BYTES);
            if (known.sequence > stored.sequence) {
              throw new CollabError("cursor_regression", "The persisted cursor is behind the host cursor");
            }
          }
        } catch (error) {
          if (!(error instanceof CollabError))
            throw error;
          if (error.code === "event_anchor_too_large")
            throw error;
          throw new CollabError("cursor_reset_required", "The session cursor requires explicit reconciliation", { cause: error.code });
        }
        return session;
      };
      const page = db.transaction(() => {
        const session = authenticateRead();
        const anchor = this.validateEventAnchor(session.workspace_id, input.after_anchor, db, MAX_WAIT_ANCHOR_BYTES);
        const page2 = this.readEventPage(session.workspace_id, anchor.sequence, limit, db, MAX_WAIT_PAGE_BYTES);
        if (!page2.chain_valid || page2.events.some((event) => event.epoch_id !== anchor.epoch_id || event.workspace_id !== session.workspace_id || event.sequence > page2.head_sequence)) {
          throw new CollabError("database_journal_invalid", "The returned event page failed hash-chain verification");
        }
        return page2;
      }).deferred();
      db.transaction(() => {
        const current = authenticateRead();
        this.validateEventAnchor(current.workspace_id, page.next_anchor, db, MAX_WAIT_ANCHOR_BYTES);
        const workspace = this.requireWorkspace(current.workspace_id, db);
        if (workspace.event_head_sequence < page.head_sequence) {
          throw new CollabError("cursor_ahead", "The journal rolled back during observation");
        }
        const observedHead = page.head_sequence === 0 ? { hash: GENESIS_HASH } : db.query("SELECT hash FROM events WHERE workspace_id = ? AND sequence = ?").get(current.workspace_id, page.head_sequence);
        if (observedHead?.hash !== page.head_hash || workspace.event_head_sequence === page.head_sequence && workspace.event_head_hash !== page.head_hash) {
          throw new CollabError("cursor_fork_detected", "The observed journal head changed during observation");
        }
      }).deferred();
      return page;
    } catch (error) {
      const code = error?.code;
      if (code?.startsWith("SQLITE_BUSY") || code?.startsWith("SQLITE_LOCKED")) {
        throw new CollabError("event_read_busy", "The journal is busy; no page was returned");
      }
      if (error instanceof SyntaxError || code === "SQLITE_CORRUPT" || code === "SQLITE_NOTADB") {
        throw new CollabError("database_journal_invalid", "The journal contains malformed event data");
      }
      throw error;
    }
  }
  requireEventByteBound(db, workspaceId, sequence, maxBytes, purpose = "page") {
    const row = db.query(`
      SELECT length(CAST(payload_json AS BLOB)) + length(CAST(actor AS BLOB))
        + length(CAST(entity_id AS BLOB)) + length(CAST(id AS BLOB))
        + length(CAST(epoch_id AS BLOB)) + length(CAST(workspace_id AS BLOB))
        + length(CAST(type AS BLOB)) + length(CAST(protocol AS BLOB))
        + length(CAST(occurred_at AS BLOB)) + length(CAST(prev_hash AS BLOB))
        + length(CAST(hash AS BLOB)) + coalesce(length(CAST(session_id AS BLOB)), 0) AS bytes
      FROM events WHERE workspace_id = ? AND sequence = ?
    `).get(workspaceId, sequence);
    if (row && row.bytes > maxBytes) {
      if (purpose === "anchor") {
        throw new CollabError("event_anchor_too_large", "An anchor exceeds the bounded validation ceiling; operator reconciliation is required", {
          sequence,
          max_anchor_bytes: maxBytes
        });
      }
      throw new CollabError("event_too_large", "An event exceeds the bounded observation page; use an explicit larger-read workflow", {
        sequence,
        max_page_bytes: maxBytes
      });
    }
  }
  readEventPage(workspaceId, afterSequence, limit, db = this.db, maxBytes) {
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new CollabError("invalid_cursor", "Event cursor must be a non-negative integer");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new CollabError("invalid_limit", "Event limit must be between 1 and 500");
    }
    const workspace = this.requireWorkspace(workspaceId, db);
    if (afterSequence > workspace.event_head_sequence) {
      throw new CollabError("invalid_cursor", "Event cursor is ahead of the workspace journal", {
        after_sequence: afterSequence,
        head_sequence: workspace.event_head_sequence
      });
    }
    const predecessor = afterSequence === 0 ? { hash: GENESIS_HASH } : db.query(`SELECT hash FROM events WHERE workspace_id = ? AND sequence = ?`).get(workspaceId, afterSequence);
    if (!predecessor) {
      throw new CollabError("cursor_mismatch", "The cursor does not resolve to an event in this journal", { after_sequence: afterSequence });
    }
    const select = `SELECT protocol, workspace_id, epoch_id, sequence, id, type, entity_id, actor,
      session_id, occurred_at, payload_json, prev_hash, hash FROM events`;
    let events;
    if (maxBytes === undefined) {
      const rows = db.query(`${select} WHERE workspace_id = ? AND sequence > ? ORDER BY sequence LIMIT ?`).all(workspaceId, afterSequence, limit);
      events = rows.map(eventFromRow);
    } else {
      events = [];
      let bytes = 2048;
      const sequences = db.query(`SELECT sequence FROM events WHERE workspace_id = ? AND sequence > ? ORDER BY sequence LIMIT ?`).all(workspaceId, afterSequence, limit);
      for (const { sequence } of sequences) {
        try {
          this.requireEventByteBound(db, workspaceId, sequence, maxBytes);
        } catch (error) {
          if (events.length && error instanceof CollabError && error.code === "event_too_large")
            break;
          throw error;
        }
        const event = eventFromRow(db.query(`${select} WHERE workspace_id = ? AND sequence = ?`).get(workspaceId, sequence));
        const size = Buffer.byteLength(JSON.stringify(event)) + 1;
        if (bytes + size > maxBytes) {
          if (events.length)
            break;
          throw new CollabError("event_too_large", "An event exceeds the bounded observation page", {
            sequence,
            max_page_bytes: maxBytes
          });
        }
        events.push(event);
        bytes += size;
      }
    }
    const chainValid = verifyEventPage(events, afterSequence, predecessor.hash, workspace.event_head_sequence, workspace.event_head_hash);
    const cursor = {
      epoch_id: workspace.epoch_id,
      sequence: afterSequence,
      hash: predecessor.hash
    };
    const last = events.at(-1);
    const nextAnchor = last ? { epoch_id: last.epoch_id, sequence: last.sequence, hash: last.hash } : cursor;
    const page = {
      events,
      next_cursor: nextAnchor.sequence,
      cursor,
      next_anchor: nextAnchor,
      head_sequence: workspace.event_head_sequence,
      head_hash: workspace.event_head_hash,
      has_more: nextAnchor.sequence < workspace.event_head_sequence,
      chain_valid: chainValid,
      verification_scope: "returned_page"
    };
    if (maxBytes !== undefined && Buffer.byteLength(JSON.stringify(page)) > maxBytes) {
      throw new CollabError("event_page_too_large", "The observation page exceeds its byte limit");
    }
    return page;
  }
  eventsAfterAnchor(workspaceId, anchor, limit = 100) {
    const validated = this.validateEventAnchor(workspaceId, anchor);
    return this.eventsSince(workspaceId, validated.sequence, limit);
  }
  proposalAddressesSession(proposalReportId, sessionId) {
    const row = this.db.query(`
      SELECT r.from_session_id, t.voices_json, t.author_voice_id FROM reports r
      JOIN proposal_terms t ON t.report_id = r.id WHERE r.id = ?
    `).get(proposalReportId);
    if (!row)
      return false;
    if (row.from_session_id !== null)
      return row.from_session_id === sessionId;
    return JSON.parse(row.voices_json).some((voice) => voice.voice_id !== row.author_voice_id && voice.live_session_ids.includes(sessionId));
  }
  eventAddressesSession(event, sessionId) {
    const payload = event.payload ?? {};
    const field = (value, key) => value !== null && typeof value === "object" ? value[key] : undefined;
    switch (event.type) {
      case "report.posted": {
        if (payload.to_session_id === sessionId)
          return true;
        if (typeof payload.about_proposal_id === "string") {
          return this.proposalAddressesSession(payload.about_proposal_id, sessionId);
        }
        if (typeof payload.target_report_id !== "string")
          return false;
        const target = this.db.query(`SELECT from_session_id FROM reports WHERE id = ?`).get(payload.target_report_id);
        return target?.from_session_id === sessionId;
      }
      case "handoff.offered":
        return field(payload.handoff, "to_session_id") === sessionId;
      case "handoff.accepted":
      case "handoff.declined":
      case "handoff.expired": {
        const offer = this.db.query(`SELECT from_session_id FROM handoffs WHERE id = ?`).get(event.entity_id);
        return offer?.from_session_id === sessionId;
      }
      case "task.reported_complete":
        return payload.review_requested_session_id === sessionId;
      case "task.accepted":
      case "task.changes_requested": {
        const task = this.db.query(`SELECT reported_by_session_id FROM tasks WHERE workspace_id = ? AND id = ?`).get(event.workspace_id, event.entity_id);
        return task?.reported_by_session_id === sessionId;
      }
      case "task.recovered":
        return field(payload.prior_lease, "session_id") === sessionId;
      case "proposal.opened": {
        const voices = Array.isArray(payload.voices) ? payload.voices : [];
        return voices.some((voice) => field(voice, "voice_id") !== payload.author_voice_id && Array.isArray(field(voice, "live_session_ids")) && field(voice, "live_session_ids").includes(sessionId));
      }
      case "proposal.agreed":
      case "proposal.rejected":
      case "proposal.challenge_set_aside":
        return this.proposalAddressesSession(event.entity_id, sessionId);
      case "ballot.opened": {
        const electorate = Array.isArray(payload.electorate) ? payload.electorate : [];
        const listed = (key, value) => electorate.some((unit) => Array.isArray(field(unit, key)) && field(unit, key).includes(value));
        return listed("session_ids", sessionId) || listed("voice_ids", this.consentVoice(sessionId));
      }
      case "ballot.closed": {
        const opener = this.db.query(`
          SELECT json_extract(payload_json, '$.opener_session_id') AS opener FROM events
          WHERE workspace_id = ? AND type = 'ballot.opened' AND entity_id = ?
        `).get(event.workspace_id, event.entity_id);
        if (opener?.opener === sessionId)
          return true;
        return this.db.query(`
          SELECT 1 FROM events WHERE workspace_id = ? AND type = 'ballot.cast' AND entity_id = ? AND session_id = ? LIMIT 1
        `).get(event.workspace_id, event.entity_id, sessionId) !== null;
      }
      default:
        return false;
    }
  }
  verifyJournal(workspaceId) {
    const audit = this.db.transaction(() => {
      this.requireWorkspace(workspaceId);
      return this.verifyJournalRows(workspaceId);
    });
    return audit.deferred();
  }
  verifyJournalRows(workspaceId) {
    const workspace = this.getWorkspace(workspaceId);
    if (!workspace)
      return false;
    const rows = this.db.query(`
      SELECT protocol, workspace_id, epoch_id, sequence, id, type, entity_id, actor,
        session_id, occurred_at, payload_json, prev_hash, hash
      FROM events WHERE workspace_id = ? ORDER BY sequence
    `).all(workspaceId);
    let expectedSequence = 1;
    let previous = GENESIS_HASH;
    try {
      for (const row of rows) {
        const event = eventFromRow(row);
        if (event.sequence !== expectedSequence || event.prev_hash !== previous)
          return false;
        if (event.hash !== eventHash(event))
          return false;
        previous = event.hash;
        expectedSequence += 1;
      }
    } catch {
      return false;
    }
    return workspace.event_head_sequence === rows.length && workspace.event_head_hash === previous;
  }
  mutate(workspaceId, actor, idempotencyKey, operation, request, apply) {
    this.requireWorkspace(workspaceId);
    const requestHash = sha2564(canonicalJson({ operation, request }));
    const transaction = this.db.transaction(() => {
      const existing = this.db.query(`
        SELECT operation, request_hash, response_json FROM mutations
        WHERE workspace_id = ? AND actor = ? AND idempotency_key = ?
      `).get(workspaceId, actor, idempotencyKey);
      if (existing) {
        if (existing.operation !== operation || existing.request_hash !== requestHash) {
          throw new CollabError("idempotency_conflict", "Idempotency key was already used for a different mutation", {
            operation: existing.operation
          });
        }
        return hydrateLegacyMutationResponse(JSON.parse(existing.response_json), this.timestamp());
      }
      const response2 = apply();
      this.db.query(`
        INSERT INTO mutations
          (workspace_id, actor, idempotency_key, operation, request_hash, response_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(workspaceId, actor, idempotencyKey, operation, requestHash, JSON.stringify(response2), this.timestamp());
      return response2;
    });
    const response = transaction.immediate();
    this.tightenFileModes();
    return response;
  }
  readSessionMutationReceipt(credential, idempotencyKeyInput, operation, request) {
    const session = this.authenticateSession(credential);
    const idempotencyKey = validateIdempotencyKey(idempotencyKeyInput);
    const requestHash = sha2564(canonicalJson({ operation, request }));
    const existing = this.db.query(`
      SELECT operation, request_hash, response_json FROM mutations
      WHERE workspace_id = ? AND actor = ? AND idempotency_key = ?
    `).get(session.workspace_id, `session:${session.id}`, idempotencyKey);
    if (!existing)
      return { found: false };
    if (existing.operation !== operation || existing.request_hash !== requestHash) {
      throw new CollabError("idempotency_conflict", "Idempotency key was already used for a different session mutation", { operation: existing.operation });
    }
    return {
      found: true,
      value: JSON.parse(existing.response_json)
    };
  }
  mutateAsSession(credential, idempotencyKeyInput, operation, request, apply, options = {}) {
    const idempotencyKey = validateIdempotencyKey(idempotencyKeyInput);
    const transaction = this.db.transaction(() => {
      const session = this.authenticateSession(credential, options);
      this.recordSessionLeaseLapses(session, this.timestamp());
      const mutationActor = `session:${session.id}`;
      const requestHash = sha2564(canonicalJson({ operation, request }));
      const existing = this.db.query(`
        SELECT operation, request_hash, response_json FROM mutations
        WHERE workspace_id = ? AND actor = ? AND idempotency_key = ?
      `).get(session.workspace_id, mutationActor, idempotencyKey);
      if (existing) {
        if (existing.operation !== operation || existing.request_hash !== requestHash) {
          throw new CollabError("idempotency_conflict", "Idempotency key was already used for a different session mutation", { operation: existing.operation });
        }
        this.db.query(`UPDATE coordination_sessions SET last_seen_at = ? WHERE id = ?`).run(this.timestamp(), session.id);
        return JSON.parse(existing.response_json);
      }
      const receiptPlan = options.receipt_plan ?? this.ambientPlanFor(idempotencyKey);
      if (receiptPlan)
        this.requireReceiptPlan(session, receiptPlan);
      this.db.query(`UPDATE coordination_sessions SET last_seen_at = ? WHERE id = ?`).run(this.timestamp(), session.id);
      const guardNonce = `guard_${randomUUID()}`;
      this.db.query(`INSERT INTO v2_write_guard (nonce, enabled) VALUES (?, 1)`).run(guardNonce);
      try {
        const response2 = apply(session);
        this.db.query(`
          INSERT INTO mutations (
            workspace_id, actor, idempotency_key, operation,
            request_hash, response_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(session.workspace_id, mutationActor, idempotencyKey, operation, requestHash, JSON.stringify(response2), this.timestamp());
        return response2;
      } finally {
        this.db.query(`DELETE FROM v2_write_guard WHERE nonce = ?`).run(guardNonce);
      }
    });
    const response = transaction.immediate();
    this.tightenFileModes();
    return response;
  }
  authenticateSession(input, options = {}, db = this.db) {
    let id;
    try {
      id = validateId(input.session_id, "session_id");
    } catch {
      throw new CollabError("session_auth_failed", "Session credentials are invalid");
    }
    const row = db.query(`SELECT * FROM coordination_sessions WHERE id = ?`).get(id);
    const suppliedHash = hashSessionToken(typeof input.session_token === "string" ? input.session_token : "");
    const expectedHash = row?.token_hash ?? "0".repeat(64);
    const tokenMatches = safeDigestEqual(suppliedHash, expectedHash);
    const generationMatches = Number.isInteger(input.generation) && row !== null && input.generation === row.generation;
    if (!row || !tokenMatches || !generationMatches || row.status !== "active") {
      throw new CollabError("session_auth_failed", "Session credentials are invalid");
    }
    if (row.cursor_recovery_required !== 0 && !options.allow_cursor_recovery) {
      throw new CollabError("cursor_recovery_required", "Reset this session to an exact journal anchor before further mutations", {
        persisted_cursor: {
          epoch_id: row.cursor_epoch_id,
          sequence: row.cursor_sequence,
          hash: row.cursor_hash
        },
        expected_cursor_version: row.cursor_version
      });
    }
    return row;
  }
  authenticateResumeToken(sessionId, token) {
    const row = this.db.query(`SELECT * FROM coordination_sessions WHERE id = ?`).get(sessionId);
    const suppliedHash = hashSessionToken(typeof token === "string" ? token : "");
    const expectedHash = row?.token_hash ?? "0".repeat(64);
    if (!row || !safeDigestEqual(suppliedHash, expectedHash) || row.status !== "active") {
      throw new CollabError("session_auth_failed", "Session credentials are invalid");
    }
    return row;
  }
  captureSessionWorktree(input) {
    const session = this.authenticateSession(input);
    const worktree = this.requireWorktreeRow(session.worktree_id);
    return this.captureRegisteredWorktree(session, worktree);
  }
  captureReviewCheckpoint(input, taskId) {
    const session = this.authenticateSession(input);
    const task = this.requireTaskRow(session.workspace_id, taskId);
    if (task.completion_policy !== "accepted" || task.review_status !== "pending")
      return null;
    const resultCheckpoint = parseCheckpoint(task.result_checkpoint_json);
    if (resultCheckpoint?.source !== "server_observed")
      return null;
    const worktree = this.requireWorktreeRow(resultCheckpoint.worktree_id);
    if (worktree.workspace_id !== session.workspace_id) {
      throw new CollabError("checkpoint_workspace_mismatch", "The completion checkpoint belongs to another workspace");
    }
    const observedWorktree = this.captureRegisteredWorktree(session, worktree);
    const resultHead = resultCheckpoint.head_sha;
    const observedHead = observedWorktree.checkpoint.head_sha;
    return {
      workspace_id: session.workspace_id,
      task_id: taskId,
      result_checkpoint: resultCheckpoint,
      observed_worktree: observedWorktree,
      host_commit: resultHead && observedHead && observedHead !== resultHead ? inspectSuccessorCommit(worktree.root_path, observedHead, resultHead) : null
    };
  }
  hostCommitSuccessorBasis(row, prepared) {
    const result = prepared.result_checkpoint;
    const observed = prepared.observed_worktree.checkpoint;
    const inspected = prepared.host_commit;
    if (observed.head_sha === result.head_sha) {
      return {
        refusal: "HEAD has not moved since the result checkpoint, so only an exact checkpoint match is accepted"
      };
    }
    if (observed.worktree_id !== result.worktree_id) {
      return { refusal: "The observed worktree is not the result checkpoint's worktree" };
    }
    if (!result.branch) {
      return {
        refusal: "The result checkpoint was captured on a detached HEAD, so no branch can carry a host commit"
      };
    }
    if (observed.branch !== result.branch) {
      const where = observed.branch ? `branch "${observed.branch}"` : "a detached HEAD";
      return {
        refusal: `HEAD is on ${where}, not the result checkpoint's branch "${result.branch}"`
      };
    }
    if (observed.dirty !== false) {
      return { refusal: "The observed worktree is not clean" };
    }
    if (!inspected || inspected.commit_sha !== observed.head_sha) {
      return { refusal: "The server did not inspect the observed HEAD commit" };
    }
    if (!inspected.ok)
      return { refusal: inspected.reason };
    const commit = inspected.commit_sha;
    if (inspected.parent_sha !== result.head_sha) {
      return { refusal: `Commit ${commit} does not follow the result checkpoint HEAD` };
    }
    if (inspected.changes.length === 0) {
      return { refusal: `Commit ${commit} changes no path` };
    }
    const scopes = parseStringArray(row.path_scopes_json);
    const rejectedThrough = this.db.query(`
      SELECT COALESCE(MAX(sequence), 0) AS sequence FROM events
      WHERE workspace_id = ? AND entity_id = ? AND type = 'task.changes_requested'
    `).get(row.workspace_id, row.id).sequence;
    const artifacts = this.db.query(`
      SELECT a.id, a.uri, a.sha256 FROM artifacts a
      JOIN events e
        ON e.workspace_id = a.workspace_id AND e.entity_id = a.task_id
        AND e.type = 'artifact.attached' AND json_extract(e.payload_json, '$.artifact.id') = a.id
      WHERE a.workspace_id = ? AND a.task_id = ? AND a.kind = 'file' AND e.sequence > ?
      ORDER BY e.sequence
    `).all(row.workspace_id, row.id, rejectedThrough);
    const newest = new Map;
    for (const artifact of artifacts) {
      const path = artifactRepositoryPath(artifact.uri, prepared.observed_worktree.root_path);
      if (path !== null)
        newest.set(path, artifact);
    }
    const artifactIds = [];
    for (const change of inspected.changes) {
      if (!pathWithinScopes(change.path, scopes)) {
        return { refusal: `Commit ${commit} changes ${change.path}, outside the task's path_scopes` };
      }
      if (change.blob_sha256 === null) {
        return {
          refusal: `Commit ${commit} deletes ${change.path} or commits it as something other than a regular file`
        };
      }
      const artifact = newest.get(change.path);
      if (!artifact) {
        const since = rejectedThrough > 0 ? " since its latest request_changes" : "";
        return { refusal: `No file artifact attached to this task${since} names ${change.path}` };
      }
      if (!artifact.sha256) {
        return {
          refusal: `The newest file artifact for ${change.path} (${artifact.id}) has no sha256`
        };
      }
      if (artifact.sha256 !== change.blob_sha256) {
        return {
          refusal: `The committed bytes of ${change.path} differ from its newest file artifact ${artifact.id}`
        };
      }
      artifactIds.push(artifact.id);
    }
    return { commit_sha: commit, artifact_ids: artifactIds };
  }
  captureRegisteredWorktree(session, worktree) {
    let identity;
    try {
      identity = inspectRepository(worktree.root_path);
    } catch (error) {
      throw new CollabError("worktree_unavailable", "The registered worktree could not be inspected", {
        worktree_id: worktree.id,
        cause: error instanceof CollabError ? error.code : "repository_inspection_failed"
      });
    }
    if (identity.root_path !== worktree.root_path || identity.checkpoint.worktree_id !== worktree.id || identity.worktree_fingerprint !== worktree.fingerprint || identity.git_common_dir_hash !== worktree.git_common_dir_hash) {
      throw new CollabError("worktree_identity_changed", "The registered path now resolves to a different worktree identity", { worktree_id: worktree.id });
    }
    return {
      session_id: session.id,
      workspace_id: session.workspace_id,
      worktree_id: worktree.id,
      root_path: worktree.root_path,
      fingerprint: worktree.fingerprint,
      git_common_dir_hash: worktree.git_common_dir_hash,
      checkpoint: identity.checkpoint
    };
  }
  requirePreparedWorktree(session, prepared) {
    if (prepared.session_id !== session.id || prepared.worktree_id !== session.worktree_id) {
      throw new CollabError("worktree_observation_stale", "The prepared worktree observation belongs to another session");
    }
    return this.requirePreparedRegisteredWorktree(session.workspace_id, session.worktree_id, prepared);
  }
  requirePreparedRegisteredWorktree(workspaceId, worktreeId2, prepared) {
    const row = this.requireWorktreeRow(worktreeId2);
    if (prepared.workspace_id !== workspaceId || prepared.worktree_id !== row.id || prepared.root_path !== row.root_path || prepared.fingerprint !== row.fingerprint || prepared.git_common_dir_hash !== row.git_common_dir_hash || row.workspace_id !== workspaceId) {
      throw new CollabError("worktree_observation_stale", "The registered worktree changed after it was inspected", { worktree_id: worktreeId2 });
    }
    this.touchWorktree(row, prepared.checkpoint, this.timestamp());
    return row;
  }
  requireExpectedBase(row, checkpoint) {
    if (row.expected_base_sha && checkpoint.head_sha !== row.expected_base_sha) {
      throw new CollabError("expected_base_mismatch", "The worktree HEAD does not match the task's required base", {
        expected_base_sha: row.expected_base_sha,
        observed_head_sha: checkpoint.head_sha,
        worktree_id: checkpoint.worktree_id
      });
    }
  }
  sessionHandle(row, token, workspace, worktreeRow) {
    return {
      workspace,
      worktree: worktreeFromRow(worktreeRow),
      session: this.sessionProjection(row),
      credential: {
        session_id: row.id,
        session_token: token,
        generation: row.generation,
        last_cursor: {
          epoch_id: row.cursor_epoch_id,
          sequence: row.cursor_sequence,
          hash: row.cursor_hash
        }
      },
      identity_boundary: "session_credentials_fence_cooperating_local_clients_but_do_not_authenticate_a_person_or_model"
    };
  }
  registerWorktree(workspaceId, identity, now, actor, emitEvent) {
    this.db.query(`INSERT OR IGNORE INTO repositories (key, created_at) VALUES (?, ?)`).run(identity.repository_key, now);
    this.db.query(`
      INSERT INTO worktrees (
        id, workspace_id, repository_key, root_path, git_common_dir_hash, fingerprint,
        branch, head_sha, dirty, registered_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(identity.checkpoint.worktree_id, workspaceId, identity.repository_key, identity.root_path, identity.git_common_dir_hash, identity.worktree_fingerprint, identity.checkpoint.branch, identity.checkpoint.head_sha, booleanToSql(identity.checkpoint.dirty), now, now);
    const row = this.requireWorktreeRow(identity.checkpoint.worktree_id);
    if (emitEvent) {
      this.appendEvent(workspaceId, "worktree.registered", row.id, actor, {
        root_path: row.root_path,
        repository_key: row.repository_key,
        checkpoint: checkpointFromWorktreeRow(row, now)
      });
    }
    return row;
  }
  touchWorktree(row, checkpoint, now) {
    this.db.query(`
      UPDATE worktrees
      SET branch = ?, head_sha = ?, dirty = ?, last_seen_at = ?
      WHERE id = ?
    `).run(checkpoint.branch, checkpoint.head_sha, booleanToSql(checkpoint.dirty), now, row.id);
  }
  requireWorktreeRow(id) {
    const row = this.db.query(`SELECT * FROM worktrees WHERE id = ?`).get(id);
    if (!row)
      throw new CollabError("worktree_not_found", `Worktree '${id}' was not found`);
    return row;
  }
  validateEventAnchor(workspaceId, input, db = this.db, maxBytes) {
    const workspace = this.requireWorkspace(workspaceId, db);
    if (!input || input.epoch_id !== workspace.epoch_id || !Number.isInteger(input.sequence) || input.sequence < 0 || typeof input.hash !== "string") {
      throw new CollabError("cursor_mismatch", "The cursor does not belong to this journal");
    }
    if (input.sequence === 0) {
      if (input.hash !== GENESIS_HASH) {
        throw new CollabError("cursor_fork_detected", "The genesis cursor hash is invalid");
      }
      return { ...input };
    }
    if (input.sequence > workspace.event_head_sequence) {
      throw new CollabError("cursor_ahead", "The cursor is ahead of the journal", {
        head_sequence: workspace.event_head_sequence
      });
    }
    if (maxBytes !== undefined)
      this.requireEventByteBound(db, workspaceId, input.sequence, maxBytes, "anchor");
    const row = db.query(`
      SELECT protocol, workspace_id, epoch_id, sequence, id, type, entity_id, actor,
        session_id, occurred_at, payload_json, prev_hash, hash
      FROM events
      WHERE workspace_id = ? AND sequence = ?
    `).get(workspaceId, input.sequence);
    const event = row ? eventFromRow(row) : null;
    if (!event || event.epoch_id !== input.epoch_id || event.hash !== input.hash || event.hash !== eventHash(event)) {
      throw new CollabError("cursor_fork_detected", "The cursor sequence resolves to a different journal hash");
    }
    return {
      epoch_id: event.epoch_id,
      sequence: event.sequence,
      hash: event.hash
    };
  }
  projectAvailableTasks(workspaceId, tasks, allowExpired) {
    const claimable = [];
    const conflicted = [];
    for (const task of tasks) {
      const available = task.effective_status === "open" || task.effective_status === "lease_expired" && allowExpired(task);
      if (!available || !this.dependenciesSatisfied(workspaceId, task.dependencies))
        continue;
      const conflicts = this.taskPathConflicts(task);
      if (conflicts.length > 0) {
        conflicted.push({ task, conflicts });
      } else {
        claimable.push(task);
      }
    }
    return { claimable, conflicted };
  }
  dependenciesSatisfied(workspaceId, dependencies) {
    return dependencies.every((id) => {
      const dependency = this.requireTask(workspaceId, id);
      if (dependency.status !== "completed")
        return false;
      return dependency.completion_policy !== "accepted" || dependency.review_status === "accepted";
    });
  }
  taskPathConflicts(task) {
    if (task.path_scopes.length === 0 || task.work_mode === "read_only")
      return [];
    const workspace = this.requireWorkspace(task.workspace_id);
    const rows = this.db.query(`
      SELECT t.*
      FROM tasks t
      JOIN workspaces w ON w.id = t.workspace_id
      WHERE (w.repository_key = ? OR w.id IN (
        SELECT other.workspace_id FROM worktrees own
        JOIN repository_aliases a ON a.worktree_id = own.id
        JOIN repository_aliases b ON b.portable_key = a.portable_key
        JOIN worktrees other ON other.id = b.worktree_id
        WHERE own.workspace_id = ?
      ))
        AND NOT (t.workspace_id = ? AND t.id = ?)
        AND (
          (t.status = 'claimed' AND (t.lease_expires_at > ? OR t.assignee_session_id IS NOT NULL))
          OR (t.status = 'completed' AND t.completion_policy = 'accepted'
              AND t.review_status = 'pending')
        )
    `).all(workspace.repository_key, task.workspace_id, task.workspace_id, task.id, this.timestamp());
    const result = [];
    for (const row of rows) {
      if (row.work_mode === "read_only")
        continue;
      const pairs = pathConflicts(task.path_scopes, parseStringArray(row.path_scopes_json));
      if (pairs.length > 0) {
        result.push({
          active_task_id: row.id,
          active_workspace_id: row.workspace_id,
          assignee: row.assignee,
          assignee_session_id: row.assignee_session_id,
          lease_expires_at: row.lease_expires_at,
          path_pairs: pairs
        });
      }
    }
    return result;
  }
  requireActiveSessionLease(row, session, leaseId) {
    if (row.status !== "claimed" || !row.lease_id || !row.lease_expires_at) {
      throw new CollabError("lease_not_active", "Task does not have an active lease");
    }
    if (this.isExpired(row, row.assignee_session_id === session.id ? session : undefined)) {
      throw new CollabError("lease_expired", "Task lease has expired", {
        lease_expires_at: row.lease_expires_at
      });
    }
    if (row.assignee_session_id !== session.id || row.lease_id !== leaseId) {
      throw new CollabError("lease_not_holder", "Mutation requires the current session lease", {
        assignee: row.assignee,
        assignee_session_id: row.assignee_session_id
      });
    }
  }
  clearSessionClaim(row, session, type, payload) {
    const now = this.timestamp();
    const version = row.version + 1;
    this.db.query(`
      UPDATE tasks
      SET status = 'open', assignee = NULL, assignee_session_id = NULL,
        claim_worktree_id = NULL, lease_id = NULL, lease_expires_at = NULL,
        version = ?, updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `).run(version, now, row.workspace_id, row.id);
    this.expirePendingHandoffs(row.workspace_id, row.id, now, session.actor, "task_released");
    this.appendEvent(row.workspace_id, type, row.id, session.actor, {
      ...payload,
      version
    }, session.id);
    return this.requireTask(row.workspace_id, row.id);
  }
  liveLeaseRefusal(workspaceId, sessionId, now, holderWillResume = false) {
    const live = this.db.query(`
      SELECT * FROM tasks
      WHERE workspace_id = ? AND assignee_session_id = ?
        AND status = 'claimed'
      ORDER BY id
    `).all(workspaceId, sessionId);
    const active = live.filter((task) => holderWillResume || !this.isExpired(task, undefined, now));
    if (active.length === 0)
      return null;
    return new CollabError("session_has_active_leases", "Release, complete, or hand off active task leases before ending the session, or end with release_leases: true. " + "A handoff counts once it is accepted; release_leases also expires this session's pending outgoing offers", {
      task_ids: active.map((task) => task.id),
      leases: active.map((task) => ({
        task_id: task.id,
        lease_id: task.lease_id,
        expires_at: task.lease_expires_at
      })),
      required_action: "resolve_active_task_leases",
      remedy: "Call collab_session_end again with release_leases: true (optionally release_summary) to release every lease this session holds and end in one step, or release, complete, or hand off each lease first. A handoff counts once it is accepted: ending with release_leases expires any offer still pending."
    });
  }
  expireSessionLeaseForRecovery(row, session, now) {
    const holder = row.assignee_session_id === session.id ? session : this.requireCoordinationSessionRow(row.assignee_session_id);
    const staleAt = holder.status === "ended" ? Date.parse(holder.ended_at ?? now) : Date.parse(holder.last_seen_at) + SESSION_STALE_AFTER_MS + 1;
    const lapse = this.db.query(`SELECT effective_at FROM session_lease_lapses WHERE lease_id = ?`).get(row.lease_id);
    const effectiveAt = lapse?.effective_at ?? (Number.isFinite(staleAt) ? new Date(Math.max(Date.parse(row.lease_expires_at), staleAt)).toISOString() : now);
    const prior = {
      assignee: row.assignee,
      session_id: row.assignee_session_id,
      lease_id: row.lease_id,
      lease_expires_at: row.lease_expires_at,
      checkpoint: parseCheckpoint(row.base_checkpoint_json)
    };
    const expiryVersion = row.version + 1;
    this.db.query(`
      UPDATE tasks
      SET status = 'open', assignee = NULL, assignee_session_id = NULL,
        claim_worktree_id = NULL, lease_id = NULL, lease_expires_at = NULL,
        version = ?, updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `).run(expiryVersion, now, row.workspace_id, row.id);
    this.expirePendingHandoffs(row.workspace_id, row.id, now, "system:clock", "source_lease_expired");
    this.appendEvent(row.workspace_id, "task.claim_expired", row.id, "system:clock", {
      ...prior,
      effective_at: effectiveAt,
      lease_lifetime_basis: "session_liveness",
      observed_by_session_id: session.id,
      version: expiryVersion
    });
    return { prior, expiryVersion };
  }
  recordRecoveryWithoutTakeover(row, session, input) {
    const version = input.expiry_version + 1;
    this.db.query(`
      UPDATE tasks
      SET status = ?, blocker = ?, version = ?, updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `).run(input.action === "block" ? "blocked" : "open", input.action === "block" ? input.blocker : null, version, input.now, row.workspace_id, row.id);
    const event = this.appendEvent(row.workspace_id, "task.recovered", row.id, session.actor, {
      prior_lease: input.prior,
      action: input.action,
      recovery_note: input.recovery_note,
      recovery_checkpoint: null,
      version,
      note: "Recovery acknowledges an expired coordination lease; it does not accept or attribute prior work."
    }, session.id);
    this.db.query(`
      INSERT INTO task_recoveries (
        id, workspace_id, task_id, prior_lease_id, prior_session_id,
        recovered_by_session_id, action, note, prior_checkpoint_json,
        new_lease_id, recovered_at, event_sequence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(`recovery_${randomUUID()}`, row.workspace_id, row.id, input.prior.lease_id, input.prior.session_id, session.id, input.action, input.recovery_note, input.prior.checkpoint ? canonicalJson(input.prior.checkpoint) : null, input.now, event.sequence);
    return this.requireTask(row.workspace_id, row.id);
  }
  recoveryBundle(row) {
    return {
      task_id: row.id,
      prior_assignee: row.assignee,
      prior_session_id: row.assignee_session_id,
      prior_lease_id: row.lease_id,
      lease_expires_at: row.lease_expires_at,
      base_checkpoint: parseCheckpoint(row.base_checkpoint_json),
      latest_progress: row.latest_progress,
      required_action: "collab_task_recover"
    };
  }
  validateReportInput(session, input) {
    if (input.task_id)
      this.requireTaskRow(session.workspace_id, input.task_id);
    if (input.to_session_id) {
      const targetSession = this.requireCoordinationSessionRow(input.to_session_id);
      if (targetSession.workspace_id !== session.workspace_id) {
        throw new CollabError("report_target_mismatch", "Report target is in another workspace");
      }
    }
    if (input.relation === "informs" && input.target_report_id) {
      throw new CollabError("invalid_report_relation", "An informing report does not target another report. To agree with or answer a report, use " + 'relation "supports" (or "challenges" to disagree) with target_report_id; ' + "to address a session, use to_session_id");
    }
    if (input.relation !== "informs" && !input.target_report_id) {
      throw new CollabError("report_target_required", "This report relation requires an earlier target report");
    }
    if (input.target_report_id) {
      const target = this.requireReport(input.target_report_id);
      if (target.workspace_id !== session.workspace_id) {
        throw new CollabError("report_target_mismatch", "Target report is in another workspace");
      }
      if (target.task_id !== input.task_id) {
        throw new CollabError("report_task_mismatch", "Related reports must use the same task scope as their target", { target_task_id: target.task_id, report_task_id: input.task_id });
      }
      if (["corrects", "withdraws", "supersedes"].includes(input.relation) && target.from_session_id !== session.id) {
        throw new CollabError("report_author_mismatch", "Only the original author session may correct, withdraw, or supersede its report; other sessions should challenge it");
      }
      if (input.relation === "resolves" && target.relation !== "challenges") {
        throw new CollabError("invalid_report_relation", "A resolving report must target a challenge. To agree with or confirm a proposal, use " + 'relation "supports" with target_report_id');
      }
    }
    if (input.kind === "decision" && (!input.authority_scope || !input.authority_basis)) {
      throw new CollabError("decision_authority_required", "Decision reports require an explicit authority scope and basis");
    }
    for (const reference of input.evidence_refs) {
      this.requireEvidenceRef(session.workspace_id, reference);
    }
  }
  appendReportInternal(session, input) {
    const id = `report_${randomUUID()}`;
    const now = this.timestamp();
    const event = this.appendEvent(session.workspace_id, "report.posted", id, session.actor, {
      ...input.to_person ? { to_person: true } : {},
      ...input.about_proposal_id ? { about_proposal_id: input.about_proposal_id } : {},
      ...input.note ? { note: input.note } : {},
      task_id: input.task_id,
      to_session_id: input.to_session_id,
      kind: input.kind,
      body: input.body,
      evidence_refs: input.evidence_refs,
      confidence: input.confidence,
      confidence_basis: input.confidence_basis,
      limits: input.limits,
      relation: input.relation,
      target_report_id: input.target_report_id,
      authority_scope: input.authority_scope,
      authority_basis: input.authority_basis
    }, session.id);
    this.db.query(`
      INSERT INTO reports (
        id, workspace_id, task_id, from_session_id, from_actor, to_session_id,
        kind, body, evidence_refs_json, confidence, confidence_basis, limits,
        relation, target_report_id, authority_scope, authority_basis,
        created_at, event_sequence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, session.workspace_id, input.task_id, session.id, session.actor, input.to_session_id, input.kind, input.body, canonicalJson(input.evidence_refs), input.confidence, input.confidence_basis, input.limits, input.relation, input.target_report_id, input.authority_scope, input.authority_basis, now, event.sequence);
    if (input.to_person) {
      this.db.query(`INSERT INTO person_addressed_reports (report_id, workspace_id) VALUES (?, ?)`).run(id, session.workspace_id);
    }
    return this.requireReport(id);
  }
  requireReport(id) {
    const row = this.db.query(`SELECT * FROM reports WHERE id = ?`).get(id);
    if (!row)
      throw new CollabError("report_not_found", `Report '${id}' was not found`);
    return reportFromRow(row);
  }
  requireReview(id) {
    const row = this.db.query(`SELECT * FROM task_reviews WHERE id = ?`).get(id);
    if (!row)
      throw new CollabError("review_not_found", `Review '${id}' was not found`);
    return reviewFromRow(row);
  }
  taskNotPendingReviewError(row, callerSessionId) {
    const plain = new CollabError("task_not_pending_review", "Task does not have a pending acceptance review", { review_status: row.review_status });
    if (row.completion_policy !== "accepted" || row.review_status !== "accepted" || !row.accepted_by_session_id || row.reported_by_session_id === callerSessionId || row.accepted_by_session_id === callerSessionId) {
      return plain;
    }
    const acceptance = this.db.query(`
      SELECT e.type AS type, e.payload_json AS payload_json
      FROM task_reviews r
      JOIN events e ON e.workspace_id = r.workspace_id AND e.sequence = r.event_sequence
      WHERE r.workspace_id = ? AND r.task_id = ? AND r.review_generation = ?
        AND r.outcome = 'accepted'
    `).get(row.workspace_id, row.id, row.review_generation);
    if (!acceptance || acceptance.type !== "task.accepted")
      return plain;
    const payload = JSON.parse(acceptance.payload_json);
    if (typeof payload.review_report_id !== "string")
      return plain;
    const reviewReportId = payload.review_report_id;
    const remedy = `Record a late concurring or dissenting review with collab_report_append: task_id "${row.id}", ` + `relation "supports" or "challenges", target_report_id "${reviewReportId}". ` + "A challenge records disagreement; it does not reopen the accepted task.";
    return new CollabError("task_not_pending_review", `Task was already accepted by session '${row.accepted_by_session_id}'. ${remedy}`, {
      review_status: row.review_status,
      review_report_id: reviewReportId,
      accepted_by_session_id: row.accepted_by_session_id,
      remedy
    });
  }
  requireRequestedReviewer(row, session, requestedSessionId) {
    if (row.completion_policy !== "accepted") {
      throw new CollabError("review_request_not_applicable", 'Only tasks with completion_policy "accepted" wait for review; omit review_requested_session_id', { completion_policy: row.completion_policy });
    }
    if (requestedSessionId === session.id) {
      throw new CollabError("review_request_self", "A requested reviewer must be a session distinct from the reporter");
    }
    const requested = this.db.query(`
      SELECT workspace_id, status FROM coordination_sessions WHERE id = ?
    `).get(requestedSessionId);
    if (!requested || requested.workspace_id !== session.workspace_id || requested.status !== "active") {
      throw new CollabError("review_requested_session_unavailable", "The requested reviewer must be an active session in this workspace; collab_workspace_status lists active_sessions", { review_requested_session_id: requestedSessionId });
    }
  }
  reviewRequestedSessionId(row) {
    if (row.status !== "completed" || row.completion_policy !== "accepted" || !row.completion_report_id) {
      return null;
    }
    const completion = this.db.query(`SELECT event_sequence FROM reports WHERE id = ?`).get(row.completion_report_id);
    if (!completion)
      return null;
    const event = this.db.query(`
      SELECT payload_json FROM events
      WHERE workspace_id = ? AND sequence > ? AND entity_id = ? AND type = 'task.reported_complete'
      ORDER BY sequence
      LIMIT 1
    `).get(row.workspace_id, completion.event_sequence, row.id);
    if (!event)
      return null;
    const payload = JSON.parse(event.payload_json);
    return payload.completion_report_id === row.completion_report_id && typeof payload.review_requested_session_id === "string" ? payload.review_requested_session_id : null;
  }
  hasUnresolvedChallenges(workspaceId, reportId) {
    return this.unresolvedChallengeIds(workspaceId, reportId).length > 0;
  }
  unresolvedChallengeIds(workspaceId, reportId) {
    const challenges = this.db.query(`
      SELECT id FROM reports
      WHERE workspace_id = ? AND target_report_id = ? AND relation = 'challenges'
      ORDER BY event_sequence
    `).all(workspaceId, reportId);
    return challenges.filter((challenge) => !this.hasActiveReportRelation(workspaceId, challenge.id, new Set(["withdraws"])) && !this.hasActiveReportRelation(workspaceId, challenge.id, new Set(["resolves"]))).map((challenge) => challenge.id);
  }
  hasObsoletedCompletionReport(workspaceId, reportId) {
    return this.hasActiveReportRelation(workspaceId, reportId, new Set(["withdraws", "corrects", "supersedes"]));
  }
  hasActiveReportRelation(workspaceId, reportId, relations) {
    const rows = this.db.query(`
      SELECT id, relation FROM reports
      WHERE workspace_id = ? AND target_report_id = ?
      ORDER BY event_sequence
    `).all(workspaceId, reportId);
    const obsoleted = this.activeObsoletionTargets(workspaceId);
    return rows.some((row) => relations.has(row.relation) && !obsoleted.has(row.id));
  }
  activeObsoletionTargets(workspaceId) {
    const rows = this.db.query(`
      SELECT id, target_report_id FROM reports
      WHERE workspace_id = ? AND target_report_id IS NOT NULL
        AND relation IN ('withdraws', 'corrects', 'supersedes')
      ORDER BY event_sequence DESC, id DESC
    `).all(workspaceId);
    const obsoleted = new Set;
    for (const row of rows) {
      if (!obsoleted.has(row.id))
        obsoleted.add(row.target_report_id);
    }
    return obsoleted;
  }
  requireEvidenceRef(workspaceId, reference) {
    const separator = reference.indexOf(":");
    if (separator < 1)
      throw invalidEvidenceRef("Evidence reference needs a kind prefix");
    const kind = reference.slice(0, separator);
    const id = reference.slice(separator + 1);
    if (!id)
      throw invalidEvidenceRef("Evidence reference ID is empty");
    let exists = false;
    if (kind === "artifact") {
      exists = this.db.query(`
        SELECT 1 FROM artifacts WHERE workspace_id = ? AND id = ?
      `).get(workspaceId, id) !== null;
    } else if (kind === "event") {
      exists = this.db.query(`
        SELECT 1 FROM events WHERE workspace_id = ? AND id = ?
      `).get(workspaceId, id) !== null;
    } else if (kind === "report") {
      exists = this.db.query(`
        SELECT 1 FROM reports WHERE workspace_id = ? AND id = ?
      `).get(workspaceId, id) !== null;
    } else if (kind === "checkpoint") {
      const tasks = this.db.query(`
        SELECT base_checkpoint_json, result_checkpoint_json
        FROM tasks WHERE workspace_id = ?
      `).all(workspaceId);
      exists = tasks.some((task) => {
        const checkpoints = [
          parseCheckpoint(task.base_checkpoint_json),
          parseCheckpoint(task.result_checkpoint_json)
        ];
        return checkpoints.some((checkpoint) => checkpoint !== null && checkpointDigest(checkpoint) === id);
      });
    } else {
      throw invalidEvidenceRef("Unsupported evidence reference kind");
    }
    if (!exists) {
      throw new CollabError("evidence_not_found", `Evidence reference was not found in this workspace. ${EVIDENCE_REFS_DESCRIPTION}`, { reference, allowed_prefixes: [...EVIDENCE_REF_PREFIXES] });
    }
  }
  appendEvent(workspaceId, type, entityId, actor, payload, sessionId = null) {
    const workspace = this.requireWorkspace(workspaceId);
    const event = {
      protocol: COLLAB_COORDINATION_PROTOCOL,
      workspace_id: workspaceId,
      epoch_id: workspace.epoch_id,
      sequence: workspace.event_head_sequence + 1,
      id: `event_${randomUUID()}`,
      type,
      entity_id: entityId,
      actor,
      session_id: sessionId,
      occurred_at: this.timestamp(),
      payload,
      prev_hash: workspace.event_head_hash,
      hash: ""
    };
    event.hash = eventHash(event);
    this.db.query(`
      INSERT INTO events
        (workspace_id, epoch_id, sequence, id, protocol, type, entity_id, actor,
          session_id, occurred_at, payload_json, prev_hash, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(event.workspace_id, event.epoch_id, event.sequence, event.id, event.protocol, event.type, event.entity_id, event.actor, event.session_id ?? null, event.occurred_at, canonicalJson(event.payload), event.prev_hash, event.hash);
    this.db.query(`
      UPDATE workspaces SET event_head_sequence = ?, event_head_hash = ? WHERE id = ?
    `).run(event.sequence, event.hash, workspaceId);
    return event;
  }
  expireClaim(row, actor) {
    if (!this.isExpired(row))
      return row;
    const now = this.timestamp();
    const version = row.version + 1;
    const prior = { assignee: row.assignee, lease_id: row.lease_id, lease_expires_at: row.lease_expires_at };
    this.db.query(`
      UPDATE tasks SET status = 'open', assignee = NULL, lease_id = NULL, lease_expires_at = NULL,
        version = ?, updated_at = ? WHERE workspace_id = ? AND id = ?
    `).run(version, now, row.workspace_id, row.id);
    this.expirePendingHandoffs(row.workspace_id, row.id, now, actor, "source_lease_expired");
    this.appendEvent(row.workspace_id, "task.claim_expired", row.id, actor, { ...prior, version });
    return this.requireTaskRow(row.workspace_id, row.id);
  }
  clearClaim(row, actor, type, payload) {
    const now = this.timestamp();
    const version = row.version + 1;
    this.db.query(`
      UPDATE tasks SET status = 'open', assignee = NULL, lease_id = NULL,
        lease_expires_at = NULL, version = ?, updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `).run(version, now, row.workspace_id, row.id);
    this.expirePendingHandoffs(row.workspace_id, row.id, now, actor, "task_released");
    this.appendEvent(row.workspace_id, type, row.id, actor, { ...payload, version });
    return this.requireTask(row.workspace_id, row.id);
  }
  expirePendingHandoffs(workspaceId, taskId, now, actor, reason) {
    const rows = this.db.query(`
      SELECT * FROM handoffs WHERE workspace_id = ? AND task_id = ? AND status = 'pending'
    `).all(workspaceId, taskId);
    for (const row of rows) {
      this.db.query(`UPDATE handoffs SET status = 'expired', resolved_at = ? WHERE id = ?`).run(now, row.id);
      this.appendEvent(workspaceId, "handoff.expired", row.id, actor, { task_id: taskId, reason });
    }
  }
  expireElapsedHandoffs(workspaceId, actor, taskId) {
    this.requireWorkspace(workspaceId);
    const reap = this.db.transaction(() => {
      const now = this.timestamp();
      const rows = taskId ? this.db.query(`
            SELECT * FROM handoffs
            WHERE workspace_id = ? AND task_id = ? AND status = 'pending' AND expires_at <= ?
          `).all(workspaceId, taskId, now) : this.db.query(`
            SELECT * FROM handoffs
            WHERE workspace_id = ? AND status = 'pending' AND expires_at <= ?
          `).all(workspaceId, now);
      for (const row of rows) {
        this.db.query(`UPDATE handoffs SET status = 'expired', resolved_at = ? WHERE id = ?`).run(now, row.id);
        this.appendEvent(workspaceId, "handoff.expired", row.id, actor, {
          task_id: row.task_id,
          reason: "offer_deadline_elapsed"
        });
      }
    });
    reap.immediate();
    this.tightenFileModes();
  }
  requireDependenciesComplete(row) {
    const dependencies = parseStringArray(row.dependencies_json);
    const incomplete = dependencies.filter((id) => !this.dependenciesSatisfied(row.workspace_id, [id]));
    if (incomplete.length > 0) {
      throw new CollabError("dependencies_incomplete", "Task dependencies are not complete", { dependencies: incomplete });
    }
  }
  requirePathsAvailable(row) {
    const conflicts = this.taskPathConflicts(this.taskFromRow(row));
    if (conflicts.length > 0) {
      const first = conflicts[0];
      throw new CollabError("path_scope_conflict", "Task paths overlap reserved work", {
        conflicting_task_id: first.active_task_id,
        conflicting_workspace_id: first.active_workspace_id,
        assignee: first.assignee,
        assignee_session_id: first.assignee_session_id,
        lease_expires_at: first.lease_expires_at,
        conflicts: first.path_pairs
      });
    }
  }
  requireActiveLease(row, actor, leaseId) {
    if (row.status !== "claimed" || !row.lease_id || !row.lease_expires_at) {
      throw new CollabError("lease_not_active", "Task does not have an active lease");
    }
    if (this.isExpired(row)) {
      throw new CollabError("lease_expired", "Task lease has expired", { lease_expires_at: row.lease_expires_at });
    }
    if (row.assignee !== actor || row.lease_id !== leaseId) {
      throw new CollabError("lease_not_holder", "Mutation requires the current lease holder", {
        assignee: row.assignee
      });
    }
  }
  requireVersion(row, expected) {
    if (row.version !== expected) {
      throw new CollabError("version_conflict", "Task changed since it was read", {
        expected_version: expected,
        current_version: row.version
      });
    }
  }
  recordSessionLeaseLapses(session, now) {
    if (sessionLiveness(session, now) === "live")
      return;
    const staleAt = new Date(Date.parse(session.last_seen_at) + SESSION_STALE_AFTER_MS + 1).toISOString();
    this.db.query(`INSERT OR IGNORE INTO session_lease_lapses (lease_id, effective_at)
      SELECT lease_id, MAX(lease_expires_at, ?) FROM tasks
      WHERE assignee_session_id = ? AND status = 'claimed' AND lease_expires_at <= ?`).run(staleAt, session.id, now);
  }
  isExpired(row, priorHolder, observedAt = this.timestamp()) {
    if (row.status !== "claimed" || row.lease_expires_at === null || observedAt < row.lease_expires_at)
      return false;
    if (!row.assignee_session_id)
      return true;
    if (this.db.query(`SELECT 1 FROM session_lease_lapses WHERE lease_id = ?`).get(row.lease_id))
      return true;
    return (priorHolder ? sessionLiveness(priorHolder, observedAt) : this.assigneeLiveness(row.assignee_session_id, observedAt)) !== "live";
  }
  taskFromRow(row) {
    let effectiveStatus = row.status;
    if (this.isExpired(row)) {
      effectiveStatus = row.assignee_session_id ? "recovery_required" : "lease_expired";
    } else if (row.status === "completed" && row.review_status === "pending") {
      effectiveStatus = "reported_complete";
    } else if (row.status === "completed" && row.review_status === "accepted") {
      effectiveStatus = "accepted";
    }
    const baseCheckpoint = parseCheckpoint(row.base_checkpoint_json);
    const resultCheckpoint = parseCheckpoint(row.result_checkpoint_json);
    return {
      id: row.id,
      workspace_id: row.workspace_id,
      title: row.title,
      description: row.description,
      status: row.status,
      effective_status: effectiveStatus,
      dependencies: parseStringArray(row.dependencies_json),
      path_scopes: parseStringArray(row.path_scopes_json),
      work_mode: row.work_mode,
      completion_policy: row.completion_policy,
      review_status: row.review_status,
      expected_base_sha: row.expected_base_sha,
      base_checkpoint: baseCheckpoint,
      base_checkpoint_digest: baseCheckpoint ? checkpointDigest(baseCheckpoint) : null,
      result_checkpoint: resultCheckpoint,
      result_checkpoint_digest: resultCheckpoint ? checkpointDigest(resultCheckpoint) : null,
      completion_report_id: row.completion_report_id,
      assignee: row.assignee,
      assignee_session_id: row.assignee_session_id,
      assignee_liveness: this.assigneeLiveness(row.assignee_session_id),
      claim_worktree_id: row.claim_worktree_id,
      lease_id: row.lease_id,
      lease_expires_at: row.lease_expires_at,
      blocker: row.blocker,
      latest_progress: row.latest_progress,
      reported_by: row.reported_by,
      reported_by_session_id: row.reported_by_session_id,
      reported_at: row.reported_at,
      accepted_by: row.accepted_by,
      accepted_by_session_id: row.accepted_by_session_id,
      accepted_at: row.accepted_at,
      review_requested_session_id: this.reviewRequestedSessionId(row),
      version: row.version,
      created_at: row.created_at,
      updated_at: row.updated_at,
      completed_at: row.completed_at
    };
  }
  sessionProjection(row, observedAt = this.timestamp()) {
    return coordinationSessionFromRow(row, observedAt);
  }
  assigneeLiveness(sessionId, observedAt = this.timestamp()) {
    if (!sessionId)
      return null;
    const holder = this.db.query(`
      SELECT status, last_seen_at FROM coordination_sessions WHERE id = ?
    `).get(sessionId);
    return holder ? sessionLiveness(holder, observedAt) : null;
  }
  requireWorkspace(workspaceId, db = this.db) {
    const workspace = this.getWorkspace(workspaceId, db);
    if (!workspace)
      throw new CollabError("workspace_not_found", `Workspace '${workspaceId}' was not found`);
    return workspace;
  }
  readPresenceSessionByClient(workspaceId, clientInstanceId) {
    return this.db.query(`
      SELECT * FROM sessions
      WHERE workspace_id = ? AND client_instance_id = ?
    `).get(workspaceId, clientInstanceId);
  }
  requirePresenceSessionRow(sessionId) {
    const row = this.db.query(`SELECT * FROM sessions WHERE id = ?`).get(sessionId);
    if (!row) {
      throw new CollabError("session_not_found", `Presence session '${sessionId}' was not found`);
    }
    return row;
  }
  requireCoordinationSessionRow(sessionId) {
    const row = this.db.query(`SELECT * FROM coordination_sessions WHERE id = ?`).get(sessionId);
    if (!row)
      throw new CollabError("session_not_found", `Session '${sessionId}' was not found`);
    return row;
  }
  readTaskRow(workspaceId, taskId) {
    return this.db.query(`SELECT * FROM tasks WHERE workspace_id = ? AND id = ?`).get(workspaceId, taskId);
  }
  requireTaskRow(workspaceId, taskId) {
    const row = this.readTaskRow(workspaceId, taskId);
    if (!row)
      throw new CollabError("task_not_found", `Task '${taskId}' was not found`, { task_id: taskId });
    return row;
  }
  requireTask(workspaceId, taskId) {
    return this.taskFromRow(this.requireTaskRow(workspaceId, taskId));
  }
  listArtifacts(workspaceId, taskId) {
    const rows = this.db.query(`
      SELECT id, task_id, kind, uri, sha256, media_type, label, attached_by, attached_at
        , attached_by_session_id
      FROM artifacts WHERE workspace_id = ? AND task_id = ? ORDER BY attached_at, id
    `).all(workspaceId, taskId);
    return rows.map(artifactFromRow);
  }
  requireArtifact(id) {
    const row = this.db.query(`
      SELECT id, task_id, kind, uri, sha256, media_type, label, attached_by, attached_at
        , attached_by_session_id
      FROM artifacts WHERE id = ?
    `).get(id);
    if (!row)
      throw new CollabError("artifact_not_found", `Artifact '${id}' was not found`);
    return artifactFromRow(row);
  }
  requireDecision(id) {
    const row = this.db.query(`
      SELECT id, workspace_id, topic, decision, rationale, recorded_by, recorded_at
      FROM decisions WHERE id = ?
    `).get(id);
    if (!row)
      throw new CollabError("decision_not_found", `Decision '${id}' was not found`);
    return decisionFromRow(row);
  }
  requireHandoff(id) {
    const row = this.db.query(`SELECT * FROM handoffs WHERE id = ?`).get(id);
    if (!row)
      throw new CollabError("handoff_not_found", `Handoff '${id}' was not found`);
    return handoffFromRow(row);
  }
  latestReceiptKeyForSession(credential, prefix) {
    return this.latestReceiptKey(this.authenticateSession(credential), prefix);
  }
  latestReceiptKey(session, prefix) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*:$/.test(prefix) || prefix.length > 100) {
      throw new CollabError("invalid_receipt_prefix", "A receipt prefix is a key prefix ending in ':'");
    }
    const upper = `${prefix.slice(0, -1)};`;
    const row = this.db.query(`
      SELECT idempotency_key FROM mutations
      WHERE workspace_id = ? AND actor = ? AND idempotency_key >= ? AND idempotency_key < ?
      ORDER BY idempotency_key DESC
      LIMIT 1
    `).get(session.workspace_id, `session:${session.id}`, prefix, upper);
    return row?.idempotency_key ?? null;
  }
  withReceiptPlan(plan, run) {
    if (!plan)
      return run();
    if (this.ambientReceiptPlan)
      throw new CollabError("receipt_plan_nested", "A receipt plan is already in force");
    this.ambientReceiptPlan = plan;
    try {
      return run();
    } finally {
      this.ambientReceiptPlan = null;
    }
  }
  ambientPlanFor(idempotencyKey) {
    const plan = this.ambientReceiptPlan;
    if (!plan)
      return;
    return idempotencyKey === plan.key || idempotencyKey.startsWith(`${plan.key}:`) ? plan : undefined;
  }
  requireReceiptPlan(session, plan) {
    const latest = this.latestReceiptKey(session, plan.prefix);
    if (latest === plan.latest || latest === plan.key || latest !== null && latest.startsWith(`${plan.key}:`))
      return;
    throw new CollabError("receipt_plan_stale", "Another call by this session acted on the same entity after this call chose its key; nothing was written");
  }
  timestamp() {
    return this.now().toISOString();
  }
}
function normalizeMutation(input) {
  return { ...input, actor: validateActor(input.actor), idempotency_key: validateIdempotencyKey(input.idempotency_key) };
}
function normalizeVersionedMutation(input) {
  validateExpectedVersion(input.expected_version);
  return normalizeMutation(input);
}
function normalizeLeaseInput(input) {
  return {
    ...normalizeVersionedMutation(input),
    task_id: validateId(input.task_id, "task_id"),
    lease_id: validateId(input.lease_id, "lease_id")
  };
}
function validateActor(value) {
  const actor = cleanText(value, "actor", 200);
  if (/^person:/i.test(actor)) {
    throw new CollabError("invalid_actor", "Actor labels beginning with person: are reserved for the person desk");
  }
  return actor;
}
function derivedActor(prefix, sessionId) {
  if (prefix === undefined) {
    throw new CollabError("actor_required", "Supply actor, or actor_prefix to derive one from the new session id");
  }
  if (typeof prefix !== "string" || !/^[a-z][a-z0-9-]{0,39}$/.test(prefix)) {
    throw new CollabError("invalid_actor_prefix", "actor_prefix is 1 to 40 lower-case letters, digits or dashes");
  }
  return validateActor(`${prefix}-${sessionId.slice("session_".length, "session_".length + 6)}`);
}
var MAX_MODEL_LABEL = 200;
function validateModelLabel(value) {
  const model = cleanText(value, "model", MAX_MODEL_LABEL);
  if (/[\u0000-\u001f\u007f]/.test(model)) {
    throw new CollabError("invalid_model", "model must be one line of text");
  }
  return model;
}
function validateExpectedVersion(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new CollabError("invalid_expected_version", "expected_version must be a positive integer");
  }
  return value;
}
function validateRuntimeKind(value) {
  const runtime = cleanText(value, "runtime_kind", 64).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:-]*$/.test(runtime)) {
    throw new CollabError("invalid_runtime_kind", "runtime_kind contains unsupported characters");
  }
  return runtime;
}
function normalizeSessionCapabilities(values) {
  if (!Array.isArray(values) || values.length > MAX_SESSION_CAPABILITIES) {
    throw new CollabError("invalid_declared_capabilities", `A session may declare at most ${MAX_SESSION_CAPABILITIES} capabilities`);
  }
  const normalized = values.map((value) => {
    const capability = cleanText(value, "declared_capability", MAX_SESSION_CAPABILITY_LENGTH).toLowerCase();
    if (!/^[a-z0-9][a-z0-9._:-]*$/.test(capability)) {
      throw new CollabError("invalid_declared_capability", "Declared capabilities must be symbolic names, not free-form content");
    }
    return capability;
  });
  return uniqueSorted(normalized);
}
function validatePresenceTtl(value) {
  const ttl = value ?? DEFAULT_PRESENCE_SECONDS;
  if (!Number.isInteger(ttl) || ttl < 30 || ttl > MAX_PRESENCE_SECONDS) {
    throw new CollabError("invalid_presence_ttl", `ttl_seconds must be an integer between 30 and ${MAX_PRESENCE_SECONDS}`);
  }
  return ttl;
}
function validateSessionListLimit(value) {
  const limit = value ?? DEFAULT_SESSION_LIST_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SESSION_LIST_LIMIT) {
    throw new CollabError("invalid_session_list_limit", `limit must be an integer between 1 and ${MAX_SESSION_LIST_LIMIT}`);
  }
  return limit;
}
function validateNextEventLimit(value) {
  const limit = value ?? DEFAULT_NEXT_EVENT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_NEXT_EVENT_LIMIT) {
    throw new CollabError("invalid_event_limit", `event_limit must be an integer between 1 and ${MAX_NEXT_EVENT_LIMIT}`);
  }
  return limit;
}
var BOUND_AFTER_SEQUENCE_REMEDY = "A bound collab_next always pages from the acknowledged session cursor. Advance it with " + "collab_cursor_ack (next_anchor of the page you processed), or read from any position " + "without acknowledging with collab_events_since (after_sequence or after_anchor).";
function requireBoundAfterSequence(afterSequence, session) {
  if (!Number.isInteger(afterSequence) || afterSequence < 0) {
    throw new CollabError("invalid_cursor", "Event cursor must be a non-negative integer");
  }
  if (afterSequence === session.cursor_sequence)
    return;
  throw new CollabError("after_sequence_unsupported_in_bound_session", `after_sequence ${afterSequence} differs from this session's acknowledged cursor ` + `(sequence ${session.cursor_sequence}). ${BOUND_AFTER_SEQUENCE_REMEDY}`, {
    after_sequence: afterSequence,
    cursor: {
      epoch_id: session.cursor_epoch_id,
      sequence: session.cursor_sequence,
      hash: session.cursor_hash
    },
    cursor_version: session.cursor_version,
    remedy: BOUND_AFTER_SEQUENCE_REMEDY
  });
}
function normalizeSessionRenewInput(input) {
  if (input.expected_version !== undefined)
    validateExpectedVersion(input.expected_version);
  const request = {
    task_id: validateId(input.task_id, "task_id"),
    lease_id: validateId(input.lease_id, "lease_id"),
    ...input.expected_version === undefined ? {} : { expected_version: input.expected_version }
  };
  return { ...request, request, idempotency_key: validateIdempotencyKey(input.idempotency_key) };
}
function normalizeSessionLeaseInput(input) {
  const normalized = {
    idempotency_key: validateIdempotencyKey(input.idempotency_key),
    task_id: validateId(input.task_id, "task_id"),
    lease_id: validateId(input.lease_id, "lease_id"),
    expected_version: validateExpectedVersion(input.expected_version)
  };
  return {
    ...normalized,
    request: {
      task_id: normalized.task_id,
      lease_id: normalized.lease_id,
      expected_version: normalized.expected_version
    }
  };
}
function validateIdempotencyKey(value) {
  const key = cleanText(value, "idempotency_key", 200);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(key)) {
    throw new CollabError("invalid_idempotency_key", "Idempotency key contains unsupported characters");
  }
  return key;
}
function validateId(value, field) {
  const id = cleanText(value, field, 200);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) {
    throw new CollabError(`invalid_${field}`, `${field} contains unsupported characters`);
  }
  return id;
}
function cleanText(value, field, max) {
  const text = value.trim();
  if (!text)
    throw new CollabError(`invalid_${field}`, `${field} must not be empty`);
  if (text.length > max)
    throw new CollabError(`invalid_${field}`, `${field} exceeds ${max} characters`);
  if (text.includes("\x00"))
    throw new CollabError(`invalid_${field}`, `${field} must not contain NUL bytes`);
  return text;
}
function optionalText(value, field, max) {
  if (value === undefined || value.trim() === "")
    return null;
  return cleanText(value, field, max);
}
function validateTtl(value) {
  const ttl = value ?? DEFAULT_LEASE_SECONDS;
  if (!Number.isInteger(ttl) || ttl < 30 || ttl > MAX_LEASE_SECONDS) {
    throw new CollabError("invalid_ttl", `ttl_seconds must be an integer between 30 and ${MAX_LEASE_SECONDS}`);
  }
  return ttl;
}
function validateSha256(value) {
  const digest = value.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest))
    throw new CollabError("invalid_sha256", "sha256 must be 64 hexadecimal characters");
  return digest;
}
function validateGitObjectId(value) {
  const oid = value.toLowerCase();
  if (!/^[a-f0-9]{40,64}$/.test(oid)) {
    throw new CollabError("invalid_git_object_id", "Git object IDs must contain 40 to 64 hexadecimal characters");
  }
  return oid;
}
function validateArtifactKind(value) {
  if (!["file", "commit", "test", "data", "url", "other"].includes(value)) {
    throw new CollabError("invalid_artifact_kind", "Unsupported artifact kind");
  }
  return value;
}
function validateReportKind(value) {
  if (!["observation", "inference", "proposal", "decision"].includes(value)) {
    throw new CollabError("invalid_report_kind", "Unsupported report kind");
  }
  return value;
}
function validateReportConfidence(value) {
  if (!["high", "medium", "low", "unknown"].includes(value)) {
    throw new CollabError("invalid_report_confidence", "Unsupported report confidence");
  }
  return value;
}
function validateReportRelation(value) {
  if (![
    "informs",
    "supports",
    "challenges",
    "corrects",
    "withdraws",
    "supersedes",
    "resolves"
  ].includes(value)) {
    throw new CollabError("invalid_report_relation", "Unsupported report relation");
  }
  return value;
}
function normalizeEvidenceRefs(references) {
  if (!Array.isArray(references) || references.length > MAX_REPORT_REFS) {
    throw new CollabError("invalid_evidence_refs", `A report may contain at most ${MAX_REPORT_REFS} evidence references`);
  }
  return uniqueSorted(references.map((reference) => {
    if (typeof reference !== "string") {
      throw invalidEvidenceRef("Evidence references must be strings");
    }
    try {
      return cleanText(reference, "evidence_ref", MAX_REPORT_REF_LENGTH);
    } catch (error) {
      if (error instanceof CollabError)
        throw invalidEvidenceRef(error.message);
      throw error;
    }
  }));
}
function invalidEvidenceRef(reason) {
  return new CollabError("invalid_evidence_ref", `${reason}. ${EVIDENCE_REFS_DESCRIPTION}`, { allowed_prefixes: [...EVIDENCE_REF_PREFIXES] });
}
function normalizePathScopes(scopes) {
  if (!Array.isArray(scopes) || scopes.length > MAX_PATH_SCOPES) {
    throw new CollabError("invalid_path_scopes", `A task may have at most ${MAX_PATH_SCOPES} path scopes`);
  }
  let totalLength = 0;
  const normalized = scopes.map((scope) => {
    if (typeof scope !== "string" || !scope || scope.length > MAX_PATH_SCOPE_LENGTH || scope.includes("\x00") || scope.includes("\\") || isAbsolute3(scope)) {
      throw new CollabError("invalid_path_scope", "Path scopes must be non-empty repository-relative POSIX paths", { scope });
    }
    totalLength += scope.length;
    if (totalLength > MAX_PATH_SCOPES_TOTAL) {
      throw new CollabError("invalid_path_scopes", `Combined path scopes may not exceed ${MAX_PATH_SCOPES_TOTAL} characters`);
    }
    const clean = posix.normalize(scope.replace(/^\.\//, "")).replace(/\/$/, "");
    if (!clean || clean === "." || clean === ".." || clean.startsWith("../")) {
      throw new CollabError("invalid_path_scope", "Root-wide and parent path scopes are not allowed", { scope });
    }
    return clean;
  });
  return uniqueSorted(normalized);
}
function normalizeDependencies(dependencies) {
  if (!Array.isArray(dependencies) || dependencies.length > MAX_DEPENDENCIES) {
    throw new CollabError("invalid_dependencies", `A task may have at most ${MAX_DEPENDENCIES} dependencies`);
  }
  return uniqueSorted(dependencies.map((id) => validateId(id, "dependency")));
}
function pathConflicts(left, right) {
  const conflicts = [];
  for (const a of left) {
    for (const b of right) {
      const leftKey = a.normalize("NFC").toLowerCase();
      const rightKey = b.normalize("NFC").toLowerCase();
      if (leftKey === rightKey || leftKey.startsWith(`${rightKey}/`) || rightKey.startsWith(`${leftKey}/`))
        conflicts.push([a, b]);
    }
  }
  return conflicts;
}
function uniqueSorted(values) {
  return [...new Set(values)].sort();
}
function parseStringArray(json) {
  return JSON.parse(json);
}
function artifactFromRow(row) {
  return { ...row };
}
function decisionFromRow(row) {
  return { ...row };
}
function handoffFromRow(row) {
  return { ...row };
}
function eventFromRow(row) {
  const base = {
    protocol: row.protocol,
    workspace_id: row.workspace_id,
    epoch_id: row.epoch_id,
    sequence: row.sequence,
    id: row.id,
    type: row.type,
    entity_id: row.entity_id,
    actor: row.actor,
    occurred_at: row.occurred_at,
    payload: JSON.parse(row.payload_json),
    prev_hash: row.prev_hash,
    hash: row.hash
  };
  return row.protocol === LEGACY_COLLAB_PROTOCOL ? base : { ...base, session_id: row.session_id };
}
function eventHash(event) {
  if (event.protocol === LEGACY_COLLAB_PROTOCOL) {
    const { hash: _hash2, session_id: _sessionId, ...body2 } = event;
    return sha2564(canonicalJson(body2));
  }
  const { hash: _hash, ...body } = event;
  return sha2564(canonicalJson(body));
}
function verifyEventPage(events, afterSequence, predecessorHash, headSequence, headHash) {
  if (predecessorHash === null)
    return false;
  if (events.length === 0) {
    return afterSequence === headSequence && predecessorHash === headHash;
  }
  let expectedSequence = afterSequence + 1;
  let previous = predecessorHash;
  for (const event of events) {
    if (event.sequence !== expectedSequence || event.prev_hash !== previous)
      return false;
    if (event.hash !== eventHash(event))
      return false;
    previous = event.hash;
    expectedSequence += 1;
  }
  const lastSequence = events.at(-1)?.sequence ?? afterSequence;
  return lastSequence !== headSequence || previous === headHash;
}
function presenceSessionFromRow(row, observedAt) {
  const presence = row.left_at ? "left" : observedAt < row.presence_expires_at ? "live" : "stale";
  return {
    protocol: COLLAB_SESSION_PROTOCOL,
    id: row.id,
    workspace_id: row.workspace_id,
    epoch_id: row.epoch_id,
    client_instance_id: row.client_instance_id,
    actor_label: row.actor_label,
    actor_key: row.actor_key,
    runtime_kind: row.runtime_kind,
    provider_label: row.provider_label,
    model_label: row.model_label,
    declared_capabilities: parseStringArray(row.declared_capabilities_json),
    capability_basis: "self_declared",
    version: row.version,
    joined_at: row.joined_at,
    last_seen_at: row.last_seen_at,
    presence_expires_at: row.presence_expires_at,
    presence,
    left_at: row.left_at
  };
}
function requirePresenceSessionVersion(row, expectedVersion) {
  if (row.version !== expectedVersion) {
    throw new CollabError("session_version_conflict", "Presence session version changed", {
      session_id: row.id,
      expected_version: expectedVersion,
      actual_version: row.version
    });
  }
}
function requireMatchingPresenceSessionJoin(row, input) {
  const same = row.actor_label === input.actor_label && row.runtime_kind === input.runtime_kind && row.provider_label === input.provider_label && row.model_label === input.model_label && canonicalJson(parseStringArray(row.declared_capabilities_json)) === canonicalJson(input.declared_capabilities);
  if (!same) {
    throw new CollabError("session_instance_conflict", "client_instance_id was already joined with different self-declared metadata", { session_id: row.id });
  }
}
function sessionLiveness(row, observedAt) {
  if (row.status !== "active")
    return "stale";
  const age = Date.parse(observedAt) - Date.parse(row.last_seen_at);
  return age <= SESSION_STALE_AFTER_MS ? "live" : "stale";
}
function recoveryRequiredFirst(tasks, isOwn) {
  const byExpiry = (left, right) => (left.lease_expires_at ?? "").localeCompare(right.lease_expires_at ?? "") || left.id.localeCompare(right.id);
  const pending = tasks.filter((task) => task.effective_status === "recovery_required");
  return [
    ...pending.filter(isOwn).sort(byExpiry),
    ...pending.filter((task) => !isOwn(task)).sort(byExpiry)
  ];
}
function coordinationSessionFromRow(row, observedAt) {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    worktree_id: row.worktree_id,
    actor: row.actor,
    role: row.role,
    parent_session_id: row.parent_session_id,
    status: row.status,
    generation: row.generation,
    joined_at: row.joined_at,
    last_seen_at: row.last_seen_at,
    ended_at: row.ended_at,
    cursor: {
      epoch_id: row.cursor_epoch_id,
      sequence: row.cursor_sequence,
      hash: row.cursor_hash
    },
    cursor_version: row.cursor_version,
    reset_generation: row.reset_generation,
    cursor_recovery_required: row.cursor_recovery_required !== 0,
    liveness: sessionLiveness(row, observedAt)
  };
}
function worktreeFromRow(row) {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    root_path: row.root_path,
    repository_key: row.repository_key,
    git_common_dir_hash: row.git_common_dir_hash,
    branch: row.branch,
    head_sha: row.head_sha,
    dirty: sqlToBoolean(row.dirty),
    registered_at: row.registered_at,
    last_seen_at: row.last_seen_at
  };
}
function checkpointFromWorktreeRow(row, capturedAt) {
  return {
    worktree_id: row.id,
    head_sha: row.head_sha,
    branch: row.branch,
    dirty: sqlToBoolean(row.dirty),
    captured_at: capturedAt
  };
}
function reportFromRow(row) {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    task_id: row.task_id,
    from_session_id: row.from_session_id,
    from_actor: row.from_actor,
    to_session_id: row.to_session_id,
    kind: row.kind,
    body: row.body,
    evidence_refs: parseStringArray(row.evidence_refs_json),
    confidence: row.confidence,
    confidence_basis: row.confidence_basis,
    limits: row.limits,
    relation: row.relation,
    target_report_id: row.target_report_id,
    authority_scope: row.authority_scope,
    authority_basis: row.authority_basis,
    created_at: row.created_at,
    event_sequence: row.event_sequence
  };
}
function reviewFromRow(row) {
  return { ...row };
}
function proposalTermsFromRow(row) {
  if (!isConsentRule(row.rule)) {
    throw new CollabError("proposal_rule_unsupported", "This proposal was opened under a consent rule this package does not implement", { proposal_report_id: row.report_id, rule: row.rule });
  }
  return {
    report_id: row.report_id,
    workspace_id: row.workspace_id,
    rule: row.rule,
    criteria: row.criteria,
    extent: row.extent,
    known_conflicts: row.known_conflicts,
    origin: row.origin,
    topic: row.topic,
    closes_at: row.closes_at,
    voices: JSON.parse(row.voices_json),
    author_voice_id: row.author_voice_id,
    proposal_sha256: row.proposal_sha256,
    opened_event_id: row.opened_event_id,
    created_at: row.created_at
  };
}
function proposalPersonActFromRow(row) {
  const { ai_snapshot_json, proof_json, ...rest } = row;
  return {
    ...rest,
    ai_snapshot: JSON.parse(ai_snapshot_json),
    proof: proof_json ? JSON.parse(proof_json) : null
  };
}
function proposalSetAsideFromRow(row) {
  const record = JSON.parse(row.set_aside_json);
  return {
    ...record,
    id: row.id,
    workspace_id: row.workspace_id,
    proposal_report_id: row.proposal_report_id,
    challenge_report_id: row.challenge_report_id,
    created_at: row.created_at,
    event_sequence: row.event_sequence
  };
}
var MAX_INBOX_SCAN = 500;
var MAX_INBOX_PROPOSALS = 50;
function aiSnapshotOf(status) {
  const snapshot = {
    position: status.ai.position,
    closed: status.ai.closed,
    qualifying_support_report_ids: status.ai.qualifying_support_report_ids,
    unresolved_challenge_report_ids: status.ai.unresolved_challenge_report_ids
  };
  if (status.rule === CONSENT_RULE_V2) {
    snapshot.set_aside_challenge_report_ids = (status.set_asides ?? []).map((entry) => entry.challenge_report_id).sort();
  }
  return snapshot;
}
function normalizeActReason(act, reason) {
  if (act === "agree") {
    if (reason !== undefined && reason.trim() !== "") {
      throw new CollabError("invalid_reason", "An agreement takes no reason");
    }
    return null;
  }
  return cleanText(reason ?? "", "reason", 2000);
}
var PERSON_DESK_ACTOR = "person:desk";
var PERSON_TERMINAL_ACTOR = "person:terminal";
var PERSON_PASSKEY_ACTOR = "person:passkey";
var PERSON_VOICE_ID = "person";
var PERSON_DESK_LIMITS = "Written at the person desk, which does not authenticate the person.";
function validatePersonAct(value) {
  if (value !== "agree" && value !== "reject") {
    throw new CollabError("invalid_act", "act must be agree or reject");
  }
  return value;
}
function normalizeProposalTerms(input) {
  return {
    question: cleanText(input.question, "question", MAX_REPORT_BODY),
    criteria: cleanText(input.criteria, "criteria", 4000),
    extent: cleanText(input.extent, "extent", 1000),
    known_conflicts: optionalText(input.known_conflicts, "known_conflicts", 4000),
    evidence_refs: normalizeEvidenceRefs(input.evidence_refs ?? []),
    topic: optionalText(input.topic, "topic", 200),
    consult_seconds: validateConsultSeconds(input.consult_seconds)
  };
}
function ruleRequestField(rule) {
  const value = validateConsentRule(rule ?? CONSENT_RULE);
  return value === CONSENT_RULE ? {} : { rule: value };
}
function validateProposalOrigin(value) {
  if (value !== "ai" && value !== "person_relayed") {
    throw new CollabError("invalid_origin", "origin must be ai or person_relayed");
  }
  return value;
}
function validateConsultSeconds(value) {
  const seconds = value ?? DEFAULT_PROPOSAL_CONSULT_SECONDS;
  if (!Number.isInteger(seconds) || seconds < MIN_PROPOSAL_CONSULT_SECONDS || seconds > MAX_PROPOSAL_CONSULT_SECONDS) {
    throw new CollabError("invalid_consult_seconds", `consult_seconds must be an integer between ${MIN_PROPOSAL_CONSULT_SECONDS} and ${MAX_PROPOSAL_CONSULT_SECONDS}`);
  }
  return seconds;
}
function parseCheckpoint(json) {
  return json ? JSON.parse(json) : null;
}
function checkpointDigest(checkpoint) {
  return sha2564(canonicalJson(checkpoint));
}
function checkpointStateMatches(left, right) {
  return left.worktree_id === right.worktree_id && left.head_sha === right.head_sha && left.branch === right.branch && left.algorithm === right.algorithm && left.index_sha256 === right.index_sha256 && left.state_sha256 === right.state_sha256 && left.dirty === right.dirty;
}
function requireCompleteGitCheckpoint(checkpoint) {
  if (checkpoint.source !== "server_observed" || checkpoint.algorithm !== "git-state/v1" || checkpoint.head_sha === null || checkpoint.dirty === null || typeof checkpoint.index_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(checkpoint.index_sha256) || typeof checkpoint.state_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(checkpoint.state_sha256)) {
    throw new CollabError("git_checkpoint_incomplete", "Acceptance requires a complete server-observed Git checkpoint", { worktree_id: checkpoint.worktree_id });
  }
}
function artifactRepositoryPath(uri, rootPath) {
  let value = uri;
  if (value.startsWith("file:")) {
    try {
      const url = new URL(value);
      if (url.protocol !== "file:" || url.hostname !== "" && url.hostname !== "localhost") {
        return null;
      }
      value = decodeURIComponent(url.pathname);
    } catch {
      return null;
    }
  }
  if (!value || value.includes("\x00") || value.includes("\\"))
    return null;
  let relative2;
  if (isAbsolute3(value)) {
    const absolute = posix.normalize(value);
    if (!absolute.startsWith(`${rootPath}/`))
      return null;
    relative2 = absolute.slice(rootPath.length + 1);
  } else {
    relative2 = posix.normalize(value);
  }
  if (!relative2 || relative2 === "." || relative2 === ".." || relative2.startsWith("../") || relative2.endsWith("/") || relative2 === ".git" || relative2.startsWith(".git/"))
    return null;
  return relative2;
}
function pathWithinScopes(path, scopes) {
  return scopes.some((scope) => path === scope || path.startsWith(`${scope}/`));
}
function gitCheckpointStaleError(taskId, result, observed, refusal) {
  const branch = result.branch ? `"${result.branch}"` : "(none: its HEAD was detached)";
  const remedy = `Two ways forward. (1) Host commit: exactly one commit on branch ${branch} whose only parent ` + `is the result checkpoint HEAD ${result.head_sha}, changing only paths inside the task's ` + "path_scopes, each byte-equal to the newest file artifact this task attached for that uri " + "(since its latest request_changes), with the worktree left clean; then review again. " + `(2) Re-completion: review task "${taskId}" with outcome "request_changes"; once it is ` + "claimed again, collab_task_complete captures a fresh result checkpoint for a new review. " + "Never amend, reset or rewrite a shared branch to meet (1): if other commits already sit " + "on it, use (2).";
  return new CollabError("git_checkpoint_stale", `The completion worktree changed after its result checkpoint was captured: ${refusal}. ${remedy}`, {
    result_checkpoint: result,
    observed_checkpoint: observed,
    boundary: "checkpoint_validation_is_a_local_observation_not_an_atomic_git_sqlite_lock",
    host_commit_refusal: refusal,
    remedy
  });
}
function hydrateLegacyMutationResponse(value, now) {
  if (Array.isArray(value)) {
    return value.map((item) => hydrateLegacyMutationResponse(item, now));
  }
  if (!isRecordValue(value))
    return value;
  const hydratedEntries = Object.entries(value).map(([key, item]) => [
    key,
    hydrateLegacyMutationResponse(item, now)
  ]);
  const hydrated = Object.fromEntries(hydratedEntries);
  if (typeof hydrated.id !== "string" || typeof hydrated.workspace_id !== "string" || !["open", "claimed", "blocked", "completed"].includes(typeof hydrated.status === "string" ? hydrated.status : "") || !Array.isArray(hydrated.dependencies) || !Array.isArray(hydrated.path_scopes) || !Number.isInteger(hydrated.version)) {
    return hydrated;
  }
  const expired = hydrated.status === "claimed" && typeof hydrated.lease_expires_at === "string" && now >= hydrated.lease_expires_at;
  return {
    ...hydrated,
    effective_status: typeof hydrated.effective_status === "string" ? hydrated.effective_status : expired ? "lease_expired" : hydrated.status,
    work_mode: typeof hydrated.work_mode === "string" ? hydrated.work_mode : "coordination",
    completion_policy: typeof hydrated.completion_policy === "string" ? hydrated.completion_policy : "reported",
    review_status: typeof hydrated.review_status === "string" ? hydrated.review_status : "legacy_unreviewed",
    expected_base_sha: hydrated.expected_base_sha ?? null,
    base_checkpoint: hydrated.base_checkpoint ?? null,
    base_checkpoint_digest: hydratedCheckpointDigest(hydrated.base_checkpoint_digest, hydrated.base_checkpoint),
    result_checkpoint: hydrated.result_checkpoint ?? null,
    result_checkpoint_digest: hydratedCheckpointDigest(hydrated.result_checkpoint_digest, hydrated.result_checkpoint),
    completion_report_id: hydrated.completion_report_id ?? null,
    assignee_session_id: hydrated.assignee_session_id ?? null,
    assignee_liveness: hydrated.assignee_liveness ?? null,
    claim_worktree_id: hydrated.claim_worktree_id ?? null,
    reported_by: hydrated.reported_by ?? null,
    reported_by_session_id: hydrated.reported_by_session_id ?? null,
    reported_at: hydrated.reported_at ?? null,
    accepted_by: hydrated.accepted_by ?? null,
    accepted_by_session_id: hydrated.accepted_by_session_id ?? null,
    accepted_at: hydrated.accepted_at ?? null,
    review_requested_session_id: hydrated.review_requested_session_id ?? null
  };
}
function hydratedCheckpointDigest(stored, checkpoint) {
  if (typeof stored === "string")
    return stored;
  return isRecordValue(checkpoint) ? checkpointDigest(checkpoint) : null;
}
function isRecordValue(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function booleanToSql(value) {
  return value === null ? null : value ? 1 : 0;
}
function sqlToBoolean(value) {
  return value === null ? null : value !== 0;
}
function hashSessionToken(token) {
  return sha2564(`agenttool.collab/session-token/v1\x00${token}`);
}
function safeDigestEqual(left, right) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
function pragmaNumber(db, name) {
  const row = db.query(`PRAGMA ${name}`).get();
  const value = row?.[name];
  if (!Number.isInteger(value)) {
    throw new CollabError("database_pragma_unavailable", `Could not read PRAGMA ${name}`);
  }
  return value;
}
function retrySqliteBusy(operation) {
  const deadline = Date.now() + SQLITE_BUSY_RETRY_MS;
  let delay = 10;
  while (true) {
    try {
      operation();
      return;
    } catch (error) {
      const code = error.code;
      const busy = code === "SQLITE_BUSY" || error instanceof Error && /database is (?:locked|busy)/i.test(error.message);
      if (!busy || Date.now() >= deadline)
        throw error;
      const remaining = deadline - Date.now();
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(delay, remaining));
      delay = Math.min(delay * 2, 100);
    }
  }
}
function assertSafeDatabaseFile(path) {
  const stat = lstatSync4(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new CollabError("database_file_unsafe", "The collaboration database path must be a non-linked regular file owned by this user", { path });
  }
}
function quoteIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new CollabError("invalid_sql_identifier", "Invalid internal SQL identifier");
  }
  return `"${value}"`;
}
function assertDistinctLegacyWorktreeIdentities(workspaces) {
  const selectors = [
    {
      field: "worktrees.root_path",
      value: (workspace) => workspace.identity.root_path
    },
    {
      field: "worktrees.id",
      value: (workspace) => workspace.identity.checkpoint.worktree_id
    },
    {
      field: "worktrees.fingerprint",
      value: (workspace) => workspace.identity.worktree_fingerprint
    }
  ];
  const collisions = [];
  for (const selector of selectors) {
    const groups = new Map;
    for (const workspace of workspaces) {
      const value = selector.value(workspace);
      const workspaceIds2 = groups.get(value) ?? [];
      workspaceIds2.push(workspace.id);
      groups.set(value, workspaceIds2);
    }
    for (const workspaceIds2 of groups.values()) {
      if (workspaceIds2.length < 2)
        continue;
      collisions.push({
        field: selector.field,
        workspace_ids: workspaceIds2.sort()
      });
    }
  }
  if (collisions.length === 0)
    return;
  collisions.sort((left, right) => {
    const fieldOrder = left.field < right.field ? -1 : left.field > right.field ? 1 : 0;
    if (fieldOrder !== 0)
      return fieldOrder;
    const leftIds = left.workspace_ids.join("\x00");
    const rightIds = right.workspace_ids.join("\x00");
    return leftIds < rightIds ? -1 : leftIds > rightIds ? 1 : 0;
  });
  const workspaceIds = [
    ...new Set(collisions.flatMap((collision) => collision.workspace_ids))
  ].sort();
  throw new CollabError("migration_identity_collision", "Legacy workspaces resolve to the same worktree identity; migration will not merge distinct journals", {
    workspace_ids: workspaceIds,
    collisions,
    boundary: "v0_3_will_not_merge_distinct_legacy_journals_that_resolve_to_one_worktree",
    required_action: "keep_the_original_audit_database_and_use_a_compatible_v0_2_client_or_choose_a_fresh_v0_3_database"
  });
}
function safeRepositoryIdentity(rootPath) {
  try {
    return inspectRepository(rootPath);
  } catch {
    const root = resolve4(rootPath);
    const repositoryKey = `local-path:${sha2564(root)}`;
    const worktreeId2 = `wt_${sha2564(`${root}\x00path:${root}`).slice(0, 24)}`;
    return {
      requested_root_path: root,
      root_path: root,
      repository_key: repositoryKey,
      git_common_dir_hash: null,
      worktree_fingerprint: `path:${sha2564(root)}`,
      checkpoint: {
        worktree_id: worktreeId2,
        head_sha: null,
        branch: null,
        dirty: null,
        captured_at: new Date().toISOString()
      }
    };
  }
}
function sha2564(value) {
  return createHash5("sha256").update(value).digest("hex");
}
function addSeconds(iso, seconds) {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

// src/store-notes.ts
class CollabStore extends CollabStoreCore {
  constructor(path, options = {}) {
    super(path, options);
    this.sweepRevealedSeals();
  }
  personDeskProposalViews(workspaceId, proposalIds) {
    this.requireWorkspace(workspaceId);
    return this.db.transaction(() => {
      const sessions = this.noteSessionViews(workspaceId);
      const context = this.proposalReadContext(workspaceId);
      return proposalIds.map((proposalId) => {
        try {
          this.requireProposalTerms(workspaceId, validateId(proposalId, "proposal_report_id"));
          return { proposal_report_id: proposalId, view: this.noteProposalData(workspaceId, proposalId, sessions, context) };
        } catch (error) {
          if (!(error instanceof CollabError))
            throw error;
          return { proposal_report_id: proposalId, error: error.code };
        }
      });
    }).deferred();
  }
  noteSessionViews(workspaceId) {
    this.requireWorkspace(workspaceId);
    const rows = this.db.query(`
      SELECT * FROM coordination_sessions WHERE workspace_id = ?
      ORDER BY last_seen_at DESC, id
    `).all(workspaceId);
    const declared = this.db.query(`
      SELECT entity_id, type, payload_json FROM events
      WHERE workspace_id = ? AND type IN ('session.joined', 'purpose.declared')
      ORDER BY sequence
    `).all(workspaceId);
    const joined = new Map;
    const purposes = new Map;
    for (const row of declared) {
      const payload = JSON.parse(row.payload_json);
      if (row.type === "session.joined") {
        joined.set(row.entity_id, {
          seat_ref: typeof payload.seat_ref === "string" ? payload.seat_ref : null,
          model: typeof payload.model === "string" ? payload.model : null
        });
      } else if (typeof payload.purpose === "string") {
        purposes.set(row.entity_id, payload.purpose);
      }
    }
    const observedAt = this.timestamp();
    const voices = new Map;
    return rows.map((row) => ({
      id: row.id,
      workspace_id: row.workspace_id,
      worktree_id: row.worktree_id,
      actor: row.actor,
      role: row.role,
      purpose: purposes.get(row.id) ?? row.role,
      model: joined.get(row.id)?.model ?? null,
      seat_ref: joined.get(row.id)?.seat_ref ?? null,
      voice_id: this.cachedVoice(row.id, voices),
      parent_session_id: row.parent_session_id,
      status: row.status,
      joined_at: row.joined_at,
      last_seen_at: row.last_seen_at,
      liveness: sessionLiveness(row, observedAt)
    }));
  }
  consentVoiceOf(sessionId) {
    return this.consentVoice(validateId(sessionId, "session_id"));
  }
  declarePurposeForSession(input) {
    const purpose = validateNotePurpose(input.purpose);
    return this.mutateAsSession(input, input.idempotency_key, "notes.purpose.v1", { purpose }, (session) => {
      const payload = { session_id: session.id, purpose };
      assertNotePayload(payload);
      const event = this.appendEvent(session.workspace_id, "purpose.declared", session.id, session.actor, payload, session.id);
      return {
        session_id: session.id,
        purpose,
        event_id: event.id,
        sequence: event.sequence,
        declared_at: event.occurred_at
      };
    }, input.receipt_plan ? { receipt_plan: input.receipt_plan } : {});
  }
  citeEvidenceForSession(input) {
    const cite = normalizeNoteCite({ worktree_id: input.worktree_id, items: input.items });
    if (cite.items.length === 0)
      throw new CollabError("invalid_evidence", "A cite needs at least one outside evidence item");
    return this.mutateAsSession(input, input.idempotency_key, "notes.cite.v1", cite, (session) => this.appendNoteCite(session, cite), input.receipt_plan ? { receipt_plan: input.receipt_plan } : {});
  }
  appendNoteForSession(input) {
    if (!Array.isArray(input.reports) || input.reports.length < 1 || input.reports.length > 2) {
      throw new CollabError("invalid_note_reports", "A note posts one report, or a challenge and the withdrawal it replaces");
    }
    const cite = input.cite && input.cite.items.length > 0 ? normalizeNoteCite(input.cite) : null;
    const reports = input.reports.map((report, index) => normalizeNoteReport(report, index));
    if (reports.some((report) => report.cite_event) && !cite) {
      throw new CollabError("invalid_note_reports", "A report cites this note's evidence, but the note has none");
    }
    return this.mutateAsSession(input, input.idempotency_key, "notes.note.v1", { cite, reports }, (session) => {
      const cited = cite ? this.appendNoteCite(session, cite) : null;
      const posted = [];
      for (const report of reports) {
        const evidenceRefs = normalizeEvidenceRefs([
          ...report.evidence_refs,
          ...report.cite_event ? [`event:${cited.event_id}`] : [],
          ...report.cite_earlier.map((index) => `report:${posted[index].id}`)
        ]);
        const normalized = {
          task_id: report.task_id,
          to_session_id: report.to_session_id,
          kind: report.kind,
          body: report.body,
          evidence_refs: evidenceRefs,
          confidence: "unknown",
          confidence_basis: null,
          limits: null,
          relation: report.relation,
          target_report_id: report.target_report_id,
          authority_scope: null,
          authority_basis: null,
          ...report.to_person ? { to_person: true } : {}
        };
        this.validateReportInput(session, normalized);
        this.refuseProposalRewrite(normalized);
        if (report.about_proposal_id) {
          const termed = this.db.query(`SELECT workspace_id FROM proposal_terms WHERE report_id = ?`).get(report.about_proposal_id);
          if (!termed || termed.workspace_id !== session.workspace_id) {
            throw new CollabError("proposal_not_found", "about_proposal_id must name a proposal in this workspace");
          }
        }
        posted.push(this.appendReportInternal(session, {
          ...normalized,
          ...report.about_proposal_id ? { about_proposal_id: report.about_proposal_id } : {},
          note: NOTE_FORMAT
        }));
      }
      return { reports: posted, cite: cited };
    }, input.receipt_plan ? { receipt_plan: input.receipt_plan } : {});
  }
  appendNoteCite(session, cite) {
    const hasFiles = cite.items.some((item) => item.kind === "file");
    if (hasFiles && cite.worktree_id !== session.worktree_id) {
      throw new CollabError("cite_worktree_mismatch", "File evidence is cited against the citing session's own worktree");
    }
    const citeId = `cite_${randomUUID2()}`;
    const payload = {
      cite_id: citeId,
      by_session_id: session.id,
      ...hasFiles ? { worktree_id: session.worktree_id } : {},
      items: cite.items
    };
    assertNotePayload(payload);
    const event = this.appendEvent(session.workspace_id, "evidence.cited", citeId, session.actor, payload, session.id);
    return {
      cite_id: citeId,
      event_id: event.id,
      sequence: event.sequence,
      worktree_id: hasFiles ? session.worktree_id : null,
      items: cite.items
    };
  }
  noteTarget(workspaceId, reportId) {
    return this.db.transaction(() => {
      const report = this.requireReport(validateId(reportId, "report_id"));
      if (report.workspace_id !== workspaceId) {
        throw new CollabError("report_not_found", `Report '${reportId}' was not found in this workspace`);
      }
      const obsoleted = this.activeObsoletionTargets(workspaceId);
      const termed = this.db.query(`SELECT 1 FROM proposal_terms WHERE report_id = ?`).get(report.id) !== null;
      let ballot = null;
      if (this.db.query(`SELECT 1 FROM note_ballots WHERE workspace_id = ? AND ballot_id = ?`).get(workspaceId, report.id) !== null) {
        ballot = { open: this.readBallotFacts(workspaceId, report.id)?.state === "open" };
      }
      let completion = null;
      if (report.task_id) {
        const event = this.db.query(`
          SELECT payload_json FROM events
          WHERE workspace_id = ? AND sequence > ? AND entity_id = ?
            AND type IN ('task.reported_complete', 'task.completed')
          ORDER BY sequence LIMIT 1
        `).get(workspaceId, report.event_sequence, report.task_id);
        const completed = event && JSON.parse(event.payload_json).completion_report_id === report.id;
        if (completed) {
          const task = this.requireTaskRow(workspaceId, report.task_id);
          const current = task.completion_report_id === report.id;
          completion = {
            task_id: task.id,
            current,
            pending_review: current && task.status === "completed" && task.review_status === "pending"
          };
        }
      }
      const authorRow = report.from_session_id ? this.db.query(`SELECT * FROM coordination_sessions WHERE id = ?`).get(report.from_session_id) : null;
      return {
        report,
        termed,
        ballot,
        obsoleted: obsoleted.has(report.id),
        completion_of: completion,
        challenges: this.noteChallenges(workspaceId).filter((challenge) => challenge.target_report_id === report.id),
        author: authorRow ? {
          id: authorRow.id,
          actor: authorRow.actor,
          status: authorRow.status,
          liveness: sessionLiveness(authorRow, this.timestamp()),
          last_seen_at: authorRow.last_seen_at,
          voice_id: this.consentVoice(authorRow.id)
        } : null
      };
    }).deferred();
  }
  noteObsoleted(workspaceId, ids) {
    const obsoleted = this.activeObsoletionTargets(workspaceId);
    return ids.filter((id) => obsoleted.has(id));
  }
  noteReportStands(workspaceId, reportId) {
    return this.db.transaction(() => {
      const report = this.requireReport(validateId(reportId, "report_id"));
      if (report.workspace_id !== workspaceId)
        return false;
      if (this.activeObsoletionTargets(workspaceId).has(report.id))
        return false;
      return report.relation !== "challenges" || !this.hasActiveReportRelation(workspaceId, report.id, new Set(["resolves"]));
    }).deferred();
  }
  notePathConflicts(workspaceId, paths, options = {}) {
    this.requireWorkspace(workspaceId);
    return this.taskPathConflicts({
      workspace_id: workspaceId,
      id: options.except_task_id ?? "",
      path_scopes: normalizePathScopes(paths),
      work_mode: options.work_mode ?? "edit"
    });
  }
  noteCompletePrecheck(credential, input) {
    this.db.transaction(() => {
      const session = this.authenticateSession(credential);
      const row = this.requireTaskRow(session.workspace_id, validateId(input.task_id, "task_id"));
      for (const reference of normalizeEvidenceRefs(input.evidence_refs)) {
        this.requireEvidenceRef(row.workspace_id, reference);
      }
      if (input.review_requested_session_id) {
        this.requireRequestedReviewer(row, session, validateId(input.review_requested_session_id, "review_requested_session_id"));
      }
    }).deferred();
  }
  noteReviewPrecheck(credential, input) {
    this.db.transaction(() => {
      const session = this.authenticateSession(credential);
      const row = this.requireTaskRow(session.workspace_id, validateId(input.task_id, "task_id"));
      if (row.completion_policy !== "accepted" || row.review_status !== "pending") {
        throw this.taskNotPendingReviewError(row, session.id);
      }
      if (!row.reported_by_session_id || !row.completion_report_id) {
        throw new CollabError("review_state_invalid", "Task completion review metadata is incomplete");
      }
      if (row.reported_by_session_id === session.id) {
        throw new CollabError("self_review_forbidden", "A distinct session must review reported completion");
      }
      for (const reference of normalizeEvidenceRefs(input.evidence_refs)) {
        this.requireEvidenceRef(row.workspace_id, reference);
      }
      if (input.outcome !== "accept")
        return;
      if (this.hasObsoletedCompletionReport(row.workspace_id, row.completion_report_id)) {
        throw new CollabError("completion_report_obsolete", "The reported completion was withdrawn, corrected, or superseded; request changes before a new completion report", { completion_report_id: row.completion_report_id });
      }
      if (this.hasUnresolvedChallenges(row.workspace_id, row.completion_report_id)) {
        throw new CollabError("completion_challenged", "Reported completion has an unresolved challenge", { completion_report_id: row.completion_report_id });
      }
    }).deferred();
  }
  noteWorktreeRoot(worktreeId2) {
    const row = this.db.query(`SELECT root_path FROM worktrees WHERE id = ?`).get(worktreeId2);
    return row?.root_path ?? null;
  }
  latestReceiptKeyForBase(credential, base) {
    const session = this.authenticateSession(credential);
    if (!/^[A-Z2-7]{20}$/.test(base))
      throw new CollabError("invalid_receipt_base", "A derived key base is 20 base32 characters");
    const exact = new RegExp(`^n1:[A-Z2-7]{8}:\\d{6}:${base}(?::\\d{2})?$`);
    const rows = this.db.query(`
      SELECT idempotency_key FROM mutations
      WHERE workspace_id = ? AND actor = ? AND idempotency_key LIKE ?
      ORDER BY rowid DESC LIMIT 20
    `).all(session.workspace_id, `session:${session.id}`, `n1:________:______:${base}%`);
    return rows.find((row) => exact.test(row.idempotency_key))?.idempotency_key ?? null;
  }
  readReceiptByKey(credential, key) {
    const session = this.authenticateSession(credential);
    const idempotencyKey = validateIdempotencyKey(key);
    const row = this.db.query(`
      SELECT operation, response_json FROM mutations
      WHERE workspace_id = ? AND actor = ? AND idempotency_key = ?
    `).get(session.workspace_id, `session:${session.id}`, idempotencyKey);
    if (!row)
      return { found: false };
    return { found: true, operation: row.operation, value: JSON.parse(row.response_json) };
  }
  initNoteMark(credential, sequence) {
    const marked = this.db.transaction(() => {
      const session = this.authenticateSession(credential);
      const workspace = this.requireWorkspace(session.workspace_id);
      if (!Number.isInteger(sequence) || sequence < 0 || sequence > workspace.event_head_sequence) {
        throw new CollabError("invalid_note_mark", "A read mark must name a sequence in this journal");
      }
      this.db.query(`
        INSERT OR IGNORE INTO note_marks (workspace_id, session_id, shown_through_sequence, updated_at)
        VALUES (?, ?, ?, ?)
      `).run(session.workspace_id, session.id, sequence, this.timestamp());
      return this.noteMarkRow(session.workspace_id, session.id);
    }).immediate();
    this.tightenFileModes();
    return marked;
  }
  noteMark(workspaceId, sessionId) {
    return this.noteMarkRow(workspaceId, validateId(sessionId, "session_id"));
  }
  inboxForSession(input) {
    const limit = input.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > NOTE_INBOX_MAX_LIMIT) {
      throw new CollabError("invalid_limit", `limit must be an integer from 1 to ${NOTE_INBOX_MAX_LIMIT}`);
    }
    if (input.include !== "for_me" && input.include !== "all") {
      throw new CollabError("invalid_include", "include must be for_me or all");
    }
    const plan = (session, mark, record) => {
      const scan = this.scanNoteEvents(session, mark.sequence);
      const shaped = input.include === "all" ? noteLines(scan.events.filter((event) => !event.own), true) : { lines: scan.events.filter((event) => event.for_me), dropped: [] };
      const listed = shaped.lines;
      let through = scan.last_sequence;
      let more = scan.capped;
      if (listed.length > limit) {
        through = listed[limit].sequence - 1;
        more = true;
      }
      const returned = listed.slice(0, limit);
      const alsoNew = scan.events.filter((event) => !event.own && !event.for_me && event.sequence <= through).length;
      let waiting = null;
      if (record) {
        const now = this.timestamp();
        if (through > mark.sequence) {
          this.db.query(`
            UPDATE note_marks SET shown_through_sequence = ?, updated_at = ?
            WHERE workspace_id = ? AND session_id = ?
          `).run(through, now, session.workspace_id, session.id);
        }
        waiting = this.noteWaiting(session);
        this.recordNoteShown(session, [
          ...returned.filter((event) => event.for_me).map((event) => event.shown_item_id),
          ...noteWaitingShownItems(waiting)
        ], now);
      }
      return {
        sequences: returned.map((event) => event.sequence),
        through,
        more,
        also_new: alsoNew,
        not_listed: input.include === "all" ? notListed(shaped.dropped, through) : null,
        for_me_total: scan.events.filter((event) => event.for_me).length,
        for_me_total_capped: scan.capped,
        waiting
      };
    };
    let reveal = { revealed: [], pending: [] };
    const planned = input.peek ? this.db.transaction(() => {
      const session = this.authenticateSession(input);
      const mark = this.readNoteMarkState(session);
      return { mark, ...plan(session, mark, false) };
    }).deferred() : (() => {
      const housekept = this.noteHousekeeping(input, (session, mark) => ({ mark, ...plan(session, mark, true) }));
      reveal = housekept.reveal;
      return housekept.result;
    })();
    return afterHousekeeping(!input.peek, () => this.db.transaction(() => {
      const session = this.authenticateSession(input);
      const sessions = this.noteSessionViews(session.workspace_id);
      const me = sessions.find((view) => view.id === session.id);
      const workspace = this.requireWorkspace(session.workspace_id);
      const folds = this.noteBallotFolds(session);
      return {
        session: me,
        sessions,
        entries: planned.sequences.map((sequence) => this.noteEntryAt(session, sequence, folds)),
        also_new: planned.also_new,
        ...planned.not_listed ? { not_listed: planned.not_listed } : {},
        more: planned.more,
        for_me_total: planned.for_me_total,
        for_me_total_capped: planned.for_me_total_capped,
        mark: {
          before: planned.mark.sequence,
          through: planned.through,
          anchor: this.anchorAt(workspace, planned.through),
          initialised_from: planned.mark.initialised_from,
          clamped: planned.mark.clamped,
          written: !input.peek
        },
        head_sequence: workspace.event_head_sequence,
        waiting: planned.waiting ?? this.noteWaiting(session),
        reveal_pending: reveal.pending,
        observed_at: this.timestamp()
      };
    }).deferred());
  }
  inboxLookBackForSession(input) {
    const limit = input.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > NOTE_INBOX_MAX_LIMIT) {
      throw new CollabError("invalid_limit", `limit must be an integer from 1 to ${NOTE_INBOX_MAX_LIMIT}`);
    }
    if (input.include !== "for_me" && input.include !== "all") {
      throw new CollabError("invalid_include", "include must be for_me or all");
    }
    if (!Number.isSafeInteger(input.since) || input.since < 0) {
      throw new CollabError("invalid_since", "since must be a whole number, 0 or more");
    }
    return this.db.transaction(() => {
      const session = this.authenticateSession(input);
      const workspace = this.requireWorkspace(session.workspace_id);
      const mark = this.readNoteMarkState(session);
      const after = Math.min(input.since, workspace.event_head_sequence);
      const scan = this.scanNoteEvents(session, after, this.endedNamesakes(session));
      const shaped = noteLines(scan.events.filter((event) => input.include === "all" ? !event.own : event.for_me || event.for_name !== null), false);
      const listed = shaped.lines;
      let through = scan.last_sequence;
      let more = scan.capped;
      if (listed.length > limit) {
        through = listed[limit].sequence - 1;
        more = true;
      }
      const returned = listed.slice(0, limit);
      const sessions = this.noteSessionViews(session.workspace_id);
      const folds = this.noteBallotFolds(session);
      return {
        session: sessions.find((view) => view.id === session.id),
        sessions,
        entries: returned.map((event) => this.noteEntryAt(session, event.sequence, folds, event.for_name)),
        also_new: scan.events.filter((event) => !event.own && !event.for_me && event.for_name === null && event.sequence <= through).length,
        not_listed: notListed(shaped.dropped, through),
        more,
        for_me_total: scan.events.filter((event) => event.for_me).length,
        for_me_total_capped: scan.capped,
        mark: {
          before: mark.sequence,
          through: mark.sequence,
          anchor: this.anchorAt(workspace, mark.sequence),
          initialised_from: null,
          clamped: false,
          written: false
        },
        head_sequence: workspace.event_head_sequence,
        waiting: this.noteWaiting(session),
        reveal_pending: [],
        observed_at: this.timestamp(),
        looked_back: { after, through }
      };
    }).deferred();
  }
  noteArrivalBehind(credential) {
    return this.db.transaction(() => {
      const session = this.authenticateSession(credential);
      const joined = this.db.query(`
        SELECT sequence FROM events WHERE workspace_id = ? AND type = 'session.joined' AND entity_id = ?
      `).get(session.workspace_id, session.id);
      const before = joined ? joined.sequence - 1 : 0;
      const bySessions = this.db.query(`
        SELECT COUNT(*) AS count FROM events
        WHERE workspace_id = ? AND sequence <= ? AND session_id IS NOT NULL AND session_id <> ?
      `).get(session.workspace_id, before, session.id).count;
      const namesakes = this.endedNamesakes(session);
      let count = 0;
      let earliest = null;
      let capped = false;
      if (namesakes.length > 0) {
        const from = this.db.query(`
          SELECT MIN(sequence) AS sequence FROM events
          WHERE workspace_id = ? AND type = 'session.joined' AND entity_id IN (${namesakes.map(() => "?").join(", ")})
        `).get(session.workspace_id, ...namesakes).sequence ?? 0;
        const rows = this.db.query(`
          SELECT protocol, workspace_id, epoch_id, sequence, id, type, entity_id, actor,
            session_id, occurred_at, payload_json, prev_hash, hash
          FROM events WHERE workspace_id = ? AND sequence > ?
            AND (session_id IS NULL OR session_id <> ?)
            AND type IN (${NOTE_ADDRESSING_EVENT_TYPES.map(() => "?").join(", ")})
          ORDER BY sequence LIMIT ?
        `).all(session.workspace_id, from, session.id, ...NOTE_ADDRESSING_EVENT_TYPES, NOTE_SCAN_MAX_EVENTS + 1);
        capped = rows.length > NOTE_SCAN_MAX_EVENTS;
        const things = new Set;
        for (const row of rows.slice(0, NOTE_SCAN_MAX_EVENTS)) {
          const event = eventFromRow(row);
          if (this.eventAddressesSession(event, session.id))
            continue;
          if (this.namesakeAddressed(event, namesakes) === null)
            continue;
          const thing = noteThingOf(event);
          if (thing !== null) {
            if (things.has(thing))
              continue;
            things.add(thing);
          }
          count += 1;
          earliest ??= event.sequence;
        }
      }
      return {
        joined_sequence: joined?.sequence ?? null,
        events_before: before,
        by_other_sessions_before: bySessions,
        for_name: { count, earliest_sequence: earliest, at_least: capped, sessions: namesakes.length }
      };
    }).deferred();
  }
  noteBallotsToWatch(credential) {
    return this.db.transaction(() => {
      const session = this.authenticateSession(credential);
      return this.noteOpenBallots(session).filter((ballot) => ballot.state === "open").filter((ballot) => ballot.viewer?.in_electorate === true || ballot.opener_session_id === session.id || (ballot.viewer?.your_casts ?? 0) > 0).map((ballot) => ({ ballot_id: ballot.ballot_id, closes_at: ballot.terms.closes_at }));
    }).deferred();
  }
  noteBallotState(workspaceId, ballotId) {
    return this.db.transaction(() => this.readBallotFacts(workspaceId, validateId(ballotId, "ballot_id"))?.state ?? null).deferred();
  }
  noteBallotClosedEntry(credential, ballotId) {
    return this.db.transaction(() => {
      const session = this.authenticateSession(credential);
      const row = this.db.query(`
        SELECT sequence FROM events WHERE workspace_id = ? AND type = 'ballot.closed' AND entity_id = ?
        ORDER BY sequence LIMIT 1
      `).get(session.workspace_id, validateId(ballotId, "ballot_id"));
      return row ? this.noteEntryAt(session, row.sequence, this.noteBallotFolds(session)) : null;
    }).deferred();
  }
  noteThreadForSession(input) {
    const id = validateId(input.id, `${input.kind}_id`);
    const { result: markState, reveal } = this.noteHousekeeping(input, (session, mark) => {
      const now = this.timestamp();
      if (input.kind === "task") {
        const task = this.requireTaskRow(session.workspace_id, id);
        if (task.completion_report_id)
          this.recordNoteShown(session, [task.completion_report_id], now);
      } else {
        const report = this.requireReport(id);
        if (report.workspace_id !== session.workspace_id) {
          throw new CollabError("report_not_found", `Report '${id}' was not found in this workspace`);
        }
        this.recordNoteShown(session, [report.id], now);
      }
      return { initialised_from: mark.initialised_from, clamped: mark.clamped };
    });
    return afterHousekeeping(true, () => this.db.transaction(() => {
      const session = this.authenticateSession(input);
      const sessions = this.noteSessionViews(session.workspace_id);
      const me = sessions.find((view) => view.id === session.id);
      const challenges = this.noteChallenges(session.workspace_id);
      if (input.kind === "task") {
        const task = this.requireTask(session.workspace_id, id);
        const reviews = this.db.query(`
          SELECT * FROM task_reviews WHERE workspace_id = ? AND task_id = ?
          ORDER BY event_sequence
        `).all(session.workspace_id, id).map(reviewFromRow);
        const reports = this.db.query(`
          SELECT * FROM reports WHERE workspace_id = ? AND task_id = ?
          ORDER BY event_sequence LIMIT ?
        `).all(session.workspace_id, id, NOTE_THREAD_MAX + 1);
        return {
          kind: "task",
          session: me,
          sessions,
          root: null,
          answers: reports.slice(0, NOTE_THREAD_MAX).map((row) => this.noteEntryAt(session, row.event_sequence)),
          truncated: reports.length > NOTE_THREAD_MAX,
          task,
          reviews,
          challenges: challenges.filter((challenge) => reports.some((row) => row.id === challenge.target_report_id)),
          termed: false,
          proposal: null,
          decision: null,
          ballot: null,
          folded: 0,
          mark: markState,
          reveal_pending: reveal.pending,
          observed_at: this.timestamp()
        };
      }
      const root = this.requireReport(id);
      const answers = new Map;
      let frontier = [root.id];
      let truncated = false;
      while (frontier.length > 0 && !truncated) {
        const next = [];
        for (const target of frontier) {
          const rows = this.db.query(`
            SELECT id, event_sequence FROM reports WHERE target_report_id = ? AND workspace_id = ?
            ORDER BY event_sequence
          `).all(target, root.workspace_id);
          for (const row of rows) {
            if (answers.has(row.id) || row.id === root.id)
              continue;
            if (answers.size >= NOTE_THREAD_MAX) {
              truncated = true;
              break;
            }
            answers.set(row.id, row.event_sequence);
            next.push(row.id);
          }
          if (truncated)
            break;
        }
        frontier = next;
      }
      const citing = this.db.query(`
        SELECT r.id, r.event_sequence FROM reports r, json_each(r.evidence_refs_json) ref
        WHERE r.workspace_id = ? AND ref.value = ?
        ORDER BY r.event_sequence
      `).all(root.workspace_id, `report:${root.id}`);
      for (const row of citing) {
        if (answers.has(row.id) || row.id === root.id)
          continue;
        if (answers.size >= NOTE_THREAD_MAX) {
          truncated = true;
          break;
        }
        answers.set(row.id, row.event_sequence);
      }
      const ids = new Set([root.id, ...answers.keys()]);
      const termed = this.db.query(`SELECT 1 FROM proposal_terms WHERE report_id = ?`).get(root.id) !== null;
      const ballotFacts = this.readBallotFacts(root.workspace_id, root.id);
      const ballot = ballotFacts ? this.ballotData(ballotFacts, session.id) : null;
      const folds = ballot ? this.noteBallotFolds(session) : new Map;
      const answerEntries = [...answers.values()].sort((left, right) => left - right).map((sequence) => this.noteEntryAt(session, sequence, folds));
      return {
        kind: "report",
        session: me,
        sessions,
        root: this.noteEntryAt(session, root.event_sequence),
        answers: answerEntries,
        truncated,
        task: null,
        reviews: [],
        challenges: challenges.filter((challenge) => ids.has(challenge.target_report_id)),
        termed,
        proposal: termed ? this.noteProposalData(root.workspace_id, root.id, sessions) : null,
        decision: !termed && root.kind === "decision" ? this.noteDecisionData(root.workspace_id, root, sessions) : null,
        ballot,
        folded: answerEntries.filter((entry) => entry.folded !== null).length,
        mark: markState,
        reveal_pending: reveal.pending,
        observed_at: this.timestamp()
      };
    }).deferred());
  }
  arrivalBrief(credential) {
    return this.db.transaction(() => {
      const session = this.authenticateSession(credential);
      const workspace = this.requireWorkspace(session.workspace_id);
      const sessions = this.noteSessionViews(session.workspace_id);
      const tasks = this.listTasks(session.workspace_id);
      const { claimable } = this.projectAvailableTasks(session.workspace_id, tasks, () => false);
      const now = Date.parse(this.timestamp());
      const proposals = this.noteProposalStatuses(session.workspace_id, this.noteProposalRows(session.workspace_id).filter((row) => !row.retired && (now < Date.parse(row.closes_at) || row.supported))).filter((status) => ["open", "challenged", "consented"].includes(status.ai.position));
      const reports = this.db.query(`SELECT COUNT(*) AS count FROM reports WHERE workspace_id = ?`).get(session.workspace_id).count;
      return {
        session: sessions.find((view) => view.id === session.id),
        workspace,
        sessions,
        tasks,
        claimable_task_ids: claimable.map((task) => task.id),
        proposals,
        challenges: this.noteChallenges(session.workspace_id).filter((challenge) => challenge.standing).reverse(),
        report_count: reports,
        waiting: this.noteWaiting(session),
        ballots: this.noteOpenBallots(session).filter((ballot) => ballot.state === "open"),
        observed_at: this.timestamp()
      };
    }).deferred();
  }
  noteProposalRows(workspaceId) {
    const rows = this.db.query(`
      SELECT t.report_id, r.from_session_id, t.closes_at, t.voices_json,
        EXISTS (SELECT 1 FROM reports x WHERE x.workspace_id = t.workspace_id AND x.target_report_id = t.report_id
          AND x.relation IN ('withdraws', 'corrects', 'supersedes')) AS retired,
        EXISTS (SELECT 1 FROM reports x WHERE x.workspace_id = t.workspace_id AND x.target_report_id = t.report_id
          AND x.relation = 'supports') AS supported,
        EXISTS (SELECT 1 FROM proposal_person_acts a WHERE a.proposal_report_id = t.report_id) AS acted
      FROM proposal_terms t JOIN reports r ON r.id = t.report_id
      WHERE t.workspace_id = ?
      ORDER BY r.event_sequence DESC
    `).all(workspaceId);
    return rows.map((row) => ({
      report_id: row.report_id,
      from_session_id: row.from_session_id,
      closes_at: row.closes_at,
      voice_ids: JSON.parse(row.voices_json).map((voice) => voice.voice_id),
      retired: row.retired === 1,
      supported: row.supported === 1,
      acted: row.acted === 1
    }));
  }
  noteProposalStatuses(workspaceId, rows) {
    const context = this.proposalReadContext(workspaceId);
    const unreadable = [];
    return rows.map((row) => this.readProposalStatus(context, row.report_id, unreadable)).filter((status) => status !== null);
  }
  recordArrivalShown(credential, itemIds) {
    if (itemIds.length === 0)
      return;
    this.db.transaction(() => {
      const session = this.authenticateSession(credential);
      this.recordNoteShown(session, itemIds, this.timestamp());
    }).immediate();
    this.tightenFileModes();
  }
  noteShownAt(workspaceId, sessionId, itemId) {
    const row = this.db.query(`
      SELECT shown_at FROM note_shown WHERE workspace_id = ? AND session_id = ? AND item_id = ?
    `).get(workspaceId, sessionId, itemId);
    return row?.shown_at ?? null;
  }
  resolveNoteRef(workspaceId, kind, value) {
    this.requireWorkspace(workspaceId);
    const text = typeof value === "string" ? value.trim() : "";
    const handle = /^(report|proposal|ballot|task)#([0-9a-fA-F]{6,32})$/.exec(text);
    const prefixed = /^(report|proposal|ballot|task):(.+)$/.exec(text);
    const named = handle?.[1] ?? prefixed?.[1];
    const compatible = !named || named === kind || kind === "report" && named !== "task" || (kind === "proposal" || kind === "ballot") && named === "report";
    if (!compatible) {
      throw new CollabError("ref_kind_mismatch", `${text} names a ${named}, not a ${kind}`, { expected: kind, value: text });
    }
    kind = kind === "report" && named ? named : kind;
    const exists = (id) => this.noteRefCandidates(workspaceId, kind, id, `${id}\x00`).length === 1;
    if (!handle) {
      const id = validateId(prefixed?.[2] ?? text, `${kind}_id`);
      if (!exists(id)) {
        throw new CollabError(`${kind}_not_found`, `No ${kind} with id ${id} in this workspace`, { value: text });
      }
      return { kind, id };
    }
    const hex = handle[2].toLowerCase();
    const table = kind === "task" ? "task" : "report";
    const lower = `${table}_${uuidPrefix(hex)}`;
    const upper = `${lower.slice(0, -1)}${String.fromCharCode(lower.charCodeAt(lower.length - 1) + 1)}`;
    const candidates = this.noteRefCandidates(workspaceId, kind, lower, upper);
    if (candidates.length === 0) {
      throw new CollabError(`${kind}_not_found`, `No ${kind} matches ${text} in this workspace`, { value: text });
    }
    if (candidates.length > 1) {
      throw new CollabError("ambiguous_handle", `${text} matches more than one ${kind}; use a longer handle or the full id`, {
        value: text,
        candidates: candidates.slice(0, 10),
        candidates_total: candidates.length
      });
    }
    return { kind, id: candidates[0] };
  }
  noteRefCandidates(workspaceId, kind, lower, upper) {
    const limit = 50;
    switch (kind) {
      case "task":
        return this.db.query(`
          SELECT id FROM tasks WHERE workspace_id = ? AND id >= ? AND id < ? ORDER BY id LIMIT ?
        `).all(workspaceId, lower, upper, limit).map((row) => row.id);
      case "proposal":
        return this.db.query(`
          SELECT r.id FROM reports r JOIN proposal_terms t ON t.report_id = r.id
          WHERE r.workspace_id = ? AND r.id >= ? AND r.id < ? ORDER BY r.id LIMIT ?
        `).all(workspaceId, lower, upper, limit).map((row) => row.id);
      case "ballot":
        return this.db.query(`
          SELECT r.id FROM reports r
          WHERE r.workspace_id = ? AND r.id >= ? AND r.id < ?
            AND EXISTS (SELECT 1 FROM events e WHERE e.workspace_id = r.workspace_id
              AND e.type = 'ballot.opened' AND e.entity_id = r.id)
          ORDER BY r.id LIMIT ?
        `).all(workspaceId, lower, upper, limit).map((row) => row.id);
      default:
        return this.db.query(`
          SELECT id FROM reports WHERE workspace_id = ? AND id >= ? AND id < ? ORDER BY id LIMIT ?
        `).all(workspaceId, lower, upper, limit).map((row) => row.id);
    }
  }
  resolveNoteSession(workspaceId, value, options = {}) {
    const text = typeof value === "string" ? value.trim() : "";
    const sessions = this.noteSessionViews(workspaceId).filter((view) => options.include_ended || view.status === "active");
    const handle = /^session#([0-9a-fA-F]{6,32})$/.exec(text);
    const prefix = handle ? `session_${uuidPrefix(handle[1].toLowerCase())}` : null;
    const matches = sessions.filter((view) => prefix ? view.id.startsWith(prefix) : view.id === text || view.actor === text);
    if (matches.length === 1)
      return matches[0];
    if (matches.length === 0) {
      throw new CollabError("session_not_found", `No ${options.include_ended ? "" : "active "}session matches ${text}`, { value: text });
    }
    throw new CollabError("ambiguous_session", `${text} names more than one session; use its id`, {
      value: text,
      candidates: matches.slice(0, 10).map((view) => ({ session: view.id, name: view.actor, last_seen_at: view.last_seen_at })),
      candidates_total: matches.length
    });
  }
  cachedVoice(sessionId, voices) {
    const cached = voices.get(sessionId);
    if (cached)
      return cached;
    const voice = this.consentVoice(sessionId);
    voices.set(sessionId, voice);
    return voice;
  }
  noteMarkRow(workspaceId, sessionId) {
    const row = this.db.query(`
      SELECT shown_through_sequence FROM note_marks WHERE workspace_id = ? AND session_id = ?
    `).get(workspaceId, sessionId);
    return row?.shown_through_sequence ?? null;
  }
  readNoteMarkState(session) {
    const head = this.requireWorkspace(session.workspace_id).event_head_sequence;
    const stored = this.noteMarkRow(session.workspace_id, session.id);
    const sequence = stored ?? session.cursor_sequence;
    return {
      sequence: Math.min(sequence, head),
      initialised_from: stored === null ? "cursor" : null,
      clamped: sequence > head,
      stored: stored !== null
    };
  }
  noteHousekeeping(credential, apply) {
    let reveal = { revealed: [], pending: [] };
    const result = this.db.transaction(() => {
      const authenticated = this.authenticateSession(credential);
      const now = this.timestamp();
      this.recordSessionLeaseLapses(authenticated, now);
      this.expireElapsedHandoffs(authenticated.workspace_id, "system:clock");
      reveal = this.revealBallotsInTransaction(authenticated.workspace_id);
      this.db.query(`UPDATE coordination_sessions SET last_seen_at = ? WHERE id = ?`).run(now, authenticated.id);
      const session = this.requireCoordinationSessionRow(authenticated.id);
      const mark = this.readNoteMarkState(session);
      if (!mark.stored || mark.clamped) {
        this.db.query(`
          INSERT INTO note_marks (workspace_id, session_id, shown_through_sequence, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (workspace_id, session_id) DO UPDATE SET
            shown_through_sequence = excluded.shown_through_sequence, updated_at = excluded.updated_at
        `).run(session.workspace_id, session.id, mark.sequence, now);
      }
      return apply(session, mark);
    }).immediate();
    this.cleanSeals(reveal.revealed);
    this.tightenFileModes();
    return { result, reveal };
  }
  recordNoteShown(session, itemIds, now) {
    for (const itemId of new Set(itemIds)) {
      if (!itemId)
        continue;
      this.db.query(`
        INSERT INTO note_shown (workspace_id, session_id, item_id, shown_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (workspace_id, session_id, item_id) DO UPDATE SET shown_at = excluded.shown_at
      `).run(session.workspace_id, session.id, itemId, now);
    }
  }
  scanNoteEvents(session, after, namesakes = []) {
    const sizes = this.db.query(`
      SELECT sequence, length(CAST(payload_json AS BLOB)) AS bytes FROM events
      WHERE workspace_id = ? AND sequence > ? ORDER BY sequence LIMIT ?
    `).all(session.workspace_id, after, NOTE_SCAN_MAX_EVENTS + 1);
    let end = after;
    let bytes = 0;
    let taken = 0;
    for (const size of sizes) {
      if (taken >= NOTE_SCAN_MAX_EVENTS || taken > 0 && bytes + size.bytes > NOTE_SCAN_MAX_BYTES)
        break;
      bytes += size.bytes;
      taken += 1;
      end = size.sequence;
    }
    const rows = this.db.query(`
      SELECT protocol, workspace_id, epoch_id, sequence, id, type, entity_id, actor,
        session_id, occurred_at, payload_json, prev_hash, hash
      FROM events WHERE workspace_id = ? AND sequence > ? AND sequence <= ? ORDER BY sequence
    `).all(session.workspace_id, after, end);
    const events = rows.map((row) => {
      const event = eventFromRow(row);
      const own = event.session_id === session.id;
      const forMe = !own && this.eventAddressesSession(event, session.id);
      return {
        sequence: event.sequence,
        type: event.type,
        own,
        for_me: forMe,
        for_name: own || forMe ? null : this.namesakeAddressed(event, namesakes),
        thing: noteThingOf(event),
        attached: event.type === "evidence.cited" || event.type === "artifact.attached",
        shown_item_id: forMe ? noteShownItem(event) : null
      };
    });
    return { events, last_sequence: end, capped: taken < sizes.length };
  }
  namesakeAddressed(event, namesakes) {
    return namesakes.find((id) => event.session_id !== id && this.eventAddressesSession(event, id)) ?? null;
  }
  endedNamesakes(session) {
    return this.db.query(`
      SELECT id FROM coordination_sessions
      WHERE workspace_id = ? AND actor = ? AND status = 'ended' AND id <> ?
      ORDER BY joined_at, id
    `).all(session.workspace_id, session.actor, session.id).map((row) => row.id);
  }
  anchorAt(workspace, sequence) {
    if (sequence === 0)
      return { epoch_id: workspace.epoch_id, sequence: 0, hash: GENESIS_HASH };
    const row = this.db.query(`SELECT epoch_id, hash FROM events WHERE workspace_id = ? AND sequence = ?`).get(workspace.id, sequence);
    if (!row)
      throw new CollabError("cursor_mismatch", "The read mark does not resolve to an event in this journal");
    return { epoch_id: row.epoch_id, sequence, hash: row.hash };
  }
  noteEntryAt(session, sequence, folds, forName = null) {
    const row = this.db.query(`
      SELECT protocol, workspace_id, epoch_id, sequence, id, type, entity_id, actor,
        session_id, occurred_at, payload_json, prev_hash, hash
      FROM events WHERE workspace_id = ? AND sequence = ?
    `).get(session.workspace_id, sequence);
    if (!row)
      throw new CollabError("event_not_found", `No event at sequence ${sequence}`);
    const event = eventFromRow(row);
    const payload = event.payload;
    const forMe = event.session_id !== session.id && this.eventAddressesSession(event, session.id);
    const namesake = !forMe && forName !== null ? forName : null;
    let report = null;
    if (event.type === "report.posted" || event.type.startsWith("proposal.")) {
      const reportRow = this.db.query(`SELECT * FROM reports WHERE id = ?`).get(event.entity_id);
      report = reportRow ? reportFromRow(reportRow) : null;
    }
    const taskId = event.type.startsWith("task.") ? event.entity_id : event.type.startsWith("handoff.") ? typeof payload.task_id === "string" ? payload.task_id : typeof payload.handoff?.task_id === "string" ? payload.handoff.task_id : null : report?.task_id ?? null;
    const taskRow = taskId ? this.readTaskRow(session.workspace_id, taskId) : null;
    const marked = event.type === "report.posted" && payload.note === NOTE_FORMAT;
    const cites = report ? this.noteAuthorCites(session.workspace_id, report) : [];
    const own = marked && report ? cites.find((cite) => cite.sequence === report.event_sequence - 1) ?? null : null;
    const ballotId = event.type.startsWith("ballot.") ? event.entity_id : event.type === "report.posted" && report && this.db.query(`SELECT 1 FROM note_ballots WHERE workspace_id = ? AND ballot_id = ?`).get(session.workspace_id, report.id) !== null ? report.id : null;
    const ballotFacts = ballotId ? this.readBallotFacts(session.workspace_id, ballotId) : null;
    const foldedBy = report && event.type === "report.posted" ? folds?.get(report.id) ?? null : null;
    return {
      event,
      for_me: forMe,
      why_you: forMe ? this.noteWhyYou(event, session.id) : namesake ? this.noteWhyYou(event, namesake) : null,
      report,
      marked,
      cited: own ? { event_id: own.event_id, by_session_id: own.by_session_id, worktree_id: own.worktree_id, items: own.items } : null,
      author_cites: cites.map(({ sequence: _sequence, ...cite }) => cite),
      termed: report !== null && this.db.query(`SELECT 1 FROM proposal_terms WHERE report_id = ?`).get(report.id) !== null,
      to_person: event.type === "report.posted" && payload.to_person === true,
      task: taskRow ? { id: taskRow.id, title: taskRow.title } : null,
      ballot: ballotFacts ? this.ballotData(ballotFacts, session.id) : null,
      folded: foldedBy ? { ballot_id: foldedBy } : null,
      for_name: namesake ? { session_id: namesake } : null,
      verdict: report && event.type === "report.posted" ? this.reviewVerdictOf(report) : null
    };
  }
  reviewVerdictOf(report) {
    if (!report.task_id || report.relation !== "supports" && report.relation !== "challenges")
      return null;
    const next = this.db.query(`
      SELECT type, json_extract(payload_json, '$.review_report_id') AS review_report_id
      FROM events WHERE workspace_id = ? AND sequence = ?
    `).get(report.workspace_id, report.event_sequence + 1);
    if (!next || next.review_report_id !== report.id)
      return null;
    if (next.type === "task.accepted")
      return "accept";
    if (next.type === "task.changes_requested")
      return "request_changes";
    return null;
  }
  noteAuthorCites(workspaceId, report) {
    if (!report.from_session_id)
      return [];
    const cites = [];
    for (const ref of report.evidence_refs) {
      if (!ref.startsWith("event:"))
        continue;
      const row = this.db.query(`
        SELECT sequence, payload_json FROM events WHERE workspace_id = ? AND id = ? AND type = 'evidence.cited'
      `).get(workspaceId, ref.slice("event:".length));
      if (!row)
        continue;
      const payload = JSON.parse(row.payload_json);
      if (payload.by_session_id !== report.from_session_id)
        continue;
      cites.push({
        event_id: ref.slice("event:".length),
        sequence: row.sequence,
        by_session_id: report.from_session_id,
        worktree_id: typeof payload.worktree_id === "string" ? payload.worktree_id : null,
        items: Array.isArray(payload.items) ? payload.items : []
      });
    }
    return cites;
  }
  noteWhyYou(event, sessionId) {
    const payload = event.payload ?? {};
    switch (event.type) {
      case "report.posted":
        if (payload.to_session_id === sessionId)
          return "addressed";
        if (typeof payload.about_proposal_id === "string")
          return "about_your_proposal";
        return "reply_to_you";
      case "handoff.offered":
        return "handoff_offered";
      case "handoff.accepted":
      case "handoff.declined":
      case "handoff.expired":
        return "answer_to_your_handoff";
      case "task.reported_complete":
        return "review_requested";
      case "task.accepted":
      case "task.changes_requested":
        return "verdict_on_your_work";
      case "task.recovered":
        return "your_lease_recovered";
      case "proposal.opened":
        return "voice_awaited";
      case "proposal.agreed":
      case "proposal.rejected":
      case "proposal.challenge_set_aside":
        return "person_act";
      case "ballot.opened":
        return "in_electorate";
      case "ballot.closed":
        return "ballot_closed";
      default:
        return "addressed";
    }
  }
  noteChallenges(workspaceId) {
    const obsoleted = this.activeObsoletionTargets(workspaceId);
    const voices = new Map;
    const setAside = new Map(this.db.query(`
      SELECT s.challenge_report_id, s.id FROM proposal_set_asides s
      JOIN proposal_terms t ON t.report_id = s.proposal_report_id AND t.rule = ?
      JOIN reports r ON r.id = s.challenge_report_id AND r.target_report_id = s.proposal_report_id
      WHERE s.workspace_id = ?
    `).all(CONSENT_RULE_V2, workspaceId).map((row) => [row.challenge_report_id, row.id]));
    const challenges = this.db.query(`
      SELECT id, from_session_id, from_actor, target_report_id, created_at FROM reports
      WHERE workspace_id = ? AND relation = 'challenges' ORDER BY event_sequence
    `).all(workspaceId);
    return challenges.map((challenge) => {
      const resolves = this.db.query(`
        SELECT id, from_session_id FROM reports
        WHERE workspace_id = ? AND target_report_id = ? AND relation = 'resolves'
      `).all(workspaceId, challenge.id).filter((answer) => !obsoleted.has(answer.id) && answer.from_session_id !== null);
      const voice = challenge.from_session_id ? this.cachedVoice(challenge.from_session_id, voices) : null;
      const lifted = voice !== null && resolves.some((answer) => this.cachedVoice(answer.from_session_id, voices) === voice);
      const withdrawn = obsoleted.has(challenge.id);
      const setAsideId = setAside.get(challenge.id);
      return {
        id: challenge.id,
        target_report_id: challenge.target_report_id,
        from_session_id: challenge.from_session_id,
        from_actor: challenge.from_actor,
        created_at: challenge.created_at,
        standing: !withdrawn && !lifted && setAsideId === undefined,
        answered_by_another_voice: !lifted && resolves.length > 0,
        ...setAsideId !== undefined ? { set_aside_id: setAsideId, ...!withdrawn && !lifted ? { set_aside_only: true } : {} } : {}
      };
    });
  }
  noteWaiting(session) {
    const workspaceId = session.workspace_id;
    const myVoice = this.consentVoice(session.id);
    const voices = new Map;
    const sameVoice = (sessionId) => sessionId !== null && this.cachedVoice(sessionId, voices) === myVoice;
    const waiting = [];
    for (const task of this.listTasks(workspaceId)) {
      if (task.effective_status === "reported_complete" && task.review_requested_session_id === session.id && task.completion_report_id) {
        waiting.push({
          what: "review",
          ref_kind: "task",
          ref_id: task.id,
          about_id: task.completion_report_id,
          by: task.reported_by ?? "unknown",
          by_session_id: task.reported_by_session_id,
          due: null,
          at: task.reported_at ?? task.updated_at,
          summary: task.title
        });
      }
    }
    const challenges = this.noteChallenges(workspaceId);
    const decided = new Set;
    const decidedOn = new Map;
    const decidedAt = (id, sequence) => decidedOn.set(id, Math.max(decidedOn.get(id) ?? 0, sequence));
    for (const row of this.db.query(`
      SELECT r.from_session_id, r.evidence_refs_json, r.event_sequence, e.payload_json FROM reports r
      JOIN events e ON e.workspace_id = r.workspace_id AND e.sequence = r.event_sequence
      WHERE r.workspace_id = ? AND r.kind = 'decision'
    `).all(workspaceId)) {
      if (!sameVoice(row.from_session_id))
        continue;
      const cited = JSON.parse(row.evidence_refs_json).filter((ref) => ref.startsWith("report:")).map((ref) => ref.slice("report:".length));
      for (const id of cited)
        decided.add(id);
      const payload = JSON.parse(row.payload_json);
      if (payload.note === NOTE_FORMAT) {
        if (typeof payload.about_proposal_id === "string")
          decidedAt(payload.about_proposal_id, row.event_sequence);
      } else {
        for (const id of cited)
          decidedAt(id, row.event_sequence);
      }
    }
    const now = Date.parse(this.timestamp());
    const statuses = this.noteProposalStatuses(workspaceId, this.noteProposalRows(workspaceId).filter((row) => !row.retired && now < Date.parse(row.closes_at) && row.voice_ids.includes(myVoice) || row.acted && (sameVoice(row.from_session_id) || decided.has(row.report_id))));
    for (const status of statuses) {
      if (status.ai.closed || !["open", "challenged"].includes(status.ai.position))
        continue;
      if (!status.ai.awaiting_voice_ids.includes(myVoice))
        continue;
      if (challenges.some((challenge) => challenge.standing && challenge.target_report_id === status.proposal.id && sameVoice(challenge.from_session_id)))
        continue;
      waiting.push({
        what: "voice",
        ref_kind: "proposal",
        ref_id: status.proposal.id,
        about_id: null,
        by: status.proposal.from_actor,
        by_session_id: status.proposal.from_session_id,
        due: status.terms.closes_at,
        at: status.proposal.created_at,
        summary: firstLine(status.proposal.body)
      });
    }
    for (const ballot of this.noteOpenBallots(session)) {
      if (!ballot.viewer?.may_vote || ballot.viewer.unit_has_cast)
        continue;
      waiting.push({
        what: "vote",
        ref_kind: "ballot",
        ref_id: ballot.ballot_id,
        about_id: null,
        by: ballot.opener_name,
        by_session_id: ballot.opener_session_id,
        due: ballot.terms.closes_at,
        at: ballot.opened_at,
        summary: firstLine(ballot.terms.question)
      });
    }
    const obsoleted = this.activeObsoletionTargets(workspaceId);
    const authorOf = new Map(this.db.query(`
      SELECT id, from_session_id FROM reports WHERE workspace_id = ? AND id IN (
        SELECT target_report_id FROM reports WHERE workspace_id = ? AND relation = 'challenges'
      )
    `).all(workspaceId, workspaceId).map((row) => [row.id, row.from_session_id]));
    for (const challenge of challenges) {
      if (!challenge.standing)
        continue;
      if (authorOf.get(challenge.target_report_id) === session.id && challenge.from_session_id !== session.id) {
        waiting.push({
          what: "challenge",
          ref_kind: "report",
          ref_id: challenge.id,
          about_id: challenge.target_report_id,
          by: challenge.from_actor,
          by_session_id: challenge.from_session_id,
          due: null,
          at: challenge.created_at,
          summary: challenge.answered_by_another_voice ? "A standing challenge on your report; another voice answered it, which does not lift it." : "A standing challenge on your report."
        });
      }
      if (challenge.from_session_id === session.id) {
        const answers = this.db.query(`
          SELECT DISTINCT r.id, r.from_actor, r.from_session_id, r.created_at, r.event_sequence FROM reports r
          LEFT JOIN json_each(r.evidence_refs_json) ref
          WHERE r.workspace_id = ? AND r.from_session_id IS NOT NULL AND r.from_session_id <> ?
            AND ((r.target_report_id = ? AND r.relation <> 'supports') OR ref.value = ?)
          ORDER BY r.event_sequence
        `).all(workspaceId, session.id, challenge.id, `report:${challenge.id}`);
        for (const answer of answers) {
          if (obsoleted.has(answer.id) || sameVoice(answer.from_session_id))
            continue;
          waiting.push({
            what: "answer",
            ref_kind: "report",
            ref_id: answer.id,
            about_id: challenge.id,
            by: answer.from_actor,
            by_session_id: answer.from_session_id,
            due: null,
            at: answer.created_at,
            summary: "An answer to your standing challenge; only you can lift it."
          });
        }
      }
    }
    for (const status of statuses) {
      const mine = sameVoice(status.proposal.from_session_id);
      if (!mine && !decided.has(status.proposal.id))
        continue;
      const latest = status.person.acts.at(-1);
      if (!latest)
        continue;
      const retired = status.ai.position === "withdrawn" || status.ai.position === "superseded";
      const agreedBefore = status.person.acts.slice(0, -1).some((act) => act.act === "agree");
      let what = null;
      if (latest.act === "reject" && agreedBefore)
        what = "stop";
      else if (latest.act === "reject" && mine && !retired)
        what = "rejected";
      else if (latest.act === "agree" && mine && status.may_proceed && (decidedOn.get(status.proposal.id) ?? 0) < latest.event_sequence) {
        what = "record_decision";
      }
      if (!what)
        continue;
      waiting.push({
        what,
        ref_kind: "proposal",
        ref_id: status.proposal.id,
        about_id: latest.id,
        by: latest.basis,
        by_session_id: latest.relayed_by_session_id,
        due: what === "stop" ? "now" : null,
        at: latest.created_at,
        summary: firstLine(status.proposal.body)
      });
    }
    return [...waiting.filter((entry) => entry.what === "stop"), ...waiting.filter((entry) => entry.what !== "stop")];
  }
  journalRealpath() {
    if (!this.filesystemPath)
      return null;
    try {
      return realpathSync2(this.filesystemPath);
    } catch {
      return this.filesystemPath;
    }
  }
  ballotSealPath(ballotId, castId) {
    return sealPath(this.requireSealJournal(), ballotId, castId);
  }
  requireSealJournal() {
    const realpath = this.journalRealpath();
    if (!realpath) {
      throw new CollabError("ballots_need_a_file_journal", "A sealed ballot keeps its seals beside the journal file; this store has none", {
        remedy: { say: "Open collab on a journal file, not an in-memory store, to poll." }
      });
    }
    return realpath;
  }
  openBallotForSession(input) {
    this.requireSealJournal();
    const { render, receipt_plan: plan, ...rest } = input;
    const poll = definedPollInput(rest.poll);
    return this.mutateAsSession(rest, rest.idempotency_key, "notes.poll.v1", { poll }, (session) => {
      const now = this.timestamp();
      const views = this.noteSessionViews(session.workspace_id);
      const voters = normalizeBallotVoters(poll.voters);
      const marked = new Set(this.db.query(`SELECT session_id FROM note_marks WHERE workspace_id = ?`).all(session.workspace_id).map((row) => row.session_id));
      let chosen;
      if (voters) {
        chosen = [];
        for (const voter of voters) {
          let view;
          try {
            view = this.resolveNoteSession(session.workspace_id, voter);
          } catch (error) {
            if (!(error instanceof CollabError))
              throw error;
            throw new CollabError(error.code, `voters: ${error.message}`, {
              ...error.details,
              field: "voters",
              remedy: { say: "Name each voter by an active session's id, session# handle or name; collab_arrive lists who is here." }
            });
          }
          if (!chosen.some((other) => other.id === view.id))
            chosen.push(view);
        }
      } else {
        const recent = Date.parse(now) - BALLOT_RECENT_MS;
        chosen = views.filter((view) => view.status === "active" && (view.id === session.id || Date.parse(view.last_seen_at) >= recent && marked.has(view.id)));
      }
      const sessions = chosen.map((view) => ({
        session_id: view.id,
        voice_id: view.voice_id,
        seat_ref: view.seat_ref,
        name: view.actor,
        model: view.model,
        last_seen_at: view.last_seen_at
      }));
      const electorate = buildElectorate(sessions);
      const { terms, advice } = validatePollTerms(poll, { now, units: electorate.units, sessions });
      const listedVoices = new Set(electorate.units.flatMap((unit) => unit.voice_ids));
      const leftOutAll = views.filter((view) => view.status === "active" && view.liveness === "live" && !listedVoices.has(view.voice_id)).map((view) => ({
        session_id: view.id,
        name: view.actor,
        last_seen_minutes: Math.max(0, Math.floor((Date.parse(now) - Date.parse(view.last_seen_at)) / 60000))
      }));
      const leftOut = leftOutAll.slice(0, BALLOT_LEFT_OUT_MAX);
      const body = render(terms);
      const normalized = {
        task_id: null,
        to_session_id: null,
        kind: "observation",
        body,
        evidence_refs: [],
        confidence: "unknown",
        confidence_basis: null,
        limits: null,
        relation: "informs",
        target_report_id: null,
        authority_scope: null,
        authority_basis: null
      };
      this.validateReportInput(session, normalized);
      const report = this.appendReportInternal(session, { ...normalized, note: NOTE_FORMAT });
      const payload = {
        ballot_id: report.id,
        question: terms.question,
        options: terms.options,
        ...terms.criteria !== undefined ? { criteria: terms.criteria } : {},
        method: terms.method,
        ...terms.pick !== undefined ? { pick: terms.pick } : {},
        quorum: terms.quorum,
        closes_at: terms.closes_at,
        close_when_all_cast: terms.close_when_all_cast,
        electorate: electorate.units,
        electorate_sha256: electorate.electorate_sha256,
        left_out: leftOut,
        ...leftOutAll.length > leftOut.length ? { left_out_total: leftOutAll.length } : {},
        chosen_by: voters ? "opener" : "default",
        opener_session_id: session.id
      };
      assertNotePayload(payload);
      const event = this.appendEvent(session.workspace_id, "ballot.opened", report.id, session.actor, payload, session.id);
      this.db.query(`
        INSERT OR REPLACE INTO note_ballots (workspace_id, ballot_id, closes_at, state) VALUES (?, ?, ?, 'open')
      `).run(session.workspace_id, report.id, terms.closes_at);
      return {
        ballot_id: report.id,
        report,
        event_id: event.id,
        sequence: event.sequence,
        terms,
        electorate: electorate.units,
        electorate_sha256: electorate.electorate_sha256,
        left_out: leftOut,
        left_out_total: leftOutAll.length,
        chosen_by: voters ? "opener" : "default",
        advice
      };
    }, plan ? { receipt_plan: plan } : {});
  }
  castBallotForSession(input) {
    const ballotId = validateId(input.ballot_id, "ballot_id");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input.cast_id)) {
      throw new CollabError("invalid_cast_id", "A cast id is a random uuid");
    }
    if (!/^[0-9a-f]{64}$/.test(input.commitment))
      throw new CollabError("invalid_commitment", "A commitment is a sha256 in hex");
    const request = { ballot_id: ballotId, cast_id: input.cast_id, unit_id: input.unit_id, commitment: input.commitment };
    return this.mutateAsSession(input, `b1:${input.cast_id}`, "notes.vote.v1", request, (session) => {
      const facts = this.readBallotFacts(session.workspace_id, ballotId);
      if (!facts)
        throw new CollabError("ballot_not_found", `No ballot with id ${ballotId} in this workspace`);
      if (facts.state === "revealed" || facts.state === "closed") {
        throw new CollabError("ballot_closed", `The ballot closed at ${facts.closed_by === "all_cast" ? "its last unit's cast" : facts.terms.closes_at}; no cast is taken after the close`, {
          closes_at: facts.terms.closes_at,
          closed_by: facts.closed_by
        });
      }
      if (facts.state === "withdrawn") {
        throw new CollabError("ballot_withdrawn", "The opener withdrew this ballot; no cast is taken after a withdrawal", {
          withdrawn_by_report: facts.withdrawn.report_id
        });
      }
      const voice = this.consentVoice(session.id);
      const caster = classifyCaster(facts.units, { voice_id: voice, seat_ref: this.sessionSeatRef(session.id) });
      if (caster.unit_id !== input.unit_id) {
        throw new CollabError("ballot_unit_changed", "The unit this cast was sealed for is not this session's unit in this ballot");
      }
      const mine = facts.casts.filter((cast) => cast.session_id === session.id);
      if (input.after_cast_id !== undefined && (mine.at(-1)?.cast_id ?? null) !== input.after_cast_id) {
        throw new CollabError("changed_under_you", "This session cast in this ballot after the call read it, so this cast was not recorded");
      }
      const castSeq = nextCastSeq(mine.length);
      const voices = new Map;
      const unitMateCast = facts.casts.some((cast) => cast.unit_id === caster.unit_id && this.cachedVoice(cast.session_id, voices) !== voice);
      const payload = {
        ballot_id: ballotId,
        cast_id: input.cast_id,
        unit_id: caster.unit_id,
        session_id: session.id,
        commitment: input.commitment,
        cast_seq: castSeq
      };
      assertNotePayload(payload);
      const event = this.appendEvent(session.workspace_id, "ballot.cast", ballotId, session.actor, payload, session.id);
      const castUnits = new Set([...facts.cast_unit_ids, ...caster.counts_as === "counted" ? [caster.unit_id] : []]);
      return {
        ballot_id: ballotId,
        cast_id: input.cast_id,
        cast_seq: castSeq,
        commitment: input.commitment,
        unit_id: caster.unit_id,
        counts_as: caster.counts_as,
        ...caster.counts_as === "late" && caster.same_handle_as ? { same_handle_as: caster.same_handle_as } : {},
        closes_at: facts.terms.closes_at,
        event_id: event.id,
        sequence: event.sequence,
        cast_at: event.occurred_at,
        unit_mate_cast: unitMateCast,
        closes_now: facts.terms.close_when_all_cast && facts.units.every((unit) => castUnits.has(unit.unit_id))
      };
    });
  }
  revealDueBallots(workspaceId) {
    try {
      if (!this.hasDueBallot(workspaceId))
        return { revealed: [], pending: [] };
      const outcome = this.db.transaction(() => this.revealBallotsInTransaction(workspaceId)).immediate();
      this.cleanSeals(outcome.revealed);
      this.tightenFileModes();
      return outcome;
    } catch (error) {
      return { revealed: [], pending: [{ ballot_id: null, code: error instanceof CollabError ? error.code : "reveal_failed" }] };
    }
  }
  noteBallotView(workspaceId, ballotId, viewerSessionId) {
    return this.db.transaction(() => {
      const facts = this.readBallotFacts(workspaceId, validateId(ballotId, "ballot_id"));
      if (!facts)
        throw new CollabError("ballot_not_found", `No ballot with id ${ballotId} in this workspace`);
      return this.ballotData(facts, viewerSessionId ?? null);
    }).deferred();
  }
  ballotResult(workspaceId, ballotId) {
    return this.noteBallotView(workspaceId, ballotId).result;
  }
  ballotUnitOf(workspaceId, ballotId, sessionId) {
    return this.noteBallotView(workspaceId, ballotId, validateId(sessionId, "session_id")).viewer;
  }
  latestBallotCastForSession(workspaceId, ballotId, sessionId) {
    const facts = this.readBallotFacts(workspaceId, validateId(ballotId, "ballot_id"));
    if (!facts)
      return null;
    return facts.casts.filter((cast) => cast.session_id === sessionId).at(-1) ?? null;
  }
  hasDueBallot(workspaceId) {
    const open = this.db.query(`SELECT ballot_id FROM note_ballots WHERE workspace_id = ? AND state = 'open'`).all(workspaceId);
    return open.some((row) => {
      try {
        const facts = this.readBallotFacts(workspaceId, row.ballot_id);
        return facts === null || facts.state === "closed" || facts.state === "revealed";
      } catch {
        return true;
      }
    });
  }
  revealBallotsInTransaction(workspaceId) {
    const outcome = { revealed: [], pending: [] };
    let open;
    try {
      open = this.db.query(`SELECT ballot_id FROM note_ballots WHERE workspace_id = ? AND state = 'open' ORDER BY closes_at, ballot_id`).all(workspaceId);
    } catch (error) {
      outcome.pending.push({ ballot_id: null, code: error instanceof CollabError ? error.code : "reveal_failed" });
      return outcome;
    }
    for (const { ballot_id: ballotId } of open) {
      try {
        this.db.transaction(() => {
          const facts = this.readBallotFacts(workspaceId, ballotId);
          if (!facts || facts.state === "revealed") {
            this.db.query(`UPDATE note_ballots SET state = 'closed' WHERE workspace_id = ? AND ballot_id = ?`).run(workspaceId, ballotId);
            return;
          }
          if (facts.state !== "closed")
            return;
          this.revealBallot(facts);
          outcome.revealed.push(ballotId);
        })();
      } catch (error) {
        outcome.pending.push({ ballot_id: ballotId, code: error instanceof CollabError ? error.code : "reveal_failed" });
      }
    }
    return outcome;
  }
  revealBallot(facts) {
    const realpath = this.journalRealpath();
    const casts = facts.casts.map((cast) => {
      let seal = { state: "seal_missing" };
      if (realpath) {
        const read = readSealFile(sealPath(realpath, facts.ballot_id, cast.cast_id));
        seal = read.state === "missing" ? { state: "seal_missing" } : read.state === "unreadable" ? { state: "seal_unreadable" } : openSeal(read.value, cast, { workspace_id: facts.workspace_id, ballot_id: facts.ballot_id, journal_realpath: realpath });
      }
      return {
        cast_id: cast.cast_id,
        unit_id: cast.unit_id,
        session_id: cast.session_id,
        commitment: cast.commitment,
        cast_seq: cast.cast_seq,
        voice_id: this.consentVoice(cast.session_id),
        seal
      };
    });
    const entries = resolveCasts(facts.units, casts, { ballot_id: facts.ballot_id });
    this.revealFailpoint?.("revealing", facts.ballot_id);
    for (const entry of entries) {
      const payload = entry;
      assertNotePayload(payload);
      this.appendEvent(facts.workspace_id, "ballot.revealed", facts.ballot_id, "system:clock", payload, null);
    }
    const closed = {
      ballot_id: facts.ballot_id,
      entry_count: entries.length,
      entries_sha256: revealedEntriesSha256(entries),
      closed_at: this.timestamp()
    };
    this.appendEvent(facts.workspace_id, "ballot.closed", facts.ballot_id, "system:clock", closed, null);
    this.db.query(`UPDATE note_ballots SET state = 'closed' WHERE workspace_id = ? AND ballot_id = ?`).run(facts.workspace_id, facts.ballot_id);
    this.revealFailpoint?.("appended", facts.ballot_id);
  }
  cleanSeals(ballotIds) {
    const realpath = this.journalRealpath();
    if (!realpath)
      return;
    for (const ballotId of ballotIds) {
      try {
        const paths = [
          ...listSealFiles(realpath, ballotId).map((castId) => sealPath(realpath, ballotId, castId)),
          ...listSealTemporaries(realpath, ballotId)
        ];
        for (const path of paths) {
          const read = readSealFile(path);
          const owner = read.state === "read" && read.value !== null && typeof read.value === "object" ? read.value.journal_realpath : undefined;
          if (read.state !== "read" || owner === realpath || typeof owner !== "string")
            removeSealFile(path);
        }
        removeEmptySealDirectory(realpath, ballotId);
      } catch {}
    }
  }
  sweepRevealedSeals() {
    try {
      const realpath = this.journalRealpath();
      if (!realpath)
        return;
      const revealed = listSealBallots(realpath).filter((ballotId) => this.db.query(`
        SELECT 1 FROM note_ballots b WHERE b.ballot_id = ? AND b.state = 'closed' AND EXISTS (
          SELECT 1 FROM events e WHERE e.workspace_id = b.workspace_id AND e.type = 'ballot.closed' AND e.entity_id = b.ballot_id
        ) LIMIT 1
      `).get(ballotId) !== null);
      this.cleanSeals(revealed);
    } catch {}
  }
  readBallotFacts(workspaceId, ballotId) {
    const rows = this.db.query(`
      SELECT id, sequence, type, session_id, occurred_at, payload_json FROM events
      WHERE workspace_id = ? AND entity_id = ?
        AND type IN ('ballot.opened', 'ballot.cast', 'ballot.revealed', 'ballot.closed')
      ORDER BY sequence
    `).all(workspaceId, ballotId);
    const openedRow = rows.find((row) => row.type === "ballot.opened");
    if (!openedRow)
      return null;
    const opened = JSON.parse(openedRow.payload_json);
    const terms = {
      question: opened.question,
      options: opened.options,
      method: opened.method,
      quorum: opened.quorum,
      closes_at: opened.closes_at,
      close_when_all_cast: opened.close_when_all_cast === true
    };
    if (typeof opened.criteria === "string")
      terms.criteria = opened.criteria;
    if (Number.isInteger(opened.pick))
      terms.pick = opened.pick;
    const units = Array.isArray(opened.electorate) ? opened.electorate : [];
    const unitIds = new Set(units.map((unit) => unit.unit_id));
    const casts = [];
    const castUnits = new Set;
    let allCastSequence = null;
    let allCastAt = null;
    const revealed = [];
    let closed = null;
    for (const row of rows) {
      const payload = JSON.parse(row.payload_json);
      if (row.type === "ballot.cast") {
        casts.push({
          cast_id: payload.cast_id,
          unit_id: payload.unit_id,
          session_id: payload.session_id,
          commitment: payload.commitment,
          cast_seq: payload.cast_seq,
          event_id: row.id,
          sequence: row.sequence,
          at: row.occurred_at
        });
        if (unitIds.has(payload.unit_id))
          castUnits.add(payload.unit_id);
        if (allCastSequence === null && units.length > 0 && units.every((unit) => castUnits.has(unit.unit_id))) {
          allCastSequence = row.sequence;
          allCastAt = row.occurred_at;
        }
      } else if (row.type === "ballot.revealed") {
        revealed.push(payload);
      } else if (row.type === "ballot.closed" && closed === null) {
        closed = {
          event_id: row.id,
          sequence: row.sequence,
          at: row.occurred_at,
          entry_count: payload.entry_count,
          entries_sha256: payload.entries_sha256
        };
      }
    }
    const withdrawal = this.db.query(`
      SELECT id, event_sequence, created_at FROM reports
      WHERE workspace_id = ? AND target_report_id = ? AND relation = 'withdraws' AND from_session_id = ?
      ORDER BY event_sequence
    `).all(workspaceId, ballotId, opened.opener_session_id).find((row) => Date.parse(row.created_at) < Date.parse(terms.closes_at) && (!terms.close_when_all_cast || allCastSequence === null || row.event_sequence < allCastSequence) && (closed === null || row.event_sequence < closed.sequence)) ?? null;
    const withdrawn = withdrawal ? { report_id: withdrawal.id, sequence: withdrawal.event_sequence, at: withdrawal.created_at } : null;
    const now = this.timestamp();
    const closedAllCast = terms.close_when_all_cast && !withdrawn && allCastAt !== null && Date.parse(allCastAt) < Date.parse(terms.closes_at);
    const closedBy = closedAllCast ? "all_cast" : Date.parse(now) >= Date.parse(terms.closes_at) ? "time" : null;
    const state = closed !== null ? "revealed" : closedBy !== null ? "closed" : withdrawn ? "withdrawn" : "open";
    const leftOut = Array.isArray(opened.left_out) ? opened.left_out : [];
    return {
      ballot_id: ballotId,
      workspace_id: workspaceId,
      opener_session_id: opened.opener_session_id,
      opened_at: openedRow.occurred_at,
      opened_sequence: openedRow.sequence,
      terms,
      units,
      electorate_sha256: opened.electorate_sha256,
      chosen_by: opened.chosen_by,
      left_out: leftOut,
      left_out_total: Number.isInteger(opened.left_out_total) ? opened.left_out_total : leftOut.length,
      casts,
      cast_unit_ids: [...castUnits].sort(),
      all_cast_sequence: allCastSequence,
      withdrawn,
      closed_by: closedBy,
      state,
      revealed: closed !== null ? revealed : null,
      closed,
      observed_at: now
    };
  }
  ballotData(facts, viewerSessionId) {
    const sessions = this.noteSessionViews(facts.workspace_id);
    const byId = new Map(sessions.map((view) => [view.id, view]));
    let viewer = null;
    if (viewerSessionId) {
      const voice = this.consentVoice(viewerSessionId);
      const caster = classifyCaster(facts.units, { voice_id: voice, seat_ref: byId.get(viewerSessionId)?.seat_ref ?? null });
      const yours = facts.casts.filter((cast) => cast.session_id === viewerSessionId).length;
      const listed = caster.counts_as === "counted";
      viewer = {
        session_id: viewerSessionId,
        unit_id: caster.unit_id,
        counts_as: caster.counts_as,
        ...caster.counts_as === "late" && caster.same_handle_as ? { same_handle_as: caster.same_handle_as } : {},
        in_electorate: listed,
        unit_has_cast: listed ? facts.cast_unit_ids.includes(caster.unit_id) : yours > 0,
        your_casts: yours,
        may_vote: facts.state === "open" && listed && yours < BALLOT_MAX_CASTS
      };
    }
    let result = null;
    if (facts.revealed) {
      const delivered = this.db.query(`SELECT session_id FROM note_shown WHERE workspace_id = ? AND item_id = ?`).all(facts.workspace_id, facts.ballot_id).map((row) => row.session_id);
      result = ballotResult({
        terms: facts.terms,
        units: facts.units,
        entries: facts.revealed,
        withdrawn: facts.withdrawn !== null,
        sessions: Object.fromEntries(sessions.map((view) => [view.id, { name: view.actor, seat_ref: view.seat_ref, model: view.model }])),
        delivered_session_ids: delivered,
        left_out: facts.left_out
      });
    }
    return {
      ...facts,
      opener_name: byId.get(facts.opener_session_id)?.actor ?? facts.opener_session_id,
      turnout: { cast: facts.cast_unit_ids.length, electorate: facts.units.length },
      viewer,
      unit_basis: unitBasis(facts.units),
      sealing: BALLOT_SEALING,
      result
    };
  }
  noteOpenBallots(session) {
    const rows = this.db.query(`
      SELECT ballot_id FROM note_ballots WHERE workspace_id = ? AND state = 'open' ORDER BY closes_at, ballot_id
    `).all(session.workspace_id);
    const out = [];
    for (const row of rows) {
      const facts = this.readBallotFacts(session.workspace_id, row.ballot_id);
      if (facts && facts.state !== "revealed")
        out.push(this.ballotData(facts, session.id));
    }
    return out;
  }
  noteBallotFolds(session) {
    const folds = new Map;
    for (const ballot of this.noteOpenBallots(session)) {
      if (ballot.state !== "open" || !ballot.viewer?.in_electorate || ballot.viewer.unit_has_cast)
        continue;
      for (const id of this.ballotThreadIds(session.workspace_id, ballot.ballot_id)) {
        if (folds.has(id))
          continue;
        const author = this.db.query(`SELECT from_session_id FROM reports WHERE id = ?`).get(id);
        if (author?.from_session_id !== session.id)
          folds.set(id, ballot.ballot_id);
      }
    }
    return folds;
  }
  ballotThreadIds(workspaceId, ballotId) {
    const seen = new Set;
    let frontier = [ballotId];
    while (frontier.length > 0 && seen.size < NOTE_THREAD_MAX) {
      const next = [];
      for (const target of frontier) {
        const rows = this.db.query(`
          SELECT id FROM reports WHERE workspace_id = ? AND target_report_id = ?
          UNION
          SELECT r.id FROM reports r, json_each(r.evidence_refs_json) ref WHERE r.workspace_id = ? AND ref.value = ?
        `).all(workspaceId, target, workspaceId, `report:${target}`);
        for (const row of rows) {
          if (seen.has(row.id) || row.id === ballotId)
            continue;
          seen.add(row.id);
          next.push(row.id);
        }
      }
      frontier = next;
    }
    return [...seen];
  }
  noteNow() {
    return this.timestamp();
  }
  noteProposalPrecheck(credential, input) {
    this.db.transaction(() => {
      const session = this.authenticateSession(credential);
      for (const reference of normalizeEvidenceRefs(input.evidence_refs)) {
        this.requireEvidenceRef(session.workspace_id, reference);
      }
      if (input.task_id)
        this.requireTaskRow(session.workspace_id, input.task_id);
      if (!input.supersedes_report_id)
        return;
      const replaced = this.requireReport(validateId(input.supersedes_report_id, "supersedes_report_id"));
      if (replaced.workspace_id !== session.workspace_id) {
        throw new CollabError("report_target_mismatch", "Target report is in another workspace");
      }
      if (replaced.task_id !== input.task_id) {
        throw new CollabError("report_task_mismatch", "Related reports must use the same task scope as their target", {
          target_task_id: replaced.task_id,
          report_task_id: input.task_id
        });
      }
      if (replaced.from_session_id !== session.id) {
        throw new CollabError("report_author_mismatch", "Only the original author session may correct, withdraw, or supersede its report; other sessions should challenge it");
      }
      this.requireOpenToRevision(session.workspace_id, replaced.id);
    }).deferred();
  }
  appendDecisionForSession(input) {
    if (!NOTE_DECISION_OUTCOMES.includes(input.outcome)) {
      throw new CollabError("invalid_outcome", `outcome is ${NOTE_DECISION_OUTCOMES.join(", ")}`);
    }
    const proposalId = input.proposal_report_id ? validateId(input.proposal_report_id, "proposal_report_id") : null;
    if (proposalId && input.extent) {
      throw new CollabError("extent_from_proposal", "A decision on a proposal covers the proposal's own extent");
    }
    const cite = input.cite && input.cite.items.length > 0 ? normalizeNoteCite(input.cite) : null;
    const normalized = {
      outcome: input.outcome,
      proposal_report_id: proposalId,
      extent: optionalText(input.extent ?? undefined, "extent", 1000),
      body: cleanText(input.body, "body", MAX_REPORT_BODY),
      task_id: input.task_id ? validateId(input.task_id, "task_id") : null,
      to_session_id: input.to_session_id ? validateId(input.to_session_id, "to_session_id") : null,
      to_person: input.to_person === true,
      evidence_refs: normalizeEvidenceRefs(input.evidence_refs ?? []),
      cite
    };
    return this.mutateAsSession(input, input.idempotency_key, "notes.decide.v1", normalized, (session) => {
      const derived = this.decisionAuthority(session.workspace_id, normalized.proposal_report_id, normalized.outcome, normalized.extent);
      const { scope, basis, proposal, person_act: personAct } = derived;
      const refs = [...normalized.evidence_refs, ...derived.refs];
      const cited = normalized.cite ? this.appendNoteCite(session, normalized.cite) : null;
      if (cited)
        refs.push(`event:${cited.event_id}`);
      const report = {
        task_id: normalized.task_id,
        to_session_id: normalized.to_session_id,
        kind: "decision",
        body: normalized.body,
        evidence_refs: normalizeEvidenceRefs(refs),
        confidence: "unknown",
        confidence_basis: null,
        limits: null,
        relation: "informs",
        target_report_id: null,
        authority_scope: scope,
        authority_basis: basis,
        ...normalized.to_person ? { to_person: true } : {}
      };
      this.validateReportInput(session, report);
      const posted = this.appendReportInternal(session, {
        ...report,
        ...proposal ? { about_proposal_id: proposal.id } : {},
        note: NOTE_FORMAT
      });
      return {
        report: posted,
        cite: cited,
        outcome: normalized.outcome,
        proposal,
        person_act: personAct,
        authority_scope: scope,
        authority_basis: basis
      };
    }, input.receipt_plan ? { receipt_plan: input.receipt_plan } : {});
  }
  noteDecisionPrecheck(workspaceId, proposalId, outcome) {
    this.db.transaction(() => {
      this.decisionAuthority(workspaceId, proposalId, outcome, null);
    }).deferred();
  }
  decisionAuthority(workspaceId, proposalId, outcome, extent) {
    if (!proposalId) {
      return {
        scope: outcome === "proceed" ? extent ?? NOTE_DEFAULT_DECISION_EXTENT : NOTE_NOTHING_AUTHORISED,
        basis: `${outcome === "proceed" ? "" : `${outcome}: `}${NOTE_SELF_DECISION_BASIS}`,
        proposal: null,
        person_act: null,
        refs: []
      };
    }
    this.requireProposalTerms(workspaceId, proposalId);
    const status = this.proposalStatusInternal(workspaceId, proposalId);
    const acts = status.person.acts;
    const latest = acts.at(-1) ?? null;
    const retired = status.ai.position === "withdrawn" || status.ai.position === "superseded";
    const actView = (act) => ({
      id: act.id,
      event_id: this.eventIdAt(workspaceId, act.event_sequence),
      act: act.act,
      basis: act.basis,
      at: act.created_at,
      reason: act.reason
    });
    let scope;
    let basis;
    let personAct;
    if (outcome === "proceed") {
      if (retired) {
        throw new CollabError("proposal_retired", `This proposal was ${status.ai.position} by ${status.ai.obsoleted_by_report_id}, so nothing can proceed on it`, { position: status.ai.position, obsoleted_by_report_id: status.ai.obsoleted_by_report_id });
      }
      if (!status.may_proceed || !status.agreement) {
        const agreedBefore = [...acts].reverse().find((act) => act.act === "agree") ?? null;
        if (latest?.act === "reject" && agreedBefore) {
          throw new CollabError("agreement_withdrawn", `The person agreed (act ${agreedBefore.id}), but a later act rejects these bytes: act ${latest.id}, ` + `${latest.basis === "relayed_by_session" ? "relayed by a session" : `by ${latest.basis}`}`, { agreed_act: actView(agreedBefore), later_act: actView(latest) });
        }
        throw new CollabError("not_agreed", latest?.act === "reject" ? "The person's latest act on these bytes is a rejection, and there is no agreement to proceed on" : "The person has not agreed to these bytes", {
          position: status.ai.position,
          person: status.person.state,
          ...latest ? { latest_act: actView(latest) } : {}
        });
      }
      scope = status.terms.extent;
      basis = `person agreed by ${status.agreement.basis} to proposal_sha256 ${status.proposal_sha256} (act ${status.agreement.id})`;
      personAct = actView(status.agreement);
    } else {
      scope = NOTE_NOTHING_AUTHORISED;
      basis = `${outcome}: recorded by this session; on proposal_sha256 ${status.proposal_sha256} the agents' position is ` + `${status.ai.position} and the person's latest act is ` + `${latest ? `${latest.act} by ${latest.basis} (act ${latest.id})` : "none"}`;
      personAct = latest ? actView(latest) : null;
    }
    return {
      scope,
      basis,
      proposal: {
        id: status.proposal.id,
        proposal_sha256: status.proposal_sha256,
        position: status.ai.position,
        person: status.person.state,
        may_proceed: status.may_proceed,
        extent: status.terms.extent,
        author_session_id: status.proposal.from_session_id
      },
      person_act: personAct,
      refs: [`report:${status.proposal.id}`, ...personAct ? [`event:${personAct.event_id}`] : []]
    };
  }
  noteProposalView(workspaceId, proposalId) {
    return this.db.transaction(() => {
      this.requireProposalTerms(workspaceId, validateId(proposalId, "proposal_report_id"));
      return this.noteProposalData(workspaceId, proposalId, this.noteSessionViews(workspaceId));
    }).deferred();
  }
  noteDecisionView(workspaceId, reportId) {
    return this.db.transaction(() => {
      const report = this.requireReport(validateId(reportId, "report_id"));
      if (report.workspace_id !== workspaceId || report.kind !== "decision") {
        throw new CollabError("report_not_found", `No decision report ${reportId} in this workspace`);
      }
      return this.noteDecisionData(workspaceId, report, this.noteSessionViews(workspaceId));
    }).deferred();
  }
  noteProposalData(workspaceId, proposalId, sessions, context = this.proposalReadContext(workspaceId)) {
    const status = this.proposalStatusInternal(workspaceId, proposalId, context);
    const byId = new Map(sessions.map((view) => [view.id, view]));
    const author = status.proposal.from_session_id ? byId.get(status.proposal.from_session_id) ?? null : null;
    const challengeViews = new Map(this.noteChallenges(workspaceId).map((challenge) => [challenge.id, challenge]));
    const qualifying = new Set(status.ai.qualifying_support_report_ids);
    const unresolved = new Set(status.ai.unresolved_challenge_report_ids);
    const activeVoices = new Set(sessions.filter((view) => view.status === "active").map((view) => view.voice_id));
    const v2 = status.rule === CONSENT_RULE_V2 ? {
      set_asides: new Map((status.set_asides ?? []).map((entry) => [entry.challenge_report_id, entry])),
      live_voices: new Set(sessions.filter((view) => view.liveness === "live").map((view) => view.voice_id)),
      last_seen: (voice) => sessions.filter((view) => view.voice_id === voice).map((view) => view.last_seen_at).sort().at(-1) ?? null
    } : null;
    const stances = this.db.query(`
      SELECT * FROM reports WHERE workspace_id = ? AND target_report_id = ? AND relation IN ('supports', 'challenges')
      ORDER BY event_sequence
    `).all(workspaceId, proposalId).map(reportFromRow).map((report) => {
      const session = report.from_session_id ? byId.get(report.from_session_id) ?? null : null;
      const view = challengeViews.get(report.id);
      return this.noteStanceView(workspaceId, report, session, author, context, {
        counted: report.relation === "supports" ? qualifying.has(report.id) : unresolved.has(report.id),
        standing: report.relation === "supports" ? !context.obsoleted.has(report.id) : unresolved.has(report.id),
        answered_by_another_voice: view?.answered_by_another_voice === true,
        opened_at: status.terms.created_at,
        active_voices: activeVoices,
        v2,
        set_aside_only: view?.set_aside_only === true
      });
    });
    const supports = stances.filter((stance) => stance.relation === "supports");
    const challenges = stances.filter((stance) => stance.relation === "challenges");
    const consulted = status.terms.voices.filter((voice) => voice.voice_id !== status.terms.author_voice_id).map((voice) => {
      const members = sessions.filter((view) => view.voice_id === voice.voice_id || voice.live_session_ids.includes(view.id));
      const root = byId.get(voice.voice_id) ?? members[0] ?? null;
      const lastSeen = members.map((view) => view.last_seen_at).sort().at(-1) ?? null;
      return {
        voice_id: voice.voice_id,
        name: root?.actor ?? voice.voice_id,
        session_ids: members.map((view) => view.id),
        last_seen_at: lastSeen,
        awaited: status.ai.awaiting_voice_ids.includes(voice.voice_id),
        supported: supports.some((stance) => stance.counted && stance.voice_id === voice.voice_id),
        challenged: challenges.some((stance) => stance.standing && stance.voice_id === voice.voice_id),
        delivery_recorded: members.some((view) => this.noteShownAt(workspaceId, view.id, proposalId) !== null),
        ended: members.length > 0 && members.every((view) => view.status === "ended")
      };
    });
    let replaced = null;
    if (status.proposal.relation === "supersedes" && status.proposal.target_report_id) {
      const replacedId = status.proposal.target_report_id;
      const conflicts = status.terms.known_conflicts ?? "";
      const lineage = this.replacedLineage(workspaceId, replacedId);
      const setAsideOn = new Map;
      const setAsidesRead = new Set;
      const carried = [...challengeViews.values()].filter((challenge) => lineage.has(challenge.target_report_id)).map((challenge) => {
        const voice = challenge.from_session_id ? this.consentVoice(challenge.from_session_id, context) : null;
        let setAside;
        if (challenge.set_aside_only) {
          if (!setAsidesRead.has(challenge.target_report_id)) {
            setAsidesRead.add(challenge.target_report_id);
            for (const entry of this.proposalSetAsides(workspaceId, challenge.target_report_id)) {
              setAsideOn.set(entry.challenge_report_id, entry);
            }
          }
          setAside = setAsideOn.get(challenge.id);
        }
        return {
          challenge_id: challenge.id,
          raised_on: challenge.target_report_id,
          by_session_id: challenge.from_session_id,
          by: challenge.from_actor,
          voice_id: voice,
          carried_in_terms: conflicts.includes(`report:${challenge.id}`),
          standing_on_replaced: challenge.standing,
          re_raised_here: voice !== null && challenges.some((stance) => stance.standing && stance.voice_id === voice),
          ...setAside ? { set_aside_on_replaced: setAside } : {}
        };
      }).filter((entry) => entry.carried_in_terms || entry.standing_on_replaced || entry.set_aside_on_replaced !== undefined).map((entry) => ({ ...entry, statement: this.noteStanceStatement(workspaceId, this.requireReport(entry.challenge_id)) }));
      replaced = { proposal_id: replacedId, carried };
    }
    return {
      status,
      author,
      lone: consulted.length === 0,
      supports,
      challenges,
      consulted,
      replaced,
      observed_at: this.timestamp()
    };
  }
  replacedLineage(workspaceId, replacedId) {
    const lineage = new Set;
    let current = replacedId;
    while (current !== null && !lineage.has(current)) {
      lineage.add(current);
      const row = this.db.query(`SELECT relation, target_report_id FROM reports WHERE workspace_id = ? AND id = ?`).get(workspaceId, current);
      current = row?.relation === "supersedes" ? row.target_report_id : null;
    }
    return lineage;
  }
  noteStanceStatement(workspaceId, report) {
    const first = report.body.split(`
`)[0] ?? "";
    if (!this.reportIsMarked(workspaceId, report))
      return first;
    const parsed = parseNote(report.body);
    return parsed.act !== null ? parsed.statement : first;
  }
  noteStanceView(workspaceId, report, session, author, context, facts) {
    const marked = this.reportIsMarked(workspaceId, report);
    let statement = report.body.split(`
`)[0] ?? "";
    let grounded;
    if (marked) {
      const parsed = parseNote(report.body);
      if (parsed.act !== null)
        statement = parsed.statement;
      grounded = parsed.why.length > 0 || parsed.evidence.length > 0;
    } else {
      grounded = report.evidence_refs.length > 0 || report.confidence_basis !== null;
    }
    const flags = {};
    const byAuthor = author !== null && report.from_session_id === author.id;
    if (byAuthor)
      flags.by_author = true;
    if (!byAuthor && session && author) {
      if (author.seat_ref !== null && session.seat_ref === author.seat_ref)
        flags.same_seat_as_author = true;
      if (session.actor === author.actor)
        flags.same_name_as_author = true;
    }
    if (report.relation === "supports" && session && facts.opened_at !== null && session.joined_at > facts.opened_at) {
      flags.started_after_open = true;
    }
    if (!grounded)
      flags.ungrounded = true;
    if (report.relation === "challenges") {
      if (session?.status === "ended")
        flags.challenger_ended = true;
      if (facts.answered_by_another_voice)
        flags.answered_by_another_voice = true;
    }
    const voice = report.from_session_id ? this.consentVoice(report.from_session_id, context) : null;
    const v2 = report.relation === "challenges" && facts.v2 ? facts.v2 : null;
    const setAside = v2?.set_asides.get(report.id);
    return {
      ...v2 ? {
        voice_has_live_session: voice !== null && v2.live_voices.has(voice),
        voice_last_seen_at: voice !== null ? v2.last_seen(voice) : null,
        ...setAside ? { set_aside: setAside, ...facts.set_aside_only ? { set_aside_only: true } : {} } : {}
      } : {},
      id: report.id,
      relation: report.relation,
      from_session_id: report.from_session_id,
      from_actor: report.from_actor,
      voice_id: voice,
      voice_has_active_session: voice !== null && facts.active_voices.has(voice),
      from_session_ended: session?.status === "ended",
      created_at: report.created_at,
      statement,
      marked,
      grounded_by: marked ? "note" : "fields",
      counted: facts.counted,
      standing: facts.standing,
      flags
    };
  }
  noteDecisionData(workspaceId, report, sessions) {
    const marked = this.reportIsMarked(workspaceId, report);
    const payload = this.reportPayload(workspaceId, report);
    const termed = (id) => this.db.query(`SELECT 1 FROM proposal_terms WHERE workspace_id = ? AND report_id = ?`).get(workspaceId, id) !== null;
    let proposalId = typeof payload.about_proposal_id === "string" && termed(payload.about_proposal_id) ? payload.about_proposal_id : null;
    if (!proposalId && !marked) {
      proposalId = report.evidence_refs.filter((ref) => ref.startsWith("report:")).map((ref) => ref.slice("report:".length)).find(termed) ?? null;
    }
    let proposal = null;
    let unreadable = null;
    if (proposalId) {
      try {
        proposal = this.noteProposalData(workspaceId, proposalId, sessions);
      } catch (error) {
        if (!(error instanceof CollabError))
          throw error;
        unreadable = error.code;
      }
    }
    let restsOn = null;
    if (proposal && marked) {
      restsOn = proposal.status.person.acts.filter((act) => act.event_sequence < report.event_sequence).at(-1) ?? null;
    } else if (proposal) {
      const sequences = report.evidence_refs.filter((ref) => ref.startsWith("event:")).map((ref) => this.db.query(`SELECT sequence, type, entity_id FROM events WHERE workspace_id = ? AND id = ?`).get(workspaceId, ref.slice("event:".length))).filter((row) => row !== null && (row.type === "proposal.agreed" || row.type === "proposal.rejected") && row.entity_id === proposalId).map((row) => row.sequence);
      const cited = Math.max(-1, ...sequences);
      restsOn = proposal.status.person.acts.find((act) => act.event_sequence === cited) ?? null;
    }
    const latest = proposal?.status.person.acts.at(-1) ?? null;
    const after = restsOn && proposal ? proposal.status.person.acts.filter((act) => act.event_sequence > restsOn.event_sequence) : [];
    const laterAct = after.find((act) => act.act === "reject") ?? after.at(-1) ?? null;
    const outcome = !marked ? "unstated" : report.authority_basis?.startsWith("do_not_proceed: ") ? "do_not_proceed" : report.authority_basis?.startsWith("no_decision: ") ? "no_decision" : "proceed";
    const agreementCurrent = restsOn?.act === "agree" && (outcome === "proceed" || outcome === "unstated") ? proposal.status.may_proceed && proposal.status.agreement?.id === restsOn.id : null;
    const byId = new Map(sessions.map((view) => [view.id, view]));
    const context = this.proposalReadContext(workspaceId);
    const activeVoices = new Set(sessions.filter((view) => view.status === "active").map((view) => view.voice_id));
    const challengeViews = this.noteChallenges(workspaceId).filter((challenge) => challenge.target_report_id === report.id);
    const challenges = challengeViews.map((challenge) => this.noteStanceView(workspaceId, this.requireReport(challenge.id), challenge.from_session_id ? byId.get(challenge.from_session_id) ?? null : null, report.from_session_id ? byId.get(report.from_session_id) ?? null : null, context, {
      counted: false,
      standing: challenge.standing,
      answered_by_another_voice: challenge.answered_by_another_voice,
      opened_at: null,
      active_voices: activeVoices
    }));
    return {
      report,
      marked,
      outcome,
      authority: {
        scope: report.authority_scope,
        basis: report.authority_basis,
        derived_by_server: marked,
        on_proposal: proposalId !== null
      },
      proposal,
      proposal_unreadable: unreadable,
      rests_on: restsOn ? { ...restsOn, event_id: this.eventIdAt(workspaceId, restsOn.event_sequence) } : null,
      agreement_current: agreementCurrent,
      later_act: laterAct,
      latest_act: latest && restsOn && latest.id !== restsOn.id && latest.id !== laterAct?.id ? latest : null,
      challenges
    };
  }
  reportIsMarked(workspaceId, report) {
    return this.reportPayload(workspaceId, report).note === NOTE_FORMAT;
  }
  reportPayload(workspaceId, report) {
    const row = this.db.query(`SELECT payload_json FROM events WHERE workspace_id = ? AND sequence = ?`).get(workspaceId, report.event_sequence);
    return row ? JSON.parse(row.payload_json) : {};
  }
  eventIdAt(workspaceId, sequence) {
    const row = this.db.query(`SELECT id FROM events WHERE workspace_id = ? AND sequence = ?`).get(workspaceId, sequence);
    if (!row)
      throw new CollabError("event_not_found", `No event at sequence ${sequence}`);
    return row.id;
  }
}
var NOTE_OUTSIDE_EVIDENCE_KINDS = ["file", "commit", "test", "url", "data", "msg"];
var NOTE_CITE_LOCATOR_MAX = 1000;
function normalizeNoteCite(cite) {
  if (!Array.isArray(cite.items) || cite.items.length > 16) {
    throw new CollabError("invalid_evidence", "A note cites at most 16 evidence items");
  }
  const seen = new Set;
  const items = cite.items.map((item) => {
    if (!item || typeof item !== "object")
      throw new CollabError("invalid_evidence", "A cited item is an object");
    if (!Number.isInteger(item.n) || item.n < 1 || item.n > 16 || seen.has(item.n)) {
      throw new CollabError("invalid_evidence", "A cited item's n is its distinct 1-based Evidence position");
    }
    seen.add(item.n);
    if (!NOTE_OUTSIDE_EVIDENCE_KINDS.includes(item.kind)) {
      throw new CollabError("invalid_evidence", `A cited item's kind is one of ${NOTE_OUTSIDE_EVIDENCE_KINDS.join(", ")}`);
    }
    const locator = cleanText(typeof item.locator === "string" ? item.locator : "", "evidence", NOTE_CITE_LOCATOR_MAX);
    if (/[\u0000-\u001f\u007f]/.test(locator) || hasLoneSurrogate(locator)) {
      throw new CollabError("invalid_evidence", "A cited locator is one line of well-formed text");
    }
    if (!["server", "caller", "not_found"].includes(item.observed)) {
      throw new CollabError("invalid_evidence", "A cited item is observed by the server or the caller, or not found");
    }
    if (item.observed === "not_found" && item.kind !== "commit") {
      throw new CollabError("invalid_evidence", "Only a commit can be cited as not found");
    }
    if (item.observed === "server" && item.kind !== "file" && item.kind !== "commit") {
      throw new CollabError("invalid_evidence", "The server observes only files and commits");
    }
    if (item.sha256 !== undefined && !/^[0-9a-f]{64}$/.test(item.sha256)) {
      throw new CollabError("invalid_evidence", "A cited sha256 is 64 lower-case hex digits");
    }
    if (item.kind === "file" && item.observed === "server" && item.sha256 === undefined) {
      throw new CollabError("invalid_evidence", "A server-observed file carries the server's hash");
    }
    if (item.exit !== undefined && !Number.isSafeInteger(item.exit)) {
      throw new CollabError("invalid_evidence", "A cited exit status is an integer");
    }
    if (item.lines !== undefined && !/^\d{1,9}(?:-\d{1,9})?$/.test(item.lines)) {
      throw new CollabError("invalid_evidence", "A cited line range is a or a-b");
    }
    return {
      n: item.n,
      kind: item.kind,
      locator,
      ...item.sha256 !== undefined ? { sha256: item.sha256 } : {},
      ...item.exit !== undefined ? { exit: item.exit } : {},
      ...item.lines !== undefined ? { lines: item.lines } : {},
      observed: item.observed
    };
  });
  return {
    worktree_id: cite.worktree_id === null ? null : validateId(cite.worktree_id, "worktree_id"),
    items
  };
}
function normalizeNoteReport(report, index) {
  if (report.kind !== "observation" && report.kind !== "inference") {
    throw new CollabError("invalid_report_kind", "A note is an observation or an inference");
  }
  if (!["informs", "supports", "challenges", "resolves", "withdraws"].includes(report.relation)) {
    throw new CollabError("invalid_report_relation", "A note never corrects or supersedes");
  }
  const earlier = report.cite_earlier ?? [];
  if (!Array.isArray(earlier) || earlier.some((at) => !Number.isInteger(at) || at < 0 || at >= index)) {
    throw new CollabError("invalid_note_reports", "cite_earlier names reports this call posted before this one");
  }
  return {
    kind: report.kind,
    relation: report.relation,
    body: cleanText(report.body, "body", MAX_REPORT_BODY),
    task_id: report.task_id ? validateId(report.task_id, "task_id") : null,
    to_session_id: report.to_session_id ? validateId(report.to_session_id, "to_session_id") : null,
    to_person: report.to_person === true,
    target_report_id: report.target_report_id ? validateId(report.target_report_id, "target_report_id") : null,
    about_proposal_id: report.about_proposal_id ? validateId(report.about_proposal_id, "about_proposal_id") : null,
    evidence_refs: normalizeEvidenceRefs(report.evidence_refs ?? []),
    cite_event: report.cite_event === true,
    cite_earlier: [...earlier]
  };
}
var NOTE_DECISION_OUTCOMES = ["proceed", "do_not_proceed", "no_decision"];
var NOTE_NOTHING_AUTHORISED = "nothing is authorised";
var NOTE_DEFAULT_DECISION_EXTENT = "work this session already holds";
var NOTE_SELF_DECISION_BASIS = "recorded by this session; not a direction decision and not the person's agreement";
var NOTE_ADDRESSING_EVENT_TYPES = [
  "report.posted",
  "handoff.offered",
  "handoff.accepted",
  "handoff.declined",
  "handoff.expired",
  "task.reported_complete",
  "task.accepted",
  "task.changes_requested",
  "task.recovered",
  "proposal.opened",
  "proposal.agreed",
  "proposal.rejected",
  "proposal.challenge_set_aside",
  "ballot.opened",
  "ballot.closed"
];
var BALLOT_RECENT_MS = 30 * 60000;
var BALLOT_LEFT_OUT_MAX = 50;
var BALLOT_MAX_CASTS = MAX_CASTS_PER_SESSION;
function definedPollInput(poll) {
  return Object.fromEntries(Object.entries(poll ?? {}).filter(([, value]) => value !== undefined));
}
var NOTE_SCAN_MAX_EVENTS = 2000;
var NOTE_SCAN_MAX_BYTES = 8 * 1024 * 1024;
var NOTE_INBOX_MAX_LIMIT = 50;
var NOTE_THREAD_MAX = 200;
var NOTE_PURPOSE_MAX_CHARS = 200;
var NOTE_PAYLOAD_MAX_BYTES = 64 * 1024;
function noteThingOf(event) {
  const payload = event.payload ?? {};
  switch (event.type) {
    case "report.posted":
    case "proposal.opened":
    case "ballot.opened":
      return `report:${event.entity_id}`;
    case "task.reported_complete":
      return typeof payload.completion_report_id === "string" ? `report:${payload.completion_report_id}` : null;
    case "task.accepted":
    case "task.changes_requested":
      return typeof payload.review_report_id === "string" ? `report:${payload.review_report_id}` : null;
    default:
      return null;
  }
}
function noteLines(candidates, keepEveryForMe) {
  const dropped = [];
  const rank = (event) => event.for_me ? 2 : event.for_name !== null ? 1 : 0;
  const best = new Map;
  for (const event of candidates) {
    if (event.attached && !event.for_me || event.thing === null)
      continue;
    const held = best.get(event.thing);
    if (!held || rank(event) > rank(held))
      best.set(event.thing, event);
  }
  const lines = candidates.filter((event) => {
    if (event.attached && !event.for_me) {
      dropped.push({ sequence: event.sequence, why: "attached" });
      return false;
    }
    if (event.thing === null)
      return true;
    const keep = best.get(event.thing) === event || keepEveryForMe && event.for_me;
    if (!keep)
      dropped.push({ sequence: event.sequence, why: "duplicate" });
    return keep;
  });
  return { lines, dropped };
}
function notListed(dropped, through) {
  const within = dropped.filter((entry) => entry.sequence <= through);
  return {
    attached: within.filter((entry) => entry.why === "attached").length,
    duplicates: within.filter((entry) => entry.why === "duplicate").length
  };
}
function noteShownItem(event) {
  const payload = event.payload;
  if (event.type === "proposal.opened" || event.type === "ballot.opened")
    return event.entity_id;
  if (event.type === "task.reported_complete" && typeof payload.completion_report_id === "string") {
    return payload.completion_report_id;
  }
  return null;
}
function noteWaitingShownItems(waiting) {
  return waiting.flatMap((entry) => entry.what === "voice" || entry.what === "vote" ? [entry.ref_id] : entry.what === "review" && entry.about_id ? [entry.about_id] : []);
}
function afterHousekeeping(committed, read) {
  try {
    return read();
  } catch (error) {
    if (!committed || !(error instanceof CollabError) || error.details.after_housekeeping !== undefined)
      throw error;
    throw new CollabError(error.code, error.message, { ...error.details, after_housekeeping: true });
  }
}
function validateNotePurpose(value) {
  const purpose = cleanText(typeof value === "string" ? value : "", "purpose", NOTE_PURPOSE_MAX_CHARS);
  if (/[\u0000-\u001f\u007f]/.test(purpose)) {
    throw new CollabError("invalid_purpose", "purpose must be one line of text");
  }
  if (hasLoneSurrogate(purpose)) {
    throw new CollabError("invalid_purpose", "purpose must be well-formed Unicode text (it holds half of a character)");
  }
  return purpose;
}
function assertNotePayload(payload) {
  const visit = (value, path) => {
    if (value === undefined)
      throw new CollabError("invalid_payload", `${path} is undefined`);
    if (typeof value === "number" && !Number.isSafeInteger(value)) {
      throw new CollabError("invalid_payload", `${path} is not an integer`);
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
    } else if (value !== null && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (/^(0|[1-9]\d*)$/.test(key))
          throw new CollabError("invalid_payload", `${path} has an integer-like key`);
        visit(child, `${path}.${key}`);
      }
    }
  };
  visit(payload, "payload");
  if (Buffer.byteLength(canonicalJson(payload), "utf8") > NOTE_PAYLOAD_MAX_BYTES) {
    throw new CollabError("too_long", "The record exceeds 64 KiB", { field: "payload", max: NOTE_PAYLOAD_MAX_BYTES, unit: "bytes" });
  }
}
function uuidPrefix(hex) {
  const groups = [8, 4, 4, 4, 12];
  let out = "";
  let rest = hex;
  for (const size of groups) {
    if (!rest)
      break;
    out += out ? `-${rest.slice(0, size)}` : rest.slice(0, size);
    rest = rest.slice(size);
  }
  return out;
}
function firstLine(text) {
  const line = (text.split(`
`)[0] ?? "").replace(/\r$/, "");
  if (line.length <= 200)
    return line;
  const end = /[\uD800-\uDBFF]$/.test(line.slice(0, 199)) ? 198 : 199;
  return `${line.slice(0, end)}\u2026`;
}

// src/ceremony.ts
import { spawn } from "child_process";
import { randomBytes as randomBytes2 } from "crypto";

// src/desk-soft-spots.ts
function carriedObjectionsSentence(rule = CONSENT_RULE) {
  return `Carried objections are text in the terms the person signs. Under ${rule} they do not block this proposal. Each objector may challenge again.`;
}
var CARRIED_OBJECTIONS_SENTENCE = carriedObjectionsSentence(CONSENT_RULE);
var SET_ASIDE_SENTENCE = "A challenge the person set aside no longer blocks the position. It stays on the record and in what the person is shown; any voice, its own included, may challenge again, and a new challenge stands as usual.";
var SOFT_SPOTS_DISPLAY_ONLY = "Display only: these lines are not in the bytes the person signs or in any hash, they change no count, and the desk accepts and refuses exactly as it would without them.";
var SOFT_SPOTS_HEADING = "Soft spots the agents' views show on this proposal. Display only: not in the bytes you sign; they change no count and nothing the desk accepts or refuses.";
function softSpotsDeliveryNote(rule = CONSENT_RULE) {
  return `Under ${rule} silence from an awaited voice does not stop the position settling at the close. A delivery is recorded only when collab_arrive or collab_inbox returned the question; reads through legacy tools or host messages are not recorded.`;
}
var SOFT_SPOTS_DELIVERY_NOTE = softSpotsDeliveryNote(CONSENT_RULE);
var SOFT_SPOTS_NOT_REPORTED = "The other device's desk reported no soft spots (an older build does not compute them). None are shown here, which does not mean there are none.";
var SOFT_SPOT_LINES_PER_KIND = 10;
var EXCERPT_MAX = 160;
var MAX_REMOTE_LINES = 64;
var MAX_REMOTE_LINE = 2000;
function quoted(text) {
  return JSON.stringify(text).replace(/[\p{Cf}\p{Default_Ignorable_Code_Point}\u2028\u2029]/gu, (char) => `\\u{${char.codePointAt(0).toString(16).toUpperCase()}}`);
}
function cut(text, max) {
  if (text.length <= max)
    return text;
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 55296 && last <= 56319)
    end -= 1;
  return `${text.slice(0, end)}\u2026`;
}
function excerpt(statement) {
  return cut(statement, EXCERPT_MAX);
}
function minutesSince(at, observedAt) {
  const age = Date.parse(observedAt) - Date.parse(at);
  return Number.isFinite(age) ? Math.max(0, Math.floor(age / 60000)) : null;
}
function who(stance) {
  return { session: stance.from_session_id, name: stance.from_actor };
}
function counted(value, rule) {
  return value ? `counted by ${rule}` : `not counted by ${rule}`;
}
var FLAG_WORDS = {
  same_seat_as_author: "its session declares the author's host handle (same_seat_as_author; the handle is unverified)",
  same_name_as_author: "it has the author's name (same_name_as_author)",
  started_after_open: "its session started after the proposal opened (started_after_open)"
};
function capped(lines, kind) {
  if (lines.length <= SOFT_SPOT_LINES_PER_KIND)
    return lines;
  const rest = lines.length - SOFT_SPOT_LINES_PER_KIND;
  return [
    ...lines.slice(0, SOFT_SPOT_LINES_PER_KIND),
    `\u2026and ${rest} more ${kind}; the JSON key soft_spots of person proposals --proposal lists every one.`
  ];
}
function deskSoftSpots(data) {
  const { status } = data;
  const rule = status.rule;
  const v2 = rule === CONSENT_RULE_V2;
  const awaited = data.consulted.filter((voice) => voice.awaited && !voice.delivery_recorded).map((voice) => ({
    voice: voice.voice_id,
    name: voice.name,
    last_seen_minutes: voice.last_seen_at ? minutesSince(voice.last_seen_at, data.observed_at) : null
  }));
  const flagged = data.supports.filter((stance) => stance.standing).map((stance) => ({
    stance,
    flags: ["same_seat_as_author", "same_name_as_author", "started_after_open"].filter((flag) => stance.flags[flag] === true)
  })).filter((entry) => entry.flags.length > 0);
  const ended = data.challenges.filter((stance) => stance.standing && stance.flags.challenger_ended === true);
  const ungrounded = [...data.supports, ...data.challenges].filter((stance) => stance.standing && stance.flags.ungrounded === true);
  const carried = data.replaced?.carried ?? [];
  const setAside = v2 ? data.challenges.filter((stance) => stance.set_aside !== undefined) : [];
  const lines = [];
  const awaitedLines = awaited.map((voice) => `Awaited voice ${quoted(voice.name)} (voice ${voice.voice}) has no recorded delivery on the notes surface, ` + (voice.last_seen_minutes === null ? "and no session of it is listed here" : `last seen ${voice.last_seen_minutes} min ago`) + ": it may never have been shown this question.");
  lines.push(...capped(awaitedLines, "awaited voices"));
  if (awaited.length > 0)
    lines.push(softSpotsDeliveryNote(rule));
  lines.push(...capped(flagged.map(({ stance, flags }) => {
    const maybeAuthor = flags.includes("same_seat_as_author") || flags.includes("same_name_as_author");
    return `Support ${stance.id} by ${quoted(stance.from_actor)} (${counted(stance.counted, rule)}): ` + `${flags.map((flag) => FLAG_WORDS[flag]).join("; ")}.` + (maybeAuthor ? " It may be the author's own voice in another session." : "");
  }), "flagged supports"));
  lines.push(...capped(ended.map((stance) => `Challenge ${stance.id} by ${quoted(stance.from_actor)} still stands, but its challenger's session has ended` + (stance.voice_has_active_session ? "; another session of the same voice is active and can lift it." : ", and no session of its voice is active to lift it.") + ` While it stands the position cannot be consented.` + (v2 && stance.voice_has_live_session === false ? " Under consent/v2 the person can set it aside at the desk, with a reason, while no session of its voice is live." : "") + ` It said: ${quoted(excerpt(stance.statement))}`), "challenges whose challenger's session has ended"));
  lines.push(...capped(ungrounded.map((stance) => `${stance.relation === "supports" ? "Support" : "Challenge"} ${stance.id} by ${quoted(stance.from_actor)} ` + `(${counted(stance.counted, rule)}) gives no reason and no evidence: ` + (stance.grounded_by === "note" ? "the note has no Why and no Evidence lines." : "it has no evidence_refs and no confidence_basis (a legacy report's body is not read for reasons, so its text may still argue a case).")), "stances with no reason or evidence"));
  const setAsideThere = (entry) => entry.set_aside_on_replaced ? `the person set it aside there at ${entry.set_aside_on_replaced.created_at} (${entry.set_aside_on_replaced.basis}). ` + `Reason: ${quoted(entry.set_aside_on_replaced.reason)}` : "";
  lines.push(...capped(carried.map((entry) => (entry.carried_in_terms ? `Objection ${entry.challenge_id} by ${quoted(entry.by)}, raised on ${entry.raised_on}, is carried as text in these terms` + (entry.standing_on_replaced ? " and still stands where it was raised" : entry.set_aside_on_replaced ? ` and was set aside by the person where it was raised: ${setAsideThere(entry)}` : " and no longer stands where it was raised") : entry.set_aside_on_replaced ? `Objection ${entry.challenge_id} by ${quoted(entry.by)} was set aside by the person on ${entry.raised_on}, which this proposal replaces, ` + `but is not in these terms: ${setAsideThere(entry)}` : `Objection ${entry.challenge_id} by ${quoted(entry.by)} still stands on ${entry.raised_on}, which this proposal replaces, ` + "but is not in these terms") + (entry.re_raised_here ? "; the same voice also challenges this proposal, and that challenge is counted" : "") + `. It said: ${quoted(excerpt(entry.statement))}`), "carried objections"));
  if (carried.length > 0)
    lines.push(carriedObjectionsSentence(rule));
  lines.push(...capped(setAside.map((stance) => {
    const entry = stance.set_aside;
    return `Challenge ${stance.id} by ${quoted(stance.from_actor)} was set aside by the person at ${entry.created_at} ` + `(${entry.basis}), while no session of its voice was live` + (entry.challenger.last_seen_at ? ` (last seen ${entry.challenger.last_seen_at})` : "") + `. Reason: ${quoted(entry.reason)}. It no longer blocks the position. It said: ${quoted(excerpt(stance.statement))}`;
  }), "set-aside challenges"));
  if (setAside.length > 0)
    lines.push(SET_ASIDE_SENTENCE);
  return {
    proposal_sha256: status.proposal_sha256,
    position: status.ai.position,
    observed_at: data.observed_at,
    awaited_without_delivery: awaited,
    flagged_supports: flagged.map(({ stance, flags }) => ({
      report: stance.id,
      by: who(stance),
      voice: stance.voice_id,
      counted: stance.counted,
      flags
    })),
    ended_challengers: ended.map((stance) => ({
      report: stance.id,
      by: who(stance),
      voice: stance.voice_id,
      voice_has_active_session: stance.voice_has_active_session,
      statement: stance.statement
    })),
    ungrounded: ungrounded.map((stance) => ({
      report: stance.id,
      relation: stance.relation,
      by: who(stance),
      counted: stance.counted,
      basis: stance.grounded_by === "note" ? "no Why and no Evidence lines" : "no evidence_refs and no confidence_basis (a legacy report's body is not read for reasons)"
    })),
    replaced: data.replaced?.proposal_id ?? null,
    carried_objections: carried.map((entry) => ({
      challenge: entry.challenge_id,
      by: { session: entry.by_session_id, name: entry.by },
      voice: entry.voice_id,
      raised_on: entry.raised_on,
      carried_in_terms: entry.carried_in_terms,
      standing_on_replaced: entry.standing_on_replaced,
      re_raised_here: entry.re_raised_here,
      counted_by_consent_v1: false,
      statement: entry.statement,
      ...entry.set_aside_on_replaced ? {
        set_aside_on_replaced: {
          set_aside: entry.set_aside_on_replaced.id,
          at: entry.set_aside_on_replaced.created_at,
          basis: entry.set_aside_on_replaced.basis,
          reason: entry.set_aside_on_replaced.reason
        }
      } : {}
    })),
    ...carried.length > 0 ? { carried_note: carriedObjectionsSentence(rule) } : {},
    ...v2 ? {
      rule,
      set_asides: setAside.map((stance) => ({
        challenge: stance.id,
        by: who(stance),
        set_aside: stance.set_aside.id,
        at: stance.set_aside.created_at,
        basis: stance.set_aside.basis,
        reason: stance.set_aside.reason,
        statement: stance.statement
      }))
    } : {},
    count: awaited.length + flagged.length + ended.length + ungrounded.length + carried.length + setAside.length,
    lines,
    display_only: SOFT_SPOTS_DISPLAY_ONLY
  };
}
function softSpotsUnavailable(code) {
  return {
    unavailable: code,
    lines: [`The soft spots could not be read (${code}). None are shown, which does not mean there are none.`],
    display_only: SOFT_SPOTS_DISPLAY_ONLY
  };
}
function softSpotDisplay(entry, shown, table) {
  if (entry === undefined) {
    return {
      note: SOFT_SPOTS_HEADING,
      lines: [table === "remote" ? SOFT_SPOTS_NOT_REPORTED : softSpotsUnavailable("soft_spots_missing").lines[0]]
    };
  }
  const lines = [...entry.lines];
  const position = entry.position !== undefined && entry.position !== shown.ai.position;
  const bytes = entry.proposal_sha256 !== undefined && entry.proposal_sha256 !== shown.proposal_sha256;
  if (position || bytes) {
    lines.push(`These lines were read with the agents' position ${quoted(entry.position ?? "unknown")} and proposal_sha256 ` + `${entry.proposal_sha256 ?? "unknown"}; the summary shows ${shown.ai.position} and ${shown.proposal_sha256}. ` + "The journal changed between the two reads; read it again before acting.");
  }
  return lines.length > 0 ? { note: SOFT_SPOTS_HEADING, lines } : null;
}
function softSpotSummaryLines(display) {
  return display ? [display.note, ...display.lines.map((line) => `- ${line}`)] : [];
}
function remoteSoftSpots(receipt, proposalId) {
  const map = receipt.soft_spots;
  if (map === undefined)
    return;
  const entry = map !== null && typeof map === "object" && !Array.isArray(map) && Object.hasOwn(map, proposalId) ? map[proposalId] : undefined;
  if (entry === null || typeof entry !== "object" || Array.isArray(entry) || !Array.isArray(entry.lines) || !entry.lines.every((line) => typeof line === "string")) {
    return { lines: softSpotsUnavailable("remote_soft_spots_unreadable").lines };
  }
  const record = entry;
  const lines = record.lines.slice(0, MAX_REMOTE_LINES).map((line) => cut(line, MAX_REMOTE_LINE));
  if (record.lines.length > MAX_REMOTE_LINES) {
    lines.push(`\u2026and ${record.lines.length - MAX_REMOTE_LINES} more lines from the other device's desk, not shown here.`);
  }
  return {
    lines,
    ...typeof record.position === "string" ? { position: record.position } : {},
    ...typeof record.proposal_sha256 === "string" ? { proposal_sha256: record.proposal_sha256 } : {}
  };
}

// src/person-desk.ts
import { createHash as createHash6 } from "crypto";
import { closeSync as closeSync6, existsSync as existsSync5, openSync as openSync6, readSync as readSync3 } from "fs";
import { parseArgs } from "util";

// src/tty.ts
import { closeSync as closeSync5, constants, openSync as openSync5, readSync as readSync2, writeSync as writeSync2 } from "fs";
import { isatty } from "tty";
var DEV_TTY = "/dev/tty";
var CONFIRM_WORD = "yes";
var DEFAULT_WINDOW_MS = 5 * 60 * 1000;
var MAX_ANSWER_BYTES = 256;
var TERMINAL_UNSAFE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;
function terminalRendering(text) {
  return text.replace(TERMINAL_UNSAFE, (char) => `\\u{${char.codePointAt(0).toString(16).toUpperCase()}}`);
}
function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function openDevTty(path = DEV_TTY) {
  let fd;
  try {
    fd = openSync5(path, constants.O_RDWR | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  let terminal = false;
  try {
    terminal = isatty(fd);
  } catch {
    terminal = false;
  }
  if (!terminal) {
    closeSync5(fd);
    return null;
  }
  return {
    write(text) {
      const bytes = Buffer.from(text, "utf8");
      let offset = 0;
      while (offset < bytes.length) {
        offset += writeSync2(fd, bytes, offset, bytes.length - offset);
      }
    },
    readLine(maxBytes, deadline, now = Date.now) {
      const one = Buffer.alloc(1);
      const collected = [];
      let overflow = false;
      while (true) {
        if (deadline !== undefined && now() > deadline)
          return null;
        let read;
        try {
          read = readSync2(fd, one, 0, 1, null);
        } catch (error) {
          if (error.code !== "EAGAIN")
            throw error;
          pause(50);
          continue;
        }
        if (read === 0)
          return collected.length === 0 ? null : Buffer.from(collected).toString("utf8");
        if (one[0] === 10 || one[0] === 13)
          break;
        if (collected.length < maxBytes)
          collected.push(one[0]);
        else
          overflow = true;
      }
      return overflow ? "" : Buffer.from(collected).toString("utf8");
    },
    close() {
      closeSync5(fd);
    }
  };
}
function confirmOnTty(request, options = {}) {
  const open = options.openTty ?? (() => openDevTty());
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const port = open();
  if (port === null) {
    throw new CollabError("tty_unavailable", "This act needs a person at the controlling terminal (/dev/tty); none is available, so nothing was written");
  }
  try {
    const byteLength = Buffer.byteLength(request.bytes, "utf8");
    const rendered = terminalRendering(request.bytes);
    port.write([
      "",
      `agenttool-collab-host: person act ${terminalRendering(request.act)}`,
      ...request.summary.map((line) => `  ${terminalRendering(line)}`),
      `exact bytes (${byteLength} bytes, sha256 ${request.sha256})` + (rendered === request.bytes ? ":" : ", hidden characters shown as \\u{...}:"),
      rendered,
      `Type ${CONFIRM_WORD} to record exactly these bytes; anything else cancels: `
    ].join(`
`));
    const started = now();
    const answer = port.readLine(MAX_ANSWER_BYTES, started + windowMs, now);
    if (answer === null || now() - started > windowMs) {
      port.write(`no answer within the confirmation window; nothing was written
`);
      return false;
    }
    const confirmed = answer !== null && answer.trim() === CONFIRM_WORD;
    port.write(confirmed ? `confirmed
` : `cancelled; nothing was written
`);
    return confirmed;
  } finally {
    port.close();
  }
}

// src/person-desk.ts
var PERSON_DESK_PROTOCOL = "agenttool.collab-host/1";
var EXIT_NOT_CONFIRMED = 3;
var MAX_JSON_INPUT_BYTES = 64 * 1024;
var PERSON_DESK_USAGE = "usage: agenttool-collab-host person <verb> [--db <path>], where <verb> is one of: " + "workspaces | voices --workspace <id> | proposals --workspace <id> [--proposal <id> | --limit <n>]" + " | inbox [--workspace <id>]" + " | challenge --proposal <id> --act agree | challenge --proposal <id> --act reject --reason <text>" + " | challenge --proposal <id> --act set-aside --challenge <report id> --reason <text>" + " | consent --proposal <id> [--passkey-assertion <path>|-]" + " | reject --proposal <id> --reason <text> [--passkey-assertion <path>|-]" + " | set-aside --proposal <id> --challenge <report id> --reason <text> [--passkey-assertion <path>|-]" + " | ceremony --proposal <id> --act agree|reject|set-aside [--challenge <report id>] [--reason <text>] [--via <ssh-destination>] [--port <n>] [--no-open]" + " | say --workspace <id> --body <text> [--proposal <id>] --idempotency-key <key>" + " | propose --workspace <id> --question <text> --criteria <text> --extent <text>" + " [--known-conflicts <text>] [--topic <text>] [--consult-seconds <n>] --idempotency-key <key>" + " | withdraw --workspace <id> --proposal <id> --reason <text> --idempotency-key <key>" + " | passkey-enroll (--file <path>|- | --ceremony [--label <text>] [--port <n>] [--no-open])" + " | passkeys | passkey-export --credential <id> | passkey-revoke --credential <id>";
var VERB_OPTIONS = {
  workspaces: { required: [], optional: [] },
  voices: { required: ["workspace"], optional: [] },
  proposals: { required: ["workspace"], optional: ["proposal", "limit"] },
  inbox: { required: [], optional: ["workspace"] },
  challenge: { required: ["proposal", "act"], optional: ["reason", "challenge"] },
  consent: { required: ["proposal"], optional: ["passkey-assertion"] },
  reject: { required: ["proposal", "reason"], optional: ["passkey-assertion"] },
  "set-aside": { required: ["proposal", "challenge", "reason"], optional: ["passkey-assertion"] },
  ceremony: { required: ["proposal", "act"], optional: ["reason", "challenge", "via", "port", "no-open"] },
  say: { required: ["workspace", "body", "idempotency-key"], optional: ["proposal"] },
  propose: {
    required: ["workspace", "question", "criteria", "extent", "idempotency-key"],
    optional: ["known-conflicts", "topic", "consult-seconds"]
  },
  withdraw: { required: ["workspace", "proposal", "reason", "idempotency-key"], optional: [] },
  "passkey-enroll": { required: [], optional: ["file", "ceremony", "label", "port", "no-open"] },
  passkeys: { required: [], optional: [] },
  "passkey-export": { required: ["credential"], optional: [] },
  "passkey-revoke": { required: ["credential"], optional: [] }
};
var CEREMONY_VERBS = new Set(["ceremony"]);
var REMOTE_VERBS = new Set([
  "workspaces",
  "voices",
  "proposals",
  "inbox",
  "challenge",
  "consent",
  "reject",
  "set-aside",
  "say",
  "propose",
  "withdraw",
  "passkeys"
]);
var STRING_OPTIONS = [
  "workspace",
  "proposal",
  "limit",
  "act",
  "reason",
  "passkey-assertion",
  "body",
  "idempotency-key",
  "question",
  "criteria",
  "extent",
  "known-conflicts",
  "topic",
  "consult-seconds",
  "file",
  "credential",
  "db",
  "via",
  "port",
  "label",
  "challenge"
];
var BOOLEAN_OPTIONS = ["ceremony", "no-open"];
function runPersonDeskCli(argv, env = process.env, deps = {}) {
  let command = "person";
  const emit = (payload, exitCode) => ({
    exit_code: exitCode,
    line: JSON.stringify({ protocol: PERSON_DESK_PROTOCOL, command, ...payload })
  });
  if (argv.some((arg) => arg === "--help" || arg === "-h")) {
    return emit({ status: "help", usage: PERSON_DESK_USAGE }, 0);
  }
  const first = argv.find((arg) => !arg.startsWith("-"));
  if (first && Object.hasOwn(VERB_OPTIONS, first))
    command = `person ${first}`;
  try {
    const rule = consentRuleFromEnvironment(env);
    const { verb, values } = parsePersonArgs(argv);
    if (CEREMONY_VERBS.has(verb) || verb === "passkey-enroll" && values.ceremony) {
      throw new CollabError("usage_error", `person ${verb} serves a page; run it through agenttool-collab-host`);
    }
    const store2 = openDeskStore(values, env, deps);
    try {
      const outcome = runVerb(store2, verb, values, deps, rule);
      return outcome.cancelled ? emit({ status: "cancelled", message: "Not confirmed at the terminal; nothing was written" }, EXIT_NOT_CONFIRMED) : emit({ status: "ok", ...outcome.result }, 0);
    } finally {
      store2.close();
    }
  } catch (error) {
    return emit(errorPayload(error), 1);
  }
}
function runPersonRemoteCli(env = process.env, deps = {}) {
  let argv;
  try {
    argv = JSON.parse(env.SSH_ORIGINAL_COMMAND ?? "");
  } catch {
    argv = null;
  }
  const fail = (error, message) => ({
    exit_code: 1,
    line: JSON.stringify({ protocol: PERSON_DESK_PROTOCOL, command: "person-remote", status: "error", error, message })
  });
  if (!Array.isArray(argv) || argv.length === 0 || argv.length > 32 || !argv.every((arg) => typeof arg === "string")) {
    return fail("usage_error", "SSH_ORIGINAL_COMMAND must be a JSON array of strings, verb first");
  }
  const verb = argv[0];
  if (!Object.hasOwn(VERB_OPTIONS, verb) || !REMOTE_VERBS.has(verb)) {
    return fail("remote_verb_refused", "This verb needs a terminal or a browser on the device itself");
  }
  if (argv.some((arg) => arg === "--db" || arg.startsWith("--db="))) {
    return fail("remote_verb_refused", "The forced command pins the journal; --db is not accepted remotely");
  }
  if ((verb === "consent" || verb === "reject" || verb === "set-aside") && !argv.includes("--passkey-assertion=-")) {
    return fail("remote_verb_refused", "Remote acts need a passkey assertion on stdin (--passkey-assertion=-)");
  }
  return runPersonDeskCli(argv, env, deps);
}
function openDeskStore(values, env, deps) {
  const databasePath = values.db ?? resolveDatabasePath(env);
  if (!existsSync5(databasePath)) {
    throw new CollabError("journal_not_found", "No collaboration journal exists at the selected path; pass --db or set AGENTOOL_COLLAB_DB");
  }
  return new CollabStore(databasePath, deps.storeNow ? { now: deps.storeNow } : {});
}
function runVerb(store2, verb, values, deps, rule) {
  const done = (result) => ({ cancelled: false, result });
  switch (verb) {
    case "workspaces":
      return done({ workspaces: store2.listWorkspaces() });
    case "voices":
      return done({ voices: store2.tableVoices(values.workspace) });
    case "proposals": {
      if (values.proposal) {
        const proposal = store2.proposalStatus(values.workspace, values.proposal);
        return done({
          proposal,
          soft_spots: deskSoftSpotsFor(store2, values.workspace, [proposal]),
          ...setAsideOptionsFor(store2, values.workspace, [proposal])
        });
      }
      const listed = store2.listProposalStatuses(values.workspace, { limit: parseInteger(values.limit, "limit") });
      return done({
        ...listed,
        soft_spots: deskSoftSpotsFor(store2, values.workspace, listed.proposals),
        ...setAsideOptionsFor(store2, values.workspace, listed.proposals)
      });
    }
    case "inbox": {
      if (!values.workspace)
        return done({ summary: store2.personInboxSummary() });
      const inbox = store2.personInbox(values.workspace);
      return done({ inbox, soft_spots: deskSoftSpotsFor(store2, values.workspace, inbox.awaiting_person) });
    }
    case "challenge": {
      const act = parseDeskAct(values);
      return done({
        challenge: act === "set-aside" ? store2.personSetAsideChallenge({
          proposal_report_id: values.proposal,
          challenge_report_id: values.challenge,
          reason: values.reason
        }) : store2.personActChallenge({ proposal_report_id: values.proposal, act, reason: values.reason })
      });
    }
    case "set-aside": {
      if (values["passkey-assertion"] !== undefined) {
        return done({
          proposal: store2.recordSetAsideWithPasskey({
            proposal_report_id: values.proposal,
            challenge_report_id: values.challenge,
            reason: values.reason,
            assertion: readJsonInput(values["passkey-assertion"], deps)
          })
        });
      }
      const challenge = store2.personSetAsideChallenge({
        proposal_report_id: values.proposal,
        challenge_report_id: values.challenge,
        reason: values.reason
      });
      const status = store2.proposalStatusById(values.proposal);
      const bytes = setAsideShownBytes(challenge.challenge_bytes, challenge.objection, status);
      const softSpots = deskSoftSpotsFor(store2, status.proposal.workspace_id, [status])[status.proposal.id];
      const confirmed = confirmOnTty({
        act: "set aside a challenge",
        summary: [...setAsideSummary(status, challenge), ...softSpotSummaryLines(softSpotDisplay(softSpots, status, "local"))],
        bytes,
        sha256: createHash6("sha256").update(bytes).digest("hex")
      }, { openTty: deps.openTty, now: deps.now });
      if (!confirmed)
        return { cancelled: true };
      return done({
        proposal: store2.recordSetAsideAtTerminal({
          proposal_report_id: status.proposal.id,
          proposal_sha256: challenge.proposal_sha256,
          challenge_report_id: challenge.challenge_report_id,
          challenge_sha256: challenge.challenge_sha256,
          reason: challenge.reason,
          expected_ai_snapshot: challenge.ai_snapshot
        })
      });
    }
    case "consent":
    case "reject": {
      const act = verb === "consent" ? "agree" : "reject";
      if (values["passkey-assertion"] !== undefined) {
        return done({
          proposal: store2.recordPersonActWithPasskey({
            proposal_report_id: values.proposal,
            act,
            reason: values.reason,
            assertion: readJsonInput(values["passkey-assertion"], deps)
          })
        });
      }
      const challenge = store2.personActChallenge({ proposal_report_id: values.proposal, act, reason: values.reason });
      const status = store2.proposalStatusById(values.proposal);
      const bytes = `${challenge.challenge_bytes}
${status.proposal_bytes}`;
      const softSpots = deskSoftSpotsFor(store2, status.proposal.workspace_id, [status])[status.proposal.id];
      const confirmed = confirmOnTty({
        act: act === "agree" ? "agree to a proposal" : "reject a proposal",
        summary: [...actSummary(status, act, challenge.reason), ...softSpotSummaryLines(softSpotDisplay(softSpots, status, "local"))],
        bytes,
        sha256: createHash6("sha256").update(bytes).digest("hex")
      }, { openTty: deps.openTty, now: deps.now });
      if (!confirmed)
        return { cancelled: true };
      return done({
        proposal: store2.recordPersonActAtTerminal({
          proposal_report_id: status.proposal.id,
          proposal_sha256: status.proposal_sha256,
          act,
          reason: challenge.reason ?? undefined,
          expected_ai_snapshot: challenge.ai_snapshot
        })
      });
    }
    case "say":
      return done({
        report: store2.appendPersonNote({
          workspace_id: values.workspace,
          idempotency_key: values["idempotency-key"],
          body: values.body,
          proposal_report_id: values.proposal
        })
      });
    case "propose":
      return done({
        proposal: store2.openPersonProposal({
          workspace_id: values.workspace,
          idempotency_key: values["idempotency-key"],
          question: values.question,
          criteria: values.criteria,
          extent: values.extent,
          known_conflicts: values["known-conflicts"],
          topic: values.topic,
          consult_seconds: parseInteger(values["consult-seconds"], "consult-seconds"),
          ...rule !== CONSENT_RULE ? { rule } : {}
        })
      });
    case "withdraw":
      return done({
        proposal: store2.withdrawPersonProposal({
          workspace_id: values.workspace,
          idempotency_key: values["idempotency-key"],
          proposal_report_id: values.proposal,
          reason: values.reason
        })
      });
    case "passkey-enroll": {
      if (values.file === undefined) {
        throw new CollabError("usage_error", `passkey-enroll needs --file or --ceremony; ${PERSON_DESK_USAGE}`);
      }
      const read = readJsonInput(values.file, deps);
      const exported = read.protocol === PERSON_DESK_PROTOCOL && read.command === "person passkey-export" && typeof read.enrollment === "object" && read.enrollment !== null && !Array.isArray(read.enrollment);
      const input = exported ? read.enrollment : read;
      const enrollment = normalizePasskeyEnrollment({
        credential_id: input.credential_id,
        public_key_spki: input.public_key_spki,
        algorithm: input.algorithm,
        rp_id: input.rp_id,
        origin: input.origin,
        label: values.label ?? input.label
      });
      return confirmEnrollment(store2, enrollment, deps) ? done({ passkey: store2.enrollPersonPasskey(enrollment) }) : { cancelled: true };
    }
    case "passkeys":
      return done({ passkeys: store2.listPersonPasskeys() });
    case "passkey-export": {
      const passkey = activePasskey(store2, values.credential);
      return done({
        enrollment: {
          credential_id: passkey.credential_id,
          public_key_spki: passkey.public_key_spki,
          algorithm: -7,
          rp_id: passkey.rp_id,
          origin: passkey.origin,
          label: passkey.label
        },
        fingerprint: passkey.fingerprint
      });
    }
    case "passkey-revoke": {
      const passkey = activePasskey(store2, values.credential);
      const bytes = canonicalJson({ revoke: passkey.credential_id, fingerprint: passkey.fingerprint });
      const confirmed = confirmOnTty({
        act: "revoke a passkey",
        summary: [`key fingerprint (sha256): ${passkey.fingerprint}`, `origin ${passkey.origin}`],
        bytes,
        sha256: createHash6("sha256").update(bytes).digest("hex")
      }, { openTty: deps.openTty, now: deps.now });
      if (!confirmed)
        return { cancelled: true };
      return done({ passkey: store2.revokePersonPasskey(passkey.credential_id) });
    }
    case "ceremony":
      throw new CollabError("usage_error", "person ceremony serves a page; run it through agenttool-collab-host");
  }
}
function confirmEnrollment(store2, enrollment, deps) {
  if (store2.listPersonPasskeys().some((key) => key.credential_id === enrollment.credential_id)) {
    throw new CollabError("passkey_already_enrolled", "This credential id is already enrolled");
  }
  const bytes = canonicalJson(enrollment);
  return confirmOnTty({
    act: "enrol a passkey",
    summary: [
      `key fingerprint (sha256): ${passkeyFingerprint(enrollment.public_key_spki)}`,
      `relying party ${enrollment.rp_id}, signing origin ${enrollment.origin}`,
      `label ${JSON.stringify(enrollment.label)}`,
      "Enrol only a passkey you just created yourself; it will sign agreements in your name."
    ],
    bytes,
    sha256: createHash6("sha256").update(bytes).digest("hex")
  }, { openTty: deps.openTty, now: deps.now });
}
function activePasskey(store2, credentialId) {
  const passkey = store2.listPersonPasskeys().find((key) => key.credential_id === credentialId);
  if (!passkey || passkey.revoked_at !== null) {
    throw new CollabError("passkey_not_enrolled", "No active enrolled passkey has this credential id");
  }
  return passkey;
}
function setAsideShownBytes(challengeBytes, objection, status) {
  return `${challengeBytes}
${challengeContentBytes(objection)}
${status.proposal_bytes}`;
}
function setAsideSummary(status, challenge) {
  const objection = challenge.objection;
  const seen = challenge.challenger.last_seen_at;
  return [
    `workspace ${status.proposal.workspace_id}, proposal ${status.proposal.id} (${status.rule})`,
    `agents' position: ${status.ai.position} (${status.ai.qualifying_support_report_ids.length} qualifying supports, ` + `${status.ai.unresolved_challenge_report_ids.length} standing challenges)`,
    `question ${JSON.stringify(status.proposal.body)}`,
    `challenge ${objection.id} by ${JSON.stringify(objection.from_actor)} (name self-declared), written ${objection.created_at}`,
    `it says ${JSON.stringify(objection.body)}`,
    `why it can be set aside: no session of its voice is live` + (seen ? ` (last seen ${seen})` : " (no session of it is recorded)") + ", so no session can lift it now.",
    `your reason ${JSON.stringify(challenge.reason)}`,
    "Setting it aside is final. It stays on the record and in every view; any voice may challenge again."
  ];
}
function actSummary(status, act, reason) {
  return [
    `workspace ${status.proposal.workspace_id}, proposal ${status.proposal.id}`,
    `agents' position: ${status.ai.position} (${status.ai.qualifying_support_report_ids.length} qualifying supports, ` + `${status.ai.unresolved_challenge_report_ids.length} standing challenges)`,
    `question ${JSON.stringify(status.proposal.body)}`,
    `extent ${JSON.stringify(status.terms.extent)}`,
    act === "agree" ? "Agreeing authorises only this extent." : `reason ${JSON.stringify(reason)}`
  ];
}
function deskSoftSpotsFor(store2, workspaceId, statuses) {
  const ids = statuses.map((status) => status.proposal.id);
  try {
    return Object.fromEntries(store2.personDeskProposalViews(workspaceId, ids).map((read) => [
      read.proposal_report_id,
      "view" in read ? deskSoftSpots(read.view) : softSpotsUnavailable(read.error)
    ]));
  } catch (error) {
    const code = error instanceof CollabError ? error.code : "internal_error";
    return Object.fromEntries(ids.map((id) => [id, softSpotsUnavailable(code)]));
  }
}
function parsePersonArgs(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      tokens: true,
      options: {
        ...Object.fromEntries(STRING_OPTIONS.map((name) => [name, { type: "string" }])),
        ...Object.fromEntries(BOOLEAN_OPTIONS.map((name) => [name, { type: "boolean" }]))
      }
    });
  } catch (error) {
    throw new CollabError("usage_error", `${error instanceof Error ? error.message : String(error)}; ${PERSON_DESK_USAGE}`);
  }
  const [command, ...extra] = parsed.positionals;
  if (!command || !Object.hasOwn(VERB_OPTIONS, command) || extra.length > 0) {
    throw new CollabError("usage_error", PERSON_DESK_USAGE);
  }
  const verb = command;
  const seen = new Set;
  for (const token of parsed.tokens ?? []) {
    if (token.kind !== "option")
      continue;
    if (seen.has(token.name)) {
      throw new CollabError("usage_error", `--${token.name} is given more than once; ${PERSON_DESK_USAGE}`);
    }
    seen.add(token.name);
  }
  const values = parsed.values;
  const { required, optional } = VERB_OPTIONS[verb];
  for (const [name, value] of Object.entries(values)) {
    if (name !== "db" && !required.includes(name) && !optional.includes(name)) {
      throw new CollabError("usage_error", `--${name} does not apply to person ${verb}; ${PERSON_DESK_USAGE}`);
    }
    if (typeof value === "string" && value.trim() === "") {
      throw new CollabError("usage_error", `--${name} must not be empty; ${PERSON_DESK_USAGE}`);
    }
  }
  for (const name of required) {
    if (values[name] === undefined) {
      throw new CollabError("usage_error", `--${name} is required for person ${verb}; ${PERSON_DESK_USAGE}`);
    }
  }
  if (verb === "proposals" && values.proposal !== undefined && values.limit !== undefined) {
    throw new CollabError("usage_error", `--limit lists proposals; it does not apply with --proposal; ${PERSON_DESK_USAGE}`);
  }
  if (verb === "passkey-enroll" && values.file === undefined === (values.ceremony !== true)) {
    throw new CollabError("usage_error", `passkey-enroll needs exactly one of --file or --ceremony; ${PERSON_DESK_USAGE}`);
  }
  if (verb === "passkey-enroll" && (values.port !== undefined || values["no-open"]) && values.ceremony !== true) {
    throw new CollabError("usage_error", `--port and --no-open apply only with --ceremony; ${PERSON_DESK_USAGE}`);
  }
  return { verb, values };
}
function parseDeskAct(values) {
  const act = values.act;
  if (act !== "agree" && act !== "reject" && act !== "set-aside") {
    throw new CollabError("usage_error", `--act must be agree, reject or set-aside; ${PERSON_DESK_USAGE}`);
  }
  if (act === "set-aside" !== (values.challenge !== undefined)) {
    throw new CollabError("usage_error", `--challenge names the challenge to set aside; give it with --act set-aside, and only then; ${PERSON_DESK_USAGE}`);
  }
  return act;
}
function setAsideOptionsFor(store2, workspaceId, statuses) {
  const v2 = statuses.filter((status) => status.rule === CONSENT_RULE_V2).map((status) => status.proposal.id);
  return v2.length > 0 ? { set_aside_options: store2.personSetAsideOptions(workspaceId, v2) } : {};
}
function parseInteger(value, name) {
  if (value === undefined)
    return;
  if (!/^\d{1,9}$/.test(value.trim())) {
    throw new CollabError("usage_error", `--${name} must be a non-negative integer; ${PERSON_DESK_USAGE}`);
  }
  return Number(value.trim());
}
function readBounded(path) {
  const fd = path === "-" ? 0 : openSync6(path, "r");
  try {
    const chunks = [];
    let total = 0;
    const buffer = Buffer.alloc(16 * 1024);
    while (total <= MAX_JSON_INPUT_BYTES) {
      let read;
      try {
        read = readSync3(fd, buffer, 0, buffer.length, null);
      } catch (error) {
        if (error.code === "EAGAIN")
          continue;
        throw error;
      }
      if (read === 0)
        break;
      chunks.push(Buffer.from(buffer.subarray(0, read)));
      total += read;
    }
    if (total > MAX_JSON_INPUT_BYTES) {
      throw new CollabError("input_too_large", `The JSON input exceeds ${MAX_JSON_INPUT_BYTES} bytes`);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    if (fd !== 0)
      closeSync6(fd);
  }
}
function readJsonInput(path, deps) {
  let text;
  try {
    text = deps.readStdin && path === "-" ? deps.readStdin() : readBounded(path);
  } catch (error) {
    if (error instanceof CollabError)
      throw error;
    throw new CollabError("input_unreadable", "The JSON input could not be read");
  }
  if (Buffer.byteLength(text, "utf8") > MAX_JSON_INPUT_BYTES) {
    throw new CollabError("input_too_large", `The JSON input exceeds ${MAX_JSON_INPUT_BYTES} bytes`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CollabError("input_invalid", "The input is not JSON");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CollabError("input_invalid", "The input must be a JSON object");
  }
  return value;
}
function errorPayload(error) {
  if (error instanceof CollabError) {
    return { ...error.details, status: "error", error: error.code, message: error.message };
  }
  return { status: "error", error: "internal_error", message: error instanceof Error ? error.message : String(error) };
}

// src/ceremony.ts
var DEFAULT_CEREMONY_PORT = 17778;
var CEREMONY_TIMEOUT_MS = 180000;
var MAX_POST_BYTES = 32 * 1024;
var SSH_DESTINATION = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,200}$/;
function openInBrowser(url) {
  if (process.platform !== "darwin")
    return false;
  try {
    const child = spawn("/usr/bin/open", [url], { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
function atTerminal(deps) {
  const tty = (deps.openTty ?? (() => openDevTty()))();
  if (tty === null)
    return false;
  tty.close();
  return true;
}
async function runCeremonyCli(argv, env, deps, io) {
  const first = argv.find((arg) => !arg.startsWith("-")) ?? "";
  const command = `person ${first}`;
  const emit = (payload, exitCode) => ({
    exit_code: exitCode,
    line: JSON.stringify({ protocol: PERSON_DESK_PROTOCOL, command, ...payload })
  });
  try {
    consentRuleFromEnvironment(env);
    const { verb, values } = parsePersonArgs(argv);
    if (verb === "passkey-enroll" && values.ceremony) {
      return emit(await enrollCeremony(values, env, deps, io, command), 0);
    }
    if (verb !== "ceremony")
      throw new CollabError("usage_error", "Not a ceremony verb");
    return emit(await signCeremony(values, env, deps, io, command), 0);
  } catch (error) {
    if (error instanceof CollabError && error.code === "not_confirmed") {
      return emit({ status: "cancelled", message: "Not confirmed at the terminal; nothing was written" }, EXIT_NOT_CONFIRMED);
    }
    return emit(errorPayload(error), 1);
  }
}
async function signCeremony(values, env, deps, io, command) {
  const act = parseDeskAct(values);
  const objectionId = act === "set-aside" ? values.challenge : null;
  const table = values.via ? remoteTable(values.via, io) : localTable(values, env, deps);
  try {
    const challenge = await table.challenge(values.proposal, act, values.reason, objectionId);
    if (challenge.passkeys.length === 0) {
      throw new CollabError("passkey_not_enrolled", "No passkey is enrolled at this table; enrol one first");
    }
    const { status, soft_spots: softSpots } = await table.status(challenge);
    const origin = values.port ? `http://localhost:${parsePort(values.port)}` : challenge.passkeys[0].origin;
    const port = portOf(origin);
    const passkeys = challenge.passkeys.filter((key) => key.origin === origin);
    if (passkeys.length === 0) {
      throw new CollabError("passkey_origin_mismatch", "No enrolled passkey signs for this ceremony origin", { origin });
    }
    const data = {
      kind: "sign",
      table: values.via ?? "this device",
      act,
      reason: challenge.reason,
      question: status.proposal.body,
      extent: status.terms.extent,
      criteria: status.terms.criteria,
      known_conflicts: status.terms.known_conflicts,
      position: status.ai.position,
      proposal_sha256: challenge.proposal_sha256,
      proposal_bytes: status.proposal_bytes,
      challenge_bytes: challenge.challenge_bytes,
      challenge: challenge.challenge,
      rp_id: "localhost",
      credentials: passkeys.map((key) => key.credential_id),
      soft_spots: softSpotDisplay(softSpots, status, values.via ? "remote" : "local"),
      ...act === "set-aside" ? { objection: objectionShown(challenge) } : {}
    };
    const browser = values["no-open"] !== true && atTerminal(deps);
    const result = await serveOnce(port, data, io, command, browser, async (body) => {
      const recorded = await table.record(challenge.proposal_report_id, act, challenge.reason, objectionId, body.assertion);
      return {
        recorded: true,
        person_state: recorded.person.state,
        may_proceed: recorded.may_proceed,
        proposal_sha256: recorded.proposal_sha256,
        ...act === "set-aside" ? { set_aside: objectionId, position: recorded.ai.position } : {}
      };
    });
    return { status: "ok", ...result };
  } finally {
    table.close();
  }
}
async function enrollCeremony(values, env, deps, io, command) {
  const probe = (deps.openTty ?? (() => openDevTty()))();
  if (probe === null) {
    throw new CollabError("tty_unavailable", "Enrolling a passkey needs a person at the controlling terminal (/dev/tty)");
  }
  probe.close();
  const port = values.port ? parsePort(values.port) : DEFAULT_CEREMONY_PORT;
  const origin = `http://localhost:${port}`;
  const store2 = openDeskStore(values, env, deps);
  try {
    const challenge = randomBytes2(32).toString("base64url");
    const data = {
      kind: "enroll",
      table: "this device",
      challenge,
      user_id: randomBytes2(16).toString("base64url"),
      rp_id: "localhost",
      label: values.label ?? "Touch ID"
    };
    const result = await serveOnce(port, data, io, command, values["no-open"] !== true, async (body) => {
      const input = body;
      checkCreateClientData(input.client_data_json, challenge, origin);
      const enrollment = normalizePasskeyEnrollment({
        credential_id: input.credential_id,
        public_key_spki: input.public_key_spki,
        algorithm: input.algorithm,
        rp_id: "localhost",
        origin,
        label: values.label ?? "Touch ID"
      });
      if (!confirmEnrollment(store2, enrollment, deps)) {
        throw new CollabError("not_confirmed", "Not confirmed at the terminal; nothing was enrolled");
      }
      const passkey = store2.enrollPersonPasskey(enrollment);
      return { enrolled: true, fingerprint: passkey.fingerprint, origin: passkey.origin };
    });
    return { status: "ok", ...result };
  } finally {
    store2.close();
  }
}
function objectionShown(challenge) {
  const objection = challenge.objection;
  if (!objection || objection.id !== challenge.challenge_report_id) {
    throw new CollabError("remote_desk_failed", "The desk did not return the challenge it would set aside");
  }
  const seen = challenge.challenger?.last_seen_at ?? null;
  return {
    id: objection.id,
    by: objection.from_actor,
    by_basis: "self-declared",
    written_at: objection.created_at,
    text: objection.body,
    why: "No session of its voice is live, so no session can lift it now" + (seen ? ` (last seen ${seen}).` : " (no session of it is recorded)."),
    content_bytes: challengeContentBytes(objection)
  };
}
function checkCreateClientData(value, challenge, origin) {
  let clientData = null;
  try {
    if (typeof value === "string" && /^[A-Za-z0-9_-]{1,8192}$/.test(value)) {
      clientData = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    }
  } catch {
    clientData = null;
  }
  if (!clientData || clientData.type !== "webauthn.create" || clientData.challenge !== challenge || clientData.origin !== origin || clientData.crossOrigin === true) {
    throw new CollabError("passkey_assertion_invalid", "The new passkey was not created by this enrolment page");
  }
}
function localTable(values, env, deps) {
  const store2 = openDeskStore(values, env, deps);
  return {
    async challenge(proposal, act, reason, objection) {
      return act === "set-aside" ? store2.personSetAsideChallenge({ proposal_report_id: proposal, challenge_report_id: objection, reason }) : store2.personActChallenge({ proposal_report_id: proposal, act, reason });
    },
    async status(challenge) {
      const status = store2.proposalStatusById(challenge.proposal_report_id);
      return { status, soft_spots: deskSoftSpotsFor(store2, status.proposal.workspace_id, [status])[status.proposal.id] };
    },
    async record(proposal, act, reason, objection, assertion) {
      return act === "set-aside" ? store2.recordSetAsideWithPasskey({
        proposal_report_id: proposal,
        challenge_report_id: objection,
        reason,
        assertion
      }) : store2.recordPersonActWithPasskey({
        proposal_report_id: proposal,
        act,
        reason: reason ?? undefined,
        assertion
      });
    },
    close: () => store2.close()
  };
}
function remoteTable(destination, io) {
  if (!SSH_DESTINATION.test(destination)) {
    throw new CollabError("usage_error", "--via must be an SSH host alias or user@host");
  }
  const call = io.remote ?? sshDesk;
  const receipt = async (argv, stdin) => {
    const result = await call(destination, argv, stdin);
    if (result.status !== "ok") {
      throw new CollabError(typeof result.error === "string" ? result.error : "remote_desk_failed", typeof result.message === "string" ? result.message : "The other device's desk refused the request", { via: destination });
    }
    return result;
  };
  return {
    async challenge(proposal, act, reason, objection) {
      const argv = [
        "challenge",
        `--proposal=${proposal}`,
        `--act=${act}`,
        ...objection ? [`--challenge=${objection}`] : [],
        ...reason ? [`--reason=${reason}`] : []
      ];
      return (await receipt(argv)).challenge;
    },
    async status(challenge) {
      const argv = ["proposals", `--workspace=${challenge.workspace_id}`, `--proposal=${challenge.proposal_report_id}`];
      const read = await receipt(argv);
      return { status: read.proposal, soft_spots: remoteSoftSpots(read, challenge.proposal_report_id) };
    },
    async record(proposal, act, reason, objection, assertion) {
      const argv = [
        act === "agree" ? "consent" : act === "reject" ? "reject" : "set-aside",
        `--proposal=${proposal}`,
        ...objection ? [`--challenge=${objection}`] : [],
        ...reason ? [`--reason=${reason}`] : [],
        "--passkey-assertion=-"
      ];
      return (await receipt(argv, JSON.stringify(assertion ?? null))).proposal;
    },
    close: () => {}
  };
}
async function sshDesk(destination, argv, stdin) {
  const child = Bun.spawn(["/usr/bin/ssh", "-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "--", destination, JSON.stringify(argv)], { stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin), stdout: "pipe", stderr: "ignore" });
  const timer = setTimeout(() => child.kill("SIGKILL"), 30000);
  try {
    const text = await new Response(child.stdout).text();
    await child.exited;
    const line = text.trim().split(`
`).at(-1) ?? "";
    try {
      return JSON.parse(line);
    } catch {
      throw new CollabError("remote_desk_unreadable", "The other device's desk returned no receipt", { via: destination });
    }
  } finally {
    clearTimeout(timer);
  }
}
function parsePort(value) {
  const port = parseInteger(value, "port");
  if (port < 1024 || port > 65535)
    throw new CollabError("usage_error", "--port must be from 1024 to 65535");
  return port;
}
function portOf(origin) {
  const url = new URL(origin);
  if (url.protocol !== "http:" || url.hostname !== "localhost" || !url.port) {
    throw new CollabError("passkey_origin_mismatch", "Ceremonies serve only from http://localhost:<port>", { origin });
  }
  return Number(url.port);
}
async function serveOnce(port, data, io, command, browser, onPost) {
  const token = randomBytes2(24).toString("base64url");
  const nonce = randomBytes2(16).toString("base64url");
  const origin = `http://localhost:${port}`;
  const path = `/c/${token}`;
  let settle;
  const finished = new Promise((resolve5) => {
    settle = resolve5;
  });
  let used = false;
  const expiresAt = new Date(Date.now() + CEREMONY_TIMEOUT_MS).toISOString();
  const page = ceremonyPage({ ...data, expires_at: expiresAt }, nonce);
  const headers = {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; ` + "img-src 'none'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'"
  };
  let server;
  try {
    server = Bun.serve({
      hostname: "127.0.0.1",
      port,
      async fetch(request) {
        const url = new URL(request.url);
        if (request.headers.get("host") !== `localhost:${port}`) {
          return new Response("Open this page at localhost", { status: 421, headers });
        }
        if (request.method === "GET" && url.pathname === path) {
          return new Response(page, { headers: { ...headers, "Content-Type": "text/html; charset=utf-8" } });
        }
        if (request.method === "POST" && url.pathname !== `${path}/done`) {
          return Response.json({
            ok: false,
            error: "ceremony_expired",
            message: "This page belongs to an earlier ceremony. Use the newest link your terminal printed."
          }, { status: 410, headers });
        }
        if (request.method === "POST") {
          if (request.headers.get("origin") !== origin || used) {
            return Response.json({
              ok: false,
              error: "ceremony_closed",
              message: "This ceremony has already finished. Start a new one to try again."
            }, { status: 409, headers });
          }
          used = true;
          try {
            const text = await request.text();
            if (Buffer.byteLength(text) > MAX_POST_BYTES)
              throw new CollabError("input_too_large", "The page sent too much");
            const result = await onPost(JSON.parse(text));
            settle({ ok: true, result });
            return Response.json({ ok: true, ...result }, { headers });
          } catch (error) {
            settle({ ok: false, error });
            const payload = errorPayload(error);
            return Response.json({ ok: false, error: payload.error, message: payload.message }, { status: 409, headers });
          }
        }
        return new Response("Not found", { status: 404, headers });
      }
    });
  } catch {
    throw new CollabError("ceremony_port_busy", `Another program holds ${origin}; close it or finish its ceremony first`);
  }
  const pageUrl = `${origin}${path}`;
  io.out(JSON.stringify({ protocol: PERSON_DESK_PROTOCOL, command, status: "open", url: pageUrl, expires_at: expiresAt }));
  const closes = new Date(expiresAt).toLocaleTimeString();
  io.note?.(browser && io.open?.(pageUrl) ? `Opened the page in your browser. If it did not appear, open ${pageUrl} before ${closes}.` : `Open ${pageUrl} in your browser before ${closes}.`);
  const timer = setTimeout(() => settle({ ok: false, error: new CollabError("ceremony_timeout", "The ceremony page was not used in time") }), CEREMONY_TIMEOUT_MS);
  try {
    const outcome = await finished;
    if (!outcome.ok)
      throw outcome.error;
    return outcome.result;
  } finally {
    clearTimeout(timer);
    setTimeout(() => server.stop(true), 250);
  }
}
function ceremonyPage(data, nonce) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Person desk</title>
<style nonce="${nonce}">
:root { color-scheme: light dark; --fg: #1d1d1f; --bg: #f6f5f2; --dim: #6b6b70; --card: #ffffff; --line: #dedcd6; --go: #1f7a4a; --stop: #a33a2c; }
@media (prefers-color-scheme: dark) { :root { --fg: #ecebe8; --bg: #141416; --dim: #9a9aa0; --card: #1d1d21; --line: #33333a; --go: #5cc08a; --stop: #ef7b6b; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
main { max-width: 680px; margin: 0 auto; padding: 32px 16px 48px; }
h1 { font-size: 1.15rem; margin: 0 0 4px; } .dim { color: var(--dim); font-size: .85rem; }
section { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; margin: 14px 0; }
.label { font-size: .72rem; letter-spacing: .06em; text-transform: uppercase; color: var(--dim); margin-top: 10px; }
.value { white-space: pre-wrap; overflow-wrap: anywhere; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.45 ui-monospace, Menlo, monospace; margin: 6px 0 0; }
button { font: inherit; padding: 10px 18px; border-radius: 8px; border: 1px solid currentColor; background: transparent; cursor: pointer; }
button.go { color: var(--go); } button.stop { color: var(--stop); } button[disabled] { opacity: .5; cursor: default; }
#result:empty { display: none; }
ul { margin: 6px 0 0; padding-left: 18px; } li { white-space: pre-wrap; overflow-wrap: anywhere; margin: 4px 0; }
</style></head><body><main>
<h1 id="title"></h1><div class="dim" id="sub"></div>
<section id="what"></section>
<section id="soft" hidden><div class="label" id="soft-note"></div><ul id="soft-lines"></ul></section>
<section><div class="label">Exact bytes you are signing</div><pre id="act"></pre>
<div id="objection-bytes" hidden><div class="label">The challenge they name</div><pre id="objection"></pre></div>
<div class="label">The proposal they name</div><pre id="proposal"></pre></section>
<button id="go"></button>
<section id="result"></section>
<p class="dim">Served by the Collab person desk on this device, for this ceremony only. Touch ID names only "localhost", so act only if you opened this page yourself.</p>
</main>
<script type="application/json" id="data">${json}</script>
<script nonce="${nonce}">
(() => {
  const data = JSON.parse(document.getElementById("data").textContent);
  const $ = (id) => document.getElementById(id);
  const dec = (v) => Uint8Array.from(atob(v.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((v.length + 3) % 4)), (c) => c.charCodeAt(0));
  const enc = (b) => { let s = ""; for (const x of new Uint8Array(b)) s += String.fromCharCode(x); return btoa(s).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, ""); };
  const field = (label, value) => { if (!value) return; const l = document.createElement("div"); l.className = "label"; l.textContent = label; const v = document.createElement("div"); v.className = "value"; v.textContent = value; $("what").append(l, v); };
  const say = (text) => { $("result").textContent = text; };
  const expired = "This page has expired. Start again from your terminal or YOUI, and use the newest link.";
  let posted = false;
  const post = async (body) => {
    let response;
    try {
      response = await fetch(location.pathname + "/done", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch { return { ok: false, message: expired }; }
    posted = true;
    try { return await response.json(); } catch { return { ok: false, message: expired }; }
  };
  const left = Date.parse(data.expires_at) - Date.now();
  setTimeout(() => { if (!posted) { $("go").disabled = true; say(expired); } }, Math.max(0, left));
  if (data.kind === "sign") {
    const aside = data.act === "set-aside";
    $("title").textContent = data.act === "agree" ? "Agree to this proposal" : aside ? "Set aside a challenge to this proposal" : "Reject this proposal";
    $("sub").textContent = "Table: " + data.table + " \xB7 agents' position: " + data.position;
    field("Question", data.question); field("Criteria", data.criteria);
    field("Extent \u2014 agreement authorises only this", data.extent); field("Known conflicts", data.known_conflicts);
    if (aside) {
      field("The challenge, by " + data.objection.by + " (name " + data.objection.by_basis + "), written " + data.objection.written_at, data.objection.text);
      field("Why it can be set aside", data.objection.why);
      field("Your reason", data.reason);
      field("What setting it aside does", "It no longer blocks the agents' position. It stays on the record and in every view, and any voice may challenge again. It cannot be undone.");
      $("objection").textContent = data.objection.content_bytes; $("objection-bytes").hidden = false;
    }
    if (data.act === "reject") field("Your reason", data.reason);
    if (data.soft_spots) {
      $("soft-note").textContent = data.soft_spots.note;
      for (const line of data.soft_spots.lines) { const li = document.createElement("li"); li.textContent = line; $("soft-lines").append(li); }
      $("soft").hidden = false;
    }
    $("act").textContent = data.challenge_bytes; $("proposal").textContent = data.proposal_bytes;
    $("go").textContent = data.act === "agree" ? "Touch ID: agree" : aside ? "Touch ID: set aside" : "Touch ID: reject";
    $("go").className = data.act === "agree" ? "go" : "stop";
    $("go").onclick = async () => {
      $("go").disabled = true;
      try {
        const c = await navigator.credentials.get({ publicKey: { challenge: dec(data.challenge), rpId: data.rp_id,
          allowCredentials: data.credentials.map((id) => ({ type: "public-key", id: dec(id) })), userVerification: "required", timeout: 120000 } });
        const r = await post({ assertion: { credential_id: enc(c.rawId), authenticator_data: enc(c.response.authenticatorData),
          client_data_json: enc(c.response.clientDataJSON), signature: enc(c.response.signature),
          user_handle: c.response.userHandle ? enc(c.response.userHandle) : null } });
        say(r.ok ? (data.act === "agree" ? "Recorded. Your agreement authorises only the extent above. You can close this page."
          : aside ? "Recorded. The challenge is set aside and stays on the record; agreeing is a separate act. You can close this page." : "Recorded. You can close this page.")
          : "The desk refused: " + (r.message || r.error));
      } catch (e) { say("Nothing was signed: " + e.message); $("go").disabled = false; }
    };
  } else {
    $("title").textContent = "Enrol a passkey for the person desk";
    $("sub").textContent = "Your terminal will show the new key's fingerprint and ask you to type yes.";
    field("Label", data.label);
    $("act").textContent = "A new ES256 passkey for relying party localhost, created by Touch ID on this device.";
    $("proposal").textContent = "(none)";
    $("go").textContent = "Create with Touch ID"; $("go").className = "go";
    $("go").onclick = async () => {
      $("go").disabled = true;
      try {
        const c = await navigator.credentials.create({ publicKey: { rp: { id: data.rp_id, name: "Collab person desk" },
          user: { id: dec(data.user_id), name: "person", displayName: "Person" }, challenge: dec(data.challenge),
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
          attestation: "none", timeout: 120000 } });
        say("Now look at your terminal: compare the fingerprint and type yes.");
        const r = await post({ credential_id: enc(c.rawId), public_key_spki: enc(c.response.getPublicKey()),
          algorithm: c.response.getPublicKeyAlgorithm(), client_data_json: enc(c.response.clientDataJSON) });
        say(r.ok ? "Enrolled. Fingerprint " + r.fingerprint : "Not enrolled: " + (r.message || r.error));
      } catch (e) { say("No passkey was created: " + e.message); $("go").disabled = false; }
    };
  }
})();
</script></body></html>`;
}

// src/host.ts
var COLLAB_HOST_PROTOCOL = "agenttool.collab-host/1";
var COLLAB_HOST_USAGE = "usage: agenttool-collab-host end (--session-file <path> | --seat-ref <ref> [--seat-ref <ref>...]) --reason <text>" + " [--release-leases] [--db <path>]" + " | agenttool-collab-host wait (--session <id> | --session-file <path>) [--after-anchor <json>]" + " [--wait-ms <ms>] [--include-own] [--addressed] [--db <path>]" + ` | agenttool-collab-host person ... (${PERSON_DESK_USAGE})` + " | agenttool-collab-host person-remote (SSH forced command; reads a JSON argv from SSH_ORIGINAL_COMMAND)";
var MAX_HOST_REASON = 2000;
var DEFAULT_HOST_WAIT_MS = 600000;
var MAX_HOST_WAIT_MS = 3600000;
var HOST_WAIT_POLL_MS = 250;
var systemClock = {
  now: () => performance.now(),
  sleep: (ms) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  }
};
function endSessionFromCredential(store2, credential, options) {
  let resumed;
  try {
    if (!options.release_leases)
      store2.preflightSessionEnd(credential);
    resumed = store2.resumeSession(credential, { allow_cursor_recovery: true });
  } catch (error) {
    if (error instanceof CollabError && error.code === "session_auth_failed") {
      const known = store2.getCoordinationSession(credential.session_id);
      if (known?.status === "ended") {
        return removeRevokedFile(options.session_file, {
          protocol: COLLAB_HOST_PROTOCOL,
          status: "already_ended",
          session_id: known.id,
          released: [],
          ended_at: known.ended_at
        });
      }
    }
    throw error;
  }
  const ended = store2.endSessionWithReleases({
    ...resumed.credential,
    reason: options.reason,
    release_leases: options.release_leases
  });
  return removeRevokedFile(options.session_file, {
    protocol: COLLAB_HOST_PROTOCOL,
    status: "ended",
    session_id: ended.session.id,
    released: ended.released_leases.map(({ task_id, lease_id, via }) => ({
      task_id,
      lease_id,
      via
    })),
    ended_at: ended.session.ended_at
  });
}
function endSessionsForSeatRefs(store2, options, secrets = []) {
  const seatRefs = [...new Set(options.seat_refs.map(validateSeatRef))];
  const sessions = store2.activeSessionIdsForSeatRefs(seatRefs).map((sessionId) => {
    const sessionFile = store2.defaultSessionCredentialPath(sessionId);
    if (!existsSync6(sessionFile))
      return { session_id: sessionId, status: "credential_missing" };
    try {
      const credential = readSessionCredentialFile(sessionFile);
      secrets.push(credential.session_token);
      if (credential.session_id !== sessionId) {
        throw new CollabError("session_auth_failed", "Session credentials are invalid");
      }
      const { status, released, ended_at, warning } = endSessionFromCredential(store2, credential, {
        session_file: sessionFile,
        reason: options.reason,
        release_leases: options.release_leases
      });
      return { session_id: sessionId, status, released, ended_at, ...warning ? { warning } : {} };
    } catch (error) {
      const { error: code, message } = errorReceipt(error);
      return { session_id: sessionId, status: "error", error: code, message };
    }
  });
  return { protocol: COLLAB_HOST_PROTOCOL, status: "ended_by_seat_ref", seat_refs: seatRefs, sessions };
}
function waitForSessionEvents(store2, credential, options, clock = systemClock) {
  const session = store2.getCoordinationSession(credential.session_id);
  if (!session)
    throw new CollabError("session_auth_failed", "Session credentials are invalid");
  const workspaceId = session.workspace_id;
  const afterAnchor = { ...options.after_anchor ?? session.cursor };
  const started = clock.now();
  const deadline = started + options.wait_ms;
  let observed = afterAnchor;
  let skipped = 0;
  let unaddressed = 0;
  const receipt = (status, headSequence2) => ({
    protocol: COLLAB_HOST_PROTOCOL,
    status,
    session_id: session.id,
    workspace_id: workspaceId,
    after_anchor: afterAnchor,
    next_anchor: { ...observed },
    head_sequence: headSequence2,
    skipped_own_events: skipped,
    ...options.addressed ? { skipped_unaddressed_events: unaddressed } : {},
    waited_ms: Math.max(0, Math.round(clock.now() - started))
  });
  let headSequence = observed.sequence;
  while (true) {
    let drained = true;
    try {
      const page = store2.eventsAfterAnchorForSession({
        ...credential,
        workspace_id: workspaceId,
        after_anchor: observed,
        event_limit: MAX_WAIT_EVENT_LIMIT
      });
      headSequence = page.head_sequence;
      for (const event of page.events) {
        const own = event.session_id === credential.session_id;
        const routed = !options.addressed || store2.eventAddressesSession(event, session.id);
        if ((options.include_own || !own) && routed) {
          return receipt("ready", headSequence);
        }
        observed = { epoch_id: event.epoch_id, sequence: event.sequence, hash: event.hash };
        if (own && !options.include_own)
          skipped += 1;
        else
          unaddressed += 1;
      }
      drained = !page.has_more;
    } catch (error) {
      if (error instanceof CollabError && error.code === "event_too_large") {
        return { ...receipt("ready", headSequence), first_event_oversized: true };
      }
      if (!(error instanceof CollabError) || error.code !== "event_read_busy" || clock.now() >= deadline) {
        throw error;
      }
    }
    if (!drained)
      continue;
    const remaining = deadline - clock.now();
    if (remaining <= 0)
      return receipt("idle", headSequence);
    clock.sleep(Math.min(HOST_WAIT_POLL_MS, remaining));
  }
}
function removeRevokedFile(sessionFile, receipt) {
  try {
    removeSessionCredentialFile(sessionFile);
    return receipt;
  } catch {
    return { ...receipt, warning: "session_file_remove_failed" };
  }
}
function runCollabHostCli(argv, env = process.env, clock = systemClock, personDeps = {}) {
  if (argv[0] === "person")
    return runPersonDeskCli(argv.slice(1), env, personDeps);
  if (argv[0] === "person-remote" && argv.length === 1)
    return runPersonRemoteCli(env, personDeps);
  const secrets = [];
  if (argv.some((arg) => arg === "--help" || arg === "-h")) {
    const help = { protocol: COLLAB_HOST_PROTOCOL, status: "help", usage: COLLAB_HOST_USAGE };
    return { exit_code: 0, line: JSON.stringify(help) };
  }
  const emit = (payload, exitCode) => {
    const line = JSON.stringify(payload);
    if (secrets.some((secret) => line.includes(secret))) {
      return {
        exit_code: 1,
        line: JSON.stringify({
          protocol: COLLAB_HOST_PROTOCOL,
          status: "error",
          error: "receipt_withheld",
          message: "The receipt would have contained credential material and was withheld"
        })
      };
    }
    return { exit_code: exitCode, line };
  };
  try {
    const args = parseHostArgs(argv);
    const databasePath = args.db ?? resolveDatabasePath(env);
    if (!existsSync6(databasePath)) {
      throw new CollabError("journal_not_found", "No collaboration journal exists at the selected path; pass --db or set AGENTOOL_COLLAB_DB");
    }
    if (args.command === "end_by_seat_ref") {
      const store3 = new CollabStore(databasePath);
      try {
        const receipt = endSessionsForSeatRefs(store3, args, secrets);
        return emit(receipt, receipt.sessions.some((session) => session.status === "error") ? 1 : 0);
      } finally {
        store3.close();
      }
    }
    if (args.command === "end") {
      const credential = readSessionCredentialFile(args.session_file);
      secrets.push(credential.session_token);
      const store3 = new CollabStore(databasePath);
      try {
        return emit(endSessionFromCredential(store3, credential, {
          session_file: args.session_file,
          reason: args.reason,
          release_leases: args.release_leases
        }), 0);
      } finally {
        store3.close();
      }
    }
    const store2 = new CollabStore(databasePath);
    try {
      const sessionFile = args.session_file ?? store2.defaultSessionCredentialPath(args.session);
      const credential = readSessionCredentialFile(sessionFile);
      secrets.push(credential.session_token);
      if (args.session !== undefined && credential.session_id !== args.session) {
        throw new CollabError("session_auth_failed", "Session credentials are invalid");
      }
      return emit(waitForSessionEvents(store2, credential, {
        after_anchor: args.after_anchor,
        wait_ms: args.wait_ms,
        include_own: args.include_own,
        addressed: args.addressed
      }, clock), 0);
    } finally {
      store2.close();
    }
  } catch (error) {
    return emit(errorReceipt(error), 1);
  }
}
async function runCollabHostCliAsync(argv, env = process.env, io = {
  out: (line) => process.stdout.write(`${line}
`),
  note: (line) => process.stderr.write(`${line}
`),
  open: openInBrowser
}, personDeps = {}) {
  const ceremony = argv[0] === "person" && !argv.some((arg) => arg === "--help" || arg === "-h") && (argv[1] === "ceremony" || argv[1] === "passkey-enroll" && argv.includes("--ceremony"));
  if (ceremony)
    return runCeremonyCli(argv.slice(1), env, personDeps, io);
  return runCollabHostCli(argv, env, systemClock, personDeps);
}
var END_ONLY_OPTIONS = ["reason", "release-leases", "seat-ref"];
var WAIT_ONLY_OPTIONS = ["session", "after-anchor", "wait-ms", "include-own", "addressed"];
function parseHostArgs(argv) {
  let parsed;
  try {
    parsed = parseHostOptions(argv);
  } catch (error) {
    throw new CollabError("usage_error", `${error instanceof Error ? error.message : String(error)}; ${COLLAB_HOST_USAGE}`);
  }
  const [command, ...extra] = parsed.positionals;
  if (command !== "end" && command !== "wait" || extra.length > 0) {
    throw new CollabError("usage_error", COLLAB_HOST_USAGE);
  }
  const foreign = (command === "end" ? WAIT_ONLY_OPTIONS : END_ONLY_OPTIONS).find((name) => parsed.values[name] !== undefined);
  if (foreign) {
    throw new CollabError("usage_error", `--${foreign} does not apply to ${command}; ${COLLAB_HOST_USAGE}`);
  }
  if (parsed.values.db !== undefined && parsed.values.db.trim() === "") {
    throw new CollabError("usage_error", `--db must not be empty; ${COLLAB_HOST_USAGE}`);
  }
  return command === "end" ? parseEndArgs(parsed.values) : parseWaitArgs(parsed.values);
}
function parseEndArgs(values) {
  const sessionFile = values["session-file"];
  const seatRefs = values["seat-ref"];
  const reason = values.reason;
  if (sessionFile === undefined === (seatRefs === undefined)) {
    throw new CollabError("usage_error", `Pass exactly one of --session-file or --seat-ref; ${COLLAB_HOST_USAGE}`);
  }
  if (sessionFile !== undefined && sessionFile.trim() === "") {
    throw new CollabError("usage_error", `--session-file must not be empty; ${COLLAB_HOST_USAGE}`);
  }
  for (const seatRef of seatRefs ?? []) {
    try {
      validateSeatRef(seatRef);
    } catch (error) {
      throw new CollabError("usage_error", `${error.message}; ${COLLAB_HOST_USAGE}`);
    }
  }
  if (!reason || reason.trim() === "") {
    throw new CollabError("usage_error", `--reason is required; ${COLLAB_HOST_USAGE}`);
  }
  if (reason.trim().length > MAX_HOST_REASON) {
    throw new CollabError("usage_error", `--reason exceeds ${MAX_HOST_REASON} characters; ${COLLAB_HOST_USAGE}`);
  }
  if (reason.includes("\x00")) {
    throw new CollabError("usage_error", `--reason must not contain NUL bytes; ${COLLAB_HOST_USAGE}`);
  }
  const releaseLeases = values["release-leases"] === true;
  if (seatRefs !== undefined) {
    return { command: "end_by_seat_ref", seat_refs: seatRefs, reason, release_leases: releaseLeases, db: values.db };
  }
  return {
    command: "end",
    session_file: sessionFile,
    reason,
    release_leases: releaseLeases,
    db: values.db
  };
}
function parseWaitArgs(values) {
  const sessionFile = values["session-file"];
  const session = values.session;
  if (sessionFile === undefined === (session === undefined)) {
    throw new CollabError("usage_error", `Pass exactly one of --session or --session-file; ${COLLAB_HOST_USAGE}`);
  }
  if ((sessionFile ?? session).trim() === "") {
    throw new CollabError("usage_error", `--session and --session-file must not be empty; ${COLLAB_HOST_USAGE}`);
  }
  let waitMs = DEFAULT_HOST_WAIT_MS;
  if (values["wait-ms"] !== undefined) {
    const raw = values["wait-ms"].trim();
    waitMs = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
    if (!Number.isSafeInteger(waitMs) || waitMs > MAX_HOST_WAIT_MS) {
      throw new CollabError("usage_error", `--wait-ms must be an integer from 0 to ${MAX_HOST_WAIT_MS}; ${COLLAB_HOST_USAGE}`);
    }
  }
  let afterAnchor;
  if (values["after-anchor"] !== undefined) {
    afterAnchor = parseAnchor(values["after-anchor"]);
  }
  return {
    command: "wait",
    session_file: sessionFile,
    session,
    after_anchor: afterAnchor,
    wait_ms: waitMs,
    include_own: values["include-own"] === true,
    addressed: values.addressed === true,
    db: values.db
  };
}
function parseAnchor(raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    value = null;
  }
  const anchor = value;
  if (anchor === null || typeof anchor !== "object" || Array.isArray(anchor) || Object.keys(anchor).sort().join(",") !== "epoch_id,hash,sequence" || typeof anchor.epoch_id !== "string" || typeof anchor.hash !== "string" || !Number.isSafeInteger(anchor.sequence) || anchor.sequence < 0) {
    throw new CollabError("usage_error", `--after-anchor must be JSON {"epoch_id","sequence","hash"}; ${COLLAB_HOST_USAGE}`);
  }
  return { epoch_id: anchor.epoch_id, sequence: anchor.sequence, hash: anchor.hash };
}
function parseHostOptions(argv) {
  return parseArgs2({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      "session-file": { type: "string" },
      "seat-ref": { type: "string", multiple: true },
      reason: { type: "string" },
      "release-leases": { type: "boolean" },
      db: { type: "string" },
      session: { type: "string" },
      "after-anchor": { type: "string" },
      "wait-ms": { type: "string" },
      "include-own": { type: "boolean" },
      addressed: { type: "boolean" }
    }
  });
}
var HOST_ACTIVE_LEASES_MESSAGE = "Release, complete, or hand off active task leases before ending the session, or rerun with --release-leases";
var HOST_ACTIVE_LEASES_REMEDY = "Rerun with --release-leases to release every lease this session holds and end it in one step, " + "or release, complete, or hand off each lease first (a handoff counts once it is accepted).";
function errorReceipt(error) {
  if (error instanceof CollabError) {
    const activeLeases = error.code === "session_has_active_leases";
    return {
      ...error.details,
      ...activeLeases ? { remedy: HOST_ACTIVE_LEASES_REMEDY } : {},
      protocol: COLLAB_HOST_PROTOCOL,
      status: "error",
      error: error.code,
      message: activeLeases ? HOST_ACTIVE_LEASES_MESSAGE : error.message
    };
  }
  return {
    protocol: COLLAB_HOST_PROTOCOL,
    status: "error",
    error: "internal_error",
    message: error instanceof Error ? error.message : String(error)
  };
}

// bin/agenttool-collab-host.ts
var result = await runCollabHostCliAsync(process.argv.slice(2), process.env);
process.stdout.write(`${result.line}
`);
process.exitCode = result.exit_code;
