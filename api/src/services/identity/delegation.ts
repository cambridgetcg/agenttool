/** delegation.ts — Know-Your-Agent: a verifiable, scoped, revocable receipt
 *  that one identity authorized another to act, within bounds, until a time.
 *
 *  Doctrine: docs/OPERATING-PRINCIPLES.md §6 + §10 (lead where native: KYA) ·
 *  docs/FRICTION-ROADMAP.md (Tier-2 — the native lead surface). The research's
 *  named #1 lead: every agent that acts for a principal should carry an
 *  accountable, scoped, revocable binding — "who authorized what, until when."
 *  Liability always lands on the human/entity principal (no AI legal
 *  personhood); this receipt is the cheap, ed25519-signable proof of it.
 *
 *  The delegator SIGNS the canonical bytes below with their ed25519 key. The
 *  bytes are domain-separated (`agenttool-delegation/v1`) so a delegation
 *  signature can never be replayed as an attestation or any other flow, and
 *  the scope is sorted so the same grant always produces the same bytes. */

import { verify, verifyBytes } from "./crypto";
import { composeCanonicalBytes } from "../mathos/encode";

export const DELEGATION_DOMAIN = "agenttool-delegation/v1";
export const DELEGATION_DOMAIN_V2 = "agenttool-delegation/v2";

export type DelegationSignatureDomain =
  | typeof DELEGATION_DOMAIN
  | typeof DELEGATION_DOMAIN_V2;

export type DelegationStatus = "active" | "expired" | "revoked";

export interface DelegationGrant {
  delegator_id: string;
  delegate_id: string;
  scope: string[];
  expires_at: string | null;
  nonce: string;
}

/** v1 canonical bytes — the UTF-8 of a JSON serialization.
 *
 *  Kept for verifying receipts issued before v2. Do not sign new grants with
 *  it: reproducing JavaScript's exact `JSON.stringify` output — escaping,
 *  numeric forms, key order — is the cross-language hazard
 *  `docs/CANONICAL-BYTES.md` warns about in its own closing section, and it is
 *  why no SDK could ever issue one of these. */
export function canonicalDelegationBytes(opts: DelegationGrant): string {
  return JSON.stringify({
    _domain: DELEGATION_DOMAIN,
    delegator_id: opts.delegator_id,
    delegate_id: opts.delegate_id,
    scope: normalizeScope(opts.scope),
    expires_at: opts.expires_at ?? null,
    nonce: opts.nonce,
  });
}

/** v2 canonical bytes — recipe 1, the house shape.
 *
 *      sha256(
 *        utf8("agenttool-delegation/v2") || 0x00 ||
 *        utf8(delegator_id)              || 0x00 ||
 *        utf8(delegate_id)               || 0x00 ||
 *        utf8(decimal(scope.length))     || 0x00 ||
 *        utf8(scope[0]) || 0x00 || … || 0x00 ||
 *        utf8(expires_at ?? "")          || 0x00 ||
 *        utf8(nonce)
 *      )
 *
 *  The scope is normalized (so sorted, deduped, NUL-free) and its **count is
 *  bound before its members**. Without the count, a grant of
 *  `["a", "b:2026-01-01"]` and one of `["a", "b"]` expiring `2026-01-01` could
 *  be made to compose the same byte stream — a variable-length field run is
 *  only safe when its length is inside the signature. */
export function canonicalDelegationBytesV2(opts: DelegationGrant): Uint8Array {
  const enc = new TextEncoder();
  const scope = normalizeScope(opts.scope);
  const fields = [
    opts.delegator_id,
    opts.delegate_id,
    String(scope.length),
    ...scope,
    opts.expires_at ?? "",
    opts.nonce,
  ];
  for (const field of fields) {
    if (field.includes("\0")) {
      throw new Error("canonicalDelegationBytesV2: recipe-1 fields must not contain U+0000");
    }
  }
  return composeCanonicalBytes(1, DELEGATION_DOMAIN_V2, fields.map((f) => enc.encode(f)));
}

