/** The shared/private root split (stage 0 of the public development repository).
 *
 * The repository root holds the shared public texts and CI. The private
 * repository's own root texts live under private/root/, its CI is
 * .github/workflows/private-ci.yml, and private/README.md explains the
 * layout. These tests pin that split, scan the shared texts with the private
 * relational denylist (rule ids and line hashes only, never terms), pin the
 * public repository's name to its one constant, and run the shared CI's
 * commit-identity check against a stubbed GitHub API.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { PRIVATE_REPOSITORY, PUBLIC_REPOSITORY } from "../../private/public-repository.ts";
import { ALLOWLIST_PATH, DENYLIST_PATH, parseAllowlist, parseDenylist } from "../project-public.ts";
import { contentFindings, formatFinding, PERSONAL_RULES, SECRET_RULES } from "../../tools/public-guard.ts";
import { lintWorkflow, repositoryGuarded } from "../../tools/workflow-lint.ts";

const ROOT = resolve(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** Root paths whose bytes the shared tree and this repository hold alike. */
const SHARED_ROOT_FILES = [
  ".github/workflows/ci.yml",
  ".github/workflows/public-watch.yml",
  ".gitignore",
  ".gitleaksignore",
  "LICENSE",
  "LICENSING.md",
  "NOTICE",
  "README.md",
  "SECURITY.md",
  "tools/leak-canaries.txt",
  "tools/public-guard-allow.json",
  "tools/public-guard.ts",
  "tools/workflow-lint.ts",
];
/** The shared tree's workflows; every other workflow is private-only. */
const SHARED_WORKFLOWS = ["ci.yml", "public-watch.yml"];
/** The private repository's own texts for the root files that were split. */
const PRIVATE_ROOT_TEXTS = ["LICENSING.md", "NOTICE", "README.md", "SECURITY.md"];

type Step = { name?: string; if?: string; run?: string; uses?: string; env?: Record<string, string>; "working-directory"?: string };
type Job = { name?: string; if?: string; needs?: string | string[]; steps?: Step[]; environment?: unknown };
const sharedCiSource = read(".github/workflows/ci.yml");
const sharedCi = Bun.YAML.parse(sharedCiSource) as { name: string; on: Record<string, unknown>; jobs: Record<string, Job> };

