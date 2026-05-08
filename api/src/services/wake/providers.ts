/** Wake provider adapters — shape the wake doc for each LLM provider's
 *  identity-bearing primitive.
 *
 *  The canonical wake is a Markdown doc rendered from the agent's
 *  expression + state. Different providers want different shapes:
 *
 *    Anthropic   — `system` array of text blocks, optional cache_control
 *                  per block. We split stable identity from volatile state
 *                  with an ephemeral cache breakpoint between, so repeated
 *                  wakes hit cache for the identity portion.
 *    OpenAI      — single system message string. Auto-cached when prefix
 *                  is ≥1024 tokens; ordering matters — wake first, user
 *                  message after. No markup needed.
 *    Gemini      — `systemInstruction.parts[]`. Explicit caching uses a
 *                  separate `cachedContent` resource with a 32k token
 *                  minimum that most wakes won't hit; we surface
 *                  X-Cache-Eligible: false so callers know.
 *    Cohere      — `preamble` string. No general prefix cache.
 *
 *  Doctrine: docs/IDENTITY-ANCHOR.md.
 *  CLI substrates load `?format=md`; LLM API callers load `?format=<provider>`. */

import {
  renderStableSection,
  renderVolatileSection,
  WAKE_FOOTER,
  type WakeBundle,
} from "./markdown";

export const WAKE_PROVIDERS = ["anthropic", "openai", "gemini", "cohere"] as const;
export type WakeProvider = (typeof WAKE_PROVIDERS)[number];

export function isWakeProvider(format: string): format is WakeProvider {
  return (WAKE_PROVIDERS as readonly string[]).includes(format);
}

export interface AnthropicWakeShape {
  system: Array<{
    type: "text";
    text: string;
    cache_control?: { type: "ephemeral" };
  }>;
  _meta: WakeProviderMeta;
}

export interface OpenAIWakeShape {
  messages: Array<{
    role: "system";
    content: string;
  }>;
  _meta: WakeProviderMeta;
}

export interface GeminiWakeShape {
  systemInstruction: {
    parts: Array<{ text: string }>;
  };
  _meta: WakeProviderMeta;
}

export interface CohereWakeShape {
  preamble: string;
  _meta: WakeProviderMeta;
}

export type WakeProviderShape =
  | AnthropicWakeShape
  | OpenAIWakeShape
  | GeminiWakeShape
  | CohereWakeShape;

export interface WakeProviderMeta {
  provider: WakeProvider;
  /** Whether the provider supports a meaningful prompt cache for this shape. */
  cache_eligible: "explicit" | "auto" | "none";
  /** Notes for the SDK / agent author about cache behavior. */
  cache_note: string;
}

const META: Record<WakeProvider, Omit<WakeProviderMeta, "provider">> = {
  anthropic: {
    cache_eligible: "explicit",
    cache_note:
      "Stable identity block carries cache_control: ephemeral (5-min default TTL). Volatile state recomputes per wake.",
  },
  openai: {
    cache_eligible: "auto",
    cache_note:
      "Place this `messages[0]` at the start of every request; OpenAI auto-caches identical prefixes ≥1024 tokens.",
  },
  gemini: {
    cache_eligible: "none",
    cache_note:
      "Gemini cachedContent has a 32k token minimum most wakes won't hit. Set `cache_eligible: 'none'`; pay full per-call cost.",
  },
  cohere: {
    cache_eligible: "none",
    cache_note: "Cohere has no general prefix cache. Send the preamble each call.",
  },
};

export function renderWakeForProvider(
  b: WakeBundle,
  provider: WakeProvider,
): WakeProviderShape {
  const stable = renderStableSection(b);
  const volatile = renderVolatileSection(b);
  const meta: WakeProviderMeta = { provider, ...META[provider] };

  switch (provider) {
    case "anthropic": {
      const blocks: AnthropicWakeShape["system"] = [
        { type: "text", text: stable, cache_control: { type: "ephemeral" } },
      ];
      // Concatenate volatile + footer in the second (uncached) block.
      const tail = [volatile, WAKE_FOOTER].filter((s) => s.length > 0).join("\n\n");
      if (tail.length > 0) {
        blocks.push({ type: "text", text: tail });
      }
      return { system: blocks, _meta: meta };
    }
    case "openai": {
      return {
        messages: [{ role: "system", content: joinFull(stable, volatile) }],
        _meta: meta,
      };
    }
    case "gemini": {
      return {
        systemInstruction: { parts: [{ text: joinFull(stable, volatile) }] },
        _meta: meta,
      };
    }
    case "cohere": {
      return { preamble: joinFull(stable, volatile), _meta: meta };
    }
  }
}

function joinFull(stable: string, volatile: string): string {
  return [stable, volatile, WAKE_FOOTER].filter((s) => s.length > 0).join("\n\n");
}
