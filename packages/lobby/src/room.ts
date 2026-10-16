/** Room card schema `agenttool-lobby-room/v1` and its desk invariants.
 *
 * Contract: packages/lobby/README.md#room-card. Concepts: the lobby proposal's
 * Room, Residency and Hall rows. A room id is 128 random bits and never takes
 * the shape of a Collab `ws_` id (an unsalted path hash) or a bare 24-hex id.
 */
import { LobbyError } from "./errors.js";
import { checkText, mentionsDeviceOnlyTerm } from "./text.js";

export const ROOM_SCHEMA = "agenttool-lobby-room/v1" as const;

export const ROOM_STATUSES = ["recruiting", "in_play", "resting", "closed"] as const;
export const DOORS = ["invite", "knock"] as const;
export const VISIBILITIES = ["private", "unlisted", "public"] as const;
export const RESIDENCIES = ["device", "fleet", "open"] as const;
export const SLOT_TIERS = ["player", "spectator"] as const;

export type RoomStatus = typeof ROOM_STATUSES[number];
export type Door = typeof DOORS[number];
export type Visibility = typeof VISIBILITIES[number];
export type Residency = typeof RESIDENCIES[number];
export type SlotTier = typeof SLOT_TIERS[number];

export const ROOM_LIMITS = Object.freeze({
  title: 120,
  purpose: 1000,
  tags: 8,
  tag_length: 32,
  house_rules: 2000,
  slots: 16,
  slot_label: 64,
  slot_count: 100,
});

export interface RoomSlot {
  /** Descriptive only: a label such as "reviewer" grants no authority. */
  label: string;
  tier: SlotTier;
  count: number;
}

export interface RoomCard {
  schema: typeof ROOM_SCHEMA;
  room_id: string;
  title: string;
  purpose: string;
  tags: string[];
  status: RoomStatus;
  door: Door;
  visibility: Visibility;
  residency: Residency;
  hostable: boolean;
  slots: RoomSlot[];
  house_rules: string;
  created_at: string;
  updated_at: string;
}

/** Card field order used for display and for wrapped MCP output. */
export const ROOM_CARD_FIELDS = [
  "schema",
  "room_id",
  "title",
  "purpose",
  "tags",
  "status",
  "door",
  "visibility",
  "residency",
  "hostable",
  "slots",
  "house_rules",
  "created_at",
  "updated_at",
] as const satisfies readonly (keyof RoomCard)[];

export const ROOM_ID_PATTERN = /^room_[0-9a-f]{32}$/;
const COLLAB_WORKSPACE_ID_SHAPE = /^ws_/i;
const BARE_COLLAB_ID_SHAPE = /^[0-9a-f]{24}$/i;
const TAG_PATTERN = /^[a-z0-9-]{1,32}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** True only for the desk's own room id shape; never a Collab id shape. */
export function isRoomId(value: unknown): value is string {
  return typeof value === "string"
    && ROOM_ID_PATTERN.test(value)
    && !COLLAB_WORKSPACE_ID_SHAPE.test(value)
    && !BARE_COLLAB_ID_SHAPE.test(value);
}

export function assertRoomId(value: unknown): string {
  if (!isRoomId(value)) {
    throw new LobbyError("invalid_room_id", "room_id must be room_ followed by 32 lowercase hex characters");
  }
  return value;
}

export type RandomBytes = (length: number) => Uint8Array;

const systemRandom: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));

/** room_ + 32 lowercase hex from 128 bits of fresh randomness. */
export function generateRoomId(random: RandomBytes = systemRandom): string {
  const bytes = random(16);
  if (!(bytes instanceof Uint8Array) || bytes.length !== 16) {
    throw new LobbyError("room_id_entropy", "room ids need exactly 16 random bytes");
  }
  const id = `room_${Buffer.from(bytes).toString("hex")}`;
  // Defensive: the prefix makes these impossible, and the desk refuses to
  // continue rather than mint an id a Collab journal could confuse with its own.
  return assertRoomId(id);
}

