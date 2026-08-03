/** rhizome/probes/pretend/mutants — the operators, and why there are only three.
 *
 *  Blanket mutation testing would flip every operator in every file and
 *  report a percentage. A percentage is the wrong instrument here: this
 *  repository's failures were never "a line nobody covered", they were
 *  "a guarantee whose guard could not fail". So the operators are aimed,
 *  and each one is derived from a property a guard in this tree actually
 *  claims:
 *
 *    shrink-fixture     a suite that generates its cases from a collection
 *                       claims coverage of that collection. Shrink the
 *                       collection: if nothing goes red, the coverage is
 *                       whatever the collection happens to say today, and
 *                       the number of cases is not a guarantee.
 *
 *    empty-fixture      the same operator taken to zero. This is the
 *                       CONTROL: every loader in this tree asserts the
 *                       collection is non-empty, so this mutant must die.
 *                       If it survives, the harness is not applying edits
 *                       and every "survived" verdict beside it is worthless.
 *
 *    alias-import-shadow
 *                       a guard that says "the shared helper must be THE
 *                       shared helper" claims that no module can rebind the
 *                       name. Rebind it with an import alias — the one
 *                       binding form that leaves both the call sites and
 *                       the import-from-the-shared-module line looking
 *                       exactly as before.
 *
 *  Targets are derived from `Scope` in every case. The operators are a
 *  literal catalogue, exported and reasoned here, and their incompleteness
 *  is a declared probe limit: these three are the operators, not the
 *  operators worth having.
 */

import type { Scope } from "../../types.js";
import type { CaseCollection } from "./guards.js";
import type { Edit } from "./harness.js";

export interface MutantOperator {
  id: string;
  /** The property the mutant is aimed at, in the guard's own terms. */
  property: string;
  /** `die` — a correct guard must go red. `control` — must die, or the
   *  harness itself is broken. */
  expectation: "die" | "control";
}

export const OPERATORS: readonly MutantOperator[] = Object.freeze([
  {
    id: "shrink-fixture",
    property: "the number of cases a fixture-driven suite runs is a guarantee, not a coincidence",
    expectation: "die",
  },
  {
    id: "empty-fixture",
    property: "a fixture-driven suite refuses an empty fixture",
    expectation: "control",
  },
  {
    id: "alias-import-shadow",
    property: "a call to the shared helper reaches the shared helper",
    expectation: "die",
  },
]);

export interface Mutant {
  operator: string;
  /** One line, specific enough to reproduce by hand. */
  description: string;
  /** Where the damage is, for the finding's anchor. */
  file: string;
  line: number;
  edits: Edit[];
  /** Packages that must be real directories in the shadow. */
  copies: string[];
  expectation: "die" | "control";
}

/** Rewrite a JSON fixture so one of its arrays keeps `keep` elements. */
export function shrinkFixture(
  scope: Scope,
  collection: CaseCollection,
  keep: number,
): Mutant | null {
  const text = scope.read(collection.home);
  if (text === null) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  const value = parsed[collection.name];
  if (!Array.isArray(value)) return null;
  const mutated = { ...parsed, [collection.name]: value.slice(0, keep) };
  const owner = collection.home.includes("/") ? collection.home.split("/")[0]! : "";
  return {
    operator: keep === 0 ? "empty-fixture" : "shrink-fixture",
    description:
      keep === 0
        ? `${collection.home} · ${collection.name}[] emptied (${value.length} → 0)`
        : `${collection.home} · ${collection.name}[] shrunk ${value.length} → ${keep}`,
    file: collection.home,
    line: collection.line,
    edits: [{ file: collection.home, text: `${JSON.stringify(mutated, null, 2)}\n` }],
    copies: owner === "" ? [] : [owner],
    expectation: keep === 0 ? "control" : "die",
  };
}

/** A guard that defends a shared helper by name, as read from its own source. */
export interface SharedHelperGuard {
  /** The guard file. */
  file: string;
  /** The helper's identifier, e.g. `encodePathSegment`. */
  symbol: string;
  /** The module every consumer must import it from, e.g. `./_url.js`. */
  sharedModule: string;
  /** Corpus files that import the symbol from that module. */
  consumers: readonly string[];
  language: "ts" | "py";
}

