/** Device side of the fleet hall: enroll-device, fleet join, fleet sync,
 * browse, knock, ready and outbox retry.
 *
 * One desk identity per device; Claude sessions are seats of it. The desk
 * key and every token preimage stay in `<home>/secrets`; only public packets
 * and token hashes leave the device. Contract: packages/lobby/README.md#fleet-hall.
 */
import { LobbyError } from "./errors.js";
import { filterFleetCards, type FleetCardFilter, type FleetView, type UnverifiedEvent, type VerifiedDocument } from "./fleet.js";
import { DIRECTORY_GATE_ROOM, assertSendable, type GateRoom, type GrantView, type MissionView, type ParticipantSeat } from "./hosted.js";
import { movedLeasesLine, successorOf, type SuccessorNotice } from "./directory-renewal.js";
import { endMovedLeases } from "./lease.js";
import {
  actPreview,
  currentGate,
  deskFleetView,
  deviceTerms,
  doorPin,
  gateOfCard,
  participant,
  preparePost,
  requireDesk,
  requireJoinedDesk,
  requireSeat,
  sendPost,
  syncMission,
  syncPreviousDirectory,
  type FleetContext,
  type PostOutcome,
  type PreparedPost,
} from "./ops.js";
import { buildEnrollmentPacket, namesDoor, namesPredecessor, parseJoinPacket, type EnrollmentPacket, type JoinPacket } from "./packets.js";
import { assertFingerprint, newPinRecord, type PinRecord } from "./pins.js";
import { DeskSecrets } from "./secrets.js";
import {
  documentSha256,
  KNOCK_MAX_MS,
  NOTE_MAX,
  sealDocument,
  type AdmissionBody,
  type FleetCard,
  type KnockBody,
} from "./signed.js";
import type { ActPreview } from "./store.js";
import { checkText } from "./text.js";
import { assertUuid, didKeyOf, LOBBY_ORIGIN, newUuid, publicKeyFingerprint, sha256HexOf, type MissionAction } from "./wire.js";

// ── enroll-device ──────────────────────────────────────────────────────

export interface EnrollResult {
  packet: EnrollmentPacket;
  created: boolean;
}

/** Create this desk (key, identity ids) once, generate a fresh directory
 * token, and sign one public packet. Nothing is sent anywhere. */
export function enrollDevice(ctx: FleetContext, input: { project_id?: string; display_name?: string }): EnrollResult {
  const now = ctx.now();
  const fleet = ctx.store.fleet;
  const secrets = DeskSecrets.open(ctx.home);
  let desk = fleet.desk();
  let created = false;
  if (desk === null) {
    if (input.project_id === undefined) throw new LobbyError("project_required", "the first enroll-device needs --project <hub project uuid>");
    const projectId = assertUuid(input.project_id, "project_id");
    // A key without a desk row is this desk's own key from an interrupted run.
    const key = secrets.hasDeskKey()
      ? { public_key: secrets.deskPublicKey(), fingerprint: publicKeyFingerprint(secrets.deskPublicKey()) }
      : secrets.createDeskKey();
    const displayName = input.display_name ?? `desk ${key.fingerprint.slice(0, 8)}`;
    checkText(displayName, { field: "display_name", min: 1, max: 128 });
    // A desk name is public: it must pass the gate (no device names, paths or addresses).
    assertSendable(displayName, DIRECTORY_GATE_ROOM, deviceTerms(ctx));
    fleet.createDesk({
      project_id: projectId,
      origin: LOBBY_ORIGIN,
      identity_id: newUuid(),
      signing_key_id: newUuid(),
      public_key: key.public_key,
      fingerprint: key.fingerprint,
      display_name: displayName,
      created_at: now.toISOString(),
    });
    desk = fleet.desk()!;
    created = true;
  } else {
    if (input.project_id !== undefined && input.project_id !== desk.project_id) {
      throw new LobbyError("project_mismatch", "this desk is enrolled for another project; one desk identity per device");
    }
    if (input.display_name !== undefined && input.display_name !== desk.display_name) {
      throw new LobbyError("display_name_fixed", "the desk display name is fixed at its first enrollment");
    }
    if (secrets.deskPublicKey() !== desk.public_key) {
      throw new LobbyError("desk_key_changed", "the desk key file no longer matches this desk's recorded public key");
    }
  }
  const kind = desk.joined_at === null ? "enroll" : "renew";
  const { token_sha256 } = secrets.newToken(now);
  const packet = buildEnrollmentPacket({
    kind,
    desk,
    key: secrets.deskKey(),
    directoryTokenSha256: token_sha256,
    now,
  });
  ctx.store.recordAct(actPreview("desk.enroll", desk.identity_id, now.toISOString(), [], {
    kind,
    identity_id: desk.identity_id,
    signing_key_id: desk.signing_key_id,
    fingerprint: desk.fingerprint,
    display_name: desk.display_name,
    directory_token_sha256: token_sha256,
    packet_sha256: sha256HexOf(JSON.stringify(packet)),
  }));
  return { packet, created };
}

