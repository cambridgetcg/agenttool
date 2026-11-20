/**
 * Strict HTTPS 206 Range fetcher and independent BEP 52 piece-layer verifier
 * for transport-hints/v1 (docs/specs/TRANSPORT-HINTS-0.1-DRAFT.md).
 *
 * Scope and boundaries:
 * - Pure HTTPS Range transport only. No BitTorrent wire protocol, no DHT, no
 *   trackers, no peer discovery, no seeder, and no network on module import.
 * - Reuses api/src/services/net/safe-fetch.ts's split IPv4/IPv6 public-address
 *   policy, DNS resolution, pinned TCP/TLS socket transport, and admission gate
 *   inside an explicit manual redirect loop (default max 1 hop, section 7.4) so
 *   that ONLY `Range` and `Accept-Encoding: identity` cross an origin boundary
 *   (HF /resolve/ and GitHub Releases both redirect cross-origin).
 * - Consumer rule (section 9): `subject.size` and `subject.sha256` from the
 *   authority record are the ONLY acceptance criteria. BEP 52 `piecesRoot` and
 *   `pieceLayer` enable per-piece verification and fast mirror failover, never
 *   final acceptance on their own.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import type { LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";
import { performance } from "node:perf_hooks";
import {
  SAFE_NET_DEFAULT_TIMEOUT_MS,
  SAFE_NET_HARD_MAX_RESPONSE_BYTES,
  SafeNetError,
  assertSafeNetUrl,
  createSafeNetAdmissionGate,
  defaultSafeNetRequestOnce,
  isGloballyReachableAddress,
  resolveGloballyReachableAddresses,
  type SafeNetAdmissionGate,
  type SafeNetAdmissionRelease,
  type SafeNetDnsLookup,
  type SafeNetHeaders,
  type SafeNetRequestOnce,
  type SafeNetWireResponse,
} from "../api/src/services/net/safe-fetch.ts";

export const BEP52_BLOCK_SIZE = 16_384;
export const BEP52_MIN_PIECE_LENGTH = 16_384;
export const BEP52_MAX_PIECE_LENGTH = 16 * 1024 * 1024;
export const BEP52_HASH_BYTES = 32;

export const DEFAULT_RANGE_MAX_REDIRECTS = 1;
export const HARD_MAX_RANGE_REDIRECTS = 2;
export const DEFAULT_RANGE_CONCURRENCY = 2;
export const MAX_RANGE_CONCURRENCY = 8;
export const DEFAULT_HEDGE_DELAY_MS = 250;
export const MAX_HEDGE_DELAY_MS = 60_000;
export const DEFAULT_MAX_CONCURRENT_PER_PIECE = 2;
export const MAX_CONCURRENT_PER_PIECE = 4;
export const HARD_MAX_REQUEST_BUDGET = 10_000;
export const DEFAULT_MAX_MIRROR_ERRORS = 3;
export const DEFAULT_MAX_IN_MEMORY_BYTES = SAFE_NET_HARD_MAX_RESPONSE_BYTES;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MIN_REDIRECT_BODY_CAP = 64 * 1024;
const LOWERCASE_HEX_64 = /^[0-9a-f]{64}$/u;
const ZERO_LEAF = new Uint8Array(BEP52_HASH_BYTES);

export type TransportHintsFetchErrorCode =
  | "invalid_subject"
  | "invalid_piece_length"
  | "invalid_piece_layer"
  | "invalid_pieces_root"
  | "piece_layer_root_mismatch"
  | "invalid_options"
  | "no_valid_mirrors"
  | "status_not_206"
  | "invalid_content_range"
  | "invalid_content_encoding"
  | "range_length_mismatch"
  | "redirect_missing_location"
  | "redirect_limit_exceeded"
  | "redirect_refused"
  | "connected_address_mismatch"
  | "request_budget_exhausted"
  | "piece_hash_mismatch"
  | "all_mirrors_failed"
  | "final_size_mismatch"
  | "final_sha256_mismatch"
  | "artifact_too_large"
  | "aborted";

export class TransportHintsFetchError extends Error {
  readonly code: TransportHintsFetchErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: TransportHintsFetchErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    const cause = details?.cause;
    super(message, cause === undefined ? undefined : { cause });
    this.name = "TransportHintsFetchError";
    this.code = code;
    if (details !== undefined) {
      const rest: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(details)) {
        if (key !== "cause" && value !== undefined) rest[key] = value;
      }
      if (Object.keys(rest).length > 0) {
        this.details = Object.freeze(rest);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Independent BEP 52 Merkle piece-layer verifier
// ---------------------------------------------------------------------------

const padHashCache = new Map<number, Uint8Array>([[0, ZERO_LEAF]]);

function sha256Pair(left: Uint8Array, right: Uint8Array): Uint8Array {
  const hash = createHash("sha256");
  hash.update(left);
  hash.update(right);
  return new Uint8Array(hash.digest());
}

function sha256Bytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(bytes).digest());
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Validate a BEP 52 piece length (power of two from 16 KiB to 16 MiB) and
 * return `h = log2(pieceLength / 16384)`, the number of Merkle levels inside
 * one piece subtree.
 */
export function assertBep52PieceLength(pieceLength: number): number {
  if (
    !Number.isSafeInteger(pieceLength)
    || pieceLength < BEP52_MIN_PIECE_LENGTH
    || pieceLength > BEP52_MAX_PIECE_LENGTH
    || (pieceLength & (pieceLength - 1)) !== 0
  ) {
    throw new TransportHintsFetchError(
      "invalid_piece_length",
      `pieceLength must be a power of two from ${BEP52_MIN_PIECE_LENGTH} to ${BEP52_MAX_PIECE_LENGTH} (got ${String(pieceLength)})`,
    );
  }
  return Math.round(Math.log2(pieceLength / BEP52_BLOCK_SIZE));
}

/**
 * BEP 52 pad hash at height `h`:
 *   pad(0)     = 32 zero bytes
 *   pad(k + 1) = SHA-256(pad(k) || pad(k))
 */
export function bep52PadHash(height: number): Uint8Array {
  if (!Number.isSafeInteger(height) || height < 0 || height > 30) {
    throw new TransportHintsFetchError(
      "invalid_piece_length",
      `pad height must be an integer in [0, 30] (got ${String(height)})`,
    );
  }
  const existing = padHashCache.get(height);
  if (existing) return existing.slice();
  const prev = bep52PadHash(height - 1);
  const computed = sha256Pair(prev, prev);
  padHashCache.set(height, computed);
  return computed.slice();
}

