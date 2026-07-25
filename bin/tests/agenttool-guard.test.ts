/** agenttool-guard — replays the collision it exists to prevent.
 *
 *  Every test runs against a throwaway repository under $TMPDIR. Nothing here
 *  touches this working tree, and the guard is invoked exactly as git invokes
 *  it, through `core.hooksPath`.
 *
 *  The incident, 2026-07-24 23:33:25, commit 501a1e0b: two agent sessions
 *  shared one working tree. Session A staged 17 files. Session B ran
 *  `git commit` with a populated index and swallowed all 17 into its own
 *  feature commit under its own message. Neither had declared a collab task,
 *  so the coordination plane — which is correct, cross-workspace, and
 *  fail-closed — was never consulted.
 *
 *  The tests that matter most are the ones asserting the guard does NOT fire.
 *  A pre-commit hook that refuses a legitimate commit even once gets
 *  uninstalled the same day, and after that the residual risk is silently
 *  100%. Solo work must be indistinguishable from no guard at all.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const GUARD = resolve(import.meta.dir, "..", "agenttool-guard.sh");
const HOOKS = resolve(import.meta.dir, "..", "..", ".githooks");

const made: string[] = [];

afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
});

interface Session {
  /** Identity string the guard will record, via AGENTTOOL_GUARD_SESSION. */
  id: string;
}

async function newRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "guard-"));
  made.push(dir);
  git(dir, ["init", "-q", "-b", "main"]);
  // The shims resolve the guard through `git rev-parse --show-toplevel`, so
  // each test repo carries its own copy. That is the real mechanism, not a
  // stand-in: a worktree checked out at a revision without bin/ gets no guard.
  await mkdir(join(dir, "bin"), { recursive: true });
  await Bun.write(join(dir, "bin", "agenttool-guard.sh"), Bun.file(GUARD));
  spawnSync("chmod", ["+x", join(dir, "bin", "agenttool-guard.sh")]);
  git(dir, ["config", "user.email", "guard@test"]);
  git(dir, ["config", "user.name", "guard"]);
  git(dir, ["config", "core.hooksPath", HOOKS]);
  await writeFile(join(dir, "seed.txt"), "seed\n");
  git(dir, ["add", "seed.txt"]);
  git(dir, ["commit", "-q", "-m", "seed"]);
  return dir;
}

/** Run git as a given session identity. `session: null` means "no identity
 *  override", which exercises the process-ancestry path. */
function git(dir: string, args: string[], session?: Session | null) {
  return spawnSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      // The guard resolves identity from the process tree unless told
      // otherwise. In tests every git invocation shares this one parent, so
      // ancestry alone cannot distinguish sessions — the override is how two
      // sessions are simulated in a single process.
      ...(session ? { AGENTTOOL_GUARD_SESSION: session.id } : {}),
      GIT_CONFIG_NOSYSTEM: "1",
    },
  });
}

async function stage(dir: string, session: Session | null, files: Record<string, string>) {
  for (const [name, body] of Object.entries(files)) {
    const full = join(dir, name);
    await mkdir(join(full, ".."), { recursive: true });
    await writeFile(full, body);
  }
  const r = git(dir, ["add", ...Object.keys(files)], session);
  expect(r.status, `git add failed: ${r.stderr}`).toBe(0);
}

const A: Session = { id: "sessionA:99001" };
const B: Session = { id: "sessionB:99002" };

