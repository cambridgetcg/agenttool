import { spawn } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import {
  DEFAULT_ARCHIVE_MAX_BYTES,
  DEFAULT_GIT_COMMAND_TIMEOUT_MS,
  type GitCapture,
  type GitCaptureCompleteness,
  type GitRepositoryDescriptor,
  type GitRestoreResult,
  type GitSymbolicRef,
  type SignedSnapshotDescriptor,
} from "./types.js";
import { sha256Id, utf8 } from "./encoding.js";
import {
  ArchiveVerificationError,
  GitArchiveError,
  IncompleteCaptureError,
  InvalidArchiveRecordError,
  UnsafeRestoreTargetError,
} from "./errors.js";
import { verifySnapshotDescriptor } from "./records.js";

const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;
const decoder = new TextDecoder("utf-8", { fatal: true });

interface GitResult {
  stdout: Uint8Array;
  stderr: Uint8Array;
  exitCode: number;
}

interface GitObservation {
  root: string;
  objectFormat: "sha1" | "sha256";
  headRevision: string;
  branch: string | null;
  refsBytes: Uint8Array;
  refsDigest: `sha256:${string}`;
  refsCount: number;
  symbolicRefs: GitSymbolicRef[];
  statusBytes: Uint8Array;
  completeness: GitCaptureCompleteness;
}

function gitEnvironment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const path = process.env.PATH;
  if (path === undefined || path.length === 0) {
    throw new GitArchiveError("git environment", "PATH is unavailable", null);
  }
  return {
    PATH: path,
    LANG: "C",
    LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_NO_LAZY_FETCH: "1",
    GIT_LFS_SKIP_SMUDGE: "1",
    ...extra,
  };
}

async function runGit(
  cwd: string,
  args: readonly string[],
  options: {
    allowExit?: readonly number[];
    maxOutputBytes?: number;
    environment?: NodeJS.ProcessEnv;
    operation?: string;
    timeoutMs?: number;
  } = {},
): Promise<GitResult> {
  const operation = options.operation ?? `git ${args[0] ?? "operation"}`;
  const maxOutput = options.maxOutputBytes ?? MAX_GIT_OUTPUT_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_GIT_COMMAND_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new InvalidArchiveRecordError("Git command timeout must be a positive safe integer.");
  }
  const processArgs = [
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.hooksPath=/dev/null",
    ...args,
  ];
  return new Promise<GitResult>((resolveResult, rejectResult) => {
    const child = spawn("git", processArgs, {
      cwd,
      env: gitEnvironment(options.environment),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let exceeded = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > maxOutput) {
        exceeded = true;
        child.kill("SIGKILL");
      } else {
        stdout.push(chunk);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > maxOutput) {
        exceeded = true;
        child.kill("SIGKILL");
      } else {
        stderr.push(chunk);
      }
    });
    child.on("error", (cause) => {
      clearTimeout(timeout);
      rejectResult(new GitArchiveError(operation, "could not start Git", null, { cause }));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (timedOut) {
        rejectResult(new GitArchiveError(operation, "exceeded the configured time limit", code));
        return;
      }
      if (exceeded) {
        rejectResult(new GitArchiveError(operation, "output exceeded the configured byte limit", code));
        return;
      }
      const result = {
        stdout: new Uint8Array(Buffer.concat(stdout)),
        stderr: new Uint8Array(Buffer.concat(stderr)),
        exitCode: code ?? -1,
      };
      const allowed = options.allowExit ?? [0];
      if (!allowed.includes(result.exitCode)) {
        let detail = "Git returned a non-zero status";
        try {
          const stderrText = decoder.decode(result.stderr).trim();
          if (stderrText.length > 0) detail = stderrText.slice(0, 1_000);
        } catch {
          detail = "Git returned non-UTF-8 diagnostic output";
        }
        rejectResult(new GitArchiveError(operation, detail, result.exitCode));
        return;
      }
      resolveResult(result);
    });
  });
}

