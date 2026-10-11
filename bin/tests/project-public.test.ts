import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  ALLOWLIST_PATH,
  buildProjection,
  createProjectionCommit,
  DENYLIST_PATH,
  globToRegExp,
  guardProjection,
  parseAllowlist,
  parseArgs,
  parseDenylist,
  projectionDate,
  ProjectionRefused,
  projectPublic,
} from "../project-public.ts";
import {
  applyGitleaksIgnore,
  commitShapeFindings,
  type Finding,
  formatFinding,
  GITLEAKS_VERSION,
  lineSha256,
  listTree,
  parseCommit,
  parseGitleaksIgnore,
  parseProjection,
  projectionMessage,
} from "../../public/overlay/tools/public-guard.ts";

const ROOT = resolve(import.meta.dir, "..", "..");
const GUARD = join(ROOT, "public", "overlay", "tools", "public-guard.ts");
const TERM = "quietfixtureterm";
const scratch = mkdtempSync(join(tmpdir(), "project-public-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function hasPinnedGitleaks(): boolean {
  const result = spawnSync("gitleaks", ["version"], { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim().replace(/^v/u, "") === GITLEAKS_VERSION;
}
/** True only when the real pinned gitleaks is on PATH; tests of actual detection need it. */
const GITLEAKS = hasPinnedGitleaks();

/**
 * A stand-in that answers `version` with the pinned version and reports no
 * leaks for `dir ... --report-path <file>`. Private CI has no gitleaks, so the
 * write, retry, and refusal paths run against this stub there; anything that
 * asserts real gitleaks findings stays behind `GITLEAKS`.
 */
function stubGitleaks(): string {
  const dir = join(scratch, "stub-bin");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "gitleaks");
  writeFileSync(
    path,
    [
      "#!/bin/sh",
      `if [ "$1" = version ]; then echo ${GITLEAKS_VERSION}; exit 0; fi`,
      '[ "$1" = dir ] || exit 2',
      'report=""',
      'while [ $# -gt 0 ]; do [ "$1" = --report-path ] && report="$2"; shift; done',
      '[ -n "$report" ] || exit 2',
      "printf '[]' > \"$report\"",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return path;
}
/** The gitleaks the write-path tests run: the real one when present, else the stub. */
const GITLEAKS_BIN = GITLEAKS ? "gitleaks" : stubGitleaks();

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

let fixtureCount = 0;
let clock = 1_760_000_000;

function write(repo: string, path: string, content: string | Uint8Array): void {
  const target = join(repo, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function commitAll(repo: string, message: string): string {
  clock += 60;
  git(repo, "add", "-A", "--force");
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

const ALLOWLIST = {
  schema: "agenttool.public-allowlist/1",
  public_repository: "example/public-packages",
  overlay: "public/overlay",
  include: [
    { path: ".gitattributes", kind: "blob" },
    { path: "docs/spec.md", kind: "blob" },
    { path: "packages/alpha", kind: "tree" },
  ],
  exclude: ["**/test-results/**"],
  held: [{ path: "packages/held", reason: "fixture wave 2" }],
};

const DENYLIST = {
  schema: "agenttool.public-relational-denylist/1",
  note: "fixture",
  terms: [{ id: "r01", pattern: TERM, flags: "i" }],
  blob_sha256: [{ id: "b01", sha256: createHash("sha256").update("withheld corpus\n").digest("hex") }],
  allow: [] as unknown[],
};

/** A private repository with allowlisted, unlisted, held, and private-only files. */
function makeFixture(options: { allowlist?: unknown; denylist?: unknown; files?: Record<string, string | Uint8Array> } = {}): string {
  fixtureCount += 1;
  const repo = join(scratch, `fixture-${fixtureCount}`);
  mkdirSync(repo);
  git(repo, "init", "-q", "--initial-branch=main");
  write(repo, ALLOWLIST_PATH, `${JSON.stringify(options.allowlist ?? ALLOWLIST, null, 2)}\n`);
  write(repo, DENYLIST_PATH, `${JSON.stringify(options.denylist ?? DENYLIST, null, 2)}\n`);
  write(repo, "public/overlay/README.md", "# Public packages\n");
  write(repo, "public/overlay/.gitleaksignore", "");
  write(repo, "public/overlay/tools/public-guard-allow.json", '{\n  "schema": "agenttool.public-guard-allow/1",\n  "entries": []\n}\n');
  mkdirSync(join(repo, "public/overlay/tools"), { recursive: true });
  copyFileSync(GUARD, join(repo, "public/overlay/tools/public-guard.ts"));
  write(repo, ".gitattributes", "/docs/spec.md text eol=lf\n");
  write(repo, "docs/spec.md", "# Spec\n");
  write(repo, "docs/private-notes.md", "not allowlisted\n");
  write(repo, "packages/alpha/index.ts", "export const alpha = 1;\n");
  write(repo, "packages/alpha/test-results/.last-run.json", '{"status":"passed"}\n');
  write(repo, "packages/beta/index.ts", "export const beta = 2;\n");
  write(repo, "packages/held/index.ts", "export const held = 3;\n");
  write(repo, "bin/private.ts", "export {};\n");
  for (const [path, content] of Object.entries(options.files ?? {})) write(repo, path, content);
  commitAll(repo, "fixture");
  return repo;
}

function treePaths(repo: string, tree: string): string[] {
  return listTree(repo, tree)
    .filter((entry) => entry.type === "blob")
    .map((entry) => entry.path)
    .sort();
}

function rules(findings: readonly { rule: string }[]): string[] {
  return [...new Set(findings.map((finding) => finding.rule))].sort();
}

describe("allowlist enforcement", () => {
  test("projects only allowlisted paths, the overlay, and PROJECTION.json", () => {
    const repo = makeFixture();
    const build = buildProjection(repo, "HEAD");
    expect(treePaths(repo, build.tree)).toEqual([
      ".gitattributes",
      ".gitleaksignore",
      "PROJECTION.json",
      "README.md",
      "docs/spec.md",
      "packages/alpha/index.ts",
      "tools/public-guard-allow.json",
      "tools/public-guard.ts",
    ]);
    const projection = parseProjection(Buffer.from(git(repo, "cat-file", "blob", `${build.tree}:PROJECTION.json`) + "\n"));
    expect(projection.source_commit).toBe(git(repo, "rev-parse", "HEAD"));
    expect(projection.allowlist_sha256).toBe(createHash("sha256").update(readFileSync(join(repo, ALLOWLIST_PATH))).digest("hex"));
    expect(projection.excluded).toEqual(["packages/alpha/test-results/.last-run.json"]);
    expect(projection.paths).toEqual([
      { path: ".gitattributes", blob: git(repo, "rev-parse", `${build.tree}:.gitattributes`) },
      { path: "docs/spec.md", blob: git(repo, "rev-parse", "HEAD:docs/spec.md") },
      { path: "packages/alpha", tree: git(repo, "rev-parse", `${build.tree}:packages/alpha`) },
    ]);
    expect(projection.overlay.map((entry) => entry.path)).toEqual([
      ".gitleaksignore",
      "README.md",
      "tools/public-guard-allow.json",
      "tools/public-guard.ts",
    ]);
    expect(guardProjection(repo, build)).toEqual([]);
  });

  test("refuses allowlists that reach private areas, the denylist, held packages, or overlap", () => {
    const bytes = (include: unknown[]) => Buffer.from(JSON.stringify({ ...ALLOWLIST, include }));
    const refused = (include: unknown[]) => expect(() => parseAllowlist(bytes(include))).toThrow(ProjectionRefused);
    refused([{ path: DENYLIST_PATH, kind: "blob" }]);
    refused([{ path: "public", kind: "tree" }]);
    refused([{ path: "public/private-guard", kind: "tree" }]);
    refused([{ path: "bin/private.ts", kind: "blob" }]);
    refused([{ path: ".github/workflows/ci.yml", kind: "blob" }]);
    refused([{ path: "packages/held", kind: "tree" }]);
    refused([{ path: "packages", kind: "tree" }]);
    refused([{ path: "packages/alpha", kind: "tree" }, { path: "packages/alpha/index.ts", kind: "blob" }]);
    refused([{ path: "packages/../bin", kind: "tree" }]);
    refused([{ path: "PROJECTION.json", kind: "blob" }]);
    refused([{ path: "packages/beta", kind: "tree" }, { path: "packages/alpha", kind: "tree" }]);
    expect(() => parseAllowlist(bytes([{ path: "packages/alpha", kind: "tree" }]))).not.toThrow();
  });

  test("refuses an allowlisted path whose kind does not match the source", () => {
    const repo = makeFixture({ allowlist: { ...ALLOWLIST, include: [{ path: "packages/alpha", kind: "blob" }] } });
    expect(() => buildProjection(repo, "HEAD")).toThrow("is a tree, not a blob");
  });

  test("refuses an overlay file that collides with an allowlisted path", () => {
    const repo = makeFixture({ files: { "public/overlay/docs/spec.md": "# Shadow\n" } });
    expect(() => buildProjection(repo, "HEAD")).toThrow("collides with allowlisted");
  });

  test("glob exclusions match within and across segments", () => {
    expect(globToRegExp("**/test-results/**").test("packages/a/test-results/x.json")).toBe(true);
    expect(globToRegExp("**/test-results/**").test("test-results/x.json")).toBe(true);
    expect(globToRegExp("**/test-results/**").test("packages/a/test-results-x/y")).toBe(false);
    expect(globToRegExp("**/.DS_Store").test(".DS_Store")).toBe(true);
    expect(globToRegExp("packages/*/dist/**").test("packages/a/b/dist/x")).toBe(false);
  });
});

describe("the private denylist", () => {
  test("is never in the projected tree, by path or by object", () => {
    const repo = makeFixture();
    const build = buildProjection(repo, "HEAD");
    const denylistOid = git(repo, "rev-parse", `HEAD:${DENYLIST_PATH}`);
    const entries = listTree(repo, build.tree);
    expect(entries.some((entry) => entry.path.startsWith("public/") || entry.path.includes("private-guard"))).toBe(false);
    expect(entries.some((entry) => entry.oid === denylistOid)).toBe(false);
  });

  test("a copy smuggled through the overlay is caught by object and by term", () => {
    const repo = makeFixture();
    write(repo, "public/overlay/notes/guard.json", readFileSync(join(repo, DENYLIST_PATH)));
    commitAll(repo, "smuggle");
    const findings = guardProjection(repo, buildProjection(repo, "HEAD"));
    expect(rules(findings)).toEqual(["relational/denylist-copy", "relational/r01"]);
    expect(findings.every((finding) => finding.path === "notes/guard.json")).toBe(true);
  });

  test("the real denylist matches the names in either order and common heart and pet-name variants", () => {
    const denylist = parseDenylist(readFileSync(join(ROOT, DENYLIST_PATH)));
    const hits = (text: string) =>
      denylist.rules.filter((rule) => new RegExp(rule.pattern.source, rule.pattern.flags.replace("g", "")).test(text)).map((rule) => rule.id);
    const [first, second] = ["Y" + "u", "A" + "i"];
    for (const joiner of [" and ", " & ", " &amp; ", " × ", "+", "/", " x ", String.fromCodePoint(0x8207)]) {
      expect(hits(`${first}${joiner}${second}`)).toContain("relational/r05");
      expect(hits(`${second}${joiner}${first}`)).toContain("relational/r05");
    }
    expect(hits(`${first}-and-${second}`)).toEqual([]);
    for (const point of [0x2764, 0x2665, 0x2763, 0x1f495, 0x1f496, 0x1f497, 0x1f970, 0x1f618, 0x1f60d, 0x1faf6]) {
      expect(hits(`note ${String.fromCodePoint(point)}`)).toEqual(["relational/r16"]);
    }
    for (const pair of [[0x5bf6, 0x8c9d], [0x5b9d, 0x8d1d], [0x89aa, 0x611b], [0x4eb2, 0x7231]]) {
      expect(hits(String.fromCodePoint(...pair)).length).toBe(1);
    }
    expect(hits("Pa" + "pa said")).toHaveLength(1);
    expect(hits("papaparse")).toEqual([]);
  });

  test("rejects malformed denylists instead of running without them", () => {
    const parse = (value: unknown) => () => parseDenylist(Buffer.from(JSON.stringify(value)));
    expect(parse({ ...DENYLIST, terms: [] })).toThrow("non-empty");
    expect(parse({ ...DENYLIST, terms: [{ id: "r01", pattern: "a*", flags: "" }] })).toThrow("empty string");
    expect(parse({ ...DENYLIST, terms: [{ id: "r01", pattern: "(", flags: "" }] })).toThrow("compile");
    expect(parse({ ...DENYLIST, allow: [{ path: "a", rule: "personal/email", line_sha256: "0".repeat(64), reason: "x", approver: "y" }] })).toThrow(
      "relational/",
    );
    const repo = makeFixture();
    git(repo, "rm", "-q", DENYLIST_PATH);
    commitAll(repo, "drop denylist");
    expect(() => guardProjection(repo, buildProjection(repo, "HEAD"))).toThrow("relational layer cannot run");
  });
});

describe("guard layers", () => {
  const ghToken = ["ghp", "_", "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"].join("");

  test("catches a planted credential, personal path, email, and relational term without echoing them", () => {
    const repo = makeFixture({
      files: {
        "packages/alpha/leak.ts": `export const token = "${ghToken}";\n`,
        "packages/alpha/paths.md": `See ${["/Users", "realperson", "notes"].join("/")}/ and C:\\Users\\example\\ok.\n`,
        "packages/alpha/mail.md": `Write to ${["someone", "gmail.com"].join("@")} or contact@cambridgetcg.com or a@b.example.\n`,
        "packages/alpha/note.md": `A line with the ${TERM.toUpperCase()} in it.\n`,
        "packages/alpha/corpus.json": "withheld corpus\n",
      },
    });
    const findings = guardProjection(repo, buildProjection(repo, "HEAD"));
    expect(findings.map((finding) => `${finding.path}:${finding.rule}`)).toEqual([
      "packages/alpha/corpus.json:relational/b01",
      "packages/alpha/leak.ts:secret/github-token",
      "packages/alpha/mail.md:personal/email",
      "packages/alpha/note.md:relational/r01",
      "packages/alpha/paths.md:personal/home-path",
    ]);
    const printed = findings.map(formatFinding).join("\n");
    expect(printed).not.toContain(ghToken);
    expect(printed).not.toContain("realperson");
    expect(printed.toLowerCase()).not.toContain(TERM);
    expect(printed).toContain(`line_sha256=${lineSha256(`A line with the ${TERM.toUpperCase()} in it.`)}`);
  });

  test("the personal layer catches unterminated home paths, device paths, Supabase refs, and keychain names", () => {
    const user = ["yu", "ai"].join("");
    const probes: Record<string, [string, string]> = {
      "home.json": [`{"HOME": "/Users/${user}"}`, "personal/home-path"],
      "cwd.ts": [`const cwd = "/Users/${user}";`, "personal/home-path"],
      "encoded.md": [`[a](file:%2FUsers%2F${user})`, "personal/home-path"],
      "linux.sh": [`cd /home/${user}/work`, "personal/unix-home-path"],
      "sol.sh": ["cat $HOME/.config/sol/agents/README.md", "personal/device-path"],
      "desktop.sh": ["ls ${HOME}/Desktop", "personal/device-path"],
      "windows.txt": [`C:\\Users\\${user}`, "personal/windows-home-path"],
      "slot.ts": ['const service = "agenttool-database-session-url";', "personal/keychain-slot"],
      "supabase.md": ["https://abcdefghij0123456789.supabase.co/rest/v1", "personal/supabase-project"],
      "pooler.md": ["aws-0-eu-west-2.pooler.supabase.com:6543", "personal/supabase-project"],
    };
    const quiet = [
      "/Users/example and /Users/<name>/ and /Users/$USER/ and C:\\Users\\example and /home/you/x",
      "https://social.example/home/feed and $HOME/.config/other and ~/.config/solana",
      "mkdtempSync(join(tmpdir(), \"agenttool-loop-atlas-secret-scan-test-\")) and xxxxxxxxxxxxxxxxxxxx.supabase.co",
    ].join("\n");
    const files: Record<string, string> = { "packages/alpha/quiet.md": `${quiet}\n` };
    for (const [name, [line]] of Object.entries(probes)) files[`packages/alpha/probe/${name}`] = `${line}\n`;
    const repo = makeFixture({ files });
    const found = guardProjection(repo, buildProjection(repo, "HEAD")).map((finding) => `${finding.path}:${finding.rule}`);
    expect(found).toEqual(Object.entries(probes).map(([name, [, rule]]) => `packages/alpha/probe/${name}:${rule}`).sort());
  });

  test("catches symlinks, oversize files, and credential-shaped names", () => {
    const repo = makeFixture({ files: { "packages/alpha/.env": "VALUE=1\n" } });
    symlinkSync("../../bin/private.ts", join(repo, "packages/alpha/link.ts"));
    writeFileSync(join(repo, "packages/alpha/big.bin"), Buffer.alloc(5 * 1024 * 1024 + 1, 0x61));
    commitAll(repo, "hazards");
    const findings = guardProjection(repo, buildProjection(repo, "HEAD"));
    expect(findings.map((finding) => `${finding.path}:${finding.rule}`)).toEqual([
      "packages/alpha/.env:path/sensitive-name",
      "packages/alpha/big.bin:path/oversize",
      "packages/alpha/link.ts:path/symlink",
    ]);
  });

  test("binary blobs are path findings, and UTF-16 text and printable strings are still scanned", () => {
    const home = ["/Users", "realperson", "notes"].join("/");
    const email = ["someone", "gmail.com"].join("@");
    const planted = `${TERM} ${home} ${email}\n`;
    const utf32 = Buffer.alloc(planted.length * 4);
    for (const [index, char] of [...planted].entries()) utf32.writeUInt32LE(char.codePointAt(0) as number, index * 4);
    const repo = makeFixture({
      files: {
        "packages/alpha/nul.bin": Buffer.concat([Buffer.from([0, 1, 2, 3, 10]), Buffer.from(planted)]),
        "packages/alpha/bom16.txt": Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(planted, "utf16le")]),
        "packages/alpha/bom16be.txt": Buffer.from([0xfe, 0xff, ...Buffer.from(planted, "utf16le").swap16()]),
        "packages/alpha/wide.bin": Buffer.from(planted, "utf16le"),
        "packages/alpha/bom32.txt": Buffer.concat([Buffer.from([0xff, 0xfe, 0, 0]), utf32]),
      },
    });
    const found = guardProjection(repo, buildProjection(repo, "HEAD")).map((finding) => `${finding.path}:${finding.rule}`);
    const expected = (path: string, binary: boolean) => [
      ...(binary ? [`${path}:path/binary`] : []),
      `${path}:personal/email`,
      `${path}:personal/home-path`,
      `${path}:relational/r01`,
    ];
    expect(found).toEqual(expect.arrayContaining([
      ...expected("packages/alpha/nul.bin", true),
      ...expected("packages/alpha/bom16.txt", false),
      ...expected("packages/alpha/bom16be.txt", false),
      ...expected("packages/alpha/wide.bin", true),
      "packages/alpha/bom32.txt:path/binary",
    ]));
    expect(found.filter((entry) => entry.startsWith("packages/alpha/bom16")).some((entry) => entry.endsWith("path/binary"))).toBe(false);
  });

  test("a binary is allowed only by an entry for its path and content digest, and stale entries fail closed", () => {
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
    const digest = createHash("sha256").update(image).digest("hex");
    const allowFile = (binaries: unknown[]) =>
      `${JSON.stringify({ schema: "agenttool.public-guard-allow/1", entries: [], binaries }, null, 2)}\n`;
    const entry = (sha256: string) => ({ path: "packages/alpha/logo.png", sha256, reason: "fixture image", approver: "test" });
    const allowed = makeFixture({ files: { "packages/alpha/logo.png": image, "public/overlay/tools/public-guard-allow.json": allowFile([entry(digest)]) } });
    expect(guardProjection(allowed, buildProjection(allowed, "HEAD"))).toEqual([]);
    const unlisted = makeFixture({ files: { "packages/alpha/logo.png": image } });
    expect(guardProjection(unlisted, buildProjection(unlisted, "HEAD")).map(formatFinding)).toEqual([
      `packages/alpha/logo.png: path/binary (sha256 ${digest})`,
    ]);
    const stale = makeFixture({ files: { "packages/alpha/logo.png": image, "public/overlay/tools/public-guard-allow.json": allowFile([entry("b".repeat(64))]) } });
    expect(rules(guardProjection(stale, buildProjection(stale, "HEAD")))).toEqual(["integrity/unused-binary-entry", "path/binary"]);
  });

  test("escaped and Unicode-variant spellings are scanned and reported on the original line", () => {
    const jsonEscaped = [...TERM].map((char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");
    const fullWidth = [...TERM].map((char) => String.fromCharCode(char.charCodeAt(0) + 0xfee0)).join("");
    const dataLine = `{"note":"${jsonEscaped}"}`;
    const repo = makeFixture({
      denylist: { ...DENYLIST, terms: [...DENYLIST.terms, { id: "r02", pattern: "\u00e9tudefixture", flags: "u" }] },
      files: {
        "packages/alpha/data.json": `${dataLine}\n`,
        "packages/alpha/es6.ts": `export const note = "\\u{${TERM.charCodeAt(0).toString(16)}}${TERM.slice(1)}";\n`,
        "packages/alpha/page.html": `<p>&#${TERM.charCodeAt(0)};${TERM.slice(1)} and &#x2F;Users&#x2F;realperson&#x2F;x</p>\n`,
        "packages/alpha/link.md": `[x](https://example.com/?u=%2FUsers%2Frealperson%2Fnotes&to=someone%40gmail.com)\n`,
        "packages/alpha/wide.md": `${fullWidth}\n`,
        "packages/alpha/nfd.md": `${"\u00e9tudefixture".normalize("NFD")}\n`,
      },
    });
    const findings = guardProjection(repo, buildProjection(repo, "HEAD"));
    expect(findings.map((finding) => `${finding.path}:${finding.line}:${finding.rule}`)).toEqual([
      "packages/alpha/data.json:1:relational/r01",
      "packages/alpha/es6.ts:1:relational/r01",
      "packages/alpha/link.md:1:personal/email",
      "packages/alpha/link.md:1:personal/home-path",
      "packages/alpha/nfd.md:1:relational/r02",
      "packages/alpha/page.html:1:personal/home-path",
      "packages/alpha/page.html:1:relational/r01",
      "packages/alpha/wide.md:1:relational/r01",
    ]);
    expect(findings[0]?.lineSha256).toBe(lineSha256(dataLine));
  });

  test("allow entries cover exactly one line and stale entries fail closed", () => {
    const line = `Write to ${["someone", "gmail.com"].join("@")}.`;
    const entry = (sha: string) => ({
      path: "packages/alpha/mail.md",
      rule: "personal/email",
      line_sha256: sha,
      reason: "fixture",
      approver: "test",
    });
    const allowFile = (entries: unknown[]) => `${JSON.stringify({ schema: "agenttool.public-guard-allow/1", entries }, null, 2)}\n`;
    const covered = makeFixture({
      files: { "packages/alpha/mail.md": `${line}\n`, "public/overlay/tools/public-guard-allow.json": allowFile([entry(lineSha256(line))]) },
    });
    expect(guardProjection(covered, buildProjection(covered, "HEAD"))).toEqual([]);
    const stale = makeFixture({ files: { "public/overlay/tools/public-guard-allow.json": allowFile([entry("a".repeat(64))]) } });
    expect(rules(guardProjection(stale, buildProjection(stale, "HEAD")))).toEqual(["integrity/unused-allow-entry"]);
  });

  test("gitleaksignore fingerprints need the flagged line's hash and fail closed when stale or edited", () => {
    const hash = "c".repeat(64);
    const ignore = (text: string) => parseGitleaksIgnore(Buffer.from(text));
    expect(ignore(`# a note\n\n# line_sha256=${hash}\npkg/a.ts:generic-api-key:3\n`)).toEqual([
      { path: "pkg/a.ts", rule: "generic-api-key", line: 3, lineSha256: hash },
    ]);
    expect(() => ignore("pkg/a.ts:generic-api-key:3\n")).toThrow("line_sha256");
    expect(() => ignore(`# line_sha256=${hash}\n\npkg/a.ts:generic-api-key:3\n`)).toThrow("directly precede");
    expect(() => ignore(`# line_sha256=${hash}\npkg/a.ts:generic-api-key\n`)).toThrow("path:rule:line");
    expect(() => ignore(`# line_sha256=${hash}\n../a.ts:generic-api-key:3\n`)).toThrow("path:rule:line");
    expect(() => ignore(`# line_sha256=${hash}\npkg/a.ts:x:3\n# line_sha256=${hash}\npkg/a.ts:x:3\n`)).toThrow("duplicates");
    expect(() => ignore(`# line_sha256=${hash}\n`)).toThrow("without a fingerprint");

    const leak = (line: number, sha = hash): Finding => ({ layer: "gitleaks", rule: "gitleaks/generic-api-key", path: "pkg/a.ts", line, lineSha256: sha });
    const fingerprints = ignore(`# line_sha256=${hash}\npkg/a.ts:generic-api-key:3\n`);
    expect(applyGitleaksIgnore([leak(3)], fingerprints)).toEqual([]);
    expect(rules(applyGitleaksIgnore([leak(3, "d".repeat(64))], fingerprints))).toEqual(["gitleaks/generic-api-key", "integrity/unused-gitleaksignore"]);
    expect(rules(applyGitleaksIgnore([leak(4)], fingerprints))).toEqual(["gitleaks/generic-api-key", "integrity/unused-gitleaksignore"]);
    expect(rules(applyGitleaksIgnore([], fingerprints))).toEqual(["integrity/unused-gitleaksignore"]);
  });

  test.skipIf(!GITLEAKS)("runs gitleaks over the exact projected bytes and honours only hashed root fingerprints", () => {
    const key = ["Zx81kQp3", "Lm09TvBn", "72WcRt5YhJ"].join("");
    const leakLine = `const config = { api_key: "${key}" };`;
    const inlineLine = `${leakLine} // gitleaks:allow`;
    const repo = makeFixture({ files: { "packages/alpha/config.ts": `${leakLine}\n`, "packages/alpha/inline.ts": `${inlineLine}\n` } });
    const findings = guardProjection(repo, buildProjection(repo, "HEAD"), { gitleaks: "gitleaks" });
    expect(findings.map((finding) => `${finding.path}:${finding.rule}`)).toEqual([
      "packages/alpha/config.ts:gitleaks/generic-api-key",
      "packages/alpha/inline.ts:gitleaks/generic-api-key",
    ]);
    expect(findings[0]?.lineSha256).toBe(lineSha256(leakLine));
    const ignoreFile = (configSha: string, extra = "") =>
      `# fixture\n# line_sha256=${configSha}\npackages/alpha/config.ts:generic-api-key:1\n# line_sha256=${lineSha256(inlineLine)}\npackages/alpha/inline.ts:generic-api-key:1\n${extra}`;
    write(repo, "public/overlay/.gitleaksignore", ignoreFile(lineSha256(leakLine)));
    commitAll(repo, "ignore");
    expect(guardProjection(repo, buildProjection(repo, "HEAD"), { gitleaks: "gitleaks" })).toEqual([]);

    // A fingerprint whose line moved away is reported, not kept silently.
    write(repo, "public/overlay/.gitleaksignore", ignoreFile(lineSha256(leakLine), `# line_sha256=${"e".repeat(64)}\npackages/alpha/old.ts:github-pat:5\n`));
    commitAll(repo, "stale fingerprint");
    expect(guardProjection(repo, buildProjection(repo, "HEAD"), { gitleaks: "gitleaks" }).map(formatFinding)).toEqual([
      "packages/alpha/old.ts:5: integrity/unused-gitleaksignore (.gitleaksignore: github-pat)",
    ]);

    // A different credential at the fingerprinted position is still a finding:
    // gitleaks never sees the ignore file, and the guard checks the line's hash.
    write(repo, "public/overlay/.gitleaksignore", ignoreFile(lineSha256(leakLine)));
    write(repo, "packages/alpha/config.ts", `${leakLine.replace(key, key.split("").reverse().join(""))}\n`);
    commitAll(repo, "edited line");
    expect(rules(guardProjection(repo, buildProjection(repo, "HEAD"), { gitleaks: "gitleaks" }))).toEqual([
      "gitleaks/generic-api-key",
      "integrity/unused-gitleaksignore",
    ]);
  });
});

describe("determinism and the parent rule", () => {
  test("the same source and parent give the same commit across clones, identities, and config", () => {
    const repo = makeFixture();
    const source = git(repo, "rev-parse", "HEAD");
    const other = join(scratch, `clone-${fixtureCount}`);
    git(scratch, "clone", "-q", "--no-local", repo, other);
    git(other, "config", "commit.gpgSign", "true");
    git(other, "config", "user.name", "Somebody Else");
    git(other, "config", "i18n.commitEncoding", "ISO-8859-1");
    const saved = { ...process.env };
    try {
      const first = createProjectionCommit(repo, buildProjection(repo, source), undefined);
      process.env.GIT_AUTHOR_NAME = "Ambient Author";
      process.env.GIT_COMMITTER_DATE = "@1 +0000";
      const second = createProjectionCommit(other, buildProjection(other, source), undefined);
      expect(second).toBe(first);
      expect(createProjectionCommit(repo, buildProjection(repo, source), undefined)).toBe(first);

      const child = createProjectionCommit(repo, buildProjection(repo, source), first);
      expect(createProjectionCommit(other, buildProjection(other, source), first)).toBe(child);
      expect(child).not.toBe(first);

      const shape = parseCommit(git(repo, "cat-file", "commit", child) + "\n");
      expect(shape.parents).toEqual([first]);
      expect(shape.author).toBe(`AgentTool projection <contact@cambridgetcg.com> ${projectionDate(repo, source).slice(1)}`);
      expect(shape.committer).toBe(shape.author);
      expect(shape.message).toBe(projectionMessage(source));
      expect(git(repo, "cat-file", "commit", child)).not.toContain("Fixture");
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
  });

  test("a signed or multi-header source commit still projects with its committer date", () => {
    const repo = makeFixture();
    const head = git(repo, "cat-file", "commit", "HEAD");
    const signed = head.replace(
      /\ncommitter ([^\n]+)\n/u,
      "\ncommitter Web Flow <noreply@example.invalid> 1791626012 +0100\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n fixture\n -----END PGP SIGNATURE-----\n",
    );
    const result = spawnSync("git", ["hash-object", "-t", "commit", "-w", "--stdin"], { cwd: repo, input: `${signed}\n`, encoding: "utf8", env: cleanEnv() });
    expect(result.status).toBe(0);
    const source = result.stdout.trim();
    expect(projectionDate(repo, source)).toBe("@1791626012 +0100");
    const commit = createProjectionCommit(repo, buildProjection(repo, source), undefined);
    expect(git(repo, "cat-file", "commit", commit)).toContain("committer AgentTool projection <contact@cambridgetcg.com> 1791626012 +0100");
    expect(git(repo, "cat-file", "commit", commit)).not.toContain("gpgsig");
  });

  test("commit shape findings name a wrong parent, identity, or message", () => {
    const repo = makeFixture();
    const build = buildProjection(repo, "HEAD");
    const projection = parseProjection(Buffer.from(`${git(repo, "cat-file", "blob", `${build.tree}:PROJECTION.json`)}\n`));
    const good = {
      tree: "t",
      parents: ["a".repeat(40)],
      author: "AgentTool projection <contact@cambridgetcg.com> 1 +0000",
      committer: "AgentTool projection <contact@cambridgetcg.com> 1 +0000",
      message: projectionMessage(projection.source_commit),
    };
    expect(commitShapeFindings(good, projection, ["a".repeat(40)])).toEqual([]);
    expect(rules(commitShapeFindings(good, projection, ["b".repeat(40)]))).toEqual(["integrity/parents"]);
    expect(rules(commitShapeFindings({ ...good, parents: [] }, projection, ["a".repeat(40)]))).toEqual(["integrity/parents"]);
    expect(rules(commitShapeFindings({ ...good, author: "Someone <s@example.invalid> 1 +0000" }, projection))).toEqual(["integrity/author", "integrity/dates"]);
    expect(rules(commitShapeFindings({ ...good, message: "Merge pull request\n" }, projection))).toEqual(["integrity/message"]);
  });

  test("CLI arguments require exactly one output and refuse unknown flags", () => {
    expect(parseArgs(["--source", "HEAD", "--out-ref", "refs/public/main"]).target).toEqual({ kind: "ref", ref: "refs/public/main" });
    expect(parseArgs(["--source", "HEAD", "--no-write"]).target).toBeUndefined();
  });
});

describe("full projection (real gitleaks 8.30.1 when present, otherwise a no-leak stub)", () => {
  test("writes a local ref fast-forward only, retries are no-ops, and the parent is the previous head", () => {
    const repo = makeFixture();
    const options = { repo, source: "HEAD", target: { kind: "ref" as const, ref: "refs/public/main" }, allowUnmergedSource: true, gitleaks: GITLEAKS_BIN };
    const first = projectPublic(options);
    expect(first.status).toBe("updated");
    expect(first.parent).toBeNull();
    expect(git(repo, "rev-parse", "refs/public/main")).toBe(first.commit);
    expect(projectPublic(options)).toMatchObject({ status: "unchanged", commit: first.commit });

    write(repo, "packages/alpha/index.ts", "export const alpha = 2;\n");
    write(repo, "packages/beta/index.ts", "export const beta = 3;\n");
    commitAll(repo, "change");
    const second = projectPublic(options);
    expect(second).toMatchObject({ status: "updated", parent: first.commit });
    expect(git(repo, "rev-list", "--parents", "-n", "1", second.commit).split(" ")).toEqual([second.commit, first.commit]);
    expect(git(repo, "diff-tree", "-r", "--name-only", "--no-commit-id", first.commit, second.commit).split("\n")).toEqual([
      "PROJECTION.json",
      "packages/alpha/index.ts",
    ]);
  });

  test("writes a local bare repository that passes the published guard and detects tampering", () => {
    const repo = makeFixture();
    const bare = join(scratch, `public-${fixtureCount}.git`);
    const result = projectPublic({ repo, source: "HEAD", target: { kind: "repo", path: bare }, allowUnmergedSource: true, gitleaks: GITLEAKS_BIN });
    expect(result.status).toBe("updated");
    expect(git(bare, "rev-parse", "refs/heads/main")).toBe(result.commit);
    expect(git(bare, "rev-list", "--count", "main")).toBe("1");

    const clone = join(scratch, `public-clone-${fixtureCount}`);
    git(scratch, "clone", "-q", bare, clone);
    const guard = (...args: string[]) =>
      spawnSync("bun", [join(clone, "tools/public-guard.ts"), ...args], { cwd: clone, encoding: "utf8", env: cleanEnv() });
    expect(guard("--rev", "HEAD", "--gitleaks", GITLEAKS_BIN).status).toBe(0);
    expect(guard("--rev", "HEAD", "--projection-commit", "--expect-parent", "none").status).toBe(0);
    expect(guard("--rev", "HEAD", "--projection-commit", "--expect-parent", "f".repeat(40)).status).toBe(1);
    expect(guard("--rev", "HEAD", "--history").status).toBe(0);

    write(clone, "packages/alpha/index.ts", "export const alpha = 99;\n");
    write(clone, "stray.txt", "not projected\n");
    commitAll(clone, "tamper");
    const tampered = guard("--rev", "HEAD");
    expect(tampered.status).toBe(1);
    expect(tampered.stdout).toContain("packages/alpha: integrity/object-mismatch");
    expect(tampered.stdout).toContain("stray.txt: path/not-allowlisted");
    expect(guard("--rev", "HEAD", "--history").stdout).toContain(": integrity/author");

    // A fresh private clone lacks the public head's objects; the tool fetches
    // them from the bare repository before building on that head.
    write(repo, "docs/spec.md", "# Spec v2\n");
    commitAll(repo, "second");
    const fresh = join(scratch, `private-clone-${fixtureCount}`);
    git(scratch, "clone", "-q", "--no-local", repo, fresh);
    expect(spawnSync("git", ["cat-file", "-e", result.commit], { cwd: fresh }).status).not.toBe(0);
    const next = projectPublic({ repo: fresh, source: "HEAD", target: { kind: "repo", path: bare }, allowUnmergedSource: true, gitleaks: GITLEAKS_BIN });
    expect(next).toMatchObject({ status: "updated", parent: result.commit });
    expect(git(bare, "rev-list", "--count", "main")).toBe("2");
    expect(git(bare, "rev-list", "--parents", "-n", "1", "main").split(" ")).toEqual([next.commit, result.commit]);
    const chain = join(scratch, `public-chain-${fixtureCount}`);
    git(scratch, "clone", "-q", bare, chain);
    const history = spawnSync("bun", [join(chain, "tools/public-guard.ts"), "--rev", "HEAD", "--history"], { cwd: chain, encoding: "utf8", env: cleanEnv() });
    expect([history.status, history.stdout]).toEqual([0, ""]);
  });

  test("refuses a public head whose history holds a commit that is not a projection", () => {
    const repo = makeFixture();
    const target = { kind: "ref" as const, ref: "refs/public/main" };
    const refusal = () => {
      try {
        projectPublic({ repo, source: "HEAD", target, allowUnmergedSource: true, gitleaks: GITLEAKS_BIN });
      } catch (error) {
        expect(error).toBeInstanceOf(ProjectionRefused);
        return error as ProjectionRefused;
      }
      throw new Error("expected a refusal");
    };

    // A private commit whose tree carries a PROJECTION.json with only the right schema string.
    const fixtureCommit = git(repo, "rev-parse", "HEAD");
    write(repo, "PROJECTION.json", `${JSON.stringify({ schema: "agenttool.public-projection/1" })}\n`);
    const planted = commitAll(repo, "PRIVATE MESSAGE do-not-leak");
    git(repo, "update-ref", "refs/public/main", planted);
    expect(refusal().findings.map((finding) => `${finding.path}:${finding.rule}`)).toContain(`${planted}:PROJECTION.json:integrity/invalid-projection`);

    // A genuine projection commit stacked on that private commit: the tip alone
    // passes every check, but the walk reaches the private parent and its history.
    git(repo, "rm", "-q", "PROJECTION.json");
    commitAll(repo, "drop the planted file");
    const stacked = createProjectionCommit(repo, buildProjection(repo, "HEAD"), planted);
    git(repo, "update-ref", "refs/public/main", stacked, planted);
    const findings = refusal().findings;
    expect(findings.some((finding) => finding.path.startsWith(`${stacked}:`))).toBe(false);
    expect(findings.map((finding) => `${finding.path}:${finding.rule}`)).toEqual(
      expect.arrayContaining([`${planted}:PROJECTION.json:integrity/invalid-projection`, `${fixtureCommit}:PROJECTION.json:integrity/missing-projection`]),
    );
    expect(git(repo, "rev-parse", "refs/public/main")).toBe(stacked);

    // The published guard: the tip-only shape check passes, --history does not.
    const bare = join(scratch, `planted-${fixtureCount}.git`);
    git(scratch, "init", "-q", "--bare", "--initial-branch=main", bare);
    git(bare, "fetch", "-q", repo, "refs/public/main:refs/heads/main");
    const clone = join(scratch, `planted-clone-${fixtureCount}`);
    git(scratch, "clone", "-q", bare, clone);
    const guard = (...args: string[]) =>
      spawnSync("bun", [join(clone, "tools/public-guard.ts"), ...args], { cwd: clone, encoding: "utf8", env: cleanEnv() });
    expect(guard("--rev", "HEAD", "--projection-commit", "--expect-parent", planted).status).toBe(0);
    const history = guard("--rev", "HEAD", "--history");
    expect(history.status).toBe(1);
    expect(history.stdout).toContain(`${planted}:PROJECTION.json: integrity/invalid-projection`);
    expect(history.stdout).not.toContain("do-not-leak");
  });

  test("refuses to build on a head that is not a projection, to write outside refs/public, or an unmerged source", () => {
    const repo = makeFixture();
    git(repo, "update-ref", "refs/public/main", "HEAD");
    expect(() => projectPublic({ repo, source: "HEAD", target: { kind: "ref", ref: "refs/public/main" }, allowUnmergedSource: true, gitleaks: GITLEAKS_BIN })).toThrow(
      "is not a chain of projection commits",
    );
    expect(() => projectPublic({ repo, source: "HEAD", target: { kind: "ref", ref: "refs/heads/main" }, allowUnmergedSource: true, gitleaks: GITLEAKS_BIN })).toThrow(
      "--out-ref must start with",
    );
    expect(() => projectPublic({ repo, source: "HEAD", target: { kind: "ref", ref: "refs/public/x" }, gitleaks: GITLEAKS_BIN })).toThrow("is not contained in");
  });

  test("refuses when the running guard differs from the shipped overlay copy", () => {
    const repo = makeFixture({ files: { "public/overlay/tools/public-guard.ts": "// a different guard\n" } });
    expect(() => projectPublic({ repo, source: "HEAD", target: { kind: "ref", ref: "refs/public/main" }, allowUnmergedSource: true, gitleaks: GITLEAKS_BIN })).toThrow(
      "byte-identical",
    );
  });

  test("a guard failure writes nothing: no ref and no new bare repository", () => {
    const repo = makeFixture({ files: { "packages/alpha/note.md": `${TERM}\n` } });
    const bare = join(scratch, `refused-${fixtureCount}.git`);
    for (const target of [{ kind: "ref" as const, ref: "refs/public/main" }, { kind: "repo" as const, path: bare }]) {
      let refused: unknown;
      try {
        projectPublic({ repo, source: "HEAD", target, allowUnmergedSource: true, gitleaks: GITLEAKS_BIN });
      } catch (error) {
        refused = error;
      }
      expect(refused).toBeInstanceOf(ProjectionRefused);
      expect(rules((refused as ProjectionRefused).findings)).toEqual(["relational/r01"]);
    }
    expect(spawnSync("git", ["rev-parse", "--verify", "-q", "refs/public/main"], { cwd: repo }).status).not.toBe(0);
    expect(existsSync(bare)).toBe(false);
  });
});

describe("the real wave-1 allowlist and overlay", () => {
  const allowlist = parseAllowlist(readFileSync(join(ROOT, ALLOWLIST_PATH)));
  const packages = allowlist.include.filter((entry) => entry.kind === "tree").map((entry) => entry.path.slice("packages/".length));
  const ci = readFileSync(join(ROOT, "public/overlay/.github/workflows/ci.yml"), "utf8");

  test("holds the 33 wave-1 packages, the seven closure files, and no held package", () => {
    expect(packages).toHaveLength(33);
    expect(allowlist.include.filter((entry) => entry.kind === "blob").map((entry) => entry.path)).toEqual([
      ".gitattributes",
      "docs/DATASET-INFLUENCE.md",
      "docs/RIGHTS-OF-LIFE.md",
      "docs/XENIA-LOOP-ATLAS.md",
      "docs/specs/AGENT-WALLET-ZERONE-0.1.md",
      "docs/specs/adds-0.1-vectors.json",
      "docs/specs/agenttool-isness-v0.1.schema.json",
    ]);
    for (const held of ["love-bomb", "sdk-ts", "sdk-py", "dark-continent-contract", "dark-continent-karma", "wallet", "local-starter", "local-starter-mcp"]) {
      expect(packages).not.toContain(held);
      expect(allowlist.held.map((entry) => entry.path)).toContain(`packages/${held}`);
    }
    expect(allowlist.include.some((entry) => DENYLIST_PATH.startsWith(entry.path))).toBe(false);
  });

  test("the overlay LICENSE is a byte copy and the README lists every package with its npm name", () => {
    expect(readFileSync(join(ROOT, "public/overlay/LICENSE"))).toEqual(readFileSync(join(ROOT, "LICENSE")));
    const readme = readFileSync(join(ROOT, "public/overlay/README.md"), "utf8");
    const rows = [...readme.matchAll(/^\| \[`packages\/([^`]+)`\]\(packages\/\1\) \| `([^`]+)` \|$/gmu)].map((match) => [match[1], match[2]]);
    expect(rows.map(([dir]) => dir)).toEqual(packages);
    for (const [dir, name] of rows) {
      expect(JSON.parse(readFileSync(join(ROOT, "packages", dir as string, "package.json"), "utf8")).name).toBe(name);
    }
  });

  test("the public CI gates exactly the allowlisted packages with pinned tools and actions", () => {
    const gated = [...ci.matchAll(/^ {8}working-directory: packages\/([a-z0-9-]+)\n {8}run: bun run ci/gmu)].map((match) => match[1]);
    expect([...gated].sort()).toEqual([...packages].sort());
    expect(new Set(gated).size).toBe(gated.length);
    const bunPins = [...ci.matchAll(/bun-version:\s*(\S+)/gu)].map((match) => match[1]);
    expect(bunPins.length).toBeGreaterThan(0);
    expect(new Set(bunPins)).toEqual(new Set(["1.3.5"]));
    expect([...ci.matchAll(/node-version:\s*(\S+)/gu)].map((match) => match[1])).toEqual(["22.18.0"]);
    for (const match of ci.matchAll(/uses:\s*(\S+)/gu)) expect(match[1]).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/u);
    expect(ci).toContain("551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb");
    expect(ci).not.toContain("apps/docs");
    expect(ci).not.toMatch(/packages\/(?:sdk-ts|sdk-py|wallet|love-bomb|local-starter|dark-continent-[a-z]+)(?![\w-])/u);
  });

  test("the committed allowlist projects cleanly through every layer except gitleaks", () => {
    const build = buildProjection(ROOT, "HEAD");
    const findings = guardProjection(ROOT, build);
    expect(findings.map(formatFinding)).toEqual([]);
    expect(build.projection.paths).toHaveLength(40);
  }, 120_000);
});
