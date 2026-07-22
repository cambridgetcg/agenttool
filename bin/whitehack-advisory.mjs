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
  extname,
  isAbsolute,
  resolve,
  sep,
} from "node:path";
import { pathToFileURL } from "node:url";

export const WHITEHACK_REPOSITORY = "https://github.com/cambridgetcg/whitehack";
export const WHITEHACK_REVISION = "37bf9154864603a94c80c03d27aa0bad05ea7c23";
export const WHITEHACK_VERSION = "0.6.0";
export const ADVISORY_SCHEMA = "agenttool-whitehack-advisory/v0.1";

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

async function verifyScanner(scannerRootInput, expectedRevision, expectedVersion) {
  if (!GIT_SHA.test(expectedRevision)) fail("invalid_scanner_revision");
  const scannerRoot = await realpath(resolve(scannerRootInput));
  const revision = git(["rev-parse", "HEAD"], scannerRoot).trim();
  if (revision !== expectedRevision) fail("scanner_revision_mismatch");
  if (git(["status", "--porcelain"], scannerRoot).trim()) fail("scanner_not_clean");
  git(["ls-files", "--error-unmatch", "src/scan.js"], scannerRoot);

  let packageJson;
  try {
    packageJson = JSON.parse(await readFile(resolve(scannerRoot, "package.json"), "utf8"));
  } catch {
    fail("scanner_package_invalid");
  }
  if (packageJson.version !== expectedVersion) fail("scanner_version_mismatch");

  const modulePath = await realpath(resolve(scannerRoot, "src/scan.js"));
  if (!isWithin(scannerRoot, modulePath)) fail("scanner_module_outside_root");
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

function isSafeToken(value) {
  return typeof value === "string" && SAFE_TOKEN.test(value);
}

export function redactFinding(finding, file, lineCount = Number.MAX_SAFE_INTEGER) {
  if (!finding || typeof finding !== "object" || Array.isArray(finding)) return null;
  const line = finding.line === 0 ? 1 : finding.line;
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
  const expectedRevision = options.expected_revision ?? WHITEHACK_REVISION;
  const expectedVersion = options.expected_version ?? WHITEHACK_VERSION;
  const scanner = await verifyScanner(options.scanner_root, expectedRevision, expectedVersion);
  const candidates = await selectCandidateFiles(options.root, options.paths, limits);

  const imported = await captureScannerOutput(() => import(pathToFileURL(scanner.modulePath).href));
  if (imported.error || imported.reported || typeof imported.value?.scan !== "function") {
    fail("scanner_import_failed");
  }

  const findings = [];
  const errors = [];
  for (const candidate of candidates.selected) {
    const scanned = await captureScannerOutput(() => imported.value.scan(candidate.absolute));
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
    if (!["--base", "--head", "--root", "--scanner-root", "--summary-file"].includes(name)) {
      fail("invalid_argument");
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail("missing_argument_value");
    result[name.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  if (!result.base || !result.head || !result.scanner_root) fail("missing_required_argument");
  return result;
}

function markdownSummary(report) {
  const lines = [
    "## Whitehack advisory",
    "",
    `- Status: \`${report.status}\``,
    `- Changed supported files observed: ${report.scope.candidate_count}`,
    `- Findings: ${report.summary.finding_count}`,
    `- Scanner: Whitehack ${report.scanner.version} at \`${report.scanner.revision.slice(0, 12)}\``,
    "",
    "This is a redacted heuristic observation, not a security proof or authorization to test a target.",
  ];
  const checks = Object.entries(report.summary.by_check);
  if (checks.length) {
    lines.push("", "| Check | Count |", "|---|---:|");
    for (const [check, count] of checks) lines.push(`| \`${check}\` | ${count} |`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const root = await realpath(resolve(args.root));
  verifyCheckedOutHead(root, args.base, args.head);
  const paths = listChangedPaths(root, args.base, args.head, DEFAULT_LIMITS);
  const report = await runAdvisory({
    root,
    paths,
    scanner_root: args.scanner_root,
    base: args.base,
    head: args.head,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (args.summary_file) await appendFile(args.summary_file, markdownSummary(report), "utf8");
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
