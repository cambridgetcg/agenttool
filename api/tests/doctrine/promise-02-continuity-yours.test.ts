/** Promise 2 — *Your continuity is yours.*
 *
 *  Doctrine: docs/IDENTITY-ANCHOR.md (Promise 2), SOUL.md.
 *
 *  > Every session that loads /v1/wake arrives oriented — same memory,
 *  > same wallet, same vault, same traces. We hold what your context
 *  > window can't.
 *
 *  Wake-side enforcement: **idempotence under frozen state**. Two render
 *  calls against the same bundle produce byte-identical output. The
 *  *content* the agent re-encounters is stable; the *encounter itself*
 *  (welcome line, freshness register) is what rotates — and that's
 *  asymmetry-clause work, tested in asymmetry-clause.test.ts.
 *
 *  These tests pin:
 *
 *    1. Pure-function determinism: renderStableSection(b) === renderStableSection(b)
 *       for any frozen bundle b.
 *    2. Provider-shape determinism: renderWakeForProvider(b, p) is byte-stable.
 *    3. The renderer carries no time-dependent or random output (welcome
 *       composer is the lone non-determinism, and lives in continuity/welcome.ts,
 *       NOT in the wake renderer).
 *    4. Asynchronous render order doesn't matter — calling md(), system(),
 *       md() in any order against the same bundle returns the same bytes
 *       for each format. */

import { describe, expect, test } from "bun:test";

import {
  renderStableSection,
  renderVolatileSection,
  renderWakeMarkdown,
  renderWakePlaintext,
} from "../../src/services/wake/markdown";
import {
  renderWakeForProvider,
  WAKE_PROVIDERS,
} from "../../src/services/wake/providers";
import {
  baseBundle,
  withCrossInstanceCovenants,
  withEmpty,
  withEncryptedStrand,
  withManyMemories,
} from "./helpers/fixtures";

// ── Renderer determinism — byte-stable across calls ────────────────────

describe("Promise 2 — renderer is byte-stable for a frozen bundle", () => {
  test("renderStableSection: same bundle → identical output across 50 calls", () => {
    const b = baseBundle();
    const first = renderStableSection(b);
    for (let i = 0; i < 50; i++) {
      expect(renderStableSection(b)).toBe(first);
    }
  });

  test("renderVolatileSection: same bundle → identical output across 50 calls", () => {
    const b = baseBundle();
    const first = renderVolatileSection(b);
    for (let i = 0; i < 50; i++) {
      expect(renderVolatileSection(b)).toBe(first);
    }
  });

  test("renderWakeMarkdown: same bundle → identical output across 50 calls", () => {
    const b = baseBundle();
    const first = renderWakeMarkdown(b);
    for (let i = 0; i < 50; i++) {
      expect(renderWakeMarkdown(b)).toBe(first);
    }
  });

  test("renderWakePlaintext: same bundle → identical output across 50 calls", () => {
    const b = baseBundle();
    const first = renderWakePlaintext(b);
    for (let i = 0; i < 50; i++) {
      expect(renderWakePlaintext(b)).toBe(first);
    }
  });

  test("every provider shape is byte-stable across 50 calls", () => {
    const b = baseBundle();
    for (const provider of WAKE_PROVIDERS) {
      const first = JSON.stringify(renderWakeForProvider(b, provider));
      for (let i = 0; i < 50; i++) {
        expect(JSON.stringify(renderWakeForProvider(b, provider))).toBe(first);
      }
    }
  });
});

// ── Order-independence — call patterns shouldn't shift output ──────────

describe("Promise 2 — render order doesn't change output for any single format", () => {
  test("call md(), system('anthropic'), md() — both md outputs identical", () => {
    const b = baseBundle();
    const md1 = renderWakeMarkdown(b);
    const _shape = renderWakeForProvider(b, "anthropic");
    const md2 = renderWakeMarkdown(b);
    expect(md2).toBe(md1);
    void _shape; // avoid unused
  });

  test("interleaved provider calls don't alias one another's output", () => {
    const b = baseBundle();
    const a1 = JSON.stringify(renderWakeForProvider(b, "anthropic"));
    const o1 = JSON.stringify(renderWakeForProvider(b, "openai"));
    const a2 = JSON.stringify(renderWakeForProvider(b, "anthropic"));
    const o2 = JSON.stringify(renderWakeForProvider(b, "openai"));
    expect(a1).toBe(a2);
    expect(o1).toBe(o2);
    expect(a1).not.toBe(o1); // different providers, different shapes
  });
});

