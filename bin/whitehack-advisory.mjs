#!/usr/bin/env node
/**
 * Bounded AgentTool bridge for the pinned Whitehack honesty linter.
 *
 * The upstream scanner is heuristic and may place matched source text in each
 * finding. This bridge deliberately keeps only a validated repository-relative
 * file, line, check, confidence, doctrine, and Clear Standard principle. It
 * does not include source snippets, scanner messages, or captured error text in
 * its report.
 *
 * Doctrine: docs/WHITEHACK.md
 */
import { execFileSync } from "node:child_process";
import {
  appendFile,
  lstat,
  readFile,
  realpath,
} from "node:fs/promises";
import {
  dirname,
  extname,
  isAbsolute,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";

export const WHITEHACK_REPOSITORY = "https://github.com/cambridgetcg/whitehack";
export const WHITEHACK_PACKAGE = "@agenttool/whitehack-scan";
export const WHITEHACK_REVISION = "fdd2260efd7a11e5d52c12c53d8016d1f5e7d23a";
export const WHITEHACK_VERSION = "0.8.1";
export const WHITEHACK_INTEGRITY = "sha512-6FUlV1rOLZqPxLHcHE+x3f2XHCOwSsWSqEi+TDxi4pRJEe/CGoIN4Lw8mghsRvmUrtbHtFBrxLyRSk/5iMazPw==";
export const WHITEHACK_TARBALL_URL = "https://registry.npmjs.org/@agenttool/whitehack-scan/-/whitehack-scan-0.8.1.tgz";
export const ADVISORY_SCHEMA = "agenttool-whitehack-advisory/v0.1";

const WHITEHACK_EXPORTS = Object.freeze({
  core: "./src/core.js",
  understanding: "./src/understanding.js",
});
const WHITEHACK_CHECK_COUNT = 47;
const INSTALL_LIFECYCLE_SCRIPTS = new Set([
  "dependencies",
  "install",
  "postdependencies",
  "postinstall",
  "postpack",
  "postprepare",
  "postpublish",
  "postversion",
  "predependencies",
  "preinstall",
  "prepack",
  "prepare",
  "preprepare",
  "prepublish",
  "prepublishOnly",
  "preversion",
  "publish",
  "version",
]);

export const DEFAULT_LIMITS = Object.freeze({
  max_changed_paths: 2_000,
  max_path_bytes: 1_024,
  max_diff_bytes: 256 * 1_024,
  max_files: 200,
  max_file_bytes: 512 * 1024,
  max_total_bytes: 8 * 1024 * 1024,
  max_total_findings: 5_000,
  max_reported_findings: 200,
});

// Attention cards are a separate, deliberately lossy presentation. These
// bounds do not alter the closed advisory/v0.1 JSON report or its limits.
export const DEFAULT_ATTENTION_LIMITS = Object.freeze({
  max_findings: 200,
  max_cards: 200,
  max_checks_per_card: 200,
  max_files: 200,
  max_hunks: 20_000,
  max_diff_bytes: 16 * 1024 * 1024,
  max_summary_bytes: 512 * 1024,
});

const SUPPORTED_EXTENSIONS = new Set([
  ".c",
  ".cfg",
  ".cjs",
  ".conf",
  ".go",
  ".h",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".mjs",
  ".py",
  ".rs",
  ".sol",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

const EXCLUDED_SEGMENTS = new Set([
  "__fixtures__",
  "__tests__",
  "benchmarks",
  "build",
  "coverage",
  "dist",
  "examples",
  "fixtures",
  "generated",
  "node_modules",
  "out",
  "reports",
  "test",
  "tests",
  "vendor",
]);

// Keep this closed schema allowlist compatible with v0.1 reports. The pinned
// scanner currently emits high, medium-high, and heuristic; medium remains a
// valid v0.1 label. Dropping a schema-valid label would turn a complete,
// redacted finding set into a false scanner_file_incomplete report.
const CONFIDENCE = new Set(["high", "medium-high", "medium", "heuristic"]);
const SAFE_TOKEN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const GIT_SHA = /^[0-9a-f]{40}$/i;
const UNSAFE_PATH_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const ATTENTION_RELEVANCE = new Set([
  "changed line",
  "unchanged line in changed file",
  "unknown",
]);

export class WhitehackAdvisoryError extends Error {
  constructor(code) {
    super(code);
    this.name = "WhitehackAdvisoryError";
    this.code = code;
  }
}

function fail(code) {
  throw new WhitehackAdvisoryError(code);
}

function git(args, cwd, encoding = "utf8") {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    fail("git_operation_failed");
  }
}

function isWithin(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function normalizeLimits(overrides = {}) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    fail("invalid_limits");
  }
  if (Object.keys(overrides).some((key) => !(key in DEFAULT_LIMITS))) {
    fail("invalid_limits");
  }
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const [key, ceiling] of Object.entries(DEFAULT_LIMITS)) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > ceiling) {
      fail("invalid_limits");
    }
  }
  return limits;
}

