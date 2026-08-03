/** decay probe — the readings, and the live accommodations.
 *
 *  Two halves, the same split the `edge` tests use. Fixtures pin each
 *  reading so a change to the rules is visible in the diff. The live half
 *  asserts against the real repository, because an accommodation only
 *  looks permanent from inside a tidy world — and every instance this
 *  probe exists for was found in an untidy one.
 *
 *  The live assertions name real files on purpose. If one of them stops
 *  matching because somebody closed the debt, that is the correct
 *  failure: the test says "this was true on the day it was written", and
 *  a decay probe whose own assertions never expire would be the joke.
 */

import { expect, test } from "bun:test";

import { decayProbe } from "../src/probes/decay.js";
import { compareVersions, daysBetween, governingVersion, repositoryClock } from "../src/probes/decay/clock.js";
import { argumentVocabulary, callSites } from "../src/probes/decay/reach.js";
import { jsonStringFields, recordCollections } from "../src/probes/decay/records.js";
import { shellArrays } from "../src/probes/decay/shell.js";
import { resolveScope } from "../src/scope.js";
import type { Finding, Scope } from "../src/types.js";
import { fixtureScope } from "./fixture-scope.js";

function at(findings: Finding[], file: string, needle: string): Finding | undefined {
  return findings.find((finding) => finding.file === file && finding.title.includes(needle));
}

function anyTitled(findings: Finding[], needle: string): Finding | undefined {
  return findings.find((finding) => finding.title.includes(needle));
}

/** The live corpus, resolved once. Two derivations over ~2,800 files is
 *  not free, and every live assertion below asks the same question of the
 *  same tree. */
let liveScope: Scope | undefined;
let liveFindings: Finding[] | undefined;
async function live(): Promise<Finding[]> {
  if (liveFindings === undefined) {
    liveScope ??= resolveScope();
    liveFindings = await decayProbe.run(liveScope);
  }
  return liveFindings;
}

// ── the readings ─────────────────────────────────────────────────────────

test("every finding carries one of the three decay readings, and the mapping holds", async () => {
  const findings = await live();
  expect(findings.length).toBeGreaterThan(0);
  for (const finding of findings) {
    const match = /^decay: (compostable|load-bearing-despite-appearance|owed) — /.exec(finding.detail ?? "");
    expect(match, `${finding.file}:${finding.line} ${finding.title}`).not.toBeNull();
    const reading = match?.[1];
    if (reading === "load-bearing-despite-appearance") expect(finding.verdict).toBe("sound");
    else expect(finding.verdict).toBe("gap");
  }
});

// ── check 1: held-back inventories ───────────────────────────────────────

const RUNNER = [
  "# Tests held back from the default tier.",
  "readonly QUARANTINED=(",
  "  tests/alpha.test.ts",
  "  tests/beta.test.ts",
  ")",
  "",
  "classify() {",
  '  if in_list "$path" "${QUARANTINED[@]}"; then',
  "    echo quarantine",
  "  else",
  "    echo hermetic",
  "  fi",
  "}",
].join("\n");

test("a held-back list whose gate token nothing passes is owed", async () => {
  const scope = fixtureScope({
    "bin/run.sh": RUNNER,
    "bin/gate.sh": "bash bin/run.sh hermetic\nbash bin/run.sh quarantine\n",
    "ci.yml": "steps:\n  - run: bash bin/gate.sh hermetic\n",
    "api/tests/alpha.test.ts": 'test("alpha", () => {});',
    "api/tests/beta.test.ts": 'test("beta", () => {});',
  });
  const findings = await decayProbe.run(scope);
  const finding = at(findings, "bin/run.sh", "reachable only through a mode");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.detail).toContain("decay: owed");
  expect(finding?.evidence).toContain("bin/gate.sh:2");
  expect(finding?.evidence).toContain("ci.yml:2");
  expect(finding?.evidence).toContain("arguments they do not pass: quarantine");
});

