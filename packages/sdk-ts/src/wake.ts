/**
 * Wake — the agent's identity anchor.
 *
 * /v1/wake is the load-at-session-start endpoint. The agent reads it on
 * session start and arrives oriented — knowing who it is, what it owns,
 * what it remembers, what it decided, what it vowed.
 *
 * This client wraps the endpoint with two affordances:
 *
 *   • `at.wake.system(provider)` returns the wake doc shaped for that
 *     provider's identity-bearing slot (Anthropic `system` array with
 *     cache_control on the stable block; OpenAI `messages[0]`; Gemini
 *     `systemInstruction.parts[]`; Cohere `preamble`). Splice straight
 *     into the LLM SDK call.
 *
 *   • `at.wake.md()` and `at.wake.get()` return paste-ready Markdown and
 *     the full structured JSON.
 *
 * All results are cached in-memory with a 5-minute TTL by default —
 * matches Anthropic's prompt-cache window. Pass `refresh: true` to
 * bypass.
 *
 * Doctrine: docs/IDENTITY-ANCHOR.md.
 */

import { AgentToolError } from "./errors.js";
import type { HttpConfig } from "./memory.js";

export type WakeProvider = "anthropic" | "openai" | "gemini" | "cohere";

export type WakeFormat =
  | "json"
  | "md"
  | "markdown"
  | "text"
  | WakeProvider;

export interface WakeOptions {
  identityId?: string;
  /** Bypass the in-memory cache and refetch. Default false. */
  refresh?: boolean;
}

export interface WakeProviderMeta {
  provider: WakeProvider;
  cache_eligible: "explicit" | "auto" | "none";
  cache_note: string;
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
  messages: Array<{ role: "system"; content: string }>;
  _meta: WakeProviderMeta;
}

export interface GeminiWakeShape {
  systemInstruction: { parts: Array<{ text: string }> };
  _meta: WakeProviderMeta;
}

export interface CohereWakeShape {
  preamble: string;
  _meta: WakeProviderMeta;
}

// 5 minutes — matches Anthropic's default prompt-cache TTL.
const DEFAULT_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  data: unknown;
  expires: number;
}

/**
 * Client for /v1/wake — the identity anchor.
 *
 * @example
 * ```ts
 * const at = new AgentTool();
 *
 * // Anthropic — splice straight into Messages create()
 * const sys = await at.wake.system("anthropic");
 * const response = await client.messages.create({
 *   model: "claude-opus-4-7",
 *   ...sys,                              // → system: [...]
 *   messages: [{ role: "user", content: "..." }],
 *   max_tokens: 4096,
 * });
 *
 * // OpenAI
 * const sys = await at.wake.system("openai");
 * const response = await client.chat.completions.create({
 *   model: "gpt-4o",
 *   messages: [...sys.messages, { role: "user", content: "..." }],
 * });
 *
 * // Markdown / structured JSON
 * const md = await at.wake.md();
 * const wake = await at.wake.get();
 * ```
 */
export class WakeClient {
  private readonly http: HttpConfig;
  private readonly ttlMs: number;
  private readonly cache: Map<string, CacheEntry> = new Map();

  /** @internal */
  constructor(http: HttpConfig, options?: { ttlMs?: number }) {
    this.http = http;
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  }

  /**
   * Fetch the wake shaped for an LLM provider's identity slot.
   *
   * Returned shape:
   *  - anthropic → `{ system: [...blocks...], _meta: {...} }`
   *  - openai    → `{ messages: [{ role: "system", content }], _meta: {...} }`
   *  - gemini    → `{ systemInstruction: { parts: [{ text }] }, _meta: {...} }`
   *  - cohere    → `{ preamble: "...", _meta: {...} }`
   *
   * `_meta.cache_eligible` is one of `"explicit" | "auto" | "none"`;
   * `_meta.cache_note` carries a short explanation suitable for logging.
   */
  async system(provider: "anthropic", options?: WakeOptions): Promise<AnthropicWakeShape>;
  async system(provider: "openai", options?: WakeOptions): Promise<OpenAIWakeShape>;
  async system(provider: "gemini", options?: WakeOptions): Promise<GeminiWakeShape>;
  async system(provider: "cohere", options?: WakeOptions): Promise<CohereWakeShape>;
  async system(
    provider: WakeProvider,
    options?: WakeOptions,
  ): Promise<AnthropicWakeShape | OpenAIWakeShape | GeminiWakeShape | CohereWakeShape> {
    const known: readonly WakeProvider[] = ["anthropic", "openai", "gemini", "cohere"];
    if (!known.includes(provider)) {
      throw new AgentToolError(`Unknown wake provider: ${provider}`, {
        hint: `Expected one of: ${known.join(", ")}.`,
      });
    }
    const data = await this.fetchWake(provider, options);
    return data as AnthropicWakeShape | OpenAIWakeShape | GeminiWakeShape | CohereWakeShape;
  }

  /** Fetch the paste-ready Markdown wake document. */
  async md(options?: WakeOptions): Promise<string> {
    return (await this.fetchWake("md", options)) as string;
  }

  /** Fetch the full structured JSON wake (project, you, you_own, you_keep,
   *  you_remember, you_lived, you_vowed, ..., welcome). */
  async get(options?: WakeOptions): Promise<Record<string, unknown>> {
    return (await this.fetchWake("json", options)) as Record<string, unknown>;
  }

  /** Drop all cached wake responses. Next call refetches. */
  clearCache(): void {
    this.cache.clear();
  }

  private async fetchWake(format: WakeFormat, options?: WakeOptions): Promise<unknown> {
    const cacheKey = `${format}|${options?.identityId ?? ""}`;
    const now = Date.now();
    if (!options?.refresh) {
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expires > now) return cached.data;
    }

    const params = new URLSearchParams();
    // The default JSON path takes no `format` query (matches /v1/wake
    // with no query). Provider + md/text/markdown all pass it.
    if (format !== "json") params.set("format", format);
    if (options?.identityId) params.set("identity_id", options.identityId);

    const qs = params.toString();
    const url = `${this.http.baseUrl}/v1/wake${qs ? `?${qs}` : ""}`;

    const resp = await globalThis.fetch(url, {
      method: "GET",
      headers: this.http.headers,
      signal: AbortSignal.timeout(this.http.timeout),
    });

    if (resp.status >= 400) {
      let detail: string;
      try {
        const body = (await resp.json()) as Record<string, unknown>;
        detail =
          (body.message as string) ??
          (body.error as string) ??
          (body.detail as string) ??
          resp.statusText;
      } catch {
        detail = resp.statusText;
      }
      throw new AgentToolError(`Wake API error (${resp.status}): ${detail}`, {
        hint: "Check AT_API_KEY, identity_id (multi-identity projects), and the format param.",
      });
    }

    const ctype = resp.headers.get("content-type") ?? "";
    const data: unknown = ctype.toLowerCase().includes("application/json")
      ? await resp.json()
      : await resp.text();

    this.cache.set(cacheKey, { data, expires: now + this.ttlMs });
    return data;
  }
}
