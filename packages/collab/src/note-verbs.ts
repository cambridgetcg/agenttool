/**
 * Collab Notes: collab_note, collab_take and collab_done (spec 5.3 to 5.5).
 * Each is a thinner way to make the store's existing calls; the only rules
 * added are the ones that keep a record true: a resolve from anyone but the
 * challenger is recorded as an answer, a verdict lands only on the completion
 * the reviewer was shown, and nothing is stored that was not checked as the
 * result says it was. Everything else is advice.
 */
import { existsSync } from "node:fs";
import { CollabError } from "./errors.js";
import {
  checkNote,
  fileLocatorParts,
  isNoteAct,
  NOTE_JOURNAL_EVIDENCE_KINDS,
  NOTE_EVIDENCE_ATTRS,
  noteProblemError,
  normalizeNoteFields,
  normalizeNoteText,
  parseEvidence,
  parseNote,
  parseNoteRef,
  renderEvidence,
  renderNote,
  splitNoteText,
  hasLoneSurrogate,
  type NoteAct,
  type NoteFields,
  type NoteInput,
  type NoteReason,
} from "./note.js";
import type { CollabReport, ProposalStatus, Task } from "./protocol.js";
import { gitCommitExists, hashWorktreeFile, MAX_CITED_FILE_BYTES } from "./repository.js";
import { removeSessionCredentialFile } from "./session-file.js";
import {
  normalizePathScopes,
  type NoteAppendReceipt,
  type NoteCitedItem,
  type NoteCiteReceipt,
  type NoteReportInput,
  type NoteTargetView,
} from "./store.js";
import {
  changedUnderYou,
  derivedBase,
  exactRef,
  handleOf,
  notArrived,
  noteWriteResult,
  oneLine,
  replayReceipt,
  requireCredential,
  statementOf,
  underPlan,
  withCurrentVersion,
  withSlot,
  type NoteBinding,
  type NoteRemedy,
  type NoteVerbContext,
} from "./verbs.js";

type Credential = { session_id: string; session_token: string; generation: number };

// ---------------------------------------------------------------------------
// Shared checks

/**
 * Free text a verb stores (a reason to recover, a blocker, a summary):
 * normalised as a note body is, held to `max`, and refused when it would not
 * be stored as returned (NUL, half a character). Never shortened.
 */
function freeText(value: unknown, field: string, max: number, required: boolean): string | null {
  if (value === undefined || value === null) {
    if (!required) return null;
    throw new CollabError(`invalid_${field}`, `${field} is required`, { remedy: { say: `Give ${field} as text.` } });
  }
  if (typeof value !== "string") throw new CollabError(`invalid_${field}`, `${field} must be text`);
  const text = normalizeNoteText(value);
  if (!text) {
    if (!required) return null;
    throw new CollabError(`invalid_${field}`, `${field} must not be empty`, { remedy: { say: `Give ${field} as text.` } });
  }
  if (text.includes("\0")) throw new CollabError(`invalid_${field}`, `${field} must not contain NUL characters`);
  if (hasLoneSurrogate(text)) {
    throw new CollabError(`invalid_${field}`, `${field} must be well-formed Unicode text (it holds half of a character)`);
  }
  if (text.length > max) {
    throw new CollabError("too_long", `${field} is ${text.length} characters; at most ${max}`, {
      field,
      max,
      actual: text.length,
      unit: "chars",
    });
  }
  return text;
}

/** The first problem with a note, thrown before anything is written; a problem without a remedy gets one. */
function refuseNoteProblems(fields: NoteInput): void {
  const problem = checkNote(fields)[0];
  if (!problem) return;
  throw noteProblemError(problem);
}

/** An observation only when it gives reasons and every one was seen or quoted (spec 5.3 note row). */
function noteKind(why: NoteReason[]): "observation" | "inference" {
  return why.length > 0 && why.every((reason) => reason.basis === "seen" || reason.basis === "quoted")
    ? "observation"
    : "inference";
}

/** Reasons as one block for a `confidence_basis` column (review and completion). */
function reasonsText(why: NoteReason[]): string | null {
  if (why.length === 0) return null;
  return why.map((reason) => {
    const cites = reason.cites.length > 0 ? ` ${reason.cites.join(",")}` : "";
    return reason.basis || cites ? `${reason.text} (${reason.basis ?? "unmarked"}${cites})` : reason.text;
  }).join("\n");
}

const REASONS_COLUMN_MAX = 2_000;

