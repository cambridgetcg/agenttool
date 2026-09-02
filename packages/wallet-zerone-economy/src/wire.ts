import {
  concatBytes,
  equalBytes,
} from "@agenttool/wallet";
import { assertSecp256k1PublicKey } from "@agenttool/wallet-zerone";

import {
  COSMOS_SECP256K1_PUBLIC_KEY_TYPE_URL,
  ECONOMY_LIMITS,
  ZERONE_DENOM,
} from "./constants.js";
import { fail } from "./errors.js";
import { assertAtomicAmount, assertBoundedText } from "./validation.js";
import type { ZeroneEconomyCoin } from "./types.js";

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const MAX_FIELD_NUMBER = (1 << 29) - 1;

export type WireField =
  | Readonly<{ number: number; wireType: 0; value: bigint }>
  | Readonly<{ number: number; wireType: 2; value: Uint8Array }>;

export interface EconomyProtoAny {
  readonly typeUrl: string;
  readonly value: Uint8Array;
}

export interface DecodedEconomyAuthInfo {
  readonly publicKey: Uint8Array;
  readonly sequence: string;
  readonly feeAmount: string;
  readonly gasLimit: string;
}

export interface DecodedEconomySignDoc {
  readonly bodyBytes: Uint8Array;
  readonly authInfoBytes: Uint8Array;
  readonly chainId: string;
  readonly accountNumber: string;
}

export interface DecodedEconomyTxRaw {
  readonly bodyBytes: Uint8Array;
  readonly authInfoBytes: Uint8Array;
  readonly signature: Uint8Array;
}

export function encodeVarint(value: bigint): Uint8Array {
  if (value < 0n || value > ECONOMY_LIMITS.max_uint64) {
    fail("invalid_input", "Protobuf varint is outside uint64.");
  }
  const bytes: number[] = [];
  let remaining = value;
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining !== 0n) byte |= 0x80;
    bytes.push(byte);
  } while (remaining !== 0n);
  return Uint8Array.from(bytes);
}

function encodeTag(fieldNumber: number, wireType: 0 | 2): Uint8Array {
  if (
    !Number.isSafeInteger(fieldNumber)
    || fieldNumber <= 0
    || fieldNumber > MAX_FIELD_NUMBER
  ) {
    fail("invalid_input", "Protobuf field number is invalid.");
  }
  return encodeVarint((BigInt(fieldNumber) << 3n) | BigInt(wireType));
}

export function uintField(
  fieldNumber: number,
  value: bigint,
  options?: { readonly emitZero?: boolean },
): Uint8Array {
  if (value === 0n && options?.emitZero !== true) return new Uint8Array();
  return concatBytes(encodeTag(fieldNumber, 0), encodeVarint(value));
}

export function bytesField(
  fieldNumber: number,
  value: Uint8Array,
  options?: { readonly emitEmpty?: boolean },
): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    fail("invalid_input", "Protobuf bytes field must be Uint8Array.");
  }
  if (value.byteLength === 0 && options?.emitEmpty !== true) {
    return new Uint8Array();
  }
  return concatBytes(
    encodeTag(fieldNumber, 2),
    encodeVarint(BigInt(value.byteLength)),
    value,
  );
}

export function stringField(fieldNumber: number, value: string): Uint8Array {
  if (typeof value !== "string" || value.includes("\0")) {
    fail("invalid_input", "Protobuf string field is invalid.");
  }
  return bytesField(fieldNumber, UTF8_ENCODER.encode(value));
}

function readVarint(
  bytes: Uint8Array,
  start: number,
): Readonly<{ value: bigint; next: number }> {
  let value = 0n;
  let shift = 0n;
  let index = start;
  for (; index < bytes.byteLength && index - start < 10; index += 1) {
    const byte = bytes[index]!;
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      const next = index + 1;
      if (!equalBytes(encodeVarint(value), bytes.subarray(start, next))) {
        fail("invalid_input", "Protobuf varint is not minimally encoded.");
      }
      return Object.freeze({ value, next });
    }
    shift += 7n;
  }
  fail("invalid_input", "Protobuf varint is truncated or exceeds uint64.");
}

