/** Hermetic worlds for netcheck tests: a temporary HOME, lobby home and
 * doorbell home, a scripted fake lobby CLI, a fake fetch and a fake Mullvad.
 * Never the network, a real desk or the Keychain. All values are synthetic. */
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.js";
import type { FetchLike } from "../src/health.js";
import { runNetcheck, type NetcheckOptions, type NetcheckReport } from "../src/netcheck.js";
import { MULLVAD_PATHS, processSpawner, type RunResult, type Spawner } from "../src/run.js";

export const packageRoot = join(import.meta.dir, "..");
export const CANARY = "CANARY-7f3a-do-not-print";
export const NOW = Date.parse("2026-10-27T12:00:00.000Z");
export const ROOM_A = `room_${"a".repeat(32)}`;
export const ROOM_B = `room_${"b".repeat(32)}`;
export const DIRECTORY_MISSION = "11111111-1111-4111-8111-111111111111";
export const SEASON_MISSION = "22222222-2222-4222-8222-222222222222";
export const OLD_SEASON_MISSION = "33333333-3333-4333-8333-333333333333";
export const ORIGIN = "https://api.agenttool.dev";

export const at = (offsetSeconds: number) => new Date(NOW + offsetSeconds * 1000).toISOString();
export const HOUR = 3600;
export const DAY = 24 * HOUR;

export interface Reply {
  exit?: number;
  stdout?: unknown;
  stderr?: string;
  sleepMs?: number;
  bytes?: number;
}

export type Scenario = Record<string, Reply>;

export function grant(purpose: "directory" | "season", mission: string, expiresIn: number | null, options: { room?: string | null; accepted?: boolean } = {}) {
  return {
    grant_id: "44444444-4444-4444-8444-444444444444",
    mission_id: mission,
    purpose,
    room_id: options.room ?? null,
    actions: ["mission.read"],
    expires_at: expiresIn === null ? null : at(expiresIn),
    accepted_at: options.accepted === false ? null : at(-HOUR),
  };
}

export function fleetStatus(grants: unknown[], deskOverrides: Record<string, unknown> = {}) {
  return {
    desk: {
      fingerprint: "ab".repeat(8), identity_id: "55555555-5555-4555-8555-555555555555", signing_key_id: "66666666-6666-4666-8666-666666666666",
      display_name: CANARY, project_id: "77777777-7777-4777-8777-777777777777", origin: ORIGIN,
      directory_mission_id: DIRECTORY_MISSION, door_fingerprint: "cd".repeat(8), joined_at: at(-DAY),
      ...deskOverrides,
    },
    grants,
  };
}

export function card(room: string, options: { status?: string; seasonEndsIn?: number; mission?: string } = {}) {
  const field = (value: unknown) => ({ value, label: "verified", basis: "door_signature" });
  return {
    untrusted_data: true,
    note: CANARY,
    hall: "fleet",
    signed_by: { door_fingerprint: "cd".repeat(8), label: "verified", basis: "door_signature" },
    fields: {
      room_id: field(room), card_seq: field(3), title: field(`${CANARY} title`), purpose: field(`${CANARY} purpose`),
      tags: field([CANARY]), status: field(options.status ?? "in_play"), door: field("knock"), residency: field("fleet"), slots: field([]),
      season: field({ mission_id: options.mission ?? SEASON_MISSION, mission_digest: `sha256:${"e".repeat(64)}`, expires_at: at(options.seasonEndsIn ?? 10 * DAY) }),
      issued_at: field(at(-DAY)),
    },
    delivery: { event_id: { value: CANARY, label: "self-declared", basis: "service_metadata" } },
  };
}

export function cachedRead(room: string, syncedAgo: number | null, messages: unknown[] = []) {
  return {
    untrusted_data: true, note: CANARY, room_id: room, mission_id: SEASON_MISSION, conversation: "main", source: CANARY,
    synced_at: syncedAgo === null ? null : at(-syncedAgo),
    visibility: CANARY,
    roster: { roster_seq: 2, members: [{ display_name: CANARY, identity_id: "55555555-5555-4555-8555-555555555555" }] },
    messages, unverified: [], notices: [], other_conversations: 0,
    next_cursor: "9223372036854775807", has_more: false,
  };
}

export const readKey = (room: string) => `room read ${room} --cached --json --limit 1 --after 9223372036854775807`;

/** A desk in good health: live directory and season grants, an open season, a fresh cache, a member desk. */
export function healthyScenario(): Scenario {
  return {
    "fleet status --json": { stdout: fleetStatus([grant("directory", DIRECTORY_MISSION, 20 * HOUR), grant("season", SEASON_MISSION, 20 * HOUR, { room: ROOM_A })]) },
    "hub show --json": { exit: 1, stderr: `agenttool-lobby: hub_not_initialised: ${CANARY} this desk is not a hub\n` },
    [`fleet card ${ROOM_A} --json`]: { stdout: card(ROOM_A) },
    [readKey(ROOM_A)]: { stdout: cachedRead(ROOM_A, 300) },
  };
}

export interface FetchCall {
  url: string;
  init: RequestInit;
}

