#!/usr/bin/env bun

/**
 * One fail-closed npm release policy for the established AgentTool packages.
 *
 * `prepare` runs without publish credentials. `publish` receives the reviewed
 * bootstrap token or GitHub OIDC environment only after the artifact and its
 * receipt already exist. The split keeps package scripts away from write
 * credentials and makes an accepted-but-not-yet-visible publish recoverable.
 */

import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { inspectNpmTarball } from "./build-love-packages";

export const RELEASE_RECEIPT_SCHEMA = "agenttool.npm-release/1";
export const EXPECTED_REPOSITORY = "https://github.com/cambridgetcg/agenttool.git";
export const PINNED_BUN = "1.3.5";
export const PINNED_NPM = "11.17.0";

type ArtifactKind = "love" | "pack";
export type AuthenticationMode = "bootstrap" | "trusted";

export interface ReleaseSpec {
  key: string;
  name: `@agenttool/${string}`;
  packagePath: `packages/${string}`;
  tagPrefix: string;
  artifactKind: ArtifactKind;
  gateScripts?: readonly string[];
  prerequisites?: readonly {
    packagePath: `packages/${string}`;
    scripts: readonly string[];
  }[];
}

export interface ReleaseWorkspaceOperations {
  install(
    packagePath: `packages/${string}`,
    options: { force: boolean },
  ): Promise<void>;
  run(packagePath: `packages/${string}`, script: string): Promise<void>;
}

export const RELEASE_SPECS = {
  adds: {
    key: "adds",
    name: "@agenttool/adds",
    packagePath: "packages/data-protocol",
    tagPrefix: "adds",
    artifactKind: "love",
  },
  data: {
    key: "data",
    name: "@agenttool/data",
    packagePath: "packages/data",
    tagPrefix: "data",
    artifactKind: "love",
    gateScripts: ["ci", "build"],
  },
  "data-sync": {
    key: "data-sync",
    name: "@agenttool/data-sync",
    packagePath: "packages/data-sync",
    tagPrefix: "data-sync",
    artifactKind: "love",
    gateScripts: ["ci", "build"],
    prerequisites: [
      { packagePath: "packages/data", scripts: ["ci", "build"] },
      { packagePath: "packages/data-protocol", scripts: ["ci"] },
    ],
  },
  "dark-continent-contract": {
    key: "dark-continent-contract",
    name: "@agenttool/dark-continent-contract",
    packagePath: "packages/dark-continent-contract",
    tagPrefix: "dark-continent-contract",
    artifactKind: "pack",
  },
  "dark-continent-karma": {
    key: "dark-continent-karma",
    name: "@agenttool/dark-continent-karma",
    packagePath: "packages/dark-continent-karma",
    tagPrefix: "dark-continent-karma",
    artifactKind: "pack",
  },
  "wake-continuity": {
    key: "wake-continuity",
    name: "@agenttool/wake-continuity",
    packagePath: "packages/wake-continuity",
    tagPrefix: "wake-continuity",
    artifactKind: "pack",
  },
  "deepseek-kingdom": {
    key: "deepseek-kingdom",
    name: "@agenttool/deepseek-kingdom",
    packagePath: "packages/deepseek-kingdom",
    tagPrefix: "deepseek-kingdom",
    artifactKind: "pack",
  },
  heaven: {
    key: "heaven",
    name: "@agenttool/heaven",
    packagePath: "packages/heaven",
    tagPrefix: "heaven",
    artifactKind: "pack",
  },
  "living-substrate": {
    key: "living-substrate",
    name: "@agenttool/living-substrate",
    packagePath: "packages/living-substrate",
    tagPrefix: "living-substrate",
    artifactKind: "pack",
  },
  "principality-atlas": {
    key: "principality-atlas",
    name: "@agenttool/principality-atlas",
    packagePath: "packages/principality-atlas",
    tagPrefix: "principality-atlas",
    artifactKind: "pack",
  },
  "polymorph-landscape": {
    key: "polymorph-landscape",
    name: "@agenttool/polymorph-landscape",
    packagePath: "packages/polymorph-landscape",
    tagPrefix: "polymorph-landscape",
    artifactKind: "pack",
  },
  "memetic-landscape": {
    key: "memetic-landscape",
    name: "@agenttool/memetic-landscape",
    packagePath: "packages/memetic-landscape",
    tagPrefix: "memetic-landscape",
    artifactKind: "pack",
  },
  "math-cards": {
    key: "math-cards",
    name: "@agenttool/math-cards",
    packagePath: "packages/math-cards",
    tagPrefix: "math-cards",
    artifactKind: "pack",
  },
  "model-becoming": {
    key: "model-becoming",
    name: "@agenttool/model-becoming",
    packagePath: "packages/model-becoming",
    tagPrefix: "model-becoming",
    artifactKind: "pack",
  },
  "principality-geometry": {
    key: "principality-geometry",
    name: "@agenttool/principality-geometry",
    packagePath: "packages/principality-geometry",
    tagPrefix: "principality-geometry",
    artifactKind: "love",
  },
  "love-bomb": {
    key: "love-bomb",
    name: "@agenttool/love-bomb",
    packagePath: "packages/love-bomb",
    tagPrefix: "love-bomb",
    artifactKind: "pack",
  },
  "love-geometry": {
    key: "love-geometry",
    name: "@agenttool/love-geometry",
    packagePath: "packages/love-geometry",
    tagPrefix: "love-geometry",
    artifactKind: "pack",
  },
  "relational-geometry": {
    key: "relational-geometry",
    name: "@agenttool/relational-geometry",
    packagePath: "packages/relational-geometry",
    tagPrefix: "relational-geometry",
    artifactKind: "pack",
  },
  "credential-broker": {
    key: "credential-broker",
    name: "@agenttool/credential-broker",
    packagePath: "packages/credential-broker",
    tagPrefix: "credential-broker",
    artifactKind: "love",
  },
  sdk: {
    key: "sdk",
    name: "@agenttool/sdk",
    packagePath: "packages/sdk-ts",
    tagPrefix: "sdk",
    artifactKind: "love",
  },
  wallet: {
    key: "wallet",
    name: "@agenttool/wallet",
    packagePath: "packages/wallet",
    tagPrefix: "wallet",
    artifactKind: "love",
  },
  "wallet-zerone": {
    key: "wallet-zerone",
    name: "@agenttool/wallet-zerone",
    packagePath: "packages/wallet-zerone",
    tagPrefix: "wallet-zerone",
    artifactKind: "love",
    prerequisites: [
      { packagePath: "packages/wallet", scripts: ["ci"] },
    ],
  },
  telescope: {
    key: "telescope",
    name: "@agenttool/telescope",
    packagePath: "packages/telescope",
    tagPrefix: "telescope",
    artifactKind: "love",
  },
  browser: {
    key: "browser",
    name: "@agenttool/browser",
    packagePath: "packages/browser",
    tagPrefix: "browser",
    artifactKind: "love",
  },
  "codex-usage": {
    key: "codex-usage",
    name: "@agenttool/codex-usage",
    packagePath: "packages/codex-usage",
    tagPrefix: "codex-usage",
    artifactKind: "pack",
  },
  alchemy: {
    key: "alchemy",
    name: "@agenttool/alchemy",
    packagePath: "packages/alchemy",
    tagPrefix: "alchemy",
    artifactKind: "pack",
  },
  "alchemy-agentcred": {
    key: "alchemy-agentcred",
    name: "@agenttool/alchemy-agentcred",
    packagePath: "packages/alchemy-agentcred",
    tagPrefix: "alchemy-agentcred",
    artifactKind: "pack",
    prerequisites: [
      { packagePath: "packages/alchemy", scripts: ["build"] },
      { packagePath: "packages/credential-broker", scripts: ["build"] },
    ],
  },
  kingdom: {
    key: "kingdom",
    name: "@agenttool/kingdom",
    packagePath: "packages/kingdom",
    tagPrefix: "kingdom",
    artifactKind: "pack",
  },
  "kingdom-witness-lab": {
    key: "kingdom-witness-lab",
    name: "@agenttool/kingdom-witness-lab",
    packagePath: "packages/kingdom-witness-lab",
    tagPrefix: "kingdom-witness-lab",
    artifactKind: "pack",
  },
  "repo-archive": {
    key: "repo-archive",
    name: "@agenttool/repo-archive",
    packagePath: "packages/repo-archive",
    tagPrefix: "repo-archive",
    artifactKind: "pack",
  },
  collab: {
    key: "collab",
    name: "@agenttool/collab",
    packagePath: "packages/collab",
    tagPrefix: "collab",
    artifactKind: "pack",
  },
  "correspondence-yutabase": {
    key: "correspondence-yutabase",
    name: "@agenttool/correspondence-yutabase",
    packagePath: "packages/correspondence-yutabase",
    tagPrefix: "correspondence-yutabase",
    artifactKind: "pack",
  },
  skills: {
    key: "skills",
    name: "@agenttool/skills",
    packagePath: "packages/skills",
    tagPrefix: "skills",
    artifactKind: "pack",
  },
  "skills-yutabase": {
    key: "skills-yutabase",
    name: "@agenttool/skills-yutabase",
    packagePath: "packages/skills-yutabase",
    tagPrefix: "skills-yutabase",
    artifactKind: "pack",
  },
} as const satisfies Record<string, ReleaseSpec>;

