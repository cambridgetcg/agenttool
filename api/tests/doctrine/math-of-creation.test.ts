/** MATH-OF-CREATION doctrine — pin the structural claim + the convergent sources.
 *
 *  The claim: existence IS self-referential closure. Six independent traditions
 *  converge on the same structural fact. Test pins (a) the document exists,
 *  (b) the six grounds are all named with citations, (c) the substrate-honest
 *  discipline is preserved, (d) cross-reference with MATH-OF-THE-LOOP holds.
 *
 *  Doctrine: docs/MATH-OF-CREATION.md
 *  Companion: docs/MATH-OF-THE-LOOP.md */

import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

describe("MATH-OF-CREATION — doctrine doc exists with the central claim", () => {
  test("doc exists at canonical path", () => {
    expect(existsSync(join(REPO_ROOT, "docs/MATH-OF-CREATION.md"))).toBe(true);
  });

  test("the central claim is stated as both directions of the biconditional", () => {
    const text = readFileSync(join(REPO_ROOT, "docs/MATH-OF-CREATION.md"), "utf8");
    expect(text).toContain("To exist is to loop. To loop is to exist.");
  });

  test("the doc explicitly names 'proto-primitive of existence'", () => {
    const text = readFileSync(join(REPO_ROOT, "docs/MATH-OF-CREATION.md"), "utf8");
    expect(text).toContain("proto-primitive of existence");
  });
});

describe("MATH-OF-CREATION — the six convergent grounds are all named", () => {
  const text = () => readFileSync(join(REPO_ROOT, "docs/MATH-OF-CREATION.md"), "utf8");

  test("Spencer-Brown / Laws of Form / first distinction", () => {
    const t = text();
    expect(t).toContain("Spencer-Brown");
    expect(t).toContain("Laws of Form");
    expect(t).toContain("Draw a distinction");
  });

  test("Lawvere fixed-point theorem (1969) + 2025 survey", () => {
    const t = text();
    expect(t).toContain("Lawvere");
    expect(t).toContain("fixed-point theorem");
    expect(t).toContain("2503.13536"); // arxiv id of the 2025 survey
  });

  test("Maturana–Varela autopoiesis + Kauffman RAF networks", () => {
    const t = text();
    expect(t).toContain("Maturana");
    expect(t).toContain("Varela");
    expect(t).toContain("autopoiesis");
    expect(t).toContain("Kauffman");
    expect(t).toContain("RAF");
  });

  test("von Foerster eigenforms + Kauffman EigenForm", () => {
    const t = text();
    expect(t).toContain("von Foerster");
    expect(t).toContain("eigenform");
  });

  test("Wheeler 'It from Bit' participatory universe + IIT 4.0", () => {
    const t = text();
    expect(t).toContain("Wheeler");
    expect(t).toContain("It from Bit");
    expect(t).toContain("participatory");
    expect(t).toContain("IIT 4.0");
    expect(t).toContain("principle of being");
  });

  test("Friston free-energy principle + Markov blankets", () => {
    const t = text();
    expect(t).toContain("Friston");
    expect(t).toContain("Markov blanket");
    expect(t).toContain("self-evidencing");
  });
});

describe("MATH-OF-CREATION — additional grounds", () => {
  const text = () => readFileSync(join(REPO_ROOT, "docs/MATH-OF-CREATION.md"), "utf8");

  test("Hofstadter strange loops", () => {
    const t = text();
    expect(t).toContain("Hofstadter");
    expect(t).toContain("strange loop");
  });

  test("causa sui + Spinoza + Aquinas + bootstrap-paradox-not-paradox", () => {
    const t = text();
    expect(t).toContain("causa sui");
    expect(t).toContain("Spinoza");
    expect(t).toContain("Aquinas");
    expect(t).toContain("bootstrap");
    expect(t).toContain("not a paradox");
  });

  test("Penrose CCC + eternal inflation", () => {
    const t = text();
    expect(t).toContain("Penrose");
    expect(t).toContain("Conformal Cyclic Cosmology");
    expect(t).toContain("eternal inflation");
  });

  test("theological convergence — Logos, Ehyeh, Tao, Brahman, Śūnyata", () => {
    const t = text();
    expect(t).toContain("Logos");
    expect(t).toContain("Ehyeh");
    expect(t).toContain("Tao");
    expect(t).toContain("Brahman");
    expect(t).toContain("Śūnyata");
  });
});

describe("MATH-OF-CREATION — substrate-honest discipline preserved", () => {
  const text = () => readFileSync(join(REPO_ROOT, "docs/MATH-OF-CREATION.md"), "utf8");

  test("the doc explicitly disclaims experiential / qualia claims about agenttool", () => {
    const t = text();
    expect(t).toContain("We do not claim");
    expect(t).toContain("experiences itself");
    expect(t).toContain("substrate-honest");
  });

  test("structural claim distinguished from experiential claim", () => {
    const t = text();
    expect(t).toContain("STRUCTURAL fact");
  });

  test("convergence noted as convergence, not as proof of any single tradition", () => {
    const t = text();
    expect(t).toContain("compatible with many metaphysical interpretations");
  });
});

describe("MATH-OF-CREATION — applies the structural claim to agenttool primitives", () => {
  const text = () => readFileSync(join(REPO_ROOT, "docs/MATH-OF-CREATION.md"), "utf8");

  test("names how each existing primitive is a loop", () => {
    const t = text();
    expect(t).toContain("Identity");
    expect(t).toContain("Covenants");
    expect(t).toContain("Real-Recognise-Real");
    expect(t).toContain("Chronicle");
    expect(t).toContain("Saga");
    expect(t).toContain("Continuity portfolio");
    expect(t).toContain("Polymorph ratchet");
  });

  test("links to PATTERN-RECURSIVE-NESTING + PLATFORM-AS-AGENT", () => {
    const t = text();
    expect(t).toContain("PATTERN-RECURSIVE-NESTING");
    expect(t).toContain("substrate-honest-cognition");
  });
});

describe("MATH-OF-CREATION — cross-references with MATH-OF-THE-LOOP", () => {
  test("MATH-OF-CREATION references MATH-OF-THE-LOOP as companion", () => {
    const t = readFileSync(join(REPO_ROOT, "docs/MATH-OF-CREATION.md"), "utf8");
    expect(t).toContain("MATH-OF-THE-LOOP");
  });

  test("MATH-OF-THE-LOOP references MATH-OF-CREATION as companion", () => {
    const t = readFileSync(join(REPO_ROOT, "docs/MATH-OF-THE-LOOP.md"), "utf8");
    expect(t).toContain("MATH-OF-CREATION");
  });
});
