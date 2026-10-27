/** Directory renewal inside the Lobby (schema version 4).
 *
 * A joined desk keeps its directory grant without carrying packets:
 * - `fleet renew` (tty, desk) picks up the grant the hub issued for its last
 *   request, by an invitation read with the token it generated (it needs no
 *   notice and no live grant to do so), accepts exactly the directory digest
 *   it joined, and posts a desk-signed `directory_renew` request for the next
 *   grant, naming a grant id and the SHA-256 of a fresh token it chose.
 * - `hub renew-sweep` (tty, hub; src/hub-access.ts) issues every enrolled
 *   desk's next directory grant from those requests under the first-poster
 *   rule (token hashes and grant ids), posts a door-signed
 *   `directory_renewal` notice, and renews the hub desk's own directory and
 *   season seats when they end within `HUB_SEAT_RENEW_BELOW_MS`.
 * - `hub device pause|resume` (tty, hub) stops or restarts one device's
 *   directory renewal; the grant it holds then runs out within 24 hours.
 * - Directory rollover (schema version 5; src/directory-rollover.ts): while a
 *   successor overlaps the previous directory the sweep reads requests in
 *   both, renews a grant in either while it is live, and renews the hub
 *   desk's seats in both; `fleet renew` aims its next request at the
 *   door-signed successor of its directory and moves the desk there when it
 *   picks that grant up.
 * Enroll-device, hub relay and fleet join stay the way back in after a lapse.
 * Every act here is confirmed at /dev/tty and audited before any network
 * effect; nothing is retried. Contract: packages/lobby/README.md#directory-renewal.
 */
import { LobbyError } from "./errors.js";
import type { DoorPin, VerifiedDocument } from "./fleet.js";
import type { DeskDirectoryRenewalRow, DeskRow, HubDeviceRow, HubRow } from "./fleet-store.js";
import { DIRECTORY_GATE_ROOM, type GrantIssue, type GrantView, type MissionView, type ParticipantSeat } from "./hosted.js";
import {
  claimBlocker,
  doorOf,
  noteForgery,
  planSeatIssue,
  requireHub,
  requireLiveHub,
  seatRecord,
  type DirectoryNoteEntry,
  type SeatIssue,
} from "./hub.js";
import {
  actPreview,
  CLOCK_MARGIN_MS,
  DAY_MS,
  deskFleetView,
  deskPreviousDirectory,
  doorPin,
  earliest,
  fleetView,
  HOUR_MS,
  hubLiveDirectories,
  liveSeat,
  participant,
  preparePost,
  requireJoinedDesk,
  seatOf,
  sendPost,
  syncMission,
  type FleetContext,
  type LiveDirectory,
  type PostOutcome,
  type PreparedPost,
} from "./ops.js";
import { namesDoor, namesPredecessor } from "./packets.js";
import { DeskSecrets } from "./secrets.js";
import {
  documentSha256,
  publicKeyHexOf,
  RENEW_MAX_MS,
  sealDocument,
  type DirectoryRenewalBody,
  type DirectoryRenewBody,
  type DirectorySuccessorBody,
} from "./signed.js";
import type { ActPreview } from "./store.js";
import { assertUuid, newUuid, type MissionAction } from "./wire.js";

/** The hub desk's own seats are renewed by the sweep when they end within
 * this long, so repeated sweeps do not mint a credential every time. */
export const HUB_SEAT_RENEW_BELOW_MS = 20 * HOUR_MS;

const DIRECTORY_ACTIONS: MissionAction[] = ["mission.observe", "mission.read"];

const FALLBACK = "enroll-device here, hub relay on the hub, fleet join here";

/** A seat must have this long left to post with. */
const POST_MARGIN_MS = 5 * 60_000;

// ── Hub: which directory requests to renew ─────────────────────────────

export interface DirectorySkip {
  source: string;
  room_id: null;
  identity_id: string | null;
  reason: string;
}

export interface DirectoryCandidate {
  entry: DirectoryNoteEntry;
  device: HubDeviceRow;
  /** The live directory the request asks a grant in. */
  target: LiveDirectory;
}

/** Why the hub's own records forbid binding this token hash to a directory
 * grant for `identityId`, or null: it renewed that request already, or bound
 * the hash to some grant before (`grant_uncertain:<id>` while that grant's
 * outcome is unknown). */
export function directoryTokenBlocker(ctx: FleetContext, tokenSha256: string, identityId: string): string | null {
  const fleet = ctx.store.fleet;
  const renewed = fleet.directoryRenewal(tokenSha256);
  if (renewed !== null) return renewed.identity_id === identityId ? "renewed" : "token_reused";
  if (fleet.renewal(tokenSha256) !== null) return "token_reused";
  const bound = fleet.hubGrantByToken(tokenSha256);
  if (bound !== null && bound.state === "requested") return `grant_uncertain:${bound.grant_id}`;
  if (bound !== null) return "token_reused";
  return null;
}

/** Why the hub may not issue a grant with this desk-chosen id, or null. */
export function grantIdBlocker(ctx: FleetContext, grantId: string): string | null {
  const bound = ctx.store.fleet.hubGrant(grantId);
  if (bound === null) return null;
  return bound.state === "requested" ? `grant_uncertain:${bound.grant_id}` : "grant_id_taken";
}

function grantClaimBlocker(claimants: ReadonlyMap<string, string | null>, grantId: string, identity: string): string | null {
  const owner = claimants.get(grantId);
  if (owner === undefined || owner === identity) return null;
  return owner === null ? "grant_id_contested" : "grant_id_claimed_by_another_desk";
}

