import { createHash } from "node:crypto";

/**
 * RFC 6962 Merkle hash tree over a Collab journal epoch's events in sequence order.
 *
 * Leaf preimage (DESIGN.md section 2):
 *   L = UTF-8("agenttool.collab/journal-leaf/v1\0" + epoch_id + "\0" + decimal(sequence) + "\0" + event_hash)
 *   leaf_hash = SHA-256(0x00 || L)
 * Interior node (RFC 6962 section 2.1):
 *   node_hash = SHA-256(0x01 || left || right)
 * Empty tree (RFC 6962 section 2.1):
 *   MTH({}) = SHA-256("")
 *
 * A root proves "these event hashes, in this sequence order, in this epoch";
 * it makes no claim about truth, consent, or authority.
 */

export const JOURNAL_MERKLE_LEAF_DOMAIN = "agenttool.collab/journal-leaf/v1" as const;
export const RFC6962_EMPTY_ROOT =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" as const;

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const LEAF_PREFIX = new Uint8Array([0x00]);
const NODE_PREFIX = new Uint8Array([0x01]);
const UTF8 = new TextEncoder();

export interface JournalInclusionProof {
  epoch_id: string;
  sequence: number;
  event_hash: string;
  leaf_hash: string;
  tree_size: number;
  root: string;
  path: string[];
}

export interface JournalConsistencyProof {
  epoch_id: string;
  from_size: number;
  to_size: number;
  from_root: string;
  to_root: string;
  path: string[];
}

export interface VerifyRfc6962InclusionInput {
  leaf_hash: string;
  leaf_index: number;
  tree_size: number;
  root: string;
  path: readonly string[];
}

export interface VerifyRfc6962ConsistencyInput {
  from_size: number;
  to_size: number;
  from_root: string;
  to_root: string;
  path: readonly string[];
}

export interface VerifyJournalInclusionInput {
  epoch_id: string;
  sequence: number;
  event_hash: string;
  tree_size: number;
  root: string;
  path: readonly string[];
}

export type VerifyJournalConsistencyInput = VerifyRfc6962ConsistencyInput;

function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX_RE.test(value);
}

function assertSha256Hex(value: string, label: string): void {
  if (!isSha256Hex(value)) {
    throw new RangeError(`${label} must be 64 lowercase hexadecimal characters`);
  }
}

function isValidEpochId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

function assertValidEpochId(epochId: string): void {
  if (!isValidEpochId(epochId)) {
    throw new RangeError("epoch_id must be a non-empty string containing no NUL bytes");
  }
}

function assertSafeNonNegativeInt(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}

function isPowerOfTwo(n: number): boolean {
  if (!Number.isSafeInteger(n) || n < 1) return false;
  let p = 1;
  while (p < n) p *= 2;
  return p === n;
}

