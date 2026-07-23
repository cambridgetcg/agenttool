import { assertByteLength, copyBytes } from "./bytes.js";
import { assertCidMatches, digestFromCid, type Cid } from "./cid.js";
import {
  IntegrityError,
  InvalidInputError,
  LimitExceededError,
  ReplicationError,
  StoreError,
} from "./errors.js";

export const DEFAULT_STORE_READ_LIMIT = 64 * 1024 * 1024;
export const DEFAULT_STORE_TIMEOUT_MS = 10_000;
export const MAX_COMPOSITE_STORES = 32;

export interface StoreOperationOptions {
  maxBytes?: number;
  signal?: AbortSignal;
}

export interface BlockWriteResult {
  attempted: number;
  stored: number;
  failed: number;
}

/** Minimal immutable content-addressed storage contract. Missing blocks return null. */
export interface BlockStore {
  get(cid: Cid, options?: StoreOperationOptions): Promise<Uint8Array | null>;
  put(cid: Cid, bytes: Uint8Array, options?: StoreOperationOptions): Promise<BlockWriteResult | void>;
}

export interface KeyStore {
  /** Return a caller-owned key copy; implementations must not expose mutable internal storage. */
  get(cid: Cid): Promise<Uint8Array | null>;
  /** Take custody by copying key bytes before this promise resolves. */
  set(cid: Cid, key: Uint8Array): Promise<void>;
  delete?(cid: Cid): Promise<void>;
}

function validateLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new InvalidInputError("maxBytes must be a non-negative safe integer.");
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error("Block-store operation aborted.");
}

/** Process-local key custody. Values are copied on every boundary. */
export class MemoryKeyStore implements KeyStore {
  readonly #keys = new Map<Cid, Uint8Array>();

  async get(cid: Cid): Promise<Uint8Array | null> {
    digestFromCid(cid);
    const key = this.#keys.get(cid);
    return key === undefined ? null : copyBytes(key);
  }

  async set(cid: Cid, key: Uint8Array): Promise<void> {
    digestFromCid(cid);
    assertByteLength(key, 32, "Object key");
    this.#keys.get(cid)?.fill(0);
    this.#keys.set(cid, copyBytes(key));
  }

  async delete(cid: Cid): Promise<void> {
    digestFromCid(cid);
    this.#keys.get(cid)?.fill(0);
    this.#keys.delete(cid);
  }
}

/** In-memory block store for tests, ephemeral agents, and offline sessions. */
export class MemoryBlockStore implements BlockStore {
  readonly #blocks = new Map<Cid, Uint8Array>();

  async get(cid: Cid, options: StoreOperationOptions = {}): Promise<Uint8Array | null> {
    digestFromCid(cid);
    throwIfAborted(options.signal);
    const bytes = this.#blocks.get(cid);
    if (bytes === undefined) return null;
    const maxBytes = options.maxBytes ?? DEFAULT_STORE_READ_LIMIT;
    validateLimit(maxBytes);
    if (bytes.byteLength > maxBytes) {
      throw new LimitExceededError(`Block ${cid} is ${bytes.byteLength} bytes; read limit is ${maxBytes}.`);
    }
    assertCidMatches(cid, bytes);
    return copyBytes(bytes);
  }

  put(cid: Cid, bytes: Uint8Array, options: StoreOperationOptions = {}): Promise<BlockWriteResult> {
    const snapshot = copyBytes(bytes);
    assertCidMatches(cid, snapshot);
    throwIfAborted(options.signal);
    const existing = this.#blocks.get(cid);
    if (existing !== undefined) {
      assertCidMatches(cid, existing);
    } else {
      this.#blocks.set(cid, snapshot);
    }
    return Promise.resolve({ attempted: 1, stored: 1, failed: 0 });
  }
}

export interface MultiBlockStoreOptions {
  /** Required successful physical writes. Defaults to one; all stores are still attempted. */
  minimumWrites?: number;
  /** Deadline applied independently to each provider call. */
  timeoutMs?: number;
}

function validateWriteResult(result: BlockWriteResult | void): BlockWriteResult {
  if (result === undefined) return { attempted: 1, stored: 1, failed: 0 };
  const values = [result.attempted, result.stored, result.failed];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new InvalidInputError("Block store returned invalid write counters.");
  }
  if (result.stored + result.failed > result.attempted || result.attempted < 1) {
    throw new InvalidInputError("Block store returned inconsistent write counters.");
  }
  return result;
}

