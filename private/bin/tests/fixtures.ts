/**
 * Fixture repositories for the shared/private split tooling tests: a private
 * repository with the real tooling copied in, a synthetic allowlist, a
 * synthetic denylist and literal list, and a canary. No real private term is
 * written anywhere; tests that need the real guard load it in code.
 */
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { GITLEAKS_VERSION } from "../../../tools/public-guard.ts";

export const ROOT = resolve(import.meta.dir, "..", "..", "..");
export const TERM = "quiet fixture";
export const OWNER_ADDRESS = "owner@mail.invalid";
export const ACCOUNT_WORD = "macfixture";
export const WITHHELD = "withheld corpus\n";
export const PUBLIC_EMAIL = "contact@cambridgetcg.com";

/** The tooling files a fixture private repository carries, copied from this checkout's working tree. */
export const TOOLING = [
  "bin/project-public.ts",
  "private/bin/install-guards.sh",
  "private/bin/merge-back.sh",
  "private/bin/public-clone.sh",
  "private/bin/public-export.ts",
  "private/bin/relational-scan.ts",
  "private/bin/scan-public.sh",
  "private/bin/shared-scope.ts",
  "private/githooks/pre-commit",
  "private/githooks/pre-push",
  "private/public-repository.ts",
  "tools/githooks/pre-push",
  "tools/public-guard.ts",
  "tools/workflow-lint.ts",
];

export function sha256(text: string | Uint8Array): string {
  return createHash("sha256").update(text).digest("hex");
}

export function scratchDir(label: string): { dir: string; cleanup: () => void } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `split-${label}-`)));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** An environment with no inherited Git identity, config, or repository redirection. */
export function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("GIT_") && key !== "AGENTTOOL_NO_PRIVATE_GUARD" && key !== "ALLOW_SHARED_EDIT") env[key] = value;
  }
  return { ...env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", ...extra };
}

export interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
  out: string;
}

export function run(cwd: string, command: string, args: readonly string[], options: { env?: Record<string, string>; input?: string } = {}): RunResult {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: options.env ?? cleanEnv(), input: options.input, maxBuffer: 1 << 28 });
  if (result.error) throw result.error;
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr, out: `${result.stdout}${result.stderr}` };
}

