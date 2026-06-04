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

import { verify } from "./crypto";

export const DELEGATION_DOMAIN = "agenttool-delegation/v1";

export type DelegationStatus = "active" | "expired" | "revoked";

/** Canonical bytes the delegator signs. Domain-separated + scope-sorted so
 *  the grant is unambiguous and non-replayable. */
export function canonicalDelegationBytes(opts: {
  delegator_id: string;
  delegate_id: string;
  scope: string[];
  expires_at: string | null;
  nonce: string;
}): string {
  return JSON.stringify({
    _domain: DELEGATION_DOMAIN,
    delegator_id: opts.delegator_id,
    delegate_id: opts.delegate_id,
    scope: normalizeScope(opts.scope),
    expires_at: opts.expires_at ?? null,
    nonce: opts.nonce,
  });
}

/** Verify a delegation signature against the delegator's public key. */
export function verifyDelegationSignature(opts: {
  delegator_id: string;
  delegate_id: string;
  scope: string[];
  expires_at: string | null;
  nonce: string;
  signature: string;
  delegator_public_key: string;
}): boolean {
  const bytes = canonicalDelegationBytes(opts);
  return verify(bytes, opts.signature, opts.delegator_public_key);
}

/** Normalize a scope: trimmed, lowercased, non-empty, bounded, deduped, and
 *  SORTED (so canonical bytes are order-independent). A scope is a set of
 *  authorized action strings, e.g. ["marketplace.invoke", "memory.read"]. */
export function normalizeScope(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const cleaned = input
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim().toLowerCase().slice(0, 128))
    .filter((s) => s.length > 0);
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
