/** Hub side of access after admission: renewal inside the term, members of
 * adopted seasons, the pause flag, keyed roster posts, kick, block, unblock
 * and the emergency stop.
 *
 * Every act here is consequential: a terminal check before planning, the
 * exact bytes on /dev/tty, the audit entry before any network effect, and the
 * project bearer and door key read from the Keychain by this CLI only. Grant
 * and mission revocations go through the administrator revoke routes with
 * zero body bytes; nothing here rotates an API key (the stop prints that
 * manual step for the owner). Contract: packages/lobby/README.md#renewal-leave-kick-and-block.
 */
import { LobbyError } from "./errors.js";
import { verifyEventProof } from "./fleet.js";
import { mayHaveTakenEffect, type GrantIssue } from "./hosted.js";
import {
  actionsFor,
  adminClient,
  doorKey,
  doorOf,
  keyedRosterFor,
  keyedRosterPosts,
  recordKeyedRoster,
  requireHub,
  requireHubDesk,
  requireLiveHub,
  requireSeason,
  type KeyedRosterPlan,
} from "./hub.js";
import {
  actPreview,
  CLOCK_MARGIN_MS,
  DAY_MS,
  earliest,
  fleetView,
  gateOfRoom,
  liveSeat,
  preparePost,
  queuePost,
  requireFleetRoom,
  requireKeychain,
  requireSeat,
  sendPost,
  syncMission,
  type FleetContext,
  type PostOutcome,
  type PreparedPost,
} from "./ops.js";
import type { HubDeviceRow, HubRow, MemberRow, SeasonRow } from "./fleet-store.js";
import { assertRoomId, member as oneOf, SLOT_TIERS, type RoomCard, type SlotTier } from "./room.js";
import {
  documentSha256,
  invitationTemplateOf,
  publicKeyHexOf,
  sealDocument,
  verifyDocument,
  type LeaveBody,
  type RenewalBody,
  type RenewBody,
  type SignedEnvelope,
} from "./signed.js";
import type { ActPreview } from "./store.js";
import type { ParticipantSeat } from "./hosted.js";
import type { MissionEvent } from "./wire.js";
import { assertUuid, isSha256Hex, LOBBY_ORIGIN, MISSIONS_PATH, newUuid, publicKeyFingerprint, rawPublicKey } from "./wire.js";

type Seat = ParticipantSeat;
type Signer = { privateKey: Awaited<ReturnType<typeof doorKey>>; fingerprint: string };

function signerOf(hub: HubRow, key: Signer["privateKey"]): Signer {
  return { privateKey: key, fingerprint: hub.door_fingerprint };
}

/** Post one keyed roster's parts with the hub desk's season seat. */
interface RosterPosts {
  roster: KeyedRosterPlan;
  posts: Array<{ post: PreparedPost; seat: Seat }>;
}

function rosterPosts(ctx: FleetContext, roster: KeyedRosterPlan, signer: Signer, room: RoomCard, seat: Seat): RosterPosts {
  return { roster, posts: keyedRosterPosts(ctx, roster, signer, gateOfRoom(room)).map((post) => ({ post, seat })) };
}

function rosterRecord(item: RosterPosts) {
  return {
    mission_id: item.roster.mission_id,
    roster_seq: item.roster.roster_seq,
    posts: item.posts.map(({ post }) => ({ event_id: post.event_id, summary: post.summary })),
  };
}

async function sendAll(ctx: FleetContext, posts: Array<{ post: PreparedPost; seat: Seat }>): Promise<PostOutcome[]> {
  const outcomes: PostOutcome[] = [];
  for (const { post, seat } of posts) outcomes.push(await sendPost(ctx, post, seat));
  return outcomes;
}

function failureOf(error: unknown): { status: "uncertain" | "refused"; error: string } {
  return {
    status: mayHaveTakenEffect(error) ? "uncertain" : "refused",
    error: error instanceof LobbyError ? `${error.code}: ${error.message}` : "internal_error: the request failed unexpectedly",
  };
}

/** Record what happened after a confirmed act, as its own audit entry (no prompt). */
function recordOutcome(ctx: FleetContext, act: string, subject: string, record: Record<string, unknown>): void {
  ctx.store.recordAct(actPreview(`${act}.outcome`, subject, ctx.now().toISOString(), [], record));
}

// ── Desk notes (renew, leave): who really sent them ────────────────────

type NoteEntry = { envelope: SignedEnvelope<RenewBody | LeaveBody>; summary: string; event: MissionEvent };

/** Why a desk note did not come from the enrolled desk that signed it, or
 * null when it did (the same checks as a knock). */
function noteForgery(ctx: FleetContext, entry: NoteEntry): string | null {
  const device = ctx.store.fleet.deviceByFingerprint(entry.envelope.signer);
  if (device === null) return "unknown_desk";
  if (entry.event.identity_id !== device.identity_id || entry.event.signing_key_id !== device.signing_key_id) return "sender_mismatch";
  if (!verifyEventProof(entry.event, device.public_key)) return "bad_event_proof";
  if (!verifyDocument(entry.envelope, device.public_key)) return "bad_signature";
  const body = entry.envelope.body;
  if (body.identity_id !== device.identity_id || body.signing_key_id !== device.signing_key_id) return "names_another_desk";
  if (Date.parse(body.issued_at) > Date.parse(entry.event.received_at) + 5 * 60_000) return "issued_after_receipt";
  return null;
}

/** Why a member may not be renewed now, or null. */
function renewBlocker(ctx: FleetContext, room: RoomCard | null, season: SeasonRow, member: MemberRow | null, now: Date): string | null {
  if (room === null) return "room_not_found";
  try {
    requireFleetRoom(ctx, room.room_id);
  } catch {
    return "room_not_fleet";
  }
  if (room.status === "closed") return "room_closed";
  if (season.revoked_at != null || Date.parse(season.expires_at) <= now.getTime() + 60_000) return "season_ended";
  if (member === null) return "not_a_member";
  if ((member.state ?? "active") !== "active") return `member_${member.state}`;
  if (ctx.store.fleet.isBlocked(room.room_id, member.identity_id)) return "blocked";
  if (member.paused_at != null) return "paused";
  if (Date.parse(member.term_ends_at) <= now.getTime() + 60_000) return "term_ended";
  return null;
}

