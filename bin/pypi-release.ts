#!/usr/bin/env bun

/**
 * Fail-closed preparation and public verification for agenttool-sdk on PyPI.
 *
 * This program deliberately has no publication command. Build and tests run
 * before any OIDC permission exists; the protected workflow transfers only the
 * exact distributions and receipt to PyPA's trusted-publisher action.
 */

import { createHash } from "node:crypto";
import {
  appendFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

export const PYPI_RELEASE_RECEIPT_SCHEMA = "agenttool.pypi-release/1";
export const PYPI_PACKAGE_NAME = "agenttool-sdk";
export const PYPI_PACKAGE_PATH = "packages/sdk-py";
export const EXPECTED_REPOSITORY = "https://github.com/cambridgetcg/agenttool";
export const PINNED_BUN = "1.3.5";
export const PINNED_PYTHON = "3.14.5";
export const PINNED_UV = "0.9.26";
export const PINNED_HATCHLING = "1.27.0";
export const PINNED_BUILD_REQUIREMENTS = [
  "hatchling==1.27.0 --hash=sha256:d3a2f3567c4f926ea39849cdf924c7e99e6686c9c8e288ae1037c8fa2a5d937b",
  "packaging==26.2 --hash=sha256:5fc45236b9446107ff2415ce77c807cee2862cb6fac22b8a73826d0693b0980e",
  "pathspec==1.1.1 --hash=sha256:a00ce642f577bf7f473932318056212bc4f8bfdf53128c78bbd5af0b9b20b189",
  "pluggy==1.6.0 --hash=sha256:e920276dd6813095e9377c0bc5566d94c932c33b27a3e3945d8389c374dd4746",
  "trove-classifiers==2026.6.1.19 --hash=sha256:ab4c4ec93cc4a4e7815fa759906e05e6bb3f2fbd92ea0f897288c6a43efd15b3",
] as const;

export type PyPIArtifactType = "bdist_wheel" | "sdist";

export interface ArtifactIdentity {
  filename: string;
  packagetype: PyPIArtifactType;
  size: number;
  sha256: string;
}

export interface PublicArtifact extends ArtifactIdentity {
  url: string;
  yanked: boolean;
}

export interface PyPIReleaseReceipt {
  schema: typeof PYPI_RELEASE_RECEIPT_SCHEMA;
  package: {
    name: typeof PYPI_PACKAGE_NAME;
    version: string;
    path: typeof PYPI_PACKAGE_PATH;
  };
  tag: string;
  tag_commit: string;
  source_revision: string;
  artifacts: ArtifactIdentity[];
  prepared_at: string;
  result?: {
    status: "public_exact";
    pypi_observed_at: string;
    files: PublicArtifact[];
  };
}

interface ProjectIdentity {
  name: typeof PYPI_PACKAGE_NAME;
  version: string;
  license: "Apache-2.0";
  requiresPython: ">=3.9";
  repository: typeof EXPECTED_REPOSITORY;
}

interface CommandResult {
  exitCode: number;
  stdout: string;
}

const REPO_ROOT = resolve(import.meta.dir, "..");
const SDK_ROOT = join(REPO_ROOT, PYPI_PACKAGE_PATH);
const PYPI_ORIGIN = "https://pypi.org";
const PYPI_FILE_ORIGIN = "https://files.pythonhosted.org";
const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const SAFE_TAG = /^[a-z0-9][a-z0-9._-]*$/;
const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_DISTRIBUTION_BYTES = 25 * 1024 * 1024;
const MAX_METADATA_BYTES = 2 * 1024 * 1024;
export const PYPI_VISIBILITY_TIMEOUT_MS = 7 * 60 * 1000;
const MAX_REQUEST_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 5_000;

const PUBLISH_AUTHORITY_ENVIRONMENT = [
  "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
  "ACTIONS_ID_TOKEN_REQUEST_URL",
  "HATCH_INDEX_AUTH",
  "HATCH_INDEX_PASSWORD",
  "HATCH_INDEX_USER",
  "POETRY_HTTP_BASIC_PYPI_PASSWORD",
  "POETRY_HTTP_BASIC_PYPI_USERNAME",
  "POETRY_PYPI_TOKEN_PYPI",
  "PYPI_API_TOKEN",
  "PYPI_PASSWORD",
  "PYPI_TOKEN",
  "PYPI_USERNAME",
  "TWINE_PASSWORD",
  "TWINE_USERNAME",
  "UV_PUBLISH_PASSWORD",
  "UV_PUBLISH_TOKEN",
  "UV_PUBLISH_USERNAME",
] as const;

const DISTRIBUTION_INSPECTOR = String.raw`
import base64
import csv
import hashlib
import io
import json
import re
import stat
import sys
import tarfile
import zipfile
from email.parser import Parser
from pathlib import PurePosixPath

kind, artifact_path, expected_name, expected_version, expected_hatchling = sys.argv[1:]
expected_distribution = expected_name.replace("-", "_")
expected_dist_info = expected_distribution + "-" + expected_version + ".dist-info"
expected_sdist_root = expected_distribution + "-" + expected_version
max_entries = 2000
max_file_bytes = 8 * 1024 * 1024
max_total_bytes = 64 * 1024 * 1024
text_suffixes = (
    ".cjs", ".css", ".html", ".js", ".json", ".jsx", ".map", ".md", ".mjs",
    ".mts", ".pem", ".py", ".toml", ".ts", ".tsx", ".txt", ".yaml", ".yml",
)
sensitive_name = re.compile(
    r"(?:^|/)(?:\.env(?:\..*)?|\.netrc|\.npmrc|\.pypirc|credentials(?:\.json)?|id_ed25519|id_rsa)$",
    re.IGNORECASE,
)
secret_signatures = (
    ("private-key block", re.compile(r"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----")),
    ("AWS access key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("GitHub token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,}\b")),
    ("PyPI token", re.compile(r"\bpypi-[A-Za-z0-9_-]{40,}\b")),
    ("Slack token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{20,}\b")),
)

def fail(message):
    raise SystemExit("distribution verification failed: " + message)

def safe_path(name):
    if not name or "\0" in name or "\\" in name:
        fail("archive contains an invalid path")
    value = name[:-1] if name.endswith("/") else name
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ("", ".", "..") for part in path.parts):
        fail("archive contains an unsafe path")
    return value

def scan_text(name, data):
    if sensitive_name.search(name):
        fail("archive contains a sensitive filename: " + name)
    if len(data) > max_file_bytes:
        return
    if not name.lower().endswith(text_suffixes) and PurePosixPath(name).name not in ("LICENSE", "NOTICE"):
        return
    text = data.decode("utf-8", "replace")
    for label, pattern in secret_signatures:
        if pattern.search(text):
            fail("archive contains a secret-like " + label + " signature")

def metadata_identity(data):
    try:
        message = Parser().parsestr(data.decode("utf-8"))
    except Exception:
        fail("core metadata is not valid UTF-8 email metadata")
    if message.get("Name") != expected_name:
        fail("core metadata Name does not match")
    if message.get("Version") != expected_version:
        fail("core metadata Version does not match")
    if message.get("License-Expression") != "Apache-2.0":
        fail("core metadata License-Expression must be Apache-2.0")
    if message.get("Requires-Python") != ">=3.9":
        fail("core metadata Requires-Python must be >=3.9")
    license_files = set(message.get_all("License-File", []))
    if not {"LICENSE", "NOTICE"}.issubset(license_files):
        fail("core metadata must name LICENSE and NOTICE")
    repository_urls = []
    for value in message.get_all("Project-URL", []):
        label, separator, url = value.partition(",")
        if separator and label.strip() == "Repository":
            repository_urls.append(url.strip())
    if repository_urls != ["https://github.com/cambridgetcg/agenttool"]:
        fail("core metadata Repository URL does not match")

def verify_wheel():
    try:
        archive = zipfile.ZipFile(artifact_path, "r")
    except Exception:
        fail("wheel is not a readable ZIP archive")
    with archive:
        infos = archive.infolist()
        if not infos or len(infos) > max_entries:
            fail("wheel entry count is outside the reviewed bound")
        names = [info.filename for info in infos]
        if len(names) != len(set(names)):
            fail("wheel contains duplicate paths")
        payloads = {}
        total = 0
        for info in infos:
            name = safe_path(info.filename)
            mode = info.external_attr >> 16
            file_type = stat.S_IFMT(mode)
            if file_type not in (0, stat.S_IFREG, stat.S_IFDIR):
                fail("wheel contains a link or special entry: " + name)
            if info.is_dir():
                continue
            if info.file_size > max_file_bytes:
                fail("wheel entry exceeds the reviewed size bound: " + name)
            total += info.file_size
            if total > max_total_bytes:
                fail("wheel expands beyond the reviewed size bound")
            data = archive.read(info)
            if len(data) != info.file_size:
                fail("wheel entry size changed while reading: " + name)
            payloads[name] = data
            scan_text(name, data)

        metadata_path = expected_dist_info + "/METADATA"
        wheel_path = expected_dist_info + "/WHEEL"
        record_path = expected_dist_info + "/RECORD"
        required = {
            "agenttool/__init__.py",
            "agenttool/SOUL.md",
            metadata_path,
            wheel_path,
            expected_dist_info + "/licenses/LICENSE",
            expected_dist_info + "/licenses/NOTICE",
            record_path,
        }
        missing = sorted(required.difference(payloads))
        if missing:
            fail("wheel is missing required entries: " + ", ".join(missing))
        dist_infos = {
            name.split("/", 1)[0]
            for name in payloads
            if name.endswith(".dist-info/METADATA")
        }
        if dist_infos != {expected_dist_info}:
            fail("wheel must contain exactly one matching dist-info identity")
        metadata_identity(payloads[metadata_path])
        wheel_text = payloads[wheel_path].decode("utf-8", "strict")
        required_wheel_lines = {
            "Wheel-Version: 1.0",
            "Generator: hatchling " + expected_hatchling,
            "Root-Is-Purelib: true",
            "Tag: py3-none-any",
        }
        if not required_wheel_lines.issubset(set(wheel_text.splitlines())):
            fail("wheel compatibility or pinned generator metadata changed")

        try:
            rows = list(csv.reader(io.StringIO(payloads[record_path].decode("utf-8", "strict"))))
        except Exception:
            fail("wheel RECORD is not valid UTF-8 CSV")
        records = {}
        for row in rows:
            if len(row) != 3 or row[0] in records:
                fail("wheel RECORD contains a malformed or duplicate row")
            records[row[0]] = (row[1], row[2])
        if set(records) != set(payloads):
            fail("wheel RECORD does not cover the exact archive file set")
        for name, data in payloads.items():
            digest, size = records[name]
            if name == record_path:
                if digest or size:
                    fail("wheel RECORD self-entry must omit hash and size")
                continue
            if not digest.startswith("sha256="):
                fail("wheel RECORD must use SHA-256 for every payload")
            expected_digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b"=").decode("ascii")
            if digest[7:] != expected_digest or size != str(len(data)):
                fail("wheel RECORD hash or size mismatch: " + name)

def verify_sdist():
    try:
        archive = tarfile.open(artifact_path, "r:gz")
    except Exception:
        fail("sdist is not a readable gzip tar archive")
    with archive:
        members = archive.getmembers()
        if not members or len(members) > max_entries:
            fail("sdist entry count is outside the reviewed bound")
        names = [member.name for member in members]
        if len(names) != len(set(names)):
            fail("sdist contains duplicate paths")
        payloads = {}
        total = 0
        for member in members:
            name = safe_path(member.name)
            if member.issym() or member.islnk() or member.isdev() or member.isfifo():
                fail("sdist contains a link or special entry: " + name)
            if member.isdir():
                continue
            if not member.isfile():
                fail("sdist contains an unsupported entry type: " + name)
            if member.size > max_file_bytes:
                fail("sdist entry exceeds the reviewed size bound: " + name)
            total += member.size
            if total > max_total_bytes:
                fail("sdist expands beyond the reviewed size bound")
            source = archive.extractfile(member)
            if source is None:
                fail("sdist file could not be read: " + name)
            data = source.read(max_file_bytes + 1)
            if len(data) != member.size:
                fail("sdist entry size changed while reading: " + name)
            payloads[name] = data
            scan_text(name, data)

        roots = {name.split("/", 1)[0] for name in payloads}
        if roots != {expected_sdist_root}:
            fail("sdist must contain one exact versioned root")
        prefix = expected_sdist_root + "/"
        required = {
            prefix + "PKG-INFO",
            prefix + "pyproject.toml",
            prefix + "README.md",
            prefix + "LICENSE",
            prefix + "NOTICE",
            prefix + "SOUL.md",
            prefix + "src/agenttool/__init__.py",
            prefix + "src/agenttool/SOUL.md",
        }
        missing = sorted(required.difference(payloads))
        if missing:
            fail("sdist is missing required entries: " + ", ".join(missing))
        metadata_identity(payloads[prefix + "PKG-INFO"])

if kind == "bdist_wheel":
    verify_wheel()
elif kind == "sdist":
    verify_sdist()
else:
    fail("unknown distribution kind")

print(json.dumps({
    "kind": kind,
    "name": expected_name,
    "version": expected_version,
}, sort_keys=True))
`;

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
  if (options.log !== false) {
    console.error(`→ ${[executable, ...args].map(shellDisplay).join(" ")}`);
  }
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
  if (exitCode !== 0 && !options.allowFailure) fail(`${executable} exited ${exitCode}`);
  return { exitCode, stdout };
}

