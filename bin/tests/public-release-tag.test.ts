import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { assertReleaseTagObject, EXPECTED_REPOSITORY, RELEASE_REPOSITORY, RELEASE_REPOSITORY_URL } from "../npm-release";
import { projectPublic } from "../project-public.ts";
import {
  createReleaseTag,
  parseArgs,
  ReleaseTagRefused,
  selectCiRun,
  type FetchJson,
  type WorkflowRun,
} from "../public-release-tag.ts";
import { GITLEAKS_VERSION } from "../../public/overlay/tools/public-guard.ts";

const ROOT = resolve(import.meta.dir, "..", "..");
const GUARD = join(ROOT, "public", "overlay", "tools", "public-guard.ts");
const scratch = mkdtempSync(join(tmpdir(), "public-release-tag-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("GIT_")) env[key] = value;
  }
  return { ...env, GIT_CONFIG_NOSYSTEM: "1", ...extra };
}

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: cleanEnv(), maxBuffer: 1 << 28 });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

/** A gitleaks stand-in that reports no leaks; the projection guard itself is tested elsewhere. */
function stubGitleaks(): string {
  const dir = join(scratch, "stub-bin");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "gitleaks");
  writeFileSync(path, [
    "#!/bin/sh",
    `if [ "$1" = version ]; then echo ${GITLEAKS_VERSION}; exit 0; fi`,
    'report=""',
    'while [ $# -gt 0 ]; do [ "$1" = --report-path ] && report="$2"; shift; done',
    "printf '[]' > \"$report\"",
    "",
  ].join("\n"), { mode: 0o755 });
  return path;
}
const GITLEAKS = stubGitleaks();

let clock = 1_760_000_000;
let fixtures = 0;

function write(repo: string, path: string, content: string): void {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), content);
}

