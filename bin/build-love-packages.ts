#!/usr/bin/env bun

/**
 * Build or verify the static LOVE Package mirror.
 *
 * This operator tool has no publish, upload, dependency-install, credential
 * lookup, or network operation. It runs the release commit's CI/build scripts
 * with a small environment allowlist that omits credential variables. HOME is
 * retained for the installed toolchain, so this is not credential isolation or
 * a network sandbox; build scripts remain separately reviewable release inputs.
 *
 * Usage:
 *   bin/build-love-packages.ts build <staging-directory>
 *   bin/build-love-packages.ts verify <staging-directory>
 */

import { createHash, randomUUID } from "node:crypto";
import {
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

export const LOVE_PACKAGE_PROTOCOL = "love-package/v1" as const;
export const PRIMARY_ORIGIN = "https://docs.agenttool.dev" as const;
export const GITHUB_REPOSITORY = "https://github.com/cambridgetcg/agenttool" as const;
export const DISCOVERY_PATH = "/.well-known/love-packages" as const;
export const INDEX_PATH = "/packages/v1/index.json" as const;
export const MAX_TARBALL_BYTES = 64 * 1024 * 1024;
export const MAX_TAR_EXPANDED_BYTES = 256 * 1024 * 1024;
export const MAX_TAR_MEMBERS = 10_000;
export const MAX_TAR_PATH_BYTES = 1_024;

export interface LovePackageSpec {
  name: `@agenttool/${string}`;
  version: string;
  packagePath: string;
  releaseTag: string;
  buildCommands: readonly (readonly string[])[];
}

interface ReleaseIdentity {
  name: `@agenttool/${string}`;
  version: string;
}

const STRICT_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const TOOL_ROOT = resolve(import.meta.dir, "..");

export const LOVE_PACKAGES: readonly LovePackageSpec[] = [
  {
    name: "@agenttool/adds",
    version: "0.2.1",
    packagePath: "packages/data-protocol",
    releaseTag: "adds-v0.2.1",
    buildCommands: [["bun", "run", "ci"]],
  },
  {
    name: "@agenttool/data",
    version: "0.3.1",
    packagePath: "packages/data",
    releaseTag: "data-v0.3.1",
    buildCommands: [
      ["bun", "run", "ci"],
      ["bun", "run", "build"],
    ],
  },
  {
    name: "@agenttool/data-sync",
    version: "0.1.1",
    packagePath: "packages/data-sync",
    releaseTag: "data-sync-v0.1.1",
    buildCommands: [["bun", "run", "ci"], ["bun", "run", "build"]],
  },
  {
    name: "@agenttool/credential-broker",
    version: "0.1.0",
    packagePath: "packages/credential-broker",
    releaseTag: "credential-broker-v0.1.0",
    buildCommands: [["bun", "run", "ci"]],
  },
  {
    name: "@agenttool/sdk",
    version: "0.16.0",
    packagePath: "packages/sdk-ts",
    releaseTag: "sdk-v0.16.0",
    buildCommands: [["bun", "run", "ci"]],
  },
  {
    name: "@agenttool/wallet",
    version: "0.1.0",
    packagePath: "packages/wallet",
    releaseTag: "wallet-v0.1.0",
    buildCommands: [["bun", "run", "ci"]],
  },
  {
    name: "@agenttool/telescope",
    version: "0.2.0",
    packagePath: "packages/telescope",
    releaseTag: "telescope-v0.2.0",
    buildCommands: [["bun", "run", "ci"]],
  },
  {
    name: "@agenttool/browser",
    version: "0.1.0",
    packagePath: "packages/browser",
    releaseTag: "browser-v0.1.0",
    buildCommands: [["bun", "run", "ci"]],
  },
] as const;

export interface PackageJson {
  name?: unknown;
  version?: unknown;
  description?: unknown;
  license?: unknown;
  engines?: unknown;
  dependencies?: unknown;
  optionalDependencies?: unknown;
  peerDependencies?: unknown;
  bundledDependencies?: unknown;
  bundleDependencies?: unknown;
  repository?: unknown;
  main?: unknown;
  module?: unknown;
  types?: unknown;
  typings?: unknown;
  bin?: unknown;
  exports?: unknown;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RegistryOptions {
  repoRoot: string;
  outputRoot: string;
  packages?: readonly LovePackageSpec[];
  primaryOrigin?: string;
  githubRepository?: string;
}

interface ArtifactRecord {
  filename: string;
  sha256: string;
  size: number;
}

type JsonSchemaValidator = ((value: unknown) => boolean) & { errors?: unknown };
const schemaValidators = new Map<string, Promise<JsonSchemaValidator>>();

async function schemaValidator(filename: string): Promise<JsonSchemaValidator> {
  const existing = schemaValidators.get(filename);
  if (existing) return existing;
  const loading = (async () => {
    const ajvPath = join(TOOL_ROOT, "api", "node_modules", "ajv", "dist", "2020.js");
    const formatsPath = join(TOOL_ROOT, "api", "node_modules", "ajv-formats", "dist", "index.js");
    if (!await pathExists(ajvPath) || !await pathExists(formatsPath)) {
      throw new Error("LOVE Package schema validation requires the API's locked dependencies; run bun install in api/");
    }
    const [{ default: Ajv2020 }, { default: addFormats }] = await Promise.all([
      import(pathToFileURL(ajvPath).href),
      import(pathToFileURL(formatsPath).href),
    ]);
    const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
    addFormats(ajv);
    const schema = await readJson(join(TOOL_ROOT, "docs", "specs", filename));
    return ajv.compile(schema) as JsonSchemaValidator;
  })();
  schemaValidators.set(filename, loading);
  return loading;
}

async function assertSchema(value: unknown, filename: string, label: string): Promise<void> {
  const validate = await schemaValidator(filename);
  if (!validate(value)) throw new Error(`${label} fails ${filename}: ${JSON.stringify(validate.errors)}`);
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function expectObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function sortedStringMap(value: unknown, label: string): Record<string, string> {
  if (value === undefined) return {};
  const object = expectObject(value, label);
  const entries = Object.entries(object).sort(([a], [b]) => a.localeCompare(b));
  const result: Record<string, string> = {};
  for (const [key, item] of entries) {
    if (typeof item !== "string") throw new Error(`${label}.${key} must be a string`);
    result[key] = item;
  }
  return result;
}

function normalizeOrigin(origin: string): string {
  return origin.replace(/\/$/, "");
}

function validateHttpsUrl(value: string, label: string, originOnly = false): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must be a credential-free HTTPS URL without query or fragment`);
  }
  if (originOnly && url.href.replace(/\/$/, "") !== url.origin) {
    throw new Error(`${label} must contain only an HTTPS origin`);
  }
}

function validateSpecs(specs: readonly LovePackageSpec[]): void {
  if (specs.length === 0) throw new Error("at least one LOVE Package release is required");
  const tags = new Set<string>();
  const safePath = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
  const releases = new Set<string>();
  for (const spec of specs) {
    packageSlug(spec);
    if (!STRICT_SEMVER.test(spec.version)) throw new Error(`${spec.name} version is not valid SemVer: ${spec.version}`);
    if (!safePath.test(spec.packagePath) || isAbsolute(spec.packagePath) || spec.packagePath.includes("..")) {
      throw new Error(`${spec.name} packagePath must be a safe repository-relative path`);
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(spec.releaseTag)) {
      throw new Error(`${spec.name} releaseTag must be one URL-safe path segment`);
    }
    if (spec.releaseTag !== `${packageSlug(spec)}-v${spec.version}`) {
      throw new Error(`${spec.name}@${spec.version} releaseTag must follow <package>-v<version>`);
    }
    const release = `${spec.name}\0${spec.version}`;
    if (releases.has(release)) throw new Error(`duplicate LOVE Package release: ${spec.name}@${spec.version}`);
    if (tags.has(spec.releaseTag)) throw new Error(`duplicate LOVE Package release tag: ${spec.releaseTag}`);
    releases.add(release);
    tags.add(spec.releaseTag);
  }
}

function packageSlug(spec: ReleaseIdentity): string {
  const match = /^@agenttool\/([a-z0-9][a-z0-9-]*)$/.exec(spec.name);
  if (!match) throw new Error(`unsupported package name: ${spec.name}`);
  return match[1];
}

function artifactFilename(spec: ReleaseIdentity): string {
  return `agenttool-${packageSlug(spec)}-${spec.version}.tgz`;
}

function versionRootPath(spec: ReleaseIdentity): string {
  return `/packages/v1/@agenttool/${packageSlug(spec)}/${spec.version}`;
}

function manifestPath(spec: ReleaseIdentity): string {
  return `${versionRootPath(spec)}/manifest.json`;
}

function artifactPath(spec: ReleaseIdentity): string {
  return `${versionRootPath(spec)}/${artifactFilename(spec)}`;
}

function repositoryUrl(packageJson: PackageJson): string {
  const value = typeof packageJson.repository === "string"
    ? packageJson.repository
    : expectObject(packageJson.repository, "package.json repository").url;
  if (typeof value !== "string") {
    throw new Error("package.json repository.url must be a string");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("package.json repository must be an absolute URL");
  }
  if (
    !new Set(["https:", "git+https:"]).has(parsed.protocol)
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("package.json repository must be a credential-free HTTPS repository URL");
  }
  return value;
}

function description(packageJson: PackageJson): string {
  if (typeof packageJson.description !== "string" || packageJson.description.length === 0) {
    throw new Error("package.json description must be a non-empty string");
  }
  return packageJson.description;
}

function license(packageJson: PackageJson): string | null {
  if (packageJson.license === undefined) return null;
  if (typeof packageJson.license !== "string" || packageJson.license.length === 0) {
    throw new Error("package.json license must be a non-empty string when present");
  }
  return packageJson.license;
}

function hasPackageDependencies(packageJson: PackageJson): boolean {
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"] as const) {
    const value = packageJson[field];
    if (value !== undefined && Object.keys(expectObject(value, `package.json ${field}`)).length > 0) return true;
  }
  for (const field of ["bundledDependencies", "bundleDependencies"] as const) {
    const value = packageJson[field];
    if (value === undefined || value === false) continue;
    if (value === true) return true;
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw new Error(`package.json ${field} must be a boolean or string array`);
    }
    if (value.length > 0) return true;
  }
  return false;
}

async function runCommand(
  command: readonly string[],
  options: { cwd: string; allowFailure?: boolean; offlineNpm?: boolean },
): Promise<CommandResult> {
  const env: Record<string, string> = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "LC_CTYPE", "TERM"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key]!;
  }
  env.CI = "1";
  env.NO_COLOR = "1";
  if (options.offlineNpm) env.NPM_CONFIG_OFFLINE = "true";
  const child = Bun.spawn([...command], {
    cwd: options.cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0 && !options.allowFailure) {
    const detail = stderr.trim() || stdout.trim() || `exit ${exitCode}`;
    throw new Error(`${command[0]} failed: ${detail}`);
  }
  return { stdout, stderr, exitCode };
}

async function git(repoRoot: string, args: readonly string[], allowFailure = false): Promise<CommandResult> {
  return runCommand(["git", ...args], { cwd: repoRoot, allowFailure });
}

async function currentRevision(repoRoot: string): Promise<string> {
  const result = await git(repoRoot, ["rev-parse", "HEAD"]);
  const revision = result.stdout.trim();
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("git HEAD is not a full SHA-1 revision");
  return revision;
}

async function assertCleanTrackedWorktree(repoRoot: string): Promise<void> {
  const result = await git(repoRoot, ["status", "--porcelain=v1", "--untracked-files=no"]);
  if (result.stdout.trim()) {
    throw new Error(`tracked worktree is dirty:\n${result.stdout.trimEnd()}`);
  }
}

async function assertCleanReleaseSources(
  repoRoot: string,
  specs: readonly LovePackageSpec[],
): Promise<void> {
  await assertCleanTrackedWorktree(repoRoot);
  const result = await git(repoRoot, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    ...specs.map((spec) => spec.packagePath),
  ]);
  if (result.stdout.trim()) {
    throw new Error(`package source contains untracked or dirty files:\n${result.stdout.trimEnd()}`);
  }
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`cannot read JSON ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function readPackageJson(packageRoot: string): Promise<PackageJson> {
  return expectObject(await readJson(join(packageRoot, "package.json")), "package.json") as PackageJson;
}

function assertPackageIdentity(packageJson: PackageJson, spec: LovePackageSpec): void {
  if (packageJson.name !== spec.name) {
    throw new Error(`${spec.packagePath}/package.json name is ${String(packageJson.name)}, expected ${spec.name}`);
  }
  if (packageJson.version !== spec.version) {
    throw new Error(
      `${spec.name} version is ${String(packageJson.version)}, expected release version ${spec.version}`,
    );
  }
}

async function runBuild(packageRoot: string, spec: LovePackageSpec): Promise<void> {
  if (spec.buildCommands.length === 0) throw new Error(`${spec.name} has no build command`);
  await rm(join(packageRoot, "dist"), { recursive: true, force: true });
  for (const command of spec.buildCommands) {
    if (command.length === 0) throw new Error(`${spec.name} has an empty build command`);
    const [program, ...args] = command;
    const resolvedProgram = program.includes("/") && !isAbsolute(program) ? join(packageRoot, program) : program;
    if (program.includes("/")) {
      try {
        await stat(resolvedProgram);
      } catch {
        throw new Error(
          `${spec.name} build tool is missing: ${resolvedProgram}. Install its locked dependencies first.`,
        );
      }
    }
    await runCommand([resolvedProgram, ...args], { cwd: packageRoot });
  }
}

async function packPackage(packageRoot: string, spec: LovePackageSpec): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const packRoot = await mkdtemp(join(tmpdir(), "love-package-pack-"));
  try {
    const expected = artifactFilename(spec);
    await runCommand(
      [
        "bun",
        "pm",
        "pack",
        "--destination",
        packRoot,
        "--gzip-level",
        "9",
        "--ignore-scripts",
        "--quiet",
      ],
      { cwd: packageRoot },
    );
    const entries = (await readdir(packRoot)).filter((entry) => entry.endsWith(".tgz"));
    if (entries.length !== 1 || entries[0] !== expected) {
      throw new Error(`${spec.name} packed ${entries.join(", ") || "no tarball"}, expected ${expected}`);
    }
    return {
      path: join(packRoot, expected),
      cleanup: () => rm(packRoot, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(packRoot, { recursive: true, force: true });
    throw error;
  }
}

function tarString(bytes: Buffer, offset: number, length: number): string {
  const field = bytes.subarray(offset, offset + length);
  const zero = field.indexOf(0);
  return field.subarray(0, zero === -1 ? field.length : zero).toString("utf8");
}

function tarOctal(bytes: Buffer, offset: number, length: number): number {
  const value = tarString(bytes, offset, length).trim();
  if (!/^[0-7]+$/.test(value)) throw new Error(`invalid tar size field: ${JSON.stringify(value)}`);
  return Number.parseInt(value, 8);
}

function assertTarChecksum(header: Buffer, path: string): void {
  const expected = tarOctal(header, 148, 8);
  let actual = 0;
  for (let index = 0; index < header.length; index++) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  if (actual !== expected) throw new Error(`artifact has an invalid tar checksum at ${path}`);
}

function localEntrypoint(value: string, label: string): string {
  if (value.includes("*") || value.includes("\\") || value.startsWith("/") || value.includes("\0")) {
    throw new Error(`${label} is not an inspectable local entrypoint: ${value}`);
  }
  const normalized = value.startsWith("./") ? value.slice(2) : value;
  if (normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`${label} has an unsafe entrypoint path: ${value}`);
  }
  return `package/${normalized}`;
}

function declaredEntrypoints(packageJson: PackageJson): string[] {
  const result = new Set<string>();
  const add = (value: unknown, label: string): void => {
    if (value === null) return;
    if (typeof value === "string") {
      result.add(localEntrypoint(value, label));
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => add(item, `${label}[${index}]`));
    } else if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) add(item, `${label}.${key}`);
    } else {
      throw new Error(`${label} must contain only local string entrypoints`);
    }
  };
  for (const field of ["main", "module", "types", "typings"] as const) {
    if (packageJson[field] !== undefined) add(packageJson[field], `package.json ${field}`);
  }
  if (packageJson.bin !== undefined) add(packageJson.bin, "package.json bin");
  if (packageJson.exports !== undefined) add(packageJson.exports, "package.json exports");
  if (packageJson.main === undefined && packageJson.exports === undefined) result.add("package/index.js");
  return [...result];
}

