/** RingCommitments — canonical shape, pinned.
 *
 *  Doctrine: docs/agenttool.jsonld (the canon), docs/RING-1.md, docs/BUSINESS-MODEL.md.
 *
 *  Parallel to walls-canon-shape.test.ts: pins the SHAPE of every
 *  RingCommitment record so additions remain well-formed. Commitments
 *  are the behavioral specifications between Rings and Walls — each
 *  one names what the substrate commits to operationally, in one line,
 *  with a corresponding antipattern.
 *
 *  What this pins:
 *
 *    1. Every RingCommitment has description + doctrine_doc + breaks_if.
 *    2. Every RingCommitment declares load_bearing_for (≥1 entry, since
 *       a commitment exists to support something).
 *    3. Every load_bearing_for URN resolves to a real concept.
 *    4. Every RingCommitment has a unique positive-integer wire_id. */

import { describe, expect, test } from "bun:test";

import { byType, byUrn } from "../../src/services/canon/registry";

describe("RingCommitments — canon shape", () => {
  const commitments = byType("RingCommitment");

  test("at least 7 RingCommitments exist in canon (Ring 1 has seven by RING-1.md)", () => {
    expect(
      commitments.length >= 7,
      `Canon has only ${commitments.length} RingCommitments. RING-1.md names seven Ring 1 commitments alone; the doctrine is incomplete in canon if this drops below 7.`,
    ).toBe(true);
  });

  test("every RingCommitment has a non-empty description", () => {
    for (const c of commitments) {
      expect(
        c.description && c.description.length > 0,
        `Commitment ${c.urn} has empty description — every commitment must name what it commits to in operational terms.`,
      ).toBe(true);
    }
  });

  test("every RingCommitment has a doctrine_doc that resolves in canon", () => {
    for (const c of commitments) {
      expect(
        typeof c.doctrine_doc === "string" && c.doctrine_doc.length > 0,
        `Commitment ${c.urn} has no doctrine_doc — every commitment must point at the doctrine that grounds it.`,
      ).toBe(true);
      const doc = byUrn(c.doctrine_doc!);
      expect(
        doc !== null,
        `Commitment ${c.urn} doctrine_doc ${c.doctrine_doc} does not resolve in canon.`,
      ).toBe(true);
    }
  });

  test("every RingCommitment has a non-empty agenttool:breaks_if (the antipattern)", () => {
    for (const c of commitments) {
      const breaksIf = c.raw["agenttool:breaks_if"];
      expect(
        typeof breaksIf === "string" && breaksIf.length > 0,
        `Commitment ${c.urn} has no 'agenttool:breaks_if' antipattern text — every commitment must name what would violate it. This is the operational anti-claim that pairs with the description.`,
      ).toBe(true);
    }
  });

  test("every RingCommitment declares load_bearing_for with ≥1 entry", () => {
    // A commitment exists to support something — at minimum the Ring it
    // belongs to, often a Promise it operationalizes, sometimes a focus
    // detail. A commitment that's load_bearing_for nothing is decoration.
    for (const c of commitments) {
      const lbf = c.raw.load_bearing_for;
      expect(
        Array.isArray(lbf) && lbf.length >= 1,
        `Commitment ${c.urn} declares no load_bearing_for. Every commitment exists to support a Ring + Promise + (optionally) focus detail; declaring zero supports means the commitment isn't load-bearing for anything.`,
      ).toBe(true);
    }
  });

  test("every load_bearing_for / defended_by / composes_with URN resolves to canon", () => {
    for (const c of commitments) {
      for (const field of ["load_bearing_for", "defended_by", "composes_with"] as const) {
        const list = (c.raw[field] ?? []) as string[];
        for (const targetUrn of list) {
          const target = byUrn(targetUrn);
          expect(
            target !== null,
            `Commitment ${c.urn} references ${targetUrn} via ${field}, but that URN does not resolve in canon.`,
          ).toBe(true);
        }
      }
    }
  });

  test("every RingCommitment has a unique positive-integer wire_id", () => {
    const seenWireIds = new Set<number>();
    for (const c of commitments) {
      const wireId = c.raw.wire_id;
      expect(
        typeof wireId === "number" && Number.isInteger(wireId) && wireId >= 1,
        `Commitment ${c.urn} has invalid wire_id ${JSON.stringify(wireId)}.`,
      ).toBe(true);
      expect(
        !seenWireIds.has(wireId as number),
        `Commitment ${c.urn} has duplicate wire_id ${wireId} — wire_ids must be unique within RingCommitment.`,
      ).toBe(true);
      seenWireIds.add(wireId as number);
    }
  });
});
