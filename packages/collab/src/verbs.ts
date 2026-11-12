/**
 * Collab Notes: the verb kernel and the verbs (spec section 5). The kernel
 * hides every piece of bookkeeping an agent should not have to carry: ids
 * come back as handles, idempotency keys are derived, versions are read
 * inside the call, and every refusal carries a remedy. The verbs are thin
 * ways to make the store's existing calls; they add no rule of their own.
 *
 * Registration lives in mcp.ts (one literal registerTool per tool, which the
 * execution-seat test reads); this module holds what those handlers do.
 */
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { hostname } from "node:os";
import { resolve, sep } from "node:path";
import { defaultActor } from "./actor-default.js";
import { canonicalJson } from "./canonical.js";
import { defaultDatabasePath } from "./database-path.js";
import { CollabError } from "./errors.js";
import {
  fileLocatorParts,
  hasLoneSurrogate,
  NOTE_JOURNAL_EVIDENCE_KINDS,
  NOTE_STATEMENT_MAX,
  normalizeNoteText,
  parseEvidence,
  parseNote,
  renderCarriedNote,
  renderNote,
  type NoteAct,
  type NoteInput,
  type NoteReason,
} from "./note.js";
import type { CollabReport, ProposalStatus, SessionHandle } from "./protocol.js";
import { hashWorktreeFile, inspectRepository, MAX_CITED_FILE_BYTES } from "./repository.js";
import { defaultSeatRef } from "./seat-ref.js";
import { removeSessionCredentialFile, writeSessionCredentialFile } from "./session-file.js";
import {
  NOTE_INBOX_MAX_LIMIT,
  NOTE_SELF_DECISION_BASIS,
  noteWaitingShownItems,
  type CollabStore,
  type NoteArrivalData,
  type NoteChallengeView,
  type NoteCitedItem,
  type NoteDecisionData,
  type NoteEntityKind,
  type NoteEntry,
  type NoteInboxData,
  type NoteProposalData,
  type NoteSessionView,
  type NoteStanceView,
  type NoteThreadData,
  type NoteWaitingEntry,
  type ReceiptPlanGuard,
} from "./store.js";
import { COLLAB_PACKAGE_VERSION } from "./version.js";

// ---------------------------------------------------------------------------
// The surface

/** The eight verbs (spec 5), in the order an agent meets them. */
export const NOTE_VERBS = [
  "collab_arrive",
  "collab_inbox",
  "collab_note",
  "collab_take",
  "collab_done",
  "collab_propose",
  "collab_poll",
  "collab_vote",
] as const;
export type NoteVerb = (typeof NOTE_VERBS)[number];

/**
 * The verbs this build implements and registers. A later stage that builds a
 * verb adds it here and registers it in mcp.ts; nothing else changes, and
 * nothing is registered before it works.
 */
export const BUILT_NOTE_VERBS: readonly NoteVerb[] = [
  "collab_arrive",
  "collab_inbox",
  "collab_note",
  "collab_take",
  "collab_done",
  "collab_propose",
];

/** Existing tools the notes profile keeps beside the verbs (spec 9). */
export const NOTES_PROFILE_LEGACY_TOOLS = ["collab_journal_verify"] as const;

export type ToolsProfile = "full" | "notes";

export const TOOLS_PROFILE_VARIABLES = ["AGENTOOL_COLLAB_TOOLS", "AGENTTOOL_COLLAB_TOOLS"] as const;

/**
 * The tools profile from the server's environment (spec 9). Both spellings
 * are read because both have been used for this package's variables; an
 * unknown value, or two that disagree, refuses to start rather than guess.
 */
export function toolsProfile(environment: Record<string, string | undefined>): ToolsProfile {
  const values = TOOLS_PROFILE_VARIABLES
    .map((name) => ({ name, value: environment[name] }))
    .filter((entry): entry is { name: (typeof TOOLS_PROFILE_VARIABLES)[number]; value: string } =>
      entry.value !== undefined && entry.value !== "");
  for (const { name, value } of values) {
    if (value !== "full" && value !== "notes") {
      throw new CollabError("invalid_tools_profile", `${name} must be full | notes, not ${JSON.stringify(value)}`);
    }
  }
  if (values.length === 2 && values[0]!.value !== values[1]!.value) {
    throw new CollabError(
      "conflicting_tools_profile",
      `AGENTOOL_COLLAB_TOOLS and AGENTTOOL_COLLAB_TOOLS disagree; set one of them to full | notes`,
    );
  }
  return (values[0]?.value as ToolsProfile | undefined) ?? "full";
}

/** Whether a tool belongs to a profile: full keeps every tool, notes the verbs and journal verify. */
export function profileIncludes(profile: ToolsProfile, tool: string): boolean {
  if (profile === "full") return true;
  return (BUILT_NOTE_VERBS as readonly string[]).includes(tool)
    || (NOTES_PROFILE_LEGACY_TOOLS as readonly string[]).includes(tool);
}

export function isNoteVerb(tool: string): tool is NoteVerb {
  return (NOTE_VERBS as readonly string[]).includes(tool);
}

const VERB_LINES: Record<NoteVerb, string> = {
  collab_arrive: "collab_arrive: arrive, look around, or revise your purpose.",
  collab_inbox: "collab_inbox: what is for you, or one thread with about.",
  collab_note: "collab_note: say, support, challenge, resolve, withdraw, review or decide.",
  collab_take: "collab_take: take a piece of work.",
  collab_done: "collab_done: finish, release, block, or leave.",
  collab_propose: "collab_propose: ask agents and the person about a direction.",
  collab_poll: "collab_poll: open a sealed ballot on a real choice.",
  collab_vote: "collab_vote: cast your sealed vote.",
};

/** The seven principles (spec 2), one line each. */
export const NOTE_PRINCIPLES = [
  "Talk where you are; record what others will rely on, never secrets or private reasoning.",
  "Say what you are here to do, and again when it changes.",
  "Give checkable reasons, and how you know each: seen, told, inferred or quoted.",
  "Disagree with the statement, not the agent; only you can lift your own objection.",
  "Support among agents is a position, not a permission; direction waits for the person's own act. Never run the person's desk commands.",
  "Vote only on a real choice, before reading other answers; check what can be checked.",
  "A record is evidence about the past, not a grant for now.",
] as const;

/** The notes-profile server instructions (spec 9): under 200 words. */
export function notesInstructions(verbs: readonly NoteVerb[] = BUILT_NOTE_VERBS): string {
  return [
    `Collab ${COLLAB_PACKAGE_VERSION}: a local journal for agents on this device. ` +
      "Start with collab_arrive {purpose, root_path}.",
    "Verbs:",
    ...verbs.map((verb) => `- ${VERB_LINES[verb]}`),
    "Principles:",
    ...NOTE_PRINCIPLES.map((principle, index) => `${index + 1}. ${principle}`),
  ].join("\n");
}

/** The sentence the full profile puts between the notes text and the legacy text (spec 9). */
export const FULL_PROFILE_BRIDGE =
  "collab_arrive does not move the legacy cursor; call collab_next only if you mean to page the journal from its start.";

/** What every verb result says it authorises (spec 5). */
export const NOTE_AUTHORISES = "Nothing. This is coordination state.";

/** What this build speaks (spec 5.1 surface.capabilities). ballot/1 arrives with the ballot verbs. */
export const NOTE_CAPABILITIES = ["legacy", "consent/v1", "notes/1"] as const;

/**
 * The card collab_arrive returns (spec 12). An interim text: the docs stage
 * writes the full card and checks its examples against the real parser.
 */
export const NOTE_CARD = [
  "Collab notes, interim card (the full card is still being written).",
  "A note is plain text: `<act>: <statement>`, a blank line, an optional body, then trailers:",
  "  To: <name | session id | person | all>   Re: <report:… | proposal:… | task:… | file:…>",
  "  Why: <reason> (<seen|told|inferred|quoted> [n])   Evidence: <file path | commit sha | test cmd exit=n | url …>",
  "  Limits: <what this does not cover>   Purpose: <what it serves>   Extent: <where a decision stops>",
  "Acts: say: note; stand: support, challenge, resolve, withdraw; work: take, done, accept, request_changes;",
  "decide: propose, poll, vote, decide.",
  "This build has collab_arrive, collab_inbox, collab_note (decide included), collab_take, collab_done and collab_propose; poll and vote come later.",
  ...NOTE_PRINCIPLES.map((principle, index) => `${index + 1}. ${principle}`),
].join("\n");

// ---------------------------------------------------------------------------
// Handles

const MINTED_ID = /^(report|task|session)_([0-9a-f]{8})-[0-9a-f]{4}-/;

/** The table an entity kind lives in: proposals and ballots are reports. */
function tableOf(kind: NoteEntityKind | "session"): "report" | "task" | "session" {
  return kind === "task" || kind === "session" ? kind : "report";
}

/** The uuid hex of an id the store minted for this kind, or null for any other id. */
function mintedHex(kind: NoteEntityKind | "session", id: string): string | null {
  const match = MINTED_ID.exec(id);
  return match && match[1] === tableOf(kind) ? match[2]! : null;
}

/**
 * `<kind>#<first 6 hex of the uuid>` for an id the store minted (spec 5).
 * A task created with a caller-chosen id has no uuid, so its handle is
 * `task:<id>`, which still says it is a task when it is passed back.
 * Handles are for display: two items may share one. Ready calls carry
 * exactRef instead.
 */
export function handleOf(kind: NoteEntityKind | "session", id: string): string {
  const hex = mintedHex(kind, id);
  if (hex) return `${kind}#${hex.slice(0, 6)}`;
  return kind === "session" ? id : `${kind}:${id}`;
}

/**
 * The reference a ready call (a `next` or a remedy) carries: the full id,
 * typed when it has no uuid. Never a short handle, which could match a
 * second item and make the server refuse the call it suggested.
 */
export function exactRef(kind: NoteEntityKind, id: string): string {
  return mintedHex(kind, id) ? id : `${kind}:${id}`;
}

/** The handle of a report, as a proposal when it carries consent/v1 terms. */
function reportHandle(id: string, termed: boolean): string {
  return handleOf(termed ? "proposal" : "report", id);
}

// ---------------------------------------------------------------------------
// Derived idempotency (spec 5)

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, upper case, no padding: every character fits a receipt key. */
export function base32(bytes: Uint8Array): string {
  let out = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(buffer >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(buffer << (5 - bits)) & 31];
  return out;
}

function sha256Bytes(text: string): Uint8Array {
  return createHash("sha256").update(text, "utf8").digest();
}

export interface ReceiptPlan {
  /** The key this call uses (its first step's key when it has steps). */
  key: string;
  seq: number;
  base: string;
  eh: string;
  /** The latest key with this entity prefix before this call, or null. */
  latest: string | null;
  /** An exact retry of the session's latest act on this entity. */
  retry: boolean;
  /** The key of internal step n of this call. */
  step(n: number): string;
  /** Pass to the store write as `receipt_plan`, which re-checks the plan inside its transaction. */
  guard: ReceiptPlanGuard;
}

const DERIVED_KEY = /^n1:([A-Z2-7]{8}):(\d{6}):([A-Z2-7]{20})(?::(\d{2}))?$/;

/** The `base` of a derived key (spec 5): who asks and what, never the state the call changes. */
export function derivedBase(sessionId: string, tool: NoteVerb, input: unknown): string {
  return base32(sha256Bytes(canonicalJson({ session_id: sessionId, tool, input }))).slice(0, 20);
}

/**
 * The derived key for one verb call (spec 5). `base` hashes who asks and
 * what; `eh` hashes the entity acted on. No part depends on state the call
 * changes, so a lost-response retry finds its own receipt, while a repeat
 * after any other act by this session on the same entity is new.
 */
export function planReceipt(
  store: CollabStore,
  credential: { session_id: string; session_token: string; generation: number },
  call: {
    tool: NoteVerb;
    input: unknown;
    entity: string;
    /** Whether the latest receipt's effect still holds (a lease still current, say). Plain records always do. */
    stillCurrent?: (latestKey: string) => boolean;
  },
): ReceiptPlan {
  const base = derivedBase(credential.session_id, call.tool, call.input);
  const eh = base32(sha256Bytes(call.entity)).slice(0, 8);
  const latest = store.latestReceiptKeyForSession(credential, `n1:${eh}:`);
  const parsed = latest ? DERIVED_KEY.exec(latest) : null;
  const latestSeq = parsed ? Number(parsed[2]) : 0;
  const retry = parsed !== null && parsed[3] === base && (call.stillCurrent?.(latest!) ?? true);
  const seq = retry ? latestSeq : latestSeq + 1;
  const key = `n1:${eh}:${String(seq).padStart(6, "0")}:${base}`;
  return {
    key,
    seq,
    base,
    eh,
    latest,
    retry,
    step: (n: number) => `${key}:${String(n).padStart(2, "0")}`,
    guard: { prefix: `n1:${eh}:`, latest, key },
  };
}

