import {
  assertByteLength,
  base64UrlDecode,
  base64UrlEncode,
  concatBytes,
  copyBytes,
  equalBytes,
  randomBytes,
  utf8Encoder,
} from "./bytes.js";
import { canonicalJsonBytes, parseCanonicalJson, type JsonObject } from "./canonical.js";
import { assertCidMatches, cidForBytes, digestFromCid, type Cid } from "./cid.js";
import {
  blockAad,
  decryptBlock,
  encryptBlock,
  identityFromPrivateKeys,
  signGrant,
  signManifest,
  signerForIdentity,
  unwrapObjectKeyUnsafe,
  wrapObjectKey,
  x25519KeyId,
} from "./crypto.js";
import {
  AccessDeniedError,
  BlockNotFoundError,
  IntegrityError,
  InvalidInputError,
  LimitExceededError,
} from "./errors.js";
import {
  MemoryKeyStore,
  MultiBlockStore,
  type BlockStore,
  type BlockWriteResult,
  type KeyStore,
  type ReadStrategy,
  type StoreOperationOptions,
} from "./stores.js";
import { validatePortableBundle } from "./portable-bundle.js";
import {
  ADDS_BUNDLE_PROTOCOL,
  ADDS_VERSION,
  BLOCK_AAD_DOMAIN,
  type AgentDataIdentity,
  type ByteSource,
  type DataRef,
  type GetOptions,
  type GetStreamOptions,
  type InspectOptions,
  type ManifestChunk,
  type PortableBundle,
  type PortableBundleImportResult,
  type PortableBundleOptions,
  type PutOptions,
  type PutResult,
  type PutStreamOptions,
  type ReplicationSummary,
  type ShareOptions,
  type SignedGrant,
  type SignedManifest,
  type UnsignedGrant,
  type UnsignedManifest,
  type VerifyResult,
} from "./types.js";
import {
  assertDirectIssuer,
  assertGrantTime,
  MAX_CHUNK_SIZE,
  MAX_MANIFEST_BYTES,
  validateGrant,
  validateManifest,
} from "./validation.js";

export const DEFAULT_CHUNK_SIZE = 1024 * 1024;
export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
export const DEFAULT_MAX_BLOCKS = 10_000;
export const DEFAULT_STREAM_CONCURRENCY = 1;
export const MAX_STREAM_CONCURRENCY = 16;
/** Default aggregate cap for one Manifest plus every framed ciphertext Block. */
export const DEFAULT_MAX_BUNDLE_BYTES = DEFAULT_MAX_BYTES + MAX_MANIFEST_BYTES + DEFAULT_MAX_BLOCKS * 28;
export const DEFAULT_MAX_GRANT_LIFETIME_SECONDS = 30 * 24 * 60 * 60;
export const MAX_GRANT_LIFETIME_SECONDS = 10 * 365 * 24 * 60 * 60;
const MAX_EPOCH_SECONDS = 253_402_300_799;
const MAX_SOURCE_PARTS = 1_048_576;

export interface AgentDataOptions {
  identity?: AgentDataIdentity;
  /** One precomposed store. Mutually exclusive with stores. */
  store?: BlockStore;
  /** Ordered local-first providers. Writes are attempted against every provider. */
  stores?: readonly BlockStore[];
  keyStore?: KeyStore;
  minimumWrites?: number;
  storeTimeoutMs?: number;
  /** Read strategy passed to MultiBlockStore when `stores` is provided. */
  readStrategy?: ReadStrategy;
  /** Hedge stagger delay in ms passed to MultiBlockStore when `stores` is provided. */
  hedgeDelayMs?: number;
  /** Concurrent provider read cap passed to MultiBlockStore when `stores` is provided. */
  maxConcurrentReads?: number;
  maxBytes?: number;
  maxManifestBytes?: number;
  maxBlocks?: number;
  maxGrantLifetimeSeconds?: number;
  now?: () => Date | string | number;
}

type Reference = Cid | DataRef | Pick<PutResult, "ref">;

function normalizeRef(reference: Reference): DataRef {
  const cid = typeof reference === "string"
    ? reference
    : "ref" in reference
      ? reference.ref.cid
      : reference.cid;
  digestFromCid(cid);
  return { cid };
}

function validateByteLimit(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new InvalidInputError(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function derivedBundleByteLimit(maxBytes: number, maxManifestBytes: number, maxBlocks: number): number {
  const blockOverhead = maxBlocks * 28;
  if (maxManifestBytes > Number.MAX_SAFE_INTEGER - blockOverhead) return Number.MAX_SAFE_INTEGER;
  const overhead = maxManifestBytes + blockOverhead;
  return maxBytes > Number.MAX_SAFE_INTEGER - overhead
    ? Number.MAX_SAFE_INTEGER
    : maxBytes + overhead;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error("Portable bundle operation aborted.");
}

function toEpochSeconds(value: Date | string | number, label: string): number {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
      throw new InvalidInputError(`${label} must be non-negative integer epoch seconds.`);
    }
    if (value > MAX_EPOCH_SECONDS) throw new InvalidInputError(`${label} exceeds the supported epoch range.`);
    return value;
  }
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    throw new InvalidInputError(`${label} is not a valid non-negative date.`);
  }
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds > MAX_EPOCH_SECONDS) throw new InvalidInputError(`${label} exceeds the supported epoch range.`);
  return seconds;
}

function snapshotJsonObject(value: JsonObject | undefined, label: string): JsonObject | undefined {
  if (value === undefined) return undefined;
  try {
    return parseCanonicalJson(canonicalJsonBytes(value)) as JsonObject;
  } catch (cause) {
    throw new InvalidInputError(`${label} must be restricted I-JSON.`, { cause });
  }
}

function snapshotProvenance(
  value: UnsignedManifest["provenance"],
): UnsignedManifest["provenance"] {
  if (value === undefined) return undefined;
  return parseCanonicalJson(canonicalJsonBytes(value)) as UnsignedManifest["provenance"];
}

function directSourceSnapshot(source: ByteSource): ByteSource {
  if (source instanceof Uint8Array) return copyBytes(source);
  if (source instanceof ArrayBuffer) return source.slice(0);
  return source;
}

function zeroDirectSourceSnapshot(original: ByteSource, snapshot: ByteSource): void {
  if (original instanceof Uint8Array && snapshot instanceof Uint8Array) snapshot.fill(0);
  if (original instanceof ArrayBuffer && snapshot instanceof ArrayBuffer) new Uint8Array(snapshot).fill(0);
}

