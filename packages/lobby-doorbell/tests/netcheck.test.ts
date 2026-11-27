import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkHealth } from "../src/health.js";
import { EXIT_CODES, formatDuration, formatReport, overallState, STATES, THRESHOLDS, WARNING_CODES } from "../src/netcheck.js";
import { childEnvironment } from "../src/run.js";
import {
  at, cachedRead, CANARY, card, DAY, DIRECTORY_MISSION, fakeFetch, fleetStatus, grant, healthResponse, healthyScenario, HOUR,
  makeWorld, NOW, OLD_SEASON_MISSION, readKey, ROOM_A, ROOM_B, SEASON_MISSION,
} from "./helpers.js";

const unreachableFetch = () => fakeFetch(() => { throw new TypeError("connection refused"); });

describe("the five states", () => {
  test("a healthy desk is hosted-ok, exit 0, with no warnings", async () => {
    const world = makeWorld();
    const report = await world.run();
    expect(report.unknown).toEqual([]);
    expect(report.state).toBe("hosted-ok");
    expect(report.healthy).toBe(true);
    expect(report.exit_code).toBe(0);
    expect(report.warnings).toEqual([]);
    expect(report.checks.rooms.map((room) => room.room_id)).toEqual([ROOM_A]);
    expect(report.checks.rooms[0]!.grant).toEqual({ state: "live", reason: null, expires_at: at(20 * HOUR), expires_in_s: 20 * HOUR });
    expect(report.checks.rooms[0]!.season).toMatchObject({ state: "open", room_status: "in_play", mission_id: SEASON_MISSION, ends_in_s: 10 * DAY });
    expect(report.checks.rooms[0]!.cache).toMatchObject({ state: "ok", age_s: 300 });
    expect(report.checks.directory).toMatchObject({ role: "member", expires_at: null, bounded_by_grant: at(20 * HOUR) });
    expect(report.checks.lobby_cli).toEqual({ state: "ok", code: null, commit: "8947c8fd".padEnd(40, "0") });
  });

  test("netcheck runs only read commands: never a sync, every room read cached and past every cursor", async () => {
    const world = makeWorld();
    await world.run({ rooms: [ROOM_A] });
    const commands = world.calls().map((call) => call.args.join(" "));
    expect(commands.sort()).toEqual(["fleet card " + ROOM_A + " --json", "fleet status --json", "hub show --json", readKey(ROOM_A)].sort());
  });

  test("hosted-unreachable wins over everything, exit 5", async () => {
    const world = makeWorld();
    world.mullvad = "block";
    world.setScenario({ ...healthyScenario(), "fleet status --json": { stdout: fleetStatus([grant("directory", DIRECTORY_MISSION, -HOUR)]) } });
    const report = await world.run({ fetchImpl: unreachableFetch() });
    expect(report.state).toBe("hosted-unreachable");
    expect(report.exit_code).toBe(5);
    expect(report.checks.hosted).toMatchObject({ status: "unreachable", code: "health_unreachable" });
  });

  test("an expired directory grant is grant-lapsed, exit 4, ahead of lan-blocked", async () => {
    const world = makeWorld();
    world.mullvad = "block";
    world.setScenario({
      ...healthyScenario(),
      "fleet status --json": { stdout: fleetStatus([grant("directory", DIRECTORY_MISSION, -60), grant("season", SEASON_MISSION, 20 * HOUR, { room: ROOM_A })]) },
    });
    const report = await world.run();
    expect(report.state).toBe("grant-lapsed");
    expect(report.exit_code).toBe(4);
    expect(report.checks.directory!.grant).toEqual({ state: "lapsed", reason: "expired", expires_at: at(-60), expires_in_s: -60 });
  });

  test("a season grant never accepted, in an open season, is grant-lapsed", async () => {
    const world = makeWorld();
    world.setScenario({
      ...healthyScenario(),
      "fleet status --json": { stdout: fleetStatus([grant("directory", DIRECTORY_MISSION, 20 * HOUR), grant("season", SEASON_MISSION, 20 * HOUR, { room: ROOM_A, accepted: false })]) },
    });
    const report = await world.run();
    expect(report.state).toBe("grant-lapsed");
    expect(report.checks.rooms[0]!.grant.reason).toBe("not_accepted");
  });

  test("a grant only for an earlier season counts as no grant in the room's current season", async () => {
    const world = makeWorld();
    world.setScenario({
      ...healthyScenario(),
      "fleet status --json": { stdout: fleetStatus([grant("directory", DIRECTORY_MISSION, 20 * HOUR), grant("season", OLD_SEASON_MISSION, 20 * HOUR, { room: ROOM_A })]) },
    });
    const report = await world.run();
    expect(report.state).toBe("grant-lapsed");
    expect(report.checks.rooms[0]!.grant).toMatchObject({ state: "lapsed", reason: "no_grant" });
  });

  test("a lapsed grant for an ended season nobody listens to does not lapse the desk", async () => {
    const world = makeWorld();
    world.setScenario({
      ...healthyScenario(),
      "fleet status --json": { stdout: fleetStatus([grant("directory", DIRECTORY_MISSION, 20 * HOUR), grant("season", SEASON_MISSION, -DAY, { room: ROOM_A })]) },
      [`fleet card ${ROOM_A} --json`]: { stdout: card(ROOM_A, { seasonEndsIn: -HOUR }) },
    });
    const report = await world.run();
    expect(report.checks.rooms[0]).toMatchObject({ counted: false, grant: { state: "lapsed" }, season: { state: "ended" } });
    expect(report.state).toBe("hosted-ok");
  });

  test("the same lapsed room is counted when asked for with --room", async () => {
    const world = makeWorld();
    world.setScenario({
      ...healthyScenario(),
      "fleet status --json": { stdout: fleetStatus([grant("directory", DIRECTORY_MISSION, 20 * HOUR), grant("season", SEASON_MISSION, -DAY, { room: ROOM_A })]) },
      [`fleet card ${ROOM_A} --json`]: { stdout: card(ROOM_A, { seasonEndsIn: -HOUR }) },
    });
    expect((await world.run({ rooms: [ROOM_A] })).state).toBe("grant-lapsed");
  });

  test("Mullvad lan=block is lan-blocked, exit 6, ahead of unknown", async () => {
    const world = makeWorld();
    world.mullvad = "block";
    world.setScenario({ ...healthyScenario(), [`fleet card ${ROOM_A} --json`]: { exit: 1, stderr: "agenttool-lobby: card_not_found: no card\n" } });
    const report = await world.run();
    expect(report.unknown).toEqual([`season:${ROOM_A}:card_not_found`]);
    expect(report.state).toBe("lan-blocked");
    expect(report.exit_code).toBe(6);
  });

  test("no Mullvad binary is reported, not an error, and counts as allow", async () => {
    const world = makeWorld();
    world.mullvad = "absent";
    const report = await world.run();
    expect(report.checks.lan).toEqual({ state: "not_installed", binary: null });
    expect(world.mullvadCalls).toBe(0);
    expect(report.state).toBe("hosted-ok");
  });
});

