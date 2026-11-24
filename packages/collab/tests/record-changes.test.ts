import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionHandle, Task } from "../src/protocol.js";
import { observeChangedPaths } from "../src/repository.js";
import {
  changedPathFields,
  MAX_RECORDED_CHANGED_PATH_BYTES,
  MAX_RECORDED_CHANGED_PATHS,
  pathWithinScopesFolded,
  reviewerRelationAdvice,
} from "../src/store-notes.js";
import { completedTask, git, journal, ok, runCleanup, type Journal } from "./notes-helpers.js";

// Record-only fixes: what a completion changed (A1) and how a reviewer
// relates to the reporter (A2). Neither ever refuses.

afterEach(runCleanup);

function claimEdit(j: Journal, holder: SessionHandle, scopes: string[], policy: "accepted" | "reported" = "accepted", key = "t"): Task {
  const created = j.store.createTaskForSession({
    ...holder.credential,
    idempotency_key: `${key}-create`,
    title: "Edit the parser",
    work_mode: "edit",
    completion_policy: policy,
    path_scopes: scopes,
  });
  return j.store.claimTaskForSession({ ...holder.credential, idempotency_key: `${key}-claim`, task_id: created.id, expected_version: created.version });
}

function complete(j: Journal, holder: SessionHandle, claimed: Task, key = "t"): Task {
  return j.store.completeTaskForSession({
    ...holder.credential,
    idempotency_key: `${key}-complete`,
    task_id: claimed.id,
    lease_id: claimed.lease_id!,
    expected_version: claimed.version,
    summary: "Parser edited.",
  });
}

function completionPayload(j: Journal, taskId: string): Record<string, any> {
  return j.events().filter((event) => event.entity_id === taskId
    && (event.type === "task.reported_complete" || event.type === "task.completed")).at(-1)!.payload;
}

describe("observeChangedPaths", () => {
  test("lists tracked changes against the base commit and untracked files, never ignored ones", () => {
    const j = journal({ git: true });
    j.write("gone.txt", "gone\n");
    j.write("old name.txt", "a file long enough to be found as a rename\n");
    git(j.root, ["add", "gone.txt", "old name.txt"]);
    git(j.root, ["commit", "-q", "-m", "base"]);
    const base = git(j.root, ["rev-parse", "HEAD"]);
    j.write(".gitignore", "build/\n");
    j.write("src/brief.ts", "added and removed again since the base\n");
    git(j.root, ["add", ".gitignore", "src/brief.ts"]);
    git(j.root, ["commit", "-q", "-m", "after base"]);
    git(j.root, ["mv", "old name.txt", "new name.txt"]);
    rmSync(join(j.root, "gone.txt"));
    // A nested repository: Git names its directory and does not look inside.
    mkdirSync(join(j.root, "nested"));
    git(join(j.root, "nested"), ["init", "-q"]);
    j.write("nested/inside.txt", "inside\n");
    j.write("README.txt", "changed\n");
    j.write("src/staged.ts", "staged\n");
    git(j.root, ["add", "src/staged.ts"]);
    j.write("notes/new file.md", "untracked\n");
    j.write("build/out.js", "ignored\n");
    rmSync(join(j.root, "src", "brief.ts"));
    // Committed since the base, unstaged, deleted, nested, both sides of a rename, untracked, staged; sorted.
    expect(observeChangedPaths(j.root, base)).toEqual({
      ok: true,
      paths: [
        ".gitignore", "README.txt", "gone.txt", "nested/", "new name.txt", "notes/new file.md", "old name.txt", "src/staged.ts",
      ],
    });
  });

  test("a base that is not a commit here is unavailable, with a reason", () => {
    const j = journal({ git: true });
    expect(observeChangedPaths(j.root, "0".repeat(40))).toEqual({
      ok: false,
      reason: "Git could not list the changes since the base checkpoint's HEAD: that commit is missing, or a bound was exceeded",
    });
    expect(observeChangedPaths(j.root, "HEAD")).toMatchObject({ ok: false });
  });
});