function tokenBlocker(ctx: FleetContext, tokenSha256: string): string | null {
  if (ctx.store.fleet.renewal(tokenSha256) !== null) return "renewed";
  const bound = ctx.store.fleet.hubGrantByToken(tokenSha256);
  if (bound !== null && bound.state === "requested") return `grant_uncertain:${bound.grant_id}`;
  if (bound !== null) return "token_reused";
  return null;
}

// ── renew-sweep ────────────────────────────────────────────────────────

export const RENEW_HASHES_FORMAT = "agenttool-lobby-renew-hashes/v1" as const;

export interface RenewHashList {
  room_id: string;
  entries: Array<{ identity_id: string; token_sha256: string }>;
}

/** A pre-supplied list of member token hashes for a season run by hand: each
 * member generated its token with the participant client (token-new) and
 * handed over only the SHA-256. */
export function parseRenewHashes(text: string): RenewHashList {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new LobbyError("invalid_hash_list", "the hash list is not JSON");
  }
  const record = value as Record<string, unknown>;
  if (record === null || typeof record !== "object" || Array.isArray(record)
    || Object.keys(record).sort().join(",") !== "entries,format,room_id" || record.format !== RENEW_HASHES_FORMAT
    || !Array.isArray(record.entries) || record.entries.length < 1 || record.entries.length > 64) {
    throw new LobbyError("invalid_hash_list", `expected ${RENEW_HASHES_FORMAT} with room_id and 1-64 entries`);
  }
  const seen = new Set<string>();
  const entries = record.entries.map((entry) => {
    const item = entry as Record<string, unknown>;
    if (item === null || typeof item !== "object" || Array.isArray(item) || Object.keys(item).sort().join(",") !== "identity_id,token_sha256"
      || !isSha256Hex(item.token_sha256)) {
      throw new LobbyError("invalid_hash_list", "each entry is exactly {identity_id, token_sha256} with a 64-hex hash");
    }
    const identity = assertUuid(item.identity_id, "identity_id");
    if (seen.has(identity) || seen.has(item.token_sha256 as string)) throw new LobbyError("invalid_hash_list", "each identity and hash appears once");
    seen.add(identity);
    seen.add(item.token_sha256 as string);
    return { identity_id: identity, token_sha256: item.token_sha256 as string };
  });
  return { room_id: assertRoomId(record.room_id), entries };
}

export interface SweepRenewal {
  basis: "request" | "list";
  request_event_id: string | null;
  request_sha256: string | null;
  room_id: string;
  season: SeasonRow;
  identity_id: string;
  issue: GrantIssue;
  notice: RenewalBody;
  post: PreparedPost;
  seat: Seat;
}

export interface SweepLeave {
  event_id: string;
  room_id: string;
  season: SeasonRow;
  identity_id: string;
}

export interface SweepSkip {
  source: string;
  room_id: string | null;
  identity_id: string | null;
  reason: string;
}

export interface SweepPlan {
  preview: ActPreview;
  renewals: SweepRenewal[];
  leaves: SweepLeave[];
  rosters: RosterPosts[];
  skipped: SweepSkip[];
  expired_requests: number;
}

interface Candidate {
  basis: "request" | "list";
  entry: NoteEntry | null;
  room_id: string;
  season: SeasonRow;
  member: MemberRow;
  token_sha256: string;
  posted_to: string;
}

