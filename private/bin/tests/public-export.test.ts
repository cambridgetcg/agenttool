/** The export: allowlist-driven, plumbing-only, every guard layer, and an identity proof. */
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readdirSync, statSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { PUBLIC_REPOSITORY } from "../../public-repository.ts";
import { ExportRefused, namesPrivateRepository, runExport, writeExportFile, type ExportOptions } from "../public-export.ts";
import { ACCOUNT_WORD, ALLOWLIST, commitAll, commitStaged, git, makePrivateRepo, OWNER_ADDRESS, publicCommit, ROOT, run, scratchDir, stubGitleaks, TERM, write, type PrivateFixture } from "./fixtures.ts";

setDefaultTimeout(120_000);
const scratch = scratchDir("export");
afterAll(scratch.cleanup);
const GITLEAKS = stubGitleaks(scratch.dir);
const EXPORT = join(ROOT, "private/bin/public-export.ts");
let count = 0;

function fresh(files: Record<string, string | Uint8Array> = {}, options: { allowlist?: unknown } = {}): PrivateFixture {
  count += 1;
  const dir = join(scratch.dir, `case-${count}`);
  mkdirSync(dir);
  return makePrivateRepo(dir, { files, allowlist: options.allowlist });
}

function exportInit(fixture: PrivateFixture, extra: Partial<ExportOptions> = {}) {
  const into = join(fixture.repo, "..", "public");
  return { into, receipt: runExport({ mode: "init", repo: fixture.repo, source: "HEAD", into, guardDir: fixture.guardDir, allowUnmergedSource: true, gitleaks: GITLEAKS, ...extra }) };
}

function refused(fixture: PrivateFixture, extra: Partial<ExportOptions> = {}): ExportRefused {
  try {
    exportInit(fixture, extra);
  } catch (error) {
    if (error instanceof ExportRefused) return error;
    throw error;
  }
  throw new Error("the export was not refused");
}

const ruleSet = (error: ExportRefused) => [...new Set(error.findings.map((finding) => finding.rule))].sort();

describe("the first export (--init)", () => {
  const fixture = fresh();
  const { into, receipt } = exportInit(fixture, { commit: true });

  test("writes exactly the shared scope: include paths and root files, minus the withheld wallet", () => {
    expect(git(into, "ls-files").split("\n").sort()).toEqual([
      ".gitattributes",
      ".github/workflows/ci.yml",
      ".gitignore",
      ".gitleaksignore",
      "README.md",
      "docs/spec.md",
      "packages/alpha/index.ts",
      "packages/alpha/run.sh",
      "tools/githooks/pre-push",
      "tools/leak-canaries.txt",
      "tools/public-guard-allow.json",
      "tools/public-guard.ts",
    ]);
    expect(receipt.excluded).toEqual(["packages/wallet"]);
    expect(receipt.identity).toBe("proven");
    expect(existsSync(join(into, "packages/wallet"))).toBe(false);
    expect(existsSync(join(into, "private"))).toBe(false);
  });

  test("every exported entry has the private repository's mode and blob id, with no object of its history", () => {
    const want = git(fixture.repo, "ls-tree", "-r", "HEAD", "--", ...ALLOWLIST.include.map((e) => e.path), ...ALLOWLIST.export.root_files)
      .split("\n")
      .filter((line) => !line.includes("packages/wallet/"))
      .map((line) => line.replace(/ blob /u, " "))
      .sort();
    const got = git(into, "ls-tree", "-r", "HEAD").split("\n").map((line) => line.replace(/ blob /u, " ")).sort();
    expect(got).toEqual(want);
    expect(statSync(join(into, "packages/alpha/run.sh")).mode & 0o111).not.toBe(0);
    // The public clone hashed the files itself: it holds its own commit's objects and nothing of the private history.
    expect(run(into, "git", ["cat-file", "-e", `${fixture.head}^{commit}`]).status).not.toBe(0);
    expect(git(into, "rev-list", "--count", "--all")).toBe("1");
    expect(git(into, "remote")).toBe("");
  });

  test("the root commit carries the public identity and names its source", () => {
    expect(git(into, "log", "-1", "--format=%an <%ae>|%cn <%ce>")).toBe("AgentTool <contact@cambridgetcg.com>|AgentTool <contact@cambridgetcg.com>");
    expect(git(into, "log", "-1", "--format=%B")).toBe(`AgentTool public root\n\nExported-From: ${fixture.head}`);
    expect(receipt.commit).toBe(git(into, "rev-parse", "HEAD"));
    expect(receipt.gitleaks).toBe("8.30.1");
  });

  test("the shared guard passes on the exported tree in tree mode", () => {
    const guard = run(into, process.execPath, [join(into, "tools/public-guard.ts"), "--tree", "--rev", "HEAD"]);
    expect(guard.status, guard.out).toBe(0);
  });
});

