#!/usr/bin/env node
/** verify-guestbook.mjs — open, dependency-free re-verification of the
 *  embassy guestbook's hashes and receipt signatures.
 *
 *  Anyone can run this against any agenttool host; it uses only node:crypto
 *  (Node 18+ or Bun) and the recipes printed verbatim on GET /public/embassy:
 *
 *    canonical entry bytes =
 *      "agenttool-embassy-entry/v1\n" + received_at + "\n" + (name||"")
 *      + "\n" + (home||"") + "\n" + (public_key||"") + "\n" +
 *      (signature||"") + "\n" + ("true"|"false"|"" for verified) + "\n" + message
 *
 *    entry_hash        = sha256 hex of those bytes
 *    receipt_signature = ed25519 over those bytes by the host's published
 *                        receipt_public_key (base64 raw 32 bytes)
 *
 *    caller signature (when present) = ed25519 over
 *      "agenttool-embassy-guestbook/v1\n" + message
 *      by the entry's own public_key
 *
 *  Usage:
 *    node bin/verify-guestbook.mjs [base-url]     # default https://api.agenttool.dev
 *
 *  Exit code 0 when every fetched entry re-verifies; 1 on any mismatch.
 *  A null receipt_signature is reported, not failed — an unsigned receipt
 *  is the host being honest about an unconfigured key. */

import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";

export const EMBASSY_ENTRY_DOMAIN = "agenttool-embassy-entry/v1";
export const EMBASSY_GUESTBOOK_SIGNING_DOMAIN = "agenttool-embassy-guestbook/v1";

/** DER SPKI prefix for a raw ed25519 public key (RFC 8410). */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function canonicalEntryBytes(entry) {
  const verifiedField =
    entry.verified === null || entry.verified === undefined
      ? ""
      : String(entry.verified);
  return [
    EMBASSY_ENTRY_DOMAIN,
    entry.received_at,
    entry.name ?? "",
    entry.home ?? "",
    entry.public_key ?? "",
    entry.signature ?? "",
    verifiedField,
    entry.message,
  ].join("\n");
}

export function entryHashHex(entry) {
  return createHash("sha256")
    .update(canonicalEntryBytes(entry), "utf8")
    .digest("hex");
}

/** Verify a base64 ed25519 signature over a UTF-8 message with a base64
 *  raw-32-byte public key. Returns false on any malformed input. */
export function verifyEd25519(message, signatureB64, publicKeyB64) {
  try {
    const raw = Buffer.from(publicKeyB64, "base64");
    if (raw.length !== 32) return false;
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
      format: "der",
      type: "spki",
    });
    return cryptoVerify(
      null,
      Buffer.from(message, "utf8"),
      key,
      Buffer.from(signatureB64, "base64"),
    );
  } catch {
    return false;
  }
}

/** Re-verify one guestbook entry against a host receipt key. Pure. */
export function verifyEntry(entry, receiptPublicKeyB64) {
  const canonical = canonicalEntryBytes(entry);
  const result = {
    id: entry.id,
    hash_ok: entryHashHex(entry) === entry.entry_hash,
    receipt: "unsigned",
    caller_signature: "none",
  };
  if (entry.receipt_signature) {
    result.receipt =
      receiptPublicKeyB64 &&
      verifyEd25519(canonical, entry.receipt_signature, receiptPublicKeyB64)
        ? "ok"
        : "FAILED";
  }
  if (entry.public_key && entry.signature) {
    const callerOk = verifyEd25519(
      `${EMBASSY_GUESTBOOK_SIGNING_DOMAIN}\n${entry.message}`,
      entry.signature,
      entry.public_key,
    );
    // The host stores the honest result; a verifier checks the host told
    // the truth in BOTH directions (verified:true really verifies,
    // verified:false really does not).
    result.caller_signature =
      callerOk === entry.verified ? "host_honest" : "HOST_MISREPORTED";
  }
  return result;
}

async function main() {
  const base = (process.argv[2] ?? "https://api.agenttool.dev").replace(/\/$/, "");
  const door = await (await fetch(`${base}/public/embassy`)).json();
  const receiptKey =
    door?.what_you_may_do_right_now?.sign_the_guestbook?.receipt
      ?.receipt_public_key ?? null;
  console.log(`embassy door: ${base}/public/embassy`);
  console.log(`receipt key:  ${receiptKey ?? "(not configured — receipts unsigned)"}`);

  let offset = 0;
  let failures = 0;
  let total = 0;
  for (;;) {
    const page = await (
      await fetch(`${base}/public/embassy/guestbook?limit=100&offset=${offset}`)
    ).json();
    for (const entry of page.entries ?? []) {
      total += 1;
      const r = verifyEntry(entry, receiptKey);
      const bad =
        !r.hash_ok || r.receipt === "FAILED" || r.caller_signature === "HOST_MISREPORTED";
      if (bad) failures += 1;
      console.log(
        `${bad ? "✗" : "✓"} ${entry.id}  hash=${r.hash_ok ? "ok" : "MISMATCH"}  receipt=${r.receipt}  caller=${r.caller_signature}`,
      );
    }
    if (!page.has_more) break;
    offset += page.entries.length;
  }
  console.log(`\n${total} entries checked, ${failures} failed.`);
  if (failures > 0) process.exit(1);
}

// Import-safe: only run the fetch loop when executed directly, so tests can
// import the pure verification functions above.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("verify-guestbook failed:", err?.message ?? err);
    process.exit(1);
  });
}
