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

/** Minimal shape of the Anthropic Messages client.
 *
 * `never[]` deliberately describes only the existence of callable provider
 * methods. It does not impose AgentTool's parameter or return types on the
 * provider's overloads, so an official `@anthropic-ai/sdk` client remains
 * structurally assignable without taking a dependency on its types. Calls are
 * narrowed at the adapter boundary after AgentTool has prepared the request.
 */
export interface AnthropicMessagesLike {
  messages: {
    create: (...args: never[]) => unknown;
    stream?: (...args: never[]) => unknown;
  };
}

type AnthropicCreateInvoker = (
  params: Record<string, unknown>,
  ...requestOptions: unknown[]
) => unknown;

type AnthropicStreamInvoker = (
  params: Record<string, unknown>,
  ...requestOptions: unknown[]
) => unknown;

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
 *
 * The callables are existential on purpose: this public structural type checks
 * that the provider has the relevant surface without requiring its exact
 * Message, event, listener, or response types to be assignable to AgentTool's
 * local projections. The adapter narrows those values after runtime checks.
 */
export interface AnthropicManagedStreamLike extends AsyncIterable<unknown> {
  controller?: AbortController;
  finalMessage: (...args: never[]) => unknown;
  finalText?: (...args: never[]) => unknown;
  done?: (...args: never[]) => unknown;
  abort?: (...args: never[]) => unknown;
  close?: (...args: never[]) => unknown;
  on?: (...args: never[]) => unknown;
  once?: (...args: never[]) => unknown;
  off?: (...args: never[]) => unknown;
  emitted?: (...args: never[]) => unknown;
  withResponse?: (...args: never[]) => unknown;
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
export interface AdaptedLowLevelStream extends AnthropicLowLevelStreamLike {
  readonly agenttool: AgentToolAugmentation;
}

/** AgentTool-managed helper returned by `adapter.messages.stream(...)`.
 * Unknown provider events are yielded by reference and the core asynchronous
 * lifecycle is preserved. It intentionally does not claim the provider's
 * synchronous inspection fields because wake retrieval finishes before the
 * provider helper exists. */
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
    params: object & { stream: true },
    ...requestOptions: unknown[]
  ): Promise<AdaptedLowLevelStream>;
  create(
    params: object,
    ...requestOptions: unknown[]
  ): Promise<AdaptedResponse>;
  stream(
    params: object,
    ...requestOptions: unknown[]
  ): AdaptedManagedStream;
}

