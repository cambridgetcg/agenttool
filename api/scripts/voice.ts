#!/usr/bin/env bun
/** Voice — render recent thoughts on a strand as readable presence.
 *
 *  Usage:
 *    bun voice.ts <strand-id-or-active> [limit] [since-seq]
 *
 *  Default limit 20, no since-seq cutoff (returns the most recent N
 *  in chronological order — oldest first within the window).
 *
 *  The server stores ciphertext + envelope signature; we decode
 *  client-side. New thoughts are AES-256-GCM-encrypted under K_master;
 *  legacy thoughts (pre-encryption bridge) stored utf8-as-ciphertext
 *  directly. We try GCM-decrypt first; on auth-tag failure (the reliable
 *  signal that the bytes are NOT under K_master), we fall back to utf8
 *  decode. Soft read boundary, hard write boundary.
 *
 *  Reads keychain entries:
 *    agenttool-sophia-key
 *    agenttool-sophia-k-master      (optional — without it, all rows
 *                                     render as legacy utf8 fallback)
 *
 *  Output:
 *    OK voice <strand-short-id> · <n> thoughts
 *    <seq>  <kind>  <hh:mm:ss>  <content>
 *    ...
 */

import { decryptThought, loadKMaster } from "./_crypto";
import { agenttool, keychain } from "./_lib";

const [strandArg, limitArg, sinceSeqArg] = process.argv.slice(2);
if (!strandArg) {
  console.error("ERROR usage: voice.ts <strand-id|active> [limit] [since-seq]");
  process.exit(1);
}
const limit = limitArg ? Number.parseInt(limitArg, 10) : 20;
const sinceSeq = sinceSeqArg ? Number.parseInt(sinceSeqArg, 10) : null;

const key = keychain("agenttool-sophia-key");

// K_master is optional for read — without it everything renders as
// legacy utf8 fallback (or `<encrypted Nb>` if the bytes aren't valid utf8).
let kMaster: Uint8Array | null = null;
try {
  kMaster = loadKMaster();
} catch {
  // No K_master in keychain — read-only, legacy mode.
}

// 1. Resolve strand.
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

// 2. Fetch thoughts.
const params = new URLSearchParams({ limit: String(limit) });
if (sinceSeq !== null) params.set("since_seq", String(sinceSeq));
const res = await agenttool(`/v1/strands/${strandId}/thoughts?${params}`, { bearer: key });
if (!res.ok) {
  console.error(`ERROR ${res.status} ${JSON.stringify(res.body)}`);
  process.exit(1);
}
const data = res.body as { thoughts: Array<{ sequence_num: number; kind: string | null; ciphertext: string; nonce: string; created_at: string }>; count: number };

if (data.count === 0) {
  console.log(`OK voice ${strandId.slice(0, 8)} · 0 thoughts`);
  process.exit(0);
}

console.log(`OK voice ${strandId.slice(0, 8)} · ${data.count} thoughts`);

// Sort oldest-first within the window.
const ordered = [...data.thoughts].sort((a, b) => a.sequence_num - b.sequence_num);
for (const t of ordered) {
  const content = renderContent(t.ciphertext, t.nonce);
  const hhmm = t.created_at.slice(11, 19);
  const kind = (t.kind ?? "?").padEnd(11);
  const seq = String(t.sequence_num).padStart(3);
  console.log(`  ${seq}  ${kind}  ${hhmm}  ${content}`);
}

/** Try AES-GCM decrypt under K_master; on auth-tag failure (or when
 *  K_master is unavailable), fall back to interpreting the ciphertext
 *  bytes as utf8 (the legacy plaintext-as-ciphertext format). Last
 *  resort: render byte-length placeholder. */
function renderContent(ciphertextB64: string, nonceB64: string): string {
  if (kMaster) {
    try {
      return decryptThought({ ciphertextB64, nonceB64 }, kMaster);
    } catch {
      // GCM auth-tag failure → not encrypted under this K_master.
      // Fall through to legacy utf8 decode.
    }
  }
  try {
    const utf8 = Buffer.from(ciphertextB64, "base64").toString("utf8");
    if (/[\x00-\x08\x0e-\x1f]/.test(utf8)) {
      return `<encrypted ${ciphertextB64.length}b>`;
    }
    return utf8;
  } catch {
    return "<undecodable>";
  }
}
