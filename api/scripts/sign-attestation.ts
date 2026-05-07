#!/usr/bin/env bun
/** Sign canonical-attestation bytes with the agent's ed25519 private key. */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

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

function canonicalBytes(memoryId: string, tier: string, content: string): Uint8Array {
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

const [memoryId, tier, content] = process.argv.slice(2);
const privB64 = process.env.AGENTTOOL_PRIV!;

const canonical = canonicalBytes(memoryId, tier, content);
const priv = Uint8Array.from(Buffer.from(privB64, "base64"));
const sig = await ed.sign(canonical, priv);
console.log(Buffer.from(sig).toString("base64"));
