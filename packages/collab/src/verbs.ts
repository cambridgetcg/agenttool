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
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { defaultActor } from "./actor-default.js";
import { canonicalJson } from "./canonical.js";
import { CollabError } from "./errors.js";
import {
  hasLoneSurrogate,
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
import type { CollabReport, SessionHandle } from "./protocol.js";
import { defaultSeatRef } from "./seat-ref.js";
import { removeSessionCredentialFile, writeSessionCredentialFile } from "./session-file.js";
import type {
  CollabStore,
  NoteArrivalData,
  NoteChallengeView,
  NoteEntityKind,
  NoteEntry,
  NoteInboxData,
  NoteSessionView,
  NoteThreadData,
  NoteWaitingEntry,
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
export const BUILT_NOTE_VERBS: readonly NoteVerb[] = ["collab_arrive", "collab_inbox"];

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
      "Start with collab_arrive {purpose}.",
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
  "This build has collab_arrive and collab_inbox; the other verbs come later.",
  ...NOTE_PRINCIPLES.map((principle, index) => `${index + 1}. ${principle}`),
].join("\n");

// ---------------------------------------------------------------------------
// Handles

const HANDLE_ID = /^(report|task|session)_([0-9a-f]{8})-[0-9a-f]{4}-/;

/**
 * `<kind>#<first 6 hex of the uuid>` for an id the store minted (spec 5).
 * A task created with a caller-chosen id has no uuid, so its id is its handle.
 */
export function handleOf(kind: NoteEntityKind | "session", id: string): string {
  const match = HANDLE_ID.exec(id);
  if (!match) return id;
  return `${kind}#${match[2]!.slice(0, 6)}`;
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
}

const DERIVED_KEY = /^n1:([A-Z2-7]{8}):(\d{6}):([A-Z2-7]{20})(?::(\d{2}))?$/;

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
  const base = base32(sha256Bytes(canonicalJson({
    session_id: credential.session_id,
    tool: call.tool,
    input: call.input,
  }))).slice(0, 20);
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
  };
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
  if (error.code === "too_long" && typeof error.details.field === "string") {
    return { say: `Shorten ${error.details.field} to at most ${String(error.details.max)}; nothing was written.` };
  }
  if (error.code.endsWith("_not_found")) {
    return { say: "Check the id or handle: every id a later call needs comes back in an earlier result." };
  }
  return { say: `${error.message}. Nothing was written; correct the call and send it again.` };
}