function text(bytes: Uint8Array, label: string): string {
  try {
    return decoder.decode(bytes);
  } catch (cause) {
    throw new GitArchiveError(label, "Git returned non-UTF-8 output", 0, { cause });
  }
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

function countStatus(status: Uint8Array): {
  staged: number;
  tracked: number;
  untracked: number;
  unmerged: number;
} {
  const records = text(status, "git status").split("\0");
  let staged = 0;
  let tracked = 0;
  let untracked = 0;
  let unmerged = 0;
  for (const record of records) {
    if (record.length === 0) continue;
    if (record.startsWith("? ")) {
      untracked += 1;
      continue;
    }
    if (record.startsWith("u ")) {
      unmerged += 1;
      continue;
    }
    if (record.startsWith("1 ") || record.startsWith("2 ")) {
      const indexState = record[2];
      const worktreeState = record[3];
      if (indexState !== "." && indexState !== " ") staged += 1;
      if (worktreeState !== "." && worktreeState !== " ") tracked += 1;
    }
  }
  return { staged, tracked, untracked, unmerged };
}

function nonEmptyLines(bytes: Uint8Array, label: string): number {
  return text(bytes, label)
    .split("\n")
    .filter((item) => item.length > 0)
    .length;
}

function gitlinkChanges(bytes: Uint8Array): number {
  let count = 0;
  for (const line of text(bytes, "Git history tree changes").split("\n")) {
    const match = /^:([0-7]{6}) ([0-7]{6}) [0-9a-f]+ [0-9a-f]+ [A-Z][0-9]*\t/u.exec(line);
    if (match?.[1] === "160000" || match?.[2] === "160000") count += 1;
  }
  return count;
}

function parseObservedRefs(bytes: Uint8Array): {
  count: number;
  symbolicRefs: GitSymbolicRef[];
} {
  const lines = text(bytes, "Git refs").split("\n").filter((line) => line.length > 0);
  const symbolicRefs: GitSymbolicRef[] = [];
  for (const line of lines) {
    const fields = line.split("\0");
    if (fields.length !== 4) {
      throw new ArchiveVerificationError("Git ref observation was malformed.");
    }
    const [ref, , , symbolicTarget] = fields;
    if (ref === undefined || symbolicTarget === undefined) {
      throw new ArchiveVerificationError("Git ref observation was incomplete.");
    }
    if (symbolicTarget.length > 0) {
      symbolicRefs.push({ ref, target: symbolicTarget });
    }
  }
  return { count: lines.length, symbolicRefs };
}

function countNonCommitRefTargets(bytes: Uint8Array): number {
  let nonCommitRefs = 0;
  for (const line of text(bytes, "Git ref target types").split("\n")) {
    if (line.length === 0) continue;
    const fields = line.split("\0");
    if (fields.length !== 2) {
      throw new ArchiveVerificationError("Git ref target-type observation was malformed.");
    }
    const [objectType, peeledObjectType] = fields;
    if (objectType === undefined || peeledObjectType === undefined) {
      throw new ArchiveVerificationError("Git ref target-type observation was incomplete.");
    }
    const targetType = objectType === "tag" ? peeledObjectType : objectType;
    if (targetType !== "commit") nonCommitRefs += 1;
  }
  return nonCommitRefs;
}

async function alternatesCount(root: string): Promise<number> {
  const result = await runGit(root, ["rev-parse", "--git-path", "objects/info/alternates"], {
    operation: "inspect Git alternates path",
  });
  const candidate = text(result.stdout, "Git alternates path").trim();
  if (candidate.length === 0) return 0;
  const path = resolve(root, candidate);
  try {
    const content = await readFile(path, "utf8");
    return content.split(/\r?\n/u).filter((line) => line.trim().length > 0).length;
  } catch (error) {
    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && error.code === "ENOENT"
    ) return 0;
    throw error;
  }
}

