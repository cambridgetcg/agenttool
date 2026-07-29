import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  link,
  mkdir,
  open,
  rename,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { AgentCredError } from "./errors.js";

const DEFAULT_MAX_BYTES = 64 * 1024;

function invalid(message: string): AgentCredError {
  return new AgentCredError("invalid_request", message);
}

/**
 * A create-only destination collision is recoverable by callers that can
 * independently validate and re-sync the existing file. Other write failures
 * must never be mistaken for an idempotent retry.
 */
export class OwnerFileAlreadyExistsError extends AgentCredError {
  constructor(name: string) {
    super("invalid_request", `${name} already exists.`);
    this.name = "OwnerFileAlreadyExistsError";
  }
}

export function absoluteOwnerPath(pathInput: string, name: string): string {
  if (!isAbsolute(pathInput)) {
    throw invalid(`${name} must be absolute.`);
  }
  return resolve(pathInput);
}

export async function ensureOwnerDirectory(
  directoryInput: string,
  options: { create?: boolean; name?: string } = {},
): Promise<string> {
  const directory = resolve(directoryInput);
  if (options.create) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
  let stat;
  try {
    stat = await lstat(directory);
  } catch {
    throw invalid(`${options.name ?? "Directory"} is unavailable.`);
  }
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid()) ||
    (stat.mode & 0o077) !== 0
  ) {
    throw invalid(`${options.name ?? "Directory"} must be owner-only.`);
  }
  return directory;
}

export async function readOwnerFile(
  pathInput: string,
  options: { maxBytes?: number; name?: string } = {},
): Promise<string> {
  const name = options.name ?? "Owner file";
  const path = absoluteOwnerPath(pathInput, name);
  await ensureOwnerDirectory(dirname(path), { name: `${name} directory` });
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile()) throw invalid(`${name} must be a regular file.`);
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
      throw invalid(`${name} has the wrong owner.`);
    }
    if ((stat.mode & 0o077) !== 0) {
      throw invalid(`${name} must have mode 0600 or stricter.`);
    }
    if (stat.size > (options.maxBytes ?? DEFAULT_MAX_BYTES)) {
      throw invalid(`${name} is too large.`);
    }
    return await handle.readFile("utf8");
  } catch (error) {
    if (error instanceof AgentCredError) throw error;
    throw invalid(`${name} could not be opened safely.`);
  } finally {
    await handle?.close();
  }
}

async function syncDirectory(directory: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(directory, constants.O_RDONLY);
    await handle.sync();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!["EINVAL", "ENOTSUP", "EISDIR"].includes(code ?? "")) throw error;
  } finally {
    await handle?.close();
  }
}

export async function writeOwnerFileAtomic(
  pathInput: string,
  text: string,
  options: { createDirectory?: boolean; createOnly?: boolean; name?: string } = {},
): Promise<void> {
  const name = options.name ?? "Owner file";
  const path = absoluteOwnerPath(pathInput, name);
  const directory = await ensureOwnerDirectory(dirname(path), {
    create: options.createDirectory,
    name: `${name} directory`,
  });
  if (options.createOnly) {
    try {
      await lstat(path);
      throw new OwnerFileAlreadyExistsError(name);
    } catch (error) {
      if (error instanceof AgentCredError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw invalid(`${name} could not be inspected safely.`);
      }
    }
  } else {
    try {
      const existing = await lstat(path);
      if (
        !existing.isFile() ||
        existing.isSymbolicLink() ||
        (typeof process.getuid === "function" && existing.uid !== process.getuid()) ||
        (existing.mode & 0o077) !== 0
      ) {
        throw invalid(`${name} is not an owner-only regular file.`);
      }
    } catch (error) {
      if (error instanceof AgentCredError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw invalid(`${name} could not be inspected safely.`);
      }
    }
  }

  const temporary = `${path}.tmp-${randomUUID()}`;
  let handle: FileHandle | undefined;
  try {
    handle = await open(
      temporary,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    await handle.writeFile(text, "utf8");
    await handle.sync();
    await handle.chmod(0o600);
    await handle.close();
    handle = undefined;
    if (options.createOnly) {
      // Hard-linking a fully synced same-directory temporary file is an
      // atomic no-replace create. `rename()` would overwrite a path created
      // after the earlier existence check.
      try {
        await link(temporary, path);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new OwnerFileAlreadyExistsError(name);
        }
        throw error;
      }
      await unlink(temporary);
    } else {
      await rename(temporary, path);
    }
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close();
    await unlink(temporary).catch(() => {});
    if (error instanceof AgentCredError) throw error;
    throw invalid(`${name} could not be written atomically.`);
  }
}

/**
 * Re-establish durability for a validated existing owner file before a caller
 * relies on it as the sole write-ahead copy.
 */
