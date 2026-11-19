import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { resolveDatabasePath } from "./database-path.js";
import { CollabError } from "./errors.js";
import {
  collabSessionsDirectory,
  readHostBindings,
  removeHostBinding,
  type HostBinding,
} from "./host-binding.js";
import {
  ancestry,
  hostKindOf,
  isCollabMcpProcess,
  isHostProcess,
  readProcessTable,
  type ProcessRecord,
  type ProcessTable,
} from "./process-tree.js";
import {
  MAX_WAIT_EVENT_LIMIT,
  SESSION_STALE_AFTER_MS,
  type EventCursor,
  type SessionCredential,
  type SessionEndRelease,
  type SessionHandle,
  type SessionLiveness,
  type SessionRest,
} from "./protocol.js";
import { validateSeatRef } from "./seat-ref.js";
import {
  readSessionCredentialFile,
  removeSessionCredentialFile,
} from "./session-file.js";
import { CollabStore } from "./store-notes.js";
import {
  isAddressedTo,
  knockReadThrough,
  restFromDeclaration,
  type AddressedEventRow,
  type RestDeclarationRow,
} from "./store.js";
import { openInBrowser, runCeremonyCli, type CeremonyIo } from "./ceremony.js";
import {
  PERSON_DESK_USAGE,
  runPersonDeskCli,
  runPersonRemoteCli,
  type PersonDeskDeps,
} from "./person-desk.js";

export const COLLAB_HOST_PROTOCOL = "agenttool.collab-host/1" as const;
export const COLLAB_KNOCK_PROTOCOL = "agenttool.collab-knock/1" as const;
export const COLLAB_DOORBELL_SCAN_PROTOCOL = "agenttool.collab-doorbell-scan/1" as const;
export const KNOCK_LEDGER_FORMAT = "agenttool.collab-knock-ledger/1" as const;

export const COLLAB_HOST_USAGE =
  "usage: agenttool-collab-host end (--session-file <path> | --seat-ref <ref> [--seat-ref <ref>...]) --reason <text>"
  + " [--release-leases] [--db <path>]"
  + " | agenttool-collab-host wait (--session <id> | --session-file <path>) [--after-anchor <json>]"
  + " [--wait-ms <ms>] [--include-own] [--addressed] [--db <path>]"
  + ` | agenttool-collab-host person ... (${PERSON_DESK_USAGE})`
  + " | agenttool-collab-host person-remote (SSH forced command; reads a JSON argv from SSH_ORIGINAL_COMMAND)";
export const COLLAB_KNOCKS_USAGE =
  "usage: agenttool-collab-host knocks --host-ancestor auto|<pid> [--mark-tapped] [--db <path>]";
export const COLLAB_KNOCKS_SESSION_USAGE =
  "usage: agenttool-collab-host knocks --session <id> [--mark-tapped] [--with-sender] [--db <path>]";
export const COLLAB_DOORBELL_SCAN_USAGE = "usage: agenttool-collab-host doorbell-scan [--db <path>]";
/** Every verb's usage in one line, for `--help` and for an error that could not tell which verb was meant. */
export const COLLAB_HOST_HELP_USAGE = [
  COLLAB_HOST_USAGE,
  ...[COLLAB_KNOCKS_USAGE, COLLAB_KNOCKS_SESSION_USAGE, COLLAB_DOORBELL_SCAN_USAGE]
    .map((line) => line.slice("usage: ".length)),
].join(" | ");

/** The trimmed-length limit endSession applies to its reason. */
const MAX_HOST_REASON = 2_000;
/** store.ts APPLICATION_ID ("ATCL"): a read-only verb never reads another application's SQLite file. */
const COLLAB_APPLICATION_ID = 0x4154434c;
/** A ledger lock older than this was left by a crashed run and may be broken. */
const LEDGER_LOCK_STALE_MS = 30_000;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
/** knocks --session refuses a longer id before it opens the journal. */
const MAX_KNOCK_SESSION_ID = 200;

/**
 * The host, not a model turn, sits in a doorbell wait, so its bound is longer
 * than collab_events_wait's 30 seconds. One hour keeps a re-arming listener
 * well inside the 6-hour liveness view.
 */
export const DEFAULT_HOST_WAIT_MS = 600_000;
export const MAX_HOST_WAIT_MS = 3_600_000;
const HOST_WAIT_POLL_MS = 250;

export interface HostEndReceipt {
  protocol: typeof COLLAB_HOST_PROTOCOL;
  status: "ended" | "already_ended";
  session_id: string;
  released: SessionEndRelease[];
  ended_at: string | null;
  /** Present only when the session is ended but its revoked credential file is still on disk. */
  warning?: "session_file_remove_failed";
}

/** One session's outcome in an end by seat ref. Never carries the credential. */
export interface HostSeatRefSession {
  session_id: string;
  /** credential_missing: no credential file at the default path, so the session stays open. */
  status: "ended" | "already_ended" | "credential_missing" | "error";
  released?: SessionEndRelease[];
  ended_at?: string | null;
  warning?: "session_file_remove_failed";
  error?: string;
  message?: string;
}

export interface HostSeatRefEndReceipt {
  protocol: typeof COLLAB_HOST_PROTOCOL;
  status: "ended_by_seat_ref";
  seat_refs: string[];
  /** Every active session that declared one of the refs, oldest first; empty when none did. */
  sessions: HostSeatRefSession[];
}

export interface HostSeatRefEndOptions {
  seat_refs: string[];
  reason: string;
  release_leases: boolean;
}

export interface HostErrorReceipt {
  [detail: string]: unknown;
  protocol: typeof COLLAB_HOST_PROTOCOL;
  status: "error";
  error: string;
  message: string;
}

export interface HostHelpReceipt {
  protocol: typeof COLLAB_HOST_PROTOCOL;
  status: "help";
  usage: string;
  /** Every verb this build answers. A build older than this list answers --help without it. */
  verbs: readonly string[];
  /** The verbs among them that print their own protocol's line or nothing, and always exit 0. */
  quiet_verbs: readonly string[];
}

export interface HostEndOptions {
  session_file: string;
  reason: string;
  release_leases: boolean;
}

/** One doorbell pointer: never a body. `kind` is the journal event type. */
export interface KnockItem {
  seq: number;
  kind: "report.posted" | "handoff.offered";
  from_actor: string;
  ref_id: string;
}

/** A KnockItem plus the sender's session id, present only when asked for. */
export interface SenderKnockItem extends KnockItem {
  /** `events.session_id` of the addressed event: the sending session, null for a legacy event. */
  from_session_id: string | null;
}

export interface KnockReport {
  protocol: typeof COLLAB_KNOCK_PROTOCOL;
  session_id: string;
  liveness: SessionLiveness;
  rest: SessionRest | null;
  waiting: number;
  new: KnockItem[];
}

export interface DoorbellScanSession {
  session_id: string;
  workspace_id: string;
  worktree_root: string;
  actor: string;
  rest: SessionRest;
  waiting: number;
  new: KnockItem[];
  binding: HostBinding | null;
}

export interface DoorbellScan {
  protocol: typeof COLLAB_DOORBELL_SCAN_PROTOCOL;
  sessions: DoorbellScanSession[];
}

