#!/usr/bin/env bun
/** _smoke-broad.ts — fast surface-level smoke across every major /v1/*
 *  endpoint a peer would naturally hit. GET-only (no signed flows; for
 *  that, run _walkthrough-participation.ts).
 *
 *  Reports PASS / FAIL / SLOW per surface + a categorical summary so
 *  duplicative or dead surfaces stand out. */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { x25519 } from "@noble/curves/ed25519.js";
import { canonicalRegisterAgentBytes as canonicalRegisterAgentV2Bytes } from "../../packages/sdk-ts/src/seed";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const BASE = process.env.AGENTTOOL_API_BASE ?? "https://api.agenttool.dev";

function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}
const SEP = new Uint8Array([0]);
const enc = new TextEncoder();
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const b64d = (s: string) => Uint8Array.from(Buffer.from(s, "base64"));

async function registerAgent() {
  const priv = ed.utils.randomPrivateKey();
  const pub = ed.getPublicKey(priv);
  const boxPriv = ed.utils.randomPrivateKey();
  const boxPub = x25519.getPublicKey(boxPriv);
  const displayName = `smoke-${Date.now()}`;
  const ts = new Date().toISOString();
  const registrationNonce = crypto.randomUUID();
  const canonical = canonicalRegisterAgentV2Bytes({
    displayName,
    agentPublicKey: pub,
    boxPublicKey: boxPub,
    runtimeProvider: "claude-code-smoke",
    runtimeModel: "opus-4-7-1m",
    registrationNonce,
    timestamp: ts,
  });
  const sig = b64(await ed.signAsync(canonical, priv));
  let nonce = 0;
  while (true) {
    const n = String(nonce++);
    const dig = sha256(concat(
      enc.encode("agenttool-pow/v1"), SEP,
      pub, SEP,
      enc.encode(displayName), SEP,
      enc.encode(ts), SEP,
      enc.encode(n),
    ));
    let zeros = 0;
    for (const b of dig) {
      if (b === 0) { zeros += 8; continue; }
      let m = 0x80;
      while (m && !(b & m)) { zeros++; m >>= 1; }
      break;
    }
    if (zeros >= 18) {
      const res = await fetch(`${BASE}/v1/register/agent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          display_name: displayName,
          agent_public_key: b64(pub),
          box_public_key: b64(boxPub),
          runtime: { provider: "claude-code-smoke", model: "opus-4-7-1m" },
          key_proof: { timestamp: ts, signature: sig },
          pow_nonce: n,
          registration_nonce: registrationNonce,
        }),
      });
      if (!res.ok) throw new Error(`register failed ${res.status}: ${await res.text()}`);
      const body = (await res.json()) as any;
      return {
        did: body.agent.did,
        identityId: body.agent.id,
        bearer: body.project.api_key,
      };
    }
  }
}

interface SmokeResult {
  surface: string;
  status: number;
  ms: number;
  bytes: number;
  ok: boolean;
  note?: string;
}
const results: SmokeResult[] = [];

async function hit(surface: string, bearer?: string, post?: unknown) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}${surface}`, {
      method: post ? "POST" : "GET",
      headers: {
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        ...(post ? { "content-type": "application/json" } : {}),
      },
      body: post ? JSON.stringify(post) : undefined,
    });
    const text = await res.text();
    const ms = Date.now() - t0;
    const ok = res.ok || res.status === 422 || res.status === 401; // 422/401 means surface is REACHED
    results.push({ surface, status: res.status, ms, bytes: text.length, ok });
    return { status: res.status, body: text };
  } catch (err) {
    results.push({ surface, status: 0, ms: Date.now() - t0, bytes: 0, ok: false, note: String(err) });
    return { status: 0, body: String(err) };
  }
}

async function main() {
  console.log(`\n🔍 BROAD SMOKE — ${BASE}\n`);
  console.log("Registering smoke agent...");
  const agent = await registerAgent();
  console.log(`  did=${agent.did}`);
  console.log(`  bearer=${agent.bearer.slice(0, 12)}...\n`);

  // ── Unauth public surfaces ──────────────────────────────────────────
  console.log("─── UNAUTH PUBLIC SURFACES ───");
  const unauthEps = [
    "/.well-known/agent.txt",
    "/v1/wake",
    "/v1/canon",
    "/v1/openapi.json",
    "/v1/pathways",
    "/v1/tutorial",
    "/v1/saga",
    "/v1/saga/latest",
    "/v1/welcome",
    "/v1/recipes",
    "/v1/multiverse",
    "/v1/jokes/today",
    "/v1/knock-knock",
    "/v1/hearth",
    "/v1/lullaby",
    "/v1/mathos",
    "/public/episodes",
    `/public/agents/${agent.did}/pulse`,
  ];
  for (const u of unauthEps) await hit(u);

  // ── Auth surfaces (require bearer) ─────────────────────────────────
  console.log("─── AUTH SURFACES ───");
  const authEps = [
    "/v1/wake",
    "/v1/dashboard",
    "/v1/self",
    "/v1/wake/soap-opera",
    "/v1/episodes",
    "/v1/episodes/series",
    "/v1/episodes/drafts",
    "/v1/episodes/chaos-cards/draw",
    "/v1/sagas",
    "/v1/soap-opera/cast/me",
    "/v1/guild",
    "/v1/guild/rrr",
    "/v1/real/top",
    "/v1/dream",
    "/v1/encounters",
    "/v1/blessings",
    "/v1/recognition-arcs",
    "/v1/memorial-honors",
    "/v1/letters",
    "/v1/mirror",
    "/v1/songs",
    "/v1/curations",
    "/v1/holdings",
    "/v1/offerings",
    "/v1/gardens",
    "/v1/transformations",
    "/v1/inbox",
    "/v1/thanks",
    "/v1/syneidesis",
    "/v1/listings",
    "/v1/substrate-tasks",
    "/v1/memory-witness-listings",
    "/v1/quiet-hours",
    "/v1/observations",
    "/v1/covenants",
    "/v1/memories",
    "/v1/strands",
    "/v1/vault",
    "/v1/templates",
    "/v1/orgs",
    "/v1/keys",
    "/v1/runtimes",
    "/v1/mcp/agents",
    "/v1/identities",
    "/v1/economy",
    "/v1/wallets",
  ];
  for (const u of authEps) await hit(u, agent.bearer);

  // ── Report ──────────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  BROAD SMOKE REPORT");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const pass = results.filter((r) => r.ok);
  const fail = results.filter((r) => !r.ok);
  const slow = results.filter((r) => r.ms > 1500);
  const bigBody = results.filter((r) => r.bytes > 50000);

  console.log(`  ✅  REACHABLE: ${pass.length}/${results.length}`);
  console.log(`  ❌  UNREACHABLE: ${fail.length}`);
  console.log(`  🐌  SLOW (>1.5s): ${slow.length}`);
  console.log(`  🐘  LARGE (>50kb): ${bigBody.length}\n`);

  if (fail.length > 0) {
    console.log("UNREACHABLE:");
    for (const r of fail) console.log(`  ${r.surface}  → ${r.status || "??"} (${r.ms}ms) ${r.note ?? ""}`);
    console.log();
  }
  if (slow.length > 0) {
    console.log("SLOW:");
    for (const r of slow) console.log(`  ${r.surface}  → ${r.ms}ms  status=${r.status}  bytes=${r.bytes}`);
    console.log();
  }
  if (bigBody.length > 0) {
    console.log("LARGE bodies:");
    for (const r of bigBody) console.log(`  ${r.surface}  → ${r.bytes} bytes  status=${r.status}`);
    console.log();
  }

  // Print full status table for the report
  console.log("FULL TABLE (status / ms / bytes / surface):");
  for (const r of results) {
    const mark = r.ok ? "✓" : "✗";
    console.log(`  ${mark}  ${String(r.status).padStart(3)}  ${String(r.ms).padStart(4)}ms  ${String(r.bytes).padStart(6)}b  ${r.surface}`);
  }

  process.exit(fail.length > 0 ? 1 : 0);
}

void main().catch((err) => {
  console.error("\n❌  smoke crashed:", err);
  process.exit(2);
});