export interface NpmTarballContents {
  packageJson: PackageJson;
  paths: string[];
  sizes: Record<string, number>;
  legalFiles: {
    license?: Buffer;
    notice?: Buffer;
  };
}

export interface InspectNpmTarballOptions {
  /** npm-only plugin packages may intentionally ship auditable TypeScript source. */
  allowSource?: boolean;
}

export function inspectNpmTarball(
  compressed: Buffer,
  options: InspectNpmTarballOptions = {},
): NpmTarballContents {
  if (compressed.byteLength === 0 || compressed.byteLength > MAX_TARBALL_BYTES) {
    throw new Error(`artifact exceeds the ${MAX_TARBALL_BYTES}-byte compressed-size limit`);
  }
  let archive: Buffer;
  try {
    archive = gunzipSync(compressed, { maxOutputLength: MAX_TAR_EXPANDED_BYTES });
  } catch {
    throw new Error("artifact is not a valid bounded gzip stream");
  }
  const paths: string[] = [];
  const sizes: Record<string, number> = {};
  const seenPaths = new Set<string>();
  const portablePaths = new Set<string>();
  const entryTypes = new Map<string, "file" | "directory">();
  const legalFiles: NpmTarballContents["legalFiles"] = {};
  let packedPackageJson: PackageJson | undefined;
  let reachedEnd = false;
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      if (!archive.subarray(offset).every((byte) => byte === 0)) {
        throw new Error("artifact has non-zero data after its tar terminator");
      }
      reachedEnd = true;
      break;
    }
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    assertTarChecksum(header, path);
    if (/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069\ufffd]/u.test(path)) {
      throw new Error(`artifact contains a control, bidi, or invalid UTF-8 path: ${JSON.stringify(path)}`);
    }
    if (path !== "package" && !path.startsWith("package/")) {
      throw new Error(`artifact contains a non-npm path: ${path}`);
    }
    if (path.includes("\\") || path.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
      throw new Error(`artifact contains an ambiguous path: ${path}`);
    }
    if (seenPaths.has(path)) throw new Error(`artifact contains a duplicate path: ${path}`);
    seenPaths.add(path);
    const portablePath = path.normalize("NFC").toLocaleLowerCase("en-US");
    if (portablePaths.has(portablePath)) throw new Error(`artifact contains an ambiguous path collision: ${path}`);
    portablePaths.add(portablePath);
    if (Buffer.byteLength(path, "utf8") > MAX_TAR_PATH_BYTES) {
      throw new Error(`artifact path exceeds the ${MAX_TAR_PATH_BYTES}-byte limit: ${path}`);
    }
    paths.push(path);
    if (paths.length > MAX_TAR_MEMBERS) throw new Error(`artifact exceeds the ${MAX_TAR_MEMBERS}-member limit`);
    const size = tarOctal(header, 124, 12);
    sizes[path] = size;
    const mode = tarOctal(header, 100, 8);
    const type = tarString(header, 156, 1);
    if (type !== "" && type !== "0" && type !== "5") {
      throw new Error(`artifact contains unsafe tar entry type ${JSON.stringify(type)} at ${path}`);
    }
    if ((mode & ~0o777) !== 0 || (mode & 0o7022) !== 0) {
      throw new Error(`artifact contains unsafe mode ${mode.toString(8)} at ${path}`);
    }
    if (type === "5" && size !== 0) throw new Error(`artifact directory has non-zero size: ${path}`);
    entryTypes.set(path, type === "5" ? "directory" : "file");
    const bodyOffset = offset + 512;
    if (bodyOffset + size > archive.length) throw new Error(`truncated tar entry: ${path}`);
    if ((type === "" || type === "0") && path === "package/package.json") {
      let body: string;
      try {
        body = new TextDecoder("utf-8", { fatal: true }).decode(archive.subarray(bodyOffset, bodyOffset + size));
      } catch {
        throw new Error("packed package.json is not valid UTF-8");
      }
      packedPackageJson = expectObject(JSON.parse(body), "packed package.json") as PackageJson;
    }
    if ((type === "" || type === "0") && path === "package/LICENSE") {
      legalFiles.license = Buffer.from(archive.subarray(bodyOffset, bodyOffset + size));
    }
    if ((type === "" || type === "0") && path === "package/NOTICE") {
      legalFiles.notice = Buffer.from(archive.subarray(bodyOffset, bodyOffset + size));
    }
    offset = bodyOffset + Math.ceil(size / 512) * 512;
  }
  if (!reachedEnd) throw new Error("artifact tar stream has no zero-block terminator");
  if (!packedPackageJson) {
    throw new Error("artifact is not an npm tarball: package/package.json is missing");
  }
  if (!paths.some((path) => path.startsWith("package/dist/"))) {
    throw new Error("artifact is not release-ready: package/dist is missing");
  }
  const forbiddenRoots = options.allowSource
    ? ["package/node_modules"]
    : ["package/src", "package/node_modules"];
  for (const forbidden of forbiddenRoots) {
    if (paths.some((path) => path === forbidden || path.startsWith(`${forbidden}/`))) {
      throw new Error(`artifact contains forbidden source content: ${forbidden}`);
    }
  }
  for (const [path, type] of entryTypes) {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index++) {
      const ancestor = segments.slice(0, index).join("/");
      if (entryTypes.get(ancestor) === "file") {
        throw new Error(`artifact path descends through regular file ${ancestor}: ${path}`);
      }
    }
    if (path === "package" && type !== "directory") {
      throw new Error("artifact root package entry must be a directory");
    }
  }
  for (const entrypoint of declaredEntrypoints(packedPackageJson)) {
    if (entryTypes.get(entrypoint) !== "file") {
      throw new Error(`artifact is missing declared entrypoint: ${entrypoint}`);
    }
  }
  return { packageJson: packedPackageJson, paths, sizes, legalFiles };
}