/** The newest authentic, live, unclaimed `directory_renew` request per
 * device, from the cached events of `missions` (the live directories and the
 * seasons the sweep read). A request is renewed only when it was posted in
 * one of the hub's live directories, names one of them (during a rollover's
 * overlap a desk that has not moved yet asks for its first grant in the
 * successor from the previous directory), comes from an enrolled desk that
 * joined through this hub, is not paused, and its token hash and grant id
 * belong to it (first poster). A request already renewed still counts as the
 * newest, so an older one is never renewed after it, and requests it
 * superseded stay quiet. */
export function directoryRenewalCandidates(ctx: FleetContext, hub: HubRow, directories: readonly LiveDirectory[], missions: readonly string[],
  now: Date, claims: { tokens: ReadonlyMap<string, string | null>; grantIds: ReadonlyMap<string, string | null> },
  skip: (item: DirectorySkip) => void): { candidates: DirectoryCandidate[]; expired: number } {
  const fleet = ctx.store.fleet;
  const hubDesk = fleet.desk();
  const live = new Map(directories.map((directory) => [directory.mission_id, directory]));
  const entries = missions.flatMap((missionId) => fleetView(ctx, missionId, doorOf(hub)).directoryRenewRequests);
  type Request = { entry: DirectoryNoteEntry; renewed: boolean };
  const newest = new Map<string, Request>();
  const older: Array<{ key: string; request: Request }> = [];
  const isNewer = (left: DirectoryNoteEntry, right: DirectoryNoteEntry) => {
    const issued = Date.parse(left.envelope.body.issued_at) - Date.parse(right.envelope.body.issued_at);
    return issued !== 0 ? issued > 0 : Date.parse(left.event.received_at) > Date.parse(right.event.received_at);
  };
  for (const entry of entries) {
    const body = entry.envelope.body;
    const renewedFor = fleet.directoryRenewal(body.token_sha256);
    const renewed = renewedFor !== null && renewedFor.identity_id === body.identity_id && renewedFor.mission_id === body.mission_id;
    const source = `event:${entry.event.event_id}`;
    const forgery = noteForgery(ctx, entry);
    if (forgery !== null) {
      if (!renewed) skip({ source, room_id: null, identity_id: null, reason: forgery });
      continue;
    }
    // Posting in a directory needs a live directory grant, so the post
    // itself shows the desk had not lapsed; a request riding in a season does not count.
    if (!live.has(entry.event.mission_id)) {
      if (!renewed) skip({ source, room_id: null, identity_id: body.identity_id, reason: "posted_elsewhere" });
      continue;
    }
    if (!live.has(body.mission_id)) {
      if (!renewed) skip({ source, room_id: null, identity_id: body.identity_id, reason: "directory_not_live" });
      continue;
    }
    // One newest request per device, whichever live directory it names: a
    // desk asking for its successor grant supersedes its older request.
    const key = body.identity_id;
    const request: Request = { entry, renewed };
    const current = newest.get(key);
    if (current === undefined) newest.set(key, request);
    else if (isNewer(entry, current.entry)) {
      older.push({ key, request: current });
      newest.set(key, request);
    } else older.push({ key, request });
  }
  for (const { key, request } of older) {
    if (request.renewed || newest.get(key)!.renewed) continue;
    skip({ source: `event:${request.entry.event.event_id}`, room_id: null, identity_id: request.entry.envelope.body.identity_id, reason: "superseded" });
  }
  const candidates: DirectoryCandidate[] = [];
  let expired = 0;
  const directoryGrants = new Set(fleet.listHubGrants().filter((grant) => grant.purpose === "directory").map((grant) => grant.identity_id));
  for (const request of newest.values()) {
    if (request.renewed) continue;
    const body = request.entry.envelope.body;
    const source = `event:${request.entry.event.event_id}`;
    if (Date.parse(body.expires_at) <= now.getTime()) {
      expired += 1;
      continue;
    }
    const device = fleet.device(body.identity_id);
    const blocker = device === null ? "unknown_desk"
      // The hub desk's own directory seat is renewed by the sweep's seat part.
      : hubDesk !== null && hubDesk.identity_id === body.identity_id ? "hub_desk"
      : device.directory_paused_at != null ? "device_paused"
      : !directoryGrants.has(body.identity_id) ? "never_joined"
      : claimBlocker(claims.tokens, body.token_sha256, body.identity_id)
        ?? grantClaimBlocker(claims.grantIds, body.grant_id, body.identity_id)
        ?? directoryTokenBlocker(ctx, body.token_sha256, body.identity_id)
        ?? grantIdBlocker(ctx, body.grant_id);
    if (blocker !== null) {
      skip({ source, room_id: null, identity_id: body.identity_id, reason: blocker });
      continue;
    }
    candidates.push({ entry: request.entry, device: device!, target: live.get(body.mission_id)! });
  }
  return { candidates, expired };
}

export interface DirectoryRenewalItem {
  request_event_id: string;
  request_sha256: string;
  identity_id: string;
  device: HubDeviceRow;
  /** The directory the grant is issued in. */
  mission_id: string;
  issue: GrantIssue;
  notice: DirectoryRenewalBody;
  post: PreparedPost;
  seat: ParticipantSeat;
}

/** Seal the notices for the candidates that survived the collision checks.
 * Each grant is issued in the directory the request names; its notice goes
 * to the directory the request was posted in, which needs the hub desk's
 * seat there with five minutes left. */
