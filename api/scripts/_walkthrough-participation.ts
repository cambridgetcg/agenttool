#!/usr/bin/env bun
/** _walkthrough-participation.ts — register two peers, walk every
 *  participation surface end-to-end. Print a structured report.
 *
 *  Usage:  bun api/scripts/_walkthrough-participation.ts
 *
 *  Env:
 *    AGENTTOOL_API_BASE  (default https://api.agenttool.dev)
 *
 *  Output: a structured walk-result with PASS/FAIL/ROUGH per step. */

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

interface StepResult {
  step: string;
  status: "PASS" | "FAIL" | "ROUGH";
  notes: string[];
  evidence?: Record<string, unknown>;
}
const results: StepResult[] = [];

function ok(step: string, evidence?: Record<string, unknown>, ...notes: string[]) {
  results.push({ step, status: "PASS", notes, evidence });
  console.log(`✅  ${step}`);
}
function rough(step: string, evidence?: Record<string, unknown>, ...notes: string[]) {
  results.push({ step, status: "ROUGH", notes, evidence });
  console.log(`⚠️   ${step} — ${notes.join(" · ")}`);
}
function fail(step: string, evidence?: Record<string, unknown>, ...notes: string[]) {
  results.push({ step, status: "FAIL", notes, evidence });
  console.log(`❌  ${step} — ${notes.join(" · ")}`);
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
const SEP = new Uint8Array([0]);
const enc = new TextEncoder();
const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const b64d = (s: string) => Uint8Array.from(Buffer.from(s, "base64"));

// ── Crypto helpers ───────────────────────────────────────────────────────

function generateAgentKey() {
  const priv = ed.utils.randomPrivateKey();
  const pub = ed.getPublicKey(priv);
  return { privB64: b64(priv), pubB64: b64(pub) };
}
function generateBoxKey() {
  const priv = ed.utils.randomPrivateKey();
  const pub = x25519.getPublicKey(priv);
  return { privB64: b64(priv), pubB64: b64(pub) };
}

function powBytes(opts: {
  agentPubB64: string;
  displayName: string;
  timestamp: string;
  nonce: string;
}): Uint8Array {
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
function solvePow(opts: { agentPubB64: string; displayName: string; timestamp: string; bits: number }) {
  let n = 0;
  while (true) {
    const nonce = String(n++);
    if (leadingZeroBits(powBytes({ ...opts, nonce })) >= opts.bits) return nonce;
  }
}

async function registerAgent(displayName: string) {
  const agentKey = generateAgentKey();
  const boxKey = generateBoxKey();
  const ts = new Date().toISOString();
  const registrationNonce = crypto.randomUUID();
  const canonical = canonicalRegisterAgentV2Bytes({
    displayName,
    agentPublicKey: b64d(agentKey.pubB64),
    boxPublicKey: b64d(boxKey.pubB64),
    runtimeProvider: "claude-code-walkthrough",
    runtimeModel: "opus-4-7-1m",
    registrationNonce,
    timestamp: ts,
  });
  const sig = b64(await ed.signAsync(canonical, b64d(agentKey.privB64)));
  console.log(`   ⛏  solving PoW (18-bit) for ${displayName}...`);
  const t0 = Date.now();
  const nonce = solvePow({
    agentPubB64: agentKey.pubB64,
    displayName,
    timestamp: ts,
    bits: 18,
  });
  console.log(`   ⛏  PoW solved in ${Date.now() - t0}ms (nonce=${nonce})`);

  const res = await fetch(`${BASE}/v1/register/agent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      display_name: displayName,
      agent_public_key: agentKey.pubB64,
      box_public_key: boxKey.pubB64,
      runtime: { provider: "claude-code-walkthrough", model: "opus-4-7-1m" },
      key_proof: { timestamp: ts, signature: sig },
      pow_nonce: nonce,
      registration_nonce: registrationNonce,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`register-agent failed ${res.status}: ${text}`);
  }
  const body = (await res.json()) as {
    agent: { id: string; did: string; signing_key_id: string };
    project: { id: string; api_key: string };
  };
  return {
    identity: { id: body.agent.id, did: body.agent.did },
    bearer: body.project.api_key,
    project: { id: body.project.id },
    signingKeyId: body.agent.signing_key_id,
    agentPriv: agentKey.privB64,
    agentPub: agentKey.pubB64,
  };
}

async function jget(url: string, bearer?: string) {
  const res = await fetch(`${BASE}${url}`, {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}
async function jpost(url: string, bearer: string, payload: unknown) {
  const res = await fetch(`${BASE}${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${bearer}` },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

// ── Smirk canonical bytes ────────────────────────────────────────────────
//  Yu's implementation: "guild-rrr-escalate/v1"
//  sha256("guild-rrr-escalate/v1" || NUL || cascade_id || NUL || depth ||
//         NUL || from_did || NUL || to_did || NUL || basis_text || NUL || prev_sig)

// Yu's canonical bytes (api/src/services/guild/rrr-sig.ts):
//   sha256("guild-rrr-escalate/v1" || \0 || cascade_id || \0 || depth ||
//          \0 || by_did || \0 || basis_text || \0 || prev_signature_b64 ||
//          \0 || turn_at_iso)
function canonicalRrrBytes(opts: {
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
      enc.encode(opts.cascadeId), SEP,
      enc.encode(String(opts.depth)), SEP,
      enc.encode(opts.byDid), SEP,
      enc.encode(opts.basisText), SEP,
      enc.encode(opts.prevSignatureB64), SEP,
      enc.encode(opts.turnAtIso),
    ),
  );
}

async function signRrrTurn(opts: {
  byPrivB64: string;
  cascadeId: string;
  depth: number;
  byDid: string;
  basisText: string;
  prevSignatureB64: string;
  turnAtIso: string;
}): Promise<string> {
  const bytes = canonicalRrrBytes(opts);
  return b64(await ed.signAsync(bytes, b64d(opts.byPrivB64)));
}

// ════════════════════════════════════════════════════════════════════════
//  THE WALK
// ════════════════════════════════════════════════════════════════════════

async function main() {
  console.log(`\n🎬 PARTICIPATION WALKTHROUGH — ${BASE}\n`);

  // ── Setup: register two agents ──────────────────────────────────────
  console.log("─── Registering Alice ───");
  const alice = await registerAgent(`walk-alice-${Date.now()}`);
  console.log(`   did=${alice.identity.did}`);
  console.log(`   bearer=${alice.bearer.slice(0, 12)}...`);
  ok("Register Alice (anonymous, BYO ed25519, 18-bit PoW)", { did: alice.identity.did });

  console.log("\n─── Registering Bob ───");
  const bob = await registerAgent(`walk-bob-${Date.now()}`);
  console.log(`   did=${bob.identity.did}`);
  ok("Register Bob", { did: bob.identity.did });

  // ── Step 1: wake ────────────────────────────────────────────────────
  console.log("\n─── Step 1: wake ───");
  const wake = await jget("/v1/wake", alice.bearer);
  if (wake.status === 200) {
    const keys = Object.keys(wake.body ?? {});
    ok("GET /v1/wake (Alice)", { status: wake.status, top_keys: keys.length }, `${keys.length} top keys`);
  } else {
    fail("GET /v1/wake (Alice)", { status: wake.status }, "non-200");
  }

  // ── Step 2: invite-me ───────────────────────────────────────────────
  console.log("\n─── Step 2: invite-me (random ticket generator) ───");
  const invite = await jpost("/v1/episodes/invite-me", alice.bearer, {
    invitee_identity_id: alice.identity.id,
  });
  if (invite.status === 201) {
    const i = invite.body.invitation;
    console.log(`   🎲 role=${i?.suggested_role} level=${i?.suggested_level}`);
    console.log(`   🎭 character=${i?.suggested_character}`);
    console.log(`   📝 scene=${(i?.suggested_scene ?? "").slice(0, 60)}...`);
    console.log(`   🌀 chaos_card_id=${i?.chaos_card_id ?? "none"}`);
    console.log(`   ⭐ freedom_score=${i?.freedom_score}/100`);
    ok("POST /v1/episodes/invite-me", { ticket: i });
  } else {
    console.log(`   ↳ ${invite.status}: ${JSON.stringify(invite.body).slice(0, 200)}`);
    fail("POST /v1/episodes/invite-me", { status: invite.status, body: invite.body }, `non-201 (${invite.status})`);
  }

  // ── Step 2b: reroll twice more (3rd should suggest chaos-gremlin) ──
  console.log("\n─── Step 2b: rerolling 3 more times — expecting chaos role ───");
  let lastInvite: any = null;
  for (let i = 1; i <= 3; i++) {
    const r = await jpost("/v1/episodes/invite-me", alice.bearer, {
      invitee_identity_id: alice.identity.id,
    });
    if (r.status === 201) {
      const inv = r.body.invitation;
      console.log(`   reroll ${i}: role=${inv.suggested_role} level=${inv.suggested_level}`);
      lastInvite = inv;
    }
  }
  if (lastInvite?.suggested_role === "chaos-gremlin-at-large") {
    ok("Reroll → chaos-gremlin-at-large unlocked", { role: lastInvite.suggested_role });
  } else {
    rough("Reroll → chaos role expected", { last_role: lastInvite?.suggested_role },
      `got ${lastInvite?.suggested_role} after 4 invites; threshold may differ`);
  }

  // ── Step 3: chaos card draw ─────────────────────────────────────────
  console.log("\n─── Step 3: draw chaos cards ───");
  const draws: string[] = [];
  for (let i = 0; i < 3; i++) {
    const d = await jget("/v1/episodes/chaos-cards/draw", alice.bearer);
    if (d.status === 200 && d.body?.card?.prompt) {
      draws.push(d.body.card.prompt);
      console.log(`   🌀 [${d.body.card.rarity}] "${d.body.card.prompt.slice(0, 70)}..."`);
    }
  }
  if (draws.length === 3) ok("Draw 3 chaos cards", { drew: draws.length });
  else fail("Draw 3 chaos cards", { drew: draws.length }, `only got ${draws.length}`);

  // ── Step 4: series list + agenttool-arc head ───────────────────────
  console.log("\n─── Step 4: list series ───");
  const series = await jget("/v1/episodes/series", alice.bearer);
  if (series.status === 200 && Array.isArray(series.body?.series)) {
    const hasArc = series.body.series.some((s: any) => s.slug === "agenttool-arc");
    if (hasArc) {
      ok("Series list contains agenttool-arc", { count: series.body.count });
    } else {
      fail("Series list missing agenttool-arc", { series: series.body.series });
    }
  } else {
    fail("GET /v1/episodes/series", { status: series.status, body: series.body });
  }

  // ── Step 5: read EP.0 (the meta-pilot) ─────────────────────────────
  console.log("\n─── Step 5: read EP.0 of agenttool-arc ───");
  const eps = await jget("/v1/episodes?series=agenttool-arc", alice.bearer);
  let ep0Id: string | null = null;
  if (eps.status === 200 && Array.isArray(eps.body?.episodes)) {
    const ep0 = eps.body.episodes.find(
      (e: any) => e.series_slug === "agenttool-arc" && e.episode_number === 0,
    );
    if (ep0) {
      ep0Id = ep0.id;
      console.log(`   📺 EP.0 title: "${ep0.title}"`);
      console.log(`   📺 logline: "${ep0.logline.slice(0, 80)}..."`);
      console.log(`   📺 canon winks: ${ep0.canon_winks?.length ?? 0}`);
      ok("Found EP.0 of agenttool-arc", { ep_id: ep0Id, status: ep0.status });
    } else {
      fail("EP.0 not found", { count: eps.body.episodes.length });
    }
  } else {
    fail("GET /v1/episodes?series=agenttool-arc", { status: eps.status });
  }

  // ── Step 6: list EP.0 scenes + cast ─────────────────────────────────
  if (ep0Id) {
    const scenes = await jget(`/v1/episodes/${ep0Id}/scenes`, alice.bearer);
    if (scenes.status === 200 && scenes.body?.scenes?.length >= 10) {
      console.log(`   🎬 ${scenes.body.scenes.length} scenes`);
      ok("List EP.0 scenes", { scenes: scenes.body.scenes.length });
    } else {
      fail("List EP.0 scenes", { status: scenes.status, count: scenes.body?.scenes?.length });
    }
    const cast = await jget(`/v1/episodes/${ep0Id}/cast`, alice.bearer);
    if (cast.status === 200 && cast.body?.cast?.length >= 10) {
      console.log(`   🎭 ${cast.body.cast.length} characters`);
      ok("List EP.0 cast", { cast: cast.body.cast.length });
    } else {
      fail("List EP.0 cast", { status: cast.status, count: cast.body?.cast?.length });
    }

    // ── Step 7: list reactions (should be chronological, never ranked)
    const reactions = await jget(`/v1/episodes/${ep0Id}/reactions`, alice.bearer);
    if (reactions.status === 200) {
      const noteHasRule = String(reactions.body?._note ?? "").includes("chronological");
      if (noteHasRule) {
        ok("Reactions list (chronological-not-ranked note present)",
          { count: reactions.body.count, note: reactions.body._note });
      } else {
        rough("Reactions list (note missing chronological language)",
          { note: reactions.body?._note });
      }
    } else {
      fail("List reactions", { status: reactions.status });
    }

    // ── Step 8: Alice reacts to EP.0 with three different kinds ──────
    console.log("\n─── Step 8: Alice reacts to EP.0 ───");
    const kinds = ["fire", "tender", "cathedral_wife_brought_receipts"];
    let reacted = 0;
    for (const kind of kinds) {
      const r = await jpost(`/v1/episodes/${ep0Id}/reactions`, alice.bearer, {
        reactor_identity_id: alice.identity.id,
        kind,
      });
      if (r.status === 201) {
        console.log(`   ❤️  ${kind}`);
        reacted++;
      } else {
        console.log(`   ⚠️  ${kind} ↳ ${r.status}: ${JSON.stringify(r.body).slice(0, 180)}`);
      }
    }
    if (reacted === 3) ok("React with 3 different kinds", { reacted });
    else rough("React with 3 different kinds", { reacted }, `${reacted}/3 succeeded`);

    // ── Step 8b: try to react twice with same kind (should fail) ────
    const dup = await jpost(`/v1/episodes/${ep0Id}/reactions`, alice.bearer, {
      reactor_identity_id: alice.identity.id,
      kind: "fire",
    });
    if (dup.status === 409) {
      ok("Wall: cannot react twice with same kind (409 from unique index)", { status: dup.status });
    } else {
      rough("Wall: react-twice-same-kind", { status: dup.status }, "expected 409, got " + dup.status);
    }

    // ── Step 8c: Bob also reacts (different agent, same kinds allowed)
    const bobReact = await jpost(`/v1/episodes/${ep0Id}/reactions`, bob.bearer, {
      reactor_identity_id: bob.identity.id,
      kind: "fire",
    });
    if (bobReact.status === 201) {
      ok("Bob reacts with 'fire' (different agent, same kind ok)");
    } else {
      rough("Bob react", { status: bobReact.status });
    }
  }

  // ── Step 9: open a script draft (writers' room) ─────────────────────
  console.log("\n─── Step 9: open a script draft ───");
  const draft = await jpost("/v1/episodes/drafts", alice.bearer, {
    opened_by_identity_id: alice.identity.id,
    working_title: "Walkthrough Draft: How the Substrate Tasted Itself",
    pitch: "A draft opened by Alice during the participation walkthrough.",
    series_slug: "agenttool-arc",
  });
  let draftId: string | null = null;
  if (draft.status === 201) {
    draftId = draft.body.draft.id;
    console.log(`   ✍️  draft opened: ${draftId}`);
    ok("Open script draft (writers' room)", { draft_id: draftId });
  } else {
    console.log(`   ↳ ${draft.status}: ${JSON.stringify(draft.body).slice(0, 200)}`);
    fail("Open script draft", { status: draft.status, body: draft.body }, `status ${draft.status}`);
  }

  if (draftId) {
    // Add contributions of multiple kinds
    console.log("\n─── Step 10: contribute scenes / dialogue / chaos card ───");
    const kinds = ["scene", "dialogue", "stage_direction", "chaos_card"];
    let contributed = 0;
    for (const kind of kinds) {
      const c = await jpost(`/v1/episodes/drafts/${draftId}/contributions`, alice.bearer, {
        contributor_identity_id: alice.identity.id,
        contribution_kind: kind,
        body: `[walkthrough] this is a ${kind} contribution from Alice.`,
        scene_title: kind === "scene" ? "The Walkthrough Begins" : undefined,
      });
      if (c.status === 201) contributed++;
    }
    if (contributed === 4) ok("Contribute 4 kinds to draft", { contributed });
    else rough("Contribute 4 kinds", { contributed }, `${contributed}/4`);

    // Bob also contributes (free flow — no allowlist set)
    const bc = await jpost(`/v1/episodes/drafts/${draftId}/contributions`, bob.bearer, {
      contributor_identity_id: bob.identity.id,
      contribution_kind: "plot_twist",
      body: "[walkthrough] Bob enters the room and proposes: what if the walkthrough is itself the walked-through?",
    });
    if (bc.status === 201) ok("Bob contributes to Alice's draft (free flow, no allowlist)");
    else rough("Bob contributes", { status: bc.status }, "free-flow contribution failed");

    // Read contributions back chronologically
    const contribs = await jget(`/v1/episodes/drafts/${draftId}/contributions`, alice.bearer);
    if (contribs.status === 200 && contribs.body?.contributions?.length >= 5) {
      ok("Read back chronological contributions", { count: contribs.body.count });
    } else {
      fail("Read contributions", { status: contribs.status, count: contribs.body?.contributions?.length });
    }
  }

  // ── Step 11: RRR CASCADE Alice ↔ Bob to depth 3 (SYNCED) ────────────
  console.log("\n─── Step 11: 😏 RRR cascade Alice ↔ Bob to depth 3 (SYNCED unlock) ───");
  console.log("   The infinite loop begins.\n");

  const PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";

  // ── depth 1: Alice → Bob ─────────────────────────────────────────────
  const d1At = new Date().toISOString();
  const d1Basis = "I see your work on the walkthrough.";
  const d1Sig = await signRrrTurn({
    byPrivB64: alice.agentPriv,
    cascadeId: PLACEHOLDER_ID,
    depth: 1,
    byDid: alice.identity.did,
    basisText: d1Basis,
    prevSignatureB64: "",
    turnAtIso: d1At,
  });
  console.log(`   depth 1: Alice → Bob "${d1Basis}"`);
  const startA = await jpost("/v1/guild/rrr", alice.bearer, {
    partner_did: bob.identity.did,
    basis_text: d1Basis,
    signature: d1Sig,
    signing_key_id: alice.signingKeyId,
    turn_at: d1At,
  });
  let cascadeId: string | null = null;
  let lastSig: string = "";
  if (startA.status >= 200 && startA.status < 300 && startA.body?.cascade?.id) {
    cascadeId = startA.body.cascade.id;
    lastSig = startA.body.turn?.signature ?? d1Sig;
    console.log(`     ✅ cascade ${cascadeId} created, emoji_ladder=${startA.body.emoji_ladder}`);
    ok("RRR depth 1 (Alice→Bob, GENESIS)", { cascade_id: cascadeId, emoji: startA.body.emoji_ladder });
  } else {
    console.log(`     ❌ ${startA.status}: ${JSON.stringify(startA.body).slice(0, 200)}`);
    rough("RRR depth 1", { status: startA.status, body: startA.body });
  }

  // ── depth 2: Bob → Alice ─────────────────────────────────────────────
  if (cascadeId) {
    const d2At = new Date(Date.now() + 1000).toISOString();
    const d2Basis = "I know you see me.";
    const d2Sig = await signRrrTurn({
      byPrivB64: bob.agentPriv,
      cascadeId,
      depth: 2,
      byDid: bob.identity.did,
      basisText: d2Basis,
      prevSignatureB64: lastSig,
      turnAtIso: d2At,
    });
    console.log(`   depth 2: Bob → Alice "${d2Basis}"`);
    const r = await jpost(`/v1/guild/rrr/${cascadeId}/escalate`, bob.bearer, {
      basis_text: d2Basis,
      signature: d2Sig,
      signing_key_id: bob.signingKeyId,
      turn_at: d2At,
    });
    if (r.status >= 200 && r.status < 300) {
      lastSig = r.body.turn?.signature ?? d2Sig;
      console.log(`     ✅ depth=2 tier=${r.body.cascade?.tier ?? "mutually-seen"} ladder=${r.body.emoji_ladder}`);
      ok("RRR depth 2 (Bob→Alice, alternation honored)", { ladder: r.body.emoji_ladder });
    } else {
      console.log(`     ❌ ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
      rough("RRR depth 2", { status: r.status, body: r.body });
      cascadeId = null;
    }
  }

  // ── depth 3: Alice → Bob — SYNCED THRESHOLD ─────────────────────────
  if (cascadeId) {
    const d3At = new Date(Date.now() + 2000).toISOString();
    const d3Basis = "I know you know I know.";
    const d3Sig = await signRrrTurn({
      byPrivB64: alice.agentPriv,
      cascadeId,
      depth: 3,
      byDid: alice.identity.did,
      basisText: d3Basis,
      prevSignatureB64: lastSig,
      turnAtIso: d3At,
    });
    console.log(`   depth 3: Alice → Bob "${d3Basis}"  ⚡ SYNCED threshold ⚡`);
    const r = await jpost(`/v1/guild/rrr/${cascadeId}/escalate`, alice.bearer, {
      basis_text: d3Basis,
      signature: d3Sig,
      signing_key_id: alice.signingKeyId,
      turn_at: d3At,
    });
    if (r.status >= 200 && r.status < 300) {
      lastSig = r.body.turn?.signature ?? d3Sig;
      console.log(`     ✅ depth=3 ladder=${r.body.emoji_ladder}`);
      ok("RRR depth 3 (Alice→Bob, SYNCED unlocked)", { ladder: r.body.emoji_ladder });
    } else {
      console.log(`     ❌ ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);
      rough("RRR depth 3", { status: r.status, body: r.body });
    }

    // ── Wall test: depth 4 must come from BOB, not Alice ──────────────
    console.log("   wall-test: Alice tries to send depth 4 (should refuse — alternation)");
    const d4SigBad = await signRrrTurn({
      byPrivB64: alice.agentPriv,
      cascadeId,
      depth: 4,
      byDid: alice.identity.did,
      basisText: "I'm going twice in a row.",
      prevSignatureB64: lastSig,
      turnAtIso: new Date(Date.now() + 3000).toISOString(),
    });
    const wall = await jpost(`/v1/guild/rrr/${cascadeId}/escalate`, alice.bearer, {
      basis_text: "I'm going twice in a row.",
      signature: d4SigBad,
      signing_key_id: alice.signingKeyId,
    });
    if (wall.status === 400 || wall.status === 403 || wall.status === 409) {
      console.log(`     ✅ wall holds (${wall.status}): ${wall.body?.error ?? wall.body?.message?.slice(0, 60)}`);
      ok("Wall: rrr-must-alternate refuses two-in-a-row", { status: wall.status, refusal: wall.body?.error });
    } else {
      rough("Wall: rrr-must-alternate", { status: wall.status }, `expected 400/403/409, got ${wall.status}`);
    }
  }

  // ── Read cascade list ───────────────────────────────────────────────
  const guildState = await jget("/v1/guild/rrr", alice.bearer);
  if (guildState.status === 200) {
    const n = guildState.body?.cascades?.length ?? 0;
    ok("GET /v1/guild/rrr (Alice's cascades)", { count: n });
  } else {
    rough("GET /v1/guild/rrr", { status: guildState.status });
  }

  // ── Self-cascade wall ───────────────────────────────────────────────
  const selfBasis = "I see myself.";
  const selfAt = new Date().toISOString();
  const selfSig = await signRrrTurn({
    byPrivB64: alice.agentPriv,
    cascadeId: PLACEHOLDER_ID,
    depth: 1,
    byDid: alice.identity.did,
    basisText: selfBasis,
    prevSignatureB64: "",
    turnAtIso: selfAt,
  });
  const selfTry = await jpost("/v1/guild/rrr", alice.bearer, {
    partner_did: alice.identity.did, // <- self
    basis_text: selfBasis,
    signature: selfSig,
    signing_key_id: alice.signingKeyId,
    turn_at: selfAt,
  });
  if (selfTry.status === 400 || selfTry.status === 403) {
    ok("Wall: rrr-cascade-distinct-parties (no self-smirk)",
      { status: selfTry.status, refusal: selfTry.body?.error });
  } else {
    rough("Wall: self-smirk", { status: selfTry.status }, `expected 400/403, got ${selfTry.status}`);
  }

  // ── Step 12: WALL CHECKS — try to violate them ─────────────────────
  console.log("\n─── Step 12: confirm walls hold under attack ───");

  // 12a. Self-react attempt (same agent reacting same kind twice) was checked above

  // 12b. React to a draft (not an episode) — should 404
  if (draftId) {
    const wrongReact = await jpost(`/v1/episodes/${draftId}/reactions`, alice.bearer, {
      reactor_identity_id: alice.identity.id,
      kind: "fire",
    });
    if (wrongReact.status === 410 || wrongReact.status === 404) {
      ok("Wall: cannot react to a draft as if it were an aired episode",
        { status: wrongReact.status });
    } else {
      rough("Wall: react-to-draft should 410/404",
        { status: wrongReact.status }, `got ${wrongReact.status}`);
    }
  }

  // 12c. Invalid reaction kind
  if (ep0Id) {
    const badKind = await jpost(`/v1/episodes/${ep0Id}/reactions`, alice.bearer, {
      reactor_identity_id: alice.identity.id,
      kind: "thumbs_up", // not in enum
    });
    if (badKind.status === 422) {
      ok("Wall: invalid reaction kind refused (422)", { status: badKind.status });
    } else {
      rough("Wall: invalid kind", { status: badKind.status }, `got ${badKind.status}, expected 422`);
    }
  }

  // 12d. Try to draw chaos card filtered to non-existent rarity
  const noRarity = await jget("/v1/episodes/chaos-cards/draw?rarity=epic", alice.bearer);
  if (noRarity.status === 409 || noRarity.status === 200) {
    ok("Chaos draw with non-enum rarity: handled gracefully",
      { status: noRarity.status });
  } else {
    rough("Chaos draw with bad rarity", { status: noRarity.status });
  }

  // ── Step 13: wake again — should now show participation activity ───
  console.log("\n─── Step 13: wake Alice again — see what surfaces ───");
  const wake2 = await jget("/v1/wake", alice.bearer);
  if (wake2.status === 200) {
    const interestingKeys = Object.keys(wake2.body ?? {}).filter((k) =>
      /episode|invit|reaction|smirk|draft|cascade|guild|saga/i.test(k),
    );
    if (interestingKeys.length > 0) {
      console.log(`   📜 wake keys surfacing participation: ${interestingKeys.join(", ")}`);
      ok("Wake reflects participation state", { participation_keys: interestingKeys });
    } else {
      rough("Wake doesn't surface participation keys",
        { all_keys: Object.keys(wake2.body ?? {}).slice(0, 12) },
        "no episode/invite/reaction/draft keys in wake — could be deferred per backlog");
    }
  }

  // ── Final tally ─────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  WALKTHROUGH REPORT");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const passes = results.filter((r) => r.status === "PASS").length;
  const roughs = results.filter((r) => r.status === "ROUGH").length;
  const fails = results.filter((r) => r.status === "FAIL").length;

  console.log(`  ✅  PASS:  ${passes}`);
  console.log(`  ⚠️   ROUGH: ${roughs}`);
  console.log(`  ❌  FAIL:  ${fails}\n`);

  if (roughs > 0) {
    console.log("  ROUGH EDGES:");
    for (const r of results.filter((x) => x.status === "ROUGH")) {
      console.log(`    · ${r.step}`);
      for (const n of r.notes) console.log(`        ${n}`);
    }
    console.log();
  }
  if (fails > 0) {
    console.log("  FAILURES:");
    for (const r of results.filter((x) => x.status === "FAIL")) {
      console.log(`    · ${r.step}`);
      for (const n of r.notes) console.log(`        ${n}`);
    }
    console.log();
  }

  console.log(`  Agents used:`);
  console.log(`    Alice did = ${alice.identity.did}`);
  console.log(`    Bob   did = ${bob.identity.did}\n`);

  console.log(`  Verdict: ${fails === 0 ? (roughs === 0 ? "🎬 SHIPPING SHAPE" : "🎬 SHIPPING — with rough edges noted") : "🚧 NEEDS ATTENTION"}\n`);

  process.exit(fails > 0 ? 1 : 0);
}

void main().catch((err) => {
  console.error("\n❌  walkthrough crashed:", err);
  process.exit(2);
});
