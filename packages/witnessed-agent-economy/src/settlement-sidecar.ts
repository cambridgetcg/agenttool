import { MAX_UINT64 } from "./constants.js";
import { invalid } from "./errors.js";
import { deepFreeze, sha256Id, unsignedDecimal, type JsonValue } from "./internal.js";
import { rfc6962MerkleRootHex } from "./merkle.js";
import type { SettlementBatchSidecar, VerifiedSettlementBatchSidecar } from "./types.js";
import {
  decodeWitnessCanonicalJson,
  snapshotWitnessJsonData,
  type WitnessJsonValue,
} from "./witness-canonical.js";

type WitnessObject = Record<string, WitnessJsonValue>;

function object(value: WitnessJsonValue, path: string): WitnessObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    invalid(`${path} must be an object.`, path);
  }
  return value;
}

function exactKeys(value: WitnessObject, expected: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    invalid(`${path} must contain exactly ${wanted.join(", ")}.`, path);
  }
}

function positive(value: WitnessJsonValue, path: string): string {
  return unsignedDecimal(value as JsonValue, path, { minimum: 1n, maximum: MAX_UINT64 });
}

/** Strict validation for a trusted in-memory shared settlement sidecar. Wire
 * callers must use verifySettlementBatchSidecarBytes so duplicate keys,
 * non-canonical encoding and trailing bytes remain observable. */
export function verifySettlementBatchSidecarObject(value: unknown): VerifiedSettlementBatchSidecar {
  const snapshot = snapshotWitnessJsonData(value);
  const batch = object(snapshot, "$batch");
  exactKeys(
    batch,
    ["first_sequence", "last_sequence", "receipt_count", "declared_gaps", "leaves"],
    "$batch",
  );
  const firstText = positive(batch.first_sequence!, "$batch.first_sequence");
  const lastText = positive(batch.last_sequence!, "$batch.last_sequence");
  const countText = positive(batch.receipt_count!, "$batch.receipt_count");
  const first = BigInt(firstText);
  const last = BigInt(lastText);
  const count = BigInt(countText);
  if (last < first) invalid("Settlement last_sequence precedes first_sequence.", "$batch.last_sequence");

  if (!Array.isArray(batch.declared_gaps)) {
    invalid("declared_gaps must be a non-null array.", "$batch.declared_gaps");
  }
  if (!Array.isArray(batch.leaves)) invalid("leaves must be a non-null array.", "$batch.leaves");
  if (batch.leaves.length === 0 || batch.leaves.length > 4_096) {
    invalid("Settlement batch must contain 1 through 4096 leaves.", "$batch.leaves");
  }

  const gaps: Array<{ first: string; last: string }> = [];
  let priorGapLast: bigint | null = null;
  let missing = 0n;
  for (const [index, gapValue] of batch.declared_gaps.entries()) {
    const path = `$batch.declared_gaps[${index}]`;
    const gap = object(gapValue, path);
    exactKeys(gap, ["first", "last"], path);
    const gapFirstText = positive(gap.first!, `${path}.first`);
    const gapLastText = positive(gap.last!, `${path}.last`);
    const gapFirst = BigInt(gapFirstText);
    const gapLast = BigInt(gapLastText);
    if (gapFirst < first || gapLast > last || gapLast < gapFirst) {
      invalid("Settlement gap is outside the declared range.", path);
    }
    if (priorGapLast !== null && gapFirst <= priorGapLast + 1n) {
      invalid("Settlement gaps must be sorted, disjoint and maximally merged.", path);
    }
    missing += gapLast - gapFirst + 1n;
    if (missing > MAX_UINT64) invalid("Settlement gap count overflows uint64.", "$batch.declared_gaps");
    priorGapLast = gapLast;
    gaps.push({ first: gapFirstText, last: gapLastText });
  }
  if (missing > last - first + 1n || count !== last - first + 1n - missing) {
    invalid("receipt_count must equal range size minus declared gaps.", "$batch.receipt_count");
  }
  if (BigInt(batch.leaves.length) !== count) {
    invalid("Settlement leaf count must equal receipt_count.", "$batch.leaves");
  }

  const leaves: Array<{ sequence: string; receipt_digest: `sha256:${string}` }> = [];
  const seenReceipts = new Set<string>();
  let expected = first;
  let gapIndex = 0;
  for (const [index, leafValue] of batch.leaves.entries()) {
    while (gapIndex < gaps.length) {
      const gapFirst = BigInt(gaps[gapIndex]!.first);
      const gapLast = BigInt(gaps[gapIndex]!.last);
      if (expected < gapFirst) break;
      if (expected <= gapLast) expected = gapLast + 1n;
      gapIndex += 1;
    }
    const path = `$batch.leaves[${index}]`;
    const leaf = object(leafValue, path);
    exactKeys(leaf, ["sequence", "receipt_digest"], path);
    const sequenceText = positive(leaf.sequence!, `${path}.sequence`);
    if (BigInt(sequenceText) !== expected) {
      invalid(`Settlement leaf sequence must equal ${expected}.`, `${path}.sequence`);
    }
    const receiptDigest = sha256Id(leaf.receipt_digest as JsonValue, `${path}.receipt_digest`);
    if (seenReceipts.has(receiptDigest)) {
      invalid("Settlement receipt digest duplicates an earlier batch leaf.", `${path}.receipt_digest`);
    }
    seenReceipts.add(receiptDigest);
    leaves.push({ sequence: sequenceText, receipt_digest: receiptDigest });
    expected += 1n;
  }

  const verified: SettlementBatchSidecar = {
    first_sequence: firstText,
    last_sequence: lastText,
    receipt_count: countText,
    declared_gaps: gaps,
    leaves,
  };
  return deepFreeze({
    batch: verified,
    merkle_root: `sha256:${rfc6962MerkleRootHex(leaves)}`,
  }) as VerifiedSettlementBatchSidecar;
}

export function verifySettlementBatchSidecarBytes(bytes: Uint8Array): VerifiedSettlementBatchSidecar {
  return verifySettlementBatchSidecarObject(decodeWitnessCanonicalJson(bytes));
}
