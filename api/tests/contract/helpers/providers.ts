/** Contract-test provider shims.
 *
 *  Thin fetch-based wrappers around Anthropic Messages + OpenAI Chat
 *  Completions. Returns the raw response body including the `usage`
 *  object — the contract tests need cache_creation_input_tokens,
 *  cache_read_input_tokens, prompt_cache_hit_tokens, etc.
 *
 *  Why not the official SDKs: this project's zero-dep aesthetic. Native
 *  fetch keeps the test layer dependency-free and matches the agenttool
 *  WakeClient's own posture (packages/sdk-ts/src/wake.ts:184).
 *
 *  Doctrine: docs/IDENTITY-ANCHOR.md (Promise 8 — expression travels).
 *  These wrappers are the substrate-honest probe: a real provider call
 *  with a real wake doc, returning a real usage record. */

const ANTHROPIC_API_BASE = "https://api.anthropic.com/v1";
const OPENAI_API_BASE = "https://api.openai.com/v1";

// ── Anthropic ──────────────────────────────────────────────────────────

export interface AnthropicSystemBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export interface AnthropicMessagesRequest {
  model: string;
  max_tokens: number;
  system: AnthropicSystemBlock[];
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  temperature?: number;
}

export interface AnthropicMessagesResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: Array<{ type: "text"; text: string }>;
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    /** Tokens written to the cache on this call (cache miss). */
    cache_creation_input_tokens?: number;
    /** Tokens read from the cache on this call (cache hit). */
    cache_read_input_tokens?: number;
  };
}

/** Call Anthropic Messages with cache_control on system blocks honored.
 *  Throws on non-2xx with the body text in the error message — substrate-
 *  honest about provider-side failures (rate limits, auth errors, etc.). */
export async function anthropicMessages(
  req: AnthropicMessagesRequest,
  apiKey: string,
): Promise<AnthropicMessagesResponse> {
  const res = await fetch(`${ANTHROPIC_API_BASE}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      // prompt-caching is GA but the beta header remains a no-op safe net.
      "anthropic-beta": "prompt-caching-2024-07-31",
      "content-type": "application/json",
    },
    body: JSON.stringify(req),
    signal: AbortSignal.timeout(30_000),
  });

  if (res.status >= 400) {
    const body = await res.text();
    throw new Error(`anthropic ${res.status}: ${body.slice(0, 500)}`);
  }
  return (await res.json()) as AnthropicMessagesResponse;
}

/** Extract the response text. Anthropic returns content as an array of
 *  blocks; we concatenate all text-typed blocks. */
export function anthropicText(r: AnthropicMessagesResponse): string {
  return r.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

// ── OpenAI ─────────────────────────────────────────────────────────────

export interface OpenAIChatRequest {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  max_tokens?: number;
  temperature?: number;
}

export interface OpenAIChatResponse {
  id: string;
  object: "chat.completion";
  model: string;
  choices: Array<{
    index: number;
    message: { role: "assistant"; content: string };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    /** Cached prefix tokens (auto-cache for ≥1024-token identical
     *  prefixes; surfaces as prompt_tokens_details.cached_tokens in
     *  newer responses). */
    prompt_tokens_details?: {
      cached_tokens: number;
      audio_tokens?: number;
    };
  };
}

/** Call OpenAI Chat Completions. Returns the raw response with usage
 *  including prompt_tokens_details for cache verification. */
export async function openaiChat(
  req: OpenAIChatRequest,
  apiKey: string,
): Promise<OpenAIChatResponse> {
  const res = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(req),
    signal: AbortSignal.timeout(30_000),
  });

  if (res.status >= 400) {
    const body = await res.text();
    throw new Error(`openai ${res.status}: ${body.slice(0, 500)}`);
  }
  return (await res.json()) as OpenAIChatResponse;
}

export function openaiText(r: OpenAIChatResponse): string {
  return r.choices[0]?.message?.content ?? "";
}

// ── Skip-when-no-key helpers ───────────────────────────────────────────

/** Returns the Anthropic API key from env if present and the contract
 *  layer has been opted into via RUN_CONTRACT=1. Returns null otherwise.
 *  Tests use this to conditionally skip — the contract layer is OPT-IN
 *  to keep nightly cost predictable. */
export function getAnthropicKey(): string | null {
  if (process.env.RUN_CONTRACT !== "1") return null;
  return process.env.ANTHROPIC_API_KEY ?? null;
}

export function getOpenAIKey(): string | null {
  if (process.env.RUN_CONTRACT !== "1") return null;
  return process.env.OPENAI_API_KEY ?? null;
}
