import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDoorbellHome, resolveLobbyHome } from "../src/home.js";
import {
  checkLobbyEntry, defaultLobbyEntry, LobbyCli, parseCachedRead, parseCard, parseFleetStatus, parseHubDirectory, receiptCommit,
} from "../src/lobby-cli.js";
import { binaryPresent, launchContext } from "../src/probes.js";
import { assertAllowedArgv, childEnvironment, CURSOR_AFTER_ALL, lobbyArgv, processSpawner, type Spawner } from "../src/run.js";
import { CANARY, cachedRead, card, DIRECTORY_MISSION, fleetStatus, grant, HOUR, ORIGIN, ROOM_A, SEASON_MISSION } from "./helpers.js";

const ENTRY = "/opt/synthetic/agenttool-lobby/bin/agenttool-lobby.ts";

describe("the argv allowlist", () => {
  test("only the four read commands, the Mullvad read and ps are allowed", () => {
    for (const args of [["fleet", "status", "--json"], ["hub", "show", "--json"], ["fleet", "card", ROOM_A, "--json"],
      ["room", "read", ROOM_A, "--cached", "--json", "--limit", "1", "--after", CURSOR_AFTER_ALL]]) {
      expect(() => assertAllowedArgv(lobbyArgv(ENTRY, args), ENTRY)).not.toThrow();
    }
    expect(() => assertAllowedArgv(["/usr/local/bin/mullvad", "lan", "get"], null)).not.toThrow();
    expect(() => assertAllowedArgv(["/opt/homebrew/bin/mullvad", "lan", "get"], null)).not.toThrow();
    expect(() => assertAllowedArgv(["/bin/ps", "-o", "lstart=", "-p", "4242"], null)).not.toThrow();
  });

  test("everything else is refused, including syncs, sends, shells and another entry", () => {
    const refused: string[][] = [
      lobbyArgv(ENTRY, ["room", "sync", ROOM_A]),
      lobbyArgv(ENTRY, ["room", "read", ROOM_A, "--json"]),
      lobbyArgv(ENTRY, ["room", "read", ROOM_A, "--json", "--limit", "1", "--after", CURSOR_AFTER_ALL, "--cached"]),
      lobbyArgv(ENTRY, ["room", "say", ROOM_A, "hi"]),
      lobbyArgv(ENTRY, ["fleet", "card", "room_XYZ", "--json"]),
      lobbyArgv(ENTRY, ["fleet", "status"]),
      lobbyArgv("/tmp/other.ts", ["fleet", "status", "--json"]),
      [process.execPath, ENTRY, "fleet", "status", "--json"],
      ["/bin/sh", "-c", "agenttool-lobby fleet status --json"],
      ["mullvad", "lan", "get"],
      ["/usr/local/bin/mullvad", "lan", "set", "allow"],
      ["/bin/ps", "-o", "lstart=", "-p", "1;id"],
      ["/usr/bin/security", "find-generic-password"],
    ];
    for (const argv of refused) expect(() => assertAllowedArgv(argv, ENTRY)).toThrow("not on the doorbell's allowlist");
    expect(() => assertAllowedArgv(lobbyArgv(ENTRY, ["fleet", "status", "--json"]), null)).toThrow();
  });

  test("the real spawner refuses before starting anything", async () => {
    await expect(processSpawner(ENTRY).run(["/bin/sh", "-c", "true"], { env: {}, timeoutMs: 1000, maxBytes: 10 })).rejects.toThrow("allowlist");
  });

  test("the child environment is HOME, a fixed PATH, LANG and the lobby home only", () => {
    expect(childEnvironment({ HOME: "/h", LANG: "C", PATH: "/evil", HTTPS_PROXY: "x", XDG_STATE_HOME: "/s", BUN_OPTIONS: "x" }, "/s/agenttool/lobby"))
      .toEqual({ HOME: "/h", LANG: "C", PATH: "/usr/bin:/bin", AGENTTOOL_LOBBY_HOME: "/s/agenttool/lobby" });
    expect(childEnvironment({}, null)).toEqual({ PATH: "/usr/bin:/bin" });
  });
});

