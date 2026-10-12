#!/usr/bin/env bun
/**
 * Creates the annotated npm release tag on a public projection commit, in a
 * local clone of the public repository. It never pushes.
 *
 *   bun bin/public-release-tag.ts --repo <public clone> --commit <sha> --package <key>
 *       [--main-ref <ref>]   the commit must be contained in this ref
 *                            (default: refs/remotes/origin/main)
 *       [--ci-run <id>]      pin the public CI run to cite (default: the
 *                            newest run of ci.yml for the commit)
 *       [--skip-ci-check]    local dry runs only: the tag then says
 *                            "Public-CI-Run: unverified (local dry run)",
 *                            which the publish workflow refuses
 *
 * The commit and every commit behind it must be projection commits that match
 * their own PROJECTION.json (the published guard's history check). The tag is
 * `<prefix>-v<version>` from the package.json at that commit, which must
 * already name the public repository. Unless skipped, the public CI must have
 * passed on exactly that commit: the newest push run of .github/workflows/ci.yml
 * on main, read anonymously from the GitHub API, must have completed with
 * success.
 *
 * The tagger is the fixed projection identity, dated with the projection
 * commit's committer date, so the same commit, package, and CI run always give
 * the same tag object. An existing tag is left alone when it is that exact
 * object and refused otherwise. Pushing the tag is a separate, reviewed step.
 */
import { resolve } from "node:path";

import {
  type PackageJson,
  RELEASE_REPOSITORY,
  RELEASE_REPOSITORY_URL,
  RELEASE_TAGGER_EMAIL,
  RELEASE_TAGGER_NAME,
  UNVERIFIED_CI_RUN,
  expectedTag,
  parseReleaseTagObject,
  releaseSpec,
  releaseTagMessage,
  validatePackageManifest,
} from "./npm-release";
import {
  formatFinding,
  git,
  gitText,
  PROJECTION_FILE,
  parseCommit,
  parseProjection,
  projectionHistory,
} from "../public/overlay/tools/public-guard.ts";

export const DEFAULT_MAIN_REF = "refs/remotes/origin/main";
export const PUBLIC_CI_WORKFLOW_PATH = ".github/workflows/ci.yml";

export class ReleaseTagRefused extends Error {}

function refuse(message: string): never {
  throw new ReleaseTagRefused(message);
}

export interface WorkflowRun {
  id: number;
  path: string;
  event: string;
  head_branch: string;
  head_sha: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  repository: string;
  created_at: string;
}

export type FetchJson = (url: string) => Promise<{ status: number; body: unknown }>;

async function anonymousGitHubJson(url: string): Promise<{ status: number; body: unknown }> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "api.github.com") refuse("refusing an unexpected GitHub API origin");
  const response = await fetch(url, {
    headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, body: response.status === 200 ? await response.json() : undefined };
}

function workflowRun(value: unknown): WorkflowRun {
  const run = value as Record<string, unknown> | null;
  if (!run || typeof run !== "object") refuse("GitHub returned a malformed workflow run");
  const repository = (run.repository as Record<string, unknown> | undefined)?.full_name;
  if (!Number.isSafeInteger(run.id) || (run.id as number) < 1) refuse("GitHub returned a workflow run without an id");
  for (const key of ["path", "event", "head_branch", "head_sha", "status", "html_url", "created_at"]) {
    if (typeof run[key] !== "string") refuse(`GitHub workflow run ${String(run.id)} has no ${key}`);
  }
  return {
    id: run.id as number,
    path: run.path as string,
    event: run.event as string,
    head_branch: run.head_branch as string,
    head_sha: run.head_sha as string,
    status: run.status as string,
    conclusion: typeof run.conclusion === "string" ? run.conclusion : null,
    html_url: run.html_url as string,
    repository: typeof repository === "string" ? repository : "",
    created_at: run.created_at as string,
  };
}

/**
 * Chooses the public CI evidence for one commit: the pinned run when given,
 * otherwise the newest push run of ci.yml on main for exactly that commit. It
 * must have completed with success; anything else refuses.
 */