/** Largest power of two strictly less than n (RFC 6962 section 2.1, n >= 2). */
export function largestPowerOfTwoLessThan(n: number): number {
  if (!Number.isSafeInteger(n) || n < 2) {
    throw new RangeError("largestPowerOfTwoLessThan requires a safe integer >= 2");
  }
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

/** RFC 6962 leaf hash: SHA-256(0x00 || bytes). */
export function rfc6962LeafHash(data: Uint8Array | string): string {
  const bytes = typeof data === "string" ? UTF8.encode(data) : data;
  return createHash("sha256").update(LEAF_PREFIX).update(bytes).digest("hex");
}

/** RFC 6962 interior node hash: SHA-256(0x01 || left || right). */
export function rfc6962NodeHash(leftHex: string, rightHex: string): string {
  assertSha256Hex(leftHex, "left");
  assertSha256Hex(rightHex, "right");
  return createHash("sha256")
    .update(NODE_PREFIX)
    .update(Buffer.from(leftHex, "hex"))
    .update(Buffer.from(rightHex, "hex"))
    .digest("hex");
}

function subtreeRoot(leafHashes: readonly string[], start: number, end: number): string {
  const n = end - start;
  if (n === 0) return RFC6962_EMPTY_ROOT;
  if (n === 1) return leafHashes[start]!;
  const k = largestPowerOfTwoLessThan(n);
  return rfc6962NodeHash(
    subtreeRoot(leafHashes, start, start + k),
    subtreeRoot(leafHashes, start + k, end),
  );
}

/** Compute RFC 6962 Merkle Tree Hash MTH(D[0..treeSize-1]) over pre-hashed leaves. */
export function rfc6962Root(leafHashes: readonly string[], treeSize = leafHashes.length): string {
  assertSafeNonNegativeInt(treeSize, "tree_size");
  if (treeSize > leafHashes.length) {
    throw new RangeError(`tree_size (${treeSize}) exceeds available leaves (${leafHashes.length})`);
  }
  for (let i = 0; i < treeSize; i += 1) {
    assertSha256Hex(leafHashes[i]!, `leaf_hashes[${i}]`);
  }
  return subtreeRoot(leafHashes, 0, treeSize);
}

/** Generate RFC 6962 section 2.1.1 inclusion path PATH(leafIndex, D[0..treeSize-1]). */
export function rfc6962InclusionProof(
  leafHashes: readonly string[],
  leafIndex: number,
  treeSize = leafHashes.length,
): string[] {
  assertSafeNonNegativeInt(treeSize, "tree_size");
  assertSafeNonNegativeInt(leafIndex, "leaf_index");
  if (treeSize < 1 || treeSize > leafHashes.length) {
    throw new RangeError(`tree_size (${treeSize}) must be in [1, ${leafHashes.length}]`);
  }
  if (leafIndex >= treeSize) {
    throw new RangeError(`leaf_index (${leafIndex}) must be < tree_size (${treeSize})`);
  }
  for (let i = 0; i < treeSize; i += 1) {
    assertSha256Hex(leafHashes[i]!, `leaf_hashes[${i}]`);
  }

  const path: string[] = [];
  const walk = (m: number, start: number, end: number): void => {
    const n = end - start;
    if (n <= 1) return;
    const k = largestPowerOfTwoLessThan(n);
    if (m < k) {
      walk(m, start, start + k);
      path.push(subtreeRoot(leafHashes, start + k, end));
    } else {
      walk(m - k, start + k, end);
      path.push(subtreeRoot(leafHashes, start, start + k));
    }
  };
  walk(leafIndex, 0, treeSize);
  return path;
}

/** Generate RFC 6962 section 2.1.2 consistency proof PROOF(fromSize, D[0..toSize-1]). */
export function rfc6962ConsistencyProof(
  leafHashes: readonly string[],
  fromSize: number,
  toSize = leafHashes.length,
): string[] {
  assertSafeNonNegativeInt(fromSize, "from_size");
  assertSafeNonNegativeInt(toSize, "to_size");
  if (fromSize > toSize) {
    throw new RangeError(`from_size (${fromSize}) must be <= to_size (${toSize})`);
  }
  if (toSize > leafHashes.length) {
    throw new RangeError(`to_size (${toSize}) exceeds available leaves (${leafHashes.length})`);
  }
  for (let i = 0; i < toSize; i += 1) {
    assertSha256Hex(leafHashes[i]!, `leaf_hashes[${i}]`);
  }
  if (fromSize === 0 || fromSize === toSize) return [];

  const path: string[] = [];
  const subproof = (m: number, start: number, end: number, complete: boolean): void => {
    const n = end - start;
    if (m === n) {
      if (!complete) path.push(subtreeRoot(leafHashes, start, end));
      return;
    }
    const k = largestPowerOfTwoLessThan(n);
    if (m <= k) {
      subproof(m, start, start + k, complete);
      path.push(subtreeRoot(leafHashes, start + k, end));
    } else {
      subproof(m - k, start + k, end, false);
      path.push(subtreeRoot(leafHashes, start, start + k));
    }
  };
  subproof(fromSize, 0, toSize, true);
  return path;
}

/** Verify an RFC 6962 inclusion proof (RFC 9162 section 2.1.3.2 algorithm). */
export function verifyRfc6962Inclusion(input: VerifyRfc6962InclusionInput): boolean {
  const { leaf_hash, leaf_index, tree_size, root, path } = input;
  if (
    !isSha256Hex(leaf_hash)
    || !isSha256Hex(root)
    || !Number.isSafeInteger(tree_size)
    || !Number.isSafeInteger(leaf_index)
    || tree_size < 1
    || leaf_index < 0
    || leaf_index >= tree_size
    || !Array.isArray(path)
  ) {
    return false;
  }
  for (const node of path) {
    if (!isSha256Hex(node)) return false;
  }

  let fn = leaf_index;
  let sn = tree_size - 1;
  let r = leaf_hash;

  for (const p of path) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      r = rfc6962NodeHash(p, r);
      while (fn !== 0 && fn % 2 === 0) {
        fn = Math.floor(fn / 2);
        sn = Math.floor(sn / 2);
      }
    } else {
      r = rfc6962NodeHash(r, p);
    }
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  return sn === 0 && r === root;
}

