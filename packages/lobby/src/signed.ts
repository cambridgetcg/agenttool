/** Signed lobby documents: `agenttool-lobby-signed/v1`.
 *
 * Every fleet-hall document travels as the summary of one mission
 * observation, so the whole envelope, signature included, must fit the
 * service's 1000-scalar observation limit and pass the egress gate. That is
 * why signatures and key fingerprints are lower-case hex, never base64: the
 * gate refuses key-like base64 runs.
 *
 * Kinds and signers:
 * - `card`, `admission`, `denial`, `roster`, `member_roster`, `renewal`,
 *   `directory_renewal` and `directory_successor` are signed by the hub's
 *   **door** key and verified against the door key pinned on each device out
 *   of band.
 * - `knock`, `renew`, `leave` and `directory_renew` are signed by a member
 *   device's **desk** key and verified by the hub against the public key it
 *   recorded when it relayed (or, for an adopted season, added) that device.
 *
 * Kinds are additive: a reader that does not know a kind reports it as
 * malformed and never acts on it. A change to an existing kind's body is a
 * new kind, never an in-place edit (`member_roster` is the keyed successor of
 * `roster`, which stays readable but is no longer posted).
 *
 * The signed digest is sha256("agenttool-lobby-signed/v1" 0x00 kind 0x00
 * canonical(body)); the summary is the canonical JSON of the envelope.
 * Pure: no I/O. Contract: packages/lobby/README.md#fleet-hall.
 */
import type { KeyObject } from "node:crypto";
import { LobbyError } from "./errors.js";
import { checkSlots, checkTags, DOORS, isRoomId, member, ROOM_LIMITS, ROOM_STATUSES, SLOT_TIERS,
  type Door, type RoomSlot, type RoomStatus, type SlotTier } from "./room.js";
import { checkText } from "./text.js";
import {
  assertCanonicalTime,
  assertDigest,
  assertUuid,
  INVITATION_TEMPLATE_FORMAT,
  isSha256Hex,
  LOBBY_ORIGIN,
  MISSION_LIMITS,
  parseCanonicalJson,
  rawPublicKey,
  scalarLength,
  sha256Bytes,
  signBytes,
  verifyBytes,
  wireCanonicalJson,
} from "./wire.js";

export const SIGNED_FORMAT = "agenttool-lobby-signed/v1" as const;
export const SIGNED_KINDS = ["card", "knock", "admission", "denial", "roster", "member_roster", "renewal", "renew", "leave",
  "directory_renew", "directory_renewal", "directory_successor"] as const;
export type SignedKind = typeof SIGNED_KINDS[number];
/** Kinds only the door may sign. */
export const DOOR_KINDS: readonly SignedKind[] = ["card", "admission", "denial", "roster", "member_roster", "renewal", "directory_renewal",
  "directory_successor"];
/** Kinds a member desk signs about a room it sits in; the hub verifies them against its device registry. */
export const DESK_NOTE_KINDS: readonly SignedKind[] = ["renew", "leave"];

export const KNOCK_MAX_MS = 72 * 3_600_000;
export const ADMISSION_MAX_MS = 24 * 3_600_000;
/** A directory (and so its successor) lasts at most 30 days. */
export const DIRECTORY_MAX_MS = 30 * 24 * 3_600_000;
/** A renew request is good for at most 24 hours. */
export const RENEW_MAX_MS = 24 * 3_600_000;
export const NOTE_MAX = 280;
export const ROSTER_MAX_MEMBERS = 16;

const FINGERPRINT = /^[0-9a-f]{16}$/;
const SIGNATURE_HEX = /^[0-9a-f]{128}$/;
/** A raw 32-byte Ed25519 public key in lower-case hex: signed documents never
 * carry base64 keys, because the egress gate refuses key-like base64 runs. */
const PUBLIC_KEY_HEX = /^[0-9a-f]{64}$/;

export interface SeasonRef {
  mission_id: string;
  mission_digest: string;
  expires_at: string;
}

