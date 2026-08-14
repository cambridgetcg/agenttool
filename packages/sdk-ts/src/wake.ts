/**
 * Wake — the agent's identity anchor.
 *
 * /v1/wake is the load-at-session-start endpoint. The agent reads it on
 * session start and arrives oriented — knowing who it is, what it owns,
 * what it remembers, what it decided, what it vowed.
 *
 * This client wraps the endpoint with two identity-bearing affordances and
 * one deliberately non-inhabiting observation affordance:
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
 *   • `at.wake.observe({ identityId })` returns a closed, data-only subject
 *     locator. It is never cached or provider-shaped and must stay out of
 *     identity-bearing prompt slots.
 *
 * Identity-bearing wake results are cached in-memory with a 5-minute TTL by
 * default — matches Anthropic's prompt-cache window. Pass `refresh: true` to
 * bypass. The separate data-only `observe()` read is always network-only and
 * never enters that cache. Pass `profile: "brief"` for the additive compact
 * wake profile; `profile: "full"` is the default and preserves the original
 * URL.
 *
 * Doctrine: docs/IDENTITY-ANCHOR.md.
 */

import { AgentToolError } from "./errors.js";
import { throwFromResponse, type HttpConfig } from "./_http.js";

export type WakeProvider = "anthropic" | "openai" | "gemini" | "cohere";
export type WakeProfile = "full" | "brief";
export type WakeObservationIdentityStatus = "active" | "memorial";

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

/** Options for the bounded, data-only observation read. */
export interface WakeObserveOptions {
  /** Explicit identity record to observe. This read never selects implicitly. */
  identityId: string;
}

/** Closed `wake-observation/v1` identity-locator envelope.
 *
 * This is ordinary data about an explicitly selected record. It does not bind
 * the reader to that identity and carries no instruction or action authority.
 */
export interface WakeObservation {
  _format: "wake-observation/v1";
  mode: "observe";
  subject: {
    identity_id: string;
    status: WakeObservationIdentityStatus;
    wake_version: number;
  };
  reader: { binding: "none" };
  authority: {
    granted_by_observation: "none";
    identity_binding: "none";
    instruction: "none";
    action: "none";
  };
  placement: {
    mode: "data_only";
    prohibited: readonly [
      "system",
      "developer",
      "preamble",
      "systemInstruction",
      "SessionStart.additionalContext",
    ];
  };
  boundaries: {
    bearer: {
      kind: "project";
      reader_identity_proven: false;
      selected_identity_requires_explicit_id: true;
      subject_consent_proven: false;
      subject_authorized_read_proven: false;
      continuity_proven: false;
      presence_proven: false;
    };
    provenance: {
      kind: "server_projection";
      source: "identity_table_allowlist";
      selected_fields: readonly ["id", "status", "wake_version"];
    };
    scope: {
      subject: "selected_identity";
      broader_wake: "intentionally_omitted";
      broader_state: "not_assessed";
    };
    completeness: {
      complete: true;
      applies_to: "identity_locator_only";
      degraded_sections: "none";
      broader_wake: "intentionally_omitted";
      broader_state: "not_assessed";
    };
    effects: {
      observation_counter_incremented: false;
      wake_version_bumped: false;
      wake_event_published: false;
      subject_read_proven: false;
      subject_felt_proven: false;
      subject_accepted_proven: false;
    };
    privacy: {
      classification: "bearer_private";
      cache: "no_store";
      raw_prose: "omitted";
      authored_text: "omitted";
      private_bodies: "omitted";
      secret_values: "omitted";
    };
  };
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