describe("agenttool-guard — the guard does NOT fire", () => {
  test("solo work is never refused", async () => {
    const dir = await newRepo();
    await stage(dir, A, { "a.txt": "1", "b.txt": "2", "c/d.txt": "3" });
    const r = git(dir, ["commit", "-m", "solo"], A);
    expect(r.status, r.stderr).toBe(0);
  });

  test("no identity override at all — still never refuses solo", async () => {
    const dir = await newRepo();
    await stage(dir, null, { "a.txt": "1" });
    const r = git(dir, ["commit", "-m", "solo, ancestry identity"], null);
    expect(r.status, r.stderr).toBe(0);
  });

  test("`git status` does not steal ownership", async () => {
    // post-index-change is NOT a `git add` hook — it also fires on
    // `git status --porcelain`, which packages/collab/src/repository.ts:118
    // runs on every collab verb. If the ledger recorded "the current caller
    // owns everything staged", the collab MCP server would take ownership of
    // your work merely by being polled, and then refuse your own commit.
    const dir = await newRepo();
    await stage(dir, A, { "a.txt": "1" });
    git(dir, ["status", "--porcelain"], B); // B pokes the repo
    git(dir, ["status", "--porcelain"], B);
    const r = git(dir, ["commit", "-m", "A commits its own work"], A);
    expect(r.status, `A was blocked from committing its own file:\n${r.stderr}`).toBe(0);
  });

  test("a dead owner has no claim", async () => {
    const dir = await newRepo();
    // pid 99001 is not running; the guard must ignore the attribution rather
    // than wedge the repository. Deliberately the opposite of collab's
    // fail-closed task lease: this prevents loss, it does not reserve.
    await stage(dir, A, { "a.txt": "1" });
    const r = git(dir, ["commit", "-m", "B commits over a dead session"], B);
    expect(r.status, r.stderr).toBe(0);
  });

  test("a missing ledger is not an error", async () => {
    const dir = await newRepo();
    await stage(dir, A, { "a.txt": "1" });
    await rm(join(dir, ".git", "agenttool-index-owners.tsv"), { force: true });
    const r = git(dir, ["commit", "-m", "no ledger"], B);
    expect(r.status, r.stderr).toBe(0);
  });

  test("AGENTTOOL_GUARD=off disables it entirely", async () => {
    const dir = await newRepo();
    await stage(dir, A, { "a.txt": "1" });
    const r = spawnSync("git", ["-C", dir, "commit", "-m", "off"], {
      encoding: "utf8",
      env: { ...process.env, AGENTTOOL_GUARD: "off", AGENTTOOL_GUARD_SESSION: B.id },
    });
    expect(r.status, r.stderr).toBe(0);
  });

  test("the guard is a no-op during a merge", async () => {
    // Replayed history is written by git on behalf of other authors.
    // Ownership is meaningless there and a refusal strands the operation.
    const dir = await newRepo();
    git(dir, ["checkout", "-q", "-b", "side"]);
    await writeFile(join(dir, "side.txt"), "side\n");
    git(dir, ["add", "side.txt"]);
    git(dir, ["commit", "-q", "-m", "side"]);
    git(dir, ["checkout", "-q", "main"]);
    await writeFile(join(dir, "main.txt"), "main\n");
    git(dir, ["add", "main.txt"]);
    git(dir, ["commit", "-q", "-m", "main"]);
    const r = git(dir, ["merge", "--no-ff", "-m", "merge side", "side"], B);
    expect(r.status, r.stderr).toBe(0);
  });
});

describe("agenttool-guard — the incident", () => {
  test("session B cannot swallow session A's staged files", async () => {
    const dir = await newRepo();

    // A stages its work. Use a live pid so the owner passes the liveness
    // check — the guard ignores dead owners by design.
    const live: Session = { id: `sessionA:${process.pid}` };
    const aFiles: Record<string, string> = {};
    for (let i = 0; i < 17; i++) aFiles[`a/file-${i}.ts`] = `// A ${i}\n`;
    await stage(dir, live, aFiles);

    // B stages its own unrelated feature into the same index.
    const bFiles: Record<string, string> = {};
    for (let i = 0; i < 5; i++) bFiles[`b/feature-${i}.ts`] = `// B ${i}\n`;
    await stage(dir, B, bFiles);

    // B commits everything, exactly as happened.
    const r = git(dir, ["commit", "-m", "feat(b): unrelated feature"], B);

    expect(r.status, "the guard did not refuse the swallowing commit").toBe(1);
    expect(r.stderr).toContain("17 file(s) staged by another live session");
    for (const p of Object.keys(aFiles)) expect(r.stderr).toContain(p);

    // The index is untouched: nothing was lost, nothing was committed.
    const staged = git(dir, ["diff", "--cached", "--name-only"], B).stdout.trim().split("\n");
    expect(staged).toHaveLength(22);
  });

  test("the remedy works and leaves the other session's files staged", async () => {
    const dir = await newRepo();
    const live: Session = { id: `sessionA:${process.pid}` };
    await stage(dir, live, { "a/one.ts": "1", "a/two.ts": "2" });
    await stage(dir, B, { "b/feature.ts": "3" });

    // The message the guard prints: commit only your own paths.
    const r = git(dir, ["commit", "-m", "feat(b): only mine", "--", "b/feature.ts"], B);
    expect(r.status, r.stderr).toBe(0);

    const staged = git(dir, ["diff", "--cached", "--name-only"], B).stdout.trim().split("\n").sort();
    expect(staged).toEqual(["a/one.ts", "a/two.ts"]);
  });

  test("A can still commit its own paths while B's work is staged", async () => {
    const dir = await newRepo();
    const liveA: Session = { id: `sessionA:${process.pid}` };
    await stage(dir, liveA, { "a/one.ts": "1" });
    await stage(dir, B, { "b/feature.ts": "2" });
    const r = git(dir, ["commit", "-m", "fix(a): mine", "--", "a/one.ts"], liveA);
    expect(r.status, r.stderr).toBe(0);
  });
});

