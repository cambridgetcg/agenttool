import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollabError } from "../src/errors.js";
import { buildCollabMcpServer } from "../src/mcp.js";
import type { CollabEvent, SessionHandle, SessionRest } from "../src/protocol.js";
import { CollabStore } from "../src/store.js";

const HOUR_MS = 60 * 60 * 1000;

let directory: string;
let root: string;
let store: CollabStore;
let currentTime: Date;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-rest-"));
  root = join(directory, "repo");
  mkdirSync(root);
  currentTime = new Date("2026-10-09T09:00:00.000Z");
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

function errorFrom(operation: () => unknown): CollabError {
  try {
    operation();
    throw new Error("expected operation to fail");
  } catch (error) {
    if (!(error instanceof CollabError)) throw error;
    return error;
  }
}

function headSequence(workspaceId: string): number {
  return store.eventsSince(workspaceId, 0, 500).head_sequence;
}

function restEvents(workspaceId: string): CollabEvent[] {
  return store.eventsSince(workspaceId, 0, 500).events.filter(
    (event) => event.type === "session.rested" || event.type === "session.returned",
  );
}

async function callTool(server: any, name: string, args: Record<string, unknown> = {}) {
  const registration = server._registeredTools[name];
  if (!registration) throw new Error(`tool not registered: ${name}`);
  return await (registration.handler ?? registration.callback)(args, {});
}

