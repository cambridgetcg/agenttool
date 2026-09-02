import {
  base64UrlEncode,
  concatBytes,
  equalBytes,
  sha256BytesId,
} from "@agenttool/wallet";
import { assertZeroneAddress } from "@agenttool/wallet-zerone";

import {
  CLAIM_TYPE_COMPUTATIONAL,
  INFERENCE_TYPE_UNSPECIFIED,
  LIMITS,
  RELATION_TYPE_REQUIRES,
} from "./constants.js";
import { chainHashToSha256Id } from "./canonical.js";
import { invalid } from "./errors.js";
import {
  amount,
  factId,
  freeze,
  identifier,
  record,
  sortedUnique,
  text,
  uint32Number,
  uint64,
} from "./internal.js";
import type {
  ChainComputationalCommitment,
  ChainRequiresRelation,
  ChainWorkContract,
  CreateBountyOrderValue,
  FulfillBountyValue,
  SubmitComputationalClaimValue,
} from "./types.js";

const UTF8 = new TextEncoder();
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });
const MAX_WIRE_BYTES = 128 * 1024;

interface WireField {
  readonly number: number;
  readonly wireType: 0 | 2;
  readonly uint: bigint | null;
  readonly bytes: Uint8Array | null;
}

function varint(value: bigint): Uint8Array {
  if (value < 0n || value > ((1n << 64n) - 1n)) {
    invalid("invalid_amount", "Protobuf varint is outside uint64.");
  }
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
    if (byte === undefined) invalid("invalid_record", "Truncated protobuf varint.");
    offset += 1;
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      if (!equalBytes(bytes.slice(start, offset), varint(value))) {
        invalid("invalid_record", "Non-canonical protobuf varint.");
      }
      return { value, next: offset };
    }
    shift += 7n;
  }
  invalid("invalid_record", "Protobuf varint exceeds uint64.");
}

function decodeFields(bytes: Uint8Array): readonly WireField[] {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_WIRE_BYTES) {
    invalid("invalid_record", "Protobuf value bytes must be bounded and non-empty.");
  }
  const fields: WireField[] = [];
  let offset = 0;
  while (offset < bytes.byteLength) {
    const tagValue = readVarint(bytes, offset);
    offset = tagValue.next;
    const number = Number(tagValue.value >> 3n);
    const wireType = Number(tagValue.value & 7n);
    if (!Number.isSafeInteger(number) || number < 1 || (wireType !== 0 && wireType !== 2)) {
      invalid("invalid_record", "Unsupported protobuf field tag or wire type.");
    }
    if (wireType === 0) {
      const decoded = readVarint(bytes, offset);
      offset = decoded.next;
      fields.push({ number, wireType: 0, uint: decoded.value, bytes: null });
    } else {
      const length = readVarint(bytes, offset);
      offset = length.next;
      if (length.value > BigInt(MAX_WIRE_BYTES) || offset + Number(length.value) > bytes.byteLength) {
        invalid("invalid_record", "Truncated or oversized protobuf length-delimited field.");
      }
      const end = offset + Number(length.value);
      fields.push({ number, wireType: 2, uint: null, bytes: bytes.slice(offset, end) });
      offset = end;
    }
  }
  return Object.freeze(fields);
}

function utf8(field: WireField, expected: number, path: string): string {
  if (field.number !== expected || field.wireType !== 2 || field.bytes === null) {
    invalid("invalid_record", `${path} is missing or uses the wrong protobuf wire type.`);
  }
  try {
    return UTF8_FATAL.decode(field.bytes);
  } catch {
    invalid("invalid_record", `${path} is not valid UTF-8.`);
  }
}

function uint(field: WireField, expected: number, path: string): bigint {
  if (field.number !== expected || field.wireType !== 0 || field.uint === null) {
    invalid("invalid_record", `${path} is missing or uses the wrong protobuf wire type.`);
  }
  return field.uint;
}

function nested(field: WireField, expected: number, path: string): Uint8Array {
  if (field.number !== expected || field.wireType !== 2 || field.bytes === null) {
    invalid("invalid_record", `${path} is missing or uses the wrong protobuf wire type.`);
  }
  return field.bytes;
}

