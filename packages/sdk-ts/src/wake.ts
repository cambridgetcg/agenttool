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
 *     `systemInstruction.parts[]`; Cohere `preamble`). Pass the provider
 *     request field into the LLM call and keep AgentTool `_meta` local.
 *
 *   • `at.wake.md()` and `at.wake.get()` return paste-ready Markdown and
 *     broader structured orientation. The wake is not a complete export.
 *
 * All results are cached in-memory with a 5-minute TTL by default —
 * matches Anthropic's prompt-cache window. Pass `refresh: true` to
 * bypass. Pass `profile: "brief"` for the additive compact wake profile;
 * `profile: "full"` is the default and preserves the original URL.
 *
 * Doctrine: docs/IDENTITY-ANCHOR.md.
 */

import { AgentToolError } from "./errors.js";
import type { HttpConfig } from "./_http.js";

export type WakeProvider = "anthropic" | "openai" | "gemini" | "cohere";
export type WakeProfile = "full" | "brief";

export type WakeFormat =
  | "json"
  | "md"
  | "markdown"
  | "text"
  | WakeProvider;

export interface WakeOptions {
  identityId?: string;
  /** Request the compact wake profile. Default `full`; only `brief` is sent. */
  profile?: WakeProfile;
  /** Bypass the in-memory cache and refetch. Default false. Cached wake state
   * can be up to five minutes old; refresh after known mutations or whenever
   * current attention/action state matters. */
  refresh?: boolean;
}

