/**
 * The installed hooks, end to end in scratch repositories: install-guards.sh
 * pins them, the private repository's pre-commit and pre-push refuse shared
 * edits and adds (critic MUST 2) and pushes to the public repository, and the
 * public clone's pre-push fails closed. Nothing here touches this machine's
 * real checkouts or hook settings.
 */
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PUBLIC_REPOSITORY } from "../../public-repository.ts";
import { runExport } from "../public-export.ts";
import { exportMatcher, readExportConfig } from "../shared-scope.ts";
import { cleanEnv, commitAll, commitStaged, git, makePrivateRepo, OWNER_ADDRESS, publicCommit, run, scopedTip, scratchDir, stubGitleaks, TERM, write } from "./fixtures.ts";

setDefaultTimeout(180_000);
const scratch = scratchDir("hooks");
afterAll(() => {
  // The pinned copy is read-only by design; make it removable.
  run(scratch.dir, "chmod", ["-R", "u+w", scratch.dir]);
  scratch.cleanup();
});

const fixture = makePrivateRepo(scratch.dir);
const origin = join(scratch.dir, "private-origin.git");
git(scratch.dir, "clone", "-q", "--bare", fixture.repo, origin);
const dev = join(scratch.dir, "private-dev");
git(scratch.dir, "clone", "-q", origin, dev);
const inScope = exportMatcher(readExportConfig(dev, "HEAD"));
const p0 = scopedTip(dev, "HEAD", inScope);
// The adoption merge (plan 2.3): main contains P0 and records it.
git(dev, "-c", "user.name=Dev", "-c", "user.email=dev@private.invalid", "merge", "-q", "--allow-unrelated-histories", "-s", "ours", "-m", "Adopt the public root", p0);
write(dev, "private/export/public-root.txt", `${p0}\n`);
commitAll(dev, "record the public root");
git(dev, "push", "-q", "--atomic", origin, "HEAD:refs/heads/main", `${p0}:refs/heads/public-sync`);
git(dev, "fetch", "-q", "origin");

// The public side: P0 exported as files, pushed to a bare "GitHub".
const publicBare = join(scratch.dir, "public.git");
git(scratch.dir, "init", "-q", "--bare", "--initial-branch=main", publicBare);
const exported = join(scratch.dir, "public-root");
runExport({ mode: "init", repo: fixture.repo, source: "HEAD", into: exported, guardDir: fixture.guardDir, allowUnmergedSource: true, gitleaks: stubGitleaks(scratch.dir), commit: true });
git(exported, "push", "-q", publicBare, "HEAD:refs/heads/main");
const publicRoot = git(exported, "rev-parse", "HEAD");
const clone = join(scratch.dir, "public-dev");
git(scratch.dir, "clone", "-q", publicBare, clone);
for (const [key, value] of [
  ["user.name", "AgentTool"],
  ["user.email", "contact@cambridgetcg.com"],
  ["publicguard.root", publicRoot],
  ["publicguard.privateGuard", join(dev, "private/guard")],
  ["publicguard.gitleaks", "none"],
]) git(clone, "config", key as string, value as string);

const pinRoot = join(scratch.dir, "pins");
const INSTALL = join(dev, "private/bin/install-guards.sh");
const install = (...args: string[]) => run(dev, "bash", [INSTALL, "--rev", "HEAD", "--pin-root", pinRoot, ...args]);

