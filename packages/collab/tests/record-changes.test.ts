import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SessionHandle, Task } from "../src/protocol.js";
import { captureRepoCheckpoint, observeChangedPaths, type RepositoryProbeOptions } from "../src/repository.js";
import {
  changedPathFields,
  MAX_RECORDED_OUTSIDE_PATHS,
  MAX_RECORDED_PATH_CHARS,
  pathWithinScopesFolded,
  recordedPathName,
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

/** Every changed-path field of a payload or a result, and the old list's name in case it comes back. */
function changeKeys(source: Record<string, any>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([key]) => /^(changed_paths|outside_scopes)/.test(key)));
}

/** The paths since `base` as a completion observes them: from the capture's own status, and Git only if asked. */
function observe(root: string, base: string, options: RepositoryProbeOptions = {}) {
  let status: Buffer | null = null;
  const checkpoint = captureRepoCheckpoint(root, "wt_test", (listed) => { status = listed; });
  return observeChangedPaths(root, base, checkpoint.head_sha!, status, options);
}

/** A process runner that records each call and then really runs it. */
function recorder() {
  const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];
  const spawn = (args: string[], options: SpawnSyncOptions) => {
    calls.push({ args, env: options.env! });
    return spawnSync("git", args, options);
  };
  return { calls, spawn };
}

