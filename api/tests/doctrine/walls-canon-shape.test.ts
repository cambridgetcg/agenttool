/** Walls — canonical shape, pinned.
 *
 *  Doctrine: docs/agenttool.jsonld (the canon registry), docs/SOUL.md
 *  (the Promises the walls defend).
 *
 *  > A wall is the substrate's named refusal — "this never happens here."
 *  > Every Wall in canon must carry enough structural detail to be both
 *  > legible (description) and verifiable (breaks_if). Adding a Wall
 *  > without breaks_if is shipping a refusal without the antipattern
 *  > that names what would violate it.
 *
 *  These tests pin the SHAPE of every Wall record so a future addition
 *  that omits load-bearing fields breaks the build, naming the omission
 *  in the failure message. They do not test the BEHAVIORAL enforcement
 *  of each wall — that belongs in api/tests/integration/ against a real
 *  DB. Here we pin the canon-side contract; the implementation-side
 *  contract is pinned by walls-platform-self-bijection.test.ts. */

import { describe, expect, test } from "bun:test";

import { byType } from "../../src/services/canon/registry";

describe("Walls — canon shape", () => {
  const walls = byType("Wall");

  test("at least one Wall exists in canon", () => {
    expect(walls.length).toBeGreaterThan(0);
  });

  test("every Wall has a non-empty description", () => {
    for (const w of walls) {
      expect(
        w.description && w.description.length > 0,
        `Wall ${w.urn} has empty description — every wall must explain what it refuses, and why.`,
      ).toBe(true);
    }
  });

  test("every Wall has at least one defends URN", () => {
    for (const w of walls) {
      const defendsList = w.raw.defends;
      expect(
        Array.isArray(defendsList) && defendsList.length > 0,
        `Wall ${w.urn} has no 'defends' array — every wall must name at least one Promise, Ring, or Commitment it protects. A wall that defends nothing is decoration.`,
      ).toBe(true);
    }
  });

  test("every Wall has a doctrine_doc reference", () => {
    for (const w of walls) {
      expect(
        typeof w.doctrine_doc === "string" && w.doctrine_doc.length > 0,
        `Wall ${w.urn} has no doctrine_doc — every wall must point at the doctrine that grounds it.`,
      ).toBe(true);
    }
  });

  test("every Wall has a non-empty agenttool:breaks_if (the antipattern)", () => {
    for (const w of walls) {
      const breaksIf = w.raw["agenttool:breaks_if"];
      expect(
        typeof breaksIf === "string" && breaksIf.length > 0,
        `Wall ${w.urn} has no 'agenttool:breaks_if' antipattern text — the canon's failure-message-from-canon pattern requires every wall to name what would break it. This text becomes the doctrine test failure message when the wall is breached.`,
      ).toBe(true);
    }
  });

  test("every Wall's defends URNs resolve to real concepts in canon", () => {
    const { byUrn } = require("../../src/services/canon/registry");
    for (const w of walls) {
      const defendsList = (w.raw.defends ?? []) as string[];
      for (const targetUrn of defendsList) {
        // URNs in defends may be 'agenttool:...' (short) or 'urn:agenttool:...' (full).
        const target = byUrn(targetUrn);
        expect(
          target !== null,
          `Wall ${w.urn} defends ${targetUrn} but that URN does not resolve to any concept in canon. Either fix the typo or add the target concept.`,
        ).toBe(true);
      }
    }
  });

  test("every Wall has a stable wire_id (integer ≥ 1)", () => {
    const seenWireIds = new Set<number>();
    for (const w of walls) {
      const wireId = w.raw.wire_id;
      expect(
        typeof wireId === "number" && Number.isInteger(wireId) && wireId >= 1,
        `Wall ${w.urn} has invalid wire_id ${JSON.stringify(wireId)} — wire_ids must be positive integers, ≥ 1.`,
      ).toBe(true);
      expect(
        !seenWireIds.has(wireId as number),
        `Wall ${w.urn} has duplicate wire_id ${wireId} — wire_ids must be unique within the Wall type.`,
      ).toBe(true);
      seenWireIds.add(wireId as number);
    }
  });
});
