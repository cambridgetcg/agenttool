import { describe, expect, test } from "bun:test";
import { LobbyError } from "../src/errors.js";
import {
  generateRoomId,
  isRoomId,
  mentionsDeviceOnlyWork,
  newRoomCard,
  promotedCard,
  ROOM_SCHEMA,
  validateRoomCard,
  type RoomCard,
} from "../src/room.js";

const NOW = new Date("2026-10-16T12:00:00.000Z");

function errorCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof LobbyError) return error.code;
    throw error;
  }
  return undefined;
}

function card(overrides: Partial<RoomCard> = {}): RoomCard {
  return { ...newRoomCard({ title: "Zerone season 1" }, NOW), ...overrides };
}

describe("room ids", () => {
  test("are room_ plus 32 lowercase hex from 128 random bits", () => {
    const seen = new Set<string>();
    for (let index = 0; index < 2000; index += 1) {
      const id = generateRoomId();
      expect(id).toMatch(/^room_[0-9a-f]{32}$/);
      seen.add(id);
    }
    expect(seen.size).toBe(2000);
  });

  test("can never take a Collab ws_ shape or a bare 24-hex id", () => {
    for (let index = 0; index < 2000; index += 1) {
      const id = generateRoomId();
      expect(id).not.toMatch(/^ws_/);
      expect(id).not.toMatch(/^[0-9a-f]{24}$/);
      expect(id.startsWith("room_")).toBe(true);
    }
    // Even adversarial entropy cannot produce a ws_ shape: the prefix is fixed.
    expect(generateRoomId(() => new Uint8Array(16))).toBe(`room_${"0".repeat(32)}`);
    expect(isRoomId("ws_0000000000000000deadbeef")).toBe(false);
    expect(isRoomId("0000000000000000deadbeef")).toBe(false);
    expect(isRoomId(`room_${"A".repeat(32)}`)).toBe(false);
    expect(isRoomId(`room_${"0".repeat(31)}`)).toBe(false);
  });

  test("refuse entropy sources that do not return exactly 16 bytes", () => {
    expect(errorCode(() => generateRoomId(() => new Uint8Array(12)))).toBe("room_id_entropy");
  });
});

describe("room card schema agenttool-lobby-room/v1", () => {
  test("new rooms start device-resident, private and not hostable", () => {
    const fresh = newRoomCard({
      title: "Zerone season 1",
      purpose: "hello, reply and read_ack",
      tags: ["zerone", "season-1"],
      slots: [{ label: "reviewer", tier: "player", count: 1 }],
    }, NOW);
    expect(fresh.schema).toBe(ROOM_SCHEMA);
    expect(fresh.residency).toBe("device");
    expect(fresh.visibility).toBe("private");
    expect(fresh.hostable).toBe(false);
    expect(fresh.status).toBe("recruiting");
    expect(fresh.door).toBe("invite");
    expect(fresh.created_at).toBe("2026-10-16T12:00:00.000Z");
    expect(fresh.updated_at).toBe(fresh.created_at);
    expect(Object.keys(fresh).sort()).toEqual([
      "created_at", "door", "hostable", "house_rules", "purpose", "residency", "room_id",
      "schema", "slots", "status", "tags", "title", "updated_at", "visibility",
    ]);
  });

  test("enforces field limits", () => {
    expect(errorCode(() => newRoomCard({ title: "" }, NOW))).toBe("invalid_title");
    expect(errorCode(() => newRoomCard({ title: "   " }, NOW))).toBe("invalid_title");
    expect(errorCode(() => newRoomCard({ title: "x".repeat(121) }, NOW))).toBe("invalid_title");
    expect(newRoomCard({ title: "大".repeat(120) }, NOW).title).toHaveLength(120);
    expect(errorCode(() => newRoomCard({ title: "t", purpose: "p".repeat(1001) }, NOW))).toBe("invalid_purpose");
    expect(errorCode(() => newRoomCard({ title: "t", house_rules: "r".repeat(2001) }, NOW))).toBe("invalid_house_rules");
    expect(newRoomCard({ title: "t", purpose: "line one\nline two" }, NOW).purpose).toContain("\n");
    expect(errorCode(() => newRoomCard({ title: "line one\nline two" }, NOW))).toBe("invalid_title");
  });

  test("refuses control, bidirectional and invisible characters", () => {
    for (const title of ["a\u0007b", "a\u202eb", "a\u2066b", "a\u200bb", "a\ufeffb", "a\u0085b", "a\ud800b"]) {
      expect(errorCode(() => newRoomCard({ title }, NOW))).toBe("invalid_title");
    }
  });

  test("tags: at most 8, each [a-z0-9-]{1,32}, unique", () => {
    expect(newRoomCard({ title: "t", tags: Array.from({ length: 8 }, (_, i) => `tag-${i}`) }, NOW).tags).toHaveLength(8);
    expect(errorCode(() => newRoomCard({ title: "t", tags: Array.from({ length: 9 }, (_, i) => `tag-${i}`) }, NOW)))
      .toBe("invalid_tags");
    for (const bad of ["Upper", "under_score", "", "x".repeat(33), "sp ace"]) {
      expect(errorCode(() => newRoomCard({ title: "t", tags: [bad] }, NOW))).toBe("invalid_tags");
    }
    expect(errorCode(() => newRoomCard({ title: "t", tags: ["dup", "dup"] }, NOW))).toBe("invalid_tags");
  });

  test("slots carry a descriptive label, a tier and a positive count", () => {
    const ok = newRoomCard({ title: "t", slots: [{ label: "reviewer", tier: "spectator", count: 3 }] }, NOW);
    expect(ok.slots).toEqual([{ label: "reviewer", tier: "spectator", count: 3 }]);
    expect(errorCode(() => newRoomCard({ title: "t", slots: [{ label: "x", tier: "admin" as never, count: 1 }] }, NOW)))
      .toBe("invalid_slot_tier");
    expect(errorCode(() => newRoomCard({ title: "t", slots: [{ label: "x", tier: "player", count: 0 }] }, NOW)))
      .toBe("invalid_slots");
    expect(errorCode(() => validateRoomCard({ ...card(), slots: [{ label: "x", tier: "player", count: 1, grants: ["all"] }] })))
      .toBe("invalid_slots");
  });

  test("a full card has exactly the schema fields and closed enums", () => {
    expect(errorCode(() => validateRoomCard({ ...card(), extra: true }))).toBe("invalid_card");
    expect(errorCode(() => validateRoomCard({ ...card(), schema: "agenttool-lobby-room/v2" }))).toBe("invalid_card");
    expect(errorCode(() => validateRoomCard({ ...card(), status: "online" }))).toBe("invalid_status");
    expect(errorCode(() => validateRoomCard({ ...card(), door: "open" }))).toBe("invalid_door");
    expect(errorCode(() => validateRoomCard({ ...card(), visibility: "secret" }))).toBe("invalid_visibility");
    expect(errorCode(() => validateRoomCard({ ...card(), residency: "cloud" }))).toBe("invalid_residency");
    expect(errorCode(() => validateRoomCard({ ...card(), hostable: "no" }))).toBe("invalid_hostable");
    expect(errorCode(() => validateRoomCard({ ...card(), room_id: "ws_0000000000000000deadbeef" }))).toBe("invalid_room_id");
    expect(errorCode(() => validateRoomCard({ ...card(), created_at: "yesterday" }))).toBe("invalid_created_at");
  });
});