function collapseBalancedTree(leaves: readonly Uint8Array[]): Uint8Array {
  let layer: Uint8Array[] = leaves.map((leaf) => leaf);
  while (layer.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      next.push(sha256Pair(layer[i]!, layer[i + 1]!));
    }
    layer = next;
  }
  return layer[0]!.slice();
}

/**
 * Compute the BEP 52 Merkle root for one piece's exact bytes.
 *
 * Per TRANSPORT-HINTS-0.1-DRAFT.md section 7.1.1:
 * - When `singlePiece` is true (`size <= pieceLength`), the 16 KiB block leaves
 *   are padded with zero leaves ONLY to the next power of two >= blockCount
 *   (NOT to a full piece).
 * - When `singlePiece` is false (`size > pieceLength`), every piece subtree
 *   (including a short last piece) is padded with zero leaves up to
 *   `pieceLength / 16384` leaves.
 */
export function computeBep52PieceHash(
  pieceBytes: Uint8Array,
  options: { readonly pieceLength: number; readonly singlePiece: boolean },
): Uint8Array {
  assertBep52PieceLength(options.pieceLength);
  if (!(pieceBytes instanceof Uint8Array) || pieceBytes.byteLength === 0 || pieceBytes.byteLength > options.pieceLength) {
    throw new TransportHintsFetchError(
      "invalid_subject",
      `pieceBytes length must be in [1, ${options.pieceLength}] (got ${pieceBytes instanceof Uint8Array ? pieceBytes.byteLength : typeof pieceBytes})`,
    );
  }
  const blockCount = Math.ceil(pieceBytes.byteLength / BEP52_BLOCK_SIZE);
  const targetLeaves = options.singlePiece
    ? nextPowerOfTwo(blockCount)
    : options.pieceLength / BEP52_BLOCK_SIZE;

  const leaves: Uint8Array[] = new Array(targetLeaves);
  for (let b = 0; b < blockCount; b += 1) {
    const start = b * BEP52_BLOCK_SIZE;
    const end = Math.min(start + BEP52_BLOCK_SIZE, pieceBytes.byteLength);
    leaves[b] = sha256Bytes(pieceBytes.subarray(start, end));
  }
  for (let b = blockCount; b < targetLeaves; b += 1) {
    leaves[b] = ZERO_LEAF;
  }
  return collapseBalancedTree(leaves);
}

/**
 * Compute the BEP 52 `pieces root` from a multi-piece `pieceLayer`
 * (concatenated 32-byte piece hashes, >= 2 pieces). Pads up to the next power
 * of two with `bep52PadHash(log2(pieceLength / 16384))`.
 */
export function computeBep52PiecesRootFromLayer(
  pieceLayer: Uint8Array,
  pieceLength: number,
): Uint8Array {
  const height = assertBep52PieceLength(pieceLength);
  if (
    !(pieceLayer instanceof Uint8Array)
    || pieceLayer.byteLength < BEP52_HASH_BYTES * 2
    || pieceLayer.byteLength % BEP52_HASH_BYTES !== 0
  ) {
    throw new TransportHintsFetchError(
      "invalid_piece_layer",
      "multi-piece pieceLayer must be a non-empty multiple of 32 bytes with at least 2 pieces",
    );
  }
  const pieceCount = pieceLayer.byteLength / BEP52_HASH_BYTES;
  const targetCount = nextPowerOfTwo(pieceCount);
  const pad = bep52PadHash(height);
  const nodes: Uint8Array[] = new Array(targetCount);
  for (let i = 0; i < pieceCount; i += 1) {
    nodes[i] = pieceLayer.subarray(i * BEP52_HASH_BYTES, (i + 1) * BEP52_HASH_BYTES);
  }
  for (let i = pieceCount; i < targetCount; i += 1) {
    nodes[i] = pad;
  }
  return collapseBalancedTree(nodes);
}

function decodeHexBytes(hex: string, code: TransportHintsFetchErrorCode, label: string): Uint8Array {
  if (typeof hex !== "string" || hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/u.test(hex)) {
    throw new TransportHintsFetchError(code, `${label} must be lowercase hexadecimal`);
  }
  return new Uint8Array(Buffer.from(hex, "hex"));
}

function parseHash32(value: string | Uint8Array, code: TransportHintsFetchErrorCode, label: string): Uint8Array {
  if (typeof value === "string") {
    if (!LOWERCASE_HEX_64.test(value)) {
      throw new TransportHintsFetchError(code, `${label} must be 64 lowercase hex characters`);
    }
    return new Uint8Array(Buffer.from(value, "hex"));
  }
  if (value instanceof Uint8Array && value.byteLength === BEP52_HASH_BYTES) {
    return value.slice();
  }
  throw new TransportHintsFetchError(code, `${label} must be 32 bytes or 64 lowercase hex characters`);
}

export interface Bep52VerificationPlan {
  /** Exact file byte count from the authority record (>= 1). */
  readonly size: number;
  /** Authoritative SHA-256 of the full file (64 lowercase hex chars). */
  readonly expectedSha256: string;
  /** BEP 52 piece length (power of two in [16 KiB, 16 MiB]). */
  readonly pieceLength: number;
  /** BEP 52 pieces root (32 bytes or 64 lowercase hex chars). */
  readonly piecesRoot: string | Uint8Array;
  /**
   * BEP 52 piece layer for `size > pieceLength` (concatenated 32-byte hashes,
   * raw bytes or lowercase hex). MUST be `null` or `undefined` when
   * `size <= pieceLength`.
   */
  readonly pieceLayer?: string | Uint8Array | null;
}

export interface ValidatedBep52Plan {
  readonly size: number;
  readonly expectedSha256: string;
  readonly pieceLength: number;
  readonly pieceCount: number;
  readonly singlePiece: boolean;
  readonly piecesRoot: Uint8Array;
  readonly pieceHashes: readonly Uint8Array[];
}

/**
 * Validate a file's authority identity (`size`, `expectedSha256`) and its
 * BEP 52 transport hints (`pieceLength`, `piecesRoot`, `pieceLayer`) BEFORE
 * issuing any network request.
 */