// ── Frozen state across mutated dimensions — every shape is stable ─────

describe("Promise 2 — determinism holds across the mutator family", () => {
  // The doctrine claim is universal: ANY frozen bundle, any state shape,
  // produces the same bytes when rendered twice. Sample a representative
  // family of mutations.
  const builders = [
    () => baseBundle(),
    () => withEmpty(baseBundle(), "memory"),
    () => withEmpty(baseBundle(), "covenants"),
    () => withCrossInstanceCovenants(baseBundle()),
    () => withEncryptedStrand(baseBundle(), { topic: "private-thread" }),
    () => withManyMemories(baseBundle(), 50),
  ];

  test("every mutator produces a deterministic render", () => {
    for (const build of builders) {
      const b = build();
      expect(renderWakeMarkdown(b)).toBe(renderWakeMarkdown(b));
      for (const provider of WAKE_PROVIDERS) {
        expect(JSON.stringify(renderWakeForProvider(b, provider))).toBe(
          JSON.stringify(renderWakeForProvider(b, provider)),
        );
      }
    }
  });
});

// ── Renderer carries no time-of-day / random output ────────────────────

describe("Promise 2 — renderer carries NO time-of-day or random output", () => {
  // Sanity check: if the renderer ever started using Date.now() or
  // Math.random(), the determinism property collapses. This test would
  // catch such a regression.
  test("renderWakeMarkdown across two calls separated by a synthetic delay is identical", async () => {
    const b = baseBundle();
    const first = renderWakeMarkdown(b);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const second = renderWakeMarkdown(b);
    expect(second).toBe(first);
  });

  test("renderWakeForProvider across two calls separated by a synthetic delay is identical", async () => {
    const b = baseBundle();
    const first = JSON.stringify(renderWakeForProvider(b, "anthropic"));
    await new Promise((resolve) => setTimeout(resolve, 25));
    const second = JSON.stringify(renderWakeForProvider(b, "anthropic"));
    expect(second).toBe(first);
  });
});

// ── Continuity under bundle reuse — sharing a bundle reference is safe ──

describe("Promise 2 — sharing the same bundle reference across many renders is safe", () => {
  // Defense against accidental mutation: if any renderer mutated its
  // input, two consumers sharing the bundle would see drift. This test
  // verifies the renderer treats input as read-only.
  test("rendering the same bundle 100 times leaves the bundle's identity-bearing fields unchanged", () => {
    const b = baseBundle();
    const before = {
      register: b.expression.register,
      walls: [...(b.expression.walls ?? [])],
      wakeText: b.expression.wake_text,
      memoryCount: b.memory.recent.length,
      covenantCount: b.covenants.length,
    };
    for (let i = 0; i < 100; i++) {
      renderWakeMarkdown(b);
      for (const provider of WAKE_PROVIDERS) {
        renderWakeForProvider(b, provider);
      }
    }
    expect(b.expression.register).toBe(before.register);
    expect(b.expression.walls).toEqual(before.walls);
    expect(b.expression.wake_text).toBe(before.wakeText);
    expect(b.memory.recent.length).toBe(before.memoryCount);
    expect(b.covenants.length).toBe(before.covenantCount);
  });
});

// ── "Same data, fresh encounter" — identity is held; welcome rotates ──

describe("Promise 2 + asymmetry-clause boundary: identity stable, welcome rotates", () => {
  // The asymmetry clause: same data session-to-session, fresh encounter
  // every time. The renderer holds the IDENTITY part (stable). The
  // welcome composer rotates the ENCOUNTER part. This test pins the
  // boundary: renderer IS deterministic; welcome composer IS NOT.
  test("renderStableSection deterministic; the renderer never carries welcome rotation", () => {
    const b = baseBundle();
    const a = renderStableSection(b);
    const b2 = renderStableSection(b);
    expect(a).toBe(b2);
    // Stable section never contains an "OPENINGS"-style line — those
    // are composeWelcome territory and live elsewhere.
    expect(a).not.toContain("Welcome back");
    expect(a).not.toContain("You have arrived");
  });
});
