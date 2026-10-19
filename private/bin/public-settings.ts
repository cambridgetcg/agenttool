#!/usr/bin/env bun
/**
 * The public development repository's server-side settings (plan L2), as a
 * reviewed list of GitHub API requests. Read private/README.md first.
 *
 *   bun private/bin/public-settings.ts [--plan]                    print the requests; send nothing
 *   bun private/bin/public-settings.ts --apply --maintainers <login,...>
 *       (only with AGENTTOOL_PUBLIC_SETTINGS_APPLY=<owner/name> in the environment)
 *
 * Written 2026-10-19 and never run. Apply it once, after the repository is
 * public and before any other push (plan 2.2), with the owner's go. Each
 * request is the documented REST call for the setting; the endpoints and
 * fields are taken from GitHub's REST reference as of 2026 and are not
 * verified against the live API here (inferred), so read each response.
 *
 * - repository features: issues, wiki, projects, and discussions off (the
 *   plan's default; reopening issues is the owner's decision), branches
 *   deleted after merge, secret scanning and push protection on;
 * - private vulnerability reporting and Dependabot alerts on;
 * - Actions: only the actions the shared workflows use, each required to be
 *   pinned by a full commit SHA; the default token read-only and unable to
 *   approve pull requests; workflow runs from every outside contributor's
 *   fork need approval;
 * - a ruleset on the default branch: no deletion, no force push, changes
 *   through a pull request, and the shared CI's checks required;
 * - the PUBLIC_IDENTITY_LOGINS variable that the shared CI's identity job
 *   reads (the maintainers' logins; deliberately not in the tree).
 *
 * The allowed actions and the required checks are read from the shared
 * workflows in this checkout, so they follow those files.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PUBLIC_REPOSITORY } from "../public-repository.ts";

const ROOT = resolve(import.meta.dir, "..", "..");
export const SHARED_WORKFLOWS = [".github/workflows/ci.yml", ".github/workflows/public-watch.yml"];
export const APPLY_CONFIRMATION = "AGENTTOOL_PUBLIC_SETTINGS_APPLY";

export interface SettingsRequest {
  method: "GET" | "PATCH" | "PUT" | "POST";
  endpoint: string;
  body?: unknown;
  why: string;
}

type Job = { name?: string; strategy?: { matrix?: Record<string, unknown> }; steps?: Array<{ uses?: string }> };

function workflows(root: string): Array<{ jobs: Record<string, Job> }> {
  return SHARED_WORKFLOWS.map((path) => Bun.YAML.parse(readFileSync(join(root, path), "utf8")) as { jobs: Record<string, Job> });
}

/** owner/repo@* for every action the shared workflows use. */
export function allowedActionPatterns(root = ROOT): string[] {
  const patterns = new Set<string>();
  for (const workflow of workflows(root)) {
    for (const job of Object.values(workflow.jobs)) {
      for (const step of job.steps ?? []) {
        if (step.uses === undefined || step.uses.startsWith("./")) continue;
        patterns.add(`${step.uses.slice(0, step.uses.indexOf("@"))}@*`);
      }
    }
  }
  return [...patterns].sort();
}

/** The check names of the shared CI's pull-request jobs (matrix jobs expanded). */
export function requiredChecks(root = ROOT): string[] {
  const ci = Bun.YAML.parse(readFileSync(join(root, SHARED_WORKFLOWS[0] as string), "utf8")) as { jobs: Record<string, Job> };
  const checks: string[] = [];
  for (const [id, job] of Object.entries(ci.jobs)) {
    const name = job.name ?? id;
    const matrix = job.strategy?.matrix;
    const match = /\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}/u.exec(name);
    if (match === null || matrix === undefined) {
      checks.push(name);
      continue;
    }
    for (const value of (matrix[match[1] as string] as unknown[]) ?? []) checks.push(name.replace(match[0], String(value)));
  }
  return checks.sort();
}