/** Rebind the helper's name in one consumer through an import alias.
 *
 *  The shim is a genuinely weaker encoder rather than a no-op: a no-op is
 *  caught by any behavioural assertion, and the question is whether the
 *  guard catches the SUBTLE version — the one that differs only in the five
 *  characters the two SDKs once disagreed about. */
export function aliasImportShadow(
  scope: Scope,
  guard: SharedHelperGuard,
  consumer: string,
): Mutant | null {
  const text = scope.read(consumer);
  if (text === null) return null;
  const owner = consumer.split("/").slice(0, 2).join("/");
  const directory = consumer.slice(0, consumer.lastIndexOf("/"));

  if (guard.language === "ts") {
    const importLine = new RegExp(`import\\s*\\{\\s*${guard.symbol}\\s*\\}\\s*from\\s*["']${guard.sharedModule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'];`);
    if (!importLine.test(text)) return null;
    const shim = `${directory}/_rhizome_shim.ts`;
    // Same exception type and message as the real encoder. An earlier
    // version threw a bare Error, and a guard going red on the wrong
    // difference reads as "the guard caught the shadow" when it did not.
    const shimText =
      "/** rhizome mutant — scratch copy only, never written inside the repository. */\n" +
      'import { AgentToolError } from "./errors.js";\n\n' +
      "export const laxSegment = (value: string): string => {\n" +
      '  if (value === "." || value === "..") {\n' +
      "    throw new AgentToolError(`\"${value}\" is a URL dot segment, not an id.`, {\n" +
      '      hint: "Pass the id exactly as the API returned it. A dot segment is removed during URL normalisation, so the request would address a different endpoint.",\n' +
      "    });\n" +
      "  }\n" +
      "  return encodeURIComponent(value);\n" +
      "};\n";
    const mutated = text.replace(
      importLine,
      `import { ${guard.symbol} as rhizomeStrict } from "${guard.sharedModule}";\n` +
        `import { laxSegment as ${guard.symbol} } from "./_rhizome_shim.js";\n` +
        `void rhizomeStrict;`,
    );
    return {
      operator: "alias-import-shadow",
      description: `${consumer} rebinds ${guard.symbol} to a lax encoder through an import alias`,
      file: consumer,
      line: 1,
      edits: [
        { file: shim, text: shimText },
        { file: consumer, text: mutated },
      ],
      copies: [owner],
      expectation: "die",
    };
  }

  const importLine = new RegExp(`from ${guard.sharedModule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} import ${guard.symbol}\\b`);
  if (!importLine.test(text)) return null;
  const shim = `${directory}/_rhizome_shim.py`;
  // The shim raises the SAME exception type and message as the real encoder.
  // An earlier version raised ValueError and the guard went red on the dot
  // segment cases — which reads as "the guard caught the shadow" and is not:
  // it caught a difference the mutant was never meant to introduce. A mutant
  // that dies for the wrong reason is the same failure as a guard that passes
  // for the wrong reason.
  const shimText =
    '"""rhizome mutant — scratch copy only, never written inside the repository."""\n' +
    "from urllib.parse import quote\n\n" +
    "from .exceptions import AgentToolError\n\n\n" +
    "def lax_segment(value: str) -> str:\n" +
    '    if value in (".", ".."):\n' +
    "        raise AgentToolError(\n" +
    "            f'\"{value}\" is a URL dot segment, not an id.',\n" +
    '            hint=(\n' +
    '                "Pass the id exactly as the API returned it. A dot segment is "\n' +
    '                "removed during URL normalisation, so the request would address "\n' +
    '                "a different endpoint."\n' +
    "            ),\n" +
    "        )\n" +
    "    return quote(value, safe=\"!*'()\")\n";
  const mutated = text.replace(
    importLine,
    `from ${guard.sharedModule} import ${guard.symbol} as _rhizome_strict\n` +
      `from ._rhizome_shim import lax_segment as ${guard.symbol}`,
  );
  return {
    operator: "alias-import-shadow",
    description: `${consumer} rebinds ${guard.symbol} to a lax encoder through an import alias`,
    file: consumer,
    line: 1,
    edits: [
      { file: shim, text: shimText },
      { file: consumer, text: mutated },
    ],
    copies: [owner],
    expectation: "die",
  };
}