// ── fleet join ─────────────────────────────────────────────────────────

export interface JoinPlan {
  preview: ActPreview;
  packet: JoinPacket;
  seat: ParticipantSeat;
  mission: MissionView;
  grant: GrantView;
  pin: PinRecord | null;
  /** Set when a joined desk joins the door-signed successor of its
   * directory (the way back in after a lapse during a rollover). */
  move: { from_mission_id: string; notice: SuccessorNotice } | null;
}

/** Validate a carried join packet against this desk and the typed door
 * fingerprint, then read (not accept) the directory invitation. */
export async function planJoin(ctx: FleetContext, input: { packetText: string; doorFingerprint: string }): Promise<JoinPlan> {
  const desk = requireDesk(ctx);
  const now = ctx.now();
  const packet = parseJoinPacket(input.packetText);
  const typed = assertFingerprint(input.doorFingerprint);
  if (typed !== packet.door.fingerprint) {
    throw new LobbyError("door_fingerprint_mismatch", "the door fingerprint you typed does not match the join packet; nothing was pinned");
  }
  const template = packet.invitation_template;
  if (packet.project_id !== desk.project_id || template.identity_id !== desk.identity_id
    || template.signing_key_id !== desk.signing_key_id || template.public_key !== desk.public_key) {
    throw new LobbyError("join_not_for_this_desk", "the join packet names another project, identity or key");
  }
  if (!DeskSecrets.open(ctx.home).hasToken(template.token_sha256)) {
    throw new LobbyError("token_not_found", "no token generated on this desk matches the packet's token hash");
  }
  // A joined desk stays in its directory, with one exception: the
  // door-signed successor of that directory (the pinned door's own notice is
  // in this desk's cache, and the charter names the door and its predecessor
  // below). The door pin never changes.
  let successor: SuccessorNotice | null = null;
  if (desk.joined_at !== null) {
    if (packet.door.fingerprint !== desk.door_fingerprint) {
      throw new LobbyError("door_changed", "the packet names a different door key from the one this desk pinned");
    }
    if (packet.directory.mission_id !== desk.directory_mission_id) {
      const door = doorPin(ctx);
      successor = door === null ? null : successorOf(ctx, desk, door, now);
      if (successor === null || successor.body.to_mission_id !== packet.directory.mission_id
        || successor.body.to_mission_digest !== packet.directory.mission_digest) {
        throw new LobbyError("directory_changed",
          "this desk joined another directory mission; it moves only to the door-signed successor of its own directory");
      }
    }
  }
  if (Date.parse(template.expires_at) <= now.getTime()) throw new LobbyError("grant_expired", "the directory grant in this packet has expired");
  const seat: ParticipantSeat = {
    mission_id: template.mission_id,
    grant_id: template.grant_id,
    identity_id: desk.identity_id,
    signing_key_id: desk.signing_key_id,
    token_sha256: template.token_sha256,
  };
  const { mission, grant } = await participant(ctx).invitation(seat);
  if (mission.mission_digest !== packet.directory.mission_digest) {
    throw new LobbyError("digest_mismatch", "the directory mission's digest differs from the join packet; nothing was accepted");
  }
  if (mission.revoked_at !== null || grant.revoked_at !== null || Date.parse(mission.expires_at) <= now.getTime()) {
    throw new LobbyError("directory_closed", "the directory mission or this grant is revoked or expired");
  }
  if (!namesDoor(mission.descriptor, packet.door)) {
    throw new LobbyError("door_not_in_charter", "the directory descriptor does not name this door key; nothing was accepted or pinned");
  }
  if (mission.project_id !== desk.project_id) {
    throw new LobbyError("project_mismatch", "the directory mission belongs to another project than this desk's; nothing was accepted or pinned");
  }
  if (!grant.actions.includes("mission.read") || !grant.actions.includes("mission.observe")) {
    throw new LobbyError("grant_scope", "the directory grant must allow mission.read and mission.observe");
  }
  if (successor !== null && (mission.expires_at !== successor.body.to_expires_at
    || !namesPredecessor(mission.descriptor, { mission_id: desk.directory_mission_id!, mission_digest: desk.directory_digest! }))) {
    throw new LobbyError("successor_mismatch",
      "the directory is not exactly the door-signed successor of this desk's directory (its end or its predecessor differs); nothing was accepted");
  }
  const at = now.toISOString();
  // Pin whenever the door key is not in the pin book: at the first join, and
  // again on a joined desk whose door pin was removed (the typed fingerprint
  // must still be the door this desk joined with, checked above).
  const pinned = ctx.store.findPin({ fingerprint: packet.door.fingerprint }) !== null;
  const pin = pinned ? null : newPinRecord({
    did: didKeyOf(packet.door.public_key),
    kid: "door",
    public_key: packet.door.public_key,
    petname: "fleet door",
    how_obtained: "hub join packet; fingerprint typed from the hub terminal",
  }, at);
  const pinState = pinned ? "kept" : desk.joined_at === null ? "new" : "restored";
  const preview = actPreview("fleet.join", packet.directory.mission_id, at, [
    `door fingerprint ${packet.door.fingerprint} (matches what you typed; ${pinned ? "pinned already" : desk.joined_at === null ? "pinned now" : "its pin was missing and is restored now"})`,
    `directory mission ${packet.directory.mission_id}`,
    `digest ${mission.mission_digest} (accepting exactly this descriptor)`,
    `purpose ${JSON.stringify(mission.descriptor.purpose)}`,
    `grant ${grant.grant_id} ${grant.actions.join("+")} until ${grant.expires_at}`,
    ...(successor === null ? [] : [`move this desk from directory ${desk.directory_mission_id} to its door-signed successor ` +
      `${mission.mission_id} (notice sha256 ${successor.sha256}); the door pin is unchanged`, ...movedLeasesLine(ctx, desk.directory_mission_id)]),
  ], {
    directory: {
      mission_id: mission.mission_id,
      mission_digest: mission.mission_digest,
      expires_at: mission.expires_at,
      descriptor: mission.descriptor,
    },
    door: { fingerprint: packet.door.fingerprint, public_key: packet.door.public_key, pin: pinState },
    grant: { grant_id: grant.grant_id, actions: grant.actions, expires_at: grant.expires_at, token_sha256: template.token_sha256 },
    ...(successor === null ? {} : {
      move: { from_mission_id: desk.directory_mission_id, to_mission_id: mission.mission_id,
        successor_notice: { event_id: successor.event_id, sha256: successor.sha256 } },
    }),
  });
  return { preview, packet, seat, mission, grant, pin, move: successor === null ? null : { from_mission_id: desk.directory_mission_id!, notice: successor } };
}

