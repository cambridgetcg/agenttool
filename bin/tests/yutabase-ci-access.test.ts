import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  "continue-on-error"?: boolean;
};
type Job = {
  if?: string;
  needs?: string[];
  environment?: string;
  permissions?: Record<string, string>;
  env?: Record<string, string>;
  strategy?: { matrix?: { postgres?: string[] } };
  steps: Step[];
  "continue-on-error"?: boolean;
};
const source = readFileSync(new URL("../../.github/workflows/private-ci.yml", import.meta.url), "utf8");
const workflow = Bun.YAML.parse(source) as {
  on: Record<string, unknown>;
  jobs: Record<string, Job>;
};
const integration = workflow.jobs["yutabase-projector-postgres"];
// The pull-request coverage notice is a step of the "Changed areas" job.
const notice = workflow.jobs.changes!.steps.find(
  step => step.name === "Explain the private YUTABASE fixture coverage boundary",
)!;

// Evaluate the actual workflow guard's deliberately narrow expression grammar.
// Unsupported operators or extra contexts fail the test rather than widening it.
function admitted(expression: string, context: Record<string, string>): boolean {
  return expression.split(" && ").map((clause) => {
    const match = /^github\.(repository|event_name|ref) == '([^']+)'$/.exec(clause);
    if (!match) throw new Error("unexpected admission expression");
    // GitHub expression string equality is case-insensitive; the trigger and
    // independently provisioned environment supply the branch restriction.
    return context[match[1]!]?.toLowerCase() === match[2]!.toLowerCase();
  }).every(Boolean);
}

describe("YUTABASE private fixture CI access", () => {
  test("admits only this repository's main push, including when event refs overlap", () => {
    const base = { repository: "cambridgetcg/agenttool", event_name: "push", ref: "refs/heads/main" };
    for (const [context, expected] of [
      [base, true],
      [{ ...base, event_name: "pull_request" }, false],
      [{ ...base, event_name: "pull_request", ref: "refs/pull/42/merge" }, false],
      [{ ...base, event_name: "pull_request_target" }, false],
      [{ ...base, event_name: "workflow_dispatch" }, false],
      [{ ...base, event_name: "workflow_run" }, false],
      [{ ...base, ref: "refs/heads/feature" }, false],
      [{ ...base, ref: "refs/tags/main" }, false],
      [{ ...base, repository: "a-fork/agenttool" }, false],
    ] as const) {
      expect(admitted(integration.if!, context)).toBe(expected);
    }
    expect(workflow.on).not.toHaveProperty("pull_request_target");
    expect(workflow.on.push).toEqual({ branches: ["main"] });
    expect(integration.environment).toBe("yutabase-fixture-read");
    expect(integration.strategy?.matrix?.postgres).toEqual(["16", "17"]);
    expect(integration["continue-on-error"]).toBeUndefined();
    expect(integration.steps.every(step => step["continue-on-error"] === undefined)).toBe(true);
  });

  test("confines the dedicated key to the pre-check and pinned strict fixture checkout", () => {
    const secret = "${{ secrets.YUTABASE_FIXTURE_SSH_KEY }}";
    expect(source.split(secret)).toHaveLength(3);
    const credentialSteps = integration.steps.filter(step => JSON.stringify(step).includes(secret));
    expect(credentialSteps).toHaveLength(2);
    expect(JSON.stringify(integration.env ?? {})).not.toContain("secrets.");
    const fixture = integration.steps.find(step => step.with?.repository === "cambridgetcg/yutabase")!;
    expect(fixture.uses).toBe("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1");
    expect(fixture.with).toEqual({
      repository: "cambridgetcg/yutabase",
      ref: "2948ae3cd88a5e630257549f1e233f5f46a8129b",
      path: "_yutabase-fixture",
      "ssh-key": secret,
      "ssh-strict": true,
      "persist-credentials": false,
    });
    expect(integration.steps[0]?.env).toEqual({ YUTABASE_FIXTURE_SSH_KEY: secret });
    expect(integration.steps.findIndex(step => step === fixture)).toBeGreaterThan(0);
    expect(integration.steps.some(step => step.run === "bun run test:postgres")).toBe(true);
    expect(integration.steps.at(-1)?.run).toContain("bun src/cli.ts hello");
    expect(integration.steps.at(-1)?.run).toContain("--json");
  });

  test("missing-key pre-check fails clearly and never prints a supplied key", () => {
    const script = integration.steps[0]!.run!;
    const missing = Bun.spawnSync(["/bin/bash", "--noprofile", "--norc", "-eu", "-c", script], {
      env: { PATH: "/usr/bin:/bin" },
    });
    expect(missing.exitCode).toBe(1);
    expect(missing.stdout.toString()).toContain("YUTABASE_FIXTURE_SSH_KEY is missing");
    const canary = "test-key-canary-never-log";
    const present = Bun.spawnSync(["/bin/bash", "--noprofile", "--norc", "-eu", "-c", script], {
      env: { PATH: "/usr/bin:/bin", YUTABASE_FIXTURE_SSH_KEY: canary },
    });
    expect(present.exitCode).toBe(0);
    expect(present.stdout.toString() + present.stderr.toString()).not.toContain(canary);
  });

  test("PR notice exposes missing integration coverage without credentials", () => {
    expect(workflow.jobs).not.toHaveProperty("yutabase-projector-pr-coverage");
    expect(notice).toBeDefined();
    expect(admitted(notice.if!, { event_name: "pull_request" })).toBe(true);
    expect(admitted(notice.if!, { event_name: "push" })).toBe(false);
    // A plain shell step: no action, no environment, no token or secret.
    expect(notice.uses).toBeUndefined();
    expect(notice.env).toBeUndefined();
    expect(notice.with).toBeUndefined();
    const changes = workflow.jobs.changes!;
    expect(changes.environment).toBeUndefined();
    expect(JSON.stringify(changes)).not.toContain("secrets.");
    expect(JSON.stringify(notice)).not.toContain("github.token");
    expect(notice.run).toContain("not a PostgreSQL integration pass");
    expect(notice.run).toContain("not run for pull requests");
    expect(notice.run).toContain('"$GITHUB_STEP_SUMMARY"');
  });
});
