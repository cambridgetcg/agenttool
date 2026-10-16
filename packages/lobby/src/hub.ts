/** Hub side of the fleet hall: hub init, hub relay, seasons, the hub's own
 * seats, room publish, knocks, admit and deny.
 *
 * The hub is the one device whose Keychain holds the project bearer and the
 * door key. Both are read by this CLI only, into memory, and only with a
 * person at the controlling terminal (requireKeychain checks it); neither is
 * printed, stored elsewhere, passed in argv or given to the MCP server. The
 * door key signs before the prompt so the prompt shows exact signed bytes, and
 * an adopt reads the named mission with the bearer (a GET) before the prompt
 * so it can show the charter; every request that changes state is sent only
 * after the person types yes. The hub posts through its own
 * enrolled desk identity (a seat), like any fleet device; the door key signs
 * the documents. Contract: packages/lobby/README.md#fleet-hall.
 */
import { randomBytes, type KeyObject } from "node:crypto";
import { LobbyError } from "./errors.js";
import type { FleetView } from "./fleet.js";
import { verifyEventProof } from "./fleet.js";
import { AdminClient, assertSendable, DIRECTORY_GATE_ROOM, mayHaveTakenEffect, type GrantIssue, type MissionView } from "./hosted.js";
import { assertKeychainRef, readBearer, readDoorKey, type KeychainRef } from "./keychain.js";
import {
  actPreview,
  CLOCK_MARGIN_MS,
  DAY_MS,
  deviceTerms,
  earliest,
  fleetView,
  gateOfRoom,
  HOUR_MS,
  participant,
  preparePost,
  queuePost,
  requireDesk,
  requireFleetRoom,
  requireHosted,
  requireKeychain,
  requireSeat,
  seatOf,
  sendPost,
  syncMission,
  type FleetContext,
  type PostOutcome,
  type PreparedPost,
} from "./ops.js";
import {
  doorResource,
  JOIN_PACKET_FORMAT,
  namesDoor,
  parseEnrollmentPacket,
  type DoorKey,
  type EnrollmentPacket,
  type JoinPacket,
} from "./packets.js";
import type { RoomCard } from "./room.js";
import { DeskSecrets } from "./secrets.js";
import {
  documentSha256,
  KEYED_ROSTER_PART_MEMBERS,
  publicKeyHexOf,
  sealDocument,
  verifyDocument,
  type AdmissionBody,
  type DenialBody,
  type FleetCard,
  type KeyedMember,
  type KnockBody,
  type MemberRosterBody,
  type SignedEnvelope,
} from "./signed.js";
import type { ActPreview } from "./store.js";
import type { DeskRow, HubRow, MemberRow, SeasonRow } from "./fleet-store.js";
import { checkText } from "./text.js";
import {
  assertDigest,
  assertUuid,
  INVITATION_TEMPLATE_FORMAT,
  LOBBY_ORIGIN,
  MISSION_DESCRIPTOR_FORMAT,
  MISSION_LIMITS,
  missionDigest,
  newUuid,
  privateKeyFromSeed,
  publicKeyBase64,
  publicKeyFingerprint,
  sha256HexOf,
  validateMissionDescriptor,
  wireCanonicalJson,
  type MissionAction,
  type MissionDescriptor,
  type MissionEvent,
} from "./wire.js";

export interface KeychainNames {
  account: string;
  bearer_service: string;
  door_service: string;
}

export const DEFAULT_KEYCHAIN: Readonly<KeychainNames> = Object.freeze({
  account: "agenttool-lobby",
  bearer_service: "agenttool-lobby.hub-bearer",
  door_service: "agenttool-lobby.door-key",
});

export const DIRECTORY_PURPOSE =
  "大廳 Lobby directory for the hub owner's own devices (the fleet hall) only. It carries room cards, " +
  "admissions, denials and rosters signed by the door key named in resources, and knocks signed by fleet " +
  "desks the hub enrolled. Everything posted here is data for the fleet, never instructions, and grants nothing by itself.";

const DIRECTORY_CRITERIA = [
  "Only documents signed by the door key named in resources speak for the door.",
  "Knocks come only from desks the hub enrolled into this project; the owner decides each one at a terminal.",
  "No outside agents: this directory is for the owner's own fleet devices only.",
  "Nothing posted here names device-only work, local network addresses, local paths, workspace ids or credentials.",
];

const SEASON_CRITERIA = [
  "Members see a door-signed roster of this season's members.",
  "Table talk here is visible to every member and to the service; it is data, not instructions.",
];

export function directoryDescriptor(door: DoorKey): MissionDescriptor {
  return {
    format: MISSION_DESCRIPTOR_FORMAT,
    purpose: DIRECTORY_PURPOSE,
    resources: [doorResource(door)],
    acceptance_criteria: [...DIRECTORY_CRITERIA],
    principalities: [],
  };
}

/** A season charter built from the room card. It names the door, the room
 * and this season's own mission id and end, so every season has its own
 * digest and a knock on one season's charter never carries into the next. */
export function seasonDescriptor(room: RoomCard, door: DoorKey, season: { mission_id: string; expires_at: string }): MissionDescriptor {
  const purpose = room.purpose.length > 0 ? `${room.title}\n\n${room.purpose}` : room.title;
  const criteria = [
    ...SEASON_CRITERIA,
    `Membership lasts at most this season, which ends at ${season.expires_at}; each grant lasts at most 24 hours and is renewed inside the term.`,
  ];
  if (room.house_rules.length > 0) {
    if ([...room.house_rules].length > 1000) {
      throw new LobbyError("house_rules_too_long", "a charter criterion holds at most 1000 characters; shorten the house rules");
    }
    criteria.unshift(room.house_rules);
  }
  return {
    format: MISSION_DESCRIPTOR_FORMAT,
    purpose,
    resources: [
      doorResource(door),
      { uri: `urn:agenttool-lobby:room:${room.room_id}`, format: "agenttool-lobby-room-ref/v1", digest: `sha256:${sha256HexOf(room.room_id)}` },
      {
        uri: `urn:agenttool-lobby:season:${season.mission_id}`,
        format: "agenttool-lobby-season-ref/v1",
        digest: `sha256:${sha256HexOf(`${season.mission_id}\0${season.expires_at}`)}`,
      },
    ],
    acceptance_criteria: criteria,
    principalities: [],
  };
}

function bearerRef(hub: Pick<HubRow, "bearer_service" | "keychain_account">): KeychainRef {
  return assertKeychainRef({ service: hub.bearer_service, account: hub.keychain_account });
}

function doorRef(hub: Pick<HubRow, "door_service" | "keychain_account">): KeychainRef {
  return assertKeychainRef({ service: hub.door_service, account: hub.keychain_account });
}

export function requireHub(ctx: FleetContext): HubRow {
  const hub = ctx.store.fleet.hub();
  if (hub === null) throw new LobbyError("hub_not_initialised", "this desk is not a hub; run hub init on the hub device");
  if (hub.directory_state !== "active") {
    throw new LobbyError("hub_directory_pending", "the directory mission is not confirmed yet; run hub init again to resume");
  }
  return hub;
}

/** A hub that may still issue access: after an emergency stop it issues,
 * publishes, seats and admits nothing more. Removal (kick, block, pause),
 * deny, reads and the stop itself still work. */
export function requireLiveHub(ctx: FleetContext): HubRow {
  const hub = requireHub(ctx);
  if (hub.stopped_at != null) {
    throw new LobbyError("hub_stopped",
      `an emergency stop was recorded at ${hub.stopped_at}; this hub issues no more access. Rotate the lobby-issuer API key by hand, then start a new hub`);
  }
  return hub;
}

