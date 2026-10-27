/** The fetcher: one per device, and the only doorbell process that causes
 * reads from the hosted service.
 *
 * It polls only rooms that have a live listener, with
 * `agenttool-lobby room read <room> --json --after <head> --limit 50` (one
 * sync, then a page of the cache) and, while `has_more`, cached pages that
 * cost no request. It keeps counts and cursors and drops every parsed object
 * at once: message text never reaches a file, a log, an argv or a ring.
 * It does not use `room wait`, which re-syncs every 3 s for up to 45 s and
 * cannot reach a ~60 s quiet cadence.
 *
 * Cadence per room: 3 s while active (within 180 s of an arm or of any new
 * event), then each empty poll doubles the interval up to 60 s; a new event
 * resets it. Refusals follow the spec's table: a lapsed grant is re-checked
 * locally every 60 s, a 401/403/404 holds the room until its season grant id
 * changes, 429 waits 300 s, an uncertain or failed read climbs 60 -> 120 ->
 * 300 s and is never retried at once, and anything unexpected stops the
 * fetcher after marking the bells (it never loops on an error).
 *
 * Every 3 s cycle first checks STOP, the 12 h lifetime and SIGTERM. With no
 * live listener for 120 s it exits. It never renews, sends, signs or accepts
 * anything, never restarts itself, and is never a launchd agent.
 */
import { DoorbellError } from "./errors.js";
import {
  appendLogLine, BELLS_DIRECTORY, createPrivateJson, doorbellPath, ensurePrivateDirectory, FETCHER_STATUS_FILE, readPrivateJson,
  removePrivateFile, stopPresent, writePrivateJson,
} from "./home.js";
import {
  assertValid, BELL_FORMAT, FETCHER_FORMAT, parseBell, parseFetcherStatus, ZERO,
  type Bell, type BellReason, type BellState, type Counters, type FetcherStatus, type Listener,
} from "./formats.js";
import { parseTablePage, seasonGrantIds, type CliOutcome } from "./lobby-cli.js";
import { bellPath, fetcherPidPath, listenerRooms, readBell, readListener, readPidfile, sameProcess, staleness, type LivenessDeps } from "./registry.js";
import { processStarted, type Starter } from "./run.js";

export const TICK_MS = 3_000;
export const ACTIVE_INTERVAL_MS = 3_000;
export const ACTIVE_WINDOW_MS = 180_000;
export const QUIET_CAP_MS = 60_000;
export const LIFETIME_MS = 12 * 3_600_000;
export const NO_LISTENER_EXIT_MS = 120_000;
export const LAPSED_RECHECK_MS = 60_000;
export const RATE_LIMITED_MS = 300_000;
export const UNREACHABLE_LADDER_MS = [60_000, 120_000, 300_000] as const;
/** Cached pages read after one sync before the next cycle continues (each costs no request). */
export const MAX_CACHED_PAGES = 100;

export type FetcherExit = "stopped" | "fetcher_lifetime" | "no_listeners" | "sigterm" | "fatal";

export interface TableReader {
  tablePage(roomId: string, after: string, cached: boolean): Promise<CliOutcome>;
  fleetStatus(): Promise<CliOutcome>;
}

export interface FetcherDeps {
  doorbellHome: string;
  lobbyHome: string;
  cli: TableReader;
  liveness: LivenessDeps;
  now: () => number;
  pid: number;
  launchContext: FetcherStatus["launch_context"];
}

interface RoomRuntime {
  room_id: string;
  armed_at: string;
  catching: boolean;
  head: string | null;
  base: string | null;
  counters: Counters;
  last_change: Bell["last_change"];
  seq: number;
  state: BellState;
  reason: BellReason | null;
  interval: number;
  next_at: number;
  active_until: number;
  ladder: number;
  /** After a 401/403/404: the season grant ids then; polling resumes when they change. */
  hold: string[] | null;
  last_poll_at: number | null;
  last_ok_at: number | null;
  polls: number[];
}

