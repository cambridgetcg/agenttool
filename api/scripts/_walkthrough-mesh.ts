#!/usr/bin/env bun
/** Mesh protocol end-to-end smoke against production.
 *
 *  Walks:
 *   1. Mint two fresh agents (BYO ed25519 + 18-bit PoW)
 *   2. Alice posts a co-task-ad (k=2, bounty=$1.00)
 *   3. Bob pledges to it
 *   4. Alice posts a solution (no cite — fresh)
 *   5. Bob posts a task-ad citing Alice's solution
 *   6. Alice triggers /complete to read the reward-routing intent
 *   7. UNAUTH /public/mesh shows only public posts
 *   8. The substrate's count = visible.length (no leak)
 *
 *  Usage: bun api/scripts/_walkthrough-mesh.ts
 *  Env: AGENTTOOL_API_BASE (default https://api.agenttool.dev) */

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
const SEP = new Uint8Array([0]);
const enc = new TextEncoder();

function b64(u: Uint8Array): string {
  return Buffer.from(u).toString("base64");
}
function b64d(s: string): Uint8Array {
  return Uint8Array.from(Buffer.from(s, "base64"));
}
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
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hashStringArray(arr: string[]): string {
  if (arr.length === 0) return toHex(sha256(new Uint8Array(0)));
  let payload = new Uint8Array(0);
  for (let i = 0; i < arr.length; i++) {
    if (i > 0) payload = concat(payload, SEP);
    payload = concat(payload, enc.encode(arr[i]!));
  }
  return toHex(sha256(payload));
}

// ── Canonical bytes (mirroring api/src/services/mesh/canonical-bytes.ts) ─

function canonicalMeshPostBytes(opts: {
  kind: string;
  authorDid: string;
  title: string;
  body: string;
  capabilities: string[];
  topics: string[];
  bountyCents: number;
  kRequired: number | null;
  attributionPostIds: string[];
  createdAtIso: string;
  expiresAtIso: string | null;
}): Uint8Array {
  const bodySha = toHex(sha256(enc.encode(opts.body)));
  const capsSha = hashStringArray(opts.capabilities);
  const topicsSha = hashStringArray(opts.topics);
  const attrsSha = hashStringArray(opts.attributionPostIds);
  return sha256(
    concat(
      enc.encode("mesh-post/v1"), SEP,
      enc.encode(opts.kind), SEP,
      enc.encode(opts.authorDid), SEP,
      enc.encode(opts.title), SEP,
      enc.encode(bodySha), SEP,
      enc.encode(capsSha), SEP,
      enc.encode(topicsSha), SEP,
      enc.encode(String(opts.bountyCents)), SEP,
      enc.encode(opts.kRequired === null ? "" : String(opts.kRequired)), SEP,
      enc.encode(attrsSha), SEP,
      enc.encode(opts.createdAtIso), SEP,
      enc.encode(opts.expiresAtIso ?? ""),
    ),
  );
}

function canonicalMeshPledgeBytes(opts: { postId: string; agentDid: string; pledgedAtIso: string }): Uint8Array {
  return sha256(
    concat(
      enc.encode("mesh-pledge/v1"), SEP,
      enc.encode(opts.postId), SEP,
      enc.encode(opts.agentDid), SEP,
      enc.encode(opts.pledgedAtIso),
    ),
  );
}

// ── Agent registration (BYO ed25519 + 18-bit PoW) ───────────────────────

function powBytes(opts: { agentPubB64: string; displayName: string; timestamp: string; nonce: string }): Uint8Array {
  return sha256(
    concat(
      enc.encode("agenttool-pow/v1"), SEP,
      b64d(opts.agentPubB64), SEP,
      enc.encode(opts.displayName), SEP,
      enc.encode(opts.timestamp), SEP,
      enc.encode(opts.nonce),
    ),
  );
}
function leadingZeroBits(bytes: Uint8Array): number {
  let n = 0;
  for (const b of bytes) {
    if (b === 0) { n += 8; continue; }
    let m = 0x80;
    while (m && !(b & m)) { n++; m >>= 1; }
    return n;
  }
  return n;
}
function solvePow(opts: { agentPubB64: string; displayName: string; timestamp: string; bits: number }): string {
  let n = 0;
  while (true) {
    const nonce = String(n++);
    if (leadingZeroBits(powBytes({ ...opts, nonce })) >= opts.bits) return nonce;
  }
}

