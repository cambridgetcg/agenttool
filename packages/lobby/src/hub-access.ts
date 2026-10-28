/** Hub side of access after admission: renewal inside the term, members of
 * adopted seasons, the pause flag, keyed roster posts, kick, block, unblock
 * and the emergency stop.
 *
 * Every act here is consequential: a terminal check before planning, the
 * exact bytes on /dev/tty, the audit entry before any network effect, and the
 * project bearer and door key read from the Keychain by this CLI only. On
 * `yes` each act checks the hub's records again before its first network
 * effect (another terminal may have changed them while the prompt was open),
 * and confirmed roster numbers are never re-signed. Grant
 * and mission revocations go through the administrator revoke routes with
 * zero body bytes; nothing here rotates an API key (the stop prints that
 * manual step for the owner). Contract: packages/lobby/README.md#renewal-leave-kick-and-block.
 */
import { LobbyError } from "./errors.js";
import {
  directoryRenewalCandidates,
  directoryRenewalItems,
  directoryRenewalLine,
  directoryRenewalRecord,
  directoryRenewalWithdrawn,
  hubSeatLine,
  hubSeatRecord,
  planHubSeatRenewals,
  type DirectoryRenewalItem,
} from "./directory-renewal.js";
import { AdminClient, mayHaveTakenEffect, type GrantIssue, type GrantView } from "./hosted.js";
import {
  actionsFor,
  adminClient,
  claimBlocker,
  claimKeyedRoster,
  doorKey,
  doorOf,
  executeSeatIssue,
  grantIdClaimants,
  issueRecordedGrant,
  keyedRosterFor,
  keyedRosterPosts,
  noteForgery,
  requireHub,
  requireHubDesk,
  requireLiveHub,
  requireSeason,
  ROSTER_CHANGED_MESSAGE,
  tokenClaimants,
  type KeyedRosterPlan,
  type NoteEntry,
  type SeatIssue,
} from "./hub.js";
import {
  actPreview,
  CLOCK_MARGIN_MS,
  DAY_MS,
  earliest,
  fleetView,
  gateOfRoom,
  hubLiveDirectories,
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
  type RenewalBody,
  type RenewBody,
} from "./signed.js";
import type { ActPreview } from "./store.js";
import type { ParticipantSeat } from "./hosted.js";
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

// ── Renewal checks ─────────────────────────────────────────────────────

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

/** Why a grant for `identityId` may not be bound to this token hash by the
 * hub's own records, or null: it renewed that identity already (`renewed`),
 * or it bound the hash to some grant before (`token_reused`, or
 * `grant_uncertain:<id>` while that grant's outcome is unknown). */