describe("unknown is never healthy and never exits 0", () => {
  const cases: Array<[string, (world: ReturnType<typeof makeWorld>) => void, string]> = [
    ["no desk", (world) => world.setScenario({ ...healthyScenario(), "fleet status --json": { stdout: { desk: null } } }), "desk:no_desk"],
    ["an unreadable Mullvad answer", (world) => { world.mullvad = "garbled"; }, "lan:unreadable"],
    ["a failing Mullvad", (world) => { world.mullvad = "fails"; }, "lan:unreadable"],
    ["a missing lobby CLI", (world) => { world.entry = join(world.root, "missing", "agenttool-lobby.ts"); }, "lobby_cli:lobby_cli_missing"],
    ["a group-writable lobby CLI", (world) => { chmodSync(world.entry, 0o664); }, "lobby_cli:lobby_cli_unsafe"],
    ["an origin other than the pinned one", (world) => world.setScenario({
      ...healthyScenario(), "fleet status --json": { stdout: fleetStatus([], { origin: `${CANARY}.example` }) },
    }), "desk:origin_mismatch"],
    ["a lobby code outside the known set", (world) => world.setScenario({
      ...healthyScenario(), "fleet status --json": { exit: 1, stderr: `agenttool-lobby: brand_new_code: ${CANARY}\n` },
    }), "desk:lobby_refused"],
    ["a CLI exit outside 0 and 1", (world) => world.setScenario({ ...healthyScenario(), "fleet status --json": { exit: 3 } }), "desk:cli_exit"],
    ["unparseable CLI JSON", (world) => world.setScenario({ ...healthyScenario(), "fleet status --json": { stdout: "{not json" } }), "desk:cli_unparseable"],
    ["a CLI JSON shape that drifted", (world) => world.setScenario({
      ...healthyScenario(), "fleet status --json": { stdout: { desk: { origin: "https://api.agenttool.dev", directory_mission_id: DIRECTORY_MISSION }, grant_list: [] } },
    }), "desk:cli_unparseable"],
    ["a desk that never joined the directory", (world) => world.setScenario({
      ...healthyScenario(), "fleet status --json": { stdout: fleetStatus([], { directory_mission_id: null }) },
    }), "directory_grant:not_joined"],
    ["a refusal line that is not the lobby's format", (world) => world.setScenario({ ...healthyScenario(), "fleet status --json": { exit: 1, stderr: CANARY } }), "desk:cli_unparseable"],
    ["a cached read that unexpectedly returns a message", (world) => world.setScenario({
      ...healthyScenario(), [readKey(ROOM_A)]: { stdout: cachedRead(ROOM_A, 60, [{ text: CANARY, cursor: "9", to_me: true, from_me: false }]) },
    }), `cache:${ROOM_A}:cli_unparseable`],
  ];
  for (const [name, arrange, axis] of cases) {
    test(name, async () => {
      const world = makeWorld();
      arrange(world);
      const report = await world.run({ lobbyEntry: world.entry });
      expect(report.unknown).toContain(axis);
      expect(report.state).toBe("unknown");
      expect(report.healthy).toBe(false);
      expect(report.exit_code).toBe(7);
      expect(JSON.stringify(report)).not.toContain(CANARY);
    });
  }

  test("an out-of-set lobby code is reported as `other`, never echoed", async () => {
    const world = makeWorld();
    world.setScenario({ ...healthyScenario(), "fleet status --json": { exit: 1, stderr: "agenttool-lobby: brand_new_code: x\n" } });
    expect((await world.run()).checks.desk).toEqual({ state: "unknown", code: "lobby_refused", lobby_code: "other" });
  });

  test("a CLI that hangs is stopped and reported unknown", async () => {
    const world = makeWorld();
    world.setScenario({ ...healthyScenario(), "fleet status --json": { sleepMs: 5_000 } });
    const report = await world.run({ cliTimeoutMs: 300 });
    expect(report.checks.desk.code).toBe("cli_timeout");
    expect(report.state).toBe("unknown");
  });

  test("oversized CLI output is not parsed", async () => {
    const world = makeWorld();
    world.setScenario({ ...healthyScenario(), "fleet status --json": { bytes: 1024 * 1024 + 10 } });
    expect((await world.run()).checks.desk.code).toBe("cli_oversize");
  });

  test("with no lobby home the CLI is never started and nothing is created", async () => {
    const world = makeWorld({ desk: false });
    const report = await world.run();
    expect(report.checks.desk.code).toBe("no_desk_state");
    expect(report.checks.lobby_home.state).toBe("absent");
    expect(report.state).toBe("unknown");
    expect(world.calls()).toEqual([]);
    expect(existsSync(world.lobbyHome)).toBe(false);
    expect(existsSync(world.doorbellHome)).toBe(false);
  });

  test("a lobby home holding only STOP is treated as empty: no CLI, and STOP is reported", async () => {
    const world = makeWorld({ desk: false });
    mkdirSync(world.lobbyHome, { recursive: true, mode: 0o700 });
    writeFileSync(join(world.lobbyHome, "STOP"), "stopped\n", { mode: 0o600 });
    const report = await world.run();
    expect(report.checks.lobby_home).toEqual({ state: "empty", code: null, stop_present: true });
    expect(world.calls()).toEqual([]);
    expect(readdirSync(world.lobbyHome)).toEqual(["STOP"]);
  });

  test("a lobby home holding entries but no database starts no CLI and gains nothing", async () => {
    const world = makeWorld({ desk: false });
    mkdirSync(join(world.lobbyHome, "secrets"), { recursive: true, mode: 0o700 });
    chmodSync(world.lobbyHome, 0o700);
    writeFileSync(join(world.lobbyHome, ".DS_Store"), "", { mode: 0o600 });
    const report = await world.run();
    expect(report.checks.lobby_home).toEqual({ state: "empty", code: null, stop_present: false });
    expect(report.unknown).toContain("desk:no_desk_state");
    expect(world.calls()).toEqual([]);
    expect(readdirSync(world.lobbyHome).sort()).toEqual([".DS_Store", "secrets"]);
  });

  test("a database entry that is not a regular file is unsafe, and no CLI starts", async () => {
    const world = makeWorld({ desk: false });
    mkdirSync(world.lobbyHome, { recursive: true, mode: 0o700 });
    writeFileSync(join(world.root, "elsewhere"), "", { mode: 0o600 });
    symlinkSync(join(world.root, "elsewhere"), join(world.lobbyHome, "lobby.sqlite"));
    const report = await world.run();
    expect(report.checks.lobby_home.state).toBe("unsafe");
    expect(report.unknown).toContain("desk:lobby_home_unsafe");
    expect(world.calls()).toEqual([]);
  });

  test("a relative AGENTTOOL_LOBBY_HOME is unknown, as the lobby itself refuses it", async () => {
    const world = makeWorld();
    world.env.AGENTTOOL_LOBBY_HOME = "relative/lobby";
    const report = await world.run();
    expect(report.checks.lobby_home.code).toBe("lobby_home_not_absolute");
    expect(report.state).toBe("unknown");
    expect(world.calls()).toEqual([]);
  });

  test("every state maps to its exit code, and only hosted-ok exits 0", () => {
    expect(EXIT_CODES).toEqual({ "hosted-ok": 0, "grant-lapsed": 4, "hosted-unreachable": 5, "lan-blocked": 6, unknown: 7 });
    expect(STATES.filter((state) => EXIT_CODES[state] === 0)).toEqual(["hosted-ok"]);
  });
});

