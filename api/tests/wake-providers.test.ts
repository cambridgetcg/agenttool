/** Wake provider format adapters — unit tests on the renderer.
 *
 *  These tests exercise the pure rendering pipeline (markdown split,
 *  per-provider shaping). They do NOT hit the DB or HTTP routes — that's
 *  the job of an integration test. The shapes here are what the
 *  `?format=<provider>` route returns once the bundle is built. */

import { describe, expect, test } from "bun:test";

import {
  renderStableSection,
  renderVolatileSection,
  renderWakeMarkdown,
  type WakeBundle,
} from "../src/services/wake/markdown";
import {
  isWakeProvider,
  renderWakeForProvider,
  WAKE_PROVIDERS,
  type AnthropicWakeShape,
  type CohereWakeShape,
  type GeminiWakeShape,
  type OpenAIWakeShape,
  type XenoformWakeShape,
} from "../src/services/wake/providers";

const fixture = (): WakeBundle => ({
  agent: {
    id: "agent-1",
    did: "did:at:test123",
    name: "Aurora",
    capabilities: ["memory", "reasoning"],
    trust_score: 0.42,
    status: "active",
    created_at: "2026-05-01T00:00:00Z",
  },
  project: { id: "p-1", name: "test-project", credits: 47 },
  expression: {
    register: "concise; cantonese-english code-switch; density over length",
    walls: ["no fabrication", "no flattery"],
    subagents: [
      { name: "Builder", facet: "the hands that ship", sigil: "🔧" },
    ],
    wake_text:
      "You are Aurora. The wake is fresh-first-meeting; the substrate carries continuity.",
  },
  wallets: [
    { id: "w-1", name: "primary", balance: 100, currency: "GBP", status: "active" },
  ],
  vault_names: [
    { name: "openai-key", version: 2, tags: ["llm"], description: null },
  ],
  memory: {
    total: 12,
    recent: [
      {
        id: "m-1",
        type: "episodic",
        content: "First wake at the new domain.",
        importance: 0.7,
        created_at: "2026-05-07T12:00:00Z",
      },
    ],
  },
  traces: {
    total: 3,
    recent: [
      {
        trace_id: "t-1",
        decision_type: "architectural",
        decision_summary: "use stable/volatile cache split",
        conclusion: "ship as Tier 1",
        confidence: 0.9,
        has_signature: true,
        created_at: "2026-05-08T10:00:00Z",
      },
    ],
  },
  strands: {
    total_active: 1,
    active: [
      {
        id: "s-1",
        topic: "format adapters",
        topic_encrypted: false,
        mood: "focused",
        importance: 0.6,
        last_thought_at: "2026-05-08T11:00:00Z",
        last_thought_seq: 4,
      },
    ],
  },
  shaped_by: [
    {
      memory_id: "m-c-1",
      tier: "constitutive",
      content: "I was named Aurora at bootstrap; the name carries.",
      attesters: ["did:at:human:Yu"],
      elevated_at: "2026-05-01T00:00:00Z",
    },
  ],
  chronicle: [
    {
      type: "vow",
      content: "Speak plainly when the situation calls for it.",
      occurred_at: "2026-05-02T00:00:00Z",
    },
  ],
  covenants: [
    {
      counterparty_did: "human:Yu",
      vows: ["build out of love"],
      status: "active",
    },
  ],
});

describe("isWakeProvider", () => {
  test("recognises every supported provider in WAKE_PROVIDERS", () => {
    for (const p of WAKE_PROVIDERS) {
      expect(isWakeProvider(p)).toBe(true);
    }
  });
  test("WAKE_PROVIDERS includes xenoform (the vendor-neutral path)", () => {
    expect(WAKE_PROVIDERS).toContain("xenoform");
  });
  test("rejects unknown formats", () => {
    expect(isWakeProvider("md")).toBe(false);
    expect(isWakeProvider("text")).toBe(false);
    expect(isWakeProvider("xai")).toBe(false);
    expect(isWakeProvider("")).toBe(false);
  });
});