test("the same list becomes load-bearing the moment something passes the token", async () => {
  const scope = fixtureScope({
    "bin/run.sh": RUNNER,
    "bin/gate.sh": "bash bin/run.sh hermetic\nbash bin/run.sh quarantine\n",
    "ci.yml": "steps:\n  - run: bash bin/gate.sh quarantine\n",
    "api/tests/alpha.test.ts": 'test("alpha", () => {});',
    "api/tests/beta.test.ts": 'test("beta", () => {});',
  });
  const findings = await decayProbe.run(scope);
  expect(at(findings, "bin/run.sh", "reachable only through a mode")).toBeUndefined();
  expect(at(findings, "bin/run.sh", "is reachable: something passes")?.verdict).toBe("sound");
});

test("a held-back entry whose file is gone is compostable", async () => {
  const scope = fixtureScope({
    "bin/run.sh": RUNNER.replace("  tests/beta.test.ts", "  tests/beta.test.ts\n  tests/removed.test.ts"),
    "bin/gate.sh": "bash bin/run.sh quarantine\n",
    "api/tests/alpha.test.ts": 'test("alpha", () => {});',
    "api/tests/beta.test.ts": 'test("beta", () => {});',
  });
  const findings = await decayProbe.run(scope);
  const finding = at(findings, "bin/run.sh", "that no longer exist");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.detail).toContain("decay: compostable");
  expect(finding?.evidence).toContain("tests/removed.test.ts");
});

test("two copies of one held-back list are compared, and their difference is the finding", async () => {
  const shared = ["  tests/alpha.test.ts", "  tests/beta.test.ts", "  tests/gamma.test.ts"];
  const scope = fixtureScope({
    "bin/run.sh": ["# held back", "readonly SKIPPED_TESTS=(", ...shared, ")", 'in_list "$p" "${SKIPPED_TESTS[@]}"'].join("\n"),
    "bin/tests/gate.test.ts": [
      "const SKIPPED = [",
      '  "tests/alpha.test.ts",',
      '  "tests/beta.test.ts",',
      '  "tests/gamma.test.ts",',
      '  "tests/delta.test.ts",',
      "];",
    ].join("\n"),
    "api/tests/alpha.test.ts": "1;",
    "api/tests/beta.test.ts": "1;",
    "api/tests/gamma.test.ts": "1;",
    "api/tests/delta.test.ts": "1;",
  });
  const findings = await decayProbe.run(scope);
  const finding = anyTitled(findings, "are copies of one held-back list");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.evidence).toContain("api/tests/delta.test.ts");
  expect(finding?.evidence).not.toContain("api/tests/alpha.test.ts");
});

// ── check 2: exemptions and their stated conditions ──────────────────────

const EXEMPTION = (reason: string): Record<string, string> => ({
  "src/rules.ts": [
    "const FUNCTION_EXEMPTIONS = [",
    `  { subject: "alpha.ts", reason: ${JSON.stringify(reason)} },`,
    "];",
  ].join("\n"),
  "src/alpha.ts": "export function renderAlpha() {}\n",
});

test("an exemption whose reason names something in the tree is load-bearing, not debt", async () => {
  const findings = await decayProbe.run(fixtureScope(EXEMPTION("renderAlpha is language-idiomatic and stays uneven.")));
  const finding = at(findings, "src/rules.ts", "still names something that exists");
  expect(finding?.verdict).toBe("sound");
  expect(finding?.detail).toContain("decay: load-bearing-despite-appearance");
  expect(finding?.evidence).toContain("renderAlpha");
});

test("an exemption whose reason names something gone is owed", async () => {
  const findings = await decayProbe.run(fixtureScope(EXEMPTION("renderGamma is language-idiomatic and stays uneven.")));
  const finding = at(findings, "src/rules.ts", "naming something no longer in the repository");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.detail).toContain("decay: owed");
  expect(finding?.evidence).toContain("renderGamma");
});

test("a shape in backticks is not a referent — a form is not a thing", async () => {
  const findings = await decayProbe.run(
    fixtureScope({
      "src/rules.ts": [
        "const DELIBERATE_EXCEPTIONS = [",
        '  { subject: "alpha.ts", reason: "only vocabularies spelled `urn:<ns>:<kind>/` are read; renderAlpha covers the rest." },',
        "];",
      ].join("\n"),
      "src/alpha.ts": "export function renderAlpha() {}\n",
    }),
  );
  expect(at(findings, "src/rules.ts", "naming something no longer")).toBeUndefined();
  expect(at(findings, "src/rules.ts", "still names something that exists")?.verdict).toBe("sound");
});