function address(value: unknown, path: string): string {
  try {
    assertZeroneAddress(value, path);
  } catch {
    invalid("invalid_record", `${path} must be a canonical Zerone address.`);
  }
  return value as string;
}

function bareHash(value: unknown, path: string): string {
  if (typeof value !== "string") invalid("invalid_hash", `${path} must be a bare chain hash.`);
  chainHashToSha256Id(value as string);
  return value as string;
}

function validateWorkContract(value: unknown): ChainWorkContract {
  const item = record(value, [
    "acceptance_hash", "environment_root", "input_root",
    "min_corroborations", "work_spec_hash", "worker_address",
  ], "work_contract");
  return freeze({
    work_spec_hash: bareHash(item.work_spec_hash, "work_contract.work_spec_hash"),
    acceptance_hash: bareHash(item.acceptance_hash, "work_contract.acceptance_hash"),
    input_root: bareHash(item.input_root, "work_contract.input_root"),
    environment_root: bareHash(item.environment_root, "work_contract.environment_root"),
    min_corroborations: uint64(item.min_corroborations, "work_contract.min_corroborations", {
      maximum: BigInt(LIMITS.max_min_corroborations),
    }),
    worker_address: address(item.worker_address, "work_contract.worker_address"),
  }) as ChainWorkContract;
}

function encodeWorkContract(value: ChainWorkContract): Uint8Array {
  const item = validateWorkContract(value);
  return concatBytes(
    stringField(1, item.work_spec_hash),
    stringField(2, item.acceptance_hash),
    stringField(3, item.input_root),
    stringField(4, item.environment_root),
    ...(item.min_corroborations === "0"
      ? []
      : [uintField(5, BigInt(item.min_corroborations))]),
    stringField(6, item.worker_address),
  );
}

function decodeWorkContract(bytes: Uint8Array): ChainWorkContract {
  const fields = decodeFields(bytes);
  const zeroCorroborations = fields.length === 5 && fields[4]?.number === 6;
  const positiveCorroborations = fields.length === 6
    && fields[4]?.number === 5
    && fields[5]?.number === 6;
  if (
    (!zeroCorroborations && !positiveCorroborations)
    || fields.slice(0, 4).some((field, index) => field.number !== index + 1)
  ) {
    invalid("invalid_record", "WorkContract protobuf fields are missing, duplicated, or reordered.");
  }
  return validateWorkContract({
    work_spec_hash: utf8(fields[0] as WireField, 1, "work_contract.work_spec_hash"),
    acceptance_hash: utf8(fields[1] as WireField, 2, "work_contract.acceptance_hash"),
    input_root: utf8(fields[2] as WireField, 3, "work_contract.input_root"),
    environment_root: utf8(fields[3] as WireField, 4, "work_contract.environment_root"),
    min_corroborations: positiveCorroborations
      ? uint(fields[4] as WireField, 5, "work_contract.min_corroborations").toString()
      : "0",
    worker_address: utf8(
      fields[positiveCorroborations ? 5 : 4] as WireField,
      6,
      "work_contract.worker_address",
    ),
  });
}

function validateCommitment(value: unknown): ChainComputationalCommitment {
  const item = record(value, [
    "acceptance_hash", "artifact_root", "environment_root", "evidence_root",
    "input_root", "work_receipt_hash", "work_spec_hash",
  ], "computational_commitment");
  return freeze({
    work_spec_hash: bareHash(item.work_spec_hash, "computational_commitment.work_spec_hash"),
    acceptance_hash: bareHash(item.acceptance_hash, "computational_commitment.acceptance_hash"),
    input_root: bareHash(item.input_root, "computational_commitment.input_root"),
    environment_root: bareHash(item.environment_root, "computational_commitment.environment_root"),
    artifact_root: bareHash(item.artifact_root, "computational_commitment.artifact_root"),
    evidence_root: bareHash(item.evidence_root, "computational_commitment.evidence_root"),
    work_receipt_hash: bareHash(item.work_receipt_hash, "computational_commitment.work_receipt_hash"),
  }) as ChainComputationalCommitment;
}