describe("refusals before anything is written", () => {
  test("relational terms, literal digests, joined names, the canary, the denylist, withheld files, and token shapes", () => {
    const cases: Array<[Record<string, string | Uint8Array>, string]> = [
      [{ "packages/alpha/notes.md": `about ${TERM}\n` }, "relational/r01"],
      [{ "packages/alpha/notes.md": `mail ${OWNER_ADDRESS}\n` }, "relational/l01"],
      [{ "packages/alpha/notes.md": `path /opt/${ACCOUNT_WORD}/x\n` }, "relational/l02"],
      [{ [`packages/alpha/${TERM.replace(" ", "_")}.md`]: "plain\n" }, "relational/r01"],
      [{ "packages/alpha/token.ts": `const k = "at_${"Zx9Qw3Er".repeat(6)}";\n` }, "secret/agenttool-token"],
      [{ "packages/alpha/corpus.txt": "withheld corpus\n" }, "relational/b01"],
      [{ "packages/alpha/.env": "X=1\n" }, "path/sensitive-name"],
    ];
    for (const [files, rule] of cases) {
      const fixture = fresh(files);
      const error = refused(fixture);
      expect(ruleSet(error), rule).toContain(rule);
      expect(readdirSync(join(fixture.repo, "..", "public"))).toEqual([".git"]);
      expect(git(join(fixture.repo, "..", "public"), "ls-files")).toBe("");
    }
    const copied = fresh();
    write(copied.repo, "packages/alpha/blob.bin", copied.canary);
    write(copied.repo, "packages/alpha/words.json", Buffer.from(git(copied.repo, "show", "HEAD:private/guard/relational-denylist.json") + "\n"));
    commitAll(copied.repo, "copies");
    expect(ruleSet(refused(copied))).toEqual(expect.arrayContaining(["relational/canary", "relational/denylist-copy"]));
  });

  test("symlinks and submodules in scope refuse; the export never writes through a link", () => {
    const linked = fresh();
    symlinkSync("index.ts", join(linked.repo, "packages/alpha/link.ts"));
    commitAll(linked.repo, "link");
    expect(ruleSet(refused(linked))).toContain("path/symlink");
    const sub = fresh();
    git(sub.repo, "update-index", "--add", "--cacheinfo", `160000,${sub.head},packages/alpha/vendor`);
    commitStaged(sub.repo, "submodule");
    expect(ruleSet(refused(sub))).toContain("path/submodule");
    const target = join(scratch.dir, "outside");
    mkdirSync(target, { recursive: true });
    const root = join(scratch.dir, "link-root");
    mkdirSync(root, { recursive: true });
    symlinkSync(target, join(root, "packages"));
    expect(() => writeExportFile(root, "packages/x.ts", Buffer.from("x"), "100644")).toThrow("not a plain directory");
    expect(readdirSync(target)).toEqual([]);
    expect(() => writeExportFile(root, "../x.ts", Buffer.from("x"), "100644")).toThrow("unsafe path");
  });

  test("an allowlist that reaches private paths, or lacks the export section, refuses", () => {
    const allowlist = JSON.parse(JSON.stringify(ALLOWLIST));
    delete allowlist.export;
    const fixture = fresh({}, { allowlist });
    expect(() => exportInit(fixture)).toThrow("the section is missing");
    const privateRoot = JSON.parse(JSON.stringify(ALLOWLIST));
    privateRoot.export.root_files = [...privateRoot.export.root_files, "private/notes.md"].sort();
    expect(() => exportInit(fresh({}, { allowlist: privateRoot }))).toThrow("refused in a shared tree");
  });

  test("a missing guard directory fails closed, and gitleaks is required to commit", () => {
    const fixture = fresh();
    expect(() => exportInit(fixture, { guardDir: join(scratch.dir, "no-guard") })).toThrow("missing");
    expect(() => exportInit(fixture, { gitleaks: undefined, noGitleaks: true, commit: true })).toThrow("--commit needs the gitleaks layer");
    expect(() => exportInit(fixture, { gitleaks: undefined })).toThrow("pass --gitleaks");
  });

  test("the source must be on origin/main unless the caller says otherwise, and --init needs an empty repository", () => {
    const fixture = fresh();
    expect(() => exportInit(fixture, { allowUnmergedSource: false })).toThrow("is not contained in refs/remotes/origin/main");
    git(fixture.repo, "update-ref", "refs/remotes/origin/main", "HEAD");
    expect(() => exportInit(fixture, { allowUnmergedSource: false, noGitleaks: true, gitleaks: undefined })).not.toThrow();
    expect(() => exportInit(fixture, { noGitleaks: true, gitleaks: undefined })).toThrow("--init needs an empty working tree");
    publicCommit(join(fixture.repo, "..", "public"), "a first commit");
    expect(() => exportInit(fixture, { noGitleaks: true, gitleaks: undefined })).toThrow("--init needs a repository without commits");
  });

  test("the identity proof catches a clone that rewrites bytes on add", () => {
    // A CRLF blob under a `text eol=lf` attribute is normalised by `git add`, so the index differs from the source.
    const fixture = fresh();
    const crlf = run(fixture.repo, "git", ["hash-object", "-w", "--no-filters", "--stdin"], { input: "# Spec\r\n" }).stdout.trim();
    git(fixture.repo, "update-index", "--cacheinfo", `100644,${crlf},docs/spec.md`);
    commitStaged(fixture.repo, "a CRLF blob");
    const error = refused(fixture, { noGitleaks: true, gitleaks: undefined });
    expect(ruleSet(error)).toEqual(["integrity/export-identity"]);
    expect(error.message).toContain("nothing was committed");
  });

  test("a clone that borrows objects or names the private repository is refused", () => {
    const fixture = fresh();
    const into = join(fixture.repo, "..", "public");
    git(scratch.dir, "init", "-q", into);
    write(into, ".git/objects/info/alternates", `${join(fixture.repo, ".git/objects")}\n`);
    expect(() => exportInit(fixture, { noGitleaks: true, gitleaks: undefined })).toThrow("alternates");
    expect(namesPrivateRepository("https://github.com/cambridgetcg/agenttool.git")).toBe(true);
    expect(namesPrivateRepository("git@github.com:cambridgetcg/agenttool")).toBe(true);
    expect(namesPrivateRepository(`https://github.com/${PUBLIC_REPOSITORY}.git`)).toBe(false);
    expect(namesPrivateRepository("https://github.com/cambridgetcg/agenttool-packages.git")).toBe(false);
  });
});

