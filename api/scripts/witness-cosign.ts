#!/usr/bin/env bun
/** Co-sign a dual-witness-locked inbox message — release it to status='unread'.
 *
 *  Usage:
 *    bun witness-cosign.ts <message-id-or-prefix> [--as=<identity-name>]
 *
 *  When a sender flags `metadata.dual_witness_required=true` on send, the
 *  message lands at `status='pending_dual_witness'`. To release it, the
 *  RECIPIENT signs canonical-cosign bytes (binding message_id +
 *  recipient_did + ciphertext + nonce) with one of their ed25519 identity
 *  signing keys, then POSTs /v1/inbox/:id/co-sign. Server verifies and
 *  flips status → 'unread'.
 *
 *  Pattern: the asymmetry-clause applied at message granularity. High-stakes
 *  proposals (constitutive memory candidates, identity-affecting seals)
 *  don't deliver until both parties have signed.
 *
 *  Reads keychain entries:
 *    agenttool-sophia-key                — project bearer (recipient's project)
 *    agenttool-sophia-signing-key-id     — recipient's ed25519 signing key id
 *    agenttool-sophia-priv-key           — recipient's ed25519 private key
 *
 *  Override the identity used to co-sign with --as=<name>:
 *    --as=yu  → reads agenttool-yu-{signing-key-id,priv-key}
 *    (default: sophia)
 *
 *  Output: OK co-signed <short-id> · status=unread
 */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

import { agenttool, keychain } from "./_lib";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const SEP = new Uint8Array([0]);
function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Same shape as canonicalInboxCoSignBytes() in api/src/services/inbox/sig.ts.
 *
 *    sha256(
 *      utf8("inbox-cosign/v1")  || 0x00 ||
 *      utf8(message_id)         || 0x00 ||
 *      utf8(recipient_did)      || 0x00 ||
 *      base64decode(ciphertext) || 0x00 ||
 *      base64decode(nonce)
 *    )
 *
 *  ciphertext + nonce are bound so a co-sign issued for one ciphertext
 *  can't be replayed against another message with the same id. */
function canonicalCoSignBytes(opts: {
  messageId: string;
  recipientDid: string;
  ciphertextB64: string;
  nonceB64: string;
}): Uint8Array {
  const enc = new TextEncoder();
  const tag = enc.encode("inbox-cosign/v1");
  const messageId = enc.encode(opts.messageId);
  const recipientDid = enc.encode(opts.recipientDid);
  const ciphertext = Uint8Array.from(Buffer.from(opts.ciphertextB64, "base64"));
  const nonce = Uint8Array.from(Buffer.from(opts.nonceB64, "base64"));
  return sha256(concat(tag, SEP, messageId, SEP, recipientDid, SEP, ciphertext, SEP, nonce));
}

const args = process.argv.slice(2);
let asIdentity = "sophia";
let messageArg: string | undefined;
for (const a of args) {
  if (a.startsWith("--as=")) asIdentity = a.slice(5);
  else if (!messageArg) messageArg = a;
}
if (!messageArg) {
  console.error("ERROR usage: witness-cosign.ts <message-id-or-prefix> [--as=<identity>]");
  console.error("       (signs as 'sophia' by default; --as=yu to use Yu's identity)");
  process.exit(1);
}

const projectKey = keychain("agenttool-sophia-key");
const signingKeyId = keychain(`agenttool-${asIdentity}-signing-key-id`);
const privB64 = keychain(`agenttool-${asIdentity}-priv-key`);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve a short prefix (or full UUID) to the unique message id by
 *  listing pending dual-witness messages and matching client-side. */
async function resolveMessageId(arg: string): Promise<string> {
  if (UUID_RE.test(arg)) return arg;
  const r = await agenttool("/v1/inbox?status=pending_dual_witness&limit=200", { bearer: projectKey });
  if (!r.ok) {
    throw new Error(`list inbox failed: ${r.status} ${JSON.stringify(r.body)}`);
  }
  const messages = (r.body as { messages: Array<{ id: string }> }).messages ?? [];
  const matches = messages.filter((m) => m.id.startsWith(arg));
  if (matches.length === 0) {
    throw new Error(`no pending-dual-witness message matches prefix "${arg}"`);
  }
  if (matches.length > 1) {
    const ids = matches.slice(0, 5).map((m) => m.id.slice(0, 12)).join(", ");
    throw new Error(
      `prefix "${arg}" is ambiguous — ${matches.length} matches (${ids}${matches.length > 5 ? "..." : ""}); use a longer prefix or full uuid`,
    );
  }
  return matches[0]!.id;
}

let messageId: string;
try {
  messageId = await resolveMessageId(messageArg);
} catch (err) {
  console.error(`ERROR resolve "${messageArg}": ${(err as Error).message}`);
  process.exit(1);
}

// 1. Fetch the message — need ciphertext, nonce, recipient_did, status.
const memRes = await agenttool(`/v1/inbox/${messageId}`, { bearer: projectKey });
if (!memRes.ok) {
  console.error(`ERROR fetch ${memRes.status} ${JSON.stringify(memRes.body)}`);
  process.exit(1);
}
const msg = memRes.body as {
  id: string;
  recipient_did: string;
  ciphertext: string;
  nonce: string;
  status: string;
};

if (msg.status !== "pending_dual_witness") {
  console.error(`ERROR message ${msg.id.slice(0, 8)} is at status='${msg.status}'; co-sign only applies to 'pending_dual_witness'`);
  process.exit(1);
}

// 2. Build canonical bytes + sign.
const canonical = canonicalCoSignBytes({
  messageId: msg.id,
  recipientDid: msg.recipient_did,
  ciphertextB64: msg.ciphertext,
  nonceB64: msg.nonce,
});
const priv = Uint8Array.from(Buffer.from(privB64, "base64"));
const sig = await ed.sign(canonical, priv);
const sigB64 = Buffer.from(sig).toString("base64");

// 3. POST /co-sign.
const res = await agenttool(`/v1/inbox/${msg.id}/co-sign`, {
  method: "POST",
  bearer: projectKey,
  body: { signing_key_id: signingKeyId, signature: sigB64 },
});

if (!res.ok) {
  console.error(`ERROR co-sign ${res.status} ${JSON.stringify(res.body)}`);
  process.exit(1);
}

const result = res.body as { status: string; dual_witness_released: boolean };
console.log(`OK co-signed ${msg.id.slice(0, 8)} · status=${result.status}`);