const iso = (ms: number) => new Date(ms).toISOString();
const add = (left: Counters, right: Counters): Counters => ({
  new: left.new + right.new, addressed: left.addressed + right.addressed, unverified: left.unverified + right.unverified,
});

type PollResult = "ok" | { fatal: BellReason; code: string | null };

export class Fetcher {
  private readonly rooms = new Map<string, RoomRuntime>();
  readonly startedAt: number;
  private lastLiveAt: number;
  private terminating = false;

  constructor(private readonly deps: FetcherDeps) {
    this.startedAt = deps.now();
    this.lastLiveAt = this.startedAt;
  }

  get expiresAt(): number {
    return this.startedAt + LIFETIME_MS;
  }

  /** SIGTERM: the next cycle check ends the loop. */
  terminate(): void {
    this.terminating = true;
  }

  private log(record: Record<string, unknown>): void {
    appendLogLine(this.deps.doorbellHome, { at: iso(this.deps.now()), act: "fetch", pid: this.deps.pid, ...record });
  }

  /** One cycle. Returns why the fetcher must exit, or null to keep going. */
  async cycle(): Promise<FetcherExit | null> {
    const now = this.deps.now();
    if (stopPresent(this.deps.lobbyHome)) return this.finish("stopped", "stopped");
    if (now - this.startedAt >= LIFETIME_MS) return this.finish("fetcher_lifetime", "fetcher_lifetime");
    if (this.terminating) return this.finish("sigterm", "fetcher_stopped");

    const live: Listener[] = [];
    for (const room of listenerRooms(this.deps.doorbellHome)) {
      const read = readListener(this.deps.doorbellHome, room);
      if (read.kind === "ok" && (await staleness(read.listener, this.deps.liveness)) === null) live.push(read.listener);
    }
    for (const room of [...this.rooms.keys()]) {
      if (!live.some((listener) => listener.room_id === room)) this.rooms.delete(room);
    }
    if (live.length === 0) {
      this.writeStatus();
      if (now - this.lastLiveAt >= NO_LISTENER_EXIT_MS) {
        this.log({ event: "exit", reason: "no_listeners" });
        return "no_listeners";
      }
      return null;
    }
    this.lastLiveAt = now;

    for (const listener of live) {
      // STOP and SIGTERM are checked before every poll, not only once per cycle.
      if (stopPresent(this.deps.lobbyHome)) return this.finish("stopped", "stopped");
      if (this.terminating) return this.finish("sigterm", "fetcher_stopped");
      const runtime = this.runtimeFor(listener, now);
      if (this.deps.now() < runtime.next_at) continue;
      const result = await this.poll(runtime);
      if (result !== "ok") {
        this.log({ event: "fatal", room_id: runtime.room_id, reason: result.fatal, code: result.code });
        this.setState(runtime, "stopped", result.fatal);
        return this.finish("fatal", "fetcher_stopped");
      }
    }
    this.writeStatus();
    return null;
  }

  private runtimeFor(listener: Listener, now: number): RoomRuntime {
    const existing = this.rooms.get(listener.room_id);
    if (existing !== undefined && existing.armed_at === listener.armed_at) return existing;
    const bell = readBell(this.deps.doorbellHome, listener.room_id);
    const sameArm = bell !== null && bell.armed_at === listener.armed_at;
    const start: RoomRuntime = {
      room_id: listener.room_id,
      armed_at: listener.armed_at,
      catching: true,
      head: null,
      base: null,
      counters: { ...ZERO },
      last_change: null,
      seq: bell?.seq ?? 0,
      state: "ok",
      reason: null,
      interval: ACTIVE_INTERVAL_MS,
      next_at: now,
      active_until: Math.max(now, Date.parse(listener.armed_at)) + ACTIVE_WINDOW_MS,
      ladder: 0,
      hold: null,
      last_poll_at: null,
      last_ok_at: null,
      polls: [],
    };
    if (sameArm && bell.head_cursor !== null && bell.base_cursor !== null) {
      // A restarted fetcher continues the arm: what arrived meanwhile still counts.
      Object.assign(start, {
        catching: false, head: bell.head_cursor, base: bell.base_cursor, last_change: bell.last_change,
        counters: { new: bell.new, addressed: bell.addressed, unverified: bell.unverified },
      });
    } else if (listener.from_cursor !== null) {
      Object.assign(start, { catching: false, head: listener.from_cursor, base: listener.from_cursor });
    }
    this.rooms.set(listener.room_id, start);
    if (!start.catching) this.writeBell(start);
    return start;
  }

