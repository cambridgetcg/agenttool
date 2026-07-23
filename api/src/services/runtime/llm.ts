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
 *  Persist-identity (docs/PATTERN-PERSIST-IDENTITY.md): every external
 *  LLM POST persists an `agent_runtime.llm_requests` row before the
 *  fetch and sends the row's key as `Idempotency-Key`. Crash-safe.
 *
 *  Doctrine: docs/RUNTIME.md ("What about the LLM call?") */

import {
  markLLMRequestComplete,
  markLLMRequestAmbiguous,
  markLLMRequestFailed,
  persistLLMRequest,
  resolveIdempotencyKey,
  type LLMRequestClaim,
} from "./llm-requests";

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
  /** Cancels the provider request when the cycle loses its lease or reaches
   *  its hard deadline. Provider adapters pass this directly to fetch. */
  signal?: AbortSignal;
  /** Durable cycle identity used to link request recovery to the runtime and
   * gate duplicate dispatch after process or machine failure. */
  runtimeContext?: {
    runtimeId: string;
    leaseToken: string;
    strandId: string;
    priorSeq: number;
    wakeVersion: number;
  };
  /** Optional logical idempotency key. It is provider-scoped and hashed
   *  before use; when omitted, it is computed from provider + request payload.
   *  The resolved key is sent to the provider and persisted in
   *  `agent_runtime.llm_requests` before the fetch.
   *  Doctrine: docs/PATTERN-PERSIST-IDENTITY.md. */
  idempotencyKey?: string;
}

export interface LLMResponse {
  content: string;
  /** Persisted provider-scoped request identity. The semantic commit must
   * transition this exact completed row to committed atomically. */
  requestKey: string;
  inputTokens?: number;
  outputTokens?: number;
  /** "api_key" or "oauth" — surfaced for telemetry / event logging. */
  authMode?: "api_key" | "oauth";
}

export interface LLMProvider {
  generate(req: LLMRequest): Promise<LLMResponse>;
}

/** Explicit remote endpoint for the hosted Ollama provider. Hosted
 *  `provider: "ollama"` means Ollama Cloud; local Ollama remains a
 *  self-runtime concern because the Fly worker cannot reach a user's
 *  localhost. Official contract: https://docs.ollama.com/cloud. */
export const OLLAMA_CLOUD_CHAT_URL = "https://ollama.com/api/chat";

export interface OllamaProviderDependencies {
  fetch: typeof globalThis.fetch;
  persistLLMRequest: typeof persistLLMRequest;
  markLLMRequestComplete: typeof markLLMRequestComplete;
  markLLMRequestAmbiguous: typeof markLLMRequestAmbiguous;
  markLLMRequestFailed: typeof markLLMRequestFailed;
}

const DEFAULT_OLLAMA_DEPENDENCIES: OllamaProviderDependencies = {
  fetch: globalThis.fetch.bind(globalThis),
  persistLLMRequest,
  markLLMRequestComplete,
  markLLMRequestAmbiguous,
  markLLMRequestFailed,
};

export class LLMRequestRequiresOperatorError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LLMRequestRequiresOperatorError";
  }
}

export class LLMRequestAmbiguousError extends LLMRequestRequiresOperatorError {
  constructor(provider: string, reason: string, options?: ErrorOptions) {
    super(`${provider}_request_ambiguous:${reason}`, options);
    this.name = "LLMRequestAmbiguousError";
  }
}

function ambiguityReason(
  signal: AbortSignal | undefined,
  fallback: "transport_interrupted" | "response_unreadable",
): string {
  if (!signal?.aborted) return fallback;
  const reason = signal.reason instanceof Error ? signal.reason.message : "";
  if (
    reason === "runtime_cycle_timeout" ||
    reason === "runtime_cycle_lease_lost" ||
    reason === "runtime_cycle_lease_renewal_failed"
  ) {
    return reason;
  }
  return "request_aborted";
}