/** Seams for the read-only verbs; production uses ps, process.ppid and the wall clock. */
export interface HostCliDependencies {
  process_table?: () => ProcessTable | null;
  /** The process `--host-ancestor auto` starts from. Default: process.ppid. */
  parent_pid?: number;
  now?: () => Date;
  /** The clock `wait` polls and sleeps on. Default: the system clock. */
  wait_clock?: HostWaitClock;
}

/**
 * A doorbell, not a delivery: it names where to continue and carries no
 * event type, actor, entity, or payload. Read the events through the
 * session's own verified MCP path (collab_next or collab_events_wait).
 */
export interface HostWaitReceipt {
  protocol: typeof COLLAB_HOST_PROTOCOL;
  status: "ready" | "idle";
  session_id: string;
  workspace_id: string;
  after_anchor: EventCursor;
  /** ready: the anchor just before the first unread event; idle: where to re-arm. */
  next_anchor: EventCursor;
  head_sequence: number;
  /** Events this session wrote itself, passed over unless --include-own. */
  skipped_own_events: number;
  /**
   * With --addressed only: events whose routing does not name this session.
   * An event never addresses its own author, so with --include-own the
   * session's own events are counted here too.
   */
  skipped_unaddressed_events?: number;
  waited_ms: number;
  /** time/1 (C3): the journal store's clock when this receipt was written, canonical UTC. */
  observed_at?: string;
  /**
   * Present when the first unread event exceeds the bounded page and could
   * not be inspected. On an idle receipt it means a standing rest kept the
   * wait before that event: nothing behind it can ring until the rest is over.
   * head_sequence is then only a lower bound: the page that would have
   * carried the head could not be read.
   */
  first_event_oversized?: true;
  /**
   * Events passed over, for good, because of the session's declared rest:
   * under a rest without wake_on "addressed", every event that would have
   * rung; under a rest with it, every such event not explicitly addressed to
   * the session. Absent when there were none.
   */
  skipped_held_events?: number;
  /** Idle only: a rest without wake_on "addressed" stood when the wait ended. */
  held_by_rest?: true;
}

export interface HostWaitOptions {
  /** Ring once this anchor is passed; defaults to the session's acknowledged cursor. */
  after_anchor?: EventCursor;
  wait_ms: number;
  include_own: boolean;
  /** Ring only for events whose routing fields name this session (CollabStore.eventAddressesSession). */
  addressed?: boolean;
}

export interface HostWaitClock {
  now(): number;
  sleep(ms: number): void;
}

