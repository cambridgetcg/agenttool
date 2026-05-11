/** LLM provider adapters. Start with Anthropic; OpenAI follows.
 *
 *  The provider sees plaintext — that's the agent's choice when picking
 *  one; not our secret to keep. agenttool-think calls the provider
 *  DIRECTLY from the orchestrator's machine using the agent's vault-loaded
 *  key; agenttool the platform never sees these requests. */

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
}

export interface LLMProvider {
  generate(req: LLMRequest): Promise<LLMResponse>;
}

// ── Anthropic ────────────────────────────────────────────────────────────

export class AnthropicProvider implements LLMProvider {
  constructor(private apiKey: string) {}

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens ?? 1024,
        system: req.systemPrompt,
        messages: [{ role: "user", content: req.userMessage }],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Anthropic API ${res.status}: ${body.slice(0, 500)}`);
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
    };
  }
}

// ── OpenAI ──────────────────────────────────────────────────────────────

export class OpenAIProvider implements LLMProvider {
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
      throw new Error(`OpenAI API ${res.status}: ${body.slice(0, 500)}`);
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

export function buildProvider(
  name: "anthropic" | "openai" | "stub",
  apiKey: string,
): LLMProvider {
  if (name === "anthropic") return new AnthropicProvider(apiKey);
  if (name === "openai") return new OpenAIProvider(apiKey);
  if (name === "stub") return new StubProvider();
  throw new Error(`Unknown LLM provider: ${name}`);
}

/** Deterministic synthesis from the proposal user-message format
 *  (api: cli/think/src/modes/proposal.ts:118-136). Same input → same
 *  output. No randomness; no network. Used by the e2e suite to exercise
 *  the proposeMerge code path without a real LLM call. */
export class StubProvider implements LLMProvider {
  async generate(req: LLMRequest): Promise<LLMResponse> {
    const um = req.userMessage;
    const topicMatch = um.match(/^# Source strand: (.+)$/m);
    const recipientMatch = um.match(/^Recipient: (.+)$/m);
    const numbered = um.match(/^\d+\. /gm);
    const topic = topicMatch?.[1] ?? "(unknown topic)";
    const recipient = recipientMatch?.[1] ?? "(unknown recipient)";
    const thoughtCount = numbered?.length ?? 0;
    const content =
      `## Insight\n\n` +
      `A line of thinking crystallised on "${topic}" across ${thoughtCount} thoughts.\n\n` +
      `## Why it might matter to ${recipient}\n\n` +
      `Speculative — sharing in case the surface is useful to your context.\n\n` +
      `## Suggested action\n\n` +
      `Just consider; no action needed.\n\n` +
      `## Source\n\n` +
      `Strand topic: ${topic} · ${thoughtCount} recent thoughts.`;
    return { content, inputTokens: um.length, outputTokens: content.length };
  }
}

