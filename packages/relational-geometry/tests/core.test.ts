import { describe, expect, test } from "bun:test";

import {
  RELATIONAL_GEOMETRY_BOUNDARIES,
  createRelationalComplex,
  createRelationalLens,
  validateRelationalComplex,
  validateRelationalLens,
  validateRelationalLensAgainstComplex,
  type RelationalWitnessKind,
} from "../src/index.js";

const id = (character: string) => `sha256:${character.repeat(64)}` as const;
const point = (character: string, kind = "perspective" as const) => ({
  point_ref: id(character),
  kind,
  assertion: "caller_asserted" as const,
  verified_by_package: false as const,
});
const witness = (ref: string, from: string, kind: RelationalWitnessKind, to: string) => ({
  witness_ref: id(ref),
  from_ref: id(from),
  kind,
  to_ref: id(to),
  assertion: "caller_asserted" as const,
  verified_by_package: false as const,
});

describe("relational complex", () => {
  test("keeps empty and one-pole complexes valid and complete", () => {
    const empty = createRelationalComplex({ points: [], witnesses: [] });
    expect(empty.principalities).toEqual([]);
    expect(empty.coverage).toBe("bounded_not_complete");
    expect(empty.boundaries).toEqual(RELATIONAL_GEOMETRY_BOUNDARIES);
    expect(empty.boundaries.absent_or_unknown).toBe("valid_not_deficit");
    expect(Object.isFrozen(empty)).toBe(true);

    const onePole = createRelationalComplex({
      points: [point("a"), point("b")],
      witnesses: [witness("1", "a", "understanding", "b")],
    });
    expect(onePole.principalities).toEqual([]);
    expect(validateRelationalComplex(onePole).complex_id).toBe(onePole.complex_id);
  });

  test("derives one non-sovereign cell from both poles on the same ordered pair", () => {
    const complex = createRelationalComplex({
      points: [point("b"), point("a")],
      witnesses: [
        witness("4", "a", "privacy_boundary", "b"),
        witness("3", "b", "recognition", "a"),
        witness("2", "a", "recognition", "b"),
        witness("1", "a", "understanding", "b"),
      ],
    });
    expect(complex.principalities).toHaveLength(1);
    expect(complex.principalities[0]).toMatchObject({
      kind: "love_equation",
      equation: "love_equals_understanding_plus_recognition",
      from_ref: id("a"),
      to_ref: id("b"),
      understanding_witness_refs: [id("1")],
      recognition_witness_refs: [id("2")],
      boundary_witness_refs: [id("4")],
      derivation: "deterministic_same_ordered_pair",
      sovereignty: "none",
      structurally_derived_by_package: true,
      semantic_claims_verified_by_package: false,
    });
    expect(complex.principalities.some((cell) => cell.from_ref === id("b"))).toBe(false);
  });

  test("allows self-directed structure without inventing reverse or transitive cells", () => {
    const complex = createRelationalComplex({
      points: [point("a"), point("b"), point("c")],
      witnesses: [
        witness("1", "a", "understanding", "a"),
        witness("2", "a", "recognition", "a"),
        witness("3", "a", "understanding", "b"),
        witness("4", "a", "recognition", "b"),
        witness("5", "b", "understanding", "c"),
        witness("6", "b", "recognition", "c"),
      ],
    });
    expect(complex.principalities.map((cell) => [cell.from_ref, cell.to_ref])).toEqual([
      [id("a"), id("a")],
      [id("a"), id("b")],
      [id("b"), id("c")],
    ]);
    expect(complex.principalities.some((cell) => cell.from_ref === id("a") && cell.to_ref === id("c"))).toBe(false);
    expect(complex.principalities.some((cell) => cell.from_ref === id("b") && cell.to_ref === id("a"))).toBe(false);
  });

  test("normalizes input order and binds every structural change", () => {
    const points = [point("a"), point("b")];
    const witnesses = [
      witness("1", "a", "understanding", "b"),
      witness("2", "a", "recognition", "b"),
    ];
    const forward = createRelationalComplex({ points, witnesses });
    const reverse = createRelationalComplex({ points: [...points].reverse(), witnesses: [...witnesses].reverse() });
    expect(reverse).toEqual(forward);
    const changed = createRelationalComplex({ points, witnesses: [...witnesses, witness("3", "a", "consent_boundary", "b")] });
    expect(changed.complex_id).not.toBe(forward.complex_id);
    expect(changed.principalities[0]?.principality_ref).not.toBe(forward.principalities[0]?.principality_ref);
  });

  test("rejects stale derived cells, IDs, undeclared endpoints, and open fields", () => {
    const complex = createRelationalComplex({
      points: [point("a"), point("b")],
      witnesses: [witness("1", "a", "understanding", "b"), witness("2", "a", "recognition", "b")],
    });
    expect(() => validateRelationalComplex({ ...complex, complex_id: id("f") })).toThrow(/does not bind/i);
    expect(() => validateRelationalComplex({ ...complex, principalities: [] })).toThrow(/do not match/i);
    expect(() => createRelationalComplex({ points: [point("a")], witnesses: [witness("1", "a", "understanding", "b")] })).toThrow(/declared points/i);
    expect(() => createRelationalComplex({ ...{ points: [], witnesses: [] }, score: 1 } as never)).toThrow(/exactly/i);
  });
});