const systemClock: HostWaitClock = {
  now: () => performance.now(),
  sleep: (ms) => {
    // A synchronous sleep keeps the CLI's single-receipt shape; SIGTERM still ends it.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  },
};

/**
 * Host-side end for a session whose MCP process is gone. Without
 * release_leases it first refuses, read-only, while a lease is live. It then
 * resumes with cursor recovery allowed (a stale generation or cursor in the
 * file is tolerated), ends through the store, and removes the credential
 * file. The returned receipt never contains the credential. The reason is
 * judged only by the end, after the resume, so callers pass one already
 * checked (parseHostArgs does this for the CLI).
 */
export function endSessionFromCredential(
  store: CollabStore,
  credential: SessionCredential,
  options: HostEndOptions,
): HostEndReceipt {
  let resumed: SessionHandle;
  try {
    if (!options.release_leases) store.preflightSessionEnd(credential);
    resumed = store.resumeSession(credential, { allow_cursor_recovery: true });
  } catch (error) {
    if (error instanceof CollabError && error.code === "session_auth_failed") {
      const known = store.getCoordinationSession(credential.session_id);
      if (known?.status === "ended") {
        return removeRevokedFile(options.session_file, {
          protocol: COLLAB_HOST_PROTOCOL,
          status: "already_ended",
          session_id: known.id,
          released: [],
          ended_at: known.ended_at,
        });
      }
    }
    throw error;
  }
  const ended = store.endSessionWithReleases({
    ...resumed.credential,
    reason: options.reason,
    release_leases: options.release_leases,
  });
  return removeRevokedFile(options.session_file, {
    protocol: COLLAB_HOST_PROTOCOL,
    status: "ended",
    session_id: ended.session.id,
    released: ended.released_leases.map(({ task_id, lease_id, via }) => ({
      task_id,
      lease_id,
      via,
    })),
    ended_at: ended.session.ended_at,
  });
}

/**
 * Host-side end for every active session that declared one of these seat refs
 * when it joined, for a host whose agent process is exiting or gone (a seat
 * ref is an unverified hint; ending a live process's session fences it).
 * Each session is ended from its credential file at the default path, exactly
 * as `end --session-file` would; a session without that file is reported as
 * credential_missing and left open. One session's refusal does not stop the
 * others. Every credential token read is added to `secrets` so the caller can
 * withhold a receipt that would contain one.
 */
export function endSessionsForSeatRefs(
  store: CollabStore,
  options: HostSeatRefEndOptions,
  secrets: string[] = [],
): HostSeatRefEndReceipt {
  const seatRefs = [...new Set(options.seat_refs.map(validateSeatRef))];
  const sessions = store.activeSessionIdsForSeatRefs(seatRefs).map((sessionId): HostSeatRefSession => {
    const sessionFile = store.defaultSessionCredentialPath(sessionId);
    if (!existsSync(sessionFile)) return { session_id: sessionId, status: "credential_missing" };
    try {
      const credential = readSessionCredentialFile(sessionFile);
      secrets.push(credential.session_token);
      if (credential.session_id !== sessionId) {
        throw new CollabError("session_auth_failed", "Session credentials are invalid");
      }
      const { status, released, ended_at, warning } = endSessionFromCredential(store, credential, {
        session_file: sessionFile,
        reason: options.reason,
        release_leases: options.release_leases,
      });
      return { session_id: sessionId, status, released, ended_at, ...(warning ? { warning } : {}) };
    } catch (error) {
      const { error: code, message } = errorReceipt(error);
      return { session_id: sessionId, status: "error", error: code, message };
    }
  });
  return { protocol: COLLAB_HOST_PROTOCOL, status: "ended_by_seat_ref", seat_refs: seatRefs, sessions };
}

/**
 * Host-side doorbell for a live session. It reads with the session's current
 * generation and never resumes, acknowledges, or writes, so it cannot fence
 * the MCP process that owns the credential. Each poll is the same
 * authenticated, chain-verified snapshot collab_events_wait uses; fencing,
 * session end, cursor recovery, rollback, or fork fails explicitly.
 *
 * A declared rest is the session's own statement of what may start a turn in
 * it, so the doorbell obeys it. Under a rest without wake_on "addressed"
 * nothing rings; under a rest with it, only a note explicitly addressed to the
 * session rings (isAddressedTo: the set a host doorbell wakes for), whatever
 * the flags ask. What a rest holds is passed over, not kept for later: it
 * waits in the journal, collab_next counts it on return, and the end of
 * `until` starts nothing. That holds for a wait that keeps running or is
 * continued from next_anchor: the rest is judged when a poll sees the event,
 * so a note landing in the last poll interval before the rest ends, or a wait
 * armed afresh from the acknowledged cursor after it, still rings. The rest
 * is read at most once per page, only when an event would ring, and once at
 * the deadline, so a quiet wait costs one extra read.
 */
export function waitForSessionEvents(
  store: CollabStore,
  credential: SessionCredential,
  options: HostWaitOptions,
  clock: HostWaitClock = systemClock,
): HostWaitReceipt {
  const session = store.getCoordinationSession(credential.session_id);
  if (!session) throw new CollabError("session_auth_failed", "Session credentials are invalid");
  const workspaceId = session.workspace_id;
  const afterAnchor = { ...(options.after_anchor ?? session.cursor) };
  const started = clock.now();
  const deadline = started + options.wait_ms;
  let observed = afterAnchor;
  let skipped = 0;
  let unaddressed = 0;
  let held = 0;
  const standingRest = (): SessionRest | null => store.getCoordinationSession(session.id)?.rest ?? null;
  const holds = (rest: SessionRest | null): boolean => rest !== null && !rest.wake_on.includes("addressed");
  // One read serves a whole page: the page is a single snapshot already.
  let pageRest: { rest: SessionRest | null } | null = null;
  let pinnedByOversized = false;
  /** Whether the session's rest lets this would-ring event ring. */
  const restAllows = (event: Parameters<CollabStore["eventAddressesSession"]>[0]): boolean => {
    pageRest ??= { rest: standingRest() };
    const rest = pageRest.rest;
    if (rest === null) return true;
    if (holds(rest)) return false;
    return isAddressedTo({
      type: event.type,
      session_id: event.session_id ?? null,
      payload_json: JSON.stringify(event.payload ?? null),
    }, session.id);
  };
  const receipt = (status: HostWaitReceipt["status"], headSequence: number): HostWaitReceipt => ({
    protocol: COLLAB_HOST_PROTOCOL,
    status,
    session_id: session.id,
    workspace_id: workspaceId,
    after_anchor: afterAnchor,
    next_anchor: { ...observed },
    head_sequence: headSequence,
    skipped_own_events: skipped,
    ...(options.addressed ? { skipped_unaddressed_events: unaddressed } : {}),
    waited_ms: Math.max(0, Math.round(clock.now() - started)),
    observed_at: store.observedAt(),
    ...(held > 0 ? { skipped_held_events: held } : {}),
  });
  const idle = (headSequence: number): HostWaitReceipt => ({
    ...receipt("idle", headSequence),
    ...(holds(standingRest()) ? { held_by_rest: true as const } : {}),
    ...(pinnedByOversized ? { first_event_oversized: true as const } : {}),
  });
  let headSequence = observed.sequence;
  while (true) {
    let drained = true;
    pageRest = null;
    pinnedByOversized = false;
    try {
      const page = store.eventsAfterAnchorForSession({
        ...credential,
        workspace_id: workspaceId,
        after_anchor: observed,
        event_limit: MAX_WAIT_EVENT_LIMIT,
      });
      headSequence = page.head_sequence;
      for (const event of page.events) {
        const own = event.session_id === credential.session_id;
        const routed = !options.addressed || store.eventAddressesSession(event, session.id);
        const rings = (options.include_own || !own) && routed;
        if (rings && restAllows(event)) return receipt("ready", headSequence);
        observed = { epoch_id: event.epoch_id, sequence: event.sequence, hash: event.hash };
        // Under a rest, the task event beside a review request or a verdict is
        // not held mail: the addressed report written beside it is judged on its
        // own, rung or held, so one request or verdict counts once.
        if (rings && options.addressed && ADDRESS_CARRIED_BY_REPORT.has(event.type)) unaddressed += 1;
        else if (rings) held += 1;
        else if (own && !options.include_own) skipped += 1;
        else unaddressed += 1;
      }
      drained = !page.has_more;
    } catch (error) {
      if (error instanceof CollabError && error.code === "event_too_large") {
        // Its author and routing are unknown without a larger read, so ring
        // rather than skip it. Under any standing rest it can be neither rung
        // (consent unknown) nor passed over (unread), so the wait stays before
        // it; this one event can still ring once the rest is over.
        if (standingRest() === null) return { ...receipt("ready", headSequence), first_event_oversized: true };
        pinnedByOversized = true;
      } else if (!(error instanceof CollabError) || error.code !== "event_read_busy" || clock.now() >= deadline) {
        throw error;
      }
    }
    if (!drained) continue;
    const remaining = deadline - clock.now();
    if (remaining <= 0) return idle(headSequence);
    clock.sleep(Math.min(HOST_WAIT_POLL_MS, remaining));
  }
}

/**
 * Task events whose address the routed rule reads but whose explicit address
 * is the report written beside them (a review request, a verdict).
 */
const ADDRESS_CARRIED_BY_REPORT: ReadonlySet<string> = new Set([
  "task.reported_complete",
  "task.accepted",
  "task.changes_requested",
]);

/** The session is ended either way; a leftover revoked file is a warning, not a failure. */
function removeRevokedFile(sessionFile: string, receipt: HostEndReceipt): HostEndReceipt {
  try {
    removeSessionCredentialFile(sessionFile);
    return receipt;
  } catch {
    return { ...receipt, warning: "session_file_remove_failed" };
  }
}

/**
 * Parse argv and run one verb. `end` and `wait` return exactly one JSON
 * receipt line. `knocks` and `doorbell-scan` are read-only and consulted from hooks and
 * timers: they return one JSON line or null (print nothing), and every
 * failure, including a usage error, is null with exit 0.
 */
export function runCollabHostCli(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  dependencies: HostCliDependencies = {},
  personDeps: PersonDeskDeps = {},
): { exit_code: 0 | 1 | 3; line: string | null } {
  const [verb, ...rest] = argv;
  if (verb !== undefined && Object.hasOwn(HOST_VERBS, verb)) {
    return HOST_VERBS[verb as HostVerb].run(rest, argv, env, dependencies, personDeps);
  }
  if (verb !== undefined && !verb.startsWith("-")) {
    // A word this build does not know: another build's verb, or a typo. It is
    // answered before its flags are parsed, and nothing given is echoed back.
    return { exit_code: 1, line: JSON.stringify(errorReceipt(verbUsageError("Unknown verb"))) };
  }
  // No verb yet: --help, or end or wait with an option before the verb.
  return runEndOrWait(argv, env, dependencies.wait_clock ?? systemClock);
}

type HostVerbRun = (
  rest: string[],
  argv: string[],
  env: Record<string, string | undefined>,
  dependencies: HostCliDependencies,
  personDeps: PersonDeskDeps,
) => { exit_code: 0 | 1 | 3; line: string | null };

const runReceiptVerb: HostVerbRun = (_rest, argv, env, dependencies) =>
  runEndOrWait(argv, env, dependencies.wait_clock ?? systemClock);

/**
 * Every verb this build answers. Dispatch reads this table and help prints
 * it, so a verb cannot be answered without being listed. A quiet verb prints
 * its own protocol's line or nothing and always exits 0, so for any build,
 * exit 1 with a usage_error receipt means the verb is absent. The person
 * desk's verbs print their own receipts and exit codes (3: refused at the
 * desk) and never read a session credential.
 */
const HOST_VERBS = {
  end: { quiet: false, run: runReceiptVerb },
  wait: { quiet: false, run: runReceiptVerb },
  knocks: { quiet: true, run: (rest, _argv, env, dependencies) => quietly(() => runKnocks(rest, env, dependencies)) },
  "doorbell-scan": {
    quiet: true,
    run: (rest, _argv, env, dependencies) => quietly(() => runDoorbellScan(rest, env, dependencies)),
  },
  person: { quiet: false, run: (rest, _argv, env, _dependencies, personDeps) => runPersonDeskCli(rest, env, personDeps) },
  "person-remote": {
    quiet: false,
    // The SSH forced command reads its argv from SSH_ORIGINAL_COMMAND and takes none of its own.
    run: (rest, argv, env, dependencies, personDeps) => {
      if (rest.length === 0) return runPersonRemoteCli(env, personDeps);
      if (rest.some((arg) => arg === "--help" || arg === "-h")) {
        return runEndOrWait(argv, env, dependencies.wait_clock ?? systemClock);
      }
      const refusal = new CollabError("usage_error", `person-remote takes no arguments; ${COLLAB_HOST_USAGE}`);
      return { exit_code: 1, line: JSON.stringify(errorReceipt(refusal)) };
    },
  },
} satisfies Record<string, { quiet: boolean; run: HostVerbRun }>;
type HostVerb = keyof typeof HOST_VERBS;

export const COLLAB_HOST_VERBS: readonly string[] = Object.keys(HOST_VERBS);
export const COLLAB_HOST_QUIET_VERBS: readonly string[] =
  COLLAB_HOST_VERBS.filter((verb) => HOST_VERBS[verb as HostVerb].quiet);

/** A usage error that could not tell which verb was meant: it names them all. */
function verbUsageError(problem: string): CollabError {
  return new CollabError("usage_error", `${problem}; ${COLLAB_HOST_HELP_USAGE}`, {
    verbs: COLLAB_HOST_VERBS,
    quiet_verbs: COLLAB_HOST_QUIET_VERBS,
  });
}

function quietly(run: () => KnockReport | DoorbellScan | null): { exit_code: 0; line: string | null } {
  try {
    const payload = run();
    return { exit_code: 0, line: payload === null ? null : JSON.stringify(payload) };
  } catch {
    return { exit_code: 0, line: null };
  }
}

function runEndOrWait(
  argv: string[],
  env: Record<string, string | undefined>,
  clock: HostWaitClock,
): { exit_code: 0 | 1; line: string } {
  const secrets: string[] = [];
  if (argv.some((arg) => arg === "--help" || arg === "-h")) {
    const help: HostHelpReceipt = {
      protocol: COLLAB_HOST_PROTOCOL,
      status: "help",
      usage: COLLAB_HOST_HELP_USAGE,
      verbs: COLLAB_HOST_VERBS,
      quiet_verbs: COLLAB_HOST_QUIET_VERBS,
    };
    return { exit_code: 0, line: JSON.stringify(help) };
  }
  const emit = (
    payload: HostEndReceipt | HostSeatRefEndReceipt | HostWaitReceipt | HostErrorReceipt,
    exitCode: 0 | 1,
  ) => {
    const line = JSON.stringify(payload);
    if (secrets.some((secret) => line.includes(secret))) {
      return {
        exit_code: 1 as const,
        line: JSON.stringify({
          protocol: COLLAB_HOST_PROTOCOL,
          status: "error",
          error: "receipt_withheld",
          message: "The receipt would have contained credential material and was withheld",
        }),
      };
    }
    return { exit_code: exitCode, line };
  };
  try {
    const args = parseHostArgs(argv);
    const databasePath = args.db ?? resolveDatabasePath(env);
    if (!existsSync(databasePath)) {
      throw new CollabError(
        "journal_not_found",
        "No collaboration journal exists at the selected path; pass --db or set AGENTOOL_COLLAB_DB",
      );
    }
    if (args.command === "end_by_seat_ref") {
      const store = new CollabStore(databasePath);
      try {
        const receipt = endSessionsForSeatRefs(store, args, secrets);
        // As for `end --session-file`: an ended session's host binding goes
        // with it. A session left open (no credential file, or an error) keeps its own.
        for (const session of receipt.sessions) {
          if (session.status === "ended" || session.status === "already_ended") {
            removeHostBinding(databasePath, session.session_id);
          }
        }
        return emit(receipt, receipt.sessions.some((session) => session.status === "error") ? 1 : 0);
      } finally {
        store.close();
      }
    }
    if (args.command === "end") {
      const credential = readSessionCredentialFile(args.session_file);
      secrets.push(credential.session_token);
      const store = new CollabStore(databasePath);
      try {
        const receipt = endSessionFromCredential(store, credential, {
          session_file: args.session_file,
          reason: args.reason,
          release_leases: args.release_leases,
        });
        // An ended session is never knocked or woken; its host binding goes with it.
        removeHostBinding(databasePath, receipt.session_id);
        return emit(receipt, 0);
      } finally {
        store.close();
      }
    }
    const store = new CollabStore(databasePath);
    try {
      const sessionFile = args.session_file ?? store.defaultSessionCredentialPath(args.session!);
      const credential = readSessionCredentialFile(sessionFile);
      secrets.push(credential.session_token);
      if (args.session !== undefined && credential.session_id !== args.session) {
        throw new CollabError("session_auth_failed", "Session credentials are invalid");
      }
      return emit(
        waitForSessionEvents(store, credential, {
          after_anchor: args.after_anchor,
          wait_ms: args.wait_ms,
          include_own: args.include_own,
          addressed: args.addressed,
        }, clock),
        0,
      );
    } finally {
      store.close();
    }
  } catch (error) {
    return emit(errorReceipt(error), 1);
  }
}

/**
 * The bin entry: as runCollabHostCli, plus the person desk's ceremonies, which
 * serve a page and so finish asynchronously. A ceremony prints its page line
 * through `io` first; the returned line is its final receipt.
 */
export async function runCollabHostCliAsync(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  io: CeremonyIo = {
    out: (line) => process.stdout.write(`${line}\n`),
    note: (line) => process.stderr.write(`${line}\n`),
    open: openInBrowser,
  },
  personDeps: PersonDeskDeps = {},
): Promise<{ exit_code: 0 | 1 | 3; line: string | null }> {
  const ceremony = argv[0] === "person"
    && !argv.some((arg) => arg === "--help" || arg === "-h")
    && (argv[1] === "ceremony" || (argv[1] === "passkey-enroll" && argv.includes("--ceremony")));
  if (ceremony) return runCeremonyCli(argv.slice(1), env, personDeps, io);
  return runCollabHostCli(argv, env, {}, personDeps);
}

type HostArgs =
  | ({ command: "end"; db?: string } & HostEndOptions)
  | ({ command: "end_by_seat_ref"; db?: string } & HostSeatRefEndOptions)
  | ({ command: "wait"; db?: string; session_file?: string; session?: string } & HostWaitOptions);

const END_ONLY_OPTIONS = ["reason", "release-leases", "seat-ref"] as const;
const WAIT_ONLY_OPTIONS = ["session", "after-anchor", "wait-ms", "include-own", "addressed"] as const;

function parseHostArgs(argv: string[]): HostArgs {
  let parsed: ReturnType<typeof parseHostOptions>;
  try {
    parsed = parseHostOptions(argv);
  } catch (error) {
    // A quiet verb placed after an option brings flags end and wait do not
    // know. Say where the verb belongs, not which flag was unknown.
    if (!argv.includes("end") && !argv.includes("wait")
      && COLLAB_HOST_QUIET_VERBS.some((verb) => argv.includes(verb))) {
      throw verbUsageError("The verb must be the first argument (end and wait may follow their options)");
    }
    throw new CollabError(
      "usage_error",
      `${error instanceof Error ? error.message : String(error)}; ${COLLAB_HOST_USAGE}`,
    );
  }
  const [command, ...extra] = parsed.positionals;
  if (command !== "end" && command !== "wait") {
    // No verb, or a quiet verb placed after an option: only end and wait may follow one.
    throw verbUsageError("The verb must be the first argument (end and wait may follow their options)");
  }
  if (extra.length > 0) {
    throw new CollabError("usage_error", COLLAB_HOST_USAGE);
  }
  const foreign = (command === "end" ? WAIT_ONLY_OPTIONS : END_ONLY_OPTIONS)
    .find((name) => parsed.values[name] !== undefined);
  if (foreign) {
    throw new CollabError("usage_error", `--${foreign} does not apply to ${command}; ${COLLAB_HOST_USAGE}`);
  }
  if (parsed.values.db !== undefined && parsed.values.db.trim() === "") {
    throw new CollabError("usage_error", `--db must not be empty; ${COLLAB_HOST_USAGE}`);
  }
  return command === "end" ? parseEndArgs(parsed.values) : parseWaitArgs(parsed.values);
}

function parseEndArgs(values: ReturnType<typeof parseHostOptions>["values"]): HostArgs {
  const sessionFile = values["session-file"];
  const seatRefs = values["seat-ref"];
  const reason = values.reason;
  if ((sessionFile === undefined) === (seatRefs === undefined)) {
    throw new CollabError("usage_error", `Pass exactly one of --session-file or --seat-ref; ${COLLAB_HOST_USAGE}`);
  }
  if (sessionFile !== undefined && sessionFile.trim() === "") {
    throw new CollabError("usage_error", `--session-file must not be empty; ${COLLAB_HOST_USAGE}`);
  }
  for (const seatRef of seatRefs ?? []) {
    try {
      validateSeatRef(seatRef);
    } catch (error) {
      throw new CollabError("usage_error", `${(error as Error).message}; ${COLLAB_HOST_USAGE}`);
    }
  }
  if (!reason || reason.trim() === "") {
    throw new CollabError("usage_error", `--reason is required; ${COLLAB_HOST_USAGE}`);
  }
  // The resume raises the generation and appends an event before the end
  // judges its reason, so refuse here what endSession would refuse there.
  if (reason.trim().length > MAX_HOST_REASON) {
    throw new CollabError(
      "usage_error",
      `--reason exceeds ${MAX_HOST_REASON} characters; ${COLLAB_HOST_USAGE}`,
    );
  }
  if (reason.includes("\0")) {
    throw new CollabError("usage_error", `--reason must not contain NUL bytes; ${COLLAB_HOST_USAGE}`);
  }
  const releaseLeases = values["release-leases"] === true;
  if (seatRefs !== undefined) {
    return { command: "end_by_seat_ref", seat_refs: seatRefs, reason, release_leases: releaseLeases, db: values.db };
  }
  return {
    command: "end",
    session_file: sessionFile!,
    reason,
    release_leases: releaseLeases,
    db: values.db,
  };
}

function parseWaitArgs(values: ReturnType<typeof parseHostOptions>["values"]): HostArgs {
  const sessionFile = values["session-file"];
  const session = values.session;
  if ((sessionFile === undefined) === (session === undefined)) {
    throw new CollabError("usage_error", `Pass exactly one of --session or --session-file; ${COLLAB_HOST_USAGE}`);
  }
  if ((sessionFile ?? session)!.trim() === "") {
    throw new CollabError("usage_error", `--session and --session-file must not be empty; ${COLLAB_HOST_USAGE}`);
  }
  let waitMs = DEFAULT_HOST_WAIT_MS;
  if (values["wait-ms"] !== undefined) {
    const raw = values["wait-ms"].trim();
    waitMs = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
    if (!Number.isSafeInteger(waitMs) || waitMs > MAX_HOST_WAIT_MS) {
      throw new CollabError(
        "usage_error",
        `--wait-ms must be an integer from 0 to ${MAX_HOST_WAIT_MS}; ${COLLAB_HOST_USAGE}`,
      );
    }
  }
  let afterAnchor: EventCursor | undefined;
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
    db: values.db,
  };
}

