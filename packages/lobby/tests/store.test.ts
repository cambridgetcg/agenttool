import { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { canonicalJson, sha256Hex } from "../src/canonical.js";
import { LobbyError } from "../src/errors.js";
import { DATABASE_FILE } from "../src/home.js";
import { fingerprintOf } from "../src/pins.js";
import { LobbyStore, parseLedgerTarget } from "../src/store.js";
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
    for (const bad of ["", ".", "~", "~/repo", "relative/repo", "ws_short", "None", "/bad\u0000path"]) {
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
