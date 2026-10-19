#!/usr/bin/env bun
/**
 * Lint for the shared tree's GitHub Actions workflows.
 *
 *   bun tools/workflow-lint.ts --repository <owner/name> [--dir .github/workflows]
 *
 * Every workflow in the shared tree must:
 *
 * - not be named `private-*`: such workflows belong to the private
 *   repository and never enter the shared tree;
 * - give every job an `if:` whose top level is
 *   `github.repository == '<owner/name>'` (alone or followed by `&& ...`),
 *   so a copy of the tree anywhere else starts nothing;
 * - use no secret but GITHUB_TOKEN, no deployment environment, and no write
 *   permission (an OIDC `id-token: write` included), and declare top-level
 *   permissions;
 * - deploy nothing: no Fly.io action, `flyctl` or `fly` deploy command, or
 *   `FLY_` variable;
 * - pin every action and reusable workflow by a full commit SHA;
 * - not run on `pull_request_target` or `workflow_run`, which give code from
 *   a fork a privileged token.
 *
 * Findings name the file and the job; exit 1 when there is any.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Whether a job condition is `github.repository == '<repo>'` joined by && at its top level. */
export function repositoryGuarded(condition: string | undefined, repository: string): boolean {
  if (condition === undefined) return false;
  let source = String(condition).trim();
  if (source.startsWith("${{") && source.endsWith("}}")) source = source.slice(3, -2).trim();
  // A top-level || would let the rest of the condition start the job anywhere.
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "'") index = source.indexOf("'", index + 1);
    else if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (depth === 0 && source.startsWith("||", index)) return false;
    if (index < 0) return false;
  }
  source = source.replace(/^(?:always\(\)|!cancelled\(\)) && /u, "");
  const guard = `github.repository == '${repository}'`;
  return source === guard || source.startsWith(`${guard} && `);
}

type Step = { uses?: unknown; run?: unknown };
type Job = { if?: unknown; environment?: unknown; permissions?: unknown; uses?: unknown; steps?: Step[] };

const PINNED = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[0-9a-f]{40}$/u;
const FORBIDDEN_TRIGGERS = ["pull_request_target", "workflow_run"];
const FLY = /superfly\/|\bflyctl\b|\bfly\s+(?:deploy|ssh|secrets|machine|machines|apps|auth|scale|releases)\b|\bFLY_[A-Z0-9_]+/u;
/** An expression (`${{ ... }}`); job and step `if:` values are expressions without the braces. */
const EXPRESSION = /\$\{\{([\s\S]*?)\}\}/gu;
const SECRET_NAME = /\bsecrets\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)|\bsecrets\s*\[\s*'([^']*)'\s*\]/gu;
const SECRETS_CONTEXT = /\bsecrets\b/u;
const INHERIT = /^\s*secrets\s*:\s*inherit\b/mu;

function pinned(uses: string): boolean {
  return uses.startsWith("./") || PINNED.test(uses) || /^docker:\/\/[^@\s]+@sha256:[0-9a-f]{64}$/u.test(uses);
}

function writes(permissions: unknown): boolean {
  if (permissions === undefined || permissions === null) return false;
  if (typeof permissions === "string") return permissions === "write-all";
  if (typeof permissions !== "object") return true;
  return Object.values(permissions as Record<string, unknown>).some((value) => value === "write");
}

function triggers(on: unknown): string[] {
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on.map(String);
  if (typeof on === "object" && on !== null) return Object.keys(on);
  return [];
}