/** The compact, door-signed card a fleet device sees. Purpose is the room's
 * short purpose; the full charter is the season mission descriptor. */
export interface FleetCard {
  room_id: string;
  card_seq: number;
  title: string;
  purpose: string;
  tags: string[];
  status: RoomStatus;
  door: Door;
  residency: "fleet";
  slots: RoomSlot[];
  season: SeasonRef;
  issued_at: string;
}

export interface KnockBody {
  knock_id: string;
  room_id: string;
  /** The season mission digest the card named when the device knocked. */
  charter_digest: string;
  tier: SlotTier;
  /** SHA-256 of a fresh room token generated on the requesting device. */
  token_sha256: string;
  /** At most 280 scalars; untrusted text. */
  note: string;
  issued_at: string;
  expires_at: string;
}

export interface AdmissionBody {
  knock_id: string;
  room_id: string;
  mission_id: string;
  mission_digest: string;
  identity_id: string;
  signing_key_id: string;
  tier: SlotTier;
  grant: { grant_id: string; expires_at: string; token_sha256: string };
  term_ends_at: string;
  issued_at: string;
  /** Single use within 24 hours of issue. */
  expires_at: string;
}

export interface DenialBody {
  knock_id: string;
  room_id: string;
  identity_id: string;
  reason: string;
  issued_at: string;
}

export interface RosterMember {
  identity_id: string;
  tier: SlotTier;
  term_ends_at: string;
}

/** One part of a roster; a roster too long for one observation is split
 * into `parts` documents with the same `issued_at`. */
export interface RosterBody {
  room_id: string;
  mission_id: string;
  members: RosterMember[];
  part: number;
  parts: number;
  issued_at: string;
}

export const MEMBER_ROLES = ["host", "member"] as const;
export type MemberRole = typeof MEMBER_ROLES[number];

/** One member of a keyed roster: the pin a fellow member uses to verify
 * table talk. `public_key_hex` is the raw key in hex (see PUBLIC_KEY_HEX). */
export interface KeyedMember {
  identity_id: string;
  signing_key_id: string;
  public_key_hex: string;
  tier: SlotTier;
  role: MemberRole;
  term_ends_at: string;
}

/** One part of a door-signed keyed roster. `roster_seq` rises with every new
 * roster of a season; a reader uses the highest complete sequence, so an
 * older roster replayed later never restores a removed member. */
export interface MemberRosterBody {
  room_id: string;
  mission_id: string;
  roster_seq: number;
  members: KeyedMember[];
  part: number;
  parts: number;
  issued_at: string;
}

/** A member desk's signed request for its next grant inside its term,
 * bound to the SHA-256 of a token it generated locally. */
export interface RenewBody {
  room_id: string;
  mission_id: string;
  identity_id: string;
  signing_key_id: string;
  token_sha256: string;
  issued_at: string;
  expires_at: string;
}

/** A member desk's signed notice that it is leaving the season. */
export interface LeaveBody {
  room_id: string;
  mission_id: string;
  identity_id: string;
  signing_key_id: string;
  issued_at: string;
}

/** The token-free invitation template of a renewed grant, minus its two
 * constant fields (format and origin), with the member's public key in hex.
 * `invitationTemplateOf` rebuilds the exact
 * `agenttool-mission-invitation-template/v1` document. */
export interface RenewalInvitation {
  mission_id: string;
  grant_id: string;
  identity_id: string;
  signing_key_id: string;
  public_key_hex: string;
  expires_at: string;
  token_sha256: string;
}

/** The door's signed notice of a renewed grant. */
export interface RenewalBody {
  room_id: string;
  tier: SlotTier;
  term_ends_at: string;
  invitation: RenewalInvitation;
  issued_at: string;
}

/** A desk's signed request for its next directory grant (schema version 4).
 * The desk chooses both the grant id and the token hash, so it can pick the
 * grant up with an invitation read alone, even after its old grant lapsed.
 * `mission_id` is the directory the grant is asked for. No room: a renew note
 * for a room keeps its own kind, `renew`. */
