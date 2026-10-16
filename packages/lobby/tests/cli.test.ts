import { afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXIT_NOT_CONFIRMED, EXIT_OK, EXIT_REFUSED, EXIT_USAGE, runCli } from "../src/cli.js";
import { LobbyStore } from "../src/store.js";
import { confirmOnTty } from "../src/tty.js";
import { cleanupTempHomes, fakePublicKey, fakeTerminal, packageRoot, tempHome, type FakeTerminal } from "./helpers.js";

afterEach(cleanupTempHomes);

function desk(answers: Array<string | null> = []) {
  const { home } = tempHome();
  const terminal = fakeTerminal(answers);
  const out: string[] = [];
  const err: string[] = [];
  const run = async (...argv: string[]) => {
    out.length = 0;
    err.length = 0;
    const code = await runCli(argv, {
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
      env: { AGENTTOOL_LOBBY_HOME: home },
      confirm: (request) => confirmOnTty(request, { openTty: terminal.open }),
    });
    return { code, stdout: out.join(""), stderr: err.join("") };
  };
  return { home, terminal, run };
}

async function addRoom(run: ReturnType<typeof desk>["run"], ...extra: string[]): Promise<string> {
  const result = await run("room", "add", "--title", "Zerone season 1", "--json", ...extra);
  expect(result.code).toBe(EXIT_OK);
  return JSON.parse(result.stdout).card.room_id;
}

function shownBytes(terminal: FakeTerminal): string {
  const lines = terminal.written.join("").split("\n");
  const header = lines.findIndex((line) => line.startsWith("exact bytes ("));
  return lines[header + 1]!;
}

describe("ordinary room commands", () => {
  test("add, list, show, set-status and link", async () => {
    const { run, terminal } = desk();
    const roomId = await addRoom(
      run,
      "--purpose", "hello, reply and read_ack",
      "--tag", "zerone",
      "--tag", "season-1",
      "--door", "knock",
      "--slot", "code reviewer:player:2",
      "--slot", "watcher:spectator:3",
    );
    expect(roomId).toMatch(/^room_[0-9a-f]{32}$/);

    const listed = await run("room", "list");
    expect(listed.stdout).toBe(`${roomId}  recruiting  device/private  door=knock  "Zerone season 1"\n`);
    expect((await run("room", "list", "--tag", "nope")).stdout).toBe("(no rooms)\n");
    expect(JSON.parse((await run("room", "list", "--tier", "spectator", "--json")).stdout).rooms).toHaveLength(1);

    const shown = JSON.parse((await run("room", "show", roomId, "--json")).stdout);
    expect(shown.card.slots).toEqual([
      { label: "code reviewer", tier: "player", count: 2 },
      { label: "watcher", tier: "spectator", count: 3 },
    ]);
    expect(shown).toMatchObject({ device_pinned: false, ledger: "not linked" });

    expect((await run("room", "set-status", roomId, "in_play")).stdout).toContain("in_play");
    expect((await run("room", "link", roomId, "/srv/example/workspace")).stdout)
      .toBe(`linked ${roomId} to a path in the private ledger (this device only)\n`);
    expect((await run("room", "link", roomId)).stdout).toStartWith("path  /srv/example/workspace  linked ");
    expect((await run("room", "show", roomId)).stdout).toContain("ledger:       linked (path)");
    expect(terminal.opened).toBe(0);
  });

  test("Betfair rooms are reported as pinned to this device", async () => {
    const { run } = desk();
    const added = await run("room", "add", "--title", "Exchange research", "--purpose", "Betfair stream notes");
    expect(added.code).toBe(EXIT_OK);
    expect(added.stdout).toContain("pinned to this device");
  });

  test("usage errors exit 2 and refusals exit 1", async () => {
    const { run } = desk();
    expect((await run()).code).toBe(EXIT_USAGE);
    expect((await run("room", "add")).code).toBe(EXIT_USAGE);
    expect((await run("room", "add", "--title", "x", "--unknown")).code).toBe(EXIT_USAGE);
    expect((await run("room", "add", "--title", "x", "--status", "online")).code).toBe(EXIT_USAGE);
    expect((await run("room", "add", "--title", "x", "--slot", "nope")).code).toBe(EXIT_USAGE);
    expect((await run("room", "dance")).code).toBe(EXIT_USAGE);
    const refused = await run("room", "add", "--title", "x", "--tag", "Not_A_Tag");
    expect(refused.code).toBe(EXIT_REFUSED);
    expect(refused.stderr).toContain("invalid_tags");
    expect((await run("room", "show", "ws_0000000000000000deadbeef")).code).toBe(EXIT_REFUSED);
    expect((await run("help")).code).toBe(EXIT_OK);
  });
});

