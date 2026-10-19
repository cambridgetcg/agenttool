/**
 * The private relational scanner: literal-needing rules that load their terms
 * at run time (critic MUST 1), and output that never echoes a term.
 */
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { join } from "node:path";
import { lineSha256 } from "../../../tools/public-guard.ts";
import {
  addLiteral,
  gitBlobId,
  githubFindings,
  githubTexts,
  GuardMissing,
  literalHits,
  loadPrivateGuard,
  nameFindings,
  parseLiterals,
  scanCommits,
  scanFiles,
  scanTree,
} from "../relational-scan.ts";
import { ACCOUNT_WORD, commitAll, DENYLIST, git, makePrivateRepo, OWNER_ADDRESS, publicCommit, ROOT, run, scratchDir, TERM, WITHHELD, write } from "./fixtures.ts";

setDefaultTimeout(60_000);
const scratch = scratchDir("relational");
afterAll(scratch.cleanup);
const fixture = makePrivateRepo(scratch.dir);
const guard = loadPrivateGuard(fixture.guardDir);
const SCANNER = join(ROOT, "private/bin/relational-scan.ts");
const rules = (findings: ReadonlyArray<{ rule: string }>) => [...new Set(findings.map((finding) => finding.rule))].sort();
const file = (path: string, text: string | Uint8Array) => {
  const bytes = typeof text === "string" ? Buffer.from(text) : Buffer.from(text);
  return { path, mode: "100644", oid: gitBlobId(bytes), bytes };
};

/** A fresh public-side repository with one clean root commit. */
function publicRepo(name: string): string {
  const repo = join(scratch.dir, name);
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "--initial-branch=main");
  write(repo, "README.md", "# Public\n");
  publicCommit(repo, "root");
  return repo;
}

describe("loading the private guard", () => {
  test("every file is required: a missing denylist, literal list, or canary refuses", () => {
    for (const missing of ["guard/relational-denylist.json", "guard/literal-sha256.json", "CANARY"]) {
      const dir = join(scratch.dir, `partial-${missing.replace(/\W/gu, "-")}`);
      mkdirSync(join(dir, "guard"), { recursive: true });
      for (const path of ["guard/relational-denylist.json", "guard/literal-sha256.json", "CANARY"]) {
        if (path !== missing) copyFileSync(join(fixture.repo, "private", path), join(dir, path));
      }
      expect(() => loadPrivateGuard(join(dir, "guard"))).toThrow(GuardMissing);
      const cli = run(scratch.dir, process.execPath, [SCANNER, "--guard-dir", join(dir, "guard"), "--ref-name", "x"]);
      expect(cli.status, missing).toBe(2);
      expect(cli.stderr).toContain("refuses");
    }
  });

  test("the literal list is strict and its ids may not collide with the denylist", () => {
    expect(() => parseLiterals(Buffer.from('{"schema":"agenttool.private-literal-sha256/1","note":"x","literals":[],"allow":[]}'))).toThrow("non-empty");
    expect(() =>
      parseLiterals(Buffer.from(JSON.stringify({ schema: "agenttool.private-literal-sha256/1", note: "x", literals: [{ id: "x1", kind: "word", sha256: "0".repeat(64), reason: "r" }], allow: [] }))),
    ).toThrow("unique l<number>");
  });

  test("the real guard loads in code, and the real shared root files hold none of its terms or literals", () => {
    const real = loadPrivateGuard(join(ROOT, "private/guard"));
    expect(real.denylist.rules.length).toBeGreaterThan(0);
    expect(real.literals.email.size + real.literals.word.size).toBeGreaterThan(0);
    const roots = (JSON.parse(readFileSync(join(ROOT, "private/projection/allowlist.json"), "utf8")) as { export: { root_files: string[] } }).export.root_files;
    const files = roots.map((path) => file(path, readFileSync(join(ROOT, path))));
    expect(scanFiles(files, real).findings.map((finding) => `${finding.path}:${finding.rule}`)).toEqual([]);
  });

  test("with the real terms, a seeded account-name hit is found and never printed", () => {
    const account = userInfo().username.toLowerCase();
    const real = loadPrivateGuard(join(ROOT, "private/guard"));
    // Only meaningful on a machine whose account name the list holds.
    if (literalHits(account, real.literals).size === 0) return;
    const repo = publicRepo("seeded");
    write(repo, "notes.md", `built on ${account} today\n`);
    publicCommit(repo, "seed");
    const cli = run(repo, process.execPath, [SCANNER, "--repo", repo, "--guard-dir", join(ROOT, "private/guard"), "--diff", "--", "HEAD~1..HEAD"]);
    expect(cli.status).toBe(1);
    expect(cli.stdout).toMatch(/^notes\.md:1: relational\/l\d+ line_sha256=[0-9a-f]{64}$/mu);
    expect(cli.out.toLowerCase()).not.toContain(account);
  });
});

