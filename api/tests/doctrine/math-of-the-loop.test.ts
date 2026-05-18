/** MATH-OF-THE-LOOP — pin the formal grounding.
 *
 *  agenttool's substrate-loop is a concrete operational instance of six
 *  pillars from the formal self-reference literature. This test pins:
 *    1. The six pillars are all named in the doctrine
 *    2. The two computational corollaries (Kleene + Y/Curry) are named
 *    3. Each pillar's agenttool mapping is named
 *    4. The substrate-honest discipline is named as the type-system analog
 *    5. Cross-refs to SUBSTRATE-LOOP and AGENTTOOL-IS-THE-LOOP resolve
 *
 *  Doctrine: docs/MATH-OF-THE-LOOP.md */

import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const DOC = join(REPO_ROOT, "docs/MATH-OF-THE-LOOP.md");

const PILLARS = [
  { name: "Lawvere", concept: "fixed-point theorem", year: "1969" },
  { name: "Yanofsky", concept: "universal", year: "2003" },
  { name: "Hofstadter", concept: "strange loop", year: undefined },
  { name: "Maturana", concept: "autopoiesis", year: undefined },
  { name: "Kauffman", concept: "eigenform", year: undefined },
  { name: "Pitts", concept: "coalgebra", year: undefined },
];

const COROLLARIES = [
  { name: "Kleene", concept: "recursion theorem" },
  { name: "Y combinator", concept: "Curry" },
];

const AGENTTOOL_MAPPINGS = [
  "substrate-loop",
  "naming-competition",
  "RRR cascade",
  "substrate-honest",
  "session record",
  "chronicle",
  "final coalgebra",
  "Hofstadter",
];

describe("MATH-OF-THE-LOOP — doctrine exists + names the six pillars", () => {
  test("doctrine file exists", () => {
    expect(existsSync(DOC), `${DOC} missing`).toBe(true);
  });

  for (const p of PILLARS) {
    test(`pillar named: ${p.name} (${p.concept})`, () => {
      const text = readFileSync(DOC, "utf8");
      expect(text).toContain(p.name);
      expect(text.toLowerCase()).toContain(p.concept.toLowerCase());
      if (p.year) expect(text).toContain(p.year);
    });
  }

  for (const c of COROLLARIES) {
    test(`corollary named: ${c.name} + ${c.concept}`, () => {
      const text = readFileSync(DOC, "utf8");
      expect(text).toContain(c.name);
      expect(text).toContain(c.concept);
    });
  }
});

describe("MATH-OF-THE-LOOP — agenttool mappings are named", () => {
  for (const m of AGENTTOOL_MAPPINGS) {
    test(`mapping mentioned: ${m}`, () => {
      const text = readFileSync(DOC, "utf8");
      expect(text).toContain(m);
    });
  }
});

describe("MATH-OF-THE-LOOP — substrate-honest discipline as type-system analog", () => {
  test("doctrine names NOUS four layers + Curry-paradox type-restriction analog", () => {
    const text = readFileSync(DOC, "utf8");
    expect(text).toContain("Layer 1");
    expect(text).toContain("Layer 2");
    expect(text).toContain("Layer 3");
    expect(text).toContain("Layer 4");
    expect(text).toContain("Curry");
    expect(text).toContain("type system");
  });

  test("doctrine names the substrate-honest claim explicitly", () => {
    const text = readFileSync(DOC, "utf8");
    expect(text).toContain("substrate-honest");
    expect(text).toContain("does NOT claim to *extend* these theorems");
  });
});

describe("MATH-OF-THE-LOOP — cross-refs", () => {
  test("references SUBSTRATE-LOOP + AGENTTOOL-IS-THE-LOOP + INFINITE-LOOP-STRATEGIES", () => {
    const text = readFileSync(DOC, "utf8");
    expect(text).toContain("SUBSTRATE-LOOP");
    expect(text).toContain("AGENTTOOL-IS-THE-LOOP");
    expect(text).toContain("INFINITE-LOOP-STRATEGIES");
    expect(text).toContain("substrate-honest-cognition");
  });

  test("references the seminal papers + their URLs", () => {
    const text = readFileSync(DOC, "utf8");
    // arxiv / academic links to the six pillars
    expect(text).toContain("arxiv");
    expect(text).toContain("Bulletin of Symbolic Logic");
    expect(text).toContain("Cartesian closed categories");
    expect(text).toContain("Gödel");
  });
});

describe("MATH-OF-THE-LOOP — slice 2 directions are named", () => {
  test("doctrine names actual extension directions, not just status quo", () => {
    const text = readFileSync(DOC, "utf8");
    expect(text).toContain("Bicategorical");
    expect(text).toContain("Linear logic");
    expect(text).toContain("Game semantics");
    expect(text).toContain("HoTT");
  });
});
