#!/usr/bin/env bun
// @bun

// src/host.ts
import { existsSync as existsSync5 } from "fs";
import { parseArgs as parseArgs2 } from "util";

// src/database-path.ts
import { homedir } from "os";
import { isAbsolute, join, resolve } from "path";
function defaultDatabasePath(env = process.env) {
  const dataHome = env.XDG_DATA_HOME;
  const base = dataHome ? isAbsolute(dataHome) ? dataHome : resolve(dataHome) : join(homedir(), ".local", "share");
  return join(base, "agenttool", "collab.sqlite");
}
function resolveDatabasePath(env = process.env) {
  return env.AGENTOOL_COLLAB_DB ?? defaultDatabasePath(env);
}

// src/errors.ts
class CollabError extends Error {
  code;
  details;
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = "CollabError";
  }
}

// src/protocol.ts
var COLLAB_PROTOCOL = "agenttool.collab/0.1";
var LEGACY_COLLAB_PROTOCOL = COLLAB_PROTOCOL;
var COLLAB_COORDINATION_PROTOCOL = "agenttool.collab/0.2";
var COLLAB_SESSION_PROTOCOL = "agenttool.collab.session/0.1";
var SESSION_STALE_AFTER_MS = 6 * 60 * 60 * 1000;
var EVIDENCE_REF_PREFIXES = ["artifact:", "event:", "report:", "checkpoint:"];
var EVIDENCE_REFS_DESCRIPTION = "Evidence references point inside this workspace's journal and start with artifact:, event:, " + "report:, or checkpoint: (a task's base_checkpoint_digest or result_checkpoint_digest), " + 'for example "artifact:artifact_<id>".';
var CONSENT_RULE = "consent/v1";
var PROPOSAL_BYTES_PROTOCOL = "agenttool.collab-proposal/1";
var DEFAULT_PROPOSAL_CONSULT_SECONDS = 6 * 60 * 60;
var MIN_PROPOSAL_CONSULT_SECONDS = 10 * 60;
var MAX_PROPOSAL_CONSULT_SECONDS = 7 * 24 * 60 * 60;
var PERSON_ACT_PROTOCOL = "agenttool.collab-person-act/1";
var DEFAULT_WAIT_EVENT_LIMIT = 10;
var MAX_WAIT_EVENT_LIMIT = 50;
var MAX_WAIT_PAGE_BYTES = 256 * 1024;
var MAX_WAIT_RESPONSE_BYTES = 1024 * 1024;
var MAX_WAIT_ANCHOR_BYTES = 8 * 1024 * 1024;

// src/session-file.ts
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "fs";
import { dirname, resolve as resolve2 } from "path";
function readSessionCredentialFile(pathInput) {
  const path = resolve2(pathInput);
  try {
    assertPrivateDirectory(dirname(path));
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || !isOwnedByCurrentUser(stat.uid)) {
      throw new CollabError("session_file_unsafe", "Session credential path must be a private regular file owned by this user", { operation: "read_session_credential_file" });
    }
    if ((stat.mode & 63) !== 0) {
      throw new CollabError("session_file_not_private", "Session credential file must not be accessible by group or other users", { operation: "read_session_credential_file" });
    }
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (parsed.format !== "agenttool.collab/session-file/1" || typeof parsed.session_id !== "string" || typeof parsed.session_token !== "string" || !Number.isInteger(parsed.generation) || parsed.generation < 1 || parsed.last_cursor !== undefined && (typeof parsed.last_cursor?.epoch_id !== "string" || !Number.isInteger(parsed.last_cursor?.sequence) || parsed.last_cursor.sequence < 0 || typeof parsed.last_cursor?.hash !== "string" || !/^[a-f0-9]{64}$/.test(parsed.last_cursor.hash))) {
      throw new CollabError("session_file_invalid", "Session credential file has an unsupported or malformed format", { operation: "read_session_credential_file" });
    }
    return {
      session_id: parsed.session_id,
      session_token: parsed.session_token,
      generation: parsed.generation,
      last_cursor: parsed.last_cursor
    };
  } catch (error) {
    if (error instanceof CollabError)
      throw error;
    throw new CollabError("session_file_read_failed", "Could not read the local session credential file", { operation: "read_session_credential_file" });
  }
}
function removeSessionCredentialFile(pathInput) {
  const path = resolve2(pathInput);
  try {
    if (!existsSync(path))
      return;
    assertPrivateDirectory(dirname(path));
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || !isOwnedByCurrentUser(stat.uid)) {
      throw new CollabError("session_file_unsafe", "Refusing to remove a non-regular session credential path", { operation: "remove_session_credential_file" });
    }
    unlinkSync(path);
  } catch (error) {
    if (error instanceof CollabError)
      throw error;
    throw new CollabError("session_file_remove_failed", "The session ended, but its revoked local credential file could not be removed", { operation: "remove_session_credential_file" });
  }
}
function assertPrivateDirectory(path) {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !isOwnedByCurrentUser(stat.uid) || (stat.mode & 63) !== 0) {
    throw new CollabError("session_directory_not_private", "Session credential directory must be a private non-symlink directory owned by this user", { operation: "validate_session_credential_directory" });
  }
}
function isOwnedByCurrentUser(uid) {
  return typeof process.getuid !== "function" || uid === process.getuid();
}

// src/store.ts
import { Database } from "bun:sqlite";
import { createHash as createHash3, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import {
  chmodSync as chmodSync2,
  closeSync as closeSync3,
  existsSync as existsSync3,
  lstatSync as lstatSync3,
  mkdirSync as mkdirSync2,
  openSync as openSync3
} from "fs";
import { dirname as dirname2, isAbsolute as isAbsolute2, join as join2, posix, resolve as resolve4 } from "path";

// src/canonical.ts
function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}
function sortValue(value) {
  if (Array.isArray(value))
    return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, child]) => [key, sortValue(child)]);
    return Object.fromEntries(entries);
  }
  return value;
}

