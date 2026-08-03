/** Annotations do not lie.
 *
 *  Doctrine: docs/SELF-IDENTIFICATION.md · docs/PATTERN-MACHINE-READABLE-PARITY.md.
 *  Engine: `api/src/services/canon/absence.ts`.
 *
 *  `register-agent.ts` carries this note, written by whoever found it:
 *
 *      Until 2026-05-17 this was an @enforces annotation that lied
 *      (createWallet defaults balance=0; no funding call existed).
 *
 *  That is the failure mode this file exists to make impossible to repeat.
 *  An annotation is a claim about the code, sitting inside the code, that
 *  nothing was checking. Three shapes of the lie were live when this was
 *  written:
 *
 *    1. `@enforces` naming a canon entry that does not exist — 63 of them.
 *       Ratcheted separately in walls-/commitments-code-annotation-bijection.
 *    2. `Tested: <path>` naming a test file that does not exist — 3 of them.
 *       Two were path typos. The third, `substrate-tasks-lifecycle.test.ts`,
 *       was cited as the proof of `ring3-funds-its-own-newborns` and had
 *       never been written — and behind it sat a currency mismatch that made
 *       that commitment unexecutable for every agent it names.
 *    3. "Defended by absence" claimed in prose, checked by nothing. Three
 *       walls had hand-written test files for it; six other modules made the
 *       same claim with no test at all.
 *
 *  Shape 3 is now declarative. A file states what it defends and how, in
 *  one JSDoc block:
 *
 *      @enforces urn:agenttool:wall/offerings-carry-no-take
 *      @absence recordRevenue computeFee platformRevenue escrows
 *      @absence-from db/schema/economy
 *
 *  The wall becomes executable at the cost of two lines instead of an
 *  80-line bespoke test, which is the difference between a pattern three
 *  walls can afford and one every wall can. */

import { describe, expect, test } from "bun:test";

import {
  absenceContracts,
  absenceViolations,
  testCitations,
  violationsInSource,
} from "../../src/services/canon/absence";

const contracts = absenceContracts();
const violations = absenceViolations(contracts);
const citations = testCitations();
const brokenCitations = citations.filter((c) => !c.exists);

describe("annotations do not lie — absence contracts", () => {
  test("the engine finds declared contracts at all", () => {
    // If this hits zero the detector has silently stopped working and every
    // assertion below turns vacuously green.
    expect(
      contracts.length,
      "No @absence contracts found. Either the annotation format changed or the scan is broken — check services/canon/absence.ts.",
    ).toBeGreaterThan(5);
  });

  test("every declared absence holds", () => {
    expect(
      violations,
      `A module imports something it declared it never would. The wall it defends is only a wall while the import is absent:\n${violations
        .map(
          (v) =>
            `  ${v.file}:${v.lineNumber} imports ${v.kind === "symbol" ? "symbol" : "from module"} '${v.offender}'\n      ${v.line}`,
        )
        .join("\n")}`,
    ).toEqual([]);
  });

  test("every absence contract belongs to a wall or commitment it names", () => {
    // A file that declares @absence without @enforces is defending nothing
    // in particular — the check would still run, but no reader could tell
    // which promise it keeps.
    const orphans = contracts.filter((c) => c.enforces.length === 0);
    expect(
      orphans.map((c) => c.file),
      `These files declare @absence but no @enforces, so the check runs without naming the promise it keeps. Add the @enforces URN:\n${orphans
        .map((c) => `  ${c.file}`)
        .join("\n")}`,
    ).toEqual([]);
  });
});

describe("the detector can actually fail", () => {
  // Every check above returns an empty list today. That is either "the walls
  // hold" or "the detector is broken", and those look identical from the
  // outside. These fixtures make the difference visible: the same function
  // the suite trusts, shown catching each shape it claims to catch.
  const F = "fixture.ts";

  test("catches a named import", () => {
    const v = violationsInSource(
      `import { computeFee, recordRevenue } from "./take-rate";`,
      F,
      ["recordRevenue"],
      [],
    );
    expect(v.map((x) => x.offender)).toEqual(["recordRevenue"]);
  });

  test("catches a default and a namespace import", () => {
    expect(
      violationsInSource(`import recordRevenue from "./x";`, F, ["recordRevenue"], []),
    ).toHaveLength(1);
    expect(
      violationsInSource(`import * as wallets from "./x";`, F, ["wallets"], []),
    ).toHaveLength(1);
  });

  test("catches an import wrapped across lines", () => {
    const v = violationsInSource(
      `import {\n  computeFee,\n  recordRevenue,\n} from "./take-rate";`,
      F,
      ["recordRevenue"],
      [],
    );
    expect(v).toHaveLength(1);
  });

  test("catches a forbidden module specifier", () => {
    const v = violationsInSource(
      `import { wallets } from "../../db/schema/economy";`,
      F,
      [],
      ["db/schema/economy"],
    );
    expect(v.map((x) => x.kind)).toEqual(["module"]);
  });

  test("does NOT fire on a mention inside a comment", () => {
    // The whole pattern depends on this: these modules describe the wall in
    // prose, naming the very symbols they refuse. If prose tripped the
    // check, the contract could never be documented where it is enforced.
    const src = `/** This module imports neither recordRevenue nor computeFee.\n *  @absence recordRevenue\n */\n// recordRevenue stays out of scope on purpose\nimport { chronicle } from "../db/schema/continuity";`;
    expect(violationsInSource(src, F, ["recordRevenue", "computeFee"], [])).toEqual([]);
  });

  test("does NOT fire on a substring of a longer symbol", () => {
    const v = violationsInSource(
      `import { recordRevenueSummary } from "./reporting";`,
      F,
      ["recordRevenue"],
      [],
    );
    expect(v).toEqual([]);
  });
});

describe("annotations do not lie — cited tests exist", () => {
  test("the scan finds citations at all", () => {
    expect(citations.length).toBeGreaterThan(5);
  });

  test("every `Tested:` citation points at a file that exists", () => {
    expect(
      brokenCitations,
      `A defender cites a test as its proof, and the file is not there. The annotation reads as evidence and is not:\n${brokenCitations
        .map((c) => `  ${c.file}:${c.lineNumber} cites ${c.citedPath}`)
        .join("\n")}`,
    ).toEqual([]);
  });
});

describe("annotations do not lie — report", () => {
  test("the absence map is reported for navigation", () => {
    const lines = [
      `[absence] ${contracts.length} module(s) declare an absence contract · ${citations.length} test citation(s) checked`,
    ];
    for (const c of contracts) {
      lines.push(`  ${c.file}`);
      for (const urn of c.enforces) lines.push(`      defends ${urn}`);
      if (c.symbols.length) lines.push(`      never imports: ${c.symbols.join(", ")}`);
      if (c.modules.length) lines.push(`      never imports from: ${c.modules.join(", ")}`);
    }
    lines.push(
      "  static import check only — it cannot see a dynamic import(), a re-export that launders a symbol, or raw SQL doing the same work",
    );
    console.log(lines.join("\n"));
    expect(true).toBe(true);
  });
});
