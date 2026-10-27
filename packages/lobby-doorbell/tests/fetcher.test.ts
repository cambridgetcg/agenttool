import { describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACTIVE_WINDOW_MS, claimFetcherPidfile, ensureFetcher, fetcherState, LIFETIME_MS, NO_LISTENER_EXIT_MS, readFetcherStatus, releaseFetcherPidfile, TICK_MS,
} from "../src/fetcher.js";
import { parseBell } from "../src/formats.js";
import { readPrivateJson } from "../src/home.js";
import { bellPath, claimListener, fetcherPidPath, readBell, readListener } from "../src/registry.js";
import { Watcher, WATCH_TICK_MS } from "../src/watcher.js";
import { CANARY, ROOM_A, ROOM_B } from "./helpers.js";
import { FETCHER, LSTART, makeDoorbellWorld, OTHER, OWNER, UUID_GRANT_2, WATCHER, type DoorbellWorld } from "./doorbell-helpers.js";

const history = (count: number) => Array.from({ length: count }, (_, index) => ({ cursor: index + 1, from_me: index % 3 === 0, to_me: index % 2 === 0 }));

/** Runs cycles every tick until `ms` has passed on the fake clock. */
async function runFor(world: DoorbellWorld, fetcher: ReturnType<DoorbellWorld["fetcher"]>, ms: number) {
  const end = world.clock + ms;
  while (world.clock < end) {
    const exit = await fetcher.cycle();
    if (exit !== null) return exit;
    world.clock += TICK_MS;
  }
  return null;
}

