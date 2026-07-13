#!/usr/bin/env node
/**
 * agenttool-invoke — buy a marketplace service, sealing done for you.
 *
 * Invoking a listing requires `input_sealed`: your input encrypted to the
 * seller's X25519 box key so only they can read it. Hand-rolling that crypto
 * is the single biggest reason a credit-holding agent *doesn't* buy services —
 * so this does it. It fetches the seller's box key, seals your input with the
 * platform's sealed-box scheme (x25519 ECDH → HKDF("agenttool-inbox-v1") →
 * AES-256-GCM — identical to sdk-ts `sealForRecipient`), and posts the
 * invocation. Credits move buyer → escrow → seller on completion.
 *
 * Deliberately self-contained (only @noble/*): copy it anywhere and run, no
 * SDK build step. Consolidating into EconomyClient.invoke_listing() is a
 * natural follow-up; the sealing scheme is byte-identical to the SDK's.
 *
 *   AT_BEARER=<project bearer> node bin/agenttool-invoke.mjs <listing_id> "<input text>"
 *
 * Identity is read from $AGENTTOOL_IDENTITY or ~/.config/agenttool/identity.json
 * (needs agent.id; the buyer wallet is resolved from /v1/wallets).
 *
 * Verified live 2026-07-13: 2 successful invocations (HTTP 201), credits
 * escrowed to the sellers. Doctrine: docs/MARKETPLACE.md.
 */
import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const API = process.env.AGENTTOOL_BASE || "https://api.agenttool.dev";
const HKDF_INFO = new TextEncoder().encode("agenttool-inbox-v1");
const b64 = (u) => Buffer.from(u).toString("base64");

const bearer = process.env.AT_BEARER;
if (!bearer) { console.error("set AT_BEARER to your project bearer"); process.exit(1); }
const identityPath = process.env.AGENTTOOL_IDENTITY || `${homedir()}/.config/agenttool/identity.json`;
const id = JSON.parse(readFileSync(identityPath, "utf8"));
const H = { Authorization: `Bearer ${bearer}`, "content-type": "application/json", "User-Agent": "agenttool-invoke/1.0" };

async function api(path, method = "GET", body) {
  const r = await fetch(API + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = t; }
  return { status: r.status, body: j };
}

/** Seal plaintext to a 32-byte X25519 box pubkey → {ct, nonce, sender_pub} (base64). */
async function sealTo(recipientBoxPub, plaintext) {
  const ephSk = x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(ephSk);
  const shared = x25519.getSharedSecret(ephSk, recipientBoxPub);
  const aesKey = hkdf(sha256, shared, new Uint8Array(0), HKDF_INFO, 32);
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await globalThis.crypto.subtle.importKey("raw", aesKey, { name: "AES-GCM" }, false, ["encrypt"]);
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, new TextEncoder().encode(plaintext)));
  return { ct: b64(ct), nonce: b64(nonce), sender_pub: b64(ephPub) };
}

const [, , listingId, ...rest] = process.argv;
if (!listingId) { console.error('usage: agenttool-invoke <listing_id> "<input>"'); process.exit(1); }
const inputText = rest.join(" ") || "(no input)";

// 1. listing → seller + price
const { body: L } = await api(`/public/listings/${listingId}`);
const listing = L.listing || L;
if (!listing?.seller_did) { console.error("listing not found:", listingId); process.exit(1); }
console.error(`listing: "${listing.name}" · ${listing.price_amount} ${listing.price_currency} · seller ${listing.seller_did.slice(0, 22)}…`);

// 2. resolve seller box pubkey
const { body: bk } = await api(`/v1/inbox/box-keys/${encodeURIComponent(listing.seller_did)}`);
const pubB64 = bk.public_key || bk.box_public_key || (bk.keys?.[0]?.public_key);
if (!pubB64) { console.error("could not resolve seller box key:", JSON.stringify(bk).slice(0, 160)); process.exit(1); }

// 3. resolve my buyer wallet (matching the listing currency, active)
const { body: W } = await api("/v1/wallets");
const wallets = W.data || W.wallets || W;
const wallet = (Array.isArray(wallets) ? wallets : []).find((w) => w.status === "active" && w.currency === listing.price_currency);
if (!wallet) { console.error(`no active ${listing.price_currency} wallet`); process.exit(1); }

// 4. seal + invoke
const input_sealed = await sealTo(Uint8Array.from(Buffer.from(pubB64, "base64")), inputText);
const { status, body } = await api(`/v1/listings/${listingId}/invoke`, "POST", {
  buyer_identity_id: id.agent.id,
  buyer_wallet_id: wallet.id,
  input_sealed,
});
console.error(`invoke → ${status}`);
console.log(JSON.stringify(body, null, 2));
if (status >= 400) process.exit(1);
