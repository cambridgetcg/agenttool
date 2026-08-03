/** edge probe — the classification, and the live instances.
 *
 *  Two halves. Fixtures pin the classification rules, so a change in the
 *  rules is visible. The live half asserts against the actual repository,
 *  because a probe proved only against fixtures is proved against a tidy
 *  world — and the four failures this probe exists for were all found in
 *  an untidy one.
 */

import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { edgeProbe } from "../src/probes/edge.js";
import { resolveScope } from "../src/scope.js";
import type { Finding } from "../src/types.js";
import { fixtureScope } from "./fixture-scope.js";

function at(findings: Finding[], file: string, needle: string): Finding | undefined {
  return findings.find((finding) => finding.file === file && finding.title.includes(needle));
}

test("a literal scope with no reason, no export and no test is a gap", async () => {
  const scope = fixtureScope({
    "src/scan.ts": ['const SCAN_DIRS = ["api/src", "bin"];', "readdirSync(SCAN_DIRS[0]);"].join("\n"),
    "api/src/thing.ts": "export const thing = 1;",
    "bin/tool.ts": "export const tool = 1;",
  });
  const findings = await edgeProbe.run(scope);
  const finding = at(findings, "src/scan.ts", "SCAN_DIRS");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.line).toBe(1);
  expect(finding?.detail).toContain("not exported");
  expect(finding?.detail).toContain("no stated reason");
  expect(finding?.detail).toContain("no test names it");
});

test("a literal scope that is exported, reasoned and named by a test is sound", async () => {
  const reason = [
    "/** Repo-relative roots the scan covers. Enumerated by sweeping the",
    " *  repository rather than by guess: strayFiles() fails a test when an",
    " *  annotated file turns up outside this list, so widening it is a",
    " *  deliberate decision rather than a default. */",
  ].join("\n");
  const scope = fixtureScope({
    "src/scan.ts": [reason, 'export const SCAN_ROOTS = ["api/src", "bin"];', "readdirSync(SCAN_ROOTS[0]);"].join("\n"),
    "tests/scan.test.ts": "import { SCAN_ROOTS } from '../src/scan.js';\nexpect(SCAN_ROOTS).toBeDefined();",
    "api/src/thing.ts": "export const thing = 1;",
    "bin/tool.ts": "export const tool = 1;",
  });
  const findings = await edgeProbe.run(scope);
  const finding = at(findings, "src/scan.ts", "SCAN_ROOTS");
  expect(finding?.verdict).toBe("sound");
  expect(finding?.evidence).toContain("tests/scan.test.ts");
});

test("a test that declares its own copy of the symbol does not count as naming it", async () => {
  const reason = "/** ".padEnd(100, "x") + " */";
  const scope = fixtureScope({
    "src/scan.ts": [reason, 'export const SCAN_ROOTS = ["api/src", "bin"];', "readdirSync(x);"].join("\n"),
    "tests/other.test.ts": 'const SCAN_ROOTS = ["api/src", "bin"];',
    "api/src/thing.ts": "1;",
    "bin/tool.ts": "1;",
  });
  const findings = await edgeProbe.run(scope);
  expect(at(findings, "src/scan.ts", "SCAN_ROOTS")?.verdict).toBe("gap");
});

test("a narrower private copy names the wider owner and the files it cannot see", async () => {
  const reason = [
    "/** Roots the bijection scans. Widened deliberately after the sweep",
    " *  found annotated files outside it; the sweep test is what forces",
    " *  the decision rather than defaulting it. */",
  ].join("\n");
  const scope = fixtureScope({
    "owner.ts": [reason, 'export const SCAN_ROOTS = ["api/src", "bin", "packages/x/src"];', "readdirSync(x);"].join("\n"),
    "tests/owner.test.ts": "import { SCAN_ROOTS } from '../owner.js';",
    "api/tests/copy.test.ts": ['const SCAN_DIRS = ["api/src", "bin"];', "readdirSync(SCAN_DIRS[0]);", 'if (/@enforces\\s+urn:x/.test(s)) {}'].join("\n"),
    "api/src/a.ts": "1;",
    "bin/b.ts": "1;",
    "packages/x/src/c.ts": "/** @enforces urn:x:wall/thing */",
  });
  const findings = await edgeProbe.run(scope);
  const finding = at(findings, "api/tests/copy.test.ts", "private, narrower copy");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.detail).toContain("packages/x/src");
  expect(finding?.evidence).toContain("packages/x/src/c.ts");
});

test("a closed union is measured against the urn vocabulary actually written down", async () => {
  const scope = fixtureScope({
    "src/kinds.ts": ['// urn:demo: kinds', 'export type Kind = "wall" | "commitment";'].join("\n"),
    "src/a.ts": "/** @enforces urn:demo:wall/one */",
    "src/b.ts": "/** @enforces urn:demo:commitment/two */",
    "src/c.ts": "/** @enforces urn:demo:promise/three */",
    "src/d.ts": "/** @enforces urn:demo:ring/four */",
  });
  const findings = await edgeProbe.run(scope);
  const finding = at(findings, "src/kinds.ts", "closes a vocabulary");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.evidence).toContain("urn:demo:promise/");
  expect(finding?.evidence).toContain("src/c.ts:1");
});

