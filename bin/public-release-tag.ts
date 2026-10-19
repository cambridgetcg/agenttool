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
  type FetchJson,
  type PackageJson,
  RELEASE_TAGGER_EMAIL,
  RELEASE_TAGGER_NAME,
  ReleaseTagRefused,
  UNVERIFIED_CI_RUN,
  expectedTag,
  parseReleaseTagObject,
  publicCiRun,
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
} from "../private/projection/overlay/tools/public-guard.ts";

// The CI-run evidence lives in the projected npm-release.ts, so the public
// publish workflow checks a tag's cited run with the same code as this tool.
export {
  type FetchJson,
  PUBLIC_CI_WORKFLOW_PATH,
  ReleaseTagRefused,
  publicCiRun,
  selectCiRun,
  type WorkflowRun,
} from "./npm-release";

export const DEFAULT_MAIN_REF = "refs/remotes/origin/main";

function refuse(message: string): never {
  throw new ReleaseTagRefused(message);
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