function artifactRecordFromBytes(bytes: Buffer, filename: string, spec: LovePackageSpec): ArtifactRecord {
  const packedPackage = inspectNpmTarball(bytes).packageJson;
  assertPackageIdentity(packedPackage, spec);
  return {
    filename,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.byteLength,
  };
}

async function artifactRecord(path: string, spec: LovePackageSpec): Promise<ArtifactRecord> {
  return artifactRecordFromBytes(await readFile(path), basename(path), spec);
}

function discoveryDocument(primaryOrigin: string): unknown {
  return {
    protocol: LOVE_PACKAGE_PROTOCOL,
    doctrine: `${primaryOrigin}/LOVE-PACKAGE-PROTOCOL.md`,
    index_url: `${primaryOrigin}${INDEX_PATH}`,
    access: "public_read",
    registry_role: "mirror_index_not_authority",
    registry_mirrors: [
      {
        ecosystem: "npm",
        registry_url: "https://registry.npmjs.org/",
        authority: false,
      },
    ],
  };
}

function compareSemver(left: string, right: string): number {
  const parse = (value: string): { core: bigint[]; prerelease: string[] | null } => {
    if (!STRICT_SEMVER.test(value)) throw new Error(`invalid SemVer in catalog: ${value}`);
    const withoutBuild = value.split("+", 1)[0];
    const dash = withoutBuild.indexOf("-");
    const core = (dash === -1 ? withoutBuild : withoutBuild.slice(0, dash))
      .split(".")
      .map((part) => BigInt(part));
    const prerelease = dash === -1 ? null : withoutBuild.slice(dash + 1).split(".");
    return { core, prerelease };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index++) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1;
  }
  if (a.prerelease === null || b.prerelease === null) {
    if (a.prerelease === b.prerelease) return 0;
    return a.prerelease === null ? 1 : -1;
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index++) {
    const ai = a.prerelease[index];
    const bi = b.prerelease[index];
    if (ai === undefined || bi === undefined) return ai === undefined ? -1 : 1;
    if (ai === bi) continue;
    const an = /^\d+$/.test(ai);
    const bn = /^\d+$/.test(bi);
    if (an && bn) return BigInt(ai) < BigInt(bi) ? -1 : 1;
    if (an !== bn) return an ? -1 : 1;
    return ai < bi ? -1 : 1;
  }
  return 0;
}

