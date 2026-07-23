import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readlinkSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { CollabError } from "./errors.js";
import type { RepoCheckpoint } from "./protocol.js";

const GIT_TIMEOUT_MS = 5_000;
const MAX_GIT_OUTPUT = 1024 * 1024;
const MAX_UNTRACKED_FILES = 10_000;
const MAX_UNTRACKED_BYTES = 64 * 1024 * 1024;
const MAX_UNTRACKED_HASH_MS = 2_000;

export interface RepositoryIdentity {
  requested_root_path: string;
  root_path: string;
  repository_key: string;
  git_common_dir_hash: string | null;
  worktree_fingerprint: string;
  checkpoint: RepoCheckpoint;
}

export function inspectRepository(
  rootInput: string,
  explicitRepositoryKey?: string,
): RepositoryIdentity {
  const requested = resolve(rootInput);
  if (!existsSync(requested) || !statSync(requested).isDirectory()) {
    throw new CollabError(
      "workspace_not_directory",
      "Workspace root must be an existing directory",
      { root_path: requested },
    );
  }

  const requestedRoot = realpathSync(requested);
  const topLevel = gitOutput(requestedRoot, ["rev-parse", "--show-toplevel"]);
  const rootPath = topLevel && existsSync(topLevel) ? realpathSync(topLevel) : requestedRoot;
  const explicitKey = explicitRepositoryKey?.trim();

  if (!topLevel) {
    const repositoryKey = explicitKey
      ? `explicit:${sha256(explicitKey)}`
      : `local-path:${sha256(rootPath)}`;
    return {
      requested_root_path: requestedRoot,
      root_path: rootPath,
      repository_key: repositoryKey,
      git_common_dir_hash: null,
      worktree_fingerprint: `path:${sha256(rootPath)}`,
      checkpoint: {
        worktree_id: worktreeId(rootPath, `path:${rootPath}`),
        head_sha: null,
        branch: null,
        dirty: null,
        captured_at: new Date().toISOString(),
      },
    };
  }

  const commonDirOutput =
    gitOutput(rootPath, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
    ?? gitOutput(rootPath, ["rev-parse", "--git-common-dir"]);
  const gitDirOutput =
    gitOutput(rootPath, ["rev-parse", "--path-format=absolute", "--git-dir"])
    ?? gitOutput(rootPath, ["rev-parse", "--git-dir"]);
  if (!commonDirOutput || !gitDirOutput) {
    throw new CollabError(
      "git_identity_unavailable",
      "Git recognized the repository but its local identity could not be resolved",
      { root_path: rootPath },
    );
  }

  const commonDir = realpathIfPresent(resolveGitPath(rootPath, commonDirOutput));
  const gitDir = realpathIfPresent(resolveGitPath(rootPath, gitDirOutput));
  const commonDirHash = sha256(commonDir);
  const repositoryKey = explicitKey
    ? `explicit:${sha256(explicitKey)}`
    : `local-git:${commonDirHash}`;
  const fingerprint = `git:${sha256(`${commonDir}\0${gitDir}`)}`;
  const id = worktreeId(rootPath, fingerprint);

  return {
    requested_root_path: requestedRoot,
    root_path: rootPath,
    repository_key: repositoryKey,
    git_common_dir_hash: commonDirHash,
    worktree_fingerprint: fingerprint,
    checkpoint: captureRepoCheckpoint(rootPath, id),
  };
}

export function captureRepoCheckpoint(rootPath: string, id: string): RepoCheckpoint {
  const head = gitOutput(rootPath, ["rev-parse", "--verify", "HEAD"]);
  if (!head) {
    return {
      worktree_id: id,
      head_sha: null,
      branch: null,
      dirty: null,
      captured_at: new Date().toISOString(),
    };
  }
  const branch = gitOutput(rootPath, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  // Do not retain or return filenames or content. The status and untracked
  // paths are held only long enough to derive a bounded checkpoint digest.
  const pathStateBefore = gitBytes(rootPath, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  const indexDigest = gitDigest(rootPath, ["ls-files", "-s", "-z"]);
  const trackedState = gitBytes(rootPath, [
    "diff",
    "--no-ext-diff",
    "--binary",
    "HEAD",
    "--",
  ]);
  const untrackedPaths = gitBytes(rootPath, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  const untrackedDigest = untrackedPaths.ok
    ? digestUntrackedContent(rootPath, untrackedPaths.stdout)
    : null;
  const pathStateAfter = gitBytes(rootPath, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  const stablePathState =
    pathStateBefore.ok
    && pathStateAfter.ok
    && pathStateBefore.stdout.equals(pathStateAfter.stdout);
  return {
    worktree_id: id,
    head_sha: /^[0-9a-f]{40,64}$/i.test(head) ? head.toLowerCase() : null,
    branch,
    dirty: pathStateAfter.ok ? pathStateAfter.stdout.length > 0 : null,
    algorithm: "git-state/v1",
    index_sha256: indexDigest,
    state_sha256: trackedState.ok && stablePathState && untrackedDigest
      ? sha256Bytes(Buffer.concat([
          trackedState.stdout,
          Buffer.from([0]),
          pathStateAfter.stdout,
          Buffer.from([0]),
          Buffer.from(untrackedDigest, "hex"),
        ]))
      : null,
    source: "server_observed",
    captured_at: new Date().toISOString(),
  };
}

function worktreeId(rootPath: string, fingerprint: string): string {
  return `wt_${sha256(`${rootPath}\0${fingerprint}`).slice(0, 24)}`;
}

function resolveGitPath(rootPath: string, value: string): string {
  return value.startsWith("/") ? value : resolve(rootPath, value);
}

function realpathIfPresent(path: string): string {
  return existsSync(path) ? realpathSync(path) : resolve(path);
}

function gitOutput(rootPath: string, args: string[]): string | null {
  const result = runGit(rootPath, args);
  if (!result.ok) return null;
  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
}

function runGit(rootPath: string, args: string[]): { ok: boolean; stdout: string } {
  const result = spawnSync("git", ["-C", rootPath, ...args], {
    encoding: "utf8",
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: MAX_GIT_OUTPUT,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return {
    ok: result.status === 0 && !result.error,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
  };
}

function gitDigest(rootPath: string, args: string[]): string | null {
  const result = gitBytes(rootPath, args);
  return result.ok ? sha256Bytes(result.stdout) : null;
}

function gitBytes(rootPath: string, args: string[]): { ok: boolean; stdout: Buffer } {
  const result = spawnSync("git", ["-C", rootPath, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: MAX_GIT_OUTPUT,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return {
    ok: result.status === 0 && !result.error,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0),
  };
}

function digestUntrackedContent(rootPath: string, paths: Buffer): string | null {
  const entries = splitNul(paths);
  if (!entries || entries.length > MAX_UNTRACKED_FILES) return null;
  const budget = {
    remainingBytes: MAX_UNTRACKED_BYTES,
    deadline: Date.now() + MAX_UNTRACKED_HASH_MS,
  };
  const aggregate = createHash("sha256");
  aggregate.update("agenttool.collab/untracked-state/v1\0");
  for (const entry of entries) {
    if (Date.now() > budget.deadline) return null;
    if (!safeGitRelativePath(entry)) return null;
    const absolute = Buffer.concat([
      Buffer.from(rootPath),
      Buffer.from("/"),
      entry,
    ]);
    let stat;
    try {
      stat = lstatSync(absolute);
      aggregate.update(lengthPrefix(entry.length));
      aggregate.update(entry);
      if (stat.isSymbolicLink()) {
        const target = readlinkSync(absolute, { encoding: "buffer" });
        if (target.length > budget.remainingBytes || Date.now() > budget.deadline) {
          return null;
        }
        budget.remainingBytes -= target.length;
        aggregate.update("symlink\0");
        aggregate.update(lengthPrefix(target.length));
        aggregate.update(target);
      } else if (stat.isFile()) {
        const digest = digestStableFile(absolute, budget);
        if (!digest) return null;
        aggregate.update("file\0");
        aggregate.update(lengthPrefix(stat.mode & 0o111));
        aggregate.update(digest);
      } else {
        return null;
      }
    } catch {
      return null;
    }
  }
  return aggregate.digest("hex");
}

function digestStableFile(
  path: Buffer,
  budget: { remainingBytes: number; deadline: number },
): Buffer | null {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, "r");
    const before = fstatSync(descriptor);
    if (
      !before.isFile()
      || before.size > budget.remainingBytes
      || Date.now() > budget.deadline
    ) return null;
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    while (true) {
      if (Date.now() > budget.deadline) return null;
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
    const after = fstatSync(descriptor);
    if (
      before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || before.mode !== after.mode
      || before.mtimeMs !== after.mtimeMs
      || before.ctimeMs !== after.ctimeMs
    ) return null;
    budget.remainingBytes -= before.size;
    return hash.digest();
  } catch {
    return null;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

function splitNul(value: Buffer): Buffer[] | null {
  if (value.length === 0) return [];
  const entries: Buffer[] = [];
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== 0) continue;
    if (index === start) return null;
    entries.push(value.subarray(start, index));
    start = index + 1;
  }
  return start === value.length ? entries : null;
}

function safeGitRelativePath(value: Buffer): boolean {
  if (value.length === 0 || value[0] === 0x2f) return false;
  let start = 0;
  for (let index = 0; index <= value.length; index += 1) {
    if (index !== value.length && value[index] !== 0x2f) continue;
    const component = value.subarray(start, index);
    if (
      component.length === 0
      || (component.length === 1 && component[0] === 0x2e)
      || (component.length === 2 && component[0] === 0x2e && component[1] === 0x2e)
    ) return false;
    start = index + 1;
  }
  return true;
}

function lengthPrefix(value: number): Buffer {
  const prefix = Buffer.allocUnsafe(8);
  prefix.writeBigUInt64BE(BigInt(value));
  return prefix;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sha256Bytes(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
