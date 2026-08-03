/** pretend probe — the rules, and the live instances.
 *
 *  Two halves, following `edge.test.ts`. Fixtures pin the classification, so
 *  a change to the rules is visible. The live half asserts against the real
 *  repository, because a probe proved only against fixtures is proved
 *  against a tidy world — and every finding this probe was written for came
 *  out of an untidy one.
 *
 *  The live assertions are also this probe's own falsifiability witness. It
 *  reports guards that never show their detector firing; a probe holding
 *  that shape while carrying only fixture tests would be the joke.
 */

import { expect, test } from "bun:test";

import { codeOnly, guardsIn, inFileTables, literalPatterns, readSurface, stripComments } from "../src/probes/pretend/guards.js";
import { BINDING_FORMS, render } from "../src/probes/pretend/binding-forms.js";
import { OPERATORS } from "../src/probes/pretend/mutants.js";
import { pretendProbe } from "../src/probes/pretend.js";
import { resolveScope } from "../src/scope.js";
import type { Finding } from "../src/types.js";
import { fixtureScope } from "./fixture-scope.js";

function at(findings: Finding[], file: string, needle: string): Finding | undefined {
  return findings.find((finding) => finding.file === file && finding.title.includes(needle));
}

/** A miniature of the shape this probe is aimed at: a shared helper, a guard
 *  with a "shared import" pattern and a "local definition" pattern, and a
 *  consumer that imports the helper. */
function shadowGuardFixture(detector: string): Record<string, string> {
  return {
    "pkg/src/_url.ts": "export function encodeSegment(value: string): string {\n  return encodeURIComponent(value);\n}\n",
    "pkg/src/traces.ts": [
      'import { encodeSegment } from "./_url.js";',
      "export class TracesClient {",
      "  get(id: string) {",
      "    return `/v1/traces/${encodeSegment(id)}`;",
      "  }",
      "}",
    ].join("\n"),
    "pkg/src/other.ts": ['import { thing as renamed } from "./_url.js";', "export const x = renamed;"].join("\n"),
    // Witnesses for the non-capturing forms. Without a real occurrence in
    // the corpus the probe refuses to assert the form at all, which is the
    // staleness check doing its job — so the fixture has to carry them.
    "pkg/src/holder.ts": [
      "export class Holder {",
      "  handler = (value: string): string => value;",
      "  plain(value: string): string {",
      "    return value;",
      "  }",
      "}",
      "export const table = {",
      "  entry: (value: string): string => value,",
      "};",
    ].join("\n"),
    "pkg/tests/url.test.ts": [
      'import { readdirSync, readFileSync } from "node:fs";',
      'const SRC = "pkg/src";',
      'const SHARED_ENCODER_IMPORT = /import\\s*\\{[^}]*\\bencodeSegment\\b[^}]*\\}\\s*from\\s*["\']\\.\\/_url\\.js["\']/;',
      `const LOCAL_ENCODER_DEFINITION = ${detector};`,
      "readdirSync(SRC);",
      "expect(SHARED_ENCODER_IMPORT.test(readFileSync(SRC))).toBe(true);",
      "expect(LOCAL_ENCODER_DEFINITION.test('')).toBe(false);",
    ].join("\n"),
  };
}

test("a detector that misses a form capturing a bare call is a gap", async () => {
  // Covers `function` and `const` and nothing else — so an import alias, the
  // form that leaves every call site spelled identically, walks through.
  const findings = await pretendProbe.run(
    fixtureScope(
      shadowGuardFixture(
        "/(?:^|\\n)[ \\t]*(?:function\\s+encodeSegment\\b|(?:const|let|var)\\s+encodeSegment\\b)/",
      ),
    ),
  );
  const finding = at(findings, "pkg/tests/url.test.ts", "does not match");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.evidence).toContain("ts/aliased-import");
  expect(finding?.evidence).toContain("import { laxSegment as encodeSegment }");
});