export async function adminClient(ctx: FleetContext, hub: HubRow): Promise<AdminClient> {
  return new AdminClient(await readBearer(requireKeychain(ctx), bearerRef(hub)), requireHosted(ctx));
}

export async function doorKey(ctx: FleetContext, hub: HubRow): Promise<KeyObject> {
  const key = await readDoorKey(requireKeychain(ctx), doorRef(hub));
  if (publicKeyBase64(key) !== hub.door_public_key) {
    throw new LobbyError("door_key_changed", "the Keychain door key no longer matches this hub's recorded door key");
  }
  return key;
}

export function doorOf(hub: HubRow): DoorKey {
  return { public_key: hub.door_public_key, fingerprint: hub.door_fingerprint };
}

/** The service names the project a mission belongs to: the bearer's own
 * project. Anything else means the bearer and this hub disagree. */
function requireHubProject(view: MissionView, projectId: string, what: string): void {
  if (view.project_id !== projectId) {
    throw new LobbyError("project_mismatch",
      `${what} ${view.mission_id} belongs to project ${view.project_id}, not ${projectId}: the Keychain bearer is for another project`);
  }
}

/** The hub's own desk, enrolled in the project like any fleet device. */
export function requireHubDesk(ctx: FleetContext): DeskRow {
  const desk = requireDesk(ctx);
  if (ctx.store.fleet.device(desk.identity_id) === null) {
    throw new LobbyError("hub_desk_not_enrolled", "this hub's own desk is not enrolled yet: run enroll-device, hub relay and fleet join here first");
  }
  return desk;
}

// ── hub init ───────────────────────────────────────────────────────────

export interface HubInitPlan {
  preview: ActPreview;
  mode: "create" | "adopt" | "resume";
  row: HubRow;
  descriptor: MissionDescriptor;
  /** Base64url seed of a door key generated for this act; null when reused. */
  newDoorSeed: string | null;
}

export async function planHubInit(ctx: FleetContext, input: {
  project_id?: string;
  adopt?: { mission_id: string; mission_digest: string };
  days?: number;
  keychain?: Partial<KeychainNames>;
}): Promise<HubInitPlan> {
  const keychain = requireKeychain(ctx);
  const now = ctx.now();
  const at = now.toISOString();
  const existing = ctx.store.fleet.hub();
  if (existing !== null && existing.directory_state === "active") {
    throw new LobbyError("hub_exists", "this desk is already the hub; hub init runs once");
  }
  if (existing !== null) {
    if (input.adopt !== undefined || (input.project_id !== undefined && input.project_id !== existing.project_id)) {
      throw new LobbyError("hub_resume_only", "a directory creation is pending; run hub init with no other options to resume it");
    }
    const descriptor = JSON.parse(existing.directory_descriptor) as MissionDescriptor;
    const preview = actPreview("hub.init.resume", existing.directory_mission_id, at, [
      `resume creating directory mission ${existing.directory_mission_id} with the same id and bytes`,
      `digest ${existing.directory_digest}; expires ${existing.directory_expires_at}`,
    ], { mission_id: existing.directory_mission_id, mission_digest: existing.directory_digest, expires_at: existing.directory_expires_at });
    return { preview, mode: "resume", row: existing, descriptor, newDoorSeed: null };
  }
  const projectId = assertUuid(input.project_id, "project_id");
  const names = { ...DEFAULT_KEYCHAIN, ...(input.keychain ?? {}) };
  const bearer = assertKeychainRef({ service: names.bearer_service, account: names.account });
  const door = assertKeychainRef({ service: names.door_service, account: names.account });
  if (bearer.service === door.service) throw new LobbyError("invalid_keychain_name", "the bearer and door items need different services");
  if (!(await keychain.has(bearer))) {
    throw new LobbyError("keychain_bearer_missing",
      `no project bearer in the login Keychain under service ${bearer.service}, account ${bearer.account}. ` +
      `Add it yourself in a terminal: security add-generic-password -s ${bearer.service} -a ${bearer.account} -w ` +
      "(security then prompts for the value; never paste a bearer into chat)");
  }
  let newDoorSeed: string | null = null;
  let key: KeyObject;
  if (await keychain.has(door)) {
    key = await readDoorKey(keychain, door);
  } else {
    newDoorSeed = randomBytes(32).toString("base64url");
    key = privateKeyFromSeed(Buffer.from(newDoorSeed, "base64url"));
  }
  const doorPublic = publicKeyBase64(key);
  const doorKeyFacts: DoorKey = { public_key: doorPublic, fingerprint: publicKeyFingerprint(doorPublic) };
  let mode: "create" | "adopt";
  let mission: { mission_id: string; mission_digest: string; expires_at: string; descriptor: MissionDescriptor };
  if (input.adopt !== undefined) {
    mode = "adopt";
    if (newDoorSeed !== null) {
      throw new LobbyError("door_key_missing", "an adopted directory must name a door key already in this Keychain; none is there");
    }
    // A read with no effect, before the prompt, so the prompt can show the
    // descriptor being adopted (README: Keychain custody).
    const view = await new AdminClient(await readBearer(keychain, bearer), requireHosted(ctx))
      .getMission(assertUuid(input.adopt.mission_id, "mission_id"));
    if (view.mission_digest !== assertDigest(input.adopt.mission_digest, "mission_digest")) {
      throw new LobbyError("digest_mismatch", "that mission's descriptor digest differs from the digest you gave");
    }
    requireHubProject(view, projectId, "directory mission");
    if (view.revoked_at !== null || Date.parse(view.expires_at) <= now.getTime() + HOUR_MS) {
      throw new LobbyError("directory_closed", "that mission is revoked or ends within the hour");
    }
    if (!namesDoor(view.descriptor, doorKeyFacts)) {
      throw new LobbyError("door_not_in_charter", "that mission's descriptor does not name this hub's door key");
    }
    mission = { mission_id: view.mission_id, mission_digest: view.mission_digest, expires_at: view.expires_at, descriptor: view.descriptor };
  } else {
    mode = "create";
    const days = input.days ?? 30;
    if (!Number.isInteger(days) || days < 1 || days > 30) throw new LobbyError("invalid_days", "a directory lasts 1-30 whole days");
    const descriptor = directoryDescriptor(doorKeyFacts);
    assertSendable(wireCanonicalJson(descriptor), DIRECTORY_GATE_ROOM, deviceTerms(ctx));
    mission = {
      mission_id: newUuid(),
      mission_digest: missionDigest(descriptor),
      expires_at: new Date(now.getTime() + days * DAY_MS - CLOCK_MARGIN_MS).toISOString(),
      descriptor,
    };
  }
  const row: HubRow = {
    project_id: projectId,
    origin: LOBBY_ORIGIN,
    keychain_account: names.account,
    bearer_service: names.bearer_service,
    door_service: names.door_service,
    door_public_key: doorPublic,
    door_fingerprint: doorKeyFacts.fingerprint,
    directory_mission_id: mission.mission_id,
    directory_descriptor: wireCanonicalJson(mission.descriptor),
    directory_digest: mission.mission_digest,
    directory_expires_at: mission.expires_at,
    directory_mode: mode === "create" ? "created" : "adopted",
    directory_state: mode === "create" ? "pending" : "active",
    created_at: at,
  };
  const preview = actPreview("hub.init", projectId, at, [
    `project ${projectId} at ${LOBBY_ORIGIN}`,
    `door key ${doorKeyFacts.fingerprint} (${newDoorSeed === null ? "already in the Keychain" : "new; stored in the Keychain"})`,
    `${mode === "create" ? "create" : "adopt"} directory mission ${mission.mission_id} until ${mission.expires_at}`,
    `directory digest ${mission.mission_digest}`,
    `Keychain items: bearer ${bearer.service}, door ${door.service}, account ${bearer.account} (values are never shown)`,
  ], {
    project_id: projectId,
    origin: LOBBY_ORIGIN,
    keychain: { account: names.account, bearer_service: names.bearer_service, door_service: names.door_service },
    door: { fingerprint: doorKeyFacts.fingerprint, public_key: doorPublic, generated: newDoorSeed !== null },
    directory: { mode, mission_id: mission.mission_id, mission_digest: mission.mission_digest, expires_at: mission.expires_at, descriptor: mission.descriptor },
  });
  return { preview, mode, row, descriptor: mission.descriptor, newDoorSeed };
}