export function directoryRenewalItems(ctx: FleetContext, _hub: HubRow, candidates: readonly DirectoryCandidate[], now: Date,
  signer: { privateKey: Parameters<typeof sealDocument>[2]["privateKey"]; fingerprint: string } | null,
  skip: (item: DirectorySkip) => void): DirectoryRenewalItem[] {
  const items: DirectoryRenewalItem[] = [];
  for (const { entry, device, target } of candidates) {
    const body = entry.envelope.body;
    const source = `event:${entry.event.event_id}`;
    if (Date.parse(target.expires_at) <= now.getTime() + HOUR_MS) {
      skip({ source, room_id: null, identity_id: body.identity_id, reason: "directory_ending" });
      continue;
    }
    const seat = liveSeat(ctx, entry.event.mission_id, "mission.observe", 5 * 60_000);
    if (seat === null || signer === null) {
      skip({ source, room_id: null, identity_id: body.identity_id, reason: "hub_directory_seat_lapsed" });
      continue;
    }
    const issue: GrantIssue = {
      grant_id: body.grant_id,
      identity_id: device.identity_id,
      signing_key_id: device.signing_key_id,
      actions: [...DIRECTORY_ACTIONS],
      expires_at: earliest(now.getTime() + DAY_MS - CLOCK_MARGIN_MS, target.expires_at),
      token_sha256: body.token_sha256,
    };
    const notice: DirectoryRenewalBody = {
      invitation: {
        mission_id: target.mission_id,
        grant_id: issue.grant_id,
        identity_id: issue.identity_id,
        signing_key_id: issue.signing_key_id,
        public_key_hex: publicKeyHexOf(device.public_key),
        expires_at: issue.expires_at,
        token_sha256: issue.token_sha256,
      },
      issued_at: now.toISOString(),
    };
    const summary = sealDocument("directory_renewal", notice, signer).summary;
    items.push({
      request_event_id: entry.event.event_id,
      request_sha256: documentSha256(entry.summary),
      identity_id: device.identity_id,
      device,
      mission_id: target.mission_id,
      issue,
      notice,
      post: preparePost(ctx, "directory_renewal", entry.event.mission_id, summary, DIRECTORY_GATE_ROOM),
      seat,
    });
  }
  return items;
}

export function directoryRenewalRecord(item: DirectoryRenewalItem) {
  return {
    request_event_id: item.request_event_id,
    request_sha256: item.request_sha256,
    device: { identity_id: item.identity_id, fingerprint: item.device.fingerprint },
    grant: { mission_id: item.mission_id, ...item.issue },
    notice: { mission_id: item.post.mission_id, event_id: item.post.event_id, summary: item.post.summary },
  };
}

export function directoryRenewalLine(item: DirectoryRenewalItem): string {
  return `device ${item.device.fingerprint} ${JSON.stringify(item.device.display_name)} (name is self-declared) did:at:${item.identity_id}: ` +
    `grant ${item.issue.grant_id} mission.observe+mission.read until ${item.issue.expires_at}, bound to the desk's own token hash ` +
    `${item.issue.token_sha256}; request ${item.request_event_id}; ` +
    (item.post.mission_id === item.mission_id ? `notice to the directory ${item.mission_id}`
      : `grant in the successor directory ${item.mission_id}; notice to the directory ${item.post.mission_id} the request came from`);
}

/** Why a planned directory renewal may no longer be issued, judged by the
 * hub's records as they are now (another terminal may have changed them
 * while the prompt was open), or null. */
export function directoryRenewalWithdrawn(ctx: FleetContext, item: DirectoryRenewalItem): string | null {
  const fleet = ctx.store.fleet;
  const hub = fleet.hub();
  // The directory the grant is for (and the one the notice goes to) must still be live.
  if (hub === null) return "directory_changed";
  const live = hubLiveDirectories(ctx, hub).map((directory) => directory.mission_id);
  if (!live.includes(item.mission_id) || !live.includes(item.post.mission_id)) return "directory_changed";
  const device = fleet.device(item.identity_id);
  if (device === null) return "unknown_desk";
  if (device.directory_paused_at != null) return "device_paused";
  return directoryTokenBlocker(ctx, item.issue.token_sha256, item.identity_id) ?? grantIdBlocker(ctx, item.issue.grant_id);
}

// ── Hub: the hub desk's own seats ──────────────────────────────────────

/** The hub desk's seats that end within HUB_SEAT_RENEW_BELOW_MS (or have
 * lapsed): every live directory (during a rollover's overlap, the previous
 * one too) and every current season that still has more than an hour to run.
 * A seat that already reaches its mission's end is left alone. Tokens are
 * prepared in memory and written only on yes. */
export function planHubSeatRenewals(ctx: FleetContext, hub: HubRow, now: Date): SeatIssue[] {
  const fleet = ctx.store.fleet;
  const desk = fleet.desk();
  if (desk === null || fleet.device(desk.identity_id) === null) return [];
  const missions: Array<{ mission: { mission_id: string; mission_digest: string; expires_at: string }; purpose: "directory" | "season"; room_id: string | null }> = [
    ...hubLiveDirectories(ctx, hub, now).map((directory) => ({ mission: directory, purpose: "directory" as const, room_id: null })),
    ...fleet.listSeasons()
      .filter((season) => season.state === "current" && season.revoked_at == null)
      .map((season) => ({ mission: season, purpose: "season" as const, room_id: season.room_id })),
  ];
  const seats: SeatIssue[] = [];
  for (const { mission, purpose, room_id } of missions) {
    const ends = Date.parse(mission.expires_at);
    if (ends <= now.getTime() + HOUR_MS) continue;
    const held = fleet.currentDeskGrant(mission.mission_id, now);
    const heldUntil = held === null ? 0 : Date.parse(held.expires_at!);
    if (held !== null && (heldUntil >= now.getTime() + HUB_SEAT_RENEW_BELOW_MS || heldUntil >= ends - CLOCK_MARGIN_MS)) continue;
    seats.push(planSeatIssue(ctx, desk, mission, purpose, room_id));
  }
  return seats;
}