export function selectCiRun(runs: readonly WorkflowRun[], commit: string, pinned?: number): WorkflowRun {
  const candidates = runs.filter((run) =>
    run.repository === RELEASE_REPOSITORY &&
    run.path === PUBLIC_CI_WORKFLOW_PATH &&
    run.event === "push" &&
    run.head_branch === "main" &&
    run.head_sha === commit
  );
  const chosen = pinned === undefined
    ? [...candidates].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id))[0]
    : candidates.find((run) => run.id === pinned);
  if (chosen === undefined) {
    refuse(pinned === undefined
      ? `no public CI push run of ${PUBLIC_CI_WORKFLOW_PATH} on main exists for ${commit}`
      : `public CI run ${pinned} is not a push run of ${PUBLIC_CI_WORKFLOW_PATH} on main for ${commit}`);
  }
  if (chosen.status !== "completed" || chosen.conclusion !== "success") {
    refuse(`public CI run ${chosen.id} for ${commit} is ${chosen.status}/${chosen.conclusion ?? "none"}, not completed/success`);
  }
  if (chosen.html_url !== `${RELEASE_REPOSITORY_URL}/actions/runs/${chosen.id}`) refuse(`public CI run ${chosen.id} has an unexpected URL`);
  return chosen;
}

export async function publicCiRun(commit: string, pinned: number | undefined, fetchJson: FetchJson = anonymousGitHubJson): Promise<WorkflowRun> {
  if (pinned !== undefined) {
    const response = await fetchJson(`https://api.github.com/repos/${RELEASE_REPOSITORY}/actions/runs/${pinned}`);
    if (response.status !== 200) refuse(`GitHub returned HTTP ${response.status} for public CI run ${pinned}`);
    return selectCiRun([workflowRun(response.body)], commit, pinned);
  }
  const response = await fetchJson(
    `https://api.github.com/repos/${RELEASE_REPOSITORY}/actions/runs?head_sha=${commit}&event=push&per_page=100`,
  );
  if (response.status !== 200) refuse(`GitHub returned HTTP ${response.status} for the public CI runs of ${commit}`);
  const runs = (response.body as { workflow_runs?: unknown } | undefined)?.workflow_runs;
  if (!Array.isArray(runs)) refuse("GitHub returned a malformed workflow run list");
  return selectCiRun(runs.map(workflowRun), commit);
}

/** Git's environment without inherited repository, identity, or date overrides. */
function cleanGitEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.startsWith("GIT_")) continue;
    env[key] = value;
  }
  return { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_NO_REPLACE_OBJECTS: "1", ...extra };
}

export interface ReleaseTagOptions {
  repo: string;
  commit: string;
  packageKey: string;
  mainRef?: string;
  ciRun?: number;
  skipCiCheck?: boolean;
  fetchJson?: FetchJson;
}

export interface ReleaseTagResult {
  status: "created" | "unchanged";
  tag: string;
  tag_object: string;
  commit: string;
  package: string;
  version: string;
  projection_source: string;
  public_ci_run: string;
  next_step: string;
}