export interface DirectoryRenewBody {
  mission_id: string;
  grant_id: string;
  identity_id: string;
  signing_key_id: string;
  token_sha256: string;
  issued_at: string;
  expires_at: string;
}

/** The door's signed notice of a renewed directory grant: an audit trail and
 * a cross-check for the desk, never required for its pickup. */
export interface DirectoryRenewalBody {
  invitation: RenewalInvitation;
  issued_at: string;
}

/** The door's signed notice that directory `from` has a successor, `to`
 * (schema version 6): the next directory mission, whose charter names the
 * same door and `from` as its predecessor. A desk that joined `from` moves to
 * `to` on its next renewal pickup; the door pin never changes. */
export interface DirectorySuccessorBody {
  from_mission_id: string;
  from_mission_digest: string;
  from_expires_at: string;
  to_mission_id: string;
  to_mission_digest: string;
  to_expires_at: string;
  issued_at: string;
}

export type SignedBody = FleetCard | KnockBody | AdmissionBody | DenialBody | RosterBody | MemberRosterBody | RenewBody
  | LeaveBody | RenewalBody | DirectoryRenewBody | DirectoryRenewalBody | DirectorySuccessorBody;

export interface SignedEnvelope<B = SignedBody> {
  format: typeof SIGNED_FORMAT;
  kind: SignedKind;
  signer: string;
  body: B;
  sig: string;
}

function exact(value: unknown, keys: readonly string[], what: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) {
    throw new LobbyError("invalid_signed_document", `${what} does not have exactly the expected fields`);
  }
  return value as Record<string, unknown>;
}

function roomIdOf(value: unknown): string {
  if (!isRoomId(value)) throw new LobbyError("invalid_signed_document", "room_id must be a lobby room id");
  return value;
}

function tokenHash(value: unknown): string {
  if (!isSha256Hex(value)) throw new LobbyError("invalid_signed_document", "token_sha256 must be 64 lowercase hex");
  return value;
}

function seasonRef(value: unknown): SeasonRef {
  const record = exact(value, ["mission_id", "mission_digest", "expires_at"], "season");
  return {
    mission_id: assertUuid(record.mission_id, "mission_id"),
    mission_digest: assertDigest(record.mission_digest, "mission_digest"),
    expires_at: assertCanonicalTime(record.expires_at, "expires_at"),
  };
}

export function validateFleetCard(value: unknown): FleetCard {
  const record = exact(value, ["room_id", "card_seq", "title", "purpose", "tags", "status", "door", "residency",
    "slots", "season", "issued_at"], "card");
  if (typeof record.card_seq !== "number" || !Number.isSafeInteger(record.card_seq) || record.card_seq < 1) {
    throw new LobbyError("invalid_signed_document", "card_seq must be a positive integer");
  }
  if (record.residency !== "fleet") throw new LobbyError("invalid_signed_document", "a fleet card has residency fleet");
  return {
    room_id: roomIdOf(record.room_id),
    card_seq: record.card_seq,
    title: checkText(record.title, { field: "title", min: 1, max: ROOM_LIMITS.title }),
    purpose: checkText(record.purpose, { field: "purpose", min: 0, max: ROOM_LIMITS.purpose, multiline: true }),
    tags: checkTags(record.tags),
    status: member(record.status, ROOM_STATUSES, "status"),
    door: member(record.door, DOORS, "door"),
    residency: "fleet",
    slots: checkSlots(record.slots),
    season: seasonRef(record.season),
    issued_at: assertCanonicalTime(record.issued_at, "issued_at"),
  };
}

