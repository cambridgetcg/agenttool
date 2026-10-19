import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

type Trigger = { branches?: string[]; paths?: string[]; types?: string[] } | null;
type Job = {
  name: string;
  "runs-on": string;
  "continue-on-error"?: boolean;
  strategy: { "fail-fast": boolean; matrix: { os: string; node: string[] } };
  steps: { "continue-on-error"?: boolean }[];
};
const source = readFileSync(new URL("../../.github/workflows/local-starter.yml", import.meta.url), "utf8");
const workflow = Bun.YAML.parse(source) as {
  on: Record<string, Trigger>;
  concurrency: { group: string; "cancel-in-progress": string };
  jobs: Record<string, Job>;
};
const job = workflow.jobs["files-and-adapters"]!;
const ALL_SYSTEMS = ["ubuntu-24.04", "macos-15", "windows-2025"];

// Evaluate the single event conditional these expressions use. Any other shape
// fails the test rather than being interpreted more widely.
function byEvent(expression: string, event: string): string {
  const match = /^github\.event_name == 'pull_request' && ([^|]+) \|\| ([^|]+)$/.exec(expression);
  if (!match) throw new Error("unexpected event expression");
  return event === "pull_request" ? match[1]! : match[2]!;
}

function systemsFor(event: string): string[] {
  const match = /^\$\{\{ fromJSON\((.+)\) \}\}$/.exec(job.strategy.matrix.os);
  if (!match) throw new Error("matrix.os must be one fromJSON expression");
  const literal = /^'(\[[^']*\])'$/.exec(byEvent(match[1]!, event));
  if (!literal) throw new Error("matrix.os branches must be JSON string literals");
  return JSON.parse(literal[1]!) as string[];
}

describe("Local starter CI matrix", () => {
  test("narrows only pull requests to Ubuntu; every other event runs all three systems", () => {
    expect(systemsFor("pull_request")).toEqual(["ubuntu-24.04"]);
    for (const event of ["push", "merge_group", "workflow_dispatch", "pull_request_target", "schedule"]) {
      expect(systemsFor(event)).toEqual(ALL_SYSTEMS);
    }
    expect(job.strategy.matrix.node).toEqual(["22.18.0", "24.18.0"]);
    expect(job.strategy["fail-fast"]).toBe(false);
    expect(job["runs-on"]).toBe("${{ matrix.os }}");
    expect(job.name).toBe("Local files and adapter fixtures (${{ matrix.os }}, Node ${{ matrix.node }})");
    expect(job["continue-on-error"]).toBeUndefined();
    expect(job.steps.every((step) => step["continue-on-error"] === undefined)).toBe(true);
  });

  test("keeps main pushes, the merge queue and manual dispatch on the full matrix", () => {
    expect(Object.keys(workflow.on).sort()).toEqual(["merge_group", "pull_request", "push", "workflow_dispatch"]);
    expect(workflow.on.push?.branches).toEqual(["main"]);
    expect(workflow.on.push?.paths).toEqual(workflow.on.pull_request?.paths);
    expect(workflow.on.push?.paths).toContain(".github/workflows/local-starter.yml");
    expect(workflow.on.merge_group?.types).toEqual(["checks_requested"]);
  });

  test("cancels superseded pull request runs but never a main push", () => {
    const group = /^local-starter-\$\{\{ github\.workflow \}\}-\$\{\{ (.+) \}\}$/.exec(workflow.concurrency.group);
    if (!group) throw new Error("unexpected concurrency group");
    expect(byEvent(group[1]!, "pull_request")).toBe("format('pr-{0}', github.event.pull_request.number)");
    for (const event of ["push", "merge_group", "workflow_dispatch"]) {
      expect(byEvent(group[1]!, event)).toBe("format('run-{0}', github.run_id)");
    }
    expect(workflow.concurrency["cancel-in-progress"]).toBe("${{ github.event_name == 'pull_request' }}");
  });
});