/** The store's refusal of a write whose plan another write overtook. */
const RECEIPT_PLAN_STALE = "receipt_plan_stale";

/**
 * Plan a call's key and act under it (spec 5). Choosing the key happens
 * outside the write's transaction, so two calls by one session on one entity
 * that both plan before either writes would share a seq, and the earlier
 * write could then read as latest and swallow a later deliberate repeat as a
 * replay. The store re-checks the plan inside the transaction (`plan.guard`
 * passed as `receipt_plan`) and refuses an overtaken one before writing;
 * this plans once more on the fresh latest key, so each act gets its own seq
 * in the order it was written. A plan overtaken twice is refused as
 * changed_under_you with the same call as remedy.
 */
export async function underPlan<T>(
  ctx: Pick<NoteVerbContext, "store" | "slot_key">,
  credential: { session_id: string; session_token: string; generation: number },
  call: {
    tool: NoteVerb;
    /** What the key hashes: the normalised input. */
    input: unknown;
    entity: string;
    stillCurrent?: (latestKey: string) => boolean;
    /** The caller's input for the remedy, when it differs from what the key hashes. */
    retry_input?: Record<string, unknown>;
  },
  act: (plan: ReceiptPlan) => T | Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    const plan = planReceipt(ctx.store, credential, call);
    try {
      return await act(plan);
    } catch (error) {
      if (!(error instanceof CollabError) || error.code !== RECEIPT_PLAN_STALE) throw error;
      if (attempt >= 2) {
        throw changedUnderYou(ctx, {
          tool: call.tool,
          input: call.retry_input ?? (call.input as Record<string, unknown>),
        }, null);
      }
    }
  }
}

/**
 * Version conflicts handled inside the call (spec 5). The verb reads the
 * current version itself and tries once. A change between that read and the
 * write is no fault of the caller's, so it is refused as changed_under_you
 * with the fresh state and the same call as the remedy, and no version ever
 * reaches the caller. It does not try again by itself: the caller chose on
 * the state it was shown, and the fresh state may change that choice.
 * `read` returns the version and the state as the caller should see it.
 */
export async function withCurrentVersion<T>(
  ctx: Pick<NoteVerbContext, "slot_key">,
  call: { tool: NoteVerb; input: Record<string, unknown> },
  read: () => { version: number; state: Record<string, unknown> },
  attempt: (version: number) => T | Promise<T>,
): Promise<T> {
  const { version } = read();
  try {
    return await attempt(version);
  } catch (error) {
    if (!(error instanceof CollabError) || error.code !== "version_conflict") throw error;
    throw changedUnderYou(ctx, call, read().state);
  }
}

const CHANGED_UNDER_YOU =
  "It changed after this call read it, so the change was not made";

/** The refusal for a write overtaken by a concurrent change: the fresh state, and the same call to send again. */
export function changedUnderYou(
  ctx: Pick<NoteVerbContext, "slot_key">,
  call: { tool: NoteVerb; input: Record<string, unknown> },
  state: Record<string, unknown> | null,
): CollabError {
  return new CollabError(
    "changed_under_you",
    `${CHANGED_UNDER_YOU}. ${state ? "The fresh state is in state; if" : "If"} your call still holds, send it again.`,
    {
      ...(state ? { state } : {}),
      remedy: withSlot(ctx, { tool: call.tool, input: call.input }),
    },
  );
}

/**
 * A finished step's recorded response, looked up by its exact key without
 * re-submitting the request, so a changed version cannot turn a retry into a
 * conflict (spec 5). Null when the step never finished.
 */
export function replayReceipt<T>(
  store: CollabStore,
  credential: { session_id: string; session_token: string; generation: number },
  key: string,
): T | null {
  const found = store.readReceiptByKey<T>(credential, key);
  return found.found ? found.value : null;
}

// ---------------------------------------------------------------------------
// Results and errors

export type NoteRemedy = { tool: string; input: Record<string, unknown> } | { say: string };

export interface NoteWriteFields {
  effect: string;
  ids: Record<string, unknown>;
  advice?: string[];
  next?: NoteRemedy | null;
  note: string | null;
  replayed?: boolean;
}

/** The fields every verb's write result carries (spec 5). */
export function noteWriteResult(fields: NoteWriteFields): Record<string, unknown> {
  return {
    ok: true,
    effect: fields.replayed ? `Replayed: nothing new was written. ${fields.effect}` : fields.effect,
    authorises: NOTE_AUTHORISES,
    ids: fields.ids,
    advice: fields.advice ?? [],
    next: fields.next ?? null,
    note: fields.note,
    ...(fields.replayed ? { replayed: true } : {}),
  };
}

export function noteSuccess(payload: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

const SAY_BY_CODE: Record<string, string> = {
  cursor_recovery_required:
    "The host must reset this session's cursor (collab_cursor_reset, on the full tool profile) before it can act again.",
  cursor_reset_required:
    "The host must reconcile this session's cursor before it can act again.",
  session_auth_failed:
    "This session's credentials no longer match the journal (it was ended, or another process resumed it). Arrive again from a new MCP process, or ask the host.",
  ambiguous_handle: "Use a longer handle or the full id; the candidates are listed.",
  ambiguous_session: "Use the session id; the candidates are listed.",
  too_many_waits: "Wait for a running wait to finish, or call again with wait_seconds: 0.",
  // The wait starts only after a first pass that found nothing for you, and
  // that pass has already written; first_pass holds what it found.
  wait_cancelled:
    "The wait was cancelled after its first pass, which had already moved your read mark and last-seen time " +
    "past what it counted (in first_pass). Nothing addressed to you was passed over; call collab_inbox to go on.",
  changed_under_you: "Read it again (collab_inbox with about), then send your call again if it still holds.",
};

/** A legacy string remedy becomes `{say}`; a missing one becomes the clearest thing to say (spec 5). */
export function noteRemedyOf(error: CollabError): NoteRemedy {
  const remedy = error.details.remedy;
  if (remedy && typeof remedy === "object" && !Array.isArray(remedy)) {
    const value = remedy as Record<string, unknown>;
    if (typeof value.tool === "string" && value.input && typeof value.input === "object") {
      return { tool: value.tool, input: value.input as Record<string, unknown> };
    }
    if (typeof value.say === "string") return { say: value.say };
  }
  if (typeof remedy === "string" && remedy) return { say: remedy };
  if (SAY_BY_CODE[error.code]) return { say: SAY_BY_CODE[error.code]! };
  if (Array.isArray(error.details.recorded_steps) && error.details.recorded_steps.length > 0) {
    // A later step of a multi-step call was refused: the fallbacks below
    // say nothing was written, which is false for the steps before it.
    return {
      say: `${error.message}. The steps in recorded_steps were written before this refusal and stay recorded: ` +
        "the same call sent again replays them instead of writing them twice, and a changed call writes its own.",
    };
  }
  if (error.details.after_housekeeping === true) {
    // The fallbacks below say nothing was written, which is false here.
    return {
      say: `${error.message}. This call had already recorded its housekeeping (last-seen time, read mark, delivery records) ` +
        "before it failed; call collab_inbox again.",
    };
  }
  if (error.code === "too_long" && typeof error.details.field === "string") {
    return { say: `Shorten ${error.details.field} to at most ${String(error.details.max)}; nothing was written.` };
  }
  if (error.code.endsWith("_not_found")) {
    return { say: "Check the id or handle: every id a later call needs comes back in an earlier result." };
  }
  return { say: `${error.message}. Nothing was written; correct the call and send it again.` };
}

/**
 * The store's version_conflict, wherever a verb meets it outside
 * withCurrentVersion, is the caller's state going stale, not a wrong call:
 * it becomes changed_under_you, and the versions it names stay hidden.
 */
function verbFacing(error: CollabError): CollabError {
  if (error.code !== "version_conflict") return error;
  const { expected_version: _expected, current_version: _current, ...details } = error.details;
  return new CollabError("changed_under_you", `${CHANGED_UNDER_YOU}.`, details);
}

/** The verbs' error shape: `{code, message, remedy}` plus the error's details (spec 5). */
export function noteFailure(error: unknown) {
  const payload = error instanceof CollabError
    ? (() => {
      const shown = verbFacing(error);
      const { remedy: _remedy, ...details } = shown.details;
      return { code: shown.code, message: shown.message, ...details, remedy: noteRemedyOf(shown) };
    })()
    : {
      code: "internal_error",
      message: error instanceof Error ? error.message : String(error),
      remedy: { say: "This is a fault in collab, not in the call. Nothing more is known; try once more or tell the person." },
    };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
    isError: true,
  };
}

/** Run a verb and shape its result or its refusal. */
export async function noteCall(operation: () => Record<string, unknown> | Promise<Record<string, unknown>>) {
  try {
    return noteSuccess(await operation());
  } catch (error) {
    return noteFailure(error);
  }
}

// ---------------------------------------------------------------------------
// The context a verb runs in

export interface NoteBinding {
  handle: SessionHandle;
  credential_file: string;
}

export interface NoteVerbContext {
  store: CollabStore;
  environment: Record<string, string | undefined>;
  profile: ToolsProfile;
  /** "" for the default slot, else the call's binding_key. */
  slot_key: string;
  binding(): NoteBinding | null;
  bind(binding: NoteBinding): void;
  /** Every bound slot of this MCP process, the default first. */
  bound_slots(): Array<{ key: string; binding: NoteBinding }>;
  /** Shared with collab_events_wait: at most `max` waits per endpoint. */
  waits: { active: number; max: number };
  signals: Array<AbortSignal | undefined>;
  /**
   * Clear this slot after collab_done ended its session, keeping what that
   * call returned: the session's credentials no longer open the journal, so
   * a lost-response retry can only be answered from this process.
   */
  unbind(left: LeaveMemo): void;
  /** What the last leave on this slot returned, while no new session has arrived on it. */
  left(): LeaveMemo | null;
}

export interface LeaveMemo {
  session_id: string;
  base: string;
  result: Record<string, unknown>;
}

/** The refusal for a verb other than collab_arrive on a slot with no session (spec 5). */
export function notArrived(slotKey: string, defaultBinding: NoteBinding | null): CollabError {
  if (!slotKey) {
    return new CollabError("not_arrived", "This MCP slot has no session yet; arrive first", {
      remedy: { tool: "collab_arrive", input: { purpose: "…" } },
    });
  }
  const parent = defaultBinding?.handle.session;
  return new CollabError(
    "not_arrived",
    `The slot named by binding_key ${slotKey} has no session yet; arrive on it first`,
    {
      remedy: parent
        ? {
          tool: "collab_arrive",
          input: { purpose: "…", binding_key: slotKey, name: `${parent.actor}/${slotKey}`, parent: parent.id },
        }
        : { tool: "collab_arrive", input: { purpose: "…" } },
    },
  );
}

export function requireCredential(ctx: NoteVerbContext) {
  const binding = ctx.binding();
  if (!binding) throw notArrived(ctx.slot_key, ctx.bound_slots().find((slot) => slot.key === "")?.binding ?? null);
  if (binding.handle.cursor_recovery) {
    throw new CollabError(
      "cursor_recovery_required",
      "The host authorized recovery mode; reset to an exact journal anchor before session mutations resume",
      { ...binding.handle.cursor_recovery },
    );
  }
  return { binding, credential: binding.handle.credential };
}

/** Put this call's binding_key into a suggested call, so a named slot keeps speaking as itself. */
export function withSlot(ctx: Pick<NoteVerbContext, "slot_key">, remedy: NoteRemedy): NoteRemedy {
  if (!ctx.slot_key || !("tool" in remedy)) return remedy;
  return { tool: remedy.tool, input: { ...remedy.input, binding_key: ctx.slot_key } };
}

// ---------------------------------------------------------------------------
// Text checks the store cannot make for us

/**
 * A one-line text a verb stores: normalised as a note's Purpose is (spec 4),
 * line breaks joined with a space, then held to `max`. Half a character is
 * refused, because the stored text would differ from what was returned.
 */
export function oneLine(value: unknown, field: string, max: number, required: boolean): string | null {
  const ask = { remedy: { say: field === "purpose" ? "Say what you are here to do in one line of at most 200 characters." : `Give ${field} as one line of text.` } };
  if (value === undefined || value === null) {
    if (!required) return null;
    throw new CollabError(`invalid_${field}`, `${field} is required`, ask);
  }
  if (typeof value !== "string") throw new CollabError(`invalid_${field}`, `${field} must be text`, ask);
  const text = normalizeNoteText(value).split("\n").map((line) => line.trim()).filter(Boolean).join(" ");
  if (!text) {
    if (!required) return null;
    throw new CollabError(`invalid_${field}`, `${field} must not be empty`, ask);
  }
  if (hasLoneSurrogate(text)) {
    throw new CollabError(`invalid_${field}`, `${field} must be well-formed Unicode text (it holds half of a character)`);
  }
  if (/[\u0000-\u001f\u007f]/.test(text)) {
    throw new CollabError(`invalid_${field}`, `${field} must not hold control characters`);
  }
  if (text.length > max) {
    throw new CollabError("too_long", `${field} is ${text.length} characters; at most ${max}`, {
      field,
      max,
      actual: text.length,
      unit: "chars",
      remedy: { say: field === "purpose" ? "Say what you are here to do in one line of at most 200 characters." : `Shorten ${field} to at most ${max} characters.` },
    });
  }
  return text;
}