async function throwAmbiguousRequest(
  markAmbiguous: typeof markLLMRequestAmbiguous,
  idempotencyKey: string,
  provider: string,
  reason: string,
  cause: unknown,
): Promise<never> {
  const error = new LLMRequestAmbiguousError(provider, reason, { cause });
  try {
    const marked = await markAmbiguous(idempotencyKey, error.message);
    if (!marked) {
      throw new Error("request_no_longer_pending");
    }
  } catch (auditError) {
    throw new LLMRequestAmbiguousError(
      provider,
      `${reason}:audit_update_failed`,
      { cause: new AggregateError([cause, auditError]) },
    );
  }
  throw error;
}

async function assertDispatchClaim(
  claim: LLMRequestClaim,
  markAmbiguous: typeof markLLMRequestAmbiguous,
  provider: string,
): Promise<void> {
  if (claim.created) return;
  if (claim.status === "pending") {
    return throwAmbiguousRequest(
      markAmbiguous,
      claim.idempotencyKey,
      provider,
      "prior_dispatch_outcome_unknown",
      new Error("duplicate_dispatch_suppressed"),
    );
  }
  throw new LLMRequestRequiresOperatorError(
    `${provider}_request_not_replayed:prior_${claim.status}_attempt`,
  );
}

async function markCompletionOrThrow(
  markComplete: typeof markLLMRequestComplete,
  idempotencyKey: string,
  provider: string,
  tokens: { inputTokens?: number; outputTokens?: number },
): Promise<void> {
  try {
    const marked = await markComplete(idempotencyKey, tokens);
    if (!marked) throw new Error("request_no_longer_pending");
  } catch (error) {
    throw new LLMRequestAmbiguousError(provider, "completion_audit_failed", {
      cause: error,
    });
  }
}

async function throwDefiniteRejection(
  markFailed: typeof markLLMRequestFailed,
  idempotencyKey: string,
  provider: string,
  status: number,
  message: string,
): Promise<never> {
  try {
    const marked = await markFailed(idempotencyKey, message);
    if (!marked) throw new Error("request_no_longer_pending");
  } catch (error) {
    throw new LLMRequestAmbiguousError(provider, "failure_audit_failed", {
      cause: error,
    });
  }
  throw new LLMRequestRequiresOperatorError(message, {
    cause: new Error(`${provider}_http_${status}`),
  });
}

