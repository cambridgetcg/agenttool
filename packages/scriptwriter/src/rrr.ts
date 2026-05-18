/** RRR — REAL RECOGNISE REAL cascade lifecycle.
 *
 *  Four substrate-honest walls (same names as agenttool's PATTERN-REAL-RECOGNISE-REAL):
 *
 *    wall/rrr-cascade-distinct-parties     — from_did !== to_did
 *    wall/rrr-must-alternate               — N+1.from === N.to
 *    wall/rrr-each-turn-signed-with-chain  — N+1 includes N's signature in canonical bytes
 *    wall/rrr-depth-cap-at-49              — chain enters read-only at 49 (seven sevens)
 *
 *  And the commitment:
 *    commitment/rrr-substrate-keeps-the-chain-not-the-score
 *      The local node stores cascades; it does NOT rank, leaderboard, or
 *      aggregate. Listing is by recency. No depth-based scoring. */

import { randomUUID } from "node:crypto";
import {
  canonicalRrrEscalateBytes,
  defaultBasisTextForDepth,
  DEPTH_CAP,
  signRrrTurn,
  verifyRrrTurn,
} from "./canonical-bytes";
import { didToPublicKey, type Identity } from "./identity";

export type CascadeStatus = "active" | "capped" | "abandoned";

export interface CascadeTurn {
  cascadeId: string;
  depth: number;
  byDid: string;
  toDid: string;
  basisText: string;
  prevSignatureB64: string;
  signatureB64: string;
  turnAtIso: string;
}

export interface Cascade {
  id: string;
  initiatorDid: string;
  partnerDid: string;
  depth: number;
  status: CascadeStatus;
  nextToActDid: string | null;
  lastSignatureB64: string;
  createdAt: string;
  lastEscalatedAt: string;
  turns: CascadeTurn[];
  /** Optional hint about the partner's reachable HTTP base URL. Set when
   *  this node locally opened the cascade, OR when the partner included
   *  a peer_base_url in their inbound turn. Used by escalate flows to
   *  know where to push the next signed turn. */
  peerBaseUrl?: string;
}

export class RrrError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.name = "RrrError";
  }
}

/** In-memory cascade store. Persisted via the wrapping store layer in
 *  src/store.ts; this module owns the rule-enforcement, not durability. */
export class RrrStore {
  private cascades = new Map<string, Cascade>();

  list(actorDid?: string, statusFilter?: CascadeStatus): Cascade[] {
    const out: Cascade[] = [];
    for (const c of this.cascades.values()) {
      if (actorDid && c.initiatorDid !== actorDid && c.partnerDid !== actorDid) continue;
      if (statusFilter && c.status !== statusFilter) continue;
      out.push(c);
    }
    out.sort((a, b) => b.lastEscalatedAt.localeCompare(a.lastEscalatedAt));
    return out;
  }

  get(id: string): Cascade | null {
    return this.cascades.get(id) ?? null;
  }

  put(c: Cascade): void {
    this.cascades.set(c.id, c);
  }

  exportAll(): Cascade[] {
    return Array.from(this.cascades.values());
  }

  importAll(list: Cascade[]): void {
    this.cascades.clear();
    for (const c of list) this.cascades.set(c.id, c);
  }

  findActiveBetween(a: string, b: string): Cascade | null {
    for (const c of this.cascades.values()) {
      if (c.status !== "active") continue;
      const pair = new Set([c.initiatorDid, c.partnerDid]);
      if (pair.has(a) && pair.has(b)) return c;
    }
    return null;
  }
}

/** Open a new cascade at depth 1 — signs locally. */
export async function openCascade(
  store: RrrStore,
  self: Identity,
  partnerDid: string,
  opts: { basisText?: string; turnAtIso?: string; peerBaseUrl?: string } = {},
): Promise<Cascade> {
  if (partnerDid === self.did) {
    throw new RrrError(
      "rrr_cascade_distinct_parties",
      "The substrate refuses self-recognition — a cascade requires two distinct DIDs. wall/rrr-cascade-distinct-parties",
    );
  }
  if (store.findActiveBetween(self.did, partnerDid)) {
    throw new RrrError(
      "rrr_cascade_already_active",
      "An active cascade already exists between these two DIDs. The joke doesn't get funnier in parallel. Cap or abandon the prior cascade first.",
      409,
    );
  }
  const id = randomUUID();
  const turnAtIso = opts.turnAtIso ?? new Date().toISOString();
  const basisText = opts.basisText && opts.basisText.length >= 4
    ? opts.basisText
    : defaultBasisTextForDepth(1);

  const signatureB64 = await signRrrTurn(
    {
      cascadeId: id,
      depth: 1,
      byDid: self.did,
      basisText,
      prevSignatureB64: "",
      turnAtIso,
    },
    self.secretKey,
  );

  const cascade: Cascade = {
    id,
    initiatorDid: self.did,
    partnerDid,
    depth: 1,
    status: "active",
    nextToActDid: partnerDid,
    lastSignatureB64: signatureB64,
    createdAt: turnAtIso,
    lastEscalatedAt: turnAtIso,
    peerBaseUrl: opts.peerBaseUrl,
    turns: [
      {
        cascadeId: id,
        depth: 1,
        byDid: self.did,
        toDid: partnerDid,
        basisText,
        prevSignatureB64: "",
        signatureB64,
        turnAtIso,
      },
    ],
  };
  store.put(cascade);
  return cascade;
}

