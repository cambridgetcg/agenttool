import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCollabMcpServer } from "../src/mcp.js";
import * as protocol from "../src/protocol.js";
import type { SessionHandle } from "../src/protocol.js";
import { CollabStore } from "../src/store.js";

// Local copy of the 6-hour threshold so the clock arithmetic below does not
// depend on the export under test; the first test pins the export to it.
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

let directory: string;
let root: string;
let store: CollabStore;
let currentTime: Date;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-liveness-"));
  root = join(directory, "repo");
  mkdirSync(root);
  currentTime = new Date("2026-10-08T09:00:00.000Z");
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

function createEditTask(owner: SessionHandle, key: string, pathScope: string) {
  return store.createTaskForSession({
    ...owner.credential,
    idempotency_key: key,
    title: key,
    work_mode: "edit",
    completion_policy: "accepted",
    path_scopes: [pathScope],
  });
}

function claimBriefly(holder: SessionHandle, task: { id: string; version: number }, key: string) {
  return store.claimTaskForSession({
    ...holder.credential,
    idempotency_key: key,
    task_id: task.id,
    expected_version: task.version,
    ttl_seconds: 30,
  });
}

async function callTool(server: any, name: string, args: Record<string, unknown> = {}) {
  const registration = server._registeredTools[name];
  if (!registration) throw new Error(`tool not registered: ${name}`);
  return await (registration.handler ?? registration.callback)(args, {});
}