export async function executeJoin(ctx: FleetContext, plan: JoinPlan): Promise<{ grant_id: string; expires_at: string; pinned: boolean }> {
  const fleet = ctx.store.fleet;
  // A move is checked before the accept (and again where it is recorded):
  // another terminal may have moved this desk while the prompt was open.
  if (plan.move !== null && fleet.desk()?.directory_mission_id !== plan.move.from_mission_id) {
    throw new LobbyError("directory_changed", "this desk's directory changed while the prompt was open; nothing was accepted or recorded");
  }
  const accepted = await participant(ctx).accept(plan.seat, plan.mission.mission_digest);
  const at = ctx.now().toISOString();
  fleet.transaction(() => {
    if (fleet.deskGrant(plan.seat.grant_id) === null) {
      fleet.addDeskGrant({
        grant_id: plan.seat.grant_id,
        mission_id: plan.seat.mission_id,
        mission_digest: plan.mission.mission_digest,
        purpose: "directory",
        room_id: null,
        actions: accepted.grant.actions,
        token_sha256: plan.seat.token_sha256,
        expires_at: accepted.grant.expires_at,
        accepted_at: accepted.grant.accepted_at,
        recorded_at: at,
      });
    } else {
      fleet.markDeskGrantAccepted(plan.seat.grant_id, {
        mission_digest: plan.mission.mission_digest,
        expires_at: accepted.grant.expires_at,
        accepted_at: accepted.grant.accepted_at!,
      });
    }
    if (plan.pin !== null) ctx.store.insertPinWithinAct(plan.pin);
    // The first join records the directory and door; a later join (renewal,
    // or restoring a removed door pin) keeps them as they are, except a join
    // into the door-signed successor, which moves the desk there.
    if (plan.move !== null) {
      if (fleet.desk()?.directory_mission_id !== plan.move.from_mission_id) {
        throw new LobbyError("directory_changed", "this desk's directory changed while this act ran; nothing was recorded. Run fleet join again");
      }
      fleet.moveDeskDirectory({
        mission_id: plan.mission.mission_id, mission_digest: plan.mission.mission_digest, expires_at: plan.mission.expires_at,
        predecessor_mission_id: plan.move.from_mission_id, how: "join", at,
      });
    } else if (fleet.desk()?.joined_at === null) {
      fleet.setDeskJoined({
        directory_mission_id: plan.packet.directory.mission_id,
        directory_digest: plan.mission.mission_digest,
        door_fingerprint: plan.packet.door.fingerprint,
        joined_at: at,
      });
    }
    // The directory's end, for fleet renew and fleet status (version 4).
    if (fleet.v4 && fleet.desk()?.directory_mission_id === plan.mission.mission_id) fleet.setDeskDirectoryExpiry(plan.mission.expires_at);
  });
  // A move ends every room seat lease bound to the directory this desk left.
  if (plan.move !== null) endMovedLeases(ctx);
  return { grant_id: plan.seat.grant_id, expires_at: accepted.grant.expires_at, pinned: plan.pin !== null };
}