/** The anchor JSON a page returns as next_anchor; the store checks it against the journal. */
function parseAnchor(raw: string): EventCursor {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = null;
  }
  const anchor = value as Partial<EventCursor> | null;
  if (
    anchor === null
    || typeof anchor !== "object"
    || Array.isArray(anchor)
    || Object.keys(anchor).sort().join(",") !== "epoch_id,hash,sequence"
    || typeof anchor.epoch_id !== "string"
    || typeof anchor.hash !== "string"
    || !Number.isSafeInteger(anchor.sequence)
    || anchor.sequence! < 0
  ) {
    throw new CollabError(
      "usage_error",
      `--after-anchor must be JSON {"epoch_id","sequence","hash"}; ${COLLAB_HOST_USAGE}`,
    );
  }
  return { epoch_id: anchor.epoch_id, sequence: anchor.sequence!, hash: anchor.hash };
}

function parseHostOptions(argv: string[]) {
  return parseArgs({
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
      addressed: { type: "boolean" },
    },
  });
}

function runKnocks(
  argv: string[],
  env: Record<string, string | undefined>,
  dependencies: HostCliDependencies,
): KnockReport | null {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      "host-ancestor": { type: "string" },
      session: { type: "string" },
      "mark-tapped": { type: "boolean" },
      "with-sender": { type: "boolean" },
      db: { type: "string" },
    },
  });
  if (parsed.positionals.length > 0) throw new CollabError("usage_error", COLLAB_KNOCKS_USAGE);
  const ancestor = parsed.values["host-ancestor"];
  const session = parsed.values.session;
  const withSender = parsed.values["with-sender"] === true;
  // --session reads one session by id: no binding, no ps. It never combines
  // with --host-ancestor, and only it may ask for the sender's session id, so
  // the --host-ancestor output stays byte-identical.
  if (session !== undefined) {
    if (ancestor !== undefined) throw new CollabError("usage_error", COLLAB_KNOCKS_SESSION_USAGE);
    return knockForSession(selectedJournal(parsed.values.db, env), session, {
      mark_tapped: parsed.values["mark-tapped"] === true,
      include_sender_session: withSender,
      now: dependencies.now,
    });
  }
  if (withSender) throw new CollabError("usage_error", COLLAB_KNOCKS_SESSION_USAGE);
  let startPid: number;
  if (ancestor === "auto") {
    startPid = dependencies.parent_pid ?? process.ppid;
  } else if (ancestor !== undefined && /^[1-9][0-9]{0,9}$/.test(ancestor)) {
    startPid = Number(ancestor);
  } else {
    throw new CollabError("usage_error", COLLAB_KNOCKS_USAGE);
  }
  return knockForHost(selectedJournal(parsed.values.db, env), startPid, {
    ...dependencies,
    mark_tapped: parsed.values["mark-tapped"] === true,
  });
}