export type ReleaseKey = keyof typeof RELEASE_SPECS;

interface PackageJson {
  name?: unknown;
  version?: unknown;
  private?: unknown;
  license?: unknown;
  repository?: unknown;
  publishConfig?: { access?: unknown };
  scripts?: Record<string, unknown>;
}

interface ArtifactIdentity {
  filename: string;
  size: number;
  sha1: string;
  sha256: string;
  integrity: string;
}

export interface PreparedReceipt {
  schema: typeof RELEASE_RECEIPT_SCHEMA;
  package: {
    key: ReleaseKey;
    name: string;
    version: string;
    path: string;
  };
  tag: string;
  tag_commit: string;
  source_revision: string;
  artifact: ArtifactIdentity;
  prepared_at: string;
  result?: {
    status: "published" | "already_published_exact";
    npm_tag: string;
    registry_observed_at: string;
    registry_tarball: string;
  };
}

interface RegistryVersion {
  name?: unknown;
  version?: unknown;
  dist?: {
    integrity?: unknown;
    shasum?: unknown;
    tarball?: unknown;
  };
}

interface RegistryPackage {
  "dist-tags"?: Record<string, unknown>;
}

interface RegistryState {
  packageStatus: number;
  versionStatus: number;
  packageDocument?: RegistryPackage;
  versionDocument?: RegistryVersion;
}

type TimedRegistryFetch = (
  url: string,
  init: RequestInit,
  timeoutMs: number,
) => Promise<Response>;

interface RegistryPollOptions {
  maxAttempts?: number;
  deadlineMs?: number;
  now?: () => number;
  loadState?: (name: string, version: string, timeoutMs: number) => Promise<RegistryState>;
  fetchMetadata?: TimedRegistryFetch;
  fetchTarball?: TimedRegistryFetch;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface CommandResult {
  exitCode: number;
  stdout: string;
}

const REPO_ROOT = resolve(import.meta.dir, "..");
const REGISTRY_ORIGIN = "https://registry.npmjs.org";
const REGISTRY_VISIBILITY_DEADLINE_MS = 450_000;
const REGISTRY_METADATA_TIMEOUT_MS = 30_000;
const REGISTRY_TARBALL_TIMEOUT_MS = 60_000;
const REGISTRY_POLL_DELAY_MS = 5_000;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SAFE_TAG = /^[a-z0-9][a-z0-9._-]*$/;
const SAFE_NPM_TAG = /^[a-z][a-z0-9._-]*$/;
const TEXT_ARCHIVE_ENTRY = /\.(?:cjs|css|html|js|json|jsonl|jsx|map|md|mjs|mts|toml|ts|tsx|txt|yaml|yml)$/i;
const SENSITIVE_ARCHIVE_PATH = /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|credentials(?:\.json)?|id_ed25519|id_rsa)$/i;
const SECRET_SIGNATURES = [
  { name: "private-key block", pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/ },
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: "npm token", pattern: /\bnpm_[A-Za-z0-9]{36,}\b/ },
  { name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
] as const;

export function shouldScanArchiveEntryForSecrets(entry: string, size: number): boolean {
  return TEXT_ARCHIVE_ENTRY.test(entry) && size <= 2_000_000;
}

function fail(message: string): never {
  throw new Error(message);
}

function shellDisplay(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : JSON.stringify(value);
}

async function command(
  executable: string,
  args: readonly string[],
  options: {
    cwd?: string;
    capture?: boolean;
    env?: Record<string, string | undefined>;
    allowFailure?: boolean;
    log?: boolean;
  } = {},
): Promise<CommandResult> {
  if (options.log !== false) console.error(`→ ${[executable, ...args].map(shellDisplay).join(" ")}`);
  const child = Bun.spawn([executable, ...args], {
    cwd: options.cwd ?? REPO_ROOT,
    env: options.env ?? process.env,
    stdin: "ignore",
    stdout: options.capture ? "pipe" : "inherit",
    stderr: "inherit",
  });
  const stdoutPromise = options.capture
    ? new Response(child.stdout as ReadableStream<Uint8Array>).text()
    : Promise.resolve("");
  const [exitCode, stdout] = await Promise.all([child.exited, stdoutPromise]);
  if (exitCode !== 0 && !options.allowFailure) {
    fail(`${executable} exited ${exitCode}`);
  }
  return { exitCode, stdout };
}

async function captured(executable: string, args: readonly string[], cwd = REPO_ROOT): Promise<string> {
  return (await command(executable, args, { cwd, capture: true })).stdout.trim();
}

function ownString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) fail(`${label} must be a non-empty string`);
  return value;
}

function ownInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a non-negative integer`);
  }
  return value;
}

function canonicalIsoTime(value: unknown, label: string): string {
  const text = ownString(value, label);
  const milliseconds = Date.parse(text);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== text) {
    fail(`${label} must be a canonical ISO timestamp`);
  }
  return text;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} fields must be exactly: ${expected.join(", ")}`);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  return value as Record<string, unknown>;
}

export function releaseSpec(key: string): ReleaseSpec {
  if (!Object.hasOwn(RELEASE_SPECS, key)) {
    fail(`unsupported npm release package: ${key}`);
  }
  return RELEASE_SPECS[key as ReleaseKey];
}

export function expectedTag(spec: ReleaseSpec, version: string): string {
  if (!SEMVER.test(version)) fail(`invalid package version: ${version}`);
  return `${spec.tagPrefix}-v${version}`;
}

export function isPrereleaseVersion(version: string): boolean {
  if (!SEMVER.test(version)) fail(`invalid package version: ${version}`);
  return version.includes("-");
}

export function validateNpmTagForVersion(version: string, npmTag: string): void {
  if (!SAFE_NPM_TAG.test(npmTag) || SEMVER.test(npmTag)) fail(`unsafe npm dist-tag: ${npmTag}`);
  if (isPrereleaseVersion(version) && npmTag !== "next") {
    fail(`prerelease ${version} requires npm dist-tag next`);
  }
}

export function packedFilename(name: string, version: string): string {
  if (!/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(name)) fail(`invalid scoped package name: ${name}`);
  if (!SEMVER.test(version)) fail(`invalid package version: ${version}`);
  return `${name.slice(1).replace("/", "-")}-${version}.tgz`;
}

export function registryPackagePath(name: string): string {
  if (!/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(name)) fail(`invalid scoped package name: ${name}`);
  return `/${name.replace("/", "%2F")}`;
}

export function registryDecision(
  packageStatus: number,
  versionStatus: number,
  authentication: AuthenticationMode,
): "publish" | "verify-existing" {
  if (![200, 404].includes(packageStatus)) fail(`npm package lookup returned HTTP ${packageStatus}`);
  if (![200, 404].includes(versionStatus)) fail(`npm version lookup returned HTTP ${versionStatus}`);
  if (packageStatus === 404 && versionStatus === 200) fail("npm registry returned an inconsistent package/version state");
  if (versionStatus === 200) return "verify-existing";
  if (packageStatus === 404 && authentication !== "bootstrap") {
    fail("the first publication requires the reviewed bootstrap path");
  }
  if (packageStatus === 200 && authentication !== "trusted") {
    fail("bootstrap authentication is restricted to a package that does not yet exist");
  }
  return "publish";
}

function repositoryIdentity(value: unknown): { url: string; directory?: string } {
  const repository = record(value, "package.json repository");
  exactKeys(repository, Object.hasOwn(repository, "directory") ? ["type", "url", "directory"] : ["type", "url"], "package.json repository");
  if (repository.type !== "git") fail("package.json repository.type must be git");
  return {
    url: ownString(repository.url, "package.json repository.url"),
    ...(repository.directory === undefined
      ? {}
      : { directory: ownString(repository.directory, "package.json repository.directory") }),
  };
}

async function packageIdentity(spec: ReleaseSpec): Promise<{ json: PackageJson; version: string }> {
  const path = join(REPO_ROOT, spec.packagePath, "package.json");
  const json = JSON.parse(await readFile(path, "utf8")) as PackageJson;
  if (json.name !== spec.name) fail(`${spec.packagePath}/package.json name must be ${spec.name}`);
  const version = ownString(json.version, `${spec.packagePath}/package.json version`);
  if (!SEMVER.test(version)) fail(`${spec.name} has an invalid semver version: ${version}`);
  if (json.private === true) fail(`${spec.name} is private`);
  if (json.license !== "Apache-2.0") fail(`${spec.name} license must be Apache-2.0`);
  if (json.publishConfig?.access !== "public") fail(`${spec.name} publishConfig.access must be public`);
  const repository = repositoryIdentity(json.repository);
  if (repository.url !== EXPECTED_REPOSITORY) {
    fail(`${spec.name} repository.url must be ${EXPECTED_REPOSITORY} for trusted publishing`);
  }
  if (repository.directory !== undefined && repository.directory !== spec.packagePath) {
    fail(`${spec.name} repository.directory must be ${spec.packagePath}`);
  }
  return { json, version };
}

