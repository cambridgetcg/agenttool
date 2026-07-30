/** Canonical bytes for the embassy guestbook — signing + receipt hashing.
 *
 *  Two recipes, both published verbatim on GET /public/embassy and both
 *  re-derivable by bin/verify-guestbook.mjs without reading this source:
 *
 *  1. GUESTBOOK SIGNING (optional, caller-side):
 *       "agenttool-embassy-guestbook/v1\n" + (name||"") + "\n" +
 *       (home||"") + "\n" + message
 *     Signed with the visitor's ed25519 key. The signature covers the
 *     self-declared name and home as well as the message, so a verified
 *     entry cannot be replayed under a different attribution (the
 *     3-lens review's replay finding, fixed pre-release). name/home are
 *     structurally newline-free (validated at the route); message comes
 *     last and may contain newlines. Verification is honored, never
 *     required — a failed verify stores verified=false and the entry
 *     still lands (doctrine forbids review queues).
 *
 *  2. CANONICAL ENTRY (server-side, hashed + receipt-signed):
 *       "agenttool-embassy-entry/v1\n" + received_at + "\n" + (name||"")
 *       + "\n" + (home||"") + "\n" + (public_key||"") + "\n" +
 *       (signature||"") + "\n" + verified_field + "\n" + message
 *     where verified_field is "true" | "false" | "" (empty when no key
 *     was offered). Every field before message is structurally
 *     newline-free (validated at the route), so the parse is unambiguous;
 *     message comes last and may contain newlines.
 *
 *  entry_hash = sha256 hex of the canonical entry bytes.
 *  receipt_signature = ed25519 over the same bytes (services/embassy/receipt.ts).
 *
 *  Doctrine: docs/CANONICAL-BYTES.md · docs/PUBLIC-VISIBILITY.md. */

import { createHash } from "node:crypto";

export const EMBASSY_GUESTBOOK_SIGNING_DOMAIN = "agenttool-embassy-guestbook/v1";
export const EMBASSY_ENTRY_DOMAIN = "agenttool-embassy-entry/v1";

/** The optional caller-signed bytes:
 *  domain + "\n" + (name||"") + "\n" + (home||"") + "\n" + message.
 *  Covers attribution so a verified entry cannot be replayed under a
 *  different self-chosen name/home. */
export function canonicalGuestbookSignedBytes(input: {
  name: string | null;
  home: string | null;
  message: string;
}): string {
  return `${EMBASSY_GUESTBOOK_SIGNING_DOMAIN}\n${input.name ?? ""}\n${input.home ?? ""}\n${input.message}`;
}

export interface CanonicalEntryInput {
  receivedAtIso: string;
  name: string | null;
  home: string | null;
  publicKey: string | null;
  signature: string | null;
  verified: boolean | null;
  message: string;
}

/** The server-hashed canonical entry bytes (see module header for recipe). */
export function canonicalEntryBytes(entry: CanonicalEntryInput): string {
  const verifiedField = entry.verified === null ? "" : String(entry.verified);
  return [
    EMBASSY_ENTRY_DOMAIN,
    entry.receivedAtIso,
    entry.name ?? "",
    entry.home ?? "",
    entry.publicKey ?? "",
    entry.signature ?? "",
    verifiedField,
    entry.message,
  ].join("\n");
}

/** sha256 hex of the canonical entry bytes. */
export function entryHashHex(entry: CanonicalEntryInput): string {
  return createHash("sha256")
    .update(canonicalEntryBytes(entry), "utf8")
    .digest("hex");
}