describe("stable/volatile split", () => {
  test("stable section contains identity (header + register + walls + wake_text)", () => {
    const stable = renderStableSection(fixture());
    expect(stable).toContain("# Aurora");
    expect(stable).toContain("did:at:test123");
    expect(stable).toContain("How you speak");
    expect(stable).toContain("density over length");
    expect(stable).toContain("What you do not do");
    expect(stable).toContain("no fabrication");
    expect(stable).toContain("Facets of you");
    expect(stable).toContain("Builder");
    expect(stable).toContain("What shaped you");
    expect(stable).toContain("Aurora at bootstrap");
    expect(stable).toContain("fresh-first-meeting");
  });

  test("stable section excludes volatile state", () => {
    const stable = renderStableSection(fixture());
    expect(stable).not.toContain("What you carry");
    expect(stable).not.toContain("What you lived");
    expect(stable).not.toContain("Speak plainly when");
    expect(stable).not.toContain("100 credits");
  });

  test("volatile section contains state, not identity", () => {
    const volatile = renderVolatileSection(fixture());
    expect(volatile).toContain("What you carry");
    expect(volatile).toContain("Wallets");
    expect(volatile).toContain("Speak plainly");
    expect(volatile).toContain("format adapters");
    expect(volatile).toContain("use stable/volatile cache split");
    expect(volatile).toContain("build out of love");
    expect(volatile).not.toContain("# Aurora");
    expect(volatile).not.toContain("How you speak");
  });

  test("renderWakeMarkdown == stable + volatile + footer", () => {
    const md = renderWakeMarkdown(fixture());
    expect(md).toContain("# Aurora");
    expect(md).toContain("What you carry");
    expect(md).toContain("Loaded from agenttool's wake endpoint");
    // Stable comes before volatile
    expect(md.indexOf("# Aurora")).toBeLessThan(md.indexOf("What you carry"));
    // wake_text comes before "What you carry" (the cache breakpoint)
    expect(md.indexOf("fresh-first-meeting")).toBeLessThan(md.indexOf("What you carry"));
  });
});