function commitAll(repo: string, message: string): string {
  clock += 60;
  git(repo, "add", "-A");
  const result = spawnSync("git", ["commit", "-q", "--no-verify", "--no-gpg-sign", "-m", message], {
    cwd: repo,
    encoding: "utf8",
    env: cleanEnv({
      GIT_AUTHOR_NAME: "Fixture Author",
      GIT_AUTHOR_EMAIL: "author@example.invalid",
      GIT_AUTHOR_DATE: `@${clock} +0100`,
      GIT_COMMITTER_NAME: "Fixture Committer",
      GIT_COMMITTER_EMAIL: "committer@example.invalid",
      GIT_COMMITTER_DATE: `@${clock} +0100`,
    }),
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return git(repo, "rev-parse", "HEAD");
}

function mathCardsManifest(version: string, url = EXPECTED_REPOSITORY): string {
  return `${JSON.stringify({
    name: "@agenttool/math-cards",
    version,
    license: "Apache-2.0",
    publishConfig: { access: "public", tag: "next" },
    scripts: { prepack: "bun run ci" },
    repository: { type: "git", url, directory: "packages/math-cards" },
  }, null, 2)}\n`;
}

/** A private fixture repository projected into a local bare "public" repository. */
function publicFixture(options: { url?: string } = {}): { privateRepo: string; bare: string; commit: string; sourceCommit: string } {
  fixtures += 1;
  const privateRepo = join(scratch, `private-${fixtures}`);
  mkdirSync(privateRepo);
  git(privateRepo, "init", "-q", "--initial-branch=main");
  write(privateRepo, "public/allowlist.json", `${JSON.stringify({
    schema: "agenttool.public-allowlist/1",
    public_repository: RELEASE_REPOSITORY,
    overlay: "public/overlay",
    include: [{ path: "packages/math-cards", kind: "tree" }],
    exclude: [],
    held: [],
  }, null, 2)}\n`);
  write(privateRepo, "public/private-guard/relational-denylist.json", `${JSON.stringify({
    schema: "agenttool.public-relational-denylist/1",
    note: "fixture",
    terms: [{ id: "r01", pattern: "quietfixtureterm", flags: "i" }],
    blob_sha256: [{ id: "b01", sha256: createHash("sha256").update("withheld\n").digest("hex") }],
    allow: [],
  }, null, 2)}\n`);
  write(privateRepo, "public/overlay/README.md", "# Public packages\n");
  write(privateRepo, "public/overlay/.gitleaksignore", "");
  write(privateRepo, "public/overlay/tools/public-guard-allow.json", '{\n  "schema": "agenttool.public-guard-allow/1",\n  "entries": []\n}\n');
  copyFileSync(GUARD, join(privateRepo, "public/overlay/tools/public-guard.ts"));
  write(privateRepo, "packages/math-cards/package.json", mathCardsManifest("0.1.0-dev.2", options.url));
  write(privateRepo, "packages/math-cards/index.ts", "export const card = 1;\n");
  const sourceCommit = commitAll(privateRepo, "fixture");
  const bare = join(scratch, `public-${fixtures}.git`);
  const result = projectPublic({
    repo: privateRepo,
    source: "HEAD",
    target: { kind: "repo", path: bare },
    allowUnmergedSource: true,
    gitleaks: GITLEAKS,
  });
  expect(result.status).toBe("updated");
  return { privateRepo, bare, commit: result.commit, sourceCommit };
}

function run(commit: string, overrides: Partial<WorkflowRun> = {}): Record<string, unknown> {
  const id = overrides.id ?? 38140965681;
  return {
    id,
    path: ".github/workflows/ci.yml",
    event: "push",
    head_branch: "main",
    head_sha: commit,
    status: "completed",
    conclusion: "success",
    html_url: `${RELEASE_REPOSITORY_URL}/actions/runs/${id}`,
    created_at: "2026-10-12T10:00:00Z",
    repository: { full_name: RELEASE_REPOSITORY },
    ...overrides,
  };
}

function fakeGitHub(runs: Array<Record<string, unknown>>): { fetchJson: FetchJson; urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fetchJson: async (url) => {
      urls.push(url);
      const single = /\/actions\/runs\/(\d+)$/u.exec(url);
      if (single) {
        const found = runs.find((entry) => entry.id === Number(single[1]));
        return found ? { status: 200, body: found } : { status: 404, body: undefined };
      }
      return { status: 200, body: { total_count: runs.length, workflow_runs: runs } };
    },
  };
}

describe("public release tags", () => {
  test("tags a green projection commit once with the fixed tagger, and a retry is a no-op", async () => {
    const { bare, commit, sourceCommit } = publicFixture();
    const github = fakeGitHub([run(commit, { id: 7, created_at: "2026-10-12T09:00:00Z", conclusion: "failure" }), run(commit)]);
    const options = { repo: bare, commit, packageKey: "math-cards", mainRef: "refs/heads/main", fetchJson: github.fetchJson };
    const first = await createReleaseTag(options);
    expect(first).toMatchObject({
      status: "created",
      tag: "math-cards-v0.1.0-dev.2",
      commit,
      package: "@agenttool/math-cards",
      version: "0.1.0-dev.2",
      projection_source: sourceCommit,
      public_ci_run: `${RELEASE_REPOSITORY_URL}/actions/runs/38140965681`,
    });
    expect(first.next_step).toContain("push origin refs/tags/math-cards-v0.1.0-dev.2");
    expect(github.urls).toEqual([
      `https://api.github.com/repos/${RELEASE_REPOSITORY}/actions/runs?head_sha=${commit}&event=push&per_page=100`,
    ]);
    expect(git(bare, "cat-file", "-t", "refs/tags/math-cards-v0.1.0-dev.2")).toBe("tag");
    expect(git(bare, "rev-parse", "refs/tags/math-cards-v0.1.0-dev.2")).toBe(first.tag_object);
    expect(git(bare, "rev-list", "-n", "1", "refs/tags/math-cards-v0.1.0-dev.2")).toBe(commit);
    const raw = git(bare, "cat-file", "tag", "refs/tags/math-cards-v0.1.0-dev.2");
    expect(raw).toContain(`tagger AgentTool projection <contact@cambridgetcg.com> ${clock} +0100`);
    expect(raw).toContain(`Projection-Source: ${sourceCommit}`);
    // The workflow's own check accepts exactly this tag.
    expect(() => assertReleaseTagObject(raw, {
      tag: "math-cards-v0.1.0-dev.2",
      tagCommit: commit,
      name: "@agenttool/math-cards",
      version: "0.1.0-dev.2",
    })).not.toThrow();
    expect(await createReleaseTag(options)).toEqual({ ...first, status: "unchanged" });
    // Nothing was pushed anywhere: the bare repository has only main and the new tag.
    expect(git(bare, "for-each-ref", "--format=%(refname)").split("\n").sort()).toEqual([
      "refs/heads/main",
      "refs/tags/math-cards-v0.1.0-dev.2",
    ]);

    // A different CI run would make a different tag object; an existing tag is never moved.
    const other = fakeGitHub([run(commit, { id: 99, created_at: "2026-10-12T11:00:00Z" })]);
    await expect(createReleaseTag({ ...options, fetchJson: other.fetchJson })).rejects.toThrow("tags are never moved");
  });

  test("refuses without a successful push run of ci.yml on main for that exact commit", async () => {
    const { bare, commit } = publicFixture();
    const options = { repo: bare, commit, packageKey: "math-cards", mainRef: "refs/heads/main" };
    for (const runs of [
      [],
      [run(commit, { conclusion: "failure" })],
      [run(commit, { status: "in_progress", conclusion: null })],
      [run(commit, { head_sha: "f".repeat(40) })],
      [run(commit, { event: "pull_request" })],
      [run(commit, { path: ".github/workflows/publish-npm.yml" })],
      [run(commit, { head_branch: "feature" })],
      [run(commit, { repository: { full_name: "someone/fork" } } as Partial<WorkflowRun>)],
    ]) {
      await expect(createReleaseTag({ ...options, fetchJson: fakeGitHub(runs).fetchJson })).rejects.toThrow(ReleaseTagRefused);
    }
    // A pinned run must itself be the evidence for this commit.
    await expect(createReleaseTag({ ...options, ciRun: 5, fetchJson: fakeGitHub([run(commit, { id: 5, head_sha: "e".repeat(40) })]).fetchJson }))
      .rejects.toThrow("is not a push run");
    expect(git(bare, "tag", "-l")).toBe("");
    const pinned = await createReleaseTag({ ...options, ciRun: 5, fetchJson: fakeGitHub([run(commit, { id: 5 })]).fetchJson });
    expect(pinned.public_ci_run).toBe(`${RELEASE_REPOSITORY_URL}/actions/runs/5`);
  });

  test("a local dry-run tag says unverified, and the publish workflow refuses it", async () => {
    const { bare, commit } = publicFixture();
    const result = await createReleaseTag({ repo: bare, commit, packageKey: "math-cards", mainRef: "refs/heads/main", skipCiCheck: true });
    expect(result.public_ci_run).toBe("unverified (local dry run)");
    expect(() => assertReleaseTagObject(git(bare, "cat-file", "tag", result.tag), {
      tag: result.tag,
      tagCommit: commit,
      name: "@agenttool/math-cards",
      version: "0.1.0-dev.2",
    })).toThrow("verified public CI run");
  });

  test("refuses a commit that is not a projection, not in main, or names the private repository", async () => {
    const { bare, commit } = publicFixture();
    const github = fakeGitHub([]);
    const clone = join(scratch, `clone-${fixtures}`);
    git(scratch, "clone", "-q", bare, clone);
    write(clone, "packages/math-cards/index.ts", "export const card = 2;\n");
    const stray = commitAll(clone, "not a projection");
    await expect(createReleaseTag({ repo: clone, commit: stray, packageKey: "math-cards", mainRef: "HEAD", skipCiCheck: true, fetchJson: github.fetchJson }))
      .rejects.toThrow("not a chain of projection commits");

    const second = publicFixture();
    write(second.privateRepo, "packages/math-cards/index.ts", "export const card = 3;\n");
    commitAll(second.privateRepo, "next");
    const next = projectPublic({ repo: second.privateRepo, source: "HEAD", target: { kind: "repo", path: second.bare }, allowUnmergedSource: true, gitleaks: GITLEAKS });
    await expect(createReleaseTag({ repo: second.bare, commit: next.commit, packageKey: "math-cards", mainRef: second.commit, skipCiCheck: true }))
      .rejects.toThrow("is not contained in");
    await expect(createReleaseTag({ repo: bare, commit, packageKey: "math-cards", mainRef: "refs/remotes/origin/main", skipCiCheck: true }))
      .rejects.toThrow("fetch the public main first");

    const privateUrl = publicFixture({ url: "https://github.com/cambridgetcg/agenttool.git" });
    await expect(createReleaseTag({ repo: privateUrl.bare, commit: privateUrl.commit, packageKey: "math-cards", mainRef: "refs/heads/main", skipCiCheck: true }))
      .rejects.toThrow(`repository.url must be ${EXPECTED_REPOSITORY}`);
    await expect(createReleaseTag({ repo: bare, commit, packageKey: "sdk", mainRef: "refs/heads/main", skipCiCheck: true }))
      .rejects.toThrow("packages/sdk-ts/package.json is not in");
    expect(github.urls).toEqual([]);
  });

  test("selects the newest run and parses only complete arguments", () => {
    const commit = "a".repeat(40);
    const older = run(commit, { id: 1, created_at: "2026-10-12T08:00:00Z" }) as unknown as WorkflowRun;
    const newer = run(commit, { id: 2, created_at: "2026-10-12T09:00:00Z", conclusion: "failure" }) as unknown as WorkflowRun;
    const flat = (entry: WorkflowRun) => ({ ...entry, repository: RELEASE_REPOSITORY });
    // A newer failed rerun of the same commit is not hidden by an older success.
    expect(() => selectCiRun([flat(older), flat(newer)], commit)).toThrow("not completed/success");
    expect(selectCiRun([flat(older), flat(newer)], commit, 1).id).toBe(1);

    expect(parseArgs(["--repo", "/r", "--commit", "abc", "--package", "math-cards"])).toEqual({
      repo: "/r",
      commit: "abc",
      packageKey: "math-cards",
    });
    expect(parseArgs(["--repo", "/r", "--commit", "abc", "--package", "math-cards", "--ci-run", "42", "--main-ref", "refs/heads/main"]))
      .toMatchObject({ ciRun: 42, mainRef: "refs/heads/main" });
    for (const argv of [
      ["--repo", "/r", "--commit", "abc"],
      ["--repo", "/r", "--commit", "abc", "--package", "math-cards", "--ci-run", "x"],
      ["--repo", "/r", "--commit", "abc", "--package", "math-cards", "--ci-run", "42", "--skip-ci-check"],
      ["--repo", "/r", "--commit", "abc", "--package", "math-cards", "--push"],
    ]) {
      const child = spawnSync("bun", [join(ROOT, "bin", "public-release-tag.ts"), ...argv], { encoding: "utf8", env: cleanEnv() });
      expect(child.status).toBe(2);
      expect(child.stderr).toContain("usage:");
    }
  });
});