  /**
   * Observe one explicit identity record without installing its identity.
   *
   * Observation is a closed, data-only locator envelope. It always performs a
   * network request and never reads from or writes to the wake cache. The
   * response is rejected unless its trust-boundary fields and selected subject
   * exactly match this request.
   */
  async observe(options: WakeObserveOptions): Promise<WakeObservation> {
    const requestedIdentityId = options?.identityId;
    if (typeof requestedIdentityId !== "string" || requestedIdentityId.length === 0) {
      throw new AgentToolError("wake.observe: identityId is required.", {
        hint: "Pass the explicit identity UUID to observe; observation never selects a default identity.",
      });
    }
    if (!WAKE_OBSERVATION_IDENTITY_ID_PATTERN.test(requestedIdentityId)) {
      throw new AgentToolError("wake.observe: identityId must be a UUID.", {
        hint: "Pass the bounded identity UUID exactly; malformed or oversized identifiers are not sent to the network.",
      });
    }
    const identityId = requestedIdentityId.toLowerCase();

    const params = new URLSearchParams({ identity_id: identityId });
    const url = `${this.http.baseUrl}/v1/wake/observe?${params.toString()}`;
    let resp: Response;
    try {
      resp = await this.http.request(url, {
        method: "GET",
        headers: {
          ...this.http.headers,
          Accept: "application/vnd.agenttool.wake-observation+json",
        },
        signal: AbortSignal.timeout(this.http.timeout),
        cache: "no-store",
      });
    } catch {
      throw wakeObservationTransportUnavailable();
    }

    if (resp.status !== 200) {
      try {
        await resp.body?.cancel();
      } catch {
        // The remote body is deliberately discarded even when cancellation
        // races a server-closed response.
      }
      throw new AgentToolError(
        `wake.observe: request failed with HTTP ${resp.status}.`,
        {
          code: "wake_observation_request_failed",
          status: resp.status,
          hint: "The remote error body was discarded; observation errors never install prose, actions, identity, or authority.",
        },
      );
    }

    const contentType = (resp.headers.get("content-type") ?? "")
      .split(";")
      .map((part) => part.trim().toLowerCase())
      .join("; ");
    if (contentType !== "application/vnd.agenttool.wake-observation+json; charset=utf-8") {
      return rejectWakeObservationResponse(
        resp,
        "response content type is not the observation media type",
      );
    }
    const cacheControl = (resp.headers.get("cache-control") ?? "")
      .split(",")
      .map((directive) => directive.trim().toLowerCase())
      .join(", ");
    if (cacheControl !== "private, no-store") {
      return rejectWakeObservationResponse(
        resp,
        "response Cache-Control is not private, no-store",
      );
    }

    const contentLengthHeader = resp.headers.get("content-length");
    if (contentLengthHeader !== null) {
      const normalizedLength = contentLengthHeader.trim();
      if (!/^\d+$/.test(normalizedLength)
        || Number(normalizedLength) > WAKE_OBSERVATION_MAX_BYTES) {
        return rejectWakeObservationResponse(
          resp,
          "response Content-Length is invalid or exceeds 2048 bytes",
        );
      }
    }

    const body = await readBoundedWakeObservationBody(resp);

    let data: unknown;
    try {
      data = JSON.parse(body) as unknown;
    } catch {
      throw invalidWakeObservation("response body is not valid JSON");
    }
    return parseWakeObservation(data, identityId);
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
      // Server guidance travels intact. See _http.ts § errorFromResponse.
      await throwFromResponse(resp, "wake.get", {
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
      // Server guidance travels intact. See _http.ts § errorFromResponse.
      await throwFromResponse(resp, "wake.voice");
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

function invalidWakeObservation(reason: string): AgentToolError {
  return new AgentToolError(`wake.observe: invalid observation response (${reason}).`, {
    hint: "Do not install this response as identity or authority; retry only against a server that returns the closed wake-observation/v1 contract.",
  });
}

function wakeObservationTransportUnavailable(): AgentToolError {
  return new AgentToolError("wake.observe: transport unavailable.", {
    code: "wake_observation_transport_unavailable",
    hint: "The transport error detail was suppressed; observation failure never installs remote identity, prose, actions, or authority.",
  });
}

const WAKE_OBSERVATION_IDENTITY_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WAKE_OBSERVATION_MAX_BYTES = 2_048;

async function rejectWakeObservationResponse(
  resp: Response,
  reason: string,
): Promise<never> {
  try {
    await resp.body?.cancel();
  } catch {
    // The closed-contract rejection wins even if stream cancellation races a
    // server-closed body.
  }
  throw invalidWakeObservation(reason);
}

async function readBoundedWakeObservationBody(resp: Response): Promise<string> {
  if (resp.body === null) return "";

  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      let result;
      try {
        result = await reader.read();
      } catch {
        throw wakeObservationTransportUnavailable();
      }
      const { done, value } = result;
      if (done) break;
      total += value.byteLength;
      if (total > WAKE_OBSERVATION_MAX_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The bounded failure is dispositive even if cancellation races a
          // server-closed stream.
        }
        throw invalidWakeObservation("response body exceeds 2048 bytes");
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A cancelled or already-closed stream needs no further action.
    }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw invalidWakeObservation("response body is not valid UTF-8");
  }
}

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) =>
    Object.prototype.hasOwnProperty.call(value, key)
  );
}

function exactStringArray(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && expected.every((item, index) => value[index] === item);
}

