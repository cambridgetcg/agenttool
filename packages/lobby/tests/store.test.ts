import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { canonicalJson, sha256Hex } from "../src/canonical.js";
import { LobbyError } from "../src/errors.js";
import { FLEET_SCHEMA_SQL } from "../src/fleet-store.js";
import { DATABASE_FILE, preparePrivateHome } from "../src/home.js";
import { fingerprintOf } from "../src/pins.js";
import { newRoomCard } from "../src/room.js";
import { LobbyStore, parseLedgerTarget, SCHEMA_SQL, SCHEMA_STEPS, STATE_SCHEMA_VERSION } from "../src/store.js";
import { cleanupTempHomes, fakePublicKey, tempHome } from "./helpers.js";

afterEach(cleanupTempHomes);

const T0 = new Date("2026-10-16T12:00:00.000Z");
const T1 = new Date("2026-10-16T12:05:00.000Z");
const T2 = new Date("2026-10-16T12:10:00.000Z");

function errorCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof LobbyError) return error.code;
    throw error;
  }
  return undefined;
}

function openStore() {
  const { home } = tempHome();
  return { home, store: LobbyStore.open(home) };
}

describe("local hall rooms", () => {
  test("lists with exact filters in a stable order and no ranking", () => {
    const { store } = openStore();
    const late = store.addRoom({ title: "late", tags: ["zerone"], door: "knock" }, T2);
    const early = store.addRoom({
      title: "early",
      tags: ["zerone", "review"],
      slots: [{ label: "watcher", tier: "spectator", count: 2 }],
    }, T0);
    const middle = store.addRoom({
      title: "middle",
      tags: ["review"],
      status: "resting",
      slots: [{ label: "reviewer", tier: "player", count: 1 }],
    }, T1);
    expect(store.listRooms().map((room) => room.title)).toEqual(["early", "middle", "late"]);
    expect(store.listRooms({ tag: "zerone" }).map((room) => room.room_id)).toEqual([early.room_id, late.room_id]);
    expect(store.listRooms({ tag: "zero" })).toEqual([]);
    expect(store.listRooms({ status: "resting" }).map((room) => room.room_id)).toEqual([middle.room_id]);
    expect(store.listRooms({ door: "knock" }).map((room) => room.room_id)).toEqual([late.room_id]);
    expect(store.listRooms({ tier: "player" }).map((room) => room.room_id)).toEqual([middle.room_id]);
    expect(store.listRooms({ tier: "spectator", tag: "review" }).map((room) => room.room_id)).toEqual([early.room_id]);
    expect(store.countRooms()).toBe(3);
    expect(store.getRoom(middle.room_id)).toEqual(middle);
    expect(errorCode(() => store.getRoom("ws_0000000000000000deadbeef"))).toBe("invalid_room_id");
    store.close();
  });

  test("set-status updates status and updated_at only", () => {
    const { store } = openStore();
    const room = store.addRoom({ title: "Zerone season 1" }, T0);
    const resting = store.setStatus(room.room_id, "resting", T1);
    expect(resting).toEqual({ ...room, status: "resting", updated_at: T1.toISOString() });
    expect(errorCode(() => store.setStatus(room.room_id, "online" as never, T1))).toBe("invalid_status");
    store.close();
  });

  test("Betfair rooms are pinned, and the pin is sticky in SQLite", () => {
    const { home, store } = openStore();
    const room = store.addRoom({ title: "Exchange research", purpose: "betangel automation notes" }, T0);
    expect(store.isDevicePinned(room.room_id)).toBe(true);
    expect(errorCode(() => store.planPromotion(room.room_id, { residency: "fleet" }, T1))).toBe("device_pinned");
    store.close();

    const raw = new Database(join(home, DATABASE_FILE));
    expect(() => raw.exec("UPDATE rooms SET device_pinned = 0")).toThrow(/device_pin_is_sticky/);
    expect(() => raw.exec("UPDATE rooms SET residency = 'fleet'")).toThrow(/CHECK constraint failed/);
    expect(() => raw.exec("DELETE FROM rooms")).toThrow(/rooms_close_rather_than_delete/);
    raw.close();
  });

  test("SQLite refuses residency invariant violations even outside the desk", () => {
    const { home, store } = openStore();
    store.addRoom({ title: "plain" }, T0);
    store.close();
    const raw = new Database(join(home, DATABASE_FILE));
    expect(() => raw.exec("UPDATE rooms SET hostable = 1")).toThrow(/CHECK constraint failed/);
    expect(() => raw.exec("UPDATE rooms SET visibility = 'public'")).toThrow(/CHECK constraint failed/);
    expect(() => raw.exec("UPDATE rooms SET residency = 'fleet', visibility = 'unlisted'")).toThrow(/CHECK constraint failed/);
    expect(() => raw.exec("INSERT INTO rooms (room_id, card, status, door, visibility, residency, hostable, device_pinned, created_at, updated_at) VALUES ('ws_0000000000000000deadbeef', '{}', 'recruiting', 'invite', 'private', 'device', 0, 0, 'x', 'x')"))
      .toThrow(/CHECK constraint failed/);
    raw.close();
  });
});