describe("precedence", () => {
  const base = () => ({
    hosted: { status: "ok" as const }, directory: null, rooms: [], lan: { state: "allow" as const },
  });
  type Checks = Parameters<typeof overallState>[0];
  const state = (patch: Record<string, unknown>, unknown: string[] = []) => overallState({ ...base(), ...patch } as unknown as Checks, unknown);
  test("worst first: unreachable, lapsed, lan, unknown, ok", () => {
    const lapsedDirectory = { directory: { grant: { state: "lapsed" } } };
    expect(state({ hosted: { status: "unreachable" }, ...lapsedDirectory, lan: { state: "block" } }, ["x"])).toBe("hosted-unreachable");
    expect(state({ ...lapsedDirectory, lan: { state: "block" } }, ["x"])).toBe("grant-lapsed");
    expect(state({ lan: { state: "block" } }, ["x"])).toBe("lan-blocked");
    expect(state({}, ["x"])).toBe("unknown");
    expect(state({ hosted: { status: "unknown" } }, ["hosted:no_fetch"])).toBe("unknown");
    expect(state({})).toBe("hosted-ok");
    expect(state({ rooms: [{ counted: false, grant: { state: "lapsed" } }] })).toBe("hosted-ok");
    expect(state({ rooms: [{ counted: true, grant: { state: "lapsed" } }] })).toBe("grant-lapsed");
  });

  test("no fetch at all is unknown, not healthy", async () => {
    const world = makeWorld();
    const report = await world.run({ fetchImpl: null });
    expect(report.unknown).toEqual(["hosted:no_fetch"]);
    expect(report.state).toBe("unknown");
  });
});

