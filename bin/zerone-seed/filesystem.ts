import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
} from "node:fs";
import type { Stats } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { fail } from "./errors.js";

// Same single-link/open-identity boundary as the private Zerone Agent Host.
// Unlike that host's initializer, inspection never creates parents or repairs modes.
function status(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    fail("file_error", "Cannot inspect seed journal path");
  }
}

function assertParent(path: string): void {
  const parent = dirname(path);
  const info = status(parent);
  if (typeof process.getuid !== "function") {
    fail("file_error", "Seed journal requires POSIX ownership checks");
  }
  if (
    info === null || !info.isDirectory() || info.isSymbolicLink()
    || info.uid !== process.getuid() || (info.mode & 0o022) !== 0
  ) {
    fail("file_error", "Seed journal parent must be an owned non-writable-by-others directory");
  }
  try {
    if (realpathSync(parent) !== parent) {
      fail("file_error", "Seed journal path must not contain symlinked ancestors");
    }
  } catch (error) {
    if (error instanceof Error && error.name === "SeedRuntimeError") throw error;
    fail("file_error", "Cannot resolve seed journal parent");
  }
}

function assertPrivateRegular(info: Stats): void {
  if (
    !info.isFile() || info.isSymbolicLink() || info.nlink !== 1
    || info.uid !== process.getuid!() || (info.mode & 0o777) !== 0o600
  ) {
    fail("file_error", "Seed journal must be an owned, singly linked 0600 regular file");
  }
}

function inspectFile(path: string, required: boolean): void {
  const named = status(path);
  if (named === null) {
    if (required) fail("file_error", "Seed journal does not exist");
    return;
  }
  assertPrivateRegular(named);
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    fail("file_error", "Cannot securely inspect seed journal file");
  }
  try {
    const opened = fstatSync(fd);
    assertPrivateRegular(opened);
    const current = status(path);
    if (
      current === null || current.dev !== opened.dev || current.ino !== opened.ino
      || named.dev !== opened.dev || named.ino !== opened.ino
    ) {
      fail("file_error", "Seed journal file changed during inspection");
    }
    assertPrivateRegular(current);
  } finally {
    closeSync(fd);
  }
}

export class SeedJournalFiles {
  readonly path: string;

  constructor(path: string, options: { create: boolean }) {
    if (!isAbsolute(path) || resolve(path) !== path || path.includes("\0")) {
      fail("file_error", "Seed journal requires an explicit canonical absolute path");
    }
    this.path = path;
    assertParent(path);
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      inspectFile(`${path}${suffix}`, false);
    }
    if (status(path) === null && options.create) {
      let fd: number;
      try {
        fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      } catch {
        fail("file_error", "Cannot exclusively create seed journal file");
      }
      closeSync(fd);
    }
    this.verify();
  }

  verify(): void {
    assertParent(this.path);
    inspectFile(this.path, true);
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      inspectFile(`${this.path}${suffix}`, false);
    }
  }
}