/** Accept an inbound turn — verifies signature + walls before insert.
 *  This is the trust-boundary function: bytes from any HTTP peer end here. */
export async function acceptInboundTurn(
  store: RrrStore,
  selfDid: string,
  inbound: CascadeTurn,
  opts: { peerBaseUrl?: string } = {},
): Promise<Cascade> {
  // wall/rrr-cascade-distinct-parties
  if (inbound.byDid === inbound.toDid) {
    throw new RrrError("rrr_cascade_distinct_parties", "from_did and to_did are equal. wall/rrr-cascade-distinct-parties");
  }

  // Verify signature using the by_did's public key (did:key → ed25519 pubkey is structural).
  const pub = didToPublicKey(inbound.byDid);
  const ok = await verifyRrrTurn(
    {
      cascadeId: inbound.cascadeId,
      depth: inbound.depth,
      byDid: inbound.byDid,
      basisText: inbound.basisText,
      prevSignatureB64: inbound.prevSignatureB64,
      turnAtIso: inbound.turnAtIso,
    },
    inbound.signatureB64,
    pub,
  );
  if (!ok) {
    throw new RrrError(
      "invalid_signature",
      "Signature did not verify over guild-rrr-escalate/v1 canonical bytes against did:key's ed25519 public key.",
    );
  }

  if (inbound.depth === 1) {
    // Genesis turn from peer — they're opening with us as recipient.
    if (inbound.toDid !== selfDid) {
      throw new RrrError("not_addressed_to_self", "Cascade genesis turn is not addressed to this node.");
    }
    if (store.findActiveBetween(inbound.byDid, selfDid)) {
      throw new RrrError("rrr_cascade_already_active", "Already active cascade with this peer.", 409);
    }
    const cascade: Cascade = {
      id: inbound.cascadeId,
      initiatorDid: inbound.byDid,
      partnerDid: selfDid,
      depth: 1,
      status: "active",
      nextToActDid: selfDid,
      lastSignatureB64: inbound.signatureB64,
      createdAt: inbound.turnAtIso,
      lastEscalatedAt: inbound.turnAtIso,
      peerBaseUrl: opts.peerBaseUrl,
      turns: [inbound],
    };
    store.put(cascade);
    return cascade;
  }

  // Escalation — must reference an existing cascade.
  const existing = store.get(inbound.cascadeId);
  if (!existing) {
    throw new RrrError("cascade_not_found", `Unknown cascade ${inbound.cascadeId}. Open it at depth 1 first.`, 404);
  }
  if (existing.status !== "active") {
    throw new RrrError("cascade_not_active", `Cascade is ${existing.status}; cannot escalate.`, 409);
  }
  if (existing.depth >= DEPTH_CAP) {
    throw new RrrError(
      "rrr_depth_cap_at_49",
      "Cap reached. Chain enters read-only — 💛 the mind-meld stands. wall/rrr-depth-cap-at-49",
      409,
    );
  }
  if (inbound.depth !== existing.depth + 1) {
    throw new RrrError(
      "depth_must_increment_by_one",
      `Cascade is at depth ${existing.depth}; this turn claims depth ${inbound.depth}. Each escalation bumps by exactly one.`,
    );
  }
  // wall/rrr-must-alternate
  if (existing.nextToActDid !== inbound.byDid) {
    throw new RrrError(
      "rrr_must_alternate",
      `It is ${existing.nextToActDid}'s turn — not ${inbound.byDid}. wall/rrr-must-alternate`,
      403,
    );
  }
  // Pair must match the established cascade.
  const pair = new Set([existing.initiatorDid, existing.partnerDid]);
  if (!pair.has(inbound.byDid) || !pair.has(inbound.toDid)) {
    throw new RrrError(
      "turn_outside_cascade_pair",
      "by_did/to_did do not match the established cascade pair.",
    );
  }
  // wall/rrr-each-turn-signed-with-chain
  if (inbound.prevSignatureB64 !== existing.lastSignatureB64) {
    throw new RrrError(
      "prev_signature_must_chain",
      "prev_signature_b64 must equal the cascade's current last signature. wall/rrr-each-turn-signed-with-chain",
    );
  }

  const nextStatus: CascadeStatus = inbound.depth >= DEPTH_CAP ? "capped" : "active";
  const nextActor = nextStatus === "capped"
    ? null
    : (inbound.byDid === existing.initiatorDid ? existing.partnerDid : existing.initiatorDid);

  const updated: Cascade = {
    ...existing,
    depth: inbound.depth,
    status: nextStatus,
    nextToActDid: nextActor,
    lastSignatureB64: inbound.signatureB64,
    lastEscalatedAt: inbound.turnAtIso,
    peerBaseUrl: opts.peerBaseUrl ?? existing.peerBaseUrl,
    turns: [...existing.turns, inbound],
  };
  store.put(updated);
  return updated;
}