describe("private ledger", () => {
  test("accepts a ws_ id, an absolute path or none, and nothing else", () => {
    expect(parseLedgerTarget("none")).toEqual({ kind: "none", target: "none" });
    expect(parseLedgerTarget("ws_0000000000000000deadbeef")).toEqual({ kind: "workspace", target: "ws_0000000000000000deadbeef" });
    expect(parseLedgerTarget("/srv/example/./repo/../repo")).toEqual({ kind: "path", target: "/srv/example/repo" });
    for (const bad of ["", ".", "~", "~/repo", "relative/repo", "ws_short", "None", "/bad\u0000path", "/srv/a\u202eb",
      "/srv/a\u200bb"]) {
      expect(errorCode(() => parseLedgerTarget(bad))).toBe("invalid_ledger_target");
    }
  });

  test("links one room to one target and relinks in place", () => {
    const { store } = openStore();
    const room = store.addRoom({ title: "Zerone season 1" }, T0);
    expect(store.getLink(room.room_id)).toBeNull();
    store.link(room.room_id, "ws_0000000000000000deadbeef", T1);
    store.link(room.room_id, "none", T2);
    expect(store.getLink(room.room_id)).toEqual({
      room_id: room.room_id,
      target_kind: "none",
      target: "none",
      linked_at: T2.toISOString(),
    });
    expect(errorCode(() => store.link(`room_${"0".repeat(32)}`, "none", T2))).toBe("room_not_found");
    store.close();
  });
});