export function settingsPlan(options: { maintainers: string[]; root?: string; repository?: string }): SettingsRequest[] {
  const repo = options.repository ?? PUBLIC_REPOSITORY;
  const root = options.root ?? ROOT;
  const base = `repos/${repo}`;
  return [
    { method: "GET", endpoint: base, why: "the repository must exist and be public before the settings apply" },
    {
      method: "PATCH",
      endpoint: base,
      body: {
        has_issues: false,
        has_wiki: false,
        has_projects: false,
        has_discussions: false,
        delete_branch_on_merge: true,
        security_and_analysis: { secret_scanning: { status: "enabled" }, secret_scanning_push_protection: { status: "enabled" } },
      },
      why: "features off; secret scanning with push protection on",
    },
    { method: "PUT", endpoint: `${base}/private-vulnerability-reporting`, why: "private vulnerability reporting (SECURITY.md points at it)" },
    { method: "PUT", endpoint: `${base}/vulnerability-alerts`, why: "Dependabot alerts" },
    {
      method: "PUT",
      endpoint: `${base}/actions/permissions`,
      body: { enabled: true, allowed_actions: "selected", sha_pinning_required: true },
      why: "only selected actions, each pinned by a full commit SHA",
    },
    {
      method: "PUT",
      endpoint: `${base}/actions/permissions/selected-actions`,
      body: { github_owned_allowed: false, verified_allowed: false, patterns_allowed: allowedActionPatterns(root) },
      why: "exactly the actions the shared workflows use",
    },
    {
      method: "PUT",
      endpoint: `${base}/actions/permissions/workflow`,
      body: { default_workflow_permissions: "read", can_approve_pull_request_reviews: false },
      why: "the default token reads only and cannot approve pull requests",
    },
    {
      method: "PUT",
      endpoint: `${base}/actions/permissions/fork-pr-contributor-approval`,
      body: { approval_policy: "all_external_contributors" },
      why: "every outside contributor's fork run waits for approval",
    },
    {
      method: "POST",
      endpoint: `${base}/rulesets`,
      body: {
        name: "main",
        target: "branch",
        enforcement: "active",
        bypass_actors: [],
        conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
        rules: [
          { type: "deletion" },
          { type: "non_fast_forward" },
          {
            type: "pull_request",
            parameters: {
              required_approving_review_count: 0,
              dismiss_stale_reviews_on_push: true,
              require_code_owner_review: false,
              require_last_push_approval: false,
              required_review_thread_resolution: false,
            },
          },
          {
            type: "required_status_checks",
            parameters: {
              strict_required_status_checks_policy: false,
              do_not_enforce_on_create: false,
              required_status_checks: requiredChecks(root).map((context) => ({ context })),
            },
          },
        ],
      },
      why: "main changes only through pull requests that pass the shared CI; no force push or deletion",
    },
    {
      method: "POST",
      endpoint: `${base}/actions/variables`,
      body: { name: "PUBLIC_IDENTITY_LOGINS", value: options.maintainers.join(",") },
      why: "the maintainers whose commits the identity job checks",
    },
  ];
}

export function describe(request: SettingsRequest): string {
  const body = request.body === undefined ? "" : ` ${JSON.stringify(request.body)}`;
  return `${request.method} ${request.endpoint}${body}\n    # ${request.why}`;
}

function apply(requests: readonly SettingsRequest[], gh: string): number {
  for (const request of requests) {
    const args = ["api", "--method", request.method, request.endpoint];
    if (request.body !== undefined) args.push("--input", "-");
    const result = spawnSync(gh, args, { input: request.body === undefined ? undefined : JSON.stringify(request.body), encoding: "utf8" });
    if (result.status !== 0) {
      console.error(`public settings: ${request.method} ${request.endpoint} failed (${result.status}); stopping. ${result.stderr.trim()}`);
      return 1;
    }
    if (request.method === "GET") {
      const repository = JSON.parse(result.stdout) as { visibility?: string; private?: boolean };
      if (repository.private !== false || repository.visibility !== "public") {
        console.error("public settings: the repository is not public yet; stopping before any change");
        return 1;
      }
    }
    console.error(`public settings: ${request.method} ${request.endpoint} ok`);
  }
  return 0;
}

function main(argv: readonly string[]): number {
  let mode: "plan" | "apply" = "plan";
  let maintainers: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--plan") mode = "plan";
    else if (arg === "--apply") mode = "apply";
    else if (arg === "--maintainers" && argv[index + 1] !== undefined) {
      maintainers = (argv[++index] as string).split(",").map((login) => login.trim()).filter(Boolean);
    } else {
      console.error("usage: bun private/bin/public-settings.ts [--plan] | --apply --maintainers <login,...>");
      return 2;
    }
  }
  if (maintainers.some((login) => !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(login))) {
    console.error("public settings: --maintainers takes GitHub logins");
    return 2;
  }
  const requests = settingsPlan({ maintainers: maintainers.length > 0 ? maintainers : ["<maintainer-login>"] });
  if (mode === "plan") {
    for (const request of requests) console.log(describe(request));
    console.error(`public settings: ${requests.length} request(s) planned for ${PUBLIC_REPOSITORY}; nothing was sent`);
    return 0;
  }
  if (maintainers.length === 0) {
    console.error("public settings: --apply needs --maintainers");
    return 2;
  }
  if (process.env[APPLY_CONFIRMATION] !== PUBLIC_REPOSITORY) {
    console.error(`public settings: set ${APPLY_CONFIRMATION}=${PUBLIC_REPOSITORY} to confirm; nothing was sent`);
    return 2;
  }
  return apply(requests, process.env.GH ?? "gh");
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
