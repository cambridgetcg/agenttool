import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  basename,
  dirname,
  join,
} from "node:path";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { canonicalJson } from "../src/canonical.js";
import { CollabError } from "../src/errors.js";
import type { SessionHandle } from "../src/protocol.js";
import { CollabStore } from "../src/store.js";

const GENESIS_HASH = "0".repeat(64);
const APPLICATION_ID = 0x4154434c;

let directory: string;
let root: string;
let databasePath: string;
let store: CollabStore;
let currentTime: Date;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-v2-"));
  root = join(directory, "repo");
  mkdirSync(root);
  databasePath = join(directory, "state", "collab.sqlite");
  currentTime = new Date("2026-07-23T10:00:00.000Z");
  store = new CollabStore(databasePath, { now: () => new Date(currentTime) });
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function session(actor: string, rootPath = root): SessionHandle {
  return store.startSession({ root_path: rootPath, actor });
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

function errorCode(operation: () => unknown): string {
  return errorFrom(operation).code;
}

function runGit(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 || result.error) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.error?.message}`);
  }
  return result.stdout.trim();
}

function initializeGitRepository(): void {
  runGit(root, "init", "--initial-branch=main");
  runGit(root, "config", "user.name", "Collab Test");
  runGit(root, "config", "user.email", "collab-test@example.invalid");
  writeFileSync(join(root, "README.md"), "# fixture\n");
  runGit(root, "add", "README.md");
  runGit(root, "commit", "-m", "fixture");
}

function createAcceptedEditTask(
  owner: SessionHandle,
  idempotencyKey: string,
  pathScope: string,
) {
  return store.createTaskForSession({
    ...owner.credential,
    idempotency_key: idempotencyKey,
    title: idempotencyKey,
    work_mode: "edit",
    completion_policy: "accepted",
    path_scopes: [pathScope],
  });
}

describe("agenttool.collab/0.2 session coordination", () => {
  test("maps linked Git worktrees to one repository workspace", () => {
    initializeGitRepository();
    const linkedRoot = join(directory, "linked-worktree");
    runGit(root, "worktree", "add", "-b", "linked-test", linkedRoot);

    const first = store.openWorkspace({ root_path: root, actor: "coordinator" });
    const linked = store.openWorkspace({ root_path: linkedRoot, actor: "worker" });

    expect(linked.id).toBe(first.id);
    expect(linked.repository_key).toBe(first.repository_key);
    expect(store.getWorktree(first.id, root)?.id).not.toBe(
      store.getWorktree(first.id, linkedRoot)?.id,
    );
    expect(
      (
        store.db.query("SELECT COUNT(*) AS count FROM workspaces").get() as {
          count: number;
        }
      ).count,
    ).toBe(1);
    expect(
      (
        store.db.query("SELECT COUNT(*) AS count FROM worktrees").get() as {
          count: number;
        }
      ).count,
    ).toBe(2);
  });

  test("keeps session bearer values out of persisted state and distinguishes equal actor labels", () => {
    const first = session("same-actor");
    const second = session("same-actor");
    expect(second.session.id).not.toBe(first.session.id);
    expect(second.credential.session_token).not.toBe(first.credential.session_token);
    expect(store.listCoordinationSessions(first.workspace.id)).toHaveLength(2);

    store.createTaskForSession({
      ...first.credential,
      idempotency_key: "persist-safe-task",
      title: "Persist safe task",
      work_mode: "coordination",
    });

    const persistedRows = JSON.stringify({
      sessions: store.db.query("SELECT * FROM sessions").all(),
      events: store.db.query("SELECT * FROM events").all(),
      mutations: store.db.query("SELECT * FROM mutations").all(),
    });
    for (const token of [
      first.credential.session_token,
      second.credential.session_token,
    ]) {
      expect(persistedRows.includes(token)).toBe(false);
      for (const name of readdirSync(dirname(databasePath))) {
        if (!name.startsWith(basename(databasePath))) continue;
        expect(readFileSync(join(dirname(databasePath), name)).includes(Buffer.from(token))).toBe(
          false,
        );
      }
    }
  });

  test("fences stale generations while retaining one retryable resume token", () => {
    const joined = session("worker");
    const created = store.createTaskForSession({
      ...joined.credential,
      idempotency_key: "resume-safe-create",
      title: "Resume-safe create",
      work_mode: "coordination",
    });

    const resumed = store.resumeSession(joined.credential);
    expect(resumed.credential.session_token).toBe(joined.credential.session_token);
    expect(resumed.credential.generation).toBe(joined.credential.generation + 1);
    expect(
      errorCode(() =>
        store.createTaskForSession({
          ...joined.credential,
          idempotency_key: "stale-generation-create",
          title: "Must not be created",
          work_mode: "coordination",
        }),
      ),
    ).toBe("session_auth_failed");

    const replay = store.createTaskForSession({
      ...resumed.credential,
      idempotency_key: "resume-safe-create",
      title: "Resume-safe create",
      work_mode: "coordination",
    });
    expect(replay).toEqual(created);

    const resumedAgain = store.resumeSession(resumed.credential);
    expect(resumedAgain.credential.session_token).toBe(joined.credential.session_token);
    expect(resumedAgain.credential.generation).toBe(resumed.credential.generation + 1);
  });

  test("requires explicit path scopes for v2 edit tasks", () => {
    const worker = session("worker");
    expect(
      errorCode(() =>
        store.createTaskForSession({
          ...worker.credential,
          idempotency_key: "unscoped-edit",
          title: "Unscoped edit",
          work_mode: "edit",
        }),
      ),
    ).toBe("edit_scope_required");

    const readOnly = store.createTaskForSession({
      ...worker.credential,
      idempotency_key: "unscoped-read",
      title: "Unscoped read",
      work_mode: "read_only",
    });
    expect(readOnly.path_scopes).toEqual([]);
  });

  test("projects overlapping open tasks as conflicted rather than ready", () => {
    const holder = session("holder");
    const observer = session("observer");
    const active = createAcceptedEditTask(holder, "active-edit", "src/feature");
    const overlapping = createAcceptedEditTask(
      holder,
      "overlapping-edit",
      "src/feature/parser.ts",
    );
    const disjoint = createAcceptedEditTask(holder, "disjoint-edit", "tests/feature.test.ts");
    store.claimTaskForSession({
      ...holder.credential,
      idempotency_key: "claim-active-edit",
      task_id: active.id,
      expected_version: active.version,
    });

    const next = store.nextForSession(observer.credential);
    expect(next.ready_tasks.map((task) => task.id)).toEqual([disjoint.id]);
    expect(next.claimable_tasks.map((task) => task.id)).toEqual([disjoint.id]);
    expect(next.conflicted_tasks.map(({ task }) => task.id)).toEqual([overlapping.id]);
    expect(next.conflicted_tasks[0]?.conflicts[0]?.active_task_id).toBe(active.id);
    expect(next.conflicted_tasks[0]?.conflicts[0]?.path_pairs).toEqual([
      ["src/feature/parser.ts", "src/feature"],
    ]);
  });

  test("blocks dependents until a distinct session accepts reported completion", () => {
    const implementer = session("worker");
    const reviewer = session("worker");
    const prerequisite = createAcceptedEditTask(
      implementer,
      "reviewed-prerequisite",
      "src/reviewed.ts",
    );
    const dependent = store.createTaskForSession({
      ...implementer.credential,
      idempotency_key: "dependent-task",
      title: "Dependent",
      work_mode: "coordination",
      dependencies: [prerequisite.id],
    });
    const claim = store.claimTaskForSession({
      ...implementer.credential,
      idempotency_key: "claim-reviewed-prerequisite",
      task_id: prerequisite.id,
      expected_version: prerequisite.version,
    });
    const reported = store.completeTaskForSession({
      ...implementer.credential,
      idempotency_key: "report-reviewed-prerequisite",
      task_id: prerequisite.id,
      lease_id: claim.lease_id!,
      expected_version: claim.version,
      summary: "Implementation and local checks are complete.",
    });
    expect(reported.effective_status).toBe("reported_complete");
    expect(reported.review_status).toBe("pending");
    expect(
      store.nextForSession(reviewer.credential).claimable_tasks.some(
        (task) => task.id === dependent.id,
      ),
    ).toBe(false);
    expect(
      errorCode(() =>
        store.claimTaskForSession({
          ...reviewer.credential,
          idempotency_key: "claim-dependent-too-early",
          task_id: dependent.id,
          expected_version: dependent.version,
        }),
      ),
    ).toBe("dependencies_incomplete");
    expect(
      errorCode(() =>
        store.reviewTaskForSession({
          ...implementer.credential,
          idempotency_key: "self-review",
          task_id: prerequisite.id,
          expected_version: reported.version,
          outcome: "accept",
          summary: "Self acceptance must not count.",
        }),
      ),
    ).toBe("self_review_forbidden");

    const accepted = store.reviewTaskForSession({
      ...reviewer.credential,
      idempotency_key: "distinct-review",
      task_id: prerequisite.id,
      expected_version: reported.version,
      outcome: "accept",
      summary: "Reviewed the task evidence and result.",
    });
    expect(accepted.task.review_status).toBe("accepted");
    expect(accepted.task.accepted_by_session_id).toBe(reviewer.session.id);
    expect(accepted.task.reported_by_session_id).toBe(implementer.session.id);
    expect(
      store.nextForSession(reviewer.credential).claimable_tasks.some(
        (task) => task.id === dependent.id,
      ),
    ).toBe(true);
  });

  test("prevents acceptance while a structured challenge is unresolved", () => {
    const implementer = session("implementer");
    const reviewer = session("reviewer");
    const challenger = session("challenger");
    const task = createAcceptedEditTask(implementer, "challenged-task", "src/challenged.ts");
    const claim = store.claimTaskForSession({
      ...implementer.credential,
      idempotency_key: "claim-challenged-task",
      task_id: task.id,
      expected_version: task.version,
    });
    const reported = store.completeTaskForSession({
      ...implementer.credential,
      idempotency_key: "report-challenged-task",
      task_id: task.id,
      lease_id: claim.lease_id!,
      expected_version: claim.version,
      summary: "Reported complete.",
      confidence: "high",
      confidence_basis: "Local checks passed.",
    });
    const challenge = store.appendReportForSession({
      ...challenger.credential,
      idempotency_key: "challenge-completion",
      task_id: task.id,
      kind: "inference",
      body: "One stated invariant is not yet demonstrated.",
      confidence: "medium",
      confidence_basis: "The completion report lacks that evidence.",
      relation: "challenges",
      target_report_id: reported.completion_report_id!,
    });
    expect(challenge.relation).toBe("challenges");
    expect(
      errorCode(() =>
        store.reviewTaskForSession({
          ...reviewer.credential,
          idempotency_key: "accept-before-resolution",
          task_id: task.id,
          expected_version: reported.version,
          outcome: "accept",
          summary: "Premature acceptance.",
        }),
      ),
    ).toBe("completion_challenged");

    const resolution = store.appendReportForSession({
      ...implementer.credential,
      idempotency_key: "resolve-completion-challenge",
      task_id: task.id,
      kind: "observation",
      body: "The missing invariant was checked and the result is recorded here.",
      evidence_refs: [`report:${challenge.id}`],
      confidence: "high",
      confidence_basis: "The follow-up check directly covers the challenge.",
      relation: "resolves",
      target_report_id: challenge.id,
    });
    expect(resolution.relation).toBe("resolves");
    store.appendReportForSession({
      ...implementer.credential,
      idempotency_key: "withdraw-completion-resolution",
      task_id: task.id,
      kind: "observation",
      body: "That resolution is withdrawn because its follow-up evidence was incomplete.",
      relation: "withdraws",
      target_report_id: resolution.id,
    });
    expect(
      errorCode(() =>
        store.reviewTaskForSession({
          ...reviewer.credential,
          idempotency_key: "accept-after-withdrawn-resolution",
          task_id: task.id,
          expected_version: reported.version,
          outcome: "accept",
          summary: "A withdrawn resolution must not clear the challenge.",
        }),
      ),
    ).toBe("completion_challenged");
    store.appendReportForSession({
      ...implementer.credential,
      idempotency_key: "replace-withdrawn-resolution",
      task_id: task.id,
      kind: "observation",
      body: "A new direct check now resolves the original challenge.",
      confidence: "high",
      confidence_basis: "The replacement evidence directly covers the invariant.",
      relation: "resolves",
      target_report_id: challenge.id,
    });

    const accepted = store.reviewTaskForSession({
      ...reviewer.credential,
      idempotency_key: "accept-after-resolution",
      task_id: task.id,
      expected_version: reported.version,
      outcome: "accept",
      summary: "The challenge is resolved and the result is accepted locally.",
    });
    expect(accepted.task.review_status).toBe("accepted");
    expect(accepted.report.relation).toBe("supports");
  });

  test("requires explicit recovery for expired session leases and retains prior context", () => {
    const first = session("first-worker");
    const recovery = session("recovery-worker");
    const task = createAcceptedEditTask(first, "recoverable-task", "src/recoverable.ts");
    const claim = store.claimTaskForSession({
      ...first.credential,
      idempotency_key: "claim-recoverable",
      task_id: task.id,
      expected_version: task.version,
      ttl_seconds: 30,
    });
    const priorLeaseId = claim.lease_id!;
    const progressed = store.progressTaskForSession({
      ...first.credential,
      idempotency_key: "progress-recoverable",
      task_id: task.id,
      lease_id: priorLeaseId,
      expected_version: claim.version,
      message: "A partial implementation exists; verify it before continuing.",
    });
    currentTime = new Date(currentTime.getTime() + 31_000);

    const blockedTakeover = errorFrom(() =>
      store.claimTaskForSession({
        ...recovery.credential,
        idempotency_key: "implicit-takeover",
        task_id: task.id,
        expected_version: progressed.version,
      }),
    );
    expect(blockedTakeover.code).toBe("recovery_required");
    expect(blockedTakeover.details.prior_lease_id).toBe(priorLeaseId);
    expect(blockedTakeover.details.prior_session_id).toBe(first.session.id);
    expect(blockedTakeover.details.latest_progress).toBe(progressed.latest_progress);
    expect(blockedTakeover.details.base_checkpoint).toEqual(claim.base_checkpoint);

    const recovered = store.recoverTaskForSession({
      ...recovery.credential,
      idempotency_key: "explicit-recovery",
      task_id: task.id,
      expected_version: progressed.version,
      recovery_note: "Reviewed the expired lease metadata and will verify existing work first.",
    });
    expect(recovered.assignee_session_id).toBe(recovery.session.id);
    expect(recovered.latest_progress).toBe(progressed.latest_progress);
    expect(recovered.version).toBe(progressed.version + 2);

    const events = store.eventsSince(first.workspace.id).events;
    const expired = events.find((event) => event.type === "task.claim_expired");
    const recoveryEvent = events.find((event) => event.type === "task.recovered");
    expect((expired?.payload.checkpoint as { worktree_id?: string })?.worktree_id).toBe(
      claim.base_checkpoint?.worktree_id,
    );
    expect(
      (recoveryEvent?.payload.prior_lease as { lease_id?: string })?.lease_id,
    ).toBe(priorLeaseId);
    const recoveryRow = store.db.query(`
      SELECT prior_lease_id, prior_session_id, recovered_by_session_id, note,
        prior_checkpoint_json
      FROM task_recoveries
    `).get() as {
      prior_lease_id: string;
      prior_session_id: string;
      recovered_by_session_id: string;
      note: string;
      prior_checkpoint_json: string;
    };
    expect(recoveryRow.prior_lease_id).toBe(priorLeaseId);
    expect(recoveryRow.prior_session_id).toBe(first.session.id);
    expect(recoveryRow.recovered_by_session_id).toBe(recovery.session.id);
    expect(JSON.parse(recoveryRow.prior_checkpoint_json)).toEqual(claim.base_checkpoint);
  });

  test("can explicitly release or block an expired session lease without taking it over", () => {
    const holder = session("holder");
    const recovery = session("recovery");
    const releaseTask = createAcceptedEditTask(
      holder,
      "release-expired",
      "src/release-expired.ts",
    );
    const blockTask = createAcceptedEditTask(
      holder,
      "block-expired",
      "src/block-expired.ts",
    );
    const releasedClaim = store.claimTaskForSession({
      ...holder.credential,
      idempotency_key: "claim-release-expired",
      task_id: releaseTask.id,
      expected_version: releaseTask.version,
      ttl_seconds: 30,
    });
    const blockedClaim = store.claimTaskForSession({
      ...holder.credential,
      idempotency_key: "claim-block-expired",
      task_id: blockTask.id,
      expected_version: blockTask.version,
      ttl_seconds: 30,
    });
    currentTime = new Date(currentTime.getTime() + 31_000);

    const released = store.recoverTaskForSession({
      ...recovery.credential,
      idempotency_key: "recover-release-expired",
      task_id: releaseTask.id,
      expected_version: releasedClaim.version,
      recovery_note: "Prior metadata was inspected; return this task to the pool.",
      action: "release",
    });
    expect(released).toMatchObject({
      status: "open",
      assignee_session_id: null,
      lease_id: null,
      version: releasedClaim.version + 2,
    });

    const blocked = store.recoverTaskForSession({
      ...recovery.credential,
      idempotency_key: "recover-block-expired",
      task_id: blockTask.id,
      expected_version: blockedClaim.version,
      recovery_note: "Prior metadata was inspected; a prerequisite is still missing.",
      action: "block",
      blocker: "Missing prerequisite evidence",
    });
    expect(blocked).toMatchObject({
      status: "blocked",
      blocker: "Missing prerequisite evidence",
      assignee_session_id: null,
      lease_id: null,
      version: blockedClaim.version + 2,
    });
    expect(
      store.db.query(`
        SELECT action FROM task_recoveries ORDER BY recovered_at, id
      `).all().map((row: any) => row.action).sort(),
    ).toEqual(["block", "release"]);
  });

  test("advances acknowledged event anchors monotonically and detects forks", () => {
    const worker = session("cursor-worker");
    store.createTaskForSession({
      ...worker.credential,
      idempotency_key: "cursor-event",
      title: "Create cursor event",
      work_mode: "coordination",
    });
    const page = store.nextForSession(worker.credential).events;
    expect(page.next_anchor.sequence).toBeGreaterThan(0);
    const acknowledged = store.acknowledgeSessionCursor({
      ...worker.credential,
      anchor: page.next_anchor,
      expected_cursor_version: 0,
    });
    expect(acknowledged.cursor).toEqual(page.next_anchor);
    expect(acknowledged.cursor_version).toBe(1);

    expect(
      errorCode(() =>
        store.acknowledgeSessionCursor({
          ...worker.credential,
          anchor: {
            epoch_id: worker.workspace.epoch_id,
            sequence: 0,
            hash: GENESIS_HASH,
          },
          expected_cursor_version: acknowledged.cursor_version,
        }),
      ),
    ).toBe("cursor_regression");
    expect(
      errorCode(() =>
        store.acknowledgeSessionCursor({
          ...worker.credential,
          anchor: { ...page.next_anchor, hash: "f".repeat(64) },
          expected_cursor_version: acknowledged.cursor_version,
        }),
      ),
    ).toBe("cursor_fork_detected");
    expect(
      errorCode(() =>
        store.acknowledgeSessionCursor({
          ...worker.credential,
          anchor: { ...page.next_anchor, epoch_id: "epoch_foreign" },
          expected_cursor_version: acknowledged.cursor_version,
        }),
      ),
    ).toBe("cursor_mismatch");
  });

  test("preserves v0.1 event hashes across migration, mixed writes, and reopen", () => {
    const legacyRoot = join(directory, "legacy-repo");
    const legacyDatabasePath = join(directory, "legacy.sqlite");
    mkdirSync(legacyRoot);
    const fixture = createLegacyFixture(legacyDatabasePath, legacyRoot);

    let migrated = new CollabStore(legacyDatabasePath, {
      now: () => new Date(currentTime),
    });
    expect(migrated.verifyJournal(fixture.workspaceId)).toBe(true);
    const legacyEvent = migrated.eventsSince(fixture.workspaceId).events[0];
    expect(legacyEvent?.protocol).toBe("agenttool.collab/0.1");
    expect(legacyEvent?.hash).toBe(fixture.eventHash);
    migrated.startSession({ root_path: legacyRoot, actor: "v2-worker" });
    expect(migrated.verifyJournal(fixture.workspaceId)).toBe(true);
    expect(
      (
        migrated.db.query(
          "SELECT hash FROM events WHERE workspace_id = ? AND sequence = 1",
        ).get(fixture.workspaceId) as { hash: string }
      ).hash,
    ).toBe(fixture.eventHash);
    migrated.close();

    migrated = new CollabStore(legacyDatabasePath, {
      now: () => new Date(currentTime),
    });
    expect(migrated.verifyJournal(fixture.workspaceId)).toBe(true);
    expect(migrated.eventsSince(fixture.workspaceId).events[0]?.hash).toBe(
      fixture.eventHash,
    );
    migrated.close();
  });

  test("hydrates a v0.1 idempotency receipt without rewriting it or duplicating events", () => {
    const legacyRoot = join(directory, "legacy-receipt-repo");
    const legacyDatabasePath = join(directory, "legacy-receipt.sqlite");
    mkdirSync(legacyRoot);
    const fixture = createLegacyFixture(legacyDatabasePath, legacyRoot);
    const legacy = new Database(legacyDatabasePath, { strict: true });
    const createdAt = "2026-07-20T11:00:00.000Z";
    const request = {
      workspace_id: fixture.workspaceId,
      actor: "legacy-worker",
      idempotency_key: "legacy-create-receipt",
      id: "task_legacy_receipt",
      title: "Legacy receipt",
      description: null,
      dependencies: [],
      path_scopes: [],
    };
    const response = {
      id: request.id,
      workspace_id: request.workspace_id,
      title: request.title,
      description: null,
      status: "open",
      effective_status: "open",
      dependencies: [],
      path_scopes: [],
      assignee: null,
      lease_id: null,
      lease_expires_at: null,
      blocker: null,
      latest_progress: null,
      version: 1,
      created_at: createdAt,
      updated_at: createdAt,
      completed_at: null,
    };
    legacy.query(`
      INSERT INTO tasks (
        id, workspace_id, title, description, status, dependencies_json,
        path_scopes_json, assignee, lease_id, lease_expires_at, blocker,
        latest_progress, version, created_at, updated_at, completed_at
      ) VALUES (?, ?, ?, NULL, 'open', '[]', '[]', NULL, NULL, NULL, NULL, NULL, 1, ?, ?, NULL)
    `).run(
      request.id,
      request.workspace_id,
      request.title,
      createdAt,
      createdAt,
    );
    const requestHash = createHash("sha256")
      .update(canonicalJson({ operation: "task.create", request }))
      .digest("hex");
    legacy.query(`
      INSERT INTO mutations (
        workspace_id, actor, idempotency_key, operation, request_hash,
        response_json, created_at
      ) VALUES (?, ?, ?, 'task.create', ?, ?, ?)
    `).run(
      request.workspace_id,
      request.actor,
      request.idempotency_key,
      requestHash,
      JSON.stringify(response),
      createdAt,
    );
    legacy.close();

    const migrated = new CollabStore(legacyDatabasePath, {
      now: () => new Date(currentTime),
    });
    const receiptBefore = migrated.db.query(`
      SELECT response_json FROM mutations
      WHERE workspace_id = ? AND actor = ? AND idempotency_key = ?
    `).get(
      request.workspace_id,
      request.actor,
      request.idempotency_key,
    ) as { response_json: string };
    const replay = migrated.createTask({
      workspace_id: request.workspace_id,
      actor: request.actor,
      idempotency_key: request.idempotency_key,
      id: request.id,
      title: request.title,
    });
    expect(replay).toMatchObject({
      id: request.id,
      work_mode: "coordination",
      completion_policy: "reported",
      review_status: "legacy_unreviewed",
      expected_base_sha: null,
      base_checkpoint: null,
      base_checkpoint_digest: null,
      result_checkpoint: null,
      result_checkpoint_digest: null,
      assignee_session_id: null,
      accepted_by_session_id: null,
    });
    expect(
      (
        migrated.db.query(`
          SELECT response_json FROM mutations
          WHERE workspace_id = ? AND actor = ? AND idempotency_key = ?
        `).get(
          request.workspace_id,
          request.actor,
          request.idempotency_key,
        ) as { response_json: string }
      ).response_json,
    ).toBe(receiptBefore.response_json);
    expect(migrated.eventsSince(request.workspace_id).head_sequence).toBe(1);
    migrated.close();
  });

  test("fails closed for foreign application IDs and future schema versions", () => {
    const foreignPath = join(directory, "foreign.sqlite");
    const foreign = new Database(foreignPath, { create: true });
    foreign.exec("PRAGMA journal_mode = DELETE");
    foreign.exec("PRAGMA application_id = 123456");
    foreign.close();
    chmodSync(foreignPath, 0o644);
    expect(errorCode(() => new CollabStore(foreignPath))).toBe(
      "database_application_mismatch",
    );
    expect(statSync(foreignPath).mode & 0o777).toBe(0o644);
    const unchangedForeign = new Database(foreignPath, {
      create: false,
      strict: true,
    });
    expect(
      (
        unchangedForeign.query("PRAGMA application_id").get() as {
          application_id: number;
        }
      ).application_id,
    ).toBe(123456);
    expect(
      (
        unchangedForeign.query("PRAGMA journal_mode").get() as {
          journal_mode: string;
        }
      ).journal_mode,
    ).toBe("delete");
    unchangedForeign.close();

    const futurePath = join(directory, "future.sqlite");
    const future = new Database(futurePath, { create: true });
    future.exec(`PRAGMA application_id = ${APPLICATION_ID}`);
    future.exec("PRAGMA user_version = 999");
    future.close();
    expect(errorCode(() => new CollabStore(futurePath))).toBe(
      "database_version_too_new",
    );
  });

  test("prevents the legacy store API from mutating a session-v2 task", () => {
    const worker = session("v2-owner");
    const task = createAcceptedEditTask(worker, "guarded-v2-task", "src/guarded.ts");
    expect(
      errorCode(() =>
        store.createTask({
          workspace_id: worker.workspace.id,
          actor: "legacy-client",
          idempotency_key: "legacy-v2-options",
          title: "Must not silently downgrade",
          work_mode: "edit",
        } as any),
      ),
    ).toBe("session_required_for_v2_task_options");

    expect(() =>
      store.claimTask({
        workspace_id: worker.workspace.id,
        task_id: task.id,
        actor: "legacy-client",
        idempotency_key: "legacy-claim",
        expected_version: task.version,
      }),
    ).toThrow("agenttool_collab_v2_write_requires_v2_client");
    expect(store.getTask(worker.workspace.id, task.id)).toMatchObject({
      status: "open",
      version: task.version,
      assignee: null,
      assignee_session_id: null,
    });
    expect(
      (
        store.db.query(`
          SELECT COUNT(*) AS count FROM mutations
          WHERE workspace_id = ? AND actor = 'legacy-client'
        `).get(worker.workspace.id) as { count: number }
      ).count,
    ).toBe(0);

    expect(
      store.claimTaskForSession({
        ...worker.credential,
        idempotency_key: "v2-claim",
        task_id: task.id,
        expected_version: task.version,
      }).assignee_session_id,
    ).toBe(worker.session.id);
  });

  test("detects untracked content drift before accepting a Git result", () => {
    initializeGitRepository();
    const implementer = session("implementer");
    const reviewer = session("reviewer");
    const task = createAcceptedEditTask(
      implementer,
      "untracked-content-task",
      "generated/result.txt",
    );
    const claim = store.claimTaskForSession({
      ...implementer.credential,
      idempotency_key: "claim-untracked-content",
      task_id: task.id,
      expected_version: task.version,
    });
    mkdirSync(join(root, "generated"));
    writeFileSync(join(root, "generated", "result.txt"), "first result\n");
    const reported = store.completeTaskForSession({
      ...implementer.credential,
      idempotency_key: "complete-untracked-content",
      task_id: task.id,
      lease_id: claim.lease_id!,
      expected_version: claim.version,
      summary: "Generated result is ready for review.",
    });
    expect(reported.result_checkpoint?.state_sha256).toMatch(/^[a-f0-9]{64}$/);

    writeFileSync(join(root, "generated", "result.txt"), "changed after report\n");
    expect(
      errorCode(() =>
        store.reviewTaskForSession({
          ...reviewer.credential,
          idempotency_key: "review-drifted-untracked-content",
          task_id: task.id,
          expected_version: reported.version,
          outcome: "accept",
          summary: "Accepting a changed result must fail.",
        }),
      ),
    ).toBe("git_checkpoint_stale");
  });

  test("fails reviewed acceptance closed when untracked hashing exceeds its byte bound", () => {
    initializeGitRepository();
    const implementer = session("bounded-implementer");
    const reviewer = session("bounded-reviewer");
    const task = createAcceptedEditTask(
      implementer,
      "oversized-untracked-task",
      "generated/large.bin",
    );
    const claim = store.claimTaskForSession({
      ...implementer.credential,
      idempotency_key: "claim-oversized-untracked",
      task_id: task.id,
      expected_version: task.version,
    });
    mkdirSync(join(root, "generated"));
    const largePath = join(root, "generated", "large.bin");
    writeFileSync(largePath, "");
    truncateSync(largePath, 64 * 1024 * 1024 + 1);
    const reported = store.completeTaskForSession({
      ...implementer.credential,
      idempotency_key: "complete-oversized-untracked",
      task_id: task.id,
      lease_id: claim.lease_id!,
      expected_version: claim.version,
      summary: "The large generated file is ready.",
    });
    expect(reported.result_checkpoint?.state_sha256).toBeNull();
    expect(
      errorCode(() =>
        store.reviewTaskForSession({
          ...reviewer.credential,
          idempotency_key: "review-oversized-untracked",
          task_id: task.id,
          expected_version: reported.version,
          outcome: "accept",
          summary: "Incomplete checkpoint capture cannot be accepted.",
        }),
      ),
    ).toBe("git_checkpoint_incomplete");
  });

  test("revalidates worktree identity outside the write transaction and preserves retries", () => {
    const worker = session("worker");
    const first = createAcceptedEditTask(worker, "identity-first", "src/first.ts");
    const second = createAcceptedEditTask(worker, "identity-second", "src/second.ts");
    const claimed = store.claimTaskForSession({
      ...worker.credential,
      idempotency_key: "identity-first-claim",
      task_id: first.id,
      expected_version: first.version,
    });
    rmSync(root, { recursive: true, force: true });

    expect(
      store.claimTaskForSession({
        ...worker.credential,
        idempotency_key: "identity-first-claim",
        task_id: first.id,
        expected_version: first.version,
      }),
    ).toEqual(claimed);
    const eventCount = store.eventsSince(worker.workspace.id).head_sequence;
    const mutationCount = (
      store.db.query("SELECT COUNT(*) AS count FROM mutations").get() as {
        count: number;
      }
    ).count;
    expect(
      errorCode(() =>
        store.claimTaskForSession({
          ...worker.credential,
          idempotency_key: "identity-second-claim",
          task_id: second.id,
          expected_version: second.version,
        }),
      ),
    ).toBe("worktree_unavailable");
    expect(store.eventsSince(worker.workspace.id).head_sequence).toBe(eventCount);
    expect(
      (
        store.db.query("SELECT COUNT(*) AS count FROM mutations").get() as {
          count: number;
        }
      ).count,
    ).toBe(mutationCount);
  });

  test("requires a fresh completion after its report is withdrawn", () => {
    const implementer = session("implementer");
    const reviewer = session("reviewer");
    const task = createAcceptedEditTask(
      implementer,
      "withdrawn-completion",
      "src/withdrawn.ts",
    );
    const claim = store.claimTaskForSession({
      ...implementer.credential,
      idempotency_key: "claim-withdrawn-completion",
      task_id: task.id,
      expected_version: task.version,
    });
    const reported = store.completeTaskForSession({
      ...implementer.credential,
      idempotency_key: "report-withdrawn-completion",
      task_id: task.id,
      lease_id: claim.lease_id!,
      expected_version: claim.version,
      summary: "This report will be withdrawn.",
    });
    store.appendReportForSession({
      ...implementer.credential,
      idempotency_key: "withdraw-completion-report",
      task_id: task.id,
      kind: "observation",
      body: "The completion claim is withdrawn pending another check.",
      relation: "withdraws",
      target_report_id: reported.completion_report_id!,
    });

    expect(
      errorCode(() =>
        store.reviewTaskForSession({
          ...reviewer.credential,
          idempotency_key: "accept-withdrawn-completion",
          task_id: task.id,
          expected_version: reported.version,
          outcome: "accept",
          summary: "A withdrawn report cannot be accepted.",
        }),
      ),
    ).toBe("completion_report_obsolete");
    expect(
      store.reviewTaskForSession({
        ...reviewer.credential,
        idempotency_key: "reopen-withdrawn-completion",
        task_id: task.id,
        expected_version: reported.version,
        outcome: "request_changes",
        summary: "Submit a new completion after the missing check.",
      }).task.review_status,
    ).toBe("changes_requested");
  });

  test("requires host-authorized and audited recovery for cursor rollback", () => {
    const worker = session("cursor-recovery-worker");
    store.createTaskForSession({
      ...worker.credential,
      idempotency_key: "cursor-recovery-event",
      title: "Create a cursor recovery event",
      work_mode: "coordination",
    });
    const page = store.nextForSession(worker.credential).events;
    const acknowledged = store.acknowledgeSessionCursor({
      ...worker.credential,
      anchor: page.next_anchor,
      expected_cursor_version: worker.session.cursor_version,
    });
    expect(acknowledged.cursor_version).toBe(1);

    expect(errorCode(() => store.resumeSession(worker.credential))).toBe(
      "cursor_reset_required",
    );
    const recovered = store.resumeSession(worker.credential, {
      allow_cursor_recovery: true,
    });
    expect(recovered.cursor_recovery).toMatchObject({
      required: true,
      cause: "host_cursor_mismatch",
      persisted_cursor: page.next_anchor,
      expected_cursor_version: 1,
    });
    expect(recovered.session.cursor_recovery_required).toBe(true);
    expect(
      errorCode(() =>
        store.createTaskForSession({
          ...recovered.credential,
          idempotency_key: "blocked-during-cursor-recovery",
          title: "Must wait for reset",
          work_mode: "coordination",
        }),
      ),
    ).toBe("cursor_recovery_required");

    const reset = store.resetSessionCursor({
      ...recovered.credential,
      idempotency_key: "audit-cursor-recovery",
      expected_cursor_version: 1,
      target: page.next_anchor,
      reason: "Host credential file was behind the persisted acknowledged anchor.",
    });
    expect(reset.cursor_recovery_required).toBe(false);
    expect(reset.reset_generation).toBe(1);
    expect(
      store.createTaskForSession({
        ...recovered.credential,
        idempotency_key: "allowed-after-cursor-recovery",
        title: "Allowed after reset",
        work_mode: "coordination",
      }).title,
    ).toBe("Allowed after reset");
    const laterPage = store.nextForSession(recovered.credential).events;
    const laterAck = store.acknowledgeSessionCursor({
      ...recovered.credential,
      anchor: laterPage.next_anchor,
      expected_cursor_version: reset.cursor_version,
    });
    const resetReplay = store.resetSessionCursor({
      ...recovered.credential,
      idempotency_key: "audit-cursor-recovery",
      expected_cursor_version: 1,
      target: page.next_anchor,
      reason: "Host credential file was behind the persisted acknowledged anchor.",
    });
    expect(resetReplay.cursor).toEqual(laterAck.cursor);
    expect(resetReplay.cursor_version).toBe(laterAck.cursor_version);
  });

  test("enforces expected bases and upgrades legacy tasks when a session claims", () => {
    initializeGitRepository();
    const workspace = store.openWorkspace({ root_path: root, actor: "legacy-owner" });
    const legacyTask = store.createTask({
      workspace_id: workspace.id,
      actor: "legacy-owner",
      idempotency_key: "legacy-task-before-session",
      title: "Legacy task claimed by a session",
      path_scopes: ["src/legacy.ts"],
    });
    const worker = session("worker");
    const claimedLegacy = store.claimTaskForSession({
      ...worker.credential,
      idempotency_key: "session-claims-legacy",
      task_id: legacyTask.id,
      expected_version: legacyTask.version,
    });
    expect(() =>
      store.progressTask({
        workspace_id: workspace.id,
        actor: "worker",
        idempotency_key: "legacy-progress-after-session-claim",
        task_id: legacyTask.id,
        lease_id: claimedLegacy.lease_id!,
        expected_version: claimedLegacy.version,
        message: "Must be rejected by the v2 guard.",
      }),
    ).toThrow("agenttool_collab_v2_write_requires_v2_client");

    const wrongBase = store.createTaskForSession({
      ...worker.credential,
      idempotency_key: "wrong-base-task",
      title: "Wrong base",
      work_mode: "edit",
      path_scopes: ["src/wrong-base.ts"],
      expected_base_sha: "f".repeat(40),
    });
    expect(
      errorCode(() =>
        store.claimTaskForSession({
          ...worker.credential,
          idempotency_key: "claim-wrong-base",
          task_id: wrongBase.id,
          expected_version: wrongBase.version,
        }),
      ),
    ).toBe("expected_base_mismatch");
  });

  test("refuses to end a session while it owns a live lease", () => {
    const worker = session("ending-worker");
    const task = createAcceptedEditTask(worker, "end-with-lease", "src/end.ts");
    const claim = store.claimTaskForSession({
      ...worker.credential,
      idempotency_key: "claim-before-end",
      task_id: task.id,
      expected_version: task.version,
      ttl_seconds: 3600,
    });
    const blocked = errorFrom(() =>
      store.endSession({ ...worker.credential, reason: "Attempted early end" }),
    );
    expect(blocked.code).toBe("session_has_active_leases");
    expect(blocked.details.task_ids).toEqual([task.id]);
    expect(store.listCoordinationSessions(worker.workspace.id, "active")).toHaveLength(1);

    store.releaseTaskForSession({
      ...worker.credential,
      idempotency_key: "release-before-end",
      task_id: task.id,
      lease_id: claim.lease_id!,
      expected_version: claim.version,
      summary: "Ending this session cleanly.",
    });
    expect(
      store.endSession({ ...worker.credential, reason: "All leases resolved" }).status,
    ).toBe("ended");
  });

  test("names every live lease and the release_leases remedy when refusing to end", () => {
    const worker = session("refused-ender");
    const task = createAcceptedEditTask(worker, "refused-end-task", "src/refused-end.ts");
    const claim = store.claimTaskForSession({
      ...worker.credential,
      idempotency_key: "claim-refused-end",
      task_id: task.id,
      expected_version: task.version,
      ttl_seconds: 3600,
    });

    const refused = errorFrom(() =>
      store.endSession({ ...worker.credential, reason: "Leaving without the flag" }),
    );
    expect(refused.code).toBe("session_has_active_leases");
    expect(refused.message).toContain("release_leases");
    expect(refused.details.task_ids).toEqual([task.id]);
    expect(refused.details.leases).toEqual([
      {
        task_id: task.id,
        lease_id: claim.lease_id,
        expires_at: claim.lease_expires_at,
      },
    ]);
    expect(refused.details.required_action).toBe("resolve_active_task_leases");
    expect(String(refused.details.remedy)).toContain("release_leases: true");

    // A summary without the flag is refused even when it is blank: never silently ignored.
    for (const release_summary of ["This summary has no leases to describe.", "   ", ""]) {
      expect(
        errorCode(() =>
          store.endSession({
            ...worker.credential,
            reason: "Summary without the flag",
            release_summary,
          }),
        ),
      ).toBe("invalid_release_summary");
    }
    expect(
      errorCode(() =>
        store.endSession({
          ...worker.credential,
          release_leases: false,
          release_summary: "The flag is explicitly off.",
        }),
      ),
    ).toBe("invalid_release_summary");
    expect(
      errorCode(() =>
        store.endSession({
          ...worker.credential,
          release_leases: "yes" as unknown as boolean,
        }),
      ),
    ).toBe("invalid_release_leases");
    expect(store.listCoordinationSessions(worker.workspace.id, "active")).toHaveLength(1);
    expect(store.getTask(worker.workspace.id, task.id).lease_id).toBe(claim.lease_id);
  });

  test("ends with release_leases by releasing live leases and recovering its own expired ones", () => {
    const worker = session("release-on-end-worker");
    const successor = session("release-on-end-successor");
    const liveTask = createAcceptedEditTask(worker, "end-release-live", "src/end-live.ts");
    const expiredTask = createAcceptedEditTask(
      worker,
      "end-release-expired",
      "src/end-expired.ts",
    );
    const expiredClaim = store.claimTaskForSession({
      ...worker.credential,
      idempotency_key: "claim-end-expired",
      task_id: expiredTask.id,
      expected_version: expiredTask.version,
      ttl_seconds: 30,
    });
    currentTime = new Date(currentTime.getTime() + 31_000);
    const liveClaim = store.claimTaskForSession({
      ...worker.credential,
      idempotency_key: "claim-end-live",
      task_id: liveTask.id,
      expected_version: liveTask.version,
      ttl_seconds: 3600,
    });
    expect(store.getTask(worker.workspace.id, expiredTask.id).effective_status).toBe(
      "recovery_required",
    );

    const ended = store.endSessionWithReleases({
      ...worker.credential,
      reason: "Host exit",
      release_leases: true,
      release_summary: "Returning both tasks to the pool on exit.",
    });

    expect(ended.session.status).toBe("ended");
    expect(ended.released_leases).toEqual(
      [
        { task_id: liveTask.id, lease_id: liveClaim.lease_id!, via: "release" as const },
        { task_id: expiredTask.id, lease_id: expiredClaim.lease_id!, via: "recovery" as const },
      ].sort((left, right) => (left.task_id < right.task_id ? -1 : 1)),
    );
    expect(store.getTask(worker.workspace.id, liveTask.id)).toMatchObject({
      status: "open",
      assignee_session_id: null,
      lease_id: null,
      version: liveClaim.version + 1,
    });
    expect(store.getTask(worker.workspace.id, expiredTask.id)).toMatchObject({
      status: "open",
      effective_status: "open",
      assignee_session_id: null,
      lease_id: null,
      version: expiredClaim.version + 2,
    });

    const events = store.eventsSince(worker.workspace.id, 0, 500).events;
    const released = events.find(
      (event) => event.type === "task.released" && event.entity_id === liveTask.id,
    );
    expect(released?.session_id).toBe(worker.session.id);
    expect(released?.payload).toMatchObject({
      summary: "Returning both tasks to the pool on exit.",
      released_by_session_end: true,
    });
    const recovered = events.find(
      (event) => event.type === "task.recovered" && event.entity_id === expiredTask.id,
    );
    expect(recovered?.session_id).toBe(worker.session.id);
    expect(recovered?.payload).toMatchObject({
      action: "release",
      recovery_note: "Returning both tasks to the pool on exit.",
      recovery_checkpoint: null,
    });
    expect(events.at(-1)?.type).toBe("session.ended");
    expect(
      store.db.query(`
        SELECT action, prior_session_id, recovered_by_session_id, note
        FROM task_recoveries WHERE task_id = ?
      `).get(expiredTask.id),
    ).toEqual({
      action: "release",
      prior_session_id: worker.session.id,
      recovered_by_session_id: worker.session.id,
      note: "Returning both tasks to the pool on exit.",
    });
    expect(
      (store.db.query("SELECT COUNT(*) AS count FROM v2_write_guard").get() as {
        count: number;
      }).count,
    ).toBe(0);
    expect(store.verifyJournal(worker.workspace.id)).toBe(true);

    const reclaimed = store.claimTaskForSession({
      ...successor.credential,
      idempotency_key: "successor-claims-released",
      task_id: liveTask.id,
      expected_version: liveClaim.version + 1,
    });
    expect(reclaimed.assignee_session_id).toBe(successor.session.id);
  });

  test("rolls back every release when ending with release_leases fails at the final event", () => {
    const worker = session("atomic-ender");
    const liveTask = createAcceptedEditTask(worker, "atomic-live", "src/atomic-live.ts");
    const expiredTask = createAcceptedEditTask(worker, "atomic-expired", "src/atomic-expired.ts");
    const expiredClaim = store.claimTaskForSession({
      ...worker.credential,
      idempotency_key: "claim-atomic-expired",
      task_id: expiredTask.id,
      expected_version: expiredTask.version,
      ttl_seconds: 30,
    });
    currentTime = new Date(currentTime.getTime() + 31_000);
    const liveClaim = store.claimTaskForSession({
      ...worker.credential,
      idempotency_key: "claim-atomic-live",
      task_id: liveTask.id,
      expected_version: liveTask.version,
      ttl_seconds: 3600,
    });
    const headBefore = store.getWorkspace(worker.workspace.id)!.event_head_sequence;
    // Fail on the very last write, after both leases went through their
    // release and recovery paths, so the rollback has to undo all of it.
    const internals = store as unknown as {
      appendEvent: (workspaceId: string, type: string, ...rest: unknown[]) => unknown;
    };
    const appendEvent = internals.appendEvent.bind(store);
    const attempted: string[] = [];
    internals.appendEvent = (workspaceId, type, ...rest) => {
      attempted.push(type);
      if (type === "session.ended") {
        throw new CollabError("injected_failure", "Injected failure inside session end");
      }
      return appendEvent(workspaceId, type, ...rest);
    };

    expect(
      errorCode(() =>
        store.endSessionWithReleases({
          ...worker.credential,
          reason: "Must roll back",
          release_leases: true,
        }),
      ),
    ).toBe("injected_failure");
    expect([...attempted].sort()).toEqual([
      "session.ended",
      "task.claim_expired",
      "task.recovered",
      "task.released",
    ]);
    expect(attempted.at(-1)).toBe("session.ended");

    expect(store.getTask(worker.workspace.id, liveTask.id)).toMatchObject({
      status: "claimed",
      assignee_session_id: worker.session.id,
      lease_id: liveClaim.lease_id,
      version: liveClaim.version,
    });
    expect(store.getTask(worker.workspace.id, expiredTask.id)).toMatchObject({
      status: "claimed",
      assignee_session_id: worker.session.id,
      lease_id: expiredClaim.lease_id,
      version: expiredClaim.version,
    });
    expect(store.getWorkspace(worker.workspace.id)!.event_head_sequence).toBe(headBefore);
    expect(store.listCoordinationSessions(worker.workspace.id, "active")).toHaveLength(1);
    expect(
      (store.db.query("SELECT COUNT(*) AS count FROM task_recoveries").get() as {
        count: number;
      }).count,
    ).toBe(0);
    expect(
      (store.db.query("SELECT COUNT(*) AS count FROM v2_write_guard").get() as {
        count: number;
      }).count,
    ).toBe(0);
    expect(store.verifyJournal(worker.workspace.id)).toBe(true);
  });

  test("releases leases on end while cursor recovery is still required", () => {
    const worker = session("cursor-recovery-ender");
    const task = createAcceptedEditTask(worker, "cursor-recovery-end", "src/cursor-end.ts");
    const claim = store.claimTaskForSession({
      ...worker.credential,
      idempotency_key: "claim-cursor-recovery-end",
      task_id: task.id,
      expected_version: task.version,
      ttl_seconds: 3600,
    });
    const page = store.nextForSession(worker.credential).events;
    store.acknowledgeSessionCursor({
      ...worker.credential,
      anchor: page.next_anchor,
      expected_cursor_version: worker.session.cursor_version,
    });
    const recovered = store.resumeSession(worker.credential, {
      allow_cursor_recovery: true,
    });
    expect(recovered.session.cursor_recovery_required).toBe(true);

    const ended = store.endSessionWithReleases({
      ...recovered.credential,
      reason: "Host exit during cursor recovery",
      release_leases: true,
    });
    expect(ended.session.status).toBe("ended");
    expect(ended.released_leases).toEqual([
      { task_id: task.id, lease_id: claim.lease_id!, via: "release" },
    ]);
    const released = store.eventsSince(worker.workspace.id, 0, 500).events.find(
      (event) => event.type === "task.released" && event.entity_id === task.id,
    );
    expect(released?.payload.summary).toBe("Host exit during cursor recovery");
  });

  test("treats a blank release_summary as absent and falls back to the reason or the default note", () => {
    const withReason = session("blank-summary-with-reason");
    const reasonTask = createAcceptedEditTask(
      withReason,
      "blank-summary-reason",
      "src/blank-reason.ts",
    );
    const reasonClaim = store.claimTaskForSession({
      ...withReason.credential,
      idempotency_key: "claim-blank-summary-reason",
      task_id: reasonTask.id,
      expected_version: reasonTask.version,
      ttl_seconds: 3600,
    });
    expect(
      store.endSessionWithReleases({
        ...withReason.credential,
        reason: "Host exit with a blank summary",
        release_leases: true,
        release_summary: "   ",
      }).released_leases,
    ).toEqual([{ task_id: reasonTask.id, lease_id: reasonClaim.lease_id!, via: "release" }]);

    const blank = session("blank-summary-blank-reason");
    const blankTask = createAcceptedEditTask(blank, "blank-summary-expired", "src/blank-expired.ts");
    const blankClaim = store.claimTaskForSession({
      ...blank.credential,
      idempotency_key: "claim-blank-summary-expired",
      task_id: blankTask.id,
      expected_version: blankTask.version,
      ttl_seconds: 30,
    });
    currentTime = new Date(currentTime.getTime() + 31_000);
    expect(
      store.endSessionWithReleases({
        ...blank.credential,
        reason: "  ",
        release_leases: true,
        release_summary: "",
      }).released_leases,
    ).toEqual([{ task_id: blankTask.id, lease_id: blankClaim.lease_id!, via: "recovery" }]);

    const events = store.eventsSince(withReason.workspace.id, 0, 500).events;
    expect(
      events.find((event) => event.type === "task.released" && event.entity_id === reasonTask.id)
        ?.payload.summary,
    ).toBe("Host exit with a blank summary");
    expect(
      events.find((event) => event.type === "task.recovered" && event.entity_id === blankTask.id)
        ?.payload.recovery_note,
    ).toBe("collab_session_end with release_leases released this expired lease from its own session");
    expect(
      events.find((event) => event.type === "session.ended" && event.entity_id === blank.session.id)
        ?.payload.reason,
    ).toBeNull();
  });

  test("lets the expired holder recover-release its own lease without a second session", () => {
    const holder = session("self-recovering-holder");
    const task = createAcceptedEditTask(holder, "self-recovery", "src/self-recovery.ts");
    const claim = store.claimTaskForSession({
      ...holder.credential,
      idempotency_key: "claim-self-recovery",
      task_id: task.id,
      expected_version: task.version,
      ttl_seconds: 30,
    });
    currentTime = new Date(currentTime.getTime() + 31_000);

    const released = store.recoverTaskForSession({
      ...holder.credential,
      idempotency_key: "self-recover-release",
      task_id: task.id,
      expected_version: claim.version,
      recovery_note: "My own lease expired; returning the task to the pool.",
      action: "release",
    });
    expect(released).toMatchObject({
      status: "open",
      effective_status: "open",
      assignee_session_id: null,
      lease_id: null,
      version: claim.version + 2,
    });
    expect(
      store.db.query(`
        SELECT action, prior_lease_id, prior_session_id, recovered_by_session_id, note
        FROM task_recoveries WHERE task_id = ?
      `).get(task.id),
    ).toEqual({
      action: "release",
      prior_lease_id: claim.lease_id,
      prior_session_id: holder.session.id,
      recovered_by_session_id: holder.session.id,
      note: "My own lease expired; returning the task to the pool.",
    });
    const recovered = store.eventsSince(holder.workspace.id, 0, 500).events.find(
      (event) => event.type === "task.recovered" && event.entity_id === task.id,
    );
    expect(recovered?.session_id).toBe(holder.session.id);
    expect(recovered?.payload).toMatchObject({ action: "release", recovery_checkpoint: null });
    expect(store.endSession({ ...holder.credential, reason: "Recovered my own lease" }).status)
      .toBe("ended");
  });

  test("bounds session event pages while preserving exact reports and acknowledgement", () => {
    const sender = session("sender");
    const observer = session("observer");
    for (let index = 0; index < 55; index += 1) {
      store.createTaskForSession({
        ...sender.credential,
        idempotency_key: `page-task-${index}`,
        title: `Page task ${index}`,
        work_mode: "coordination",
      });
    }
    const report = store.appendReportForSession({
      ...sender.credential,
      idempotency_key: "report-after-first-page",
      kind: "observation",
      body: "This report is intentionally beyond the first event page.",
      to_session_id: observer.session.id,
    });

    const fullPage = store.eventsSince(observer.workspace.id, 0, 500);
    const defaultPage = store.nextForSession(observer.credential);
    expect(defaultPage.events.events).toHaveLength(50);
    expect(store.nextForActor(
      observer.workspace.id,
      "legacy-observer",
    ).events.events).toHaveLength(50);
    expect(store.nextForSession({
      ...observer.credential,
      event_limit: 1,
    }).events.events).toHaveLength(1);
    expect(store.nextForSession({
      ...observer.credential,
      event_limit: 50,
    }).events.events).toHaveLength(50);
    for (const eventLimit of [0, 51, 1.5]) {
      expect(errorCode(() => store.nextForSession({
        ...observer.credential,
        event_limit: eventLimit,
      }))).toBe("invalid_event_limit");
      expect(errorCode(() => store.nextForActor(
        observer.workspace.id,
        "legacy-observer",
        0,
        eventLimit,
      ))).toBe("invalid_event_limit");
    }

    const seenSequences: number[] = [];
    const reportPages: Array<[number, number]> = [];
    let cursor = observer.session.cursor;
    let cursorVersion = observer.session.cursor_version;
    while (true) {
      const page = store.nextForSession({
        ...observer.credential,
        known_cursor: cursor,
        event_limit: 10,
      });
      expect(page.events.cursor).toEqual(cursor);
      expect(page.events.events.length).toBeLessThanOrEqual(10);
      expect(page.events.chain_valid).toBe(true);
      expect(page.events.verification_scope).toBe("returned_page");
      expect(page.projection_scope).toBe("snapshot_head");
      expect(page.reports_scope).toBe("event_page");
      expect(
        page.reports.every(
          (item) =>
            item.event_sequence > page.events.cursor.sequence
            && item.event_sequence <= page.events.next_anchor.sequence,
        ),
      ).toBe(true);
      const pageContainsReportEvent = page.events.events.some(
        (event) => event.sequence === report.event_sequence,
      );
      expect(page.reports.some((item) => item.id === report.id)).toBe(
        pageContainsReportEvent,
      );
      if (pageContainsReportEvent) {
        reportPages.push([
          page.events.cursor.sequence,
          page.events.next_anchor.sequence,
        ]);
      }
      seenSequences.push(...page.events.events.map((event) => event.sequence));

      const acknowledged = store.acknowledgeSessionCursor({
        ...observer.credential,
        anchor: page.events.next_anchor,
        expected_cursor_version: cursorVersion,
      });
      expect(acknowledged.cursor).toEqual(page.events.next_anchor);
      expect(acknowledged.cursor_version).toBe(cursorVersion + 1);
      cursor = acknowledged.cursor;
      cursorVersion = acknowledged.cursor_version;
      if (!page.events.has_more) break;
    }

    expect(seenSequences).toEqual(fullPage.events.map((event) => event.sequence));
    expect(reportPages).toHaveLength(1);
    const afterAcknowledgement = store.nextForSession({
      ...observer.credential,
      known_cursor: cursor,
      event_limit: 1,
    });
    expect(afterAcknowledgement.events.cursor).toEqual(cursor);
    expect(afterAcknowledgement.events.events).toEqual([]);
    expect(afterAcknowledgement.events.has_more).toBe(false);
    expect(afterAcknowledgement.reports).toEqual([]);
  });

  test("expires incoming handoffs when their target session ends", () => {
    const owner = session("owner");
    const firstTarget = session("first-target");
    const secondTarget = session("second-target");
    const task = createAcceptedEditTask(owner, "handoff-end-task", "src/handoff.ts");
    const claim = store.claimTaskForSession({
      ...owner.credential,
      idempotency_key: "claim-handoff-end-task",
      task_id: task.id,
      expected_version: task.version,
    });
    const firstOffer = store.offerHandoffForSession({
      ...owner.credential,
      idempotency_key: "offer-to-ending-session",
      task_id: task.id,
      lease_id: claim.lease_id!,
      expected_version: claim.version,
      to_session_id: firstTarget.session.id,
      summary: "Please continue this task.",
    });
    store.endSession({
      ...firstTarget.credential,
      reason: "Declining outstanding work by ending cleanly.",
    });
    expect(
      store.db.query("SELECT status FROM handoffs WHERE id = ?")
        .get(firstOffer.handoff.id),
    ).toEqual({ status: "expired" });

    const secondOffer = store.offerHandoffForSession({
      ...owner.credential,
      idempotency_key: "offer-after-target-ended",
      task_id: task.id,
      lease_id: claim.lease_id!,
      expected_version: firstOffer.task.version,
      to_session_id: secondTarget.session.id,
      summary: "The first target ended; this is a fresh refusable offer.",
    });
    expect(secondOffer.handoff.status).toBe("pending");
    expect(
      store.eventsSince(owner.workspace.id).events.some(
        (event) =>
          event.type === "handoff.expired"
          && event.entity_id === firstOffer.handoff.id
          && event.payload.reason === "target_session_ended",
      ),
    ).toBe(true);
  });
});

describe("evidence references name their allowed prefixes", () => {
  const allowedPrefixes = ["artifact:", "event:", "report:", "checkpoint:"];

  function expectEvidenceGuidance(error: CollabError, code: string): void {
    expect(error.code).toBe(code);
    for (const prefix of allowedPrefixes) expect(error.message).toContain(prefix);
    expect(error.message).toContain("artifact:artifact_<id>");
    expect(error.details.allowed_prefixes).toEqual(allowedPrefixes);
  }

  test("explains every invalid evidence reference site and evidence_not_found", () => {
    const author = session("evidence-author");
    const invalid: Array<[unknown, string]> = [
      ["artifact_without_prefix", "needs a kind prefix"],
      [":leading-separator", "needs a kind prefix"],
      ["report:", "ID is empty"],
      ["commit:abc123", "Unsupported evidence reference kind"],
      [42, "must be strings"],
      ["   ", "must not be empty"],
      [`report:${"x".repeat(2_001)}`, "exceeds 2000 characters"],
      ["report:with\0nul", "must not contain NUL bytes"],
    ];
    for (const [index, [reference, reason]] of invalid.entries()) {
      const error = errorFrom(() =>
        store.appendReportForSession({
          ...author.credential,
          idempotency_key: `invalid-evidence-${index}`,
          kind: "observation",
          body: "Evidence reference fixture.",
          evidence_refs: [reference as string],
        }),
      );
      expectEvidenceGuidance(error, "invalid_evidence_ref");
      expect(error.message).toContain(reason);
    }

    const missing = errorFrom(() =>
      store.appendReportForSession({
        ...author.credential,
        idempotency_key: "missing-evidence",
        kind: "observation",
        body: "Cites a report that does not exist.",
        evidence_refs: ["report:report_missing"],
      }),
    );
    expectEvidenceGuidance(missing, "evidence_not_found");
    expect(missing.details.reference).toBe("report:report_missing");
  });

  test("projects checkpoint digests that resolve as checkpoint: evidence", () => {
    initializeGitRepository();
    const implementer = session("digest-implementer");
    const observer = session("digest-observer");
    const task = createAcceptedEditTask(implementer, "digest-task", "src/digest.ts");
    expect(task.base_checkpoint_digest).toBeNull();
    expect(task.result_checkpoint_digest).toBeNull();

    const claim = store.claimTaskForSession({
      ...implementer.credential,
      idempotency_key: "digest-claim",
      task_id: task.id,
      expected_version: task.version,
    });
    const baseDigest = createHash("sha256")
      .update(canonicalJson(claim.base_checkpoint))
      .digest("hex");
    expect(claim.base_checkpoint_digest).toBe(baseDigest);
    expect(claim.result_checkpoint_digest).toBeNull();

    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "digest.ts"), "export const digest = true;\n");
    const reported = store.completeTaskForSession({
      ...implementer.credential,
      idempotency_key: "digest-complete",
      task_id: task.id,
      lease_id: claim.lease_id!,
      expected_version: claim.version,
      summary: "Digest fixture written.",
    });
    const resultDigest = createHash("sha256")
      .update(canonicalJson(reported.result_checkpoint))
      .digest("hex");
    expect(resultDigest).not.toBe(baseDigest);
    expect(reported.base_checkpoint_digest).toBe(baseDigest);
    expect(reported.result_checkpoint_digest).toBe(resultDigest);
    expect(store.getTask(task.workspace_id, task.id)).toMatchObject({
      base_checkpoint_digest: baseDigest,
      result_checkpoint_digest: resultDigest,
    });

    const cited = store.appendReportForSession({
      ...observer.credential,
      idempotency_key: "cite-both-checkpoints",
      task_id: task.id,
      kind: "observation",
      body: "Both server-observed checkpoints are cited by digest.",
      evidence_refs: [`checkpoint:${baseDigest}`, `checkpoint:${resultDigest}`],
    });
    expect(cited.evidence_refs).toEqual(
      [`checkpoint:${baseDigest}`, `checkpoint:${resultDigest}`].sort(),
    );
  });

  test("hydrates checkpoint digests into stored replies that predate them", () => {
    const owner = session("digest-hydration-owner");
    const request = {
      workspace_id: owner.workspace.id,
      actor: "legacy-digest-actor",
      idempotency_key: "legacy-digest-create",
      title: "Legacy digest receipt",
    };
    store.createTask(request);
    const checkpoint = {
      worktree_id: owner.worktree.id,
      head_sha: null,
      branch: null,
      dirty: null,
      captured_at: "2026-07-23T10:00:00.000Z",
    };
    const stored = store.db.query(`
      SELECT response_json FROM mutations
      WHERE workspace_id = ? AND actor = ? AND idempotency_key = ?
    `).get(request.workspace_id, request.actor, request.idempotency_key) as {
      response_json: string;
    };
    const preUpgrade = JSON.parse(stored.response_json) as Record<string, unknown>;
    delete preUpgrade.base_checkpoint_digest;
    delete preUpgrade.result_checkpoint_digest;
    preUpgrade.base_checkpoint = checkpoint;
    store.db.query(`
      UPDATE mutations SET response_json = ?
      WHERE workspace_id = ? AND actor = ? AND idempotency_key = ?
    `).run(
      JSON.stringify(preUpgrade),
      request.workspace_id,
      request.actor,
      request.idempotency_key,
    );

    const replay = store.createTask(request);
    expect(replay.base_checkpoint_digest).toBe(
      createHash("sha256").update(canonicalJson(checkpoint)).digest("hex"),
    );
    expect(replay.result_checkpoint_digest).toBeNull();
  });
});

describe("collab_task_review confidence", () => {
  function reportedForReview(prefix: string) {
    const implementer = session(`${prefix}-implementer`);
    const reviewer = session(`${prefix}-reviewer`);
    const task = createAcceptedEditTask(implementer, `${prefix}-task`, `src/${prefix}.ts`);
    const claim = store.claimTaskForSession({
      ...implementer.credential,
      idempotency_key: `${prefix}-claim`,
      task_id: task.id,
      expected_version: task.version,
    });
    const reported = store.completeTaskForSession({
      ...implementer.credential,
      idempotency_key: `${prefix}-complete`,
      task_id: task.id,
      lease_id: claim.lease_id!,
      expected_version: claim.version,
      summary: "Ready for review.",
    });
    return { reviewer, reported };
  }

  function reviewRequestHash(
    reviewer: SessionHandle,
    workspaceId: string,
    idempotencyKey: string,
  ): string {
    return (
      store.db.query(`
        SELECT request_hash FROM mutations
        WHERE workspace_id = ? AND actor = ? AND idempotency_key = ?
      `).get(workspaceId, `session:${reviewer.session.id}`, idempotencyKey) as {
        request_hash: string;
      }
    ).request_hash;
  }

  function expectedHash(request: Record<string, unknown>): string {
    return createHash("sha256")
      .update(canonicalJson({ operation: "task.review.v2", request }))
      .digest("hex");
  }

  test("stores reviewer confidence, basis and limits on the review report", () => {
    const { reviewer, reported } = reportedForReview("confident");
    const reviewed = store.reviewTaskForSession({
      ...reviewer.credential,
      idempotency_key: "confident-review",
      task_id: reported.id,
      expected_version: reported.version,
      outcome: "accept",
      summary: "Read the change and reran the targeted tests.",
      confidence: "high",
      confidence_basis: "Targeted tests pass locally.",
      limits: "Did not run the full suite.",
    });
    expect(reviewed.report).toMatchObject({
      relation: "supports",
      target_report_id: reported.completion_report_id,
      confidence: "high",
      confidence_basis: "Targeted tests pass locally.",
      limits: "Did not run the full suite.",
    });
    const posted = store.eventsSince(reported.workspace_id, 0, 500).events.find(
      (event) => event.type === "report.posted" && event.entity_id === reviewed.report.id,
    );
    expect(posted?.payload).toMatchObject({
      confidence: "high",
      confidence_basis: "Targeted tests pass locally.",
      limits: "Did not run the full suite.",
    });
  });

  test("hashes absent, blank and default review fields exactly as before", () => {
    const plain = reportedForReview("plain");
    const defaults = reportedForReview("defaults");
    const request = (reported: typeof plain.reported) => ({
      task_id: reported.id,
      expected_version: reported.version,
      outcome: "request_changes" as const,
      summary: "The result needs one more check.",
    });
    const plainReview = store.reviewTaskForSession({
      ...plain.reviewer.credential,
      idempotency_key: "plain-review",
      ...request(plain.reported),
    });
    const defaultReview = store.reviewTaskForSession({
      ...defaults.reviewer.credential,
      idempotency_key: "defaults-review",
      ...request(defaults.reported),
      confidence: "unknown",
      confidence_basis: "",
      limits: "   ",
    });
    for (const [handle, reviewed, idempotencyKey] of [
      [plain, plainReview, "plain-review"],
      [defaults, defaultReview, "defaults-review"],
    ] as const) {
      expect(reviewed.report).toMatchObject({
        relation: "challenges",
        confidence: "unknown",
        confidence_basis: null,
        limits: null,
      });
      expect(
        reviewRequestHash(handle.reviewer, handle.reported.workspace_id, idempotencyKey),
      ).toBe(expectedHash({ ...request(handle.reported), evidence_refs: [] }));
    }
    // A retry that omits the default-valued fields (as a 0.3.1 copy would) replays.
    expect(
      store.reviewTaskForSession({
        ...defaults.reviewer.credential,
        idempotency_key: "defaults-review",
        ...request(defaults.reported),
      }).report.id,
    ).toBe(defaultReview.report.id);
  });

  test("binds supplied confidence fields into the idempotency request", () => {
    const { reviewer, reported } = reportedForReview("bound");
    const review = {
      ...reviewer.credential,
      idempotency_key: "bound-review",
      task_id: reported.id,
      expected_version: reported.version,
      outcome: "accept" as const,
      summary: "Spot-checked the change.",
      confidence: "medium" as const,
      confidence_basis: "Two of three paths were read.",
    };
    const first = store.reviewTaskForSession(review);
    expect(store.reviewTaskForSession(review).report.id).toBe(first.report.id);
    expect(reviewRequestHash(reviewer, reported.workspace_id, "bound-review")).toBe(
      expectedHash({
        task_id: reported.id,
        expected_version: reported.version,
        outcome: "accept",
        summary: "Spot-checked the change.",
        evidence_refs: [],
        confidence: "medium",
        confidence_basis: "Two of three paths were read.",
      }),
    );
    expect(
      errorCode(() => store.reviewTaskForSession({ ...review, confidence: "low" })),
    ).toBe("idempotency_conflict");
  });

  test("treats blank basis or limits as absent and trims supplied text", () => {
    const { reviewer, reported } = reportedForReview("blank");
    const review = {
      ...reviewer.credential,
      idempotency_key: "blank-review",
      task_id: reported.id,
      expected_version: reported.version,
      outcome: "accept" as const,
      summary: "Checked the one changed path.",
      confidence: "low" as const,
      confidence_basis: " \n ",
      limits: "  Only one path was read.  ",
    };
    const first = store.reviewTaskForSession(review);
    expect(first.report).toMatchObject({
      confidence: "low",
      confidence_basis: null,
      limits: "Only one path was read.",
    });
    expect(reviewRequestHash(reviewer, reported.workspace_id, "blank-review")).toBe(
      expectedHash({
        task_id: reported.id,
        expected_version: reported.version,
        outcome: "accept",
        summary: "Checked the one changed path.",
        evidence_refs: [],
        confidence: "low",
        limits: "Only one path was read.",
      }),
    );
    const { confidence_basis: _blankBasis, ...withoutBasis } = review;
    expect(store.reviewTaskForSession(withoutBasis).report.id).toBe(first.report.id);
    expect(
      store.reviewTaskForSession({ ...review, confidence_basis: "", limits: "Only one path was read." })
        .report.id,
    ).toBe(first.report.id);
  });

  test("rejects an unsupported review confidence before any write", () => {
    const { reviewer, reported } = reportedForReview("unsupported");
    expect(
      errorCode(() =>
        store.reviewTaskForSession({
          ...reviewer.credential,
          idempotency_key: "unsupported-confidence-review",
          task_id: reported.id,
          expected_version: reported.version,
          outcome: "accept",
          summary: "Claims an unsupported confidence.",
          confidence: "certain" as any,
        }),
      ),
    ).toBe("invalid_report_confidence");
    expect(store.getTask(reported.workspace_id, reported.id).review_status).toBe("pending");
  });
});

function createLegacyFixture(
  path: string,
  rootPath: string,
): { workspaceId: string; eventHash: string } {
  const db = new Database(path, { create: true, strict: true });
  db.exec(`
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      epoch_id TEXT NOT NULL,
      root_path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      event_head_sequence INTEGER NOT NULL DEFAULT 0,
      event_head_hash TEXT NOT NULL
    );
    CREATE TABLE tasks (
      id TEXT NOT NULL,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL CHECK(status IN ('open', 'claimed', 'blocked', 'completed')),
      dependencies_json TEXT NOT NULL,
      path_scopes_json TEXT NOT NULL,
      assignee TEXT,
      lease_id TEXT,
      lease_expires_at TEXT,
      blocker TEXT,
      latest_progress TEXT,
      version INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      PRIMARY KEY (workspace_id, id)
    );
    CREATE TABLE artifacts (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      uri TEXT NOT NULL,
      sha256 TEXT,
      media_type TEXT,
      label TEXT,
      attached_by TEXT NOT NULL,
      attached_at TEXT NOT NULL
    );
    CREATE TABLE decisions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      topic TEXT NOT NULL,
      decision TEXT NOT NULL,
      rationale TEXT,
      recorded_by TEXT NOT NULL,
      recorded_at TEXT NOT NULL
    );
    CREATE TABLE handoffs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      from_actor TEXT NOT NULL,
      to_actor TEXT NOT NULL,
      summary TEXT NOT NULL,
      status TEXT NOT NULL,
      offered_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE TABLE events (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      epoch_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      id TEXT NOT NULL UNIQUE,
      protocol TEXT NOT NULL,
      type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      actor TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL,
      PRIMARY KEY (workspace_id, sequence)
    );
    CREATE TABLE mutations (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id),
      actor TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      operation TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, actor, idempotency_key)
    );
  `);
  const workspaceId = "ws_legacy_fixture";
  const epochId = "epoch_legacy_fixture";
  const occurredAt = "2026-07-20T10:00:00.000Z";
  const payload = {
    name: "legacy-repo",
    root_path: rootPath,
    rights_profile: "xenia.rights/0.1",
  };
  const eventBody = {
    protocol: "agenttool.collab/0.1",
    workspace_id: workspaceId,
    epoch_id: epochId,
    sequence: 1,
    id: "event_legacy_fixture",
    type: "workspace.opened",
    entity_id: workspaceId,
    actor: "legacy-coordinator",
    occurred_at: occurredAt,
    payload,
    prev_hash: GENESIS_HASH,
  };
  const eventHash = createHash("sha256")
    .update(canonicalJson(eventBody))
    .digest("hex");
  db.query(`
    INSERT INTO workspaces (
      id, epoch_id, root_path, name, created_at,
      event_head_sequence, event_head_hash
    ) VALUES (?, ?, ?, ?, ?, 1, ?)
  `).run(
    workspaceId,
    epochId,
    rootPath,
    "legacy-repo",
    occurredAt,
    eventHash,
  );
  db.query(`
    INSERT INTO events (
      workspace_id, epoch_id, sequence, id, protocol, type, entity_id,
      actor, occurred_at, payload_json, prev_hash, hash
    ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    workspaceId,
    epochId,
    eventBody.id,
    eventBody.protocol,
    eventBody.type,
    eventBody.entity_id,
    eventBody.actor,
    eventBody.occurred_at,
    canonicalJson(payload),
    GENESIS_HASH,
    eventHash,
  );
  db.close();
  return { workspaceId, eventHash };
}