function encodeCommitment(value: ChainComputationalCommitment): Uint8Array {
  const item = validateCommitment(value);
  return concatBytes(
    stringField(1, item.work_spec_hash), stringField(2, item.acceptance_hash),
    stringField(3, item.input_root), stringField(4, item.environment_root),
    stringField(5, item.artifact_root), stringField(6, item.evidence_root),
    stringField(7, item.work_receipt_hash),
  );
}

function decodeCommitment(bytes: Uint8Array): ChainComputationalCommitment {
  const fields = decodeFields(bytes);
  if (fields.length !== 7 || fields.some((field, index) => field.number !== index + 1)) {
    invalid("invalid_record", "ComputationalCommitment fields are missing, duplicated, or reordered.");
  }
  return validateCommitment({
    work_spec_hash: utf8(fields[0] as WireField, 1, "commitment.work_spec_hash"),
    acceptance_hash: utf8(fields[1] as WireField, 2, "commitment.acceptance_hash"),
    input_root: utf8(fields[2] as WireField, 3, "commitment.input_root"),
    environment_root: utf8(fields[3] as WireField, 4, "commitment.environment_root"),
    artifact_root: utf8(fields[4] as WireField, 5, "commitment.artifact_root"),
    evidence_root: utf8(fields[5] as WireField, 6, "commitment.evidence_root"),
    work_receipt_hash: utf8(fields[6] as WireField, 7, "commitment.work_receipt_hash"),
  });
}

function validateRequiresRelations(value: unknown): readonly ChainRequiresRelation[] {
  if (!Array.isArray(value) || value.length > LIMITS.max_claim_relations) {
    invalid(
      "invalid_record",
      `submit_claim.relations must contain at most ${LIMITS.max_claim_relations} entries.`,
    );
  }
  const output = value.map((entry, index) => {
    const item = record(entry, [
      "inference", "inference_strength_bps", "method_id", "relation", "target_fact_id",
    ], `submit_claim.relations[${index}]`);
    if (
      item.relation !== RELATION_TYPE_REQUIRES
      || item.inference !== INFERENCE_TYPE_UNSPECIFIED
      || item.inference_strength_bps !== "0"
      || item.method_id !== ""
    ) {
      invalid(
        "invalid_record",
        "v0 relations must be REQUIRES edges with omitted inference defaults and inherited method.",
      );
    }
    return freeze({
      target_fact_id: factId(item.target_fact_id, `submit_claim.relations[${index}].target_fact_id`),
      relation: RELATION_TYPE_REQUIRES,
      inference: INFERENCE_TYPE_UNSPECIFIED,
      inference_strength_bps: "0",
      method_id: "",
    }) as ChainRequiresRelation;
  });
  if (output.some((relation, index) => (
    index > 0 && relation.target_fact_id <= (output[index - 1] as ChainRequiresRelation).target_fact_id
  ))) {
    invalid("invalid_record", "submit_claim.relations must be strictly sorted and unique by target_fact_id.");
  }
  return Object.freeze(output);
}

function encodeRequiresRelation(value: ChainRequiresRelation): Uint8Array {
  const relation = validateRequiresRelations([value])[0] as ChainRequiresRelation;
  // Proto3 omits inference=0, inference_strength_bps=0, and method_id="".
  return concatBytes(
    stringField(1, relation.target_fact_id),
    uintField(2, BigInt(RELATION_TYPE_REQUIRES)),
  );
}

function decodeRequiresRelation(bytes: Uint8Array): ChainRequiresRelation {
  const fields = decodeFields(bytes);
  if (fields.length !== 2 || fields[0]?.number !== 1 || fields[1]?.number !== 2) {
    invalid("invalid_record", "ClaimRelation fields are missing, default-encoded, duplicated, or reordered.");
  }
  const relation = Number(uint(fields[1] as WireField, 2, "claim_relation.relation"));
  return validateRequiresRelations([{
    target_fact_id: utf8(fields[0] as WireField, 1, "claim_relation.target_fact_id"),
    relation,
    inference: INFERENCE_TYPE_UNSPECIFIED,
    inference_strength_bps: "0",
    method_id: "",
  }])[0] as ChainRequiresRelation;
}