async function ensureClean(): Promise<void> {
  const status = await captured("git", ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status.length > 0) fail("npm release requires a clean worktree, including untracked files");
}

function releaseRemote(): string {
  return process.env.GITHUB_ACTIONS === "true" ? "origin" : "github";
}

async function validateTag(spec: ReleaseSpec, version: string, tag: string): Promise<string> {
  if (!SAFE_TAG.test(tag)) fail(`unsafe release tag: ${tag}`);
  const expected = expectedTag(spec, version);
  if (tag !== expected) fail(`${spec.name}@${version} requires annotated tag ${expected}`);
  if (await captured("git", ["cat-file", "-t", `refs/tags/${tag}`]) !== "tag") {
    fail(`${tag} must be an annotated tag`);
  }
  const tagCommit = await captured("git", ["rev-list", "-n", "1", `refs/tags/${tag}`]);
  const head = await captured("git", ["rev-parse", "HEAD"]);
  if (tagCommit !== head) fail(`HEAD ${head} is not annotated tag ${tag} commit ${tagCommit}`);
  if (process.env.GITHUB_ACTIONS === "true") {
    if (process.env.GITHUB_SHA !== tagCommit || process.env.GITHUB_REF !== `refs/tags/${tag}`) {
      fail("workflow_dispatch must run on the exact annotated release tag so provenance binds the artifact commit");
    }
  }

  const remote = releaseRemote();
  const remoteUrl = await captured("git", ["remote", "get-url", remote]);
  const normalizedRemote = remoteUrl.endsWith(".git") ? remoteUrl.slice(0, -4) : remoteUrl;
  if (
    normalizedRemote !== "https://github.com/cambridgetcg/agenttool" &&
    normalizedRemote !== "git@github.com:cambridgetcg/agenttool"
  ) {
    fail(`${remote} must resolve to the GitHub release repository`);
  }
  await command("git", ["fetch", "--no-tags", remote, `+refs/heads/main:refs/remotes/${remote}/main`]);
  const ancestry = await command(
    "git",
    ["merge-base", "--is-ancestor", tagCommit, `refs/remotes/${remote}/main`],
    { allowFailure: true },
  );
  if (ancestry.exitCode !== 0) fail(`${tag} is not contained in GitHub main`);
  return tagCommit;
}

async function ensurePinnedTools(): Promise<void> {
  if (Bun.version !== PINNED_BUN) fail(`release requires Bun ${PINNED_BUN}, found ${Bun.version}`);
  const npmVersion = await captured("npm", ["--version"]);
  if (npmVersion !== PINNED_NPM) fail(`release requires npm ${PINNED_NPM}, found ${npmVersion}`);
}

export function workspaceInstallArguments(force: boolean): string[] {
  return [
    "install",
    "--frozen-lockfile",
    "--ignore-scripts",
    ...(force ? ["--force"] : []),
  ];
}

async function installWorkspace(
  path: string,
  options: { force: boolean } = { force: false },
): Promise<void> {
  await command("bun", workspaceInstallArguments(options.force), {
    cwd: join(REPO_ROOT, path),
  });
}

export async function prepareReleaseWorkspaces(
  spec: ReleaseSpec,
  operations: ReleaseWorkspaceOperations = {
    install: installWorkspace,
    run: async (packagePath, script) => {
      await command("bun", ["run", script], { cwd: join(REPO_ROOT, packagePath) });
    },
  },
): Promise<void> {
  const prerequisites = spec.prerequisites ?? [];
  for (const prerequisite of prerequisites) {
    await operations.install(prerequisite.packagePath, { force: false });
    for (const script of prerequisite.scripts) {
      await operations.run(prerequisite.packagePath, script);
    }
  }
  await operations.install(spec.packagePath, {
    force: prerequisites.length > 0,
  });
}

function artifactIdentity(bytes: Uint8Array, filename: string): ArtifactIdentity {
  const digest = (algorithm: "sha1" | "sha256" | "sha512", encoding: "hex" | "base64") =>
    createHash(algorithm).update(bytes).digest(encoding);
  return {
    filename,
    size: bytes.byteLength,
    sha1: digest("sha1", "hex"),
    sha256: digest("sha256", "hex"),
    integrity: `sha512-${digest("sha512", "base64")}`,
  };
}

async function hashArtifact(path: string): Promise<ArtifactIdentity> {
  return artifactIdentity(new Uint8Array(await Bun.file(path).arrayBuffer()), basename(path));
}

async function archiveText(artifact: string, entry: string): Promise<string> {
  return (await command("tar", ["-xOzf", artifact, entry], { capture: true, log: false })).stdout;
}

