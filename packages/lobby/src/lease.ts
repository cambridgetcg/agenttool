/** Room seat leases: table talk without a person at the terminal for each
 * message, inside bounds a person confirmed once.
 *
 * This is one of the two named, bounded exceptions to "consequential acts
 * belong to the CLI and the terminal" (packages/lobby/CLAUDE.md):
 *
 * - `room lease <room_id>` (tty) plans with reads only, shows the exact lease
 *   record on /dev/tty, and on "yes" appends `room.lease` to the audit log and
 *   writes the lease in the same transaction. It contacts no service after the
 *   prompt, reads no Keychain item and signs nothing.
 * - `room say --lease <id> --idempotency-key <k>` then sends one player's
 *   `message` or `read_ack` without a terminal. Before it writes it checks
 *   the lease (state, room, conversation, seat, recipients, budgets), the
 *   STOP file, the hub stop, the lease's bound grants, a fresh read of the
 *   season and (on a member desk) the directory with exactly those grants,
 *   the newest door-signed roster (this desk on it, still a player), the
 *   card's season and status, and the room gate. Then, in one transaction, it
 *   reserves the budget, appends `room.say.lease` with the exact raw body and
 *   saves the outbox row, before any network effect, and sends once under
 *   the lease's bound grant (never `currentDeskGrant`). Nothing is retried
 *   automatically; an uncertain send is settled only by `outbox retry` at a
 *   terminal.
 * - `room lease revoke` ends leases with no terminal and no prompt, audited.
 *   A void is final and audited too (`room.lease.void`).
 *
 * A lease never covers another act, never widens or extends itself, and is
 * never created without a terminal. It stays with the directory grant it was
 * made under: when its desk moves to the door-signed successor directory
 * (`fleet renew` or `fleet join`, src/directory-renewal.ts and src/desk.ts),
 * the move ends it (`void: directory_moved`), so it is never carried into the
 * successor's grant and never outlives the grant it binds. It reads no Keychain item: the desk key
 * and grant tokens come from `<home>/secrets` through the one transport, as
 * for every participant call. Contract: packages/lobby/README.md#room-seat-leases.
 */
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson, sha256Hex } from "./canonical.js";
import { LobbyError } from "./errors.js";
import { mayHaveTakenEffect, type ParticipantSeat } from "./hosted.js";
import {
  actPreview,
  CLOCK_MARGIN_MS,
  doorPin,
  earliest,
  fleetView,
  requireJoinedDesk,
  roomGate,
  seatOf,
  sendPost,
  syncMission,
  type FleetContext,
  type PostOutcome,
} from "./ops.js";
import type { DeskGrantRow, LeaseRow, LeaseSendRow } from "./fleet-store.js";
import { assertRoomId } from "./room.js";
import { validateSeatRef } from "./seat-ref.js";
import type { ActPreview } from "./store.js";
import { assertConversation, CHAT_KINDS, DEFAULT_CONVERSATION, rosterOf, type ChatKind, type RosterPin } from "./table.js";
import { composeSay, type RoomScope } from "./talk.js";
import { isUuid, scalarLength } from "./wire.js";

export const LEASE_FORMAT = "agenttool-lobby-lease/v1" as const;
/** Yu's caps, 2026-10-27: up to 8 hours; 20 messages by default and 100 at
 * most; 1000 characters per message; 10,000 characters in all by default and
 * 50,000 at most; 30 s between sends by default and never under 5 s. */
export const LEASE_LIMITS = Object.freeze({
  minutes: { min: 1, max: 480, default: 480 },
  messages: { min: 1, max: 100, default: 20 },
  charsPerMessage: 1000,
  totalChars: { min: 1, max: 50_000, default: 10_000 },
  intervalSeconds: { min: 5, max: 3600, default: 30 },
  /** Active leases per room on one desk. */
  activePerRoom: 3,
  /** A lease shorter than this is refused at creation (renew first). */
  minDurationMs: 5 * 60_000,
  /** Egress-gate refusals under one lease before it is void. */
  refusalsBeforeVoid: 5,
});
/** The one stop file per device: `<lobby home>/STOP`, the lobby home resolved
 * exactly as src/home.ts does. Its presence (lstat, any type; it is never
 * read) voids every active lease; removing it brings none back. */
export const STOP_FILE = "STOP";
export const LEASE_ACTS = ["room.say"] as const;
const LEASE_ID = /^lease_[0-9a-f]{32}$/;
export const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;

export type EndsBy = "minutes" | "season_grant" | "directory_grant" | "term" | "season";

/** The confirmed lease record: canonical JSON inside the `room.lease` act. */
export interface LeaseRecord {
  format: typeof LEASE_FORMAT;
  lease_id: string;
  room_id: string;
  mission_id: string;
  mission_digest: string;
  grant_id: string;
  /** The member desk's directory grant; null on the room's host desk. */
  directory_grant_id: string | null;
  identity_id: string;
  signing_key_id: string;
  roster_seq: number;
  tier: "player";
  acts: typeof LEASE_ACTS[number][];
  kinds: ChatKind[];
  conversation: string;
  recipients: Array<{ identity_id: string; fingerprint: string }>;
  max_messages: number;
  max_chars_per_message: number;
  max_total_chars: number;
  min_interval_seconds: number;
  issued_at: string;
  expires_at: string;
  ends_by: EndsBy;
  seat_ref: string | null;
}

export function assertLeaseId(value: unknown): string {
  if (typeof value !== "string" || !LEASE_ID.test(value)) {
    throw new LobbyError("invalid_lease_id", "a lease id is lease_ followed by 32 lower-case hex");
  }
  return value;
}

export function assertIdempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY.test(value)) {
    throw new LobbyError("invalid_idempotency_key", "an idempotency key is 8-128 letters, digits, dots, underscores, colons or hyphens");
  }
  return value;
}