describe("homes", () => {
  test("the lobby home resolves as packages/lobby/src/home.ts does", () => {
    expect(resolveLobbyHome({ AGENTTOOL_LOBBY_HOME: "/x/lobby", XDG_STATE_HOME: "/s" }, "/h")).toBe("/x/lobby");
    expect(resolveLobbyHome({ AGENTTOOL_LOBBY_HOME: "", XDG_STATE_HOME: "/s" }, "/h")).toBe("/s/agenttool/lobby");
    expect(resolveLobbyHome({ XDG_STATE_HOME: "relative" }, "/h")).toBe("/h/.local/state/agenttool/lobby");
    expect(resolveLobbyHome({ XDG_STATE_HOME: "" }, "/h")).toBe("/h/.local/state/agenttool/lobby");
    expect(() => resolveLobbyHome({ AGENTTOOL_LOBBY_HOME: "rel" }, "/h")).toThrow("absolute");
  });

  test("the doorbell home is a sibling, never inside the lobby home", () => {
    expect(resolveDoorbellHome({ XDG_STATE_HOME: "/s" }, "/s/agenttool/lobby", undefined, "/h")).toBe("/s/agenttool/lobby-doorbell");
    expect(resolveDoorbellHome({}, "/h/.local/state/agenttool/lobby", undefined, "/h")).toBe("/h/.local/state/agenttool/lobby-doorbell");
    expect(resolveDoorbellHome({ AGENTTOOL_LOBBY_DOORBELL_HOME: "/t/db" }, "/s/agenttool/lobby", undefined, "/h")).toBe("/t/db");
    expect(() => resolveDoorbellHome({}, "/s/agenttool/lobby", "/s/agenttool/lobby/db", "/h")).toThrow("inside");
    expect(() => resolveDoorbellHome({}, "/s/agenttool/lobby", "/s/agenttool", "/h")).toThrow("inside");
    expect(() => resolveDoorbellHome({}, "/s/agenttool/lobby", "relative", "/h")).toThrow("absolute");
  });

  test("the default lobby entry is the pinned install", () => {
    expect(defaultLobbyEntry("/h")).toBe("/h/.kingdom/tools/agenttool-lobby/bin/agenttool-lobby.ts");
  });
});

describe("the lobby entry file", () => {
  const tree = () => {
    const root = mkdtempSync(join(tmpdir(), "lobby-entry-"));
    const versioned = join(root, "agenttool-lobby-0123abcd");
    mkdirSync(join(versioned, "bin"), { recursive: true, mode: 0o755 });
    chmodSync(join(versioned, "bin"), 0o755);
    const entry = join(versioned, "bin", "agenttool-lobby.ts");
    writeFileSync(entry, "", { mode: 0o755 });
    chmodSync(entry, 0o755);
    symlinkSync("agenttool-lobby-0123abcd", join(root, "agenttool-lobby"));
    return { root, versioned, entry, linked: join(root, "agenttool-lobby", "bin", "agenttool-lobby.ts") };
  };

  test("a linked install passes and reports the receipt commit", () => {
    const { versioned, linked } = tree();
    writeFileSync(join(versioned, "INSTALL-RECEIPT.json"), JSON.stringify({ source: `github/main ${"ab".repeat(20)} (merge)`, installed_by: CANARY }));
    expect(checkLobbyEntry(linked)).toEqual({ state: "ok", entry: linked, commit: "ab".repeat(20) });
  });

  test("missing, relative, group-writable or in a writable directory is refused", () => {
    const { root, versioned, entry } = tree();
    expect(checkLobbyEntry(join(root, "nope.ts"))).toEqual({ state: "unknown", code: "lobby_cli_missing" });
    expect(checkLobbyEntry("relative/agenttool-lobby.ts")).toEqual({ state: "unknown", code: "lobby_cli_unsafe" });
    chmodSync(entry, 0o775);
    expect(checkLobbyEntry(entry)).toEqual({ state: "unknown", code: "lobby_cli_unsafe" });
    chmodSync(entry, 0o755);
    chmodSync(join(versioned, "bin"), 0o777);
    expect(checkLobbyEntry(entry)).toEqual({ state: "unknown", code: "lobby_cli_unsafe" });
  });

  test("a receipt with an explicit commit, none, or garbage", () => {
    const root = mkdtempSync(join(tmpdir(), "lobby-receipt-"));
    const path = join(root, "INSTALL-RECEIPT.json");
    writeFileSync(path, JSON.stringify({ commit: "cd".repeat(20) }));
    expect(receiptCommit(path)).toBe("cd".repeat(20));
    writeFileSync(path, JSON.stringify({ source: CANARY }));
    expect(receiptCommit(path)).toBeNull();
    writeFileSync(path, "{");
    expect(receiptCommit(path)).toBeNull();
    expect(receiptCommit(join(root, "absent.json"))).toBeNull();
  });
});

