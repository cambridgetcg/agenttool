import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { canonicalRepositoryRemote, inspectRepository } from "../src/repository.js";
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
    expect(code(() => store.startSession({ root_path: root, actor: "upgraded" }))).toBe("repository_partitioned");
    expect(store.eventsSince(a.id).events).toEqual(eventsA);
    expect(store.eventsSince(b.id).events).toEqual(eventsB);
    expect(store.verifyJournal(a.id)).toBe(true);
    expect(store.verifyJournal(b.id)).toBe(true);
    const third = clone("third");
    expect(code(() => store.startSession({ root_path: third, actor: "third" }))).toBe("repository_partitioned");
  });

  test("different remotes and explicit overrides stay separate; changed aliases fail closed", () => {
    remote(root);
    const other = clone("fork", "https://example.invalid/fork/repo.git");
    const a = store.openWorkspace({ root_path: root, actor: "a" });
    const b = store.openWorkspace({ root_path: other, actor: "b" });
    expect(a.id).not.toBe(b.id);
    const explicit = clone("explicit");
    expect(store.openWorkspace({ root_path: explicit, actor: "explicit", repository_key: "separate" }).id).not.toBe(a.id);
    remote(root, "https://example.invalid/moved/repo.git");
    expect(code(() => store.openWorkspace({ root_path: root, actor: "a" }))).toBe("repository_identity_changed");
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