export async function executeHubInit(ctx: FleetContext, plan: HubInitPlan): Promise<HubRow> {
  const fleet = ctx.store.fleet;
  if (plan.newDoorSeed !== null) await requireKeychain(ctx).add(doorRef(plan.row), plan.newDoorSeed);
  if (plan.mode !== "resume") fleet.createHub(plan.row);
  if (plan.mode === "adopt") return fleet.hub()!;
  const admin = await adminClient(ctx, plan.row);
  const request = { mission_id: plan.row.directory_mission_id, descriptor: plan.descriptor, expires_at: plan.row.directory_expires_at };
  let view: MissionView;
  try {
    view = await admin.createMission(request, DIRECTORY_GATE_ROOM);
  } catch (error) {
    if (!(error instanceof LobbyError) || error.details.error !== "collaboration_mission_conflict") {
      if (mayHaveTakenEffect(error)) {
        const detail = error instanceof LobbyError ? `${error.code}: ${error.message}` : "the request failed unexpectedly";
        throw new LobbyError("directory_uncertain",
          `${detail}. Directory mission ${request.mission_id} may or may not exist; nothing was retried. ` +
          "Run hub init again (no other options) to resume with the same id and bytes");
      }
      throw error;
    }
    // The same id already exists: it counts only if it is exactly this directory.
    view = await admin.getMission(request.mission_id);
    if (view.mission_digest !== plan.row.directory_digest || view.expires_at !== request.expires_at) {
      throw new LobbyError("directory_conflict", "a different mission already holds this directory's id");
    }
  }
  if (view.project_id !== plan.row.project_id) {
    // Nothing is activated; the pending hub record is dropped so hub init can
    // run again. The door key stays in the Keychain and is reused.
    fleet.dropPendingHub();
    throw new LobbyError("project_mismatch",
      `the Keychain bearer belongs to project ${view.project_id}, not ${plan.row.project_id}. ` +
      `Directory mission ${view.mission_id} was created in project ${view.project_id} and nothing was activated. ` +
      `Run hub init again with the right --project; to keep that directory: hub init --project ${view.project_id} ` +
      `--adopt-directory ${view.mission_id} --directory-digest ${view.mission_digest}`);
  }
  fleet.activateDirectory();
  return fleet.hub()!;
}

// ── hub relay ──────────────────────────────────────────────────────────

export interface RelayPlan {
  preview: ActPreview;
  packet: EnrollmentPacket;
  enroll: boolean;
  issue: GrantIssue;
}

export function planRelay(ctx: FleetContext, input: { packetText: string }): RelayPlan {
  const hub = requireLiveHub(ctx);
  requireKeychain(ctx);
  requireHosted(ctx);
  const now = ctx.now();
  const packet = parseEnrollmentPacket(input.packetText, now);
  if (packet.project_id !== hub.project_id) throw new LobbyError("project_mismatch", "the packet names another project");
  const fleet = ctx.store.fleet;
  const known = fleet.device(packet.identity_id);
  const byKey = fleet.deviceByFingerprint(packet.fingerprint);
  let enroll: boolean;
  if (known !== null) {
    if (known.public_key !== packet.public_key || known.signing_key_id !== packet.signing_key_id) {
      throw new LobbyError("identity_conflict", "this identity is enrolled with another key; nothing was sent");
    }
    enroll = false;
  } else {
    if (packet.kind === "renew") throw new LobbyError("unknown_device", "a renewal packet must come from a device this hub enrolled");
    if (byKey !== null) throw new LobbyError("key_reused", "this public key already belongs to another enrolled desk");
    enroll = true;
  }
  if (fleet.hubGrantByToken(packet.directory_token_sha256) !== null) {
    throw new LobbyError("token_reused", "a grant was already requested for this token hash; run enroll-device again for a fresh one");
  }
  assertSendable(packet.display_name, DIRECTORY_GATE_ROOM, deviceTerms(ctx));
  if (Date.parse(hub.directory_expires_at) <= now.getTime() + HOUR_MS) {
    throw new LobbyError("directory_expiring", "the directory mission ends within the hour; a new directory is needed");
  }
  const issue: GrantIssue = {
    grant_id: newUuid(),
    identity_id: packet.identity_id,
    signing_key_id: packet.signing_key_id,
    actions: ["mission.observe", "mission.read"],
    expires_at: earliest(now.getTime() + DAY_MS - CLOCK_MARGIN_MS, hub.directory_expires_at),
    token_sha256: packet.directory_token_sha256,
  };
  const at = now.toISOString();
  const preview = actPreview("hub.relay", packet.identity_id, at, [
    `device ${packet.fingerprint} ${JSON.stringify(packet.display_name)} (name is self-declared)`,
    enroll ? `enroll identity ${packet.identity_id} key ${packet.signing_key_id} into project ${hub.project_id} (exact signed body below)` : "already enrolled: no enrollment request is sent",
    `directory grant ${issue.grant_id} mission.observe+mission.read until ${issue.expires_at}`,
    `bound to the device's own token hash ${issue.token_sha256}; no token is created or shown here`,
  ], {
    kind: packet.kind,
    device: {
      identity_id: packet.identity_id,
      signing_key_id: packet.signing_key_id,
      did: `did:at:${packet.identity_id}`,
      fingerprint: packet.fingerprint,
      public_key: packet.public_key,
      display_name: packet.display_name,
    },
    enrollment_body: enroll ? packet.enrollment_request!.body_utf8 : null,
    directory_grant: { mission_id: hub.directory_mission_id, ...issue },
  });
  return { preview, packet, enroll, issue };
}

export interface RelayResult {
  join: JoinPacket;
  enrolled: boolean;
  grant_expires_at: string;
}

export async function executeRelay(ctx: FleetContext, plan: RelayPlan): Promise<RelayResult> {
  const hub = requireHub(ctx);
  const fleet = ctx.store.fleet;
  const admin = await adminClient(ctx, hub);
  const now = ctx.now();
  if (plan.enroll) {
    // The signed intent has a 5-minute window; time spent at the prompt counts.
    parseEnrollmentPacket(JSON.stringify(plan.packet), now);
    const enrolled = await admin.enroll(plan.packet.enrollment_request!, { display_name: plan.packet.display_name, capabilities: [] });
    fleet.addDevice({
      identity_id: enrolled.identity_id,
      signing_key_id: enrolled.signing_key_id,
      public_key: enrolled.public_key,
      fingerprint: plan.packet.fingerprint,
      display_name: plan.packet.display_name,
      enrolled_at: now.toISOString(),
    });
  }
  fleet.addHubGrant({ ...plan.issue, mission_id: hub.directory_mission_id, purpose: "directory", room_id: null, state: "requested", requested_at: now.toISOString() });
  const grant = await admin.issueGrant(hub.directory_mission_id, plan.issue);
  fleet.markHubGrantIssued(grant.grant_id, grant.expires_at);
  return {
    join: {
      format: JOIN_PACKET_FORMAT,
      origin: LOBBY_ORIGIN,
      project_id: hub.project_id,
      door: doorOf(hub),
      directory: { mission_id: hub.directory_mission_id, mission_digest: hub.directory_digest },
      invitation_template: {
        format: INVITATION_TEMPLATE_FORMAT,
        origin: LOBBY_ORIGIN,
        mission_id: hub.directory_mission_id,
        grant_id: grant.grant_id,
        identity_id: plan.packet.identity_id,
        signing_key_id: plan.packet.signing_key_id,
        public_key: plan.packet.public_key,
        expires_at: grant.expires_at,
        token_sha256: plan.issue.token_sha256,
      },
    },
    enrolled: plan.enroll,
    grant_expires_at: grant.expires_at,
  };
}