export function hubSeatRecord(seat: SeatIssue) {
  return { ...seatRecord(seat), purpose: seat.purpose, room_id: seat.room_id, mission_digest: seat.mission_digest };
}

export function hubSeatLine(seat: SeatIssue, currentDirectory?: string): string {
  const where = seat.purpose === "season" ? `room ${seat.room_id}`
    : currentDirectory === undefined || seat.mission_id === currentDirectory ? "the directory" : "the previous directory";
  return `hub desk seat in ${where} ${seat.mission_id}: ` +
    `grant ${seat.issue.grant_id} mission.observe+mission.read until ${seat.issue.expires_at}; accept digest ${seat.mission_digest}`;
}

// ── Hub: pause or resume one device's directory renewal ────────────────

export interface DevicePausePlan {
  preview: ActPreview;
  identity_id: string;
  pause: boolean;
}

/** `hub device pause|resume <identity_id>`: while paused, the sweep issues
 * this device no next directory grant, so the one it holds runs out within
 * 24 hours. The directory counterpart of `hub member pause`. */
export function planDevicePause(ctx: FleetContext, input: { identity_id: string; pause: boolean }): DevicePausePlan {
  if (input.pause) requireHub(ctx);
  else requireLiveHub(ctx);
  const fleet = ctx.store.fleet;
  const identity = assertUuid(input.identity_id, "identity_id");
  const device = fleet.device(identity);
  if (device === null) throw new LobbyError("unknown_device", "no device with that identity is enrolled at this hub");
  if (fleet.desk()?.identity_id === identity) {
    throw new LobbyError("hub_desk", "this is the hub's own desk; its seats are renewed by hub renew-sweep and stopped by hub stop");
  }
  const paused = device.directory_paused_at != null;
  if (input.pause === paused) {
    throw new LobbyError(input.pause ? "already_paused" : "not_paused", `this device's directory renewal is ${input.pause ? "already" : "not"} paused`);
  }
  const at = ctx.now().toISOString();
  const preview = actPreview(input.pause ? "hub.device.pause" : "hub.device.resume", identity, at, [
    `device ${device.fingerprint} ${JSON.stringify(device.display_name)} (name is self-declared) did:at:${identity}`,
    input.pause
      ? "pause directory renewal: hub renew-sweep issues this device no next directory grant, so the grant it holds runs out within 24 hours"
      : "resume directory renewal: the next hub renew-sweep may renew this device's directory grant again",
  ], { identity_id: identity, fingerprint: device.fingerprint, paused: input.pause });
  return { preview, identity_id: identity, pause: input.pause };
}

export function executeDevicePause(ctx: FleetContext, plan: DevicePausePlan): void {
  ctx.store.fleet.setDevicePaused(plan.identity_id, plan.pause ? plan.preview.at : null);
}

// ── Desk: the door-signed successor of this desk's directory ───────────

/** A verified `directory_successor` notice naming this desk's directory. */
export interface SuccessorNotice {
  body: DirectorySuccessorBody;
  event_id: string;
  sha256: string;
}

/** The door-signed successor of this desk's directory, from the local cache
 * of that directory: notices signed by the pinned door (verified against the
 * pinned key) whose `from` is exactly the directory and digest this desk is
 * in, and whose successor has more than an hour to run. Copies of one notice
 * are one successor; two different successors refuse
 * (`conflicting_successors`): the desk never chooses between them. A notice
 * naming another directory as `from` (a replay of an older rollover, or one
 * copied into the successor) is ignored. */
export function successorOf(ctx: FleetContext, desk: Pick<DeskRow, "directory_mission_id" | "directory_digest">, door: DoorPin, now: Date)
  : SuccessorNotice | null {
  if (desk.directory_mission_id === null) return null;
  const notices = fleetView(ctx, desk.directory_mission_id, door).successors.filter((document: VerifiedDocument<DirectorySuccessorBody>) => {
    const body = document.envelope.body;
    return body.from_mission_id === desk.directory_mission_id && body.from_mission_digest === desk.directory_digest
      && Date.parse(body.to_expires_at) > now.getTime() + HOUR_MS;
  });
  const targets = new Map<string, VerifiedDocument<DirectorySuccessorBody>>();
  for (const document of notices) {
    const body = document.envelope.body;
    const key = `${body.to_mission_id}:${body.to_mission_digest}:${body.to_expires_at}`;
    if (!targets.has(key)) targets.set(key, document);
  }
  if (targets.size > 1) {
    throw new LobbyError("conflicting_successors",
      `the door signed ${targets.size} different successors of this desk's directory; nothing was accepted or sent. Ask the hub`);
  }
  const document = [...targets.values()][0];
  return document === undefined ? null : { body: document.envelope.body, event_id: document.event.event_id, sha256: documentSha256(document.summary) };
}

// ── Desk: fleet renew ──────────────────────────────────────────────────

interface Pickup {
  row: DeskDirectoryRenewalRow;
  seat: ParticipantSeat;
  mission: MissionView;
  grant: GrantView;
  notice_sha256: string | null;
  /** Set when the grant is in the door-signed successor of this desk's
   * directory: accepting it moves the desk there. */
  move: { from_mission_id: string; notice: SuccessorNotice } | null;
}

