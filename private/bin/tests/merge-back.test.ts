/**
 * merge-back.sh end to end on scratch repositories (plan 2.3-2.5): the
 * adoption merge, merge bases from `git merge-base`, real three-way merges,
 * drift (including an add under a shared tree, critic MUST 2), collisions,
 * the incoming scan, the root check, the gate, and the atomic push through
 * the installed private pre-push.
 */
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runExport } from "../public-export.ts";
import { cleanEnv, commitAll, git, makePrivateRepo, publicCommit, run, scratchDir, stubGitleaks, TERM, write } from "./fixtures.ts";

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
const mergeBack = (args: string[] = [], env: Record<string, string> = {}) =>
  run(merge, "bash", [MERGE_BACK, ...args], { env: cleanEnv({ AGENTTOOL_MERGE_BACK_GATE: "true", ...env }) });
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

  test("a failing private gate stops before the push", () => {
    const before = git(origin, "rev-parse", "main");
    publicChange({ "packages/alpha/gate.ts": "export {};\n" });
    const result = mergeBack(["--push"], { AGENTTOOL_MERGE_BACK_GATE: "false" });
    expect(result.status).toBe(7);
    expect(git(origin, "rev-parse", "main")).toBe(before);
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
