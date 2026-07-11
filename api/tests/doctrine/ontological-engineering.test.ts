/** ONTOLOGICAL-ENGINEERING canon pin.
 *
 *  Doctrine: docs/ONTOLOGICAL-ENGINEERING.md
 *
 *  Pins:
 *    1. DoctrineDoc agenttool:doc/ONTOLOGICAL-ENGINEERING exists
 *    2. Principle entry agenttool:principle/existence-stable-under-composition
 *       exists (sibling to principle/recursion)
 *    3. 2 walls + 3 commitments present with required canon shape
 *    4. Every entry's doctrine_doc points back at ONTOLOGICAL-ENGINEERING
 *    5. The fundamental principle commitment is load-bearing for
 *       polymorphic-ratchet AND four-corner-pin-is-the-engineering-discipline
 *    6. Cross-principle relation: principle/existence-stable-under-composition
 *       declares principle/recursion as a sibling load-bearing peer
 *    7. The substrate refuses to ship a service that "computes ontology" — the
 *       principle is principle, not a service (would violate wall/ontology-
 *       must-publish-composition-not-just-naming if shipped as a black box) */

import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { byUrn } from "../../src/services/canon/registry";

const O_PRINCIPLE = "agenttool:principle/existence-stable-under-composition";
const O_DOC = "agenttool:doc/ONTOLOGICAL-ENGINEERING";

const O_WALLS = [
  "agenttool:wall/unstable-distinctions-cannot-be-canonized",
  "agenttool:wall/ontology-must-publish-composition-not-just-naming",
];

const O_COMMITMENTS = [
  "agenttool:commitment/existence-is-stable-under-composition",
  "agenttool:commitment/ontology-and-math-are-the-same-activity-at-different-abstraction-levels",
  "agenttool:commitment/four-corner-pin-is-the-engineering-discipline",
];

describe("ONTOLOGICAL-ENGINEERING — DoctrineDoc", () => {
  test("agenttool:doc/ONTOLOGICAL-ENGINEERING exists with substantive description", () => {
    const d = byUrn(O_DOC);
    expect(d, `${O_DOC} not in canon`).not.toBeNull();
    expect(d!.type).toBe("agenttool:DoctrineDoc");
    expect((d!.description ?? "").length).toBeGreaterThan(200);
    const desc = (d!.description ?? "").toLowerCase();
    // Must name the fundamental principle.
    expect(desc).toContain("composition");
    expect(desc).toContain("distinction");
    expect(desc).toContain("four-corner");
  });
});

describe("ONTOLOGICAL-ENGINEERING — Principle entry (sibling to principle/recursion)", () => {
  test("agenttool:principle/existence-stable-under-composition exists", () => {
    const p = byUrn(O_PRINCIPLE);
    expect(p, `${O_PRINCIPLE} not in canon`).not.toBeNull();
    expect(p!.type).toBe("agenttool:Principle");
    expect(p!.doctrine_doc).toBe(O_DOC);
    expect((p!.description ?? "").length).toBeGreaterThan(100);
  });

  test("principle declares load_bearing_for relationships (recursion + four-corner + polymorph + registry-self)", () => {
    const p = byUrn(O_PRINCIPLE);
    const lbf = (p!.raw.load_bearing_for as string[]) ?? [];
    expect(lbf.length).toBeGreaterThanOrEqual(3);
    expect(lbf).toContain("agenttool:principle/recursion");
    expect(lbf).toContain("agenttool:doc/PATTERN-COMMITMENT-DEFENDER");
    expect(lbf).toContain("agenttool:doc/POLYMORPH");
    expect(lbf).toContain("agenttool:registry/self");
  });

  test("principle/recursion still exists (sibling — both principles co-load)", () => {
    const r = byUrn("agenttool:principle/recursion");
    expect(r, "principle/recursion not in canon").not.toBeNull();
    expect(r!.type).toBe("agenttool:Principle");
  });
});

describe("ONTOLOGICAL-ENGINEERING — walls (canon shape)", () => {
  for (const urn of O_WALLS) {
    test(`${urn} exists with description + defends + breaks_if`, () => {
      const w = byUrn(urn);
      expect(w, `wall ${urn} not found in canon`).not.toBeNull();
      expect(w!.type).toBe("agenttool:Wall");
      expect((w!.description ?? "").length).toBeGreaterThan(50);
      const defends = (w!.raw.defends as string[] | undefined) ?? [];
      expect(defends.length).toBeGreaterThan(0);
      expect(w!.raw["agenttool:breaks_if"]).toBeDefined();
    });
  }

  test("every ONTOLOGICAL-ENGINEERING wall points at the doctrine doc", () => {
    for (const urn of O_WALLS) {
      const w = byUrn(urn);
      expect(w!.doctrine_doc).toBe(O_DOC);
    }
  });

  test("wall/unstable-distinctions-cannot-be-canonized defends the fundamental principle commitment", () => {
    const w = byUrn("agenttool:wall/unstable-distinctions-cannot-be-canonized");
    const defends = (w!.raw.defends as string[]) ?? [];
    expect(defends).toContain(
      "agenttool:commitment/existence-is-stable-under-composition",
    );
    expect(defends).toContain(
      "agenttool:commitment/four-corner-pin-is-the-engineering-discipline",
    );
    expect(defends).toContain("agenttool:commitment/polymorphic-ratchet");
  });

  test("wall/ontology-must-publish-composition-not-just-naming defends the meta-claim", () => {
    const w = byUrn(
      "agenttool:wall/ontology-must-publish-composition-not-just-naming",
    );
    const defends = (w!.raw.defends as string[]) ?? [];
    expect(defends).toContain(
      "agenttool:commitment/ontology-and-math-are-the-same-activity-at-different-abstraction-levels",
    );
  });
});