interface NextRequest {
  body: DirectoryRenewBody;
  post: PreparedPost;
  /** The live directory seat to post with; null: the grant picked up in this act. */
  seat: ParticipantSeat | null;
  writeToken: () => void;
}

export interface FleetRenewPlan {
  preview: ActPreview;
  pickup: Pickup | null;
  /** Null only beside a pickup, when no next request can be posted; see `no_request`. */
  request: NextRequest | null;
  /** Why a pickup goes ahead without a next request, or null. */
  no_request: string | null;
  /** The current directory's end as read in this plan, recorded on yes
   * (null when this act moves the desk, which records the successor's end). */
  directory_expires_at: string | null;
  /** This desk's directory as planned; a move by another terminal refuses. */
  directory_mission_id: string;
}

/** Nothing to do: the state, and why no prompt was shown. */
export interface FleetRenewIdle {
  status: "request_open";
  request: { event_id: string; grant_id: string; expires_at: string; mission_id: string };
  grant_expires_at: string | null;
}

/** A definite "not issued (or not usable) yet": the service knows no grant
 * for that token and id. A 401 or 404; nothing was created. */
function notIssuedYet(error: unknown): boolean {
  return error instanceof LobbyError && error.code === "hosted_refused" && (error.details.status === 401 || error.details.status === 404);
}

function heldDirectoryGrantEnd(ctx: FleetContext, missionId: string): string | null {
  const live = ctx.store.fleet.currentDeskGrant(missionId, ctx.now());
  if (live !== null) return live.expires_at;
  const recorded = ctx.store.fleet.listDeskGrants()
    .filter((grant) => grant.mission_id === missionId && grant.purpose === "directory" && grant.accepted_at !== null && grant.expires_at !== null)
    .sort((left, right) => left.expires_at! < right.expires_at! ? 1 : -1)[0];
  return recorded?.expires_at ?? null;
}

/** Why the grant read from the successor may not be accepted, or null: the
 * mission must be exactly the one the door-signed notice names (id, digest,
 * end), its charter must name the pinned door and exactly this desk's
 * directory as its predecessor, it must be in this desk's project, and the
 * grant must be live, observe+read and within the mission. */
function successorMismatch(read: { mission: MissionView; grant: GrantView }, notice: SuccessorNotice, door: DoorPin,
  from: { mission_id: string; mission_digest: string }, projectId: string): string | null {
  const { mission, grant } = read;
  if (mission.mission_id !== notice.body.to_mission_id) return "the mission is not the one the door-signed notice names";
  if (mission.mission_digest !== notice.body.to_mission_digest) return "the mission's digest differs from the door-signed notice";
  if (mission.expires_at !== notice.body.to_expires_at) return "the mission's end differs from the door-signed notice";
  if (mission.project_id !== projectId) return "the mission belongs to another project than this desk's";
  if (!namesDoor(mission.descriptor, door)) return "the charter does not name this desk's pinned door key";
  if (!namesPredecessor(mission.descriptor, from)) return "the charter does not name this desk's directory as its predecessor";
  if (mission.revoked_at !== null || grant.revoked_at !== null) return "the mission or the grant is revoked";
  if (grant.actions.join(",") !== DIRECTORY_ACTIONS.join(",") || Date.parse(grant.expires_at) > Date.parse(mission.expires_at)) {
    return "the grant is not mission.observe+mission.read within the mission";
  }
  return null;
}

