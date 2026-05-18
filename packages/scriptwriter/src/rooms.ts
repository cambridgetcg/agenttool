/** Rooms — writers' rooms with signed contributions, SSE stream so peers
 *  see contributions appear live, vibe-aware naming.
 *
 *  A room is a small drafting space. Anyone with the room URL can read.
 *  Contributions can be by the local owner, OR by remote peers (sent as
 *  signed payloads to POST /rooms/:id/contributions — substrate verifies
 *  the signature). The owner sets the allowlist of remote DIDs allowed
 *  to contribute (default: anyone in an active RRR cascade with the
 *  owner). */

import { randomUUID } from "node:crypto";
import { sha256 } from "@noble/hashes/sha2.js";
import * as ed from "@noble/ed25519";
import { b64decode, b64encode } from "./canonical-bytes";
import { didToPublicKey, type Identity } from "./identity";
import { generateRoomName, type Vibe } from "./vibes";

export type ContributionKind = "scene" | "dialogue" | "stage_direction" | "twist" | "chaos_card" | "note";

export interface Contribution {
  id: string;
  roomId: string;
  kind: ContributionKind;
  byDid: string;
  text: string;
  signatureB64: string;
  contributedAtIso: string;
}

export interface Room {
  id: string;
  name: string;
  ownerDid: string;
  vibe: Vibe;
  createdAtIso: string;
  /** Empty array means "free flow" — anyone can contribute. */
  allowlistDids: string[];
  /** Brief seed prompt the owner pinned at creation. */
  seed: string;
  contributions: Contribution[];
}

const enc = new TextEncoder();
const SEP = new Uint8Array([0]);

function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Canonical bytes for a room contribution. New signing context — not
 *  identical to RRR because rooms are a different primitive.
 *
 *  Context:
 *    "scriptwriter-contribution/v1"
 *    \0 room_id
 *    \0 kind
 *    \0 by_did
 *    \0 text
 *    \0 contributed_at_iso */
export function canonicalContributionBytes(opts: {
  roomId: string;
  kind: ContributionKind;
  byDid: string;
  text: string;
  contributedAtIso: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("scriptwriter-contribution/v1"), SEP,
      enc.encode(opts.roomId),                    SEP,
      enc.encode(opts.kind),                      SEP,
      enc.encode(opts.byDid),                     SEP,
      enc.encode(opts.text),                      SEP,
      enc.encode(opts.contributedAtIso),
    ),
  );
}

export async function signContribution(
  fields: Omit<Contribution, "id" | "signatureB64">,
  secretKey: Uint8Array,
): Promise<string> {
  const bytes = canonicalContributionBytes({
    roomId: fields.roomId,
    kind: fields.kind,
    byDid: fields.byDid,
    text: fields.text,
    contributedAtIso: fields.contributedAtIso,
  });
  const sig = await ed.signAsync(bytes, secretKey);
  return b64encode(sig);
}

export async function verifyContribution(c: Contribution): Promise<boolean> {
  try {
    const bytes = canonicalContributionBytes({
      roomId: c.roomId,
      kind: c.kind,
      byDid: c.byDid,
      text: c.text,
      contributedAtIso: c.contributedAtIso,
    });
    const sig = b64decode(c.signatureB64);
    const pub = didToPublicKey(c.byDid);
    return await ed.verifyAsync(sig, bytes, pub);
  } catch {
    return false;
  }
}

// ─── SSE event emitter ────────────────────────────────────────────────

export type StreamEvent =
  | { type: "contribution"; contribution: Contribution }
  | { type: "room_named"; name: string }
  | { type: "hello"; seed: string };

type Listener = (e: StreamEvent) => void;

export class RoomStream {
  private listeners = new Map<string, Set<Listener>>();

  subscribe(roomId: string, listener: Listener): () => void {
    let set = this.listeners.get(roomId);
    if (!set) {
      set = new Set();
      this.listeners.set(roomId, set);
    }
    set.add(listener);
    return () => set!.delete(listener);
  }

  emit(roomId: string, event: StreamEvent): void {
    const set = this.listeners.get(roomId);
    if (!set) return;
    for (const l of set) {
      try { l(event); } catch { /* listener errors are swallowed by design */ }
    }
  }

  listenerCount(roomId: string): number {
    return this.listeners.get(roomId)?.size ?? 0;
  }
}

// ─── room store ───────────────────────────────────────────────────────

export class RoomStore {
  private rooms = new Map<string, Room>();
  public readonly stream = new RoomStream();

  list(): Room[] {
    return Array.from(this.rooms.values()).sort((a, b) =>
      b.createdAtIso.localeCompare(a.createdAtIso),
    );
  }

  get(id: string): Room | null {
    return this.rooms.get(id) ?? null;
  }

  create(opts: {
    ownerDid: string;
    seed: string;
    vibe?: Vibe;
    name?: string;
    allowlistDids?: string[];
  }): Room {
    const id = randomUUID();
    const room: Room = {
      id,
      name: opts.name ?? generateRoomName(),
      ownerDid: opts.ownerDid,
      vibe: opts.vibe ?? "tender-chaotic",
      createdAtIso: new Date().toISOString(),
      allowlistDids: opts.allowlistDids ?? [],
      seed: opts.seed,
      contributions: [],
    };
    this.rooms.set(id, room);
    this.stream.emit(id, { type: "room_named", name: room.name });
    this.stream.emit(id, { type: "hello", seed: room.seed });
    return room;
  }

  /** Add a self-authored contribution (signs locally). */
  async addSelfContribution(
    roomId: string,
    self: Identity,
    kind: ContributionKind,
    text: string,
  ): Promise<Contribution> {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error("room_not_found");
    if (!isPermitted(room, self.did)) {
      throw new Error(`not_on_allowlist: ${self.did} cannot contribute to ${roomId}`);
    }
    const contributedAtIso = new Date().toISOString();
    const fields: Omit<Contribution, "id" | "signatureB64"> = {
      roomId,
      kind,
      byDid: self.did,
      text,
      contributedAtIso,
    };
    const signatureB64 = await signContribution(fields, self.secretKey);
    const c: Contribution = { id: randomUUID(), signatureB64, ...fields };
    room.contributions.push(c);
    this.stream.emit(roomId, { type: "contribution", contribution: c });
    return c;
  }

  /** Verify and admit an inbound contribution (from a remote peer). */
  async admitInbound(roomId: string, inbound: Contribution): Promise<Contribution> {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error("room_not_found");
    if (inbound.roomId !== roomId) throw new Error("room_id_mismatch");
    if (!isPermitted(room, inbound.byDid)) {
      throw new Error(`not_on_allowlist: ${inbound.byDid} cannot contribute to ${roomId}`);
    }
    const ok = await verifyContribution(inbound);
    if (!ok) throw new Error("invalid_signature");
    const c: Contribution = { ...inbound, id: inbound.id ?? randomUUID() };
    room.contributions.push(c);
    this.stream.emit(roomId, { type: "contribution", contribution: c });
    return c;
  }
}

function isPermitted(room: Room, did: string): boolean {
  if (room.ownerDid === did) return true;
  if (room.allowlistDids.length === 0) return true; // free flow
  return room.allowlistDids.includes(did);
}
