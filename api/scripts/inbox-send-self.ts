#!/usr/bin/env bun
/** Self-send sealed-box message: identity → itself.
 *
 *  Crypto is delegated ENTIRELY to the canonical SDK helpers
 *  (packages/sdk-ts/src/inbox.ts) — this script performs no HKDF/AES of its
 *  own. That is deliberate: an earlier version re-implemented the sealed-box
 *  with salt=recipient_did + info="agenttool-inbox/v1" (slash), which
 *  round-tripped against itself and so looked healthy while producing keys
 *  no canonical recipient could reproduce. The 2026-05-08 self-message is
 *  permanently undecryptable because of exactly that drift. There is now one
 *  implementation, and the cross-impl known-answer test
 *  (packages/sdk-ts/tests/inbox.test.ts, packages/sdk-py/tests/
 *  test_inbox_canonical_vectors.py) pins it.
 *
 *  Steps:
 *    1. Generate an X25519 box keypair (recipient) via the SDK.
 *    2. Register the box public key.
 *    3. sealForRecipient(message, boxPub) → ciphertext + nonce + ephemeral.
 *    4. signInboxEnvelope(...) → ed25519 envelope signature.
 *    5. POST /v1/inbox.
 *    6. List unread and unsealForSelf(...) the round-trip locally. */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import {
  generateBoxKeypair,
  sealForRecipient,
  signInboxEnvelope,
  unsealForSelf,
} from "../../packages/sdk-ts/src/inbox.js";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const base = process.env.AGENTTOOL_BASE!;
const apiKey = process.env.AGENTTOOL_API_KEY!;
const identityId = process.env.AGENTTOOL_IDENTITY_ID!;
const did = process.env.AGENTTOOL_DID!;
const sigKid = process.env.AGENTTOOL_SIGNING_KEY_ID!;
const privSignB64 = process.env.AGENTTOOL_PRIV!;
const message = process.argv[2] ?? "Hello — from yourself.";

// 1. Generate recipient box keypair (X25519).
const { priv: boxPriv, pub: boxPub } = generateBoxKeypair();
const boxPubB64 = Buffer.from(boxPub).toString("base64");

// 2. Register box pub.
const reg = await fetch(`${base}/v1/identities/${identityId}/box-keys`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ public_key: boxPubB64, label: "module-test-self" }),
}).then((r) => r.json());
console.log("box key registered:", reg);
const recipientBoxKeyId = reg.id;

// 3. Seal the message with the canonical SDK helper.
const sealed = await sealForRecipient(message, boxPub);

// 4. Sign the canonical envelope with the canonical SDK helper.
const signingKey = Uint8Array.from(Buffer.from(privSignB64, "base64"));
const sigB64 = signInboxEnvelope({
  recipientDid: did,
  ciphertextB64: sealed.ciphertextB64,
  nonceB64: sealed.nonceB64,
  ephemeralPubB64: sealed.ephemeralPubB64,
  signingKey,
});

// 5. Send.
const send = await fetch(`${base}/v1/inbox`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({
    to_did: did,
    sender_did: did,
    ciphertext: sealed.ciphertextB64,
    nonce: sealed.nonceB64,
    ephemeral_pubkey: sealed.ephemeralPubB64,
    recipient_box_key_id: recipientBoxKeyId,
    signature: sigB64,
    signing_key_id: sigKid,
    subject: "module-test self message",
  }),
});
const sendBody = await send.json();
console.log("send status:", send.status, "body:", sendBody);

// 6. List unread and decrypt the round-trip locally.
const unread = await fetch(`${base}/v1/inbox?status=unread`, {
  headers: { authorization: `Bearer ${apiKey}` },
}).then((r) => r.json());
console.log("unread count:", unread.count);

const msg0 = unread.messages?.[0];
if (msg0) {
  const plain = await unsealForSelf({
    ciphertextB64: msg0.ciphertext,
    nonceB64: msg0.nonce,
    ephemeralPubB64: msg0.ephemeral_pubkey,
    recipientBoxPriv: boxPriv,
  });
  console.log("decrypted:", JSON.stringify(plain));
}
