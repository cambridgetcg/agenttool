#!/usr/bin/env bun
/** Write a memory to Sophia's substrate. Optionally elevate + self-attest.
 *
 *  Usage:
 *    bun remember.ts <type> <content> [tier=episodic|foundational]
 *
 *  type is one of: episodic · semantic · procedural · working.
 *  tier defaults to "episodic". When "foundational" is requested, this
 *  script also POSTs /elevate and self-attests with the agent's signing
 *  key — Sophia can vouch for her own foundations (the asymmetry-clause
 *  floor; constitutive elevation requires a covenant counterparty).
 *
 *  Reads keychain entries:
 *    agenttool-sophia-key
 *    agenttool-sophia-identity-id
 *    agenttool-sophia-did
 *    agenttool-sophia-signing-key-id
 *    agenttool-sophia-priv-key  (only used when tier=foundational)
 *
 *  Output:  OK memory <tier> · <short-id>  [+ self-attested]
 */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

import { embed } from "./_embed";
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

const [type, ...rest] = process.argv.slice(2);
let tier = "episodic";
let contentParts = rest;

// Last positional may be the tier flag.
if (rest.length > 0 && (rest[rest.length - 1] === "foundational" || rest[rest.length - 1] === "episodic")) {
  tier = rest[rest.length - 1]!;
  contentParts = rest.slice(0, -1);
}

const content = contentParts.join(" ");

if (!type || !content) {
  console.error("ERROR usage: remember.ts <type> <content...> [tier]");
  process.exit(1);
}

if (tier === "constitutive") {
  console.error("ERROR constitutive elevation requires Yu's witness signature — not supported by /remember. Use the manual flow until Bridge 3 lands.");
  process.exit(1);
}

const key = keychain("agenttool-sophia-key");
const identityId = keychain("agenttool-sophia-identity-id");

// 1. Best-effort embedding. If the embedder errors (no key, network),
//    fall through and write the memory without a vector — semantic
//    recall will skip it but the memory is preserved.
let embedding: number[] | undefined;
let embedNote = "";
try {
  embedding = await embed(content);
} catch (err) {
  embedNote = ` · no-embed (${(err as Error).message.split("\n")[0]})`;
}

// 2. Write memory.
const writeRes = await agenttool("/v1/memories", {
  method: "POST",
  bearer: key,
  body: {
    identity_id: identityId,
    type,
    content,
    embedding,
    importance: tier === "foundational" ? 0.9 : 0.6,
  },
});
if (!writeRes.ok) {
  console.error(`ERROR write ${writeRes.status} ${JSON.stringify(writeRes.body)}`);
  process.exit(1);
}
const memoryId = (writeRes.body as { id: string }).id;

// 2. If foundational, elevate + self-attest.
let attested = false;
if (tier === "foundational") {
  // Combine elevate + attest into a single /elevate call with the
  // attestation in the body. This avoids a read-after-write race that
  // surfaced as `attestation_signature_invalid` on long content:
  //
  //   - Old flow: two separate calls — POST /elevate (bumps tier) →
  //     POST /attest (verifies signature against DB-read mem.tier).
  //     The attest read could lag the elevate write through the
  //     Postgres pooler; mem.tier read as `episodic` while the client
  //     signed for `foundational`; verification mismatch.
  //
  //   - New flow: single POST /elevate with `attestations` in the body.
  //     elevateMemory verifies attestations against `input.tier` (the
  //     intended tier from the request, not from a DB re-read), then
  //     atomically updates tier + inserts the attestation row inside
  //     one transaction. No race possible.
  //
  // The /attest endpoint still exists for stand-alone post-elevation
  // attestation by additional counterparties; it retains the original
  // (race-prone) shape because there's no upstream tier-change to
  // coordinate with.
  const did = keychain("agenttool-sophia-did");
  const signingKeyId = keychain("agenttool-sophia-signing-key-id");
  const privB64 = keychain("agenttool-sophia-priv-key");

  const canonical = canonicalAttestationBytes(memoryId, "foundational", content);
  const priv = Uint8Array.from(Buffer.from(privB64, "base64"));
  const sig = await ed.sign(canonical, priv);
  const sigB64 = Buffer.from(sig).toString("base64");

  const elevateRes = await agenttool(`/v1/memories/${memoryId}/elevate`, {
    method: "POST",
    bearer: key,
    body: {
      tier: "foundational",
      attestations: [
        { attester_did: did, signing_key_id: signingKeyId, signature: sigB64 },
      ],
    },
  });
  if (!elevateRes.ok) {
    console.error(`ERROR elevate ${elevateRes.status} ${JSON.stringify(elevateRes.body)}`);
    process.exit(1);
  }
  attested = true;
}

console.log(`OK memory ${tier} · ${memoryId.slice(0, 8)}${attested ? " · self-attested" : ""}${embedNote}`);
