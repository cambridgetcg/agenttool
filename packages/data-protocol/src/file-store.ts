import { mkdir, open, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { copyBytes } from "./bytes.js";
import { assertCidMatches, digestFromCid, type Cid } from "./cid.js";
import { IntegrityError, InvalidInputError, LimitExceededError } from "./errors.js";
import {
  DEFAULT_STORE_READ_LIMIT,
  type BlockStore,
  type BlockWriteResult,
  type StoreOperationOptions,
} from "./stores.js";

function validateLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new InvalidInputError("maxBytes must be a non-negative safe integer.");
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error("Block-store operation aborted.");
}

function isNodeError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function boundedFileRead(path: string, maxBytes: number, signal?: AbortSignal): Promise<Uint8Array> {
  validateLimit(maxBytes);
  throwIfAborted(signal);
  const handle = await open(path, "r");
  try {
    const before = await handle.stat();
    if (!Number.isSafeInteger(before.size) || before.size > maxBytes) {
      throw new LimitExceededError(`Stored block is ${before.size} bytes; read limit is ${maxBytes}.`);
    }
    const output = new Uint8Array(before.size);
    let offset = 0;
    while (offset < output.byteLength) {
      throwIfAborted(signal);
      const result = await handle.read(output, offset, output.byteLength - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    const after = await handle.stat();
    if (offset !== output.byteLength || after.size !== before.size) {
      throw new IntegrityError("Stored block changed while it was being read.");
    }
    return output;
  } finally {
    await handle.close();
  }
}

/** Node/Bun filesystem blocks. This class never writes plaintext keys. */
export class FileSystemBlockStore implements BlockStore {
  readonly root: string;

  constructor(root: string) {
    if (typeof root !== "string" || root.length === 0) {
      throw new InvalidInputError("Filesystem block-store root must be a non-empty path.");
    }
    this.root = root;
  }

  #path(cid: Cid): string {
    digestFromCid(cid);
    return join(this.root, cid.slice(1, 3), cid);
  }

  async get(cid: Cid, options: StoreOperationOptions = {}): Promise<Uint8Array | null> {
    const path = this.#path(cid);
    try {
      const bytes = await boundedFileRead(path, options.maxBytes ?? DEFAULT_STORE_READ_LIMIT, options.signal);
      assertCidMatches(cid, bytes);
      return bytes;
    } catch (error) {
      if (isNodeError(error, "ENOENT")) return null;
      throw error;
    }
  }

  put(cid: Cid, bytes: Uint8Array, options: StoreOperationOptions = {}): Promise<BlockWriteResult> {
    const snapshot = copyBytes(bytes);
    assertCidMatches(cid, snapshot);
    throwIfAborted(options.signal);
    return this.#putSnapshot(cid, snapshot, options);
  }

  async #putSnapshot(cid: Cid, bytes: Uint8Array, options: StoreOperationOptions): Promise<BlockWriteResult> {
    const path = this.#path(cid);
    await mkdir(dirname(path), { recursive: true });
    throwIfAborted(options.signal);
    try {
      const existing = await boundedFileRead(path, bytes.byteLength, options.signal);
      assertCidMatches(cid, existing);
      return { attempted: 1, stored: 1, failed: 0 };
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
    }

    const temporary = `${path}.tmp-${globalThis.crypto.randomUUID()}`;
    try {
      throwIfAborted(options.signal);
      await writeFile(temporary, bytes, { flag: "wx", mode: 0o600, signal: options.signal });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
    return { attempted: 1, stored: 1, failed: 0 };
  }
}
