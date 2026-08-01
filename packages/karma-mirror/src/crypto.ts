import {
  createHash,
  randomBytes as systemRandomBytes,
  timingSafeEqual,
} from "node:crypto";

import type {
  MintedMirrorCredential,
  MirrorCredentialRecord,
} from "./types.js";

const PLACEMENT = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const MIRROR_TOKEN_PAYLOAD_BYTES = 20;
const MIRROR_TOKEN_TAG_BYTES = 12;
const MIRROR_TOKEN_BYTES = MIRROR_TOKEN_PAYLOAD_BYTES + MIRROR_TOKEN_TAG_BYTES;

function worldSeedForKeyHash(keySha256: string): string {
  return sha256Hex(`agenttool.karma-mirror-world/v1\0${keySha256}`);
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Bytes(value: string | Uint8Array): Uint8Array {
  return createHash("sha256").update(value).digest();
}

export function deriveHex(seed: string, label: string): string {
  return sha256Hex(`agenttool.karma-mirror/v1\0${seed}\0${label}`);
}

export function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function mirrorTokenTag(payload: Uint8Array): Uint8Array {
  return sha256Bytes(
    Buffer.concat([
      Buffer.from("agenttool.karma-mirror-token/v1\0", "utf8"),
      payload,
    ]),
  ).subarray(0, MIRROR_TOKEN_TAG_BYTES);
}

function encodeMarkedMirrorCredential(payload: Uint8Array): string {
  if (payload.byteLength !== MIRROR_TOKEN_PAYLOAD_BYTES) {
    throw new Error(`mirror credential payload must be ${MIRROR_TOKEN_PAYLOAD_BYTES} bytes`);
  }
  const bytes = new Uint8Array(MIRROR_TOKEN_BYTES);
  bytes.set(payload, 0);
  bytes.set(mirrorTokenTag(payload), MIRROR_TOKEN_PAYLOAD_BYTES);
  return `at_${base64url(bytes)}`;
}

export function isMarkedMirrorCredential(token: string): boolean {
  if (!/^at_[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const encoded = token.slice(3);
  const bytes = Buffer.from(encoded, "base64url");
  if (
    bytes.byteLength !== MIRROR_TOKEN_BYTES ||
    bytes.toString("base64url") !== encoded
  ) {
    return false;
  }
  const payload = bytes.subarray(0, MIRROR_TOKEN_PAYLOAD_BYTES);
  const actualTag = bytes.subarray(MIRROR_TOKEN_PAYLOAD_BYTES);
  return timingSafeEqual(actualTag, mirrorTokenTag(payload));
}

export function createMirrorInstanceSecret(): Uint8Array {
  return systemRandomBytes(32);
}

export function uuidFromHex(hex: string): string {
  if (!/^[0-9a-f]{32,}$/.test(hex)) throw new Error("uuid seed must be hex");
  const chars = hex.slice(0, 32).split("");
  chars[12] = "4";
  const variant = Number.parseInt(chars[16] ?? "0", 16);
  chars[16] = ((variant & 0x3) | 0x8).toString(16);
  const value = chars.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function validateCredentialRecord(record: MirrorCredentialRecord): void {
  if (record.schema !== "agenttool.karma-mirror-credential/v1") {
    throw new Error("unsupported mirror credential schema");
  }
  if (!/^[0-9a-f]{64}$/.test(record.key_sha256)) {
    throw new Error("key_sha256 must be lowercase SHA-256 hex");
  }
  if (!/^at_[A-Za-z0-9_-]{8}$/.test(record.key_prefix)) {
    throw new Error("key_prefix must be an AgentTool-shaped 11-character prefix");
  }
  if (!PLACEMENT.test(record.placement)) {
    throw new Error("placement must be a bounded lowercase slug");
  }
  if (!/^[0-9a-f]{64}$/.test(record.world_seed)) {
    throw new Error("world_seed must be lowercase SHA-256 hex");
  }
  if (record.world_seed !== worldSeedForKeyHash(record.key_sha256)) {
    throw new Error("world_seed must be canonically bound to key_sha256");
  }
  const created = new Date(record.created_at);
  if (!Number.isFinite(created.getTime()) || created.toISOString() !== record.created_at) {
    throw new Error("created_at must be a canonical ISO timestamp");
  }
}

export function mintMirrorCredential(args: {
  placement: string;
  now?: Date;
}): MintedMirrorCredential {
  if (!PLACEMENT.test(args.placement)) {
    throw new Error("placement must be a bounded lowercase slug");
  }
  // Exact ordinary AgentTool bearer shape with an invisible public-domain
  // self-marker in the decoded tail. The marker is not a signature or secret;
  // it prevents accidental admission of ordinary random production bearers.
  const key = encodeMarkedMirrorCredential(
    systemRandomBytes(MIRROR_TOKEN_PAYLOAD_BYTES),
  );
  const keySha256 = sha256Hex(key);
  const record: MirrorCredentialRecord = {
    schema: "agenttool.karma-mirror-credential/v1",
    key_sha256: keySha256,
    key_prefix: key.slice(0, 11),
    placement: args.placement,
    world_seed: worldSeedForKeyHash(keySha256),
    created_at: (args.now ?? new Date()).toISOString(),
  };
  return { key, record };
}

export function deriveChildKey(
  instanceSecret: Uint8Array,
  worldSeed: string,
  slot: number,
): string {
  if (instanceSecret.byteLength !== 32) {
    throw new Error("mirror instance secret must be 32 bytes");
  }
  if (!Number.isInteger(slot) || slot < 1) throw new Error("child slot must be positive");
  const payload = sha256Bytes(
    Buffer.concat([
      Buffer.from("agenttool.karma-mirror-child/v1\0", "utf8"),
      instanceSecret,
      Buffer.from(`\0${worldSeed}\0${slot}`, "utf8"),
    ]),
  ).subarray(0, MIRROR_TOKEN_PAYLOAD_BYTES);
  return encodeMarkedMirrorCredential(payload);
}