export function validateBep52Plan(plan: Bep52VerificationPlan): ValidatedBep52Plan {
  if (!Number.isSafeInteger(plan.size) || plan.size < 1) {
    throw new TransportHintsFetchError("invalid_subject", "size must be a positive safe integer");
  }
  if (typeof plan.expectedSha256 !== "string" || !LOWERCASE_HEX_64.test(plan.expectedSha256)) {
    throw new TransportHintsFetchError("invalid_subject", "expectedSha256 must be 64 lowercase hex characters");
  }
  assertBep52PieceLength(plan.pieceLength);
  const piecesRoot = parseHash32(plan.piecesRoot, "invalid_pieces_root", "piecesRoot");
  const pieceCount = Math.ceil(plan.size / plan.pieceLength);
  const singlePiece = pieceCount === 1;

  if (singlePiece) {
    if (plan.pieceLayer !== undefined && plan.pieceLayer !== null) {
      throw new TransportHintsFetchError(
        "invalid_piece_layer",
        "single-piece files (size <= pieceLength) must have pieceLayer === null/undefined per BEP 52",
      );
    }
    return Object.freeze({
      size: plan.size,
      expectedSha256: plan.expectedSha256,
      pieceLength: plan.pieceLength,
      pieceCount: 1,
      singlePiece: true,
      piecesRoot,
      pieceHashes: Object.freeze([piecesRoot]),
    });
  }

  if (plan.pieceLayer === undefined || plan.pieceLayer === null) {
    throw new TransportHintsFetchError(
      "invalid_piece_layer",
      `multi-piece file (${pieceCount} pieces) requires pieceLayer of ${pieceCount * BEP52_HASH_BYTES} bytes`,
    );
  }
  const layerBytes = typeof plan.pieceLayer === "string"
    ? decodeHexBytes(plan.pieceLayer, "invalid_piece_layer", "pieceLayer")
    : plan.pieceLayer instanceof Uint8Array
      ? plan.pieceLayer.slice()
      : (() => {
        throw new TransportHintsFetchError("invalid_piece_layer", "pieceLayer must be Uint8Array or lowercase hex");
      })();

  if (layerBytes.byteLength !== pieceCount * BEP52_HASH_BYTES) {
    throw new TransportHintsFetchError(
      "invalid_piece_layer",
      `pieceLayer has ${layerBytes.byteLength} bytes, expected ${pieceCount * BEP52_HASH_BYTES} (${pieceCount} pieces)`,
    );
  }
  const derivedRoot = computeBep52PiecesRootFromLayer(layerBytes, plan.pieceLength);
  if (!timingSafeEqual(derivedRoot, piecesRoot)) {
    throw new TransportHintsFetchError(
      "piece_layer_root_mismatch",
      "BEP 52 pieceLayer does not hash to piecesRoot",
      {
        expected_pieces_root: Buffer.from(piecesRoot).toString("hex"),
        derived_pieces_root: Buffer.from(derivedRoot).toString("hex"),
      },
    );
  }
  const pieceHashes: Uint8Array[] = new Array(pieceCount);
  for (let i = 0; i < pieceCount; i += 1) {
    pieceHashes[i] = layerBytes.subarray(i * BEP52_HASH_BYTES, (i + 1) * BEP52_HASH_BYTES);
  }
  return Object.freeze({
    size: plan.size,
    expectedSha256: plan.expectedSha256,
    pieceLength: plan.pieceLength,
    pieceCount,
    singlePiece: false,
    piecesRoot,
    pieceHashes: Object.freeze(pieceHashes),
  });
}

/** Expected byte range `[first, last]` (inclusive) for piece `pieceIndex`. */
export function pieceByteRange(
  plan: Pick<ValidatedBep52Plan, "size" | "pieceLength" | "pieceCount">,
  pieceIndex: number,
): readonly [number, number] {
  if (!Number.isSafeInteger(pieceIndex) || pieceIndex < 0 || pieceIndex >= plan.pieceCount) {
    throw new TransportHintsFetchError(
      "invalid_options",
      `pieceIndex ${String(pieceIndex)} out of range [0, ${plan.pieceCount - 1}]`,
    );
  }
  const first = pieceIndex * plan.pieceLength;
  const last = Math.min(first + plan.pieceLength - 1, plan.size - 1);
  return [first, last] as const;
}

/**
 * Verify one piece's bytes against the pre-validated BEP 52 plan.
 * Returns `false` if length or Merkle subtree hash disagrees.
 */
export function verifyBep52Piece(
  plan: ValidatedBep52Plan,
  pieceIndex: number,
  pieceBytes: Uint8Array,
): boolean {
  const [first, last] = pieceByteRange(plan, pieceIndex);
  const expectedLength = last - first + 1;
  if (!(pieceBytes instanceof Uint8Array) || pieceBytes.byteLength !== expectedLength) {
    return false;
  }
  const actual = computeBep52PieceHash(pieceBytes, {
    pieceLength: plan.pieceLength,
    singlePiece: plan.singlePiece,
  });
  return timingSafeEqual(actual, plan.pieceHashes[pieceIndex]!);
}

// ---------------------------------------------------------------------------
// Strict HTTPS 206 Range transport reusing #584 safe-fetch primitives
// ---------------------------------------------------------------------------

const defaultRangeAdmission = createSafeNetAdmissionGate({
  maxConcurrent: 16,
  maxQueued: 64,
  queueTimeoutMs: 2_000,
});

function normalizeConnectedAddress(address: string): string {
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/iu.exec(address);
  if (dotted && isIP(dotted[1]!) === 4) return dotted[1]!;
  const hexadecimal = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/iu.exec(address);
  if (!hexadecimal) return address;
  const high = Number.parseInt(hexadecimal[1]!, 16);
  const low = Number.parseInt(hexadecimal[2]!, 16);
  return [high >>> 8, high & 0xff, low >>> 8, low & 0xff].join(".");
}

function assertPinnedConnectedAddress(
  connectedAddress: string,
  addresses: readonly LookupAddress[],
): void {
  const normalized = normalizeConnectedAddress(connectedAddress);
  if (!isGloballyReachableAddress(normalized)) {
    throw new TransportHintsFetchError(
      "connected_address_mismatch",
      `connected address ${connectedAddress} is not globally reachable`,
    );
  }
  const family = isIP(normalized);
  const allowed = new BlockList();
  for (const candidate of addresses) {
    if (candidate.family === family) {
      allowed.addAddress(candidate.address, family === 4 ? "ipv4" : "ipv6");
    }
  }
  if ((family !== 4 && family !== 6) || !allowed.check(normalized, family === 4 ? "ipv4" : "ipv6")) {
    throw new TransportHintsFetchError(
      "connected_address_mismatch",
      `connected address ${connectedAddress} did not match resolved DNS answers`,
    );
  }
}

