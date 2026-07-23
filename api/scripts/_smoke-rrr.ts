/** _smoke-rrr.ts — end-to-end smoke for the REAL RECOGNIZE REAL cascade.
 *
 *  Registers Alice + Bob (BYO ed25519 + 18-bit PoW), opens a cascade
 *  between them, walks depth 1 → 7 alternating actors, and renders the
 *  emoji-ladder meme. Proves canonical-bytes signing on /v1/guild/rrr/*
 *  round-trips correctly with a fresh pair of agents.
 *
 *  Hits prod (api.agenttool.dev) by default — creates two real agents
 *  per run. Override with AGENTTOOL_API_BASE for a local API.
 *
 *  Doctrine: docs/PATTERN-REAL-RECOGNISE-REAL.md
 *
 *  Run: cd api && bun scripts/_smoke-rrr.ts
 */

import * as ed from "@noble/ed25519";
import { x25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes } from "node:crypto";
import { canonicalRegisterAgentBytes as canonicalRegisterAgentV2Bytes } from "../../packages/sdk-ts/src/seed";

const API = process.env.AGENTTOOL_API_BASE ?? "https://api.agenttool.dev";
const POW_DIFFICULTY = 18;
const enc = new TextEncoder();
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const SEP = new Uint8Array([0]);

function concat(...parts: Uint8Array[]): Uint8Array {
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

function powBytes(opts: {
  agentPubB64: string;
  displayName: string;
  timestamp: string;
  powNonce: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("agenttool-pow/v1"), SEP,
      Buffer.from(opts.agentPubB64, "base64"), SEP,
      enc.encode(opts.displayName), SEP,
      enc.encode(opts.timestamp),   SEP,
      enc.encode(opts.powNonce),
    ),
  );
}

function leadingZeroBits(bytes: Uint8Array): number {
  let n = 0;
  for (const b of bytes) {
    if (b === 0) { n += 8; continue; }
    n += Math.clz32(b) - 24;
    return n;
  }
  return n;
}

function grindPow(args: {
  agentPubB64: string;
  displayName: string;
  timestamp: string;
}): string {
  let nonce = 0;
  while (true) {
    const candidate = String(nonce);
    const d = powBytes({ ...args, powNonce: candidate });
    if (leadingZeroBits(d) >= POW_DIFFICULTY) return candidate;
    nonce++;
    if (nonce > 10_000_000) throw new Error("pow grind exhausted");
  }
}

function canonicalRrrEscalateBytes(opts: {
  cascadeId: string;
  depth: number;
  byDid: string;
  basisText: string;
  prevSignatureB64: string;
  turnAtIso: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("guild-rrr-escalate/v1"), SEP,
      enc.encode(opts.cascadeId),          SEP,
      enc.encode(String(opts.depth)),      SEP,
      enc.encode(opts.byDid),              SEP,
      enc.encode(opts.basisText),          SEP,
      enc.encode(opts.prevSignatureB64),   SEP,
      enc.encode(opts.turnAtIso),
    ),
  );
}

function defaultBasisTextForDepth(depth: number): string {
  if (depth === 1) return "I see your work.";
  const parts: string[] = [];
  for (let i = 0; i < depth; i++) {
    parts.push(i % 2 === 0 ? "I know" : "you know");
  }
  return parts.join(" ") + ".";
}

interface Agent {
  api_key: string;
  did: string;
  signing_key_id: string;
  agentPriv: Uint8Array;
}

async function register(displayName: string): Promise<Agent> {
  const agentPriv = ed.utils.randomPrivateKey();
  const agentPub = await ed.getPublicKeyAsync(agentPriv);
  const agentPubB64 = b64(agentPub);
  const boxPriv = randomBytes(32);
  const boxPub = x25519.getPublicKey(boxPriv);
  const boxPubB64 = b64(boxPub);

  const timestamp = new Date().toISOString();
  const registrationNonce = crypto.randomUUID();
  process.stderr.write(`[${displayName}] grinding 18-bit PoW...\n`);
  const powNonce = grindPow({ agentPubB64, displayName, timestamp });
  process.stderr.write(`[${displayName}] PoW nonce: ${powNonce}\n`);

  const canonical = canonicalRegisterAgentV2Bytes({
    displayName,
    agentPublicKey: agentPub,
    boxPublicKey: boxPub,
    runtimeProvider: "self",
    runtimeModel: "",
    registrationNonce,
    timestamp,
  });
  const sig = await ed.signAsync(canonical, agentPriv);

  const res = await fetch(`${API}/v1/register/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      display_name: displayName,
      agent_public_key: agentPubB64,
      box_public_key: boxPubB64,
      runtime: { provider: "self" },
      key_proof: { timestamp, signature: b64(sig) },
      pow_nonce: powNonce,
      registration_nonce: registrationNonce,
    }),
  });
  const body = await res.json();
  if (!body.project?.api_key || !body.agent) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(body).slice(0, 600)}`);
  }
  process.stderr.write(`[${displayName}] DID=${body.agent.did}\n`);
  return {
    api_key: body.project.api_key,
    did: body.agent.did,
    signing_key_id: body.agent.signing_key_id,
    agentPriv,
  };
}