describe("agenttool-guard — the bypass leaves a record", () => {
  test("--no-verify still writes an audit line", async () => {
    // post-commit runs even under --no-verify. Making the bypass expensive
    // teaches people to script around it; making it visible does not.
    const dir = await newRepo();
    const live: Session = { id: `sessionA:${process.pid}` };
    await stage(dir, live, { "a/one.ts": "1" });
    await stage(dir, B, { "b/feature.ts": "2" });

    const r = git(dir, ["commit", "--no-verify", "-m", "bypassed"], B);
    expect(r.status, r.stderr).toBe(0);

    const audit = join(dir, ".git", "agenttool-guard-audit.log");
    expect(existsSync(audit), "no audit log written for a bypassed commit").toBe(true);
    const body = await Bun.file(audit).text();
    expect(body).toContain("a/one.ts");
    expect(body).toContain("foreign_path");
    expect(body).toContain(`committer=${B.id}`);
  });
});

describe("agenttool-guard — installation", () => {
  test("the hook shims exist and are executable", async () => {
    for (const name of ["post-index-change", "pre-commit", "post-commit"]) {
      const p = join(HOOKS, name);
      expect(existsSync(p), `${name} missing`).toBe(true);
      const st = await Bun.file(p).text();
      expect(st).toContain("agenttool-guard.sh");
    }
  });

  test("a worktree without .githooks degrades silently rather than erroring", async () => {
    // Old revisions checked out into a linked worktree carry no .githooks
    // directory. git treats a missing hook as absent and exits 0 — verified
    // here so the degradation stays a property, not an accident.
    const dir = await newRepo();
    git(dir, ["config", "core.hooksPath", join(dir, "nonexistent-hooks")]);
    await stage(dir, A, { "a.txt": "1" });
    const r = git(dir, ["commit", "-m", "no hooks present"], B);
    expect(r.status, r.stderr).toBe(0);
  });

  test("the guard script is executable and answers `doctor`", () => {
    const r = spawnSync(GUARD, ["doctor"], { encoding: "utf8", cwd: resolve(HOOKS, "..") });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("agenttool-guard");
    expect(r.stdout).toContain("identity");
  });
});

// ── readiness (query side) ──────────────────────────────────────────────────

/** Build a throwaway collab journal with the columns the guard reads. The
 *  shape mirrors packages/collab/src/store.ts; the guard probes for columns
 *  rather than assuming them, because the journal on this machine sat several
 *  schema versions behind the code. */