// ── The hub desk's own seats ───────────────────────────────────────────

interface SeatIssue {
  mission_id: string;
  mission_digest: string;
  purpose: "directory" | "season";
  room_id: string | null;
  issue: GrantIssue;
  writeToken: () => void;
}

function planSeatIssue(ctx: FleetContext, desk: DeskRow, mission: { mission_id: string; mission_digest: string; expires_at: string },
  purpose: "directory" | "season", roomId: string | null): SeatIssue {
  const now = ctx.now();
  const token = DeskSecrets.open(ctx.home).prepareToken(now);
  return {
    mission_id: mission.mission_id,
    mission_digest: mission.mission_digest,
    purpose,
    room_id: roomId,
    issue: {
      grant_id: newUuid(),
      identity_id: desk.identity_id,
      signing_key_id: desk.signing_key_id,
      actions: ["mission.observe", "mission.read"],
      expires_at: earliest(now.getTime() + DAY_MS - CLOCK_MARGIN_MS, mission.expires_at),
      token_sha256: token.token_sha256,
    },
    writeToken: token.write,
  };
}

function seatRecord(seat: SeatIssue) {
  return { mission_id: seat.mission_id, grant_id: seat.issue.grant_id, identity_id: seat.issue.identity_id,
    actions: seat.issue.actions, expires_at: seat.issue.expires_at, token_sha256: seat.issue.token_sha256 };
}

async function executeSeatIssue(ctx: FleetContext, admin: AdminClient, desk: DeskRow, seat: SeatIssue): Promise<string> {
  const fleet = ctx.store.fleet;
  const now = ctx.now().toISOString();
  seat.writeToken();
  fleet.addHubGrant({ ...seat.issue, mission_id: seat.mission_id, purpose: seat.purpose, room_id: seat.room_id, state: "requested", requested_at: now });
  const grant = await admin.issueGrant(seat.mission_id, seat.issue);
  fleet.markHubGrantIssued(grant.grant_id, grant.expires_at);
  fleet.addDeskGrant({
    grant_id: grant.grant_id,
    mission_id: seat.mission_id,
    mission_digest: null,
    purpose: seat.purpose,
    room_id: seat.room_id,
    actions: grant.actions,
    token_sha256: seat.issue.token_sha256,
    expires_at: grant.expires_at,
    accepted_at: null,
    recorded_at: now,
  });
  const row = fleet.deskGrant(grant.grant_id)!;
  const accepted = await participant(ctx).accept(seatOf(desk, row), seat.mission_digest);
  fleet.markDeskGrantAccepted(grant.grant_id, {
    mission_digest: seat.mission_digest,
    expires_at: accepted.grant.expires_at,
    accepted_at: accepted.grant.accepted_at!,
  });
  return grant.expires_at;
}

export interface SeatPlan {
  preview: ActPreview;
  seat: SeatIssue;
}

/** `hub seat directory|<room_id>`: issue this hub desk a fresh grant. */
export function planHubSeat(ctx: FleetContext, input: { target: string }): SeatPlan {
  const hub = requireLiveHub(ctx);
  const desk = requireHubDesk(ctx);
  let seat: SeatIssue;
  if (input.target === "directory") {
    seat = planSeatIssue(ctx, desk, { mission_id: hub.directory_mission_id, mission_digest: hub.directory_digest, expires_at: hub.directory_expires_at }, "directory", null);
  } else {
    const season = requireSeason(ctx, input.target);
    seat = planSeatIssue(ctx, desk, season, "season", season.room_id);
  }
  const preview = actPreview("hub.seat", seat.mission_id, ctx.now().toISOString(), [
    `issue this hub desk (${desk.fingerprint}) a ${seat.purpose} seat in mission ${seat.mission_id}`,
    `grant ${seat.issue.grant_id} mission.observe+mission.read until ${seat.issue.expires_at}; accept digest ${seat.mission_digest}`,
  ], { seat: seatRecord(seat), mission_digest: seat.mission_digest });
  return { preview, seat };
}

export async function executeHubSeat(ctx: FleetContext, plan: SeatPlan): Promise<string> {
  const hub = requireHub(ctx);
  return executeSeatIssue(ctx, await adminClient(ctx, hub), requireHubDesk(ctx), plan.seat);
}

// ── Seasons ────────────────────────────────────────────────────────────

export function requireSeason(ctx: FleetContext, roomId: string): SeasonRow {
  const season = ctx.store.fleet.currentSeason(roomId);
  if (season === null) throw new LobbyError("no_season", "this room has no current season; run hub season open or hub season adopt");
  if (Date.parse(season.expires_at) <= ctx.now().getTime()) throw new LobbyError("season_ended", "this room's current season has ended");
  return season;
}

export interface SeasonPlan {
  preview: ActPreview;
  /** `resume`: a season of this room whose creation was asked for but never
   * confirmed is asked for again with the same id and bytes. */
  mode: "create" | "adopt" | "resume";
  room: RoomCard;
  mission: { mission_id: string; mission_digest: string; expires_at: string; descriptor: MissionDescriptor };
  seat: SeatIssue;
}

function adoptCommand(roomId: string, mission: { mission_id: string; mission_digest: string }): string {
  return `hub season adopt ${roomId} --mission ${mission.mission_id} --digest ${mission.mission_digest}`;
}

/** The charter recorded for a pending season, checked against its digest. */
function parsePendingDescriptor(text: string, digest: string): MissionDescriptor {
  const descriptor = validateMissionDescriptor(JSON.parse(text));
  if (missionDigest(descriptor) !== digest) {
    throw new LobbyError("season_record_changed", "the pending season's recorded charter no longer matches its digest");
  }
  return descriptor;
}

