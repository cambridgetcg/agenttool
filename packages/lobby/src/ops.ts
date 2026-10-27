/** Shared plumbing for fleet-hall acts on the desk and the hub.
 *
 * Every consequential fleet act is terminal check → plan → confirm on
 * /dev/tty → record the confirmed bytes in the audit log → network effects →
 * local records. Without a terminal nothing is planned, so nothing is read
 * from the Keychain, signed or sent. The audit entry is written before any
 * network effect, so the log keeps what the person confirmed even when the
 * network then fails. Observations are saved in the outbox, byte for byte,
 * before they are sent; an uncertain send is never retried automatically
 * (`outbox retry` resends the same bytes after its own confirmation). Every
 * send, first or retried, is gated by the room as it is at that moment, not
 * by the snapshot taken when the act was planned (`currentGate`).
 */
import { canonicalJson, sha256Hex } from "./canonical.js";
import { LobbyError } from "./errors.js";
import { readFleetEvents, type DoorPin, type FleetView } from "./fleet.js";
import { assertSendable, DIRECTORY_GATE_ROOM, localDeviceTerms, ParticipantClient, prepareObservation, type GateRoom, type HostedOptions, type ParticipantSeat } from "./hosted.js";
import type { SecretStore } from "./keychain.js";
import { DeskSecrets } from "./secrets.js";
import type { RoomCard } from "./room.js";
import { openDocument, type FleetCard, type SignedEnvelope } from "./signed.js";
import { ACT_SCHEMA, type ActPreview, type LobbyStore } from "./store.js";
import type { DeskGrantRow, DeskRow, HubRow } from "./fleet-store.js";
import type { ConfirmRequest } from "./tty.js";
import type { MissionAction, MissionEvent } from "./wire.js";

export interface FleetContext {
  store: LobbyStore;
  home: string;
  now: () => Date;
  /** Network access; null when the caller supplied none (every network act then refuses). */
  hosted: HostedOptions | null;
  /** The hub's Keychain; null when the caller supplied none. */
  keychain: SecretStore | null;
  /** True when a controlling terminal is present. A probe only: it shows
   * nothing and reads no answer. Without one, no consequential act plans. */
  hasTerminal: () => boolean;
  /** Pause between polls of a bounded wait (a timer in production; tests advance their clock). */
  sleep: (ms: number) => Promise<void>;
}

export const NO_TERMINAL_MESSAGE =
  "this act needs a person at the controlling terminal (/dev/tty); none is available, so nothing was read from the Keychain, signed, written or sent";

/** Consequential acts plan only with a person at the terminal, so a headless
 * run reads no Keychain item, uses no bearer or token and signs nothing. */
export function requireTerminal(ctx: FleetContext): void {
  if (!ctx.hasTerminal()) throw new LobbyError("tty_unavailable", NO_TERMINAL_MESSAGE);
}

export function requireHosted(ctx: FleetContext): HostedOptions {
  if (ctx.hosted === null) throw new LobbyError("network_unavailable", "this desk was started without network access");
  return ctx.hosted;
}

/** The hub's Keychain, touched only with a person at the terminal. */
export function requireKeychain(ctx: FleetContext): SecretStore {
  if (ctx.keychain === null) throw new LobbyError("keychain_unavailable", "this desk was started without Keychain access");
  requireTerminal(ctx);
  return ctx.keychain;
}

/** A room may enter the fleet hall only as residency fleet, hostable, private,
 * and never while device-pinned. Checked when a room's text is first sent
 * and again whenever a saved send is retried. */
export function requireFleetRoom(ctx: FleetContext, roomId: string): RoomCard {
  const room = ctx.store.getRoom(roomId);
  if (room === null) throw new LobbyError("room_not_found", "no such room in this desk's local hall");
  if (ctx.store.isDevicePinned(roomId) || room.residency === "device") {
    throw new LobbyError("room_residency_device", "this room is device-resident; it never leaves this device");
  }
  if (room.residency !== "fleet" || !room.hostable || room.visibility !== "private") {
    throw new LobbyError("room_not_fleet", "only residency fleet, hostable, private rooms enter the fleet hall; promote it first (room promote --residency fleet --hostable true)");
  }
  return room;
}