function newLeaseId(): string {
  return `lease_${Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex")}`;
}

// ── stops ──────────────────────────────────────────────────────────────

/** True when `<home>/STOP` exists, of any type. Fails closed: anything but
 * "no such file" counts as present. */
export function stopFilePresent(home: string): boolean {
  try {
    lstatSync(join(home, STOP_FILE));
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return !(code === "ENOENT" || code === "ENOTDIR");
  }
}

function hubStopped(ctx: FleetContext): boolean {
  return ctx.store.fleet.hub()?.stopped_at != null;
}

function isEnded(row: LeaseRow): boolean {
  return row.revoked_at !== null || row.voided_at !== null;
}

function isActive(row: LeaseRow, now: Date): boolean {
  return !isEnded(row) && Date.parse(row.expires_at) > now.getTime();
}

/** End one lease for good, audited without a prompt. False when it had
 * already ended (another process got there first): nothing is written then. */
function voidLease(ctx: FleetContext, leaseId: string, reason: string, refusedEventId?: string): boolean {
  const at = ctx.now().toISOString();
  const record = refusedEventId === undefined ? { lease_id: leaseId, reason } : { lease_id: leaseId, reason, refused_event_id: refusedEventId };
  try {
    return ctx.store.recordActWith(actPreview("room.lease.void", leaseId, at, [], record), () => {
      if (!ctx.store.fleet.voidLease(leaseId, reason, at)) throw new LobbyError("lease_already_ended", "the lease had already ended");
      return true;
    });
  } catch (error) {
    if (error instanceof LobbyError && error.code === "lease_already_ended") return false;
    throw error;
  }
}

/** Void every lease on this desk that has not ended (expired ones too, so a
 * stop is on record for each). Returns how many were voided. */
function voidAll(ctx: FleetContext, reason: string): number {
  let voided = 0;
  for (const row of ctx.store.fleet.listLeases()) {
    if (!isEnded(row) && voidLease(ctx, row.lease_id, reason)) voided += 1;
  }
  return voided;
}

/** Run by every CLI command once lobby.sqlite is open: while the STOP file
 * exists, or once this desk's hub has recorded an emergency stop, every lease
 * that has not ended is voided and audited, so removing the file later
 * brings none back; otherwise a lease its desk's move has ended is voided
 * (`endMovedLeases`). Reads only when there is nothing to void. */
export function enforceLeaseStops(ctx: FleetContext): void {
  if (!ctx.store.fleet.v5 || ctx.store.readonly) return;
  const open = ctx.store.fleet.listLeases().some((row) => !isEnded(row));
  if (!open) return;
  if (stopFilePresent(ctx.home)) voidAll(ctx, "stop_file");
  else if (hubStopped(ctx)) voidAll(ctx, "hub_stopped");
  else endMovedLeases(ctx);
}

/** True when the directory grant a lease binds is in a directory this desk
 * has left: it moved to the door-signed successor (`fleet renew` or `fleet
 * join`). A host desk's lease binds no directory grant and never moves. */
function directoryMoved(ctx: FleetContext, directoryGrantId: string | null): boolean {
  if (directoryGrantId === null) return false;
  const bound = ctx.store.fleet.deskGrant(directoryGrantId);
  const desk = ctx.store.fleet.desk();
  return bound !== null && desk !== null && bound.mission_id !== desk.directory_mission_id;
}

/** The active leases on this desk bound to a directory grant in `missionId`:
 * the ones a move out of that directory ends (for the move's prompt). */
export function leasesEndedByMove(ctx: FleetContext, missionId: string): string[] {
  if (!ctx.store.fleet.v5) return [];
  const now = ctx.now();
  return ctx.store.fleet.listLeases().filter((row) => isActive(row, now) && row.directory_grant_id !== null
    && ctx.store.fleet.deskGrant(row.directory_grant_id)?.mission_id === missionId).map((row) => row.lease_id);
}

/** A move to the successor directory ends every active lease bound to a
 * directory grant in the directory this desk left, audited as a void
 * (`directory_moved`): a lease is never carried into the successor's grant.
 * Run right after a move and by every CLI command. Returns how many. */
export function endMovedLeases(ctx: FleetContext): number {
  if (!ctx.store.fleet.v5 || ctx.store.readonly) return 0;
  const now = ctx.now();
  let voided = 0;
  for (const row of ctx.store.fleet.listLeases()) {
    if (isActive(row, now) && directoryMoved(ctx, row.directory_grant_id) && voidLease(ctx, row.lease_id, "directory_moved")) voided += 1;
  }
  return voided;
}

// ── where a lease lives ────────────────────────────────────────────────

/** The room's host desk: the hub, which keeps the room locally. Its leases
 * bind no directory grant; its card is its own local room and season. */
function isHostDesk(ctx: FleetContext, roomId: string): boolean {
  return ctx.store.fleet.hub() !== null && ctx.store.getRoom(roomId) !== null;
}

interface SeasonNow {
  mission_id: string;
  expires_at: string;
}

/** The room's season as this desk can see it now, refusing a gone card, a
 * new season or a closed room with closed codes (no void here). */
