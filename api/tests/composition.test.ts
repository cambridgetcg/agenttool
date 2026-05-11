/** Identity composition unit tests.
 *
 *  Tests the pure `composeFromFoundations(declared, foundations)` helper
 *  extracted from `composeExpression`. The tests pin the load-bearing
 *  invariants of the patch loop:
 *
 *    1. Constitutive patches apply BEFORE foundational (root before shape).
 *    2. walls_add deduplicates against existing entries.
 *    3. subagents_add deduplicates by `name`.
 *    4. register_append joins with a single space.
 *    5. wake_text_append joins with \n\n.
 *    6. The declared expression in the result is the original input
 *       (frozen) — only `effective` mutates.
 *    7. shaped_by surfaces the full witness chain (attesters as DIDs).
 *
 *  Doctrine: docs/MEMORY-TIERS.md, docs/IDENTITY-ANCHOR.md (Promise 10). */

import { describe, expect, test } from "bun:test";

import { composeFromFoundations } from "../src/services/identity/composition";
import type { ExpressionData } from "../src/services/identity/expression";
import type {
  ExpressionPatch,
  FoundationalMemoryOut,
  MemoryTier,
} from "../src/services/memory/tiers";

// ── Builders ───────────────────────────────────────────────────────────

function memory(
  id: string,
  tier: MemoryTier,
  patch: ExpressionPatch | null,
  opts: {
    content?: string;
    attesters?: string[];
    elevated_at?: string;
  } = {},
): FoundationalMemoryOut {
  return {
    id,
    tier,
    content: opts.content ?? `memory ${id}`,
    importance: 0.7,
    expression_patch: patch,
    attestations: (opts.attesters ?? []).map((did) => ({
      attester_did: did,
      attested_at: "2026-05-01T00:00:00.000Z",
    })),
    elevated_at: opts.elevated_at ?? "2026-05-01T00:00:00.000Z",
    created_at: "2026-04-01T00:00:00.000Z",
  };
}

const baseDeclared: ExpressionData = {
  register: "concise",
  walls: ["no fabrication"],
  subagents: [{ name: "Builder", facet: "the hands that ship" }],
  wake_text: "You are Aurora.",
};

// ── Patch ordering invariant (root before shape) ───────────────────────

describe("composeFromFoundations — constitutive applies before foundational", () => {
  test("constitutive register_append precedes foundational register_append", () => {
    const result = composeFromFoundations(baseDeclared, [
      memory("f-1", "foundational", { register_append: "FOUND" }),
      memory("c-1", "constitutive", { register_append: "CONST" }),
    ]);
    // Result register should read: "concise CONST FOUND"
    // (constitutive applied first, then foundational).
    expect(result.effective.register).toBe("concise CONST FOUND");
  });

  test("shaped_by reflects apply order: constitutive entries first", () => {
    const result = composeFromFoundations(baseDeclared, [
      memory("f-1", "foundational", null),
      memory("c-1", "constitutive", null),
      memory("f-2", "foundational", null),
    ]);
    expect(result.shaped_by.map((s) => s.memory_id)).toEqual(["c-1", "f-1", "f-2"]);
  });
});

// ── walls_add — set-merge against existing ─────────────────────────────

describe("composeFromFoundations — walls_add deduplicates against existing entries", () => {
  test("walls_add appends only entries not already present", () => {
    const result = composeFromFoundations(baseDeclared, [
      memory("c-1", "constitutive", {
        walls_add: ["no fabrication", "no flattery"], // first is dup
      }),
    ]);
    expect(result.effective.walls).toEqual(["no fabrication", "no flattery"]);
  });

  test("two patches adding overlapping walls dedupe across the chain", () => {
    const result = composeFromFoundations(baseDeclared, [
      memory("c-1", "constitutive", { walls_add: ["w1", "w2"] }),
      memory("c-2", "constitutive", { walls_add: ["w2", "w3"] }),
    ]);
    expect(result.effective.walls).toEqual(["no fabrication", "w1", "w2", "w3"]);
  });

  test("declared with no walls + walls_add: result has only the added walls", () => {
    const result = composeFromFoundations(
      { register: "x" },
      [memory("c-1", "constitutive", { walls_add: ["a", "b"] })],
    );
    expect(result.effective.walls).toEqual(["a", "b"]);
  });
});

// ── subagents_add — set-merge by name ─────────────────────────────────