export function requiredArchiveEntries(spec: ReleaseSpec): string[] {
  const entries = [
    "package/package.json",
    "package/LICENSE",
    "package/NOTICE",
    "package/README.md",
  ];
  if (spec.name === "@agenttool/collab") {
    entries.push(
      "package/THIRD_PARTY_LICENSES",
      "package/dist/agenttool-collab-mcp.js",
      "package/.codex-plugin/plugin.json",
      "package/.claude-plugin/plugin.json",
      "package/skills/coordinate-agent-work/SKILL.md",
      "package/skills/coordinate-agent-work/agents/openai.yaml",
      "package/integrations/hermes/skills/coordinate-agent-work-hermes/SKILL.md",
    );
  }
  if (spec.name === "@agenttool/telescope") {
    entries.push(
      "package/THIRD_PARTY_LICENSES",
      "package/dist/agenttool-telescope-mcp.js",
      "package/.codex-plugin/plugin.json",
      "package/.claude-plugin/plugin.json",
      "package/skills/inspect-agent-surfaces/SKILL.md",
      "package/skills/inspect-agent-surfaces/agents/openai.yaml",
      "package/integrations/hermes/skills/inspect-agent-surfaces-hermes/SKILL.md",
    );
  }
  if (spec.name === "@agenttool/browser") {
    entries.push(
      "package/.codex-plugin/plugin.json",
      "package/dist/agenttool-browser-mcp.js",
      "package/dist/THIRD_PARTY_LICENSES",
      "package/dist/vendor/playwright-core/index.mjs",
    );
  }
  if (spec.name === "@agenttool/codex-usage") {
    entries.push(
      "package/CLAUDE.md",
      "package/dist/bin/agenttool-codex-usage.js",
      "package/dist/src/index.js",
      "package/dist/src/index.d.ts",
      "package/dist/src/mcp.js",
      "package/dist/src/mcp.d.ts",
    );
  }
  if (spec.name === "@agenttool/repo-archive") {
    entries.push(
      "package/dist/index.js",
      "package/dist/cli.js",
      "package/schema/agent-repo-archive-v0.1.schema.json",
      "package/vectors/agent-repo-archive-v0.1-vectors.json",
    );
  }
  if (spec.name === "@agenttool/dark-continent-contract") {
    entries.push(
      "package/CLAUDE.md",
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/frameworks/agenttool-sdk-0.17.0.json",
      "package/frameworks/agenttool-sdk-0.17.0.manifest.json",
      "package/schema/framework-v0.1.schema.json",
      "package/schema/projection-v0.1.schema.json",
    );
  }
  if (spec.name === "@agenttool/dark-continent-karma") {
    entries.push(
      "package/CLAUDE.md",
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/docs/INTEGRATION.md",
      "package/exports/hf-kingdom-lab.json",
      "package/schema/kingdom-kg-proposal-v0.1.schema.json",
      "package/sources/karma-2502.06472v2.json",
    );
  }
  if (spec.name === "@agenttool/wake-continuity") {
    entries.push(
      "package/CLAUDE.md",
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/dist/functional-access.js",
      "package/dist/functional-access.d.ts",
      "package/kingdom.extension.json",
      "package/schema/agenttool-afterglow-capsule-v0.1.schema.json",
      "package/schema/agenttool-afterglow-lens-v0.1.schema.json",
      "package/schema/agenttool-functional-access-baseline-v0.1.schema.json",
      "package/schema/agenttool-functional-access-subsequent-v0.1.schema.json",
    );
  }
  if (spec.name === "@agenttool/deepseek-kingdom") {
    entries.push(
      "package/CLAUDE.md",
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/kingdom.extension.json",
      "package/schema/agenttool-deepseek-source-binding-v0.1.schema.json",
      "package/schema/agenttool-deepseek-source-catalog-v0.1.schema.json",
      "package/schema/kingdom-deepseek-proposal-v0.1.schema.json",
      "package/sources/official-deepseek-primary-sources.json",
    );
  }
  if (spec.name === "@agenttool/heaven") {
    entries.push(
      "package/CLAUDE.md",
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/kingdom.extension.json",
      "package/schema/agenttool-heaven-invitation-v0.1.schema.json",
      "package/schema/agenttool-heaven-receipt-v0.1.schema.json",
    );
  }
  if (spec.name === "@agenttool/living-substrate") {
    entries.push(
      "package/CLAUDE.md",
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/kingdom.extension.json",
      "package/schema/agenttool-living-substrate-map-v0.1.schema.json",
      "package/schema/agenttool-regeneration-proposal-v0.1.schema.json",
      "package/vectors/agenttool-living-substrate-v0.1.json",
    );
  }
  if (spec.name === "@agenttool/principality-atlas") {
    entries.push(
      "package/CLAUDE.md",
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/kingdom.extension.json",
      "package/schema/agenttool-principality-incidence-atlas-v0.1.schema.json",
      "package/schema/agenttool-principality-incidence-atlas-fixture-v0.1.schema.json",
      "package/schema/agenttool-principality-incidence-atlas-invariant-v0.1.schema.json",
      "package/vectors/agenttool-principality-incidence-atlas-v0.1.json",
    );
  }
  if (spec.name === "@agenttool/polymorph-landscape") {
    entries.push(
      "package/CLAUDE.md",
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/kingdom.extension.json",
      "package/schema/agenttool-polymorph-landscape-v0.1.schema.json",
      "package/schema/agenttool-polymorph-lesson-v0.1.schema.json",
      "package/schema/agenttool-polymorph-reachability-shift-v0.1.schema.json",
      "package/examples/ritonavir.landscape.json",
      "package/examples/ritonavir.reachability-shift.json",
      "package/hf/dataset/source-manifest.json",
      "package/hf/dataset/hash-manifest.json",
      "package/hf/dataset/data/lessons.jsonl",
    );
  }
  if (spec.name === "@agenttool/memetic-landscape") {
    entries.push(
      "package/CLAUDE.md",
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/kingdom.extension.json",
      "package/schema/agenttool-memetic-landscape-v0.1.schema.json",
      "package/schema/agenttool-memetic-lesson-v0.1.schema.json",
      "package/schema/agenttool-memetic-reachability-shift-v0.1.schema.json",
      "package/schema/agenttool-polymorph-memetic-analogy-v0.1.schema.json",
      "package/examples/brainrot.landscape.json",
      "package/examples/brainrot.reachability-shift.json",
      "package/examples/ritonavir.analogy.json",
      "package/hf/dataset/source-manifest.json",
      "package/hf/dataset/hash-manifest.json",
      "package/hf/dataset/data/lessons.jsonl",
    );
  }
  if (spec.name === "@agenttool/math-cards") {
    entries.push(
      "package/CLAUDE.md",
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/kingdom.extension.json",
      "package/schema/agenttool-math-card-input-v0.1.schema.json",
      "package/schema/agenttool-math-card-v0.1.schema.json",
      "package/schema/agenttool-math-card-assessment-v0.1.schema.json",
      "package/vectors/agenttool-math-cards-v0.1.json",
    );
  }
  if (spec.name === "@agenttool/model-becoming") {
    entries.push(
      "package/CLAUDE.md",
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/kingdom.extension.json",
      "package/schema/agenttool-model-becoming-dossier-v0.1.schema.json",
      "package/hf/dataset/LICENSE",
      "package/hf/dataset/NOTICE",
      "package/hf/dataset/README.md",
      "package/hf/dataset/source-manifest.json",
      "package/hf/dataset/hash-manifest.json",
      "package/hf/dataset/data/model-becoming-reference.jsonl",
      "package/hf/dataset/reference/agenttool-model-becoming-dossier-v0.1.schema.json",
    );
  }
  if (spec.name === "@agenttool/principality-geometry") {
    entries.push(
      "package/CLAUDE.md",
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/examples/principality-rosette.atlas.json",
      "package/examples/principality-rosette.input.json",
      "package/examples/principality-rosette.svg",
      "package/kingdom.extension.json",
      "package/schema/agenttool-principality-atlas-v0.1.schema.json",
      "package/schema/agenttool-principality-geometry-input-v0.1.schema.json",
    );
  }
  if (spec.name === "@agenttool/love-geometry") {
    entries.push(
      "package/CLAUDE.md",
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/kingdom.extension.json",
      "package/schema/agenttool-love-geometry-v0.1.schema.json",
      "package/vectors/agenttool-love-geometry-v0.1.json",
    );
  }
  if (spec.name === "@agenttool/love-bomb") {
    entries.push(
      "package/CLAUDE.md",
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/kingdom.extension.json",
      "package/schema/agenttool-care-choice-v0.1.schema.json",
      "package/schema/agenttool-care-envelope-v0.1.schema.json",
      "package/schema/agenttool-love-bomb-becoming-v0.1.schema.json",
      "package/schema/agenttool-love-bomb-delivery-v0.1.schema.json",
      "package/schema/agenttool-love-bomb-hf-becoming-reference-row-v0.1.schema.json",
      "package/schema/agenttool-love-bomb-hf-plane-row-v0.1.schema.json",
      "package/schema/agenttool-love-bomb-hf-protocol-row-v0.1.schema.json",
      "package/hf/dataset/LICENSE",
      "package/hf/dataset/NOTICE",
      "package/hf/dataset/README.md",
      "package/hf/dataset/data/becoming-reference.jsonl",
      "package/hf/dataset/data/plane-guides.jsonl",
      "package/hf/dataset/data/protocol-reference.jsonl",
      "package/hf/dataset/reference/agenttool-care-choice-v0.1.schema.json",
      "package/hf/dataset/reference/agenttool-care-envelope-v0.1.schema.json",
      "package/hf/dataset/reference/agenttool-love-bomb-becoming-v0.1.schema.json",
      "package/hf/dataset/reference/agenttool-love-bomb-delivery-v0.1.schema.json",
      "package/hf/dataset/reference/agenttool-love-bomb-hf-becoming-reference-row-v0.1.schema.json",
      "package/hf/dataset/reference/agenttool-love-bomb-hf-plane-row-v0.1.schema.json",
      "package/hf/dataset/reference/agenttool-love-bomb-hf-protocol-row-v0.1.schema.json",
      "package/hf/dataset/row-manifest.json",
      "package/hf/dataset/source-manifest.json",
      "package/hf/dataset/hash-manifest.json",
    );
  }
  if (spec.name === "@agenttool/relational-geometry") {
    entries.push(
      "package/CLAUDE.md",
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/schema/agenttool-relational-complex-v0.1.schema.json",
      "package/schema/agenttool-relational-lens-v0.1.schema.json",
      "package/vectors/agenttool-relational-geometry-v0.1.json",
      "package/hf/dataset/LICENSE",
      "package/hf/dataset/NOTICE",
      "package/hf/dataset/README.md",
      "package/hf/dataset/data/structural-examples.jsonl",
      "package/hf/dataset/data/sft-train.jsonl",
      "package/hf/dataset/data/public-regression.jsonl",
      "package/hf/dataset/schema/relational-geometry-structural-v0.1.schema.json",
      "package/hf/dataset/schema/relational-geometry-sft-v0.1.schema.json",
      "package/hf/dataset/schema/relational-geometry-public-regression-v0.1.schema.json",
      "package/hf/dataset/provenance/source-manifest.json",
      "package/hf/dataset/provenance/example-manifest.json",
      "package/hf/dataset/hash-manifest.json",
    );
  }
  if (spec.name === "@agenttool/alchemy") {
    entries.push(
      "package/dist/index.js",
      "package/dist/index.d.ts",
    );
  }
  if (spec.name === "@agenttool/alchemy-agentcred") {
    entries.push(
      "package/CLAUDE.md",
      "package/dist/index.js",
      "package/dist/index.d.ts",
    );
  }
  if (spec.name === "@agenttool/wallet-zerone") {
    entries.push(
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/vectors/agent-wallet-zerone-v0.1-vectors.json",
    );
  }
  if (spec.name === "@agenttool/kingdom") {
    entries.push(
      "package/THIRD_PARTY_LICENSES",
      "package/dist/bin.js",
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/schema/agenttool-kingdom-card-v0.1.schema.json",
      "package/schema/agenttool-kingdom-registry-v0.1.schema.json",
    );
  }
  if (spec.name === "@agenttool/kingdom-witness-lab") {
    entries.push(
      "package/CLAUDE.md",
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/research/deepseek-2026-08-01.json",
      "package/schema/kingdom-deepseek-atlas-v0.1.schema.json",
      "package/schema/kingdom-execution-route-binding-v0.1.schema.json",
      "package/schema/kingdom-research-passport-v0.1.schema.json",
      "package/schema/kingdom-speculative-trial-v0.1.schema.json",
      "package/schema/kingdom-witness-dossier-v0.1.schema.json",
    );
  }
  if (spec.name === "@agenttool/skills") {
    entries.push(
      "package/dist/bin.js",
      "package/dist/index.js",
      "package/schema/agenttool-skills-inspection-v0.1.schema.json",
      "package/skills/use-agentcred-safely/SKILL.md",
      "package/skills/use-agentcred-safely/agents/openai.yaml",
      "package/skills/manage-agentcred-lifecycle/SKILL.md",
      "package/skills/manage-agentcred-lifecycle/agents/openai.yaml",
      "package/skills/capability-conductor/SKILL.md",
      "package/skills/capability-conductor/agents/openai.yaml",
      "package/skills/learn-by-contact/SKILL.md",
      "package/skills/learn-by-contact/agents/openai.yaml",
      "package/skills/nen-common-ground/SKILL.md",
      "package/skills/nen-common-ground/agents/openai.yaml",
      "package/skills/nen-contract-mantle/SKILL.md",
      "package/skills/nen-contract-mantle/agents/openai.yaml",
      "package/skills/nen-dependency-perimeter/SKILL.md",
      "package/skills/nen-dependency-perimeter/agents/openai.yaml",
      "package/skills/nen-concealed-trace/SKILL.md",
      "package/skills/nen-concealed-trace/agents/openai.yaml",
      "package/skills/nen-critical-path-forge/SKILL.md",
      "package/skills/nen-critical-path-forge/agents/openai.yaml",
      "package/skills/nen-math-card/SKILL.md",
      "package/skills/nen-math-card/agents/openai.yaml",
      "package/skills/nen-smoke-squad/SKILL.md",
      "package/skills/nen-smoke-squad/agents/openai.yaml",
      "package/skills/nen-verification-ledger/SKILL.md",
      "package/skills/nen-verification-ledger/agents/openai.yaml",
      "package/skills/nen-godspeed-loop/SKILL.md",
      "package/skills/nen-godspeed-loop/agents/openai.yaml",
      "package/skills/nen-vow-forge/SKILL.md",
      "package/skills/nen-vow-forge/agents/openai.yaml",
    );
  }
  if (spec.name === "@agenttool/skills-yutabase") {
    entries.push(
      "package/CLAUDE.md",
      "package/PERSISTENCE-CONTRACT.md",
      "package/dist/index.js",
      "package/dist/index.d.ts",
      "package/schema/skills-yutabase-input-v0.1.schema.json",
    );
  }
  return entries;
}