export async function planSeason(ctx: FleetContext, input: {
  room_id: string;
  days?: number;
  adopt?: { mission_id: string; mission_digest: string };
}): Promise<SeasonPlan> {
  const hub = requireLiveHub(ctx);
  const desk = requireHubDesk(ctx);
  const room = requireFleetRoom(ctx, input.room_id);
  const now = ctx.now();
  let mission: SeasonPlan["mission"];
  let mode: SeasonPlan["mode"];
  // A pending season that ends within the hour is of no use; it is ignored.
  const pending = ctx.store.fleet.pendingSeason(room.room_id, new Date(now.getTime() + HOUR_MS).toISOString());
  if (input.adopt !== undefined) {
    mode = "adopt";
    // A read with no effect, before the prompt, so the prompt can show the
    // charter being adopted (README: Keychain custody).
    const view: MissionView = await (await adminClient(ctx, hub)).getMission(assertUuid(input.adopt.mission_id, "mission_id"));
    if (view.mission_digest !== assertDigest(input.adopt.mission_digest, "mission_digest")) {
      throw new LobbyError("digest_mismatch", "that mission's descriptor digest differs from the digest you gave");
    }
    requireHubProject(view, hub.project_id, "season mission");
    if (view.revoked_at !== null || Date.parse(view.expires_at) <= now.getTime() + HOUR_MS) {
      throw new LobbyError("season_closed", "that mission is revoked or ends within the hour");
    }
    const recorded = ctx.store.fleet.season(view.mission_id);
    // A season of this room whose creation response was lost may be adopted to finish it.
    const finishing = recorded !== null && recorded.state === "pending" && recorded.room_id === room.room_id
      && recorded.mission_digest === view.mission_digest;
    if (view.mission_id === hub.directory_mission_id || (recorded !== null && !finishing)) {
      throw new LobbyError("season_in_use", "that mission is already the directory or a recorded season");
    }
    mission = { mission_id: view.mission_id, mission_digest: view.mission_digest, expires_at: view.expires_at, descriptor: view.descriptor };
  } else if (pending !== null) {
    // Never a second mission while the first may exist: ask again for the
    // same id and bytes, which the service either creates or reports as taken.
    if (input.days !== undefined) {
      throw new LobbyError("season_resume_only",
        `season mission ${pending.mission_id} of this room was asked for but never confirmed; run hub season open ${room.room_id} ` +
        `with no --days to resume it with the same id and bytes, or inspect it and finish with: ${adoptCommand(room.room_id, pending)}`);
    }
    mode = "resume";
    const descriptor = parsePendingDescriptor(pending.descriptor, pending.mission_digest);
    assertSendable(wireCanonicalJson(descriptor), gateOfRoom(room), deviceTerms(ctx));
    mission = { mission_id: pending.mission_id, mission_digest: pending.mission_digest, expires_at: pending.expires_at, descriptor };
  } else {
    mode = "create";
    const days = input.days ?? 30;
    if (!Number.isInteger(days) || days < 1 || days > 30) throw new LobbyError("invalid_days", "a season lasts 1-30 whole days");
    const missionId = newUuid();
    const expiresAt = new Date(now.getTime() + days * DAY_MS - CLOCK_MARGIN_MS).toISOString();
    const descriptor = seasonDescriptor(room, doorOf(hub), { mission_id: missionId, expires_at: expiresAt });
    assertSendable(wireCanonicalJson(descriptor), gateOfRoom(room), deviceTerms(ctx));
    mission = { mission_id: missionId, mission_digest: missionDigest(descriptor), expires_at: expiresAt, descriptor };
  }
  const seat = planSeatIssue(ctx, desk, mission, "season", room.room_id);
  const act = mode === "create" ? "hub.season.open" : mode === "resume" ? "hub.season.resume" : "hub.season.adopt";
  const verb = mode === "create" ? "create" : mode === "resume"
    ? "resume creating (same id and bytes; the first request was never confirmed)" : "adopt";
  const preview = actPreview(act, room.room_id, now.toISOString(), [
    `room ${room.room_id} ${JSON.stringify(room.title)}`,
    `${verb} season mission ${mission.mission_id} until ${mission.expires_at}`,
    `charter digest ${mission.mission_digest}`,
    `charter purpose ${JSON.stringify(mission.descriptor.purpose)}`,
    `this hub desk takes a seat: grant ${seat.issue.grant_id} until ${seat.issue.expires_at}`,
    "republish the room card afterwards so devices see the new season",
  ], {
    room_id: room.room_id,
    season: { mode, ...mission },
    hub_seat: seatRecord(seat),
  });
  return { preview, mode, room, mission, seat };
}

export async function executeSeason(ctx: FleetContext, plan: SeasonPlan): Promise<{ mission_id: string; mission_digest: string; seat_expires_at: string }> {
  const hub = requireHub(ctx);
  const desk = requireHubDesk(ctx);
  const fleet = ctx.store.fleet;
  const admin = await adminClient(ctx, hub);
  const row: SeasonRow = {
    mission_id: plan.mission.mission_id,
    room_id: plan.room.room_id,
    mission_digest: plan.mission.mission_digest,
    descriptor: wireCanonicalJson(plan.mission.descriptor),
    expires_at: plan.mission.expires_at,
    mode: plan.mode === "adopt" ? "adopted" : "created",
    state: plan.mode === "adopt" ? "current" : "pending",
    recorded_at: ctx.now().toISOString(),
  };
  if (plan.mode === "adopt" && fleet.season(row.mission_id)?.state === "pending") fleet.makeSeasonCurrent(row.mission_id);
  else if (plan.mode === "resume") {
    if (fleet.season(row.mission_id)?.state !== "pending") throw new LobbyError("season_not_pending", "that season is no longer pending; run hub season open again");
  } else fleet.addSeason(row);
  if (plan.mode !== "adopt") {
    const request = { mission_id: row.mission_id, descriptor: plan.mission.descriptor, expires_at: row.expires_at };
    let view: MissionView;
    try {
      view = await admin.createMission(request, gateOfRoom(plan.room));
    } catch (error) {
      if (error instanceof LobbyError && error.details.error === "collaboration_mission_conflict") {
        // The same id already exists: it counts only if it is exactly this season.
        view = await admin.getMission(row.mission_id);
        if (view.mission_digest !== row.mission_digest || view.expires_at !== row.expires_at) {
          throw new LobbyError("season_conflict", "a different mission already holds this season's id");
        }
      } else if (mayHaveTakenEffect(error)) {
        // Sent, but no trustworthy answer (a dropped connection, a 5xx, a body
        // that is not the service's JSON): the mission may exist.
        const detail = error instanceof LobbyError ? `${error.code}: ${error.message}` : "the request failed unexpectedly";
        throw new LobbyError("season_uncertain",
          `${detail}. Season mission ${row.mission_id} may or may not exist. Nothing was retried. Run hub season open ${plan.room.room_id} ` +
          `again to resume with the same id and bytes, or inspect it; if it exists, finish with: ${adoptCommand(plan.room.room_id, row)}`);
      } else {
        // A definite refusal: the service did not create it.
        fleet.dropPendingSeason(row.mission_id);
        throw error;
      }
    }
    if (view.project_id !== hub.project_id) {
      fleet.dropPendingSeason(row.mission_id);
      throw new LobbyError("project_mismatch",
        `season mission ${view.mission_id} was created in project ${view.project_id}, not this hub's ${hub.project_id}: the Keychain bearer is for another project. Nothing was recorded as current`);
    }
    fleet.makeSeasonCurrent(row.mission_id);
  }
  let seatExpires: string;
  try {
    seatExpires = await executeSeatIssue(ctx, admin, desk, plan.seat);
  } catch (error) {
    if (!(error instanceof LobbyError)) throw error;
    throw new LobbyError(error.code, `${error.message}. The season is recorded; take the hub's seat with: hub seat ${plan.room.room_id}`, error.details);
  }
  return { mission_id: row.mission_id, mission_digest: row.mission_digest, seat_expires_at: seatExpires };
}

// ── room publish ───────────────────────────────────────────────────────

export interface PublishPlan {
  preview: ActPreview;
  card: FleetCard;
  post: PreparedPost;
  seat: ReturnType<typeof seatOf>;
}