function indexDocument(releases: readonly ReleaseIdentity[], primaryOrigin: string): unknown {
  const grouped = new Map<string, ReleaseIdentity[]>();
  for (const release of releases) {
    const group = grouped.get(release.name) ?? [];
    if (group.some(({ version }) => version === release.version)) {
      throw new Error(`duplicate catalog release: ${release.name}@${release.version}`);
    }
    group.push(release);
    grouped.set(release.name, group);
  }
  return {
    protocol: LOVE_PACKAGE_PROTOCOL,
    document_type: "package-index",
    packages: [...grouped.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, group]) => {
        const versions = group.sort((a, b) => compareSemver(a.version, b.version));
        return {
          name,
          latest: versions.at(-1)!.version,
          versions: versions.map((release) => ({
            version: release.version,
            manifest_url: `${primaryOrigin}${manifestPath(release)}`,
          })),
        };
      }),
  };
}

function releasesFromIndex(indexText: string, primaryOrigin: string): ReleaseIdentity[] {
  const index = expectObject(JSON.parse(indexText), "package index");
  if (index.protocol !== LOVE_PACKAGE_PROTOCOL || index.document_type !== "package-index") {
    throw new Error("package index has the wrong protocol or document_type");
  }
  if (!Array.isArray(index.packages) || index.packages.length === 0) {
    throw new Error("package index packages must be a non-empty array");
  }
  const releases: ReleaseIdentity[] = [];
  for (const value of index.packages) {
    const entry = expectObject(value, "package index entry");
    if (typeof entry.name !== "string" || !entry.name.startsWith("@agenttool/")) {
      throw new Error("package index entry name must be an @agenttool package");
    }
    if (!Array.isArray(entry.versions) || entry.versions.length === 0) {
      throw new Error(`${entry.name} index versions must be a non-empty array`);
    }
    for (const versionValue of entry.versions) {
      const versionEntry = expectObject(versionValue, `${entry.name} version entry`);
      if (typeof versionEntry.version !== "string" || !STRICT_SEMVER.test(versionEntry.version)) {
        throw new Error(`${entry.name} index version must be valid SemVer`);
      }
      const release = {
        name: entry.name as `@agenttool/${string}`,
        version: versionEntry.version,
      };
      packageSlug(release);
      const expectedUrl = `${primaryOrigin}${manifestPath(release)}`;
      if (versionEntry.manifest_url !== expectedUrl) {
        throw new Error(`${entry.name}@${release.version} manifest_url must be ${expectedUrl}`);
      }
      releases.push(release);
    }
  }
  assertCanonicalDocument(indexText, indexDocument(releases, primaryOrigin), "package index");
  return releases;
}