describe("consequential promotion", () => {
  test("the plan carries the exact bytes later recorded in the audit log", () => {
    const { store } = openStore();
    const room = store.addRoom({ title: "Zerone season 1" }, T0);
    const plan = store.planPromotion(room.room_id, { residency: "fleet" }, T1);
    expect(plan.sha256).toBe(sha256Hex(plan.bytes));
    expect(JSON.parse(plan.bytes)).toMatchObject({
      schema: "agenttool-lobby-act/v1",
      act: "room.promote",
      at: T1.toISOString(),
      room_id: room.room_id,
      before: { residency: "device", visibility: "private", hostable: false },
      after: { residency: "fleet", visibility: "private", hostable: false },
    });
    expect(store.listAudit()).toEqual([]);
    const after = store.applyPromotion(plan);
    expect(after.residency).toBe("fleet");
    expect(store.getRoom(room.room_id)).toEqual(after);
    const [entry] = store.listAudit();
    expect(entry).toMatchObject({
      seq: 1,
      act: "room.promote",
      subject: room.room_id,
      bytes: plan.bytes,
      bytes_sha256: plan.sha256,
      prev_hash: "0".repeat(64),
    });
    expect(store.verifyAudit()).toEqual({ ok: true, entries: 1, first_bad_seq: null });
    store.close();
  });

  test("refuses a plan whose room changed after the preview", () => {
    const { store } = openStore();
    const room = store.addRoom({ title: "Zerone season 1" }, T0);
    const plan = store.planPromotion(room.room_id, { residency: "fleet" }, T1);
    store.setStatus(room.room_id, "in_play", T1);
    expect(errorCode(() => store.applyPromotion(plan))).toBe("changed_since_preview");
    expect(store.getRoom(room.room_id)?.residency).toBe("device");
    expect(store.listAudit()).toEqual([]);
    store.close();
  });

  test("refuses a plan object mutated after the bytes were shown", () => {
    const { store } = openStore();
    const room = store.addRoom({ title: "Zerone season 1" }, T0);
    const plan = store.planPromotion(room.room_id, { residency: "fleet" }, T1);
    const tampered = { ...plan, after: { ...plan.after, residency: "open" as const, visibility: "public" as const } };
    expect(errorCode(() => store.applyPromotion(tampered))).toBe("plan_mismatch");
    expect(store.getRoom(room.room_id)?.residency).toBe("device");
    expect(store.listAudit()).toEqual([]);
    store.close();
  });
});

describe("pin book", () => {
  const input = {
    did: "did:key:z6MkExampleOnlyNotARealKey",
    kid: "key-1",
    public_key: fakePublicKey(7),
    petname: "studio desk",
    how_obtained: "read aloud in person",
  };

  test("fingerprint is the first 16 hex of SHA-256 over the raw key", () => {
    const raw = Buffer.alloc(32, 7);
    const expected = new Bun.CryptoHasher("sha256").update(raw).digest("hex").slice(0, 16);
    expect(fingerprintOf(raw)).toBe(expected);
  });

  test("add and remove are planned, applied and audited", () => {
    const { store } = openStore();
    const add = store.planPinAdd(input, T0);
    expect(add.pin.fingerprint).toBe(fingerprintOf(Buffer.alloc(32, 7)));
    expect(add.bytes).toBe(canonicalJson({ schema: "agenttool-lobby-act/v1", act: "pin.add", at: T0.toISOString(), pin: add.pin }));
    store.applyPinAdd(add);
    expect(store.listPins()).toEqual([add.pin]);
    expect(errorCode(() => store.planPinAdd(input, T1))).toBe("pin_exists");
    expect(errorCode(() => store.planPinAdd({ ...input, kid: "key-2" }, T1))).toBe("fingerprint_exists");

    const remove = store.planPinRemove({ fingerprint: add.pin.fingerprint }, T1);
    store.applyPinRemove(remove);
    expect(store.listPins()).toEqual([]);
    expect(store.listAudit().map((entry) => entry.act)).toEqual(["pin.add", "pin.remove"]);
    expect(store.verifyAudit().ok).toBe(true);
    expect(errorCode(() => store.planPinRemove({ fingerprint: add.pin.fingerprint }, T2))).toBe("pin_not_found");
    store.close();
  });

  test("validates DIDs, key ids, keys and labels", () => {
    const { store } = openStore();
    expect(errorCode(() => store.planPinAdd({ ...input, did: "not-a-did" }, T0))).toBe("invalid_did");
    expect(errorCode(() => store.planPinAdd({ ...input, kid: "has space" }, T0))).toBe("invalid_kid");
    expect(errorCode(() => store.planPinAdd({ ...input, public_key: Buffer.alloc(31, 1).toString("base64") }, T0)))
      .toBe("invalid_public_key");
    expect(errorCode(() => store.planPinAdd({ ...input, public_key: "not base64!" }, T0))).toBe("invalid_public_key");
    expect(errorCode(() => store.planPinAdd({ ...input, petname: "stu\u202edio" }, T0))).toBe("invalid_petname");
    for (const invisible of ["\u200d", "\u200c", "\u00ad", "\ufe0f", "\u{e0020}"]) {
      expect(errorCode(() => store.planPinAdd({ ...input, petname: `stu${invisible}dio` }, T0))).toBe("invalid_petname");
    }
    const urlSafe = Buffer.alloc(32, 0xfb).toString("base64url");
    expect(store.planPinAdd({ ...input, public_key: urlSafe }, T0).pin.public_key)
      .toBe(Buffer.alloc(32, 0xfb).toString("base64"));
    store.close();
  });
});

