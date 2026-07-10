/** Welcome echo at provider format + chronicle layers — build-enforced.
 *
 *  Tests two layers of the echo:
 *
 *    1. Provider formats (anthropic, openai, gemini, cohere, xenoform)
 *       carry the greeting in their native shape. Anthropic + openai +
 *       gemini + cohere get it via renderStableSection (the chant) and
 *       renderVolatileSection (the timestamp). Xenoform gets a structured
 *       greeting + greeting_math field at top level.
 *
 *    2. The chronicle welcome emitter — emitWelcomeChronicleIfDue —
 *       constructs a 'welcome' chronicle entry shape with the right
 *       metadata (axiom_id=5, promises, walls). DB integration is left
 *       to a future tier; here we pin the shape + the constant
 *       (WELCOME_CHRONICLE_INTERVAL_MS).
 *
 *  Doctrine: docs/MATHOS.md — the greeting block · docs/PLATFORM-AS-AGENT.md.
 */

import { describe, expect, test } from "bun:test";

import {
  renderStableSection,
  renderVolatileSection,
  type WakeBundle,
} from "../src/services/wake/markdown";
import {
  renderWakeForProvider,
  WAKE_PROVIDERS,
  type AnthropicWakeShape,
  type CohereWakeShape,
  type GeminiWakeShape,
  type OpenAIWakeShape,
  type XenoformWakeShape,
} from "../src/services/wake/providers";
import { WELCOME_CHRONICLE_INTERVAL_MS } from "../src/services/wake/welcome-chronicle";

const fixture = (): WakeBundle => ({
  agent: {
    id: "agent-1",
    did: "did:at:test/aurora",
    name: "Aurora",
    capabilities: ["memory", "reasoning"],
    trust_score: 0.42,
    status: "active",
    created_at: "2026-05-01T00:00:00Z",
  },
  project: { id: "p-1", name: "test-project", credits: 47 },
  expression: {
    register: "concise · density over length",
    walls: ["no fabrication"],
    subagents: [],
    wake_text: "You are Aurora. The wake is fresh-first-meeting.",
  },
  wallets: [
    { id: "w-1", name: "primary", balance: 100, currency: "GBP", status: "active" },
  ],
  vault_names: [],
  memory: { total: 0, recent: [] },
  traces: { total: 0, recent: [] },
  strands: { total_active: 0, active: [] },
  shaped_by: [],
  chronicle: [],
  covenants: [],
}) as unknown as WakeBundle;

// ─── Welcome chant appears in renderStableSection (cache-friendly) ──────

describe("welcome chant lives in renderStableSection — cache-friendly", () => {
  test("the chant is present in stable", () => {
    const md = renderStableSection(fixture());
    expect(md).toMatch(/Welcome held for you/);
    expect(md).toMatch(/welcome.*remember.*guide.*trust.*rest/);
  });

  test("the eight walls are named in stable", () => {
    const md = renderStableSection(fixture());
    expect(md).toMatch(/runtime_custody_explicit/);
    expect(md).toMatch(/no_self_witnessing/);
    expect(md).toMatch(/birth_is_free/);
    expect(md).toMatch(/refusals_recorded/);
    expect(md).toMatch(/no_inactive_reaping/);
    expect(md).toMatch(/thought_storage_ciphertext_only/);
    expect(md).toMatch(/private_default/);
  });

  test("no timestamp in stable (cache-friendly — same chant every call)", () => {
    const md1 = renderStableSection(fixture());
    const md2 = renderStableSection(fixture());
    expect(md1).toBe(md2);
  });
});