export async function syncOwnerFileDurably(
  pathInput: string,
  options: { name?: string } = {},
): Promise<void> {
  const name = options.name ?? "Owner file";
  const path = absoluteOwnerPath(pathInput, name);
  const directory = await ensureOwnerDirectory(dirname(path), {
    name: `${name} directory`,
  });
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile()) throw invalid(`${name} must be a regular file.`);
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
      throw invalid(`${name} has the wrong owner.`);
    }
    if ((stat.mode & 0o077) !== 0) {
      throw invalid(`${name} must have mode 0600 or stricter.`);
    }
    await handle.sync();
    await syncDirectory(directory);
  } catch (error) {
    if (error instanceof AgentCredError) throw error;
    throw invalid(`${name} could not be synchronized safely.`);
  } finally {
    await handle?.close();
  }
}

interface LockRecord {
  pid: number;
  nonce: string;
  role: "broker" | "controller";
  at: string;
}

const LOCK_RECORD_KEYS = ["at", "nonce", "pid", "role"] as const;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function parseLock(value: unknown): LockRecord {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !== LOCK_RECORD_KEYS.join("\0") ||
    !Number.isSafeInteger((value as LockRecord).pid) ||
    (value as LockRecord).pid <= 0 ||
    typeof (value as LockRecord).nonce !== "string" ||
    !UUID.test((value as LockRecord).nonce) ||
    !["broker", "controller"].includes((value as LockRecord).role) ||
    !isCanonicalIsoTimestamp((value as LockRecord).at)
  ) {
    throw invalid("Credential lifecycle lock is invalid.");
  }
  return value as LockRecord;
}

interface LockSnapshot {
  record: LockRecord;
  dev: bigint;
  ino: bigint;
}

interface FileIdentity {
  dev: bigint;
  ino: bigint;
}

function lifecycleLockPath(ownerPathInput: string): string {
  const ownerPath = absoluteOwnerPath(ownerPathInput, "Credential manifest");
  return `${ownerPath}.lifecycle.lock`;
}

async function readLockSnapshot(path: string): Promise<LockSnapshot> {
  await ensureOwnerDirectory(dirname(path), {
    name: "Credential lifecycle lock directory",
  });
  let handle: FileHandle | undefined;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile()) {
      throw invalid("Credential lifecycle lock must be a regular file.");
    }
    if (
      typeof process.getuid === "function" &&
      stat.uid !== BigInt(process.getuid())
    ) {
      throw invalid("Credential lifecycle lock has the wrong owner.");
    }
    if ((stat.mode & 0o077n) !== 0n) {
      throw invalid("Credential lifecycle lock must have mode 0600 or stricter.");
    }
    if (stat.size > 4096n) {
      throw invalid("Credential lifecycle lock is too large.");
    }
    let value: unknown;
    try {
      value = JSON.parse(await handle.readFile("utf8")) as unknown;
    } catch {
      throw invalid("Credential lifecycle lock is invalid.");
    }
    return {
      record: parseLock(value),
      dev: stat.dev,
      ino: stat.ino,
    };
  } catch (error) {
    if (error instanceof AgentCredError) throw error;
    throw invalid("Credential lifecycle lock could not be opened safely.");
  } finally {
    await handle?.close();
  }
}

function sameLock(left: LockSnapshot, right: LockSnapshot): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.record.pid === right.record.pid &&
    left.record.nonce === right.record.nonce &&
    left.record.role === right.record.role &&
    left.record.at === right.record.at
  );
}

function sameIdentity(
  left: FileIdentity,
  right: FileIdentity,
): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function cleanupPartialLifecycleLock(
  path: string,
  identity: FileIdentity | undefined,
  expectedNonce: string,
): Promise<void> {
  if (!identity) return;

  // A complete record gives us a second ownership check. A failed write may
  // leave invalid JSON, in which case the fstat identity captured from our
  // O_EXCL-created handle is the strongest check Node exposes.
  try {
    const snapshot = await readLockSnapshot(path);
    if (
      !sameIdentity(identity, snapshot) ||
      snapshot.record.nonce !== expectedNonce
    ) {
      return;
    }
  } catch {
    // Continue only if the pathname still resolves to the exact inode created
    // by this acquisition attempt.
  }

  let current;
  try {
    current = await lstat(path, { bigint: true });
  } catch {
    return;
  }
  if (
    !current.isFile() ||
    current.isSymbolicLink() ||
    current.dev !== identity.dev ||
    current.ino !== identity.ino
  ) {
    return;
  }

  // Node has no portable conditional unlink. The final pair remains
  // cooperative against same-user replacement, just like explicit recovery.
  await unlink(path);
  await syncDirectory(dirname(path));
}

function assertRecordedProcessIsAbsent(pid: number): void {
  try {
    process.kill(pid, 0);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return;
    if (code === "EPERM") {
      throw invalid(
        `Credential lifecycle lock PID ${pid} cannot be inspected; recovery refuses because process absence was not proved.`,
      );
    }
    throw invalid(
      `Credential lifecycle lock PID ${pid} liveness could not be determined safely.`,
    );
  }
  throw invalid(
    `Credential lifecycle lock PID ${pid} is still live; stop that process before recovery.`,
  );
}