describe("an upstream export into an existing public clone", () => {
  const fixture = fresh();
  const { into } = exportInit(fixture, { commit: true });
  const exportUpstream = (extra: Partial<ExportOptions>) =>
    runExport({ mode: "upstream", repo: fixture.repo, source: "HEAD", into, guardDir: fixture.guardDir, allowUnmergedSource: true, gitleaks: GITLEAKS, ...extra });

  test("writes only the named paths on a new branch, keeps what the public side added, and proves identity", () => {
    write(into, "packages/alpha/public-only.ts", "export const p = 1;\n");
    publicCommit(into, "a public change");
    write(fixture.repo, "packages/alpha/index.ts", "export const alpha = 2;\n");
    write(fixture.repo, "packages/alpha/fix.ts", "export const fix = 1;\n");
    write(fixture.repo, "docs/spec.md", "# Spec v2\n");
    commitAll(fixture.repo, "a fix to upstream");
    const receipt = exportUpstream({ branch: "upstream/fix", paths: ["packages/alpha"], commit: true, message: "Fix alpha" });
    expect(receipt.branch).toBe("upstream/fix");
    expect(git(into, "show", "--name-status", "--format=", "HEAD").split("\n").sort()).toEqual(["A\tpackages/alpha/fix.ts", "M\tpackages/alpha/index.ts"]);
    expect(existsSync(join(into, "packages/alpha/public-only.ts"))).toBe(true);
    expect(git(into, "show", "HEAD:docs/spec.md")).toBe("# Spec");
    expect(git(into, "log", "-1", "--format=%s%n%b")).toContain("Exported-From:");
    git(into, "switch", "-q", "main");
  });

  test("deletes a named file the source no longer holds", () => {
    git(fixture.repo, "rm", "-q", "packages/alpha/run.sh");
    commitAll(fixture.repo, "drop run.sh");
    exportUpstream({ branch: "upstream/drop", paths: ["packages/alpha/run.sh"], commit: true, message: "Drop run.sh" });
    expect(git(into, "show", "--name-status", "--format=", "HEAD")).toBe("D\tpackages/alpha/run.sh");
    git(into, "switch", "-q", "main");
  });

  test("refuses paths outside the scope, the withheld wallet, a dirty clone, an existing branch, and a missing --paths", () => {
    expect(() => exportUpstream({ branch: "u1", paths: ["private/notes.md"] })).toThrow("can never be shared");
    expect(() => exportUpstream({ branch: "u2", paths: ["bin/private-tool.ts"] })).toThrow("outside the shared scope");
    expect(() => exportUpstream({ branch: "u3", paths: ["packages/wallet"] })).toThrow("withheld");
    expect(() => exportUpstream({ branch: "upstream/fix", paths: ["packages/alpha"] })).toThrow("already exists");
    expect(() => exportUpstream({ branch: "u4" })).toThrow("needs --paths");
    write(into, "stray.txt", "x\n");
    expect(() => exportUpstream({ branch: "u5", paths: ["packages/alpha"] })).toThrow("uncommitted or untracked");
  });
});

