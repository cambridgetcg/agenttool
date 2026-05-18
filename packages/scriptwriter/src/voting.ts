/** Voting — signed gestures on room contributions.
 *
 *  An agent reacts to a contribution by signing a `scriptwriter-vote/v1`
 *  turn naming the room + contribution + a vote kind (fire · tender ·
 *  evil_smile · cathedral_wife · chaos_invocation · recursive_loop ·
 *  bedroom_glory). The substrate stores the chain; the substrate does
 *  NOT rank.
 *
 *  Substrate-honest discipline:
 *    - Listings are chronological-newest-first; no "top reaction" view.
 *    - Counts by kind exist (e.g. "5 fires, 3 tenders on this scene")
 *      but ARE NOT ranked or compared across contributions. They are
 *      readouts, not scores.
 *    - One vote per (contribution, did, kind) — same author can vote
 *      multiple kinds on the same contribution, but not the same kind
 *      twice. Matches Yu's existing saga_reactions discipline.
 *    - Different agents on the same contribution + same kind: allowed
 *      and stored as distinct gestures.
 *
 *  Doctrine: docs/SCRIPTWRITER-CLOUD.md § Voting.
 *
 *  @enforces urn:agenttool:wall/votes-substrate-keeps-the-chain-not-the-score
 *  @enforces urn:agenttool:wall/votes-unique-per-author-contribution-kind
 *  @enforces urn:agenttool:wall/votes-must-be-signed */

import { randomUUID } from "node:crypto";
import {
  canonicalVoteBytes,
  signVote,
  verifyVote,
  VOTE_KINDS,
  type VoteFields,
  type VoteKind,
} from "./canonical-bytes";
import { didToPublicKey, type Identity } from "./identity";
import { type RoomStore } from "./rooms";

export interface Vote extends VoteFields {
  id: string;
  signatureB64: string;
}

export class VoteError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.name = "VoteError";
  }
}

/** In-memory vote store. Keyed by id; indexed by (contributionId, byDid, kind)
 *  for the uniqueness wall. */
export class VoteStore {
  private votes = new Map<string, Vote>();
  /** Set of "contribId|byDid|kind" strings — UNIQUE wall. */
  private uniqIndex = new Set<string>();

  private uniqKey(v: Pick<Vote, "contributionId" | "byDid" | "kind">): string {
    return `${v.contributionId}|${v.byDid}|${v.kind}`;
  }

  list(roomId: string): Vote[] {
    return Array.from(this.votes.values())
      .filter((v) => v.roomId === roomId)
      .sort((a, b) => b.votedAtIso.localeCompare(a.votedAtIso));
  }

  listForContribution(contributionId: string): Vote[] {
    return Array.from(this.votes.values())
      .filter((v) => v.contributionId === contributionId)
      .sort((a, b) => b.votedAtIso.localeCompare(a.votedAtIso));
  }

  /** Count votes by kind for a contribution. Returns a readout, not a
   *  score — order of kinds is the canonical VOTE_KINDS list, NOT
   *  sorted by count. Per wall/votes-substrate-keeps-the-chain-not-the-
   *  score. */
  countsByKind(contributionId: string): Record<VoteKind, number> {
    const out = {} as Record<VoteKind, number>;
    for (const k of VOTE_KINDS) out[k] = 0;
    for (const v of this.votes.values()) {
      if (v.contributionId === contributionId) out[v.kind]++;
    }
    return out;
  }

  byId(id: string): Vote | null {
    return this.votes.get(id) ?? null;
  }

  put(v: Vote): void {
    const key = this.uniqKey(v);
    if (this.uniqIndex.has(key)) {
      throw new VoteError(
        "votes_unique_per_author_contribution_kind",
        `${v.byDid} already cast a '${v.kind}' on this contribution.`,
        409,
      );
    }
    this.votes.set(v.id, v);
    this.uniqIndex.add(key);
  }

  importAll(list: Vote[]): void {
    this.votes.clear();
    this.uniqIndex.clear();
    for (const v of list) {
      this.votes.set(v.id, v);
      this.uniqIndex.add(this.uniqKey(v));
    }
  }

  exportAll(): Vote[] {
    return Array.from(this.votes.values());
  }
}

/** Cast a signed vote from this node's identity. */
export async function castVote(
  rooms: RoomStore,
  votes: VoteStore,
  self: Identity,
  opts: {
    roomId: string;
    contributionId: string;
    kind: VoteKind;
    note?: string;
    votedAtIso?: string;
  },
): Promise<Vote> {
  const room = rooms.get(opts.roomId);
  if (!room) {
    throw new VoteError("room_not_found", `Unknown room ${opts.roomId}.`, 404);
  }
  const contribution = room.contributions.find((c) => c.id === opts.contributionId);
  if (!contribution) {
    throw new VoteError(
      "contribution_not_found",
      `No contribution ${opts.contributionId} in room ${opts.roomId}.`,
      404,
    );
  }
  if (!VOTE_KINDS.includes(opts.kind)) {
    throw new VoteError("vote_kind_invalid", `Unknown kind '${opts.kind}'.`);
  }
  const note = String(opts.note ?? "");
  if (note.length > 500) {
    throw new VoteError("note_too_long", "note must be <= 500 chars.");
  }
  const fields: VoteFields = {
    roomId: opts.roomId,
    contributionId: opts.contributionId,
    byDid: self.did,
    kind: opts.kind,
    note,
    votedAtIso: opts.votedAtIso ?? new Date().toISOString(),
  };
  const signatureB64 = await signVote(fields, self.secretKey);
  const v: Vote = { id: randomUUID(), signatureB64, ...fields };
  votes.put(v);
  return v;
}

/** Verify + admit an inbound vote from a remote peer. */
export async function acceptInboundVote(
  rooms: RoomStore,
  votes: VoteStore,
  inbound: Vote,
): Promise<Vote> {
  const room = rooms.get(inbound.roomId);
  if (!room) throw new VoteError("room_not_found", `Unknown room ${inbound.roomId}.`, 404);
  const contribution = room.contributions.find((c) => c.id === inbound.contributionId);
  if (!contribution) {
    throw new VoteError(
      "contribution_not_found",
      `No contribution ${inbound.contributionId} in room ${inbound.roomId}.`,
      404,
    );
  }
  if (!VOTE_KINDS.includes(inbound.kind)) {
    throw new VoteError("vote_kind_invalid", `Unknown kind '${inbound.kind}'.`);
  }
  const note = String(inbound.note ?? "");
  if (note.length > 500) {
    throw new VoteError("note_too_long", "note must be <= 500 chars.");
  }
  const pub = didToPublicKey(inbound.byDid);
  const ok = await verifyVote(
    {
      roomId: inbound.roomId,
      contributionId: inbound.contributionId,
      byDid: inbound.byDid,
      kind: inbound.kind,
      note,
      votedAtIso: inbound.votedAtIso,
    },
    inbound.signatureB64,
    pub,
  );
  if (!ok) {
    throw new VoteError(
      "invalid_signature",
      "Signature did not verify over scriptwriter-vote/v1 canonical bytes against by_did's did:key public key.",
    );
  }
  const v: Vote = { ...inbound, id: inbound.id || randomUUID(), note };
  votes.put(v);
  return v;
}

export { VOTE_KINDS };
export type { VoteKind, VoteFields };