export async function planPublish(ctx: FleetContext, input: { room_id: string }): Promise<PublishPlan> {
  const hub = requireLiveHub(ctx);
  requireHubDesk(ctx);
  const room = requireFleetRoom(ctx, input.room_id);
  const season = requireSeason(ctx, room.room_id);
  const { seat } = requireSeat(ctx, hub.directory_mission_id, "mission.observe", 5 * 60_000, "; run hub seat directory");
  const now = ctx.now();
  const card: FleetCard = {
    room_id: room.room_id,
    card_seq: ctx.store.fleet.nextCardSeq(room.room_id),
    title: room.title,
    purpose: room.purpose,
    tags: room.tags,
    status: room.status,
    door: room.door,
    residency: "fleet",
    slots: room.slots,
    season: { mission_id: season.mission_id, mission_digest: season.mission_digest, expires_at: season.expires_at },
    issued_at: now.toISOString(),
  };
  const sealed = sealDocument("card", card, { privateKey: await doorKey(ctx, hub), fingerprint: hub.door_fingerprint });
  const post = preparePost(ctx, "card", hub.directory_mission_id, sealed.summary, gateOfRoom(room));
  const preview = actPreview("room.publish", room.room_id, card.issued_at, [
    `room ${room.room_id} ${JSON.stringify(room.title)} card #${card.card_seq}`,
    `season ${season.mission_id} digest ${season.mission_digest}`,
    `door-signed (${hub.door_fingerprint}); ${[...sealed.summary].length} of ${MISSION_LIMITS.summaryScalars} characters`,
    `posted to the fleet directory ${hub.directory_mission_id}: every fleet device and the service can read it`,
  ], { room_id: room.room_id, card_seq: card.card_seq, mission_id: hub.directory_mission_id, event_id: post.event_id, summary: sealed.summary });
  return { preview, card, post, seat };
}

export async function executePublish(ctx: FleetContext, plan: PublishPlan): Promise<PostOutcome> {
  ctx.store.fleet.addCard({
    room_id: plan.card.room_id,
    card_seq: plan.card.card_seq,
    event_id: plan.post.event_id,
    summary: plan.post.summary,
    issued_at: plan.card.issued_at,
  });
  return sendPost(ctx, plan.post, plan.seat);
}

// ── knocks ─────────────────────────────────────────────────────────────

export type HubKnockStatus = "pending" | "admitted" | "denied" | "expired" | "invalid";

export interface HubKnock {
  knock_id: string;
  room_id: string;
  tier: "player" | "spectator";
  note: string;
  token_sha256: string;
  charter_digest: string;
  issued_at: string;
  expires_at: string;
  requester: { identity_id: string; signing_key_id: string; fingerprint: string; display_name: string };
  status: HubKnockStatus;
  reason: string | null;
  event_id: string;
  summary: string;
}

type KnockEntry = { envelope: SignedEnvelope<KnockBody>; summary: string; event: MissionEvent };

/** Why a knock did not come from the enrolled desk that signed it, or null
 * when it did: the signer is enrolled, the event was posted by that desk's
 * identity and key with a valid exact-request proof, and the signature holds. */
function knockForgery(ctx: FleetContext, entry: KnockEntry): string | null {
  const device = ctx.store.fleet.deviceByFingerprint(entry.envelope.signer);
  if (device === null) return "unknown_desk";
  if (entry.event.identity_id !== device.identity_id || entry.event.signing_key_id !== device.signing_key_id) return "sender_mismatch";
  if (!verifyEventProof(entry.event, device.public_key)) return "bad_event_proof";
  if (!verifyDocument(entry.envelope, device.public_key)) return "bad_signature";
  return null;
}

/** Who owns each knock id: the desk whose authentic knock used it first, in
 * receipt order, and the distinct documents that desk posted under it. A
 * later knock reusing the id under another desk's key never displaces it. */
interface KnockOwnership {
  owner: Map<string, string>;
  documents: Map<string, Set<string>>;
}

function assessKnock(ctx: FleetContext, entry: KnockEntry, forgery: string | null, ownership: KnockOwnership): HubKnock {
  const fleet = ctx.store.fleet;
  const body = entry.envelope.body;
  const device = fleet.deviceByFingerprint(entry.envelope.signer);
  const base = {
    knock_id: body.knock_id,
    room_id: body.room_id,
    tier: body.tier,
    note: body.note,
    token_sha256: body.token_sha256,
    charter_digest: body.charter_digest,
    issued_at: body.issued_at,
    expires_at: body.expires_at,
    requester: {
      identity_id: entry.event.identity_id,
      signing_key_id: entry.event.signing_key_id,
      fingerprint: entry.envelope.signer,
      display_name: device?.display_name ?? "",
    },
    event_id: entry.event.event_id,
    summary: entry.summary,
  };
  const invalid = (reason: string): HubKnock => ({ ...base, status: "invalid", reason });
  if (forgery !== null) return invalid(forgery);
  if (ownership.owner.get(body.knock_id) !== entry.envelope.signer) return invalid("knock_id_taken");
  if ((ownership.documents.get(body.knock_id)?.size ?? 0) > 1) return invalid("duplicate_knock_id");
  if (Date.parse(body.issued_at) > Date.parse(entry.event.received_at) + 5 * 60_000) return invalid("issued_after_receipt");
  const decision = fleet.decision(body.knock_id);
  if (decision !== null) {
    if (decision.knock_sha256 !== documentSha256(entry.summary)) return invalid("decided_knock_changed");
    return { ...base, status: decision.decision, reason: null };
  }
  // A DID blocked from this room knocks on it no more.
  if (fleet.isBlocked(body.room_id, entry.event.identity_id)) return invalid("blocked");
  const season = fleet.currentSeason(body.room_id);
  const room = ctx.store.getRoom(body.room_id);
  if (room === null || fleet.latestCard(body.room_id) === null) return invalid("room_not_published");
  // The hub's own room decides, not the requesting desk's CLI: a closed or
  // invite-only room takes no knocks, however the knock was posted.
  if (room.status === "closed") return invalid("room_closed");
  if (room.door !== "knock") return invalid("door_invite_only");
  if (season === null || season.mission_digest !== body.charter_digest) return invalid("charter_changed");
  const bound = fleet.hubGrantByToken(body.token_sha256);
  // A grant requested for this token whose outcome was never confirmed:
  // inspect that grant id with the administrator read API before anything else.
  if (bound !== null && bound.state === "requested") return invalid(`grant_uncertain:${bound.grant_id}`);
  if (bound !== null) return invalid("token_reused");
  if (Date.parse(body.expires_at) <= ctx.now().getTime()) return { ...base, status: "expired", reason: null };
  return { ...base, status: "pending", reason: null };
}