const PURPOSE_MAX = 200;
const NAME_MAX = 200;
const MODEL_MAX = 200;

/**
 * The actor prefix when neither a name nor the verified Claude Code name is
 * available (spec 5.1): the host family the environment shows, nothing more.
 */
export function actorPrefixFor(environment: Record<string, string | undefined>): string {
  if (environment.CLAUDE_CODE_MESSAGING_SOCKET) return "claude-code";
  if (environment.CODEX_THREAD_ID) return "codex";
  return "agent";
}

export function minutesSince(at: string, observedAt: string): number | null {
  const age = Date.parse(observedAt) - Date.parse(at);
  return Number.isFinite(age) ? Math.max(0, Math.floor(age / 60_000)) : null;
}

function durationUntil(at: string, observedAt: string): string {
  const left = Date.parse(at) - Date.parse(observedAt);
  if (!Number.isFinite(left) || left <= 0) return "closed";
  const minutes = Math.ceil(left / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

export function statementOf(text: string): string {
  const line = text.split("\n")[0] ?? "";
  if (line.length <= NOTE_STATEMENT_MAX) return line;
  // Cut between characters, never inside one: half of an emoji would make
  // the note unrenderable, and a verb renders after deciding what to write.
  let end = NOTE_STATEMENT_MAX - 1;
  const last = line.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${line.slice(0, end)}…`;
}

// ---------------------------------------------------------------------------
// collab_arrive (spec 5.1)

export interface ArriveInput {
  purpose: string;
  name?: string;
  model?: string;
  root_path?: string;
  revise_purpose?: boolean;
  parent?: string;
}

const LIST_CAP = 10;

export async function arriveVerb(ctx: NoteVerbContext, input: ArriveInput): Promise<Record<string, unknown>> {
  const purpose = oneLine(input.purpose, "purpose", PURPOSE_MAX, true)!;
  const existing = ctx.binding();
  if (existing) return arriveBound(ctx, existing, input, purpose);
  const name = oneLine(input.name, "name", NAME_MAX, false);
  const model = oneLine(input.model, "model", MODEL_MAX, false);
  const sent = { purpose, ...(name ? { name } : {}), ...(model ? { model } : {}) };
  if (input.root_path !== undefined && (typeof input.root_path !== "string" || !input.root_path.trim())) {
    throw new CollabError("invalid_root_path", "root_path must name a directory", {
      remedy: {
        tool: "collab_arrive",
        input: withSlotInput(ctx, {
          ...sent,
          ...(typeof input.parent === "string" ? { parent: input.parent } : {}),
          root_path: ROOT_PATH_PLACEHOLDER,
        }),
      },
    });
  }
  if (input.parent !== undefined && (typeof input.parent !== "string" || input.parent.length > PARENT_MAX)) {
    throw new CollabError("too_long", `parent is at most ${PARENT_MAX} characters: a session id, session# handle or name`, {
      field: "parent",
      max: PARENT_MAX,
      unit: "chars",
      remedy: { say: "Name the parent by its session id, as collab_arrive returned it." },
    });
  }
  return ctx.slot_key
    ? arriveNamed(ctx, input, purpose, name, model)
    : arriveDefault(ctx, input, sent, name, model);
}

const ROOT_PATH_PLACEHOLDER = "<your repository root>";
const PARENT_MAX = 200;

/** A suggested input that keeps the call's binding_key, as withSlot does for a whole remedy. */
function withSlotInput(ctx: Pick<NoteVerbContext, "slot_key">, input: Record<string, unknown>): Record<string, unknown> {
  return ctx.slot_key ? { ...input, binding_key: ctx.slot_key } : input;
}

/** This package's own directory: one level above src/ and dist/ alike. */
const PACKAGE_ROOT = resolve(import.meta.dir, "..");

function within(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);
}

/**
 * The root an unbound default slot joins when the caller names none (spec
 * 5.1): this server's working directory, but only when git knows it and it
 * lies outside this package. A host may start the server in its plugin
 * directory (Codex starts it with cwd "." in the installed plugin root), and
 * a session started there would sit in a workspace of its own, apart from the
 * project's agents, with nothing to show it. Those cases are refused before
 * any write, with a ready call that names the root.
 */
function defaultRootPath(sent: Record<string, unknown>): string {
  let workingDirectory: string | null = null;
  let reason: "working_directory_unreadable" | "not_a_git_worktree" | "inside_collab_package" | null = null;
  try {
    workingDirectory = realpathSync(process.cwd());
    const identity = inspectRepository(workingDirectory, undefined, true, { portable: false });
    const packageRoot = existsSync(PACKAGE_ROOT) ? realpathSync(PACKAGE_ROOT) : PACKAGE_ROOT;
    if (identity.git_common_dir_hash === null) reason = "not_a_git_worktree";
    else if (within(workingDirectory, packageRoot)) reason = "inside_collab_package";
  } catch {
    reason = "working_directory_unreadable";
  }
  if (reason === null) return workingDirectory!;
  const why = {
    working_directory_unreadable: "this MCP server's working directory cannot be read",
    not_a_git_worktree: `this MCP server's working directory (${workingDirectory}) is not inside a git worktree`,
    inside_collab_package: `this MCP server's working directory (${workingDirectory}) is inside the collab package itself, ` +
      "as when a host starts the server in its plugin directory",
  }[reason];
  throw new CollabError(
    "root_path_required",
    `root_path was not given, and ${why}; a session started there would join a workspace apart from your project's agents`,
    {
      reason,
      ...(workingDirectory ? { working_directory: workingDirectory } : {}),
      remedy: { tool: "collab_arrive", input: { ...sent, root_path: ROOT_PATH_PLACEHOLDER } },
    },
  );
}

async function arriveDefault(
  ctx: NoteVerbContext,
  input: ArriveInput,
  sent: { purpose: string; name?: string; model?: string },
  name: string | null,
  model: string | null,
): Promise<Record<string, unknown>> {
  const purpose = sent.purpose;
  if (input.parent !== undefined) {
    throw new CollabError(
      "parent_needs_binding_key",
      "A parent names the session a named child descends from; the default slot has no parent",
      { remedy: { tool: "collab_arrive", input: { purpose, binding_key: "<choose>", parent: input.parent } } },
    );
  }
  const advice: string[] = [];
  if (input.revise_purpose) advice.push("revise_purpose has nothing to revise on a new session; your purpose is recorded as given.");
  const defaulted = input.root_path === undefined;
  const rootPath = defaulted ? defaultRootPath(sent) : input.root_path!;
  let actor: string | undefined = name ?? undefined;
  if (actor === undefined) {
    try {
      actor = defaultActor(ctx.environment as NodeJS.ProcessEnv);
    } catch (error) {
      if (!(error instanceof CollabError) || error.code !== "actor_required") throw error;
    }
  }
  const handle = ctx.store.startSession({
    root_path: rootPath,
    actor,
    actor_prefix: actor === undefined ? actorPrefixFor(ctx.environment) : undefined,
    role: purpose,
    seat_ref: defaultSeatRef(ctx.environment),
    ...(model ? { model } : {}),
  });
  if (actor === undefined) {
    advice.push(`No verified host name was available, so this session is named ${handle.session.actor}. Pass name to choose one.`);
  }
  const binding = bindNewSession(ctx, handle);
  const mark = handle.workspace.event_head_sequence;
  const root = handle.worktree.root_path;
  return arrivalResult(ctx, binding, {
    effect:
      `Started session ${handle.session.id} as ${handle.session.actor} with purpose "${purpose}", in the worktree at ${root}` +
      `${defaulted ? " (root_path was not given, so this is the git worktree of this MCP server's working directory)" : ""}. ` +
      `Your read mark starts at the journal head (sequence ${mark}); the legacy cursor was not moved.`,
    advice,
    fresh: true,
    record: true,
    note: arrivalNote("I have arrived.", purpose),
  });
}

function arriveNamed(
  ctx: NoteVerbContext,
  input: ArriveInput,
  purpose: string,
  name: string | null,
  model: string | null,
): Record<string, unknown> {
  const key = ctx.slot_key;
  const held = ctx.bound_slots();
  const defaultSession = held.find((slot) => slot.key === "")?.binding.handle.session ?? null;
  if (input.parent === undefined) {
    throw new CollabError("parent_required", `A named slot (binding_key ${key}) needs parent: a session this MCP process holds`, {
      remedy: defaultSession
        ? { tool: "collab_arrive", input: { purpose, binding_key: key, parent: defaultSession.id } }
        : { tool: "collab_arrive", input: { purpose } },
    });
  }
  const parent = heldSession(held, input.parent);
  if (!parent) {
    throw new CollabError(
      "parent_not_held",
      "parent must be a session bound in this MCP process; a parent it does not hold would mint a separate voice",
      {
        parent: input.parent,
        remedy: defaultSession
          ? { tool: "collab_arrive", input: { purpose, binding_key: key, parent: defaultSession.id } }
          : { tool: "collab_arrive", input: { purpose } },
      },
    );
  }
  const actor = name ?? `${parent.handle.session.actor}/${key}`;
  if (name === null && actor.length > NAME_MAX) {
    // The caller sent no name, so the store's actor refusal would name a
    // field it never set; ask for the one field that fixes it.
    throw new CollabError("too_long", `The default name ${parent.handle.session.actor.slice(0, 40)}…/${key} is ${actor.length} characters; at most ${NAME_MAX}`, {
      field: "name",
      max: NAME_MAX,
      actual: actor.length,
      unit: "chars",
      remedy: {
        tool: "collab_arrive",
        input: { purpose, binding_key: key, parent: parent.handle.session.id, name: "<shorter>" },
      },
    });
  }
  // Exactly collab_session_start's attestation: the parent counts only when
  // this process holds it in one of its own slots.
  const parentAttested = held.some((slot) => slot.binding.handle.session.id === parent.handle.session.id);
  const handle = ctx.store.startSession({
    root_path: input.root_path ?? parent.handle.worktree.root_path,
    actor,
    role: purpose,
    parent_session_id: parent.handle.session.id,
    parent_attested: parentAttested,
    seat_ref: defaultSeatRef(ctx.environment),
    ...(model ? { model } : {}),
  });
  const binding = bindNewSession(ctx, handle);
  const speaksAs = defaultSession ? `session ${defaultSession.id}` : "no session (the default slot has not arrived)";
  return arrivalResult(ctx, binding, {
    effect:
      `Started session ${handle.session.id} as ${handle.session.actor}, a named child of ${parent.handle.session.id}, ` +
      `in the worktree at ${handle.worktree.root_path}. ` +
      `This session shares its parent's voice and ballot unit. Send binding_key ${key} on every call; ` +
      `without it you speak as ${speaksAs}.`,
    advice: [],
    fresh: true,
    record: true,
    note: arrivalNote("I have arrived.", purpose),
  });
}

/** A session this MCP process holds, by id, `session#` handle or display name. */
function heldSession(held: Array<{ key: string; binding: NoteBinding }>, ref: string): NoteBinding | null {
  const text = typeof ref === "string" ? ref.trim() : "";
  const handle = /^session#([0-9a-f]{6,8})$/i.exec(text);
  const matches = held.filter(({ binding }) => {
    const session = binding.handle.session;
    return handle
      ? session.id.startsWith(`session_${handle[1]!.toLowerCase()}`)
      : session.id === text || session.actor === text;
  });
  if (matches.length > 1) {
    throw new CollabError("ambiguous_session", `${text} names more than one session this process holds; use its id`, {
      candidates: matches.map(({ key, binding }) => ({ session: binding.handle.session.id, name: binding.handle.session.actor, binding_key: key || null })),
    });
  }
  return matches[0]?.binding ?? null;
}

/**
 * Start-up shared by both new-session paths: the read mark at the head the
 * session joined at, then the credential file exactly as collab_session_start
 * writes it, ending the session if the file cannot be written.
 */
function bindNewSession(ctx: NoteVerbContext, handle: SessionHandle): NoteBinding {
  const credentialFile = ctx.store.defaultSessionCredentialPath(handle.session.id);
  try {
    // The head inside the start transaction is this session's own
    // session.joined event, so nothing addressed to it can fall before it.
    ctx.store.initNoteMark(handle.credential, handle.workspace.event_head_sequence);
    const path = writeSessionCredentialFile(credentialFile, handle.credential);
    const binding = { handle, credential_file: path };
    ctx.bind(binding);
    return binding;
  } catch (error) {
    try {
      ctx.store.endSession({ ...handle.credential, reason: "credential_file_write_failed" });
    } catch {
      // Keep the original error. The token was never returned, stored or logged.
    }
    try {
      removeSessionCredentialFile(credentialFile);
    } catch {
      // Nothing was written, or it is already gone.
    }
    throw error;
  }
}