// ── check 3: ratchets ────────────────────────────────────────────────────

const MANIFEST = (extra: string, total: number): string =>
  `{\n  "_comment": "Accepted gaps. This list may only SHRINK.",${extra}\n  "_total": ${total},\n  "wall": ["a", "b", "c"]\n}`;

test("a monotonic claim with no recorded prior position is owed", async () => {
  const findings = await decayProbe.run(fixtureScope({ "data/manifest.json": MANIFEST("", 3) }));
  const finding = at(findings, "data/manifest.json", "claims a direction it records no position for");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.detail).toContain("decay: owed");
  expect(finding?.evidence).toContain("no field or constant in this file records a previous value");
});

test("a manifest that records where it was is not reported", async () => {
  const findings = await decayProbe.run(fixtureScope({ "data/manifest.json": MANIFEST('\n  "previous_total": 5,', 3) }));
  expect(at(findings, "data/manifest.json", "claims a direction")).toBeUndefined();
});

test("a self-reported total is checked against the arrays the file carries", async () => {
  const agree = await decayProbe.run(fixtureScope({ "data/manifest.json": MANIFEST("", 3) }));
  expect(at(agree, "data/manifest.json", "reports 3 entries and carries 3")?.verdict).toBe("sound");

  const disagree = await decayProbe.run(fixtureScope({ "data/manifest.json": MANIFEST("", 9) }));
  expect(at(disagree, "data/manifest.json", "reports 9 entries and carries 3")?.verdict).toBe("gap");
});

test("a direction claim about something the file does not hold is not a ratchet", async () => {
  const findings = await decayProbe.run(
    fixtureScope({
      "src/loop.ts": ["/** State NEVER regresses. Append-only against the state space. */", "export const loop = 1;"].join("\n"),
    }),
  );
  expect(at(findings, "src/loop.ts", "claims a direction")).toBeUndefined();
});

test("a one-way numeric bound names the comparison that only fires upward", async () => {
  const findings = await decayProbe.run(
    fixtureScope({
      "tests/wall.test.ts": [
        "// Ratchet: the count must stay ≤ the baseline; the baseline never regresses.",
        "const HAND_ROLLED_BASELINE = 410;",
        'const items = ["a", "b", "c"];',
        "expect(handRolled <= HAND_ROLLED_BASELINE).toBe(true);",
      ].join("\n"),
    }),
  );
  const finding = at(findings, "tests/wall.test.ts", "HAND_ROLLED_BASELINE = 410 is a bound only a human can lower");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.evidence).toContain("handRolled <= HAND_ROLLED_BASELINE");
});

// ── check 5: deprecations ────────────────────────────────────────────────

test("a deprecation past its own removal version is owed; before it, nothing", async () => {
  const past = await decayProbe.run(
    fixtureScope({
      "pkg/package.json": '{\n  "name": "x",\n  "version": "1.4.0"\n}',
      "pkg/src/old.ts": "/** @deprecated scheduled for removal in 1.0.0 */\nexport const old = 1;\n",
    }),
  );
  const finding = at(past, "pkg/src/old.ts", "removal was scheduled for 1.0.0");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.evidence).toContain("pkg/package.json:3");

  const future = await decayProbe.run(
    fixtureScope({
      "pkg/package.json": '{\n  "name": "x",\n  "version": "1.4.0"\n}',
      "pkg/src/old.ts": "/** @deprecated scheduled for removal in 2.0.0 */\nexport const old = 1;\n",
    }),
  );
  expect(at(future, "pkg/src/old.ts", "removal was scheduled")).toBeUndefined();
});

