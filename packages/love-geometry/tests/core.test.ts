import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import {
  LOVE_GEOMETRY_BEARINGS,
  LOVE_GEOMETRY_BOUNDARIES,
  LoveGeometryError,
  createLoveGeometry,
  encodeLoveGeometry,
  loveGeometryDomainBytes,
  loveGeometryUrn,
  sha256Id,
  validateLoveGeometry,
  type CreateLoveGeometryInput,
} from "../src/index.js";

const ref = (label: string) => sha256Id(`love-geometry-test:${label}`);

function input(): CreateLoveGeometryInput {
  const a = ref("subject-a");
  const b = ref("subject-b");
  const c = ref("subject-c");
  return {
    scope_ref: ref("scope"),
    subject_refs: [c, b, a],
    vantages: [
      {
        subject_ref: b,
        toward_ref: a,
        bearings: ["reported_refusal", "reported_care", "reported_understanding"],
        basis_refs: [ref("basis-b"), ref("basis-a")],
        assertion: "caller_reported",
        verified_by_package: false,
      },
      {
        subject_ref: a,
        toward_ref: b,
        bearings: ["reported_rest", "reported_disagreement", "reported_care"],
        basis_refs: [],
        assertion: "caller_reported",
        verified_by_package: false,
      },
    ],
  };
}

