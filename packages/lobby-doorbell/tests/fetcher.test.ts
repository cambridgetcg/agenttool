import { describe, expect, spyOn, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeContext, startWatcher } from "../src/control.js";
import {
  ACTIVE_WINDOW_MS, claimFetcherPidfile, ensureFetcher, fetcherState, LIFETIME_MS, NO_LISTENER_EXIT_MS, readFetcherStatus, releaseFetcherPidfile,
  RESTART_AFTER_FATAL_MS, TICK_MS,
} from "../src/fetcher.js";
import { parseBell, type Bell } from "../src/formats.js";
import * as home from "../src/home.js";
import { readPrivateJson, writePrivateJson } from "../src/home.js";
import { handleClaudeHook } from "../src/hook.js";
import { bellPath, claimListener, fetcherPidPath, listenerPath, readBell, readListener } from "../src/registry.js";
import { RING_PATTERN } from "../src/ring.js";
import { Watcher, WATCH_TICK_MS } from "../src/watcher.js";
import { CANARY, NOW, ROOM_A, ROOM_B } from "./helpers.js";
import { fakePs, FETCHER, LSTART, makeDoorbellWorld, OTHER, OWNER, SESSION, UUID_GRANT_2, WATCHER, type DoorbellWorld } from "./doorbell-helpers.js";

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

function ringingWatcher(world: DoorbellWorld, rings: string[]) {
  return new Watcher({
    doorbellHome: world.doorbellHome, lobbyHome: world.lobbyHome, roomId: ROOM_A, pid: WATCHER,
    ring: async (text) => { rings.push(text); return { ok: true, code: null }; },
    ownerGone: () => false, now: () => world.clock,
  });
}

/** The UserPromptSubmit hook of the listening session, as Claude Code runs it. */
async function promptNotes(world: DoorbellWorld): Promise<string[]> {
  const context = makeContext({
    env: { HOME: join(world.root, "home"), XDG_STATE_HOME: join(world.root, "state"), CLAUDE_PID: String(OWNER) }, selfEntry: null,
    homeDir: join(world.root, "home"), now: () => world.clock, spawner: () => fakePs(world.procs),
    starter: () => ({ start: () => { throw new Error("a prompt note starts nothing"); } }), alive: (pid) => world.procs.has(pid),
  });
  return handleClaudeHook(context, { hook_event_name: "UserPromptSubmit", session_id: SESSION });
}

