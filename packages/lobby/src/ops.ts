/** Shared plumbing for fleet-hall acts on the desk and the hub.
 *
 * Every consequential fleet act is plan → confirm on /dev/tty → record the
 * confirmed bytes in the audit log → network effects → local records. The
 * audit entry is written before any network effect, so the log keeps what
 * the person confirmed even when the network then fails. Observations are
 * saved in the outbox, byte for byte, before they are sent; an uncertain
 * send is never retried automatically (`outbox retry` resends the same bytes
 * after its own confirmation).
 */
import { canonicalJson, sha256Hex } from "./canonical.js";
import { LobbyError } from "./errors.js";
import { readFleetEvents, type DoorPin, type FleetView } from "./fleet.js";
import { localDeviceTerms, ParticipantClient, prepareObservation, type GateRoom, type HostedOptions, type ParticipantSeat } from "./hosted.js";
import type { SecretStore } from "./keychain.js";
import { DeskSecrets } from "./secrets.js";
import { ACT_SCHEMA, type ActPreview, type LobbyStore } from "./store.js";
import type { DeskGrantRow, DeskRow } from "./fleet-store.js";
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
}

export function requireHosted(ctx: FleetContext): HostedOptions {
  if (ctx.hosted === null) throw new LobbyError("network_unavailable", "this desk was started without network access");
  return ctx.hosted;
}

export function requireKeychain(ctx: FleetContext): SecretStore {
  if (ctx.keychain === null) throw new LobbyError("keychain_unavailable", "this desk was started without Keychain access");
  return ctx.keychain;
}

export function deviceTerms(ctx: FleetContext): readonly string[] {
  return ctx.hosted?.deviceTerms ?? localDeviceTerms();
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
  status: "stored" | "pending";
  received_seq?: string;
  error?: string;
}

/** Save exact bytes in the outbox, then send once. Never retries. */
export async function sendPost(ctx: FleetContext, post: PreparedPost, seat: ParticipantSeat): Promise<PostOutcome> {
  const fleet = ctx.store.fleet;
  if (fleet.outbox(post.event_id) === null) {
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
  try {
    const event: MissionEvent = await participant(ctx).observe(seat, post.raw_body, post.gate);
    fleet.markOutboxStored(post.event_id, event.received_seq, ctx.now().toISOString());
    return { event_id: post.event_id, mission_id: post.mission_id, kind: post.kind, status: "stored", received_seq: event.received_seq };
  } catch (error) {
    if (!(error instanceof LobbyError)) throw error;
    return { event_id: post.event_id, mission_id: post.mission_id, kind: post.kind, status: "pending", error: `${error.code}: ${error.message}` };
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