describe("the fetcher", () => {
  test("the first poll pages to the head and never counts history; later messages count, text never kept", async () => {
    const world = makeDoorbellWorld();
    world.events = history(120);
    world.listener();
    const fetcher = world.fetcher();
    expect(await fetcher.cycle()).toBeNull();
    // One sync, then cached pages (no request) until has_more is false.
    expect(world.calls.map((call) => [call.after, call.cached])).toEqual([["0", false], ["50", true], ["100", true]]);
    let bell = readBell(world.doorbellHome, ROOM_A)!;
    expect(bell).toMatchObject({ base_cursor: "120", head_cursor: "120", new: 0, addressed: 0, unverified: 0, state: "ok", seq: 1 });

    world.events.push({ cursor: 121, to_me: true }, { cursor: 122, from_me: true }, { cursor: 123 }, { cursor: 124, unverified: true }, { cursor: 125, notice: true });
    world.clock += TICK_MS;
    await fetcher.cycle();
    bell = readBell(world.doorbellHome, bell.room_id)!;
    expect(bell).toMatchObject({
      head_cursor: "125", new: 2, addressed: 1, unverified: 1, seq: 2,
      last_change: { from_cursor: "120", to_cursor: "125", new: 2, addressed: 1, unverified: 1 },
    });
    expect(world.allFileText()).not.toContain(CANARY);
    expect(world.allFileText()).not.toMatch(/message \d+|display_name|"text"/);
  });

  test("cadence: 3 s while active, doubling to a 60 s cap when quiet (at most 61 polls in a quiet hour), 3 s again on news", async () => {
    const world = makeDoorbellWorld();
    world.events = history(5);
    world.listener();
    const fetcher = world.fetcher();
    await runFor(world, fetcher, ACTIVE_WINDOW_MS);
    // About one poll per 3 s tick during the 180 s after the arm.
    expect(world.syncCalls()).toBeGreaterThanOrEqual(59);
    expect(world.syncCalls()).toBeLessThanOrEqual(61);
    const gaps = () => world.calls.filter((call) => !call.cached).map((call, index, all) => index === 0 ? 0 : call.at - all[index - 1]!.at);
    await runFor(world, fetcher, 12 * 60_000);
    expect(gaps().slice(-8)).toEqual([60_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000, 60_000]);
    expect(gaps().filter((gap) => gap > 3_000).slice(0, 4)).toEqual([6_000, 12_000, 24_000, 48_000]);
    const before = world.syncCalls();
    await runFor(world, fetcher, 3_600_000);
    expect(world.syncCalls() - before).toBeLessThanOrEqual(61);
    expect(readFetcherStatus(world.doorbellHome)!.rooms[0]!.polls_last_hour).toBeLessThanOrEqual(61);

    world.events.push({ cursor: 6, to_me: true });
    await runFor(world, fetcher, 120_000);
    const recent = gaps().slice(-10);
    expect(recent.every((gap) => gap === 3_000)).toBe(true);
  });

  test("STOP halts within one cycle and marks the bells stopped; nothing polls after it", async () => {
    const world = makeDoorbellWorld();
    world.listener();
    const fetcher = world.fetcher();
    await fetcher.cycle();
    writeFileSync(join(world.lobbyHome, "STOP"), "stopped by a test\n", { mode: 0o600 });
    const calls = world.calls.length;
    world.clock += TICK_MS;
    expect(await fetcher.cycle()).toBe("stopped");
    expect(world.calls.length).toBe(calls);
    expect(readBell(world.doorbellHome, ROOM_A)).toMatchObject({ state: "stopped", reason: "stopped" });
  });

  test("STOP is checked before every poll, and at the start of a cycle even with no live listener", async () => {
    let world = makeDoorbellWorld();
    world.listener();
    world.listener({ room_id: ROOM_B });
    const tablePage = world.reader.tablePage.bind(world.reader);
    world.reader.tablePage = async (room, after, cached) => {
      const outcome = await tablePage(room, after, cached);
      // STOP is written while the first room is being read, between the two rooms of one cycle.
      writeFileSync(join(world.lobbyHome, "STOP"), "stopped by a test\n", { mode: 0o600 });
      return outcome;
    };
    expect(await world.fetcher().cycle()).toBe("stopped");
    expect(world.calls).toHaveLength(1);

    world = makeDoorbellWorld();
    writeFileSync(join(world.lobbyHome, "STOP"), "stopped by a test\n", { mode: 0o600 });
    expect(await world.fetcher().cycle()).toBe("stopped");
  });

  test("the 12 h lifetime, SIGTERM and 120 s without a live listener each end it", async () => {
    let world = makeDoorbellWorld();
    world.listener({ expires_at: new Date(world.clock + 12 * 3_600_000).toISOString() });
    let fetcher = world.fetcher();
    await fetcher.cycle();
    world.clock += LIFETIME_MS;
    expect(await fetcher.cycle()).toBe("fetcher_lifetime");
    expect(readBell(world.doorbellHome, ROOM_A)).toMatchObject({ state: "stopped", reason: "fetcher_lifetime" });

    world = makeDoorbellWorld();
    world.listener();
    fetcher = world.fetcher();
    await fetcher.cycle();
    fetcher.terminate();
    expect(await fetcher.cycle()).toBe("sigterm");

    world = makeDoorbellWorld();
    world.listener();
    fetcher = world.fetcher();
    await fetcher.cycle();
    world.procs.delete(OWNER);
    const calls = world.calls.length;
    expect(await runFor(world, fetcher, NO_LISTENER_EXIT_MS - TICK_MS)).toBeNull();
    expect(world.calls.length).toBe(calls);
    expect(await runFor(world, fetcher, 2 * TICK_MS)).toBe("no_listeners");
  });

  test("a stale listener (owner pid reused, watcher gone, expired) is not polled", async () => {
    for (const change of [
      (world: DoorbellWorld) => world.procs.set(OWNER, "Tue Oct 28 09:00:00 2026"),
      (world: DoorbellWorld) => world.procs.delete(9_000_002),
      (world: DoorbellWorld) => { world.clock += 12 * 3_600_000; },
    ]) {
      const world = makeDoorbellWorld();
      world.listener();
      change(world);
      await world.fetcher().cycle();
      expect(world.calls).toEqual([]);
    }
  });

  test("--from-cursor counts from the given cursor instead of the head", async () => {
    const world = makeDoorbellWorld();
    world.events = history(10);
    world.listener({ from_cursor: "8" });
    await world.fetcher().cycle();
    expect(world.calls[0]).toMatchObject({ after: "8", cached: false });
    expect(readBell(world.doorbellHome, ROOM_A)).toMatchObject({ base_cursor: "8", head_cursor: "10", new: 1, addressed: 1 });
  });

  test("a restarted fetcher continues the arm from the bell; a new arm starts at zero", async () => {
    const world = makeDoorbellWorld();
    world.events = history(3);
    const listener = world.listener();
    let fetcher = world.fetcher();
    await fetcher.cycle();
    world.events.push({ cursor: 4, to_me: true });
    world.clock += TICK_MS;
    await fetcher.cycle();
    expect(readBell(world.doorbellHome, listener.room_id)).toMatchObject({ head_cursor: "4", new: 1, seq: 2 });
    world.events.push({ cursor: 5, to_me: true });
    fetcher = world.fetcher(9_000_005);
    world.procs.set(9_000_005, LSTART);
    world.clock += TICK_MS;
    await fetcher.cycle();
    // seq 3 is the restored bell (a new seq, so readers see the restart); seq 4 the poll that found cursor 5.
    expect(readBell(world.doorbellHome, listener.room_id)).toMatchObject({ base_cursor: "3", head_cursor: "5", new: 2, addressed: 2, seq: 4 });

    world.clock += 60_000;
    world.listener();
    world.clock += TICK_MS;
    await fetcher.cycle();
    expect(readBell(world.doorbellHome, listener.room_id)).toMatchObject({ base_cursor: "5", head_cursor: "5", new: 0, addressed: 0 });
  });
});