export async function planRenewSweep(ctx: FleetContext, input: { room_id?: string; hashes?: RenewHashList }): Promise<SweepPlan> {
  const hub = requireLiveHub(ctx);
  requireHubDesk(ctx);
  requireKeychain(ctx);
  const fleet = ctx.store.fleet;
  const now = ctx.now();
  if (input.hashes !== undefined && input.room_id !== input.hashes.room_id) {
    throw new LobbyError("hash_list_room", "a hash list names one room; give the same room with --room");
  }
  const roomFilter = input.room_id === undefined ? null : assertRoomId(input.room_id);
  const seasons = fleet.listSeasons().filter((season) => season.state === "current" && season.revoked_at == null
    && Date.parse(season.expires_at) > now.getTime() && (roomFilter === null || season.room_id === roomFilter));
  if (roomFilter !== null && seasons.length === 0) throw new LobbyError("no_season", "this room has no current season");
  // Reads only, with the hub desk's own seats: the directory and each season.
  const skipped: SweepSkip[] = [];
  await syncMission(ctx, requireSeat(ctx, hub.directory_mission_id, "mission.read", 0, "; run hub seat directory").seat);
  const readable: SeasonRow[] = [];
  for (const season of seasons) {
    const seat = liveSeat(ctx, season.mission_id, "mission.read");
    if (seat === null) {
      if (roomFilter !== null) throw new LobbyError("no_seat", `the hub's seat in this season has lapsed; run hub seat ${season.room_id}`);
      skipped.push({ source: `season:${season.mission_id}`, room_id: season.room_id, identity_id: null, reason: "hub_seat_lapsed" });
      continue;
    }
    await syncMission(ctx, seat);
    readable.push(season);
  }
  const seasonOfRoom = new Map(readable.map((season) => [season.room_id, season]));
  const notes: NoteEntry[] = [hub.directory_mission_id, ...readable.map((season) => season.mission_id)]
    .flatMap((missionId) => fleetView(ctx, missionId, doorOf(hub)).deskNotes);

  const candidates = new Map<string, Candidate>();
  const leaves = new Map<string, SweepLeave>();
  let expired = 0;
  const skip = (source: string, roomId: string | null, identityId: string | null, reason: string) => {
    skipped.push({ source, room_id: roomId, identity_id: identityId, reason });
  };
  for (const entry of notes) {
    const body = entry.envelope.body;
    const season = seasonOfRoom.get(body.room_id);
    if (season === undefined) continue; // another room, or one this sweep does not cover
    if (entry.envelope.kind === "leave" && fleet.processedNote(entry.event.event_id) !== null) continue;
    if (entry.envelope.kind === "renew" && tokenBlocker(ctx, (body as RenewBody).token_sha256) === "renewed") continue;
    const source = `event:${entry.event.event_id}`;
    const forgery = noteForgery(ctx, entry);
    if (forgery !== null) {
      skip(source, body.room_id, null, forgery);
      continue;
    }
    if (entry.event.mission_id !== season.mission_id && entry.event.mission_id !== hub.directory_mission_id) {
      skip(source, body.room_id, body.identity_id, "posted_elsewhere");
      continue;
    }
    if (body.mission_id !== season.mission_id) {
      skip(source, body.room_id, body.identity_id, "season_changed");
      continue;
    }
    const memberRow = fleet.member(season.mission_id, body.identity_id);
    if (entry.envelope.kind === "leave") {
      if (memberRow === null || (memberRow.state ?? "active") !== "active") continue;
      // A leave signed before this membership began belongs to an earlier one.
      if (Date.parse(body.issued_at) < Date.parse(memberRow.admitted_at) - 5 * 60_000) continue;
      leaves.set(`${body.room_id}:${body.identity_id}`, { event_id: entry.event.event_id, room_id: body.room_id, season, identity_id: body.identity_id });
      continue;
    }
    const renew = body as RenewBody;
    if (Date.parse(renew.expires_at) <= now.getTime()) {
      expired += 1;
      continue;
    }
    const blocker = tokenBlocker(ctx, renew.token_sha256) ?? renewBlocker(ctx, ctx.store.getRoom(renew.room_id), season, memberRow, now);
    if (blocker !== null) {
      skip(source, renew.room_id, renew.identity_id, blocker);
      continue;
    }
    const key = `${renew.room_id}:${renew.identity_id}`;
    const previous = candidates.get(key);
    if (previous !== undefined && previous.entry !== null
      && Date.parse((previous.entry.envelope.body as RenewBody).issued_at) >= Date.parse(renew.issued_at)) {
      skip(source, renew.room_id, renew.identity_id, "superseded");
      continue;
    }
    if (previous?.entry != null) skip(`event:${previous.entry.event.event_id}`, renew.room_id, renew.identity_id, "superseded");
    candidates.set(key, { basis: "request", entry, room_id: renew.room_id, season, member: memberRow!, token_sha256: renew.token_sha256, posted_to: entry.event.mission_id });
  }
  if (input.hashes !== undefined) {
    const season = seasonOfRoom.get(input.hashes.room_id);
    if (season === undefined) throw new LobbyError("no_season", "the hash list's room has no readable current season");
    for (const listed of input.hashes.entries) {
      const memberRow = fleet.member(season.mission_id, listed.identity_id);
      const source = `list:${listed.identity_id}`;
      const blocker = tokenBlocker(ctx, listed.token_sha256) ?? renewBlocker(ctx, ctx.store.getRoom(season.room_id), season, memberRow, now);
      if (blocker !== null) {
        skip(source, season.room_id, listed.identity_id, blocker);
        continue;
      }
      const key = `${season.room_id}:${listed.identity_id}`;
      const previous = candidates.get(key);
      if (previous?.entry != null) skip(`event:${previous.entry.event.event_id}`, season.room_id, listed.identity_id, "superseded_by_list");
      candidates.set(key, { basis: "list", entry: null, room_id: season.room_id, season, member: memberRow!, token_sha256: listed.token_sha256, posted_to: season.mission_id });
    }
  }
  // A member who left is not renewed in the same sweep.
  for (const key of leaves.keys()) {
    const candidate = candidates.get(key);
    if (candidate === undefined) continue;
    candidates.delete(key);
    skip(candidate.entry === null ? `list:${candidate.member.identity_id}` : `event:${candidate.entry.event.event_id}`, candidate.room_id,
      candidate.member.identity_id, "member_left");
  }

  const needsDoor = candidates.size > 0 || leaves.size > 0;
  const signer = needsDoor ? signerOf(hub, await doorKey(ctx, hub)) : null;
  const renewals: SweepRenewal[] = [];
  for (const candidate of candidates.values()) {
    const device: HubDeviceRow | null = fleet.device(candidate.member.identity_id);
    const room = ctx.store.getRoom(candidate.room_id)!;
    const source = candidate.entry === null ? `list:${candidate.member.identity_id}` : `event:${candidate.entry.event.event_id}`;
    if (device === null) {
      skip(source, candidate.room_id, candidate.member.identity_id, "member_key_unknown");
      continue;
    }
    const seat = liveSeat(ctx, candidate.posted_to, "mission.observe", 5 * 60_000);
    if (seat === null) {
      skip(source, candidate.room_id, candidate.member.identity_id,
        candidate.posted_to === hub.directory_mission_id ? "hub_directory_seat_lapsed" : "hub_seat_lapsed");
      continue;
    }
    const issue: GrantIssue = {
      grant_id: newUuid(),
      identity_id: device.identity_id,
      signing_key_id: device.signing_key_id,
      actions: actionsFor(candidate.member.tier),
      expires_at: earliest(now.getTime() + DAY_MS - CLOCK_MARGIN_MS, candidate.member.term_ends_at, candidate.season.expires_at),
      token_sha256: candidate.token_sha256,
    };
    const notice: RenewalBody = {
      room_id: candidate.room_id,
      tier: candidate.member.tier,
      term_ends_at: candidate.member.term_ends_at,
      invitation: {
        mission_id: candidate.season.mission_id,
        grant_id: issue.grant_id,
        identity_id: issue.identity_id,
        signing_key_id: issue.signing_key_id,
        public_key_hex: publicKeyHexOf(device.public_key),
        expires_at: issue.expires_at,
        token_sha256: issue.token_sha256,
      },
      issued_at: now.toISOString(),
    };
    const summary = sealDocument("renewal", notice, signer!).summary;
    renewals.push({
      basis: candidate.basis,
      request_event_id: candidate.entry?.event.event_id ?? null,
      request_sha256: candidate.entry === null ? null : documentSha256(candidate.entry.summary),
      room_id: candidate.room_id,
      season: candidate.season,
      identity_id: issue.identity_id,
      issue,
      notice,
      // renewBlocker checked that the room is still fleet, hostable, private and not device-pinned.
      post: preparePost(ctx, "renewal", candidate.posted_to, summary, gateOfRoom(room)),
      seat,
    });
  }
  const rosters: RosterPosts[] = [];
  const leaveList = [...leaves.values()];
  for (const season of readable) {
    const leaving = leaveList.filter((leave) => leave.season.mission_id === season.mission_id).map((leave) => leave.identity_id);
    if (leaving.length === 0) continue;
    const room = ctx.store.getRoom(season.room_id);
    const seat = liveSeat(ctx, season.mission_id, "mission.observe", 5 * 60_000);
    if (room === null || seat === null) continue;
    try {
      requireFleetRoom(ctx, room.room_id);
    } catch {
      continue;
    }
    rosters.push(rosterPosts(ctx, keyedRosterFor(ctx, season, now, { remove: leaving }), signer!, room, seat));
  }
  const at = now.toISOString();
  const preview = actPreview("hub.renew.sweep", roomFilter ?? "all-rooms", at, [
    ...renewals.map((renewal) => `renew did:at:${renewal.identity_id} in ${renewal.room_id}: grant ${renewal.issue.grant_id} ` +
      `${renewal.issue.actions.join("+")} until ${renewal.issue.expires_at} (term ends ${renewal.notice.term_ends_at}); ` +
      `${renewal.basis === "list" ? "token hash from the supplied list" : `request ${renewal.request_event_id}`}; notice to ${renewal.post.mission_id}`),
    ...leaveList.map((leave) => `did:at:${leave.identity_id} left ${leave.room_id} (notice ${leave.event_id}): dropped from the roster`),
    ...rosters.map((item) => `post keyed roster #${item.roster.roster_seq} (${item.roster.members.length} members) to ${item.roster.mission_id}`),
    ...skipped.map((item) => `skip ${item.source}${item.identity_id === null ? "" : ` did:at:${item.identity_id}`}: ${item.reason}`),
    ...(expired > 0 ? [`ignore ${expired} expired renew request(s)`] : []),
  ], {
    rooms: readable.map((season) => ({ room_id: season.room_id, mission_id: season.mission_id })),
    renewals: renewals.map((renewal) => ({
      room_id: renewal.room_id,
      basis: renewal.basis,
      request_event_id: renewal.request_event_id,
      request_sha256: renewal.request_sha256,
      grant: { mission_id: renewal.season.mission_id, ...renewal.issue },
      notice: { mission_id: renewal.post.mission_id, event_id: renewal.post.event_id, summary: renewal.post.summary },
    })),
    leaves: leaveList.map((leave) => ({ room_id: leave.room_id, mission_id: leave.season.mission_id, identity_id: leave.identity_id, event_id: leave.event_id })),
    rosters: rosters.map(rosterRecord),
    skipped,
  });
  return { preview, renewals, leaves: leaveList, rosters, skipped, expired_requests: expired };
}