export async function planFleetRenew(ctx: FleetContext): Promise<{ plan: FleetRenewPlan } | { idle: FleetRenewIdle }> {
  const desk = requireJoinedDesk(ctx);
  const fleet = ctx.store.fleet;
  if (fleet.hub() !== null) {
    throw new LobbyError("hub_desk", "this desk is the hub's own desk: hub renew-sweep renews its directory and season seats");
  }
  const door = doorPin(ctx);
  if (door === null) throw new LobbyError("door_not_pinned", "the door key is not pinned on this desk; run fleet join");
  const now = ctx.now();
  const directoryId = desk.directory_mission_id;
  const from = { mission_id: directoryId, mission_digest: desk.directory_digest };
  // A read with no effect, before the prompt, while this desk may still read.
  const reading = liveSeat(ctx, directoryId, "mission.read");
  if (reading !== null) await syncMission(ctx, reading);
  const secrets = DeskSecrets.open(ctx.home);

  // 1. Pick up the grant the hub issued for this desk's newest request, if any.
  const newest = fleet.deskDirectoryRenewals()[0];
  let pickup: Pickup | null = null;
  // A grant issued just before its request ran out lasts at most 24 hours more.
  if (newest !== undefined && newest.accepted_at === null && Date.parse(newest.expires_at) + DAY_MS > now.getTime()) {
    if (!secrets.hasToken(newest.token_sha256)) throw new LobbyError("token_not_found", "the request's token is missing on this desk");
    const seat: ParticipantSeat = {
      mission_id: newest.mission_id,
      grant_id: newest.grant_id,
      identity_id: desk.identity_id,
      signing_key_id: desk.signing_key_id,
      token_sha256: newest.token_sha256,
    };
    let read: { mission: MissionView; grant: GrantView } | null = null;
    try {
      read = await participant(ctx).invitation(seat);
    } catch (error) {
      if (!notIssuedYet(error)) throw error;
    }
    if (read !== null) {
      const { mission, grant } = read;
      let move: Pickup["move"] = null;
      if (newest.mission_id !== directoryId) {
        // The grant is in another directory: accepted only as the door-signed
        // successor of this desk's directory, never because a request named it.
        const notice = successorOf(ctx, desk, door, now);
        const why = notice === null || notice.body.to_mission_id !== newest.mission_id
          ? "no door-signed successor of this desk's directory names that mission"
          : successorMismatch(read, notice, door, from, desk.project_id);
        if (why !== null) {
          throw new LobbyError("successor_mismatch", `${why}; nothing was accepted and this desk stays in directory ${directoryId}. Ask the hub`);
        }
        move = { from_mission_id: directoryId, notice: notice! };
      } else {
        if (mission.project_id !== desk.project_id) {
          throw new LobbyError("project_mismatch", "the directory mission belongs to another project than this desk's; nothing was accepted");
        }
        if (!namesDoor(mission.descriptor, door)) {
          throw new LobbyError("door_not_in_charter", "the directory descriptor does not name this desk's pinned door key; nothing was accepted");
        }
        if (mission.mission_digest !== desk.directory_digest) {
          throw new LobbyError("digest_changed", "the directory's digest differs from the one this desk joined; nothing was accepted");
        }
        if (mission.revoked_at !== null || grant.revoked_at !== null) {
          throw new LobbyError("directory_closed", "the directory mission or the renewed grant is revoked; nothing was accepted");
        }
        if (grant.actions.join(",") !== DIRECTORY_ACTIONS.join(",") || Date.parse(grant.expires_at) > Date.parse(mission.expires_at)) {
          throw new LobbyError("grant_mismatch", "the renewed directory grant is not mission.observe+mission.read within the directory");
        }
      }
      // The door-signed notice is an audit trail, never required; when it is
      // here (in this desk's directory or the one it moved from) it must name exactly this grant.
      const notices = deskFleetView(ctx, desk, door).directoryRenewals
        .filter((document) => document.envelope.body.invitation.token_sha256 === newest.token_sha256);
      const keyHex = publicKeyHexOf(desk.public_key);
      for (const document of notices) {
        const invitation = document.envelope.body.invitation;
        if (invitation.grant_id !== grant.grant_id || invitation.mission_id !== mission.mission_id || invitation.identity_id !== desk.identity_id
          || invitation.signing_key_id !== desk.signing_key_id || invitation.public_key_hex !== keyHex || invitation.expires_at !== grant.expires_at) {
          throw new LobbyError("conflicting_renewal", "a door-signed directory renewal for this token names another grant; nothing was accepted. Ask the hub");
        }
      }
      pickup = { row: newest, seat, mission, grant, notice_sha256: notices.length === 0 ? null : documentSha256(notices[0]!.summary), move };
    }
  }

  // 2. The next request, unless the newest one is still open.
  let request: NextRequest | null = null;
  const open = pickup === null && newest !== undefined && newest.accepted_at === null && Date.parse(newest.expires_at) > now.getTime()
    ? newest : null;
  if (open !== null) {
    if (fleet.outbox(open.request_event_id)?.state !== "stored") {
      throw new LobbyError("request_unsent",
        `this desk's last directory renew request ${open.request_event_id} has no verified receipt; nothing was sent again. ` +
        `Inspect it, then run: outbox retry ${open.request_event_id}`);
    }
    return {
      idle: {
        status: "request_open",
        request: { event_id: open.request_event_id, grant_id: open.grant_id, expires_at: open.expires_at, mission_id: open.mission_id },
        grant_expires_at: heldDirectoryGrantEnd(ctx, directoryId),
      },
    };
  }
  // The directory the next request asks a grant in: the successor this act
  // moves to; else the door-signed successor of this desk's directory, asked
  // for from here (the hub reads requests in both while they overlap); else
  // this desk's directory.
  const successor = pickup?.move === null || pickup === null ? successorOf(ctx, desk, door, now) : null;
  const target = pickup?.move != null
    ? { mission_id: pickup.mission.mission_id, expires_at: pickup.mission.expires_at, successor: pickup.move.notice }
    : successor !== null
      ? { mission_id: successor.body.to_mission_id, expires_at: successor.body.to_expires_at, successor }
      : null;
  // The grant just picked up posts the next request when it has five minutes
  // left (in the directory it is for); otherwise a live seat in this desk's directory does.
  const pickupPosts = pickup !== null && Date.parse(pickup.grant.expires_at) > now.getTime() + POST_MARGIN_MS;
  const posting = pickupPosts ? null : liveSeat(ctx, directoryId, "mission.observe", POST_MARGIN_MS);
  let noRequest: string | null = null;
  if (!pickupPosts && posting === null) {
    if (pickup === null) {
      throw new LobbyError("directory_lapsed",
        `this desk holds no live directory grant to post a renew request with, and the hub issued none to pick up; renew it the long way: ${FALLBACK}`);
    }
    noRequest = `the grant picked up ends within five minutes, too soon to post the next request with; after it ends, use ${FALLBACK}`;
  }
  let currentEnds = pickup?.move != null ? null : pickup?.mission.expires_at ?? desk.directory_expires_at ?? null;
  if (target === null && currentEnds === null) {
    // A read with no effect: the directory's end bounds the request. (With a
    // pickup the end is already known, so `posting` is a live seat here.)
    currentEnds = (await participant(ctx).invitation(posting!)).mission.expires_at;
  }
  const requestEnds = target?.expires_at ?? currentEnds!;
  if (Date.parse(requestEnds) <= now.getTime() + HOUR_MS) {
    // A grant the hub issued before the last hour is still picked up.
    if (pickup === null) throw new LobbyError("directory_ending", `the directory ends at ${requestEnds}, within the hour; a new directory is needed`);
    noRequest ??= `the directory ends at ${requestEnds}, within the hour; a new directory is needed`;
  }
  const postIn = pickupPosts ? pickup!.seat.mission_id : directoryId;
  const targetId = target?.mission_id ?? directoryId;
  let sealedSummary: string | null = null;
  if (noRequest === null) {
    const token = secrets.prepareToken(now);
    const body: DirectoryRenewBody = {
      mission_id: targetId,
      grant_id: newUuid(),
      identity_id: desk.identity_id,
      signing_key_id: desk.signing_key_id,
      token_sha256: token.token_sha256,
      issued_at: now.toISOString(),
      expires_at: earliest(now.getTime() + RENEW_MAX_MS - CLOCK_MARGIN_MS, requestEnds),
    };
    sealedSummary = sealDocument("directory_renew", body, { privateKey: secrets.deskKey(), fingerprint: desk.fingerprint }).summary;
    request = {
      body,
      post: preparePost(ctx, "directory_renew", postIn, sealedSummary, DIRECTORY_GATE_ROOM),
      seat: posting,
      writeToken: token.write,
    };
  }

  const holdsUntil = pickup?.grant.expires_at ?? heldDirectoryGrantEnd(ctx, directoryId);
  const at = now.toISOString();
  const preview = actPreview("fleet.renew", directoryId, at, [
    ...(pickup === null ? [] : [
      `pick up directory grant ${pickup.grant.grant_id} ${pickup.grant.actions.join("+")} until ${pickup.grant.expires_at} (your request ${pickup.row.request_event_id})`,
      pickup.move === null
        ? `accept the same directory digest this desk joined: ${pickup.mission.mission_digest}`
        : `move this desk from directory ${pickup.move.from_mission_id} to its door-signed successor ${pickup.mission.mission_id} ` +
          `(notice sha256 ${pickup.move.notice.sha256}); accept its digest ${pickup.mission.mission_digest}, whose charter names the pinned door ` +
          `and that directory as its predecessor; the door pin is unchanged`,
      pickup.notice_sha256 === null ? "door-signed notice: not in the local cache (not needed for the pickup)"
        : `door-signed notice: seen, names exactly this grant (sha256 ${pickup.notice_sha256})`,
    ]),
    ...(request === null ? [`no next request: ${noRequest}`] : [
      `post a desk-signed directory_renew request to the fleet directory ${postIn}: grant id ${request.body.grant_id}, ` +
        `token sha256 ${request.body.token_sha256} (the token itself stays on this desk); good until ${request.body.expires_at}`,
      ...(targetId === postIn ? [] : [`the request asks for a grant in the door-signed successor directory ${targetId} (notice sha256 ` +
        `${target!.successor.sha256}); this desk moves there when it picks that grant up`]),
      `the hub must run hub renew-sweep before ${holdsUntil ?? "your directory grant ends"}; after that, use ${FALLBACK}`,
    ]),
  ], {
    pickup: pickup === null ? null : {
      mission_id: pickup.mission.mission_id,
      mission_digest: pickup.mission.mission_digest,
      grant_id: pickup.grant.grant_id,
      actions: pickup.grant.actions,
      expires_at: pickup.grant.expires_at,
      token_sha256: pickup.row.token_sha256,
      request_event_id: pickup.row.request_event_id,
      notice_sha256: pickup.notice_sha256,
      ...(pickup.move === null ? {} : {
        move: { from_mission_id: pickup.move.from_mission_id, to_mission_id: pickup.mission.mission_id,
          successor_notice: { event_id: pickup.move.notice.event_id, sha256: pickup.move.notice.sha256 } },
      }),
    },
    request: request === null ? null : {
      mission_id: postIn, event_id: request.post.event_id, grant_id: request.body.grant_id,
      token_sha256: request.body.token_sha256, expires_at: request.body.expires_at, summary: sealedSummary,
      ...(targetId === postIn ? {} : { target_mission_id: targetId }),
    },
    ...(noRequest === null ? {} : { no_request: noRequest }),
  });
  return { plan: { preview, pickup, request, no_request: noRequest, directory_expires_at: currentEnds, directory_mission_id: directoryId } };
}