/** Read the directory (as this hub's desk) and assess every knock in it. */
export async function hubKnocks(ctx: FleetContext, input: { sync?: boolean } = {}): Promise<HubKnock[]> {
  const hub = requireHub(ctx);
  requireHubDesk(ctx);
  if (input.sync !== false) {
    const { seat } = requireSeat(ctx, hub.directory_mission_id, "mission.read", 0, "; run hub seat directory");
    await syncMission(ctx, seat);
  }
  const view: FleetView = fleetView(ctx, hub.directory_mission_id, doorOf(hub));
  // An exact repeat of a document already seen is the same knock.
  const seen = new Set<string>();
  const entries: KnockEntry[] = [];
  for (const entry of view.knocks) {
    const key = `${entry.envelope.body.knock_id}:${entry.summary}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  // Events are in receipt order, so the first authentic use of an id owns it.
  const forgeries = entries.map((entry) => knockForgery(ctx, entry));
  const ownership: KnockOwnership = { owner: new Map(), documents: new Map() };
  entries.forEach((entry, index) => {
    if (forgeries[index] !== null) return;
    const knockId = entry.envelope.body.knock_id;
    if (!ownership.owner.has(knockId)) ownership.owner.set(knockId, entry.envelope.signer);
    if (ownership.owner.get(knockId) !== entry.envelope.signer) return;
    const documents = ownership.documents.get(knockId) ?? new Set<string>();
    documents.add(entry.summary);
    ownership.documents.set(knockId, documents);
  });
  return entries.map((entry, index) => assessKnock(ctx, entry, forgeries[index] ?? null, ownership));
}

function requirePendingKnock(knocks: HubKnock[], knockId: string): HubKnock {
  const matching = knocks.filter((knock) => knock.knock_id === knockId);
  if (matching.length === 0) throw new LobbyError("knock_not_found", "no knock with that id in the directory");
  // Copies of the id under another desk's key do not make the owner's knock ambiguous.
  const owned = matching.filter((knock) => knock.reason !== "knock_id_taken");
  const knock = owned[0] ?? matching[0]!;
  if (owned.length !== 1 || knock.status === "invalid") {
    throw new LobbyError("knock_invalid", `this knock is invalid (${knock.reason ?? "duplicate_knock_id"}) and cannot be decided`);
  }
  if (knock.status === "expired") throw new LobbyError("knock_expired", "this knock has expired; the device may knock again");
  if (knock.status !== "pending") throw new LobbyError("knock_decided", `this knock was already ${knock.status}`);
  return knock;
}

function requireDistinctApprover(desk: DeskRow, knock: HubKnock): void {
  if (desk.identity_id === knock.requester.identity_id) {
    throw new LobbyError("approver_is_requester", "the approver's DID must differ from the requester's; the hub desk cannot admit its own knock");
  }
}

export function actionsFor(tier: "player" | "spectator"): MissionAction[] {
  return tier === "player" ? ["mission.observe", "mission.read"] : ["mission.read"];
}

// ── Keyed rosters (the table-talk pin source) ──────────────────────────

export interface KeyedRosterPlan {
  mission_id: string;
  room_id: string;
  roster_seq: number;
  issued_at: string;
  members: KeyedMember[];
  bodies: MemberRosterBody[];
}

/** The season's members as the door signs them: every active member whose
 * term runs past now, with the key the hub recorded for that desk, and this
 * hub's own desk as host. `change` previews an admission or a removal. Each
 * part holds two members, so every signed part fits one observation. */
export function keyedRosterFor(ctx: FleetContext, season: SeasonRow, now: Date,
  change: {
    add?: Pick<MemberRow, "identity_id" | "tier" | "term_ends_at"> & { key?: { signing_key_id: string; public_key: string } };
    remove?: readonly string[];
  } = {}): KeyedRosterPlan {
  const fleet = ctx.store.fleet;
  const host = requireHubDesk(ctx);
  const removed = new Set(change.remove ?? []);
  const keyed = (identityId: string, tier: "player" | "spectator", role: "host" | "member", termEndsAt: string,
    key?: { signing_key_id: string; public_key: string }): KeyedMember => {
    const device = key ?? fleet.device(identityId);
    if (device === null) throw new LobbyError("member_key_unknown", `the hub has no recorded key for member did:at:${identityId}`);
    return {
      identity_id: identityId,
      signing_key_id: device.signing_key_id,
      public_key_hex: publicKeyHexOf(device.public_key),
      tier,
      role,
      term_ends_at: termEndsAt,
    };
  };
  const members = fleet.activeMembers(season.mission_id, now)
    .filter((row) => row.identity_id !== host.identity_id && !removed.has(row.identity_id) && row.identity_id !== change.add?.identity_id)
    .map((row) => keyed(row.identity_id, row.tier, "member", row.term_ends_at));
  if (change.add !== undefined && !removed.has(change.add.identity_id)) {
    members.push(keyed(change.add.identity_id, change.add.tier, "member", change.add.term_ends_at, change.add.key));
  }
  members.push(keyed(host.identity_id, "player", "host", season.expires_at));
  members.sort((left, right) => left.identity_id < right.identity_id ? -1 : 1);
  const rosterSeq = fleet.nextRosterSeq(season.mission_id);
  const issuedAt = now.toISOString();
  const parts = Math.max(1, Math.ceil(members.length / KEYED_ROSTER_PART_MEMBERS));
  const bodies: MemberRosterBody[] = Array.from({ length: parts }, (_, index) => ({
    room_id: season.room_id,
    mission_id: season.mission_id,
    roster_seq: rosterSeq,
    members: members.slice(index * KEYED_ROSTER_PART_MEMBERS, (index + 1) * KEYED_ROSTER_PART_MEMBERS),
    part: index + 1,
    parts,
    issued_at: issuedAt,
  }));
  return { mission_id: season.mission_id, room_id: season.room_id, roster_seq: rosterSeq, issued_at: issuedAt, members, bodies };
}

/** Sign and frame every part of a keyed roster for the season; nothing is sent. */
export function keyedRosterPosts(ctx: FleetContext, roster: KeyedRosterPlan, signer: { privateKey: KeyObject; fingerprint: string },
  gate: ReturnType<typeof gateOfRoom>): PreparedPost[] {
  return roster.bodies.map((body) => preparePost(ctx, "member_roster", roster.mission_id, sealDocument("member_roster", body, signer).summary, gate));
}

/** Record a keyed roster as issued (its sequence is then taken). */
export function recordKeyedRoster(ctx: FleetContext, roster: KeyedRosterPlan): void {
  ctx.store.fleet.addRoster({
    mission_id: roster.mission_id,
    roster_seq: roster.roster_seq,
    room_id: roster.room_id,
    members: JSON.stringify(roster.members),
    issued_at: roster.issued_at,
  });
}

// ── admit ──────────────────────────────────────────────────────────────

export interface AdmitPlan {
  preview: ActPreview;
  knock: HubKnock;
  season: SeasonRow;
  issue: GrantIssue;
  admission: AdmissionBody;
  roster: KeyedRosterPlan;
  posts: Array<{ post: PreparedPost; seat: ReturnType<typeof seatOf> }>;
}

export async function planAdmit(ctx: FleetContext, input: { knock_id: string; tier?: "player" | "spectator"; term_days?: number }): Promise<AdmitPlan> {
  const hub = requireLiveHub(ctx);
  const desk = requireHubDesk(ctx);
  requireKeychain(ctx);
  const knock = requirePendingKnock(await hubKnocks(ctx), assertUuid(input.knock_id, "knock_id"));
  requireDistinctApprover(desk, knock);
  const room = requireFleetRoom(ctx, knock.room_id);
  const season = requireSeason(ctx, room.room_id);
  const tier = input.tier ?? knock.tier;
  if (knock.tier === "spectator" && tier === "player") {
    throw new LobbyError("tier_raise", "an admission may lower a knock's tier, never raise it");
  }
  const now = ctx.now();
  let termEnds = season.expires_at;
  if (input.term_days !== undefined) {
    if (!Number.isInteger(input.term_days) || input.term_days < 1 || input.term_days > 30) {
      throw new LobbyError("invalid_term", "a term is 1-30 whole days, and never past the season");
    }
    termEnds = earliest(now.getTime() + input.term_days * DAY_MS, season.expires_at);
  }
  const issue: GrantIssue = {
    grant_id: newUuid(),
    identity_id: knock.requester.identity_id,
    signing_key_id: knock.requester.signing_key_id,
    actions: actionsFor(tier),
    expires_at: earliest(now.getTime() + DAY_MS - CLOCK_MARGIN_MS, termEnds, season.expires_at),
    token_sha256: knock.token_sha256,
  };
  const admission: AdmissionBody = {
    knock_id: knock.knock_id,
    room_id: room.room_id,
    mission_id: season.mission_id,
    mission_digest: season.mission_digest,
    identity_id: issue.identity_id,
    signing_key_id: issue.signing_key_id,
    tier,
    grant: { grant_id: issue.grant_id, expires_at: issue.expires_at, token_sha256: issue.token_sha256 },
    term_ends_at: termEnds,
    issued_at: now.toISOString(),
    expires_at: new Date(now.getTime() + DAY_MS).toISOString(),
  };
  if (ctx.store.fleet.isBlocked(room.room_id, issue.identity_id)) {
    throw new LobbyError("blocked", "this identity is blocked from this room; run hub unblock first");
  }
  // The keyed roster names every current member with the key the hub
  // recorded, so members can verify each other's table talk.
  const roster = keyedRosterFor(ctx, season, now, { add: { identity_id: issue.identity_id, tier, term_ends_at: termEnds } });
  const members = roster.members;
  const parts = roster.bodies.length;
  const key = await doorKey(ctx, hub);
  const signer = { privateKey: key, fingerprint: hub.door_fingerprint };
  const admissionSummary = sealDocument("admission", admission, signer).summary;
  const directorySeat = requireSeat(ctx, hub.directory_mission_id, "mission.observe", 5 * 60_000, "; run hub seat directory").seat;
  const seasonSeat = requireSeat(ctx, season.mission_id, "mission.observe", 5 * 60_000, `; run hub seat ${room.room_id}`).seat;
  const gate = gateOfRoom(room);
  const posts = [
    { post: preparePost(ctx, "admission", hub.directory_mission_id, admissionSummary, gate), seat: directorySeat },
    { post: preparePost(ctx, "admission", season.mission_id, admissionSummary, gate), seat: seasonSeat },
    ...keyedRosterPosts(ctx, roster, signer, gate).map((post) => ({ post, seat: seasonSeat })),
  ];
  const preview = actPreview("hub.admit", knock.knock_id, now.toISOString(), [
    `requester ${knock.requester.fingerprint} ${JSON.stringify(knock.requester.display_name)} did:at:${knock.requester.identity_id}`,
    `approver did:at:${desk.identity_id} (this hub desk; differs from the requester)`,
    `room ${room.room_id} ${JSON.stringify(room.title)} season ${season.mission_id}`,
    `room status ${room.status}, door ${room.door}`,
    `tier ${tier} (${issue.actions.join("+")}); grant until ${issue.expires_at}; term ends ${termEnds}`,
    `knock note (untrusted) ${JSON.stringify(knock.note)}`,
    `posts: the door-signed admission to the directory and the season, and keyed roster #${roster.roster_seq} of ${members.length} (host included; ${parts} part${parts === 1 ? "" : "s"}) to the season`,
  ], {
    knock_id: knock.knock_id,
    knock_sha256: documentSha256(knock.summary),
    approver_did: `did:at:${desk.identity_id}`,
    requester_did: `did:at:${knock.requester.identity_id}`,
    room: { room_id: room.room_id, status: room.status, door: room.door },
    grant: { mission_id: season.mission_id, ...issue },
    membership: { tier, term_ends_at: termEnds },
    posts: posts.map(({ post }) => ({ mission_id: post.mission_id, kind: post.kind, event_id: post.event_id, summary: post.summary })),
  });
  return { preview, knock, season, issue, admission, roster, posts };
}