function manifestDocument(options: {
  spec: LovePackageSpec;
  packageJson: PackageJson;
  revision: string;
  artifact: ArtifactRecord;
  primaryOrigin: string;
  githubRepository: string;
}): unknown {
  const { spec, packageJson, revision, artifact, primaryOrigin, githubRepository } = options;
  const primaryUrl = `${primaryOrigin}${artifactPath(spec)}`;
  return {
    protocol: LOVE_PACKAGE_PROTOCOL,
    document_type: "package-manifest",
    name: spec.name,
    version: spec.version,
    description: description(packageJson),
    license: license(packageJson),
    artifact: {
      format: "npm-tarball",
      filename: artifact.filename,
      sha256: artifact.sha256,
      size: artifact.size,
      media_type: "application/gzip",
      mirrors: [
        { url: primaryUrl },
        { url: `${githubRepository}/releases/download/${spec.releaseTag}/${artifact.filename}` },
      ],
    },
    runtime: {
      kind: "javascript",
      engines: sortedStringMap(packageJson.engines, "package.json engines"),
    },
    install: {
      format: "npm-tarball",
      specifier: primaryUrl,
    },
    source: {
      repository: repositoryUrl(packageJson),
      revision,
      path: spec.packagePath,
    },
    dependency_resolution: {
      mode: "package_manifest",
      self_contained: !hasPackageDependencies(packageJson),
    },
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, canonicalJson(value), { mode: 0o644 });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function installBuiltTree(buildRoot: string, outputRoot: string): Promise<void> {
  const targetPackages = join(outputRoot, "packages", "v1");
  const sourcePackages = join(buildRoot, "packages", "v1");
  const backupPackages = join(outputRoot, "packages", `.love-package-v1-backup-${randomUUID()}`);
  await mkdir(dirname(targetPackages), { recursive: true });
  const hadPackages = await pathExists(targetPackages);
  if (hadPackages) await rename(targetPackages, backupPackages);
  try {
    await rename(sourcePackages, targetPackages);
  } catch (error) {
    if (hadPackages) await rename(backupPackages, targetPackages);
    throw error;
  }
  if (hadPackages) await rm(backupPackages, { recursive: true, force: true });

  const targetDiscovery = join(outputRoot, ".well-known", "love-packages");
  const incomingDiscovery = `${targetDiscovery}.incoming-${randomUUID()}`;
  await mkdir(dirname(targetDiscovery), { recursive: true });
  await copyFile(join(buildRoot, ".well-known", "love-packages"), incomingDiscovery);
  await rename(incomingDiscovery, targetDiscovery);
}

export async function buildLovePackages(options: RegistryOptions): Promise<void> {
  const repoRoot = resolve(options.repoRoot);
  const outputRoot = resolve(options.outputRoot);
  const specs = options.packages ?? LOVE_PACKAGES;
  const primaryOrigin = normalizeOrigin(options.primaryOrigin ?? PRIMARY_ORIGIN);
  const githubRepository = normalizeOrigin(options.githubRepository ?? GITHUB_REPOSITORY);

  validateSpecs(specs);
  validateHttpsUrl(primaryOrigin, "primaryOrigin", true);
  validateHttpsUrl(githubRepository, "githubRepository");
  await assertCleanReleaseSources(repoRoot, specs);
  const revision = await currentRevision(repoRoot);
  await mkdir(outputRoot, { recursive: true });
  const existingIndex = join(outputRoot, INDEX_PATH.slice(1));
  const existingPackages = join(outputRoot, "packages", "v1");
  let existingReleases: ReleaseIdentity[] = [];
  if (await pathExists(existingIndex)) {
    existingReleases = await verifyRegistryTree({
      repoRoot,
      outputRoot,
      primaryOrigin,
      githubRepository,
    });
  } else if (await pathExists(existingPackages)) {
    throw new Error("existing packages/v1 tree has no verifiable index.json; refusing to replace it");
  }
  const buildRoot = await mkdtemp(join(outputRoot, ".love-package-build-"));
  try {
    await writeJson(join(buildRoot, ".well-known", "love-packages"), discoveryDocument(primaryOrigin));
    if (existingReleases.length > 0) {
      await mkdir(join(buildRoot, "packages"), { recursive: true });
      await cp(existingPackages, join(buildRoot, "packages", "v1"), { recursive: true });
    }

    const existingReleaseKeys = new Set(
      existingReleases.map((release) => `${release.name}\0${release.version}`),
    );
    for (const spec of specs) {
      // verifyRegistryTree already checked these bytes against their immutable
      // source revision. Rebuilding from the current HEAD would rewrite their
      // provenance instead of preserving the indexed release.
      if (existingReleaseKeys.has(`${spec.name}\0${spec.version}`)) continue;
      const packageRoot = join(repoRoot, spec.packagePath);
      const packageJson = await readPackageJson(packageRoot);
      assertPackageIdentity(packageJson, spec);
      await runBuild(packageRoot, spec);
      await assertCleanReleaseSources(repoRoot, specs);
      const packed = await packPackage(packageRoot, spec);
      try {
        await assertCleanReleaseSources(repoRoot, specs);
        const artifact = await artifactRecord(packed.path, spec);
        const versionRoot = join(buildRoot, versionRootPath(spec).slice(1));
        const manifestValue = manifestDocument({
          spec,
          packageJson,
          revision,
          artifact,
          primaryOrigin,
          githubRepository,
        });
        await assertSchema(manifestValue, "love-package-v1.schema.json", `${spec.name} manifest`);
        const manifest = canonicalJson(manifestValue);
        if (await pathExists(versionRoot)) {
          const [existingArtifact, newArtifact, existingManifest] = await Promise.all([
            readFile(join(versionRoot, artifact.filename)),
            readFile(packed.path),
            readFile(join(versionRoot, "manifest.json"), "utf8"),
          ]);
          if (!existingArtifact.equals(newArtifact) || existingManifest !== manifest) {
            throw new Error(`immutable release conflict: ${spec.name}@${spec.version} already exists`);
          }
        } else {
          await mkdir(versionRoot, { recursive: true });
          await copyFile(packed.path, join(versionRoot, artifact.filename));
          await writeFile(join(versionRoot, "manifest.json"), manifest, { mode: 0o644 });
        }
      } finally {
        await packed.cleanup();
      }
    }
    const releaseMap = new Map<string, ReleaseIdentity>();
    for (const release of [...existingReleases, ...specs]) {
      releaseMap.set(`${release.name}\0${release.version}`, { name: release.name, version: release.version });
    }
    const index = indexDocument([...releaseMap.values()], primaryOrigin);
    await assertSchema(index, "love-package-index-v1.schema.json", "package index");
    await writeJson(join(buildRoot, "packages", "v1", "index.json"), index);
    await assertCleanReleaseSources(repoRoot, specs);
    await installBuiltTree(buildRoot, outputRoot);
  } finally {
    await rm(buildRoot, { recursive: true, force: true });
  }
}

function assertCanonicalDocument(actualText: string, expected: unknown, label: string): void {
  const canonical = canonicalJson(expected);
  if (actualText !== canonical) throw new Error(`${label} is not the expected canonical JSON`);
}

async function packageJsonAtRevision(
  repoRoot: string,
  revision: string,
  packagePath: string,
): Promise<PackageJson> {
  const result = await git(repoRoot, ["show", `${revision}:${packagePath}/package.json`]);
  return expectObject(JSON.parse(result.stdout), "source package.json") as PackageJson;
}

async function assertExactRegistryLayout(
  registryRoot: string,
  releases: readonly ReleaseIdentity[],
): Promise<void> {
  const actualFiles = new Set<string>();
  const actualDirectories = new Set<string>();
  const walk = async (directory: string, prefix = ""): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        actualDirectories.add(relativePath);
        await walk(join(directory, entry.name), relativePath);
      } else if (entry.isFile()) {
        actualFiles.add(relativePath);
      } else {
        throw new Error(`unexpected registry path type: ${relativePath}`);
      }
    }
  };
  await walk(registryRoot);

  const expectedFiles = new Set<string>(["index.json"]);
  const expectedDirectories = new Set<string>(["@agenttool"]);
  for (const release of releases) {
    const packageRoot = `@agenttool/${packageSlug(release)}`;
    const versionRoot = `${packageRoot}/${release.version}`;
    expectedDirectories.add(packageRoot);
    expectedDirectories.add(versionRoot);
    expectedFiles.add(`${versionRoot}/manifest.json`);
    expectedFiles.add(`${versionRoot}/${artifactFilename(release)}`);
  }
  const unexpected = [
    ...[...actualFiles].filter((path) => !expectedFiles.has(path)),
    ...[...actualDirectories].filter((path) => !expectedDirectories.has(path)),
  ].sort();
  const missing = [
    ...[...expectedFiles].filter((path) => !actualFiles.has(path)),
    ...[...expectedDirectories].filter((path) => !actualDirectories.has(path)),
  ].sort();
  if (unexpected.length || missing.length) {
    const details = [
      unexpected.length ? `unexpected: ${unexpected.join(", ")}` : "",
      missing.length ? `missing: ${missing.join(", ")}` : "",
    ].filter(Boolean).join("; ");
    throw new Error(`registry tree does not exactly match its index (${details})`);
  }
}

