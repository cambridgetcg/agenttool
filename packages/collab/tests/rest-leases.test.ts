import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionHandle } from "../src/protocol.js";
import { CollabStore } from "../src/store.js";

// Where declared rest (collab_session_rest) meets session-fit leases. Rest
// "never releases, extends, or reassigns leases", and a session lease past its
// TTL stays valid while its holder was seen within 6 hours. Together: lease
// expiry reads when the holder was last seen and never reads the rest.
const HOUR_MS = 60 * 60 * 1000;
const STALE_AFTER_MS = 6 * HOUR_MS;

let directory: string;
let root: string;
let store: CollabStore;
let currentTime: Date;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-rest-leases-"));
  root = join(directory, "repo");
  mkdirSync(root);
  currentTime = new Date("2026-11-12T09:00:00.000Z");
  store = new CollabStore(join(directory, "state", "collab.sqlite"), {
    now: () => new Date(currentTime),
  });
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function session(actor: string): SessionHandle {
  return store.startSession({ root_path: root, actor });
}

function advance(milliseconds: number): void {
  currentTime = new Date(currentTime.getTime() + milliseconds);
}

function fromNow(milliseconds: number): string {
  return new Date(currentTime.getTime() + milliseconds).toISOString();
}

/** An edit task its owner claims for 30 seconds, the shortest lease. */
function claimBriefly(owner: SessionHandle, key: string, pathScope: string) {
  const task = store.createTaskForSession({
    ...owner.credential,
    idempotency_key: `create-${key}`,
    title: key,
    work_mode: "edit",
    completion_policy: "accepted",
    path_scopes: [pathScope],
  });
  return store.claimTaskForSession({
    ...owner.credential,
    idempotency_key: `claim-${key}`,
    task_id: task.id,
    expected_version: task.version,
    ttl_seconds: 30,
  });
}

function view(task: { workspace_id: string; id: string }) {
  const current = store.getTask(task.workspace_id, task.id);
  return { status: current.effective_status, holder: current.assignee_liveness };
}

describe("declared rest and session leases", () => {
  test("a resting holder keeps its lease past the TTL exactly as a silent holder does", () => {
    const rester = session("resting-holder");
    const silent = session("silent-holder");
    const observer = session("lease-observer");
    const restingTask = claimBriefly(rester, "resting", "src/resting.ts");
    const silentTask = claimBriefly(silent, "silent", "src/silent.ts");
    store.restSessionForSession({
      ...rester.credential,
      idempotency_key: "rest-for-two-days",
      mode: "resting",
      until: fromNow(48 * HOUR_MS),
    });

    // Past the TTL, both holders seen within 6 hours: neither lease lapses.
    advance(31_000);
    expect(view(restingTask)).toEqual({ status: "claimed", holder: "resting" });
    expect(view(silentTask)).toEqual({ status: "claimed", holder: "live" });
    expect(store.nextForSession(observer.credential).recovery_required).toEqual([]);
  });

  test("a resting holder that polls does not lapse its own lease", () => {
    const rester = session("polling-rester");
    const task = claimBriefly(rester, "polled", "src/polled.ts");
    store.restSessionForSession({
      ...rester.credential,
      idempotency_key: "rest-then-poll",
      mode: "resting",
      until: fromNow(48 * HOUR_MS),
    });

    advance(HOUR_MS);
    expect(store.nextForSession(rester.credential).recovery_required).toEqual([]);
    expect(view(task)).toEqual({ status: "claimed", holder: "resting" });
    // The poll counted as being seen, so the lease holds for another 6 hours.
    advance(STALE_AFTER_MS - 1_000);
    expect(view(task)).toEqual({ status: "claimed", holder: "resting" });
  });

  test("a standing rest does not extend a lease once its holder has gone unseen for 6 hours", () => {
    const rester = session("long-rester");
    const silent = session("long-silent");
    const observer = session("recovering-observer");
    const restingTask = claimBriefly(rester, "long-resting", "src/long-resting.ts");
    const silentTask = claimBriefly(silent, "long-silent", "src/long-silent.ts");
    store.restSessionForSession({
      ...rester.credential,
      idempotency_key: "rest-past-the-view",
      mode: "resting",
      until: fromNow(48 * HOUR_MS),
    });

    advance(STALE_AFTER_MS + 1);
    // The rest still stands, so the holder reads resting, yet the lease is recoverable.
    expect(view(restingTask)).toEqual({ status: "recovery_required", holder: "resting" });
    expect(view(silentTask)).toEqual({ status: "recovery_required", holder: "stale" });
    expect(
      store.nextForSession(observer.credential).recovery_required.map((task) => task.id).sort(),
    ).toEqual([restingTask.id, silentTask.id].sort());

    // Returning from rest makes the session live again but revives nothing:
    // an expired lease still needs explicit recovery.
    const returned = store.restSessionForSession({
      ...rester.credential,
      idempotency_key: "return-after-lapse",
      mode: "ready",
    });
    expect(returned.liveness).toBe("live");
    expect(view(restingTask)).toEqual({ status: "recovery_required", holder: "live" });
  });
});