/** Verify an RFC 6962 consistency proof (RFC 9162 section 2.1.4.2 algorithm). */
export function verifyRfc6962Consistency(input: VerifyRfc6962ConsistencyInput): boolean {
  const { from_size, to_size, from_root, to_root, path } = input;
  if (
    !Number.isSafeInteger(from_size)
    || !Number.isSafeInteger(to_size)
    || from_size < 0
    || to_size < from_size
    || !isSha256Hex(from_root)
    || !isSha256Hex(to_root)
    || !Array.isArray(path)
  ) {
    return false;
  }
  for (const node of path) {
    if (!isSha256Hex(node)) return false;
  }

  if (from_size === 0) {
    if (to_size === 0) {
      return path.length === 0 && from_root === RFC6962_EMPTY_ROOT && to_root === RFC6962_EMPTY_ROOT;
    }
    return path.length === 0 && from_root === RFC6962_EMPTY_ROOT;
  }
  if (from_size === to_size) {
    return path.length === 0 && from_root === to_root;
  }
  if (path.length === 0) return false;

  const nodes = isPowerOfTwo(from_size) ? [from_root, ...path] : [...path];
  let fn = from_size - 1;
  let sn = to_size - 1;
  while (fn % 2 === 1) {
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }

  let fr = nodes[0]!;
  let sr = nodes[0]!;
  for (let i = 1; i < nodes.length; i += 1) {
    const c = nodes[i]!;
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      fr = rfc6962NodeHash(c, fr);
      sr = rfc6962NodeHash(c, sr);
      while (fn !== 0 && fn % 2 === 0) {
        fn = Math.floor(fn / 2);
        sn = Math.floor(sn / 2);
      }
    } else {
      sr = rfc6962NodeHash(sr, c);
    }
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  return sn === 0 && fr === from_root && sr === to_root;
}

// ---------------------------------------------------------------------------
// Collab journal leaf binding & pure proof API (DESIGN.md sections 2 & 3)

/** Exact UTF-8 leaf payload L for event `sequence` (>= 1) in `epochId`. */
export function journalLeafPreimage(epochId: string, sequence: number, eventHash: string): Uint8Array {
  assertValidEpochId(epochId);
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new RangeError("sequence must be a safe integer >= 1");
  }
  assertSha256Hex(eventHash, "event_hash");
  return UTF8.encode(`${JOURNAL_MERKLE_LEAF_DOMAIN}\0${epochId}\0${sequence}\0${eventHash}`);
}

/** RFC 6962 leaf hash SHA-256(0x00 || L) for one journal event. */
export function journalLeafHash(epochId: string, sequence: number, eventHash: string): string {
  return rfc6962LeafHash(journalLeafPreimage(epochId, sequence, eventHash));
}

function buildJournalLeafHashes(epochId: string, eventHashes: readonly string[], limit: number): string[] {
  assertValidEpochId(epochId);
  const leaves: string[] = new Array(limit);
  for (let i = 0; i < limit; i += 1) {
    leaves[i] = journalLeafHash(epochId, i + 1, eventHashes[i]!);
  }
  return leaves;
}

