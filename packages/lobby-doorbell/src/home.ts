/** The two homes netcheck looks at, and its only write (one log line).
 *
 * The lobby home is resolved exactly as packages/lobby/src/home.ts does
 * (contract/lobby-contract.ts pins those rules) and is handed to every child
 * CLI as AGENTTOOL_LOBBY_HOME, so the child never re-resolves it from an
 * environment it does not see. Inside the lobby home the doorbell touches one
 * name, STOP, and only with lstat. The doorbell home holds no secrets and no
 * text; netcheck never creates it.
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, writeSync, type Stats } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { DoorbellError, UsageError } from "./errors.js";

export type Environment = Record<string, string | undefined>;

export const LOBBY_HOME_ENV = "AGENTTOOL_LOBBY_HOME";
/** Tests only: overrides the doorbell home, like the `--home` flag. */
export const DOORBELL_HOME_ENV = "AGENTTOOL_LOBBY_DOORBELL_HOME";
export const STOP_FILE = "STOP";
export const LOG_FILE = "log.jsonl";
const LOG_LINE_MAX = 4096;

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

/** What the lobby home holds, by name only. `empty` also covers a home that holds only STOP. */
export function lobbyHomeState(lobbyHome: string): "absent" | "empty" | "present" | "unsafe" {
  let stat: Stats;
  try {
    stat = lstatSync(lobbyHome);
  } catch {
    return "absent";
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) return "unsafe";
  try {
    return readdirSync(lobbyHome).some((name) => name !== STOP_FILE) ? "present" : "empty";
  } catch {
    return "unsafe";
  }
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