describe("warnings and thresholds", () => {
  test("grant_expiring starts below 2 h, season_ending below 24 h, directory_ending below 7 d", async () => {
    const world = makeWorld();
    const scenario = (grantIn: number, seasonIn: number, directoryIn: number) => world.setScenario({
      ...healthyScenario(),
      "fleet status --json": { stdout: fleetStatus([grant("directory", DIRECTORY_MISSION, grantIn), grant("season", SEASON_MISSION, grantIn, { room: ROOM_A })]) },
      [`fleet card ${ROOM_A} --json`]: { stdout: card(ROOM_A, { seasonEndsIn: seasonIn }) },
      "hub show --json": { stdout: { project_id: CANARY, devices: [{ display_name: CANARY }], directory: { mission_id: DIRECTORY_MISSION, expires_at: at(directoryIn) } } },
    });
    scenario(THRESHOLDS.grantExpiringS, THRESHOLDS.seasonEndingS, THRESHOLDS.directoryEndingS);
    const quiet = await world.run();
    expect(quiet.warnings).toEqual([]);
    expect(quiet.checks.directory).toMatchObject({ role: "hub", expires_in_s: THRESHOLDS.directoryEndingS });
    scenario(THRESHOLDS.grantExpiringS - 1, THRESHOLDS.seasonEndingS - 1, THRESHOLDS.directoryEndingS - 1);
    const loud = await world.run();
    expect(loud.warnings).toEqual([
      { code: "grant_expiring", seconds: THRESHOLDS.grantExpiringS - 1 },
      { code: "grant_expiring", room_id: ROOM_A, seconds: THRESHOLDS.grantExpiringS - 1 },
      { code: "season_ending", room_id: ROOM_A, seconds: THRESHOLDS.seasonEndingS - 1 },
      { code: "directory_ending", seconds: THRESHOLDS.directoryEndingS - 1 },
    ]);
    expect(loud.state).toBe("hosted-ok");
  });

  test("clock skew comes from a fixed Date header: warn above 5 s, severe above 30 s", async () => {
    const world = makeWorld();
    // Request starts 100 ms before NOW and ends 100 ms after: the midpoint is NOW.
    const clock = (() => { const times = [NOW, NOW - 100, NOW + 100]; let index = 0; return () => times[Math.min(index++, 2)]!; })();
    const dated = (offset: number) => fakeFetch(() => healthResponse({ date: new Date(NOW + offset * 1000).toUTCString() }));
    const exact = await world.run({ fetchImpl: dated(5), now: clock });
    expect(exact.checks.hosted).toMatchObject({ status: "ok", skew_ms: 5000, latency_ms: 200 });
    expect(exact.warnings).toEqual([]);
    const clock2 = (() => { const times = [NOW, NOW - 100, NOW + 100]; let index = 0; return () => times[Math.min(index++, 2)]!; })();
    expect((await world.run({ fetchImpl: dated(-7), now: clock2 })).warnings).toEqual([{ code: "clock_skew", seconds: -7, severe: false }]);
    const severe = await world.run({ fetchImpl: dated(31) });
    expect(severe.warnings).toEqual([{ code: "clock_skew", seconds: 31, severe: true }]);
    expect(severe.state).toBe("hosted-ok");
  });

  test("stop_present, launch_context_not_exempt, fetcher_absent_with_listener and cache_stale", async () => {
    const world = makeWorld();
    writeFileSync(join(world.lobbyHome, "STOP"), `stopped by ${CANARY}\n`, { mode: 0o600 });
    world.env.XPC_SERVICE_NAME = "com.example.synthetic-agent";
    mkdirSync(join(world.doorbellHome, "listeners"), { recursive: true, mode: 0o700 });
    chmodSync(world.doorbellHome, 0o700);
    writeFileSync(join(world.doorbellHome, "listeners", `${ROOM_B}.json`), "{}", { mode: 0o600 });
    world.setScenario({
      ...healthyScenario(),
      [`fleet card ${ROOM_B} --json`]: { stdout: card(ROOM_B) },
      [readKey(ROOM_B)]: { stdout: cachedRead(ROOM_B, HOUR + 1) },
      "fleet status --json": { stdout: fleetStatus([grant("directory", DIRECTORY_MISSION, 20 * HOUR), grant("season", SEASON_MISSION, 20 * HOUR, { room: ROOM_A }), grant("season", SEASON_MISSION, 20 * HOUR, { room: ROOM_B })]) },
    });
    const report = await world.run();
    expect(report.warnings.map((warning) => warning.code).sort()).toEqual(
      ["cache_stale", "fetcher_absent_with_listener", "launch_context_not_exempt", "stop_present"]);
    expect(report.warnings.find((warning) => warning.code === "cache_stale")).toEqual({ code: "cache_stale", room_id: ROOM_B, seconds: HOUR + 1 });
    expect(report.checks.launch).toMatchObject({ context: "launchd", local_network_exemption: "no" });
    expect(report.state).toBe("hosted-ok");
    expect(JSON.stringify(report)).not.toContain(CANARY);
  });

  test("every warning code is in the closed set", () => {
    expect(WARNING_CODES).toEqual(["clock_skew", "grant_expiring", "season_ending", "directory_ending", "cache_stale",
      "stop_present", "fetcher_absent_with_listener", "launch_context_not_exempt"]);
  });

  test("a lapsed grant reads 'expires' while its expiry is ahead and 'expired' once it has passed", async () => {
    const world = makeWorld();
    world.setScenario({
      ...healthyScenario(),
      "fleet status --json": { stdout: fleetStatus([grant("directory", DIRECTORY_MISSION, -60), grant("season", SEASON_MISSION, 20 * HOUR, { room: ROOM_A, accepted: false })]) },
    });
    const text = formatReport(await world.run());
    expect(text).toContain("directory  grant lapsed (expired), expired 1m 0s ago;");
    expect(text).toContain("  grant    lapsed (not_accepted), expires in 20h 0m\n");
  });

  test("durations read as countdowns", () => {
    expect(formatDuration(3 * DAY + 2 * HOUR)).toBe("in 3d 2h");
    expect(formatDuration(-(HOUR + 120))).toBe("1h 2m ago");
    expect(formatDuration(59)).toBe("in 59s");
    expect(formatDuration(null)).toBe("?");
  });
});