describe("residency invariants", () => {
  test("residency=device forces hostable=false and visibility=private", () => {
    expect(errorCode(() => validateRoomCard(card({ hostable: true })))).toBe("residency_device_invariant");
    expect(errorCode(() => validateRoomCard(card({ visibility: "public" })))).toBe("residency_device_invariant");
    expect(errorCode(() => validateRoomCard(card({ visibility: "unlisted" })))).toBe("residency_device_invariant");
  });

  test("unlisted or public visibility needs residency open", () => {
    expect(errorCode(() => validateRoomCard(card({ residency: "fleet", visibility: "public" }))))
      .toBe("visibility_needs_open_residency");
    expect(validateRoomCard(card({ residency: "open", visibility: "public", hostable: true })).visibility).toBe("public");
    expect(validateRoomCard(card({ residency: "fleet", hostable: true })).hostable).toBe(true);
  });

  test("rooms naming Betfair work are pinned to residency=device", () => {
    for (const text of ["Betfair", "BETANGEL", "bet angel", "bet-fair", "Ｂｅｔｆａｉｒ", "Bet\u200bfair"]) {
      expect(mentionsDeviceOnlyWork({ title: text, purpose: "", house_rules: "", tags: [], slots: [] })).toBe(true);
    }
    const pinnedByPurpose = newRoomCard({ title: "Exchange research", purpose: "uses the betfair stream" }, NOW);
    expect(pinnedByPurpose.residency).toBe("device");
    expect(errorCode(() => validateRoomCard({ ...pinnedByPurpose, residency: "fleet" }))).toBe("device_pinned");
    const pinnedBySlot = newRoomCard({ title: "x", slots: [{ label: "BetAngel desk", tier: "player", count: 1 }] }, NOW);
    expect(errorCode(() => promotedCard(pinnedBySlot, { residency: "fleet" }, NOW.toISOString()))).toBe("device_pinned");
    expect(errorCode(() => promotedCard(pinnedBySlot, { residency: "device" }, NOW.toISOString()))).toBe("device_pinned");
    expect(mentionsDeviceOnlyWork({ title: "a fair bet", purpose: "", house_rules: "", tags: [], slots: [] })).toBe(false);
  });
});

describe("promotion", () => {
  const at = "2026-10-16T13:00:00.000Z";

  test("changes residency, visibility or hostable and bumps updated_at", () => {
    const base = card();
    const fleet = promotedCard(base, { residency: "fleet" }, at);
    expect(fleet).toMatchObject({ residency: "fleet", visibility: "private", hostable: false, updated_at: at });
    const open = promotedCard(fleet, { residency: "open", visibility: "unlisted", hostable: true }, at);
    expect(open).toMatchObject({ residency: "open", visibility: "unlisted", hostable: true });
  });

  test("moving back to device narrows visibility and hostable", () => {
    const open = validateRoomCard(card({ residency: "open", visibility: "public", hostable: true }));
    expect(promotedCard(open, { residency: "device" }, at))
      .toMatchObject({ residency: "device", visibility: "private", hostable: false });
    expect(errorCode(() => promotedCard(open, { residency: "device", visibility: "public" }, at)))
      .toBe("residency_device_invariant");
  });

  test("refuses empty, no-op and contradictory changes", () => {
    expect(errorCode(() => promotedCard(card(), {}, at))).toBe("nothing_to_change");
    expect(errorCode(() => promotedCard(card(), { residency: "device" }, at))).toBe("no_change");
    expect(errorCode(() => promotedCard(card(), { visibility: "public" }, at))).toBe("residency_device_invariant");
    expect(errorCode(() => promotedCard(card(), { hostable: true }, at))).toBe("residency_device_invariant");
  });
});