describe("parsers keep only validated fields", () => {
  test("fleet status", () => {
    const status = parseFleetStatus(fleetStatus([grant("directory", DIRECTORY_MISSION, HOUR), grant("season", SEASON_MISSION, null, { room: ROOM_A, accepted: false })]), ORIGIN);
    expect(status).toEqual({
      desk: { origin_matches: true, directory_mission_id: DIRECTORY_MISSION },
      grants: [
        { purpose: "directory", room_id: null, mission_id: DIRECTORY_MISSION, expires_at: expect.any(String), accepted_at: expect.any(String) },
        { purpose: "season", room_id: ROOM_A, mission_id: SEASON_MISSION, expires_at: null, accepted_at: null },
      ],
    });
    expect(JSON.stringify(status)).not.toContain(CANARY);
    expect(parseFleetStatus({ desk: null }, ORIGIN)).toEqual({ desk: null });
    expect(parseFleetStatus(fleetStatus([], { origin: "https://elsewhere.invalid" }), ORIGIN)).toMatchObject({ desk: { origin_matches: false } });
    expect(parseFleetStatus(fleetStatus([{ ...grant("season", SEASON_MISSION, HOUR), purpose: "other" }]), ORIGIN)).toBeNull();
    expect(parseFleetStatus(fleetStatus([{ ...grant("season", SEASON_MISSION, HOUR), room_id: CANARY }]), ORIGIN)).toBeNull();
    expect(parseFleetStatus(fleetStatus([{ ...grant("season", SEASON_MISSION, HOUR), expires_at: "tomorrow" }]), ORIGIN)).toBeNull();
    expect(parseFleetStatus(fleetStatus([], { directory_mission_id: CANARY }), ORIGIN)).toBeNull();
    // A grant whose mission_id is missing, renamed or not a UUID is unparseable, never a silent non-match.
    const { mission_id: _dropped, ...renamed } = grant("season", SEASON_MISSION, HOUR, { room: ROOM_A });
    expect(parseFleetStatus(fleetStatus([{ ...renamed, mission: SEASON_MISSION }]), ORIGIN)).toBeNull();
    expect(parseFleetStatus(fleetStatus([{ ...grant("directory", DIRECTORY_MISSION, HOUR), mission_id: null }]), ORIGIN)).toBeNull();
    expect(parseFleetStatus(fleetStatus([{ ...grant("directory", DIRECTORY_MISSION, HOUR), mission_id: CANARY }]), ORIGIN)).toBeNull();
    expect(parseFleetStatus([], ORIGIN)).toBeNull();
  });

  test("fleet card keeps status and season only", () => {
    const parsed = parseCard(card(ROOM_A, { status: "resting" }), ROOM_A);
    expect(Object.keys(parsed!).sort()).toEqual(["expires_at", "mission_id", "status"]);
    expect(parsed!.status).toBe("resting");
    expect(parseCard(card(ROOM_A), `room_${"c".repeat(32)}`)).toBeNull();
    expect(parseCard(card(ROOM_A, { status: CANARY }), ROOM_A)).toBeNull();
  });

  test("hub show keeps directory.expires_at only; a cached read keeps synced_at only", () => {
    expect(parseHubDirectory({ directory: { expires_at: "2026-11-26T13:18:00.000Z", mission_id: CANARY }, devices: [{ display_name: CANARY }] }))
      .toEqual({ expires_at: "2026-11-26T13:18:00.000Z" });
    expect(parseHubDirectory({ directory: { expires_at: "soon" } })).toBeNull();
    expect(parseCachedRead(cachedRead(ROOM_A, 60), ROOM_A)).toEqual({ synced_at: expect.any(String) });
    expect(parseCachedRead(cachedRead(ROOM_A, null), ROOM_A)).toEqual({ synced_at: null });
    expect(parseCachedRead(cachedRead(ROOM_A, 60, [{ text: CANARY }]), ROOM_A)).toBeNull();
  });
});

