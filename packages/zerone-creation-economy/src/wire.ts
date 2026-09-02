import {
  concatBytes,
  equalBytes,
  snapshotJsonData,
  type JsonValue,
} from "@agenttool/wallet";
import { assertZeroneAddress } from "@agenttool/wallet-zerone";
import {
  CLAIM_TYPE_COMPUTATIONAL,
  INFERENCE_TYPE_UNSPECIFIED,
  RELATION_TYPE_REQUIRES,
  chainHashToSha256Id,
  decodeCreateBountyOrderValue,
  encodeCreateBountyOrderValue,
  type ChainComputationalCommitment,
  type ChainRequiresRelation,
  type CreateBountyOrderValue,
} from "@agenttool/zerone-agent-economy";

import { fail } from "./errors.js";
import type {
  CreationEconomyMessageProjection,
  CreationSubmitClaimValue,
} from "./types.js";

const UTF8 = new TextEncoder();
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });
const MAX_WIRE_BYTES = 128 * 1024;
const MAX_UINT64 = (1n << 64n) - 1n;
const FACT_ENVELOPE = /^agenttool\.zerone-creation-fact-envelope\/0\.1 sha256:[0-9a-f]{64}$/u;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;
const ARRAY_BUFFER_BYTE_LENGTH = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)!.get!;
const SHARED_ARRAY_BUFFER_BYTE_LENGTH = typeof SharedArrayBuffer === "undefined"
  ? null
  : Object.getOwnPropertyDescriptor(SharedArrayBuffer.prototype, "byteLength")!.get!;

interface WireField {
  readonly number: number;
  readonly wire_type: 0 | 2;
  readonly uint: bigint | null;
  readonly bytes: Uint8Array | null;
}

type JsonRecord = { [key: string]: JsonValue };

function typedArraySlot(
  value: Uint8Array,
  slot: "buffer" | "byteLength" | "byteOffset",
  path: string,
): unknown {
  try {
    return Reflect.get(TYPED_ARRAY_PROTOTYPE, slot, value);
  } catch {
    fail("invalid_record", `${path} must be an intrinsic Uint8Array view.`, path);
  }
}

function hasBackingStoreSlot(
  value: unknown,
  getter: ((this: unknown) => unknown) | null,
): boolean {
  if (getter === null) return false;
  try {
    Reflect.apply(getter, value, []);
    return true;
  } catch {
    return false;
  }
}

function ownedWireBytes(value: unknown, path: string): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    fail("invalid_record", `${path} must contain bounded non-empty bytes.`, path);
  }
  const byteLength = typedArraySlot(value, "byteLength", path);
  const byteOffset = typedArraySlot(value, "byteOffset", path);
  const buffer = typedArraySlot(value, "buffer", path);
  if (
    typeof byteLength !== "number"
    || typeof byteOffset !== "number"
    || byteLength === 0
    || byteLength > MAX_WIRE_BYTES
  ) {
    fail("invalid_record", `${path} must contain bounded non-empty bytes.`, path);
  }
  if (hasBackingStoreSlot(buffer, SHARED_ARRAY_BUFFER_BYTE_LENGTH)) {
    fail("invalid_record", `${path} cannot use concurrently mutable shared memory.`, path);
  }
  if (!hasBackingStoreSlot(buffer, ARRAY_BUFFER_BYTE_LENGTH)) {
    fail("invalid_record", `${path} must be backed by an ordinary ArrayBuffer.`, path);
  }
  const output = new Uint8Array(byteLength);
  const intrinsicView = new Uint8Array(buffer as ArrayBuffer, byteOffset, byteLength);
  Uint8Array.prototype.set.call(output, intrinsicView);
  return output;
}

function record(value: JsonValue, keys: readonly string[], path: string): JsonRecord {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    fail("invalid_record", `${path} must be a record.`, path);
  }
  const item = value as JsonRecord;
  const actual = Object.keys(item).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("invalid_record", `${path} must contain exactly: ${expected.join(", ")}.`, path);
  }
  return item;
}

function text(value: JsonValue | undefined, path: string, maximum: number): string {
  if (
    typeof value !== "string"
    || value.length > maximum
    || value.includes("\0")
    || Buffer.byteLength(value, "utf8") > maximum
  ) {
    fail("invalid_record", `${path} must be bounded canonical text.`, path);
  }
  return value;
}