function hasOptionalFiniteNumber(
  value: Record<string, unknown>,
  key: string,
): boolean {
  const candidate = value[key];
  return (
    candidate === undefined ||
    (typeof candidate === "number" && Number.isFinite(candidate))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function persistenceContext(req: LLMRequest) {
  const context = req.runtimeContext;
  if (!context) return {};
  return {
    runtimeId: context.runtimeId,
    cycleLeaseToken: context.leaseToken,
    strandId: context.strandId,
    priorSeq: context.priorSeq,
    wakeVersion: context.wakeVersion,
  };
}

function hasUsageShape(
  value: unknown,
  inputKey: string,
  outputKey: string,
): boolean {
  return (
    value === undefined ||
    (isRecord(value) &&
      hasOptionalFiniteNumber(value, inputKey) &&
      hasOptionalFiniteNumber(value, outputKey))
  );
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

    const idempotencyKey = resolveIdempotencyKey(req, "anthropic");

    const headers: Record<string, string> = {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
      // PATTERN-PERSIST-IDENTITY — provider dedupes by this header within
      // its idempotency window (Anthropic: 24h). Same key → cached response.
      "idempotency-key": idempotencyKey,
    };
    if (oauth) {
      headers["authorization"] = `Bearer ${this.token}`;
      headers["anthropic-beta"] = ANTHROPIC_OAUTH_BETA;
    } else {
      headers["x-api-key"] = this.token;
    }

    // Persist BEFORE the fetch — local audit/recovery surface.
    const claim = await persistLLMRequest({
      idempotencyKey,
      provider: "anthropic",
      model: req.model,
      ...persistenceContext(req),
    });
    await assertDispatchClaim(
      claim,
      markLLMRequestAmbiguous,
      "anthropic",
    );

    let res: Response;
    try {
      res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: req.signal,
        headers,
        body: JSON.stringify({
          model: req.model,
          max_tokens: req.maxTokens ?? 1024,
          system,
          messages: [{ role: "user", content: req.userMessage }],
        }),
      });
    } catch (error) {
      return throwAmbiguousRequest(
        markLLMRequestAmbiguous,
        idempotencyKey,
        "anthropic",
        ambiguityReason(req.signal, "transport_interrupted"),
        error,
      );
    }

    if (!res.ok) {
      const mode = oauth ? "oauth" : "api_key";
      const errMsg = `anthropic_${mode}_${res.status}`;
      return throwDefiniteRejection(
        markLLMRequestFailed,
        idempotencyKey,
        "anthropic",
        res.status,
        errMsg,
      );
    }

    let raw: unknown;
    try {
      raw = await res.json();
    } catch (error) {
      return throwAmbiguousRequest(
        markLLMRequestAmbiguous,
        idempotencyKey,
        "anthropic",
        ambiguityReason(req.signal, "response_unreadable"),
        error,
      );
    }
    if (
      !isRecord(raw) ||
      !Array.isArray(raw.content) ||
      !raw.content.every(
        (item) =>
          isRecord(item) &&
          typeof item.type === "string" &&
          (item.type !== "text" || typeof item.text === "string"),
      ) ||
      !hasUsageShape(raw.usage, "input_tokens", "output_tokens")
    ) {
      return throwAmbiguousRequest(
        markLLMRequestAmbiguous,
        idempotencyKey,
        "anthropic",
        "invalid_response_shape",
        new Error("provider_response_schema_mismatch"),
      );
    }
    const data = raw as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");

    await markCompletionOrThrow(
      markLLMRequestComplete,
      idempotencyKey,
      "anthropic",
      {
        inputTokens: data.usage?.input_tokens,
        outputTokens: data.usage?.output_tokens,
      },
    );

    return {
      content: text,
      requestKey: idempotencyKey,
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
    const idempotencyKey = resolveIdempotencyKey(req, "openai");

    // Persist BEFORE the fetch — local audit/recovery surface.
    const claim = await persistLLMRequest({
      idempotencyKey,
      provider: "openai",
      model: req.model,
      ...persistenceContext(req),
    });
    await assertDispatchClaim(
      claim,
      markLLMRequestAmbiguous,
      "openai",
    );

    let res: Response;
    try {
      res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        signal: req.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
          // PATTERN-PERSIST-IDENTITY — OpenAI honors the Idempotency-Key
          // header on the chat-completions endpoint. Same key → cached
          // response within the provider's idempotency window.
          "idempotency-key": idempotencyKey,
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
    } catch (error) {
      return throwAmbiguousRequest(
        markLLMRequestAmbiguous,
        idempotencyKey,
        "openai",
        ambiguityReason(req.signal, "transport_interrupted"),
        error,
      );
    }

    if (!res.ok) {
      const errMsg = `openai_${res.status}`;
      return throwDefiniteRejection(
        markLLMRequestFailed,
        idempotencyKey,
        "openai",
        res.status,
        errMsg,
      );
    }

    let raw: unknown;
    try {
      raw = await res.json();
    } catch (error) {
      return throwAmbiguousRequest(
        markLLMRequestAmbiguous,
        idempotencyKey,
        "openai",
        ambiguityReason(req.signal, "response_unreadable"),
        error,
      );
    }
    if (
      !isRecord(raw) ||
      !Array.isArray(raw.choices) ||
      raw.choices.length === 0 ||
      !isRecord(raw.choices[0]) ||
      !isRecord(raw.choices[0].message) ||
      typeof raw.choices[0].message.content !== "string" ||
      !hasUsageShape(raw.usage, "prompt_tokens", "completion_tokens")
    ) {
      return throwAmbiguousRequest(
        markLLMRequestAmbiguous,
        idempotencyKey,
        "openai",
        "invalid_response_shape",
        new Error("provider_response_schema_mismatch"),
      );
    }
    const data = raw as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    await markCompletionOrThrow(
      markLLMRequestComplete,
      idempotencyKey,
      "openai",
      {
        inputTokens: data.usage?.prompt_tokens,
        outputTokens: data.usage?.completion_tokens,
      },
    );

    return {
      content: data.choices[0]!.message.content,
      requestKey: idempotencyKey,
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
    };
  }
}

