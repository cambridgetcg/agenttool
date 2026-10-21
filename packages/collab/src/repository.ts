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
import { spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from "node:child_process";
import { CollabError } from "./errors.js";
import type { RepoCheckpoint } from "./protocol.js";

const GIT_TIMEOUT_MS = 5_000;
const MAX_GIT_OUTPUT = 1024 * 1024;
const MAX_UNTRACKED_FILES = 10_000;
const MAX_UNTRACKED_BYTES = 64 * 1024 * 1024;
const MAX_UNTRACKED_HASH_MS = 2_000;
const MAX_SUCCESSOR_PATHS = 128;
const MAX_SUCCESSOR_BYTES = 64 * 1024 * 1024;
const MAX_SUCCESSOR_INSPECT_MS = 5_000;
const GIT_OBJECT_ID = /^[0-9a-f]{40,64}$/;
const RAW_DIFF_HEADER = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) ([A-Z])$/;

/** Local discovery bounds; injected clock/process runner keep deadline tests deterministic. */
export interface RepositoryProbeOptions {
  deadline?: number;
  now?: () => number;
  spawn?: (args: string[], options: SpawnSyncOptions) => SpawnSyncReturns<string | Buffer>;
}

export class RepositoryProbeTimeout extends Error {
  constructor() { super("Repository discovery exhausted its Git time budget"); }
}

export interface RepositoryIdentity {
  requested_root_path: string;
  root_path: string;
  repository_key: string;
  /** Portable routing alias; physical keys stay stable for older clients. */
  portable_repository_key?: string | null;
  git_common_dir_hash: string | null;
  worktree_fingerprint: string;
  checkpoint: RepoCheckpoint;
}

export interface SuccessorCommitChange {
  /** Repository-relative path exactly as Git records it. */
  path: string;
  /** SHA-256 of the committed blob bytes; null for a deletion or a non-regular entry. */
  blob_sha256: string | null;
}

export type SuccessorCommitInspection =
  | { ok: true; commit_sha: string; parent_sha: string; changes: SuccessorCommitChange[] }
  | { ok: false; commit_sha: string; reason: string };

export function inspectRepository(
  rootInput: string,
  explicitRepositoryKey?: string,
  metadataOnly = false,
  options: RepositoryProbeOptions & { portable?: boolean } = {},
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
  const topLevel = gitOutput(requestedRoot, ["rev-parse", "--show-toplevel"], options);
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
    gitOutput(rootPath, ["rev-parse", "--path-format=absolute", "--git-common-dir"], options)
    ?? gitOutput(rootPath, ["rev-parse", "--git-common-dir"], options);
  const gitDirOutput =
    gitOutput(rootPath, ["rev-parse", "--path-format=absolute", "--git-dir"], options)
    ?? gitOutput(rootPath, ["rev-parse", "--git-dir"], options);
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
    portable_repository_key: explicitKey || options.portable === false ? null : portableRepositoryKey(rootPath, options),
    git_common_dir_hash: commonDirHash,
    worktree_fingerprint: fingerprint,
    checkpoint: metadataOnly
      ? { worktree_id: id, head_sha: null, branch: null, dirty: null, captured_at: new Date().toISOString() }
      : captureRepoCheckpoint(rootPath, id),
  };
}

/** Local Git config/object inspection only; no transport or credential helper.
 * Ambiguous, incomplete or unrelated histories retain their physical identity.
 * A bounded probe throws RepositoryProbeTimeout instead of a negative result.
 */
export function portableRepositoryKey(rootPath: string, optionsOrDeadline: RepositoryProbeOptions | number = {}): string | null {
  // Keep the original numeric-deadline call shape available to library callers.
  const options = typeof optionsOrDeadline === "number" ? { deadline: optionsOrDeadline } : optionsOrDeadline;
  // Avoid walking history at all for roots without a usable remote.
  const origin = gitOutput(rootPath, ["config", "--get-all", "remote.origin.url"], options);
  const remote = origin ?? gitOutput(rootPath, ["config", "--get-all", "remote.github.url"], options);
  const canonical = remote ? canonicalRepositoryRemote(remote) : null;
  if (!canonical || gitOutput(rootPath, ["rev-parse", "--is-shallow-repository"], options) !== "false") return null;
  const roots = successorGit(rootPath, ["rev-list", "--max-parents=0", "HEAD"], MAX_GIT_OUTPUT, options);
  if (roots.timed_out && options.deadline !== undefined) throw new RepositoryProbeTimeout();
  if (!roots.ok) return null;
  const root = roots.stdout.toString("utf8").trim();
  if (!GIT_OBJECT_ID.test(root)) return null;
  return `git-root-remote:v1:${sha256(`${root}\0${canonical}`)}`;
}