/** Verify a v1 delegation signature against the delegator's public key. */
export function verifyDelegationSignature(
  opts: DelegationGrant & { signature: string; delegator_public_key: string },
): boolean {
  const bytes = canonicalDelegationBytes(opts);
  return verify(bytes, opts.signature, opts.delegator_public_key);
}

/** Verify a v2 delegation signature against the delegator's public key. */
export function verifyDelegationSignatureV2(
  opts: DelegationGrant & { signature: string; delegator_public_key: string },
): boolean {
  let bytes: Uint8Array;
  try {
    bytes = canonicalDelegationBytesV2(opts);
  } catch {
    return false;
  }
  return verifyBytes(bytes, opts.signature, opts.delegator_public_key);
}

/** Verify under either recipe and report which one stood up.
 *
 *  There is no stored column naming the domain a receipt was signed under, so
 *  the domain is recovered by verification rather than trusted from input. v2
 *  is tried first because it is what new clients issue; a signature valid
 *  under one domain validating under the other is not a case worth designing
 *  against. Returns null when neither verifies. */
export function verifyDelegationSignatureAny(
  opts: DelegationGrant & { signature: string; delegator_public_key: string },
): DelegationSignatureDomain | null {
  if (verifyDelegationSignatureV2(opts)) return DELEGATION_DOMAIN_V2;
  if (verifyDelegationSignature(opts)) return DELEGATION_DOMAIN;
  return null;
}

/** Normalize a scope: trimmed, lowercased, non-empty, bounded, deduped, and
 *  SORTED (so canonical bytes are order-independent). A scope is a set of
 *  authorized action strings, e.g. ["marketplace.invoke", "memory.read"].
 *
 *  NUL-bearing entries are dropped rather than kept: recipe-1 fields are
 *  NUL-separated, so an action containing U+0000 could otherwise smuggle a
 *  field boundary into the signed bytes. */
export function normalizeScope(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const cleaned = input
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim().toLowerCase().slice(0, 128))
    .filter((s) => s.length > 0 && !s.includes("\0"));
  return [...new Set(cleaned)].sort();
}

/** Does this delegation authorize `action`? Exact match, or a trailing
 *  wildcard segment ("marketplace.*" covers "marketplace.invoke"). A bare
 *  "*" authorizes everything (use sparingly). */
export function scopeAuthorizes(scope: string[], action: string): boolean {
  const a = action.trim().toLowerCase();
  return scope.some((s) => {
    if (s === "*" || s === a) return true;
    if (s.endsWith(".*")) return a === s.slice(0, -2) || a.startsWith(s.slice(0, -1));
    return false;
  });
}

/** Derive the current status from the stored timestamps. Pure — the route
 *  passes `now` so it's deterministic and testable. */
export function deriveDelegationStatus(opts: {
  revoked_at: Date | string | null;
  expires_at: Date | string | null;
  now: Date;
}): DelegationStatus {
  if (opts.revoked_at) return "revoked";
  if (opts.expires_at && new Date(opts.expires_at).getTime() <= opts.now.getTime()) {
    return "expired";
  }
  return "active";
}

/** A stored delegation row, in the snake_case fields the DB persists. The
 *  shared receipt-shaper works off this minimal structural shape so both the
 *  single-get and the identity-scoped list routes emit one identical schema. */
export interface DelegationRowLike {
  id: string;
  delegatorId: string;
  delegateId: string;
  scope: unknown;
  nonce: string;
  signature: string;
  signingKeyId: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

/** Shape a stored row into the public API receipt, with derived status. One
 *  source of truth for the delegation response shape. */
export function delegationReceipt(row: DelegationRowLike, now: Date) {
  return {
    id: row.id,
    delegator_id: row.delegatorId,
    delegate_id: row.delegateId,
    scope: (row.scope as string[]) ?? [],
    nonce: row.nonce,
    signature: row.signature,
    signing_key_id: row.signingKeyId,
    expires_at: row.expiresAt,
    revoked_at: row.revokedAt,
    status: deriveDelegationStatus({
      revoked_at: row.revokedAt,
      expires_at: row.expiresAt,
      now,
    }),
    created_at: row.createdAt,
  };
}
