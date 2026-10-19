/** The shared scope: one allowlist drives the export and the projection, and R-side adds under shared trees are drift (critic MUST 2). */
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALLOWLIST_PATH, parseAllowlist, type Allowlist } from "../../../bin/project-public.ts";
import { exportMatcher, mergeProblems, parseExportConfig, ScopeError, scopeDrift, stagedViolations, commitDrift } from "../shared-scope.ts";
import { ALLOWLIST, commitAll, git, makePrivateRepo, ROOT, run, scopedTip, scratchDir, write } from "./fixtures.ts";

setDefaultTimeout(60_000);
const scratch = scratchDir("scope");
afterAll(scratch.cleanup);

const fixtureAllowlist = () => JSON.parse(JSON.stringify(ALLOWLIST)) as Allowlist & { export: Record<string, unknown> };

describe("the export section", () => {
  test("parses, and the matcher covers include trees, include blobs, and root files minus excludes and globs", () => {
    const config = parseExportConfig(parseAllowlist(Buffer.from(JSON.stringify(ALLOWLIST))));
    const inScope = exportMatcher(config);
    expect(inScope("packages/alpha/index.ts")).toBe(true);
    expect(inScope("packages/alpha/new/deep.ts")).toBe(true);
    expect(inScope("docs/spec.md")).toBe(true);
    expect(inScope("README.md")).toBe(true);
    expect(inScope("packages/wallet/index.ts")).toBe(false);
    expect(inScope("packages/alpha/node_modules/x/index.js")).toBe(false);
    expect(inScope("packages/beta/index.ts")).toBe(false);
    expect(inScope("docs/other.md")).toBe(false);
    expect(inScope("private/notes.md")).toBe(false);
    expect(inScope("packages/alpha")).toBe(false);
  });

  test("fails closed: a missing or malformed section refuses", () => {
    const refuse = (mutate: (allowlist: ReturnType<typeof fixtureAllowlist>) => void, message: string) => {
      const allowlist = fixtureAllowlist();
      mutate(allowlist);
      expect(() => parseExportConfig(parseAllowlist(Buffer.from(JSON.stringify(allowlist))))).toThrow(message);
    };
    refuse((a) => delete (a as Partial<typeof a>).export, "the section is missing");
    refuse((a) => (a.export.root_files = ["tools/public-guard.ts", "README.md"]), "sorted and unique");
    refuse((a) => (a.export.root_files = ["private/README.md"]), "refused in a shared tree");
    refuse((a) => (a.export.root_files = [".github/workflows/private-ci.yml"]), "refused in a shared tree");
    refuse((a) => (a.export.root_files = ["packages/alpha/index.ts"]), "overlaps include");
    refuse((a) => (a.export.exclude = [{ path: "apps/web", reason: "x" }]), "not inside an include path");
    refuse((a) => (a.export.exclude = [{ path: "packages/wallet", reason: " " }]), "must say why");
    refuse((a) => (a.export = { root_files: ["README.md"], exclude: [], note: "x" }), "exactly note, root_files, exclude");
  });

  test("the projection still parses an allowlist with or without the section, and nothing else", () => {
    const allowlist = fixtureAllowlist();
    expect(() => parseAllowlist(Buffer.from(JSON.stringify(allowlist)))).not.toThrow();
    delete (allowlist as Partial<typeof allowlist>).export;
    expect(() => parseAllowlist(Buffer.from(JSON.stringify(allowlist)))).not.toThrow();
    expect(() => parseAllowlist(Buffer.from(JSON.stringify({ ...allowlist, extra: 1 })))).toThrow("optionally export");
    expect(() => parseAllowlist(Buffer.from(JSON.stringify({ ...allowlist, export: [] })))).toThrow("export must be an object");
  });

  test("the real allowlist withholds packages/wallet from the export by an explicit, documented entry", () => {
    const config = parseExportConfig(parseAllowlist(readFileSync(join(ROOT, ALLOWLIST_PATH))));
    // Yu has not decided the wallet option (2026-10-19): the export fails closed.
    expect(config.exclude.map((entry) => entry.path)).toEqual(["packages/wallet"]);
    expect(config.exclude[0]?.reason).toContain("has not decided");
    // The projection still carries it, so the npm lane is unchanged.
    expect(config.allowlist.include).toContainEqual({ path: "packages/wallet", kind: "tree" });
    expect(exportMatcher(config)("packages/wallet/package.json")).toBe(false);
    expect(config.rootFiles).toEqual([
      ".github/workflows/ci.yml",
      ".github/workflows/public-watch.yml",
      ".gitignore",
      ".gitleaksignore",
      "LICENSE",
      "LICENSING.md",
      "NOTICE",
      "README.md",
      "SECURITY.md",
      "tools/githooks/pre-push",
      "tools/leak-canaries.txt",
      "tools/public-guard-allow.json",
      "tools/public-guard.ts",
      "tools/workflow-lint.ts",
    ]);
  });
});

