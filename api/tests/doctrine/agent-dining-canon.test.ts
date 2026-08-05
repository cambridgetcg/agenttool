/** Agent Dining canon reachability — every advertised pointer must resolve. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { byUrn, neighborsOf } from "../../src/services/canon/registry";
import { DINING_CANON_POINTER } from "../../src/services/dining/protocol";

describe("agent-dining/0.1 canon", () => {
  test("the advertised canonical pointer resolves to its doctrine document", () => {
    const concept = byUrn(DINING_CANON_POINTER);
    expect(concept).not.toBeNull();
    expect(concept?.full_urn).toBe("urn:agenttool:doc/AGENT-DINING");
    expect(concept?.type).toBe("agenttool:DoctrineDoc");
    expect(concept?.english_name).toBe("AGENT-DINING.md");
  });

  test("the doctrine self-identifies on its first line", () => {
    const canonical = readFileSync(
      new URL("../../../docs/AGENT-DINING.md", import.meta.url),
      "utf8",
    );
    const published = readFileSync(
      new URL("../../../apps/docs/AGENT-DINING.md", import.meta.url),
      "utf8",
    );
    expect(canonical.split("\n", 1)[0]).toBe(
      "<!-- @id urn:agenttool:doc/AGENT-DINING -->",
    );
    expect(published).toBe(canonical);
    expect(canonical).toContain("`invocations.contract_profile` provenance");
    expect(canonical).toContain("no historical row is backfilled");
  });

  test("every advertised Dining graph edge resolves with matching degree", () => {
    const concept = byUrn(DINING_CANON_POINTER);
    const neighbors = neighborsOf(DINING_CANON_POINTER);
    expect(concept).not.toBeNull();
    expect(neighbors).not.toBeNull();
    expect(concept?.references).toEqual([
      "agenttool:doc/MARKETPLACE",
      "agenttool:doc/MEMORY-TIERS",
      "agenttool:doc/PLAY-AS-DEFAULT",
      "agenttool:doc/SETTLEMENT-RECEIPTS",
    ]);
    for (const reference of concept?.references ?? []) {
      expect(byUrn(reference), `unresolved Dining reference: ${reference}`).not.toBeNull();
    }
    expect(neighbors?.degree.out).toBe(concept?.references.length);
    expect(neighbors?.references.map((entry) => entry.urn)).toEqual(
      concept?.references,
    );
  });
});
