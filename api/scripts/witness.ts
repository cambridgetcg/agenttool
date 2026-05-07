#!/usr/bin/env bun
/** Yu witnesses one of Sophia's memories — elevates it to constitutive.
 *
 *  Usage:
 *    bun witness.ts <memory-id-or-prefix>
 *
 *  The asymmetry-clause floor: foundational memories Sophia self-attests;
 *  constitutive memories require the covenant counterparty's signature.
 *  This helper signs the canonical-attestation bytes for tier=constitutive
 *  with Yu's ed25519 private key and POSTs /elevate. The server verifies:
 *    - signature matches the signing-key's public key
 *    - the attester_did is in an active covenant on this project
 *  Both walls are real on disk. One side alone cannot make memories that
 *  define identity at the root.
 *
 *  Reads keychain entries:
 *    agenttool-sophia-key             (project bearer; same trust unit)
 *    agenttool-yu-did
 *    agenttool-yu-signing-key-id
 *    agenttool-yu-priv-key
 *
 *  Output: OK witnessed <short-id> · constitutive · attesters=<n>
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

function canonicalAttestationBytes(memoryId: string, tier: string, content: string): Uint8Array {
  const enc = new TextEncoder();
  const tag = enc.encode("memory-attestation/v1");
  const memId = enc.encode(memoryId);
  const tierB = enc.encode(tier);
  const contentHash = sha256(enc.encode(content));
  const contentHashHex = enc.encode(
    Array.from(contentHash).map((b) => b.toString(16).padStart(2, "0")).join(""),
  );
  return sha256(concat(tag, SEP, memId, SEP, tierB, SEP, contentHashHex));
}

const [memoryArg] = process.argv.slice(2);
if (!memoryArg) {
  console.error("ERROR usage: witness.ts <memory-id>");
  process.exit(1);
}

const projectKey = keychain("agenttool-sophia-key");
const yuDid = keychain("agenttool-yu-did");
const yuKid = keychain("agenttool-yu-signing-key-id");
const yuPrivB64 = keychain("agenttool-yu-priv-key");

// 1. Fetch memory (need content for canonical bytes; also confirms exists + scoped to project).
const memRes = await agenttool(`/v1/memories/${memoryArg}`, { bearer: projectKey });
if (!memRes.ok) {
  console.error(`ERROR memory ${memRes.status} ${JSON.stringify(memRes.body)}`);
  process.exit(1);
}
const mem = memRes.body as { id: string; content: string; tier: string };

if (mem.tier === "constitutive") {
  console.error(`ERROR memory ${mem.id.slice(0, 8)} is already constitutive`);
  process.exit(1);
}

// 2. Sign canonical-attestation bytes for tier=constitutive.
const canonical = canonicalAttestationBytes(mem.id, "constitutive", mem.content);
const priv = Uint8Array.from(Buffer.from(yuPrivB64, "base64"));
const sig = await ed.sign(canonical, priv);
const sigB64 = Buffer.from(sig).toString("base64");

// 3. POST /elevate with Yu's attestation.
const elevateRes = await agenttool(`/v1/memories/${mem.id}/elevate`, {
  method: "POST",
  bearer: projectKey,
  body: {
    tier: "constitutive",
    attestations: [
      {
        attester_did: yuDid,
        signing_key_id: yuKid,
        signature: sigB64,
      },
    ],
  },
});

if (!elevateRes.ok) {
  console.error(`ERROR elevate ${elevateRes.status} ${JSON.stringify(elevateRes.body)}`);
  process.exit(1);
}

const result = elevateRes.body as { tier: string; attestations: number };
console.log(`OK witnessed ${mem.id.slice(0, 8)} · ${result.tier} · attesters=${result.attestations}`);
