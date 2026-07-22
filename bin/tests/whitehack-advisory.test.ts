import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import {
  WHITEHACK_REVISION,
  WHITEHACK_VERSION,
  listChangedPaths,
  runAdvisory,
  selectCandidateFiles,
  verifyCheckedOutHead,
  type WhitehackAdvisoryError,
} from "../whitehack-advisory.mjs";

const cleanup: string[] = [];
const repoRoot = resolve(import.meta.dir, "../..");

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function temporaryRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(root);
  return root;
}

async function commitAll(root: string, message: string): Promise<string> {
  git(root, ["add", "."]);
  git(root, [
    "-c",
    "commit.gpgsign=false",
    "-c",
    "user.name=Whitehack Test",
    "-c",
    "user.email=whitehack@example.invalid",
    "commit",
    "-qm",
    message,
  ]);
  return git(root, ["rev-parse", "HEAD"]);
}

async function scannerFixture(
  source: string,
  version = WHITEHACK_VERSION,
): Promise<{ root: string; revision: string }> {
  const root = await temporaryRoot("whitehack-scanner-");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({ name: "whitehack", version, type: "module" }, null, 2)}\n`,
  );
  await writeFile(join(root, "src", "scan.js"), source);
  git(root, ["init", "-q", "-b", "main"]);
  return { root, revision: await commitAll(root, "test: scanner fixture") };
}

async function sourceFixture(): Promise<string> {
  const root = await temporaryRoot("whitehack-source-");
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "app.ts"), "export const value = 1;\n");
  return root;
}

afterAll(async () => {
  await Promise.all(cleanup.map((path) => rm(path, { recursive: true, force: true })));
});

describe("Whitehack advisory containment", () => {
  test("keeps the workflow and public docs on the bridge pin contract", async () => {
    expect(WHITEHACK_REVISION).toMatch(/^[0-9a-f]{40}$/);
    const workflow = await readFile(
      join(repoRoot, ".github", "workflows", "whitehack.yml"),
      "utf8",
    );
    const workflowPin = workflow.match(
      /repository:\s*cambridgetcg\/whitehack\s*\n\s*ref:\s*([A-Za-z0-9._-]+)/u,
    );
    expect(workflowPin?.[1]).toBe(WHITEHACK_REVISION);

    for (const path of ["docs/WHITEHACK.md", "apps/docs/whitehack.html"]) {
      const text = await readFile(join(repoRoot, path), "utf8");
      expect(text).toContain(WHITEHACK_REVISION);
      expect(text).toContain(WHITEHACK_VERSION);
    }
  });

  test("serializes metadata without source snippets, messages, or scanner secrets", async () => {
    const scanner = await scannerFixture(`
export async function scan() {
  return [{
    line: 7,
    check: "hardcoded-secret",
    title: "Hardcoded secret: fixture_sensitive_text_7f3a",
    confidence: "high",
    doctrine: "substrate-honesty",
    principle: 2,
    message: "credential fixture_sensitive_text_7f3a was found",
    snippet: "const token = 'fixture_sensitive_text_7f3a'",
  }];
}
`);
    const source = await sourceFixture();
    await writeFile(
      join(source, "src", "app.ts"),
      "\n\n\n\n\n\nexport const value = 1;\n",
    );
    const report = await runAdvisory({
      root: source,
      paths: ["src/app.ts"],
      scanner_root: scanner.root,
      expected_revision: scanner.revision,
      base: "a".repeat(40),
      head: "b".repeat(40),
    });

    expect(report.status).toBe("complete");
    expect(report.findings).toEqual([{
      file: "src/app.ts",
      line: 7,
      check: "hardcoded-secret",
      confidence: "high",
      doctrine: "substrate-honesty",
      principle: 2,
    }]);
    const serialized = JSON.stringify(report);
    const serializedFindings = JSON.stringify(report.findings);
    expect(serialized).not.toContain("fixture_sensitive_text_7f3a");
    expect(serializedFindings).not.toContain("snippet");
    expect(serializedFindings).not.toContain("message");
    expect(serializedFindings).not.toContain("title");
  });

  test("redacts every crypto-aware check to the same six metadata fields", async () => {
    const scanner = await scannerFixture(`