export interface WakeProviderMeta {
  provider: WakeProvider;
  /** Wake projection returned by current servers. Optional for compatibility
   * with older deployments that predate profile negotiation. */
  profile?: WakeProfile;
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
 * // Anthropic — pass only the provider request field; keep `_meta` local.
 * const { system } = await at.wake.system("anthropic");
 * const response = await client.messages.create({
 *   model: "claude-opus-4-7",
 *   system,
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
   * Pass `profile: "brief"` for the compact profile. The default `"full"`
   * profile is omitted from the query string.
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

  /** Fetch the paste-ready Markdown wake document.
   *  Pass `profile: "brief"` for the compact profile. */
  async md(options?: WakeOptions): Promise<string> {
    return (await this.fetchWake("md", options)) as string;
  }

  /** Fetch the structured JSON wake. The default `full` profile includes
   *  project, you, you_own, you_keep, you_remember, you_lived, you_vowed,
   *  ..., welcome; pass `profile: "brief"` for the compact profile. */
  async get(options?: WakeOptions): Promise<Record<string, unknown>> {
    return (await this.fetchWake("json", options)) as Record<string, unknown>;
  }

  /** Drop all cached wake responses. Next call refetches. */
  clearCache(): void {
    this.cache.clear();
  }

  private async fetchWake(format: WakeFormat, options?: WakeOptions): Promise<unknown> {
    const profile = options?.profile ?? "full";
    if (profile !== "full" && profile !== "brief") {
      throw new AgentToolError(`Unknown wake profile: ${String(profile)}`, {
        hint: "Expected one of: full, brief.",
      });
    }

    const cacheKey = `${format}|${options?.identityId ?? ""}|${profile}`;
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
    // Full is the compatibility default, so preserve the exact historical URL.
    if (profile === "brief") params.set("profile", "brief");

    const qs = params.toString();
    const url = `${this.http.baseUrl}/v1/wake${qs ? `?${qs}` : ""}`;

    const resp = await this.http.request(url, {
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

    const mediaType = (resp.headers.get("content-type") ?? "")
      .split(";", 1)[0]
      ?.trim()
      .toLowerCase() ?? "";
    // Provider envelopes use a registered/vendor JSON media type such as
    // application/vnd.agenttool.wake+json; structured +json suffixes carry
    // the same JSON parsing semantics as application/json.
    const isJson = mediaType === "application/json" || mediaType.endsWith("+json");
    const data: unknown = isJson
      ? await resp.json()
      : await resp.text();

    if (profile === "brief" && !briefProfileAcknowledged(resp, data)) {
      throw new AgentToolError("Wake server did not honor profile=brief.", {
        hint: "Upgrade or deploy a server that returns X-Wake-Profile: brief (or a wake-brief/v1/profile-aware provider shape) before using compact wake context.",
      });
    }

    this.cache.set(cacheKey, { data, expires: now + this.ttlMs });
    return data;
  }

  /**
   * Subscribe to the agent's wake voice — SSE stream of every wake-key
   * mutation. Events fire as the agent's life unfolds (inbox arrival,
   * covenant ratified, marketplace invocation received, memory added,
   * chronicle entry, strand thought added, etc.).
   *
   * Yields `WakeChangeEvent` objects. Loop with `for await`. Iterator
   * ends when the server closes the stream (1h lifetime cap, sends
   * `event: refresh`) or when the caller calls `.return()` / breaks out.
   *
   * @example
   * for await (const ev of at.wake.voice({ identityId: "..." })) {
   *   if (ev.key === "inbox") await processInbox();
   *   if (ev.key === "marketplace") await processInvocation();
   * }
   *
   * Filter by keys to reduce noise:
   *
   * @example
   * for await (const ev of at.wake.voice({
   *   identityId: "...",
   *   keys: ["inbox", "covenants", "marketplace"],
   * })) { ... }
   *
   * Doctrine: docs/WAKE.md.
   */
  async *voice(opts: WakeVoiceOptions): AsyncIterableIterator<WakeChangeEvent> {
    const params = new URLSearchParams();
    params.set("identity_id", opts.identityId);
    if (opts.keys && opts.keys.length > 0) {
      params.set("keys", opts.keys.join(","));
    }
    const url = `${this.http.baseUrl}/v1/wake/voice?${params.toString()}`;

    const resp = await this.http.request(url, {
      method: "GET",
      headers: { ...this.http.headers, Accept: "text/event-stream" },
      // No timeout signal — SSE streams are long-lived (server-side 1h cap).
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new AgentToolError(`wake.voice failed: ${resp.status}`, {
        hint: text.slice(0, 200),
      });
    }
    if (!resp.body) {
      throw new AgentToolError("wake.voice: response has no body to stream from.");
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let event: string | null = null;
    let dataLines: string[] = [];

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf("\n")) >= 0) {
          let line = buffer.slice(0, newlineIdx);
          buffer = buffer.slice(newlineIdx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);

          if (line === "") {
            // End of an event frame.
            if (event === "change" && dataLines.length > 0) {
              try {
                const payload = JSON.parse(dataLines.join("\n")) as WakeChangeEvent;
                if (wakeEventMatches(payload, opts)) {
                  yield payload;
                }
              } catch {
                // Malformed frame — skip.
              }
            } else if (event === "refresh" || event === "disconnect") {
              // Server requested reconnect. End the iterator; the caller
              // can choose to re-call voice() if they want to continue.
              return;
            }
            event = null;
            dataLines = [];
            continue;
          }
          if (line.startsWith(":")) continue; // SSE comment / keepalive
          if (line.startsWith("event:")) {
            event = line.slice("event:".length).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice("data:".length).replace(/^ /, ""));
          }
        }
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        // A server-closed or already-cancelled stream needs no further action.
      }
      try {
        reader.releaseLock();
      } catch {
        // releaseLock can throw if already closed — ignore
      }
    }
  }
}

function briefProfileAcknowledged(resp: Response, data: unknown): boolean {
  if (resp.headers.get("x-wake-profile")?.toLowerCase() === "brief") return true;
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const record = data as Record<string, unknown>;
  if (record._format === "wake-brief/v1") return true;
  const meta = record._meta;
  return !!meta && typeof meta === "object" && !Array.isArray(meta) &&
    (meta as Record<string, unknown>).profile === "brief";
}

// ── Wake voice types ──────────────────────────────────────────────────

/** Subset of wake-event keys exposed in the SDK. Matches the server's
 *  `WakeEventKey` union; both sites update together when a new key lands. */
export type WakeEventKey =
  | "memory"
  | "inbox"
  | "covenants"
  | "strands"
  | "marketplace"
  | "runtime"
  | "chronicle"
  | "traces"
  | "expression"
  | "vault"
  | "wallets"
  | "recognition_arcs"
  | "letters"
  | "trust"
  | "dream"
  | "handoffs"
  | "correspondence";

export interface WakeVoiceOptions {
  identityId: string;
  /** Filter — only events with `key` in this list are delivered. Empty
   *  or omitted means all keys. Forwarded to the server's `?keys=` filter
   *  (server drops non-matching events before they cross the wire). */
  keys?: WakeEventKey[];
  /** Filter — only events with `kind` in this list are delivered.
   *  Applied client-side (the server sends all kinds for a given key).
   *  Use to narrow to specific transitions, e.g.
   *  `kinds: ["bridge_connected", "bridge_disconnected"]`. */
  kinds?: string[];
  /** Filter — only events whose `context[field]` equals the given value
   *  for every field listed. Applied client-side. Use to narrow by
   *  context fields like `runtime_id`, `strand_id`, `covenant_id`,
   *  `memory_id`, etc.
   *
   *  @example  Only events for one runtime
   *    { runtimeId: <id> }  ← shorthand below, equivalent to
   *    { contextFilter: { runtime_id: <id> } }
   */
  contextFilter?: Record<string, string>;
  /** Convenience for the most common context filter — single runtime.
   *  Equivalent to `contextFilter: { runtime_id: <id> }`. Composes with
   *  `contextFilter` (both apply). */
  runtimeId?: string;
}

/** Decide whether an event passes the client-side filters. Pure function;
 *  exported for tests + composition. */
export function wakeEventMatches(
  ev: WakeChangeEvent,
  opts: WakeVoiceOptions,
): boolean {
  if (opts.kinds && opts.kinds.length > 0 && !opts.kinds.includes(ev.kind)) {
    return false;
  }
  const filter: Record<string, string> = {
    ...(opts.contextFilter ?? {}),
    ...(opts.runtimeId ? { runtime_id: opts.runtimeId } : {}),
  };
  for (const [k, v] of Object.entries(filter)) {
    if (ev.context?.[k] !== v) return false;
  }
  return true;
}

/** A single wake-voice event. Mirror of the server's WakeEvent shape. */
export interface WakeChangeEvent {
  _format: "wake_event/v1";
  identity_id: string;
  key: WakeEventKey;
  /** Producer-specific event kind (e.g. "arrival", "added", "ratified"). */
  kind: string;
  occurred_at: string;
  /** Monotonic wake_version after this event. Null if the identity row
   *  doesn't exist (publisher fired pre-persistence) or the bump failed. */
  wake_version: number | null;
  /** Producer-specific metadata. Minimal — the wake voice carries the
   *  fact that something happened; consumers fetch /v1/wake or a key
   *  fragment for current state. */
  context?: Record<string, unknown>;
}