async function* sourceParts(source: ByteSource): AsyncGenerator<Uint8Array> {
  if (typeof source === "string") {
    yield new TextEncoder().encode(source);
    return;
  }
  if (source instanceof Uint8Array) {
    yield source;
    return;
  }
  if (source instanceof ArrayBuffer) {
    yield new Uint8Array(source);
    return;
  }
  if (typeof Blob !== "undefined" && source instanceof Blob) {
    const reader = source.stream().getReader();
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        yield result.value;
      }
    } finally {
      reader.releaseLock();
    }
    return;
  }
  const possible = source as Partial<Iterable<Uint8Array> & AsyncIterable<Uint8Array>>;
  if (typeof possible[Symbol.asyncIterator] === "function") {
    for await (const part of possible as AsyncIterable<Uint8Array>) yield part;
    return;
  }
  if (typeof possible[Symbol.iterator] === "function") {
    for (const part of possible as Iterable<Uint8Array>) yield part;
    return;
  }
  throw new InvalidInputError("put source must be bytes, text, Blob, or an iterable of Uint8Array chunks.");
}

function validateConcurrency(value: number | undefined, label: string): number {
  const concurrency = value ?? DEFAULT_STREAM_CONCURRENCY;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > MAX_STREAM_CONCURRENCY) {
    throw new InvalidInputError(`${label} must be an integer between 1 and ${MAX_STREAM_CONCURRENCY}.`);
  }
  return concurrency;
}

function linkAbortSignal(upstream: AbortSignal | undefined, downstream: AbortController): () => void {
  if (upstream === undefined) return () => {};
  if (upstream.aborted) {
    downstream.abort(upstream.reason);
    return () => {};
  }
  const onAbort = () => downstream.abort(upstream.reason);
  upstream.addEventListener("abort", onAbort, { once: true });
  return () => upstream.removeEventListener("abort", onAbort);
}

async function* streamFixedChunks(
  source: ByteSource,
  chunkSize: number,
  expectedPlaintextSize: number,
  signal?: AbortSignal,
): AsyncGenerator<{ index: number; bytes: Uint8Array }> {
  let current = new Uint8Array(chunkSize);
  let currentLength = 0;
  let total = 0;
  let index = 0;
  let sourcePartCount = 0;
  try {
    for await (const yielded of sourceParts(source)) {
      throwIfAborted(signal);
      sourcePartCount += 1;
      if (sourcePartCount > MAX_SOURCE_PARTS) {
        throw new LimitExceededError(`Byte source exceeds ${MAX_SOURCE_PARTS} yielded parts.`);
      }
      if (!(yielded instanceof Uint8Array)) {
        throw new InvalidInputError("Byte iterables must yield Uint8Array values.");
      }
      if (total + yielded.byteLength > expectedPlaintextSize) {
        throw new InvalidInputError(
          `Stream yielded more bytes than declared putStream.plaintextSize (${expectedPlaintextSize}).`,
        );
      }
      total += yielded.byteLength;
      let offset = 0;
      while (offset < yielded.byteLength) {
        const take = Math.min(chunkSize - currentLength, yielded.byteLength - offset);
        current.set(yielded.subarray(offset, offset + take), currentLength);
        currentLength += take;
        offset += take;
        if (currentLength === chunkSize) {
          const full = current;
          current = new Uint8Array(chunkSize);
          currentLength = 0;
          yield { index, bytes: full };
          index += 1;
        }
      }
    }
    throwIfAborted(signal);
    if (total !== expectedPlaintextSize) {
      throw new InvalidInputError(
        `Stream yielded ${total} bytes; expected declared putStream.plaintextSize (${expectedPlaintextSize}).`,
      );
    }
    if (currentLength > 0) {
      const tail = current.slice(0, currentLength);
      current.fill(0);
      currentLength = 0;
      yield { index, bytes: tail };
    } else if (expectedPlaintextSize === 0) {
      yield { index: 0, bytes: new Uint8Array(0) };
    }
  } finally {
    current.fill(0);
  }
}

async function readFixedChunks(
  source: ByteSource,
  chunkSize: number,
  maxBytes: number,
  maxBlocks: number,
): Promise<{ chunks: Uint8Array[]; size: number }> {
  if (typeof Blob !== "undefined" && source instanceof Blob && source.size > maxBytes) {
    throw new LimitExceededError(`Plaintext Blob is ${source.size} bytes; maxBytes is ${maxBytes}.`);
  }
  const chunks: Uint8Array[] = [];
  let current = new Uint8Array(chunkSize);
  let currentLength = 0;
  let total = 0;
  let sourcePartCount = 0;
  try {
  for await (const yielded of sourceParts(source)) {
    sourcePartCount += 1;
    if (sourcePartCount > MAX_SOURCE_PARTS) {
      throw new LimitExceededError(`Byte source exceeds ${MAX_SOURCE_PARTS} yielded parts.`);
    }
    if (!(yielded instanceof Uint8Array)) {
      throw new InvalidInputError("Byte iterables must yield Uint8Array values.");
    }
    if (total + yielded.byteLength > maxBytes) {
      throw new LimitExceededError(`Plaintext exceeds maxBytes (${maxBytes}).`);
    }
    total += yielded.byteLength;
    let offset = 0;
    while (offset < yielded.byteLength) {
      const take = Math.min(chunkSize - currentLength, yielded.byteLength - offset);
      current.set(yielded.subarray(offset, offset + take), currentLength);
      currentLength += take;
      offset += take;
      if (currentLength === chunkSize) {
        chunks.push(current);
        if (chunks.length > maxBlocks) throw new LimitExceededError(`Object exceeds local maxBlocks (${maxBlocks}).`);
        current = new Uint8Array(chunkSize);
        currentLength = 0;
      }
    }
  }
  if (currentLength > 0) chunks.push(current.slice(0, currentLength));
  if (chunks.length === 0) chunks.push(new Uint8Array(0));
  if (chunks.length > maxBlocks) throw new LimitExceededError(`Object exceeds local maxBlocks (${maxBlocks}).`);
  return { chunks, size: total };
  } catch (error) {
    current.fill(0);
    for (const chunk of chunks) chunk.fill(0);
    throw error;
  }
}

function normalizeWriteResult(result: BlockWriteResult | void): BlockWriteResult {
  if (result === undefined) return { attempted: 1, stored: 1, failed: 0 };
  if (
    !Number.isSafeInteger(result.attempted) ||
    !Number.isSafeInteger(result.stored) ||
    !Number.isSafeInteger(result.failed) ||
    result.attempted < 1 ||
    result.stored < 0 ||
    result.failed < 0 ||
    result.stored + result.failed > result.attempted
  ) {
    throw new InvalidInputError("Block store returned invalid write acknowledgement counters.");
  }
  return result;
}

function summarizeWrites(writes: readonly BlockWriteResult[]): ReplicationSummary {
  let minimumAcknowledgements = Number.POSITIVE_INFINITY;
  let maximumAcknowledgements = 0;
  let failedWrites = 0;
  for (const write of writes) {
    minimumAcknowledgements = Math.min(minimumAcknowledgements, write.stored);
    maximumAcknowledgements = Math.max(maximumAcknowledgements, write.stored);
    failedWrites += write.failed;
  }
  return {
    storedObjects: writes.length,
    minimumAcknowledgements: Number.isFinite(minimumAcknowledgements) ? minimumAcknowledgements : 0,
    maximumAcknowledgements,
    failedWrites,
  };
}