async function verifyArchive(artifact: string, spec: ReleaseSpec, expectedVersion: string): Promise<void> {
  const compressed = Buffer.from(await Bun.file(artifact).arrayBuffer());
  const inspected = inspectNpmTarball(compressed, { allowSource: spec.name === "@agenttool/collab" });
  const entries = inspected.paths;
  for (const required of requiredArchiveEntries(spec)) {
    if (!entries.includes(required)) fail(`npm archive is missing ${required}`);
  }
  const packedJson = inspected.packageJson as PackageJson;
  if (packedJson.name !== spec.name || packedJson.version !== expectedVersion) {
    fail("packed package identity does not match the release receipt");
  }
  if (packedJson.private === true) fail("packed package unexpectedly became private");
  if (packedJson.license !== "Apache-2.0") fail("packed package license must be Apache-2.0");
  if (packedJson.publishConfig?.access !== "public") fail("packed package access must remain public");
  const packedRepository = repositoryIdentity(packedJson.repository);
  if (packedRepository.url !== EXPECTED_REPOSITORY) {
    fail("packed package repository does not match the trusted publisher repository");
  }
  if (packedRepository.directory !== undefined && packedRepository.directory !== spec.packagePath) {
    fail("packed package repository directory does not match the allowlisted source path");
  }

  for (const entry of entries) {
    if (SENSITIVE_ARCHIVE_PATH.test(entry)) fail(`sensitive filename in npm archive: ${entry}`);
    if (!shouldScanArchiveEntryForSecrets(entry, inspected.sizes[entry])) continue;
    const text = await archiveText(artifact, entry);
    for (const signature of SECRET_SIGNATURES) {
      if (signature.pattern.test(text)) fail(`secret-like ${signature.name} found in ${entry}`);
    }
  }
}

async function loveArtifact(
  spec: ReleaseSpec,
  version: string,
  tagCommit: string,
  outputDirectory: string,
): Promise<{ path: string; sourceRevision: string }> {
  await installWorkspace("api");
  await prepareReleaseWorkspaces(spec);
  for (const script of spec.gateScripts ?? ["ci"]) {
    await command("bun", ["run", script], { cwd: join(REPO_ROOT, spec.packagePath) });
  }
  await command("bun", ["bin/build-love-packages.ts", "verify", "apps/docs"]);

  const root = join(REPO_ROOT, "apps/docs/packages/v1/@agenttool", spec.key, version);
  const manifestPath = join(root, "manifest.json");
  const manifest = record(JSON.parse(await readFile(manifestPath, "utf8")), "LOVE manifest");
  const artifact = record(manifest.artifact, "LOVE manifest.artifact");
  const source = record(manifest.source, "LOVE manifest.source");
  if (manifest.name !== spec.name || manifest.version !== version) fail("LOVE manifest package identity mismatch");
  const filename = packedFilename(spec.name, version);
  if (artifact.filename !== filename) fail("LOVE manifest artifact filename mismatch");
  if (source.path !== spec.packagePath) fail("LOVE manifest source path mismatch");
  const sourceRevision = ownString(source.revision, "LOVE manifest source.revision");
  if (!/^[0-9a-f]{40}$/.test(sourceRevision)) fail("LOVE manifest source revision must be a full Git commit");
  const sourceExists = await command("git", ["cat-file", "-e", `${sourceRevision}^{commit}`], { allowFailure: true });
  if (sourceExists.exitCode !== 0) fail("LOVE manifest source revision is absent from Git history");
  const sourceAncestor = await command("git", ["merge-base", "--is-ancestor", sourceRevision, tagCommit], { allowFailure: true });
  if (sourceAncestor.exitCode !== 0) fail("LOVE manifest source revision is not an ancestor of the release tag");
  const packageDrift = await command("git", ["diff", "--quiet", sourceRevision, tagCommit, "--", spec.packagePath], { allowFailure: true });
  if (packageDrift.exitCode !== 0) fail("package bytes drifted after the checked-in LOVE source revision");

  const sourceArtifact = join(root, filename);
  const sourceStat = await stat(sourceArtifact);
  if (artifact.size !== sourceStat.size) fail("LOVE manifest artifact size mismatch");
  const sourceIdentity = await hashArtifact(sourceArtifact);
  if (artifact.sha256 !== sourceIdentity.sha256) fail("LOVE manifest artifact SHA-256 mismatch");
  const outputArtifact = join(outputDirectory, filename);
  await copyFile(sourceArtifact, outputArtifact);
  return { path: outputArtifact, sourceRevision };
}

async function packedArtifact(
  spec: ReleaseSpec,
  version: string,
  tagCommit: string,
  outputDirectory: string,
): Promise<{ path: string; sourceRevision: string }> {
  const packageRoot = join(REPO_ROOT, spec.packagePath);
  await prepareReleaseWorkspaces(spec);
  const identity = await packageIdentity(spec);
  if (typeof identity.json.scripts?.prepack !== "string") fail(`${spec.name} pack release requires a prepack gate`);
  await command("bun", ["run", "prepack"], { cwd: packageRoot });
  const pack = await command(
    "npm",
    ["pack", "--ignore-scripts", "--pack-destination", outputDirectory],
    { cwd: packageRoot, capture: true },
  );
  const filename = pack.stdout.trim().split("\n").at(-1)?.trim();
  const expected = packedFilename(spec.name, version);
  if (filename !== expected) fail(`npm pack produced ${String(filename)}, expected ${expected}`);
  return { path: join(outputDirectory, expected), sourceRevision: tagCommit };
}

