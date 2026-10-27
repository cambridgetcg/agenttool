/** Reading the fleet hall from cached mission events.
 *
 * Pure: given events (from lobby.sqlite's cache) and the pinned door key, it
 * verifies and classifies them. It never fetches, writes or reads a secret,
 * so the read-only MCP server can use it. Door-kind documents count only when
 * their signer is the pinned door fingerprint and the Ed25519 signature
 * verifies against the pinned public key; anything else is reported as
 * unverified with a closed reason and no text. Contract:
 * packages/lobby/README.md#fleet-hall.
 */
import { LobbyError } from "./errors.js";
import { mentionsDeviceOnlyWork } from "./room.js";
import {
  DESK_NOTE_KINDS,
  DOOR_KINDS,
  openDocument,
  verifyDocument,
  type AdmissionBody,
  type DenialBody,
  type DirectoryRenewalBody,
  type DirectoryRenewBody,
  type FleetCard,
  type KnockBody,
  type LeaveBody,
  type MemberRosterBody,
  type RenewalBody,
  type RenewBody,
  type RosterBody,
  type SignedEnvelope,
} from "./signed.js";
import {
  isUuid,
  LOBBY_ORIGIN,
  MISSION_REQUEST_DOMAIN,
  MISSIONS_PATH,
  requestDigest,
  sha256HexOf,
  verifyBytes,
  type MissionEvent,
} from "./wire.js";

export interface DoorPin {
  fingerprint: string;
  public_key: string;
}

export interface VerifiedDocument<B> {
  envelope: SignedEnvelope<B>;
  summary: string;
  event: MissionEvent;
}

export type UnverifiedReason =
  | "not_an_observation"
  | "malformed_document"
  | "door_not_pinned"
  | "signer_not_door"
  | "bad_signature"
  | "device_only_term"
  | "stale_card";

export interface UnverifiedEvent {
  event_id: string;
  received_seq: string;
  kind: string | null;
  reason: UnverifiedReason;
  authority: "none";
}

export interface FleetView {
  /** Latest door-signed card per room, by card_seq (an older card replayed later never wins). */
  cards: Map<string, VerifiedDocument<FleetCard>>;
  admissions: VerifiedDocument<AdmissionBody>[];
  denials: VerifiedDocument<DenialBody>[];
  rosters: VerifiedDocument<RosterBody>[];
  /** Door-signed keyed rosters (the table-talk pin source), in receipt order. */
  memberRosters: VerifiedDocument<MemberRosterBody>[];
  /** Door-signed renewal notices, in receipt order. */
  renewals: VerifiedDocument<RenewalBody>[];
  /** Desk-signed knocks, shape-checked only; the hub verifies them against its device registry. */
  knocks: Array<{ envelope: SignedEnvelope<KnockBody>; summary: string; event: MissionEvent }>;
  /** Desk-signed renew requests and leave notices, shape-checked only; the
   * hub verifies them against its device registry exactly like knocks. */
  deskNotes: Array<{ envelope: SignedEnvelope<RenewBody | LeaveBody>; summary: string; event: MissionEvent }>;
  /** Desk-signed requests for a next directory grant, shape-checked only; the
   * hub verifies them against its device registry like every desk note. */
  directoryRenewRequests: Array<{ envelope: SignedEnvelope<DirectoryRenewBody>; summary: string; event: MissionEvent }>;
  /** Door-signed notices of renewed directory grants, in receipt order. */
  directoryRenewals: VerifiedDocument<DirectoryRenewalBody>[];
  unverified: UnverifiedEvent[];
}