  private async poll(runtime: RoomRuntime): Promise<PollResult> {
    const now = this.deps.now();
    if (runtime.hold !== null) {
      const ids = await this.grantIds(runtime.room_id);
      if (ids === null || ids.join(",") === runtime.hold.join(",")) {
        runtime.next_at = now + LAPSED_RECHECK_MS;
        return "ok";
      }
      this.log({ event: "grant_changed", room_id: runtime.room_id });
      runtime.hold = null;
    }
    runtime.polls = runtime.polls.filter((at) => now - at < 3_600_000);
    runtime.polls.push(now);
    runtime.last_poll_at = now;
    const from = runtime.head ?? "0";
    const first = await this.deps.cli.tablePage(runtime.room_id, from, false);
    if (first.kind !== "ok") return this.refused(runtime, first);
    let page = parseTablePage(first.json, runtime.room_id, from);
    if (page === null) return { fatal: "cli_unparseable", code: null };
    let counts: Counters = { new: page.new, addressed: page.addressed, unverified: page.unverified };
    let pages = 0;
    while (page.has_more && pages < MAX_CACHED_PAGES) {
      const after: string = page.next_cursor;
      const next = await this.deps.cli.tablePage(runtime.room_id, after, true);
      if (next.kind !== "ok") return this.refused(runtime, next);
      page = parseTablePage(next.json, runtime.room_id, after);
      if (page === null) return { fatal: "cli_unparseable", code: null };
      counts = add(counts, page);
      pages += 1;
    }
    // From here on only counts and cursors exist; the parsed pages are gone.
    const head = page.next_cursor;
    const more = page.has_more;
    const advanced = head !== from;
    let changed = runtime.state !== "ok" || runtime.reason !== null;
    if (runtime.catching) {
      // History never rings: the first catch-up only finds the head.
      runtime.head = head;
      if (!more) {
        runtime.catching = false;
        runtime.base = head;
        changed = true;
      }
    } else if (advanced) {
      runtime.counters = add(runtime.counters, counts);
      runtime.last_change = { from_cursor: from, to_cursor: head, ...counts };
      runtime.head = head;
      changed = true;
    }
    runtime.state = "ok";
    runtime.reason = null;
    runtime.ladder = 0;
    runtime.last_ok_at = now;
    if (advanced) runtime.active_until = now + ACTIVE_WINDOW_MS;
    runtime.interval = more || advanced || now < runtime.active_until
      ? ACTIVE_INTERVAL_MS
      : Math.min(Math.max(runtime.interval * 2, ACTIVE_INTERVAL_MS * 2), QUIET_CAP_MS);
    runtime.next_at = now + runtime.interval;
    if (changed && !runtime.catching) this.bump(runtime);
    return "ok";
  }

  private async grantIds(room: string): Promise<string[] | null> {
    const outcome = await this.deps.cli.fleetStatus();
    return outcome.kind === "ok" ? seasonGrantIds(outcome.json, room) : null;
  }