function identifier(value: JsonValue | undefined, path: string): string {
  const output = text(value, path, 256);
  if (output.length === 0 || output !== output.trim()) {
    fail("invalid_record", `${path} must be a non-empty trimmed identifier.`, path);
  }
  return output;
}

function uint64(value: JsonValue | undefined, path: string, positive = false): string {
  if (typeof value !== "string" || value.length > 20 || !/^(0|[1-9][0-9]*)$/u.test(value)) {
    fail("invalid_record", `${path} must be a canonical uint64 decimal string.`, path);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_UINT64 || (positive && parsed === 0n)) {
    fail("invalid_record", `${path} is outside the permitted uint64 range.`, path);
  }
  return value;
}

export function assertCreationBountyValueProfile(
  value: CreateBountyOrderValue,
): void {
  if (value.target_count !== 1) {
    fail(
      "projection_mismatch",
      "Creation-economy Create-bounty target_count must remain exactly 1.",
      "value.target_count",
    );
  }
  uint64(value.price_per_artifact, "value.price_per_artifact", true);
  uint64(value.duration_blocks, "value.duration_blocks", true);
  uint64(
    value.work_contract.min_corroborations,
    "value.work_contract.min_corroborations",
    true,
  );
}

function address(value: JsonValue | undefined, path: string): string {
  try {
    assertZeroneAddress(value, path);
  } catch {
    fail("invalid_record", `${path} must be a canonical lowercase zrn address.`, path);
  }
  return value as string;
}

function bareHash(value: JsonValue | undefined, path: string): string {
  if (typeof value !== "string") fail("invalid_hash", `${path} must be a bare chain hash.`, path);
  try {
    chainHashToSha256Id(value);
  } catch {
    fail("invalid_hash", `${path} must be exactly 64 lowercase hexadecimal characters.`, path);
  }
  return value;
}

function sha256Id(value: JsonValue | undefined, path: string): `sha256:${string}` {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    fail("invalid_hash", `${path} must be sha256:<64 lowercase hex>.`, path);
  }
  return value as `sha256:${string}`;
}

function varint(value: bigint): Uint8Array {
  if (value < 0n || value > MAX_UINT64) fail("invalid_record", "Protobuf varint is outside uint64.");
  const output: number[] = [];
  let remaining = value;
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining !== 0n) byte |= 0x80;
    output.push(byte);
  } while (remaining !== 0n);
  return Uint8Array.from(output);
}

function tag(field: number, wireType: 0 | 2): Uint8Array {
  return varint(BigInt((field << 3) | wireType));
}

function stringField(field: number, value: string): Uint8Array {
  const bytes = UTF8.encode(value);
  return concatBytes(tag(field, 2), varint(BigInt(bytes.byteLength)), bytes);
}

function bytesField(field: number, value: Uint8Array): Uint8Array {
  return concatBytes(tag(field, 2), varint(BigInt(value.byteLength)), value);
}

function uintField(field: number, value: bigint): Uint8Array {
  return concatBytes(tag(field, 0), varint(value));
}

function readVarint(bytes: Uint8Array, start: number): { readonly value: bigint; readonly next: number } {
  let value = 0n;
  let shift = 0n;
  let offset = start;
  for (let count = 0; count < 10; count += 1) {
    const byte = bytes[offset];
    if (byte === undefined) fail("invalid_record", "Truncated protobuf varint.");
    offset += 1;
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      if (!equalBytes(bytes.slice(start, offset), varint(value))) {
        fail("invalid_record", "Non-canonical protobuf varint.");
      }
      return { value, next: offset };
    }
    shift += 7n;
  }
  fail("invalid_record", "Protobuf varint exceeds uint64.");
}

