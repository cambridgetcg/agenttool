#!/usr/bin/env bun

/**
 * Pure-hash builder for transport-hints/v1, profile single-file-hybrid/1
 * (docs/specs/TRANSPORT-HINTS-0.1-DRAFT.md, sections 4, 5 and 7).
 *
 * One pass over the subject's bytes computes the whole-file SHA-256, the
 * SHA-256 of every 16 KiB block (the BEP 52 merkle leaves) and the SHA-1 of
 * every piece (the BEP 3 'pieces'). From those it writes the profile's
 * .torrent and the artifact descriptor in the draft's one serialisation. It
 * refuses to write anything when the bytes' size or SHA-256 differ from the
 * expected values, and it checks its own .torrent against the profile before
 * writing it.
 *
 * Zero dependencies: node: built-ins only. It opens no network connection,
 * never speaks the BitTorrent wire protocol and never probes a web seed; the
 * url-list is an explicit input. Its output is not a publication: nothing is
 * uploaded, and the draft forbids publishing an identifier of a real file
 * before the profile is frozen.
 *
 * The piece length always comes from the profile rule (draft section 7.3).
 * An explicit piece length exists only for test vectors: with it the output is
 * marked as a test vector and no descriptor is ever written.
 *
 * Tests: bin/tests/transport-hints.test.ts. Vectors: bin/transport-hints-vectors.ts.
 *
 * Usage:
 *   bin/build-transport-hints.ts build --request <request.json> --input <file|-> \
 *     --torrent-out <name.torrent> [--descriptor-out <name.transport.json>]
 *   bin/build-transport-hints.ts build --request <request.json> --input <file|-> \
 *     --torrent-out <name.test-vector.torrent> --test-vector-piece-length <bytes>
 *   bin/build-transport-hints.ts check-descriptor <descriptor.json> [--input <file|->]
 *
 * The request is one JSON object: {subject: {filename, size, sha256}, name,
 * url_list, authority, home, license, notices}. The last four are needed only
 * with --descriptor-out. Outputs are created new and never overwritten.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

export const PROTOCOL = "transport-hints/v1" as const;
export const DOCUMENT_TYPE = "artifact-descriptor" as const;
export const PROFILE = "single-file-hybrid/1" as const;
export const RECALL = "none" as const;

/** BEP 52: the merkle tree is built over 16 KiB blocks. */
export const BLOCK_SIZE = 16_384;
export const MIN_PIECE_LENGTH = 16_384;
export const MAX_PIECE_LENGTH = 16_777_216;
/** The profile's target: at most this many pieces, until the 16 MiB cap. */
export const TARGET_MAX_PIECES = 1_024;
export const PIECE_LENGTHS = [
  16384, 32768, 65536, 131072, 262144, 524288, 1048576, 2097152, 4194304, 8388608, 16777216,
] as const;

/** The info dictionary's keys, sorted as raw bytes (draft section 7.1). */
export const INFO_KEYS = ["file tree", "length", "meta version", "name", "piece length", "pieces"] as const;
/** The top level's keys, sorted as raw bytes (draft section 7.1). */
export const TOP_LEVEL_KEYS = ["info", "piece layers", "url-list"] as const;
/** Keys the profile names as forbidden at either level; every other extra key is refused too. */
export const FORBIDDEN_KEYS = [
  "announce", "announce-list", "nodes", "httpseeds", "comment", "created by", "creation date",
] as const;

/**
 * Patterns copied from docs/specs/transport-hints-v1.schema.json. The test
 * requires each to equal the schema's pattern text, so the builder cannot
 * drift from the schema.
 */
export const SCHEMA_PATTERNS = {
  sha256Hex: String.raw`^[0-9a-f]{64}$`,
  httpsUrl: String.raw`^https://(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?/(?!(?:.*/)?\.\.?(?:/|$))(?:[A-Za-z0-9._~!$&'()*+,;=:@/-]|%[0-9A-F]{2})*$`,
  webSeedEnd: String.raw`[^/]$`,
  bareFilename: String.raw`^[A-Za-z0-9][A-Za-z0-9._+-]*$`,
  torrentName: String.raw`^(?!(?:[Cc][Oo][Nn]|[Pp][Rr][Nn]|[Aa][Uu][Xx]|[Nn][Uu][Ll]|[Cc][Oo][Mm][0-9]|[Ll][Pp][Tt][0-9])(?:\.|$))[A-Za-z0-9](?:[A-Za-z0-9._+-]*[A-Za-z0-9])?$`,
  memberPath: String.raw`^(?:(?!\.\.?/)[A-Za-z0-9._+-]+/)*(?!\.\.?$)[A-Za-z0-9._+-]+$`,
  spdxLicenseId: String.raw`^(?!(?:NONE|NOASSERTION)$)(?!(?:LicenseRef|DocumentRef)-)[A-Za-z0-9](?:[A-Za-z0-9.+-]*[A-Za-z0-9+])?$`,
  jsonPointer: String.raw`^(?:/(?:[A-Za-z0-9._+@:-]|~[01])*)+$`,
  hfResolveUrl: String.raw`^https://huggingface\.co/(?:datasets/)?[A-Za-z0-9](?:[A-Za-z0-9._-]{0,94}[A-Za-z0-9])?/[A-Za-z0-9](?:[A-Za-z0-9._-]{0,94}[A-Za-z0-9])?/resolve/[0-9a-f]{40}/[^/]`,
} as const;

const RE = Object.fromEntries(
  Object.entries(SCHEMA_PATTERNS).map(([key, source]) => [key, new RegExp(source, "u")]),
) as { readonly [K in keyof typeof SCHEMA_PATTERNS]: RegExp };

/** Object key order of the draft's section 5.2 (and of the schema's properties). */
export const DESCRIPTOR_KEY_ORDER = {
  descriptor: ["protocol", "document_type", "subject", "authority", "home", "license", "notices", "bittorrent", "recall"],
  subject: ["filename", "size", "sha256"],
  "love-package/v1": ["kind", "url", "pointer"],
  "json-pointer": ["kind", "url", "pointer"],
  "hf-resolve-etag": ["kind", "url", "header"],
  "sums-line": ["kind", "url"],
  "none-prior": ["kind"],
  notices: ["inside_subject", "beside_subject"],
  noticeFile: ["filename", "size", "sha256", "url"],
  bittorrent: ["profile", "name", "piece_length", "pieces_root", "btih", "btmh"],
} as const;

// ---------------------------------------------------------------------------
// Small helpers

const encoder = new TextEncoder();
const utf8 = (text: string): Uint8Array => encoder.encode(text);
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