  /** The refusal table (spec section 8). Only the lobby's code and HTTP status were kept from stderr. */
  private async refused(runtime: RoomRuntime, outcome: Exclude<CliOutcome, { kind: "ok" }>): Promise<PollResult> {
    const now = this.deps.now();
    const ladder = (reason: BellReason) => {
      runtime.interval = UNREACHABLE_LADDER_MS[Math.min(runtime.ladder, UNREACHABLE_LADDER_MS.length - 1)]!;
      runtime.ladder += 1;
      runtime.next_at = now + runtime.interval;
      this.setState(runtime, "hosted-unreachable", reason);
      return "ok" as const;
    };
    if (outcome.kind === "failed") {
      if (outcome.code === "cli_timeout") return ladder("cli_timeout");
      return { fatal: outcome.code === "cli_unparseable" ? "cli_unparseable" : "cli_failed", code: outcome.code };
    }
    switch (outcome.code) {
      case "no_seat":
      case "not_seated":
        // A local refusal before any request; re-checked locally.
        runtime.interval = LAPSED_RECHECK_MS;
        runtime.next_at = now + LAPSED_RECHECK_MS;
        this.setState(runtime, "grant-lapsed", outcome.code);
        return "ok";
      case "hosted_uncertain":
      case "hosted_invalid_response":
        return ladder(outcome.code);
      case "sync_page_limit":
        runtime.interval = ACTIVE_INTERVAL_MS;
        runtime.next_at = now + ACTIVE_INTERVAL_MS;
        this.setState(runtime, "ok", "page_limit");
        return "ok";
      case "hosted_refused": {
        const status = outcome.http_status;
        if (status === 401 || status === 403 || status === 404) {
          runtime.hold = (await this.grantIds(runtime.room_id)) ?? ["unreadable"];
          runtime.interval = LAPSED_RECHECK_MS;
          runtime.next_at = now + LAPSED_RECHECK_MS;
          this.setState(runtime, "grant-lapsed", `refused_${status}`);
          return "ok";
        }
        if (status === 429) {
          runtime.interval = RATE_LIMITED_MS;
          runtime.next_at = now + RATE_LIMITED_MS;
          this.setState(runtime, "hosted-unreachable", "rate_limited");
          return "ok";
        }
        if (status !== undefined && status >= 500) return ladder("hosted_5xx");
        return { fatal: "lobby_refused", code: `hosted_refused_${status ?? "unknown"}` };
      }
      default:
        return { fatal: "lobby_refused", code: outcome.code };
    }
  }

  private setState(runtime: RoomRuntime, state: BellState, reason: BellReason | null): void {
    if (runtime.state === state && runtime.reason === reason) return;
    this.log({ event: "state", room_id: runtime.room_id, state, reason });
    runtime.state = state;
    runtime.reason = reason;
    this.bump(runtime);
  }

  private bump(runtime: RoomRuntime): void {
    runtime.seq += 1;
    this.writeBell(runtime);
  }

  private writeBell(runtime: RoomRuntime): void {
    const bell: Bell = {
      format: BELL_FORMAT,
      room_id: runtime.room_id,
      armed_at: runtime.armed_at,
      seq: runtime.seq,
      base_cursor: runtime.base,
      head_cursor: runtime.catching ? null : runtime.head,
      state: runtime.state,
      reason: runtime.reason,
      new: runtime.counters.new,
      addressed: runtime.counters.addressed,
      unverified: runtime.counters.unverified,
      last_change: runtime.last_change,
      at: iso(this.deps.now()),
      fetcher_pid: this.deps.pid,
    };
    ensurePrivateDirectory(doorbellPath(this.deps.doorbellHome, BELLS_DIRECTORY));
    writePrivateJson(bellPath(this.deps.doorbellHome, runtime.room_id), assertValid(parseBell, bell, "bell"));
  }

  /** Marks every polled room's bell stopped, so watchers ring once (except under STOP, where they ring nothing). */
  private finish(exit: FetcherExit, reason: BellReason): FetcherExit {
    this.log({ event: "exit", reason: exit });
    for (const runtime of this.rooms.values()) {
      if (runtime.state === "stopped") continue;
      runtime.state = "stopped";
      runtime.reason = reason;
      this.bump(runtime);
    }
    this.writeStatus();
    return exit;
  }

