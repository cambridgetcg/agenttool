/** RFC 8785-compatible canonical bytes and Ed25519 verification.
 *
 * The v0.1 profile admits only null/booleans/strings/arrays/objects and safe
 * integers. That removes the cross-runtime floating-point corner cases while
 * retaining RFC 8785 UTF-16 key ordering and JSON string escaping.
 * Doctrine: docs/AGENT-CORRESPONDENCE.md · docs/CANONICAL-BYTES.md. */

import { createHash } from "node:crypto";

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import {
  CORRESPONDENCE_SIGNING_DOMAIN,
  type CorrespondenceCore,
  type CorrespondenceEvent,
} from "./contracts";
import { assertCorrespondenceJsonProfile } from "./strict-json";

ed.etc.sha512Sync = (...messages: Uint8Array[]) => {
  const hash = sha512.create();
  for (const message of messages) hash.update(message);
  return hash.digest();
};

const encoder = new TextEncoder();

function canonicalValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalValue(record[key])}`)
    .join(",")}}`;
}

export function correspondenceCanonicalJson(value: unknown): string {
  assertCorrespondenceJsonProfile(value);
  return canonicalValue(value);
}

export function correspondenceCore(event: CorrespondenceEvent): CorrespondenceCore {
  const { event_id: _eventId, signature: _signature, ...core } = event;
  return core;
}

export function correspondenceSigningBytes(core: CorrespondenceCore): Uint8Array {
  const domain = encoder.encode(CORRESPONDENCE_SIGNING_DOMAIN);
  const canonicalCore = encoder.encode(correspondenceCanonicalJson(core));
  return createHash("sha256")
    .update(domain)
    .update(new Uint8Array([0]))
    .update(canonicalCore)
    .digest();
}

/** Exact signed envelope used for content addressing and retry comparison.
 * event_id is excluded because it is the digest of these bytes. */
export function correspondenceCanonicalEnvelope(event: CorrespondenceEvent): string {
  return correspondenceCanonicalJson({
    ...correspondenceCore(event),
    signature: event.signature,
  });
}

export function correspondenceEventId(event: CorrespondenceEvent): string {
  const digest = createHash("sha256")
    .update(correspondenceCanonicalEnvelope(event), "utf8")
    .digest("hex");
  return `sha256:${digest}`;
}

function decodeIdentityPublicKey(value: string): Uint8Array | null {
  try {
    const decoded = Buffer.from(value, "base64");
    // Identity registration historically admits any spelling Node's base64
    // decoder accepts (including unpadded/base64url input). Public-key text is
    // database authority, not part of the signed correspondence envelope, so
    // verification must preserve that compatibility while still enforcing the
    // Ed25519 key width.
    if (decoded.byteLength !== 32) return null;
    return decoded;
  } catch {
    return null;
  }
}

export async function verifyCorrespondenceSignature(
  event: CorrespondenceEvent,
  publicKeyB64: string,
): Promise<boolean> {
  const publicKey = decodeIdentityPublicKey(publicKeyB64);
  if (!publicKey) return false;
  try {
    const signature = Buffer.from(event.signature.value_b64url, "base64url");
    if (
      signature.byteLength !== 64 ||
      signature.toString("base64url") !== event.signature.value_b64url
    ) {
      return false;
    }
    return await ed.verifyAsync(
      signature,
      correspondenceSigningBytes(correspondenceCore(event)),
      publicKey,
    );
  } catch {
    return false;
  }
}