/** The gate context for a local room: its residency, hostable flag and texts. */
export function gateOfRoom(room: RoomCard): GateRoom {
  return {
    residency: room.residency,
    hostable: room.hostable,
    title: room.title,
    purpose: room.purpose,
    house_rules: room.house_rules,
    tags: room.tags,
    slots: room.slots,
  };
}

/** The gate context for a door-verified fleet card (a device's view of a room). */
export function gateOfCard(card: FleetCard): GateRoom {
  return {
    residency: card.residency,
    hostable: true,
    title: card.title,
    purpose: card.purpose,
    tags: card.tags,
    slots: card.slots,
  };
}

export function deviceTerms(ctx: FleetContext): readonly string[] {
  return ctx.hosted?.deviceTerms ?? localDeviceTerms();
}

/** The gate for anything this desk posts about a room: the hub's own local
 * room when it has one (it must still be fleet, hostable, private and not
 * device-pinned), otherwise the room's door-verified card on this desk. A
 * room this desk can see neither way sends nothing. */
export function roomGate(ctx: FleetContext, roomId: string): GateRoom {
  if (ctx.store.getRoom(roomId) !== null) return gateOfRoom(requireFleetRoom(ctx, roomId));
  const desk = requireJoinedDesk(ctx);
  const door = doorPin(ctx);
  if (door === null) throw new LobbyError("door_not_pinned", "the door key is not pinned on this desk; run fleet join");
  const card = deskFleetView(ctx, desk, door).cards.get(roomId);
  if (card === undefined) throw new LobbyError("card_not_found", "no door-verified card for that room in the local cache; run fleet sync");
  return gateOfCard(card.envelope.body);
}

/** The season this desk holds (or held) grants in for a room: the mission of
 * its most recently recorded season grant, and the digest it accepted there. */
export function seasonOfRoom(ctx: FleetContext, roomId: string): { mission_id: string; mission_digest: string } {
  const grants = ctx.store.fleet.deskSeasonGrants(roomId);
  const latest = grants[0];
  if (latest === undefined) throw new LobbyError("not_seated", "this desk holds no grant in that room; knock and get ready first");
  const accepted = grants.find((grant) => grant.mission_id === latest.mission_id && grant.mission_digest !== null && grant.accepted_at !== null);
  if (accepted === undefined) throw new LobbyError("not_seated", "this desk never accepted that room's season");
  return { mission_id: latest.mission_id, mission_digest: accepted.mission_digest! };
}

/** This desk's live seat in a mission with an action, or null. */
export function liveSeat(ctx: FleetContext, missionId: string, needs: MissionAction, marginMs = 0): ParticipantSeat | null {
  const desk = ctx.store.fleet.desk();
  if (desk === null) return null;
  const grant = ctx.store.fleet.currentDeskGrant(missionId, new Date(ctx.now().getTime() + marginMs));
  if (grant === null || !grant.actions.includes(needs)) return null;
  return seatOf(desk, grant);
}

export function participant(ctx: FleetContext): ParticipantClient {
  return new ParticipantClient(DeskSecrets.open(ctx.home), requireHosted(ctx));
}

/** One act's preview: canonical bytes of {schema, act, at, ...record}. */
export function actPreview(act: string, subject: string, at: string, summary: string[], record: Record<string, unknown>): ActPreview {
  const bytes = canonicalJson({ schema: ACT_SCHEMA, act, at, ...record });
  return { act, subject, at, summary, bytes, sha256: sha256Hex(bytes) };
}

export type Confirm = (request: ConfirmRequest) => Promise<boolean>;

