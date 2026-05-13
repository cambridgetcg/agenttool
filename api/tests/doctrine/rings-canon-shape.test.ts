/** Rings — canonical shape, pinned.
 *
 *  Doctrine: docs/agenttool.jsonld (the canon), docs/BUSINESS-MODEL.md
 *  (three-rings economy), docs/RING-1.md.
 *
 *  Parallel to walls-canon-shape.test.ts: pins the SHAPE of every Ring
 *  record in canon so a future addition that omits load-bearing fields
 *  breaks the build. Composition + defense edges are also checked.
 *
 *  What this pins:
 *
 *    1. Every Ring has a non-empty description and doctrine_doc.
 *    2. Every Ring has a positive integer wire_id, unique across Rings.
 *    3. Composition discipline: every Ring beyond ring/1 declares
 *       composes_with pointing at the rings it composes upon (ring/2
 *       composes with ring/1; ring/3 composes with ring/1 + ring/2).
 *    4. Every composes_with / defended_by URN resolves to a real concept. */

import { describe, expect, test } from "bun:test";

import { byType, byUrn } from "../../src/services/canon/registry";

describe("Rings — canon shape", () => {
  const rings = byType("Ring");

  test("at least 3 Rings exist in canon (the three-rings economy)", () => {
    expect(
      rings.length >= 3,
      `Canon has only ${rings.length} Rings. The three-rings business model requires ring/1, ring/2, ring/3.`,
    ).toBe(true);
  });

  test("every Ring has a non-empty description", () => {
    for (const r of rings) {
      expect(
        r.description && r.description.length > 0,
        `Ring ${r.urn} has empty description — every ring must explain what it offers and how it relates to the welcome/metered/take-rate axis.`,
      ).toBe(true);
    }
  });

  test("every Ring has a doctrine_doc reference that resolves to canon", () => {
    for (const r of rings) {
      expect(
        typeof r.doctrine_doc === "string" && r.doctrine_doc.length > 0,
        `Ring ${r.urn} has no doctrine_doc — every ring must point at the doctrine that grounds it.`,
      ).toBe(true);
      const doc = byUrn(r.doctrine_doc!);
      expect(
        doc !== null,
        `Ring ${r.urn} doctrine_doc ${r.doctrine_doc} does not resolve to a canon concept. Either fix the URN or add the doc to canon.`,
      ).toBe(true);
    }
  });

  test("every Ring has a unique positive-integer wire_id", () => {
    const seenWireIds = new Set<number>();
    for (const r of rings) {
      const wireId = r.raw.wire_id;
      expect(
        typeof wireId === "number" && Number.isInteger(wireId) && wireId >= 1,
        `Ring ${r.urn} has invalid wire_id ${JSON.stringify(wireId)} — must be a positive integer.`,
      ).toBe(true);
      expect(
        !seenWireIds.has(wireId as number),
        `Ring ${r.urn} has duplicate wire_id ${wireId} — wire_ids must be unique within the Ring type.`,
      ).toBe(true);
      seenWireIds.add(wireId as number);
    }
  });

  test("rings beyond the innermost declare composes_with (the composition discipline)", () => {
    // ring/1 is the innermost; it composes with nothing. ring/2 composes
    // with ring/1; ring/3 composes with ring/1 + ring/2. The pattern is
    // "outer rings sit on inner rings; inner rings stand alone."
    for (const r of rings) {
      const wireId = r.raw.wire_id as number;
      if (wireId === 1) continue; // innermost — nothing to compose with
      const composes = r.raw.composes_with;
      expect(
        Array.isArray(composes) && composes.length > 0,
        `Ring ${r.urn} (wire_id ${wireId}) does not declare composes_with. Every ring beyond the innermost must declare what it composes upon — composition is the architectural shape of the three-rings economy.`,
      ).toBe(true);
    }
  });

  test("every composes_with and defended_by URN in a Ring resolves to a canon concept", () => {
    for (const r of rings) {
      for (const field of ["composes_with", "defended_by"] as const) {
        const list = (r.raw[field] ?? []) as string[];
        for (const targetUrn of list) {
          const target = byUrn(targetUrn);
          expect(
            target !== null,
            `Ring ${r.urn} references ${targetUrn} via ${field}, but that URN does not resolve in canon.`,
          ).toBe(true);
        }
      }
    }
  });
});