describe("changed-path fields", () => {
  test("outside_scopes uses the claims' segment-aware, case-folded rule", () => {
    expect(pathWithinScopesFolded("src/a.ts", ["src"])).toBe(true);
    expect(pathWithinScopesFolded("SRC/a.ts", ["src"])).toBe(true);
    expect(pathWithinScopesFolded("src/a.ts", ["Src/A.ts"])).toBe(true);
    expect(pathWithinScopesFolded("srcx/a.ts", ["src"])).toBe(false);
    expect(pathWithinScopesFolded("src", ["src/a.ts"])).toBe(false);
    expect(pathWithinScopesFolded("a.ts", [])).toBe(false);
    // An untracked nested repository's name ends in "/".
    expect(pathWithinScopesFolded("nested/", ["nested"])).toBe(true);
    expect(pathWithinScopesFolded("nested/", ["nested/src"])).toBe(false);
    expect(pathWithinScopesFolded("re\u0301sume\u0301/x", ["r\u00e9sum\u00e9"])).toBe(true);
  });

  test("lists are capped by count and by bytes, with totals and one truncation flag", () => {
    const many = Array.from({ length: MAX_RECORDED_CHANGED_PATHS + 10 }, (_, index) => `x/${String(index).padStart(4, "0")}`);
    const capped = changedPathFields({ ok: true, paths: many }, ["x/0000"]);
    expect(capped.changed_paths).toHaveLength(MAX_RECORDED_CHANGED_PATHS);
    expect(capped.changed_paths_count).toBe(many.length);
    expect(capped.outside_scopes).toHaveLength(MAX_RECORDED_CHANGED_PATHS);
    expect(capped.outside_scopes_count).toBe(many.length - 1);
    expect(capped.changed_paths_truncated).toBe(true);
    const long = Array.from({ length: 20 }, (_, index) => `${index}`.padEnd(1_000, "a"));
    const byBytes = changedPathFields({ ok: true, paths: long }, []);
    expect(Buffer.byteLength(JSON.stringify(byBytes.changed_paths))).toBeLessThanOrEqual(MAX_RECORDED_CHANGED_PATH_BYTES + 1);
    expect(byBytes.changed_paths).toHaveLength(12);
    expect(byBytes.changed_paths_truncated).toBe(true);
    // Escapes count: each of these characters takes six bytes as JSON.
    const escaped = Array.from({ length: 200 }, (_, index) => "\u0001".repeat(200) + index);
    const byEscapes = changedPathFields({ ok: true, paths: escaped }, []);
    expect(Buffer.byteLength(JSON.stringify(byEscapes))).toBeLessThan(26 * 1024);
    expect(byEscapes.changed_paths_count).toBe(200);
    expect(byEscapes.changed_paths_truncated).toBe(true);
    const small = changedPathFields({ ok: true, paths: ["a"] }, ["a"]);
    expect(small).toEqual({
      changed_paths_basis: "server_observed",
      changed_paths: ["a"],
      changed_paths_count: 1,
      outside_scopes: [],
      outside_scopes_count: 0,
    });
    expect(changedPathFields({ ok: false, reason: "why" }, [])).toEqual({ changed_paths_basis: "unavailable", changed_paths_reason: "why" });
  });
});