export function healthResponse(options: { status?: number; body?: string; date?: string | null } = {}): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (options.date !== null) headers.set("date", options.date ?? new Date(NOW).toUTCString());
  return new Response(options.body ?? JSON.stringify({ service: "agenttool", status: "alive", build: { revision: "038a54a4", dirty: false } }),
    { status: options.status ?? 200, headers });
}

export function fakeFetch(respond: (call: FetchCall) => Promise<Response> | Response = () => healthResponse()): FetchLike & { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return await respond({ url, init });
  }) as FetchLike & { calls: FetchCall[] };
  fn.calls = calls;
  return fn;
}

export interface World {
  root: string;
  home: string;
  stateHome: string;
  lobbyHome: string;
  doorbellHome: string;
  lobbyDir: string;
  entry: string;
  env: Record<string, string | undefined>;
  mullvad: "absent" | "allow" | "block" | "garbled" | "fails";
  mullvadCalls: number;
  scenario: Scenario;
  setScenario(scenario: Scenario): void;
  calls(): Array<{ args: string[]; env: Record<string, string> }>;
  options(extra?: Partial<NetcheckOptions>): NetcheckOptions;
  run(extra?: Partial<NetcheckOptions>): Promise<NetcheckReport>;
  cli(argv: string[], extra?: { fetchImpl?: FetchLike | null; invokedAs?: string }): Promise<{ code: number; stdout: string; stderr: string }>;
}

/** A world in which the desk exists and every probe answers healthily. */
export function makeWorld(options: { desk?: boolean } = {}): World {
  const root = mkdtempSync(join(tmpdir(), "lobby-doorbell-"));
  chmodSync(root, 0o700);
  const home = join(root, "home");
  const stateHome = join(root, "state");
  const lobbyHome = join(stateHome, "agenttool", "lobby");
  const doorbellHome = join(stateHome, "agenttool", "lobby-doorbell");
  const lobbyDir = join(root, "tools", "agenttool-lobby");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  mkdirSync(join(lobbyDir, "bin"), { recursive: true, mode: 0o700 });
  if (options.desk !== false) {
    mkdirSync(lobbyHome, { recursive: true, mode: 0o700 });
    writeFileSync(join(lobbyHome, "lobby.sqlite"), "", { mode: 0o600 });
  }
  const entry = join(lobbyDir, "bin", "agenttool-lobby.ts");
  copyFileSync(join(packageRoot, "tests", "fixtures", "fake-lobby.ts"), entry);
  chmodSync(entry, 0o700);
  writeFileSync(join(lobbyDir, "INSTALL-RECEIPT.json"), JSON.stringify({
    package: "@agenttool/lobby", installed_by: CANARY,
    source: `cambridgetcg/agenttool github/main ${"8947c8fd".padEnd(40, "0")} (synthetic), exported with git archive`,
  }));
  const world: World = {
    root, home, stateHome, lobbyHome, doorbellHome, lobbyDir, entry,
    env: { HOME: home, XDG_STATE_HOME: stateHome, LANG: "en_GB.UTF-8" },
    mullvad: "allow",
    mullvadCalls: 0,
    scenario: healthyScenario(),
    setScenario(scenario) {
      world.scenario = scenario;
      writeFileSync(join(lobbyDir, "bin", "scenario.json"), JSON.stringify(scenario));
    },
    calls() {
      const path = join(lobbyDir, "bin", "calls.jsonl");
      if (!existsSync(path)) return [];
      return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    },
    options(extra = {}) {
      return {
        env: world.env,
        fetchImpl: fakeFetch(),
        now: () => NOW,
        homeDir: home,
        lobbyEntry: entry,
        mullvadExists: (path: string) => world.mullvad !== "absent" && path === MULLVAD_PATHS[0],
        spawner: (allowedEntry: string | null): Spawner => {
          const real = processSpawner(allowedEntry);
          return {
            async run(argv, runOptions): Promise<RunResult> {
              if (!(MULLVAD_PATHS as readonly string[]).includes(argv[0]!)) return await real.run(argv, runOptions);
              world.mullvadCalls += 1;
              const base = { stderrFirstLine: "", timedOut: false, truncated: false, spawnFailed: false };
              if (world.mullvad === "fails") return { ...base, exitCode: 1, stdout: "" };
              if (world.mullvad === "garbled") return { ...base, exitCode: 0, stdout: "Local network sharing: maybe\n" };
              return { ...base, exitCode: 0, stdout: `Local network sharing setting: ${world.mullvad}\n` };
            },
          };
        },
        ...extra,
      };
    },
    run(extra = {}) {
      return runNetcheck(world.options(extra));
    },
    async cli(argv, extra = {}) {
      let stdout = "";
      let stderr = "";
      const options = world.options();
      const code = await runCli(argv, {
        stdout: (text) => { stdout += text; },
        stderr: (text) => { stderr += text; },
        env: world.env,
        fetchImpl: extra.fetchImpl === undefined ? fakeFetch() : extra.fetchImpl,
        ...(extra.invokedAs === undefined ? {} : { invokedAs: extra.invokedAs }),
        overrides: { now: options.now!, homeDir: home, spawner: options.spawner!, mullvadExists: options.mullvadExists! },
      });
      return { code, stdout, stderr };
    },
  };
  world.setScenario(world.scenario);
  return world;
}