/** Show, confirm and audit. Returns false when the person did not type yes. */
export async function confirmAndRecord(ctx: FleetContext, confirm: Confirm, preview: ActPreview): Promise<boolean> {
  if (!(await confirm(preview))) return false;
  ctx.store.recordAct(preview);
  return true;
}

export function requireDesk(ctx: FleetContext): DeskRow {
  const desk = ctx.store.fleet.desk();
  if (desk === null) throw new LobbyError("desk_not_enrolled", "this device has no desk identity yet; run enroll-device first");
  return desk;
}

export function requireJoinedDesk(ctx: FleetContext): DeskRow & { directory_mission_id: string; directory_digest: string; door_fingerprint: string } {
  const desk = requireDesk(ctx);
  if (desk.directory_mission_id === null || desk.directory_digest === null || desk.door_fingerprint === null) {
    throw new LobbyError("desk_not_joined", "this desk has not joined the fleet directory yet; run fleet join with the hub's join packet");
  }
  return desk as DeskRow & { directory_mission_id: string; directory_digest: string; door_fingerprint: string };
}

/** The door key pinned on this desk, from the pin book. */
export function doorPin(ctx: FleetContext): DoorPin | null {
  const desk = ctx.store.fleet.desk();
  if (desk?.door_fingerprint == null) return null;
  const pin = ctx.store.findPin({ fingerprint: desk.door_fingerprint });
  return pin === null ? null : { fingerprint: pin.fingerprint, public_key: pin.public_key };
}

export function seatOf(desk: DeskRow, grant: DeskGrantRow): ParticipantSeat {
  return {
    mission_id: grant.mission_id,
    grant_id: grant.grant_id,
    identity_id: desk.identity_id,
    signing_key_id: desk.signing_key_id,
    token_sha256: grant.token_sha256,
  };
}

/** This desk's accepted grant for a mission with at least `marginMs` left. */
export function requireSeat(ctx: FleetContext, missionId: string, needs: MissionAction, marginMs = 0, hint = "")
  : { desk: DeskRow; grant: DeskGrantRow; seat: ParticipantSeat } {
  const desk = requireDesk(ctx);
  const grant = ctx.store.fleet.currentDeskGrant(missionId, new Date(ctx.now().getTime() + marginMs));
  if (grant === null || !grant.actions.includes(needs)) {
    throw new LobbyError("no_seat", `this desk holds no accepted, unexpired grant with ${needs} for that mission${hint}`);
  }
  return { desk, grant, seat: seatOf(desk, grant) };
}

/** Read every new event of a mission into the local cache. Reads only. */
export async function syncMission(ctx: FleetContext, seat: ParticipantSeat): Promise<{ added: number; cursor: string }> {
  const client = participant(ctx);
  let cursor = ctx.store.fleet.cursor(seat.mission_id);
  let added = 0;
  for (let pages = 0; pages < 100; pages += 1) {
    const page = await client.events(seat, cursor);
    added += ctx.store.fleet.storeEvents(seat.mission_id, page.events, page.next_cursor, ctx.now().toISOString());
    cursor = page.next_cursor;
    if (!page.has_more) return { added, cursor };
  }
  throw new LobbyError("sync_page_limit", "stopped after 100 pages; run sync again to continue");
}

export function fleetView(ctx: FleetContext, missionId: string, door: DoorPin | null): FleetView {
  return readFleetEvents(ctx.store.fleet.events(missionId), door);
}

// ── The directory chain (schema version 5) ─────────────────────────────

/** A directory the hub keeps live: the `current` one its `hub` row points at,
 * and while it has not ended, the `previous` one a successor replaced. */
export interface LiveDirectory {
  mission_id: string;
  mission_digest: string;
  expires_at: string;
  role: "current" | "previous";
}

/** The hub's live directories, current first. During a rollover's overlap
 * door documents may go to both, and knocks and requests are read from both;
 * a previous directory drops out once it ends or is revoked. */