/** The summary of an observation event, from its signed raw body, or null. */
export function observationSummary(event: MissionEvent): string | null {
  let body: unknown;
  try {
    body = JSON.parse(event.raw_body.replace(/^﻿/, ""));
  } catch {
    return null;
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(",");
  if (keys !== "event_id,summary" && keys !== "event_id,seat,summary") return null;
  if (record.event_id !== event.event_id || typeof record.summary !== "string") return null;
  return record.summary;
}

/** True when the event's stored exact-request proof binds its raw body and
 * verifies against `publicKey` (which must also be the proof's own key). */
export function verifyEventProof(event: MissionEvent, publicKey: string): boolean {
  const proof = event.proof;
  if (proof.domain !== MISSION_REQUEST_DOMAIN || proof.origin !== LOBBY_ORIGIN || proof.method !== "POST"
    || proof.request_target !== `${MISSIONS_PATH}/${event.mission_id}/events` || proof.raw_body !== event.raw_body
    || proof.body_sha256 !== sha256HexOf(event.raw_body) || event.body_sha256 !== proof.body_sha256
    || proof.public_key !== publicKey || !isUuid(event.grant_id)) {
    return false;
  }
  const signature = Buffer.from(proof.signature ?? "", "base64url");
  if (signature.length !== 64 || signature.toString("base64url") !== proof.signature) return false;
  try {
    return verifyBytes(publicKey, requestDigest({
      origin: LOBBY_ORIGIN,
      method: "POST",
      target: proof.request_target,
      missionId: event.mission_id,
      grantId: event.grant_id,
      identityId: event.identity_id,
      keyId: event.signing_key_id,
      body: event.raw_body,
      timestamp: proof.timestamp ?? "",
    }), signature);
  } catch {
    return false;
  }
}

export function readFleetEvents(events: readonly MissionEvent[], door: DoorPin | null): FleetView {
  const view: FleetView = {
    cards: new Map(), admissions: [], denials: [], rosters: [], memberRosters: [], renewals: [], knocks: [], deskNotes: [],
    directoryRenewRequests: [], directoryRenewals: [], unverified: [],
  };
  const reject = (event: MissionEvent, kind: string | null, reason: UnverifiedReason) => {
    view.unverified.push({ event_id: event.event_id, received_seq: event.received_seq, kind, reason, authority: "none" });
  };
  for (const event of events) {
    const summary = observationSummary(event);
    if (summary === null) {
      reject(event, null, "not_an_observation");
      continue;
    }
    let envelope: SignedEnvelope | null;
    try {
      envelope = openDocument(summary);
    } catch (error) {
      if (!(error instanceof LobbyError)) throw error;
      reject(event, null, "malformed_document");
      continue;
    }
    if (envelope === null) continue; // ordinary text, not a lobby document
    if (envelope.kind === "knock") {
      view.knocks.push({ envelope: envelope as SignedEnvelope<KnockBody>, summary, event });
      continue;
    }
    if (envelope.kind === "directory_renew") {
      view.directoryRenewRequests.push({ envelope: envelope as SignedEnvelope<DirectoryRenewBody>, summary, event });
      continue;
    }
    if (DESK_NOTE_KINDS.includes(envelope.kind)) {
      view.deskNotes.push({ envelope: envelope as SignedEnvelope<RenewBody | LeaveBody>, summary, event });
      continue;
    }
    if (!DOOR_KINDS.includes(envelope.kind)) {
      reject(event, envelope.kind, "malformed_document");
      continue;
    }
    if (door === null) {
      reject(event, envelope.kind, "door_not_pinned");
      continue;
    }
    if (envelope.signer !== door.fingerprint) {
      reject(event, envelope.kind, "signer_not_door");
      continue;
    }
    if (!verifyDocument(envelope, door.public_key)) {
      reject(event, envelope.kind, "bad_signature");
      continue;
    }
    const verified = { envelope, summary, event };
    switch (envelope.kind) {
      case "card": {
        const card = envelope.body as FleetCard;
        if (mentionsDeviceOnlyWork({ ...card, house_rules: "" })) {
          reject(event, "card", "device_only_term");
          break;
        }
        const current = view.cards.get(card.room_id);
        if (current !== undefined && current.envelope.body.card_seq >= card.card_seq) {
          // A replay of an older or equal sequence number never replaces the newer card.
          if (current.summary !== summary) reject(event, "card", "stale_card");
          break;
        }
        view.cards.set(card.room_id, verified as VerifiedDocument<FleetCard>);
        break;
      }
      case "admission":
        view.admissions.push(verified as VerifiedDocument<AdmissionBody>);
        break;
      case "denial":
        view.denials.push(verified as VerifiedDocument<DenialBody>);
        break;
      case "roster":
        view.rosters.push(verified as VerifiedDocument<RosterBody>);
        break;
      case "member_roster":
        view.memberRosters.push(verified as VerifiedDocument<MemberRosterBody>);
        break;
      case "renewal":
        view.renewals.push(verified as VerifiedDocument<RenewalBody>);
        break;
      case "directory_renewal":
        view.directoryRenewals.push(verified as VerifiedDocument<DirectoryRenewalBody>);
        break;
    }
  }
  return view;
}

export interface FleetCardFilter {
  tag?: string;
  status?: string;
  door?: string;
  tier?: string;
}

/** Exact filters only, ordered by room_id; no ranking. */
export function filterFleetCards(view: FleetView, filter: FleetCardFilter): VerifiedDocument<FleetCard>[] {
  return [...view.cards.values()]
    .filter(({ envelope: { body } }) =>
      (filter.tag === undefined || body.tags.includes(filter.tag))
      && (filter.status === undefined || body.status === filter.status)
      && (filter.door === undefined || body.door === filter.door)
      && (filter.tier === undefined || body.slots.some((slot) => slot.tier === filter.tier && slot.count > 0)))
    .sort((left, right) => left.envelope.body.room_id < right.envelope.body.room_id ? -1 : 1);
}