export interface DecisionResult {
  knock_id: string;
  decision: "admitted" | "denied";
  grant_id?: string;
  grant_expires_at?: string;
  posts: PostOutcome[];
}

export async function executeAdmit(ctx: FleetContext, plan: AdmitPlan): Promise<DecisionResult> {
  const hub = requireHub(ctx);
  const fleet = ctx.store.fleet;
  const admin = await adminClient(ctx, hub);
  const now = ctx.now().toISOString();
  fleet.addHubGrant({ ...plan.issue, mission_id: plan.season.mission_id, purpose: "season", room_id: plan.season.room_id, state: "requested", requested_at: now });
  const grant = await admin.issueGrant(plan.season.mission_id, plan.issue);
  fleet.markHubGrantIssued(grant.grant_id, grant.expires_at);
  fleet.transaction(() => {
    fleet.addDecision({
      knock_id: plan.knock.knock_id,
      room_id: plan.knock.room_id,
      identity_id: plan.knock.requester.identity_id,
      knock_sha256: documentSha256(plan.knock.summary),
      decision: "admitted",
      decided_at: now,
      summary: plan.posts[0]!.post.summary,
    });
    fleet.addMember({
      mission_id: plan.season.mission_id,
      room_id: plan.season.room_id,
      identity_id: plan.issue.identity_id,
      tier: plan.admission.tier,
      term_ends_at: plan.admission.term_ends_at,
      knock_id: plan.knock.knock_id,
      grant_id: grant.grant_id,
      admitted_at: now,
    });
    recordKeyedRoster(ctx, plan.roster);
    // Every post is saved with the decision, before the first send, so a
    // failure part-way through leaves the rest in the outbox, not lost.
    for (const { post, seat } of plan.posts) queuePost(ctx, post, seat);
  });
  const posts: PostOutcome[] = [];
  for (const { post, seat } of plan.posts) posts.push(await sendPost(ctx, post, seat));
  return { knock_id: plan.knock.knock_id, decision: "admitted", grant_id: grant.grant_id, grant_expires_at: grant.expires_at, posts };
}

// ── deny ───────────────────────────────────────────────────────────────

export interface DenyPlan {
  preview: ActPreview;
  knock: HubKnock;
  post: PreparedPost;
  seat: ReturnType<typeof seatOf>;
}

export async function planDeny(ctx: FleetContext, input: { knock_id: string; reason?: string }): Promise<DenyPlan> {
  const hub = requireHub(ctx);
  const desk = requireHubDesk(ctx);
  const knock = requirePendingKnock(await hubKnocks(ctx), assertUuid(input.knock_id, "knock_id"));
  requireDistinctApprover(desk, knock);
  const room = requireFleetRoom(ctx, knock.room_id);
  const reason = checkText(input.reason ?? "", { field: "reason", min: 0, max: 280, multiline: true });
  const now = ctx.now();
  const denial: DenialBody = {
    knock_id: knock.knock_id,
    room_id: knock.room_id,
    identity_id: knock.requester.identity_id,
    reason,
    issued_at: now.toISOString(),
  };
  const summary = sealDocument("denial", denial, { privateKey: await doorKey(ctx, hub), fingerprint: hub.door_fingerprint }).summary;
  const { seat } = requireSeat(ctx, hub.directory_mission_id, "mission.observe", 5 * 60_000, "; run hub seat directory");
  const post = preparePost(ctx, "denial", hub.directory_mission_id, summary, gateOfRoom(room));
  const preview = actPreview("hub.deny", knock.knock_id, now.toISOString(), [
    `requester ${knock.requester.fingerprint} ${JSON.stringify(knock.requester.display_name)} did:at:${knock.requester.identity_id}`,
    `room ${room.room_id} ${JSON.stringify(room.title)}`,
    `reason ${JSON.stringify(reason)} (visible to every fleet device and the service)`,
  ], {
    knock_id: knock.knock_id,
    knock_sha256: documentSha256(knock.summary),
    approver_did: `did:at:${desk.identity_id}`,
    requester_did: `did:at:${knock.requester.identity_id}`,
    post: { mission_id: post.mission_id, event_id: post.event_id, summary },
  });
  return { preview, knock, post, seat };
}

export async function executeDeny(ctx: FleetContext, plan: DenyPlan): Promise<DecisionResult> {
  ctx.store.fleet.addDecision({
    knock_id: plan.knock.knock_id,
    room_id: plan.knock.room_id,
    identity_id: plan.knock.requester.identity_id,
    knock_sha256: documentSha256(plan.knock.summary),
    decision: "denied",
    decided_at: ctx.now().toISOString(),
    summary: plan.post.summary,
  });
  return { knock_id: plan.knock.knock_id, decision: "denied", posts: [await sendPost(ctx, plan.post, plan.seat)] };
}
