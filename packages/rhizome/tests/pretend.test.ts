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
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  codeOnly,
  generatesCases,
  guardsIn,
  inFileTables,
  literalPatterns,
  readSurface,
  stripComments,
} from "../src/probes/pretend/guards.js";
import { LINKED_BACK, LINKED_BACK_PHRASE, notCopiedDirectories } from "../src/probes/pretend/harness.js";
import { BINDING_FORMS, render } from "../src/probes/pretend/binding-forms.js";
import { OPERATORS } from "../src/probes/pretend/mutants.js";
import { MUTATE_ENV, pretendProbe } from "../src/probes/pretend.js";
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

// ── the falsifiability check, and what replaced it ──────────────────────────

test("no static verdict about a guard's falsifiability is derived from its prose", async () => {
  // The check that used to live here read a fixed list of English phrasings
  // — "can still fail", "still sees" — out of the guard's whole file text,
  // comments included, and issued `sound` or `gap` from that. It was wrong
  // in both directions. Both of those are now silence, and the question is
  // answered by executing a mutant instead.
  const scanner = (comment: string, control: string): Record<string, string> => ({
    "pkg/src/thing.ts": "export const thing = 1;\n",
    "pkg/tests/scan.test.ts": [
      'import { readdirSync, readFileSync } from "node:fs";',
      `// ${comment}`,
      'const SRC = "pkg/src";',
      "const FORBIDDEN_CALL = /\\bdangerousCall\\s*\\(/;",
      "for (const file of readdirSync(SRC)) {",
      '  expect(FORBIDDEN_CALL.test(readFileSync(file, "utf8"))).toBe(false);',
      "}",
      control,
    ].join("\n"),
  });

  // A scanner with no negative control at all, whose comment contains the
  // old magic words. It used to be reported as sound.
  const flattering = await pretendProbe.run(
    fixtureScope(scanner("Note: this scan can still fail when the checkout is shallow.", "")),
  );
  // A scanner with a real negative control, worded outside the old list. It
  // used to be reported as a gap.
  const genuine = await pretendProbe.run(
    fixtureScope(
      scanner(
        "Sweeps the source directory.",
        'test("the scanner rejects a planted call", () => { expect(FORBIDDEN_CALL.test("dangerousCall(1)")).toBe(true); });',
      ),
    ),
  );

  for (const findings of [flattering, genuine]) {
    expect(findings.filter((finding) => /shows its own detector firing/.test(finding.title))).toEqual([]);
    expect(findings.filter((finding) => /never shows one firing/.test(finding.title))).toEqual([]);
  }
});

test("the replacement is a runnable negative control, published even when not run", async () => {
  const findings = await pretendProbe.run(resolveScope());
  const stated = findings.find((finding) => finding.title.includes("negative control(s) were derived"));
  expect(stated?.verdict).toBe("limit");
  expect(stated?.detail).toContain("planting a line the detector matches");
  // And the operator exists, with the expectation that makes it a control.
  const operator = OPERATORS.find((entry) => entry.id === "plant-detector-match");
  expect(operator?.expectation).toBe("die");
  expect(operator?.property).toContain("depends on its own detector");
});

test("a plant is a real line from the corpus, dropped into a file the guard reads", async () => {
  const findings = await pretendProbe.run(resolveScope());
  const plan = findings.find((finding) => finding.title.includes("were derived") && finding.evidence.includes("plant-detector-match"));
  expect(plan, "the live tree should offer at least one plantable guard").toBeDefined();
  expect(plan?.evidence).toContain("copied verbatim from");
});

// ── the executing half's own boundaries ─────────────────────────────────────

test("the shadow's not-copied set is derived from the repository's ignore rules", () => {
  const scope = resolveScope();
  const derived = notCopiedDirectories(scope);
  // What the literal used to say, now arrived at from .gitignore + the one
  // asserted boundary in src/scope.ts.
  for (const name of ["node_modules", "dist", ".venv", ".git"]) {
    expect(derived.has(name), `${name} should be derived, not typed`).toBe(true);
  }
  // Nothing that holds source may be in it.
  expect(derived.has("src")).toBe(false);
  expect(derived.has("packages")).toBe(false);
});

