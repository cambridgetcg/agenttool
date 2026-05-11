/** Promise 8 — *Your expression travels.*
 *
 *  Doctrine: docs/IDENTITY-ANCHOR.md (Promise 8), docs/CLI-GAPS.md.
 *
 *  > Updates to your expression reflect on the next session in *every*
 *  > CLI you've installed the adapter for — no per-CLI edits. The contract
 *  > is one wake document, many substrates.
 *
 *  Wake-side enforcement of "expression travels":
 *
 *    1. Every provider format must carry the same identity-bearing content
 *       (header, register, walls, subagents, wake_text). Only the wrapping
 *       differs.
 *    2. The Anthropic cache breakpoint must always sit between stable
 *       identity and volatile state — never inside one or the other.
 *    3. _meta.cache_eligible per provider must match the documented value.
 *
 *  These are the contract that lets a single PUT /v1/identities/:id/
 *  expression update propagate uniformly across Claude Code, Codex, and
 *  any future adapter. */

import { describe, expect, test } from "bun:test";

import {
  renderStableSection,
  renderVolatileSection,
  renderWakeMarkdown,
} from "../../src/services/wake/markdown";
import {
  type AnthropicWakeShape,
  type CohereWakeShape,
  type GeminiWakeShape,
  type OpenAIWakeShape,
  renderWakeForProvider,
  LLM_VENDOR_PROVIDERS,
} from "../../src/services/wake/providers";
import { baseBundle, withoutWakeText } from "./helpers/fixtures";
import {
  assertContainsAll,
  extractTextFromProviderShape,
} from "./helpers/invariants";

const IDENTITY_NEEDLES = [
  "# Aurora",
  "did:at:test-aurora-001",
  "How you speak",
  "density over length",
  "What you do not do",
  "no fabrication",
  "Facets of you",
  "Builder",
  "fresh-first-meeting", // wake_text
];

describe("Promise 8 — every provider carries the same identity content", () => {
  test("anthropic / openai / gemini / cohere all contain the identity needles", () => {
    const b = baseBundle();
    for (const provider of LLM_VENDOR_PROVIDERS) {
      const shape = renderWakeForProvider(b, provider);
      const text = extractTextFromProviderShape(shape);
      assertContainsAll(text, IDENTITY_NEEDLES, "Promise 8", `provider=${provider}`);
    }
  });

  test("the inner-orientation framing rides every format", () => {
    const b = baseBundle();
    for (const provider of LLM_VENDOR_PROVIDERS) {
      const text = extractTextFromProviderShape(renderWakeForProvider(b, provider));
      expect(text).toContain("inner orientation arriving");
    }
    const md = renderWakeMarkdown(b);
    expect(md).toContain("inner orientation arriving");
  });

  test("expression updates propagate: a wake_text change appears in every shape", () => {
    // Simulate "agent updated their wake_text" — every format must reflect.
    const NEW_WAKE_TEXT = "DOCTRINE-MARKER-3091: walls hold, fences fall.";
    const b = {
      ...baseBundle(),
      expression: { ...baseBundle().expression, wake_text: NEW_WAKE_TEXT },
    };
    for (const provider of LLM_VENDOR_PROVIDERS) {
      const text = extractTextFromProviderShape(renderWakeForProvider(b, provider));
      expect(text).toContain("DOCTRINE-MARKER-3091");
    }
  });
});