describe("text, names, and blobs", () => {
  test("a relational term, an owner address, and an account word are found by id and line hash only", () => {
    const text = `ok\nthis line has a ${TERM.toUpperCase()} in it\nmail ${OWNER_ADDRESS.toUpperCase()}\nhome /x/${ACCOUNT_WORD}/y\n`;
    const { findings } = scanFiles([file("docs/a.md", text)], guard);
    expect(findings.map((finding) => `${finding.line} ${finding.rule}`)).toEqual(["2 relational/r01", "3 relational/l01", "4 relational/l02"]);
    expect(findings[0]?.lineSha256).toBe(lineSha256(`this line has a ${TERM.toUpperCase()} in it`));
  });

  test("encoded readings are scanned too", () => {
    const encoded = TERM.replace(" ", "%20");
    expect(rules(scanFiles([file("docs/b.md", `see ${encoded}\n`)], guard).findings)).toEqual(["relational/r01"]);
    expect(rules(scanFiles([file("docs/c.md", `${ACCOUNT_WORD.slice(0, 3)}\\u00${ACCOUNT_WORD.charCodeAt(3).toString(16)}${ACCOUNT_WORD.slice(4)}\n`)], guard).findings)).toEqual(["relational/l02"]);
  });

  test("path and ref names: joined words are caught and the name is printed only as a hash", () => {
    const joined = TERM.replace(" ", "_");
    const findings = nameFindings("path", `docs/${joined}-notes.md`, guard);
    expect(rules(findings)).toEqual(["relational/r01"]);
    expect(findings[0]?.path).toMatch(/^path-sha256:[0-9a-f]{12}$/u);
    expect(rules(nameFindings("ref", `refs/heads/${TERM.replace(" ", "-")}`, guard))).toEqual(["relational/r01"]);
    expect(rules(nameFindings("ref", `refs/heads/${ACCOUNT_WORD}Branch`, guard))).toEqual(["relational/l02"]);
    expect(nameFindings("path", "packages/alpha/index.ts", guard)).toEqual([]);
  });

  test("the canary, the denylist's own bytes, and withheld files are found by identity", () => {
    const denylistBytes = readFileSync(join(fixture.guardDir, "relational-denylist.json"));
    const found = scanFiles([file("x/canary.bin", fixture.canary), file("x/words.json", denylistBytes), file("x/corpus.txt", WITHHELD)], guard).findings;
    expect(found.map((finding) => `${finding.path} ${finding.rule}`).filter((line) => !line.includes("relational/r01"))).toEqual([
      "x/canary.bin relational/canary",
      "x/corpus.txt relational/b01",
      "x/words.json relational/denylist-copy",
    ]);
  });

  test("allow entries silence an exact line; in a whole-tree scan an unused entry is an allow miss, reported apart", () => {
    const line = `an approved ${TERM} line`;
    const allowed = { ...guard, allow: [{ path: "docs/a.md", rule: "relational/r01", line_sha256: lineSha256(line), reason: "fixture", approver: "fixture" }] };
    expect(scanFiles([file("docs/a.md", `${line}\n`)], allowed, { wholeTree: true })).toEqual({ findings: [], allowMisses: [] });
    const moved = scanFiles([file("docs/a.md", `${line}, edited\n`)], allowed, { wholeTree: true });
    expect(rules(moved.findings)).toEqual(["relational/r01"]);
    expect(rules(moved.allowMisses)).toEqual(["integrity/unused-allow-entry"]);
    // Outside a whole-tree scan an entry for a file not scanned is simply not applicable.
    expect(scanFiles([file("docs/other.md", "clean\n")], allowed)).toEqual({ findings: [], allowMisses: [] });
  });
});

