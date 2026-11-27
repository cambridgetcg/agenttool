/** Hermetic worlds for the fetcher, watcher, registry and hook tests: a
 * temporary lobby home and doorbell home, a scripted table (in memory), fake
 * processes known only by `ps` answers, and a fake clock. Fake pids are above
 * any real pid_max (macOS 99,998; Linux at most 4,194,304), so a signal sent
 * to one by mistake can reach no real process. All values are synthetic. */
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Fetcher, type TableReader } from "../src/fetcher.js";
import { BELL_FORMAT, LISTENER_FORMAT, type Bell, type Listener } from "../src/formats.js";
import { ensurePrivateDirectory, writePrivateJson, BELLS_DIRECTORY, LISTENERS_DIRECTORY } from "../src/home.js";
import type { CliOutcome } from "../src/lobby-cli.js";
import { bellPath, fetcherPidPath, listenerPath, type LivenessDeps } from "../src/registry.js";
import type { RunResult, Spawner } from "../src/run.js";
import { CANARY, NOW, ROOM_A } from "./helpers.js";

export const OWNER = 9_000_001;
export const WATCHER = 9_000_002;
export const OTHER = 9_000_003;
export const FETCHER = 9_000_004;
export const LSTART = "Mon Oct 27 10:00:00 2026";
export const SESSION = "0f0e0d0c-0b0a-4908-8706-050403020100";
export const SEAT = `claude-code:${SESSION}`;
export const UUID_GRANT_1 = "44444444-4444-4444-8444-444444444444";
export const UUID_GRANT_2 = "55555555-5555-4555-8555-555555555555";

export interface TableEvent {
  cursor: number;
  from_me?: boolean;
  to_me?: boolean;
  unverified?: boolean;
  notice?: boolean;
}

export interface DoorbellWorld {
  root: string;
  lobbyHome: string;
  doorbellHome: string;
  clock: number;
  procs: Map<number, string>;
  events: TableEvent[];
  /** Outcomes returned instead of a table read, first in first out. */
  failures: CliOutcome[];
  grantIds: string[];
  calls: Array<{ after: string; cached: boolean; at: number }>;
  statusCalls: number;
  spawner: Spawner;
  liveness: LivenessDeps;
  reader: TableReader;
  listener(extra?: Partial<Listener>): Listener;
  bell(extra?: Partial<Bell>): Bell;
  fetcher(pid?: number): Fetcher;
  syncCalls(): number;
  allFileText(): string;
}

export function psResult(stdout: string | null): RunResult {
  return { exitCode: stdout === null ? 1 : 0, stdout: stdout === null ? "" : `${stdout}\n`, stderrFirstLine: "", timedOut: false, truncated: false, spawnFailed: false };
}

/** Answers `ps -o lstart= -p <pid>` from a map; refuses anything else. */
export function fakePs(procs: Map<number, string>): Spawner {
  return {
    async run(argv) {
      if (argv[0] !== "/bin/ps") throw new Error(`unexpected spawn in a hermetic test: ${argv[0]}`);
      return psResult(procs.get(Number(argv[4])) ?? null);
    },
  };
}

/** One page as the lobby prints it, text and roster included (the canary), for the parser to drop. */
export function tablePageJson(room: string, events: TableEvent[], after: string, limit = 50) {
  const pending = events.filter((event) => event.cursor > Number(after)).sort((a, b) => a.cursor - b.cursor);
  const messages: unknown[] = [];
  const unverified: unknown[] = [];
  let next = after;
  let hasMore = false;
  for (let index = 0; index < pending.length; index += 1) {
    const event = pending[index]!;
    next = String(event.cursor);
    if (event.unverified) unverified.push({ event_id: CANARY, cursor: next, reason: "bad_proof", authority: "none" });
    else if (!event.notice) {
      messages.push({
        event_id: `evt-${event.cursor}`, cursor: next, conversation: "main", kind: "message", text: `${CANARY} message ${event.cursor}`,
        to_identity: CANARY, to_me: event.to_me === true, in_reply_to: null,
        from: { identity_id: CANARY, fingerprint: CANARY, role: "member", tier: "guest", current_member: true, label: "verified", basis: "door_roster_pin" },
        from_me: event.from_me === true, received_at: { value: CANARY, label: "self-declared", basis: "service_metadata" },
      });
    }
    if (messages.length + unverified.length >= limit) {
      hasMore = index + 1 < pending.length;
      break;
    }
  }
  return {
    untrusted_data: true, note: CANARY, room_id: room, mission_id: CANARY, conversation: "main", source: CANARY, synced_at: CANARY,
    visibility: CANARY, roster: { members: [{ display_name: CANARY }] }, messages, unverified, notices: [], other_conversations: 0,
    next_cursor: next, has_more: hasMore,
  };
}

