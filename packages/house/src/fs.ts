/** The package's only file-system module, and it only reads.
 *
 * Four operations: lstat, readlink, a listing of names, and a bounded read of
 * a regular file opened read-only without following a link. Nothing here can
 * create, change or remove a file; tests/boundary.test.ts holds that. The
 * survey runs against the `HouseFs` interface, so tests hand it an in-memory
 * tree and never look at the machine they run on.
 */
import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readlinkSync, readSync, type Stats } from "node:fs";

export type EntryKind = "file" | "directory" | "link" | "other";

export interface EntryStat {
  kind: EntryKind;
  mtimeMs: number;
  size: number;
  uid: number;
  mode: number;
}

/** Why something could not be looked at. Never carries the error's own text. */
export interface Fail {
  fail: "absent" | "denied" | "failed";
}

export interface HeadRead {
  text: string;
  /** The file held more than the bytes read. */
  truncated: boolean;
}

export interface HouseFs {
  lstat(path: string): EntryStat | Fail;
  readlink(path: string): string | Fail;
  /** Names in one directory; never recursive. */
  list(path: string): string[] | Fail;
  /** At most `maxBytes` of a regular file, never through a link. */
  readHead(path: string, maxBytes: number): HeadRead | Fail;
  /** A file the person named on the command line (a blueprint); like readHead, never through a final link. */
  readChosen(path: string, maxBytes: number): HeadRead | Fail;
}

export function isFail(value: unknown): value is Fail {
  return typeof value === "object" && value !== null && "fail" in value;
}

function failOf(error: unknown): Fail {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT" || code === "ENOTDIR") return { fail: "absent" };
  if (code === "EACCES" || code === "EPERM") return { fail: "denied" };
  return { fail: "failed" };
}

function kindOf(stat: Stats): EntryKind {
  if (stat.isSymbolicLink()) return "link";
  if (stat.isFile()) return "file";
  if (stat.isDirectory()) return "directory";
  return "other";
}

function statOf(stat: Stats): EntryStat {
  return { kind: kindOf(stat), mtimeMs: stat.mtimeMs, size: stat.size, uid: stat.uid, mode: stat.mode };
}

/** Read-only, never through a final link, and never blocking on a pipe someone left in place of a file. The person's own blueprint file is opened the same way. */
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;

function readBounded(path: string, maxBytes: number, flags: number): HeadRead | Fail {
  let fd: number;
  try {
    fd = openSync(path, flags);
  } catch (error) {
    return failOf(error);
  }
  try {
    if (!fstatSync(fd).isFile()) return { fail: "failed" };
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = readSync(fd, buffer, length, buffer.length - length, null);
      if (read === 0) break;
      length += read;
    }
    const truncated = length > maxBytes;
    return { text: buffer.subarray(0, Math.min(length, maxBytes)).toString("utf8"), truncated };
  } catch (error) {
    return failOf(error);
  } finally {
    closeSync(fd);
  }
}

export const realFs: HouseFs = {
  lstat(path) {
    try {
      return statOf(lstatSync(path));
    } catch (error) {
      return failOf(error);
    }
  },
  readlink(path) {
    try {
      return readlinkSync(path, "utf8");
    } catch (error) {
      return failOf(error);
    }
  },
  list(path) {
    try {
      return readdirSync(path, "utf8");
    } catch (error) {
      return failOf(error);
    }
  },
  readHead(path, maxBytes) {
    return readBounded(path, maxBytes, READ_FLAGS);
  },
  readChosen(path, maxBytes) {
    return readBounded(path, maxBytes, READ_FLAGS);
  },
};