function runDoorbellScan(
  argv: string[],
  env: Record<string, string | undefined>,
  dependencies: HostCliDependencies,
): DoorbellScan {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: { db: { type: "string" } },
  });
  if (parsed.positionals.length > 0) throw new CollabError("usage_error", COLLAB_DOORBELL_SCAN_USAGE);
  return doorbellScan(selectedJournal(parsed.values.db, env), dependencies);
}

/**
 * The read-only verbs never create a journal: a missing or blank path is an
 * error (silence), and so is any path the store itself would refuse to open
 * (a symlink, a hard-linked or foreign-owned file).
 */
function selectedJournal(db: string | undefined, env: Record<string, string | undefined>): string {
  const path = db ?? resolveDatabasePath(env);
  if (path.trim() === "" || path === ":memory:" || !existsSync(path)) {
    throw new CollabError("journal_not_found", "No collaboration journal exists at the selected path");
  }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !isOwnedByCurrentUser(stat.uid)) {
    throw new CollabError("database_file_unsafe", "The journal path is not a private regular file");
  }
  return path;
}

/**
 * Open the journal read-only, never through CollabStore (which takes BEGIN
 * IMMEDIATE, writes pragmas and re-verifies every journal): readonly,
 * query_only, busy_timeout 0, like the store's nonblockingEventReader.
 *
 * A WAL journal whose last connection closed cleanly may have no -wal file,
 * and a readonly connection cannot create one (SQLITE_CANTOPEN) — the
 * doorbell's usual case when no MCP is running. Only then it reads through a
 * handle that never creates the journal (create: false) and refuses every
 * write (query_only), with no transaction lock and no persistent pragma.
 */
