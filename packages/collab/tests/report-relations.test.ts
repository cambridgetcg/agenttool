import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CollabError } from "../src/errors.js";
import type { SessionHandle } from "../src/protocol.js";
import { CollabStore } from "../src/store.js";

// Characterization tests: each pins a rule the ordinary-loop docs state, on
// behaviour origin/main already has. They pass before the doc rewrite.

let directory: string;
let root: string;
let store: CollabStore;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agenttool-collab-relations-"));
  root = join(directory, "repo");
  mkdirSync(root);
  store = new CollabStore(join(directory, "state", "collab.sqlite"));
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function session(actor: string, rootPath = root, parentSessionId?: string): SessionHandle {
  return store.startSession({
    root_path: rootPath,
    actor,
    ...(parentSessionId ? { parent_session_id: parentSessionId } : {}),
  });
}

function errorCode(operation: () => unknown): string {
  try {
    operation();
  } catch (error) {
    if (error instanceof CollabError) return error.code;
    throw error;
  }
  throw new Error("expected operation to fail");
}

describe("report relations as documented", () => {
  test("answers a proposal with supports and challenges from other sessions", () => {
    const proposer = session("proposer");
    const supporter = session("supporter");
    const challenger = session("challenger");
    const proposal = store.appendReportForSession({
      ...proposer.credential,
      idempotency_key: "proposal",
      kind: "proposal",
      body: "Split the parser work into two tasks.",
    });
    expect(proposal).toMatchObject({ relation: "informs", target_report_id: null, task_id: null });

    const support = store.appendReportForSession({
      ...supporter.credential,
      idempotency_key: "support-proposal",
      kind: "inference",
      body: "Agreed: the halves touch disjoint paths.",
      evidence_refs: [`report:${proposal.id}`],
      relation: "supports",
      target_report_id: proposal.id,
    });
    const challenge = store.appendReportForSession({
      ...challenger.credential,
      idempotency_key: "challenge-proposal",
      kind: "inference",
      body: "Both halves share one fixture.",
      relation: "challenges",
      target_report_id: proposal.id,
    });
    expect(support).toMatchObject({
      relation: "supports",
      target_report_id: proposal.id,
      from_session_id: supporter.session.id,
    });
    expect(challenge).toMatchObject({
      relation: "challenges",
      target_report_id: proposal.id,
      from_session_id: challenger.session.id,
    });

    const task = store.createTaskForSession({
      ...proposer.credential,
      idempotency_key: "scoped-task",
      title: "Scoped",
      work_mode: "coordination",
    });
    const scoped = store.appendReportForSession({
      ...proposer.credential,
      idempotency_key: "scoped-proposal",
      task_id: task.id,
      kind: "proposal",
      body: "Run this task after the parser split.",
    });
    expect(store.appendReportForSession({
      ...supporter.credential,
      idempotency_key: "support-scoped",
      task_id: task.id,
      kind: "inference",
      body: "Agreed within the task scope.",
      relation: "supports",
      target_report_id: scoped.id,
    }).task_id).toBe(task.id);
    expect(errorCode(() => store.appendReportForSession({
      ...supporter.credential,
      idempotency_key: "support-scoped-without-task",
      kind: "inference",
      body: "Same answer, wrong scope.",
      relation: "supports",
      target_report_id: scoped.id,
    }))).toBe("report_task_mismatch");
  });

  test("enforces the relation-targeting table", () => {
    const author = session("author");
    const other = session("other");
    const third = session("third");
    const original = store.appendReportForSession({
      ...author.credential,
      idempotency_key: "original",
      kind: "observation",
      body: "The build passed locally.",
    });
    const append = (
      who: SessionHandle,
      key: string,
      relation: "informs" | "supports" | "challenges" | "resolves" | "corrects" | "withdraws" | "supersedes",
      target?: string,
    ) => store.appendReportForSession({
      ...who.credential,
      idempotency_key: key,
      kind: "observation",
      body: `${relation} ${key}`,
      relation,
      ...(target ? { target_report_id: target } : {}),
    });

    expect(errorCode(() => append(other, "informs-with-target", "informs", original.id)))
      .toBe("invalid_report_relation");
    for (const relation of ["supports", "challenges", "resolves", "corrects", "withdraws", "supersedes"] as const) {
      expect(errorCode(() => append(author, `${relation}-without-target`, relation)))
        .toBe("report_target_required");
    }
    for (const relation of ["corrects", "withdraws", "supersedes"] as const) {
      expect(errorCode(() => append(other, `${relation}-by-other`, relation, original.id)))
        .toBe("report_author_mismatch");
    }
    expect(append(author, "corrects-by-author", "corrects", original.id).relation).toBe("corrects");
    expect(append(author, "supersedes-by-author", "supersedes", original.id).relation).toBe("supersedes");

    expect(errorCode(() => append(other, "resolves-non-challenge", "resolves", original.id)))
      .toBe("invalid_report_relation");
    const challenge = append(other, "challenge-original", "challenges", original.id);
    expect(append(third, "resolves-by-third", "resolves", challenge.id)).toMatchObject({
      relation: "resolves",
      target_report_id: challenge.id,
      from_session_id: third.session.id,
    });
    expect(append(author, "withdraws-by-author", "withdraws", original.id).relation).toBe("withdraws");
  });

  test("routes an addressed report to one session's collab_next but keeps it listable", () => {
    const sender = session("sender");
    const recipient = session("recipient");
    const bystander = session("bystander");
    const addressed = store.appendReportForSession({
      ...sender.credential,
      idempotency_key: "addressed",
      to_session_id: recipient.session.id,
      kind: "proposal",
      body: "Please review the parser task.",
    });

    const routed = (who: SessionHandle) =>
      store.nextForSession({ ...who.credential, event_limit: 50 }).reports.map((report) => report.id);
    expect(routed(recipient)).toContain(addressed.id);
    expect(routed(bystander)).not.toContain(addressed.id);
    expect(store.listReports(sender.workspace.id).map((report) => report.id)).toContain(addressed.id);
  });

  test("treats parent_session_id as declared lineage checked only for workspace", () => {
    const parent = session("parent");
    const child = session("Codex · sol job 20261008T000000-000000000000", root, parent.session.id);
    expect(child.session.parent_session_id).toBe(parent.session.id);
    expect(child.workspace.id).toBe(parent.workspace.id);

    const otherRoot = join(directory, "other-repo");
    mkdirSync(otherRoot);
    expect(errorCode(() => session("stranger", otherRoot, parent.session.id)))
      .toBe("parent_session_mismatch");
    expect(errorCode(() => session("orphan", root, "session_00000000-0000-0000-0000-000000000000")))
      .toBe("session_not_found");

    // Lineage grants nothing and blocks nothing: the child is a distinct
    // session, so it may accept its parent's reviewed edit task.
    const task = store.createTaskForSession({
      ...parent.credential,
      idempotency_key: "parent-task",
      title: "Parent task",
      work_mode: "edit",
      completion_policy: "accepted",
      path_scopes: ["src/parent.ts"],
    });
    const claim = store.claimTaskForSession({
      ...parent.credential,
      idempotency_key: "parent-claim",
      task_id: task.id,
      expected_version: task.version,
    });
    const reported = store.completeTaskForSession({
      ...parent.credential,
      idempotency_key: "parent-complete",
      task_id: task.id,
      lease_id: claim.lease_id!,
      expected_version: claim.version,
      summary: "Parent finished.",
    });
    const accepted = store.reviewTaskForSession({
      ...child.credential,
      idempotency_key: "child-accepts",
      task_id: task.id,
      expected_version: reported.version,
      outcome: "accept",
      summary: "Child reviewed the parent's evidence.",
    });
    expect(accepted.task.accepted_by_session_id).toBe(child.session.id);

    // An ended parent still counts as existing lineage.
    store.endSession({ ...parent.credential, reason: "parent done" });
    expect(session("late child", root, parent.session.id).session.parent_session_id)
      .toBe(parent.session.id);
  });
});