export interface SweepRenewalOutcome {
  identity_id: string;
  room_id: string;
  grant_id: string;
  status: "renewed" | "uncertain" | "refused";
  grant_expires_at?: string;
  notice?: PostOutcome;
  invitation_template?: Record<string, string>;
  error?: string;
}

export async function executeRenewSweep(ctx: FleetContext, plan: SweepPlan): Promise<{ renewals: SweepRenewalOutcome[]; leaves: number; rosters: PostOutcome[] }> {
  const hub = requireLiveHub(ctx);
  const fleet = ctx.store.fleet;
  const at = ctx.now().toISOString();
  // Leaves are recorded first: they need no network and stop renewals at once.
  fleet.transaction(() => {
    for (const leave of plan.leaves) {
      fleet.setMemberState(leave.season.mission_id, leave.identity_id, "left", at);
      fleet.addProcessedNote({ event_id: leave.event_id, kind: "leave", identity_id: leave.identity_id, outcome: "left", processed_at: at });
    }
    for (const item of plan.rosters) {
      recordKeyedRoster(ctx, item.roster);
      for (const { post, seat } of item.posts) queuePost(ctx, post, seat);
    }
  });
  const outcomes: SweepRenewalOutcome[] = [];
  if (plan.renewals.length > 0) {
    const admin = await adminClient(ctx, hub);
    for (const renewal of plan.renewals) {
      fleet.addHubGrant({ ...renewal.issue, mission_id: renewal.season.mission_id, purpose: "season", room_id: renewal.room_id, state: "requested", requested_at: at });
      const base = { identity_id: renewal.identity_id, room_id: renewal.room_id, grant_id: renewal.issue.grant_id };
      try {
        const grant = await admin.issueGrant(renewal.season.mission_id, renewal.issue);
        fleet.transaction(() => {
          fleet.markHubGrantIssued(grant.grant_id, grant.expires_at);
          fleet.addRenewal({
            token_sha256: renewal.issue.token_sha256,
            room_id: renewal.room_id,
            mission_id: renewal.season.mission_id,
            identity_id: renewal.identity_id,
            grant_id: grant.grant_id,
            basis: renewal.basis,
            request_event_id: renewal.request_event_id,
            note_event_id: renewal.post.event_id,
            renewed_at: at,
          });
          queuePost(ctx, renewal.post, renewal.seat);
        });
        outcomes.push({
          ...base,
          status: "renewed",
          grant_expires_at: grant.expires_at,
          notice: await sendPost(ctx, renewal.post, renewal.seat),
          invitation_template: invitationTemplateOf(renewal.notice),
        });
      } catch (error) {
        outcomes.push({ ...base, ...failureOf(error) });
      }
    }
  }
  const rosters = await sendAll(ctx, plan.rosters.flatMap((item) => item.posts));
  recordOutcome(ctx, "hub.renew.sweep", plan.preview.subject, {
    renewals: outcomes.map(({ invitation_template: _template, notice, ...rest }) => ({ ...rest, notice: notice?.status ?? null })),
    leaves: plan.leaves.map((leave) => ({ room_id: leave.room_id, identity_id: leave.identity_id })),
    rosters: rosters.map((post) => ({ event_id: post.event_id, status: post.status })),
  });
  return { renewals: outcomes, leaves: plan.leaves.length, rosters };
}

// ── members ────────────────────────────────────────────────────────────

export interface MemberListing {
  room_id: string;
  season: { mission_id: string; mission_digest: string; expires_at: string; mode: string } | null;
  members: Array<{
    identity_id: string;
    fingerprint: string | null;
    display_name: string | null;
    tier: SlotTier;
    state: string;
    term_ends_at: string;
    paused_at: string | null;
    admitted_at: string;
    latest_grant: { grant_id: string; expires_at: string; state: string; revoke_state: string | null } | null;
  }>;
  blocked: Array<{ identity_id: string; blocked_at: string }>;
}