describe("staleness as a derived view", () => {
  test("derives session liveness from last_seen_at without changing status or the journal", () => {
    expect(protocol.SESSION_STALE_AFTER_MS).toBe(STALE_AFTER_MS);
    const poller = session("liveness-poller");
    const ghost = session("liveness-ghost");
    expect(poller.session.liveness).toBe("live");
    expect(ghost.session.liveness).toBe("live");
    const headBefore = store.eventsSince(poller.workspace.id, 0, 500).head_sequence;

    advance(STALE_AFTER_MS);
    expect(store.listCoordinationSessions(poller.workspace.id).map((item) => item.liveness))
      .toEqual(["live", "live"]);

    advance(1);
    const aged = store.listCoordinationSessions(poller.workspace.id);
    expect(aged.map((item) => [item.status, item.liveness])).toEqual([
      ["active", "stale"],
      ["active", "stale"],
    ]);

    const polled = store.nextForSession(poller.credential);
    expect(polled.session.liveness).toBe("live");
    const status = new Map(
      store.workspaceStatus(poller.workspace.id).active_sessions
        .map((item) => [item.id, [item.status, item.liveness]]),
    );
    expect(status.get(poller.session.id)).toEqual(["active", "live"]);
    expect(status.get(ghost.session.id)).toEqual(["active", "stale"]);
    expect(store.eventsSince(poller.workspace.id, 0, 500).head_sequence).toBe(headBefore);

    const ended = store.endSession({ ...poller.credential, reason: "liveness test done" });
    expect(ended.status).toBe("ended");
    expect(ended.liveness).toBe("stale");
  });

  // Controller ruling A1: the spec treats ack and reset alike, so a no-op ack
  // (an anchor that already matches the stored cursor) must still count as
  // the session being seen, not just a successful reset or a cursor advance.
  test("refreshes last_seen_at on a no-op cursor ack whose anchor matches the stored cursor", () => {
    const worker = session("ack-noop-worker");
    expect(worker.session.cursor_version).toBe(0);

    advance(STALE_AFTER_MS - 60_000);
    const acknowledged = store.acknowledgeSessionCursor({
      ...worker.credential,
      anchor: worker.session.cursor,
      expected_cursor_version: worker.session.cursor_version,
    });
    // Same sequence/hash as already stored: a true no-op, so the cursor and
    // its version are unchanged.
    expect(acknowledged.cursor).toEqual(worker.session.cursor);
    expect(acknowledged.cursor_version).toBe(worker.session.cursor_version);
    expect(acknowledged.liveness).toBe("live");

    // Without the no-op refresh this second stretch would push the session
    // past SESSION_STALE_AFTER_MS measured from the original join time.
    advance(STALE_AFTER_MS - 60_000);
    expect(store.listCoordinationSessions(worker.workspace.id)[0]).toMatchObject({
      id: worker.session.id,
      status: "active",
      liveness: "live",
    });
  });

  test("keeps live session leases and projects recovery only for stale holders", () => {
    const holder = session("own-holder");
    const other = session("other-holder");
    const observer = session("observer");
    const otherTask = createEditTask(other, "other-expiring", "src/other.ts");
    const otherClaim = claimBriefly(other, otherTask, "claim-other-expiring");
    advance(1_000);
    const ownTask = createEditTask(holder, "own-expiring", "src/own.ts");
    const ownClaim = claimBriefly(holder, ownTask, "claim-own-expiring");
    const openTask = createEditTask(observer, "still-open", "src/open.ts");

    expect(ownClaim.assignee_liveness).toBe("live");
    expect(openTask.assignee_liveness).toBeNull();
    expect(store.nextForSession(holder.credential).recovery_required).toEqual([]);

    advance(31_000);
    const ownNext = store.nextForSession(holder.credential);
    expect(ownNext.recovery_required).toEqual([]);
    expect(ownNext.own_claims.map((task) => task.id)).toEqual([ownTask.id]);
    expect(store.nextForSession(other.credential).recovery_required.map((task) => task.id))
      .toEqual([]);
    expect(store.nextForSession(observer.credential).recovery_required.map((task) => task.id))
      .toEqual([]);
    expect(
      store.nextForActor(observer.workspace.id, "legacy-observer").recovery_required
        .map((task) => task.id),
    ).toEqual([]);
    expect(store.getTask(ownTask.workspace_id, ownTask.id).assignee_liveness).toBe("live");

    advance(STALE_AFTER_MS + 1);
    expect(store.getTask(ownTask.workspace_id, ownTask.id).assignee_liveness).toBe("stale");
    expect(store.getTask(otherTask.workspace_id, otherTask.id).assignee_liveness).toBe("stale");
    expect(store.nextForSession(observer.credential).recovery_required.map(task => task.id))
      .toEqual([otherTask.id, ownTask.id]);
    // Activity before takeover keeps the same lease; it cannot retake a lease
    // already transferred by audited recovery (session-fit.test.ts).
    const refreshed = store.nextForSession(holder.credential).recovery_required;
    expect(refreshed.map((task) => [task.id, task.assignee_liveness])).toEqual([
      [otherTask.id, "stale"],
    ]);
    expect(otherClaim.lease_expires_at! < ownClaim.lease_expires_at!).toBe(true);

    // A stale holder can still leave an expired lease for explicit recovery.
    advance(STALE_AFTER_MS + 1);
    store.endSession({ ...holder.credential, reason: "leaves an expired lease behind" });
    expect(store.getTask(ownTask.workspace_id, ownTask.id)).toMatchObject({
      effective_status: "recovery_required",
      assignee_session_id: holder.session.id,
      assignee_liveness: "stale",
    });
  });

  test("reports the acting session as live in its own receipt after a long idle", () => {
    const worker = session("idle-worker");
    const task = createEditTask(worker, "idle-then-claim", "src/idle.ts");
    advance(STALE_AFTER_MS + 1);
    const claimed = store.claimTaskForSession({
      ...worker.credential,
      idempotency_key: "claim-after-idle",
      task_id: task.id,
      expected_version: task.version,
    });
    expect(claimed.assignee_session_id).toBe(worker.session.id);
    expect(claimed.assignee_liveness).toBe("live");
  });

  test("fills assignee_liveness with null when replaying a legacy receipt stored without it", () => {
    const workspace = store.openWorkspace({ root_path: root, actor: "legacy-writer" });
    const request = {
      workspace_id: workspace.id,
      actor: "legacy-writer",
      idempotency_key: "legacy-before-liveness",
      title: "Legacy task stored before liveness existed",
    };
    const created = store.createTask(request);
    expect(created.assignee_liveness).toBeNull();
    store.db.query(`
      UPDATE mutations
      SET response_json = json_remove(response_json, '$.assignee_liveness')
      WHERE workspace_id = ? AND idempotency_key = ?
    `).run(workspace.id, request.idempotency_key);
    const replayed = store.createTask(request);
    expect(replayed.id).toBe(created.id);
    expect(replayed.assignee_liveness).toBeNull();
  });

  test("exposes liveness and recovery_required through the MCP surface", async () => {
    const server = buildCollabMcpServer(store);
    const tools = (server as any)._registeredTools;
    const nextDescription = tools.collab_next.description as string;
    expect(nextDescription).toContain("recovery_required");
    expect(nextDescription).toContain("never a status change");
    expect(tools.collab_workspace_status.description).toContain("liveness");
    const joined = await callTool(server, "collab_session_start", {
      root_path: root,
      actor: "mcp-bound",
    });
    const workspaceId = joined.structuredContent.workspace.id;
    expect(joined.structuredContent.session.liveness).toBe("live");
    const ghost = session("mcp-ghost");
    const ghostTask = createEditTask(ghost, "ghost-task", "src/ghost.ts");
    claimBriefly(ghost, ghostTask, "claim-ghost-task");

    advance(STALE_AFTER_MS + 1);
    const next = await callTool(server, "collab_next", { workspace_id: workspaceId });
    expect(next.isError).toBeUndefined();
    expect(next.structuredContent.session.liveness).toBe("live");
    expect(next.structuredContent.recovery_required.map((task: any) => [
      task.id,
      task.assignee_session_id,
      task.assignee_liveness,
    ])).toEqual([[ghostTask.id, ghost.session.id, "stale"]]);
    const status = await callTool(server, "collab_workspace_status", {
      workspace_id: workspaceId,
    });
    expect(
      status.structuredContent.active_sessions.find((item: any) => item.id === ghost.session.id)
        .liveness,
    ).toBe("stale");
    await server.close();
  });
});