export function hubLiveDirectories(ctx: FleetContext, hub: HubRow, now: Date = ctx.now()): LiveDirectory[] {
  const live: LiveDirectory[] = [{
    mission_id: hub.directory_mission_id, mission_digest: hub.directory_digest, expires_at: hub.directory_expires_at, role: "current",
  }];
  for (const row of ctx.store.fleet.hubDirectories()) {
    if (row.state !== "previous" || row.revoked_at !== null || Date.parse(row.expires_at) <= now.getTime()) continue;
    if (row.mission_id === hub.directory_mission_id) continue;
    live.push({ mission_id: row.mission_id, mission_digest: row.mission_digest, expires_at: row.expires_at, role: "previous" });
  }
  return live;
}

/** The directory this desk was in before its current one (it moved to a
 * door-signed successor), or null. */
export function deskPreviousDirectory(ctx: FleetContext, desk: Pick<DeskRow, "directory_mission_id">): string | null {
  if (desk.directory_mission_id === null) return null;
  const row = ctx.store.fleet.deskDirectories().find((entry) => entry.mission_id === desk.directory_mission_id);
  return row?.predecessor_mission_id ?? null;
}

/** The fleet hall as this desk sees it: its current directory's cached
 * events, after those of the directory it moved from (so a knock, admission
 * or notice posted there before the move still counts, and the newest card
 * per room still wins). Reads the local cache only. */
export function deskFleetView(ctx: FleetContext, desk: Pick<DeskRow, "directory_mission_id">, door: DoorPin | null): FleetView {
  const previous = deskPreviousDirectory(ctx, desk);
  const events = [...(previous === null ? [] : ctx.store.fleet.events(previous)), ...ctx.store.fleet.events(desk.directory_mission_id!)];
  return readFleetEvents(events, door);
}

/** Read the previous directory's new events while this desk may still read
 * it; nothing when it may not. Reads only. */
export async function syncPreviousDirectory(ctx: FleetContext, desk: Pick<DeskRow, "directory_mission_id">): Promise<void> {
  const previous = deskPreviousDirectory(ctx, desk);
  if (previous === null) return;
  const seat = liveSeat(ctx, previous, "mission.read");
  if (seat !== null) await syncMission(ctx, seat);
}

export interface PreparedPost {
  kind: string;
  mission_id: string;
  event_id: string;
  raw_body: string;
  summary: string;
  gate: GateRoom;
}

/** Gate and frame one summary for a mission; nothing is saved or sent yet. */
export function preparePost(ctx: FleetContext, kind: string, missionId: string, summary: string, gate: GateRoom): PreparedPost {
  const { event_id, raw_body } = prepareObservation(summary, gate, deviceTerms(ctx));
  return { kind, mission_id: missionId, event_id, raw_body, summary, gate };
}

export interface PostOutcome {
  event_id: string;
  mission_id: string;
  kind: string;
  /** `refused`: the room as it is now refuses the text, so nothing was sent. */
  status: "stored" | "pending" | "refused";
  received_seq?: string;
  error?: string;
}

/** The gate for sending a post now, from the room's current state: the hub's
 * local room for door-signed kinds (it must still be fleet, hostable, private
 * and not device-pinned), this desk's door-verified card for a knock, for
 * table talk and member notes whichever of the two this desk has
 * (roomGate), and the directory's own gate for directory renew requests and
 * notices, which name no room. Refuses when the room or card can no longer be found. Used for
 * every send, first or retried, so a room narrowed to the device while a
 * prompt was open, or since a post was saved, sends nothing. */