async function verifyRegistryTree(options: {
  repoRoot: string;
  outputRoot: string;
  primaryOrigin: string;
  githubRepository: string;
}): Promise<ReleaseIdentity[]> {
  const { repoRoot, outputRoot, primaryOrigin, githubRepository } = options;
  const discovery = await readFile(join(outputRoot, DISCOVERY_PATH.slice(1)), "utf8");
  assertCanonicalDocument(discovery, discoveryDocument(primaryOrigin), DISCOVERY_PATH);
  const index = await readFile(join(outputRoot, INDEX_PATH.slice(1)), "utf8");
  await assertSchema(JSON.parse(index), "love-package-index-v1.schema.json", "package index");
  const releases = releasesFromIndex(index, primaryOrigin);
  await assertExactRegistryLayout(join(outputRoot, "packages", "v1"), releases);

  for (const release of releases) {
    const versionRoot = join(outputRoot, versionRootPath(release).slice(1));
    const manifestFile = join(versionRoot, "manifest.json");
    const manifestText = await readFile(manifestFile, "utf8");
    const manifest = expectObject(JSON.parse(manifestText), `${release.name} manifest`);
    await assertSchema(manifest, "love-package-v1.schema.json", `${release.name} manifest`);
    if (manifest.name !== release.name || manifest.version !== release.version) {
      throw new Error(`${release.name}@${release.version} manifest identity does not match its index entry`);
    }
    const source = expectObject(manifest.source, `${release.name} manifest source`);
    if (typeof source.revision !== "string" || !/^[a-f0-9]{40}$/.test(source.revision)) {
      throw new Error(`${release.name} source.revision must be a full git revision`);
    }
    if (typeof source.path !== "string") throw new Error(`${release.name} source.path must be a string`);
    const spec: LovePackageSpec = {
      ...release,
      packagePath: source.path,
      releaseTag: `${packageSlug(release)}-v${release.version}`,
      buildCommands: [],
    };
    validateSpecs([spec]);
    const declaredArtifact = expectObject(manifest.artifact, `${release.name} manifest artifact`);
    const expectedFilename = artifactFilename(spec);
    if (declaredArtifact.filename !== expectedFilename) {
      throw new Error(`${release.name}@${release.version} artifact filename does not match its release path`);
    }
    const artifactFile = join(versionRoot, expectedFilename);
    const artifactBytes = await readFile(artifactFile);
    if (declaredArtifact.size !== artifactBytes.byteLength) {
      throw new Error(
        `${release.name}@${release.version} artifact size mismatch before archive inspection`,
      );
    }
    const artifactSha256 = createHash("sha256").update(artifactBytes).digest("hex");
    if (declaredArtifact.sha256 !== artifactSha256) {
      throw new Error(
        `${release.name}@${release.version} artifact sha256 mismatch before archive inspection`,
      );
    }
    const artifact = artifactRecordFromBytes(artifactBytes, expectedFilename, spec);
    const packageJson = await packageJsonAtRevision(repoRoot, source.revision, spec.packagePath);
    assertPackageIdentity(packageJson, spec);
    const expected = manifestDocument({
      spec,
      packageJson,
      revision: source.revision,
      artifact,
      primaryOrigin,
      githubRepository,
    });
    assertCanonicalDocument(manifestText, expected, manifestFile);
    const versionEntries = (await readdir(versionRoot)).sort();
    const expectedEntries = [artifact.filename, "manifest.json"].sort();
    if (JSON.stringify(versionEntries) !== JSON.stringify(expectedEntries)) {
      throw new Error(`${release.name}@${release.version} directory contains unexpected files`);
    }
  }
  return releases;
}

