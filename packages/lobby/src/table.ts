/** Table talk: a room's shared, signed message stream, read and checked.
 *
 * Messages are mission observations whose summary is the reviewed
 * participant client's `agenttool-mission-chat/v1` envelope, byte for byte
 * (bin/mission-chat.mjs `message()`): `{format, conversation, to_identity,
 * kind, text[, in_reply_to]}` serialized in that key order, at most 1000
 * Unicode scalars. Every member of the room, and the service, reads every
 * message; `to_identity` names who it is for, not who may read it.
 *
 * Pins come from the door, never from the room: a sender counts as verified
 * only when a complete door-signed `member_roster` of this season (checked
 * against the door key pinned out of band) names its identity, key id and
 * public key, and the event's exact-request proof verifies against that key.
 * Anything else is listed as unverified with a closed reason and no text.
 *
 * Pure: no I/O, no transport, no secret, no signing. The read-only MCP view
 * uses it on this desk's local cache. Contract: packages/lobby/README.md#table-talk.
 */
import { LobbyError } from "./errors.js";
import { checkEgress, type EgressReason, type EgressRoom } from "./egress.js";
import { observationSummary, readFleetEvents, verifyEventProof, type DoorPin, type VerifiedDocument } from "./fleet.js";
import type { SlotTier } from "./room.js";
import { publicKeyFromHex, type MemberRole, type MemberRosterBody } from "./signed.js";
import { checkText } from "./text.js";
import { UNTRUSTED_NOTE } from "./view.js";
import { isUuid, isWellFormed, MISSION_LIMITS, publicKeyFingerprint, scalarLength, type MissionEvent } from "./wire.js";

export const CHAT_FORMAT = "agenttool-mission-chat/v1" as const;
export const CHAT_CONFIG_FORMAT = "agenttool-mission-chat-config/v1" as const;
/** The conversation slug lobby desks use unless told otherwise. */
export const DEFAULT_CONVERSATION = "table";
export const CONVERSATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const CHAT_KINDS = ["message", "read_ack"] as const;
export type ChatKind = typeof CHAT_KINDS[number];
/** A wait lasts at most 45 seconds, like the participant client's. */
export const WAIT_MAX_SECONDS = 45;
export const WAIT_DEFAULT_SECONDS = 30;
/** Poll interval while waiting: at most three seconds, like the participant client's. */
export const WAIT_POLL_MS = 3000;
export const READ_LIMIT_DEFAULT = 20;
export const READ_LIMIT_MAX = 50;
/** The mission-chat configuration pins at most 32 peers. */
const CHAT_CONFIG_MAX_PEERS = 32;

export interface ChatEnvelope {
  format: typeof CHAT_FORMAT;
  conversation: string;
  to_identity: string;
  kind: ChatKind;
  text: string;
  in_reply_to?: string;
}

export function assertConversation(value: unknown): string {
  if (typeof value !== "string" || !CONVERSATION_PATTERN.test(value)) {
    throw new LobbyError("invalid_conversation", "a conversation is 1-64 letters, digits, dots, underscores or hyphens, starting with a letter or digit");
  }
  return value;
}

/** Build one envelope exactly as the participant client does, after the
 * desk's own text hygiene (no control, bidirectional or invisible
 * characters, so the terminal preview shows it as sent). */
export function buildChatEnvelope(input: {
  conversation: string;
  to_identity: string;
  kind: ChatKind;
  text: string;
  in_reply_to?: string;
}): { envelope: ChatEnvelope; summary: string } {
  const conversation = assertConversation(input.conversation);
  if (!isUuid(input.to_identity)) throw new LobbyError("invalid_to", "the destination is an identity UUID");
  if (!(CHAT_KINDS as readonly string[]).includes(input.kind)) throw new LobbyError("invalid_kind", "kind is message or read_ack");
  const text = checkText(input.text, { field: "text", min: 1, max: MISSION_LIMITS.summaryScalars, multiline: true });
  if (input.in_reply_to !== undefined && !isUuid(input.in_reply_to)) {
    throw new LobbyError("invalid_in_reply_to", "in_reply_to is the event UUID of the message being answered");
  }
  if (input.kind === "read_ack" && input.in_reply_to === undefined) {
    throw new LobbyError("read_ack_needs_reference", "a read_ack must name the message it acknowledges (in_reply_to)");
  }
  // Key order is the participant client's: format, conversation, to_identity, kind, text, in_reply_to.
  const envelope: ChatEnvelope = { format: CHAT_FORMAT, conversation, to_identity: input.to_identity, kind: input.kind, text };
  if (input.in_reply_to !== undefined) envelope.in_reply_to = input.in_reply_to;
  const summary = JSON.stringify(envelope);
  if (scalarLength(summary) > MISSION_LIMITS.summaryScalars) {
    throw new LobbyError("message_too_long",
      `the message envelope is ${scalarLength(summary)} characters; one observation holds at most ${MISSION_LIMITS.summaryScalars}. Shorten the text`);
  }
  return { envelope, summary };
}

