#!/usr/bin/env bun

/**
 * One fail-closed npm release policy for the established AgentTool packages.
 *
 * `prepare` runs without publish credentials. `publish` receives the reviewed
 * bootstrap token or GitHub OIDC environment only after the artifact and its
 * receipt already exist. The split keeps package scripts away from write
 * credentials and makes an accepted-but-not-yet-visible publish recoverable.
 */

import { createHash } from "node:crypto";
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
  telescope: {
    key: "telescope",
    name: "@agenttool/telescope",
    packagePath: "packages/telescope",
    tagPrefix: "telescope",
    artifactKind: "love",
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

interface CommandResult {
  exitCode: number;
  stdout: string;
}

const REPO_ROOT = resolve(import.meta.dir, "..");
const REGISTRY_ORIGIN = "https://registry.npmjs.org";
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SAFE_TAG = /^[a-z0-9][a-z0-9._-]*$/;
const SAFE_NPM_TAG = /^[a-z][a-z0-9._-]*$/;
const TEXT_ARCHIVE_ENTRY = /\.(?:cjs|css|html|js|json|jsx|map|md|mjs|mts|toml|ts|tsx|txt|yaml|yml)$/i;
const SENSITIVE_ARCHIVE_PATH = /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|credentials(?:\.json)?|id_ed25519|id_rsa)$/i;
const SECRET_SIGNATURES = [
  { name: "private-key block", pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/ },
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: "npm token", pattern: /\bnpm_[A-Za-z0-9]{36,}\b/ },
  { name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
] as const;

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

async function installWorkspace(path: string): Promise<void> {
  await command("bun", ["install", "--frozen-lockfile", "--ignore-scripts"], { cwd: join(REPO_ROOT, path) });
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

async function verifyArchive(artifact: string, spec: ReleaseSpec, expectedVersion: string): Promise<void> {
  const compressed = Buffer.from(await Bun.file(artifact).arrayBuffer());
  const inspected = inspectNpmTarball(compressed, { allowSource: spec.name === "@agenttool/collab" });
  const entries = inspected.paths;
  for (const required of ["package/package.json", "package/LICENSE", "package/NOTICE", "package/README.md"]) {
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
    if (!TEXT_ARCHIVE_ENTRY.test(entry) || inspected.sizes[entry] > 2_000_000) continue;
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
  for (const prerequisite of spec.prerequisites ?? []) {
    await installWorkspace(prerequisite.packagePath);
    for (const script of prerequisite.scripts) {
      await command("bun", ["run", script], { cwd: join(REPO_ROOT, prerequisite.packagePath) });
    }
  }
  await installWorkspace(spec.packagePath);
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
  await installWorkspace(spec.packagePath);
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
    if (registryUrl.protocol !== "https:" || registryUrl.hostname !== "registry.npmjs.org") {
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

async function registryFetch(path: string): Promise<Response> {
  return fetch(`${REGISTRY_ORIGIN}${path}`, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
}

async function registryState(name: string, version: string): Promise<{
  packageStatus: number;
  versionStatus: number;
  packageDocument?: RegistryPackage;
  versionDocument?: RegistryVersion;
}> {
  const packagePath = registryPackagePath(name);
  const [packageResponse, versionResponse] = await Promise.all([
    registryFetch(packagePath),
    registryFetch(`${packagePath}/${encodeURIComponent(version)}`),
  ]);
  const packageDocument = packageResponse.status === 200
    ? await packageResponse.json() as RegistryPackage
    : undefined;
  const versionDocument = versionResponse.status === 200
    ? await versionResponse.json() as RegistryVersion
    : undefined;
  return {
    packageStatus: packageResponse.status,
    versionStatus: versionResponse.status,
    ...(packageDocument ? { packageDocument } : {}),
    ...(versionDocument ? { versionDocument } : {}),
  };
}

async function verifyRegistryVersion(receipt: PreparedReceipt, versionDocument: RegistryVersion): Promise<string> {
  if (versionDocument.name !== receipt.package.name || versionDocument.version !== receipt.package.version) {
    fail("npm registry returned a different package identity");
  }
  const dist = versionDocument.dist;
  if (!dist || dist.integrity !== receipt.artifact.integrity || dist.shasum !== receipt.artifact.sha1) {
    fail("npm registry version exists with bytes different from the prepared artifact");
  }
  const tarball = ownString(dist.tarball, "npm registry dist.tarball");
  const url = new URL(tarball);
  if (url.protocol !== "https:" || url.hostname !== "registry.npmjs.org") {
    fail("npm registry returned an unexpected tarball origin");
  }
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(60_000) });
  if (!response.ok) fail(`npm tarball download returned HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
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

async function pollRegistry(receipt: PreparedReceipt, npmTag: string): Promise<string> {
  for (let attempt = 1; attempt <= 90; attempt += 1) {
    const state = await registryState(receipt.package.name, receipt.package.version);
    if (state.versionStatus === 200 && state.versionDocument && state.packageStatus === 200 && state.packageDocument) {
      const tarball = await verifyRegistryVersion(receipt, state.versionDocument);
      if (state.packageDocument["dist-tags"]?.[npmTag] === receipt.package.version) return tarball;
    } else if (![200, 404].includes(state.versionStatus) || ![200, 404].includes(state.packageStatus)) {
      fail(`npm registry returned ambiguous HTTP state ${state.packageStatus}/${state.versionStatus}`);
    }
    if (attempt < 90) await Bun.sleep(5_000);
  }
  fail(`npm accepted ${receipt.package.name}@${receipt.package.version}, but exact bytes and ${npmTag} were not visible within 450 seconds`);
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
      body: "Exact npm publication artifact mirror. Registry identity is recorded by the protected publish-npm workflow.",
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
    await verifyRegistryVersion(receipt, state.versionDocument);
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
  if (!receipt.result) fail("GitHub mirroring requires a completed, registry-verified release receipt");
  const { artifactPath } = await validateReceiptAgainstCheckout(receipt, absoluteReceiptPath);
  const registryTarball = await pollRegistry(receipt, receipt.result.npm_tag);
  if (registryTarball !== receipt.result.registry_tarball) {
    fail("public npm registry tarball URL changed after the verified release receipt");
  }

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
