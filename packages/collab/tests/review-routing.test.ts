import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollabError } from "../src/errors.js";
import { buildCollabMcpServer } from "../src/mcp.js";
import type { SessionHandle, Task } from "../src/protocol.js";
import { CollabStore } from "../src/store.js";

let directory: string;
let root: string;
let databasePath: string;
let store: CollabStore;
let currentTime: Date;
const memberStores: CollabStore[] = [];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-review-routing-"));
  root = join(directory, "repo");
  mkdirSync(root);
  databasePath = join(directory, "state", "collab.sqlite");
  currentTime = new Date("2026-10-08T10:00:00.000Z");
  store = new CollabStore(databasePath, { now: () => new Date(currentTime) });
});

afterEach(() => {
  while (memberStores.length) memberStores.pop()!.close();
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

function claimedEditTask(owner: SessionHandle, name: string): Task {
  const created = store.createTaskForSession({
    ...owner.credential,
    idempotency_key: `${name}-create`,
    title: name,
    work_mode: "edit",
    completion_policy: "accepted",
    path_scopes: [`src/${name}.ts`],
  });
  return store.claimTaskForSession({
    ...owner.credential,
    idempotency_key: `${name}-claim`,
    task_id: created.id,
    expected_version: created.version,
  });
}

function reportedEditTask(owner: SessionHandle, name: string): Task {
  const claimed = claimedEditTask(owner, name);
  return store.completeTaskForSession({
    ...owner.credential,
    idempotency_key: `${name}-complete`,
    task_id: claimed.id,
    lease_id: claimed.lease_id!,
    expected_version: claimed.version,
    summary: `${name} is implemented and checked locally.`,
  });
}

/** Claims a task again after a reviewer sent it back with request_changes. */
function reclaim(owner: SessionHandle, reopened: Task, key: string): Task {
  return store.claimTaskForSession({
    ...owner.credential,
    idempotency_key: `${key}-reclaim`,
    task_id: reopened.id,
    expected_version: reopened.version,
  });
}

async function callTool(server: any, name: string, args: Record<string, unknown> = {}) {
  const registration = server._registeredTools[name];
  if (!registration) throw new Error(`tool not registered: ${name}`);
  return await (registration.handler ?? registration.callback)(args, {});
}

async function boundMember(actor: string) {
  const memberStore = new CollabStore(databasePath, { now: () => new Date(currentTime) });
  memberStores.push(memberStore);
  const server = buildCollabMcpServer(memberStore);
  const started = await callTool(server, "collab_session_start", { root_path: root, actor });
  if (started.isError) throw new Error(JSON.stringify(started.structuredContent));
  return {
    server,
    session_id: started.structuredContent.session.id as string,
    workspace_id: started.structuredContent.workspace.id as string,
  };
}

describe("late reviewers", () => {
  test("points a late distinct reviewer at the accepting review report", () => {
    const implementer = session("implementer");
    const reviewer = session("reviewer");
    const lateReviewer = session("late-reviewer");
    const reported = reportedEditTask(implementer, "late-review");
    const accepted = store.reviewTaskForSession({
      ...reviewer.credential,
      idempotency_key: "first-review",
      task_id: reported.id,
      expected_version: reported.version,
      outcome: "accept",
      summary: "Reviewed the result and accepted it locally.",
    });
    expect(accepted.task.version).toBe(reported.version + 1);

    const late = errorFrom(() =>
      store.reviewTaskForSession({
        ...lateReviewer.credential,
        idempotency_key: "late-review",
        task_id: reported.id,
        expected_version: reported.version,
        outcome: "accept",
        summary: "Independent review concurs.",
      }),
    );
    expect(late.code).toBe("task_not_pending_review");
    expect(late.details).toEqual({
      review_status: "accepted",
      review_report_id: accepted.report.id,
      accepted_by_session_id: reviewer.session.id,
      remedy: expect.stringContaining("collab_report_append"),
    });
    const remedy = late.details.remedy as string;
    expect(remedy).toContain('relation "supports" or "challenges"');
    expect(remedy).toContain(`target_report_id "${accepted.report.id}"`);
    expect(remedy).toContain("does not reopen the accepted task");
    expect(late.message).toContain("collab_report_append");

    const concurrence = store.appendReportForSession({
      ...lateReviewer.credential,
      idempotency_key: "late-concurrence",
      task_id: reported.id,
      kind: "observation",
      body: "Independent review concurs with the acceptance.",
      confidence: "medium",
      confidence_basis: "Read the diff and reran the targeted test.",
      relation: "supports",
      target_report_id: late.details.review_report_id as string,
    });
    expect(concurrence.relation).toBe("supports");
    expect(concurrence.target_report_id).toBe(accepted.report.id);
  });

  test("offers no late-review remedy to the reporter, the accepting reviewer, or never-pending tasks", () => {
    const implementer = session("implementer");
    const reviewer = session("reviewer");
    const reported = reportedEditTask(implementer, "reporter-late");
    store.reviewTaskForSession({
      ...reviewer.credential,
      idempotency_key: "reporter-late-review",
      task_id: reported.id,
      expected_version: reported.version,
      outcome: "accept",
      summary: "Accepted.",
    });
    const reporterAttempt = errorFrom(() =>
      store.reviewTaskForSession({
        ...implementer.credential,
        idempotency_key: "reporter-late-attempt",
        task_id: reported.id,
        expected_version: reported.version,
        outcome: "accept",
        summary: "The reporter cannot concur with itself.",
      }),
    );
    expect(reporterAttempt.code).toBe("task_not_pending_review");
    expect(reporterAttempt.details).toEqual({ review_status: "accepted" });

    const accepterRetry = errorFrom(() =>
      store.reviewTaskForSession({
        ...reviewer.credential,
        idempotency_key: "reporter-late-review-again",
        task_id: reported.id,
        expected_version: reported.version,
        outcome: "accept",
        summary: "The accepting reviewer retries under a new key.",
      }),
    );
    expect(accepterRetry.code).toBe("task_not_pending_review");
    expect(accepterRetry.details).toEqual({ review_status: "accepted" });

    const coordination = store.createTaskForSession({
      ...implementer.credential,
      idempotency_key: "reported-only-create",
      title: "Reported-only coordination",
      work_mode: "coordination",
      completion_policy: "reported",
    });
    const claim = store.claimTaskForSession({
      ...implementer.credential,
      idempotency_key: "reported-only-claim",
      task_id: coordination.id,
      expected_version: coordination.version,
    });
    const done = store.completeTaskForSession({
      ...implementer.credential,
      idempotency_key: "reported-only-complete",
      task_id: coordination.id,
      lease_id: claim.lease_id!,
      expected_version: claim.version,
      summary: "Coordinated.",
    });
    const notRequired = errorFrom(() =>
      store.reviewTaskForSession({
        ...reviewer.credential,
        idempotency_key: "reported-only-review",
        task_id: coordination.id,
        expected_version: claim.version,
        outcome: "accept",
        summary: "There is nothing pending to accept.",
      }),
    );
    expect(done.review_status).toBe("not_required");
    expect(notRequired.code).toBe("task_not_pending_review");
    expect(notRequired.details).toEqual({ review_status: "not_required" });
  });

  test("points a late reviewer at the current generation's acceptance after request_changes", () => {
    const implementer = session("implementer");
    const firstReviewer = session("first-reviewer");
    const secondReviewer = session("second-reviewer");
    const firstReport = reportedEditTask(implementer, "second-generation");
    const changes = store.reviewTaskForSession({
      ...firstReviewer.credential,
      idempotency_key: "second-generation-changes",
      task_id: firstReport.id,
      expected_version: firstReport.version,
      outcome: "request_changes",
      summary: "Needs one more check.",
    });
    expect(changes.review.review_generation).toBe(1);
    const reclaimed = reclaim(implementer, changes.task, "second-generation");
    const secondReport = store.completeTaskForSession({
      ...implementer.credential,
      idempotency_key: "second-generation-recomplete",
      task_id: reclaimed.id,
      lease_id: reclaimed.lease_id!,
      expected_version: reclaimed.version,
      summary: "The extra check is in.",
    });
    const accepted = store.reviewTaskForSession({
      ...secondReviewer.credential,
      idempotency_key: "second-generation-accept",
      task_id: secondReport.id,
      expected_version: secondReport.version,
      outcome: "accept",
      summary: "The second report holds.",
    });
    expect(accepted.review.review_generation).toBe(2);

    const late = errorFrom(() =>
      store.reviewTaskForSession({
        ...firstReviewer.credential,
        idempotency_key: "second-generation-late",
        task_id: firstReport.id,
        expected_version: firstReport.version,
        outcome: "accept",
        summary: "Coming back to the first report.",
      }),
    );
    expect(late.code).toBe("task_not_pending_review");
    expect(late.details.review_report_id).toBe(accepted.report.id);
    expect(late.details.review_report_id).not.toBe(changes.report.id);
    expect(late.details.accepted_by_session_id).toBe(secondReviewer.session.id);
  });

  test("answers a late reviewer without inspecting the completion worktree", () => {
    initializeGitRepository();
    const implementer = session("git-implementer");
    const reviewer = session("git-reviewer");
    const lateReviewer = session("git-late-reviewer");
    const reported = reportedEditTask(implementer, "git-late");
    expect(reported.result_checkpoint?.source).toBe("server_observed");
    const accepted = store.reviewTaskForSession({
      ...reviewer.credential,
      idempotency_key: "git-late-accept",
      task_id: reported.id,
      expected_version: reported.version,
      outcome: "accept",
      summary: "Accepted against the observed checkpoint.",
    });
    rmSync(root, { recursive: true, force: true });

    const late = errorFrom(() =>
      store.reviewTaskForSession({
        ...lateReviewer.credential,
        idempotency_key: "git-late-review",
        task_id: reported.id,
        expected_version: accepted.task.version,
        outcome: "accept",
        summary: "Concur after the worktree was removed.",
      }),
    );
    expect(late.code).toBe("task_not_pending_review");
    expect(late.details.review_report_id).toBe(accepted.report.id);
  });

  test("returns the late-review remedy as top-level MCP error fields", async () => {
    const implementer = await boundMember("implementer");
    const reviewer = await boundMember("reviewer");
    const lateReviewer = await boundMember("late-reviewer");
    const created = await callTool(implementer.server, "collab_task_create", {
      workspace_id: implementer.workspace_id,
      idempotency_key: "mcp-late-create",
      title: "MCP late review",
      work_mode: "edit",
      path_scopes: ["src/mcp-late.ts"],
    });
    const claimed = await callTool(implementer.server, "collab_task_claim", {
      workspace_id: implementer.workspace_id,
      idempotency_key: "mcp-late-claim",
      task_id: created.structuredContent.task.id,
      expected_version: created.structuredContent.task.version,
    });
    const reported = await callTool(implementer.server, "collab_task_complete", {
      workspace_id: implementer.workspace_id,
      idempotency_key: "mcp-late-complete",
      task_id: claimed.structuredContent.task.id,
      lease_id: claimed.structuredContent.task.lease_id,
      expected_version: claimed.structuredContent.task.version,
      summary: "Done.",
    });
    const accepted = await callTool(reviewer.server, "collab_task_review", {
      workspace_id: reviewer.workspace_id,
      idempotency_key: "mcp-late-accept",
      task_id: reported.structuredContent.task.id,
      expected_version: reported.structuredContent.task.version,
      outcome: "accept",
      summary: "Accepted.",
    });
    const late = await callTool(lateReviewer.server, "collab_task_review", {
      workspace_id: lateReviewer.workspace_id,
      idempotency_key: "mcp-late-review",
      task_id: reported.structuredContent.task.id,
      expected_version: reported.structuredContent.task.version,
      outcome: "accept",
      summary: "Concur.",
    });
    expect(late.isError).toBe(true);
    expect(late.structuredContent).toMatchObject({
      error: "task_not_pending_review",
      review_status: "accepted",
      review_report_id: accepted.structuredContent.report.id,
      accepted_by_session_id: reviewer.session_id,
    });
    expect(late.structuredContent.remedy).toContain("collab_report_append");
  });
});
