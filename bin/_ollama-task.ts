/** Bounded, explicit public/synthetic task handoff through signed-in local Ollama.
 * No private runtime context, credential reads, tools, or response-text routing.
 * Contract: docs/OLLAMA-TASK-ROUTING.md. */

export const OLLAMA_TASK_ENDPOINT = "http://127.0.0.1:11434/api/chat";
export const OLLAMA_TASK_MODELS = [
  "deepseek-v4.1-flash:cloud",
  "kimi-k3:cloud",
] as const;
export const MAX_TASK_INPUT_BYTES = 65_536;
const MAX_RESPONSE_BYTES = 1_048_576;
const REASONS = ["direct", "rate_limit", "unavailable", "capability_gap"];
const PROXY_ENVIRONMENT = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"];
const INPUT_KEYS = new Set([
  "prompt", "system", "model", "backup_models", "reason", "max_tokens",
  "timeout_ms", "data_kind",
]);

export type OllamaTaskErrorCode =
  | "invalid_input" | "invalid_reason" | "invalid_model" | "invalid_backups"
  | "invalid_max_tokens" | "invalid_timeout" | "cancelled" | "deadline_exceeded"
  | "transport_interrupted" | "response_too_large" | "response_unreadable"
  | "invalid_response" | "output_truncated" | "provider_refusal"
  | "http_rejected" | "unavailable" | "proxy_environment" | "model_mismatch";

export interface OllamaTaskAttempt {
  model: string;
  outcome: "success" | OllamaTaskErrorCode;
  status?: number;
  elapsed_ms: number;
}

export interface OllamaTaskResult {
  model: string;
  requested_model: string;
  content: string;
  done_reason: "stop";
  input_tokens?: number;
  output_tokens?: number;
  attempts: OllamaTaskAttempt[];
  elapsed_ms: number;
}

