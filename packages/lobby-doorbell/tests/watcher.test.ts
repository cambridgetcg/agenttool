import { describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listenerPath, readMark, rungPath } from "../src/registry.js";
import {
  expiredRing, lapsedRing, messageRing, NOTE_PATTERN, newMessagesNote, rearmNote, RING_GRAMMAR, RING_PATTERN, stateNote, stoppedAgainRing, stoppedRing,
} from "../src/ring.js";
import { MIN_RING_GAP_MS, Watcher, WATCH_TICK_MS } from "../src/watcher.js";
import { CANARY, NOW, ROOM_A } from "./helpers.js";
import { makeDoorbellWorld, OTHER, WATCHER, type DoorbellWorld } from "./doorbell-helpers.js";

function watcherWorld(options: { mode?: "addressed" | "all"; ownerGone?: () => boolean; pid?: number } = {}) {
  const world = makeDoorbellWorld();
  world.listener({ mode: options.mode ?? "addressed" });
  const rings: string[] = [];
  const watcher = new Watcher({
    doorbellHome: world.doorbellHome,
    lobbyHome: world.lobbyHome,
    roomId: ROOM_A,
    pid: options.pid ?? WATCHER,
    ring: async (text) => {
      rings.push(text);
      return { ok: true, code: null };
    },
    ownerGone: options.ownerGone ?? (() => false),
    now: () => world.clock,
  });
  const tick = async (ms = WATCH_TICK_MS) => {
    world.clock += ms;
    return await watcher.tick();
  };
  return { world, watcher, rings, tick };
}

const counts = (world: DoorbellWorld, seq: number, head: string, fresh: number, addressed: number, extra: object = {}) =>
  world.bell({ seq, head_cursor: head, new: fresh, addressed, ...extra });