/** The verbs' error shape: `{code, message, remedy}` plus the error's details (spec 5). */
export function noteFailure(error: unknown) {
  const payload = error instanceof CollabError
    ? (() => {
      const { remedy: _remedy, ...details } = error.details;
      return { code: error.code, message: error.message, ...details, remedy: noteRemedyOf(error) };
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

function requireCredential(ctx: NoteVerbContext) {
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
function withSlot(ctx: NoteVerbContext, remedy: NoteRemedy): NoteRemedy {
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
function oneLine(value: unknown, field: string, max: number, required: boolean): string | null {
  if (value === undefined || value === null) {
    if (!required) return null;
    throw new CollabError(`invalid_${field}`, `${field} is required`);
  }
  if (typeof value !== "string") throw new CollabError(`invalid_${field}`, `${field} must be text`);
  const text = normalizeNoteText(value).split("\n").map((line) => line.trim()).filter(Boolean).join(" ");
  if (!text) {
    if (!required) return null;
    throw new CollabError(`invalid_${field}`, `${field} must not be empty`);
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

function minutesSince(at: string, observedAt: string): number | null {
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

function statementOf(text: string): string {
  const line = text.split("\n")[0] ?? "";
  return line.length > NOTE_STATEMENT_MAX ? `${line.slice(0, NOTE_STATEMENT_MAX - 1)}…` : line;
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

export function arriveVerb(ctx: NoteVerbContext, input: ArriveInput): Record<string, unknown> {
  const purpose = oneLine(input.purpose, "purpose", PURPOSE_MAX, true)!;
  const existing = ctx.binding();
  if (existing) return arriveBound(ctx, existing, input, purpose);
  const name = oneLine(input.name, "name", NAME_MAX, false);
  const model = oneLine(input.model, "model", MODEL_MAX, false);
  return ctx.slot_key
    ? arriveNamed(ctx, input, purpose, name, model)
    : arriveDefault(ctx, input, purpose, name, model);
}

function arriveDefault(
  ctx: NoteVerbContext,
  input: ArriveInput,
  purpose: string,
  name: string | null,
  model: string | null,
): Record<string, unknown> {
  if (input.parent !== undefined) {
    throw new CollabError(
      "parent_needs_binding_key",
      "A parent names the session a named child descends from; the default slot has no parent",
      { remedy: { tool: "collab_arrive", input: { purpose, binding_key: "<choose>", parent: input.parent } } },
    );
  }
  const advice: string[] = [];
  if (input.revise_purpose) advice.push("revise_purpose has nothing to revise on a new session; your purpose is recorded as given.");
  let actor: string | undefined = name ?? undefined;
  if (actor === undefined) {
    try {
      actor = defaultActor(ctx.environment as NodeJS.ProcessEnv);
    } catch (error) {
      if (!(error instanceof CollabError) || error.code !== "actor_required") throw error;
    }
  }
  const handle = ctx.store.startSession({
    root_path: input.root_path ?? process.cwd(),
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
  return arrivalResult(ctx, binding, {
    effect:
      `Started session ${handle.session.id} as ${handle.session.actor} with purpose "${purpose}". ` +
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
      `Started session ${handle.session.id} as ${handle.session.actor}, a named child of ${parent.handle.session.id}. ` +
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

function arriveBound(
  ctx: NoteVerbContext,
  binding: NoteBinding,
  input: ArriveInput,
  purpose: string,
): Record<string, unknown> {
  const { credential } = requireCredential(ctx);
  const advice: string[] = [];
  const ignored = (["name", "model", "root_path", "parent"] as const).filter((field) => input[field] !== undefined);
  if (ignored.length > 0) {
    advice.push(`${ignored.join(", ")} apply only when a slot first arrives; this slot already speaks as session ${binding.handle.session.id}.`);
  }
  if (input.revise_purpose !== true) {
    const before = ctx.store.arrivalBrief(credential).session;
    return arrivalResult(ctx, binding, {
      effect:
        `You are speaking as session ${before.id} (name ${before.actor}, purpose ${before.purpose ?? "none declared"}). ` +
        "Nothing was written.",
      advice,
      fresh: false,
      record: false,
      note: arrivalNote("I am here.", before.purpose),
      remedies: boundRemedies(ctx, before.id, purpose),
    });
  }
  const plan = planReceipt(ctx.store, credential, { tool: "collab_arrive", input: { purpose }, entity: "purpose" });
  const replayed = plan.retry ? replayReceipt<{ purpose: string; sequence: number }>(ctx.store, credential, plan.key) : null;
  const receipt = replayed ?? ctx.store.declarePurposeForSession({ ...credential, idempotency_key: plan.key, purpose });
  if (plan.retry) advice.push("This repeats your latest purpose declaration exactly, so it was read as a retry. Add a word to say it again.");
  const session = binding.handle.session;
  return arrivalResult(ctx, binding, {
    effect:
      `You are speaking as session ${session.id} (name ${session.actor}, purpose ${receipt.purpose}). ` +
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
  const brief = composeBrief(ctx, data, pending);
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
  const forYou = pending ? pending.entries.map((entry) => formatEntry(entry, byId, me.id)) : [];
  const waiting = data.waiting.map((entry) => formatWaiting(ctx, entry));
  const cap = <T>(items: T[]) => items.slice(0, LIST_CAP);
  const shown = [
    ...cap(proposals).map((proposal) => proposal.id),
    ...cap(reviewsWanted).flatMap((review) => (review.completion ? [review.completion.id] : [])),
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
        for_you: forYou.length + (pending?.more ? 1 : 0),
        for_you_more: pending?.more ?? false,
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
 * Collab starts nothing.
 */
export function listenHow(ctx: NoteVerbContext, sessionId: string): string {
  const inboxWait = ctx.slot_key
    ? `collab_inbox {wait_seconds: 30, binding_key: "${ctx.slot_key}"}`
    : "collab_inbox {wait_seconds: 30}";
  const database = ctx.store.db.filename;
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

function noteEvidence(lines: string[]): FormattedEvidence[] {
  return lines.map((line, index) => {
    try {
      const evidence = parseEvidence(line);
      return { n: index + 1, kind: evidence.kind, locator: evidence.locator };
    } catch {
      return { n: index + 1, kind: "text", locator: line };
    }
  });
}

function sessionRef(sessionId: string | null | undefined, fallbackName: string, byId: Map<string, NoteSessionView>) {
  return { session: sessionId ?? null, name: sessionId ? byId.get(sessionId)?.actor ?? fallbackName : fallbackName };
}

/** One inbox entry as an item (spec 5.2): it names the entity the next call takes. */
export function formatEntry(entry: NoteEntry, byId: Map<string, NoteSessionView>, me: string): Record<string, unknown> {
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
    let evidence = journalEvidence(report.evidence_refs);
    const flags: Record<string, unknown> = {};
    if (entry.marked) {
      // Only a marked body is read as a note; its act, target and addressee still come from storage.
      const parsed = parseNote(report.body);
      if (parsed.act !== null) {
        statement = parsed.statement;
        text = parsed.body;
        why = parsed.why;
        evidence = [...noteEvidence(parsed.evidence), ...journalEvidence(report.evidence_refs)
          .map((item, index) => ({ ...item, n: parsed.evidence.length + index + 1 }))];
        if (parsed.act !== act) flags.act_mismatch = { stored: act, written: parsed.act };
      }
    }
    const to = report.to_session_id
      ? sessionRef(report.to_session_id, report.to_session_id, byId)
      : entry.to_person ? "person" : "all";
    const re = report.target_report_id
      ? { id: report.target_report_id, handle: handleOf("report", report.target_report_id) }
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
      ...(report.limits ? { limits: report.limits } : {}),
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
        evidence: report ? journalEvidence(report.evidence_refs) : [],
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
    ? { say: `Stop work that rests on ${handle}: the person's latest act on it is a rejection.` }
    : withSlot(ctx, { tool: "collab_inbox", input: { about: entry.what === "answer" && entry.about_id ? handleOf("report", entry.about_id) : handle } });
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
  include?: "for_me" | "all";
  limit?: number;
  format?: "json" | "note";
}

const DEFAULT_INBOX_LIMIT = 20;
const WAIT_POLL_MS = 250;

export async function inboxVerb(ctx: NoteVerbContext, input: InboxInput): Promise<Record<string, unknown>> {
  const { binding, credential } = requireCredential(ctx);
  if (input.about !== undefined) return aboutView(ctx, binding, input);
  const limit = input.limit ?? DEFAULT_INBOX_LIMIT;
  const include = input.include ?? "for_me";
  const waitSeconds = input.wait_seconds ?? 0;
  if (!Number.isInteger(waitSeconds) || waitSeconds < 0 || waitSeconds > 30) {
    throw new CollabError("invalid_wait_seconds", "wait_seconds must be an integer from 0 to 30");
  }
  let data = ctx.store.inboxForSession({ ...credential, limit, include });
  let alsoNew = data.also_new;
  let waited: Record<string, unknown> | null = null;
  if (waitSeconds > 0 && !data.entries.some((entry) => entry.for_me) && !data.more) {
    const started = performance.now();
    const arrived = await waitForMe(ctx, binding, data.mark.anchor, waitSeconds * 1_000);
    waited = { seconds: Math.round((performance.now() - started) / 100) / 10, ended_by: arrived ? "item" : "timeout" };
    if (arrived) {
      // The first pass already moved the mark past what it counted; keep that count.
      data = ctx.store.inboxForSession({ ...credential, limit, include });
      alsoNew += data.also_new;
    }
  }
  const byId = new Map(data.sessions.map((view) => [view.id, view]));
  const me = data.session.id;
  const items = data.entries.map((entry) =>
    entry.for_me ? formatEntry(entry, byId, me) : subjectLine(entry, byId, me));
  const advice: string[] = [];
  if (input.format === "note") advice.push("format: note renders one thread; pass about with an id or handle.");
  if (data.mark.clamped) advice.push("Your read mark was past the journal head (the journal may have been restored from an older copy); it now reads from the head.");
  const firstForMe = items.find((item) => item.for_me === true);
  const next: NoteRemedy = firstForMe
    ? withSlot(ctx, { tool: "collab_inbox", input: { about: firstForMe.handle } })
    : data.more
      ? withSlot(ctx, { tool: "collab_inbox", input: {} })
      : withSlot(ctx, { tool: "collab_inbox", input: { wait_seconds: 30 } });
  return {
    ok: true,
    items,
    also_new: { count: alsoNew },
    more: data.more,
    read_through: { sequence: data.mark.through, head: data.head_sequence },
    ...(data.mark.initialised_from ? { mark_initialised_from: data.mark.initialised_from } : {}),
    waiting_on_you: data.waiting.map((entry) => formatWaiting(ctx, entry)),
    ...(waited ? { waited } : {}),
    advice,
    next,
  };
}

/**
 * Wait for a for-me event after `anchor`, reading only (spec 5.2): it uses
 * the same read-only page as collab_events_wait, refreshes nothing and writes
 * nothing. Entries already waiting on the session never end it.
 */
async function waitForMe(
  ctx: NoteVerbContext,
  binding: NoteBinding,
  anchor: { epoch_id: string; sequence: number; hash: string },
  durationMs: number,
): Promise<boolean> {
  if (ctx.waits.active >= ctx.waits.max) {
    throw new CollabError("too_many_waits", `At most ${ctx.waits.max} waits may run per endpoint`);
  }
  ctx.waits.active += 1;
  try {
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
  } finally {
    ctx.waits.active -= 1;
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

/** The kind an about value names, from its shape: task ids and handles are tasks, everything else a report. */
function aboutKind(value: string): "task" | "report" {
  return /^(task#|task:|task_)/i.test(value.trim()) ? "task" : "report";
}

function aboutView(ctx: NoteVerbContext, binding: NoteBinding, input: InboxInput): Record<string, unknown> {
  const credential = binding.handle.credential;
  const workspaceId = binding.handle.workspace.id;
  const kind = aboutKind(input.about!);
  const resolved = ctx.store.resolveNoteRef(workspaceId, kind, input.about!);
  const thread = ctx.store.noteThreadForSession({ ...credential, kind, id: resolved.id });
  const byId = new Map(thread.sessions.map((view) => [view.id, view]));
  const me = thread.session.id;
  const advice: string[] = [];
  if (thread.truncated) advice.push(`This thread lists its first ${thread.answers.length} answers only.`);
  const view = thread.kind === "task" ? taskView(thread, byId, me) : reportView(thread, byId, me, advice);
  const result: Record<string, unknown> = {
    ok: true,
    ...view,
    truncated: thread.truncated,
    advice,
    next: withSlot(ctx, { tool: "collab_inbox", input: {} }),
  };
  if (input.format === "note") {
    const carried = carryThread(thread);
    result.note = carried.text;
    result.not_carried = carried.not_carried;
  }
  return result;
}

function reportView(
  thread: NoteThreadData,
  byId: Map<string, NoteSessionView>,
  me: string,
  advice: string[],
): Record<string, unknown> {
  const root = thread.root!;
  const report = root.report!;
  const decision = report.kind === "decision";
  if (thread.termed) {
    advice.push("This build shows a proposal as its plain thread; the computed proposal view (position, needs, for_the_person) is not built yet. The position here is not stated, so read none into it.");
  } else if (decision) {
    advice.push("This build shows a decision as its plain thread; the composed decision record is not built yet.");
  }
  return {
    about: {
      kind: thread.termed ? "proposal" : decision ? "decision" : "report",
      id: report.id,
      handle: reportHandle(report.id, thread.termed),
    },
    root: formatEntry(root, byId, me),
    answers: thread.answers.map((entry) => formatEntry(entry, byId, me)),
    state: {
      challenges: thread.challenges.map((challenge) => challengeView(challenge, thread.termed && challenge.target_report_id === report.id)),
    },
  };
}

function taskView(thread: NoteThreadData, byId: Map<string, NoteSessionView>, me: string): Record<string, unknown> {
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
    thread: thread.answers.map((entry) => formatEntry(entry, byId, me)),
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