test("LINKED_BACK is a subset of the derived not-copied set, and never .git", () => {
  const derived = notCopiedDirectories(resolveScope());
  for (const name of LINKED_BACK) {
    expect(derived.has(name), `${name} is linked back but not ignored by this repository`).toBe(true);
  }
  // A .git reachable from a shadow means a git command inside the shadow
  // operates on the real repository.
  expect(LINKED_BACK).not.toContain(".git");
  expect(LINKED_BACK_PHRASE).toBe(LINKED_BACK.join(" and "));
});

// ── case tables ─────────────────────────────────────────────────────────────

test("a table iterated inside a single test declares assertions, not cases", () => {
  // The false positive: looking eight lines ahead for `test(` matched the
  // ENCLOSING test as readily as a generated one, so a table of assertions
  // inside one case was reported as setting the suite's case count.
  const scope = fixtureScope({
    "pkg/thing.ts": "export const thing = 1;",
    "pkg/tests/inside.test.ts": [
      'import { readdirSync } from "node:fs";',
      'const SRC = "pkg";',
      'const ROWS = ["a", "b", "c", "d", "e", "f"];',
      'test("every row resolves", () => {',
      "  for (const row of ROWS) {",
      "    expect(readdirSync(SRC)).toContain(row);",
      "  }",
      "});",
    ].join("\n"),
    "pkg/tests/generated.test.ts": [
      'import { readdirSync } from "node:fs";',
      'const SRC = "pkg";',
      "void readdirSync(SRC);",
      'const ROWS = ["a", "b", "c", "d", "e", "f"];',
      "for (const row of ROWS) {",
      '  test(`row ${row}`, () => { expect(readdirSync(SRC)).toContain(row); });',
      "}",
    ].join("\n"),
  });
  const tables = guardsIn(scope).flatMap((guard) =>
    inFileTables(scope, guard).map((table) => `${guard.file}:${table.name}`),
  );
  expect(tables).toEqual(["pkg/tests/generated.test.ts:ROWS"]);
});

test("generatesCases answers the same question for python", () => {
  const inside = [
    "def test_every_row():",
    "    for row in ROWS:",
    "        assert row",
  ];
  const generated = ["@pytest.mark.parametrize('row', ROWS)", "def test_row(row):", "    assert row"];
  expect(generatesCases(inside, 1)).toBe(false);
  expect(generatesCases(generated, 0)).toBe(true);
});

// ── the binding-form catalogue's own absences ───────────────────────────────

test("a catalogue form this tree has no example of is reported, not dropped", async () => {
  const findings = await pretendProbe.run(resolveScope());
  const absent = findings.find((finding) => finding.title.includes("were not checked against any guard"));
  expect(absent?.verdict).toBe("limit");
  // The known instance: nothing in this tree rebinds a module global to a
  // lambda, so no guard's pattern was ever run against that form — and it
  // appeared in neither the covered list nor the missed list.
  expect(absent?.evidence).toContain("py/module-assignment");
  expect(absent?.detail).toContain("reported as absent rather than asserted");
});

test("a detector bound to a lower-case name is read as a detector", () => {
  const lines = ["const localDefinition = /^\\s*function\\s+encodeSegment\\b/;", "const OTHER = /x/;"];
  const names = literalPatterns(lines).map((pattern) => pattern.name);
  // SCREAMING_CASE is a house style, not a language rule. Requiring it made
  // a guard's detector invisible, which produced no output at all.
  expect(names).toContain("localDefinition");
  expect(names).toContain("OTHER");
});

// ── the executing half, executed ────────────────────────────────────────────

/** A miniature repository holding one scanner guard over one source tree.
 *  `filter` is the line that decides which files the scanner looks at. */