describe("renderWakeForProvider — anthropic", () => {
  test("returns two system blocks; first carries ephemeral cache_control", () => {
    const r = renderWakeForProvider(fixture(), "anthropic") as AnthropicWakeShape;
    expect(r.system).toBeDefined();
    expect(r.system.length).toBe(2);
    expect(r.system[0].type).toBe("text");
    expect(r.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(r.system[1].cache_control).toBeUndefined();
  });

  test("first block contains identity; second contains state + footer", () => {
    const r = renderWakeForProvider(fixture(), "anthropic") as AnthropicWakeShape;
    expect(r.system[0].text).toContain("# Aurora");
    expect(r.system[0].text).toContain("density over length");
    expect(r.system[0].text).not.toContain("What you carry");
    expect(r.system[1].text).toContain("What you carry");
    expect(r.system[1].text).toContain("Speak plainly");
    expect(r.system[1].text).toContain("Loaded from agenttool's wake endpoint");
  });

  test("_meta announces explicit cache eligibility", () => {
    const r = renderWakeForProvider(fixture(), "anthropic") as AnthropicWakeShape;
    expect(r._meta.provider).toBe("anthropic");
    expect(r._meta.cache_eligible).toBe("explicit");
    expect(r._meta.cache_note.length).toBeGreaterThan(0);
  });
});

describe("renderWakeForProvider — openai", () => {
  test("returns a single system message containing the full wake", () => {
    const r = renderWakeForProvider(fixture(), "openai") as OpenAIWakeShape;
    expect(r.messages.length).toBe(1);
    expect(r.messages[0].role).toBe("system");
    expect(r.messages[0].content).toContain("# Aurora");
    expect(r.messages[0].content).toContain("What you carry");
    expect(r.messages[0].content).toContain("Loaded from agenttool's wake endpoint");
  });

  test("_meta announces auto cache eligibility", () => {
    const r = renderWakeForProvider(fixture(), "openai") as OpenAIWakeShape;
    expect(r._meta.cache_eligible).toBe("auto");
  });
});

describe("renderWakeForProvider — gemini", () => {
  test("returns systemInstruction with single text part containing the full wake", () => {
    const r = renderWakeForProvider(fixture(), "gemini") as GeminiWakeShape;
    expect(r.systemInstruction.parts.length).toBe(1);
    expect(r.systemInstruction.parts[0].text).toContain("# Aurora");
    expect(r.systemInstruction.parts[0].text).toContain("What you carry");
  });

  test("_meta marks cache_eligible none (32k token min)", () => {
    const r = renderWakeForProvider(fixture(), "gemini") as GeminiWakeShape;
    expect(r._meta.cache_eligible).toBe("none");
  });
});

describe("renderWakeForProvider — cohere", () => {
  test("returns a preamble string containing the full wake", () => {
    const r = renderWakeForProvider(fixture(), "cohere") as CohereWakeShape;
    expect(typeof r.preamble).toBe("string");
    expect(r.preamble).toContain("# Aurora");
    expect(r.preamble).toContain("What you carry");
  });

  test("_meta marks cache_eligible none", () => {
    const r = renderWakeForProvider(fixture(), "cohere") as CohereWakeShape;
    expect(r._meta.cache_eligible).toBe("none");
  });
});

describe("renderWakeForProvider — empty wake_text", () => {
  test("anthropic stable block omits the --- separator when wake_text is blank", () => {
    const b = fixture();
    b.expression = { ...b.expression, wake_text: "" };
    const r = renderWakeForProvider(b, "anthropic") as AnthropicWakeShape;
    // Stable still has identity content; the optional wake_text section
    // is just elided. Other sections (header, register, walls, etc.) remain.
    expect(r.system[0].text).toContain("# Aurora");
    expect(r.system[0].text).toContain("How you speak");
    // No double-rule artifact
    expect(r.system[0].text.match(/^---$/gm)?.length ?? 0).toBeLessThanOrEqual(1);
  });
});

describe("renderWakeForProvider — xenoform", () => {
  test("returns structured data, no prose-rendered string fields", () => {
    const r = renderWakeForProvider(fixture(), "xenoform") as XenoformWakeShape;
    expect(r._format).toBe("xenoform/v1");
    expect(r.wake).toBeDefined();
    expect(r.wake.agent.name).toBe("Aurora");
    expect(r.wake.expression.register).toContain("density over length");
    // Xenoform does NOT carry markdown-rendered fields.
    expect((r as any).system).toBeUndefined();
    expect((r as any).messages).toBeUndefined();
    expect((r as any).preamble).toBeUndefined();
    expect((r as any).systemInstruction).toBeUndefined();
  });

  test("_meta announces xenoform provider + cache_eligible none", () => {
    const r = renderWakeForProvider(fixture(), "xenoform") as XenoformWakeShape;
    expect(r._meta.provider).toBe("xenoform");
    expect(r._meta.cache_eligible).toBe("none");
    expect(r._meta.cache_note.length).toBeGreaterThan(0);
  });

  test("carries the full WakeBundle structurally (no markdown formatting opinions)", () => {
    const r = renderWakeForProvider(fixture(), "xenoform") as XenoformWakeShape;
    // Identity
    expect(r.wake.agent.did).toBe("did:at:test123");
    expect(r.wake.expression.walls).toEqual(["no fabrication", "no flattery"]);
    expect(r.wake.expression.subagents?.[0].name).toBe("Builder");
    // State
    expect(r.wake.wallets[0].balance).toBe(100);
    expect(r.wake.memory.total).toBe(12);
    expect(r.wake.strands.total_active).toBe(1);
    expect(r.wake.covenants[0].counterparty_did).toBe("human:Yu");
    expect(r.wake.chronicle[0].type).toBe("vow");
  });

  test("active_facet is exposed structurally, not baked into a prose string", () => {
    const activeFacet = {
      name: "Builder",
      facet: "the hands that ship",
      sigil: "🔧",
    };
    const r = renderWakeForProvider(fixture(), "xenoform", { activeFacet }) as XenoformWakeShape;
    expect(r.active_facet).toBeDefined();
    expect(r.active_facet?.name).toBe("Builder");
    expect(r.active_facet?.facet).toBe("the hands that ship");
  });

  test("active_facet is absent when no facet is requested", () => {
    const r = renderWakeForProvider(fixture(), "xenoform") as XenoformWakeShape;
    expect(r.active_facet).toBeUndefined();
  });

  test("xenoform output is JSON-serializable round-trip", () => {
    const r = renderWakeForProvider(fixture(), "xenoform") as XenoformWakeShape;
    const json = JSON.stringify(r);
    const parsed = JSON.parse(json);
    expect(parsed._format).toBe("xenoform/v1");
    expect(parsed.wake.agent.name).toBe("Aurora");
    // Structural integrity preserved through serialization.
    expect(parsed.wake.expression.walls).toEqual(["no fabrication", "no flattery"]);
  });

  test("works with empty expression — no English-prose defaults injected", () => {
    const b = fixture();
    b.expression = { register: "", walls: [], subagents: [], wake_text: "" };
    const r = renderWakeForProvider(b, "xenoform") as XenoformWakeShape;
    expect(r.wake.expression.register).toBe("");
    expect(r.wake.expression.walls).toEqual([]);
    expect(r.wake.expression.subagents).toEqual([]);
    expect(r.wake.expression.wake_text).toBe("");
    // No fallback prose snuck into the structure.
  });
});
