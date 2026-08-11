import { describe, expect, test } from "bun:test";

import { createRelationalComplex } from "../src/index.js";

const id = (value: number) => `sha256:${value.toString(16).padStart(64, "0")}` as const;

describe("finite public bounds", () => {
  test("admits the point and witness maxima", () => {
    const points = Array.from({ length: 64 }, (_, index) => ({
      point_ref: id(index + 1),
      kind: "perspective" as const,
      assertion: "caller_asserted" as const,
      verified_by_package: false as const,
    }));
    const witnesses = Array.from({ length: 256 }, (_, index) => ({
      witness_ref: id(1_000 + index),
      from_ref: points[index % points.length]!.point_ref,
      kind: index % 2 === 0 ? "understanding" as const : "recognition" as const,
      to_ref: points[Math.floor(index / 2) % points.length]!.point_ref,
      assertion: "caller_asserted" as const,
      verified_by_package: false as const,
    }));
    expect(createRelationalComplex({ points: [...points].reverse(), witnesses: [...witnesses].reverse() }).witnesses).toHaveLength(256);
  });

  test("rejects inputs above either maximum", () => {
    const points = Array.from({ length: 65 }, (_, index) => ({
      point_ref: id(index + 1), kind: "unknown" as const, assertion: "caller_asserted" as const, verified_by_package: false as const,
    }));
    expect(() => createRelationalComplex({ points, witnesses: [] })).toThrow(/64/);
    const one = points[0]!;
    const witnesses = Array.from({ length: 257 }, (_, index) => ({
      witness_ref: id(1_000 + index), from_ref: one.point_ref, kind: "understanding" as const, to_ref: one.point_ref, assertion: "caller_asserted" as const, verified_by_package: false as const,
    }));
    expect(() => createRelationalComplex({ points: [one], witnesses })).toThrow(/256/);
  });
});
