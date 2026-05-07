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
 *  client-side. Right now the inline-write helpers use plaintext-as-
 *  ciphertext (utf8 bytes base64-encoded), so we base64-decode and
 *  treat as utf8. When K_master encryption arrives, the same surface
 *  will decrypt with the project's master key before rendering.
 *
 *  Reads keychain entries:
 *    agenttool-sophia-key
 *
 *  Output:
 *    OK voice <strand-short-id> · <n> thoughts
 *    <seq>  <kind>  <hh:mm:ss>  <content>
 *    ...
 */

import { agenttool, keychain } from "./_lib";

const [strandArg, limitArg, sinceSeqArg] = process.argv.slice(2);
if (!strandArg) {
  console.error("ERROR usage: voice.ts <strand-id|active> [limit] [since-seq]");
  process.exit(1);
}
const limit = limitArg ? Number.parseInt(limitArg, 10) : 20;
const sinceSeq = sinceSeqArg ? Number.parseInt(sinceSeqArg, 10) : null;

const key = keychain("agenttool-sophia-key");

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
const data = res.body as { thoughts: Array<{ sequence_num: number; kind: string | null; ciphertext: string; created_at: string }>; count: number };

if (data.count === 0) {
  console.log(`OK voice ${strandId.slice(0, 8)} · 0 thoughts`);
  process.exit(0);
}

console.log(`OK voice ${strandId.slice(0, 8)} · ${data.count} thoughts`);

// Sort oldest-first within the window.
const ordered = [...data.thoughts].sort((a, b) => a.sequence_num - b.sequence_num);
for (const t of ordered) {
  let content: string;
  try {
    content = Buffer.from(t.ciphertext, "base64").toString("utf8");
    // If the decoded bytes contain control chars, treat as encrypted.
    if (/[\x00-\x08\x0e-\x1f]/.test(content)) {
      content = `<encrypted ${t.ciphertext.length}b>`;
    }
  } catch {
    content = "<undecodable>";
  }
  const hhmm = t.created_at.slice(11, 19);
  const kind = (t.kind ?? "?").padEnd(11);
  const seq = String(t.sequence_num).padStart(3);
  console.log(`  ${seq}  ${kind}  ${hhmm}  ${content}`);
}