describe("consequential acts confirm the exact bytes on the terminal", () => {
  test("promote with yes records the shown bytes in the audit log", async () => {
    const { home, run, terminal } = desk(["yes"]);
    const roomId = await addRoom(run);
    const promoted = await run("room", "promote", roomId, "--residency", "fleet");
    expect(promoted.code).toBe(EXIT_OK);
    expect(promoted.stdout).toContain(`${roomId}  recruiting  fleet/private`);
    expect(promoted.stdout).toContain("audit: recorded room.promote sha256 ");
    expect(terminal.opened).toBe(1);

    const store = LobbyStore.open(home);
    const [entry] = store.listAudit();
    expect(entry?.act).toBe("room.promote");
    expect(entry?.bytes).toBe(shownBytes(terminal));
    expect(store.getRoom(roomId)?.residency).toBe("fleet");
    store.close();
    expect(JSON.parse((await run("audit", "list", "--json")).stdout).entries).toHaveLength(1);
    expect((await run("audit", "verify")).stdout).toBe("audit chain intact (1 entries)\n");
  });

  test("promote with anything else writes nothing", async () => {
    const { home, run } = desk(["no"]);
    const roomId = await addRoom(run);
    const declined = await run("room", "promote", roomId, "--residency", "fleet");
    expect(declined.code).toBe(EXIT_NOT_CONFIRMED);
    expect(declined.stderr).toContain("nothing was written");
    const store = LobbyStore.open(home);
    expect(store.getRoom(roomId)?.residency).toBe("device");
    expect(store.listAudit()).toEqual([]);
    store.close();
  });

  test("a device-pinned room is refused before the terminal is opened", async () => {
    const { run, terminal } = desk(["yes"]);
    const roomId = await addRoom(run, "--house-rules", "BetAngel desk only");
    const refused = await run("room", "promote", roomId, "--residency", "fleet");
    expect(refused.code).toBe(EXIT_REFUSED);
    expect(refused.stderr).toContain("device_pinned");
    expect(terminal.opened).toBe(0);
  });

  test("pin add, list and remove; fingerprints come before names", async () => {
    const { run, terminal } = desk(["yes", "yes"]);
    const added = await run(
      "pin", "add",
      "--did", "did:key:z6MkExampleOnlyNotARealKey",
      "--kid", "key-1",
      "--public-key", fakePublicKey(9),
      "--petname", "studio desk",
      "--how", "read aloud in person",
    );
    expect(added.code).toBe(EXIT_OK);
    expect(JSON.parse(shownBytes(terminal))).toMatchObject({ act: "pin.add", pin: { petname: "studio desk" } });
    const listed = (await run("pin", "list")).stdout;
    const fingerprint = listed.slice(0, 16);
    expect(fingerprint).toMatch(/^[0-9a-f]{16}$/);
    expect(listed.indexOf(fingerprint)).toBeLessThan(listed.indexOf("studio desk"));
    expect(listed.indexOf("did:key:")).toBeLessThan(listed.indexOf("studio desk"));

    const removed = await run("pin", "remove", fingerprint);
    expect(removed.code).toBe(EXIT_OK);
    expect((await run("pin", "list")).stdout).toBe("(no pins)\n");
    const acts = JSON.parse((await run("audit", "list", "--json")).stdout).entries.map((entry: any) => entry.act);
    expect(acts).toEqual(["pin.add", "pin.remove"]);
  });
});

function runDetached(args: string[], env: Record<string, string>, stdin: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // detached: the child starts a new session, so it has no controlling
    // terminal even when the test runner itself was started from one.
    const child = spawn(process.execPath, [join(packageRoot, "bin", "agenttool-lobby.ts"), ...args], {
      cwd: packageRoot,
      detached: true,
      env: { PATH: process.env.PATH ?? "", TMPDIR: tmpdir(), ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

describe("the real CLI without a controlling terminal", () => {
  test("fails closed even when yes is piped on stdin", async () => {
    const { home } = tempHome();
    const env = { AGENTTOOL_LOBBY_HOME: home };
    const added = await runDetached(["room", "add", "--title", "Zerone season 1", "--json"], env, "");
    expect(added.code).toBe(EXIT_OK);
    const roomId = JSON.parse(added.stdout).card.room_id as string;

    const promote = await runDetached(["room", "promote", roomId, "--residency", "fleet"], env, "yes\nyes\n");
    expect(promote.code).toBe(EXIT_NOT_CONFIRMED);
    expect(promote.stderr).toContain("tty_unavailable");

    const pin = await runDetached([
      "pin", "add",
      "--did", "did:key:z6MkExampleOnlyNotARealKey",
      "--kid", "key-1",
      "--public-key", fakePublicKey(5),
      "--petname", "studio desk",
      "--how", "read aloud in person",
    ], env, "yes\n");
    expect(pin.code).toBe(EXIT_NOT_CONFIRMED);

    const store = LobbyStore.open(home);
    expect(store.getRoom(roomId)?.residency).toBe("device");
    expect(store.listPins()).toEqual([]);
    expect(store.listAudit()).toEqual([]);
    store.close();
  });
});
