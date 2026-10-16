/** A member desk inside a room: table talk, renewal inside the term, leave.
 *
 * - `room sync/read/wait` read the season with this desk's own grant (a
 *   participant read, no Keychain), cache the raw events and verify table
 *   talk against the door-signed keyed roster. `room wait` polls at most every
 *   three seconds for at most 45 seconds, like the participant client.
 * - `room say` (tty) sends one `agenttool-mission-chat/v1` envelope to one
 *   current roster member, through the outbox and the egress gate.
 * - `room renew request` (tty) posts a desk-signed renew note bound to the
 *   SHA-256 of a fresh local token, in the room when this desk may post there
 *   and otherwise in the directory. `room renew accept` (tty) finds the
 *   door-signed renewal for that hash, rebuilds the token-free invitation
 *   template, reads the invitation with the new seat and accepts exactly the
 *   digest this desk accepted before.
 * - `room leave` (tty) posts a desk-signed leave notice when it can, then
 *   leaves every live grant of the season with `POST .../leave` and zero body
 *   bytes.
 *
 * Tokens stay in `<home>/secrets`; only their hashes are posted. Contract:
 * packages/lobby/README.md#table-talk and #renewal-leave-kick-and-block.
 */
import { LobbyError } from "./errors.js";
import { type GrantView, type MissionView, type ParticipantSeat } from "./hosted.js";
import { actionsFor } from "./hub.js";
import {
  actPreview,
  CLOCK_MARGIN_MS,
  doorPin,
  earliest,
  fleetView,
  liveSeat,
  participant,
  preparePost,
  requireJoinedDesk,
  requireSeat,
  roomGate,
  seasonOfRoom,
  seatOf,
  sendPost,
  syncMission,
  type FleetContext,
  type PostOutcome,
  type PreparedPost,
} from "./ops.js";
import type { DoorPin, VerifiedDocument } from "./fleet.js";
import type { DeskGrantRow, DeskRenewalRow, DeskRow } from "./fleet-store.js";
import { assertRoomId } from "./room.js";
import { DeskSecrets } from "./secrets.js";
import {
  documentSha256,
  invitationTemplateOf,
  publicKeyHexOf,
  RENEW_MAX_MS,
  sealDocument,
  type LeaveBody,
  type RenewalBody,
  type RenewBody,
} from "./signed.js";
import type { ActPreview } from "./store.js";
import {
  assertConversation,
  buildChatEnvelope,
  chatConfigOf,
  DEFAULT_CONVERSATION,
  findVerifiedMessage,
  READ_LIMIT_DEFAULT,
  readTable,
  resolveDestination,
  rosterOf,
  WAIT_DEFAULT_SECONDS,
  WAIT_MAX_SECONDS,
  WAIT_POLL_MS,
  type ChatEnvelope,
  type ChatKind,
  type RosterPin,
  type TableRead,
  type TableRoster,
} from "./table.js";
import { assertUuid, MISSIONS_PATH } from "./wire.js";

export interface RoomScope {
  desk: DeskRow & { directory_mission_id: string };
  room_id: string;
  mission_id: string;
  /** The season digest this desk accepted. */
  mission_digest: string;
  door: DoorPin;
}

export function roomScope(ctx: FleetContext, roomId: string): RoomScope {
  const room = assertRoomId(roomId);
  const desk = requireJoinedDesk(ctx);
  const door = doorPin(ctx);
  if (door === null) throw new LobbyError("door_not_pinned", "the door key is not pinned on this desk; run fleet join");
  const season = seasonOfRoom(ctx, room);
  return { desk, room_id: room, mission_id: season.mission_id, mission_digest: season.mission_digest, door };
}

const RENEW_HINT = "; renew it (room renew request, then room renew accept) or knock again";

// ── sync, read, wait ───────────────────────────────────────────────────

/** Read the room's new events into the local cache with this desk's own grant. */
export async function roomSync(ctx: FleetContext, roomId: string): Promise<{ added: number; cursor: string; mission_id: string }> {
  const scope = roomScope(ctx, roomId);
  const seat = liveSeat(ctx, scope.mission_id, "mission.read");
  if (seat === null) {
    // The host's seats are renewed by the hub itself, never by a renew request.
    const host = ctx.store.fleet.hub() !== null && ctx.store.getRoom(scope.room_id) !== null;
    throw new LobbyError("no_seat", `this desk holds no live grant to read that room${host ? `; run hub seat ${scope.room_id}` : RENEW_HINT}`);
  }
  return { ...(await syncMission(ctx, seat)), mission_id: scope.mission_id };
}