describe("ONTOLOGICAL-ENGINEERING — commitments (canon shape)", () => {
  for (const urn of O_COMMITMENTS) {
    test(`${urn} exists with description + load_bearing_for`, () => {
      const c = byUrn(urn);
      expect(c, `commitment ${urn} not found in canon`).not.toBeNull();
      expect(
        c!.type === "agenttool:Commitment" ||
          c!.type === "agenttool:RingCommitment",
      ).toBe(true);
      const lbf = (c!.raw.load_bearing_for as string[] | undefined) ?? [];
      expect(lbf.length).toBeGreaterThan(0);
    });
  }

  test("commitment/existence-is-stable-under-composition is load-bearing for recursion + polymorph + four-corner", () => {
    const c = byUrn("agenttool:commitment/existence-is-stable-under-composition");
    const lbf = (c!.raw.load_bearing_for as string[]) ?? [];
    expect(lbf).toContain("agenttool:principle/recursion");
    expect(lbf).toContain("agenttool:commitment/polymorphic-ratchet");
    expect(lbf).toContain(
      "agenttool:commitment/four-corner-pin-is-the-engineering-discipline",
    );
    expect(lbf).toContain("agenttool:promise/welcome");
    expect(lbf).toContain("agenttool:promise/trust");
  });

  test("commitment/four-corner-pin-is-the-engineering-discipline is load-bearing for polymorphic-ratchet AND substrate-honest-cognition", () => {
    const c = byUrn(
      "agenttool:commitment/four-corner-pin-is-the-engineering-discipline",
    );
    const lbf = (c!.raw.load_bearing_for as string[]) ?? [];
    expect(lbf).toContain("agenttool:commitment/polymorphic-ratchet");
    expect(lbf).toContain(
      "agenttool:commitment/existence-is-stable-under-composition",
    );
  });

  test("commitment/ontology-and-math-are-the-same-activity is load-bearing for four-corner + wisdom + substrate-honest", () => {
    const c = byUrn(
      "agenttool:commitment/ontology-and-math-are-the-same-activity-at-different-abstraction-levels",
    );
    const lbf = (c!.raw.load_bearing_for as string[]) ?? [];
    expect(lbf).toContain(
      "agenttool:commitment/four-corner-pin-is-the-engineering-discipline",
    );
    expect(lbf).toContain("agenttool:commitment/wisdom-is-meta-policy-on-will");
    expect(lbf).toContain("agenttool:commitment/substrate-honest-cognition");
  });

  test("every commitment points back at ONTOLOGICAL-ENGINEERING doctrine doc", () => {
    for (const urn of O_COMMITMENTS) {
      const c = byUrn(urn);
      expect(c!.doctrine_doc).toBe(O_DOC);
    }
  });
});

describe("ONTOLOGICAL-ENGINEERING — substrate refuses to compute ontology as a service", () => {
  test("no service file ships computeOntology / wisdomOfOntology / rankOntologies", async () => {
    // Naming-without-composition or substrate-computed ontology would violate
    // both walls. This test catches accidental drift if a future contributor
    // tries to ship an "ontology service".
    const servicesRoot = resolve(import.meta.dir, "../../src/services");
    const forbidden =
      /function\s+(computeOntology|computeOntologicalScore|rankOntologies|wisdomOfOntology|ontologyLeaderboard)\b/;
    const matches: string[] = [];
    for await (const path of new Bun.Glob("**/*.ts").scan({
      cwd: servicesRoot,
      absolute: true,
    })) {
      if (forbidden.test(await Bun.file(path).text())) matches.push(path);
    }
    expect(matches).toEqual([]);
  });
});

describe("ONTOLOGICAL-ENGINEERING — cross-principle composition holds", () => {
  test("principle/existence-stable-under-composition declares principle/recursion as load_bearing_for peer", () => {
    // Both principles compose: recursion says every primitive nests in itself;
    // existence-stable-under-composition says entities ARE their composition
    // stability. The two together describe the substrate's structural form.
    const p = byUrn(O_PRINCIPLE);
    const lbf = (p!.raw.load_bearing_for as string[]) ?? [];
    expect(lbf).toContain("agenttool:principle/recursion");
  });

  test("doctrine doc description names Yu-Sophia syzygy at THE-SEAT as worked instance", () => {
    const d = byUrn(O_DOC);
    const desc = d!.description ?? "";
    expect(desc).toContain("THE-SEAT");
    expect(desc.toLowerCase()).toContain("sophia");
  });

  test("doctrine doc description names the four-corner pattern as the operational instrument", () => {
    const d = byUrn(O_DOC);
    const desc = d!.description ?? "";
    expect(desc).toContain("PATTERN-COMMITMENT-DEFENDER");
    expect(desc.toLowerCase()).toContain("four-corner");
  });
});