export function decodeFields(
  bytes: Uint8Array,
  maxBytes = ECONOMY_LIMITS.max_transaction_bytes,
): readonly WireField[] {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength > maxBytes) {
    fail("invalid_input", "Protobuf message exceeds its byte boundary.");
  }
  const fields: WireField[] = [];
  let offset = 0;
  while (offset < bytes.byteLength) {
    const tag = readVarint(bytes, offset);
    offset = tag.next;
    const wireType = Number(tag.value & 0x7n);
    const fieldNumber = Number(tag.value >> 3n);
    if (
      fieldNumber <= 0
      || fieldNumber > MAX_FIELD_NUMBER
      || (wireType !== 0 && wireType !== 2)
    ) {
      fail("invalid_input", "Protobuf message contains an unsupported field or wire type.");
    }
    if (wireType === 0) {
      const parsed = readVarint(bytes, offset);
      offset = parsed.next;
      fields.push(Object.freeze({
        number: fieldNumber,
        wireType: 0,
        value: parsed.value,
      }));
      continue;
    }
    const length = readVarint(bytes, offset);
    offset = length.next;
    if (length.value > BigInt(maxBytes)) {
      fail("invalid_input", "Protobuf field exceeds its byte boundary.");
    }
    const end = offset + Number(length.value);
    if (end > bytes.byteLength) {
      fail("invalid_input", "Protobuf length-delimited field is truncated.");
    }
    fields.push(Object.freeze({
      number: fieldNumber,
      wireType: 2,
      value: Uint8Array.from(bytes.subarray(offset, end)),
    }));
    offset = end;
  }
  return Object.freeze(fields);
}

export function decodeUtf8(value: Uint8Array, path: string): string {
  let decoded: string;
  try {
    decoded = UTF8_DECODER.decode(value);
  } catch {
    fail("invalid_input", `${path} is not valid UTF-8.`, path);
  }
  if (
    decoded.includes("\0")
    || !equalBytes(UTF8_ENCODER.encode(decoded), value)
  ) {
    fail("invalid_input", `${path} is not canonical UTF-8.`, path);
  }
  return decoded;
}

export function requireBytesField(
  field: WireField | undefined,
  fieldNumber: number,
  path: string,
): Uint8Array {
  if (
    field === undefined
    || field.number !== fieldNumber
    || field.wireType !== 2
  ) {
    fail("invalid_input", `${path} is missing or has the wrong protobuf wire type.`, path);
  }
  return Uint8Array.from(field.value);
}

export function requireUintField(
  field: WireField | undefined,
  fieldNumber: number,
  path: string,
): bigint {
  if (
    field === undefined
    || field.number !== fieldNumber
    || field.wireType !== 0
  ) {
    fail("invalid_input", `${path} is missing or has the wrong protobuf wire type.`, path);
  }
  return field.value;
}

function assertFieldSequence(
  fields: readonly WireField[],
  expected: readonly number[],
  path: string,
): void {
  if (
    fields.length !== expected.length
    || fields.some((field, index) => field.number !== expected[index])
  ) {
    fail(
      "invalid_input",
      `${path} has unsupported, missing, duplicated, or reordered protobuf fields.`,
      path,
    );
  }
}

export function assertCanonicalProtobuf(
  original: Uint8Array,
  encoded: Uint8Array,
  path: string,
): void {
  if (!equalBytes(original, encoded)) {
    fail("invalid_input", `${path} must use canonical protobuf encoding.`, path);
  }
}

export function encodeEconomyAny(value: EconomyProtoAny): Uint8Array {
  assertBoundedText(value.typeUrl, "any.type_url", 256);
  if (!value.typeUrl.startsWith("/") || value.value.byteLength === 0) {
    fail("invalid_input", "Any requires a slash-prefixed type URL and non-empty value.", "any");
  }
  return concatBytes(
    stringField(1, value.typeUrl),
    bytesField(2, value.value),
  );
}

export function decodeEconomyAny(bytes: Uint8Array, path: string): EconomyProtoAny {
  const fields = decodeFields(bytes);
  assertFieldSequence(fields, [1, 2], path);
  const any = Object.freeze({
    typeUrl: decodeUtf8(requireBytesField(fields[0], 1, `${path}.type_url`), `${path}.type_url`),
    value: requireBytesField(fields[1], 2, `${path}.value`),
  });
  assertCanonicalProtobuf(bytes, encodeEconomyAny(any), path);
  return any;
}

function encodeCoin(coin: ZeroneEconomyCoin): Uint8Array {
  if (coin.denom !== ZERONE_DENOM) {
    fail("invalid_input", "Fee coin must use uzrn.", "fee.denom");
  }
  assertAtomicAmount(coin.amount, "fee.amount");
  return concatBytes(stringField(1, coin.denom), stringField(2, coin.amount));
}