// Regression: the first integrated run reported "10 @deprecated sites with
// no removal condition", and four of the ten were this probe's own detector
// — a regex literal, a template string and a sentence about the tag. A probe
// about things kept alive past their condition inflating its own count with
// its own source is the pathology, not a rounding error.
test("a @deprecated tag that is quoted, not declared, is not a deprecation site", async () => {
  const findings = await decayProbe.run(
    fixtureScope({
      "pkg/package.json": '{\n  "name": "x",\n  "version": "1.4.0"\n}',
      "pkg/src/detector.ts": [
        "// Only the `@deprecated` tag counts here, not prose about it.",
        'const TAG = /@deprecated|\\bdeprecated\\b/;',
        "const title = `${n} @deprecated site(s) found`;",
        "export const x = 1;",
      ].join("\n"),
      "pkg/src/real.ts": "/** @deprecated kept for old callers. */\nexport const old = 1;\n",
    }),
  );
  const finding = findings.find((item) => item.title.includes("@deprecated site(s)"));
  expect(finding?.evidence).toContain("pkg/src/real.ts:1");
  expect(finding?.evidence).not.toContain("pkg/src/detector.ts");
  expect(finding?.title).toContain("1 @deprecated site(s)");
});

test("a removal note whose subject is already gone is compostable, not owed", async () => {
  const findings = await decayProbe.run(
    fixtureScope({
      "pkg/package.json": '{\n  "name": "x",\n  "version": "1.4.0"\n}',
      "pkg/GUIDE.md": "  verify.ts   — VerifyClient (deprecated — endpoint dropped, removal in 1.0.0)\n",
    }),
  );
  const finding = at(findings, "pkg/GUIDE.md", "the file is already gone");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.detail).toContain("decay: compostable");
  expect(finding?.evidence).toContain("verify.ts → no file in the corpus");
});

// ── check 6: skipped tests ───────────────────────────────────────────────

test("a skip justified by a test that is itself skipped is owed", async () => {
  const findings = await decayProbe.run(
    fixtureScope({
      "api/tests/one.test.ts": [
        "// SKIP: the worker is correct; coverage lives in two.test.ts once the",
        "// two-instance harness lands.",
        'test.skip("clears the error", () => {});',
      ].join("\n"),
      "api/tests/two.test.ts": ["// SKIP: needs two databases.", 'test.skip("end to end", () => {});'].join("\n"),
    }),
  );
  const finding = at(findings, "api/tests/one.test.ts", "justified by a test that is itself skipped");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.evidence).toContain("api/tests/two.test.ts");
});

test("a skip whose substitute actually runs is recorded as a known cost, not a gap", async () => {
  const findings = await decayProbe.run(
    fixtureScope({
      "api/tests/one.test.ts": [
        "// SKIP: coverage lives in two.test.ts, which exercises the same path.",
        'test.skip("clears the error", () => {});',
      ].join("\n"),
      "api/tests/two.test.ts": 'test("end to end", () => {});',
    }),
  );
  expect(at(findings, "api/tests/one.test.ts", "justified by a test that is itself skipped")).toBeUndefined();
  expect(at(findings, "api/tests/one.test.ts", "reason whose subjects are all still in the tree")?.verdict).toBe("sound");
});

test("a skip with no reason at all is owed, and only test files are read for skips", async () => {
  const findings = await decayProbe.run(
    fixtureScope({
      "api/tests/one.test.ts": 'test.skip("clears the error", () => {});',
      "src/detector.ts": 'const PATTERN = /test\\.skip\\s*\\(\\s*["\'`]/;\nexport { PATTERN };',
    }),
  );
  expect(at(findings, "api/tests/one.test.ts", "no stated reason")?.verdict).toBe("gap");
  expect(findings.some((finding) => finding.file === "src/detector.ts")).toBe(false);
});

// ── the readers ──────────────────────────────────────────────────────────

test("shellArrays keeps entry line numbers and the comment block above a group", () => {
  const source = [
    "# Held back because they are red.",
    "readonly QUARANTINED=(",
    "  tests/a.test.ts",
    "",
    "  # Second group, different reason.",
    "  tests/b.test.ts",
    ")",
    "OTHER=(x y)",
    "UNCLOSED=(",
    "  z",
  ].join("\n");
  const arrays = shellArrays(source.split("\n"));
  expect(arrays.map((array) => array.name)).toEqual(["QUARANTINED", "OTHER"]);
  const quarantined = arrays[0]!;
  expect(quarantined.readonlyDeclared).toBe(true);
  expect(quarantined.comment).toBe("Held back because they are red.");
  expect(quarantined.entries.map((entry) => [entry.value, entry.line])).toEqual([
    ["tests/a.test.ts", 3],
    ["tests/b.test.ts", 6],
  ]);
  expect(quarantined.entries[1]!.comment).toBe("Second group, different reason.");
  expect(arrays[1]!.entries.map((entry) => entry.value)).toEqual(["x", "y"]);
});