function readSingleHeader(headers: SafeNetHeaders | undefined, lowerName: string): { present: boolean; value: string | null; multiple: boolean } {
  if (!headers) return { present: false, value: null, multiple: false };
  let found: string | null = null;
  let count = 0;
  for (const [key, raw] of Object.entries(headers)) {
    if (key.toLowerCase() !== lowerName || raw === undefined) continue;
    if (Array.isArray(raw)) {
      if (raw.length === 0) continue;
      if (raw.length > 1 || count > 0) return { present: true, value: null, multiple: true };
      found = raw[0]!;
      count += 1;
    } else {
      if (count > 0) return { present: true, value: null, multiple: true };
      found = raw;
      count += 1;
    }
  }
  return { present: count > 0, value: found, multiple: false };
}

function raceSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(
      signal.reason instanceof Error
        ? signal.reason
        : new TransportHintsFetchError("aborted", "request aborted"),
    );
  }
  let onAbort: (() => void) | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      onAbort = () => {
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new TransportHintsFetchError("aborted", "request aborted"),
        );
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }),
  ]).finally(() => {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  });
}

export interface SafeHttpsRangeRequestOptions {
  readonly url: string;
  readonly first: number;
  readonly last: number;
  readonly totalSize: number;
  /** Max redirect hops (default 1, hard max 2 per section 7.4). */
  readonly maxRedirects?: number;
  /** Per-request wall timeout in ms (default 15,000, max 120,000). */
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /** Optional caller egress predicate applied to initial URL and every redirect target. */
  readonly allowUrl?: (url: URL) => boolean;
  /** Injectable DNS lookup for hermetic tests; defaults to safe-fetch's public DNS resolver. */
  readonly lookup?: SafeNetDnsLookup;
  /** Injectable single-hop wire transport; defaults to safe-fetch's pinned-socket HTTP/1.1 transport. */
  readonly requestOnce?: SafeNetRequestOnce;
  /** Optional shared admission gate; defaults to module-level bounded gate. */
  readonly admission?: SafeNetAdmissionGate;
  /** Optional callback invoked right before each HTTP hop (used by request budgets). */
  readonly onBeforeHop?: (url: URL, hop: number) => void;
}

export interface SafeHttpsRangeResponse {
  readonly bytes: Uint8Array;
  readonly finalUrl: string;
  readonly redirects: number;
  readonly connectedAddress?: string;
}

/**
 * Fetch one exact inclusive byte range `[first, last]` of a `totalSize`-byte
 * file over HTTPS using `#584`'s safe-fetch primitives.
 *
 * Follows redirects manually one hop at a time (default max 1 hop), re-checking
 * `assertSafeNetUrl(["https:"])`, `allowUrl`, and `resolveGloballyReachableAddresses`
 * on every hop while preserving ONLY `Range` and `Accept-Encoding: identity`.
 * Requires `206 Partial Content`, exact `Content-Range: bytes first-last/totalSize`,
 * absent or `identity` `Content-Encoding`, and exact byte count.
 */