test("a form that does not capture a bare call is reported sound, not as a hole", async () => {
  // The known live instance, in miniature: a class-property arrow binds the
  // name and this detector misses it, and a bare call in the class still
  // resolves to the module import. Reporting that as exploitable would be a
  // finding nobody can act on.
  const findings = await pretendProbe.run(
    fixtureScope(
      shadowGuardFixture(
        "/(?:^|\\n)[ \\t]*(?:function\\s+encodeSegment\\b|(?:const|let|var)\\s+encodeSegment\\b|import\\s*\\{[^}]*as\\s+encodeSegment\\b)/",
      ),
    ),
  );
  const sound = at(findings, "pkg/tests/url.test.ts", "narrower than it claims");
  expect(sound?.verdict).toBe("sound");
  expect(sound?.evidence).toContain("ts/class-property-arrow");
  expect(at(findings, "pkg/tests/url.test.ts", "does not match")).toBeUndefined();
});

test("a fixture two guards generate cases from, with no floor, is a gap", async () => {
  const cases = JSON.stringify({ cases: Array.from({ length: 12 }, (_, index) => ({ id: index })) }, null, 2);
  const loader = (extra: string): string =>
    [
      'import { readFileSync } from "node:fs";',
      'const FIX = JSON.parse(readFileSync("../specs/vectors.json", "utf8"));',
      extra,
      "for (const entry of FIX.cases) {",
      "  test(`case ${entry.id}`, () => { expect(entry).toBeDefined(); });",
      "}",
    ].join("\n");
  const scope = fixtureScope({
    "specs/vectors.json": cases,
    "a/tests/one.test.ts": loader("expect(FIX.cases.length).toBeGreaterThan(0);"),
    "b/tests/two.test.ts": loader(""),
  });
  const finding = at(await pretendProbe.run(scope), "specs/vectors.json", "nothing pins the count");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.evidence).toContain("12 entries");
  expect(finding?.evidence).toContain("strongest lower bound found in any of them: 0");
});

test("a fixture whose loaders pin a real floor is sound", async () => {
  const cases = JSON.stringify({ cases: Array.from({ length: 12 }, (_, index) => ({ id: index })) }, null, 2);
  const loader = (extra: string): string =>
    [
      'import { readFileSync } from "node:fs";',
      'const FIX = JSON.parse(readFileSync("../specs/vectors.json", "utf8"));',
      extra,
      "for (const entry of FIX.cases) {",
      "  test(`case ${entry.id}`, () => { expect(entry).toBeDefined(); });",
      "}",
    ].join("\n");
  const scope = fixtureScope({
    "specs/vectors.json": cases,
    "a/tests/one.test.ts": loader("expect(FIX.cases.length).toBe(12);"),
    "b/tests/two.test.ts": loader(""),
  });
  const finding = at(await pretendProbe.run(scope), "specs/vectors.json", "is pinned at 12");
  expect(finding?.verdict).toBe("sound");
});

test("a file that greps for readFileSync is not mistaken for a file that calls it", () => {
  const scope = fixtureScope({
    "src/detector.ts": 'export const READS = /readFileSync|readdirSync/;\nexport function check(t: string) { if (!READS.test(t)) throw new Error("x"); }\nconst path = "src/detector.ts";\nvoid path;',
    "src/other.ts": "export const other = 1;",
  });
  expect(guardsIn(scope).map((guard) => guard.file)).toEqual([]);
  expect(/readFileSync/.test(codeOnly(scope.read("src/detector.ts") ?? ""))).toBe(false);
});

test("an apostrophe in a header comment does not swallow the path literal below it", () => {
  const source = [
    "/** This suite reads the shared fixture. It doesn't matter which SDK you",
    " *  hold; the bytes are the same. */",
    'const FIXTURE = new URL("../../specs/vectors.json", import.meta.url);',
    "readFileSync(FIXTURE);",
    "expect(1).toBe(1);",
  ].join("\n");
  const scope = fixtureScope({ "pkg/tests/load.test.ts": source, "specs/vectors.json": "{}" });
  expect(readSurface(scope, "pkg/tests/load.test.ts")).toContain("specs/vectors.json");
  expect(stripComments(source)).not.toContain("doesn't");
});

test("a python raw pattern keeps its backslashes", () => {
  const lines = ['LOCAL = re.compile(', '    r"^[ \\t]*def[ \\t]+_path_segment\\b",', "    re.M,", ")"];
  const [pattern] = literalPatterns(lines);
  expect(pattern?.dialect).toBe("py");
  expect(pattern?.flags).toContain("m");
  // Unescaping here would turn `\b` into `b` and measure a pattern nobody wrote.
  expect(pattern?.source).toContain("\\b");
  expect(new RegExp(pattern!.source, "m").test("    def _path_segment(value):")).toBe(true);
});

