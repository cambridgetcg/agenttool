/** Pull-request path filtering for .github/workflows/private-ci.yml.
 *
 * The classifier may only turn a job off for a pull request whose every
 * changed path it recognises. These tests drive bin/ci-changed-areas.sh as CI
 * does (against disposable Git fixtures), pin how ci.yml consumes its outputs,
 * execute the required aggregate's shell under each prerequisite outcome, and
 * guard the rule table against the dependency drift it is most likely to miss.
 */

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const SCRIPT = join(ROOT, "bin", "ci-changed-areas.sh");
const WORKFLOW_PATH = join(ROOT, ".github", "workflows", "private-ci.yml");
const SYSTEM_PATH = "/usr/bin:/bin";

type Outputs = Record<string, string>;
type Step = {
  id?: string;
  name?: string;
  if?: string;
  "continue-on-error"?: boolean;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  "working-directory"?: string;
};
type Job = {
  name?: string;
  if?: string;
  needs?: string[];
  permissions?: Record<string, string>;
  "runs-on"?: string;
  "timeout-minutes"?: number;
  outputs?: Record<string, string>;
  defaults?: { run?: Record<string, string> };
  steps?: Step[];
};

const workflowSource = readFileSync(WORKFLOW_PATH, "utf8");
const workflow = Bun.YAML.parse(workflowSource) as {
  on: Record<string, unknown>;
  concurrency: Record<string, string>;
  jobs: Record<string, Job>;
};
const jobs = workflow.jobs;