export function openReadOnly(databasePath: string): Database {
  try {
    return prepareReader(new Database(databasePath, { readonly: true, strict: true }));
  } catch (error) {
    if ((error as { code?: unknown }).code !== "SQLITE_CANTOPEN" || !existsSync(databasePath)) throw error;
    return prepareReader(new Database(databasePath, { readwrite: true, create: false, strict: true }));
  }
}

function prepareReader(db: Database): Database {
  try {
    db.exec("PRAGMA busy_timeout = 0; PRAGMA query_only = ON");
    // The first read of the header: an unopenable WAL fails here.
    const { application_id: applicationId } = db.query("PRAGMA application_id").get() as {
      application_id: number;
    };
    if (applicationId !== COLLAB_APPLICATION_ID) {
      throw new CollabError("database_application_mismatch", "The SQLite file belongs to another application");
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/**
 * The knock for the host nearest `startPid`: walk the ancestry (start
 * inclusive) to the nearest process recorded as a binding's host with the
 * same start time. Exactly one active session must be bound there; none or
 * several (one Desktop app-server hosting several threads, or two collab MCP
 * processes under one host) is silence (null), never a guess. Named child
 * slots never make it several: only a default-slot session writes a binding. With mark_tapped, the returned `new` items are recorded in
 * the private knock ledger before they are returned, so they never repeat;
 * a session at held rest is reported but never marked.
 */
export function knockForHost(
  databasePath: string,
  startPid: number,
  options: HostCliDependencies & { mark_tapped?: boolean } = {},
): KnockReport | null {
  const bindings = readHostBindings(databasePath);
  // Nothing bound: no ps call and no SQLite open.
  if (bindings.length === 0) return null;
  const table = (options.process_table ?? readProcessTable)();
  // ps failed or was denied (for example inside a Codex seatbelt): fail closed.
  if (!table) return null;
  const bound = boundHostFor(startPid, table, bindings);
  if (!bound) return null;
  const now = (options.now ?? (() => new Date()))();
  const db = openReadOnly(databasePath);
  let found: KnockRead | null;
  try {
    found = db.transaction(() => {
      const active = bound.flatMap((binding) => {
        const row = sessionRowById(db, binding.session_id);
        return row?.status === "active" ? [row] : [];
      });
      if (active.length !== 1) return null;
      // Never the sender: the --host-ancestor output stays byte-identical.
      return readKnockAt(db, active[0]!, now, false);
    })();
  } finally {
    db.close();
  }
  return found ? knockReport(databasePath, found, now, options.mark_tapped === true) : null;
}

/**
 * The knock for one session named by id, for a caller that already knows
 * which session it serves (the cross-device hub): no binding and no ps.
 * Null unless the id is well formed and the session is active. The rest of
 * the report, the held-rest rule and mark_tapped are knockForHost's own. With
 * include_sender_session, each item also carries the sender's session id.
 */
export function knockForSession(
  databasePath: string,
  sessionId: string,
  options: { mark_tapped?: boolean; include_sender_session?: boolean; now?: () => Date } = {},
): KnockReport | null {
  // A malformed id is refused before the journal is opened.
  if (sessionId.length > MAX_KNOCK_SESSION_ID || !SESSION_ID.test(sessionId)) return null;
  const now = (options.now ?? (() => new Date()))();
  const db = openReadOnly(databasePath);
  let found: KnockRead | null;
  try {
    found = db.transaction(() => {
      const session = sessionRowById(db, sessionId);
      if (session?.status !== "active") return null;
      return readKnockAt(db, session, now, options.include_sender_session === true);
    })();
  } finally {
    db.close();
  }
  return found ? knockReport(databasePath, found, now, options.mark_tapped === true) : null;
}

/**
 * Resting sessions that asked to be woken for addressed notes (`wake_on`
 * includes "addressed", rest unexpired, session active) and have waiting
 * items no tap has announced yet, each with its host binding or null.
 */
export function doorbellScan(
  databasePath: string,
  options: Pick<HostCliDependencies, "now"> = {},
): DoorbellScan {
  const now = (options.now ?? (() => new Date()))();
  const ledger = readKnockLedger(databasePath);
  const bindings = new Map(readHostBindings(databasePath).map((binding) => [binding.session_id, binding]));
  const db = openReadOnly(databasePath);
  try {
    const sessions = db.transaction(() => {
      const rows = db.query(`
        SELECT s.id, s.workspace_id, s.actor, s.status, s.last_seen_at, s.cursor_sequence,
          w.root_path AS worktree_root
        FROM coordination_sessions s
        JOIN worktrees w ON w.id = s.worktree_id
        WHERE s.status = 'active'
        ORDER BY s.joined_at, s.id
      `).all() as Array<ReadOnlySessionRow & { worktree_root: string }>;
      const found: DoorbellScanSession[] = [];
      for (const row of rows) {
        const rest = restAt(db, row, now);
        if (!rest || !rest.wake_on.includes("addressed")) continue;
        const waiting = addressedItems(db, row, false, knockReadThrough(db, row.workspace_id, row.id, row.cursor_sequence));
        const fresh = untapped(ledger, row.id, waiting);
        if (fresh.length === 0) continue;
        found.push({
          session_id: row.id,
          workspace_id: row.workspace_id,
          worktree_root: row.worktree_root,
          actor: row.actor,
          rest,
          waiting: waiting.length,
          new: fresh,
          binding: bindings.get(row.id) ?? null,
        });
      }
      return found;
    })();
    return { protocol: COLLAB_DOORBELL_SCAN_PROTOCOL, sessions };
  } finally {
    db.close();
  }
}

interface ReadOnlySessionRow {
  id: string;
  workspace_id: string;
  actor: string;
  status: string;
  last_seen_at: string;
  cursor_sequence: number;
}

/** One session's knock state, read inside the caller's read-only transaction. */
interface KnockRead {
  session: ReadOnlySessionRow;
  rest: SessionRest | null;
  waiting: KnockItem[] | SenderKnockItem[];
  /**
   * Sequences of addressed items past the acknowledged cursor alone: what a
   * build without the read mark still counts as waiting. The shared tap
   * ledger keeps an entry for as long as that, so no build announces it twice.
   */
  past_cursor: number[];
  /**
   * The workspace's event head in this snapshot. A ledger entry above it was
   * written by a tap that read a newer snapshot, so this read cannot judge it.
   */
  head: number;
}

/**
 * The shared reader of knockForHost and knockForSession. Each caller opens
 * its own single read-only transaction around it, so each report is read
 * from one snapshot.
 */
function readKnockAt(db: Database, session: ReadOnlySessionRow, now: Date, includeSender: boolean): KnockRead {
  const readThrough = knockReadThrough(db, session.workspace_id, session.id, session.cursor_sequence);
  const waiting = addressedItems(db, session, includeSender, readThrough);
  const pastCursor = readThrough === session.cursor_sequence
    ? waiting
    : addressedItems(db, session, false, session.cursor_sequence);
  const head = db.query("SELECT event_head_sequence FROM workspaces WHERE id = ?")
    .get(session.workspace_id) as { event_head_sequence: number } | null;
  return {
    session,
    rest: restAt(db, session, now),
    waiting,
    past_cursor: pastCursor.map((item) => item.seq),
    head: head?.event_head_sequence ?? 0,
  };
}

/** Build the report from one read; mark the new items unless the rest is held. */
function knockReport(databasePath: string, found: KnockRead, now: Date, markTappedItems: boolean): KnockReport {
  const { session, rest, waiting } = found;
  // A held rest (resting without wake_on "addressed") is never tapped: its items
  // stay unmarked, so they tap at the first turn after the session returns.
  const held = rest !== null && !rest.wake_on.includes("addressed");
  const fresh = markTappedItems && !held
    ? markTapped(databasePath, session.id, waiting, found.past_cursor, found.head)
    : untapped(readKnockLedger(databasePath), session.id, waiting);
  return {
    protocol: COLLAB_KNOCK_PROTOCOL,
    session_id: session.id,
    liveness: livenessAt(session, rest, now),
    rest,
    waiting: waiting.length,
    new: fresh,
  };
}

/**
 * The bindings that may answer for the host nearest `startPid`. A recognised
 * host with no binding stops the walk, so a nested Codex never borrows the
 * Claude seat's knocks. A binding counts only while its mcp_pid is still a
 * collab MCP and that host's direct child (an exited MCP's reused pid is not).
 * An app-server must run exactly one collab MCP, since a hook cannot tell its
 * threads apart.
 */
function boundHostFor(
  startPid: number,
  table: ProcessTable,
  bindings: HostBinding[],
): HostBinding[] | null {
  for (const record of ancestry(startPid, table)) {
    const matched = bindings.filter(
      (binding) => binding.host_pid === record.pid && binding.host_started_at === record.started_at,
    );
    if (matched.length > 0) {
      if (hostKindOf(record, {}) === "codex-app-server" && collabChildren(table, record).length !== 1) {
        return null;
      }
      const live = matched.filter((binding) => {
        const mcp = table.get(binding.mcp_pid);
        return mcp !== undefined && mcp.ppid === record.pid && isCollabMcpProcess(mcp);
      });
      return live.length > 0 ? live : null;
    }
    if (isHostProcess(record)) return null;
  }
  return null;
}

function collabChildren(table: ProcessTable, host: ProcessRecord): ProcessRecord[] {
  return [...table.values()].filter((record) => record.ppid === host.pid && isCollabMcpProcess(record));
}

function sessionRowById(db: Database, sessionId: string): ReadOnlySessionRow | null {
  return db.query(`
    SELECT id, workspace_id, actor, status, last_seen_at, cursor_sequence
    FROM coordination_sessions WHERE id = ?
  `).get(sessionId) as ReadOnlySessionRow | null;
}

/**
 * The session's declared rest at `now`: the store's own latestRestDeclaration
 * query run on the read-only handle, judged by the store's restFromDeclaration
 * (returned, expired or damaged reads as no rest).
 */
function restAt(db: Database, session: ReadOnlySessionRow, now: Date): SessionRest | null {
  const declaration = db.query(`
    SELECT type, sequence, occurred_at, payload_json FROM events
    WHERE workspace_id = ? AND entity_id = ?
      AND type IN ('session.rested', 'session.returned')
    ORDER BY sequence DESC
    LIMIT 1
  `).get(session.workspace_id, session.id) as RestDeclarationRow | null;
  return declaration ? restFromDeclaration(declaration, now.toISOString()) : null;
}

/** Precedence ended → resting → stale → live, as the store derives it. */
function livenessAt(session: ReadOnlySessionRow, rest: SessionRest | null, now: Date): SessionLiveness {
  if (session.status !== "active") return "ended";
  if (rest) return "resting";
  const age = now.getTime() - Date.parse(session.last_seen_at);
  return age <= SESSION_STALE_AFTER_MS ? "live" : "stale";
}

/**
 * Addressed items past `after` (what the session has read: the store's own
 * knockReadThrough), judged by the store's own isAddressedTo, so `waiting`
 * always equals collab_next's addressed_waiting. The sender's session id
 * (`events.session_id`) is added last, and only when asked for.
 */
function addressedItems(
  db: Database,
  session: ReadOnlySessionRow,
  includeSender: boolean,
  after: number,
): KnockItem[] | SenderKnockItem[] {
  const rows = db.query(`
    SELECT sequence, type, actor, entity_id, session_id, payload_json FROM events
    WHERE workspace_id = ? AND sequence > ?
      AND type IN ('report.posted', 'handoff.offered')
    ORDER BY sequence
  `).all(session.workspace_id, after) as Array<
    AddressedEventRow & { sequence: number; actor: string; entity_id: string }
  >;
  const addressed = rows.filter((row) => isAddressedTo(row, session.id));
  const item = (row: (typeof addressed)[number]): KnockItem => ({
    seq: row.sequence,
    kind: row.type as KnockItem["kind"],
    from_actor: row.actor,
    ref_id: row.entity_id,
  });
  if (!includeSender) return addressed.map(item);
  return addressed.map((row): SenderKnockItem => ({ ...item(row), from_session_id: row.session_id }));
}

interface KnockLedger {
  format: typeof KNOCK_LEDGER_FORMAT;
  tapped: Record<string, number[]>;
}

/** `dirname(db)/collab-sessions/knock-ledger.json`: which items a tap has already announced. */
export function knockLedgerPath(databasePath: string): string {
  return join(collabSessionsDirectory(databasePath), "knock-ledger.json");
}

function untapped(ledger: KnockLedger, sessionId: string, waiting: KnockItem[]): KnockItem[] {
  const tapped = new Set(ledger.tapped[sessionId] ?? []);
  return waiting.filter((item) => !tapped.has(item.seq));
}

/** Missing reads as empty; an unsafe or damaged ledger refuses (the caller stays silent). */
function readKnockLedger(databasePath: string): KnockLedger {
  const path = knockLedgerPath(databasePath);
  let stat: Stats;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { format: KNOCK_LEDGER_FORMAT, tapped: {} };
    }
    throw error;
  }
  if (!isPrivateRegularFile(stat)) {
    throw new CollabError("knock_ledger_unsafe", "The knock ledger is not a private regular file");
  }
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!isKnockLedger(parsed)) {
    throw new CollabError("knock_ledger_invalid", "The knock ledger is malformed");
  }
  return parsed;
}

