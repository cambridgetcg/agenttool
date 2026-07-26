/**
 * AnthropicAdapter — Tier 2 of the agenttool path: a thin wrapper over the
 * official `@anthropic-ai/sdk` client that gives every Messages call
 * two superpowers without changing the provider event stream:
 *
 *   1. **Auto-injects the agent's wake doc** as `system=`, fetched once
 *      from `/v1/wake?format=anthropic` and cached for 5 minutes (matches
 *      Anthropic's prompt-cache window). The stable block carries
 *      `cache_control: ephemeral`; the volatile block refreshes per wake.
 *      User-supplied `system=` blocks are appended AFTER the wake.
 *
 *   2. **Auto-records traces** when the call carries
 *      `metadata.agenttool.trace = "decision"`. Posts to `/v1/traces`
 *      with the response text as the conclusion and the user message as
 *      the observation. Returns the trace_id on the augmented response
 *      so the agent can chain via `parent_trace_id` on a follow-up.
 *
 *   3. **(Mode b) Parses `<agenttool>...</agenttool>` markup** in the
 *      assistant's response. Recognised children:
 *        <chronicle type="naming|recognition|...">
 *          <title>...</title><body>...</body>
 *        </chronicle>
 *        <trace type="decision|..." confidence="0.7">
 *          <decision>...</decision><conclusion>...</conclusion>
 *        </trace>
 *      The agent decides what's load-bearing by writing the tag; the shim
 *      does the plumbing. Mirrors the friction-tier UX in the dashboard.
 *
 * Posture: zero dependency on @anthropic-ai/sdk types. The adapter takes
 * any object with a `messages.create(params)` method and optionally a
 * `messages.stream(params)` helper, so the wrapping works whether the
 * agent uses the official SDK, Bedrock SDK, or a custom HTTP client.
 *
 * Streaming boundary:
 *   - Low-level `messages.create({ stream: true })` is a transparent
 *     event-stream pass-through. It injects wake and strips local metadata,
 *     but cannot promise final-response tracing or markup. Decision tracing
 *     therefore fails before wake or provider I/O on that path.
 *   - `messages.stream(...)` uses the provider's final-message helper. Its
 *     completed message is finalized exactly once, so tracing and markup
 *     retain the same meaning as a non-streaming call.
 *
 * Doctrine: docs/IDENTITY-ANCHOR.md.
 */

import { getAmbient } from "./_context.js";
import type { AmbientContext } from "./_context.js";
import type { AgentTool } from "./client.js";
import { AgentToolError } from "./errors.js";
import type {
  AnthropicWakeShape,
  WakeProfile,
  WakeProviderMeta,
} from "./wake.js";

/** Minimal shape of the Anthropic Messages client. The adapter wraps any
 *  object that exposes `messages.create(params)`; @anthropic-ai/sdk's
 *  `Anthropic` instance qualifies, as does any custom client. */
export interface AnthropicMessagesLike {
  messages: {
    create(
      params: Record<string, unknown>,
      ...requestOptions: unknown[]
    ): Promise<AnthropicMessageResponse | AnthropicLowLevelStreamLike>;
    stream?: (
      params: Record<string, unknown>,
      ...requestOptions: unknown[]
    ) => AnthropicManagedStreamLike;
  };
}

/** Minimal low-level stream shape returned by
 * `messages.create({ stream: true })`. Every property and event is delegated
 * unchanged; these optional lifecycle methods name the cleanup surface the
 * adapter preserves. */
export interface AnthropicLowLevelStreamLike extends AsyncIterable<unknown> {
  controller?: AbortController;
  abort?: () => unknown;
  close?: () => unknown;
}

/** Minimal high-level stream helper shape returned by `messages.stream(...)`.
 * The official SDK exposes all of these except `close`; custom clients may use
 * `close` instead of `abort`. */
export interface AnthropicManagedStreamLike extends AsyncIterable<unknown> {
  controller?: AbortController;
  finalMessage(): Promise<AnthropicMessageResponse>;
  finalText?: () => Promise<string>;
  done?: () => Promise<void>;
  abort?: () => unknown;
  close?: () => unknown;
  on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  once?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  off?: (event: string, listener: (...args: unknown[]) => void) => unknown;
  emitted?: (event: string) => Promise<unknown>;
  withResponse?: () => Promise<Record<string, unknown>>;
}