export async function createReleaseTag(options: ReleaseTagOptions): Promise<ReleaseTagResult> {
  const repo = resolve(options.repo);
  const env = cleanGitEnv();
  const run = (args: string[], extra: Parameters<typeof git>[2] = {}) => git(repo, args, { env, ...extra });
  const resolved = run(["rev-parse", "--verify", "--quiet", `${options.commit}^{commit}`], { allowFailure: true });
  if (resolved.status !== 0) refuse(`cannot resolve ${options.commit} to a commit in ${repo}`);
  const commit = resolved.stdout.toString("utf8").trim();

  // The commit and its whole history must be projection commits.
  const history = projectionHistory(repo, commit);
  if (history.findings.length > 0) {
    refuse(`${commit} is not a chain of projection commits:\n${history.findings.map(formatFinding).join("\n")}`);
  }
  const projection = parseProjection(run(["cat-file", "blob", `${commit}:${PROJECTION_FILE}`]).stdout);

  const mainRef = options.mainRef ?? DEFAULT_MAIN_REF;
  if (run(["rev-parse", "--verify", "--quiet", `${mainRef}^{commit}`], { allowFailure: true }).status !== 0) {
    refuse(`${mainRef} does not exist in ${repo}; fetch the public main first`);
  }
  if (run(["merge-base", "--is-ancestor", commit, mainRef], { allowFailure: true }).status !== 0) {
    refuse(`${commit} is not contained in ${mainRef}`);
  }

  const spec = releaseSpec(options.packageKey);
  const manifest = run(["cat-file", "blob", `${commit}:${spec.packagePath}/package.json`], { allowFailure: true });
  if (manifest.status !== 0) refuse(`${spec.packagePath}/package.json is not in ${commit}`);
  let version: string;
  try {
    version = validatePackageManifest(spec, JSON.parse(manifest.stdout.toString("utf8")) as PackageJson);
  } catch (error) {
    refuse(`${spec.packagePath}/package.json at ${commit}: ${(error as Error).message}`);
  }
  const tag = expectedTag(spec, version);

  let ciRun: string;
  if (options.skipCiCheck) {
    if (options.ciRun !== undefined) refuse("--ci-run and --skip-ci-check exclude each other");
    ciRun = UNVERIFIED_CI_RUN;
  } else {
    ciRun = (await publicCiRun(commit, options.ciRun, options.fetchJson)).html_url;
  }

  const message = releaseTagMessage({
    name: spec.name,
    version,
    packagePath: spec.packagePath,
    projectionCommit: commit,
    sourceCommit: projection.source_commit,
    ciRun,
  });
  const committer = parseCommit(gitText(repo, ["cat-file", "commit", commit], { env })).committer;
  const date = / (\d+) ([+-]\d{4})$/u.exec(committer);
  if (date === null) refuse(`cannot read the committer date of ${commit}`);
  const tagger = `${RELEASE_TAGGER_NAME} <${RELEASE_TAGGER_EMAIL}> ${date[1]} ${date[2]}`;
  const raw = `object ${commit}\ntype commit\ntag ${tag}\ntagger ${tagger}\n\n${message}`;
  const expectedObject = run(["hash-object", "-t", "tag", "--stdin"], { input: raw }).stdout.toString("utf8").trim();
  const nextStep = `review, then push only this tag: git -C ${repo} push origin refs/tags/${tag}`;
  const result = (status: ReleaseTagResult["status"]): ReleaseTagResult => ({
    status,
    tag,
    tag_object: expectedObject,
    commit,
    package: spec.name,
    version,
    projection_source: projection.source_commit,
    public_ci_run: ciRun,
    next_step: nextStep,
  });

  const existing = run(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`], { allowFailure: true });
  if (existing.status === 0) {
    const current = existing.stdout.toString("utf8").trim();
    if (current === expectedObject) return result("unchanged");
    refuse(`refs/tags/${tag} already exists as ${current}, not the expected ${expectedObject}; tags are never moved`);
  }

  // `git mktag` validates the object; update-ref creates the ref only if absent.
  const created = run(["mktag"], { input: raw }).stdout.toString("utf8").trim();
  if (created !== expectedObject) refuse(`git mktag wrote ${created}, expected ${expectedObject}`);
  run(["update-ref", "-m", `public-release-tag ${tag}`, `refs/tags/${tag}`, created, "0".repeat(created.length)]);
  const readBack = parseReleaseTagObject(gitText(repo, ["cat-file", "tag", `refs/tags/${tag}`], { env }));
  if (readBack.object !== commit || readBack.tag !== tag || readBack.tagger !== tagger) refuse("the written tag does not read back as created");
  return result("created");
}

function usage(): never {
  console.error(
    "usage: bun bin/public-release-tag.ts --repo <public clone> --commit <sha> --package <key>\n" +
      "       [--main-ref <ref>] [--ci-run <id> | --skip-ci-check]",
  );
  process.exit(2);
}

export function parseArgs(argv: readonly string[]): ReleaseTagOptions {
  const options: Partial<ReleaseTagOptions> = {};
  const seen = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (seen.has(arg)) usage();
    seen.add(arg);
    const value = () => {
      const next = argv[++index];
      if (next === undefined || next.startsWith("--")) usage();
      return next;
    };
    if (arg === "--repo") options.repo = value();
    else if (arg === "--commit") options.commit = value();
    else if (arg === "--package") options.packageKey = value();
    else if (arg === "--main-ref") options.mainRef = value();
    else if (arg === "--ci-run") {
      const id = value();
      if (!/^[1-9][0-9]*$/u.test(id)) usage();
      options.ciRun = Number(id);
    } else if (arg === "--skip-ci-check") options.skipCiCheck = true;
    else usage();
  }
  if (options.repo === undefined || options.commit === undefined || options.packageKey === undefined) usage();
  if (options.ciRun !== undefined && options.skipCiCheck) usage();
  return options as ReleaseTagOptions;
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(await createReleaseTag(parseArgs(process.argv.slice(2))), null, 2));
  } catch (error) {
    console.error(`public-release-tag: ${error instanceof ReleaseTagRefused ? "refused: " : ""}${(error as Error).message}`);
    process.exit(error instanceof ReleaseTagRefused ? 1 : 2);
  }
}
