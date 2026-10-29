/**
 * Ledger state directory. AGENTTOOL_EXECUTION_SEAT_HOME (absolute) wins;
 * otherwise ${XDG_STATE_HOME:-~/.local/state}/agenttool/execution-seat.
 * The directory must be 0700 and the database and its sidecars 0600.
 * Wider modes are refused, never repaired.
 */
import { chmodSync, closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, type Stats } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { SeatError } from "./errors.js";

type Environment = Record<string, string | undefined>;

export const SEAT_HOME_ENV = "AGENTTOOL_EXECUTION_SEAT_HOME";
/** Collab spells its prefix `AGENTOOL_`. That spelling here would silently fall back to the real home, so it is refused. */
const MISSPELLED_HOME_ENV = "AGENTOOL_EXECUTION_SEAT_HOME";
export const DATABASE_FILE = "seats.sqlite";
const SQLITE_SIDECARS = ["-journal", "-wal", "-shm"] as const;

export function resolveSeatHome(env: Environment = process.env): string {
  const explicit = env[SEAT_HOME_ENV];
  if ((explicit === undefined || explicit === "") && env[MISSPELLED_HOME_ENV]) {
    throw new SeatError("home_env_misspelled", `${MISSPELLED_HOME_ENV} is set, but the variable is ${SEAT_HOME_ENV}`);
  }
  if (explicit !== undefined && explicit !== "") {
    if (!isAbsolute(explicit)) throw new SeatError("home_not_absolute", `${SEAT_HOME_ENV} must be an absolute path`);
    return explicit;
  }
  const stateHome = env.XDG_STATE_HOME;
  const base = stateHome && isAbsolute(stateHome) ? stateHome : join(homedir(), ".local", "state");
  return join(base, "agenttool", "execution-seat");
}

function assertOwned(stat: Stats, what: string): void {
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (uid !== undefined && stat.uid !== uid) throw new SeatError("state_not_owned", `${what} is not owned by the current user`);
}

export function assertPrivateDirectory(path: string): void {
  let stat: Stats;
  try {
    stat = lstatSync(path);
  } catch {
    throw new SeatError("state_dir_missing", "the seat ledger directory does not exist");
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new SeatError("state_dir_unsafe", "the seat ledger path must be a real directory, not a link");
  }
  assertOwned(stat, "the seat ledger directory");
  if ((stat.mode & 0o077) !== 0) {
    throw new SeatError("state_dir_not_private", `the seat ledger directory has mode ${(stat.mode & 0o777).toString(8)}; it must be 700`);
  }
}

export function assertPrivateFile(path: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new SeatError("state_file_unsafe", "seat ledger files must be regular files");
  assertOwned(stat, "a seat ledger file");
  if ((stat.mode & 0o077) !== 0) {
    throw new SeatError("state_file_not_private", `a seat ledger file has mode ${(stat.mode & 0o777).toString(8)}; it must be 600`);
  }
}

export function assertPrivateStateFiles(home: string): void {
  const database = join(home, DATABASE_FILE);
  assertPrivateFile(database);
  for (const suffix of SQLITE_SIDECARS) {
    if (existsSync(`${database}${suffix}`)) assertPrivateFile(`${database}${suffix}`);
  }
}

/** Create (0700/0600) or verify the ledger home; returns the database path. */
export function preparePrivateHome(home: string): string {
  if (!existsSync(home)) {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    chmodSync(home, 0o700);
  }
  assertPrivateDirectory(home);
  const database = join(home, DATABASE_FILE);
  if (!existsSync(database)) {
    try {
      closeSync(openSync(database, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  assertPrivateStateFiles(home);
  return database;
}
