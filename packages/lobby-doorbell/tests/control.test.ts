/** listen, unlisten, stop, resume and status through the CLI, against the fake
 * lobby CLI, a real inbox socket (a test server; the package itself never
 * listens) and real short-lived `sleep` children standing in for the watcher
 * and fetcher, so `ps` start times and SIGTERM are real. */
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.js";
import { createPrivateJson, ensurePrivateDirectory } from "../src/home.js";
import { fetcherPidPath, listenerPath, readListener } from "../src/registry.js";
import { pidAlive, type Starter } from "../src/run.js";
import { CANARY, card, makeWorld, ROOM_A, type World } from "./helpers.js";
import { LSTART } from "./doorbell-helpers.js";

const SESSION = "0f0e0d0c-0b0a-4908-8706-050403020100";
const OTHER_SESSION = "3f3e3d3c-3b3a-4938-b736-353433323130";
const children: Array<ReturnType<typeof Bun.spawn>> = [];
const servers: Server[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill();
    await child.exited;
  }
  for (const server of servers.splice(0)) await new Promise<void>((done) => server.close(() => done()));
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function sleeper(): number {
  const child = Bun.spawn(["/bin/sleep", "30"], { stdio: ["ignore", "ignore", "ignore"] });
  children.push(child);
  return child.pid;
}

async function inbox(): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), "ldb-"));
  directories.push(directory);
  const path = join(directory, `${process.pid}.sock`);
  const server = createServer((socket) => socket.resume());
  servers.push(server);
  await new Promise<void>((ready) => server.listen(path, ready));
  return path;
}

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

async function controlWorld(options: { desk?: boolean } = {}) {
  const world = makeWorld(options);
  world.setScenario({ ...world.scenario, [`fleet card ${ROOM_A} --json`]: { stdout: card(ROOM_A) } });
  const socket = await inbox();
  const started: Array<{ argv: readonly string[]; env: Record<string, string> }> = [];
  const starter: Starter = {
    start(argv, env) {
      started.push({ argv, env });
      return sleeper();
    },
  };
  const env = (extra: Record<string, string | undefined> = {}) => ({
    ...world.env, CLAUDE_CODE_MESSAGING_SOCKET: socket, CLAUDE_CODE_MESSAGING_TOKEN: "token-for-tests", CLAUDE_CODE_SESSION_ID: SESSION,
    CLAUDE_PID: String(process.pid), HTTPS_PROXY: "http://proxy.invalid", TERM_PROGRAM: "iTerm.app", ...extra,
  });
  const cli = async (argv: string[], extra: Record<string, string | undefined> = {}, confirm?: (prompt: string, word: string) => boolean | null): Promise<Run> => {
    let stdout = "";
    let stderr = "";
    const options = world.options();
    const code = await runCli(argv[0] === "listen" ? [...argv, "--lobby-entry", world.entry] : argv, {
      stdout: (text) => { stdout += text; },
      stderr: (text) => { stderr += text; },
      env: env(extra),
      fetchImpl: null,
      selfEntry: "/opt/synthetic/lobby-doorbell/bin/agenttool-lobby-doorbell.ts",
      ...(confirm === undefined ? {} : { confirm }),
      overrides: { now: options.now!, homeDir: world.home, spawner: options.spawner!, starter: () => starter },
    });
    return { code, stdout, stderr };
  };
  return { world, socket, started, cli };
}

const listenerFile = (world: World) => listenerPath(join(world.stateHome, "agenttool", "lobby-doorbell"), ROOM_A);

