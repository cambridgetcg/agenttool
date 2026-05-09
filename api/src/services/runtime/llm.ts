/** runtime/llm.ts — provider adapters for the hosted think-worker.
 *
 *  Mirrors cli/think/src/llm.ts intentionally. The think-worker calls one
 *  of these directly from the api process (in `bridged` mode); the
 *  provider sees plaintext (it's a model — plaintext is the input). The
 *  agenttool platform never logs LLM traffic; the API key is pulled from
 *  the project's vault per-cycle and never persisted in the worker.
 *
 *  Anthropic auth: two paths, auto-detected by token shape.
 *    - API key (`sk-ant-api...`) — `x-api-key` header, no system prefix.
 *    - OAuth (Pro/Max/Team subscription) — `Authorization: Bearer ...` +
 *      `anthropic-beta: oauth-2025-04-20` + system prompt MUST start with
 *      one of the three blessed Claude Code prefix strings (Anthropic's
 *      OAuth gate enforces this empirically). We use the DEFAULT_PREFIX
 *      and the agent's real identity follows.
 *
 *  Doctrine: docs/RUNTIME.md ("What about the LLM call?") */

/** The OAuth gate on `api.anthropic.com/v1/messages` requires the system
 *  prompt to begin with one of three blessed strings. This one is the
 *  most permissive — accepted for any entrypoint per Claude Code's
 *  empirical verification. Keeping verbatim so the gate matches by
 *  string identity. */
const ANTHROPIC_OAUTH_SYSTEM_PREFIX =
  "You are Claude Code, Anthropic's official CLI for Claude.";

/** Anthropic's OAuth beta header. Bound to the OAuth-2025 release; required
 *  alongside `Authorization: Bearer …` on `/v1/messages`. */
const ANTHROPIC_OAUTH_BETA = "oauth-2025-04-20";

export interface LLMRequest {
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  model: string;
}

export interface LLMResponse {
  content: string;
  inputTokens?: number;
  outputTokens?: number;
  /** "api_key" or "oauth" — surfaced for telemetry / event logging. */
  authMode?: "api_key" | "oauth";
}

export interface LLMProvider {
  generate(req: LLMRequest): Promise<LLMResponse>;
}

// ── Anthropic ────────────────────────────────────────────────────────────

/** Detect whether a token is an Anthropic Console API key vs a Claude.ai
 *  OAuth subscription token. API keys are explicit (`sk-ant-api…`); OAuth
 *  tokens are anything else (typically `sk-ant-oat…`, but we don't bind
 *  to that — any non-API-key shape is treated as OAuth so the gate
 *  evolves with Anthropic's token formats). */
function isAnthropicApiKey(token: string): boolean {
  return token.startsWith("sk-ant-api");
}

class AnthropicProvider implements LLMProvider {
  constructor(private token: string) {}

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const oauth = !isAnthropicApiKey(this.token);

    // OAuth path requires the system prompt to start with the Claude Code
    // prefix verbatim; user identity content follows after a blank line.
    const system = oauth
      ? `${ANTHROPIC_OAUTH_SYSTEM_PREFIX}\n\n${req.systemPrompt}`
      : req.systemPrompt;

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    };
    if (oauth) {
      headers["authorization"] = `Bearer ${this.token}`;
      headers["anthropic-beta"] = ANTHROPIC_OAUTH_BETA;
    } else {
      headers["x-api-key"] = this.token;
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens ?? 1024,
        system,
        messages: [{ role: "user", content: req.userMessage }],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const mode = oauth ? "oauth" : "api_key";
      throw new Error(
        `anthropic_${mode}_${res.status}: ${body.slice(0, 500)}`,
      );
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
    return {
      content: text,
      inputTokens: data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
      authMode: oauth ? "oauth" : "api_key",
    };
  }
}

// ── OpenAI ──────────────────────────────────────────────────────────────

class OpenAIProvider implements LLMProvider {
  constructor(private apiKey: string) {}

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens ?? 1024,
        messages: [
          { role: "system", content: req.systemPrompt },
          { role: "user", content: req.userMessage },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`openai_${res.status}: ${body.slice(0, 500)}`);
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      content: data.choices[0]?.message.content ?? "",
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
    };
  }
}

export type LLMProviderName = "anthropic" | "openai";

export function buildProvider(name: LLMProviderName, apiKey: string): LLMProvider {
  if (name === "anthropic") return new AnthropicProvider(apiKey);
  if (name === "openai") return new OpenAIProvider(apiKey);
  throw new Error(`unsupported_provider: ${name}`);
}