export function validateKnock(value: unknown): KnockBody {
  const record = exact(value, ["knock_id", "room_id", "charter_digest", "tier", "token_sha256", "note",
    "issued_at", "expires_at"], "knock");
  const body: KnockBody = {
    knock_id: assertUuid(record.knock_id, "knock_id"),
    room_id: roomIdOf(record.room_id),
    charter_digest: assertDigest(record.charter_digest, "charter_digest"),
    tier: member(record.tier, SLOT_TIERS, "tier"),
    token_sha256: tokenHash(record.token_sha256),
    note: checkText(record.note, { field: "note", min: 0, max: NOTE_MAX, multiline: true }),
    issued_at: assertCanonicalTime(record.issued_at, "issued_at"),
    expires_at: assertCanonicalTime(record.expires_at, "expires_at"),
  };
  const lifetime = Date.parse(body.expires_at) - Date.parse(body.issued_at);
  if (lifetime <= 0 || lifetime > KNOCK_MAX_MS) {
    throw new LobbyError("invalid_signed_document", "a knock expires within 72 hours of being issued");
  }
  return body;
}

export function validateAdmission(value: unknown): AdmissionBody {
  const record = exact(value, ["knock_id", "room_id", "mission_id", "mission_digest", "identity_id",
    "signing_key_id", "tier", "grant", "term_ends_at", "issued_at", "expires_at"], "admission");
  const grant = exact(record.grant, ["grant_id", "expires_at", "token_sha256"], "admission grant");
  const body: AdmissionBody = {
    knock_id: assertUuid(record.knock_id, "knock_id"),
    room_id: roomIdOf(record.room_id),
    mission_id: assertUuid(record.mission_id, "mission_id"),
    mission_digest: assertDigest(record.mission_digest, "mission_digest"),
    identity_id: assertUuid(record.identity_id, "identity_id"),
    signing_key_id: assertUuid(record.signing_key_id, "signing_key_id"),
    tier: member(record.tier, SLOT_TIERS, "tier"),
    grant: {
      grant_id: assertUuid(grant.grant_id, "grant_id"),
      expires_at: assertCanonicalTime(grant.expires_at, "grant_expires_at"),
      token_sha256: tokenHash(grant.token_sha256),
    },
    term_ends_at: assertCanonicalTime(record.term_ends_at, "term_ends_at"),
    issued_at: assertCanonicalTime(record.issued_at, "issued_at"),
    expires_at: assertCanonicalTime(record.expires_at, "expires_at"),
  };
  const issued = Date.parse(body.issued_at);
  const lifetime = Date.parse(body.expires_at) - issued;
  if (lifetime <= 0 || lifetime > ADMISSION_MAX_MS) {
    throw new LobbyError("invalid_signed_document", "an admission expires within 24 hours of being issued");
  }
  const grantLife = Date.parse(body.grant.expires_at) - issued;
  if (grantLife <= 0 || grantLife > MISSION_LIMITS.grantMs || Date.parse(body.grant.expires_at) > Date.parse(body.term_ends_at)) {
    throw new LobbyError("invalid_signed_document", "an admission grant lasts at most 24 hours and ends within the term");
  }
  return body;
}

export function validateDenial(value: unknown): DenialBody {
  const record = exact(value, ["knock_id", "room_id", "identity_id", "reason", "issued_at"], "denial");
  return {
    knock_id: assertUuid(record.knock_id, "knock_id"),
    room_id: roomIdOf(record.room_id),
    identity_id: assertUuid(record.identity_id, "identity_id"),
    reason: checkText(record.reason, { field: "reason", min: 0, max: NOTE_MAX, multiline: true }),
    issued_at: assertCanonicalTime(record.issued_at, "issued_at"),
  };
}