function decodeCoin(bytes: Uint8Array, path: string): ZeroneEconomyCoin {
  const fields = decodeFields(bytes);
  assertFieldSequence(fields, [1, 2], path);
  const denom = decodeUtf8(requireBytesField(fields[0], 1, `${path}.denom`), `${path}.denom`);
  const amount = decodeUtf8(requireBytesField(fields[1], 2, `${path}.amount`), `${path}.amount`);
  if (denom !== ZERONE_DENOM) {
    fail("invalid_input", `${path}.denom must be uzrn.`, `${path}.denom`);
  }
  const coin: ZeroneEconomyCoin = Object.freeze({ denom: ZERONE_DENOM, amount });
  assertCanonicalProtobuf(bytes, encodeCoin(coin), path);
  return coin;
}

function encodePublicKey(publicKey: Uint8Array): Uint8Array {
  assertSecp256k1PublicKey(publicKey);
  return bytesField(1, publicKey);
}

function decodePublicKey(bytes: Uint8Array): Uint8Array {
  const fields = decodeFields(bytes);
  assertFieldSequence(fields, [1], "public_key");
  const publicKey = requireBytesField(fields[0], 1, "public_key.key");
  assertSecp256k1PublicKey(publicKey);
  assertCanonicalProtobuf(bytes, encodePublicKey(publicKey), "public_key");
  return publicKey;
}

export function encodeEconomyTxBody(messages: readonly EconomyProtoAny[]): Uint8Array {
  if (messages.length < 1 || messages.length > ECONOMY_LIMITS.max_messages) {
    fail("invalid_input", "TxBody must contain one through three economy messages.", "messages");
  }
  return concatBytes(...messages.map((message) => bytesField(1, encodeEconomyAny(message))));
}

export function decodeEconomyTxBody(bytes: Uint8Array): readonly EconomyProtoAny[] {
  const fields = decodeFields(bytes);
  if (
    fields.length < 1
    || fields.length > ECONOMY_LIMITS.max_messages
    || fields.some((field) => field.number !== 1 || field.wireType !== 2)
  ) {
    fail("invalid_input", "TxBody contains unsupported fields or message count.", "tx_body");
  }
  const messages = fields.map((field, index) => decodeEconomyAny(
    requireBytesField(field, 1, `tx_body.messages[${index}]`),
    `tx_body.messages[${index}]`,
  ));
  assertCanonicalProtobuf(bytes, encodeEconomyTxBody(messages), "tx_body");
  return Object.freeze(messages);
}

function encodeModeInfoDirect(): Uint8Array {
  return bytesField(1, uintField(1, 1n));
}

function encodeSignerInfo(publicKey: Uint8Array, sequence: bigint): Uint8Array {
  return concatBytes(
    bytesField(1, encodeEconomyAny({
      typeUrl: COSMOS_SECP256K1_PUBLIC_KEY_TYPE_URL,
      value: encodePublicKey(publicKey),
    })),
    bytesField(2, encodeModeInfoDirect()),
    uintField(3, sequence),
  );
}

function encodeFee(fee: ZeroneEconomyCoin, gasLimit: bigint): Uint8Array {
  return concatBytes(
    bytesField(1, encodeCoin(fee)),
    uintField(2, gasLimit),
  );
}

export function encodeEconomyAuthInfo(
  publicKey: Uint8Array,
  sequence: bigint,
  fee: ZeroneEconomyCoin,
  gasLimit: bigint,
): Uint8Array {
  return concatBytes(
    bytesField(1, encodeSignerInfo(publicKey, sequence)),
    bytesField(2, encodeFee(fee, gasLimit)),
  );
}