describe("stopped twice on one arm", () => {
  test("a restarted fetcher waits out 300 s after a fatal stop, then reads ok under a new seq, so a second stop rings again and asks for a person", async () => {
    const world = makeDoorbellWorld();
    world.events = history(3);
    world.listener();
    const rings: string[] = [];
    const watcher = ringingWatcher(world, rings);
    const stoppedRings = () => rings.filter((ring) => ring.includes("the fetcher stopped")).length;
    let fetcher = world.fetcher();
    await fetcher.cycle();
    await watcher.tick();
    world.failures.push({ kind: "failed", code: "cli_exit" });
    world.clock += TICK_MS;
    expect(await fetcher.cycle()).toBe("fatal");
    const stoppedAt = world.clock;
    await watcher.tick();
    expect(stoppedRings()).toBe(1);
    expect(rings[0]).toContain(`re-arm with: agenttool-lobby-doorbell listen --room ${ROOM_A}`);
    const stopped = readBell(world.doorbellHome, ROOM_A)!;
    expect(stopped).toMatchObject({ state: "stopped", reason: "cli_failed", at: new Date(stoppedAt).toISOString() });
    // The ring's advice (listen again) starts a new fetcher that continues the arm. It reads nothing until
    // 300 s after the stop, and until it reads, the bell keeps the stop's reason and time.
    world.procs.set(9_000_005, LSTART);
    fetcher = world.fetcher(9_000_005);
    const syncs = world.syncCalls();
    world.clock += TICK_MS;
    while (world.clock < stoppedAt + RESTART_AFTER_FATAL_MS) {
      expect(await fetcher.cycle()).toBeNull();
      await watcher.tick();
      world.clock += TICK_MS;
    }
    expect(world.syncCalls()).toBe(syncs);
    expect(readBell(world.doorbellHome, ROOM_A)).toEqual(stopped);
    expect(readFetcherStatus(world.doorbellHome)!.rooms).toMatchObject([{ room_id: ROOM_A, state: "stopped", reason: "cli_failed", last_poll_at: null }]);
    expect(stoppedRings()).toBe(1);
    expect(await fetcher.cycle()).toBeNull();
    expect(world.syncCalls()).toBe(syncs + 1);
    expect(readBell(world.doorbellHome, ROOM_A)).toMatchObject({ state: "ok", reason: null, seq: stopped.seq + 1, fetcher_pid: 9_000_005 });
    world.clock += WATCH_TICK_MS;
    await watcher.tick();
    // A quiet room, then the new fetcher fails too: the second stop on this arm rings, and asks for a person
    // instead of a re-arm.
    world.failures.push({ kind: "failed", code: "cli_exit" });
    world.clock += 60_000;
    expect(await fetcher.cycle()).toBe("fatal");
    world.clock += WATCH_TICK_MS;
    await watcher.tick();
    expect(stoppedRings()).toBe(2);
    expect(rings[1]).toContain("the fetcher stopped again (cli_failed). Do not re-arm; ask a person to check agenttool-lobby-doorbell status.");
    expect(rings[1]).not.toContain("listen --room");
    for (const ring of rings) expect(ring).toMatch(RING_PATTERN);
  });

  test("the hold covers every room, counts from the stop (never more than 300 s from now), and only follows a fatal stop", async () => {
    /** Room A has the given bell; room B has none. Returns when each room's first sync came, after the fetcher started. */
    const firstSyncs = async (bell: Partial<Bell>) => {
      const world = makeDoorbellWorld();
      world.events = history(3);
      world.listener();
      world.listener({ room_id: ROOM_B });
      world.bell({ seq: 4, base_cursor: "3", head_cursor: "3", ...bell });
      const fetcher = world.fetcher();
      while (world.syncCalls() === 0 && world.clock - NOW <= 2 * RESTART_AFTER_FATAL_MS) {
        await fetcher.cycle();
        world.clock += TICK_MS;
      }
      return world.calls.filter((call) => !call.cached).map((call) => call.at - NOW);
    };
    // A fatal stop 99 s before the fetcher started, on room A's bell: neither room is read until 300 s after it.
    expect(await firstSyncs({ state: "stopped", reason: "lobby_refused", at: new Date(NOW - 99_000).toISOString() })).toEqual([201_000, 201_000]);
    // A bell dated in the future holds for 300 s from now, not longer.
    expect(await firstSyncs({ state: "stopped", reason: "cli_failed", at: new Date(NOW + 3_600_000).toISOString() })).toEqual([300_000, 300_000]);
    // A fatal stop 300 s old or older, and stops that were not failures, hold nothing.
    for (const bell of [
      { state: "stopped" as const, reason: "cli_unparseable" as const, at: new Date(NOW - RESTART_AFTER_FATAL_MS).toISOString() },
      { state: "stopped" as const, reason: "fetcher_lifetime" as const },
      { state: "stopped" as const, reason: "fetcher_stopped" as const },
      { state: "stopped" as const, reason: "no_listeners" as const },
      { state: "stopped" as const, reason: "stopped" as const },
      { state: "hosted-unreachable" as const, reason: "rate_limited" as const },
    ]) expect({ bell, syncs: await firstSyncs(bell) }).toEqual({ bell, syncs: [0, 0] });
  });
});

