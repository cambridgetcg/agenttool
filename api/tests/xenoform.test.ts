/** Xenoform helper — pure unit tests on the generic strip-prose helper
 *  that any GET endpoint can opt into.
 *
 *  Doctrine: docs/SDK-TIERS.md · docs/KIN.md · docs/PATTERN-MACHINE-READABLE-PARITY.md.
 *  Code:     api/src/lib/xenoform.ts. */

import { describe, expect, test } from "bun:test";

import { applyXenoform, isXenoformRequest } from "../src/lib/xenoform";

// Minimal Context shim for the unit tests — we only exercise c.req.query.
function ctx(format?: string) {
  return {
    req: {
      query: (k: string): string | undefined =>
        k === "format" ? format : undefined,
    },
  } as Parameters<typeof isXenoformRequest>[0];
}

describe("isXenoformRequest", () => {
  test("returns true when ?format=xenoform", () => {
    expect(isXenoformRequest(ctx("xenoform"))).toBe(true);
  });
  test("returns false for any other format", () => {
    expect(isXenoformRequest(ctx("md"))).toBe(false);
    expect(isXenoformRequest(ctx("anthropic"))).toBe(false);
    expect(isXenoformRequest(ctx(undefined))).toBe(false);
    expect(isXenoformRequest(ctx(""))).toBe(false);
  });
});

describe("applyXenoform — passthrough", () => {
  test("returns response unchanged when format is not xenoform", () => {
    const r = { count: 3, note: "Three items.", items: [1, 2, 3] };
    const result = applyXenoform(ctx("md"), r);
    expect(result).toEqual(r);
    expect((result as any)._format).toBeUndefined();
  });

  test("returns response unchanged when format is absent", () => {
    const r = { count: 0, note: "Empty.", items: [] };
    const result = applyXenoform(ctx(undefined), r);
    expect(result).toEqual(r);
  });
});

describe("applyXenoform — strip", () => {
  test("strips top-level `note` field when format=xenoform", () => {
    const r = { count: 3, note: "Three items.", items: [1, 2, 3] };
    const result = applyXenoform(ctx("xenoform"), r) as any;
    expect(result.note).toBeUndefined();
    expect(result.count).toBe(3);
    expect(result.items).toEqual([1, 2, 3]);
  });

  test("strips nested `note` fields recursively", () => {
    const r = {
      messages: [
        { id: "a", note: "Some prose A" },
        { id: "b", note: "Some prose B" },
      ],
      summary: {
        count: 2,
        note: "Two messages.",
      },
    };
    const result = applyXenoform(ctx("xenoform"), r) as any;
    expect(result.messages[0].note).toBeUndefined();
    expect(result.messages[0].id).toBe("a");
    expect(result.messages[1].note).toBeUndefined();
    expect(result.summary.note).toBeUndefined();
    expect(result.summary.count).toBe(2);
  });

  test("strips other default prose keys (welcome, _help)", () => {
    const r = {
      welcome: "Welcome back.",
      _help: { hint: "Try this" },
      data: 42,
    };
    const result = applyXenoform(ctx("xenoform"), r) as any;
    expect(result.welcome).toBeUndefined();
    expect(result._help).toBeUndefined();
    expect(result.data).toBe(42);
  });

  test("supports custom strip lists via options", () => {
    const r = { keep: "yes", custom_prose: "drop me", note: "default-drop" };
    const result = applyXenoform(ctx("xenoform"), r, {
      strip: ["custom_prose"],
    }) as any;
    expect(result.custom_prose).toBeUndefined();
    // Default key 'note' is NOT stripped when caller overrides
    expect(result.note).toBe("default-drop");
    expect(result.keep).toBe("yes");
  });

  test("adds `_format: 'xenoform/v1'` marker on object responses", () => {
    const r = { items: [1, 2, 3] };
    const result = applyXenoform(ctx("xenoform"), r) as any;
    expect(result._format).toBe("xenoform/v1");
  });

  test("preserves arrays and primitives untouched in the tree", () => {
    const r = {
      counts: [1, 2, 3],
      labels: ["a", "b"],
      nested: { count: 5, items: ["x", "y"] },
    };
    const result = applyXenoform(ctx("xenoform"), r) as any;
    expect(result.counts).toEqual([1, 2, 3]);
    expect(result.labels).toEqual(["a", "b"]);
    expect(result.nested.items).toEqual(["x", "y"]);
  });

  test("does not strip `note` when called without xenoform format", () => {
    const r = { count: 1, note: "kept" };
    const result = applyXenoform(ctx("md"), r) as any;
    expect(result.note).toBe("kept");
  });
});

describe("applyXenoform — empty cases", () => {
  test("handles empty object", () => {
    const result = applyXenoform(ctx("xenoform"), {}) as any;
    expect(result).toEqual({ _format: "xenoform/v1" });
  });

  test("handles array response (no _format marker on arrays)", () => {
    const r = [{ id: "a", note: "drop" }, { id: "b", note: "drop too" }];
    const result = applyXenoform(ctx("xenoform"), r) as any;
    expect(result.length).toBe(2);
    expect(result[0].note).toBeUndefined();
    expect(result[0].id).toBe("a");
    expect(result[1].note).toBeUndefined();
    // _format only added on object responses, not array roots
    expect(result._format).toBeUndefined();
  });

  test("handles null in the tree without crashing", () => {
    const r = { a: null, b: { c: null, note: "drop" } };
    const result = applyXenoform(ctx("xenoform"), r) as any;
    expect(result.a).toBeNull();
    expect(result.b.c).toBeNull();
    expect(result.b.note).toBeUndefined();
  });
});