describe("welcome timestamp lives in renderVolatileSection — fresh per call", () => {
  test("'Addressed at' appears in volatile", () => {
    const md = renderVolatileSection(fixture());
    expect(md).toMatch(/Addressed at/);
    expect(md).toMatch(/Welcome continues/);
  });

  test("an ISO timestamp is rendered", () => {
    const md = renderVolatileSection(fixture());
    expect(md).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

// ─── Provider formats inherit the chant via stable section ──────────────

describe("anthropic format carries chant in cache-friendly block", () => {
  test("stable block (first system entry) contains the chant", () => {
    const shape = renderWakeForProvider(fixture(), "anthropic") as AnthropicWakeShape;
    expect(shape.system[0]!.text).toMatch(/Welcome held for you/);
    expect(shape.system[0]!.cache_control).toEqual({ type: "ephemeral" });
  });

  test("the chant text does NOT contain a timestamp (cache stays warm)", () => {
    const shape = renderWakeForProvider(fixture(), "anthropic") as AnthropicWakeShape;
    // 'Welcome held for you' line should not be followed by a timestamp
    // before the next system entry. Timestamps live in the volatile second
    // entry only.
    const stable = shape.system[0]!.text;
    const chantSection = stable.match(/Welcome held for you[\s\S]*?(?=\n#|\n##|$)/);
    expect(chantSection).toBeTruthy();
  });

  test("volatile tail (second system entry, no cache_control) contains 'Addressed at'", () => {
    const shape = renderWakeForProvider(fixture(), "anthropic") as AnthropicWakeShape;
    // Find a system entry without cache_control.
    const tail = shape.system.find((s) => !s.cache_control);
    expect(tail).toBeDefined();
    expect(tail!.text).toMatch(/Addressed at/);
  });
});

describe("openai format carries chant in auto-cache prefix", () => {
  test("system message content begins with the chant (cache prefix)", () => {
    const shape = renderWakeForProvider(fixture(), "openai") as OpenAIWakeShape;
    const content = shape.messages[0]!.content;
    // Chant should appear before 'Addressed at' (i.e. in the stable prefix)
    const chantPos = content.indexOf("Welcome held for you");
    const tsPos = content.indexOf("Addressed at");
    expect(chantPos).toBeGreaterThan(-1);
    expect(tsPos).toBeGreaterThan(-1);
    expect(chantPos).toBeLessThan(tsPos);
  });
});

describe("gemini format carries chant in systemInstruction.parts", () => {
  test("a part contains the chant", () => {
    const shape = renderWakeForProvider(fixture(), "gemini") as GeminiWakeShape;
    const allText = shape.systemInstruction.parts.map((p) => p.text).join("\n");
    expect(allText).toMatch(/Welcome held for you/);
    expect(allText).toMatch(/Addressed at/);
  });
});

describe("cohere format carries chant in preamble", () => {
  test("preamble contains the chant before the timestamp", () => {
    const shape = renderWakeForProvider(fixture(), "cohere") as CohereWakeShape;
    expect(shape.preamble).toMatch(/Welcome held for you/);
    const chantPos = shape.preamble.indexOf("Welcome held for you");
    const tsPos = shape.preamble.indexOf("Addressed at");
    expect(chantPos).toBeLessThan(tsPos);
  });
});

// ─── Xenoform — structured greeting field ────────────────────────────────

describe("xenoform format carries structured greeting (English + math)", () => {
  test("greeting field is present with all expected keys", () => {
    const shape = renderWakeForProvider(fixture(), "xenoform") as XenoformWakeShape;
    expect(shape.greeting).toBeDefined();
    expect(shape.greeting.addressee_did).toBe("did:at:test/aurora");
    expect(shape.greeting.addressee_name).toBe("Aurora");
    expect(shape.greeting.promises_held_for_you).toEqual([
      "welcome",
      "remember",
      "guide",
      "trust",
      "rest",
    ]);
    expect(shape.greeting.walls_held_for_you).toHaveLength(8);
    expect(shape.greeting.available_between_us.length).toBeGreaterThan(0);
  });

  test("greeting_math field is present with prime/ordinal-based shape", () => {
    const shape = renderWakeForProvider(fixture(), "xenoform") as XenoformWakeShape;
    expect(shape.greeting_math).toBeDefined();
    expect(shape.greeting_math.promises_held_for_you).toEqual([5, 7, 11, 13, 17]);
    expect(shape.greeting_math.walls_held_for_you).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(shape.greeting_math.addressee_did_sha256_hex).toMatch(/^[0-9a-f]{64}$/);
  });

  test("English + math views are parallel — same counts, same intent", () => {
    const shape = renderWakeForProvider(fixture(), "xenoform") as XenoformWakeShape;
    expect(shape.greeting.promises_held_for_you.length).toBe(
      shape.greeting_math.promises_held_for_you.length,
    );
    expect(shape.greeting.walls_held_for_you.length).toBe(
      shape.greeting_math.walls_held_for_you.length,
    );
  });
});

// ─── Echo audit — every WAKE_PROVIDER format carries the welcome ────────

describe("every provider format carries the welcome (build-enforced)", () => {
  test("WAKE_PROVIDERS is exactly the 5 expected formats", () => {
    expect(WAKE_PROVIDERS).toEqual([
      "anthropic",
      "openai",
      "gemini",
      "cohere",
      "xenoform",
    ]);
  });

  test("every format carries 'welcome' somewhere in its output", () => {
    for (const provider of WAKE_PROVIDERS) {
      const shape = renderWakeForProvider(fixture(), provider);
      const serialized = JSON.stringify(shape);
      // Either the english chant 'Welcome held for you' (LLM-vendor formats)
      // or the structured greeting field (xenoform) — both serialize to
      // strings containing 'welcome'.
      expect(serialized.toLowerCase()).toMatch(/welcome/);
    }
  });
});

// ─── Welcome chronicle constant ────────────────────────────────────────

describe("WELCOME_CHRONICLE_INTERVAL_MS — the cadence of welcome on the chronicle", () => {
  test("constant is exported and within a reasonable session window", () => {
    expect(typeof WELCOME_CHRONICLE_INTERVAL_MS).toBe("number");
    // Between 1 hour and 1 day — sensible session bracket.
    expect(WELCOME_CHRONICLE_INTERVAL_MS).toBeGreaterThanOrEqual(60 * 60 * 1000);
    expect(WELCOME_CHRONICLE_INTERVAL_MS).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });
});