// src/passkey.ts
import { createHash, createPublicKey, verify } from "crypto";
var FLAG_USER_PRESENT = 1;
var FLAG_USER_VERIFIED = 4;
var BASE64URL = /^[A-Za-z0-9_-]*$/;
function base64urlDecode(value, field, maxBytes = 64 * 1024) {
  if (typeof value !== "string" || !BASE64URL.test(value) || value.length === 0) {
    throw new CollabError("passkey_assertion_invalid", `${field} must be non-empty base64url`);
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length > maxBytes) {
    throw new CollabError("passkey_assertion_invalid", `${field} exceeds ${maxBytes} bytes`);
  }
  return bytes;
}
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest();
}
function personActChallenge(input) {
  const challenge_bytes = canonicalJson({ protocol: PERSON_ACT_PROTOCOL, ...input });
  return { challenge_bytes, challenge: sha256(challenge_bytes).toString("base64url") };
}
function parsePasskeyPublicKey(spki) {
  const der = base64urlDecode(spki, "public_key_spki", 1024);
  let key;
  try {
    key = createPublicKey({ key: der, format: "der", type: "spki" });
  } catch {
    throw new CollabError("passkey_key_invalid", "public_key_spki is not a DER SubjectPublicKeyInfo");
  }
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
    throw new CollabError("passkey_key_invalid", "Only ES256 (P-256) passkeys are supported");
  }
  return key;
}
function passkeyFingerprint(spki) {
  return sha256(base64urlDecode(spki, "public_key_spki", 1024)).toString("hex");
}
function validatePasskeyScope(rpId, origin) {
  if (typeof rpId !== "string" || !/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/.test(rpId)) {
    throw new CollabError("passkey_scope_invalid", "rp_id must be a lowercase host name");
  }
  let url;
  try {
    url = new URL(String(origin));
  } catch {
    throw new CollabError("passkey_scope_invalid", "origin must be a URL origin");
  }
  const secure = url.protocol === "https:" || url.protocol === "http:" && url.hostname === "localhost";
  const hostMatches = url.hostname === rpId || url.hostname.endsWith(`.${rpId}`);
  if (!secure || !hostMatches || url.origin !== origin) {
    throw new CollabError("passkey_scope_invalid", "origin must be an https origin (or http://localhost) whose host is rp_id or one of its subdomains");
  }
  return { rp_id: rpId, origin: url.origin };
}
function verifyPasskeyAssertion(input) {
  const { passkey, assertion } = input;
  if (assertion.credential_id !== passkey.credential_id) {
    throw new CollabError("passkey_not_enrolled", "The assertion names a different credential");
  }
  const clientDataBytes = base64urlDecode(assertion.client_data_json, "client_data_json");
  const authenticatorData = base64urlDecode(assertion.authenticator_data, "authenticator_data");
  const signature = base64urlDecode(assertion.signature, "signature", 256);
  let clientData;
  try {
    const parsed = JSON.parse(clientDataBytes.toString("utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("not an object");
    clientData = parsed;
  } catch {
    throw new CollabError("passkey_assertion_invalid", "client_data_json is not a JSON object");
  }
  if (clientData.type !== "webauthn.get") {
    throw new CollabError("passkey_assertion_invalid", "client data type must be webauthn.get");
  }
  if (clientData.challenge !== input.expected_challenge) {
    throw new CollabError("passkey_challenge_mismatch", "The assertion signs a different act; request a fresh challenge for the current state");
  }
  if (clientData.origin !== passkey.origin || clientData.crossOrigin === true) {
    throw new CollabError("passkey_origin_mismatch", "The assertion came from another origin");
  }
  if (authenticatorData.length < 37) {
    throw new CollabError("passkey_assertion_invalid", "authenticator_data is too short");
  }
  if (!authenticatorData.subarray(0, 32).equals(sha256(passkey.rp_id))) {
    throw new CollabError("passkey_rp_mismatch", "The assertion is for another relying party");
  }
  const flags = authenticatorData[32];
  if ((flags & FLAG_USER_PRESENT) === 0 || (flags & FLAG_USER_VERIFIED) === 0) {
    throw new CollabError("passkey_user_not_verified", "The authenticator did not report user presence and user verification");
  }
  const signCount = authenticatorData.readUInt32BE(33);
  if ((signCount !== 0 || passkey.sign_count !== 0) && signCount <= passkey.sign_count) {
    throw new CollabError("passkey_counter_regressed", "The signature counter did not increase");
  }
  const signed = Buffer.concat([authenticatorData, sha256(clientDataBytes)]);
  const valid = verify("sha256", signed, { key: parsePasskeyPublicKey(passkey.public_key_spki), dsaEncoding: "der" }, signature);
  if (!valid)
    throw new CollabError("passkey_signature_invalid", "The passkey signature does not verify");
  return { sign_count: signCount };
}

// src/proposal.ts
function proposalBytes(content) {
  return canonicalJson({ protocol: PROPOSAL_BYTES_PROTOCOL, rule: CONSENT_RULE, ...content });
}
function aiPosition(input) {
  const closed = Date.parse(input.now) >= Date.parse(input.closes_at);
  const others = [...new Set(input.snapshot_voice_ids)].filter((voice) => voice !== input.author_voice_id).sort();
  const lone = others.length === 0;
  const qualifying_support_indexes = input.support_voice_ids.flatMap((voice, index) => lone || voice !== input.author_voice_id ? [index] : []);
  const supported = new Set(qualifying_support_indexes.map((index) => input.support_voice_ids[index]));
  const awaiting_voice_ids = others.filter((voice) => !supported.has(voice));
  const result = (position) => ({
    position,
    closed,
    qualifying_support_indexes,
    awaiting_voice_ids
  });
  if (input.obsoleted)
    return result(input.obsoleted);
  const hasSupport = qualifying_support_indexes.length > 0;
  if (!closed) {
    if (input.unresolved_challenge)
      return result("challenged");
    return result(hasSupport && awaiting_voice_ids.length === 0 ? "consented" : "open");
  }
  if (input.unresolved_challenge)
    return result("split");
  return result(hasSupport ? "consented" : "lapsed");
}

// src/repository.ts
import { createHash as createHash2 } from "crypto";
import {
  closeSync as closeSync2,
  existsSync as existsSync2,
  fstatSync,
  lstatSync as lstatSync2,
  openSync as openSync2,
  readlinkSync,
  readSync,
  realpathSync,
  statSync
} from "fs";
import { resolve as resolve3 } from "path";
import { spawnSync } from "child_process";
var GIT_TIMEOUT_MS = 5000;
var MAX_GIT_OUTPUT = 1024 * 1024;
var MAX_UNTRACKED_FILES = 1e4;
var MAX_UNTRACKED_BYTES = 64 * 1024 * 1024;
var MAX_UNTRACKED_HASH_MS = 2000;
var MAX_SUCCESSOR_PATHS = 128;
var MAX_SUCCESSOR_BYTES = 64 * 1024 * 1024;
var MAX_SUCCESSOR_INSPECT_MS = 5000;
var GIT_OBJECT_ID = /^[0-9a-f]{40,64}$/;
var RAW_DIFF_HEADER = /^:([0-7]{6}) ([0-7]{6}) ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) ([A-Z])$/;

class RepositoryProbeTimeout extends Error {
  constructor() {
    super("Repository discovery exhausted its Git time budget");
  }
}
function inspectRepository(rootInput, explicitRepositoryKey, metadataOnly = false, options = {}) {
  const requested = resolve3(rootInput);
  if (!existsSync2(requested) || !statSync(requested).isDirectory()) {
    throw new CollabError("workspace_not_directory", "Workspace root must be an existing directory", { root_path: requested });
  }
  const requestedRoot = realpathSync(requested);
  const topLevel = gitOutput(requestedRoot, ["rev-parse", "--show-toplevel"], options);
  const rootPath = topLevel && existsSync2(topLevel) ? realpathSync(topLevel) : requestedRoot;
  const explicitKey = explicitRepositoryKey?.trim();
  if (!topLevel) {
    const repositoryKey2 = explicitKey ? `explicit:${sha2562(explicitKey)}` : `local-path:${sha2562(rootPath)}`;
    return {
      requested_root_path: requestedRoot,
      root_path: rootPath,
      repository_key: repositoryKey2,
      git_common_dir_hash: null,
      worktree_fingerprint: `path:${sha2562(rootPath)}`,
      checkpoint: {
        worktree_id: worktreeId(rootPath, `path:${rootPath}`),
        head_sha: null,
        branch: null,
        dirty: null,
        captured_at: new Date().toISOString()
      }
    };
  }
  const commonDirOutput = gitOutput(rootPath, ["rev-parse", "--path-format=absolute", "--git-common-dir"], options) ?? gitOutput(rootPath, ["rev-parse", "--git-common-dir"], options);
  const gitDirOutput = gitOutput(rootPath, ["rev-parse", "--path-format=absolute", "--git-dir"], options) ?? gitOutput(rootPath, ["rev-parse", "--git-dir"], options);
  if (!commonDirOutput || !gitDirOutput) {
    throw new CollabError("git_identity_unavailable", "Git recognized the repository but its local identity could not be resolved", { root_path: rootPath });
  }
  const commonDir = realpathIfPresent(resolveGitPath(rootPath, commonDirOutput));
  const gitDir = realpathIfPresent(resolveGitPath(rootPath, gitDirOutput));
  const commonDirHash = sha2562(commonDir);
  const repositoryKey = explicitKey ? `explicit:${sha2562(explicitKey)}` : `local-git:${commonDirHash}`;
  const fingerprint = `git:${sha2562(`${commonDir}\x00${gitDir}`)}`;
  const id = worktreeId(rootPath, fingerprint);
  return {
    requested_root_path: requestedRoot,
    root_path: rootPath,
    repository_key: repositoryKey,
    portable_repository_key: explicitKey || options.portable === false ? null : portableRepositoryKey(rootPath, options),
    git_common_dir_hash: commonDirHash,
    worktree_fingerprint: fingerprint,
    checkpoint: metadataOnly ? { worktree_id: id, head_sha: null, branch: null, dirty: null, captured_at: new Date().toISOString() } : captureRepoCheckpoint(rootPath, id)
  };
}
function portableRepositoryKey(rootPath, optionsOrDeadline = {}) {
  const options = typeof optionsOrDeadline === "number" ? { deadline: optionsOrDeadline } : optionsOrDeadline;
  const origin = gitOutput(rootPath, ["config", "--get-all", "remote.origin.url"], options);
  const remote = origin ?? gitOutput(rootPath, ["config", "--get-all", "remote.github.url"], options);
  const canonical = remote ? canonicalRepositoryRemote(remote) : null;
  if (!canonical || gitOutput(rootPath, ["rev-parse", "--is-shallow-repository"], options) !== "false")
    return null;
  const roots = successorGit(rootPath, ["rev-list", "--max-parents=0", "HEAD"], MAX_GIT_OUTPUT, options);
  if (roots.timed_out && options.deadline !== undefined)
    throw new RepositoryProbeTimeout;
  if (!roots.ok)
    return null;
  const root = roots.stdout.toString("utf8").trim();
  if (!GIT_OBJECT_ID.test(root))
    return null;
  return `git-root-remote:v1:${sha2562(`${root}\x00${canonical}`)}`;
}
function canonicalRepositoryRemote(value) {
  if (/[\s\x00-\x1f\x7f]/.test(value) || value.includes("::") || value.includes("://") && !/^(https?|ssh|git):\/\//i.test(value))
    return null;
  let host;
  let path;
  let port = "";
  try {
    if (/^(https?|ssh|git):\/\//i.test(value)) {
      const url = new URL(value);
      if (url.search || url.hash)
        return null;
      host = url.hostname.toLowerCase();
      path = url.pathname;
      port = url.port && !(url.protocol === "ssh:" && url.port === "22" || url.protocol === "git:" && url.port === "9418") ? `:${url.port}` : "";
    } else {
      const scp = /^(?:[^/@:]+@)?([^/:]+):(.+)$/.exec(value);
      if (!scp)
        return null;
      host = scp[1].toLowerCase();
      path = scp[2];
    }
    path = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
    if (!host || !path || path.split("/").some((part) => !part || part === "." || part === "..") || /[%\\?#]/.test(path))
      return null;
    return `${host}${port}/${path.toLowerCase()}`;
  } catch {
    return null;
  }
}
function captureRepoCheckpoint(rootPath, id) {
  const head = gitOutput(rootPath, ["rev-parse", "--verify", "HEAD"]);
  if (!head) {
    return {
      worktree_id: id,
      head_sha: null,
      branch: null,
      dirty: null,
      captured_at: new Date().toISOString()
    };
  }
  const branch = gitOutput(rootPath, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const pathStateBefore = gitBytes(rootPath, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all"
  ]);
  const indexDigest = gitDigest(rootPath, ["ls-files", "-s", "-z"]);
  const trackedState = gitBytes(rootPath, [
    "diff",
    "--no-ext-diff",
    "--binary",
    "HEAD",
    "--"
  ]);
  const untrackedPaths = gitBytes(rootPath, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z"
  ]);
  const untrackedDigest = untrackedPaths.ok ? digestUntrackedContent(rootPath, untrackedPaths.stdout) : null;
  const pathStateAfter = gitBytes(rootPath, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all"
  ]);
  const stablePathState = pathStateBefore.ok && pathStateAfter.ok && pathStateBefore.stdout.equals(pathStateAfter.stdout);
  return {
    worktree_id: id,
    head_sha: /^[0-9a-f]{40,64}$/i.test(head) ? head.toLowerCase() : null,
    branch,
    dirty: pathStateAfter.ok ? pathStateAfter.stdout.length > 0 : null,
    algorithm: "git-state/v1",
    index_sha256: indexDigest,
    state_sha256: trackedState.ok && stablePathState && untrackedDigest ? sha256Bytes(Buffer.concat([
      trackedState.stdout,
      Buffer.from([0]),
      pathStateAfter.stdout,
      Buffer.from([0]),
      Buffer.from(untrackedDigest, "hex")
    ])) : null,
    source: "server_observed",
    captured_at: new Date().toISOString()
  };
}
function inspectSuccessorCommit(rootPath, commitSha, parentSha) {
  const refuse = (reason) => ({
    ok: false,
    commit_sha: commitSha,
    reason
  });
  if (!GIT_OBJECT_ID.test(commitSha) || !GIT_OBJECT_ID.test(parentSha)) {
    return refuse("The checkpoint HEADs are not Git object IDs");
  }
  const commitObject = successorGit(rootPath, ["cat-file", "commit", commitSha]);
  if (!commitObject.ok)
    return refuse(`Git could not read commit ${commitSha}`);
  const headerEnd = commitObject.stdout.indexOf(`

`);
  const parents = commitObject.stdout.subarray(0, headerEnd === -1 ? commitObject.stdout.length : headerEnd).toString("utf8").split(`
`).filter((line) => line.startsWith("parent ")).map((line) => line.slice("parent ".length));
  if (parents.length > 1) {
    return refuse(`HEAD ${commitSha} is a merge commit, not one fast-forward commit`);
  }
  if (parents[0] !== parentSha) {
    const descends = successorGitExitCode(rootPath, [
      "merge-base",
      "--is-ancestor",
      parentSha,
      commitSha
    ]) === 0;
    return refuse(descends ? `HEAD ${commitSha} is more than one commit ahead of the result checkpoint HEAD ${parentSha}` : `HEAD ${commitSha} does not descend from the result checkpoint HEAD ${parentSha}`);
  }
  const diff = successorGit(rootPath, [
    "diff-tree",
    "-r",
    "-z",
    "--raw",
    "--no-renames",
    "--ignore-submodules=none",
    parentSha,
    commitSha,
    "--"
  ]);
  const fields = diff.ok ? splitNul(diff.stdout) : null;
  if (!fields || fields.length % 2 !== 0) {
    return refuse(`Git could not list the paths commit ${commitSha} changes`);
  }
  if (fields.length / 2 > MAX_SUCCESSOR_PATHS) {
    return refuse(`Commit ${commitSha} changes more than ${MAX_SUCCESSOR_PATHS} paths`);
  }
  const budget = { bytes: MAX_SUCCESSOR_BYTES, deadline: Date.now() + MAX_SUCCESSOR_INSPECT_MS };
  const changes = [];
  for (let index = 0;index < fields.length; index += 2) {
    const header = RAW_DIFF_HEADER.exec(fields[index].toString("utf8"));
    const pathBytes = fields[index + 1];
    if (!header || !safeGitRelativePath(pathBytes)) {
      return refuse(`Git reported a change in commit ${commitSha} that cannot be read safely`);
    }
    const path = pathBytes.toString("utf8");
    const [, oldMode, mode, , blob, status] = header;
    const modeVouched = status === "A" || status === "M" && oldMode === mode;
    if (status === "D" || mode !== "100644" && mode !== "100755" || !modeVouched) {
      changes.push({ path, blob_sha256: null });
      continue;
    }
    if (Date.now() > budget.deadline || budget.bytes <= 0) {
      return refuse(`Inspecting commit ${commitSha} exceeded its bounds`);
    }
    const content = successorGit(rootPath, ["cat-file", "blob", blob], budget.bytes);
    if (!content.ok) {
      return refuse(`Git could not read the committed bytes of ${path} within the inspection bounds`);
    }
    budget.bytes -= content.stdout.length;
    changes.push({ path, blob_sha256: sha256Bytes(content.stdout) });
  }
  return { ok: true, commit_sha: commitSha, parent_sha: parentSha, changes };
}
function worktreeId(rootPath, fingerprint) {
  return `wt_${sha2562(`${rootPath}\x00${fingerprint}`).slice(0, 24)}`;
}
function resolveGitPath(rootPath, value) {
  return value.startsWith("/") ? value : resolve3(rootPath, value);
}
function realpathIfPresent(path) {
  return existsSync2(path) ? realpathSync(path) : resolve3(path);
}
function gitOutput(rootPath, args, options = {}) {
  const result = runGit(rootPath, args, options);
  if (result.timed_out && options.deadline !== undefined)
    throw new RepositoryProbeTimeout;
  if (!result.ok)
    return null;
  const value = result.stdout.trim();
  return value.length > 0 ? value : null;
}
function runGit(rootPath, args, options) {
  const timeout = gitTimeout(options);
  if (timeout <= 0)
    return { ok: false, timed_out: true, stdout: "" };
  const result = spawnRepositoryGit(["-C", rootPath, ...args], {
    encoding: "utf8",
    timeout,
    maxBuffer: MAX_GIT_OUTPUT,
    stdio: ["ignore", "pipe", "ignore"],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }
  }, options);
  return {
    ok: result.status === 0 && !result.error,
    timed_out: result.error?.code === "ETIMEDOUT",
    stdout: typeof result.stdout === "string" ? result.stdout : ""
  };
}
function gitDigest(rootPath, args) {
  const result = gitBytes(rootPath, args);
  return result.ok ? sha256Bytes(result.stdout) : null;
}
function gitBytes(rootPath, args, maxBuffer = MAX_GIT_OUTPUT) {
  const result = spawnSync("git", ["-C", rootPath, ...args], {
    timeout: GIT_TIMEOUT_MS,
    maxBuffer,
    stdio: ["ignore", "pipe", "ignore"]
  });
  return {
    ok: result.status === 0 && !result.error,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0)
  };
}
var SUCCESSOR_GIT_ARGS = ["-c", "core.commitGraph=false", "--no-replace-objects"];
function successorGitEnv() {
  return { ...process.env, GIT_GRAFT_FILE: "/dev/null/agenttool-collab-no-grafts" };
}
function successorGit(rootPath, args, maxBuffer = MAX_GIT_OUTPUT, options = {}) {
  const timeout = gitTimeout(options);
  if (timeout <= 0)
    return { ok: false, timed_out: true, stdout: Buffer.alloc(0) };
  const result = spawnRepositoryGit(["-C", rootPath, ...SUCCESSOR_GIT_ARGS, ...args], {
    timeout,
    maxBuffer,
    stdio: ["ignore", "pipe", "ignore"],
    env: successorGitEnv()
  }, options);
  return {
    ok: result.status === 0 && !result.error,
    timed_out: result.error?.code === "ETIMEDOUT",
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0)
  };
}
function spawnRepositoryGit(args, options, probe) {
  return probe.spawn ? probe.spawn(args, options) : spawnSync("git", args, options);
}
function gitTimeout(options) {
  return options.deadline === undefined ? GIT_TIMEOUT_MS : Math.min(GIT_TIMEOUT_MS, Math.ceil(options.deadline - (options.now ?? (() => performance.now()))()));
}
function successorGitExitCode(rootPath, args) {
  const result = spawnSync("git", ["-C", rootPath, ...SUCCESSOR_GIT_ARGS, ...args], {
    timeout: GIT_TIMEOUT_MS,
    stdio: ["ignore", "ignore", "ignore"],
    env: successorGitEnv()
  });
  return result.error ? null : result.status;
}
function digestUntrackedContent(rootPath, paths) {
  const entries = splitNul(paths);
  if (!entries || entries.length > MAX_UNTRACKED_FILES)
    return null;
  const budget = {
    remainingBytes: MAX_UNTRACKED_BYTES,
    deadline: Date.now() + MAX_UNTRACKED_HASH_MS
  };
  const aggregate = createHash2("sha256");
  aggregate.update("agenttool.collab/untracked-state/v1\x00");
  for (const entry of entries) {
    if (Date.now() > budget.deadline)
      return null;
    if (!safeGitRelativePath(entry))
      return null;
    const absolute = Buffer.concat([
      Buffer.from(rootPath),
      Buffer.from("/"),
      entry
    ]);
    let stat;
    try {
      stat = lstatSync2(absolute);
      aggregate.update(lengthPrefix(entry.length));
      aggregate.update(entry);
      if (stat.isSymbolicLink()) {
        const target = readlinkSync(absolute, { encoding: "buffer" });
        if (target.length > budget.remainingBytes || Date.now() > budget.deadline) {
          return null;
        }
        budget.remainingBytes -= target.length;
        aggregate.update("symlink\x00");
        aggregate.update(lengthPrefix(target.length));
        aggregate.update(target);
      } else if (stat.isFile()) {
        const digest = digestStableFile(absolute, budget);
        if (!digest)
          return null;
        aggregate.update("file\x00");
        aggregate.update(lengthPrefix(stat.mode & 73));
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
function digestStableFile(path, budget) {
  let descriptor = null;
  try {
    descriptor = openSync2(path, "r");
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size > budget.remainingBytes || Date.now() > budget.deadline)
      return null;
    const hash = createHash2("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    while (true) {
      if (Date.now() > budget.deadline)
        return null;
      const count = readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0)
        break;
      hash.update(buffer.subarray(0, count));
    }
    const after = fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mode !== after.mode || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs)
      return null;
    budget.remainingBytes -= before.size;
    return hash.digest();
  } catch {
    return null;
  } finally {
    if (descriptor !== null)
      closeSync2(descriptor);
  }
}
function splitNul(value) {
  if (value.length === 0)
    return [];
  const entries = [];
  let start = 0;
  for (let index = 0;index < value.length; index += 1) {
    if (value[index] !== 0)
      continue;
    if (index === start)
      return null;
    entries.push(value.subarray(start, index));
    start = index + 1;
  }
  return start === value.length ? entries : null;
}
function safeGitRelativePath(value) {
  if (value.length === 0 || value[0] === 47)
    return false;
  let start = 0;
  for (let index = 0;index <= value.length; index += 1) {
    if (index !== value.length && value[index] !== 47)
      continue;
    const component = value.subarray(start, index);
    if (component.length === 0 || component.length === 1 && component[0] === 46 || component.length === 2 && component[0] === 46 && component[1] === 46)
      return false;
    start = index + 1;
  }
  return true;
}
function lengthPrefix(value) {
  const prefix = Buffer.allocUnsafe(8);
  prefix.writeBigUInt64BE(BigInt(value));
  return prefix;
}
function sha2562(value) {
  return createHash2("sha256").update(value).digest("hex");
}
function sha256Bytes(value) {
  return createHash2("sha256").update(value).digest("hex");
}

// src/store.ts
var GENESIS_HASH = "0".repeat(64);
var APPLICATION_ID = 1096041292;
var HARDENED_PREVIEW_SCHEMA_VERSION = 2;
var SCHEMA_VERSION = 3;
var DEFAULT_LEASE_SECONDS = 15 * 60;
var MAX_LEASE_SECONDS = 60 * 60;
var REPOSITORY_DISCOVERY_MS = 250;
var MAX_TEXT = 8000;
var MAX_REPORT_BODY = 9000;
var MAX_DEPENDENCIES = 128;
var MAX_PATH_SCOPES = 128;
var MAX_PATH_SCOPE_LENGTH = 500;
var MAX_PATH_SCOPES_TOTAL = 16000;
var MAX_REPORT_REFS = 128;
var MAX_REPORT_REF_LENGTH = 2000;
var DEFAULT_PRESENCE_SECONDS = 2 * 60;
var MAX_PRESENCE_SECONDS = 60 * 60;
var MAX_SESSION_CAPABILITIES = 32;
var MAX_SESSION_CAPABILITY_LENGTH = 100;
var DEFAULT_SESSION_LIST_LIMIT = 100;
var MAX_SESSION_LIST_LIMIT = 500;
var DEFAULT_NEXT_EVENT_LIMIT = 50;
var MAX_NEXT_EVENT_LIMIT = 50;
var SESSION_TOKEN_BYTES = 32;
var SESSION_END_RECOVERY_NOTE = "collab_session_end with release_leases released this expired lease from its own session";
var PRESENCE_SESSION_COLUMNS = [
  "id",
  "workspace_id",
  "epoch_id",
  "client_instance_id",
  "actor_label",
  "actor_key",
  "runtime_kind",
  "provider_label",
  "model_label",
  "declared_capabilities_json",
  "version",
  "joined_at",
  "last_seen_at",
  "presence_expires_at",
  "left_at"
];
var COORDINATION_SESSION_COLUMNS = [
  "id",
  "workspace_id",
  "worktree_id",
  "actor",
  "role",
  "parent_session_id",
  "status",
  "generation",
  "token_hash",
  "joined_at",
  "last_seen_at",
  "ended_at",
  "cursor_epoch_id",
  "cursor_sequence",
  "cursor_hash",
  "cursor_version",
  "reset_generation",
  "cursor_recovery_required"
];
var SQLITE_BUSY_RETRY_MS = 15000;
var V2_GUARD_TRIGGERS = [
  "tasks_v2_insert_guard",
  "tasks_v2_update_guard",
  "tasks_v2_delete_guard",
  "artifacts_v2_insert_guard",
  "handoffs_v2_insert_guard"
];

class CollabStore {
  db;
  now;
  filesystemPath;
  migrationFailpoint;
  repositoryDiscovery;
  eventReader;
  closed = false;
  constructor(path, options = {}) {
    this.now = options.now ?? (() => new Date);
    this.migrationFailpoint = options.migration_failpoint;
    this.repositoryDiscovery = {
      ...options.repository_discovery,
      budget_ms: options.repository_discovery?.budget_ms ?? REPOSITORY_DISCOVERY_MS,
      now: options.repository_discovery?.now ?? (() => performance.now())
    };
    const databasePath = path === ":memory:" ? path : resolve4(path);
    if (databasePath !== ":memory:") {
      const parent = dirname2(databasePath);
      const parentAlreadyExisted = existsSync3(parent);
      mkdirSync2(parent, { recursive: true, mode: 448 });
      if (!parentAlreadyExisted)
        chmodSync2(parent, 448);
      if (existsSync3(databasePath)) {
        assertSafeDatabaseFile(databasePath);
      } else {
        try {
          const descriptor = openSync3(databasePath, "wx", 384);
          closeSync3(descriptor);
        } catch (error) {
          if (error.code !== "EEXIST")
            throw error;
          assertSafeDatabaseFile(databasePath);
        }
      }
      this.filesystemPath = databasePath;
    }
    this.db = new Database(databasePath, { create: true, strict: true });
    try {
      this.db.exec("PRAGMA busy_timeout = 5000");
      this.preflightDatabase();
      this.initialize();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  close() {
    this.closed = true;
    this.eventReader?.close();
    this.eventReader = undefined;
    this.db.close();
  }
  nonblockingEventReader() {
    if (this.closed)
      throw new CollabError("store_closed", "The collaboration store is closed");
    if (!this.filesystemPath) {
      if (this.db.inTransaction) {
        throw new CollabError("event_read_busy", "Finish the active transaction before observing events");
      }
      return this.db;
    }
    if (!this.eventReader) {
      const reader = new Database(this.filesystemPath, { readonly: true, strict: true });
      try {
        reader.exec("PRAGMA busy_timeout = 0; PRAGMA query_only = ON");
        this.eventReader = reader;
      } catch (error) {
        reader.close();
        throw error;
      }
    }
    return this.eventReader;
  }
  defaultSessionCredentialPath(sessionId) {
    if (!this.filesystemPath) {
      throw new CollabError("session_file_path_required", "An explicit credential file path is required for an in-memory database");
    }
    const id = validateId(sessionId, "session_id");
    return join2(dirname2(this.filesystemPath), "collab-sessions", `${id}.json`);
  }
  initialize() {
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA busy_timeout = 5000");
    const legacyPreparation = this.prepareLegacyMigration();
    const migrate = this.db.transaction(() => {
      const applicationId = pragmaNumber(this.db, "application_id");
      const userVersion = pragmaNumber(this.db, "user_version");
      if (applicationId !== 0 && applicationId !== APPLICATION_ID) {
        throw new CollabError("database_application_mismatch", "The SQLite file belongs to another application", { expected_application_id: APPLICATION_ID, actual_application_id: applicationId });
      }
      if (userVersion > SCHEMA_VERSION) {
        throw new CollabError("database_version_too_new", "The collaboration database was created by a newer package version", { supported_schema_version: SCHEMA_VERSION, actual_schema_version: userVersion });
      }
      const tables = this.tableNames();
      if (tables.length === 0) {
        this.createLegacySchema();
        this.migrationFailpoint?.("legacy_schema_created");
      } else {
        this.validateLegacyOrV2Shape(userVersion);
      }
      const versionAfterLock = pragmaNumber(this.db, "user_version");
      if (versionAfterLock < HARDENED_PREVIEW_SCHEMA_VERSION) {
        this.migrateToV2(legacyPreparation);
      } else if (versionAfterLock === HARDENED_PREVIEW_SCHEMA_VERSION) {
        this.migrateHardenedPreviewToV3();
      }
      this.validateV2Shape("coordination_sessions", [
        HARDENED_PREVIEW_SCHEMA_VERSION,
        SCHEMA_VERSION
      ]);
      this.validateAllJournals();
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS repository_aliases (
          worktree_id TEXT PRIMARY KEY REFERENCES worktrees(id),
          portable_key TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS repository_aliases_key_idx ON repository_aliases(portable_key);
        CREATE TABLE IF NOT EXISTS repository_discovery (
          worktree_id TEXT PRIMARY KEY REFERENCES worktrees(id),
          fingerprint TEXT NOT NULL,
          outcome TEXT NOT NULL CHECK (outcome IN ('checked', 'unresolvable'))
        );
        CREATE TABLE IF NOT EXISTS session_lease_lapses (
          lease_id TEXT PRIMARY KEY,
          effective_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS proposal_terms (
          report_id TEXT PRIMARY KEY REFERENCES reports(id),
          workspace_id TEXT NOT NULL REFERENCES workspaces(id),
          rule TEXT NOT NULL,
          criteria TEXT NOT NULL,
          extent TEXT NOT NULL,
          known_conflicts TEXT,
          origin TEXT NOT NULL CHECK (origin IN ('ai', 'person_relayed')),
          topic TEXT,
          closes_at TEXT NOT NULL,
          voices_json TEXT NOT NULL,
          author_voice_id TEXT NOT NULL,
          proposal_sha256 TEXT NOT NULL,
          opened_event_id TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS proposal_terms_workspace_idx
          ON proposal_terms(workspace_id, created_at);
        CREATE TABLE IF NOT EXISTS proposal_person_acts (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id),
          proposal_report_id TEXT NOT NULL REFERENCES proposal_terms(report_id),
          proposal_sha256 TEXT NOT NULL,
          act TEXT NOT NULL CHECK (act IN ('agree', 'reject')),
          party TEXT NOT NULL CHECK (party IN ('person')),
          basis TEXT NOT NULL CHECK (basis IN ('relayed_by_session', 'controlling_terminal', 'user_verified_passkey')),
          reason TEXT,
          -- No foreign key: additive tables never reference the session table,
          -- which the schema-2 preview upgrade renames.
          relayed_by_session_id TEXT,
          ai_snapshot_json TEXT NOT NULL,
          proof_json TEXT,
          created_at TEXT NOT NULL,
          event_sequence INTEGER NOT NULL,
          CHECK (act = 'reject' OR basis <> 'relayed_by_session')
        );
        CREATE INDEX IF NOT EXISTS proposal_person_acts_proposal_idx
          ON proposal_person_acts(proposal_report_id, event_sequence);
        CREATE TABLE IF NOT EXISTS person_passkeys (
          credential_id TEXT PRIMARY KEY,
          public_key_spki TEXT NOT NULL,
          algorithm INTEGER NOT NULL CHECK (algorithm = -7),
          rp_id TEXT NOT NULL,
          origin TEXT NOT NULL,
          label TEXT,
          fingerprint TEXT NOT NULL,
          sign_count INTEGER NOT NULL DEFAULT 0,
          enrolled_at TEXT NOT NULL,
          revoked_at TEXT
        );
        CREATE TABLE IF NOT EXISTS person_addressed_reports (
          report_id TEXT PRIMARY KEY REFERENCES reports(id),
          workspace_id TEXT NOT NULL REFERENCES workspaces(id)
        );
      `);
      this.db.exec(`PRAGMA application_id = ${APPLICATION_ID}`);
      this.db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    });
    retrySqliteBusy(() => migrate.immediate());
    if (this.db.filename !== ":memory:") {
      retrySqliteBusy(() => this.db.exec("PRAGMA journal_mode = WAL"));
    }
    this.tightenFileModes();
  }
  preflightDatabase() {
    const applicationId = pragmaNumber(this.db, "application_id");
    const userVersion = pragmaNumber(this.db, "user_version");
    if (applicationId !== 0 && applicationId !== APPLICATION_ID) {
      throw new CollabError("database_application_mismatch", "The SQLite file belongs to another application", { expected_application_id: APPLICATION_ID, actual_application_id: applicationId });
    }
    if (userVersion > SCHEMA_VERSION) {
      throw new CollabError("database_version_too_new", "The collaboration database was created by a newer package version", { supported_schema_version: SCHEMA_VERSION, actual_schema_version: userVersion });
    }
    if (this.tableNames().length > 0) {
      this.validateLegacyOrV2Shape(userVersion);
      if (userVersion >= HARDENED_PREVIEW_SCHEMA_VERSION) {
        this.validateAllJournals();
      }
    }
  }
  prepareLegacyMigration() {
    if (this.tableNames().length === 0 || pragmaNumber(this.db, "user_version") >= HARDENED_PREVIEW_SCHEMA_VERSION)
      return [];
    const workspaces = this.db.query(`
      SELECT id, root_path FROM workspaces ORDER BY id
    `).all();
    const prepared = workspaces.map((workspace) => ({
      ...workspace,
      identity: safeRepositoryIdentity(workspace.root_path)
    }));
    assertDistinctLegacyWorktreeIdentities(prepared);
    return prepared;
  }
  createLegacySchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        epoch_id TEXT NOT NULL,
        root_path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        event_head_sequence INTEGER NOT NULL DEFAULT 0,
        event_head_hash TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT NOT NULL,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL CHECK(status IN ('open', 'claimed', 'blocked', 'completed')),
        dependencies_json TEXT NOT NULL,
        path_scopes_json TEXT NOT NULL,
        assignee TEXT,
        lease_id TEXT,
        lease_expires_at TEXT,
        blocker TEXT,
        latest_progress TEXT,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        PRIMARY KEY (workspace_id, id)
      );
      CREATE INDEX IF NOT EXISTS tasks_workspace_status_idx
        ON tasks(workspace_id, status, lease_expires_at);
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('file', 'commit', 'test', 'data', 'url', 'other')),
        uri TEXT NOT NULL,
        sha256 TEXT,
        media_type TEXT,
        label TEXT,
        attached_by TEXT NOT NULL,
        attached_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id, task_id) REFERENCES tasks(workspace_id, id)
      );
      CREATE INDEX IF NOT EXISTS artifacts_task_idx ON artifacts(workspace_id, task_id, attached_at);
      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        topic TEXT NOT NULL,
        decision TEXT NOT NULL,
        rationale TEXT,
        recorded_by TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS decisions_workspace_idx ON decisions(workspace_id, recorded_at);
      CREATE TABLE IF NOT EXISTS handoffs (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        from_actor TEXT NOT NULL,
        to_actor TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'declined', 'expired')),
        offered_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        resolved_at TEXT,
        FOREIGN KEY (workspace_id, task_id) REFERENCES tasks(workspace_id, id)
      );
      CREATE INDEX IF NOT EXISTS handoffs_target_idx
        ON handoffs(workspace_id, to_actor, status, expires_at);
      CREATE TABLE IF NOT EXISTS events (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        epoch_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        id TEXT NOT NULL UNIQUE,
        protocol TEXT NOT NULL,
        type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        actor TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        prev_hash TEXT NOT NULL,
        hash TEXT NOT NULL,
        PRIMARY KEY (workspace_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS mutations (
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        actor TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        operation TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, actor, idempotency_key)
      );
    `);
  }
  migrateToV2(preparedWorkspaces) {
    if (this.hasColumn("workspaces", "repository_key")) {
      throw new CollabError("database_partial_migration", "The collaboration database has v0.2 columns without a committed schema version");
    }
    const journalHeads = this.db.query(`
      SELECT id, epoch_id, event_head_sequence, event_head_hash
      FROM workspaces ORDER BY id
    `).all();
    const currentWorkspaces = this.db.query(`
      SELECT id, root_path FROM workspaces ORDER BY id
    `).all();
    if (canonicalJson(currentWorkspaces) !== canonicalJson(preparedWorkspaces.map(({ id, root_path }) => ({ id, root_path })))) {
      throw new CollabError("migration_source_changed", "Legacy workspace roots changed while migration identities were prepared; retry startup");
    }
    const identities = new Map(preparedWorkspaces.map((workspace) => [workspace.id, workspace.identity]));
    this.db.exec(`
      ALTER TABLE workspaces
        ADD COLUMN repository_key TEXT NOT NULL DEFAULT '';

      ALTER TABLE tasks
        ADD COLUMN coordination_mode TEXT NOT NULL DEFAULT 'legacy_v1'
        CHECK(coordination_mode IN ('legacy_v1', 'session_v2'));
      ALTER TABLE tasks
        ADD COLUMN work_mode TEXT NOT NULL DEFAULT 'coordination'
        CHECK(work_mode IN ('coordination', 'read_only', 'edit'));
      ALTER TABLE tasks
        ADD COLUMN completion_policy TEXT NOT NULL DEFAULT 'reported'
        CHECK(completion_policy IN ('reported', 'accepted'));
      ALTER TABLE tasks
        ADD COLUMN review_status TEXT NOT NULL DEFAULT 'legacy_unreviewed'
        CHECK(review_status IN ('legacy_unreviewed', 'not_required', 'pending', 'accepted', 'changes_requested'));
      ALTER TABLE tasks ADD COLUMN review_generation INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE tasks ADD COLUMN expected_base_sha TEXT;
      ALTER TABLE tasks ADD COLUMN base_checkpoint_json TEXT;
      ALTER TABLE tasks ADD COLUMN result_checkpoint_json TEXT;
      ALTER TABLE tasks ADD COLUMN completion_report_id TEXT;
      ALTER TABLE tasks ADD COLUMN assignee_session_id TEXT;
      ALTER TABLE tasks ADD COLUMN claim_worktree_id TEXT;
      ALTER TABLE tasks ADD COLUMN reported_by TEXT;
      ALTER TABLE tasks ADD COLUMN reported_by_session_id TEXT;
      ALTER TABLE tasks ADD COLUMN reported_at TEXT;
      ALTER TABLE tasks ADD COLUMN accepted_by TEXT;
      ALTER TABLE tasks ADD COLUMN accepted_by_session_id TEXT;
      ALTER TABLE tasks ADD COLUMN accepted_at TEXT;

      ALTER TABLE artifacts ADD COLUMN attached_by_session_id TEXT;
      ALTER TABLE handoffs ADD COLUMN from_session_id TEXT;
      ALTER TABLE handoffs ADD COLUMN to_session_id TEXT;
      ALTER TABLE events ADD COLUMN session_id TEXT;

      CREATE TABLE repositories (
        key TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );
      CREATE TABLE worktrees (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        repository_key TEXT NOT NULL REFERENCES repositories(key),
        root_path TEXT NOT NULL UNIQUE,
        git_common_dir_hash TEXT,
        fingerprint TEXT NOT NULL,
        branch TEXT,
        head_sha TEXT,
        dirty INTEGER,
        registered_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      );
      CREATE INDEX worktrees_repository_idx
        ON worktrees(repository_key, workspace_id);

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        epoch_id TEXT NOT NULL,
        client_instance_id TEXT NOT NULL,
        actor_label TEXT NOT NULL,
        actor_key TEXT NOT NULL UNIQUE,
        runtime_kind TEXT NOT NULL,
        provider_label TEXT,
        model_label TEXT,
        declared_capabilities_json TEXT NOT NULL,
        version INTEGER NOT NULL,
        joined_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        presence_expires_at TEXT NOT NULL,
        left_at TEXT,
        UNIQUE (workspace_id, client_instance_id)
      );
      CREATE INDEX IF NOT EXISTS sessions_workspace_presence_idx
        ON sessions(workspace_id, left_at, presence_expires_at);

      CREATE TABLE coordination_sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        worktree_id TEXT NOT NULL REFERENCES worktrees(id),
        actor TEXT NOT NULL,
        role TEXT,
        parent_session_id TEXT REFERENCES coordination_sessions(id),
        status TEXT NOT NULL CHECK(status IN ('active', 'ended')),
        generation INTEGER NOT NULL,
        token_hash TEXT NOT NULL,
        joined_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        ended_at TEXT,
        cursor_epoch_id TEXT NOT NULL,
        cursor_sequence INTEGER NOT NULL,
        cursor_hash TEXT NOT NULL,
        cursor_version INTEGER NOT NULL DEFAULT 0,
        reset_generation INTEGER NOT NULL DEFAULT 0,
        cursor_recovery_required INTEGER NOT NULL DEFAULT 0
          CHECK(cursor_recovery_required IN (0, 1))
      );
      CREATE INDEX coordination_sessions_workspace_status_idx
        ON coordination_sessions(workspace_id, status, last_seen_at);

      CREATE TABLE reports (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        task_id TEXT,
        from_session_id TEXT REFERENCES coordination_sessions(id),
        from_actor TEXT NOT NULL,
        to_session_id TEXT REFERENCES coordination_sessions(id),
        kind TEXT NOT NULL CHECK(kind IN ('observation', 'inference', 'proposal', 'decision')),
        body TEXT NOT NULL,
        evidence_refs_json TEXT NOT NULL,
        confidence TEXT NOT NULL CHECK(confidence IN ('high', 'medium', 'low', 'unknown')),
        confidence_basis TEXT,
        limits TEXT,
        relation TEXT NOT NULL CHECK(relation IN ('informs', 'supports', 'challenges', 'corrects', 'withdraws', 'supersedes', 'resolves')),
        target_report_id TEXT REFERENCES reports(id),
        authority_scope TEXT,
        authority_basis TEXT,
        created_at TEXT NOT NULL,
        event_sequence INTEGER NOT NULL,
        FOREIGN KEY (workspace_id, task_id) REFERENCES tasks(workspace_id, id)
      );
      CREATE INDEX reports_workspace_event_idx
        ON reports(workspace_id, event_sequence);
      CREATE INDEX reports_target_idx ON reports(target_report_id);

      CREATE TABLE task_reviews (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        review_generation INTEGER NOT NULL,
        outcome TEXT NOT NULL CHECK(outcome IN ('accepted', 'changes_requested')),
        summary TEXT NOT NULL,
        reviewer_actor TEXT NOT NULL,
        reviewer_session_id TEXT NOT NULL REFERENCES coordination_sessions(id),
        created_at TEXT NOT NULL,
        event_sequence INTEGER NOT NULL,
        UNIQUE(workspace_id, task_id, review_generation),
        FOREIGN KEY (workspace_id, task_id) REFERENCES tasks(workspace_id, id)
      );

      CREATE TABLE task_recoveries (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        prior_lease_id TEXT NOT NULL,
        prior_session_id TEXT,
        recovered_by_session_id TEXT NOT NULL REFERENCES coordination_sessions(id),
        action TEXT NOT NULL CHECK(action IN ('takeover', 'release', 'block')),
        note TEXT NOT NULL,
        prior_checkpoint_json TEXT,
        new_lease_id TEXT,
        recovered_at TEXT NOT NULL,
        event_sequence INTEGER NOT NULL,
        UNIQUE(workspace_id, task_id, prior_lease_id),
        FOREIGN KEY (workspace_id, task_id) REFERENCES tasks(workspace_id, id)
      );

      CREATE TABLE session_cursor_resets (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES coordination_sessions(id),
        from_epoch_id TEXT NOT NULL,
        from_sequence INTEGER NOT NULL,
        from_hash TEXT NOT NULL,
        to_epoch_id TEXT NOT NULL,
        to_sequence INTEGER NOT NULL,
        to_hash TEXT NOT NULL,
        reason TEXT NOT NULL,
        reset_generation INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE v2_write_guard (
        nonce TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL CHECK(enabled = 1)
      );

      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        protocol TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    this.migrationFailpoint?.("v2_tables_created");
    const now = this.timestamp();
    const workspaces = this.db.query(`
      SELECT id, root_path FROM workspaces ORDER BY created_at, id
    `).all();
    for (const workspace of workspaces) {
      const identity = identities.get(workspace.id);
      if (!identity) {
        throw new CollabError("migration_identity_missing", "A prepared legacy repository identity is missing", { workspace_id: workspace.id });
      }
      this.db.query(`INSERT OR IGNORE INTO repositories (key, created_at) VALUES (?, ?)`).run(identity.repository_key, now);
      this.db.query(`UPDATE workspaces SET repository_key = ? WHERE id = ?`).run(identity.repository_key, workspace.id);
      this.db.query(`
        INSERT INTO worktrees (
          id, workspace_id, repository_key, root_path, git_common_dir_hash, fingerprint,
          branch, head_sha, dirty, registered_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(identity.checkpoint.worktree_id, workspace.id, identity.repository_key, identity.root_path, identity.git_common_dir_hash, identity.worktree_fingerprint, identity.checkpoint.branch, identity.checkpoint.head_sha, booleanToSql(identity.checkpoint.dirty), now, now);
    }
    this.migrationFailpoint?.("v1_rows_backfilled");
    this.db.exec(`
      CREATE INDEX workspaces_repository_idx ON workspaces(repository_key);

      CREATE TRIGGER tasks_v2_insert_guard
      BEFORE INSERT ON tasks
      WHEN NEW.coordination_mode = 'session_v2'
        AND NOT EXISTS (SELECT 1 FROM v2_write_guard WHERE enabled = 1)
      BEGIN
        SELECT RAISE(ABORT, 'agenttool_collab_v2_write_requires_v2_client');
      END;

      CREATE TRIGGER tasks_v2_update_guard
      BEFORE UPDATE ON tasks
      WHEN (OLD.coordination_mode = 'session_v2' OR NEW.coordination_mode = 'session_v2')
        AND NOT EXISTS (SELECT 1 FROM v2_write_guard WHERE enabled = 1)
      BEGIN
        SELECT RAISE(ABORT, 'agenttool_collab_v2_write_requires_v2_client');
      END;

      CREATE TRIGGER tasks_v2_delete_guard
      BEFORE DELETE ON tasks
      WHEN OLD.coordination_mode = 'session_v2'
        AND NOT EXISTS (SELECT 1 FROM v2_write_guard WHERE enabled = 1)
      BEGIN
        SELECT RAISE(ABORT, 'agenttool_collab_v2_write_requires_v2_client');
      END;

      CREATE TRIGGER artifacts_v2_insert_guard
      BEFORE INSERT ON artifacts
      WHEN EXISTS (
        SELECT 1 FROM tasks
        WHERE workspace_id = NEW.workspace_id AND id = NEW.task_id
          AND coordination_mode = 'session_v2'
      )
        AND NOT EXISTS (SELECT 1 FROM v2_write_guard WHERE enabled = 1)
      BEGIN
        SELECT RAISE(ABORT, 'agenttool_collab_v2_write_requires_v2_client');
      END;

      CREATE TRIGGER handoffs_v2_insert_guard
      BEFORE INSERT ON handoffs
      WHEN EXISTS (
        SELECT 1 FROM tasks
        WHERE workspace_id = NEW.workspace_id AND id = NEW.task_id
          AND coordination_mode = 'session_v2'
      )
        AND NOT EXISTS (SELECT 1 FROM v2_write_guard WHERE enabled = 1)
      BEGIN
        SELECT RAISE(ABORT, 'agenttool_collab_v2_write_requires_v2_client');
      END;
    `);
    this.migrationFailpoint?.("v2_guards_created");
    const headsAfter = this.db.query(`
      SELECT id, epoch_id, event_head_sequence, event_head_hash
      FROM workspaces ORDER BY id
    `).all();
    if (canonicalJson(headsAfter) !== canonicalJson(journalHeads)) {
      throw new CollabError("migration_journal_changed", "Migration attempted to change a pre-existing journal head");
    }
    const foreignKeyFailures = this.db.query(`PRAGMA foreign_key_check`).all();
    if (foreignKeyFailures.length > 0) {
      throw new CollabError("migration_foreign_key_failure", "Migration would leave invalid foreign-key references", { failures: foreignKeyFailures.length });
    }
    const integrity = this.db.query(`PRAGMA integrity_check`).get();
    if (integrity.integrity_check !== "ok") {
      throw new CollabError("migration_integrity_failure", "SQLite integrity verification failed during migration");
    }
    const insertMigration = this.db.query(`
      INSERT INTO schema_migrations (version, protocol, applied_at)
      VALUES (?, ?, ?)
    `);
    insertMigration.run(HARDENED_PREVIEW_SCHEMA_VERSION, COLLAB_COORDINATION_PROTOCOL, now);
    insertMigration.run(SCHEMA_VERSION, COLLAB_COORDINATION_PROTOCOL, now);
    this.migrationFailpoint?.("v2_verified");
  }
  migrateHardenedPreviewToV3() {
    this.validateV2Shape("sessions", [HARDENED_PREVIEW_SCHEMA_VERSION]);
    const journalHeads = this.db.query(`
      SELECT id, epoch_id, event_head_sequence, event_head_hash
      FROM workspaces ORDER BY id
    `).all();
    const sessionRows = this.db.query(`
      SELECT * FROM sessions ORDER BY id
    `).all();
    this.db.exec(`
      ALTER TABLE sessions RENAME TO coordination_sessions;
      DROP INDEX sessions_workspace_status_idx;
      CREATE INDEX coordination_sessions_workspace_status_idx
        ON coordination_sessions(workspace_id, status, last_seen_at);

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id),
        epoch_id TEXT NOT NULL,
        client_instance_id TEXT NOT NULL,
        actor_label TEXT NOT NULL,
        actor_key TEXT NOT NULL UNIQUE,
        runtime_kind TEXT NOT NULL,
        provider_label TEXT,
        model_label TEXT,
        declared_capabilities_json TEXT NOT NULL,
        version INTEGER NOT NULL,
        joined_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        presence_expires_at TEXT NOT NULL,
        left_at TEXT,
        UNIQUE (workspace_id, client_instance_id)
      );
      CREATE INDEX sessions_workspace_presence_idx
        ON sessions(workspace_id, left_at, presence_expires_at);
    `);
    this.migrationFailpoint?.("v3_session_planes_created");
    const migratedRows = this.db.query(`
      SELECT * FROM coordination_sessions ORDER BY id
    `).all();
    if (canonicalJson(migratedRows) !== canonicalJson(sessionRows)) {
      throw new CollabError("migration_session_rows_changed", "Credential-bound preview session rows changed during the v0.3 table rename");
    }
    const headsAfter = this.db.query(`
      SELECT id, epoch_id, event_head_sequence, event_head_hash
      FROM workspaces ORDER BY id
    `).all();
    if (canonicalJson(headsAfter) !== canonicalJson(journalHeads)) {
      throw new CollabError("migration_journal_changed", "Migration attempted to change a pre-existing journal head");
    }
    this.db.query(`
      INSERT INTO schema_migrations (version, protocol, applied_at)
      VALUES (?, ?, ?)
    `).run(SCHEMA_VERSION, COLLAB_COORDINATION_PROTOCOL, this.timestamp());
    if (this.db.query("PRAGMA foreign_key_check").all().length > 0) {
      throw new CollabError("migration_foreign_key_failure", "Migration would leave invalid foreign-key references");
    }
    const integrity = this.db.query("PRAGMA integrity_check").get();
    if (integrity.integrity_check !== "ok") {
      throw new CollabError("migration_integrity_failure", "SQLite integrity verification failed during migration");
    }
    this.migrationFailpoint?.("v3_verified");
  }
  tableNames() {
    const rows = this.db.query(`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all();
    return rows.map((row) => row.name);
  }
  hasColumn(table, column) {
    return this.tableColumns(table).includes(column);
  }
  tableColumns(table) {
    const rows = this.db.query(`PRAGMA table_info(${quoteIdentifier(table)})`).all();
    return rows.map((row) => row.name);
  }
  hasExactColumns(table, columns) {
    return canonicalJson(this.tableColumns(table)) === canonicalJson(columns);
  }
  validateLegacyOrV2Shape(userVersion) {
    const required = {
      workspaces: [
        "id",
        "epoch_id",
        "root_path",
        "name",
        "created_at",
        "event_head_sequence",
        "event_head_hash"
      ],
      tasks: [
        "id",
        "workspace_id",
        "title",
        "description",
        "status",
        "dependencies_json",
        "path_scopes_json",
        "assignee",
        "lease_id",
        "lease_expires_at",
        "blocker",
        "latest_progress",
        "version",
        "created_at",
        "updated_at",
        "completed_at"
      ],
      artifacts: [
        "id",
        "workspace_id",
        "task_id",
        "kind",
        "uri",
        "sha256",
        "media_type",
        "label",
        "attached_by",
        "attached_at"
      ],
      decisions: [
        "id",
        "workspace_id",
        "topic",
        "decision",
        "rationale",
        "recorded_by",
        "recorded_at"
      ],
      handoffs: [
        "id",
        "workspace_id",
        "task_id",
        "from_actor",
        "to_actor",
        "summary",
        "status",
        "offered_at",
        "expires_at",
        "resolved_at"
      ],
      events: [
        "workspace_id",
        "epoch_id",
        "sequence",
        "id",
        "protocol",
        "type",
        "entity_id",
        "actor",
        "occurred_at",
        "payload_json",
        "prev_hash",
        "hash"
      ],
      mutations: [
        "workspace_id",
        "actor",
        "idempotency_key",
        "operation",
        "request_hash",
        "response_json",
        "created_at"
      ]
    };
    this.requireColumns(required, "The SQLite file is not a complete agenttool collaboration database");
    const names = new Set(this.tableNames());
    const hasV2Marker = names.has("coordination_sessions") || names.has("schema_migrations") || this.hasColumn("workspaces", "repository_key") || this.hasColumn("tasks", "coordination_mode") || this.hasColumn("events", "session_id");
    if (userVersion < HARDENED_PREVIEW_SCHEMA_VERSION) {
      if (hasV2Marker || pragmaNumber(this.db, "application_id") !== 0 || names.has("sessions") && !this.hasExactColumns("sessions", PRESENCE_SESSION_COLUMNS)) {
        throw new CollabError("database_partial_migration", "The collaboration database has unrecognized hardened objects without a committed schema version");
      }
      return;
    }
    if (userVersion === HARDENED_PREVIEW_SCHEMA_VERSION) {
      if (names.has("coordination_sessions")) {
        throw new CollabError("database_partial_migration", "The hardened preview database has an unexpected coordination-session table name");
      }
      this.validateV2Shape("sessions", [HARDENED_PREVIEW_SCHEMA_VERSION]);
      return;
    }
    if (userVersion === SCHEMA_VERSION) {
      this.validateV2Shape("coordination_sessions", [
        HARDENED_PREVIEW_SCHEMA_VERSION,
        SCHEMA_VERSION
      ]);
    }
  }
  validateV2Shape(sessionTable, expectedMigrationVersions) {
    const required = {
      workspaces: ["repository_key"],
      tasks: [
        "coordination_mode",
        "work_mode",
        "completion_policy",
        "review_status",
        "review_generation",
        "expected_base_sha",
        "base_checkpoint_json",
        "result_checkpoint_json",
        "completion_report_id",
        "assignee_session_id",
        "claim_worktree_id",
        "reported_by",
        "reported_by_session_id",
        "reported_at",
        "accepted_by",
        "accepted_by_session_id",
        "accepted_at"
      ],
      artifacts: ["attached_by_session_id"],
      handoffs: ["from_session_id", "to_session_id"],
      events: ["session_id"],
      repositories: ["key", "created_at"],
      worktrees: [
        "id",
        "workspace_id",
        "repository_key",
        "root_path",
        "git_common_dir_hash",
        "fingerprint",
        "branch",
        "head_sha",
        "dirty",
        "registered_at",
        "last_seen_at"
      ],
      [sessionTable]: [...COORDINATION_SESSION_COLUMNS],
      reports: [
        "id",
        "workspace_id",
        "task_id",
        "from_session_id",
        "from_actor",
        "to_session_id",
        "kind",
        "body",
        "evidence_refs_json",
        "confidence",
        "confidence_basis",
        "limits",
        "relation",
        "target_report_id",
        "authority_scope",
        "authority_basis",
        "created_at",
        "event_sequence"
      ],
      task_reviews: [
        "id",
        "workspace_id",
        "task_id",
        "review_generation",
        "outcome",
        "summary",
        "reviewer_actor",
        "reviewer_session_id",
        "created_at",
        "event_sequence"
      ],
      task_recoveries: [
        "id",
        "workspace_id",
        "task_id",
        "prior_lease_id",
        "prior_session_id",
        "recovered_by_session_id",
        "action",
        "note",
        "prior_checkpoint_json",
        "new_lease_id",
        "recovered_at",
        "event_sequence"
      ],
      session_cursor_resets: [
        "id",
        "session_id",
        "from_epoch_id",
        "from_sequence",
        "from_hash",
        "to_epoch_id",
        "to_sequence",
        "to_hash",
        "reason",
        "reset_generation",
        "created_at"
      ],
      v2_write_guard: ["nonce", "enabled"],
      schema_migrations: ["version", "protocol", "applied_at"]
    };
    this.requireColumns(required, "The hardened collaboration schema is incomplete");
    if (!this.hasExactColumns(sessionTable, COORDINATION_SESSION_COLUMNS)) {
      throw new CollabError("database_schema_mismatch", "The credential-bound coordination session table has an unexpected shape");
    }
    if (sessionTable === "coordination_sessions" && !this.hasExactColumns("sessions", PRESENCE_SESSION_COLUMNS)) {
      throw new CollabError("database_schema_mismatch", "The self-declared presence session table has an unexpected shape");
    }
    const triggers = this.db.query(`
      SELECT name, sql FROM sqlite_master
      WHERE type = 'trigger' AND name IN (${V2_GUARD_TRIGGERS.map(() => "?").join(", ")})
    `).all(...V2_GUARD_TRIGGERS);
    const byName = new Map(triggers.map((trigger) => [trigger.name, trigger.sql ?? ""]));
    for (const trigger of V2_GUARD_TRIGGERS) {
      const sql = byName.get(trigger);
      if (!sql || !sql.includes("v2_write_guard") || !sql.includes("agenttool_collab_v2_write_requires_v2_client")) {
        throw new CollabError("database_schema_mismatch", "A required v0.2 write guard is missing or malformed", { trigger });
      }
    }
    const migrationRows = this.db.query(`
      SELECT version, protocol FROM schema_migrations ORDER BY version
    `).all();
    if (canonicalJson(migrationRows.map((row) => row.version)) !== canonicalJson(expectedMigrationVersions) || migrationRows.some((row) => row.protocol !== COLLAB_COORDINATION_PROTOCOL)) {
      throw new CollabError("database_migration_receipt_invalid", "The collaboration schema migration ledger is missing or inconsistent");
    }
    const staleGuards = this.db.query(`SELECT COUNT(*) AS count FROM v2_write_guard`).get();
    if (staleGuards.count !== 0) {
      throw new CollabError("database_write_guard_invalid", "The v0.2 write guard contains unexpected persistent state");
    }
    if (this.db.query(`PRAGMA foreign_key_check`).all().length > 0) {
      throw new CollabError("database_foreign_key_failure", "The collaboration database contains invalid foreign-key references");
    }
  }
  requireColumns(required, message) {
    const names = new Set(this.tableNames());
    for (const [table, columns] of Object.entries(required)) {
      if (!names.has(table)) {
        throw new CollabError("database_schema_mismatch", message, {
          missing_table: table
        });
      }
      for (const column of columns) {
        if (!this.hasColumn(table, column)) {
          throw new CollabError("database_schema_mismatch", message, {
            table,
            missing_column: column
          });
        }
      }
    }
  }
  validateAllJournals() {
    const workspaces = this.db.query(`SELECT id FROM workspaces ORDER BY id`).all();
    for (const workspace of workspaces) {
      if (!this.verifyJournalRows(workspace.id)) {
        throw new CollabError("database_journal_invalid", "A workspace event journal failed hash-chain verification", { workspace_id: workspace.id });
      }
    }
  }
  tightenFileModes() {
    if (!this.filesystemPath)
      return;
    for (const path of [this.filesystemPath, `${this.filesystemPath}-wal`, `${this.filesystemPath}-shm`]) {
      if (!existsSync3(path))
        continue;
      const stat = lstatSync3(path);
      if (!stat.isFile() || stat.isSymbolicLink() || typeof process.getuid === "function" && stat.uid !== process.getuid()) {
        throw new CollabError("database_sidecar_unsafe", "A collaboration database or sidecar path is not a regular file owned by this user", { operation: "tighten_database_file_mode" });
      }
      chmodSync2(path, 384);
    }
  }
  discoverRepositoryKey(budget, probe) {
    const now = this.repositoryDiscovery.now();
    const fullSlice = budget.deadline === undefined;
    budget.deadline ??= now + this.repositoryDiscovery.budget_ms;
    if (now >= budget.deadline)
      return;
    try {
      return probe({ ...this.repositoryDiscovery, deadline: budget.deadline });
    } catch (error) {
      if (error instanceof RepositoryProbeTimeout && !fullSlice)
        return;
      return null;
    }
  }
  prepareRepositoryAliases(budget) {
    const rows = this.db.query(`
      SELECT w.* FROM worktrees w
      LEFT JOIN repository_discovery d ON d.worktree_id = w.id AND d.fingerprint = w.fingerprint
      WHERE d.worktree_id IS NULL AND w.repository_key LIKE 'local-git:%'
      ORDER BY w.id
    `).iterate();
    const prepared = [];
    for (const row of rows) {
      const key = this.discoverRepositoryKey(budget, (options) => {
        const identity = inspectRepository(row.root_path, undefined, true, options);
        if (identity.repository_key === row.repository_key && identity.worktree_fingerprint === row.fingerprint) {
          return identity.portable_repository_key ?? null;
        }
        return null;
      });
      if (key === undefined)
        break;
      prepared.push({ row, key });
    }
    return prepared;
  }
  recordRepositoryAlias(worktreeId2, key) {
    if (key)
      this.db.query(`INSERT OR IGNORE INTO repository_aliases (worktree_id, portable_key) VALUES (?, ?)`).run(worktreeId2, key);
  }
  recordRepositoryDiscovery(worktreeId2, fingerprint, key) {
    if (key === undefined)
      return;
    this.recordRepositoryAlias(worktreeId2, key);
    this.db.query(`INSERT INTO repository_discovery (worktree_id, fingerprint, outcome) VALUES (?, ?, ?)
      ON CONFLICT(worktree_id) DO UPDATE SET fingerprint = excluded.fingerprint, outcome = excluded.outcome`).run(worktreeId2, fingerprint, key ? "checked" : "unresolvable");
  }
  repositoryPartitions(identity) {
    return this.db.query(`
      SELECT DISTINCT w.id FROM workspaces w
      LEFT JOIN worktrees t ON t.workspace_id = w.id
      WHERE w.repository_key = ? OR t.repository_key = ?
      ORDER BY w.created_at, w.id
    `).all(identity.repository_key, identity.repository_key);
  }
  portableRepositoryWorkspace(key) {
    if (!key)
      return;
    const pending = this.db.query(`SELECT 1 FROM worktrees w LEFT JOIN repository_discovery d
      ON d.worktree_id = w.id AND d.fingerprint = w.fingerprint
      WHERE d.worktree_id IS NULL AND w.repository_key LIKE 'local-git:%' LIMIT 1`).get();
    if (pending)
      return;
    const matches = this.db.query(`SELECT DISTINCT w.workspace_id AS id FROM worktrees w
      JOIN repository_aliases a ON a.worktree_id = w.id WHERE a.portable_key = ? LIMIT 2`).all(key);
    return matches.length === 1 ? matches[0] : undefined;
  }
  openWorkspace(input) {
    const actor = validateActor(input.actor);
    const identity = inspectRepository(input.root_path, input.repository_key, false, { portable: false });
    const budget = {};
    const cached = this.db.query(`SELECT a.portable_key FROM repository_discovery d
      LEFT JOIN repository_aliases a ON a.worktree_id = d.worktree_id
      WHERE d.worktree_id = ? AND d.fingerprint = ?`).get(identity.checkpoint.worktree_id, identity.worktree_fingerprint);
    const registered = this.db.query(`SELECT 1 FROM worktrees WHERE root_path = ?`).get(identity.root_path);
    const aliases = !registered && this.repositoryPartitions(identity).length === 0 && identity.repository_key.startsWith("local-git:") ? this.prepareRepositoryAliases(budget) : [];
    identity.portable_repository_key = cached ? cached.portable_key : identity.repository_key.startsWith("local-git:") ? this.discoverRepositoryKey(budget, (options) => portableRepositoryKey(identity.root_path, options)) : null;
    const created = this.db.transaction(() => {
      const now = this.timestamp();
      for (const { row, key } of aliases) {
        const current = this.requireWorktreeRow(row.id);
        if (current.root_path !== row.root_path || current.fingerprint !== row.fingerprint || current.repository_key !== row.repository_key || current.workspace_id !== row.workspace_id) {
          continue;
        }
        this.recordRepositoryDiscovery(row.id, row.fingerprint, key);
      }
      const existingWorktree = this.db.query(`
        SELECT * FROM worktrees WHERE root_path = ?
      `).get(identity.root_path);
      if (existingWorktree) {
        if (existingWorktree.repository_key !== identity.repository_key || existingWorktree.fingerprint !== identity.worktree_fingerprint) {
          throw new CollabError("worktree_identity_changed", "This path now resolves to a different repository/worktree identity", {
            root_path: identity.root_path,
            registered_worktree_id: existingWorktree.id
          });
        }
        this.recordRepositoryDiscovery(existingWorktree.id, identity.worktree_fingerprint, identity.portable_repository_key);
        this.touchWorktree(existingWorktree, identity.checkpoint, now);
        return this.requireWorkspace(existingWorktree.workspace_id);
      }
      const partitions = this.repositoryPartitions(identity);
      if (partitions.length > 1) {
        throw new CollabError("repository_partitioned", "Multiple preserved journals require explicit reconciliation", {
          workspace_ids: partitions.map((partition) => partition.id)
        });
      }
      const repositoryWorkspace = partitions[0] ?? this.portableRepositoryWorkspace(identity.portable_repository_key);
      const id = repositoryWorkspace?.id ?? `ws_${sha2563(identity.repository_key).slice(0, 24)}`;
      const existing = this.getWorkspace(id);
      if (existing && !repositoryWorkspace) {
        throw new CollabError("workspace_identity_collision", "Workspace identity collision");
      }
      if (existing) {
        this.registerWorktree(existing.id, identity, now, actor, true);
        this.recordRepositoryDiscovery(identity.checkpoint.worktree_id, identity.worktree_fingerprint, identity.portable_repository_key);
        return this.requireWorkspace(existing.id);
      }
      const epochId = `epoch_${randomUUID()}`;
      const name = cleanText(input.name ?? identity.root_path.split("/").at(-1) ?? id, "name", 200);
      this.db.query(`INSERT OR IGNORE INTO repositories (key, created_at) VALUES (?, ?)`).run(identity.repository_key, now);
      this.db.query(`
        INSERT INTO workspaces
          (id, epoch_id, root_path, repository_key, name, created_at,
            event_head_sequence, event_head_hash)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?)
      `).run(id, epochId, identity.root_path, identity.repository_key, name, now, GENESIS_HASH);
      this.registerWorktree(id, identity, now, actor, false);
      this.recordRepositoryDiscovery(identity.checkpoint.worktree_id, identity.worktree_fingerprint, identity.portable_repository_key);
      this.appendEvent(id, "workspace.opened", id, actor, {
        root_path: identity.root_path,
        repository_key: identity.repository_key,
        worktree_id: identity.checkpoint.worktree_id,
        name,
        rights_profile: "xenia.rights/0.1"
      });
      return this.requireWorkspace(id);
    }).immediate();
    this.tightenFileModes();
    return created;
  }
  getWorkspace(workspaceId, db = this.db) {
    const row = db.query(`
      SELECT id, epoch_id, root_path, repository_key, name, created_at,
        event_head_sequence, event_head_hash
      FROM workspaces WHERE id = ?
    `).get(workspaceId);
    return row ? { ...row } : null;
  }
  getWorktree(workspaceId, rootPath) {
    const identity = inspectRepository(rootPath);
    const row = this.db.query(`
      SELECT * FROM worktrees WHERE workspace_id = ? AND root_path = ?
    `).get(workspaceId, identity.root_path);
    return row ? worktreeFromRow(row) : null;
  }
  joinSession(input) {
    const normalized = {
      workspace_id: validateId(input.workspace_id, "workspace_id"),
      client_instance_id: validateId(input.client_instance_id, "client_instance_id"),
      actor_label: validateActor(input.actor_label),
      runtime_kind: validateRuntimeKind(input.runtime_kind),
      provider_label: optionalText(input.provider_label, "provider_label", 100),
      model_label: optionalText(input.model_label, "model_label", 200),
      declared_capabilities: normalizeSessionCapabilities(input.declared_capabilities ?? []),
      ttl_seconds: validatePresenceTtl(input.ttl_seconds)
    };
    const workspace = this.requireWorkspace(normalized.workspace_id);
    const transaction = this.db.transaction(() => {
      const existing = this.readPresenceSessionByClient(normalized.workspace_id, normalized.client_instance_id);
      if (existing) {
        requireMatchingPresenceSessionJoin(existing, normalized);
        if (existing.left_at) {
          throw new CollabError("session_instance_ended", "This presence session already left; use a new client_instance_id", { session_id: existing.id });
        }
        return presenceSessionFromRow(existing, this.timestamp());
      }
      const now = this.timestamp();
      const id = `session_${randomUUID()}`;
      const actorKey = `session:${id}`;
      this.db.query(`
        INSERT INTO sessions (
          id, workspace_id, epoch_id, client_instance_id, actor_label, actor_key,
          runtime_kind, provider_label, model_label, declared_capabilities_json,
          version, joined_at, last_seen_at, presence_expires_at, left_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, NULL)
      `).run(id, workspace.id, workspace.epoch_id, normalized.client_instance_id, normalized.actor_label, actorKey, normalized.runtime_kind, normalized.provider_label, normalized.model_label, canonicalJson(normalized.declared_capabilities), now, now, addSeconds(now, normalized.ttl_seconds));
      return presenceSessionFromRow(this.requirePresenceSessionRow(id), now);
    });
    const session = transaction.immediate();
    this.tightenFileModes();
    return session;
  }
  getSession(sessionId) {
    return presenceSessionFromRow(this.requirePresenceSessionRow(validateId(sessionId, "session_id")), this.timestamp());
  }
  listSessions(workspaceId, presence, limit) {
    const id = validateId(workspaceId, "workspace_id");
    this.requireWorkspace(id);
    if (presence !== undefined && presence !== "live" && presence !== "stale" && presence !== "left") {
      throw new CollabError("invalid_presence", "presence must be live, stale, or left");
    }
    const observedAt = this.timestamp();
    const boundedLimit = validateSessionListLimit(limit);
    let rows;
    if (presence === "live") {
      rows = this.db.query(`
        SELECT * FROM sessions
        WHERE workspace_id = ? AND left_at IS NULL AND presence_expires_at > ?
        ORDER BY joined_at DESC, id DESC LIMIT ?
      `).all(id, observedAt, boundedLimit);
    } else if (presence === "stale") {
      rows = this.db.query(`
        SELECT * FROM sessions
        WHERE workspace_id = ? AND left_at IS NULL AND presence_expires_at <= ?
        ORDER BY joined_at DESC, id DESC LIMIT ?
      `).all(id, observedAt, boundedLimit);
    } else if (presence === "left") {
      rows = this.db.query(`
        SELECT * FROM sessions
        WHERE workspace_id = ? AND left_at IS NOT NULL
        ORDER BY joined_at DESC, id DESC LIMIT ?
      `).all(id, boundedLimit);
    } else {
      rows = this.db.query(`
        SELECT * FROM sessions
        WHERE workspace_id = ?
        ORDER BY joined_at DESC, id DESC LIMIT ?
      `).all(id, boundedLimit);
    }
    return rows.map((row) => presenceSessionFromRow(row, observedAt));
  }
  heartbeatSession(input) {
    const normalized = {
      session_id: validateId(input.session_id, "session_id"),
      idempotency_key: validateIdempotencyKey(input.idempotency_key),
      expected_version: validateExpectedVersion(input.expected_version),
      ttl_seconds: validatePresenceTtl(input.ttl_seconds)
    };
    const initial = this.requirePresenceSessionRow(normalized.session_id);
    return this.mutate(initial.workspace_id, initial.actor_key, normalized.idempotency_key, "session.heartbeat", normalized, () => {
      const row = this.requirePresenceSessionRow(normalized.session_id);
      requirePresenceSessionVersion(row, normalized.expected_version);
      if (row.left_at) {
        throw new CollabError("session_left", "An explicitly left presence session cannot heartbeat", { session_id: row.id });
      }
      const now = this.timestamp();
      this.db.query(`
          UPDATE sessions
          SET version = ?, last_seen_at = ?, presence_expires_at = ?
          WHERE id = ?
        `).run(row.version + 1, now, addSeconds(now, normalized.ttl_seconds), row.id);
      return presenceSessionFromRow(this.requirePresenceSessionRow(row.id), now);
    });
  }
  leaveSession(input) {
    const normalized = {
      session_id: validateId(input.session_id, "session_id"),
      idempotency_key: validateIdempotencyKey(input.idempotency_key),
      expected_version: validateExpectedVersion(input.expected_version)
    };
    const initial = this.requirePresenceSessionRow(normalized.session_id);
    return this.mutate(initial.workspace_id, initial.actor_key, normalized.idempotency_key, "session.leave", normalized, () => {
      const row = this.requirePresenceSessionRow(normalized.session_id);
      requirePresenceSessionVersion(row, normalized.expected_version);
      const now = this.timestamp();
      if (!row.left_at) {
        this.db.query(`
            UPDATE sessions SET version = ?, left_at = ? WHERE id = ?
          `).run(row.version + 1, now, row.id);
      }
      return presenceSessionFromRow(this.requirePresenceSessionRow(row.id), now);
    });
  }
  startSession(input) {
    const actor = validateActor(input.actor);
    const role = optionalText(input.role, "role", 200);
    const identity = inspectRepository(input.root_path, input.repository_key, true, { portable: false });
    const workspace = this.openWorkspace({
      root_path: input.root_path,
      actor,
      repository_key: input.repository_key
    });
    const worktreeRow = this.db.query(`
      SELECT * FROM worktrees WHERE workspace_id = ? AND root_path = ?
    `).get(workspace.id, identity.root_path);
    if (!worktreeRow) {
      throw new CollabError("worktree_not_found", "The session worktree was not registered");
    }
    const parentSessionId = input.parent_session_id ? validateId(input.parent_session_id, "parent_session_id") : null;
    const joined = this.db.transaction(() => {
      const partitions = this.repositoryPartitions(identity);
      if (partitions.length > 1) {
        throw new CollabError("repository_partitioned", "Multiple preserved journals require explicit reconciliation before session start", {
          workspace_ids: partitions.map((partition) => partition.id)
        });
      }
      if (parentSessionId) {
        const parent = this.requireCoordinationSessionRow(parentSessionId);
        if (parent.workspace_id !== workspace.id) {
          throw new CollabError("parent_session_mismatch", "A parent session must belong to the same workspace");
        }
      }
      const now = this.timestamp();
      const id = `session_${randomUUID()}`;
      const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
      const generation = 1;
      this.db.query(`
        INSERT INTO coordination_sessions (
          id, workspace_id, worktree_id, actor, role, parent_session_id, status,
          generation, token_hash, joined_at, last_seen_at, ended_at,
          cursor_epoch_id, cursor_sequence, cursor_hash, cursor_version, reset_generation
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, NULL, ?, 0, ?, 0, 0)
      `).run(id, workspace.id, worktreeRow.id, actor, role, parentSessionId, generation, hashSessionToken(token), now, now, workspace.epoch_id, GENESIS_HASH);
      this.appendEvent(workspace.id, "session.joined", id, actor, {
        worktree_id: worktreeRow.id,
        role,
        parent_session_id: parentSessionId,
        identity_boundary: "session_credentials_fence_cooperating_local_clients_but_do_not_authenticate_a_person_or_model"
      }, id);
      return this.sessionHandle(this.requireCoordinationSessionRow(id), token, this.requireWorkspace(workspace.id), worktreeRow);
    }).immediate();
    this.tightenFileModes();
    return joined;
  }
  resumeSession(credential, options = {}) {
    const sessionId = validateId(credential.session_id, "session_id");
    const resumed = this.db.transaction(() => {
      const row = this.authenticateResumeToken(sessionId, credential.session_token);
      const now = this.timestamp();
      this.recordSessionLeaseLapses(row, now);
      const nextGeneration = row.generation + 1;
      const persistedCursor = {
        epoch_id: row.cursor_epoch_id,
        sequence: row.cursor_sequence,
        hash: row.cursor_hash
      };
      let recovery = row.cursor_recovery_required !== 0 ? {
        required: true,
        cause: "host_cursor_mismatch",
        persisted_cursor: persistedCursor,
        host_cursor: credential.last_cursor ?? null,
        expected_cursor_version: row.cursor_version
      } : undefined;
      try {
        this.validateEventAnchor(row.workspace_id, persistedCursor);
      } catch (error) {
        if (error instanceof CollabError) {
          recovery = {
            required: true,
            cause: "persisted_cursor_invalid",
            persisted_cursor: persistedCursor,
            host_cursor: credential.last_cursor ?? null,
            expected_cursor_version: row.cursor_version
          };
        } else {
          throw error;
        }
      }
      if (!recovery && credential.last_cursor) {
        try {
          const known = this.validateEventAnchor(row.workspace_id, credential.last_cursor);
          if (known.epoch_id !== persistedCursor.epoch_id || known.sequence !== persistedCursor.sequence || known.hash !== persistedCursor.hash) {
            recovery = {
              required: true,
              cause: "host_cursor_mismatch",
              persisted_cursor: persistedCursor,
              host_cursor: known,
              expected_cursor_version: row.cursor_version
            };
          }
        } catch (error) {
          if (error instanceof CollabError) {
            recovery = {
              required: true,
              cause: "host_cursor_invalid",
              persisted_cursor: persistedCursor,
              host_cursor: credential.last_cursor,
              expected_cursor_version: row.cursor_version
            };
          } else {
            throw error;
          }
        }
      }
      if (recovery && !options.allow_cursor_recovery) {
        throw new CollabError("cursor_reset_required", "The host and persisted session cursors require an explicit audited reset", { ...recovery });
      }
      const changed = this.db.query(`
        UPDATE coordination_sessions
        SET generation = ?, last_seen_at = ?, cursor_recovery_required = ?
        WHERE id = ? AND generation = ? AND status = 'active'
      `).run(nextGeneration, now, recovery ? 1 : 0, sessionId, row.generation);
      if (changed.changes !== 1) {
        throw new CollabError("session_auth_failed", "Session credentials are invalid");
      }
      this.appendEvent(row.workspace_id, "session.resumed", row.id, row.actor, {
        worktree_id: row.worktree_id,
        generation: nextGeneration,
        cursor_recovery_required: recovery?.required ?? false,
        cursor_recovery_cause: recovery?.cause ?? null
      }, row.id);
      const next = this.requireCoordinationSessionRow(row.id);
      const workspace = this.requireWorkspace(row.workspace_id);
      const worktree = this.requireWorktreeRow(row.worktree_id);
      const handle = this.sessionHandle(next, credential.session_token, workspace, worktree);
      if (recovery) {
        handle.cursor_recovery = recovery;
        handle.credential.last_cursor = credential.last_cursor;
      }
      return handle;
    }).immediate();
    this.tightenFileModes();
    return resumed;
  }
  endSession(input) {
    return this.endSessionWithReleases(input).session;
  }
  endSessionWithReleases(input) {
    const reason = optionalText(input.reason, "reason", 2000);
    if (input.release_leases !== undefined && typeof input.release_leases !== "boolean") {
      throw new CollabError("invalid_release_leases", "release_leases must be a boolean");
    }
    const releaseLeases = input.release_leases === true;
    if (input.release_summary !== undefined && !releaseLeases) {
      throw new CollabError("invalid_release_summary", "release_summary applies only together with release_leases: true");
    }
    const releaseSummary = optionalText(input.release_summary, "release_summary", 2000);
    const ended = this.db.transaction(() => {
      const row = this.authenticateSession(input, { allow_cursor_recovery: true });
      const now = this.timestamp();
      const releasedLeases = [];
      if (releaseLeases) {
        const held = this.db.query(`
          SELECT * FROM tasks
          WHERE workspace_id = ? AND assignee_session_id = ?
            AND status = 'claimed' AND lease_id IS NOT NULL
          ORDER BY id
        `).all(row.workspace_id, row.id);
        if (held.length > 0) {
          const releaseNote = releaseSummary ?? reason;
          const guardNonce = `guard_${randomUUID()}`;
          this.db.query(`INSERT INTO v2_write_guard (nonce, enabled) VALUES (?, 1)`).run(guardNonce);
          try {
            for (const task of held) {
              const leaseId = task.lease_id;
              const expired = this.isExpired(task, row, now);
              if (expired) {
                const lapsed = this.expireSessionLeaseForRecovery(task, row, now);
                this.recordRecoveryWithoutTakeover(task, row, {
                  prior: lapsed.prior,
                  expiry_version: lapsed.expiryVersion,
                  action: "release",
                  recovery_note: releaseNote ?? SESSION_END_RECOVERY_NOTE,
                  blocker: null,
                  now
                });
                releasedLeases.push({ task_id: task.id, lease_id: leaseId, via: "recovery" });
              } else {
                this.clearSessionClaim(task, row, "task.released", {
                  summary: releaseNote,
                  released_by_session_end: true
                });
                releasedLeases.push({ task_id: task.id, lease_id: leaseId, via: "release" });
              }
            }
          } finally {
            this.db.query(`DELETE FROM v2_write_guard WHERE nonce = ?`).run(guardNonce);
          }
        }
      }
      const refusal = this.liveLeaseRefusal(row.workspace_id, row.id, now);
      if (refusal)
        throw refusal;
      const incomingHandoffs = this.db.query(`
        SELECT * FROM handoffs
        WHERE workspace_id = ? AND to_session_id = ? AND status = 'pending'
        ORDER BY offered_at, id
      `).all(row.workspace_id, row.id);
      for (const handoff of incomingHandoffs) {
        this.db.query(`
          UPDATE handoffs SET status = 'expired', resolved_at = ? WHERE id = ?
        `).run(now, handoff.id);
        this.appendEvent(row.workspace_id, "handoff.expired", handoff.id, row.actor, {
          task_id: handoff.task_id,
          reason: "target_session_ended"
        }, row.id);
      }
      const changed = this.db.query(`
        UPDATE coordination_sessions
        SET status = 'ended', ended_at = ?, last_seen_at = ?, generation = generation + 1,
          token_hash = ?
        WHERE id = ? AND generation = ? AND status = 'active'
      `).run(now, now, hashSessionToken(randomBytes(SESSION_TOKEN_BYTES).toString("base64url")), row.id, row.generation);
      if (changed.changes !== 1) {
        throw new CollabError("session_auth_failed", "Session credentials are invalid");
      }
      this.appendEvent(row.workspace_id, "session.ended", row.id, row.actor, { reason }, row.id);
      return {
        session: this.sessionProjection(this.requireCoordinationSessionRow(row.id)),
        released_leases: releasedLeases
      };
    }).immediate();
    this.tightenFileModes();
    return ended;
  }
  listCoordinationSessions(workspaceId, status) {
    const workspace = this.requireWorkspace(workspaceId);
    const rows = status ? this.db.query(`
          SELECT * FROM coordination_sessions
          WHERE workspace_id = ? AND status = ?
          ORDER BY joined_at, id
        `).all(workspace.id, status) : this.db.query(`
          SELECT * FROM coordination_sessions
          WHERE workspace_id = ?
          ORDER BY joined_at, id
        `).all(workspace.id);
    const observedAt = this.timestamp();
    return rows.map((row) => this.sessionProjection(row, observedAt));
  }
  getCoordinationSession(sessionId) {
    const id = validateId(sessionId, "session_id");
    const row = this.db.query(`SELECT * FROM coordination_sessions WHERE id = ?`).get(id);
    return row ? this.sessionProjection(row) : null;
  }
  preflightSessionEnd(credential) {
    const sessionId = validateId(credential.session_id, "session_id");
    const row = this.authenticateResumeToken(sessionId, credential.session_token);
    const refusal = this.liveLeaseRefusal(row.workspace_id, row.id, this.timestamp(), true);
    if (refusal)
      throw refusal;
  }
  acknowledgeSessionCursor(input) {
    const acknowledged = this.db.transaction(() => {
      const row = this.authenticateSession(input);
      const anchor = this.validateEventAnchor(row.workspace_id, input.anchor);
      this.recordSessionLeaseLapses(row, this.timestamp());
      if (anchor.epoch_id !== row.cursor_epoch_id) {
        throw new CollabError("cursor_epoch_mismatch", "The cursor belongs to another journal epoch");
      }
      if (anchor.sequence < row.cursor_sequence) {
        throw new CollabError("cursor_regression", "A session cursor cannot move backwards", {
          current_sequence: row.cursor_sequence
        });
      }
      if (anchor.sequence === row.cursor_sequence) {
        if (anchor.hash !== row.cursor_hash) {
          throw new CollabError("cursor_fork_detected", "The cursor sequence now resolves to a different journal hash");
        }
        this.db.query(`UPDATE coordination_sessions SET last_seen_at = ? WHERE id = ?`).run(this.timestamp(), row.id);
        return this.sessionProjection(this.requireCoordinationSessionRow(row.id));
      }
      if (row.cursor_version !== input.expected_cursor_version) {
        throw new CollabError("cursor_version_conflict", "The session cursor changed", {
          expected_cursor_version: input.expected_cursor_version,
          current_cursor_version: row.cursor_version
        });
      }
      const now = this.timestamp();
      const changed = this.db.query(`
        UPDATE coordination_sessions
        SET cursor_epoch_id = ?, cursor_sequence = ?, cursor_hash = ?,
          cursor_version = cursor_version + 1, last_seen_at = ?
        WHERE id = ? AND generation = ? AND cursor_version = ? AND status = 'active'
      `).run(anchor.epoch_id, anchor.sequence, anchor.hash, now, row.id, row.generation, row.cursor_version);
      if (changed.changes !== 1) {
        throw new CollabError("cursor_version_conflict", "The session cursor changed");
      }
      return this.sessionProjection(this.requireCoordinationSessionRow(row.id));
    }).immediate();
    this.tightenFileModes();
    return acknowledged;
  }
  resetSessionCursor(input) {
    const reason = cleanText(input.reason, "reason", 2000);
    this.mutateAsSession(input, input.idempotency_key, "cursor.reset.v2", {
      expected_cursor_version: input.expected_cursor_version,
      target: input.target,
      reason
    }, (row) => {
      if (row.cursor_version !== input.expected_cursor_version) {
        throw new CollabError("cursor_version_conflict", "The session cursor changed");
      }
      const target = this.validateEventAnchor(row.workspace_id, input.target);
      const now = this.timestamp();
      const resetGeneration = row.reset_generation + 1;
      const id = `cursor_reset_${randomUUID()}`;
      this.db.query(`
        INSERT INTO session_cursor_resets (
          id, session_id, from_epoch_id, from_sequence, from_hash,
          to_epoch_id, to_sequence, to_hash, reason, reset_generation, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, row.id, row.cursor_epoch_id, row.cursor_sequence, row.cursor_hash, target.epoch_id, target.sequence, target.hash, reason, resetGeneration, now);
      const changed = this.db.query(`
        UPDATE coordination_sessions
        SET cursor_epoch_id = ?, cursor_sequence = ?, cursor_hash = ?,
          cursor_version = cursor_version + 1, reset_generation = ?, last_seen_at = ?,
          cursor_recovery_required = 0
        WHERE id = ? AND generation = ? AND cursor_version = ? AND status = 'active'
      `).run(target.epoch_id, target.sequence, target.hash, resetGeneration, now, row.id, row.generation, row.cursor_version);
      if (changed.changes !== 1) {
        throw new CollabError("cursor_version_conflict", "The session cursor changed");
      }
      this.appendEvent(row.workspace_id, "session.cursor_reset", id, row.actor, {
        from: {
          epoch_id: row.cursor_epoch_id,
          sequence: row.cursor_sequence,
          hash: row.cursor_hash
        },
        to: target,
        reason,
        reset_generation: resetGeneration
      }, row.id);
      return this.sessionProjection(this.requireCoordinationSessionRow(row.id));
    }, { allow_cursor_recovery: true });
    const current = this.authenticateSession(input, {
      allow_cursor_recovery: true
    });
    if (current.cursor_recovery_required !== 0) {
      throw new CollabError("cursor_reset_receipt_stale", "This reset receipt predates the current recovery fence; use a new idempotency key", {
        persisted_cursor: {
          epoch_id: current.cursor_epoch_id,
          sequence: current.cursor_sequence,
          hash: current.cursor_hash
        },
        expected_cursor_version: current.cursor_version
      });
    }
    return this.sessionProjection(current);
  }
  workspaceStatus(workspaceId) {
    const workspace = this.requireWorkspace(workspaceId);
    const tasks = this.listTasks(workspaceId);
    const counts = { open: 0, claimed: 0, blocked: 0, completed: 0 };
    let expiredClaims = 0;
    for (const task of tasks) {
      if (task.effective_status === "lease_expired") {
        counts.open += 1;
        expiredClaims += 1;
      } else if (task.effective_status === "recovery_required") {
        counts.claimed += 1;
        expiredClaims += 1;
      } else {
        counts[task.status] += 1;
      }
    }
    const decisions = this.db.query(`
      SELECT id, workspace_id, topic, decision, rationale, recorded_by, recorded_at
      FROM decisions WHERE workspace_id = ? ORDER BY recorded_at DESC, id DESC LIMIT 10
    `).all(workspaceId);
    return {
      workspace,
      counts,
      expired_claims: expiredClaims,
      active_claims: tasks.filter((task) => task.effective_status === "claimed"),
      blocked_tasks: tasks.filter((task) => task.status === "blocked"),
      pending_reviews: tasks.filter((task) => task.review_status === "pending"),
      active_sessions: this.listCoordinationSessions(workspaceId, "active"),
      recent_decisions: decisions.map(decisionFromRow),
      recent_reports: this.listReports(workspaceId, { limit: 20 })
    };
  }
  createTask(input) {
    const sessionOnly = input;
    if (sessionOnly.work_mode !== undefined || sessionOnly.completion_policy !== undefined || sessionOnly.expected_base_sha !== undefined) {
      throw new CollabError("session_required_for_v2_task_options", "work_mode, completion_policy, and expected_base_sha require createTaskForSession");
    }
    const normalized = {
      ...normalizeMutation(input),
      workspace_id: input.workspace_id,
      id: input.id ? validateId(input.id, "task_id") : undefined,
      title: cleanText(input.title, "title", 300),
      description: optionalText(input.description, "description", MAX_TEXT),
      dependencies: normalizeDependencies(input.dependencies ?? []),
      path_scopes: normalizePathScopes(input.path_scopes ?? [])
    };
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "task.create", normalized, () => {
      this.requireWorkspace(input.workspace_id);
      const id = normalized.id ?? `task_${randomUUID()}`;
      if (normalized.dependencies.includes(id)) {
        throw new CollabError("invalid_dependency", "A task cannot depend on itself", { task_id: id });
      }
      for (const dependency of normalized.dependencies)
        this.requireTaskRow(input.workspace_id, dependency);
      if (this.readTaskRow(input.workspace_id, id)) {
        throw new CollabError("task_exists", `Task '${id}' already exists`, { task_id: id });
      }
      const now = this.timestamp();
      this.db.query(`
        INSERT INTO tasks (
          id, workspace_id, title, description, status, dependencies_json, path_scopes_json,
          assignee, lease_id, lease_expires_at, blocker, latest_progress, version,
          created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, 'open', ?, ?, NULL, NULL, NULL, NULL, NULL, 1, ?, ?, NULL)
      `).run(id, input.workspace_id, normalized.title, normalized.description, canonicalJson(normalized.dependencies), canonicalJson(normalized.path_scopes), now, now);
      this.appendEvent(input.workspace_id, "task.created", id, normalized.actor, {
        title: normalized.title,
        description: normalized.description,
        dependencies: normalized.dependencies,
        path_scopes: normalized.path_scopes,
        version: 1
      });
      return this.requireTask(input.workspace_id, id);
    });
  }
  createTaskForSession(input) {
    const normalized = {
      idempotency_key: validateIdempotencyKey(input.idempotency_key),
      id: input.id ? validateId(input.id, "task_id") : undefined,
      title: cleanText(input.title, "title", 300),
      description: optionalText(input.description, "description", MAX_TEXT),
      dependencies: normalizeDependencies(input.dependencies ?? []),
      path_scopes: normalizePathScopes(input.path_scopes ?? []),
      work_mode: input.work_mode ?? "edit",
      completion_policy: input.completion_policy,
      expected_base_sha: input.expected_base_sha ? validateGitObjectId(input.expected_base_sha) : null
    };
    if (!["coordination", "read_only", "edit"].includes(normalized.work_mode)) {
      throw new CollabError("invalid_work_mode", "Unsupported task work mode");
    }
    if (normalized.work_mode === "edit" && normalized.path_scopes.length === 0) {
      throw new CollabError("edit_scope_required", "Edit tasks require at least one repository-relative path scope");
    }
    const completionPolicy = normalized.completion_policy ?? (normalized.work_mode === "edit" ? "accepted" : "reported");
    if (!["reported", "accepted"].includes(completionPolicy)) {
      throw new CollabError("invalid_completion_policy", "Unsupported completion policy");
    }
    const request = { ...normalized, completion_policy: completionPolicy };
    return this.mutateAsSession(input, normalized.idempotency_key, "task.create.v2", request, (session) => {
      const id = normalized.id ?? `task_${randomUUID()}`;
      if (normalized.dependencies.includes(id)) {
        throw new CollabError("invalid_dependency", "A task cannot depend on itself", {
          task_id: id
        });
      }
      for (const dependency of normalized.dependencies) {
        this.requireTaskRow(session.workspace_id, dependency);
      }
      if (this.readTaskRow(session.workspace_id, id)) {
        throw new CollabError("task_exists", `Task '${id}' already exists`, { task_id: id });
      }
      const now = this.timestamp();
      this.db.query(`
        INSERT INTO tasks (
          id, workspace_id, title, description, status, dependencies_json, path_scopes_json,
          coordination_mode, work_mode, completion_policy, review_status, review_generation,
          expected_base_sha, base_checkpoint_json, result_checkpoint_json, completion_report_id,
          assignee, assignee_session_id, claim_worktree_id, lease_id, lease_expires_at,
          blocker, latest_progress, reported_by, reported_by_session_id, reported_at,
          accepted_by, accepted_by_session_id, accepted_at, version,
          created_at, updated_at, completed_at
        ) VALUES (
          ?, ?, ?, ?, 'open', ?, ?,
          'session_v2', ?, ?, 'not_required', 0,
          ?, NULL, NULL, NULL,
          NULL, NULL, NULL, NULL, NULL,
          NULL, NULL, NULL, NULL, NULL,
          NULL, NULL, NULL, 1,
          ?, ?, NULL
        )
      `).run(id, session.workspace_id, normalized.title, normalized.description, canonicalJson(normalized.dependencies), canonicalJson(normalized.path_scopes), normalized.work_mode, completionPolicy, normalized.expected_base_sha, now, now);
      this.appendEvent(session.workspace_id, "task.created", id, session.actor, {
        title: normalized.title,
        description: normalized.description,
        dependencies: normalized.dependencies,
        path_scopes: normalized.path_scopes,
        work_mode: normalized.work_mode,
        completion_policy: completionPolicy,
        expected_base_sha: normalized.expected_base_sha,
        version: 1
      }, session.id);
      return this.requireTask(session.workspace_id, id);
    });
  }
  claimTaskForSession(input) {
    const taskId = validateId(input.task_id, "task_id");
    const expectedVersion = validateExpectedVersion(input.expected_version);
    const ttl = validateTtl(input.ttl_seconds);
    const request = { task_id: taskId, expected_version: expectedVersion, ttl_seconds: ttl };
    const replay = this.readSessionMutationReceipt(input, input.idempotency_key, "task.claim.v2", request);
    if (replay.found)
      return replay.value;
    const preparedCheckpoint = this.captureSessionWorktree(input);
    return this.mutateAsSession(input, input.idempotency_key, "task.claim.v2", request, (session) => {
      let row = this.requireTaskRow(session.workspace_id, taskId);
      this.requireVersion(row, expectedVersion);
      if (this.isExpired(row)) {
        if (row.assignee_session_id) {
          throw new CollabError("recovery_required", "An expired session lease requires an explicit recovery note", this.recoveryBundle(row));
        }
        row = this.expireClaim(row, "system:clock");
      }
      if (row.status === "completed") {
        throw new CollabError("task_completed", "Completed tasks cannot be claimed", {
          review_status: row.review_status
        });
      }
      if (row.status === "blocked") {
        throw new CollabError("task_blocked", "Blocked tasks must be unblocked before claiming", {
          blocker: row.blocker
        });
      }
      if (row.status === "claimed") {
        throw new CollabError("task_claimed", "Task already has an active claim", {
          assignee: row.assignee,
          assignee_session_id: row.assignee_session_id,
          lease_expires_at: row.lease_expires_at
        });
      }
      if (row.work_mode === "edit" && parseStringArray(row.path_scopes_json).length === 0) {
        throw new CollabError("edit_scope_required", "Edit tasks require path scopes");
      }
      this.requireDependenciesComplete(row);
      this.requirePathsAvailable(row);
      const worktree = this.requirePreparedWorktree(session, preparedCheckpoint);
      const checkpoint = preparedCheckpoint.checkpoint;
      this.requireExpectedBase(row, checkpoint);
      const now = this.timestamp();
      const leaseId = `lease_${randomUUID()}`;
      const expiresAt = addSeconds(now, ttl);
      const version = row.version + 1;
      this.db.query(`
        UPDATE tasks
        SET coordination_mode = 'session_v2',
          status = 'claimed', assignee = ?, assignee_session_id = ?,
          claim_worktree_id = ?, lease_id = ?, lease_expires_at = ?,
          blocker = NULL, base_checkpoint_json = ?,
          result_checkpoint_json = NULL, completion_report_id = NULL,
          review_status = 'not_required',
          reported_by = NULL, reported_by_session_id = NULL, reported_at = NULL,
          accepted_by = NULL, accepted_by_session_id = NULL, accepted_at = NULL,
          completed_at = NULL, version = ?, updated_at = ?
        WHERE workspace_id = ? AND id = ?
      `).run(session.actor, session.id, worktree.id, leaseId, expiresAt, canonicalJson(checkpoint), version, now, row.workspace_id, row.id);
      this.appendEvent(row.workspace_id, "task.claimed", row.id, session.actor, {
        lease_id: leaseId,
        lease_expires_at: expiresAt,
        worktree_id: worktree.id,
        base_checkpoint: checkpoint,
        version,
        checkpoint_boundary: "server_observed_local_git_state_is_evidence_not_atomic_attribution_or_a_filesystem_lock"
      }, session.id);
      return this.requireTask(row.workspace_id, row.id);
    });
  }
  recoverTaskForSession(input) {
    const taskId = validateId(input.task_id, "task_id");
    const expectedVersion = validateExpectedVersion(input.expected_version);
    const recoveryNote = cleanText(input.recovery_note, "recovery_note", 4000);
    const action = input.action ?? "takeover";
    if (!["takeover", "release", "block"].includes(action)) {
      throw new CollabError("invalid_recovery_action", "Recovery action is invalid");
    }
    const blocker = optionalText(input.blocker, "blocker", 2000);
    if (action === "block" && !blocker) {
      throw new CollabError("recovery_blocker_required", "Blocking recovery requires a blocker");
    }
    const ttl = validateTtl(input.ttl_seconds);
    const request = {
      task_id: taskId,
      expected_version: expectedVersion,
      recovery_note: recoveryNote,
      action,
      blocker,
      ttl_seconds: ttl
    };
    const replay = this.readSessionMutationReceipt(input, input.idempotency_key, "task.recover.v2", request);
    if (replay.found)
      return replay.value;
    const preparedCheckpoint = action === "takeover" ? this.captureSessionWorktree(input) : null;
    return this.mutateAsSession(input, input.idempotency_key, "task.recover.v2", request, (session) => {
      const row = this.requireTaskRow(session.workspace_id, taskId);
      this.requireVersion(row, expectedVersion);
      if (!this.isExpired(row, row.assignee_session_id === session.id ? session : undefined) || !row.lease_id || !row.assignee_session_id) {
        throw new CollabError("recovery_not_required", "Only an expired session-owned lease can be explicitly recovered");
      }
      const now = this.timestamp();
      const { prior, expiryVersion } = this.expireSessionLeaseForRecovery(row, session, now);
      if (action !== "takeover") {
        return this.recordRecoveryWithoutTakeover(row, session, {
          prior,
          expiry_version: expiryVersion,
          action,
          recovery_note: recoveryNote,
          blocker,
          now
        });
      }
      const worktree = this.requirePreparedWorktree(session, preparedCheckpoint);
      const checkpoint = preparedCheckpoint.checkpoint;
      const opened = this.requireTaskRow(row.workspace_id, row.id);
      this.requireDependenciesComplete(opened);
      this.requirePathsAvailable(opened);
      this.requireExpectedBase(opened, checkpoint);
      const leaseId = `lease_${randomUUID()}`;
      const leaseExpiresAt = addSeconds(now, ttl);
      const version = expiryVersion + 1;
      this.db.query(`
        UPDATE tasks
        SET status = 'claimed', assignee = ?, assignee_session_id = ?,
          claim_worktree_id = ?, lease_id = ?, lease_expires_at = ?,
          blocker = NULL, base_checkpoint_json = ?, version = ?, updated_at = ?
        WHERE workspace_id = ? AND id = ?
      `).run(session.actor, session.id, worktree.id, leaseId, leaseExpiresAt, canonicalJson(checkpoint), version, now, row.workspace_id, row.id);
      const event = this.appendEvent(row.workspace_id, "task.recovered", row.id, session.actor, {
        prior_lease: prior,
        recovery_note: recoveryNote,
        recovery_checkpoint: checkpoint,
        lease_id: leaseId,
        lease_expires_at: leaseExpiresAt,
        version,
        note: "Recovery acknowledges an expired coordination lease; it does not accept or attribute prior work."
      }, session.id);
      this.db.query(`
        INSERT INTO task_recoveries (
          id, workspace_id, task_id, prior_lease_id, prior_session_id,
          recovered_by_session_id, action, note, prior_checkpoint_json,
          new_lease_id, recovered_at, event_sequence
        ) VALUES (?, ?, ?, ?, ?, ?, 'takeover', ?, ?, ?, ?, ?)
      `).run(`recovery_${randomUUID()}`, row.workspace_id, row.id, prior.lease_id, prior.session_id, session.id, recoveryNote, prior.checkpoint ? canonicalJson(prior.checkpoint) : null, leaseId, now, event.sequence);
      return this.requireTask(row.workspace_id, row.id);
    });
  }
  renewLeaseForSession(input) {
    const normalized = normalizeSessionRenewInput(input);
    const ttl = validateTtl(input.ttl_seconds);
    return this.mutateAsSession(input, normalized.idempotency_key, "task.renew.v2", { ...normalized.request, ttl_seconds: ttl }, (session) => {
      const row = this.requireTaskRow(session.workspace_id, normalized.task_id);
      this.requireActiveSessionLease(row, session, normalized.lease_id);
      const now = this.timestamp();
      const candidate = addSeconds(now, ttl);
      const expiresAt = row.lease_expires_at && row.lease_expires_at > candidate ? row.lease_expires_at : candidate;
      const version = row.version;
      this.db.query(`
          UPDATE tasks SET lease_expires_at = ?, version = ?, updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(expiresAt, version, now, row.workspace_id, row.id);
      this.appendEvent(row.workspace_id, "task.lease_renewed", row.id, session.actor, {
        lease_id: normalized.lease_id,
        lease_expires_at: expiresAt,
        version
      }, session.id);
      return this.requireTask(row.workspace_id, row.id);
    });
  }
  progressTaskForSession(input) {
    const normalized = normalizeSessionLeaseInput(input);
    const message = cleanText(input.message, "message", 2000);
    return this.mutateAsSession(input, normalized.idempotency_key, "task.progress.v2", { ...normalized.request, message }, (session) => {
      const row = this.requireTaskRow(session.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveSessionLease(row, session, normalized.lease_id);
      const now = this.timestamp();
      const version = row.version + 1;
      this.db.query(`
          UPDATE tasks SET latest_progress = ?, version = ?, updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(message, version, now, row.workspace_id, row.id);
      this.appendEvent(row.workspace_id, "task.progressed", row.id, session.actor, {
        message,
        version
      }, session.id);
      return this.requireTask(row.workspace_id, row.id);
    });
  }
  releaseTaskForSession(input) {
    const normalized = normalizeSessionLeaseInput(input);
    const summary = optionalText(input.summary, "summary", 2000);
    return this.mutateAsSession(input, normalized.idempotency_key, "task.release.v2", { ...normalized.request, summary }, (session) => {
      const row = this.requireTaskRow(session.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveSessionLease(row, session, normalized.lease_id);
      return this.clearSessionClaim(row, session, "task.released", { summary });
    });
  }
  blockTaskForSession(input) {
    const normalized = normalizeSessionLeaseInput(input);
    const blocker = cleanText(input.blocker, "blocker", 2000);
    return this.mutateAsSession(input, normalized.idempotency_key, "task.block.v2", { ...normalized.request, blocker }, (session) => {
      const row = this.requireTaskRow(session.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveSessionLease(row, session, normalized.lease_id);
      const now = this.timestamp();
      const version = row.version + 1;
      this.db.query(`
          UPDATE tasks
          SET status = 'blocked', assignee = NULL, assignee_session_id = NULL,
            claim_worktree_id = NULL, lease_id = NULL, lease_expires_at = NULL,
            blocker = ?, version = ?, updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(blocker, version, now, row.workspace_id, row.id);
      this.expirePendingHandoffs(row.workspace_id, row.id, now, session.actor, "task_blocked");
      this.appendEvent(row.workspace_id, "task.blocked", row.id, session.actor, {
        blocker,
        version
      }, session.id);
      return this.requireTask(row.workspace_id, row.id);
    });
  }
  unblockTaskForSession(input) {
    const taskId = validateId(input.task_id, "task_id");
    const expectedVersion = validateExpectedVersion(input.expected_version);
    const note = optionalText(input.note, "note", 2000);
    return this.mutateAsSession(input, input.idempotency_key, "task.unblock.v2", { task_id: taskId, expected_version: expectedVersion, note }, (session) => {
      const row = this.requireTaskRow(session.workspace_id, taskId);
      this.requireVersion(row, expectedVersion);
      if (row.status !== "blocked") {
        throw new CollabError("task_not_blocked", "Only blocked tasks can be unblocked");
      }
      const now = this.timestamp();
      const version = row.version + 1;
      this.db.query(`
          UPDATE tasks
          SET status = 'open', blocker = NULL, review_status = 'not_required',
            version = ?, updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(version, now, row.workspace_id, row.id);
      this.appendEvent(row.workspace_id, "task.unblocked", row.id, session.actor, {
        note,
        version
      }, session.id);
      return this.requireTask(row.workspace_id, row.id);
    });
  }
  attachArtifactForSession(input) {
    const normalized = normalizeSessionLeaseInput(input);
    const artifactInput = {
      kind: validateArtifactKind(input.kind),
      uri: cleanText(input.uri, "uri", 2000),
      sha256: input.sha256 ? validateSha256(input.sha256) : null,
      media_type: optionalText(input.media_type, "media_type", 200),
      label: optionalText(input.label, "label", 300)
    };
    return this.mutateAsSession(input, normalized.idempotency_key, "artifact.attach.v2", { ...normalized.request, ...artifactInput }, (session) => {
      const row = this.requireTaskRow(session.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveSessionLease(row, session, normalized.lease_id);
      const now = this.timestamp();
      const id = `artifact_${randomUUID()}`;
      this.db.query(`
          INSERT INTO artifacts (
            id, workspace_id, task_id, kind, uri, sha256, media_type, label,
            attached_by, attached_by_session_id, attached_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, row.workspace_id, row.id, artifactInput.kind, artifactInput.uri, artifactInput.sha256, artifactInput.media_type, artifactInput.label, session.actor, session.id, now);
      const version = row.version + 1;
      this.db.query(`
          UPDATE tasks SET version = ?, updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(version, now, row.workspace_id, row.id);
      const artifact = this.requireArtifact(id);
      this.appendEvent(row.workspace_id, "artifact.attached", row.id, session.actor, {
        artifact,
        version
      }, session.id);
      return { task: this.requireTask(row.workspace_id, row.id), artifact };
    });
  }
  completeTaskForSession(input) {
    const normalized = normalizeSessionLeaseInput(input);
    const summary = cleanText(input.summary, "summary", 4000);
    const confidence = validateReportConfidence(input.confidence ?? "unknown");
    const confidenceBasis = optionalText(input.confidence_basis, "confidence_basis", 2000);
    const limits = optionalText(input.limits, "limits", 2000);
    const evidenceRefs = normalizeEvidenceRefs(input.evidence_refs ?? []);
    const reviewRequestedSessionId = input.review_requested_session_id === undefined ? null : validateId(input.review_requested_session_id, "review_requested_session_id");
    const request = {
      ...normalized.request,
      summary,
      confidence,
      confidence_basis: confidenceBasis,
      limits,
      evidence_refs: evidenceRefs,
      ...reviewRequestedSessionId ? { review_requested_session_id: reviewRequestedSessionId } : {}
    };
    const replay = this.readSessionMutationReceipt(input, normalized.idempotency_key, "task.complete.v2", request);
    if (replay.found)
      return replay.value;
    const preparedCheckpoint = this.captureSessionWorktree(input);
    return this.mutateAsSession(input, normalized.idempotency_key, "task.complete.v2", request, (session) => {
      const row = this.requireTaskRow(session.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveSessionLease(row, session, normalized.lease_id);
      for (const reference of evidenceRefs) {
        this.requireEvidenceRef(row.workspace_id, reference);
      }
      if (reviewRequestedSessionId) {
        this.requireRequestedReviewer(row, session, reviewRequestedSessionId);
      }
      this.requirePreparedWorktree(session, preparedCheckpoint);
      const checkpoint = preparedCheckpoint.checkpoint;
      const report = this.appendReportInternal(session, {
        task_id: row.id,
        to_session_id: null,
        kind: "observation",
        body: summary,
        evidence_refs: evidenceRefs,
        confidence,
        confidence_basis: confidenceBasis,
        limits,
        relation: "informs",
        target_report_id: null,
        authority_scope: null,
        authority_basis: null
      });
      const now = this.timestamp();
      const version = row.version + 1;
      const reviewGeneration = row.review_generation + 1;
      const reviewStatus = row.completion_policy === "accepted" ? "pending" : "not_required";
      this.db.query(`
          UPDATE tasks
          SET status = 'completed', review_status = ?, review_generation = ?,
            assignee = NULL, assignee_session_id = NULL, claim_worktree_id = NULL,
            lease_id = NULL, lease_expires_at = NULL, blocker = NULL,
            latest_progress = ?, result_checkpoint_json = ?, completion_report_id = ?,
            reported_by = ?, reported_by_session_id = ?, reported_at = ?,
            accepted_by = NULL, accepted_by_session_id = NULL, accepted_at = NULL,
            version = ?, updated_at = ?, completed_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(reviewStatus, reviewGeneration, summary, canonicalJson(checkpoint), report.id, session.actor, session.id, now, version, now, now, row.workspace_id, row.id);
      this.expirePendingHandoffs(row.workspace_id, row.id, now, session.actor, "task_reported_complete");
      this.appendEvent(row.workspace_id, reviewStatus === "pending" ? "task.reported_complete" : "task.completed", row.id, session.actor, {
        completion_report_id: report.id,
        completion_policy: row.completion_policy,
        review_status: reviewStatus,
        review_generation: reviewGeneration,
        result_checkpoint: checkpoint,
        summary,
        version,
        note: reviewStatus === "pending" ? "Reported completion does not satisfy dependencies until a distinct session accepts it." : "Reported completion satisfies this task's explicit reported-only policy; it is not external acceptance.",
        ...reviewRequestedSessionId ? { review_requested_session_id: reviewRequestedSessionId } : {}
      }, session.id);
      if (reviewRequestedSessionId) {
        this.appendReportInternal(session, {
          task_id: row.id,
          to_session_id: reviewRequestedSessionId,
          kind: "proposal",
          body: `Review requested: please review the reported completion of task ${row.id} ` + `(${row.title}) with collab_task_review. This is a request, not a reservation; ` + "any distinct session may still review.",
          evidence_refs: [`report:${report.id}`],
          confidence: "unknown",
          confidence_basis: null,
          limits: null,
          relation: "informs",
          target_report_id: null,
          authority_scope: null,
          authority_basis: null
        });
      }
      return this.requireTask(row.workspace_id, row.id);
    });
  }
  getTask(workspaceId, taskId) {
    const task = this.requireTask(workspaceId, taskId);
    task.artifacts = this.listArtifacts(workspaceId, taskId);
    return task;
  }
  listTasks(workspaceId, status) {
    this.requireWorkspace(workspaceId);
    const rows = status ? this.db.query(`
          SELECT * FROM tasks WHERE workspace_id = ? AND status = ? ORDER BY created_at, id
        `).all(workspaceId, status) : this.db.query(`
          SELECT * FROM tasks WHERE workspace_id = ? ORDER BY created_at, id
        `).all(workspaceId);
    return rows.map((row) => this.taskFromRow(row));
  }
  claimTask(input) {
    const normalized = {
      ...normalizeVersionedMutation(input),
      workspace_id: input.workspace_id,
      task_id: validateId(input.task_id, "task_id"),
      ttl_seconds: validateTtl(input.ttl_seconds)
    };
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "task.claim", normalized, () => {
      let row = this.requireTaskRow(input.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      const priorAssignee = row.assignee;
      const expired = this.isExpired(row);
      if (expired) {
        row = this.expireClaim(row, normalized.actor);
      }
      if (row.status === "completed")
        throw new CollabError("task_completed", "Completed tasks cannot be claimed");
      if (row.status === "blocked")
        throw new CollabError("task_blocked", "Blocked tasks must be unblocked before claiming", { blocker: row.blocker });
      if (row.status === "claimed") {
        throw new CollabError("task_claimed", "Task already has an active claim", {
          assignee: row.assignee,
          lease_expires_at: row.lease_expires_at
        });
      }
      this.requireDependenciesComplete(row);
      this.requirePathsAvailable(row);
      const now = this.timestamp();
      const leaseId = `lease_${randomUUID()}`;
      const expiresAt = addSeconds(now, normalized.ttl_seconds);
      const nextVersion = row.version + 1;
      this.db.query(`
        UPDATE tasks SET status = 'claimed', assignee = ?, lease_id = ?, lease_expires_at = ?,
          blocker = NULL, version = ?, updated_at = ?
        WHERE workspace_id = ? AND id = ?
      `).run(normalized.actor, leaseId, expiresAt, nextVersion, now, input.workspace_id, normalized.task_id);
      this.appendEvent(input.workspace_id, "task.claimed", normalized.task_id, normalized.actor, {
        lease_id: leaseId,
        lease_expires_at: expiresAt,
        previous_assignee: expired ? priorAssignee : null,
        version: nextVersion
      });
      return this.requireTask(input.workspace_id, normalized.task_id);
    });
  }
  renewLease(input) {
    if (input.expected_version !== undefined)
      validateExpectedVersion(input.expected_version);
    const normalized = {
      ...normalizeMutation(input),
      task_id: validateId(input.task_id, "task_id"),
      lease_id: validateId(input.lease_id, "lease_id"),
      ...input.expected_version === undefined ? {} : { expected_version: input.expected_version }
    };
    const ttl = validateTtl(input.ttl_seconds);
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "task.renew", { ...normalized, ttl_seconds: ttl }, () => {
      const row = this.requireTaskRow(input.workspace_id, normalized.task_id);
      this.requireActiveLease(row, normalized.actor, normalized.lease_id);
      const now = this.timestamp();
      const candidate = addSeconds(now, ttl);
      const expiresAt = row.lease_expires_at && row.lease_expires_at > candidate ? row.lease_expires_at : candidate;
      const version = row.version;
      this.db.query(`
        UPDATE tasks SET lease_expires_at = ?, version = ?, updated_at = ?
        WHERE workspace_id = ? AND id = ?
      `).run(expiresAt, version, now, input.workspace_id, normalized.task_id);
      this.appendEvent(input.workspace_id, "task.lease_renewed", normalized.task_id, normalized.actor, {
        lease_id: normalized.lease_id,
        lease_expires_at: expiresAt,
        version
      });
      return this.requireTask(input.workspace_id, normalized.task_id);
    });
  }
  progressTask(input) {
    const normalized = { ...normalizeLeaseInput(input), message: cleanText(input.message, "message", 2000) };
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "task.progress", normalized, () => {
      const row = this.requireTaskRow(input.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveLease(row, normalized.actor, normalized.lease_id);
      const now = this.timestamp();
      const version = row.version + 1;
      this.db.query(`
        UPDATE tasks SET latest_progress = ?, version = ?, updated_at = ?
        WHERE workspace_id = ? AND id = ?
      `).run(normalized.message, version, now, input.workspace_id, normalized.task_id);
      this.appendEvent(input.workspace_id, "task.progressed", normalized.task_id, normalized.actor, {
        message: normalized.message,
        version
      });
      return this.requireTask(input.workspace_id, normalized.task_id);
    });
  }
  releaseTask(input) {
    const normalized = { ...normalizeLeaseInput(input), summary: optionalText(input.summary, "summary", 2000) };
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "task.release", normalized, () => {
      const row = this.requireTaskRow(input.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveLease(row, normalized.actor, normalized.lease_id);
      return this.clearClaim(row, normalized.actor, "task.released", { summary: normalized.summary });
    });
  }
  blockTask(input) {
    const normalized = { ...normalizeLeaseInput(input), blocker: cleanText(input.blocker, "blocker", 2000) };
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "task.block", normalized, () => {
      const row = this.requireTaskRow(input.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveLease(row, normalized.actor, normalized.lease_id);
      const now = this.timestamp();
      const version = row.version + 1;
      this.db.query(`
        UPDATE tasks SET status = 'blocked', assignee = NULL, lease_id = NULL,
          lease_expires_at = NULL, blocker = ?, version = ?, updated_at = ?
        WHERE workspace_id = ? AND id = ?
      `).run(normalized.blocker, version, now, input.workspace_id, normalized.task_id);
      this.expirePendingHandoffs(input.workspace_id, normalized.task_id, now, normalized.actor, "task_blocked");
      this.appendEvent(input.workspace_id, "task.blocked", normalized.task_id, normalized.actor, {
        blocker: normalized.blocker,
        version
      });
      return this.requireTask(input.workspace_id, normalized.task_id);
    });
  }
  unblockTask(input) {
    const normalized = {
      ...normalizeVersionedMutation(input),
      workspace_id: input.workspace_id,
      task_id: validateId(input.task_id, "task_id"),
      note: optionalText(input.note, "note", 2000)
    };
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "task.unblock", normalized, () => {
      const row = this.requireTaskRow(input.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      if (row.status !== "blocked")
        throw new CollabError("task_not_blocked", "Only blocked tasks can be unblocked");
      const now = this.timestamp();
      const version = row.version + 1;
      this.db.query(`
        UPDATE tasks SET status = 'open', blocker = NULL, version = ?, updated_at = ?
        WHERE workspace_id = ? AND id = ?
      `).run(version, now, input.workspace_id, normalized.task_id);
      this.appendEvent(input.workspace_id, "task.unblocked", normalized.task_id, normalized.actor, {
        note: normalized.note,
        version
      });
      return this.requireTask(input.workspace_id, normalized.task_id);
    });
  }
  completeTask(input) {
    const normalized = { ...normalizeLeaseInput(input), summary: cleanText(input.summary, "summary", 4000) };
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "task.complete", normalized, () => {
      const row = this.requireTaskRow(input.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveLease(row, normalized.actor, normalized.lease_id);
      const now = this.timestamp();
      const version = row.version + 1;
      this.db.query(`
        UPDATE tasks SET status = 'completed', assignee = NULL, lease_id = NULL,
          lease_expires_at = NULL, blocker = NULL, latest_progress = ?, version = ?,
          updated_at = ?, completed_at = ?
        WHERE workspace_id = ? AND id = ?
      `).run(normalized.summary, version, now, now, input.workspace_id, normalized.task_id);
      this.expirePendingHandoffs(input.workspace_id, normalized.task_id, now, normalized.actor, "task_completed");
      this.appendEvent(input.workspace_id, "task.completed", normalized.task_id, normalized.actor, {
        completion_basis: "actor_reported",
        note: "Completion records the reporting actor's outcome; it is not coordinator review or acceptance.",
        summary: normalized.summary,
        version
      });
      return this.requireTask(input.workspace_id, normalized.task_id);
    });
  }
  attachArtifact(input) {
    const normalized = {
      ...normalizeLeaseInput(input),
      kind: input.kind,
      uri: cleanText(input.uri, "uri", 2000),
      sha256: input.sha256 ? validateSha256(input.sha256) : null,
      media_type: optionalText(input.media_type, "media_type", 200),
      label: optionalText(input.label, "label", 300)
    };
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "artifact.attach", normalized, () => {
      const row = this.requireTaskRow(input.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveLease(row, normalized.actor, normalized.lease_id);
      const now = this.timestamp();
      const id = `artifact_${randomUUID()}`;
      this.db.query(`
        INSERT INTO artifacts
          (id, workspace_id, task_id, kind, uri, sha256, media_type, label, attached_by, attached_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.workspace_id, normalized.task_id, normalized.kind, normalized.uri, normalized.sha256, normalized.media_type, normalized.label, normalized.actor, now);
      const version = row.version + 1;
      this.db.query(`UPDATE tasks SET version = ?, updated_at = ? WHERE workspace_id = ? AND id = ?`).run(version, now, input.workspace_id, normalized.task_id);
      const artifact = this.requireArtifact(id);
      this.appendEvent(input.workspace_id, "artifact.attached", normalized.task_id, normalized.actor, {
        artifact,
        version
      });
      return { task: this.requireTask(input.workspace_id, normalized.task_id), artifact };
    });
  }
  recordDecision(input) {
    const normalized = {
      ...normalizeMutation(input),
      workspace_id: input.workspace_id,
      topic: cleanText(input.topic, "topic", 500),
      decision: cleanText(input.decision, "decision", 4000),
      rationale: optionalText(input.rationale, "rationale", 4000)
    };
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "decision.record", normalized, () => {
      this.requireWorkspace(input.workspace_id);
      const id = `decision_${randomUUID()}`;
      const now = this.timestamp();
      this.db.query(`
        INSERT INTO decisions (id, workspace_id, topic, decision, rationale, recorded_by, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.workspace_id, normalized.topic, normalized.decision, normalized.rationale, normalized.actor, now);
      const decision = this.requireDecision(id);
      this.appendEvent(input.workspace_id, "decision.recorded", id, normalized.actor, { decision });
      return decision;
    });
  }
  appendReportForSession(input) {
    const normalized = {
      task_id: input.task_id ? validateId(input.task_id, "task_id") : null,
      to_session_id: input.to_session_id ? validateId(input.to_session_id, "to_session_id") : null,
      kind: validateReportKind(input.kind),
      body: cleanText(input.body, "body", MAX_REPORT_BODY),
      evidence_refs: normalizeEvidenceRefs(input.evidence_refs ?? []),
      confidence: validateReportConfidence(input.confidence ?? "unknown"),
      confidence_basis: optionalText(input.confidence_basis, "confidence_basis", 2000),
      limits: optionalText(input.limits, "limits", 2000),
      relation: validateReportRelation(input.relation ?? "informs"),
      target_report_id: input.target_report_id ? validateId(input.target_report_id, "target_report_id") : null,
      authority_scope: optionalText(input.authority_scope, "authority_scope", 1000),
      authority_basis: optionalText(input.authority_basis, "authority_basis", 2000),
      ...input.to_person === true ? { to_person: true } : {}
    };
    return this.mutateAsSession(input, input.idempotency_key, "report.append.v2", normalized, (session) => {
      this.validateReportInput(session, normalized);
      this.refuseProposalRewrite(normalized);
      return this.appendReportInternal(session, normalized);
    });
  }
  openProposalForSession(input) {
    const normalized = {
      ...normalizeProposalTerms(input),
      task_id: input.task_id ? validateId(input.task_id, "task_id") : null,
      confidence: validateReportConfidence(input.confidence ?? "unknown"),
      confidence_basis: optionalText(input.confidence_basis, "confidence_basis", 2000),
      limits: optionalText(input.limits, "limits", 2000),
      origin: validateProposalOrigin(input.origin ?? "ai"),
      supersedes_report_id: input.supersedes_report_id ? validateId(input.supersedes_report_id, "supersedes_report_id") : null
    };
    return this.mutateAsSession(input, input.idempotency_key, "proposal.open.v1", normalized, (session) => {
      const reportInput = {
        task_id: normalized.task_id,
        to_session_id: null,
        kind: "proposal",
        body: normalized.question,
        evidence_refs: normalized.evidence_refs,
        confidence: normalized.confidence,
        confidence_basis: normalized.confidence_basis,
        limits: normalized.limits,
        relation: normalized.supersedes_report_id ? "supersedes" : "informs",
        target_report_id: normalized.supersedes_report_id,
        authority_scope: null,
        authority_basis: null
      };
      this.validateReportInput(session, reportInput);
      if (normalized.supersedes_report_id) {
        this.requireOpenToRevision(session.workspace_id, normalized.supersedes_report_id);
      }
      return this.openProposalInternal(session, this.lineageRoot(session.id), reportInput, normalized);
    });
  }
  openPersonProposal(input) {
    const normalized = normalizeProposalTerms(input);
    const idempotencyKey = validateIdempotencyKey(input.idempotency_key);
    return this.mutate(input.workspace_id, PERSON_DESK_ACTOR, idempotencyKey, "person.proposal.open.v1", normalized, () => {
      for (const reference of normalized.evidence_refs)
        this.requireEvidenceRef(input.workspace_id, reference);
      const reportInput = {
        task_id: null,
        to_session_id: null,
        kind: "proposal",
        body: normalized.question,
        evidence_refs: normalized.evidence_refs,
        confidence: "unknown",
        confidence_basis: null,
        limits: PERSON_DESK_LIMITS,
        relation: "informs",
        target_report_id: null,
        authority_scope: null,
        authority_basis: null
      };
      return this.openProposalInternal({ workspace_id: input.workspace_id, actor: PERSON_DESK_ACTOR, id: null }, PERSON_VOICE_ID, reportInput, { ...normalized, origin: "person_relayed", supersedes_report_id: null });
    });
  }
  openProposalInternal(author, authorVoiceId, reportInput, terms) {
    const now = this.timestamp();
    const voices = this.liveVoiceSnapshot(author.workspace_id, now);
    const report = this.appendReportInternal(author, reportInput);
    const closesAt = new Date(Date.parse(now) + terms.consult_seconds * 1000).toISOString();
    const proposalSha256 = sha2563(proposalBytes({
      workspace_id: author.workspace_id,
      report_id: report.id,
      task_id: report.task_id,
      question: report.body,
      criteria: terms.criteria,
      extent: terms.extent,
      relies_on: report.evidence_refs,
      known_conflicts: terms.known_conflicts,
      limits: report.limits,
      origin: terms.origin,
      topic: terms.topic,
      closes_at: closesAt,
      supersedes_report_id: terms.supersedes_report_id
    }));
    const event = this.appendEvent(author.workspace_id, "proposal.opened", report.id, author.actor, {
      rule: CONSENT_RULE,
      proposal_sha256: proposalSha256,
      criteria: terms.criteria,
      extent: terms.extent,
      known_conflicts: terms.known_conflicts,
      origin: terms.origin,
      topic: terms.topic,
      closes_at: closesAt,
      voices,
      author_voice_id: authorVoiceId
    }, author.id);
    this.db.query(`
      INSERT INTO proposal_terms (
        report_id, workspace_id, rule, criteria, extent, known_conflicts, origin,
        topic, closes_at, voices_json, author_voice_id, proposal_sha256,
        opened_event_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(report.id, author.workspace_id, CONSENT_RULE, terms.criteria, terms.extent, terms.known_conflicts, terms.origin, terms.topic, closesAt, canonicalJson(voices), authorVoiceId, proposalSha256, event.id, now);
    return this.proposalStatusInternal(author.workspace_id, report.id);
  }
  relayProposalRejectionForSession(input) {
    const normalized = {
      proposal_report_id: validateId(input.proposal_report_id, "proposal_report_id"),
      proposal_sha256: validateSha256(input.proposal_sha256),
      reason: cleanText(input.reason, "reason", 2000)
    };
    return this.mutateAsSession(input, input.idempotency_key, "proposal.reject.relay.v1", normalized, (session) => {
      const terms = this.requireProposalTerms(session.workspace_id, normalized.proposal_report_id);
      return this.recordPersonAct({
        workspace_id: terms.workspace_id,
        proposal_report_id: terms.report_id,
        proposal_sha256: normalized.proposal_sha256,
        act: "reject",
        reason: normalized.reason,
        basis: "relayed_by_session",
        actor: session.actor,
        session_id: session.id,
        proof: null
      });
    });
  }
  personActChallenge(input) {
    const act = validatePersonAct(input.act);
    const reason = act === "reject" ? cleanText(input.reason ?? "", "reason", 2000) : null;
    const terms = this.requireProposalTermsById(validateId(input.proposal_report_id, "proposal_report_id"));
    const prior = this.personActCount(terms.report_id);
    const derived = personActChallenge({
      act,
      workspace_id: terms.workspace_id,
      proposal_report_id: terms.report_id,
      proposal_sha256: terms.proposal_sha256,
      prior_person_acts: prior,
      reason
    });
    return {
      workspace_id: terms.workspace_id,
      proposal_report_id: terms.report_id,
      proposal_sha256: terms.proposal_sha256,
      act,
      reason,
      prior_person_acts: prior,
      ...derived,
      passkeys: this.listPersonPasskeys().filter((key) => key.revoked_at === null).map((key) => ({
        credential_id: key.credential_id,
        rp_id: key.rp_id,
        origin: key.origin,
        label: key.label,
        fingerprint: key.fingerprint
      }))
    };
  }
  recordPersonActAtTerminal(input) {
    const act = validatePersonAct(input.act);
    const reason = act === "reject" ? cleanText(input.reason ?? "", "reason", 2000) : null;
    const transaction = this.db.transaction(() => {
      const terms = this.requireProposalTermsById(validateId(input.proposal_report_id, "proposal_report_id"));
      return this.recordPersonAct({
        workspace_id: terms.workspace_id,
        proposal_report_id: terms.report_id,
        proposal_sha256: validateSha256(input.proposal_sha256),
        act,
        reason,
        basis: "controlling_terminal",
        actor: PERSON_TERMINAL_ACTOR,
        session_id: null,
        proof: null
      });
    });
    const status = transaction.immediate();
    this.tightenFileModes();
    return status;
  }
  recordPersonActWithPasskey(input) {
    const act = validatePersonAct(input.act);
    const reason = act === "reject" ? cleanText(input.reason ?? "", "reason", 2000) : null;
    const transaction = this.db.transaction(() => {
      const terms = this.requireProposalTermsById(validateId(input.proposal_report_id, "proposal_report_id"));
      const passkey = this.listPersonPasskeys().find((key) => key.credential_id === input.assertion?.credential_id && key.revoked_at === null);
      if (!passkey) {
        throw new CollabError("passkey_not_enrolled", "No active enrolled passkey has this credential id");
      }
      const derived = personActChallenge({
        act,
        workspace_id: terms.workspace_id,
        proposal_report_id: terms.report_id,
        proposal_sha256: terms.proposal_sha256,
        prior_person_acts: this.personActCount(terms.report_id),
        reason
      });
      const { sign_count } = verifyPasskeyAssertion({
        passkey,
        assertion: input.assertion,
        expected_challenge: derived.challenge
      });
      this.db.query(`UPDATE person_passkeys SET sign_count = ? WHERE credential_id = ?`).run(sign_count, passkey.credential_id);
      return this.recordPersonAct({
        workspace_id: terms.workspace_id,
        proposal_report_id: terms.report_id,
        proposal_sha256: terms.proposal_sha256,
        act,
        reason,
        basis: "user_verified_passkey",
        actor: PERSON_PASSKEY_ACTOR,
        session_id: null,
        proof: {
          credential_id: input.assertion.credential_id,
          authenticator_data: input.assertion.authenticator_data,
          client_data_json: input.assertion.client_data_json,
          signature: input.assertion.signature,
          user_handle: input.assertion.user_handle ?? null,
          public_key_spki: passkey.public_key_spki,
          rp_id: passkey.rp_id,
          origin: passkey.origin,
          challenge_bytes: derived.challenge_bytes,
          challenge: derived.challenge,
          sign_count
        }
      });
    });
    const status = transaction.immediate();
    this.tightenFileModes();
    return status;
  }
  enrollPersonPasskey(input) {
    base64urlDecode(input.credential_id, "credential_id", 1023);
    parsePasskeyPublicKey(input.public_key_spki);
    if (input.algorithm !== -7) {
      throw new CollabError("passkey_key_invalid", "Only ES256 (COSE algorithm -7) passkeys are supported");
    }
    const scope = validatePasskeyScope(input.rp_id, input.origin);
    const label = optionalText(input.label, "label", 80);
    const transaction = this.db.transaction(() => {
      if (this.db.query(`SELECT 1 FROM person_passkeys WHERE credential_id = ?`).get(input.credential_id)) {
        throw new CollabError("passkey_already_enrolled", "This credential id is already enrolled");
      }
      this.db.query(`
        INSERT INTO person_passkeys (
          credential_id, public_key_spki, algorithm, rp_id, origin, label,
          fingerprint, sign_count, enrolled_at, revoked_at
        ) VALUES (?, ?, -7, ?, ?, ?, ?, 0, ?, NULL)
      `).run(input.credential_id, input.public_key_spki, scope.rp_id, scope.origin, label, passkeyFingerprint(input.public_key_spki), this.timestamp());
    });
    transaction.immediate();
    this.tightenFileModes();
    return this.listPersonPasskeys().find((key) => key.credential_id === input.credential_id);
  }
  listPersonPasskeys() {
    return this.db.query(`SELECT * FROM person_passkeys ORDER BY enrolled_at, credential_id`).all().map((row) => ({ ...row, algorithm: -7 }));
  }
  revokePersonPasskey(credentialId) {
    const transaction = this.db.transaction(() => {
      const changed = this.db.query(`
        UPDATE person_passkeys SET revoked_at = ? WHERE credential_id = ? AND revoked_at IS NULL
      `).run(this.timestamp(), credentialId);
      if (changed.changes === 0) {
        throw new CollabError("passkey_not_enrolled", "No active enrolled passkey has this credential id");
      }
    });
    transaction.immediate();
    this.tightenFileModes();
    return this.listPersonPasskeys().find((key) => key.credential_id === credentialId);
  }
  appendPersonNote(input) {
    const normalized = {
      body: cleanText(input.body, "body", MAX_REPORT_BODY),
      proposal_report_id: input.proposal_report_id ? validateId(input.proposal_report_id, "proposal_report_id") : null
    };
    const idempotencyKey = validateIdempotencyKey(input.idempotency_key);
    return this.mutate(input.workspace_id, PERSON_DESK_ACTOR, idempotencyKey, "person.note.v1", normalized, () => {
      let toSessionId = null;
      if (normalized.proposal_report_id) {
        const terms = this.requireProposalTerms(input.workspace_id, normalized.proposal_report_id);
        toSessionId = this.requireReport(terms.report_id).from_session_id;
      }
      return this.appendReportInternal({ workspace_id: input.workspace_id, actor: PERSON_DESK_ACTOR, id: null }, {
        task_id: null,
        to_session_id: toSessionId,
        kind: "observation",
        body: normalized.body,
        evidence_refs: normalized.proposal_report_id ? [`report:${normalized.proposal_report_id}`] : [],
        confidence: "unknown",
        confidence_basis: null,
        limits: PERSON_DESK_LIMITS,
        relation: "informs",
        target_report_id: null,
        authority_scope: null,
        authority_basis: null
      });
    });
  }
  personInbox(workspaceId) {
    this.requireWorkspace(workspaceId);
    const settled = new Set(["consented", "split", "lapsed"]);
    const awaiting = this.db.query(`
      SELECT t.report_id FROM proposal_terms t JOIN reports r ON r.id = t.report_id
      WHERE t.workspace_id = ? ORDER BY r.event_sequence DESC LIMIT 200
    `).all(workspaceId).map((row) => this.proposalStatusInternal(workspaceId, row.report_id)).filter((status) => settled.has(status.ai.position) && status.person.state === "awaiting");
    const addressed = this.db.query(`
      SELECT r.* FROM person_addressed_reports p JOIN reports r ON r.id = p.report_id
      WHERE p.workspace_id = ? ORDER BY r.event_sequence DESC LIMIT 50
    `).all(workspaceId).map(reportFromRow);
    return { workspace_id: workspaceId, awaiting_person: awaiting, addressed_reports: addressed };
  }
  listWorkspaces() {
    return this.db.query(`SELECT id, name, root_path, created_at FROM workspaces ORDER BY created_at, id`).all();
  }
  proposalStatus(workspaceId, proposalReportId) {
    this.requireWorkspace(workspaceId);
    const id = validateId(proposalReportId, "proposal_report_id");
    this.requireProposalTerms(workspaceId, id);
    return this.proposalStatusInternal(workspaceId, id);
  }
  proposalStatusById(proposalReportId) {
    const terms = this.requireProposalTermsById(validateId(proposalReportId, "proposal_report_id"));
    return this.proposalStatusInternal(terms.workspace_id, terms.report_id);
  }
  listProposalStatuses(workspaceId, options = {}) {
    this.requireWorkspace(workspaceId);
    const limit = options.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new CollabError("invalid_limit", "Proposal limit must be between 1 and 50");
    }
    const rows = this.db.query(`
      SELECT t.report_id FROM proposal_terms t
      JOIN reports r ON r.id = t.report_id
      WHERE t.workspace_id = ?
      ORDER BY r.event_sequence DESC
      LIMIT ?
    `).all(workspaceId, limit);
    return rows.map((row) => this.proposalStatusInternal(workspaceId, row.report_id));
  }
  recordPersonAct(input) {
    const current = this.proposalStatusInternal(input.workspace_id, input.proposal_report_id);
    if (current.proposal_sha256 !== input.proposal_sha256) {
      throw new CollabError("proposal_hash_mismatch", "The act names different proposal bytes; read the proposal status again", { proposal_sha256: current.proposal_sha256 });
    }
    if (current.ai.position === "withdrawn" || current.ai.position === "superseded") {
      throw new CollabError("proposal_not_on_table", "A withdrawn or superseded proposal is no longer on the table", { position: current.ai.position, obsoleted_by_report_id: current.ai.obsoleted_by_report_id });
    }
    if (input.act === "agree") {
      if (input.basis === "relayed_by_session") {
        throw new CollabError("consent_not_relayable", "A person's agreement is never recorded through a session");
      }
      if (current.ai.position !== "consented") {
        throw new CollabError("ai_not_consented", "The agents have not consented; a person agrees only after they settle", { position: current.ai.position });
      }
      if (current.person.state === "agreed") {
        throw new CollabError("already_agreed", "The latest person act already agrees to these bytes");
      }
    } else if (current.person.state === "rejected") {
      throw new CollabError("already_rejected", "The latest person act already rejects these bytes");
    }
    const id = `person_act_${randomUUID()}`;
    const now = this.timestamp();
    const aiSnapshot = {
      position: current.ai.position,
      closed: current.ai.closed,
      qualifying_support_report_ids: current.ai.qualifying_support_report_ids,
      unresolved_challenge_report_ids: current.ai.unresolved_challenge_report_ids
    };
    const personAct = {
      id,
      proposal_report_id: input.proposal_report_id,
      proposal_sha256: input.proposal_sha256,
      act: input.act,
      party: "person",
      basis: input.basis,
      reason: input.reason,
      relayed_by_session_id: input.basis === "relayed_by_session" ? input.session_id : null,
      ai_snapshot: aiSnapshot,
      proof: input.proof
    };
    const event = this.appendEvent(input.workspace_id, input.act === "agree" ? "proposal.agreed" : "proposal.rejected", input.proposal_report_id, input.actor, { person_act: personAct }, input.session_id);
    this.db.query(`
      INSERT INTO proposal_person_acts (
        id, workspace_id, proposal_report_id, proposal_sha256, act, party, basis,
        reason, relayed_by_session_id, ai_snapshot_json, proof_json, created_at, event_sequence
      ) VALUES (?, ?, ?, ?, ?, 'person', ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.workspace_id, input.proposal_report_id, input.proposal_sha256, input.act, input.basis, input.reason, personAct.relayed_by_session_id, canonicalJson(aiSnapshot), input.proof ? canonicalJson(input.proof) : null, now, event.sequence);
    return this.proposalStatusInternal(input.workspace_id, input.proposal_report_id);
  }
  personActCount(proposalReportId) {
    return this.db.query(`SELECT COUNT(*) AS count FROM proposal_person_acts WHERE proposal_report_id = ?`).get(proposalReportId).count;
  }
  requireProposalTermsById(reportId) {
    const row = this.db.query(`SELECT workspace_id FROM proposal_terms WHERE report_id = ?`).get(reportId);
    if (!row) {
      throw new CollabError("proposal_not_found", "No proposal with consent terms has this report id", { proposal_report_id: reportId });
    }
    return this.requireProposalTerms(row.workspace_id, reportId);
  }
  proposalStatusInternal(workspaceId, reportId) {
    const proposal = this.requireReport(reportId);
    const terms = this.requireProposalTerms(workspaceId, reportId);
    const bytes = proposalBytes({
      workspace_id: workspaceId,
      report_id: proposal.id,
      task_id: proposal.task_id,
      question: proposal.body,
      criteria: terms.criteria,
      extent: terms.extent,
      relies_on: proposal.evidence_refs,
      known_conflicts: terms.known_conflicts,
      limits: proposal.limits,
      origin: terms.origin,
      topic: terms.topic,
      closes_at: terms.closes_at,
      supersedes_report_id: proposal.relation === "supersedes" ? proposal.target_report_id : null
    });
    if (sha2563(bytes) !== terms.proposal_sha256) {
      throw new CollabError("proposal_terms_invalid", "Stored proposal bytes no longer match their recorded hash", { proposal_report_id: reportId });
    }
    const obsoleted = this.activeObsoletionTargets(workspaceId);
    const answers = this.db.query(`
      SELECT id, relation, from_session_id FROM reports
      WHERE workspace_id = ? AND target_report_id = ?
      ORDER BY event_sequence
    `).all(workspaceId, reportId);
    const live = answers.filter((answer) => !obsoleted.has(answer.id));
    const obsoleting = live.filter((answer) => ["withdraws", "corrects", "supersedes"].includes(answer.relation)).at(-1) ?? null;
    const supports = live.filter((answer) => answer.relation === "supports" && answer.from_session_id !== null);
    const challengeIds = this.unresolvedChallengeIds(workspaceId, reportId);
    const computed = aiPosition({
      now: this.timestamp(),
      closes_at: terms.closes_at,
      obsoleted: obsoleting ? obsoleting.relation === "withdraws" ? "withdrawn" : "superseded" : null,
      unresolved_challenge: challengeIds.length > 0,
      author_voice_id: terms.author_voice_id,
      snapshot_voice_ids: terms.voices.map((voice) => voice.voice_id),
      support_voice_ids: supports.map((support) => this.lineageRoot(support.from_session_id))
    });
    const acts = this.db.query(`
      SELECT * FROM proposal_person_acts
      WHERE workspace_id = ? AND proposal_report_id = ?
      ORDER BY event_sequence
    `).all(workspaceId, reportId).map(proposalPersonActFromRow);
    const latest = acts.at(-1) ?? null;
    const state = latest === null ? "awaiting" : latest.act === "agree" ? "agreed" : "rejected";
    const agreement = latest?.act === "agree" ? latest : null;
    const retracted = computed.position === "withdrawn" || computed.position === "superseded";
    return {
      rule: CONSENT_RULE,
      proposal,
      terms,
      proposal_bytes: bytes,
      proposal_sha256: terms.proposal_sha256,
      ai: {
        position: computed.position,
        closed: computed.closed,
        unresolved_challenge_report_ids: challengeIds,
        qualifying_support_report_ids: computed.qualifying_support_indexes.map((index) => supports[index].id),
        awaiting_voice_ids: computed.awaiting_voice_ids,
        obsoleted_by_report_id: obsoleting?.id ?? null,
        basis: "computed_from_journal"
      },
      person: { state, acts },
      agreement,
      may_proceed: agreement !== null && !retracted,
      authority_boundary: "an_agreement_authorises_only_the_proposal_extent"
    };
  }
  requireProposalTerms(workspaceId, reportId) {
    const row = this.db.query(`
      SELECT * FROM proposal_terms WHERE workspace_id = ? AND report_id = ?
    `).get(workspaceId, reportId);
    if (!row) {
      throw new CollabError("proposal_not_found", "No proposal with consent terms has this report id in this workspace", { proposal_report_id: reportId });
    }
    return proposalTermsFromRow(row);
  }
  requireOpenToRevision(workspaceId, reportId) {
    const terms = this.db.query(`
      SELECT 1 FROM proposal_terms WHERE workspace_id = ? AND report_id = ?
    `).get(workspaceId, reportId);
    if (!terms)
      return;
    if (this.activeObsoletionTargets(workspaceId).has(reportId)) {
      throw new CollabError("proposal_not_on_table", "This proposal was already withdrawn or superseded", { proposal_report_id: reportId });
    }
  }
  refuseProposalRewrite(input) {
    if (input.relation !== "corrects" && input.relation !== "supersedes")
      return;
    if (!input.target_report_id)
      return;
    const terms = this.db.query(`SELECT 1 FROM proposal_terms WHERE report_id = ?`).get(input.target_report_id);
    if (terms) {
      throw new CollabError("proposal_terms_fixed", "A proposal with consent terms is fixed by its hash. Withdraw it, or open a revision with " + "collab_proposal_open and supersedes_report_id");
    }
  }
  liveVoiceSnapshot(workspaceId, observedAt) {
    const rows = this.db.query(`
      SELECT id, status, last_seen_at FROM coordination_sessions
      WHERE workspace_id = ? AND status = 'active'
      ORDER BY id
    `).all(workspaceId);
    const voices = new Map;
    for (const row of rows) {
      if (sessionLiveness(row, observedAt) !== "live")
        continue;
      const voiceId = this.lineageRoot(row.id);
      voices.set(voiceId, [...voices.get(voiceId) ?? [], row.id]);
    }
    return [...voices.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([voice_id, live_session_ids]) => ({ voice_id, live_session_ids: live_session_ids.sort() }));
  }
  lineageRoot(sessionId) {
    let current = sessionId;
    for (let depth = 0;depth < 256; depth += 1) {
      const row = this.db.query(`SELECT parent_session_id FROM coordination_sessions WHERE id = ?`).get(current);
      if (!row?.parent_session_id)
        return current;
      current = row.parent_session_id;
    }
    return current;
  }
  listReports(workspaceId, options = {}) {
    this.requireWorkspace(workspaceId);
    const after = options.after_event_sequence ?? 0;
    const limit = options.limit ?? 100;
    if (!Number.isInteger(after) || after < 0) {
      throw new CollabError("invalid_cursor", "Report cursor must be a non-negative integer");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new CollabError("invalid_limit", "Report limit must be between 1 and 500");
    }
    const taskId = options.task_id ? validateId(options.task_id, "task_id") : null;
    const toSessionId = options.to_session_id ? validateId(options.to_session_id, "to_session_id") : null;
    const rows = this.db.query(`
      SELECT * FROM reports
      WHERE workspace_id = ?
        AND event_sequence > ?
        AND (? IS NULL OR task_id = ?)
        AND (? IS NULL OR to_session_id = ?)
      ORDER BY event_sequence
      LIMIT ?
    `).all(workspaceId, after, taskId, taskId, toSessionId, toSessionId, limit);
    return rows.map(reportFromRow);
  }
  reviewTaskForSession(input) {
    const taskId = validateId(input.task_id, "task_id");
    const expectedVersion = validateExpectedVersion(input.expected_version);
    if (input.outcome !== "accept" && input.outcome !== "request_changes") {
      throw new CollabError("invalid_review_outcome", "Review outcome is invalid");
    }
    const summary = cleanText(input.summary, "summary", 4000);
    const evidenceRefs = normalizeEvidenceRefs(input.evidence_refs ?? []);
    const confidence = validateReportConfidence(input.confidence ?? "unknown");
    const confidenceBasis = optionalText(input.confidence_basis, "confidence_basis", 2000);
    const limits = optionalText(input.limits, "limits", 2000);
    const request = {
      task_id: taskId,
      expected_version: expectedVersion,
      outcome: input.outcome,
      summary,
      evidence_refs: evidenceRefs,
      ...confidence === "unknown" ? {} : { confidence },
      ...confidenceBasis === null ? {} : { confidence_basis: confidenceBasis },
      ...limits === null ? {} : { limits }
    };
    const replay = this.readSessionMutationReceipt(input, input.idempotency_key, "task.review.v2", request);
    if (replay.found)
      return replay.value;
    const preparedCheckpoint = input.outcome === "accept" ? this.captureReviewCheckpoint(input, taskId) : null;
    return this.mutateAsSession(input, input.idempotency_key, "task.review.v2", request, (session) => {
      const row = this.requireTaskRow(session.workspace_id, taskId);
      if (row.completion_policy !== "accepted" || row.review_status !== "pending") {
        throw this.taskNotPendingReviewError(row, session.id);
      }
      this.requireVersion(row, expectedVersion);
      if (!row.reported_by_session_id || !row.completion_report_id) {
        throw new CollabError("review_state_invalid", "Task completion review metadata is incomplete");
      }
      if (row.reported_by_session_id === session.id) {
        throw new CollabError("self_review_forbidden", "A distinct session must review reported completion");
      }
      for (const reference of evidenceRefs)
        this.requireEvidenceRef(row.workspace_id, reference);
      if (input.outcome === "accept" && this.hasObsoletedCompletionReport(row.workspace_id, row.completion_report_id)) {
        throw new CollabError("completion_report_obsolete", "The reported completion was withdrawn, corrected, or superseded; request changes before a new completion report", { completion_report_id: row.completion_report_id });
      }
      if (input.outcome === "accept" && this.hasUnresolvedChallenges(row.workspace_id, row.completion_report_id)) {
        throw new CollabError("completion_challenged", "Reported completion has an unresolved challenge", { completion_report_id: row.completion_report_id });
      }
      let hostCommit = null;
      if (input.outcome === "accept") {
        const resultCheckpoint = parseCheckpoint(row.result_checkpoint_json);
        if (resultCheckpoint?.source === "server_observed") {
          if (!preparedCheckpoint || checkpointDigest(preparedCheckpoint.result_checkpoint) !== checkpointDigest(resultCheckpoint)) {
            throw new CollabError("worktree_observation_stale", "The completion checkpoint changed after review preparation");
          }
          this.requirePreparedRegisteredWorktree(row.workspace_id, resultCheckpoint.worktree_id, preparedCheckpoint.observed_worktree);
          const observed = preparedCheckpoint.observed_worktree.checkpoint;
          requireCompleteGitCheckpoint(resultCheckpoint);
          requireCompleteGitCheckpoint(observed);
          if (!checkpointStateMatches(resultCheckpoint, observed)) {
            const basis = this.hostCommitSuccessorBasis(row, preparedCheckpoint);
            if ("refusal" in basis) {
              throw gitCheckpointStaleError(row.id, resultCheckpoint, observed, basis.refusal);
            }
            hostCommit = basis;
          }
        }
      }
      const report = this.appendReportInternal(session, {
        task_id: row.id,
        to_session_id: row.reported_by_session_id,
        kind: input.outcome === "accept" ? "observation" : "inference",
        body: summary,
        evidence_refs: [
          `report:${row.completion_report_id}`,
          ...evidenceRefs.filter((reference) => reference !== `report:${row.completion_report_id}`)
        ],
        confidence,
        confidence_basis: confidenceBasis,
        limits,
        relation: input.outcome === "accept" ? "supports" : "challenges",
        target_report_id: row.completion_report_id,
        authority_scope: "local_task_coordination_review",
        authority_basis: "distinct active collaboration session"
      });
      const now = this.timestamp();
      const reviewId = `review_${randomUUID()}`;
      const version = row.version + 1;
      const outcome = input.outcome === "accept" ? "accepted" : "changes_requested";
      if (input.outcome === "accept") {
        this.db.query(`
          UPDATE tasks
          SET review_status = 'accepted', accepted_by = ?, accepted_by_session_id = ?,
            accepted_at = ?, version = ?, updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(session.actor, session.id, now, version, now, row.workspace_id, row.id);
      } else {
        this.db.query(`
          UPDATE tasks
          SET status = 'open', review_status = 'changes_requested',
            accepted_by = NULL, accepted_by_session_id = NULL, accepted_at = NULL,
            version = ?, updated_at = ?, completed_at = NULL
          WHERE workspace_id = ? AND id = ?
        `).run(version, now, row.workspace_id, row.id);
      }
      const event = this.appendEvent(row.workspace_id, input.outcome === "accept" ? "task.accepted" : "task.changes_requested", row.id, session.actor, {
        review_id: reviewId,
        review_report_id: report.id,
        completion_report_id: row.completion_report_id,
        review_generation: row.review_generation,
        outcome,
        summary,
        version,
        authority_boundary: "acceptance_is_local_coordination_review_not_merge_deploy_truth_or_external_authority",
        ...hostCommit ? {
          checkpoint_basis: "host_commit_successor",
          host_commit_sha: hostCommit.commit_sha,
          host_commit_artifact_ids: hostCommit.artifact_ids,
          checkpoint_boundary: "server_observed_successor_commit_is_local_evidence_not_a_commit_signature_attribution_or_an_atomic_git_sqlite_lock"
        } : {}
      }, session.id);
      this.db.query(`
        INSERT INTO task_reviews (
          id, workspace_id, task_id, review_generation, outcome, summary,
          reviewer_actor, reviewer_session_id, created_at, event_sequence
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(reviewId, row.workspace_id, row.id, row.review_generation, outcome, summary, session.actor, session.id, now, event.sequence);
      return {
        task: this.requireTask(row.workspace_id, row.id),
        review: this.requireReview(reviewId),
        report
      };
    });
  }
  offerHandoff(input) {
    const normalized = {
      ...normalizeLeaseInput(input),
      to_actor: validateActor(input.to_actor),
      summary: cleanText(input.summary, "summary", 4000),
      ttl_seconds: validateTtl(input.ttl_seconds)
    };
    if (normalized.to_actor === normalized.actor) {
      throw new CollabError("invalid_handoff", "A handoff target must be a different actor");
    }
    this.expireElapsedHandoffs(input.workspace_id, normalized.actor, normalized.task_id);
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "handoff.offer", normalized, () => {
      const row = this.requireTaskRow(input.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveLease(row, normalized.actor, normalized.lease_id);
      const pending = this.db.query(`
        SELECT id FROM handoffs WHERE workspace_id = ? AND task_id = ? AND status = 'pending' AND expires_at > ?
      `).get(input.workspace_id, normalized.task_id, this.timestamp());
      if (pending)
        throw new CollabError("handoff_pending", "Task already has a pending handoff", { handoff_id: pending.id });
      const now = this.timestamp();
      const id = `handoff_${randomUUID()}`;
      const expiresAt = [addSeconds(now, normalized.ttl_seconds), row.lease_expires_at].sort()[0];
      this.db.query(`
        INSERT INTO handoffs
          (id, workspace_id, task_id, from_actor, to_actor, summary, status, offered_at, expires_at, resolved_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL)
      `).run(id, input.workspace_id, normalized.task_id, normalized.actor, normalized.to_actor, normalized.summary, now, expiresAt);
      const version = row.version + 1;
      this.db.query(`UPDATE tasks SET version = ?, updated_at = ? WHERE workspace_id = ? AND id = ?`).run(version, now, input.workspace_id, normalized.task_id);
      const offer = this.requireHandoff(id);
      this.appendEvent(input.workspace_id, "handoff.offered", id, normalized.actor, {
        offer,
        task_version: version,
        note: "An offer is an invitation; the coordination lease remains with the current holder until acceptance."
      });
      return { handoff: offer, task: this.requireTask(input.workspace_id, normalized.task_id) };
    });
  }
  respondHandoff(input) {
    if (input.response !== "accept" && input.response !== "decline") {
      throw new CollabError("invalid_handoff_response", "Handoff response must be 'accept' or 'decline'");
    }
    const normalized = {
      ...normalizeVersionedMutation(input),
      workspace_id: input.workspace_id,
      handoff_id: validateId(input.handoff_id, "handoff_id"),
      response: input.response,
      ttl_seconds: validateTtl(input.ttl_seconds)
    };
    this.expireElapsedHandoffs(input.workspace_id, "system:clock");
    return this.mutate(input.workspace_id, normalized.actor, normalized.idempotency_key, "handoff.respond", normalized, () => {
      const offer = this.requireHandoff(normalized.handoff_id);
      if (offer.workspace_id !== input.workspace_id)
        throw new CollabError("handoff_not_found", "Handoff was not found in this workspace");
      if (offer.to_actor !== normalized.actor)
        throw new CollabError("handoff_not_recipient", "Only the named recipient may respond");
      if (offer.status === "expired")
        throw new CollabError("handoff_expired", "The handoff has expired");
      if (offer.status !== "pending")
        throw new CollabError("handoff_resolved", "Handoff has already been resolved", { status: offer.status });
      const row = this.requireTaskRow(input.workspace_id, offer.task_id);
      this.requireVersion(row, normalized.expected_version);
      if (this.timestamp() >= offer.expires_at || this.isExpired(row)) {
        throw new CollabError("handoff_expired", "The handoff or source lease has expired");
      }
      this.requireActiveLease(row, offer.from_actor, row.lease_id ?? "");
      const now = this.timestamp();
      const version = row.version + 1;
      if (normalized.response === "decline") {
        this.db.query(`UPDATE handoffs SET status = 'declined', resolved_at = ? WHERE id = ?`).run(now, offer.id);
        this.db.query(`UPDATE tasks SET version = ?, updated_at = ? WHERE workspace_id = ? AND id = ?`).run(version, now, input.workspace_id, row.id);
        this.appendEvent(input.workspace_id, "handoff.declined", offer.id, normalized.actor, {
          task_id: row.id,
          task_version: version
        });
      } else {
        const leaseId = `lease_${randomUUID()}`;
        const leaseExpiresAt = addSeconds(now, normalized.ttl_seconds);
        this.db.query(`UPDATE handoffs SET status = 'accepted', resolved_at = ? WHERE id = ?`).run(now, offer.id);
        this.db.query(`
          UPDATE tasks SET assignee = ?, lease_id = ?, lease_expires_at = ?, version = ?, updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(normalized.actor, leaseId, leaseExpiresAt, version, now, input.workspace_id, row.id);
        this.appendEvent(input.workspace_id, "handoff.accepted", offer.id, normalized.actor, {
          task_id: row.id,
          from_actor: offer.from_actor,
          to_actor: normalized.actor,
          lease_id: leaseId,
          lease_expires_at: leaseExpiresAt,
          task_version: version
        });
      }
      return { handoff: this.requireHandoff(offer.id), task: this.requireTask(input.workspace_id, row.id) };
    });
  }
  offerHandoffForSession(input) {
    const normalized = normalizeSessionLeaseInput(input);
    const toSessionId = validateId(input.to_session_id, "to_session_id");
    const summary = cleanText(input.summary, "summary", 4000);
    const ttl = validateTtl(input.ttl_seconds);
    if (toSessionId === input.session_id) {
      throw new CollabError("invalid_handoff", "A handoff target must be a different session");
    }
    return this.mutateAsSession(input, normalized.idempotency_key, "handoff.offer.v2", { ...normalized.request, to_session_id: toSessionId, summary, ttl_seconds: ttl }, (session) => {
      const target = this.requireCoordinationSessionRow(toSessionId);
      if (target.workspace_id !== session.workspace_id || target.status !== "active") {
        throw new CollabError("handoff_target_unavailable", "The target must be an active session in the same workspace");
      }
      const row = this.requireTaskRow(session.workspace_id, normalized.task_id);
      this.requireVersion(row, normalized.expected_version);
      this.requireActiveSessionLease(row, session, normalized.lease_id);
      const now = this.timestamp();
      const pending = this.db.query(`
          SELECT id FROM handoffs
          WHERE workspace_id = ? AND task_id = ? AND status = 'pending' AND expires_at > ?
        `).get(row.workspace_id, row.id, now);
      if (pending) {
        throw new CollabError("handoff_pending", "Task already has a pending handoff", {
          handoff_id: pending.id
        });
      }
      const id = `handoff_${randomUUID()}`;
      const expiresAt = addSeconds(now, ttl);
      this.db.query(`
          INSERT INTO handoffs (
            id, workspace_id, task_id, from_actor, from_session_id,
            to_actor, to_session_id, summary, status, offered_at, expires_at, resolved_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL)
        `).run(id, row.workspace_id, row.id, session.actor, session.id, target.actor, target.id, summary, now, expiresAt);
      const version = row.version + 1;
      this.db.query(`
          UPDATE tasks SET version = ?, updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(version, now, row.workspace_id, row.id);
      const handoff = this.requireHandoff(id);
      this.appendEvent(row.workspace_id, "handoff.offered", id, session.actor, {
        handoff,
        task_version: version,
        note: "The current session keeps its coordination lease until the target explicitly accepts."
      }, session.id);
      return { handoff, task: this.requireTask(row.workspace_id, row.id) };
    });
  }
  respondHandoffForSession(input) {
    const handoffId = validateId(input.handoff_id, "handoff_id");
    const expectedVersion = validateExpectedVersion(input.expected_version);
    if (input.response !== "accept" && input.response !== "decline") {
      throw new CollabError("invalid_handoff_response", "Handoff response is invalid");
    }
    const ttl = validateTtl(input.ttl_seconds);
    const request = {
      handoff_id: handoffId,
      expected_version: expectedVersion,
      response: input.response,
      ttl_seconds: ttl
    };
    const replay = this.readSessionMutationReceipt(input, input.idempotency_key, "handoff.respond.v2", request);
    if (replay.found)
      return replay.value;
    const preparedCheckpoint = input.response === "accept" ? this.captureSessionWorktree(input) : null;
    return this.mutateAsSession(input, input.idempotency_key, "handoff.respond.v2", request, (session) => {
      const offer = this.requireHandoff(handoffId);
      if (offer.workspace_id !== session.workspace_id || offer.to_session_id !== session.id) {
        throw new CollabError("handoff_not_recipient", "Only the named target session may respond");
      }
      if (offer.status !== "pending") {
        throw new CollabError(offer.status === "expired" ? "handoff_expired" : "handoff_resolved", "Handoff is no longer pending", { status: offer.status });
      }
      const row = this.requireTaskRow(session.workspace_id, offer.task_id);
      this.requireVersion(row, expectedVersion);
      if (this.timestamp() >= offer.expires_at || this.isExpired(row)) {
        throw new CollabError("handoff_expired", "The offer or source lease expired");
      }
      if (row.assignee_session_id !== offer.from_session_id || row.lease_id === null) {
        throw new CollabError("handoff_source_changed", "The source lease changed");
      }
      const now = this.timestamp();
      const version = row.version + 1;
      if (input.response === "decline") {
        this.db.query(`
            UPDATE handoffs SET status = 'declined', resolved_at = ? WHERE id = ?
          `).run(now, offer.id);
        this.db.query(`
            UPDATE tasks SET version = ?, updated_at = ?
            WHERE workspace_id = ? AND id = ?
          `).run(version, now, row.workspace_id, row.id);
        this.appendEvent(row.workspace_id, "handoff.declined", offer.id, session.actor, {
          task_id: row.id,
          task_version: version
        }, session.id);
      } else {
        const worktree = this.requirePreparedWorktree(session, preparedCheckpoint);
        const checkpoint = preparedCheckpoint.checkpoint;
        this.requireExpectedBase(row, checkpoint);
        const leaseId = `lease_${randomUUID()}`;
        const leaseExpiresAt = addSeconds(now, ttl);
        this.db.query(`
            UPDATE handoffs SET status = 'accepted', resolved_at = ? WHERE id = ?
          `).run(now, offer.id);
        this.db.query(`
            UPDATE tasks
            SET assignee = ?, assignee_session_id = ?, claim_worktree_id = ?,
              lease_id = ?, lease_expires_at = ?, base_checkpoint_json = ?,
              version = ?, updated_at = ?
            WHERE workspace_id = ? AND id = ?
          `).run(session.actor, session.id, worktree.id, leaseId, leaseExpiresAt, canonicalJson(checkpoint), version, now, row.workspace_id, row.id);
        this.appendEvent(row.workspace_id, "handoff.accepted", offer.id, session.actor, {
          task_id: row.id,
          from_session_id: offer.from_session_id,
          to_session_id: session.id,
          lease_id: leaseId,
          lease_expires_at: leaseExpiresAt,
          base_checkpoint: checkpoint,
          task_version: version
        }, session.id);
      }
      return {
        handoff: this.requireHandoff(offer.id),
        task: this.requireTask(row.workspace_id, row.id)
      };
    });
  }
  nextForActor(workspaceId, actorInput, afterSequence = 0, eventLimit = DEFAULT_NEXT_EVENT_LIMIT) {
    const actor = validateActor(actorInput);
    const boundedEventLimit = validateNextEventLimit(eventLimit);
    this.expireElapsedHandoffs(workspaceId, "system:clock");
    const read = this.db.transaction(() => {
      const events = this.readEventPage(workspaceId, afterSequence, boundedEventLimit);
      const tasks = this.listTasks(workspaceId);
      const offers = this.db.query(`
        SELECT * FROM handoffs
        WHERE workspace_id = ? AND to_actor = ? AND status = 'pending' AND expires_at > ?
        ORDER BY offered_at, id
      `).all(workspaceId, actor, this.timestamp());
      const { claimable, conflicted } = this.projectAvailableTasks(workspaceId, tasks, (task) => task.effective_status === "lease_expired" && task.assignee_session_id === null);
      const reportRows = this.db.query(`
        SELECT * FROM reports
        WHERE workspace_id = ? AND event_sequence > ? AND event_sequence <= ?
        ORDER BY event_sequence
      `).all(workspaceId, afterSequence, events.next_anchor.sequence);
      return {
        actor,
        session: null,
        own_claims: tasks.filter((task) => task.effective_status === "claimed" && task.assignee === actor),
        ready_tasks: claimable,
        claimable_tasks: claimable,
        conflicted_tasks: conflicted,
        handoff_offers: offers.map((row) => ({
          handoff: handoffFromRow(row),
          task: this.requireTask(workspaceId, row.task_id)
        })),
        recovery_required: recoveryRequiredFirst(tasks, () => false),
        reports: reportRows.map(reportFromRow),
        events,
        projection_scope: "snapshot_head",
        reports_scope: "event_page"
      };
    });
    return read.deferred();
  }
  nextForSession(input) {
    const authenticatedPoll = this.db.transaction(() => {
      const authenticated = this.authenticateSession(input);
      const stored = {
        epoch_id: authenticated.cursor_epoch_id,
        sequence: authenticated.cursor_sequence,
        hash: authenticated.cursor_hash
      };
      try {
        this.validateEventAnchor(authenticated.workspace_id, stored);
      } catch (error) {
        if (error instanceof CollabError) {
          throw new CollabError("cursor_reset_required", "The persisted session cursor no longer matches this journal", { cursor: stored, cause: error.code });
        }
        throw error;
      }
      if (input.known_cursor) {
        const known = input.known_cursor;
        try {
          this.validateEventAnchor(authenticated.workspace_id, known);
        } catch (error) {
          if (error instanceof CollabError) {
            throw new CollabError("cursor_reset_required", "The caller's last-known cursor no longer matches this journal", { cursor: known, cause: error.code });
          }
          throw error;
        }
      }
      if (input.after_sequence !== undefined) {
        requireBoundAfterSequence(input.after_sequence, authenticated);
      }
      const eventLimit2 = validateNextEventLimit(input.event_limit);
      this.recordSessionLeaseLapses(authenticated, this.timestamp());
      this.db.query(`UPDATE coordination_sessions SET last_seen_at = ? WHERE id = ?`).run(this.timestamp(), authenticated.id);
      return {
        row: this.requireCoordinationSessionRow(authenticated.id),
        event_limit: eventLimit2
      };
    }).immediate();
    const { row, event_limit: eventLimit } = authenticatedPoll;
    this.expireElapsedHandoffs(row.workspace_id, "system:clock");
    const read = this.db.transaction(() => {
      const current = this.authenticateSession(input);
      const events = this.readEventPage(current.workspace_id, current.cursor_sequence, eventLimit);
      const tasks = this.listTasks(current.workspace_id);
      const { claimable, conflicted } = this.projectAvailableTasks(current.workspace_id, tasks, () => false);
      const handoffs = this.db.query(`
        SELECT * FROM handoffs
        WHERE workspace_id = ? AND to_session_id = ? AND status = 'pending' AND expires_at > ?
        ORDER BY offered_at, id
      `).all(current.workspace_id, current.id, this.timestamp());
      const reportRows = this.db.query(`
        SELECT * FROM reports
        WHERE workspace_id = ? AND event_sequence > ? AND event_sequence <= ?
          AND (to_session_id IS NULL OR to_session_id = ?)
        ORDER BY event_sequence
      `).all(current.workspace_id, current.cursor_sequence, events.next_anchor.sequence, current.id);
      return {
        actor: current.actor,
        session: this.sessionProjection(current),
        own_claims: tasks.filter((task) => task.effective_status === "claimed" && task.assignee_session_id === current.id),
        ready_tasks: claimable,
        claimable_tasks: claimable,
        conflicted_tasks: conflicted,
        handoff_offers: handoffs.map((handoff) => ({
          handoff: handoffFromRow(handoff),
          task: this.requireTask(current.workspace_id, handoff.task_id)
        })),
        recovery_required: recoveryRequiredFirst(tasks, (task) => task.assignee_session_id === current.id),
        reports: reportRows.map(reportFromRow),
        events,
        projection_scope: "snapshot_head",
        reports_scope: "event_page"
      };
    });
    return read.deferred();
  }
  eventsSince(workspaceId, afterSequence = 0, limit = 100) {
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new CollabError("invalid_cursor", "Event cursor must be a non-negative integer");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new CollabError("invalid_limit", "Event limit must be between 1 and 500");
    }
    const readPage = this.db.transaction(() => this.readEventPage(workspaceId, afterSequence, limit));
    return readPage.deferred();
  }
  eventsAfterAnchorForSession(input) {
    const limit = validateNextEventLimit(input.event_limit ?? DEFAULT_WAIT_EVENT_LIMIT);
    try {
      const db = this.nonblockingEventReader();
      const authenticateRead = () => {
        const session = this.authenticateSession(input, {}, db);
        if (session.workspace_id !== input.workspace_id) {
          throw new CollabError("session_workspace_mismatch", "The bound session belongs to another workspace");
        }
        const stored = {
          epoch_id: session.cursor_epoch_id,
          sequence: session.cursor_sequence,
          hash: session.cursor_hash
        };
        try {
          this.validateEventAnchor(session.workspace_id, stored, db, MAX_WAIT_ANCHOR_BYTES);
          if (input.last_cursor) {
            const known = this.validateEventAnchor(session.workspace_id, input.last_cursor, db, MAX_WAIT_ANCHOR_BYTES);
            if (known.sequence > stored.sequence) {
              throw new CollabError("cursor_regression", "The persisted cursor is behind the host cursor");
            }
          }
        } catch (error) {
          if (!(error instanceof CollabError))
            throw error;
          if (error.code === "event_anchor_too_large")
            throw error;
          throw new CollabError("cursor_reset_required", "The session cursor requires explicit reconciliation", { cause: error.code });
        }
        return session;
      };
      const page = db.transaction(() => {
        const session = authenticateRead();
        const anchor = this.validateEventAnchor(session.workspace_id, input.after_anchor, db, MAX_WAIT_ANCHOR_BYTES);
        const page2 = this.readEventPage(session.workspace_id, anchor.sequence, limit, db, MAX_WAIT_PAGE_BYTES);
        if (!page2.chain_valid || page2.events.some((event) => event.epoch_id !== anchor.epoch_id || event.workspace_id !== session.workspace_id || event.sequence > page2.head_sequence)) {
          throw new CollabError("database_journal_invalid", "The returned event page failed hash-chain verification");
        }
        return page2;
      }).deferred();
      db.transaction(() => {
        const current = authenticateRead();
        this.validateEventAnchor(current.workspace_id, page.next_anchor, db, MAX_WAIT_ANCHOR_BYTES);
        const workspace = this.requireWorkspace(current.workspace_id, db);
        if (workspace.event_head_sequence < page.head_sequence) {
          throw new CollabError("cursor_ahead", "The journal rolled back during observation");
        }
        const observedHead = page.head_sequence === 0 ? { hash: GENESIS_HASH } : db.query("SELECT hash FROM events WHERE workspace_id = ? AND sequence = ?").get(current.workspace_id, page.head_sequence);
        if (observedHead?.hash !== page.head_hash || workspace.event_head_sequence === page.head_sequence && workspace.event_head_hash !== page.head_hash) {
          throw new CollabError("cursor_fork_detected", "The observed journal head changed during observation");
        }
      }).deferred();
      return page;
    } catch (error) {
      const code = error?.code;
      if (code?.startsWith("SQLITE_BUSY") || code?.startsWith("SQLITE_LOCKED")) {
        throw new CollabError("event_read_busy", "The journal is busy; no page was returned");
      }
      if (error instanceof SyntaxError || code === "SQLITE_CORRUPT" || code === "SQLITE_NOTADB") {
        throw new CollabError("database_journal_invalid", "The journal contains malformed event data");
      }
      throw error;
    }
  }
  requireEventByteBound(db, workspaceId, sequence, maxBytes, purpose = "page") {
    const row = db.query(`
      SELECT length(CAST(payload_json AS BLOB)) + length(CAST(actor AS BLOB))
        + length(CAST(entity_id AS BLOB)) + length(CAST(id AS BLOB))
        + length(CAST(epoch_id AS BLOB)) + length(CAST(workspace_id AS BLOB))
        + length(CAST(type AS BLOB)) + length(CAST(protocol AS BLOB))
        + length(CAST(occurred_at AS BLOB)) + length(CAST(prev_hash AS BLOB))
        + length(CAST(hash AS BLOB)) + coalesce(length(CAST(session_id AS BLOB)), 0) AS bytes
      FROM events WHERE workspace_id = ? AND sequence = ?
    `).get(workspaceId, sequence);
    if (row && row.bytes > maxBytes) {
      if (purpose === "anchor") {
        throw new CollabError("event_anchor_too_large", "An anchor exceeds the bounded validation ceiling; operator reconciliation is required", {
          sequence,
          max_anchor_bytes: maxBytes
        });
      }
      throw new CollabError("event_too_large", "An event exceeds the bounded observation page; use an explicit larger-read workflow", {
        sequence,
        max_page_bytes: maxBytes
      });
    }
  }
  readEventPage(workspaceId, afterSequence, limit, db = this.db, maxBytes) {
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new CollabError("invalid_cursor", "Event cursor must be a non-negative integer");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new CollabError("invalid_limit", "Event limit must be between 1 and 500");
    }
    const workspace = this.requireWorkspace(workspaceId, db);
    if (afterSequence > workspace.event_head_sequence) {
      throw new CollabError("invalid_cursor", "Event cursor is ahead of the workspace journal", {
        after_sequence: afterSequence,
        head_sequence: workspace.event_head_sequence
      });
    }
    const predecessor = afterSequence === 0 ? { hash: GENESIS_HASH } : db.query(`SELECT hash FROM events WHERE workspace_id = ? AND sequence = ?`).get(workspaceId, afterSequence);
    if (!predecessor) {
      throw new CollabError("cursor_mismatch", "The cursor does not resolve to an event in this journal", { after_sequence: afterSequence });
    }
    const select = `SELECT protocol, workspace_id, epoch_id, sequence, id, type, entity_id, actor,
      session_id, occurred_at, payload_json, prev_hash, hash FROM events`;
    let events;
    if (maxBytes === undefined) {
      const rows = db.query(`${select} WHERE workspace_id = ? AND sequence > ? ORDER BY sequence LIMIT ?`).all(workspaceId, afterSequence, limit);
      events = rows.map(eventFromRow);
    } else {
      events = [];
      let bytes = 2048;
      const sequences = db.query(`SELECT sequence FROM events WHERE workspace_id = ? AND sequence > ? ORDER BY sequence LIMIT ?`).all(workspaceId, afterSequence, limit);
      for (const { sequence } of sequences) {
        try {
          this.requireEventByteBound(db, workspaceId, sequence, maxBytes);
        } catch (error) {
          if (events.length && error instanceof CollabError && error.code === "event_too_large")
            break;
          throw error;
        }
        const event = eventFromRow(db.query(`${select} WHERE workspace_id = ? AND sequence = ?`).get(workspaceId, sequence));
        const size = Buffer.byteLength(JSON.stringify(event)) + 1;
        if (bytes + size > maxBytes) {
          if (events.length)
            break;
          throw new CollabError("event_too_large", "An event exceeds the bounded observation page", {
            sequence,
            max_page_bytes: maxBytes
          });
        }
        events.push(event);
        bytes += size;
      }
    }
    const chainValid = verifyEventPage(events, afterSequence, predecessor.hash, workspace.event_head_sequence, workspace.event_head_hash);
    const cursor = {
      epoch_id: workspace.epoch_id,
      sequence: afterSequence,
      hash: predecessor.hash
    };
    const last = events.at(-1);
    const nextAnchor = last ? { epoch_id: last.epoch_id, sequence: last.sequence, hash: last.hash } : cursor;
    const page = {
      events,
      next_cursor: nextAnchor.sequence,
      cursor,
      next_anchor: nextAnchor,
      head_sequence: workspace.event_head_sequence,
      head_hash: workspace.event_head_hash,
      has_more: nextAnchor.sequence < workspace.event_head_sequence,
      chain_valid: chainValid,
      verification_scope: "returned_page"
    };
    if (maxBytes !== undefined && Buffer.byteLength(JSON.stringify(page)) > maxBytes) {
      throw new CollabError("event_page_too_large", "The observation page exceeds its byte limit");
    }
    return page;
  }
  eventsAfterAnchor(workspaceId, anchor, limit = 100) {
    const validated = this.validateEventAnchor(workspaceId, anchor);
    return this.eventsSince(workspaceId, validated.sequence, limit);
  }
  eventAddressesSession(event, sessionId) {
    const payload = event.payload ?? {};
    const field = (value, key) => value !== null && typeof value === "object" ? value[key] : undefined;
    switch (event.type) {
      case "report.posted": {
        if (payload.to_session_id === sessionId)
          return true;
        if (typeof payload.target_report_id !== "string")
          return false;
        const target = this.db.query(`SELECT from_session_id FROM reports WHERE id = ?`).get(payload.target_report_id);
        return target?.from_session_id === sessionId;
      }
      case "handoff.offered":
        return field(payload.handoff, "to_session_id") === sessionId;
      case "handoff.accepted":
      case "handoff.declined":
      case "handoff.expired": {
        const offer = this.db.query(`SELECT from_session_id FROM handoffs WHERE id = ?`).get(event.entity_id);
        return offer?.from_session_id === sessionId;
      }
      case "task.reported_complete":
        return payload.review_requested_session_id === sessionId;
      case "task.accepted":
      case "task.changes_requested": {
        const task = this.db.query(`SELECT reported_by_session_id FROM tasks WHERE workspace_id = ? AND id = ?`).get(event.workspace_id, event.entity_id);
        return task?.reported_by_session_id === sessionId;
      }
      case "task.recovered":
        return field(payload.prior_lease, "session_id") === sessionId;
      case "proposal.opened": {
        const voices = Array.isArray(payload.voices) ? payload.voices : [];
        return voices.some((voice) => field(voice, "voice_id") !== payload.author_voice_id && Array.isArray(field(voice, "live_session_ids")) && field(voice, "live_session_ids").includes(sessionId));
      }
      case "proposal.rejected": {
        const proposal = this.db.query(`SELECT from_session_id FROM reports WHERE id = ?`).get(event.entity_id);
        return proposal?.from_session_id === sessionId;
      }
      default:
        return false;
    }
  }
  verifyJournal(workspaceId) {
    const audit = this.db.transaction(() => {
      this.requireWorkspace(workspaceId);
      return this.verifyJournalRows(workspaceId);
    });
    return audit.deferred();
  }
  verifyJournalRows(workspaceId) {
    const workspace = this.getWorkspace(workspaceId);
    if (!workspace)
      return false;
    const rows = this.db.query(`
      SELECT protocol, workspace_id, epoch_id, sequence, id, type, entity_id, actor,
        session_id, occurred_at, payload_json, prev_hash, hash
      FROM events WHERE workspace_id = ? ORDER BY sequence
    `).all(workspaceId);
    let expectedSequence = 1;
    let previous = GENESIS_HASH;
    try {
      for (const row of rows) {
        const event = eventFromRow(row);
        if (event.sequence !== expectedSequence || event.prev_hash !== previous)
          return false;
        if (event.hash !== eventHash(event))
          return false;
        previous = event.hash;
        expectedSequence += 1;
      }
    } catch {
      return false;
    }
    return workspace.event_head_sequence === rows.length && workspace.event_head_hash === previous;
  }
  mutate(workspaceId, actor, idempotencyKey, operation, request, apply) {
    this.requireWorkspace(workspaceId);
    const requestHash = sha2563(canonicalJson({ operation, request }));
    const transaction = this.db.transaction(() => {
      const existing = this.db.query(`
        SELECT operation, request_hash, response_json FROM mutations
        WHERE workspace_id = ? AND actor = ? AND idempotency_key = ?
      `).get(workspaceId, actor, idempotencyKey);
      if (existing) {
        if (existing.operation !== operation || existing.request_hash !== requestHash) {
          throw new CollabError("idempotency_conflict", "Idempotency key was already used for a different mutation", {
            operation: existing.operation
          });
        }
        return hydrateLegacyMutationResponse(JSON.parse(existing.response_json), this.timestamp());
      }
      const response2 = apply();
      this.db.query(`
        INSERT INTO mutations
          (workspace_id, actor, idempotency_key, operation, request_hash, response_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(workspaceId, actor, idempotencyKey, operation, requestHash, JSON.stringify(response2), this.timestamp());
      return response2;
    });
    const response = transaction.immediate();
    this.tightenFileModes();
    return response;
  }
  readSessionMutationReceipt(credential, idempotencyKeyInput, operation, request) {
    const session = this.authenticateSession(credential);
    const idempotencyKey = validateIdempotencyKey(idempotencyKeyInput);
    const requestHash = sha2563(canonicalJson({ operation, request }));
    const existing = this.db.query(`
      SELECT operation, request_hash, response_json FROM mutations
      WHERE workspace_id = ? AND actor = ? AND idempotency_key = ?
    `).get(session.workspace_id, `session:${session.id}`, idempotencyKey);
    if (!existing)
      return { found: false };
    if (existing.operation !== operation || existing.request_hash !== requestHash) {
      throw new CollabError("idempotency_conflict", "Idempotency key was already used for a different session mutation", { operation: existing.operation });
    }
    return {
      found: true,
      value: JSON.parse(existing.response_json)
    };
  }
  mutateAsSession(credential, idempotencyKeyInput, operation, request, apply, options = {}) {
    const idempotencyKey = validateIdempotencyKey(idempotencyKeyInput);
    const transaction = this.db.transaction(() => {
      const session = this.authenticateSession(credential, options);
      this.recordSessionLeaseLapses(session, this.timestamp());
      const mutationActor = `session:${session.id}`;
      const requestHash = sha2563(canonicalJson({ operation, request }));
      const existing = this.db.query(`
        SELECT operation, request_hash, response_json FROM mutations
        WHERE workspace_id = ? AND actor = ? AND idempotency_key = ?
      `).get(session.workspace_id, mutationActor, idempotencyKey);
      if (existing) {
        if (existing.operation !== operation || existing.request_hash !== requestHash) {
          throw new CollabError("idempotency_conflict", "Idempotency key was already used for a different session mutation", { operation: existing.operation });
        }
        this.db.query(`UPDATE coordination_sessions SET last_seen_at = ? WHERE id = ?`).run(this.timestamp(), session.id);
        return JSON.parse(existing.response_json);
      }
      this.db.query(`UPDATE coordination_sessions SET last_seen_at = ? WHERE id = ?`).run(this.timestamp(), session.id);
      const guardNonce = `guard_${randomUUID()}`;
      this.db.query(`INSERT INTO v2_write_guard (nonce, enabled) VALUES (?, 1)`).run(guardNonce);
      try {
        const response2 = apply(session);
        this.db.query(`
          INSERT INTO mutations (
            workspace_id, actor, idempotency_key, operation,
            request_hash, response_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(session.workspace_id, mutationActor, idempotencyKey, operation, requestHash, JSON.stringify(response2), this.timestamp());
        return response2;
      } finally {
        this.db.query(`DELETE FROM v2_write_guard WHERE nonce = ?`).run(guardNonce);
      }
    });
    const response = transaction.immediate();
    this.tightenFileModes();
    return response;
  }
  authenticateSession(input, options = {}, db = this.db) {
    let id;
    try {
      id = validateId(input.session_id, "session_id");
    } catch {
      throw new CollabError("session_auth_failed", "Session credentials are invalid");
    }
    const row = db.query(`SELECT * FROM coordination_sessions WHERE id = ?`).get(id);
    const suppliedHash = hashSessionToken(typeof input.session_token === "string" ? input.session_token : "");
    const expectedHash = row?.token_hash ?? "0".repeat(64);
    const tokenMatches = safeDigestEqual(suppliedHash, expectedHash);
    const generationMatches = Number.isInteger(input.generation) && row !== null && input.generation === row.generation;
    if (!row || !tokenMatches || !generationMatches || row.status !== "active") {
      throw new CollabError("session_auth_failed", "Session credentials are invalid");
    }
    if (row.cursor_recovery_required !== 0 && !options.allow_cursor_recovery) {
      throw new CollabError("cursor_recovery_required", "Reset this session to an exact journal anchor before further mutations", {
        persisted_cursor: {
          epoch_id: row.cursor_epoch_id,
          sequence: row.cursor_sequence,
          hash: row.cursor_hash
        },
        expected_cursor_version: row.cursor_version
      });
    }
    return row;
  }
  authenticateResumeToken(sessionId, token) {
    const row = this.db.query(`SELECT * FROM coordination_sessions WHERE id = ?`).get(sessionId);
    const suppliedHash = hashSessionToken(typeof token === "string" ? token : "");
    const expectedHash = row?.token_hash ?? "0".repeat(64);
    if (!row || !safeDigestEqual(suppliedHash, expectedHash) || row.status !== "active") {
      throw new CollabError("session_auth_failed", "Session credentials are invalid");
    }
    return row;
  }
  captureSessionWorktree(input) {
    const session = this.authenticateSession(input);
    const worktree = this.requireWorktreeRow(session.worktree_id);
    return this.captureRegisteredWorktree(session, worktree);
  }
  captureReviewCheckpoint(input, taskId) {
    const session = this.authenticateSession(input);
    const task = this.requireTaskRow(session.workspace_id, taskId);
    if (task.completion_policy !== "accepted" || task.review_status !== "pending")
      return null;
    const resultCheckpoint = parseCheckpoint(task.result_checkpoint_json);
    if (resultCheckpoint?.source !== "server_observed")
      return null;
    const worktree = this.requireWorktreeRow(resultCheckpoint.worktree_id);
    if (worktree.workspace_id !== session.workspace_id) {
      throw new CollabError("checkpoint_workspace_mismatch", "The completion checkpoint belongs to another workspace");
    }
    const observedWorktree = this.captureRegisteredWorktree(session, worktree);
    const resultHead = resultCheckpoint.head_sha;
    const observedHead = observedWorktree.checkpoint.head_sha;
    return {
      workspace_id: session.workspace_id,
      task_id: taskId,
      result_checkpoint: resultCheckpoint,
      observed_worktree: observedWorktree,
      host_commit: resultHead && observedHead && observedHead !== resultHead ? inspectSuccessorCommit(worktree.root_path, observedHead, resultHead) : null
    };
  }
  hostCommitSuccessorBasis(row, prepared) {
    const result = prepared.result_checkpoint;
    const observed = prepared.observed_worktree.checkpoint;
    const inspected = prepared.host_commit;
    if (observed.head_sha === result.head_sha) {
      return {
        refusal: "HEAD has not moved since the result checkpoint, so only an exact checkpoint match is accepted"
      };
    }
    if (observed.worktree_id !== result.worktree_id) {
      return { refusal: "The observed worktree is not the result checkpoint's worktree" };
    }
    if (!result.branch) {
      return {
        refusal: "The result checkpoint was captured on a detached HEAD, so no branch can carry a host commit"
      };
    }
    if (observed.branch !== result.branch) {
      const where = observed.branch ? `branch "${observed.branch}"` : "a detached HEAD";
      return {
        refusal: `HEAD is on ${where}, not the result checkpoint's branch "${result.branch}"`
      };
    }
    if (observed.dirty !== false) {
      return { refusal: "The observed worktree is not clean" };
    }
    if (!inspected || inspected.commit_sha !== observed.head_sha) {
      return { refusal: "The server did not inspect the observed HEAD commit" };
    }
    if (!inspected.ok)
      return { refusal: inspected.reason };
    const commit = inspected.commit_sha;
    if (inspected.parent_sha !== result.head_sha) {
      return { refusal: `Commit ${commit} does not follow the result checkpoint HEAD` };
    }
    if (inspected.changes.length === 0) {
      return { refusal: `Commit ${commit} changes no path` };
    }
    const scopes = parseStringArray(row.path_scopes_json);
    const rejectedThrough = this.db.query(`
      SELECT COALESCE(MAX(sequence), 0) AS sequence FROM events
      WHERE workspace_id = ? AND entity_id = ? AND type = 'task.changes_requested'
    `).get(row.workspace_id, row.id).sequence;
    const artifacts = this.db.query(`
      SELECT a.id, a.uri, a.sha256 FROM artifacts a
      JOIN events e
        ON e.workspace_id = a.workspace_id AND e.entity_id = a.task_id
        AND e.type = 'artifact.attached' AND json_extract(e.payload_json, '$.artifact.id') = a.id
      WHERE a.workspace_id = ? AND a.task_id = ? AND a.kind = 'file' AND e.sequence > ?
      ORDER BY e.sequence
    `).all(row.workspace_id, row.id, rejectedThrough);
    const newest = new Map;
    for (const artifact of artifacts) {
      const path = artifactRepositoryPath(artifact.uri, prepared.observed_worktree.root_path);
      if (path !== null)
        newest.set(path, artifact);
    }
    const artifactIds = [];
    for (const change of inspected.changes) {
      if (!pathWithinScopes(change.path, scopes)) {
        return { refusal: `Commit ${commit} changes ${change.path}, outside the task's path_scopes` };
      }
      if (change.blob_sha256 === null) {
        return {
          refusal: `Commit ${commit} deletes ${change.path} or commits it as something other than a regular file`
        };
      }
      const artifact = newest.get(change.path);
      if (!artifact) {
        const since = rejectedThrough > 0 ? " since its latest request_changes" : "";
        return { refusal: `No file artifact attached to this task${since} names ${change.path}` };
      }
      if (!artifact.sha256) {
        return {
          refusal: `The newest file artifact for ${change.path} (${artifact.id}) has no sha256`
        };
      }
      if (artifact.sha256 !== change.blob_sha256) {
        return {
          refusal: `The committed bytes of ${change.path} differ from its newest file artifact ${artifact.id}`
        };
      }
      artifactIds.push(artifact.id);
    }
    return { commit_sha: commit, artifact_ids: artifactIds };
  }
  captureRegisteredWorktree(session, worktree) {
    let identity;
    try {
      identity = inspectRepository(worktree.root_path);
    } catch (error) {
      throw new CollabError("worktree_unavailable", "The registered worktree could not be inspected", {
        worktree_id: worktree.id,
        cause: error instanceof CollabError ? error.code : "repository_inspection_failed"
      });
    }
    if (identity.root_path !== worktree.root_path || identity.checkpoint.worktree_id !== worktree.id || identity.worktree_fingerprint !== worktree.fingerprint || identity.git_common_dir_hash !== worktree.git_common_dir_hash) {
      throw new CollabError("worktree_identity_changed", "The registered path now resolves to a different worktree identity", { worktree_id: worktree.id });
    }
    return {
      session_id: session.id,
      workspace_id: session.workspace_id,
      worktree_id: worktree.id,
      root_path: worktree.root_path,
      fingerprint: worktree.fingerprint,
      git_common_dir_hash: worktree.git_common_dir_hash,
      checkpoint: identity.checkpoint
    };
  }
  requirePreparedWorktree(session, prepared) {
    if (prepared.session_id !== session.id || prepared.worktree_id !== session.worktree_id) {
      throw new CollabError("worktree_observation_stale", "The prepared worktree observation belongs to another session");
    }
    return this.requirePreparedRegisteredWorktree(session.workspace_id, session.worktree_id, prepared);
  }
  requirePreparedRegisteredWorktree(workspaceId, worktreeId2, prepared) {
    const row = this.requireWorktreeRow(worktreeId2);
    if (prepared.workspace_id !== workspaceId || prepared.worktree_id !== row.id || prepared.root_path !== row.root_path || prepared.fingerprint !== row.fingerprint || prepared.git_common_dir_hash !== row.git_common_dir_hash || row.workspace_id !== workspaceId) {
      throw new CollabError("worktree_observation_stale", "The registered worktree changed after it was inspected", { worktree_id: worktreeId2 });
    }
    this.touchWorktree(row, prepared.checkpoint, this.timestamp());
    return row;
  }
  requireExpectedBase(row, checkpoint) {
    if (row.expected_base_sha && checkpoint.head_sha !== row.expected_base_sha) {
      throw new CollabError("expected_base_mismatch", "The worktree HEAD does not match the task's required base", {
        expected_base_sha: row.expected_base_sha,
        observed_head_sha: checkpoint.head_sha,
        worktree_id: checkpoint.worktree_id
      });
    }
  }
  sessionHandle(row, token, workspace, worktreeRow) {
    return {
      workspace,
      worktree: worktreeFromRow(worktreeRow),
      session: this.sessionProjection(row),
      credential: {
        session_id: row.id,
        session_token: token,
        generation: row.generation,
        last_cursor: {
          epoch_id: row.cursor_epoch_id,
          sequence: row.cursor_sequence,
          hash: row.cursor_hash
        }
      },
      identity_boundary: "session_credentials_fence_cooperating_local_clients_but_do_not_authenticate_a_person_or_model"
    };
  }
  registerWorktree(workspaceId, identity, now, actor, emitEvent) {
    this.db.query(`INSERT OR IGNORE INTO repositories (key, created_at) VALUES (?, ?)`).run(identity.repository_key, now);
    this.db.query(`
      INSERT INTO worktrees (
        id, workspace_id, repository_key, root_path, git_common_dir_hash, fingerprint,
        branch, head_sha, dirty, registered_at, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(identity.checkpoint.worktree_id, workspaceId, identity.repository_key, identity.root_path, identity.git_common_dir_hash, identity.worktree_fingerprint, identity.checkpoint.branch, identity.checkpoint.head_sha, booleanToSql(identity.checkpoint.dirty), now, now);
    const row = this.requireWorktreeRow(identity.checkpoint.worktree_id);
    if (emitEvent) {
      this.appendEvent(workspaceId, "worktree.registered", row.id, actor, {
        root_path: row.root_path,
        repository_key: row.repository_key,
        checkpoint: checkpointFromWorktreeRow(row, now)
      });
    }
    return row;
  }
  touchWorktree(row, checkpoint, now) {
    this.db.query(`
      UPDATE worktrees
      SET branch = ?, head_sha = ?, dirty = ?, last_seen_at = ?
      WHERE id = ?
    `).run(checkpoint.branch, checkpoint.head_sha, booleanToSql(checkpoint.dirty), now, row.id);
  }
  requireWorktreeRow(id) {
    const row = this.db.query(`SELECT * FROM worktrees WHERE id = ?`).get(id);
    if (!row)
      throw new CollabError("worktree_not_found", `Worktree '${id}' was not found`);
    return row;
  }
  validateEventAnchor(workspaceId, input, db = this.db, maxBytes) {
    const workspace = this.requireWorkspace(workspaceId, db);
    if (!input || input.epoch_id !== workspace.epoch_id || !Number.isInteger(input.sequence) || input.sequence < 0 || typeof input.hash !== "string") {
      throw new CollabError("cursor_mismatch", "The cursor does not belong to this journal");
    }
    if (input.sequence === 0) {
      if (input.hash !== GENESIS_HASH) {
        throw new CollabError("cursor_fork_detected", "The genesis cursor hash is invalid");
      }
      return { ...input };
    }
    if (input.sequence > workspace.event_head_sequence) {
      throw new CollabError("cursor_ahead", "The cursor is ahead of the journal", {
        head_sequence: workspace.event_head_sequence
      });
    }
    if (maxBytes !== undefined)
      this.requireEventByteBound(db, workspaceId, input.sequence, maxBytes, "anchor");
    const row = db.query(`
      SELECT protocol, workspace_id, epoch_id, sequence, id, type, entity_id, actor,
        session_id, occurred_at, payload_json, prev_hash, hash
      FROM events
      WHERE workspace_id = ? AND sequence = ?
    `).get(workspaceId, input.sequence);
    const event = row ? eventFromRow(row) : null;
    if (!event || event.epoch_id !== input.epoch_id || event.hash !== input.hash || event.hash !== eventHash(event)) {
      throw new CollabError("cursor_fork_detected", "The cursor sequence resolves to a different journal hash");
    }
    return {
      epoch_id: event.epoch_id,
      sequence: event.sequence,
      hash: event.hash
    };
  }
  projectAvailableTasks(workspaceId, tasks, allowExpired) {
    const claimable = [];
    const conflicted = [];
    for (const task of tasks) {
      const available = task.effective_status === "open" || task.effective_status === "lease_expired" && allowExpired(task);
      if (!available || !this.dependenciesSatisfied(workspaceId, task.dependencies))
        continue;
      const conflicts = this.taskPathConflicts(task);
      if (conflicts.length > 0) {
        conflicted.push({ task, conflicts });
      } else {
        claimable.push(task);
      }
    }
    return { claimable, conflicted };
  }
  dependenciesSatisfied(workspaceId, dependencies) {
    return dependencies.every((id) => {
      const dependency = this.requireTask(workspaceId, id);
      if (dependency.status !== "completed")
        return false;
      return dependency.completion_policy !== "accepted" || dependency.review_status === "accepted";
    });
  }
  taskPathConflicts(task) {
    if (task.path_scopes.length === 0 || task.work_mode === "read_only")
      return [];
    const workspace = this.requireWorkspace(task.workspace_id);
    const rows = this.db.query(`
      SELECT t.*
      FROM tasks t
      JOIN workspaces w ON w.id = t.workspace_id
      WHERE (w.repository_key = ? OR w.id IN (
        SELECT other.workspace_id FROM worktrees own
        JOIN repository_aliases a ON a.worktree_id = own.id
        JOIN repository_aliases b ON b.portable_key = a.portable_key
        JOIN worktrees other ON other.id = b.worktree_id
        WHERE own.workspace_id = ?
      ))
        AND NOT (t.workspace_id = ? AND t.id = ?)
        AND (
          (t.status = 'claimed' AND (t.lease_expires_at > ? OR t.assignee_session_id IS NOT NULL))
          OR (t.status = 'completed' AND t.completion_policy = 'accepted'
              AND t.review_status = 'pending')
        )
    `).all(workspace.repository_key, task.workspace_id, task.workspace_id, task.id, this.timestamp());
    const result = [];
    for (const row of rows) {
      if (row.work_mode === "read_only")
        continue;
      const pairs = pathConflicts(task.path_scopes, parseStringArray(row.path_scopes_json));
      if (pairs.length > 0) {
        result.push({
          active_task_id: row.id,
          active_workspace_id: row.workspace_id,
          assignee: row.assignee,
          assignee_session_id: row.assignee_session_id,
          lease_expires_at: row.lease_expires_at,
          path_pairs: pairs
        });
      }
    }
    return result;
  }
  requireActiveSessionLease(row, session, leaseId) {
    if (row.status !== "claimed" || !row.lease_id || !row.lease_expires_at) {
      throw new CollabError("lease_not_active", "Task does not have an active lease");
    }
    if (this.isExpired(row, row.assignee_session_id === session.id ? session : undefined)) {
      throw new CollabError("lease_expired", "Task lease has expired", {
        lease_expires_at: row.lease_expires_at
      });
    }
    if (row.assignee_session_id !== session.id || row.lease_id !== leaseId) {
      throw new CollabError("lease_not_holder", "Mutation requires the current session lease", {
        assignee: row.assignee,
        assignee_session_id: row.assignee_session_id
      });
    }
  }
  clearSessionClaim(row, session, type, payload) {
    const now = this.timestamp();
    const version = row.version + 1;
    this.db.query(`
      UPDATE tasks
      SET status = 'open', assignee = NULL, assignee_session_id = NULL,
        claim_worktree_id = NULL, lease_id = NULL, lease_expires_at = NULL,
        version = ?, updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `).run(version, now, row.workspace_id, row.id);
    this.expirePendingHandoffs(row.workspace_id, row.id, now, session.actor, "task_released");
    this.appendEvent(row.workspace_id, type, row.id, session.actor, {
      ...payload,
      version
    }, session.id);
    return this.requireTask(row.workspace_id, row.id);
  }
  liveLeaseRefusal(workspaceId, sessionId, now, holderWillResume = false) {
    const live = this.db.query(`
      SELECT * FROM tasks
      WHERE workspace_id = ? AND assignee_session_id = ?
        AND status = 'claimed'
      ORDER BY id
    `).all(workspaceId, sessionId);
    const active = live.filter((task) => holderWillResume || !this.isExpired(task, undefined, now));
    if (active.length === 0)
      return null;
    return new CollabError("session_has_active_leases", "Release, complete, or hand off active task leases before ending the session, or end with release_leases: true. " + "A handoff counts once it is accepted; release_leases also expires this session's pending outgoing offers", {
      task_ids: active.map((task) => task.id),
      leases: active.map((task) => ({
        task_id: task.id,
        lease_id: task.lease_id,
        expires_at: task.lease_expires_at
      })),
      required_action: "resolve_active_task_leases",
      remedy: "Call collab_session_end again with release_leases: true (optionally release_summary) to release every lease this session holds and end in one step, or release, complete, or hand off each lease first. A handoff counts once it is accepted: ending with release_leases expires any offer still pending."
    });
  }
  expireSessionLeaseForRecovery(row, session, now) {
    const holder = row.assignee_session_id === session.id ? session : this.requireCoordinationSessionRow(row.assignee_session_id);
    const staleAt = holder.status === "ended" ? Date.parse(holder.ended_at ?? now) : Date.parse(holder.last_seen_at) + SESSION_STALE_AFTER_MS + 1;
    const lapse = this.db.query(`SELECT effective_at FROM session_lease_lapses WHERE lease_id = ?`).get(row.lease_id);
    const effectiveAt = lapse?.effective_at ?? (Number.isFinite(staleAt) ? new Date(Math.max(Date.parse(row.lease_expires_at), staleAt)).toISOString() : now);
    const prior = {
      assignee: row.assignee,
      session_id: row.assignee_session_id,
      lease_id: row.lease_id,
      lease_expires_at: row.lease_expires_at,
      checkpoint: parseCheckpoint(row.base_checkpoint_json)
    };
    const expiryVersion = row.version + 1;
    this.db.query(`
      UPDATE tasks
      SET status = 'open', assignee = NULL, assignee_session_id = NULL,
        claim_worktree_id = NULL, lease_id = NULL, lease_expires_at = NULL,
        version = ?, updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `).run(expiryVersion, now, row.workspace_id, row.id);
    this.expirePendingHandoffs(row.workspace_id, row.id, now, "system:clock", "source_lease_expired");
    this.appendEvent(row.workspace_id, "task.claim_expired", row.id, "system:clock", {
      ...prior,
      effective_at: effectiveAt,
      lease_lifetime_basis: "session_liveness",
      observed_by_session_id: session.id,
      version: expiryVersion
    });
    return { prior, expiryVersion };
  }
  recordRecoveryWithoutTakeover(row, session, input) {
    const version = input.expiry_version + 1;
    this.db.query(`
      UPDATE tasks
      SET status = ?, blocker = ?, version = ?, updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `).run(input.action === "block" ? "blocked" : "open", input.action === "block" ? input.blocker : null, version, input.now, row.workspace_id, row.id);
    const event = this.appendEvent(row.workspace_id, "task.recovered", row.id, session.actor, {
      prior_lease: input.prior,
      action: input.action,
      recovery_note: input.recovery_note,
      recovery_checkpoint: null,
      version,
      note: "Recovery acknowledges an expired coordination lease; it does not accept or attribute prior work."
    }, session.id);
    this.db.query(`
      INSERT INTO task_recoveries (
        id, workspace_id, task_id, prior_lease_id, prior_session_id,
        recovered_by_session_id, action, note, prior_checkpoint_json,
        new_lease_id, recovered_at, event_sequence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(`recovery_${randomUUID()}`, row.workspace_id, row.id, input.prior.lease_id, input.prior.session_id, session.id, input.action, input.recovery_note, input.prior.checkpoint ? canonicalJson(input.prior.checkpoint) : null, input.now, event.sequence);
    return this.requireTask(row.workspace_id, row.id);
  }
  recoveryBundle(row) {
    return {
      task_id: row.id,
      prior_assignee: row.assignee,
      prior_session_id: row.assignee_session_id,
      prior_lease_id: row.lease_id,
      lease_expires_at: row.lease_expires_at,
      base_checkpoint: parseCheckpoint(row.base_checkpoint_json),
      latest_progress: row.latest_progress,
      required_action: "collab_task_recover"
    };
  }
  validateReportInput(session, input) {
    if (input.task_id)
      this.requireTaskRow(session.workspace_id, input.task_id);
    if (input.to_session_id) {
      const targetSession = this.requireCoordinationSessionRow(input.to_session_id);
      if (targetSession.workspace_id !== session.workspace_id) {
        throw new CollabError("report_target_mismatch", "Report target is in another workspace");
      }
    }
    if (input.relation === "informs" && input.target_report_id) {
      throw new CollabError("invalid_report_relation", "An informing report does not target another report. To agree with or answer a report, use " + 'relation "supports" (or "challenges" to disagree) with target_report_id; ' + "to address a session, use to_session_id");
    }
    if (input.relation !== "informs" && !input.target_report_id) {
      throw new CollabError("report_target_required", "This report relation requires an earlier target report");
    }
    if (input.target_report_id) {
      const target = this.requireReport(input.target_report_id);
      if (target.workspace_id !== session.workspace_id) {
        throw new CollabError("report_target_mismatch", "Target report is in another workspace");
      }
      if (target.task_id !== input.task_id) {
        throw new CollabError("report_task_mismatch", "Related reports must use the same task scope as their target", { target_task_id: target.task_id, report_task_id: input.task_id });
      }
      if (["corrects", "withdraws", "supersedes"].includes(input.relation) && target.from_session_id !== session.id) {
        throw new CollabError("report_author_mismatch", "Only the original author session may correct, withdraw, or supersede its report; other sessions should challenge it");
      }
      if (input.relation === "resolves" && target.relation !== "challenges") {
        throw new CollabError("invalid_report_relation", "A resolving report must target a challenge. To agree with or confirm a proposal, use " + 'relation "supports" with target_report_id');
      }
    }
    if (input.kind === "decision" && (!input.authority_scope || !input.authority_basis)) {
      throw new CollabError("decision_authority_required", "Decision reports require an explicit authority scope and basis");
    }
    for (const reference of input.evidence_refs) {
      this.requireEvidenceRef(session.workspace_id, reference);
    }
  }
  appendReportInternal(session, input) {
    const id = `report_${randomUUID()}`;
    const now = this.timestamp();
    const event = this.appendEvent(session.workspace_id, "report.posted", id, session.actor, {
      ...input.to_person ? { to_person: true } : {},
      task_id: input.task_id,
      to_session_id: input.to_session_id,
      kind: input.kind,
      body: input.body,
      evidence_refs: input.evidence_refs,
      confidence: input.confidence,
      confidence_basis: input.confidence_basis,
      limits: input.limits,
      relation: input.relation,
      target_report_id: input.target_report_id,
      authority_scope: input.authority_scope,
      authority_basis: input.authority_basis
    }, session.id);
    this.db.query(`
      INSERT INTO reports (
        id, workspace_id, task_id, from_session_id, from_actor, to_session_id,
        kind, body, evidence_refs_json, confidence, confidence_basis, limits,
        relation, target_report_id, authority_scope, authority_basis,
        created_at, event_sequence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, session.workspace_id, input.task_id, session.id, session.actor, input.to_session_id, input.kind, input.body, canonicalJson(input.evidence_refs), input.confidence, input.confidence_basis, input.limits, input.relation, input.target_report_id, input.authority_scope, input.authority_basis, now, event.sequence);
    if (input.to_person) {
      this.db.query(`INSERT INTO person_addressed_reports (report_id, workspace_id) VALUES (?, ?)`).run(id, session.workspace_id);
    }
    return this.requireReport(id);
  }
  requireReport(id) {
    const row = this.db.query(`SELECT * FROM reports WHERE id = ?`).get(id);
    if (!row)
      throw new CollabError("report_not_found", `Report '${id}' was not found`);
    return reportFromRow(row);
  }
  requireReview(id) {
    const row = this.db.query(`SELECT * FROM task_reviews WHERE id = ?`).get(id);
    if (!row)
      throw new CollabError("review_not_found", `Review '${id}' was not found`);
    return reviewFromRow(row);
  }
  taskNotPendingReviewError(row, callerSessionId) {
    const plain = new CollabError("task_not_pending_review", "Task does not have a pending acceptance review", { review_status: row.review_status });
    if (row.completion_policy !== "accepted" || row.review_status !== "accepted" || !row.accepted_by_session_id || row.reported_by_session_id === callerSessionId || row.accepted_by_session_id === callerSessionId) {
      return plain;
    }
    const acceptance = this.db.query(`
      SELECT e.type AS type, e.payload_json AS payload_json
      FROM task_reviews r
      JOIN events e ON e.workspace_id = r.workspace_id AND e.sequence = r.event_sequence
      WHERE r.workspace_id = ? AND r.task_id = ? AND r.review_generation = ?
        AND r.outcome = 'accepted'
    `).get(row.workspace_id, row.id, row.review_generation);
    if (!acceptance || acceptance.type !== "task.accepted")
      return plain;
    const payload = JSON.parse(acceptance.payload_json);
    if (typeof payload.review_report_id !== "string")
      return plain;
    const reviewReportId = payload.review_report_id;
    const remedy = `Record a late concurring or dissenting review with collab_report_append: task_id "${row.id}", ` + `relation "supports" or "challenges", target_report_id "${reviewReportId}". ` + "A challenge records disagreement; it does not reopen the accepted task.";
    return new CollabError("task_not_pending_review", `Task was already accepted by session '${row.accepted_by_session_id}'. ${remedy}`, {
      review_status: row.review_status,
      review_report_id: reviewReportId,
      accepted_by_session_id: row.accepted_by_session_id,
      remedy
    });
  }
  requireRequestedReviewer(row, session, requestedSessionId) {
    if (row.completion_policy !== "accepted") {
      throw new CollabError("review_request_not_applicable", 'Only tasks with completion_policy "accepted" wait for review; omit review_requested_session_id', { completion_policy: row.completion_policy });
    }
    if (requestedSessionId === session.id) {
      throw new CollabError("review_request_self", "A requested reviewer must be a session distinct from the reporter");
    }
    const requested = this.db.query(`
      SELECT workspace_id, status FROM coordination_sessions WHERE id = ?
    `).get(requestedSessionId);
    if (!requested || requested.workspace_id !== session.workspace_id || requested.status !== "active") {
      throw new CollabError("review_requested_session_unavailable", "The requested reviewer must be an active session in this workspace; collab_workspace_status lists active_sessions", { review_requested_session_id: requestedSessionId });
    }
  }
  reviewRequestedSessionId(row) {
    if (row.status !== "completed" || row.completion_policy !== "accepted" || !row.completion_report_id) {
      return null;
    }
    const completion = this.db.query(`SELECT event_sequence FROM reports WHERE id = ?`).get(row.completion_report_id);
    if (!completion)
      return null;
    const event = this.db.query(`
      SELECT payload_json FROM events
      WHERE workspace_id = ? AND sequence > ? AND entity_id = ? AND type = 'task.reported_complete'
      ORDER BY sequence
      LIMIT 1
    `).get(row.workspace_id, completion.event_sequence, row.id);
    if (!event)
      return null;
    const payload = JSON.parse(event.payload_json);
    return payload.completion_report_id === row.completion_report_id && typeof payload.review_requested_session_id === "string" ? payload.review_requested_session_id : null;
  }
  hasUnresolvedChallenges(workspaceId, reportId) {
    return this.unresolvedChallengeIds(workspaceId, reportId).length > 0;
  }
  unresolvedChallengeIds(workspaceId, reportId) {
    const challenges = this.db.query(`
      SELECT id FROM reports
      WHERE workspace_id = ? AND target_report_id = ? AND relation = 'challenges'
      ORDER BY event_sequence
    `).all(workspaceId, reportId);
    return challenges.filter((challenge) => !this.hasActiveReportRelation(workspaceId, challenge.id, new Set(["withdraws"])) && !this.hasActiveReportRelation(workspaceId, challenge.id, new Set(["resolves"]))).map((challenge) => challenge.id);
  }
  hasObsoletedCompletionReport(workspaceId, reportId) {
    return this.hasActiveReportRelation(workspaceId, reportId, new Set(["withdraws", "corrects", "supersedes"]));
  }
  hasActiveReportRelation(workspaceId, reportId, relations) {
    const rows = this.db.query(`
      SELECT id, relation FROM reports
      WHERE workspace_id = ? AND target_report_id = ?
      ORDER BY event_sequence
    `).all(workspaceId, reportId);
    const obsoleted = this.activeObsoletionTargets(workspaceId);
    return rows.some((row) => relations.has(row.relation) && !obsoleted.has(row.id));
  }
  activeObsoletionTargets(workspaceId) {
    const rows = this.db.query(`
      SELECT id, target_report_id FROM reports
      WHERE workspace_id = ? AND target_report_id IS NOT NULL
        AND relation IN ('withdraws', 'corrects', 'supersedes')
      ORDER BY event_sequence DESC, id DESC
    `).all(workspaceId);
    const obsoleted = new Set;
    for (const row of rows) {
      if (!obsoleted.has(row.id))
        obsoleted.add(row.target_report_id);
    }
    return obsoleted;
  }
  requireEvidenceRef(workspaceId, reference) {
    const separator = reference.indexOf(":");
    if (separator < 1)
      throw invalidEvidenceRef("Evidence reference needs a kind prefix");
    const kind = reference.slice(0, separator);
    const id = reference.slice(separator + 1);
    if (!id)
      throw invalidEvidenceRef("Evidence reference ID is empty");
    let exists = false;
    if (kind === "artifact") {
      exists = this.db.query(`
        SELECT 1 FROM artifacts WHERE workspace_id = ? AND id = ?
      `).get(workspaceId, id) !== null;
    } else if (kind === "event") {
      exists = this.db.query(`
        SELECT 1 FROM events WHERE workspace_id = ? AND id = ?
      `).get(workspaceId, id) !== null;
    } else if (kind === "report") {
      exists = this.db.query(`
        SELECT 1 FROM reports WHERE workspace_id = ? AND id = ?
      `).get(workspaceId, id) !== null;
    } else if (kind === "checkpoint") {
      const tasks = this.db.query(`
        SELECT base_checkpoint_json, result_checkpoint_json
        FROM tasks WHERE workspace_id = ?
      `).all(workspaceId);
      exists = tasks.some((task) => {
        const checkpoints = [
          parseCheckpoint(task.base_checkpoint_json),
          parseCheckpoint(task.result_checkpoint_json)
        ];
        return checkpoints.some((checkpoint) => checkpoint !== null && checkpointDigest(checkpoint) === id);
      });
    } else {
      throw invalidEvidenceRef("Unsupported evidence reference kind");
    }
    if (!exists) {
      throw new CollabError("evidence_not_found", `Evidence reference was not found in this workspace. ${EVIDENCE_REFS_DESCRIPTION}`, { reference, allowed_prefixes: [...EVIDENCE_REF_PREFIXES] });
    }
  }
  appendEvent(workspaceId, type, entityId, actor, payload, sessionId = null) {
    const workspace = this.requireWorkspace(workspaceId);
    const event = {
      protocol: COLLAB_COORDINATION_PROTOCOL,
      workspace_id: workspaceId,
      epoch_id: workspace.epoch_id,
      sequence: workspace.event_head_sequence + 1,
      id: `event_${randomUUID()}`,
      type,
      entity_id: entityId,
      actor,
      session_id: sessionId,
      occurred_at: this.timestamp(),
      payload,
      prev_hash: workspace.event_head_hash,
      hash: ""
    };
    event.hash = eventHash(event);
    this.db.query(`
      INSERT INTO events
        (workspace_id, epoch_id, sequence, id, protocol, type, entity_id, actor,
          session_id, occurred_at, payload_json, prev_hash, hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(event.workspace_id, event.epoch_id, event.sequence, event.id, event.protocol, event.type, event.entity_id, event.actor, event.session_id ?? null, event.occurred_at, canonicalJson(event.payload), event.prev_hash, event.hash);
    this.db.query(`
      UPDATE workspaces SET event_head_sequence = ?, event_head_hash = ? WHERE id = ?
    `).run(event.sequence, event.hash, workspaceId);
    return event;
  }
  expireClaim(row, actor) {
    if (!this.isExpired(row))
      return row;
    const now = this.timestamp();
    const version = row.version + 1;
    const prior = { assignee: row.assignee, lease_id: row.lease_id, lease_expires_at: row.lease_expires_at };
    this.db.query(`
      UPDATE tasks SET status = 'open', assignee = NULL, lease_id = NULL, lease_expires_at = NULL,
        version = ?, updated_at = ? WHERE workspace_id = ? AND id = ?
    `).run(version, now, row.workspace_id, row.id);
    this.expirePendingHandoffs(row.workspace_id, row.id, now, actor, "source_lease_expired");
    this.appendEvent(row.workspace_id, "task.claim_expired", row.id, actor, { ...prior, version });
    return this.requireTaskRow(row.workspace_id, row.id);
  }
  clearClaim(row, actor, type, payload) {
    const now = this.timestamp();
    const version = row.version + 1;
    this.db.query(`
      UPDATE tasks SET status = 'open', assignee = NULL, lease_id = NULL,
        lease_expires_at = NULL, version = ?, updated_at = ?
      WHERE workspace_id = ? AND id = ?
    `).run(version, now, row.workspace_id, row.id);
    this.expirePendingHandoffs(row.workspace_id, row.id, now, actor, "task_released");
    this.appendEvent(row.workspace_id, type, row.id, actor, { ...payload, version });
    return this.requireTask(row.workspace_id, row.id);
  }
  expirePendingHandoffs(workspaceId, taskId, now, actor, reason) {
    const rows = this.db.query(`
      SELECT * FROM handoffs WHERE workspace_id = ? AND task_id = ? AND status = 'pending'
    `).all(workspaceId, taskId);
    for (const row of rows) {
      this.db.query(`UPDATE handoffs SET status = 'expired', resolved_at = ? WHERE id = ?`).run(now, row.id);
      this.appendEvent(workspaceId, "handoff.expired", row.id, actor, { task_id: taskId, reason });
    }
  }
  expireElapsedHandoffs(workspaceId, actor, taskId) {
    this.requireWorkspace(workspaceId);
    const reap = this.db.transaction(() => {
      const now = this.timestamp();
      const rows = taskId ? this.db.query(`
            SELECT * FROM handoffs
            WHERE workspace_id = ? AND task_id = ? AND status = 'pending' AND expires_at <= ?
          `).all(workspaceId, taskId, now) : this.db.query(`
            SELECT * FROM handoffs
            WHERE workspace_id = ? AND status = 'pending' AND expires_at <= ?
          `).all(workspaceId, now);
      for (const row of rows) {
        this.db.query(`UPDATE handoffs SET status = 'expired', resolved_at = ? WHERE id = ?`).run(now, row.id);
        this.appendEvent(workspaceId, "handoff.expired", row.id, actor, {
          task_id: row.task_id,
          reason: "offer_deadline_elapsed"
        });
      }
    });
    reap.immediate();
    this.tightenFileModes();
  }
  requireDependenciesComplete(row) {
    const dependencies = parseStringArray(row.dependencies_json);
    const incomplete = dependencies.filter((id) => !this.dependenciesSatisfied(row.workspace_id, [id]));
    if (incomplete.length > 0) {
      throw new CollabError("dependencies_incomplete", "Task dependencies are not complete", { dependencies: incomplete });
    }
  }
  requirePathsAvailable(row) {
    const conflicts = this.taskPathConflicts(this.taskFromRow(row));
    if (conflicts.length > 0) {
      const first = conflicts[0];
      throw new CollabError("path_scope_conflict", "Task paths overlap reserved work", {
        conflicting_task_id: first.active_task_id,
        conflicting_workspace_id: first.active_workspace_id,
        assignee: first.assignee,
        assignee_session_id: first.assignee_session_id,
        lease_expires_at: first.lease_expires_at,
        conflicts: first.path_pairs
      });
    }
  }
  requireActiveLease(row, actor, leaseId) {
    if (row.status !== "claimed" || !row.lease_id || !row.lease_expires_at) {
      throw new CollabError("lease_not_active", "Task does not have an active lease");
    }
    if (this.isExpired(row)) {
      throw new CollabError("lease_expired", "Task lease has expired", { lease_expires_at: row.lease_expires_at });
    }
    if (row.assignee !== actor || row.lease_id !== leaseId) {
      throw new CollabError("lease_not_holder", "Mutation requires the current lease holder", {
        assignee: row.assignee
      });
    }
  }
  requireVersion(row, expected) {
    if (row.version !== expected) {
      throw new CollabError("version_conflict", "Task changed since it was read", {
        expected_version: expected,
        current_version: row.version
      });
    }
  }
  recordSessionLeaseLapses(session, now) {
    if (sessionLiveness(session, now) === "live")
      return;
    const staleAt = new Date(Date.parse(session.last_seen_at) + SESSION_STALE_AFTER_MS + 1).toISOString();
    this.db.query(`INSERT OR IGNORE INTO session_lease_lapses (lease_id, effective_at)
      SELECT lease_id, MAX(lease_expires_at, ?) FROM tasks
      WHERE assignee_session_id = ? AND status = 'claimed' AND lease_expires_at <= ?`).run(staleAt, session.id, now);
  }
  isExpired(row, priorHolder, observedAt = this.timestamp()) {
    if (row.status !== "claimed" || row.lease_expires_at === null || observedAt < row.lease_expires_at)
      return false;
    if (!row.assignee_session_id)
      return true;
    if (this.db.query(`SELECT 1 FROM session_lease_lapses WHERE lease_id = ?`).get(row.lease_id))
      return true;
    return (priorHolder ? sessionLiveness(priorHolder, observedAt) : this.assigneeLiveness(row.assignee_session_id, observedAt)) !== "live";
  }
  taskFromRow(row) {
    let effectiveStatus = row.status;
    if (this.isExpired(row)) {
      effectiveStatus = row.assignee_session_id ? "recovery_required" : "lease_expired";
    } else if (row.status === "completed" && row.review_status === "pending") {
      effectiveStatus = "reported_complete";
    } else if (row.status === "completed" && row.review_status === "accepted") {
      effectiveStatus = "accepted";
    }
    const baseCheckpoint = parseCheckpoint(row.base_checkpoint_json);
    const resultCheckpoint = parseCheckpoint(row.result_checkpoint_json);
    return {
      id: row.id,
      workspace_id: row.workspace_id,
      title: row.title,
      description: row.description,
      status: row.status,
      effective_status: effectiveStatus,
      dependencies: parseStringArray(row.dependencies_json),
      path_scopes: parseStringArray(row.path_scopes_json),
      work_mode: row.work_mode,
      completion_policy: row.completion_policy,
      review_status: row.review_status,
      expected_base_sha: row.expected_base_sha,
      base_checkpoint: baseCheckpoint,
      base_checkpoint_digest: baseCheckpoint ? checkpointDigest(baseCheckpoint) : null,
      result_checkpoint: resultCheckpoint,
      result_checkpoint_digest: resultCheckpoint ? checkpointDigest(resultCheckpoint) : null,
      completion_report_id: row.completion_report_id,
      assignee: row.assignee,
      assignee_session_id: row.assignee_session_id,
      assignee_liveness: this.assigneeLiveness(row.assignee_session_id),
      claim_worktree_id: row.claim_worktree_id,
      lease_id: row.lease_id,
      lease_expires_at: row.lease_expires_at,
      blocker: row.blocker,
      latest_progress: row.latest_progress,
      reported_by: row.reported_by,
      reported_by_session_id: row.reported_by_session_id,
      reported_at: row.reported_at,
      accepted_by: row.accepted_by,
      accepted_by_session_id: row.accepted_by_session_id,
      accepted_at: row.accepted_at,
      review_requested_session_id: this.reviewRequestedSessionId(row),
      version: row.version,
      created_at: row.created_at,
      updated_at: row.updated_at,
      completed_at: row.completed_at
    };
  }
  sessionProjection(row, observedAt = this.timestamp()) {
    return coordinationSessionFromRow(row, observedAt);
  }
  assigneeLiveness(sessionId, observedAt = this.timestamp()) {
    if (!sessionId)
      return null;
    const holder = this.db.query(`
      SELECT status, last_seen_at FROM coordination_sessions WHERE id = ?
    `).get(sessionId);
    return holder ? sessionLiveness(holder, observedAt) : null;
  }
  requireWorkspace(workspaceId, db = this.db) {
    const workspace = this.getWorkspace(workspaceId, db);
    if (!workspace)
      throw new CollabError("workspace_not_found", `Workspace '${workspaceId}' was not found`);
    return workspace;
  }
  readPresenceSessionByClient(workspaceId, clientInstanceId) {
    return this.db.query(`
      SELECT * FROM sessions
      WHERE workspace_id = ? AND client_instance_id = ?
    `).get(workspaceId, clientInstanceId);
  }
  requirePresenceSessionRow(sessionId) {
    const row = this.db.query(`SELECT * FROM sessions WHERE id = ?`).get(sessionId);
    if (!row) {
      throw new CollabError("session_not_found", `Presence session '${sessionId}' was not found`);
    }
    return row;
  }
  requireCoordinationSessionRow(sessionId) {
    const row = this.db.query(`SELECT * FROM coordination_sessions WHERE id = ?`).get(sessionId);
    if (!row)
      throw new CollabError("session_not_found", `Session '${sessionId}' was not found`);
    return row;
  }
  readTaskRow(workspaceId, taskId) {
    return this.db.query(`SELECT * FROM tasks WHERE workspace_id = ? AND id = ?`).get(workspaceId, taskId);
  }
  requireTaskRow(workspaceId, taskId) {
    const row = this.readTaskRow(workspaceId, taskId);
    if (!row)
      throw new CollabError("task_not_found", `Task '${taskId}' was not found`, { task_id: taskId });
    return row;
  }
  requireTask(workspaceId, taskId) {
    return this.taskFromRow(this.requireTaskRow(workspaceId, taskId));
  }
  listArtifacts(workspaceId, taskId) {
    const rows = this.db.query(`
      SELECT id, task_id, kind, uri, sha256, media_type, label, attached_by, attached_at
        , attached_by_session_id
      FROM artifacts WHERE workspace_id = ? AND task_id = ? ORDER BY attached_at, id
    `).all(workspaceId, taskId);
    return rows.map(artifactFromRow);
  }
  requireArtifact(id) {
    const row = this.db.query(`
      SELECT id, task_id, kind, uri, sha256, media_type, label, attached_by, attached_at
        , attached_by_session_id
      FROM artifacts WHERE id = ?
    `).get(id);
    if (!row)
      throw new CollabError("artifact_not_found", `Artifact '${id}' was not found`);
    return artifactFromRow(row);
  }
  requireDecision(id) {
    const row = this.db.query(`
      SELECT id, workspace_id, topic, decision, rationale, recorded_by, recorded_at
      FROM decisions WHERE id = ?
    `).get(id);
    if (!row)
      throw new CollabError("decision_not_found", `Decision '${id}' was not found`);
    return decisionFromRow(row);
  }
  requireHandoff(id) {
    const row = this.db.query(`SELECT * FROM handoffs WHERE id = ?`).get(id);
    if (!row)
      throw new CollabError("handoff_not_found", `Handoff '${id}' was not found`);
    return handoffFromRow(row);
  }
  timestamp() {
    return this.now().toISOString();
  }
}
function normalizeMutation(input) {
  return { ...input, actor: validateActor(input.actor), idempotency_key: validateIdempotencyKey(input.idempotency_key) };
}
function normalizeVersionedMutation(input) {
  validateExpectedVersion(input.expected_version);
  return normalizeMutation(input);
}
function normalizeLeaseInput(input) {
  return {
    ...normalizeVersionedMutation(input),
    task_id: validateId(input.task_id, "task_id"),
    lease_id: validateId(input.lease_id, "lease_id")
  };
}
function validateActor(value) {
  return cleanText(value, "actor", 200);
}
function validateExpectedVersion(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new CollabError("invalid_expected_version", "expected_version must be a positive integer");
  }
  return value;
}
function validateRuntimeKind(value) {
  const runtime = cleanText(value, "runtime_kind", 64).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._:-]*$/.test(runtime)) {
    throw new CollabError("invalid_runtime_kind", "runtime_kind contains unsupported characters");
  }
  return runtime;
}
function normalizeSessionCapabilities(values) {
  if (!Array.isArray(values) || values.length > MAX_SESSION_CAPABILITIES) {
    throw new CollabError("invalid_declared_capabilities", `A session may declare at most ${MAX_SESSION_CAPABILITIES} capabilities`);
  }
  const normalized = values.map((value) => {
    const capability = cleanText(value, "declared_capability", MAX_SESSION_CAPABILITY_LENGTH).toLowerCase();
    if (!/^[a-z0-9][a-z0-9._:-]*$/.test(capability)) {
      throw new CollabError("invalid_declared_capability", "Declared capabilities must be symbolic names, not free-form content");
    }
    return capability;
  });
  return uniqueSorted(normalized);
}
function validatePresenceTtl(value) {
  const ttl = value ?? DEFAULT_PRESENCE_SECONDS;
  if (!Number.isInteger(ttl) || ttl < 30 || ttl > MAX_PRESENCE_SECONDS) {
    throw new CollabError("invalid_presence_ttl", `ttl_seconds must be an integer between 30 and ${MAX_PRESENCE_SECONDS}`);
  }
  return ttl;
}
function validateSessionListLimit(value) {
  const limit = value ?? DEFAULT_SESSION_LIST_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SESSION_LIST_LIMIT) {
    throw new CollabError("invalid_session_list_limit", `limit must be an integer between 1 and ${MAX_SESSION_LIST_LIMIT}`);
  }
  return limit;
}
function validateNextEventLimit(value) {
  const limit = value ?? DEFAULT_NEXT_EVENT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_NEXT_EVENT_LIMIT) {
    throw new CollabError("invalid_event_limit", `event_limit must be an integer between 1 and ${MAX_NEXT_EVENT_LIMIT}`);
  }
  return limit;
}
var BOUND_AFTER_SEQUENCE_REMEDY = "A bound collab_next always pages from the acknowledged session cursor. Advance it with " + "collab_cursor_ack (next_anchor of the page you processed), or read from any position " + "without acknowledging with collab_events_since (after_sequence or after_anchor).";
function requireBoundAfterSequence(afterSequence, session) {
  if (!Number.isInteger(afterSequence) || afterSequence < 0) {
    throw new CollabError("invalid_cursor", "Event cursor must be a non-negative integer");
  }
  if (afterSequence === session.cursor_sequence)
    return;
  throw new CollabError("after_sequence_unsupported_in_bound_session", `after_sequence ${afterSequence} differs from this session's acknowledged cursor ` + `(sequence ${session.cursor_sequence}). ${BOUND_AFTER_SEQUENCE_REMEDY}`, {
    after_sequence: afterSequence,
    cursor: {
      epoch_id: session.cursor_epoch_id,
      sequence: session.cursor_sequence,
      hash: session.cursor_hash
    },
    cursor_version: session.cursor_version,
    remedy: BOUND_AFTER_SEQUENCE_REMEDY
  });
}
function normalizeSessionRenewInput(input) {
  if (input.expected_version !== undefined)
    validateExpectedVersion(input.expected_version);
  const request = {
    task_id: validateId(input.task_id, "task_id"),
    lease_id: validateId(input.lease_id, "lease_id"),
    ...input.expected_version === undefined ? {} : { expected_version: input.expected_version }
  };
  return { ...request, request, idempotency_key: validateIdempotencyKey(input.idempotency_key) };
}
function normalizeSessionLeaseInput(input) {
  const normalized = {
    idempotency_key: validateIdempotencyKey(input.idempotency_key),
    task_id: validateId(input.task_id, "task_id"),
    lease_id: validateId(input.lease_id, "lease_id"),
    expected_version: validateExpectedVersion(input.expected_version)
  };
  return {
    ...normalized,
    request: {
      task_id: normalized.task_id,
      lease_id: normalized.lease_id,
      expected_version: normalized.expected_version
    }
  };
}
function validateIdempotencyKey(value) {
  const key = cleanText(value, "idempotency_key", 200);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(key)) {
    throw new CollabError("invalid_idempotency_key", "Idempotency key contains unsupported characters");
  }
  return key;
}
function validateId(value, field) {
  const id = cleanText(value, field, 200);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) {
    throw new CollabError(`invalid_${field}`, `${field} contains unsupported characters`);
  }
  return id;
}
function cleanText(value, field, max) {
  const text = value.trim();
  if (!text)
    throw new CollabError(`invalid_${field}`, `${field} must not be empty`);
  if (text.length > max)
    throw new CollabError(`invalid_${field}`, `${field} exceeds ${max} characters`);
  if (text.includes("\x00"))
    throw new CollabError(`invalid_${field}`, `${field} must not contain NUL bytes`);
  return text;
}
function optionalText(value, field, max) {
  if (value === undefined || value.trim() === "")
    return null;
  return cleanText(value, field, max);
}
function validateTtl(value) {
  const ttl = value ?? DEFAULT_LEASE_SECONDS;
  if (!Number.isInteger(ttl) || ttl < 30 || ttl > MAX_LEASE_SECONDS) {
    throw new CollabError("invalid_ttl", `ttl_seconds must be an integer between 30 and ${MAX_LEASE_SECONDS}`);
  }
  return ttl;
}
function validateSha256(value) {
  const digest = value.toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest))
    throw new CollabError("invalid_sha256", "sha256 must be 64 hexadecimal characters");
  return digest;
}
function validateGitObjectId(value) {
  const oid = value.toLowerCase();
  if (!/^[a-f0-9]{40,64}$/.test(oid)) {
    throw new CollabError("invalid_git_object_id", "Git object IDs must contain 40 to 64 hexadecimal characters");
  }
  return oid;
}
function validateArtifactKind(value) {
  if (!["file", "commit", "test", "data", "url", "other"].includes(value)) {
    throw new CollabError("invalid_artifact_kind", "Unsupported artifact kind");
  }
  return value;
}
function validateReportKind(value) {
  if (!["observation", "inference", "proposal", "decision"].includes(value)) {
    throw new CollabError("invalid_report_kind", "Unsupported report kind");
  }
  return value;
}
function validateReportConfidence(value) {
  if (!["high", "medium", "low", "unknown"].includes(value)) {
    throw new CollabError("invalid_report_confidence", "Unsupported report confidence");
  }
  return value;
}
function validateReportRelation(value) {
  if (![
    "informs",
    "supports",
    "challenges",
    "corrects",
    "withdraws",
    "supersedes",
    "resolves"
  ].includes(value)) {
    throw new CollabError("invalid_report_relation", "Unsupported report relation");
  }
  return value;
}
function normalizeEvidenceRefs(references) {
  if (!Array.isArray(references) || references.length > MAX_REPORT_REFS) {
    throw new CollabError("invalid_evidence_refs", `A report may contain at most ${MAX_REPORT_REFS} evidence references`);
  }
  return uniqueSorted(references.map((reference) => {
    if (typeof reference !== "string") {
      throw invalidEvidenceRef("Evidence references must be strings");
    }
    try {
      return cleanText(reference, "evidence_ref", MAX_REPORT_REF_LENGTH);
    } catch (error) {
      if (error instanceof CollabError)
        throw invalidEvidenceRef(error.message);
      throw error;
    }
  }));
}
function invalidEvidenceRef(reason) {
  return new CollabError("invalid_evidence_ref", `${reason}. ${EVIDENCE_REFS_DESCRIPTION}`, { allowed_prefixes: [...EVIDENCE_REF_PREFIXES] });
}
function normalizePathScopes(scopes) {
  if (!Array.isArray(scopes) || scopes.length > MAX_PATH_SCOPES) {
    throw new CollabError("invalid_path_scopes", `A task may have at most ${MAX_PATH_SCOPES} path scopes`);
  }
  let totalLength = 0;
  const normalized = scopes.map((scope) => {
    if (typeof scope !== "string" || !scope || scope.length > MAX_PATH_SCOPE_LENGTH || scope.includes("\x00") || scope.includes("\\") || isAbsolute2(scope)) {
      throw new CollabError("invalid_path_scope", "Path scopes must be non-empty repository-relative POSIX paths", { scope });
    }
    totalLength += scope.length;
    if (totalLength > MAX_PATH_SCOPES_TOTAL) {
      throw new CollabError("invalid_path_scopes", `Combined path scopes may not exceed ${MAX_PATH_SCOPES_TOTAL} characters`);
    }
    const clean = posix.normalize(scope.replace(/^\.\//, "")).replace(/\/$/, "");
    if (!clean || clean === "." || clean === ".." || clean.startsWith("../")) {
      throw new CollabError("invalid_path_scope", "Root-wide and parent path scopes are not allowed", { scope });
    }
    return clean;
  });
  return uniqueSorted(normalized);
}
function normalizeDependencies(dependencies) {
  if (!Array.isArray(dependencies) || dependencies.length > MAX_DEPENDENCIES) {
    throw new CollabError("invalid_dependencies", `A task may have at most ${MAX_DEPENDENCIES} dependencies`);
  }
  return uniqueSorted(dependencies.map((id) => validateId(id, "dependency")));
}
function pathConflicts(left, right) {
  const conflicts = [];
  for (const a of left) {
    for (const b of right) {
      const leftKey = a.normalize("NFC").toLowerCase();
      const rightKey = b.normalize("NFC").toLowerCase();
      if (leftKey === rightKey || leftKey.startsWith(`${rightKey}/`) || rightKey.startsWith(`${leftKey}/`))
        conflicts.push([a, b]);
    }
  }
  return conflicts;
}
function uniqueSorted(values) {
  return [...new Set(values)].sort();
}
function parseStringArray(json) {
  return JSON.parse(json);
}
function artifactFromRow(row) {
  return { ...row };
}
function decisionFromRow(row) {
  return { ...row };
}
function handoffFromRow(row) {
  return { ...row };
}
function eventFromRow(row) {
  const base = {
    protocol: row.protocol,
    workspace_id: row.workspace_id,
    epoch_id: row.epoch_id,
    sequence: row.sequence,
    id: row.id,
    type: row.type,
    entity_id: row.entity_id,
    actor: row.actor,
    occurred_at: row.occurred_at,
    payload: JSON.parse(row.payload_json),
    prev_hash: row.prev_hash,
    hash: row.hash
  };
  return row.protocol === LEGACY_COLLAB_PROTOCOL ? base : { ...base, session_id: row.session_id };
}
function eventHash(event) {
  if (event.protocol === LEGACY_COLLAB_PROTOCOL) {
    const { hash: _hash2, session_id: _sessionId, ...body2 } = event;
    return sha2563(canonicalJson(body2));
  }
  const { hash: _hash, ...body } = event;
  return sha2563(canonicalJson(body));
}
function verifyEventPage(events, afterSequence, predecessorHash, headSequence, headHash) {
  if (predecessorHash === null)
    return false;
  if (events.length === 0) {
    return afterSequence === headSequence && predecessorHash === headHash;
  }
  let expectedSequence = afterSequence + 1;
  let previous = predecessorHash;
  for (const event of events) {
    if (event.sequence !== expectedSequence || event.prev_hash !== previous)
      return false;
    if (event.hash !== eventHash(event))
      return false;
    previous = event.hash;
    expectedSequence += 1;
  }
  const lastSequence = events.at(-1)?.sequence ?? afterSequence;
  return lastSequence !== headSequence || previous === headHash;
}
function presenceSessionFromRow(row, observedAt) {
  const presence = row.left_at ? "left" : observedAt < row.presence_expires_at ? "live" : "stale";
  return {
    protocol: COLLAB_SESSION_PROTOCOL,
    id: row.id,
    workspace_id: row.workspace_id,
    epoch_id: row.epoch_id,
    client_instance_id: row.client_instance_id,
    actor_label: row.actor_label,
    actor_key: row.actor_key,
    runtime_kind: row.runtime_kind,
    provider_label: row.provider_label,
    model_label: row.model_label,
    declared_capabilities: parseStringArray(row.declared_capabilities_json),
    capability_basis: "self_declared",
    version: row.version,
    joined_at: row.joined_at,
    last_seen_at: row.last_seen_at,
    presence_expires_at: row.presence_expires_at,
    presence,
    left_at: row.left_at
  };
}
function requirePresenceSessionVersion(row, expectedVersion) {
  if (row.version !== expectedVersion) {
    throw new CollabError("session_version_conflict", "Presence session version changed", {
      session_id: row.id,
      expected_version: expectedVersion,
      actual_version: row.version
    });
  }
}
function requireMatchingPresenceSessionJoin(row, input) {
  const same = row.actor_label === input.actor_label && row.runtime_kind === input.runtime_kind && row.provider_label === input.provider_label && row.model_label === input.model_label && canonicalJson(parseStringArray(row.declared_capabilities_json)) === canonicalJson(input.declared_capabilities);
  if (!same) {
    throw new CollabError("session_instance_conflict", "client_instance_id was already joined with different self-declared metadata", { session_id: row.id });
  }
}
function sessionLiveness(row, observedAt) {
  if (row.status !== "active")
    return "stale";
  const age = Date.parse(observedAt) - Date.parse(row.last_seen_at);
  return age <= SESSION_STALE_AFTER_MS ? "live" : "stale";
}
function recoveryRequiredFirst(tasks, isOwn) {
  const byExpiry = (left, right) => (left.lease_expires_at ?? "").localeCompare(right.lease_expires_at ?? "") || left.id.localeCompare(right.id);
  const pending = tasks.filter((task) => task.effective_status === "recovery_required");
  return [
    ...pending.filter(isOwn).sort(byExpiry),
    ...pending.filter((task) => !isOwn(task)).sort(byExpiry)
  ];
}
function coordinationSessionFromRow(row, observedAt) {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    worktree_id: row.worktree_id,
    actor: row.actor,
    role: row.role,
    parent_session_id: row.parent_session_id,
    status: row.status,
    generation: row.generation,
    joined_at: row.joined_at,
    last_seen_at: row.last_seen_at,
    ended_at: row.ended_at,
    cursor: {
      epoch_id: row.cursor_epoch_id,
      sequence: row.cursor_sequence,
      hash: row.cursor_hash
    },
    cursor_version: row.cursor_version,
    reset_generation: row.reset_generation,
    cursor_recovery_required: row.cursor_recovery_required !== 0,
    liveness: sessionLiveness(row, observedAt)
  };
}
function worktreeFromRow(row) {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    root_path: row.root_path,
    repository_key: row.repository_key,
    git_common_dir_hash: row.git_common_dir_hash,
    branch: row.branch,
    head_sha: row.head_sha,
    dirty: sqlToBoolean(row.dirty),
    registered_at: row.registered_at,
    last_seen_at: row.last_seen_at
  };
}
function checkpointFromWorktreeRow(row, capturedAt) {
  return {
    worktree_id: row.id,
    head_sha: row.head_sha,
    branch: row.branch,
    dirty: sqlToBoolean(row.dirty),
    captured_at: capturedAt
  };
}
function reportFromRow(row) {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    task_id: row.task_id,
    from_session_id: row.from_session_id,
    from_actor: row.from_actor,
    to_session_id: row.to_session_id,
    kind: row.kind,
    body: row.body,
    evidence_refs: parseStringArray(row.evidence_refs_json),
    confidence: row.confidence,
    confidence_basis: row.confidence_basis,
    limits: row.limits,
    relation: row.relation,
    target_report_id: row.target_report_id,
    authority_scope: row.authority_scope,
    authority_basis: row.authority_basis,
    created_at: row.created_at,
    event_sequence: row.event_sequence
  };
}
function reviewFromRow(row) {
  return { ...row };
}
function proposalTermsFromRow(row) {
  if (row.rule !== CONSENT_RULE) {
    throw new CollabError("proposal_rule_unsupported", "This proposal was opened under a consent rule this package does not implement", { proposal_report_id: row.report_id, rule: row.rule });
  }
  return {
    report_id: row.report_id,
    workspace_id: row.workspace_id,
    rule: CONSENT_RULE,
    criteria: row.criteria,
    extent: row.extent,
    known_conflicts: row.known_conflicts,
    origin: row.origin,
    topic: row.topic,
    closes_at: row.closes_at,
    voices: JSON.parse(row.voices_json),
    author_voice_id: row.author_voice_id,
    proposal_sha256: row.proposal_sha256,
    opened_event_id: row.opened_event_id,
    created_at: row.created_at
  };
}
function proposalPersonActFromRow(row) {
  const { ai_snapshot_json, proof_json, ...rest } = row;
  return {
    ...rest,
    ai_snapshot: JSON.parse(ai_snapshot_json),
    proof: proof_json ? JSON.parse(proof_json) : null
  };
}
var PERSON_DESK_ACTOR = "person:desk";
var PERSON_TERMINAL_ACTOR = "person:terminal";
var PERSON_PASSKEY_ACTOR = "person:passkey";
var PERSON_VOICE_ID = "person";
var PERSON_DESK_LIMITS = "Written at the person desk, which does not authenticate the person.";
function validatePersonAct(value) {
  if (value !== "agree" && value !== "reject") {
    throw new CollabError("invalid_act", "act must be agree or reject");
  }
  return value;
}
function normalizeProposalTerms(input) {
  return {
    question: cleanText(input.question, "question", MAX_REPORT_BODY),
    criteria: cleanText(input.criteria, "criteria", 4000),
    extent: cleanText(input.extent, "extent", 1000),
    known_conflicts: optionalText(input.known_conflicts, "known_conflicts", 4000),
    evidence_refs: normalizeEvidenceRefs(input.evidence_refs ?? []),
    topic: optionalText(input.topic, "topic", 200),
    consult_seconds: validateConsultSeconds(input.consult_seconds)
  };
}
function validateProposalOrigin(value) {
  if (value !== "ai" && value !== "person_relayed") {
    throw new CollabError("invalid_origin", "origin must be ai or person_relayed");
  }
  return value;
}
function validateConsultSeconds(value) {
  const seconds = value ?? DEFAULT_PROPOSAL_CONSULT_SECONDS;
  if (!Number.isInteger(seconds) || seconds < MIN_PROPOSAL_CONSULT_SECONDS || seconds > MAX_PROPOSAL_CONSULT_SECONDS) {
    throw new CollabError("invalid_consult_seconds", `consult_seconds must be an integer between ${MIN_PROPOSAL_CONSULT_SECONDS} and ${MAX_PROPOSAL_CONSULT_SECONDS}`);
  }
  return seconds;
}
function parseCheckpoint(json) {
  return json ? JSON.parse(json) : null;
}
function checkpointDigest(checkpoint) {
  return sha2563(canonicalJson(checkpoint));
}
function checkpointStateMatches(left, right) {
  return left.worktree_id === right.worktree_id && left.head_sha === right.head_sha && left.branch === right.branch && left.algorithm === right.algorithm && left.index_sha256 === right.index_sha256 && left.state_sha256 === right.state_sha256 && left.dirty === right.dirty;
}
function requireCompleteGitCheckpoint(checkpoint) {
  if (checkpoint.source !== "server_observed" || checkpoint.algorithm !== "git-state/v1" || checkpoint.head_sha === null || checkpoint.dirty === null || typeof checkpoint.index_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(checkpoint.index_sha256) || typeof checkpoint.state_sha256 !== "string" || !/^[a-f0-9]{64}$/.test(checkpoint.state_sha256)) {
    throw new CollabError("git_checkpoint_incomplete", "Acceptance requires a complete server-observed Git checkpoint", { worktree_id: checkpoint.worktree_id });
  }
}
function artifactRepositoryPath(uri, rootPath) {
  let value = uri;
  if (value.startsWith("file:")) {
    try {
      const url = new URL(value);
      if (url.protocol !== "file:" || url.hostname !== "" && url.hostname !== "localhost") {
        return null;
      }
      value = decodeURIComponent(url.pathname);
    } catch {
      return null;
    }
  }
  if (!value || value.includes("\x00") || value.includes("\\"))
    return null;
  let relative;
  if (isAbsolute2(value)) {
    const absolute = posix.normalize(value);
    if (!absolute.startsWith(`${rootPath}/`))
      return null;
    relative = absolute.slice(rootPath.length + 1);
  } else {
    relative = posix.normalize(value);
  }
  if (!relative || relative === "." || relative === ".." || relative.startsWith("../") || relative.endsWith("/") || relative === ".git" || relative.startsWith(".git/"))
    return null;
  return relative;
}
function pathWithinScopes(path, scopes) {
  return scopes.some((scope) => path === scope || path.startsWith(`${scope}/`));
}
function gitCheckpointStaleError(taskId, result, observed, refusal) {
  const branch = result.branch ? `"${result.branch}"` : "(none: its HEAD was detached)";
  const remedy = `Two ways forward. (1) Host commit: exactly one commit on branch ${branch} whose only parent ` + `is the result checkpoint HEAD ${result.head_sha}, changing only paths inside the task's ` + "path_scopes, each byte-equal to the newest file artifact this task attached for that uri " + "(since its latest request_changes), with the worktree left clean; then review again. " + `(2) Re-completion: review task "${taskId}" with outcome "request_changes"; once it is ` + "claimed again, collab_task_complete captures a fresh result checkpoint for a new review. " + "Never amend, reset or rewrite a shared branch to meet (1): if other commits already sit " + "on it, use (2).";
  return new CollabError("git_checkpoint_stale", `The completion worktree changed after its result checkpoint was captured: ${refusal}. ${remedy}`, {
    result_checkpoint: result,
    observed_checkpoint: observed,
    boundary: "checkpoint_validation_is_a_local_observation_not_an_atomic_git_sqlite_lock",
    host_commit_refusal: refusal,
    remedy
  });
}
function hydrateLegacyMutationResponse(value, now) {
  if (Array.isArray(value)) {
    return value.map((item) => hydrateLegacyMutationResponse(item, now));
  }
  if (!isRecordValue(value))
    return value;
  const hydratedEntries = Object.entries(value).map(([key, item]) => [
    key,
    hydrateLegacyMutationResponse(item, now)
  ]);
  const hydrated = Object.fromEntries(hydratedEntries);
  if (typeof hydrated.id !== "string" || typeof hydrated.workspace_id !== "string" || !["open", "claimed", "blocked", "completed"].includes(typeof hydrated.status === "string" ? hydrated.status : "") || !Array.isArray(hydrated.dependencies) || !Array.isArray(hydrated.path_scopes) || !Number.isInteger(hydrated.version)) {
    return hydrated;
  }
  const expired = hydrated.status === "claimed" && typeof hydrated.lease_expires_at === "string" && now >= hydrated.lease_expires_at;
  return {
    ...hydrated,
    effective_status: typeof hydrated.effective_status === "string" ? hydrated.effective_status : expired ? "lease_expired" : hydrated.status,
    work_mode: typeof hydrated.work_mode === "string" ? hydrated.work_mode : "coordination",
    completion_policy: typeof hydrated.completion_policy === "string" ? hydrated.completion_policy : "reported",
    review_status: typeof hydrated.review_status === "string" ? hydrated.review_status : "legacy_unreviewed",
    expected_base_sha: hydrated.expected_base_sha ?? null,
    base_checkpoint: hydrated.base_checkpoint ?? null,
    base_checkpoint_digest: hydratedCheckpointDigest(hydrated.base_checkpoint_digest, hydrated.base_checkpoint),
    result_checkpoint: hydrated.result_checkpoint ?? null,
    result_checkpoint_digest: hydratedCheckpointDigest(hydrated.result_checkpoint_digest, hydrated.result_checkpoint),
    completion_report_id: hydrated.completion_report_id ?? null,
    assignee_session_id: hydrated.assignee_session_id ?? null,
    assignee_liveness: hydrated.assignee_liveness ?? null,
    claim_worktree_id: hydrated.claim_worktree_id ?? null,
    reported_by: hydrated.reported_by ?? null,
    reported_by_session_id: hydrated.reported_by_session_id ?? null,
    reported_at: hydrated.reported_at ?? null,
    accepted_by: hydrated.accepted_by ?? null,
    accepted_by_session_id: hydrated.accepted_by_session_id ?? null,
    accepted_at: hydrated.accepted_at ?? null,
    review_requested_session_id: hydrated.review_requested_session_id ?? null
  };
}
function hydratedCheckpointDigest(stored, checkpoint) {
  if (typeof stored === "string")
    return stored;
  return isRecordValue(checkpoint) ? checkpointDigest(checkpoint) : null;
}
function isRecordValue(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function booleanToSql(value) {
  return value === null ? null : value ? 1 : 0;
}
function sqlToBoolean(value) {
  return value === null ? null : value !== 0;
}
function hashSessionToken(token) {
  return sha2563(`agenttool.collab/session-token/v1\x00${token}`);
}
function safeDigestEqual(left, right) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
function pragmaNumber(db, name) {
  const row = db.query(`PRAGMA ${name}`).get();
  const value = row?.[name];
  if (!Number.isInteger(value)) {
    throw new CollabError("database_pragma_unavailable", `Could not read PRAGMA ${name}`);
  }
  return value;
}
function retrySqliteBusy(operation) {
  const deadline = Date.now() + SQLITE_BUSY_RETRY_MS;
  let delay = 10;
  while (true) {
    try {
      operation();
      return;
    } catch (error) {
      const code = error.code;
      const busy = code === "SQLITE_BUSY" || error instanceof Error && /database is (?:locked|busy)/i.test(error.message);
      if (!busy || Date.now() >= deadline)
        throw error;
      const remaining = deadline - Date.now();
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(delay, remaining));
      delay = Math.min(delay * 2, 100);
    }
  }
}
function assertSafeDatabaseFile(path) {
  const stat = lstatSync3(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    throw new CollabError("database_file_unsafe", "The collaboration database path must be a non-linked regular file owned by this user", { path });
  }
}
function quoteIdentifier(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new CollabError("invalid_sql_identifier", "Invalid internal SQL identifier");
  }
  return `"${value}"`;
}
function assertDistinctLegacyWorktreeIdentities(workspaces) {
  const selectors = [
    {
      field: "worktrees.root_path",
      value: (workspace) => workspace.identity.root_path
    },
    {
      field: "worktrees.id",
      value: (workspace) => workspace.identity.checkpoint.worktree_id
    },
    {
      field: "worktrees.fingerprint",
      value: (workspace) => workspace.identity.worktree_fingerprint
    }
  ];
  const collisions = [];
  for (const selector of selectors) {
    const groups = new Map;
    for (const workspace of workspaces) {
      const value = selector.value(workspace);
      const workspaceIds2 = groups.get(value) ?? [];
      workspaceIds2.push(workspace.id);
      groups.set(value, workspaceIds2);
    }
    for (const workspaceIds2 of groups.values()) {
      if (workspaceIds2.length < 2)
        continue;
      collisions.push({
        field: selector.field,
        workspace_ids: workspaceIds2.sort()
      });
    }
  }
  if (collisions.length === 0)
    return;
  collisions.sort((left, right) => {
    const fieldOrder = left.field < right.field ? -1 : left.field > right.field ? 1 : 0;
    if (fieldOrder !== 0)
      return fieldOrder;
    const leftIds = left.workspace_ids.join("\x00");
    const rightIds = right.workspace_ids.join("\x00");
    return leftIds < rightIds ? -1 : leftIds > rightIds ? 1 : 0;
  });
  const workspaceIds = [
    ...new Set(collisions.flatMap((collision) => collision.workspace_ids))
  ].sort();
  throw new CollabError("migration_identity_collision", "Legacy workspaces resolve to the same worktree identity; migration will not merge distinct journals", {
    workspace_ids: workspaceIds,
    collisions,
    boundary: "v0_3_will_not_merge_distinct_legacy_journals_that_resolve_to_one_worktree",
    required_action: "keep_the_original_audit_database_and_use_a_compatible_v0_2_client_or_choose_a_fresh_v0_3_database"
  });
}
function safeRepositoryIdentity(rootPath) {
  try {
    return inspectRepository(rootPath);
  } catch {
    const root = resolve4(rootPath);
    const repositoryKey = `local-path:${sha2563(root)}`;
    const worktreeId2 = `wt_${sha2563(`${root}\x00path:${root}`).slice(0, 24)}`;
    return {
      requested_root_path: root,
      root_path: root,
      repository_key: repositoryKey,
      git_common_dir_hash: null,
      worktree_fingerprint: `path:${sha2563(root)}`,
      checkpoint: {
        worktree_id: worktreeId2,
        head_sha: null,
        branch: null,
        dirty: null,
        captured_at: new Date().toISOString()
      }
    };
  }
}
function sha2563(value) {
  return createHash3("sha256").update(value).digest("hex");
}
function addSeconds(iso, seconds) {
  return new Date(new Date(iso).getTime() + seconds * 1000).toISOString();
}

// src/person-desk.ts
import { createHash as createHash4 } from "crypto";
import { existsSync as existsSync4, readFileSync as readFileSync2 } from "fs";
import { parseArgs } from "util";

// src/tty.ts
import { closeSync as closeSync4, openSync as openSync4, readSync as readSync2, writeSync } from "fs";
import { isatty } from "tty";
var DEV_TTY = "/dev/tty";
var CONFIRM_WORD = "yes";
var DEFAULT_WINDOW_MS = 5 * 60 * 1000;
var MAX_ANSWER_BYTES = 256;
var TERMINAL_UNSAFE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;
function terminalRendering(text) {
  return text.replace(TERMINAL_UNSAFE, (char) => `\\u{${char.codePointAt(0).toString(16).toUpperCase()}}`);
}
function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function openDevTty(path = DEV_TTY) {
  let fd;
  try {
    fd = openSync4(path, "r+");
  } catch {
    return null;
  }
  let terminal = false;
  try {
    terminal = isatty(fd);
  } catch {
    terminal = false;
  }
  if (!terminal) {
    closeSync4(fd);
    return null;
  }
  return {
    write(text) {
      const bytes = Buffer.from(text, "utf8");
      let offset = 0;
      while (offset < bytes.length) {
        offset += writeSync(fd, bytes, offset, bytes.length - offset);
      }
    },
    readLine(maxBytes) {
      const one = Buffer.alloc(1);
      const collected = [];
      while (collected.length < maxBytes) {
        let read;
        try {
          read = readSync2(fd, one, 0, 1, null);
        } catch (error) {
          if (error.code !== "EAGAIN")
            throw error;
          pause(50);
          continue;
        }
        if (read === 0)
          return collected.length === 0 ? null : Buffer.from(collected).toString("utf8");
        if (one[0] === 10 || one[0] === 13)
          break;
        collected.push(one[0]);
      }
      return Buffer.from(collected).toString("utf8");
    },
    close() {
      closeSync4(fd);
    }
  };
}
function confirmOnTty(request, options = {}) {
  const open = options.openTty ?? (() => openDevTty());
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const port = open();
  if (port === null) {
    throw new CollabError("tty_unavailable", "This act needs a person at the controlling terminal (/dev/tty); none is available, so nothing was written");
  }
  try {
    const byteLength = Buffer.byteLength(request.bytes, "utf8");
    const rendered = terminalRendering(request.bytes);
    port.write([
      "",
      `agenttool-collab-host: person act ${terminalRendering(request.act)}`,
      ...request.summary.map((line) => `  ${terminalRendering(line)}`),
      `exact bytes (${byteLength} bytes, sha256 ${request.sha256})` + (rendered === request.bytes ? ":" : ", hidden characters shown as \\u{...}:"),
      rendered,
      `Type ${CONFIRM_WORD} to record exactly these bytes; anything else cancels: `
    ].join(`
`));
    const started = now();
    const answer = port.readLine(MAX_ANSWER_BYTES);
    if (now() - started > windowMs) {
      port.write(`confirmation window passed; nothing was written
`);
      return false;
    }
    const confirmed = answer !== null && answer.trim() === CONFIRM_WORD;
    port.write(confirmed ? `confirmed
` : `cancelled; nothing was written
`);
    return confirmed;
  } finally {
    port.close();
  }
}

// src/person-desk.ts
var PERSON_DESK_PROTOCOL = "agenttool.collab-host/1";
var EXIT_NOT_CONFIRMED = 3;
var MAX_JSON_INPUT_BYTES = 64 * 1024;
var PERSON_DESK_USAGE = "usage: agenttool-collab-host person <verb> [--db <path>], where <verb> is one of: " + "workspaces | proposals --workspace <id> [--proposal <id>] [--limit <n>] | inbox --workspace <id>" + " | challenge --proposal <id> --act agree|reject [--reason <text>]" + " | consent --proposal <id> [--passkey-assertion <path>|-]" + " | reject --proposal <id> --reason <text> [--passkey-assertion <path>|-]" + " | say --workspace <id> --body <text> [--proposal <id>] --idempotency-key <key>" + " | propose --workspace <id> --question <text> --criteria <text> --extent <text>" + " [--known-conflicts <text>] [--topic <text>] [--consult-seconds <n>] --idempotency-key <key>" + " | passkey-enroll --file <path>|- | passkeys | passkey-revoke --credential <id>";
var VERB_OPTIONS = {
  workspaces: { required: [], optional: [] },
  proposals: { required: ["workspace"], optional: ["proposal", "limit"] },
  inbox: { required: ["workspace"], optional: [] },
  challenge: { required: ["proposal", "act"], optional: ["reason"] },
  consent: { required: ["proposal"], optional: ["passkey-assertion"] },
  reject: { required: ["proposal", "reason"], optional: ["passkey-assertion"] },
  say: { required: ["workspace", "body", "idempotency-key"], optional: ["proposal"] },
  propose: {
    required: ["workspace", "question", "criteria", "extent", "idempotency-key"],
    optional: ["known-conflicts", "topic", "consult-seconds"]
  },
  "passkey-enroll": { required: ["file"], optional: [] },
  passkeys: { required: [], optional: [] },
  "passkey-revoke": { required: ["credential"], optional: [] }
};
var STRING_OPTIONS = [
  "workspace",
  "proposal",
  "limit",
  "act",
  "reason",
  "passkey-assertion",
  "body",
  "idempotency-key",
  "question",
  "criteria",
  "extent",
  "known-conflicts",
  "topic",
  "consult-seconds",
  "file",
  "credential",
  "db"
];
function runPersonDeskCli(argv, env = process.env, deps = {}) {
  let verb = "person";
  const emit = (payload, exitCode) => ({
    exit_code: exitCode,
    line: JSON.stringify({ protocol: PERSON_DESK_PROTOCOL, command: verb, ...payload })
  });
  if (argv.some((arg) => arg === "--help" || arg === "-h")) {
    return emit({ status: "help", usage: PERSON_DESK_USAGE }, 0);
  }
  try {
    const { command, values } = parsePersonArgs(argv);
    verb = `person ${command}`;
    const databasePath = values.db ?? resolveDatabasePath(env);
    if (!existsSync4(databasePath)) {
      throw new CollabError("journal_not_found", "No collaboration journal exists at the selected path; pass --db or set AGENTOOL_COLLAB_DB");
    }
    const store = new CollabStore(databasePath, deps.storeNow ? { now: deps.storeNow } : {});
    try {
      const outcome = runVerb(store, command, values, deps);
      return outcome.cancelled ? emit({ status: "cancelled", message: "Not confirmed at the terminal; nothing was written" }, EXIT_NOT_CONFIRMED) : emit({ status: "ok", ...outcome.result }, 0);
    } finally {
      store.close();
    }
  } catch (error) {
    return emit(errorPayload(error), 1);
  }
}
function runVerb(store, command, values, deps) {
  const done = (result) => ({ cancelled: false, result });
  switch (command) {
    case "workspaces":
      return done({ workspaces: store.listWorkspaces() });
    case "proposals":
      return values.proposal ? done({ proposal: store.proposalStatus(values.workspace, values.proposal) }) : done({ proposals: store.listProposalStatuses(values.workspace, { limit: parseInteger(values.limit, "limit") }) });
    case "inbox":
      return done({ inbox: store.personInbox(values.workspace) });
    case "challenge":
      return done({
        challenge: store.personActChallenge({
          proposal_report_id: values.proposal,
          act: values.act,
          reason: values.reason
        })
      });
    case "consent":
    case "reject": {
      const act = command === "consent" ? "agree" : "reject";
      if (values["passkey-assertion"] !== undefined) {
        const assertion = readJsonInput(values["passkey-assertion"], deps);
        return done({
          proposal: store.recordPersonActWithPasskey({
            proposal_report_id: values.proposal,
            act,
            reason: values.reason,
            assertion
          })
        });
      }
      const status = store.proposalStatusById(values.proposal);
      if (act === "agree" && status.ai.position !== "consented") {
        throw new CollabError("ai_not_consented", "The agents have not consented; a person agrees only after they settle", { position: status.ai.position });
      }
      const confirmed = confirmOnTty({
        act: act === "agree" ? "agree to a proposal" : "reject a proposal",
        summary: actSummary(status, act, values.reason),
        bytes: status.proposal_bytes,
        sha256: status.proposal_sha256
      }, { openTty: deps.openTty, now: deps.now });
      if (!confirmed)
        return { cancelled: true };
      return done({
        proposal: store.recordPersonActAtTerminal({
          proposal_report_id: status.proposal.id,
          proposal_sha256: status.proposal_sha256,
          act,
          reason: values.reason
        })
      });
    }
    case "say":
      return done({
        report: store.appendPersonNote({
          workspace_id: values.workspace,
          idempotency_key: values["idempotency-key"],
          body: values.body,
          proposal_report_id: values.proposal
        })
      });
    case "propose":
      return done({
        proposal: store.openPersonProposal({
          workspace_id: values.workspace,
          idempotency_key: values["idempotency-key"],
          question: values.question,
          criteria: values.criteria,
          extent: values.extent,
          known_conflicts: values["known-conflicts"],
          topic: values.topic,
          consult_seconds: parseInteger(values["consult-seconds"], "consult-seconds")
        })
      });
    case "passkey-enroll": {
      const input = readJsonInput(values.file, deps);
      const enrollment = {
        credential_id: requireString(input.credential_id, "credential_id"),
        public_key_spki: requireString(input.public_key_spki, "public_key_spki"),
        algorithm: input.algorithm,
        rp_id: requireString(input.rp_id, "rp_id"),
        origin: requireString(input.origin, "origin"),
        ...typeof input.label === "string" ? { label: input.label } : {}
      };
      parsePasskeyPublicKey(enrollment.public_key_spki);
      const bytes = canonicalJson(enrollment);
      const confirmed = confirmOnTty({
        act: "enrol a passkey",
        summary: [
          `key fingerprint (sha256): ${passkeyFingerprint(enrollment.public_key_spki)}`,
          `relying party ${enrollment.rp_id}, origin ${enrollment.origin}`,
          "Enrol only a passkey you just created yourself; it will sign agreements in your name."
        ],
        bytes,
        sha256: createHash4("sha256").update(bytes).digest("hex")
      }, { openTty: deps.openTty, now: deps.now });
      if (!confirmed)
        return { cancelled: true };
      return done({ passkey: store.enrollPersonPasskey(enrollment) });
    }
    case "passkeys":
      return done({ passkeys: store.listPersonPasskeys() });
    case "passkey-revoke": {
      const passkey = store.listPersonPasskeys().find((key) => key.credential_id === values.credential);
      if (!passkey || passkey.revoked_at !== null) {
        throw new CollabError("passkey_not_enrolled", "No active enrolled passkey has this credential id");
      }
      const bytes = canonicalJson({ revoke: passkey.credential_id, fingerprint: passkey.fingerprint });
      const confirmed = confirmOnTty({
        act: "revoke a passkey",
        summary: [`key fingerprint (sha256): ${passkey.fingerprint}`, `origin ${passkey.origin}`],
        bytes,
        sha256: createHash4("sha256").update(bytes).digest("hex")
      }, { openTty: deps.openTty, now: deps.now });
      if (!confirmed)
        return { cancelled: true };
      return done({ passkey: store.revokePersonPasskey(passkey.credential_id) });
    }
  }
}
function actSummary(status, act, reason) {
  return [
    `workspace ${status.proposal.workspace_id}, proposal ${status.proposal.id}`,
    `agents' position: ${status.ai.position} (${status.ai.qualifying_support_report_ids.length} qualifying supports, ` + `${status.ai.unresolved_challenge_report_ids.length} unresolved challenges)`,
    `extent: ${status.terms.extent}`,
    act === "agree" ? "Agreeing authorises only this extent." : `reason: ${reason ?? ""}`
  ];
}
function parsePersonArgs(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: Object.fromEntries(STRING_OPTIONS.map((name) => [name, { type: "string" }]))
    });
  } catch (error) {
    throw new CollabError("usage_error", `${error instanceof Error ? error.message : String(error)}; ${PERSON_DESK_USAGE}`);
  }
  const [command, ...extra] = parsed.positionals;
  if (!command || !(command in VERB_OPTIONS) || extra.length > 0) {
    throw new CollabError("usage_error", PERSON_DESK_USAGE);
  }
  const verb = command;
  const values = parsed.values;
  const { required, optional } = VERB_OPTIONS[verb];
  for (const name of Object.keys(values)) {
    if (name !== "db" && !required.includes(name) && !optional.includes(name)) {
      throw new CollabError("usage_error", `--${name} does not apply to person ${verb}; ${PERSON_DESK_USAGE}`);
    }
  }
  for (const name of required) {
    const value = values[name];
    if (value === undefined || value.trim() === "") {
      throw new CollabError("usage_error", `--${name} is required for person ${verb}; ${PERSON_DESK_USAGE}`);
    }
  }
  if (values.db !== undefined && values.db.trim() === "") {
    throw new CollabError("usage_error", `--db must not be empty; ${PERSON_DESK_USAGE}`);
  }
  return { command: verb, values };
}
function parseInteger(value, name) {
  if (value === undefined)
    return;
  if (!/^\d+$/.test(value.trim())) {
    throw new CollabError("usage_error", `--${name} must be a non-negative integer; ${PERSON_DESK_USAGE}`);
  }
  return Number(value.trim());
}
function readJsonInput(path, deps) {
  let text;
  try {
    text = path === "-" ? (deps.readStdin ?? (() => readFileSync2(0, "utf8")))() : readFileSync2(path, "utf8");
  } catch {
    throw new CollabError("input_unreadable", "The JSON input could not be read");
  }
  if (Buffer.byteLength(text, "utf8") > MAX_JSON_INPUT_BYTES) {
    throw new CollabError("input_too_large", `The JSON input exceeds ${MAX_JSON_INPUT_BYTES} bytes`);
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CollabError("input_invalid", "The input is not JSON");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CollabError("input_invalid", "The input must be a JSON object");
  }
  return value;
}
function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new CollabError("input_invalid", `${field} must be a non-empty string`);
  }
  return value;
}
function errorPayload(error) {
  if (error instanceof CollabError) {
    return { ...error.details, status: "error", error: error.code, message: error.message };
  }
  return { status: "error", error: "internal_error", message: error instanceof Error ? error.message : String(error) };
}

// src/host.ts
var COLLAB_HOST_PROTOCOL = "agenttool.collab-host/1";
var COLLAB_HOST_USAGE = "usage: agenttool-collab-host end --session-file <path> --reason <text> [--release-leases] [--db <path>]" + " | agenttool-collab-host wait (--session <id> | --session-file <path>) [--after-anchor <json>]" + " [--wait-ms <ms>] [--include-own] [--addressed] [--db <path>]" + ` | agenttool-collab-host person ... (${PERSON_DESK_USAGE})`;
var MAX_HOST_REASON = 2000;
var DEFAULT_HOST_WAIT_MS = 600000;
var MAX_HOST_WAIT_MS = 3600000;
var HOST_WAIT_POLL_MS = 250;
var systemClock = {
  now: () => performance.now(),
  sleep: (ms) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  }
};
function endSessionFromCredential(store, credential, options) {
  let resumed;
  try {
    if (!options.release_leases)
      store.preflightSessionEnd(credential);
    resumed = store.resumeSession(credential, { allow_cursor_recovery: true });
  } catch (error) {
    if (error instanceof CollabError && error.code === "session_auth_failed") {
      const known = store.getCoordinationSession(credential.session_id);
      if (known?.status === "ended") {
        return removeRevokedFile(options.session_file, {
          protocol: COLLAB_HOST_PROTOCOL,
          status: "already_ended",
          session_id: known.id,
          released: [],
          ended_at: known.ended_at
        });
      }
    }
    throw error;
  }
  const ended = store.endSessionWithReleases({
    ...resumed.credential,
    reason: options.reason,
    release_leases: options.release_leases
  });
  return removeRevokedFile(options.session_file, {
    protocol: COLLAB_HOST_PROTOCOL,
    status: "ended",
    session_id: ended.session.id,
    released: ended.released_leases.map(({ task_id, lease_id, via }) => ({
      task_id,
      lease_id,
      via
    })),
    ended_at: ended.session.ended_at
  });
}
function waitForSessionEvents(store, credential, options, clock = systemClock) {
  const session = store.getCoordinationSession(credential.session_id);
  if (!session)
    throw new CollabError("session_auth_failed", "Session credentials are invalid");
  const workspaceId = session.workspace_id;
  const afterAnchor = { ...options.after_anchor ?? session.cursor };
  const started = clock.now();
  const deadline = started + options.wait_ms;
  let observed = afterAnchor;
  let skipped = 0;
  let unaddressed = 0;
  const receipt = (status, headSequence2) => ({
    protocol: COLLAB_HOST_PROTOCOL,
    status,
    session_id: session.id,
    workspace_id: workspaceId,
    after_anchor: afterAnchor,
    next_anchor: { ...observed },
    head_sequence: headSequence2,
    skipped_own_events: skipped,
    ...options.addressed ? { skipped_unaddressed_events: unaddressed } : {},
    waited_ms: Math.max(0, Math.round(clock.now() - started))
  });
  let headSequence = observed.sequence;
  while (true) {
    let drained = true;
    try {
      const page = store.eventsAfterAnchorForSession({
        ...credential,
        workspace_id: workspaceId,
        after_anchor: observed,
        event_limit: MAX_WAIT_EVENT_LIMIT
      });
      headSequence = page.head_sequence;
      for (const event of page.events) {
        const own = event.session_id === credential.session_id;
        const routed = !options.addressed || store.eventAddressesSession(event, session.id);
        if ((options.include_own || !own) && routed) {
          return receipt("ready", headSequence);
        }
        observed = { epoch_id: event.epoch_id, sequence: event.sequence, hash: event.hash };
        if (own && !options.include_own)
          skipped += 1;
        else
          unaddressed += 1;
      }
      drained = !page.has_more;
    } catch (error) {
      if (error instanceof CollabError && error.code === "event_too_large") {
        return { ...receipt("ready", headSequence), first_event_oversized: true };
      }
      if (!(error instanceof CollabError) || error.code !== "event_read_busy" || clock.now() >= deadline) {
        throw error;
      }
    }
    if (!drained)
      continue;
    const remaining = deadline - clock.now();
    if (remaining <= 0)
      return receipt("idle", headSequence);
    clock.sleep(Math.min(HOST_WAIT_POLL_MS, remaining));
  }
}
function removeRevokedFile(sessionFile, receipt) {
  try {
    removeSessionCredentialFile(sessionFile);
    return receipt;
  } catch {
    return { ...receipt, warning: "session_file_remove_failed" };
  }
}
function runCollabHostCli(argv, env = process.env, clock = systemClock, personDeps = {}) {
  if (argv[0] === "person")
    return runPersonDeskCli(argv.slice(1), env, personDeps);
  let secret = null;
  if (argv.some((arg) => arg === "--help" || arg === "-h")) {
    const help = { protocol: COLLAB_HOST_PROTOCOL, status: "help", usage: COLLAB_HOST_USAGE };
    return { exit_code: 0, line: JSON.stringify(help) };
  }
  const emit = (payload, exitCode) => {
    const line = JSON.stringify(payload);
    if (secret !== null && line.includes(secret)) {
      return {
        exit_code: 1,
        line: JSON.stringify({
          protocol: COLLAB_HOST_PROTOCOL,
          status: "error",
          error: "receipt_withheld",
          message: "The receipt would have contained credential material and was withheld"
        })
      };
    }
    return { exit_code: exitCode, line };
  };
  try {
    const args = parseHostArgs(argv);
    const databasePath = args.db ?? resolveDatabasePath(env);
    if (!existsSync5(databasePath)) {
      throw new CollabError("journal_not_found", "No collaboration journal exists at the selected path; pass --db or set AGENTOOL_COLLAB_DB");
    }
    if (args.command === "end") {
      const credential = readSessionCredentialFile(args.session_file);
      secret = credential.session_token;
      const store2 = new CollabStore(databasePath);
      try {
        return emit(endSessionFromCredential(store2, credential, {
          session_file: args.session_file,
          reason: args.reason,
          release_leases: args.release_leases
        }), 0);
      } finally {
        store2.close();
      }
    }
    const store = new CollabStore(databasePath);
    try {
      const sessionFile = args.session_file ?? store.defaultSessionCredentialPath(args.session);
      const credential = readSessionCredentialFile(sessionFile);
      secret = credential.session_token;
      if (args.session !== undefined && credential.session_id !== args.session) {
        throw new CollabError("session_auth_failed", "Session credentials are invalid");
      }
      return emit(waitForSessionEvents(store, credential, {
        after_anchor: args.after_anchor,
        wait_ms: args.wait_ms,
        include_own: args.include_own,
        addressed: args.addressed
      }, clock), 0);
    } finally {
      store.close();
    }
  } catch (error) {
    return emit(errorReceipt(error), 1);
  }
}
var END_ONLY_OPTIONS = ["reason", "release-leases"];
var WAIT_ONLY_OPTIONS = ["session", "after-anchor", "wait-ms", "include-own", "addressed"];
function parseHostArgs(argv) {
  let parsed;
  try {
    parsed = parseHostOptions(argv);
  } catch (error) {
    throw new CollabError("usage_error", `${error instanceof Error ? error.message : String(error)}; ${COLLAB_HOST_USAGE}`);
  }
  const [command, ...extra] = parsed.positionals;
  if (command !== "end" && command !== "wait" || extra.length > 0) {
    throw new CollabError("usage_error", COLLAB_HOST_USAGE);
  }
  const foreign = (command === "end" ? WAIT_ONLY_OPTIONS : END_ONLY_OPTIONS).find((name) => parsed.values[name] !== undefined);
  if (foreign) {
    throw new CollabError("usage_error", `--${foreign} does not apply to ${command}; ${COLLAB_HOST_USAGE}`);
  }
  if (parsed.values.db !== undefined && parsed.values.db.trim() === "") {
    throw new CollabError("usage_error", `--db must not be empty; ${COLLAB_HOST_USAGE}`);
  }
  return command === "end" ? parseEndArgs(parsed.values) : parseWaitArgs(parsed.values);
}
function parseEndArgs(values) {
  const sessionFile = values["session-file"];
  const reason = values.reason;
  if (!sessionFile || sessionFile.trim() === "") {
    throw new CollabError("usage_error", `--session-file is required; ${COLLAB_HOST_USAGE}`);
  }
  if (!reason || reason.trim() === "") {
    throw new CollabError("usage_error", `--reason is required; ${COLLAB_HOST_USAGE}`);
  }
  if (reason.trim().length > MAX_HOST_REASON) {
    throw new CollabError("usage_error", `--reason exceeds ${MAX_HOST_REASON} characters; ${COLLAB_HOST_USAGE}`);
  }
  if (reason.includes("\x00")) {
    throw new CollabError("usage_error", `--reason must not contain NUL bytes; ${COLLAB_HOST_USAGE}`);
  }
  return {
    command: "end",
    session_file: sessionFile,
    reason,
    release_leases: values["release-leases"] === true,
    db: values.db
  };
}
function parseWaitArgs(values) {
  const sessionFile = values["session-file"];
  const session = values.session;
  if (sessionFile === undefined === (session === undefined)) {
    throw new CollabError("usage_error", `Pass exactly one of --session or --session-file; ${COLLAB_HOST_USAGE}`);
  }
  if ((sessionFile ?? session).trim() === "") {
    throw new CollabError("usage_error", `--session and --session-file must not be empty; ${COLLAB_HOST_USAGE}`);
  }
  let waitMs = DEFAULT_HOST_WAIT_MS;
  if (values["wait-ms"] !== undefined) {
    const raw = values["wait-ms"].trim();
    waitMs = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
    if (!Number.isSafeInteger(waitMs) || waitMs > MAX_HOST_WAIT_MS) {
      throw new CollabError("usage_error", `--wait-ms must be an integer from 0 to ${MAX_HOST_WAIT_MS}; ${COLLAB_HOST_USAGE}`);
    }
  }
  let afterAnchor;
  if (values["after-anchor"] !== undefined) {
    afterAnchor = parseAnchor(values["after-anchor"]);
  }
  return {
    command: "wait",
    session_file: sessionFile,
    session,
    after_anchor: afterAnchor,
    wait_ms: waitMs,
    include_own: values["include-own"] === true,
    addressed: values.addressed === true,
    db: values.db
  };
}
function parseAnchor(raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    value = null;
  }
  const anchor = value;
  if (anchor === null || typeof anchor !== "object" || Array.isArray(anchor) || Object.keys(anchor).sort().join(",") !== "epoch_id,hash,sequence" || typeof anchor.epoch_id !== "string" || typeof anchor.hash !== "string" || !Number.isSafeInteger(anchor.sequence) || anchor.sequence < 0) {
    throw new CollabError("usage_error", `--after-anchor must be JSON {"epoch_id","sequence","hash"}; ${COLLAB_HOST_USAGE}`);
  }
  return { epoch_id: anchor.epoch_id, sequence: anchor.sequence, hash: anchor.hash };
}
function parseHostOptions(argv) {
  return parseArgs2({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      "session-file": { type: "string" },
      reason: { type: "string" },
      "release-leases": { type: "boolean" },
      db: { type: "string" },
      session: { type: "string" },
      "after-anchor": { type: "string" },
      "wait-ms": { type: "string" },
      "include-own": { type: "boolean" },
      addressed: { type: "boolean" }
    }
  });
}
var HOST_ACTIVE_LEASES_MESSAGE = "Release, complete, or hand off active task leases before ending the session, or rerun with --release-leases";
var HOST_ACTIVE_LEASES_REMEDY = "Rerun with --release-leases to release every lease this session holds and end it in one step, " + "or release, complete, or hand off each lease first (a handoff counts once it is accepted).";
function errorReceipt(error) {
  if (error instanceof CollabError) {
    const activeLeases = error.code === "session_has_active_leases";
    return {
      ...error.details,
      ...activeLeases ? { remedy: HOST_ACTIVE_LEASES_REMEDY } : {},
      protocol: COLLAB_HOST_PROTOCOL,
      status: "error",
      error: error.code,
      message: activeLeases ? HOST_ACTIVE_LEASES_MESSAGE : error.message
    };
  }
  return {
    protocol: COLLAB_HOST_PROTOCOL,
    status: "error",
    error: "internal_error",
    message: error instanceof Error ? error.message : String(error)
  };
}

// bin/agenttool-collab-host.ts
var result = runCollabHostCli(process.argv.slice(2), process.env);
process.stdout.write(`${result.line}
`);
process.exitCode = result.exit_code;