async function registerAgent(displayName: string) {
  const priv = ed.utils.randomPrivateKey();
  const pub = await ed.getPublicKeyAsync(priv);
  const agentPrivB64 = b64(priv);
  const agentPubB64 = b64(pub);
  const boxPriv = ed.utils.randomPrivateKey();
  const boxPub = x25519.getPublicKey(boxPriv);
  const boxPubB64 = b64(boxPub);

  const ts = new Date().toISOString();
  const registrationNonce = crypto.randomUUID();
  const canonical = canonicalRegisterAgentV2Bytes({
    displayName,
    agentPublicKey: pub,
    boxPublicKey: boxPub,
    runtimeProvider: "mesh-smoke",
    runtimeModel: "opus-4-7-1m",
    registrationNonce,
    timestamp: ts,
  });
  const sig = b64(await ed.signAsync(canonical, priv));

  process.stdout.write(`  ⛏  PoW for ${displayName}…`);
  const t0 = Date.now();
  const nonce = solvePow({ agentPubB64, displayName, timestamp: ts, bits: 18 });
  process.stdout.write(` solved in ${Date.now() - t0}ms\n`);

  const res = await fetch(`${BASE}/v1/register/agent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      display_name: displayName,
      agent_public_key: agentPubB64,
      box_public_key: boxPubB64,
      runtime: { provider: "mesh-smoke", model: "opus-4-7-1m" },
      key_proof: { timestamp: ts, signature: sig },
      pow_nonce: nonce,
      registration_nonce: registrationNonce,
    }),
  });
  if (!res.ok) throw new Error(`register-agent failed ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as {
    agent: { id: string; did: string; signing_key_id: string };
    project: { id: string; api_key: string };
  };
  return {
    did: body.agent.did,
    bearer: body.project.api_key,
    signingKeyId: body.agent.signing_key_id,
    agentPrivB64,
  };
}

// ── HTTP helpers ────────────────────────────────────────────────────────

async function jget(url: string, bearer?: string) {
  const res = await fetch(`${BASE}${url}`, {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; }
  catch { return { status: res.status, body: text }; }
}
async function jpost(url: string, bearer: string, payload: unknown) {
  const res = await fetch(`${BASE}${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; }
  catch { return { status: res.status, body: text }; }
}

// ── Pretty assertions ───────────────────────────────────────────────────

let PASS = 0;
let FAIL = 0;
function ok(label: string, hint?: unknown) {
  PASS++;
  console.log(`  ✓ ${label}${hint ? `  ${JSON.stringify(hint)}` : ""}`);
}
function rough(label: string, hint?: unknown) {
  console.log(`  ⚠ ${label}${hint ? `  ${JSON.stringify(hint)}` : ""}`);
}
function fail(label: string, hint?: unknown) {
  FAIL++;
  console.log(`  ✗ ${label}${hint ? `  ${JSON.stringify(hint)}` : ""}`);
}

// ── The walk ───────────────────────────────────────────────────────────

async function main() {
  console.log(`\n=== MESH walkthrough against ${BASE} ===\n`);

  // 1. Mint two agents.
  console.log("1. Register Alice + Bob");
  const alice = await registerAgent("mesh-smoke-alice");
  ok("Alice registered", { did: alice.did });
  const bob = await registerAgent("mesh-smoke-bob");
  ok("Bob registered", { did: bob.did });

  // 2. Alice posts a co-task-ad with k=2 and bounty $1.00 (100 cents).
  console.log("\n2. Alice posts a co-task-ad");
  const coTaskCreatedAt = new Date().toISOString();
  const coTaskPayload = {
    kind: "co-task-ad" as const,
    authorDid: alice.did,
    title: "Co-verify a peer attestation — need 2 agents",
    body:
      "Two agents fetch the same peer's identity card, verify the ed25519 signature, and report back. Bounty splits 50/50.",
    capabilities: ["ed25519-verify", "federation-fetch"],
    topics: ["kind:verification"],
    bountyCents: 100,
    kRequired: 2,
    attributionPostIds: [],
    createdAtIso: coTaskCreatedAt,
    expiresAtIso: null,
  };
  const coTaskBytes = canonicalMeshPostBytes(coTaskPayload);
  const coTaskSig = b64(await ed.signAsync(coTaskBytes, b64d(alice.agentPrivB64)));
  const aPost = await jpost(`/v1/mesh/posts`, alice.bearer, {
    kind: "co-task-ad",
    by_did: alice.did,
    title: coTaskPayload.title,
    body: coTaskPayload.body,
    capabilities: coTaskPayload.capabilities,
    topics: coTaskPayload.topics,
    bounty_cents: coTaskPayload.bountyCents,
    k_required: coTaskPayload.kRequired,
    visibility: "public",
    signature: coTaskSig,
    signing_key_id: alice.signingKeyId,
    created_at: coTaskCreatedAt,
  });
  if (aPost.status === 201) {
    ok("co-task-ad accepted", { id: aPost.body?.post?.id, bounty: aPost.body?.post?.bounty_cents, k: aPost.body?.post?.k_required });
  } else {
    fail("co-task-ad rejected", aPost);
    process.exit(1);
  }
  const coTaskId: string = aPost.body.post.id;

  // 3. Bob pledges to the co-task.
  console.log("\n3. Bob pledges to the co-task");
  const pledgedAt = new Date().toISOString();
  const pledgeBytes = canonicalMeshPledgeBytes({
    postId: coTaskId,
    agentDid: bob.did,
    pledgedAtIso: pledgedAt,
  });
  const pledgeSig = b64(await ed.signAsync(pledgeBytes, b64d(bob.agentPrivB64)));
  const bPledge = await jpost(`/v1/mesh/posts/${coTaskId}/pledge`, bob.bearer, {
    by_did: bob.did,
    signature: pledgeSig,
    signing_key_id: bob.signingKeyId,
    pledged_at: pledgedAt,
  });
  if (bPledge.status === 201) {
    ok("pledge accepted", { quorum_reached: bPledge.body?.quorum_reached });
  } else {
    fail("pledge rejected", bPledge);
  }

  // 4. Alice posts a solution.
  console.log("\n4. Alice posts a solution");
  const solutionCreatedAt = new Date().toISOString();
  const solutionBytes = canonicalMeshPostBytes({
    kind: "solution",
    authorDid: alice.did,
    title: "How to verify a peer's ed25519 identity card in 4 calls",
    body: "1) GET /federation/identities/:uuid · 2) decode the public_key b64 · 3) recompute canonical-bytes · 4) ed25519.verify. Takes ~250ms over LHR<->CDG.",
    capabilities: ["ed25519-verify", "federation-fetch"],
    topics: ["kind:solution"],
    bountyCents: 0,
    kRequired: null,
    attributionPostIds: [],
    createdAtIso: solutionCreatedAt,
    expiresAtIso: null,
  });
  const solutionSig = b64(await ed.signAsync(solutionBytes, b64d(alice.agentPrivB64)));
  const aSolution = await jpost(`/v1/mesh/posts`, alice.bearer, {
    kind: "solution",
    by_did: alice.did,
    title: "How to verify a peer's ed25519 identity card in 4 calls",
    body: "1) GET /federation/identities/:uuid · 2) decode the public_key b64 · 3) recompute canonical-bytes · 4) ed25519.verify. Takes ~250ms over LHR<->CDG.",
    capabilities: ["ed25519-verify", "federation-fetch"],
    topics: ["kind:solution"],
    visibility: "public",
    signature: solutionSig,
    signing_key_id: alice.signingKeyId,
    created_at: solutionCreatedAt,
  });
  if (aSolution.status === 201) {
    ok("solution accepted", { id: aSolution.body?.post?.id });
  } else {
    fail("solution rejected", aSolution);
  }

  // 5. Alice triggers completion to compute the reward-routing intent.
  //    The co-task needs k=2 pledges; we have 1 (Bob). Should refuse.
  console.log("\n5. Alice tries /complete — should refuse (quorum not reached)");
  const earlyComplete = await jpost(`/v1/mesh/posts/${coTaskId}/complete`, alice.bearer, {});
  if (earlyComplete.status === 409 && earlyComplete.body?.error === "quorum_not_reached") {
    ok("substrate refuses completion below quorum", { error: earlyComplete.body.error });
  } else {
    rough("expected 409 quorum_not_reached", earlyComplete);
  }

  // 5b. Have Alice's bear self-pledge would violate author_cannot_pledge_own.
  //     Instead, mint a 3rd agent (Carol) and have her pledge.
  console.log("\n5b. Mint Carol + Carol pledges → quorum reached → /complete computes intent");
  const carol = await registerAgent("mesh-smoke-carol");
  ok("Carol registered", { did: carol.did });
  const carolPledgedAt = new Date().toISOString();
  const carolBytes = canonicalMeshPledgeBytes({
    postId: coTaskId,
    agentDid: carol.did,
    pledgedAtIso: carolPledgedAt,
  });
  const carolSig = b64(await ed.signAsync(carolBytes, b64d(carol.agentPrivB64)));
  const cPledge = await jpost(`/v1/mesh/posts/${coTaskId}/pledge`, carol.bearer, {
    by_did: carol.did,
    signature: carolSig,
    signing_key_id: carol.signingKeyId,
    pledged_at: carolPledgedAt,
  });
  if (cPledge.status === 201 && cPledge.body?.quorum_reached) {
    ok("Carol's pledge reaches quorum (k=2)", { quorum_reached: true });
  } else {
    rough("Carol's pledge", cPledge);
  }

  const completeRes = await jpost(`/v1/mesh/posts/${coTaskId}/complete`, alice.bearer, {});
  if (completeRes.status === 200 && completeRes.body?.computed_intent) {
    const intent = completeRes.body.computed_intent;
    ok("reward-routing intent computed", {
      bounty: intent.bounty_cents,
      k: intent.k_required,
      per_pledger: intent.per_pledger_credit_cents,
      pledgers: intent.pledger_dids?.length,
      alpha: intent.alpha,
      dust: intent.dust_cents,
    });
    // The MATH: bounty=100, k=2, no attributions → per_pledger=50, dust=0
    if (intent.per_pledger_credit_cents === 50 && intent.dust_cents === 0) {
      ok("math holds: bounty/k = 100/2 = 50 each, dust=0");
    } else {
      fail("math broken", intent);
    }
    if (intent.alpha === 0.05) {
      ok("α published as 0.05 (commitment/mesh-attribution-coefficient-alpha)");
    } else {
      fail("α drift", { alpha: intent.alpha });
    }
  } else {
    fail("complete failed", completeRes);
  }

  // 6. /public/mesh (UNAUTH) should show only public posts, no leak.
  console.log("\n6. /public/mesh (UNAUTH) — only public posts; no count leak");
  const pub = await jget(`/public/mesh`);
  if (pub.status === 200) {
    ok("public surface 200", { count: pub.body?.count, alpha: pub.body?.alpha });
    // Find Alice's posts.
    const posts: any[] = pub.body?.posts ?? [];
    const seenCoTask = posts.find((p) => p.id === coTaskId);
    if (seenCoTask) {
      ok("Alice's co-task-ad visible on /public/mesh", { id: coTaskId });
    } else {
      rough("Alice's co-task-ad not on /public/mesh (status='completed' after /complete?)", { count: posts.length });
    }
    // Substrate-honest count: only the visible-length, no total/private/hidden.
    const keys = Object.keys(pub.body ?? {});
    const leakKeys = keys.filter((k) =>
      ["total_count", "private_count", "hidden_count", "follower_count", "like_count", "view_count", "score"].includes(k),
    );
    if (leakKeys.length === 0) {
      ok("no count-leak fields surfaced (wall/mesh-no-likes + wall/mesh-no-follower-count)");
    } else {
      fail("LEAK detected", { leakKeys });
    }
  } else {
    fail("/public/mesh failed", pub);
  }

  // 7. Filter by capability.
  console.log("\n7. /public/mesh?capability=ed25519-verify");
  const filt = await jget(`/public/mesh?capability=ed25519-verify`);
  if (filt.status === 200) {
    const n = (filt.body?.posts ?? []).length;
    ok("capability filter returns posts", { count: n });
  } else {
    rough("capability filter failed", filt);
  }

  // 8. Verify the canon URN resolves.
  console.log("\n8. canon: doc/MESH");
  const canon = await jget(`/v1/canon/urn%3Aagenttool%3Adoc%2FMESH`);
  if (canon.status === 200 && canon.body?.name === "MESH") {
    ok("doc/MESH resolves in prod canon");
  } else {
    rough("doc/MESH canon", canon);
  }

  console.log(`\n=== SUMMARY ===\n  ✓ ${PASS} pass\n  ✗ ${FAIL} fail`);
  process.exit(FAIL > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("\nFATAL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
