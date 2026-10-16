/** Wire formats the fleet hall shares with the hosted mission service and the
 * reviewed participant client (bin/agenttool-mission.mjs).
 *
 * Pure: no I/O. The formats are ported, not imported, so this package stays
 * hermetic: it imports nothing from api/ or bin/. bin/tests/lobby-fleet-gateway.test.ts
 * runs these exact bytes through the API's own mission gateway, proof and
 * enrollment code in process.
 *
 * Sources ported: api/src/services/collaboration/contracts.ts (bounds, headers),
 * proof.ts (exact-request digest), correspondence/canonical.ts (descriptor
 * canonical JSON), identity/enrollment.ts (identity-enrollment/v1 digest).
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { LobbyError } from "./errors.js";
import { fingerprintOf } from "./pins.js";

/** The only service origin the fleet hall talks to. There is no flag or
 * environment variable that changes it; tests inject a fake fetch instead. */
export const LOBBY_ORIGIN = "https://api.agenttool.dev" as const;

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
/** The service's exact participant token shape: atcm_ + canonical base64url of 32 bytes. */
export const GRANT_TOKEN_PATTERN = /^atcm_[A-Za-z0-9_-]{43}$/;
/** A project bearer as the gateway accepts it for administrator calls. */
export const BEARER_PATTERN = /^at_[A-Za-z0-9_-]{1,253}$/;

export const MISSION_LIMITS = Object.freeze({
  /** Observation summary, in Unicode scalar values (contracts.ts missionObservationSchema). */
  summaryScalars: 1000,
  requestBytes: 8192,
  descriptorBytes: 32_768,
  grantMs: 86_400_000,
  missionMs: 30 * 86_400_000,
  proofWindowMs: 300_000,
  pageMax: 50,
  responseBytes: 1_048_576,
});

export const ENROLLMENT_LIMITS = Object.freeze({
  windowMs: 300_000,
  maxBytes: 16_384,
  displayName: 128,
  capabilities: 32,
  capability: 64,
});

export const MISSION_REQUEST_DOMAIN = "agenttool-collaboration-request/v1";
export const ENROLLMENT_DOMAIN = "identity-enrollment/v1";
export const ENROLLMENT_PATH = "/v1/identities/enroll";
export const ENROLLMENT_SIGNATURE_HEADER = "X-Agenttool-Enrollment-Signature";
export const ENROLLMENT_BODY_FORMAT = "agenttool-identity-enrollment/v1";
export const ENROLLMENT_REQUEST_FORMAT = "agenttool-identity-enrollment-request/v1";
export const MISSION_DESCRIPTOR_FORMAT = "agenttool-collaboration-mission/v1";
export const INVITATION_TEMPLATE_FORMAT = "agenttool-mission-invitation-template/v1";
export const PARTICIPANT_TOKEN_FORMAT = "agenttool-mission-participant-token/v1";
export const MISSIONS_PATH = "/v1/collaboration/missions";

export const MISSION_PROOF_HEADERS = Object.freeze({
  grantId: "X-Agenttool-Mission-Grant-Id",
  identityId: "X-Agenttool-Mission-Identity-Id",
  keyId: "X-Agenttool-Mission-Key-Id",
  timestamp: "X-Agenttool-Mission-Timestamp",
  signature: "X-Agenttool-Mission-Signature",
});

export type MissionAction = "mission.read" | "mission.observe";

/** One stored mission event as the service lists it (store.ts eventMetadata),
 * minus the service's parsed `observation` projection: the signed raw body is
 * the only content the desk reads. */
export interface MissionEvent {
  event_id: string;
  mission_id: string;
  grant_id: string;
  identity_id: string;
  signing_key_id: string;
  received_seq: string;
  received_at: string;
  raw_body: string;
  body_sha256: string;
  proof: Record<string, string>;
}

// ── Hashing and encodings ──────────────────────────────────────────────

export function sha256Bytes(value: string | Uint8Array): Buffer {
  return createHash("sha256").update(value).digest();
}

export function sha256HexOf(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function isCanonicalBase64(value: unknown, bytes: number, encoding: "base64" | "base64url"): value is string {
  if (typeof value !== "string") return false;
  const decoded = Buffer.from(value, encoding);
  return decoded.length === bytes && decoded.toString(encoding) === value;
}

// ── Identifiers, times and text ────────────────────────────────────────

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function assertUuid(value: unknown, field: string): string {
  if (!isUuid(value)) throw new LobbyError(`invalid_${field}`, `${field} must be a lowercase UUID`);
  return value;
}

export function newUuid(): string {
  return crypto.randomUUID();
}

export function isDigest(value: unknown): value is string {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}

export function assertDigest(value: unknown, field: string): string {
  if (!isDigest(value)) throw new LobbyError(`invalid_${field}`, `${field} must be sha256: followed by 64 lowercase hex`);
  return value;
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX_PATTERN.test(value);
}

/** A canonical UTC timestamp with millisecond precision, as the service checks. */
export function isCanonicalTime(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 24) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

export function assertCanonicalTime(value: unknown, field: string): string {
  if (!isCanonicalTime(value)) {
    throw new LobbyError(`invalid_${field}`, `${field} must be a canonical UTC timestamp with milliseconds`);
  }
  return value;
}

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

/** True when the string has no lone surrogate (String.prototype.isWellFormed). */
export function isWellFormed(value: string): boolean {
  return !LONE_SURROGATE.test(value);
}

/** Well-formed, NUL-free text of 1..max Unicode scalar values (the service's boundedText). */
export function isBoundedText(value: unknown, max: number): value is string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) return false;
  if (!isWellFormed(value)) return false;
  let count = 0;
  for (const _ of value) {
    count += 1;
    if (count > max) return false;
  }
  return true;
}