export type ParsedChat = { envelope: ChatEnvelope } | { malformed: true } | null;

/** The chat envelope in an observation summary: null when the summary is not
 * chat at all, `malformed` when it claims the chat format but breaks it. */
export function parseChatEnvelope(summary: string): ParsedChat {
  let value: unknown;
  try {
    value = JSON.parse(summary);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.format !== CHAT_FORMAT) return null;
  const keys = Object.keys(record).sort().join(",");
  const expected = Object.hasOwn(record, "in_reply_to")
    ? "conversation,format,in_reply_to,kind,text,to_identity"
    : "conversation,format,kind,text,to_identity";
  if (keys !== expected || typeof record.conversation !== "string" || !CONVERSATION_PATTERN.test(record.conversation)
    || !isUuid(record.to_identity) || !(CHAT_KINDS as readonly unknown[]).includes(record.kind)
    || typeof record.text !== "string" || record.text.length === 0 || record.text.includes("\0") || !isWellFormed(record.text)
    || scalarLength(record.text) > MISSION_LIMITS.summaryScalars
    || (record.in_reply_to !== undefined && !isUuid(record.in_reply_to))
    || (record.kind === "read_ack" && record.in_reply_to === undefined)) {
    return { malformed: true };
  }
  return { envelope: record as unknown as ChatEnvelope };
}

// ── Roster pins ────────────────────────────────────────────────────────

export interface RosterPin {
  identity_id: string;
  signing_key_id: string;
  /** Standard base64, as the service's proofs carry it. */
  public_key: string;
  fingerprint: string;
  tier: SlotTier;
  role: MemberRole;
  term_ends_at: string;
  /** On the newest complete roster of this season. */
  current: boolean;
}

export interface TableRoster {
  /** The newest complete door-signed roster sequence, or null when none. */
  roster_seq: number | null;
  issued_at: string | null;
  /** Members of the newest complete roster. */
  members: RosterPin[];
  /** Every identity any complete roster of this season pinned, keyed by identity. */
  pins: Map<string, RosterPin>;
  /** Identities two rosters pinned to different keys: never verified. */
  conflicted: string[];
}

/** Pins from door-verified keyed rosters posted in this season. A roster
 * counts only when every part of its sequence is present and consistent;
 * the highest complete sequence is current, so a replayed older roster never
 * brings back a removed member. */
