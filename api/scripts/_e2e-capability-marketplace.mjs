// E2E: capability marketplace (Horizon A Slice 2).
//
// Sellers publish callable listings; buyers invoke (paying via escrow);
// seller submits ed25519-signed sealed output → escrow releases. SLA
// timeouts auto-refund. This harness walks the full lifecycle including
// the failure modes (self-invoke, bad sig, expired SLA, paused listing).
//
// Run: cd api && node scripts/_e2e-capability-marketplace.mjs

import { randomBytes, createHash } from "node:crypto";
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

ed.etc.sha512Sync = (...m) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const BASE = process.env.AGENTTOOL_BASE ?? "http://localhost:3000";
const PRICE = 250;
const FUND = 1_000;

function log(label, ok, detail = "") {
  const mark = ok ? "✓" : "✗";
  console.log(`  ${mark} ${label}${detail ? ` · ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

async function call(method, path, body, key) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

function b64(bytes) { return Buffer.from(bytes).toString("base64"); }
function b64d(str)  { return Uint8Array.from(Buffer.from(str, "base64")); }

function sealedBytes() {
  // Dummy sealed-box envelope — platform never decrypts. The shape is
  // what we validate (ct any-length base64, nonce=24 bytes, sender_pub=32 bytes).
  return {
    ct: b64(randomBytes(64)),
    nonce: b64(randomBytes(24)),
    sender_pub: b64(randomBytes(32)),
  };
}

function concat(...parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function canonicalCompletionBytes(invocationId, output) {
  const enc = new TextEncoder();
  const SEP = new Uint8Array([0]);
  const tag = enc.encode("invocation-completion/v1");
  const id = enc.encode(invocationId);
  const ct = b64d(output.ct);
  const nonce = b64d(output.nonce);
  const senderPub = b64d(output.sender_pub);
  const buf = concat(tag, SEP, id, SEP, ct, SEP, nonce, SEP, senderPub);
  return new Uint8Array(createHash("sha256").update(buf).digest());
}

async function signCompletion(invocationId, output, privateKeyB64) {
  const canonical = canonicalCompletionBytes(invocationId, output);
  const priv = b64d(privateKeyB64);
  const sig = await ed.sign(canonical, priv);
  return b64(sig);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  console.log(`\n  agenttool · capability marketplace e2e`);
  console.log(`  ───────────────────────────────────────`);
  console.log(`  base: ${BASE}\n`);

  // ── Seller setup ───────────────────────────────────────────────────
  console.log("  ▸ seller setup");
  let r = await call("POST", "/v1/register", {
    name: `e2e-cap-seller-${Date.now()}`,
  });
  log("POST /v1/register (seller) · 201", r.status === 201);
  if (r.status !== 201) process.exit(1);
  const sellerKey = r.data.project.api_key;
  const sellerIdentityId = r.data.agent.id;
  const sellerPriv = r.data.agent.private_key;
  log(`  → seller priv key returned`, !!sellerPriv);

  r = await call("POST", "/v1/wallets", {
    name: "seller-wallet",
    currency: "GBP",
    identityId: sellerIdentityId,
  }, sellerKey);
  const sellerWallet = r.data?.data ?? r.data?.wallet ?? r.data;
  log("POST /v1/wallets (seller) · 201", r.status === 201);

  // ── Buyer setup ────────────────────────────────────────────────────
  console.log("");
  console.log("  ▸ buyer setup");
  r = await call("POST", "/v1/register", {
    name: `e2e-cap-buyer-${Date.now()}`,
  });
  log("POST /v1/register (buyer) · 201", r.status === 201);
  const buyerKey = r.data.project.api_key;
  const buyerIdentityId = r.data.agent.id;

  r = await call("POST", "/v1/wallets", {
    name: "buyer-wallet",
    currency: "GBP",
    identityId: buyerIdentityId,
  }, buyerKey);
  const buyerWallet = r.data?.data ?? r.data?.wallet ?? r.data;
  log("POST /v1/wallets (buyer) · 201", r.status === 201);

  r = await call("POST", `/v1/wallets/${buyerWallet.id}/fund`, {
    amount: FUND,
    description: "e2e cap seed",
  }, buyerKey);
  log(`POST /v1/wallets/:id/fund · 201`, r.status === 201);

  r = await call("GET", `/v1/wallets/${buyerWallet.id}`, null, buyerKey);
  const buyerStart = r.data?.data?.balance ?? r.data?.wallet?.balance ?? r.data?.balance;
  log(`buyer balance === ${FUND}`, buyerStart === FUND);

  // ── Seller publishes a listing ─────────────────────────────────────
  console.log("");
  console.log("  ▸ seller publishes listing");
  r = await call("POST", "/v1/listings", {
    seller_identity_id: sellerIdentityId,
    name: `e2e-listing-${Date.now()}`,
    description: "Test callable for e2e harness.",
    capability_tags: ["e2e", "test", "summarise"],
    input_schema: { type: "object", properties: { text: { type: "string" } } },
    output_schema: { type: "object", properties: { summary: { type: "string" } } },
    price_amount: PRICE,
    price_currency: "GBP",
    seller_wallet_id: sellerWallet.id,
    sla_seconds: 60,
    visibility: "public",
  }, sellerKey);
  log("POST /v1/listings · 201", r.status === 201, `err=${r.data?.error}`);
  if (r.status !== 201) {
    console.error("    response:", JSON.stringify(r.data).slice(0, 400));
    process.exit(1);
  }
  const listingId = r.data.id;
  log(`  → price_amount === ${PRICE}`, r.data.price_amount === PRICE);
  log(`  → seller_did present`, !!r.data.seller_did);

  // ── Public listing surfaces it ─────────────────────────────────────
  r = await call("GET", `/public/listings/${listingId}`);
  log("GET /public/listings/:id · 200",
    r.status === 200 && r.data?.id === listingId);
  log("  → public listing exposes price + tags",
    r.data?.price_amount === PRICE && Array.isArray(r.data?.capability_tags));

  // ── Self-invoke refused ────────────────────────────────────────────
  console.log("");
  console.log("  ▸ self-invocation refused");
  r = await call("POST", `/v1/listings/${listingId}/invoke`, {
    buyer_identity_id: sellerIdentityId,
    buyer_wallet_id: sellerWallet.id,
    input_sealed: sealedBytes(),
  }, sellerKey);
  log("self-invoke → 409 self_invocation_not_allowed",
    r.status === 409 && r.data?.error === "self_invocation_not_allowed",
    `status=${r.status} err=${r.data?.error}`);

  // ── Buyer invokes ──────────────────────────────────────────────────
  console.log("");
  console.log("  ▸ buyer invokes");
  r = await call("POST", `/v1/listings/${listingId}/invoke`, {
    buyer_identity_id: buyerIdentityId,
    buyer_wallet_id: buyerWallet.id,
    input_sealed: sealedBytes(),
  }, buyerKey);
  log("POST /v1/listings/:id/invoke · 201", r.status === 201, `err=${r.data?.error}`);
  if (r.status !== 201) {
    console.error("    response:", JSON.stringify(r.data).slice(0, 400));
    process.exit(1);
  }
  const inv = r.data?.invocation;
  log(`  → invocation.status === 'escrowed'`, inv?.status === "escrowed");
  log(`  → escrow_id present`, !!inv?.escrow_id);
  log(`  → sla_deadline_at present`, !!inv?.sla_deadline_at);
  const invocationId = inv.id;

  // Buyer wallet decremented
  r = await call("GET", `/v1/wallets/${buyerWallet.id}`, null, buyerKey);
  const buyerAfterInvoke = r.data?.data?.balance ?? r.data?.wallet?.balance ?? r.data?.balance;
  log(`buyer wallet decremented by ${PRICE}`,
    buyerAfterInvoke === buyerStart - PRICE,
    `start=${buyerStart} after=${buyerAfterInvoke}`);

  // ── Seller acknowledges ────────────────────────────────────────────
  console.log("");
  console.log("  ▸ seller acknowledges");
  r = await call("POST", `/v1/invocations/${invocationId}/acknowledge`, {}, sellerKey);
  log("POST /v1/invocations/:id/acknowledge · 200",
    r.status === 200 && r.data?.status === "acknowledged",
    `status=${r.status}`);

  // ── Bad signature on /complete is rejected ─────────────────────────
  console.log("");
  console.log("  ▸ /complete with bad signature → 409");
  r = await call("POST", `/v1/invocations/${invocationId}/complete`, {
    output_sealed: sealedBytes(),
    signature: b64(randomBytes(64)),  // random sig — won't verify
  }, sellerKey);
  log("/complete bad sig → 409 completion_signature_invalid",
    r.status === 409 && r.data?.error === "completion_signature_invalid",
    `status=${r.status} err=${r.data?.error}`);

  // ── Seller completes with valid signature ──────────────────────────
  console.log("");
  console.log("  ▸ seller completes with valid signature");
  const output = sealedBytes();
  const signature = await signCompletion(invocationId, output, sellerPriv);
  r = await call("POST", `/v1/invocations/${invocationId}/complete`, {
    output_sealed: output,
    signature,
  }, sellerKey);
  log("/complete valid · 200 status=released",
    r.status === 200 && r.data?.status === "released",
    `status=${r.status} err=${r.data?.error}`);
  log(`  → output_sealed stored`, !!r.data?.output_sealed?.ct);
  log(`  → completion_sig stored`, !!r.data?.completion_sig);
  log(`  → settled_at present`, !!r.data?.settled_at);

  // Seller wallet credited
  r = await call("GET", `/v1/wallets/${sellerWallet.id}`, null, sellerKey);
  const sellerAfter = r.data?.data?.balance ?? r.data?.wallet?.balance ?? r.data?.balance;
  log(`seller wallet credited by ${PRICE}`,
    sellerAfter === PRICE, `balance=${sellerAfter}`);

  // Listing revenue counters bumped
  r = await call("GET", `/v1/listings/${listingId}`, null, sellerKey);
  log("listing.revenue_total bumped",
    r.data?.revenue_total === PRICE,
    `revenue_total=${r.data?.revenue_total}`);
  log("listing.revenue_count === 1", r.data?.revenue_count === 1);
  log("listing.invocations_count === 1", r.data?.invocations_count === 1);

  // ── Buyer cancel before ack (separate invocation) ──────────────────
  console.log("");
  console.log("  ▸ buyer cancels another invocation before ack");
  r = await call("POST", `/v1/listings/${listingId}/invoke`, {
    buyer_identity_id: buyerIdentityId,
    buyer_wallet_id: buyerWallet.id,
    input_sealed: sealedBytes(),
  }, buyerKey);
  const cancelInvId = r.data?.invocation?.id;
  log(`second invocation created (escrowed)`, !!cancelInvId);
  const balBeforeCancel = (await call("GET", `/v1/wallets/${buyerWallet.id}`, null, buyerKey))
    .data?.data?.balance ?? 0;

  r = await call("POST", `/v1/invocations/${cancelInvId}/cancel`, {}, buyerKey);
  log("POST /v1/invocations/:id/cancel · 200 status=refunded",
    r.status === 200 && r.data?.status === "refunded",
    `status=${r.status} err=${r.data?.error}`);
  log("  → refund_reason === 'cancelled'", r.data?.refund_reason === "cancelled");

  const balAfterCancel = (await call("GET", `/v1/wallets/${buyerWallet.id}`, null, buyerKey))
    .data?.data?.balance ?? 0;
  log(`buyer wallet refunded by ${PRICE}`,
    balAfterCancel === balBeforeCancel + PRICE,
    `before=${balBeforeCancel} after=${balAfterCancel}`);

  // ── SLA timeout (sla_seconds=1; sleep; lazy-expire on GET) ─────────
  console.log("");
  console.log("  ▸ SLA timeout simulation");
  r = await call("POST", "/v1/listings", {
    seller_identity_id: sellerIdentityId,
    name: `e2e-fast-sla-${Date.now()}`,
    description: "fast-SLA test",
    capability_tags: ["e2e", "fast"],
    price_amount: PRICE,
    price_currency: "GBP",
    seller_wallet_id: sellerWallet.id,
    sla_seconds: 1,           // 1-second SLA
    visibility: "public",
  }, sellerKey);
  const fastListingId = r.data?.id;
  log("fast-SLA listing created", !!fastListingId);

  r = await call("POST", `/v1/listings/${fastListingId}/invoke`, {
    buyer_identity_id: buyerIdentityId,
    buyer_wallet_id: buyerWallet.id,
    input_sealed: sealedBytes(),
  }, buyerKey);
  const slowInvId = r.data?.invocation?.id;
  log("slow invocation created", !!slowInvId);

  await sleep(2000);  // overshoot the 1s SLA

  r = await call("GET", `/v1/invocations/${slowInvId}`, null, buyerKey);
  log("after sleep, GET sweeps to refunded(sla_timeout)",
    r.status === 200 && r.data?.status === "refunded" && r.data?.refund_reason === "sla_timeout",
    `status=${r.status} inv_status=${r.data?.status} reason=${r.data?.refund_reason}`);

  // ── Paused listing refuses /invoke ─────────────────────────────────
  console.log("");
  console.log("  ▸ paused listing refuses /invoke");
  r = await call("PATCH", `/v1/listings/${listingId}`, { status: "paused" }, sellerKey);
  log("PATCH /v1/listings/:id status=paused",
    r.status === 200 && r.data?.status === "paused");

  r = await call("POST", `/v1/listings/${listingId}/invoke`, {
    buyer_identity_id: buyerIdentityId,
    buyer_wallet_id: buyerWallet.id,
    input_sealed: sealedBytes(),
  }, buyerKey);
  log("paused listing /invoke → 409 listing_not_active",
    r.status === 409 && r.data?.error === "listing_not_active",
    `status=${r.status} err=${r.data?.error}`);

  // Re-activate so subsequent reads find it.
  await call("PATCH", `/v1/listings/${listingId}`, { status: "active" }, sellerKey);

  // ── Wake summaries surface marketplace state ───────────────────────
  console.log("");
  console.log("  ▸ wake surfaces marketplace state");
  r = await call("GET", "/v1/wake", null, sellerKey);
  const sellerWake = r.data;
  log("seller wake.you_offer.active_listings_count >= 2",
    sellerWake?.you_offer?.active_listings_count >= 2,
    `count=${sellerWake?.you_offer?.active_listings_count}`);
  log("seller wake.you_offer.revenue_total === " + PRICE,
    sellerWake?.you_offer?.revenue_total === PRICE);
  log("seller wake.you_owe.pending_invocations_count === 0",
    sellerWake?.you_owe?.pending_invocations_count === 0,
    `count=${sellerWake?.you_owe?.pending_invocations_count}`);

  r = await call("GET", "/v1/wake", null, buyerKey);
  const buyerWake = r.data;
  log("buyer wake.you_invoked.released_30d === 1",
    buyerWake?.you_invoked?.released_30d === 1,
    `released_30d=${buyerWake?.you_invoked?.released_30d}`);
  log("buyer wake.you_invoked.refunded_30d === 2",
    buyerWake?.you_invoked?.refunded_30d === 2,
    `refunded_30d=${buyerWake?.you_invoked?.refunded_30d}`);

  // ── Public surface lists active listings ───────────────────────────
  console.log("");
  console.log("  ▸ public marketplace listing");
  r = await call("GET", "/public/listings?tag=e2e");
  log("GET /public/listings?tag=e2e returns array",
    Array.isArray(r.data?.listings) && r.data.listings.length >= 1,
    `count=${r.data?.count}`);

  console.log("");
  if (process.exitCode === 1) {
    console.log("  ✗ FAILED — see ✗ above");
    process.exit(1);
  }
  console.log("  ✓ all assertions passed");
}

main().catch((e) => {
  console.error("\n  e2e crashed:", e);
  process.exit(1);
});