/** Compute the RFC 6962 Merkle root of one epoch's ordered event hashes (`1..n`). */
export function journalMerkleRoot(epochId: string, eventHashes: readonly string[]): string {
  assertValidEpochId(epochId);
  if (eventHashes.length === 0) return RFC6962_EMPTY_ROOT;
  const leaves = buildJournalLeafHashes(epochId, eventHashes, eventHashes.length);
  return subtreeRoot(leaves, 0, leaves.length);
}

/** Build an inclusion proof for 1-based `sequence` inside the prefix of size `treeSize`. */
export function proveJournalInclusion(
  epochId: string,
  eventHashes: readonly string[],
  sequence: number,
  treeSize = eventHashes.length,
): JournalInclusionProof {
  assertValidEpochId(epochId);
  assertSafeNonNegativeInt(treeSize, "tree_size");
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new RangeError("sequence must be a safe integer >= 1");
  }
  if (treeSize > eventHashes.length) {
    throw new RangeError(`tree_size (${treeSize}) exceeds available events (${eventHashes.length})`);
  }
  if (sequence > treeSize) {
    throw new RangeError(`sequence (${sequence}) must be <= tree_size (${treeSize})`);
  }
  const leaves = buildJournalLeafHashes(epochId, eventHashes, treeSize);
  const root = subtreeRoot(leaves, 0, treeSize);
  const path = rfc6962InclusionProof(leaves, sequence - 1, treeSize);
  return {
    epoch_id: epochId,
    sequence,
    event_hash: eventHashes[sequence - 1]!,
    leaf_hash: leaves[sequence - 1]!,
    tree_size: treeSize,
    root,
    path,
  };
}

/** Build a prefix consistency proof from `fromSize` to `toSize` over one epoch's event hashes. */
export function proveJournalConsistency(
  epochId: string,
  eventHashes: readonly string[],
  fromSize: number,
  toSize = eventHashes.length,
): JournalConsistencyProof {
  assertValidEpochId(epochId);
  assertSafeNonNegativeInt(fromSize, "from_size");
  assertSafeNonNegativeInt(toSize, "to_size");
  if (fromSize > toSize) {
    throw new RangeError(`from_size (${fromSize}) must be <= to_size (${toSize})`);
  }
  if (toSize > eventHashes.length) {
    throw new RangeError(`to_size (${toSize}) exceeds available events (${eventHashes.length})`);
  }
  const leaves = buildJournalLeafHashes(epochId, eventHashes, toSize);
  const fromRoot = subtreeRoot(leaves, 0, fromSize);
  const toRoot = subtreeRoot(leaves, 0, toSize);
  const path = rfc6962ConsistencyProof(leaves, fromSize, toSize);
  return {
    epoch_id: epochId,
    from_size: fromSize,
    to_size: toSize,
    from_root: fromRoot,
    to_root: toRoot,
    path,
  };
}

/** Verify a Collab journal inclusion proof against a trusted root. */
export function verifyJournalInclusion(input: VerifyJournalInclusionInput): boolean {
  const { epoch_id, sequence, event_hash, tree_size, root, path } = input;
  if (
    !isValidEpochId(epoch_id)
    || !Number.isSafeInteger(sequence)
    || sequence < 1
    || !Number.isSafeInteger(tree_size)
    || sequence > tree_size
    || !isSha256Hex(event_hash)
  ) {
    return false;
  }
  const leafHash = journalLeafHash(epoch_id, sequence, event_hash);
  return verifyRfc6962Inclusion({
    leaf_hash: leafHash,
    leaf_index: sequence - 1,
    tree_size,
    root,
    path,
  });
}

/** Verify a Collab journal prefix consistency proof between two roots. */
export function verifyJournalConsistency(input: VerifyJournalConsistencyInput): boolean {
  return verifyRfc6962Consistency(input);
}