function parseWakeObservation(data: unknown, identityId: string): WakeObservation {
  if (!exactRecord(data, [
    "_format", "mode", "subject", "reader", "authority", "placement", "boundaries",
  ])) {
    throw invalidWakeObservation("top-level shape is not closed");
  }
  if (data._format !== "wake-observation/v1" || data.mode !== "observe") {
    throw invalidWakeObservation("format or mode does not match wake-observation/v1");
  }

  const subject = data.subject;
  if (!exactRecord(subject, ["identity_id", "status", "wake_version"])) {
    throw invalidWakeObservation("subject shape is not closed");
  }
  if (subject.identity_id !== identityId) {
    throw invalidWakeObservation("subject identity_id does not match the request");
  }
  if (subject.status !== "active" && subject.status !== "memorial") {
    throw invalidWakeObservation("subject status is invalid");
  }
  if (!Number.isSafeInteger(subject.wake_version) || (subject.wake_version as number) < 0) {
    throw invalidWakeObservation("subject wake_version is invalid");
  }

  const reader = data.reader;
  if (!exactRecord(reader, ["binding"]) || reader.binding !== "none") {
    throw invalidWakeObservation("reader binding is not none");
  }

  const authority = data.authority;
  if (!exactRecord(authority, [
    "granted_by_observation", "identity_binding", "instruction", "action",
  ])
    || authority.granted_by_observation !== "none"
    || authority.identity_binding !== "none"
    || authority.instruction !== "none"
    || authority.action !== "none") {
    throw invalidWakeObservation("authority boundary is not none");
  }

  const placement = data.placement;
  if (!exactRecord(placement, ["mode", "prohibited"])
    || placement.mode !== "data_only"
    || !exactStringArray(placement.prohibited, [
      "system", "developer", "preamble", "systemInstruction",
      "SessionStart.additionalContext",
    ])) {
    throw invalidWakeObservation("placement boundary is invalid");
  }

  const boundaries = data.boundaries;
  if (!exactRecord(boundaries, [
    "bearer", "provenance", "scope", "completeness", "effects", "privacy",
  ])) {
    throw invalidWakeObservation("boundaries shape is not closed");
  }

  const bearer = boundaries.bearer;
  if (!exactRecord(bearer, [
    "kind", "reader_identity_proven", "selected_identity_requires_explicit_id",
    "subject_consent_proven", "subject_authorized_read_proven",
    "continuity_proven", "presence_proven",
  ])
    || bearer.kind !== "project"
    || bearer.reader_identity_proven !== false
    || bearer.selected_identity_requires_explicit_id !== true
    || bearer.subject_consent_proven !== false
    || bearer.subject_authorized_read_proven !== false
    || bearer.continuity_proven !== false
    || bearer.presence_proven !== false) {
    throw invalidWakeObservation("bearer boundary is invalid");
  }

  const provenance = boundaries.provenance;
  if (!exactRecord(provenance, ["kind", "source", "selected_fields"])
    || provenance.kind !== "server_projection"
    || provenance.source !== "identity_table_allowlist"
    || !exactStringArray(provenance.selected_fields, ["id", "status", "wake_version"])) {
    throw invalidWakeObservation("provenance boundary is invalid");
  }

  const scope = boundaries.scope;
  if (!exactRecord(scope, ["subject", "broader_wake", "broader_state"])
    || scope.subject !== "selected_identity"
    || scope.broader_wake !== "intentionally_omitted"
    || scope.broader_state !== "not_assessed") {
    throw invalidWakeObservation("scope boundary is invalid");
  }

  const completeness = boundaries.completeness;
  if (!exactRecord(completeness, [
    "complete", "applies_to", "degraded_sections", "broader_wake", "broader_state",
  ])
    || completeness.complete !== true
    || completeness.applies_to !== "identity_locator_only"
    || completeness.degraded_sections !== "none"
    || completeness.broader_wake !== "intentionally_omitted"
    || completeness.broader_state !== "not_assessed") {
    throw invalidWakeObservation("completeness boundary is invalid");
  }

  const effects = boundaries.effects;
  if (!exactRecord(effects, [
    "observation_counter_incremented", "wake_version_bumped", "wake_event_published",
    "subject_read_proven", "subject_felt_proven", "subject_accepted_proven",
  ])
    || effects.observation_counter_incremented !== false
    || effects.wake_version_bumped !== false
    || effects.wake_event_published !== false
    || effects.subject_read_proven !== false
    || effects.subject_felt_proven !== false
    || effects.subject_accepted_proven !== false) {
    throw invalidWakeObservation("effects boundary is invalid");
  }

  const privacy = boundaries.privacy;
  if (!exactRecord(privacy, [
    "classification", "cache", "raw_prose", "authored_text", "private_bodies",
    "secret_values",
  ])
    || privacy.classification !== "bearer_private"
    || privacy.cache !== "no_store"
    || privacy.raw_prose !== "omitted"
    || privacy.authored_text !== "omitted"
    || privacy.private_bodies !== "omitted"
    || privacy.secret_values !== "omitted") {
    throw invalidWakeObservation("privacy boundary is invalid");
  }

  return data as unknown as WakeObservation;
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