async function newJournal(
  repoRoot: string,
  tasks: Array<Record<string, unknown>>,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "guard-db-"));
  made.push(dir);
  const path = join(dir, "collab.sqlite");
  const { Database } = await import("bun:sqlite");
  const db = new Database(path);
  db.exec(`
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY, root_path TEXT NOT NULL, name TEXT NOT NULL,
      repository_key TEXT NOT NULL
    );
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL,
      status TEXT NOT NULL, path_scopes_json TEXT NOT NULL, assignee TEXT,
      assignee_session_id TEXT, lease_expires_at TEXT, work_mode TEXT NOT NULL,
      completion_policy TEXT NOT NULL, review_status TEXT NOT NULL
    );
  `);
  db.query(
    "INSERT INTO workspaces (id, root_path, name, repository_key) VALUES (?,?,?,?)",
  ).run("ws1", repoRoot, "test", "local-git:test");
  for (const t of tasks) {
    db.query(
      `INSERT INTO tasks (id, workspace_id, title, status, path_scopes_json, assignee,
         assignee_session_id, lease_expires_at, work_mode, completion_policy, review_status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      String(t.id), "ws1", String(t.title ?? "t"), String(t.status),
      JSON.stringify(t.path_scopes ?? []), (t.assignee as string) ?? null,
      (t.assignee_session_id as string) ?? null, (t.lease_expires_at as string) ?? null,
      String(t.work_mode ?? "edit"), String(t.completion_policy ?? "reported"),
      String(t.review_status ?? "none"),
    );
  }
  db.close();
  return path;
}

function readiness(repo: string, dbPath: string, extra: string[] = []) {
  return spawnSync(
    "bun",
    [resolve(import.meta.dir, "..", "agenttool-guard.ts"), "readiness", ...extra],
    {
      encoding: "utf8",
      cwd: repo,
      env: { ...process.env, AGENTOOL_COLLAB_DB: dbPath },
    },
  );
}

const future = () => new Date(Date.now() + 3_600_000).toISOString();
const past = () => new Date(Date.now() - 3_600_000).toISOString();

describe("agenttool-guard — readiness", () => {
  test("converged: a live claim blocks the release", async () => {
    const repo = await newRepo();
    const db = await newJournal(repo, [
      { id: "t1", title: "economy work", status: "claimed", assignee: "sessionA",
        path_scopes: ["api/src/services/economy"], lease_expires_at: future() },
    ]);
    const r = readiness(repo, db, ["--mode", "converged"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("blocked by 1 claim");
    expect(r.stdout).toContain("api/src/services/economy");
  });

  test("converged: nothing held is ready", async () => {
    const repo = await newRepo();
    const db = await newJournal(repo, [
      { id: "t1", title: "done", status: "completed", path_scopes: ["api"] },
    ]);
    expect(readiness(repo, db, ["--mode", "converged"]).status).toBe(0);
  });

  test("converged: completed-but-unaccepted still holds its paths", async () => {
    // store.ts:4517-4519 — an accepted-policy task keeps its reservation
    // through review. Shipping before the reviewer looks is the same as
    // shipping unreviewed work.
    const repo = await newRepo();
    const db = await newJournal(repo, [
      { id: "t1", title: "awaiting review", status: "completed", path_scopes: ["api"],
        completion_policy: "accepted", review_status: "pending" },
    ]);
    const r = readiness(repo, db, ["--mode", "converged"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("awaiting_review");
  });

  test("converged: an expired lease is named, not silently ignored", async () => {
    // There is no reaper — expiry is a read-time predicate — so a dead
    // session's claim sits there forever. Naming it is how it gets recovered
    // instead of quietly wedging the repository.
    const repo = await newRepo();
    const db = await newJournal(repo, [
      { id: "t1", title: "abandoned", status: "claimed", path_scopes: ["api"],
        lease_expires_at: past() },
    ]);
    const r = readiness(repo, db, ["--mode", "converged"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("lease_expired");
  });

  test("read_only claims reserve nothing and block nothing", async () => {
    const repo = await newRepo();
    const db = await newJournal(repo, [
      { id: "t1", title: "reading", status: "claimed", path_scopes: ["api"],
        work_mode: "read_only", lease_expires_at: future() },
    ]);
    expect(readiness(repo, db, ["--mode", "converged"]).status).toBe(0);
  });

  test("sequential: a claim on an untouched module does not block", async () => {
    const repo = await newRepo();
    await writeFile(join(repo, "shipped.txt"), "x\n");
    spawnSync("git", ["-C", repo, "add", "shipped.txt"]);
    spawnSync("git", ["-C", repo, "commit", "-q", "-m", "ship"]);
    const base = spawnSync("git", ["-C", repo, "rev-parse", "HEAD~1"], { encoding: "utf8" })
      .stdout.trim();
    const db = await newJournal(repo, [
      { id: "t1", title: "other module", status: "claimed",
        path_scopes: ["packages/sdk-ts"], lease_expires_at: future() },
    ]);
    const r = readiness(repo, db, ["--mode", "sequential", "--base", base, "--head", "HEAD"]);
    expect(r.status, r.stdout).toBe(0);
  });

  test("sequential: a claim overlapping the shipping diff does block", async () => {
    const repo = await newRepo();
    await mkdir(join(repo, "api", "src"), { recursive: true });
    await writeFile(join(repo, "api", "src", "thing.ts"), "x\n");
    spawnSync("git", ["-C", repo, "add", "api/src/thing.ts"]);
    spawnSync("git", ["-C", repo, "commit", "-q", "-m", "ship api"]);
    const base = spawnSync("git", ["-C", repo, "rev-parse", "HEAD~1"], { encoding: "utf8" })
      .stdout.trim();
    const db = await newJournal(repo, [
      { id: "t1", title: "api work", status: "claimed", path_scopes: ["api/src"],
        lease_expires_at: future() },
    ]);
    const r = readiness(repo, db, ["--mode", "sequential", "--base", base, "--head", "HEAD"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("api/src");
  });

  test("sequential without --base falls back to converged, not to allow", async () => {
    const repo = await newRepo();
    const db = await newJournal(repo, [
      { id: "t1", title: "held", status: "claimed", path_scopes: ["anything"],
        lease_expires_at: future() },
    ]);
    const r = readiness(repo, db, ["--mode", "sequential"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("fell back to the converged predicate");
  });

  test("a missing journal is exit 2, not exit 0", async () => {
    // "I could not look" must never read the same as "I looked and it was
    // clear". deploy.sh treats 2 as allow ONLY for the never-used-collab case,
    // and blocks on every other undetermined result.
    const repo = await newRepo();
    const r = readiness(repo, join(repo, "nope.sqlite"), ["--mode", "converged"]);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("no collab journal");
  });
});