export async function fetchSafeHttpsRange(
  options: SafeHttpsRangeRequestOptions,
): Promise<SafeHttpsRangeResponse> {
  if (
    !Number.isSafeInteger(options.totalSize)
    || options.totalSize < 1
    || !Number.isSafeInteger(options.first)
    || !Number.isSafeInteger(options.last)
    || options.first < 0
    || options.last < options.first
    || options.last >= options.totalSize
  ) {
    throw new TransportHintsFetchError("invalid_options", "invalid byte range bounds");
  }
  const expectedLength = options.last - options.first + 1;
  if (expectedLength > SAFE_NET_HARD_MAX_RESPONSE_BYTES) {
    throw new TransportHintsFetchError(
      "invalid_options",
      `range length ${expectedLength} exceeds hard max ${SAFE_NET_HARD_MAX_RESPONSE_BYTES}`,
    );
  }
  const maxRedirects = options.maxRedirects ?? DEFAULT_RANGE_MAX_REDIRECTS;
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > HARD_MAX_RANGE_REDIRECTS) {
    throw new TransportHintsFetchError(
      "invalid_options",
      `maxRedirects must be an integer in [0, ${HARD_MAX_RANGE_REDIRECTS}]`,
    );
  }
  const timeoutMs = options.timeoutMs ?? SAFE_NET_DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new TransportHintsFetchError("invalid_options", "timeoutMs must be an integer in [1, 120000]");
  }

  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new SafeNetError("safe_net_request_timeout"));
  }, timeoutMs);
  const onExternalAbort = (): void => {
    controller.abort(
      options.signal?.reason instanceof Error
        ? options.signal.reason
        : new TransportHintsFetchError("aborted", "range request aborted by caller"),
    );
  };
  if (options.signal?.aborted) onExternalAbort();
  else options.signal?.addEventListener("abort", onExternalAbort, { once: true });

  const requestOnce = options.requestOnce ?? defaultSafeNetRequestOnce;
  const admission = options.admission ?? defaultRangeAdmission;
  const maxWireBytes = Math.min(
    SAFE_NET_HARD_MAX_RESPONSE_BYTES,
    Math.max(expectedLength, MIN_REDIRECT_BODY_CAP),
  );
  const rangeHeader = `bytes=${options.first}-${options.last}`;

  let currentUrl: string = options.url;
  let release: SafeNetAdmissionRelease | undefined;
  try {
    release = await admission.acquire(controller.signal);

    for (let hop = 0; ; hop += 1) {
      if (controller.signal.aborted) {
        throw controller.signal.reason instanceof Error
          ? controller.signal.reason
          : new TransportHintsFetchError("aborted", "range request aborted");
      }
      const parsed = assertSafeNetUrl(currentUrl, { protocols: ["https:"] });
      if (options.allowUrl && !options.allowUrl(parsed)) {
        throw new TransportHintsFetchError(
          "redirect_refused",
          `URL refused by egress policy at hop ${hop}: ${parsed.origin}${parsed.pathname}`,
          { hop, origin: parsed.origin },
        );
      }

      options.onBeforeHop?.(parsed, hop);

      const addresses = await raceSignal(
        resolveGloballyReachableAddresses(parsed.hostname, options.lookup),
        controller.signal,
      );

      const remaining = timeoutMs - (performance.now() - started);
      if (remaining <= 0) {
        throw new SafeNetError("safe_net_request_timeout");
      }

      // Preserve ONLY `range` and `accept-encoding: identity` on every hop.
      const wire: SafeNetWireResponse = await raceSignal(
        requestOnce({
          url: parsed,
          addresses,
          method: "GET",
          headers: {
            range: rangeHeader,
            "accept-encoding": "identity",
          },
          timeoutMs: Math.max(1, Math.ceil(remaining)),
          maxResponseBytes: maxWireBytes,
          signal: controller.signal,
        }),
        controller.signal,
      );

      if (wire.connectedAddress !== undefined) {
        assertPinnedConnectedAddress(wire.connectedAddress, addresses);
      }

      if (REDIRECT_STATUSES.has(wire.statusCode)) {
        const location = readSingleHeader(wire.headers, "location");
        if (!location.present || location.multiple || !location.value) {
          throw new TransportHintsFetchError(
            "redirect_missing_location",
            `redirect ${wire.statusCode} missing valid Location header`,
            { statusCode: wire.statusCode, hop },
          );
        }
        if (hop >= maxRedirects) {
          throw new TransportHintsFetchError(
            "redirect_limit_exceeded",
            `redirect limit (${maxRedirects}) exceeded at status ${wire.statusCode}`,
            { statusCode: wire.statusCode, hop, maxRedirects },
          );
        }
        let nextUrl: URL;
        try {
          nextUrl = new URL(location.value, parsed);
        } catch (cause) {
          throw new TransportHintsFetchError(
            "redirect_missing_location",
            "redirect Location is not a valid URL",
            { cause, statusCode: wire.statusCode, hop },
          );
        }
        // Validate scheme/credentials/private IP immediately before next hop.
        const checkedNext = assertSafeNetUrl(nextUrl, { protocols: ["https:"] });
        if (options.allowUrl && !options.allowUrl(checkedNext)) {
          throw new TransportHintsFetchError(
            "redirect_refused",
            `redirect target refused by egress policy: ${checkedNext.origin}${checkedNext.pathname}`,
            { hop: hop + 1, origin: checkedNext.origin },
          );
        }
        currentUrl = checkedNext.href;
        continue;
      }

      if (wire.statusCode !== 206) {
        throw new TransportHintsFetchError(
          "status_not_206",
          `expected HTTP 206 Partial Content, got ${wire.statusCode}`,
          { statusCode: wire.statusCode, isFull200: wire.statusCode === 200 },
        );
      }

      const encoding = readSingleHeader(wire.headers, "content-encoding");
      if (
        encoding.multiple
        || (encoding.present && (encoding.value === null || encoding.value.trim().toLowerCase() !== "identity"))
      ) {
        throw new TransportHintsFetchError(
          "invalid_content_encoding",
          `refusing non-identity Content-Encoding on 206 response (${encoding.multiple ? "multiple" : String(encoding.value)})`,
          { contentEncoding: encoding.multiple ? "multiple" : encoding.value },
        );
      }

      const expectedContentRange = `bytes ${options.first}-${options.last}/${options.totalSize}`;
      const contentRange = readSingleHeader(wire.headers, "content-range");
      if (contentRange.multiple || !contentRange.present || contentRange.value !== expectedContentRange) {
        throw new TransportHintsFetchError(
          "invalid_content_range",
          `Content-Range '${contentRange.multiple ? "multiple" : String(contentRange.value)}' != expected '${expectedContentRange}'`,
          { expected: expectedContentRange, actual: contentRange.multiple ? "multiple" : contentRange.value },
        );
      }

      const body = wire.body;
      if (!Buffer.isBuffer(body) || body.byteLength !== expectedLength) {
        throw new TransportHintsFetchError(
          "range_length_mismatch",
          `206 body length ${Buffer.isBuffer(body) ? body.byteLength : -1} != expected ${expectedLength}`,
          { expected: expectedLength, actual: Buffer.isBuffer(body) ? body.byteLength : -1 },
        );
      }

      const copy = new Uint8Array(expectedLength);
      copy.set(body);
      return {
        bytes: copy,
        finalUrl: parsed.href,
        redirects: hop,
        ...(wire.connectedAddress !== undefined ? { connectedAddress: wire.connectedAddress } : {}),
      };
    }
  } finally {
    clearTimeout(timer);
    if (options.signal) options.signal.removeEventListener("abort", onExternalAbort);
    release?.();
  }
}

// ---------------------------------------------------------------------------
// Multi-mirror bounded parallel / hedged verified fetcher
// ---------------------------------------------------------------------------

export type RangeReadStrategy = "sequential" | "hedged";

export interface VerifiedRangeFetchOptions extends Bep52VerificationPlan {
  /** Ordered HTTPS web-seed / mirror URLs (at least one, no duplicates). */
  readonly mirrors: readonly string[];
  /** Parallel pieces in flight (1..8, default 2). Keeps RAM O(pieceLength * concurrency). */
  readonly concurrency?: number;
  /** Per-piece mirror failover strategy (default "hedged" when >1 mirror, else "sequential"). */
  readonly readStrategy?: RangeReadStrategy;
  /** Delay before launching backup mirror in hedged mode (default 250 ms). */
  readonly hedgeDelayMs?: number;
  /** Max concurrent mirror attempts per single piece (1..4, default 2). */
  readonly maxConcurrentPerPiece?: number;
  /** Total HTTP hop budget across the entire transfer (default min(2048, max(pieceCount*3, 8))). */
  readonly maxRequests?: number;
  /** Consecutive transient errors before disqualifying a mirror (default 3). */
  readonly maxMirrorErrors?: number;
  /** Max redirects per request (default 1, hard max 2 per section 7.4). */
  readonly maxRedirects?: number;
  /** Per-request timeout in ms (default 15,000). */
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly allowUrl?: (url: URL) => boolean;
  readonly lookup?: SafeNetDnsLookup;
  readonly requestOnce?: SafeNetRequestOnce;
  readonly admission?: SafeNetAdmissionGate;
}

export interface MirrorReceipt {
  readonly url: string;
  readonly requests: number;
  readonly redirects: number;
  readonly verifiedPieces: number;
  readonly corruptPieces: number;
  readonly statusNot206: number;
  readonly errors: number;
  readonly disqualifiedReason: string | null;
}

export interface VerifiedPieceChunk {
  readonly pieceIndex: number;
  readonly offset: number;
  readonly bytes: Uint8Array;
  readonly mirrorUrl: string;
  readonly finalUrl: string;
  readonly redirects: number;
  /** True: passed BEP 52 piece-layer verification. */
  readonly pieceVerified: true;
  /**
   * False until the stream finishes and returns `VerifiedFetchReceipt` with
   * full-file `size` and `sha256` acceptance (Consumer Rule section 9.4).
   */
  readonly accepted: false;
}

