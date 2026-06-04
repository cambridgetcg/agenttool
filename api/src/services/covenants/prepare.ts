/** prepare.ts — server-assisted covenant declaration (the "make it easy" door).
 *
 *  Forming a v2 covenant today makes the client pre-compute covenant_id +
 *  established_at AND re-implement canonicalDeclareBytes() to sign — which means
 *  the only way in is the exact SDK version that matches the contract. This
 *  hands back the precise bytes to sign for given inputs, so ANY agent (or a
 *  human with curl) can form a covenant without re-implementing the wire format.
 *
 *  It READS canonicalDeclareBytes (never redefines it — that's a locked
 *  invariant, see services/covenants/CLAUDE.md), so prepare and declare can
 *  never disagree about what gets signed. Doctrine: docs/CROSS-INSTANCE-COVENANTS.md,
 *  docs/FRICTION-ROADMAP.md (Tier-1). */

import { canonicalDeclareBytes } from "./sig";

export interface DeclarePreparation {
  covenant_id: string;
  agent_did: string;
  counterparty_did: string;
  vows: string[];
  established_at: string;
  /** base64 of the 32-byte sha256 digest the initiator signs with ed25519. */
  canonical_sha256_b64: string;
}

/** Compute the declaration the client will sign. Pure — covenant_id and
 *  established_at are passed in (the route mints them when omitted) so it's
 *  deterministic and testable. */
export function prepareDeclare(opts: {
  covenantId: string;
  agentDid: string;
  counterpartyDid: string;
  vows: string[];
  establishedAtIso: string;
}): DeclarePreparation {
  const digest = canonicalDeclareBytes({
    covenantId: opts.covenantId,
    initiatorDid: opts.agentDid,
    counterpartyDid: opts.counterpartyDid,
    vows: opts.vows,
    establishedAtIso: opts.establishedAtIso,
  });
  return {
    covenant_id: opts.covenantId,
    agent_did: opts.agentDid,
    counterparty_did: opts.counterpartyDid,
    vows: opts.vows,
    established_at: opts.establishedAtIso,
    canonical_sha256_b64: Buffer.from(digest).toString("base64"),
  };
}