export function scalarLength(value: string): number {
  let count = 0;
  for (const _ of value) count += 1;
  return count;
}

// ── Canonical JSON for mission descriptors and signed lobby documents ──

/** Byte-for-byte port of the service's canonical JSON profile
 * (correspondence/canonical.ts): null, booleans, strings, arrays, objects and
 * safe integers; keys sorted by UTF-16 code units; JSON string escaping.
 * Unlike canonicalJson in canonical.ts it builds the string explicitly, so
 * integer-like object keys keep string order. */
export function wireCanonicalJson(value: unknown): string {
  return canonicalValue(value, 0);
}

function canonicalValue(value: unknown, depth: number): string {
  if (depth > 64) throw new LobbyError("invalid_json", "JSON nesting is too deep");
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new LobbyError("invalid_json", "only safe integers are allowed");
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    if (!isWellFormed(value)) throw new LobbyError("invalid_json", "strings must be well-formed Unicode");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalValue(item, depth + 1)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => {
        if (record[key] === undefined) throw new LobbyError("invalid_json", "undefined values are not JSON");
        return `${JSON.stringify(key)}:${canonicalValue(record[key], depth + 1)}`;
      })
      .join(",")}}`;
  }
  throw new LobbyError("invalid_json", "value is not JSON");
}

/** Parse JSON that must already be in canonical form: duplicate keys,
 * whitespace and non-canonical spellings are refused because the parsed
 * value would not re-encode to the same text. */
export function parseCanonicalJson(text: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LobbyError("invalid_json", "not valid JSON");
  }
  let again: string;
  try {
    again = wireCanonicalJson(parsed);
  } catch {
    throw new LobbyError("invalid_json", "not canonical JSON");
  }
  if (again !== text) throw new LobbyError("invalid_json", "not canonical JSON");
  return parsed;
}

// ── Mission descriptors ────────────────────────────────────────────────

export interface MissionReference {
  uri: string;
  format: string;
  digest: string;
}

export interface MissionDescriptor {
  format: typeof MISSION_DESCRIPTOR_FORMAT;
  purpose: string;
  resources: MissionReference[];
  acceptance_criteria: string[];
  principalities: MissionReference[];
}

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function validReference(value: unknown): value is MissionReference {
  return exactKeys(value, ["uri", "format", "digest"])
    && isBoundedText(value.uri, 1024)
    && /^(?:https:\/\/|urn:)[^\s]+$/.test(value.uri as string)
    && isBoundedText(value.format, 128)
    && isDigest(value.digest);
}

/** Strict check of the service's descriptor schema (missionDescriptorSchema). */
export function validateMissionDescriptor(value: unknown): MissionDescriptor {
  if (!exactKeys(value, ["format", "purpose", "resources", "acceptance_criteria", "principalities"])
    || value.format !== MISSION_DESCRIPTOR_FORMAT
    || !isBoundedText(value.purpose, 2000)
    || !Array.isArray(value.resources) || value.resources.length > 20 || !value.resources.every(validReference)
    || !Array.isArray(value.acceptance_criteria) || value.acceptance_criteria.length < 1
    || value.acceptance_criteria.length > 20
    || !value.acceptance_criteria.every((item) => isBoundedText(item, 1000))
    || !Array.isArray(value.principalities) || value.principalities.length > 20
    || !value.principalities.every(validReference)) {
    throw new LobbyError("invalid_descriptor", "the mission descriptor does not match agenttool-collaboration-mission/v1");
  }
  const descriptor = structuredClone(value) as unknown as MissionDescriptor;
  if (Buffer.byteLength(wireCanonicalJson(descriptor)) > MISSION_LIMITS.descriptorBytes) {
    throw new LobbyError("invalid_descriptor", "the mission descriptor exceeds 32768 canonical bytes");
  }
  return descriptor;
}

/** sha256:<hex> of the descriptor's canonical JSON, as the service stores it. */
export function missionDigest(descriptor: MissionDescriptor): string {
  return `sha256:${sha256HexOf(wireCanonicalJson(descriptor))}`;
}

// ── Participant grant tokens ───────────────────────────────────────────

export function isGrantToken(value: unknown): value is string {
  return typeof value === "string"
    && GRANT_TOKEN_PATTERN.test(value)
    && Buffer.from(value.slice(5), "base64url").toString("base64url") === value.slice(5);
}

/** atcm_ + 43 base64url characters from 32 fresh random bytes. */
export function newGrantToken(): { token: string; token_sha256: string } {
  const token = `atcm_${randomBytes(32).toString("base64url")}`;
  if (!isGrantToken(token)) throw new LobbyError("token_shape", "generated token does not match the service shape");
  return { token, token_sha256: sha256HexOf(token) };
}

// ── Exact-request proof (proof.ts) and enrollment digest (enrollment.ts) ──

export interface RequestDigestInput {
  origin: string;
  method: "GET" | "POST";
  target: string;
  missionId: string;
  grantId: string;
  identityId: string;
  keyId: string;
  body: string | Uint8Array;
  timestamp: string;
}

/** The 32 digest bytes a participant signs for one mission request. */
export function requestDigest(input: RequestDigestInput): Buffer {
  if (!input.target.startsWith(`${MISSIONS_PATH}/${input.missionId}/`) || input.target.includes("\0") || input.target.includes("#")) {
    throw new LobbyError("invalid_request_target", "not a participant mission request target");
  }
  for (const [field, value] of [["mission_id", input.missionId], ["grant_id", input.grantId],
    ["identity_id", input.identityId], ["signing_key_id", input.keyId]] as const) {
    assertUuid(value, field);
  }
  assertCanonicalTime(input.timestamp, "timestamp");
  return sha256Bytes([MISSION_REQUEST_DOMAIN, input.origin, input.method, input.target, input.missionId,
    input.grantId, input.identityId, input.keyId, sha256HexOf(input.body), input.timestamp].join("\0"));
}

/** The 32 digest bytes an enrolling root signs for identity-enrollment/v1. */
export function enrollmentDigest(input: { origin: string; projectId: string; bodyBytes: Uint8Array }): Buffer {
  assertUuid(input.projectId, "project_id");
  return sha256Bytes([ENROLLMENT_DOMAIN, "POST", ENROLLMENT_PATH, input.origin, input.projectId,
    sha256HexOf(input.bodyBytes)].join("\0"));
}

// ── Ed25519 keys ───────────────────────────────────────────────────────

const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export function generateKeyPair(): KeyObject {
  return generateKeyPairSync("ed25519").privateKey;
}

/** Rebuild a private key from its 32-byte seed (kept in the Keychain as base64url). */
export function privateKeyFromSeed(seed: Uint8Array): KeyObject {
  if (seed.length !== 32) throw new LobbyError("invalid_key", "an Ed25519 seed is 32 bytes");
  return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(seed)]), format: "der", type: "pkcs8" });
}

export function seedOf(privateKey: KeyObject): Buffer {
  const jwk = privateKey.export({ format: "jwk" });
  if (jwk.crv !== "Ed25519" || typeof jwk.d !== "string") throw new LobbyError("invalid_key", "expected an Ed25519 private key");
  return Buffer.from(jwk.d, "base64url");
}

/** Standard padded base64 of the raw 32-byte public key (a private JWK carries x). */
export function publicKeyBase64(privateKey: KeyObject): string {
  const jwk = privateKey.export({ format: "jwk" });
  if (jwk.crv !== "Ed25519" || typeof jwk.x !== "string") throw new LobbyError("invalid_key", "expected an Ed25519 key");
  return Buffer.from(jwk.x, "base64url").toString("base64");
}

export function rawPublicKey(publicKey: string): Buffer {
  if (!isCanonicalBase64(publicKey, 32, "base64")) {
    throw new LobbyError("invalid_public_key", "expected a standard-base64 Ed25519 public key");
  }
  return Buffer.from(publicKey, "base64");
}

export function publicKeyFingerprint(publicKey: string): string {
  return fingerprintOf(rawPublicKey(publicKey));
}

function publicKeyObject(publicKey: string): KeyObject {
  return createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: rawPublicKey(publicKey).toString("base64url") },
    format: "jwk",
  });
}

export function signBytes(privateKey: KeyObject, bytes: Uint8Array): Buffer {
  return sign(null, bytes, privateKey);
}

export function verifyBytes(publicKey: string, bytes: Uint8Array, signature: Uint8Array): boolean {
  try {
    return signature.length === 64 && verify(null, bytes, publicKeyObject(publicKey), signature);
  } catch {
    return false;
  }
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58btc(bytes: Uint8Array): string {
  let value = BigInt(`0x${Buffer.from(bytes).toString("hex") || "0"}`);
  let out = "";
  while (value > 0n) {
    out = BASE58[Number(value % 58n)]! + out;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/** did:key for a raw Ed25519 public key (multicodec 0xed01, base58btc). Used
 * only to name a pinned door key in the pin book; it carries no authority. */
export function didKeyOf(publicKey: string): string {
  return `did:key:z${base58btc(Buffer.concat([Buffer.from([0xed, 0x01]), rawPublicKey(publicKey)]))}`;
}
