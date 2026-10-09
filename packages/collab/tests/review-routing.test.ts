import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalJson } from "../src/canonical.js";
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

describe("requested reviewers", () => {
  test("routes a review request to one session without reserving the review", () => {
    const implementer = session("implementer");
    const requested = session("requested-reviewer");
    const bystander = session("bystander");
    const claimed = claimedEditTask(implementer, "requested");
    const reported = store.completeTaskForSession({
      ...implementer.credential,
      idempotency_key: "requested-complete",
      task_id: claimed.id,
      lease_id: claimed.lease_id!,
      expected_version: claimed.version,
      summary: "Ready for the requested reviewer.",
      review_requested_session_id: requested.session.id,
    });
    expect(reported.review_requested_session_id).toBe(requested.session.id);
    expect(store.getTask(reported.workspace_id, reported.id).review_requested_session_id)
      .toBe(requested.session.id);

    const completedEvent = store.db.query(`
      SELECT payload_json FROM events
      WHERE entity_id = ? AND type = 'task.reported_complete'
    `).get(reported.id) as { payload_json: string };
    expect(JSON.parse(completedEvent.payload_json).review_requested_session_id)
      .toBe(requested.session.id);

    const taskReports = store.listReports(reported.workspace_id, { task_id: reported.id });
    const completion = taskReports.find((report) => report.id === reported.completion_report_id)!;
    expect(completion.to_session_id).toBeNull();
    const requests = taskReports.filter((report) => report.to_session_id === requested.session.id);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      from_session_id: implementer.session.id,
      kind: "proposal",
      relation: "informs",
      target_report_id: null,
      evidence_refs: [`report:${reported.completion_report_id}`],
    });
    expect(requests[0]!.body).toContain("not a reservation");

    const requestedNext = store.nextForSession({ ...requested.credential, event_limit: 50 });
    expect(requestedNext.reports.map((report) => report.id)).toContain(requests[0]!.id);
    const bystanderNext = store.nextForSession({ ...bystander.credential, event_limit: 50 });
    expect(bystanderNext.reports.map((report) => report.id)).toContain(completion.id);
    expect(bystanderNext.reports.map((report) => report.id)).not.toContain(requests[0]!.id);

    expect(
      errorFrom(() =>
        store.completeTaskForSession({
          ...implementer.credential,
          idempotency_key: "requested-complete",
          task_id: claimed.id,
          lease_id: claimed.lease_id!,
          expected_version: claimed.version,
          summary: "Ready for the requested reviewer.",
        }),
      ).code,
    ).toBe("idempotency_conflict");

    const accepted = store.reviewTaskForSession({
      ...bystander.credential,
      idempotency_key: "bystander-accepts",
      task_id: reported.id,
      expected_version: reported.version,
      outcome: "accept",
      summary: "A request is not a reservation; this distinct review counts.",
    });
    expect(accepted.task.review_status).toBe("accepted");
    expect(accepted.task.review_requested_session_id).toBe(requested.session.id);
  });

  test("refuses review requests that cannot be honoured and leaves the claim intact", () => {
    const implementer = session("implementer");
    const departed = session("departed-reviewer");
    store.endSession({ ...departed.credential, reason: "left before the request" });
    const elsewhereRoot = join(directory, "elsewhere");
    mkdirSync(elsewhereRoot);
    const elsewhere = session("elsewhere-reviewer", elsewhereRoot);
    expect(elsewhere.workspace.id).not.toBe(implementer.workspace.id);
    const claimed = claimedEditTask(implementer, "refused-request");
    const attempt = (key: string, reviewRequestedSessionId: string) =>
      errorFrom(() =>
        store.completeTaskForSession({
          ...implementer.credential,
          idempotency_key: key,
          task_id: claimed.id,
          lease_id: claimed.lease_id!,
          expected_version: claimed.version,
          summary: "Ready.",
          review_requested_session_id: reviewRequestedSessionId,
        }),
      );
    expect(attempt("request-self", implementer.session.id).code).toBe("review_request_self");
    const ended = attempt("request-ended", departed.session.id);
    expect(ended.code).toBe("review_requested_session_unavailable");
    expect(ended.details).toEqual({ review_requested_session_id: departed.session.id });
    expect(attempt("request-elsewhere", elsewhere.session.id).code)
      .toBe("review_requested_session_unavailable");
    expect(attempt("request-missing", "session_missing").code)
      .toBe("review_requested_session_unavailable");
    expect(attempt("request-blank", "   ").code).toBe("invalid_review_requested_session_id");
    expect(store.getTask(claimed.workspace_id, claimed.id).status).toBe("claimed");
    expect(store.listReports(claimed.workspace_id, { task_id: claimed.id })).toEqual([]);

    const coordination = store.createTaskForSession({
      ...implementer.credential,
      idempotency_key: "request-reported-only-create",
      title: "Reported-only coordination",
      work_mode: "coordination",
      completion_policy: "reported",
    });
    const coordinationClaim = store.claimTaskForSession({
      ...implementer.credential,
      idempotency_key: "request-reported-only-claim",
      task_id: coordination.id,
      expected_version: coordination.version,
    });
    const notApplicable = errorFrom(() =>
      store.completeTaskForSession({
        ...implementer.credential,
        idempotency_key: "request-reported-only-complete",
        task_id: coordination.id,
        lease_id: coordinationClaim.lease_id!,
        expected_version: coordinationClaim.version,
        summary: "Coordinated.",
        review_requested_session_id: departed.session.id,
      }),
    );
    expect(notApplicable.code).toBe("review_request_not_applicable");
    expect(notApplicable.details).toEqual({ completion_policy: "reported" });

    const plain = store.completeTaskForSession({
      ...implementer.credential,
      idempotency_key: "request-none",
      task_id: claimed.id,
      lease_id: claimed.lease_id!,
      expected_version: claimed.version,
      summary: "Ready.",
    });
    expect(plain.review_requested_session_id).toBeNull();
    const receipt = store.db.query(`
      SELECT request_hash FROM mutations WHERE actor = ? AND idempotency_key = 'request-none'
    `).get(`session:${implementer.session.id}`) as { request_hash: string };
    expect(receipt.request_hash).toBe(
      createHash("sha256").update(canonicalJson({
        operation: "task.complete.v2",
        request: {
          task_id: claimed.id,
          lease_id: claimed.lease_id,
          expected_version: claimed.version,
          summary: "Ready.",
          confidence: "unknown",
          confidence_basis: null,
          limits: null,
          evidence_refs: [],
        },
      })).digest("hex"),
    );
  });

  test("drops or switches the requested reviewer when changes are requested and the task is re-reported", () => {
    const implementer = session("implementer");
    const firstRequested = session("first-requested");
    const secondRequested = session("second-requested");
    const claimed = claimedEditTask(implementer, "re-request");
    const first = store.completeTaskForSession({
      ...implementer.credential,
      idempotency_key: "re-request-complete-1",
      task_id: claimed.id,
      lease_id: claimed.lease_id!,
      expected_version: claimed.version,
      summary: "First attempt.",
      review_requested_session_id: firstRequested.session.id,
    });
    expect(first.review_requested_session_id).toBe(firstRequested.session.id);

    const firstChanges = store.reviewTaskForSession({
      ...firstRequested.credential,
      idempotency_key: "re-request-changes-1",
      task_id: first.id,
      expected_version: first.version,
      outcome: "request_changes",
      summary: "One more check, please.",
    });
    expect(firstChanges.task.review_requested_session_id).toBeNull();
    const secondClaim = reclaim(implementer, firstChanges.task, "re-request-2");
    expect(secondClaim.review_requested_session_id).toBeNull();
    const second = store.completeTaskForSession({
      ...implementer.credential,
      idempotency_key: "re-request-complete-2",
      task_id: secondClaim.id,
      lease_id: secondClaim.lease_id!,
      expected_version: secondClaim.version,
      summary: "Second attempt, no particular reviewer.",
    });
    expect(second.review_requested_session_id).toBeNull();
    expect(store.getTask(second.workspace_id, second.id).review_requested_session_id).toBeNull();

    const secondChanges = store.reviewTaskForSession({
      ...firstRequested.credential,
      idempotency_key: "re-request-changes-2",
      task_id: second.id,
      expected_version: second.version,
      outcome: "request_changes",
      summary: "Still one gap.",
    });
    const thirdClaim = reclaim(implementer, secondChanges.task, "re-request-3");
    const third = store.completeTaskForSession({
      ...implementer.credential,
      idempotency_key: "re-request-complete-3",
      task_id: thirdClaim.id,
      lease_id: thirdClaim.lease_id!,
      expected_version: thirdClaim.version,
      summary: "Third attempt, for a fresh pair of eyes.",
      review_requested_session_id: secondRequested.session.id,
    });
    expect(third.review_requested_session_id).toBe(secondRequested.session.id);

    const requests = store.listReports(third.workspace_id, { task_id: third.id })
      .filter((report) => report.kind === "proposal" && report.from_session_id === implementer.session.id);
    expect(requests.map((report) => [report.to_session_id, report.evidence_refs])).toEqual([
      [firstRequested.session.id, [`report:${first.completion_report_id}`]],
      [secondRequested.session.id, [`report:${third.completion_report_id}`]],
    ]);

    const accepted = store.reviewTaskForSession({
      ...secondRequested.credential,
      idempotency_key: "re-request-accept",
      task_id: third.id,
      expected_version: third.version,
      outcome: "accept",
      summary: "The third attempt holds.",
    });
    expect(accepted.task.review_requested_session_id).toBe(secondRequested.session.id);
  });

  test("carries review_requested_session_id through MCP and refuses it without a bound session", async () => {
    const implementer = await boundMember("implementer");
    const reviewer = await boundMember("reviewer");
    const completeTool = (implementer.server as any)._registeredTools.collab_task_complete;
    expect(completeTool.inputSchema.shape.review_requested_session_id.description)
      .toContain("not a reservation");
    const created = await callTool(implementer.server, "collab_task_create", {
      workspace_id: implementer.workspace_id,
      idempotency_key: "mcp-request-create",
      title: "MCP requested review",
      work_mode: "edit",
      path_scopes: ["src/mcp-request.ts"],
    });
    const claimed = await callTool(implementer.server, "collab_task_claim", {
      workspace_id: implementer.workspace_id,
      idempotency_key: "mcp-request-claim",
      task_id: created.structuredContent.task.id,
      expected_version: created.structuredContent.task.version,
    });
    const reported = await callTool(implementer.server, "collab_task_complete", {
      workspace_id: implementer.workspace_id,
      idempotency_key: "mcp-request-complete",
      task_id: claimed.structuredContent.task.id,
      lease_id: claimed.structuredContent.task.lease_id,
      expected_version: claimed.structuredContent.task.version,
      summary: "Ready for review.",
      review_requested_session_id: reviewer.session_id,
    });
    expect(reported.isError).toBeUndefined();
    expect(reported.structuredContent.task.review_requested_session_id).toBe(reviewer.session_id);
    const routed = await callTool(reviewer.server, "collab_next", {
      workspace_id: reviewer.workspace_id,
      event_limit: 50,
    });
    expect(routed.isError).toBeUndefined();
    expect(routed.structuredContent.reports.some(
      (report: any) => report.to_session_id === reviewer.session_id && report.kind === "proposal",
    )).toBe(true);

    const legacyStore = new CollabStore(databasePath, { now: () => new Date(currentTime) });
    memberStores.push(legacyStore);
    const legacyServer = buildCollabMcpServer(legacyStore);
    const refused = await callTool(legacyServer, "collab_task_complete", {
      workspace_id: implementer.workspace_id,
      actor: "legacy-actor",
      task_id: created.structuredContent.task.id,
      lease_id: "lease_unused",
      idempotency_key: "legacy-review-request",
      expected_version: 1,
      summary: "Legacy completion cannot route a review request.",
      review_requested_session_id: reviewer.session_id,
    });
    expect(refused.isError).toBe(true);
    expect(refused.structuredContent.error).toBe("session_required_for_review_request");
  });
});
