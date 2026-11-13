import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CollabError } from "../src/errors.js";
import { runCollabHostCli, waitForSessionEvents, type HostWaitReceipt } from "../src/host.js";
import type { EventCursor, SessionHandle } from "../src/protocol.js";
import { writeSessionCredentialFile } from "../src/session-file.js";
import { CollabStore } from "../src/store.js";

// Where the host doorbell (`agenttool-collab-host wait`, and the Claude Code
// watcher that loops it) meets a declared rest. The rest is the session's own
// statement of what may start a turn in it, so the wait obeys it:
//   - a rest without wake_on "addressed" passes everything over, for good;
//   - a rest with it rings only for a note explicitly addressed to the
//     session, the same set a host doorbell wakes for, whatever the flags.
// Passed-over mail is not rung later: it waits in the journal and is counted
// by collab_next when the session returns, so the end of `until` starts nothing.
const packageRoot = resolve(import.meta.dir, "..");
const hostEntry = join(packageRoot, "bin", "agenttool-collab-host.ts");
const HOUR_MS = 60 * 60 * 1000;

let directory: string;
let root: string;
let databasePath: string;
let store: CollabStore;
let currentTime: number;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-wait-rest-"));
  root = join(directory, "repo");
  mkdirSync(root);
  databasePath = join(directory, "state", "collab.sqlite");
  currentTime = Date.parse("2026-11-12T09:00:00.000Z");
  store = new CollabStore(databasePath, { now: () => new Date(currentTime) });
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function start(actor: string): SessionHandle {
  const handle = store.startSession({ root_path: root, actor });
  writeSessionCredentialFile(store.defaultSessionCredentialPath(handle.session.id), handle.credential);
  return handle;
}

function head(handle: SessionHandle): EventCursor {
  const workspace = store.getWorkspace(handle.workspace.id)!;
  return { epoch_id: workspace.epoch_id, sequence: workspace.event_head_sequence, hash: workspace.event_head_hash };
}

function rest(
  handle: SessionHandle,
  key: string,
  extra: { wake_on?: Array<"addressed">; until?: string; reason?: string } = {},
) {
  return store.restSessionForSession({ ...handle.credential, idempotency_key: key, mode: "resting", ...extra });
}

const comeBack = (handle: SessionHandle, key: string) =>
  store.restSessionForSession({ ...handle.credential, idempotency_key: key, mode: "ready" });

function mail(from: SessionHandle, to: SessionHandle, key: string) {
  return store.appendReportForSession({
    ...from.credential, idempotency_key: key, kind: "observation", body: `body-${key}`, to_session_id: to.session.id,
  });
}

function chatter(from: SessionHandle, key: string) {
  return store.appendReportForSession({
    ...from.credential, idempotency_key: key, kind: "observation", body: `chatter-${key}`,
  });
}

/** A wait clock whose sleep also moves the store's wall clock, with a hook after each sleep. */
function clock(afterSleep: (count: number) => void = () => {}) {
  let now = 0;
  let sleeps = 0;
  return {
    now: () => now,
    sleep: (ms: number) => {
      now += ms;
      currentTime += ms;
      sleeps += 1;
      afterSleep(sleeps);
    },
  };
}

function wait(
  handle: SessionHandle,
  after: EventCursor,
  options: { addressed?: boolean; include_own?: boolean; wait_ms?: number; after_sleep?: (count: number) => void } = {},
): HostWaitReceipt {
  return waitForSessionEvents(store, handle.credential, {
    after_anchor: after,
    wait_ms: options.wait_ms ?? 500,
    include_own: options.include_own ?? false,
    addressed: options.addressed ?? false,
  }, clock(options.after_sleep));
}

