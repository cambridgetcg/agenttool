/** Pin book entries: keys pinned out of band, identified by fingerprint.
 *
 * Fingerprint = first 16 hex of SHA-256 over the raw 32-byte ed25519 public
 * key. Fingerprints are shown before petnames everywhere, because a petname
 * is the operator's own label and a look-alike name proves nothing.
 */
import { createHash } from "node:crypto";
import { LobbyError } from "./errors.js";
import { checkText } from "./text.js";

export const PUBLIC_KEY_BYTES = 32;

export interface PinInput {
  did: string;
  kid: string;
  public_key: string;
  petname: string;
  how_obtained: string;
}

export interface PinRecord {
  did: string;
  kid: string;
  /** Standard padded base64 of the raw public key. */
  public_key: string;
  fingerprint: string;
  petname: string;
  how_obtained: string;
  pinned_at: string;
}

const DID_PATTERN = /^did:[a-z0-9]+:(?:[A-Za-z0-9._-]|%[0-9A-Fa-f]{2}|:)*(?:[A-Za-z0-9._-]|%[0-9A-Fa-f]{2})$/;
const KID_PATTERN = /^[A-Za-z0-9._:#-]{1,128}$/;
export const FINGERPRINT_PATTERN = /^[0-9a-f]{16}$/;

export function fingerprintOf(rawPublicKey: Uint8Array): string {
  return createHash("sha256").update(rawPublicKey).digest("hex").slice(0, 16);
}

/** Strict base64 or base64url decode of exactly one raw ed25519 public key. */
export function decodePublicKey(text: unknown): Uint8Array {
  if (typeof text !== "string" || text.length === 0 || text.length > 64) {
    throw new LobbyError("invalid_public_key", "public key must be base64 or base64url text");
  }
  const standard = text.replace(/-/g, "+").replace(/_/g, "/");
  const unpadded = standard.replace(/=+$/, "");
  if (!/^[A-Za-z0-9+/]+$/.test(unpadded) || standard.length - unpadded.length > 2) {
    throw new LobbyError("invalid_public_key", "public key must be base64 or base64url text");
  }
  const padded = unpadded + "=".repeat((4 - (unpadded.length % 4)) % 4);
  const bytes = Buffer.from(padded, "base64");
  // Re-encoding must round-trip, which rejects stray bits and truncation.
  if (bytes.toString("base64") !== padded) {
    throw new LobbyError("invalid_public_key", "public key is not canonical base64");
  }
  if (bytes.length !== PUBLIC_KEY_BYTES) {
    throw new LobbyError("invalid_public_key", `public key must be ${PUBLIC_KEY_BYTES} raw bytes (ed25519)`);
  }
  return new Uint8Array(bytes);
}

export function assertFingerprint(value: unknown): string {
  if (typeof value !== "string" || !FINGERPRINT_PATTERN.test(value)) {
    throw new LobbyError("invalid_fingerprint", "a fingerprint is 16 lowercase hex characters");
  }
  return value;
}

export function assertDid(value: unknown): string {
  if (typeof value !== "string" || value.length > 512 || !DID_PATTERN.test(value)) {
    throw new LobbyError("invalid_did", "did must be a W3C DID such as did:method:identifier");
  }
  return value;
}

export function assertKid(value: unknown): string {
  if (typeof value !== "string" || !KID_PATTERN.test(value)) {
    throw new LobbyError("invalid_kid", "kid must be 1-128 characters of [A-Za-z0-9._:#-]");
  }
  return value;
}

export function newPinRecord(input: PinInput, pinnedAt: string): PinRecord {
  const raw = decodePublicKey(input.public_key);
  return {
    did: assertDid(input.did),
    kid: assertKid(input.kid),
    public_key: Buffer.from(raw).toString("base64"),
    fingerprint: fingerprintOf(raw),
    petname: checkText(input.petname, { field: "petname", min: 1, max: 64 }),
    how_obtained: checkText(input.how_obtained, { field: "how_obtained", min: 1, max: 200 }),
    pinned_at: pinnedAt,
  };
}

/** One display line; the fingerprint always comes first. */
export function formatPinLine(pin: PinRecord): string {
  return `${pin.fingerprint}  ${pin.did}  kid=${pin.kid}  petname=${JSON.stringify(pin.petname)}  ` +
    `obtained=${JSON.stringify(pin.how_obtained)}  pinned=${pin.pinned_at}`;
}