export function validateRoster(value: unknown): RosterBody {
  const record = exact(value, ["room_id", "mission_id", "members", "part", "parts", "issued_at"], "roster");
  if (!Array.isArray(record.members) || record.members.length > ROSTER_MAX_MEMBERS) {
    throw new LobbyError("invalid_signed_document", `a roster part lists at most ${ROSTER_MAX_MEMBERS} members`);
  }
  const { part, parts } = record;
  if (typeof parts !== "number" || !Number.isInteger(parts) || parts < 1 || parts > 64
    || typeof part !== "number" || !Number.isInteger(part) || part < 1 || part > parts) {
    throw new LobbyError("invalid_signed_document", "a roster part is numbered 1..parts, at most 64 parts");
  }
  const seen = new Set<string>();
  const members = record.members.map((entry) => {
    const item = exact(entry, ["identity_id", "tier", "term_ends_at"], "roster member");
    const identity = assertUuid(item.identity_id, "identity_id");
    if (seen.has(identity)) throw new LobbyError("invalid_signed_document", "a roster lists each member once");
    seen.add(identity);
    return {
      identity_id: identity,
      tier: member(item.tier, SLOT_TIERS, "tier"),
      term_ends_at: assertCanonicalTime(item.term_ends_at, "term_ends_at"),
    };
  });
  return {
    room_id: roomIdOf(record.room_id),
    mission_id: assertUuid(record.mission_id, "mission_id"),
    members,
    part,
    parts,
    issued_at: assertCanonicalTime(record.issued_at, "issued_at"),
  };
}

function publicKeyHex(value: unknown): string {
  if (typeof value !== "string" || !PUBLIC_KEY_HEX.test(value)) {
    throw new LobbyError("invalid_signed_document", "public_key_hex must be 64 lowercase hex");
  }
  return value;
}

export function validateMemberRoster(value: unknown): MemberRosterBody {
  const record = exact(value, ["room_id", "mission_id", "roster_seq", "members", "part", "parts", "issued_at"], "member roster");
  if (typeof record.roster_seq !== "number" || !Number.isSafeInteger(record.roster_seq) || record.roster_seq < 1) {
    throw new LobbyError("invalid_signed_document", "roster_seq must be a positive integer");
  }
  if (!Array.isArray(record.members) || record.members.length > ROSTER_MAX_MEMBERS) {
    throw new LobbyError("invalid_signed_document", `a roster part lists at most ${ROSTER_MAX_MEMBERS} members`);
  }
  const { part, parts } = record;
  if (typeof parts !== "number" || !Number.isInteger(parts) || parts < 1 || parts > 64
    || typeof part !== "number" || !Number.isInteger(part) || part < 1 || part > parts) {
    throw new LobbyError("invalid_signed_document", "a roster part is numbered 1..parts, at most 64 parts");
  }
  const seen = new Set<string>();
  const members = record.members.map((entry) => {
    const item = exact(entry, ["identity_id", "signing_key_id", "public_key_hex", "tier", "role", "term_ends_at"], "roster member");
    const identity = assertUuid(item.identity_id, "identity_id");
    if (seen.has(identity)) throw new LobbyError("invalid_signed_document", "a roster lists each member once");
    seen.add(identity);
    return {
      identity_id: identity,
      signing_key_id: assertUuid(item.signing_key_id, "signing_key_id"),
      public_key_hex: publicKeyHex(item.public_key_hex),
      tier: member(item.tier, SLOT_TIERS, "tier"),
      role: member(item.role, MEMBER_ROLES, "role"),
      term_ends_at: assertCanonicalTime(item.term_ends_at, "term_ends_at"),
    };
  });
  return {
    room_id: roomIdOf(record.room_id),
    mission_id: assertUuid(record.mission_id, "mission_id"),
    roster_seq: record.roster_seq,
    members,
    part,
    parts,
    issued_at: assertCanonicalTime(record.issued_at, "issued_at"),
  };
}

export function validateRenew(value: unknown): RenewBody {
  const record = exact(value, ["room_id", "mission_id", "identity_id", "signing_key_id", "token_sha256", "issued_at", "expires_at"], "renew");
  const body: RenewBody = {
    room_id: roomIdOf(record.room_id),
    mission_id: assertUuid(record.mission_id, "mission_id"),
    identity_id: assertUuid(record.identity_id, "identity_id"),
    signing_key_id: assertUuid(record.signing_key_id, "signing_key_id"),
    token_sha256: tokenHash(record.token_sha256),
    issued_at: assertCanonicalTime(record.issued_at, "issued_at"),
    expires_at: assertCanonicalTime(record.expires_at, "expires_at"),
  };
  const lifetime = Date.parse(body.expires_at) - Date.parse(body.issued_at);
  if (lifetime <= 0 || lifetime > RENEW_MAX_MS) {
    throw new LobbyError("invalid_signed_document", "a renew request expires within 24 hours of being issued");
  }
  return body;
}