describe("a restart carries the arm's state", () => {
  for (const [failure, state, rung] of [
    [{ kind: "refused" as const, code: "no_seat" }, "grant-lapsed", 1],
    [{ kind: "refused" as const, code: "hosted_uncertain" }, "hosted-unreachable", 0],
  ] as const) {
    test(`a ${state} room across a restart rings and notes once, even when both look between the restore and the first poll`, async () => {
      const world = makeDoorbellWorld();
      world.events = history(3);
      world.listener();
      const rings: string[] = [];
      const notes: string[] = [];
      const watcher = ringingWatcher(world, rings);
      let fetcher = world.fetcher();
      await fetcher.cycle();
      await watcher.tick();
      world.failures.push(failure);
      world.clock += 60_000;
      await fetcher.cycle();
      world.clock += WATCH_TICK_MS;
      await watcher.tick();
      notes.push(...await promptNotes(world));
      const before = readBell(world.doorbellHome, ROOM_A)!;
      expect(before).toMatchObject({ state });
      // A second fetcher continues the arm (a restart, SessionStart or a listen) while the failure lasts. Its
      // first poll is slow: the watcher and the prompt hook both read the restored bell meanwhile.
      world.procs.set(9_000_005, LSTART);
      fetcher = world.fetcher(9_000_005);
      const tablePage = world.reader.tablePage.bind(world.reader);
      let looked = false;
      world.reader.tablePage = async (room, after, cached) => {
        if (!looked) {
          looked = true;
          expect(readBell(world.doorbellHome, ROOM_A)).toMatchObject({ state, reason: before.reason, seq: before.seq + 1, fetcher_pid: 9_000_005 });
          world.clock += WATCH_TICK_MS;
          await watcher.tick();
          notes.push(...await promptNotes(world));
        }
        return tablePage(room, after, cached);
      };
      world.failures.push(failure);
      world.clock += TICK_MS;
      expect(await fetcher.cycle()).toBeNull();
      expect(looked).toBe(true);
      world.clock += WATCH_TICK_MS;
      await watcher.tick();
      notes.push(...await promptNotes(world));
      expect(rings.filter((ring) => ring.includes(state))).toHaveLength(rung);
      expect(notes.filter((note) => note.includes(state))).toHaveLength(1);
      // The failure ends: that is a transition, so the next one on this arm rings (or notes) again.
      world.clock += 120_000;
      await fetcher.cycle();
      expect(readBell(world.doorbellHome, ROOM_A)).toMatchObject({ state: "ok", reason: null });
      world.clock += WATCH_TICK_MS;
      await watcher.tick();
      notes.push(...await promptNotes(world));
      world.failures.push(failure);
      world.clock += 120_000;
      await fetcher.cycle();
      world.clock += WATCH_TICK_MS;
      await watcher.tick();
      notes.push(...await promptNotes(world));
      expect(rings.filter((ring) => ring.includes(state))).toHaveLength(2 * rung);
      expect(notes.filter((note) => note.includes(state))).toHaveLength(2);
    });
  }
});