const checks = [
  ["hardcoded-secret", "high", 2],
  ["weak-crypto", "medium-high", 2],
  ["static-aead-nonce", "heuristic", 1],
  ["signature-fail-open", "medium-high", 2],
  ["webhook-reencoded-body", "heuristic", 1],
  ["signed-webhook-without-replay-guard", "heuristic", 4],
  ["wallet-key-egress", "medium-high", 2],
  ["wallet-direct-request-signing", "heuristic", 3],
  ["wallet-capability-unbounded", "heuristic", 3],
  ["wallet-broadcast-auto-retry", "heuristic", 2],
  ["unlimited-token-approval", "heuristic", 3],
];
export async function scan() {
  return checks.map(([check, confidence, principle]) => ({
    line: 1,
    check,
    confidence,
    doctrine: "substrate-honesty",
    principle,
    title: "fixture_crypto_private_marker_91c2",
    message: "fixture_crypto_private_marker_91c2",
    snippet: "fixture_crypto_private_marker_91c2",
  }));
}
`);
    const source = await sourceFixture();
    const report = await runAdvisory({
      root: source,
      paths: ["src/app.ts"],
      scanner_root: scanner.root,
      expected_revision: scanner.revision,
      base: "a".repeat(40),
      head: "b".repeat(40),
    });

    expect(report.status).toBe("complete");
    expect(report.findings).toHaveLength(11);
    expect(report.findings.map(({ check }) => check).sort()).toEqual([
      "hardcoded-secret",
      "weak-crypto",
      "static-aead-nonce",
      "signature-fail-open",
      "webhook-reencoded-body",
      "signed-webhook-without-replay-guard",
      "wallet-key-egress",
      "wallet-direct-request-signing",
      "wallet-capability-unbounded",
      "wallet-broadcast-auto-retry",
      "unlimited-token-approval",
    ].sort());
    for (const finding of report.findings) {
      expect(Object.keys(finding)).toEqual([
        "file",
        "line",
        "check",
        "confidence",
        "doctrine",
        "principle",
      ]);
    }
    const serialized = JSON.stringify(report);
    const serializedFindings = JSON.stringify(report.findings);
    expect(serialized).not.toContain("fixture_crypto_private_marker_91c2");
    expect(serializedFindings).not.toContain("snippet");
    expect(serializedFindings).not.toContain("message");
    expect(serializedFindings).not.toContain("title");
  });

  test("accepts every advisory v0.1 confidence label", async () => {
    const scanner = await scannerFixture(`