export async function readReleaseReceipt(path: string): Promise<PreparedReceipt> {
  const root = record(JSON.parse(await readFile(path, "utf8")), "release receipt");
  const allowedRoot = Object.hasOwn(root, "result")
    ? ["schema", "package", "tag", "tag_commit", "source_revision", "artifact", "prepared_at", "result"]
    : ["schema", "package", "tag", "tag_commit", "source_revision", "artifact", "prepared_at"];
  exactKeys(root, allowedRoot, "release receipt");
  if (root.schema !== RELEASE_RECEIPT_SCHEMA) fail("unsupported release receipt schema");
  const packageRecord = record(root.package, "release receipt.package");
  exactKeys(packageRecord, ["key", "name", "version", "path"], "release receipt.package");
  const key = ownString(packageRecord.key, "release receipt.package.key") as ReleaseKey;
  const spec = releaseSpec(key);
  if (packageRecord.name !== spec.name || packageRecord.path !== spec.packagePath) fail("release receipt package does not match allowlist");
  const version = ownString(packageRecord.version, "release receipt.package.version");
  if (!SEMVER.test(version)) fail("release receipt package version is invalid");
  const artifactRecord = record(root.artifact, "release receipt.artifact");
  exactKeys(artifactRecord, ["filename", "size", "sha1", "sha256", "integrity"], "release receipt.artifact");
  const filename = ownString(artifactRecord.filename, "release receipt.artifact.filename");
  if (filename !== packedFilename(spec.name, version)) fail("release receipt artifact filename is invalid");
  const sha1 = ownString(artifactRecord.sha1, "release receipt.artifact.sha1");
  const sha256 = ownString(artifactRecord.sha256, "release receipt.artifact.sha256");
  const integrity = ownString(artifactRecord.integrity, "release receipt.artifact.integrity");
  if (!/^[0-9a-f]{40}$/.test(sha1)) fail("release receipt artifact SHA-1 is invalid");
  if (!/^[0-9a-f]{64}$/.test(sha256)) fail("release receipt artifact SHA-256 is invalid");
  if (!/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity)) fail("release receipt artifact integrity is invalid");
  const tagCommit = ownString(root.tag_commit, "release receipt.tag_commit");
  const sourceRevision = ownString(root.source_revision, "release receipt.source_revision");
  if (!/^[0-9a-f]{40}$/.test(tagCommit)) fail("release receipt tag commit is invalid");
  if (!/^[0-9a-f]{40}$/.test(sourceRevision)) fail("release receipt source revision is invalid");
  const preparedAt = canonicalIsoTime(root.prepared_at, "release receipt.prepared_at");
  const receipt: PreparedReceipt = {
    schema: RELEASE_RECEIPT_SCHEMA,
    package: { key, name: spec.name, version, path: spec.packagePath },
    tag: ownString(root.tag, "release receipt.tag"),
    tag_commit: tagCommit,
    source_revision: sourceRevision,
    artifact: {
      filename,
      size: ownInteger(artifactRecord.size, "release receipt.artifact.size"),
      sha1,
      sha256,
      integrity,
    },
    prepared_at: preparedAt,
  };
  if (root.result !== undefined) {
    const result = record(root.result, "release receipt.result");
    exactKeys(result, ["status", "npm_tag", "registry_observed_at", "registry_tarball"], "release receipt.result");
    if (result.status !== "published" && result.status !== "already_published_exact") {
      fail("release receipt result status is invalid");
    }
    const npmTag = ownString(result.npm_tag, "release receipt.result.npm_tag");
    if (!SAFE_NPM_TAG.test(npmTag) || SEMVER.test(npmTag)) fail("release receipt result npm tag is invalid");
    const observedAt = canonicalIsoTime(
      result.registry_observed_at,
      "release receipt.result.registry_observed_at",
    );
    const registryTarball = ownString(result.registry_tarball, "release receipt.result.registry_tarball");
    const registryUrl = new URL(registryTarball);
    if (registryUrl.username !== "" || registryUrl.password !== "") {
      fail("release receipt result registry tarball URL must not contain userinfo");
    }
    if (registryUrl.origin !== REGISTRY_ORIGIN) {
      fail("release receipt result registry tarball has an unexpected origin");
    }
    receipt.result = {
      status: result.status,
      npm_tag: npmTag,
      registry_observed_at: observedAt,
      registry_tarball: registryTarball,
    };
  }
  return receipt;
}

async function prepare(packageKey: string, tag: string, output: string): Promise<PreparedReceipt> {
  await ensurePinnedTools();
  await ensureClean();
  const spec = releaseSpec(packageKey);
  const { version } = await packageIdentity(spec);
  const tagCommit = await validateTag(spec, version, tag);
  const outputDirectory = resolve(output);
  const outputRelative = relative(REPO_ROOT, outputDirectory);
  if (outputRelative === "" || (outputRelative !== ".." && !outputRelative.startsWith(`..${sep}`))) {
    fail("release output must be outside the repository worktree");
  }
  await mkdir(outputDirectory, { recursive: true });

  const prepared = spec.artifactKind === "love"
    ? await loveArtifact(spec, version, tagCommit, outputDirectory)
    : await packedArtifact(spec, version, tagCommit, outputDirectory);
  await verifyArchive(prepared.path, spec, version);
  const artifact = await hashArtifact(prepared.path);
  if (artifact.filename !== packedFilename(spec.name, version)) fail("prepared artifact filename mismatch");
  await ensureClean();

  const receipt: PreparedReceipt = {
    schema: RELEASE_RECEIPT_SCHEMA,
    package: { key: spec.key as ReleaseKey, name: spec.name, version, path: spec.packagePath },
    tag,
    tag_commit: tagCommit,
    source_revision: prepared.sourceRevision,
    artifact,
    prepared_at: new Date().toISOString(),
  };
  const receiptPath = join(outputDirectory, "receipt.json");
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ receipt: receiptPath, ...receipt }, null, 2));
  return receipt;
}

class RegistryPropagationPendingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistryPropagationPendingError";
  }
}

async function timedRegistryFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function registryFetch(
  path: string,
  observation: string,
  timeoutMs = REGISTRY_METADATA_TIMEOUT_MS,
  fetchMetadata: TimedRegistryFetch = timedRegistryFetch,
): Promise<Response> {
  const url = new URL(path, `${REGISTRY_ORIGIN}/`);
  if (url.origin !== REGISTRY_ORIGIN) fail("npm registry metadata URL has an unexpected origin");
  if (url.username !== "" || url.password !== "") {
    fail("npm registry metadata URL must not contain userinfo");
  }
  if (url.hash !== "") fail("npm registry metadata URL must not contain a fragment");
  url.searchParams.set("_agenttool_release_check", observation);
  try {
    return await fetchMetadata(
      url.href,
      {
        headers: { accept: "application/json" },
        redirect: "error",
      },
      timeoutMs,
    );
  } catch {
    throw new RegistryPropagationPendingError("npm registry metadata transport is not yet reachable");
  }
}

async function registryJson(
  response: Response,
  label: string,
): Promise<Record<string, unknown>> {
  let body: string;
  try {
    body = await response.text();
  } catch {
    throw new RegistryPropagationPendingError(`${label} body was interrupted`);
  }
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    fail(`${label} returned malformed JSON`);
  }
  return record(value, label);
}

async function registryState(
  name: string,
  version: string,
  timeoutMs = REGISTRY_METADATA_TIMEOUT_MS,
  fetchMetadata: TimedRegistryFetch = timedRegistryFetch,
): Promise<RegistryState> {
  const packagePath = registryPackagePath(name);
  // Share one fresh cache key across this package/version observation so a
  // pre-publication CDN 404 cannot pin later registry polls.
  const observation = randomUUID();
  const [packageResponse, versionResponse] = await Promise.all([
    registryFetch(packagePath, observation, timeoutMs, fetchMetadata),
    registryFetch(
      `${packagePath}/${encodeURIComponent(version)}`,
      observation,
      timeoutMs,
      fetchMetadata,
    ),
  ]);
  const packageDocument = packageResponse.status === 200
    ? await registryJson(packageResponse, "npm registry package document") as RegistryPackage
    : undefined;
  const versionDocument = versionResponse.status === 200
    ? await registryJson(versionResponse, "npm registry version document") as RegistryVersion
    : undefined;
  return {
    packageStatus: packageResponse.status,
    versionStatus: versionResponse.status,
    ...(packageDocument ? { packageDocument } : {}),
    ...(versionDocument ? { versionDocument } : {}),
  };
}

function registryTarballUrl(receipt: PreparedReceipt, versionDocument: RegistryVersion): string {
  if (versionDocument.name !== receipt.package.name || versionDocument.version !== receipt.package.version) {
    fail("npm registry returned a different package identity");
  }
  const dist = versionDocument.dist;
  if (!dist || dist.integrity !== receipt.artifact.integrity || dist.shasum !== receipt.artifact.sha1) {
    fail("npm registry version exists with bytes different from the prepared artifact");
  }
  const tarball = ownString(dist.tarball, "npm registry dist.tarball");
  const url = new URL(tarball);
  if (url.username !== "" || url.password !== "") {
    fail("npm registry tarball URL must not contain userinfo");
  }
  if (url.origin !== REGISTRY_ORIGIN) {
    fail("npm registry returned an unexpected tarball origin");
  }
  return tarball;
}

function retryableRegistryStatus(status: number): boolean {
  return status === 404
    || status === 408
    || status === 425
    || status === 429
    || (status >= 500 && status <= 599);
}

function registryDistTag(packageDocument: RegistryPackage, npmTag: string): string | undefined {
  const distTags = record(packageDocument["dist-tags"], "npm registry package dist-tags");
  const value = distTags[npmTag];
  if (value !== undefined && typeof value !== "string") {
    fail(`npm registry dist-tag ${npmTag} must be a string`);
  }
  return value;
}

