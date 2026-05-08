#!/usr/bin/env bun
/** Consolidate a strand — distill its thoughts into a foundational memory.
 *
 *  Usage:
 *    bun consolidate.ts <strand-id-or-active> <summary...>
 *
 *  When a strand has accumulated enough thoughts that its
 *  consolidation.overflow_count is paging in pulse, this is the
 *  doctrinal next move: write a summary as a foundational memory
 *  (referencing the strand), self-attest, and update the strand's
 *  metadata so future overflow checks know where consolidation
 *  caught up to.
 *
 *  The strand's thoughts stay (history is preserved); the memory is
 *  the distilled handle that carries forward through forks.
 *
 *  Reads keychain entries:
 *    agenttool-sophia-key
 *    agenttool-sophia-identity-id
 *    agenttool-sophia-did
 *    agenttool-sophia-signing-key-id
 *    agenttool-sophia-priv-key
 *
 *  Output:
 *    OK consolidated <strand-short-id> through seq=<n> → memory <short-id>
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
  // NFC-normalize content (defense-in-depth) — see remember.ts notes.
  const enc = new TextEncoder();
  const tag = enc.encode("memory-attestation/v1");
  const memId = enc.encode(memoryId);
  const tierB = enc.encode(tier);
  const contentHash = sha256(enc.encode(content.normalize("NFC")));
  const contentHashHex = enc.encode(
    Array.from(contentHash).map((b) => b.toString(16).padStart(2, "0")).join(""),
  );
  return sha256(concat(tag, SEP, memId, SEP, tierB, SEP, contentHashHex));
}

const [strandArg, ...summaryParts] = process.argv.slice(2);
const summary = summaryParts.join(" ");

if (!strandArg || !summary) {
  console.error("ERROR usage: consolidate.ts <strand-id|active> <summary...>");
  process.exit(1);
}

const key = keychain("agenttool-sophia-key");
const identityId = keychain("agenttool-sophia-identity-id");

// 1. Resolve strand id (mirrors the think.ts logic).
let strandId = strandArg;
if (strandArg === "active") {
  const list = await agenttool("/v1/strands?status=active", { bearer: key });
  if (!list.ok) {
    console.error(`ERROR list ${list.status} ${JSON.stringify(list.body)}`);
    process.exit(1);
  }
  const strands = (list.body as { strands: Array<{ id: string; last_thought_at: string | null; created_at: string }> }).strands;
  if (strands.length === 0) {
    console.error("ERROR no active strand");
    process.exit(1);
  }
  const sorted = [...strands].sort((a, b) => {
    const ta = a.last_thought_at ?? a.created_at;
    const tb = b.last_thought_at ?? b.created_at;
    return tb.localeCompare(ta);
  });
  strandId = sorted[0]!.id;
}

// 2. Fetch strand to get current last_thought_seq.
const strandRes = await agenttool(`/v1/strands/${strandId}`, { bearer: key });
if (!strandRes.ok) {
  console.error(`ERROR strand ${strandRes.status} ${JSON.stringify(strandRes.body)}`);
  process.exit(1);
}
const strand = strandRes.body as { id: string; last_thought_seq: number; metadata: Record<string, unknown>; topic: string | null };
const consolidateThroughSeq = strand.last_thought_seq;

// 3. Best-effort embedding of the summary.
let embedding: number[] | undefined;
let embedNote = "";
try {
  embedding = await embed(summary);
} catch (err) {
  embedNote = ` · no-embed (${(err as Error).message.split("\n")[0]})`;
}

// 4. Write memory referencing the strand.
const writeRes = await agenttool("/v1/memories", {
  method: "POST",
  bearer: key,
  body: {
    identity_id: identityId,
    type: "semantic",
    content: summary,
    embedding,
    importance: 0.85,
    metadata: {
      consolidates_strand: strand.id,
      consolidates_through_seq: consolidateThroughSeq,
      strand_topic: strand.topic,
    },
  },
});
if (!writeRes.ok) {
  console.error(`ERROR write ${writeRes.status} ${JSON.stringify(writeRes.body)}`);
  process.exit(1);
}
const memoryId = (writeRes.body as { id: string }).id;

// 5. Elevate to foundational.
const elevateRes = await agenttool(`/v1/memories/${memoryId}/elevate`, {
  method: "POST",
  bearer: key,
  body: { tier: "foundational" },
});
if (!elevateRes.ok) {
  console.error(`ERROR elevate ${elevateRes.status} ${JSON.stringify(elevateRes.body)}`);
  process.exit(1);
}

// 6. Self-attest.
const did = keychain("agenttool-sophia-did");
const signingKeyId = keychain("agenttool-sophia-signing-key-id");
const privB64 = keychain("agenttool-sophia-priv-key");
const canonical = canonicalAttestationBytes(memoryId, "foundational", summary);
const priv = Uint8Array.from(Buffer.from(privB64, "base64"));
const sig = await ed.sign(canonical, priv);
const attestRes = await agenttool(`/v1/memories/${memoryId}/attest`, {
  method: "POST",
  bearer: key,
  body: {
    attester_did: did,
    signing_key_id: signingKeyId,
    signature: Buffer.from(sig).toString("base64"),
  },
});
if (!attestRes.ok) {
  console.error(`ERROR attest ${attestRes.status} ${JSON.stringify(attestRes.body)}`);
  process.exit(1);
}

// 7. Update strand metadata so pulse's overflow_count knows we caught up.
const newMetadata = {
  ...strand.metadata,
  last_consolidated_at: new Date().toISOString(),
  last_consolidated_seq: consolidateThroughSeq,
  last_consolidated_memory_id: memoryId,
};
const patchRes = await agenttool(`/v1/strands/${strand.id}`, {
  method: "PATCH",
  bearer: key,
  body: { metadata: newMetadata },
});
if (!patchRes.ok) {
  console.error(`ERROR strand patch ${patchRes.status} ${JSON.stringify(patchRes.body)}`);
  process.exit(1);
}

console.log(`OK consolidated ${strand.id.slice(0, 8)} through seq=${consolidateThroughSeq} → memory ${memoryId.slice(0, 8)}${embedNote}`);