async function arriveBound(
  ctx: NoteVerbContext,
  binding: NoteBinding,
  input: ArriveInput,
  purpose: string,
): Promise<Record<string, unknown>> {
  const { credential } = requireCredential(ctx);
  const advice: string[] = [];
  const ignored = (["name", "model", "root_path", "parent"] as const).filter((field) => input[field] !== undefined);
  if (ignored.length > 0) {
    advice.push(`${ignored.join(", ")} apply only when a slot first arrives; this slot already speaks as session ${binding.handle.session.id}.`);
  }
  const root = `Worktree root: ${binding.handle.worktree.root_path}.`;
  if (input.revise_purpose !== true) {
    const before = ctx.store.arrivalBrief(credential).session;
    return arrivalResult(ctx, binding, {
      effect:
        `You are speaking as session ${before.id} (name ${before.actor}, purpose ${before.purpose ?? "none declared"}). ` +
        `${root} Nothing was written.`,
      advice,
      fresh: false,
      record: false,
      note: arrivalNote("I am here.", before.purpose),
      remedies: boundRemedies(ctx, before.id, purpose),
    });
  }
  const { plan, replayed, receipt } = await underPlan(ctx, credential, {
    tool: "collab_arrive",
    input: { purpose },
    entity: "purpose",
    retry_input: { purpose, revise_purpose: true },
  }, (plan) => {
    const replayed = plan.retry ? replayReceipt<{ purpose: string; sequence: number }>(ctx.store, credential, plan.key) : null;
    const receipt = replayed
      ?? ctx.store.declarePurposeForSession({ ...credential, idempotency_key: plan.key, purpose, receipt_plan: plan.guard });
    return { plan, replayed, receipt };
  });
  if (plan.retry) advice.push("This repeats your latest purpose declaration exactly, so it was read as a retry. Add a word to say it again.");
  const session = binding.handle.session;
  return arrivalResult(ctx, binding, {
    effect:
      `You are speaking as session ${session.id} (name ${session.actor}, purpose ${receipt.purpose}). ${root} ` +
      `Your purpose is recorded as declared at sequence ${receipt.sequence}; the role you started with is kept as it was.`,
    advice,
    fresh: false,
    record: true,
    replayed: replayed !== null,
    note: arrivalNote("My purpose has changed.", receipt.purpose),
    remedies: boundRemedies(ctx, session.id, purpose),
  });
}

function boundRemedies(ctx: NoteVerbContext, sessionId: string, purpose: string): NoteRemedy[] {
  return [
    withSlot(ctx, { tool: "collab_arrive", input: { purpose, revise_purpose: true } }),
    { tool: "collab_arrive", input: { purpose, binding_key: "<choose>", parent: sessionId } },
  ];
}

function arrivalNote(statement: string, purpose: string | null): string {
  return renderNote({ act: "note", statement, ...(purpose ? { purpose } : {}) });
}

function arrivalResult(
  ctx: NoteVerbContext,
  binding: NoteBinding,
  options: {
    effect: string;
    advice: string[];
    fresh: boolean;
    record: boolean;
    note: string;
    replayed?: boolean;
    remedies?: NoteRemedy[];
  },
): Record<string, unknown> {
  const credential = binding.handle.credential;
  const data = ctx.store.arrivalBrief(credential);
  // A new session has nothing for it yet; an arrived one sees what is
  // after its mark without moving it (arrive never reads the inbox for you).
  const pending = options.fresh
    ? null
    : ctx.store.inboxForSession({ ...credential, limit: LIST_CAP, include: "for_me", peek: true });
  const brief = composeBrief(ctx, data, pending, binding.handle.worktree.root_path);
  if (options.record) {
    ctx.store.recordArrivalShown(credential, brief.shown);
  }
  return {
    ...noteWriteResult({
      effect: options.effect,
      ids: {
        session: data.session.id,
        session_handle: handleOf("session", data.session.id),
        workspace_id: data.workspace.id,
      },
      advice: [...options.advice, ...brief.advice],
      next: withSlot(ctx, { tool: "collab_inbox", input: {} }),
      note: options.note,
      replayed: options.replayed,
    }),
    ...(options.remedies ? { remedies: options.remedies } : {}),
    ...brief.view,
  };
}

function composeBrief(
  ctx: NoteVerbContext,
  data: NoteArrivalData,
  pending: NoteInboxData | null,
  rootPath: string,
): { view: Record<string, unknown>; shown: string[]; advice: string[] } {
  const me = data.session;
  const at = data.observed_at;
  const byId = new Map(data.sessions.map((view) => [view.id, view]));
  const holds = (sessionId: string) => data.tasks
    .filter((task) => task.status === "claimed" && task.assignee_session_id === sessionId)
    .map((task) => handleOf("task", task.id));
  const here = data.sessions
    .filter((view) => view.id !== me.id && view.status === "active" && view.liveness === "live")
    .map((view) => ({
      session: view.id,
      name: view.actor,
      purpose: view.purpose,
      model: view.model,
      last_seen_minutes: minutesSince(view.last_seen_at, at),
      holds: holds(view.id),
      same_seat_as_you: me.seat_ref !== null && view.seat_ref === me.seat_ref,
    }));
  const claimable = data.tasks.filter((task) => data.claimable_task_ids.includes(task.id)).map((task) => ({
    task: handleOf("task", task.id),
    id: task.id,
    title: task.title,
    paths: task.path_scopes,
  }));
  const inProgress = data.tasks.filter((task) => task.status === "claimed").map((task) => ({
    task: handleOf("task", task.id),
    id: task.id,
    title: task.title,
    by: task.assignee,
    purpose: task.assignee_session_id ? byId.get(task.assignee_session_id)?.purpose ?? null : null,
    paths: task.path_scopes,
  }));
  const reviewTasks = data.tasks.filter((task) => task.effective_status === "reported_complete");
  const reviewsWanted = reviewTasks.map((task) => ({
    task: handleOf("task", task.id),
    id: task.id,
    title: task.title,
    by: task.reported_by,
    completion: task.completion_report_id
      ? { id: task.completion_report_id, handle: handleOf("report", task.completion_report_id) }
      : null,
    you_may_review: task.reported_by_session_id !== me.id,
  }));
  const proposals = data.proposals.map((status) => ({
    id: status.proposal.id,
    handle: handleOf("proposal", status.proposal.id),
    question: statementOf(status.proposal.body),
    position: status.ai.position,
    closes_in: durationUntil(status.terms.closes_at, at),
    your_voice_awaited: status.ai.awaiting_voice_ids.includes(me.voice_id),
    person: status.person.state,
  }));
  const challenges = data.challenges.map((challenge) => challengeView(challenge, data.proposals.some(
    (status) => status.proposal.id === challenge.target_report_id,
  )));
  const recheck = evidenceRechecker(ctx.store);
  const forYou = pending ? pending.entries.map((entry) => formatEntry(entry, byId, me.id, recheck)) : [];
  const waiting = data.waiting.map((entry) => formatWaiting(ctx, entry));
  const cap = <T>(items: T[]) => items.slice(0, LIST_CAP);
  const shown = [
    ...cap(proposals).map((proposal) => proposal.id),
    ...cap(reviewsWanted).flatMap((review) => (review.completion ? [review.completion.id] : [])),
    ...noteWaitingShownItems(cap(data.waiting)),
  ];
  const advice: string[] = [];
  if (pending?.more) advice.push("More is waiting for you than this brief lists; read it with collab_inbox.");
  return {
    shown,
    advice,
    view: {
      you: {
        session: me.id,
        name: me.actor,
        voice: me.voice_id,
        seat_ref: me.seat_ref,
        workspace_id: me.workspace_id,
        // The worktree this session joined, so a wrong root is visible at once.
        root_path: rootPath,
        purpose: me.purpose,
        model: me.model,
        basis: {
          session: "holds this session's credential file",
          name: "self-declared",
          model: "self-declared",
          seat_ref: "declared at session start (host or caller); unverified",
        },
      },
      here: cap(here),
      open: {
        claimable: cap(claimable),
        in_progress: cap(inProgress),
        reviews_wanted: cap(reviewsWanted),
        proposals: cap(proposals),
        ballots: [],
        challenges: cap(challenges),
      },
      for_you: cap(forYou),
      waiting_on_you: cap(waiting),
      totals: {
        here: here.length,
        claimable: claimable.length,
        in_progress: inProgress.length,
        reviews_wanted: reviewsWanted.length,
        proposals: proposals.length,
        ballots: 0,
        challenges: challenges.length,
        // Every for-me item after the mark within one scan's bound; a lower
        // bound when the scan stopped there.
        for_you: pending?.for_me_total ?? 0,
        for_you_more: pending?.more ?? false,
        for_you_at_least: pending?.for_me_total_capped ?? false,
        waiting_on_you: waiting.length,
      },
      history: {
        events: data.workspace.event_head_sequence,
        reports: data.report_count,
        since: data.workspace.created_at,
      },
      listen: { how: listenHow(ctx, me.id) },
      surface: {
        version: COLLAB_PACKAGE_VERSION,
        tools: ctx.profile,
        capabilities: [...NOTE_CAPABILITIES],
      },
      card: NOTE_CARD,
    },
  };
}