export function hubMembers(ctx: FleetContext, input: { room_id: string }): MemberListing {
  requireHub(ctx);
  const fleet = ctx.store.fleet;
  const roomId = assertRoomId(input.room_id);
  const season = fleet.currentSeason(roomId);
  const grants = fleet.listHubGrants();
  return {
    room_id: roomId,
    season: season === null ? null : { mission_id: season.mission_id, mission_digest: season.mission_digest, expires_at: season.expires_at, mode: season.mode },
    members: season === null ? [] : fleet.members(season.mission_id).map((row) => {
      const device = fleet.device(row.identity_id);
      const latest = grants.filter((grant) => grant.identity_id === row.identity_id && grant.mission_id === season.mission_id)
        .sort((left, right) => left.expires_at < right.expires_at ? 1 : -1)[0];
      return {
        identity_id: row.identity_id,
        fingerprint: device?.fingerprint ?? null,
        display_name: device?.display_name ?? null,
        tier: row.tier,
        state: row.state ?? "active",
        term_ends_at: row.term_ends_at,
        paused_at: row.paused_at ?? null,
        admitted_at: row.admitted_at,
        latest_grant: latest === undefined ? null
          : { grant_id: latest.grant_id, expires_at: latest.expires_at, state: latest.state, revoke_state: latest.revoke_state ?? null },
      };
    }),
    blocked: fleet.listBlocks().filter((block) => block.room_id === roomId).map((block) => ({ identity_id: block.identity_id, blocked_at: block.blocked_at })),
  };
}

export interface MemberAddPlan {
  preview: ActPreview;
  season: SeasonRow;
  device: HubDeviceRow;
  newDevice: boolean;
  member: MemberRow;
  extraGrants: string[];
  rosters: RosterPosts;
}

/** Record an existing member of a season run by hand (an adopted mission),
 * so renewal, the roster, kick and the digest know them. Their key is taken
 * from the hub's device registry, or typed at this terminal from the
 * member's own device; it never comes from room content. */
export async function planMemberAdd(ctx: FleetContext, input: {
  room_id: string;
  identity_id: string;
  tier: SlotTier;
  key_id?: string;
  public_key?: string;
  term_days?: number;
  grant_ids?: string[];
}): Promise<MemberAddPlan> {
  const hub = requireLiveHub(ctx);
  const desk = requireHubDesk(ctx);
  requireKeychain(ctx);
  const fleet = ctx.store.fleet;
  const room = requireFleetRoom(ctx, input.room_id);
  const season = requireSeason(ctx, room.room_id);
  const identity = assertUuid(input.identity_id, "identity_id");
  const tier = oneOf(input.tier, SLOT_TIERS, "tier");
  const now = ctx.now();
  if (identity === desk.identity_id) throw new LobbyError("host_is_seated", "this hub desk is the room's host already");
  if (fleet.isBlocked(room.room_id, identity)) throw new LobbyError("blocked", "this identity is blocked from this room; run hub unblock first");
  const existing = fleet.member(season.mission_id, identity);
  if (existing !== null && (existing.state ?? "active") === "active" && Date.parse(existing.term_ends_at) > now.getTime()) {
    throw new LobbyError("already_member", "this identity is already an active member of the season");
  }
  const known = fleet.device(identity);
  let device: HubDeviceRow;
  let newDevice = false;
  if (known !== null) {
    if ((input.key_id !== undefined && input.key_id !== known.signing_key_id) || (input.public_key !== undefined && input.public_key !== known.public_key)) {
      throw new LobbyError("identity_conflict", "the hub recorded another key for this identity; nothing was changed");
    }
    device = known;
  } else {
    if (input.key_id === undefined || input.public_key === undefined) {
      throw new LobbyError("key_required", "this identity is not enrolled through this hub: give --key-id and --public-key, read from the member's own device");
    }
    rawPublicKey(input.public_key);
    const fingerprint = publicKeyFingerprint(input.public_key);
    if (fleet.deviceByFingerprint(fingerprint) !== null) throw new LobbyError("key_reused", "this public key already belongs to another recorded desk");
    device = {
      identity_id: identity,
      signing_key_id: assertUuid(input.key_id, "key_id"),
      public_key: input.public_key,
      fingerprint,
      display_name: "member added by hand",
      enrolled_at: now.toISOString(),
    };
    newDevice = true;
  }
  let termEnds = season.expires_at;
  if (input.term_days !== undefined) {
    if (!Number.isInteger(input.term_days) || input.term_days < 1 || input.term_days > 30) {
      throw new LobbyError("invalid_term", "a term is 1-30 whole days, and never past the season");
    }
    termEnds = earliest(now.getTime() + input.term_days * DAY_MS, season.expires_at);
  }
  const extraGrants = [...new Set((input.grant_ids ?? []).map((id) => assertUuid(id, "grant_id")))];
  const member: MemberRow = {
    mission_id: season.mission_id,
    room_id: room.room_id,
    identity_id: identity,
    tier,
    term_ends_at: termEnds,
    knock_id: "none",
    grant_id: "none",
    admitted_at: now.toISOString(),
  };
  const seat = requireSeat(ctx, season.mission_id, "mission.observe", 5 * 60_000, `; run hub seat ${room.room_id}`).seat;
  const roster = keyedRosterFor(ctx, season, now, {
    add: { identity_id: identity, tier, term_ends_at: termEnds, key: { signing_key_id: device.signing_key_id, public_key: device.public_key } },
  });
  const rosters = rosterPosts(ctx, roster, signerOf(hub, await doorKey(ctx, hub)), room, seat);
  const preview = actPreview("hub.member.add", room.room_id, now.toISOString(), [
    `room ${room.room_id} ${JSON.stringify(room.title)} season ${season.mission_id} (${season.mode})`,
    `member ${device.fingerprint} did:at:${identity} key ${device.signing_key_id} (${newDevice ? "typed here; recorded as a hand-added desk" : "already recorded by this hub"})`,
    `tier ${tier}; term ends ${termEnds}; renewal by hub renew-sweep (requests or a hash list)`,
    ...(extraGrants.length === 0 ? [] : [`register hand-issued grants for kick and stop: ${extraGrants.join(", ")}`]),
    `post keyed roster #${roster.roster_seq} (${roster.members.length} members) to the season`,
  ], {
    room_id: room.room_id,
    mission_id: season.mission_id,
    member: { identity_id: identity, signing_key_id: device.signing_key_id, public_key: device.public_key, fingerprint: device.fingerprint, tier, term_ends_at: termEnds, new_device: newDevice },
    extra_grant_ids: extraGrants,
    roster: rosterRecord(rosters),
  });
  return { preview, season, device, newDevice, member, extraGrants, rosters };
}