describe("completion records the server-observed changed paths", () => {
  test("a git root records changed_paths and outside_scopes, and completion still goes through", () => {
    const j = journal({ git: true });
    const a = j.start("alpha");
    // The scope's case differs from the files': claims fold case, and so does this.
    const claimed = claimEdit(j, a, ["Src"]);
    j.write("src/parser.ts", "export const x = 1;\n");
    j.write("src/Upper.ts", "folded\n");
    j.write("srcx/near.ts", "outside\n");
    j.write("README.txt", "touched\n");
    const done = complete(j, a, claimed);
    expect(done.status).toBe("completed");
    const payload = completionPayload(j, claimed.id);
    expect(payload).toMatchObject({
      changed_paths_basis: "server_observed",
      changed_paths: ["README.txt", "src/Upper.ts", "src/parser.ts", "srcx/near.ts"],
      changed_paths_count: 4,
      outside_scopes: ["README.txt", "srcx/near.ts"],
      outside_scopes_count: 2,
    });
    expect(payload.changed_paths_truncated).toBeUndefined();
    expect(payload.changed_paths_reason).toBeUndefined();
    // No file content enters the journal.
    expect(JSON.stringify(j.events())).not.toContain("export const x");
    expect(j.store.completionChanges(a.workspace.id, claimed.id, done.completion_report_id!)).toEqual({
      changed_paths_basis: "server_observed",
      changed_paths: ["README.txt", "src/Upper.ts", "src/parser.ts", "srcx/near.ts"],
      changed_paths_count: 4,
      outside_scopes: ["README.txt", "srcx/near.ts"],
      outside_scopes_count: 2,
    });
  });

  test("a reported-only completion records them on task.completed", () => {
    const j = journal({ git: true });
    const a = j.start("alpha");
    const claimed = claimEdit(j, a, ["src/parser.ts"], "reported");
    j.write("src/parser.ts", "x\n");
    complete(j, a, claimed);
    const event = j.events().find((row) => row.type === "task.completed" && row.entity_id === claimed.id)!;
    expect(event.payload).toMatchObject({ changed_paths_basis: "server_observed", changed_paths: ["src/parser.ts"], outside_scopes: [] });
  });

  test("a root with no Git repository records why nothing was listed, and never refuses", () => {
    const j = journal();
    const a = j.start("alpha");
    const task = completedTask(j, a);
    expect(task.status).toBe("completed");
    expect(completionPayload(j, task.id)).toMatchObject({
      changed_paths_basis: "unavailable",
      changed_paths_reason: "The base checkpoint was not server-observed: no Git repository or no HEAD at the claim",
    });
    expect(completionPayload(j, task.id).changed_paths).toBeUndefined();
  });

  test("a base HEAD that left the repository is unavailable, and the completion stands", () => {
    const j = journal({ git: true });
    const a = j.start("alpha");
    const claimed = claimEdit(j, a, ["src"]);
    // Rewrite history so the claim's HEAD is no longer reachable, then prune it.
    git(j.root, ["checkout", "-q", "--orphan", "fresh"]);
    git(j.root, ["commit", "-q", "-m", "fresh root"]);
    const old = git(j.root, ["branch", "--format=%(refname:short)"]).split("\n").filter((name) => name !== "fresh");
    for (const name of old) git(j.root, ["branch", "-q", "-D", name]);
    git(j.root, ["reflog", "expire", "--expire=now", "--all"]);
    git(j.root, ["gc", "-q", "--prune=now"]);
    const done = complete(j, a, claimed);
    expect(done.status).toBe("completed");
    expect(completionPayload(j, claimed.id)).toMatchObject({
      changed_paths_basis: "unavailable",
      changed_paths_reason: "Git could not list the changes since the base checkpoint's HEAD: that commit is missing, or a bound was exceeded",
    });
  });

  test("a base that moves after the observation, or an observation that throws, records unavailable", () => {
    const j = journal({ git: true });
    const a = j.start("alpha");
    const inner = j.store as any;
    const observe = inner.observeCompletionChanges.bind(inner);
    const first = claimEdit(j, a, ["src/one.ts"], "reported", "one");
    inner.observeCompletionChanges = (...args: unknown[]) => ({ ...observe(...args), base_checkpoint_json: "{}" });
    expect(complete(j, a, first, "one").status).toBe("completed");
    expect(completionPayload(j, first.id)).toMatchObject({
      changed_paths_basis: "unavailable",
      changed_paths_reason: "The task's base checkpoint changed after the paths were observed",
    });
    delete inner.observeCompletionChanges;
    const second = claimEdit(j, a, ["src/two.ts"], "reported", "two");
    // More than one listing may hold: Git's output is bounded, and over it nothing is listed.
    mkdirSync(join(j.root, "many"));
    const name = "n".repeat(240);
    for (let index = 0; index < 4_500; index += 1) writeFileSync(join(j.root, "many", `${name}${index}`), "");
    expect(complete(j, a, second, "two").status).toBe("completed");
    expect(completionPayload(j, second.id)).toMatchObject({
      changed_paths_basis: "unavailable",
      changed_paths_reason: "Git could not list the untracked paths within its bounds",
    });
  });

  test("a base from another worktree is unavailable; a replayed completion returns the same record", async () => {
    const j = journal({ git: true });
    const a = j.start("alpha");
    const claimed = claimEdit(j, a, ["src/one.ts"], "reported", "one");
    const inner = j.store as any;
    const prepared = inner.captureSessionWorktree(a.credential);
    expect(inner.observeCompletionChanges(claimed.id, prepared).observation).toEqual({ ok: true, paths: [] });
    expect(inner.observeCompletionChanges(claimed.id, { ...prepared, worktree_id: "wt_other" }).observation)
      .toEqual({ ok: false, reason: "The base checkpoint belongs to another worktree" });
    complete(j, a, claimed, "one");
    const again = claimEdit(j, a, ["src/two.ts"], "reported", "two");
    j.write("src/two.ts", "2\n");
    const input = {
      workspace_id: a.workspace.id, idempotency_key: "replay", task_id: again.id, lease_id: again.lease_id,
      expected_version: again.version, summary: "Done.",
    };
    const server = j.serve(a);
    const { observed_at: _first, ...once } = await ok(server, "collab_task_complete", input);
    j.write("src/later.ts", "later\n");
    const { observed_at: _second, ...twice } = await ok(server, "collab_task_complete", input);
    expect(once.changed_paths).toEqual(["src/two.ts"]);
    expect(twice).toEqual(once);
  });

  test("many untracked files are capped in the record and the payload stays well under 64 KiB", () => {
    const j = journal({ git: true });
    const a = j.start("alpha");
    const claimed = claimEdit(j, a, ["kept"]);
    mkdirSync(join(j.root, "many"), { recursive: true });
    for (let index = 0; index < 400; index += 1) {
      writeFileSync(join(j.root, "many", `${"n".repeat(80)}-${index}.txt`), "x");
    }
    complete(j, a, claimed);
    const payload = completionPayload(j, claimed.id);
    expect(payload.changed_paths_count).toBe(400);
    expect(payload.outside_scopes_count).toBe(400);
    expect(payload.changed_paths_truncated).toBe(true);
    expect(payload.changed_paths.length).toBeLessThan(400);
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThan(48 * 1024);
  });

  test("collab_task_complete and collab_done return the recorded fields", async () => {
    const j = journal({ git: true });
    const a = j.start("alpha");
    const sa = j.serve(a);
    const claimed = claimEdit(j, a, ["src/parser.ts"]);
    j.write("src/parser.ts", "x\n");
    j.write("other.md", "y\n");
    const result = await ok(sa, "collab_task_complete", {
      workspace_id: a.workspace.id,
      idempotency_key: "mcp-complete",
      task_id: claimed.id,
      lease_id: claimed.lease_id,
      expected_version: claimed.version,
      summary: "Done.",
    });
    expect(result).toMatchObject({
      changed_paths_basis: "server_observed",
      changed_paths: ["other.md", "src/parser.ts"],
      outside_scopes: ["other.md"],
      outside_scopes_count: 1,
    });

    const taken = await ok(sa, "collab_take", { title: "Edit the lexer", paths: ["lib/lexer.ts"] });
    j.write("lib/lexer.ts", "z\n");
    const done = await ok(sa, "collab_done", { text: "Lexer done.", task: taken.ids.task });
    expect(done).toMatchObject({
      changed_paths_basis: "server_observed",
      outside_scopes: ["other.md", "src/parser.ts"],
      outside_scopes_count: 2,
    });
    expect(done.changed_paths).toEqual(["lib/lexer.ts", "other.md", "src/parser.ts"]);
    const line = (done.advice as string[]).find((text) => text.includes("outside this task's path scopes"))!;
    expect(line).toContain('"other.md", "src/parser.ts"');
    expect(line).toContain("recorded for the reviewer, not refused");
  });
});