// ── fleet sync and browse ──────────────────────────────────────────────

export async function fleetSync(ctx: FleetContext): Promise<{ added: number; cursor: string }> {
  const desk = requireJoinedDesk(ctx);
  const { seat } = requireSeat(ctx, desk.directory_mission_id, "mission.read", 0,
    "; renew it: enroll-device here, hub relay on the hub, fleet join here");
  const result = await syncMission(ctx, seat);
  // The directory this desk moved from, while it may still read it: a knock
  // posted there before the move is answered there.
  await syncPreviousDirectory(ctx, desk);
  return result;
}

export interface FleetListing {
  cards: VerifiedDocument<FleetCard>[];
  unverified: UnverifiedEvent[];
  synced_at: string | null;
}

/** Cards from the local cache, re-verified against the pinned door key now. */
export function fleetCards(ctx: FleetContext, filter: FleetCardFilter = {}): FleetListing {
  const desk = requireJoinedDesk(ctx);
  const view = deskFleetView(ctx, desk, doorPin(ctx));
  return {
    cards: filterFleetCards(view, filter),
    unverified: view.unverified,
    synced_at: ctx.store.fleet.lastSynced(desk.directory_mission_id),
  };
}

function requireCard(view: FleetView, roomId: string): VerifiedDocument<FleetCard> {
  const card = view.cards.get(roomId);
  if (card === undefined) {
    throw new LobbyError("card_not_found", "no door-verified card for that room in the local cache; run fleet sync");
  }
  return card;
}

// ── knock ──────────────────────────────────────────────────────────────

export interface KnockPlan {
  preview: ActPreview;
  body: KnockBody;
  post: PreparedPost;
  seat: ParticipantSeat;
  card: FleetCard;
  writeToken: () => void;
}