describe("the CLI and the real tree", () => {
  test("the CLI prints a receipt, and on refusal prints rule ids and line hashes but never the term", () => {
    const fixture = fresh({ "packages/alpha/notes.md": `about ${TERM}\n` });
    const into = join(fixture.repo, "..", "public");
    const cli = run(fixture.repo, process.execPath, [EXPORT, "--init", "--source", "HEAD", "--into", into, "--repo", fixture.repo, "--guard-dir", fixture.guardDir, "--allow-unmerged-source", "--no-gitleaks"]);
    expect(cli.status).toBe(1);
    expect(cli.stderr).toMatch(/^packages\/alpha\/notes\.md:1: relational\/r01 line_sha256=[0-9a-f]{64}$/mu);
    expect(cli.out.toLowerCase()).not.toContain(TERM);
    const ok = fresh();
    const good = run(ok.repo, process.execPath, [EXPORT, "--init", "--source", "HEAD", "--into", join(ok.repo, "..", "public"), "--repo", ok.repo, "--guard-dir", ok.guardDir, "--allow-unmerged-source", "--gitleaks", GITLEAKS, "--commit"]);
    expect(good.status, good.out).toBe(0);
    expect(JSON.parse(good.stdout)).toMatchObject({ mode: "init", identity: "proven", files: 12, excluded: ["packages/wallet"] });
  });

  test("this checkout's committed tree exports with the real guard, wallet withheld (gitleaks proven separately)", () => {
    if (run(ROOT, "git", ["cat-file", "-e", "HEAD:private/guard/literal-sha256.json"]).status !== 0) return;
    const into = join(scratch.dir, "real-export");
    const receipt = runExport({ mode: "init", repo: ROOT, source: "HEAD", into, allowUnmergedSource: true, noGitleaks: true });
    expect(receipt.identity).toBe("proven");
    expect(receipt.excluded).toEqual(["packages/wallet"]);
    expect(existsSync(join(into, "packages/wallet"))).toBe(false);
    expect(existsSync(join(into, "private"))).toBe(false);
    expect(lstatSync(join(into, "tools/githooks/pre-push")).mode & 0o111).not.toBe(0);
  });
});