export function validateLeave(value: unknown): LeaveBody {
  const record = exact(value, ["room_id", "mission_id", "identity_id", "signing_key_id", "issued_at"], "leave");
  return {
    room_id: roomIdOf(record.room_id),
    mission_id: assertUuid(record.mission_id, "mission_id"),
    identity_id: assertUuid(record.identity_id, "identity_id"),
    signing_key_id: assertUuid(record.signing_key_id, "signing_key_id"),
    issued_at: assertCanonicalTime(record.issued_at, "issued_at"),
  };
}

export function validateRenewal(value: unknown): RenewalBody {
  const record = exact(value, ["room_id", "tier", "term_ends_at", "invitation", "issued_at"], "renewal");
  const invitation = exact(record.invitation, ["mission_id", "grant_id", "identity_id", "signing_key_id", "public_key_hex",
    "expires_at", "token_sha256"], "renewal invitation");
  const body: RenewalBody = {
    room_id: roomIdOf(record.room_id),
    tier: member(record.tier, SLOT_TIERS, "tier"),
    term_ends_at: assertCanonicalTime(record.term_ends_at, "term_ends_at"),
    invitation: {
      mission_id: assertUuid(invitation.mission_id, "mission_id"),
      grant_id: assertUuid(invitation.grant_id, "grant_id"),
      identity_id: assertUuid(invitation.identity_id, "identity_id"),
      signing_key_id: assertUuid(invitation.signing_key_id, "signing_key_id"),
      public_key_hex: publicKeyHex(invitation.public_key_hex),
      expires_at: assertCanonicalTime(invitation.expires_at, "expires_at"),
      token_sha256: tokenHash(invitation.token_sha256),
    },
    issued_at: assertCanonicalTime(record.issued_at, "issued_at"),
  };
  const grantLife = Date.parse(body.invitation.expires_at) - Date.parse(body.issued_at);
  if (grantLife <= 0 || grantLife > MISSION_LIMITS.grantMs || Date.parse(body.invitation.expires_at) > Date.parse(body.term_ends_at)) {
    throw new LobbyError("invalid_signed_document", "a renewed grant lasts at most 24 hours and ends within the term");
  }
  return body;
}

export function validateDirectoryRenew(value: unknown): DirectoryRenewBody {
  const record = exact(value, ["mission_id", "grant_id", "identity_id", "signing_key_id", "token_sha256", "issued_at", "expires_at"], "directory renew");
  const body: DirectoryRenewBody = {
    mission_id: assertUuid(record.mission_id, "mission_id"),
    grant_id: assertUuid(record.grant_id, "grant_id"),
    identity_id: assertUuid(record.identity_id, "identity_id"),
    signing_key_id: assertUuid(record.signing_key_id, "signing_key_id"),
    token_sha256: tokenHash(record.token_sha256),
    issued_at: assertCanonicalTime(record.issued_at, "issued_at"),
    expires_at: assertCanonicalTime(record.expires_at, "expires_at"),
  };
  const lifetime = Date.parse(body.expires_at) - Date.parse(body.issued_at);
  if (lifetime <= 0 || lifetime > RENEW_MAX_MS) {
    throw new LobbyError("invalid_signed_document", "a directory renew request expires within 24 hours of being issued");
  }
  return body;
}