function requireReasonsFit(why: NoteReason[]): string | null {
  const text = reasonsText(why);
  if (text !== null && text.length > REASONS_COLUMN_MAX) {
    throw new CollabError("too_long", `The reasons together are ${text.length} characters; at most ${REASONS_COLUMN_MAX} here`, {
      field: "why",
      max: REASONS_COLUMN_MAX,
      actual: text.length,
      unit: "chars",
      remedy: { say: "Shorten the reasons: a review or a completion keeps them together in at most 2,000 characters." },
    });
  }
  return text;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * One step under a derived key: its recorded response when the step already
 * finished, else the write. Besides a retry, the receipt can come from an
 * identical call in flight at the same time, which planned the same key and
 * wrote this step first; that is the same step of the same call, so it is
 * replayed. A write that loses that race in another process meets the
 * receipt as idempotency_conflict (the version it read is older), and the
 * receipt is replayed then too: the caller's call was not wrong.
 */
async function stepOnce<T>(
  ctx: NoteVerbContext,
  credential: Credential,
  key: string,
  write: () => T | Promise<T>,
): Promise<{ value: T; replayed: boolean }> {
  const earlier = replayReceipt<T>(ctx.store, credential, key);
  if (earlier) return { value: earlier, replayed: true };
  try {
    return { value: await write(), replayed: false };
  } catch (error) {
    if (!(error instanceof CollabError) || error.code !== "idempotency_conflict") throw error;
    const written = replayReceipt<T>(ctx.store, credential, key);
    if (written) return { value: written, replayed: true };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Evidence (spec 5.3): hashed and checked before any write transaction

interface ResolvedEvidence {
  /** The Evidence lines as stored: journal handles replaced by full ids, a hashed file named by the path that was hashed. */
  lines: string[];
  /**
   * The lines as the caller wrote them, journal handles replaced by full ids:
   * what a derived key hashes, so whether a file could be hashed this time
   * never changes the key of a retry.
   */
  key_lines: string[];
  /** Outside items, by Evidence position. */
  items: NoteCitedItem[];
  /** Journal pointers for evidence_refs, full ids. */
  journal: string[];
  advice: string[];
}

const COMMIT_CHECK_BUDGET_MS = 5_000;

/**
 * Read each Evidence line: journal pointers resolve to full ids (handles
 * too), outside pointers become cited items. A file inside the session's
 * worktree is hashed by the server; one outside it, behind a symbolic link,
 * over 16 MiB or not found is kept as the caller wrote it, unhashed, and the
 * advice says why. A commit is checked with git. Nothing else is fetched or
 * rerun. Contents are never kept.
 */
function resolveEvidence(ctx: NoteVerbContext, binding: NoteBinding, lines: string[]): ResolvedEvidence {
  const workspaceId = binding.handle.workspace.id;
  const root = binding.handle.worktree.root_path;
  const out: ResolvedEvidence = { lines: [], key_lines: [], items: [], journal: [], advice: [] };
  const deadline = performance.now() + COMMIT_CHECK_BUDGET_MS;
  lines.forEach((line, index) => {
    const n = index + 1;
    let evidence;
    try {
      evidence = parseEvidence(line);
    } catch (error) {
      if (!(error instanceof CollabError)) throw error;
      throw new CollabError("invalid_evidence", `Evidence ${n}: ${error.message}`, {
        field: `evidence[${index}]`,
        remedy: { say: `Write evidence ${n} in one of the evidence forms; nothing was written.` },
      });
    }
    if ((NOTE_JOURNAL_EVIDENCE_KINDS as readonly string[]).includes(evidence.kind)) {
      let ref = `${evidence.kind}:${evidence.locator}`;
      if (evidence.kind === "report") {
        // A handle (report#…, proposal#…) is resolved now, so the record never names an item by guess later.
        const value = evidence.locator.includes("#") ? evidence.locator : `report:${evidence.locator}`;
        ref = `report:${ctx.store.resolveNoteRef(workspaceId, "report", value).id}`;
      }
      out.lines.push(ref);
      out.key_lines.push(ref);
      out.journal.push(ref);
      return;
    }
    out.key_lines.push(line);
    const kind = evidence.kind as NoteCitedItem["kind"];
    if (kind === "file") {
      const { path, from, to } = fileLocatorParts(evidence.locator);
      const lineRange = from === null ? undefined : to !== null && to !== from ? `${from}-${to}` : `${from}`;
      const hashed = existsSync(root) ? hashWorktreeFile(root, path) : { status: "unreadable" as const, path: null };
      if (hashed.status === "hashed") {
        // The line names the path that was hashed (./src/a.ts or an absolute
        // path inside the worktree becomes src/a.ts), so a reader pairs the
        // line with its observation by what it points at, not by position alone.
        const stored = hashed.path === path
          ? line
          : renderEvidence({ kind: "file", locator: `${hashed.path}${evidence.locator.slice(path.length)}`, attrs: evidence.attrs });
        if (stored !== line) out.advice.push(`Evidence ${n} is recorded as "${stored}": the file's path in your worktree.`);
        out.lines.push(stored);
        out.items.push({ n, kind, locator: hashed.path, sha256: hashed.sha256, ...(lineRange ? { lines: lineRange } : {}), observed: "server" });
        const claimed = evidence.attrs.sha256?.toLowerCase();
        if (claimed && claimed !== hashed.sha256) {
          out.advice.push(`Evidence ${n} (file ${path}) says sha256=${claimed}, but the file in your worktree hashes to ${hashed.sha256} now; the server's hash is the one recorded as observed.`);
        }
        return;
      }
      out.lines.push(line);
      const why = {
        outside: "is outside your worktree",
        symlink: "reaches through a symbolic link",
        too_large: `is over ${MAX_CITED_FILE_BYTES / (1024 * 1024)} MiB`,
        missing: "was not found in your worktree",
        not_a_file: "is not a regular file",
        unreadable: "could not be read",
        changed_while_read: "changed while it was being hashed",
      }[hashed.status];
      out.items.push({
        n,
        kind,
        locator: path,
        ...(evidence.attrs.sha256 ? { sha256: evidence.attrs.sha256.toLowerCase() } : {}),
        ...(lineRange ? { lines: lineRange } : {}),
        observed: "caller",
      });
      out.advice.push(`Evidence ${n} (file ${path}) ${why}, so it was recorded as you wrote it, unhashed (observed: caller).`);
      return;
    }
    out.lines.push(line);
    if (kind === "commit") {
      const exists = binding.handle.worktree.git_common_dir_hash === null
        ? null
        : gitCommitExists(root, evidence.locator, { deadline, now: () => performance.now() });
      if (exists === true) {
        out.items.push({ n, kind, locator: evidence.locator, observed: "server" });
      } else if (exists === false) {
        out.items.push({ n, kind, locator: evidence.locator, observed: "not_found" });
        out.advice.push(`Evidence ${n}: git in your worktree has no commit ${evidence.locator}; it is recorded as not found.`);
      } else {
        out.items.push({ n, kind, locator: evidence.locator, observed: "caller" });
        out.advice.push(`Evidence ${n}: commit ${evidence.locator} could not be checked (no git here, or the time budget ran out); it is recorded as you wrote it.`);
      }
      return;
    }
    const exit = evidence.attrs.exit !== undefined ? Number(evidence.attrs.exit) : undefined;
    out.items.push({
      n,
      kind,
      locator: evidence.locator,
      ...(kind === "data" && evidence.attrs.sha256 ? { sha256: evidence.attrs.sha256.toLowerCase() } : {}),
      ...(kind === "test" && exit !== undefined && Number.isSafeInteger(exit) ? { exit } : {}),
      observed: "caller",
    });
  });
  return out;
}

/** How each Evidence line was observed, for a result. */
function evidenceSummary(resolved: ResolvedEvidence): Array<Record<string, unknown>> {
  const items = new Map(resolved.items.map((item) => [item.n, item]));
  return resolved.lines.map((line, index) => {
    const item = items.get(index + 1);
    return item
      ? { n: item.n, kind: item.kind, locator: item.locator, observed: item.observed, ...(item.sha256 && item.observed === "server" ? { sha256: item.sha256 } : {}) }
      : { n: index + 1, kind: line.slice(0, line.indexOf(":")), locator: line.slice(line.indexOf(":") + 1), observed: "journal" };
  });
}

// ---------------------------------------------------------------------------
// Addressees

interface Addressee {
  to_session_id: string | null;
  to_person: boolean;
  /** For the result: who it went to. */
  shown: { session: string; name: string } | "person" | "all";
  advice: string[];
}

const BROADCAST: Addressee = { to_session_id: null, to_person: false, shown: "all", advice: [] };

/** An explicit `to`: a session (by name, id or handle, ended ones included), person, or all. */
function explicitAddressee(ctx: NoteVerbContext, workspaceId: string, value: string): Addressee {
  if (value === "all") return BROADCAST;
  if (value === "person") return { to_session_id: null, to_person: true, shown: "person", advice: [] };
  // An active session first: a name reused after a restart then means the
  // session that answers to it now, and an ended one is named only when no
  // active session has it.
  let view;
  try {
    view = ctx.store.resolveNoteSession(workspaceId, value);
  } catch (error) {
    if (!(error instanceof CollabError) || error.code !== "session_not_found") throw error;
    view = ctx.store.resolveNoteSession(workspaceId, value, { include_ended: true });
  }
  return sessionAddressee(view.id, view.actor, view.status, view.liveness, view.last_seen_at);
}

function sessionAddressee(
  id: string,
  name: string,
  status: "active" | "ended",
  liveness: "live" | "stale",
  lastSeenAt: string,
): Addressee {
  const advice: string[] = [];
  // Sent all the same: the record is for whoever reads it later.
  if (status === "ended") advice.push(`${name} (${id}) has ended its session; the note is recorded and addressed to it all the same.`);
  else if (liveness === "stale") {
    advice.push(`${name} (${id}) was last seen at ${lastSeenAt}, over 6 hours ago; the note is recorded and addressed to it all the same.`);
  }
  return { to_session_id: id, to_person: false, shown: { session: id, name }, advice };
}

function authorAddressee(target: NoteTargetView, me: string): Addressee {
  const author = target.author;
  if (!author || author.id === me) return BROADCAST;
  return sessionAddressee(author.id, author.actor, author.status, author.liveness, author.last_seen_at);
}

function viewAddressee(ctx: NoteVerbContext, workspaceId: string, sessionId: string): Addressee {
  const view = ctx.store.resolveNoteSession(workspaceId, sessionId, { include_ended: true });
  return sessionAddressee(view.id, view.actor, view.status, view.liveness, view.last_seen_at);
}

// ---------------------------------------------------------------------------
// collab_note (spec 5.3)

export interface NoteVerbInput {
  text: string;
  act?: string;
  re?: string;
  to?: string;
  via?: string;
  why?: Array<{ text: string; basis?: string; cites?: number[] }>;
  evidence?: string[];
  limits?: string;
  extent?: string;
  outcome?: string;
  replaces?: string;
  dry_run?: boolean;
}

/** The acts collab_note records in this build. */
const NOTE_ACTS_HERE = [
  "note",
  "support",
  "challenge",
  "resolve",
  "withdraw",
  "accept",
  "request_changes",
  "relay_rejection",
] as const;
type NoteActHere = (typeof NOTE_ACTS_HERE)[number];

const STRUCTURED_FIELDS = ["re", "to", "via", "why", "evidence", "limits", "extent", "replaces"] as const;

type ReTarget =
  | { kind: "report"; id: string; label: "report" | "proposal" | "ballot"; view: NoteTargetView }
  | { kind: "task"; id: string; task: Task }
  | { kind: "event"; id: string }
  | { kind: "text"; ref: string };

/**
 * Read the call into note fields. A text that begins with a known act word
 * and ": " is a whole collab-note/1 note when act is absent, so the card's
 * form works as typed; structured fields fill what it leaves out, and a field
 * given both ways with different values is refused rather than guessed.
 */
function readNoteInput(input: NoteVerbInput): { fields: NoteFields; read_as: "collab-note/1" | null; advice: string[] } {
  if (typeof input.text !== "string" || !normalizeNoteText(input.text)) {
    throw new CollabError("invalid_text", "text is required: the statement on its first line, then any body", {
      remedy: { say: "Give text: what you put forward on its first line (at most 200 characters), then a blank line and any body." },
    });
  }
  if (input.act !== undefined && typeof input.act !== "string") throw new CollabError("invalid_act", "act must be text");
  const structured: Partial<NoteInput> = {
    re: input.re,
    to: input.to,
    via: input.via,
    why: input.why as NoteInput["why"],
    evidence: input.evidence,
    limits: input.limits,
    extent: input.extent,
    replaces: input.replaces,
  };
  const advice: string[] = [];
  const firstLine = normalizeNoteText(input.text).split("\n")[0] ?? "";
  const head = /^([A-Za-z_]+): /.exec(firstLine);
  const headAct = head && isNoteAct(head[1]!.toLowerCase()) ? head[1]!.toLowerCase() : null;
  if (input.act === undefined && headAct !== null) {
    const parsed = parseNote(input.text);
    advice.push(...parsed.advice);
    const { advice: _advice, ...noteFields } = parsed;
    const fields = normalizeNoteFields({ ...noteFields, act: parsed.act! } as NoteInput);
    const given = normalizeNoteFields({ act: fields.act, statement: fields.statement, ...structured } as NoteInput);
    for (const field of STRUCTURED_FIELDS) {
      const fromText = fields[field];
      const fromField = given[field];
      const empty = (value: unknown) => value === null || (Array.isArray(value) && value.length === 0);
      if (empty(fromField)) continue;
      if (empty(fromText)) {
        (fields as unknown as Record<string, unknown>)[field] = fromField;
      } else if (!sameValue(fromText, fromField)) {
        throw new CollabError("field_given_twice", `${field} is in the note text and in the call, with different values`, {
          field,
          remedy: { say: `Give ${field} once, in the note text or as a field.` },
        });
      }
    }
    return { fields, read_as: "collab-note/1", advice };
  }
  const act = (input.act ?? "note").trim().toLowerCase();
  if (input.act !== undefined && headAct !== null) {
    advice.push(`text begins with "${head![1]}: ", which stays in the statement because act was given.`);
  }
  const { statement, body } = splitNoteText(input.text);
  return {
    fields: normalizeNoteFields({ act: act as NoteAct, statement, body, ...structured } as NoteInput),
    read_as: null,
    advice,
  };
}

function requireActHere(ctx: NoteVerbContext, act: string, fields: NoteFields): asserts act is NoteActHere {
  if ((NOTE_ACTS_HERE as readonly string[]).includes(act)) return;
  const elsewhere: Partial<Record<string, NoteRemedy>> = {
    take: withSlot(ctx, { tool: "collab_take", input: { title: fields.statement } }),
    done: withSlot(ctx, { tool: "collab_done", input: { text: fields.statement } }),
  };
  if (elsewhere[act]) {
    throw new CollabError("wrong_verb", `${act} is its own verb, not a note act`, { remedy: elsewhere[act] });
  }
  if (["decide", "propose", "poll", "vote"].includes(act)) {
    throw new CollabError("act_not_built", `${act} is not built in this build yet; nothing was written`, {
      remedy: { say: `${act} arrives in a later build. Until then, say it as a note, which authorises nothing.` },
    });
  }
  throw new CollabError("invalid_act", `act must be one of ${NOTE_ACTS_HERE.join(", ")}`, {
    remedy: { say: `act is one of ${NOTE_ACTS_HERE.join(", ")}; leave it out for a plain note.` },
  });
}

function resolveRe(ctx: NoteVerbContext, workspaceId: string, value: string): ReTarget {
  const ref = parseNoteRef(value);
  if (!ref) {
    throw new CollabError("invalid_ref", `re ${JSON.stringify(value)} is not a reference collab can read`, {
      remedy: { say: "re is report#…, proposal#…, ballot#…, task#…, a full id, event:<id>, or file:, lobby: or msg: text." },
    });
  }
  if (ref.kind === "task") {
    const id = ctx.store.resolveNoteRef(workspaceId, "task", value).id;
    return { kind: "task", id, task: ctx.store.getTask(workspaceId, id) };
  }
  if (ref.kind === "report" || ref.kind === "proposal" || ref.kind === "ballot") {
    const id = ctx.store.resolveNoteRef(workspaceId, ref.kind, value).id;
    const view = ctx.store.noteTarget(workspaceId, id);
    return { kind: "report", id, label: view.termed ? "proposal" : view.ballot ? "ballot" : "report", view };
  }
  if (ref.kind === "event") return { kind: "event", id: ref.id };
  return { kind: "text", ref: value };
}

function reText(target: ReTarget): string {
  switch (target.kind) {
    case "report": return `${target.label}:${target.id}`;
    case "task": return `task:${target.id}`;
    case "event": return `event:${target.id}`;
    default: return target.ref;
  }
}

function targetHandle(target: Extract<ReTarget, { kind: "report" }>): string {
  return handleOf(target.label, target.id);
}

/** The caller's note call as a ready input, with any fields replaced (dry_run dropped). */
function noteRetryInput(input: NoteVerbInput, patch: Record<string, unknown> = {}): Record<string, unknown> {
  const { dry_run: _dry, ...rest } = input;
  return { ...rest, ...patch };
}

/** A ready call that sends the same note again with some fields replaced. */
function sameNoteWith(ctx: NoteVerbContext, input: NoteVerbInput, patch: Record<string, unknown>): NoteRemedy {
  return withSlot(ctx, { tool: "collab_note", input: noteRetryInput(input, patch) });
}

interface PlannedNote {
  act: NoteActHere;
  /** The act the stored note says, when it differs (an answer is a note). */
  recorded_as: "note" | "support" | "challenge" | "resolve" | "answer" | "withdraw" | "accept" | "request_changes" | "relay_rejection";
  fields: NoteFields;
  target: ReTarget | null;
  addressee: Addressee;
  /** Reports for appendNoteForSession (report-posting acts only). */
  reports: NoteReportInput[];
  entity: string;
  advice: string[];
  extra: Record<string, unknown>;
}

export async function noteVerb(ctx: NoteVerbContext, input: NoteVerbInput): Promise<Record<string, unknown>> {
  const { binding, credential } = requireCredential(ctx);
  const workspaceId = binding.handle.workspace.id;
  const me = credential.session_id;
  const read = readNoteInput(input);
  const advice = [...read.advice];
  let fields = read.fields;
  requireActHere(ctx, fields.act, fields);
  const act = fields.act as NoteActHere;
  if (input.dry_run !== undefined && typeof input.dry_run !== "boolean") {
    throw new CollabError("invalid_dry_run", "dry_run is true or false");
  }
  if (input.outcome !== undefined) advice.push("outcome applies to decide only, which this build does not record yet; it was not used.");

  // Via: the speaker is still this session, and what came by another
  // channel is hearsay to it, so seen and quoted reasons become told.
  if (fields.via) {
    const downgraded = fields.why.filter((reason) => reason.basis === "seen" || reason.basis === "quoted").length;
    if (downgraded > 0) {
      fields = { ...fields, why: fields.why.map((reason) =>
        reason.basis === "seen" || reason.basis === "quoted" ? { ...reason, basis: "told" } : reason) };
      advice.push(`The text came via ${fields.via}, so ${downgraded} seen or quoted reason(s) were recorded as told: you are its speaker, not its witness.`);
    }
  }

  // Shape and caps first, on what the caller wrote, so a bad call fails
  // before any read of the journal or the worktree.
  if (fields.re === null && act !== "note") {
    throw new CollabError("re_required", `${act} needs re: what it answers`, {
      remedy: { say: `Add re: the report it answers, as an id or a handle such as report#3fa91c.` },
    });
  }
  refuseNoteProblems(fields);

  const target = fields.re !== null ? resolveRe(ctx, workspaceId, fields.re) : null;
  const evidence = resolveEvidence(ctx, binding, fields.evidence);
  fields = { ...fields, evidence: evidence.lines, re: target ? reText(target) : null };
  let replacedId: string | null = null;
  if (fields.replaces !== null) {
    if (act !== "challenge") {
      throw new CollabError("replaces_not_supported", "replaces is for a challenge that replaces your earlier challenge", {
        remedy: { say: "To take back an earlier note, withdraw it (act withdraw, re: it), then say the new one." },
      });
    }
    replacedId = ctx.store.resolveNoteRef(workspaceId, "report", fields.replaces.includes("#") ? fields.replaces
      : fields.replaces.includes(":") ? fields.replaces : `report:${fields.replaces}`).id;
    fields = { ...fields, replaces: `report:${replacedId}` };
  }

  // The derived key hashes the call as the caller sent it, normalised (spec
  // 5), and nothing the call reads to plan its writes: an addressee worked
  // out from the journal (the target's author, a task's holder, the latest
  // challenger, the session a name answers to now) can change between a
  // lost response and its retry, and the retry must still find its receipt.
  const keyInput = {
    act,
    fields: { ...fields, evidence: evidence.key_lines, to: keyAddressee(ctx, workspaceId, fields.to) },
  };
  const plan = (): { planned: PlannedNote; note: string } => {
    const planned = planNote(ctx, input, { act, fields, target, me, workspaceId, replacedId, evidence });
    // The final note, with full ids, is checked again before anything is written.
    refuseNoteProblems(planned.fields);
    return { planned, note: renderNote(planned.fields) };
  };
  const planAdvice = (planned: PlannedNote) => [...evidence.advice, ...planned.advice, ...planned.addressee.advice];

  // A verdict and a relayed no address no one by state, so they plan first;
  // their own paths decide what a retry replays.
  if (input.dry_run === true || act === "accept" || act === "request_changes" || act === "relay_rejection") {
    const { planned, note } = plan();
    advice.push(...planAdvice(planned));
    if (input.dry_run === true) return dryRunResult({ planned, note, advice, evidence, read_as: read.read_as });
    return act === "relay_rejection"
      ? relayNote(ctx, credential, { planned, note, keyInput, advice, read_as: read.read_as, input })
      : reviewNote(ctx, binding, credential, { planned, evidence, note, keyInput, advice, read_as: read.read_as, input });
  }

  const cite = evidence.items.length > 0 ? { worktree_id: binding.handle.worktree.id, items: evidence.items } : null;
  const { plan: receiptPlan, receipt, fresh } = await underPlan(ctx, credential, {
    tool: "collab_note",
    input: keyInput,
    entity: noteEntity(ctx, input, act, target),
    retry_input: noteRetryInput(input),
    // The earlier note is current while it still stands: a challenge
    // withdrawn or lifted and then made again is a new objection, not a retry.
    stillCurrent: (latestKey) => {
      const found = replayReceipt<NoteAppendReceipt>(ctx.store, credential, latestKey);
      return !found || ctx.store.noteReportStands(workspaceId, found.reports[0]!.id);
    },
  }, async (receiptPlan) => {
    // Planning reads the journal (addressees, the replaced challenge), so it
    // runs only when the call acts; a replay reports what was recorded.
    let fresh: { planned: PlannedNote; note: string } | null = null;
    const step = await stepOnce(ctx, credential, receiptPlan.key, () => {
      fresh = plan();
      return ctx.store.appendNoteForSession({
        ...credential,
        idempotency_key: receiptPlan.key,
        cite,
        reports: fresh.planned.reports,
        receipt_plan: receiptPlan.guard,
      });
    });
    // A plan made but not written (an identical call wrote first) is not what was recorded.
    return { plan: receiptPlan, receipt: step.value, fresh: step.replayed ? null : fresh as { planned: PlannedNote; note: string } | null };
  });
  if (fresh) {
    advice.push(...planAdvice(fresh.planned));
    return noteResult(ctx, { planned: fresh.planned, receipt, replayed: false, note: fresh.note, advice, read_as: read.read_as, evidence });
  }
  if (receiptPlan.retry) {
    advice.push("This repeats your latest act on this entity exactly, so it was read as a retry. Add a word to say it again.");
  }
  const replayed = replayedNote(ctx, workspaceId, { act, fields, target, receipt, to: keyInput.fields.to });
  return noteResult(ctx, { ...replayed, receipt, replayed: true, advice, read_as: read.read_as });
}

/**
 * An explicit `to` as the derived key hashes it: all, person and a name as
 * written (the session a name answers to can change), a handle as the id it
 * names, so either spelling of one session is the same call.
 */
function keyAddressee(ctx: NoteVerbContext, workspaceId: string, value: string | null): string | null {
  if (value === null) return null;
  const text = value.trim();
  if (/^session#[0-9a-fA-F]{6,32}$/.test(text)) {
    return ctx.store.resolveNoteSession(workspaceId, text, { include_ended: true }).id;
  }
  return text;
}

const REPORT_TARGET_REASONS: Partial<Record<NoteActHere, string>> = {
  support: "to stand on a task's work, name its completion report",
  challenge: "to stand on a task's work, name its completion report",
  resolve: "resolve names the challenge it lifts",
  withdraw: "withdraw names your own earlier report",
};

/** The report a stance, a resolve or a withdrawal answers; a task with a completion gets a ready call naming it. */
function requireReportTarget(
  ctx: NoteVerbContext,
  input: NoteVerbInput,
  act: NoteActHere,
  target: ReTarget | null,
): Extract<ReTarget, { kind: "report" }> {
  if (target?.kind === "report") return target;
  const why = REPORT_TARGET_REASONS[act] ?? "name the report in re";
  if (target?.kind === "task" && target.task.completion_report_id) {
    throw new CollabError("re_must_be_report", `${act} answers a report; ${why}`, {
      remedy: sameNoteWith(ctx, input, { re: exactRef("report", target.task.completion_report_id) }),
    });
  }
  throw new CollabError("re_must_be_report", `${act} answers a report; ${why}`, {
    remedy: { say: `Name the report in re, as an id or a handle such as report#3fa91c.` },
  });
}

/** The entity a report-posting act's derived key names (spec 5): the target report, else the task, else "note". */
function noteEntity(ctx: NoteVerbContext, input: NoteVerbInput, act: NoteActHere, target: ReTarget | null): string {
  if (act !== "note") return requireReportTarget(ctx, input, act, target).id;
  if (target?.kind === "report" || target?.kind === "task") return target.id;
  return "note";
}

/**
 * What a replayed note reports, from its receipt and the call: the act it
 * was recorded as and the addressee it was sent to then, whoever the same
 * call would address now.
 */
function replayedNote(
  ctx: NoteVerbContext,
  workspaceId: string,
  context: { act: NoteActHere; fields: NoteFields; target: ReTarget | null; receipt: NoteAppendReceipt; to: string | null },
): { planned: PlannedNote; note: string; evidence: ResolvedEvidence } {
  const main = context.receipt.reports[0]!;
  const recordedAs: PlannedNote["recorded_as"] = main.relation === "informs"
    ? (context.act === "resolve" ? "answer" : "note")
    : ({ supports: "support", challenges: "challenge", resolves: "resolve", withdraws: "withdraw" } as const)[
      main.relation as "supports" | "challenges" | "resolves" | "withdraws"
    ];
  let addressee: Addressee = BROADCAST;
  if (main.to_session_id) {
    const view = safeSession(ctx, workspaceId, main.to_session_id);
    addressee = { to_session_id: main.to_session_id, to_person: false, shown: { session: main.to_session_id, name: view?.actor ?? main.to_session_id }, advice: [] };
  } else if (context.to === "person") {
    addressee = { to_session_id: null, to_person: true, shown: "person", advice: [] };
  }
  const extra: Record<string, unknown> = {};
  if ((context.act === "support" || context.act === "challenge") && context.fields.why.length === 0 && context.fields.evidence.length === 0) {
    extra.ungrounded = true;
  }
  if (recordedAs === "answer") extra.recorded_as_answer = true;
  // The stored body is the note that was returned, byte for byte.
  const stored = parseNote(main.body);
  return {
    planned: {
      act: context.act,
      recorded_as: recordedAs,
      fields: context.fields,
      target: context.target,
      addressee,
      reports: [],
      entity: "",
      advice: [],
      extra,
    },
    note: main.body,
    evidence: { lines: stored.evidence, key_lines: [], items: context.receipt.cite?.items ?? [], journal: [], advice: [] },
  };
}

function dryRunResult(options: {
  planned: PlannedNote;
  note: string;
  advice: string[];
  evidence: ResolvedEvidence;
  read_as: string | null;
}): Record<string, unknown> {
  const { planned, evidence } = options;
  return {
    ok: true,
    dry_run: true,
    effect: "Dry run: nothing was written.",
    act: planned.act,
    recorded_as: planned.recorded_as,
    ...(options.read_as ? { read_as: options.read_as } : {}),
    parsed: planned.fields,
    would: {
      reports: planned.reports.map((report) => ({
        relation: report.relation,
        kind: report.kind,
        target: report.target_report_id ?? null,
        task: report.task_id ?? null,
        to: report.to_session_id ?? (report.to_person ? "person" : null),
        about_proposal: report.about_proposal_id ?? null,
      })),
      cites: evidence.items.length > 0 ? 1 : 0,
    },
    to: planned.addressee.shown,
    evidence: evidenceSummary(evidence),
    authorises: "Nothing. This is coordination state.",
    advice: options.advice,
    note: options.note,
    ...planned.extra,
  };
}

function planNote(
  ctx: NoteVerbContext,
  input: NoteVerbInput,
  context: {
    act: NoteActHere;
    fields: NoteFields;
    target: ReTarget | null;
    me: string;
    workspaceId: string;
    replacedId: string | null;
    evidence: ResolvedEvidence;
  },
): PlannedNote {
  const { act, target, me, workspaceId, evidence } = context;
  let fields = context.fields;
  const advice: string[] = [];
  const extra: Record<string, unknown> = {};
  const hasCite = evidence.items.length > 0;
  const explicit = fields.to !== null
    ? explicitAddressee(ctx, workspaceId, fields.to)
    : null;
  const reportTarget = target?.kind === "report" ? target : null;
  const base = (relation: NoteReportInput["relation"], extraRefs: string[] = []): NoteReportInput => ({
    kind: noteKind(fields.why),
    relation,
    body: "",
    evidence_refs: [...evidence.journal, ...extraRefs],
    cite_event: hasCite,
  });

  // Advice, never refusals (spec 5.3).
  const grounded = fields.why.length > 0 || fields.evidence.length > 0;
  if ((act === "support" || act === "challenge") && !grounded) {
    advice.push(`ungrounded: this ${act} gives no reason and no evidence. It is recorded; a reason someone could check carries more weight.`);
    extra.ungrounded = true;
  }
  seenOverRelayed(ctx, workspaceId, me, fields, advice);

  const finish = (planned: Omit<PlannedNote, "act" | "advice" | "extra" | "fields"> & { fields?: NoteFields }): PlannedNote => {
    const finalFields = planned.fields ?? fields;
    const body = renderNote(finalFields);
    const reports = planned.reports.map((report, index) => (index === 0 && report.body === "" ? { ...report, body } : report));
    return { act, fields: finalFields, advice, extra, ...planned, reports };
  };

  switch (act) {
    case "note": {
      const report = base("informs");
      let addressee = BROADCAST;
      if (reportTarget) {
        report.evidence_refs!.push(`report:${reportTarget.id}`);
        report.task_id = reportTarget.view.report.task_id;
        if (reportTarget.view.termed) report.about_proposal_id = reportTarget.id;
        addressee = authorAddressee(reportTarget.view, me);
      } else if (target?.kind === "task") {
        report.task_id = target.id;
        const holder = target.task.assignee_session_id ?? target.task.reported_by_session_id;
        if (holder && holder !== me) {
          addressee = viewAddressee(ctx, workspaceId, holder);
        }
      } else if (target?.kind === "event") {
        report.evidence_refs!.push(`event:${target.id}`);
      }
      addressee = explicit ?? addressee;
      report.to_session_id = addressee.to_session_id;
      report.to_person = addressee.to_person;
      return finish({
        recorded_as: "note",
        target,
        addressee,
        reports: [report],
        entity: reportTarget?.id ?? (target?.kind === "task" ? target.id : "note"),
      });
    }
    case "support":
    case "challenge": {
      const reportTarget = requireReportTarget(ctx, input, act, target);
      const view = reportTarget.view;
      const report = base(act === "support" ? "supports" : "challenges");
      report.target_report_id = reportTarget.id;
      report.task_id = view.report.task_id;
      if (view.termed) report.about_proposal_id = reportTarget.id;
      const addressee = explicit ?? authorAddressee(view, me);
      report.to_session_id = addressee.to_session_id;
      report.to_person = addressee.to_person;
      if (view.completion_of?.pending_review) {
        advice.push("This is recorded as a stance, not a review; to review the work, use act accept or request_changes.");
      }
      if (act === "support" && view.ballot?.open) {
        advice.push("This is public and unsealed; to vote, use collab_vote.");
      }
      if (view.author?.id === me) advice.push(`You wrote ${targetHandle(reportTarget)}; standing on your own report adds no second voice.`);
      if (view.obsoleted) advice.push(`${targetHandle(reportTarget)} was withdrawn or replaced by its author; your ${act} is recorded on it all the same.`);
      if (act === "challenge" && context.replacedId) {
        return finish({
          recorded_as: "challenge",
          target,
          addressee,
          reports: [report, replacedChallenge(ctx, workspaceId, me, context.replacedId, reportTarget.id)],
          entity: reportTarget.id,
        });
      }
      return finish({ recorded_as: act, target, addressee, reports: [report], entity: reportTarget.id });
    }
    case "resolve": {
      const challenge = requireReportTarget(ctx, input, act, target);
      if (challenge.view.report.relation !== "challenges") {
        throw new CollabError("not_a_challenge", `${targetHandle(challenge)} is not a challenge; resolve lifts a challenge`, {
          remedy: { say: "To answer a report, post a note with re; to lift your own challenge, resolve names that challenge." },
        });
      }
      const challenger = challenge.view.author;
      const myVoice = ctx.store.consentVoiceOf(me);
      const challenged = ctx.store.noteTarget(workspaceId, challenge.view.report.target_report_id!);
      if (challenger && challenger.voice_id === myVoice) {
        const report = base("resolves");
        report.target_report_id = challenge.id;
        report.task_id = challenge.view.report.task_id;
        const addressee = explicit ?? authorAddressee(challenged, me);
        report.to_session_id = addressee.to_session_id;
        report.to_person = addressee.to_person;
        if (challenge.view.obsoleted) advice.push(`${targetHandle(challenge)} was already withdrawn; the resolve is recorded all the same.`);
        return finish({ recorded_as: "resolve", target, addressee, reports: [report], entity: challenge.id });
      }
      // Principle 4: an objection someone else can clear is not an objection.
      // Anyone else's reply is recorded as an answer, sent to the challenger.
      fields = { ...fields, act: "note" };
      const report = base("informs", [`report:${challenge.id}`]);
      report.task_id = challenge.view.report.task_id;
      const addressee = explicit ?? (challenger
        ? sessionAddressee(challenger.id, challenger.actor, challenger.status, challenger.liveness, challenger.last_seen_at)
        : BROADCAST);
      report.to_session_id = addressee.to_session_id;
      report.to_person = addressee.to_person;
      advice.push(
        "Only the challenger can lift a challenge; your answer was sent to them" +
          (challenger ? ` (challenger voice ${challenger.voice_id}; yours is ${myVoice}).` : "."),
      );
      extra.recorded_as_answer = true;
      return finish({ recorded_as: "answer", target, addressee, reports: [report], entity: challenge.id, fields });
    }
    case "withdraw": {
      const withdrawn = requireReportTarget(ctx, input, act, target);
      if (withdrawn.view.report.from_session_id !== me) {
        throw new CollabError(
          "not_your_report",
          `${targetHandle(withdrawn)} was written by another session, and only its author session withdraws it`,
          {
            remedy: withSlot(ctx, {
              tool: "collab_note",
              input: { act: "note", text: "I no longer stand by this.", re: exactRef("report", withdrawn.id) },
            }),
          },
        );
      }
      const report = base("withdraws");
      report.target_report_id = withdrawn.id;
      report.task_id = withdrawn.view.report.task_id;
      // The objectors are the ones the withdrawal answers; the latest standing one hears it.
      const objectors = withdrawn.view.challenges.filter((challenge) => challenge.standing && challenge.from_session_id && challenge.from_session_id !== me);
      const latest = objectors.at(-1);
      let addressee = BROADCAST;
      if (latest) {
        addressee = viewAddressee(ctx, workspaceId, latest.from_session_id!);
      }
      addressee = explicit ?? addressee;
      report.to_session_id = addressee.to_session_id;
      report.to_person = addressee.to_person;
      const others = [...new Map(objectors
        .filter((challenge) => challenge.from_session_id !== addressee.to_session_id)
        .map((challenge) => [challenge.from_session_id!, challenge])).values()];
      if (others.length > 0) {
        extra.also_challenged_by = others.map((challenge) => ({
          session: challenge.from_session_id,
          name: challenge.from_actor,
          next: withSlot(ctx, {
            tool: "collab_note",
            input: {
              text: `I withdrew ${exactRef("report", withdrawn.id)}.`,
              re: exactRef("report", challenge.id),
              to: challenge.from_session_id,
            },
          }),
        }));
        advice.push(`${others.length} other session(s) also stand against it; also_challenged_by has a ready note for each.`);
      }
      if (withdrawn.view.obsoleted) advice.push(`${targetHandle(withdrawn)} was already withdrawn or replaced; this is recorded all the same.`);
      return finish({ recorded_as: "withdraw", target, addressee, reports: [report], entity: withdrawn.id });
    }
    case "accept":
    case "request_changes": {
      const completion = reviewTarget(ctx, input, target, workspaceId, me);
      if (explicit) advice.push("A verdict goes to the session that reported the work; to was not used.");
      extra.review = completion;
      return finish({ recorded_as: act, target, addressee: BROADCAST, reports: [], entity: completion.completion_id });
    }
    case "relay_rejection": {
      if (!reportTarget || !reportTarget.view.termed) {
        throw new CollabError("not_a_proposal", "relay_rejection names the proposal the person said no to", {
          remedy: { say: "Name the proposal in re (proposal#… or its id). A relayed no can only stop work." },
        });
      }
      const unstored = (["why", "evidence", "limits", "extent", "via", "to"] as const).filter((field) => {
        const value = fields[field];
        return Array.isArray(value) ? value.length > 0 : value !== null;
      });
      if (unstored.length > 0) {
        const { dry_run: _dry, ...rest } = input;
        const cleaned = Object.fromEntries(Object.entries(rest).filter(([key]) => !(unstored as readonly string[]).includes(key)));
        throw new CollabError(
          "not_stored",
          `A relayed rejection keeps only its reason (the text); ${unstored.join(", ")} would not be stored`,
          {
            fields: unstored,
            remedy: textIsNote(input)
              ? { say: `Remove ${unstored.join(", ")} from the note text; post them in a separate note if they matter.` }
              : withSlot(ctx, { tool: "collab_note", input: cleaned }),
          },
        );
      }
      return finish({ recorded_as: "relay_rejection", target, addressee: BROADCAST, reports: [], entity: reportTarget.id });
    }
  }
}

/** Whether this call's text is read as a whole note (so its fields live in the text). */
function textIsNote(input: NoteVerbInput): boolean {
  if (input.act !== undefined || typeof input.text !== "string") return false;
  const head = /^([A-Za-z_]+): /.exec(normalizeNoteText(input.text).split("\n")[0] ?? "");
  return head !== null && isNoteAct(head[1]!.toLowerCase());
}

/** The withdrawal of the challenge a new one replaces: posted second, in the same transaction. */
function replacedChallenge(
  ctx: NoteVerbContext,
  workspaceId: string,
  me: string,
  replacedId: string,
  targetId: string,
): NoteReportInput {
  const old = ctx.store.noteTarget(workspaceId, replacedId);
  if (old.report.relation !== "challenges" || old.report.from_session_id !== me) {
    throw new CollabError("replaces_not_yours", "replaces names a challenge this session wrote", {
      remedy: { say: "replaces is your own earlier challenge; to answer someone else's, post a note with re." },
    });
  }
  if (old.report.target_report_id !== targetId) {
    throw new CollabError("replaces_other_target", "The replaced challenge stands on a different report", {
      remedy: { say: "Replace a challenge only with one on the same report; otherwise post the new challenge and withdraw the old one." },
    });
  }
  if (old.obsoleted) {
    throw new CollabError("replaces_withdrawn", "The challenge it replaces was already withdrawn", {
      remedy: { say: "Leave replaces out: there is no standing challenge of yours to replace." },
    });
  }
  return {
    kind: "inference",
    relation: "withdraws",
    body: renderNote({ act: "withdraw", statement: "Replaced by my newer challenge, posted just before this.", re: `report:${replacedId}` }),
    target_report_id: replacedId,
    task_id: old.report.task_id,
    evidence_refs: [],
    cite_earlier: [0],
  };
}

/** A `seen` reason whose only cites are other sessions' reports is hearsay to this one (spec 5.3 advice). */
function seenOverRelayed(ctx: NoteVerbContext, workspaceId: string, me: string, fields: NoteFields, advice: string[]): void {
  for (const [index, reason] of fields.why.entries()) {
    if (reason.basis !== "seen" || reason.cites.length === 0) continue;
    const cited = reason.cites.map((cite) => fields.evidence[cite - 1] ?? "");
    if (!cited.every((line) => line.startsWith("report:"))) continue;
    const others = cited.every((line) => {
      try {
        return ctx.store.noteTarget(workspaceId, line.slice("report:".length)).report.from_session_id !== me;
      } catch {
        return false;
      }
    });
    if (others) advice.push(`Why ${index + 1}: seen over a relayed source reads as told; it cites only another session's report.`);
  }
}

interface ReviewPin {
  task_id: string;
  completion_id: string;
}

/**
 * The completion a verdict lands on (spec 5): the one the reviewer names, or
 * for a task id, its current completion only when collab_inbox returned that
 * completion to this session. Otherwise changed_under_you, with the current
 * completion named in the remedy so the reviewer pins what it now sees.
 */
function reviewTarget(
  ctx: NoteVerbContext,
  input: NoteVerbInput,
  target: ReTarget | null,
  workspaceId: string,
  me: string,
): ReviewPin {
  if (target?.kind === "report") {
    const completion = target.view.completion_of;
    if (!completion) {
      throw new CollabError("not_a_completion", `${targetHandle(target)} is not a task's completion report`, {
        remedy: { say: "Name the completion report you inspected, or the task, in re." },
      });
    }
    if (!completion.current) {
      const task = ctx.store.getTask(workspaceId, completion.task_id);
      throw changedUnderYou(ctx, {
        tool: "collab_note",
        input: noteRetryInput(input, { re: task.completion_report_id ? exactRef("report", task.completion_report_id) : exactRef("task", task.id) }),
      }, reviewState(task));
    }
    return { task_id: completion.task_id, completion_id: target.id };
  }
  if (target?.kind === "task") {
    const task = target.task;
    if (!task.completion_report_id) {
      throw new CollabError("nothing_to_review", `${handleOf("task", task.id)} has no completion to review`, {
        remedy: { say: "Wait until its holder reports it done; collab_inbox tells you when a review is asked of you." },
      });
    }
    if (ctx.store.noteShownAt(workspaceId, me, task.completion_report_id) === null) {
      throw changedUnderYou(ctx, {
        tool: "collab_note",
        input: noteRetryInput(input, { re: exactRef("report", task.completion_report_id) }),
      }, reviewState(task));
    }
    return { task_id: task.id, completion_id: task.completion_report_id };
  }
  throw new CollabError("re_must_be_report", "accept and request_changes name the completion report you inspected, or its task", {
    remedy: { say: "Name the completion report (report#…) or the task (task#…) in re." },
  });
}

function reviewState(task: Task): Record<string, unknown> {
  return {
    task: { id: task.id, handle: handleOf("task", task.id), title: task.title, state: task.effective_status, review_status: task.review_status },
    completion: task.completion_report_id
      ? { id: task.completion_report_id, handle: handleOf("report", task.completion_report_id), by: task.reported_by, at: task.reported_at }
      : null,
  };
}

function noteResult(
  ctx: NoteVerbContext,
  options: {
    planned: PlannedNote;
    receipt: NoteAppendReceipt;
    replayed: boolean;
    note: string;
    advice: string[];
    read_as: string | null;
    evidence: ResolvedEvidence;
  },
): Record<string, unknown> {
  const { planned, receipt } = options;
  const main = receipt.reports[0]!;
  const handle = handleOf("report", main.id);
  const on = planned.target?.kind === "report" ? targetHandle(planned.target) : planned.target?.kind === "task" ? handleOf("task", planned.target.id) : null;
  const to = planned.addressee.shown;
  const toText = to === "all" ? "" : to === "person" ? " for the person" : ` to ${to.name}`;
  const effect = {
    note: `Recorded note ${handle}${on ? ` on ${on}` : ""}${toText}.`,
    support: `Recorded your support of ${on} as ${handle}${toText}. Support is a position, not a permission.`,
    challenge: receipt.reports.length === 2
      ? `Recorded your challenge to ${on} as ${handle}${toText}; it replaces your challenge ${handleOf("report", receipt.reports[1]!.target_report_id!)}, ` +
        "withdrawn in the same transaction after the new one was posted, so your objection stood throughout. It stands until you lift it."
      : `Recorded your challenge to ${on} as ${handle}${toText}; it stands until you lift it.`,
    resolve: `Lifted your challenge ${on} with ${handle}${toText}.`,
    answer: `Recorded your answer to ${on} as note ${handle}${toText}; it does not lift the challenge, which only its challenger can do.`,
    withdraw: `Withdrew your ${on} with ${handle}${toText}.`,
  }[planned.recorded_as as "note" | "support" | "challenge" | "resolve" | "answer" | "withdraw"];
  const ids: Record<string, unknown> = { report: main.id, report_handle: handle };
  if (receipt.reports.length === 2) ids.withdrawal = { report: receipt.reports[1]!.id, report_handle: handleOf("report", receipt.reports[1]!.id) };
  if (receipt.cite) ids.evidence_cited = { event: receipt.cite.event_id, cite: receipt.cite.cite_id };
  const nextAbout = planned.target?.kind === "report" ? exactRef("report", planned.target.id) : exactRef("report", main.id);
  return {
    ...noteWriteResult({
      effect,
      ids,
      advice: options.advice,
      next: withSlot(ctx, { tool: "collab_inbox", input: { about: nextAbout } }),
      note: options.note,
      replayed: options.replayed,
    }),
    act: planned.act,
    recorded_as: planned.recorded_as,
    ...(options.read_as ? { read_as: options.read_as } : {}),
    to,
    evidence: evidenceSummary(options.evidence),
    ...planned.extra,
  };
}

async function reviewNote(
  ctx: NoteVerbContext,
  binding: NoteBinding,
  credential: Credential,
  options: {
    planned: PlannedNote;
    evidence: ResolvedEvidence;
    note: string;
    keyInput: Record<string, unknown>;
    advice: string[];
    read_as: string | null;
    input: NoteVerbInput;
  },
): Promise<Record<string, unknown>> {
  const { planned, evidence, advice } = options;
  const workspaceId = binding.handle.workspace.id;
  const pin = planned.extra.review as ReviewPin;
  const fields = planned.fields;
  // The summary is the note without its Evidence lines: the reviewer's
  // evidence is cited in the step before, and its event id joins evidence_refs.
  const summary = renderNote(fields, { omitEvidence: true });
  const confidenceBasis = requireReasonsFit(fields.why);
  const retryInput = noteRetryInput(options.input);
  const outcome = planned.act === "accept" ? "accept" : "request_changes";
  const { plan, cite, review, replayed } = await underPlan(ctx, credential, {
    tool: "collab_note",
    input: options.keyInput,
    entity: pin.completion_id,
    retry_input: retryInput,
    stillCurrent: () => ctx.store.getTask(workspaceId, pin.task_id).completion_report_id === pin.completion_id,
  }, async (plan) => {
    let replays = 0;
    let steps = 0;
    let cite: NoteCiteReceipt | null = null;
    if (evidence.items.length > 0) {
      steps += 1;
      const cited = await stepOnce(ctx, credential, plan.step(1), () => ctx.store.citeEvidenceForSession({
        ...credential,
        idempotency_key: plan.step(1),
        worktree_id: binding.handle.worktree.id,
        items: evidence.items,
        receipt_plan: plan.guard,
      }));
      if (cited.replayed) replays += 1;
      cite = cited.value;
    }
    steps += 1;
    const reviewed = await stepOnce(ctx, credential, plan.step(2), () => withCurrentVersion(ctx, { tool: "collab_note", input: retryInput }, () => {
      const task = ctx.store.getTask(workspaceId, pin.task_id);
      // The verdict lands only on the completion the reviewer named.
      if (task.completion_report_id !== pin.completion_id) {
        throw changedUnderYou(ctx, {
          tool: "collab_note",
          input: { ...retryInput, re: task.completion_report_id ? exactRef("report", task.completion_report_id) : exactRef("task", task.id) },
        }, reviewState(task));
      }
      return { version: task.version, state: reviewState(task) };
    }, (version) => ctx.store.withReceiptPlan(plan.guard, () => ctx.store.reviewTaskForSession({
      ...credential,
      idempotency_key: plan.step(2),
      task_id: pin.task_id,
      expected_version: version,
      outcome,
      summary,
      evidence_refs: [...evidence.journal, ...(cite ? [`event:${cite.event_id}`] : [])],
      ...(confidenceBasis ? { confidence_basis: confidenceBasis } : {}),
      ...(fields.limits ? { limits: fields.limits } : {}),
    })) as { task: Task; review: unknown; report: CollabReport }));
    if (reviewed.replayed) replays += 1;
    return { plan, cite, review: reviewed.value, replayed: replays === steps };
  }).catch((error) => {
    throw reviewRefusal(ctx, error);
  });
  if (plan.retry && replayed) {
    advice.push("This repeats your latest verdict on this completion exactly, so it was read as a retry. Add a word to say it again.");
  }
  const taskHandle = handleOf("task", pin.task_id);
  const completionHandle = handleOf("report", pin.completion_id);
  return {
    ...noteWriteResult({
      effect: outcome === "accept"
        ? `Accepted the completion ${completionHandle} of ${taskHandle} as ${handleOf("report", review.report.id)}; your verdict covers only what you checked.`
        : `Requested changes on the completion ${completionHandle} of ${taskHandle} as ${handleOf("report", review.report.id)}; the task is open again for its holder to take.`,
      ids: {
        task: pin.task_id,
        task_handle: taskHandle,
        completion: pin.completion_id,
        review_report: review.report.id,
        review_report_handle: handleOf("report", review.report.id),
        ...(cite ? { evidence_cited: { event: cite.event_id, cite: cite.cite_id } } : {}),
      },
      advice,
      next: withSlot(ctx, { tool: "collab_inbox", input: { about: exactRef("task", pin.task_id) } }),
      note: options.note,
      replayed,
    }),
    act: planned.act,
    recorded_as: planned.recorded_as,
    ...(options.read_as ? { read_as: options.read_as } : {}),
    evidence: evidenceSummary(evidence),
  };
}

/** Store refusals of a review, each with what to do instead. */
function reviewRefusal(ctx: NoteVerbContext, error: unknown): unknown {
  if (!(error instanceof CollabError)) return error;
  const say: Record<string, string> = {
    self_review_forbidden: "A distinct session must review the work it did not report; ask another session with a note, or wait for one.",
    completion_challenged: "The completion has a standing challenge; only its challenger can lift it. Read it with collab_inbox about the completion.",
    completion_report_obsolete: "Its author withdrew or replaced this completion; request changes instead, or wait for a new completion.",
    task_not_pending_review: "The task does not wait for review now (it was reviewed already, or its policy needs none).",
  };
  if (!say[error.code] || (error.details.remedy && typeof error.details.remedy === "object")) return error;
  return new CollabError(error.code, error.message, { ...error.details, remedy: { say: say[error.code]! } });
}

async function relayNote(
  ctx: NoteVerbContext,
  credential: Credential,
  options: {
    planned: PlannedNote;
    note: string;
    keyInput: Record<string, unknown>;
    advice: string[];
    read_as: string | null;
    input: NoteVerbInput;
  },
): Promise<Record<string, unknown>> {
  const { planned, advice } = options;
  const proposal = planned.target as Extract<ReTarget, { kind: "report" }>;
  const reason = planned.fields.body === null ? planned.fields.statement : `${planned.fields.statement}\n\n${planned.fields.body}`;
  const workspaceId = proposal.view.report.workspace_id;
  const status0 = ctx.store.proposalStatus(workspaceId, proposal.id);
  const { plan, replayed } = await underPlan(ctx, credential, {
    tool: "collab_note",
    input: options.keyInput,
    entity: proposal.id,
    retry_input: noteRetryInput(options.input),
    // A relayed no is current only while it is still the person's latest
    // act. Once the person has acted since (agreed at the desk, say), the
    // same words relayed again are a new no, and a relayed no may stop work.
    stillCurrent: (latestKey) => {
      const recorded = replayReceipt<ProposalStatus>(ctx.store, credential, latestKey)?.person.acts.at(-1);
      const latest = ctx.store.proposalStatus(workspaceId, proposal.id).person.acts.at(-1);
      return recorded !== undefined && latest !== undefined && recorded.id === latest.id;
    },
  }, async (plan) => {
    const step = await stepOnce(ctx, credential, plan.key, () =>
      ctx.store.withReceiptPlan(plan.guard, () => ctx.store.relayProposalRejectionForSession({
        ...credential,
        idempotency_key: plan.key,
        proposal_report_id: proposal.id,
        proposal_sha256: status0.proposal_sha256,
        reason,
      })));
    return { plan, replayed: step.replayed };
  });
  if (plan.retry && replayed) {
    advice.push("This repeats your latest relay on this proposal exactly, so it was read as a retry. Add a word to say it again.");
  }
  // The position and the person's state as they stand now, not as a receipt kept them.
  const status = ctx.store.proposalStatus(workspaceId, proposal.id);
  const handle = handleOf("proposal", proposal.id);
  return {
    ...noteWriteResult({
      effect: `Recorded the person's no on ${handle}, relayed by you. A relayed no can only stop work; the person may still agree at the desk.`,
      ids: { proposal: proposal.id, proposal_handle: handle, proposal_sha256: status.proposal_sha256 },
      advice,
      next: withSlot(ctx, { tool: "collab_inbox", input: { about: exactRef("proposal", proposal.id) } }),
      note: options.note,
      replayed,
    }),
    act: planned.act,
    recorded_as: "relay_rejection",
    ...(options.read_as ? { read_as: options.read_as } : {}),
    position: status.ai.position,
    person: status.person.state,
    may_proceed: status.may_proceed,
  };
}

// ---------------------------------------------------------------------------
// collab_take (spec 5.4)

export interface TakeInput {
  task?: string;
  title?: string;
  paths?: string[];
  purpose?: string;
  review?: string;
  because?: string;
}

const TASK_TITLE_MAX = 300;
const RECOVERY_NOTE_MAX = 4_000;

export async function takeVerb(ctx: NoteVerbContext, input: TakeInput): Promise<Record<string, unknown>> {
  const { binding, credential } = requireCredential(ctx);
  const workspaceId = binding.handle.workspace.id;
  const hasTask = input.task !== undefined && input.task !== null;
  const hasTitle = input.title !== undefined && input.title !== null;
  if (hasTask === hasTitle) {
    throw new CollabError("task_or_title", hasTask ? "Give task or title, not both" : "Give task (one to claim) or title (a new one)", {
      remedy: { say: "collab_take takes task: an existing task (task#… or its id), or title: a new task to create and claim." },
    });
  }
  const purpose = oneLine(input.purpose, "purpose", 200, false);
  const because = freeText(input.because, "because", RECOVERY_NOTE_MAX, false);
  if (input.review !== undefined && input.review !== "required" && input.review !== "none") {
    throw new CollabError("invalid_review", "review is required or none", {
      remedy: { say: "review is required (a distinct session must accept the work) or none (you report it done); leave it out for the default." },
    });
  }
  if (input.paths !== undefined && (!Array.isArray(input.paths) || input.paths.some((path) => typeof path !== "string"))) {
    throw new CollabError("invalid_paths", "paths is a list of repository-relative paths", {
      remedy: { say: "Give paths as a list such as [\"src/parser.ts\"]." },
    });
  }
  const advice: string[] = [];
  return hasTitle
    ? takeNew(ctx, binding, credential, { title: oneLine(input.title, "title", TASK_TITLE_MAX, true)!, purpose, because, review: input.review as "required" | "none" | undefined, paths: input.paths ?? [] }, advice)
    : takeExisting(ctx, binding, credential, { task: String(input.task), purpose, because, review: input.review, paths: input.paths }, advice);
}

function normalizedPaths(paths: string[]): string[] {
  try {
    return normalizePathScopes(paths);
  } catch (error) {
    if (!(error instanceof CollabError)) throw error;
    throw new CollabError(error.code, error.message, {
      ...error.details,
      remedy: { say: "paths are repository-relative POSIX paths below the root, such as src/parser.ts; at most 128." },
    });
  }
}

async function takeNew(
  ctx: NoteVerbContext,
  binding: NoteBinding,
  credential: Credential,
  options: { title: string; purpose: string | null; because: string | null; review?: "required" | "none"; paths: string[] },
  advice: string[],
): Promise<Record<string, unknown>> {
  const workspaceId = binding.handle.workspace.id;
  const paths = normalizedPaths(options.paths);
  const workMode = paths.length > 0 ? "edit" as const : "coordination" as const;
  const policy = options.review ? (options.review === "required" ? "accepted" as const : "reported" as const)
    : paths.length > 0 ? "accepted" as const : "reported" as const;
  if (options.because) advice.push("because is for recovering a lapsed lease; a new task needs none, so it was not used.");
  const keyInput = { title: options.title, paths, purpose: options.purpose, review: options.review ?? null };
  const retryInput = { title: options.title, ...(options.paths.length ? { paths: options.paths } : {}), ...(options.purpose ? { purpose: options.purpose } : {}), ...(options.review ? { review: options.review } : {}) };
  const { plan, created, claimed, replayed } = await underPlan(ctx, credential, {
    tool: "collab_take",
    input: keyInput,
    entity: "take",
    retry_input: retryInput,
    stillCurrent: (latestKey) => leaseStillCurrent(ctx, credential, workspaceId, latestKey),
  }, async (plan) => {
    const created = await stepOnce(ctx, credential, plan.step(1), () => {
      if (paths.length > 0) {
        const conflicts = ctx.store.notePathConflicts(workspaceId, paths, { work_mode: workMode });
        if (conflicts.length > 0) throw pathConflictRefusal(ctx, workspaceId, conflicts, null);
      }
      return ctx.store.withReceiptPlan(plan.guard, () => ctx.store.createTaskForSession({
        ...credential,
        idempotency_key: plan.step(1),
        title: options.title,
        ...(options.purpose ? { description: `Purpose: ${options.purpose}` } : {}),
        path_scopes: paths,
        work_mode: workMode,
        completion_policy: policy,
      }));
    });
    const claimed = await stepOnce(ctx, credential, plan.step(2), () =>
      claimStep(ctx, binding, credential, created.value, plan.step(2), plan.guard, retryInput, null, true));
    return { plan, created: created.value, claimed: claimed.value, replayed: created.replayed && claimed.replayed };
  });
  if (plan.retry && replayed) advice.push("This repeats your latest take exactly, so it was read as a retry. Add a word to the title to take another.");
  return takeResult(ctx, claimed, { purpose: options.purpose, advice, replayed, fresh: true });
}

async function takeExisting(
  ctx: NoteVerbContext,
  binding: NoteBinding,
  credential: Credential,
  options: { task: string; purpose: string | null; because: string | null; review?: string; paths?: string[] },
  advice: string[],
): Promise<Record<string, unknown>> {
  const workspaceId = binding.handle.workspace.id;
  const id = ctx.store.resolveNoteRef(workspaceId, "task", options.task).id;
  if (options.paths !== undefined) advice.push("paths apply only to a new task (title); the task keeps its own paths.");
  if (options.review !== undefined) advice.push("review applies only to a new task (title); the task keeps its own policy.");
  if (options.purpose) advice.push("purpose is written into a new task's description only; an existing task's description is not changed.");
  const keyInput = { task: id, because: options.because };
  const retryInput = { task: exactRef("task", id), ...(options.because ? { because: options.because } : {}) };
  const { plan, held, replayed, already } = await underPlan(ctx, credential, {
    tool: "collab_take",
    input: keyInput,
    entity: id,
    retry_input: retryInput,
    stillCurrent: (latestKey) => leaseStillCurrent(ctx, credential, workspaceId, latestKey),
  }, async (plan) => {
    const earlier = replayReceipt<Task>(ctx.store, credential, plan.key);
    if (earlier) return { plan, held: earlier, replayed: true, already: false };
    const task = ctx.store.getTask(workspaceId, id);
    if (task.status === "claimed" && task.assignee_session_id === credential.session_id && task.effective_status === "claimed") {
      return { plan, held: task, replayed: false, already: true };
    }
    const held = await stepOnce(ctx, credential, plan.key, () =>
      claimStep(ctx, binding, credential, task, plan.key, plan.guard, retryInput, options.because, false));
    return { plan, held: held.value, replayed: held.replayed, already: false };
  });
  if (plan.retry && replayed) advice.push("This repeats your latest take of this task exactly, so it was read as a retry.");
  if (already) advice.push("You already hold this task; nothing was written.");
  return takeResult(ctx, held, { purpose: null, advice, replayed, already });
}

/** A take's receipt is current while its lease is still the task's lease (spec 5). A create step alone resumes. */
function leaseStillCurrent(ctx: NoteVerbContext, credential: Credential, workspaceId: string, latestKey: string): boolean {
  const found = replayReceipt<Task>(ctx.store, credential, latestKey);
  if (!found || !found.lease_id) return true;
  try {
    return ctx.store.getTask(workspaceId, found.id).lease_id === found.lease_id;
  } catch {
    return false;
  }
}

/** Claim, or recover a lapsed lease with because; every refusal names who holds what and how to ask. */
async function claimStep(
  ctx: NoteVerbContext,
  binding: NoteBinding,
  credential: Credential,
  task: Task,
  key: string,
  guard: { prefix: string; latest: string | null; key: string },
  retryInput: Record<string, unknown>,
  because: string | null,
  created: boolean,
): Promise<Task> {
  const workspaceId = binding.handle.workspace.id;
  const read = () => {
    const current = ctx.store.getTask(workspaceId, task.id);
    return { version: current.version, state: { task: handleOf("task", current.id), id: current.id, state: current.effective_status, holder: current.assignee } };
  };
  const current = ctx.store.getTask(workspaceId, task.id);
  const createdNote = created ? ` Task ${handleOf("task", task.id)} was created and is open; take it with task when this clears.` : "";
  try {
    if (current.effective_status === "recovery_required") {
      if (!because) {
        throw new CollabError("because_required", `${handleOf("task", task.id)}'s lease lapsed; recovering it needs because: why you take it over`, {
          holder: current.assignee,
          remedy: withSlot(ctx, { tool: "collab_take", input: { task: exactRef("task", task.id), because: "<why you take over the lapsed work>" } }),
        });
      }
      return await withCurrentVersion(ctx, { tool: "collab_take", input: retryInput }, read, (version) =>
        ctx.store.withReceiptPlan(guard, () => ctx.store.recoverTaskForSession({
          ...credential,
          idempotency_key: key,
          task_id: task.id,
          expected_version: version,
          recovery_note: because,
          action: "takeover",
        })));
    }
    return await withCurrentVersion(ctx, { tool: "collab_take", input: retryInput }, read, (version) =>
      ctx.store.withReceiptPlan(guard, () => ctx.store.claimTaskForSession({
        ...credential,
        idempotency_key: key,
        task_id: task.id,
        expected_version: version,
      })));
  } catch (error) {
    if (!(error instanceof CollabError)) throw error;
    if (error.code === "path_scope_conflict") {
      throw pathConflictRefusal(ctx, workspaceId, ctx.store.notePathConflicts(workspaceId, current.path_scopes, {
        work_mode: current.work_mode,
        except_task_id: current.id,
      }), task.id, createdNote);
    }
    if (error.code === "task_claimed") {
      const holder = typeof error.details.assignee_session_id === "string" ? error.details.assignee_session_id : null;
      const view = holder ? safeSession(ctx, workspaceId, holder) : null;
      throw new CollabError("task_claimed", `${handleOf("task", task.id)} is held by ${view?.actor ?? String(error.details.assignee)}`, {
        holder: view ? { session: view.id, name: view.actor, purpose: view.purpose } : { name: error.details.assignee ?? null },
        remedy: view
          ? withSlot(ctx, { tool: "collab_note", input: { text: `May I take ${exactRef("task", task.id)}?`, re: exactRef("task", task.id), to: view.id } })
          : { say: "Ask its holder, or wait until it is released." },
      });
    }
    if (error.code === "recovery_required" && !because) {
      throw new CollabError("because_required", `${handleOf("task", task.id)}'s lease lapsed; recovering it needs because`, {
        remedy: withSlot(ctx, { tool: "collab_take", input: { task: exactRef("task", task.id), because: "<why you take over the lapsed work>" } }),
      });
    }
    if (error.code === "task_blocked") {
      throw new CollabError("task_blocked", `${handleOf("task", task.id)} is blocked: ${String(error.details.blocker ?? "")}`, {
        blocker: error.details.blocker ?? null,
        remedy: { say: "A blocked task is unblocked first (collab_task_unblock on the full tool profile), then taken." },
      });
    }
    if (created && error.code !== "changed_under_you") {
      throw new CollabError(error.code, `${error.message}.${createdNote}`, error.details);
    }
    throw error;
  }
}

function safeSession(ctx: NoteVerbContext, workspaceId: string, id: string) {
  try {
    return ctx.store.resolveNoteSession(workspaceId, id, { include_ended: true });
  } catch {
    return null;
  }
}

function pathConflictRefusal(
  ctx: NoteVerbContext,
  workspaceId: string,
  conflicts: Array<{ active_task_id: string; assignee: string | null; assignee_session_id: string | null; path_pairs: Array<[string, string]> }>,
  taskId: string | null,
  createdNote = "",
): CollabError {
  const holders = conflicts.map((conflict) => {
    const view = conflict.assignee_session_id ? safeSession(ctx, workspaceId, conflict.assignee_session_id) : null;
    return {
      task: handleOf("task", conflict.active_task_id),
      id: conflict.active_task_id,
      holder: view ? { session: view.id, name: view.actor, purpose: view.purpose } : { name: conflict.assignee },
      paths: conflict.path_pairs,
      next: view
        ? withSlot(ctx, {
          tool: "collab_note",
          input: {
            text: `My work overlaps yours on ${conflict.path_pairs.map((pair) => pair[1]).join(", ")}; when will you be done with it?`,
            re: exactRef("task", conflict.active_task_id),
            to: view.id,
          },
        })
        : { say: "Its holder has no session to ask; wait until it is released or reviewed." },
    };
  });
  const first = holders[0];
  return new CollabError(
    "path_scope_conflict",
    `These paths overlap work held by ${holders.map((holder) => holder.holder.name ?? "an unknown holder").join(", ")}.${createdNote}`,
    {
      holders,
      ...(taskId ? { task: taskId } : {}),
      remedy: first?.next ?? { say: "Wait until the overlapping work is released." },
    },
  );
}

function takeResult(
  ctx: NoteVerbContext,
  task: Task,
  options: { purpose: string | null; advice: string[]; replayed: boolean; already?: boolean; fresh?: boolean },
): Record<string, unknown> {
  const handle = handleOf("task", task.id);
  const review = task.completion_policy === "accepted"
    ? "When you finish, a distinct session reviews it."
    : "When you finish, you report it done; no review is needed.";
  const statement = task.title.length > 200 ? `${task.title.slice(0, 199)}…` : task.title;
  return {
    ...noteWriteResult({
      effect: options.already
        ? `You already hold ${handle} (${task.title}). Nothing was written.`
        : `You hold ${handle} (${task.title})${options.fresh ? ", a task you created" : ""}. ${review} ` +
          "The lease lasts while your session is live; it is coordination, not ownership or a lock.",
      ids: { task: task.id, task_handle: handle },
      advice: options.advice,
      next: withSlot(ctx, { tool: "collab_done", input: { text: "<what you did>", task: exactRef("task", task.id) } }),
      note: renderNote({
        act: "take",
        statement,
        ...(task.title.length > 200 ? { body: task.title } : {}),
        re: `task:${task.id}`,
        ...(options.purpose ? { purpose: options.purpose } : {}),
      }),
      replayed: options.replayed,
    }),
    task: {
      id: task.id,
      handle,
      title: task.title,
      state: task.effective_status,
      paths: task.path_scopes,
      work_mode: task.work_mode,
      completion_policy: task.completion_policy,
    },
  };
}

// ---------------------------------------------------------------------------
// collab_done (spec 5.5)

export interface DoneInput {
  text: string;
  outcome?: string;
  task?: string;
  why?: Array<{ text: string; basis?: string; cites?: number[] }>;
  evidence?: string[];
  limits?: string;
  review_by?: string;
  because?: string;
}

const RELEASE_SUMMARY_MAX = 2_000;
const BLOCKER_MAX = 2_000;
const PROGRESS_MAX = 2_000;
const LEAVE_TEXT_MAX = 2_000;

type DoneOutcome = "finished" | "released" | "blocked" | "leave";

export async function doneVerb(ctx: NoteVerbContext, input: DoneInput): Promise<Record<string, unknown>> {
  const outcome = (input.outcome ?? "finished") as DoneOutcome;
  if (!["finished", "released", "blocked", "leave"].includes(outcome)) {
    throw new CollabError("invalid_outcome", "outcome is finished, released, blocked or leave", {
      remedy: { say: "outcome is finished (the default), released, blocked or leave." },
    });
  }
  if (outcome === "leave") return leave(ctx, input);
  const { binding, credential } = requireCredential(ctx);
  const workspaceId = binding.handle.workspace.id;
  const text = freeText(input.text, "text", 8_000, true)!;
  const { statement, body } = splitNoteText(text);
  const keyInput = doneKeyInput(input, outcome, text);
  const base = derivedBase(credential.session_id, "collab_done", keyInput);
  if (outcome !== "finished") {
    const unstored = (["why", "evidence", "limits", "review_by"] as const).filter((field) =>
      Array.isArray(input[field]) ? (input[field] as unknown[]).length > 0 : input[field] !== undefined);
    if (unstored.length > 0) {
      const cleaned = Object.fromEntries(Object.entries(input).filter(([key]) => !(unstored as readonly string[]).includes(key)));
      throw new CollabError("not_stored", `A ${outcome} task keeps only its text${outcome === "blocked" ? " and because" : ""}; ${unstored.join(", ")} would not be stored`, {
        fields: unstored,
        remedy: withSlot(ctx, { tool: "collab_done", input: cleaned }),
      });
    }
  }
  const task = doneTask(ctx, credential, workspaceId, input, base);
  if (outcome === "finished") return finishTask(ctx, binding, credential, task, { input, statement, body, keyInput });
  if (outcome === "released") {
    const summary = freeText(input.text, "text", RELEASE_SUMMARY_MAX, true)!;
    if (input.because !== undefined) {
      throw new CollabError("not_stored", "A released task keeps only its text; because would not be stored", {
        fields: ["because"],
        remedy: withSlot(ctx, { tool: "collab_done", input: { text: input.text, outcome, ...(input.task ? { task: input.task } : {}) } }),
      });
    }
    return releaseOrBlock(ctx, binding, credential, task, { outcome, summary, statement, body, keyInput });
  }
  const blocker = freeText(input.because, "because", BLOCKER_MAX, false);
  if (!blocker) {
    throw new CollabError("because_required", "A blocked task needs because: what blocks it", {
      remedy: withSlot(ctx, { tool: "collab_done", input: { ...input, because: "<what blocks it>" } }),
    });
  }
  const progress = freeText(input.text, "text", PROGRESS_MAX, true)!;
  return releaseOrBlock(ctx, binding, credential, task, { outcome, summary: progress, blocker, statement, body, keyInput });
}

function doneKeyInput(input: DoneInput, outcome: DoneOutcome, text: string): Record<string, unknown> {
  return {
    outcome,
    text,
    task: input.task ?? null,
    why: input.why ?? [],
    evidence: input.evidence ?? [],
    limits: input.limits ?? null,
    review_by: input.review_by ?? null,
    because: input.because ?? null,
  };
}

/**
 * The task a done call acts on: the one named, else the one this session
 * holds. When it holds none, an exact retry of an earlier done finds its own
 * task through the receipt with the same base, so a lost response replays
 * rather than failing on the effect it already had.
 */
function doneTask(ctx: NoteVerbContext, credential: Credential, workspaceId: string, input: DoneInput, base: string): Task {
  if (input.task !== undefined) {
    return ctx.store.getTask(workspaceId, ctx.store.resolveNoteRef(workspaceId, "task", String(input.task)).id);
  }
  const holds = ctx.store.listTasks(workspaceId, "claimed").filter((task) => task.assignee_session_id === credential.session_id);
  if (holds.length === 1) return holds[0]!;
  if (holds.length > 1) {
    // No ready call: picking one of them would be a guess at which work is done.
    throw new CollabError("several_holds", `You hold ${holds.length} tasks; say which one`, {
      candidates: holds.map((task) => ({ task: handleOf("task", task.id), id: task.id, title: task.title })),
      remedy: { say: "Send the same call with task set to the id of the one you mean; the candidates are listed." },
    });
  }
  const earlier = ctx.store.latestReceiptKeyForBase(credential, base);
  const receipt = earlier ? replayReceipt<Task | { task: Task }>(ctx.store, credential, earlier) : null;
  const taskId = receipt ? ("task" in receipt && typeof receipt.task === "object" ? receipt.task.id : (receipt as Task).id) : null;
  if (taskId) return ctx.store.getTask(workspaceId, taskId);
  throw new CollabError("nothing_held", "You hold no task", {
    remedy: withSlot(ctx, { tool: "collab_take", input: { title: "<the work you are doing>" } }),
  });
}

function requireHeld(ctx: NoteVerbContext, credential: Credential, task: Task, retryInput: Record<string, unknown>): Task {
  if (task.assignee_session_id === credential.session_id && task.lease_id && task.status === "claimed") return task;
  throw new CollabError("not_held", `You do not hold ${handleOf("task", task.id)} now`, {
    state: { task: handleOf("task", task.id), id: task.id, state: task.effective_status, holder: task.assignee },
    remedy: task.effective_status === "open"
      ? withSlot(ctx, { tool: "collab_take", input: { task: exactRef("task", task.id) } })
      : { say: "Only the holder ends a hold; take it first if it is open." },
  });
}

const ARTIFACT_KIND: Record<NoteCitedItem["kind"], "file" | "commit" | "test" | "url" | "data" | "other"> = {
  file: "file",
  commit: "commit",
  test: "test",
  url: "url",
  data: "data",
  msg: "other",
};

async function finishTask(
  ctx: NoteVerbContext,
  binding: NoteBinding,
  credential: Credential,
  task: Task,
  options: { input: DoneInput; statement: string; body: string | null; keyInput: Record<string, unknown> },
): Promise<Record<string, unknown>> {
  const workspaceId = binding.handle.workspace.id;
  const { input } = options;
  const advice: string[] = [];
  let fields = normalizeNoteFields({
    act: "done",
    statement: options.statement,
    body: options.body,
    re: `task:${task.id}`,
    why: input.why as NoteInput["why"],
    evidence: input.evidence,
    limits: input.limits,
  });
  refuseNoteProblems(fields);
  const evidence = resolveEvidence(ctx, binding, fields.evidence);
  advice.push(...evidence.advice);
  fields = { ...fields, evidence: evidence.lines };
  refuseNoteProblems(fields);
  const note = renderNote(fields);
  // The completion summary is the note without its Evidence lines, which
  // travel as artifacts (outside pointers) and evidence refs (journal ones).
  const summary = renderNote(fields, { omitEvidence: true });
  const confidenceBasis = requireReasonsFit(fields.why);
  const reviewer = input.review_by !== undefined ? ctx.store.resolveNoteSession(workspaceId, String(input.review_by)).id : null;
  // Each label is checked before anything is written: it is where a caller's
  // own hash or exit status is kept, so it is never cut to fit.
  const labels = evidence.items.map((item) => artifactLabel(item, evidence.lines[item.n - 1]!));
  labels.forEach((label, index) => {
    if (label.length <= ARTIFACT_LABEL_MAX) return;
    const n = evidence.items[index]!.n;
    throw new CollabError("too_long", `Evidence ${n} is kept as an artifact label of ${label.length} characters; at most ${ARTIFACT_LABEL_MAX}`, {
      field: `evidence[${n - 1}]`,
      max: ARTIFACT_LABEL_MAX,
      actual: label.length,
      unit: "chars",
      remedy: { say: `Shorten the k=v attributes of evidence ${n}: a finished task keeps them in its artifact's label.` },
    });
  });
  const retryInput = { ...input, task: exactRef("task", task.id) } as Record<string, unknown>;
  const held = () => {
    const current = requireHeld(ctx, credential, ctx.store.getTask(workspaceId, task.id), retryInput);
    return { version: current.version, state: { task: handleOf("task", current.id), state: current.effective_status } };
  };
  const { plan, artifacts, completed, replayed } = await underPlan(ctx, credential, {
    tool: "collab_done",
    input: options.keyInput,
    entity: task.id,
    retry_input: retryInput,
    stillCurrent: (latestKey) => {
      const found = replayReceipt<Task | { task: Task; artifact: unknown }>(ctx.store, credential, latestKey);
      if (!found) return true;
      const current = ctx.store.getTask(workspaceId, task.id);
      if ("artifact" in found) return current.lease_id === found.task.lease_id;
      // A completion is current while the task is still completed with it.
      // A request for changes keeps the completion's id but sends the work
      // back, so the same done then acts afresh (and asks to take it first).
      const completedTask = found as Task;
      return current.completion_report_id === completedTask.completion_report_id
        && current.status === "completed"
        && current.review_status !== "changes_requested";
    },
  }, async (plan) => {
    let replays = 0;
    const artifacts: Array<{ id: string; n: number }> = [];
    for (const [index, item] of evidence.items.entries()) {
      const key = plan.step(index + 1);
      const attached = await stepOnce(ctx, credential, key, () => withCurrentVersion(ctx, { tool: "collab_done", input: retryInput }, held,
        (version) => ctx.store.withReceiptPlan(plan.guard, () => ctx.store.attachArtifactForSession({
          ...credential,
          idempotency_key: key,
          task_id: task.id,
          lease_id: ctx.store.getTask(workspaceId, task.id).lease_id!,
          expected_version: version,
          kind: ARTIFACT_KIND[item.kind],
          uri: item.locator,
          ...(item.kind === "file" && item.observed === "server" && item.sha256 ? { sha256: item.sha256 } : {}),
          label: labels[index]!,
        }))));
      if (attached.replayed) replays += 1;
      artifacts.push({ id: attached.value.artifact.id, n: item.n });
    }
    const completeKey = plan.step(evidence.items.length + 1);
    const completed = await stepOnce(ctx, credential, completeKey, () => withCurrentVersion(ctx, { tool: "collab_done", input: retryInput }, held,
      (version) => ctx.store.withReceiptPlan(plan.guard, () => ctx.store.completeTaskForSession({
        ...credential,
        idempotency_key: completeKey,
        task_id: task.id,
        lease_id: ctx.store.getTask(workspaceId, task.id).lease_id!,
        expected_version: version,
        summary,
        ...(confidenceBasis ? { confidence_basis: confidenceBasis } : {}),
        ...(fields.limits ? { limits: fields.limits } : {}),
        evidence_refs: [...evidence.journal, ...artifacts.map((artifact) => `artifact:${artifact.id}`)],
        ...(reviewer ? { review_requested_session_id: reviewer } : {}),
      }))));
    if (completed.replayed) replays += 1;
    return { plan, artifacts, completed: completed.value, replayed: replays === evidence.items.length + 1 };
  });
  if (plan.retry && replayed) advice.push("This repeats your latest done on this task exactly, so it was read as a retry.");
  else if (plan.retry) advice.push("An earlier call with this input stopped part way; its finished steps were kept, and the rest ran now.");
  const handle = handleOf("task", task.id);
  const completion = completed.completion_report_id!;
  const reviewed = completed.completion_policy === "accepted";
  // Said as the task stands now, so a replay after the review does not say it still waits.
  const now = ctx.store.getTask(workspaceId, task.id);
  const accepted = reviewed && now.completion_report_id === completion && now.review_status === "accepted";
  return {
    ...noteWriteResult({
      effect: !reviewed
        ? `Completed ${handle} as ${handleOf("report", completion)}; its policy needs no review.`
        : accepted
          ? `Reported ${handle} finished as ${handleOf("report", completion)}; a distinct session has accepted it.`
          : `Reported ${handle} finished as ${handleOf("report", completion)}; it waits for review by a distinct session ` +
            `(accept or request_changes)${reviewer ? ", which you asked of one" : ""}. Your report is not an acceptance.`,
      ids: {
        task: task.id,
        task_handle: handle,
        completion: completion,
        completion_handle: handleOf("report", completion),
        artifacts: artifacts.map((artifact) => ({ artifact: artifact.id, evidence: artifact.n })),
      },
      advice,
      next: reviewed && !accepted
        ? { say: `Ask a distinct session to review it: collab_note {act: "accept" or "request_changes", re: "${completion}"}.` }
        : withSlot(ctx, { tool: "collab_inbox", input: {} }),
      note,
      replayed,
    }),
    evidence: evidenceSummary(evidence),
  };
}

/** The artifacts table's label cap. */
const ARTIFACT_LABEL_MAX = 300;

/**
 * An artifact's label: its Evidence position, and how it was observed. An
 * item the server did not check keeps every k=v the caller wrote (a hash,
 * an exit status), marked as the caller's, because the completion summary
 * leaves the Evidence lines out and the label is where they survive. The
 * sha256 column is filled only by the server's own hash.
 */
function artifactLabel(item: NoteCitedItem, line: string): string {
  const written = parseEvidence(line).attrs;
  const range = item.lines ? ` lines ${item.lines}` : "";
  if (item.observed === "server") {
    const claimed = written.sha256?.toLowerCase();
    const contradicted = item.kind === "file" && claimed && claimed !== item.sha256 ? `; the caller wrote sha256=${claimed}` : "";
    return `Evidence ${item.n}${range}: ${item.kind === "file" ? "sha256 by the server" : "checked by the server"}${contradicted}`;
  }
  const attrs = NOTE_EVIDENCE_ATTRS.filter((key) => written[key] !== undefined).map((key) => ` ${key}=${written[key]}`).join("");
  return `Evidence ${item.n}${range}${attrs}: ${item.observed === "not_found" ? "not found by git" : "as the caller wrote it"}`;
}

async function releaseOrBlock(
  ctx: NoteVerbContext,
  binding: NoteBinding,
  credential: Credential,
  task: Task,
  options: {
    outcome: "released" | "blocked";
    summary: string;
    blocker?: string;
    statement: string;
    body: string | null;
    keyInput: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
  const workspaceId = binding.handle.workspace.id;
  const advice: string[] = [];
  const retryInput = { ...options.keyInput, task: exactRef("task", task.id) } as Record<string, unknown>;
  for (const key of Object.keys(retryInput)) if (retryInput[key] === null || (Array.isArray(retryInput[key]) && (retryInput[key] as unknown[]).length === 0)) delete retryInput[key];
  const { plan, done, replayed } = await underPlan(ctx, credential, {
    tool: "collab_done",
    input: options.keyInput,
    entity: task.id,
    retry_input: retryInput,
    // A release or block stays done until this session holds the task again.
    stillCurrent: () => ctx.store.getTask(workspaceId, task.id).assignee_session_id !== credential.session_id,
  }, async (plan) => {
    const held = () => {
      const current = requireHeld(ctx, credential, ctx.store.getTask(workspaceId, task.id), retryInput);
      return { version: current.version, state: { task: handleOf("task", current.id), state: current.effective_status } };
    };
    if (options.outcome === "released") {
      const released = await stepOnce(ctx, credential, plan.key, () => withCurrentVersion(ctx, { tool: "collab_done", input: retryInput }, held, (version) =>
        ctx.store.withReceiptPlan(plan.guard, () => ctx.store.releaseTaskForSession({
          ...credential,
          idempotency_key: plan.key,
          task_id: task.id,
          lease_id: ctx.store.getTask(workspaceId, task.id).lease_id!,
          expected_version: version,
          summary: options.summary,
        }))));
      return { plan, done: released.value, replayed: released.replayed };
    }
    // Blocked: the text is posted as progress, then the blocker recorded.
    const progressed = await stepOnce(ctx, credential, plan.step(1), () => withCurrentVersion(ctx, { tool: "collab_done", input: retryInput }, held, (version) =>
      ctx.store.withReceiptPlan(plan.guard, () => ctx.store.progressTaskForSession({
        ...credential,
        idempotency_key: plan.step(1),
        task_id: task.id,
        lease_id: ctx.store.getTask(workspaceId, task.id).lease_id!,
        expected_version: version,
        message: options.summary,
      }))));
    const blocked = await stepOnce(ctx, credential, plan.step(2), () => withCurrentVersion(ctx, { tool: "collab_done", input: retryInput }, held, (version) =>
      ctx.store.withReceiptPlan(plan.guard, () => ctx.store.blockTaskForSession({
        ...credential,
        idempotency_key: plan.step(2),
        task_id: task.id,
        lease_id: ctx.store.getTask(workspaceId, task.id).lease_id!,
        expected_version: version,
        blocker: options.blocker!,
      }))));
    return { plan, done: blocked.value, replayed: progressed.replayed && blocked.replayed };
  });
  if (plan.retry && replayed) advice.push(`This repeats your latest ${options.outcome} of this task exactly, so it was read as a retry.`);
  const handle = handleOf("task", task.id);
  return {
    ...noteWriteResult({
      effect: options.outcome === "released"
        ? `Released ${handle}; it is open for anyone to take.`
        : `Blocked ${handle}: ${options.blocker}. Your text was posted as its progress; it waits to be unblocked.`,
      ids: { task: task.id, task_handle: handle },
      advice,
      next: withSlot(ctx, { tool: "collab_inbox", input: {} }),
      note: renderNote({
        act: "done",
        statement: options.statement,
        body: options.outcome === "blocked"
          ? [options.body, `Blocked: ${options.blocker}`].filter(Boolean).join("\n\n")
          : options.body,
        re: `task:${task.id}`,
      }),
      replayed,
    }),
    task: { id: task.id, handle, state: done.effective_status },
  };
}

async function leave(ctx: NoteVerbContext, input: DoneInput): Promise<Record<string, unknown>> {
  const text = freeText(input.text, "text", LEAVE_TEXT_MAX, true)!;
  const because = freeText(input.because, "because", LEAVE_TEXT_MAX, false);
  const keyInput = { outcome: "leave", text, because };
  const binding = ctx.binding();
  if (!binding) {
    // The session already ended: only an exact retry of that leave is answered.
    const left = ctx.left();
    if (left && left.base === derivedBase(left.session_id, "collab_done", keyInput)) {
      return {
        ...left.result,
        effect: `Replayed: nothing new was written. ${String(left.result.effect)}`,
        replayed: true,
        advice: [...(Array.isArray(left.result.advice) ? left.result.advice as string[] : []),
          "This repeats your leave exactly, so it was read as a retry."],
      };
    }
    throw notArrived(ctx.slot_key, ctx.bound_slots().find((slot) => slot.key === "")?.binding ?? null);
  }
  const { credential } = requireCredential(ctx);
  const workspaceId = binding.handle.workspace.id;
  const advice: string[] = [];
  for (const field of ["task", "why", "evidence", "limits", "review_by"] as const) {
    if (input[field] !== undefined) advice.push(`${field} is not used when you leave; every hold is released.`);
  }
  const holds = ctx.store.listTasks(workspaceId, "claimed").filter((task) => task.assignee_session_id === credential.session_id);
  if (holds.length > 0 && !because) {
    throw new CollabError("because_required", `You hold ${holds.length} task(s) that would be left unfinished; say why with because`, {
      holds: holds.map((task) => ({ task: handleOf("task", task.id), id: task.id, title: task.title })),
      remedy: withSlot(ctx, { tool: "collab_done", input: { text, outcome: "leave", because: "<why the work is left unfinished>" } }),
    });
  }
  const ended = ctx.store.endSessionWithReleases({
    ...credential,
    reason: because ?? text,
    ...(holds.length > 0 ? { release_leases: true, release_summary: text } : {}),
  });
  try {
    removeSessionCredentialFile(binding.credential_file);
  } catch {
    advice.push("The session ended, but its credential file could not be removed; it no longer opens the journal.");
  }
  const released = ended.released_leases.map((release) => ({ task: release.task_id, task_handle: handleOf("task", release.task_id), via: release.via }));
  const result = {
    ...noteWriteResult({
      effect:
        `Ended session ${ended.session.id}${released.length > 0 ? `, after releasing ${released.map((item) => item.task_handle).join(", ")}` : ""}. ` +
        "You are no longer a voice in new proposals or a unit in new ballots here.",
      ids: { session: ended.session.id, released },
      advice,
      next: withSlot(ctx, { tool: "collab_arrive", input: { purpose: "<what you are here to do>" } }),
      note: renderNote({ act: "done", statement: statementOf(text.split("\n")[0] ?? text), ...(text.includes("\n") || text.length > 200 ? { body: text } : {}) }),
    }),
    session: { id: ended.session.id, status: ended.session.status },
  };
  ctx.unbind({ session_id: credential.session_id, base: derivedBase(credential.session_id, "collab_done", keyInput), result });
  return result;
}