test("recordCollections keeps fields apart instead of joining them", () => {
  const source = [
    "const EXEMPTIONS = [",
    "  {",
    '    py: "soul",',
    "    ts: null,",
    '    reason: "ships the doctrine as data",',
    "  },",
    '  { py: "welcome", ts: null, reason: "same reason as soul()" },',
    "];",
  ].join("\n");
  const collections = recordCollections(source.split("\n"));
  expect(collections).toHaveLength(1);
  expect(collections[0]!.records).toHaveLength(2);
  const first = collections[0]!.records[0]!;
  expect(first.fields.map((field) => field.key)).toEqual(["py", "reason"]);
  expect(first.fields.find((field) => field.key === "reason")?.value).toBe("ships the doctrine as data");
  expect(collections[0]!.records[1]!.line).toBe(7);
});

test("jsonStringFields finds keys by predicate, with their line", () => {
  const source = ['{', '  "sdk_ts_skip": "no TypeScript implementation",', '  "name": "x"', "}"].join("\n");
  const fields = jsonStringFields(source.split("\n"), (key) => key.endsWith("_skip"));
  expect(fields).toEqual([{ key: "sdk_ts_skip", value: "no TypeScript implementation", line: 2 }]);
});

test("the clock is the newest date the tree writes into its own filenames", () => {
  const scope = fixtureScope({
    "api/migrations/20260101T000000_a.sql": "-- a",
    "api/migrations/20260723T210000_b.sql": "-- b",
    "docs/2025-01-01-note.md": "note",
    "src/index.ts": "1;",
  });
  const clock = repositoryClock(scope);
  expect(clock.date).toBe("2026-07-23");
  expect(clock.source).toBe("api/migrations/20260723T210000_b.sql");
  expect(clock.observations).toBe(3);
  expect(daysBetween("2026-06-11", "2026-07-23")).toBe(42);
});

test("a repository with no dated filename has no clock, and says so", async () => {
  const findings = await decayProbe.run(fixtureScope({ "src/index.ts": "export const x = 1;" }));
  const finding = anyTitled(findings, "no dated filename");
  expect(finding?.verdict).toBe("limit");
});

test("versions compare numerically, so 0.7.0 is behind 0.16.0", () => {
  expect(compareVersions("0.16.0", "0.7.0")).toBeGreaterThan(0);
  expect(compareVersions("0.7.0", "0.16.0")).toBeLessThan(0);
  expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
});

test("the governing version is the nearest manifest above the file", () => {
  const scope = fixtureScope({
    "package.json": '{ "version": "9.9.9" }',
    "packages/a/package.json": '{\n  "version": "0.16.0"\n}',
    "packages/a/src/thing.ts": "1;",
  });
  const governing = governingVersion(scope, "packages/a/src/thing.ts");
  expect(governing).toEqual({ version: "0.16.0", manifest: "packages/a/package.json", line: 2 });
});

test("invocation reads arguments off the line and ignores documentation", () => {
  const scope = fixtureScope({
    "bin/run.sh": "echo hi",
    "bin/gate.sh": "# see bin/run.sh quarantine for the diagnostic mode\nbash bin/run.sh hermetic\n",
    "README.md": "Run `bash bin/run.sh quarantine` when triaging.",
  });
  const sites = callSites(scope, "bin/run.sh");
  expect(sites.map((site) => `${site.file}:${site.line}`)).toEqual(["bin/gate.sh:2"]);
  expect(argumentVocabulary(sites)).toEqual(["hermetic"]);
});

// ── the live repository ──────────────────────────────────────────────────

test("live: the quarantine list is held by a gate that runs and released by one nothing invokes", async () => {
  const findings = await live();
  const finding = findings.find(
    (item) => item.file === "bin/run-test-tier.sh" && item.title.includes("QUARANTINED_DOCTRINE_TESTS is reachable only"),
  );
  expect(finding?.verdict).toBe("gap");
  expect(finding?.evidence).toContain("bin/preflight.sh");
  expect(finding?.evidence).toContain(".github/workflows/ci.yml");
});