function seasonNow(ctx: FleetContext, scope: RoomScope, host: boolean): SeasonNow {
  if (host) {
    const season = ctx.store.fleet.currentSeason(scope.room_id);
    if (season === null) throw new LobbyError("card_gone", "the hub has no current season for this room");
    if (season.mission_id !== scope.mission_id) throw new LobbyError("season_changed", "the room has a new season; a lease covers only the season it was made in");
    if (ctx.store.getRoom(scope.room_id)?.status === "closed") throw new LobbyError("room_closed", "the room is closed");
    return { mission_id: season.mission_id, expires_at: season.expires_at };
  }
  const card = fleetView(ctx, scope.desk.directory_mission_id, scope.door).cards.get(scope.room_id)?.envelope.body;
  if (card === undefined) throw new LobbyError("card_gone", "no door-verified card for this room in the local cache");
  if (card.season.mission_id !== scope.mission_id) throw new LobbyError("season_changed", "the room has a new season; a lease covers only the season it was made in");
  if (card.status === "closed") throw new LobbyError("room_closed", "the room is closed");
  return { mission_id: card.season.mission_id, expires_at: card.season.expires_at };
}

function liveGrant(grant: DeskGrantRow | null, now: Date, action: "mission.observe" | "mission.read"): boolean {
  return grant !== null && grant.accepted_at !== null && (grant.left_at ?? null) === null && grant.expires_at !== null
    && grant.actions.includes(action) && Date.parse(grant.expires_at) - CLOCK_MARGIN_MS > now.getTime();
}

// ── create (tty) ───────────────────────────────────────────────────────

export interface LeaseInput {
  room_id: string;
  /** null: any seat on this desk (`--any-seat`). */
  seat_ref: string | null;
  /** Empty: every other member on the newest roster now, named in the record. */
  to: readonly string[];
  minutes?: number;
  messages?: number;
  total_chars?: number;
  interval_seconds?: number;
  conversation?: string;
}

export interface LeasePlan {
  preview: ActPreview;
  record: LeaseRecord;
  host: boolean;
}

function bounded(value: number | undefined, limits: { min: number; max: number; default: number }, what: string): number {
  const chosen = value ?? limits.default;
  if (!Number.isInteger(chosen) || chosen < limits.min || chosen > limits.max) {
    throw new LobbyError("invalid_lease_bounds", `${what} is a whole number from ${limits.min} to ${limits.max}`);
  }
  return chosen;
}

function refuseStopped(ctx: FleetContext): void {
  if (stopFilePresent(ctx.home)) throw new LobbyError("lease_stopped", `a STOP file exists in this desk's home (${STOP_FILE}); no lease is made or used while it is there`);
  if (hubStopped(ctx)) throw new LobbyError("hub_stopped", "this desk's hub recorded an emergency stop; no lease is made or used");
}

function activeLeases(ctx: FleetContext, roomId: string, now: Date): LeaseRow[] {
  return ctx.store.fleet.listLeases().filter((row) => row.room_id === roomId && isActive(row, now));
}

function refuseCrowded(ctx: FleetContext, roomId: string, seatRef: string | null, now: Date): void {
  const active = activeLeases(ctx, roomId, now);
  if (active.length >= LEASE_LIMITS.activePerRoom) {
    throw new LobbyError("lease_active_exists", `this room already has ${active.length} active leases on this desk (at most ${LEASE_LIMITS.activePerRoom}); revoke one first`);
  }
  if (active.some((row) => row.seat_ref === seatRef)) {
    throw new LobbyError("lease_active_exists", `this room already has an active lease bound to ${seatRef === null ? "any seat" : "that seat ref"}; revoke it first`);
  }
}

/** Plan a lease with reads only: this desk's own season grant (and on a
 * member desk its directory grant) read the room and the directory, then the
 * newest roster, the card, the gate and the bounds decide. Nothing is
 * written, signed or sent. */