/** Subset of the Anthropic Messages API response we read. The full shape
 *  is forwarded verbatim with only `.agenttool` augmentation added. */
export interface AnthropicMessageResponse {
  id: string;
  model: string;
  content?: Array<{ type: string; text?: string }>;
  stop_reason?: string;
  usage?: Record<string, unknown>;
  [key: string]: unknown;
}

/** The `metadata.agenttool` extension the adapter reads off the call params.
 *  Stripped from the forwarded request before it hits Anthropic. */
export interface AgentToolMetadata {
  /**
   * Opt-in auto-trace. When set to `"decision"`, the adapter posts to
   * /v1/traces after the messages.create call returns. Default: omit
   * (no trace fired).
   */
  trace?: "decision" | false;
  /** Optional parent trace to chain this decision to. */
  parent_trace_id?: string;
  /** Optional explicit decision_type override (default `"decision"`). */
  decision_type?: string;
  /** Tags propagated to the trace. */
  tags?: string[];
  /** Override the agent_id stamped on the trace. */
  agent_id?: string;
  /** Skip the wake auto-injection for this call. */
  skip_wake?: boolean;
  /** Skip parsing of <agenttool> markup in the response for this call. */
  skip_markup?: boolean;
}

export interface AnthropicAdapterOptions {
  /** Identity id for multi-identity projects (passed through to /v1/wake). */
  identityId?: string;
  /** Wake projection used for automatic system injection. Default `full`. */
  wakeProfile?: WakeProfile;
  /** Disable parsing of <agenttool>...</agenttool> markup globally. */
  disableMarkupParsing?: boolean;
}

/** A markup emission produced by parsing `<agenttool>...</agenttool>` from
 *  the response. Each entry records what was posted and the resulting id
 *  (or the error if the post failed). */
export interface MarkupEmission {
  kind: "chronicle" | "trace";
  /** API id returned on success (e.g. "ch_..." or "tr_..."). */
  id: string | null;
  /** Error message if the emission failed; null on success. */
  error: string | null;
  /** The parsed source for debugging. */
  source: Record<string, unknown>;
}

/** Augmentation added to the Anthropic response by the adapter. The
 *  underlying response is forwarded verbatim alongside this. */
export interface AgentToolAugmentation {
  /** Trace id when `metadata.agenttool.trace = "decision"` fired. */
  trace_id: string | null;
  /** Whether wake auto-injection ran for this call. */
  wake_used: boolean;
  /** Cache eligibility echoed from /v1/wake?format=anthropic _meta. */
  cache_eligible: WakeProviderMeta["cache_eligible"] | null;
  /** Per-emission outcomes from <agenttool> markup parsing. Empty when
   *  the response carried no markup or parsing was disabled. */
  markup_emissions: MarkupEmission[];
}

export type AdaptedResponse = AnthropicMessageResponse & {
  agenttool: AgentToolAugmentation;
};

/** Low-level streaming receipt. It is local-only and never changes, consumes,
 * or reconstructs provider events. */
export interface AdaptedLowLevelStream extends AsyncIterable<unknown> {
  readonly agenttool: AgentToolAugmentation;
}

/** High-level helper returned by `adapter.messages.stream(...)`. Unknown
 * provider events are yielded by reference. Final-response AgentTool work is
 * attached to the provider's completed message exactly once. */
export interface AdaptedManagedStream extends AsyncIterable<unknown> {
  readonly agenttool: AgentToolAugmentation;
  readonly controller: AbortController;
  finalMessage(): Promise<AdaptedResponse>;
  finalText(): Promise<string>;
  done(): Promise<void>;
  emitted(event: string): Promise<unknown>;
  withResponse(): Promise<Record<string, unknown>>;
  abort(): void;
  close(): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): this;
  once(event: string, listener: (...args: unknown[]) => void): this;
  off(event: string, listener: (...args: unknown[]) => void): this;
}