export function canonicalRepositoryRemote(value: string): string | null {
  if (/[\s\x00-\x1f\x7f]/.test(value) || value.includes("::")
    || (value.includes("://") && !/^(https?|ssh|git):\/\//i.test(value))) return null;
  let host: string;
  let path: string;
  let port = "";
  try {
    if (/^(https?|ssh|git):\/\//i.test(value)) {
      const url = new URL(value);
      if (url.search || url.hash) return null;
      host = url.hostname.toLowerCase();
      path = url.pathname;
      port = url.port && !((url.protocol === "ssh:" && url.port === "22")
        || (url.protocol === "git:" && url.port === "9418")) ? `:${url.port}` : "";
    } else {
      const scp = /^(?:[^/@:]+@)?([^/:]+):(.+)$/.exec(value);
      if (!scp) return null;
      host = scp[1]!.toLowerCase();
      path = scp[2]!;
    }
    path = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
    if (!host || !path || path.split("/").some(part => !part || part === "." || part === "..")
      || /[%\\?#]/.test(path)) return null;
    // Credentials/usernames never participate or leave this function.
    return `${host}${port}/${path.toLowerCase()}`;
  } catch {
    return null;
  }
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

/**
 * Server-side Git facts about a commit that may directly follow a result
 * checkpoint's HEAD: its parents, the paths it changes against that parent, and
 * the SHA-256 of each committed regular-file blob. Read-only plumbing, bounded
 * in paths, bytes and time. Paths go back to the caller for an in-memory
 * comparison; nothing here is journaled.
 */
export function inspectSuccessorCommit(
  rootPath: string,
  commitSha: string,
  parentSha: string,
): SuccessorCommitInspection {
  const refuse = (reason: string): SuccessorCommitInspection => ({
    ok: false,
    commit_sha: commitSha,
    reason,
  });
  if (!GIT_OBJECT_ID.test(commitSha) || !GIT_OBJECT_ID.test(parentSha)) {
    return refuse("The checkpoint HEADs are not Git object IDs");
  }
  // Parents come from the commit object itself. Grafts, a commit-graph and
  // replace refs can each make a later commit look like one fast-forward.
  const commitObject = successorGit(rootPath, ["cat-file", "commit", commitSha]);
  if (!commitObject.ok) return refuse(`Git could not read commit ${commitSha}`);
  const headerEnd = commitObject.stdout.indexOf("\n\n");
  const parents = commitObject.stdout
    .subarray(0, headerEnd === -1 ? commitObject.stdout.length : headerEnd)
    .toString("utf8")
    .split("\n")
    .filter((line) => line.startsWith("parent "))
    .map((line) => line.slice("parent ".length));
  if (parents.length > 1) {
    return refuse(`HEAD ${commitSha} is a merge commit, not one fast-forward commit`);
  }
  if (parents[0] !== parentSha) {
    const descends = successorGitExitCode(rootPath, [
      "merge-base",
      "--is-ancestor",
      parentSha,
      commitSha,
    ]) === 0;
    return refuse(descends
      ? `HEAD ${commitSha} is more than one commit ahead of the result checkpoint HEAD ${parentSha}`
      : `HEAD ${commitSha} does not descend from the result checkpoint HEAD ${parentSha}`);
  }
  const diff = successorGit(rootPath, [
    "diff-tree",
    "-r",
    "-z",
    "--raw",
    "--no-renames",
    // A submodule ignore setting would otherwise hide a gitlink change.
    "--ignore-submodules=none",
    parentSha,
    commitSha,
    "--",
  ]);
  const fields = diff.ok ? splitNul(diff.stdout) : null;
  if (!fields || fields.length % 2 !== 0) {
    return refuse(`Git could not list the paths commit ${commitSha} changes`);
  }
  if (fields.length / 2 > MAX_SUCCESSOR_PATHS) {
    return refuse(`Commit ${commitSha} changes more than ${MAX_SUCCESSOR_PATHS} paths`);
  }
  const budget = { bytes: MAX_SUCCESSOR_BYTES, deadline: Date.now() + MAX_SUCCESSOR_INSPECT_MS };
  const changes: SuccessorCommitChange[] = [];
  for (let index = 0; index < fields.length; index += 2) {
    const header = RAW_DIFF_HEADER.exec(fields[index]!.toString("utf8"));
    const pathBytes = fields[index + 1]!;
    if (!header || !safeGitRelativePath(pathBytes)) {
      return refuse(`Git reported a change in commit ${commitSha} that cannot be read safely`);
    }
    const path = pathBytes.toString("utf8");
    const [, oldMode, mode, , blob, status] = header;
    // A changed mode or type is refused even when the blob is byte-identical:
    // no artifact vouches for the exec bit, and a symlink/submodule/etc. that
    // newly lands at a regular mode is not "the file the task attached".
    const modeVouched = status === "A" || (status === "M" && oldMode === mode);
    if (status === "D" || (mode !== "100644" && mode !== "100755") || !modeVouched) {
      changes.push({ path, blob_sha256: null });
      continue;
    }
    if (Date.now() > budget.deadline || budget.bytes <= 0) {
      return refuse(`Inspecting commit ${commitSha} exceeded its bounds`);
    }
    const content = successorGit(rootPath, ["cat-file", "blob", blob!], budget.bytes);
    if (!content.ok) {
      return refuse(`Git could not read the committed bytes of ${path} within the inspection bounds`);
    }
    budget.bytes -= content.stdout.length;
    changes.push({ path, blob_sha256: sha256Bytes(content.stdout) });
  }
  return { ok: true, commit_sha: commitSha, parent_sha: parentSha, changes };
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

function gitOutput(rootPath: string, args: string[], options: RepositoryProbeOptions = {}): string | null {
  const result = runGit(rootPath, args, options);
  if (result.timed_out && options.deadline !== undefined) throw new RepositoryProbeTimeout();
  if (!result.ok) return null;
  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
}

function runGit(rootPath: string, args: string[], options: RepositoryProbeOptions): { ok: boolean; timed_out: boolean; stdout: string } {
  const timeout = gitTimeout(options);
  if (timeout <= 0) return { ok: false, timed_out: true, stdout: "" };
  const result = spawnRepositoryGit(["-C", rootPath, ...args], {
    encoding: "utf8",
    timeout,
    maxBuffer: MAX_GIT_OUTPUT,
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  }, options);
  return {
    ok: result.status === 0 && !result.error,
    timed_out: (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT",
    stdout: typeof result.stdout === "string" ? result.stdout : "",
  };
}

function gitDigest(rootPath: string, args: string[]): string | null {
  const result = gitBytes(rootPath, args);
  return result.ok ? sha256Bytes(result.stdout) : null;
}

function gitBytes(
  rootPath: string,
  args: string[],
  maxBuffer = MAX_GIT_OUTPUT,
): { ok: boolean; stdout: Buffer } {
  const result = spawnSync("git", ["-C", rootPath, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return {
    ok: result.status === 0 && !result.error,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0),
  };
}

/**
 * Git for successor inspection: the real object graph only. Replace refs,
 * grafts and the commit-graph are each switched off, because each can change
 * what a commit's parents appear to be.
 */
const SUCCESSOR_GIT_ARGS = ["-c", "core.commitGraph=false", "--no-replace-objects"];

function successorGitEnv(): NodeJS.ProcessEnv {
  return { ...process.env, GIT_GRAFT_FILE: "/dev/null/agenttool-collab-no-grafts" };
}

function successorGit(
  rootPath: string,
  args: string[],
  maxBuffer = MAX_GIT_OUTPUT,
  options: RepositoryProbeOptions = {},
): { ok: boolean; timed_out: boolean; stdout: Buffer } {
  const timeout = gitTimeout(options);
  if (timeout <= 0) return { ok: false, timed_out: true, stdout: Buffer.alloc(0) };
  const result = spawnRepositoryGit(["-C", rootPath, ...SUCCESSOR_GIT_ARGS, ...args], {
    timeout,
    maxBuffer,
    stdio: ["ignore", "pipe", "ignore"],
    env: successorGitEnv(),
  }, options);
  return {
    ok: result.status === 0 && !result.error,
    timed_out: (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT",
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0),
  };
}

function spawnRepositoryGit(args: string[], options: SpawnSyncOptions, probe: RepositoryProbeOptions) {
  return probe.spawn ? probe.spawn(args, options) : spawnSync("git", args, options);
}

function gitTimeout(options: RepositoryProbeOptions): number {
  return options.deadline === undefined ? GIT_TIMEOUT_MS
    : Math.min(GIT_TIMEOUT_MS, Math.ceil(options.deadline - (options.now ?? (() => performance.now()))()));
}

function successorGitExitCode(rootPath: string, args: string[]): number | null {
  const result = spawnSync("git", ["-C", rootPath, ...SUCCESSOR_GIT_ARGS, ...args], {
    timeout: GIT_TIMEOUT_MS,
    stdio: ["ignore", "ignore", "ignore"],
    env: successorGitEnv(),
  });
  return result.error ? null : result.status;
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