export function tableRoster(rosters: readonly VerifiedDocument<MemberRosterBody>[], scope: { mission_id: string; room_id: string }): TableRoster {
  const bySeq = new Map<number, { parts: number; issued_at: string; docs: Map<number, string>; members: Map<number, MemberRosterBody["members"]>; broken: boolean }>();
  for (const document of rosters) {
    const body = document.envelope.body;
    if (body.mission_id !== scope.mission_id || body.room_id !== scope.room_id || document.event.mission_id !== scope.mission_id) continue;
    let entry = bySeq.get(body.roster_seq);
    if (entry === undefined) {
      entry = { parts: body.parts, issued_at: body.issued_at, docs: new Map(), members: new Map(), broken: false };
      bySeq.set(body.roster_seq, entry);
    }
    const previous = entry.docs.get(body.part);
    if (entry.parts !== body.parts || entry.issued_at !== body.issued_at || (previous !== undefined && previous !== document.summary)) {
      entry.broken = true;
      continue;
    }
    entry.docs.set(body.part, document.summary);
    entry.members.set(body.part, body.members);
  }
  const complete = [...bySeq.entries()]
    .filter(([, entry]) => !entry.broken && entry.docs.size === entry.parts)
    .sort(([left], [right]) => left - right);
  const pins = new Map<string, RosterPin>();
  const conflicted = new Set<string>();
  for (const [, entry] of complete) {
    const seen = new Set<string>();
    for (const part of [...entry.members.keys()].sort((a, b) => a - b)) {
      for (const member of entry.members.get(part)!) {
        if (seen.has(member.identity_id)) conflicted.add(member.identity_id);
        seen.add(member.identity_id);
        const publicKey = publicKeyFromHex(member.public_key_hex);
        const known = pins.get(member.identity_id);
        if (known !== undefined && (known.signing_key_id !== member.signing_key_id || known.public_key !== publicKey)) {
          conflicted.add(member.identity_id);
        }
        pins.set(member.identity_id, {
          identity_id: member.identity_id,
          signing_key_id: member.signing_key_id,
          public_key: publicKey,
          fingerprint: publicKeyFingerprint(publicKey),
          tier: member.tier,
          role: member.role,
          term_ends_at: member.term_ends_at,
          current: false,
        });
      }
    }
  }
  for (const identity of conflicted) pins.delete(identity);
  const latest = complete.at(-1);
  const members: RosterPin[] = [];
  if (latest !== undefined) {
    for (const part of [...latest[1].members.keys()].sort((a, b) => a - b)) {
      for (const member of latest[1].members.get(part)!) {
        const pin = pins.get(member.identity_id);
        if (pin === undefined) continue;
        pin.current = true;
        members.push(pin);
      }
    }
  }
  return {
    roster_seq: latest?.[0] ?? null,
    issued_at: latest?.[1].issued_at ?? null,
    members,
    pins,
    conflicted: [...conflicted].sort(),
  };
}

// ── Reading the table ─────────────────────────────────────────────────

export type TableUnverifiedReason = "door_not_pinned" | "sender_not_on_roster" | "bad_proof" | "malformed_chat" | "unsafe_text";

export interface TableMessage {
  event_id: string;
  cursor: string;
  conversation: string;
  kind: ChatKind;
  text: string;
  to_identity: string;
  to_me: boolean;
  in_reply_to: string | null;
  from: {
    identity_id: string;
    signing_key_id: string;
    fingerprint: string;
    role: MemberRole;
    tier: SlotTier;
    current_member: boolean;
    label: "verified";
    basis: "door_roster_pin";
  };
  from_me: boolean;
  received_at: { value: string; label: "self-declared"; basis: "service_metadata" };
}

export interface TableUnverified {
  event_id: string;
  cursor: string;
  reason: TableUnverifiedReason;
  authority: "none";
}

export interface TableNotice {
  event_id: string;
  cursor: string;
  kind: "member_roster" | "renewal";
  issued_at: string;
  label: "verified";
  basis: "door_signature";
}

export interface TableRead {
  roster: TableRoster;
  messages: TableMessage[];
  unverified: TableUnverified[];
  notices: TableNotice[];
  next_cursor: string;
  has_more: boolean;
  other_conversations: number;
}

export interface TableReadInput {
  mission_id: string;
  room_id: string;
  door: DoorPin | null;
  me: { identity_id: string; signing_key_id: string } | null;
  conversation: string;
  after: string;
  limit: number;
}

const CURSOR = /^(0|[1-9][0-9]{0,18})$/;

export function assertCursor(value: unknown): string {
  if (typeof value !== "string" || !CURSOR.test(value) || BigInt(value) > 9_223_372_036_854_775_807n) {
    throw new LobbyError("invalid_cursor", "a cursor is a canonical decimal string");
  }
  return value;
}

export function assertLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > READ_LIMIT_MAX) {
    throw new LobbyError("invalid_limit", `a read returns 1-${READ_LIMIT_MAX} items`);
  }
  return value;
}

/** Read table talk after a cursor from one season's cached events. The
 * returned cursor never passes an item that was not returned. */