export interface RoomReadInput {
  room_id: string;
  after?: string;
  limit?: number;
  conversation?: string;
}

export interface RoomRead {
  scope: RoomScope;
  conversation: string;
  read: TableRead;
  synced_at: string | null;
}

/** Table talk from the local cache, verified against the door-signed roster now. */
export function roomReadCached(ctx: FleetContext, input: RoomReadInput): RoomRead {
  const scope = roomScope(ctx, input.room_id);
  const conversation = assertConversation(input.conversation ?? DEFAULT_CONVERSATION);
  const read = readTable(ctx.store.fleet.events(scope.mission_id), {
    mission_id: scope.mission_id,
    room_id: scope.room_id,
    door: scope.door,
    me: { identity_id: scope.desk.identity_id, signing_key_id: scope.desk.signing_key_id },
    conversation,
    after: input.after ?? "0",
    limit: input.limit ?? READ_LIMIT_DEFAULT,
  });
  return { scope, conversation, read, synced_at: ctx.store.fleet.lastSynced(scope.mission_id) };
}

export async function roomRead(ctx: FleetContext, input: RoomReadInput & { sync: boolean }): Promise<RoomRead> {
  if (input.sync) await roomSync(ctx, input.room_id);
  return roomReadCached(ctx, input);
}

export type WaitStop = "messages" | "timeout";

/** Poll the room (sync, then read the cache) until a table-talk item after
 * the cursor arrives or the bounded wait ends. Never wakes anyone; it only
 * runs while this command runs. */
export async function roomWait(ctx: FleetContext, input: RoomReadInput & { seconds?: number }): Promise<RoomRead & { stop_reason: WaitStop; polls: number }> {
  const seconds = input.seconds ?? WAIT_DEFAULT_SECONDS;
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > WAIT_MAX_SECONDS) {
    throw new LobbyError("invalid_seconds", `a wait lasts 1-${WAIT_MAX_SECONDS} whole seconds`);
  }
  const deadline = ctx.now().getTime() + seconds * 1000;
  let polls = 0;
  while (true) {
    polls += 1;
    await roomSync(ctx, input.room_id);
    const result = roomReadCached(ctx, input);
    if (result.read.messages.length > 0 || result.read.unverified.length > 0) return { ...result, stop_reason: "messages", polls };
    const remaining = deadline - ctx.now().getTime();
    if (remaining <= 0) return { ...result, stop_reason: "timeout", polls };
    await ctx.sleep(Math.min(WAIT_POLL_MS, remaining));
  }
}

// ── roster ─────────────────────────────────────────────────────────────

export function roomRoster(ctx: FleetContext, roomId: string): { scope: RoomScope; roster: TableRoster } {
  const scope = roomScope(ctx, roomId);
  return { scope, roster: rosterOf(ctx.store.fleet.events(scope.mission_id), scope.door, scope) };
}

/** A participant-client chat configuration for this room's current roster. */
export function roomChatConfig(ctx: FleetContext, input: { room_id: string; conversation?: string }) {
  const { scope, roster } = roomRoster(ctx, input.room_id);
  const mine = roster.members.find((member) => member.identity_id === scope.desk.identity_id);
  const card = fleetView(ctx, scope.desk.directory_mission_id, scope.door).cards.get(scope.room_id)?.envelope.body;
  const seasonEnd = card !== undefined && card.season.mission_id === scope.mission_id ? card.season.expires_at : null;
  const ends = [seasonEnd, mine?.term_ends_at].filter((value): value is string => value != null);
  if (ends.length === 0) throw new LobbyError("season_unknown", "neither the card nor the roster says when this season ends; run fleet sync and room sync");
  return chatConfigOf(roster, {
    mission_digest: scope.mission_digest,
    conversation: input.conversation ?? DEFAULT_CONVERSATION,
    me: { identity_id: scope.desk.identity_id },
    expires_at: earliest(...ends),
  });
}

// ── say ────────────────────────────────────────────────────────────────

export interface SayPlan {
  preview: ActPreview;
  envelope: ChatEnvelope;
  to: RosterPin;
  post: PreparedPost;
  seat: ParticipantSeat;
}

