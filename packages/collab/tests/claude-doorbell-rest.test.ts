import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import type { SessionHandle } from "../src/protocol.js";
import { writeSessionCredentialFile } from "../src/session-file.js";
import { CollabStore } from "../src/store.js";

// The Claude Code watcher against a declared rest. Every line the watcher
// posts starts a turn, its own notices included, so a rest that asked for no
// turn gets none: no ring for mail, none when the watcher's life runs out.
const packageRoot = resolve(import.meta.dir, "..");
const watcherEntry = join(packageRoot, "integrations", "claude-code", "collab-doorbell-watch.ts");
const hostEntry = join(packageRoot, "bin", "agenttool-collab-host.ts");

let directory: string;
let socketDirectory: string;
let socketPath: string;
let databasePath: string;
let root: string;
let store: CollabStore;
let server: Server;
let rings: string[];
const children: ReturnType<typeof Bun.spawn>[] = [];

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-doorbell-rest-"));
  root = join(directory, "repo");
  mkdirSync(root);
  databasePath = join(directory, "state", "collab.sqlite");
  store = new CollabStore(databasePath);
  // Unix socket paths are short-limited; name it after this live pid like Claude Code does.
  const prefix = join(tmpdir(), "cdr-");
  socketDirectory = mkdtempSync(Buffer.byteLength(`${prefix}XXXXXX/${process.pid}.sock`) < 104
    ? prefix : join(relative(process.cwd(), packageRoot), ".cdr-"));
  socketPath = join(socketDirectory, `${process.pid}.sock`);
  rings = [];
  server = createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
    });
    socket.on("end", () => {
      const message = buffer.split("\n").filter((line) => line.length > 0).at(-1);
      if (message) rings.push(JSON.parse(message).message.content as string);
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

/** A watcher on one-second cycles whose life ends after lifetimeMs (the test hook). */
function startWatcher(sessionId: string, lifetimeMs: number, extra: string[] = []) {
  const child = Bun.spawn([
    process.execPath, watcherEntry, "--session", sessionId, "--db", databasePath,
    "--host-bin", hostEntry, "--cycle-ms", "1000", "--min-gap-ms", "0", ...extra,
  ], {
    cwd: packageRoot,
    env: {
      PATH: process.env.PATH ?? "",
      TMPDIR: tmpdir(),
      HOME: join(directory, "home"),
      CLAUDE_CODE_MESSAGING_SOCKET: socketPath.startsWith("/") ? socketPath : relative(packageRoot, resolve(socketPath)),
      AGENTTOOL_COLLAB_DOORBELL_TEST_MAX_MS: String(lifetimeMs),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(child);
  return child;
}

const logOf = (sessionId: string) => {
  const file = join(directory, "state", "collab-doorbell", `watch-${sessionId}.log`);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
};

async function until(condition: () => boolean, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await Bun.sleep(50);
  }
}

function mail(from: SessionHandle, to: SessionHandle, key: string) {
  return store.appendReportForSession({
    ...from.credential, idempotency_key: key, kind: "observation", body: `body-${key}`, to_session_id: to.session.id,
  });
}

describe("Claude Code collab doorbell watcher against a declared rest", () => {
  test("a rest that asked for no turn gets none: not for mail, not when the watcher's life ends", async () => {
    const own = listener("held-rester");
    const peer = store.startSession({ root_path: root, actor: "peer" });
    store.restSessionForSession({ ...own.credential, idempotency_key: "rest", mode: "resting" });
    const watcher = startWatcher(own.session.id, 3_500, ["--all"]);
    await until(() => logOf(own.session.id).includes('"start"'));

    mail(peer, own, "held-mail");
    expect(await watcher.exited).toBe(0);
    expect(rings).toEqual([]);
    const log = logOf(own.session.id);
    expect(log).toContain('"held"');
    expect(log).toContain("expired_in_held_rest");
    expect(log).toContain("max_lifetime");
    // The note waits in the journal for the return.
    expect(store.nextForSession(own.credential).session.addressed_waiting).toBe(1);
  }, 30_000);

  test("a rest with wake_on addressed is rung for an explicit note only, and hears its watcher expire", async () => {
    const own = listener("waking-rester");
    const peer = store.startSession({ root_path: root, actor: "peer" });
    store.restSessionForSession({
      ...own.credential, idempotency_key: "rest", mode: "resting", wake_on: ["addressed"],
    });
    const watcher = startWatcher(own.session.id, 5_000, ["--all"]);
    await until(() => logOf(own.session.id).includes('"start"'));

    // --all would ring for chatter; the rest consented to addressed notes only.
    store.appendReportForSession({
      ...peer.credential, idempotency_key: "chatter", kind: "observation", body: "general chatter",
    });
    await Bun.sleep(1_500);
    expect(rings).toEqual([]);

    mail(peer, own, "explicit");
    await until(() => rings.length === 1);
    expect(rings[0]).toContain("[collab doorbell] ready");

    expect(await watcher.exited).toBe(0);
    expect(rings).toHaveLength(2);
    expect(rings[1]).toContain("expired after");
    expect(logOf(own.session.id)).not.toContain("expired_in_held_rest");
  }, 30_000);
});
