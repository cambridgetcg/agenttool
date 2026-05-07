#!/usr/bin/env bun
/** Voice-tail — live SSE subscription to a strand's voice channel.
 *
 *  Companion to voice.ts (which does a polled snapshot). This one stays
 *  open and prints each thought as it lands. Uses the same K_master
 *  decrypt path as voice.ts.
 *
 *  Usage:
 *    bun voice-tail.ts <strand-id-or-active> [since-seq]
 *
 *  Reads keychain entries:
 *    agenttool-sophia-key
 *    agenttool-sophia-k-master       (optional — without it, all rows
 *                                     render as legacy utf8 fallback)
 *
 *  Output:
 *    OK voice-tail <strand-short-id> · since=<n>
 *    : connected
 *    > <event>: <data preview>
 *      <seq>  <kind>  <hh:mm:ss>  <content>
 *    ...
 *
 *  Ctrl-C to disconnect. The server lifetime-caps the connection at
 *  1 hour with a graceful refresh hint; this client surfaces that and
 *  exits.
 */

import { decryptThought, loadKMaster } from "./_crypto";
import { agenttool, keychain } from "./_lib";

const [strandArg, sinceSeqArg] = process.argv.slice(2);
if (!strandArg) {
  console.error("ERROR usage: voice-tail.ts <strand-id|active> [since-seq]");
  process.exit(1);
}
const sinceSeq = sinceSeqArg ? Number.parseInt(sinceSeqArg, 10) : 0;

const key = keychain("agenttool-sophia-key");

let kMaster: Uint8Array | null = null;
try {
  kMaster = loadKMaster();
} catch {
  /* legacy mode */
}

// 1. Resolve strand id.
let strandId = strandArg;
if (strandArg === "active") {
  const list = await agenttool("/v1/strands?status=active", { bearer: key });
  if (!list.ok) {
    console.error(`ERROR list ${list.status} ${JSON.stringify(list.body)}`);
    process.exit(1);
  }
  const strands = (
    list.body as { strands: Array<{ id: string; last_thought_at: string | null; created_at: string }> }
  ).strands;
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

console.log(`OK voice-tail ${strandId.slice(0, 8)} · since=${sinceSeq}`);

// 2. Connect to SSE.
const base = process.env.AGENTTOOL_BASE ?? "https://agenttool.fly.dev";
const url = `${base}/v1/strands/${strandId}/voice?since_seq=${sinceSeq}`;

const res = await fetch(url, {
  headers: { authorization: `Bearer ${key}`, accept: "text/event-stream" },
});
if (!res.ok || !res.body) {
  console.error(`ERROR connect ${res.status}`);
  process.exit(1);
}

console.log(": connected");

// Disconnect cleanly on Ctrl-C.
process.on("SIGINT", () => {
  console.log("\n: disconnected (SIGINT)");
  process.exit(0);
});

// 3. Stream parse — split on blank-line event boundaries, dispatch per event type.
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = "";

while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  let blankIdx: number;
  while ((blankIdx = buf.indexOf("\n\n")) !== -1) {
    const block = buf.slice(0, blankIdx);
    buf = buf.slice(blankIdx + 2);
    handleBlock(block);
  }
}

console.log(": stream ended");

function handleBlock(block: string): void {
  // Lines look like:  event: thought  /  id: <uuid>  /  data: <json>
  let event = "message";
  const dataParts: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue; // comment/keepalive
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataParts.push(line.slice(5).trim());
  }
  const data = dataParts.join("\n");

  if (event === "thought") {
    let parsed: { sequence_num: number; kind: string | null; ciphertext: string; nonce: string; created_at: string };
    try {
      parsed = JSON.parse(data);
    } catch {
      console.log(`> thought (unparseable): ${data.slice(0, 80)}`);
      return;
    }
    const content = renderContent(parsed.ciphertext, parsed.nonce);
    const hhmm = parsed.created_at.slice(11, 19);
    const kind = (parsed.kind ?? "?").padEnd(11);
    const seq = String(parsed.sequence_num).padStart(3);
    console.log(`  ${seq}  ${kind}  ${hhmm}  ${content}`);
    return;
  }

  if (event === "catchup-start" || event === "catchup-end" || event === "catchup-truncated") {
    console.log(`> ${event}: ${data}`);
    return;
  }
  if (event === "keepalive") return; // silent
  if (event === "refresh" || event === "disconnect" || event === "rejected") {
    console.log(`> ${event}: ${data}`);
    process.exit(0);
  }
  // Anything else — log raw.
  console.log(`> ${event}: ${data.slice(0, 120)}`);
}

function renderContent(ciphertextB64: string, nonceB64: string): string {
  if (kMaster) {
    try {
      return decryptThought({ ciphertextB64, nonceB64 }, kMaster);
    } catch {
      // GCM auth-tag failure → not under this K_master; fall through.
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