function runScript(
  args: string[],
  options: { cwd?: string; env?: Record<string, string>; stdin?: string } = {},
): { code: number; stdout: string; stderr: string } {
  const result = Bun.spawnSync(["/bin/bash", SCRIPT, ...args], {
    cwd: options.cwd ?? ROOT,
    env: { PATH: SYSTEM_PATH, ...options.env },
    stdin: options.stdin === undefined ? "ignore" : new TextEncoder().encode(options.stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function parseOutputs(text: string): Outputs {
  const outputs: Outputs = {};
  for (const line of text.split("\n").filter(Boolean)) {
    const separator = line.indexOf("=");
    expect(separator, line).toBeGreaterThan(0);
    const key = line.slice(0, separator);
    expect(outputs[key], `duplicate output ${key}`).toBeUndefined();
    outputs[key] = line.slice(separator + 1);
  }
  return outputs;
}

const AREAS = runScript(["--list-areas"]).stdout.split("\n").filter(Boolean);

function classify(paths: string[]): Outputs {
  const result = runScript(["--classify"], { stdin: paths.map((path) => `${path}\0`).join("") });
  expect(result.code, result.stderr).toBe(0);
  return parseOutputs(result.stdout);
}

/** The jobs a change to each path would run: every area for `*`. */
function areasOf(paths: string[]): string[][] {
  if (paths.length === 0) return [];
  const result = runScript(["--classify-each"], {
    stdin: paths.map((path) => `${path}\0`).join(""),
  });
  expect(result.code, result.stderr).toBe(0);
  const lines = result.stdout.split("\n").slice(0, -1);
  expect(lines).toHaveLength(paths.length);
  return lines.map((line) => (line === "*" ? [...AREAS] : line === "-" ? [] : line.split(",")));
}

function selected(outputs: Outputs): string[] {
  return AREAS.filter((area) => outputs[area] === "true");
}

function expectOnly(outputs: Outputs, areas: string[], reason = "classified"): void {
  expect(outputs.everything).toBe("false");
  expect(outputs.reason).toBe(reason);
  expect(selected(outputs)).toEqual(AREAS.filter((area) => areas.includes(area)));
}

function expectEverything(outputs: Outputs, reason: string): void {
  expect(outputs.everything).toBe("true");
  expect(outputs.reason).toBe(reason);
  expect(selected(outputs)).toEqual(AREAS);
}

const API_PREP = ["api-protocol-postgres", "launch-core"];

describe("change classification rules", () => {
  test("lists exactly the filterable jobs and accepts every rule", () => {
    expect(AREAS).toEqual([
      "api-protocol-postgres",
      "launch-core",
      "launch-browser",
      "native-macos-secret",
      "care-before-learning",
      "witnessed-agent-economy",
      "packages",
      "sdk-python",
    ]);
    const check = runScript(["--check-rules"]);
    expect(check.code, check.stderr).toBe(0);
  });

  test("a docs-only change runs the API journey and static origins, nothing else", () => {
    expectOnly(classify(["docs/SOUL.md", "docs/superpowers/specs/x.md"]), [
      "launch-core",
      "launch-browser",
    ]);
  });

  test("docs read by package provenance and SDK vectors still reach those jobs", () => {
    expectOnly(classify(["docs/RIGHTS-OF-LIFE.md"]), ["launch-core", "launch-browser", "packages"]);
    expectOnly(classify(["docs/specs/canonical-bytes-vectors.json"]), [
      "launch-core",
      "launch-browser",
      "packages",
      "sdk-python",
    ]);
  });

  test("a Python SDK change runs only the Python SDK unless the package gate reads it", () => {
    expectOnly(classify(["packages/sdk-py/tests/test_client.py"]), ["sdk-python"]);
    expectOnly(classify(["packages/sdk-py/src/agenttool/client.py"]), ["packages", "sdk-python"]);
  });

  test("a native macOS change runs only the native macOS job", () => {
    expectOnly(
      classify(["native/agenttool-secret-macos/Sources/AgentToolSecretMacOSCore/Command.swift"]),
      ["native-macos-secret"],
    );
  });

  test("API, package, browser, and operator-only changes select their dependants", () => {
    expectOnly(classify(["api/src/index.ts"]), API_PREP);
    expectOnly(classify(["api/tests/integration/new-postgres.test.ts"]), API_PREP);
    expectOnly(classify(["api/src/services/economy/x402-client.ts"]), [...API_PREP, "sdk-python"]);
    expectOnly(classify(["packages/sdk-ts/src/index.ts"]), [...API_PREP, "packages"]);
    expectOnly(classify(["packages/sdk-ts/tests/fixtures/agent-data-record-id-vectors.json"]), [
      ...API_PREP,
      "packages",
      "sdk-python",
    ]);
    expectOnly(classify(["packages/collab/src/index.ts"]), ["packages"]);
    expectOnly(classify(["packages/wallet/src/index.ts"]), ["witnessed-agent-economy", "packages"]);
    expectOnly(classify(["packages/wallet/schema/x.json"]), [
      "launch-browser",
      "witnessed-agent-economy",
      "packages",
    ]);
    expectOnly(classify(["packages/hf-listening-room/hf/dataset/README.md"]), ["care-before-learning"]);
    expectOnly(classify(["bin/json.py"]), ["care-before-learning"]);
    expectOnly(classify(["apps/web/index.html"]), ["launch-browser"]);
    expectOnly(classify(["tests/playwright/specs/room.spec.ts"]), ["launch-browser"]);
    expectOnly(classify(["bin/deploy.sh"]), ["launch-browser"]);
    expectOnly(classify(["bin/agenttool-think.ts", "bin/tests/new.test.ts", "README.md"]), []);
  });

  test("the workflow, classifier, shared preparation, and lockfiles select every job", () => {
    for (const path of [
      ".github/workflows/private-ci.yml",
      "bin/ci-changed-areas.sh",
      "bin/ci-tree-proof.sh",
      "bin/bash-without-env-hooks.sh",
      "bin/hermetic-env.sh",
      "bin/prepare-hermetic-deps.sh",
      "bin/preflight.sh",
      "bin/run-test-tier.sh",
      ".gitattributes",
      "packages/collab/.gitattributes",
      ".gitignore",
      "api/package.json",
      "api/bun.lock",
      "packages/collab/bun.lock",
      "uv.lock",
      "packages/trials/hf/revocable-feedback-model/uv.lock",
      "packages/sdk-py/nested/uv.lock",
      "tests/playwright/package-lock.json",
    ]) {
      expectEverything(classify(["docs/SOUL.md", path]), "rule-selects-everything");
    }
  });

  test("the Python SDK lockfile is the one exact exception and runs only the Python SDK", () => {
    const source = readFileSync(SCRIPT, "utf8");
    const exact = (/readonly EXACT_RULES=\(\n([\s\S]*?)\n\)/.exec(source)?.[1] ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith('"'));
    // Adding an exact rule bypasses every `*` rule for that path: pin the list.
    expect(exact).toEqual(['"packages/sdk-py/uv.lock sdk-python"']);
    expect(tracked.has("packages/sdk-py/uv.lock")).toBe(true);
    expectOnly(classify(["packages/sdk-py/uv.lock"]), ["sdk-python"]);
    expectEverything(classify(["packages/sdk-py/uv.lock", "api/bun.lock"]), "rule-selects-everything");
    // The exception holds only while the Python SDK job is the one filtered
    // job that runs uv: pip ignores uv.lock, and the shared preparation and
    // package gate never call uv.
    const runsUv = /setup-uv|(?<![\w-])uv\s+(?:sync|run|pip|lock|export|tree|venv|tool)\b/;
    for (const area of AREAS) {
      if (area === "sdk-python") continue;
      expect(runsUv.test(JSON.stringify(jobs[area])), area).toBe(false);
    }
    expect(runsUv.test(JSON.stringify(jobs["sdk-python"]))).toBe(true);
    for (const script of ["bin/prepare-hermetic-deps.sh", "bin/preflight.sh", "bin/run-test-tier.sh"]) {
      expect(runsUv.test(readFileSync(join(ROOT, script), "utf8")), script).toBe(false);
    }
  });

  test("exact rules must be literal and may not select every job", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "ci-changed-areas-exact-"));
    try {
      const source = readFileSync(SCRIPT, "utf8");
      for (const [bad, label] of [
        ['"packages/sdk-py/uv.lock *"', "selects every job"],
        ['"packages/sdk-py/*.lock sdk-python"', "glob"],
        ['"packages/sdk-py/uv.lock no-such-job"', "unknown job"],
      ] as const) {
        const copy = join(sandbox, "classifier.sh");
        const edited = source.replace('"packages/sdk-py/uv.lock sdk-python"', bad);
        expect(edited, label).not.toBe(source);
        writeFileSync(copy, edited);
        const check = Bun.spawnSync(["/bin/bash", copy, "--check-rules"], {
          env: { PATH: SYSTEM_PATH },
          stdout: "pipe",
          stderr: "pipe",
        });
        expect(check.exitCode, label).not.toBe(0);
        const run = Bun.spawnSync(["/bin/bash", copy, "--classify"], {
          env: { PATH: SYSTEM_PATH },
          stdin: new TextEncoder().encode("docs/SOUL.md\0"),
          stdout: "pipe",
          stderr: "pipe",
        });
        expect(run.exitCode, label).toBe(0);
        expectEverything(parseOutputs(run.stdout.toString()), "invalid-rule");
      }
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });

  test("reason is drawn from the documented vocabulary", () => {
    const source = readFileSync(SCRIPT, "utf8");
    const documented = (/^# `reason` is one of: ([\s\S]*?)\.\n/m.exec(source)?.[1] ?? "")
      .replace(/\n#/g, " ")
      .split(/,\s*/)
      .map((word) => word.trim());
    const used = new Set(["classified"]);
    for (const match of source.matchAll(/select_everything ([a-z-]+)/g)) used.add(match[1]!);
    for (const match of source.matchAll(/PATH_REASON="([a-z-]+)"/g)) used.add(match[1]!);
    expect([...used].sort()).toEqual([...documented].sort());
  });

  test("a path no rule recognises selects every job", () => {
    for (const path of [
      "brand-new/tool.ts",
      "package.json",
      "bunfig.toml",
      "packages/package.json",
      "packages/brand-new-package/src/index.ts",
      "tests/new-suite/check.ts",
      ".github/actions/setup/action.yml",
      "Docs/SOUL.md",
    ]) {
      expectEverything(classify(["native/x.swift", path]), "unmatched-path");
    }
  });

  test("hostile file names are only matched, never interpreted", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "ci-changed-areas-names-"));
    try {
      const names = [
        "docs/a b.md",
        "docs/line\nbreak.md",
        "docs/$(touch PWNED).md",
        "docs/`touch PWNED`.md",
        "docs/-rf.md",
        "docs/--output=x.md",
        "docs/*.md",
        "docs/[x].md",
        "docs/::set-output name=packages::true",
      ];
      const result = runScript(["--classify"], {
        cwd: sandbox,
        stdin: names.map((name) => `${name}\0`).join(""),
      });
      expect(result.code, result.stderr).toBe(0);
      expectOnly(parseOutputs(result.stdout), ["launch-core", "launch-browser"]);
      for (const name of ["$(touch PWNED)", "-rf", "--output=x", "`touch PWNED`"]) {
        expectEverything(classify([name]), "unmatched-path");
      }
      expect(existsSync(join(sandbox, "PWNED"))).toBe(false);
      expect(existsSync(join(ROOT, "PWNED"))).toBe(false);
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

const GIT_ENV = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_AUTHOR_NAME: "CI fixture",
  GIT_AUTHOR_EMAIL: "ci-fixture@example.invalid",
  GIT_COMMITTER_NAME: "CI fixture",
  GIT_COMMITTER_EMAIL: "ci-fixture@example.invalid",
  GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
};

class Fixture {
  readonly dir = mkdtempSync(join(tmpdir(), "ci-changed-areas-git-"));

  constructor() {
    this.git("init", "-q", "-b", "main");
    this.write("docs/SOUL.md", "soul\n");
    this.write("native/agenttool-secret-macos/Package.swift", "// package\n");
    this.write("packages/hf-listening-room/hf/dataset/README.md", "room\n");
    this.write("packages/collab/src/index.ts", "export {};\n");
    this.commit("base");
  }

  git(...args: string[]): string {
    return this.gitWithInput(undefined, ...args);
  }

  gitWithInput(input: string | undefined, ...args: string[]): string {
    const result = Bun.spawnSync(["git", ...args], {
      cwd: this.dir,
      env: { PATH: SYSTEM_PATH, HOME: this.dir, ...GIT_ENV },
      stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    return result.stdout.toString().trim();
  }

  /** Commit many one-line files through the index, without writing them out. */
  commitMany(paths: string[], message: string): string {
    const blob = this.gitWithInput("x\n", "hash-object", "-w", "--stdin");
    this.gitWithInput(paths.map((path) => `100644 ${blob}\t${path}\n`).join(""), "update-index", "--add", "--index-info");
    this.git("commit", "-q", "-m", message);
    this.git("reset", "-q", "--hard");
    return this.git("rev-parse", "HEAD");
  }

  write(path: string, content: string): void {
    mkdirSync(dirname(join(this.dir, path)), { recursive: true });
    writeFileSync(join(this.dir, path), content);
  }

  commit(message: string): string {
    this.git("add", "-A");
    this.git("commit", "-q", "--allow-empty", "-m", message);
    return this.git("rev-parse", "HEAD");
  }

  /** GitHub's test merge: base tip first, PR head second. */
  merge(baseTip: string, head: string): string {
    this.git("checkout", "-q", "--detach", baseTip);
    this.git("merge", "-q", "--no-ff", "-m", "test merge", head);
    return this.git("rev-parse", "HEAD");
  }

  run(env: Record<string, string>): { code: number; outputs: Outputs; stdout: string; stderr: string } {
    const outputFile = join(this.dir, ".git", "github-output");
    writeFileSync(outputFile, "");
    const result = runScript([], {
      cwd: this.dir,
      env: { HOME: this.dir, ...GIT_ENV, GITHUB_OUTPUT: outputFile, ...env },
    });
    return { ...result, outputs: parseOutputs(readFileSync(outputFile, "utf8")) };
  }

  pullRequest(base: string, head: string, tested: string) {
    return this.run({
      GITHUB_EVENT_NAME: "pull_request",
      CI_PR_BASE_SHA: base,
      CI_PR_HEAD_SHA: head,
      GITHUB_SHA: tested,
    });
  }

  remove(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

function withFixture(body: (fixture: Fixture) => void): void {
  const fixture = new Fixture();
  try {
    body(fixture);
  } finally {
    fixture.remove();
  }
}

describe("CI mode against Git fixtures", () => {
  test("classifies a docs-only pull request from its merge commit", () => {
    withFixture((fixture) => {
      const base = fixture.git("rev-parse", "HEAD");
      fixture.git("checkout", "-q", "-b", "topic");
      fixture.write("docs/SOUL.md", "soul, revised\n");
      const head = fixture.commit("docs");
      const merge = fixture.merge(base, head);
      const result = fixture.pullRequest(base, head, merge);
      expect(result.code, result.stderr).toBe(0);
      expectOnly(result.outputs, ["launch-core", "launch-browser"]);
      expect(Object.keys(result.outputs)).toEqual(["everything", "reason", ...AREAS]);
    });
  });

  test("counts both sides of a rename and a deletion", () => {
    withFixture((fixture) => {
      const base = fixture.git("rev-parse", "HEAD");
      fixture.git("checkout", "-q", "-b", "topic");
      renameSync(
        join(fixture.dir, "native/agenttool-secret-macos/Package.swift"),
        join(fixture.dir, "docs/Package.swift"),
      );
      unlinkSync(join(fixture.dir, "packages/hf-listening-room/hf/dataset/README.md"));
      const head = fixture.commit("rename and delete");
      const result = fixture.pullRequest(base, head, fixture.merge(base, head));
      expect(result.code, result.stderr).toBe(0);
      expectOnly(result.outputs, [
        "launch-core",
        "launch-browser",
        "native-macos-secret",
        "care-before-learning",
      ]);
    });
  });

  test("includes what the tested merge commit itself changes", () => {
    withFixture((fixture) => {
      const base = fixture.git("rev-parse", "HEAD");
      fixture.git("checkout", "-q", "-b", "topic");
      fixture.write("docs/SOUL.md", "soul, revised\n");
      const head = fixture.commit("docs");
      fixture.git("checkout", "-q", "--detach", base);
      fixture.git("merge", "-q", "--no-ff", "--no-commit", head);
      fixture.write("packages/collab/src/index.ts", "export const merged = true;\n");
      const merge = fixture.commit("merge with an extra change");
      const result = fixture.pullRequest(base, head, merge);
      expect(result.code, result.stderr).toBe(0);
      expectOnly(result.outputs, ["launch-core", "launch-browser", "packages"]);
    });
  });

  test("hostile committed file names are logged escaped and never executed", () => {
    withFixture((fixture) => {
      const base = fixture.git("rev-parse", "HEAD");
      fixture.git("checkout", "-q", "-b", "topic");
      const names = [
        "docs/a b.md",
        "docs/line\nbreak.md",
        "docs/$(touch PWNED).md",
        "docs/-rf.md",
        "docs/::set-output name=packages::true",
        "docs/\n::error::forged",
      ];
      for (const name of names) fixture.write(name, "x\n");
      const head = fixture.commit("hostile names");
      const result = fixture.pullRequest(base, head, fixture.merge(base, head));
      expect(result.code, result.stderr).toBe(0);
      expectOnly(result.outputs, ["launch-core", "launch-browser"]);
      expect(existsSync(join(fixture.dir, "PWNED"))).toBe(false);
      const commandLines = result.stdout
        .split(/\r\n|\r|\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith("::"));
      expect(commandLines).toHaveLength(2);
      const token = /^::stop-commands::([0-9a-f]{32})$/.exec(commandLines[0]!)?.[1];
      expect(token).toBeDefined();
      expect(commandLines[1]).toBe(`::${token}::`);
    });
  });

  test("a workflow change or unknown path in the pull request selects every job", () => {
    withFixture((fixture) => {
      const base = fixture.git("rev-parse", "HEAD");
      fixture.git("checkout", "-q", "-b", "topic");
      fixture.write(".github/workflows/private-ci.yml", "name: CI\n");
      const head = fixture.commit("workflow");
      const result = fixture.pullRequest(base, head, fixture.merge(base, head));
      expectEverything(result.outputs, "rule-selects-everything");

      fixture.git("checkout", "-q", "-b", "unknown", base);
      fixture.write("brand-new/file.txt", "x\n");
      const unknownHead = fixture.commit("unknown");
      expectEverything(
        fixture.pullRequest(base, unknownHead, fixture.merge(base, unknownHead)).outputs,
        "unmatched-path",
      );
    });
  });

  test("every event other than pull_request selects every job", () => {
    withFixture((fixture) => {
      const base = fixture.git("rev-parse", "HEAD");
      fixture.git("checkout", "-q", "-b", "topic");
      fixture.write("docs/SOUL.md", "soul, revised\n");
      const head = fixture.commit("docs");
      const merge = fixture.merge(base, head);
      for (const event of ["push", "merge_group", "workflow_dispatch", "schedule", "pull_request_target", ""]) {
        const result = fixture.run({
          GITHUB_EVENT_NAME: event,
          CI_PR_BASE_SHA: base,
          CI_PR_HEAD_SHA: head,
          GITHUB_SHA: merge,
        });
        expect(result.code, result.stderr).toBe(0);
        expectEverything(result.outputs, "not-a-pull-request");
      }
    });
  });

  test("missing, malformed, absent, or mismatched commits select every job", () => {
    withFixture((fixture) => {
      const base = fixture.git("rev-parse", "HEAD");
      fixture.git("checkout", "-q", "-b", "topic");
      fixture.write("docs/SOUL.md", "soul, revised\n");
      const head = fixture.commit("docs");
      const merge = fixture.merge(base, head);
      for (const bad of ["", "HEAD", "$(id)", base.slice(0, 12), `${base}\n`, base.toUpperCase()]) {
        expectEverything(fixture.pullRequest(bad, head, merge).outputs, "missing-or-malformed-sha");
        expectEverything(fixture.pullRequest(base, bad, merge).outputs, "missing-or-malformed-sha");
        expectEverything(fixture.pullRequest(base, head, bad).outputs, "missing-or-malformed-sha");
      }
      const absent = "0123456789abcdef0123456789abcdef01234567";
      expectEverything(fixture.pullRequest(absent, head, merge).outputs, "git-failure");
      expectEverything(fixture.pullRequest(base, head, absent).outputs, "git-failure");
      // A merge whose second parent is not the reported head is not trusted.
      expectEverything(fixture.pullRequest(base, base, merge).outputs, "unexpected-merge-shape");
      expectEverything(fixture.pullRequest(base, head, base).outputs, "unexpected-merge-shape");
      // The head itself, unmerged, is an acceptable tested commit.
      expectOnly(fixture.pullRequest(base, head, head).outputs, ["launch-core", "launch-browser"]);
      // No changed path at all is unexpected for a pull request.
      expectEverything(fixture.pullRequest(head, head, head).outputs, "empty-diff");
    });
  });

  test("a SHA must name its commit exactly, not by a longer prefix", () => {
    withFixture((fixture) => {
      const base = fixture.git("rev-parse", "HEAD");
      fixture.git("checkout", "-q", "-b", "topic");
      fixture.write("docs/SOUL.md", "soul, revised\n");
      const head = fixture.commit("docs");
      const merge = fixture.merge(base, head);
      const padded = (sha: string) => `${sha}${"0".repeat(24)}`;
      expect(padded(base)).toHaveLength(64);
      expectEverything(fixture.pullRequest(padded(base), head, merge).outputs, "git-failure");
      expectEverything(fixture.pullRequest(base, padded(head), merge).outputs, "git-failure");
      expectEverything(fixture.pullRequest(base, head, padded(merge)).outputs, "git-failure");
      expectOnly(fixture.pullRequest(base, head, merge).outputs, ["launch-core", "launch-browser"]);
    });
  });

  test("logs and classifies each changed path once", () => {
    withFixture((fixture) => {
      const base = fixture.git("rev-parse", "HEAD");
      fixture.git("checkout", "-q", "-b", "topic");
      const names = Array.from({ length: 301 }, (_, index) => `docs/bulk/${String(index).padStart(3, "0")}.md`);
      const head = fixture.commitMany(names, "many docs");
      const result = fixture.pullRequest(base, head, fixture.merge(base, head));
      expect(result.code, result.stderr).toBe(0);
      expectOnly(result.outputs, ["launch-core", "launch-browser"]);
      const logged = result.stdout.split("\n").filter((line) => line.startsWith("changed "));
      // Both diffs name all 301 paths; the log lists 300 once each.
      expect(logged).toHaveLength(301);
      expect(new Set(logged.slice(0, 300)).size).toBe(300);
      expect(logged[300]).toBe("changed ... 1 more paths not listed");
    });
  });

  test("more distinct paths than the limit select every job without classifying them", () => {
    const limit = Number(/^readonly MAX_PATHS=(\d+)$/m.exec(readFileSync(SCRIPT, "utf8"))?.[1]);
    expect(limit).toBeGreaterThanOrEqual(1000);
    withFixture((fixture) => {
      const base = fixture.git("rev-parse", "HEAD");
      fixture.git("checkout", "-q", "-b", "topic");
      const names = Array.from({ length: limit + 1 }, (_, index) => `docs/bulk/${index}.md`);
      const head = fixture.commitMany(names, "too many docs");
      const result = fixture.pullRequest(base, head, fixture.merge(base, head));
      expect(result.code, result.stderr).toBe(0);
      expectEverything(result.outputs, "too-many-paths");
      expect(result.stdout).not.toContain("changed ");
    });
  }, 30_000);

  test("refuses to run without a GitHub output file", () => {
    const result = runScript([], { env: { GITHUB_EVENT_NAME: "push" } });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("GITHUB_OUTPUT is not set");
  });
});

// A draft pull request runs nothing: every job but the push-only YUTABASE
// projector carries this clause, the classifier included.
const NOT_DRAFT = "github.event.pull_request.draft != true";
// A push to main whose exact tree a green pull-request run already tested
// ("proven" by bin/ci-tree-proof.sh) skips everything after the classifier.
const PROVEN = "needs.changes.outputs.proven == 'true'";
const CHANGES_IF = `\${{ ${NOT_DRAFT} }}`;
const LINUX_IF = `\${{ !cancelled() && ${NOT_DRAFT} && !(needs.changes.result == 'success' && ${PROVEN}) }}`;
const AGGREGATE_IF = `\${{ always() && ${NOT_DRAFT} && !(needs.changes.result == 'success' && ${PROVEN}) }}`;
const FILTER_IF = (area: string) =>
  area === "sdk-python"
    ? // A proven push still tests the Python versions its pull request skipped.
      `\${{ !cancelled() && ${NOT_DRAFT} && !(needs.changes.result == 'success' && ((${PROVEN} && needs.changes.outputs.sdk-python-rest != 'true') || needs.changes.outputs.${area} == 'false')) }}`
    : `\${{ !cancelled() && ${NOT_DRAFT} && !(needs.changes.result == 'success' && (${PROVEN} || needs.changes.outputs.${area} == 'false')) }}`;

const AREA_JOB_NAMES: Record<string, string> = {
  "api-protocol-postgres": "API PostgreSQL holds and launch transactions",
  "launch-core": "Launch core outsider journey",
  "launch-browser": "Launch browser journeys",
  "native-macos-secret": "Native macOS secret helper",
  "care-before-learning": "Care before learning (Node 22.18.0 and 25.2.1)",
  "witnessed-agent-economy": "Witnessed agent economy",
  packages: "Data, ADDS, and SDK",
  "sdk-python": "Python SDK (${{ matrix.python-version }})",
};

const AGGREGATED = [
  ["api-protocol-postgres", "API_PROTOCOL_POSTGRES"],
  ["launch-core", "LAUNCH_CORE"],
  ["launch-browser", "LAUNCH_BROWSER"],
  ["native-macos-secret", "NATIVE_MACOS_SECRET"],
  ["care-before-learning", "CARE_BEFORE_LEARNING"],
] as const;

describe("ci.yml consumes the classifier fail-closed", () => {
  test("the classifier job checks out full history without credentials and runs the script", () => {
    const changes = jobs.changes!;
    expect(Object.keys(jobs)[0]).toBe("changes");
    expect(changes.name).toBe("Changed areas");
    expect(changes["runs-on"]).toBe("ubuntu-24.04");
    expect(changes.needs).toBeUndefined();
    expect(changes.if).toBe(CHANGES_IF);
    // actions: read is for the push-to-main tree lookup; nothing here writes.
    expect(changes.permissions).toEqual({ contents: "read", actions: "read" });
    expect(changes.steps).toHaveLength(6);
    expect(changes.steps?.[0]?.uses).toBe("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1");
    expect(changes.steps?.[0]?.with).toEqual({ "fetch-depth": 0, "persist-credentials": false });
    const classifyStep = changes.steps?.[1];
    expect(classifyStep?.id).toBe("classify");
    // Event fields reach the script only through the environment.
    expect(classifyStep?.run).toBe("bin/bash-without-env-hooks.sh bin/ci-changed-areas.sh");
    expect(classifyStep?.env).toEqual({
      CI_PR_BASE_SHA: "${{ github.event.pull_request.base.sha }}",
      CI_PR_HEAD_SHA: "${{ github.event.pull_request.head.sha }}",
    });
    const expectedOutputs = Object.fromEntries(
      ["everything", "reason", ...AREAS].map((name) => [name, `\${{ steps.classify.outputs.${name} }}`]),
    );
    expect(changes.outputs).toEqual({
      ...expectedOutputs,
      proven: "${{ steps.proof.outputs.proven }}",
      "sdk-python-rest": "${{ steps.proof.outputs.sdk-python-rest }}",
    });
    // The YUTABASE coverage notice rides along on pull requests; it reads no
    // event field and changes no output (bin/tests/yutabase-ci-access.test.ts).
    const notice = changes.steps?.[2];
    expect(notice?.name).toBe("Explain the private YUTABASE fixture coverage boundary");
    expect(notice?.uses).toBeUndefined();
    expect(notice?.id).toBeUndefined();
    expect(notice?.env).toBeUndefined();
  });

  test("a pull request into main records its tested tree and parent, and only a push to main looks them up", () => {
    const [tree, record, proof] = jobs.changes!.steps!.slice(3);
    // The tree of GITHUB_SHA (GitHub's test merge) and that merge's first
    // parent, the main commit it tested on, name the record. A pull request
    // stacked on another branch records nothing. Either step may fail without
    // failing the job: the push then runs every job.
    expect(tree).toEqual({
      name: "Name the tree this pull request tests and the main commit under it",
      id: "tree",
      if: "${{ github.event_name == 'pull_request' && github.base_ref == 'main' }}",
      "continue-on-error": true,
      env: { CI_PR_HEAD_SHA: "${{ github.event.pull_request.head.sha }}" },
      run: [
        'tree="$(git rev-parse --verify "$GITHUB_SHA^{tree}")"',
        "# GitHub's test merge: its first parent is the main commit it tested",
        "# on and its second is the pull request's head.",
        'read -r _ parent head rest <<<"$(git rev-list --parents -n 1 "$GITHUB_SHA")"',
        'test -n "$head"',
        'test "$head" = "$CI_PR_HEAD_SHA"',
        'test -z "$rest"',
        `printf '%s\\n' "$GITHUB_SHA" >"$RUNNER_TEMP/ci-tested-tree.txt"`,
        `printf 'tree=%s\\nparent=%s\\n' "$tree" "$parent" >>"$GITHUB_OUTPUT"`,
        "",
      ].join("\n"),
    });
    expect(record).toEqual({
      name: "Record the tested tree for the push to main",
      if: "${{ github.event_name == 'pull_request' && steps.tree.outputs.tree != '' && steps.tree.outputs.parent != '' }}",
      "continue-on-error": true,
      uses: "actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f",
      with: {
        name: "ci-tested-tree-${{ steps.tree.outputs.tree }}-on-${{ steps.tree.outputs.parent }}",
        path: "${{ runner.temp }}/ci-tested-tree.txt",
        "retention-days": 14,
        "if-no-files-found": "error",
        overwrite: true,
      },
    });
    // The token reaches only the lookup script, and only on a push. A crash
    // leaves `proven` unset, which runs every job without failing the job.
    expect(proof).toEqual({
      name: "Look for a green pull-request run of this exact tree",
      id: "proof",
      if: "${{ github.event_name == 'push' }}",
      "continue-on-error": true,
      env: { GH_TOKEN: "${{ github.token }}", CI_PUSH_BEFORE_SHA: "${{ github.event.before }}" },
      run: "bin/bash-without-env-hooks.sh bin/ci-tree-proof.sh",
    });
    expect(workflowSource.match(/github\.token/g)).toHaveLength(1);
    // bin/ci-tree-proof.sh looks the record up by this exact name, with the
    // push's `before` in the parent's place.
    expect(readFileSync(join(ROOT, "bin", "ci-tree-proof.sh"), "utf8")).toContain(
      'readonly artifact_name="ci-tested-tree-$tree-on-$before_sha"',
    );
  });

  test("the tree step names GitHub's two-parent test merge and fails on any other shape", () => {
    const step = jobs.changes!.steps!.find((candidate) => candidate.id === "tree")!;
    withFixture((fixture) => {
      const base = fixture.git("rev-parse", "HEAD");
      fixture.git("checkout", "-q", "-b", "topic");
      fixture.write("docs/SOUL.md", "soul, revised\n");
      const head = fixture.commit("docs");
      fixture.git("checkout", "-q", "-b", "other", base);
      fixture.write("docs/OTHER.md", "other\n");
      const other = fixture.commit("other");
      const merge = fixture.merge(base, head);
      fixture.git("checkout", "-q", "--detach", base);
      fixture.git("merge", "-q", "--no-ff", "-m", "octopus", head, other);
      const octopus = fixture.git("rev-parse", "HEAD");
      // GitHub runs an unconfigured step as `bash -e {0}`.
      const runStep = (tested: string, prHead: string) => {
        const scratch = mkdtempSync(join(tmpdir(), "ci-tree-step-"));
        try {
          const script = join(scratch, "step.sh");
          const output = join(scratch, "github-output");
          writeFileSync(script, step.run!);
          writeFileSync(output, "");
          const result = Bun.spawnSync(["/bin/bash", "--noprofile", "--norc", "-e", script], {
            cwd: fixture.dir,
            env: {
              PATH: SYSTEM_PATH,
              HOME: fixture.dir,
              ...GIT_ENV,
              GITHUB_SHA: tested,
              CI_PR_HEAD_SHA: prHead,
              RUNNER_TEMP: scratch,
              GITHUB_OUTPUT: output,
            },
            stdout: "pipe",
            stderr: "pipe",
          });
          return { code: result.exitCode, outputs: readFileSync(output, "utf8") };
        } finally {
          rmSync(scratch, { recursive: true, force: true });
        }
      };
      const tested = runStep(merge, head);
      expect(tested.code).toBe(0);
      expect(tested.outputs).toBe(`tree=${fixture.git("rev-parse", `${merge}^{tree}`)}\nparent=${base}\n`);
      for (const [label, sha, prHead] of [
        ["another head", merge, other],
        ["no head", merge, ""],
        ["a single-parent commit", head, head],
        ["an octopus merge", octopus, head],
      ] as Array<[string, string, string]>) {
        const refused = runStep(sha, prHead);
        expect(refused.code, label).not.toBe(0);
        expect(refused.outputs, label).toBe("");
      }
    });
  });

  test("pull requests cancel superseded runs; pushes to main are never cancelled or replaced", () => {
    expect(workflow.concurrency).toEqual({
      group:
        "${{ github.event_name == 'push' && format('ci-{0}-push-{1}', github.workflow, github.sha) || format('ci-{0}-{1}-{2}', github.workflow, github.event_name, github.ref) }}",
      "cancel-in-progress": "${{ github.event_name == 'pull_request' }}",
    });
  });

  test("each filterable job keeps its name and runs unless its area is reported false", () => {
    expect(Object.keys(AREA_JOB_NAMES)).toEqual(AREAS);
    for (const area of AREAS) {
      const job = jobs[area];
      expect(job, area).toBeDefined();
      expect(job?.name).toBe(AREA_JOB_NAMES[area]);
      expect(job?.needs).toEqual(["changes"]);
      expect(job?.if).toBe(FILTER_IF(area));
    }
    // The Linux gate is never filtered by path: it waits for the classifier
    // only to learn whether a push to main is proven.
    expect(jobs["api-protocol-linux"]?.needs).toEqual(["changes"]);
    expect(jobs["api-protocol-linux"]?.if).toBe(LINUX_IF);
    for (const [name, job] of Object.entries(jobs)) {
      if (AREAS.includes(name) || name === "api-protocol" || name === "api-protocol-linux") continue;
      expect(JSON.stringify(job), name).not.toContain("needs.changes");
    }
    // Every reference to a classifier output names one it declares.
    const declared = new Set(Object.keys(jobs.changes?.outputs ?? {}));
    const references = [...workflowSource.matchAll(/needs\.changes\.outputs\.([\w-]+)/g)].map((m) => m[1]!);
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) expect(declared.has(reference), reference).toBe(true);
  });

  test("the required aggregate needs the classifier and maps each result to its area", () => {
    const aggregate = jobs["api-protocol"]!;
    expect(aggregate.name).toBe("API and protocol");
    expect(aggregate.if).toBe(AGGREGATE_IF);
    expect(aggregate.needs).toEqual(["changes", "api-protocol-linux", ...AGGREGATED.map(([job]) => job)]);
    const env: Record<string, string> = {
      CHANGES_RESULT: "${{ needs.changes.result }}",
      API_PROTOCOL_LINUX_RESULT: "${{ needs.api-protocol-linux.result }}",
    };
    for (const [job, variable] of AGGREGATED) {
      env[`${variable}_RESULT`] = `\${{ needs.${job}.result }}`;
      env[`${variable}_NEEDED`] = `\${{ needs.changes.outputs.${job} }}`;
    }
    expect(aggregate.steps?.[0]?.env).toEqual(env);
  });

  test("the aggregate accepts a skip only when the classifier succeeded and said false", () => {
    const script = jobs["api-protocol"]!.steps![0]!.run!;
    const passing: Record<string, string> = {
      CHANGES_RESULT: "success",
      API_PROTOCOL_LINUX_RESULT: "success",
    };
    for (const [, variable] of AGGREGATED) {
      passing[`${variable}_RESULT`] = "success";
      passing[`${variable}_NEEDED`] = "true";
    }
    const evaluate = (env: Record<string, string>) =>
      Bun.spawnSync(["/bin/bash", "--noprofile", "--norc", "-e", "-c", script], {
        env: { PATH: SYSTEM_PATH, ...env },
        stdout: "pipe",
        stderr: "pipe",
      }).exitCode;

    expect(evaluate(passing)).toBe(0);
    for (const changes of ["failure", "cancelled", "skipped", ""]) {
      expect(evaluate({ ...passing, CHANGES_RESULT: changes }), changes).not.toBe(0);
    }
    for (const linux of ["failure", "cancelled", "skipped", ""]) {
      expect(evaluate({ ...passing, API_PROTOCOL_LINUX_RESULT: linux }), linux).not.toBe(0);
    }
    const allSkipped = { ...passing };
    for (const [, variable] of AGGREGATED) {
      allSkipped[`${variable}_RESULT`] = "skipped";
      allSkipped[`${variable}_NEEDED`] = "false";
    }
    expect(evaluate(allSkipped)).toBe(0);
    for (const [job, variable] of AGGREGATED) {
      const cases: Array<[string, string, number]> = [
        ["success", "false", 0],
        ["skipped", "false", 0],
        ["skipped", "true", 1],
        ["skipped", "", 1],
        ["failure", "false", 1],
        ["failure", "true", 1],
        ["cancelled", "false", 1],
        ["", "false", 1],
      ];
      for (const [result, needed, expected] of cases) {
        const code = evaluate({
          ...passing,
          [`${variable}_RESULT`]: result,
          [`${variable}_NEEDED`]: needed,
        });
        expect(code === 0 ? 0 : 1, `${job} ${result}/${needed}`).toBe(expected);
      }
    }
  });
});

type Value = string | boolean | null;

/** GitHub's evaluation of the small `if` grammar ci.yml uses: string, boolean
 * and null literals, context paths, !, ==, !=, &&, ||, parentheses, always(),
 * and cancelled() for a run nobody cancelled. Strings compare without case;
 * mixed types compare as numbers (null 0, false 0, true 1, '' 0). An unknown
 * context, function, or token throws, so a new kind of condition has to be
 * modelled here before these tests can pass. */
const truthy = (value: Value) => value !== null && value !== false && value !== "";

function evaluateIf(expression: string, context: Record<string, Value>): boolean {
  return truthy(evaluateExpression(expression, context));
}

function evaluateExpression(expression: string, context: Record<string, Value>): Value {
  let source = expression.trim();
  if (source.startsWith("${{") && source.endsWith("}}")) source = source.slice(3, -2);
  const tokens = source.match(/'(?:[^']|'')*'|&&|\|\||[!=]=|!|\(|\)|[A-Za-z_][\w.-]*(?:\(\))?|\S/g) ?? [];
  let position = 0;
  const take = (expected?: string): string => {
    const token = tokens[position++];
    if (token === undefined || (expected !== undefined && token !== expected)) {
      throw new Error(`unexpected ${token} in ${expression}`);
    }
    return token;
  };
  const toNumber = (value: Value) =>
    value === null ? 0 : typeof value === "boolean" ? Number(value) : value.trim() === "" ? 0 : Number(value);
  const equal = (left: Value, right: Value) =>
    typeof left === "string" && typeof right === "string"
      ? left.toLowerCase() === right.toLowerCase()
      : typeof left === typeof right
        ? left === right
        : toNumber(left) === toNumber(right);
  function primary(): Value {
    const token = take();
    if (token === "(") {
      const value = or();
      take(")");
      return value;
    }
    if (token === "!") return !truthy(primary());
    if (token.startsWith("'")) return token.slice(1, -1).replaceAll("''", "'");
    if (token === "true" || token === "false") return token === "true";
    if (token === "null") return null;
    if (token === "always()") return true;
    if (token === "cancelled()") return false;
    if (!(token in context)) throw new Error(`unmodelled ${token} in ${expression}`);
    return context[token]!;
  }
  function comparison(): Value {
    let value = primary();
    while (tokens[position] === "==" || tokens[position] === "!=") {
      const same = take() === "==";
      value = equal(value, primary()) === same;
    }
    return value;
  }
  function and(): Value {
    let value = comparison();
    while (tokens[position] === "&&") {
      take();
      const right = comparison();
      value = truthy(value) ? right : value;
    }
    return value;
  }
  function or(): Value {
    let value = and();
    while (tokens[position] === "||") {
      take();
      const right = and();
      value = truthy(value) ? value : right;
    }
    return value;
  }
  const result = or();
  if (position !== tokens.length) throw new Error(`trailing ${tokens.slice(position).join(" ")} in ${expression}`);
  return result;
}

type Scenario = {
  event: string;
  /** Pull requests only. */
  draft?: boolean;
  /** The classifier job's result when it runs. */
  changes?: "success" | "failure";
  /** The classifier job's outputs when it runs; an unset output reads as ''. */
  outputs?: Record<string, string>;
};

/** The jobs GitHub would start, in workflow order, if every started job
 * other than the classifier succeeded. */
function jobsStarted(scenario: Scenario): string[] {
  const results: Record<string, string> = {};
  const started: string[] = [];
  const pullRequest = scenario.event === "pull_request";
  for (const [name, job] of Object.entries(jobs)) {
    const context: Record<string, Value> = {
      "github.event_name": scenario.event,
      "github.event.pull_request.draft": pullRequest ? (scenario.draft ?? false) : null,
      "github.repository": "cambridgetcg/agenttool",
      "github.ref": pullRequest ? "refs/pull/1/merge" : "refs/heads/main",
    };
    for (const need of job.needs ?? []) {
      expect(results[need], `${name} needs ${need}, which must come first`).toBeDefined();
      context[`needs.${need}.result`] = results[need]!;
      for (const output of Object.keys(jobs[need]?.outputs ?? {})) {
        context[`needs.${need}.outputs.${output}`] =
          results[need] === "skipped" ? null : (scenario.outputs?.[output] ?? "");
      }
    }
    const expression = job.if ?? "";
    let runs = expression === "" || evaluateIf(expression, context);
    // Without a status function GitHub adds success(): every need succeeded.
    if (!/\b(?:always|cancelled|success|failure)\(\)/.test(expression)) {
      runs &&= (job.needs ?? []).every((need) => results[need] === "success");
    }
    results[name] = runs ? (name === "changes" ? (scenario.changes ?? "success") : "success") : "skipped";
    if (runs) started.push(name);
  }
  return started;
}

describe("which jobs start, under GitHub's expression rules", () => {
  const every = Object.keys(jobs);
  const exceptYutabase = every.filter((name) => name !== "yutabase-projector-postgres");
  const everythingSelected = Object.fromEntries(
    ["everything", ...AREAS].map((name) => [name, "true"]),
  );

  test("the evaluator follows GitHub's coercions", () => {
    const context = { "a.null": null, "a.true": true, "a.text": "TRUE", "a.empty": "" };
    expect(evaluateIf("${{ a.null != true }}", context)).toBe(true);
    expect(evaluateIf("${{ a.true != true }}", context)).toBe(false);
    expect(evaluateIf("${{ a.text == 'true' }}", context)).toBe(true);
    expect(evaluateIf("${{ a.empty == 'false' }}", context)).toBe(false);
    expect(evaluateIf("${{ !a.null && (a.empty || a.text) }}", context)).toBe(true);
    expect(() => evaluateIf("${{ a.unknown }}", context)).toThrow();
    expect(() => evaluateIf("${{ success() }}", context)).toThrow();
  });

  test("pull requests trigger on readiness as well as new commits; main also runs weekly and on demand", () => {
    expect(workflow.on).toEqual({
      pull_request: { types: ["opened", "synchronize", "reopened", "ready_for_review"] },
      push: { branches: ["main"] },
      schedule: [{ cron: "23 4 * * 1" }],
      workflow_dispatch: null,
    });
  });

  test("a draft pull request starts nothing", () => {
    expect(jobsStarted({ event: "pull_request", draft: true })).toEqual([]);
  });

  test("a ready docs-only pull request starts the Linux gate and the jobs its paths select", () => {
    const outputs = classify(["docs/SOUL.md"]);
    expect(jobsStarted({ event: "pull_request", outputs })).toEqual(
      every.filter((name) =>
        ["changes", "api-protocol-linux", "launch-core", "launch-browser", "api-protocol"].includes(name),
      ),
    );
  });

  test("a failed classifier starts every pull-request job", () => {
    expect(jobsStarted({ event: "pull_request", changes: "failure" })).toEqual(exceptYutabase);
    expect(
      jobsStarted({ event: "pull_request", changes: "failure", outputs: { "launch-core": "false" } }),
    ).toEqual(exceptYutabase);
  });

  test("a push to main whose exact tree passed as a pull request starts only the classifier and YUTABASE", () => {
    for (const rest of ["false", ""]) {
      expect(
        jobsStarted({ event: "push", outputs: { ...everythingSelected, proven: "true", "sdk-python-rest": rest } }),
      ).toEqual(["changes", "yutabase-projector-postgres"]);
    }
  });

  test("a proven push whose pull-request run tested the Python SDK also tests the Python versions it skipped", () => {
    expect(
      jobsStarted({ event: "push", outputs: { ...everythingSelected, proven: "true", "sdk-python-rest": "true" } }),
    ).toEqual(["changes", "yutabase-projector-postgres", "sdk-python"]);
    // The flag means nothing without a proof.
    expect(
      jobsStarted({ event: "push", outputs: { ...everythingSelected, proven: "false", "sdk-python-rest": "true" } }),
    ).toEqual(every);
  });

  test("pull requests and proven pushes split the Python versions between them; every other run tests all", () => {
    const source = String(jobs["sdk-python"]?.strategy?.matrix?.["python-version"]);
    const inner = /^\$\{\{ fromJSON\((.*)\) \}\}$/.exec(source)?.[1];
    expect(inner, source).toBeDefined();
    const versions = (event: string, changes: string, outputs: Record<string, string> = {}) =>
      JSON.parse(
        String(
          evaluateExpression(inner!, {
            "github.event_name": event,
            "needs.changes.result": changes,
            "needs.changes.outputs.proven": outputs.proven ?? "",
          }),
        ),
      ) as string[];
    const all = ["3.9", "3.10", "3.11", "3.12", "3.13", "3.14"];
    const pullRequest = versions("pull_request", "success");
    const proven = versions("push", "success", { proven: "true" });
    expect(pullRequest).toEqual(["3.9", "3.10", "3.14"]);
    expect([...pullRequest, ...proven].sort()).toEqual([...all].sort());
    expect(versions("push", "success", { proven: "false" })).toEqual(all);
    expect(versions("push", "failure", { proven: "true" })).toEqual(all);
    expect(versions("schedule", "success")).toEqual(all);
    expect(versions("workflow_dispatch", "success")).toEqual(all);
  });

  test("any other push to main starts every job", () => {
    for (const proven of ["false", ""]) {
      expect(jobsStarted({ event: "push", outputs: { ...everythingSelected, proven } }), proven).toEqual(every);
    }
    // A failed classifier job is never trusted, whatever it reported.
    expect(
      jobsStarted({ event: "push", changes: "failure", outputs: { ...everythingSelected, proven: "true" } }),
    ).toEqual(every);
  });

  test("scheduled and manual runs start every job but the push-only YUTABASE projector", () => {
    for (const event of ["schedule", "workflow_dispatch"]) {
      expect(jobsStarted({ event, outputs: everythingSelected }), event).toEqual(exceptYutabase);
    }
  });
});

const trackedFiles = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: ROOT, stdout: "pipe" })
  .stdout.toString()
  .split("\0")
  .filter(Boolean);
const tracked = new Set(trackedFiles);
const trackedDirectories = new Set<string>();
for (const file of trackedFiles) {
  const parts = file.split("/");
  for (let index = 1; index < parts.length; index += 1) trackedDirectories.add(parts.slice(0, index).join("/"));
}

/** A path inside a tracked directory, so directory rules are exercised. */
const probe = (path: string) => (trackedDirectories.has(path) ? `${path}/ci-probe` : path);

/** Each [path, job, why]: a change to path (or inside it) must run job. */
function expectAllRun(checks: Array<[string, string, string]>): void {
  expect(checks.length).toBeGreaterThan(0);
  const results = areasOf(checks.map(([path]) => probe(path)));
  const missing = checks
    .filter(([, area], index) => !results[index]!.includes(area))
    .map(([path, area, why]) => `${why}: a change to ${path} must run ${area}`);
  expect(missing).toEqual([]);
}

/** The trees whose code each filtered job runs, for the code-scanning guards. */
function jobRoots(): Record<string, string[]> {
  const packageRoots = [...trackedDirectories].filter((path) => /^packages\/[^/]+$/.test(path));
  const packageAreas = areasOf(packageRoots.map(probe));
  const roots: Record<string, string[]> = {
    packages: packageRoots.filter(
      (_, index) => packageAreas[index]!.includes("packages") && packageAreas[index]!.length < AREAS.length,
    ),
    "witnessed-agent-economy": [
      "packages/witnessed-agent-economy",
      "packages/public-surface-binding/src",
      "packages/public-surface-recognition/src",
      "packages/wallet/src",
    ],
    "sdk-python": ["packages/sdk-py", "packages/hf-training-host"],
    "care-before-learning": [
      "packages/hf-listening-room",
      "bin/care-before-learning-hf-release.py",
      "bin/tests/test_care_before_learning_hf_release.py",
    ],
    "launch-browser": ["tests/playwright"],
    "launch-core": ["tests/launch-postgres"],
    "native-macos-secret": ["native"],
  };
  expect(roots.packages!.length).toBeGreaterThan(40);
  return roots;
}

const within = (file: string, roots: string[]) => roots.some((root) => file === root || file.startsWith(`${root}/`));

describe("rule table drift guards", () => {
  test("every tracked path matches a rule", () => {
    // An unmatched path is safe (it runs every job), but it quietly costs the
    // whole suite on every pull request that touches it. Classify it from the
    // evidence the guards below check (imports, reads, gate lists, symlinks,
    // file: dependencies), or route it to `*` when unsure; never `-` by default.
    const result = Bun.spawnSync(["/bin/bash", SCRIPT, "--unmatched"], {
      cwd: ROOT,
      env: { PATH: SYSTEM_PATH },
      stdin: new TextEncoder().encode(trackedFiles.map((file) => `${file}\0`).join("")),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    const unmatched = result.stdout.toString().split("\0").filter(Boolean);
    expect(
      unmatched.map(
        (file) =>
          `${file}: no rule in bin/ci-changed-areas.sh matches. Route it to every filtered job that reads it, or to * when unsure.`,
      ),
    ).toEqual([]);
    // The mode itself reports what it should.
    const probeResult = Bun.spawnSync(["/bin/bash", SCRIPT, "--unmatched"], {
      env: { PATH: SYSTEM_PATH },
      stdin: new TextEncoder().encode("docs/SOUL.md\0brand-new/x\0.github/workflows/private-ci.yml\0packages/new/x\0"),
      stdout: "pipe",
    });
    expect(probeResult.stdout.toString()).toBe("brand-new/x\0packages/new/x\0");
  }, 60_000);

  test("a module a job imports from another tree has every package.json above it run that job", () => {
    // Node takes a .js module's format from its nearest ancestor package.json
    // and refuses an invalid one, so those files are inputs of the importer.
    const roots = jobRoots();
    const sourceFile = /\.[cm]?[jt]sx?$/;
    const runsJavaScript = /setup-node|setup-bun|(?<![\w-])(?:node|bun|bunx|npm|npx)\s/;
    // The Python SDK and native macOS jobs run no JavaScript runtime.
    expect(AREAS.filter((area) => !runsJavaScript.test(JSON.stringify(jobs[area])))).toEqual([
      "native-macos-secret",
      "sdk-python",
    ]);
    const checks: Array<[string, string, string]> = [];
    for (const [area, areaRoots] of Object.entries(roots)) {
      if (!runsJavaScript.test(JSON.stringify(jobs[area]))) continue;
      for (const file of trackedFiles) {
        if (!within(file, areaRoots) || !sourceFile.test(file)) continue;
        let text: string;
        try {
          text = readFileSync(join(ROOT, file), "utf8");
        } catch {
          continue;
        }
        for (const match of text.matchAll(
          /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)["'](\.\.?\/[^"'\n]+)["']/g,
        )) {
          const specifier = posix.normalize(posix.join(posix.dirname(file), match[1]!));
          // TypeScript names a .ts source by its emitted .js specifier.
          const target = [specifier, specifier.replace(/\.([cm]?)js$/, ".$1ts"), specifier.replace(/\.js$/, ".tsx")]
            .find((candidate) => tracked.has(candidate));
          // Only a JavaScript-family module takes its format from package.json.
          if (!target || !sourceFile.test(target) || within(target, areaRoots)) continue;
          const parts = target.split("/");
          for (let index = 1; index < parts.length; index += 1) {
            checks.push([`${parts.slice(0, index).join("/")}/package.json`, area, `${file} imports ${target}`]);
          }
        }
      }
    }
    // tests/playwright/static-server.mjs imports infra/pages under Node.
    expect(checks.map(([path, area]) => `${path} ${area}`)).toContain("infra/package.json launch-browser");
    expectAllRun(checks);
  });

  test("a tracked symlink's target runs every job its link runs", () => {
    const links = Bun.spawnSync(["git", "ls-files", "-s", "-z"], { cwd: ROOT, stdout: "pipe" })
      .stdout.toString()
      .split("\0")
      .filter((entry) => entry.startsWith("120000 "))
      .map((entry) => entry.slice(entry.indexOf("\t") + 1));
    expect(links.length).toBeGreaterThan(0);
    const pairs: Array<[string, string]> = [];
    for (const link of links) {
      const target = posix.normalize(posix.join(posix.dirname(link), readlinkSync(join(ROOT, link))));
      if (target.startsWith("../") || target.startsWith("/")) continue;
      pairs.push([link, probe(target)]);
    }
    const linkAreas = areasOf(pairs.map(([link]) => link));
    const targetAreas = areasOf(pairs.map(([, target]) => target));
    pairs.forEach(([link, target], index) => {
      for (const area of linkAreas[index]!) {
        expect(targetAreas[index], `${link} -> ${target}`).toContain(area);
      }
    });
  });

  test("a package's file: dependency runs every job the package runs", () => {
    const manifests = trackedFiles.filter((file) => /^packages\/[^/]+\/package\.json$/.test(file));
    const pairs: Array<[string, string]> = [];
    for (const manifest of manifests) {
      const json = JSON.parse(readFileSync(join(ROOT, manifest), "utf8")) as Record<string, unknown>;
      for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
        for (const spec of Object.values((json[field] ?? {}) as Record<string, string>)) {
          const local = /^(?:file|link):(.+)$/.exec(spec)?.[1];
          if (!local) continue;
          pairs.push([dirname(manifest), posix.normalize(posix.join(dirname(manifest), local))]);
        }
      }
    }
    expect(pairs.length).toBeGreaterThan(0);
    const dependantAreas = areasOf(pairs.map(([dependant]) => probe(dependant)));
    const dependencyAreas = areasOf(pairs.map(([, dependency]) => probe(dependency)));
    pairs.forEach(([dependant, dependency], index) => {
      for (const area of dependantAreas[index]!) {
        expect(dependencyAreas[index], `${dependant} -> ${dependency}`).toContain(area);
      }
    });
  });

  test("every package the gates install or test runs the jobs that install or test it", () => {
    const preparer = readFileSync(join(ROOT, "bin", "prepare-hermetic-deps.sh"), "utf8");
    const preflight = readFileSync(join(ROOT, "bin", "preflight.sh"), "utf8");
    const array = (name: string) =>
      (new RegExp(`readonly -a ${name}=\\(\\n([\\s\\S]*?)\\n\\)`).exec(preparer)?.[1] ?? "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    const apiWorkspaces = array("API_WORKSPACES");
    const packageWorkspaces = array("PACKAGE_WORKSPACES");
    expect(apiWorkspaces).toContain("api");
    expect(packageWorkspaces.length).toBeGreaterThan(40);
    const checks: Array<[string, string, string]> = [];
    const installInputs = ["package.json", "bun.lock", "bunfig.toml", ".npmrc"];
    for (const workspace of apiWorkspaces) {
      for (const input of installInputs) {
        for (const area of API_PREP) checks.push([`${workspace}/${input}`, area, "API_WORKSPACES install"]);
      }
    }
    for (const workspace of packageWorkspaces) {
      for (const input of installInputs) {
        checks.push([`${workspace}/${input}`, "packages", "PACKAGE_WORKSPACES install"]);
      }
    }
    const gate = /packages_gate\(\) \{([\s\S]*?)\n\}/.exec(preflight)?.[1] ?? "";
    const gated = [...new Set([...gate.matchAll(/packages\/([\w.-]+)/g)].map((match) => `packages/${match[1]}`))];
    expect(gated.length).toBeGreaterThan(40);
    for (const directory of gated) checks.push([directory, "packages", "bin/preflight.sh packages gate"]);
    expectAllRun(checks);
  });

  test("every repository path a filtered job names runs that job", () => {
    // Directories a job names whose relevant contents other rules route to it.
    const partial: Record<string, string> = {
      "packages apps/docs": "the LOVE check reads only apps/docs/.well-known and apps/docs/packages",
      "care-before-learning bin/tests": "unittest discovery imports only *.py there, routed by bin/*.py",
    };
    const strings = (value: unknown): string[] =>
      typeof value === "string"
        ? [value]
        : value && typeof value === "object"
          ? Object.values(value).flatMap(strings)
          : [];
    const checks: Array<[string, string, string]> = [];
    for (const area of AREAS) {
      const named = new Set<string>();
      for (const text of strings(jobs[area])) {
        for (const match of text.matchAll(
          /(?<![\w.$\/-])((?:api|apps|bin|docs|native|packages|tests|tools|infra|public|review)\/[\w.@\/-]*\w)/g,
        )) {
          const path = match[1]!;
          if (!(tracked.has(path) || trackedDirectories.has(path))) continue;
          if (`${area} ${path}` in partial) continue;
          named.add(path);
        }
      }
      expect(named.size, area).toBeGreaterThan(0);
      for (const path of named) checks.push([path, area, `ci.yml job ${area}`]);
    }
    expectAllRun(checks);
  });

  test("the provider-adapter evidence sources run the jobs that hash them", () => {
    const evidence = JSON.parse(
      readFileSync(join(ROOT, "review", "provider-adapters", "v1", "evidence.json"), "utf8"),
    ) as { sources: Array<{ path: string }> };
    expect(evidence.sources.length).toBeGreaterThan(0);
    expectAllRun(
      evidence.sources.flatMap(({ path }): Array<[string, string, string]> => [
        [path, "sdk-python", "provider-adapter evidence"],
        [path, "packages", "provider-adapter evidence"],
      ]),
    );
  });

  test("repository files named as string literals in a job's code run that job", () => {
    // Literals that name a repository file only as data, never read by the job.
    const namedNotRead: Record<string, string> = {
      "docs/IDENTITY-ANCHOR.md": "sdk-ts pathway payload fixture",
      "docs/KIN.md": "sdk-ts pathway payload fixture",
      "docs/SOUL.md": "sdk-ts pathway payload fixture",
      "docs/TUTORIAL-WAKE-YOUR-AGENT.md": "sdk-ts pathway payload fixture",
      "docs/KINGDOM-OS-SDK.md": "sdk-ts error safety pointer",
      "docs/syneidesis-bootstrap.md": "sdk-ts reading-anchor string",
      "api/src/services/wake/markdown.ts": "sdk-py handoff example payload",
      "api/src/routes/handoff.ts": "sdk-py handoff test payload",
      "api/src/services/welcome/isness.ts": "hf-listening-room source manifest entry; verify reads only hf/",
      "packages/trials/hf/revocable-feedback-space/index.html": "hf-listening-room source manifest entry",
      "packages/trials/hf/revocable-feedback-space/scripts/validate-space.mjs":
        "hf-listening-room source manifest entry",
    };
    const roots = jobRoots();
    const topLevel = new Set(trackedFiles.map((file) => file.split("/")[0]!));
    const binary = /\.(?:png|jpe?g|gif|ico|webp|woff2?|ttf|tgz|gz|zip|wasm|lock|lockb)$/;
    const checks: Array<[string, string, string]> = [];
    for (const [area, areaRoots] of Object.entries(roots)) {
      for (const file of trackedFiles) {
        if (!within(file, areaRoots)) continue;
        if (binary.test(file) || file.endsWith(".md")) continue;
        let text: string;
        try {
          text = readFileSync(join(ROOT, file), "utf8");
        } catch {
          continue;
        }
        if (text.length > 2_000_000) continue;
        const candidates = new Set<string>();
        for (const match of text.matchAll(/["']((?:\.\.\/)*[\w.@-]+(?:\/[\w.@-]+)+)["']/g)) {
          const literal = match[1]!;
          candidates.add(literal.startsWith("../") ? posix.normalize(posix.join(posix.dirname(file), literal)) : literal);
        }
        for (const match of text.matchAll(/(?:["'][\w.@-]+["']\s*,\s*)+["'][\w.@-]+["']/g)) {
          const segments = [...match[0].matchAll(/["']([\w.@-]+)["']/g)]
            .map((segment) => segment[1]!)
            .filter((segment) => segment !== "..");
          for (let start = 0; start < segments.length - 1; start += 1) {
            candidates.add(segments.slice(start).join("/"));
          }
        }
        for (const candidate of candidates) {
          if (!candidate.includes("/") || !topLevel.has(candidate.split("/")[0]!)) continue;
          if (!tracked.has(candidate) || candidate in namedNotRead) continue;
          checks.push([area, candidate, file]);
        }
      }
    }
    expect(checks.length).toBeGreaterThan(20);
    const results = areasOf(checks.map(([, candidate]) => candidate));
    const missing = checks
      .filter(([area], index) => !results[index]!.includes(area))
      .map(([area, candidate, file]) => `${candidate} (named in ${file}) must run ${area}`);
    expect(missing).toEqual([]);
    for (const path of Object.keys(namedNotRead)) expect(tracked.has(path), path).toBe(true);
  });
});