function tokenBlocker(ctx: FleetContext, tokenSha256: string, identityId: string): string | null {
  const renewal = ctx.store.fleet.renewal(tokenSha256);
  if (renewal !== null) return renewal.identity_id === identityId ? "renewed" : "token_reused";
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
  /** The same door-signed notice, posted to the directory (which the member
   * reads with its directory grant even after its room grant lapses) and,
   * when the request was posted in the room, to the room as well. */
  posts: Array<{ post: PreparedPost; seat: Seat }>;
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
  /** `rooms`: room renewals only (`--room` or `--rooms-only`, the sweep as it
   * was before directory renewal). `full`: rooms, every enrolled desk's
   * directory renewal and the hub desk's own seats. `seats_only`: the hub
   * desk's directory seat had lapsed, so nothing was read and only its seats
   * are renewed. */
  mode: "rooms" | "full" | "seats_only";
  renewals: SweepRenewal[];
  leaves: SweepLeave[];
  rosters: RosterPosts[];
  directory_renewals: DirectoryRenewalItem[];
  hub_seats: SeatIssue[];
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

function sweepHeadings(plan: { renewals: SweepRenewal[]; directory_renewals: DirectoryRenewalItem[]; hub_seats: SeatIssue[] },
  mode: SweepPlan["mode"], hub: HubRow): string[] {
  const not = (why: string) => [`  (not in this sweep: ${why})`];
  return [
    `room renewals (${plan.renewals.length}):`,
    ...(mode === "seats_only" ? not("nothing was read") : plan.renewals.map((renewal) => `  renew did:at:${renewal.identity_id} in ${renewal.room_id}: grant ${renewal.issue.grant_id} ` +
      `${renewal.issue.actions.join("+")} until ${renewal.issue.expires_at} (term ends ${renewal.notice.term_ends_at}); ` +
      `${renewal.basis === "list" ? "token hash from the supplied list" : `request ${renewal.request_event_id}`}; ` +
      `notice to ${renewal.posts.map(({ post }) => post.mission_id === renewal.season.mission_id ? `the room ${post.mission_id}`
        : post.mission_id === hub.directory_mission_id ? `the directory ${post.mission_id}` : `the previous directory ${post.mission_id}`).join(" and ")}`)),
    `directory renewals, one per device (${plan.directory_renewals.length}):`,
    ...(mode === "rooms" ? not("--room or --rooms-only") : mode === "seats_only" ? not("nothing was read")
      : plan.directory_renewals.map((item) => `  ${directoryRenewalLine(item)}`)),
    `hub desk seats (${plan.hub_seats.length}):`,
    ...(mode === "rooms" ? not("--room or --rooms-only") : plan.hub_seats.map((seat) => `  ${hubSeatLine(seat, hub.directory_mission_id)}`)),
  ];
}

export async function planRenewSweep(ctx: FleetContext, input: { room_id?: string; hashes?: RenewHashList; rooms_only?: boolean }): Promise<SweepPlan> {
  const hub = requireLiveHub(ctx);
  requireHubDesk(ctx);
  requireKeychain(ctx);
  const fleet = ctx.store.fleet;
  const now = ctx.now();
  if (input.hashes !== undefined && input.room_id !== input.hashes.room_id) {
    throw new LobbyError("hash_list_room", "a hash list names one room; give the same room with --room");
  }
  const roomFilter = input.room_id === undefined ? null : assertRoomId(input.room_id);
  const mode: SweepPlan["mode"] = roomFilter !== null || input.rooms_only === true ? "rooms"
    : liveSeat(ctx, hub.directory_mission_id, "mission.read") === null ? "seats_only" : "full";
  if (mode === "seats_only") {
    // The hub desk cannot read the directory: read nothing, renew its own seats only.
    const hubSeats = planHubSeatRenewals(ctx, hub, now);
    const plan = { renewals: [], directory_renewals: [], hub_seats: hubSeats };
    const preview = actPreview("hub.renew.sweep", "all-rooms", now.toISOString(), [
      "the hub desk's directory seat has lapsed: this sweep reads nothing and renews only the hub desk's own seats; run hub renew-sweep again to read requests",
      ...sweepHeadings(plan, mode, hub),
    ], {
      mode,
      rooms: [],
      renewals: [],
      leaves: [],
      rosters: [],
      directory_renewals: [],
      hub_seats: hubSeats.map(hubSeatRecord),
      skipped: [],
    });
    return { preview, mode, renewals: [], leaves: [], rosters: [], directory_renewals: [], hub_seats: hubSeats, skipped: [], expired_requests: 0 };
  }
  const seasons = fleet.listSeasons().filter((season) => season.state === "current" && season.revoked_at == null
    && Date.parse(season.expires_at) > now.getTime() && (roomFilter === null || season.room_id === roomFilter));
  if (roomFilter !== null && seasons.length === 0) throw new LobbyError("no_season", "this room has no current season");
  // Reads only, with the hub desk's own seats: the directory (during a
  // rollover's overlap the previous one too, while the hub may read it) and each season.
  const skipped: SweepSkip[] = [];
  const directories = hubLiveDirectories(ctx, hub, now);
  const directoryIds = new Set(directories.map((directory) => directory.mission_id));
  await syncMission(ctx, requireSeat(ctx, hub.directory_mission_id, "mission.read", 0, "; run hub seat directory").seat);
  for (const directory of directories.filter((entry) => entry.role === "previous")) {
    const seat = liveSeat(ctx, directory.mission_id, "mission.read");
    if (seat === null) skipped.push({ source: `directory:${directory.mission_id}`, room_id: null, identity_id: null, reason: "hub_seat_lapsed" });
    else await syncMission(ctx, seat);
  }
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
  const notes: NoteEntry[] = [...directoryIds, ...readable.map((season) => season.mission_id)]
    .flatMap((missionId) => fleetView(ctx, missionId, doorOf(hub)).deskNotes);

  // Who claimed each token hash first, across every cached knock, renew note
  // and directory renew note: a desk's copy of another desk's hash never gets
  // a grant bound to it.
  const claimants = tokenClaimants(ctx, hub);

  const candidates = new Map<string, Candidate>();
  const leaves = new Map<string, SweepLeave>();
  let expired = 0;
  const skip = (source: string, roomId: string | null, identityId: string | null, reason: string) => {
    skipped.push({ source, room_id: roomId, identity_id: identityId, reason });
  };
  const sourceOf = (candidate: Candidate) => candidate.entry === null ? `list:${candidate.member.identity_id}` : `event:${candidate.entry.event.event_id}`;
  // The newest authentic request per member and room wins. A request this hub
  // already renewed for that member still counts, so an older one is never
  // renewed after it, in this sweep or a later one.
  type Request = { entry: NoteEntry; season: SeasonRow; renewed: boolean };
  const newest = new Map<string, Request>();
  const older: Array<{ key: string; request: Request }> = [];
  const isNewer = (left: NoteEntry, right: NoteEntry) => {
    const issued = Date.parse(left.envelope.body.issued_at) - Date.parse(right.envelope.body.issued_at);
    return issued !== 0 ? issued > 0 : Date.parse(left.event.received_at) > Date.parse(right.event.received_at);
  };
  for (const entry of notes) {
    const body = entry.envelope.body;
    const season = seasonOfRoom.get(body.room_id);
    if (season === undefined) continue; // another room, or one this sweep does not cover
    if (entry.envelope.kind === "leave" && fleet.processedNote(entry.event.event_id) !== null) continue;
    // A request this hub renewed for the member it names is processed; any copy of it stays quiet.
    const renewedFor = entry.envelope.kind === "renew" ? fleet.renewal((body as RenewBody).token_sha256) : null;
    const renewed = renewedFor !== null && renewedFor.identity_id === body.identity_id && renewedFor.mission_id === body.mission_id;
    const source = `event:${entry.event.event_id}`;
    const forgery = noteForgery(ctx, entry);
    if (forgery !== null) {
      if (!renewed) skip(source, body.room_id, null, forgery);
      continue;
    }
    if (entry.event.mission_id !== season.mission_id && !directoryIds.has(entry.event.mission_id)) {
      if (!renewed) skip(source, body.room_id, body.identity_id, "posted_elsewhere");
      continue;
    }
    if (body.mission_id !== season.mission_id) {
      if (!renewed) skip(source, body.room_id, body.identity_id, "season_changed");
      continue;
    }
    if (entry.envelope.kind === "leave") {
      const memberRow = fleet.member(season.mission_id, body.identity_id);
      if (memberRow === null || (memberRow.state ?? "active") !== "active") continue;
      // A leave signed before this membership began belongs to an earlier one.
      if (Date.parse(body.issued_at) < Date.parse(memberRow.admitted_at) - 5 * 60_000) continue;
      leaves.set(`${body.room_id}:${body.identity_id}`, { event_id: entry.event.event_id, room_id: body.room_id, season, identity_id: body.identity_id });
      continue;
    }
    const key = `${body.room_id}:${body.identity_id}`;
    const request: Request = { entry, season, renewed };
    const current = newest.get(key);
    if (current === undefined) newest.set(key, request);
    else if (isNewer(entry, current.entry)) {
      older.push({ key, request: current });
      newest.set(key, request);
    } else older.push({ key, request });
  }
  for (const { key, request } of older) {
    // Superseded by a request already renewed, or renewed itself: processed, and quiet.
    if (request.renewed || newest.get(key)!.renewed) continue;
    const body = request.entry.envelope.body;
    skip(`event:${request.entry.event.event_id}`, body.room_id, body.identity_id, "superseded");
  }
  for (const [key, request] of newest) {
    if (request.renewed) continue;
    const renew = request.entry.envelope.body as RenewBody;
    const source = `event:${request.entry.event.event_id}`;
    if (Date.parse(renew.expires_at) <= now.getTime()) {
      expired += 1;
      continue;
    }
    const memberRow = fleet.member(request.season.mission_id, renew.identity_id);
    const blocker = claimBlocker(claimants, renew.token_sha256, renew.identity_id) ?? tokenBlocker(ctx, renew.token_sha256, renew.identity_id)
      ?? renewBlocker(ctx, ctx.store.getRoom(renew.room_id), request.season, memberRow, now);
    if (blocker !== null) {
      skip(source, renew.room_id, renew.identity_id, blocker);
      continue;
    }
    candidates.set(key, {
      basis: "request", entry: request.entry, room_id: renew.room_id, season: request.season, member: memberRow!,
      token_sha256: renew.token_sha256, posted_to: request.entry.event.mission_id,
    });
  }
  if (input.hashes !== undefined) {
    const season = seasonOfRoom.get(input.hashes.room_id);
    if (season === undefined) throw new LobbyError("no_season", "the hash list's room has no readable current season");
    for (const listed of input.hashes.entries) {
      const memberRow = fleet.member(season.mission_id, listed.identity_id);
      const source = `list:${listed.identity_id}`;
      const blocker = claimBlocker(claimants, listed.token_sha256, listed.identity_id) ?? tokenBlocker(ctx, listed.token_sha256, listed.identity_id)
        ?? renewBlocker(ctx, ctx.store.getRoom(season.room_id), season, memberRow, now);
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
    skip(sourceOf(candidate), candidate.room_id, candidate.member.identity_id, "member_left");
  }
  // Directory renewals: every enrolled desk's newest request in the directory.
  let directoryCandidates = mode === "full"
    ? directoryRenewalCandidates(ctx, hub, directories, [...directoryIds, ...readable.map((season) => season.mission_id)], now,
      { tokens: claimants, grantIds: grantIdClaimants(ctx, hub) }, (item) => skipped.push(item))
    : { candidates: [], expired: 0 };
  expired += directoryCandidates.expired;
  // One token hash binds one grant: candidates sharing a hash (one desk's
  // requests in two rooms, a request and a listed entry, or a room and a
  // directory request) all wait for a fresh request.
  const byToken = new Map<string, string[]>();
  for (const [key, candidate] of candidates) byToken.set(candidate.token_sha256, [...(byToken.get(candidate.token_sha256) ?? []), key]);
  directoryCandidates.candidates.forEach((candidate, index) => {
    const token = candidate.entry.envelope.body.token_sha256;
    byToken.set(token, [...(byToken.get(token) ?? []), `directory:${index}`]);
  });
  const collided = new Set<number>();
  for (const keys of byToken.values()) {
    if (keys.length < 2) continue;
    for (const key of keys) {
      if (key.startsWith("directory:")) {
        const index = Number(key.slice("directory:".length));
        const entry = directoryCandidates.candidates[index]!.entry;
        collided.add(index);
        skip(`event:${entry.event.event_id}`, null, entry.envelope.body.identity_id, "token_hash_collision");
        continue;
      }
      const candidate = candidates.get(key)!;
      candidates.delete(key);
      skip(sourceOf(candidate), candidate.room_id, candidate.member.identity_id, "token_hash_collision");
    }
  }
  directoryCandidates = { ...directoryCandidates, candidates: directoryCandidates.candidates.filter((_, index) => !collided.has(index)) };

  const needsDoor = candidates.size > 0 || leaves.size > 0 || directoryCandidates.candidates.length > 0;
  const signer = needsDoor ? signerOf(hub, await doorKey(ctx, hub)) : null;
  const renewals: SweepRenewal[] = [];
  for (const candidate of candidates.values()) {
    const device: HubDeviceRow | null = fleet.device(candidate.member.identity_id);
    const room = ctx.store.getRoom(candidate.room_id)!;
    const source = sourceOf(candidate);
    if (device === null) {
      skip(source, candidate.room_id, candidate.member.identity_id, "member_key_unknown");
      continue;
    }
    // The notice always goes to the directory, which the member can read with
    // its directory grant even after its room grant has lapsed (renewal is
    // manual, so the sweep often runs after that); during a rollover's overlap
    // to the previous directory as well, while the hub may post there, for a
    // member that has not moved yet. A request made in the room is answered
    // in the room too, while the hub may post there.
    const directorySeat = liveSeat(ctx, hub.directory_mission_id, "mission.observe", 5 * 60_000);
    if (directorySeat === null) {
      skip(source, candidate.room_id, candidate.member.identity_id, "hub_directory_seat_lapsed");
      continue;
    }
    const previousSeats = directories.filter((directory) => directory.role === "previous")
      .map((directory) => liveSeat(ctx, directory.mission_id, "mission.observe", 5 * 60_000))
      .filter((seat): seat is Seat => seat !== null);
    const seasonSeat = candidate.posted_to === candidate.season.mission_id
      ? liveSeat(ctx, candidate.season.mission_id, "mission.observe", 5 * 60_000) : null;
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
    // renewBlocker checked that the room is still fleet, hostable, private and not device-pinned.
    const gate = gateOfRoom(room);
    renewals.push({
      basis: candidate.basis,
      request_event_id: candidate.entry?.event.event_id ?? null,
      request_sha256: candidate.entry === null ? null : documentSha256(candidate.entry.summary),
      room_id: candidate.room_id,
      season: candidate.season,
      identity_id: issue.identity_id,
      issue,
      notice,
      posts: [
        { post: preparePost(ctx, "renewal", hub.directory_mission_id, summary, gate), seat: directorySeat },
        ...previousSeats.map((seat) => ({ post: preparePost(ctx, "renewal", seat.mission_id, summary, gate), seat })),
        ...(seasonSeat === null ? [] : [{ post: preparePost(ctx, "renewal", candidate.season.mission_id, summary, gate), seat: seasonSeat }]),
      ],
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
  const directoryRenewals = directoryRenewalItems(ctx, hub, directoryCandidates.candidates, now, signer, (item) => skipped.push(item));
  const hubSeats = mode === "full" ? planHubSeatRenewals(ctx, hub, now) : [];
  const at = now.toISOString();
  const preview = actPreview("hub.renew.sweep", roomFilter ?? "all-rooms", at, [
    ...(mode === "full" ? ["this sweep renews room grants, every enrolled device's directory grant it has a request for, and the hub desk's own seats (--rooms-only for room grants alone)"] : []),
    ...sweepHeadings({ renewals, directory_renewals: directoryRenewals, hub_seats: hubSeats }, mode, hub),
    ...leaveList.map((leave) => `did:at:${leave.identity_id} left ${leave.room_id} (notice ${leave.event_id}): dropped from the roster`),
    ...rosters.map((item) => `post keyed roster #${item.roster.roster_seq} (${item.roster.members.length} members) to ${item.roster.mission_id}`),
    ...(skipped.length > 0 ? [`skipped (${skipped.length}):`] : []),
    ...skipped.map((item) => `  skip ${item.source}${item.identity_id === null ? "" : ` did:at:${item.identity_id}`}: ${item.reason}`),
    ...(expired > 0 ? [`ignore ${expired} expired renew request(s)`] : []),
  ], {
    mode,
    rooms: readable.map((season) => ({ room_id: season.room_id, mission_id: season.mission_id })),
    renewals: renewals.map((renewal) => ({
      room_id: renewal.room_id,
      basis: renewal.basis,
      request_event_id: renewal.request_event_id,
      request_sha256: renewal.request_sha256,
      grant: { mission_id: renewal.season.mission_id, ...renewal.issue },
      notices: renewal.posts.map(({ post }) => ({ mission_id: post.mission_id, event_id: post.event_id, summary: post.summary })),
    })),
    leaves: leaveList.map((leave) => ({ room_id: leave.room_id, mission_id: leave.season.mission_id, identity_id: leave.identity_id, event_id: leave.event_id })),
    rosters: rosters.map(rosterRecord),
    directory_renewals: directoryRenewals.map(directoryRenewalRecord),
    hub_seats: hubSeats.map(hubSeatRecord),
    skipped,
  });
  return { preview, mode, renewals, leaves: leaveList, rosters, directory_renewals: directoryRenewals, hub_seats: hubSeats, skipped, expired_requests: expired };
}

export interface SweepRenewalOutcome {
  identity_id: string;
  room_id: string;
  grant_id: string;
  /** `withdrawn`: the hub's records changed while the prompt was open (a
   * stop, kick, block, pause, term or season change, or the token hash bound
   * since), so no grant was requested. */
  status: "renewed" | "uncertain" | "refused" | "withdrawn";
  grant_expires_at?: string;
  notices?: PostOutcome[];
  invitation_template?: Record<string, string>;
  error?: string;
}

/** Why a planned renewal may no longer be issued, judged by the hub's
 * records as they are now, or null. */
function renewalWithdrawn(ctx: FleetContext, renewal: SweepRenewal): string | null {
  const fleet = ctx.store.fleet;
  const season = fleet.currentSeason(renewal.room_id);
  if (season === null || season.mission_id !== renewal.season.mission_id) return "season_changed";
  return tokenBlocker(ctx, renewal.issue.token_sha256, renewal.identity_id)
    ?? renewBlocker(ctx, ctx.store.getRoom(renewal.room_id), season, fleet.member(season.mission_id, renewal.identity_id), ctx.now());
}

export interface SweepDirectoryOutcome {
  identity_id: string;
  grant_id: string;
  /** `withdrawn`: the hub's records changed while the prompt was open (a
   * stop, a device pause, the token hash or grant id bound since, another
   * directory), so no grant was requested. */
  status: "renewed" | "uncertain" | "refused" | "withdrawn";
  grant_expires_at?: string;
  notice?: PostOutcome;
  error?: string;
}

export interface SweepSeatOutcome {
  mission_id: string;
  purpose: "directory" | "season";
  room_id: string | null;
  grant_id: string;
  status: "renewed" | "uncertain" | "refused";
  expires_at?: string;
  error?: string;
}

export interface SweepOutcome {
  renewals: SweepRenewalOutcome[];
  leaves: number;
  rosters: PostOutcome[];
  directory_renewals: SweepDirectoryOutcome[];
  hub_seats: SweepSeatOutcome[];
}

const WITHDRAWN = new Set(["renewal_withdrawn", "hub_stopped", "token_reused"]);

/** Execute, in this order: leaves and rosters recorded; room renewals;
 * directory renewals; roster posts; the hub desk's own seats last, so every
 * notice goes out with the seat chosen when the sweep was planned. A failure
 * never stops the rest, nothing is retried, and a seat failure undoes nothing. */
export async function executeRenewSweep(ctx: FleetContext, plan: SweepPlan): Promise<SweepOutcome> {
  const hub = requireLiveHub(ctx);
  const fleet = ctx.store.fleet;
  const at = ctx.now().toISOString();
  // Leaves are recorded first: they need no network and stop renewals at once.
  // Each roster's number must still be free (it is inside the confirmed
  // bytes); if another act took one while the prompt was open, nothing is
  // recorded or sent.
  fleet.transaction(() => {
    for (const item of plan.rosters) {
      if (!claimKeyedRoster(ctx, item.roster)) throw new LobbyError("roster_changed", ROSTER_CHANGED_MESSAGE);
    }
    for (const leave of plan.leaves) {
      const row = fleet.member(leave.season.mission_id, leave.identity_id);
      const state = row === null ? "absent" : row.state ?? "active";
      // A member kicked or blocked while the prompt was open stays so.
      if (state === "active") fleet.setMemberState(leave.season.mission_id, leave.identity_id, "left", at);
      fleet.addProcessedNote({ event_id: leave.event_id, kind: "leave", identity_id: leave.identity_id, outcome: state === "active" ? "left" : `already_${state}`, processed_at: at });
    }
    for (const item of plan.rosters) {
      for (const { post, seat } of item.posts) queuePost(ctx, post, seat);
    }
  });
  let admin: AdminClient | null = null;
  const adminOnce = async () => admin ??= await adminClient(ctx, hub);
  const outcomes: SweepRenewalOutcome[] = [];
  for (const renewal of plan.renewals) {
    const base = { identity_id: renewal.identity_id, room_id: renewal.room_id, grant_id: renewal.issue.grant_id };
    let grant: GrantView;
    try {
      // Checked again, with the request's record, right before it is sent:
      // the stop, the member, the room, the season and the token hash as they are now.
      grant = await issueRecordedGrant(ctx, await adminOnce(),
        { mission_id: renewal.season.mission_id, purpose: "season", room_id: renewal.room_id, issue: renewal.issue }, () => {
          const reason = renewalWithdrawn(ctx, renewal);
          if (reason !== null) throw new LobbyError("renewal_withdrawn", `${reason} (changed while the prompt was open); no grant was requested`);
        });
    } catch (error) {
      if (error instanceof LobbyError && WITHDRAWN.has(error.code)) {
        outcomes.push({ ...base, status: "withdrawn", error: `${error.code}: ${error.message}` });
      } else outcomes.push({ ...base, ...failureOf(error) });
      continue;
    }
    try {
      fleet.transaction(() => {
        fleet.addRenewal({
          token_sha256: renewal.issue.token_sha256,
          room_id: renewal.room_id,
          mission_id: renewal.season.mission_id,
          identity_id: renewal.identity_id,
          grant_id: grant.grant_id,
          basis: renewal.basis,
          request_event_id: renewal.request_event_id,
          note_event_id: renewal.posts[0]!.post.event_id,
          renewed_at: at,
        });
        for (const { post, seat } of renewal.posts) queuePost(ctx, post, seat);
      });
    } catch {
      // The grant exists; only the local record failed. Say so rather than abort the sweep.
      outcomes.push({ ...base, status: "uncertain", grant_expires_at: grant.expires_at,
        error: "internal_error: the grant was issued but this hub could not record the renewal; inspect it before any new attempt" });
      continue;
    }
    const notices: PostOutcome[] = [];
    for (const { post, seat } of renewal.posts) notices.push(await sendPost(ctx, post, seat));
    outcomes.push({ ...base, status: "renewed", grant_expires_at: grant.expires_at, notices, invitation_template: invitationTemplateOf(renewal.notice) });
  }
  const directory: SweepDirectoryOutcome[] = [];
  for (const item of plan.directory_renewals) {
    const base = { identity_id: item.identity_id, grant_id: item.issue.grant_id };
    let grant: GrantView;
    try {
      grant = await issueRecordedGrant(ctx, await adminOnce(),
        { mission_id: item.mission_id, purpose: "directory", room_id: null, issue: item.issue }, () => {
          const reason = directoryRenewalWithdrawn(ctx, item);
          if (reason !== null) throw new LobbyError("renewal_withdrawn", `${reason} (changed while the prompt was open); no grant was requested`);
        });
    } catch (error) {
      if (error instanceof LobbyError && WITHDRAWN.has(error.code)) {
        directory.push({ ...base, status: "withdrawn", error: `${error.code}: ${error.message}` });
      } else directory.push({ ...base, ...failureOf(error) });
      continue;
    }
    try {
      fleet.transaction(() => {
        fleet.addDirectoryRenewal({
          token_sha256: item.issue.token_sha256,
          mission_id: item.mission_id,
          identity_id: item.identity_id,
          grant_id: grant.grant_id,
          request_event_id: item.request_event_id,
          notice_event_id: item.post.event_id,
          renewed_at: at,
        });
        queuePost(ctx, item.post, item.seat);
      });
    } catch {
      directory.push({ ...base, status: "uncertain", grant_expires_at: grant.expires_at,
        error: "internal_error: the grant was issued but this hub could not record the renewal; inspect it before any new attempt" });
      continue;
    }
    directory.push({ ...base, status: "renewed", grant_expires_at: grant.expires_at, notice: await sendPost(ctx, item.post, item.seat) });
  }
  const rosters = await sendAll(ctx, plan.rosters.flatMap((item) => item.posts));
  const seats: SweepSeatOutcome[] = [];
  if (plan.hub_seats.length > 0) {
    const desk = requireHubDesk(ctx);
    for (const seat of plan.hub_seats) {
      const base = { mission_id: seat.mission_id, purpose: seat.purpose, room_id: seat.room_id, grant_id: seat.issue.grant_id };
      try {
        seats.push({ ...base, status: "renewed", expires_at: await executeSeatIssue(ctx, await adminOnce(), desk, seat) });
      } catch (error) {
        seats.push({ ...base, ...failureOf(error) });
      }
    }
  }
  recordOutcome(ctx, "hub.renew.sweep", plan.preview.subject, {
    renewals: outcomes.map(({ invitation_template: _template, notices, ...rest }) => ({ ...rest, notices: (notices ?? []).map((post) => post.status) })),
    leaves: plan.leaves.map((leave) => ({ room_id: leave.room_id, identity_id: leave.identity_id })),
    rosters: rosters.map((post) => ({ event_id: post.event_id, status: post.status })),
    directory_renewals: directory.map(({ notice, ...rest }) => ({ ...rest, notice: notice?.status ?? null })),
    hub_seats: seats,
  });
  return { renewals: outcomes, leaves: plan.leaves.length, rosters, directory_renewals: directory, hub_seats: seats };
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
    // Checked again: a stop, a block, another add or a season change may have
    // been recorded while the prompt was open. Any change refuses the act
    // before anything is recorded or sent.
    requireLiveHub(ctx);
    const roomId = plan.season.room_id;
    requireFleetRoom(ctx, roomId);
    const season = fleet.currentSeason(roomId);
    if (season === null || season.mission_id !== plan.season.mission_id || season.revoked_at != null) {
      throw new LobbyError("season_changed", "the room's current season changed while the prompt was open; nothing was recorded or sent");
    }
    if (fleet.isBlocked(roomId, plan.member.identity_id)) {
      throw new LobbyError("blocked", "this identity was blocked from this room while the prompt was open; nothing was recorded or sent");
    }
    if (plan.newDevice && (fleet.device(plan.device.identity_id) !== null || fleet.deviceByFingerprint(plan.device.fingerprint) !== null)) {
      throw new LobbyError("identity_conflict", "this identity or key was recorded while the prompt was open; nothing was recorded or sent. Run the command again");
    }
    if (!claimKeyedRoster(ctx, plan.rosters.roster)) throw new LobbyError("roster_changed", ROSTER_CHANGED_MESSAGE);
    if (plan.newDevice) fleet.addDevice(plan.device);
    fleet.addMember(plan.member);
    for (const grantId of plan.extraGrants) {
      fleet.addExtraGrant({ grant_id: grantId, mission_id: plan.season.mission_id, room_id: plan.season.room_id, identity_id: plan.member.identity_id, recorded_at: at });
    }
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
    requireLiveHub(ctx);
    if (!claimKeyedRoster(ctx, plan.rosters.roster)) throw new LobbyError("roster_changed", ROSTER_CHANGED_MESSAGE);
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

export async function executeRemoval(ctx: FleetContext, plan: RemovalPlan)
  : Promise<{ revocations: RevocationOutcome[]; rosters: PostOutcome[]; roster_changed: boolean }> {
  const hub = requireHub(ctx);
  const fleet = ctx.store.fleet;
  const at = ctx.now().toISOString();
  // Local records first: the block refuses knocks and the state stops
  // renewals even if every network call then fails. A roster whose number
  // another act took while the prompt was open is not posted (its bytes were
  // confirmed as shown and are never re-signed); the removal still holds.
  let rosterChanged = false;
  fleet.transaction(() => {
    if (plan.block && !fleet.isBlocked(plan.room_id, plan.identity_id)) fleet.block(plan.room_id, plan.identity_id, at);
    const current = plan.season === null ? null : fleet.member(plan.season.mission_id, plan.identity_id);
    if (plan.season !== null && current !== null && (current.state ?? "active") === "active") {
      fleet.setMemberState(plan.season.mission_id, plan.identity_id, plan.block ? "blocked" : "kicked", at);
    }
    if (plan.rosters !== null) {
      if (claimKeyedRoster(ctx, plan.rosters.roster)) {
        for (const { post, seat } of plan.rosters.posts) queuePost(ctx, post, seat);
      } else rosterChanged = true;
    }
  });
  const revocations = await revokeGrants(ctx, hub, plan.revocations);
  const rosters = plan.rosters === null || rosterChanged ? [] : await sendAll(ctx, plan.rosters.posts);
  recordOutcome(ctx, plan.block ? "hub.block" : "hub.kick", plan.room_id, {
    identity_id: plan.identity_id,
    revocations,
    rosters: rosters.map((post) => ({ event_id: post.event_id, status: post.status })),
    roster_changed: rosterChanged,
  });
  return { revocations, rosters, roster_changed: rosterChanged };
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
    "MANUAL STEP FOR THE OWNER (this desk never does it): revoke the API key that issued the lobby grants.",
    `  This hub's bearer is the Keychain item service ${hub.bearer_service}, account ${hub.keychain_account} (its value is never shown).`,
    "  Every mission grant hangs off the API key that issued it, so revoking that key ends every lobby grant at once,",
    "  including any this stop could not reach. Do it yourself from a terminal, never from an agent's tool call:",
    `  on ${LOBBY_ORIGIN}, GET /v1/keys gives the key's id (is_current is true when asked with that bearer), and`,
    "  DELETE /v1/keys/<key id> revokes it. If it is the project's only active key, DELETE answers 409: first mint",
    "  a replacement (POST /v1/keys), then DELETE; or POST /v1/keys/rotate with that bearer, which revokes it and",
    "  returns the replacement only once. If the lobby is to continue later, store the new bearer in the Keychain",
    "  yourself (security prompts for it) and start a new hub.",
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
  // Every other directory of the chain not yet revoked: the previous one, and
  // a successor created (or asked for) but not announced yet.
  for (const row of fleet.hubDirectories()) {
    if (row.mission_id === hub.directory_mission_id || row.revoked_at !== null || (row.mode === "adopted" && !input.include_adopted)) continue;
    missions.push({ mission_id: row.mission_id, kind: "directory", mode: row.mode, room_id: null });
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
    + (hub.directory_mode === "adopted" && hub.directory_revoked_at == null ? 1 : 0)
    + fleet.hubDirectories().filter((row) => row.mission_id !== hub.directory_mission_id && row.mode === "adopted" && row.revoked_at === null).length;
  const preview = actPreview("hub.stop", hub.project_id, now.toISOString(), [
    "EMERGENCY STOP: this hub issues no more access afterwards (recorded locally first)",
    ...missions.map((mission) => `revoke ${mission.kind} mission ${mission.mission_id} (${mission.mode}): POST .../revoke, zero body bytes`),
    ...grants.map((grant) => `revoke grant ${grant.grant_id} in ${grant.mission_id} (${grant.source}): POST .../grants/<id>/revoke, zero body bytes`),
    ...(!input.include_adopted && adoptedLeft > 0 ? [`${adoptedLeft} adopted mission(s) made by hand are left alone (add --include-adopted to revoke them too)`] : []),
    "then revoke the issuing API key by hand: the exact step is printed after the stop",
  ], {
    include_adopted: input.include_adopted,
    missions: missions.map((mission) => ({ ...mission, request: `POST ${MISSIONS_PATH}/${mission.mission_id}/revoke`, body_bytes: 0 })),
    grants: grants.map(revokeRequest),
    manual_step: "revoke the issuing API key by hand; this desk never calls /v1/keys",
  });
  return { preview, missions, grants, manual_step: manual };
}

export interface StopOutcome {
  missions: Array<{ mission_id: string; kind: string; status: "revoked" | "uncertain" | "refused"; error?: string }>;
  grants: RevocationOutcome[];
  /** Grants requested after this stop was planned (while its prompt was
   * open), so not in its confirmed list: the next `hub stop` revokes them. */
  late_grants: Array<{ mission_id: string; grant_id: string }>;
  manual_step: string;
}

export async function executeStop(ctx: FleetContext, plan: StopPlan): Promise<StopOutcome> {
  const hub = requireHub(ctx);
  const fleet = ctx.store.fleet;
  // Recorded first: from here every act that issues anything refuses
  // (requireLiveHub, checked again right before each grant request).
  fleet.setHubStopped(ctx.now().toISOString());
  const admin = await adminClient(ctx, hub);
  const missions: StopOutcome["missions"] = [];
  // Missions first: revoking a mission stops every grant on it at once.
  for (const mission of plan.missions) {
    try {
      const view = await admin.revokeMission(mission.mission_id);
      if (mission.kind === "directory") {
        if (mission.mission_id === hub.directory_mission_id) fleet.setDirectoryRevoked(view.revoked_at!);
        if (fleet.chain) fleet.markHubDirectoryRevoked(mission.mission_id, view.revoked_at!);
      } else fleet.markSeasonRevoked(mission.mission_id, view.revoked_at!);
      missions.push({ mission_id: mission.mission_id, kind: mission.kind, status: "revoked" });
    } catch (error) {
      // A successor whose creation was never confirmed and that the service
      // definitely does not have: nothing to revoke, so it is forgotten.
      if (mission.kind === "directory" && !mayHaveTakenEffect(error) && fleet.hubDirectory(mission.mission_id)?.state === "pending") {
        fleet.dropPendingHubDirectory(mission.mission_id);
      }
      missions.push({ mission_id: mission.mission_id, kind: mission.kind, ...failureOf(error) });
    }
  }
  const grants = await revokeGrants(ctx, hub, plan.grants);
  const listed = new Set(plan.grants.map((grant) => grant.grant_id));
  const now = ctx.now().getTime();
  const late = fleet.listHubGrants()
    .filter((grant) => !listed.has(grant.grant_id) && grant.revoke_state !== "revoked" && Date.parse(grant.expires_at) > now)
    .map((grant) => ({ mission_id: grant.mission_id, grant_id: grant.grant_id }));
  recordOutcome(ctx, "hub.stop", hub.project_id, { missions, grants, late_grants: late });
  return { missions, grants, late_grants: late, manual_step: plan.manual_step };
}