export interface AnthropicAdapterMessages {
  create(
    params: Record<string, unknown> & { stream: true },
    ...requestOptions: unknown[]
  ): Promise<AdaptedLowLevelStream>;
  create(
    params: Record<string, unknown>,
    ...requestOptions: unknown[]
  ): Promise<AdaptedResponse>;
  stream(
    params: Record<string, unknown>,
    ...requestOptions: unknown[]
  ): AdaptedManagedStream;
}

interface InspectedRequest {
  meta: AgentToolMetadata;
  ambient: AmbientContext | undefined;
}

interface PreparedRequest extends InspectedRequest {
  forwardParams: Record<string, unknown>;
  wakeMeta: WakeProviderMeta | null;
}

/** Match the outermost <agenttool>...</agenttool> envelope in a string.
 *  The model is asked to emit well-formed markup; we tolerate whitespace
 *  but don't try to handle nested envelopes (rare; would only confuse). */
const AGENTTOOL_ENVELOPE = /<agenttool>([\s\S]*?)<\/agenttool>/i;

/** Extract a single <chronicle type="X"> ... </chronicle> tag. */
const CHRONICLE_TAG = /<chronicle\s+type="([^"]+)"\s*>([\s\S]*?)<\/chronicle>/gi;

/** Extract a single <trace type="X" [confidence="..."]> ... </trace>. */
const TRACE_TAG = /<trace\s+type="([^"]+)"(?:\s+confidence="([^"]+)")?\s*>([\s\S]*?)<\/trace>/gi;

const TITLE_TAG = /<title>([\s\S]*?)<\/title>/i;
const BODY_TAG = /<body>([\s\S]*?)<\/body>/i;
const DECISION_TAG = /<decision>([\s\S]*?)<\/decision>/i;
const CONCLUSION_TAG = /<conclusion>([\s\S]*?)<\/conclusion>/i;
const OBSERVATION_TAG = /<observation>([\s\S]*?)<\/observation>/gi;

export class AnthropicAdapter {
  private readonly anthropic: AnthropicMessagesLike;
  private readonly at: AgentTool;
  private readonly options: AnthropicAdapterOptions;

  constructor(
    anthropic: AnthropicMessagesLike,
    at: AgentTool,
    options: AnthropicAdapterOptions = {},
  ) {
    if (
      options.wakeProfile !== undefined &&
      options.wakeProfile !== "full" &&
      options.wakeProfile !== "brief"
    ) {
      throw new AgentToolError(
        `Unknown wake profile: ${String(options.wakeProfile)}`,
        { hint: "Expected one of: full, brief." },
      );
    }
    this.anthropic = anthropic;
    this.at = at;
    this.options = options;
  }

  /** Mirrors the shape of `anthropic.messages` so callers can swap in the
   *  adapter without changing call sites: `adapter.messages.create({...})`
   *  or `adapter.messages.stream({...})`. */
  get messages(): AnthropicAdapterMessages {
    const self = this;
    const create = async (
      params: Record<string, unknown>,
      ...requestOptions: unknown[]
    ): Promise<AdaptedResponse | AdaptedLowLevelStream> => {
      const inspected = self._inspectRequest(params);
      const lowLevelStreaming = params.stream === true;

      // A low-level event stream has no provider-supplied final Message.
      // Refuse decision tracing before even fetching wake so callers never
      // pay for provider work under a trace promise we cannot keep.
      if (
        lowLevelStreaming &&
        (inspected.meta.trace === "decision" || inspected.ambient !== undefined)
      ) {
        throw new AgentToolError(
          "Decision tracing is unavailable for messages.create({ stream: true }).",
          {
            code: "anthropic_stream_trace_requires_helper",
            hint:
              "Use adapter.messages.stream(...) and await finalMessage(), "
              + "or remove the decision-trace request.",
          },
        );
      }

      const prepared = await self._prepareRequest(params, inspected);
      const response = await self.anthropic.messages.create(
        prepared.forwardParams,
        ...requestOptions,
      );

      if (lowLevelStreaming) {
        if (!isLowLevelStream(response)) {
          throw new AgentToolError(
            "Anthropic returned a non-iterable value for a streaming request.",
            {
              code: "anthropic_stream_invalid",
              hint: "Check that the wrapped client implements the Anthropic streaming contract.",
            },
          );
        }
        return adaptLowLevelStream(response, self._emptyAugmentation(prepared));
      }

      return self._finalizeResponse(
        params,
        response as AnthropicMessageResponse,
        prepared,
      );
    };

    const stream = (
      params: Record<string, unknown>,
      ...requestOptions: unknown[]
    ): AdaptedManagedStream => {
      const providerStream = self.anthropic.messages.stream;
      if (typeof providerStream !== "function") {
        throw new AgentToolError(
          "The wrapped Anthropic client does not expose messages.stream(...).",
          {
            code: "anthropic_stream_helper_unavailable",
            hint:
              "Use a client with the Anthropic final-message stream helper, "
              + "or use messages.create({ stream: true }) without decision tracing.",
          },
        );
      }

      // Capture ambient decision context at the call boundary. Finalization
      // may happen after the surrounding deciding() callback has returned.
      const inspected = self._inspectRequest(params);
      return new ManagedAnthropicStream(
        async (signal) => {
          const prepared = await self._prepareRequest(params, inspected);
          if (signal.aborted) throw streamAbortError();
          const provider = providerStream.call(
            self.anthropic.messages,
            prepared.forwardParams,
            ...requestOptions,
          );
          if (!isManagedStream(provider)) {
            throw new AgentToolError(
              "Anthropic messages.stream(...) returned no final-message helper.",
              {
                code: "anthropic_stream_helper_invalid",
                hint:
                  "The wrapped helper must be async-iterable and expose finalMessage().",
              },
            );
          }
          return { provider, prepared };
        },
        (response, prepared) =>
          self._finalizeResponse(params, response, prepared),
        {
          trace_id: null,
          wake_used: !inspected.meta.skip_wake,
          cache_eligible: null,
          markup_emissions: [],
        },
      );
    };

    return {
      create: create as AnthropicAdapterMessages["create"],
      stream,
    };
  }

  private _inspectRequest(params: Record<string, unknown>): InspectedRequest {
    const metadata = isRecord(params.metadata) ? params.metadata : {};
    const meta = isRecord(metadata.agenttool)
      ? metadata.agenttool as AgentToolMetadata
      : {};
    return { meta, ambient: getAmbient() };
  }

  private async _prepareRequest(
    params: Record<string, unknown>,
    inspected: InspectedRequest,
  ): Promise<PreparedRequest> {
    const metadata = isRecord(params.metadata) ? params.metadata : {};
    const { meta } = inspected;

    // Auto-inject wake unless skipped on this call.
    let wakeMeta: WakeProviderMeta | null = null;
    let injectedSystem: unknown = params.system;
    if (!meta.skip_wake) {
      const shape = await this.at.wake.system("anthropic", {
        identityId: this.options.identityId,
        ...(this.options.wakeProfile === "brief" ? { profile: "brief" } : {}),
      });
      wakeMeta = shape._meta;
      const userBlocks = normalizeSystem(params.system);
      injectedSystem = [...shape.system, ...userBlocks];
    }

    // Strip our metadata.agenttool extension before provider I/O.
    const cleanMetadata: Record<string, unknown> = { ...metadata };
    delete cleanMetadata.agenttool;
    const forwardParams: Record<string, unknown> = {
      ...params,
      system: injectedSystem,
    };
    if (Object.keys(cleanMetadata).length > 0) {
      forwardParams.metadata = cleanMetadata;
    } else {
      delete forwardParams.metadata;
    }

    return { ...inspected, forwardParams, wakeMeta };
  }

  private _emptyAugmentation(prepared: PreparedRequest): AgentToolAugmentation {
    return {
      trace_id: null,
      wake_used: !prepared.meta.skip_wake,
      cache_eligible: prepared.wakeMeta?.cache_eligible ?? null,
      markup_emissions: [],
    };
  }

  private async _finalizeResponse(
    params: Record<string, unknown>,
    response: AnthropicMessageResponse,
    prepared: PreparedRequest,
  ): Promise<AdaptedResponse> {
    let traceId: string | null = null;
    const shouldTrace =
      prepared.meta.trace === "decision" || prepared.ambient !== undefined;
    if (shouldTrace) {
      traceId = await this._recordDecisionTrace(
        params,
        response,
        prepared.meta,
        prepared.ambient,
      );
    }

    const emissions: MarkupEmission[] =
      this.options.disableMarkupParsing || prepared.meta.skip_markup
        ? []
        : await this._parseAndEmitMarkup(response, prepared.ambient);

    return {
      ...response,
      agenttool: {
        trace_id: traceId,
        wake_used: !prepared.meta.skip_wake,
        cache_eligible: prepared.wakeMeta?.cache_eligible ?? null,
        markup_emissions: emissions,
      },
    };
  }

  /** Post a trace built from the (params, response) pair. The shape
   *  matches `/v1/traces` POST schema (decision/reasoning/context). */
  private async _recordDecisionTrace(
    params: Record<string, unknown>,
    response: AnthropicMessageResponse,
    meta: AgentToolMetadata,
    ambient: AmbientContext | undefined,
  ): Promise<string | null> {
    const conclusion = extractResponseText(response).trim() || "(empty response)";
    const userText = extractLastUserText(params).trim();

    const body: Record<string, unknown> = {
      decision: {
        type: meta.decision_type ?? "decision",
        summary: conclusion.slice(0, 200),
      },
      reasoning: {
        observations: userText ? [userText.slice(0, 1000)] : [],
        conclusion: conclusion.slice(0, 4000),
      },
    };
    // Merge ambient context (`at.deciding(...)`) — explicit values on
    // `meta` win; ambient fills gaps. Tags are unioned (explicit first
    // since they're more specific).
    const explicitTags = meta.tags ?? [];
    const ambientTags = ambient?.tags ?? [];
    const mergedTags = Array.from(new Set([...explicitTags, ...ambientTags]));
    if (mergedTags.length > 0) body.tags = mergedTags;
    const parent = meta.parent_trace_id ?? ambient?.parent_trace_id ?? null;
    if (parent) body.parent_trace_id = parent;
    if (meta.agent_id) body.agent_id = meta.agent_id;

    try {
      const result = (await this.at.request("POST", "/v1/traces", body)) as
        | { trace_id?: string }
        | undefined;
      return result?.trace_id ?? null;
    } catch (err) {
      // Don't crash the call site on trace failure — trace recording is
      // a side-effect, the response itself is the agent's output.
      console.warn(
        "[agenttool-adapter] auto-trace failed:",
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  }

  /** Walk the response text for <agenttool>...</agenttool> blocks and
   *  emit each child to the right endpoint. Tolerant of whitespace and
   *  child ordering; failures are recorded per-emission, not thrown. */
  private async _parseAndEmitMarkup(
    response: AnthropicMessageResponse,
    ambient: AmbientContext | undefined,
  ): Promise<MarkupEmission[]> {
    const text = extractResponseText(response);
    const envelope = text.match(AGENTTOOL_ENVELOPE);
    if (!envelope) return [];
    const inner = envelope[1];
    const out: MarkupEmission[] = [];

    // Reset regex state by creating fresh iterators each call.
    const chronicleRegex = new RegExp(CHRONICLE_TAG.source, CHRONICLE_TAG.flags);
    let m: RegExpExecArray | null;
    while ((m = chronicleRegex.exec(inner)) !== null) {
      const type = m[1].trim();
      const inside = m[2];
      const titleMatch = inside.match(TITLE_TAG);
      const bodyMatch = inside.match(BODY_TAG);
      const title = titleMatch?.[1].trim() ?? "";
      const bodyText = bodyMatch?.[1].trim();
      if (!title) {
        out.push({
          kind: "chronicle",
          id: null,
          error: "<chronicle> missing required <title>",
          source: { type, body: bodyText },
        });
        continue;
      }
      const post: Record<string, unknown> = { type, title };
      if (bodyText) post.body = bodyText;
      try {
        const result = (await this.at.request("POST", "/v1/chronicle", post)) as
          | { id?: string; entry?: { id?: string } }
          | undefined;
        // /v1/chronicle returns {entry: {id, ...}}; older shape was flat
        // {id, ...}. Try both so the adapter is tolerant.
        const id = result?.entry?.id ?? result?.id ?? null;
        out.push({
          kind: "chronicle",
          id,
          error: null,
          source: post,
        });
      } catch (err) {
        out.push({
          kind: "chronicle",
          id: null,
          error: err instanceof Error ? err.message : String(err),
          source: post,
        });
      }
    }

    const traceRegex = new RegExp(TRACE_TAG.source, TRACE_TAG.flags);
    while ((m = traceRegex.exec(inner)) !== null) {
      const type = m[1].trim();
      const confidenceStr = m[2];
      const inside = m[3];
      const decision = inside.match(DECISION_TAG)?.[1].trim() ?? "";
      const conclusion = inside.match(CONCLUSION_TAG)?.[1].trim() ?? "";
      const observations = [...inside.matchAll(OBSERVATION_TAG)].map((mm) =>
        mm[1].trim(),
      );
      if (!decision || !conclusion) {
        out.push({
          kind: "trace",
          id: null,
          error: "<trace> missing required <decision> or <conclusion>",
          source: { type, decision, conclusion },
        });
        continue;
      }
      const post: Record<string, unknown> = {
        decision: { type, summary: decision.slice(0, 200) },
        reasoning: {
          observations: observations.length > 0 ? observations : [],
          conclusion: conclusion.slice(0, 4000),
        },
      };
      // Markup-emitted traces inherit ambient parent + tags too, so
      // a <trace> tag inside `at.deciding(...)` chains to the framing
      // decision the same way auto-trace does.
      if (ambient?.parent_trace_id) {
        post.parent_trace_id = ambient.parent_trace_id;
      }
      if (ambient?.tags && ambient.tags.length > 0) {
        post.tags = [...ambient.tags];
      }
      if (confidenceStr) {
        const conf = Number.parseFloat(confidenceStr);
        if (Number.isFinite(conf) && conf >= 0 && conf <= 1) {
          (post.reasoning as Record<string, unknown>).confidence = conf;
        }
      }
      try {
        const result = (await this.at.request("POST", "/v1/traces", post)) as
          | { trace_id?: string }
          | undefined;
        out.push({
          kind: "trace",
          id: result?.trace_id ?? null,
          error: null,
          source: post,
        });
      } catch (err) {
        out.push({
          kind: "trace",
          id: null,
          error: err instanceof Error ? err.message : String(err),
          source: post,
        });
      }
    }

    return out;
  }
}

interface ManagedStreamInitialization {
  provider: AnthropicManagedStreamLike;
  prepared: PreparedRequest;
}

type StreamListener = (...args: unknown[]) => void;

interface PendingListener {
  mode: "on" | "once";
  event: string;
  listener: StreamListener;
}

/**
 * Lazy facade for Anthropic's high-level MessageStream.
 *
 * Wake retrieval is asynchronous while the official `messages.stream(...)`
 * helper is synchronous. This facade returns immediately, queues listeners,
 * and starts the provider helper only after wake is ready. It never rewrites
 * events. The sole semantic addition is exact-once final-message adaptation.
 */
class ManagedAnthropicStream implements AdaptedManagedStream {
  readonly controller = new AbortController();

  private readonly initialized: Promise<ManagedStreamInitialization>;
  private readonly finalize: (
    response: AnthropicMessageResponse,
    prepared: PreparedRequest,
  ) => Promise<AdaptedResponse>;
  private provider: AnthropicManagedStreamLike | undefined;
  private finalization: Promise<AdaptedResponse> | undefined;
  private receipt: AgentToolAugmentation;
  private readonly pendingListeners: PendingListener[] = [];

  constructor(
    initialize: (signal: AbortSignal) => Promise<ManagedStreamInitialization>,
    finalize: (
      response: AnthropicMessageResponse,
      prepared: PreparedRequest,
    ) => Promise<AdaptedResponse>,
    initialReceipt: AgentToolAugmentation,
  ) {
    this.finalize = finalize;
    this.receipt = initialReceipt;
    this.controller.signal.addEventListener(
      "abort",
      () => this._abortProvider(),
      { once: true },
    );
    this.initialized = initialize(this.controller.signal).then((value) => {
      this.provider = value.provider;
      this.receipt = {
        ...this.receipt,
        wake_used: !value.prepared.meta.skip_wake,
        cache_eligible: value.prepared.wakeMeta?.cache_eligible ?? null,
      };
      if (this.controller.signal.aborted) {
        this._abortProvider();
        throw streamAbortError();
      }

      // Attach exact-once finalization before user listeners. The official
      // helper emits `finalMessage` only after it has a complete Message.
      value.provider.once?.("finalMessage", () => {
        void this.finalMessage().catch((err) => {
          console.warn(
            "[agenttool-adapter] stream finalization failed:",
            err instanceof Error ? err.message : err,
          );
        });
      });
      for (const pending of this.pendingListeners.splice(0)) {
        value.provider[pending.mode]?.(
          pending.event,
          pending.listener,
        );
      }
      return value;
    });
    // Keep an unused lazy stream from creating an unhandled rejection. Every
    // promise-returning method still observes the original rejection.
    void this.initialized.catch(() => {});
  }

  get agenttool(): AgentToolAugmentation {
    return this.receipt;
  }

  on(event: string, listener: StreamListener): this {
    if (this.provider) {
      if (!this.provider.on) throw streamMethodUnavailable("on");
      this.provider.on(event, listener);
    } else {
      this.pendingListeners.push({ mode: "on", event, listener });
    }
    return this;
  }

  once(event: string, listener: StreamListener): this {
    if (this.provider) {
      if (!this.provider.once) throw streamMethodUnavailable("once");
      this.provider.once(event, listener);
    } else {
      this.pendingListeners.push({ mode: "once", event, listener });
    }
    return this;
  }

  off(event: string, listener: StreamListener): this {
    if (this.provider) {
      if (!this.provider.off) throw streamMethodUnavailable("off");
      this.provider.off(event, listener);
      return this;
    }
    const index = this.pendingListeners.findIndex(
      (pending) =>
        pending.event === event && pending.listener === listener,
    );
    if (index >= 0) this.pendingListeners.splice(index, 1);
    return this;
  }

  emitted(event: string): Promise<unknown> {
    // Queue before initialization so fast provider events cannot race the
    // asynchronous wake lookup.
    return new Promise((resolve, reject) => {
      if (event !== "error") this.once("error", reject);
      this.once(event, (...args) => {
        resolve(args.length <= 1 ? args[0] : args);
      });
    });
  }

  async withResponse(): Promise<Record<string, unknown>> {
    const { provider } = await this.initialized;
    if (!provider.withResponse) throw streamMethodUnavailable("withResponse");
    const result = await provider.withResponse();
    return { ...result, data: this };
  }

  finalMessage(): Promise<AdaptedResponse> {
    if (!this.finalization) {
      this.finalization = this.initialized.then(async ({ provider, prepared }) => {
        // This is the only call site for the provider's finalMessage().
        const response = await provider.finalMessage();
        const adapted = await this.finalize(response, prepared);
        this.receipt = adapted.agenttool;
        return adapted;
      });
    }
    return this.finalization;
  }

  async finalText(): Promise<string> {
    const message = await this.finalMessage();
    return extractFinalText(message);
  }

  async done(): Promise<void> {
    await this.finalMessage();
  }

  abort(): void {
    if (!this.controller.signal.aborted) this.controller.abort();
    else this._abortProvider();
  }

  async close(): Promise<void> {
    if (!this.provider) {
      this.abort();
      return;
    }
    if (this.provider.close) {
      await this.provider.close();
      return;
    }
    this.abort();
  }

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    let iterator: AsyncIterator<unknown> | undefined;
    const getIterator = async (): Promise<AsyncIterator<unknown>> => {
      if (iterator) return iterator;
      const { provider } = await this.initialized;
      iterator = provider[Symbol.asyncIterator]();
      return iterator;
    };

    return {
      next: async () => {
        const current = await getIterator();
        const result = await current.next();
        if (result.done) await this.finalMessage();
        return result;
      },
      return: async (value?: unknown) => {
        if (!iterator) {
          this.abort();
          return { value, done: true };
        }
        if (iterator.return) return iterator.return(value);
        this.abort();
        return { value, done: true };
      },
      throw: async (error?: unknown) => {
        if (iterator?.throw) return iterator.throw(error);
        this.abort();
        throw error;
      },
    };
  }

  private _abortProvider(): void {
    if (!this.provider) return;
    if (this.provider.abort) {
      this.provider.abort();
      return;
    }
    this.provider.controller?.abort();
  }
}

function adaptLowLevelStream(
  stream: AnthropicLowLevelStreamLike,
  receipt: AgentToolAugmentation,
): AdaptedLowLevelStream {
  return new Proxy(stream, {
    get(target, property) {
      if (property === "agenttool") return receipt;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as AdaptedLowLevelStream;
}

function isLowLevelStream(value: unknown): value is AnthropicLowLevelStreamLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<AsyncIterable<unknown>>)[Symbol.asyncIterator]
      === "function"
  );
}

function isManagedStream(value: unknown): value is AnthropicManagedStreamLike {
  return (
    isLowLevelStream(value) &&
    typeof (value as Partial<AnthropicManagedStreamLike>).finalMessage
      === "function"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function streamAbortError(): AgentToolError {
  return new AgentToolError(
    "Anthropic stream initialization was cancelled before provider I/O.",
    {
      code: "anthropic_stream_aborted",
      hint: "Create a new stream when you are ready to continue.",
    },
  );
}

function streamMethodUnavailable(method: string): AgentToolError {
  return new AgentToolError(
    `The wrapped Anthropic stream does not expose ${method}().`,
    {
      code: "anthropic_stream_helper_invalid",
      hint: "Use a client implementing the current Anthropic MessageStream helper.",
    },
  );
}

/** Normalise an arbitrary `system=` value into Anthropic's array-of-blocks
 *  shape. Strings become a single text block; arrays pass through; missing
 *  yields []. */
function normalizeSystem(s: unknown): Array<{ type: "text"; text: string }> {
  if (s === undefined || s === null) return [];
  if (typeof s === "string") return [{ type: "text", text: s }];
  if (Array.isArray(s)) return s as Array<{ type: "text"; text: string }>;
  return [];
}

/** Concatenate all text-block content from an Anthropic Messages response. */
function extractResponseText(response: AnthropicMessageResponse): string {
  const blocks = response.content ?? [];
  return blocks
    .map((b) => (b.type === "text" && typeof b.text === "string" ? b.text : ""))
    .filter((s) => s.length > 0)
    .join("\n");
}

/** Match Anthropic MessageStream.finalText(): concatenate final text blocks
 * with one space, after exact-once final-message adaptation. */
function extractFinalText(response: AnthropicMessageResponse): string {
  const parts = (response.content ?? [])
    .filter(
      (block): block is { type: string; text: string } =>
        block.type === "text" && typeof block.text === "string",
    )
    .map((block) => block.text);
  if (parts.length === 0) {
    throw new AgentToolError(
      "Anthropic stream ended without a text content block.",
      {
        code: "anthropic_stream_no_text",
        hint: "Read finalMessage().content for non-text response blocks.",
      },
    );
  }
  return parts.join(" ");
}

/** Pull text from the most recent user message in the request params.
 *  Tolerates string content, array-of-blocks content, or missing. */
function extractLastUserText(params: Record<string, unknown>): string {
  const messages = (params.messages as Array<Record<string, unknown>> | undefined) ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    const content = m.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((b) =>
          typeof b === "object" && b !== null && "text" in b
            ? String((b as { text: unknown }).text ?? "")
            : "",
        )
        .filter((s) => s.length > 0)
        .join("\n");
    }
  }
  return "";
}