test("only a table that DECLARES cases counts as setting a guard's strength", () => {
  const scope = fixtureScope({
    "pkg/tests/a.test.ts": [
      'import { readdirSync } from "node:fs";',
      'const SRC = "pkg";',
      'const EXPECTED = ["a", "b", "c", "d", "e", "f"];',
      'test("one", () => { expect(readdirSync(SRC)).toEqual(EXPECTED); });',
    ].join("\n"),
    "pkg/tests/b.test.ts": [
      'import { readdirSync } from "node:fs";',
      'const SRC = "pkg";',
      "void readdirSync(SRC);",
      'const INPUTS = ["a", "b", "c", "d", "e", "f"];',
      "for (const input of INPUTS) {",
      '  test(`case ${input}`, () => { expect(readdirSync(input)).toBeDefined(); });',
      "}",
    ].join("\n"),
    "pkg/thing.ts": "export const thing = 1;",
  });
  const guards = guardsIn(scope);
  const names = guards.flatMap((guard) => inFileTables(scope, guard).map((table) => table.name));
  expect(names).toEqual(["INPUTS"]);
});

test("every binding form renders the symbol and declares whether it captures a bare call", () => {
  for (const form of BINDING_FORMS) {
    expect(render(form, "encodeSegment")).toContain("encodeSegment");
    expect(typeof form.shadowsBareCall).toBe("boolean");
    expect(form.why.length).toBeGreaterThan(20);
  }
  // Exactly one operator is the harness's own control.
  expect(OPERATORS.filter((operator) => operator.expectation === "control")).toHaveLength(1);
});

test("the probe declares limits and each one anchors somewhere real", () => {
  const scope = resolveScope();
  expect(pretendProbe.limits.length).toBeGreaterThan(0);
  for (const limit of pretendProbe.limits) {
    expect(scope.files).toContain(limit.file);
    expect(limit.line).toBeLessThanOrEqual(scope.lines(limit.file).length);
  }
});

// ── live repository ─────────────────────────────────────────────────────────

test("live: both url-encoding guards miss the aliased-import binding form", async () => {
  const findings = await pretendProbe.run(resolveScope());
  for (const guard of ["packages/sdk-ts/tests/url-encoding.test.ts", "packages/sdk-py/tests/test_url_encoding.py"]) {
    const finding = at(findings, guard, "does not match");
    expect(finding?.verdict).toBe("gap");
    expect(finding?.evidence).toContain("aliased-import");
    expect(finding?.evidence).toContain("LOCAL_ENCODER_DEFINITION");
  }
});

test("live: the TypeScript detector's class-property miss is recorded as sound", async () => {
  // The instance the brief names. It IS a binding the detector misses and it
  // is NOT reachable, and saying both is the finding.
  const findings = await pretendProbe.run(resolveScope());
  const finding = at(findings, "packages/sdk-ts/tests/url-encoding.test.ts", "narrower than it claims");
  expect(finding?.verdict).toBe("sound");
  expect(finding?.evidence).toContain("ts/class-property-arrow");
});

test("live: the shared canonical-bytes fixture sets its suites' coverage and nothing pins it", async () => {
  const findings = await pretendProbe.run(resolveScope());
  const finding = at(findings, "docs/specs/canonical-bytes-vectors.json", "nothing pins the count");
  expect(finding?.verdict).toBe("gap");
  expect(finding?.evidence).toContain("packages/sdk-ts/tests/canonical-vectors.test.ts");
  expect(finding?.evidence).toContain("packages/sdk-py/tests/test_canonical_vectors.py");
  expect(finding?.evidence).toContain("api/tests/canonical-vectors.test.ts");
});

test("live: rhizome's own source produces no gap from this probe", async () => {
  const findings = await pretendProbe.run(resolveScope());
  const own = findings.filter((finding) => finding.file.startsWith("packages/rhizome/") && finding.verdict === "gap");
  expect(own.map((finding) => `${finding.file}:${finding.line} ${finding.title}`)).toEqual([]);
});