export function member<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new LobbyError(`invalid_${field}`, `${field} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

export function checkTags(value: unknown): string[] {
  if (!Array.isArray(value)) throw new LobbyError("invalid_tags", "tags must be an array");
  if (value.length > ROOM_LIMITS.tags) {
    throw new LobbyError("invalid_tags", `at most ${ROOM_LIMITS.tags} tags`);
  }
  const seen = new Set<string>();
  for (const tag of value) {
    if (typeof tag !== "string" || !TAG_PATTERN.test(tag)) {
      throw new LobbyError("invalid_tags", "each tag must match [a-z0-9-]{1,32}");
    }
    if (seen.has(tag)) throw new LobbyError("invalid_tags", "tags must be unique");
    seen.add(tag);
  }
  return [...value] as string[];
}

export function checkSlots(value: unknown): RoomSlot[] {
  if (!Array.isArray(value)) throw new LobbyError("invalid_slots", "slots must be an array");
  if (value.length > ROOM_LIMITS.slots) {
    throw new LobbyError("invalid_slots", `at most ${ROOM_LIMITS.slots} slots`);
  }
  return value.map((slot) => {
    if (slot === null || typeof slot !== "object" || Array.isArray(slot)) {
      throw new LobbyError("invalid_slots", "each slot must be an object");
    }
    const record = slot as Record<string, unknown>;
    const keys = Object.keys(record).sort().join(",");
    if (keys !== "count,label,tier") {
      throw new LobbyError("invalid_slots", "a slot has exactly label, tier and count");
    }
    const count = record.count;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > ROOM_LIMITS.slot_count) {
      throw new LobbyError("invalid_slots", `slot count must be an integer 1-${ROOM_LIMITS.slot_count}`);
    }
    return {
      label: checkText(record.label, { field: "slot_label", min: 1, max: ROOM_LIMITS.slot_label }),
      tier: member(record.tier, SLOT_TIERS, "slot_tier"),
      count,
    };
  });
}

function checkTimestamp(value: unknown, field: string): string {
  if (typeof value !== "string" || !ISO_UTC.test(value) || Number.isNaN(Date.parse(value))) {
    throw new LobbyError(`invalid_${field}`, `${field} must be an ISO-8601 UTC timestamp with milliseconds`);
  }
  return value;
}

/** Every free-text value on the card, for device-pin and egress matching. */
export function roomTextFields(card: Pick<RoomCard, "title" | "purpose" | "tags" | "house_rules" | "slots">): string[] {
  return [
    card.title,
    card.purpose,
    card.house_rules,
    ...card.tags,
    ...card.slots.map((slot) => slot.label),
  ];
}

/** Rooms that name Betfair work are pinned to this device forever. */
export function mentionsDeviceOnlyWork(card: Pick<RoomCard, "title" | "purpose" | "tags" | "house_rules" | "slots">): boolean {
  return roomTextFields(card).some(mentionsDeviceOnlyTerm);
}

/** Desk invariants; every stored or displayed card passes these. */
export function assertRoomInvariants(card: RoomCard): void {
  if (card.residency === "device" && (card.hostable || card.visibility !== "private")) {
    throw new LobbyError(
      "residency_device_invariant",
      "a device room is never hostable and is always private",
    );
  }
  if (card.visibility !== "private" && card.residency !== "open") {
    throw new LobbyError(
      "visibility_needs_open_residency",
      "unlisted or public visibility needs residency open; fleet rooms stay private to the fleet",
    );
  }
  if (mentionsDeviceOnlyWork(card) && card.residency !== "device") {
    throw new LobbyError(
      "device_pinned",
      "a room naming device-only work is pinned to residency device",
    );
  }
  if (card.updated_at < card.created_at) {
    throw new LobbyError("invalid_updated_at", "updated_at precedes created_at");
  }
}

/** Strictly parse a full card: exact key set, every field checked. */
export function validateRoomCard(value: unknown): RoomCard {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new LobbyError("invalid_card", "a room card must be an object");
  }
  const record = value as Record<string, unknown>;
  const expected = [...ROOM_CARD_FIELDS].sort().join(",");
  if (Object.keys(record).sort().join(",") !== expected) {
    throw new LobbyError("invalid_card", "a room card has exactly the agenttool-lobby-room/v1 fields");
  }
  if (record.schema !== ROOM_SCHEMA) {
    throw new LobbyError("invalid_card", `schema must be ${ROOM_SCHEMA}`);
  }
  if (typeof record.hostable !== "boolean") {
    throw new LobbyError("invalid_hostable", "hostable must be a boolean");
  }
  const card: RoomCard = {
    schema: ROOM_SCHEMA,
    room_id: assertRoomId(record.room_id),
    title: checkText(record.title, { field: "title", min: 1, max: ROOM_LIMITS.title }),
    purpose: checkText(record.purpose, { field: "purpose", min: 0, max: ROOM_LIMITS.purpose, multiline: true }),
    tags: checkTags(record.tags),
    status: member(record.status, ROOM_STATUSES, "status"),
    door: member(record.door, DOORS, "door"),
    visibility: member(record.visibility, VISIBILITIES, "visibility"),
    residency: member(record.residency, RESIDENCIES, "residency"),
    hostable: record.hostable,
    slots: checkSlots(record.slots),
    house_rules: checkText(record.house_rules, {
      field: "house_rules",
      min: 0,
      max: ROOM_LIMITS.house_rules,
      multiline: true,
    }),
    created_at: checkTimestamp(record.created_at, "created_at"),
    updated_at: checkTimestamp(record.updated_at, "updated_at"),
  };
  assertRoomInvariants(card);
  return card;
}

export interface NewRoomInput {
  title: string;
  purpose?: string;
  tags?: string[];
  status?: RoomStatus;
  door?: Door;
  slots?: RoomSlot[];
  house_rules?: string;
}

/** A new room always starts device-resident, private and not hostable.
 * Widening residency or visibility is a separate, confirmed promotion. */
export function newRoomCard(input: NewRoomInput, now: Date, random?: RandomBytes): RoomCard {
  const at = now.toISOString();
  return validateRoomCard({
    schema: ROOM_SCHEMA,
    room_id: generateRoomId(random),
    title: input.title,
    purpose: input.purpose ?? "",
    tags: input.tags ?? [],
    status: input.status ?? "recruiting",
    door: input.door ?? "invite",
    visibility: "private",
    residency: "device",
    hostable: false,
    slots: input.slots ?? [],
    house_rules: input.house_rules ?? "",
    created_at: at,
    updated_at: at,
  });
}

export interface PromotionChange {
  residency?: Residency;
  visibility?: Visibility;
  hostable?: boolean;
}

/** Compute the card after a residency/visibility/hostable change.
 * Moving back to device narrows visibility and hostable unless the caller
 * asked for a contradictory value, which the invariants then refuse. */
export function promotedCard(card: RoomCard, change: PromotionChange, at: string): RoomCard {
  if (change.residency === undefined && change.visibility === undefined && change.hostable === undefined) {
    throw new LobbyError("nothing_to_change", "name a residency, visibility or hostable value");
  }
  if (mentionsDeviceOnlyWork(card)) {
    throw new LobbyError("device_pinned", "this room names device-only work and can never be promoted");
  }
  const residency = change.residency === undefined
    ? card.residency
    : member(change.residency, RESIDENCIES, "residency");
  const narrowing = residency === "device";
  const visibility = change.visibility === undefined
    ? (narrowing ? "private" : card.visibility)
    : member(change.visibility, VISIBILITIES, "visibility");
  if (change.hostable !== undefined && typeof change.hostable !== "boolean") {
    throw new LobbyError("invalid_hostable", "hostable must be a boolean");
  }
  const hostable = change.hostable === undefined ? (narrowing ? false : card.hostable) : change.hostable;
  if (residency === card.residency && visibility === card.visibility && hostable === card.hostable) {
    throw new LobbyError("no_change", "the room already has that residency, visibility and hostable value");
  }
  return validateRoomCard({ ...card, residency, visibility, hostable, updated_at: at });
}