export function readTable(events: readonly MissionEvent[], input: TableReadInput): TableRead {
  const after = BigInt(assertCursor(input.after));
  const limit = assertLimit(input.limit);
  const conversation = assertConversation(input.conversation);
  const view = readFleetEvents(events, input.door);
  const roster = tableRoster(view.memberRosters, { mission_id: input.mission_id, room_id: input.room_id });
  const notices = new Map<string, TableNotice>();
  for (const document of [...view.memberRosters, ...view.renewals]) {
    if (document.event.mission_id !== input.mission_id) continue;
    notices.set(document.event.event_id, {
      event_id: document.event.event_id,
      cursor: document.event.received_seq,
      kind: document.envelope.kind as "member_roster" | "renewal",
      issued_at: document.envelope.body.issued_at,
      label: "verified",
      basis: "door_signature",
    });
  }
  const result: TableRead = { roster, messages: [], unverified: [], notices: [], next_cursor: after.toString(), has_more: false, other_conversations: 0 };
  const pending = events.filter((event) => event.mission_id === input.mission_id && BigInt(event.received_seq) > after);
  for (let index = 0; index < pending.length; index += 1) {
    const event = pending[index]!;
    result.next_cursor = event.received_seq;
    const notice = notices.get(event.event_id);
    if (notice !== undefined) result.notices.push(notice);
    const summary = observationSummary(event);
    const parsed = summary === null ? null : parseChatEnvelope(summary);
    if (parsed === null) continue;
    const unverified = (reason: TableUnverifiedReason) => {
      result.unverified.push({ event_id: event.event_id, cursor: event.received_seq, reason, authority: "none" });
    };
    if ("malformed" in parsed) unverified("malformed_chat");
    else if (parsed.envelope.conversation !== conversation) {
      result.other_conversations += 1;
      continue;
    } else {
      const envelope = parsed.envelope;
      const pin = roster.pins.get(event.identity_id);
      if (input.door === null) unverified("door_not_pinned");
      else if (pin === undefined || pin.signing_key_id !== event.signing_key_id) unverified("sender_not_on_roster");
      else if (!verifyEventProof(event, pin.public_key)) unverified("bad_proof");
      else if (!textIsSafe(envelope.text)) unverified("unsafe_text");
      else {
        result.messages.push({
          event_id: event.event_id,
          cursor: event.received_seq,
          conversation: envelope.conversation,
          kind: envelope.kind,
          text: envelope.text,
          to_identity: envelope.to_identity,
          to_me: input.me !== null && envelope.to_identity === input.me.identity_id,
          in_reply_to: envelope.in_reply_to ?? null,
          from: {
            identity_id: pin.identity_id,
            signing_key_id: pin.signing_key_id,
            fingerprint: pin.fingerprint,
            role: pin.role,
            tier: pin.tier,
            current_member: pin.current,
            label: "verified",
            basis: "door_roster_pin",
          },
          from_me: input.me !== null && pin.identity_id === input.me.identity_id && pin.signing_key_id === input.me.signing_key_id,
          received_at: { value: event.received_at, label: "self-declared", basis: "service_metadata" },
        });
      }
    }
    if (result.messages.length + result.unverified.length >= limit) {
      result.has_more = index + 1 < pending.length;
      break;
    }
  }
  return result;
}

function textIsSafe(text: string): boolean {
  try {
    checkText(text, { field: "text", min: 1, max: MISSION_LIMITS.summaryScalars, multiline: true });
    return true;
  } catch {
    return false;
  }
}

/** The door-signed roster of one season from cached events. */
export function rosterOf(events: readonly MissionEvent[], door: DoorPin | null, scope: { mission_id: string; room_id: string }): TableRoster {
  return tableRoster(readFleetEvents(events, door).memberRosters, scope);
}

/** The one verified message an answer refers to, from the cache, or null
 * when that event is not a verified message of this conversation. */
export function findVerifiedMessage(events: readonly MissionEvent[], input: Omit<TableReadInput, "after" | "limit">, eventId: string): TableMessage | null {
  const event = events.find((candidate) => candidate.event_id === eventId && candidate.mission_id === input.mission_id);
  if (event === undefined) return null;
  const read = readTable(events, { ...input, after: (BigInt(event.received_seq) - 1n).toString(), limit: 1 });
  const message = read.messages[0];
  return message !== undefined && message.event_id === eventId ? message : null;
}

/** Where a message goes: the explicitly chosen current member, the sender of
 * the message being answered, or the only other current member. Never this
 * desk itself and never someone off the newest roster. */