/**
 * Record the untapped items under an exclusive ledger lock and return them.
 * A held lock means another tap is in progress: refuse (silence) rather than
 * risk announcing an item twice; the next turn taps it.
 */
function markTapped(
  databasePath: string,
  sessionId: string,
  waiting: KnockItem[],
  pastCursor: number[],
  head: number,
): KnockItem[] {
  if (untapped(readKnockLedger(databasePath), sessionId, waiting).length === 0) return [];
  return withLedgerLock(databasePath, () => {
    const ledger = readKnockLedger(databasePath);
    const fresh = untapped(ledger, sessionId, waiting);
    if (fresh.length === 0) return [];
    // Keep only sequences past the acknowledged cursor: acknowledged items
    // never return. An item the read mark has passed is kept until the cursor
    // passes it too, because a build that counts from the cursor alone shares
    // this ledger and would otherwise announce it again. A sequence above this
    // snapshot's head was recorded by a tap that read a newer snapshot; this
    // read cannot judge it, so it is kept for a later tap to trim.
    const stillWaiting = new Set(pastCursor);
    const kept = (ledger.tapped[sessionId] ?? []).filter((seq) => stillWaiting.has(seq) || seq > head);
    const tapped = [...new Set([...kept, ...fresh.map((item) => item.seq)])].sort((left, right) => left - right);
    writeKnockLedger(databasePath, {
      format: KNOCK_LEDGER_FORMAT,
      tapped: { ...ledger.tapped, [sessionId]: tapped },
    });
    return fresh;
  });
}

