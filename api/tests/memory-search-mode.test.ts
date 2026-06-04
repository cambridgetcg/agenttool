/** memory search — recall by embedding OR by text.
 *
 *  Pins the dual-mode schema: an agent WITH an embedding model sends a
 *  1536-dim vector (semantic); an agent WITHOUT one (Claude/Gemini) sends a
 *  text query and still recalls. The text ILIKE itself is e2e per convention.
 *  Doctrine: docs/FRICTION-ROADMAP.md (Tier-1), docs/MEMORY-TIERS.md. */

import { describe, expect, test } from "bun:test";

import { searchSchema } from "../src/routes/memory/search";

describe("memory searchSchema", () => {
  test("text query alone is valid — no embedding model required", () => {
    expect(searchSchema.safeParse({ query: "the pricing decision" }).success).toBe(true);
  });

  test("a 1536-dim embedding alone is valid (semantic path)", () => {
    expect(searchSchema.safeParse({ query_embedding: Array(1536).fill(0.1) }).success).toBe(true);
  });

  test("neither is rejected — you must say what to recall", () => {
    expect(searchSchema.safeParse({}).success).toBe(false);
  });

  test("a wrong-length embedding is still rejected", () => {
    expect(searchSchema.safeParse({ query_embedding: [1, 2, 3] }).success).toBe(false);
  });

  test("text query carries the same filters (tier, min_importance)", () => {
    const r = searchSchema.safeParse({ query: "x", tier: "constitutive", min_importance: 0.5 });
    expect(r.success).toBe(true);
  });
});