export function planKnock(ctx: FleetContext, input: { room_id: string; tier: "player" | "spectator"; note?: string; hours?: number }): KnockPlan {
  const desk = requireJoinedDesk(ctx);
  const now = ctx.now();
  const door = doorPin(ctx);
  if (door === null) throw new LobbyError("door_not_pinned", "the door key is not pinned on this desk; run fleet join");
  const { seat } = requireSeat(ctx, desk.directory_mission_id, "mission.observe", 5 * 60_000,
    "; renew it: enroll-device here, hub relay on the hub, fleet join here");
  const card = requireCard(deskFleetView(ctx, desk, door), input.room_id).envelope.body;
  if (card.door !== "knock") throw new LobbyError("door_invite_only", "this room's door is invite-only; it takes no knocks");
  if (card.status === "closed") throw new LobbyError("room_closed", "this room is closed");
  if (Date.parse(card.season.expires_at) <= now.getTime()) throw new LobbyError("season_ended", "this room's season has ended");
  const hours = input.hours ?? 72;
  if (!Number.isInteger(hours) || hours < 1 || hours * 3_600_000 > KNOCK_MAX_MS) {
    throw new LobbyError("invalid_hours", "a knock lasts 1-72 whole hours");
  }
  const note = checkText(input.note ?? "", { field: "note", min: 0, max: NOTE_MAX, multiline: true });
  const secrets = DeskSecrets.open(ctx.home);
  const token = secrets.prepareToken(now);
  const body: KnockBody = {
    knock_id: newUuid(),
    room_id: card.room_id,
    charter_digest: card.season.mission_digest,
    tier: input.tier,
    token_sha256: token.token_sha256,
    note,
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + hours * 3_600_000).toISOString(),
  };
  const sealed = sealDocument("knock", body, { privateKey: secrets.deskKey(), fingerprint: desk.fingerprint });
  const post = preparePost(ctx, "knock", desk.directory_mission_id, sealed.summary, gateOfCard(card));
  const preview = actPreview("fleet.knock", body.knock_id, body.issued_at, [
    `room ${card.room_id} ${JSON.stringify(card.title)}`,
    `tier ${body.tier}; knock expires ${body.expires_at}`,
    `note ${JSON.stringify(note)} (visible to every fleet device and to the service)`,
    `signed by this desk ${desk.fingerprint}; posted to the fleet directory ${desk.directory_mission_id}`,
  ], { knock_id: body.knock_id, room_id: card.room_id, mission_id: desk.directory_mission_id, event_id: post.event_id, summary: sealed.summary });
  return { preview, body, post, seat, card, writeToken: token.write };
}

export async function executeKnock(ctx: FleetContext, plan: KnockPlan): Promise<PostOutcome> {
  plan.writeToken();
  ctx.store.fleet.addDeskKnock({
    knock_id: plan.body.knock_id,
    room_id: plan.body.room_id,
    mission_id: plan.card.season.mission_id,
    charter_digest: plan.body.charter_digest,
    tier: plan.body.tier,
    token_sha256: plan.body.token_sha256,
    summary: plan.post.summary,
    event_id: plan.post.event_id,
    issued_at: plan.body.issued_at,
    expires_at: plan.body.expires_at,
  });
  return sendPost(ctx, plan.post, plan.seat);
}

// ── knock status and ready ─────────────────────────────────────────────

export type KnockStatus = "waiting" | "admitted" | "denied" | "expired" | "ready";

export interface KnockState {
  knock_id: string;
  room_id: string;
  tier: string;
  issued_at: string;
  expires_at: string;
  status: KnockStatus;
  outbox: "stored" | "pending" | "missing";
  denial_reason?: string;
}

export function knockStates(ctx: FleetContext): KnockState[] {
  const desk = requireJoinedDesk(ctx);
  const view = deskFleetView(ctx, desk, doorPin(ctx));
  const now = ctx.now().getTime();
  return ctx.store.fleet.listDeskKnocks().map((knock) => {
    const mine = (body: { knock_id: string; identity_id: string }) => body.knock_id === knock.knock_id && body.identity_id === desk.identity_id;
    const denial = view.denials.find((document) => mine(document.envelope.body));
    const admission = view.admissions.find((document) => mine(document.envelope.body));
    const outbox = ctx.store.fleet.outbox(knock.event_id);
    const status: KnockStatus = knock.ready_at !== null ? "ready"
      : denial !== undefined ? "denied"
      : admission !== undefined ? "admitted"
      : Date.parse(knock.expires_at) <= now ? "expired"
      : "waiting";
    return {
      knock_id: knock.knock_id,
      room_id: knock.room_id,
      tier: knock.tier,
      issued_at: knock.issued_at,
      expires_at: knock.expires_at,
      status,
      outbox: outbox === null ? "missing" : outbox.state,
      ...(denial === undefined ? {} : { denial_reason: denial.envelope.body.reason }),
    };
  });
}