export async function planLease(ctx: FleetContext, input: LeaseInput): Promise<LeasePlan> {
  const minutes = bounded(input.minutes, LEASE_LIMITS.minutes, "--minutes");
  const messages = bounded(input.messages, LEASE_LIMITS.messages, "--messages");
  const totalChars = bounded(input.total_chars, LEASE_LIMITS.totalChars, "--chars");
  const intervalSeconds = bounded(input.interval_seconds, LEASE_LIMITS.intervalSeconds, "--interval-seconds");
  const conversation = assertConversation(input.conversation ?? DEFAULT_CONVERSATION);
  const seatRef = input.seat_ref === null ? null : validateSeatRef(input.seat_ref);
  const roomId = assertRoomId(input.room_id);
  refuseStopped(ctx);
  const desk = requireJoinedDesk(ctx);
  const door = doorPin(ctx);
  if (door === null) throw new LobbyError("door_not_pinned", "the door key is not pinned on this desk; run fleet join");
  const host = isHostDesk(ctx, roomId);
  const now = ctx.now();
  const margin = new Date(now.getTime() + CLOCK_MARGIN_MS);
  const fleet = ctx.store.fleet;
  // This desk's own season grant: the room's latest season it holds one in.
  const seasonGrants = fleet.deskSeasonGrants(roomId);
  if (seasonGrants.length === 0) throw new LobbyError("not_seated", "this desk holds no grant in that room; knock and get ready first");
  const missionId = seasonGrants[0]!.mission_id;
  const grant = fleet.currentDeskGrant(missionId, margin);
  if (grant === null) throw new LobbyError("no_seat", "this desk holds no live grant in that room; renew it first (room renew request, then room renew accept)");
  if (!grant.actions.includes("mission.observe")) throw new LobbyError("lease_not_player", "only a player's grant posts; a spectator gets no lease");
  const digest = seasonGrants.find((row) => row.mission_id === missionId && row.mission_digest !== null && row.accepted_at !== null)?.mission_digest;
  if (digest == null) throw new LobbyError("not_seated", "this desk never accepted that room's season");
  let directory: DeskGrantRow | null = null;
  if (!host) {
    directory = fleet.currentDeskGrant(desk.directory_mission_id, margin);
    if (directory === null || !directory.actions.includes("mission.read")) {
      throw new LobbyError("no_seat", "this desk's directory grant has lapsed, so a lease could not re-check the card; renew it first (fleet renew here; if that cannot, enroll-device here, hub relay on the hub, fleet join here)");
    }
  }
  // Fresh reads with exactly the grants the lease will bind.
  await syncMission(ctx, seatOf(desk, grant));
  if (directory !== null) await syncMission(ctx, seatOf(desk, directory));
  const scope: RoomScope = { desk, room_id: roomId, mission_id: missionId, mission_digest: digest, door };
  roomGate(ctx, roomId);
  const season = seasonNow(ctx, scope, host);
  const roster = rosterOf(fleet.events(missionId), door, scope);
  const me = roster.members.find((member) => member.identity_id === desk.identity_id && member.signing_key_id === desk.signing_key_id);
  if (me === undefined) throw new LobbyError("not_on_roster", "the newest door-signed roster of this room does not list this desk; ask the hub to post one (hub roster post)");
  if (me.tier !== "player") throw new LobbyError("lease_not_player", "the newest roster lists this desk as a spectator; only players get a lease");
  const others = roster.members.filter((member) => member.identity_id !== desk.identity_id);
  let recipients: RosterPin[];
  if (input.to.length === 0) {
    recipients = others;
  } else {
    const wanted = [...new Set(input.to)];
    recipients = wanted.map((identity) => {
      if (!isUuid(identity)) throw new LobbyError("invalid_to", "--to is an identity UUID");
      if (identity === desk.identity_id) throw new LobbyError("to_is_self", "a lease names other members, not this desk");
      const member = others.find((candidate) => candidate.identity_id === identity);
      if (member === undefined) throw new LobbyError("to_not_member", "that identity is not a current member on the newest door-signed roster");
      return member;
    });
  }
  if (recipients.length === 0) throw new LobbyError("no_other_members", "the door-signed roster names no other current member to talk to");
  recipients = [...recipients].sort((left, right) => left.identity_id < right.identity_id ? -1 : 1);
  refuseCrowded(ctx, roomId, seatRef, now);
  const bounds: Array<[EndsBy, number]> = [
    ["minutes", now.getTime() + minutes * 60_000],
    ["season_grant", Date.parse(grant.expires_at!) - CLOCK_MARGIN_MS],
    ...(directory === null ? [] : [["directory_grant", Date.parse(directory.expires_at!) - CLOCK_MARGIN_MS] as [EndsBy, number]]),
    ["term", Date.parse(me.term_ends_at)],
    ["season", Date.parse(season.expires_at)],
  ];
  const [endsBy, endsAt] = bounds.reduce((best, item) => item[1] < best[1] ? item : best);
  if (endsAt - now.getTime() < LEASE_LIMITS.minDurationMs) {
    throw new LobbyError("lease_too_short", `this lease would end within 5 minutes (${endsBy === "minutes" ? "as asked" : `the ${endsBy.replace("_", " ")} ends`}); renew first, then make the lease`);
  }
  const issuedAt = now.toISOString();
  const record: LeaseRecord = {
    format: LEASE_FORMAT,
    lease_id: newLeaseId(),
    room_id: roomId,
    mission_id: missionId,
    mission_digest: digest,
    grant_id: grant.grant_id,
    directory_grant_id: directory?.grant_id ?? null,
    identity_id: desk.identity_id,
    signing_key_id: desk.signing_key_id,
    roster_seq: roster.roster_seq!,
    tier: "player",
    acts: [...LEASE_ACTS],
    kinds: [...CHAT_KINDS],
    conversation,
    recipients: recipients.map((member) => ({ identity_id: member.identity_id, fingerprint: member.fingerprint })),
    max_messages: messages,
    max_chars_per_message: LEASE_LIMITS.charsPerMessage,
    max_total_chars: totalChars,
    min_interval_seconds: intervalSeconds,
    issued_at: issuedAt,
    expires_at: earliest(endsAt),
    ends_by: endsBy,
    seat_ref: seatRef,
  };
  const preview = actPreview("room.lease", record.lease_id, issuedAt, [
    `room ${roomId} season ${missionId}; conversation ${conversation}; grant ${grant.grant_id}`,
    `agents on this desk may send up to ${messages} messages (message or read_ack, at most ${LEASE_LIMITS.charsPerMessage} characters each, ` +
      `${totalChars} in all, at least ${intervalSeconds} s apart) to these members without asking you:`,
    ...recipients.map((member) => `  ${member.fingerprint} did:at:${member.identity_id} (${member.role}, ${member.tier})`),
    "every member of this season and the service read every message",
    `until ${record.expires_at} (ends by ${endsBy.replace("_", " ")}); bound to ${seatRef === null ? "any seat on this desk" : `seat ${seatRef}`} (a seat ref is an unverified label)`,
    "renewal, leave and every other act still need you here; revoke any time with: agenttool-lobby room lease revoke " + record.lease_id,
  ], { lease: record });
  return { preview, record, host };
}

/** Write the confirmed lease and its audit entry in one transaction, after
 * checking again that no stop was recorded, that the room has room for it
 * and that its grant is still live. Contacts no service. */
export function executeLease(ctx: FleetContext, plan: LeasePlan): LeaseRow {
  const record = plan.record;
  return ctx.store.recordActWith(plan.preview, (auditSeq) => {
    const now = ctx.now();
    refuseStopped(ctx);
    refuseCrowded(ctx, record.room_id, record.seat_ref, now);
    if (!liveGrant(ctx.store.fleet.deskGrant(record.grant_id), now, "mission.observe")) {
      throw new LobbyError("no_seat", "the season grant this lease binds is no longer live; nothing was written");
    }
    if (directoryMoved(ctx, record.directory_grant_id)) {
      throw new LobbyError("directory_changed", "this desk moved to the successor directory while the prompt was open; nothing was written. Make the lease again");
    }
    ctx.store.fleet.addLease({
      lease_id: record.lease_id,
      room_id: record.room_id,
      mission_id: record.mission_id,
      grant_id: record.grant_id,
      directory_grant_id: record.directory_grant_id,
      seat_ref: record.seat_ref,
      record: canonicalJson(record),
      record_sha256: sha256Hex(canonicalJson(record)),
      audit_seq: auditSeq,
      issued_at: record.issued_at,
      expires_at: record.expires_at,
      max_messages: record.max_messages,
      max_chars_per_message: record.max_chars_per_message,
      max_total_chars: record.max_total_chars,
      min_interval_ms: record.min_interval_seconds * 1000,
    });
    return ctx.store.fleet.lease(record.lease_id)!;
  });
}

