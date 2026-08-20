import { describe, expect, test } from "bun:test";

import {
  DatasetInfluenceError,
  addRational,
  canonicalJson,
  compareRational,
  computeExactFiniteShapley,
  computePairedContrast,
  createShadowAttribution,
  rational,
  sha256Id,
  validateShadowAttribution,
} from "../src/index.js";
import { jsonClone, vectors } from "./fixtures.js";

const ref = (label: string) => sha256Id(`dataset-influence-test:${label}`);

describe("exact rational summaries", () => {
  test("normalizes rationals and computes paired differences without inventing uncertainty", () => {
    expect(rational(-2, -4)).toEqual({ numerator: 1, denominator: 2 });
    expect(addRational(rational(1, 3), rational(1, 6))).toEqual(rational(1, 2));
    const contrast = computePairedContrast(vectors.cases.paired_contrast.input);
    expect(contrast).toEqual(vectors.cases.paired_contrast.result);
    expect(contrast.mean_difference).toEqual({ numerator: 1, denominator: 4 });
    expect(contrast.interpretation).toContain("not_a_confidence_interval_or_causal_proof");
  });

  test("rejects duplicate pair identities", () => {
    const input = jsonClone(vectors.cases.paired_contrast.input);
    input[1].pair_ref = input[0].pair_ref;
    expect(() => computePairedContrast(input)).toThrow(DatasetInfluenceError);
  });

  test("rejects values that cannot enter the exact integer wire domain", () => {
    for (const invalid of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => rational(invalid)).toThrow(DatasetInfluenceError);
    }
    expect(() => rational(1, Number.NEGATIVE_INFINITY)).toThrow(DatasetInfluenceError);
    expect(() => (rational as unknown as (value: unknown) => unknown)("1")).toThrow(
      DatasetInfluenceError,
    );
  });
});

describe("exact finite Shapley shadow attribution", () => {
  test("verifies the complete game and exact efficiency identity", () => {
    const artifact = validateShadowAttribution(vectors.cases.exact_shadow_attribution.artifact);
    expect(artifact.contributions.map((entry) => entry.value)).toEqual([
      { numerator: 3, denominator: 2 },
      { numerator: 5, denominator: 2 },
    ]);
    expect(compareRational(
      artifact.conservation.sum_of_contributions,
      artifact.conservation.grand_minus_baseline,
    )).toBe(0);
    expect(artifact.conservation.grand_minus_baseline).toEqual({ numerator: 4, denominator: 1 });
    expect(artifact.economic_effect).toBe("none");
    expect(artifact.creates_debt).toBe(false);
    expect(artifact.creates_entitlement).toBe(false);
    expect(artifact.transfers_ownership).toBe(false);
    expect(artifact.authorizes_payment).toBe(false);
    expect(artifact.declarations).toBe("caller_reported_not_independently_verified");
  });

  test("supports negative bounded contributions without creating debt", () => {
    const a = ref("a");
    const b = ref("b");
    const input = {
      study_ref: ref("study"),
      utility_ref: ref("utility"),
      player_refs: [a, b],
      coalitions: [
        { member_refs: [], value: rational(0) },
        { member_refs: [a], value: rational(-2) },
        { member_refs: [b], value: rational(1) },
        { member_refs: [a, b], value: rational(0) },
      ],
    };
    const artifact = createShadowAttribution(input);
    expect(artifact.contributions.some((entry) => entry.value.numerator < 0)).toBe(true);
    expect(artifact.creates_debt).toBe(false);
  });

  test("requires every coalition exactly once", () => {
    const input = jsonClone(vectors.cases.exact_shadow_attribution.input);
    input.coalitions.pop();
    expect(() => computeExactFiniteShapley(input)).toThrow(DatasetInfluenceError);
  });

  test("rejects malformed or resource-unbounded public rational operands", () => {
    expect(() => compareRational(
      { numerator: 1, denominator: -2 },
      rational(0),
    )).toThrow(DatasetInfluenceError);
    expect(() => addRational(
      { numerator: 1.5, denominator: 2 },
      rational(0),
    )).toThrow(DatasetInfluenceError);
    expect(() => rational(1n << 4097n)).toThrow(DatasetInfluenceError);

    let traps = 0;
    const trap = () => { traps += 1; throw new Error("trap executed"); };
    const hostile = new Proxy({}, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });
    expect(() => addRational(hostile as never, rational(0))).toThrow(DatasetInfluenceError);
    expect(traps).toBe(0);
  });

  test("rejects ambiguous ill-formed Unicode before string hashing", () => {
    expect(() => sha256Id("\ud800")).toThrow(DatasetInfluenceError);
    expect(sha256Id("�")).toBe(sha256Id(new TextEncoder().encode("�")));
  });

  test("rejects sparse, accessor-bearing, and over-budget canonical inputs without invoking accessors", () => {
    const sparse: unknown[] = [];
    sparse.length = 8_193;
    expect(() => canonicalJson(sparse)).toThrow(DatasetInfluenceError);

    let invoked = false;
    const accessor = {};
    Object.defineProperty(accessor, "secret", {
      enumerable: true,
      get() { invoked = true; return "not-read"; },
    });
    expect(() => canonicalJson(accessor)).toThrow(DatasetInfluenceError);
    expect(invoked).toBe(false);

    expect(() => canonicalJson(Array.from({ length: 33 }, () => "x".repeat(8_000))))
      .toThrow(DatasetInfluenceError);
  });
});