export async function executeMemberAdd(ctx: FleetContext, plan: MemberAddPlan): Promise<PostOutcome[]> {
  const fleet = ctx.store.fleet;
  const at = ctx.now().toISOString();
  fleet.transaction(() => {
    if (plan.newDevice) fleet.addDevice(plan.device);
    fleet.addMember(plan.member);
    for (const grantId of plan.extraGrants) {
      fleet.addExtraGrant({ grant_id: grantId, mission_id: plan.season.mission_id, room_id: plan.season.room_id, identity_id: plan.member.identity_id, recorded_at: at });
    }
    recordKeyedRoster(ctx, plan.rosters.roster);
    for (const { post, seat } of plan.rosters.posts) queuePost(ctx, post, seat);
  });
  return sendAll(ctx, plan.rosters.posts);
}

export interface PausePlan {
  preview: ActPreview;
  season: SeasonRow;
  identity_id: string;
  pause: boolean;
}

/** Pause or resume one member's renewal. A paused member keeps the grant it
 * holds until that grant expires; the sweep issues no next one. */
export function planMemberPause(ctx: FleetContext, input: { room_id: string; identity_id: string; pause: boolean }): PausePlan {
  if (input.pause) requireHub(ctx);
  else requireLiveHub(ctx);
  const roomId = assertRoomId(input.room_id);
  const season = ctx.store.fleet.currentSeason(roomId);
  if (season === null) throw new LobbyError("no_season", "this room has no current season");
  const identity = assertUuid(input.identity_id, "identity_id");
  const row = ctx.store.fleet.member(season.mission_id, identity);
  if (row === null) throw new LobbyError("not_a_member", "no such member in the room's current season");
  if (input.pause === (row.paused_at != null)) throw new LobbyError(input.pause ? "already_paused" : "not_paused", `this member is ${input.pause ? "already" : "not"} paused`);
  const at = ctx.now().toISOString();
  const preview = actPreview(input.pause ? "hub.member.pause" : "hub.member.resume", roomId, at, [
    `room ${roomId} season ${season.mission_id}; member did:at:${identity}`,
    input.pause ? "pause renewal: the current grant runs out and is not renewed" : "resume renewal inside the term",
  ], { room_id: roomId, mission_id: season.mission_id, identity_id: identity, paused: input.pause });
  return { preview, season, identity_id: identity, pause: input.pause };
}

export function executeMemberPause(ctx: FleetContext, plan: PausePlan): void {
  ctx.store.fleet.setMemberPaused(plan.season.mission_id, plan.identity_id, plan.pause ? plan.preview.at : null);
}

// ── roster post ────────────────────────────────────────────────────────

export interface RosterPostPlan {
  preview: ActPreview;
  rosters: RosterPosts;
}

/** Sign and post the season's current keyed roster (for example after an
 * upgrade, or for an adopted season whose members were added by hand). */
export async function planRosterPost(ctx: FleetContext, input: { room_id: string }): Promise<RosterPostPlan> {
  const hub = requireLiveHub(ctx);
  requireHubDesk(ctx);
  const room = requireFleetRoom(ctx, input.room_id);
  const season = requireSeason(ctx, room.room_id);
  const seat = requireSeat(ctx, season.mission_id, "mission.observe", 5 * 60_000, `; run hub seat ${room.room_id}`).seat;
  const now = ctx.now();
  const roster = keyedRosterFor(ctx, season, now);
  const rosters = rosterPosts(ctx, roster, signerOf(hub, await doorKey(ctx, hub)), room, seat);
  const preview = actPreview("hub.roster.post", room.room_id, now.toISOString(), [
    `room ${room.room_id} ${JSON.stringify(room.title)} season ${season.mission_id}`,
    `keyed roster #${roster.roster_seq}: ${roster.members.map((item) => `${item.role} did:at:${item.identity_id} (${item.tier})`).join(", ")}`,
    "every member pins these keys to verify table talk; the service can read it too",
  ], { room_id: room.room_id, roster: rosterRecord(rosters) });
  return { preview, rosters };
}

export async function executeRosterPost(ctx: FleetContext, plan: RosterPostPlan): Promise<PostOutcome[]> {
  ctx.store.fleet.transaction(() => {
    recordKeyedRoster(ctx, plan.rosters.roster);
    for (const { post, seat } of plan.rosters.posts) queuePost(ctx, post, seat);
  });
  return sendAll(ctx, plan.rosters.posts);
}

// ── kick and block ─────────────────────────────────────────────────────

export interface Revocation {
  mission_id: string;
  grant_id: string;
  source: "hub" | "registered" | "named";
}

export interface RemovalPlan {
  preview: ActPreview;
  block: boolean;
  room_id: string;
  identity_id: string;
  season: SeasonRow | null;
  member: MemberRow | null;
  revocations: Revocation[];
  rosters: RosterPosts | null;
}

function revokeRequest(revocation: Revocation) {
  return { mission_id: revocation.mission_id, grant_id: revocation.grant_id, request: `POST ${MISSIONS_PATH}/${revocation.mission_id}/grants/${revocation.grant_id}/revoke`, body_bytes: 0 };
}

/** Kick (revoke the member's grants in this room, mark them kicked, post a
 * roster without them) or block (the same, and refuse their future knocks
 * on this room). Works after an emergency stop and on a room since narrowed
 * to the device: revocations carry no text; only the roster post needs the
 * room to still be a fleet room. */