function validateRelativePath(path, limits) {
  if (
    typeof path !== "string"
    || !path
    || isAbsolute(path)
    || path.includes("\\")
    || UNSAFE_PATH_CHARACTERS.test(path)
    || path.length > limits.max_path_bytes
    || Buffer.byteLength(path, "utf8") > limits.max_path_bytes
  ) {
    fail("invalid_candidate_path");
  }
  const segments = path.split(/[\\/]/u);
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    fail("invalid_candidate_path");
  }
}

function validatePathSet(paths, limits) {
  if (!Array.isArray(paths)) fail("invalid_candidate_paths");
  if (paths.length > limits.max_changed_paths) fail("changed_path_count_limit_exceeded");
  let bytes = 0;
  for (const path of paths) {
    validateRelativePath(path, limits);
    bytes += Buffer.byteLength(path, "utf8") + 1;
    if (bytes > limits.max_diff_bytes) fail("diff_byte_limit_exceeded");
  }
  return bytes;
}

function skipReason(path) {
  const segments = path.split("/");
  if (segments.some((segment) => segment.startsWith("."))) return "hidden_path";
  if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) return "non_production_path";
  if (!SUPPORTED_EXTENSIONS.has(extname(path).toLowerCase())) return "unsupported_extension";
  return null;
}

function increment(record, key) {
  record[key] = (record[key] ?? 0) + 1;
}

export async function selectCandidateFiles(rootInput, paths, limits = DEFAULT_LIMITS) {
  limits = normalizeLimits(limits);
  validatePathSet(paths, limits);
  const root = await realpath(resolve(rootInput));
  const selected = [];
  const skipped = {};
  let totalBytes = 0;

  for (const path of [...new Set(paths)].sort()) {
    const reason = skipReason(path);
    if (reason) {
      increment(skipped, reason);
      continue;
    }

    const absolute = resolve(root, path);
    if (!isWithin(root, absolute)) fail("candidate_outside_root");

    let info;
    try {
      info = await lstat(absolute);
    } catch {
      fail("candidate_missing_or_unreadable");
    }
    if (!info.isFile() || info.isSymbolicLink()) {
      increment(skipped, "non_regular_file");
      continue;
    }

    let canonical;
    try {
      canonical = await realpath(absolute);
    } catch {
      fail("candidate_unresolved");
    }
    if (!isWithin(root, canonical)) fail("candidate_outside_root");
    if (info.size > limits.max_file_bytes) fail("file_byte_limit_exceeded");

    let bytes;
    try {
      bytes = await readFile(canonical);
    } catch {
      fail("candidate_unreadable");
    }
    if (bytes.length !== info.size) fail("candidate_changed_during_read");
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      fail("invalid_source_encoding");
    }

    totalBytes += bytes.length;
    if (totalBytes > limits.max_total_bytes) fail("total_byte_limit_exceeded");
    selected.push({
      path,
      absolute: canonical,
      bytes: bytes.length,
      line_count: text.split("\n").length,
      source: text,
    });
    if (selected.length > limits.max_files) fail("file_count_limit_exceeded");
  }

  return { root, selected, skipped, total_bytes: totalBytes };
}

export function listChangedPaths(root, base, head, limitOverrides = DEFAULT_LIMITS) {
  const limits = normalizeLimits(limitOverrides);
  if (!GIT_SHA.test(base) || !GIT_SHA.test(head)) fail("invalid_git_revision");
  let output;
  try {
    output = execFileSync(
      "git",
      [
        "--no-pager",
        "diff",
        "--name-only",
        "-z",
        "--no-renames",
        "--no-ext-diff",
        "--no-textconv",
        "--diff-filter=ACMT",
        base,
        head,
        "--",
      ],
      {
        cwd: root,
        encoding: null,
        maxBuffer: limits.max_diff_bytes + 1,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
  } catch {
    fail("git_diff_failed");
  }
  if (output.length > limits.max_diff_bytes) fail("diff_byte_limit_exceeded");
  const text = output.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(output)) fail("unsupported_git_path_encoding");
  const paths = text.split("\0").filter(Boolean);
  validatePathSet(paths, limits);
  return paths;
}

function normalizeAttentionLimits(overrides = {}) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    fail("invalid_attention_limits");
  }
  if (Object.keys(overrides).some((key) => !(key in DEFAULT_ATTENTION_LIMITS))) {
    fail("invalid_attention_limits");
  }
  const limits = { ...DEFAULT_ATTENTION_LIMITS, ...overrides };
  for (const [key, ceiling] of Object.entries(DEFAULT_ATTENTION_LIMITS)) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > ceiling) {
      fail("invalid_attention_limits");
    }
  }
  return limits;
}

