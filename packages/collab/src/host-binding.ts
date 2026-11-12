import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { CollabError } from "./errors.js";
import { nearestHost, type HostKind, type ProcessTreeOptions } from "./process-tree.js";

export const HOST_BINDING_FORMAT = "agenttool.collab-host-binding/1" as const;

/**
 * Which host process runs a bound session, written by that session's own MCP
 * process from the process tree. Non-secret: it names the credential file but
 * never holds the bearer.
 */
export interface HostBinding {
  format: typeof HOST_BINDING_FORMAT;
  session_id: string;
  host_kind: HostKind;
  host_pid: number;
  host_started_at: string;
  mcp_pid: number;
  credential_file_path: string;
  written_at: string;
}

const HOST_KINDS: readonly HostKind[] = ["claude-code", "codex", "codex-app-server", "unknown"];
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const BINDING_SUFFIX = ".host.json";

/** `dirname(db)/collab-sessions`: the directory credential files already use. */
export function collabSessionsDirectory(dbPath: string): string {
  return join(dirname(resolve(dbPath)), "collab-sessions");
}

/** `dirname(db)/collab-sessions/<session_id>.host.json`. */
export function hostBindingPath(dbPath: string, sessionId: string): string {
  if (!isSessionId(sessionId)) {
    throw new CollabError("invalid_session_id", "session_id contains unsupported characters");
  }
  return join(collabSessionsDirectory(dbPath), `${sessionId}${BINDING_SUFFIX}`);
}

/** Atomically write (or replace) one binding, mode 0600, in a private directory. */
export function writeHostBinding(dbPath: string, binding: HostBinding): string {
  if (!isHostBinding(binding)) {
    throw new CollabError("host_binding_invalid", "The host binding is malformed", {
      operation: "write_host_binding",
    });
  }
  const directory = collabSessionsDirectory(dbPath);
  const path = hostBindingPath(dbPath, binding.session_id);
  let temporary: string | null = null;
  try {
    const existed = existsSync(directory);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!existed) chmodSync(directory, 0o700);
    if (!isPrivateDirectory(directory)) {
      throw new CollabError(
        "session_directory_not_private",
        "Session credential directory must be a private non-symlink directory owned by this user",
        { operation: "write_host_binding" },
      );
    }
    if (pathExists(path) && !isPrivateFile(path)) {
      throw new CollabError(
        "host_binding_unsafe",
        "Refusing to replace a host binding path that is not a private regular file",
        { operation: "write_host_binding" },
      );
    }
    temporary = `${path}.tmp-${randomUUID()}`;
    const descriptor = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(descriptor, `${JSON.stringify(binding)}\n`, "utf8");
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, path);
    temporary = null;
    chmodSync(path, 0o600);
    return path;
  } catch (error) {
    if (temporary) {
      try {
        unlinkSync(temporary);
      } catch {
        // The primary error below names the failed binding write.
      }
    }
    if (error instanceof CollabError) throw error;
    throw new CollabError("host_binding_write_failed", "Could not write the local host binding file", {
      operation: "write_host_binding",
    });
  }
}

/**
 * Remove one binding. True when it is gone (or never existed); false when it
 * could not be removed or the path is not a private regular file. Never throws.
 */
export function removeHostBinding(dbPath: string, sessionId: string): boolean {
  try {
    const path = hostBindingPath(dbPath, sessionId);
    if (!pathExists(path)) return true;
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || !isOwnedByCurrentUser(stat.uid)) return false;
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Every well-formed binding in a private `collab-sessions` directory, sorted
 * by session id. Unsafe or malformed files are skipped, never trusted; a
 * missing or non-private directory reads as none. Never throws.
 */
export function readHostBindings(dbPath: string): HostBinding[] {
  const directory = collabSessionsDirectory(dbPath);
  let names: string[];
  try {
    if (!isPrivateDirectory(directory)) return [];
    names = readdirSync(directory).sort();
  } catch {
    return [];
  }
  const bindings: HostBinding[] = [];
  for (const name of names) {
    if (!name.endsWith(BINDING_SUFFIX)) continue;
    const path = join(directory, name);
    try {
      if (!isPrivateFile(path)) continue;
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (!isHostBinding(parsed) || `${parsed.session_id}${BINDING_SUFFIX}` !== name) continue;
      bindings.push({
        format: HOST_BINDING_FORMAT,
        session_id: parsed.session_id,
        host_kind: parsed.host_kind,
        host_pid: parsed.host_pid,
        host_started_at: parsed.host_started_at,
        mcp_pid: parsed.mcp_pid,
        credential_file_path: parsed.credential_file_path,
        written_at: parsed.written_at,
      });
    } catch {
      // Unreadable or malformed: skipped, never fatal.
    }
  }
  return bindings;
}

export interface HostBindingRecorder {
  /** Write this process's binding for a bound session. Never throws; false when none was written. */
  record(sessionId: string, credentialFilePath: string): boolean;
  /** Remove a session's binding. Never throws. */
  forget(sessionId: string): void;
}

export interface HostBindingRecorderOptions extends ProcessTreeOptions {
  /** This collab MCP process. Default: process.pid. */
  mcp_pid?: number;
  now?: () => Date;
}

/**
 * The bin's recorder: the host is this MCP process's direct parent
 * (nearestHost). A binding is either current or absent: when the host cannot
 * be read, any older binding for the session is removed rather than left
 * pointing at a previous host.
 */
export function hostBindingRecorder(
  dbPath: string,
  options: HostBindingRecorderOptions = {},
): HostBindingRecorder {
  const mcpPid = options.mcp_pid ?? process.pid;
  const now = options.now ?? (() => new Date());
  return {
    record(sessionId, credentialFilePath) {
      try {
        const host = nearestHost(mcpPid, options);
        if (!host) {
          removeHostBinding(dbPath, sessionId);
          return false;
        }
        writeHostBinding(dbPath, {
          format: HOST_BINDING_FORMAT,
          session_id: sessionId,
          host_kind: host.kind,
          host_pid: host.pid,
          host_started_at: host.started_at,
          mcp_pid: mcpPid,
          credential_file_path: resolve(credentialFilePath),
          written_at: now().toISOString(),
        });
        return true;
      } catch {
        removeHostBinding(dbPath, sessionId);
        return false;
      }
    },
    forget(sessionId) {
      removeHostBinding(dbPath, sessionId);
    },
  };
}

function isHostBinding(value: unknown): value is HostBinding {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.format === HOST_BINDING_FORMAT
    && typeof record.session_id === "string"
    && isSessionId(record.session_id)
    && typeof record.host_kind === "string"
    && (HOST_KINDS as readonly string[]).includes(record.host_kind)
    && isProcessId(record.host_pid)
    && typeof record.host_started_at === "string"
    && record.host_started_at.trim() !== ""
    && isProcessId(record.mcp_pid)
    && typeof record.credential_file_path === "string"
    && isAbsolute(record.credential_file_path)
    && typeof record.written_at === "string"
    && !Number.isNaN(Date.parse(record.written_at))
  );
}

function isSessionId(value: string): boolean {
  return value.length <= 200 && SESSION_ID.test(value);
}

/** pid 0 and launchd (1) never host or run a collab MCP. */
function isProcessId(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 1;
}

function pathExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function isPrivateDirectory(path: string): boolean {
  const stat = lstatSync(path);
  return (
    stat.isDirectory()
    && !stat.isSymbolicLink()
    && isOwnedByCurrentUser(stat.uid)
    && (stat.mode & 0o077) === 0
  );
}

function isPrivateFile(path: string): boolean {
  const stat = lstatSync(path);
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