describe("append-only audit log", () => {
  test("SQLite refuses updates and deletes, and the chain detects edits", () => {
    const { home, store } = openStore();
    const room = store.addRoom({ title: "Zerone season 1" }, T0);
    store.applyPromotion(store.planPromotion(room.room_id, { residency: "fleet" }, T1));
    store.applyPromotion(store.planPromotion(room.room_id, { hostable: true }, T2));
    expect(store.verifyAudit()).toEqual({ ok: true, entries: 2, first_bad_seq: null });
    store.close();

    const raw = new Database(join(home, DATABASE_FILE));
    expect(() => raw.exec("UPDATE audit SET act = 'pin.add'")).toThrow(/audit_is_append_only/);
    expect(() => raw.exec("DELETE FROM audit")).toThrow(/audit_is_append_only/);
    raw.exec("DROP TRIGGER audit_rows_are_not_updated");
    raw.exec("UPDATE audit SET bytes = '{}' WHERE seq = 2");
    raw.close();

    const reopened = LobbyStore.open(home);
    expect(reopened.verifyAudit()).toEqual({ ok: false, entries: 2, first_bad_seq: 2 });
    reopened.close();
  });

  test("ordinary acts are not audited", () => {
    const { store } = openStore();
    const room = store.addRoom({ title: "Zerone season 1" }, T0);
    store.setStatus(room.room_id, "in_play", T1);
    store.link(room.room_id, "none", T1);
    expect(store.listAudit()).toEqual([]);
    store.close();
  });
});

describe("read-only view", () => {
  test("cannot write and sees committed rooms", () => {
    const { home, store } = openStore();
    const room = store.addRoom({ title: "Zerone season 1" }, T0);
    const reader = LobbyStore.openReadOnly(home)!;
    expect(reader.listRooms()).toEqual([room]);
    expect(errorCode(() => reader.addRoom({ title: "nope" }, T1))).toBe("read_only");
    const second = store.addRoom({ title: "second" }, T1);
    expect(reader.listRooms().map((card) => card.room_id)).toEqual([room.room_id, second.room_id]);
    reader.close();
    store.close();
  });
});