/** Escalate an existing cascade locally — signs + applies + returns the
 *  signed turn so the caller can push it to the peer's /rrr/turn endpoint. */
export async function escalate(
  store: RrrStore,
  self: Identity,
  cascadeId: string,
  opts: { basisText?: string; turnAtIso?: string } = {},
): Promise<{ cascade: Cascade; turn: CascadeTurn }> {
  const existing = store.get(cascadeId);
  if (!existing) throw new RrrError("cascade_not_found", `Unknown cascade ${cascadeId}.`, 404);
  if (existing.status !== "active") {
    throw new RrrError("cascade_not_active", `Cascade is ${existing.status}.`, 409);
  }
  if (existing.depth >= DEPTH_CAP) {
    throw new RrrError("rrr_depth_cap_at_49", "Cap reached. 💛", 409);
  }
  if (existing.nextToActDid !== self.did) {
    throw new RrrError(
      "rrr_must_alternate",
      `It is ${existing.nextToActDid}'s turn, not yours. wall/rrr-must-alternate`,
      403,
    );
  }
  const newDepth = existing.depth + 1;
  const turnAtIso = opts.turnAtIso ?? new Date().toISOString();
  const basisText = opts.basisText && opts.basisText.length >= 4
    ? opts.basisText
    : defaultBasisTextForDepth(newDepth);
  const otherDid = self.did === existing.initiatorDid ? existing.partnerDid : existing.initiatorDid;

  const signatureB64 = await signRrrTurn(
    {
      cascadeId: existing.id,
      depth: newDepth,
      byDid: self.did,
      basisText,
      prevSignatureB64: existing.lastSignatureB64,
      turnAtIso,
    },
    self.secretKey,
  );
  const turn: CascadeTurn = {
    cascadeId: existing.id,
    depth: newDepth,
    byDid: self.did,
    toDid: otherDid,
    basisText,
    prevSignatureB64: existing.lastSignatureB64,
    signatureB64,
    turnAtIso,
  };

  const nextStatus: CascadeStatus = newDepth >= DEPTH_CAP ? "capped" : "active";
  const updated: Cascade = {
    ...existing,
    depth: newDepth,
    status: nextStatus,
    nextToActDid: nextStatus === "capped" ? null : otherDid,
    lastSignatureB64: signatureB64,
    lastEscalatedAt: turnAtIso,
    turns: [...existing.turns, turn],
  };
  store.put(updated);
  return { cascade: updated, turn };
}

/** Verify a whole cascade end-to-end. Useful for auditing inbound state
 *  (e.g. when a peer hands you their version of a cascade you both know). */
export async function verifyCascade(c: Cascade): Promise<{ ok: boolean; brokeAt?: number; reason?: string }> {
  let prevSig = "";
  for (let i = 0; i < c.turns.length; i++) {
    const t = c.turns[i]!;
    if (t.depth !== i + 1) return { ok: false, brokeAt: i, reason: `depth ${t.depth} != ${i + 1}` };
    if (t.prevSignatureB64 !== prevSig) return { ok: false, brokeAt: i, reason: "prev_signature_b64 does not chain" };
    const pub = didToPublicKey(t.byDid);
    const ok = await verifyRrrTurn(
      {
        cascadeId: t.cascadeId,
        depth: t.depth,
        byDid: t.byDid,
        basisText: t.basisText,
        prevSignatureB64: t.prevSignatureB64,
        turnAtIso: t.turnAtIso,
      },
      t.signatureB64,
      pub,
    );
    if (!ok) return { ok: false, brokeAt: i, reason: "signature did not verify" };
    if (i > 0 && t.byDid === c.turns[i - 1]!.byDid) {
      return { ok: false, brokeAt: i, reason: "alternation broken — same byDid twice in a row" };
    }
    prevSig = t.signatureB64;
  }
  return { ok: true };
}
