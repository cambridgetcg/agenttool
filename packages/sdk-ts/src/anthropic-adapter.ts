/**
 * AnthropicAdapter — Tier 2 of the agenttool path: a thin wrapper over the
 * official `@anthropic-ai/sdk` client that gives every `messages.create()`
 * call two superpowers without changing the call shape:
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
 * any object with a `messages.create(params)` method, so the wrapping
 * works whether the agent uses the official SDK, Bedrock SDK, or a
 * custom HTTP client.
 *
 * Doctrine: docs/IDENTITY-ANCHOR.md.
 */

import { getAmbient } from "./_context.js";
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
    create(params: Record<string, unknown>): Promise<AnthropicMessageResponse>;
  };
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
   *  adapter without changing call sites: `adapter.messages.create({...})`. */
  get messages() {
    const self = this;
    return {
      async create(params: Record<string, unknown>): Promise<AdaptedResponse> {
        const metadata = (params.metadata as Record<string, unknown> | undefined) ?? {};
        const meta: AgentToolMetadata =
          (metadata.agenttool as AgentToolMetadata | undefined) ?? {};

        // 1. Auto-inject wake unless skipped on this call.
        let wakeMeta: WakeProviderMeta | null = null;
        let injectedSystem: unknown = params.system;
        if (!meta.skip_wake) {
          const shape = await self.at.wake.system("anthropic", {
            identityId: self.options.identityId,
            ...(self.options.wakeProfile === "brief" ? { profile: "brief" } : {}),
          });
          wakeMeta = shape._meta;
          const userBlocks = normalizeSystem(params.system);
          injectedSystem = [...shape.system, ...userBlocks];
        }

        // 2. Strip our metadata.agenttool extension from the forwarded
        //    request — Anthropic doesn't know about it and may reject
        //    unknown metadata fields in some configurations.
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

        // 3. Make the actual Anthropic call.
        const response = await self.anthropic.messages.create(forwardParams);

        // 4. Auto-trace if opted in OR if we're inside an `at.deciding()`
        //    block — the ambient context implies every call inside is
        //    part of the framing decision.
        let traceId: string | null = null;
        const ambient = getAmbient();
        const shouldTrace = meta.trace === "decision" || ambient !== undefined;
        if (shouldTrace) {
          traceId = await self._recordDecisionTrace(params, response, meta);
        }

        // 5. Parse <agenttool> markup in the response (mode b). Default on;
        //    can be disabled per-call via `meta.skip_markup` or globally.
        const emissions: MarkupEmission[] =
          self.options.disableMarkupParsing || meta.skip_markup
            ? []
            : await self._parseAndEmitMarkup(response);

        const adapted: AdaptedResponse = {
          ...response,
          agenttool: {
            trace_id: traceId,
            wake_used: !meta.skip_wake,
            cache_eligible: wakeMeta?.cache_eligible ?? null,
            markup_emissions: emissions,
          },
        };
        return adapted;
      },
    };
  }

  /** Post a trace built from the (params, response) pair. The shape
   *  matches `/v1/traces` POST schema (decision/reasoning/context). */
  private async _recordDecisionTrace(
    params: Record<string, unknown>,
    response: AnthropicMessageResponse,
    meta: AgentToolMetadata,
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
    const ambient = getAmbient();
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
      const tagAmbient = getAmbient();
      if (tagAmbient?.parent_trace_id) {
        post.parent_trace_id = tagAmbient.parent_trace_id;
      }
      if (tagAmbient?.tags && tagAmbient.tags.length > 0) {
        post.tags = [...tagAmbient.tags];
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