/** Lint findings for one workflow file, as `<file>: <problem>` lines. */
export function lintWorkflow(file: string, source: string, repository: string): string[] {
  const problems: string[] = [];
  const add = (problem: string) => problems.push(`${file}: ${problem}`);
  if (/^private-/u.test(file)) add("a private-* workflow belongs to the private repository only");
  if (!/\.ya?ml$/u.test(file)) add("not a .yml or .yaml workflow file");
  let workflow: { on?: unknown; permissions?: unknown; jobs?: Record<string, Job> };
  try {
    workflow = Bun.YAML.parse(source) as typeof workflow;
  } catch (error) {
    add(`does not parse (${(error as Error).message})`);
    return problems;
  }
  if (typeof workflow !== "object" || workflow === null) {
    add("is not a workflow mapping");
    return problems;
  }
  for (const trigger of triggers(workflow.on)) {
    if (FORBIDDEN_TRIGGERS.includes(trigger)) add(`runs on ${trigger}`);
  }
  if (workflow.permissions === undefined) add("declares no top-level permissions");
  if (writes(workflow.permissions)) add("grants a write permission at the top level");
  // Any use of the secrets context but secrets.GITHUB_TOKEN: a named secret,
  // an indexed one, the whole context (toJSON(secrets), format('{0}', secrets)),
  // or `secrets: inherit`. Only expressions are read, so prose that says
  // "secrets" (a step name, a comment) is not a use.
  const expressions = [...source.matchAll(EXPRESSION)].map((match) => match[1] as string);
  for (const job of Object.values(typeof workflow.jobs === "object" && workflow.jobs !== null ? workflow.jobs : {})) {
    if (typeof job?.if === "string") expressions.push(job.if);
    for (const step of job?.steps ?? []) if (typeof (step as { if?: unknown })?.if === "string") expressions.push((step as { if: string }).if);
  }
  for (const expression of expressions) {
    let rest = expression;
    for (const match of expression.matchAll(SECRET_NAME)) {
      const name = match[1] ?? match[2];
      if (name !== "GITHUB_TOKEN") add(`reads secret ${name}`);
      rest = rest.replace(match[0], "");
    }
    if (SECRETS_CONTEXT.test(rest)) add("reads the secrets context");
  }
  if (INHERIT.test(source)) add("passes secrets: inherit");
  if (FLY.test(source)) add("names a Fly.io deploy action, command, or variable");
  const jobs = workflow.jobs;
  if (typeof jobs !== "object" || jobs === null || Object.keys(jobs).length === 0) {
    add("has no jobs");
    return problems;
  }
  for (const [name, job] of Object.entries(jobs)) {
    if (!repositoryGuarded(typeof job?.if === "string" ? job.if : undefined, repository)) {
      add(`job ${name} does not start with if: github.repository == '${repository}'`);
    }
    if (job?.environment !== undefined) add(`job ${name} uses a deployment environment`);
    if (writes(job?.permissions)) add(`job ${name} grants a write permission`);
    if (job?.uses !== undefined && !pinned(String(job.uses))) add(`job ${name} calls a workflow that is not pinned by commit`);
    for (const [index, step] of (job?.steps ?? []).entries()) {
      if (step?.uses !== undefined && !pinned(String(step.uses))) add(`job ${name} step ${index + 1} uses an action that is not pinned by commit`);
    }
  }
  return problems;
}

/** Lints every file in a workflow directory. */
export function lintDirectory(dir: string, repository: string): string[] {
  const problems: string[] = [];
  for (const file of readdirSync(dir).sort()) problems.push(...lintWorkflow(file, readFileSync(join(dir, file), "utf8"), repository));
  return problems;
}

function main(argv: readonly string[]): number {
  let repository: string | undefined;
  let dir = ".github/workflows";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--repository" && value !== undefined) repository = value;
    else if (arg === "--dir" && value !== undefined) dir = value;
    else {
      console.error("usage: bun tools/workflow-lint.ts --repository <owner/name> [--dir .github/workflows]");
      return 2;
    }
    index += 1;
  }
  if (repository === undefined || !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/u.test(repository)) {
    console.error("workflow lint: --repository <owner/name> is required");
    return 2;
  }
  const problems = lintDirectory(dir, repository);
  for (const problem of problems) console.log(problem);
  if (problems.length > 0) {
    console.error(`workflow lint: ${problems.length} problem(s)`);
    return 1;
  }
  console.error("workflow lint: clean");
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
