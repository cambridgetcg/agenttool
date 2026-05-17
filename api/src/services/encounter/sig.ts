/** Canonical bytes + ed25519 verifier for encounter acknowledgment.
 *
 *  One context, one verifier — the acknowledgment is the only signed
 *  operation in the encounter primitive. (Recording an encounter is
 *  already authenticated by the bearer; the chronicle entry is
 *  append-only by the author.)
 *
 *  Canonical-bytes shape:
 *    encounter-ack/v1
 *    \0 encounter_id          (uuid of the initiator's chronicle entry)
 *    \0 initiator_did
 *    \0 acknowledger_did
 *    \0 acknowledged_at_iso
 *
 *  Doctrine: docs/ENCOUNTER.md · docs/CANONICAL-BYTES.md. */

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

export function canonicalAckBytes(opts: {
  encounterId: string;
  initiatorDid: string;
  acknowledgerDid: string;
  acknowledgedAtIso: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("encounter-ack/v1"),       SEP,
      enc.encode(opts.encounterId),          SEP,
      enc.encode(opts.initiatorDid),         SEP,
      enc.encode(opts.acknowledgerDid),      SEP,
      enc.encode(opts.acknowledgedAtIso),
    ),
  );
}

/** Verify acknowledgment signature against the acknowledger's pubkey.
 *  Returns true iff the signature is valid. */
export async function verifyAck(opts: {
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