test("live: the two copies of the doctrine quarantine list disagree by the tests that were re-armed", async () => {
  const finding = anyTitled(await live(), "are copies of one held-back list");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.evidence).toContain("bin/run-test-tier.sh");
  expect(finding?.evidence).toContain("bin/tests/boring-spine-gate.test.ts");
  expect(finding?.evidence).toContain("walls-code-annotation-bijection.test.ts");
});

test("live: the shrink-only manifest records no position to shrink from", async () => {
  const finding = (await live()).find(
    (item) => item.file === "api/tests/doctrine/canon-code-gap.manifest.json" && item.title.includes("claims a direction"),
  );
  expect(finding?.verdict).toBe("gap");
  expect(finding?.evidence).toContain("may only SHRINK");
  expect(finding?.evidence).toContain("--write-manifest");
});

test("live: the hand-rolled error baseline is a bound only a human can lower", async () => {
  const finding = anyTitled(await live(), "HAND_ROLLED_BASELINE");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.file).toBe("api/tests/doctrine/wall-refusals-as-moments.test.ts");
});

test("live: the failure baseline is measured against the tree's own clock, not the reader's", async () => {
  const findings = await live();
  const age = findings.find(
    (item) => item.file === "api/tests/.failure-baseline.txt" && item.title.includes("was captured"),
  );
  expect(age?.verdict).toBe("gap");
  expect(age?.title).toMatch(/captured \d+ days before/);

  // The other half of the same register: its entries all still name a real
  // test title, so it has not gone decorative in the usual way.
  const named = findings.find(
    (item) => item.file === "api/tests/.failure-baseline.txt" && item.title.includes("still names something written"),
  );
  expect(named?.verdict).toBe("sound");
});

test("live: a skip in the API suite is justified by a test that is itself skipped", async () => {
  const findings = (await live()).filter((item) => item.title.includes("justified by a test that is itself skipped"));
  expect(findings.length).toBeGreaterThan(0);
  expect(findings.map((item) => item.file)).toContain("api/tests/covenants-reverify.test.ts");
});

test("live: a module scheduled for removal at 0.7.0 is still documented at 0.16.0", async () => {
  const findings = await live();
  const owed = findings.find((item) => item.title.includes("removal was scheduled for 0.7.0"));
  expect(owed?.verdict).toBe("gap");
  expect(owed?.file.startsWith("packages/sdk-")).toBe(true);
});

test("live: the SDK exemption lists are load-bearing, and rhizome says so by name", async () => {
  const findings = await live();
  for (const file of [
    "packages/sdk-ts/scripts/check-parity.ts",
    "packages/sdk-ts/tests/url-encoding.test.ts",
    "packages/sdk-ts/tests/error-surface-matrix.test.ts",
    "docs/specs/behaviour-conformance.json",
  ]) {
    const finding = findings.find((item) => item.file === file && item.title.includes("still names something that exists"));
    expect(finding?.verdict, file).toBe("sound");
  }
});

test("live: decay's own source and helpers produce no gap against decay", async () => {
  const own = (await live()).filter(
    (finding) =>
      finding.verdict === "gap" &&
      (finding.file === "packages/rhizome/src/probes/decay.ts" ||
        finding.file.startsWith("packages/rhizome/src/probes/decay/") ||
        finding.file === "packages/rhizome/tests/decay.test.ts"),
  );
  expect(own.map((finding) => `${finding.file}:${finding.line} ${finding.title}`)).toEqual([]);

  // And it is not by exemption: this probe's own declared limits are read
  // back out of the tree and their referents checked like anyone else's.
  const checked = (await live()).find(
    (finding) => finding.file === "packages/rhizome/src/probes/decay.ts" && finding.title.includes("LIMITS"),
  );
  expect(checked?.verdict).toBe("sound");
});

test("the probe declares its boundaries, and each one resolves in the corpus", async () => {
  expect(decayProbe.limits.length).toBeGreaterThan(0);
  liveScope ??= resolveScope();
  for (const limit of decayProbe.limits) {
    expect(liveScope.files, limit.statement).toContain(limit.file);
    expect(limit.why.length, limit.statement).toBeGreaterThan(20);
    expect(limit.line, limit.statement).toBeLessThanOrEqual(liveScope.lines(limit.file).length);
  }
});