export async function planRemoval(ctx: FleetContext, input: { room_id: string; identity_id: string; block: boolean; grant_ids?: string[] }): Promise<RemovalPlan> {
  const hub = requireHub(ctx);
  const desk = requireHubDesk(ctx);
  requireKeychain(ctx);
  const fleet = ctx.store.fleet;
  const roomId = assertRoomId(input.room_id);
  const room = ctx.store.getRoom(roomId);
  if (room === null) throw new LobbyError("room_not_found", "no such room in this hub's local hall");
  const identity = assertUuid(input.identity_id, "identity_id");
  if (identity === desk.identity_id) throw new LobbyError("cannot_remove_host", "the hub desk hosts the room; it cannot kick or block itself");
  const now = ctx.now();
  const seasons = fleet.seasonsOfRoom(roomId);
  const missions = seasons.map((season) => season.mission_id);
  const season = fleet.currentSeason(roomId);
  const member = season === null ? null : fleet.member(season.mission_id, identity);
  const revocations: Revocation[] = [];
  const seen = new Set<string>();
  const add = (revocation: Revocation) => {
    if (seen.has(revocation.grant_id)) return;
    seen.add(revocation.grant_id);
    revocations.push(revocation);
  };
  for (const grant of fleet.hubGrantsOf(identity, missions)) {
    if (grant.purpose === "season" && grant.revoke_state !== "revoked" && Date.parse(grant.expires_at) > now.getTime()) {
      add({ mission_id: grant.mission_id, grant_id: grant.grant_id, source: "hub" });
    }
  }
  for (const grant of fleet.listExtraGrants()) {
    if (grant.identity_id === identity && grant.room_id === roomId && grant.revoke_state !== "revoked") {
      add({ mission_id: grant.mission_id, grant_id: grant.grant_id, source: "registered" });
    }
  }
  for (const grantId of input.grant_ids ?? []) {
    if (season === null) throw new LobbyError("no_season", "a named grant is revoked in the room's current season, and it has none");
    add({ mission_id: season.mission_id, grant_id: assertUuid(grantId, "grant_id"), source: "named" });
  }
  const activeMember = member !== null && (member.state ?? "active") === "active";
  const alreadyBlocked = fleet.isBlocked(roomId, identity);
  if (!activeMember && revocations.length === 0 && (!input.block || alreadyBlocked)) {
    throw new LobbyError(input.block ? "already_blocked" : "not_a_member", input.block
      ? "this identity is already blocked from this room and holds no grant here to revoke"
      : "this identity is not an active member of the room and holds no grant here to revoke");
  }
  let rosters: RosterPosts | null = null;
  let rosterNote = "no roster post: the identity is not on the current roster";
  if (activeMember && season !== null) {
    const seat = liveSeat(ctx, season.mission_id, "mission.observe", 5 * 60_000);
    let fleetRoom: RoomCard | null = null;
    try {
      fleetRoom = requireFleetRoom(ctx, roomId);
    } catch {
      fleetRoom = null;
    }
    if (fleetRoom === null) rosterNote = "no roster post: the room is no longer a hostable fleet room";
    else if (seat === null) rosterNote = `no roster post: the hub's season seat has lapsed (hub seat ${roomId}, then hub roster post ${roomId})`;
    else {
      rosters = rosterPosts(ctx, keyedRosterFor(ctx, season, now, { remove: [identity] }), signerOf(hub, await doorKey(ctx, hub)), fleetRoom, seat);
      rosterNote = `post keyed roster #${rosters.roster.roster_seq} without them (${rosters.roster.members.length} members)`;
    }
  }
  const act = input.block ? "hub.block" : "hub.kick";
  const device = fleet.device(identity);
  const preview = actPreview(act, roomId, now.toISOString(), [
    `${input.block ? "block" : "kick"} ${device?.fingerprint ?? "(unrecorded desk)"} did:at:${identity} from room ${roomId} ${JSON.stringify(room.title)}`,
    activeMember ? `membership ${member!.tier} until ${member!.term_ends_at} ends now (${input.block ? "blocked" : "kicked"})` : "not an active member",
    ...revocations.map((revocation) => `revoke grant ${revocation.grant_id} in ${revocation.mission_id} (${revocation.source}): POST .../grants/<id>/revoke, zero body bytes`),
    ...(input.block ? [alreadyBlocked ? "already blocked: future knocks on this room stay refused" : "record a block: future knocks from this DID on this room are refused"] : []),
    rosterNote,
  ], {
    room_id: roomId,
    identity_id: identity,
    did: `did:at:${identity}`,
    block: input.block,
    member_state_before: member?.state ?? null,
    revocations: revocations.map(revokeRequest),
    roster: rosters === null ? null : rosterRecord(rosters),
  });
  return { preview, block: input.block, room_id: roomId, identity_id: identity, season, member, revocations, rosters };
}

export interface RevocationOutcome {
  mission_id: string;
  grant_id: string;
  status: "revoked" | "uncertain" | "refused";
  revoked_at?: string;
  error?: string;
}

async function revokeGrants(ctx: FleetContext, hub: HubRow, revocations: readonly Revocation[]): Promise<RevocationOutcome[]> {
  if (revocations.length === 0) return [];
  const fleet = ctx.store.fleet;
  const admin = await adminClient(ctx, hub);
  const issued = new Set(fleet.listHubGrants().map((grant) => grant.grant_id));
  const extra = new Set(fleet.listExtraGrants().map((grant) => grant.grant_id));
  const mark = (grantId: string, state: "requested" | "revoked", at: string | null) => {
    if (issued.has(grantId)) fleet.markHubGrantRevoke(grantId, state, at);
    if (extra.has(grantId)) fleet.markExtraGrantRevoke(grantId, state, at);
  };
  const outcomes: RevocationOutcome[] = [];
  for (const revocation of revocations) {
    mark(revocation.grant_id, "requested", null);
    try {
      const grant = await admin.revokeGrant(revocation.mission_id, revocation.grant_id);
      mark(revocation.grant_id, "revoked", grant.revoked_at);
      outcomes.push({ mission_id: revocation.mission_id, grant_id: revocation.grant_id, status: "revoked", revoked_at: grant.revoked_at! });
    } catch (error) {
      outcomes.push({ mission_id: revocation.mission_id, grant_id: revocation.grant_id, ...failureOf(error) });
    }
  }
  return outcomes;
}

export async function executeRemoval(ctx: FleetContext, plan: RemovalPlan): Promise<{ revocations: RevocationOutcome[]; rosters: PostOutcome[] }> {
  const hub = requireHub(ctx);
  const fleet = ctx.store.fleet;
  const at = ctx.now().toISOString();
  // Local records first: the block refuses knocks and the state stops
  // renewals even if every network call then fails.
  fleet.transaction(() => {
    if (plan.block) fleet.block(plan.room_id, plan.identity_id, at);
    if (plan.season !== null && plan.member !== null && (plan.member.state ?? "active") === "active") {
      fleet.setMemberState(plan.season.mission_id, plan.identity_id, plan.block ? "blocked" : "kicked", at);
    }
    if (plan.rosters !== null) {
      recordKeyedRoster(ctx, plan.rosters.roster);
      for (const { post, seat } of plan.rosters.posts) queuePost(ctx, post, seat);
    }
  });
  const revocations = await revokeGrants(ctx, hub, plan.revocations);
  const rosters = plan.rosters === null ? [] : await sendAll(ctx, plan.rosters.posts);
  recordOutcome(ctx, plan.block ? "hub.block" : "hub.kick", plan.room_id, {
    identity_id: plan.identity_id,
    revocations,
    rosters: rosters.map((post) => ({ event_id: post.event_id, status: post.status })),
  });
  return { revocations, rosters };
}