describe("stopped twice on one arm", () => {
  test("a fetcher restarted on the same arm raises seq, so a second stop rings again", async () => {
    const world = makeDoorbellWorld();
    world.events = history(3);
    world.listener();
    const rings: string[] = [];
    const watcher = new Watcher({
      doorbellHome: world.doorbellHome, lobbyHome: world.lobbyHome, roomId: ROOM_A, pid: WATCHER,
      ring: async (text) => { rings.push(text); return { ok: true, code: null }; },
      ownerGone: () => false, now: () => world.clock,
    });
    const stoppedRings = () => rings.filter((ring) => ring.includes("the fetcher stopped")).length;
    let fetcher = world.fetcher();
    await fetcher.cycle();
    await watcher.tick();
    world.failures.push({ kind: "failed", code: "cli_exit" });
    world.clock += TICK_MS;
    expect(await fetcher.cycle()).toBe("fatal");
    await watcher.tick();
    expect(stoppedRings()).toBe(1);
    const stopped = readBell(world.doorbellHome, ROOM_A)!;
    // The ring's advice (listen again) starts a new fetcher that continues the arm.
    world.procs.set(9_000_005, LSTART);
    fetcher = world.fetcher(9_000_005);
    world.clock += TICK_MS;
    await fetcher.cycle();
    expect(readBell(world.doorbellHome, ROOM_A)).toMatchObject({ state: "ok", reason: null, seq: stopped.seq + 1 });
    world.clock += WATCH_TICK_MS;
    await watcher.tick();
    // A quiet room, then the new fetcher fails too.
    world.failures.push({ kind: "failed", code: "cli_exit" });
    world.clock += 60_000;
    expect(await fetcher.cycle()).toBe("fatal");
    world.clock += WATCH_TICK_MS;
    await watcher.tick();
    expect(stoppedRings()).toBe(2);
  });
});