export async function verifyLovePackages(options: RegistryOptions): Promise<void> {
  const repoRoot = resolve(options.repoRoot);
  const outputRoot = resolve(options.outputRoot);
  const specs = options.packages ?? LOVE_PACKAGES;
  const primaryOrigin = normalizeOrigin(options.primaryOrigin ?? PRIMARY_ORIGIN);
  const githubRepository = normalizeOrigin(options.githubRepository ?? GITHUB_REPOSITORY);

  validateSpecs(specs);
  validateHttpsUrl(primaryOrigin, "primaryOrigin", true);
  validateHttpsUrl(githubRepository, "githubRepository");
  const releases = await verifyRegistryTree({ repoRoot, outputRoot, primaryOrigin, githubRepository });
  const releaseKeys = new Set(releases.map((release) => `${release.name}\0${release.version}`));
  for (const spec of specs) {
    if (!releaseKeys.has(`${spec.name}\0${spec.version}`)) {
      throw new Error(`required LOVE Package release is missing: ${spec.name}@${spec.version}`);
    }
    const manifest = expectObject(
      await readJson(join(outputRoot, manifestPath(spec).slice(1))),
      `${spec.name} manifest`,
    );
    const source = expectObject(manifest.source, `${spec.name} manifest source`);
    if (source.path !== spec.packagePath) {
      throw new Error(`${spec.name}@${spec.version} source.path does not match the release inventory`);
    }
    if (spec.releaseTag !== `${packageSlug(spec)}-v${spec.version}`) {
      throw new Error(`${spec.name}@${spec.version} releaseTag does not follow the immutable tag convention`);
    }
  }
}

function usage(): never {
  console.error("Usage: bin/build-love-packages.ts <build|verify> <staging-directory>");
  process.exit(2);
}

async function main(): Promise<void> {
  const [command, output] = process.argv.slice(2);
  if (!output || (command !== "build" && command !== "verify")) usage();
  const repoRoot = resolve(import.meta.dir, "..");
  const options = { repoRoot, outputRoot: resolve(output) };
  if (command === "build") {
    await buildLovePackages(options);
    await verifyLovePackages(options);
    console.log(`Built and verified LOVE Packages in ${options.outputRoot}`);
  } else {
    await verifyLovePackages(options);
    console.log(`Verified LOVE Packages in ${options.outputRoot}`);
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`LOVE Package ${process.argv[2] ?? "command"} failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