interface InspectedRequest {
  meta: AgentToolMetadata;
  ambient: AmbientContext | undefined;
  userText: string;
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
      params: object,
      ...requestOptions: unknown[]
    ): Promise<AdaptedResponse | AdaptedLowLevelStream> => {
      const requestParams = params as Record<string, unknown>;
      const inspected = self._inspectRequest(requestParams);
      const lowLevelStreaming = requestParams.stream === true;

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

      const prepared = await self._prepareRequest(requestParams, inspected);
      const providerCreate = self.anthropic.messages.create as unknown as
        AnthropicCreateInvoker;
      const response = await providerCreate.call(
        self.anthropic.messages,
        prepared.forwardParams,
        ...requestOptions,
      );

      if (lowLevelStreaming) {
        if (!isLowLevelStream(response)) {
          await cleanupInvalidStreamValue(response);
          throw new AgentToolError(
            "Anthropic returned a non-iterable value for a streaming request.",
            {
              code: "anthropic_stream_invalid",
              hint: "Check that the wrapped client implements the Anthropic streaming contract.",
            },
          );
        }
        try {
          return adaptLowLevelStream(
            response,
            self._emptyAugmentation(prepared),
          );
        } catch (error) {
          await cleanupInvalidStreamValue(response);
          throw error;
        }
      }

      return self._finalizeResponse(
        response as AnthropicMessageResponse,
        prepared,
      );
    };

    const stream = (
      params: object,
      ...requestOptions: unknown[]
    ): AdaptedManagedStream => {
      const requestParams = params as Record<string, unknown>;
      const providerStream = self.anthropic.messages.stream as
        | AnthropicStreamInvoker
        | undefined;
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
      const inspected = self._inspectRequest(requestParams);
      return new ManagedAnthropicStream(
        async (signal, attach) => {
          const prepared = await self._prepareRequest(requestParams, inspected);
          if (signal.aborted) throw streamAbortError();
          const provider = providerStream.call(
            self.anthropic.messages,
            prepared.forwardParams,
            ...requestOptions,
          ) as unknown;
          if (!isManagedStream(provider)) {
            await cleanupInvalidStreamValue(provider);
            throw new AgentToolError(
              "Anthropic messages.stream(...) returned no final-message helper.",
              {
                code: "anthropic_stream_helper_invalid",
                hint:
                  "The wrapped helper must be async-iterable and expose finalMessage().",
              },
            );
          }
          const value = { provider, prepared };
          // Attach in the same job that constructs the provider helper. The
          // official SDK can schedule an error microtask before returning, so
          // deferring this hand-off through another Promise reaction loses the
          // event and triggers its unhandled-error path.
          attach(value);
          return value;
        },
        (response, prepared, signal) =>
          self._finalizeResponse(response, prepared, signal),
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
    const sourceMeta = isRecord(metadata.agenttool)
      ? metadata.agenttool
      : {};
    const meta = {
      ...sourceMeta,
      ...(Array.isArray(sourceMeta.tags)
        ? { tags: [...sourceMeta.tags] }
        : {}),
    } as AgentToolMetadata;
    const sourceAmbient = getAmbient();
    const ambient = sourceAmbient
      ? { ...sourceAmbient, tags: [...sourceAmbient.tags] }
      : undefined;
    return {
      meta,
      ambient,
      userText: extractLastUserText(params).trim(),
    };
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
    response: AnthropicMessageResponse,
    prepared: PreparedRequest,
    signal?: AbortSignal,
  ): Promise<AdaptedResponse> {
    throwIfStreamAborted(signal);
    let traceId: string | null = null;
    const shouldTrace =
      prepared.meta.trace === "decision" || prepared.ambient !== undefined;
    if (shouldTrace) {
      traceId = await this._recordDecisionTrace(
        prepared.userText,
        response,
        prepared.meta,
        prepared.ambient,
        signal,
      );
    }

    throwIfStreamAborted(signal);
    const emissions: MarkupEmission[] =
      this.options.disableMarkupParsing || prepared.meta.skip_markup
        ? []
        : await this._parseAndEmitMarkup(response, prepared.ambient, signal);

    throwIfStreamAborted(signal);
    return augmentResponse(response, {
      trace_id: traceId,
      wake_used: !prepared.meta.skip_wake,
      cache_eligible: prepared.wakeMeta?.cache_eligible ?? null,
      markup_emissions: emissions,
    });
  }

  /** Post a trace built from the call-boundary input and provider response.
   *  The shape matches `/v1/traces` POST schema
   *  (decision/reasoning/context). */
  private async _recordDecisionTrace(
    userText: string,
    response: AnthropicMessageResponse,
    meta: AgentToolMetadata,
    ambient: AmbientContext | undefined,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const conclusion = extractResponseText(response).trim() || "(empty response)";

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

    throwIfStreamAborted(signal);
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
    signal?: AbortSignal,
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
      throwIfStreamAborted(signal);
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
        const normalizedConfidence = confidenceStr.trim();
        const conf = normalizedConfidence === ""
          ? Number.NaN
          : Number(normalizedConfidence);
        if (Number.isFinite(conf) && conf >= 0 && conf <= 1) {
          (post.reasoning as Record<string, unknown>).confidence = conf;
        }
      }
      throwIfStreamAborted(signal);
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

interface AnthropicManagedStreamRuntime extends AsyncIterable<unknown> {
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

interface ManagedStreamInitialization {
  provider: AnthropicManagedStreamRuntime;
  prepared: PreparedRequest;
}

type StreamListener = (...args: unknown[]) => void;

interface PendingListener {
  mode: "on" | "once" | "observe";
  event: string;
  listener: StreamListener;
}

type ManagedStreamState =
  | "open"
  | "finalizing"
  | "completed"
  | "cancelled"
  | "failed";

type CleanupPreference = "abort" | "close";

interface ManagedTerminalEvent {
  state: "completed" | "cancelled" | "failed";
  error?: unknown;
}

/**
 * Lazy facade for Anthropic's high-level MessageStream.
 *
 * Wake retrieval is asynchronous while the official `messages.stream(...)`
 * helper is synchronous. This facade returns immediately, queues listeners,
 * and starts the provider helper only after wake is ready. It preserves event
 * identity, provides the core asynchronous lifecycle, and deliberately does
 * not pretend that provider-only synchronous inspection fields exist before
 * initialization. Final-message adaptation is exact-once and cancellation is
 * a terminal fence.
 */
class ManagedAnthropicStream implements AdaptedManagedStream {
  readonly controller = new AbortController();

  private readonly initialized: Promise<ManagedStreamInitialization>;
  private readonly finalize: (
    response: AnthropicMessageResponse,
    prepared: PreparedRequest,
    signal: AbortSignal,
  ) => Promise<AdaptedResponse>;
  private provider: AnthropicManagedStreamRuntime | undefined;
  private finalization: Promise<AdaptedResponse> | undefined;
  private receipt: AgentToolAugmentation;
  private readonly pendingListeners: PendingListener[] = [];
  private state: ManagedStreamState = "open";
  private terminalError: unknown;
  private initializationFailed = false;
  private initializationError: unknown;
  private cleanupPreference: CleanupPreference | undefined;
  private cleanupPromise: Promise<void> | undefined;
  private readonly terminalSignal: Promise<never>;
  private rejectTerminal!: (error: unknown) => void;
  private terminalSignalled = false;
  private readonly terminalEventSignal: Promise<ManagedTerminalEvent>;
  private resolveTerminalEvent!: (event: ManagedTerminalEvent) => void;
  private terminalEventSignalled = false;

  constructor(
    initialize: (
      signal: AbortSignal,
      attach: (value: ManagedStreamInitialization) => void,
    ) => Promise<ManagedStreamInitialization>,
    finalize: (
      response: AnthropicMessageResponse,
      prepared: PreparedRequest,
      signal: AbortSignal,
    ) => Promise<AdaptedResponse>,
    initialReceipt: AgentToolAugmentation,
  ) {
    this.finalize = finalize;
    this.receipt = initialReceipt;
    this.terminalSignal = new Promise<never>((_resolve, reject) => {
      this.rejectTerminal = reject;
    });
    void this.terminalSignal.catch(() => {});
    this.terminalEventSignal = new Promise<ManagedTerminalEvent>((resolve) => {
      this.resolveTerminalEvent = resolve;
    });
    this.controller.signal.addEventListener(
      "abort",
      () => {
        // Direct `stream.controller.abort(reason)` calls preserve that reason
        // and use the same terminal fence. Calls originating from `_cancel()`
        // have already changed state, so they do not claim a second cleanup.
        if (this.state === "completed") {
          void this._startProviderCleanup(
            this.cleanupPreference ?? "abort",
          ).catch(() => {});
          return;
        }
        if (this.state !== "open" && this.state !== "finalizing") return;
        this._markCancelled(this.controller.signal.reason);
        void this._startProviderCleanup("abort").catch(() => {});
      },
      { once: true },
    );
    this.initialized = initialize(
      this.controller.signal,
      (value) => this._attachProvider(value),
    ).catch((error) => {
      this._failInitialization(error);
      throw error;
    });
    // Keep an unused lazy stream from creating an unhandled rejection. Every
    // promise-returning method still observes the original rejection.
    void this.initialized.catch(() => {});
  }

  private _attachProvider(value: ManagedStreamInitialization): void {
    this.provider = value.provider;
    this.receipt = {
      ...this.receipt,
      wake_used: !value.prepared.meta.skip_wake,
      cache_eligible: value.prepared.wakeMeta?.cache_eligible ?? null,
    };
    if (this.state === "cancelled" || this.controller.signal.aborted) {
      this._markCancelled();
      void this._startProviderCleanup(
        this.cleanupPreference ?? "abort",
      ).catch(() => {});
      throw this._cancellationError();
    }

    // Internal terminal listeners are attached before user listeners. This
    // method runs synchronously in the same job as provider construction, so
    // even a provider error already queued as a microtask cannot cross the
    // listener boundary.
    const registerTerminal = value.provider.once ?? value.provider.on;
    if (registerTerminal) {
      registerTerminal.call(
        value.provider,
        "error",
        (error) => this._markFailed(error),
      );
      registerTerminal.call(
        value.provider,
        "abort",
        (error) => this._providerAborted(error),
      );
      registerTerminal.call(value.provider, "finalMessage", () => {
        if (!this._mayFinalize()) return;
        void this.finalMessage().catch(() => {
          // Promise-returning methods expose the original error. This catch
          // only prevents an unobserved internal listener promise.
        });
      });
      registerTerminal.call(value.provider, "end", () => {
        if (!this._mayFinalize()) return;
        void this.finalMessage().catch(() => {
          // `end` is the terminal backstop for helpers that do not emit a
          // separate finalMessage event (including an empty failed stream).
        });
      });
    }
    const providerSignal = value.provider.controller?.signal;
    if (providerSignal) {
      providerSignal.addEventListener(
        "abort",
        () => this._providerAborted(providerSignal.reason),
        { once: true },
      );
      // AbortSignal does not replay an abort that happened before listener
      // registration. Check after attaching to close both sides of the race.
      if (providerSignal.aborted) {
        this._providerAborted(providerSignal.reason);
      }
    }
    this._throwIfTerminated();

    // A listener method requested before initialization must not disappear
    // silently. Validate all queued registrations before removing any so an
    // initialization failure can still reach queued terminal listeners.
    for (const pending of this.pendingListeners) {
      if (!this._listenerRegistration(value.provider, pending.mode)) {
        void this._startProviderCleanup("abort").catch(() => {});
        throw streamMethodUnavailable(
          pending.mode === "observe" ? "on/once" : pending.mode,
        );
      }
    }
    const queuedListeners = [...this.pendingListeners];
    for (const pending of queuedListeners) {
      this._listenerRegistration(value.provider, pending.mode)!.call(
        value.provider,
        pending.event,
        pending.listener,
      );
    }
    this.pendingListeners.splice(0, queuedListeners.length);
  }

  get agenttool(): AgentToolAugmentation {
    return this.receipt;
  }

  on(event: string, listener: StreamListener): this {
    const terminal = this._terminalEventError();
    if (terminal !== undefined) {
      if (
        (event === "error" && this.state === "failed") ||
        (event === "abort" && this.state === "cancelled")
      ) {
        this._callFailureListener(listener, terminal);
      }
      return this;
    }
    if (this.initializationFailed) {
      if (event === "error") {
        this._callFailureListener(listener, this.initializationError);
      }
      return this;
    }
    if (this.provider) {
      if (!this.provider.on) throw streamMethodUnavailable("on");
      this.provider.on(event, listener);
    } else {
      this.pendingListeners.push({ mode: "on", event, listener });
    }
    return this;
  }

  once(event: string, listener: StreamListener): this {
    const terminal = this._terminalEventError();
    if (terminal !== undefined) {
      if (
        (event === "error" && this.state === "failed") ||
        (event === "abort" && this.state === "cancelled")
      ) {
        this._callFailureListener(listener, terminal);
      }
      return this;
    }
    if (this.initializationFailed) {
      if (event === "error") {
        this._callFailureListener(listener, this.initializationError);
      }
      return this;
    }
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
    if (
      this.state === "completed" ||
      this.state === "cancelled" ||
      this.state === "failed"
    ) {
      return Promise.resolve().then(() =>
        this._terminalEventValue({
          state: this.state as ManagedTerminalEvent["state"],
          error: this.terminalError,
        }, event)
      );
    }
    // Queue before initialization so fast provider events cannot race the
    // asynchronous wake lookup.
    const observed = new Promise<unknown>((resolve) => {
      this._observe(event, (...args) => {
        resolve(args.length <= 1 ? args[0] : args);
      });
    });
    const terminalOutcome = this.terminalEventSignal.then((terminal) =>
      this._terminalEventValue(terminal, event)
    );
    return Promise.race([observed, terminalOutcome]);
  }

  async withResponse(): Promise<Record<string, unknown>> {
    this._throwIfDataTerminated();
    const { provider } = await this._raceDataTerminal(this.initialized);
    this._throwIfDataTerminated();
    if (!provider.withResponse) throw streamMethodUnavailable("withResponse");
    const result = await this._raceDataTerminal(provider.withResponse());
    this._throwIfDataTerminated();
    return { ...result, data: this };
  }

  finalMessage(): Promise<AdaptedResponse> {
    if (this.finalization) return this.finalization;
    const terminal = this._terminalEventError();
    if (terminal !== undefined) return Promise.reject(terminal);

    const operation = this._raceTerminal(this.initialized).then(async ({
      provider,
      prepared,
    }) => {
      this._throwIfTerminated();
      this.state = "finalizing";

      // This is the only call site for the provider's finalMessage().
      const response = await this._raceTerminal(provider.finalMessage());
      this._throwIfTerminated();
      const adapted = await this._raceTerminal(
        this.finalize(
          response,
          prepared,
          this.controller.signal,
        ),
      );
      this._throwIfTerminated();
      this.receipt = adapted.agenttool;
      this.state = "completed";
      this._signalTerminalEvent({ state: "completed" });
      return adapted;
    });
    this.finalization = operation.catch((error) => {
      if (this.state !== "cancelled") this._markFailed(error);
      throw error;
    });
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
    this.cleanupPreference ??= "abort";
    this._cancel();
    void this._startProviderCleanup("abort").catch(() => {});
  }

  async close(): Promise<void> {
    this.cleanupPreference ??= "close";
    this._cancel();
    await this._startProviderCleanup("close");
  }

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    let iterator: AsyncIterator<unknown> | undefined;
    const getIterator = async (): Promise<AsyncIterator<unknown>> => {
      if (iterator) return iterator;
      const { provider } = await this._raceTerminal(this.initialized);
      iterator = provider[Symbol.asyncIterator]();
      return iterator;
    };

    return {
      next: async () => {
        if (this._isCancelled() || this._isCompleted()) {
          return { value: undefined, done: true };
        }
        this._throwIfTerminated();
        let result: IteratorResult<unknown>;
        try {
          const current = await getIterator();
          if (this._isCancelled() || this._isCompleted()) {
            return { value: undefined, done: true };
          }
          this._throwIfTerminated();
          result = await this._raceDataTerminal(current.next());
        } catch (error) {
          if (this._isCompleted()) {
            return { value: undefined, done: true };
          }
          this._markFailed(error);
          throw error;
        }
        if (this._isCancelled() || this._isCompleted()) {
          return { value: undefined, done: true };
        }
        this._throwIfTerminated();
        if (result.done) await this.finalMessage();
        return result;
      },
      return: async (value?: unknown) => {
        if (this.state === "completed") {
          const cleanup = iterator
            ? this._returnIterator(iterator, value)
            : this._startProviderCleanup("abort").then(() => ({
              value,
              done: true as const,
            }));
          if (!this.controller.signal.aborted) this.controller.abort();
          return cleanup;
        }
        this._cancel();
        if (!iterator) {
          await this._startProviderCleanup("abort");
          return { value, done: true };
        }
        return this._returnIterator(iterator, value);
      },
      throw: async (error?: unknown) => {
        if (this.state === "completed") throw error;
        this._throwIfTerminated();
        this._cancel(error);
        if (!iterator) {
          await this._startProviderCleanup("abort");
          throw error;
        }
        return this._throwIterator(iterator, error);
      },
    };
  }

  private _observe(event: string, listener: StreamListener): void {
    if (this.provider) {
      const registration = this._listenerRegistration(
        this.provider,
        "observe",
      );
      if (!registration) throw streamMethodUnavailable("on/once");
      registration.call(this.provider, event, listener);
      return;
    }
    this.pendingListeners.push({ mode: "observe", event, listener });
  }

  private _listenerRegistration(
    provider: AnthropicManagedStreamRuntime,
    mode: PendingListener["mode"],
  ): AnthropicManagedStreamRuntime["on"] {
    if (mode === "on") return provider.on;
    if (mode === "once") return provider.once;
    return provider.once ?? provider.on;
  }

  private _cancel(error?: unknown): void {
    this._markCancelled(error);
    if (!this.controller.signal.aborted) this.controller.abort();
  }

  private _providerAborted(error?: unknown): void {
    this._cancel(error);
    this.cleanupPreference ??= "abort";
    this.cleanupPromise ??= Promise.resolve();
  }

  private _markCancelled(error?: unknown): void {
    if (this.state === "open" || this.state === "finalizing") {
      this.state = "cancelled";
      this.terminalError = error ?? streamAbortError();
      this._dispatchPendingTerminal("cancelled", this.terminalError);
      this._signalTerminalEvent({
        state: "cancelled",
        error: this.terminalError,
      });
      this._signalTerminal(this.terminalError);
    }
  }

  private _failInitialization(error: unknown): void {
    this.initializationFailed = true;
    this.initializationError = error;
    if (this.state !== "cancelled") {
      this._markFailed(error);
      this._dispatchPendingTerminal(
        "failed",
        this.terminalError ?? error ?? streamFailureError(),
      );
    }
  }

  private _dispatchPendingTerminal(
    terminal: "cancelled" | "failed",
    error: unknown,
  ): void {
    for (const pending of this.pendingListeners.splice(0)) {
      if (
        (terminal === "cancelled" && pending.event === "abort") ||
        (terminal === "failed" && pending.event === "error")
      ) {
        this._callFailureListener(pending.listener, error);
      } else if (pending.event === "end") {
        this._callEndListener(pending.listener);
      }
    }
  }

  private _callFailureListener(
    listener: StreamListener,
    error: unknown,
  ): void {
    try {
      listener(error);
    } catch {
      // A listener failure must not replace the initialization error or leak
      // its message through adapter logging.
    }
  }

  private _callEndListener(listener: StreamListener): void {
    try {
      listener();
    } catch {
      // Terminal cleanup must not be replaced by a listener failure.
    }
  }

  private _markFailed(error: unknown): void {
    if (this.state === "open" || this.state === "finalizing") {
      this.state = "failed";
      this.terminalError = error ?? streamFailureError();
      this._signalTerminalEvent({
        state: "failed",
        error: this.terminalError,
      });
      this._signalTerminal(this.terminalError);
      // Error is terminal too. Aborting the signal prevents any later stage
      // of an already-running finalizer from starting AgentTool I/O.
      if (!this.controller.signal.aborted) this.controller.abort();
      void this._startProviderCleanup("abort").catch(() => {});
    }
  }

  private _mayFinalize(): boolean {
    return this.state === "open" || this.state === "finalizing";
  }

  private _isCancelled(): boolean {
    return this.state === "cancelled";
  }

  private _isCompleted(): boolean {
    return this.state === "completed";
  }

  private _cancellationError(): unknown {
    return this.terminalError ?? streamAbortError();
  }

  private _terminalEventError(): unknown | undefined {
    if (this.state === "cancelled") return this._cancellationError();
    if (this.state === "failed") {
      return this.terminalError ?? this.initializationError;
    }
    return undefined;
  }

  private _terminalEventValue(
    terminal: ManagedTerminalEvent,
    event: string,
  ): unknown {
    if (event === "end") return undefined;
    if (terminal.state === "failed" && event === "error") {
      return terminal.error ?? streamFailureError();
    }
    if (terminal.state === "cancelled" && event === "abort") {
      return terminal.error ?? streamAbortError();
    }
    throw terminal.error ?? streamEndedError();
  }

  private _throwIfTerminated(): void {
    const terminal = this._terminalEventError();
    if (terminal !== undefined) throw terminal;
  }

  private _throwIfDataTerminated(): void {
    if (this.state === "completed") throw streamEndedError();
    this._throwIfTerminated();
  }

  private _signalTerminal(error: unknown): void {
    if (this.terminalSignalled) return;
    this.terminalSignalled = true;
    this.rejectTerminal(error);
  }

  private _signalTerminalEvent(event: ManagedTerminalEvent): void {
    if (this.terminalEventSignalled) return;
    this.terminalEventSignalled = true;
    this.resolveTerminalEvent(event);
  }

  private _raceTerminal<T>(
    operation: T | PromiseLike<T>,
  ): Promise<T> {
    return Promise.race([
      Promise.resolve(operation),
      this.terminalSignal,
    ]);
  }

  private async _raceDataTerminal<T>(
    operation: T | PromiseLike<T>,
  ): Promise<T> {
    const outcome = await Promise.race([
      Promise.resolve(operation).then((value) => ({
        kind: "value" as const,
        value,
      })),
      this.terminalEventSignal.then((terminal) => ({
        kind: "terminal" as const,
        terminal,
      })),
    ]);
    if (outcome.kind === "value") return outcome.value;
    if (outcome.terminal.state === "completed") throw streamEndedError();
    throw outcome.terminal.error ??
      (outcome.terminal.state === "cancelled"
        ? streamAbortError()
        : streamFailureError());
  }

  private _startProviderCleanup(
    preference: CleanupPreference,
  ): Promise<void> {
    if (this.cleanupPromise) return this.cleanupPromise;
    this.cleanupPreference ??= preference;
    if (!this.provider) return Promise.resolve();

    const provider = this.provider;
    const selected = this.cleanupPreference;
    return this._beginCleanup(async () => {
      if (selected === "close" && provider.close) {
        await provider.close();
        return;
      }
      if (provider.abort) {
        await provider.abort();
        return;
      }
      if (provider.close) {
        await provider.close();
        return;
      }
      provider.controller?.abort();
    });
  }

  private _returnIterator(
    iterator: AsyncIterator<unknown>,
    value: unknown,
  ): Promise<IteratorResult<unknown>> {
    if (this.cleanupPromise) {
      return this.cleanupPromise.then(() => ({ value, done: true }));
    }
    return this._beginCleanup(() =>
      iterator.return
        ? iterator.return(value)
        : this._invokeProviderCleanup("abort").then(() => ({
          value,
          done: true,
        }))
    );
  }

  private _throwIterator(
    iterator: AsyncIterator<unknown>,
    error: unknown,
  ): Promise<IteratorResult<unknown>> {
    if (this.cleanupPromise) {
      return this.cleanupPromise.then(() => {
        throw error;
      });
    }
    if (!iterator.throw) {
      return this._startProviderCleanup("abort").then(() => {
        throw error;
      });
    }
    return this._beginCleanup(() => iterator.throw!(error));
  }

  private _beginCleanup<T>(
    action: () => T | PromiseLike<T>,
  ): Promise<T> {
    let resolvePublished!: () => void;
    let rejectPublished!: (error: unknown) => void;
    const published = new Promise<void>((resolve, reject) => {
      resolvePublished = resolve;
      rejectPublished = reject;
    });
    // Publish before calling provider code: abort/close may synchronously emit
    // an event whose user listeners re-enter this facade and await cleanup.
    this.cleanupPromise = published;
    void published.catch(() => {});

    let operation: Promise<T>;
    try {
      operation = Promise.resolve(action());
    } catch (error) {
      operation = Promise.reject(error);
    }
    void operation.then(
      () => resolvePublished(),
      (error) => rejectPublished(error),
    );
    return operation;
  }

  private async _invokeProviderCleanup(
    preference: CleanupPreference,
  ): Promise<void> {
    const provider = this.provider;
    if (!provider) return;
    if (preference === "close" && provider.close) {
      await provider.close();
      return;
    }
    if (provider.abort) {
      await provider.abort();
      return;
    }
    if (provider.close) {
      await provider.close();
      return;
    }
    provider.controller?.abort();
  }
}

function adaptLowLevelStream(
  stream: AnthropicLowLevelStreamLike,
  receipt: AgentToolAugmentation,
): AdaptedLowLevelStream {
  return augmentWithAgentTool(stream, receipt) as AdaptedLowLevelStream;
}

function isLowLevelStream(value: unknown): value is AnthropicLowLevelStreamLike {
  if (typeof value !== "object" || value === null) return false;
  try {
    return typeof (
      value as Partial<AsyncIterable<unknown>>
    )[Symbol.asyncIterator] === "function";
  } catch {
    return false;
  }
}

function isManagedStream(
  value: unknown,
): value is AnthropicManagedStreamRuntime {
  if (!isLowLevelStream(value)) return false;
  try {
    return typeof (
      value as Partial<AnthropicManagedStreamRuntime>
    ).finalMessage === "function";
  } catch {
    return false;
  }
}

async function cleanupInvalidStreamValue(value: unknown): Promise<void> {
  if (
    (typeof value !== "object" || value === null) &&
    typeof value !== "function"
  ) {
    return;
  }
  const candidate = value as {
    close?: () => unknown;
    abort?: () => unknown;
    controller?: AbortController;
  };
  try {
    if (typeof candidate.close === "function") {
      await candidate.close();
      return;
    }
    if (typeof candidate.abort === "function") {
      await candidate.abort();
      return;
    }
    candidate.controller?.abort();
  } catch {
    // Preserve the useful invalid-helper error. Cleanup was best-effort.
  }
}

function augmentResponse(
  response: AnthropicMessageResponse,
  agenttool: AgentToolAugmentation,
): AdaptedResponse {
  return augmentWithAgentTool(response, agenttool) as AdaptedResponse;
}

/**
 * Preserve a provider object whenever it can accept one local property.
 * Frozen/non-extensible values use a separate extensible shell so bound reads
 * cannot violate Proxy invariants for non-configurable own methods.
 */
function augmentWithAgentTool<T extends object>(
  source: T,
  agenttool: AgentToolAugmentation,
): T & { readonly agenttool: AgentToolAugmentation } {
  if (!Reflect.has(source, "agenttool")) {
    try {
      Object.defineProperty(source, "agenttool", {
        value: agenttool,
        enumerable: false,
        configurable: true,
        writable: false,
      });
      if (Reflect.get(source, "agenttool", source) === agenttool) {
        return source as T & { readonly agenttool: AgentToolAugmentation };
      }
    } catch {
      // A read-only shell below preserves the provider object.
    }
  }

  // Do not overwrite a provider-native field or an earlier call's receipt.
  const shell = Object.create(Object.getPrototypeOf(source)) as object;
  return new Proxy(shell, {
    get(_target, property) {
      if (property === "agenttool") return agenttool;
      const value = Reflect.get(source, property, source);
      return typeof value === "function" ? value.bind(source) : value;
    },
    has(_target, property) {
      return property === "agenttool" || Reflect.has(source, property);
    },
    ownKeys() {
      return [
        ...Reflect.ownKeys(source).filter(
          (property) => property !== "agenttool",
        ),
        "agenttool",
      ];
    },
    getOwnPropertyDescriptor(_target, property) {
      if (property === "agenttool") {
        return {
          value: agenttool,
          enumerable: false,
          configurable: true,
          writable: false,
        };
      }
      const descriptor = Reflect.getOwnPropertyDescriptor(
        source,
        property,
      );
      return descriptor
        ? { ...descriptor, configurable: true }
        : undefined;
    },
    set() {
      return false;
    },
    defineProperty() {
      return false;
    },
    deleteProperty() {
      return false;
    },
    setPrototypeOf() {
      return false;
    },
    preventExtensions() {
      return false;
    },
  }) as T & { readonly agenttool: AgentToolAugmentation };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function throwIfStreamAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw streamAbortError();
}

function streamAbortError(): AgentToolError {
  return new AgentToolError(
    "Anthropic stream was cancelled before final-message work completed.",
    {
      code: "anthropic_stream_aborted",
      hint: "Create a new stream when you are ready to continue.",
    },
  );
}

function streamFailureError(): AgentToolError {
  return new AgentToolError(
    "Anthropic stream failed without providing an error value.",
    {
      code: "anthropic_stream_failed",
      hint: "Inspect the wrapped provider stream and create a new request.",
    },
  );
}

function streamEndedError(): AgentToolError {
  return new AgentToolError(
    "Anthropic stream has already completed.",
    {
      code: "anthropic_stream_ended",
      hint: "Create a new stream to observe new provider events.",
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