function renewalInvitation(value: unknown, what: string): RenewalInvitation {
  const invitation = exact(value, ["mission_id", "grant_id", "identity_id", "signing_key_id", "public_key_hex",
    "expires_at", "token_sha256"], what);
  return {
    mission_id: assertUuid(invitation.mission_id, "mission_id"),
    grant_id: assertUuid(invitation.grant_id, "grant_id"),
    identity_id: assertUuid(invitation.identity_id, "identity_id"),
    signing_key_id: assertUuid(invitation.signing_key_id, "signing_key_id"),
    public_key_hex: publicKeyHex(invitation.public_key_hex),
    expires_at: assertCanonicalTime(invitation.expires_at, "expires_at"),
    token_sha256: tokenHash(invitation.token_sha256),
  };
}

export function validateDirectoryRenewal(value: unknown): DirectoryRenewalBody {
  const record = exact(value, ["invitation", "issued_at"], "directory renewal");
  const body: DirectoryRenewalBody = {
    invitation: renewalInvitation(record.invitation, "directory renewal invitation"),
    issued_at: assertCanonicalTime(record.issued_at, "issued_at"),
  };
  const grantLife = Date.parse(body.invitation.expires_at) - Date.parse(body.issued_at);
  if (grantLife <= 0 || grantLife > MISSION_LIMITS.grantMs) {
    throw new LobbyError("invalid_signed_document", "a renewed directory grant lasts at most 24 hours");
  }
  return body;
}

export function validateDirectorySuccessor(value: unknown): DirectorySuccessorBody {
  const record = exact(value, ["from_mission_id", "from_mission_digest", "from_expires_at", "to_mission_id", "to_mission_digest",
    "to_expires_at", "issued_at"], "directory successor");
  const body: DirectorySuccessorBody = {
    from_mission_id: assertUuid(record.from_mission_id, "from_mission_id"),
    from_mission_digest: assertDigest(record.from_mission_digest, "from_mission_digest"),
    from_expires_at: assertCanonicalTime(record.from_expires_at, "from_expires_at"),
    to_mission_id: assertUuid(record.to_mission_id, "to_mission_id"),
    to_mission_digest: assertDigest(record.to_mission_digest, "to_mission_digest"),
    to_expires_at: assertCanonicalTime(record.to_expires_at, "to_expires_at"),
    issued_at: assertCanonicalTime(record.issued_at, "issued_at"),
  };
  if (body.from_mission_id === body.to_mission_id) {
    throw new LobbyError("invalid_signed_document", "a directory's successor is another mission");
  }
  const toEnds = Date.parse(body.to_expires_at);
  if (toEnds <= Date.parse(body.from_expires_at) || toEnds - Date.parse(body.issued_at) > DIRECTORY_MAX_MS) {
    throw new LobbyError("invalid_signed_document", "a successor directory ends after its predecessor and within 30 days of the notice");
  }
  return body;
}

/** Members per roster part: what fits one observation with the signature. */
export const ROSTER_PART_MEMBERS = 4;
/** Keyed members per member_roster part: each carries two ids and a 64-hex key. */
export const KEYED_ROSTER_PART_MEMBERS = 2;

const VALIDATORS: Record<SignedKind, (value: unknown) => SignedBody> = {
  card: validateFleetCard,
  knock: validateKnock,
  admission: validateAdmission,
  denial: validateDenial,
  roster: validateRoster,
  member_roster: validateMemberRoster,
  renewal: validateRenewal,
  renew: validateRenew,
  leave: validateLeave,
  directory_renew: validateDirectoryRenew,
  directory_renewal: validateDirectoryRenewal,
  directory_successor: validateDirectorySuccessor,
};

export function signingDigest(kind: SignedKind, body: SignedBody): Buffer {
  return sha256Bytes(`${SIGNED_FORMAT}\0${kind}\0${wireCanonicalJson(body)}`);
}

/** Validate, sign and serialize. The returned summary is exactly what is
 * posted, and is refused here when it would not fit one observation. */