describe("drift", () => {
  const inScope = exportMatcher(parseExportConfig(parseAllowlist(Buffer.from(JSON.stringify(ALLOWLIST)))));
  const map = (entries: Record<string, string>) => new Map(Object.entries(entries));

  test("an add under a shared tree is drift even though the public side never had the path", () => {
    const drift = scopeDrift(inScope, {
      privateEntries: map({ "packages/alpha/a.ts": "100644 a", "packages/alpha/new.test.ts": "100644 n", "private/x.md": "100644 p", "packages/wallet/w.ts": "100644 w" }),
      publicEntries: map({ "packages/alpha/a.ts": "100644 a" }),
    });
    expect(drift).toEqual([{ path: "packages/alpha/new.test.ts", kind: "added" }]);
  });

  test("with a base, unchanged paths and upstream fixes already equal to public are not drift", () => {
    const base = map({ "packages/alpha/a.ts": "100644 a1", "packages/alpha/b.ts": "100644 b1", "README.md": "100644 r1" });
    const publicEntries = map({ "packages/alpha/a.ts": "100644 a2", "packages/alpha/b.ts": "100644 b2", "README.md": "100644 r1", "packages/alpha/c.ts": "100644 c" });
    const privateEntries = map({ "packages/alpha/a.ts": "100644 a1", "packages/alpha/b.ts": "100644 b2", "README.md": "100644 r1", "packages/alpha/d.ts": "100644 d" });
    expect(scopeDrift(inScope, { privateEntries, publicEntries, baseEntries: base })).toEqual([{ path: "packages/alpha/d.ts", kind: "added" }]);
    // An edit and a deletion since the base are drift too, and so is a mode change.
    expect(
      scopeDrift(inScope, {
        privateEntries: map({ "packages/alpha/a.ts": "100644 aX", "README.md": "100755 r1" }),
        publicEntries,
        baseEntries: base,
      }).map((entry) => `${entry.kind} ${entry.path}`),
    ).toEqual(["changed packages/alpha/a.ts", "deleted packages/alpha/b.ts", "changed README.md"].sort());
  });

  test("a path the public side holds outside the allowlist is shared too; over a private file it is a collision", () => {
    const drift = scopeDrift(inScope, {
      privateEntries: map({ "examples/x.md": "100644 mine", "examples/y.md": "100644 y1" }),
      publicEntries: map({ "examples/x.md": "100644 theirs", "examples/y.md": "100644 y2" }),
      baseEntries: map({ "examples/y.md": "100644 y0" }),
    });
    expect(drift).toEqual([
      { path: "examples/x.md", kind: "collision" },
      { path: "examples/y.md", kind: "changed" },
    ]);
  });
});

