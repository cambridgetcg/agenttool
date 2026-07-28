import { sha256 } from "@noble/hashes/sha2.js";
import {
  assertUuid,
  concatBytes,
  equalBytes,
} from "@agenttool/wallet";

import {
  AGENTTOOL_ADAPTER_ID,
  AGENTTOOL_WORK_CLASS_ID,
  ZERONE_DENOM,
  ZERONE_LIMITS,
} from "./constants.js";
import { invalid } from "./errors.js";
import {
  assertZeroneAddress,
} from "./profiles.js";
import type {
  ZeroneExternalSource,
  ZeroneMsgSend,
  ZeroneMsgSubmitExternalAttestation,
  ZeroneWitnessSubstrateLink,
} from "./types.js";
import {
  assertAtomicAmount,
  assertBoundedText,
  assertUint64,
  freezeArray,
} from "./validation.js";
import {
  assertCanonicalProtobuf,
  bytesField,
  decodeFields,
  decodeUtf8,
  requireBytesField,
  requireUintField,
  stringField,
  uintField,
  type WireField,
} from "./wire.js";

function assertFieldSequence(
  fields: readonly WireField[],
  expected: readonly number[],
  path: string,
): void {
  if (
    fields.length !== expected.length
    || fields.some((field, index) => field.number !== expected[index])
  ) {
    invalid(`${path} contains unsupported, missing, duplicated, or reordered fields.`, path);
  }
}

function encodeCoin(value: { readonly denom: string; readonly amount: string }): Uint8Array {
  if (value.denom !== ZERONE_DENOM) {
    invalid("MsgSend supports only the native uzrn denom.", "coin.denom");
  }
  assertAtomicAmount(value.amount, "coin.amount", { positive: true });
  return concatBytes(
    stringField(1, value.denom),
    stringField(2, value.amount),
  );
}

function decodeCoin(bytes: Uint8Array): Readonly<{
  readonly denom: "uzrn";
  readonly amount: string;
}> {
  const fields = decodeFields(bytes, ZERONE_LIMITS.max_message_bytes);
  assertFieldSequence(fields, [1, 2], "coin");
  const denom = decodeUtf8(requireBytesField(fields[0], 1, "coin.denom"), "coin.denom");
  const amount = decodeUtf8(requireBytesField(fields[1], 2, "coin.amount"), "coin.amount");
  const value = Object.freeze({ denom, amount });
  const encoded = encodeCoin(value);
  assertCanonicalProtobuf(bytes, encoded, "coin");
  return Object.freeze({ denom: ZERONE_DENOM, amount });
}

export function encodeZeroneMsgSend(value: ZeroneMsgSend): Uint8Array {
  assertZeroneAddress(value.from_address, "msg_send.from_address");
  assertZeroneAddress(value.to_address, "msg_send.to_address");
  if (
    !Array.isArray(value.amount)
    || value.amount.length !== 1
    || value.amount[0] === undefined
  ) {
    invalid("MsgSend must contain exactly one native uzrn coin.", "msg_send.amount");
  }
  return concatBytes(
    stringField(1, value.from_address),
    stringField(2, value.to_address),
    bytesField(3, encodeCoin(value.amount[0])),
  );
}

export function decodeZeroneMsgSend(
  bytes: Uint8Array,
): Readonly<ZeroneMsgSend> {
  const fields = decodeFields(bytes, ZERONE_LIMITS.max_message_bytes);
  assertFieldSequence(fields, [1, 2, 3], "msg_send");
  const fromAddress = decodeUtf8(
    requireBytesField(fields[0], 1, "msg_send.from_address"),
    "msg_send.from_address",
  );
  const toAddress = decodeUtf8(
    requireBytesField(fields[1], 2, "msg_send.to_address"),
    "msg_send.to_address",
  );
  const coin = decodeCoin(requireBytesField(fields[2], 3, "msg_send.amount[0]"));
  const value: ZeroneMsgSend = Object.freeze({
    from_address: fromAddress,
    to_address: toAddress,
    amount: Object.freeze([coin]) as readonly [typeof coin],
  });
  assertCanonicalProtobuf(bytes, encodeZeroneMsgSend(value), "msg_send");
  return value;
}

function assertSourceUrl(sourceUrl: unknown, sourceId: string): asserts sourceUrl is string {
  assertBoundedText(
    sourceUrl,
    "external_source.source_url",
    ZERONE_LIMITS.max_source_url_bytes,
  );
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    invalid("external_source.source_url must be an absolute URL.", "external_source.source_url");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.hash !== ""
    || parsed.search !== ""
    || parsed.pathname !== `/v1/invocations/${sourceId}`
    || parsed.toString() !== sourceUrl
  ) {
    invalid(
      "external_source.source_url must be canonical HTTPS without credentials, query, or fragment and must name its invocation.",
      "external_source.source_url",
    );
  }
}