describe("declared rest", () => {
  test("declares rest with until, reason and wake_on and projects it on every session read", () => {
    const resting = session("rest-declarer");
    const peer = session("rest-peer");
    const until = fromNow(HOUR_MS);
    const declared = store.restSessionForSession({
      ...resting.credential,
      idempotency_key: "rest-declare",
      mode: "resting",
      until,
      reason: "  waiting for a review  ",
      wake_on: ["addressed"],
    });

    const events = restEvents(resting.workspace.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "session.rested",
      entity_id: resting.session.id,
      actor: "rest-declarer",
      session_id: resting.session.id,
      payload: {
        mode: "resting",
        until,
        reason: "waiting for a review",
        wake_on: ["addressed"],
      },
    });
    const expectedRest: SessionRest = {
      mode: "resting",
      since: events[0]!.occurred_at,
      until,
      reason: "waiting for a review",
      wake_on: ["addressed"],
    };
    expect(declared).toMatchObject({
      id: resting.session.id,
      status: "active",
      generation: resting.session.generation,
      rest: expectedRest,
    });
    expect(store.getCoordinationSession(resting.session.id)?.rest).toEqual(expectedRest);
    const listed = new Map(
      store.listCoordinationSessions(resting.workspace.id).map((item) => [item.id, item.rest]),
    );
    expect(listed.get(resting.session.id)).toEqual(expectedRest);
    expect(listed.get(peer.session.id)).toBeNull();
    expect(
      store.workspaceStatus(resting.workspace.id).active_sessions
        .find((item) => item.id === resting.session.id)?.rest,
    ).toEqual(expectedRest);
    expect(store.nextForSession(resting.credential).session.rest).toEqual(expectedRest);
    expect(store.nextForSession(peer.credential).session.rest).toBeNull();
    expect(store.verifyJournal(resting.workspace.id)).toBe(true);
  });

  test("reads an expired rest as not resting without appending anything, and an open rest as indefinite", () => {
    const expiring = session("rest-expiring");
    const indefinite = session("rest-indefinite");
    const until = fromNow(30 * 60 * 1000);
    store.restSessionForSession({
      ...expiring.credential,
      idempotency_key: "rest-expiring",
      mode: "resting",
      until,
    });
    store.restSessionForSession({
      ...indefinite.credential,
      idempotency_key: "rest-indefinite",
      mode: "resting",
    });
    const head = headSequence(expiring.workspace.id);

    advance(30 * 60 * 1000 - 1);
    expect(store.getCoordinationSession(expiring.session.id)?.rest).toMatchObject({
      until,
      reason: null,
      wake_on: [],
    });

    advance(1);
    expect(store.getCoordinationSession(expiring.session.id)?.rest).toBeNull();
    advance(30 * 24 * HOUR_MS);
    expect(store.getCoordinationSession(indefinite.session.id)?.rest).toMatchObject({
      mode: "resting",
      until: null,
      reason: null,
      wake_on: [],
    });
    expect(headSequence(expiring.workspace.id)).toBe(head);
  });

  test("returns with mode ready, naming the open rest it closes, and lets the latest rest win", () => {
    const returner = session("rest-returner");
    const workspaceId = returner.workspace.id;
    const first = store.restSessionForSession({
      ...returner.credential,
      idempotency_key: "rest-first",
      mode: "resting",
      wake_on: [],
    });
    advance(1_000);
    const second = store.restSessionForSession({
      ...returner.credential,
      idempotency_key: "rest-second",
      mode: "resting",
      reason: "again",
      wake_on: ["addressed"],
    });
    expect(second.rest).toMatchObject({ until: null, reason: "again", wake_on: ["addressed"] });
    expect(Date.parse(second.rest!.since)).toBe(Date.parse(first.rest!.since) + 1_000);

    advance(1_000);
    const returned = store.restSessionForSession({
      ...returner.credential,
      idempotency_key: "return-first",
      mode: "ready",
    });
    expect(returned.rest).toBeNull();
    const returnedAgain = store.restSessionForSession({
      ...returner.credential,
      idempotency_key: "return-second",
      mode: "ready",
    });
    expect(returnedAgain.rest).toBeNull();

    const expiring = store.restSessionForSession({
      ...returner.credential,
      idempotency_key: "rest-expires-before-return",
      mode: "resting",
      until: fromNow(60_000),
    });
    expect(expiring.rest).not.toBeNull();
    advance(120_000);
    store.restSessionForSession({
      ...returner.credential,
      idempotency_key: "return-after-expiry",
      mode: "ready",
    });

    const events = restEvents(workspaceId);
    expect(events.map((event) => event.type)).toEqual([
      "session.rested",
      "session.rested",
      "session.returned",
      "session.returned",
      "session.rested",
      "session.returned",
    ]);
    expect(events[2]!.payload).toEqual({ mode: "ready", prior_rest_sequence: events[1]!.sequence });
    expect(events[3]!.payload).toEqual({ mode: "ready", prior_rest_sequence: null });
    expect(events[5]!.payload).toEqual({ mode: "ready", prior_rest_sequence: events[4]!.sequence });
    expect(store.verifyJournal(workspaceId)).toBe(true);
  });

  test("replays an identical rest by idempotency key and refuses a different request under it", () => {
    const replayer = session("rest-replayer");
    const input = {
      ...replayer.credential,
      idempotency_key: "rest-replay",
      mode: "resting" as const,
      until: fromNow(HOUR_MS),
      wake_on: ["addressed" as const],
    };
    const first = store.restSessionForSession(input);
    const head = headSequence(replayer.workspace.id);

    // The stored receipt replays even after its until has passed: the future
    // check runs only when the rest is first declared.
    advance(2 * HOUR_MS);
    expect(store.restSessionForSession(input)).toEqual(first);
    expect(headSequence(replayer.workspace.id)).toBe(head);
    expect(errorFrom(() => store.restSessionForSession({ ...input, wake_on: [] })).code)
      .toBe("idempotency_conflict");
    expect(errorFrom(() => store.restSessionForSession({
      ...replayer.credential,
      idempotency_key: "rest-replay",
      mode: "ready",
    })).code).toBe("idempotency_conflict");
  });

  test("refuses malformed declarations without appending an event and normalizes until", () => {
    const validator = session("rest-validator");
    const base = { ...validator.credential, idempotency_key: "rest-validate" };
    const head = headSequence(validator.workspace.id);
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ mode: "sleeping" }, "invalid_mode"],
      [{ mode: "resting", until: "tomorrow" }, "invalid_until"],
      [{ mode: "resting", until: "2026-10-09T18:00:00" }, "invalid_until"],
      [{ mode: "resting", until: "2026-10-09" }, "invalid_until"],
      [{ mode: "resting", until: "2026-02-30T00:00:00Z" }, "invalid_until"],
      [{ mode: "resting", until: "2026-10-09T24:00:00Z" }, "invalid_until"],
      [{ mode: "resting", until: "2026-10-09T18:00:00+24:00" }, "invalid_until"],
      [{ mode: "resting", until: currentTime.toISOString() }, "invalid_until"],
      [{ mode: "resting", until: fromNow(-1) }, "invalid_until"],
      [{ mode: "resting", reason: "x".repeat(201) }, "invalid_reason"],
      [{ mode: "resting", reason: "nul\0byte" }, "invalid_reason"],
      [{ mode: "resting", wake_on: ["mentioned"] }, "invalid_wake_on"],
      [{ mode: "resting", wake_on: ["addressed", "addressed"] }, "invalid_wake_on"],
      [{ mode: "resting", wake_on: "addressed" }, "invalid_wake_on"],
      [{ mode: "ready", until: fromNow(60_000) }, "invalid_until"],
      [{ mode: "ready", reason: "" }, "invalid_reason"],
      [{ mode: "ready", wake_on: [] }, "invalid_wake_on"],
    ];
    for (const [fields, code] of cases) {
      const refused = errorFrom(() => store.restSessionForSession({ ...base, ...fields } as any));
      expect([fields, refused.code]).toEqual([fields, code]);
    }
    expect(headSequence(validator.workspace.id)).toBe(head);
    expect(store.getCoordinationSession(validator.session.id)?.rest).toBeNull();

    // An offset instant is accepted and stored as UTC with milliseconds.
    const offset = store.restSessionForSession({
      ...base,
      mode: "resting",
      until: "2026-10-09T11:00:00+01:00",
      reason: "x".repeat(200),
    });
    expect(offset.rest).toMatchObject({ until: "2026-10-09T10:00:00.000Z", reason: "x".repeat(200) });
  });

  test("rests only the caller's own session, keeps leases and generation, survives resume, and ends with the session", () => {
    const holder = session("rest-holder");
    const peer = session("rest-bystander");
    const task = store.createTaskForSession({
      ...holder.credential,
      idempotency_key: "rest-task",
      title: "held through a rest",
      work_mode: "edit",
      completion_policy: "accepted",
      path_scopes: ["src/rest.ts"],
    });
    const claimed = store.claimTaskForSession({
      ...holder.credential,
      idempotency_key: "rest-claim",
      task_id: task.id,
      expected_version: task.version,
    });

    expect(errorFrom(() => store.restSessionForSession({
      ...peer.credential,
      session_id: holder.session.id,
      idempotency_key: "rest-someone-else",
      mode: "resting",
    })).code).toBe("session_auth_failed");
    expect(store.getCoordinationSession(holder.session.id)?.rest).toBeNull();

    const rested = store.restSessionForSession({
      ...holder.credential,
      idempotency_key: "rest-while-holding",
      mode: "resting",
      wake_on: ["addressed"],
    });
    expect(rested).toMatchObject({ status: "active", generation: holder.session.generation });
    expect(store.getTask(task.workspace_id, task.id)).toMatchObject({
      status: "claimed",
      assignee_session_id: holder.session.id,
      lease_id: claimed.lease_id,
      lease_expires_at: claimed.lease_expires_at,
      version: claimed.version,
    });

    // A host resume (what a doorbell wake does) keeps the declared rest.
    const resumed = store.resumeSession({
      session_id: holder.credential.session_id,
      session_token: holder.credential.session_token,
    });
    expect(resumed.session.generation).toBe(holder.session.generation + 1);
    expect(resumed.session.rest).toEqual(rested.rest);
    expect(errorFrom(() => store.restSessionForSession({
      ...holder.credential,
      idempotency_key: "rest-stale-generation",
      mode: "ready",
    })).code).toBe("session_auth_failed");

    const ended = store.endSession({
      ...resumed.credential,
      reason: "done resting",
      release_leases: true,
    });
    expect(ended).toMatchObject({ status: "ended", rest: null });
    expect(store.getCoordinationSession(holder.session.id)?.rest).toBeNull();
    expect(errorFrom(() => store.restSessionForSession({
      ...resumed.credential,
      idempotency_key: "rest-after-end",
      mode: "resting",
    })).code).toBe("session_auth_failed");
  });

  test("binds collab_session_rest to the MCP process's own session", async () => {
    const server = buildCollabMcpServer(store);
    const tool = (server as any)._registeredTools.collab_session_rest;
    expect(Object.keys(tool.inputSchema.shape).sort()).toEqual([
      "idempotency_key",
      "mode",
      "reason",
      "until",
      "wake_on",
      "workspace_id",
    ]);
    expect(tool.inputSchema.safeParse({ idempotency_key: "k", mode: "ready" }).success).toBe(true);
    expect(tool.inputSchema.safeParse({ idempotency_key: "k", mode: "sleeping" }).success).toBe(false);
    expect(tool.inputSchema.safeParse({
      idempotency_key: "k",
      mode: "resting",
      wake_on: ["mentioned"],
    }).success).toBe(false);
    expect(tool.inputSchema.safeParse({
      idempotency_key: "k",
      mode: "resting",
      reason: "x".repeat(201),
    }).success).toBe(false);
    expect(tool.description).toContain("never inferred");
    expect(tool.description).toContain("never releases, extends, or reassigns leases");

    const unbound = await callTool(server, "collab_session_rest", {
      idempotency_key: "mcp-unbound-rest",
      mode: "resting",
    });
    expect(unbound.isError).toBe(true);
    expect(unbound.structuredContent.error).toBe("session_not_bound");

    const started = await callTool(server, "collab_session_start", {
      root_path: root,
      actor: "mcp-rester",
    });
    const workspaceId = started.structuredContent.workspace.id;
    const sessionId = started.structuredContent.session.id;
    expect(started.structuredContent.session.rest).toBeNull();

    const rested = await callTool(server, "collab_session_rest", {
      idempotency_key: "mcp-rest",
      mode: "resting",
      reason: "between turns",
      wake_on: ["addressed"],
    });
    expect(rested.isError).toBeUndefined();
    expect(rested.structuredContent.session).toMatchObject({
      id: sessionId,
      rest: { mode: "resting", until: null, reason: "between turns", wake_on: ["addressed"] },
    });

    const mismatch = await callTool(server, "collab_session_rest", {
      workspace_id: "ws_elsewhere",
      idempotency_key: "mcp-wrong-workspace",
      mode: "ready",
    });
    expect(mismatch.structuredContent.error).toBe("session_workspace_mismatch");

    const next = await callTool(server, "collab_next", { workspace_id: workspaceId });
    expect(next.structuredContent.session.rest).toMatchObject({ reason: "between turns" });

    const returned = await callTool(server, "collab_session_rest", {
      workspace_id: workspaceId,
      idempotency_key: "mcp-return",
      mode: "ready",
    });
    expect(returned.isError).toBeUndefined();
    expect(returned.structuredContent.session.rest).toBeNull();
    await server.close();
  });
});