async function withDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  upstream?: AbortSignal,
): Promise<T> {
  if (upstream?.aborted) throw upstream.reason ?? new Error("Block-store operation aborted.");
  const controller = new AbortController();
  const abortFromUpstream = () => controller.abort(upstream?.reason);
  upstream?.addEventListener("abort", abortFromUpstream, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error(`Block-store provider timed out after ${timeoutMs}ms.`)), timeoutMs);
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    upstream?.removeEventListener("abort", abortFromUpstream);
  }
}

/** Read fallback plus bounded parallel replication with an explicit minimum write threshold. */
export class MultiBlockStore implements BlockStore {
  readonly stores: readonly BlockStore[];
  readonly minimumWrites: number;
  readonly timeoutMs: number;

  constructor(stores: readonly BlockStore[], options: MultiBlockStoreOptions = {}) {
    if (stores.length === 0) throw new InvalidInputError("At least one block store is required.");
    if (stores.length > MAX_COMPOSITE_STORES) {
      throw new InvalidInputError(`A composite store supports at most ${MAX_COMPOSITE_STORES} providers.`);
    }
    const minimumWrites = options.minimumWrites ?? 1;
    if (!Number.isSafeInteger(minimumWrites) || minimumWrites < 1 || minimumWrites > stores.length) {
      throw new InvalidInputError("minimumWrites must be between one and the number of stores.");
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_STORE_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
      throw new InvalidInputError("timeoutMs must be an integer between 1 and 300000.");
    }
    this.stores = [...stores];
    this.minimumWrites = minimumWrites;
    this.timeoutMs = timeoutMs;
  }

  async get(cid: Cid, options: StoreOperationOptions = {}): Promise<Uint8Array | null> {
    digestFromCid(cid);
    throwIfAborted(options.signal);
    const maxBytes = options.maxBytes ?? DEFAULT_STORE_READ_LIMIT;
    validateLimit(maxBytes);
    const failures: unknown[] = [];
    for (const store of this.stores) {
      try {
        const bytes = await withDeadline(
          (signal) => store.get(cid, { ...options, signal }),
          this.timeoutMs,
          options.signal,
        );
        if (bytes === null) continue;
        if (bytes.byteLength > maxBytes) {
          throw new LimitExceededError(`Provider returned ${bytes.byteLength} bytes; read limit is ${maxBytes}.`);
        }
        assertCidMatches(cid, bytes);
        return copyBytes(bytes);
      } catch (error) {
        if (options.signal?.aborted) throw options.signal.reason ?? error;
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      const corrupt = failures.filter((failure) => failure instanceof IntegrityError).length;
      throw new StoreError(
        `No valid copy of ${cid} was available (${corrupt} corrupt, ${failures.length - corrupt} provider failure(s)).`,
        failures,
      );
    }
    return null;
  }

  put(cid: Cid, bytes: Uint8Array, options: StoreOperationOptions = {}): Promise<BlockWriteResult> {
    const snapshot = copyBytes(bytes);
    assertCidMatches(cid, snapshot);
    return this.#putSnapshot(cid, snapshot, options);
  }

  async #putSnapshot(cid: Cid, bytes: Uint8Array, options: StoreOperationOptions): Promise<BlockWriteResult> {
    const outcomes = await Promise.allSettled(this.stores.map((store) => withDeadline(
      (signal) => store.put(cid, copyBytes(bytes), { ...options, signal }),
      this.timeoutMs,
      options.signal,
    )));
    if (options.signal?.aborted) {
      throw options.signal.reason ?? new Error("Block-store operation aborted.");
    }
    let attempted = 0;
    let stored = 0;
    let failed = 0;
    const failures: unknown[] = [];
    for (const outcome of outcomes) {
      if (outcome.status === "rejected") {
        attempted += 1;
        failed += 1;
        failures.push(outcome.reason);
      } else {
        try {
          const result = validateWriteResult(outcome.value);
          attempted += result.attempted;
          stored += result.stored;
          failed += result.failed;
        } catch (error) {
          attempted += 1;
          failed += 1;
          failures.push(error);
        }
      }
    }
    if (stored < this.minimumWrites) {
      throw new ReplicationError(stored, this.minimumWrites, failures);
    }
    return { attempted, stored, failed };
  }
}