describe("the root split", () => {
  test("the shared root files are present and the private texts live under private/root", () => {
    expect(SHARED_ROOT_FILES.filter((path) => path.startsWith(".github/workflows/")).map((path) => path.slice(".github/workflows/".length))).toEqual(SHARED_WORKFLOWS);
    for (const path of SHARED_ROOT_FILES) expect(existsSync(join(ROOT, path)), path).toBe(true);
    for (const name of PRIVATE_ROOT_TEXTS) {
      const privateText = join("private", "root", name);
      expect(existsSync(join(ROOT, privateText)), privateText).toBe(true);
      expect(read(privateText), name).not.toBe(read(name));
    }
    // The package projection keeps its own root files; it never takes these.
    for (const path of ["README.md", "LICENSING.md", "NOTICE", "SECURITY.md", ".gitignore", ".gitleaksignore", ".github/workflows/ci.yml"]) {
      expect(existsSync(join(ROOT, "private", "projection", "overlay", path)), path).toBe(true);
    }
    expect(existsSync(join(ROOT, ".github", "workflows", "private-ci.yml"))).toBe(true);
    expect(existsSync(join(ROOT, "private", "README.md"))).toBe(true);
  });

  test("the shared texts hold no denylisted term, denylisted blob, credential shape, or personal data", () => {
    const denylist = parseDenylist(readFileSync(join(ROOT, DENYLIST_PATH)));
    const files = SHARED_ROOT_FILES.map((path) => ({ path, bytes: readFileSync(join(ROOT, path)) }));
    // formatFinding prints path, line, rule id, and the line's SHA-256 only.
    expect(contentFindings(files, denylist.rules).map(formatFinding)).toEqual([]);
    expect(contentFindings(files, [...SECRET_RULES, ...PERSONAL_RULES]).map(formatFinding)).toEqual([]);
    const denied = new Set([...denylist.blobs.map((blob) => blob.sha256), denylist.sha256]);
    for (const { path, bytes } of files) {
      expect(denied.has(createHash("sha256").update(bytes).digest("hex")), path).toBe(false);
    }
  });

  test("the shared prose points nowhere private", () => {
    for (const path of ["README.md", "LICENSING.md", "NOTICE", "SECURITY.md"]) {
      const text = read(path);
      expect(text, path).not.toContain("private/");
      expect(text, path).not.toMatch(/\.\.\/|\/Users\/|~\//u);
    }
    // The vulnerability path must not depend on an unconfirmed repository URL.
    expect(read("SECURITY.md")).not.toContain("github.com/");
    expect(read("SECURITY.md")).toContain("mailto:contact@cambridgetcg.com");
  });

  test(".gitignore keeps every pattern the private and projection copies had, except a narrower archive rule", () => {
    const patterns = (text: string) => new Set(text.split("\n").map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#")));
    const shared = patterns(read(".gitignore"));
    const projection = patterns(read("private/projection/overlay/.gitignore"));
    // `*.tgz` would hide the LOVE archives this repository commits under apps/docs.
    expect([...projection].filter((pattern) => !shared.has(pattern))).toEqual(["*.tgz"]);
    expect(shared.has("packages/**/*.tgz")).toBe(true);
    expect(shared.has("api/src/private/")).toBe(true);
    const tracked = Bun.spawnSync(["git", "ls-files", "-ci", "--exclude-standard"], { cwd: ROOT, stdout: "pipe" });
    expect(tracked.stdout.toString()).toBe("");
  });
});

describe("the shared CI", () => {
  test("every shared workflow passes the workflow lint for the public name", () => {
    for (const file of SHARED_WORKFLOWS) expect(lintWorkflow(file, read(`.github/workflows/${file}`), PUBLIC_REPOSITORY), file).toEqual([]);
    expect(sharedCiSource).toContain('bun tools/workflow-lint.ts --repository "$REPOSITORY"');
  });

  test("every job runs only in the public repository and holds no secret", () => {
    const guard = `github.repository == '${PUBLIC_REPOSITORY}'`;
    expect(Object.keys(sharedCi.jobs)).toEqual(["guard", "identity", "packages", "sdk-python"]);
    for (const [name, job] of Object.entries(sharedCi.jobs)) {
      expect(job.if, name).toBe(guard);
      expect(job.environment, name).toBeUndefined();
    }
    expect(sharedCi.on).toEqual({ push: { branches: ["main"] }, pull_request: null });
    expect(sharedCiSource).not.toMatch(/secrets\.|id-token|environment:|private\/|pull_request_target|workflow_run/u);
    for (const match of sharedCiSource.matchAll(/uses:\s*(\S+)/gu)) expect(match[1]).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/u);
    const guardRun = sharedCi.jobs.guard?.steps?.map((step) => step.run ?? "").join("\n") ?? "";
    expect(guardRun).toContain('bun tools/public-guard.ts --tree --rev HEAD --gitleaks "$GITLEAKS_BIN"');
    expect(sharedCiSource).toContain("fetch-depth: 0");
    expect(sharedCiSource).toContain("551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb");
  });

  test("it gates exactly the allowlisted packages, the same way the projection's CI does", () => {
    const allowlist = parseAllowlist(readFileSync(join(ROOT, ALLOWLIST_PATH)));
    const packages = allowlist.include
      .filter((entry) => entry.kind === "tree" && entry.path.startsWith("packages/"))
      .map((entry) => entry.path.slice("packages/".length));
    const gated = [...sharedCiSource.matchAll(/^ {8}working-directory: packages\/([a-z0-9-]+)\n {8}run: bun run ci/gmu)].map((match) => match[1]);
    expect([...gated].sort()).toEqual(packages.filter((dir) => dir !== "sdk-py").sort());
    // The package gates are the projection CI's, job for job; only the guard,
    // the identity check, the repository conditions, and packages/wallet's
    // optional steps differ.
    const projection = Bun.YAML.parse(read("private/projection/overlay/.github/workflows/ci.yml")) as { jobs: Record<string, Job> };
    const withoutConditions = (steps: Step[] = []) => steps.map(({ if: _condition, ...rest }) => rest);
    const walletLine = /^ *wallet \\\n/mu;
    const projectionSteps = withoutConditions(projection.jobs.packages?.steps).map((step) =>
      step.run !== undefined && walletLine.test(step.run) ? { ...step, run: step.run.replace(walletLine, "") } : step,
    );
    const sharedSteps = withoutConditions(sharedCi.jobs.packages?.steps).filter(
      (step) => step.name !== "Install packages/wallet from its lockfile (when the tree carries it)",
    );
    expect(sharedSteps).toEqual(projectionSteps);
    expect(withoutConditions(sharedCi.jobs["sdk-python"]?.steps)).toEqual(withoutConditions(projection.jobs["sdk-python"]?.steps));
  });

  test("only packages/wallet's steps are optional, and only on its presence", () => {
    const optional = (sharedCi.jobs.packages?.steps ?? []).filter((step) => step.if !== undefined);
    expect(optional.map((step) => step.name)).toEqual([
      "Install packages/wallet from its lockfile (when the tree carries it)",
      "wallet: Agent Wallet record, policy, lifecycle, and vector primitives",
      "Smoke packed Agent Wallet and Zerone adapter together under Node and Bun",
    ]);
    for (const step of optional) expect(step.if).toBe("hashFiles('packages/wallet/package.json') != ''");
    expect(sharedCiSource.match(/hashFiles\(/gu)).toHaveLength(3);
  });

  test("the public repository's name lives in one constant, and the test names every copy", () => {
    const files = Bun.spawnSync(["git", "grep", "-l", "-F", PUBLIC_REPOSITORY, "--", "."], { cwd: ROOT, stdout: "pipe" })
      .stdout.toString()
      .split("\n")
      .filter(Boolean)
      .sort();
    // A rename is the constant plus these files. Tools read the constant
    // (shell scripts through `bun private/public-repository.ts`).
    expect(files).toEqual([".github/workflows/ci.yml", ".github/workflows/public-watch.yml", "private/README.md", "private/public-repository.ts"]);
    expect(sharedCiSource.split(PUBLIC_REPOSITORY).length - 1).toBe(Object.keys(sharedCi.jobs).length);
    const watch = read(".github/workflows/public-watch.yml");
    expect(watch.split(PUBLIC_REPOSITORY).length - 1).toBe(Object.keys((Bun.YAML.parse(watch) as { jobs: object }).jobs).length);
    expect(read("private/public-repository.ts")).toContain("has not confirmed");
  });
});

/** Every workflow file. ci.yml and public-watch.yml are the shared tree's; the rest are private-only. */
const WORKFLOWS = [
  "ci.yml",
  "collab-courier.yml",
  "deploy-api.yml",
  "local-starter.yml",
  "private-ci.yml",
  "production-health.yml",
  "public-watch.yml",
  "publish-care-before-learning-hf.yml",
  "publish-pypi.yml",
  "wake-return.yml",
  "whitehack.yml",
];
/**
 * Workflows another session owns, whose repository guard is handed off
 * (2026-10-19). The test fails once one gains its guard, so the list only
 * shrinks.
 */
const GUARD_HANDED_OFF = ["local-starter.yml", "production-health.yml"];

describe("workflows", () => {
  test("the inventory holds the shared CI and the private-only workflows, and nothing retired", () => {
    expect(readdirSync(join(ROOT, ".github", "workflows")).sort()).toEqual(WORKFLOWS);
    // Removed on 2026-10-19: a probe for a branch that no longer exists, the
    // publisher of an already-published frozen edition, and Codeberg's CI.
    for (const retired of [".github/workflows/care-before-learning-hf-probe.yml", ".github/workflows/publish-gospel.yml", ".forgejo"]) {
      expect(existsSync(join(ROOT, retired)), retired).toBe(false);
    }
  });

  test("every private-only job runs only in this repository", () => {
    const unguarded: string[] = [];
    for (const name of WORKFLOWS.filter((file) => !SHARED_WORKFLOWS.includes(file))) {
      const workflow = Bun.YAML.parse(read(`.github/workflows/${name}`)) as { jobs: Record<string, Job> };
      const jobs = Object.entries(workflow.jobs);
      expect(jobs.length, name).toBeGreaterThan(0);
      const guarded = jobs.map(([, job]) => repositoryGuarded(job.if, PRIVATE_REPOSITORY));
      if (guarded.every(Boolean)) continue;
      unguarded.push(name);
      expect(GUARD_HANDED_OFF, `${name}: every job needs if: github.repository == '${PRIVATE_REPOSITORY}' && ...`).toContain(name);
    }
    expect(unguarded).toEqual(GUARD_HANDED_OFF);
  });

  test("the guard check reads conditions the way GitHub joins them", () => {
    const repo = PRIVATE_REPOSITORY;
    expect(repositoryGuarded(`github.repository == '${repo}'`, repo)).toBe(true);
    expect(repositoryGuarded(`\${{ !cancelled() && github.repository == '${repo}' && (a || b) }}`, repo)).toBe(true);
    expect(repositoryGuarded(`\${{ always() && github.repository == '${repo}' && x == 'a||b' }}`, repo)).toBe(true);
    expect(repositoryGuarded(`github.repository == '${repo}' && a || b`, repo)).toBe(false);
    expect(repositoryGuarded(`a && github.repository == '${repo}'`, repo)).toBe(false);
    expect(repositoryGuarded(`github.repository == '${repo}-other'`, repo)).toBe(false);
    expect(repositoryGuarded(`github.repository != '${repo}'`, repo)).toBe(false);
    expect(repositoryGuarded(undefined, repo)).toBe(false);
  });
});

const JQ = Bun.which("jq");

describe("the shared CI's commit-identity check", () => {
  const script = sharedCi.jobs.identity?.steps?.[0]?.run ?? "";
  const scratch = mkdtempSync(join(tmpdir(), "public-root-split-"));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));
  const stub = join(scratch, "gh");
  writeFileSync(
    stub,
    [
      "#!/bin/bash",
      'jqexpr=""; endpoint=""',
      "while [ $# -gt 0 ]; do",
      '  case "$1" in',
      "    api|--paginate) ;;",
      "    --method) shift ;;",
      '    --jq) shift; jqexpr="$1" ;;',
      '    *) endpoint="$1" ;;',
      "  esac",
      "  shift",
      "done",
      'printf "%s\\n" "$endpoint" >>"$STUB_LOG"',
      'if [ -n "$jqexpr" ]; then jq -r "$jqexpr" "$STUB_JSON"; else cat "$STUB_JSON"; fi',
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  writeFileSync(join(scratch, "step.sh"), script);

  type Commit = { sha: string; author?: string | null; committer?: string | null; authorEmail: string; committerEmail?: string };
  const commitJson = (commit: Commit) => ({
    sha: commit.sha,
    author: commit.author === null || commit.author === undefined ? null : { login: commit.author },
    committer: commit.committer === null || commit.committer === undefined ? null : { login: commit.committer },
    commit: { author: { email: commit.authorEmail }, committer: { email: commit.committerEmail ?? commit.authorEmail } },
  });
  let runs = 0;
  function runCheck(env: Record<string, string>, body: unknown) {
    runs += 1;
    const json = join(scratch, `response-${runs}.json`);
    const log = join(scratch, `calls-${runs}.log`);
    writeFileSync(json, JSON.stringify(body));
    writeFileSync(log, "");
    const result = Bun.spawnSync(["/bin/bash", "--noprofile", "--norc", "-eo", "pipefail", join(scratch, "step.sh")], {
      env: {
        PATH: `${scratch}:${dirname(JQ ?? "/usr/bin/jq")}:/usr/bin:/bin`,
        RUNNER_TEMP: scratch,
        STUB_JSON: json,
        STUB_LOG: log,
        REPOSITORY: "example/shared",
        EVENT_NAME: "pull_request",
        PULL_NUMBER: "7",
        PULL_COMMITS: "0",
        BEFORE: "",
        AFTER: "f".repeat(40),
        MAINTAINER_LOGINS: "maintainer-one, maintainer-two",
        ...env,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    return { code: result.exitCode, out: `${result.stdout}${result.stderr}`, calls: readFileSync(log, "utf8").trim().split("\n").filter(Boolean) };
  }
  const sha = (digit: string) => digit.repeat(40);
  const PRIVATE_ADDRESS = "dev@laptop.invalid";

  test.skipIf(JQ === null)("checks maintainers' commits in a pull request and leaves other contributors' commits alone", () => {
    const commits = [
      { sha: sha("a"), author: "maintainer-one", authorEmail: PRIVATE_ADDRESS },
      { sha: sha("b"), author: "outside-contributor", authorEmail: "person@mail.invalid" },
      { sha: sha("c"), author: null, committer: "maintainer-two", authorEmail: "12345+maintainer-two@users.noreply.github.com", committerEmail: "noreply@github.com" },
    ].map(commitJson);
    const refused = runCheck({ PULL_COMMITS: "3" }, commits);
    expect(refused.code).toBe(1);
    expect(refused.out).toContain(`${"a".repeat(12)}: the author address is not a public one`);
    expect(refused.out).not.toContain("b".repeat(12));
    expect(refused.out).toContain("checked 2 commit(s)");
    // Addresses are compared, never printed.
    expect(refused.out).not.toContain(PRIVATE_ADDRESS);
    expect(refused.out).not.toContain("person@mail.invalid");
    expect(refused.calls).toEqual(["repos/example/shared/pulls/7/commits?per_page=100"]);

    const fixed = runCheck({ PULL_COMMITS: "3" }, commits.map((commit) => (commit.sha === sha("a") ? commitJson({ sha: sha("a"), author: "maintainer-one", authorEmail: "Contact@CambridgeTCG.com" }) : commit)));
    expect(fixed.code, fixed.out).toBe(0);
  });

  test.skipIf(JQ === null)("checks every commit while the maintainer list is unset", () => {
    const result = runCheck({ PULL_COMMITS: "1", MAINTAINER_LOGINS: "" }, [commitJson({ sha: sha("d"), author: "anyone", authorEmail: PRIVATE_ADDRESS })]);
    expect(result.code).toBe(1);
    expect(result.out).toContain("PUBLIC_IDENTITY_LOGINS is not set");
    expect(result.out).not.toContain(PRIVATE_ADDRESS);
  });

  test.skipIf(JQ === null)("refuses lookalike and empty addresses", () => {
    for (const address of [
      "contact@cambridgetcg.com.evil.invalid",
      "noreply@github.com.evil.invalid",
      "x@users.noreply.github.com.evil.invalid",
      "@users.noreply.github.com",
      "dev@laptop.invalid@users.noreply.github.com",
      "contact@sub.cambridgetcg.com",
      "",
    ]) {
      const result = runCheck({ PULL_COMMITS: "1" }, [commitJson({ sha: sha("e"), author: "maintainer-one", authorEmail: address, committerEmail: "noreply@github.com" })]);
      expect(result.code, address).toBe(1);
    }
  });

  test.skipIf(JQ === null)("fails closed when the API lists fewer commits than the event holds", () => {
    const pullRequest = runCheck({ PULL_COMMITS: "5" }, [commitJson({ sha: sha("1"), author: "outside-contributor", authorEmail: "person@mail.invalid" })]);
    expect(pullRequest.code).toBe(1);
    expect(pullRequest.out).toContain("the pull request holds 5 commits and the API listed 1");
    const push = runCheck(
      { EVENT_NAME: "push", BEFORE: sha("9") },
      { total_commits: 300, commits: [commitJson({ sha: sha("2"), author: "maintainer-one", authorEmail: "contact@cambridgetcg.com" })] },
    );
    expect(push.code).toBe(1);
    expect(push.out).toContain("the push holds 300 commits and the API listed 1");
    expect(push.calls).toEqual([`repos/example/shared/compare/${sha("9")}...${"f".repeat(40)}`]);
  });

  test.skipIf(JQ === null)("reads a first push as one commit and a later push through compare", () => {
    const first = runCheck({ EVENT_NAME: "push", BEFORE: "0".repeat(40) }, commitJson({ sha: sha("3"), author: "maintainer-one", authorEmail: "contact@cambridgetcg.com" }));
    expect(first.code, first.out).toBe(0);
    expect(first.calls).toEqual([`repos/example/shared/commits/${"f".repeat(40)}`]);
    const later = runCheck(
      { EVENT_NAME: "push", BEFORE: sha("9") },
      { total_commits: 1, commits: [commitJson({ sha: sha("4"), committer: "maintainer-two", authorEmail: PRIVATE_ADDRESS, committerEmail: "noreply@github.com" })] },
    );
    expect(later.code).toBe(1);
    expect(later.out).toContain(`${"4".repeat(12)}: the author address is not a public one`);
  });
});