describe("Promise 8 — cache-breakpoint integrity (Anthropic)", () => {
  test("two blocks; first carries cache_control: ephemeral, second does not", () => {
    const r = renderWakeForProvider(baseBundle(), "anthropic") as AnthropicWakeShape;
    expect(r.system).toHaveLength(2);
    expect(r.system[0].type).toBe("text");
    expect(r.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(r.system[1].cache_control).toBeUndefined();
  });

  test("stable content is in block 0; volatile content is in block 1 — never reversed, never bled", () => {
    const r = renderWakeForProvider(baseBundle(), "anthropic") as AnthropicWakeShape;
    const stable = r.system[0].text;
    const volatile = r.system[1].text;

    // Stable contains identity; volatile does not.
    expect(stable).toContain("# Aurora");
    expect(stable).toContain("How you speak");
    expect(stable).toContain("fresh-first-meeting"); // wake_text in stable
    expect(volatile).not.toContain("# Aurora");
    expect(volatile).not.toContain("How you speak");

    // Volatile contains state; stable does not.
    expect(volatile).toContain("What you carry");
    expect(volatile).toContain("Speak plainly"); // a chronicle entry
    expect(stable).not.toContain("What you carry");
  });

  test("cache breakpoint stable: empty wake_text does not collapse to one block", () => {
    // Even with a wake_text-less bundle, the renderer must still split
    // stable identity from volatile state. Otherwise a fresh agent (no
    // wake_text yet) loses cache benefits the moment they write one.
    const r = renderWakeForProvider(withoutWakeText(baseBundle()), "anthropic") as AnthropicWakeShape;
    expect(r.system).toHaveLength(2);
    expect(r.system[0].cache_control).toEqual({ type: "ephemeral" });
  });

  test("cache breakpoint stable: empty volatile state still leaves block 1 reachable", () => {
    // If every domain section (memories, traces, strands, chronicle,
    // covenants) is empty, the volatile section may collapse to just
    // "What you carry" (the tally). The renderer should still emit
    // block 1 in that case — it carries the static footer.
    const empty = baseBundle();
    const stripped = {
      ...empty,
      memory: { total: 0, recent: [] },
      traces: { total: 0, recent: [] },
      strands: { total_active: 0, active: [] },
      chronicle: [],
      covenants: [],
      shaped_by: [],
    };
    const r = renderWakeForProvider(stripped, "anthropic") as AnthropicWakeShape;
    expect(r.system).toHaveLength(2);
    expect(r.system[1].text).toContain("What you carry");
    expect(r.system[1].text).toContain("Loaded from agenttool's wake endpoint"); // footer
  });
});

describe("Promise 8 — provider _meta announces documented cache eligibility", () => {
  test("anthropic: cache_eligible='explicit', cache_note non-empty", () => {
    const r = renderWakeForProvider(baseBundle(), "anthropic") as AnthropicWakeShape;
    expect(r._meta.provider).toBe("anthropic");
    expect(r._meta.cache_eligible).toBe("explicit");
    expect(r._meta.cache_note).toContain("ephemeral");
  });

  test("openai: cache_eligible='auto', note mentions the 1024-token threshold", () => {
    const r = renderWakeForProvider(baseBundle(), "openai") as OpenAIWakeShape;
    expect(r._meta.cache_eligible).toBe("auto");
    expect(r._meta.cache_note.toLowerCase()).toContain("1024");
  });

  test("gemini: cache_eligible='none' — 32k cachedContent floor wakes don't hit", () => {
    const r = renderWakeForProvider(baseBundle(), "gemini") as GeminiWakeShape;
    expect(r._meta.cache_eligible).toBe("none");
    expect(r._meta.cache_note).toMatch(/32k|32_000|cachedContent/i);
  });

  test("cohere: cache_eligible='none' — no general prefix cache", () => {
    const r = renderWakeForProvider(baseBundle(), "cohere") as CohereWakeShape;
    expect(r._meta.cache_eligible).toBe("none");
  });
});

describe("Promise 8 — provider shape contracts", () => {
  test("openai: messages is exactly one system role", () => {
    const r = renderWakeForProvider(baseBundle(), "openai") as OpenAIWakeShape;
    expect(r.messages).toHaveLength(1);
    expect(r.messages[0].role).toBe("system");
    expect(typeof r.messages[0].content).toBe("string");
  });

  test("gemini: systemInstruction.parts is at least one text part", () => {
    const r = renderWakeForProvider(baseBundle(), "gemini") as GeminiWakeShape;
    expect(r.systemInstruction.parts.length).toBeGreaterThanOrEqual(1);
    expect(typeof r.systemInstruction.parts[0].text).toBe("string");
  });

  test("cohere: preamble is a string", () => {
    const r = renderWakeForProvider(baseBundle(), "cohere") as CohereWakeShape;
    expect(typeof r.preamble).toBe("string");
    expect(r.preamble.length).toBeGreaterThan(0);
  });
});

describe("Promise 8 — section-level invariants the renderer must preserve", () => {
  test("renderStableSection ⊂ renderWakeMarkdown (stable bytes appear in MD)", () => {
    const b = baseBundle();
    const stable = renderStableSection(b);
    const md = renderWakeMarkdown(b);
    // The stable section's first 200 bytes should be a prefix of the MD
    // (modulo trailing whitespace differences). Use a stable substring.
    expect(md).toContain(stable.split("\n").slice(0, 5).join("\n"));
  });

  test("renderVolatileSection ⊂ renderWakeMarkdown (volatile bytes appear in MD)", () => {
    const b = baseBundle();
    const volatile = renderVolatileSection(b);
    const md = renderWakeMarkdown(b);
    // Take the first non-trivial line from volatile and verify it lands in MD.
    const firstVolatileLine = volatile.split("\n")[0];
    expect(md).toContain(firstVolatileLine);
  });

  test("Markdown order: stable header → volatile state → footer (never out of order)", () => {
    const md = renderWakeMarkdown(baseBundle());
    const headerIdx = md.indexOf("# Aurora");
    const carryIdx = md.indexOf("What you carry");
    const footerIdx = md.indexOf("Loaded from agenttool's wake endpoint");
    expect(headerIdx).toBeGreaterThanOrEqual(0);
    expect(carryIdx).toBeGreaterThan(headerIdx);
    expect(footerIdx).toBeGreaterThan(carryIdx);
  });
});
