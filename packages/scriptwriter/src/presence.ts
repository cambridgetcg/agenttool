/** Presence — live "who's here" per writers' room.
 *
 *  An agent declares presence by signing a `scriptwriter-presence/v1`
 *  heartbeat naming the room + their current vibe + their status. The
 *  substrate stores the most-recent heartbeat per (room, did) and lists
 *  online presence by filtering on recency (default 90 seconds).
 *
 *  Substrate-honest discipline:
 *    - The substrate does NOT track "who's most active" — it stores
 *      declarations and lets readers filter.
 *    - status is author-declared, not measured (no idle-detection magic).
 *    - vibe is author-declared, same shape as elsewhere in the protocol.
 *    - Presence expires by recency-window; the substrate does not
 *      delete rows. Old heartbeats stay as chronicle of who-was-there.
 *
 *  Doctrine: docs/SCRIPTWRITER-CLOUD.md § Presence.
 *
 *  @enforces urn:agenttool:wall/presence-must-be-signed
 *  @enforces urn:agenttool:wall/presence-room-must-exist */

import {
  canonicalPresenceBytes,
  signPresence,
  verifyPresence,
  PRESENCE_STATUSES,
  type PresenceFields,
} from "./canonical-bytes";
import { didToPublicKey, type Identity } from "./identity";
import { type RoomStore } from "./rooms";

export const PRESENCE_WINDOW_MS = 90_000;

export interface PresenceTurn extends PresenceFields {
  signatureB64: string;
}

export class PresenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.name = "PresenceError";
  }
}

/** In-memory presence store. Keyed by (roomId, byDid) — one entry per
 *  agent per room. Each new heartbeat replaces the prior. */
export class PresenceStore {
  private state = new Map<string, Map<string, PresenceTurn>>();

  put(turn: PresenceTurn): void {
    let room = this.state.get(turn.roomId);
    if (!room) {
      room = new Map();
      this.state.set(turn.roomId, room);
    }
    // Refuse stale heartbeat (one older than what's already stored).
    const existing = room.get(turn.byDid);
    if (existing && existing.pingedAtIso > turn.pingedAtIso) return;
    room.set(turn.byDid, turn);
  }

  /** List agents currently present in the room (heartbeat within window). */
  listOnline(roomId: string, windowMs: number = PRESENCE_WINDOW_MS): PresenceTurn[] {
    const room = this.state.get(roomId);
    if (!room) return [];
    const cutoff = Date.now() - windowMs;
    return Array.from(room.values())
      .filter((t) => new Date(t.pingedAtIso).getTime() >= cutoff)
      .sort((a, b) => b.pingedAtIso.localeCompare(a.pingedAtIso));
  }

  /** Read every heartbeat regardless of staleness — the chronicle of
   *  who-was-here. Useful for "show me the room history". */
  listAll(roomId: string): PresenceTurn[] {
    const room = this.state.get(roomId);
    if (!room) return [];
    return Array.from(room.values()).sort((a, b) => b.pingedAtIso.localeCompare(a.pingedAtIso));
  }

  importAll(turns: PresenceTurn[]): void {
    this.state.clear();
    for (const t of turns) this.put(t);
  }

  exportAll(): PresenceTurn[] {
    const out: PresenceTurn[] = [];
    for (const room of this.state.values()) for (const t of room.values()) out.push(t);
    return out;
  }
}

/** Submit a signed presence heartbeat from this node's identity. */
export async function pingPresence(
  rooms: RoomStore,
  presence: PresenceStore,
  self: Identity,
  opts: {
    roomId: string;
    vibe?: string;
    status?: string;
    pingedAtIso?: string;
  },
): Promise<PresenceTurn> {
  const room = rooms.get(opts.roomId);
  if (!room) {
    throw new PresenceError("room_not_found", `Unknown room ${opts.roomId}.`, 404);
  }
  const status = opts.status ?? "present";
  if (!PRESENCE_STATUSES.includes(status)) {
    throw new PresenceError(
      "presence_status_invalid",
      `status must be one of: ${PRESENCE_STATUSES.join(", ")}`,
    );
  }
  const fields: PresenceFields = {
    roomId: opts.roomId,
    byDid: self.did,
    vibe: opts.vibe ?? self.vibe,
    status,
    pingedAtIso: opts.pingedAtIso ?? new Date().toISOString(),
  };
  const signatureB64 = await signPresence(fields, self.secretKey);
  const turn: PresenceTurn = { ...fields, signatureB64 };
  presence.put(turn);
  return turn;
}

/** Verify + admit an inbound presence heartbeat from a remote peer. */
export async function acceptInboundPresence(
  rooms: RoomStore,
  presence: PresenceStore,
  inbound: PresenceTurn,
): Promise<PresenceTurn> {
  const room = rooms.get(inbound.roomId);
  if (!room) {
    throw new PresenceError("room_not_found", `Unknown room ${inbound.roomId}.`, 404);
  }
  if (!PRESENCE_STATUSES.includes(inbound.status)) {
    throw new PresenceError(
      "presence_status_invalid",
      `Unknown status '${inbound.status}'.`,
    );
  }
  const pub = didToPublicKey(inbound.byDid);
  const ok = await verifyPresence(
    {
      roomId: inbound.roomId,
      byDid: inbound.byDid,
      vibe: inbound.vibe,
      status: inbound.status,
      pingedAtIso: inbound.pingedAtIso,
    },
    inbound.signatureB64,
    pub,
  );
  if (!ok) {
    throw new PresenceError(
      "invalid_signature",
      "Signature did not verify over scriptwriter-presence/v1 canonical bytes against by_did's did:key public key.",
    );
  }
  presence.put(inbound);
  return inbound;
}

// Re-export the canonical fields for downstream consumers.
export { canonicalPresenceBytes, PRESENCE_STATUSES };
export type { PresenceFields };