describe("ring text (grammar agenttool-lobby-bell/v2)", () => {
  test("every ring and note is content-free and matches the closed grammar", () => {
    expect(RING_GRAMMAR).toBe("agenttool-lobby-bell/v2");
    const rings = [
      messageRing({ room_id: ROOM_A, from_cursor: "10", head_cursor: "14", counts: { new: 3, addressed: 1, unverified: 1 }, watcher_pid: 4242 }),
      lapsedRing({ room_id: ROOM_A, reason: "refused_401", watcher_pid: 4242 }),
      stoppedRing({ room_id: ROOM_A, reason: "fetcher_lifetime", watcher_pid: 4242 }),
      expiredRing({ room_id: ROOM_A, hours: 12 }),
      stoppedAgainRing({ room_id: ROOM_A, reason: "lobby_refused", watcher_pid: 4242 }),
    ];
    for (const ring of rings) {
      expect({ ring, matches: RING_PATTERN.test(ring) }).toEqual({ ring, matches: true });
      expect(ring).not.toMatch(/lease_[0-9a-f]|lease id|\/Users\/|\/home\//);
    }
    expect(rings[0]).toContain("Reply with room_say_draft, or room say --lease if a person gave this seat a lease.");
    expect(rings[0]).not.toContain("Reply only with room_say_draft");
    for (const note of [
      newMessagesNote({ room_id: ROOM_A, from_cursor: "10", counts: { new: 2, addressed: 1, unverified: 0 } }),
      stateNote({ room_id: ROOM_A, state: "grant-lapsed", reason: "no_seat" }),
      stateNote({ room_id: ROOM_A, state: "hosted-unreachable", reason: "rate_limited" }),
      rearmNote(ROOM_A),
    ]) expect({ note, matches: NOTE_PATTERN.test(note) }).toEqual({ note, matches: true });
  });

  test("the grammar refuses anything with free text in it", () => {
    const ring = messageRing({ room_id: ROOM_A, from_cursor: "10", head_cursor: "14", counts: { new: 3, addressed: 1, unverified: 0 }, watcher_pid: 4242 });
    expect(RING_PATTERN.test(ring.replace("3 new", `${CANARY} new`))).toBe(false);
    expect(RING_PATTERN.test(`${ring} ${CANARY}`)).toBe(false);
    expect(RING_PATTERN.test(ring.replace(`--room ${ROOM_A}`, `--room room_${"b".repeat(32)}`))).toBe(false);
    expect(RING_PATTERN.test(lapsedRing({ room_id: ROOM_A, reason: "no_seat", watcher_pid: 1 }).replace("no_seat", "No Seat!"))).toBe(false);
    const again = stoppedAgainRing({ room_id: ROOM_A, reason: "cli_failed", watcher_pid: 1 });
    expect(again).not.toContain("listen --room");
    expect(RING_PATTERN.test(again.replace("cli_failed", CANARY))).toBe(false);
    expect(RING_PATTERN.test(again.replace("Do not re-arm; ", `re-arm with: agenttool-lobby-doorbell listen --room ${ROOM_A}; `))).toBe(false);
  });
});

describe("the watcher", () => {
  test("rings once for messages addressed to this desk, forward only, with no message text", async () => {
    const { world, rings, tick } = watcherWorld();
    counts(world, 1, "10", 0, 0);
    expect(await tick()).toBeNull();
    expect(rings).toEqual([]);
    counts(world, 2, "12", 2, 0);
    await tick();
    expect(rings).toEqual([]);
    counts(world, 3, "14", 3, 1);
    await tick();
    expect(rings).toHaveLength(1);
    expect(rings[0]).toMatch(RING_PATTERN);
    expect(rings[0]).toContain("3 new table message(s) after cursor 10 (head 14), 1 addressed to this desk");
    await tick(MIN_RING_GAP_MS);
    expect(rings).toHaveLength(1);
    expect(readMark(rungPath(world.doorbellHome, ROOM_A), ROOM_A)).toMatchObject({ seq: 3, cursor: "14", new: 3, addressed: 1 });
  });

  test("`all` mode rings for any message from another desk", async () => {
    const { world, rings, tick } = watcherWorld({ mode: "all" });
    counts(world, 2, "11", 1, 0);
    await tick();
    expect(rings).toHaveLength(1);
    expect(rings[0]).toContain("1 new table message(s) after cursor 10 (head 11), 0 addressed");
  });

  test("rings within 60 s coalesce into one that covers the burst", async () => {
    const { world, rings, tick } = watcherWorld();
    counts(world, 2, "11", 1, 1);
    await tick();
    counts(world, 3, "12", 2, 2);
    await tick();
    counts(world, 4, "13", 3, 3);
    await tick();
    expect(rings).toHaveLength(1);
    world.clock += MIN_RING_GAP_MS;
    await tick();
    expect(rings).toHaveLength(2);
    expect(rings[1]).toContain("2 new table message(s) after cursor 11 (head 13), 2 addressed");
  });

  test("state rings: once per transition into grant-lapsed or a stopped fetcher; never for hosted-unreachable or STOP", async () => {
    const { world, rings, tick } = watcherWorld();
    counts(world, 2, "10", 0, 0, { state: "hosted-unreachable", reason: "hosted_uncertain" });
    await tick();
    expect(rings).toEqual([]);
    counts(world, 3, "10", 0, 0, { state: "grant-lapsed", reason: "no_seat" });
    await tick();
    counts(world, 4, "10", 0, 0, { state: "grant-lapsed", reason: "no_seat", at: new Date(NOW + 1).toISOString() });
    await tick();
    expect(rings).toHaveLength(1);
    expect(rings[0]).toContain("grant-lapsed (no_seat). A person must renew");
    counts(world, 5, "10", 0, 0);
    await tick();
    counts(world, 6, "10", 0, 0, { state: "stopped", reason: "fetcher_lifetime" });
    await tick();
    expect(rings).toHaveLength(2);
    expect(rings[1]).toContain("the fetcher stopped (fetcher_lifetime)");
    counts(world, 7, "10", 0, 0);
    await tick();
    counts(world, 8, "10", 0, 0, { state: "stopped", reason: "stopped" });
    await tick();
    expect(rings).toHaveLength(2);
  });

  test("a later stop on the same arm asks for a person instead of a re-arm; a failed ring does not count, and a new arm starts over", async () => {
    const world = makeDoorbellWorld();
    world.listener();
    const results = [{ ok: false, code: "ECONNREFUSED" }];
    const rings: string[] = [];
    const watcher = new Watcher({
      doorbellHome: world.doorbellHome, lobbyHome: world.lobbyHome, roomId: ROOM_A, pid: WATCHER,
      ring: async (text) => { rings.push(text); return results.shift() ?? { ok: true, code: null }; },
      ownerGone: () => false, now: () => world.clock,
    });
    const step = async (seq: number, extra: object = {}) => {
      counts(world, seq, "10", 0, 0, extra);
      world.clock += WATCH_TICK_MS;
      await watcher.tick();
    };
    const stop = (reason: string) => ({ state: "stopped", reason });
    await step(1);
    await step(2, stop("cli_failed"));
    await step(3);
    await step(4, stop("cli_failed"));
    await step(5);
    await step(6, stop("lobby_refused"));
    await step(7);
    await step(8, stop("fetcher_stopped"));
    const input = (reason: "cli_failed" | "lobby_refused" | "fetcher_stopped") => ({ room_id: ROOM_A, reason, watcher_pid: WATCHER });
    expect(rings).toEqual([
      stoppedRing(input("cli_failed")), // not delivered
      stoppedRing(input("cli_failed")),
      stoppedAgainRing(input("lobby_refused")),
      stoppedAgainRing(input("fetcher_stopped")),
    ]);
    // A new arm (a fresh listen) starts over: its first stop says how to re-arm.
    const armed = new Date(world.clock).toISOString();
    world.listener({ armed_at: armed });
    await step(9, { armed_at: armed });
    await step(10, { armed_at: armed, ...stop("cli_failed") });
    expect(rings.at(-1)).toBe(stoppedRing(input("cli_failed")));
  });

  test("a grant that lapsed before the first catch-up (no head yet) still rings once", async () => {
    const { world, rings, tick } = watcherWorld();
    counts(world, 1, "0", 0, 0, { base_cursor: null, head_cursor: null, state: "grant-lapsed", reason: "no_seat" });
    await tick();
    await tick();
    expect(rings).toHaveLength(1);
    expect(rings[0]).toContain("grant-lapsed (no_seat)");
  });

  test("STOP: exits within one tick and rings nothing", async () => {
    const { world, rings, tick } = watcherWorld();
    counts(world, 2, "11", 1, 1);
    writeFileSync(join(world.lobbyHome, "STOP"), "stopped\n", { mode: 0o600 });
    expect(await tick()).toBe("stopped");
    expect(rings).toEqual([]);
  });

  test("STOP that appears between a tick's checks and its ring: nothing rings, and the counts stay unrung", async () => {
    let stopNow = false;
    const { world, rings, tick } = watcherWorld({ ownerGone: () => {
      // ownerGone runs after the tick's own STOP check: STOP lands just before the ring.
      if (stopNow) writeFileSync(join(world.lobbyHome, "STOP"), "stopped\n", { mode: 0o600 });
      return false;
    } });
    counts(world, 1, "10", 0, 0);
    await tick();
    counts(world, 2, "11", 1, 1);
    stopNow = true;
    expect(await tick()).toBeNull();
    expect(rings).toEqual([]);
    expect(readMark(rungPath(world.doorbellHome, ROOM_A), ROOM_A)).toMatchObject({ seq: 2, cursor: "10", new: 0, addressed: 0 });
  });

  test("a failed ring is not recorded as rung: the next ring covers those messages too", async () => {
    const world = makeDoorbellWorld();
    world.listener();
    const results = [{ ok: false, code: "ECONNREFUSED" }, { ok: true, code: null }];
    const rings: string[] = [];
    const watcher = new Watcher({
      doorbellHome: world.doorbellHome, lobbyHome: world.lobbyHome, roomId: ROOM_A, pid: WATCHER,
      ring: async (text) => { rings.push(text); return results.shift()!; },
      ownerGone: () => false, now: () => world.clock,
    });
    counts(world, 1, "10", 0, 0);
    world.clock += WATCH_TICK_MS;
    await watcher.tick();
    counts(world, 2, "12", 2, 1);
    world.clock += WATCH_TICK_MS;
    await watcher.tick();
    expect(rings).toHaveLength(1);
    expect(readMark(rungPath(world.doorbellHome, ROOM_A), ROOM_A)).toMatchObject({ seq: 2, cursor: "10", new: 0, addressed: 0 });
    // Not retried in a loop: the same bell rings nothing more.
    world.clock += WATCH_TICK_MS;
    await watcher.tick();
    expect(rings).toHaveLength(1);
    // The next news rings at once (the failed ring set no 60 s gap) and covers both bursts.
    counts(world, 3, "13", 3, 2);
    world.clock += WATCH_TICK_MS;
    await watcher.tick();
    expect(rings).toHaveLength(2);
    expect(rings[1]).toContain("3 new table message(s) after cursor 10 (head 13), 2 addressed");
  });

  test("exits when the owner is gone, its listener is removed or names another watcher, or on SIGTERM", async () => {
    let gone = false;
    let run = watcherWorld({ ownerGone: () => gone });
    gone = true;
    expect(await run.tick()).toBe("owner_gone");

    run = watcherWorld();
    expect(await run.tick()).toBeNull();
    writeFileSync(listenerPath(run.world.doorbellHome, ROOM_A), "", { mode: 0o600 });
    expect(await run.tick()).toBe("listener_unreadable");

    run = watcherWorld();
    run.world.listener({ watcher_pid: OTHER });
    expect(await run.tick()).toBeNull();
    expect(await run.tick(30_000)).toBe("superseded");

    run = watcherWorld();
    run.watcher.terminate();
    expect(await run.tick()).toBe("sigterm");
  });

  test("at expiry it rings once to ask for a re-arm and releases its own listener", async () => {
    const { world, rings, tick } = watcherWorld();
    counts(world, 1, "10", 0, 0);
    expect(await tick(12 * 3_600_000)).toBe("expired");
    expect(rings).toEqual([expiredRing({ room_id: ROOM_A, hours: 12 })]);
    expect(existsSync(listenerPath(world.doorbellHome, ROOM_A))).toBe(false);
  });

  test("a bell from another arm, or counts that went backwards, never ring", async () => {
    const { world, rings, tick } = watcherWorld();
    counts(world, 5, "20", 5, 5, { armed_at: new Date(NOW - 60_000).toISOString() });
    await tick();
    expect(rings).toEqual([]);
    counts(world, 2, "12", 2, 2);
    await tick();
    expect(rings).toHaveLength(1);
    counts(world, 3, "13", 1, 1);
    await tick(MIN_RING_GAP_MS);
    expect(rings).toHaveLength(1);
    expect(readMark(rungPath(world.doorbellHome, ROOM_A), ROOM_A)).toMatchObject({ seq: 3, new: 1 });
  });
});