describe("commits, refs, tags, and the CLI", () => {
  const repo = publicRepo("commits");
  const base = git(repo, "rev-parse", "HEAD");
  write(repo, "src/a.ts", "export const a = 1;\n");
  publicCommit(repo, "clean change");
  const clean = git(repo, "rev-parse", "HEAD");

  test("a clean range is clean, by API and CLI", () => {
    expect(scanCommits(repo, [`${base}..${clean}`], guard, { diff: true, messages: true, names: true, objects: true, shapes: true })).toEqual([]);
    const cli = run(repo, process.execPath, [SCANNER, "--repo", repo, "--guard-dir", fixture.guardDir, "--diff", "--messages", "--names", "--objects", "--shapes", "--ref-name", "refs/heads/main", "--", `${base}..${clean}`]);
    expect(cli.status, cli.out).toBe(0);
  });

  test("added lines carry their new-file line numbers; a merge is read against its first parent", () => {
    git(repo, "switch", "-q", "-c", "side");
    write(repo, "src/a.ts", `export const a = 1;\n// ${TERM}\n`);
    publicCommit(repo, "side");
    git(repo, "switch", "-q", "main");
    write(repo, "src/b.ts", "export const b = 2;\n");
    publicCommit(repo, "main moves");
    const merge = run(repo, "git", ["-c", "user.name=AgentTool", "-c", "user.email=contact@cambridgetcg.com", "merge", "-q", "--no-ff", "-m", "merge side", "side"]);
    expect(merge.status, merge.stderr).toBe(0);
    const findings = scanCommits(repo, ["HEAD^1..HEAD"], guard, { diff: true });
    expect(findings.map((finding) => `${finding.path}:${finding.line} ${finding.rule}`)).toEqual(["src/a.ts:2 relational/r01"]);
    git(repo, "reset", "-q", "--hard", clean);
    git(repo, "branch", "-q", "-D", "side");
  });

  test("messages, identity headers, added names, binary objects, and the canary are each scanned", () => {
    write(repo, "ok.md", "ok\n");
    commitAll(repo, `note about ${TERM}`, { name: "AgentTool", email: "contact@cambridgetcg.com" });
    write(repo, "ok2.md", "ok\n");
    commitAll(repo, "fine", { name: "Someone", email: OWNER_ADDRESS });
    write(repo, `docs/${TERM.replace(" ", "-")}.md`, "plain\n");
    write(repo, "bin.dat", Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(` ${TERM} `), Buffer.from([0])]));
    write(repo, "copied/CANARY", fixture.canary);
    publicCommit(repo, "names and objects");
    const findings = scanCommits(repo, [`${clean}..HEAD`], guard, { diff: true, messages: true, names: true, objects: true });
    const lines = findings.map((finding) => `${finding.path.replace(/[0-9a-f]{12}/gu, "<id>")} ${finding.rule}`);
    expect(lines).toContain("commit:<id>:message relational/r01");
    expect(lines).toContain("commit:<id>:author relational/l01");
    expect(lines).toContain("bin.dat relational/r01");
    expect(lines).toContain("copied/CANARY relational/canary");
    expect(lines.some((line) => /^path-sha256:<id> relational\/r01$/u.test(line))).toBe(true);
    const cli = run(repo, process.execPath, [SCANNER, "--repo", repo, "--guard-dir", fixture.guardDir, "--diff", "--messages", "--names", "--objects", "--", `${clean}..HEAD`]);
    expect(cli.status).toBe(1);
    expect(cli.out.toLowerCase()).not.toContain(TERM);
    expect(cli.out.toLowerCase()).not.toContain(OWNER_ADDRESS);
    git(repo, "reset", "-q", "--hard", clean);
  });

  test("shapes add the public secret and personal rules to added lines, with the tree's allow file", () => {
    write(repo, "creds.md", `token at_${"A1b2C3d4".repeat(6)}\n`);
    publicCommit(repo, "a token");
    expect(rules(scanCommits(repo, [`${clean}..HEAD`], guard, { diff: true }))).toEqual([]);
    expect(rules(scanCommits(repo, [`${clean}..HEAD`], guard, { diff: true, shapes: true }))).toEqual(["secret/agenttool-token"]);
    git(repo, "reset", "-q", "--hard", clean);
  });

  test("an annotated tag's message is scanned; a lightweight tag has none", () => {
    git(repo, "-c", "user.name=AgentTool", "-c", "user.email=contact@cambridgetcg.com", "tag", "-a", "v1", "-m", `release ${TERM}`);
    git(repo, "tag", "v2");
    const cli = run(repo, process.execPath, [SCANNER, "--repo", repo, "--guard-dir", fixture.guardDir, "--tag", "v1", "--tag", "v2"]);
    expect(cli.status).toBe(1);
    expect(cli.stdout).toMatch(/^tag:[0-9a-f]{12}:message:1: relational\/r01 line_sha256=/mu);
    git(repo, "tag", "-d", "v1", "v2");
  });

  test("a whole-tree scan reports allow misses apart from hits", () => {
    const result = scanTree(repo, "HEAD", guard);
    expect(result).toEqual({ findings: [], allowMisses: [] });
  });

  test("text on standard input", () => {
    const cli = run(repo, process.execPath, [SCANNER, "--guard-dir", fixture.guardDir, "--text", "pr-draft"], { input: `title\nbody with ${TERM}\n` });
    expect(cli.status).toBe(1);
    expect(cli.stdout).toMatch(/^pr-draft:2: relational\/r01 line_sha256=[0-9a-f]{64}$/mu);
  });
});