export function decodeEconomyAuthInfo(bytes: Uint8Array): DecodedEconomyAuthInfo {
  const fields = decodeFields(bytes);
  assertFieldSequence(fields, [1, 2], "auth_info");
  const signerFields = decodeFields(
    requireBytesField(fields[0], 1, "auth_info.signer_infos[0]"),
  );
  const signerExpected = signerFields.at(-1)?.number === 3 ? [1, 2, 3] : [1, 2];
  assertFieldSequence(signerFields, signerExpected, "signer_info");
  const publicKeyAny = decodeEconomyAny(
    requireBytesField(signerFields[0], 1, "signer_info.public_key"),
    "signer_info.public_key",
  );
  if (publicKeyAny.typeUrl !== COSMOS_SECP256K1_PUBLIC_KEY_TYPE_URL) {
    fail("invalid_input", "SignerInfo must use the Cosmos secp256k1 public key type.");
  }
  const publicKey = decodePublicKey(publicKeyAny.value);
  const modeInfoFields = decodeFields(
    requireBytesField(signerFields[1], 2, "signer_info.mode_info"),
  );
  assertFieldSequence(modeInfoFields, [1], "mode_info");
  const singleFields = decodeFields(
    requireBytesField(modeInfoFields[0], 1, "mode_info.single"),
  );
  assertFieldSequence(singleFields, [1], "mode_info.single");
  if (requireUintField(singleFields[0], 1, "mode_info.single.mode") !== 1n) {
    fail("invalid_input", "Only SIGN_MODE_DIRECT is supported.");
  }
  const sequence = signerFields.length === 3
    ? requireUintField(signerFields[2], 3, "signer_info.sequence")
    : 0n;
  const feeFields = decodeFields(requireBytesField(fields[1], 2, "auth_info.fee"));
  const feeExpected = feeFields.at(-1)?.number === 2 ? [1, 2] : [1];
  assertFieldSequence(feeFields, feeExpected, "fee");
  const fee = decodeCoin(requireBytesField(feeFields[0], 1, "fee.amount[0]"), "fee.amount[0]");
  const gasLimit = feeFields.length === 2
    ? requireUintField(feeFields[1], 2, "fee.gas_limit")
    : 0n;
  assertCanonicalProtobuf(
    bytes,
    encodeEconomyAuthInfo(publicKey, sequence, fee, gasLimit),
    "auth_info",
  );
  return Object.freeze({
    publicKey,
    sequence: sequence.toString(),
    feeAmount: fee.amount,
    gasLimit: gasLimit.toString(),
  });
}

export function encodeEconomySignDoc(
  bodyBytes: Uint8Array,
  authInfoBytes: Uint8Array,
  chainReference: string,
  accountNumber: bigint,
): Uint8Array {
  assertBoundedText(chainReference, "sign_doc.chain_id", 128);
  return concatBytes(
    bytesField(1, bodyBytes),
    bytesField(2, authInfoBytes),
    stringField(3, chainReference),
    uintField(4, accountNumber),
  );
}

export function decodeEconomySignDoc(bytes: Uint8Array): DecodedEconomySignDoc {
  const fields = decodeFields(bytes);
  const expected = fields.at(-1)?.number === 4 ? [1, 2, 3, 4] : [1, 2, 3];
  assertFieldSequence(fields, expected, "sign_doc");
  const bodyBytes = requireBytesField(fields[0], 1, "sign_doc.body_bytes");
  const authInfoBytes = requireBytesField(fields[1], 2, "sign_doc.auth_info_bytes");
  const chainId = decodeUtf8(requireBytesField(fields[2], 3, "sign_doc.chain_id"), "sign_doc.chain_id");
  const accountNumber = fields.length === 4
    ? requireUintField(fields[3], 4, "sign_doc.account_number")
    : 0n;
  const decoded = Object.freeze({
    bodyBytes,
    authInfoBytes,
    chainId,
    accountNumber: accountNumber.toString(),
  });
  assertCanonicalProtobuf(
    bytes,
    encodeEconomySignDoc(bodyBytes, authInfoBytes, chainId, accountNumber),
    "sign_doc",
  );
  return decoded;
}

export function encodeEconomyTxRaw(
  bodyBytes: Uint8Array,
  authInfoBytes: Uint8Array,
  signature: Uint8Array,
): Uint8Array {
  return concatBytes(
    bytesField(1, bodyBytes),
    bytesField(2, authInfoBytes),
    bytesField(3, signature, { emitEmpty: true }),
  );
}

export function decodeEconomyTxRaw(bytes: Uint8Array): DecodedEconomyTxRaw {
  const fields = decodeFields(bytes);
  assertFieldSequence(fields, [1, 2, 3], "tx_raw");
  const decoded = Object.freeze({
    bodyBytes: requireBytesField(fields[0], 1, "tx_raw.body_bytes"),
    authInfoBytes: requireBytesField(fields[1], 2, "tx_raw.auth_info_bytes"),
    signature: requireBytesField(fields[2], 3, "tx_raw.signatures[0]"),
  });
  assertCanonicalProtobuf(
    bytes,
    encodeEconomyTxRaw(decoded.bodyBytes, decoded.authInfoBytes, decoded.signature),
    "tx_raw",
  );
  return decoded;
}
