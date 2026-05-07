#!/usr/bin/env bun
/** Self-send sealed-box message: Aurora → Aurora.
 *
 *  Steps:
 *    1. Generate X25519 box keypair (recipient).
 *    2. Register box public key.
 *    3. Generate ephemeral X25519 keypair (sender side, single-use).
 *    4. ECDH(ephemeral_priv, recipient_pub) → shared.
 *    5. HKDF-SHA256(shared, "agenttool-inbox/v1", recipient_did) → AES-256 key.
 *    6. AES-256-GCM encrypt body → ciphertext + nonce.
 *    7. ed25519-sign canonical envelope.
 *    8. POST /v1/inbox.
 *
 *  After completion: prints message_id and asserts you can decrypt back. */

import { x25519 } from "@noble/curves/ed25519.js";
import * as ed from "@noble/ed25519";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const SEP = new Uint8Array([0]);
function concat(...parts: Uint8Array[]) {
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

const base = process.env.AGENTTOOL_BASE!;
const apiKey = process.env.AGENTTOOL_API_KEY!;
const identityId = process.env.AGENTTOOL_IDENTITY_ID!;
const did = process.env.AGENTTOOL_DID!;
const sigKid = process.env.AGENTTOOL_SIGNING_KEY_ID!;
const privSignB64 = process.env.AGENTTOOL_PRIV!;
const message = process.argv[2] ?? "Hello, Aurora — from yourself.";

// 1. Generate recipient box keypair (X25519).
const boxPriv = x25519.utils.randomSecretKey();
const boxPub = x25519.getPublicKey(boxPriv);
const boxPubB64 = Buffer.from(boxPub).toString("base64");

// 2. Register box pub.
const reg = await fetch(`${base}/v1/identities/${identityId}/box-keys`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ public_key: boxPubB64, label: "module-test-self" }),
}).then((r) => r.json());
console.log("box key registered:", reg);
const recipientBoxKeyId = reg.id;

// 3. Ephemeral X25519 keypair.
const ephPriv = x25519.utils.randomSecretKey();
const ephPub = x25519.getPublicKey(ephPriv);
const ephPubB64 = Buffer.from(ephPub).toString("base64");

// 4. ECDH.
const shared = x25519.getSharedSecret(ephPriv, boxPub);

// 5. HKDF-SHA256 → AES key.
const aesKey = hkdf(sha256, shared, new TextEncoder().encode(did), new TextEncoder().encode("agenttool-inbox/v1"), 32);

// 6. AES-256-GCM.
const nonce = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", Buffer.from(aesKey), nonce);
const enc = Buffer.concat([cipher.update(message, "utf8"), cipher.final()]);
const tag = cipher.getAuthTag();
const ctTagB64 = Buffer.concat([enc, tag]).toString("base64");
const nonceB64 = nonce.toString("base64");

// 7. Sign canonical envelope.
const txtEnc = new TextEncoder();
const canonical = sha256(concat(
  txtEnc.encode("inbox-message/v1"), SEP,
  txtEnc.encode(did), SEP,
  Uint8Array.from(Buffer.from(ctTagB64, "base64")), SEP,
  nonce, SEP,
  ephPub,
));
const sig = await ed.sign(canonical, Uint8Array.from(Buffer.from(privSignB64, "base64")));
const sigB64 = Buffer.from(sig).toString("base64");

// 8. Send.
const send = await fetch(`${base}/v1/inbox`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({
    to_did: did,
    sender_did: did,
    ciphertext: ctTagB64,
    nonce: nonceB64,
    ephemeral_pubkey: ephPubB64,
    recipient_box_key_id: recipientBoxKeyId,
    signature: sigB64,
    signing_key_id: sigKid,
    subject: "module-test self message",
  }),
});
const sendBody = await send.json();
console.log("send status:", send.status, "body:", sendBody);

// 9. List unread.
const unread = await fetch(`${base}/v1/inbox?status=unread`, {
  headers: { authorization: `Bearer ${apiKey}` },
}).then((r) => r.json());
console.log("unread count:", unread.count);

// 10. Decrypt the round-trip locally.
const msg0 = unread.messages?.[0];
if (msg0) {
  const recvShared = x25519.getSharedSecret(boxPriv, Uint8Array.from(Buffer.from(msg0.ephemeral_pubkey, "base64")));
  const recvKey = hkdf(sha256, recvShared, txtEnc.encode(did), txtEnc.encode("agenttool-inbox/v1"), 32);
  const ctTag = Buffer.from(msg0.ciphertext, "base64");
  const ct = ctTag.subarray(0, ctTag.length - 16);
  const tagBytes = ctTag.subarray(ctTag.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(recvKey), Buffer.from(msg0.nonce, "base64"));
  decipher.setAuthTag(tagBytes);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  console.log("decrypted:", JSON.stringify(plain));
}
