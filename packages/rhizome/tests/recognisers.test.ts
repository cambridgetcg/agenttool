/** The shared vocabularies: one definition per concept, and each one
 *  checked against the tree rather than believed.
 *
 *  `src/recognisers.ts` and `src/prose.ts` exist because rhizome carried
 *  the exact defect it exists to report: three private copies of the prose
 *  extension list, one strictly narrower than the others, and three private
 *  spellings of "does this file read/sweep the tree". Nothing went red when
 *  they diverged, because nothing compared them. This file is the thing
 *  that compares them.
 */

import { expect, test } from "bun:test";

import { isProse, PROSE_EXTENSIONS } from "../src/prose.js";
import {
  ASSERTS,
  READS_THE_TREE,
  RECOGNISER_SPELLINGS,
  SPELLINGS_WITHOUT_WITNESS,
  WALKS_THE_TREE,
} from "../src/recognisers.js";
import { resolveScope } from "../src/scope.js";

/** Every rhizome source file, from the corpus rather than from a list. */
function rhizomeSources(): Array<{ file: string; text: string }> {
  const scope = resolveScope();
  const out: Array<{ file: string; text: string }> = [];
  for (const file of scope.files) {
    if (!file.startsWith("packages/rhizome/src/") || !file.endsWith(".ts")) continue;
    const text = scope.read(file);
    if (text !== null) out.push({ file, text });
  }
  expect(out.length).toBeGreaterThan(10);
  return out;
}

test("the prose extension list has exactly one definition", () => {
  // The declaration form, not the mention: `src/prose.ts` declares it, and
  // `probes/decay/reach.ts` and `probes/reach/paths.ts` re-export the same
  // binding. Any other file declaring its own `[".md", ...]` is the defect
  // this module removed — three copies, one of them strictly narrower than
  // the other two, inside the package that reports exactly that shape.
  //
  // This assertion was briefly written against a pinned list of the copies
  // that still existed while a sibling session rebuilt `probes/reach`, with
  // a second assertion that failed once the list emptied. It emptied, the
  // test said so by name, and the pin is gone. An exemption that cannot
  // outlive its subject is the only kind worth writing.
  const offenders = rhizomeSources().filter(
    ({ file, text }) =>
      file !== "packages/rhizome/src/prose.ts" &&
      /(?:const|let|var)\s+\w*PROSE\w*\s*(?::[^=]*)?=\s*(?:Object\.freeze\()?\[/.test(text),
  );
  expect(offenders.map((entry) => entry.file)).toEqual([]);
});

test("no probe declares a private copy of a recogniser vocabulary", () => {
  const names = Object.keys(RECOGNISER_SPELLINGS);
  const offenders: string[] = [];
  for (const { file, text } of rhizomeSources()) {
    if (file === "packages/rhizome/src/recognisers.ts") continue;
    for (const name of names) {
      // A declaration binding a regex literal to one of these names, or to
      // an obvious rename of one (SWEEPS_THE_TREE was exactly that).
      if (new RegExp(`(?:const|let|var)\\s+(?:${name}|\\w+_THE_TREE|\\w*ASSERTS\\w*)\\s*=\\s*/`).test(text)) {
        offenders.push(`${file}: private ${name}`);
      }
    }
  }
  expect([...new Set(offenders)]).toEqual([]);
});

test("every recogniser spelling is either witnessed in this tree or listed as unwitnessed", () => {
  const scope = resolveScope();
  const unwitnessed: string[] = [];
  for (const spellings of Object.values(RECOGNISER_SPELLINGS)) {
    for (const spelling of spellings) {
      const pattern = new RegExp(spelling);
      const hit = scope.files.find((file) => pattern.test(scope.read(file) ?? ""));
      if (hit === undefined) unwitnessed.push(spelling);
    }
  }
  // Pinned in BOTH directions: a spelling that quietly stops matching lands
  // here loudly, and a listed spelling that starts matching has to be
  // removed. A vocabulary whose entries are never checked against the tree
  // is a list nobody re-reads.
  expect([...new Set(unwitnessed)].sort()).toEqual([...SPELLINGS_WITHOUT_WITNESS].sort());
});

test("the vocabularies actually recognise the constructs they name", () => {
  expect(READS_THE_TREE.test('const text = readFileSync("x", "utf8");')).toBe(true);
  expect(READS_THE_TREE.test("const entries = await readdir(dir);")).toBe(true);
  expect(WALKS_THE_TREE.test("for (const entry of readdirSync(dir)) {}")).toBe(true);
  expect(WALKS_THE_TREE.test("for p in Path(root).rglob('*.py'):")).toBe(true);
  // The spellings `pretend` used to be blind to, because its own copy of
  // this vocabulary did not contain them.
  expect(WALKS_THE_TREE.test("const files = globSync(pattern);")).toBe(true);
  expect(WALKS_THE_TREE.test("import { opendir } from 'node:fs/promises';")).toBe(true);
  // …and the spellings `edge`'s copy did not contain.
  expect(WALKS_THE_TREE.test("const program = ts.createProgram(files, options);")).toBe(true);
  expect(WALKS_THE_TREE.test("tree = ast.parse(source)")).toBe(true);
  expect(ASSERTS.test("expect(value).toBe(1);")).toBe(true);
  expect(ASSERTS.test("if (bad) process.exit(1);")).toBe(true);
  expect(WALKS_THE_TREE.test("const client = await fetch(url);")).toBe(false);
});

test("prose is one list, and it is the widest of the three it replaced", () => {
  for (const extension of [".md", ".mdx", ".txt", ".rst"]) {
    expect(PROSE_EXTENSIONS).toContain(extension);
    expect(isProse(`docs/whatever${extension}`)).toBe(true);
  }
  expect(isProse("src/index.ts")).toBe(false);
});

test("live: the re-export and the definition are the same object", async () => {
  const { PROSE_EXTENSIONS: viaDecay } = await import("../src/probes/decay/reach.js");
  expect(viaDecay).toBe(PROSE_EXTENSIONS);
});