export interface ReadyPlan {
  preview: ActPreview;
  seat: ParticipantSeat;
  mission: MissionView;
  grant: GrantView;
  admission: AdmissionBody;
}

function actionsFor(tier: "player" | "spectator"): MissionAction[] {
  return tier === "player" ? ["mission.observe", "mission.read"] : ["mission.read"];
}

/** Re-read the directory, the card and the season descriptor, check every
 * digest agrees, and assemble the season seat from the door-signed admission. */
export async function planReady(ctx: FleetContext, input: { knock_id: string }): Promise<ReadyPlan> {
  const desk = requireJoinedDesk(ctx);
  const knockId = assertUuid(input.knock_id, "knock_id");
  const knock = ctx.store.fleet.deskKnock(knockId);
  if (knock === null) throw new LobbyError("knock_not_found", "this desk sent no knock with that id");
  if (knock.ready_at !== null) throw new LobbyError("admission_used", "this knock's admission was already used; it is single use");
  const door = doorPin(ctx);
  if (door === null) throw new LobbyError("door_not_pinned", "the door key is not pinned on this desk; run fleet join");
  await fleetSync(ctx);
  // The admission may be in the directory this desk moved from, where it knocked.
  const view = deskFleetView(ctx, desk, door);
  const mine = (body: { knock_id: string; identity_id: string }) => body.knock_id === knockId && body.identity_id === desk.identity_id;
  const denial = view.denials.find((document) => mine(document.envelope.body));
  if (denial !== undefined) {
    throw new LobbyError("knock_denied", `the door denied this knock; its reason (untrusted text): ${JSON.stringify(denial.envelope.body.reason)}`);
  }
  const admissions = view.admissions.filter((document) => mine(document.envelope.body));
  if (admissions.length === 0) throw new LobbyError("not_admitted", "no door-signed admission for this knock yet");
  if (new Set(admissions.map((document) => document.summary)).size > 1) {
    throw new LobbyError("conflicting_admissions", "the directory holds different door-signed admissions for this knock; ask the hub");
  }
  const admissionDocument = admissions[0]!;
  const admission = admissionDocument.envelope.body;
  const now = ctx.now();
  if (Date.parse(admission.expires_at) <= now.getTime()) throw new LobbyError("admission_expired", "this admission's 24 hours have passed; knock again");
  if (admission.signing_key_id !== desk.signing_key_id || admission.room_id !== knock.room_id
    || admission.grant.token_sha256 !== knock.token_sha256 || admission.mission_digest !== knock.charter_digest) {
    throw new LobbyError("admission_mismatch", "the admission does not match this desk's knock, key or token");
  }
  const card = requireCard(view, knock.room_id).envelope.body;
  if (card.season.mission_id !== admission.mission_id || card.season.mission_digest !== admission.mission_digest) {
    throw new LobbyError("card_season_changed", "the room's current card names another season than the admission; nothing was accepted");
  }
  const seat: ParticipantSeat = {
    mission_id: admission.mission_id,
    grant_id: admission.grant.grant_id,
    identity_id: desk.identity_id,
    signing_key_id: desk.signing_key_id,
    token_sha256: knock.token_sha256,
  };
  if (!DeskSecrets.open(ctx.home).hasToken(seat.token_sha256)) throw new LobbyError("token_not_found", "the knock's room token is missing on this desk");
  const { mission, grant } = await participant(ctx).invitation(seat);
  if (mission.mission_digest !== card.season.mission_digest) {
    throw new LobbyError("digest_mismatch", "the season descriptor's digest differs from the card; nothing was accepted");
  }
  if (mission.project_id !== desk.project_id) {
    throw new LobbyError("project_mismatch", "the season mission belongs to another project than this desk's; nothing was accepted");
  }
  if (mission.revoked_at !== null || grant.revoked_at !== null || grant.actions.join(",") !== actionsFor(admission.tier).join(",")
    || grant.expires_at !== admission.grant.expires_at) {
    throw new LobbyError("grant_mismatch", "the season grant does not match the door-signed admission");
  }
  const at = now.toISOString();
  const preview = actPreview("fleet.ready", knockId, at, [
    `room ${card.room_id} ${JSON.stringify(card.title)}`,
    `season ${mission.mission_id} digest ${mission.mission_digest} (card and descriptor agree)`,
    `charter purpose ${JSON.stringify(mission.descriptor.purpose)}`,
    `charter criteria ${JSON.stringify(mission.descriptor.acceptance_criteria)}`,
    `tier ${admission.tier}; grant until ${grant.expires_at}; term ends ${admission.term_ends_at}`,
  ], {
    knock_id: knockId,
    room_id: card.room_id,
    admission_sha256: documentSha256(admissionDocument.summary),
    season: { mission_id: mission.mission_id, mission_digest: mission.mission_digest, expires_at: mission.expires_at },
    grant: { grant_id: grant.grant_id, actions: grant.actions, expires_at: grant.expires_at, token_sha256: seat.token_sha256 },
    term_ends_at: admission.term_ends_at,
  });
  return { preview, seat, mission, grant, admission };
}