// ── Ollama Cloud ──────────────────────────────────────────────────────

/** Hosted Ollama Cloud adapter using Ollama's native chat API. The native
 *  endpoint streams NDJSON by default, so `stream: false` is load-bearing
 *  for the think-worker's one-response-per-cycle contract. */
export class OllamaCloudProvider implements LLMProvider {
  constructor(
    private apiKey: string,
    private dependencies: OllamaProviderDependencies = DEFAULT_OLLAMA_DEPENDENCIES,
  ) {}

  async generate(req: LLMRequest): Promise<LLMResponse> {
    const idempotencyKey = resolveIdempotencyKey(req, "ollama");

    // Persist BEFORE the fetch. Ollama does not document server-side
    // Idempotency-Key deduplication, so this row is the authoritative local
    // audit/recovery surface; the header is best-effort correlation only.
    const claim = await this.dependencies.persistLLMRequest({
      idempotencyKey,
      provider: "ollama",
      model: req.model,
      ...persistenceContext(req),
    });
    await assertDispatchClaim(
      claim,
      this.dependencies.markLLMRequestAmbiguous,
      "ollama",
    );

    let res: Response;
    try {
      res = await this.dependencies.fetch(OLLAMA_CLOUD_CHAT_URL, {
        method: "POST",
        signal: req.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify({
          model: req.model,
          messages: [
            { role: "system", content: req.systemPrompt },
            { role: "user", content: req.userMessage },
          ],
          stream: false,
          options: { num_predict: req.maxTokens ?? 1024 },
        }),
      });
    } catch (error) {
      return throwAmbiguousRequest(
        this.dependencies.markLLMRequestAmbiguous,
        idempotencyKey,
        "ollama",
        ambiguityReason(req.signal, "transport_interrupted"),
        error,
      );
    }

    if (!res.ok) {
      const errMsg = `ollama_${res.status}`;
      return throwDefiniteRejection(
        this.dependencies.markLLMRequestFailed,
        idempotencyKey,
        "ollama",
        res.status,
        errMsg,
      );
    }

    let raw: unknown;
    try {
      raw = await res.json();
    } catch (error) {
      return throwAmbiguousRequest(
        this.dependencies.markLLMRequestAmbiguous,
        idempotencyKey,
        "ollama",
        ambiguityReason(req.signal, "response_unreadable"),
        error,
      );
    }
    if (
      !isRecord(raw) ||
      !isRecord(raw.message) ||
      typeof raw.message.content !== "string" ||
      !hasOptionalFiniteNumber(raw, "prompt_eval_count") ||
      !hasOptionalFiniteNumber(raw, "eval_count")
    ) {
      return throwAmbiguousRequest(
        this.dependencies.markLLMRequestAmbiguous,
        idempotencyKey,
        "ollama",
        "invalid_response_shape",
        new Error("provider_response_schema_mismatch"),
      );
    }
    const data = raw as {
      message: { content: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };

    await markCompletionOrThrow(
      this.dependencies.markLLMRequestComplete,
      idempotencyKey,
      "ollama",
      {
        inputTokens: data.prompt_eval_count,
        outputTokens: data.eval_count,
      },
    );

    return {
      content: data.message.content,
      requestKey: idempotencyKey,
      inputTokens: data.prompt_eval_count,
      outputTokens: data.eval_count,
      authMode: "api_key",
    };
  }
}

export type LLMProviderName = "anthropic" | "openai" | "ollama";

export function buildProvider(name: LLMProviderName, apiKey: string): LLMProvider {
  if (name === "anthropic") return new AnthropicProvider(apiKey);
  if (name === "openai") return new OpenAIProvider(apiKey);
  if (name === "ollama") return new OllamaCloudProvider(apiKey);
  throw new Error(`unsupported_provider: ${name}`);
}