describe("state schema versions and the upgrade chain", () => {
  const FLEET_TABLES = ["cursors", "desk", "desk_grants", "desk_knocks", "events", "hub", "hub_cards", "hub_decisions",
    "hub_devices", "hub_grants", "hub_members", "hub_seasons", "outbox"];
  const V3_TABLES = ["desk_renewals", "hub_blocks", "hub_extra_grants", "hub_processed_notes", "hub_renewals", "hub_rosters"];
  const V4_TABLES = ["desk_lease_sends", "desk_leases"];

  function tables(home: string): string[] {
    const raw = new Database(join(home, DATABASE_FILE), { readonly: true });
    const names = (raw.query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>)
      .map((row) => row.name);
    raw.close();
    return names;
  }

  test("a version-1 file is read as having no fleet state and upgraded explicitly by the CLI handle", () => {
    const { home, store } = openStore();
    const room = store.addRoom({ title: "kept across the upgrade" }, T0);
    store.close();
    // Rebuild what a version-1 desk left behind: no fleet tables, version 1.
    const raw = new Database(join(home, DATABASE_FILE));
    for (const table of [...V4_TABLES, ...FLEET_TABLES, ...V3_TABLES]) raw.exec(`DROP TABLE ${table}`);
    raw.exec("UPDATE meta SET value = '1' WHERE key = 'schema_version'");
    raw.close();

    const reader = LobbyStore.openReadOnly(home)!;
    expect(reader.stateVersion).toBe("1");
    expect(reader.fleet.available).toBe(false);
    expect(reader.fleet.desk()).toBeNull();
    expect(reader.fleet.events("11111111-1111-4111-8111-111111111111")).toEqual([]);
    expect(reader.listRooms()).toEqual([room]);
    reader.close();

    const upgraded = LobbyStore.open(home);
    expect(upgraded.stateVersion).toBe(STATE_SCHEMA_VERSION);
    expect(upgraded.fleet.available).toBe(true);
    expect(upgraded.fleet.v3).toBe(true);
    expect(upgraded.listRooms()).toEqual([room]);
    upgraded.close();
    for (const table of [...FLEET_TABLES, ...V3_TABLES, ...V4_TABLES]) expect(tables(home)).toContain(table);
  });

  test("a version-2 file is read without the version-3 tables and upgraded once, keeping every row", () => {
    const { home, store } = openStore();
    const room = store.addRoom({ title: "kept across the upgrade" }, T0);
    store.close();
    // Rebuild what a version-2 desk left behind: the version-2 fleet tables only.
    const raw = new Database(join(home, DATABASE_FILE));
    for (const table of [...V4_TABLES, ...FLEET_TABLES, ...V3_TABLES]) raw.exec(`DROP TABLE ${table}`);
    raw.exec(FLEET_SCHEMA_SQL);
    raw.exec("UPDATE meta SET value = '2' WHERE key = 'schema_version'");
    raw.query(`INSERT INTO hub_members (mission_id, room_id, identity_id, tier, term_ends_at, knock_id, grant_id, admitted_at)
      VALUES ('11111111-1111-4111-8111-111111111111', $room, '22222222-2222-4222-8222-222222222222', 'player',
        '2026-11-01T00:00:00.000Z', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444', $at)`)
      .run({ $room: room.room_id, $at: T0.toISOString() });
    raw.close();

    const reader = LobbyStore.openReadOnly(home)!;
    expect(reader.stateVersion).toBe("2");
    expect(reader.fleet.available).toBe(true);
    expect(reader.fleet.v3).toBe(false);
    expect(reader.fleet.deskRenewals(room.room_id)).toEqual([]);
    expect(reader.fleet.isBlocked(room.room_id, "22222222-2222-4222-8222-222222222222")).toBe(false);
    reader.close();

    const upgraded = LobbyStore.open(home);
    expect(upgraded.stateVersion).toBe(STATE_SCHEMA_VERSION);
    const [member] = upgraded.fleet.members("11111111-1111-4111-8111-111111111111");
    expect(member).toMatchObject({ identity_id: "22222222-2222-4222-8222-222222222222", state: "active", paused_at: null });
    upgraded.close();
    // A second open does not run the upgrade again.
    LobbyStore.open(home).close();
    for (const table of [...V3_TABLES, ...V4_TABLES]) expect(tables(home)).toContain(table);
  });

  test("a version-3 file is read as having no leases and upgraded once to the lease tables, keeping every row", () => {
    const { home, roomId } = legacyFile("3");
    const reader = LobbyStore.openReadOnly(home)!;
    expect(reader.stateVersion).toBe("3");
    expect(reader.fleet.v4).toBe(false);
    expect(reader.fleet.listLeases()).toEqual([]);
    expect(reader.fleet.lease(`lease_${"0".repeat(32)}`)).toBeNull();
    expect(reader.fleet.leaseSends(`lease_${"0".repeat(32)}`)).toEqual([]);
    reader.close();
    const upgraded = LobbyStore.open(home);
    expect(upgraded.stateVersion).toBe("4");
    expect(upgraded.fleet.v4).toBe(true);
    expect(upgraded.listRooms().map((card) => card.room_id)).toEqual([roomId]);
    upgraded.close();
    for (const table of V4_TABLES) expect(tables(home)).toContain(table);
  });

  test("leases keep their bounds, end once, only count up and are never deleted", () => {
    const { store } = openStore();
    const leaseId = `lease_${"ab".repeat(16)}`;
    const base = {
      lease_id: leaseId, room_id: `room_${"0".repeat(32)}`, mission_id: "11111111-1111-4111-8111-111111111111",
      grant_id: "22222222-2222-4222-8222-222222222222", directory_grant_id: null, seat_ref: null, record: "{}", record_sha256: "a".repeat(64),
      audit_seq: 1, issued_at: "2026-10-27T00:00:00.000Z", max_messages: 2, max_chars_per_message: 1000, max_total_chars: 100, min_interval_ms: 30_000,
    };
    // Past Yu's caps: refused by SQLite itself.
    for (const over of [{ expires_at: "2026-10-27T08:00:01.000Z" }, { expires_at: "2026-10-27T01:00:00.000Z", max_messages: 101 },
      { expires_at: "2026-10-27T01:00:00.000Z", max_total_chars: 50_001 }, { expires_at: "2026-10-27T01:00:00.000Z", min_interval_ms: 4_999 },
      { expires_at: "2026-10-27T01:00:00.000Z", max_chars_per_message: 1001 }, { expires_at: "2026-10-27T01:00:00.000Z", lease_id: "lease_XYZ" }]) {
      expect(() => store.fleet.addLease({ ...base, ...over })).toThrow();
    }
    store.fleet.addLease({ ...base, expires_at: "2026-10-27T08:00:00.000Z" });
    const raw = (statement: string) => () => (store as unknown as { db: Database }).db.exec(statement);
    expect(raw(`UPDATE desk_leases SET max_messages = 3 WHERE lease_id = '${leaseId}'`)).toThrow("lease_bounds_are_fixed");
    expect(raw(`UPDATE desk_leases SET expires_at = '2026-10-27T09:00:00.000Z' WHERE lease_id = '${leaseId}'`)).toThrow("lease_bounds_are_fixed");
    expect(raw(`UPDATE desk_leases SET sent_messages = 3 WHERE lease_id = '${leaseId}'`)).toThrow();
    expect(raw(`DELETE FROM desk_leases WHERE lease_id = '${leaseId}'`)).toThrow("leases_end_rather_than_delete");
    expect(store.fleet.voidLease(leaseId, "stop_file", "2026-10-27T01:00:00.000Z")).toBe(true);
    expect(store.fleet.voidLease(leaseId, "other", "2026-10-27T02:00:00.000Z")).toBe(false);
    expect(store.fleet.revokeLease(leaseId, "2026-10-27T02:00:00.000Z")).toBe(false);
    expect(raw(`UPDATE desk_leases SET voided_at = NULL, void_reason = NULL WHERE lease_id = '${leaseId}'`)).toThrow("lease_ends_once_and_counters_only_grow");
    // A second, different end is refused by SQLite itself, not only by the store's WHERE clauses.
    expect(raw(`UPDATE desk_leases SET revoked_at = '2026-10-27T02:00:00.000Z' WHERE lease_id = '${leaseId}'`)).toThrow("CHECK constraint failed");
    const revokedId = `lease_${"cd".repeat(16)}`;
    store.fleet.addLease({ ...base, lease_id: revokedId, expires_at: "2026-10-27T08:00:00.000Z" });
    expect(store.fleet.revokeLease(revokedId, "2026-10-27T01:00:00.000Z")).toBe(true);
    expect(raw(`UPDATE desk_leases SET voided_at = '2026-10-27T02:00:00.000Z', void_reason = 'stop_file' WHERE lease_id = '${revokedId}'`))
      .toThrow("CHECK constraint failed");
    expect(store.fleet.lease(revokedId)).toMatchObject({ revoked_at: "2026-10-27T01:00:00.000Z", voided_at: null });
    expect(store.fleet.lease(leaseId)).toMatchObject({ void_reason: "stop_file", voided_at: "2026-10-27T01:00:00.000Z" });
    store.close();
  });

  test("an unknown version is refused by both handles", () => {
    const { home, store } = openStore();
    store.close();
    const raw = new Database(join(home, DATABASE_FILE));
    raw.exec("UPDATE meta SET value = '9' WHERE key = 'schema_version'");
    raw.close();
    expect(errorCode(() => LobbyStore.open(home))).toBe("unsupported_state_version");
    expect(errorCode(() => LobbyStore.openReadOnly(home))).toBe("unsupported_state_version");
  });

  /** What a file's schema is, and SQLite's schema cookie, which moves on every
   * CREATE, ALTER or DROP that changes the schema and on nothing else. */
  function schemaOf(home: string): { cookie: number; version: string; objects: string[] } {
    const raw = new Database(join(home, DATABASE_FILE), { readonly: true });
    const { schema_version: cookie } = raw.query("PRAGMA schema_version").get() as { schema_version: number };
    const { value: version } = raw.query("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string };
    const objects = (raw.query("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type, name")
      .all() as Array<{ type: string; name: string; sql: string }>).map((row) => `${row.type} ${row.name}: ${row.sql}`);
    raw.close();
    return { cookie, version, objects };
  }

  /** The schema each released version leaves on disk: sha256 of `schemaOf().objects`
   * joined by newlines. These are frozen from the released code, not from the
   * code under test: each value is what a new desk at that release wrote
   * (1: 1fd7d4c1, a395ed11; 2: 20abfae2 to 8434539b; 3: 8ab54047 to 57004ab2;
   * 4: room seat leases, lobby/room-seat-leases).
   * Editing `SCHEMA_SQL` or a released step changes a fixture below and fails
   * here, because real desks at that version would not have the edit. A new
   * version adds one line, taken from a new desk once its step is final. */
  const RELEASED_SCHEMAS: Readonly<Record<string, string>> = {
    "1": "7aac6b19c22d1c6d332df147db6b2eae0474ce566a880a472de5c01ad3f73fa7",
    "2": "dd929e4e296c22ead6f3d49f297790d10e048bc76608ced611bbef8d5f4b03b2",
    "3": "578aa41feab26266068638cca521d027004176a36f91dd0a2aebb6d699bfd847",
    "4": "f60612400b74b18e96245845fb967ffe130ef871d8299dd08082fcfeff7cac16",
  };

  function schemaDigest(objects: string[]): string {
    return sha256Hex(objects.join("\n"));
  }

  /** A file as a desk of `version` left it, with one local-hall room in it:
   * the version-1 tables, then the chain's own steps up to `version` and no
   * further, so the fixture does not move when the current version does. */
  function legacyFile(version: string): { home: string; roomId: string } {
    const { home } = tempHome();
    const raw = new Database(preparePrivateHome(home), { create: false, readwrite: true, strict: true });
    raw.exec(SCHEMA_SQL);
    let at = "1";
    for (const step of SCHEMA_STEPS) {
      if (at === version) break;
      step.apply(raw);
      at = step.to;
    }
    expect(at).toBe(version);
    raw.query("INSERT INTO meta (key, value) VALUES ('schema_version', $value)").run({ value: version });
    const card = newRoomCard({ title: `written at version ${version}` }, T0);
    raw.query(`INSERT INTO rooms (room_id, card, status, door, visibility, residency, hostable, device_pinned,
        created_at, updated_at)
      VALUES ($room_id, $card, $status, $door, $visibility, $residency, $hostable, 0, $at, $at)`)
      .run({
        room_id: card.room_id, card: canonicalJson(card), status: card.status, door: card.door,
        visibility: card.visibility, residency: card.residency, hostable: card.hostable ? 1 : 0, at: card.created_at,
      });
    raw.close();
    return { home, roomId: card.room_id };
  }

  test("the upgrade chain is contiguous from version 1 and ends at the current version", () => {
    expect(SCHEMA_STEPS.length).toBeGreaterThan(0);
    let version = "1";
    for (const step of SCHEMA_STEPS) {
      expect(step.from).toBe(version);
      expect(Number(step.to)).toBe(Number(step.from) + 1);
      version = step.to;
    }
    expect(version).toBe(STATE_SCHEMA_VERSION);
  });

  test("every version the chain knows has a frozen released schema, and a new file has the current one", () => {
    expect(Object.keys(RELEASED_SCHEMAS).sort((a, b) => Number(a) - Number(b)))
      .toEqual(["1", ...SCHEMA_STEPS.map((step) => step.to)]);
    const fresh = tempHome().home;
    LobbyStore.open(fresh).close();
    expect(schemaDigest(schemaOf(fresh).objects)).toBe(RELEASED_SCHEMAS[STATE_SCHEMA_VERSION]!);
  });

  // Every version the chain knows: 1 to 4 today, and each later one as it lands.
  for (const version of ["1", ...SCHEMA_STEPS.map((step) => step.to)]) {
    test(`a version-${version} file opens, upgrades to version ${STATE_SCHEMA_VERSION} once and keeps its rooms`, () => {
      const fresh = tempHome().home;
      LobbyStore.open(fresh).close();
      const target = schemaOf(fresh);

      const { home, roomId } = legacyFile(version);
      const before = schemaOf(home);
      expect(before.version).toBe(version);
      // The fixture is the schema real desks at this version have, not just
      // what today's base and steps rebuild.
      expect(schemaDigest(before.objects)).toBe(RELEASED_SCHEMAS[version]!);

      const opened = LobbyStore.open(home);
      expect(opened.stateVersion).toBe(STATE_SCHEMA_VERSION);
      expect(opened.listRooms().map((card) => card.room_id)).toEqual([roomId]);
      opened.close();
      const after = schemaOf(home);
      expect(after.version).toBe(STATE_SCHEMA_VERSION);
      // Every path reaches the schema a new file gets, column for column.
      expect(after.objects).toEqual(target.objects);
      // A current file takes no step: nothing in its schema is touched.
      if (version === STATE_SCHEMA_VERSION) expect(after.cookie).toBe(before.cookie);

      // Reopening runs no step again: no ALTER, no CREATE, the same schema.
      LobbyStore.open(home).close();
      LobbyStore.open(home).close();
      expect(schemaOf(home)).toEqual(after);
      const reader = LobbyStore.openReadOnly(home)!;
      expect(reader.stateVersion).toBe(STATE_SCHEMA_VERSION);
      reader.close();
    });
  }

  test("the next, not yet known version is refused by both handles and the file is left as it was", () => {
    const { home } = legacyFile("3");
    const next = String(Number(STATE_SCHEMA_VERSION) + 1);
    const raw = new Database(join(home, DATABASE_FILE));
    raw.query("UPDATE meta SET value = $value WHERE key = 'schema_version'").run({ $value: next });
    raw.close();
    const before = schemaOf(home);
    expect(errorCode(() => LobbyStore.open(home))).toBe("unsupported_state_version");
    expect(errorCode(() => LobbyStore.openReadOnly(home))).toBe("unsupported_state_version");
    expect(schemaOf(home)).toEqual(before);
  });

  test("hub decisions are final", () => {
    const { store } = openStore();
    const decision = {
      knock_id: "11111111-1111-4111-8111-111111111111", room_id: `room_${"0".repeat(32)}`,
      identity_id: "22222222-2222-4222-8222-222222222222", knock_sha256: "a".repeat(64), summary: "{}",
    };
    store.fleet.addDecision({ ...decision, decision: "denied", decided_at: T0.toISOString() });
    expect(errorCode(() => store.fleet.addDecision({ ...decision, decision: "admitted", decided_at: T1.toISOString() })))
      .toBe("knock_decided");
    store.close();
  });
});