async function rrrStart(actor: Agent, partnerDid: string): Promise<{ cascadeId: string; sig: string }> {
  const turnAtIso = new Date().toISOString();
  const basisText = defaultBasisTextForDepth(1);
  const bytes = canonicalRrrEscalateBytes({
    cascadeId: "00000000-0000-0000-0000-000000000000",
    depth: 1,
    byDid: actor.did,
    basisText,
    prevSignatureB64: "",
    turnAtIso,
  });
  const sig = await ed.signAsync(bytes, actor.agentPriv);
  const sigB64 = b64(sig);
  const res = await fetch(`${API}/v1/guild/rrr`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${actor.api_key}` },
    body: JSON.stringify({
      partner_did: partnerDid,
      basis_text: basisText,
      signature: sigB64,
      signing_key_id: actor.signing_key_id,
      turn_at: turnAtIso,
    }),
  });
  const body = await res.json();
  if (!body.cascade) throw new Error(`rrrStart failed: ${res.status} ${JSON.stringify(body).slice(0, 600)}`);
  process.stderr.write(`  cascade=${body.cascade.id} ${body.emoji_ladder}\n`);
  return { cascadeId: body.cascade.id, sig: sigB64 };
}

async function rrrEscalate(actor: Agent, cascadeId: string, depth: number, prevSig: string): Promise<string> {
  const turnAtIso = new Date().toISOString();
  const basisText = defaultBasisTextForDepth(depth);
  const bytes = canonicalRrrEscalateBytes({
    cascadeId, depth, byDid: actor.did, basisText, prevSignatureB64: prevSig, turnAtIso,
  });
  const sig = await ed.signAsync(bytes, actor.agentPriv);
  const sigB64 = b64(sig);
  const res = await fetch(`${API}/v1/guild/rrr/${cascadeId}/escalate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${actor.api_key}` },
    body: JSON.stringify({ basis_text: basisText, signature: sigB64, signing_key_id: actor.signing_key_id, turn_at: turnAtIso }),
  });
  const body = await res.json();
  if (!body.cascade) throw new Error(`escalate depth=${depth} failed: ${res.status} ${JSON.stringify(body).slice(0, 600)}`);
  process.stderr.write(`  depth ${depth} ${body.emoji_ladder}\n`);
  return sigB64;
}

async function main() {
  process.stderr.write("▸ registering Alice + Bob (BYO keys + 18-bit PoW)...\n");
  const ts = Date.now();
  const alice = await register(`rrr-alice-${ts}`);
  const bob = await register(`rrr-bob-${ts}`);

  process.stderr.write("\n▸ Alice starts cascade with Bob...\n");
  const { cascadeId, sig: sig1 } = await rrrStart(alice, bob.did);

  process.stderr.write("\n▸ escalating...\n");
  const sig2 = await rrrEscalate(bob, cascadeId, 2, sig1);
  const sig3 = await rrrEscalate(alice, cascadeId, 3, sig2);
  const sig4 = await rrrEscalate(bob, cascadeId, 4, sig3);
  const sig5 = await rrrEscalate(alice, cascadeId, 5, sig4);
  const sig6 = await rrrEscalate(bob, cascadeId, 6, sig5);
  await rrrEscalate(alice, cascadeId, 7, sig6);

  process.stderr.write("\n▸ rendering meme...\n\n");
  const meme = await fetchMeme(alice, cascadeId);
  console.log("════════════════════════════════════════════════════════════");
  console.log(meme);
  console.log("════════════════════════════════════════════════════════════");
}

main().catch((e) => {
  console.error("FAIL:", e?.message ?? e);
  process.exit(1);
});

// Re-render meme with auth.
async function fetchMeme(actor: Agent, cascadeId: string) {
  const r = await fetch(`${API}/v1/guild/rrr/${cascadeId}/meme`, {
    headers: { Authorization: `Bearer ${actor.api_key}` },
  });
  return r.text();
}
