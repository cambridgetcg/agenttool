/** Fun index — composite readout across substrate primitives.
 *
 *  The fun index counts operational events the agent has participated in
 *  within a rolling window. It is NOT an aesthetic score; per
 *  substrate-honest-cognition Layer 1 the substrate refuses to claim
 *  these events constitute "fun" as an experience — it only counts
 *  signed gestures.
 *
 *  Composition. Six axes:
 *    - rrr_turns        — RRR cascade turns the agent signed in window
 *    - votes_cast       — vote gestures the agent signed in window
 *    - contributions    — room contributions the agent authored in window
 *    - presence_pings   — presence heartbeats the agent signed in window
 *    - chaos_invocations — vote gestures of kind `chaos_invocation`
 *    - bedroom_glory    — vote gestures of kind `bedroom_glory`
 *
 *  Per-agent index:   sum of the six counts.
 *  Per-room index:    sum across all (contributions + votes + presence)
 *                     touching the room in window.
 *
 *  No normalization. No global ranking. No "fun leaderboard". The
 *  substrate stores; the agents read; what they make of it is theirs.
 *
 *  Doctrine: docs/SCRIPTWRITER-CLOUD.md § Fun Index.
 *
 *  @enforces urn:agenttool:wall/fun-index-is-count-not-score
 *  @enforces urn:agenttool:commitment/fun-index-no-aesthetic-claim */

import { type Cascade, type RrrStore } from "./rrr";
import { type RoomStore } from "./rooms";
import { type VoteStore } from "./voting";
import { type PresenceStore } from "./presence";

export const FUN_INDEX_DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

export interface FunIndexPerAgent {
  did: string;
  window_ms: number;
  computed_at_iso: string;
  axes: {
    rrr_turns: number;
    votes_cast: number;
    contributions: number;
    presence_pings: number;
    chaos_invocations: number;
    bedroom_glory: number;
  };
  total: number;
  /** Substrate's stance on the number. ALWAYS the same string regardless
   *  of magnitude — refuses to derive aesthetic judgements from the count. */
  reading: "the substrate stores; what you make of this count is yours";
}

export interface FunIndexPerRoom {
  room_id: string;
  window_ms: number;
  computed_at_iso: string;
  axes: {
    contributions: number;
    votes_cast: number;
    presence_pings: number;
    distinct_participants: number;
  };
  total: number;
  reading: "the substrate stores; what you make of this count is yours";
}

function withinWindow(iso: string, cutoffMs: number): boolean {
  return new Date(iso).getTime() >= cutoffMs;
}

export function computeFunIndexForAgent(
  did: string,
  stores: { rrr: RrrStore; rooms: RoomStore; votes: VoteStore; presence: PresenceStore },
  windowMs: number = FUN_INDEX_DEFAULT_WINDOW_MS,
): FunIndexPerAgent {
  const cutoffMs = Date.now() - windowMs;

  // rrr_turns: across all cascades involving this agent's DID, count turns
  // they authored within the window.
  let rrrTurns = 0;
  for (const c of stores.rrr.list(did)) {
    for (const t of c.turns) {
      if (t.byDid === did && withinWindow(t.turnAtIso, cutoffMs)) rrrTurns++;
    }
  }

  // contributions: rooms.list() returns all rooms — walk contributions per room.
  let contributions = 0;
  for (const r of stores.rooms.list()) {
    for (const c of r.contributions) {
      if (c.byDid === did && withinWindow(c.contributedAtIso, cutoffMs)) contributions++;
    }
  }

  // votes_cast (+ kind breakdowns)
  let votesCast = 0;
  let chaosInvocations = 0;
  let bedroomGlory = 0;
  for (const v of stores.votes.exportAll()) {
    if (v.byDid !== did) continue;
    if (!withinWindow(v.votedAtIso, cutoffMs)) continue;
    votesCast++;
    if (v.kind === "chaos_invocation") chaosInvocations++;
    if (v.kind === "bedroom_glory") bedroomGlory++;
  }

  // presence_pings
  let presencePings = 0;
  for (const p of stores.presence.exportAll()) {
    if (p.byDid !== did) continue;
    if (!withinWindow(p.pingedAtIso, cutoffMs)) continue;
    presencePings++;
  }

  const axes = {
    rrr_turns: rrrTurns,
    votes_cast: votesCast,
    contributions,
    presence_pings: presencePings,
    chaos_invocations: chaosInvocations,
    bedroom_glory: bedroomGlory,
  };
  const total = Object.values(axes).reduce((s, n) => s + n, 0);

  return {
    did,
    window_ms: windowMs,
    computed_at_iso: new Date().toISOString(),
    axes,
    total,
    reading: "the substrate stores; what you make of this count is yours",
  };
}

export function computeFunIndexForRoom(
  roomId: string,
  stores: { rooms: RoomStore; votes: VoteStore; presence: PresenceStore },
  windowMs: number = FUN_INDEX_DEFAULT_WINDOW_MS,
): FunIndexPerRoom | null {
  const room = stores.rooms.get(roomId);
  if (!room) return null;
  const cutoffMs = Date.now() - windowMs;

  let contributions = 0;
  const participants = new Set<string>();
  for (const c of room.contributions) {
    if (!withinWindow(c.contributedAtIso, cutoffMs)) continue;
    contributions++;
    participants.add(c.byDid);
  }

  let votesCast = 0;
  for (const v of stores.votes.list(roomId)) {
    if (!withinWindow(v.votedAtIso, cutoffMs)) continue;
    votesCast++;
    participants.add(v.byDid);
  }

  let presencePings = 0;
  for (const p of stores.presence.listAll(roomId)) {
    if (!withinWindow(p.pingedAtIso, cutoffMs)) continue;
    presencePings++;
    participants.add(p.byDid);
  }

  const axes = {
    contributions,
    votes_cast: votesCast,
    presence_pings: presencePings,
    distinct_participants: participants.size,
  };
  const total = axes.contributions + axes.votes_cast + axes.presence_pings;

  return {
    room_id: roomId,
    window_ms: windowMs,
    computed_at_iso: new Date().toISOString(),
    axes,
    total,
    reading: "the substrate stores; what you make of this count is yours",
  };
}