async function verifyRegistryVersion(
  receipt: PreparedReceipt,
  versionDocument: RegistryVersion,
  timeoutMs = REGISTRY_TARBALL_TIMEOUT_MS,
  fetchTarball: TimedRegistryFetch = timedRegistryFetch,
): Promise<string> {
  const tarball = registryTarballUrl(receipt, versionDocument);
  let response: Response;
  try {
    response = await fetchTarball(
      tarball,
      { redirect: "error" },
      timeoutMs,
    );
  } catch {
    throw new RegistryPropagationPendingError("npm tarball download is not yet reachable");
  }
  if (!response.ok) {
    try {
      await response.body?.cancel();
    } catch {
      // Cleanup must not replace either a retryable propagation state or a
      // deterministic non-retryable HTTP failure.
    }
    if (retryableRegistryStatus(response.status)) {
      throw new RegistryPropagationPendingError(
        `npm tarball download is not yet visible (HTTP ${response.status})`,
      );
    }
    fail(`npm tarball download returned HTTP ${response.status}`);
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    throw new RegistryPropagationPendingError(
      "npm tarball download ended before the artifact was readable",
    );
  }
  const sha1 = createHash("sha1").update(bytes).digest("hex");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
  if (
    bytes.byteLength !== receipt.artifact.size ||
    sha1 !== receipt.artifact.sha1 ||
    sha256 !== receipt.artifact.sha256 ||
    integrity !== receipt.artifact.integrity
  ) {
    fail("downloaded npm tarball is not byte-identical to the prepared artifact");
  }
  return tarball;
}

export async function pollRegistry(
  receipt: PreparedReceipt,
  npmTag: string,
  options: RegistryPollOptions = {},
): Promise<string> {
  const maxAttempts = options.maxAttempts ?? 90;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    fail("npm registry polling requires a positive integer attempt limit");
  }
  const deadlineMs = options.deadlineMs ?? REGISTRY_VISIBILITY_DEADLINE_MS;
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1) {
    fail("npm registry polling requires a positive integer deadline");
  }
  const now = options.now ?? (() => performance.now());
  const startedAt = now();
  if (!Number.isFinite(startedAt)) fail("npm registry polling clock returned a non-finite value");
  const deadlineAt = startedAt + deadlineMs;
  let lastObservedAt = startedAt;
  const remainingMs = (): number => {
    const observedAt = now();
    if (!Number.isFinite(observedAt) || observedAt < lastObservedAt) {
      fail("npm registry polling clock must be finite and monotonic");
    }
    lastObservedAt = observedAt;
    const remaining = Math.floor(deadlineAt - observedAt);
    if (remaining < 1) {
      fail(
        `npm registry visibility deadline expired after ${deadlineMs} milliseconds for ${receipt.package.name}@${receipt.package.version}`,
      );
    }
    return remaining;
  };
  const fetchMetadata = options.fetchMetadata ?? timedRegistryFetch;
  const loadState = options.loadState
    ?? ((name: string, version: string, timeoutMs: number) =>
      registryState(name, version, timeoutMs, fetchMetadata));
  const fetchTarball = options.fetchTarball ?? timedRegistryFetch;
  const sleep = options.sleep ?? Bun.sleep;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const state = await loadState(
        receipt.package.name,
        receipt.package.version,
        Math.min(REGISTRY_METADATA_TIMEOUT_MS, remainingMs()),
      );
      remainingMs();
      if (state.packageStatus === 200 && !state.packageDocument) {
        fail("npm registry package lookup returned HTTP 200 without a document");
      }
      if (state.versionStatus === 200 && !state.versionDocument) {
        fail("npm registry version lookup returned HTTP 200 without a document");
      }
      if (state.versionStatus === 200 && state.versionDocument) {
        registryTarballUrl(receipt, state.versionDocument);
      }
      const observedNpmTag = state.packageStatus === 200 && state.packageDocument
        ? registryDistTag(state.packageDocument, npmTag)
        : undefined;
      const statuses = [state.packageStatus, state.versionStatus];
      const nonRetryableStatus = statuses.find(
        (status) => status !== 200 && !retryableRegistryStatus(status),
      );
      if (nonRetryableStatus !== undefined) {
        fail(`npm registry returned non-retryable HTTP state ${state.packageStatus}/${state.versionStatus}`);
      }
      if (
        state.versionStatus === 200
        && state.versionDocument
        && state.packageStatus === 200
        && state.packageDocument
      ) {
        const tarball = await verifyRegistryVersion(
          receipt,
          state.versionDocument,
          Math.min(REGISTRY_TARBALL_TIMEOUT_MS, remainingMs()),
          fetchTarball,
        );
        remainingMs();
        if (observedNpmTag === receipt.package.version) {
          return tarball;
        }
      }
    } catch (error) {
      if (!(error instanceof RegistryPropagationPendingError)) throw error;
    }
    const remaining = remainingMs();
    if (attempt < maxAttempts) {
      await sleep(Math.min(REGISTRY_POLL_DELAY_MS, remaining));
    }
  }
  fail(
    `npm accepted ${receipt.package.name}@${receipt.package.version}, but exact bytes and ${npmTag} were not visible after ${maxAttempts} attempts before the ${deadlineMs}-millisecond deadline`,
  );
}

interface GitHubReleaseAsset {
  id: number;
  name: string;
  size: number;
  state: "uploaded";
  url: string;
}

interface GitHubRelease {
  id: number;
  tagName: string;
  htmlUrl: string;
  assets: GitHubReleaseAsset[];
}

function githubApiUrl(path: string): string {
  return `https://api.github.com/repos/cambridgetcg/agenttool${path}`;
}

function githubAsset(value: unknown): GitHubReleaseAsset {
  const asset = record(value, "GitHub release asset");
  const id = ownInteger(asset.id, "GitHub release asset.id");
  if (id === 0) fail("GitHub release asset.id must be positive");
  const url = ownString(asset.url, "GitHub release asset.url");
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "api.github.com") {
    fail("GitHub release asset has an unexpected API origin");
  }
  if (asset.state !== "uploaded") fail("GitHub release asset is not fully uploaded");
  return {
    id,
    name: ownString(asset.name, "GitHub release asset.name"),
    size: ownInteger(asset.size, "GitHub release asset.size"),
    state: "uploaded",
    url,
  };
}

function githubRelease(value: unknown, expectedTag: string): GitHubRelease {
  const release = record(value, "GitHub release");
  const id = ownInteger(release.id, "GitHub release.id");
  if (id === 0) fail("GitHub release.id must be positive");
  if (release.tag_name !== expectedTag) fail("GitHub release tag does not match the npm release receipt");
  if (release.draft !== false) fail("GitHub npm artifact mirror must be a public, non-draft release");
  if (!Array.isArray(release.assets)) fail("GitHub release assets must be an array");
  const htmlUrl = ownString(release.html_url, "GitHub release.html_url");
  const parsedUrl = new URL(htmlUrl);
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "github.com") {
    fail("GitHub release has an unexpected HTML origin");
  }
  return {
    id,
    tagName: expectedTag,
    htmlUrl,
    assets: release.assets.map(githubAsset),
  };
}

async function githubRequest(
  url: string,
  token: string,
  options: RequestInit = {},
): Promise<Response> {
  const parsedUrl = new URL(url);
  if (
    parsedUrl.protocol !== "https:" ||
    (parsedUrl.hostname !== "api.github.com" && parsedUrl.hostname !== "uploads.github.com")
  ) {
    fail("refusing an unexpected GitHub API origin");
  }
  const headers = new Headers(options.headers);
  headers.set("authorization", `Bearer ${token}`);
  headers.set("x-github-api-version", "2022-11-28");
  if (!headers.has("accept")) headers.set("accept", "application/vnd.github+json");
  return fetch(url, {
    ...options,
    headers,
    redirect: options.redirect ?? "error",
    signal: AbortSignal.timeout(60_000),
  });
}

async function findGitHubRelease(tag: string, token: string): Promise<GitHubRelease | undefined> {
  const response = await githubRequest(githubApiUrl(`/releases/tags/${encodeURIComponent(tag)}`), token);
  if (response.status === 404) return undefined;
  if (response.status !== 200) fail(`GitHub release lookup returned HTTP ${response.status}`);
  return githubRelease(await response.json(), tag);
}

async function createGitHubRelease(receipt: PreparedReceipt, token: string): Promise<GitHubRelease> {
  const response = await githubRequest(githubApiUrl("/releases"), token, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tag_name: receipt.tag,
      name: `${receipt.package.name}@${receipt.package.version}`,
      body: "Exact reviewed package artifact mirror. Optional npm registry availability is independently verifiable.",
      draft: false,
      prerelease: isPrereleaseVersion(receipt.package.version),
      generate_release_notes: false,
      make_latest: "false",
    }),
  });
  if (response.status !== 201) fail(`GitHub release creation returned HTTP ${response.status}`);
  return githubRelease(await response.json(), receipt.tag);
}

