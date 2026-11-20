/** End to end, with real processes: `listen` (run as the CLI) starts a real
 * detached fetcher and watcher; the fetcher reads the fake lobby CLI; an
 * addressed message rings a test inbox socket exactly once, content-free;
 * `stop` ends both. Hermetic: temporary homes, the fake lobby, no network. */
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RING_PATTERN } from "../src/ring.js";
import { pidAlive } from "../src/run.js";
import { CANARY, card, packageRoot, ROOM_A } from "./helpers.js";
import { tablePageJson, type TableEvent } from "./doorbell-helpers.js";

const BIN = join(packageRoot, "bin", "agenttool-lobby-doorbell.ts");
const SESSION = "0f0e0d0c-0b0a-4908-8706-050403020100";
const TOKEN = "inbox-token-for-tests";
const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function until(condition: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await Bun.sleep(100);
  }
}

describe("end to end", () => {
  test("an addressed message rings the listening session once, with no text; stop ends the fetcher and the watcher", async () => {
    const root = mkdtempSync(join(tmpdir(), "lobby-doorbell-e2e-"));
    chmodSync(root, 0o700);
    const home = join(root, "home");
    const stateHome = join(root, "state");
    const lobbyHome = join(stateHome, "agenttool", "lobby");
    const doorbellHome = join(stateHome, "agenttool", "lobby-doorbell");
    const lobbyBin = join(home, ".kingdom", "tools", "agenttool-lobby", "bin");
    mkdirSync(lobbyBin, { recursive: true, mode: 0o700 });
    mkdirSync(lobbyHome, { recursive: true, mode: 0o700 });
    writeFileSync(join(lobbyHome, "lobby.sqlite"), "", { mode: 0o600 });
    copyFileSync(join(packageRoot, "tests", "fixtures", "fake-lobby.ts"), join(lobbyBin, "agenttool-lobby.ts"));
    chmodSync(join(lobbyBin, "agenttool-lobby.ts"), 0o700);
    // Atomic, so the fake lobby never reads a half-written scenario.
    const scenario = (events: TableEvent[], heads: string[]) => {
      const replies: Record<string, unknown> = { [`fleet card ${ROOM_A} --json`]: { stdout: card(ROOM_A) } };
      for (const after of ["0", ...heads]) {
        for (const cached of [false, true]) {
          replies[`room read ${ROOM_A}${cached ? " --cached" : ""} --json --after ${after} --limit 50`] = { stdout: tablePageJson(ROOM_A, events, after) };
        }
      }
      writeFileSync(join(lobbyBin, "scenario.tmp"), JSON.stringify(replies));
      renameSync(join(lobbyBin, "scenario.tmp"), join(lobbyBin, "scenario.json"));
    };
    const historyEvents: TableEvent[] = [{ cursor: 1, to_me: true }, { cursor: 2, from_me: true }, { cursor: 3 }];
    scenario(historyEvents, ["3"]);

    const socketDirectory = mkdtempSync(join(tmpdir(), "ldb-"));
    const socket = join(socketDirectory, `${process.pid}.sock`);
    const connections: string[][] = [];
    const server: Server = createServer((connection) => {
      let buffer = "";
      connection.on("data", (chunk) => { buffer += chunk; });
      connection.on("end", () => connections.push(buffer.split("\n").filter(Boolean)));
    });
    await new Promise<void>((ready) => server.listen(socket, ready));
    cleanups.push(() => new Promise<void>((done) => server.close(() => done())), () => rmSync(socketDirectory, { recursive: true, force: true }));
    // Whatever happens, brake and stop the detached children.
    cleanups.push(async () => {
      if (!existsSync(lobbyHome) || existsSync(join(lobbyHome, "STOP"))) return;
      writeFileSync(join(lobbyHome, "STOP"), "stopped by the test cleanup\n", { mode: 0o600 });
      await Bun.sleep(3_500);
      rmSync(root, { recursive: true, force: true });
    });

    const env = {
      HOME: home, XDG_STATE_HOME: stateHome, PATH: "/usr/bin:/bin", LANG: "en_GB.UTF-8", TERM_PROGRAM: "iTerm.app",
      CLAUDE_CODE_MESSAGING_SOCKET: socket, CLAUDE_CODE_MESSAGING_TOKEN: TOKEN, CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_PID: String(process.pid),
      HTTPS_PROXY: "http://proxy.invalid", NODE_OPTIONS: "--inspect",
    };
    const cli = (args: string[]) => {
      const result = Bun.spawnSync([process.execPath, "--no-env-file", BIN, ...args], { env, cwd: root, stdout: "pipe", stderr: "pipe" });
      return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
    };

    const listened = cli(["listen", "--room", ROOM_A, "--json"]);
    expect(listened.stderr).toBe("");
    expect(listened.code).toBe(0);
    const out = JSON.parse(listened.stdout);
    expect(out).toMatchObject({ status: "listening", fetcher: { state: "started" } });
    const bellFile = join(doorbellHome, "bells", `${ROOM_A}.json`);
    await until(() => existsSync(bellFile) && JSON.parse(readFileSync(bellFile, "utf8")).head_cursor === "3", 15_000);
    const fetcherPid = JSON.parse(readFileSync(join(doorbellHome, "fetcher.pid"), "utf8")).pid as number;
    expect(pidAlive(fetcherPid)).toBe(true);
    expect(pidAlive(out.watcher_pid)).toBe(true);
    // History never rings.
    await Bun.sleep(3_000);
    expect(connections).toEqual([]);

    // Talk not addressed to this desk does not ring an `addressed` listener; one addressed message does, once.
    scenario([...historyEvents, { cursor: 4 }], ["3", "4"]);
    await until(() => JSON.parse(readFileSync(bellFile, "utf8")).head_cursor === "4", 15_000);
    await Bun.sleep(2_500);
    expect(connections).toEqual([]);
    scenario([...historyEvents, { cursor: 4 }, { cursor: 5, to_me: true }], ["3", "4", "5"]);
    await until(() => connections.length === 1, 15_000);
    const [auth, line] = connections[0]!;
    expect(JSON.parse(auth!)).toEqual({ type: "auth", token: TOKEN });
    const content = JSON.parse(line!).message.content as string;
    expect(content).toMatch(RING_PATTERN);
    expect(content).toContain(`2 new table message(s) after cursor 3 (head 5), 1 addressed to this desk`);
    expect(content).not.toContain(TOKEN);
    expect(line).not.toContain(CANARY);
    await Bun.sleep(4_000);
    expect(connections).toHaveLength(1);

    const status = cli(["status", "--json"]);
    expect(JSON.parse(status.stdout)).toMatchObject({ fetcher: { state: "running", pid: fetcherPid }, listeners: [{ room_id: ROOM_A, live: true }] });

    const stopped = cli(["stop"]);
    expect(stopped.code).toBe(0);
    expect(stopped.stdout).toContain("fetcher signalled; 1 watcher(s) signalled");
    await until(() => !pidAlive(fetcherPid) && !pidAlive(out.watcher_pid), 10_000);
    expect(existsSync(join(doorbellHome, "fetcher.pid"))).toBe(false);
    expect(connections).toHaveLength(1);

    // No message text, display name or roster entry anywhere the doorbell writes.
    const files = (directory: string): string[] => readdirSync(directory).flatMap((name) => {
      const path = join(directory, name);
      return statSync(path).isDirectory() ? files(path) : [path];
    });
    for (const path of files(stateHome)) expect({ path, canary: readFileSync(path, "utf8").includes(CANARY) }).toEqual({ path, canary: false });
    // The lobby CLI child saw only the allowlisted environment.
    const calls = readFileSync(join(lobbyBin, "calls.jsonl"), "utf8").trim().split("\n").map((entry) => JSON.parse(entry));
    expect(calls.length).toBeGreaterThan(2);
    for (const call of calls) {
      expect(Object.keys(call.env).filter((name) => !name.startsWith("__CF") && name !== "PWD" && name !== "SHLVL" && name !== "_").sort())
        .toEqual(["AGENTTOOL_LOBBY_HOME", "HOME", "LANG", "PATH"]);
    }
    rmSync(root, { recursive: true, force: true });
  }, 90_000);
});