async function observeRepository(repositoryPath: string): Promise<GitObservation> {
  const requested = await realpath(repositoryPath);
  const rootResult = await runGit(requested, ["rev-parse", "--show-toplevel"], {
    operation: "locate Git worktree",
  });
  const root = await realpath(text(rootResult.stdout, "Git worktree root").trim());
  if (root !== requested) {
    throw new InvalidArchiveRecordError(
      "repositoryPath must name the Git worktree root, not a subdirectory.",
    );
  }

  const [
    objectFormatResult,
    headResult,
    branchResult,
    refsResult,
    refTargetTypesResult,
    statusResult,
    submoduleHistoryResult,
    lfsResult,
    filterResult,
    shallowResult,
    promisorResult,
    worktreesResult,
  ] = await Promise.all([
    runGit(root, ["rev-parse", "--show-object-format=storage"], {
      operation: "inspect Git object format",
    }),
    runGit(root, ["rev-parse", "--verify", "HEAD"], {
      operation: "resolve Git HEAD",
    }),
    runGit(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], {
      allowExit: [0, 1],
      operation: "inspect Git HEAD state",
    }),
    runGit(
      root,
      ["for-each-ref", "--format=%(refname)%00%(objectname)%00%(objecttype)%00%(symref)"],
      {
        operation: "enumerate Git refs",
      },
    ),
    runGit(
      root,
      ["for-each-ref", "--format=%(objecttype)%00%(*objecttype)"],
      {
        operation: "inspect peeled Git ref target types",
      },
    ),
    runGit(root, ["status", "--porcelain=v2", "-z", "--untracked-files=all"], {
      operation: "inspect Git workspace state",
    }),
    runGit(
      root,
      [
        "log",
        "--all",
        "--format=",
        "--raw",
        "-m",
        "--no-abbrev",
        "--no-renames",
        "--no-ext-diff",
        "--no-textconv",
        "HEAD",
      ],
      {
        operation: "inspect Git history for submodule gitlinks",
      },
    ),
    runGit(
      root,
      [
        "log",
        "--all",
        "--format=%H",
        "-m",
        "--no-ext-diff",
        "--no-textconv",
        "--text",
        "-G",
        "^version https://git-lfs.github.com/spec/v1$",
        "HEAD",
        "--",
        ".",
      ],
      { operation: "inspect Git history for LFS pointers" },
    ),
    runGit(
      root,
      [
        "log",
        "--all",
        "--format=%H",
        "-m",
        "--no-ext-diff",
        "--no-textconv",
        "--text",
        "-G",
        "filter[[:space:]]*=",
        "HEAD",
        "--",
        ".gitattributes",
        "**/.gitattributes",
      ],
      { operation: "inspect Git history for filter attributes" },
    ),
    runGit(root, ["rev-parse", "--is-shallow-repository"], {
      operation: "inspect shallow Git state",
    }),
    runGit(
      root,
      ["config", "--local", "--get-regexp", "^(extensions\\.partialClone|remote\\..*\\.promisor)$"],
      { allowExit: [0, 1], operation: "inspect partial-clone configuration" },
    ),
    runGit(root, ["worktree", "list", "--porcelain", "-z"], {
      operation: "inspect linked Git worktrees",
    }),
  ]);

  const objectFormat = text(objectFormatResult.stdout, "Git object format").trim();
  if (objectFormat !== "sha1" && objectFormat !== "sha256") {
    throw new GitArchiveError("inspect Git object format", "unsupported object format", 0);
  }
  const headRevision = text(headResult.stdout, "Git HEAD").trim();
  const branch = branchResult.exitCode === 0
    ? text(branchResult.stdout, "Git branch").trim()
    : null;
  const observedRefs = parseObservedRefs(refsResult.stdout);
  const nonCommitRefs = countNonCommitRefTargets(refTargetTypesResult.stdout);

  const status = countStatus(statusResult.stdout);
  const submodules = gitlinkChanges(submoduleHistoryResult.stdout);
  const lfsPointers = nonEmptyLines(lfsResult.stdout, "Git LFS history evidence");
  const filterAttributes = nonEmptyLines(
    filterResult.stdout,
    "Git filter-attribute history evidence",
  );
  const shallow = text(shallowResult.stdout, "Git shallow state").trim() === "true";
  const partial = promisorResult.exitCode === 0
    && text(promisorResult.stdout, "Git partial clone configuration").trim().length > 0;
  const alternates = await alternatesCount(root);
  const worktreeCount = text(worktreesResult.stdout, "Git worktrees")
    .split("\0")
    .filter((record) => record.startsWith("worktree ")).length;
  const additionalWorktrees = Math.max(0, worktreeCount - 1);

  const reasons: string[] = [];
  if (status.staged > 0) reasons.push(`${status.staged} staged change(s) are outside the Git bundle`);
  if (status.tracked > 0) reasons.push(`${status.tracked} tracked worktree change(s) are outside the Git bundle`);
  if (status.untracked > 0) reasons.push(`${status.untracked} untracked file(s) are outside the Git bundle`);
  if (status.unmerged > 0) reasons.push(`${status.unmerged} unmerged path(s) are outside the Git bundle`);
  if (submodules > 0) {
    reasons.push(
      `${submodules} committed-history gitlink evidence event(s) do not include submodule repositories`,
    );
  }
  if (lfsPointers > 0) {
    reasons.push(
      `${lfsPointers} committed-history Git LFS pointer evidence event(s) do not include LFS objects`,
    );
  }
  if (filterAttributes > 0) {
    reasons.push(
      `${filterAttributes} committed-history attributes evidence event(s) declare external Git filters`,
    );
  }
  if (shallow) reasons.push("shallow history is not a complete repository history");
  if (partial) reasons.push("partial-clone/promisor configuration may omit repository objects");
  if (alternates > 0) reasons.push(`${alternates} Git alternate object location(s) are external`);
  if (additionalWorktrees > 0) {
    reasons.push(`${additionalWorktrees} linked worktree(s) have workspace state outside this capture`);
  }
  if (nonCommitRefs > 0) {
    reasons.push(
      `${nonCommitRefs} named Git ref(s) do not peel to commits; `
      + "v0.1 cannot assess history-wide external-state evidence for direct tree or blob refs",
    );
  }

  return {
    root,
    objectFormat,
    headRevision,
    branch,
    refsBytes: refsResult.stdout,
    refsDigest: sha256Id(refsResult.stdout),
    refsCount: observedRefs.count,
    symbolicRefs: observedRefs.symbolicRefs,
    statusBytes: statusResult.stdout,
    completeness: {
      status: reasons.length === 0 ? "complete" : "incomplete",
      committed_history: "included",
      workspace: {
        included: false,
        staged_changes: status.staged,
        tracked_changes: status.tracked,
        untracked_files: status.untracked,
        unmerged_paths: status.unmerged,
      },
      submodules: {
        included: false,
        gitlink_evidence_events: submodules,
      },
      lfs: {
        included: false,
        pointer_evidence_events: lfsPointers,
      },
      external_filters: {
        included: false,
        attribute_evidence_events: filterAttributes,
      },
      shallow_clone: {
        detected: shallow,
        complete_history: !shallow,
      },
      partial_clone: {
        detected: partial,
        promised_objects_materialized: false,
      },
      alternates: {
        detected: alternates > 0,
        alternate_locations: alternates,
        objects_materialized: false,
      },
      linked_worktrees: {
        included: false,
        additional_worktrees: additionalWorktrees,
      },
      ignored_files: {
        included: false,
        assessed: false,
      },
      reasons,
    },
  };
}