function snapshotIdentity(identity: AgentDataIdentity | undefined): AgentDataIdentity | undefined {
  if (identity === undefined) return undefined;
  const normalized = identityFromPrivateKeys(identity.id, identity.signingPrivateKey, identity.boxPrivateKey);
  if (!equalBytes(normalized.signingPublicKey, identity.signingPublicKey)) {
    throw new InvalidInputError("Identity Ed25519 public key does not match its private key.");
  }
  if (!equalBytes(normalized.boxPublicKey, identity.boxPublicKey)) {
    throw new InvalidInputError("Identity X25519 public key does not match its private key.");
  }
  return normalized;
}

/** Offline-first ADDS 0.1 encrypted-object client. It reads no environment variables. */
export class AgentData {
  readonly #store: BlockStore;
  readonly #keyStore: KeyStore;
  readonly #identity?: AgentDataIdentity;
  readonly #maxBytes: number;
  readonly #maxManifestBytes: number;
  readonly #maxBlocks: number;
  readonly #maxGrantLifetimeSeconds: number;
  readonly #now: () => Date | string | number;

  constructor(options: AgentDataOptions) {
    if ((options.store === undefined) === (options.stores === undefined)) {
      throw new InvalidInputError("Provide exactly one of store or stores.");
    }
    this.#store = options.store ?? new MultiBlockStore(options.stores!, {
      minimumWrites: options.minimumWrites,
      timeoutMs: options.storeTimeoutMs,
      readStrategy: options.readStrategy,
      hedgeDelayMs: options.hedgeDelayMs,
      maxConcurrentReads: options.maxConcurrentReads,
    });
    this.#keyStore = options.keyStore ?? new MemoryKeyStore();
    this.#identity = snapshotIdentity(options.identity);
    this.#maxBytes = validateByteLimit(options.maxBytes ?? DEFAULT_MAX_BYTES, "maxBytes");
    this.#maxManifestBytes = validateByteLimit(
      options.maxManifestBytes ?? MAX_MANIFEST_BYTES,
      "maxManifestBytes",
    );
    this.#maxBlocks = validateByteLimit(options.maxBlocks ?? DEFAULT_MAX_BLOCKS, "maxBlocks");
    if (this.#maxBlocks < 1 || this.#maxBlocks > DEFAULT_MAX_BLOCKS) {
      throw new InvalidInputError(`maxBlocks must be between 1 and ${DEFAULT_MAX_BLOCKS}.`);
    }
    this.#maxGrantLifetimeSeconds = validateByteLimit(
      options.maxGrantLifetimeSeconds ?? DEFAULT_MAX_GRANT_LIFETIME_SECONDS,
      "maxGrantLifetimeSeconds",
    );
    if (this.#maxGrantLifetimeSeconds < 1 || this.#maxGrantLifetimeSeconds > MAX_GRANT_LIFETIME_SECONDS) {
      throw new InvalidInputError(
        `maxGrantLifetimeSeconds must be between 1 and ${MAX_GRANT_LIFETIME_SECONDS}.`,
      );
    }
    this.#now = options.now ?? (() => new Date());
  }

  #requireIdentity(operation: string): AgentDataIdentity {
    if (this.#identity === undefined) {
      throw new AccessDeniedError(`${operation} requires a local signing identity.`);
    }
    return this.#identity;
  }

  #currentEpoch(): number {
    return toEpochSeconds(this.#now(), "current time");
  }

  async #putBlock(
    cid: Cid,
    bytes: Uint8Array,
    options: StoreOperationOptions = {},
  ): Promise<BlockWriteResult> {
    return normalizeWriteResult(await this.#store.put(cid, bytes, options));
  }

  async put(source: ByteSource, options: PutOptions = {}): Promise<PutResult> {
    const identity = this.#requireIdentity("put");
    const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_CHUNK_SIZE) {
      throw new InvalidInputError(`chunkSize must be an integer between 1 and ${MAX_CHUNK_SIZE}.`);
    }
    const maxBytes = validateByteLimit(options.maxBytes ?? this.#maxBytes, "put.maxBytes");
    const createdAt = options.createdAt === undefined
      ? this.#currentEpoch()
      : toEpochSeconds(options.createdAt, "put.createdAt");
    const schema = options.schema;
    const mediaType = options.mediaType;
    if (schema !== undefined && (typeof schema !== "string" || schema.length === 0 || schema.length > 1_024)) {
      throw new InvalidInputError("put.schema must be a non-empty string of at most 1024 characters.");
    }
    if (mediaType !== undefined && (typeof mediaType !== "string" || mediaType.length === 0 || mediaType.length > 1_024)) {
      throw new InvalidInputError("put.mediaType must be a non-empty string of at most 1024 characters.");
    }
    const metadata = snapshotJsonObject(options.metadata, "put.metadata");
    const provenance = snapshotProvenance(options.provenance);
    const extensions = snapshotJsonObject(options.extensions, "put.extensions");
    const sourceSnapshot = directSourceSnapshot(source);
    let plaintext: Awaited<ReturnType<typeof readFixedChunks>>;
    try {
      plaintext = await readFixedChunks(sourceSnapshot, chunkSize, maxBytes, this.#maxBlocks);
    } finally {
      zeroDirectSourceSnapshot(source, sourceSnapshot);
    }
    const objectId = `urn:uuid:${globalThis.crypto.randomUUID()}`;
    const keyId = `dek:${base64UrlEncode(randomBytes(16))}`;
    const aadContext = base64UrlEncode(randomBytes(32));
    const manifestBase: Omit<UnsignedManifest, "chunks"> = {
      adds_version: ADDS_VERSION,
      kind: "manifest",
      object_id: objectId,
      publisher: signerForIdentity(identity),
      created_at: createdAt,
      plaintext: { size: plaintext.size },
      encryption: {
        algorithm: "AES-256-GCM",
        key_id: keyId,
        chunk_size: chunkSize,
        block_aad: BLOCK_AAD_DOMAIN,
        aad_context: aadContext,
      },
      ...(mediaType === undefined ? {} : { media_type: mediaType }),
      ...(schema === undefined ? {} : { schema }),
      ...(metadata === undefined ? {} : { metadata }),
      ...(provenance === undefined ? {} : { provenance }),
      ...(extensions === undefined ? {} : { extensions }),
    };
    try {
      const placeholderDescriptors = plaintext.chunks.map((chunk, index): ManifestChunk => {
        const marker = new Uint8Array(12);
        new DataView(marker.buffer).setUint32(8, index);
        return {
          index,
          cid: cidForBytes(marker),
          nonce: base64UrlEncode(marker),
          plaintext_size: chunk.byteLength,
          ciphertext_size: chunk.byteLength + 16,
        };
      });
      const projectedManifest = signManifest({ ...manifestBase, chunks: placeholderDescriptors }, identity);
      validateManifest(projectedManifest);
      if (canonicalJsonBytes(projectedManifest).byteLength > this.#maxManifestBytes) {
        throw new LimitExceededError("Projected manifest exceeds maxManifestBytes before block writes.");
      }
    } catch (error) {
      for (const chunk of plaintext.chunks) chunk.fill(0);
      throw error;
    }

    const objectKey = randomBytes(32);
    const descriptors: ManifestChunk[] = [];
    const writes: BlockWriteResult[] = [];
    const usedNonces = new Set<string>();

    try {
      for (let index = 0; index < plaintext.chunks.length; index += 1) {
        const chunk = plaintext.chunks[index]!;
        const aad = blockAad({
          objectId,
          keyId,
          aadContext,
          index,
          plaintextSize: chunk.byteLength,
          blockCount: plaintext.chunks.length,
          totalPlaintextSize: plaintext.size,
          chunkSize,
        });
        let nonce = randomBytes(12);
        let nonceText = base64UrlEncode(nonce);
        let nonceAttempts = 1;
        while (usedNonces.has(nonceText)) {
          if (nonceAttempts >= 16) throw new IntegrityError("Unable to generate a unique block nonce.");
          nonce = randomBytes(12);
          nonceText = base64UrlEncode(nonce);
          nonceAttempts += 1;
        }
        usedNonces.add(nonceText);
        const encrypted = await encryptBlock(chunk, objectKey, aad, nonce);
        const frame = concatBytes(encrypted.nonce, encrypted.ciphertext);
        const cid = cidForBytes(frame);
        writes.push(await this.#putBlock(cid, frame));
        descriptors.push({
          index,
          cid,
          nonce: nonceText,
          plaintext_size: chunk.byteLength,
          ciphertext_size: encrypted.ciphertext.byteLength,
        });
      }

      const unsigned: UnsignedManifest = { ...manifestBase, chunks: descriptors };
      const manifest = signManifest(unsigned, identity);
      validateManifest(manifest);
      const manifestBytes = canonicalJsonBytes(manifest);
      if (manifestBytes.byteLength > this.#maxManifestBytes) {
        throw new LimitExceededError(`Manifest exceeds maxManifestBytes (${this.#maxManifestBytes}).`);
      }
      const manifestCid = cidForBytes(manifestBytes);
      writes.push(await this.#putBlock(manifestCid, manifestBytes));
      await this.#keyStore.set(manifestCid, copyBytes(objectKey));
      return {
        ref: { cid: manifestCid },
        manifest,
        replication: summarizeWrites(writes),
      };
    } finally {
      objectKey.fill(0);
      for (const chunk of plaintext.chunks) chunk.fill(0);
    }
  }

  /**
   * Stream-encrypt and store an ADDS 0.1 object in O(chunkSize * concurrency)
   * plaintext memory. Produces wire-identical Blocks and Manifests to `put()`.
   *
   * ADDS 0.1 binds `totalPlaintextSize` and `blockCount` into every block's
   * AES-256-GCM AAD, so `plaintextSize` is auto-derived for bytes/string/Blob
   * and required explicitly for Iterable/AsyncIterable sources.
   */
  async putStream(source: ByteSource, options: PutStreamOptions = {}): Promise<PutResult> {
    throwIfAborted(options.signal);
    const identity = this.#requireIdentity("putStream");
    const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_CHUNK_SIZE) {
      throw new InvalidInputError(`chunkSize must be an integer between 1 and ${MAX_CHUNK_SIZE}.`);
    }
    const maxBytes = validateByteLimit(options.maxBytes ?? this.#maxBytes, "putStream.maxBytes");
    const concurrency = validateConcurrency(options.concurrency, "putStream.concurrency");
    const createdAt = options.createdAt === undefined
      ? this.#currentEpoch()
      : toEpochSeconds(options.createdAt, "putStream.createdAt");
    const schema = options.schema;
    const mediaType = options.mediaType;
    if (schema !== undefined && (typeof schema !== "string" || schema.length === 0 || schema.length > 1_024)) {
      throw new InvalidInputError("putStream.schema must be a non-empty string of at most 1024 characters.");
    }
    if (mediaType !== undefined && (typeof mediaType !== "string" || mediaType.length === 0 || mediaType.length > 1_024)) {
      throw new InvalidInputError("putStream.mediaType must be a non-empty string of at most 1024 characters.");
    }
    const metadata = snapshotJsonObject(options.metadata, "putStream.metadata");
    const provenance = snapshotProvenance(options.provenance);
    const extensions = snapshotJsonObject(options.extensions, "putStream.extensions");

    let encodedString: Uint8Array | null = null;
    let streamSource: ByteSource = source;
    let knownSize: number | undefined;
    if (typeof source === "string") {
      encodedString = utf8Encoder.encode(source);
      streamSource = encodedString;
      knownSize = encodedString.byteLength;
    } else if (source instanceof Uint8Array) {
      knownSize = source.byteLength;
    } else if (source instanceof ArrayBuffer) {
      knownSize = source.byteLength;
    } else if (typeof Blob !== "undefined" && source instanceof Blob) {
      knownSize = source.size;
    }

    try {
      const explicitSize = options.plaintextSize === undefined
        ? undefined
        : validateByteLimit(options.plaintextSize, "putStream.plaintextSize");
      if (knownSize !== undefined && explicitSize !== undefined && knownSize !== explicitSize) {
        throw new InvalidInputError(
          `putStream.plaintextSize (${explicitSize}) does not match source byte length (${knownSize}).`,
        );
      }
      const plaintextSize = explicitSize ?? knownSize;
      if (plaintextSize === undefined) {
        throw new InvalidInputError(
          "putStream requires plaintextSize for iterable sources because ADDS 0.1 binds totalPlaintextSize into block AAD.",
        );
      }
      if (plaintextSize > maxBytes) {
        throw new LimitExceededError(`Plaintext is ${plaintextSize} bytes; maxBytes is ${maxBytes}.`);
      }
      const blockCount = plaintextSize === 0 ? 1 : Math.ceil(plaintextSize / chunkSize);
      if (blockCount > this.#maxBlocks) {
        throw new LimitExceededError(`Object requires ${blockCount} blocks; local maxBlocks is ${this.#maxBlocks}.`);
      }

      const objectId = `urn:uuid:${globalThis.crypto.randomUUID()}`;
      const keyId = `dek:${base64UrlEncode(randomBytes(16))}`;
      const aadContext = base64UrlEncode(randomBytes(32));
      const manifestBase: Omit<UnsignedManifest, "chunks"> = {
        adds_version: ADDS_VERSION,
        kind: "manifest",
        object_id: objectId,
        publisher: signerForIdentity(identity),
        created_at: createdAt,
        plaintext: { size: plaintextSize },
        encryption: {
          algorithm: "AES-256-GCM",
          key_id: keyId,
          chunk_size: chunkSize,
          block_aad: BLOCK_AAD_DOMAIN,
          aad_context: aadContext,
        },
        ...(mediaType === undefined ? {} : { media_type: mediaType }),
        ...(schema === undefined ? {} : { schema }),
        ...(metadata === undefined ? {} : { metadata }),
        ...(provenance === undefined ? {} : { provenance }),
        ...(extensions === undefined ? {} : { extensions }),
      };

      const placeholderDescriptors: ManifestChunk[] = new Array(blockCount);
      for (let index = 0; index < blockCount; index += 1) {
        const marker = new Uint8Array(12);
        new DataView(marker.buffer).setUint32(8, index);
        const chunkPlaintextSize = plaintextSize === 0
          ? 0
          : index < blockCount - 1
            ? chunkSize
            : plaintextSize - index * chunkSize;
        placeholderDescriptors[index] = {
          index,
          cid: cidForBytes(marker),
          nonce: base64UrlEncode(marker),
          plaintext_size: chunkPlaintextSize,
          ciphertext_size: chunkPlaintextSize + 16,
        };
      }
      const projectedManifest = signManifest({ ...manifestBase, chunks: placeholderDescriptors }, identity);
      validateManifest(projectedManifest);
      if (canonicalJsonBytes(projectedManifest).byteLength > this.#maxManifestBytes) {
        throw new LimitExceededError("Projected manifest exceeds maxManifestBytes before block writes.");
      }

      const objectKey = randomBytes(32);
      const descriptors: ManifestChunk[] = new Array(blockCount);
      const writes: BlockWriteResult[] = new Array(blockCount);
      const usedNonces = new Set<string>();
      const writeController = new AbortController();
      const unlinkAbort = linkAbortSignal(options.signal, writeController);
      const inFlight = new Set<Promise<void>>();
      let firstError: unknown = null;
      let hasError = false;
      let seenBlocks = 0;

      const allocateNonce = (): { nonce: Uint8Array; nonceText: string } => {
        let nonce = randomBytes(12);
        let nonceText = base64UrlEncode(nonce);
        let attempts = 1;
        while (usedNonces.has(nonceText)) {
          if (attempts >= 16) throw new IntegrityError("Unable to generate a unique block nonce.");
          nonce = randomBytes(12);
          nonceText = base64UrlEncode(nonce);
          attempts += 1;
        }
        usedNonces.add(nonceText);
        return { nonce, nonceText };
      };

      try {
        for await (const { index, bytes: chunk } of streamFixedChunks(
          streamSource,
          chunkSize,
          plaintextSize,
          writeController.signal,
        )) {
          if (hasError) {
            chunk.fill(0);
            break;
          }
          if (index >= blockCount) {
            chunk.fill(0);
            throw new InvalidInputError("Stream yielded more blocks than expected for declared plaintextSize.");
          }
          seenBlocks += 1;
          const { nonce, nonceText } = allocateNonce();
          const aad = blockAad({
            objectId,
            keyId,
            aadContext,
            index,
            plaintextSize: chunk.byteLength,
            blockCount,
            totalPlaintextSize: plaintextSize,
            chunkSize,
          });

          let task!: Promise<void>;
          task = (async () => {
            try {
              const encrypted = await encryptBlock(chunk, objectKey, aad, nonce);
              const frame = concatBytes(encrypted.nonce, encrypted.ciphertext);
              const cid = cidForBytes(frame);
              writes[index] = await this.#putBlock(cid, frame, { signal: writeController.signal });
              descriptors[index] = {
                index,
                cid,
                nonce: nonceText,
                plaintext_size: chunk.byteLength,
                ciphertext_size: encrypted.ciphertext.byteLength,
              };
            } catch (error) {
              if (!hasError) {
                hasError = true;
                firstError = error;
                writeController.abort(error);
              }
            } finally {
              chunk.fill(0);
              inFlight.delete(task);
            }
          })();

          inFlight.add(task);
          if (inFlight.size >= concurrency) {
            await Promise.race(inFlight);
          }
          if (hasError) break;
        }

        await Promise.allSettled(inFlight);
        if (hasError) throw firstError;
        throwIfAborted(options.signal);
        if (seenBlocks !== blockCount) {
          throw new InvalidInputError(`Stream yielded ${seenBlocks} blocks; expected ${blockCount}.`);
        }

        const unsigned: UnsignedManifest = { ...manifestBase, chunks: descriptors };
        const manifest = signManifest(unsigned, identity);
        validateManifest(manifest);
        const manifestBytes = canonicalJsonBytes(manifest);
        if (manifestBytes.byteLength > this.#maxManifestBytes) {
          throw new LimitExceededError(`Manifest exceeds maxManifestBytes (${this.#maxManifestBytes}).`);
        }
        const manifestCid = cidForBytes(manifestBytes);
        writes.push(await this.#putBlock(manifestCid, manifestBytes, {
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        }));
        await this.#keyStore.set(manifestCid, copyBytes(objectKey));
        return {
          ref: { cid: manifestCid },
          manifest,
          replication: summarizeWrites(writes),
        };
      } catch (error) {
        writeController.abort(error);
        await Promise.allSettled(inFlight);
        throw error;
      } finally {
        unlinkAbort();
        objectKey.fill(0);
      }
    } finally {
      encodedString?.fill(0);
    }
  }

  async inspect(reference: Reference, options: InspectOptions = {}): Promise<SignedManifest> {
    const ref = normalizeRef(reference);
    throwIfAborted(options.signal);
    const bytes = await this.#store.get(ref.cid, {
      maxBytes: this.#maxManifestBytes,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (bytes === null) throw new BlockNotFoundError(ref.cid);
    if (bytes.byteLength > this.#maxManifestBytes) {
      throw new LimitExceededError(`Manifest exceeds maxManifestBytes (${this.#maxManifestBytes}).`);
    }
    assertCidMatches(ref.cid, bytes);
    const manifest = validateManifest(parseCanonicalJson(bytes));
    const maxBytes = validateByteLimit(options.maxBytes ?? this.#maxBytes, "inspect.maxBytes");
    if (manifest.plaintext.size > maxBytes) {
      throw new LimitExceededError(`Manifest declares ${manifest.plaintext.size} bytes; limit is ${maxBytes}.`);
    }
    if (manifest.chunks.length > this.#maxBlocks) {
      throw new LimitExceededError(`Manifest exceeds local maxBlocks (${this.#maxBlocks}).`);
    }
    return manifest;
  }

  /**
   * Snapshot one complete encrypted ADDS object without exporting its DEK or a Grant.
   * The returned transport-neutral blocks are ordered Manifest-first, then by the
   * Manifest's signed chunk order.
   */
  async exportBundle(
    reference: Reference,
    options: PortableBundleOptions = {},
  ): Promise<PortableBundle> {
    const ref = normalizeRef(reference);
    const maxBytes = validateByteLimit(options.maxBytes ?? this.#maxBytes, "exportBundle.maxBytes");
    const maxBundleBytes = validateByteLimit(
      options.maxBundleBytes
        ?? derivedBundleByteLimit(maxBytes, this.#maxManifestBytes, this.#maxBlocks),
      "exportBundle.maxBundleBytes",
    );
    throwIfAborted(options.signal);
    const manifestBytes = await this.#store.get(ref.cid, {
      maxBytes: Math.min(this.#maxManifestBytes, maxBundleBytes),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (manifestBytes === null) throw new BlockNotFoundError(ref.cid);
    if (manifestBytes.byteLength > this.#maxManifestBytes) {
      throw new LimitExceededError(`Manifest exceeds maxManifestBytes (${this.#maxManifestBytes}).`);
    }
    assertCidMatches(ref.cid, manifestBytes);
    const manifest = validateManifest(parseCanonicalJson(manifestBytes));
    if (manifest.plaintext.size > maxBytes) {
      throw new LimitExceededError(`Manifest declares ${manifest.plaintext.size} bytes; limit is ${maxBytes}.`);
    }
    if (manifest.chunks.length > this.#maxBlocks) {
      throw new LimitExceededError(`Manifest exceeds local maxBlocks (${this.#maxBlocks}).`);
    }

    const blocks = [{ cid: ref.cid, bytes: manifestBytes }];
    let bundleBytes = manifestBytes.byteLength;
    if (bundleBytes > maxBundleBytes) {
      throw new LimitExceededError(`Portable bundle exceeds maxBundleBytes (${maxBundleBytes}).`);
    }
    for (const chunk of manifest.chunks) {
      throwIfAborted(options.signal);
      const expectedLength = 12 + chunk.ciphertext_size;
      if (expectedLength > maxBundleBytes - bundleBytes) {
        throw new LimitExceededError(`Portable bundle exceeds maxBundleBytes (${maxBundleBytes}).`);
      }
      const frame = await this.#store.get(chunk.cid, {
        maxBytes: expectedLength,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
      if (frame === null) throw new BlockNotFoundError(chunk.cid);
      if (frame.byteLength !== expectedLength) {
        throw new IntegrityError(`Block ${chunk.index} length does not match its manifest descriptor.`);
      }
      blocks.push({ cid: chunk.cid, bytes: frame });
      bundleBytes += frame.byteLength;
    }

    return validatePortableBundle({
      protocol: ADDS_BUNDLE_PROTOCOL,
      root: ref,
      blocks,
    }, {
      maxBytes,
      maxManifestBytes: this.#maxManifestBytes,
      maxBlocks: this.#maxBlocks,
      maxBundleBytes,
    }).bundle;
  }

  /**
   * Validate and snapshot a complete portable bundle before writing any Block.
   * Ciphertext Blocks are attempted before the root Manifest. Provider failures
   * may leave immutable partial writes, including a partially successful final
   * root write; retrying the same content-addressed bundle remains safe.
   */
  async importBundle(
    bundle: PortableBundle,
    options: PortableBundleOptions = {},
  ): Promise<PortableBundleImportResult> {
    const maxBytes = validateByteLimit(options.maxBytes ?? this.#maxBytes, "importBundle.maxBytes");
    const maxBundleBytes = validateByteLimit(
      options.maxBundleBytes
        ?? derivedBundleByteLimit(maxBytes, this.#maxManifestBytes, this.#maxBlocks),
      "importBundle.maxBundleBytes",
    );
    throwIfAborted(options.signal);
    const validated = validatePortableBundle(bundle, {
      maxBytes,
      maxManifestBytes: this.#maxManifestBytes,
      maxBlocks: this.#maxBlocks,
      maxBundleBytes,
    });

    const writes: BlockWriteResult[] = [];
    for (const block of validated.bundle.blocks.slice(1)) {
      throwIfAborted(options.signal);
      writes.push(await this.#putBlock(block.cid, block.bytes, {
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      }));
    }
    throwIfAborted(options.signal);
    const root = validated.bundle.blocks[0]!;
    writes.push(await this.#putBlock(root.cid, root.bytes, {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }));

    return {
      cid: validated.bundle.root.cid,
      ref: { ...validated.bundle.root },
      manifest: validated.manifest,
      ciphertextBlocksVerified: validated.manifest.chunks.length,
      encryptedBytes: validated.encryptedBytes,
      bundleBytes: validated.bundleBytes,
      replication: summarizeWrites(writes),
    };
  }

  async share(reference: Reference, options: ShareOptions): Promise<SignedGrant> {
    const identity = this.#requireIdentity("share");
    const ref = normalizeRef(reference);
    const audience = options.audience;
    if (typeof audience !== "string" || audience.length === 0) {
      throw new InvalidInputError("share.audience must be a non-empty principal id.");
    }
    const audienceBoxPublicKey = copyBytes(options.audienceBoxPublicKey);
    assertByteLength(audienceBoxPublicKey, 32, "Audience X25519 public key");
    const audienceBoxKeyId = x25519KeyId(audienceBoxPublicKey);
    if (options.audienceBoxKeyId !== undefined && options.audienceBoxKeyId !== audienceBoxKeyId) {
      throw new InvalidInputError("share.audienceBoxKeyId must equal the X25519 sha256 fingerprint.");
    }
    const issuedAt = options.issuedAt === undefined
      ? this.#currentEpoch()
      : toEpochSeconds(options.issuedAt, "share.issuedAt");
    const notBefore = options.notBefore === undefined
      ? undefined
      : toEpochSeconds(options.notBefore, "share.notBefore");
    const expiresAt = toEpochSeconds(options.expiresAt, "share.expiresAt");
    const effectiveNotBefore = notBefore ?? issuedAt;
    if (issuedAt > effectiveNotBefore || effectiveNotBefore >= expiresAt) {
      throw new InvalidInputError("Grant time order must satisfy issuedAt <= notBefore < expiresAt.");
    }
    if (expiresAt - issuedAt > this.#maxGrantLifetimeSeconds) {
      throw new LimitExceededError(
        `Grant lifetime exceeds local maximum (${this.#maxGrantLifetimeSeconds} seconds).`,
      );
    }

    const manifest = await this.inspect(ref);
    const signer = signerForIdentity(identity);
    if (
      manifest.publisher.id !== signer.id ||
      manifest.publisher.ed25519_public_key !== signer.ed25519_public_key
    ) {
      throw new AccessDeniedError("Only the manifest publisher can issue a direct ADDS grant.");
    }
    const storedObjectKey = await this.#keyStore.get(ref.cid);
    if (storedObjectKey === null) {
      throw new AccessDeniedError("No local object key is available for this manifest.");
    }
    const objectKey = copyBytes(storedObjectKey);
    try {
      const beforeWrap: Omit<UnsignedGrant, "key_wrap"> = {
        adds_version: ADDS_VERSION,
        kind: "grant",
        grant_id: `urn:uuid:${globalThis.crypto.randomUUID()}`,
        manifest_cid: ref.cid,
        issuer: signer,
        audience,
        audience_x25519_public_key: base64UrlEncode(audienceBoxPublicKey),
        audience_x25519_key_id: audienceBoxKeyId,
        rights: ["read"],
        issued_at: issuedAt,
        ...(notBefore === undefined ? {} : { not_before: notBefore }),
        expires_at: expiresAt,
      };
      const keyWrap = await wrapObjectKey(objectKey, beforeWrap, audienceBoxPublicKey);
      const grant = signGrant({ ...beforeWrap, key_wrap: keyWrap }, identity);
      return validateGrant(grant);
    } finally {
      objectKey.fill(0);
    }
  }

  async verify(reference: Reference, options: InspectOptions = {}): Promise<VerifyResult> {
    const ref = normalizeRef(reference);
    const manifest = await this.inspect(ref, options);
    let encryptedBytes = 0;
    for (const chunk of manifest.chunks) {
      const expectedLength = 12 + chunk.ciphertext_size;
      const frame = await this.#store.get(chunk.cid, { maxBytes: expectedLength });
      if (frame === null) throw new BlockNotFoundError(chunk.cid);
      if (frame.byteLength !== expectedLength) {
        throw new IntegrityError(`Block ${chunk.index} length does not match its manifest descriptor.`);
      }
      assertCidMatches(chunk.cid, frame);
      const expectedNonce = base64UrlDecode(chunk.nonce, `manifest.chunks[${chunk.index}].nonce`);
      if (!equalBytes(frame.subarray(0, 12), expectedNonce)) {
        throw new IntegrityError(`Block ${chunk.index} nonce prefix does not match its manifest descriptor.`);
      }
      encryptedBytes += frame.byteLength;
    }
    return { cid: ref.cid, manifest, ciphertextBlocksVerified: manifest.chunks.length, encryptedBytes };
  }

  async get(reference: Reference, options: GetOptions = {}): Promise<Uint8Array> {
    const ref = normalizeRef(reference);
    const grant = options.grant === undefined
      ? undefined
      : validateGrant(parseCanonicalJson(canonicalJsonBytes(options.grant)));
    if (options.recipientBoxPrivateKey !== undefined) {
      assertByteLength(options.recipientBoxPrivateKey, 32, "Recipient X25519 private key");
    }
    const recipientPrivateKey = options.recipientBoxPrivateKey === undefined
      ? undefined
      : copyBytes(options.recipientBoxPrivateKey);
    const recipientId = options.recipientId ?? this.#identity?.id;
    if (grant === undefined && recipientPrivateKey !== undefined) {
      recipientPrivateKey.fill(0);
      throw new InvalidInputError("recipientBoxPrivateKey is only valid together with a grant.");
    }

    try {
    if (grant !== undefined) {
      if (grant.manifest_cid !== ref.cid) throw new AccessDeniedError("Grant references a different manifest CID.");
      if (recipientId === undefined || grant.audience !== recipientId) {
        throw new AccessDeniedError("Grant audience does not match the recipient identity.");
      }
      if (grant.expires_at - grant.issued_at > this.#maxGrantLifetimeSeconds) {
        throw new AccessDeniedError("Grant lifetime exceeds local authorization policy.");
      }
      const now = options.now === undefined ? this.#currentEpoch() : toEpochSeconds(options.now, "get.now");
      assertGrantTime(grant, now);
    }

    const maxBytes = validateByteLimit(options.maxBytes ?? this.#maxBytes, "get.maxBytes");
    const manifest = await this.inspect(ref, { maxBytes });
    let objectKey: Uint8Array | null = null;
    if (grant !== undefined) {
      assertDirectIssuer(manifest, grant);
      const privateKey = recipientPrivateKey ?? this.#identity?.boxPrivateKey;
      if (privateKey === undefined) {
        throw new AccessDeniedError("A recipient X25519 private key is required to open this grant.");
      }
      objectKey = await unwrapObjectKeyUnsafe(grant, recipientId!, privateKey);
    } else if (objectKey === null) {
      const storedObjectKey = await this.#keyStore.get(ref.cid);
      objectKey = storedObjectKey === null ? null : copyBytes(storedObjectKey);
    }
    if (objectKey === null) {
      throw new AccessDeniedError("No object key or valid direct grant is available.");
    }

    const output = new Uint8Array(manifest.plaintext.size);
    let offset = 0;
    let succeeded = false;
    try {
      for (const chunk of manifest.chunks) {
        const expectedLength = 12 + chunk.ciphertext_size;
        const frame = await this.#store.get(chunk.cid, { maxBytes: expectedLength });
        if (frame === null) throw new BlockNotFoundError(chunk.cid);
        if (frame.byteLength !== expectedLength) {
          throw new IntegrityError(`Block ${chunk.index} length does not match its manifest descriptor.`);
        }
        assertCidMatches(chunk.cid, frame);
        const nonce = frame.slice(0, 12);
        const expectedNonce = base64UrlDecode(chunk.nonce, `manifest.chunks[${chunk.index}].nonce`);
        if (!equalBytes(nonce, expectedNonce)) {
          throw new IntegrityError(`Block ${chunk.index} nonce prefix does not match its manifest descriptor.`);
        }
        const aad = blockAad({
          objectId: manifest.object_id,
          keyId: manifest.encryption.key_id,
          aadContext: manifest.encryption.aad_context,
          index: chunk.index,
          plaintextSize: chunk.plaintext_size,
          blockCount: manifest.chunks.length,
          totalPlaintextSize: manifest.plaintext.size,
          chunkSize: manifest.encryption.chunk_size,
        });
        const plaintext = await decryptBlock(frame.subarray(12), nonce, objectKey, aad);
        try {
          if (plaintext.byteLength !== chunk.plaintext_size) {
            throw new IntegrityError(`Block ${chunk.index} decrypted to an unexpected size.`);
          }
          output.set(plaintext, offset);
          offset += plaintext.byteLength;
        } finally {
          plaintext.fill(0);
        }
      }
      if (offset !== manifest.plaintext.size) throw new IntegrityError("Reassembled plaintext size is inconsistent.");
      succeeded = true;
      return output;
    } finally {
      objectKey.fill(0);
      if (!succeeded) output.fill(0);
    }
    } finally {
      recipientPrivateKey?.fill(0);
    }
  }

  /**
   * Stream-fetch, CID-verify, and AES-GCM decrypt an ADDS 0.1 object in
   * O(chunkSize * concurrency) plaintext memory. Chunks are yielded strictly
   * in manifest index order; breaking early aborts prefetches and zeroizes
   * unyielded decrypted buffers and key material.
   */
  getStream(reference: Reference, options: GetStreamOptions = {}): AsyncIterable<Uint8Array> {
    const ref = normalizeRef(reference);
    const concurrency = validateConcurrency(options.concurrency, "getStream.concurrency");
    if (options.recipientBoxPrivateKey !== undefined) {
      assertByteLength(options.recipientBoxPrivateKey, 32, "Recipient X25519 private key");
    }
    const maxBytes = validateByteLimit(options.maxBytes ?? this.#maxBytes, "getStream.maxBytes");
    const self = this;

    return {
      async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
        throwIfAborted(options.signal);
        const grant = options.grant === undefined
          ? undefined
          : validateGrant(parseCanonicalJson(canonicalJsonBytes(options.grant)));
        const recipientPrivateKey = options.recipientBoxPrivateKey === undefined
          ? undefined
          : copyBytes(options.recipientBoxPrivateKey);
        const recipientId = options.recipientId ?? self.#identity?.id;
        if (grant === undefined && recipientPrivateKey !== undefined) {
          recipientPrivateKey.fill(0);
          throw new InvalidInputError("recipientBoxPrivateKey is only valid together with a grant.");
        }

        let objectKey: Uint8Array | null = null;
        const readController = new AbortController();
        const unlinkAbort = linkAbortSignal(options.signal, readController);
        type ChunkOutcome = { ok: true; plaintext: Uint8Array } | { ok: false; error: unknown };
        const queue = new Map<number, Promise<ChunkOutcome>>();

        try {
          if (grant !== undefined) {
            if (grant.manifest_cid !== ref.cid) throw new AccessDeniedError("Grant references a different manifest CID.");
            if (recipientId === undefined || grant.audience !== recipientId) {
              throw new AccessDeniedError("Grant audience does not match the recipient identity.");
            }
            if (grant.expires_at - grant.issued_at > self.#maxGrantLifetimeSeconds) {
              throw new AccessDeniedError("Grant lifetime exceeds local authorization policy.");
            }
            const now = options.now === undefined ? self.#currentEpoch() : toEpochSeconds(options.now, "getStream.now");
            assertGrantTime(grant, now);
          }

          const manifest = await self.inspect(ref, { maxBytes, signal: readController.signal });
          if (grant !== undefined) {
            assertDirectIssuer(manifest, grant);
            const privateKey = recipientPrivateKey ?? self.#identity?.boxPrivateKey;
            if (privateKey === undefined) {
              throw new AccessDeniedError("A recipient X25519 private key is required to open this grant.");
            }
            objectKey = await unwrapObjectKeyUnsafe(grant, recipientId!, privateKey);
          } else {
            const storedObjectKey = await self.#keyStore.get(ref.cid);
            objectKey = storedObjectKey === null ? null : copyBytes(storedObjectKey);
          }
          if (objectKey === null) {
            throw new AccessDeniedError("No object key or valid direct grant is available.");
          }

          const activeKey = objectKey;
          const fetchAndDecrypt = (chunkIndex: number): Promise<ChunkOutcome> => {
            const chunk = manifest.chunks[chunkIndex]!;
            return (async (): Promise<ChunkOutcome> => {
              try {
                const expectedLength = 12 + chunk.ciphertext_size;
                const frame = await self.#store.get(chunk.cid, {
                  maxBytes: expectedLength,
                  signal: readController.signal,
                });
                if (frame === null) throw new BlockNotFoundError(chunk.cid);
                if (frame.byteLength !== expectedLength) {
                  throw new IntegrityError(`Block ${chunk.index} length does not match its manifest descriptor.`);
                }
                assertCidMatches(chunk.cid, frame);
                const nonce = frame.slice(0, 12);
                const expectedNonce = base64UrlDecode(chunk.nonce, `manifest.chunks[${chunk.index}].nonce`);
                if (!equalBytes(nonce, expectedNonce)) {
                  throw new IntegrityError(`Block ${chunk.index} nonce prefix does not match its manifest descriptor.`);
                }
                const aad = blockAad({
                  objectId: manifest.object_id,
                  keyId: manifest.encryption.key_id,
                  aadContext: manifest.encryption.aad_context,
                  index: chunk.index,
                  plaintextSize: chunk.plaintext_size,
                  blockCount: manifest.chunks.length,
                  totalPlaintextSize: manifest.plaintext.size,
                  chunkSize: manifest.encryption.chunk_size,
                });
                const plaintext = await decryptBlock(frame.subarray(12), nonce, activeKey, aad);
                if (plaintext.byteLength !== chunk.plaintext_size) {
                  plaintext.fill(0);
                  throw new IntegrityError(`Block ${chunk.index} decrypted to an unexpected size.`);
                }
                return { ok: true, plaintext };
              } catch (error) {
                return { ok: false, error };
              }
            })();
          };

          const totalChunks = manifest.chunks.length;
          let nextToSchedule = 0;
          const fillWindow = () => {
            while (nextToSchedule < totalChunks && queue.size < concurrency) {
              const idx = nextToSchedule++;
              queue.set(idx, fetchAndDecrypt(idx));
            }
          };

          fillWindow();
          let yieldedBytes = 0;
          for (let i = 0; i < totalChunks; i += 1) {
            throwIfAborted(options.signal);
            const promise = queue.get(i)!;
            queue.delete(i);
            const outcome = await promise;
            if (!outcome.ok) {
              readController.abort(outcome.error);
              throw outcome.error;
            }
            yieldedBytes += outcome.plaintext.byteLength;
            if (i === totalChunks - 1 && yieldedBytes !== manifest.plaintext.size) {
              outcome.plaintext.fill(0);
              throw new IntegrityError("Reassembled plaintext size is inconsistent.");
            }
            fillWindow();
            yield outcome.plaintext;
          }
        } finally {
          readController.abort(new Error("Stream closed."));
          const remaining = await Promise.allSettled([...queue.values()]);
          queue.clear();
          for (const settled of remaining) {
            if (settled.status === "fulfilled" && settled.value.ok) {
              settled.value.plaintext.fill(0);
            }
          }
          unlinkAbort();
          objectKey?.fill(0);
          recipientPrivateKey?.fill(0);
        }
      },
    };
  }

  /** Explicit key import for caller-managed custody or offline transfer. */
  async importKey(reference: Reference, key: Uint8Array): Promise<void> {
    const ref = normalizeRef(reference);
    const snapshot = copyBytes(key);
    assertByteLength(snapshot, 32, "Imported object key");
    try {
      await this.inspect(ref);
      await this.#keyStore.set(ref.cid, copyBytes(snapshot));
    } finally {
      snapshot.fill(0);
    }
  }

  async forgetKey(reference: Reference): Promise<void> {
    const ref = normalizeRef(reference);
    if (this.#keyStore.delete === undefined) {
      throw new InvalidInputError("Configured KeyStore does not support deletion.");
    }
    await this.#keyStore.delete(ref.cid);
  }
}