export interface OwnerLifecycleLock {
  path: string;
  release(): Promise<void>;
}

export interface OwnerLifecycleLockInspection extends LockRecord {
  path: string;
}

export interface RecoverOwnerLifecycleLockOptions {
  /**
   * Recovery is a cooperative same-user operator action, not an authentication
   * or human-presence check. Requiring the exact inspected nonce prevents an
   * accidentally stale confirmation from targeting a different lock.
   */
  confirmStaleLock: true;
  expectedNonce: string;
}

export async function inspectOwnerLifecycleLock(
  ownerPathInput: string,
): Promise<OwnerLifecycleLockInspection> {
  const path = lifecycleLockPath(ownerPathInput);
  const { record } = await readLockSnapshot(path);
  return { path, ...record };
}

export async function recoverOwnerLifecycleLock(
  ownerPathInput: string,
  options: RecoverOwnerLifecycleLockOptions,
): Promise<OwnerLifecycleLockInspection> {
  if (options?.confirmStaleLock !== true) {
    throw invalid(
      "Credential lifecycle lock recovery is a cooperative same-user action and requires explicit stale-lock confirmation.",
    );
  }
  if (
    typeof options.expectedNonce !== "string" ||
    !UUID.test(options.expectedNonce)
  ) {
    throw invalid(
      "Credential lifecycle lock recovery requires the exact inspected nonce.",
    );
  }

  const path = lifecycleLockPath(ownerPathInput);
  const initial = await readLockSnapshot(path);
  if (initial.record.nonce !== options.expectedNonce) {
    throw invalid(
      "Credential lifecycle lock changed after inspection; recovery nonce does not match.",
    );
  }
  assertRecordedProcessIsAbsent(initial.record.pid);

  // Re-open and re-parse immediately before unlink. This catches replacement,
  // mutation, and PID reuse visible through Node's filesystem/process APIs.
  // Node has no portable conditional-unlink-by-inode primitive, so a malicious
  // same-user process can still race the final lstat/unlink pair; this lock is
  // cooperative coordination, not a security boundary against that user.
  const current = await readLockSnapshot(path);
  if (!sameLock(initial, current)) {
    throw invalid(
      "Credential lifecycle lock changed during recovery; no lock was removed.",
    );
  }
  assertRecordedProcessIsAbsent(current.record.pid);
  let pathStat;
  try {
    pathStat = await lstat(path, { bigint: true });
  } catch {
    throw invalid(
      "Credential lifecycle lock changed during recovery; no lock was removed.",
    );
  }
  if (
    !pathStat.isFile() ||
    pathStat.isSymbolicLink() ||
    pathStat.dev !== current.dev ||
    pathStat.ino !== current.ino
  ) {
    throw invalid(
      "Credential lifecycle lock changed during recovery; no lock was removed.",
    );
  }
  try {
    await unlink(path);
    await syncDirectory(dirname(path));
  } catch {
    throw invalid("Credential lifecycle lock could not be removed safely.");
  }

  return { path, ...current.record };
}

export async function acquireOwnerLifecycleLock(
  ownerPathInput: string,
  role: LockRecord["role"],
): Promise<OwnerLifecycleLock> {
  const path = lifecycleLockPath(ownerPathInput);
  await ensureOwnerDirectory(dirname(path), {
    name: "Credential lifecycle lock directory",
  });
  const record: LockRecord = {
    pid: process.pid,
    nonce: randomUUID(),
    role,
    at: new Date().toISOString(),
  };
  let handle: FileHandle | undefined;
  let createdIdentity: FileIdentity | undefined;
  for (let attempt = 0; attempt < 1; attempt += 1) {
    try {
      handle = await open(
        path,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600,
      );
      const created = await handle.stat({ bigint: true });
      createdIdentity = { dev: created.dev, ino: created.ino };
      await handle.writeFile(`${JSON.stringify(record)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await syncDirectory(dirname(path));
      let released = false;
      return {
        path,
        async release() {
          if (released) return;
          released = true;
          let current: LockRecord;
          try {
            current = parseLock(
              JSON.parse(
                await readOwnerFile(path, {
                  maxBytes: 4096,
                  name: "Credential lifecycle lock",
                }),
              ) as unknown,
            );
          } catch {
            return;
          }
          if (current.nonce === record.nonce) {
            await unlink(path).catch(() => {});
          }
        },
      };
    } catch (error) {
      await handle?.close().catch(() => {});
      handle = undefined;
      await cleanupPartialLifecycleLock(
        path,
        createdIdentity,
        record.nonce,
      ).catch(() => {});
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw invalid("Credential lifecycle lock could not be acquired.");
      }
      throw invalid(
        role === "controller"
          ? "Credential lifecycle lock exists; stop the broker or recover a stale lock manually."
          : "Credential lifecycle lock exists; another process may be using the manifest.",
      );
    }
  }
  throw invalid("Credential lifecycle lock could not be acquired.");
}