export function git(cwd: string, ...args: string[]): string {
  const result = run(cwd, "git", args);
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} (${cwd}): ${result.stderr}`);
  return result.stdout.trim();
}

let clock = 1_760_000_000;

export function commitAll(repo: string, message: string, identity = { name: "Dev", email: "dev@private.invalid" }, extraEnv: Record<string, string> = {}): string {
  git(repo, "add", "-A", "--force");
  return commitStaged(repo, message, identity, extraEnv);
}

/** Commits the index as it is (no `git add`), for entries a working tree cannot hold. */
export function commitStaged(repo: string, message: string, identity = { name: "Dev", email: "dev@private.invalid" }, extraEnv: Record<string, string> = {}): string {
  clock += 60;
  const result = run(repo, "git", ["-c", "commit.gpgSign=false", "commit", "-q", "--no-verify", "--allow-empty", "-m", message], {
    env: cleanEnv({
      GIT_AUTHOR_NAME: identity.name,
      GIT_AUTHOR_EMAIL: identity.email,
      GIT_COMMITTER_NAME: identity.name,
      GIT_COMMITTER_EMAIL: identity.email,
      GIT_AUTHOR_DATE: `@${clock} +0000`,
      GIT_COMMITTER_DATE: `@${clock} +0000`,
      ...extraEnv,
    }),
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return git(repo, "rev-parse", "HEAD");
}

export function publicCommit(repo: string, message: string): string {
  return commitAll(repo, message, { name: "AgentTool", email: PUBLIC_EMAIL });
}

export function write(repo: string, path: string, content: string | Uint8Array, mode?: number): void {
  const target = join(repo, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  if (mode !== undefined) chmodSync(target, mode);
}

export function copyIn(repo: string, path: string): void {
  const target = join(repo, path);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(ROOT, path), target);
  chmodSync(target, path.endsWith(".sh") || path.includes("githooks/") ? 0o755 : 0o644);
}

/** A gitleaks stand-in that reports the pinned version and no leaks. */
export function stubGitleaks(dir: string): string {
  const path = join(dir, "gitleaks-stub");
  writeFileSync(
    path,
    [
      "#!/bin/sh",
      `if [ "$1" = version ]; then echo ${GITLEAKS_VERSION}; exit 0; fi`,
      'report=""',
      'while [ $# -gt 0 ]; do [ "$1" = --report-path ] && report="$2"; shift; done',
      "printf '[]' > \"$report\"",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return path;
}

export const ALLOWLIST = {
  schema: "agenttool.public-allowlist/1",
  public_repository: "example/public-packages",
  overlay: "private/projection/overlay",
  include: [
    { path: ".gitattributes", kind: "blob" },
    { path: "docs/spec.md", kind: "blob" },
    { path: "packages/alpha", kind: "tree" },
    { path: "packages/wallet", kind: "tree" },
  ],
  exclude: ["**/node_modules/**"],
  held: [],
  export: {
    note: "fixture",
    root_files: [
      ".github/workflows/ci.yml",
      ".gitignore",
      ".gitleaksignore",
      "README.md",
      "tools/githooks/pre-push",
      "tools/leak-canaries.txt",
      "tools/public-guard-allow.json",
      "tools/public-guard.ts",
    ],
    exclude: [{ path: "packages/wallet", reason: "fixture: undecided" }],
  },
};

export const DENYLIST = {
  schema: "agenttool.public-relational-denylist/1",
  note: "fixture",
  terms: [{ id: "r01", pattern: TERM, flags: "iu" }],
  blob_sha256: [{ id: "b01", sha256: sha256(WITHHELD) }],
  allow: [] as unknown[],
};

export const LITERALS = {
  schema: "agenttool.private-literal-sha256/1",
  note: "fixture",
  literals: [
    { id: "l01", kind: "email", sha256: sha256(OWNER_ADDRESS), reason: "fixture owner address" },
    { id: "l02", kind: "word", sha256: sha256(ACCOUNT_WORD), reason: "fixture account name" },
  ],
  allow: [] as unknown[],
};

export interface PrivateFixture {
  repo: string;
  guardDir: string;
  canary: Buffer;
  head: string;
}

/**
 * A private repository: shared root files and packages, a withheld wallet,
 * private-only paths, the tooling, and a guard directory with synthetic terms.
 */
export function makePrivateRepo(dir: string, options: { allowlist?: unknown; denylist?: unknown; files?: Record<string, string | Uint8Array> } = {}): PrivateFixture {
  const repo = join(dir, "private");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "--initial-branch=main");
  for (const path of TOOLING) copyIn(repo, path);
  const canary = randomBytes(32);
  write(repo, "private/CANARY", canary);
  write(repo, "private/projection/allowlist.json", `${JSON.stringify(options.allowlist ?? ALLOWLIST, null, 2)}\n`);
  write(repo, "private/projection/overlay/README.md", "# Packages\n");
  write(repo, "private/guard/relational-denylist.json", `${JSON.stringify(options.denylist ?? DENYLIST, null, 2)}\n`);
  write(repo, "private/guard/literal-sha256.json", `${JSON.stringify(LITERALS, null, 2)}\n`);
  write(repo, "private/notes.md", "private notes\n");
  write(repo, ".github/workflows/private-ci.yml", "name: private\n");
  write(repo, "bin/private-tool.ts", "export {};\n");
  write(repo, "README.md", "# Shared tree\n");
  write(repo, ".gitignore", "node_modules/\n");
  write(repo, ".gitattributes", "/docs/spec.md text eol=lf\n");
  write(repo, ".gitleaksignore", "");
  write(repo, "tools/public-guard-allow.json", '{\n  "schema": "agenttool.public-guard-allow/1",\n  "entries": []\n}\n');
  write(repo, ".github/workflows/ci.yml", "name: ci\non: push\npermissions:\n  contents: read\njobs:\n  x:\n    if: github.repository == 'example/shared'\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo ok\n");
  write(repo, "docs/spec.md", "# Spec\n");
  write(repo, "packages/alpha/index.ts", "export const alpha = 1;\n");
  write(repo, "packages/alpha/run.sh", "#!/bin/sh\necho alpha\n", 0o755);
  write(repo, "packages/wallet/index.ts", "export const wallet = 1;\n");
  for (const [path, content] of Object.entries(options.files ?? {})) write(repo, path, content);
  git(repo, "add", "private/CANARY");
  const canaryId = git(repo, "hash-object", "private/CANARY");
  write(repo, "tools/leak-canaries.txt", `# fixture canaries\n${canaryId}\n`);
  const head = commitAll(repo, "private root");
  return { repo, guardDir: join(repo, "private", "guard"), canary, head };
}

export function bunBin(): string {
  return process.execPath;
}

export function readText(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * A public-side commit built inside a private repository from the shared
 * scope of one of its commits, as the public root is after the adoption
 * merge: the scoped entries only, the public identity, no parent unless given.
 */
export function scopedTip(repo: string, rev: string, inScope: (path: string) => boolean, parent?: string): string {
  const index = join(mkdtempSync(join(tmpdir(), "split-index-")), "index");
  const env = cleanEnv({ GIT_INDEX_FILE: index });
  const listing = run(repo, "git", ["ls-tree", "-r", "--full-tree", rev], { env }).stdout;
  const info = listing
    .split("\n")
    .filter(Boolean)
    .filter((line) => inScope(line.slice(line.indexOf("\t") + 1)))
    .map((line) => {
      const [meta, path] = line.split("\t") as [string, string];
      const [mode, , oid] = meta.split(" ");
      return `${mode} ${oid}\t${path}`;
    })
    .join("\n");
  const read = run(repo, "git", ["update-index", "--add", "--index-info"], { env, input: `${info}\n` });
  if (read.status !== 0) throw new Error(read.stderr);
  const tree = run(repo, "git", ["write-tree"], { env }).stdout.trim();
  clock += 60;
  const commit = run(repo, "git", ["commit-tree", tree, ...(parent === undefined ? [] : ["-p", parent]), "-m", "AgentTool public root"], {
    env: cleanEnv({
      GIT_AUTHOR_NAME: "AgentTool",
      GIT_AUTHOR_EMAIL: PUBLIC_EMAIL,
      GIT_COMMITTER_NAME: "AgentTool",
      GIT_COMMITTER_EMAIL: PUBLIC_EMAIL,
      GIT_AUTHOR_DATE: `@${clock} +0000`,
      GIT_COMMITTER_DATE: `@${clock} +0000`,
    }),
  }).stdout.trim();
  rmSync(dirname(index), { recursive: true, force: true });
  return commit;
}