export interface VerifiedFetchReceipt {
  readonly accepted: true;
  readonly size: number;
  readonly sha256: string;
  readonly piecesRoot: string;
  readonly pieceLength: number;
  readonly pieceCount: number;
  readonly totalRequests: number;
  readonly mirrors: readonly MirrorReceipt[];
}

interface MirrorState {
  readonly url: string;
  requests: number;
  redirects: number;
  verifiedPieces: number;
  corruptPieces: number;
  statusNot206: number;
  errors: number;
  consecutiveErrors: number;
  disqualifiedReason: string | null;
}

interface InternalPieceResult {
  readonly pieceIndex: number;
  readonly offset: number;
  readonly bytes: Uint8Array;
  readonly mirrorUrl: string;
  readonly finalUrl: string;
  readonly redirects: number;
}

function classifyImmediateDisqualification(error: unknown): string | null {
  if (error instanceof TransportHintsFetchError) {
    if (error.code === "status_not_206" && error.details?.isFull200 === true) {
      return "mirror_returned_200_not_range";
    }
    if (error.code === "invalid_content_encoding") return "mirror_non_identity_encoding";
    if (error.code === "redirect_refused") return "mirror_redirect_refused";
    if (error.code === "connected_address_mismatch") return "mirror_address_mismatch";
    if (error.code === "piece_hash_mismatch") return "mirror_served_corrupt_piece";
  }
  if (error instanceof SafeNetError) {
    if (
      error.code === "safe_net_destination_not_public"
      || error.code === "safe_net_protocol_not_allowed"
      || error.code === "safe_net_url_credentials_forbidden"
      || error.code === "safe_net_connected_address_mismatch"
    ) {
      return `mirror_${error.code}`;
    }
  }
  return null;
}

function validateMirrors(
  mirrors: readonly string[],
  allowUrl?: (url: URL) => boolean,
): MirrorState[] {
  if (!Array.isArray(mirrors) || mirrors.length === 0) {
    throw new TransportHintsFetchError("no_valid_mirrors", "mirrors must contain at least one HTTPS URL");
  }
  const seen = new Set<string>();
  const states: MirrorState[] = [];
  for (const raw of mirrors) {
    if (typeof raw !== "string") {
      throw new TransportHintsFetchError("invalid_options", "mirror URL must be a string");
    }
    const parsed = assertSafeNetUrl(raw, { protocols: ["https:"] });
    if (allowUrl && !allowUrl(parsed)) {
      throw new TransportHintsFetchError(
        "redirect_refused",
        `mirror URL refused by egress policy: ${parsed.origin}${parsed.pathname}`,
      );
    }
    if (seen.has(parsed.href)) {
      throw new TransportHintsFetchError("invalid_options", `duplicate mirror URL: ${parsed.href}`);
    }
    seen.add(parsed.href);
    states.push({
      url: parsed.href,
      requests: 0,
      redirects: 0,
      verifiedPieces: 0,
      corruptPieces: 0,
      statusNot206: 0,
      errors: 0,
      consecutiveErrors: 0,
      disqualifiedReason: null,
    });
  }
  return states;
}

function snapshotMirrors(mirrors: readonly MirrorState[]): readonly MirrorReceipt[] {
  return Object.freeze(
    mirrors.map((m) =>
      Object.freeze({
        url: m.url,
        requests: m.requests,
        redirects: m.redirects,
        verifiedPieces: m.verifiedPieces,
        corruptPieces: m.corruptPieces,
        statusNot206: m.statusNot206,
        errors: m.errors,
        disqualifiedReason: m.disqualifiedReason,
      }),
    ),
  );
}

/**
 * Stream verified pieces strictly in order `0 .. pieceCount - 1` using bounded
 * concurrency (`O(pieceLength * concurrency)` RAM) and capped request budgets.
 *
 * Each yielded chunk has passed BEP 52 piece-layer verification, but is NOT
 * accepted until the generator completes and returns `VerifiedFetchReceipt`
 * after checking full-file `size` and `expectedSha256` (Consumer Rule 9.4).
 */