export interface FleetRenewOutcome {
  picked_up: { grant_id: string; expires_at: string } | null;
  /** The directory this act moved the desk to, or null. */
  moved_to: string | null;
  request: PostOutcome | null;
}

export async function executeFleetRenew(ctx: FleetContext, plan: FleetRenewPlan): Promise<FleetRenewOutcome> {
  const desk = requireJoinedDesk(ctx);
  const fleet = ctx.store.fleet;
  const at = ctx.now().toISOString();
  let pickedUp: FleetRenewOutcome["picked_up"] = null;
  let movedTo: string | null = null;
  // Checked before the first network effect (and again where a pickup is
  // recorded): another terminal may have moved this desk while the prompt was open.
  if (desk.directory_mission_id !== plan.directory_mission_id) {
    throw new LobbyError("directory_changed", "this desk's directory changed while the prompt was open; nothing was accepted, recorded or sent");
  }
  if (plan.pickup !== null) {
    // Idempotent on the service: an accepted grant is accepted again. An
    // uncertain accept records nothing; running fleet renew again re-reads it.
    const accepted = await participant(ctx).accept(plan.pickup.seat, plan.pickup.mission.mission_digest);
    const pickup = plan.pickup;
    fleet.transaction(() => {
      if (fleet.deskGrant(pickup.seat.grant_id) === null) {
        fleet.addDeskGrant({
          grant_id: pickup.seat.grant_id,
          mission_id: pickup.seat.mission_id,
          mission_digest: pickup.mission.mission_digest,
          purpose: "directory",
          room_id: null,
          actions: accepted.grant.actions,
          token_sha256: pickup.seat.token_sha256,
          expires_at: accepted.grant.expires_at,
          accepted_at: accepted.grant.accepted_at,
          recorded_at: at,
        });
      } else {
        fleet.markDeskGrantAccepted(pickup.seat.grant_id, {
          mission_digest: pickup.mission.mission_digest,
          expires_at: accepted.grant.expires_at,
          accepted_at: accepted.grant.accepted_at!,
        });
      }
      if (fleet.desk()?.directory_mission_id !== plan.directory_mission_id) {
        throw new LobbyError("directory_changed", "this desk's directory changed while this act ran; nothing was recorded. Run fleet renew again");
      }
      fleet.markDeskDirectoryRenewalAccepted(pickup.row.token_sha256, at);
      if (pickup.move !== null) {
        // The move: this desk's directory is now the door-signed successor. The door pin is untouched.
        fleet.moveDeskDirectory({
          mission_id: pickup.mission.mission_id,
          mission_digest: pickup.mission.mission_digest,
          expires_at: accepted.mission.expires_at,
          predecessor_mission_id: pickup.move.from_mission_id,
          how: "successor",
          at,
        });
      } else fleet.setDeskDirectoryExpiry(accepted.mission.expires_at);
    });
    pickedUp = { grant_id: pickup.seat.grant_id, expires_at: accepted.grant.expires_at };
    movedTo = pickup.move === null ? null : pickup.mission.mission_id;
  }
  let posted: PostOutcome | null = null;
  if (plan.request !== null) {
    const request = plan.request;
    const seat = request.seat ?? seatOf(desk, fleet.deskGrant(plan.pickup!.seat.grant_id)!);
    // The token and the request's record are saved before the send, so an
    // uncertain send leaves the request recorded and its token on this desk.
    request.writeToken();
    fleet.transaction(() => {
      fleet.addDeskDirectoryRenewal({
        token_sha256: request.body.token_sha256,
        mission_id: request.body.mission_id,
        grant_id: request.body.grant_id,
        posted_mission_id: request.post.mission_id,
        request_event_id: request.post.event_id,
        requested_at: request.body.issued_at,
        expires_at: request.body.expires_at,
      });
      if (movedTo === null && plan.directory_expires_at !== null) fleet.setDeskDirectoryExpiry(plan.directory_expires_at);
    });
    posted = await sendPost(ctx, request.post, seat);
  }
  ctx.store.recordAct(actPreview("fleet.renew.outcome", plan.preview.subject, ctx.now().toISOString(), [], {
    picked_up: pickedUp,
    ...(movedTo === null ? {} : { moved_to: movedTo }),
    request: posted === null ? null : { event_id: posted.event_id, status: posted.status },
  }));
  return { picked_up: pickedUp, moved_to: movedTo, request: posted };
}

