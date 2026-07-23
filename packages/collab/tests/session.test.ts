import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { CollabError } from "../src/errors.js";
import { CollabStore } from "../src/store.js";

let directory: string;
let root: string;
let store: CollabStore;
let currentTime: Date;

beforeEach(() => {
  directory = mkdtempSync(joinPath(tmpdir(), "agenttool-collab-session-"));
  root = joinPath(directory, "repo");
  mkdirSync(root);
  currentTime = new Date("2026-07-23T08:00:00.000Z");
  store = new CollabStore(joinPath(directory, "collab.sqlite"), {
    now: () => new Date(currentTime),
  });
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function workspace() {
  return store.openWorkspace({ root_path: root, actor: "root" });
}

function errorCode(operation: () => unknown): string {
  try {
    operation();
    throw new Error("expected operation to fail");
  } catch (error) {
    if (!(error instanceof CollabError)) throw error;
    return error.code;
  }
}

function join(
  workspaceId: string,
  clientInstanceId: string,
  runtimeKind: string,
  overrides: Record<string, unknown> = {},
) {
  return store.joinSession({
    workspace_id: workspaceId,
    client_instance_id: clientInstanceId,
    actor_label: "worker",
    runtime_kind: runtimeKind,
    ttl_seconds: 30,
    ...overrides,
  });
}

describe("cross-host sessions", () => {
  test("linearizes one client incarnation across operating-system processes", async () => {
    const ws = workspace();
    const worker = joinPath(import.meta.dir, "session-worker.ts");
    const startAt = String(Date.now() + 200);
    const databasePath = joinPath(directory, "collab.sqlite");
    const run = async () => {
      const child = Bun.spawn([
        process.execPath,
        worker,
        databasePath,
        ws.id,
        "shared-client-incarnation",
        startAt,
      ], { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (exitCode !== 0) throw new Error(`session worker failed: ${stderr}`);
      return JSON.parse(stdout) as {
        ok: boolean;
        session_id?: string;
        actor_key?: string;
        error?: string;
      };
    };

    const [first, second] = await Promise.all([run(), run()]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first.session_id).toBe(second.session_id);
    expect(first.actor_key).toBe(second.actor_key);
    expect(store.listSessions(ws.id)).toHaveLength(1);
  });

  test("adds sessions to a legacy journal without changing its task history", () => {
    const ws = workspace();
    const task = store.createTask({
      workspace_id: ws.id,
      actor: "root",
      idempotency_key: "legacy-task",
      title: "Preserve me",
    });
    const databasePath = joinPath(directory, "collab.sqlite");
    const head = store.eventsSince(ws.id).head_hash;
    store.close();

    const legacyShape = new Database(databasePath);
    legacyShape.run("DROP TABLE sessions");
    legacyShape.close();

    store = new CollabStore(databasePath);
    expect(store.getTask(ws.id, task.id)).toMatchObject(task);
    expect(store.verifyJournal(ws.id)).toBe(true);
    expect(store.eventsSince(ws.id).head_hash).toBe(head);
    const session = join(ws.id, "new-client", "codex");
    expect(session.protocol).toBe("agenttool.collab.session/0.1");
    expect(store.eventsSince(ws.id).head_hash).toBe(head);
  });

  test("gives duplicate display labels distinct actor and idempotency scopes", () => {
    const ws = workspace();
    const codex = join(ws.id, "codex-process-1", "Codex");
    const hermes = join(ws.id, "hermes-process-1", "Hermes");
    expect(codex.actor_label).toBe("worker");
    expect(hermes.actor_label).toBe("worker");
    expect(codex.id).not.toBe(hermes.id);
    expect(codex.actor_key).not.toBe(hermes.actor_key);
    expect(codex.runtime_kind).toBe("codex");
    expect(hermes.runtime_kind).toBe("hermes");

    const first = store.createTask({
      workspace_id: ws.id,
      actor: "root",
      idempotency_key: "create-first",
      title: "First",
    });
    const second = store.createTask({
      workspace_id: ws.id,
      actor: "root",
      idempotency_key: "create-second",
      title: "Second",
    });
    expect(store.claimTask({
      workspace_id: ws.id,
      task_id: first.id,
      actor: codex.actor_key,
      idempotency_key: "same-retry-key",
      expected_version: 1,
    }).assignee).toBe(codex.actor_key);
    expect(store.claimTask({
      workspace_id: ws.id,
      task_id: second.id,
      actor: hermes.actor_key,
      idempotency_key: "same-retry-key",
      expected_version: 1,
    }).assignee).toBe(hermes.actor_key);
  });

  test("replays one client instance and rejects changed self-declared metadata", () => {
    const ws = workspace();
    const input = {
      workspace_id: ws.id,
      client_instance_id: "claude-process-1",
      actor_label: "reviewer",
      runtime_kind: "claude-code",
      provider_label: "anthropic",
      model_label: "self-declared-model",
      declared_capabilities: ["Review", "read", "review"],
      ttl_seconds: 30,
    };
    const first = store.joinSession(input);
    expect(store.joinSession(input)).toEqual(first);
    currentTime = new Date("2026-07-23T08:00:05.000Z");
    expect(store.joinSession({ ...input, ttl_seconds: 3_600 })).toEqual(first);
    expect(first.declared_capabilities).toEqual(["read", "review"]);
    expect(first.capability_basis).toBe("self_declared");
    expect(errorCode(() => store.joinSession({
      ...input,
      model_label: "different-model",
    }))).toBe("session_instance_conflict");
  });

  test("bounds session listings and filters presence before applying the limit", () => {
    const ws = workspace();
    const first = join(ws.id, "first-live", "codex");
    currentTime = new Date("2026-07-23T08:00:01.000Z");
    const second = join(ws.id, "second-live", "claude-code");
    currentTime = new Date(first.presence_expires_at);

    expect(store.listSessions(ws.id, undefined, 1).map((session) => session.id))
      .toEqual([second.id]);
    expect(store.listSessions(ws.id, "stale", 1).map((session) => session.id))
      .toEqual([first.id]);
    expect(errorCode(() => store.listSessions(ws.id, undefined, 501)))
      .toBe("invalid_session_list_limit");
  });

  test("uses retry-safe heartbeats without journaling presence noise", () => {
    const ws = workspace();
    const session = join(ws.id, "hermes-process-1", "hermes");
    expect(store.eventsSince(ws.id).events).toHaveLength(1);

    currentTime = new Date("2026-07-23T08:00:10.000Z");
    const heartbeatInput = {
      session_id: session.id,
      idempotency_key: "heartbeat-1",
      expected_version: session.version,
      ttl_seconds: 30,
    };
    const heartbeat = store.heartbeatSession(heartbeatInput);
    expect(heartbeat.version).toBe(2);
    expect(heartbeat.last_seen_at).toBe("2026-07-23T08:00:10.000Z");
    expect(heartbeat.presence_expires_at).toBe("2026-07-23T08:00:40.000Z");

    currentTime = new Date("2026-07-23T08:00:20.000Z");
    expect(store.heartbeatSession(heartbeatInput)).toEqual(heartbeat);
    expect(errorCode(() => store.heartbeatSession({
      ...heartbeatInput,
      idempotency_key: "heartbeat-stale-version",
    }))).toBe("session_version_conflict");
    expect(store.eventsSince(ws.id).events).toHaveLength(1);

    currentTime = new Date(heartbeat.presence_expires_at);
    expect(store.getSession(session.id).presence).toBe("stale");
    const revived = store.heartbeatSession({
      session_id: session.id,
      idempotency_key: "heartbeat-revive",
      expected_version: heartbeat.version,
      ttl_seconds: 30,
    });
    expect(revived.presence).toBe("live");
    expect(revived.version).toBe(3);
  });

  test("keeps presence independent from task leases and path claims", () => {
    const ws = workspace();
    const session = join(ws.id, "codex-process-1", "codex");
    const first = store.createTask({
      workspace_id: ws.id,
      actor: "root",
      idempotency_key: "create-leased",
      title: "Leased",
      path_scopes: ["src/shared"],
    });
    const overlapping = store.createTask({
      workspace_id: ws.id,
      actor: "root",
      idempotency_key: "create-overlap",
      title: "Overlap",
      path_scopes: ["src/shared/file.ts"],
    });
    const claimed = store.claimTask({
      workspace_id: ws.id,
      task_id: first.id,
      actor: session.actor_key,
      idempotency_key: "claim-leased",
      expected_version: first.version,
      ttl_seconds: 60,
    });

    currentTime = new Date(session.presence_expires_at);
    expect(store.getSession(session.id).presence).toBe("stale");
    expect(store.getTask(ws.id, first.id)).toMatchObject(claimed);
    expect(errorCode(() => store.claimTask({
      workspace_id: ws.id,
      task_id: overlapping.id,
      actor: "another-session",
      idempotency_key: "claim-overlap",
      expected_version: overlapping.version,
    }))).toBe("path_scope_conflict");

    const left = store.leaveSession({
      session_id: session.id,
      idempotency_key: "leave",
      expected_version: session.version,
    });
    expect(left.presence).toBe("left");
    expect(store.getTask(ws.id, first.id)).toMatchObject(claimed);
    expect(store.leaveSession({
      session_id: session.id,
      idempotency_key: "leave",
      expected_version: session.version,
    })).toEqual(left);
    expect(errorCode(() => store.heartbeatSession({
      session_id: session.id,
      idempotency_key: "heartbeat-after-leave",
      expected_version: left.version,
    }))).toBe("session_left");
    expect(errorCode(() => join(ws.id, "codex-process-1", "codex")))
      .toBe("session_instance_ended");
  });

  test("routes handoffs to an exact session even when labels match", () => {
    const ws = workspace();
    const source = join(ws.id, "source", "codex");
    const intended = join(ws.id, "intended", "claude-code");
    const duplicateLabel = join(ws.id, "duplicate", "hermes");
    const task = store.createTask({
      workspace_id: ws.id,
      actor: "root",
      idempotency_key: "create-handoff",
      title: "Exact recipient",
    });
    const claimed = store.claimTask({
      workspace_id: ws.id,
      task_id: task.id,
      actor: source.actor_key,
      idempotency_key: "claim-handoff",
      expected_version: task.version,
    });
    const offered = store.offerHandoff({
      workspace_id: ws.id,
      task_id: task.id,
      actor: source.actor_key,
      to_actor: intended.actor_key,
      idempotency_key: "offer-handoff",
      expected_version: claimed.version,
      lease_id: claimed.lease_id!,
      summary: "Please continue.",
    });
    expect(store.nextForActor(ws.id, duplicateLabel.actor_key).handoff_offers)
      .toHaveLength(0);
    expect(errorCode(() => store.respondHandoff({
      workspace_id: ws.id,
      handoff_id: offered.handoff.id,
      actor: duplicateLabel.actor_key,
      idempotency_key: "wrong-recipient",
      expected_version: offered.task.version,
      response: "accept",
    }))).toBe("handoff_not_recipient");
    expect(store.getTask(ws.id, task.id).assignee).toBe(source.actor_key);

    const accepted = store.respondHandoff({
      workspace_id: ws.id,
      handoff_id: offered.handoff.id,
      actor: intended.actor_key,
      idempotency_key: "accept",
      expected_version: offered.task.version,
      response: "accept",
    });
    expect(accepted.task.assignee).toBe(intended.actor_key);
  });

  test("treats capabilities as bounded routing hints, not permission", () => {
    const ws = workspace();
    const session = join(ws.id, "custom-process", "custom-runtime", {
      declared_capabilities: ["read"],
    });
    const task = store.createTask({
      workspace_id: ws.id,
      actor: "root",
      idempotency_key: "create-unrelated",
      title: "Capabilities do not authorize",
      path_scopes: ["src/edit.ts"],
    });
    expect(store.claimTask({
      workspace_id: ws.id,
      task_id: task.id,
      actor: session.actor_key,
      idempotency_key: "claim-unrelated",
      expected_version: task.version,
    }).assignee).toBe(session.actor_key);
    expect(store.listSessions(ws.id, "live")).toHaveLength(1);
    expect(store.listSessions(ws.id, "left")).toHaveLength(0);
  });
});