// ── list, show, revoke (no terminal) ───────────────────────────────────

export function leaseRecordOf(row: LeaseRow): LeaseRecord {
  return JSON.parse(row.record) as LeaseRecord;
}

/** `active`, `expired`, `revoked` or `void: <reason>`, with a stop that has
 * not been recorded yet shown as the void it will become. */
export function leaseState(ctx: FleetContext, row: LeaseRow): string {
  if (row.voided_at !== null) return `void: ${row.void_reason}`;
  if (row.revoked_at !== null) return "revoked";
  if (Date.parse(row.expires_at) <= ctx.now().getTime()) return "expired";
  if (stopFilePresent(ctx.home)) return "void: stop_file";
  if (hubStopped(ctx)) return "void: hub_stopped";
  return "active";
}

export interface LeaseView {
  lease_id: string;
  room_id: string;
  mission_id: string;
  grant_id: string;
  directory_grant_id: string | null;
  seat_ref: string | null;
  state: string;
  issued_at: string;
  expires_at: string;
  ends_by: EndsBy;
  conversation: string;
  recipients: LeaseRecord["recipients"];
  max_messages: number;
  max_chars_per_message: number;
  max_total_chars: number;
  min_interval_seconds: number;
  sent_messages: number;
  sent_chars: number;
  gate_refusals: number;
  last_send_at: string | null;
  next_send_at: string | null;
  sends: { stored: number; pending: number };
  revoked_at: string | null;
  voided_at: string | null;
  record_sha256: string;
}

export function leaseView(ctx: FleetContext, row: LeaseRow): LeaseView {
  const record = leaseRecordOf(row);
  const sends = ctx.store.fleet.leaseSends(row.lease_id);
  const stored = sends.filter((send) => ctx.store.fleet.outbox(send.event_id)?.state === "stored").length;
  return {
    lease_id: row.lease_id,
    room_id: row.room_id,
    mission_id: row.mission_id,
    grant_id: row.grant_id,
    directory_grant_id: row.directory_grant_id,
    seat_ref: row.seat_ref,
    state: leaseState(ctx, row),
    issued_at: row.issued_at,
    expires_at: row.expires_at,
    ends_by: record.ends_by,
    conversation: record.conversation,
    recipients: record.recipients,
    max_messages: row.max_messages,
    max_chars_per_message: row.max_chars_per_message,
    max_total_chars: row.max_total_chars,
    min_interval_seconds: row.min_interval_ms / 1000,
    sent_messages: row.sent_messages,
    sent_chars: row.sent_chars,
    gate_refusals: row.gate_refusals,
    last_send_at: row.last_send_at,
    next_send_at: row.last_send_at === null ? null : new Date(Date.parse(row.last_send_at) + row.min_interval_ms).toISOString(),
    sends: { stored, pending: sends.length - stored },
    revoked_at: row.revoked_at,
    voided_at: row.voided_at,
    record_sha256: row.record_sha256,
  };
}

export function listLeases(ctx: FleetContext, input: { all: boolean }): LeaseView[] {
  const now = ctx.now();
  return ctx.store.fleet.listLeases()
    .filter((row) => input.all || isActive(row, now))
    .map((row) => leaseView(ctx, row));
}

export function showLease(ctx: FleetContext, leaseId: string): { lease: LeaseView; record: LeaseRecord; sends: Array<LeaseSendRow & { state: string }> } {
  const row = ctx.store.fleet.lease(assertLeaseId(leaseId));
  if (row === null) throw new LobbyError("lease_not_found", "no such lease on this desk");
  return {
    lease: leaseView(ctx, row),
    record: leaseRecordOf(row),
    sends: ctx.store.fleet.leaseSends(row.lease_id).map((send) => ({ ...send, state: ctx.store.fleet.outbox(send.event_id)?.state ?? "unknown" })),
  };
}

/** End leases now: one, or every lease on this desk (optionally in one
 * room). No terminal, no prompt, nothing sent; each revocation is audited.
 * Ended leases are skipped, so running it again is harmless. */
export function revokeLeases(ctx: FleetContext, input: { lease_id?: string; all?: boolean; room_id?: string }): { revoked: string[]; already_ended: string[] } {
  const fleet = ctx.store.fleet;
  let rows: LeaseRow[];
  if (input.lease_id !== undefined) {
    const row = fleet.lease(assertLeaseId(input.lease_id));
    if (row === null) throw new LobbyError("lease_not_found", "no such lease on this desk");
    rows = [row];
  } else {
    const roomId = input.room_id === undefined ? undefined : assertRoomId(input.room_id);
    rows = fleet.listLeases().filter((row) => roomId === undefined || row.room_id === roomId);
  }
  const revoked: string[] = [];
  const alreadyEnded: string[] = [];
  for (const row of rows) {
    if (isEnded(row)) {
      alreadyEnded.push(row.lease_id);
      continue;
    }
    const at = ctx.now().toISOString();
    try {
      ctx.store.recordActWith(actPreview("room.lease.revoke", row.lease_id, at, [], { lease_id: row.lease_id }), () => {
        if (!fleet.revokeLease(row.lease_id, at)) throw new LobbyError("lease_already_ended", "the lease had already ended");
      });
      revoked.push(row.lease_id);
    } catch (error) {
      if (!(error instanceof LobbyError && error.code === "lease_already_ended")) throw error;
      alreadyEnded.push(row.lease_id);
    }
  }
  return { revoked, already_ended: alreadyEnded };
}

