import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import type { SessionHandle } from "../src/protocol.js";
import { writeSessionCredentialFile } from "../src/session-file.js";
import { CollabStore } from "../src/store.js";

const packageRoot = resolve(import.meta.dir, "..");
const watcherEntry = join(packageRoot, "integrations", "claude-code", "collab-doorbell-watch.ts");
const hostEntry = join(packageRoot, "bin", "agenttool-collab-host.ts");
const TOKEN = "inbox-token-for-tests";

let directory: string;
let socketDirectory: string;
let socketPath: string;
let databasePath: string;
let root: string;
let store: CollabStore;
let server: Server;
let connections: string[][];
const children: ReturnType<typeof Bun.spawn>[] = [];

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-doorbell-"));
  root = join(directory, "repo");
  mkdirSync(root);
  databasePath = join(directory, "state", "collab.sqlite");
  store = new CollabStore(databasePath);
  // Unix socket paths are short-limited; name it after this live pid like Claude Code does.
  // A long TMPDIR can exceed macOS's 104-byte sockaddr_un limit. Use a
  // short relative path inside the test package, not another user's temp home.
  const prefix = join(tmpdir(), "cdw-");
  socketDirectory = mkdtempSync(Buffer.byteLength(`${prefix}XXXXXX/${process.pid}.sock`) < 104
    ? prefix : join(relative(process.cwd(), packageRoot), ".cdw-"));
  socketPath = join(socketDirectory, `${process.pid}.sock`);
  connections = [];
  server = createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
    });
    socket.on("end", () => {
      connections.push(buffer.split("\n").filter((line) => line.length > 0));
    });
  });
  await new Promise<void>((ready) => server.listen(socketPath, ready));
});

afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill();
    await child.exited;
  }
  await new Promise<void>((closed) => server.close(() => closed()));
  store.close();
  rmSync(directory, { recursive: true, force: true });
  rmSync(socketDirectory, { recursive: true, force: true });
});

function listener(actor: string): SessionHandle {
  const handle = store.startSession({ root_path: root, actor });
  writeSessionCredentialFile(store.defaultSessionCredentialPath(handle.session.id), handle.credential);
  return handle;
}