function sha256(...parts: Uint8Array[]): Uint8Array {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return new Uint8Array(hash.digest());
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function isPowerOfTwo(n: number): boolean {
  return Number.isSafeInteger(n) && n > 0 && nextPowerOfTwo(n) === n;
}

function fail(message: string): never {
  throw new Error(message);
}

function assertSize(size: number, label = "size"): void {
  if (!Number.isSafeInteger(size) || size < 1) {
    fail(`${label} must be an integer from 1 to 2^53 - 1 (empty files are out of scope)`);
  }
}

function assertPieceLength(pieceLength: number): void {
  if (!(PIECE_LENGTHS as readonly number[]).includes(pieceLength)) {
    fail(`piece length ${pieceLength} is not a power of two from 16 KiB to 16 MiB`);
  }
}

// ---------------------------------------------------------------------------
// Piece length (draft section 7.3)

/** The smallest power of two from 16 KiB giving at most 1,024 pieces, capped at 16 MiB. */
export function profilePieceLength(size: number): number {
  assertSize(size);
  let length = MIN_PIECE_LENGTH;
  while (length < MAX_PIECE_LENGTH && Math.ceil(size / length) > TARGET_MAX_PIECES) length *= 2;
  return length;
}

export function pieceCount(size: number, pieceLength: number): number {
  return Math.ceil(size / pieceLength);
}

// ---------------------------------------------------------------------------
// BEP 52 merkle tree

const ZERO_HASH = new Uint8Array(32);
const PAD_HASHES: Uint8Array[] = [ZERO_HASH];

/**
 * The root of a subtree of the given height whose leaves all lie beyond the
 * end of the file. BEP 52: "The remaining leaf hashes beyond the end of the
 * file required to construct upper layers of the merkle tree are set to zero."
 * Height 0 is the zero leaf itself (32 zero bytes); each height above hashes
 * two copies of the one below.
 */
export function padHash(height: number): Uint8Array {
  if (!Number.isInteger(height) || height < 0 || height > 63) fail(`bad pad height ${height}`);
  while (PAD_HASHES.length <= height) {
    const below = PAD_HASHES[PAD_HASHES.length - 1]!;
    PAD_HASHES.push(sha256(below, below));
  }
  return PAD_HASHES[height]!;
}

/** Root of a binary SHA-256 merkle tree over a power-of-two count of 32-byte nodes. */
export function merkleRoot(nodes: readonly Uint8Array[]): Uint8Array {
  if (!isPowerOfTwo(nodes.length)) fail("a merkle layer must hold a power-of-two count of hashes");
  let layer: Uint8Array[] = [...nodes];
  while (layer.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < layer.length; i += 2) next.push(sha256(layer[i]!, layer[i + 1]!));
    layer = next;
  }
  return layer[0]!;
}

function padTo(nodes: readonly Uint8Array[], count: number, filler: Uint8Array): Uint8Array[] {
  const out = [...nodes];
  while (out.length < count) out.push(filler);
  return out;
}

export interface SubjectHashes {
  readonly size: number;
  readonly pieceLength: number;
  /** Lowercase hex SHA-256 of the whole file. */
  readonly sha256: string;
  /** BEP 3 'pieces': the SHA-1 of each piece in order; the last piece unpadded. */
  readonly pieces: Uint8Array;
  /** BEP 52 'pieces root'. */
  readonly piecesRoot: Uint8Array;
  /** BEP 52 piece layer (one 32-byte hash per piece), or null when size <= piece length. */
  readonly pieceLayer: Uint8Array | null;
}

/**
 * One pass over the bytes. Blocks never straddle a piece boundary because a
 * piece length is a multiple of the block size.
 */
export class SubjectHasher {
  readonly pieceLength: number;
  readonly #blocksPerPiece: number;
  #whole = createHash("sha256");
  #block = createHash("sha256");
  #blockFill = 0;
  #piece = createHash("sha1");
  #pieceFill = 0;
  #size = 0;
  #leaves: Uint8Array[] = [];
  #pieceRoots: Uint8Array[] = [];
  #v1: Uint8Array[] = [];
  #done = false;

  constructor(pieceLength: number) {
    assertPieceLength(pieceLength);
    this.pieceLength = pieceLength;
    this.#blocksPerPiece = pieceLength / BLOCK_SIZE;
  }

  get size(): number {
    return this.#size;
  }