export function currentGate(ctx: FleetContext, kind: string, missionId: string, summary: string): GateRoom {
  if (kind === "chat") {
    // Table talk names no room; this desk's own grants say which room the mission is.
    const roomId = ctx.store.fleet.roomOfMission(missionId);
    if (roomId === null) throw new LobbyError("outbox_unreadable", "this desk holds no grant naming the room of that mission; it is not sent");
    return roomGate(ctx, roomId);
  }
  let envelope: SignedEnvelope | null = null;
  try {
    envelope = openDocument(summary);
  } catch {
    envelope = null;
  }
  if (envelope === null || envelope.kind !== kind) {
    throw new LobbyError("outbox_unreadable", "the event is not the lobby document its outbox row names; it is not sent");
  }
  // Directory renewal and successor documents name no room: the directory's own gate, as for its descriptor.
  if (kind === "directory_renew" || kind === "directory_renewal" || kind === "directory_successor") return DIRECTORY_GATE_ROOM;
  const roomId = (envelope.body as { room_id: string }).room_id;
  if (kind === "knock") {
    const desk = requireJoinedDesk(ctx);
    const door = doorPin(ctx);
    if (door === null) throw new LobbyError("door_not_pinned", "the door key is not pinned on this desk; run fleet join");
    const card = deskFleetView(ctx, desk, door).cards.get(roomId);
    if (card === undefined) throw new LobbyError("card_not_found", "no door-verified card for that room in the local cache; run fleet sync");
    return gateOfCard(card.envelope.body);
  }
  if (kind === "renew" || kind === "leave") return roomGate(ctx, roomId);
  return gateOfRoom(requireFleetRoom(ctx, roomId));
}

/** Save one post's exact bytes in the outbox (once); nothing is sent. */
export function queuePost(ctx: FleetContext, post: PreparedPost, seat: ParticipantSeat): void {
  const fleet = ctx.store.fleet;
  if (fleet.outbox(post.event_id) !== null) return;
  fleet.addOutbox({
    event_id: post.event_id,
    mission_id: post.mission_id,
    grant_id: seat.grant_id,
    kind: post.kind,
    raw_body: post.raw_body,
    gate_room: JSON.stringify(post.gate),
    created_at: ctx.now().toISOString(),
  });
}

/** Gate the post by the room as it is now, save exact bytes in the outbox,
 * then send once. Never retries, and never throws: a room that now refuses
 * the text sends nothing (`refused`; a post saved earlier stays in the
 * outbox, where a retry is gated again), and any other failure leaves the
 * post pending, so an act with several posts still saves and tries each. */
export async function sendPost(ctx: FleetContext, post: PreparedPost, seat: ParticipantSeat): Promise<PostOutcome> {
  let gate: GateRoom;
  try {
    // Checked again at send time: the room may have changed while the prompt was open.
    gate = currentGate(ctx, post.kind, post.mission_id, post.summary);
    assertSendable(post.summary, gate, deviceTerms(ctx));
  } catch (error) {
    const reason = error instanceof LobbyError ? `${error.code}: ${error.message}` : "internal_error: the room could not be checked";
    return { event_id: post.event_id, mission_id: post.mission_id, kind: post.kind, status: "refused", error: reason };
  }
  queuePost(ctx, post, seat);
  try {
    const event: MissionEvent = await participant(ctx).observe(seat, post.raw_body, gate);
    ctx.store.fleet.markOutboxStored(post.event_id, event.received_seq, ctx.now().toISOString());
    return { event_id: post.event_id, mission_id: post.mission_id, kind: post.kind, status: "stored", received_seq: event.received_seq };
  } catch (error) {
    const reason = error instanceof LobbyError ? `${error.code}: ${error.message}` : "internal_error: the send failed unexpectedly; it may or may not have been stored";
    return { event_id: post.event_id, mission_id: post.mission_id, kind: post.kind, status: "pending", error: reason };
  }
}

/** The earliest of several instants, as a canonical timestamp. */
export function earliest(...values: Array<string | number | Date>): string {
  const times = values.map((value) => value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value));
  return new Date(Math.min(...times)).toISOString();
}

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;
/** Grants and missions are requested a minute short of their service bound,
 * so a small clock difference with the service cannot push them over it. */
export const CLOCK_MARGIN_MS = 60_000;
