import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { canonicalRepositoryRemote, inspectRepository, portableRepositoryKey } from "../src/repository.js";
import { CollabError } from "../src/errors.js";
import { CollabStore } from "../src/store.js";

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
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "collab-repository-"));
  root = join(directory, "repo");
  mkdirSync(root);
  git(root, "init", "--initial-branch=main");
  git(root, "config", "user.name", "Fixture");
  git(root, "config", "user.email", "fixture@example.invalid");
  writeFileSync(join(root, "file.txt"), "fixture\n");
  git(root, "add", "file.txt");
  git(root, "commit", "-m", "root");
  store = new CollabStore(join(directory, "collab.sqlite"));
});
afterEach(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });

describe("portable repository routing", () => {
  test("canonicalizes equivalent transports without credentials, preserving path and nondefault ports", () => {
    for (const value of ["https://example.invalid/owner/repo.git", "git@example.invalid:owner/repo.git", "ssh://git@example.invalid/owner/repo", "https://user:private@example.invalid/owner/repo.git/"]) {
      expect(canonicalRepositoryRemote(value)).toBe("example.invalid/owner/repo");
    }
    expect(canonicalRepositoryRemote("ssh://example.invalid:2222/owner/repo")).toBe("example.invalid:2222/owner/repo");
    expect(canonicalRepositoryRemote("HTTPS://GitHub.COM/Owner/Repo.GIT")).toBe("github.com/owner/repo");
    expect(canonicalRepositoryRemote("git@GitHub.COM:OWNER/REPO.git")).toBe("github.com/owner/repo");
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
    store.close();
    store = new CollabStore(join(directory, "collab.sqlite"));
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
    expect(portableRepositoryKey(root, performance.now() - 1)).toBeNull();
  });

  test("a slow historical root consumes only the discovery time budget and is not retried", () => {
    remote(root);
    const first = store.openWorkspace({ root_path: root, actor: "first" });
    const slow = join(directory, "slow-root"); mkdirSync(slow);
    fixtureDb(db => db.query(`INSERT INTO worktrees
      (id, workspace_id, root_path, repository_key, git_common_dir_hash, fingerprint, branch, head_sha, dirty, registered_at, last_seen_at)
      SELECT 'slow', workspace_id, ?, repository_key, git_common_dir_hash, 'slow', branch, head_sha, dirty, registered_at, last_seen_at
      FROM worktrees WHERE root_path = ?`).run(slow, root));
    const other = clone("budget-clone");
    const bin = join(directory, "bin"); mkdirSync(bin);
    const realGit = Bun.which("git")!;
    const wrapper = join(bin, "git");
    const attempts = join(directory, "slow-attempts");
    writeFileSync(wrapper, `#!${process.execPath}\nimport { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args.includes(${JSON.stringify(slow)})) {
  appendFileSync(${JSON.stringify(attempts)}, 'attempt\\n');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
}
const r = Bun.spawnSync([${JSON.stringify(realGit)}, ...args]);
process.stdout.write(r.stdout); process.stderr.write(r.stderr); process.exit(r.exitCode);
`);
    chmodSync(wrapper, 0o755);
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    try {
      const start = performance.now();
      expect(store.startSession({ root_path: other, actor: "budget" }).workspace.id).toBe(first.id);
      expect(performance.now() - start).toBeLessThan(2000);
      expect(fixtureDb(db => db.query("SELECT outcome FROM repository_discovery WHERE worktree_id = 'slow'").get())).toEqual({ outcome: "unresolvable" });
      expect(readFileSync(attempts, "utf8")).toBe("attempt\n");
      store.startSession({ root_path: other, actor: "cached" });
      expect(readFileSync(attempts, "utf8")).toBe("attempt\n");
    } finally { process.env.PATH = path; }
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