describe("host wait against a rest without wake_on addressed", () => {
  test("passes mail over in both modes, says so, and reveals nothing", () => {
    const own = start("rester");
    const peer = start("peer");
    rest(own, "rest", { reason: "private-rest-reason-marker" });
    const anchor = head(own);
    mail(peer, own, "held-mail");
    const after = head(own);

    for (const addressed of [true, false]) {
      const receipt = wait(own, anchor, { addressed });
      expect(receipt).toMatchObject({
        status: "idle",
        next_anchor: after,
        skipped_held_events: 1,
        held_by_rest: true,
        skipped_own_events: 0,
      });
      if (addressed) expect(receipt.skipped_unaddressed_events).toBe(0);
    }

    const cli = Bun.spawnSync([
      process.execPath, hostEntry, "wait", "--session", own.session.id, "--after-anchor", JSON.stringify(anchor),
      "--wait-ms", "0", "--addressed", "--db", databasePath,
    ], {
      cwd: packageRoot,
      env: { PATH: process.env.PATH ?? "", TMPDIR: tmpdir(), HOME: join(directory, "home") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = cli.stdout.toString();
    expect(cli.exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ status: "idle", skipped_held_events: 1, held_by_rest: true });
    expect(stdout).not.toContain("private-rest-reason-marker");
    expect(stdout).not.toContain("body-held-mail");
  });

  test("holds the session's own events too when they were asked for", () => {
    const own = start("rester");
    const anchor = head(own);
    rest(own, "rest");
    expect(wait(own, anchor, { include_own: true })).toMatchObject({
      status: "idle", skipped_held_events: 1, skipped_own_events: 0, held_by_rest: true,
    });
    // Without --include-own they are its own events first, as before.
    expect(wait(own, anchor)).toMatchObject({ status: "idle", skipped_own_events: 1, held_by_rest: true });
    expect(wait(own, anchor).skipped_held_events).toBeUndefined();
  });

  test("never rings later for what it passed over: the return finds it through collab_next", () => {
    const own = start("rester");
    const peer = start("peer");
    rest(own, "rest");
    const anchor = head(own);
    mail(peer, own, "held-mail");
    const held = wait(own, anchor, { addressed: true });
    expect(held).toMatchObject({ status: "idle", skipped_held_events: 1, held_by_rest: true });

    comeBack(own, "return");
    const afterReturn = wait(own, held.next_anchor, { addressed: true });
    expect(afterReturn.status).toBe("idle");
    expect(afterReturn.held_by_rest).toBeUndefined();
    expect(afterReturn.skipped_held_events).toBeUndefined();
    // The note is not lost: the returning session's own read counts it.
    expect(store.nextForSession(own.credential).session.addressed_waiting).toBe(1);
    // Mail that lands after the return rings as always.
    mail(peer, own, "fresh-mail");
    expect(wait(own, afterReturn.next_anchor, { addressed: true }).status).toBe("ready");
  });

  test("the end of `until` starts nothing; only mail that lands after it rings", () => {
    const own = start("rester");
    const peer = start("peer");
    rest(own, "rest", { until: new Date(currentTime + 600).toISOString() });
    const anchor = head(own);
    mail(peer, own, "held-mail");

    // The rest expires 600 ms into a 2-second wait and nobody returns.
    const expired = wait(own, anchor, { addressed: true, wait_ms: 2_000 });
    expect(expired).toMatchObject({ status: "idle", skipped_held_events: 1, waited_ms: 2_000 });
    expect(expired.held_by_rest).toBeUndefined();
    expect(store.getCoordinationSession(own.session.id)?.rest).toBeNull();

    mail(peer, own, "after-expiry");
    expect(wait(own, expired.next_anchor, { addressed: true }).status).toBe("ready");
  });

  test("a rest declared mid-wait holds what lands after it, and a return mid-wait frees what lands after it", () => {
    const own = start("rester");
    const peer = start("peer");
    const anchor = head(own);
    const declared = wait(own, anchor, {
      addressed: true,
      wait_ms: 1_000,
      after_sleep: (count) => {
        if (count === 1) rest(own, "rest-mid-wait");
        if (count === 2) mail(peer, own, "lands-in-rest");
      },
    });
    expect(declared).toMatchObject({
      status: "idle", skipped_own_events: 1, skipped_held_events: 1, held_by_rest: true,
    });

    const returned = wait(own, declared.next_anchor, {
      addressed: true,
      wait_ms: 1_000,
      after_sleep: (count) => {
        if (count === 1) comeBack(own, "return-mid-wait");
        if (count === 2) mail(peer, own, "lands-after-return");
      },
    });
    expect(returned).toMatchObject({ status: "ready", skipped_own_events: 1 });
    expect(returned.skipped_held_events).toBeUndefined();
  });

  test("reads the rest once for a page of mail, not once for each note", () => {
    const own = start("busy-rester");
    const peer = start("peer");
    rest(own, "rest");
    const anchor = head(own);
    for (const key of ["one", "two", "three", "four", "five"]) mail(peer, own, key);

    let reads = 0;
    const read = store.getCoordinationSession.bind(store);
    store.getCoordinationSession = (sessionId: string) => {
      reads += 1;
      return read(sessionId);
    };
    try {
      expect(wait(own, anchor, { addressed: true, wait_ms: 0 })).toMatchObject({
        status: "idle", skipped_held_events: 5, held_by_rest: true,
      });
    } finally {
      store.getCoordinationSession = read;
    }
    // Once to find the session, once for the page that held five notes, once at the deadline.
    expect(reads).toBe(3);
  });

  test("an event too large to inspect pins the wait under a rest, and the receipt says so", () => {
    const own = start("pinned-rester");
    const peer = start("peer");
    rest(own, "rest");
    const anchor = head(own);
    // A synthetic valid row larger than the bounded page, as tests/events-wait.test.ts builds it.
    const internals = store as unknown as {
      db: { transaction: (run: () => void) => { immediate: () => void } };
      appendEvent: (...args: unknown[]) => unknown;
    };
    internals.db.transaction(() => {
      internals.appendEvent(
        own.workspace.id, "report.posted", "oversized", "fixture",
        { evidence_refs: Array.from({ length: 128 }, (_, index) => `${index}-${"界".repeat(1990)}`) },
        peer.session.id,
      );
    }).immediate();
    mail(peer, own, "behind-the-large-one");

    // It can be neither rung (consent unknown) nor passed over (unread): the wait stays before it.
    const pinned = wait(own, anchor, { addressed: true });
    expect(pinned).toMatchObject({
      status: "idle", next_anchor: anchor, held_by_rest: true, first_event_oversized: true,
    });
    expect(pinned.skipped_held_events).toBeUndefined();

    comeBack(own, "return");
    expect(wait(own, anchor, { addressed: true })).toMatchObject({ status: "ready", first_event_oversized: true });
  });

  test("agrees with the tap: mail is held here exactly while knocks reports it and marks nothing", () => {
    const own = start("rester");
    const peer = start("peer");
    rest(own, "rest");
    const anchor = head(own);
    mail(peer, own, "held-mail");
    const knock = () => {
      const result = runCollabHostCli(
        ["knocks", "--session", own.session.id, "--mark-tapped", "--db", databasePath],
        {},
        { now: () => new Date(currentTime) },
      );
      return JSON.parse(result.line!) as { waiting: number; new: unknown[] };
    };
    expect(wait(own, anchor, { addressed: true })).toMatchObject({ status: "idle", held_by_rest: true });
    // Held: reported, never spent. Asking twice still shows it as new.
    expect(knock()).toMatchObject({ waiting: 1 });
    expect(knock().new).toHaveLength(1);
  });
});

describe("host wait against a rest with wake_on addressed", () => {
  test("rings only for a note explicitly addressed to the session, whatever the flags", () => {
    const own = start("rester");
    const peer = start("peer");
    const proposal = store.appendReportForSession({
      ...own.credential, idempotency_key: "own-proposal", kind: "proposal", body: "a proposal",
    });
    rest(own, "rest", { wake_on: ["addressed"] });
    const anchor = head(own);

    // Unaddressed chatter: a plain wait would ring; the rest did not consent to it.
    chatter(peer, "noise");
    const plain = wait(own, anchor);
    expect(plain).toMatchObject({ status: "idle", skipped_held_events: 1 });
    expect(plain.held_by_rest).toBeUndefined();

    // An answer sent without to_session_id is routed, but it is not a note
    // explicitly addressed to the session, and a host doorbell would not wake for it.
    store.appendReportForSession({
      ...peer.credential, idempotency_key: "answer", kind: "observation", body: "agreed",
      relation: "supports", target_report_id: proposal.id,
    });
    const answered = wait(own, plain.next_anchor, { addressed: true });
    expect(answered).toMatchObject({ status: "idle", skipped_held_events: 1, skipped_unaddressed_events: 0 });

    // An explicit note rings in both modes, and nothing is skipped past it.
    mail(peer, own, "explicit");
    for (const addressed of [true, false]) {
      const rung = wait(own, answered.next_anchor, { addressed });
      expect(rung).toMatchObject({ status: "ready", next_anchor: answered.next_anchor });
      expect(rung.skipped_held_events).toBeUndefined();
    }
  });
});

describe("host wait without a standing rest", () => {
  test("keeps exactly the receipt it had", () => {
    const own = start("listener");
    const peer = start("peer");
    const anchor = head(own);
    const base = [
      "after_anchor", "head_sequence", "next_anchor", "protocol", "session_id", "skipped_own_events",
      "status", "waited_ms", "workspace_id",
    ];
    expect(Object.keys(wait(own, anchor)).sort()).toEqual(base);
    expect(Object.keys(wait(own, anchor, { addressed: true })).sort())
      .toEqual([...base, "skipped_unaddressed_events"].sort());
    chatter(peer, "noise");
    expect(Object.keys(wait(own, anchor)).sort()).toEqual(base);
    expect(wait(own, anchor).status).toBe("ready");
  });

  test("reads rest, not liveness: a stale session that never rested is still rung", () => {
    const own = start("stale-listener");
    const peer = start("peer");
    const anchor = head(own);
    currentTime += 7 * HOUR_MS;
    expect(store.getCoordinationSession(own.session.id)?.liveness).toBe("stale");
    mail(peer, own, "to-stale");
    expect(wait(own, anchor, { addressed: true }).status).toBe("ready");
  });

  test("an ended session fails closed whether or not it was resting", () => {
    const own = start("ending-rester");
    const peer = start("peer");
    rest(own, "rest");
    const anchor = head(own);
    mail(peer, own, "held-mail");
    store.endSession({ ...own.credential, reason: "done" });
    let failure: unknown;
    try {
      wait(own, anchor, { addressed: true });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(CollabError);
    expect((failure as CollabError).code).toBe("session_auth_failed");
  });
});