describe("observeChangedPaths", () => {
  test("lists what the capture's status read and, once HEAD moved, what the commits changed; never ignored files", () => {
    const j = journal({ git: true });
    j.write("gone.txt", "gone\n");
    j.write("old name.txt", "a file long enough to be found as a rename\n");
    git(j.root, ["add", "gone.txt", "old name.txt"]);
    git(j.root, ["commit", "-q", "-m", "base"]);
    const base = git(j.root, ["rev-parse", "HEAD"]);
    j.write(".gitignore", "build/\n");
    j.write("src/brief.ts", "added since the base, and gone again uncommitted\n");
    j.write("src/undone.ts", "added and removed again by commits\n");
    git(j.root, ["add", ".gitignore", "src"]);
    git(j.root, ["commit", "-q", "-m", "after base"]);
    git(j.root, ["rm", "-q", "src/undone.ts"]);
    git(j.root, ["commit", "-q", "-m", "undo"]);
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
    // Committed since the base, unstaged, deleted, nested, both sides of a
    // rename, untracked, staged; sorted. A commit undone by a commit is no change.
    expect(observe(j.root, base)).toEqual({
      ok: true,
      paths: [
        ".gitignore", "README.txt", "gone.txt", "nested/", "new name.txt", "notes/new file.md", "old name.txt", "src/brief.ts", "src/staged.ts",
      ],
    });
  });

  test("runs no Git of its own while HEAD is the base, and one names-only diff, without locks or fetches, once it moved", () => {
    const j = journal({ git: true });
    const base = git(j.root, ["rev-parse", "HEAD"]);
    j.write("README.txt", "changed\n");
    const still = recorder();
    expect(observe(j.root, base, { spawn: still.spawn })).toEqual({ ok: true, paths: ["README.txt"] });
    expect(still.calls).toEqual([]);
    git(j.root, ["commit", "-q", "-a", "-m", "moved"]);
    const head = git(j.root, ["rev-parse", "HEAD"]);
    const moved = recorder();
    expect(observe(j.root, base, { spawn: moved.spawn })).toEqual({ ok: true, paths: ["README.txt"] });
    expect(moved.calls).toHaveLength(1);
    expect(moved.calls[0]!.args).toEqual([
      "-C", j.root, "diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--ignore-submodules=none",
      "--name-only", "-z", `${base}..${head}`, "--",
    ]);
    expect(moved.calls[0]!.env).toMatchObject({ GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1" });
  });

  test("reads a rename as both its paths, a copy as its new path, and refuses a status it does not know", () => {
    const sha = "a".repeat(40);
    const paths = (status: string) => observeChangedPaths("/nowhere", sha, sha, Buffer.from(status));
    expect(paths("R  new\0old\0 R wnew\0wold\0C  copy\0source\0UU both\0 M x -> y\0?? un\0"))
      .toEqual({ ok: true, paths: ["both", "copy", "new", "old", "un", "wnew", "wold", "x -> y"] });
    expect(paths("")).toEqual({ ok: true, paths: [] });
    const unreadable = { ok: false, reason: "Git reported a changed path that cannot be read safely" } as const;
    for (const status of ["## main\0", "!! ignored\0", "R  new\0", "M\0", " M ../up\0", " M /abs\0", " M cut"]) {
      expect(paths(status)).toEqual(unreadable);
    }
  });

  test("a base that is not a commit here, or a status Git could not give, is unavailable with a reason", () => {
    const j = journal({ git: true });
    expect(observe(j.root, "0".repeat(40))).toEqual({
      ok: false,
      reason: "Git could not list the changes since the base checkpoint's HEAD: that commit is missing, or a bound was exceeded",
    });
    expect(observe(j.root, "HEAD")).toEqual({
      ok: false,
      reason: "The base checkpoint's HEAD or the current HEAD is not a Git object ID",
    });
    const sha = "a".repeat(40);
    expect(observeChangedPaths(j.root, sha, sha, null)).toEqual({
      ok: false,
      reason: "Git could not list the worktree's status within its bounds",
    });
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
    expect(pathWithinScopesFolded("résumé/x", ["résumé"])).toBe(true);
  });

  test("only counts and the first names outside the scopes are kept, with a flag when that leaves any out", () => {
    const many = Array.from({ length: MAX_RECORDED_OUTSIDE_PATHS + 5 }, (_, index) => `x/${String(index).padStart(4, "0")}`);
    expect(changedPathFields({ ok: true, paths: many }, ["x/0000"])).toEqual({
      changed_paths_basis: "server_observed",
      changed_paths_count: MAX_RECORDED_OUTSIDE_PATHS + 5,
      outside_scopes: many.slice(1, MAX_RECORDED_OUTSIDE_PATHS + 1),
      outside_scopes_count: MAX_RECORDED_OUTSIDE_PATHS + 4,
      outside_scopes_truncated: true,
    });
    const exact = changedPathFields({ ok: true, paths: many.slice(0, MAX_RECORDED_OUTSIDE_PATHS) }, ["y"]);
    expect(exact.outside_scopes).toHaveLength(MAX_RECORDED_OUTSIDE_PATHS);
    expect(exact.outside_scopes_truncated).toBeUndefined();
    const long = changedPathFields({ ok: true, paths: ["n".repeat(MAX_RECORDED_PATH_CHARS + 1)] }, ["y"]);
    expect(long.outside_scopes).toEqual([`${"n".repeat(MAX_RECORDED_PATH_CHARS - 1)}…`]);
    expect(long).toMatchObject({ outside_scopes_count: 1, outside_scopes_truncated: true });
    // The widest names there are still leave the payload far under 64 KiB.
    const wide = Array.from({ length: 400 }, (_, index) => `${index}${"\u{1F600}".repeat(500)}`);
    expect(Buffer.byteLength(JSON.stringify(changedPathFields({ ok: true, paths: wide }, ["y"])))).toBeLessThan(18 * 1024);
    expect(changedPathFields({ ok: true, paths: ["a"] }, ["a"])).toEqual({
      changed_paths_basis: "server_observed",
      changed_paths_count: 1,
      outside_scopes: [],
      outside_scopes_count: 0,
    });
    expect(changedPathFields({ ok: false, reason: "why" }, [])).toEqual({ changed_paths_basis: "unavailable", changed_paths_reason: "why" });
  });

  test("without path scopes nothing is inside or outside, so only the count is kept", () => {
    expect(changedPathFields({ ok: true, paths: ["a", "b"] }, [])).toEqual({
      changed_paths_basis: "server_observed",
      changed_paths_count: 2,
    });
  });

  test("a name's control, bidirectional, zero-width and invisible characters are escaped, and a cut never splits one", () => {
    expect(recordedPathName("plain/ünï/文 (1).ts")).toEqual({ name: "plain/ünï/文 (1).ts", cut: false });
    const hostile = "a\u0000\u0007\n\t\u007f\u0085­؜​‍‮  ⁦﻿️\u{e0041}b";
    expect(recordedPathName(hostile)).toEqual({
      name: "a\\u{0}\\u{7}\\u{A}\\u{9}\\u{7F}\\u{85}\\u{AD}\\u{61C}\\u{200B}\\u{200D}\\u{202E}\\u{2028}\\u{2029}\\u{2066}\\u{FEFF}\\u{FE0F}\\u{E0041}b",
      cut: false,
    });
    // At the bound exactly, nothing is cut; one escape over it, the escape goes whole.
    const bound = "n".repeat(MAX_RECORDED_PATH_CHARS - 8);
    expect(recordedPathName(`${bound}‮`)).toEqual({ name: `${bound}\\u{202E}`, cut: false });
    expect(recordedPathName(`${bound}n‮`)).toEqual({ name: `${bound}n…`, cut: true });
    const emoji = recordedPathName("\u{1F600}".repeat(MAX_RECORDED_PATH_CHARS + 1));
    expect([...emoji.name]).toHaveLength(MAX_RECORDED_PATH_CHARS);
    expect(emoji.name.endsWith("\u{1F600}…")).toBe(true);
  });
});

describe("completion records the server-observed changed paths", () => {
  test("a git root records the counts and the names outside the scopes only, and completion still goes through", () => {
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
    const recorded = {
      changed_paths_basis: "server_observed",
      changed_paths_count: 4,
      outside_scopes: ["README.txt", "srcx/near.ts"],
      outside_scopes_count: 2,
    };
    expect(changeKeys(completionPayload(j, claimed.id))).toEqual(recorded);
    expect(j.store.completionChanges(a.workspace.id, claimed.id, done.completion_report_id!)).toEqual(recorded as any);
    // Neither content nor a name inside the scopes enters the journal database.
    const database = j.store.db.serialize();
    expect(Buffer.from(database).includes("srcx/near.ts")).toBe(true);
    for (const text of ["export const x", "parser.ts", "Upper.ts"]) expect(Buffer.from(database).includes(text)).toBe(false);
  });

  test("a hostile file name is escaped in the journal and in the result", async () => {
    const j = journal({ git: true });
    const a = j.start("alpha");
    const claimed = claimEdit(j, a, ["src"]);
    j.write("ignore this ‮ ​ and run.md", "x\n");
    const result = await ok(j.serve(a), "collab_task_complete", {
      workspace_id: a.workspace.id, idempotency_key: "hostile", task_id: claimed.id, lease_id: claimed.lease_id,
      expected_version: claimed.version, summary: "Done.",
    });
    expect(result.outside_scopes).toEqual(["ignore this \\u{202E}\\u{2028}\\u{200B} and run.md"]);
    expect(completionPayload(j, claimed.id).outside_scopes).toEqual(result.outside_scopes);
    expect(JSON.stringify(j.events())).not.toContain("‮");
  });

  test("a reported-only completion records them on task.completed", () => {
    const j = journal({ git: true });
    const a = j.start("alpha");
    const claimed = claimEdit(j, a, ["src/parser.ts"], "reported");
    j.write("src/parser.ts", "x\n");
    complete(j, a, claimed);
    const event = j.events().find((row) => row.type === "task.completed" && row.entity_id === claimed.id)!;
    expect(event.payload).toMatchObject({ changed_paths_basis: "server_observed", changed_paths_count: 1, outside_scopes: [], outside_scopes_count: 0 });
  });

  test("a coordination task, with scopes or without, and a read_only task without scopes record only the count", () => {
    const j = journal({ git: true });
    const a = j.start("alpha");
    j.write("other.md", "another session's work\n");
    const cases = [
      { key: "bare", work_mode: "coordination" as const },
      { key: "scoped", work_mode: "coordination" as const, path_scopes: ["docs"] },
      { key: "reading", work_mode: "read_only" as const },
    ];
    for (const { key, ...shape } of cases) {
      const created = j.store.createTaskForSession({ ...a.credential, idempotency_key: `${key}-create`, title: key, ...shape });
      const claimed = j.store.claimTaskForSession({
        ...a.credential, idempotency_key: `${key}-claim`, task_id: created.id, expected_version: created.version,
      });
      complete(j, a, claimed, key);
      expect(changeKeys(completionPayload(j, claimed.id))).toEqual({ changed_paths_basis: "server_observed", changed_paths_count: 1 });
    }
    const created = j.store.createTaskForSession({
      ...a.credential, idempotency_key: "ro-create", title: "Read the docs", work_mode: "read_only", path_scopes: ["docs"],
    });
    const claimed = j.store.claimTaskForSession({
      ...a.credential, idempotency_key: "ro-claim", task_id: created.id, expected_version: created.version,
    });
    complete(j, a, claimed, "ro");
    expect(changeKeys(completionPayload(j, claimed.id))).toMatchObject({ outside_scopes: ["other.md"], outside_scopes_count: 1 });
  });

  test("a root with no Git repository records why nothing was listed, and never refuses", () => {
    const j = journal();
    const a = j.start("alpha");
    const task = completedTask(j, a);
    expect(task.status).toBe("completed");
    expect(changeKeys(completionPayload(j, task.id))).toEqual({
      changed_paths_basis: "unavailable",
      changed_paths_reason: "The base checkpoint was not server-observed: no Git repository or no HEAD at the claim",
    });
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
    expect(changeKeys(completionPayload(j, claimed.id))).toEqual({
      changed_paths_basis: "unavailable",
      changed_paths_reason: "Git could not list the changes since the base checkpoint's HEAD: that commit is missing, or a bound was exceeded",
    });
  });

  test("a worktree with no HEAD at completion is unavailable, and the completion stands", () => {
    const j = journal({ git: true });
    const a = j.start("alpha");
    const claimed = claimEdit(j, a, ["src"]);
    git(j.root, ["checkout", "-q", "--orphan", "unborn"]);
    expect(complete(j, a, claimed).status).toBe("completed");
    expect(changeKeys(completionPayload(j, claimed.id))).toEqual({
      changed_paths_basis: "unavailable",
      changed_paths_reason: "The worktree has no Git HEAD now",
    });
  });

  test("a pull, a rebase or a branch switch since the claim counts every path it changed", () => {
    const j = journal({ git: true });
    const a = j.start("alpha");
    git(j.root, ["checkout", "-q", "-b", "upstream"]);
    j.write("upstream.md", "theirs\n");
    git(j.root, ["add", "upstream.md"]);
    git(j.root, ["commit", "-q", "-m", "theirs"]);
    git(j.root, ["checkout", "-q", "-"]);
    const claimed = claimEdit(j, a, ["src"]);
    git(j.root, ["merge", "-q", "--ff-only", "upstream"]);
    complete(j, a, claimed);
    expect(changeKeys(completionPayload(j, claimed.id))).toMatchObject({ changed_paths_count: 1, outside_scopes: ["upstream.md"] });
  });

  test("a base that moves after the observation records unavailable, and the completion stands", () => {
    const j = journal({ git: true });
    const a = j.start("alpha");
    const inner = j.store as any;
    const observing = inner.observeCompletionChanges.bind(inner);
    const claimed = claimEdit(j, a, ["src/one.ts"], "reported");
    inner.observeCompletionChanges = (...args: unknown[]) => ({ ...observing(...args), base_checkpoint_json: "{}" });
    expect(complete(j, a, claimed).status).toBe("completed");
    expect(changeKeys(completionPayload(j, claimed.id))).toEqual({
      changed_paths_basis: "unavailable",
      changed_paths_reason: "The task's base checkpoint changed after the paths were observed",
    });
  });

  test("an observation that throws records unavailable, and the completion stands", () => {
    const j = journal({ git: true });
    const a = j.start("alpha");
    const inner = j.store as any;
    const capture = inner.captureSessionWorktree.bind(inner);
    const claimed = claimEdit(j, a, ["src/one.ts"], "reported");
    let thrown = 0;
    inner.captureSessionWorktree = (input: unknown) => ({
      ...capture(input),
      get status(): Buffer {
        thrown += 1;
        throw new Error("the status cannot be read");
      },
    });
    expect(complete(j, a, claimed).status).toBe("completed");
    expect(thrown).toBe(1);
    expect(changeKeys(completionPayload(j, claimed.id))).toEqual({
      changed_paths_basis: "unavailable",
      changed_paths_reason: "The server could not observe the changed paths",
    });
  });

  test("a status past Git's output bound is unavailable, and the completion stands", () => {
    const j = journal({ git: true });
    const a = j.start("alpha");
    const claimed = claimEdit(j, a, ["src/two.ts"], "reported");
    mkdirSync(join(j.root, "many"));
    const name = "n".repeat(240);
    for (let index = 0; index < 4_500; index += 1) writeFileSync(join(j.root, "many", `${name}${index}`), "");
    expect(complete(j, a, claimed).status).toBe("completed");
    expect(changeKeys(completionPayload(j, claimed.id))).toEqual({
      changed_paths_basis: "unavailable",
      changed_paths_reason: "Git could not list the worktree's status within its bounds",
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
    j.write("aside.md", "2\n");
    const input = {
      workspace_id: a.workspace.id, idempotency_key: "replay", task_id: again.id, lease_id: again.lease_id,
      expected_version: again.version, summary: "Done.",
    };
    const server = j.serve(a);
    const { observed_at: _first, ...once } = await ok(server, "collab_task_complete", input);
    j.write("later.md", "later\n");
    const { observed_at: _second, ...twice } = await ok(server, "collab_task_complete", input);
    expect(once.outside_scopes).toEqual(["aside.md"]);
    expect(twice).toEqual(once);
  });

  test("a report that is not the completion's has no changes of its own", () => {
    const j = journal({ git: true });
    const a = j.start("alpha");
    const claimed = claimEdit(j, a, ["src"]);
    const aside = j.store.appendReportForSession({
      ...a.credential, idempotency_key: "aside", task_id: claimed.id, kind: "observation", body: "Half way.", relation: "informs",
    });
    const done = complete(j, a, claimed);
    // The next completion event after this report is the task's, but it names another report.
    expect(j.store.completionChanges(a.workspace.id, claimed.id, aside.id)).toBeNull();
    expect(j.store.completionChanges(a.workspace.id, claimed.id, "report_none")).toBeNull();
    expect(j.store.completionChanges(a.workspace.id, claimed.id, done.completion_report_id!)).not.toBeNull();
  });

  test("collab_task_complete and collab_done return the recorded fields, and say nothing of them in advice", async () => {
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
    expect(changeKeys(result)).toEqual({
      changed_paths_basis: "server_observed",
      changed_paths_count: 2,
      outside_scopes: ["other.md"],
      outside_scopes_count: 1,
    });

    const taken = await ok(sa, "collab_take", { title: "Edit the lexer", paths: ["lib/lexer.ts"] });
    j.write("lib/lexer.ts", "z\n");
    const done = await ok(sa, "collab_done", { text: "Lexer done.", task: taken.ids.task });
    expect(changeKeys(done)).toEqual({
      changed_paths_basis: "server_observed",
      changed_paths_count: 3,
      outside_scopes: ["other.md", "src/parser.ts"],
      outside_scopes_count: 2,
    });
    expect(JSON.stringify(done.advice)).not.toContain("other.md");

    // A title-only take has no path scopes, however many files lie about.
    const scopeless = await ok(sa, "collab_take", { title: "Sort the notes" });
    const sorted = await ok(sa, "collab_done", { text: "Sorted.", task: scopeless.ids.task });
    expect(changeKeys(sorted)).toEqual({ changed_paths_basis: "server_observed", changed_paths_count: 3 });
  });
});

describe("the record covers only the time since the latest claim, takeover or handoff", () => {
  /** Round 1: a committed edit outside the scope, recorded at that completion. */
  function outOfScopeRound(j: Journal, holder: SessionHandle, claimed: Task, key: string) {
    j.write("secret/outside.ts", `${key}\n`);
    git(j.root, ["add", "secret/outside.ts"]);
    git(j.root, ["commit", "-q", "-m", key]);
    return claimed;
  }

  test("a re-claim after request_changes starts over, and the earlier completion keeps its own record", async () => {
    const j = journal({ git: true });
    const a = j.start("alpha");
    const b = j.start("beta");
    const first = complete(j, a, outOfScopeRound(j, a, claimEdit(j, a, ["src/a.ts"], "accepted", "one"), "round one"), "one");
    const returned = j.store.reviewTaskForSession({
      ...b.credential, idempotency_key: "rc", task_id: first.id, expected_version: first.version, outcome: "request_changes", summary: "Again.",
    }).task;
    const again = j.store.claimTaskForSession({ ...a.credential, idempotency_key: "again", task_id: returned.id, expected_version: returned.version });
    j.write("src/a.ts", "round two\n");
    const second = complete(j, a, again, "two");
    const recorded = j.events().filter((event) => event.type === "task.reported_complete").map((event) => changeKeys(event.payload));
    expect(recorded).toEqual([
      { changed_paths_basis: "server_observed", changed_paths_count: 1, outside_scopes: ["secret/outside.ts"], outside_scopes_count: 1 },
      // The out-of-scope commit still stands, and this round does not say so.
      { changed_paths_basis: "server_observed", changed_paths_count: 1, outside_scopes: [], outside_scopes_count: 0 },
    ]);
    // A notes-profile reviewer finds the earlier round in the task's thread.
    const thread = await ok(j.serve(b), "collab_inbox", { about: second.id });
    expect(thread.task.completion.changes).toEqual(recorded[1]);
    const shown = thread.thread.filter((item: any) => item.changes);
    expect(shown.map((item: any) => [item.id, item.changes])).toEqual([
      [first.completion_report_id, recorded[0]],
      [second.completion_report_id, recorded[1]],
    ]);
  });

  test("a takeover starts over", () => {
    const j = journal({ git: true });
    const a = j.start("alpha");
    const claimed = outOfScopeRound(j, a, claimEdit(j, a, ["src/a.ts"]), "before the takeover");
    j.advance(7 * 60 * 60_000);
    const b = j.start("beta");
    const recovered = j.store.recoverTaskForSession({
      ...b.credential, idempotency_key: "recover", task_id: claimed.id, expected_version: claimed.version, recovery_note: "Checked the worktree.",
    });
    complete(j, b, recovered, "taken");
    expect(changeKeys(completionPayload(j, claimed.id))).toMatchObject({ changed_paths_count: 0, outside_scopes: [] });
  });

  test("an accepted handoff starts over", () => {
    const j = journal({ git: true });
    const a = j.start("alpha");
    const b = j.start("beta");
    const claimed = outOfScopeRound(j, a, claimEdit(j, a, ["src/a.ts"]), "before the handoff");
    const offered = j.store.offerHandoffForSession({
      ...a.credential, idempotency_key: "offer", task_id: claimed.id, lease_id: claimed.lease_id!, expected_version: claimed.version,
      to_session_id: b.session.id, summary: "Yours if you like.",
    });
    const taken = j.store.respondHandoffForSession({
      ...b.credential, idempotency_key: "answer", handoff_id: offered.handoff.id, expected_version: offered.task.version, response: "accept",
    });
    complete(j, b, taken.task, "handed");
    expect(changeKeys(completionPayload(j, claimed.id))).toMatchObject({ changed_paths_count: 0, outside_scopes: [] });
  });
});

describe("where a reviewer reads the record", () => {
  test("the completion event, its inbox item, and the thread of the task or of the completion", async () => {
    const j = journal({ git: true });
    const a = j.start("alpha");
    const b = j.start("beta");
    const claimed = claimEdit(j, a, ["src"]);
    j.write("other.md", "y\n");
    const done = j.store.completeTaskForSession({
      ...a.credential, idempotency_key: "asked", task_id: claimed.id, lease_id: claimed.lease_id!, expected_version: claimed.version,
      summary: "Done.", review_requested_session_id: b.session.id,
    });
    const changes = { changed_paths_basis: "server_observed", changed_paths_count: 1, outside_scopes: ["other.md"], outside_scopes_count: 1 };
    const server = j.serve(b);
    const page = await ok(server, "collab_events_since", { workspace_id: a.workspace.id });
    const event = page.events.find((row: any) => row.type === "task.reported_complete");
    expect(event.payload).toMatchObject(changes);
    const inbox = await ok(server, "collab_inbox", {});
    const item = inbox.items.find((entry: any) => entry.act === "done");
    expect(item.completion.id).toBe(done.completion_report_id);
    expect(item.changes).toEqual(changes);
    const task = await ok(server, "collab_inbox", { about: done.id });
    expect(task.task.completion.changes).toEqual(changes);
    const completion = await ok(server, "collab_inbox", { about: done.completion_report_id });
    expect(completion.root.changes).toEqual(changes);
    // Only a completion has them.
    const other = task.thread.filter((entry: any) => entry.id !== done.completion_report_id);
    expect(other.length).toBeGreaterThan(0);
    expect(other.every((entry: any) => entry.changes === undefined)).toBe(true);
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