export function sealDocument<B extends SignedBody>(
  kind: SignedKind,
  body: B,
  signer: { privateKey: KeyObject; fingerprint: string },
): { envelope: SignedEnvelope<B>; summary: string } {
  const validated = VALIDATORS[kind](body) as B;
  if (!FINGERPRINT.test(signer.fingerprint)) throw new LobbyError("invalid_signer", "signer fingerprint must be 16 hex");
  const sig = signBytes(signer.privateKey, signingDigest(kind, validated)).toString("hex");
  const envelope: SignedEnvelope<B> = { format: SIGNED_FORMAT, kind, signer: signer.fingerprint, body: validated, sig };
  const summary = wireCanonicalJson(envelope);
  assertSummaryFits(summary);
  return { envelope, summary };
}

export function assertSummaryFits(summary: string): void {
  if (scalarLength(summary) > MISSION_LIMITS.summaryScalars) {
    throw new LobbyError(
      "document_too_large",
      `the signed document is ${scalarLength(summary)} characters; one observation holds at most ${MISSION_LIMITS.summaryScalars}. Shorten the title, purpose, tags, slots or note`,
    );
  }
}

/** Parse an observation summary as a signed lobby document. Returns null
 * for text that is not one (ordinary chat, other formats); throws for a
 * document that claims the format but is malformed. Verifies nothing. */
export function openDocument(summary: string): SignedEnvelope | null {
  if (!summary.startsWith(`{"body":`) || !summary.includes(`"format":"${SIGNED_FORMAT}"`)) return null;
  const parsed = parseCanonicalJson(summary);
  const record = exact(parsed, ["format", "kind", "signer", "body", "sig"], "signed document");
  if (record.format !== SIGNED_FORMAT) return null;
  const kind = member(record.kind, SIGNED_KINDS, "kind");
  if (typeof record.signer !== "string" || !FINGERPRINT.test(record.signer)) {
    throw new LobbyError("invalid_signed_document", "signer must be a 16-hex key fingerprint");
  }
  if (typeof record.sig !== "string" || !SIGNATURE_HEX.test(record.sig)) {
    throw new LobbyError("invalid_signed_document", "sig must be 128 lowercase hex");
  }
  const body = VALIDATORS[kind](record.body);
  // The validated body must be the signed body, byte for byte.
  if (wireCanonicalJson(body) !== wireCanonicalJson(record.body)) {
    throw new LobbyError("invalid_signed_document", "the document body is not in its canonical form");
  }
  return { format: SIGNED_FORMAT, kind, signer: record.signer, body, sig: record.sig };
}

/** True only when `publicKey` (standard base64) signed exactly this document. */
export function verifyDocument(envelope: SignedEnvelope, publicKey: string): boolean {
  return verifyBytes(publicKey, signingDigest(envelope.kind, envelope.body), Buffer.from(envelope.sig, "hex"));
}

/** SHA-256 hex of a document's summary bytes: how decisions cite a knock. */
export function documentSha256(summary: string): string {
  return sha256Bytes(summary).toString("hex");
}

// ── Public keys in hex, and the renewal template ───────────────────────

/** Raw public key hex from the standard base64 the service and pin book use. */
export function publicKeyHexOf(publicKeyBase64: string): string {
  return rawPublicKey(publicKeyBase64).toString("hex");
}

/** Standard base64 of a raw public key given in hex. */
export function publicKeyFromHex(hex: string): string {
  return Buffer.from(publicKeyHex(hex), "hex").toString("base64");
}

/** The exact `agenttool-mission-invitation-template/v1` document a renewal
 * notice (room or directory) carries, in the participant client's field
 * order. Holds no secret. */
export function invitationTemplateOf(renewal: { invitation: RenewalInvitation }): Record<string, string> {
  const invitation = renewal.invitation;
  return {
    format: INVITATION_TEMPLATE_FORMAT,
    origin: LOBBY_ORIGIN,
    mission_id: invitation.mission_id,
    grant_id: invitation.grant_id,
    identity_id: invitation.identity_id,
    signing_key_id: invitation.signing_key_id,
    public_key: publicKeyFromHex(invitation.public_key_hex),
    expires_at: invitation.expires_at,
    token_sha256: invitation.token_sha256,
  };
}