describe("GET /health", () => {
  const run = (respond: Parameters<typeof fakeFetch>[0], extra: { timeoutMs?: number; maxBytes?: number } = {}) => {
    const fetchImpl = fakeFetch(respond);
    return { fetchImpl, result: checkHealth({ fetchImpl, now: () => NOW, ...extra }) };
  };

  test("one credential-free GET to the pinned origin: Accept only, no body, no redirect", async () => {
    const { fetchImpl, result } = run(() => healthResponse());
    expect(await result).toMatchObject({ status: "ok", code: "ok", http_status: 200, revision: "038a54a4" });
    expect(fetchImpl.calls).toHaveLength(1);
    const { url, init } = fetchImpl.calls[0]!;
    expect(url).toBe("https://api.agenttool.dev/health");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.redirect).toBe("error");
    expect(init.credentials).toBe("omit");
    const names: string[] = [];
    new Headers(init.headers).forEach((_, name) => names.push(name));
    expect(names).toEqual(["accept"]);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test("a redirect is refused by the fetch and reported unreachable", async () => {
    const { result } = run(({ init }) => {
      if (init.redirect === "error") throw new TypeError("unexpected redirect");
      return new Response(null, { status: 302, headers: { location: "https://elsewhere.invalid/" } });
    });
    expect(await result).toMatchObject({ status: "unreachable", code: "health_unreachable" });
  });

  test("a timeout is unreachable, with no retry", async () => {
    const { fetchImpl, result } = run(({ init }) => new Promise<Response>((_, reject) => {
      init.signal!.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")));
    }), { timeoutMs: 50 });
    expect(await result).toMatchObject({ status: "unreachable", code: "health_unreachable" });
    expect(fetchImpl.calls).toHaveLength(1);
  });

  test("an oversized body, a wrong body, bad JSON and a non-200 are unexpected", async () => {
    expect(await run(() => healthResponse({ body: "x".repeat(64 * 1024 + 1) })).result).toMatchObject({ code: "health_unexpected", detail: "oversize" });
    expect(await run(() => healthResponse({ body: JSON.stringify({ service: "agenttool", status: "resting" }) })).result).toMatchObject({ code: "health_unexpected", detail: "service" });
    expect(await run(() => healthResponse({ body: "<html>" })).result).toMatchObject({ code: "health_unexpected", detail: "json" });
    expect(await run(() => healthResponse({ status: 503 })).result).toMatchObject({ status: "unreachable", code: "health_unexpected", detail: "status", http_status: 503 });
  });

  test("a missing Date header leaves skew unknown without failing the check", async () => {
    expect(await run(() => healthResponse({ date: null })).result).toMatchObject({ status: "ok", skew_ms: null });
  });
});

describe("no text survives", () => {
  test("canaries in names, cards, rosters, refusals and the receipt never reach stdout, --json, the log or the doorbell home", async () => {
    const world = makeWorld();
    mkdirSync(world.doorbellHome, { recursive: true, mode: 0o700 });
    chmodSync(world.doorbellHome, 0o700);
    world.setScenario({
      ...healthyScenario(),
      [`fleet card ${ROOM_B} --json`]: { exit: 1, stderr: `agenttool-lobby: card_not_found: ${CANARY}\n` },
      [readKey(ROOM_B)]: { exit: 1, stderr: `agenttool-lobby: ${CANARY}: ${CANARY}\n` },
    });
    const human = await world.cli(["netcheck", "--room", ROOM_B, "--lobby-entry", world.entry]);
    const json = await world.cli(["netcheck", "--json", "--room", ROOM_B, "--lobby-entry", world.entry]);
    for (const output of [human.stdout, human.stderr, json.stdout, json.stderr]) expect(output).not.toContain(CANARY);
    expect(JSON.parse(json.stdout).checks.rooms.map((room: { room_id: string }) => room.room_id)).toEqual([ROOM_B, ROOM_A]);
    const files = readdirSync(world.doorbellHome);
    expect(files).toEqual(["log.jsonl"]);
    const log = readFileSync(join(world.doorbellHome, "log.jsonl"), "utf8");
    expect(log).not.toContain(CANARY);
    expect(log.trim().split("\n")).toHaveLength(2);
    expect(statSync(join(world.doorbellHome, "log.jsonl")).mode & 0o777).toBe(0o600);
    expect(Object.keys(JSON.parse(log.split("\n")[0]!)).sort()).toEqual(["act", "at", "state", "unknown", "warnings"]);
  });

  test("no log line is written when the doorbell home does not exist", async () => {
    const world = makeWorld();
    await world.run();
    expect(existsSync(world.doorbellHome)).toBe(false);
  });
});

describe("the doorbell's own files: unreadable is unknown, never healthy", () => {
  const privateHome = (world: ReturnType<typeof makeWorld>) => {
    mkdirSync(join(world.doorbellHome, "bells"), { recursive: true, mode: 0o700 });
    chmodSync(world.doorbellHome, 0o700);
  };

  test("a doorbell home open to group or others is unknown, and gets no log line", async () => {
    const world = makeWorld();
    mkdirSync(world.doorbellHome, { recursive: true, mode: 0o700 });
    chmodSync(world.doorbellHome, 0o755);
    const report = await world.run();
    expect(report.checks.doorbell.home).toBe("unsafe");
    expect(report.unknown).toEqual(["doorbell:home_unsafe"]);
    expect(report.state).toBe("unknown");
    expect(report.exit_code).toBe(7);
    expect(readdirSync(world.doorbellHome)).toEqual([]);
  });

  test("a garbled or foreign bell is unreadable and unknown; a valid bell is kept", async () => {
    const world = makeWorld();
    privateHome(world);
    writeFileSync(join(world.doorbellHome, "bells", `${ROOM_A}.json`), `{not json ${CANARY}`, { mode: 0o600 });
    const valid = (room: string) => ({
      format: "agenttool-lobby-bell/v1", room_id: room, armed_at: at(-HOUR), seq: 1, base_cursor: "3", head_cursor: "3", state: "ok", reason: null,
      new: 0, addressed: 0, unverified: 0, last_change: null, at: at(0), fetcher_pid: 4242,
    });
    writeFileSync(join(world.doorbellHome, "bells", `${ROOM_B}.json`), JSON.stringify(valid(ROOM_B)), { mode: 0o600 });
    const report = await world.run();
    expect(report.checks.doorbell.bells).toEqual([{ room_id: ROOM_A, state: "unreadable" }, { room_id: ROOM_B, state: "ok" }]);
    expect(report.unknown).toEqual(["doorbell:bell_unreadable"]);
    expect(report.state).toBe("unknown");
    // A bell filed under another room, a bare minimal one, or one carrying a text field is unreadable.
    for (const forged of [valid(ROOM_B), { format: "agenttool-lobby-bell/v1", room_id: ROOM_A, state: "ok" }, { ...valid(ROOM_A), text: CANARY }]) {
      writeFileSync(join(world.doorbellHome, "bells", `${ROOM_A}.json`), JSON.stringify(forged), { mode: 0o600 });
      expect((await world.run()).unknown).toEqual(["doorbell:bell_unreadable"]);
    }
  });

  test("a pidfile that is not JSON, or lacks a pid, is unknown", async () => {
    const world = makeWorld();
    privateHome(world);
    writeFileSync(join(world.doorbellHome, "fetcher.pid"), "12345\n", { mode: 0o600 });
    const report = await world.run();
    expect(report.checks.doorbell.fetcher).toBe("unknown");
    expect(report.unknown).toEqual(["doorbell:pidfile_unreadable"]);
    expect(report.state).toBe("unknown");
    writeFileSync(join(world.doorbellHome, "fetcher.pid"), JSON.stringify({ started: "Tue Oct 27 12:00:00 2026" }), { mode: 0o600 });
    expect((await world.run()).checks.doorbell.fetcher).toBe("unknown");
  });

  test("a pidfile is running only when /bin/ps gives the same start time; otherwise stale", async () => {
    const world = makeWorld();
    privateHome(world);
    // The real /bin/ps through the allowlisted spawner, with the environment netcheck gives it.
    const probe = Bun.spawnSync(["/bin/ps", "-o", "lstart=", "-p", String(process.pid)], { env: childEnvironment(world.env, null) });
    const started = probe.stdout.toString().trim();
    expect(started).not.toBe("");
    const pidfile = (value: string) => writeFileSync(join(world.doorbellHome, "fetcher.pid"), JSON.stringify({ pid: process.pid, started: value }), { mode: 0o600 });
    pidfile(started);
    const running = await world.run();
    expect(running.checks.doorbell.fetcher).toBe("running");
    expect(running.state).toBe("hosted-ok");
    pidfile("Thu Jan  1 00:00:00 1970");
    expect((await world.run()).checks.doorbell.fetcher).toBe("stale");
  });
});

describe("the child environment", () => {
  test("proxy, TLS-override and runtime-option variables never reach the CLI; the resolved lobby home does", async () => {
    const world = makeWorld();
    Object.assign(world.env, {
      HTTPS_PROXY: "http://proxy.invalid:1", HTTP_PROXY: "http://proxy.invalid:1", NODE_TLS_REJECT_UNAUTHORIZED: "0",
      BUN_OPTIONS: "--smol", NODE_OPTIONS: "--require=/nonexistent", SYNTHETIC_TOKEN: CANARY,
    });
    await world.run();
    const calls = world.calls();
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(Object.keys(call.env).filter((key) => !["PATH", "HOME", "LANG", "AGENTTOOL_LOBBY_HOME"].includes(key))).toEqual([]);
      expect(call.env.PATH).toBe("/usr/bin:/bin");
      expect(call.env.AGENTTOOL_LOBBY_HOME).toBe(world.lobbyHome);
    }
  });

  test("XDG_STATE_HOME decides the lobby home, and the child gets it explicitly", async () => {
    const world = makeWorld();
    expect(world.env.XDG_STATE_HOME).toBe(world.stateHome);
    await world.run();
    expect(world.calls()[0]!.env.AGENTTOOL_LOBBY_HOME).toBe(join(world.stateHome, "agenttool", "lobby"));
    expect(world.calls()[0]!.env.XDG_STATE_HOME).toBeUndefined();
  });
});