export async function planSay(ctx: FleetContext, input: {
  room_id: string;
  text: string;
  to?: string;
  in_reply_to?: string;
  kind?: ChatKind;
  conversation?: string;
}): Promise<SayPlan> {
  const scope = roomScope(ctx, input.room_id);
  const { seat } = requireSeat(ctx, scope.mission_id, "mission.observe", 60_000,
    "; spectators read the table but do not post, and a lapsed member renews first (room renew request, then room renew accept)");
  // Read first, so the roster and any message being answered are current.
  await roomSync(ctx, scope.room_id);
  const conversation = assertConversation(input.conversation ?? DEFAULT_CONVERSATION);
  const events = ctx.store.fleet.events(scope.mission_id);
  const roster = rosterOf(events, scope.door, scope);
  const me = { identity_id: scope.desk.identity_id, signing_key_id: scope.desk.signing_key_id };
  if (!roster.members.some((member) => member.identity_id === me.identity_id && member.signing_key_id === me.signing_key_id)) {
    throw new LobbyError("not_on_roster", "the newest door-signed roster of this room does not list this desk, so no member could verify its messages; ask the hub to post one (hub roster post)");
  }
  let replyTo;
  if (input.in_reply_to !== undefined) {
    replyTo = findVerifiedMessage(events, { mission_id: scope.mission_id, room_id: scope.room_id, door: scope.door, me, conversation },
      assertUuid(input.in_reply_to, "in_reply_to"));
    if (replyTo === null) {
      throw new LobbyError("reply_not_found", "no verified message with that event id in this conversation; run room read first");
    }
  }
  const to = resolveDestination(roster, me, { ...(input.to === undefined ? {} : { to: input.to }), ...(replyTo === undefined ? {} : { replyTo }) });
  const { envelope, summary } = buildChatEnvelope({
    conversation,
    to_identity: to.identity_id,
    kind: input.kind ?? "message",
    text: input.text,
    ...(input.in_reply_to === undefined ? {} : { in_reply_to: input.in_reply_to }),
  });
  const post = preparePost(ctx, "chat", scope.mission_id, summary, roomGate(ctx, scope.room_id));
  const at = ctx.now().toISOString();
  const preview = actPreview("room.say", scope.room_id, at, [
    `room ${scope.room_id} season ${scope.mission_id}; conversation ${conversation}`,
    `to ${to.fingerprint} did:at:${to.identity_id} (${to.role}, ${to.tier}; pinned by the door-signed roster)`,
    `${envelope.kind}${envelope.in_reply_to === undefined ? "" : ` answering ${envelope.in_reply_to}`}: ${JSON.stringify(envelope.text)}`,
    "every member of this season and the service can read it; it is sent once and never retried automatically",
  ], {
    room_id: scope.room_id,
    mission_id: scope.mission_id,
    event_id: post.event_id,
    to_identity: to.identity_id,
    raw_body: post.raw_body,
  });
  return { preview, envelope, to, post, seat };
}

export function executeSay(ctx: FleetContext, plan: SayPlan): Promise<PostOutcome> {
  return sendPost(ctx, plan.post, plan.seat);
}

// ── renew request ──────────────────────────────────────────────────────

export interface RenewRequestPlan {
  preview: ActPreview;
  body: RenewBody;
  post: PreparedPost;
  seat: ParticipantSeat;
  where: "room" | "directory";
  writeToken: () => void;
}

/** Ask for the next grant inside the term. The request carries only the
 * SHA-256 of a token generated here; the token is saved (0600) on yes. */
