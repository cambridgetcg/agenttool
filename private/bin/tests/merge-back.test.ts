/**
 * merge-back.sh end to end on scratch repositories (plan 2.3-2.5): the
 * adoption merge, merge bases from `git merge-base`, real three-way merges,
 * drift (including an add under a shared tree, critic MUST 2), collisions,
 * the incoming scan, the root check, the gate, and the atomic push through
 * the installed private pre-push.
 */
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assertSharedScope, projectPublic, ProjectionRefused } from "../../../bin/project-public.ts";
import { runExport } from "../public-export.ts";
import { guardSensitive } from "../reviewed-shared.ts";
import { cleanEnv, commitAll, commitStaged, git, makePrivateRepo, publicCommit, run, scratchDir, stubGitleaks, TERM, write } from "./fixtures.ts";

setDefaultTimeout(240_000);
const scratch = scratchDir("merge");
afterAll(() => {
  run(scratch.dir, "chmod", ["-R", "u+w", scratch.dir]);
  scratch.cleanup();
});

const fixture = makePrivateRepo(scratch.dir);
const origin = join(scratch.dir, "private-origin.git");
git(scratch.dir, "clone", "-q", "--bare", fixture.repo, origin);
const dev = join(scratch.dir, "private-dev");
git(scratch.dir, "clone", "-q", origin, dev);

// P0: exported as files from origin/main, committed with the public identity.
const publicBare = join(scratch.dir, "public.git");
git(scratch.dir, "init", "-q", "--bare", "--initial-branch=main", publicBare);
const root = join(scratch.dir, "public-root");
runExport({ mode: "init", repo: dev, source: "origin/main", into: root, guardDir: join(dev, "private/guard"), gitleaks: stubGitleaks(scratch.dir), commit: true });
git(root, "push", "-q", publicBare, "HEAD:refs/heads/main");
const P0 = git(root, "rev-parse", "HEAD");

// The merge clone and the adoption merge (plan 2.3).
const merge = join(scratch.dir, "merge-clone");
git(scratch.dir, "clone", "-q", origin, merge);
for (const [key, value] of [
  ["user.name", "Merge Agent"],
  ["user.email", "merge@private.invalid"],
  ["agenttool.mergeClone", "true"],
  ["remote.public.url", publicBare],
  ["remote.public.fetch", "+refs/heads/*:refs/remotes/public/*"],
  ["remote.public.pushurl", "file:///dev/null/public-is-fetch-only"],
  ["remote.public.tagOpt", "--no-tags"],
]) git(merge, "config", key as string, value as string);
git(merge, "fetch", "-q", "public");

const pdev = join(scratch.dir, "public-dev");
git(scratch.dir, "clone", "-q", publicBare, pdev);
git(pdev, "config", "user.name", "AgentTool");
git(pdev, "config", "user.email", "contact@cambridgetcg.com");

const MERGE_BACK = join(merge, "private/bin/merge-back.sh");
// The gate runs in sandbox-exec on macOS. Where sandbox-exec cannot apply a
// profile (another OS, or these tests already running inside the real
// merge-back gate's sandbox, which cannot nest), they opt out explicitly.
const SANDBOXED = process.platform === "darwin" && spawnSync("sandbox-exec", ["-p", "(version 1)(allow default)", "/usr/bin/true"]).status === 0;
const SANDBOX = SANDBOXED ? [] : ["--unsandboxed-gate"];
const mergeBack = (args: string[] = [], env: Record<string, string> = {}) =>
  run(merge, "bash", [MERGE_BACK, ...SANDBOX, ...args], { env: cleanEnv({ AGENTTOOL_MERGE_BACK_GATE: "true", ...env }) });