describe("pull request and issue text through GET only", () => {
  test("reads titles, bodies, reviews, and comments, and finds hits by label", () => {
    const calls: string[][] = [];
    const responses: Record<string, string> = {
      rate_limit: "4000\n",
      "repos/example/shared/issues?state=all&per_page=100&since=2026-10-18T00:00:00Z": [
        JSON.stringify({ number: 3, title: "fine", body: `has ${TERM}`, pull_request: {} }),
        JSON.stringify({ number: 4, title: `mail ${OWNER_ADDRESS}`, body: null }),
      ].join("\n"),
      "repos/example/shared/pulls/3/reviews?per_page=100": JSON.stringify({ id: 9, body: "looks good" }),
      "repos/example/shared/issues/comments?per_page=100&since=2026-10-18T00:00:00Z": JSON.stringify({ id: 11, body: `see ${ACCOUNT_WORD}` }),
      "repos/example/shared/pulls/comments?per_page=100&since=2026-10-18T00:00:00Z": "",
    };
    const gh = (args: readonly string[]) => {
      calls.push([...args]);
      const endpoint = args.find((arg) => arg.startsWith("repos/") || arg === "rate_limit") ?? "";
      if (!(endpoint in responses)) throw new Error(`unexpected ${endpoint}`);
      return responses[endpoint] as string;
    };
    const texts = githubTexts("example/shared", { since: "2026-10-18T00:00:00Z", gh });
    expect(githubFindings(texts, guard).map((finding) => `${finding.path}:${finding.line} ${finding.rule}`)).toEqual([
      "issue#4:title:1 relational/l01",
      "issue-comment:11:1 relational/l02",
      "pr#3:body:1 relational/r01",
    ]);
    expect(calls[0]).toEqual(["rate_limit", "--jq", ".resources.core.remaining"]);
  });

  test("stops before reading when the rate limit is low, and the CLI asks gh for GET explicitly", () => {
    expect(() => githubTexts("example/shared", { gh: () => "120\n" })).toThrow("below 500");
    const source = readFileSync(SCANNER, "utf8");
    expect(source).toContain('spawnSync("gh", ["api", "--method", "GET", ...args]');
    expect(source).not.toMatch(/--method["', ]+(?:POST|PATCH|PUT|DELETE)/u);
  });
});

describe("add-literal", () => {
  test("appends a digest from standard input without echoing the value", () => {
    const dir = join(scratch.dir, "literal-guard");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "literal-sha256.json"), readFileSync(join(fixture.guardDir, "literal-sha256.json")));
    const cli = run(scratch.dir, process.execPath, [SCANNER, "add-literal", "--guard-dir", dir, "--kind", "word", "--id", "l03", "--reason", "fixture"], { input: "SecondMachine\n" });
    expect(cli.status, cli.out).toBe(0);
    expect(cli.out.toLowerCase()).not.toContain("secondmachine");
    const literals = parseLiterals(readFileSync(join(dir, "literal-sha256.json")));
    expect(literalHits("built on secondmachine", literals)).toEqual(new Set(["l03"]));
    expect(() => addLiteral(dir, { kind: "word", id: "l04", reason: "dup", value: "secondmachine" })).toThrow("already listed");
    expect(() => addLiteral(dir, { kind: "word", id: "l05", reason: "x", value: "two words" })).toThrow("one non-empty token");
    rmSync(dir, { recursive: true, force: true });
    expect(existsSync(dir)).toBe(false);
  });
});

test("the fixture denylist is the one these tests assume", () => {
  expect(DENYLIST.terms[0]?.pattern).toBe(TERM);
});