function encodeExternalSource(value: ZeroneExternalSource): Uint8Array {
  if (value.adapter_id !== "") {
    invalid(
      "external_source.adapter_id must stay empty because the pinned keeper hash does not bind it.",
      "external_source.adapter_id",
    );
  }
  assertUuid(value.source_id, "external_source.source_id");
  assertSourceUrl(value.source_url, value.source_id);
  if (
    !(value.content_hash instanceof Uint8Array)
    || value.content_hash.byteLength !== 32
  ) {
    invalid("external_source.content_hash must contain 32 bytes.", "external_source.content_hash");
  }
  assertUint64(value.fetched_at_block, "external_source.fetched_at_block");
  return concatBytes(
    // field 1 adapter_id is deliberately omitted at its empty proto3 default
    stringField(2, value.source_id),
    stringField(3, value.source_url),
    bytesField(4, value.content_hash),
    uintField(5, BigInt(value.fetched_at_block)),
  );
}

function decodeExternalSource(
  bytes: Uint8Array,
): Readonly<ZeroneExternalSource> {
  const fields = decodeFields(bytes, ZERONE_LIMITS.max_message_bytes);
  const expected = fields.at(-1)?.number === 5 ? [2, 3, 4, 5] : [2, 3, 4];
  assertFieldSequence(fields, expected, "external_source");
  const sourceId = decodeUtf8(
    requireBytesField(fields[0], 2, "external_source.source_id"),
    "external_source.source_id",
  );
  const sourceUrl = decodeUtf8(
    requireBytesField(fields[1], 3, "external_source.source_url"),
    "external_source.source_url",
  );
  const contentHash = requireBytesField(
    fields[2],
    4,
    "external_source.content_hash",
  );
  const fetchedAtBlock = fields.length === 4
    ? requireUintField(fields[3], 5, "external_source.fetched_at_block").toString()
    : "0";
  const value: ZeroneExternalSource = Object.freeze({
    adapter_id: "",
    source_id: sourceId,
    source_url: sourceUrl,
    content_hash: contentHash,
    fetched_at_block: fetchedAtBlock,
  });
  assertCanonicalProtobuf(bytes, encodeExternalSource(value), "external_source");
  return value;
}

function bigEndian32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function bigEndian64(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, false);
  return bytes;
}

function lengthPrefixed(value: Uint8Array): Uint8Array {
  if (value.byteLength > 0xffff_ffff) {
    invalid("Link-hash component exceeds uint32 length.");
  }
  return concatBytes(bigEndian32(value.byteLength), value);
}

/**
 * Exact pinned `keeper.ComputeLinkHash` recipe for the supported witness-only
 * subset. Source URL and source.adapter_id are deliberately absent because the
 * chain keeper does not include them.
 */
export function computeZeroneWitnessLinkHash(value: {
  readonly adapter_id: typeof AGENTTOOL_ADAPTER_ID;
  readonly source: ZeroneExternalSource;
}): Uint8Array {
  if (value.adapter_id !== AGENTTOOL_ADAPTER_ID) {
    invalid("Only the AgentTool invocation adapter is supported.", "link.adapter_id");
  }
  // Run every source check before hashing. This rejects the unbound source
  // adapter field instead of normalizing an arbitrary value silently.
  encodeExternalSource(value.source);
  return sha256(concatBytes(
    lengthPrefixed(new TextEncoder().encode(value.adapter_id)),
    lengthPrefixed(new TextEncoder().encode(value.source.source_id)),
    lengthPrefixed(value.source.content_hash),
    bigEndian64(BigInt(value.source.fetched_at_block)),
  ));
}

function encodeWitnessLink(value: ZeroneWitnessSubstrateLink): Uint8Array {
  if (value.adapter_id !== AGENTTOOL_ADAPTER_ID) {
    invalid("Only the AgentTool invocation adapter is supported.", "link.adapter_id");
  }
  if (
    !(value.link_hash instanceof Uint8Array)
    || value.link_hash.byteLength !== 32
  ) {
    invalid("link.link_hash must contain 32 bytes.", "link.link_hash");
  }
  const computed = computeZeroneWitnessLinkHash(value);
  if (!equalBytes(computed, value.link_hash)) {
    invalid(
      "link.link_hash does not match the pinned Zerone keeper recipe.",
      "link.link_hash",
    );
  }
  return concatBytes(
    // Fields 1..3 are unsupported in 0.1: cited facts, pending claims, weight.
    stringField(4, value.adapter_id),
    bytesField(5, encodeExternalSource(value.source)),
    bytesField(6, value.link_hash),
  );
}