function ledgerBusy(): CollabError {
  return new CollabError("knock_ledger_busy", "Another tap holds the knock ledger");
}

/** The same lock file: device, inode and mtime (a lock is never written after it is created). */
function sameLockFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mtimeMs === right.mtimeMs;
}

function withLedgerLock<T>(databasePath: string, run: () => T): T {
  const lock = `${knockLedgerPath(databasePath)}.lock`;
  const acquire = (): Stats => {
    const descriptor = openSync(lock, "wx", 0o600);
    try {
      return fstatSync(descriptor); // the file this tap created, not whatever the path names later
    } finally {
      closeSync(descriptor);
    }
  };
  let ours: Stats;
  try {
    ours = acquire();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    let judged: Stats;
    try {
      judged = lstatSync(lock);
    } catch {
      throw ledgerBusy(); // released in between: the next turn taps
    }
    if (Date.now() - judged.mtimeMs < LEDGER_LOCK_STALE_MS) throw ledgerBusy();
    breakStaleLedgerLock(lock, judged);
    try {
      ours = acquire();
    } catch (retry) {
      if ((retry as NodeJS.ErrnoException).code === "EEXIST") throw ledgerBusy();
      throw retry;
    }
  }
  try {
    return run();
  } finally {
    releaseLedgerLock(lock, ours);
  }
}

/**
 * Break a lock judged stale (left by a crashed tap). Two taps can judge the
 * same lock stale; if the other breaks it and takes a fresh lock first, an
 * unlink here would remove that live lock. So the lock is moved aside first
 * and checked: only the very file judged stale is removed. Anything else is
 * put back (a hard link cannot replace a lock taken meanwhile) and this tap is
 * busy. Exported for tests.
 */
export function breakStaleLedgerLock(lock: string, judged: Stats): void {
  const aside = `${lock}.broken-${randomUUID()}`;
  try {
    renameSync(lock, aside);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw ledgerBusy();
    throw error;
  }
  try {
    if (sameLockFile(lstatSync(aside), judged)) return;
    try {
      linkSync(aside, lock);
    } catch {
      // A lock taken in the meantime stands; the moved one's holder finds a
      // different file at release and leaves it alone.
    }
    throw ledgerBusy();
  } finally {
    try {
      unlinkSync(aside);
    } catch {
      // Nothing more to remove.
    }
  }
}

/** Remove the lock only if it is still the one this tap created. Exported for tests. */
export function releaseLedgerLock(lock: string, ours: Stats): void {
  try {
    if (sameLockFile(lstatSync(lock), ours)) unlinkSync(lock);
  } catch {
    // A lock that cannot be removed expires after LEDGER_LOCK_STALE_MS.
  }
}

function writeKnockLedger(databasePath: string, ledger: KnockLedger): void {
  const directory = collabSessionsDirectory(databasePath);
  const directoryStat = lstatSync(directory);
  if (
    !directoryStat.isDirectory()
    || directoryStat.isSymbolicLink()
    || !isOwnedByCurrentUser(directoryStat.uid)
    || (directoryStat.mode & 0o077) !== 0
  ) {
    throw new CollabError("session_directory_not_private", "The collab-sessions directory is not private");
  }
  const path = knockLedgerPath(databasePath);
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    const descriptor = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify(ledger)}\n`, "utf8");
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
      // Already renamed or never created.
    }
    throw error;
  }
}

function isKnockLedger(value: unknown): value is KnockLedger {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.format !== KNOCK_LEDGER_FORMAT) return false;
  const tapped = record.tapped;
  if (tapped === null || typeof tapped !== "object" || Array.isArray(tapped)) return false;
  return Object.entries(tapped).every(([sessionId, sequences]) =>
    SESSION_ID.test(sessionId)
    && Array.isArray(sequences)
    && sequences.every((sequence) => Number.isInteger(sequence) && sequence > 0)
  );
}

function isPrivateRegularFile(stat: Stats): boolean {
  return (
    stat.isFile()
    && !stat.isSymbolicLink()
    && isOwnedByCurrentUser(stat.uid)
    && (stat.mode & 0o077) === 0
  );
}

function isOwnedByCurrentUser(uid: number): boolean {
  return typeof process.getuid !== "function" || uid === process.getuid();
}

/** The store's refusal names the MCP parameter; on the host path, name the CLI flag. */
const HOST_ACTIVE_LEASES_MESSAGE =
  "Release, complete, or hand off active task leases before ending the session, or rerun with --release-leases";
const HOST_ACTIVE_LEASES_REMEDY =
  "Rerun with --release-leases to release every lease this session holds and end it in one step, "
  + "or release, complete, or hand off each lease first (a handoff counts once it is accepted).";

function errorReceipt(error: unknown): HostErrorReceipt {
  if (error instanceof CollabError) {
    const activeLeases = error.code === "session_has_active_leases";
    return {
      ...error.details,
      ...(activeLeases ? { remedy: HOST_ACTIVE_LEASES_REMEDY } : {}),
      protocol: COLLAB_HOST_PROTOCOL,
      status: "error",
      error: error.code,
      message: activeLeases ? HOST_ACTIVE_LEASES_MESSAGE : error.message,
    };
  }
  return {
    protocol: COLLAB_HOST_PROTOCOL,
    status: "error",
    error: "internal_error",
    message: error instanceof Error ? error.message : String(error),
  };
}