function decodeFields(bytes: Uint8Array): readonly WireField[] {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_WIRE_BYTES) {
    fail("invalid_record", "Protobuf value bytes must be bounded and non-empty.");
  }
  const fields: WireField[] = [];
  let offset = 0;
  while (offset < bytes.byteLength) {
    const tagValue = readVarint(bytes, offset);
    offset = tagValue.next;
    const number = Number(tagValue.value >> 3n);
    const wireType = Number(tagValue.value & 7n);
    if (!Number.isSafeInteger(number) || number < 1 || (wireType !== 0 && wireType !== 2)) {
      fail("invalid_record", "Unsupported protobuf field tag or wire type.");
    }
    if (wireType === 0) {
      const decoded = readVarint(bytes, offset);
      offset = decoded.next;
      fields.push({ number, wire_type: 0, uint: decoded.value, bytes: null });
    } else {
      const length = readVarint(bytes, offset);
      offset = length.next;
      if (length.value > BigInt(MAX_WIRE_BYTES) || offset + Number(length.value) > bytes.byteLength) {
        fail("invalid_record", "Truncated or oversized protobuf length-delimited field.");
      }
      const end = offset + Number(length.value);
      fields.push({ number, wire_type: 2, uint: null, bytes: bytes.slice(offset, end) });
      offset = end;
    }
  }
  return Object.freeze(fields);
}

function utf8(field: WireField | undefined, expected: number, path: string): string {
  if (field?.number !== expected || field.wire_type !== 2 || field.bytes === null) {
    fail("invalid_record", `${path} is missing or uses the wrong protobuf wire type.`, path);
  }
  try {
    return UTF8_FATAL.decode(field.bytes);
  } catch {
    fail("invalid_record", `${path} is not valid UTF-8.`, path);
  }
}

function uint(field: WireField | undefined, expected: number, path: string): bigint {
  if (field?.number !== expected || field.wire_type !== 0 || field.uint === null) {
    fail("invalid_record", `${path} is missing or uses the wrong protobuf wire type.`, path);
  }
  return field.uint;
}

function nested(field: WireField | undefined, expected: number, path: string): Uint8Array {
  if (field?.number !== expected || field.wire_type !== 2 || field.bytes === null) {
    fail("invalid_record", `${path} is missing or uses the wrong protobuf wire type.`, path);
  }
  return field.bytes;
}

function validateCommitment(value: JsonValue, path: string): ChainComputationalCommitment {
  const item = record(value, [
    "acceptance_hash",
    "artifact_root",
    "environment_root",
    "evidence_root",
    "input_root",
    "work_receipt_hash",
    "work_spec_hash",
  ], path);
  return Object.freeze({
    work_spec_hash: bareHash(item.work_spec_hash, `${path}.work_spec_hash`),
    acceptance_hash: bareHash(item.acceptance_hash, `${path}.acceptance_hash`),
    input_root: bareHash(item.input_root, `${path}.input_root`),
    environment_root: bareHash(item.environment_root, `${path}.environment_root`),
    artifact_root: bareHash(item.artifact_root, `${path}.artifact_root`),
    evidence_root: bareHash(item.evidence_root, `${path}.evidence_root`),
    work_receipt_hash: bareHash(item.work_receipt_hash, `${path}.work_receipt_hash`),
  });
}

function encodeCommitment(value: ChainComputationalCommitment): Uint8Array {
  const item = validateCommitment(snapshotJsonData(value), "computational_commitment");
  return concatBytes(
    stringField(1, item.work_spec_hash),
    stringField(2, item.acceptance_hash),
    stringField(3, item.input_root),
    stringField(4, item.environment_root),
    stringField(5, item.artifact_root),
    stringField(6, item.evidence_root),
    stringField(7, item.work_receipt_hash),
  );
}

function decodeCommitment(bytes: Uint8Array): ChainComputationalCommitment {
  const fields = decodeFields(bytes);
  if (fields.length !== 7 || fields.some((field, index) => field.number !== index + 1)) {
    fail("invalid_record", "ComputationalCommitment fields are missing, duplicated, or reordered.");
  }
  return validateCommitment(snapshotJsonData({
    work_spec_hash: utf8(fields[0], 1, "computational_commitment.work_spec_hash"),
    acceptance_hash: utf8(fields[1], 2, "computational_commitment.acceptance_hash"),
    input_root: utf8(fields[2], 3, "computational_commitment.input_root"),
    environment_root: utf8(fields[3], 4, "computational_commitment.environment_root"),
    artifact_root: utf8(fields[4], 5, "computational_commitment.artifact_root"),
    evidence_root: utf8(fields[5], 6, "computational_commitment.evidence_root"),
    work_receipt_hash: utf8(fields[6], 7, "computational_commitment.work_receipt_hash"),
  }), "computational_commitment");
}

