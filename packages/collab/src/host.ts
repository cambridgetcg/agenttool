import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { resolveDatabasePath } from "./database-path.js";
import { CollabError } from "./errors.js";
import type { SessionCredential, SessionEndRelease, SessionHandle } from "./protocol.js";
import {
  readSessionCredentialFile,
  removeSessionCredentialFile,
} from "./session-file.js";
import { CollabStore } from "./store.js";

export const COLLAB_HOST_PROTOCOL = "agenttool.collab-host/1" as const;

export const COLLAB_HOST_USAGE =
  "usage: agenttool-collab-host end --session-file <path> --reason <text> [--release-leases] [--db <path>]";

/** The trimmed-length limit endSession applies to its reason. */
const MAX_HOST_REASON = 2_000;

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
): { exit_code: 0 | 1; line: string } {
  let secret: string | null = null;
  if (argv.some((arg) => arg === "--help" || arg === "-h")) {
    const help: HostHelpReceipt = { protocol: COLLAB_HOST_PROTOCOL, status: "help", usage: COLLAB_HOST_USAGE };
    return { exit_code: 0, line: JSON.stringify(help) };
  }
  const emit = (payload: HostEndReceipt | HostErrorReceipt, exitCode: 0 | 1) => {
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
  } catch (error) {
    return emit(errorReceipt(error), 1);
  }
}

function parseHostArgs(argv: string[]): HostEndOptions & { db?: string } {
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
  if (command !== "end" || extra.length > 0) {
    throw new CollabError("usage_error", COLLAB_HOST_USAGE);
  }
  const sessionFile = parsed.values["session-file"];
  const reason = parsed.values.reason;
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
  if (parsed.values.db !== undefined && parsed.values.db.trim() === "") {
    throw new CollabError("usage_error", `--db must not be empty; ${COLLAB_HOST_USAGE}`);
  }
  return {
    session_file: sessionFile,
    reason,
    release_leases: parsed.values["release-leases"] === true,
    db: parsed.values.db,
  };
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