describe("the refusal table", () => {
  const refused = (code: string, http_status?: number) => ({ kind: "refused" as const, code, ...(http_status === undefined ? {} : { http_status }) });

  async function afterFailure(failure: Parameters<DoorbellWorld["failures"]["push"]>[0]) {
    const world = makeDoorbellWorld();
    world.events = history(3);
    world.listener();
    const fetcher = world.fetcher();
    await fetcher.cycle();
    world.failures.push(failure);
    world.clock += TICK_MS;
    const exit = await fetcher.cycle();
    return { world, fetcher, exit, bell: readBell(world.doorbellHome, ROOM_A)! };
  }

  const nextSyncGap = async (world: DoorbellWorld, fetcher: ReturnType<DoorbellWorld["fetcher"]>, maxMs = 400_000) => {
    const before = world.syncCalls();
    const start = world.clock;
    while (world.syncCalls() === before && world.clock - start < maxMs) {
      world.clock += TICK_MS;
      await fetcher.cycle();
    }
    return world.clock - start;
  };

  test("no_seat and not_seated: grant-lapsed, re-checked every 60 s", async () => {
    for (const code of ["no_seat", "not_seated"]) {
      const { world, fetcher, exit, bell } = await afterFailure(refused(code));
      expect(exit).toBeNull();
      expect(bell).toMatchObject({ state: "grant-lapsed", reason: code, seq: 2 });
      expect(await nextSyncGap(world, fetcher)).toBe(60_000);
      expect(readBell(world.doorbellHome, bell.room_id)).toMatchObject({ state: "ok", reason: null, seq: 3 });
    }
  });

  test("HTTP 401/403/404: grant-lapsed, and the room waits until fleet status shows another season grant id", async () => {
    for (const status of [401, 403, 404]) {
      const { world, fetcher, bell } = await afterFailure(refused("hosted_refused", status));
      expect(bell).toMatchObject({ state: "grant-lapsed", reason: `refused_${status}` });
      const syncs = world.syncCalls();
      for (let index = 0; index < 100; index += 1) {
        world.clock += TICK_MS;
        await fetcher.cycle();
      }
      expect(world.syncCalls()).toBe(syncs);
      expect(world.statusCalls).toBeGreaterThan(1);
      world.grantIds = [UUID_GRANT_2];
      expect(await nextSyncGap(world, fetcher)).toBeLessThanOrEqual(60_000 + TICK_MS);
      expect(readBell(world.doorbellHome, bell.room_id)).toMatchObject({ state: "ok" });
    }
  });

  test("429 waits 300 s; uncertain, invalid, 5xx and a CLI timeout climb 60 -> 120 -> 300 s; none rings or stops", async () => {
    const limited = await afterFailure(refused("hosted_refused", 429));
    expect(limited.bell).toMatchObject({ state: "hosted-unreachable", reason: "rate_limited" });
    expect(await nextSyncGap(limited.world, limited.fetcher)).toBe(300_000);
    for (const [failure, reason] of [
      [refused("hosted_uncertain"), "hosted_uncertain"], [refused("hosted_invalid_response"), "hosted_invalid_response"],
      [refused("hosted_refused", 503), "hosted_5xx"], [{ kind: "failed" as const, code: "cli_timeout" as const }, "cli_timeout"],
    ] as const) {
      const { world, fetcher, exit, bell } = await afterFailure(failure);
      expect(exit).toBeNull();
      expect(bell).toMatchObject({ state: "hosted-unreachable", reason });
      world.failures.push(failure, failure, failure);
      expect(await nextSyncGap(world, fetcher)).toBe(60_000);
      expect(await nextSyncGap(world, fetcher)).toBe(120_000);
      expect(await nextSyncGap(world, fetcher)).toBe(300_000);
      expect(await nextSyncGap(world, fetcher)).toBe(300_000);
      expect(readBell(world.doorbellHome, bell.room_id)).toMatchObject({ state: "ok" });
    }
  });

  test("sync_page_limit stays ok with reason page_limit and polls again next cycle", async () => {
    const { world, fetcher, bell } = await afterFailure(refused("sync_page_limit"));
    expect(bell).toMatchObject({ state: "ok", reason: "page_limit" });
    expect(await nextSyncGap(world, fetcher)).toBe(TICK_MS);
  });

  test("anything else stops the fetcher after marking the bell (it never loops on an error)", async () => {
    for (const [failure, reason] of [
      [refused("other"), "lobby_refused"], [refused("door_not_pinned"), "lobby_refused"], [refused("hosted_refused", 409), "lobby_refused"],
      [{ kind: "failed" as const, code: "cli_unparseable" as const }, "cli_unparseable"], [{ kind: "failed" as const, code: "cli_exit" as const }, "cli_failed"],
    ] as const) {
      const { exit, bell } = await afterFailure(failure);
      expect(exit).toBe("fatal");
      expect(bell).toMatchObject({ state: "stopped", reason });
    }
    const world = makeDoorbellWorld();
    world.listener();
    const fetcher = world.fetcher();
    world.reader.tablePage = async () => ({ kind: "ok", json: { room_id: "room_x", text: CANARY } });
    expect(await fetcher.cycle()).toBe("fatal");
    expect(world.allFileText()).not.toContain(CANARY);
  });
});