function validateRelations(value: JsonValue | undefined): readonly ChainRequiresRelation[] {
  if (!Array.isArray(value) || value.length > 16) {
    fail("invalid_record", "relations must contain at most 16 REQUIRES edges.", "relations");
  }
  const output = value.map((entry, index) => {
    const path = `relations[${String(index)}]`;
    const item = record(entry, [
      "inference",
      "inference_strength_bps",
      "method_id",
      "relation",
      "target_fact_id",
    ], path);
    if (
      item.relation !== RELATION_TYPE_REQUIRES
      || item.inference !== INFERENCE_TYPE_UNSPECIFIED
      || item.inference_strength_bps !== "0"
      || item.method_id !== ""
    ) {
      fail("invalid_record", "Creation projections admit exact REQUIRES edges only.", path);
    }
    return Object.freeze({
      target_fact_id: identifier(item.target_fact_id, `${path}.target_fact_id`),
      relation: RELATION_TYPE_REQUIRES,
      inference: INFERENCE_TYPE_UNSPECIFIED,
      inference_strength_bps: "0",
      method_id: "",
    }) as ChainRequiresRelation;
  });
  if (output.some((entry, index) => index > 0 && entry.target_fact_id <= output[index - 1]!.target_fact_id)) {
    fail("invalid_record", "relations must be strictly target-sorted and unique.", "relations");
  }
  return Object.freeze(output);
}

function encodeRelation(value: ChainRequiresRelation): Uint8Array {
  const relation = validateRelations(snapshotJsonData([value]))[0]!;
  return concatBytes(
    stringField(1, relation.target_fact_id),
    uintField(2, BigInt(RELATION_TYPE_REQUIRES)),
  );
}

function decodeRelation(bytes: Uint8Array): ChainRequiresRelation {
  const fields = decodeFields(bytes);
  if (fields.length !== 2 || fields[0]?.number !== 1 || fields[1]?.number !== 2) {
    fail("invalid_record", "ClaimRelation fields are missing, default-encoded, duplicated, or reordered.");
  }
  return validateRelations(snapshotJsonData([{
    target_fact_id: utf8(fields[0], 1, "relation.target_fact_id"),
    relation: Number(uint(fields[1], 2, "relation.relation")),
    inference: INFERENCE_TYPE_UNSPECIFIED,
    inference_strength_bps: "0",
    method_id: "",
  }]))[0]!;
}

function validateValue(value: unknown): CreationSubmitClaimValue {
  const item = record(snapshotJsonData(value), [
    "canonical_form",
    "category",
    "claim_type",
    "computational_commitment",
    "domain",
    "fact_content",
    "method_id",
    "partnership_id",
    "reasoning_trace",
    "references",
    "relations",
    "sponsored",
    "stake",
    "structure",
    "submitter",
  ], "submit_claim");
  if (
    item.partnership_id !== ""
    || item.claim_type !== CLAIM_TYPE_COMPUTATIONAL
    || item.structure !== null
    || item.sponsored !== false
    || !Array.isArray(item.references)
    || item.references.length !== 0
  ) {
    fail("invalid_record", "Creation claim defaults or empty Fact references changed.", "submit_claim");
  }
  const category = item.category === "formal" || item.category === "computational"
    ? item.category
    : fail("invalid_record", "category must be formal or computational.", "submit_claim.category");
  const method = item.method_id === "M-FORMAL" || item.method_id === "M-COMPUTATIONAL"
    ? item.method_id
    : fail("invalid_record", "method_id is outside the creation bootstrap pair.", "submit_claim.method_id");
  if (
    (category === "formal" && method !== "M-FORMAL")
    || (category === "computational" && method !== "M-COMPUTATIONAL")
  ) {
    fail("contract_mismatch", "category and methodology do not match.", "submit_claim.method_id");
  }
  const factContent = text(item.fact_content, "submit_claim.fact_content", 1_000);
  const canonicalForm = text(item.canonical_form, "submit_claim.canonical_form", 1_000);
  if (factContent !== canonicalForm || !FACT_ENVELOPE.test(factContent)) {
    fail("contract_mismatch", "fact_content and canonical_form must be the same creation digest envelope.");
  }
  return Object.freeze({
    submitter: address(item.submitter, "submit_claim.submitter"),
    fact_content: factContent,
    domain: identifier(item.domain, "submit_claim.domain"),
    category,
    stake: uint64(item.stake, "submit_claim.stake", true),
    references: Object.freeze([]) as readonly [],
    partnership_id: "",
    claim_type: CLAIM_TYPE_COMPUTATIONAL,
    relations: validateRelations(item.relations),
    structure: null,
    canonical_form: canonicalForm,
    sponsored: false,
    method_id: method,
    reasoning_trace: sha256Id(item.reasoning_trace, "submit_claim.reasoning_trace"),
    computational_commitment: validateCommitment(
      item.computational_commitment as JsonValue,
      "submit_claim.computational_commitment",
    ),
  });
}