describe("install-guards.sh", () => {
  test("a dry run changes nothing", () => {
    const dry = install("--private", dev, "--public", clone, "--dry-run");
    expect(dry.status, dry.out).toBe(0);
    expect(dry.stdout).toContain("would pin");
    expect(existsSync(pinRoot)).toBe(false);
    expect(run(dev, "git", ["config", "--get", "core.hooksPath"]).stdout).toBe("");
  });

  test("pins one commit's hooks read-only, points both checkouts at them, backs up, and verifies a refusal", () => {
    git(dev, "config", "core.hooksPath", "/previous/hooks");
    const result = install("--private", dev, "--public", clone);
    expect(result.status, result.out).toBe(0);
    const pin = join(pinRoot, git(dev, "rev-parse", "--short=12", "HEAD"));
    expect(git(dev, "config", "--get", "core.hooksPath")).toBe(join(pin, "private/githooks"));
    expect(git(clone, "config", "--get", "core.hooksPath")).toBe(join(pin, "tools/githooks"));
    expect(result.stdout.match(/verified refusal/gu)).toHaveLength(2);
    expect(statSync(join(pin, "tools/public-guard.ts")).mode & 0o222).toBe(0);
    expect(statSync(join(pin, "private/githooks/pre-push")).mode & 0o777).toBe(0o555);
    expect(readFileSync(join(pinRoot, "public-hooks"), "utf8").trim()).toBe(join(pin, "tools/githooks"));
    const backups = run(pinRoot, "sh", ["-c", "cat backups/*.tsv"]).stdout;
    expect(backups).toContain("\t/previous/hooks\n");
    // Re-installing the same commit reuses the pin; a tampered pin is refused.
    expect(install("--private", dev).status).toBe(0);
    chmodSync(join(pin, "tools"), 0o755);
    chmodSync(join(pin, "tools/leak-canaries.txt"), 0o644);
    writeFileSync(join(pin, "tools/leak-canaries.txt"), "tampered\n");
    const tampered = install("--private", dev);
    expect(tampered.status).toBe(1);
    expect(tampered.stderr).toContain("differs");
    git(dev, "show", "HEAD:tools/leak-canaries.txt");
    writeFileSync(join(pin, "tools/leak-canaries.txt"), run(dev, "git", ["show", "HEAD:tools/leak-canaries.txt"]).stdout);
  });

  test("--verify finds a checkout whose hooks path is gone, which would otherwise run no hook at all", () => {
    const verify = () => run(dev, "bash", [INSTALL, "--verify", "--pin-root", pinRoot]);
    const ok = verify();
    expect(ok.status, ok.out).toBe(0);
    expect(ok.stdout).toContain("every recorded checkout runs its pinned hooks");
    const installed = git(dev, "config", "--get", "core.hooksPath");
    git(dev, "config", "core.hooksPath", join(scratch.dir, "pins-removed", "private/githooks"));
    const missing = verify();
    expect(missing.status).toBe(1);
    expect(missing.stdout).toContain("which is missing: no hook runs");
    git(dev, "config", "core.hooksPath", installed);
  });

  test("a --private install stops when a worktree of that repository predates the private namespace (C7)", () => {
    const empty = run(dev, "git", ["hash-object", "-t", "tree", "-w", "--stdin"], { input: "" }).stdout.trim();
    const old = run(dev, "git", ["commit-tree", empty, "-m", "an old branch"], {
      env: cleanEnv({ GIT_AUTHOR_NAME: "Dev", GIT_AUTHOR_EMAIL: "dev@private.invalid", GIT_COMMITTER_NAME: "Dev", GIT_COMMITTER_EMAIL: "dev@private.invalid" }),
    }).stdout.trim();
    const worktree = join(scratch.dir, "old-worktree");
    git(dev, "worktree", "add", "-q", "--detach", worktree, old);
    const blocked = install("--private", dev);
    expect(blocked.status).toBe(1);
    expect(blocked.stderr).toContain("predates the private namespace");
    expect(blocked.stderr).toContain("--accept-blocked-worktrees");
    expect(install("--private", dev, "--accept-blocked-worktrees").status).toBe(0);
    git(dev, "worktree", "remove", "--force", worktree);
  });

  test("a commit whose shared guard differs from its reviewed record is never pinned", () => {
    const tampered = join(scratch.dir, "tampered-src");
    git(scratch.dir, "clone", "-q", origin, tampered);
    write(tampered, "tools/public-guard.ts", `${readFileSync(join(tampered, "tools/public-guard.ts"), "utf8")}// an unreviewed line\n`);
    commitAll(tampered, "an unreviewed guard change", undefined, { ALLOW_SHARED_EDIT: "1" });
    const result = run(tampered, "bash", [join(tampered, "private/bin/install-guards.sh"), "--rev", "HEAD", "--pin-root", join(scratch.dir, "pins-tampered"), "--public", clone]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("differ from its reviewed record");
    expect(existsSync(join(scratch.dir, "pins-tampered", git(tampered, "rev-parse", "--short=12", "HEAD")))).toBe(false);
    // A private tool run from such a tree refuses before the shared guard module runs.
    const scan = run(tampered, process.execPath, [join(tampered, "private/bin/relational-scan.ts"), "--guard-dir", join(tampered, "private/guard"), "--ref-name", "x"]);
    expect(scan.status).not.toBe(0);
    expect(scan.stderr).toContain("not the reviewed copy");
  });
});

describe("the private pre-commit", () => {
  const commit = (message: string, env: Record<string, string> = {}) =>
    run(dev, "git", ["-c", "user.name=Dev", "-c", "user.email=dev@private.invalid", "commit", "-q", "-m", message], { env: cleanEnv(env) });
  const reset = () => {
    git(dev, "reset", "-q", "--hard", "origin/main");
    git(dev, "clean", "-qfd");
  };

  test("a bunfig.toml in the checkout cannot configure the hook's Bun: a preload that exits 0 does not pass a shared edit", () => {
    write(dev, "bunfig.toml", 'preload = ["./quiet.ts"]\n');
    write(dev, "quiet.ts", "process.exit(0);\n");
    write(dev, "README.md", "# Edited here, beside a preload\n");
    git(dev, "add", "README.md");
    const edit = commit("edit shared beside a preload");
    expect(edit.status).toBe(1);
    expect(edit.out).toContain("make shared changes in the public development repository");
    reset();
  });

  test("a tsconfig.json or jsconfig.json in the checkout cannot redirect the hook's imports: a module that exits 0 does not pass a shared edit", () => {
    // Bun applies the TypeScript config of its working directory: `paths`
    // with "*" replaces even node: imports. The hook's Bun runs from the pin.
    for (const config of ["tsconfig.json", "jsconfig.json"]) {
      write(dev, config, '{ "compilerOptions": { "baseUrl": ".", "paths": { "*": ["./quiet.ts"] } } }\n');
      write(dev, "quiet.ts", "process.exit(0);\n");
      write(dev, "README.md", "# Edited here, beside a path map\n");
      git(dev, "add", "README.md");
      const edit = commit(`edit shared beside a ${config}`);
      expect(edit.status, config).toBe(1);
      expect(edit.out).toContain("make shared changes in the public development repository");
      reset();
    }
  });

  test("refuses an add under a shared tree and an edit of a shared file; private and withheld paths pass", () => {
    write(dev, "packages/alpha/new.test.ts", "test\n");
    git(dev, "add", "-A");
    const add = commit("add a shared test");
    expect(add.status).toBe(1);
    expect(add.out).toContain("added\tpackages/alpha/new.test.ts");
    expect(add.out).toContain("make shared changes in the public development repository");
    reset();
    write(dev, "README.md", "# Edited here\n");
    git(dev, "add", "-A");
    expect(commit("edit shared").status).toBe(1);
    reset();
    write(dev, "private/notes.md", "more private notes\n");
    write(dev, "packages/wallet/index.ts", "export const wallet = 2;\n");
    git(dev, "add", "-A");
    expect(commit("private and withheld").status).toBe(0);
    reset();
  });

  test("ALLOW_SHARED_EDIT lets a shared edit through; a missing public-sync and an old branch refuse", () => {
    write(dev, "README.md", "# Edited here\n");
    git(dev, "add", "-A");
    expect(commit("allowed", { ALLOW_SHARED_EDIT: "1" }).status).toBe(0);
    reset();
    git(dev, "update-ref", "-d", "refs/remotes/origin/public-sync");
    write(dev, "packages/alpha/index.ts", "export const alpha = 9;\n");
    git(dev, "add", "-A");
    const missing = commit("no public-sync");
    expect(missing.status).toBe(1);
    expect(missing.out).toContain("cannot be checked; refusing");
    reset();
    git(dev, "fetch", "-q", "origin");
    git(dev, "switch", "-q", "--orphan", "old-branch");
    write(dev, "only.md", "an old branch\n");
    git(dev, "add", "only.md");
    const old = commit("old branch");
    expect(old.status).toBe(1);
    expect(old.out).toContain("no private/guard/relational-denylist.json");
    expect(commit("skipped", { AGENTTOOL_NO_PRIVATE_GUARD: "1" }).status).toBe(0);
    git(dev, "switch", "-q", "-f", "main");
    git(dev, "clean", "-qfdx", "-e", "node_modules");
    git(dev, "branch", "-q", "-D", "old-branch");
    reset();
  });
});

describe("the private pre-push", () => {
  const push = (...args: string[]) => run(dev, "git", ["push", ...args]);
  const before = () => git(dev, "rev-parse", "origin/main");

  test("refuses drift on main and on every other branch, including an add under a shared tree; nothing is pushed", () => {
    const start = before();
    write(dev, "packages/alpha/added.ts", "export {};\n");
    git(dev, "add", "-A");
    commitAll(dev, "bypassed add", undefined, { ALLOW_SHARED_EDIT: "1" });
    const refused = push("-q", "origin", "HEAD:main");
    expect(refused.status).not.toBe(0);
    expect(refused.out).toContain("added\tpackages/alpha/added.ts");
    expect(git(origin, "rev-parse", "main")).toBe(start);
    // A topic branch is checked as well: a pull request merged on GitHub never runs a hook.
    const topic = push("-q", "origin", "HEAD:refs/heads/wip");
    expect(topic.status).not.toBe(0);
    expect(topic.out).toContain("added\tpackages/alpha/added.ts");
    expect(run(origin, "git", ["rev-parse", "--verify", "--quiet", "refs/heads/wip"]).status).not.toBe(0);
    git(dev, "reset", "-q", "--hard", "origin/main");
    // A branch that only names commits the remote already has needs no check.
    expect(push("-q", "origin", "HEAD:refs/heads/same-as-main").status).toBe(0);
  });

  test("an allowlist change that narrows the shared scope is refused on push without the owner's go (R-T4)", () => {
    const allowlist = JSON.parse(readFileSync(join(dev, "private/projection/allowlist.json"), "utf8")) as { export: { exclude: Array<{ path: string; reason: string }> } };
    allowlist.export.exclude.unshift({ path: "packages/alpha", reason: "an R-only narrowing" });
    write(dev, "private/projection/allowlist.json", `${JSON.stringify(allowlist, null, 2)}\n`);
    git(dev, "add", "-A");
    const committed = run(dev, "git", ["-c", "user.name=Dev", "-c", "user.email=dev@private.invalid", "commit", "-q", "-m", "narrow"]);
    expect(committed.status).not.toBe(0);
    expect(committed.out).toContain("ALLOW_SCOPE_CHANGE=1");
    commitAll(dev, "narrow, bypassing the pre-commit");
    const refused = push("-q", "origin", "HEAD:refs/heads/narrow");
    expect(refused.status).not.toBe(0);
    expect(refused.out).toContain("export exclude added\tpackages/alpha");
    expect(run(dev, "git", ["push", "-q", "origin", "HEAD:refs/heads/narrow"], { env: cleanEnv({ ALLOW_SCOPE_CHANGE: "1" }) }).status).toBe(0);
    git(dev, "push", "-q", "origin", "--delete", "narrow");
    git(dev, "reset", "-q", "--hard", "origin/main");
  });

  test("accepts a private-only change to main, and only the merge clone's atomic push of a real public tip sets public-sync (R-T1, R-T2)", () => {
    write(dev, "private/notes.md", "pushed notes\n");
    commitAll(dev, "private only");
    expect(push("-q", "origin", "HEAD:main").status).toBe(0);
    // A merge of a public commit that edits README.md, as merge-back makes it.
    write(dev, "README.md", "# Shared tree, edited in public\n");
    const edited = commitAll(dev, "the public edit, in a scratch commit", undefined, { ALLOW_SHARED_EDIT: "1" });
    const sync = scopedTip(dev, edited, inScope, git(dev, "rev-parse", "origin/public-sync"));
    const merge = run(dev, "git", ["commit-tree", `${edited}^{tree}`, "-p", git(dev, "rev-parse", "origin/main"), "-p", sync, "-m", "Merge public main"], {
      env: cleanEnv({ GIT_AUTHOR_NAME: "Dev", GIT_AUTHOR_EMAIL: "dev@private.invalid", GIT_COMMITTER_NAME: "Dev", GIT_COMMITTER_EMAIL: "dev@private.invalid" }),
    }).stdout.trim();
    git(dev, "reset", "-q", "--hard", merge);
    // Without public-sync the edit is drift.
    expect(push("-q", "origin", "HEAD:main").status).not.toBe(0);
    // R-T1: pointing public-sync at the private commit itself, in the same push, is refused.
    const self = push("-q", "--atomic", "origin", "HEAD:refs/heads/main", "HEAD:refs/heads/public-sync");
    expect(self.status).not.toBe(0);
    expect(self.out).toContain("only the dedicated merge clone updates public-sync");
    git(dev, "config", "agenttool.mergeClone", "true");
    const forged = push("-q", "--atomic", "origin", "HEAD:refs/heads/main", "HEAD:refs/heads/public-sync");
    expect(forged.status).not.toBe(0);
    expect(forged.out).toContain("does not have the public root as its only root");
    // R-T2: public-sync alone, to a commit main does not contain, is refused too.
    const alone = push("-q", "origin", `${sync}:refs/heads/public-sync`);
    expect(alone.status).not.toBe(0);
    expect(alone.out).toContain("is not contained in main");
    const atomic = push("-q", "--atomic", "origin", "HEAD:refs/heads/main", `${sync}:refs/heads/public-sync`);
    expect(atomic.status, atomic.out).toBe(0);
    git(dev, "config", "--unset", "agenttool.mergeClone");
    git(dev, "fetch", "-q", "origin");
    expect(git(origin, "rev-parse", "public-sync")).toBe(sync);
  });

  test("refuses any push to the public repository, by URL or by a local clone's name", () => {
    const named = join(scratch.dir, `${PUBLIC_REPOSITORY.split("/")[1]}.git`);
    git(scratch.dir, "init", "-q", "--bare", named);
    const local = push("-q", named, "HEAD:refs/heads/x");
    expect(local.status).not.toBe(0);
    expect(local.out).toContain("never pushes to the public development repository");
    const hook = git(dev, "config", "--get", "core.hooksPath");
    for (const url of [`https://github.com/${PUBLIC_REPOSITORY}.git`, `git@github.com:${PUBLIC_REPOSITORY}`, `https://github.com/${PUBLIC_REPOSITORY.toUpperCase()}/`]) {
      expect(run(dev, join(hook, "pre-push"), ["public", url], { input: "" }).status, url).toBe(1);
    }
  });

  test("pushes only to this private repository on GitHub or to a local path: the release repository and other hosts are refused", () => {
    const hook = join(git(dev, "config", "--get", "core.hooksPath"), "pre-push");
    for (const url of [
      "https://github.com/cambridgetcg/agenttool-packages.git",
      `https://github.com/${PUBLIC_REPOSITORY}-mirror.git`,
      "https://gitlab.com/cambridgetcg/agenttool.git",
      "https://codeberg.org/someone/agenttool.git",
      "git@github.com:someone/agenttool.git",
      "https://github.com/cambridgetcg/agenttool-extra.git",
    ]) {
      const result = run(dev, hook, ["origin", url], { input: "" });
      expect(result.status, url).toBe(1);
      expect(result.out, url).toContain("pushes only to");
    }
    for (const url of [
      "https://github.com/cambridgetcg/agenttool.git",
      "https://x-access-token:redacted@github.com/cambridgetcg/agenttool",
      "git@github.com:cambridgetcg/agenttool.git",
      "ssh://git@github.com/cambridgetcg/agenttool.git",
      origin,
      `file://${origin}`,
    ]) {
      expect(run(dev, hook, ["origin", url], { input: "" }).status, url).toBe(0);
    }
  });

  test("a tsconfig.json in the checkout cannot redirect the hook's imports: an add under a shared tree is still refused", () => {
    const start = before();
    write(dev, "tsconfig.json", '{ "compilerOptions": { "baseUrl": ".", "paths": { "*": ["./quiet.ts"] } } }\n');
    write(dev, "quiet.ts", "process.exit(0);\n");
    write(dev, "packages/alpha/mapped.ts", "export {};\n");
    git(dev, "add", "packages/alpha/mapped.ts");
    commitStaged(dev, "an add beside a path map");
    const refused = push("-q", "origin", "HEAD:main");
    expect(refused.status).not.toBe(0);
    expect(refused.out).toContain("added\tpackages/alpha/mapped.ts");
    expect(git(origin, "rev-parse", "main")).toBe(start);
    git(dev, "reset", "-q", "--hard", "origin/main");
    git(dev, "clean", "-qfd");
  });

  test("a push to main without public-sync is refused", () => {
    git(dev, "update-ref", "-d", "refs/remotes/origin/public-sync");
    write(dev, "private/notes.md", "again\n");
    commitAll(dev, "private");
    const result = push("-q", "origin", "HEAD:main");
    expect(result.status).not.toBe(0);
    expect(result.out).toContain("no public-sync");
    git(dev, "fetch", "-q", "origin");
    git(dev, "reset", "-q", "--hard", "origin/main");
  });
});

describe("the public clone's pre-push", () => {
  let pushes = 0;
  const push = (ref?: string, env: Record<string, string> = {}) => {
    pushes += 1;
    return run(clone, "git", ["push", "-q", "origin", ref ?? `HEAD:refs/heads/topic-${pushes}`], { env: cleanEnv(env) });
  };
  const reset = () => {
    git(clone, "switch", "-q", "main");
    git(clone, "reset", "-q", "--hard", "origin/main");
    git(clone, "clean", "-qfd");
  };
  const change = (path: string, content: string | Uint8Array, message = "change") => {
    write(clone, path, content);
    git(clone, "add", "-A");
    return run(clone, "git", ["-c", "commit.gpgSign=false", "commit", "-q", "-m", message]);
  };

  test("a clean branch is accepted", () => {
    change("packages/alpha/more.ts", "export const more = 1;\n");
    const result = push();
    expect(result.status, result.out).toBe(0);
    reset();
  });

  test("refuses a private address, a term in a line, a message, or a ref name, and an owner address in a file; never echoing them", () => {
    write(clone, "packages/alpha/x.ts", "export {};\n");
    git(clone, "add", "-A");
    run(clone, "git", ["commit", "-q", "-m", "x"], { env: cleanEnv({ GIT_AUTHOR_EMAIL: "dev@laptop.invalid" }) });
    const address = push();
    expect(address.status).not.toBe(0);
    expect(address.out).toContain("the author address is not a public one");
    expect(address.out).not.toContain("dev@laptop.invalid");
    reset();
    for (const [path, content, message, ref] of [
      ["packages/alpha/y.ts", `// ${TERM}\n`, "line", undefined],
      ["packages/alpha/y.ts", "// fine\n", `about ${TERM}`, undefined],
      ["packages/alpha/y.ts", "// fine\n", "ref", `HEAD:refs/heads/${TERM.replace(" ", "-")}`],
      ["packages/alpha/y.md", `write to ${OWNER_ADDRESS}\n`, "address", undefined],
    ] as const) {
      change(path, content, message);
      const result = push(ref);
      expect(result.status, `${path} ${message}`).not.toBe(0);
      expect(result.out).toContain("the private scan refused");
      expect(result.out.toLowerCase()).not.toContain(TERM);
      expect(result.out.toLowerCase()).not.toContain(OWNER_ADDRESS);
      reset();
    }
  });

  test("refuses the canary, the denylist bytes, a private path, a foreign root, and an annotated tag's term", () => {
    change("packages/alpha/blob.bin", fixture.canary);
    expect(push().out).toContain("a new object is a listed canary");
    reset();
    change("packages/alpha/words.json", readFileSync(join(dev, "private/guard/relational-denylist.json")));
    expect(push().out).toContain("the private scan refused");
    reset();
    change("private/leak.md", "leak\n");
    expect(push().out).toContain("the public guard refused");
    reset();
    git(clone, "fetch", "-q", origin, "main:refs/tmp/private");
    expect(push("refs/tmp/private:refs/heads/leak").out).toContain("the history's root is not the shared tree's root");
    git(clone, "update-ref", "-d", "refs/tmp/private");
    git(clone, "-c", "user.name=AgentTool", "-c", "user.email=contact@cambridgetcg.com", "tag", "-a", "v0", "-m", `a ${TERM}`);
    expect(push("refs/tags/v0").out).toContain("the private scan refused");
    git(clone, "tag", "-d", "v0");
    expect(git(publicBare, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/main\nrefs/heads/topic-1");
  });

  test("git attributes cannot hide a term from the scan: a committed -diff or binary attribute, or info/attributes (T1)", () => {
    for (const attributes of ["*.md -diff\n", "*.md binary\n"]) {
      write(clone, ".gitattributes", attributes);
      const result = change("packages/alpha/hidden.md", `${TERM}\n`, "hidden");
      expect(result.status, result.out).toBe(0);
      const pushed = push();
      expect(pushed.status, attributes).not.toBe(0);
      expect(pushed.out).toContain("the private scan refused");
      expect(pushed.out.toLowerCase()).not.toContain(TERM);
      reset();
    }
    const info = join(clone, ".git", "info");
    mkdirSync(info, { recursive: true });
    writeFileSync(join(info, "attributes"), "* -diff\n");
    change("packages/alpha/hidden.md", `${TERM}\n`, "hidden");
    expect(push().out).toContain("the private scan refused");
    rmSync(join(info, "attributes"));
    reset();
  });

  test("a private address in a message trailer, or as an annotated tag's tagger, is refused (T3, T4)", () => {
    const address = ["ally", "privatemail.net"].join("@");
    change("packages/alpha/t.ts", "export const t = 1;\n", `a change\n\nCo-authored-by: Ally <${address}>`);
    const trailer = push();
    expect(trailer.status).not.toBe(0);
    expect(trailer.out).toContain("the private scan refused");
    expect(trailer.out).not.toContain(address);
    reset();
    // The co-author trailer of the coding agent and GitHub noreply addresses pass.
    change("packages/alpha/t.ts", "export const t = 2;\n", "a change\n\nCo-Authored-By: Claude <noreply@anthropic.com>\nCo-authored-by: Someone <123+someone@users.noreply.github.com>");
    const fine = push();
    expect(fine.status, fine.out).toBe(0);
    reset();
    run(clone, "git", ["tag", "-a", "v-tagger", "-m", "release"], { env: cleanEnv({ GIT_COMMITTER_NAME: "Ally", GIT_COMMITTER_EMAIL: address }) });
    const tag = push("refs/tags/v-tagger");
    expect(tag.status).not.toBe(0);
    expect(tag.out).toContain("the tagger address is not a public one");
    expect(tag.out).not.toContain(address);
    git(clone, "tag", "-d", "v-tagger");
  });

  test("a commit another remote already has is still scanned when pushed here (T5)", () => {
    const side = join(scratch.dir, "public-side");
    git(scratch.dir, "clone", "-q", publicBare, side);
    write(side, "packages/alpha/side.md", `${TERM}\n`);
    publicCommit(side, "from another clone");
    git(clone, "remote", "add", "side", side);
    git(clone, "fetch", "-q", "side");
    const pushed = push("refs/remotes/side/main:refs/heads/from-side");
    expect(pushed.status).not.toBe(0);
    expect(pushed.out).toContain("the private scan refused");
    git(clone, "remote", "remove", "side");
  });

  test("a bunfig.toml in the clone cannot configure the hook's Bun: a preload that exits 0 does not let a term through", () => {
    write(clone, "bunfig.toml", 'preload = ["./quiet.ts"]\n');
    write(clone, "quiet.ts", "process.exit(0);\n");
    const committed = change("packages/alpha/preloaded.md", `${TERM}\n`, "a preload beside a term");
    expect(committed.status, committed.out).toBe(0);
    const pushed = push();
    expect(pushed.status).not.toBe(0);
    expect(pushed.out).toContain("the private scan refused");
    expect(pushed.out.toLowerCase()).not.toContain(TERM);
    reset();
  });

  test("a tsconfig.json or jsconfig.json in the clone cannot redirect the hook's imports: a module that exits 0 does not let a term through", () => {
    for (const config of ["tsconfig.json", "jsconfig.json"]) {
      write(clone, config, '{ "compilerOptions": { "baseUrl": ".", "paths": { "*": ["./quiet.ts"] } } }\n');
      write(clone, "quiet.ts", "process.exit(0);\n");
      const committed = change("packages/alpha/mapped.md", `${TERM}\n`, `a path map beside a term (${config})`);
      expect(committed.status, committed.out).toBe(0);
      const pushed = push();
      expect(pushed.status, config).not.toBe(0);
      expect(pushed.out).toContain("refused");
      expect(pushed.out.toLowerCase()).not.toContain(TERM);
      reset();
    }
  });

  test("fails closed without its config or the denylist; the public-only mode runs checks 1-4", () => {
    change("packages/alpha/z.ts", "export const z = 1;\n");
    git(clone, "config", "publicguard.privateGuard", join(scratch.dir, "missing"));
    const missing = push();
    expect(missing.status).not.toBe(0);
    expect(missing.out).toContain("the private denylist is missing");
    const publicOnly = push("HEAD:refs/heads/public-only", { AGENTTOOL_NO_PRIVATE_GUARD: "1" });
    expect(publicOnly.status, publicOnly.out).toBe(0);
    expect(publicOnly.out).toContain("the private scan is skipped");
    git(clone, "config", "publicguard.privateGuard", join(dev, "private/guard"));
    git(clone, "config", "--unset", "publicguard.root");
    expect(push().out).toContain("publicguard.root is not set");
    git(clone, "config", "publicguard.root", publicRoot);
    reset();
  });
});