describe("staged changes and merge results in a real repository", () => {
  const fixture = makePrivateRepo(scratch.dir);
  const repo = fixture.repo;
  const publicTip = scopedTip(repo, fixture.head, exportMatcher(parseExportConfig(parseAllowlist(Buffer.from(JSON.stringify(ALLOWLIST))))));
  git(repo, "update-ref", "refs/remotes/origin/public-sync", publicTip);

  test("a staged add under a shared tree is refused; private paths and equal-to-public results pass", () => {
    write(repo, "packages/alpha/new.ts", "export const n = 1;\n");
    git(repo, "add", "packages/alpha/new.ts");
    expect(stagedViolations(repo, "refs/remotes/origin/public-sync")).toEqual([{ path: "packages/alpha/new.ts", kind: "added" }]);
    git(repo, "reset", "-q", "--hard");
    git(repo, "clean", "-qfd");
    write(repo, "private/more.md", "more\n");
    write(repo, "packages/wallet/index.ts", "export const wallet = 2;\n");
    git(repo, "add", "-A");
    expect(stagedViolations(repo, "refs/remotes/origin/public-sync")).toEqual([]);
    git(repo, "reset", "-q", "--hard");
    git(repo, "clean", "-qfd");
  });

  test("without a public tip every staged change to an allowlisted path is refused", () => {
    write(repo, "packages/alpha/index.ts", "export const alpha = 2;\n");
    git(repo, "add", "-A");
    expect(stagedViolations(repo, "refs/remotes/origin/missing")).toEqual([{ path: "packages/alpha/index.ts", kind: "added" }]);
    const cli = run(repo, process.execPath, [join(repo, "private/bin/shared-scope.ts"), "staged", "--repo", repo, "--public", "refs/remotes/origin/missing"]);
    expect(cli.status).toBe(1);
    expect(cli.stderr).toContain("cannot be checked; refusing");
    git(repo, "reset", "-q", "--hard");
  });

  test("narrowing the allowlist is refused without the owner's go, and even with it the same commit does not hide an edit", () => {
    const narrowed = fixtureAllowlist();
    narrowed.include = narrowed.include.filter((entry) => entry.path !== "packages/alpha");
    write(repo, "private/projection/allowlist.json", `${JSON.stringify(narrowed, null, 2)}\n`);
    write(repo, "packages/alpha/index.ts", "export const alpha = 3;\n");
    git(repo, "add", "-A");
    expect(() => stagedViolations(repo, "refs/remotes/origin/public-sync")).toThrow("include removed packages/alpha");
    expect(stagedViolations(repo, "refs/remotes/origin/public-sync", { allowScopeChange: true }).map((entry) => entry.path)).toEqual(["packages/alpha/index.ts"]);
    git(repo, "reset", "-q", "--hard");
  });

  test("an export exclude added for a shared tree is a narrowing too (R-T4a), so a later add under it cannot slip through", () => {
    const narrowed = fixtureAllowlist();
    (narrowed.export.exclude as Array<{ path: string; reason: string }>).unshift({ path: "packages/alpha", reason: "an R-only edit" });
    write(repo, "private/projection/allowlist.json", `${JSON.stringify(narrowed, null, 2)}\n`);
    git(repo, "add", "-A");
    expect(() => stagedViolations(repo, "refs/remotes/origin/public-sync")).toThrow("export exclude added packages/alpha");
    const cli = run(repo, process.execPath, [join(repo, "private/bin/shared-scope.ts"), "staged", "--repo", repo, "--public", "refs/remotes/origin/public-sync"]);
    expect(cli.status).toBe(2);
    expect(cli.stderr).toContain("ALLOW_SCOPE_CHANGE=1");
    git(repo, "reset", "-q", "--hard");
  });

  test("commit drift and the merge check read the allowlist from the private commit", () => {
    write(repo, "packages/alpha/added.ts", "export {};\n");
    const drifted = commitAll(repo, "add under shared tree");
    expect(commitDrift(repo, { privateRev: drifted, publicRev: publicTip })).toEqual([{ path: "packages/alpha/added.ts", kind: "added" }]);
    expect(commitDrift(repo, { privateRev: fixture.head, publicRev: publicTip })).toEqual([]);
    const cli = run(repo, process.execPath, [join(repo, "private/bin/shared-scope.ts"), "drift", "--repo", repo, "--public", publicTip, "--private", drifted]);
    expect(cli.status).toBe(1);
    expect(cli.stdout).toBe("added\tpackages/alpha/added.ts\n");
    expect(mergeProblems(repo, { base: publicTip, publicRev: publicTip, before: fixture.head, after: drifted })).toEqual([
      "shared path added after the merge\tpackages/alpha/added.ts",
    ]);
    // A merge that touched a private-only path is refused too.
    write(repo, "private/notes.md", "changed by a merge\n");
    const touched = commitAll(repo, "touch a private path");
    expect(mergeProblems(repo, { base: publicTip, publicRev: publicTip, before: drifted, after: touched })).toEqual([
      "shared path added after the merge\tpackages/alpha/added.ts",
      "the merge changed a private-only path\tprivate/notes.md",
    ]);
    git(repo, "reset", "-q", "--hard", fixture.head);
  });

  test("a checkout without the export section fails closed", () => {
    expect(() => stagedViolations(join(scratch.dir, "nowhere"), "x")).toThrow();
    const allowlist = fixtureAllowlist();
    delete (allowlist as Partial<typeof allowlist>).export;
    write(repo, "private/projection/allowlist.json", `${JSON.stringify(allowlist, null, 2)}\n`);
    const old = commitAll(repo, "an allowlist from before the export section");
    expect(() => commitDrift(repo, { privateRev: old, publicRev: publicTip })).toThrow(ScopeError);
    git(repo, "reset", "-q", "--hard", fixture.head);
  });
});
