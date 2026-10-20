/** scan-public.sh, public-clone.sh, and the settings plan, on scratch repositories only. */
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PUBLIC_REPOSITORY } from "../../public-repository.ts";
import { runExport } from "../public-export.ts";
import { allowedActionPatterns, requiredChecks, settingsPlan } from "../public-settings.ts";
import { cleanEnv, git, makePrivateRepo, OWNER_ADDRESS, publicCommit, ROOT, run, scratchDir, stubGitleaks, TERM, write } from "./fixtures.ts";

setDefaultTimeout(180_000);
const scratch = scratchDir("scan");
afterAll(scratch.cleanup);

const fixture = makePrivateRepo(scratch.dir);
const publicBare = join(scratch.dir, "public.git");
git(scratch.dir, "init", "-q", "--bare", "--initial-branch=main", publicBare);
const rootClone = join(scratch.dir, "public-root");
runExport({ mode: "init", repo: fixture.repo, source: "HEAD", into: rootClone, guardDir: fixture.guardDir, allowUnmergedSource: true, gitleaks: stubGitleaks(scratch.dir), commit: true });
git(rootClone, "push", "-q", publicBare, "HEAD:refs/heads/main");
const P0 = git(rootClone, "rev-parse", "HEAD");
// The private checkout records the public root on origin/main, as after the adoption merge.
write(fixture.repo, "private/export/public-root.txt", `${P0}\n`);
git(fixture.repo, "add", "-A");
git(fixture.repo, "-c", "user.name=Dev", "-c", "user.email=dev@private.invalid", "commit", "-q", "-m", "record the public root");
git(fixture.repo, "update-ref", "refs/remotes/origin/main", "HEAD");

const SCAN = join(fixture.repo, "private/bin/scan-public.sh");
const state = join(scratch.dir, "state");
const scan = (...args: string[]) => run(scratch.dir, "bash", [SCAN, "--url", publicBare, "--state", state, ...args]);
const pdev = join(scratch.dir, "public-dev");
git(scratch.dir, "clone", "-q", publicBare, pdev);
git(pdev, "config", "user.name", "AgentTool");
git(pdev, "config", "user.email", "contact@cambridgetcg.com");