/** A public change, merged to public main as a pull request would be. */
function publicChange(files: Record<string, string | null>, message = "public change"): string {
  git(pdev, "pull", "-q", "--ff-only");
  for (const [path, content] of Object.entries(files)) {
    if (content === null) git(pdev, "rm", "-q", path);
    else write(pdev, path, content);
  }
  const tip = publicCommit(pdev, message);
  git(pdev, "push", "-q", "origin", "HEAD:main");
  return tip;
}
function privateChange(files: Record<string, string | null>, message = "private change"): string {
  git(dev, "pull", "-q", "--ff-only");
  for (const [path, content] of Object.entries(files)) {
    if (content === null) git(dev, "rm", "-q", path);
    else write(dev, path, content);
  }
  const tip = commitAll(dev, message);
  git(dev, "push", "-q", "origin", "HEAD:main");
  return tip;
}

describe("the adoption merge", () => {
  test("refuses a differing P0 (the subset check can fail) and keeps the tree when it passes", () => {
    expect(git(merge, "diff", "--no-renames", "--name-only", "--diff-filter=DMT", P0, "origin/main")).toBe("");
    // Negative control: a root whose README differs is caught.
    const differing = run(merge, "git", ["hash-object", "-w", "--stdin"], { input: "different\n" }).stdout.trim();
    const tree = run(merge, "git", ["mktree"], { input: `100644 blob ${differing}\tREADME.md\n` }).stdout.trim();
    const bad = run(merge, "git", ["commit-tree", tree, "-m", "bad"], { env: cleanEnv({ GIT_AUTHOR_NAME: "x", GIT_AUTHOR_EMAIL: "x@x.invalid", GIT_COMMITTER_NAME: "x", GIT_COMMITTER_EMAIL: "x@x.invalid" }) }).stdout.trim();
    expect(git(merge, "diff", "--no-renames", "--name-only", "--diff-filter=DMT", bad, "origin/main")).toBe("README.md");
    const before = git(merge, "rev-parse", "origin/main^{tree}");
    git(merge, "switch", "-q", "-C", "adopt", "origin/main");
    git(merge, "merge", "-q", "--allow-unrelated-histories", "-s", "ours", "-m", `Adopt public root ${P0.slice(0, 12)}`, P0);
    expect(git(merge, "rev-parse", "HEAD^{tree}")).toBe(before);
    write(merge, "private/export/public-root.txt", `${P0}\n`);
    git(merge, "add", "private/export/public-root.txt");
    git(merge, "commit", "-q", "-m", "Record the public root");
    git(merge, "push", "-q", "--atomic", "origin", "HEAD:refs/heads/main", `${P0}:refs/heads/public-sync`);
    git(merge, "fetch", "-q", "origin");
    git(merge, "switch", "-q", "--detach", "origin/main");
    expect(git(merge, "merge-base", "origin/main", "public/main")).toBe(P0);
    expect(run(merge, "git", ["merge-base", "--is-ancestor", fixture.head, "origin/main"]).status).toBe(0);
    expect(run(merge, "git", ["push", "public", "HEAD:refs/heads/leak"]).status).not.toBe(0);
  });
});