export async function scan() {
  return ["high", "medium-high", "medium", "heuristic"].map((confidence) => ({
    line: 1,
    check: \`confidence-\${confidence}\`,
    confidence,
    doctrine: "substrate-honesty",
    principle: 6,
    snippet: \`private_confidence_source_\${confidence}\`,
  }));
}
`);
    const source = await sourceFixture();
    const report = await runAdvisory({
      root: source,
      paths: ["src/app.ts"],
      scanner_root: scanner.root,
      expected_revision: scanner.revision,
      base: "a".repeat(40),
      head: "b".repeat(40),
    });

    expect(report.status).toBe("complete");
    expect(report.summary.by_confidence).toEqual({
      heuristic: 1,
      high: 1,
      medium: 1,
      "medium-high": 1,
    });
    expect(report.findings.map(({ confidence }) => confidence).sort()).toEqual(
      ["high", "medium-high", "medium", "heuristic"].sort(),
    );
    expect(JSON.stringify(report)).not.toContain("private_confidence_source");
  });

  test("marks a scanner console error incomplete without serializing its text", async () => {
    const scanner = await scannerFixture(`
export async function scan() {
  console.error("scanner accidentally emitted fixture_console_sensitive_7f3a");
  return [];
}
`);
    const source = await sourceFixture();
    const report = await runAdvisory({
      root: source,
      paths: ["src/app.ts"],
      scanner_root: scanner.root,
      expected_revision: scanner.revision,
      base: "a".repeat(40),
      head: "b".repeat(40),
    });

    expect(report.status).toBe("incomplete");
    expect(report.errors).toEqual([{ file: "src/app.ts", code: "scanner_file_incomplete" }]);
    expect(JSON.stringify(report)).not.toContain("fixture_console_sensitive_7f3a");
  });

  test("refuses a dirty scanner because its commit no longer binds executed bytes", async () => {
    const scanner = await scannerFixture("export async function scan() { return []; }\n");
    await appendFile(join(scanner.root, "src", "scan.js"), "// dirty\n");
    const source = await sourceFixture();

    await expect(runAdvisory({
      root: source,
      paths: ["src/app.ts"],
      scanner_root: scanner.root,
      expected_revision: scanner.revision,
      base: "a".repeat(40),
      head: "b".repeat(40),
    })).rejects.toMatchObject({ code: "scanner_not_clean" } satisfies Partial<WhitehackAdvisoryError>);
  });

  test("refuses a clean scanner whose package version misses the bridge default", async () => {
    const scanner = await scannerFixture(
      "export async function scan() { return []; }\n",
      "0.0.0",
    );
    const source = await sourceFixture();

    await expect(runAdvisory({
      root: source,
      paths: ["src/app.ts"],
      scanner_root: scanner.root,
      expected_revision: scanner.revision,
      base: "a".repeat(40),
      head: "b".repeat(40),
    })).rejects.toMatchObject({
      code: "scanner_version_mismatch",
    } satisfies Partial<WhitehackAdvisoryError>);
  });

  test("observes only bounded regular production files inside the repository", async () => {
    const root = await sourceFixture();
    await mkdir(join(root, "tests"), { recursive: true });
    await writeFile(join(root, "tests", "app.test.ts"), "test('fixture', () => {});\n");
    await writeFile(join(root, ".env"), "TOKEN=not-read\n");
    const outside = join(await temporaryRoot("whitehack-outside-"), "outside.ts");
    await writeFile(outside, "export const outside = true;\n");
    await symlink(outside, join(root, "src", "linked.ts"));

    const selected = await selectCandidateFiles(root, [
      "src/app.ts",
      "src/linked.ts",
      "tests/app.test.ts",
      ".env",
      "README.md",
    ]);

    expect(selected.selected.map(({ path }) => path)).toEqual(["src/app.ts"]);
    expect(selected.skipped).toEqual({
      hidden_path: 1,
      unsupported_extension: 1,
      non_regular_file: 1,
      non_production_path: 1,
    });
  });

  test("uses a NUL-delimited Git diff and leaves filtering to the bounded selector", async () => {
    const root = await sourceFixture();
    git(root, ["init", "-q", "-b", "main"]);
    const base = await commitAll(root, "test: base");
    await writeFile(join(root, "src", "app.ts"), "export const value = 2;\n");
    await mkdir(join(root, "tests"), { recursive: true });
    await writeFile(join(root, "tests", "new.test.ts"), "export const fixture = true;\n");
    const head = await commitAll(root, "test: change");

    expect(listChangedPaths(root, base, head)).toEqual(["src/app.ts", "tests/new.test.ts"]);
    const selected = await selectCandidateFiles(root, listChangedPaths(root, base, head));
    expect(selected.selected.map(({ path }) => path)).toEqual(["src/app.ts"]);
  });

  test("reports an explicit scoped zero when no changed path is eligible", async () => {
    const scanner = await scannerFixture("export async function scan() { return []; }\n");
    const source = await sourceFixture();
    await writeFile(join(source, "README.md"), "not scanned\n");

    const report = await runAdvisory({
      root: source,
      paths: ["README.md"],
      scanner_root: scanner.root,
      expected_revision: scanner.revision,
      base: "a".repeat(40),
      head: "b".repeat(40),
    });

    expect(report.status).toBe("complete");
    expect(report.scope.candidate_count).toBe(0);
    expect(report.scope.skipped).toEqual({ unsupported_extension: 1 });
    expect(report.summary.finding_count).toBe(0);
  });

  test("fails closed on malformed finding metadata without copying it", async () => {
    const scanner = await scannerFixture(`
export async function scan() {
  return [{
    line: 1,
    check: "bad\\nprivate_finding_text",
    confidence: "high",
    doctrine: "substrate-honesty",
    principle: 2,
    snippet: "private_finding_text",
  }];
}
`);
    const source = await sourceFixture();
    const report = await runAdvisory({
      root: source,
      paths: ["src/app.ts"],
      scanner_root: scanner.root,
      expected_revision: scanner.revision,
      base: "a".repeat(40),
      head: "b".repeat(40),
    });

    expect(report.status).toBe("incomplete");
    expect(report.findings).toEqual([]);
    expect(JSON.stringify(report)).not.toContain("private_finding_text");
  });

  test("suppresses scanner console output during module import", async () => {
    const scanner = await scannerFixture(`
console.warn("private_import_text");
export async function scan() { return []; }
`);
    const source = await sourceFixture();

    await expect(runAdvisory({
      root: source,
      paths: ["src/app.ts"],
      scanner_root: scanner.root,
      expected_revision: scanner.revision,
      base: "a".repeat(40),
      head: "b".repeat(40),
    })).rejects.toMatchObject({ code: "scanner_import_failed" } satisfies Partial<WhitehackAdvisoryError>);
  });

  test("suppresses direct scanner stdout and stderr writes", async () => {
    const scanner = await scannerFixture(`
export async function scan() {
  process.stdout.write("private_stdout_text");
  process.stderr.write("private_stderr_text");
  return [];
}
`);
    const source = await sourceFixture();
    const report = await runAdvisory({
      root: source,
      paths: ["src/app.ts"],
      scanner_root: scanner.root,
      expected_revision: scanner.revision,
      base: "a".repeat(40),
      head: "b".repeat(40),
    });

    expect(report.status).toBe("incomplete");
    expect(JSON.stringify(report)).not.toContain("private_stdout_text");
    expect(JSON.stringify(report)).not.toContain("private_stderr_text");
  });

  test("rejects control, bidi, overlong, and absolute candidate paths", async () => {
    const root = await sourceFixture();
    for (const path of [
      "src/bad\n::error::.ts",
      "src/bad\u202eevil.ts",
      `${"a".repeat(1_025)}.ts`,
      join(root, "src", "app.ts"),
    ]) {
      await expect(selectCandidateFiles(root, [path])).rejects.toMatchObject({
        code: "invalid_candidate_path",
      } satisfies Partial<WhitehackAdvisoryError>);
    }
  });

  test("accepts shell-like but non-control names without invoking a shell", async () => {
    const root = await sourceFixture();
    const path = "src/- space %,colon::error::.ts";
    await writeFile(join(root, path), "export const safe = true;\n");
    const selected = await selectCandidateFiles(root, [path]);
    expect(selected.selected.map((candidate) => candidate.path)).toEqual([path]);
  });

  test("fails closed when an eligible changed file is missing or invalid UTF-8", async () => {
    const root = await sourceFixture();
    await expect(selectCandidateFiles(root, ["src/missing.ts"])).rejects.toMatchObject({
      code: "candidate_missing_or_unreadable",
    } satisfies Partial<WhitehackAdvisoryError>);

    await writeFile(join(root, "src", "invalid.ts"), new Uint8Array([0xff, 0xfe]));
    await expect(selectCandidateFiles(root, ["src/invalid.ts"])).rejects.toMatchObject({
      code: "invalid_source_encoding",
    } satisfies Partial<WhitehackAdvisoryError>);
  });

  test("fails rather than truncating coverage or aggregate findings", async () => {
    const root = await sourceFixture();
    await writeFile(join(root, "src", "second.ts"), "ok\n");
    await expect(selectCandidateFiles(root, ["src/app.ts", "src/second.ts"], {
      max_changed_paths: 1,
    })).rejects.toMatchObject({
      code: "changed_path_count_limit_exceeded",
    } satisfies Partial<WhitehackAdvisoryError>);
    await expect(selectCandidateFiles(root, ["src/app.ts", "src/second.ts"], {
      max_files: 1,
    })).rejects.toMatchObject({
      code: "file_count_limit_exceeded",
    } satisfies Partial<WhitehackAdvisoryError>);

    const scanner = await scannerFixture(`
export async function scan() {
  return [1, 2].map((line) => ({
    line: 1,
    check: "bounded-check",
    confidence: "high",
    doctrine: "substrate-honesty",
    principle: 1,
  }));
}
`);
    await expect(runAdvisory({
      root,
      paths: ["src/app.ts"],
      scanner_root: scanner.root,
      expected_revision: scanner.revision,
      base: "a".repeat(40),
      head: "b".repeat(40),
      limits: { max_total_findings: 1 },
    })).rejects.toMatchObject({
      code: "finding_count_limit_exceeded",
    } satisfies Partial<WhitehackAdvisoryError>);
  });

  test("scans a rename destination, ignores a deletion, and binds diff to checkout HEAD", async () => {
    const root = await sourceFixture();
    await writeFile(join(root, "src", "removed.ts"), "export const removed = true;\n");
    git(root, ["init", "-q", "-b", "main"]);
    const base = await commitAll(root, "test: base");
    git(root, ["mv", "src/app.ts", "src/renamed.ts"]);
    git(root, ["rm", "-q", "src/removed.ts"]);
    const head = await commitAll(root, "test: rename and delete");

    expect(listChangedPaths(root, base, head)).toEqual(["src/renamed.ts"]);
    expect(() => verifyCheckedOutHead(root, base, head)).not.toThrow();
    expect(() => verifyCheckedOutHead(root, base, base)).toThrow();

    await appendFile(join(root, "src", "renamed.ts"), "// dirty tracked source\n");
    expect(() => verifyCheckedOutHead(root, base, head)).toThrow(/source_not_clean/);
  });

  test("rejects workflow-command and bidi filenames directly from Git diff", async () => {
    const root = await sourceFixture();
    git(root, ["init", "-q", "-b", "main"]);
    const base = await commitAll(root, "test: base");
    await writeFile(join(root, "src", "bad\n::error::.ts"), "export const bad = true;\n");
    await commitAll(root, "test: hostile path");
    const head = git(root, ["rev-parse", "HEAD"]);

    expect(() => listChangedPaths(root, base, head)).toThrow();
  });
});