export interface UnblockPlan {
  preview: ActPreview;
  room_id: string;
  identity_id: string;
}

export function planUnblock(ctx: FleetContext, input: { room_id: string; identity_id: string }): UnblockPlan {
  requireLiveHub(ctx);
  const roomId = assertRoomId(input.room_id);
  const identity = assertUuid(input.identity_id, "identity_id");
  if (!ctx.store.fleet.isBlocked(roomId, identity)) throw new LobbyError("not_blocked", "this identity is not blocked from this room");
  const preview = actPreview("hub.unblock", roomId, ctx.now().toISOString(), [
    `unblock did:at:${identity} on room ${roomId}: their knocks are assessed again`,
    "this restores no membership and no grant; admission still needs hub admit",
  ], { room_id: roomId, identity_id: identity });
  return { preview, room_id: roomId, identity_id: identity };
}

export function executeUnblock(ctx: FleetContext, plan: UnblockPlan): void {
  ctx.store.fleet.unblock(plan.room_id, plan.identity_id);
}

// ── emergency stop ─────────────────────────────────────────────────────

export interface StopPlan {
  preview: ActPreview;
  missions: Array<{ mission_id: string; kind: "directory" | "season"; mode: "created" | "adopted"; room_id: string | null }>;
  grants: Revocation[];
  manual_step: string;
}

/** The manual step the stop prints. The desk never calls /v1/keys. */
export function manualRotationStep(hub: HubRow): string {
  return [
    "MANUAL STEP FOR THE OWNER (this desk never does it): rotate the API key that issued the lobby grants.",
    `  This hub's bearer is the Keychain item service ${hub.bearer_service}, account ${hub.keychain_account} (its value is never shown).`,
    "  Every mission grant hangs off the API key that issued it, so revoking that key ends every lobby grant at once,",
    "  including any this stop could not reach. From a terminal or the dashboard keys page you control, revoke that key",
    `  (DELETE /v1/keys/<key id> on ${LOBBY_ORIGIN}, or rotate it), never from an agent's tool call. If the lobby is to`,
    "  continue later, store the new bearer in the Keychain yourself (security prompts for it) and start a new hub.",
  ].join("\n");
}

export function planStop(ctx: FleetContext, input: { include_adopted: boolean }): StopPlan {
  const hub = requireHub(ctx);
  requireKeychain(ctx);
  const fleet = ctx.store.fleet;
  const now = ctx.now();
  const missions: StopPlan["missions"] = [];
  for (const season of fleet.listSeasons()) {
    if (season.revoked_at != null || (season.mode === "adopted" && !input.include_adopted)) continue;
    missions.push({ mission_id: season.mission_id, kind: "season", mode: season.mode, room_id: season.room_id });
  }
  if (hub.directory_revoked_at == null && (hub.directory_mode === "created" || input.include_adopted)) {
    missions.push({ mission_id: hub.directory_mission_id, kind: "directory", mode: hub.directory_mode, room_id: null });
  }
  const grants: Revocation[] = fleet.listHubGrants()
    .filter((grant) => grant.revoke_state !== "revoked" && Date.parse(grant.expires_at) > now.getTime())
    .map((grant) => ({ mission_id: grant.mission_id, grant_id: grant.grant_id, source: "hub" as const }));
  if (input.include_adopted) {
    for (const grant of fleet.listExtraGrants()) {
      if (grant.revoke_state !== "revoked") grants.push({ mission_id: grant.mission_id, grant_id: grant.grant_id, source: "registered" });
    }
  }
  const manual = manualRotationStep(hub);
  const adoptedLeft = fleet.listSeasons().filter((season) => season.mode === "adopted" && season.revoked_at == null).length
    + (hub.directory_mode === "adopted" && hub.directory_revoked_at == null ? 1 : 0);
  const preview = actPreview("hub.stop", hub.project_id, now.toISOString(), [
    "EMERGENCY STOP: this hub issues no more access afterwards (recorded locally first)",
    ...missions.map((mission) => `revoke ${mission.kind} mission ${mission.mission_id} (${mission.mode}): POST .../revoke, zero body bytes`),
    ...grants.map((grant) => `revoke grant ${grant.grant_id} in ${grant.mission_id} (${grant.source}): POST .../grants/<id>/revoke, zero body bytes`),
    ...(!input.include_adopted && adoptedLeft > 0 ? [`${adoptedLeft} adopted mission(s) made by hand are left alone (add --include-adopted to revoke them too)`] : []),
    "then rotate the issuing API key by hand: the exact step is printed after the stop",
  ], {
    include_adopted: input.include_adopted,
    missions: missions.map((mission) => ({ ...mission, request: `POST ${MISSIONS_PATH}/${mission.mission_id}/revoke`, body_bytes: 0 })),
    grants: grants.map(revokeRequest),
    manual_step: "rotate the issuing API key by hand; this desk never calls /v1/keys",
  });
  return { preview, missions, grants, manual_step: manual };
}

export interface StopOutcome {
  missions: Array<{ mission_id: string; kind: string; status: "revoked" | "uncertain" | "refused"; error?: string }>;
  grants: RevocationOutcome[];
  manual_step: string;
}

export async function executeStop(ctx: FleetContext, plan: StopPlan): Promise<StopOutcome> {
  const hub = requireHub(ctx);
  const fleet = ctx.store.fleet;
  fleet.setHubStopped(ctx.now().toISOString());
  const admin = await adminClient(ctx, hub);
  const missions: StopOutcome["missions"] = [];
  // Missions first: revoking a mission stops every grant on it at once.
  for (const mission of plan.missions) {
    try {
      const view = await admin.revokeMission(mission.mission_id);
      if (mission.kind === "directory") fleet.setDirectoryRevoked(view.revoked_at!);
      else fleet.markSeasonRevoked(mission.mission_id, view.revoked_at!);
      missions.push({ mission_id: mission.mission_id, kind: mission.kind, status: "revoked" });
    } catch (error) {
      missions.push({ mission_id: mission.mission_id, kind: mission.kind, ...failureOf(error) });
    }
  }
  const grants = await revokeGrants(ctx, hub, plan.grants);
  recordOutcome(ctx, "hub.stop", hub.project_id, { missions, grants });
  return { missions, grants, manual_step: plan.manual_step };
}
