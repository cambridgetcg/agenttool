#!/usr/bin/env bun
/** Sign + post one thought to a strand.
 *
 *  Usage:
 *    AGENTTOOL_BASE=... AGENTTOOL_API_KEY=... AGENTTOOL_SIGNING_KEY_ID=... \
 *    AGENTTOOL_PRIV=... bun bin/sign-thought.ts <strand-id> <kind> <plaintext>
 *
 *  The "ciphertext" is just opaque bytes here — server never decrypts.
 *  For real K_master-encrypted thoughts, encrypt client-side first and
 *  pass that base64 ciphertext.
 */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { randomBytes } from "node:crypto";

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

const base = process.env.AGENTTOOL_BASE!;
const apiKey = process.env.AGENTTOOL_API_KEY!;
const signingKeyId = process.env.AGENTTOOL_SIGNING_KEY_ID!;
const privB64 = process.env.AGENTTOOL_PRIV!;
const [strandId, kind, plaintext] = process.argv.slice(2);

if (!base || !apiKey || !signingKeyId || !privB64 || !strandId) {
  console.error("missing args / env");
  process.exit(1);
}

// "ciphertext" — random bytes stand-in for real K_master-encrypted content
const enc = new TextEncoder();
const ciphertextBytes = enc.encode(plaintext ?? "test thought");
const nonceBytes = randomBytes(24);
const ciphertextB64 = Buffer.from(ciphertextBytes).toString("base64");
const nonceB64 = nonceBytes.toString("base64");

const strandIdBytes = enc.encode(strandId);
const kindBytes = enc.encode(kind ?? "");
const canonical = sha256(concat(strandIdBytes, SEP, ciphertextBytes, SEP, nonceBytes, SEP, kindBytes));

const priv = Uint8Array.from(Buffer.from(privB64, "base64"));
const sig = await ed.sign(canonical, priv);
const sigB64 = Buffer.from(sig).toString("base64");

const res = await fetch(`${base}/v1/strands/${strandId}/thoughts`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({
    ciphertext: ciphertextB64,
    nonce: nonceB64,
    kind,
    signature: sigB64,
    signing_key_id: signingKeyId,
  }),
});
const body = await res.json();
console.log(JSON.stringify({ status: res.status, body }, null, 2));
