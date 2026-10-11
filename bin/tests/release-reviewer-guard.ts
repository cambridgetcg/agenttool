// Shared checks for the step that opens each environment-protected publish
// job. Owner decision, 2026-10-11: npm and PyPI releases stay frozen until a
// required human reviewer returns to the npm-bootstrap and pypi environments.
// The step reads its environment through the GitHub API and must fail closed.
import { expect } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const REPOSITORY = "cambridgetcg/agenttool";
const REVIEWER_FILTER =
  '[.protection_rules[]? | select(.type == "required_reviewers") | .reviewers[]?] | length';

type WorkflowStep = {
  name?: string;
  uses?: string;
  run?: string;
  shell?: string;
  if?: string;
  env?: Record<string, string>;
  "continue-on-error"?: unknown;
};

export type PublishJob = {
  environment?: string;
  permissions?: Record<string, string>;
  "continue-on-error"?: unknown;
  steps: WorkflowStep[];
};

export async function readPublishJob(workflowFile: string): Promise<PublishJob> {
  const source = await readFile(join(ROOT, ".github", "workflows", workflowFile), "utf8");
  const workflow = Bun.YAML.parse(source) as { jobs: Record<string, PublishJob> };
  return workflow.jobs.publish;
}

/** The guard is the job's first step, reads only its own environment, and cannot be skipped. */
export function expectReviewerGuardFirst(job: PublishJob, environment: string): string {
  expect(job.environment).toBe(environment);
  expect(job["continue-on-error"]).toBeUndefined();
  const guard = job.steps[0];
  expect(guard.name).toBe(`Refuse to publish while ${environment} has no required reviewer`);
  expect(guard.uses).toBeUndefined();
  expect(guard.if).toBeUndefined();
  expect(guard["continue-on-error"]).toBeUndefined();
  expect(guard.shell).toBe("bash");
  expect(guard.env).toEqual({ GH_TOKEN: "${{ github.token }}" });
  const script = guard.run ?? "";
  expect(script).toContain("set -euo pipefail");
  expect(script).toContain(`gh api "repos/\${GITHUB_REPOSITORY}/environments/${environment}"`);
  expect(script).toContain(`--jq '${REVIEWER_FILTER}'`);
  expect(script).not.toMatch(/secrets\.|NODE_AUTH_TOKEN|ACTIONS_ID_TOKEN|bin\//);
  const syntax = Bun.spawnSync(["bash", "-n", "-c", script], { stderr: "pipe" });
  expect(syntax.exitCode).toBe(0);
  return script;
}

async function runGuard(
  script: string,
  response: { body: string } | { apiFailure: true },
): Promise<{ code: number; stdout: string; ghCalls: string[] }> {
  const directory = await mkdtemp(join(tmpdir(), "agenttool-reviewer-guard-"));
  try {
    const log = join(directory, "gh-calls");
    const body = join(directory, "response.json");
    await writeFile(log, "");
    await writeFile(body, "body" in response ? response.body : "");
    // A stand-in for `gh api … --jq FILTER`: it records the call and applies
    // the filter with jq, or fails the way gh does on an HTTP error.
    const gh = join(directory, "gh");
    await writeFile(
      gh,
      [
        "#!/usr/bin/env bash",
        "set -u",
        'printf "%s\\n" "$*" >> "$FAKE_GH_LOG"',
        'if [[ "$FAKE_GH_API_FAILURE" == 1 ]]; then echo "gh: Not Found (HTTP 404)" >&2; exit 1; fi',
        'filter=""',
        'while (($#)); do if [[ "$1" == --jq ]]; then filter="$2"; shift; fi; shift; done',
        'exec jq -r "$filter" "$FAKE_GH_RESPONSE"',
        "",
      ].join("\n"),
    );
    await chmod(gh, 0o755);
    const result = Bun.spawnSync(
      ["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", script],
      {
        env: {
          PATH: `${directory}:${process.env.PATH ?? ""}`,
          GITHUB_REPOSITORY: REPOSITORY,
          GH_TOKEN: "fixture-token",
          FAKE_GH_LOG: log,
          FAKE_GH_RESPONSE: body,
          FAKE_GH_API_FAILURE: "apiFailure" in response ? "1" : "0",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    return {
      code: result.exitCode,
      stdout: new TextDecoder().decode(result.stdout),
      ghCalls: (await readFile(log, "utf8")).split("\n").filter(Boolean),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Every answer short of a required_reviewers rule with a reviewer stops the job. */
export async function expectReviewerGuardFailsClosed(
  script: string,
  environment: string,
): Promise<void> {
  // The stand-in gh applies the workflow's own filter with jq, so these checks
  // exercise that filter rather than a re-implementation of it.
  if (Bun.which("jq") === null) throw new Error("jq must be on PATH to run the reviewer-guard checks");
  const branchPolicy = { id: 1, node_id: "GA_fixture_branch", type: "branch_policy" };
  const environmentBody = (rules: unknown) =>
    JSON.stringify({ name: environment, protection_rules: rules, can_admins_bypass: true });
  const refused: Array<[string, { body: string } | { apiFailure: true }]> = [
    // The shape both environments returned on 2026-10-11.
    ["branch policy only", { body: environmentBody([branchPolicy]) }],
    ["empty reviewer list", { body: environmentBody([branchPolicy, { id: 2, node_id: "GA_fixture_reviewers", type: "required_reviewers", reviewers: [] }]) }],
    ["reviewer rule without reviewers", { body: environmentBody([{ id: 2, node_id: "GA_fixture_reviewers", type: "required_reviewers" }]) }],
    ["no protection rules", { body: JSON.stringify({ name: environment }) }],
    ["unparseable response", { body: "<html>rate limited</html>" }],
    ["API failure", { apiFailure: true }],
  ];
  for (const [label, response] of refused) {
    const result = await runGuard(script, response);
    expect({ label, code: result.code === 0 ? 0 : "nonzero" }).toEqual({ label, code: "nonzero" });
    expect(result.stdout).not.toContain("required reviewer(s)");
  }

  const allowed = await runGuard(script, {
    body: environmentBody([
      branchPolicy,
      {
        id: 2,
        node_id: "GA_fixture_reviewers",
        type: "required_reviewers",
        prevent_self_review: false,
        reviewers: [{ type: "User", reviewer: { login: "fixture-reviewer", id: 1 } }],
      },
    ]),
  });
  expect(allowed.code).toBe(0);
  expect(allowed.stdout).toContain(`${environment} has 1 required reviewer(s).`);
  expect(allowed.ghCalls).toEqual([
    `api repos/${REPOSITORY}/environments/${environment} --jq ${REVIEWER_FILTER}`,
  ]);
}