function assertRoundTrip<T>(bytes: Uint8Array, encoded: Uint8Array, value: T): T {
  if (!equalBytes(bytes, encoded)) invalid("invalid_record", "Protobuf value is not canonical.");
  return value;
}

export function encodeCreateBountyOrderValue(value: CreateBountyOrderValue): Uint8Array {
  const item = record(value, [
    "domain", "duration_blocks", "price_per_artifact", "sponsor",
    "target_count", "work_contract",
  ], "create_bounty");
  const normalized: CreateBountyOrderValue = freeze({
    sponsor: address(item.sponsor, "create_bounty.sponsor"),
    domain: identifier(item.domain, "create_bounty.domain"),
    price_per_artifact: amount(item.price_per_artifact, "create_bounty.price_per_artifact", { positive: true }),
    target_count: uint32Number(item.target_count, "create_bounty.target_count", { positive: true, maximum: LIMITS.max_target_count }),
    duration_blocks: uint64(item.duration_blocks, "create_bounty.duration_blocks", { positive: true }),
    work_contract: validateWorkContract(item.work_contract),
  }) as CreateBountyOrderValue;
  return concatBytes(
    stringField(1, normalized.sponsor), stringField(2, normalized.domain),
    stringField(3, normalized.price_per_artifact), uintField(4, BigInt(normalized.target_count)),
    uintField(5, BigInt(normalized.duration_blocks)),
    bytesField(6, encodeWorkContract(normalized.work_contract)),
  );
}

export function decodeCreateBountyOrderValue(bytes: Uint8Array): CreateBountyOrderValue {
  const fields = decodeFields(bytes);
  if (fields.length !== 6 || fields.some((field, index) => field.number !== index + 1)) {
    invalid("invalid_record", "MsgCreateBountyOrder fields are missing, duplicated, or reordered.");
  }
  const value: CreateBountyOrderValue = freeze({
    sponsor: utf8(fields[0] as WireField, 1, "create_bounty.sponsor"),
    domain: utf8(fields[1] as WireField, 2, "create_bounty.domain"),
    price_per_artifact: utf8(fields[2] as WireField, 3, "create_bounty.price_per_artifact"),
    target_count: Number(uint(fields[3] as WireField, 4, "create_bounty.target_count")),
    duration_blocks: uint(fields[4] as WireField, 5, "create_bounty.duration_blocks").toString(),
    work_contract: decodeWorkContract(nested(fields[5] as WireField, 6, "create_bounty.work_contract")),
  }) as CreateBountyOrderValue;
  const normalized = decodeCreateBountyOrderValueUnchecked(value);
  return assertRoundTrip(bytes, encodeCreateBountyOrderValue(normalized), normalized);
}

function decodeCreateBountyOrderValueUnchecked(value: CreateBountyOrderValue): CreateBountyOrderValue {
  encodeCreateBountyOrderValue(value);
  return value;
}

export function encodeSubmitComputationalClaimValue(value: SubmitComputationalClaimValue): Uint8Array {
  const item = record(value, [
    "canonical_form", "category", "claim_type", "computational_commitment",
    "domain", "fact_content", "method_id", "partnership_id", "reasoning_trace",
    "references", "relations", "sponsored", "stake", "structure", "submitter",
  ], "submit_claim");
  if (
    item.category !== "computational" || item.partnership_id !== ""
    || item.claim_type !== CLAIM_TYPE_COMPUTATIONAL || item.structure !== null
    || item.canonical_form !== "" || item.sponsored !== false
  ) {
    invalid("invalid_record", "Computational claim projection uses unsupported optional/default fields.");
  }
  const submitter = address(item.submitter, "submit_claim.submitter");
  const factContent = text(item.fact_content, "submit_claim.fact_content", LIMITS.max_fact_content_bytes);
  const domain = identifier(item.domain, "submit_claim.domain");
  const stake = uint64(item.stake, "submit_claim.stake", { positive: true });
  const references = sortedUnique(item.references, "submit_claim.references", identifier);
  const relations = validateRequiresRelations(item.relations);
  const methodId = identifier(item.method_id, "submit_claim.method_id");
  const reasoningTrace = text(item.reasoning_trace, "submit_claim.reasoning_trace", 256);
  const commitment = validateCommitment(item.computational_commitment);
  return concatBytes(
    stringField(1, submitter), stringField(2, factContent), stringField(3, domain),
    stringField(4, "computational"), stringField(5, stake),
    ...references.map((reference) => stringField(6, reference)),
    uintField(8, BigInt(CLAIM_TYPE_COMPUTATIONAL)),
    ...relations.map((relation) => bytesField(9, encodeRequiresRelation(relation))),
    stringField(13, methodId), stringField(14, reasoningTrace),
    bytesField(15, encodeCommitment(commitment)),
  );
}