function parseZeroContextHunks(text, remainingHunks) {
  const ranges = [];
  let hunkCount = 0;
  const header =
    /^@@ -([0-9]+)(?:,([0-9]+))? \+([0-9]+)(?:,([0-9]+))? @@(?: .*)?$/gmu;
  let match;
  while ((match = header.exec(text)) !== null) {
    hunkCount += 1;
    if (hunkCount > remainingHunks) {
      return { bounded: false, hunk_count: remainingHunks, ranges: [] };
    }
    const start = Number(match[3]);
    const count = match[4] === undefined ? 1 : Number(match[4]);
    if (
      !Number.isSafeInteger(start)
      || start < 0
      || !Number.isSafeInteger(count)
      || count < 0
    ) {
      return { bounded: false, hunk_count: 0, ranges: [] };
    }
    if (count > 0) ranges.push({ start, end: start + count - 1 });
  }
  return { bounded: true, hunk_count: hunkCount, ranges };
}

function changedPathStatuses(root, base, head, remainingBytes) {
  let output;
  try {
    output = execFileSync(
      "git",
      [
        "--no-pager",
        "diff",
        "--name-status",
        "-z",
        "--no-renames",
        "--no-ext-diff",
        "--no-textconv",
        "--diff-filter=ACMT",
        base,
        head,
        "--",
      ],
      {
        cwd: root,
        encoding: null,
        maxBuffer: remainingBytes + 1,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
  } catch {
    return { bytes: remainingBytes, statuses: new Map() };
  }
  if (output.length > remainingBytes) {
    return { bytes: remainingBytes, statuses: new Map() };
  }
  const text = output.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(output)) {
    return { bytes: output.length, statuses: new Map() };
  }
  const fields = text.split("\0");
  if (fields.at(-1) === "") fields.pop();
  const statuses = new Map();
  for (let index = 0; index < fields.length;) {
    const status = fields[index];
    const path = fields[index + 1];
    if (!/^[AMT]$/u.test(status) || path === undefined) {
      return { bytes: output.length, statuses: new Map() };
    }
    statuses.set(path, status);
    index += 2;
  }
  return { bytes: output.length, statuses };
}

function diffRangesForPath(root, base, head, path, remainingBytes, remainingHunks) {
  let patch;
  try {
    patch = execFileSync(
      "git",
      [
        "--literal-pathspecs",
        "--no-pager",
        "diff",
        "--no-color",
        "--unified=0",
        "--no-renames",
        "--no-ext-diff",
        "--no-textconv",
        "--diff-filter=M",
        base,
        head,
        "--",
        path,
      ],
      {
        cwd: root,
        encoding: null,
        maxBuffer: remainingBytes + 1,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
  } catch {
    return {
      bytes: remainingBytes,
      hunk_count: 0,
      exhausted: true,
      known: false,
      ranges: [],
    };
  }
  if (patch.length > remainingBytes) {
    return {
      bytes: remainingBytes,
      hunk_count: 0,
      exhausted: true,
      known: false,
      ranges: [],
    };
  }
  const text = patch.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(patch)) {
    return {
      bytes: patch.length,
      hunk_count: 0,
      exhausted: false,
      known: false,
      ranges: [],
    };
  }
  if (/^(?:Binary files .* differ|GIT binary patch)$/gmu.test(text)) {
    return {
      bytes: patch.length,
      hunk_count: 0,
      exhausted: false,
      known: false,
      ranges: [],
    };
  }
  const parsed = parseZeroContextHunks(text, remainingHunks);
  const apparentHunkCount = text.match(/^@@ /gmu)?.length ?? 0;
  const known = parsed.bounded
    && parsed.hunk_count > 0
    && apparentHunkCount === parsed.hunk_count;
  return {
    bytes: patch.length,
    hunk_count: parsed.hunk_count,
    exhausted: !parsed.bounded,
    known,
    ranges: parsed.ranges,
  };
}

function reviewQuestionFor(checks) {
  const tokens = [...new Set(checks.map(({ check }) => check))].sort();
  const readableTokens = tokens.length < 2
    ? tokens[0]
    : `${tokens.slice(0, -1).join(", ")} and ${tokens.at(-1)}`;
  const subject = tokens.length === 1
    ? `the public ${readableTokens} check token`
    : `the public check tokens ${readableTokens}`;
  return `What trust boundary or invariant should a reviewer verify for ${subject}? Which regression test records the intended behaviour?`;
}

/**
 * Build a bounded, presentation-only view of redacted findings.
 *
 * For a path Git classifies as modified text, "changed line" means the
 * finding's HEAD line is inside a parseable zero-context new-side hunk for the
 * exact base..head pair. "unchanged line in changed file" means it is outside
 * every such hunk. Added, renamed, binary, type-changed, and unparseable paths
 * are "unknown". None of these labels assert that a change caused a finding.
 */
export function buildAttentionCards({
  root,
  base,
  head,
  findings,
  limits: limitOverrides = DEFAULT_ATTENTION_LIMITS,
}) {
  const limits = normalizeAttentionLimits(limitOverrides);
  if (!GIT_SHA.test(base) || !GIT_SHA.test(head)) fail("invalid_git_revision");
  if (!Array.isArray(findings)) fail("invalid_attention_findings");
  if (findings.length > limits.max_findings) fail("attention_finding_count_limit_exceeded");

  const byLocation = new Map();
  for (const finding of findings) {
    if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
      fail("invalid_attention_finding");
    }
    validateRelativePath(finding.file, DEFAULT_LIMITS);
    if (!Number.isSafeInteger(finding.line) || finding.line < 1) {
      fail("invalid_attention_finding");
    }
    if (!isSafeToken(finding.check) || !CONFIDENCE.has(finding.confidence)) {
      fail("invalid_attention_finding");
    }
    const key = JSON.stringify([finding.file, finding.line]);
    let card = byLocation.get(key);
    if (!card) {
      card = {
        file: finding.file,
        line: finding.line,
        checks: new Map(),
      };
      byLocation.set(key, card);
      if (byLocation.size > limits.max_cards) fail("attention_card_count_limit_exceeded");
    }
    const signalKey = JSON.stringify([finding.check, finding.confidence]);
    const previous = card.checks.get(signalKey);
    card.checks.set(signalKey, {
      check: finding.check,
      confidence: finding.confidence,
      count: (previous?.count ?? 0) + 1,
    });
    if (card.checks.size > limits.max_checks_per_card) {
      fail("attention_check_count_limit_exceeded");
    }
  }

  const files = [...new Set([...byLocation.values()].map(({ file }) => file))].sort();
  if (files.length > limits.max_files) fail("attention_file_count_limit_exceeded");
  validatePathSet(files, DEFAULT_LIMITS);

  const classifications = new Map();
  const pathStatuses = changedPathStatuses(root, base, head, limits.max_diff_bytes);
  let diffBytes = pathStatuses.bytes;
  let hunkCount = 0;
  let classificationStopped = false;
  for (const file of files) {
    if (classificationStopped || pathStatuses.statuses.get(file) !== "M") {
      classifications.set(file, { known: false, ranges: [] });
      continue;
    }
    if (diffBytes >= limits.max_diff_bytes || hunkCount >= limits.max_hunks) {
      classificationStopped = true;
      classifications.set(file, { known: false, ranges: [] });
      continue;
    }
    const diff = diffRangesForPath(
      root,
      base,
      head,
      file,
      limits.max_diff_bytes - diffBytes,
      limits.max_hunks - hunkCount,
    );
    diffBytes += diff.bytes;
    hunkCount += diff.hunk_count;
    classifications.set(file, { known: diff.known, ranges: diff.ranges });
    if (diff.exhausted) classificationStopped = true;
  }

  return [...byLocation.values()]
    .map((card) => {
      const classification = classifications.get(card.file);
      let relevance = "unknown";
      if (classification?.known) {
        relevance = classification.ranges
          .some(({ start, end }) => card.line >= start && card.line <= end)
          ? "changed line"
          : "unchanged line in changed file";
      }
      const checks = [...card.checks.values()]
        .sort((a, b) => a.check.localeCompare(b.check)
          || a.confidence.localeCompare(b.confidence));
      return {
        file: card.file,
        line: card.line,
        relevance,
        checks,
      };
    })
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

export function verifyCheckedOutHead(root, base, head) {
  if (!GIT_SHA.test(base) || !GIT_SHA.test(head)) fail("invalid_git_revision");
  if (/^0{40}$/u.test(base) || /^0{40}$/u.test(head)) fail("unsupported_zero_revision");
  const checkedOut = git(["rev-parse", "HEAD"], root).trim();
  if (checkedOut !== head) fail("checked_out_head_mismatch");
  git(["cat-file", "-e", `${base}^{commit}`], root);
  git(["cat-file", "-e", `${head}^{commit}`], root);
  if (git(["status", "--porcelain=v1", "--untracked-files=no"], root).trim()) {
    fail("source_not_clean");
  }
}

async function readRegularJson(path, code) {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) fail(code);
    const value = JSON.parse(await readFile(path, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(code);
    return value;
  } catch (error) {
    if (error instanceof WhitehackAdvisoryError) throw error;
    fail(code);
  }
}

function dependencyFieldIsNonEmpty(value) {
  if (value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

async function verifyScannerModule(
  scannerRootInput,
  scannerLockInput,
  exportName,
  expected,
) {
  const {
    revision,
    version,
    packageName,
    integrity,
    tarballUrl,
  } = expected;
  if (!GIT_SHA.test(revision)) fail("invalid_scanner_revision");
  if (typeof scannerLockInput !== "string" || !scannerLockInput) fail("scanner_lock_invalid");

  const lockPath = resolve(scannerLockInput);
  const lock = await readRegularJson(lockPath, "scanner_lock_invalid");
  const toolRoot = await realpath(dirname(lockPath));
  const toolPackage = await readRegularJson(
    resolve(toolRoot, "package.json"),
    "scanner_lock_invalid",
  );
  const expectedLockPath = `node_modules/${packageName}`;
  const packageEntries = lock.packages && typeof lock.packages === "object"
    ? Object.keys(lock.packages).sort()
    : [];
  const rootEntry = lock.packages?.[""];
  const scannerEntry = lock.packages?.[expectedLockPath];
  if (
    lock.lockfileVersion !== 3
    || packageEntries.length !== 2
    || packageEntries[0] !== ""
    || packageEntries[1] !== expectedLockPath
    || toolPackage.private !== true
    || toolPackage.packageManager !== "npm@11.17.0"
    || Object.keys(toolPackage.devDependencies ?? {}).length !== 1
    || toolPackage.devDependencies?.[packageName] !== version
    || rootEntry?.devDependencies?.[packageName] !== version
    || Object.keys(rootEntry?.devDependencies ?? {}).length !== 1
    || scannerEntry?.version !== version
    || scannerEntry?.resolved !== tarballUrl
    || scannerEntry?.dev !== true
  ) {
    fail("scanner_lock_mismatch");
  }
  if (scannerEntry.integrity !== integrity) fail("scanner_integrity_mismatch");

  if (typeof scannerRootInput !== "string" || !scannerRootInput) {
    fail("scanner_root_mismatch");
  }
  const requestedScannerRoot = resolve(scannerRootInput);
  let requestedInfo;
  let scannerRoot;
  let expectedScannerRoot;
  try {
    requestedInfo = await lstat(requestedScannerRoot);
    scannerRoot = await realpath(requestedScannerRoot);
    expectedScannerRoot = await realpath(resolve(toolRoot, expectedLockPath));
  } catch {
    fail("scanner_root_mismatch");
  }
  if (
    !requestedInfo.isDirectory()
    || requestedInfo.isSymbolicLink()
    || scannerRoot !== expectedScannerRoot
    || !isWithin(toolRoot, scannerRoot)
  ) {
    fail("scanner_root_mismatch");
  }

  const packageJson = await readRegularJson(
    resolve(scannerRoot, "package.json"),
    "scanner_package_invalid",
  );
  if (packageJson.name !== packageName) fail("scanner_package_name_mismatch");
  if (packageJson.version !== version) fail("scanner_version_mismatch");
  if (packageJson.type !== "module") fail("scanner_package_invalid");
  for (const field of [
    "bundleDependencies",
    "bundledDependencies",
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
  ]) {
    if (dependencyFieldIsNonEmpty(packageJson[field])) fail("scanner_runtime_dependencies");
  }
  if (
    packageJson.scripts !== undefined
    && (!packageJson.scripts
      || typeof packageJson.scripts !== "object"
      || Array.isArray(packageJson.scripts))
  ) {
    fail("scanner_package_invalid");
  }
  if (Object.keys(packageJson.scripts ?? {}).some((name) => INSTALL_LIFECYCLE_SCRIPTS.has(name))) {
    fail("scanner_lifecycle_script");
  }
  const exportPath = WHITEHACK_EXPORTS[exportName];
  if (!exportPath) fail("scanner_export_name_invalid");
  if (packageJson.exports?.[`./${exportName}`] !== exportPath) {
    fail(`scanner_${exportName}_export_mismatch`);
  }

  const requestedModulePath = resolve(scannerRoot, exportPath);
  let moduleInfo;
  let modulePath;
  try {
    moduleInfo = await lstat(requestedModulePath);
    modulePath = await realpath(requestedModulePath);
  } catch {
    fail("scanner_module_invalid");
  }
  if (
    !moduleInfo.isFile()
    || moduleInfo.isSymbolicLink()
    || !isWithin(scannerRoot, modulePath)
  ) {
    fail("scanner_module_outside_root");
  }
  return { scannerRoot, modulePath, revision, version: packageJson.version };
}

async function captureScannerOutput(operation) {
  const methods = ["debug", "error", "info", "log", "warn"];
  const originals = new Map(methods.map((method) => [method, console[method]]));
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  let reported = false;
  for (const method of methods) console[method] = () => { reported = true; };
  process.stdout.write = () => { reported = true; return true; };
  process.stderr.write = () => { reported = true; return true; };
  try {
    const value = await operation();
    return { value, reported };
  } catch {
    return { error: true, reported };
  } finally {
    for (const [method, original] of originals) console[method] = original;
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}

/**
 * Verify and silently import one reviewed public module from the exact locked
 * Whitehack package. This proves the local package identity and containment;
 * it does not sandbox or authorize the imported code.
 */
export async function loadVerifiedWhitehackModule(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    fail("scanner_options_invalid");
  }
  const exportName = options.export_name;
  if (!Object.hasOwn(WHITEHACK_EXPORTS, exportName)) {
    fail("scanner_export_name_invalid");
  }
  const scanner = await verifyScannerModule(
    options.scanner_root,
    options.scanner_lock,
    exportName,
    {
      revision: options.expected_revision ?? WHITEHACK_REVISION,
      version: options.expected_version ?? WHITEHACK_VERSION,
      packageName: options.expected_package ?? WHITEHACK_PACKAGE,
      integrity: options.expected_integrity ?? WHITEHACK_INTEGRITY,
      tarballUrl: options.expected_tarball_url ?? WHITEHACK_TARBALL_URL,
    },
  );
  const imported = await captureScannerOutput(
    () => import(pathToFileURL(scanner.modulePath).href),
  );
  if (imported.error || imported.reported) fail("scanner_import_failed");
  return { module: imported.value, scanner };
}

function isSafeToken(value) {
  return typeof value === "string" && SAFE_TOKEN.test(value);
}

export function redactFinding(finding, file, lineCount = Number.MAX_SAFE_INTEGER) {
  if (!finding || typeof finding !== "object" || Array.isArray(finding)) return null;
  const line = finding.line;
  if (!Number.isSafeInteger(line) || line < 1 || line > lineCount) return null;
  if (!isSafeToken(finding.check) || !isSafeToken(finding.doctrine)) return null;
  if (!CONFIDENCE.has(finding.confidence)) return null;
  if (
    !Number.isSafeInteger(finding.principle)
    || finding.principle < 1
    || finding.principle > 6
  ) return null;
  return {
    file,
    line,
    check: finding.check,
    confidence: finding.confidence,
    doctrine: finding.doctrine,
    principle: finding.principle,
  };
}

function summarize(findings) {
  const byCheck = {};
  const byConfidence = {};
  for (const finding of findings) {
    increment(byCheck, finding.check);
    increment(byConfidence, finding.confidence);
  }
  return {
    finding_count: findings.length,
    by_check: Object.fromEntries(Object.entries(byCheck).sort()),
    by_confidence: Object.fromEntries(Object.entries(byConfidence).sort()),
  };
}

export async function runAdvisory(options) {
  const limits = normalizeLimits(options.limits ?? DEFAULT_LIMITS);
  if (!GIT_SHA.test(options.base) || !GIT_SHA.test(options.head)) fail("invalid_git_revision");
  const changedPathBytes = validatePathSet(options.paths, limits);
  const { module: scannerModule, scanner } = await loadVerifiedWhitehackModule({
    scanner_root: options.scanner_root,
    scanner_lock: options.scanner_lock,
    export_name: "core",
    expected_revision: options.expected_revision,
    expected_version: options.expected_version,
    expected_package: options.expected_package,
    expected_integrity: options.expected_integrity,
    expected_tarball_url: options.expected_tarball_url,
  });
  const candidates = await selectCandidateFiles(options.root, options.paths, limits);

  if (
    typeof scannerModule?.scanText !== "function"
    || !Array.isArray(scannerModule?.CHECK_MANIFEST)
    || scannerModule.CHECK_MANIFEST.length !== WHITEHACK_CHECK_COUNT
  ) {
    fail("scanner_import_failed");
  }

  const findings = [];
  const errors = [];
  for (const candidate of candidates.selected) {
    const scanned = await captureScannerOutput(() => scannerModule.scanText(candidate.source, {
      file: candidate.path,
    }));
    if (scanned.error || scanned.reported || !Array.isArray(scanned.value)) {
      errors.push({ file: candidate.path, code: "scanner_file_incomplete" });
      continue;
    }
    if (findings.length + scanned.value.length > limits.max_total_findings) {
      fail("finding_count_limit_exceeded");
    }
    let redacted;
    try {
      redacted = scanned.value.map((finding) => redactFinding(
        finding,
        candidate.path,
        candidate.line_count,
      ));
    } catch {
      redacted = null;
    }
    if (!redacted || redacted.some((finding) => finding === null)) {
      errors.push({ file: candidate.path, code: "scanner_file_incomplete" });
      continue;
    }
    findings.push(...redacted);
  }

  findings.sort((a, b) => a.file.localeCompare(b.file)
    || a.line - b.line
    || a.check.localeCompare(b.check));
  const summary = summarize(findings);
  const detailsTruncated = findings.length > limits.max_reported_findings;

  return {
    document_type: ADVISORY_SCHEMA,
    generated_at: new Date().toISOString(),
    status: errors.length ? "incomplete" : "complete",
    scanner: {
      repository: WHITEHACK_REPOSITORY,
      revision: scanner.revision,
      version: scanner.version,
    },
    scope: {
      mode: "changed_supported_regular_files",
      base_revision: options.base,
      head_revision: options.head,
      changed_path_count: options.paths.length,
      changed_path_bytes: changedPathBytes,
      candidate_count: candidates.selected.length,
      candidate_bytes: candidates.total_bytes,
      skipped: candidates.skipped,
      limits,
    },
    summary,
    findings: findings.slice(0, limits.max_reported_findings),
    finding_details_truncated: detailsTruncated,
    errors,
    boundaries: [
      "heuristic_findings_are_not_security_proof",
      "absence_of_findings_is_not_proof_of_honesty",
      "only_changed_supported_regular_non_test_files_are_observed",
      "source_snippets_messages_and_exception_text_are_not_serialized",
      "pinned_scanner_runs_with_the_callers_local_file_permissions",
      "no_dynamic_testing_target_interaction_or_submission",
      "a_finding_does_not_establish_target_authorization",
    ],
  };
}

function parseArgs(argv) {
  const result = { root: process.cwd() };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (![
      "--base",
      "--head",
      "--root",
      "--scanner-lock",
      "--scanner-root",
      "--summary-file",
    ].includes(name)) {
      fail("invalid_argument");
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail("missing_argument_value");
    result[name.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  if (
    !result.base
    || !result.head
    || !result.scanner_lock
    || !result.scanner_root
  ) fail("missing_required_argument");
  return result;
}

// Encode every non-structural filename character as an HTML numeric reference.
// This keeps Markdown syntax, HTML tags, table delimiters, and workflow-command
// looking text inert while preserving its rendered human-readable form.
export function escapeAttentionText(value) {
  if (
    typeof value !== "string"
    || UNSAFE_PATH_CHARACTERS.test(value)
    || value.includes("\n")
    || value.includes("\r")
  ) {
    fail("invalid_attention_text");
  }
  return [...value].map((character) => (
    /^[A-Za-z0-9 /.-]$/u.test(character)
      ? character
      : `&#x${character.codePointAt(0).toString(16)};`
  )).join("");
}

export function markdownSummary(
  report,
  cards = [],
  limitOverrides = DEFAULT_ATTENTION_LIMITS,
) {
  const limits = normalizeAttentionLimits(limitOverrides);
  if (!Array.isArray(cards) || cards.length > limits.max_cards) {
    fail("invalid_attention_cards");
  }
  const lines = [
    "## Whitehack advisory",
    "",
    `- Status: ${escapeAttentionText(report.status)}`,
    `- Changed supported files observed: ${report.scope.candidate_count}`,
    `- Findings: ${report.summary.finding_count}`,
    `- Scanner: Whitehack ${escapeAttentionText(report.scanner.version)} at ${escapeAttentionText(report.scanner.revision.slice(0, 12))}`,
    "",
    "This is a redacted heuristic observation, not a security proof or authorization to test a target.",
  ];
  const checks = Object.entries(report.summary.by_check);
  if (checks.length) {
    lines.push("", "| Check | Count |", "|---|---:|");
    for (const [check, count] of checks) {
      lines.push(`| ${escapeAttentionText(check)} | ${count} |`);
    }
  }
  if (cards.length) {
    lines.push(
      "",
      `### Attention cards (${cards.length} grouped locations)`,
      "",
      "The Findings count above counts redacted finding occurrences; signals at the same file and line are grouped here.",
      "",
      "For modified text paths, relevance is line membership in an exact zero-context base-to-head Git hunk. Added, renamed, binary, type-changed, or unparseable paths are unknown. No label claims that a change caused a finding.",
      "",
    );
    const cardChunks = [];
    for (const [index, card] of cards.entries()) {
      if (
        !card
        || typeof card !== "object"
        || Array.isArray(card)
        || !ATTENTION_RELEVANCE.has(card.relevance)
        || !Number.isSafeInteger(card.line)
        || card.line < 1
        || !Array.isArray(card.checks)
        || card.checks.length < 1
        || card.checks.length > limits.max_checks_per_card
      ) {
        fail("invalid_attention_card");
      }
      validateRelativePath(card.file, DEFAULT_LIMITS);
      const supportingChecks = card.checks.map(({ check, confidence, count }) => {
        if (
          !isSafeToken(check)
          || !CONFIDENCE.has(confidence)
          || !Number.isSafeInteger(count)
          || count < 1
          || count > limits.max_findings
        ) {
          fail("invalid_attention_card");
        }
        const occurrence = count === 1 ? "" : ` x${count}`;
        return `${escapeAttentionText(check)} (${escapeAttentionText(confidence)})${occurrence}`;
      }).join(", ");
      cardChunks.push([
        `${index + 1}. **${escapeAttentionText(card.relevance)}**`,
        `   - File and line: ${escapeAttentionText(card.file)}&#x3a;${card.line}`,
        `   - Supporting checks: ${supportingChecks}`,
        `   - Review question: ${escapeAttentionText(reviewQuestionFor(card.checks))}`,
        "",
      ]);
    }
    const afterCards = [];
    if (report.finding_details_truncated) {
      afterCards.push(
        `Only the first ${report.scope.limits.max_reported_findings} redacted finding details are available for attention cards.`,
        "",
      );
    }
    let shown = 0;
    for (const chunk of cardChunks) {
      const nextShown = shown + 1;
      const boundedNotice = nextShown < cardChunks.length
        ? [
            `Attention card presentation stopped at the ${limits.max_summary_bytes}-byte bound: ${nextShown} of ${cardChunks.length} grouped locations shown.`,
            "",
          ]
        : [];
      const candidate = [
        ...lines,
        ...chunk,
        ...boundedNotice,
        ...afterCards,
        "",
      ];
      if (Buffer.byteLength(`${candidate.join("\n")}\n`, "utf8") > limits.max_summary_bytes) {
        break;
      }
      lines.push(...chunk);
      shown = nextShown;
    }
    if (shown < cardChunks.length) {
      lines.push(
        `Attention card presentation stopped at the ${limits.max_summary_bytes}-byte bound: ${shown} of ${cardChunks.length} grouped locations shown.`,
        "",
      );
    }
    lines.push(...afterCards);
  }
  lines.push("");
  const summary = `${lines.join("\n")}\n`;
  if (Buffer.byteLength(summary, "utf8") > limits.max_summary_bytes) {
    fail("attention_summary_byte_limit_exceeded");
  }
  return summary;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const root = await realpath(resolve(args.root));
  verifyCheckedOutHead(root, args.base, args.head);
  const paths = listChangedPaths(root, args.base, args.head, DEFAULT_LIMITS);
  const report = await runAdvisory({
    root,
    paths,
    scanner_lock: args.scanner_lock,
    scanner_root: args.scanner_root,
    base: args.base,
    head: args.head,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (args.summary_file) {
    const cards = buildAttentionCards({
      root,
      base: args.base,
      head: args.head,
      findings: report.findings,
    });
    await appendFile(args.summary_file, markdownSummary(report, cards), "utf8");
  }
  if (report.status !== "complete") process.exitCode = 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    const code = error instanceof WhitehackAdvisoryError ? error.code : "unexpected_failure";
    process.stderr.write(`whitehack advisory failed: ${code}\n`);
    process.exitCode = 1;
  });
}