describe("reviews record the reviewer's relation to the reporter", () => {
  function reviewOnce(j: Journal, reporter: SessionHandle, reviewer: SessionHandle, key: string, outcome: "accept" | "request_changes" = "accept") {
    const task = completedTask(j, reporter, { key, paths: [`src/${key}.ts`] });
    const reviewed = j.store.reviewTaskForSession({
      ...reviewer.credential,
      idempotency_key: `${key}-review`,
      task_id: task.id,
      expected_version: task.version,
      outcome,
      summary: "Reviewed.",
    });
    const event = j.events().filter((row) => row.entity_id === task.id
      && (row.type === "task.accepted" || row.type === "task.changes_requested")).at(-1)!;
    return { reviewed, payload: event.payload };
  }

  test("each relation is recorded on the review event and result, and none refuses", () => {
    const j = journal();
    const parent = j.start("parent");
    const attested = j.start("parent/attested", { parent_session_id: parent.session.id, parent_attested: true });
    const declared = j.start("parent/declared", { parent_session_id: parent.session.id });
    const sibling = j.start("parent/sibling", { parent_session_id: parent.session.id });
    const stranger = j.start("stranger");
    const cases: Array<[SessionHandle, SessionHandle, string]> = [
      [parent, attested, "same_voice"],
      [attested, parent, "same_voice"],
      [declared, parent, "declared_parent"],
      [parent, declared, "declared_child"],
      [declared, sibling, "declared_sibling"],
      [parent, stranger, "unrelated_as_declared"],
    ];
    cases.forEach(([reporter, reviewer, relation], index) => {
      const { reviewed, payload } = reviewOnce(j, reporter, reviewer, `k${index}`);
      expect(reviewed.review.outcome).toBe("accepted");
      expect(reviewed.reviewer_relation).toBe(relation as any);
      expect(payload.reviewer_relation).toBe(relation);
    });
    const changes = reviewOnce(j, parent, attested, "rc", "request_changes");
    expect(changes.payload.reviewer_relation).toBe("same_voice");
  });

  test("the advice says plainly what each relation does not prove", () => {
    expect(reviewerRelationAdvice("same_voice")).toContain("a same-voice review is not independent");
    expect(reviewerRelationAdvice("declared_parent")).toContain("not independent");
    expect(reviewerRelationAdvice("unrelated_as_declared")).toContain("not proof the review is independent");
  });

  test("collab_task_review and collab_note accept surface the relation", async () => {
    const j = journal();
    const parent = j.start("parent");
    const child = j.start("parent/child", { parent_session_id: parent.session.id, parent_attested: true });
    const stranger = j.start("stranger");
    const first = completedTask(j, parent, { key: "one", paths: ["src/one.ts"] });
    const viaTool = await ok(j.serve(stranger), "collab_task_review", {
      workspace_id: parent.workspace.id,
      idempotency_key: "tool-review",
      task_id: first.id,
      expected_version: first.version,
      outcome: "accept",
      summary: "Looks right.",
    });
    expect(viaTool.reviewer_relation).toBe("unrelated_as_declared");
    const second = completedTask(j, parent, { key: "two", paths: ["src/two.ts"] });
    const viaNote = await ok(j.serve(child), "collab_note", { act: "accept", text: "Holds.", re: second.completion_report_id });
    expect(viaNote.reviewer_relation).toBe("same_voice");
    expect(viaNote.advice).toContain(reviewerRelationAdvice("same_voice"));
  });
});
