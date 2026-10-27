/** The two homes, and the package's only module that creates, changes or
 * removes files.
 *
 * The lobby home is resolved exactly as packages/lobby/src/home.ts does
 * (contract/lobby-contract.ts pins those rules) and is handed to every child
 * CLI as AGENTTOOL_LOBBY_HOME, so the child never re-resolves it from an
 * environment it does not see. Inside the lobby home the doorbell touches two
 * names: STOP (the one device brake, which `stop` writes and `resume` removes)
 * and the database file, which it only lstats: it never opens or reads the
 * database, it only checks that one exists before it lets a lobby command run.
 *
 * The doorbell home holds no secrets and no text: pidfiles, listener, mark,
 * bell and status files (validated ids, counts, cursors, times and closed
 * codes) and log.jsonl. Directories are 0700 and files 0600; wider modes,
 * other owners and symlinks are refused, never repaired. Netcheck never
 * creates the doorbell home; `listen` does.
 */
import {
  closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync, type Stats,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { DoorbellError, UsageError } from "./errors.js";

export type Environment = Record<string, string | undefined>;

export const LOBBY_HOME_ENV = "AGENTTOOL_LOBBY_HOME";
/** Tests only: overrides the doorbell home, like the `--home` flag. */
export const DOORBELL_HOME_ENV = "AGENTTOOL_LOBBY_DOORBELL_HOME";
export const STOP_FILE = "STOP";
/** The lobby's database file name (pinned by the contract). Only ever lstat'ed, never opened. */
export const DATABASE_FILE = "lobby.sqlite";
export const LOG_FILE = "log.jsonl";
export const FETCHER_PIDFILE = "fetcher.pid";
export const FETCHER_STATUS_FILE = "fetcher.json";
export const BELLS_DIRECTORY = "bells";
export const LISTENERS_DIRECTORY = "listeners";
const LOG_LINE_MAX = 4096;
/** Every doorbell state file is small; anything larger is refused unread. */
export const STATE_FILE_MAX = 64 * 1024;

/** A one-T spelling is refused, never silently ignored (#491's S1 lesson). */
export function refuseMisspeltEnvironment(env: Environment): void {
  for (const name of Object.keys(env)) {
    if (/^AGENTOOL_LOBBY/.test(name) && env[name] !== undefined) {
      throw new UsageError(`${name} is misspelt; the variables are spelt AGENTTOOL_ (two Ts)`);
    }
  }
}

function stateBase(env: Environment, home: string): string {
  // XDG: an empty or relative value is invalid and ignored, as in the lobby.
  const stateHome = env.XDG_STATE_HOME;
  return stateHome && isAbsolute(stateHome) ? stateHome : join(home, ".local", "state");
}

/** AGENTTOOL_LOBBY_HOME (absolute) wins; else ${XDG_STATE_HOME:-~/.local/state}/agenttool/lobby. */
export function resolveLobbyHome(env: Environment, home: string = homedir()): string {
  const explicit = env[LOBBY_HOME_ENV];
  if (explicit !== undefined && explicit !== "") {
    if (!isAbsolute(explicit)) throw new DoorbellError("lobby_home_not_absolute", `${LOBBY_HOME_ENV} must be an absolute path`);
    return explicit;
  }
  return join(stateBase(env, home), "agenttool", "lobby");
}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

/** `--home` or AGENTTOOL_LOBBY_DOORBELL_HOME (tests), else a sibling of the lobby home. */
export function resolveDoorbellHome(env: Environment, lobbyHome: string | null, flag?: string, home: string = homedir()): string {
  const explicit = flag ?? (env[DOORBELL_HOME_ENV] === "" ? undefined : env[DOORBELL_HOME_ENV]);
  const resolved = explicit ?? join(stateBase(env, home), "agenttool", "lobby-doorbell");
  if (!isAbsolute(resolved)) throw new UsageError("the doorbell home must be an absolute path");
  if (lobbyHome !== null && (inside(lobbyHome, resolved) || inside(resolved, lobbyHome))) {
    throw new UsageError("the doorbell home must not be inside the lobby home, nor contain it");
  }
  return resolved;
}

export function stopPath(lobbyHome: string): string {
  return join(lobbyHome, STOP_FILE);
}

function currentUid(): number | undefined {
  return typeof process.getuid === "function" ? process.getuid() : undefined;
}

function owned(stat: Stats): boolean {
  const uid = currentUid();
  return uid === undefined || stat.uid === uid;
}

export type DirectoryState = "absent" | "ok" | "unsafe";

/** A real, owner-only (0700) directory owned by this user; never repaired. */
export function inspectPrivateDirectory(path: string): DirectoryState {
  let stat: Stats;
  try {
    stat = lstatSync(path);
  } catch {
    return "absent";
  }
  if (stat.isSymbolicLink() || !stat.isDirectory() || !owned(stat) || (stat.mode & 0o077) !== 0) return "unsafe";
  return "ok";
}

/** lstat only: present means any entry at all, whatever its content. */
export function stopPresent(lobbyHome: string): boolean {
  try {
    lstatSync(stopPath(lobbyHome));
    return true;
  } catch {
    return false;
  }
}

/** Whether the lobby home holds desk state, by lstat of two names only.
 *
 * `present` means the database file exists as a regular file, so a lobby
 * command opens it instead of creating it. `empty` means it does not, whatever
 * else the home holds (STOP, `.DS_Store`, a directory): any lobby command would
 * then create the database, so netcheck starts none. */
export function lobbyHomeState(lobbyHome: string): "absent" | "empty" | "present" | "unsafe" {
  let stat: Stats;
  try {
    stat = lstatSync(lobbyHome);
  } catch {
    return "absent";
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) return "unsafe";
  let database: Stats;
  try {
    database = lstatSync(join(lobbyHome, DATABASE_FILE));
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "empty" : "unsafe";
  }
  return database.isFile() ? "present" : "unsafe";
}

/** Append one line to <dbhome>/log.jsonl, only when the doorbell home already exists and is private. */
export function appendLogLine(doorbellHome: string, record: Record<string, unknown>): boolean {
  if (inspectPrivateDirectory(doorbellHome) !== "ok") return false;
  const line = `${JSON.stringify(record)}\n`;
  if (Buffer.byteLength(line) > LOG_LINE_MAX) return false;
  let fd: number;
  try {
    fd = openSync(join(doorbellHome, LOG_FILE), constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  } catch {
    return false;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || !owned(stat) || (stat.mode & 0o077) !== 0) return false;
    writeSync(fd, line);
    return true;
  } finally {
    closeSync(fd);
  }
}

// ── state files (doorbell home), and the brake (lobby home) ────────────

/** A path under the doorbell home: one of its fixed files, or a room's file in bells/ or listeners/. */
export function doorbellPath(doorbellHome: string, ...parts: string[]): string {
  return join(doorbellHome, ...parts);
}

/** Create the directory (and missing parents) owner-only; refuse an existing one that is not private. */
export function ensurePrivateDirectory(path: string): void {
  if (inspectPrivateDirectory(path) === "absent") mkdirSync(path, { recursive: true, mode: 0o700 });
  if (inspectPrivateDirectory(path) !== "ok") {
    throw new DoorbellError("state_dir_unsafe", "a doorbell state directory is a link, not owner-only (0700), or owned by someone else");
  }
}

function checkPrivateFile(fd: number): void {
  const stat = fstatSync(fd);
  if (!stat.isFile() || !owned(stat) || (stat.mode & 0o077) !== 0) {
    throw new DoorbellError("state_file_unsafe", "a doorbell state file is not a regular owner-only (0600) file");
  }
}

/** The text of a small owner-only regular file, or null when it does not exist. Links are refused. */
export function readPrivateFile(path: string): string | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw new DoorbellError("state_file_unsafe", code === "ELOOP" ? "a doorbell state file is a link" : "a doorbell state file cannot be opened");
  }
  try {
    checkPrivateFile(fd);
    if (fstatSync(fd).size > STATE_FILE_MAX) throw new DoorbellError("state_file_unsafe", "a doorbell state file is too large");
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}