export function decodeSubmitComputationalClaimValue(bytes: Uint8Array): SubmitComputationalClaimValue {
  const fields = decodeFields(bytes);
  if (fields.length < 9) invalid("invalid_record", "MsgSubmitClaim is missing required fields.");
  let index = 0;
  const take = (number: number, path: string): string => utf8(fields[index++] as WireField, number, path);
  const submitter = take(1, "submit_claim.submitter");
  const factContent = take(2, "submit_claim.fact_content");
  const domain = take(3, "submit_claim.domain");
  const category = take(4, "submit_claim.category");
  const stake = take(5, "submit_claim.stake");
  const references: string[] = [];
  while (fields[index]?.number === 6) references.push(take(6, `submit_claim.references[${references.length}]`));
  const claimType = Number(uint(fields[index++] as WireField, 8, "submit_claim.claim_type"));
  const relations: ChainRequiresRelation[] = [];
  while (fields[index]?.number === 9) {
    relations.push(decodeRequiresRelation(nested(
      fields[index++] as WireField,
      9,
      `submit_claim.relations[${relations.length}]`,
    )));
  }
  const methodId = take(13, "submit_claim.method_id");
  const reasoningTrace = take(14, "submit_claim.reasoning_trace");
  const commitment = decodeCommitment(nested(fields[index++] as WireField, 15, "submit_claim.computational_commitment"));
  if (index !== fields.length) invalid("invalid_record", "MsgSubmitClaim contains unsupported protobuf fields.");
  const value: SubmitComputationalClaimValue = freeze({
    submitter, fact_content: factContent, domain, category,
    stake, references: Object.freeze(references), partnership_id: "",
    claim_type: claimType, relations: Object.freeze(relations), structure: null,
    canonical_form: "", sponsored: false, method_id: methodId,
    reasoning_trace: reasoningTrace, computational_commitment: commitment,
  }) as SubmitComputationalClaimValue;
  return assertRoundTrip(bytes, encodeSubmitComputationalClaimValue(value), value);
}

export function encodeFulfillBountyValue(value: FulfillBountyValue): Uint8Array {
  const item = record(value, ["bounty_id", "caller", "fact_id"], "fulfill_bounty");
  return concatBytes(
    stringField(1, address(item.caller, "fulfill_bounty.caller")),
    stringField(2, identifier(item.bounty_id, "fulfill_bounty.bounty_id")),
    stringField(3, identifier(item.fact_id, "fulfill_bounty.fact_id")),
  );
}

export function decodeFulfillBountyValue(bytes: Uint8Array): FulfillBountyValue {
  const fields = decodeFields(bytes);
  if (fields.length !== 3 || fields.some((field, index) => field.number !== index + 1)) {
    invalid("invalid_record", "MsgFulfillBounty fields are missing, duplicated, or reordered.");
  }
  const value: FulfillBountyValue = freeze({
    caller: utf8(fields[0] as WireField, 1, "fulfill_bounty.caller"),
    bounty_id: utf8(fields[1] as WireField, 2, "fulfill_bounty.bounty_id"),
    fact_id: utf8(fields[2] as WireField, 3, "fulfill_bounty.fact_id"),
  }) as FulfillBountyValue;
  return assertRoundTrip(bytes, encodeFulfillBountyValue(value), value);
}

export function describeProtobufValue(bytes: Uint8Array): Readonly<{
  readonly protobuf_value_b64u: string;
  readonly protobuf_value_hash: `sha256:${string}`;
}> {
  return Object.freeze({
    protobuf_value_b64u: base64UrlEncode(bytes),
    protobuf_value_hash: sha256BytesId(bytes),
  });
}