describe("the command line", () => {
  test("netcheck prints the state first and exits with its code; lobby-netcheck is the same command", async () => {
    const world = makeWorld();
    const direct = await world.cli(["netcheck", "--lobby-entry", world.entry]);
    expect(direct.code).toBe(0);
    expect(direct.stdout.split("\n")[0]).toBe("lobby-netcheck: hosted-ok");
    const alias = await world.cli(["--lobby-entry", world.entry], { invokedAs: "lobby-netcheck" });
    expect(alias.code).toBe(0);
    expect(alias.stdout.split("\n")[0]).toBe("lobby-netcheck: hosted-ok");
    const unknown = await world.cli(["netcheck", "--lobby-entry", world.entry], { fetchImpl: null });
    expect(unknown.code).toBe(7);
    expect(unknown.stdout.split("\n")[0]).toBe("lobby-netcheck: unknown (not healthy)");
  });

  test("usage errors exit 2: a bad room id, an unknown flag, a misspelt variable, a doorbell home inside the lobby home", async () => {
    const world = makeWorld();
    expect((await world.cli(["netcheck", "--room", "room_XYZ"])).code).toBe(2);
    expect((await world.cli(["netcheck", "--sync"])).code).toBe(2);
    expect((await world.cli(["renew"])).code).toBe(2);
    expect((await world.cli(["netcheck", "--home", join(world.lobbyHome, "doorbell")])).code).toBe(2);
    world.env.AGENTOOL_LOBBY_HOME = "/tmp/x";
    const misspelt = await world.cli(["netcheck"]);
    expect(misspelt.code).toBe(2);
    expect(misspelt.stderr).toContain("AGENTOOL_LOBBY_HOME is misspelt");
  });
});