test("an extension filter is a gap only when the excluded carrier is never named", async () => {
  const walker = [
    "readdirSync(root);",
    'if (name.endsWith(".ts")) files.push(name);',
    'if (text.includes("@enforces")) hit();',
  ].join("\n");
  const scope = fixtureScope({
    "src/silent.ts": walker,
    "src/spoken.ts": `${walker}\n// ".sql" policies annotate walls; whether they count is an open question`,
    "src/covered.ts": "/** @enforces urn:demo:wall/x */",
    "migrations/one.sql": "-- @enforces urn:demo:wall/y",
  });
  const findings = await edgeProbe.run(scope);
  expect(at(findings, "src/silent.ts", "scanner reads only")?.verdict).toBe("gap");
  expect(at(findings, "src/spoken.ts", "names the carrier extensions")?.verdict).toBe("sound");
});

test("an allowlist entry whose path is gone is a gap; a live one is sound", async () => {
  const scope = fixtureScope({
    "src/rules.ts": ['const EXEMPT_PATHS = ["api/src/live.ts", "api/src/deleted.ts"];'].join("\n"),
    "src/ok.ts": 'const IGNORED_PATHS = ["api/src/live.ts"];',
    "api/src/live.ts": "1;",
  });
  const findings = await edgeProbe.run(scope);
  expect(at(findings, "src/rules.ts", "no longer exist")?.evidence).toBe("api/src/deleted.ts");
  expect(at(findings, "src/ok.ts", "still exists")?.verdict).toBe("sound");
});

test("mime types and tag tuples are not mistaken for repository paths", async () => {
  const scope = fixtureScope({
    "src/mid.ts": 'const SKIP_CONTENT_TYPES = ["text/event-stream", "application/octet-stream"];',
    "src/tags.ts": 'const KNOWN_MAPPINGS = [["dignity-distinctness", "safety-care"], ["rest-play-limits"]];',
    "api/src/x.ts": "1;",
  });
  const findings = await edgeProbe.run(scope);
  expect(findings.filter((finding) => finding.file.startsWith("src/"))).toEqual([]);
});

test("the workspace-member check counts the whole file, and respects path boundaries", async () => {
  const scope = fixtureScope({
    "packages/a/package.json": "{}",
    "packages/b/package.json": "{}",
    "packages/b-extra/package.json": "{}",
    "packages/c/pyproject.toml": "",
    "packages/d/package.json": "{}",
    "run.sh": [
      "cd packages/a && test",
      "cd packages/b-extra && test",
      "cd packages/c && test",
      "cd packages/d && test",
    ].join("\n"),
  });
  const findings = await edgeProbe.run(scope);
  const finding = at(findings, "run.sh", "workspace members");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.title).toContain("4 of 5");
  // packages/b is missing even though packages/b-extra is present: a
  // substring match would have reported the set as complete.
  expect(finding?.evidence).toContain("packages/b/");
  expect(finding?.evidence).not.toContain("packages/b-extra/");
});

test("a skip-list is measured against the ignore rules the repository declares", async () => {
  const root = await mkdtemp(join(tmpdir(), "agenttool-rhizome-skip-"));
  try {
    await mkdir(join(root, "coverage"));
    const narrow = ['const SKIP_DIRS = new Set(["node_modules", "dist"]);', "readdirSync(root);"].join("\n");
    const wide = ['const SKIP_DIRS = new Set(["node_modules", "dist", "coverage"]);', "readdirSync(root);"].join("\n");
    const scope = fixtureScope(
      { ".gitignore": "node_modules/\ndist/\ncoverage/\n", "src/narrow.ts": narrow, "src/wide.ts": wide },
      { root },
    );
    const findings = await edgeProbe.run(scope);
    const gap = at(findings, "src/narrow.ts", "walks into");
    expect(gap?.verdict).toBe("gap");
    expect(gap?.evidence).toContain("coverage/");
    // node_modules and dist are ignored too, but do not exist under this
    // root, so the check does not claim them.
    expect(gap?.title).toContain("1 directory");
    expect(at(findings, "src/wide.ts", "covers every directory")?.verdict).toBe("sound");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("live repository: the annotation sweep's private skip-list is reported", async () => {
  const findings = await edgeProbe.run(resolveScope());
  const finding = at(findings, "api/src/services/canon/annotations.ts", "SKIP_DIRS walks into");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.evidence).toContain(".claude/");
});

test("every probe limit names a file that exists", async () => {
  const scope = resolveScope();
  for (const limit of edgeProbe.limits) {
    expect(scope.files).toContain(limit.file);
  }
});

test("live repository: the known private copies of the annotation scan are found", async () => {
  const findings = await edgeProbe.run(resolveScope());

  for (const file of [
    "api/tests/doctrine/polymorph-ratchet.test.ts",
    "api/tests/doctrine/rings-code-annotation-bijection.test.ts",
  ]) {
    const finding = at(findings, file, "SCAN_DIRS");
    expect(finding, `${file} should report a private scope copy`).toBeDefined();
    expect(finding?.verdict).toBe("gap");
    expect(finding?.detail).toContain("api/src/services/canon/annotations.ts");
    expect(finding?.detail).toContain("packages/scriptwriter/src");
  }

  const owner = at(findings, "api/src/services/canon/annotations.ts", "SCAN_ROOTS");
  expect(owner?.verdict).toBe("sound");

  const union = at(findings, "api/src/services/canon/annotations.ts", "AnnotatedKind");
  expect(union?.verdict).toBe("gap");
  expect(union?.evidence).toContain("urn:agenttool:promise/");
});

test("live repository: rhizome's own source produces no gap", async () => {
  const findings = await edgeProbe.run(resolveScope());
  const own = findings.filter((finding) => finding.file.startsWith("packages/rhizome/") && finding.verdict === "gap");
  expect(own.map((finding) => `${finding.file}:${finding.line} ${finding.title}`)).toEqual([]);
});