describe("the pidfile", () => {
  test("one fetcher: an exclusive create, refused while the pid and start time match, reclaimed when reused or gone", async () => {
    const world = makeDoorbellWorld();
    await claimFetcherPidfile(world.doorbellHome, FETCHER, world.liveness);
    expect(readPrivateJson(fetcherPidPath(world.doorbellHome))).toMatchObject({ pid: FETCHER, started: LSTART });
    expect(await fetcherState(world.doorbellHome, world.liveness)).toEqual({ state: "running", pid: FETCHER });
    world.procs.set(OTHER, LSTART);
    await expect(claimFetcherPidfile(world.doorbellHome, OTHER, world.liveness)).rejects.toThrow("already runs");
    // The recorded pid now belongs to a different process: stale, reclaimed.
    world.procs.set(FETCHER, "Wed Oct 29 08:00:00 2026");
    expect((await fetcherState(world.doorbellHome, world.liveness)).state).toBe("stale");
    await claimFetcherPidfile(world.doorbellHome, OTHER, world.liveness);
    expect(readPrivateJson(fetcherPidPath(world.doorbellHome))).toMatchObject({ pid: OTHER });
    releaseFetcherPidfile(world.doorbellHome, FETCHER);
    expect(existsSync(fetcherPidPath(world.doorbellHome))).toBe(true);
    releaseFetcherPidfile(world.doorbellHome, OTHER);
    expect(existsSync(fetcherPidPath(world.doorbellHome))).toBe(false);
  });

  test("a stale pidfile is removed only while it still holds the record that was checked", async () => {
    const world = makeDoorbellWorld();
    const stale = { pid: FETCHER, started: "Wed Oct 29 08:00:00 2026", at: new Date(world.clock).toISOString() };
    writeFileSync(fetcherPidPath(world.doorbellHome), JSON.stringify(stale), { mode: 0o600 });
    world.procs.set(OTHER, LSTART);
    const reclaimer = 9_000_006;
    world.procs.set(reclaimer, LSTART);
    let swapped = false;
    const liveness = {
      ...world.liveness,
      alive: (pid: number) => {
        // Another process reclaims the stale pidfile while this one is checking it.
        if (pid === FETCHER && !swapped) {
          swapped = true;
          writeFileSync(fetcherPidPath(world.doorbellHome), JSON.stringify({ pid: reclaimer, started: LSTART, at: stale.at }), { mode: 0o600 });
        }
        return world.procs.has(pid);
      },
    };
    await expect(claimFetcherPidfile(world.doorbellHome, OTHER, liveness)).rejects.toThrow(`already runs as pid ${reclaimer}`);
    expect(readPrivateJson(fetcherPidPath(world.doorbellHome))).toMatchObject({ pid: reclaimer });
  });

  test("a stale listener is released only while it still holds the claim that was checked", async () => {
    const world = makeDoorbellWorld();
    const stale = world.listener();
    world.procs.delete(OWNER);
    world.procs.set(OTHER, LSTART);
    const fresh = 9_000_007;
    let swapped = false;
    const liveness = {
      ...world.liveness,
      alive: (pid: number) => {
        // Another session reclaims the stale listener while this one is checking it.
        if (pid === OWNER && !swapped) {
          swapped = true;
          world.procs.set(fresh, LSTART);
          world.listener({ seat_ref: "claude-code:6f6e6d6c-6b6a-4968-a766-656463626160", owner_pid: fresh });
        }
        return world.procs.has(pid);
      },
    };
    const mine = { ...stale, seat_ref: "claude-code:7f7e7d7c-7b7a-4978-b776-757473727170", owner_pid: OTHER, watcher_pid: null, watcher_started: null };
    const claim = await claimListener(world.doorbellHome, mine, liveness);
    expect(claim).toMatchObject({ claimed: false, holder: { owner_pid: fresh } });
    expect(readListener(world.doorbellHome, ROOM_A)).toMatchObject({ kind: "ok", listener: { owner_pid: fresh } });
  });

  test("ensureFetcher starts nothing while a fetcher runs", async () => {
    const world = makeDoorbellWorld();
    await claimFetcherPidfile(world.doorbellHome, FETCHER, world.liveness);
    const starter = { start: () => { throw new Error("must not start a second fetcher"); } };
    expect(await ensureFetcher({ home: world.doorbellHome, liveness: world.liveness, starter, argv: ["fetch"], env: {} })).toEqual({ state: "running", pid: FETCHER });
  });

  test("an unreadable pidfile is refused, never overwritten", async () => {
    const world = makeDoorbellWorld();
    writeFileSync(fetcherPidPath(world.doorbellHome), "{", { mode: 0o600 });
    await expect(claimFetcherPidfile(world.doorbellHome, FETCHER, world.liveness)).rejects.toThrow("not a valid pidfile");
  });

  test("bells and the status file validate on read; a forged bell with a text field is refused", async () => {
    const world = makeDoorbellWorld();
    world.listener();
    await world.fetcher().cycle();
    const bell = readPrivateJson(bellPath(world.doorbellHome, ROOM_A));
    expect(parseBell(bell)).not.toBeNull();
    expect(parseBell({ ...(bell as object), text: CANARY })).toBeNull();
    expect(parseBell({ ...(bell as object), state: CANARY })).toBeNull();
    expect(parseBell({ ...(bell as object), head_cursor: "01" })).toBeNull();
    expect(readFetcherStatus(world.doorbellHome)).toMatchObject({ pid: FETCHER, launch_context: "terminal", rooms: [{ state: "ok" }] });
  });
});