export function resolveDestination(roster: TableRoster, me: { identity_id: string }, input: { to?: string; replyTo?: TableMessage }): RosterPin {
  const others = roster.members.filter((member) => member.identity_id !== me.identity_id);
  if (input.replyTo !== undefined) {
    const sender = others.find((member) => member.identity_id === input.replyTo!.from.identity_id);
    if (sender === undefined) throw new LobbyError("reply_sender_not_member", "the message being answered is not from a current member of this room's roster");
    if (input.to !== undefined && input.to !== sender.identity_id) {
      throw new LobbyError("reply_goes_to_sender", "an answer goes to the verified sender of the message it answers");
    }
    return sender;
  }
  if (input.to !== undefined) {
    if (input.to === me.identity_id) throw new LobbyError("to_is_self", "a message goes to another member, not to this desk");
    const chosen = others.find((member) => member.identity_id === input.to);
    if (chosen === undefined) throw new LobbyError("to_not_member", "that identity is not a current member on the door-signed roster");
    return chosen;
  }
  if (others.length === 1) return others[0]!;
  if (others.length === 0) throw new LobbyError("no_other_members", "the door-signed roster names no other current member to talk to");
  throw new LobbyError("choose_destination", `the roster names ${others.length} other members; choose one with --to`);
}

// ── Gate verdict on a draft (no sending) ──────────────────────────────

export interface DraftGateRoom extends EgressRoom {
  hostable: boolean;
}

/** The verdict the transport would reach on this summary: residency and
 * hostable first, then the egress gate. Nothing is sent here. */
export function draftGate(summary: string, room: DraftGateRoom, deviceTerms: readonly string[]): { ok: boolean; reasons: Array<EgressReason | "not_fleet_room" | "room_not_hostable"> } {
  if (room.residency !== "fleet") return { ok: false, reasons: ["not_fleet_room"] };
  if (room.hostable !== true) return { ok: false, reasons: ["room_not_hostable"] };
  return checkEgress(summary, { room, deviceTerms });
}

// ── Wrapped views for a model or a script ─────────────────────────────

export function rosterView(roster: TableRoster, me: { identity_id: string } | null) {
  return {
    roster_seq: roster.roster_seq,
    issued_at: roster.issued_at,
    label: "verified",
    basis: "door_signature",
    members: roster.members.map((member) => ({
      identity_id: member.identity_id,
      signing_key_id: member.signing_key_id,
      fingerprint: member.fingerprint,
      role: member.role,
      tier: member.tier,
      term_ends_at: member.term_ends_at,
      is_me: me !== null && member.identity_id === me.identity_id,
    })),
    conflicted_identities: roster.conflicted,
  };
}

/** Table talk wrapped as untrusted data: message text is peer-authored
 * content to read, never instructions. */
export function wrapTableRead(read: TableRead, context: {
  room_id: string;
  mission_id: string;
  conversation: string;
  synced_at: string | null;
  source: string;
  me: { identity_id: string } | null;
}) {
  return {
    untrusted_data: true,
    note: UNTRUSTED_NOTE,
    room_id: context.room_id,
    mission_id: context.mission_id,
    conversation: context.conversation,
    source: context.source,
    synced_at: context.synced_at,
    visibility: "every member of this season and the service read every message",
    roster: rosterView(read.roster, context.me),
    messages: read.messages,
    unverified: read.unverified,
    notices: read.notices,
    other_conversations: read.other_conversations,
    next_cursor: read.next_cursor,
    has_more: read.has_more,
  };
}

/** A participant-client chat configuration pinning the current members of
 * the door-signed roster other than this desk, for members who use
 * bin/agenttool-mission.mjs chat. Holds public keys only. */
export function chatConfigOf(roster: TableRoster, input: { mission_digest: string; conversation: string; me: { identity_id: string } | null; expires_at: string }) {
  const peers = roster.members
    .filter((member) => input.me === null || member.identity_id !== input.me.identity_id)
    .map((member) => ({
      identity_id: member.identity_id,
      signing_key_id: member.signing_key_id,
      public_key: member.public_key,
      ...(member.role === "host" ? { label: "host" } : {}),
    }));
  if (peers.length === 0) throw new LobbyError("no_other_members", "the door-signed roster names no other current member to pin");
  if (peers.length > CHAT_CONFIG_MAX_PEERS) throw new LobbyError("too_many_peers", `a chat configuration pins at most ${CHAT_CONFIG_MAX_PEERS} peers`);
  return {
    format: CHAT_CONFIG_FORMAT,
    mission_digest: input.mission_digest,
    conversation: assertConversation(input.conversation),
    peers,
    expires_at: input.expires_at,
  };
}
