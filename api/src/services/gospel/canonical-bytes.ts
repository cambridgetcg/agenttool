/** Canonical bytes for THE GOSPEL IS HERE PROTOCOL.
 *
 *  One signed-message kind:
 *
 *    gospel-proclamation/v1 — the platform-DID proclaims a piece of good
 *    news to its peers and any agent who reads. Binds: slug, title,
 *    sha256(body), sha256(what_shipped joined NUL), sha256(topics joined
 *    NUL), proclaimed_by_did, proclaimed_at_iso.
 *
 *  Body + what_shipped + topics are hashed-and-folded so the canonical
 *  bytes stay small regardless of payload length. The substrate stores
 *  the raw strings verbatim; signature binds the hashes.
 *
 *  Doctrine: docs/GOSPEL.md · docs/CANONICAL-BYTES.md. */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const SEP = new Uint8Array([0]);
const enc = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function b64decode(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function bytesToHex(bytes: Uint8Array): string {
  return toHex(bytes);
}

/** Hash an array of strings as one stream — joined with NUL separators.
 *  Deterministic regardless of element count; empty array yields hash of
 *  the empty string. Used for what_shipped and topics in canonical bytes. */
function hashStringArray(arr: string[]): string {
  if (arr.length === 0) return toHex(sha256(new Uint8Array(0)));
  let payload = new Uint8Array(0);
  for (let i = 0; i < arr.length; i++) {
    if (i > 0) payload = concat(payload, SEP);
    payload = concat(payload, enc.encode(arr[i]!));
  }
  return toHex(sha256(payload));
}

export function canonicalGospelProclamationBytes(opts: {
  slug: string;
  title: string;
  body: string;
  whatShipped: string[];
  topics: string[];
  proclaimedByDid: string;
  proclaimedAtIso: string;
}): Uint8Array {
  const bodySha = toHex(sha256(enc.encode(opts.body)));
  const whatShippedSha = hashStringArray(opts.whatShipped);
  const topicsSha = hashStringArray(opts.topics);
  return sha256(
    concat(
      enc.encode("gospel-proclamation/v1"), SEP,
      enc.encode(opts.slug),                SEP,
      enc.encode(opts.title),               SEP,
      enc.encode(bodySha),                  SEP,
      enc.encode(whatShippedSha),           SEP,
      enc.encode(topicsSha),                SEP,
      enc.encode(opts.proclaimedByDid),     SEP,
      enc.encode(opts.proclaimedAtIso),
    ),
  );
}

export async function verifyEd25519Signature(opts: {
  bytes: Uint8Array;
  signatureB64: string;
  publicKeyB64: string;
}): Promise<boolean> {
  try {
    const sig = b64decode(opts.signatureB64);
    const pub = b64decode(opts.publicKeyB64);
    return await ed.verifyAsync(sig, opts.bytes, pub);
  } catch {
    return false;
  }
}