describe("merge-back cycles", () => {
  test("nothing new is a no-op; it runs only in the merge clone", () => {
    const result = mergeBack();
    expect(result.status, result.out).toBe(0);
    expect(result.stdout).toContain("up to date");
    const elsewhere = run(dev, "bash", [join(dev, "private/bin/merge-back.sh")], { env: cleanEnv({ AGENTTOOL_MERGE_BACK_GATE: "true" }) });
    expect(elsewhere.status).toBe(2);
    expect(elsewhere.stderr).toContain("dedicated merge clone");
  });

  test("cycle 1: base P0, a real three-way merge that applies public adds, edits, and deletes; dry by default", () => {
    privateChange({ "private/notes.md": "private notes, edited\n", "bin/private-tool.ts": "export const v = 2;\n" });
    const pub = publicChange({ "packages/alpha/index.ts": "export const alpha = 2;\n", "packages/alpha/c.ts": "export const c = 1;\n", "packages/alpha/run.sh": null });
    const originBefore = git(origin, "rev-parse", "main");
    const dry = mergeBack();
    expect(dry.status, dry.out).toBe(0);
    expect(dry.stdout).toContain("would push");
    expect(git(origin, "rev-parse", "main")).toBe(originBefore);
    const pushed = mergeBack(["--push"]);
    expect(pushed.status, pushed.out).toBe(0);
    expect(pushed.stdout).toContain(`base ${P0.slice(0, 12)}`);
    expect(git(origin, "rev-parse", "public-sync")).toBe(pub);
    git(dev, "pull", "-q", "--ff-only");
    expect(readFileSync(join(dev, "packages/alpha/index.ts"), "utf8")).toBe("export const alpha = 2;\n");
    expect(existsSync(join(dev, "packages/alpha/run.sh"))).toBe(false);
    expect(readFileSync(join(dev, "private/notes.md"), "utf8")).toBe("private notes, edited\n");
    expect(run(dev, "git", ["merge-base", "--is-ancestor", pub, "HEAD"]).status).toBe(0);
    expect(mergeBack().stdout).toContain("up to date");
  });

  test("an add under a shared tree in this repository is drift, and so is an edit; reverting clears it", () => {
    privateChange({ "packages/alpha/private-only.test.ts": "test\n" }, "an R-side add under a shared tree");
    publicChange({ "docs/spec.md": "# Spec v2\n" });
    const add = mergeBack();
    expect(add.status).toBe(4);
    expect(add.stdout).toBe("added\tpackages/alpha/private-only.test.ts\n");
    privateChange({ "packages/alpha/private-only.test.ts": null, "README.md": "# Edited in the private repository\n" });
    const edit = mergeBack();
    expect(edit.status).toBe(4);
    expect(edit.stdout).toBe("changed\tREADME.md\n");
    git(dev, "pull", "-q", "--ff-only");
    git(dev, "checkout", "-q", "origin/public-sync", "--", "README.md");
    commitAll(dev, "revert the shared edit");
    git(dev, "push", "-q", "origin", "HEAD:main");
    const clean = mergeBack(["--push"]);
    expect(clean.status, clean.out).toBe(0);
  });

  test("an upstream fix that already equals the public bytes is not drift", () => {
    privateChange({ "packages/alpha/c.ts": "export const c = 2;\n" }, "a fix before it was upstreamed");
    publicChange({ "packages/alpha/c.ts": "export const c = 2;\n" }, "the same fix, upstreamed");
    const result = mergeBack(["--push"]);
    expect(result.status, result.out).toBe(0);
  });

  test("a public add over a private-only path is a collision; relocating it under private/ clears it", () => {
    publicChange({ "bin/private-tool.ts": "export const publicVersion = 1;\n" });
    const collision = mergeBack();
    expect(collision.status).toBe(4);
    expect(collision.stdout).toBe("collision\tbin/private-tool.ts\n");
    git(dev, "pull", "-q", "--ff-only");
    git(dev, "mv", "bin/private-tool.ts", "private/bin-private-tool.ts");
    commitAll(dev, "relocate under private/");
    git(dev, "push", "-q", "origin", "HEAD:main");
    const merged = mergeBack(["--push"]);
    expect(merged.status, merged.out).toBe(0);
  });

  test("a public move of a directory that still holds a private file stops the merge; nothing is pushed", () => {
    // Relocate before widening (I5): a private file left in a directory the public side moves cannot merge cleanly.
    privateChange({ "docs/private-notes.md": "scattered private notes\n" });
    git(pdev, "pull", "-q", "--ff-only");
    publicChange({ "specs/spec.md": readFileSync(join(pdev, "docs/spec.md"), "utf8"), "docs/spec.md": null }, "move the spec");
    const before = git(origin, "rev-parse", "main");
    const result = mergeBack(["--push"]);
    expect([5, 6], result.out).toContain(result.status);
    expect(git(origin, "rev-parse", "main")).toBe(before);
    expect(git(merge, "status", "--porcelain")).toBe("");
    privateChange({ "docs/private-notes.md": null, "private/docs/private-notes.md": "scattered private notes\n" }, "relocate under private/");
    const merged = mergeBack(["--push"]);
    expect(merged.status, merged.out).toBe(0);
  });

  test("the incoming scan refuses a public range that carries a relational term; nothing merges", () => {
    const before = git(origin, "rev-parse", "main");
    const good = git(pdev, "rev-parse", "HEAD");
    publicChange({ "packages/alpha/note.md": `a ${TERM}\n` });
    const result = mergeBack(["--push"]);
    expect(result.status).toBe(3);
    expect(result.out.toLowerCase()).not.toContain(TERM);
    expect(git(origin, "rev-parse", "main")).toBe(before);
    // The owner rewrites public main (a ruleset bypass); the next run is up to date again.
    git(pdev, "reset", "-q", "--hard", good);
    git(pdev, "push", "-q", "--force", "origin", "HEAD:main");
    expect(mergeBack().stdout).toContain("up to date");
  });

  test("a second root in public main, or a rewritten public main, stops before anything else", () => {
    const good = git(pdev, "rev-parse", "HEAD");
    git(pdev, "switch", "-q", "--orphan", "other");
    write(pdev, "other.md", "another root\n");
    publicCommit(pdev, "another root");
    git(pdev, "switch", "-q", "main");
    git(pdev, "merge", "-q", "--allow-unrelated-histories", "--no-edit", "other");
    git(pdev, "push", "-q", "origin", "HEAD:main");
    const twoRoots = mergeBack();
    expect(twoRoots.status).toBe(2);
    expect(twoRoots.stderr).toContain("only root");
    git(pdev, "reset", "-q", "--hard", `${P0}`);
    write(pdev, "x.md", "rewritten\n");
    publicCommit(pdev, "rewritten history");
    git(pdev, "push", "-q", "--force", "origin", "HEAD:main");
    const rewound = mergeBack();
    expect(rewound.status).toBe(2);
    expect(rewound.stderr).toContain("does not descend from the last merged public tip");
    git(pdev, "reset", "-q", "--hard", good);
    git(pdev, "push", "-q", "--force", "origin", "HEAD:main");
    git(pdev, "branch", "-q", "-D", "other");
  });

  test("a failing private gate stops before the push; a private-only fix on the merge branch is carried with --resume", () => {
    const before = git(origin, "rev-parse", "main");
    const pub = publicChange({ "packages/alpha/gate.ts": "export {};\n" });
    const result = mergeBack(["--push"], { AGENTTOOL_MERGE_BACK_GATE: "false" });
    expect(result.status).toBe(7);
    expect(result.stderr).toContain("WARNING: AGENTTOOL_MERGE_BACK_GATE replaces the private gate");
    expect(git(origin, "rev-parse", "main")).toBe(before);
    // The fix: a private-only path, committed on the merge branch the stop left checked out.
    const branch = `merge-back/${pub.slice(0, 12)}`;
    expect(git(merge, "rev-parse", "--abbrev-ref", "HEAD")).toBe(branch);
    write(merge, "private/gate-fix.md", "the private overlay follows the public change\n");
    commitAll(merge, "fix the private overlay for the public change");
    // A rerun without --resume never discards the fix silently.
    const discard = mergeBack(["--push"]);
    expect(discard.status).toBe(2);
    expect(discard.stderr).toContain("rerun with --resume");
    // A fix that touches a shared path is refused at the tip.
    write(merge, "packages/alpha/gate.ts", "export const sneaky = 1;\n");
    commitAll(merge, "a shared edit on the merge branch", undefined, { ALLOW_SHARED_EDIT: "1" });
    const shared = mergeBack(["--push", "--resume"]);
    expect(shared.status).toBe(6);
    git(merge, "reset", "-q", "--hard", "HEAD~1");
    const resumed = mergeBack(["--push", "--resume"]);
    expect(resumed.status, resumed.out).toBe(0);
    git(dev, "pull", "-q", "--ff-only");
    expect(readFileSync(join(dev, "private/gate-fix.md"), "utf8")).toContain("private overlay");
    expect(git(origin, "rev-parse", "public-sync")).toBe(pub);
  });

  test("nothing the gate changes reaches the push or the next run: files are restored, a config change stops it", () => {
    const before = git(origin, "rev-parse", "main");
    publicChange({ "packages/alpha/gated.ts": "export {};\n" });
    // A gate that rewrites a tracked script and leaves an untracked bun config behind.
    const edits = mergeBack(["--push"], { AGENTTOOL_MERGE_BACK_GATE: "printf '# changed\\n' >>private/bin/merge-back.sh && printf 'preload = []\\n' >bunfig.toml" });
    expect(edits.status, edits.out).toBe(7);
    expect(edits.stderr).toContain("changed tracked or untracked files (now restored");
    expect(git(merge, "status", "--porcelain", "--untracked-files=all")).toBe("");
    expect(git(origin, "rev-parse", "main")).toBe(before);
    // A gate that edits this clone's git config: the sandbox denies the write;
    // without one the change is found and nothing is pushed.
    const config = mergeBack(["--push"], { AGENTTOOL_MERGE_BACK_GATE: "git config merge-back.probe 1" });
    expect(config.status).toBe(7);
    if (SANDBOXED) expect(run(merge, "git", ["config", "--get", "merge-back.probe"]).status).toBe(1);
    else {
      expect(config.stderr).toContain("changed this clone's git config");
      git(merge, "config", "--unset", "merge-back.probe");
    }
    expect(git(origin, "rev-parse", "main")).toBe(before);
    if (SANDBOXED) {
      // No writes under the home directory or anywhere else outside the clone and the gate's scratch.
      const probe = join(process.env.HOME ?? "/nonexistent", `.merge-back-gate-probe-${process.pid}`);
      const home = mergeBack(["--push"], { AGENTTOOL_MERGE_BACK_GATE: `touch '${probe}'` });
      expect(home.status).toBe(7);
      expect(existsSync(probe)).toBe(false);
      const elsewhere = join(scratch.dir, "outside-the-clone");
      expect(mergeBack(["--push"], { AGENTTOOL_MERGE_BACK_GATE: `touch '${elsewhere}'` }).status).toBe(7);
      expect(existsSync(elsewhere)).toBe(false);
      // No reads under the home directory but the clone: a credential file stays unreadable.
      const fakeHome = join(scratch.dir, "fake-home");
      write(fakeHome, ".fly/config.yml", "access_token: fixture\n");
      expect(mergeBack(["--push"], { HOME: fakeHome, AGENTTOOL_MERGE_BACK_GATE: `head -c 1 '${fakeHome}/.fly/config.yml'` }).status).toBe(7);
      // No network: no address but loopback, and no name resolution at all.
      expect(mergeBack(["--push"], { AGENTTOOL_MERGE_BACK_GATE: "curl -sS -m 5 -o /dev/null https://example.com" }).status).toBe(7);
      expect(mergeBack(["--push"], { AGENTTOOL_MERGE_BACK_GATE: "nc -z -G 3 1.1.1.1 443" }).status).toBe(7);
      expect(mergeBack(["--push"], { AGENTTOOL_MERGE_BACK_GATE: `perl -MSocket -e 'exit(defined(scalar gethostbyname("example.com")) ? 0 : 1)'` }).status).toBe(7);
      // On loopback, a server that was listening before the gate is out of reach; one the gate starts is not.
      const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
      try {
        expect(mergeBack(["--push"], { AGENTTOOL_MERGE_BACK_GATE: `nc -z -G 3 127.0.0.1 ${listener.port}` }).status).toBe(7);
      } finally {
        listener.stop(true);
      }
      const own = 'bun -e \'const s = Bun.serve({ hostname: "localhost", port: 0, fetch: () => new Response("ok") }); const r = await fetch(`http://localhost:${s.port}/`); s.stop(true); process.exit((await r.text()) === "ok" ? 0 : 1);\'';
      const served = mergeBack([], { AGENTTOOL_MERGE_BACK_GATE: own });
      expect(served.status, served.out).toBe(0);
    }
    // The gate gets only a short environment: no ambient secret, and HOME,
    // TMPDIR and npm's cache (npm pack writes one) in a scratch directory
    // outside the account's home, removed after the gate.
    const realHome = process.env.HOME ?? "/nonexistent";
    const envProbe =
      'test -z "${AGENTTOOL_GATE_PROBE_SECRET:-}" && test -z "${FLY_API_TOKEN:-}" && ' +
      `test "$HOME" != '${realHome}' && case "$HOME" in '${realHome}'/*) exit 1 ;; esac && ` +
      'test -d "$TMPDIR" && test -n "$npm_config_cache" && test -d "$npm_config_cache" && touch "$npm_config_cache/probe" && ' +
      'echo "gate-npm-cache=$npm_config_cache"';
    const passed = mergeBack(["--push"], { AGENTTOOL_MERGE_BACK_GATE: envProbe, AGENTTOOL_GATE_PROBE_SECRET: "fixture", FLY_API_TOKEN: "fixture" });
    expect(passed.status, passed.out).toBe(0);
    const cache = /gate-npm-cache=(\S+)/u.exec(passed.out)?.[1];
    expect(cache).toBeDefined();
    expect(existsSync(cache as string)).toBe(false);
  });

  test("the gate profile lets the clone's parent directories be listed and their package.json read, and nothing else above it in the home directory", () => {
    const script = `eval "$(sed -n '/^gate_profile() {/,/^}/p' '${MERGE_BACK}')"; gate_profile /h/me/work/clone /h/me /h/me/work/clone/.git /h/me/repo/.git /t/gate 5432 80`;
    const profile = run(scratch.dir, "bash", ["-c", script]).stdout;
    const allowed = /^\(allow file-read\* (.*)\)$/mu.exec(profile)?.[1] ?? "";
    expect(allowed).toBe(
      '(subpath "/h/me/work/clone") (subpath "/h/me/repo/.git") (subpath "/t/gate") (subpath "/h/me/.bun")' +
        ' (literal "/h/me/work") (literal "/h/me/work/package.json") (literal "/h/me") (literal "/h/me/package.json")' +
        ' (literal "/h/me/repo") (literal "/h/me/repo/package.json") (literal "/h/me") (literal "/h/me/package.json")',
    );
    expect(profile).toContain('(deny file-read* (subpath "/h/me"))');
    expect(profile).toContain('(deny network-outbound (remote ip "localhost:5432") (remote ip "localhost:80"))');
    // Temporary directories: only new agenttool-*, .agenttool-*, tmp.* and zerone-* entries, the paths regex-escaped.
    const temps = run(scratch.dir, "bash", ["-c", script], { env: cleanEnv({ GATE_TEMP_DIRS: "/private/tmp\n/v.x/T" }) }).stdout;
    expect(temps).toContain('(regex #"^/private/tmp/(agenttool-|\\.agenttool-|tmp\\.|zerone-)")');
    expect(temps).toContain('(regex #"^/v\\.x/T/(agenttool-|\\.agenttool-|tmp\\.|zerone-)")');
  });

  test("a public change to the guard tooling stops (exit 9) until the owner accepts that exact tip; the acceptance records new digests", () => {
    const before = git(origin, "rev-parse", "main");
    const canaries = readFileSync(join(pdev, "tools/leak-canaries.txt"), "utf8");
    const pub = publicChange({ "tools/leak-canaries.txt": `${canaries}# a public note\n`, ".github/workflows/ci.yml": readFileSync(join(pdev, ".github/workflows/ci.yml"), "utf8").replace("name: ci", "name: ci-renamed") });
    const stopped = mergeBack(["--push"]);
    expect(stopped.status).toBe(9);
    expect(stopped.stdout).toBe(".github/workflows/ci.yml\ntools/leak-canaries.txt\n");
    expect(git(origin, "rev-parse", "main")).toBe(before);
    expect(mergeBack(["--push", "--accept-guard-change", "0".repeat(40)]).status).toBe(9);
    const accepted = mergeBack(["--push", "--accept-guard-change", pub]);
    expect(accepted.status, accepted.out).toBe(0);
    git(dev, "pull", "-q", "--ff-only");
    expect(git(dev, "log", "-1", "--format=%s")).toBe(`Accept reviewed shared guard files from public ${pub.slice(0, 12)}`);
    const check = run(dev, process.execPath, [join(dev, "private/bin/reviewed-shared.ts"), "check"]);
    expect(check.status, check.out).toBe(0);
  });

  test("guard-sensitive paths: the reviewed files, hooks, attributes, workflows, and any Bun or TypeScript config, in any letter case", () => {
    for (const path of ["tools/public-guard.ts", "Tools/Public-Guard.ts", "tools/githooks/post-merge", ".gitattributes", ".github/dependabot.yml", "bunfig.toml", "packages/alpha/bunfig.toml", "packages/alpha/.bunfig.toml", "tsconfig.json", "bin/TSConfig.json", "packages/alpha/jsconfig.json"]) {
      expect(guardSensitive(path), path).toBe(true);
    }
    for (const path of ["tools/public-guard-allow.json", "packages/alpha/index.ts", "docs/bunfig.md", "README.md", "packages/alpha/tsconfig.base.json"]) expect(guardSensitive(path), path).toBe(false);
  });

  test("a public path that differs only in case from a private one stops before merging (APFS would overwrite it)", () => {
    privateChange({ "apps/web/index.html": "private page\n" });
    const good = git(pdev, "rev-parse", "HEAD");
    publicChange({ "Apps/web/index.html": "public page\n" });
    const before = git(origin, "rev-parse", "main");
    const result = mergeBack(["--push"]);
    expect(result.status).toBe(5);
    expect(result.stdout).toContain("case collision\tApps");
    expect(git(origin, "rev-parse", "main")).toBe(before);
    git(pdev, "reset", "-q", "--hard", good);
    git(pdev, "push", "-q", "--force", "origin", "HEAD:main");
    expect(mergeBack().stdout).toContain("up to date");
  });

  test("the projection refuses a source that adds under a shared tree, once the source records the public root (MUST 2, release side)", () => {
    privateChange({ "packages/alpha/r-side-added.test.ts": "test\n" }, "an R-side add under a shared tree");
    git(merge, "fetch", "-q", "origin");
    let refused: unknown;
    try {
      projectPublic({ repo: merge, source: "origin/main", noWrite: true, allowUnmergedSource: true, gitleaks: stubGitleaks(scratch.dir) });
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(ProjectionRefused);
    expect((refused as ProjectionRefused).findings.map((finding) => `${finding.rule} ${finding.path}`)).toEqual(["path/shared-scope-added packages/alpha/r-side-added.test.ts"]);
    privateChange({ "packages/alpha/r-side-added.test.ts": null }, "revert the R-side add");
    git(merge, "fetch", "-q", "origin");
    // (This fixture's allowlist names docs/spec.md, which an earlier public change moved, so only the scope check is run here.)
    expect(() => assertSharedScope(merge, git(merge, "rev-parse", "origin/main"))).not.toThrow();
    // Without public-sync the check fails closed.
    expect(() => assertSharedScope(merge, git(merge, "rev-parse", "origin/main"), "refs/remotes/origin/missing")).toThrow("fetch it first");
  });

  test("an allowlist narrowing that reached main without a hook hides nothing: the projection and merge-back still see an add under it (G3)", () => {
    // Pushed from a checkout without hooks, as a web edit or a pull request merged on GitHub would land.
    git(dev, "pull", "-q", "--ff-only");
    const allowlist = JSON.parse(readFileSync(join(dev, "private/projection/allowlist.json"), "utf8")) as { export: { exclude: Array<{ path: string; reason: string }> } };
    allowlist.export.exclude.unshift({ path: "packages/alpha/extra", reason: "a narrowing no one approved" });
    privateChange({ "private/projection/allowlist.json": `${JSON.stringify(allowlist, null, 2)}\n`, "packages/alpha/extra/r-only.ts": "export {};\n" }, "narrow the scope and add under it");
    git(merge, "fetch", "-q", "origin");
    const source = git(merge, "rev-parse", "origin/main");
    let refused: unknown;
    try {
      projectPublic({ repo: merge, source, noWrite: true, allowUnmergedSource: true, gitleaks: stubGitleaks(scratch.dir) });
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(ProjectionRefused);
    expect((refused as ProjectionRefused).findings.map((finding) => `${finding.rule} ${finding.path}`)).toEqual(["path/shared-scope-added packages/alpha/extra/r-only.ts"]);
    expect(() => assertSharedScope(merge, source, undefined, { allowScopeChange: true })).not.toThrow();
    // merge-back sees the add as drift until a run with the owner's go records the narrowing.
    publicChange({ "packages/alpha/later.ts": "export const later = 1;\n" });
    const before = git(origin, "rev-parse", "main");
    const stopped = mergeBack(["--push"]);
    expect(stopped.status, stopped.out).toBe(4);
    expect(stopped.stdout).toContain("added\tpackages/alpha/extra/r-only.ts");
    expect(git(origin, "rev-parse", "main")).toBe(before);
    const recorded = mergeBack(["--push"], { ALLOW_SCOPE_CHANGE: "1" });
    expect(recorded.status, recorded.out).toBe(0);
    git(merge, "fetch", "-q", "origin");
    expect(() => assertSharedScope(merge, git(merge, "rev-parse", "origin/main"))).not.toThrow();
    // A source that contains the public root but dropped its record is refused, not skipped.
    git(merge, "switch", "-q", "--detach", "origin/main");
    git(merge, "rm", "-q", "private/export/public-root.txt");
    const dropped = commitStaged(merge, "drop the public root record");
    expect(() => assertSharedScope(merge, dropped)).toThrow("lacks private/export/public-root.txt");
    git(merge, "switch", "-q", "--detach", "origin/main");
  });

  test("with the installed private hooks, the atomic push passes the pre-push drift check against the new public-sync", () => {
    const install = run(merge, "bash", [join(merge, "private/bin/install-guards.sh"), "--rev", "origin/main", "--pin-root", join(scratch.dir, "pins"), "--private", merge]);
    expect(install.status, install.out).toBe(0);
    const result = mergeBack(["--push"]);
    expect(result.status, result.out).toBe(0);
    expect(git(origin, "rev-parse", "public-sync")).toBe(git(pdev, "rev-parse", "HEAD"));
    // And the hook still refuses a drifting main pushed from the merge clone.
    git(merge, "switch", "-q", "--detach", "origin/main");
    write(merge, "packages/alpha/sneaky.ts", "export {};\n");
    git(merge, "add", "-A");
    expect(run(merge, "git", ["commit", "-q", "-m", "sneaky"], { env: cleanEnv() }).status).toBe(1);
    run(merge, "git", ["commit", "-q", "-m", "sneaky"], { env: cleanEnv({ ALLOW_SHARED_EDIT: "1" }) });
    const sneaky = run(merge, "git", ["push", "-q", "origin", "HEAD:main"]);
    expect(sneaky.status).not.toBe(0);
    expect(sneaky.out).toContain("added\tpackages/alpha/sneaky.ts");
    git(merge, "switch", "-q", "--detach", "origin/main");
  });
});