function assertStable(before: GitObservation, after: GitObservation): void {
  if (
    before.root !== after.root
    || before.objectFormat !== after.objectFormat
    || before.headRevision !== after.headRevision
    || before.branch !== after.branch
    || !equal(before.refsBytes, after.refsBytes)
    || !equal(before.statusBytes, after.statusBytes)
    || JSON.stringify(before.completeness) !== JSON.stringify(after.completeness)
  ) {
    throw new ArchiveVerificationError(
      "Repository refs, HEAD, workspace, or completeness evidence changed during capture; no snapshot was sealed.",
    );
  }
}

function parseBundleHeads(bytes: Uint8Array): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of text(bytes, "Git bundle heads").split("\n")) {
    if (line.length === 0) continue;
    const separator = line.indexOf(" ");
    if (separator < 1) {
      throw new ArchiveVerificationError("Git bundle returned a malformed head listing.");
    }
    result.set(line.slice(separator + 1), line.slice(0, separator));
  }
  return result;
}

function expectedRefMap(bytes: Uint8Array): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of text(bytes, "Git refs").split("\n")) {
    if (line.length === 0) continue;
    const fields = line.split("\0");
    if (fields.length !== 4) {
      throw new ArchiveVerificationError("Git ref observation was malformed.");
    }
    result.set(fields[0]!, fields[1]!);
  }
  return result;
}

