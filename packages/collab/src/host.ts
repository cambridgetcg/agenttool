import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { resolveDatabasePath } from "./database-path.js";
import { CollabError } from "./errors.js";
import {
  MAX_WAIT_EVENT_LIMIT,
  type EventCursor,
  type SessionCredential,
  type SessionEndRelease,
  type SessionHandle,
} from "./protocol.js";
import {
  readSessionCredentialFile,
  removeSessionCredentialFile,
} from "./session-file.js";
import { CollabStore } from "./store.js";
import { PERSON_DESK_USAGE, runPersonDeskCli, type PersonDeskDeps } from "./person-desk.js";

export const COLLAB_HOST_PROTOCOL = "agenttool.collab-host/1" as const;

export const COLLAB_HOST_USAGE =
  "usage: agenttool-collab-host end --session-file <path> --reason <text> [--release-leases] [--db <path>]"
  + " | agenttool-collab-host wait (--session <id> | --session-file <path>) [--after-anchor <json>]"
  + " [--wait-ms <ms>] [--include-own] [--addressed] [--db <path>]"
  + ` | agenttool-collab-host person ... (${PERSON_DESK_USAGE})`;

/** The trimmed-length limit endSession applies to its reason. */
const MAX_HOST_REASON = 2_000;

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
}

export interface HostEndOptions {
  session_file: string;
  reason: string;
  release_leases: boolean;
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
  /** With --addressed only: other sessions' events whose routing does not name this session. */
  skipped_unaddressed_events?: number;
  waited_ms: number;
  /** Present when the first unread event exceeds the bounded page and could not be inspected. */
  first_event_oversized?: true;
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
 * Host-side doorbell for a live session. It reads with the session's current
 * generation and never resumes, acknowledges, or writes, so it cannot fence
 * the MCP process that owns the credential. Each poll is the same
 * authenticated, chain-verified snapshot collab_events_wait uses; fencing,
 * session end, cursor recovery, rollback, or fork fails explicitly.
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
  });
  let headSequence = observed.sequence;
  while (true) {
    let drained = true;
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
        if ((options.include_own || !own) && routed) {
          return receipt("ready", headSequence);
        }
        observed = { epoch_id: event.epoch_id, sequence: event.sequence, hash: event.hash };
        if (own && !options.include_own) skipped += 1;
        else unaddressed += 1;
      }
      drained = !page.has_more;
    } catch (error) {
      if (error instanceof CollabError && error.code === "event_too_large") {
        // Its author and routing are unknown without a larger read, so ring rather than skip it.
        return { ...receipt("ready", headSequence), first_event_oversized: true };
      }
      if (!(error instanceof CollabError) || error.code !== "event_read_busy" || clock.now() >= deadline) {
        throw error;
      }
    }
    if (!drained) continue;
    const remaining = deadline - clock.now();
    if (remaining <= 0) return receipt("idle", headSequence);
    clock.sleep(Math.min(HOST_WAIT_POLL_MS, remaining));
  }
}

/** The session is ended either way; a leftover revoked file is a warning, not a failure. */
function removeRevokedFile(sessionFile: string, receipt: HostEndReceipt): HostEndReceipt {
  try {
    removeSessionCredentialFile(sessionFile);
    return receipt;
  } catch {
    return { ...receipt, warning: "session_file_remove_failed" };
  }
}

/** Parse argv, run one command, and return the single JSON receipt line. */
export function runCollabHostCli(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
  clock: HostWaitClock = systemClock,
  personDeps: PersonDeskDeps = {},
): { exit_code: 0 | 1 | 3; line: string } {
  // The person desk has its own verbs and receipts; it never reads a session credential.
  if (argv[0] === "person") return runPersonDeskCli(argv.slice(1), env, personDeps);
  let secret: string | null = null;
  if (argv.some((arg) => arg === "--help" || arg === "-h")) {
    const help: HostHelpReceipt = { protocol: COLLAB_HOST_PROTOCOL, status: "help", usage: COLLAB_HOST_USAGE };
    return { exit_code: 0, line: JSON.stringify(help) };
  }
  const emit = (payload: HostEndReceipt | HostWaitReceipt | HostErrorReceipt, exitCode: 0 | 1) => {
    const line = JSON.stringify(payload);
    if (secret !== null && line.includes(secret)) {
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
    if (args.command === "end") {
      const credential = readSessionCredentialFile(args.session_file);
      secret = credential.session_token;
      const store = new CollabStore(databasePath);
      try {
        return emit(
          endSessionFromCredential(store, credential, {
            session_file: args.session_file,
            reason: args.reason,
            release_leases: args.release_leases,
          }),
          0,
        );
      } finally {
        store.close();
      }
    }
    const store = new CollabStore(databasePath);
    try {
      const sessionFile = args.session_file ?? store.defaultSessionCredentialPath(args.session!);
      const credential = readSessionCredentialFile(sessionFile);
      secret = credential.session_token;
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

type HostArgs =
  | ({ command: "end"; db?: string } & HostEndOptions)
  | ({ command: "wait"; db?: string; session_file?: string; session?: string } & HostWaitOptions);

const END_ONLY_OPTIONS = ["reason", "release-leases"] as const;
const WAIT_ONLY_OPTIONS = ["session", "after-anchor", "wait-ms", "include-own", "addressed"] as const;

function parseHostArgs(argv: string[]): HostArgs {
  let parsed: ReturnType<typeof parseHostOptions>;
  try {
    parsed = parseHostOptions(argv);
  } catch (error) {
    throw new CollabError(
      "usage_error",
      `${error instanceof Error ? error.message : String(error)}; ${COLLAB_HOST_USAGE}`,
    );
  }
  const [command, ...extra] = parsed.positionals;
  if ((command !== "end" && command !== "wait") || extra.length > 0) {
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
  const reason = values.reason;
  if (!sessionFile || sessionFile.trim() === "") {
    throw new CollabError("usage_error", `--session-file is required; ${COLLAB_HOST_USAGE}`);
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
  return {
    command: "end",
    session_file: sessionFile,
    reason,
    release_leases: values["release-leases"] === true,
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