export function makeDoorbellWorld(): DoorbellWorld {
  const root = mkdtempSync(join(tmpdir(), "lobby-doorbell-fetch-"));
  chmodSync(root, 0o700);
  const lobbyHome = join(root, "state", "agenttool", "lobby");
  const doorbellHome = join(root, "state", "agenttool", "lobby-doorbell");
  mkdirSync(lobbyHome, { recursive: true, mode: 0o700 });
  ensurePrivateDirectory(join(doorbellHome, LISTENERS_DIRECTORY));
  ensurePrivateDirectory(join(doorbellHome, BELLS_DIRECTORY));
  const procs = new Map<number, string>([[OWNER, LSTART], [WATCHER, LSTART], [FETCHER, LSTART]]);
  const world: DoorbellWorld = {
    root, lobbyHome, doorbellHome, clock: NOW, procs,
    events: [], failures: [], grantIds: [UUID_GRANT_1], calls: [], statusCalls: 0,
    spawner: fakePs(procs),
    liveness: { spawner: fakePs(procs), now: () => world.clock, alive: (pid) => procs.has(pid) },
    reader: {
      async tablePage(room, after, cached) {
        world.calls.push({ after, cached, at: world.clock });
        if (!cached && world.failures.length > 0) return world.failures.shift()!;
        return { kind: "ok", json: tablePageJson(room, world.events, after) };
      },
      async fleetStatus() {
        world.statusCalls += 1;
        return { kind: "ok", json: { desk: { display_name: CANARY }, grants: world.grantIds.map((id) => ({ grant_id: id, purpose: "season", room_id: ROOM_A, mission_id: CANARY })) } };
      },
    },
    listener(extra = {}) {
      const armed = new Date(world.clock).toISOString();
      const listener: Listener = {
        format: LISTENER_FORMAT, room_id: ROOM_A, seat_ref: SEAT, harness: "claude-code", mode: "addressed",
        owner_pid: OWNER, owner_started: LSTART, watcher_pid: WATCHER, watcher_started: LSTART,
        armed_at: armed, expires_at: new Date(world.clock + 12 * 3_600_000).toISOString(), from_cursor: null, ...extra,
      };
      writePrivateJson(listenerPath(doorbellHome, listener.room_id), listener);
      return listener;
    },
    bell(extra = {}) {
      const bell: Bell = {
        format: BELL_FORMAT, room_id: ROOM_A, armed_at: new Date(NOW).toISOString(), seq: 1, base_cursor: "10", head_cursor: "10",
        state: "ok", reason: null, new: 0, addressed: 0, unverified: 0, last_change: null, at: new Date(world.clock).toISOString(),
        fetcher_pid: FETCHER, ...extra,
      };
      writePrivateJson(bellPath(doorbellHome, bell.room_id), bell);
      return bell;
    },
    fetcher(pid = FETCHER) {
      // As fetchCommand does after claimFetcherPidfile: the pidfile names this fetcher (a later one replaces it).
      writePrivateJson(fetcherPidPath(doorbellHome), { pid, started: LSTART, at: new Date(world.clock).toISOString() });
      return new Fetcher({
        doorbellHome, lobbyHome, cli: world.reader, liveness: world.liveness, now: () => world.clock, pid, started: LSTART, launchContext: "terminal",
      });
    },
    syncCalls() {
      return world.calls.filter((call) => !call.cached).length;
    },
    allFileText() {
      const walk = (directory: string): string[] => readdirSync(directory).flatMap((name) => {
        const path = join(directory, name);
        return statSync(path).isDirectory() ? walk(path) : [readFileSync(path, "utf8")];
      });
      return walk(join(root, "state")).join("\n");
    },
  };
  return world;
}