  update(chunk: Uint8Array): void {
    if (this.#done) fail("the hasher has already finished");
    if (this.#size + chunk.length > Number.MAX_SAFE_INTEGER) fail("the subject is larger than 2^53 - 1 bytes");
    let offset = 0;
    while (offset < chunk.length) {
      const take = Math.min(chunk.length - offset, BLOCK_SIZE - this.#blockFill);
      const part = chunk.subarray(offset, offset + take);
      this.#whole.update(part);
      this.#block.update(part);
      this.#piece.update(part);
      this.#blockFill += take;
      this.#pieceFill += take;
      this.#size += take;
      offset += take;
      if (this.#blockFill === BLOCK_SIZE) this.#closeBlock();
      if (this.#pieceFill === this.pieceLength) this.#closeFullPiece();
    }
  }

  #closeBlock(): void {
    // BEP 52: a leaf is the SHA-256 of one 16 KiB block; "The last block may
    // be shorter than 16KiB" and is hashed as it is, unpadded.
    this.#leaves.push(new Uint8Array(this.#block.digest()));
    this.#block = createHash("sha256");
    this.#blockFill = 0;
  }

  #closeFullPiece(): void {
    this.#v1.push(new Uint8Array(this.#piece.digest()));
    this.#piece = createHash("sha1");
    this.#pieceFill = 0;
    this.#pieceRoots.push(merkleRoot(this.#leaves));
    this.#leaves = [];
  }

  digest(): SubjectHashes {
    if (this.#done) fail("the hasher has already finished");
    this.#done = true;
    if (this.#size === 0) fail("empty subjects are out of scope: BEP 52 gives an empty file no pieces root");
    if (this.#blockFill > 0) this.#closeBlock();
    const sha = this.#whole.digest("hex");
    if (this.#pieceFill > 0) {
      // BEP 3: the last piece "may be truncated"; its SHA-1 covers only the
      // remaining bytes, with no padding.
      this.#v1.push(new Uint8Array(this.#piece.digest()));
      if (this.#pieceRoots.length === 0) {
        // A file smaller than one piece: the tree is only as large as its own
        // blocks need (zero leaves up to the next power of two), as BEP 52's
        // reference creator builds it. There is no piece layer entry.
        const leaves = padTo(this.#leaves, nextPowerOfTwo(this.#leaves.length), ZERO_HASH);
        return this.#result(sha, merkleRoot(leaves), null);
      }
      // The last piece of a longer file: its subtree is padded with zero
      // leaves to a full piece, so that one layer hash covers one piece.
      this.#pieceRoots.push(merkleRoot(padTo(this.#leaves, this.#blocksPerPiece, ZERO_HASH)));
      this.#leaves = [];
    }
    if (this.#pieceRoots.length === 1) {
      // Exactly one full piece: the root is that piece's subtree root.
      return this.#result(sha, this.#pieceRoots[0]!, null);
    }
    // More than one piece: the layer is balanced with the pad hash of a whole
    // piece-sized subtree of zero leaves. Those balancing hashes are omitted
    // from 'piece layers' (BEP 52: "Layer hashes which exclusively cover data
    // beyond the end of file ... are omitted").
    const height = Math.log2(this.#blocksPerPiece);
    const balanced = padTo(this.#pieceRoots, nextPowerOfTwo(this.#pieceRoots.length), padHash(height));
    return this.#result(sha, merkleRoot(balanced), concatBytes(this.#pieceRoots));
  }

  #result(sha: string, piecesRoot: Uint8Array, pieceLayer: Uint8Array | null): SubjectHashes {
    return {
      size: this.#size,
      pieceLength: this.pieceLength,
      sha256: sha,
      pieces: concatBytes(this.#v1),
      piecesRoot,
      pieceLayer,
    };
  }
}

export function hashSubject(bytes: Uint8Array, pieceLength: number): SubjectHashes {
  const hasher = new SubjectHasher(pieceLength);
  hasher.update(bytes);
  return hasher.digest();
}

export async function hashChunks(
  chunks: AsyncIterable<Uint8Array | string>,
  pieceLength: number,
): Promise<SubjectHashes> {
  const hasher = new SubjectHasher(pieceLength);
  for await (const chunk of chunks) {
    if (typeof chunk === "string") fail("the input stream must yield bytes");
    hasher.update(chunk);
  }
  return hasher.digest();
}

/** Recompute a pieces root from a piece layer, as a verifier does (BEP 52). */
export function rootFromPieceLayer(pieceLayer: Uint8Array, pieceLength: number): Uint8Array {
  if (pieceLayer.length === 0 || pieceLayer.length % 32 !== 0) fail("a piece layer is a non-empty run of 32-byte hashes");
  const nodes: Uint8Array[] = [];
  for (let i = 0; i < pieceLayer.length; i += 32) nodes.push(pieceLayer.subarray(i, i + 32));
  const height = Math.log2(pieceLength / BLOCK_SIZE);
  return merkleRoot(padTo(nodes, nextPowerOfTwo(nodes.length), padHash(height)));
}

// ---------------------------------------------------------------------------
// Bencoding (BEP 3)

export type BencodeValue = number | string | Uint8Array | readonly BencodeValue[] | BencodeDict;

/** A bencoded dictionary. Keys are sorted as raw bytes; duplicates are refused. */
export class BencodeDict {
  readonly entries: ReadonlyArray<readonly [Uint8Array, BencodeValue]>;

  constructor(entries: Iterable<readonly [Uint8Array | string, BencodeValue]>) {
    const list: Array<readonly [Uint8Array, BencodeValue]> = [];
    for (const [key, value] of entries) list.push([typeof key === "string" ? utf8(key) : key, value]);
    list.sort((a, b) => compareBytes(a[0], b[0]));
    for (let i = 1; i < list.length; i += 1) {
      if (compareBytes(list[i - 1]![0], list[i]![0]) === 0) fail("duplicate bencode dictionary key");
    }
    this.entries = list;
  }
}

export function bencode(value: BencodeValue): Uint8Array {
  const parts: Uint8Array[] = [];
  const visit = (item: BencodeValue): void => {
    if (typeof item === "number") {
      if (!Number.isSafeInteger(item)) fail("bencode integers must be safe integers");
      parts.push(utf8(`i${item === 0 ? 0 : item}e`));
    } else if (typeof item === "string") {
      const bytes = utf8(item);
      parts.push(utf8(`${bytes.length}:`), bytes);
    } else if (item instanceof Uint8Array) {
      parts.push(utf8(`${item.length}:`), item);
    } else if (item instanceof BencodeDict) {
      parts.push(utf8("d"));
      for (const [key, entry] of item.entries) {
        parts.push(utf8(`${key.length}:`), key);
        visit(entry);
      }
      parts.push(utf8("e"));
    } else if (Array.isArray(item)) {
      parts.push(utf8("l"));
      for (const element of item as readonly BencodeValue[]) visit(element);
      parts.push(utf8("e"));
    } else {
      fail("unsupported bencode value");
    }
  };
  visit(value);
  return concatBytes(parts);
}

export type Decoded =
  | { readonly type: "int"; readonly value: bigint; readonly start: number; readonly end: number }
  | { readonly type: "bytes"; readonly value: Uint8Array; readonly start: number; readonly end: number }
  | { readonly type: "list"; readonly items: readonly Decoded[]; readonly start: number; readonly end: number }
  | {
      readonly type: "dict";
      readonly entries: ReadonlyArray<readonly [Uint8Array, Decoded]>;
      readonly start: number;
      readonly end: number;
    };

/**
 * A strict bdecoder. It refuses what BEP 3 calls invalid (leading zeros,
 * i-0e), unsorted or duplicate dictionary keys, non-string keys, truncation
 * and trailing bytes, and records the byte span of every value so that the
 * info dictionary is hashed exactly as it appears in the file.
 */
export function bdecode(bytes: Uint8Array): Decoded {
  let pos = 0;
  const digitsUntil = (stop: number): string => {
    const end = bytes.indexOf(stop, pos);
    if (end < 0) fail("bencode: truncated");
    const text = Buffer.from(bytes.subarray(pos, end)).toString("latin1");
    pos = end + 1;
    return text;
  };
  const parse = (depth: number): Decoded => {
    if (depth > 32) fail("bencode: nested too deeply");
    if (pos >= bytes.length) fail("bencode: truncated");
    const start = pos;
    const lead = bytes[pos]!;
    if (lead === 0x69) {
      pos += 1;
      const text = digitsUntil(0x65);
      if (!/^(?:0|-?[1-9][0-9]*)$/u.test(text)) fail(`bencode: non-canonical integer '${text}'`);
      return { type: "int", value: BigInt(text), start, end: pos };
    }
    if (lead === 0x6c) {
      pos += 1;
      const items: Decoded[] = [];
      while (pos < bytes.length && bytes[pos] !== 0x65) items.push(parse(depth + 1));
      if (pos >= bytes.length) fail("bencode: truncated");
      pos += 1;
      return { type: "list", items, start, end: pos };
    }
    if (lead === 0x64) {
      pos += 1;
      const entries: Array<readonly [Uint8Array, Decoded]> = [];
      while (pos < bytes.length && bytes[pos] !== 0x65) {
        const key = parse(depth + 1);
        if (key.type !== "bytes") fail("bencode: a dictionary key is not a string");
        const previous = entries[entries.length - 1];
        if (previous && compareBytes(previous[0], key.value) >= 0) {
          fail("bencode: dictionary keys are not strictly sorted as raw bytes");
        }
        entries.push([key.value, parse(depth + 1)]);
      }
      if (pos >= bytes.length) fail("bencode: truncated");
      pos += 1;
      return { type: "dict", entries, start, end: pos };
    }
    if (lead >= 0x30 && lead <= 0x39) {
      const text = digitsUntil(0x3a);
      if (!/^(?:0|[1-9][0-9]*)$/u.test(text)) fail(`bencode: non-canonical string length '${text}'`);
      const length = Number(text);
      if (!Number.isSafeInteger(length) || length > bytes.length - pos) fail("bencode: truncated string");
      const value = bytes.subarray(pos, pos + length);
      pos += length;
      return { type: "bytes", value, start, end: pos };
    }
    fail(`bencode: unexpected byte 0x${lead.toString(16)} at ${pos}`);
  };
  const root = parse(0);
  if (pos !== bytes.length) fail("bencode: trailing bytes after the root value");
  return root;
}

const latin1 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("latin1");

function keyLabel(key: Uint8Array): string {
  return /^[\x20-\x7e]*$/u.test(latin1(key)) ? `'${latin1(key)}'` : `0x${hex(key)}`;
}

function asDict(value: Decoded | undefined, label: string): Extract<Decoded, { type: "dict" }> {
  if (!value || value.type !== "dict") fail(`${label} must be a dictionary`);
  return value;
}

function dictGet(dict: Extract<Decoded, { type: "dict" }>, key: string): Decoded | undefined {
  const wanted = utf8(key);
  return dict.entries.find(([candidate]) => compareBytes(candidate, wanted) === 0)?.[1];
}

function asBytes(value: Decoded | undefined, label: string): Uint8Array {
  if (!value || value.type !== "bytes") fail(`${label} must be a byte string`);
  return value.value;
}

function asInt(value: Decoded | undefined, label: string): number {
  if (!value || value.type !== "int") fail(`${label} must be an integer`);
  if (value.value < 0n || value.value > BigInt(Number.MAX_SAFE_INTEGER)) fail(`${label} is out of range`);
  return Number(value.value);
}

// ---------------------------------------------------------------------------
// Names and URLs

export function assertTorrentName(name: string): void {
  if (typeof name !== "string" || name.length < 1 || name.length > 200 || !RE.torrentName.test(name)) {
    fail(`name '${String(name)}' breaks the name rule of draft section 7.2`);
  }
}

export function isHttpsUrl(url: unknown): url is string {
  return typeof url === "string" && url.length >= 12 && url.length <= 2048 && RE.httpsUrl.test(url);
}

export function assertUrlList(urlList: readonly string[]): void {
  if (!Array.isArray(urlList) || urlList.length < 1) fail("url-list must hold at least one web seed");
  const seen = new Set<string>();
  for (const url of urlList) {
    if (!isHttpsUrl(url) || !RE.webSeedEnd.test(url)) {
      fail(`web seed '${String(url)}' breaks the URL rule (https, lowercase host, no port, query or fragment, never ending in '/')`);
    }
    if (seen.has(url)) fail(`web seed '${url}' is listed twice`);
    seen.add(url);
  }
}

// ---------------------------------------------------------------------------
// The .torrent (draft section 7.1)

export function infoDictionary(hashes: SubjectHashes, name: string): BencodeDict {
  return new BencodeDict([
    ["file tree", new BencodeDict([[name, new BencodeDict([["", new BencodeDict([
      ["length", hashes.size],
      ["pieces root", hashes.piecesRoot],
    ])]])]])],
    ["length", hashes.size],
    ["meta version", 2],
    ["name", name],
    ["piece length", hashes.pieceLength],
    ["pieces", hashes.pieces],
  ]);
}

/** btih is the SHA-1 and btmh the multihash ('1220' + SHA-256) of the bencoded info dictionary. */
export function infohashes(info: Uint8Array): { btih: string; btmh: string } {
  return { btih: createHash("sha1").update(info).digest("hex"), btmh: `1220${sha256Hex(info)}` };
}

export function encodeTorrent(hashes: SubjectHashes, name: string, urlList: readonly string[]): Uint8Array {
  const layers = hashes.pieceLayer
    ? new BencodeDict([[hashes.piecesRoot, hashes.pieceLayer]])
    : new BencodeDict([]);
  return bencode(new BencodeDict([
    ["info", infoDictionary(hashes, name)],
    ["piece layers", layers],
    ["url-list", [...urlList]],
  ]));
}

export interface ProfileTorrent {
  readonly name: string;
  readonly size: number;
  readonly pieceLength: number;
  readonly pieces: Uint8Array;
  readonly piecesRoot: Uint8Array;
  readonly pieceLayer: Uint8Array | null;
  readonly urlList: readonly string[];
  readonly info: Uint8Array;
  readonly btih: string;
  readonly btmh: string;
}

function assertExactKeys(dict: Extract<Decoded, { type: "dict" }>, expected: readonly string[], level: string): void {
  const keys = dict.entries.map(([key]) => key);
  for (const key of keys) {
    const text = latin1(key);
    if ((FORBIDDEN_KEYS as readonly string[]).includes(text)) fail(`not ${PROFILE}: forbidden key '${text}' at the ${level}`);
  }
  if (level === "info dictionary" && dictGet(dict, "files")) {
    const files = dictGet(dict, "files");
    const padded = files?.type === "list" && files.items.some((item) => {
      if (item.type !== "dict") return false;
      const attr = dictGet(item, "attr");
      const path = dictGet(item, "path");
      const first = path?.type === "list" ? path.items[0] : undefined;
      return (attr?.type === "bytes" && latin1(attr.value).includes("p")) ||
        (first?.type === "bytes" && latin1(first.value) === ".pad");
    });
    fail(`not ${PROFILE}: the v1 side must use the plain 'length' form; found a 'files' list${padded ? " with a BEP 47 pad entry" : ""}`);
  }
  const labels = keys.map(keyLabel);
  const wanted = expected.map((key) => `'${key}'`);
  if (labels.length !== wanted.length || labels.some((label, i) => label !== wanted[i])) {
    fail(`not ${PROFILE}: the ${level} must hold exactly ${wanted.join(", ")}; found ${labels.join(", ") || "nothing"}`);
  }
}

/**
 * Parse a .torrent strictly and check that it is exactly the profile: the key
 * sets at both levels, the plain v1 'length' form with no pad entry, the name
 * rule, the piece count, the piece layer against the pieces root, and the
 * url-list form. Throws on any difference.
 */
export function assertProfileTorrent(torrent: Uint8Array): ProfileTorrent {
  const top = asDict(bdecode(torrent), "the .torrent");
  assertExactKeys(top, TOP_LEVEL_KEYS, "top level");
  const infoValue = asDict(dictGet(top, "info"), "'info'");
  assertExactKeys(infoValue, INFO_KEYS, "info dictionary");

  const nameBytes = asBytes(dictGet(infoValue, "name"), "'name'");
  const name = latin1(nameBytes);
  assertTorrentName(name);
  const size = asInt(dictGet(infoValue, "length"), "'length'");
  assertSize(size, "'length'");
  const pieceLength = asInt(dictGet(infoValue, "piece length"), "'piece length'");
  assertPieceLength(pieceLength);
  if (asInt(dictGet(infoValue, "meta version"), "'meta version'") !== 2) fail(`not ${PROFILE}: 'meta version' must be 2`);

  const tree = asDict(dictGet(infoValue, "file tree"), "'file tree'");
  if (tree.entries.length !== 1 || compareBytes(tree.entries[0]![0], nameBytes) !== 0) {
    fail(`not ${PROFILE}: 'file tree' must hold exactly one key, equal to 'name'`);
  }
  const node = asDict(tree.entries[0]![1], "the file tree entry");
  if (node.entries.length !== 1 || node.entries[0]![0].length !== 0) fail(`not ${PROFILE}: the file tree entry must hold only the '' key`);
  const file = asDict(node.entries[0]![1], "the file entry");
  assertExactKeys(file, ["length", "pieces root"], "file entry");
  if (asInt(dictGet(file, "length"), "file 'length'") !== size) fail(`not ${PROFILE}: the file tree length differs from 'length'`);
  const piecesRoot = asBytes(dictGet(file, "pieces root"), "'pieces root'");
  if (piecesRoot.length !== 32) fail(`not ${PROFILE}: 'pieces root' must be 32 bytes`);

  const count = pieceCount(size, pieceLength);
  const pieces = asBytes(dictGet(infoValue, "pieces"), "'pieces'");
  if (pieces.length !== 20 * count) fail(`not ${PROFILE}: 'pieces' must hold ${count} SHA-1 hashes`);

  const layers = asDict(dictGet(top, "piece layers"), "'piece layers'");
  let pieceLayer: Uint8Array | null = null;
  if (size > pieceLength) {
    if (layers.entries.length !== 1 || compareBytes(layers.entries[0]![0], piecesRoot) !== 0) {
      fail(`not ${PROFILE}: 'piece layers' must hold exactly one entry, keyed by the pieces root`);
    }
    pieceLayer = asBytes(layers.entries[0]![1], "the piece layer");
    if (pieceLayer.length !== 32 * count) fail(`not ${PROFILE}: the piece layer must hold ${count} hashes`);
    if (compareBytes(rootFromPieceLayer(pieceLayer, pieceLength), piecesRoot) !== 0) {
      fail(`not ${PROFILE}: the piece layer does not match the pieces root`);
    }
  } else if (layers.entries.length !== 0) {
    fail(`not ${PROFILE}: 'piece layers' must be empty for a file no larger than one piece`);
  }

  const list = dictGet(top, "url-list");
  if (!list || list.type !== "list") fail(`not ${PROFILE}: 'url-list' must be a list`);
  const urlList = list.items.map((item) => latin1(asBytes(item, "a url-list entry")));
  assertUrlList(urlList);

  const info = torrent.subarray(infoValue.start, infoValue.end);
  return { name, size, pieceLength, pieces, piecesRoot, pieceLayer, urlList, info, ...infohashes(info) };
}

export interface TorrentRequest {
  readonly name: string;
  /** Expected size, from the authority record. */
  readonly size: number;
  /** Expected SHA-256, from the authority record. */
  readonly sha256: string;
  readonly urlList: readonly string[];
  /**
   * An explicit piece length for test vectors only. When present the result
   * is marked as a test vector and buildDescriptor refuses it.
   */
  readonly testVectorPieceLength?: number;
}

export interface TorrentBuild {
  readonly testVector: boolean;
  readonly name: string;
  readonly size: number;
  readonly sha256: string;
  readonly pieceLength: number;
  readonly pieces: Uint8Array;
  readonly piecesRoot: string;
  readonly pieceLayer: Uint8Array | null;
  readonly urlList: readonly string[];
  readonly torrent: Uint8Array;
  readonly torrentSha256: string;
  readonly btih: string;
  readonly btmh: string;
}

/** Check a request before any byte is read, and return the piece length to hash with. */
export function requestPieceLength(request: TorrentRequest): number {
  assertTorrentName(request.name);
  assertSize(request.size, "expected size");
  if (typeof request.sha256 !== "string" || !RE.sha256Hex.test(request.sha256)) {
    fail("expected sha256 must be 64 lowercase hexadecimal characters");
  }
  assertUrlList(request.urlList);
  if (request.testVectorPieceLength === undefined) return profilePieceLength(request.size);
  assertPieceLength(request.testVectorPieceLength);
  return request.testVectorPieceLength;
}

/** Build the .torrent from finished hashes. Refuses when size or SHA-256 differ from the request. */
export function torrentFromHashes(request: TorrentRequest, hashes: SubjectHashes): TorrentBuild {
  const pieceLength = requestPieceLength(request);
  if (hashes.size !== request.size) fail(`refused: the bytes hold ${hashes.size} bytes, expected ${request.size}`);
  if (hashes.sha256 !== request.sha256) fail(`refused: the bytes' SHA-256 is ${hashes.sha256}, expected ${request.sha256}`);
  if (hashes.pieceLength !== pieceLength) fail("refused: the bytes were hashed at another piece length");
  const torrent = encodeTorrent(hashes, request.name, request.urlList);
  const parsed = assertProfileTorrent(torrent);
  const info = bencode(infoDictionary(hashes, request.name));
  if (compareBytes(parsed.info, info) !== 0) fail("internal: the info dictionary is not a substring of the .torrent");
  return {
    testVector: request.testVectorPieceLength !== undefined,
    name: request.name,
    size: hashes.size,
    sha256: hashes.sha256,
    pieceLength,
    pieces: hashes.pieces,
    piecesRoot: hex(hashes.piecesRoot),
    pieceLayer: hashes.pieceLayer,
    urlList: [...request.urlList],
    torrent,
    torrentSha256: sha256Hex(torrent),
    btih: parsed.btih,
    btmh: parsed.btmh,
  };
}

export function buildTorrentFromBytes(request: TorrentRequest, bytes: Uint8Array): TorrentBuild {
  return torrentFromHashes(request, hashSubject(bytes, requestPieceLength(request)));
}

export async function buildTorrentFromChunks(
  request: TorrentRequest,
  chunks: AsyncIterable<Uint8Array | string>,
): Promise<TorrentBuild> {
  return torrentFromHashes(request, await hashChunks(chunks, requestPieceLength(request)));
}

// ---------------------------------------------------------------------------
// The descriptor (draft sections 4 and 5)

export type Authority =
  | { readonly kind: "love-package/v1"; readonly url: string; readonly pointer: "/artifact/sha256" }
  | { readonly kind: "json-pointer"; readonly url: string; readonly pointer: string }
  | { readonly kind: "hf-resolve-etag"; readonly url: string; readonly header: "x-linked-etag" }
  | { readonly kind: "sums-line"; readonly url: string }
  | { readonly kind: "none-prior" };

export interface NoticeFile {
  readonly filename: string;
  readonly size: number;
  readonly sha256: string;
  readonly url: string;
}

export interface DescriptorFields {
  readonly subject: { readonly filename: string; readonly size: number; readonly sha256: string };
  readonly authority: Authority;
  readonly home: string;
  readonly license: string;
  readonly notices: { readonly inside_subject: readonly string[]; readonly beside_subject: readonly NoticeFile[] };
}

type JsonObject = Record<string, unknown>;

function asObject(value: unknown, label: string, keys: readonly string[]): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${label} must be an object`);
  const object = value as JsonObject;
  for (const key of Object.keys(object)) if (!keys.includes(key)) fail(`${label} has an unknown field '${key}'`);
  for (const key of keys) if (!(key in object)) fail(`${label} is missing '${key}'`);
  return object;
}

function asString(value: unknown, label: string, pattern: RegExp, min = 1, max = 2048): string {
  if (typeof value !== "string" || value.length < min || value.length > max || !pattern.test(value)) {
    fail(`${label} '${String(value)}' does not match its rule`);
  }
  return value;
}

function asUrl(value: unknown, label: string): string {
  if (!isHttpsUrl(value)) fail(`${label} '${String(value)}' breaks the URL rule of draft section 4.1`);
  return value;
}

function asSafeSize(value: unknown, label: string): number {
  if (typeof value !== "number") fail(`${label} must be an integer`);
  assertSize(value, label);
  return value;
}

function parseSubject(value: unknown): DescriptorFields["subject"] {
  const subject = asObject(value, "subject", DESCRIPTOR_KEY_ORDER.subject);
  return {
    filename: asString(subject.filename, "subject.filename", RE.bareFilename, 1, 255),
    size: asSafeSize(subject.size, "subject.size"),
    sha256: asString(subject.sha256, "subject.sha256", RE.sha256Hex, 64, 64),
  };
}

function parseAuthority(value: unknown): Authority {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("authority must be an object");
  const kind = (value as JsonObject).kind;
  switch (kind) {
    case "love-package/v1": {
      const a = asObject(value, "authority", DESCRIPTOR_KEY_ORDER[kind]);
      if (a.pointer !== "/artifact/sha256") fail("a love-package/v1 authority's pointer is always /artifact/sha256");
      return { kind, url: asUrl(a.url, "authority.url"), pointer: "/artifact/sha256" };
    }
    case "json-pointer": {
      const a = asObject(value, "authority", DESCRIPTOR_KEY_ORDER[kind]);
      return { kind, url: asUrl(a.url, "authority.url"), pointer: asString(a.pointer, "authority.pointer", RE.jsonPointer, 2, 512) };
    }
    case "hf-resolve-etag": {
      const a = asObject(value, "authority", DESCRIPTOR_KEY_ORDER[kind]);
      const url = asUrl(a.url, "authority.url");
      if (!RE.hfResolveUrl.test(url)) fail("an hf-resolve-etag authority needs a commit-pinned huggingface.co /resolve/ URL");
      if (a.header !== "x-linked-etag") fail("an hf-resolve-etag authority's header is always x-linked-etag");
      return { kind, url, header: "x-linked-etag" };
    }
    case "sums-line": {
      const a = asObject(value, "authority", DESCRIPTOR_KEY_ORDER[kind]);
      return { kind, url: asUrl(a.url, "authority.url") };
    }
    case "none-prior":
      asObject(value, "authority", DESCRIPTOR_KEY_ORDER[kind]);
      return { kind };
    default:
      fail(`unknown authority kind '${String(kind)}'`);
  }
}

function parseNotices(value: unknown): DescriptorFields["notices"] {
  const notices = asObject(value, "notices", DESCRIPTOR_KEY_ORDER.notices);
  if (!Array.isArray(notices.inside_subject) || !Array.isArray(notices.beside_subject)) {
    fail("notices.inside_subject and notices.beside_subject must be arrays");
  }
  const inside = (notices.inside_subject as unknown[]).map((path, i) =>
    asString(path, `notices.inside_subject[${i}]`, RE.memberPath, 1, 512));
  for (let i = 1; i < inside.length; i += 1) {
    if (compareBytes(utf8(inside[i - 1]!), utf8(inside[i]!)) >= 0) {
      fail("notices.inside_subject must be sorted strictly ascending by byte value (the builder never sorts)");
    }
  }
  const beside = (notices.beside_subject as unknown[]).map((item, i) => {
    const notice = asObject(item, `notices.beside_subject[${i}]`, DESCRIPTOR_KEY_ORDER.noticeFile);
    return {
      filename: asString(notice.filename, `notices.beside_subject[${i}].filename`, RE.bareFilename, 1, 255),
      size: asSafeSize(notice.size, `notices.beside_subject[${i}].size`),
      sha256: asString(notice.sha256, `notices.beside_subject[${i}].sha256`, RE.sha256Hex, 64, 64),
      url: asUrl(notice.url, `notices.beside_subject[${i}].url`),
    };
  });
  for (let i = 1; i < beside.length; i += 1) {
    if (compareBytes(utf8(beside[i - 1]!.filename), utf8(beside[i]!.filename)) >= 0) {
      fail("notices.beside_subject must be sorted strictly ascending by filename (the builder never sorts)");
    }
  }
  if (inside.length + beside.length === 0) fail("at least one notice must be named (draft section 4.3)");
  return { inside_subject: inside, beside_subject: beside };
}

/** Parse the descriptor's input fields strictly; unknown fields are refused. */
export function parseDescriptorFields(value: unknown): DescriptorFields {
  const fields = asObject(value, "descriptor fields", ["subject", "authority", "home", "license", "notices"]);
  return {
    subject: parseSubject(fields.subject),
    authority: parseAuthority(fields.authority),
    home: asUrl(fields.home, "home"),
    license: asString(fields.license, "license", RE.spdxLicenseId, 1, 64),
    notices: parseNotices(fields.notices),
  };
}

/** The serialisation of draft section 5: JSON.stringify with two-space indent and one LF. */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** The descriptor as an object whose keys are in the order of draft section 5.2. */
export function descriptorValue(fields: DescriptorFields, torrent: TorrentBuild): JsonObject {
  const a = fields.authority;
  const authority: JsonObject =
    a.kind === "none-prior" ? { kind: a.kind }
    : a.kind === "sums-line" ? { kind: a.kind, url: a.url }
    : a.kind === "hf-resolve-etag" ? { kind: a.kind, url: a.url, header: a.header }
    : { kind: a.kind, url: a.url, pointer: a.pointer };
  return {
    protocol: PROTOCOL,
    document_type: DOCUMENT_TYPE,
    subject: { filename: fields.subject.filename, size: fields.subject.size, sha256: fields.subject.sha256 },
    authority,
    home: fields.home,
    license: fields.license,
    notices: {
      inside_subject: [...fields.notices.inside_subject],
      beside_subject: fields.notices.beside_subject.map((n) => ({ filename: n.filename, size: n.size, sha256: n.sha256, url: n.url })),
    },
    bittorrent: {
      profile: PROFILE,
      name: torrent.name,
      piece_length: torrent.pieceLength,
      pieces_root: torrent.piecesRoot,
      btih: torrent.btih,
      btmh: torrent.btmh,
    },
    recall: RECALL,
  };
}

/**
 * Write the descriptor text for a built torrent. Refuses a test-vector build,
 * and refuses when the fields' subject differs from the hashed bytes.
 */
export function buildDescriptor(fields: DescriptorFields, torrent: TorrentBuild): { text: string; sha256: string } {
  if (torrent.testVector) fail("refused: a descriptor is never written from an explicit test-vector piece length");
  const checked = parseDescriptorFields(fields);
  if (checked.subject.size !== torrent.size || checked.subject.sha256 !== torrent.sha256) {
    fail("refused: the descriptor's subject differs from the hashed bytes");
  }
  const text = canonicalJson(descriptorValue(checked, torrent));
  const problems = descriptorProblems(text);
  if (problems.length > 0) fail(`internal: the descriptor breaks its own rules: ${problems.join("; ")}`);
  return { text, sha256: sha256Hex(text) };
}

function keyOrderProblems(value: unknown, expected: readonly string[], label: string): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [`${label} is not an object`];
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key, i) => key === expected[i])
    ? []
    : [`${label} keys are ${keys.join(", ")}; expected ${expected.join(", ")} in that order`];
}

/**
 * The rules of draft section 4.4 that need no bytes: the field rules, key
 * order and exact serialisation (rule 8), the piece-length formula (rule 1),
 * pieces root equal to the SHA-256 for a file of one block (rule 2) and the
 * notice order (rule 5). Returns a list of problems; empty means none found.
 * Schema validity is checked separately (bin/tests/transport-hints-schema.test.ts).
 */
export function descriptorProblems(text: string): string[] {
  const problems: string[] = [];
  if (!/^[\x20-\x7e\n]*$/u.test(text) || text.includes("\\")) problems.push("the text is not printable ASCII without escapes");
  let value: JsonObject;
  try {
    value = JSON.parse(text) as JsonObject;
  } catch {
    return [...problems, "the text is not JSON"];
  }
  if (canonicalJson(value) !== text) problems.push("the bytes are not in the one serialisation of draft section 5");
  problems.push(...keyOrderProblems(value, DESCRIPTOR_KEY_ORDER.descriptor, "descriptor"));
  if (value.protocol !== PROTOCOL || value.document_type !== DOCUMENT_TYPE || value.recall !== RECALL) {
    problems.push("protocol, document_type or recall has the wrong value");
  }
  problems.push(...keyOrderProblems(value.subject, DESCRIPTOR_KEY_ORDER.subject, "subject"));
  problems.push(...keyOrderProblems(value.notices, DESCRIPTOR_KEY_ORDER.notices, "notices"));
  problems.push(...keyOrderProblems(value.bittorrent, DESCRIPTOR_KEY_ORDER.bittorrent, "bittorrent"));
  const kind = (value.authority as JsonObject | undefined)?.kind;
  const kinds: readonly string[] = ["love-package/v1", "json-pointer", "hf-resolve-etag", "sums-line", "none-prior"];
  if (typeof kind === "string" && kinds.includes(kind)) {
    problems.push(...keyOrderProblems(value.authority, DESCRIPTOR_KEY_ORDER[kind as Authority["kind"]], "authority"));
  }
  const beside = (value.notices as JsonObject | undefined)?.beside_subject;
  if (Array.isArray(beside)) {
    beside.forEach((item, i) => problems.push(...keyOrderProblems(item, DESCRIPTOR_KEY_ORDER.noticeFile, `notices.beside_subject[${i}]`)));
  }
  try {
    parseDescriptorFields({
      subject: value.subject,
      authority: value.authority,
      home: value.home,
      license: value.license,
      notices: value.notices,
    });
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  const subject = value.subject as JsonObject | undefined;
  const bittorrent = value.bittorrent as JsonObject | undefined;
  if (subject && bittorrent) {
    const size = subject.size;
    if (bittorrent.profile !== PROFILE) problems.push("bittorrent.profile is not single-file-hybrid/1");
    try {
      assertTorrentName(String(bittorrent.name));
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error));
    }
    if (typeof size === "number" && Number.isSafeInteger(size) && size >= 1) {
      if (bittorrent.piece_length !== profilePieceLength(size)) {
        problems.push(`rule 1: piece_length must be ${profilePieceLength(size)} for size ${size}`);
      }
      if (size <= BLOCK_SIZE && bittorrent.pieces_root !== subject.sha256) {
        problems.push("rule 2: pieces_root must equal subject.sha256 for a file of at most 16,384 bytes");
      }
    }
    if (typeof bittorrent.pieces_root !== "string" || !RE.sha256Hex.test(bittorrent.pieces_root)) problems.push("bittorrent.pieces_root is not 64 lowercase hex");
    if (typeof bittorrent.btih !== "string" || !/^[0-9a-f]{40}$/u.test(bittorrent.btih)) problems.push("bittorrent.btih is not 40 lowercase hex");
    if (typeof bittorrent.btmh !== "string" || !/^1220[0-9a-f]{64}$/u.test(bittorrent.btmh)) problems.push("bittorrent.btmh is not 1220 and 64 lowercase hex");
  }
  return problems;
}

/** Rule 3 of draft section 4.4: rebuild the identifiers from the bytes and compare. */
export function descriptorBytesProblems(text: string, hashes: SubjectHashes): string[] {
  const value = JSON.parse(text) as { subject?: JsonObject; bittorrent?: JsonObject };
  const subject = value.subject ?? {};
  const bittorrent = value.bittorrent ?? {};
  const problems: string[] = [];
  if (subject.size !== hashes.size) problems.push(`subject.size is ${String(subject.size)}; the bytes hold ${hashes.size}`);
  if (subject.sha256 !== hashes.sha256) problems.push("subject.sha256 differs from the bytes");
  if (bittorrent.piece_length !== hashes.pieceLength) problems.push("the bytes were hashed at another piece length");
  if (bittorrent.pieces_root !== hex(hashes.piecesRoot)) problems.push("rule 3: pieces_root differs from the bytes");
  const name = String(bittorrent.name);
  try {
    assertTorrentName(name);
    const ids = infohashes(bencode(infoDictionary(hashes, name)));
    if (bittorrent.btih !== ids.btih) problems.push("rule 3: btih differs from the info dictionary built from the bytes");
    if (bittorrent.btmh !== ids.btmh) problems.push("rule 3: btmh differs from the info dictionary built from the bytes");
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Build request (CLI input)

export interface BuildRequest {
  readonly torrent: TorrentRequest;
  readonly descriptor: DescriptorFields | null;
}

/** Parse a build request. The descriptor fields are required only when a descriptor is wanted. */
export function parseBuildRequest(
  value: unknown,
  options: { descriptor: boolean; testVectorPieceLength?: number },
): BuildRequest {
  const descriptorKeys = ["authority", "home", "license", "notices"];
  const allowed = ["subject", "name", "url_list", ...descriptorKeys];
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("the request must be a JSON object");
  const request = value as JsonObject;
  for (const key of Object.keys(request)) if (!allowed.includes(key)) fail(`the request has an unknown field '${key}'`);
  for (const key of ["subject", "name", "url_list"]) if (!(key in request)) fail(`the request is missing '${key}'`);
  const subject = parseSubject(request.subject);
  if (typeof request.name !== "string") fail("name must be a string");
  if (!Array.isArray(request.url_list)) fail("url_list must be an array of web seed URLs");
  const urlList = request.url_list as unknown[];
  for (const url of urlList) if (typeof url !== "string") fail("url_list entries must be strings");
  const torrent: TorrentRequest = {
    name: request.name,
    size: subject.size,
    sha256: subject.sha256,
    urlList: urlList as string[],
    ...(options.testVectorPieceLength === undefined ? {} : { testVectorPieceLength: options.testVectorPieceLength }),
  };
  requestPieceLength(torrent);
  if (!options.descriptor) return { torrent, descriptor: null };
  for (const key of descriptorKeys) if (!(key in request)) fail(`a descriptor needs '${key}' in the request`);
  const descriptor = parseDescriptorFields({
    subject: request.subject,
    authority: request.authority,
    home: request.home,
    license: request.license,
    notices: request.notices,
  });
  return { torrent, descriptor };
}

// ---------------------------------------------------------------------------
// CLI

function inputChunks(input: string): AsyncIterable<Uint8Array> {
  return input === "-" ? process.stdin : createReadStream(input, { highWaterMark: 1 << 20 });
}

async function refuseExisting(path: string): Promise<void> {
  const existing = await stat(path).then(() => true, () => false);
  if (existing) fail(`refused: ${path} already exists; outputs are never overwritten`);
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "build") {
    const { values } = parseArgs({
      args: [...rest],
      strict: true,
      allowPositionals: false,
      options: {
        request: { type: "string" },
        input: { type: "string" },
        "torrent-out": { type: "string" },
        "descriptor-out": { type: "string" },
        "test-vector-piece-length": { type: "string" },
      },
    });
    const requestPath = values.request;
    const input = values.input;
    const torrentOut = values["torrent-out"];
    const descriptorOut = values["descriptor-out"];
    if (!requestPath || !input || !torrentOut) {
      console.error("usage: build --request <request.json> --input <file|-> --torrent-out <path> [--descriptor-out <path>]");
      return 2;
    }
    let testVectorPieceLength: number | undefined;
    if (values["test-vector-piece-length"] !== undefined) {
      testVectorPieceLength = Number(values["test-vector-piece-length"]);
      if (descriptorOut) fail("refused: --test-vector-piece-length never writes a descriptor");
      if (!torrentOut.endsWith(".test-vector.torrent")) {
        fail("refused: with --test-vector-piece-length the output name must end in .test-vector.torrent");
      }
    }
    const request = parseBuildRequest(JSON.parse(await readFile(requestPath, "utf8")), {
      descriptor: Boolean(descriptorOut),
      ...(testVectorPieceLength === undefined ? {} : { testVectorPieceLength }),
    });
    await refuseExisting(torrentOut);
    if (descriptorOut) await refuseExisting(descriptorOut);
    // Everything is computed and checked before the first byte is written.
    const built = await buildTorrentFromChunks(request.torrent, inputChunks(input));
    const descriptor = request.descriptor ? buildDescriptor(request.descriptor, built) : null;
    await writeFile(torrentOut, built.torrent, { flag: "wx", mode: 0o644 });
    if (descriptor && descriptorOut) await writeFile(descriptorOut, descriptor.text, { flag: "wx", mode: 0o644 });
    process.stdout.write(canonicalJson({
      test_vector: built.testVector,
      conforming: !built.testVector,
      name: built.name,
      size: built.size,
      sha256: built.sha256,
      piece_length: built.pieceLength,
      pieces_root: built.piecesRoot,
      btih: built.btih,
      btmh: built.btmh,
      torrent: torrentOut,
      torrent_sha256: built.torrentSha256,
      descriptor: descriptorOut ?? null,
      descriptor_sha256: descriptor?.sha256 ?? null,
    }));
    return 0;
  }
  if (command === "check-descriptor") {
    const { values, positionals } = parseArgs({
      args: [...rest],
      strict: true,
      allowPositionals: true,
      options: { input: { type: "string" } },
    });
    if (positionals.length !== 1) {
      console.error("usage: check-descriptor <descriptor.json> [--input <file|->]");
      return 2;
    }
    const text = await readFile(positionals[0]!, "utf8");
    const problems = descriptorProblems(text);
    if (problems.length === 0 && values.input) {
      const value = JSON.parse(text) as { subject: { size: number } };
      problems.push(...descriptorBytesProblems(text, await hashChunks(inputChunks(values.input), profilePieceLength(value.subject.size))));
    }
    for (const problem of problems) console.error(problem);
    if (problems.length === 0) process.stdout.write(`descriptor ok: ${sha256Hex(text)}\n`);
    return problems.length === 0 ? 0 : 1;
  }
  console.error("usage: bin/build-transport-hints.ts build|check-descriptor ... (see the header of this file)");
  return 2;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`transport-hints: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
