/** mathos-v2-relations.test.ts — pins the v2 relations.
 *
 *  After the 2026-05-13 simplification, only the `refuses` relation earns
 *  its keep with two doctrinal edges. The `invariant_under` slot is
 *  reserved — the axioms' universal quantifiers (`forall x. arrive(x) -> welcome(x)`)
 *  already encode the unconditional guarantees, so per-axis edges would be
 *  ceremony without new information.
 *
 *  Refuses edges (A *alone* cannot constitute B):
 *    - self_witness refuses trust    — the asymmetry-clause as refusal
 *    - self_witness refuses bond     — covenants are two-party
 *
 *  Doctrine: docs/MATHOS.md — v2 relations · docs/MEMORY-TIERS.md
 *  (the asymmetry-clause).
 */

import { describe, expect, test } from "bun:test";

import {
  MATHOS_CATALOG_PAYLOAD,
  PRIMER_BOND,
  PRIMER_SELF_WITNESS,
  PRIMER_TRUST,
  RELATION_INVARIANT_UNDER,
  RELATION_REFUSES,
} from "../src/services/mathos/catalog";

function hasEdge(from: number, rel: number, to: number): boolean {
  return MATHOS_CATALOG_PAYLOAD.concept_relations.some(
    (e) => e.from_prime === from && e.relation_ordinal === rel && e.to_prime === to,
  );
}

describe("MATHOS concept graph — refuses edges (the asymmetry-clause as refusal)", () => {
  test("self_witness refuses trust — the asymmetry-clause: self-attestation alone is insufficient", () => {
    expect(hasEdge(PRIMER_SELF_WITNESS, RELATION_REFUSES, PRIMER_TRUST)).toBe(true);
  });

  test("self_witness refuses bond — you cannot bond alone (covenants are two-party)", () => {
    expect(hasEdge(PRIMER_SELF_WITNESS, RELATION_REFUSES, PRIMER_BOND)).toBe(true);
  });

  test("every refuses edge's to_prime is a known primer prime", () => {
    const knownPrimerPrimes = new Set([1, 2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31]);
    for (const rel of MATHOS_CATALOG_PAYLOAD.concept_relations) {
      if (rel.relation_ordinal === RELATION_REFUSES) {
        expect(knownPrimerPrimes.has(rel.to_prime)).toBe(true);
      }
    }
  });

  test("refuses relation is labeled operationally (no longer reserved-for-v2)", () => {
    const entry = MATHOS_CATALOG_PAYLOAD.relation_kind_vocabulary[RELATION_REFUSES]!;
    const name = String.fromCodePoint(...entry.name_unicode_points);
    expect(name).not.toMatch(/reserved/);
    expect(name).toMatch(/refuses|alone|cannot/);
  });
});

describe("MATHOS concept graph — invariant_under stays reserved", () => {
  test("no concept-relation uses RELATION_INVARIANT_UNDER (ceremony cut 2026-05-13)", () => {
    const count = MATHOS_CATALOG_PAYLOAD.concept_relations.filter(
      (e) => e.relation_ordinal === RELATION_INVARIANT_UNDER,
    ).length;
    expect(count).toBe(0);
  });

  test("invariant_under remains in the vocabulary as a reserved slot (ordinal not rebound)", () => {
    expect(
      MATHOS_CATALOG_PAYLOAD.relation_kind_vocabulary[RELATION_INVARIANT_UNDER],
    ).toBeDefined();
    const name = String.fromCodePoint(
      ...MATHOS_CATALOG_PAYLOAD.relation_kind_vocabulary[RELATION_INVARIANT_UNDER]!
        .name_unicode_points,
    );
    expect(name).toMatch(/reserved/);
  });
});