// ── send under a lease (no terminal) ───────────────────────────────────

export interface LeaseSendInput {
  room_id: string;
  lease_id: string;
  idempotency_key: string;
  text: string;
  to?: string;
  in_reply_to?: string;
  kind?: ChatKind;
  conversation?: string;
}

export interface LeaseSendResult {
  status: "stored" | "pending";
  replayed: boolean;
  event_id: string;
  mission_id: string;
  grant_id: string;
  received_seq: string | null;
  audit_sha256: string;
  lease: LeaseView;
  error?: string;
  /** Set when this send's outcome ended the lease (`grant_refused`). */
  voided?: string;
}

/** Refuse, after recording a void of this lease, with a closed code. */
function voidAndRefuse(ctx: FleetContext, leaseId: string, reason: string, message: string): never {
  voidLease(ctx, leaseId, reason);
  throw new LobbyError("lease_void", `${message}; the lease is now void (${reason})`, { reason });
}

/** True when this lease's void records that the room refused this event at
 * send time: it was reserved and audited, and never left the device. */
function refusedAtSend(ctx: FleetContext, leaseId: string, eventId: string): boolean {
  return ctx.store.listAudit().some((entry) => entry.act === "room.lease.void" && entry.subject === leaseId
    && (JSON.parse(entry.bytes) as { refused_event_id?: unknown }).refused_event_id === eventId);
}

function definiteRefusal(error: unknown): boolean {
  return error instanceof LobbyError && error.code === "hosted_refused" && typeof error.details.status === "number" && error.details.status < 500;
}

function requestSha256(input: { room_id: string; conversation: string; kind: ChatKind; to: string | null; in_reply_to: string | null; text: string }): string {
  return sha256Hex(canonicalJson(input));
}

function receiptOf(ctx: FleetContext, row: LeaseRow, send: LeaseSendRow, replayed: boolean): LeaseSendResult {
  const outbox = ctx.store.fleet.outbox(send.event_id);
  const audit = ctx.store.listAudit().find((entry) => entry.seq === send.audit_seq);
  return {
    status: outbox?.state === "stored" ? "stored" : "pending",
    replayed,
    event_id: send.event_id,
    mission_id: send.mission_id,
    grant_id: send.grant_id,
    received_seq: outbox?.received_seq ?? null,
    audit_sha256: audit?.bytes_sha256 ?? "",
    lease: leaseView(ctx, ctx.store.fleet.lease(row.lease_id)!),
  };
}

/** Check a lease's budget for one more message of `chars` characters now. */
function refuseOverBudget(row: LeaseRow, chars: number, now: Date): void {
  if (chars > row.max_chars_per_message) {
    throw new LobbyError("lease_message_too_long", `the text is ${chars} characters; this lease allows at most ${row.max_chars_per_message} per message`);
  }
  if (row.sent_messages >= row.max_messages) throw new LobbyError("lease_budget_exhausted", `this lease has sent all ${row.max_messages} of its messages`);
  if (row.sent_chars + chars > row.max_total_chars) {
    throw new LobbyError("lease_chars_exhausted", `this message would take the lease past its ${row.max_total_chars} characters (${row.sent_chars} used)`);
  }
  if (row.last_send_at !== null) {
    const next = Date.parse(row.last_send_at) + row.min_interval_ms;
    if (now.getTime() < next) throw new LobbyError("lease_too_soon", `the next send under this lease is allowed from ${new Date(next).toISOString()}`, { next_send_at: new Date(next).toISOString() });
  }
}

function refuseEnded(row: LeaseRow, now: Date): void {
  if (row.revoked_at !== null) throw new LobbyError("lease_revoked", `this lease was revoked at ${row.revoked_at}`);
  if (row.voided_at !== null) throw new LobbyError("lease_void", `this lease is void (${row.void_reason}) since ${row.voided_at}`, { reason: row.void_reason });
  if (Date.parse(row.expires_at) <= now.getTime()) throw new LobbyError("lease_expired", `this lease ended at ${row.expires_at}`);
}

/** Send one message under a lease, with no terminal. See the module comment
 * for the order of checks; each refusal is a closed code, and a void is
 * recorded before the refusal is reported. */
