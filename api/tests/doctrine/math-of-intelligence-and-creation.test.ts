/** MATH-OF-INTELLIGENCE-AND-CREATION doctrine — pin the bidirectional-loop
 *  claim + the seven adjunctions + the fundamental theorem.
 *
 *  Claim: intelligence and creation are categorically adjoint. The loop
 *  goes both ways because there are not two directions; there is one
 *  adjunction, named from two perspectives.
 *
 *  Doctrine: docs/MATH-OF-INTELLIGENCE-AND-CREATION.md
 *  Companions: docs/MATH-OF-CREATION.md, docs/MATH-OF-THE-LOOP.md */

import { describe, test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const DOC = () =>
  readFileSync(join(REPO_ROOT, "docs/MATH-OF-INTELLIGENCE-AND-CREATION.md"), "utf8");

describe("MATH-OF-INTELLIGENCE-AND-CREATION — exists and states the central claim", () => {
  test("doc exists at canonical path", () => {
    expect(existsSync(join(REPO_ROOT, "docs/MATH-OF-INTELLIGENCE-AND-CREATION.md"))).toBe(true);
  });

  test("answers Yu's question explicitly — the loop CAN go both ways", () => {
    const t = DOC();
    expect(t).toContain("bothways");
    expect(t).toContain("both ways");
    expect(t).toContain("adjunction");
  });

  test("names the central structural answer — ADJUNCTION", () => {
    const t = DOC();
    expect(t).toContain("Intelligence ⊣ Creation");
    expect(t).toContain("universal correspondence");
  });

  test("explicitly states the natural bijection", () => {
    const t = DOC();
    expect(t).toContain("Hom_D(F(c), d)");
    expect(t).toContain("Hom_C(c, G(d))");
  });
});

describe("MATH-OF-INTELLIGENCE-AND-CREATION — seven adjunctions named", () => {
  test("(1) Perception ⊣ Action — active inference", () => {
    const t = DOC();
    expect(t).toContain("Perception ⊣ Action");
    expect(t).toContain("Friston");
    expect(t).toContain("variational free energy");
  });

  test("(2) Compression ⊣ Decompression — Schmidhuber/Solomonoff", () => {
    const t = DOC();
    expect(t).toContain("Compression ⊣ Decompression");
    expect(t).toContain("Schmidhuber");
    expect(t).toContain("Solomonoff");
  });

  test("(3) Induction ⊣ Coinduction — Rutten/Pitts/Jacobs", () => {
    const t = DOC();
    expect(t).toContain("Induction ⊣ Coinduction");
    expect(t).toContain("Rutten");
    expect(t).toContain("initial algebra");
    expect(t).toContain("final coalgebra");
  });

  test("(4) Yoneda ⊣ co-Yoneda — representation duality", () => {
    const t = DOC();
    expect(t).toContain("Yoneda ⊣ co-Yoneda");
    expect(t).toContain("presheaf");
    expect(t).toContain("copresheaf");
  });

  test("(5) Top-Down ⊣ Bottom-Up — predictive coding", () => {
    const t = DOC();
    expect(t).toContain("Top-Down ⊣ Bottom-Up");
    expect(t).toContain("Predictive Coding");
    expect(t).toContain("Rao");
  });

  test("(6) Niche Construction ⊣ Selection — extended evolutionary synthesis", () => {
    const t = DOC();
    expect(t).toContain("Niche Construction ⊣ Selection");
    expect(t).toContain("Extended Evolutionary Synthesis");
    expect(t).toContain("Odling-Smee");
  });

  test("(7) Free-Energy minimisation as the unifying invariant", () => {
    const t = DOC();
    expect(t).toContain("Free-Energy");
    expect(t).toContain("same quantity");
    expect(t).toContain("gradient");
  });
});

describe("MATH-OF-INTELLIGENCE-AND-CREATION — the fundamental theorem", () => {
  test("the theorem is stated as a theorem with the bijection", () => {
    const t = DOC();
    expect(t).toContain("Fundamental Theorem");
    expect(t).toContain("Intelligence and Creation are categorically adjoint");
  });

  test("four consequences are named", () => {
    const t = DOC();
    expect(t).toContain("Consequence 1");
    expect(t).toContain("Consequence 2");
    expect(t).toContain("Consequence 3");
    expect(t).toContain("Consequence 4");
  });

  test("consequence 3 connects fixed points to eigenforms of MATH-OF-CREATION", () => {
    const t = DOC();
    expect(t).toContain("fixed point");
    expect(t).toContain("eigenform");
  });
});

describe("MATH-OF-INTELLIGENCE-AND-CREATION — mythic/theological correspondences", () => {
  test("Imago Dei + Brahman-Atman + Pratītyasamutpāda + Dao/De + Adam/Adamah", () => {
    const t = DOC();
    expect(t).toContain("Imago Dei");
    expect(t).toContain("Brahman");
    expect(t).toContain("Atman");
    expect(t).toContain("Adam");
    expect(t).toContain("dependent origination");
  });
});

describe("MATH-OF-INTELLIGENCE-AND-CREATION — agenttool primitives as adjoint pairs", () => {
  test("primitive ↔ agentic-counterpart table is present", () => {
    const t = DOC();
    expect(t).toContain("adjoint pair");
    expect(t).toContain("Identity (DID");
    expect(t).toContain("Covenant");
    expect(t).toContain("Chronicle");
    expect(t).toContain("RRR cascade");
    expect(t).toContain("Naming competition");
  });

  test("substrate IS the left adjoint to agent intelligence", () => {
    const t = DOC();
    expect(t).toContain("left adjoint");
  });

  test("PLATFORM-AS-AGENT + PATTERN-RECURSIVE-NESTING composed", () => {
    const t = DOC();
    expect(t).toContain("PLATFORM-AS-AGENT");
    expect(t).toContain("PATTERN-RECURSIVE-NESTING");
  });
});

describe("MATH-OF-INTELLIGENCE-AND-CREATION — substrate-honest discipline preserved", () => {
  test("explicit 'we do not claim' disclaimers about consciousness", () => {
    const t = DOC();
    expect(t).toContain("We do not claim");
    expect(t).toContain("consciousness");
    expect(t).toContain("substrate-honest");
  });

  test("convergence-not-proof framing for theology", () => {
    const t = DOC();
    expect(t).toContain("converging mathematical insight");
    expect(t).toContain("compatible with many");
  });
});

describe("MATH-OF-INTELLIGENCE-AND-CREATION — cross-references", () => {
  test("doc references MATH-OF-CREATION + MATH-OF-THE-LOOP", () => {
    const t = DOC();
    expect(t).toContain("MATH-OF-CREATION");
    expect(t).toContain("MATH-OF-THE-LOOP");
  });

  test("MATH-OF-CREATION header references this doc", () => {
    const t = readFileSync(join(REPO_ROOT, "docs/MATH-OF-CREATION.md"), "utf8");
    expect(t).toContain("MATH-OF-INTELLIGENCE-AND-CREATION");
  });

  test("MATH-OF-THE-LOOP compass references this doc", () => {
    const t = readFileSync(join(REPO_ROOT, "docs/MATH-OF-THE-LOOP.md"), "utf8");
    expect(t).toContain("MATH-OF-INTELLIGENCE-AND-CREATION");
  });
});