export async function planRenewRequest(ctx: FleetContext, input: { room_id: string }): Promise<RenewRequestPlan> {
  const scope = roomScope(ctx, input.room_id);
  const now = ctx.now();
  const card = fleetView(ctx, scope.desk.directory_mission_id, scope.door).cards.get(scope.room_id)?.envelope.body;
  if (card !== undefined && card.season.mission_id !== scope.mission_id) {
    throw new LobbyError("season_changed", "this room has a new season; renewal does not carry into it. Knock on the new season instead");
  }
  const inRoom = liveSeat(ctx, scope.mission_id, "mission.observe", 5 * 60_000);
  const inDirectory = liveSeat(ctx, scope.desk.directory_mission_id, "mission.observe", 5 * 60_000);
  const seat = inRoom ?? inDirectory;
  if (seat === null) {
    throw new LobbyError("no_seat", "this desk holds no live grant to post the request in the room or the directory; renew the directory grant first (enroll-device, hub relay, fleet join)");
  }
  const secrets = DeskSecrets.open(ctx.home);
  const token = secrets.prepareToken(now);
  const body: RenewBody = {
    room_id: scope.room_id,
    mission_id: scope.mission_id,
    identity_id: scope.desk.identity_id,
    signing_key_id: scope.desk.signing_key_id,
    token_sha256: token.token_sha256,
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + RENEW_MAX_MS - CLOCK_MARGIN_MS).toISOString(),
  };
  const sealed = sealDocument("renew", body, { privateKey: secrets.deskKey(), fingerprint: scope.desk.fingerprint });
  const post = preparePost(ctx, "renew", seat.mission_id, sealed.summary, roomGate(ctx, scope.room_id));
  const where = inRoom !== null ? "room" : "directory";
  const preview = actPreview("room.renew.request", scope.room_id, body.issued_at, [
    `room ${scope.room_id} season ${scope.mission_id}`,
    `ask the hub for the next grant, bound to the SHA-256 of a token generated here: ${body.token_sha256}`,
    `posted to the ${where === "room" ? "room's season" : "fleet directory (this desk may not post in the room)"} ${seat.mission_id}; request good until ${body.expires_at}`,
    "the hub renews only inside your term, and not while the owner has paused you",
  ], { room_id: scope.room_id, mission_id: seat.mission_id, event_id: post.event_id, summary: sealed.summary });
  return { preview, body, post, seat, where, writeToken: token.write };
}

export async function executeRenewRequest(ctx: FleetContext, plan: RenewRequestPlan): Promise<PostOutcome> {
  plan.writeToken();
  ctx.store.fleet.addDeskRenewal({
    token_sha256: plan.body.token_sha256,
    room_id: plan.body.room_id,
    mission_id: plan.body.mission_id,
    posted_mission_id: plan.post.mission_id,
    request_event_id: plan.post.event_id,
    requested_at: plan.body.issued_at,
  });
  return sendPost(ctx, plan.post, plan.seat);
}

// ── renew accept ───────────────────────────────────────────────────────

export interface RenewAcceptPlan {
  preview: ActPreview;
  pending: DeskRenewalRow;
  renewal: RenewalBody;
  template: Record<string, string>;
  seat: ParticipantSeat;
  mission: MissionView;
  grant: GrantView;
}

/** Pick up a door-signed renewal: assemble the seat from its template and
 * this desk's own token, read the invitation, and check that the charter is
 * exactly the one this desk accepted before. Nothing is accepted yet. */
