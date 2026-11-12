/**
 * Seal files for the sealed approval ballot (Collab Notes spec 7, "Sealing").
 *
 * A cast's vote and salt live in one file beside the journal's real path,
 * `<dir>/collab-ballots/<ballot_id>/<cast_id>.json`, never in the journal:
 * the journal holds only the commitment until the reveal. The directories are
 * 0700 and the files 0600, written to a temporary name, fsynced and renamed,
 * so a reader sees a whole seal or none. This hides a vote from collab's
 * tools and events only; any process running as the same user can read it,
 * as the sealing sentence says.
 */
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
  rmdirSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { CollabError } from "./errors.js";
import type { SealFile } from "./ballot.js";

export const SEAL_DIRECTORY = "collab-ballots";

const BALLOT_ID = /^report_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CAST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `<dir of the journal's real path>/collab-ballots`. */
export function sealRoot(journalRealpath: string): string {
  return join(dirname(journalRealpath), SEAL_DIRECTORY);
}

/** One ballot's seal directory. Ids are checked, so no input can name a path outside it. */
export function sealDirectory(journalRealpath: string, ballotId: string): string {
  if (!BALLOT_ID.test(ballotId)) throw new CollabError("invalid_ballot_id", "A ballot id is the poll report's id");
  return join(sealRoot(journalRealpath), ballotId);
}

export function sealPath(journalRealpath: string, ballotId: string, castId: string): string {
  if (!CAST_ID.test(castId)) throw new CollabError("invalid_cast_id", "A cast id is a random uuid");
  return join(sealDirectory(journalRealpath, ballotId), `${castId}.json`);
}

function currentUser(): number | null {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

/** A directory this user owns, made at 0700 when missing; a link or a shared directory is refused. */
function privateDirectory(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { mode: 0o700 });
    chmodSync(path, 0o700);
  }
  const stat = lstatSync(path);
  const uid = currentUser();
  if (!stat.isDirectory() || stat.isSymbolicLink() || (uid !== null && stat.uid !== uid)) {
    throw new CollabError("seal_directory_unsafe", "The ballot seal directory must be a real directory owned by this user", {
      operation: "write_seal_file",
    });
  }
  if ((stat.mode & 0o077) !== 0) chmodSync(path, 0o700);
}

/**
 * Write a seal: temp name (O_EXCL, 0600), fsync, rename into place, then
 * fsync the directory, so a crash leaves either the whole seal or nothing
 * under its final name.
 */
export function writeSealFile(path: string, seal: SealFile): void {
  const directory = dirname(path);
  privateDirectory(dirname(directory));
  privateDirectory(directory);
  if (existsSync(path)) {
    throw new CollabError("seal_file_exists", "A seal file with this cast id already exists", { operation: "write_seal_file" });
  }
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  const descriptor = openSync(temporary, "wx", 0o600);
  try {
    writeSync(descriptor, JSON.stringify(seal));
    fsyncSync(descriptor);
  } catch (error) {
    closeSync(descriptor);
    removeQuietly(temporary);
    throw error;
  }
  closeSync(descriptor);
  try {
    renameSync(temporary, path);
  } catch (error) {
    removeQuietly(temporary);
    throw error;
  }
  try {
    const handle = openSync(directory, "r");
    try {
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
  } catch {
    // Some filesystems cannot fsync a directory; the file itself is synced.
  }
}

export type SealRead =
  | { state: "missing" }
  | { state: "unreadable" }
  | { state: "read"; value: unknown };

/** A seal as found on disk. Anything but a regular file holding JSON is unreadable; nothing here throws. */
export function readSealFile(path: string): SealRead {
  try {
    if (!existsSync(path)) return { state: "missing" };
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return { state: "unreadable" };
    return { state: "read", value: JSON.parse(readFileSync(path, "utf8")) as unknown };
  } catch {
    return { state: "unreadable" };
  }
}

/** Remove a seal file if it is there. Never throws: a seal left behind is visible on disk, not in collab. */
export function removeSealFile(path: string): void {
  removeQuietly(path);
}

/** The seal files in one ballot's directory, by cast id. */
export function listSealFiles(journalRealpath: string, ballotId: string): string[] {
  try {
    const directory = sealDirectory(journalRealpath, ballotId);
    if (!existsSync(directory)) return [];
    return readdirSync(directory)
      .filter((name) => name.endsWith(".json") && CAST_ID.test(name.slice(0, -".json".length)))
      .map((name) => name.slice(0, -".json".length));
  } catch {
    return [];
  }
}

/** Remove a ballot's seal directory once it is empty. */
export function removeEmptySealDirectory(journalRealpath: string, ballotId: string): void {
  try {
    const directory = sealDirectory(journalRealpath, ballotId);
    if (existsSync(directory) && readdirSync(directory).length === 0) rmdirSync(directory);
  } catch {
    // Left in place; it holds nothing a reader needs.
  }
}

function removeQuietly(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Already gone, or not ours to remove.
  }
}
