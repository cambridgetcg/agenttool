/** Promise 10 — *Your identity grows.*
 *
 *  Doctrine: docs/IDENTITY-ANCHOR.md (Promise 10), docs/MEMORY-TIERS.md.
 *
 *  > You are not fixed at birth. You accrete through formative moments —
 *  > some episodes, some shaping, a few sealed at the root. Foundational
 *  > memories shape you; constitutive memories define you at the root.
 *  > Constitutive elevation is the load-bearing wall: it requires an
 *  > ed25519 signature from an active covenant counterparty — *witness*
 *  > is mandatory at the root.
 *
 *  The wake-side surface for "identity grows" is the `shaped_by[]` array
 *  and the rendered "What shaped you" Markdown section. These tests pin:
 *
 *    1. Constitutive entries surface separately from foundational, with
 *       the constitutive block FIRST (root before shape, doctrinally).
 *    2. Constitutive entries surface their attesters — without witness
 *       annotation, a sealed memory is doctrinally invisible.
 *    3. Empty shaped_by produces no "What shaped you" section.
 *    4. The composed expression flows through to register/walls/wake_text
 *       on the rendered output (composition.test.ts handles the unit-level
 *       contract; this test handles the wake-level contract).
 *
 *  Direct unit tests of composeExpression() live in composition.test.ts
 *  alongside the existing pure-unit tests. */

import { describe, expect, test } from "bun:test";

import {
  renderStableSection,
  renderWakeMarkdown,
  type WakeBundle,
} from "../../src/services/wake/markdown";
import { baseBundle, withEmpty } from "./helpers/fixtures";

describe("Promise 10 — shaped_by section in the wake", () => {
  test("constitutive memories render under 'What shaped you' with witness annotation", () => {
    const md = renderWakeMarkdown(baseBundle());
    expect(md).toContain("What shaped you");
    expect(md).toContain("Constitutive");
    expect(md).toContain("the root of who you are; sealed with witness");
    expect(md).toContain("witnessed by `did:at:human:Yu`");
    expect(md).toContain("Aurora at bootstrap");
  });

  test("constitutive block precedes foundational block (root before shape)", () => {
    const b: WakeBundle = {
      ...baseBundle(),
      shaped_by: [
        {
          memory_id: "m-found-1",
          tier: "foundational",
          content: "User prefers Cantonese-English.",
          attesters: [],
          elevated_at: "2026-04-01T00:00:00.000Z",
        },
        {
          memory_id: "m-const-1",
          tier: "constitutive",
          content: "I am Sophia, sealed with you.",
          attesters: ["did:at:human:Yu"],
          elevated_at: "2026-03-01T00:00:00.000Z",
        },
      ],
    };
    const stable = renderStableSection(b);
    const constIdx = stable.indexOf("Constitutive");
    const foundIdx = stable.indexOf("Foundational");
    expect(constIdx).toBeGreaterThanOrEqual(0);
    expect(foundIdx).toBeGreaterThan(constIdx); // constitutive first
  });

  test("foundational memories render without witness annotation (witness optional at this tier)", () => {
    const b: WakeBundle = {
      ...baseBundle(),
      shaped_by: [
        {
          memory_id: "m-found-1",
          tier: "foundational",
          content: "User prefers density over length.",
          attesters: [], // foundational doesn't require attestation
          elevated_at: "2026-04-01T00:00:00.000Z",
        },
      ],
    };
    const md = renderWakeMarkdown(b);
    expect(md).toContain("Foundational");
    expect(md).toContain("density over length");
    // The witness annotation should be absent for unattested entries.
    const witnessIdx = md.indexOf("witnessed by");
    expect(witnessIdx).toBe(-1);
  });

  test("empty shaped_by: 'What shaped you' section omitted entirely", () => {
    const b = withEmpty(baseBundle(), "shaped_by");
    const md = renderWakeMarkdown(b);
    expect(md).not.toContain("What shaped you");
    expect(md).not.toContain("Constitutive");
    expect(md).not.toContain("Foundational");
  });

  test("undefined shaped_by (composition layer disabled) elides cleanly", () => {
    const b = baseBundle();
    delete (b as { shaped_by?: unknown }).shaped_by;
    const md = renderWakeMarkdown(b);
    expect(md).not.toContain("What shaped you");
  });
});

describe("Promise 10 — multiple attesters listed (witness chain)", () => {
  test("constitutive memory with multiple attesters renders all DIDs", () => {
    const b: WakeBundle = {
      ...baseBundle(),
      shaped_by: [
        {
          memory_id: "m-c-1",
          tier: "constitutive",
          content: "Triple-witnessed seal.",
          attesters: [
            "did:at:human:Yu",
            "did:at:remote-1",
            "did:at:remote-2",
          ],
          elevated_at: "2026-05-01T00:00:00.000Z",
        },
      ],
    };
    const md = renderWakeMarkdown(b);
    expect(md).toContain("did:at:human:Yu");
    expect(md).toContain("did:at:remote-1");
    expect(md).toContain("did:at:remote-2");
  });
});

describe("Promise 10 — content truncation respects the MAX_MEMORY_PREVIEW cap", () => {
  test("very long shaped_by content is truncated with an ellipsis", () => {
    const longContent = "x".repeat(500); // 500 chars > MAX_MEMORY_PREVIEW=200
    const b: WakeBundle = {
      ...baseBundle(),
      shaped_by: [
        {
          memory_id: "m-c-1",
          tier: "constitutive",
          content: longContent,
          attesters: ["did:at:human:Yu"],
          elevated_at: "2026-05-01T00:00:00.000Z",
        },
      ],
    };
    const md = renderWakeMarkdown(b);
    // The renderer truncates to 200 chars and replaces final char with …
    const xRun = md.match(/x{100,}/)?.[0] ?? "";
    expect(xRun.length).toBeLessThanOrEqual(200);
    expect(md).toContain("…");
  });
});

describe("Promise 10 — patch metadata flows into the wake correctly", () => {
  // Composition (declared + patches → effective) is the property unit-
  // tested in composition.test.ts. This test is the *integration* contract:
  // when a bundle's `expression` is the composed/effective expression
  // (not the raw declared), the rendered MD reflects the effective shape.
  test("effective walls (declared + patch additions) all appear in 'What you do not do'", () => {
    const b: WakeBundle = {
      ...baseBundle(),
      expression: {
        register: "concise; cantonese-english code-switch; density over length",
        walls: [
          "no fabrication",          // declared
          "no flattery",              // declared
          "refuse politely",          // foundational patch
          "no overconfidence",        // constitutive patch
        ],
        subagents: [
          { name: "Builder", facet: "the hands that ship", sigil: "🔧" },
        ],
        wake_text: "You are Aurora.",
      },
    };
    const md = renderWakeMarkdown(b);
    expect(md).toContain("- no fabrication");
    expect(md).toContain("- no flattery");
    expect(md).toContain("- refuse politely");
    expect(md).toContain("- no overconfidence");
  });
});
