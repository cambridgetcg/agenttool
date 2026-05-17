/** surface-metadata helper — pins the `_canon_pointer` + `verbs[]` shape
 *  per AGENT-WEB-SURFACE.md Moves 3 + 5. */

import { describe, expect, test } from "bun:test";

import {
  attachSurface,
  type SurfaceMetadata,
  type SurfaceVerb,
} from "../src/lib/surface-metadata";

describe("attachSurface — shape", () => {
  test("adds _canon_pointer + verbs to an object body", () => {
    const wrapped = attachSurface(
      { message: "hello", count: 3 },
      {
        canon_pointer: "urn:agenttool:doc/EXAMPLE",
        verbs: [{ action: "read", method: "GET", path: "/v1/example" }],
      },
    );
    expect(wrapped._canon_pointer).toBe("urn:agenttool:doc/EXAMPLE");
    expect(wrapped.verbs).toHaveLength(1);
    expect(wrapped.message).toBe("hello");
    expect(wrapped.count).toBe(3);
  });

  test("verbs defaults to empty array when omitted", () => {
    const wrapped = attachSurface(
      { x: 1 },
      { canon_pointer: "urn:agenttool:doc/X" },
    );
    expect(wrapped.verbs).toEqual([]);
  });

  test("preserves all original keys (additive, not destructive)", () => {
    const original = { a: 1, b: "two", c: [3, 4], d: { nested: true } };
    const wrapped = attachSurface(original, {
      canon_pointer: "urn:agenttool:doc/X",
    });
    expect(wrapped.a).toBe(1);
    expect(wrapped.b).toBe("two");
    expect(wrapped.c).toEqual([3, 4]);
    expect(wrapped.d).toEqual({ nested: true });
  });
});

describe("attachSurface — verb shape parity with NextAction", () => {
  test("verb fields mirror lib/errors NextAction (action · method · path · docs)", () => {
    const verb: SurfaceVerb = {
      action: "arrive",
      method: "POST",
      path: "/v1/register/agent",
      docs: "/docs/AGENTS-ONLY.md",
    };
    const wrapped = attachSurface({}, {
      canon_pointer: "urn:agenttool:doc/PATHWAYS",
      verbs: [verb],
    });
    expect(wrapped.verbs[0]).toEqual(verb);
  });

  test("docs field is optional on verbs", () => {
    const wrapped = attachSurface({}, {
      canon_pointer: "urn:agenttool:doc/X",
      verbs: [
        { action: "list", method: "GET", path: "/v1/x" }, // no docs
        { action: "create", method: "POST", path: "/v1/x", docs: "/docs/X.md" },
      ],
    });
    expect(wrapped.verbs[0].docs).toBeUndefined();
    expect(wrapped.verbs[1].docs).toBe("/docs/X.md");
  });
});

describe("attachSurface — TypeScript type widening", () => {
  test("returned type carries SurfaceMetadata", () => {
    const wrapped = attachSurface(
      { hello: "world" },
      { canon_pointer: "urn:agenttool:doc/X" },
    );
    // type-level: this should compile.
    const meta: SurfaceMetadata = {
      _canon_pointer: wrapped._canon_pointer,
      verbs: wrapped.verbs,
    };
    expect(meta._canon_pointer).toBe("urn:agenttool:doc/X");
  });
});
