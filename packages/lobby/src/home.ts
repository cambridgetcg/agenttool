/** Desk state directory: resolution and owner-only permission checks.
 *
 * AGENTTOOL_LOBBY_HOME (absolute) wins; otherwise
 * ${XDG_STATE_HOME:-~/.local/state}/agenttool/lobby. The directory must be
 * 0700 and every desk file 0600. Wider modes are refused, never repaired
 * silently: a widened mode means something other than this desk touched it.
 */
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  type Stats,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { LobbyError } from "./errors.js";

type Environment = Record<string, string | undefined>;

export const LOBBY_HOME_ENV = "AGENTTOOL_LOBBY_HOME";
export const DATABASE_FILE = "lobby.sqlite";
const SQLITE_SIDECARS = ["-journal", "-wal", "-shm"] as const;

export function resolveLobbyHome(env: Environment = process.env): string {
  const explicit = env[LOBBY_HOME_ENV];
  if (explicit !== undefined && explicit !== "") {
    if (!isAbsolute(explicit)) {
      throw new LobbyError("lobby_home_not_absolute", `${LOBBY_HOME_ENV} must be an absolute path`);
    }
    return explicit;
  }
  // XDG: an empty or relative value is invalid and ignored.
  const stateHome = env.XDG_STATE_HOME;
  const base = stateHome && isAbsolute(stateHome) ? stateHome : join(homedir(), ".local", "state");
  return join(base, "agenttool", "lobby");
}

function currentUid(): number | undefined {
  return typeof process.getuid === "function" ? process.getuid() : undefined;
}

function assertOwned(stat: Stats, what: string): void {
  const uid = currentUid();
  if (uid !== undefined && stat.uid !== uid) {
    throw new LobbyError("state_not_owned", `${what} is not owned by the current user`);
  }
}

/** Refuse a directory that is a symlink, foreign-owned or wider than 0700. */
export function assertPrivateDirectory(path: string): void {
  let stat: Stats;
  try {
    stat = lstatSync(path);
  } catch {
    throw new LobbyError("state_dir_missing", "the lobby state directory does not exist");
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new LobbyError("state_dir_unsafe", "the lobby state path must be a real directory, not a link");
  }
  assertOwned(stat, "the lobby state directory");
  if ((stat.mode & 0o077) !== 0) {
    throw new LobbyError(
      "state_dir_not_private",
      `the lobby state directory has mode ${(stat.mode & 0o777).toString(8)}; it must be 700`,
    );
  }
}

/** Refuse a file that is a symlink, foreign-owned or wider than 0600. */
export function assertPrivateFile(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new LobbyError("state_file_unsafe", "lobby state files must be regular files, not links");
  }
  assertOwned(stat, "a lobby state file");
  if ((stat.mode & 0o077) !== 0) {
    throw new LobbyError(
      "state_file_not_private",
      `a lobby state file has mode ${(stat.mode & 0o777).toString(8)}; it must be 600`,
    );
  }
}

/** Check the database file and any SQLite sidecar that currently exists. */
export function assertPrivateStateFiles(home: string): void {
  const database = join(home, DATABASE_FILE);
  assertPrivateFile(database);
  for (const suffix of SQLITE_SIDECARS) {
    const sidecar = `${database}${suffix}`;
    if (existsSync(sidecar)) assertPrivateFile(sidecar);
  }
}

/** Create (0700) or verify the state directory; returns the database path. */
export function preparePrivateHome(home: string): string {
  if (!existsSync(home)) {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    chmodSync(home, 0o700);
  }
  assertPrivateDirectory(home);
  const database = join(home, DATABASE_FILE);
  if (!existsSync(database)) {
    try {
      const fd = openSync(database, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      closeSync(fd);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  assertPrivateStateFiles(home);
  return database;
}

/** Read-only lookup: never creates anything. Null when no desk state exists. */
export function existingPrivateDatabase(home: string): string | null {
  if (!existsSync(home)) return null;
  assertPrivateDirectory(home);
  const database = join(home, DATABASE_FILE);
  if (!existsSync(database)) return null;
  assertPrivateStateFiles(home);
  return database;
}
