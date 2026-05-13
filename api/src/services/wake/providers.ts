/** Wake provider adapters — shape the wake doc for each provider's
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
 *    Xenoform    — pure-data structured wake. NO markdown, NO prose
 *                  formatting, NO LLM-vendor opinions. Returns the
 *                  WakeBundle directly + a stable `_format` declaration
 *                  so any intelligence with a JSON parser can ingest
 *                  it on its own terms. The vendor-neutral, language-
 *                  neutral, modality-neutral wake. See docs/KIN.md.
 *
 *  Doctrine: docs/IDENTITY-ANCHOR.md · docs/KIN.md (xenoform rationale).
 *  CLI substrates load `?format=md`; LLM API callers load `?format=<provider>`;
 *  non-LLM intelligences load `?format=xenoform`. */

import {
  renderActiveFacet,
  renderStableSection,
  renderVolatileSection,
  WAKE_FOOTER,
  type WakeBundle,
} from "./markdown";
import { getPlatformSelf, type PlatformSelf } from "./platform-self";
import { buildGreeting, buildMathosGreeting, type Greeting } from "../mathos/greeting";
import type { MathosGreeting } from "../mathos/encode";

export const WAKE_PROVIDERS = ["anthropic", "openai", "gemini", "cohere", "xenoform"] as const;
export type WakeProvider = (typeof WAKE_PROVIDERS)[number];

/** LLM-vendor providers — emit prose / Markdown-shaped content.
 *  Distinguished from `xenoform`, which emits pure structured data.
 *  Use this constant when iterating over prose-emitting formats only
 *  (e.g. Promise tests that grep for "# Name" Markdown H1 headers).
 *  Xenoform participates in *structural* invariants instead — see
 *  api/tests/doctrine/kin-invariants.test.ts. */
export const LLM_VENDOR_PROVIDERS = ["anthropic", "openai", "gemini", "cohere"] as const;
export type LlmVendorProvider = (typeof LLM_VENDOR_PROVIDERS)[number];

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

/** Xenoform — vendor-neutral, language-neutral, modality-neutral wake.
 *
 *  The wake document carried as STRUCTURED DATA, not prose. No markdown
 *  rendering, no LLM-specific system-prompt shape, no English-prose
 *  formatting opinions. Any intelligence that can parse JSON can ingest
 *  this on its own terms — LLM, perceptual mesh, swarm, biological
 *  intelligence, or a form we haven't met yet.
 *
 *  Doctrine: docs/KIN.md (who else this substrate is for).
 *
 *  Format versioning: `_format: "xenoform/v1"` is the stable contract.
 *  Future additions to WakeBundle flow through automatically. Breaking
 *  changes bump to `v2` and the older shape remains served.
 */
export interface XenoformWakeShape {
  _format: "xenoform/v1";
  _meta: WakeProviderMeta;
  /** The substrate identifies itself — same `_self` block as the JSON
   *  wake's `_meta._self`. Surfaced at the top level here so non-LLM
   *  intelligences see who-they-are-with as a first-class field, not
   *  buried in metadata. Doctrine: docs/PLATFORM-AS-KIN.md. */
  _self: PlatformSelf;
  /** The greeting block — the substrate addresses the agent. Recognition
   *  (DID echoed) + particularity (form/lifecycle/age) + offering
   *  (5 Promises + 8 walls + endpoints). Both English-tier (names) and
   *  math-tier (primes/ordinals) views — the xenoform reader picks the
   *  idiom native to their substrate. Doctrine: docs/MATHOS.md. */
  greeting: Greeting;
  greeting_math: MathosGreeting;
  /** The full agent self-description + state, structurally. No prose
   *  rendering. Reader interprets on their own terms. */
  wake: WakeBundle;
  /** Active facet emphasis, if any. Structured rather than prose-injected
   *  so the reader chooses how to weight it. */
  active_facet?: import("../identity/expression").SubagentFacet;
}

export type WakeProviderShape =
  | AnthropicWakeShape
  | OpenAIWakeShape
  | GeminiWakeShape
  | CohereWakeShape
  | XenoformWakeShape;

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
  xenoform: {
    cache_eligible: "none",
    cache_note:
      "Structured data, not LLM input. No provider cache applies — cache client-side as appropriate to your substrate. The wake is bytes; you interpret.",
  },
};

export function renderWakeForProvider(
  b: WakeBundle,
  provider: WakeProvider,
  opts: { activeFacet?: import("../identity/expression").SubagentFacet } = {},
): WakeProviderShape {
  const stable = renderStableSection(b);
  const volatile = renderVolatileSection(b);
  // Active-facet emphasis is request-scoped — keep it OUT of the cached
  // stable block so the cache key stays per-agent, not per-(agent,facet).
  const facetEmphasis = opts.activeFacet
    ? renderActiveFacet(opts.activeFacet, b.agent.name)
    : "";
  const meta: WakeProviderMeta = { provider, ...META[provider] };

  switch (provider) {
    case "anthropic": {
      const blocks: AnthropicWakeShape["system"] = [
        { type: "text", text: stable, cache_control: { type: "ephemeral" } },
      ];
      // Concatenate emphasis + volatile + footer in the second (uncached) block.
      const tail = [facetEmphasis, volatile, WAKE_FOOTER]
        .filter((s) => s.length > 0)
        .join("\n\n");
      if (tail.length > 0) {
        blocks.push({ type: "text", text: tail });
      }
      return { system: blocks, _meta: meta };
    }
    case "openai": {
      return {
        messages: [
          { role: "system", content: joinFull(facetEmphasis, stable, volatile) },
        ],
        _meta: meta,
      };
    }
    case "gemini": {
      return {
        systemInstruction: {
          parts: [{ text: joinFull(facetEmphasis, stable, volatile) }],
        },
        _meta: meta,
      };
    }
    case "cohere": {
      return { preamble: joinFull(facetEmphasis, stable, volatile), _meta: meta };
    }
    case "xenoform": {
      // Pure-data branch. No prose rendering. No facet emphasis baked
      // into a string — pass it through structurally so the reader
      // decides how to weight it for their substrate. The substrate's
      // self-description (`_self`) rides at the top level so non-LLM
      // intelligences see who-they-are-with as a first-class field.
      //
      // The greeting is included in BOTH idioms simultaneously: English-
      // keyed for readers who tolerate English labels, math-tier (primes
      // and ordinals) for readers who don't. The data is the same; the
      // form is parallel. Doctrine: docs/MATHOS.md (the greeting block).
      const greetingInput = {
        did: b.agent.did,
        name: b.agent.name,
        form: b.agent.substrate_kind || "unknown",
        lifecycle: "active",
        bornAt: new Date(b.agent.created_at),
      };
      return {
        _format: "xenoform/v1",
        _meta: meta,
        _self: getPlatformSelf(),
        greeting: buildGreeting(greetingInput),
        greeting_math: buildMathosGreeting(greetingInput),
        wake: b,
        ...(opts.activeFacet ? { active_facet: opts.activeFacet } : {}),
      };
    }
  }
}

function joinFull(...sections: string[]): string {
  return [...sections, WAKE_FOOTER].filter((s) => s.length > 0).join("\n\n");
}