export async function executeReady(ctx: FleetContext, plan: ReadyPlan): Promise<{ mission_id: string; grant_id: string; expires_at: string }> {
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
        room_id: plan.admission.room_id,
        actions: accepted.grant.actions,
        token_sha256: plan.seat.token_sha256,
        expires_at: accepted.grant.expires_at,
        accepted_at: accepted.grant.accepted_at,
        recorded_at: at,
      });
    }
    fleet.markKnockReady(plan.admission.knock_id, at);
  });
  return { mission_id: plan.seat.mission_id, grant_id: plan.seat.grant_id, expires_at: accepted.grant.expires_at };
}

// ── outbox retry ───────────────────────────────────────────────────────

export interface RetryPlan {
  preview: ActPreview;
  post: PreparedPost;
  seat: ParticipantSeat;
}

export function planOutboxRetry(ctx: FleetContext, input: { event_id: string }): RetryPlan {
  const desk = requireDesk(ctx);
  const row = ctx.store.fleet.outbox(assertUuid(input.event_id, "event_id"));
  if (row === null) throw new LobbyError("outbox_not_found", "no saved event with that id");
  if (row.state === "stored") throw new LobbyError("outbox_stored", "that event already has a verified receipt");
  const grant = ctx.store.fleet.deskGrant(row.grant_id);
  if (grant === null || grant.accepted_at === null || grant.expires_at === null || Date.parse(grant.expires_at) <= ctx.now().getTime()) {
    throw new LobbyError("no_seat", "the grant this event was saved under has expired; it cannot be resent with its original seat");
  }
  const summary = String((JSON.parse(row.raw_body) as { summary: unknown }).summary);
  // The room as it is now decides, not the snapshot saved at first send: a
  // room narrowed to device, unhostable or no longer fleet since then sends
  // nothing. The saved snapshot must still pass as well.
  const gate = currentGate(ctx, row.kind, row.mission_id, summary);
  assertSendable(summary, JSON.parse(row.gate_room) as GateRoom, deviceTerms(ctx));
  assertSendable(summary, gate, deviceTerms(ctx));
  const post: PreparedPost = { kind: row.kind, mission_id: row.mission_id, event_id: row.event_id, raw_body: row.raw_body, summary, gate };
  const preview = actPreview("outbox.retry", row.event_id, ctx.now().toISOString(), [
    `resend saved ${row.kind} event ${row.event_id} to mission ${row.mission_id} with its exact original bytes`,
    "inspect first: an uncertain send may already be stored; the service returns the original receipt for identical bytes",
  ], { event_id: row.event_id, mission_id: row.mission_id, raw_body: row.raw_body });
  return {
    preview,
    post,
    seat: { mission_id: row.mission_id, grant_id: grant.grant_id, identity_id: desk.identity_id, signing_key_id: desk.signing_key_id, token_sha256: grant.token_sha256 },
  };
}

export function executeOutboxRetry(ctx: FleetContext, plan: RetryPlan): Promise<PostOutcome> {
  // sendPost checks the room again: it may have changed while the prompt was open.
  return sendPost(ctx, plan.post, plan.seat);
}