describe("listen", () => {
  test("claims the room, starts the watcher (with the inbox) and the fetcher (without it), from allowlisted environments", async () => {
    const { world, started, cli } = await controlWorld();
    const result = await cli(["listen", "--room", ROOM_A, "--json"]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    const out = JSON.parse(result.stdout);
    expect(out).toMatchObject({ status: "listening", room_id: ROOM_A, seat_ref: `claude-code:${SESSION}`, mode: "addressed", fetcher: { state: "started" } });
    const doorbellHome = join(world.stateHome, "agenttool", "lobby-doorbell");
    expect(statSync(doorbellHome).mode & 0o777).toBe(0o700);
    expect(statSync(listenerFile(world)).mode & 0o777).toBe(0o600);
    const listener = readListener(doorbellHome, ROOM_A);
    expect(listener).toMatchObject({ kind: "ok", listener: { owner_pid: process.pid, watcher_pid: out.watcher_pid, harness: "claude-code", from_cursor: null } });
    expect(started.map((start) => start.argv.slice(3))).toEqual([
      ["/opt/synthetic/lobby-doorbell/bin/agenttool-lobby-doorbell.ts", "watch", "--room", ROOM_A],
      ["/opt/synthetic/lobby-doorbell/bin/agenttool-lobby-doorbell.ts", "fetch"],
    ]);
    const [watcher, fetcher] = started;
    expect(Object.keys(watcher!.env).sort()).toEqual([
      "AGENTTOOL_LOBBY_DOORBELL_HOME", "AGENTTOOL_LOBBY_HOME", "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDE_PID",
      "HOME", "LANG", "PATH", "TERM_PROGRAM",
    ]);
    expect(Object.keys(fetcher!.env).sort()).toEqual(["AGENTTOOL_LOBBY_DOORBELL_HOME", "AGENTTOOL_LOBBY_HOME", "HOME", "LANG", "PATH", "TERM_PROGRAM"]);
    expect(fetcher!.env.AGENTTOOL_LOBBY_HOME).toBe(world.lobbyHome);
    expect(result.stdout).not.toContain("token-for-tests");

    const again = await cli(["listen", "--room", ROOM_A]);
    expect(again.code).toBe(0);
    expect(again.stdout).toContain("already listening");
  });

  test("one listener per room per device: another seat is refused and told who holds it; a stale holder is reclaimed", async () => {
    const { world, cli } = await controlWorld();
    expect((await cli(["listen", "--room", ROOM_A])).code).toBe(0);
    const taken = await cli(["listen", "--room", ROOM_A], { CLAUDE_CODE_SESSION_ID: OTHER_SESSION });
    expect(taken.code).toBe(1);
    expect(taken.stderr).toContain(`listener_taken: room ${ROOM_A} already has a listener on this device: claude-code:${SESSION}`);
    // The holder's watcher dies: the listener is stale and the other seat claims it.
    const doorbellHome = join(world.stateHome, "agenttool", "lobby-doorbell");
    const holder = readListener(doorbellHome, ROOM_A);
    if (holder.kind !== "ok") throw new Error("no listener");
    process.kill(holder.listener.watcher_pid!, "SIGTERM");
    for (let tries = 0; tries < 50 && pidAlive(holder.listener.watcher_pid!); tries += 1) await Bun.sleep(20);
    const reclaimed = await cli(["listen", "--room", ROOM_A], { CLAUDE_CODE_SESSION_ID: OTHER_SESSION });
    expect(reclaimed.code).toBe(0);
    expect(readListener(doorbellHome, ROOM_A)).toMatchObject({ kind: "ok", listener: { seat_ref: `claude-code:${OTHER_SESSION}` } });
  });

  test("refusals: STOP, launchd, no inbox, no desk, a room not in the cache, a bad room, the Codex harness", async () => {
    let run = await controlWorld();
    writeFileSync(join(run.world.lobbyHome, "STOP"), "stopped\n", { mode: 0o600 });
    expect((await run.cli(["listen", "--room", ROOM_A])).stderr).toContain("agenttool-lobby-doorbell: stopped:");
    run = await controlWorld();
    const launchd = await run.cli(["listen", "--room", ROOM_A], { TERM_PROGRAM: undefined, XPC_SERVICE_NAME: "com.example.agent" });
    expect([launchd.code, launchd.stderr.split(":")[1]?.trim()]).toEqual([1, "launchd_context"]);
    expect((await run.cli(["listen", "--room", ROOM_A], { CLAUDE_CODE_MESSAGING_SOCKET: undefined })).stderr).toContain("no_inbox");
    expect((await run.cli(["listen", "--room", ROOM_A], { CLAUDE_CODE_MESSAGING_SOCKET: join(run.world.root, `${process.pid}.sock`) })).stderr).toContain("no_inbox");
    expect((await run.cli(["listen", "--room", ROOM_A], { CLAUDE_CODE_SESSION_ID: undefined })).stderr).toContain("no_inbox");
    expect((await run.cli(["listen", "--room", ROOM_A, "--harness", "codex"])).stderr).toContain("harness_unsupported");
    expect((await run.cli(["listen", "--room", "room_XYZ"])).code).toBe(2);
    expect((await run.cli(["listen", "--room", ROOM_A, "--max-hours", "13"])).code).toBe(2);
    run.world.setScenario({ ...run.world.scenario, [`fleet card ${ROOM_A} --json`]: { exit: 1, stderr: `agenttool-lobby: card_not_found: ${CANARY}\n` } });
    const missing = await run.cli(["listen", "--room", ROOM_A]);
    expect(missing.stderr).toContain("room_not_in_cache");
    expect(missing.stderr).not.toContain(CANARY);
    run = await controlWorld({ desk: false });
    expect((await run.cli(["listen", "--room", ROOM_A])).stderr).toContain("no_desk");
    expect(run.started).toEqual([]);
  });
});

describe("unlisten, stop, resume and status", () => {
  test("unlisten releases only the calling seat's listener and signals its watcher", async () => {
    const { world, cli } = await controlWorld();
    await cli(["listen", "--room", ROOM_A]);
    const doorbellHome = join(world.stateHome, "agenttool", "lobby-doorbell");
    const holder = readListener(doorbellHome, ROOM_A);
    if (holder.kind !== "ok") throw new Error("no listener");
    const other = await cli(["unlisten", "--room", ROOM_A], { CLAUDE_CODE_SESSION_ID: OTHER_SESSION });
    expect(other.stderr).toContain("not_your_listener");
    expect(existsSync(listenerFile(world))).toBe(true);
    const own = await cli(["unlisten", "--room", ROOM_A]);
    expect(own.stdout).toBe("released; watcher signalled\n");
    expect(existsSync(listenerFile(world))).toBe(false);
    for (let tries = 0; tries < 50 && pidAlive(holder.listener.watcher_pid!); tries += 1) await Bun.sleep(20);
    expect(pidAlive(holder.listener.watcher_pid!)).toBe(false);
  });

  test("stop writes STOP first, then signals only processes whose start time still matches; it needs no terminal", async () => {
    const { world, cli } = await controlWorld();
    await cli(["listen", "--room", ROOM_A]);
    const doorbellHome = join(world.stateHome, "agenttool", "lobby-doorbell");
    // A pidfile naming a live process with a different start time (pid reuse) must not be signalled.
    const bystander = sleeper();
    createPrivateJson(fetcherPidPath(doorbellHome), { pid: bystander, started: LSTART, at: new Date().toISOString() });
    const result = await cli(["stop"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("STOP written; fetcher not running; 1 watcher(s) signalled");
    const stop = readFileSync(join(world.lobbyHome, "STOP"), "utf8");
    expect(stop).toMatch(new RegExp(`^stopped \\d{4}-\\d{2}-\\d{2}T[0-9:.]+Z by claude-code:${SESSION}\\n$`));
    expect(statSync(join(world.lobbyHome, "STOP")).mode & 0o777).toBe(0o600);
    await Bun.sleep(100);
    expect(pidAlive(bystander)).toBe(true);
    expect((await cli(["stop"])).stdout).toContain("STOP already present");
  });

  test("resume lifts STOP only for `resume` typed at the terminal; without one it fails closed", async () => {
    const { world, cli } = await controlWorld();
    expect((await cli(["resume"], {}, () => true)).stdout).toBe("STOP is not set\n");
    await cli(["stop"]);
    const noTty = await cli(["resume"], {}, () => null);
    expect([noTty.code, noTty.stderr.split(":")[1]?.trim()]).toEqual([1, "tty_unavailable"]);
    expect(existsSync(join(world.lobbyHome, "STOP"))).toBe(true);
    expect((await cli(["resume"], {}, () => false)).code).toBe(1);
    expect(existsSync(join(world.lobbyHome, "STOP"))).toBe(true);
    let asked = "";
    const yes = await cli(["resume"], {}, (prompt, word) => {
      asked = `${prompt}|${word}`;
      return true;
    });
    expect(yes.code).toBe(0);
    expect(asked).toContain("Type resume to remove it");
    expect(existsSync(join(world.lobbyHome, "STOP"))).toBe(false);
  });

  test("status is local and content-free", async () => {
    const { world, cli } = await controlWorld();
    expect((await cli(["status", "--json"])).stdout).toContain('"home": "absent"');
    await cli(["listen", "--room", ROOM_A]);
    const before = world.calls().length;
    const status = await cli(["status", "--json"]);
    expect(world.calls().length).toBe(before);
    const report = JSON.parse(status.stdout);
    expect(report).toMatchObject({ stop: { present: false }, home: "ok", fetcher: { state: "absent" }, listeners: [{ room_id: ROOM_A, live: true, mode: "addressed" }] });
    expect((await cli(["status"])).stdout).toContain(`listener   ${ROOM_A} addressed for claude-code:${SESSION}, live`);
    expect(status.stdout).not.toContain(CANARY);
    ensurePrivateDirectory(join(world.stateHome, "agenttool", "lobby-doorbell", "bells"));
    writeFileSync(join(world.stateHome, "agenttool", "lobby-doorbell", "bells", `${ROOM_A}.json`), JSON.stringify({ text: CANARY }), { mode: 0o600 });
    const forged = await cli(["status", "--json"]);
    expect(JSON.parse(forged.stdout).bells).toEqual([{ room_id: ROOM_A, unreadable: true }]);
    expect(forged.stdout).not.toContain(CANARY);
  });
});
