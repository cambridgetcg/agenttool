import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import type { SessionHandle } from "../src/protocol.js";
import { writeSessionCredentialFile } from "../src/session-file.js";
import { CollabStore } from "../src/store-notes.js";

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

  test("a ring delayed by the gap does not fire into a rest declared during the gap", async () => {
    const own = listener("gap-rester");
    const peer = store.startSession({ root_path: root, actor: "peer" });
    const watcher = startWatcher(own.session.id, 60_000, ["--min-gap-ms", "4000"]);
    await until(() => logOf(own.session.id).includes('"start"'));

    mail(peer, own, "first");
    await until(() => rings.length === 1);
    // The second note lands inside the gap: the wait answers ready and the watcher holds its ring.
    mail(peer, own, "second");
    await Bun.sleep(1_000);
    store.restSessionForSession({ ...own.credential, idempotency_key: "rest-in-gap", mode: "resting" });

    // Well past the gap: the delayed ring looked again and found the rest.
    await until(() => logOf(own.session.id).includes('"held"'), 12_000);
    expect(rings).toHaveLength(1);
    watcher.kill("SIGTERM");
    await watcher.exited;
  }, 30_000);

  test("the first ring after a rest says mail was passed over and names both ways to read it", async () => {
    const own = listener("until-rester");
    const peer = store.startSession({ root_path: root, actor: "peer" });
    store.restSessionForSession({
      ...own.credential, idempotency_key: "short-rest", mode: "resting",
      until: new Date(Date.now() + 2_500).toISOString(),
    });
    const watcher = startWatcher(own.session.id, 60_000);
    await until(() => logOf(own.session.id).includes('"start"'));

    mail(peer, own, "held-during-rest");
    await until(() => logOf(own.session.id).includes('"held"'));
    expect(rings).toEqual([]);

    // The rest ends by itself and starts nothing. Fresh mail then rings, and
    // the line must not send the reader past the note that was held.
    await until(() => store.getCoordinationSession(own.session.id)?.rest === null, 6_000);
    await Bun.sleep(1_200);
    expect(rings).toEqual([]);
    mail(peer, own, "fresh");
    await until(() => rings.length === 1);
    expect(rings[0]).toContain("[collab doorbell] ready");
    expect(rings[0]).toContain("1 earlier event(s) before that anchor were held by a rest and went without a ring");
    // Both readers are named: a session on the notes profile has no collab_next.
    expect(rings[0]).toContain("with collab_inbox or with collab_next from your cursor");
    expect(rings[0]).not.toContain("body-held-during-rest");
    watcher.kill("SIGTERM");
    await watcher.exited;
  }, 30_000);

  test("a ring that was waiting out the gap is delivered before the watcher's life ends", async () => {
    const own = listener("gap-at-expiry");
    const peer = store.startSession({ root_path: root, actor: "peer" });
    const watcher = startWatcher(own.session.id, 3_000, ["--min-gap-ms", "4000"]);
    await until(() => logOf(own.session.id).includes('"start"'));

    mail(peer, own, "first");
    await until(() => rings.length === 1);
    // Ready inside the gap; the lifetime runs out before the gap does.
    mail(peer, own, "second");
    expect(await watcher.exited).toBe(0);
    expect(rings).toHaveLength(3);
    expect(rings[1]).toContain("[collab doorbell] ready");
    expect(rings[2]).toContain("expired after");
  }, 30_000);

  test("a rest declared in that last gap silences both the delayed ring and the expiry line", async () => {
    const own = listener("rest-at-expiry");
    const peer = store.startSession({ root_path: root, actor: "peer" });
    const watcher = startWatcher(own.session.id, 3_000, ["--min-gap-ms", "4000"]);
    await until(() => logOf(own.session.id).includes('"start"'));

    mail(peer, own, "first");
    await until(() => rings.length === 1);
    mail(peer, own, "second");
    await Bun.sleep(800);
    store.restSessionForSession({ ...own.credential, idempotency_key: "rest-in-last-gap", mode: "resting" });
    expect(await watcher.exited).toBe(0);
    expect(rings).toHaveLength(1);
    expect(logOf(own.session.id)).toContain("expired_in_held_rest");
  }, 30_000);

  test("a ring that fails is retried from the same anchor and still says what a rest held", async () => {
    const own = listener("failed-ring");
    const peer = store.startSession({ root_path: root, actor: "peer" });
    store.restSessionForSession({
      ...own.credential, idempotency_key: "short-rest", mode: "resting",
      until: new Date(Date.now() + 2_000).toISOString(),
    });
    const watcher = startWatcher(own.session.id, 60_000, ["--retry-base-ms", "500"]);
    await until(() => logOf(own.session.id).includes('"start"'));
    mail(peer, own, "held-during-rest");
    await until(() => logOf(own.session.id).includes('"held"'));
    await until(() => store.getCoordinationSession(own.session.id)?.rest === null, 6_000);
    await Bun.sleep(1_200);

    // The inbox path is still there but nothing answers: the next ring cannot get through.
    await new Promise<void>((closed) => server.close(() => closed()));
    expect(existsSync(socketPath)).toBe(true);
    mail(peer, own, "ring-fails");
    await until(() => logOf(own.session.id).includes('"ring_retry"'));
    expect(rings).toEqual([]);
    // Listen again without the path ever being absent (the watcher would read that as its owner gone).
    await new Promise<void>((ready) => server.listen(`${socketPath}.next`, ready));
    renameSync(`${socketPath}.next`, socketPath);

    // No new mail is needed: the failed ring kept its anchor, so the retry
    // covers the same note. The note the rest held lies before that anchor,
    // counted once however many times the ring was tried.
    await until(() => rings.length === 1, 12_000);
    expect(rings[0]).toContain("1 event(s) after sequence");
    expect(rings[0]).toContain("1 earlier event(s) before that anchor were held by a rest and went without a ring");
    expect(rings[0]).toContain("collab_next");
    await Bun.sleep(1_500);
    expect(rings).toHaveLength(1);
    watcher.kill("SIGTERM");
    await watcher.exited;
  }, 30_000);

  test("one pass's held events are counted once, however many times its ring is tried", async () => {
    const own = listener("retried-pass");
    const peer = store.startSession({ root_path: root, actor: "peer" });
    const report = store.appendReportForSession({ ...own.credential, idempotency_key: "own-report", kind: "observation", body: "mine" });
    store.restSessionForSession({ ...own.credential, idempotency_key: "wake-rest", mode: "resting", wake_on: ["addressed"] });
    const watcher = startWatcher(own.session.id, 60_000, ["--retry-base-ms", "300"]);
    await until(() => logOf(own.session.id).includes('"start"'));
    await new Promise<void>((closed) => server.close(() => closed()));
    expect(existsSync(socketPath)).toBe(true);

    // In one pass: an answer to its report sent without to_session_id (routed,
    // but not a note the rest asked to be woken for, so held), then an explicit note.
    store.appendReportForSession({
      ...peer.credential, idempotency_key: "answer", kind: "observation", body: "agreed",
      relation: "supports", target_report_id: report.id,
    });
    mail(peer, own, "explicit");
    await until(() => (logOf(own.session.id).match(/"ring_retry"/g) ?? []).length >= 2, 15_000);
    await new Promise<void>((ready) => server.listen(`${socketPath}.next`, ready));
    renameSync(`${socketPath}.next`, socketPath);

    await until(() => rings.length === 1, 15_000);
    expect(rings[0]).toContain("1 earlier event(s) before that anchor were held by a rest and went without a ring");
    watcher.kill("SIGTERM");
    await watcher.exited;
  }, 40_000);

  test("the stopped notice asks the journal, not its memory, whether the session rests", async () => {
    // Two sessions, one watcher each, running side by side.
    // returned: rested when its watcher last heard, returned since. It must be told.
    const returned = listener("returned-rester");
    store.restSessionForSession({ ...returned.credential, idempotency_key: "rest", mode: "resting" });
    const first = startWatcher(returned.session.id, 60_000);
    // resting: awake when its watcher last heard, resting since. It must be left alone.
    const resting = listener("late-rester");
    const second = startWatcher(resting.session.id, 60_000);
    await until(() => logOf(returned.session.id).includes('"held"'));
    await until(() => logOf(resting.session.id).includes('"idle"'));

    store.restSessionForSession({ ...returned.credential, idempotency_key: "return", mode: "ready" });
    store.restSessionForSession({ ...resting.credential, idempotency_key: "rest", mode: "resting" });
    // A resume elsewhere raises the generation; the credential files the watchers read are now stale for good.
    store.resumeSession(returned.credential);
    store.resumeSession(resting.credential);

    expect(await first.exited).toBe(1);
    expect(await second.exited).toBe(1);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toContain(`[collab doorbell] stopped: session_auth_failed for session ${returned.session.id}`);
    expect(logOf(returned.session.id)).not.toContain("stopped_in_held_rest");
    expect(logOf(resting.session.id)).toContain("stopped_in_held_rest");
  }, 60_000);
});