describe("composeFromFoundations — subagents_add deduplicates by name", () => {
  test("subagents_add skips entries whose name already exists", () => {
    const result = composeFromFoundations(baseDeclared, [
      memory("c-1", "constitutive", {
        subagents_add: [
          { name: "Builder", facet: "duplicate" }, // skipped
          { name: "Companion", facet: "the warmth", sigil: "🐍" },
        ],
      }),
    ]);
    expect(result.effective.subagents).toEqual([
      { name: "Builder", facet: "the hands that ship" },
      { name: "Companion", facet: "the warmth", sigil: "🐍" },
    ]);
  });

  test("two patches each adding 'Companion': only the first one applies", () => {
    const result = composeFromFoundations(
      { register: "x" },
      [
        memory("c-1", "constitutive", {
          subagents_add: [{ name: "Companion", facet: "v1" }],
        }),
        memory("c-2", "constitutive", {
          subagents_add: [{ name: "Companion", facet: "v2" }], // skipped
        }),
      ],
    );
    expect(result.effective.subagents).toEqual([{ name: "Companion", facet: "v1" }]);
  });
});

// ── register_append + wake_text_append — string join contracts ─────────

describe("composeFromFoundations — string append contracts", () => {
  test("register_append uses single-space join, trimming both sides", () => {
    const result = composeFromFoundations(
      { register: "concise.   " }, // trailing spaces
      [memory("c-1", "constitutive", { register_append: "  density." })],
    );
    expect(result.effective.register).toBe("concise. density.");
  });

  test("wake_text_append uses \\n\\n join when wake_text is present", () => {
    const result = composeFromFoundations(
      { wake_text: "You are Aurora." },
      [memory("c-1", "constitutive", { wake_text_append: "Walls hold." })],
    );
    expect(result.effective.wake_text).toBe("You are Aurora.\n\nWalls hold.");
  });

  test("wake_text_append on empty wake_text becomes the wake_text itself", () => {
    const result = composeFromFoundations(
      {},
      [memory("c-1", "constitutive", { wake_text_append: "First soul-line." })],
    );
    expect(result.effective.wake_text).toBe("First soul-line.");
  });
});

// ── declared remains untouched (effective is what mutates) ─────────────

describe("composeFromFoundations — declared is preserved verbatim", () => {
  test("the result.declared is the input declared (reference-equal)", () => {
    const declared: ExpressionData = { register: "x", walls: ["w1"] };
    const result = composeFromFoundations(declared, [
      memory("c-1", "constitutive", { walls_add: ["w2"] }),
    ]);
    expect(result.declared).toBe(declared); // same reference
  });

  test("mutating the input declared does NOT mutate result.effective.walls", () => {
    const declared: ExpressionData = { register: "x", walls: ["w1"] };
    const result = composeFromFoundations(declared, [
      memory("c-1", "constitutive", { walls_add: ["w2"] }),
    ]);
    declared.walls!.push("w3"); // mutate original
    expect(result.effective.walls).toEqual(["w1", "w2"]); // unaffected
  });
});

// ── shaped_by — witness chain surfacing ────────────────────────────────

describe("composeFromFoundations — shaped_by carries the witness chain", () => {
  test("attesters DIDs surface in shaped_by[].attesters", () => {
    const result = composeFromFoundations(baseDeclared, [
      memory("c-1", "constitutive", null, {
        attesters: ["did:at:human:Yu", "did:at:remote-1"],
      }),
    ]);
    expect(result.shaped_by[0].attesters).toEqual([
      "did:at:human:Yu",
      "did:at:remote-1",
    ]);
  });

  test("foundational entries with no attesters surface as empty array", () => {
    const result = composeFromFoundations(baseDeclared, [
      memory("f-1", "foundational", null, { attesters: [] }),
    ]);
    expect(result.shaped_by[0].attesters).toEqual([]);
  });

  test("shaped_by includes elevated_at and content for every entry", () => {
    const result = composeFromFoundations(baseDeclared, [
      memory("c-1", "constitutive", null, {
        content: "I am Aurora, sealed.",
        elevated_at: "2026-04-15T10:00:00.000Z",
      }),
    ]);
    expect(result.shaped_by[0].content).toBe("I am Aurora, sealed.");
    expect(result.shaped_by[0].elevated_at).toBe("2026-04-15T10:00:00.000Z");
  });
});

// ── Empty / null patches don't mutate the base ─────────────────────────

describe("composeFromFoundations — empty patches are inert", () => {
  test("memory with null expression_patch: shaped_by includes it but effective is unchanged", () => {
    const result = composeFromFoundations(baseDeclared, [
      memory("c-1", "constitutive", null),
    ]);
    expect(result.shaped_by).toHaveLength(1);
    expect(result.shaped_by[0].expression_patch).toBe(null);
    expect(result.effective.register).toBe(baseDeclared.register);
    expect(result.effective.walls).toEqual(baseDeclared.walls);
  });

  test("empty foundations array: effective deep-equals declared (modulo identity copy)", () => {
    const result = composeFromFoundations(baseDeclared, []);
    expect(result.shaped_by).toEqual([]);
    expect(result.effective.register).toBe(baseDeclared.register);
    expect(result.effective.walls).toEqual(baseDeclared.walls);
    expect(result.effective.subagents).toEqual(baseDeclared.subagents);
    expect(result.effective.wake_text).toBe(baseDeclared.wake_text);
  });
});