export async function* fetchVerifiedArtifactStream(
  options: VerifiedRangeFetchOptions,
): AsyncGenerator<VerifiedPieceChunk, VerifiedFetchReceipt, void> {
  const plan = validateBep52Plan(options);
  const mirrors = validateMirrors(options.mirrors, options.allowUrl);

  const concurrency = options.concurrency ?? DEFAULT_RANGE_CONCURRENCY;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > MAX_RANGE_CONCURRENCY) {
    throw new TransportHintsFetchError(
      "invalid_options",
      `concurrency must be an integer in [1, ${MAX_RANGE_CONCURRENCY}]`,
    );
  }
  const readStrategy: RangeReadStrategy = options.readStrategy ?? (mirrors.length > 1 ? "hedged" : "sequential");
  if (readStrategy !== "sequential" && readStrategy !== "hedged") {
    throw new TransportHintsFetchError("invalid_options", `unsupported readStrategy: ${String(readStrategy)}`);
  }
  const hedgeDelayMs = options.hedgeDelayMs ?? DEFAULT_HEDGE_DELAY_MS;
  if (!Number.isSafeInteger(hedgeDelayMs) || hedgeDelayMs < 0 || hedgeDelayMs > MAX_HEDGE_DELAY_MS) {
    throw new TransportHintsFetchError(
      "invalid_options",
      `hedgeDelayMs must be an integer in [0, ${MAX_HEDGE_DELAY_MS}]`,
    );
  }
  const maxConcurrentPerPiece = options.maxConcurrentPerPiece ?? DEFAULT_MAX_CONCURRENT_PER_PIECE;
  if (
    !Number.isSafeInteger(maxConcurrentPerPiece)
    || maxConcurrentPerPiece < 1
    || maxConcurrentPerPiece > MAX_CONCURRENT_PER_PIECE
  ) {
    throw new TransportHintsFetchError(
      "invalid_options",
      `maxConcurrentPerPiece must be an integer in [1, ${MAX_CONCURRENT_PER_PIECE}]`,
    );
  }
  const defaultBudget = Math.min(2_048, Math.max(plan.pieceCount * 3, 8));
  const maxRequests = options.maxRequests ?? defaultBudget;
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1 || maxRequests > HARD_MAX_REQUEST_BUDGET) {
    throw new TransportHintsFetchError(
      "invalid_options",
      `maxRequests must be an integer in [1, ${HARD_MAX_REQUEST_BUDGET}]`,
    );
  }
  const maxMirrorErrors = options.maxMirrorErrors ?? DEFAULT_MAX_MIRROR_ERRORS;
  if (!Number.isSafeInteger(maxMirrorErrors) || maxMirrorErrors < 1 || maxMirrorErrors > 100) {
    throw new TransportHintsFetchError("invalid_options", "maxMirrorErrors must be an integer in [1, 100]");
  }
  const maxRedirects = options.maxRedirects ?? DEFAULT_RANGE_MAX_REDIRECTS;
  if (!Number.isSafeInteger(maxRedirects) || maxRedirects < 0 || maxRedirects > HARD_MAX_RANGE_REDIRECTS) {
    throw new TransportHintsFetchError(
      "invalid_options",
      `maxRedirects must be an integer in [0, ${HARD_MAX_RANGE_REDIRECTS}]`,
    );
  }
  const timeoutMs = options.timeoutMs ?? SAFE_NET_DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new TransportHintsFetchError("invalid_options", "timeoutMs must be an integer in [1, 120000]");
  }

  let remainingRequests = maxRequests;
  let totalRequests = 0;

  const consumeBudget = (mirror: MirrorState): void => {
    if (remainingRequests <= 0) {
      throw new TransportHintsFetchError(
        "request_budget_exhausted",
        `exceeded maxRequests budget (${maxRequests})`,
        { maxRequests, totalRequests },
      );
    }
    remainingRequests -= 1;
    totalRequests += 1;
    mirror.requests += 1;
  };

  const runController = new AbortController();
  const onExternalAbort = (): void => {
    runController.abort(
      options.signal?.reason instanceof Error
        ? options.signal.reason
        : new TransportHintsFetchError("aborted", "artifact fetch aborted by caller"),
    );
  };
  if (options.signal?.aborted) onExternalAbort();
  else options.signal?.addEventListener("abort", onExternalAbort, { once: true });

  const fetchOnePieceFromMirror = async (
    mirror: MirrorState,
    pieceIndex: number,
    first: number,
    last: number,
    pieceSignal: AbortSignal,
  ): Promise<InternalPieceResult> => {
    try {
      const response = await fetchSafeHttpsRange({
        url: mirror.url,
        first,
        last,
        totalSize: plan.size,
        maxRedirects,
        timeoutMs,
        signal: pieceSignal,
        allowUrl: options.allowUrl,
        lookup: options.lookup,
        requestOnce: options.requestOnce,
        admission: options.admission,
        onBeforeHop: () => consumeBudget(mirror),
      });
      if (!verifyBep52Piece(plan, pieceIndex, response.bytes)) {
        mirror.corruptPieces += 1;
        mirror.disqualifiedReason ??= "mirror_served_corrupt_piece";
        throw new TransportHintsFetchError(
          "piece_hash_mismatch",
          `piece ${pieceIndex} from ${mirror.url} failed BEP 52 hash check`,
          { pieceIndex, mirrorUrl: mirror.url },
        );
      }
      mirror.verifiedPieces += 1;
      mirror.redirects += response.redirects;
      mirror.consecutiveErrors = 0;
      return {
        pieceIndex,
        offset: first,
        bytes: response.bytes,
        mirrorUrl: mirror.url,
        finalUrl: response.finalUrl,
        redirects: response.redirects,
      };
    } catch (error) {
      if (pieceSignal.aborted || runController.signal.aborted) {
        // Aborted by caller or because a sibling hedged mirror won — do not penalize this mirror.
        throw error;
      }
      if (error instanceof TransportHintsFetchError && error.code === "request_budget_exhausted") {
        throw error;
      }
      if (error instanceof TransportHintsFetchError && error.code === "status_not_206") {
        mirror.statusNot206 += 1;
      }
      if (!(error instanceof TransportHintsFetchError && error.code === "piece_hash_mismatch")) {
        mirror.errors += 1;
        mirror.consecutiveErrors += 1;
      }
      const immediate = classifyImmediateDisqualification(error);
      if (immediate !== null) {
        mirror.disqualifiedReason ??= immediate;
      } else if (mirror.consecutiveErrors >= maxMirrorErrors) {
        mirror.disqualifiedReason ??= `mirror_exceeded_${maxMirrorErrors}_consecutive_errors`;
      }
      throw error;
    }
  };

  const fetchPiece = async (pieceIndex: number): Promise<InternalPieceResult> => {
    if (runController.signal.aborted) {
      throw runController.signal.reason instanceof Error
        ? runController.signal.reason
        : new TransportHintsFetchError("aborted", "artifact fetch aborted");
    }
    const [first, last] = pieceByteRange(plan, pieceIndex);
    const candidates = mirrors.filter((m) => m.disqualifiedReason === null);
    if (candidates.length === 0) {
      throw new TransportHintsFetchError(
        "all_mirrors_failed",
        `no eligible mirrors left for piece ${pieceIndex}`,
        { pieceIndex, mirrors: snapshotMirrors(mirrors) },
      );
    }

    if (readStrategy === "sequential" || candidates.length === 1 || maxConcurrentPerPiece === 1) {
      let lastError: unknown;
      for (const mirror of candidates) {
        if (mirror.disqualifiedReason !== null) continue;
        try {
          return await fetchOnePieceFromMirror(mirror, pieceIndex, first, last, runController.signal);
        } catch (error) {
          if (
            runController.signal.aborted
            || (error instanceof TransportHintsFetchError && error.code === "request_budget_exhausted")
          ) {
            throw error;
          }
          lastError = error;
        }
      }
      throw new TransportHintsFetchError(
        "all_mirrors_failed",
        `all mirrors failed for piece ${pieceIndex}`,
        { pieceIndex, cause: lastError, mirrors: snapshotMirrors(mirrors) },
      );
    }

    // Hedged strategy: launch mirror 0, stagger subsequent mirrors by hedgeDelayMs
    // up to maxConcurrentPerPiece, fail over immediately on any mirror failure,
    // and abort losing mirrors immediately on first BEP 52 verified hit.
    return await new Promise<InternalPieceResult>((resolve, reject) => {
      const groupController = new AbortController();
      const onRunAbort = (): void => {
        groupController.abort(runController.signal.reason);
      };
      if (runController.signal.aborted) onRunAbort();
      else runController.signal.addEventListener("abort", onRunAbort, { once: true });

      let settled = false;
      let nextIndex = 0;
      let inFlight = 0;
      let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
      let lastError: unknown;
      const tasks: Promise<void>[] = [];

      const cleanup = (): void => {
        if (hedgeTimer !== undefined) {
          clearTimeout(hedgeTimer);
          hedgeTimer = undefined;
        }
        runController.signal.removeEventListener("abort", onRunAbort);
      };

      const finishResolve = (result: InternalPieceResult): void => {
        if (settled) return;
        settled = true;
        cleanup();
        groupController.abort(new TransportHintsFetchError("aborted", "hedged sibling won"));
        void Promise.allSettled(tasks);
        resolve(result);
      };

      const finishReject = (error: unknown): void => {
        if (settled) return;
        settled = true;
        cleanup();
        groupController.abort(error);
        void Promise.allSettled(tasks);
        reject(error);
      };

      const scheduleNextHedge = (): void => {
        if (settled || hedgeTimer !== undefined) return;
        if (nextIndex >= candidates.length || inFlight >= maxConcurrentPerPiece) return;
        hedgeTimer = setTimeout(() => {
          hedgeTimer = undefined;
          launchOne();
        }, hedgeDelayMs);
      };

      const launchOne = (): void => {
        if (settled) return;
        if (runController.signal.aborted) {
          finishReject(
            runController.signal.reason instanceof Error
              ? runController.signal.reason
              : new TransportHintsFetchError("aborted", "artifact fetch aborted"),
          );
          return;
        }
        while (nextIndex < candidates.length && candidates[nextIndex]!.disqualifiedReason !== null) {
          nextIndex += 1;
        }
        if (nextIndex >= candidates.length) {
          if (inFlight === 0) {
            finishReject(
              new TransportHintsFetchError(
                "all_mirrors_failed",
                `all mirrors failed for piece ${pieceIndex}`,
                { pieceIndex, cause: lastError, mirrors: snapshotMirrors(mirrors) },
              ),
            );
          }
          return;
        }

        const mirror = candidates[nextIndex]!;
        nextIndex += 1;
        inFlight += 1;

        const task = fetchOnePieceFromMirror(mirror, pieceIndex, first, last, groupController.signal)
          .then((result) => {
            finishResolve(result);
          })
          .catch((error) => {
            inFlight -= 1;
            if (settled) return;
            if (
              runController.signal.aborted
              || (error instanceof TransportHintsFetchError && error.code === "request_budget_exhausted")
            ) {
              finishReject(error);
              return;
            }
            lastError = error;
            // Immediate failover without waiting for hedgeDelayMs.
            if (hedgeTimer !== undefined) {
              clearTimeout(hedgeTimer);
              hedgeTimer = undefined;
            }
            launchOne();
          });
        tasks.push(task);
        scheduleNextHedge();
      };

      launchOne();
    });
  };

  const window = new Map<number, Promise<InternalPieceResult>>();
  let nextToSchedule = 0;

  const fillWindow = (): void => {
    while (nextToSchedule < plan.pieceCount && window.size < concurrency) {
      const idx = nextToSchedule;
      nextToSchedule += 1;
      const task = fetchPiece(idx);
      // Prevent unhandled rejection if a later piece rejects while awaiting an earlier one.
      task.catch(() => {});
      window.set(idx, task);
    }
  };

  const fullHash = createHash("sha256");
  let totalBytes = 0;

  try {
    fillWindow();
    for (let pieceIndex = 0; pieceIndex < plan.pieceCount; pieceIndex += 1) {
      const task = window.get(pieceIndex)!;
      const result = await task;
      window.delete(pieceIndex);
      fillWindow();

      fullHash.update(result.bytes);
      totalBytes += result.bytes.byteLength;

      yield {
        pieceIndex: result.pieceIndex,
        offset: result.offset,
        bytes: result.bytes,
        mirrorUrl: result.mirrorUrl,
        finalUrl: result.finalUrl,
        redirects: result.redirects,
        pieceVerified: true,
        accepted: false,
      };
    }

    if (totalBytes !== plan.size) {
      throw new TransportHintsFetchError(
        "final_size_mismatch",
        `reassembled size ${totalBytes} != authoritative size ${plan.size}`,
        { expected: plan.size, actual: totalBytes },
      );
    }
    const actualSha256 = fullHash.digest("hex");
    if (actualSha256 !== plan.expectedSha256) {
      throw new TransportHintsFetchError(
        "final_sha256_mismatch",
        `full-file SHA-256 ${actualSha256} != authoritative ${plan.expectedSha256} (piecesRoot is not acceptance per Consumer Rule 9.4)`,
        { expected: plan.expectedSha256, actual: actualSha256 },
      );
    }

    return Object.freeze({
      accepted: true,
      size: plan.size,
      sha256: actualSha256,
      piecesRoot: Buffer.from(plan.piecesRoot).toString("hex"),
      pieceLength: plan.pieceLength,
      pieceCount: plan.pieceCount,
      totalRequests,
      mirrors: snapshotMirrors(mirrors),
    });
  } finally {
    runController.abort(new TransportHintsFetchError("aborted", "artifact stream closed"));
    if (options.signal) options.signal.removeEventListener("abort", onExternalAbort);
    await Promise.allSettled([...window.values()]);
    window.clear();
  }
}