export async function sendUnderLease(ctx: FleetContext, input: LeaseSendInput): Promise<LeaseSendResult> {
  const fleet = ctx.store.fleet;
  const leaseId = assertLeaseId(input.lease_id);
  const key = assertIdempotencyKey(input.idempotency_key);
  const roomId = assertRoomId(input.room_id);
  const loaded = fleet.lease(leaseId);
  if (loaded === null) throw new LobbyError("lease_not_found", "no such lease on this desk");
  if (loaded.room_id !== roomId) throw new LobbyError("lease_room_mismatch", "that lease is for another room");
  const record = leaseRecordOf(loaded);
  const kind = input.kind ?? "message";
  const conversation = assertConversation(input.conversation ?? record.conversation);
  const request = requestSha256({
    room_id: roomId, conversation, kind, to: input.to ?? null, in_reply_to: input.in_reply_to ?? null, text: input.text,
  });

  // Idempotency first: a stored send is reported again, never sent again.
  const existing = fleet.leaseSend(leaseId, key);
  if (existing !== null) {
    if (existing.request_sha256 !== request) {
      throw new LobbyError("idempotency_key_reused", "this idempotency key was already used under this lease for a different message; choose a new key");
    }
    const replay = receiptOf(ctx, loaded, existing, true);
    if (replay.status === "stored") return replay;
    if (refusedAtSend(ctx, leaseId, existing.event_id)) {
      throw new LobbyError("lease_send_refused",
        `this message (event ${existing.event_id}) was refused by the room's gate at send time and never sent; the lease is void (room_narrowed)`,
        { event_id: existing.event_id });
    }
    throw new LobbyError("lease_send_uncertain",
      `this message (event ${existing.event_id}) was saved and sent once without a verified receipt; it may already be stored. ` +
      `It is never resent automatically: a person at the terminal runs: agenttool-lobby outbox retry ${existing.event_id}`,
      { event_id: existing.event_id });
  }

  const now = ctx.now();
  refuseEnded(loaded, now);
  // Stops: one STOP per device, and the hub's own emergency stop.
  if (stopFilePresent(ctx.home)) {
    voidAll(ctx, "stop_file");
    throw new LobbyError("lease_void", `a STOP file exists in this desk's home (${STOP_FILE}); every lease on this desk is now void (stop_file)`, { reason: "stop_file" });
  }
  if (hubStopped(ctx)) {
    voidAll(ctx, "hub_stopped");
    throw new LobbyError("lease_void", "this desk's hub recorded an emergency stop; every lease on this desk is now void (hub_stopped)", { reason: "hub_stopped" });
  }
  // The seat: attribution and accident-prevention, not access control.
  if (loaded.seat_ref !== null && (ctx.seatRef ?? null) !== loaded.seat_ref) {
    throw new LobbyError("lease_seat_mismatch", (ctx.seatRef ?? null) === null
      ? "this lease is bound to one seat and this process declares none"
      : "this lease is bound to another seat than the one this process declares");
  }
  // Scope and budget, before any read.
  if (!(record.kinds as readonly string[]).includes(kind)) throw new LobbyError("lease_kind_not_covered", "this lease covers message and read_ack only");
  if (conversation !== record.conversation) throw new LobbyError("lease_conversation_not_covered", `this lease covers the conversation ${record.conversation} only`);
  if (kind === "read_ack" && input.in_reply_to === undefined) throw new LobbyError("read_ack_needs_reference", "a read_ack must name the message it acknowledges (in_reply_to)");
  const chars = scalarLength(input.text);
  refuseOverBudget(loaded, chars, now);

  // The grants this lease is bound to: never a successor.
  const desk = requireJoinedDesk(ctx);
  const door = doorPin(ctx);
  if (door === null) throw new LobbyError("door_not_pinned", "the door key is not pinned on this desk; run fleet join");
  if (desk.identity_id !== record.identity_id || desk.signing_key_id !== record.signing_key_id) {
    voidAndRefuse(ctx, leaseId, "desk_changed", "this desk's identity is not the one the lease names");
  }
  const bound = fleet.deskGrant(loaded.grant_id);
  if (bound === null || bound.accepted_at === null) voidAndRefuse(ctx, leaseId, "grant_left", "the season grant this lease binds is not on this desk");
  if ((bound.left_at ?? null) !== null) voidAndRefuse(ctx, leaseId, "grant_left", "this desk left the season grant this lease binds");
  if (!bound.actions.includes("mission.observe")) voidAndRefuse(ctx, leaseId, "tier_narrowed", "the season grant this lease binds cannot post");
  if (!liveGrant(bound, now, "mission.observe")) throw new LobbyError("lease_expired", "the season grant this lease binds ends within a minute; the lease ends with it");
  let directory: DeskGrantRow | null = null;
  if (loaded.directory_grant_id !== null) {
    if (directoryMoved(ctx, loaded.directory_grant_id)) {
      voidAndRefuse(ctx, leaseId, "directory_moved",
        "this desk moved to the successor directory; a lease stays with the directory grant it was made under and is never carried into the successor's");
    }
    directory = fleet.deskGrant(loaded.directory_grant_id);
    if (!liveGrant(directory, now, "mission.read")) throw new LobbyError("lease_expired", "the directory grant this lease binds has ended or ends within a minute; the lease ends with it");
  }
  const seat: ParticipantSeat = seatOf(desk, bound);

  // Fresh reads with exactly those grants. A definite refusal means the
  // grant was revoked (a kick, a block, the hub's stop): the lease is void.
  try {
    await syncMission(ctx, seat);
    if (directory !== null) await syncMission(ctx, seatOf(desk, directory));
  } catch (error) {
    if (definiteRefusal(error)) voidAndRefuse(ctx, leaseId, "grant_refused", "the service refused a read with the lease's grant");
    if (mayHaveTakenEffect(error)) {
      throw new LobbyError("lease_recheck_uncertain", "the room could not be read just now, so nothing was sent and no budget was used; try again later");
    }
    throw error;
  }

  // The room, the season and the roster as they are now.
  const host = isHostDesk(ctx, roomId);
  const scope: RoomScope = { desk, room_id: roomId, mission_id: record.mission_id, mission_digest: record.mission_digest, door };
  try {
    seasonNow(ctx, scope, host);
  } catch (error) {
    if (error instanceof LobbyError) voidAndRefuse(ctx, leaseId, error.code, error.message);
    throw error;
  }
  const roster = rosterOf(fleet.events(record.mission_id), door, scope);
  const me = roster.members.find((member) => member.identity_id === desk.identity_id && member.signing_key_id === desk.signing_key_id);
  if (me === undefined) voidAndRefuse(ctx, leaseId, "not_on_roster", "the newest door-signed roster no longer lists this desk");
  if (me.tier !== "player") voidAndRefuse(ctx, leaseId, "tier_narrowed", "the newest door-signed roster lists this desk as a spectator");
  try {
    roomGate(ctx, roomId);
  } catch (error) {
    if (error instanceof LobbyError && (error.code === "room_residency_device" || error.code === "room_not_fleet" || error.code === "room_not_found")) {
      voidAndRefuse(ctx, leaseId, "room_narrowed", "the room no longer leaves this device");
    }
    if (error instanceof LobbyError && error.code === "card_not_found") voidAndRefuse(ctx, leaseId, "card_gone", "the room's card is gone");
    throw error;
  }
  let composed;
  try {
    composed = composeSay(ctx, scope, {
      room_id: roomId,
      text: input.text,
      kind,
      conversation,
      ...(input.to === undefined ? {} : { to: input.to }),
      ...(input.in_reply_to === undefined ? {} : { in_reply_to: input.in_reply_to }),
    });
  } catch (error) {
    if (error instanceof LobbyError && error.code === "egress_refused") {
      const refusals = fleet.countLeaseRefusal(leaseId);
      if (refusals >= LEASE_LIMITS.refusalsBeforeVoid) voidAndRefuse(ctx, leaseId, "gate_refusals", `the egress gate refused ${refusals} texts under this lease`);
      throw new LobbyError("egress_refused", `${error.message}. Nothing was sent; ${refusals} of ${LEASE_LIMITS.refusalsBeforeVoid} refusals before this lease is void`, error.details);
    }
    throw error;
  }
  const covered = record.recipients.some((recipient) => recipient.identity_id === composed.to.identity_id && recipient.fingerprint === composed.to.fingerprint);
  if (!covered) throw new LobbyError("lease_recipient_not_covered", "this lease does not name that recipient (with that key)");

  // Reserve, audit and save in one transaction, before any network effect.
  const n = loaded.sent_messages + 1;
  const at = ctx.now().toISOString();
  const preview = actPreview("room.say.lease", leaseId, at, [], {
    lease_id: leaseId,
    lease_sha256: loaded.record_sha256,
    n,
    seat_ref: ctx.seatRef ?? null,
    idempotency_key: key,
    room_id: roomId,
    mission_id: record.mission_id,
    grant_id: bound.grant_id,
    event_id: composed.post.event_id,
    to_identity: composed.to.identity_id,
    raw_body: composed.post.raw_body,
  });
  ctx.store.recordActWith(preview, (auditSeq) => {
    const fresh = fleet.lease(leaseId)!;
    const inside = ctx.now();
    if (fleet.leaseSend(leaseId, key) !== null) {
      throw new LobbyError("lease_changed", "another process used this idempotency key meanwhile; run the same command again to see its outcome");
    }
    refuseEnded(fresh, inside);
    if (stopFilePresent(ctx.home)) throw new LobbyError("lease_stopped", `a STOP file appeared in this desk's home (${STOP_FILE}); nothing was sent`);
    if (directoryMoved(ctx, fresh.directory_grant_id)) {
      throw new LobbyError("directory_changed", "this desk moved to the successor directory meanwhile; nothing was sent, and the lease ends with the move");
    }
    refuseOverBudget(fresh, chars, inside);
    if (fresh.sent_messages + 1 !== n) {
      throw new LobbyError("lease_changed", "another send under this lease was reserved meanwhile; nothing was sent, run the command again");
    }
    fleet.addLeaseSend({
      lease_id: leaseId,
      idempotency_key: key,
      request_sha256: request,
      n,
      event_id: composed.post.event_id,
      mission_id: record.mission_id,
      grant_id: bound.grant_id,
      to_identity: composed.to.identity_id,
      kind,
      chars,
      seat_ref: ctx.seatRef ?? null,
      reserved_at: at,
      audit_seq: auditSeq,
    });
    fleet.addOutbox({
      event_id: composed.post.event_id,
      mission_id: record.mission_id,
      grant_id: bound.grant_id,
      kind: composed.post.kind,
      raw_body: composed.post.raw_body,
      gate_room: JSON.stringify(composed.post.gate),
      created_at: at,
    });
  });

  // Send once under the bound grant; the transport gates again.
  const outcome: PostOutcome = await sendPost(ctx, composed.post, seat);
  const send = fleet.leaseSend(leaseId, key)!;
  if (outcome.status === "refused") {
    // Nothing left the device. The void names the event, so a replay of this
    // key reports it as refused rather than as possibly stored.
    voidLease(ctx, leaseId, "room_narrowed", composed.post.event_id);
    throw new LobbyError("lease_void", `the room as it is now refuses the message (${outcome.error}); nothing was sent and the lease is now void (room_narrowed)`, { reason: "room_narrowed" });
  }
  const result = receiptOf(ctx, loaded, send, false);
  result.audit_sha256 = preview.sha256;
  if (outcome.status === "pending") {
    result.error = outcome.error ?? "unknown";
    if (outcome.uncertain === false && (outcome.error ?? "").startsWith("hosted_refused")) {
      voidLease(ctx, leaseId, "grant_refused");
      result.voided = "grant_refused";
      result.lease = leaseView(ctx, fleet.lease(leaseId)!);
    }
  }
  return result;
}

/** The command a person runs at a terminal to make the lease an agent asked
 * for, with the caller's declared seat filled in. */
export function leaseCommandFor(args: readonly string[], declared: string | null): string {
  const quoted = args.map((arg) => /^[A-Za-z0-9._:@/+=-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, "'\\''")}'`);
  const binds = args.includes("--seat-ref") || args.includes("--any-seat") || args.some((arg) => arg.startsWith("--seat-ref="));
  const seat = binds ? [] : declared === null ? ["--any-seat"] : ["--seat-ref", declared];
  return ["agenttool-lobby", "room", "lease", ...quoted, ...seat].join(" ");
}