export function encodeCreationSubmitClaimValue(value: CreationSubmitClaimValue): Uint8Array {
  const item = validateValue(value);
  return concatBytes(
    stringField(1, item.submitter),
    stringField(2, item.fact_content),
    stringField(3, item.domain),
    stringField(4, item.category),
    stringField(5, item.stake),
    uintField(8, BigInt(CLAIM_TYPE_COMPUTATIONAL)),
    ...item.relations.map((relation) => bytesField(9, encodeRelation(relation))),
    stringField(11, item.canonical_form),
    stringField(13, item.method_id),
    stringField(14, item.reasoning_trace),
    bytesField(15, encodeCommitment(item.computational_commitment)),
  );
}

export function decodeCreationSubmitClaimValue(bytes: Uint8Array): CreationSubmitClaimValue {
  const owned = ownedWireBytes(bytes, "submit_claim.protobuf_value");
  const fields = decodeFields(owned);
  let index = 0;
  const submitter = utf8(fields[index++], 1, "submit_claim.submitter");
  const factContent = utf8(fields[index++], 2, "submit_claim.fact_content");
  const domain = utf8(fields[index++], 3, "submit_claim.domain");
  const category = utf8(fields[index++], 4, "submit_claim.category");
  const stake = utf8(fields[index++], 5, "submit_claim.stake");
  const claimType = Number(uint(fields[index++], 8, "submit_claim.claim_type"));
  const relations: ChainRequiresRelation[] = [];
  while (fields[index]?.number === 9) {
    relations.push(decodeRelation(nested(fields[index++], 9, `submit_claim.relations[${relations.length}]`)));
  }
  const canonicalForm = utf8(fields[index++], 11, "submit_claim.canonical_form");
  const methodId = utf8(fields[index++], 13, "submit_claim.method_id");
  const reasoningTrace = utf8(fields[index++], 14, "submit_claim.reasoning_trace");
  const commitment = decodeCommitment(nested(fields[index++], 15, "submit_claim.computational_commitment"));
  if (index !== fields.length) {
    fail("invalid_record", "MsgSubmitClaim contains missing, reordered, or unsupported protobuf fields.");
  }
  const value = validateValue({
    submitter,
    fact_content: factContent,
    domain,
    category,
    stake,
    references: [],
    partnership_id: "",
    claim_type: claimType,
    relations,
    structure: null,
    canonical_form: canonicalForm,
    sponsored: false,
    method_id: methodId,
    reasoning_trace: reasoningTrace,
    computational_commitment: commitment,
  });
  if (!equalBytes(owned, encodeCreationSubmitClaimValue(value))) {
    fail("invalid_record", "MsgSubmitClaim protobuf value is not canonical.");
  }
  return value;
}

export function encodeCreationEconomyAny(
  typeUrl: CreationEconomyMessageProjection["type_url"],
  value: Uint8Array,
): Uint8Array {
  const owned = ownedWireBytes(value, "value");
  let canonical: Uint8Array;
  if (typeUrl === "/zerone.sponsorship.v1.MsgCreateBountyOrder") {
    const decoded = decodeCreateBountyOrderValue(owned);
    assertCreationBountyValueProfile(decoded);
    canonical = encodeCreateBountyOrderValue(decoded);
  } else if (typeUrl === "/zerone.knowledge.v1.MsgSubmitClaim") {
    canonical = encodeCreationSubmitClaimValue(decodeCreationSubmitClaimValue(owned));
  } else {
    fail("invalid_projection", "Any type URL is outside the creation bridge allowlist.", "type_url");
  }
  if (!equalBytes(owned, canonical)) {
    fail("invalid_projection", "Any value must be canonical for its exact type URL.", "value");
  }
  return concatBytes(stringField(1, typeUrl), bytesField(2, canonical));
}