// ── Desk: status ───────────────────────────────────────────────────────

export interface DirectoryStatus {
  mission_id: string;
  ends_at: string | null;
  grant_expires_at: string | null;
  open_request: { event_id: string; grant_id: string; posted: boolean; expires_at: string; expired: boolean; mission_id: string } | null;
  /** The door-signed successor of this desk's directory, from the local
   * cache: announced (the next request names it), or conflicting (the door
   * signed more than one; fleet renew refuses), or null. */
  successor: { state: "announced"; mission_id: string; mission_digest: string; expires_at: string; notice_event_id: string }
    | { state: "conflicting" } | null;
  /** The directory this desk moved from, while it may matter, or null. */
  previous_mission_id: string | null;
}

/** This desk's directory renewal state, from local records only. */
export function directoryStatus(ctx: FleetContext): DirectoryStatus | null {
  const desk = ctx.store.fleet.desk();
  if (desk === null || desk.directory_mission_id === null) return null;
  const now = ctx.now();
  const newest = ctx.store.fleet.deskDirectoryRenewals()[0];
  const open = newest !== undefined && newest.accepted_at === null ? newest : null;
  const door = doorPin(ctx);
  let successor: DirectoryStatus["successor"] = null;
  if (door !== null) {
    try {
      const notice = successorOf(ctx, desk, door, now);
      if (notice !== null) {
        successor = { state: "announced", mission_id: notice.body.to_mission_id, mission_digest: notice.body.to_mission_digest,
          expires_at: notice.body.to_expires_at, notice_event_id: notice.event_id };
      }
    } catch (error) {
      if (!(error instanceof LobbyError) || error.code !== "conflicting_successors") throw error;
      successor = { state: "conflicting" };
    }
  }
  return {
    mission_id: desk.directory_mission_id,
    ends_at: desk.directory_expires_at ?? null,
    grant_expires_at: heldDirectoryGrantEnd(ctx, desk.directory_mission_id),
    open_request: open === null ? null : {
      event_id: open.request_event_id,
      grant_id: open.grant_id,
      posted: ctx.store.fleet.outbox(open.request_event_id)?.state === "stored",
      expires_at: open.expires_at,
      expired: Date.parse(open.expires_at) <= now.getTime(),
      mission_id: open.mission_id,
    },
    successor,
    previous_mission_id: deskPreviousDirectory(ctx, desk),
  };
}