async function captured(
  executable: string,
  args: readonly string[],
  cwd = REPO_ROOT,
): Promise<string> {
  return (await command(executable, args, { cwd, capture: true })).stdout.trim();
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(`${label} fields must be exactly: ${expected.join(", ")}`);
  }
}

function ownString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${label} must be a non-empty string`);
  }
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

function canonicalPackageName(value: string): string {
  return value.toLowerCase().replace(/[-_.]+/g, "-");
}

function parseTomlString(value: string, label: string): string {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== "string" || parsed.length === 0) fail(`${label} must be a string`);
    return parsed;
  } catch {
    fail(`${label} must be one basic TOML string`);
  }
}

async function projectIdentity(): Promise<ProjectIdentity> {
  const source = await readFile(join(SDK_ROOT, "pyproject.toml"), "utf8");
  let section = "";
  const fields = new Map<string, string>();
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("[") && line.endsWith("]")) {
      section = line.slice(1, -1);
      continue;
    }
    if (section !== "project" && section !== "project.urls") continue;
    const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*=\s*("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/.exec(line);
    if (!match) continue;
    const key = `${section}.${match[1]}`;
    if (fields.has(key)) fail(`pyproject.toml repeats ${key}`);
    fields.set(key, parseTomlString(match[2], `pyproject.toml ${key}`));
  }

  const name = fields.get("project.name");
  const version = fields.get("project.version");
  const license = fields.get("project.license");
  const requiresPython = fields.get("project.requires-python");
  const repository = fields.get("project.urls.Repository");
  if (name !== PYPI_PACKAGE_NAME) fail(`pyproject.toml name must be ${PYPI_PACKAGE_NAME}`);
  if (!version || !STABLE_VERSION.test(version)) {
    fail("PyPI release version must be stable X.Y.Z");
  }
  if (license !== "Apache-2.0") fail("pyproject.toml license must be Apache-2.0");
  if (requiresPython !== ">=3.9") fail("pyproject.toml requires-python must be >=3.9");
  if (repository !== EXPECTED_REPOSITORY) {
    fail(`pyproject.toml Repository must be ${EXPECTED_REPOSITORY}`);
  }
  return {
    name,
    version,
    license,
    requiresPython,
    repository,
  };
}

export function expectedTag(version: string): string {
  if (!STABLE_VERSION.test(version)) fail(`invalid stable PyPI version: ${version}`);
  return `sdk-v${version}`;
}

export function expectedArtifactFilenames(version: string): {
  wheel: string;
  sdist: string;
} {
  if (!STABLE_VERSION.test(version)) fail(`invalid stable PyPI version: ${version}`);
  return {
    wheel: `agenttool_sdk-${version}-py3-none-any.whl`,
    sdist: `agenttool_sdk-${version}.tar.gz`,
  };
}

function expectedArtifactType(filename: string, version: string): PyPIArtifactType {
  const expected = expectedArtifactFilenames(version);
  if (filename === expected.wheel) return "bdist_wheel";
  if (filename === expected.sdist) return "sdist";
  fail(`unexpected Python distribution filename: ${filename}`);
}

function artifactIdentity(value: unknown, label: string): ArtifactIdentity {
  const artifact = record(value, label);
  exactKeys(artifact, ["filename", "packagetype", "size", "sha256"], label);
  const filename = ownString(artifact.filename, `${label}.filename`);
  if (filename !== basename(filename)) fail(`${label}.filename must be a basename`);
  const packagetype = ownString(artifact.packagetype, `${label}.packagetype`);
  if (packagetype !== "bdist_wheel" && packagetype !== "sdist") {
    fail(`${label}.packagetype is unsupported`);
  }
  const size = ownInteger(artifact.size, `${label}.size`);
  if (size === 0 || size > MAX_DISTRIBUTION_BYTES) {
    fail(`${label}.size is outside the reviewed bound`);
  }
  const sha256 = ownString(artifact.sha256, `${label}.sha256`);
  if (!SHA256.test(sha256)) fail(`${label}.sha256 must be lowercase SHA-256`);
  return { filename, packagetype, size, sha256 };
}

function validatePublicUrl(value: unknown, filename: string, label: string): string {
  const text = ownString(value, label);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    fail(`${label} must be an absolute URL`);
  }
  if (
    url.origin !== PYPI_FILE_ORIGIN ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith(`/${filename}`)
  ) {
    fail(`${label} must be the exact PyPI file URL for ${filename}`);
  }
  return text;
}

function publicArtifact(value: unknown, label: string): PublicArtifact {
  const artifact = record(value, label);
  exactKeys(
    artifact,
    ["filename", "packagetype", "size", "sha256", "url", "yanked"],
    label,
  );
  const identity = artifactIdentity(
    {
      filename: artifact.filename,
      packagetype: artifact.packagetype,
      size: artifact.size,
      sha256: artifact.sha256,
    },
    label,
  );
  if (typeof artifact.yanked !== "boolean") fail(`${label}.yanked must be boolean`);
  return {
    ...identity,
    url: validatePublicUrl(artifact.url, identity.filename, `${label}.url`),
    yanked: artifact.yanked,
  };
}

export function releaseDecision(
  expectedArtifacts: readonly ArtifactIdentity[],
  publicFiles: readonly PublicArtifact[],
): "publish" | "verify-existing" {
  if (expectedArtifacts.length !== 2) fail("release receipt must contain exactly two artifacts");
  const expectedByName = new Map<string, ArtifactIdentity>();
  for (const artifact of expectedArtifacts) {
    if (expectedByName.has(artifact.filename)) fail("release receipt repeats an artifact filename");
    expectedByName.set(artifact.filename, artifact);
  }
  const seen = new Set<string>();
  for (const file of publicFiles) {
    if (seen.has(file.filename)) fail("PyPI release repeats a distribution filename");
    seen.add(file.filename);
    const expected = expectedByName.get(file.filename);
    if (!expected) fail(`PyPI release contains unexpected distribution ${file.filename}`);
    validatePublicUrl(file.url, file.filename, `PyPI ${file.filename} URL`);
    if (file.yanked) fail(`PyPI distribution is yanked: ${file.filename}`);
    if (
      file.packagetype !== expected.packagetype ||
      file.size !== expected.size ||
      file.sha256 !== expected.sha256
    ) {
      fail(`PyPI distribution differs from the prepared artifact: ${file.filename}`);
    }
  }
  return seen.size === expectedByName.size ? "verify-existing" : "publish";
}

export function publicationRequirements(
  expectedArtifacts: readonly ArtifactIdentity[],
  publicFiles: readonly PublicArtifact[],
): {
  publishRequired: boolean;
  wheelRequired: boolean;
  sdistRequired: boolean;
} {
  const decision = releaseDecision(expectedArtifacts, publicFiles);
  const wheel = expectedArtifacts.find(
    (artifact) => artifact.packagetype === "bdist_wheel",
  );
  const sdist = expectedArtifacts.find((artifact) => artifact.packagetype === "sdist");
  if (!wheel || !sdist) fail("release receipt must contain one wheel and one sdist");
  const publicFilenames = new Set(publicFiles.map((file) => file.filename));
  return {
    publishRequired: decision === "publish",
    wheelRequired: !publicFilenames.has(wheel.filename),
    sdistRequired: !publicFilenames.has(sdist.filename),
  };
}

export async function readReleaseReceipt(path: string): Promise<PyPIReleaseReceipt> {
  const parsed = record(JSON.parse(await readFile(path, "utf8")), "release receipt");
  exactKeys(
    parsed,
    Object.hasOwn(parsed, "result")
      ? [
          "schema",
          "package",
          "tag",
          "tag_commit",
          "source_revision",
          "artifacts",
          "prepared_at",
          "result",
        ]
      : [
          "schema",
          "package",
          "tag",
          "tag_commit",
          "source_revision",
          "artifacts",
          "prepared_at",
        ],
    "release receipt",
  );
  if (parsed.schema !== PYPI_RELEASE_RECEIPT_SCHEMA) {
    fail(`release receipt schema must be ${PYPI_RELEASE_RECEIPT_SCHEMA}`);
  }
  const packageRecord = record(parsed.package, "release receipt package");
  exactKeys(packageRecord, ["name", "version", "path"], "release receipt package");
  if (packageRecord.name !== PYPI_PACKAGE_NAME || packageRecord.path !== PYPI_PACKAGE_PATH) {
    fail("release receipt package identity is not agenttool-sdk");
  }
  const version = ownString(packageRecord.version, "release receipt package.version");
  if (!STABLE_VERSION.test(version)) fail("release receipt version must be stable X.Y.Z");
  const tag = ownString(parsed.tag, "release receipt tag");
  if (tag !== expectedTag(version)) fail(`release receipt tag must be ${expectedTag(version)}`);
  const tagCommit = ownString(parsed.tag_commit, "release receipt tag_commit");
  const sourceRevision = ownString(
    parsed.source_revision,
    "release receipt source_revision",
  );
  if (!SHA1.test(tagCommit) || !SHA1.test(sourceRevision) || tagCommit !== sourceRevision) {
    fail("release receipt revisions must be one matching lowercase GitHub SHA");
  }
  if (!Array.isArray(parsed.artifacts)) fail("release receipt artifacts must be an array");
  const artifacts = parsed.artifacts.map((value, index) =>
    artifactIdentity(value, `release receipt artifacts[${index}]`)
  );
  const expectedFiles = expectedArtifactFilenames(version);
  if (
    artifacts.length !== 2 ||
    artifacts[0]?.filename !== expectedFiles.wheel ||
    artifacts[0]?.packagetype !== "bdist_wheel" ||
    artifacts[1]?.filename !== expectedFiles.sdist ||
    artifacts[1]?.packagetype !== "sdist"
  ) {
    fail("release receipt must contain the exact wheel then sdist");
  }

  let result: PyPIReleaseReceipt["result"];
  if (Object.hasOwn(parsed, "result")) {
    const resultRecord = record(parsed.result, "release receipt result");
    exactKeys(resultRecord, ["status", "pypi_observed_at", "files"], "release receipt result");
    if (resultRecord.status !== "public_exact") {
      fail("release receipt result.status must be public_exact");
    }
    if (!Array.isArray(resultRecord.files)) {
      fail("release receipt result.files must be an array");
    }
    const files = resultRecord.files.map((value, index) =>
      publicArtifact(value, `release receipt result.files[${index}]`)
    );
    if (releaseDecision(artifacts, files) !== "verify-existing") {
      fail("release receipt result is incomplete");
    }
    result = {
      status: "public_exact",
      pypi_observed_at: canonicalIsoTime(
        resultRecord.pypi_observed_at,
        "release receipt result.pypi_observed_at",
      ),
      files,
    };
  }

  return {
    schema: PYPI_RELEASE_RECEIPT_SCHEMA,
    package: {
      name: PYPI_PACKAGE_NAME,
      version,
      path: PYPI_PACKAGE_PATH,
    },
    tag,
    tag_commit: tagCommit,
    source_revision: sourceRevision,
    artifacts,
    prepared_at: canonicalIsoTime(parsed.prepared_at, "release receipt prepared_at"),
    ...(result ? { result } : {}),
  };
}

async function ensureClean(): Promise<void> {
  const status = await captured("git", [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  if (status.length > 0) {
    fail("PyPI release requires a clean worktree, including untracked files");
  }
}

function releaseRemote(): string {
  return process.env.GITHUB_ACTIONS === "true" ? "origin" : "github";
}

async function validateTag(version: string, tag: string): Promise<string> {
  if (!SAFE_TAG.test(tag)) fail(`unsafe release tag: ${tag}`);
  const expected = expectedTag(version);
  if (tag !== expected) fail(`${PYPI_PACKAGE_NAME}@${version} requires annotated tag ${expected}`);
  if (await captured("git", ["cat-file", "-t", `refs/tags/${tag}`]) !== "tag") {
    fail(`${tag} must be an annotated tag`);
  }
  const tagCommit = await captured("git", [
    "rev-list",
    "-n",
    "1",
    `refs/tags/${tag}`,
  ]);
  const head = await captured("git", ["rev-parse", "HEAD"]);
  if (tagCommit !== head) {
    fail(`HEAD ${head} is not annotated tag ${tag} commit ${tagCommit}`);
  }
  if (process.env.GITHUB_ACTIONS === "true") {
    if (
      process.env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
      process.env.GITHUB_REPOSITORY !== "cambridgetcg/agenttool" ||
      process.env.GITHUB_SHA !== tagCommit ||
      process.env.GITHUB_REF !== `refs/tags/${tag}`
    ) {
      fail("workflow must run on the exact annotated tag in cambridgetcg/agenttool");
    }
  }

  const remote = releaseRemote();
  const remoteUrl = await captured("git", ["remote", "get-url", remote]);
  const normalized = remoteUrl.endsWith(".git") ? remoteUrl.slice(0, -4) : remoteUrl;
  if (
    normalized !== EXPECTED_REPOSITORY &&
    normalized !== "git@github.com:cambridgetcg/agenttool"
  ) {
    fail(`${remote} must resolve to ${EXPECTED_REPOSITORY}`);
  }
  await command("git", [
    "fetch",
    "--no-tags",
    remote,
    `+refs/heads/main:refs/remotes/${remote}/main`,
  ]);
  const ancestry = await command(
    "git",
    ["merge-base", "--is-ancestor", tagCommit, `refs/remotes/${remote}/main`],
    { allowFailure: true },
  );
  if (ancestry.exitCode !== 0) fail(`${tag} is not contained in GitHub main`);
  return tagCommit;
}

function versionFromOutput(value: string, expression: RegExp, label: string): string {
  const match = expression.exec(value.trim());
  if (!match) fail(`could not read ${label} version`);
  return match[1];
}

async function ensurePinnedRuntime(includeUv: boolean): Promise<void> {
  if (Bun.version !== PINNED_BUN) {
    fail(`release requires Bun ${PINNED_BUN}, found ${Bun.version}`);
  }
  const pythonOutput = await captured("python3", ["--version"]);
  const pythonVersion = versionFromOutput(pythonOutput, /^Python ([0-9.]+)$/, "Python");
  if (pythonVersion !== PINNED_PYTHON) {
    fail(`release requires Python ${PINNED_PYTHON}, found ${pythonVersion}`);
  }
  if (includeUv) {
    const uvOutput = await captured("uv", ["--version"]);
    const uvVersion = versionFromOutput(uvOutput, /^uv ([0-9.]+)(?:\s|$)/, "uv");
    if (uvVersion !== PINNED_UV) {
      fail(`release requires uv ${PINNED_UV}, found ${uvVersion}`);
    }
  }
}

function ensureNoPublishAuthority(): void {
  const present = PUBLISH_AUTHORITY_ENVIRONMENT.filter((name) => Boolean(process.env[name]));
  if (present.length > 0) {
    fail(
      `credentialless PyPI stage refuses publish authority environment: ${present.join(", ")}`,
    );
  }
}

function credentiallessChildEnvironment(outputRoot: string): Record<string, string | undefined> {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (
      /(?:^|_)(?:API_KEY|CREDENTIALS?|PASSWORD|PRIVATE_KEY|SECRET|TOKEN)(?:$|_)/i.test(key) ||
      key.startsWith("AWS_") ||
      key.startsWith("GOOGLE_APPLICATION_CREDENTIALS")
    ) {
      delete environment[key];
    }
  }
  for (const key of PUBLISH_AUTHORITY_ENVIRONMENT) delete environment[key];
  delete environment.PIP_EXTRA_INDEX_URL;
  delete environment.PIP_INDEX_URL;
  delete environment.UV_EXTRA_INDEX_URL;
  delete environment.UV_INDEX;
  delete environment.UV_INDEX_URL;
  environment.PIP_CONFIG_FILE = "/dev/null";
  environment.PYTHONNOUSERSITE = "1";
  environment.UV_DEFAULT_INDEX = "https://pypi.org/simple";
  environment.UV_KEYRING_PROVIDER = "disabled";
  environment.UV_NO_MANAGED_PYTHON = "1";
  environment.UV_PYTHON_DOWNLOADS = "never";
  environment.NETRC = join(outputRoot, "nonexistent-netrc");
  return environment;
}

function ensureOutsideRepository(path: string): void {
  const relationship = relative(REPO_ROOT, path);
  if (
    relationship === "" ||
    (relationship !== ".." && !relationship.startsWith(`..${sep}`))
  ) {
    fail("PyPI release output must be outside the repository");
  }
}

export async function inspectDistribution(
  path: string,
  type: PyPIArtifactType,
  version: string,
): Promise<void> {
  const result = await command(
    "python3",
    [
      "-I",
      "-c",
      DISTRIBUTION_INSPECTOR,
      type,
      path,
      PYPI_PACKAGE_NAME,
      version,
      PINNED_HATCHLING,
    ],
    { capture: true, log: false },
  );
  let output: Record<string, unknown>;
  try {
    output = record(JSON.parse(result.stdout), "distribution inspector output");
  } catch {
    fail("distribution inspector did not return JSON");
  }
  exactKeys(output, ["kind", "name", "version"], "distribution inspector output");
  if (
    output.kind !== type ||
    output.name !== PYPI_PACKAGE_NAME ||
    output.version !== version
  ) {
    fail("distribution inspector returned a different identity");
  }
}

async function hashDistribution(
  path: string,
  type: PyPIArtifactType,
  version: string,
): Promise<ArtifactIdentity> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    fail(`distribution must be a regular file: ${path}`);
  }
  if (info.size === 0 || info.size > MAX_DISTRIBUTION_BYTES) {
    fail(`distribution size is outside the reviewed bound: ${path}`);
  }
  const bytes = new Uint8Array(await readFile(path));
  const filename = basename(path);
  if (expectedArtifactType(filename, version) !== type) {
    fail(`distribution type does not match filename: ${filename}`);
  }
  await inspectDistribution(path, type, version);
  return {
    filename,
    packagetype: type,
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function prepare(tag: string, output: string): Promise<PyPIReleaseReceipt> {
  ensureNoPublishAuthority();
  await ensurePinnedRuntime(true);
  await ensureClean();
  const project = await projectIdentity();
  const tagCommit = await validateTag(project.version, tag);

  const outputRoot = resolve(output);
  ensureOutsideRepository(outputRoot);
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  if ((await readdir(outputRoot)).length !== 0) {
    fail("PyPI release output directory must be empty");
  }
  const distRoot = join(outputRoot, "dist");
  const constraintsPath = join(outputRoot, "build-constraints.txt");
  await writeFile(constraintsPath, `${PINNED_BUILD_REQUIREMENTS.join("\n")}\n`, {
    mode: 0o600,
  });
  const childEnvironment = credentiallessChildEnvironment(outputRoot);

  await command(
    "uv",
    [
      "sync",
      "--frozen",
      "--extra",
      "dev",
      "--no-install-project",
      "--no-sources",
      "--no-python-downloads",
    ],
    { cwd: SDK_ROOT, env: childEnvironment },
  );
  await command(join(SDK_ROOT, ".venv", "bin", "python"), ["-m", "pytest", "-q"], {
    cwd: SDK_ROOT,
    env: childEnvironment,
  });
  await command(
    "uv",
    [
      "build",
      "--clear",
      "--sdist",
      "--wheel",
      "--out-dir",
      distRoot,
      "--build-constraints",
      constraintsPath,
      "--require-hashes",
      "--python",
      "python3",
      "--no-sources",
      "--no-python-downloads",
      "--no-create-gitignore",
    ],
    { cwd: SDK_ROOT, env: childEnvironment },
  );

  const expected = expectedArtifactFilenames(project.version);
  const entries = (await readdir(distRoot)).sort();
  if (JSON.stringify(entries) !== JSON.stringify([expected.wheel, expected.sdist].sort())) {
    fail(`build emitted an unexpected distribution set: ${entries.join(", ")}`);
  }
  const artifacts = [
    await hashDistribution(
      join(distRoot, expected.wheel),
      "bdist_wheel",
      project.version,
    ),
    await hashDistribution(join(distRoot, expected.sdist), "sdist", project.version),
  ];
  await ensureClean();

  const receipt: PyPIReleaseReceipt = {
    schema: PYPI_RELEASE_RECEIPT_SCHEMA,
    package: {
      name: PYPI_PACKAGE_NAME,
      version: project.version,
      path: PYPI_PACKAGE_PATH,
    },
    tag,
    tag_commit: tagCommit,
    source_revision: tagCommit,
    artifacts,
    prepared_at: new Date().toISOString(),
  };
  await writeFile(join(outputRoot, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, {
    mode: 0o600,
  });
  await rm(constraintsPath);
  console.log(JSON.stringify(receipt, null, 2));
  return receipt;
}

async function validateReceiptAgainstCheckout(
  receipt: PyPIReleaseReceipt,
  receiptPath: string,
): Promise<void> {
  ensureNoPublishAuthority();
  await ensurePinnedRuntime(false);
  await ensureClean();
  const project = await projectIdentity();
  if (project.version !== receipt.package.version) {
    fail("package version changed after distribution preparation");
  }
  const tagCommit = await validateTag(project.version, receipt.tag);
  if (tagCommit !== receipt.tag_commit || tagCommit !== receipt.source_revision) {
    fail("release receipt revision changed");
  }
  const distRoot = join(dirname(resolve(receiptPath)), "dist");
  const entries = (await readdir(distRoot)).sort();
  const expectedEntries = receipt.artifacts.map((artifact) => artifact.filename).sort();
  if (JSON.stringify(entries) !== JSON.stringify(expectedEntries)) {
    fail("transferred distribution set does not match the receipt");
  }
  for (const artifact of receipt.artifacts) {
    const current = await hashDistribution(
      join(distRoot, artifact.filename),
      artifact.packagetype,
      receipt.package.version,
    );
    if (JSON.stringify(current) !== JSON.stringify(artifact)) {
      fail(`transferred distribution changed: ${artifact.filename}`);
    }
  }
  await ensureClean();
}

class PyPIPropagationPending extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PyPIPropagationPending";
  }
}

class ResponsePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResponsePolicyError";
  }
}

function retryableStatus(status: number): boolean {
  return status === 404 || status === 408 || status === 425 || status === 429 || status >= 500;
}

export async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cleanup is best effort and must not replace the pending or refusal state.
  }
}

async function responseBytes(response: Response, bound: number): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > bound) {
      await discardResponseBody(response);
      throw new ResponsePolicyError("HTTP response exceeds the reviewed size bound");
    }
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > bound) {
      try {
        await reader.cancel();
      } catch {
        // Preserve the deterministic size refusal.
      }
      throw new ResponsePolicyError("HTTP response exceeds the reviewed size bound");
    }
    chunks.push(value);
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function loadPyPIRelease(
  version: string,
  requestTimeoutMs = MAX_REQUEST_TIMEOUT_MS,
): Promise<PublicArtifact[]> {
  let response: Response;
  try {
    response = await fetch(
      `${PYPI_ORIGIN}/pypi/${encodeURIComponent(PYPI_PACKAGE_NAME)}/${encodeURIComponent(version)}/json`,
      {
        redirect: "error",
        signal: AbortSignal.timeout(requestTimeoutMs),
        headers: { accept: "application/json" },
      },
    );
  } catch {
    throw new PyPIPropagationPending("PyPI release metadata is not reachable");
  }
  if (response.status === 404) {
    await discardResponseBody(response);
    return [];
  }
  if (response.status !== 200) {
    await discardResponseBody(response);
    if (retryableStatus(response.status)) {
      throw new PyPIPropagationPending(
        `PyPI release metadata returned HTTP ${response.status}`,
      );
    }
    fail(`PyPI release metadata returned HTTP ${response.status}`);
  }
  let bytes: Uint8Array;
  try {
    bytes = await responseBytes(response, MAX_METADATA_BYTES);
  } catch (error) {
    if (error instanceof ResponsePolicyError) throw error;
    throw new PyPIPropagationPending("PyPI release metadata response was incomplete");
  }
  let document: Record<string, unknown>;
  try {
    document = record(JSON.parse(new TextDecoder().decode(bytes)), "PyPI release metadata");
  } catch {
    fail("PyPI release metadata is not valid JSON");
  }
  const info = record(document.info, "PyPI release metadata.info");
  if (
    typeof info.name !== "string" ||
    canonicalPackageName(info.name) !== PYPI_PACKAGE_NAME ||
    info.version !== version
  ) {
    fail("PyPI release metadata returned a different project identity");
  }
  if (!Array.isArray(document.urls)) fail("PyPI release metadata.urls must be an array");
  return document.urls.map((value, index) => {
    const file = record(value, `PyPI release metadata.urls[${index}]`);
    const digests = record(file.digests, `PyPI release metadata.urls[${index}].digests`);
    return publicArtifact(
      {
        filename: file.filename,
        packagetype: file.packagetype,
        size: file.size,
        sha256: digests.sha256,
        url: file.url,
        yanked: file.yanked,
      },
      `PyPI release metadata.urls[${index}]`,
    );
  });
}

async function check(receiptPath: string): Promise<void> {
  const absoluteReceiptPath = resolve(receiptPath);
  const receipt = await readReleaseReceipt(absoluteReceiptPath);
  await validateReceiptAgainstCheckout(receipt, absoluteReceiptPath);
  let files: PublicArtifact[];
  try {
    files = await loadPyPIRelease(receipt.package.version);
  } catch (error) {
    if (error instanceof PyPIPropagationPending) {
      fail(`public PyPI preflight is ambiguous: ${error.message}`);
    }
    throw error;
  }
  const requirements = publicationRequirements(receipt.artifacts, files);
  const state =
    !requirements.publishRequired
      ? "complete_exact"
      : files.length === 0
        ? "absent"
        : "partial_exact";
  const result = {
    state,
    publish_required: requirements.publishRequired,
    wheel_required: requirements.wheelRequired,
    sdist_required: requirements.sdistRequired,
    project: `${receipt.package.name}@${receipt.package.version}`,
    public_files: files.map((file) => file.filename).sort(),
  };
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      [
        `publish_required=${String(result.publish_required)}`,
        `wheel_required=${String(result.wheel_required)}`,
        `sdist_required=${String(result.sdist_required)}`,
        "",
      ].join("\n"),
    );
  }
  console.log(JSON.stringify(result, null, 2));
}

async function verifyDownloadedArtifact(
  expected: ArtifactIdentity,
  file: PublicArtifact,
  outputRoot: string,
  version: string,
  requestTimeoutMs = MAX_REQUEST_TIMEOUT_MS,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(file.url, {
      redirect: "error",
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch {
    throw new PyPIPropagationPending(`PyPI file is not reachable: ${file.filename}`);
  }
  if (response.status !== 200) {
    await discardResponseBody(response);
    if (retryableStatus(response.status)) {
      throw new PyPIPropagationPending(
        `PyPI file is not visible yet: ${file.filename} (HTTP ${response.status})`,
      );
    }
    fail(`PyPI file download returned HTTP ${response.status}: ${file.filename}`);
  }
  let bytes: Uint8Array;
  try {
    bytes = await responseBytes(response, expected.size);
  } catch (error) {
    if (error instanceof ResponsePolicyError) throw error;
    throw new PyPIPropagationPending(`PyPI file download was incomplete: ${file.filename}`);
  }
  if (bytes.byteLength < expected.size) {
    throw new PyPIPropagationPending(`PyPI file download was incomplete: ${file.filename}`);
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== expected.sha256) {
    fail(`downloaded PyPI bytes differ from the prepared artifact: ${file.filename}`);
  }
  const outputPath = join(outputRoot, file.filename);
  await writeFile(outputPath, bytes, { mode: 0o600 });
  await inspectDistribution(outputPath, file.packagetype, version);
}

export interface PyPIPollOptions {
  timeoutMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  loadRelease?: (
    version: string,
    requestTimeoutMs: number,
  ) => Promise<PublicArtifact[]>;
  verifyArtifact?: (
    expected: ArtifactIdentity,
    file: PublicArtifact,
    outputRoot: string,
    version: string,
    requestTimeoutMs: number,
  ) => Promise<void>;
}

function requestBudget(deadline: number, now: () => number): number {
  const remaining = Math.floor(deadline - now());
  if (remaining <= 0) return 0;
  return Math.max(1, Math.min(MAX_REQUEST_TIMEOUT_MS, remaining));
}

export async function pollPublicExact(
  receipt: PyPIReleaseReceipt,
  options: PyPIPollOptions = {},
): Promise<PublicArtifact[]> {
  const timeoutMs = options.timeoutMs ?? PYPI_VISIBILITY_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    fail("PyPI polling requires a positive integer timeout");
  }
  const now = options.now ?? (() => performance.now());
  const sleep = options.sleep ?? Bun.sleep;
  const loadRelease = options.loadRelease ?? loadPyPIRelease;
  const verifyArtifact = options.verifyArtifact ?? verifyDownloadedArtifact;
  const deadline = now() + timeoutMs;
  const outputRoot = await mkdtemp(join(tmpdir(), "agenttool-pypi-verify-"));
  try {
    while (now() < deadline) {
      try {
        const metadataBudget = requestBudget(deadline, now);
        if (metadataBudget === 0) break;
        const files = await loadRelease(receipt.package.version, metadataBudget);
        const decision = releaseDecision(receipt.artifacts, files);
        if (decision === "verify-existing") {
          for (const expected of receipt.artifacts) {
            const file = files.find((candidate) => candidate.filename === expected.filename);
            if (!file) fail(`PyPI release omitted ${expected.filename}`);
            const artifactBudget = requestBudget(deadline, now);
            if (artifactBudget === 0) {
              throw new PyPIPropagationPending("shared PyPI visibility deadline elapsed");
            }
            await verifyArtifact(
              expected,
              file,
              outputRoot,
              receipt.package.version,
              artifactBudget,
            );
          }
          if (now() >= deadline) break;
          return files;
        }
      } catch (error) {
        if (!(error instanceof PyPIPropagationPending)) throw error;
      }
      const remaining = Math.floor(deadline - now());
      if (remaining <= 0) break;
      await sleep(Math.min(POLL_INTERVAL_MS, remaining));
    }
  } finally {
    try {
      await rm(outputRoot, { recursive: true, force: true });
    } catch {
      // Verification state outranks best-effort cleanup of non-secret temp bytes.
    }
  }
  fail(
    `exact public PyPI distributions were not visible within ${Math.ceil(timeoutMs / 1000)} seconds`,
  );
}

async function verify(receiptPath: string): Promise<void> {
  const absoluteReceiptPath = resolve(receiptPath);
  const receipt = await readReleaseReceipt(absoluteReceiptPath);
  await validateReceiptAgainstCheckout(receipt, absoluteReceiptPath);
  const files = await pollPublicExact(receipt);
  const complete: PyPIReleaseReceipt = {
    ...receipt,
    result: {
      status: "public_exact",
      pypi_observed_at: new Date().toISOString(),
      files,
    },
  };
  await writeFile(absoluteReceiptPath, `${JSON.stringify(complete, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(JSON.stringify(complete, null, 2));
}

function argumentsMap(args: readonly string[]): {
  command: string;
  options: Map<string, string>;
} {
  const [subcommand, ...rest] = args;
  if (!subcommand) fail("usage: pypi-release.ts <resolve|prepare|check|verify> [options]");
  const options = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.startsWith("--")) {
      fail(`invalid option near ${String(flag)}`);
    }
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
    if (parsed.options.size !== 0) fail("resolve accepts no options");
    const project = await projectIdentity();
    console.log(
      JSON.stringify(
        {
          ...project,
          tag: expectedTag(project.version),
          artifacts: expectedArtifactFilenames(project.version),
        },
        null,
        2,
      ),
    );
    return;
  }
  if (parsed.command === "prepare") {
    if (parsed.options.size !== 2) {
      fail("prepare requires exactly --tag and --output");
    }
    await prepare(
      required(parsed.options, "--tag"),
      required(parsed.options, "--output"),
    );
    return;
  }
  if (parsed.command === "check") {
    if (parsed.options.size !== 1) fail("check requires exactly --receipt");
    await check(required(parsed.options, "--receipt"));
    return;
  }
  if (parsed.command === "verify") {
    if (parsed.options.size !== 1) fail("verify requires exactly --receipt");
    await verify(required(parsed.options, "--receipt"));
    return;
  }
  fail(`unknown PyPI release command: ${parsed.command}`);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`PyPI release failed: ${message}`);
    process.exitCode = 1;
  });
}