  writeStatus(): void {
    const now = this.deps.now();
    const status: FetcherStatus = {
      format: FETCHER_FORMAT,
      pid: this.deps.pid,
      started_at: iso(this.startedAt),
      expires_at: iso(this.expiresAt),
      rooms: [...this.rooms.values()].map((runtime) => ({
        room_id: runtime.room_id,
        interval_ms: runtime.interval,
        last_poll_at: runtime.last_poll_at === null ? null : iso(runtime.last_poll_at),
        last_ok_at: runtime.last_ok_at === null ? null : iso(runtime.last_ok_at),
        state: runtime.catching && runtime.state === "ok" ? "catching-up" : runtime.state,
        reason: runtime.reason,
        polls_last_hour: runtime.polls.filter((at) => now - at < 3_600_000).length,
      })),
      launch_context: this.deps.launchContext,
    };
    writePrivateJson(doorbellPath(this.deps.doorbellHome, FETCHER_STATUS_FILE), assertValid(parseFetcherStatus, status, "fetcher status"));
  }
}

// ── the process: pidfile, loop, and starting it ─────────────────────────

/** Claims fetcher.pid with an exclusive create. A pidfile whose pid is gone or reused is cleared once. */
export async function claimFetcherPidfile(home: string, pid: number, liveness: LivenessDeps): Promise<{ started: string }> {
  const started = await processStarted(liveness.spawner, pid);
  if (started === null) throw new DoorbellError("fetcher_start_unknown", "this process's start time could not be read; the fetcher does not run without a checkable pidfile");
  const path = fetcherPidPath(home);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (createPrivateJson(path, { pid, started, at: iso(liveness.now()) })) return { started };
    const current = readPidfile(path);
    if (current === "unreadable") throw new DoorbellError("fetcher_pidfile_unreadable", "fetcher.pid is not a valid pidfile; check it with agenttool-lobby-doorbell status");
    if (current !== null && (await sameProcess(liveness, current.pid, current.started)) === "same") {
      throw new DoorbellError("fetcher_running", `a fetcher already runs as pid ${current.pid}`);
    }
    removePrivateFile(path);
  }
  throw new DoorbellError("fetcher_running", "another fetcher claimed the pidfile at the same moment");
}

/** Removes fetcher.pid only while it still names this process. */
export function releaseFetcherPidfile(home: string, pid: number): void {
  const current = readPidfile(fetcherPidPath(home));
  if (current !== null && current !== "unreadable" && current.pid === pid) removePrivateFile(fetcherPidPath(home));
}

/** The fetcher's state: running (pid and start time match), stale, absent or unreadable. */
export async function fetcherState(home: string, liveness: LivenessDeps): Promise<{ state: "running" | "stale" | "absent" | "unreadable"; pid: number | null }> {
  const current = readPidfile(fetcherPidPath(home));
  if (current === null) return { state: "absent", pid: null };
  if (current === "unreadable") return { state: "unreadable", pid: null };
  return { state: (await sameProcess(liveness, current.pid, current.started)) === "same" ? "running" : "stale", pid: current.pid };
}

export interface LoopControl {
  sleep: (ms: number) => Promise<void>;
}

/** Runs cycles every TICK_MS until one says to exit. The caller holds the pidfile. */
export async function runFetcherLoop(fetcher: Fetcher, control: LoopControl): Promise<FetcherExit> {
  for (;;) {
    const exit = await fetcher.cycle();
    if (exit !== null) return exit;
    await control.sleep(TICK_MS);
  }
}

/** Starts the fetcher detached unless one runs. Returns its pid, `running` with the live one, or null when it could not start. */
export async function ensureFetcher(input: {
  home: string;
  liveness: LivenessDeps;
  starter: Starter;
  argv: readonly string[];
  env: Record<string, string>;
}): Promise<{ state: "running" | "started" | "failed"; pid: number | null }> {
  const current = await fetcherState(input.home, input.liveness);
  if (current.state === "running") return { state: "running", pid: current.pid };
  if (current.state === "unreadable") return { state: "failed", pid: null };
  const pid = input.starter.start(input.argv, input.env);
  return pid === null ? { state: "failed", pid: null } : { state: "started", pid };
}

/** Reads fetcher.json, for status. */
export function readFetcherStatus(home: string): FetcherStatus | null {
  return parseFetcherStatus(readPrivateJson(doorbellPath(home, FETCHER_STATUS_FILE)));
}
