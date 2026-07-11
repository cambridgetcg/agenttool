import { sha256 } from "@noble/hashes/sha2.js";

import { equalBytes } from "./bytes.js";
import { IntegrityError, InvalidCidError } from "./errors.js";

export type Cid = string;

const CID_VERSION = 0x01;
const RAW_CODEC = 0x55;
const SHA2_256_CODE = 0x12;
const SHA2_256_LENGTH = 0x20;
const CID_BYTES_LENGTH = 36;
const CID_STRING_LENGTH = 59;
const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

function base32Encode(bytes: Uint8Array): string {
  let output = "";
  let accumulator = 0;
  let bits = 0;
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32_ALPHABET[(accumulator >>> bits) & 31];
    }
    accumulator &= (1 << bits) - 1;
  }
  if (bits > 0) output += BASE32_ALPHABET[(accumulator << (5 - bits)) & 31];
  return output;
}

function base32Decode(value: string): Uint8Array {
  if (!/^[a-z2-7]+$/u.test(value)) throw new InvalidCidError("CID must use canonical base32lower.");
  const output: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const character of value) {
    const digit = BASE32_ALPHABET.indexOf(character);
    if (digit < 0) throw new InvalidCidError("CID contains an invalid base32lower character.");
    accumulator = (accumulator << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((accumulator >>> bits) & 0xff);
      accumulator &= (1 << bits) - 1;
    }
  }
  if (bits > 0 && accumulator !== 0) {
    throw new InvalidCidError("CID has non-zero base32 padding bits.");
  }
  return Uint8Array.from(output);
}

/** CIDv1, raw codec, sha2-256 multihash, encoded as base32lower multibase. */
export function cidForBytes(bytes: Uint8Array): Cid {
  const digest = sha256(bytes);
  const cidBytes = new Uint8Array(CID_BYTES_LENGTH);
  cidBytes.set([CID_VERSION, RAW_CODEC, SHA2_256_CODE, SHA2_256_LENGTH]);
  cidBytes.set(digest, 4);
  return `b${base32Encode(cidBytes)}`;
}

export function digestFromCid(cid: Cid): Uint8Array {
  if (typeof cid !== "string" || !cid.startsWith("b")) {
    throw new InvalidCidError("CID must be a base32lower CIDv1 beginning with 'b'.");
  }
  if (cid.length !== CID_STRING_LENGTH) {
    throw new InvalidCidError(`Raw sha2-256 CIDv1 must be exactly ${CID_STRING_LENGTH} characters.`);
  }
  const bytes = base32Decode(cid.slice(1));
  if (
    bytes.byteLength !== CID_BYTES_LENGTH ||
    bytes[0] !== CID_VERSION ||
    bytes[1] !== RAW_CODEC ||
    bytes[2] !== SHA2_256_CODE ||
    bytes[3] !== SHA2_256_LENGTH
  ) {
    throw new InvalidCidError("CID must be CIDv1 with raw codec and a 32-byte sha2-256 multihash.");
  }
  if (`b${base32Encode(bytes)}` !== cid) throw new InvalidCidError("CID is not canonically encoded.");
  return bytes.slice(4);
}

export function assertCidMatches(cid: Cid, bytes: Uint8Array): void {
  const expected = digestFromCid(cid);
  const actual = sha256(bytes);
  if (!equalBytes(expected, actual)) {
    throw new IntegrityError(`Block bytes do not match CID ${cid}.`);
  }
}