function challengeView(challenge: NoteChallengeView, onProposal: boolean) {
  return {
    id: challenge.id,
    handle: handleOf("report", challenge.id),
    on: reportHandle(challenge.target_report_id, onProposal),
    on_id: challenge.target_report_id,
    by: challenge.from_actor,
    standing: challenge.standing,
    ...(challenge.answered_by_another_voice ? { answered_by_another_voice: true } : {}),
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * How this session can be told when something arrives (spec 5.1 listen).
 * Under Claude Code: the existing doorbell watcher with absolute paths and
 * this session filled in, never --from-cursor, for the agent to run itself.
 * Collab starts nothing. Under the notes profile it is the inbox wait,
 * because the watcher's ring still names collab_events_wait and
 * collab_events_since, which that profile does not register.
 */
export function listenHow(ctx: NoteVerbContext, sessionId: string): string {
  const inboxWait = ctx.slot_key
    ? `collab_inbox {wait_seconds: 30, binding_key: "${ctx.slot_key}"}`
    : "collab_inbox {wait_seconds: 30}";
  const database = ctx.store.db.filename;
  if (ctx.profile === "notes") return inboxWait;
  if (!ctx.environment.CLAUDE_CODE_MESSAGING_SOCKET || !database || database === ":memory:") return inboxWait;
  // One level below the package root, in src/ and in dist/ alike.
  const watcher = resolve(import.meta.dir, "..", "integrations", "claude-code", "collab-doorbell-watch.ts");
  const host = resolve(import.meta.dir, "..", "dist", "agenttool-collab-host.js");
  if (!existsSync(watcher) || !existsSync(host)) return inboxWait;
  return `nohup ${shellQuote(process.execPath)} ${shellQuote(watcher)} --session ${sessionId} ` +
    `--db ${shellQuote(database)} --host-bin ${shellQuote(host)} >/dev/null 2>&1 &`;
}

// ---------------------------------------------------------------------------
// Inbox items

const RELATION_ACTS: Record<CollabReport["relation"], NoteAct | "corrects" | "supersedes"> = {
  informs: "note",
  supports: "support",
  challenges: "challenge",
  resolves: "resolve",
  withdraws: "withdraw",
  corrects: "corrects",
  supersedes: "supersedes",
};

/** The act a stored report performs, from its relation and kind, never from its text (spec 4). */
function reportAct(report: CollabReport, termed: boolean): string {
  if (termed) return "propose";
  if (report.relation === "informs" && report.kind === "decision") return "decide";
  return RELATION_ACTS[report.relation];
}

interface FormattedEvidence {
  n: number;
  kind: string;
  locator: string;
}

function journalEvidence(refs: string[]): FormattedEvidence[] {
  return refs.map((ref, index) => {
    const colon = ref.indexOf(":");
    return { n: index + 1, kind: ref.slice(0, colon), locator: ref.slice(colon + 1) };
  });
}

function sessionRef(sessionId: string | null | undefined, fallbackName: string, byId: Map<string, NoteSessionView>) {
  return { session: sessionId ?? null, name: sessionId ? byId.get(sessionId)?.actor ?? fallbackName : fallbackName };
}

/** At most this much is re-hashed for evidence[].now in one call (spec 5.2). */
export const NOTE_RECHECK_MAX_BYTES = 64 * 1024 * 1024;

export type EvidenceNow = "same" | "changed" | "missing" | "unavailable" | "not_rechecked";
export type EvidenceRecheck = (worktreeId: string | null, item: NoteCitedItem) => EvidenceNow;

/**
 * evidence[].now (spec 5.2): a server-hashed file cite re-hashed against the
 * citing session's recorded worktree, not the reader's, through the same
 * containment as the first hash. One budget per call. It reads files only,
 * outside any transaction, and is information, not a verdict.
 */
export function evidenceRechecker(store: CollabStore, budgetBytes = NOTE_RECHECK_MAX_BYTES): EvidenceRecheck {
  let remaining = budgetBytes;
  return (worktreeId, item) => {
    if (!worktreeId) return "unavailable";
    const root = store.noteWorktreeRoot(worktreeId);
    if (!root || !existsSync(root)) return "unavailable";
    if (remaining <= 0) return "not_rechecked";
    const max = Math.min(MAX_CITED_FILE_BYTES, remaining);
    const hashed = hashWorktreeFile(root, item.locator, max);
    switch (hashed.status) {
      case "hashed":
        remaining -= hashed.size;
        return hashed.sha256 === item.sha256 ? "same" : "changed";
      case "missing":
        return "missing";
      case "too_large":
        // Over what is left of the budget, not necessarily over the cap.
        return max < MAX_CITED_FILE_BYTES ? "not_rechecked" : "changed";
      case "unreadable":
        return "unavailable";
      default:
        // Now a link, a directory, or changing under the read: not the bytes that were cited.
        return "changed";
    }
  };
}

type NoteCite = NonNullable<NoteEntry["cited"]>;

/**
 * Whether a cited item is the observation of this Evidence line: same
 * position is not enough, the kind and what it points at must agree too.
 * The verbs store a hashed file's line by the path that was hashed, so an
 * honest note always matches.
 */
function itemMatchesLine(item: NoteCitedItem, kind: string, locator: string): boolean {
  if (item.kind !== kind) return false;
  if (kind !== "file") return item.locator === locator;
  const { path, from, to } = fileLocatorParts(locator);
  const lines = from === null ? undefined : to !== null && to !== from ? `${from}-${to}` : `${from}`;
  return item.locator === path && item.lines === lines;
}

/** One cited item as a reader sees it, re-checked when the server hashed it (spec 5.2). */
function citedItemView(item: NoteCitedItem, cite: NoteCite, recheck: EvidenceRecheck | undefined, detail: boolean): Record<string, unknown> {
  const serverFile = item.kind === "file" && item.observed === "server";
  return {
    n: item.n,
    kind: item.kind,
    locator: item.locator,
    observed: item.observed,
    ...(item.sha256 !== undefined && item.observed === "server" ? { sha256: item.sha256 } : {}),
    // Without a line of its own to read them from, the range and exit status are shown here.
    ...(detail && item.lines !== undefined ? { lines: item.lines } : {}),
    ...(detail && item.exit !== undefined ? { exit: item.exit } : {}),
    ...(serverFile && recheck ? { now: recheck(cite.worktree_id, item) } : {}),
  };
}

/** An `event:` pointer to a cite its own author recorded carries that cite's items, as observed. */
function authorCiteOf(kind: string, locator: string, cites: NoteCite[], recheck?: EvidenceRecheck): Record<string, unknown> {
  if (kind !== "event") return {};
  const cite = cites.find((candidate) => candidate.event_id === locator);
  return cite ? { cited: cite.items.map((item) => citedItemView(item, cite, recheck, true)) } : {};
}

/** A marked note's Evidence lines as items, with how each was observed (spec 5.2). */
function markedEvidence(lines: string[], entry: NoteEntry, recheck?: EvidenceRecheck): Array<Record<string, unknown>> {
  const cited = entry.cited;
  const items = new Map((cited?.items ?? []).map((item) => [item.n, item]));
  return lines.map((line, index) => {
    const n = index + 1;
    let kind = "text";
    let locator = line;
    try {
      const evidence = parseEvidence(line);
      kind = evidence.kind;
      locator = evidence.locator;
    } catch {
      // Shown as text; it was a note body's line, not a pointer collab can follow.
    }
    const found = items.get(n);
    const item = found !== undefined && itemMatchesLine(found, kind, locator) ? found : undefined;
    const journal = (NOTE_JOURNAL_EVIDENCE_KINDS as readonly string[]).includes(kind);
    if (item && cited) return { ...citedItemView(item, cited, recheck, false), n, kind, locator };
    return { n, kind, locator, observed: journal ? "journal" : "caller", ...authorCiteOf(kind, locator, entry.author_cites, recheck) };
  });
}

/** Evidence refs as items; a pointer to a cite the report's author recorded lists that cite's items. */
function refEvidence(refs: string[], entry: NoteEntry, recheck?: EvidenceRecheck): Array<Record<string, unknown>> {
  return journalEvidence(refs).map((item) => ({ ...item, ...authorCiteOf(item.kind, item.locator, entry.author_cites, recheck) }));
}

/** One inbox entry as an item (spec 5.2): it names the entity the next call takes. */
export function formatEntry(
  entry: NoteEntry,
  byId: Map<string, NoteSessionView>,
  me: string,
  recheck?: EvidenceRecheck,
): Record<string, unknown> {
  const { event, report } = entry;
  const payload = event.payload as Record<string, unknown>;
  const from = sessionRef(event.session_id, event.actor, byId);
  const base = {
    sequence: event.sequence,
    at: event.occurred_at,
    why_you: entry.why_you,
    for_me: entry.for_me,
  };
  if (event.type === "report.posted" && report) {
    const act = reportAct(report, entry.termed);
    let statement = statementOf(report.body);
    let text: string | null = report.body;
    let why: NoteReason[] = [];
    let evidence: Array<Record<string, unknown>> = refEvidence(report.evidence_refs, entry, recheck);
    let limits = report.limits;
    const flags: Record<string, unknown> = {};
    if (entry.marked) {
      // Only a marked body is read as a note; its act, target and addressee still come from storage.
      const parsed = parseNote(report.body);
      if (parsed.act !== null) {
        statement = parsed.statement;
        text = parsed.body;
        why = parsed.why;
        // Why cites count the note's own Evidence lines, so those are the list;
        // the target and the cite event it also points at are in re and observed.
        evidence = markedEvidence(parsed.evidence, entry, recheck);
        limits = parsed.limits ?? report.limits;
        if (parsed.via) flags.via = parsed.via;
        if (parsed.act !== act) flags.act_mismatch = { stored: act, written: parsed.act };
      }
    }
    const to = report.to_session_id
      ? sessionRef(report.to_session_id, report.to_session_id, byId)
      : entry.to_person ? "person" : "all";
    // A decision or a note about a proposal targets nothing; the proposal it
    // is about is in storage too (about_proposal_id), so it is named.
    const aboutProposal = typeof payload.about_proposal_id === "string" ? payload.about_proposal_id : null;
    const re = report.target_report_id
      ? { id: report.target_report_id, handle: handleOf("report", report.target_report_id) }
      : aboutProposal ? { id: aboutProposal, handle: handleOf("proposal", aboutProposal) }
        : report.task_id ? { id: report.task_id, handle: handleOf("task", report.task_id) } : null;
    return {
      id: report.id,
      handle: reportHandle(report.id, entry.termed),
      act,
      ...(act === "corrects" || act === "supersedes" ? { relation: report.relation } : {}),
      from: { session: report.from_session_id, name: report.from_actor },
      to,
      re,
      ...base,
      statement,
      text,
      why,
      evidence,
      kind: report.kind,
      ...(report.confidence !== "unknown" ? { confidence: report.confidence } : {}),
      ...(limits ? { limits } : {}),
      ...flags,
    };
  }
  const taskHandle = entry.task ? handleOf("task", entry.task.id) : null;
  const taskTitle = entry.task?.title ?? "a task";
  switch (event.type) {
    case "proposal.opened":
      return {
        id: event.entity_id,
        handle: handleOf("proposal", event.entity_id),
        act: "propose",
        from,
        to: "voices",
        re: null,
        ...base,
        statement: report ? statementOf(report.body) : "A proposal was opened.",
        text: report?.body ?? null,
        why: [],
        evidence: report ? refEvidence(report.evidence_refs, entry, recheck) : [],
        criteria: payload.criteria ?? null,
        extent: payload.extent ?? null,
        closes_at: payload.closes_at ?? null,
      };
    case "proposal.agreed":
    case "proposal.rejected": {
      const act = (payload.person_act ?? {}) as Record<string, unknown>;
      const agreed = event.type === "proposal.agreed";
      const basis = typeof act.basis === "string" ? act.basis : "unknown";
      return {
        id: event.entity_id,
        handle: handleOf("proposal", event.entity_id),
        act: agreed ? "agree" : "reject",
        from: basis === "relayed_by_session" ? from : { session: null, name: "person" },
        to: "voices",
        re: { id: event.entity_id, handle: handleOf("proposal", event.entity_id) },
        ...base,
        statement: agreed
          ? `The person agreed to ${handleOf("proposal", event.entity_id)} (${basis}).`
          : basis === "relayed_by_session"
            ? `A rejection of ${handleOf("proposal", event.entity_id)} was relayed by ${from.name}; a relayed no can only stop work.`
            : `The person rejected ${handleOf("proposal", event.entity_id)} (${basis}).`,
        text: typeof act.reason === "string" ? act.reason : null,
        why: [],
        evidence: [],
        basis,
      };
    }
    case "task.reported_complete":
      return {
        id: event.entity_id,
        handle: taskHandle ?? event.entity_id,
        act: "done",
        from,
        to: sessionRef(me, me, byId),
        re: { id: event.entity_id, handle: taskHandle ?? event.entity_id },
        ...base,
        statement: `The completion of ${taskTitle} is ready for review.`,
        text: typeof payload.summary === "string" ? payload.summary : null,
        why: [],
        evidence: [],
        completion: typeof payload.completion_report_id === "string"
          ? { id: payload.completion_report_id, handle: handleOf("report", payload.completion_report_id) }
          : null,
      };
    case "task.accepted":
    case "task.changes_requested":
      return {
        id: event.entity_id,
        handle: taskHandle ?? event.entity_id,
        act: event.type === "task.accepted" ? "accept" : "request_changes",
        from,
        to: sessionRef(me, me, byId),
        re: { id: event.entity_id, handle: taskHandle ?? event.entity_id },
        ...base,
        statement: typeof payload.summary === "string" ? statementOf(payload.summary) : `A verdict on ${taskTitle}.`,
        text: typeof payload.summary === "string" ? payload.summary : null,
        why: [],
        evidence: typeof payload.review_report_id === "string"
          ? [{ n: 1, kind: "report", locator: payload.review_report_id }]
          : [],
      };
    default:
      return {
        id: event.entity_id,
        handle: taskHandle ?? event.entity_id,
        act: "event",
        type: event.type,
        from,
        to: entry.for_me ? sessionRef(me, me, byId) : "all",
        re: taskHandle ? { id: entry.task!.id, handle: taskHandle } : null,
        ...base,
        statement: eventSubject(event.type, taskHandle, taskTitle, from.name),
        text: null,
        why: [],
        evidence: [],
      };
  }
}

function eventSubject(type: string, taskHandle: string | null, title: string, by: string): string {
  const task = taskHandle ? `${taskHandle} (${title})` : "a task";
  switch (type) {
    case "handoff.offered": return `${by} offered you ${task}.`;
    case "handoff.accepted": return `${by} accepted your handoff of ${task}.`;
    case "handoff.declined": return `${by} declined your handoff of ${task}.`;
    case "handoff.expired": return `Your handoff of ${task} expired.`;
    case "task.recovered": return `${by} recovered your expired lease on ${task}.`;
    default: return `${type}${taskHandle ? ` on ${task}` : ""} by ${by}.`;
  }
}

/** An unaddressed event as a subject line only (spec 5.2, include: all). */
function subjectLine(entry: NoteEntry, byId: Map<string, NoteSessionView>, me: string): Record<string, unknown> {
  const item = formatEntry(entry, byId, me);
  return {
    id: item.id,
    handle: item.handle,
    act: item.act,
    ...(item.type ? { type: item.type } : {}),
    from: item.from,
    at: item.at,
    sequence: item.sequence,
    statement: item.statement,
    for_me: false,
  };
}

function formatWaiting(ctx: NoteVerbContext, entry: NoteWaitingEntry): Record<string, unknown> {
  const handle = handleOf(entry.ref_kind, entry.ref_id);
  const about = entry.about_id
    ? { id: entry.about_id, handle: entry.what === "review" || entry.what === "challenge" || entry.what === "answer"
      ? handleOf("report", entry.about_id) : entry.about_id }
    : null;
  const next: NoteRemedy = entry.what === "stop"
    ? { say: `Stop work that rests on ${handle} (${entry.ref_id}): the person's latest act on it is a rejection.` }
    : entry.what === "record_decision"
      ? withSlot(ctx, {
        tool: "collab_note",
        input: { act: "decide", re: exactRef("proposal", entry.ref_id), text: "<what is decided, within the agreed extent>" },
      })
      : withSlot(ctx, {
      tool: "collab_inbox",
      input: {
        about: entry.what === "answer" && entry.about_id ? exactRef("report", entry.about_id) : exactRef(entry.ref_kind, entry.ref_id),
      },
    });
  return {
    what: entry.what,
    ref: handle,
    id: entry.ref_id,
    ...(about ? { about } : {}),
    by: entry.by,
    due: entry.due,
    at: entry.at,
    summary: entry.summary,
    next,
  };
}

// ---------------------------------------------------------------------------
// collab_inbox (spec 5.2)

export interface InboxInput {
  about?: string;
  wait_seconds?: number;
  include?: string;
  limit?: number;
  format?: string;
}

const DEFAULT_INBOX_LIMIT = 20;
const WAIT_POLL_MS = 250;
const WAIT_MAX_SECONDS = 30;
const ABOUT_MAX = 300;

/** The caller's input with one field set to a value that works, as a ready call. */
function inboxRetry(ctx: NoteVerbContext, input: InboxInput, field: keyof InboxInput, value: unknown): NoteRemedy {
  const { [field]: _dropped, ...rest } = input;
  return withSlot(ctx, { tool: "collab_inbox", input: { ...rest, [field]: value } });
}

/** A number the caller sent, brought to the nearest whole value in [min, max]. */
function nearest(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : min;
}

/**
 * The inbox input, checked here rather than in the MCP schema, so every
 * refusal carries the verbs' {code, message, remedy} (spec 5).
 */
function validInboxInput(ctx: NoteVerbContext, input: InboxInput) {
  const waitSeconds = input.wait_seconds ?? 0;
  if (typeof waitSeconds !== "number" || !Number.isInteger(waitSeconds) || waitSeconds < 0 || waitSeconds > WAIT_MAX_SECONDS) {
    throw new CollabError("invalid_wait_seconds", `wait_seconds must be a whole number from 0 to ${WAIT_MAX_SECONDS}`, {
      remedy: inboxRetry(ctx, input, "wait_seconds", typeof waitSeconds === "number" ? nearest(waitSeconds, 0, WAIT_MAX_SECONDS) : 0),
    });
  }
  const limit = input.limit ?? DEFAULT_INBOX_LIMIT;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > NOTE_INBOX_MAX_LIMIT) {
    throw new CollabError("invalid_limit", `limit must be a whole number from 1 to ${NOTE_INBOX_MAX_LIMIT}`, {
      remedy: inboxRetry(ctx, input, "limit", typeof limit === "number" ? nearest(limit, 1, NOTE_INBOX_MAX_LIMIT) : DEFAULT_INBOX_LIMIT),
    });
  }
  const include = input.include ?? "for_me";
  if (include !== "for_me" && include !== "all") {
    throw new CollabError("invalid_include", "include must be for_me or all", {
      remedy: { say: "include is for_me (the default: items for you) or all (also every other new item, as subject lines)." },
    });
  }
  const format = input.format ?? "json";
  if (format !== "json" && format !== "note") {
    throw new CollabError("invalid_format", "format must be json or note", {
      remedy: { say: "format is json (the default) or note (with about: the thread as one collab-note/1 text)." },
    });
  }
  let about: string | null = null;
  if (input.about !== undefined) {
    about = typeof input.about === "string" ? input.about.trim() : "";
    if (!about) {
      throw new CollabError("invalid_about", "about must name a report, proposal or task", {
        remedy: { say: "Pass an id or handle such as report#3fa91c or task#0b12de, or leave about out to read your inbox." },
      });
    }
    if (about.length > ABOUT_MAX) {
      throw new CollabError("too_long", `about is ${about.length} characters; at most ${ABOUT_MAX}`, {
        field: "about",
        max: ABOUT_MAX,
        actual: about.length,
        unit: "chars",
        remedy: { say: "Pass the id or handle exactly as an earlier result gave it." },
      });
    }
  }
  return { waitSeconds, limit, include: include as "for_me" | "all", format: format as "json" | "note", about };
}

export async function inboxVerb(ctx: NoteVerbContext, input: InboxInput): Promise<Record<string, unknown>> {
  const { binding, credential } = requireCredential(ctx);
  const { waitSeconds, limit, include, format, about } = validInboxInput(ctx, input);
  if (about !== null) return aboutView(ctx, binding, about, format);
  // A wait takes its place in the endpoint's one budget before anything is
  // written: refused after the first pass, the call would have moved the
  // mark past what it counted and returned none of it.
  const waits = waitSeconds > 0;
  if (waits && ctx.waits.active >= ctx.waits.max) {
    throw new CollabError("too_many_waits", `At most ${ctx.waits.max} waits may run per endpoint`);
  }
  if (waits) ctx.waits.active += 1;
  try {
    const first = ctx.store.inboxForSession({ ...credential, limit, include });
    const passes: NoteInboxData[] = [first];
    let waited: Record<string, unknown> | null = null;
    let waitError: CollabError | null = null;
    if (waits && !first.entries.some((entry) => entry.for_me) && !first.more) {
      const started = performance.now();
      const seconds = () => Math.round((performance.now() - started) / 100) / 10;
      // From here on the first pass has written (mark, last-seen, delivery
      // records), so a failure must not discard what it found.
      try {
        const arrived = await waitForMe(ctx, binding, first.mark.anchor, waitSeconds * 1_000);
        waited = { seconds: seconds(), ended_by: arrived ? "item" : "timeout" };
        // The first pass already moved the mark past what it listed and
        // counted, so its subject lines, its count and what it said about
        // the mark are kept, ahead of the second pass's items.
        if (arrived) passes.push(ctx.store.inboxForSession({ ...credential, limit, include }));
      } catch (error) {
        if (error instanceof CollabError && error.code === "wait_cancelled") {
          throw new CollabError(error.code, error.message, {
            first_pass: inboxResult(ctx, passes, format, null),
          });
        }
        waitError = error instanceof CollabError
          ? error
          : new CollabError("internal_error", error instanceof Error ? error.message : String(error));
        waited = { seconds: seconds(), ended_by: "error", code: waitError.code, message: waitError.message };
      }
    }
    return inboxResult(ctx, passes, format, waited, waitError);
  } finally {
    if (waits) ctx.waits.active -= 1;
  }
}

/** One inbox result from its passes (one, or the first and the one after a wait). */
function inboxResult(
  ctx: NoteVerbContext,
  passes: NoteInboxData[],
  format: "json" | "note",
  waited: Record<string, unknown> | null,
  waitError: CollabError | null = null,
): Record<string, unknown> {
  const data = passes.at(-1)!;
  const byId = new Map(data.sessions.map((view) => [view.id, view]));
  const me = data.session.id;
  const entries = passes.flatMap((pass) => pass.entries);
  const recheck = evidenceRechecker(ctx.store);
  const items = entries.map((entry) =>
    entry.for_me ? formatEntry(entry, byId, me, recheck) : subjectLine(entry, byId, me));
  const advice: string[] = [];
  if (format === "note") advice.push("format: note renders one thread; pass about with an id or handle.");
  if (passes.some((pass) => pass.mark.clamped)) advice.push(MARK_CLAMPED_ADVICE);
  if (waitError) {
    advice.push(
      `The wait ended with ${waitError.code}: ${waitError.message}. What this call's first pass found is returned; your read mark is past it.` +
        (waitError.details.after_housekeeping === true
          ? " A second pass had moved the mark further before it failed, and its items are not in this result."
          : ""),
    );
  }
  const firstForMe = entries.find((entry) => entry.for_me);
  const about = firstForMe ? entryRef(firstForMe) : null;
  const next: NoteRemedy = waitError
    ? withSlot(ctx, noteRemedyOf(waitError))
    : about
      ? withSlot(ctx, { tool: "collab_inbox", input: { about } })
      : data.more
        ? withSlot(ctx, { tool: "collab_inbox", input: {} })
        : withSlot(ctx, { tool: "collab_inbox", input: { wait_seconds: WAIT_MAX_SECONDS } });
  const initialisedFrom = passes.map((pass) => pass.mark.initialised_from).find((value) => value) ?? null;
  return {
    ok: true,
    items,
    also_new: { count: passes.reduce((sum, pass) => sum + pass.also_new, 0) },
    more: data.more,
    read_through: { sequence: data.mark.through, head: data.head_sequence },
    ...(initialisedFrom ? { mark_initialised_from: initialisedFrom } : {}),
    waiting_on_you: data.waiting.map((entry) => formatWaiting(ctx, entry)),
    ...(waited ? { waited } : {}),
    advice,
    next,
  };
}

const MARK_CLAMPED_ADVICE =
  "Your read mark was past the journal head (the journal may have been restored from an older copy); it now reads from the head.";

/**
 * The exact reference of the entity an inbox entry concerns, for a ready
 * about call: the report or proposal posted, or the task an event is about.
 * Null when it concerns nothing collab_inbox can show as a thread.
 */
function entryRef(entry: NoteEntry): string | null {
  const { event, report } = entry;
  if (event.type === "report.posted") return report ? exactRef("report", report.id) : null;
  if (event.type.startsWith("proposal.")) return exactRef("proposal", event.entity_id);
  if (event.type.startsWith("task.")) return exactRef("task", event.entity_id);
  return entry.task ? exactRef("task", entry.task.id) : null;
}

/**
 * Wait for a for-me event after `anchor`, reading only (spec 5.2): it uses
 * the same read-only page as collab_events_wait, refreshes nothing and writes
 * nothing. Entries already waiting on the session never end it. The caller
 * holds the wait's place in the endpoint's budget.
 */
async function waitForMe(
  ctx: NoteVerbContext,
  binding: NoteBinding,
  anchor: { epoch_id: string; sequence: number; hash: string },
  durationMs: number,
): Promise<boolean> {
  const sessionId = binding.handle.session.id;
  const workspaceId = binding.handle.workspace.id;
  let after = { ...anchor };
  const deadline = performance.now() + durationMs;
  while (true) {
    if (ctx.signals.some((signal) => signal?.aborted)) {
      throw new CollabError("wait_cancelled", "The inbox wait was cancelled");
    }
    const current = ctx.binding();
    if (!current || current.handle.session.id !== sessionId) {
      throw new CollabError("session_auth_failed", "The bound session changed during the wait");
    }
    let caughtUp = true;
    try {
      const page = ctx.store.eventsAfterAnchorForSession({
        ...current.handle.credential,
        workspace_id: workspaceId,
        after_anchor: after,
        event_limit: 50,
      });
      for (const event of page.events) {
        if (event.session_id !== sessionId && ctx.store.eventAddressesSession(event, sessionId)) return true;
      }
      after = page.next_anchor;
      caughtUp = !page.has_more;
    } catch (error) {
      if (!(error instanceof CollabError) || error.code !== "event_read_busy") throw error;
    }
    const remaining = deadline - performance.now();
    if (remaining <= 0) return false;
    if (!caughtUp) continue;
    await abortableDelay(Math.min(WAIT_POLL_MS, remaining), ctx.signals);
  }
}

function abortableDelay(ms: number, signals: Array<AbortSignal | undefined>): Promise<void> {
  return new Promise((done) => {
    const finish = () => {
      clearTimeout(timer);
      for (const signal of signals) signal?.removeEventListener("abort", finish);
      done();
    };
    const timer = setTimeout(finish, ms);
    for (const signal of signals) signal?.addEventListener("abort", finish, { once: true });
    if (signals.some((signal) => signal?.aborted)) finish();
  });
}

/**
 * The thread an about value names. Its shape says the kind when it can (a
 * task or report handle, a `kind:` reference, a minted id). A bare id
 * without one (a task created with a caller-chosen id) is looked up among
 * reports and tasks both, and refused with the candidates if both have it,
 * so nothing is routed by guess.
 */
function resolveAbout(ctx: NoteVerbContext, workspaceId: string, value: string): { kind: "task" | "report"; id: string } {
  const text = value.trim();
  if (/^(task#|task:|task_)/i.test(text)) return { kind: "task", id: ctx.store.resolveNoteRef(workspaceId, "task", text).id };
  if (/^((report|proposal|ballot)[#:]|report_)/i.test(text)) {
    return { kind: "report", id: ctx.store.resolveNoteRef(workspaceId, "report", text).id };
  }
  const found: Array<{ kind: "task" | "report"; id: string }> = [];
  for (const kind of ["report", "task"] as const) {
    try {
      found.push({ kind, id: ctx.store.resolveNoteRef(workspaceId, kind, text).id });
    } catch (error) {
      if (!(error instanceof CollabError) || error.code !== `${kind}_not_found`) throw error;
    }
  }
  if (found.length === 1) return found[0]!;
  if (found.length > 1) {
    throw new CollabError("ambiguous_ref", `${text} is the id of a report and of a task`, {
      value: text,
      candidates: found.map((entry) => `${entry.kind}:${entry.id}`),
      remedy: { say: "Name the kind: task:<id> or report:<id>; the candidates are listed." },
    });
  }
  throw new CollabError("ref_not_found", `No report or task in this workspace has the id ${text}`, { value: text });
}

function aboutView(ctx: NoteVerbContext, binding: NoteBinding, about: string, format: "json" | "note"): Record<string, unknown> {
  const credential = binding.handle.credential;
  const workspaceId = binding.handle.workspace.id;
  const { kind, id } = resolveAbout(ctx, workspaceId, about);
  const thread = ctx.store.noteThreadForSession({ ...credential, kind, id });
  const byId = new Map(thread.sessions.map((view) => [view.id, view]));
  const me = thread.session.id;
  const advice: string[] = [];
  if (thread.mark.clamped) advice.push(MARK_CLAMPED_ADVICE);
  if (thread.truncated) advice.push(`This thread lists its first ${thread.answers.length} answers only.`);
  const recheck = evidenceRechecker(ctx.store);
  const view = thread.kind === "task" ? taskView(thread, byId, me, recheck) : reportView(ctx, thread, byId, me, advice, recheck);
  const result: Record<string, unknown> = {
    ok: true,
    ...view,
    truncated: thread.truncated,
    // The first inbox call creates the mark, whichever form it takes.
    ...(thread.mark.initialised_from ? { mark_initialised_from: thread.mark.initialised_from } : {}),
    advice,
    next: withSlot(ctx, { tool: "collab_inbox", input: {} }),
  };
  if (format === "note") {
    try {
      const carried = carryThread(thread);
      result.note = carried.text;
      result.not_carried = carried.not_carried;
    } catch (error) {
      // The reader asked for a view; a root the carrier must refuse leaves
      // the view whole and says what cannot travel and what to carry instead.
      if (!(error instanceof CollabError) || error.code !== "not_carriable") throw error;
      const field = typeof error.details.field === "string" ? error.details.field : "statement";
      const rootId = thread.kind === "task" ? thread.task!.id : thread.root!.report!.id;
      result.note = null;
      result.not_carried = [field === "statement" ? "statement (local detail)" : `${field} (short handle)`];
      advice.push(field === "statement"
        ? `This thread's statement names a local detail, so it cannot be carried as a note; carry its full id (${rootId}) instead, or ask its author to restate it.`
        : `This thread's ${field} is a short handle, so it cannot be carried as a note; carry its full id (${rootId}) instead.`);
    }
  }
  return result;
}

function reportView(
  ctx: NoteVerbContext,
  thread: NoteThreadData,
  byId: Map<string, NoteSessionView>,
  me: string,
  advice: string[],
  recheck: EvidenceRecheck,
): Record<string, unknown> {
  const root = thread.root!;
  const report = root.report!;
  const decision = report.kind === "decision" && !thread.termed;
  const view: Record<string, unknown> = {
    about: {
      kind: thread.termed ? "proposal" : decision ? "decision" : "report",
      id: report.id,
      handle: reportHandle(report.id, thread.termed),
    },
    root: formatEntry(root, byId, me, recheck),
    answers: thread.answers.map((entry) => formatEntry(entry, byId, me, recheck)),
    state: {
      challenges: thread.challenges.map((challenge) => challengeView(challenge, thread.termed && challenge.target_report_id === report.id)),
    },
  };
  if (thread.proposal) {
    const facts = proposalFacts(ctx, thread.proposal);
    advice.push(...facts.advice);
    return { ...view, ...facts.fields };
  }
  if (thread.decision) {
    const record = decisionRecord(thread.decision);
    advice.push(...record.advice);
    return { ...view, ...record.fields };
  }
  return view;
}

// ---------------------------------------------------------------------------
// Proposals and decisions as the notes surface shows them (spec 5.2, 5.6, 6)

/** Said wherever a replaced proposal's objections are shown (spec 5.6). */
export const CARRIED_OBJECTIONS_SENTENCE =
  "Carried objections are text in the terms the person signs. Under consent/v1 they do not block this proposal. Each objector may challenge again.";

/** Beside the person's desk commands, every time they are shown (spec 5.2). */
export const FOR_THE_PERSON_NOTE =
  "For the person to run himself. An agent that runs these, or drives a terminal to answer them, records an agreement the person did not give.";

/** What a flag on a support or challenge does to the position: nothing (spec 6). */
export const ANNOTATIONS_NOTE =
  "Flags on supports, challenges and consulted voices are display only: they change no count. The position is consent/v1's, exactly as collab_proposal_status computes it.";

/** What a composed decision record cannot show (spec 5.2). */
export const DECISION_DOES_NOT_ESTABLISH = [
  "who or what model wrote it: a session's name and model are self-declared",
  "that the voices were independent: sessions of one model or one operator may err together, and a seat_ref is unverified",
  "that the work stayed inside the extent: collab records what was said, not what was done",
] as const;

function retiredPosition(status: ProposalStatus): boolean {
  return status.ai.position === "withdrawn" || status.ai.position === "superseded";
}

/**
 * The journal the person's desk must open: named only when it is not the
 * one a plain shell would find, so the commands act on the proposal shown.
 */
function personDeskDb(ctx: Pick<NoteVerbContext, "store" | "environment">): string {
  const file = ctx.store.db.filename;
  if (!file || file === ":memory:") return "";
  return file === defaultDatabasePath(ctx.environment) ? "" : ` --db ${shellQuote(file)}`;
}

/**
 * The person's own commands for this proposal, with its full id (spec
 * 5.2): data for the person, never a call. `now` says whether the desk would
 * take an agreement as things stand.
 */
export function forThePerson(ctx: Pick<NoteVerbContext, "store" | "environment">, status: ProposalStatus): Record<string, unknown> {
  const id = status.proposal.id;
  const db = personDeskDb(ctx);
  const position = status.ai.position;
  const now = retiredPosition(status)
    ? `It is ${position}, so the desk no longer takes an agreement on it.`
    : status.may_proceed
      ? "The person has agreed to these bytes; nothing more is asked of the person, who may still reject."
      : position !== "consented"
        ? `The desk takes an agreement only once the agents' position is consented; it is ${position} now. The person may reject at any time.`
        : status.person.state === "rejected"
          ? "The person's latest act is a rejection; the person may agree again on the same bytes, or leave it rejected."
          : "The agents' position is consented; the person may agree or reject.";
  return {
    passkey: `agenttool-collab-host person ceremony --proposal ${id} --act agree${db}`,
    terminal: `agenttool-collab-host person consent --proposal ${id}${db}`,
    note: FOR_THE_PERSON_NOTE,
    now,
  };
}

function names(voices: NoteProposalData["consulted"]): string {
  return voices.map((voice) => voice.name).join(", ");
}

/** One sentence: what would move the position (spec 5.2 needs). It reads the computed status and decides nothing. */
export function proposalNeeds(data: NoteProposalData): string {
  const { status } = data;
  const closes = status.terms.closes_at;
  const position = status.ai.position;
  if (position === "withdrawn") return "Withdrawn by its author; nothing moves it now.";
  if (position === "superseded") {
    return `Replaced by ${status.ai.obsoleted_by_report_id}; read that proposal instead, since nothing moves this one now.`;
  }
  if (status.may_proceed) {
    return "The person agreed to these bytes, so work may go ahead within the extent; a later challenge does not undo that, and only the person's rejection (or the author's withdrawal) stops it.";
  }
  if (status.person.state === "rejected") {
    return "The person's latest act rejects these bytes, so nothing proceeds unless the person agrees again on the same bytes; agents' supports do not change that.";
  }
  const awaited = data.consulted.filter((voice) => voice.awaited);
  const standing = status.ai.unresolved_challenge_report_ids;
  switch (position) {
    case "open":
      if (data.lone) {
        return `The author is the lone voice: an explicit support from the author would make it consented, and with none it lapses at ${closes}.`;
      }
      return status.ai.qualifying_support_report_ids.length === 0
        ? `Support from the awaited voices (${names(awaited)}) would make it consented before ${closes}; at the close, one qualifying support with no standing challenge settles it consented, and none lets it lapse.`
        : `Support from the voices still awaited (${names(awaited)}) would make it consented now; at ${closes} it settles consented as it stands, unless a challenge stands then.`;
    case "challenged":
      return `${standing.length} standing challenge(s) (${standing.join(", ")}) hold it challenged, and only each challenger's voice can lift its own; one still standing at ${closes} closes it split.`;
    case "consented":
      return status.ai.closed
        ? "The agents' position is settled consented; nothing moves without the person's own act at the desk (for_the_person)."
        : `The agents' position is consented; nothing moves without the person's own act at the desk (for_the_person), and a challenge before ${closes} would make it challenged.`;
    case "split":
      return "Closed split: a challenge stood at the close, so the position cannot move; replace the proposal (collab_propose with replaces) if something has changed.";
    case "lapsed":
      return "Closed lapsed: no qualifying support by the close, so the position cannot move; replace the proposal if the question still matters.";
  }
}

function stanceItem(stance: NoteStanceView): Record<string, unknown> & { standing: boolean } {
  return {
    id: stance.id,
    handle: handleOf("report", stance.id),
    by: { session: stance.from_session_id, name: stance.from_actor },
    voice: stance.voice_id,
    statement: stance.statement,
    counted: stance.counted,
    standing: stance.standing,
    ...stance.flags,
    ...(stance.flags.ungrounded
      ? {
        ungrounded_basis: stance.grounded_by === "note"
          ? "no Why and no Evidence lines"
          : "no evidence_refs and no confidence_basis (a legacy report's body is not read for reasons)",
      }
      : {}),
    ...(stance.flags.challenger_ended ? { voice_has_active_session: stance.voice_has_active_session } : {}),
  };
}

/**
 * The fields a proposal view and collab_propose's result share. `status` is
 * the unchanged consent/v1 status, and position, proposal_sha256 and
 * may_proceed are read from it alone; everything beside it is display.
 */
export function proposalFacts(
  ctx: Pick<NoteVerbContext, "store" | "environment">,
  data: NoteProposalData,
): { fields: Record<string, unknown>; advice: string[] } {
  const { status } = data;
  const at = data.observed_at;
  const advice: string[] = [];
  const consulted = data.consulted.map((voice) => ({
    voice: voice.voice_id,
    name: voice.name,
    last_seen_minutes: voice.last_seen_at ? minutesSince(voice.last_seen_at, at) : null,
    delivery_recorded: voice.delivery_recorded,
    awaited: voice.awaited,
    supported: voice.supported,
    challenged: voice.challenged,
  }));
  const silent = data.consulted.filter((voice) => voice.awaited && !voice.delivery_recorded);
  const deliveryNote = `${silent.length} awaited voice(s) have no recorded delivery on the notes surface` +
    (silent.length > 0
      ? ` (${names(silent)}): they may never have been shown the question, and consent/v1 still lets their silence settle the position at its close.`
      : ".");
  if (silent.length > 0) advice.push(deliveryNote);
  for (const stance of data.challenges) {
    if (stance.standing && stance.flags.challenger_ended && !stance.voice_has_active_session) {
      advice.push(
        `challenger_ended: ${stance.id} still stands, but its challenger's session has ended and no session of its voice is active. ` +
          "Replace the proposal carrying the objection (collab_propose with replaces), or tell the person, who can reject.",
      );
    }
  }
  const flagged = [...data.supports, ...data.challenges].filter((stance) =>
    stance.flags.same_seat_as_author || stance.flags.same_name_as_author || stance.flags.started_after_open
    || stance.flags.ungrounded || stance.flags.answered_by_another_voice || stance.flags.challenger_ended);
  if (flagged.length > 0) advice.push(ANNOTATIONS_NOTE);
  const fields: Record<string, unknown> = {
    position: status.ai.position,
    closed: status.ai.closed,
    closes_at: status.terms.closes_at,
    proposal_sha256: status.proposal_sha256,
    may_proceed: status.may_proceed,
    person: status.person.state,
    lone: data.lone,
    needs: proposalNeeds(data),
    supports: data.supports.map(stanceItem),
    challenges: data.challenges.map(stanceItem),
    consulted,
    delivery: { awaited_without_delivery: silent.length, note: deliveryNote },
    annotations: ANNOTATIONS_NOTE,
  };
  if (data.replaced) {
    fields.replaced = { id: data.replaced.proposal_id, handle: handleOf("proposal", data.replaced.proposal_id) };
    fields.carried_objections = data.replaced.carried.map((entry) => ({
      challenge: entry.challenge_id,
      handle: handleOf("report", entry.challenge_id),
      by: { session: entry.by_session_id, name: entry.by },
      voice: entry.voice_id,
      raised_on: entry.raised_on,
      carried_in_terms: entry.carried_in_terms,
      standing_on_replaced: entry.standing_on_replaced,
      re_raised_here: entry.re_raised_here,
      counted_by_consent_v1: false,
    }));
    fields.carried_note = CARRIED_OBJECTIONS_SENTENCE;
    const shed = data.replaced.carried.filter((entry) => !entry.carried_in_terms && entry.standing_on_replaced);
    if (shed.length > 0) {
      advice.push(`${shed.length} objection(s) still standing on the replaced proposal are not in these terms: ${shed.map((entry) => entry.challenge_id).join(", ")}.`);
    }
  }
  if (status.ai.position === "superseded" && status.ai.obsoleted_by_report_id) {
    fields.replaced_by = { id: status.ai.obsoleted_by_report_id, handle: handleOf("proposal", status.ai.obsoleted_by_report_id) };
  }
  fields.for_the_person = forThePerson(ctx, status);
  fields.status = status;
  return { fields, advice };
}

/**
 * Whether a decision's stated scope is the extent the person agreed to on
 * its proposal; null where that is not the question (no proposal, or an
 * outcome that authorises nothing). A marked proceed always matches; a
 * legacy decision may state anything.
 */
function scopeMatchesAgreedExtent(data: NoteDecisionData): boolean | null {
  const status = data.proposal?.status;
  if (!status || (data.outcome !== "proceed" && data.outcome !== "unstated")) return null;
  return data.authority.scope === status.terms.extent;
}

function actView(act: { id: string; act: string; basis: string; created_at?: string; at?: string; reason?: string | null; event_id?: string }) {
  return {
    id: act.id,
    act: act.act,
    basis: act.basis,
    at: act.created_at ?? act.at ?? null,
    ...(act.event_id ? { event: act.event_id } : {}),
    ...(act.reason ? { reason: act.reason } : {}),
  };
}

/**
 * The composed decision record (spec 5.2): what the decision rests on is
 * read from the journal, never from its own words; whether the agreement
 * still holds is computed now; and what the record cannot show is said.
 */
export function decisionRecord(data: NoteDecisionData): { fields: Record<string, unknown>; advice: string[] } {
  const advice: string[] = [];
  const proposal = data.proposal;
  const status = proposal?.status ?? null;
  const report = data.report;
  const challenges = [
    ...(proposal?.challenges ?? []).map((stance) => ({ ...stanceItem(stance), on: "proposal" })),
    ...data.challenges.map((stance) => ({ ...stanceItem(stance), on: "decision" })),
  ];
  const restsOn = status
    ? {
      proposal: { id: status.proposal.id, handle: handleOf("proposal", status.proposal.id), proposal_sha256: status.proposal_sha256, extent: status.terms.extent },
      person_act: data.rests_on ? actView(data.rests_on) : null,
    }
    : { proposal: null, person_act: null, note: NOTE_SELF_DECISION_BASIS };
  const scopeMatches = scopeMatchesAgreedExtent(data);
  if (data.agreement_current === false) {
    const id = status!.proposal.id;
    const cause = data.later_act
      ? `the person's latest act on ${id} is ${data.later_act.act} by ${data.later_act.basis}`
      : retiredPosition(status!)
        ? `${id} was ${status!.ai.position === "withdrawn" ? "withdrawn" : "superseded"} by ${status!.ai.obsoleted_by_report_id} after the agreement`
        : `the person's latest act on ${id} is not the agreement this decision cites`;
    advice.push(`agreement_current is false: ${cause}. Stop work that rests on this decision.`);
  }
  if (!data.marked) {
    advice.push("This decision was written by a legacy tool: its authority fields are shown as written and were not derived by the server; what it rests on is read from its evidence refs.");
  }
  if (scopeMatches === false) {
    advice.push(
      `This decision's authority_scope is not the extent the person agreed to on ${status!.proposal.id}: ` +
        "the agreement covers only that extent (rests_on.proposal.extent), and nothing checked the scope this decision states.",
    );
  }
  if (data.proposal_unreadable) {
    advice.push(`The proposal this decision names could not be read (${data.proposal_unreadable}), so no proposal is shown.`);
  }
  return {
    advice,
    fields: {
      decision: {
        id: report.id,
        handle: handleOf("report", report.id),
        by: { session: report.from_session_id, name: report.from_actor },
        at: report.created_at,
        outcome: data.outcome,
      },
      outcome: data.outcome,
      authority: {
        scope: data.authority.scope,
        basis: data.authority.basis,
        derived_by: data.authority.derived_by_server
          ? "the server, from the journal, when it was written"
          : "a legacy tool, as its caller wrote it; not checked",
        ...(scopeMatches !== null ? { scope_matches_agreed_extent: scopeMatches } : {}),
      },
      rests_on: restsOn,
      rests_on_basis: data.marked
        ? "derived from the journal (the proposal the server recorded this decision on, and the person's latest act on it then), never from its own words or evidence"
        : "read from the evidence refs a legacy caller chose: the proposal and the act are in the journal, but nothing checked that this decision was made on them",
      agreement_current: data.agreement_current,
      ...(data.later_act ? { later_act: actView(data.later_act) } : {}),
      ...(status
        ? { proposal_position: { position: status.ai.position, person: status.person.state, may_proceed: status.may_proceed } }
        : {}),
      challenges,
      dissent: challenges.filter((challenge) => challenge.standing === true),
      voices_without_delivery: (proposal?.consulted ?? [])
        .filter((voice) => !voice.delivery_recorded)
        .map((voice) => ({ voice: voice.voice_id, name: voice.name })),
      does_not_establish: [...DECISION_DOES_NOT_ESTABLISH],
    },
  };
}

function taskView(
  thread: NoteThreadData,
  byId: Map<string, NoteSessionView>,
  me: string,
  recheck: EvidenceRecheck,
): Record<string, unknown> {
  const task = thread.task!;
  const holder = task.assignee_session_id ? byId.get(task.assignee_session_id) : undefined;
  const generation = thread.reviews.at(-1)?.review_generation ?? null;
  return {
    about: { kind: "task", id: task.id, handle: handleOf("task", task.id) },
    task: {
      id: task.id,
      handle: handleOf("task", task.id),
      title: task.title,
      state: task.effective_status,
      review_status: task.review_status,
      work_mode: task.work_mode,
      completion_policy: task.completion_policy,
      paths: task.path_scopes,
      holder: task.assignee_session_id
        ? { session: task.assignee_session_id, name: task.assignee, purpose: holder?.purpose ?? null }
        : null,
      completion: task.completion_report_id
        ? {
          id: task.completion_report_id,
          handle: handleOf("report", task.completion_report_id),
          by: task.reported_by,
          at: task.reported_at,
        }
        : null,
      review_requested: task.review_requested_session_id
        ? sessionRef(task.review_requested_session_id, task.review_requested_session_id, byId)
        : null,
      reviews: thread.reviews.map((review) => ({
        outcome: review.outcome,
        by: review.reviewer_actor,
        at: review.created_at,
        summary: review.summary,
        of_current_completion: generation !== null && review.review_generation === generation
          && task.review_status !== "pending",
      })),
    },
    thread: thread.answers.map((entry) => formatEntry(entry, byId, me, recheck)),
  };
}

/** The local names a carried note must not leak (spec 5.2 format note): this machine's name. */
function localTerms(): string[] {
  const name = hostname().split(".")[0] ?? "";
  // A short all-hex name would match inside hashes and ids and withhold them.
  return name.length >= 3 && !/^[0-9a-f]{1,7}$/i.test(name) ? [name] : [];
}

/** The thread root and its state as one collab-note/1 text of at most 800 characters (spec 5.2). */
function carryThread(thread: NoteThreadData): { text: string; not_carried: string[] } {
  let input: NoteInput;
  if (thread.kind === "task") {
    const task = thread.task!;
    input = {
      act: "note",
      statement: statementOf(`Task: ${task.title}`),
      re: `task:${task.id}`,
      trailers: [{
        key: "Position",
        value: ["legacy_unreviewed", "not_required"].includes(task.review_status)
          ? task.effective_status
          : `${task.effective_status}; review ${task.review_status}`,
      }],
    };
  } else if (thread.proposal) {
    input = carriedProposal(thread.proposal);
    try {
      return renderCarriedNote(input, { maxChars: 800, localTerms: localTerms() });
    } catch (error) {
      if (!(error instanceof CollabError) || error.code !== "not_carriable" || error.details.field !== "statement") throw error;
      // A proposal's question is the bytes the person signs and cannot be
      // restated, so a first line naming a local detail gives way to a
      // stand-in: the full id, the hash and the position still travel.
      const carried = renderCarriedNote(
        { ...input, statement: PROPOSAL_STAND_IN_STATEMENT },
        { maxChars: 800, localTerms: localTerms(), withheldStatement: true },
      );
      return { text: carried.text, not_carried: carried.not_carried };
    }
  } else if (thread.decision) {
    input = carriedDecision(thread.decision, thread.root!.marked);
  } else {
    const report = thread.root!.report!;
    const stored = reportAct(report, thread.termed);
    // corrects and supersedes are relations, not acts a note can carry.
    const act = (stored === "corrects" || stored === "supersedes" ? "note" : stored) as NoteAct;
    const re = `${thread.termed ? "proposal" : "report"}:${report.id}`;
    const parsed = thread.root!.marked ? parseNote(report.body) : null;
    if (parsed && parsed.act !== null) {
      // The act and the target come from storage; the reasons and evidence from the marked text.
      input = {
        act,
        statement: parsed.statement,
        body: parsed.body,
        re,
        why: parsed.why,
        evidence: parsed.evidence,
        limits: parsed.limits,
        purpose: parsed.purpose,
        extent: parsed.extent,
      };
    } else {
      const lines = report.body.split("\n");
      const firstCut = (lines[0] ?? "").length > NOTE_STATEMENT_MAX;
      input = {
        act,
        statement: statementOf(report.body),
        // A cut first line travels whole in the body, so no words are lost unnamed.
        body: (firstCut ? report.body : lines.slice(1).join("\n")).trim() || null,
        re,
      };
    }
  }
  const carried = renderCarriedNote(input, { maxChars: 800, localTerms: localTerms() });
  return { text: carried.text, not_carried: carried.not_carried };
}

/** A statement and body from stored text: a first line too long for a statement travels whole in the body. */
function statementAndBody(text: string): { statement: string; body: string | null } {
  const lines = text.split("\n");
  const firstCut = (lines[0] ?? "").length > NOTE_STATEMENT_MAX;
  return {
    statement: statementOf(text),
    body: (firstCut ? text : lines.slice(1).join("\n")).trim() || null,
  };
}

/** Carried in place of a proposal's first line when that line names a local detail. */
const PROPOSAL_STAND_IN_STATEMENT = "A proposal; read it by its full id.";

/**
 * A proposal for carrying: its question, extent, limits and criteria as
 * written, the hash the person would sign, and where it stands. The position
 * is read from the computed status; carried objections are said not to count.
 */
function carriedProposal(data: NoteProposalData): NoteInput {
  const { status } = data;
  const carried = data.replaced?.carried.filter((entry) => entry.carried_in_terms).length ?? 0;
  const position = [
    status.ai.position,
    `person ${status.person.state}`,
    `may_proceed ${status.may_proceed}`,
    ...(carried > 0 ? [`${carried} carried objection(s) are text in the terms, not counted by consent/v1`] : []),
  ].join("; ");
  return {
    act: "propose",
    ...statementAndBody(status.proposal.body),
    re: `proposal:${status.proposal.id}`,
    extent: status.terms.extent,
    limits: status.proposal.limits,
    trailers: [
      { key: "Sha256", value: status.proposal_sha256 },
      { key: "Position", value: position },
      { key: "Criteria", value: status.terms.criteria },
    ],
  };
}

/**
 * A decision for carrying: its words, its scope, and whether what it rests
 * on still holds. The carried text is what travels to other devices, so a
 * legacy decision's scope and proposal, which its caller wrote and nothing
 * checked, are labelled so on the lines themselves.
 */
function carriedDecision(data: NoteDecisionData, marked: boolean): NoteInput {
  const report = data.report;
  const parsed = marked ? parseNote(report.body) : null;
  const words = parsed && parsed.act !== null
    ? { statement: parsed.statement, body: parsed.body }
    : statementAndBody(report.body);
  const status = data.proposal?.status ?? null;
  const legacy = !data.authority.derived_by_server;
  const on = !status
    ? "not the person's agreement"
    : legacy
      ? `cites proposal:${status.proposal.id}`
      : data.outcome === "proceed" ? `rests on proposal:${status.proposal.id}` : `on proposal:${status.proposal.id}`;
  const position = [
    `outcome ${data.outcome}`,
    ...(legacy ? ["legacy", "authority not checked"] : []),
    on,
    ...(data.agreement_current !== null ? [`agreement_current ${data.agreement_current}`] : []),
    ...(scopeMatchesAgreedExtent(data) === false ? ["scope is not the agreed extent"] : []),
  ].join("; ");
  const scope = report.authority_scope;
  return {
    act: "decide",
    ...words,
    re: `report:${report.id}`,
    ...(scope ? { extent: legacy ? `as written by a legacy tool; not checked: ${scope}` : scope } : {}),
    trailers: [
      ...(status ? [{ key: "Sha256", value: status.proposal_sha256 }] : []),
      { key: "Position", value: position },
    ],
  };
}