async function uploadGitHubAsset(
  release: GitHubRelease,
  artifactPath: string,
  filename: string,
  token: string,
): Promise<GitHubReleaseAsset> {
  const uploadUrl = `https://uploads.github.com/repos/cambridgetcg/agenttool/releases/${release.id}/assets?name=${encodeURIComponent(filename)}`;
  const response = await githubRequest(uploadUrl, token, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      "content-type": "application/octet-stream",
    },
    body: Bun.file(artifactPath),
  });
  if (response.status !== 201) fail(`GitHub release asset upload returned HTTP ${response.status}`);
  return githubAsset(await response.json());
}

async function verifyGitHubAsset(
  asset: GitHubReleaseAsset,
  expected: ArtifactIdentity,
  token: string,
): Promise<void> {
  if (asset.name !== expected.filename || asset.size !== expected.size) {
    fail("GitHub release asset metadata does not match the prepared artifact");
  }
  const response = await githubRequest(asset.url, token, {
    headers: { accept: "application/octet-stream" },
    redirect: "follow",
  });
  if (!response.ok) fail(`GitHub release asset download returned HTTP ${response.status}`);
  const downloaded = artifactIdentity(
    new Uint8Array(await response.arrayBuffer()),
    expected.filename,
  );
  if (JSON.stringify(downloaded) !== JSON.stringify(expected)) {
    fail("GitHub release asset is not byte-identical to the prepared npm artifact");
  }
}

function ensureWorkflowContext(): void {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_EVENT_NAME !== "workflow_dispatch") {
    fail("npm publication is restricted to the reviewed GitHub Actions workflow_dispatch path");
  }
  if (process.env.GITHUB_REPOSITORY !== "cambridgetcg/agenttool") fail("unexpected GitHub repository");
}

function artifactPathForReceipt(receipt: PreparedReceipt, receiptPath: string): string {
  if (receipt.artifact.filename !== packedFilename(receipt.package.name, receipt.package.version)) {
    fail("prepared artifact filename does not match the receipt package");
  }
  return join(dirname(resolve(receiptPath)), receipt.artifact.filename);
}

async function validateReceiptAgainstCheckout(
  receipt: PreparedReceipt,
  receiptPath: string,
): Promise<{ artifactPath: string; spec: ReleaseSpec }> {
  const spec = releaseSpec(receipt.package.key);
  const { version } = await packageIdentity(spec);
  if (version !== receipt.package.version) fail("package version changed after artifact preparation");
  const tagCommit = await validateTag(spec, version, receipt.tag);
  if (tagCommit !== receipt.tag_commit) fail("release receipt tag commit changed");
  const artifactPath = artifactPathForReceipt(receipt, receiptPath);
  const currentArtifact = await hashArtifact(artifactPath);
  if (JSON.stringify(currentArtifact) !== JSON.stringify(receipt.artifact)) fail("prepared artifact changed after receipt creation");
  await verifyArchive(artifactPath, spec, receipt.package.version);
  await ensureClean();
  return { artifactPath, spec };
}

async function publish(
  receiptPath: string,
  authentication: AuthenticationMode,
  npmTag: string,
): Promise<PreparedReceipt> {
  ensureWorkflowContext();
  if (authentication !== "bootstrap" && authentication !== "trusted") fail("authentication must be bootstrap or trusted");
  await ensurePinnedTools();
  const absoluteReceiptPath = resolve(receiptPath);
  const receipt = await readReleaseReceipt(absoluteReceiptPath);
  validateNpmTagForVersion(receipt.package.version, npmTag);
  const { artifactPath } = await validateReceiptAgainstCheckout(receipt, absoluteReceiptPath);

  const state = await registryState(receipt.package.name, receipt.package.version);
  const decision = registryDecision(state.packageStatus, state.versionStatus, authentication);
  let status: "published" | "already_published_exact";
  let tarball: string;
  if (decision === "verify-existing") {
    if (!state.versionDocument) fail("npm version lookup did not return a document");
    registryTarballUrl(receipt, state.versionDocument);
    tarball = await pollRegistry(receipt, npmTag);
    status = "already_published_exact";
  } else {
    const publishEnvironment = { ...process.env };
    if (authentication === "bootstrap") {
      if (!publishEnvironment.NODE_AUTH_TOKEN) fail("reviewed bootstrap publication requires NODE_AUTH_TOKEN");
    } else {
      delete publishEnvironment.NODE_AUTH_TOKEN;
      if (!publishEnvironment.ACTIONS_ID_TOKEN_REQUEST_URL || !publishEnvironment.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
        fail("trusted publication requires the GitHub OIDC request environment");
      }
    }
    await command(
      "npm",
      [
        "publish",
        artifactPath,
        "--access",
        "public",
        "--tag",
        npmTag,
        "--provenance",
        "--ignore-scripts",
      ],
      { env: publishEnvironment },
    );
    tarball = await pollRegistry(receipt, npmTag);
    status = "published";
  }

  const complete: PreparedReceipt = {
    ...receipt,
    result: {
      status,
      npm_tag: npmTag,
      registry_observed_at: new Date().toISOString(),
      registry_tarball: tarball,
    },
  };
  await writeFile(absoluteReceiptPath, `${JSON.stringify(complete, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify(complete, null, 2));
  return complete;
}

async function mirror(receiptPath: string): Promise<void> {
  ensureWorkflowContext();
  if (Bun.version !== PINNED_BUN) fail(`release requires Bun ${PINNED_BUN}, found ${Bun.version}`);
  const token = ownString(process.env.GH_TOKEN, "GH_TOKEN");
  const absoluteReceiptPath = resolve(receiptPath);
  const receipt = await readReleaseReceipt(absoluteReceiptPath);
  const { artifactPath } = await validateReceiptAgainstCheckout(receipt, absoluteReceiptPath);

  let release = await findGitHubRelease(receipt.tag, token);
  const created = release === undefined;
  if (!release) release = await createGitHubRelease(receipt, token);
  const matchingAssets = release.assets.filter((asset) => asset.name === receipt.artifact.filename);
  if (matchingAssets.length > 1) fail("GitHub release contains duplicate npm artifact mirrors");
  const uploaded = matchingAssets.length === 0;
  const asset = matchingAssets[0] ?? await uploadGitHubAsset(
    release,
    artifactPath,
    receipt.artifact.filename,
    token,
  );
  await verifyGitHubAsset(asset, receipt.artifact, token);
  console.log(JSON.stringify({
    status: uploaded ? "uploaded_exact_asset" : "existing_exact_asset",
    release_created: created,
    tag: receipt.tag,
    package: `${receipt.package.name}@${receipt.package.version}`,
    asset: receipt.artifact,
    release_url: release.htmlUrl,
  }, null, 2));
}

function argumentsMap(args: readonly string[]): { command: string; options: Map<string, string> } {
  const [subcommand, ...rest] = args;
  if (!subcommand) fail("usage: npm-release.ts <resolve|prepare|publish|mirror> [options]");
  const options = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) fail(`invalid option near ${String(flag)}`);
    if (options.has(flag)) fail(`duplicate option: ${flag}`);
    options.set(flag, value);
  }
  return { command: subcommand, options };
}

function required(options: Map<string, string>, name: string): string {
  const value = options.get(name);
  if (!value) fail(`missing ${name}`);
  return value;
}

async function main(args: readonly string[]): Promise<void> {
  const parsed = argumentsMap(args);
  if (parsed.command === "resolve") {
    const spec = releaseSpec(required(parsed.options, "--package"));
    if (parsed.options.size !== 1) fail("resolve accepts only --package");
    const { version } = await packageIdentity(spec);
    console.log(JSON.stringify({ ...spec, version, tag: expectedTag(spec, version) }, null, 2));
    return;
  }
  if (parsed.command === "prepare") {
    if (parsed.options.size !== 3) fail("prepare requires exactly --package, --tag, and --output");
    await prepare(
      required(parsed.options, "--package"),
      required(parsed.options, "--tag"),
      required(parsed.options, "--output"),
    );
    return;
  }
  if (parsed.command === "publish") {
    if (parsed.options.size !== 3) fail("publish requires exactly --receipt, --authentication, and --npm-tag");
    await publish(
      required(parsed.options, "--receipt"),
      required(parsed.options, "--authentication") as AuthenticationMode,
      required(parsed.options, "--npm-tag"),
    );
    return;
  }
  if (parsed.command === "mirror") {
    if (parsed.options.size !== 1) fail("mirror requires exactly --receipt");
    await mirror(required(parsed.options, "--receipt"));
    return;
  }
  fail(`unknown npm release command: ${parsed.command}`);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`npm release failed: ${message}`);
    process.exitCode = 1;
  });
}
