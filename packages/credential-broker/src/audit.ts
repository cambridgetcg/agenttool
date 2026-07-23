import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, type FileHandle } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { AgentCredError } from "./errors.js";
import type { AuditEvent, AuditSink } from "./types.js";

export class NullAuditSink implements AuditSink {
  record(): void {
    // Deliberate no-op. Production hosts should provide an owner-only sink.
  }
}

export function newAuditId(): string {
  return randomUUID();
}

export function hashAuditPath(pathname: string): string {
  return createHash("sha256").update(pathname).digest("hex");
}

export class CallbackAuditSink implements AuditSink {
  readonly #callback: (event: Readonly<AuditEvent>) => Promise<void> | void;

  constructor(callback: (event: Readonly<AuditEvent>) => Promise<void> | void) {
    this.#callback = callback;
  }

  record(event: Readonly<AuditEvent>): Promise<void> | void {
    return this.#callback(event);
  }
}

/** Owner-only metadata log. It is append-only by convention, not tamper-proof. */
export class JsonlAuditSink implements AuditSink {
  readonly #path: string;
  readonly #maxBytes: number;
  #handle: FileHandle | undefined;
  #opening: Promise<void> | undefined;
  #bytes = 0;
  #tail: Promise<void> = Promise.resolve();

  constructor(path: string, options: { maxBytes?: number } = {}) {
    this.#path = resolve(path);
    this.#maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
    if (!Number.isSafeInteger(this.#maxBytes) || this.#maxBytes < 1024) {
      throw new AgentCredError("invalid_request", "Audit maxBytes is invalid.");
    }
  }

  async open(): Promise<void> {
    if (this.#handle) return;
    if (this.#opening) return this.#opening;
    this.#opening = this.#openOnce();
    try {
      await this.#opening;
    } finally {
      this.#opening = undefined;
    }
  }

  async #openOnce(): Promise<void> {
    const directory = dirname(this.#path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const directoryStat = await lstat(directory);
    if (
      !directoryStat.isDirectory() ||
      directoryStat.isSymbolicLink() ||
      (typeof process.getuid === "function" && directoryStat.uid !== process.getuid()) ||
      (directoryStat.mode & 0o077) !== 0
    ) {
      throw new AgentCredError("network_denied", "Audit directory must be owner-only.");
    }
    try {
      const stat = await lstat(this.#path);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new AgentCredError("network_denied", "Audit path is not a regular file.");
      }
      if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
        throw new AgentCredError("network_denied", "Audit log has the wrong owner.");
      }
      if ((stat.mode & 0o077) !== 0) {
        throw new AgentCredError("network_denied", "Audit log must not be group/world accessible.");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const handle = await open(
      this.#path,
      constants.O_APPEND |
        constants.O_CREAT |
        constants.O_WRONLY |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      // Re-check the object actually opened, not only the path inspected
      // above. This closes the lstat/open race and keeps chmod on the same fd.
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        (typeof process.getuid === "function" && stat.uid !== process.getuid()) ||
        (stat.mode & 0o077) !== 0
      ) {
        throw new AgentCredError("network_denied", "Audit log is not an owner-only regular file.");
      }
      await handle.chmod(0o600);
      this.#handle = handle;
      this.#bytes = stat.size;
    } catch (error) {
      await handle.close();
      throw error;
    }
  }

  record(event: Readonly<AuditEvent>): Promise<void> {
    const line = `${JSON.stringify(event)}\n`;
    const write = async (): Promise<void> => {
      if (!this.#handle) await this.open();
      const bytes = Buffer.byteLength(line);
      if (this.#bytes + bytes > this.#maxBytes) {
        throw new AgentCredError("response_too_large", "Audit log reached its configured size limit.");
      }
      await this.#handle!.appendFile(line, "utf8");
      this.#bytes += bytes;
    };
    const pending = this.#tail.then(write, write);
    this.#tail = pending.catch(() => {});
    return pending;
  }

  async close(): Promise<void> {
    await this.#tail;
    const handle = this.#handle;
    this.#handle = undefined;
    await handle?.close();
  }
}