describe("scan-public.sh", () => {
  test("a clean public repository scans clean and the marks advance", () => {
    const result = scan();
    expect(result.status, result.out).toBe(0);
    expect(result.stdout).toContain("scan-public: clean");
    expect(git(join(state, "mirror.git"), "for-each-ref", "--format=%(refname)", "refs/public-scanned")).toBe("refs/public-scanned/heads/main");
  });

  test("a term in a pull request head alerts with rule ids only, and the marks hold until it is handled", () => {
    git(pdev, "switch", "-q", "-c", "feature");
    write(pdev, "packages/alpha/note.md", `about ${TERM}\n`);
    publicCommit(pdev, "feature");
    git(pdev, "push", "-q", "origin", "HEAD:refs/pull/7/head");
    const first = scan();
    expect(first.status).toBe(1);
    expect(first.stdout).toMatch(/^packages\/alpha\/note\.md:1: relational\/r01 line_sha256=[0-9a-f]{64}$/mu);
    expect(first.out.toLowerCase()).not.toContain(TERM);
    const alerts = readdirSync(join(state, "alerts"));
    expect(alerts).toHaveLength(1);
    expect(readFileSync(join(state, "alerts", alerts[0] as string), "utf8").toLowerCase()).not.toContain(TERM);
    expect(git(join(state, "mirror.git"), "for-each-ref", "--format=%(refname)", "refs/public-scanned")).toBe("refs/public-scanned/heads/main");
    // Handled: the pull request head is gone.
    git(publicBare, "update-ref", "-d", "refs/pull/7/head");
    git(pdev, "switch", "-q", "main");
    expect(scan().status).toBe(0);
  });

  test("a foreign root, a canary, and a private path anywhere in a branch's history alert", () => {
    git(pdev, "switch", "-q", "--orphan", "foreign");
    write(pdev, "x.md", "another root\n");
    publicCommit(pdev, "foreign root");
    git(pdev, "push", "-q", "origin", "foreign");
    const foreign = scan();
    expect(foreign.status).toBe(1);
    expect(foreign.stdout).toContain("refs/public-scan/heads/foreign: integrity/foreign-root");
    git(pdev, "push", "-q", "origin", ":foreign");
    git(pdev, "switch", "-q", "-f", "main");
    git(pdev, "branch", "-q", "-D", "foreign");
    git(pdev, "switch", "-q", "-c", "leaky");
    write(pdev, "packages/alpha/c.bin", fixture.canary);
    write(pdev, "private/x.md", "x\n");
    publicCommit(pdev, "leaky");
    git(pdev, "rm", "-q", "-r", "private", "packages/alpha/c.bin");
    publicCommit(pdev, "hide it");
    git(pdev, "push", "-q", "origin", "leaky");
    const leaky = scan();
    expect(leaky.status).toBe(1);
    expect(leaky.stdout).toContain("integrity/leak-canary");
    expect(leaky.stdout).toContain("private/x.md: path/history-private-namespace");
    expect(leaky.stdout).toContain("relational/canary");
    git(pdev, "push", "-q", "origin", ":leaky");
    git(pdev, "switch", "-q", "main");
    expect(scan().status).toBe(0);
  });

  test("a handled pull request head that cannot be deleted is acknowledged in this machine's own list, never by the public one", () => {
    git(pdev, "switch", "-q", "--orphan", "fork-pr");
    write(pdev, "y.md", "an unrelated root from a fork\n");
    const head = publicCommit(pdev, "fork root");
    git(pdev, "push", "-q", "origin", "HEAD:refs/pull/9/head");
    git(pdev, "switch", "-q", "-f", "main");
    expect(scan().stdout).toContain("refs/public-scan/pull/9: integrity/foreign-root");
    // The public side's own acknowledgement list does not silence this scan.
    write(pdev, "tools/public-watch-ack.txt", `pull/9 ${head} # closed fork pull request\n`);
    publicCommit(pdev, "acknowledge the closed pull request for the public watch");
    git(pdev, "push", "-q", "origin", "HEAD:main");
    expect(scan().status).toBe(1);
    writeFileSync(join(state, "acknowledged.txt"), `pull/9 ${head} # handled 2026-10-19\n`);
    const acked = scan();
    expect(acked.status, acked.out).toBe(0);
    // A head that moves is checked again.
    git(pdev, "switch", "-q", "fork-pr");
    write(pdev, "y.md", "moved\n");
    publicCommit(pdev, "moved");
    git(pdev, "push", "-q", "-f", "origin", "HEAD:refs/pull/9/head");
    git(pdev, "switch", "-q", "-f", "main");
    expect(scan().stdout).toContain("refs/public-scan/pull/9: integrity/foreign-root");
    git(publicBare, "update-ref", "-d", "refs/pull/9/head");
    writeFileSync(join(state, "acknowledged.txt"), "");
    expect(scan().status).toBe(0);
  });

  test("pull request and issue text are read with GET through gh, and a missing guard is an error, never a clean run", () => {
    const bin = join(scratch.dir, "stub-gh");
    mkdirSync(bin, { recursive: true });
    const log = join(scratch.dir, "gh.log");
    writeFileSync(
      join(bin, "gh"),
      [
        "#!/bin/bash",
        `printf '%s\\n' "$*" >> ${JSON.stringify(log)}`,
        'case "$*" in',
        '  *rate_limit*) echo 4000 ;;',
        `  *"/issues?state=all"*) printf '%s\\n' '{"number":5,"title":"hello","body":"write to ${OWNER_ADDRESS}"}' ;;`,
        "  *) ;;",
        "esac",
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    const result = run(scratch.dir, "bash", [SCAN, "--url", publicBare, "--state", state, "--github"], { env: cleanEnv({ PATH: `${bin}:${process.env.PATH}` }) });
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/^issue#5:body:1: relational\/l01 line_sha256=/mu);
    const calls = readFileSync(log, "utf8").trim().split("\n");
    expect(calls.every((call) => call.startsWith("api --method GET "))).toBe(true);
    expect(existsSync(join(state, "github-since"))).toBe(false);
    // A scan without its private terms refuses to run at all.
    const bare = join(scratch.dir, "no-guard");
    mkdirSync(join(bare, "private/bin"), { recursive: true });
    for (const path of ["private/bin/scan-public.sh", "private/public-repository.ts"]) writeFileSync(join(bare, path), readFileSync(join(fixture.repo, path)));
    const missing = run(scratch.dir, "bash", [join(bare, "private/bin/scan-public.sh"), "--url", publicBare, "--state", join(scratch.dir, "state-2")]);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("refuses to run without it");
  });

  test("it prints a LaunchAgent for a daily run and installs nothing", () => {
    const plist = scan("--print-launchd-plist");
    expect(plist.status).toBe(0);
    expect(plist.stdout).toContain("<key>StartCalendarInterval</key>");
    expect(plist.stdout).toContain(SCAN);
  });
});

describe("public-clone.sh", () => {
  const CLONE = join(fixture.repo, "private/bin/public-clone.sh");
  const hooks = join(scratch.dir, "pinned-hooks");
  mkdirSync(hooks, { recursive: true });
  writeFileSync(join(hooks, "pre-push"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  const clone = (dir: string, ...args: string[]) =>
    run(scratch.dir, "bash", [CLONE, "--dir", dir, "--url", publicBare, "--hooks", hooks, "--gitleaks", "none", "--name", "maintainer", ...args]);

  test("clones fresh with a repo-local public identity, pinned hooks, and the guard settings", () => {
    const dir = join(scratch.dir, "dev-clone");
    const result = clone(dir, "--email", "12345+maintainer@users.noreply.github.com");
    expect(result.status, result.out).toBe(0);
    const config = (key: string) => git(dir, "config", "--get", key);
    expect(config("user.email")).toBe("12345+maintainer@users.noreply.github.com");
    expect(config("author.email")).toBe("12345+maintainer@users.noreply.github.com");
    expect(config("committer.email")).toBe("12345+maintainer@users.noreply.github.com");
    expect(config("user.useConfigOnly")).toBe("true");
    expect(config("core.hooksPath")).toBe(hooks);
    expect(config("publicguard.root")).toBe(P0);
    expect(config("publicguard.privateGuard")).toBe(join(fixture.repo, "private/guard"));
    expect(git(dir, "remote")).toBe("origin");
    // An existing path is never reused.
    expect(clone(dir, "--email", "noreply@github.com").status).toBe(1);
  });

  test("refuses a private address, a missing hook directory, and a history with another root", () => {
    const refused = clone(join(scratch.dir, "c2"), "--email", "dev@laptop.invalid");
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("not a public one");
    const noHooks = run(scratch.dir, "bash", [CLONE, "--dir", join(scratch.dir, "c3"), "--url", publicBare, "--gitleaks", "none", "--name", "m", "--email", "noreply@github.com"], {
      env: cleanEnv({ AGENTTOOL_GUARD_PIN_ROOT: join(scratch.dir, "no-pins") }),
    });
    expect(noHooks.status).toBe(1);
    expect(noHooks.stderr).toContain("run private/bin/install-guards.sh first");
    const wrongRoot = clone(join(scratch.dir, "c4"), "--email", "noreply@github.com", "--root", "f".repeat(40));
    expect(wrongRoot.status).toBe(1);
    expect(wrongRoot.stderr).toContain("root is not the public root");
  });
});

describe("the settings plan (never applied here)", () => {
  test("allows exactly the shared workflows' actions and requires the shared CI's checks", () => {
    expect(allowedActionPatterns()).toEqual(["actions/checkout@*", "actions/setup-node@*", "actions/setup-python@*", "astral-sh/setup-uv@*", "oven-sh/setup-bun@*"]);
    const checks = requiredChecks();
    expect(checks).toContain("Shared-tree guard");
    expect(checks).toContain("Maintainer commit identity");
    expect(checks.some((check) => check.includes("${{"))).toBe(false);
    const plan = settingsPlan({ maintainers: ["maintainer-one"] });
    expect(plan.every((request) => request.endpoint.startsWith(`repos/${PUBLIC_REPOSITORY}`))).toBe(true);
    expect(plan[0]).toMatchObject({ method: "GET" });
    expect(plan.find((request) => request.endpoint.endsWith("/actions/permissions/workflow"))?.body).toEqual({ default_workflow_permissions: "read", can_approve_pull_request_reviews: false });
    expect(plan.find((request) => request.endpoint.endsWith("/actions/permissions"))?.body).toMatchObject({ sha_pinning_required: true, allowed_actions: "selected" });
  });

  test("plan mode sends nothing, and apply refuses without the typed confirmation", () => {
    const bin = join(scratch.dir, "settings-gh");
    mkdirSync(bin, { recursive: true });
    const log = join(scratch.dir, "settings-gh.log");
    writeFileSync(join(bin, "gh"), `#!/bin/sh\necho called >> ${JSON.stringify(log)}\nexit 1\n`, { mode: 0o755 });
    const env = cleanEnv({ PATH: `${bin}:${process.env.PATH}`, GH: join(bin, "gh") });
    const settings = join(ROOT, "private/bin/public-settings.ts");
    const plan = run(scratch.dir, process.execPath, [settings, "--plan"], { env });
    expect(plan.status).toBe(0);
    expect(plan.stderr).toContain("nothing was sent");
    const apply = run(scratch.dir, process.execPath, [settings, "--apply", "--maintainers", "maintainer-one"], { env });
    expect(apply.status).toBe(2);
    expect(apply.stderr).toContain("to confirm; nothing was sent");
    expect(existsSync(log)).toBe(false);
  });
});
