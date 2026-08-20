import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
} from "node:fs";
import type { Stats } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { fail } from "./errors.js";

function lstatIfPresent(path: string): Stats | null {
  try {
    return lstatSync(path) as Stats;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    fail("file_error", `Cannot inspect host ledger path: ${path}`);
  }
}

function assertTrustedParent(path: string): void {
  const parent = dirname(path);
  const status = lstatIfPresent(parent);
  const currentUid = typeof process.getuid === "function" ? process.getuid() : null;
  if (
    status === null
    || !status.isDirectory()
    || status.isSymbolicLink()
    || (currentUid !== null && status.uid !== currentUid)
    || (status.mode & 0o022) !== 0
  ) {
    fail(
      "file_error",
      "Database parent must be an owned, non-symlink directory with no group/other write bits",
    );
  }
}

function secureRegularFile(path: string, create: boolean): void {
  const flags = constants.O_RDWR
    | constants.O_NOFOLLOW
    | (create ? constants.O_CREAT : 0);
  let descriptor: number;
  try {
    descriptor = openSync(path, flags, 0o600);
  } catch {
    fail("file_error", `Cannot securely open regular host ledger file: ${path}`);
  }
  try {
    const opened = fstatSync(descriptor);
    const named = lstatIfPresent(path);
    if (
      named === null
      || !opened.isFile()
      || !named.isFile()
      || named.isSymbolicLink()
      || opened.dev !== named.dev
      || opened.ino !== named.ino
      || opened.nlink !== 1
      || named.nlink !== 1
    ) {
      fail(
        "file_error",
        `Host ledger path is not one stable, singly linked regular file: ${path}`,
      );
    }
    fchmodSync(descriptor, 0o600);
  } finally {
    closeSync(descriptor);
  }
}

export class SecureSqliteFiles {
  readonly path?: string;

  constructor(requested: string, create: boolean) {
    if (requested === ":memory:") return;
    let requestedPath: string;
    try {
      requestedPath = resolve(requested);
    } catch {
      fail("file_error", "Database path cannot be resolved");
    }
    const requestedParent = dirname(requestedPath);
    if (create) mkdirSync(requestedParent, { recursive: true, mode: 0o700 });
    const requestedParentStatus = lstatIfPresent(requestedParent);
    if (requestedParentStatus?.isSymbolicLink() === true) {
      fail("file_error", "Database parent must not be a symlink");
    }
    let parent: string;
    try {
      parent = realpathSync(requestedParent);
    } catch {
      fail("file_error", "Database parent directory does not exist");
    }
    this.path = join(parent, basename(requestedPath));
    assertTrustedParent(this.path);
    secureRegularFile(this.path, create);
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      if (lstatIfPresent(`${this.path}${suffix}`) !== null) {
        secureRegularFile(`${this.path}${suffix}`, false);
      }
    }
  }

  tighten(): void {
    if (this.path === undefined) return;
    assertTrustedParent(this.path);
    for (const path of this.paths()) {
      if (lstatIfPresent(path) !== null) secureRegularFile(path, false);
    }
  }

  modesArePrivate(): boolean {
    if (this.path === undefined) return true;
    assertTrustedParent(this.path);
    return this.paths()
      .map(lstatIfPresent)
      .filter((status) => status !== null)
      .every((status) =>
        status.isFile()
        && !status.isSymbolicLink()
        && status.nlink === 1
        && (status.mode & 0o777) === 0o600);
  }

  private paths(): string[] {
    const path = this.path;
    if (path === undefined) return [];
    return [path, `${path}-wal`, `${path}-shm`, `${path}-journal`];
  }
}