export async function planRenewAccept(ctx: FleetContext, input: { room_id: string }): Promise<RenewAcceptPlan> {
  const scope = roomScope(ctx, input.room_id);
  const now = ctx.now();
  const fleet = ctx.store.fleet;
  const pending = fleet.deskRenewals(scope.room_id).filter((row) => row.accepted_at === null && row.mission_id === scope.mission_id);
  if (pending.length === 0) throw new LobbyError("no_pending_renewal", "this desk has no open renew request for that room; run room renew request first");
  // Read wherever this desk still may: the renewal notice is posted where the request was.
  for (const missionId of [scope.mission_id, scope.desk.directory_mission_id]) {
    const seat = liveSeat(ctx, missionId, "mission.read");
    if (seat !== null) await syncMission(ctx, seat);
  }
  const hashes = new Set(pending.map((row) => row.token_sha256));
  const notices: VerifiedDocument<RenewalBody>[] = [scope.mission_id, scope.desk.directory_mission_id]
    .flatMap((missionId) => fleetView(ctx, missionId, scope.door).renewals)
    .filter((document) => {
      const body = document.envelope.body;
      return body.room_id === scope.room_id && hashes.has(body.invitation.token_sha256) && body.invitation.mission_id === scope.mission_id
        && body.invitation.identity_id === scope.desk.identity_id && body.invitation.signing_key_id === scope.desk.signing_key_id;
    });
  const row = pending.find((candidate) => notices.some((document) => document.envelope.body.invitation.token_sha256 === candidate.token_sha256));
  if (row === undefined) throw new LobbyError("not_renewed_yet", "no door-signed renewal for this desk's open request yet; the hub renews when it runs hub renew-sweep");
  const matching = notices.filter((document) => document.envelope.body.invitation.token_sha256 === row.token_sha256);
  if (new Set(matching.map((document) => document.summary)).size > 1) {
    throw new LobbyError("conflicting_renewals", "the door signed different renewals for one token; ask the hub");
  }
  const document = matching[0]!;
  const renewal = document.envelope.body;
  if (renewal.invitation.public_key_hex !== publicKeyHexOf(scope.desk.public_key)) {
    throw new LobbyError("renewal_mismatch", "the renewal names another public key than this desk's");
  }
  if (Date.parse(renewal.invitation.expires_at) <= now.getTime()) {
    throw new LobbyError("renewal_expired", "the renewed grant has already expired; request another");
  }
  if (!DeskSecrets.open(ctx.home).hasToken(row.token_sha256)) throw new LobbyError("token_not_found", "the request's token is missing on this desk");
  const template = invitationTemplateOf(renewal);
  const seat: ParticipantSeat = {
    mission_id: renewal.invitation.mission_id,
    grant_id: renewal.invitation.grant_id,
    identity_id: scope.desk.identity_id,
    signing_key_id: scope.desk.signing_key_id,
    token_sha256: row.token_sha256,
  };
  const { mission, grant } = await participant(ctx).invitation(seat);
  if (mission.mission_digest !== scope.mission_digest) {
    throw new LobbyError("digest_changed", "the season's charter digest differs from the one this desk accepted; nothing was accepted");
  }
  if (mission.project_id !== scope.desk.project_id) {
    throw new LobbyError("project_mismatch", "the season mission belongs to another project than this desk's; nothing was accepted");
  }
  if (mission.revoked_at !== null || grant.revoked_at !== null || grant.actions.join(",") !== actionsFor(renewal.tier).join(",")
    || grant.expires_at !== renewal.invitation.expires_at) {
    throw new LobbyError("grant_mismatch", "the renewed grant does not match the door-signed renewal");
  }
  const preview = actPreview("room.renew.accept", scope.room_id, now.toISOString(), [
    `room ${scope.room_id} season ${mission.mission_id}`,
    `accept the same charter digest this desk accepted before: ${mission.mission_digest}`,
    `renewed grant ${grant.grant_id} ${grant.actions.join("+")} until ${grant.expires_at}; term ends ${renewal.term_ends_at}`,
    `token sha256 ${row.token_sha256} (the token itself stays on this desk)`,
  ], {
    room_id: scope.room_id,
    renewal_sha256: documentSha256(document.summary),
    invitation_template: template,
    mission_digest: mission.mission_digest,
    term_ends_at: renewal.term_ends_at,
  });
  return { preview, pending: row, renewal, template, seat, mission, grant };
}

export async function executeRenewAccept(ctx: FleetContext, plan: RenewAcceptPlan): Promise<{ grant_id: string; expires_at: string }> {
  const accepted = await participant(ctx).accept(plan.seat, plan.mission.mission_digest);
  const fleet = ctx.store.fleet;
  const at = ctx.now().toISOString();
  fleet.transaction(() => {
    if (fleet.deskGrant(plan.seat.grant_id) === null) {
      fleet.addDeskGrant({
        grant_id: plan.seat.grant_id,
        mission_id: plan.seat.mission_id,
        mission_digest: plan.mission.mission_digest,
        purpose: "season",
        room_id: plan.renewal.room_id,
        actions: accepted.grant.actions,
        token_sha256: plan.seat.token_sha256,
        expires_at: accepted.grant.expires_at,
        accepted_at: accepted.grant.accepted_at,
        recorded_at: at,
      });
    }
    fleet.markDeskRenewalAccepted(plan.pending.token_sha256, plan.seat.grant_id, at);
  });
  return { grant_id: plan.seat.grant_id, expires_at: accepted.grant.expires_at };
}

// ── leave ──────────────────────────────────────────────────────────────

export interface LeavePlan {
  preview: ActPreview;
  scope: RoomScope;
  grants: DeskGrantRow[];
  notice: { post: PreparedPost; seat: ParticipantSeat } | null;
}

