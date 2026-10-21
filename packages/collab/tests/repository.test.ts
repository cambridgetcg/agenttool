import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { canonicalRepositoryRemote, inspectRepository, portableRepositoryKey, RepositoryProbeTimeout, type RepositoryProbeOptions } from "../src/repository.js";
import { CollabError } from "../src/errors.js";
import { CollabStore, type CollabStoreOptions } from "../src/store.js";

let directory: string;
let root: string;
let store: CollabStore;
function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } });
  if (result.status !== 0) throw new Error(`fixture git ${args[0]}: ${result.stderr}`);
  return result.stdout.trim();
}
function remote(path: string, url = "https://example.invalid/owner/repo.git") {
  git(path, "config", "remote.origin.url", url);
}
function clone(name: string, url?: string) {
  const path = join(directory, name);
  git(directory, "clone", "--local", root, path);
  remote(path, url);
  return path;
}
function code(fn: () => unknown) {
  try { fn(); return "no_error"; } catch (e) { if (!(e instanceof CollabError)) throw e; return e.code; }
}
function fixtureDb<T>(fn: (db: Database) => T): T {
  const db = new Database(join(directory, "collab.sqlite"));
  try { return fn(db); } finally { db.close(); }
}
function preUpgrade() {
  // Model schema-3 registrations made before portable discovery was installed.
  fixtureDb(db => db.exec("DELETE FROM repository_discovery"));
}
function reopen(discovery: CollabStoreOptions["repository_discovery"] = { budget_ms: 250, now: () => 0 }) {
  store.close();
  store = new CollabStore(join(directory, "collab.sqlite"), { repository_discovery: discovery });
}
function outcome(path: string) {
  return fixtureDb(db => db.query(`SELECT d.outcome FROM repository_discovery d
    JOIN worktrees w ON w.id = d.worktree_id WHERE w.root_path = ?`).get(path));
}
function alias(path: string) {
  return fixtureDb(db => db.query(`SELECT a.portable_key FROM repository_aliases a
    JOIN worktrees w ON w.id = a.worktree_id WHERE w.root_path = ?`).get(path));
}
// Only discovery's clock advances, by explicit cost per command. Successful
// replies still come from real local Git; a simulated cutoff returns ETIMEDOUT.
function discoveryClock(cost: (args: string[]) => number, budget_ms = 250) {
  let elapsed = 0;
  const calls: string[][] = [];
  const spawn: NonNullable<RepositoryProbeOptions["spawn"]> = (args, options) => {
    calls.push(args);
    const duration = cost(args);
    const allowance = options.timeout!;
    elapsed += Math.min(duration, allowance);
    if (duration > allowance) return {
      pid: 0, status: null, signal: "SIGTERM", output: [], stdout: "", stderr: "",
      error: Object.assign(new Error("injected discovery timeout"), { code: "ETIMEDOUT" }),
    };
    // The virtual clock, not host/process startup speed, owns this deadline.
    return spawnSync("git", args, { ...options, timeout: 5000 });
  };
  return { budget_ms, now: () => elapsed, spawn, calls };
}
beforeEach(() => {
  // Worktrees are stored by real path; root_path lookups must match under a symlinked TMPDIR (macOS /var, /tmp).
  directory = realpathSync(mkdtempSync(join(tmpdir(), "collab-repository-")));
  root = join(directory, "repo");
  mkdirSync(root);
  git(root, "init", "--initial-branch=main");
  git(root, "config", "user.name", "Fixture");
  git(root, "config", "user.email", "fixture@example.invalid");
  writeFileSync(join(root, "file.txt"), "fixture\n");
  git(root, "add", "file.txt");
  git(root, "commit", "-m", "root");
  store = new CollabStore(join(directory, "collab.sqlite"), {
    repository_discovery: { budget_ms: 250, now: () => 0 },
  });
});
afterEach(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });

describe("portable repository routing", () => {
  test("canonicalizes equivalent transports without credentials, preserving path and nondefault ports", () => {
    for (const value of ["https://example.invalid/owner/repo.git", "git@example.invalid:owner/repo.git", "ssh://git@example.invalid/owner/repo", "https://user:private@example.invalid/owner/repo.git/"]) {
      expect(canonicalRepositoryRemote(value)).toBe("example.invalid/owner/repo");
    }
    expect(canonicalRepositoryRemote("ssh://example.invalid:2222/owner/repo")).toBe("example.invalid:2222/owner/repo");
    expect(canonicalRepositoryRemote("HTTPS://GitHub.COM/Owner/Repo.GIT")).toBe("github.com/owner/repo");
    expect(canonicalRepositoryRemote("git@Example.INVALID:OWNER/REPO.git")).toBe("example.invalid/owner/repo");
    for (const value of ["/local/path", "file:///local/path", "ext::command", "https://x/repo?token=private", "git@host:a/../b", "https://x/a%2fb", "one\ntwo"]) {
      expect(canonicalRepositoryRemote(value)).toBeNull();
    }
  });

  test("clones and worktrees share one journal and conflict scope but keep physical identities", () => {
    remote(root);
    const other = clone("clone", "git@example.invalid:owner/repo.git");
    const linked = join(directory, "linked");
    git(root, "worktree", "add", "-b", "linked", linked);
    const first = store.startSession({ root_path: root, actor: "first" });
    const second = store.startSession({ root_path: other, actor: "second" });
    const third = store.startSession({ root_path: linked, actor: "third" });
    expect(second.workspace.id).toBe(first.workspace.id);
    expect(third.workspace.id).toBe(first.workspace.id);
    expect(second.worktree.id).not.toBe(first.worktree.id);
    expect(inspectRepository(root).repository_key).not.toBe(inspectRepository(other).repository_key);
    const firstTask = store.createTaskForSession({ ...first.credential, idempotency_key: "first-task", title: "first", path_scopes: ["src"], work_mode: "edit" });
    store.claimTaskForSession({ ...first.credential, idempotency_key: "claim", task_id: firstTask.id, expected_version: firstTask.version });
    const secondTask = store.createTaskForSession({ ...second.credential, idempotency_key: "second-task", title: "second", path_scopes: ["src/file.ts"], work_mode: "edit" });
    expect(code(() => store.claimTaskForSession({ ...second.credential, idempotency_key: "conflict", task_id: secondTask.id, expected_version: secondTask.version }))).toBe("path_scope_conflict");
    expect(store.verifyJournal(first.workspace.id)).toBe(true);
  });

  test("first upgraded open can be a new clone; old IDs, events and physical keys remain intact", () => {
    const legacy = store.openWorkspace({ root_path: root, actor: "old" });
    const before = store.eventsSince(legacy.id, 0, 500).events;
    const key = legacy.repository_key;
    // No alias before a remote existed models a pre-CF1 journal registration.
    remote(root);
    const other = clone("clone");
    preUpgrade();
    const upgraded = store.startSession({ root_path: other, actor: "new" });
    expect(upgraded.workspace.id).toBe(legacy.id);
    expect(upgraded.workspace.epoch_id).toBe(legacy.epoch_id);
    expect(upgraded.workspace.repository_key).toBe(key);
    expect(store.eventsSince(legacy.id, 0, 500).events.slice(0, before.length)).toEqual(before);
    expect(store.openWorkspace({ root_path: root, actor: "old" }).id).toBe(legacy.id);
    expect(store.verifyJournal(legacy.id)).toBe(true);
    reopen();
    expect(store.startSession({ root_path: other, actor: "reopened" }).workspace.id).toBe(legacy.id);
  });

  test("preserves pre-existing clone partitions instead of merging hash chains", () => {
    const other = clone("clone");
    git(other, "config", "--unset", "remote.origin.url");
    const a = store.openWorkspace({ root_path: root, actor: "a" });
    const b = store.openWorkspace({ root_path: other, actor: "b" });
    expect(a.id).not.toBe(b.id);
    const eventsA = store.eventsSince(a.id).events;
    const eventsB = store.eventsSince(b.id).events;
    remote(root);
    remote(other);
    preUpgrade();
    const third = clone("third");
    const c = store.startSession({ root_path: third, actor: "third" });
    expect([a.id, b.id]).not.toContain(c.workspace.id);
    expect(store.eventsSince(a.id).events).toEqual(eventsA);
    expect(store.eventsSince(b.id).events).toEqual(eventsB);
    expect(store.startSession({ root_path: root, actor: "upgraded-a" }).workspace.id).toBe(a.id);
    expect(store.startSession({ root_path: other, actor: "upgraded-b" }).workspace.id).toBe(b.id);
    expect(store.eventsSince(a.id).events.slice(0, eventsA.length)).toEqual(eventsA);
    expect(store.eventsSince(b.id).events.slice(0, eventsB.length)).toEqual(eventsB);
    expect(store.verifyJournal(a.id)).toBe(true);
    expect(store.verifyJournal(b.id)).toBe(true);
    expect(store.startSession({ root_path: third, actor: "third-again" }).workspace.id).toBe(c.workspace.id);
    const linked = join(directory, "linked");
    git(root, "worktree", "add", "-b", "linked", linked);
    expect(store.startSession({ root_path: linked, actor: "linked" }).workspace.id).toBe(a.id);
  });

  test("different remotes and explicit overrides stay separate; changed aliases retain routing", () => {
    remote(root);
    const other = clone("fork", "https://example.invalid/fork/repo.git");
    const a = store.openWorkspace({ root_path: root, actor: "a" });
    const b = store.openWorkspace({ root_path: other, actor: "b" });
    expect(a.id).not.toBe(b.id);
    const explicit = clone("explicit");
    expect(store.openWorkspace({ root_path: explicit, actor: "explicit", repository_key: "separate" }).id).not.toBe(a.id);
    remote(root, "https://example.invalid/moved/repo.git");
    expect(store.startSession({ root_path: root, actor: "a" }).workspace.id).toBe(a.id);
    git(root, "config", "--unset", "remote.origin.url");
    expect(store.startSession({ root_path: root, actor: "a-again" }).workspace.id).toBe(a.id);
    const oldRemoteClone = clone("old-remote");
    expect(store.startSession({ root_path: oldRemoteClone, actor: "old-remote" }).workspace.id).toBe(a.id);
  });

  test("adding origin to a github-only registration and merging unrelated history never locks it out", () => {
    git(root, "config", "remote.github.url", "https://example.invalid/owner/repo.git");
    const first = store.startSession({ root_path: root, actor: "first" });
    remote(root, "https://example.invalid/moved/repo.git");
    expect(store.startSession({ root_path: root, actor: "origin-added" }).workspace.id).toBe(first.workspace.id);
    git(root, "checkout", "--orphan", "unrelated");
    git(root, "commit", "-m", "unrelated");
    git(root, "merge", "--allow-unrelated-histories", "-s", "ours", "main", "-m", "two roots");
    expect(store.startSession({ root_path: root, actor: "multiple-roots" }).workspace.id).toBe(first.workspace.id);
  });

  test("discovery remembers unresolvable fingerprints and has no 256-worktree refusal", () => {
    const first = store.openWorkspace({ root_path: root, actor: "local" });
    const noRemote = clone("no-remote");
    git(noRemote, "config", "--unset", "remote.origin.url");
    store.openWorkspace({ root_path: noRemote, actor: "no-remote" });
    preUpgrade();
    fixtureDb(db => {
      const insert = db.query(`INSERT INTO worktrees
        (id, workspace_id, root_path, repository_key, git_common_dir_hash, fingerprint, branch, head_sha, dirty, registered_at, last_seen_at)
        SELECT ?, workspace_id, ?, repository_key, git_common_dir_hash, ?, branch, head_sha, dirty, registered_at, last_seen_at
        FROM worktrees WHERE root_path = ?`);
      for (let i = 0; i < 300; i++) insert.run(`missing-${i}`, join(directory, `gone-${i}`), `missing-${i}`, root);
    });
    remote(root);
    // Existing roots skip the historical survey, even when the backlog is huge.
    expect(store.startSession({ root_path: root, actor: "existing" }).workspace.id).toBe(first.id);
    for (let i = 0; i < 5; i++) store.startSession({ root_path: clone(`new-${i}`), actor: "new" });
    const checked = fixtureDb(db => db.query("SELECT COUNT(*) AS n FROM repository_discovery").get()) as { n: number };
    expect(checked.n).toBeGreaterThan(300);
    const unresolved = fixtureDb(db => db.query("SELECT COUNT(*) AS n FROM repository_discovery WHERE outcome = 'unresolvable'").get()) as { n: number };
    expect(unresolved.n).toBe(301);
    const trace = join(directory, "trace.log");
    const oldTrace = process.env.GIT_TRACE;
    process.env.GIT_TRACE = trace;
    try {
      store.startSession({ root_path: root, actor: "repeat" });
      store.startSession({ root_path: noRemote, actor: "repeat" });
    } finally {
      if (oldTrace === undefined) delete process.env.GIT_TRACE; else process.env.GIT_TRACE = oldTrace;
    }
    expect(readFileSync(trace, "utf8")).not.toContain("rev-list");
    // A changed stored fingerprint gets exactly one new discovery attempt.
    fixtureDb(db => db.query("UPDATE worktrees SET fingerprint = 'changed' WHERE id = 'missing-0'").run());
    store.startSession({ root_path: clone("after-change"), actor: "new" });
    expect(fixtureDb(db => db.query("SELECT fingerprint FROM repository_discovery WHERE worktree_id = 'missing-0'").get())).toEqual({ fingerprint: "changed" });
  });

  test("an exhausted discovery deadline performs no Git history walk", () => {
    remote(root);
    let calls = 0;
    expect(() => portableRepositoryKey(root, {
      deadline: 10, now: () => 10,
      spawn: () => { calls++; throw new Error("must not spawn"); },
    })).toThrow(RepositoryProbeTimeout);
    expect(calls).toBe(0);
  });

  test("a full-slice historical timeout is cached; an uninspected new clone stays pending", () => {
    remote(root);
    const first = store.openWorkspace({ root_path: root, actor: "first" });
    preUpgrade();
    const other = clone("budget-clone");
    const clock = discoveryClock(args => args[1] === root ? 5000 : 0);
    reopen(clock);
    const opened = store.startSession({ root_path: other, actor: "budget" });
    expect(opened.workspace.id).not.toBe(first.id);
    expect(clock.now()).toBe(250);
    expect(clock.calls.length).toBe(1);
    expect(outcome(root)).toEqual({ outcome: "unresolvable" });
    expect(outcome(other)).toBeNull();
    expect(alias(other)).toBeNull();
    store.startSession({ root_path: other, actor: "retry" });
    expect(outcome(other)).toEqual({ outcome: "checked" });
    expect(clock.calls.filter(args => args[1] === root).length).toBe(1);
    expect(store.startSession({ root_path: root, actor: "existing" }).workspace.id).toBe(first.id);
    expect(clock.calls.filter(args => args[1] === root).length).toBe(1);
  });

  test("an exhausted successorGit deadline does not start the history command", () => {
    remote(root);
    const clock = discoveryClock(() => 1, 2);
    expect(() => portableRepositoryKey(root, { ...clock, deadline: 2 })).toThrow(RepositoryProbeTimeout);
    expect(clock.calls.length).toBe(2);
    expect(clock.calls.some(args => args.includes("rev-list"))).toBe(false);
    expect(() => portableRepositoryKey(root, -1)).toThrow(RepositoryProbeTimeout);
  });

  test("partial-slice runGit timeouts leave historical rows pending, then retry with a full slice", () => {
    const other = clone("history");
    git(other, "config", "--unset", "remote.origin.url");
    const a = store.openWorkspace({ root_path: root, actor: "a" });
    const b = store.openWorkspace({ root_path: other, actor: "b" });
    remote(root); remote(other); preUpgrade();
    const rows = fixtureDb(db => db.query("SELECT root_path FROM worktrees ORDER BY id").all()) as { root_path: string }[];
    const firstPath = rows[0]!.root_path;
    const pendingPath = rows[1]!.root_path;
    const clock = discoveryClock(args => args[1] === firstPath ? 20 : 200);
    reopen(clock);
    const third = clone("third");
    const c = store.openWorkspace({ root_path: third, actor: "c" });
    expect([a.id, b.id]).not.toContain(c.id);
    expect(outcome(firstPath)).toEqual({ outcome: "checked" });
    expect(outcome(pendingPath)).toBeNull();
    expect(outcome(third)).toBeNull();
    expect(alias(third)).toBeNull();
    // A registered pending root gets its own full slice without surveying others.
    store.openWorkspace({ root_path: pendingPath, actor: "full-slice" });
    expect(outcome(pendingPath)).toEqual({ outcome: "unresolvable" });
    expect(outcome(third)).toBeNull();
    expect(store.verifyJournal(a.id)).toBe(true);
    expect(store.verifyJournal(b.id)).toBe(true);
  });

  test("partial-slice successorGit timeout on a new clone is not cached and retries successfully", () => {
    const legacy = store.openWorkspace({ root_path: root, actor: "old" });
    remote(root); preUpgrade();
    const other = clone("clone");
    const clock = discoveryClock(() => 30);
    reopen(clock);
    const opened = store.openWorkspace({ root_path: other, actor: "new" });
    expect(opened.id).not.toBe(legacy.id);
    expect(clock.now()).toBe(250);
    expect(clock.calls.at(-1)).toContain("rev-list");
    expect(outcome(root)).toEqual({ outcome: "checked" });
    expect(outcome(other)).toBeNull();
    expect(alias(other)).toBeNull();
    expect(store.openWorkspace({ root_path: other, actor: "retry" }).id).toBe(opened.id);
    expect(outcome(other)).toEqual({ outcome: "checked" });
    expect(alias(other)).toEqual(alias(root));
  });

  test("partial-slice historical successorGit timeout stays pending and can later resolve", () => {
    const other = clone("history");
    git(other, "config", "--unset", "remote.origin.url");
    store.openWorkspace({ root_path: root, actor: "a" });
    store.openWorkspace({ root_path: other, actor: "b" });
    remote(root); remote(other); preUpgrade();
    const rows = fixtureDb(db => db.query("SELECT root_path FROM worktrees ORDER BY id").all()) as { root_path: string }[];
    const pendingPath = rows[1]!.root_path;
    const clock = discoveryClock(args => args[1] === pendingPath && args.includes("rev-list") ? 245 : 1);
    reopen(clock);
    const third = clone("third");
    store.openWorkspace({ root_path: third, actor: "new" });
    expect(clock.now()).toBe(250);
    expect(clock.calls.at(-1)).toContain("rev-list");
    expect(outcome(pendingPath)).toBeNull();
    expect(alias(pendingPath)).toBeNull();
    expect(outcome(third)).toBeNull();
    store.openWorkspace({ root_path: pendingPath, actor: "retry" });
    expect(outcome(pendingPath)).toEqual({ outcome: "checked" });
    expect(alias(pendingPath)).not.toBeNull();
  });

  test("deadline exhaustion between Git calls leaves the new clone pending", () => {
    store.openWorkspace({ root_path: root, actor: "old" });
    remote(root); preUpgrade();
    const clock = discoveryClock(() => 10, 60);
    reopen(clock);
    const other = clone("uninspected");
    store.openWorkspace({ root_path: other, actor: "new" });
    expect(clock.now()).toBe(60);
    expect(clock.calls.length).toBe(6);
    expect(outcome(root)).toEqual({ outcome: "checked" });
    expect(outcome(other)).toBeNull();
    expect(alias(other)).toBeNull();
  });

  test("full-slice successorGit timeouts are distinct from ordinary Git failures", () => {
    remote(root);
    const clock = discoveryClock(args => args.includes("rev-list") ? 5000 : 0);
    expect(() => portableRepositoryKey(root, { ...clock, deadline: 250 })).toThrow(RepositoryProbeTimeout);
    reopen(clock);
    store.openWorkspace({ root_path: root, actor: "full-slice" });
    expect(outcome(root)).toEqual({ outcome: "unresolvable" });
    const calls = clock.calls.length;
    store.openWorkspace({ root_path: root, actor: "cached" });
    expect(clock.calls.length).toBe(calls);
    git(root, "config", "--unset", "remote.origin.url");
    expect(portableRepositoryKey(root, { now: () => 0, deadline: 250 })).toBeNull();
  });

  test("unbounded physical inspection keeps its identity when portable history times out", () => {
    remote(root);
    const physical = inspectRepository(root, undefined, true, { portable: false });
    const clock = discoveryClock(args => args.includes("rev-list") ? 6000 : 0);
    const inspected = inspectRepository(root, undefined, true, clock);
    expect(inspected.repository_key).toBe(physical.repository_key);
    expect(inspected.worktree_fingerprint).toBe(physical.worktree_fingerprint);
    expect(inspected.checkpoint.worktree_id).toBe(physical.checkpoint.worktree_id);
    expect(inspected.portable_repository_key).toBeNull();
  });

  test("missing remotes, shallow/unborn and multiple-root histories keep local routing", () => {
    expect(inspectRepository(root).portable_repository_key).toBeNull();
    remote(root);
    const key = inspectRepository(root).portable_repository_key;
    expect(key).toMatch(/^git-root-remote:v1:/);
    git(root, "config", "remote.github.url", "https://example.invalid/owner/repo.git");
    git(root, "config", "--unset", "remote.origin.url");
    expect(inspectRepository(root).portable_repository_key).toBe(key);
    const head = git(root, "rev-parse", "HEAD");
    writeFileSync(join(root, ".git/shallow"), `${head}\n`);
    expect(inspectRepository(root).portable_repository_key).toBeNull();
    rmSync(join(root, ".git/shallow"));
    const empty = join(directory, "empty"); mkdirSync(empty); git(empty, "init"); remote(empty);
    expect(inspectRepository(empty).portable_repository_key).toBeNull();
    git(root, "checkout", "--orphan", "unrelated");
    writeFileSync(join(root, "file.txt"), "unrelated\n"); git(root, "add", "file.txt"); git(root, "commit", "-m", "unrelated");
    git(root, "merge", "--allow-unrelated-histories", "-s", "ours", "main", "-m", "two roots");
    expect(inspectRepository(root).portable_repository_key).toBeNull();
  });
});
