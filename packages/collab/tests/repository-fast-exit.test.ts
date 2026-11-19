import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { gitCommitExists, inspectRepository, RepositoryProbeTimeout, type RepositoryProbeOptions } from "../src/repository.js";

// Bun 1.3.5 can miss a child's exit in a synchronous spawn (cf3a05bb). The
// milder form reports ETIMEDOUT for a child that already exited on its own;
// the other form never returns, and git that exits at once (a root with no
// repository) is where both were seen. These tests pin the two defences:
// no git child where no repository can be found, and an exit that a
// reported timeout cannot hide.

let directory: string;
const savedEnv = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE };

beforeEach(() => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), "collab-fast-exit-")));
  delete process.env.GIT_DIR;
  delete process.env.GIT_WORK_TREE;
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function counting(reply?: (args: string[]) => SpawnSyncReturns<string | Buffer>): RepositoryProbeOptions & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    spawn: (args, options) => {
      calls.push(args);
      return reply ? reply(args) : spawnSync("git", args, options);
    },
  };
}

const timedOut = (fields: Partial<SpawnSyncReturns<string>>): SpawnSyncReturns<string> => ({
  pid: 0, output: [], stdout: "", stderr: "", status: null, signal: null,
  error: Object.assign(new Error("spawnSync git ETIMEDOUT"), { code: "ETIMEDOUT" }),
  ...fields,
});

describe("no git child where no repository can be found", () => {
  test("a directory with no .git above it is inspected without spawning git", () => {
    const plain = join(directory, "plain", "deeper");
    mkdirSync(plain, { recursive: true });
    const probe = counting();
    const identity = inspectRepository(plain, undefined, false, probe);
    expect(probe.calls).toEqual([]);
    expect(identity.repository_key).toStartWith("local-path:");
    expect(identity.git_common_dir_hash).toBeNull();
    expect(identity.checkpoint.head_sha).toBeNull();
  });

  test("a .git directory, a .git file (linked worktree) or a .git link above the root still asks git", () => {
    for (const [name, make] of [
      ["dir", (at: string) => mkdirSync(join(at, ".git"))],
      ["file", (at: string) => writeFileSync(join(at, ".git"), "gitdir: /nowhere\n")],
      ["link", (at: string) => symlinkSync(join(directory, "missing-target"), join(at, ".git"))],
    ] as const) {
      const top = join(directory, `with-${name}`);
      const nested = join(top, "a", "b");
      mkdirSync(nested, { recursive: true });
      make(top);
      const probe = counting();
      inspectRepository(nested, undefined, false, probe);
      expect(probe.calls[0]).toEqual(["-C", nested, "rev-parse", "--show-toplevel"]);
    }
  });

  test("GIT_DIR or GIT_WORK_TREE always leaves the answer to git", () => {
    const plain = join(directory, "plain");
    mkdirSync(plain);
    for (const key of ["GIT_DIR", "GIT_WORK_TREE"] as const) {
      process.env[key] = join(directory, "elsewhere");
      const probe = counting();
      inspectRepository(plain, undefined, false, probe);
      expect(probe.calls.length).toBeGreaterThan(0);
      delete process.env[key];
    }
  });

  test("a real repository is still found from a subdirectory", () => {
    const repo = join(directory, "repo");
    const sub = join(repo, "sub");
    mkdirSync(sub, { recursive: true });
    spawnSync("git", ["-C", repo, "init", "--initial-branch=main"], { encoding: "utf8" });
    const identity = inspectRepository(sub, undefined, true);
    expect(identity.root_path).toBe(repo);
    expect(identity.repository_key).toStartWith("local-git:");
  });
});

describe("an exit that a reported timeout cannot hide", () => {
  function fakeRepository(): string {
    const top = join(directory, "fake");
    mkdirSync(join(top, ".git"), { recursive: true });
    return top;
  }

  test("a finished exit 128 reported as ETIMEDOUT is no repository, not a timeout", () => {
    const top = fakeRepository();
    const probe = counting(() => timedOut({ status: 128 }));
    const identity = inspectRepository(top, undefined, false, { ...probe, deadline: 1_000_000, now: () => 0 });
    expect(identity.repository_key).toStartWith("local-path:");
  });

  test("a finished exit 0 reported as ETIMEDOUT keeps its output", () => {
    const top = fakeRepository();
    const probe = counting(args =>
      args.includes("--show-toplevel") ? timedOut({ status: 0, stdout: `${top}\n` }) : timedOut({ status: 128 }));
    // git answered the top level, then nothing else: identity is unavailable, which
    // proves the first answer was used rather than read as "no repository".
    expect(() => inspectRepository(top, undefined, true, probe)).toThrow("local identity could not be resolved");
  });

  test("a child the runtime killed is still a timeout", () => {
    const top = fakeRepository();
    const probe = counting(() => timedOut({ status: null, signal: "SIGTERM" }));
    expect(() => inspectRepository(top, undefined, false, { ...probe, deadline: 1_000_000, now: () => 0 }))
      .toThrow(RepositoryProbeTimeout);
  });

  test("gitCommitExists reads a finished answer reported as ETIMEDOUT", () => {
    const top = fakeRepository();
    const probe = counting(args =>
      args.includes("--git-dir") ? timedOut({ status: 0, stdout: ".git\n" }) : timedOut({ status: 1 }));
    expect(gitCommitExists(top, "0".repeat(40), probe)).toBe(false);
    const killed = counting(() => timedOut({ status: null, signal: "SIGTERM" }));
    expect(gitCommitExists(top, "0".repeat(40), killed)).toBeNull();
  });
});