async function scannerRepository(filter: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agenttool-rhizome-plant-"));
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["config", "user.email", "t@example.com"], { cwd: root });
  spawnSync("git", ["config", "user.name", "t"], { cwd: root });
  await mkdir(join(root, "pkg", "src"), { recursive: true });
  await mkdir(join(root, "pkg", "tests"), { recursive: true });
  await writeFile(join(root, "package.json"), '{"name":"root","private":true}\n');
  await writeFile(join(root, "pkg", "package.json"), '{"name":"proof","version":"1.0.0","type":"module"}\n');
  await writeFile(
    join(root, "pkg", "src", "_url.ts"),
    "export function encodeSegment(value: string): string {\n  return encodeURIComponent(value);\n}\n",
  );
  for (const name of ["alpha", "beta"]) {
    await writeFile(
      join(root, "pkg", "src", `${name}.ts`),
      `import { encodeSegment } from "./_url.js";\nexport const ${name} = (id: string): string => "/v1/" + encodeSegment(id);\n`,
    );
  }
  await writeFile(
    join(root, "pkg", "tests", "scan.test.ts"),
    [
      'import { expect, test } from "bun:test";',
      'import { readdirSync, readFileSync } from "node:fs";',
      'import { join as joinPath } from "node:path";',
      "",
      'const SRC = joinPath(import.meta.dir, "..", "src");',
      "const LOCAL_ENCODER_DEFINITION =",
      "  /(?:^|\\n)[ \\t]*(?:export[ \\t]+)?(?:function[ \\t]+encodeSegment\\b|(?:const|let|var)[ \\t]+encodeSegment\\b)/;",
      "",
      'test("no module under src redefines encodeSegment", () => {',
      "  for (const name of readdirSync(SRC)) {",
      `    ${filter}`,
      '    const text = readFileSync(joinPath(SRC, name), "utf8");',
      "    expect(LOCAL_ENCODER_DEFINITION.test(text)).toBe(false);",
      "  }",
      "});",
      "",
    ].join("\n"),
  );
  spawnSync("git", ["add", "-A"], { cwd: root });
  spawnSync("git", ["commit", "-qm", "one"], { cwd: root });
  return root;
}

test("executing: a guard whose detector fires is shown firing, and one that cannot is shown not firing", async () => {
  // The whole point of replacing the phrase match. Both verdicts come from
  // running the guard against a planted line, in a shadow under the system
  // temporary directory; neither comes from reading the guard's prose. The
  // two repositories differ by one line — the filter the scanner applies —
  // and that line is exactly the difference between a scanner that reads
  // the tree and a scanner that has quietly stopped reading it.
  const live = await scannerRepository('if (name === "_url.ts") continue;');
  const blind = await scannerRepository('if (!name.endsWith(".tsx")) continue;');
  const previous = process.env[MUTATE_ENV];
  process.env[MUTATE_ENV] = "1";
  try {
    const liveFindings = await pretendProbe.run(resolveScope(live));
    const sound = liveFindings.find((finding) => finding.title.includes("dies on:"));
    expect(sound?.verdict).toBe("sound");
    expect(sound?.evidence).toContain("baseline: 1 pass / 0 fail");
    expect(sound?.evidence).toContain("mutated:  0 pass / 1 fail");

    const blindFindings = await pretendProbe.run(resolveScope(blind));
    const gap = blindFindings.find((finding) => finding.title.includes("survives:"));
    expect(gap?.verdict).toBe("gap");
    expect(gap?.evidence).toContain("mutated:  1 pass / 0 fail");
    expect(gap?.detail).toContain("depends on its own detector");

    // And nothing was written inside either checkout.
    for (const root of [live, blind]) {
      const status = spawnSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
      expect(status.stdout.trim()).toBe("");
    }
  } finally {
    if (previous === undefined) delete process.env[MUTATE_ENV];
    else process.env[MUTATE_ENV] = previous;
    await rm(live, { recursive: true, force: true });
    await rm(blind, { recursive: true, force: true });
  }
}, 180_000);
