/** Push-to-main tree proof for .github/workflows/ci.yml.
 *
 * bin/ci-tree-proof.sh may let a push to main skip the full suite only when a
 * green pull-request run of ci.yml already tested the identical tree. These
 * tests drive the script against a disposable Git fixture and a stub `gh`
 * that replays canned REST responses through the script's own jq filters
 * (jq, which ubuntu-24.04 and current macOS ship in /usr/bin), and check
 * that every refusal, failure, and unexpected answer reports `proven=false`.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const SCRIPT = join(ROOT, "bin", "ci-tree-proof.sh");
const REPOSITORY = "cambridgetcg/agenttool";
const JQ = Bun.which("jq", { PATH: "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin" });

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

const sandbox = mkdtempSync(join(tmpdir(), "ci-tree-proof-"));
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: { PATH: "/usr/bin:/bin", HOME: cwd, ...GIT_ENV },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  return result.stdout.toString().trim();
}

const repo = join(sandbox, "repo");
mkdirSync(repo);
git(repo, "init", "-q", "-b", "main");
writeFileSync(join(repo, "README.md"), "fixture\n");
git(repo, "add", "-A");
git(repo, "commit", "-q", "-m", "fixture");
const SHA = git(repo, "rev-parse", "HEAD");
const TREE = git(repo, "rev-parse", "HEAD^{tree}");
const ARTIFACT = `ci-tested-tree-${TREE}`;

// The stub records each call, refuses anything but GET, and answers from
// <responses>/<endpoint with slashes as underscores>.json through `--jq`.
// A missing response file is a failed call, as a 404 would be.
const STUB = `#!/bin/bash
set -u
printf '%s\\n' "$@" '--end--' >>"$FAKE_GH_LOG"
[[ \${1:-} == api ]] || exit 90
shift
[[ -n \${GH_TOKEN:-} ]] || exit 4
method=GET endpoint="" expression=""
while (($#)); do
  case $1 in
    --method | -X) method=$2; shift 2 ;;
    --jq | -q) expression=$2; shift 2 ;;
    -f | -F | --raw-field | --field) [[ $method == GET ]] || exit 91; shift 2 ;;
    -*) exit 92 ;;
    *) endpoint=$1; shift ;;
  esac
done
[[ $method == GET ]] || exit 93
response="$FAKE_GH_RESPONSES/\${endpoint//\\//_}.json"
[[ -f $response ]] || exit 1
exec "$FAKE_JQ" -r "$expression" <"$response"
`;
const stubDirectory = join(sandbox, "stub");
mkdirSync(stubDirectory);
writeFileSync(join(stubDirectory, "gh"), STUB);
chmodSync(join(stubDirectory, "gh"), 0o755);

type Artifact = { id: number; name?: string; expired?: boolean; run: number; fork?: boolean };
type Run = { path?: string; event?: string; status?: string; conclusion?: string | null; fork?: boolean };

const artifactsEndpoint = `repos/${REPOSITORY}/actions/artifacts`;
const runEndpoint = (id: number) => `repos/${REPOSITORY}/actions/runs/${id}`;

let caseNumber = 0;

function prove(options: {
  artifacts?: Artifact[] | "fail";
  runs?: Record<number, Run>;
  env?: Record<string, string | undefined>;
}): { code: number; stdout: string; outputs: string; summary: string; calls: string[][] } {
  caseNumber += 1;
  const directory = join(sandbox, `case-${caseNumber}`);
  const responses = join(directory, "responses");
  mkdirSync(responses, { recursive: true });
  const file = (endpoint: string) => join(responses, `${endpoint.replaceAll("/", "_")}.json`);
  if (options.artifacts !== "fail") {
    writeFileSync(
      file(artifactsEndpoint),
      JSON.stringify({
        total_count: options.artifacts?.length ?? 0,
        artifacts: (options.artifacts ?? []).map((artifact) => ({
          id: artifact.id,
          name: artifact.name ?? ARTIFACT,
          expired: artifact.expired ?? false,
          workflow_run: {
            id: artifact.run,
            repository_id: 1,
            head_repository_id: artifact.fork ? 2 : 1,
            head_sha: "0".repeat(40),
          },
        })),
      }),
    );
  }
  for (const [id, run] of Object.entries(options.runs ?? {})) {
    writeFileSync(
      file(runEndpoint(Number(id))),
      JSON.stringify({
        id: Number(id),
        path: run.path ?? ".github/workflows/ci.yml",
        event: run.event ?? "pull_request",
        status: run.status ?? "completed",
        conclusion: run.conclusion === undefined ? "success" : run.conclusion,
        repository: { full_name: REPOSITORY },
        head_repository: { full_name: run.fork ? "someone/agenttool" : REPOSITORY },
      }),
    );
  }
  const output = join(directory, "github-output");
  const summary = join(directory, "step-summary");
  const log = join(directory, "gh-calls");
  writeFileSync(output, "");
  writeFileSync(summary, "");
  writeFileSync(log, "");
  const env: Record<string, string> = {
    PATH: `${stubDirectory}:/usr/bin:/bin`,
    HOME: directory,
    FAKE_GH_LOG: log,
    FAKE_GH_RESPONSES: responses,
    FAKE_JQ: JQ ?? "/nonexistent/jq",
    GITHUB_OUTPUT: output,
    GITHUB_STEP_SUMMARY: summary,
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_SHA: SHA,
    GH_TOKEN: "test-token-not-a-secret",
  };
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  const result = Bun.spawnSync(["/bin/bash", SCRIPT], { cwd: repo, env, stdout: "pipe", stderr: "pipe" });
  const calls = readFileSync(log, "utf8")
    .split("--end--\n")
    .filter(Boolean)
    .map((call) => call.split("\n").filter(Boolean));
  return {
    code: result.exitCode,
    stdout: result.stdout.toString(),
    outputs: readFileSync(output, "utf8"),
    summary: readFileSync(summary, "utf8"),
    calls,
  };
}

function expectVerdict(result: ReturnType<typeof prove>, proven: boolean, run: string, reason: string): void {
  expect(result.code, result.stdout).toBe(0);
  expect(result.outputs).toBe(`proven=${proven}\nproof-run=${run}\n`);
  expect(result.stdout).toBe(`proven=${proven} proof-run=${run || "-"} reason=${reason}\n`);
  expect(result.summary).toContain(`| ${proven} | ${run || "-"} | ${reason} |`);
}

const green: Run = {};

describe("bin/ci-tree-proof.sh", () => {
  test("the stub replays responses through jq", () => {
    expect(JQ, "jq is required to replay the script's REST filters").toBeTruthy();
  });

  test("accepts a green pull-request run of ci.yml that recorded this exact tree", () => {
    const result = prove({ artifacts: [{ id: 1, run: 111 }], runs: { 111: green } });
    expectVerdict(result, true, "111", "green-pull-request-run");
    // Two GETs, the first filtered to this tree's artifact name.
    expect(result.calls).toEqual([
      ["api", "--method", "GET", artifactsEndpoint, "-f", `name=${ARTIFACT}`, "-f", "per_page=100", "--jq", expect.any(String)],
      ["api", "--method", "GET", runEndpoint(111), "--jq", expect.any(String)],
    ]);
  });

  test("refuses runs that are not a completed, successful pull_request run of ci.yml in this repository", () => {
    for (const [label, run] of [
      ["failed", { conclusion: "failure" }],
      ["cancelled", { conclusion: "cancelled" }],
      ["in progress", { status: "in_progress", conclusion: null }],
      ["another workflow", { path: ".github/workflows/local-starter.yml" }],
      ["a workflow path with a ref suffix", { path: ".github/workflows/ci.yml@refs/heads/x" }],
      ["a push run", { event: "push" }],
      ["a pull_request_target run", { event: "pull_request_target" }],
      ["a fork head", { fork: true }],
    ] as Array<[string, Run]>) {
      const result = prove({ artifacts: [{ id: 1, run: 111 }], runs: { 111: run } });
      expect(result.outputs, label).toBe("proven=false\nproof-run=\n");
      expect(result.stdout, label).toContain("reason=recorded-run-not-green");
    }
  });

  test("ignores artifacts that are expired, from a fork, or misnamed, without asking about their runs", () => {
    const result = prove({
      artifacts: [
        { id: 1, run: 111, expired: true },
        { id: 2, run: 222, fork: true },
        { id: 3, run: 333, name: `ci-tested-tree-${"0".repeat(40)}` },
      ],
      runs: { 111: green, 222: green, 333: green },
    });
    expectVerdict(result, false, "", "no-recorded-run");
    expect(result.calls).toHaveLength(1);
  });

  test("keeps looking past a red or unreadable run to a green one", () => {
    const result = prove({
      artifacts: [
        { id: 1, run: 111 },
        { id: 2, run: 222 },
        { id: 3, run: 333 },
      ],
      runs: { 111: { conclusion: "failure" }, 333: green },
    });
    expectVerdict(result, true, "333", "green-pull-request-run");
    expect(result.calls).toHaveLength(4);
  });

  test("reports a failed lookup as unproven", () => {
    expectVerdict(prove({ artifacts: "fail" }), false, "", "artifact-lookup-failed");
    expectVerdict(prove({ artifacts: [] }), false, "", "no-recorded-run");
    expectVerdict(prove({ artifacts: [{ id: 1, run: 111 }] }), false, "", "run-lookup-failed");
  });

  test("asks about at most twenty candidate runs", () => {
    const artifacts = Array.from({ length: 25 }, (_, index) => ({ id: index + 1, run: 1000 + index }));
    const runs = Object.fromEntries(artifacts.map(({ run }) => [run, { conclusion: "failure" } as Run]));
    runs[1024] = green;
    const result = prove({ artifacts, runs });
    expectVerdict(result, false, "", "recorded-run-not-green");
    expect(result.calls).toHaveLength(21);
  });

  test("refuses before any API call outside a main push or without a usable commit or token", () => {
    for (const [env, reason] of [
      [{ GITHUB_EVENT_NAME: "pull_request" }, "not-a-main-push"],
      [{ GITHUB_EVENT_NAME: "schedule" }, "not-a-main-push"],
      [{ GITHUB_EVENT_NAME: undefined }, "not-a-main-push"],
      [{ GITHUB_REF: "refs/heads/feature" }, "not-a-main-push"],
      [{ GITHUB_REPOSITORY: "cambridgetcg/agenttool/../x" }, "bad-repository"],
      [{ GITHUB_REPOSITORY: undefined }, "bad-repository"],
      [{ GITHUB_SHA: SHA.toUpperCase() }, "bad-sha"],
      [{ GITHUB_SHA: `${SHA}\n` }, "bad-sha"],
      [{ GITHUB_SHA: "$(id)" }, "bad-sha"],
      [{ GH_TOKEN: "" }, "no-token"],
      [{ GH_TOKEN: undefined }, "no-token"],
      [{ GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567" }, "git-failure"],
    ] as Array<[Record<string, string | undefined>, string]>) {
      const result = prove({ artifacts: [{ id: 1, run: 111 }], runs: { 111: green }, env });
      expectVerdict(result, false, "", reason);
      expect(result.calls, reason).toEqual([]);
    }
  });

  test("refuses to run without a GitHub output file", () => {
    const result = prove({ env: { GITHUB_OUTPUT: undefined } });
    expect(result.code).toBe(2);
    expect(result.calls).toEqual([]);
  });

  test("reason is drawn from the documented vocabulary", () => {
    const source = readFileSync(SCRIPT, "utf8");
    const documented = (/^# `reason` .*? is\n# one of: ([\s\S]*?)\.\n/m.exec(source)?.[1] ?? "")
      .replace(/\n#/g, " ")
      .split(/,\s*/)
      .map((word) => word.trim());
    const used = [...new Set([...source.matchAll(/\breason=([a-z-]+)$/gm)].map((match) => match[1]!))];
    expect(used.sort()).toEqual([...documented].sort());
  });
});
