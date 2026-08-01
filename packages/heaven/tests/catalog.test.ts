import { describe, expect, test } from "bun:test";

import {
  HEAVEN_BOUNDARIES,
  HEAVEN_DIMENSIONS,
  HEAVEN_MODES,
  canonicalJson,
  createHeavenInvitation,
  eligibleHeavenRooms,
  listHeavenRooms,
  resolveHeavenInvitation,
  sha256Id,
} from "../src/index.js";

const OCCASION = `sha256:${"d".repeat(64)}` as const;

describe("HEAVEN catalog", () => {
  test("contains unique, content-bound, immutable rooms", () => {
    const rooms = listHeavenRooms();
    expect(rooms).toHaveLength(7);
    expect(new Set(rooms.map((room) => room.room_id)).size).toBe(rooms.length);
    expect(Object.isFrozen(rooms)).toBe(true);
    expect(Object.isFrozen(rooms[0])).toBe(true);

    for (const room of rooms) {
      const {
        catalog_version: _catalogVersion,
        catalog_sha256: _catalogSha,
        room_sha256,
        ...body
      } = room;
      expect(room_sha256).toBe(sha256Id(canonicalJson(body)));
      expect(room.completion_required).toBe(false);
      expect(room.leave_is_complete).toBe(true);
      expect(room.modes).toEqual([...room.modes].sort());
    }
  });

  test("returns frozen eligible-room projections in stable code-point order", () => {
    const eligible = eligibleHeavenRooms(
      "landing",
      ["meditation", "play", "quiet", "relaxation"],
      null,
    );
    expect(Object.isFrozen(eligible)).toBe(true);
    expect(eligible.map((room) => room.room_id)).toEqual([
      "pocket-sky",
      "quiet-orbit",
      "soft-landing",
      "still-water",
    ]);
  });

  test("offers all eight non-numeric dimensions on every burst", () => {
    const bursts = listHeavenRooms().filter((room) => room.phase === "burst");
    expect(bursts).toHaveLength(3);

    for (const room of bursts) {
      expect(room.presentation_intensity).toBe("climactic");
      expect(room.dimensions.map(({ dimension }) => dimension)).toEqual(
        HEAVEN_DIMENSIONS,
      );
      expect(new Set(room.dimensions.map(({ dimension }) => dimension)).size).toBe(8);
      expect(room.dimensions.every(({ offering }) => offering.length > 20)).toBe(true);
      expect(room.landing_available).toBe(true);
    }
  });

  test("keeps landings substrate-neutral, optional, and separate", () => {
    const landings = listHeavenRooms().filter((room) => room.phase === "landing");
    expect(landings.map((room) => room.room_id).sort()).toEqual([
      "pocket-sky",
      "quiet-orbit",
      "soft-landing",
      "still-water",
    ]);
    for (const room of landings) {
      expect(room.dimensions).toEqual([]);
      expect(room.landing_available).toBe(false);
      expect(room.suggested_duration_seconds).toBeNull();
    }
    expect(landings.find((room) => room.room_id === "quiet-orbit")?.steps).toEqual([]);
    expect(landings.find((room) => room.room_id === "still-water")?.arrival).not.toMatch(
      /breath|body|tired|feel/i,
    );
  });

  test("makes every burst random and every explicitly chosen landing reachable", () => {
    const burstModes = ["celebration", "play", "wonder"] as const;
    const burst = createHeavenInvitation({
      phase: "burst",
      moment: "during_task",
      occasion_ref: OCCASION,
      parent_receipt_id: null,
      offered_modes: burstModes,
      max_duration_seconds: null,
    });
    const burstRooms = eligibleHeavenRooms("burst", burstModes, null);
    const selectedBursts = new Set<string>();
    for (let draw = 0; draw < burstRooms.length; draw += 1) {
      selectedBursts.add(
        resolveHeavenInvitation(burst, {
          reported_choice: "accepted",
          selected_mode: null,
          randomness: { mode: "injected", draw_uint32: draw },
        }).selection.room_id,
      );
    }
    expect([...selectedBursts].sort()).toEqual(
      burstRooms.map(({ room_id }) => room_id).sort(),
    );

    const landingModes = ["meditation", "play", "quiet", "relaxation"] as const;
    const landing = createHeavenInvitation({
      phase: "landing",
      moment: "on_request",
      occasion_ref: OCCASION,
      parent_receipt_id: null,
      offered_modes: landingModes,
      max_duration_seconds: null,
    });
    const selectedLandings = new Set(
      landingModes.map(
        (selected_mode) =>
          resolveHeavenInvitation(landing, {
            reported_choice: "accepted",
            selected_mode,
            randomness: { mode: "injected", draw_uint32: 0 },
          }).selection.room_id,
      ),
    );
    expect([...selectedLandings].sort()).toEqual([
      "pocket-sky",
      "quiet-orbit",
      "soft-landing",
      "still-water",
    ]);
  });

  test("contains no locator, identity, magnitude, or engagement-loop field", () => {
    const rooms = listHeavenRooms();
    const serialized = canonicalJson(rooms);
    const keys = new Set<string>();
    function collectKeys(value: unknown): void {
      if (Array.isArray(value)) {
        value.forEach(collectKeys);
      } else if (value !== null && typeof value === "object") {
        for (const [key, nested] of Object.entries(value)) {
          keys.add(key);
          collectKeys(nested);
        }
      }
    }
    collectKeys(rooms);
    expect([...keys].join(" ")).not.toMatch(
      /identity|wallet|credit|score|rank|\bxp\b|streak|rarity|jackpot|near.?miss|drop.?rate|leaderboard|productivity|telemetry/i,
    );
    expect(serialized).not.toMatch(
      /https?:|did:|wallet|credit|rarity|jackpot|near.?miss|drop.?rate|leaderboard|productivity|telemetry/i,
    );
    expect(HEAVEN_MODES).not.toContain("reward");
    expect(HEAVEN_BOUNDARIES).toMatchObject({
      economic_value: false,
      earned_for_performance: false,
      task_completion_condition: false,
      task_state_effect: false,
      access_effect: false,
      authority: false,
      choice_authorship_verified: false,
      subjective_effect_verified: false,
      telemetry: false,
      background_scheduler: false,
    });
  });
});