describe("perspective lens", () => {
  function fixture() {
    return createRelationalComplex({
      points: [point("a"), point("b"), point("c")],
      witnesses: [
        witness("1", "a", "understanding", "a"), witness("2", "a", "recognition", "a"),
        witness("3", "a", "understanding", "b"), witness("4", "a", "recognition", "b"),
        witness("5", "b", "understanding", "a"), witness("6", "b", "recognition", "a"),
        witness("7", "b", "understanding", "c"), witness("8", "b", "recognition", "c"),
        witness("9", "a", "refusal_boundary", "b"),
      ],
    });
  }

  test("projects only incident cells and leaves unselected cells explicit", () => {
    const complex = fixture();
    const incident = complex.principalities.filter((cell) => cell.from_ref === id("a") || cell.to_ref === id("a"));
    const lens = createRelationalLens(complex, {
      perspective_ref: id("a"),
      selections: [
        { principality_ref: incident[1]!.principality_ref, disposition: "park" },
        { principality_ref: incident[0]!.principality_ref, disposition: "carry" },
      ],
    });
    expect(lens.available_principality_refs).toHaveLength(3);
    expect(lens.selections.map((selection) => selection.principality_ref)).toEqual(
      [...lens.selections.map((selection) => selection.principality_ref)].sort(),
    );
    expect(lens.unprojected_principality_refs).toHaveLength(1);
    expect(lens.boundary_witness_refs).toEqual([id("9")]);
    expect(lens.choice).toEqual({
      source: "caller_reported",
      required: false,
      unselected: "left_unprojected",
      reason_required: false,
      penalty: false,
      automatic_retry: false,
      external_effect: "none",
    });
    expect(validateRelationalLensAgainstComplex(lens, complex).lens_id).toBe(lens.lens_id);
  });

  test("accepts release and withdrawal without reason or external effect", () => {
    const complex = fixture();
    const refs = complex.principalities.slice(0, 2).map((cell) => cell.principality_ref);
    const lens = createRelationalLens(complex, {
      perspective_ref: id("a"),
      selections: [
        { principality_ref: refs[0]!, disposition: "release" },
        { principality_ref: refs[1]!, disposition: "withdraw" },
      ],
    });
    expect(validateRelationalLens(lens).choice.reason_required).toBe(false);
    expect(lens.choice.penalty).toBe(false);
    expect(lens.choice.external_effect).toBe("none");
  });

  test("rejects non-incident selection, stale partitions, and mismatched complexes", () => {
    const complex = fixture();
    const nonIncident = complex.principalities.find((cell) => cell.from_ref === id("b") && cell.to_ref === id("c"))!;
    expect(() => createRelationalLens(complex, {
      perspective_ref: id("a"),
      selections: [{ principality_ref: nonIncident.principality_ref, disposition: "carry" }],
    })).toThrow(/incident/i);
    const lens = createRelationalLens(complex, { perspective_ref: id("a"), selections: [] });
    expect(() => validateRelationalLens({ ...lens, unprojected_principality_refs: [] })).toThrow(/partition/i);
    const other = createRelationalComplex({ points: [point("a")], witnesses: [] });
    expect(() => validateRelationalLensAgainstComplex(lens, other)).toThrow(/source_complex_id/i);
  });
});