export interface CaptureGitRepositoryOptions {
  repositoryPath: string;
  repositoryId?: string;
  allowIncomplete?: boolean;
  maxBytes?: number;
}

export async function captureGitRepository(
  options: CaptureGitRepositoryOptions,
): Promise<GitCapture> {
  const maximum = options.maxBytes ?? DEFAULT_ARCHIVE_MAX_BYTES;
  if (!Number.isSafeInteger(maximum) || maximum < 1) {
    throw new InvalidArchiveRecordError("capture maxBytes must be a positive safe integer.");
  }
  const before = await observeRepository(options.repositoryPath);
  if (before.completeness.status === "incomplete" && options.allowIncomplete !== true) {
    throw new IncompleteCaptureError(before.completeness.reasons);
  }

  const staging = await mkdtemp(join(await realpath(tmpdir()), "agent-repo-archive-capture-"));
  const bundlePath = join(staging, "repository.bundle");
  try {
    await runGit(
      before.root,
      ["bundle", "create", bundlePath, "--all", "HEAD"],
      { operation: "create Git bundle", maxOutputBytes: 1024 * 1024 },
    );
    await chmod(bundlePath, 0o600);
    const bundleStat = await stat(bundlePath);
    if (!Number.isSafeInteger(bundleStat.size) || bundleStat.size < 1 || bundleStat.size > maximum) {
      throw new ArchiveVerificationError(`Git bundle exceeds capture maxBytes (${maximum}).`);
    }
    await runGit(before.root, ["bundle", "verify", bundlePath], {
      operation: "verify captured Git bundle",
      maxOutputBytes: 8 * 1024 * 1024,
    });
    const listResult = await runGit(before.root, ["bundle", "list-heads", bundlePath], {
      operation: "enumerate captured Git bundle heads",
    });
    const bundleHeads = parseBundleHeads(listResult.stdout);
    for (const [ref, oid] of expectedRefMap(before.refsBytes)) {
      if (bundleHeads.get(ref) !== oid) {
        throw new ArchiveVerificationError(`Git bundle does not contain observed ref ${ref}.`);
      }
    }
    if (bundleHeads.get("HEAD") !== before.headRevision) {
      throw new ArchiveVerificationError("Git bundle does not preserve the exact observed HEAD.");
    }

    const after = await observeRepository(before.root);
    assertStable(before, after);
    const bundle = new Uint8Array(await readFile(bundlePath));
    const repositoryId = options.repositoryId
      ?? `repo:local:${sha256Id(utf8(before.root)).slice("sha256:".length)}`;
    const repository: GitRepositoryDescriptor = {
      repository_id: repositoryId,
      object_format: before.objectFormat,
      head_revision: before.headRevision,
      head_kind: before.branch === null ? "detached" : "branch",
      branch: before.branch,
      symbolic_refs: before.symbolicRefs,
      refs_digest: before.refsDigest,
      refs_count: before.refsCount,
    };
    return {
      repository,
      completeness: before.completeness,
      bundle,
      payload: {
        format: "git-bundle",
        bundle_version: "v2-or-v3",
        digest: sha256Id(bundle),
        bytes: bundle.byteLength,
      },
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

interface FreshRestoreTarget {
  target: string;
  parent: string;
  parentDevice: number;
  parentInode: number;
}

async function assertFreshCanonicalTarget(targetPath: string): Promise<FreshRestoreTarget> {
  const absolute = resolve(targetPath);
  const parent = dirname(absolute);
  const canonicalParent = await realpath(parent).catch((cause) => {
    throw new UnsafeRestoreTargetError("Restore target parent must already exist.", { cause });
  });
  if (canonicalParent !== parent) {
    throw new UnsafeRestoreTargetError("Restore target ancestors must not traverse symbolic links.");
  }
  const parentStat = await stat(canonicalParent);
  if (!parentStat.isDirectory()) {
    throw new UnsafeRestoreTargetError("Restore target parent must be a directory.");
  }
  const canonicalTarget = join(canonicalParent, basename(absolute));
  try {
    await lstat(canonicalTarget);
    throw new UnsafeRestoreTargetError("Restore target must not already exist.");
  } catch (error) {
    if (error instanceof UnsafeRestoreTargetError) throw error;
    if (
      typeof error !== "object"
      || error === null
      || !("code" in error)
      || error.code !== "ENOENT"
    ) throw error;
  }
  return {
    target: canonicalTarget,
    parent: canonicalParent,
    parentDevice: parentStat.dev,
    parentInode: parentStat.ino,
  };
}

async function assertTargetAnchorUnchanged(anchor: FreshRestoreTarget): Promise<void> {
  const canonicalParent = await realpath(anchor.parent).catch((cause) => {
    throw new UnsafeRestoreTargetError(
      "Restore target parent changed while the repository was being verified.",
      { cause },
    );
  });
  const parentStat = await stat(canonicalParent);
  if (
    canonicalParent !== anchor.parent
    || !parentStat.isDirectory()
    || parentStat.dev !== anchor.parentDevice
    || parentStat.ino !== anchor.parentInode
  ) {
    throw new UnsafeRestoreTargetError(
      "Restore target parent changed while the repository was being verified.",
    );
  }
  try {
    await lstat(anchor.target);
    throw new UnsafeRestoreTargetError("Restore target was claimed by another process.");
  } catch (error) {
    if (error instanceof UnsafeRestoreTargetError) throw error;
    if (
      typeof error !== "object"
      || error === null
      || !("code" in error)
      || error.code !== "ENOENT"
    ) throw error;
  }
}

async function refsDigestForRestoredRepository(path: string): Promise<{
  digest: `sha256:${string}`;
  count: number;
}> {
  const refs = await runGit(
    path,
    ["for-each-ref", "--format=%(refname)%00%(objectname)%00%(objecttype)%00%(symref)"],
    {
      operation: "inspect restored Git refs",
    },
  );
  const content = text(refs.stdout, "Restored Git refs");
  return {
    digest: sha256Id(refs.stdout),
    count: content.length === 0
      ? 0
      : content.split("\n").filter((line) => line.length > 0).length,
  };
}

export async function restoreGitBundle(
  bundleValue: Uint8Array,
  descriptorValue: SignedSnapshotDescriptor,
  targetPath: string,
): Promise<GitRestoreResult> {
  if (!(bundleValue instanceof Uint8Array) || bundleValue.byteLength < 1) {
    throw new InvalidArchiveRecordError("restore Git bundle must be non-empty bytes.");
  }
  const descriptor = verifySnapshotDescriptor(descriptorValue);
  if (
    bundleValue.byteLength !== descriptor.payload.bytes
    || sha256Id(bundleValue) !== descriptor.payload.digest
  ) {
    throw new ArchiveVerificationError(
      "Restore Git bundle bytes do not match the signed SnapshotDescriptor.",
    );
  }
  const target = await assertFreshCanonicalTarget(targetPath);
  const staging = await mkdtemp(join(await realpath(tmpdir()), "agent-repo-archive-restore-"));
  const bundlePath = join(staging, "repository.bundle");
  const verifierPath = join(staging, "verify.git");
  const templatePath = join(staging, "empty-template");
  const restoredPath = join(staging, "restored.git");
  try {
    await writeFile(bundlePath, bundleValue, { flag: "wx", mode: 0o600 });
    await mkdir(templatePath, { mode: 0o700 });
    await mkdir(verifierPath, { mode: 0o700 });
    await runGit(
      verifierPath,
      [
        "init",
        "--quiet",
        "--bare",
        `--object-format=${descriptor.repository.object_format}`,
        `--template=${templatePath}`,
      ],
      {
        operation: "initialize isolated Git bundle verifier",
        environment: { HOME: staging, GIT_TEMPLATE_DIR: templatePath },
      },
    );
    await runGit(verifierPath, ["bundle", "verify", bundlePath], {
      operation: "verify recovered Git bundle",
      environment: { HOME: staging, GIT_TEMPLATE_DIR: templatePath },
    });

    await mkdir(restoredPath, { mode: 0o700 });
    await runGit(
      restoredPath,
      [
        "init",
        "--quiet",
        `--object-format=${descriptor.repository.object_format}`,
        `--template=${templatePath}`,
      ],
      {
        operation: "initialize private no-checkout restore",
        environment: { HOME: staging, GIT_TEMPLATE_DIR: templatePath },
      },
    );
    const fetchPrefix = [
      "-c",
      "fetch.fsckObjects=true",
      "-c",
      "transfer.fsckObjects=true",
      "-c",
      "fetch.unpackLimit=1",
      "fetch",
      "--quiet",
      "--force",
      "--update-head-ok",
      "--no-tags",
      "--no-write-fetch-head",
      bundlePath,
    ] as const;
    if (descriptor.repository.refs_count > 0) {
      await runGit(
        restoredPath,
        [...fetchPrefix, "+refs/*:refs/*"],
        {
          operation: "import all Git bundle refs",
          environment: { HOME: staging, GIT_TEMPLATE_DIR: templatePath },
          maxOutputBytes: 8 * 1024 * 1024,
        },
      );
    }
    for (const symbolicRef of descriptor.repository.symbolic_refs) {
      await runGit(restoredPath, ["check-ref-format", symbolicRef.ref], {
        operation: "validate restored symbolic ref name",
        environment: { HOME: staging, GIT_TEMPLATE_DIR: templatePath },
      });
      await runGit(restoredPath, ["check-ref-format", symbolicRef.target], {
        operation: "validate restored symbolic ref target",
        environment: { HOME: staging, GIT_TEMPLATE_DIR: templatePath },
      });
      const targetExists = await runGit(
        restoredPath,
        ["show-ref", "--verify", "--quiet", symbolicRef.target],
        {
          allowExit: [0, 1],
          operation: "resolve restored symbolic ref target",
          environment: { HOME: staging, GIT_TEMPLATE_DIR: templatePath },
        },
      );
      if (targetExists.exitCode !== 0) {
        throw new ArchiveVerificationError(
          `Restored symbolic ref ${symbolicRef.ref} has no captured target.`,
        );
      }
      await runGit(restoredPath, ["symbolic-ref", symbolicRef.ref, symbolicRef.target], {
        operation: "restore named symbolic ref",
        environment: { HOME: staging, GIT_TEMPLATE_DIR: templatePath },
      });
    }
    let internalHeadRef: string | null = null;
    if (descriptor.repository.head_kind === "detached") {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const candidate = `refs/agent-repo-archive/recovered-head-${globalThis.crypto.randomUUID()}`;
        const exists = await runGit(
          restoredPath,
          ["show-ref", "--verify", "--quiet", candidate],
          {
            allowExit: [0, 1],
            operation: "reserve internal detached-HEAD ref",
            environment: { HOME: staging, GIT_TEMPLATE_DIR: templatePath },
          },
        );
        if (exists.exitCode === 1) {
          internalHeadRef = candidate;
          break;
        }
      }
      if (internalHeadRef === null) {
        throw new ArchiveVerificationError("Could not reserve a collision-free recovery ref.");
      }
      await runGit(
        restoredPath,
        [...fetchPrefix, `+HEAD:${internalHeadRef}`],
        {
          operation: "import detached Git bundle HEAD",
          environment: { HOME: staging, GIT_TEMPLATE_DIR: templatePath },
          maxOutputBytes: 8 * 1024 * 1024,
        },
      );
    }
    if (descriptor.repository.head_kind === "branch") {
      const branch = descriptor.repository.branch;
      if (branch === null) {
        throw new ArchiveVerificationError("Attached SnapshotDescriptor has no branch.");
      }
      await runGit(restoredPath, ["check-ref-format", "--branch", branch], {
        operation: "validate restored Git branch",
        environment: { HOME: staging, GIT_TEMPLATE_DIR: templatePath },
      });
      const branchRef = `refs/heads/${branch}`;
      const branchHead = await runGit(restoredPath, ["rev-parse", "--verify", branchRef], {
        operation: "resolve restored Git branch",
        environment: { HOME: staging, GIT_TEMPLATE_DIR: templatePath },
      });
      if (text(branchHead.stdout, "Restored Git branch").trim() !== descriptor.repository.head_revision) {
        throw new ArchiveVerificationError("Restored branch does not match captured HEAD.");
      }
      await runGit(restoredPath, ["symbolic-ref", "HEAD", branchRef], {
        operation: "restore attached Git HEAD",
        environment: { HOME: staging, GIT_TEMPLATE_DIR: templatePath },
      });
    } else {
      await runGit(
        restoredPath,
        ["update-ref", "--no-deref", "HEAD", descriptor.repository.head_revision],
        {
          operation: "restore detached Git HEAD",
          environment: { HOME: staging, GIT_TEMPLATE_DIR: templatePath },
        },
      );
    }
    if (internalHeadRef !== null) {
      await runGit(restoredPath, ["update-ref", "-d", internalHeadRef], {
        operation: "remove internal recovery ref",
        environment: { HOME: staging, GIT_TEMPLATE_DIR: templatePath },
      });
    }

    const restoredRefs = await refsDigestForRestoredRepository(restoredPath);
    if (
      restoredRefs.digest !== descriptor.repository.refs_digest
      || restoredRefs.count !== descriptor.repository.refs_count
    ) {
      throw new ArchiveVerificationError("Restored Git ref set does not match SnapshotDescriptor.");
    }
    await runGit(restoredPath, ["fsck", "--full", "--strict", "--no-reflogs"], {
      operation: "fsck restored Git repository",
      environment: { HOME: staging, GIT_TEMPLATE_DIR: templatePath },
      maxOutputBytes: 16 * 1024 * 1024,
    });
    const restoredHead = await runGit(restoredPath, ["rev-parse", "--verify", "HEAD"], {
      operation: "resolve restored Git HEAD",
      environment: { HOME: staging, GIT_TEMPLATE_DIR: templatePath },
    });
    const restoredRevision = text(restoredHead.stdout, "Restored Git HEAD").trim();
    if (restoredRevision !== descriptor.repository.head_revision) {
      throw new ArchiveVerificationError("Restored Git HEAD differs from SnapshotDescriptor.");
    }
    await assertTargetAnchorUnchanged(target);
    await rename(restoredPath, target.target);
    return {
      targetPath: target.target,
      restoredHead: restoredRevision,
    };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function inspectGitRefDigest(path: string): Promise<{
  head: string;
  refsDigest: `sha256:${string}`;
  refsCount: number;
}> {
  const root = await realpath(path);
  const [headResult, refs] = await Promise.all([
    runGit(root, ["rev-parse", "--verify", "HEAD"], { operation: "inspect restored HEAD" }),
    refsDigestForRestoredRepository(root),
  ]);
  return {
    head: text(headResult.stdout, "Restored HEAD").trim(),
    refsDigest: refs.digest,
    refsCount: refs.count,
  };
}