function decodeWitnessLink(
  bytes: Uint8Array,
): Readonly<ZeroneWitnessSubstrateLink> {
  const fields = decodeFields(bytes, ZERONE_LIMITS.max_message_bytes);
  assertFieldSequence(fields, [4, 5, 6], "link");
  const adapterId = decodeUtf8(
    requireBytesField(fields[0], 4, "link.adapter_id"),
    "link.adapter_id",
  );
  if (adapterId !== AGENTTOOL_ADAPTER_ID) {
    invalid("Only the AgentTool invocation adapter is supported.", "link.adapter_id");
  }
  const source = decodeExternalSource(
    requireBytesField(fields[1], 5, "link.source"),
  );
  const linkHash = requireBytesField(fields[2], 6, "link.link_hash");
  const value: ZeroneWitnessSubstrateLink = Object.freeze({
    adapter_id: AGENTTOOL_ADAPTER_ID,
    source,
    link_hash: linkHash,
  });
  assertCanonicalProtobuf(bytes, encodeWitnessLink(value), "link");
  return value;
}

export function createZeroneWitnessLink(input: {
  readonly source_id: string;
  readonly source_url: string;
  readonly content_hash: Uint8Array;
  readonly fetched_at_block: string;
}): Readonly<ZeroneWitnessSubstrateLink> {
  const source: ZeroneExternalSource = Object.freeze({
    adapter_id: "",
    source_id: input.source_id,
    source_url: input.source_url,
    content_hash: Uint8Array.from(input.content_hash),
    fetched_at_block: input.fetched_at_block,
  });
  const linkHash = computeZeroneWitnessLinkHash({
    adapter_id: AGENTTOOL_ADAPTER_ID,
    source,
  });
  return Object.freeze({
    adapter_id: AGENTTOOL_ADAPTER_ID,
    source,
    link_hash: linkHash,
  });
}

export function encodeZeroneMsgSubmitExternalAttestation(
  value: ZeroneMsgSubmitExternalAttestation,
): Uint8Array {
  assertZeroneAddress(value.submitter, "attestation.submitter");
  if (
    value.adapter_id !== AGENTTOOL_ADAPTER_ID
    || value.work_class_id !== AGENTTOOL_WORK_CLASS_ID
    || value.link.adapter_id !== value.adapter_id
  ) {
    invalid(
      "Attestation must use the exact AgentTool adapter, work class, and matching link adapter.",
      "attestation",
    );
  }
  assertAtomicAmount(value.bond_uzrn, "attestation.bond_uzrn", {
    positive: true,
  });
  return concatBytes(
    stringField(1, value.submitter),
    stringField(2, value.adapter_id),
    stringField(3, value.work_class_id),
    bytesField(4, encodeWitnessLink(value.link)),
    stringField(5, value.bond_uzrn),
  );
}

export function decodeZeroneMsgSubmitExternalAttestation(
  bytes: Uint8Array,
): Readonly<ZeroneMsgSubmitExternalAttestation> {
  const fields = decodeFields(bytes, ZERONE_LIMITS.max_message_bytes);
  assertFieldSequence(fields, [1, 2, 3, 4, 5], "attestation");
  const submitter = decodeUtf8(
    requireBytesField(fields[0], 1, "attestation.submitter"),
    "attestation.submitter",
  );
  const adapterId = decodeUtf8(
    requireBytesField(fields[1], 2, "attestation.adapter_id"),
    "attestation.adapter_id",
  );
  const workClassId = decodeUtf8(
    requireBytesField(fields[2], 3, "attestation.work_class_id"),
    "attestation.work_class_id",
  );
  if (
    adapterId !== AGENTTOOL_ADAPTER_ID
    || workClassId !== AGENTTOOL_WORK_CLASS_ID
  ) {
    invalid("Attestation is outside the 0.1 AgentTool allowlist.", "attestation");
  }
  const link = decodeWitnessLink(
    requireBytesField(fields[3], 4, "attestation.link"),
  );
  const bond = decodeUtf8(
    requireBytesField(fields[4], 5, "attestation.bond_uzrn"),
    "attestation.bond_uzrn",
  );
  const value: ZeroneMsgSubmitExternalAttestation = Object.freeze({
    submitter,
    adapter_id: AGENTTOOL_ADAPTER_ID,
    work_class_id: AGENTTOOL_WORK_CLASS_ID,
    link,
    bond_uzrn: bond,
  });
  assertCanonicalProtobuf(
    bytes,
    encodeZeroneMsgSubmitExternalAttestation(value),
    "attestation",
  );
  return value;
}