/** Parsed JSON of a private state file; null when absent, `undefined` when unreadable or not JSON. */
export function readPrivateJson(path: string): unknown {
  let text: string | null;
  try {
    text = readPrivateFile(path);
  } catch {
    return undefined;
  }
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function writeAll(fd: number, text: string): void {
  const bytes = Buffer.from(text, "utf8");
  let offset = 0;
  while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
}

/** Replace a state file atomically: a fresh 0600 temporary file beside it, then a rename. */
export function writePrivateJson(path: string, value: unknown): void {
  const text = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(text) > STATE_FILE_MAX) throw new DoorbellError("state_file_unsafe", "a doorbell state file would be too large");
  const temporary = `${path}.${process.pid}.tmp`;
  const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    writeAll(fd, text);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
}

/** Create a state file only if no entry has that name (O_EXCL): the one-holder lock for pidfiles and listeners. */
export function createPrivateJson(path: string, value: unknown): boolean {
  let fd: number;
  try {
    fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try {
    writeAll(fd, `${JSON.stringify(value)}\n`);
  } finally {
    closeSync(fd);
  }
  return true;
}

/** Remove a state file if it is there; a missing file is not an error. */
export function removePrivateFile(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** The brake: `<lobby home>/STOP`, first line `stopped <iso> by <who>`. Written before any signal is sent. */
export function writeStop(lobbyHome: string, line: string): void {
  if (inspectPrivateDirectory(lobbyHome) === "absent") mkdirSync(lobbyHome, { recursive: true, mode: 0o700 });
  if (inspectPrivateDirectory(lobbyHome) !== "ok") throw new DoorbellError("lobby_home_unsafe", "the lobby home is a link, not owner-only (0700), or owned by someone else");
  if (stopPresent(lobbyHome)) return;
  const fd = openSync(stopPath(lobbyHome), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    writeAll(fd, `${line}\n`);
  } finally {
    closeSync(fd);
  }
}

/** Lift the brake. Only `resume` calls this, after a person typed `resume` at /dev/tty. */
export function removeStop(lobbyHome: string): void {
  removePrivateFile(stopPath(lobbyHome));
}
