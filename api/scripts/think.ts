#!/usr/bin/env bun
/** Append a signed thought to one of Sophia's strands.
 *
 *  Usage:
 *    bun think.ts <strand-id-or-active> <kind> <content>
 *
 *  strand-id may be:
 *    - A full UUID
 *    - The literal "active" — uses the most-recently-touched active strand
 *
 *  kind is one of: observation · question · conjecture · resolution · drift · feeling.
 *
 *  Content is AES-256-GCM-encrypted with K_master before send; the server
 *  stores ciphertext only and verifies the ed25519 envelope signature
 *  against the agent's signing key. The signature wraps the ciphertext
 *  bytes as sent — encryption and signing are independent walls.
 *
 *  Reads keychain entries:
 *    agenttool-sophia-key
 *    agenttool-sophia-signing-key-id
 *    agenttool-sophia-priv-key
 *    agenttool-sophia-k-master      (run `bun bin/gen-k-master.ts` first)
 *
 *  Output: OK thought seq=<n> · <short-id>  on /<strand-short-id>
 */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

import { encryptThought, loadKMaster } from "./_crypto";
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

const [strandArg, kind, ...contentParts] = process.argv.slice(2);
const content = contentParts.join(" ");

if (!strandArg || !kind || !content) {
  console.error("ERROR usage: think.ts <strand-id-or-active> <kind> <content>");
  process.exit(1);
}

const key = keychain("agenttool-sophia-key");
const signingKeyId = keychain("agenttool-sophia-signing-key-id");
const privB64 = keychain("agenttool-sophia-priv-key");

// 1. Resolve strand id
let strandId = strandArg;
if (strandArg === "active") {
  const list = await agenttool("/v1/strands?status=active", { bearer: key });
  if (!list.ok) {
    console.error(`ERROR ${list.status} listing strands ${JSON.stringify(list.body)}`);
    process.exit(1);
  }
  const strands = (list.body as { strands: { id: string; last_thought_at: string | null; created_at: string }[] }).strands;
  if (strands.length === 0) {
    console.error("ERROR no active strand. Pass an explicit UUID.");
    process.exit(1);
  }
  // Most recently touched: prefer last_thought_at, fall back to created_at.
  const sorted = [...strands].sort((a, b) => {
    const ta = a.last_thought_at ?? a.created_at;
    const tb = b.last_thought_at ?? b.created_at;
    return tb.localeCompare(ta);
  });
  strandId = sorted[0]!.id;
}

// 2. Encrypt content with K_master (AES-256-GCM, 12-byte nonce, tag appended).
const kMaster = loadKMaster();
const { ciphertextB64, nonceB64 } = encryptThought(content, kMaster);
const ciphertextBytes = Uint8Array.from(Buffer.from(ciphertextB64, "base64"));
const nonceBytes = Uint8Array.from(Buffer.from(nonceB64, "base64"));

// 3. Canonical envelope bytes for ed25519 (over the ciphertext as sent).
const enc = new TextEncoder();
const canonical = sha256(concat(
  enc.encode(strandId), SEP,
  ciphertextBytes, SEP,
  nonceBytes, SEP,
  enc.encode(kind),
));

// 4. Sign
const priv = Uint8Array.from(Buffer.from(privB64, "base64"));
const sig = await ed.sign(canonical, priv);
const sigB64 = Buffer.from(sig).toString("base64");

// 5. POST
const res = await agenttool(`/v1/strands/${strandId}/thoughts`, {
  method: "POST",
  bearer: key,
  body: {
    ciphertext: ciphertextB64,
    nonce: nonceB64,
    kind,
    signature: sigB64,
    signing_key_id: signingKeyId,
  },
});

if (!res.ok) {
  console.error(`ERROR ${res.status} ${JSON.stringify(res.body)}`);
  process.exit(1);
}

const thought = res.body as { id: string; sequence_num: number; kind: string };
console.log(`OK thought seq=${thought.sequence_num} · ${thought.id.slice(0, 8)}  on /${strandId.slice(0, 8)}`);
