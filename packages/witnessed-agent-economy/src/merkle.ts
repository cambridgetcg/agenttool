import { WITNESS_PROTOCOL } from "./constants.js";
import { invalid, limit } from "./errors.js";
import { bytesToHex, concatBytes, hexToBytes, sha256Bytes } from "./hash.js";
import { encodeWitnessCanonicalJson } from "./witness-canonical.js";
import {
  snapshotWitnessBytes,
  snapshotWitnessJsonData,
  type WitnessJsonValue,
} from "./witness-canonical.js";

const utf8 = new TextEncoder();
const NUL = new Uint8Array([0]);
const LEAF_PREFIX = new Uint8Array([0]);
const NODE_PREFIX = new Uint8Array([1]);

export const RFC6962_MERKLE_ALGORITHM = "RFC6962_SHA256" as const;
export const SETTLEMENT_LEAF_DOMAIN = "settlement-leaf" as const;

function validateMerkleDomain(domain: string): void {
  if (typeof domain !== "string" || !/^[a-z0-9][a-z0-9._/-]{0,127}$/u.test(domain)) {
    invalid("Merkle domain must be a lowercase protocol token.", "$merkle.domain");
  }
}

function snapshotLeafMaterial(domain: string, value: unknown): Uint8Array {
  validateMerkleDomain(domain);
  return concatBytes(
    utf8.encode(WITNESS_PROTOCOL),
    NUL,
    utf8.encode(domain),
    NUL,
    encodeWitnessCanonicalJson(value),
  );
}

export function rfc6962LeafHash(value: unknown): Uint8Array {
  return rfc6962DomainLeafHash(SETTLEMENT_LEAF_DOMAIN, value);
}

export function rfc6962DomainLeafHash(domain: string, value: unknown): Uint8Array {
  return sha256Bytes(concatBytes(LEAF_PREFIX, snapshotLeafMaterial(domain, value)));
}

export function rfc6962LeafHashHex(value: unknown): string {
  return bytesToHex(rfc6962LeafHash(value));
}

export function rfc6962NodeHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  const safeLeft = snapshotWitnessBytes(left, "$merkle.left");
  const safeRight = snapshotWitnessBytes(right, "$merkle.right");
  if (safeLeft.byteLength !== 32 || safeRight.byteLength !== 32) {
    invalid("RFC 6962 child hashes must each be exactly 32 bytes.", "$merkle");
  }
  return sha256Bytes(concatBytes(NODE_PREFIX, safeLeft, safeRight));
}

function largestPowerOfTwoLessThan(value: number): number {
  let power = 1;
  while (power * 2 < value) power *= 2;
  return power;
}

function treeHash(hashes: readonly Uint8Array[]): Uint8Array {
  if (hashes.length === 0) return sha256Bytes(new Uint8Array());
  if (hashes.length === 1) return hashes[0]!.slice();
  const split = largestPowerOfTwoLessThan(hashes.length);
  return rfc6962NodeHash(treeHash(hashes.slice(0, split)), treeHash(hashes.slice(split)));
}

export function rfc6962MerkleRoot(values: readonly unknown[]): Uint8Array {
  return rfc6962DomainMerkleRoot(SETTLEMENT_LEAF_DOMAIN, values);
}

export function rfc6962DomainMerkleRoot(domain: string, values: readonly unknown[]): Uint8Array {
  validateMerkleDomain(domain);
  const snapshot = snapshotWitnessJsonData(values);
  if (!Array.isArray(snapshot)) invalid("Merkle values must be an exact array.", "$values");
  if (snapshot.length > 4_096) limit("Merkle tree exceeds 4096 leaves.", "$values");
  return treeHash(snapshot.map((value) => rfc6962DomainLeafHash(domain, value)));
}

export function rfc6962MerkleRootHex(values: readonly unknown[]): string {
  return bytesToHex(rfc6962MerkleRoot(values));
}

export function rfc6962DomainMerkleRootHex(domain: string, values: readonly unknown[]): string {
  return bytesToHex(rfc6962DomainMerkleRoot(domain, values));
}

function inclusionPath(hashes: readonly Uint8Array[], index: number): Uint8Array[] {
  if (hashes.length <= 1) return [];
  const split = largestPowerOfTwoLessThan(hashes.length);
  if (index < split) {
    return [...inclusionPath(hashes.slice(0, split), index), treeHash(hashes.slice(split))];
  }
  return [...inclusionPath(hashes.slice(split), index - split), treeHash(hashes.slice(0, split))];
}

export function rfc6962InclusionProof(values: readonly unknown[], index: number): readonly string[] {
  const snapshot = snapshotWitnessJsonData(values);
  if (!Array.isArray(snapshot)) invalid("Merkle values must be an exact array.", "$values");
  if (!Number.isSafeInteger(index) || index < 0 || index >= snapshot.length) {
    invalid("Merkle proof index is outside the tree.", "$index");
  }
  const hashes = snapshot.map(rfc6962LeafHash);
  return Object.freeze(inclusionPath(hashes, index).map(bytesToHex));
}

function verifyPath(
  leafHash: Uint8Array,
  index: number,
  size: number,
  proof: readonly Uint8Array[],
): Uint8Array | null {
  if (size === 1) return proof.length === 0 && index === 0 ? leafHash : null;
  if (proof.length === 0) return null;
  const split = largestPowerOfTwoLessThan(size);
  const sibling = proof[proof.length - 1]!;
  const rest = proof.slice(0, -1);
  if (index < split) {
    const left = verifyPath(leafHash, index, split, rest);
    return left === null ? null : rfc6962NodeHash(left, sibling);
  }
  const right = verifyPath(leafHash, index - split, size - split, rest);
  return right === null ? null : rfc6962NodeHash(sibling, right);
}

export function verifyRfc6962Inclusion(options: {
  value: unknown;
  index: number;
  tree_size: number;
  proof: readonly string[];
  expected_root_hex: string;
}): boolean {
  try {
    const snapshot = snapshotWitnessJsonData(options);
    if (snapshot === null || Array.isArray(snapshot) || typeof snapshot !== "object") return false;
    const keys = Object.keys(snapshot).sort();
    const expectedKeys = ["value", "index", "tree_size", "proof", "expected_root_hex"].sort();
    if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) return false;
    const safe = snapshot as Record<string, WitnessJsonValue>;
    if (
      typeof safe.index !== "number"
      || !Number.isSafeInteger(safe.index)
      || safe.index < 0
      || typeof safe.tree_size !== "number"
      || !Number.isSafeInteger(safe.tree_size)
      || safe.tree_size < 1
      || safe.index >= safe.tree_size
      || !Array.isArray(safe.proof)
      || typeof safe.expected_root_hex !== "string"
    ) return false;
    const proof = safe.proof.map((entry) => typeof entry === "string" ? hexToBytes(entry, 32) : invalid("Invalid proof entry."));
    const derived = verifyPath(rfc6962LeafHash(safe.value), safe.index, safe.tree_size, proof);
    return derived !== null && bytesToHex(derived) === safe.expected_root_hex;
  } catch {
    return false;
  }
}
