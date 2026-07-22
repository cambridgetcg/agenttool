import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { CollabError } from "../src/errors.js";
import { CollabStore, normalizePathScopes, pathConflicts } from "../src/store.js";

let directory: string;
let root: string;
let databasePath: string;
let store: CollabStore;
let currentTime: Date;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-"));
  root = join(directory, "repo");
  mkdirSync(root);
  databasePath = join(directory, "state", "collab.sqlite");
  currentTime = new Date("2026-07-21T12:00:00.000Z");
  store = new CollabStore(databasePath, { now: () => new Date(currentTime) });
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

describe("local journal", () => {
  test("opens one stable workspace with owner-only state and a valid hash chain", () => {
    const first = workspace();
    const second = store.openWorkspace({ root_path: root, actor: "another-agent" });

    expect(second.id).toBe(first.id);
    expect(store.eventsSince(first.id).events).toHaveLength(1);
    expect(store.verifyJournal(first.id)).toBe(true);
    expect(statSync(databasePath).mode & 0o777).toBe(0o600);
    expect(statSync(join(directory, "state")).mode & 0o777).toBe(0o700);
  });

  test("anchors a relative database path when the store is constructed", () => {
    store.close();
    const relativeDatabasePath = relative(process.cwd(), databasePath);
    store = new CollabStore(relativeDatabasePath, { now: () => new Date(currentTime) });

    expect(store.db.filename).toBe(resolve(relativeDatabasePath));
    expect(statSync(databasePath).mode & 0o777).toBe(0o600);
  });

  test("deduplicates committed mutations and rejects reuse with changed content", () => {
    const ws = workspace();
    const input = {
      workspace_id: ws.id,
      actor: "root",
      idempotency_key: "create-parser",
      title: "Build parser",
      path_scopes: ["src/parser"],
    };
    const first = store.createTask(input);
    const replay = store.createTask(input);

    expect(replay).toEqual(first);
    expect(store.listTasks(ws.id)).toHaveLength(1);
    expect(store.eventsSince(ws.id).events).toHaveLength(2);
    expect(errorCode(() => store.createTask({ ...input, title: "Different task" }))).toBe("idempotency_conflict");
    expect(store.eventsSince(ws.id).events).toHaveLength(2);
  });

  test("returns an idempotent claim receipt before checking a now-stale version", () => {
    const ws = workspace();
    const task = store.createTask({
      workspace_id: ws.id,
      actor: "root",
      idempotency_key: "create-a",
      title: "Task A",
    });
    const claimInput = {
      workspace_id: ws.id,
      task_id: task.id,
      actor: "agent-a",
      idempotency_key: "claim-a",
      expected_version: task.version,
    };
    const claimed = store.claimTask(claimInput);
    const progressed = store.progressTask({
      workspace_id: ws.id,
      task_id: task.id,
      actor: "agent-a",
      idempotency_key: "progress-a",
      expected_version: claimed.version,
      lease_id: claimed.lease_id!,
      message: "Parser complete; tests next.",
    });

    expect(progressed.version).toBe(3);
    expect(store.claimTask(claimInput)).toEqual(claimed);
    expect(errorCode(() => store.progressTask({
      workspace_id: ws.id,
      task_id: task.id,
      actor: "agent-a",
      idempotency_key: "stale-progress",
      expected_version: claimed.version,
      lease_id: claimed.lease_id!,
      message: "stale",
    }))).toBe("version_conflict");
  });

  test("detects segment-aware path conflicts without string-prefix false positives", () => {
    expect(normalizePathScopes(["./src/app/", "src//app", "src/z"])).toEqual(["src/app", "src/z"]);
    expect(pathConflicts(["src/app"], ["src/app/file.ts"])).toHaveLength(1);
    expect(pathConflicts(["src/app"], ["src/application"])).toHaveLength(0);
    expect(pathConflicts(["src/Foo.ts"], ["src/foo.ts"])).toHaveLength(1);
    expect(errorCode(() => normalizePathScopes(["../outside"]))).toBe("invalid_path_scope");

    const ws = workspace();
    const first = store.createTask({
      workspace_id: ws.id,
      actor: "root",
      idempotency_key: "create-first",
      title: "First",
      path_scopes: ["src/app"],
    });
    const overlapping = store.createTask({
      workspace_id: ws.id,
      actor: "root",
      idempotency_key: "create-overlap",
      title: "Overlap",
      path_scopes: ["src/app/file.ts"],
    });
    const sibling = store.createTask({
      workspace_id: ws.id,
      actor: "root",
      idempotency_key: "create-sibling",
      title: "Sibling",
      path_scopes: ["src/application"],
    });

    store.claimTask({
      workspace_id: ws.id,
      task_id: first.id,
      actor: "agent-a",
      idempotency_key: "claim-first",
      expected_version: 1,
    });
    expect(errorCode(() => store.claimTask({
      workspace_id: ws.id,
      task_id: overlapping.id,
      actor: "agent-b",
      idempotency_key: "claim-overlap",
      expected_version: 1,
    }))).toBe("path_scope_conflict");
    expect(store.claimTask({
      workspace_id: ws.id,
      task_id: sibling.id,
      actor: "agent-c",
      idempotency_key: "claim-sibling",
      expected_version: 1,
    }).assignee).toBe("agent-c");
  });

  test("blocks claims until every dependency completes", () => {
    const ws = workspace();
    const prerequisite = store.createTask({
      workspace_id: ws.id,
      actor: "root",
      idempotency_key: "create-prerequisite",
      title: "Prerequisite",
    });
    const dependent = store.createTask({
      workspace_id: ws.id,
      actor: "root",
      idempotency_key: "create-dependent",
      title: "Dependent",
      dependencies: [prerequisite.id],
    });
    expect(errorCode(() => store.claimTask({
      workspace_id: ws.id,
      task_id: dependent.id,
      actor: "agent-b",
      idempotency_key: "early-claim",
      expected_version: 1,
    }))).toBe("dependencies_incomplete");

    const claim = store.claimTask({
      workspace_id: ws.id,
      task_id: prerequisite.id,
      actor: "agent-a",
      idempotency_key: "claim-prerequisite",
      expected_version: 1,
    });
    store.completeTask({
      workspace_id: ws.id,
      task_id: prerequisite.id,
      actor: "agent-a",
      idempotency_key: "complete-prerequisite",
      expected_version: claim.version,
      lease_id: claim.lease_id!,
      summary: "Done",
    });
    expect(store.claimTask({
      workspace_id: ws.id,
      task_id: dependent.id,
      actor: "agent-b",
      idempotency_key: "late-claim",
      expected_version: 1,
    }).assignee).toBe("agent-b");
  });

  test("linearizes an expired lease before a new claim", () => {
    const ws = workspace();
    const task = store.createTask({
      workspace_id: ws.id,
      actor: "root",
      idempotency_key: "create-expiring",
      title: "Expiring task",
      path_scopes: ["src/leased.ts"],
    });
    const first = store.claimTask({
      workspace_id: ws.id,
      task_id: task.id,
      actor: "agent-a",
      idempotency_key: "claim-expiring",
      expected_version: 1,
      ttl_seconds: 30,
    });
    currentTime = new Date(first.lease_expires_at!);
    expect(store.getTask(ws.id, task.id).effective_status).toBe("lease_expired");
    expect(errorCode(() => store.renewLease({
      workspace_id: ws.id,
      task_id: task.id,
      actor: "agent-a",
      idempotency_key: "renew-expired",
      expected_version: first.version,
      lease_id: first.lease_id!,
    }))).toBe("lease_expired");

    const reclaimed = store.claimTask({
      workspace_id: ws.id,
      task_id: task.id,
      actor: "agent-b",
      idempotency_key: "reclaim",
      expected_version: first.version,
    });
    expect(reclaimed.assignee).toBe("agent-b");
    expect(reclaimed.version).toBe(4);
    const types = store.eventsSince(ws.id).events.map((event) => event.type);
    expect(types.slice(-2)).toEqual(["task.claim_expired", "task.claimed"]);
  });

  test("two database handles allow exactly one claimant at one expected version", async () => {
    const ws = workspace();
    const task = store.createTask({
      workspace_id: ws.id,
      actor: "root",
      idempotency_key: "create-race",
      title: "Race",
    });
    const second = new CollabStore(databasePath, { now: () => new Date(currentTime) });
    try {
      const results = await Promise.allSettled([
        Promise.resolve().then(() => store.claimTask({
          workspace_id: ws.id,
          task_id: task.id,
          actor: "agent-a",
          idempotency_key: "race-a",
          expected_version: 1,
        })),
        Promise.resolve().then(() => second.claimTask({
          workspace_id: ws.id,
          task_id: task.id,
          actor: "agent-b",
          idempotency_key: "race-b",
          expected_version: 1,
        })),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      expect(store.listTasks(ws.id).filter((item) => item.effective_status === "claimed")).toHaveLength(1);
      expect(store.eventsSince(ws.id).events.filter((event) => event.type === "task.claimed")).toHaveLength(1);
    } finally {
      second.close();
    }
  });

  test("two operating-system processes allow exactly one claimant", async () => {
    const ws = workspace();
    const task = store.createTask({
      workspace_id: ws.id,
      actor: "root",
      idempotency_key: "create-process-race",
      title: "Process race",
    });
    const worker = join(import.meta.dir, "claim-worker.ts");
    const startAt = String(Date.now() + 200);
    const run = async (actor: string) => {
      const child = Bun.spawn([
        process.execPath,
        worker,
        databasePath,
        ws.id,
        task.id,
        actor,
        `process-race-${actor}`,
        startAt,
      ], { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (exitCode !== 0) throw new Error(`claim worker failed: ${stderr}`);
      return JSON.parse(stdout) as { ok: boolean; assignee?: string; error?: string };
    };

    const results = await Promise.all([run("process-a"), run("process-b")]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok).map((result) => result.error)).toEqual(["version_conflict"]);
    expect(store.eventsSince(ws.id).events.filter((event) => event.type === "task.claimed")).toHaveLength(1);
  });

  test("handoff remains an invitation until the named recipient accepts", () => {
    const ws = workspace();
    const task = store.createTask({
      workspace_id: ws.id,
      actor: "root",
      idempotency_key: "create-handoff",
      title: "Handoff task",
      path_scopes: ["src/handoff.ts"],
    });
    const claim = store.claimTask({
      workspace_id: ws.id,
      task_id: task.id,
      actor: "agent-a",
      idempotency_key: "claim-handoff",
      expected_version: 1,
    });
    const offered = store.offerHandoff({
      workspace_id: ws.id,
      task_id: task.id,
      actor: "agent-a",
      to_actor: "agent-b",
      idempotency_key: "offer-handoff",
      expected_version: claim.version,
      lease_id: claim.lease_id!,
      summary: "Parser is done; please finish integration.",
    });

    const offeredTask = store.getTask(ws.id, task.id);
    expect(offeredTask.assignee).toBe("agent-a");
    expect(offered.task.version).toBe(3);
    expect(store.nextForActor(ws.id, "agent-b").handoff_offers[0]?.handoff.id).toBe(offered.handoff.id);
    expect(errorCode(() => store.respondHandoff({
      workspace_id: ws.id,
      handoff_id: offered.handoff.id,
      actor: "agent-c",
      idempotency_key: "wrong-recipient",
      expected_version: offeredTask.version,
      response: "accept",
    }))).toBe("handoff_not_recipient");

    const accepted = store.respondHandoff({
      workspace_id: ws.id,
      handoff_id: offered.handoff.id,
      actor: "agent-b",
      idempotency_key: "accept-handoff",
      expected_version: offeredTask.version,
      response: "accept",
    });
    expect(accepted.handoff.status).toBe("accepted");
    expect(accepted.task.assignee).toBe("agent-b");
    expect(accepted.task.lease_id).not.toBe(claim.lease_id);
  });

  test("rejects invalid direct-API handoff responses and linearizes elapsed offers", () => {
    const ws = workspace();
    const task = store.createTask({
      workspace_id: ws.id,
      actor: "root",
      idempotency_key: "create-expiring-handoff",
      title: "Expiring handoff",
    });
    const claim = store.claimTask({
      workspace_id: ws.id,
      task_id: task.id,
      actor: "agent-a",
      idempotency_key: "claim-expiring-handoff",
      expected_version: 1,
    });
    const offered = store.offerHandoff({
      workspace_id: ws.id,
      task_id: task.id,
      actor: "agent-a",
      to_actor: "agent-b",
      idempotency_key: "offer-expiring-handoff",
      expected_version: claim.version,
      lease_id: claim.lease_id!,
      summary: "Please take over",
      ttl_seconds: 30,
    });
    expect(errorCode(() => store.respondHandoff({
      workspace_id: ws.id,
      handoff_id: offered.handoff.id,
      actor: "agent-b",
      idempotency_key: "invalid-response",
      expected_version: offered.task.version,
      response: "garbage",
    } as any))).toBe("invalid_handoff_response");

    currentTime = new Date(offered.handoff.expires_at);
    expect(store.nextForActor(ws.id, "agent-b").handoff_offers).toEqual([]);
    expect(store.getTask(ws.id, task.id).assignee).toBe("agent-a");
    expect(store.eventsSince(ws.id).events.at(-1)?.type).toBe("handoff.expired");
    expect(errorCode(() => store.respondHandoff({
      workspace_id: ws.id,
      handoff_id: offered.handoff.id,
      actor: "agent-b",
      idempotency_key: "late-response",
      expected_version: offered.task.version,
      response: "accept",
    }))).toBe("handoff_expired");
  });

  test("caps dependency and path-scope collections at the store boundary", () => {
    const ws = workspace();
    expect(errorCode(() => store.createTask({
      workspace_id: ws.id,
      actor: "root",
      idempotency_key: "too-many-paths",
      title: "Too many paths",
      path_scopes: Array.from({ length: 129 }, (_, index) => `src/${index}`),
    }))).toBe("invalid_path_scopes");
    expect(errorCode(() => store.createTask({
      workspace_id: ws.id,
      actor: "root",
      idempotency_key: "too-many-dependencies",
      title: "Too many dependencies",
      dependencies: Array.from({ length: 129 }, (_, index) => `task-${index}`),
    }))).toBe("invalid_dependencies");
  });

  test("attaches references, records decisions, and paginates an intact journal", () => {
    const ws = workspace();
    const task = store.createTask({
      workspace_id: ws.id,
      actor: "root",
      idempotency_key: "create-artifact",
      title: "Artifact task",
    });
    const claim = store.claimTask({
      workspace_id: ws.id,
      task_id: task.id,
      actor: "agent-a",
      idempotency_key: "claim-artifact",
      expected_version: 1,
    });
    const attached = store.attachArtifact({
      workspace_id: ws.id,
      task_id: task.id,
      actor: "agent-a",
      idempotency_key: "attach-artifact",
      expected_version: claim.version,
      lease_id: claim.lease_id!,
      kind: "file",
      uri: "src/result.ts",
      sha256: "a".repeat(64),
    });
    store.recordDecision({
      workspace_id: ws.id,
      actor: "root",
      idempotency_key: "decision-1",
      topic: "State authority",
      decision: "SQLite remains authoritative; hosted sync is opt-in.",
    });

    expect(store.getTask(ws.id, task.id).artifacts?.[0]?.id).toBe(attached.artifact.id);
    const first = store.eventsSince(ws.id, 0, 2);
    const second = store.eventsSince(ws.id, first.next_cursor, 20);
    expect(first.events.at(-1)!.sequence + 1).toBe(second.events[0]!.sequence);
    expect(second.head_sequence).toBe(first.events.length + second.events.length);
    expect(second.chain_valid).toBe(true);
    expect(second.verification_scope).toBe("returned_page");
  });

  test("rejects future cursors and detects tampering in a returned page", () => {
    const ws = workspace();
    store.recordDecision({
      workspace_id: ws.id,
      actor: "root",
      idempotency_key: "tamper-decision",
      topic: "Audit",
      decision: "Keep the event segment verifiable.",
    });
    const head = store.eventsSince(ws.id).head_sequence;
    expect(errorCode(() => store.eventsSince(ws.id, head + 1))).toBe("invalid_cursor");

    store.db.query(`UPDATE events SET payload_json = ? WHERE workspace_id = ? AND sequence = 2`)
      .run('{"decision":"changed"}', ws.id);
    expect(store.eventsSince(ws.id, 0).chain_valid).toBe(false);
    expect(store.verifyJournal(ws.id)).toBe(false);
  });
});