function startWatcher(sessionId: string, extra: string[] = [], socket = socketPath) {
  const child = Bun.spawn([
    process.execPath, watcherEntry, "--session", sessionId, "--db", databasePath,
    "--host-bin", hostEntry, "--cycle-ms", "1000", ...extra,
  ], {
    cwd: packageRoot,
    env: {
      PATH: process.env.PATH ?? "",
      TMPDIR: tmpdir(),
      HOME: join(directory, "home"),
      CLAUDE_CODE_MESSAGING_SOCKET: socket.startsWith("/") ? socket : relative(packageRoot, resolve(socket)),
      CLAUDE_CODE_MESSAGING_TOKEN: TOKEN,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(child);
  return child;
}

const stateFile = (sessionId: string, kind: "pid" | "log") =>
  join(directory, "state", "collab-doorbell", `watch-${sessionId}.${kind}`);

async function until(condition: () => boolean, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await Bun.sleep(50);
  }
}

const started = (sessionId: string) => () =>
  existsSync(stateFile(sessionId, "log")) && readFileSync(stateFile(sessionId, "log"), "utf8").includes('"start"');

describe("Claude Code collab doorbell watcher", () => {
  test("rings once, content-free, only for addressed mail, and stops quietly when the session ends", async () => {
    const own = listener("doorbell-listener");
    const peer = store.startSession({ root_path: root, actor: "doorbell-peer" });
    const watcher = startWatcher(own.session.id, ["--min-gap-ms", "0"]);
    await until(started(own.session.id));

    store.appendReportForSession({
      ...peer.credential, idempotency_key: "chatter", kind: "observation", body: "general chatter",
    });
    await Bun.sleep(1_500);
    expect(connections).toHaveLength(0);

    store.appendReportForSession({
      ...peer.credential, idempotency_key: "mail", kind: "observation",
      body: "doorbell-private-body-marker", to_session_id: own.session.id,
    });
    await until(() => connections.length === 1);
    const [auth, message] = connections[0]!;
    expect(JSON.parse(auth!)).toEqual({ type: "auth", token: TOKEN });
    const ringLine = JSON.parse(message!);
    expect(ringLine.type).toBe("user");
    expect(ringLine.message.role).toBe("user");
    expect(ringLine.message.content).toContain("[collab doorbell] ready");
    expect(ringLine.message.content).toContain(own.session.id);
    expect(ringLine.message.content).toContain("routed to this session");
    expect(message).not.toContain("doorbell-private-body-marker");
    expect(message).not.toContain("doorbell-peer");
    expect(message).not.toContain(TOKEN);

    store.endSessionWithReleases({ ...own.credential, reason: "done", release_leases: false });
    expect(await watcher.exited).toBe(0);
    expect(existsSync(stateFile(own.session.id, "pid"))).toBe(false);
    expect(readFileSync(stateFile(own.session.id, "log"), "utf8")).toContain("session_ended");
    expect(connections).toHaveLength(1);
  }, 30_000);

  test("with --all coalesces a burst inside the gap into one ring and cleans up on SIGTERM", async () => {
    const own = listener("doorbell-all");
    const peer = store.startSession({ root_path: root, actor: "doorbell-burst" });
    const watcher = startWatcher(own.session.id, ["--all", "--min-gap-ms", "2000"]);
    await until(started(own.session.id));

    const note = (key: string) => store.appendReportForSession({
      ...peer.credential, idempotency_key: key, kind: "observation", body: key,
    });
    note("first");
    await until(() => connections.length === 1);
    note("second");
    note("third");
    note("fourth");
    await until(() => connections.length === 2);
    const second = JSON.parse(connections[1]![1]!).message.content as string;
    expect(second).toContain("3 event(s)");
    expect(second).toContain("from another session");
    await Bun.sleep(1_500);
    expect(connections).toHaveLength(2);

    watcher.kill("SIGTERM");
    await watcher.exited;
    expect(existsSync(stateFile(own.session.id, "pid"))).toBe(false);
    expect(readFileSync(stateFile(own.session.id, "log"), "utf8")).toContain("sigterm");
  }, 30_000);

  test("refuses a second watcher and exits when its owner session is gone", async () => {
    const own = listener("doorbell-single");
    startWatcher(own.session.id);
    await until(started(own.session.id));
    const second = startWatcher(own.session.id);
    expect(await second.exited).toBe(2);
    expect(await new Response(second.stderr).text()).toContain("already runs");

    const other = listener("doorbell-orphan");
    const orphan = startWatcher(other.session.id, [], join(socketDirectory, "999999999.sock"));
    expect(await orphan.exited).toBe(0);
    expect(readFileSync(stateFile(other.session.id, "log"), "utf8")).toContain("owner_gone");
    expect(connections).toHaveLength(0);
  }, 30_000);

  test("keeps its anchor after a failed ring, retries with backoff, and names collab_inbox without content", async () => {
    const own = listener("doorbell-retry");
    const peer = store.startSession({ root_path: root, actor: "doorbell-retry-peer" });
    // A path that exists but is no socket: every connect fails, and the
    // owner check (this test's pid, the file's existence) still passes.
    mkdirSync(join(socketDirectory, "b"), { recursive: true });
    const broken = join(socketDirectory, "b", `${process.pid}.sock`);
    writeFileSync(broken, "");
    const watcher = startWatcher(own.session.id, ["--min-gap-ms", "0", "--retry-base-ms", "200"], broken);
    await until(started(own.session.id));
    const mail = store.appendReportForSession({
      ...peer.credential, idempotency_key: "retry-mail", kind: "observation",
      body: "doorbell-retry-body-marker", to_session_id: own.session.id,
    });
    const log = () => readFileSync(stateFile(own.session.id, "log"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    await until(() => log().filter((entry) => entry.event === "ring_retry").length >= 2, 20_000);
    // Now the socket listens: the next retry rings for the same event.
    rmSync(broken);
    const retried: string[][] = [];
    const server = createServer((socket) => {
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk;
      });
      socket.on("end", () => retried.push(buffer.split("\n").filter((line) => line.length > 0)));
    });
    await new Promise<void>((ready) => server.listen(broken, ready));
    try {
      await until(() => retried.length === 1, 20_000);
      const content = JSON.parse(retried[0]![1]!).message.content as string;
      expect(content).toContain("Read them with collab_inbox");
      expect(content.indexOf("collab_inbox")).toBeLessThan(content.indexOf("collab_events_since"));
      expect(content).toContain(`after sequence ${mail.event_sequence - 1}`);
      expect(content).not.toContain("doorbell-retry-body-marker");
      expect(content).not.toContain("doorbell-retry-peer");
      const entries = log();
      const failed = entries.filter((entry) => entry.event === "ring_failed" && entry.from_sequence !== undefined);
      expect(failed.length).toBeGreaterThanOrEqual(2);
      // Every failed ring and the ring that landed start from the same anchor.
      for (const entry of failed) expect(entry.from_sequence).toBe(mail.event_sequence - 1);
      expect(entries.find((entry) => entry.event === "rang").from_sequence).toBe(mail.event_sequence - 1);
      const waits = entries.filter((entry) => entry.event === "ring_retry").map((entry) => entry.after_ms);
      expect(waits.slice(0, 2)).toEqual([200, 400]);
    } finally {
      watcher.kill("SIGTERM");
      await watcher.exited;
      await new Promise<void>((closed) => server.close(() => closed()));
    }
  }, 60_000);

  test("stops with ring_failed_repeatedly after 6 failed rings in a row", async () => {
    const own = listener("doorbell-giveup");
    const peer = store.startSession({ root_path: root, actor: "doorbell-giveup-peer" });
    mkdirSync(join(socketDirectory, "b"), { recursive: true });
    const broken = join(socketDirectory, "b", `${process.pid}.sock`);
    writeFileSync(broken, "");
    const watcher = startWatcher(own.session.id, ["--min-gap-ms", "0", "--retry-base-ms", "20"], broken);
    await until(started(own.session.id));
    store.appendReportForSession({
      ...peer.credential, idempotency_key: "giveup-mail", kind: "observation", body: "x", to_session_id: own.session.id,
    });
    expect(await watcher.exited).toBe(1);
    const entries = readFileSync(stateFile(own.session.id, "log"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(entries.filter((entry) => entry.event === "ring_failed" && entry.from_sequence !== undefined)).toHaveLength(6);
    expect(entries.filter((entry) => entry.event === "ring_retry").map((entry) => entry.after_ms)).toEqual([20, 40, 80, 160, 320]);
    expect(entries.find((entry) => entry.event === "ring_failed_repeatedly")).toMatchObject({ failures: 6 });
    expect(entries.at(-1)).toMatchObject({ event: "stop", reason: "ring_failed_repeatedly" });
    expect(existsSync(stateFile(own.session.id, "pid"))).toBe(false);
  }, 60_000);

  test("defaults its host bin to the packaged bundle and documents its limits", async () => {
    expect(existsSync(join(packageRoot, "dist", "agenttool-collab-host.js"))).toBe(true);
    const readme = await Bun.file(join(packageRoot, "integrations", "claude-code", "README.md")).text();
    for (const term of ["not a documented contract", "--addressed", "content-free", "one model turn",
      "CLAUDE_CODE_MESSAGING_TOKEN", "collab_session_end", "unreleased", "collab_inbox", "--retry-base-ms",
      "ring_failed_repeatedly"]) {
      expect(readme).toContain(term);
    }
  });
});