/** Only fixed codes and bounded attempt metadata cross the error boundary. */
export class OllamaTaskError extends Error {
  readonly name = "OllamaTaskError";
  constructor(
    readonly code: OllamaTaskErrorCode,
    readonly attempts: OllamaTaskAttempt[] = [],
    readonly elapsed_ms = 0,
  ) {
    super(code);
  }
  toJSON() {
    return { code: this.code, attempts: this.attempts, elapsed_ms: this.elapsed_ms };
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validate(input: unknown) {
  if (!record(input) || Object.keys(input).some(key => !INPUT_KEYS.has(key))) {
    throw new OllamaTaskError("invalid_input");
  }
  if (input.data_kind !== "public" && input.data_kind !== "synthetic") {
    throw new OllamaTaskError("invalid_input");
  }
  if (typeof input.prompt !== "string" || !input.prompt.trim() ||
      (input.system !== undefined && typeof input.system !== "string")) {
    throw new OllamaTaskError("invalid_input");
  }
  const system = (input.system as string | undefined) ?? "";
  const encoder = new TextEncoder();
  if (input.prompt.length + system.length > MAX_TASK_INPUT_BYTES ||
      encoder.encode(input.prompt).byteLength + encoder.encode(system).byteLength > MAX_TASK_INPUT_BYTES) {
    throw new OllamaTaskError("invalid_input");
  }
  const reason = input.reason === undefined ? "direct" : input.reason;
  if (typeof reason !== "string" || !REASONS.includes(reason)) {
    throw new OllamaTaskError("invalid_reason");
  }
  const model = input.model === undefined ? OLLAMA_TASK_MODELS[0] : input.model;
  const isModel = (candidate: unknown): candidate is string =>
    typeof candidate === "string" && (OLLAMA_TASK_MODELS as readonly string[]).includes(candidate);
  if (!isModel(model)) throw new OllamaTaskError("invalid_model");
  const backups = input.backup_models === undefined
    ? OLLAMA_TASK_MODELS.filter(candidate => candidate !== model)
    : input.backup_models;
  if (!Array.isArray(backups) || backups.length > 2 || !backups.every(isModel) ||
      new Set([model, ...backups]).size !== backups.length + 1) {
    throw new OllamaTaskError("invalid_backups");
  }
  const maxTokens = input.max_tokens === undefined ? 2048 : input.max_tokens;
  if (typeof maxTokens !== "number" || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8192) {
    throw new OllamaTaskError("invalid_max_tokens");
  }
  const timeoutMs = input.timeout_ms === undefined ? 60_000 : input.timeout_ms;
  if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new OllamaTaskError("invalid_timeout");
  }
  return { prompt: input.prompt, system, models: [model, ...backups], maxTokens, timeoutMs };
}

/** Race even an injected transport against cancellation, and remove listeners. */
async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void operation.catch(() => {});
    throw new OllamaTaskError("cancelled");
  }
  let abort!: () => void;
  const cancellation = new Promise<never>((_, reject) => {
    abort = () => reject(new OllamaTaskError("cancelled"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([operation, cancellation]); }
  finally { signal.removeEventListener("abort", abort); }
}

async function readBody(response: Response, signal: AbortSignal): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw new OllamaTaskError("response_too_large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, text = "";
  try {
    while (true) {
      const chunk = await abortable(reader.read(), signal);
      if (chunk.done) return text + decoder.decode();
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new OllamaTaskError("response_too_large");
      text += decoder.decode(chunk.value, { stream: true });
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (error instanceof OllamaTaskError) throw error;
    throw new OllamaTaskError("response_unreadable");
  } finally { reader.releaseLock(); }
}

function hasRefusal(raw: unknown): boolean {
  if (!record(raw)) return false;
  const marked = (value: unknown) => value !== undefined && value !== null && value !== false && value !== "";
  if (marked(raw.refusal) || (record(raw.message) && marked(raw.message.refusal)) ||
      (record(raw.error) && marked(raw.error.refusal))) return true;
  const refusalCodes = new Set([
    "refusal", "content_filter", "content_policy_violation", "policy_violation",
    "policy_denied", "safety", "safety_denied", "cyber_denied", "cyber_policy_denied",
    "permission_denied", "permission_error", "access_denied", "auth_error",
    "authentication_error", "authorization_error", "stop", "rest", "cancelled",
  ]);
  const codes = [raw.code, raw.type];
  if (record(raw.error)) codes.push(raw.error.code, raw.error.type);
  if (record(raw.message)) codes.push(raw.message.code, raw.message.type);
  // Ordinary successful done_reason:stop is completion, not a denial marker.
  if (raw.done_reason !== "stop") codes.push(raw.done_reason);
  return codes.some(code => typeof code === "string" && refusalCodes.has(code.toLowerCase()));
}

/** An unknown machine-readable error is not evidence of availability failure. */
function permitsAvailabilityFallback(raw: unknown): boolean {
  if (!record(raw)) return true; // HTTP status alone; free-form prose is not classified.
  if (raw.done !== undefined || raw.done_reason !== undefined || raw.message !== undefined) return false;
  const availabilityCodes = new Set([
    "rate_limit", "rate_limit_error", "rate_limit_exceeded", "too_many_requests",
    "unavailable", "service_unavailable", "overloaded", "overloaded_error",
  ]);
  const records = [raw, ...(record(raw.error) ? [raw.error] : [])];
  return records.every(item => ["code", "type"].every(key =>
    !(key in item) || (typeof item[key] === "string" && availabilityCodes.has(item[key].toLowerCase())),
  ));
}

/** Envelopes have omitted the local ":cloud" suffix; strip exactly one before comparing. */
function baseModel(name: string): string {
  return name.endsWith(":cloud") ? name.slice(0, -":cloud".length) : name;
}

function tokenCount(raw: Record<string, unknown>, key: string): number | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new OllamaTaskError("invalid_response");
  }
  return value;
}

/** The caller supplies selected public/synthetic text; this does not load context. */
export async function runOllamaTask(
  input: unknown,
  options: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<OllamaTaskResult> {
  const config = validate(input);
  const started = performance.now();
  const deadline = started + config.timeoutMs;
  const elapsed = () => Math.max(0, Math.round(performance.now() - started));
  const attempts: OllamaTaskAttempt[] = [];
  const controller = new AbortController();
  let stopped: "cancelled" | "deadline_exceeded" | undefined;
  const stop = (code: "cancelled" | "deadline_exceeded") => {
    if (!stopped) { stopped = code; controller.abort(); }
  };
  const cancel = () => stop("cancelled");
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const timer = setTimeout(() => stop("deadline_exceeded"), config.timeoutMs);
  const check = () => {
    if (performance.now() >= deadline) stop("deadline_exceeded");
    if (stopped) throw new OllamaTaskError(stopped, [...attempts], elapsed());
  };
  const fetchImpl = options.fetch ?? globalThis.fetch;
  try {
    for (const model of config.models) {
      check();
      // Pinned Bun fetch consults ambient proxies even for loopback. Refuse
      // rather than reinterpret NO_PROXY, change process env, or expose values.
      if (PROXY_ENVIRONMENT.some(name => Boolean(process.env[name]?.length))) {
        throw new OllamaTaskError("proxy_environment", [...attempts], elapsed());
      }
      const attemptStarted = performance.now();
      let status: number | undefined;
      let activeResponse: Response | undefined;
      const add = (outcome: OllamaTaskAttempt["outcome"]) => attempts.push({
        model, outcome, ...(status === undefined ? {} : { status }),
        elapsed_ms: Math.max(0, Math.round(performance.now() - attemptStarted)),
      });
      try {
        let response: Response;
        try {
          response = await abortable(fetchImpl(OLLAMA_TASK_ENDPOINT, {
            method: "POST", redirect: "error", credentials: "omit", signal: controller.signal,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model, stream: false, think: false,
              messages: [
                ...(config.system ? [{ role: "system", content: config.system }] : []),
                { role: "user", content: config.prompt },
              ],
              options: { num_predict: config.maxTokens },
            }),
          }).then(response => {
            activeResponse = response;
            // Headers can arrive after cancellation won the race. Release them too.
            if (controller.signal.aborted) void response.body?.cancel().catch(() => {});
            return response;
          }), controller.signal);
        } catch {
          throw new OllamaTaskError(stopped ?? "transport_interrupted");
        }
        activeResponse = response;
        status = response.status;
        check();
        // Only these explicit availability rejections may advance the chain.
        // Other HTTP failures need no body read and can never select a backup.
        if (!response.ok && status !== 429 && status !== 503) {
          void response.body?.cancel().catch(() => {});
          throw new OllamaTaskError("http_rejected");
        }
        const text = await readBody(response, controller.signal);
        check();
        let raw: unknown;
        try { raw = JSON.parse(text); }
        catch {
          if (response.ok) throw new OllamaTaskError("invalid_response");
          // The HTTP status is the availability signal, not free-form error prose.
          raw = null;
        }
        if (hasRefusal(raw)) throw new OllamaTaskError("provider_refusal");
        if (!response.ok) {
          if (!permitsAvailabilityFallback(raw)) throw new OllamaTaskError("http_rejected");
          add("unavailable");
          continue;
        }
        if (!record(raw) || raw.done !== true || !record(raw.message) ||
            raw.message.role !== "assistant" || typeof raw.message.content !== "string" ||
            typeof raw.model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(raw.model) ||
            raw.error !== undefined || raw.message.tool_calls !== undefined) {
          throw new OllamaTaskError("invalid_response");
        }
        // Cloud routing has served another model under parallel load. That
        // answer is not this request's success, and it never selects a backup.
        if (baseModel(raw.model) !== baseModel(model)) throw new OllamaTaskError("model_mismatch");
        if (raw.done_reason === "length") throw new OllamaTaskError("output_truncated");
        if (raw.done_reason !== "stop") throw new OllamaTaskError("invalid_response");
        const inputTokens = tokenCount(raw, "prompt_eval_count");
        const outputTokens = tokenCount(raw, "eval_count");
        check();
        add("success");
        return {
          model: raw.model, requested_model: model, content: raw.message.content,
          done_reason: "stop", attempts: [...attempts], elapsed_ms: elapsed(),
          ...(inputTokens === undefined ? {} : { input_tokens: inputTokens }),
          ...(outputTokens === undefined ? {} : { output_tokens: outputTokens }),
        };
      } catch (error) {
        void activeResponse?.body?.cancel().catch(() => {});
        const code = stopped ?? (error instanceof OllamaTaskError ? error.code : "response_unreadable");
        add(code);
        throw new OllamaTaskError(code, [...attempts], elapsed());
      }
    }
    check();
    throw new OllamaTaskError("unavailable", [...attempts], elapsed());
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}