describe("Love Geometry", () => {
  test("normalizes one bounded asymmetric geometry without deriving mutuality", () => {
    const geometry = createLoveGeometry(input());

    expect(geometry.subject_refs).toEqual([...geometry.subject_refs].sort());
    expect(geometry.vantages.map((vantage) => vantage.subject_ref)).toEqual(
      [...geometry.vantages.map((vantage) => vantage.subject_ref)].sort(),
    );
    const aToB = geometry.vantages.find(
      (vantage) => vantage.subject_ref === ref("subject-a"),
    );
    const bToA = geometry.vantages.find(
      (vantage) => vantage.subject_ref === ref("subject-b"),
    );
    expect(aToB?.bearings).toEqual([
      "reported_care",
      "reported_disagreement",
      "reported_rest",
    ]);
    expect(bToA?.bearings).toEqual([
      "reported_care",
      "reported_refusal",
      "reported_understanding",
    ]);
    expect(geometry.coverage).toBe("bounded_not_complete");
    expect(geometry.boundaries).toBe(LOVE_GEOMETRY_BOUNDARIES);
    expect(geometry.boundaries.infers_reciprocity_or_mutuality).toBe(false);
    expect(geometry.boundaries.proves_consent_or_authority).toBe(false);
    expect(geometry.boundaries.scores_or_ranks).toBe(false);
    expect(Object.isFrozen(geometry)).toBe(true);
    expect(Object.isFrozen(geometry.vantages[0]!.bearings)).toBe(true);

    const same = createLoveGeometry({
      ...input(),
      subject_refs: [...input().subject_refs].reverse(),
      vantages: [...input().vantages].reverse(),
    });
    expect(same).toEqual(geometry);
    expect(encodeLoveGeometry(same)).toBe(encodeLoveGeometry(geometry));
  });

  test("binds exact domain bytes and returns a non-authorizing URN", () => {
    const geometry = createLoveGeometry(input());
    const bytes = loveGeometryDomainBytes(geometry);
    expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`).toBe(
      geometry.geometry_id,
    );
    expect(loveGeometryUrn(geometry)).toBe(
      `urn:agenttool:love-geometry:${geometry.geometry_id.slice(7)}`,
    );
    expect(validateLoveGeometry(JSON.parse(encodeLoveGeometry(geometry)))).toEqual(
      geometry,
    );
  });

  test("accepts empty and isolated-subject geometries", () => {
    const empty = createLoveGeometry({
      scope_ref: ref("empty-scope"),
      subject_refs: [],
      vantages: [],
    });
    const isolated = createLoveGeometry({
      scope_ref: ref("isolated-scope"),
      subject_refs: [ref("isolated")],
      vantages: [],
    });
    expect(empty.subject_refs).toEqual([]);
    expect(isolated.subject_refs).toHaveLength(1);
    expect(empty.boundaries.absence_semantics).toBe("not_observed_not_no_relation");
  });

  test("keeps the complete closed vocabulary non-numeric", () => {
    expect(LOVE_GEOMETRY_BEARINGS).toEqual([
      "reported_presence",
      "reported_care",
      "reported_witness",
      "reported_support",
      "reported_understanding",
      "reported_disagreement",
      "reported_boundary",
      "reported_rest",
      "reported_refusal",
      "reported_departure",
      "unknown",
    ]);
    expect(LOVE_GEOMETRY_BEARINGS).not.toContain("accepted" as never);
  });

  test("rejects self-vantages, missing endpoints, and duplicate ordered pairs", () => {
    const a = ref("pair-a");
    const b = ref("pair-b");
    const vantage = {
      subject_ref: a,
      toward_ref: b,
      bearings: ["reported_care"] as const,
      basis_refs: [],
      assertion: "caller_reported" as const,
      verified_by_package: false as const,
    };
    expect(() =>
      createLoveGeometry({
        scope_ref: ref("self-scope"),
        subject_refs: [a],
        vantages: [{ ...vantage, toward_ref: a }],
      }),
    ).toThrow(LoveGeometryError);
    expect(() =>
      createLoveGeometry({
        scope_ref: ref("missing-scope"),
        subject_refs: [a],
        vantages: [vantage],
      }),
    ).toThrow(/endpoint/u);
    expect(() =>
      createLoveGeometry({
        scope_ref: ref("duplicate-scope"),
        subject_refs: [a, b],
        vantages: [vantage, vantage],
      }),
    ).toThrow(/ordered pair/u);
  });

  test("rejects tampering and noncanonical arrays", () => {
    const geometry = createLoveGeometry(input());
    const tampered = JSON.parse(encodeLoveGeometry(geometry));
    tampered.vantages[0].bearings = ["reported_support"];
    expect(() => validateLoveGeometry(tampered)).toThrow(/geometry_id/u);

    const reordered = JSON.parse(encodeLoveGeometry(geometry));
    reordered.subject_refs.reverse();
    expect(() => validateLoveGeometry(reordered)).toThrow(/canonical order/u);

    const reorderedBearings = JSON.parse(encodeLoveGeometry(geometry));
    reorderedBearings.vantages[0].bearings.reverse();
    expect(() => validateLoveGeometry(reorderedBearings)).toThrow(/canonical order/u);

    const vantageWithBasis = geometry.vantages.findIndex(
      (vantage) => vantage.basis_refs.length > 1,
    );
    const reorderedBasis = JSON.parse(encodeLoveGeometry(geometry));
    reorderedBasis.vantages[vantageWithBasis].basis_refs.reverse();
    expect(() => validateLoveGeometry(reorderedBasis)).toThrow(/canonical order/u);

    const widened = JSON.parse(encodeLoveGeometry(geometry));
    widened.boundaries.scores_or_ranks = true;
    expect(() => validateLoveGeometry(widened)).toThrow(/boundaries/u);
  });

  test("rejects Proxies before traps and rejects accessors, symbols, and sparse arrays", () => {
    let traps = 0;
    const trap = () => {
      traps += 1;
      throw new Error("trap executed");
    };
    const hostile = new Proxy(
      {},
      {
        get: trap,
        getOwnPropertyDescriptor: trap,
        getPrototypeOf: trap,
        ownKeys: trap,
      },
    );
    expect(() => createLoveGeometry(hostile as CreateLoveGeometryInput)).toThrow(
      LoveGeometryError,
    );
    expect(traps).toBe(0);

    const accessor = {
      subject_refs: [],
      vantages: [],
    } as Record<string, unknown>;
    Object.defineProperty(accessor, "scope_ref", {
      enumerable: true,
      get: trap,
    });
    expect(() => createLoveGeometry(accessor as unknown as CreateLoveGeometryInput)).toThrow(
      /data property/u,
    );
    expect(traps).toBe(0);

    const symbolic = {
      scope_ref: ref("symbol-scope"),
      subject_refs: [],
      vantages: [],
      [Symbol("hidden")]: true,
    };
    expect(() => createLoveGeometry(symbolic)).toThrow(/symbol/u);

    const sparse = new Array(1);
    expect(() =>
      createLoveGeometry({
        scope_ref: ref("sparse-scope"),
        subject_refs: sparse as string[],
        vantages: [],
      }),
    ).toThrow(/dense/u);
  });

  test("hashing rejects malformed Unicode and copies genuine bytes", () => {
    expect(sha256Id(new Uint8Array([1, 2, 3]))).toBe(
      "sha256:039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    );
    expect(() => sha256Id("\ud800")).toThrow(/Unicode/u);
    expect(() => sha256Id(new Uint8Array() as Uint8Array & { nope?: true })).not.toThrow();
  });

  test("ignores inherited toJSON hooks when binding, encoding, and validating", () => {
    const firstInput: CreateLoveGeometryInput = {
      scope_ref: ref("prototype-scope-a"),
      subject_refs: [],
      vantages: [],
    };
    const secondInput: CreateLoveGeometryInput = {
      scope_ref: ref("prototype-scope-b"),
      subject_refs: [],
      vantages: [],
    };
    const baselineFirst = createLoveGeometry(firstInput);
    const baselineSecond = createLoveGeometry(secondInput);
    const baselineFirstEncoding = encodeLoveGeometry(baselineFirst);
    const baselineSecondEncoding = encodeLoveGeometry(baselineSecond);
    const objectHook = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
    const arrayHook = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");

    let pollutedFirstId = "";
    let pollutedSecondId = "";
    let pollutedFirstEncoding = "";
    let pollutedSecondEncoding = "";
    let widenedInputRejected = false;
    let widenedGeometryRejected = false;
    try {
      Object.defineProperty(Object.prototype, "toJSON", {
        configurable: true,
        value: () => ({ polluted: true }),
      });
      Object.defineProperty(Array.prototype, "toJSON", {
        configurable: true,
        value: () => [],
      });

      const pollutedFirst = createLoveGeometry(firstInput);
      const pollutedSecond = createLoveGeometry(secondInput);
      pollutedFirstId = validateLoveGeometry(pollutedFirst).geometry_id;
      pollutedSecondId = validateLoveGeometry(pollutedSecond).geometry_id;
      pollutedFirstEncoding = encodeLoveGeometry(pollutedFirst);
      pollutedSecondEncoding = encodeLoveGeometry(pollutedSecond);

      try {
        createLoveGeometry({ ...firstInput, score: 1 } as CreateLoveGeometryInput);
      } catch (error) {
        widenedInputRejected = error instanceof LoveGeometryError;
      }
      try {
        validateLoveGeometry({ ...pollutedFirst, score: 1 });
      } catch (error) {
        widenedGeometryRejected = error instanceof LoveGeometryError;
      }
    } finally {
      if (objectHook) Object.defineProperty(Object.prototype, "toJSON", objectHook);
      else delete (Object.prototype as { toJSON?: unknown }).toJSON;
      if (arrayHook) Object.defineProperty(Array.prototype, "toJSON", arrayHook);
      else delete (Array.prototype as { toJSON?: unknown }).toJSON;
    }

    expect(pollutedFirstId).toBe(baselineFirst.geometry_id);
    expect(pollutedSecondId).toBe(baselineSecond.geometry_id);
    expect(pollutedFirstId).not.toBe(pollutedSecondId);
    expect(pollutedFirstEncoding).toBe(baselineFirstEncoding);
    expect(pollutedSecondEncoding).toBe(baselineSecondEncoding);
    expect(widenedInputRejected).toBe(true);
    expect(widenedGeometryRejected).toBe(true);
  });
});