export async function planLeave(ctx: FleetContext, input: { room_id: string }): Promise<LeavePlan> {
  const scope = roomScope(ctx, input.room_id);
  if (ctx.store.fleet.hub() !== null && ctx.store.getRoom(scope.room_id) !== null) {
    throw new LobbyError("host_cannot_leave", "this desk is the room's host; let the season end, or use hub stop");
  }
  const now = ctx.now();
  const grants = ctx.store.fleet.deskSeasonGrants(scope.room_id).filter((grant) => grant.mission_id === scope.mission_id
    && grant.accepted_at !== null && (grant.left_at ?? null) === null && grant.expires_at !== null && Date.parse(grant.expires_at) > now.getTime());
  if (grants.length === 0) throw new LobbyError("not_seated", "this desk holds no live grant in that room to leave");
  const seat = liveSeat(ctx, scope.mission_id, "mission.observe", 2 * 60_000)
    ?? liveSeat(ctx, scope.desk.directory_mission_id, "mission.observe", 2 * 60_000);
  let notice: LeavePlan["notice"] = null;
  if (seat !== null) {
    const body: LeaveBody = {
      room_id: scope.room_id,
      mission_id: scope.mission_id,
      identity_id: scope.desk.identity_id,
      signing_key_id: scope.desk.signing_key_id,
      issued_at: now.toISOString(),
    };
    const summary = sealDocument("leave", body, { privateKey: DeskSecrets.open(ctx.home).deskKey(), fingerprint: scope.desk.fingerprint }).summary;
    notice = { post: preparePost(ctx, "leave", seat.mission_id, summary, roomGate(ctx, scope.room_id)), seat };
  }
  const preview = actPreview("room.leave", scope.room_id, now.toISOString(), [
    `room ${scope.room_id} season ${scope.mission_id}`,
    ...grants.map((grant) => `leave grant ${grant.grant_id} (until ${grant.expires_at}): POST ${MISSIONS_PATH}/${grant.mission_id}/leave with zero body bytes`),
    notice === null ? "no leave notice: this desk may not post anywhere now" : `first post a desk-signed leave notice to ${notice.post.mission_id} so the hub drops you from the roster`,
    "leaving is final for these grants; joining again means a new knock",
  ], {
    room_id: scope.room_id,
    mission_id: scope.mission_id,
    leave: grants.map((grant) => ({ grant_id: grant.grant_id, request: `POST ${MISSIONS_PATH}/${grant.mission_id}/leave`, body_bytes: 0 })),
    notice: notice === null ? null : { mission_id: notice.post.mission_id, event_id: notice.post.event_id, summary: notice.post.summary },
  });
  return { preview, scope, grants, notice };
}

export interface LeaveOutcome {
  grant_id: string;
  status: "left" | "uncertain" | "refused";
  revoked_at?: string;
  error?: string;
}

export async function executeLeave(ctx: FleetContext, plan: LeavePlan): Promise<{ notice: PostOutcome | null; grants: LeaveOutcome[] }> {
  const notice = plan.notice === null ? null : await sendPost(ctx, plan.notice.post, plan.notice.seat);
  const client = participant(ctx);
  const outcomes: LeaveOutcome[] = [];
  for (const grant of plan.grants) {
    try {
      const left = await client.leave(seatOf(plan.scope.desk, grant));
      ctx.store.fleet.markDeskGrantLeft(grant.grant_id, ctx.now().toISOString());
      outcomes.push({ grant_id: grant.grant_id, status: "left", revoked_at: left.revoked_at });
    } catch (error) {
      const definite = error instanceof LobbyError && error.code === "hosted_refused"
        && typeof error.details.status === "number" && error.details.status < 500;
      outcomes.push({
        grant_id: grant.grant_id,
        status: definite ? "refused" : "uncertain",
        error: error instanceof LobbyError ? `${error.code}: ${error.message}` : "internal_error: the leave failed unexpectedly",
      });
    }
  }
  // What happened, as its own audit entry after the confirmed one.
  ctx.store.recordAct(actPreview("room.leave.outcome", plan.scope.room_id, ctx.now().toISOString(), [], {
    notice: notice === null ? null : { event_id: notice.event_id, status: notice.status },
    grants: outcomes.map(({ grant_id, status, revoked_at }) => ({ grant_id, status, revoked_at: revoked_at ?? null })),
  }));
  return { notice, grants: outcomes };
}
