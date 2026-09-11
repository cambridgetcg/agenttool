/** Closed public candidate data; no I/O. Doctrine: docs/specs/ZERONE-SEED-IO-0.1.md */
import { base64UrlDecode, base64UrlEncode, canonicalJsonBytes, snapshotJsonData } from "@agenttool/wallet";
import { invalid, mismatch } from "../errors.js";
import { assertSecp256k1PublicKey, assertZeroneAddress } from "../profiles.js";
import { assertUint64 } from "../validation.js";
import type { SeedProfile, SeedReadEvidence } from "./types.js";

export { invalid, mismatch, assertUint64 };
export const UINT256_MAX = (1n << 256n) - 1n;
export const MAX_UNSIGNED_BYTES = 16_384;

/** Snapshot data descriptors before access; reject getters rather than execute them. */
export function snapshot<T>(value: T): T {
  const result = snapshotJsonData(value);
  let nodes = 0;
  function visit(item: unknown, depth: number): void {
    if (++nodes > 4096 || depth > 32) invalid("Seed JSON exceeds structural bounds.");
    if (typeof item === "string") ascii(item, "seed string", true);
    if (item !== null && typeof item === "object") {
      for (const [key, child] of Object.entries(item)) {
        ascii(key, "seed key");
        visit(child, depth + 1);
      }
    }
  }
  visit(result, 0);
  canonicalJsonBytes(result); // Wallet enforces the shared 262144-byte ceiling.
  return result as T;
}

/** Return the exact descriptor values checked here; branded children retain identity. */
export function closed<T>(value: T, keys: string, path: string): T {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(`${path} must be closed data.`, path);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Reflect.ownKeys(descriptors);
  const expected = keys.split(" ").sort();
  if (actual.length !== expected.length || actual.some((key) => typeof key !== "string")
    || (actual as string[]).sort().some((key, i) => key !== expected[i])) invalid(`${path} has unsupported or missing fields.`, path);
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of expected) {
    const property = descriptors[key];
    if (!property?.enumerable || !("value" in property)) invalid(`${path} fields must be data properties.`, path);
    result[key] = property.value;
  }
  return Object.freeze(result) as T;
}

export function freeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
export function ascii(value: unknown, path: string, empty = false): asserts value is string {
  if (typeof value !== "string" || value.length > 4096 || (!empty && value.length === 0)
    || /[^\x20-\x7e]/u.test(value)) invalid(`${path} must be bounded printable ASCII.`, path);
}
export function hash(value: unknown, path: string): void {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) invalid(`${path} must be a SHA256 ID.`, path);
}
export function amount(value: unknown, path: string, positive = false): asserts value is string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/u.test(value)
    || BigInt(value) > UINT256_MAX || (positive && value === "0")) invalid(`${path} must be a bounded canonical amount.`, path);
}
export function timestamp(value: unknown, path: string): number {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)) invalid(`${path} must be canonical UTC.`, path);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) invalid(`${path} must roundtrip UTC.`, path);
  return parsed;
}
export function integer(value: unknown, min: number, max: number, path: string): void {
  if (!Number.isSafeInteger(value) || Object.is(value, -0) || (value as number) < min || (value as number) > max) invalid(`${path} is outside bounds.`, path);
}
export function rawAccount(value: unknown, profile: Pick<SeedProfile, "chain_id">, path: string): string {
  if (typeof value !== "string" || !value.startsWith(`${profile.chain_id}:`)) mismatch(`${path} differs from the profile chain.`, path);
  const address = value.slice(profile.chain_id.length + 1);
  assertZeroneAddress(address, path);
  return address;
}
export function unsignedBytes(value: string, path: string): Uint8Array {
  if (typeof value !== "string" || value.length > Math.ceil(MAX_UNSIGNED_BYTES * 4 / 3)) invalid(`${path} exceeds unsigned bounds.`, path);
  const bytes = base64UrlDecode(value, path);
  if (bytes.length > MAX_UNSIGNED_BYTES || base64UrlEncode(bytes) !== value) invalid(`${path} must be canonical base64url.`, path);
  return bytes;
}
export function publicKey(value: string): Uint8Array {
  const key = unsignedBytes(value, "signer_public_key_b64u");
  assertSecp256k1PublicKey(key);
  return key;
}
export function evidenceShape(value: SeedReadEvidence): void {
  closed(value, "trust node_trust_id profile_id chain_id genesis_hash anchor latest_height catching_up observed_at", "evidence");
  if (value.trust !== "configured_full_node" || typeof value.catching_up !== "boolean") invalid("Unsupported evidence trust/status.");
  hash(value.node_trust_id, "node_trust_id"); hash(value.profile_id, "profile_id"); hash(value.genesis_hash, "genesis_hash");
  ascii(value.chain_id, "chain_id");
  closed(value.anchor, "height block_hash block_time", "anchor");
  assertUint64(value.anchor.height, "anchor.height", { positive: true });
  hash(value.anchor.block_hash, "block_hash");
  timestamp(value.anchor.block_time, "block_time"); timestamp(value.observed_at, "observed_at");
  assertUint64(value.latest_height, "latest_height", { positive: true });
}