describe("one fetcher", () => {
  test("a running fetcher whose fetcher.pid no longer names its pid and start time exits at the next cycle and touches nothing", async () => {
    const at = new Date(NOW).toISOString();
    for (const [what, change] of [
      ["another fetcher's pidfile", (world: DoorbellWorld) => writePrivateJson(fetcherPidPath(world.doorbellHome), { pid: OTHER, started: LSTART, at })],
      ["its pid with another start time", (world: DoorbellWorld) => writePrivateJson(fetcherPidPath(world.doorbellHome), { pid: FETCHER, started: "Wed Oct 29 08:00:00 2026", at })],
      ["no pidfile", (world: DoorbellWorld) => rmSync(fetcherPidPath(world.doorbellHome))],
      ["an unreadable pidfile", (world: DoorbellWorld) => writeFileSync(fetcherPidPath(world.doorbellHome), "{", { mode: 0o600 })],
    ] as const) {
      const world = makeDoorbellWorld();
      world.events = history(3);
      world.listener();
      const fetcher = world.fetcher();
      expect(await fetcher.cycle()).toBeNull();
      const bell = readFileSync(bellPath(world.doorbellHome, ROOM_A), "utf8");
      const status = readFileSync(join(world.doorbellHome, "fetcher.json"), "utf8");
      change(world);
      world.events.push({ cursor: 4, to_me: true });
      const calls = world.calls.length;
      // Not even STOP, its lifetime or SIGTERM makes it mark the bells: the fetcher holding the pidfile does.
      writeFileSync(join(world.lobbyHome, "STOP"), "stopped by a test\n", { mode: 0o600 });
      world.clock += LIFETIME_MS;
      fetcher.terminate();
      expect({ what, exit: await fetcher.cycle() }).toEqual({ what, exit: "superseded" });
      expect({ what, calls: world.calls.length }).toEqual({ what, calls });
      expect({ what, bell: readFileSync(bellPath(world.doorbellHome, ROOM_A), "utf8") }).toEqual({ what, bell });
      expect({ what, status: readFileSync(join(world.doorbellHome, "fetcher.json"), "utf8") }).toEqual({ what, status });
    }
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

  test("a stale pidfile is removed only while it still holds the record that was checked, in every field", async () => {
    const stale = { pid: FETCHER, started: "Wed Oct 29 08:00:00 2026", at: new Date(NOW).toISOString() };
    const reclaimer = 9_000_006;
    for (const [what, fresh, refusal] of [
      ["another pid and start time", { pid: reclaimer, started: LSTART, at: stale.at }, `already runs as pid ${reclaimer}`],
      // Two processes can start within the same second: the pid alone tells them apart.
      ["another pid, the same start time", { pid: reclaimer, started: stale.started, at: stale.at }, `already runs as pid ${reclaimer}`],
      ["the same pid and start time, written at another time", { ...stale, at: new Date(NOW + 1_000).toISOString() }, "at the same moment"],
    ] as const) {
      const world = makeDoorbellWorld();
      writeFileSync(fetcherPidPath(world.doorbellHome), JSON.stringify(stale), { mode: 0o600 });
      world.procs.set(OTHER, LSTART);
      if (fresh.pid === reclaimer) world.procs.set(reclaimer, fresh.started);
      let swapped = false;
      const liveness = {
        ...world.liveness,
        alive: (pid: number) => {
          // Another process reclaims the stale pidfile while this one is checking it.
          if (pid === FETCHER && !swapped) {
            swapped = true;
            writeFileSync(fetcherPidPath(world.doorbellHome), JSON.stringify(fresh), { mode: 0o600 });
          }
          return world.procs.has(pid);
        },
      };
      await expect(claimFetcherPidfile(world.doorbellHome, OTHER, liveness)).rejects.toThrow(refusal);
      if (fresh.pid === reclaimer) expect({ what, holder: readPrivateJson(fetcherPidPath(world.doorbellHome)) }).toEqual({ what, holder: fresh });
    }
  });

  test("a claim whose blocking entry vanished between the create and the read tries again, for fetcher.pid and a listener", async () => {
    const world = makeDoorbellWorld();
    const mine = world.listener({ watcher_pid: null, watcher_started: null });
    rmSync(listenerPath(world.doorbellHome, ROOM_A));
    const create = home.createPrivateJson;
    const blocked = new Set<string>();
    let creates = 0;
    // The first create of each file meets an entry that is gone again by the time the claim reads it.
    const spy = spyOn(home, "createPrivateJson").mockImplementation((path: string, value: unknown) => {
      creates += 1;
      if (blocked.has(path)) return create(path, value);
      blocked.add(path);
      return false;
    });
    try {
      expect(await claimFetcherPidfile(world.doorbellHome, FETCHER, world.liveness)).toEqual({ started: LSTART });
      expect(await claimListener(world.doorbellHome, mine, world.liveness)).toEqual({ claimed: true });
    } finally {
      spy.mockRestore();
    }
    expect(creates).toBe(4);
    expect(readPrivateJson(fetcherPidPath(world.doorbellHome))).toMatchObject({ pid: FETCHER, started: LSTART });
    expect(readListener(world.doorbellHome, ROOM_A)).toEqual({ kind: "ok", listener: mine });
  });

  test("listen records its watcher only in its own claim: a record that differs in any one claim field is another's, and stays", async () => {
    const newWatcher = 9_000_012;
    for (const [field, value] of [
      ["armed_at", new Date(NOW + 1).toISOString()],
      ["seat_ref", "claude-code:6f6e6d6c-6b6a-4968-a766-656463626160"],
      ["owner_pid", OTHER],
      ["owner_started", "Wed Oct 29 08:00:00 2026"],
      [null, null],
    ] as const) {
      const world = makeDoorbellWorld();
      const mine = world.listener({ watcher_pid: null, watcher_started: null });
      const current = field === null ? mine : { ...mine, [field]: value };
      const context = makeContext({
        env: { HOME: join(world.root, "home"), XDG_STATE_HOME: join(world.root, "state") }, selfEntry: "/opt/synthetic/lobby-doorbell/bin/agenttool-lobby-doorbell.ts",
        homeDir: join(world.root, "home"), now: () => world.clock, spawner: () => fakePs(world.procs), alive: (pid) => world.procs.has(pid),
        starter: () => ({
          start: () => {
            // Between this claim and the watcher's record, the listener file comes to hold `current`.
            writePrivateJson(listenerPath(world.doorbellHome, ROOM_A), current);
            world.procs.set(newWatcher, LSTART);
            return newWatcher;
          },
        }),
      });
      const armed = await startWatcher(context, mine);
      if (field === null) {
        expect(armed).toEqual({ ...mine, watcher_pid: newWatcher, watcher_started: LSTART });
        expect(readListener(world.doorbellHome, ROOM_A)).toEqual({ kind: "ok", listener: armed! });
      } else {
        expect({ field, armed }).toEqual({ field, armed: null });
        expect({ field, file: readListener(world.doorbellHome, ROOM_A) }).toEqual({ field, file: { kind: "ok", listener: current } });
      }
    }
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
