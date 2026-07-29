import { concatBytes, equalBytes } from "@agenttool/wallet";

import { ZERONE_LIMITS } from "./constants.js";
import { invalid } from "./errors.js";

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const MAX_FIELD_NUMBER = (1 << 29) - 1;

export type WireField =
  | Readonly<{ number: number; wireType: 0; value: bigint }>
  | Readonly<{ number: number; wireType: 2; value: Uint8Array }>;

export function encodeVarint(value: bigint): Uint8Array {
  if (value < 0n || value > ZERONE_LIMITS.max_uint64) {
    invalid("Protobuf varint is outside uint64.");
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
    invalid("Protobuf field number is invalid.");
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
  if (!(value instanceof Uint8Array)) invalid("Protobuf bytes field must be Uint8Array.");
  if (value.byteLength === 0 && options?.emitEmpty !== true) return new Uint8Array();
  return concatBytes(
    encodeTag(fieldNumber, 2),
    encodeVarint(BigInt(value.byteLength)),
    value,
  );
}

export function stringField(
  fieldNumber: number,
  value: string,
): Uint8Array {
  if (typeof value !== "string" || value.includes("\0")) {
    invalid("Protobuf string field is invalid.");
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
      const canonical = encodeVarint(value);
      if (!equalBytes(canonical, bytes.subarray(start, next))) {
        invalid("Protobuf varint is not minimally encoded.");
      }
      return Object.freeze({ value, next });
    }
    shift += 7n;
  }
  invalid("Protobuf varint is truncated or exceeds uint64.");
}

export function decodeFields(
  bytes: Uint8Array,
  maxBytes = ZERONE_LIMITS.max_transaction_bytes,
): readonly WireField[] {
  if (
    !(bytes instanceof Uint8Array)
    || bytes.byteLength > maxBytes
  ) {
    invalid("Protobuf message exceeds its byte boundary.");
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
      invalid("Protobuf message contains an unsupported field or wire type.");
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
      invalid("Protobuf length-delimited field exceeds its byte boundary.");
    }
    const end = offset + Number(length.value);
    if (end > bytes.byteLength) {
      invalid("Protobuf length-delimited field is truncated.");
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
    invalid(`${path} is not valid UTF-8.`, path);
  }
  if (
    decoded.includes("\0")
    || !equalBytes(UTF8_ENCODER.encode(decoded), value)
  ) {
    invalid(`${path} is not canonical UTF-8.`, path);
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
    invalid(`${path} is missing or has the wrong protobuf wire type.`, path);
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
    invalid(`${path} is missing or has the wrong protobuf wire type.`, path);
  }
  return field.value;
}

export function assertCanonicalProtobuf(
  original: Uint8Array,
  encoded: Uint8Array,
  path: string,
): void {
  if (!equalBytes(original, encoded)) {
    invalid(`${path} must use the canonical adapter protobuf encoding.`, path);
  }
}