describe("CLI outcomes", () => {
  const scripted = (result: Partial<Awaited<ReturnType<Spawner["run"]>>>): Spawner => ({
    run: async () => ({ exitCode: 0, stdout: "", stderrFirstLine: "", timedOut: false, truncated: false, spawnFailed: false, ...result }),
  });
  const cli = (result: Partial<Awaited<ReturnType<Spawner["run"]>>>) => new LobbyCli(ENTRY, {}, scripted(result)).fleetStatus();

  test("refusal lines keep the code only, and only a known code", async () => {
    expect(await cli({ exitCode: 1, stderrFirstLine: `agenttool-lobby: hub_not_initialised: ${CANARY}` })).toEqual({ kind: "refused", code: "hub_not_initialised" });
    expect(await cli({ exitCode: 1, stderrFirstLine: "agenttool-lobby: invented_code: x" })).toEqual({ kind: "refused", code: "other" });
    expect(await cli({ exitCode: 1, stderrFirstLine: CANARY })).toEqual({ kind: "failed", code: "cli_unparseable" });
    expect(await cli({ exitCode: 2 })).toEqual({ kind: "failed", code: "cli_exit" });
    expect(await cli({ exitCode: null, timedOut: true })).toEqual({ kind: "failed", code: "cli_timeout" });
    expect(await cli({ exitCode: null, truncated: true })).toEqual({ kind: "failed", code: "cli_oversize" });
    expect(await cli({ exitCode: null, spawnFailed: true })).toEqual({ kind: "failed", code: "cli_spawn_failed" });
    expect(await cli({ stdout: "{\"desk\":null}" })).toEqual({ kind: "ok", json: { desk: null } });
  });
});

describe("Mullvad presence", () => {
  test("a symlinked binary counts as present, as the app bundle installs it; a dangling link or a directory does not", () => {
    const root = mkdtempSync(join(tmpdir(), "mullvad-"));
    writeFileSync(join(root, "mullvad-real"), "", { mode: 0o755 });
    symlinkSync(join(root, "mullvad-real"), join(root, "mullvad"));
    symlinkSync(join(root, "nowhere"), join(root, "dangling"));
    expect(binaryPresent(join(root, "mullvad"))).toBe(true);
    expect(binaryPresent(join(root, "dangling"))).toBe(false);
    expect(binaryPresent(root)).toBe(false);
  });
});

describe("launch context", () => {
  test("evidence table", () => {
    expect(launchContext({ SSH_CONNECTION: "synthetic", TERM_PROGRAM: "iTerm.app" })).toMatchObject({ context: "ssh", local_network_exemption: "likely" });
    expect(launchContext({ TERM_PROGRAM: "Apple_Terminal", XPC_SERVICE_NAME: "application.com.apple.Terminal.1" })).toMatchObject({ context: "terminal" });
    expect(launchContext({ TERM_PROGRAM: "iTerm.app", XPC_SERVICE_NAME: "0", CLAUDECODE: "1" })).toMatchObject({ context: "terminal", harnesses: ["claude-code"] });
    expect(launchContext({ CODEX_THREAD_ID: "synthetic" })).toMatchObject({ context: "unknown", harnesses: ["codex"], local_network_exemption: "unknown" });
    expect(launchContext({ XPC_SERVICE_NAME: "com.example.agent" })).toMatchObject({ context: "launchd", local_network_exemption: "no" });
    expect(launchContext({ XPC_SERVICE_NAME: "0" })).toMatchObject({ context: "unknown" });
    expect(launchContext({}).basis).toBe("environment evidence, not proof");
  });
});