export interface BufferedVerifiedFetchOptions extends VerifiedRangeFetchOptions {
  /** Cap for buffering whole artifact in RAM (default 64 MiB). */
  readonly maxInMemoryBytes?: number;
}

/**
 * Convenience helper that buffers a bounded artifact in memory and returns
 * `{ bytes, receipt }` ONLY after every BEP 52 piece AND full-file authoritative
 * `size` + `expectedSha256` pass (Consumer Rule section 9.4).
 */
export async function fetchVerifiedArtifact(
  options: BufferedVerifiedFetchOptions,
): Promise<{ readonly bytes: Uint8Array; readonly receipt: VerifiedFetchReceipt }> {
  const maxInMemoryBytes = options.maxInMemoryBytes ?? DEFAULT_MAX_IN_MEMORY_BYTES;
  if (!Number.isSafeInteger(maxInMemoryBytes) || maxInMemoryBytes < 1) {
    throw new TransportHintsFetchError("invalid_options", "maxInMemoryBytes must be a positive integer");
  }
  const plan = validateBep52Plan(options);
  if (plan.size > maxInMemoryBytes) {
    throw new TransportHintsFetchError(
      "artifact_too_large",
      `artifact size ${plan.size} exceeds maxInMemoryBytes ${maxInMemoryBytes}; use fetchVerifiedArtifactStream instead`,
      { size: plan.size, maxInMemoryBytes },
    );
  }

  const out = new Uint8Array(plan.size);
  const stream = fetchVerifiedArtifactStream(options);
  while (true) {
    const step = await stream.next();
    if (step.done) {
      return { bytes: out, receipt: step.value };
    }
    out.set(step.value.bytes, step.value.offset);
  }
}
