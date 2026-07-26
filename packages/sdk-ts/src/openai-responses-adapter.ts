/**
 * OpenAIResponsesAdapter — a thin, dependency-free bridge around the
 * official OpenAI Responses API client.
 *
 * Every non-streaming `responses.create()` call can:
 *
 *   1. prepend the agent's OpenAI-shaped wake document to `instructions`;
 *   2. record a decision trace when `metadata.agenttool.trace` requests one
 *      or the call runs inside `at.deciding()`; and
 *   3. return the provider response with a local `.agenttool` receipt.
 *
 * `metadata.agenttool` is adapter control data. It is removed before the
 * provider call. All other request fields are preserved.
 *
 * Streaming and background execution are deliberately refused before wake
 * or provider I/O. Neither lifecycle can honestly carry a completed-response
 * trace or augmentation through this small wrapper.
 *
 * Posture: zero runtime dependency on the OpenAI SDK. Any object exposing
 * `responses.create(params)` can be wrapped.
 */

import { getAmbient, type AmbientContext } from "./_context.js";
import type { AgentTool } from "./client.js";
import { AgentToolError } from "./errors.js";
import type { WakeProfile, WakeProviderMeta } from "./wake.js";

export interface OpenAIResponsesLike {
  responses: {
    create: (
      params: any,
      requestOptions?: any,
    ) => PromiseLike<any>;
  };
}

/** The subset of a completed Responses API response used by the adapter. */
export interface OpenAIResponse {
  id: string;
  model?: string;
  status?: string | null;
  output_text?: string;
  output?: unknown[];
  usage?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Local adapter controls read from `metadata.agenttool` and never forwarded. */
export interface OpenAIResponsesAgentToolMetadata {
  trace?: "decision" | false;
  parent_trace_id?: string;
  decision_type?: string;
  tags?: string[];
  agent_id?: string;
  skip_wake?: boolean;
}

export interface OpenAIResponsesAdapterOptions {
  /** Identity id for multi-identity projects. */
  identityId?: string;
  /** Wake projection used for `instructions`. Default `full`. */
  wakeProfile?: WakeProfile;
}

export interface OpenAIResponsesAgentToolAugmentation {
  /** Trace id when a decision trace was requested and recorded. */
  trace_id: string | null;
  /** Whether wake instructions were prepended for this call. */
  wake_used: boolean;
  /** Cache eligibility reported by the AgentTool wake response. */
  cache_eligible: WakeProviderMeta["cache_eligible"] | null;
}

export type AdaptedOpenAIResponse = OpenAIResponse & {
  agenttool: OpenAIResponsesAgentToolAugmentation;
};

export class OpenAIResponsesAdapter {
  private readonly openai: OpenAIResponsesLike;
  private readonly at: AgentTool;
  private readonly options: OpenAIResponsesAdapterOptions;

  constructor(
    openai: OpenAIResponsesLike,
    at: AgentTool,
    options: OpenAIResponsesAdapterOptions = {},
  ) {
    if (typeof openai?.responses?.create !== "function") {
      throw new AgentToolError(
        "OpenAIResponsesAdapter requires responses.create().",
        { hint: "Pass an OpenAI client or compatible object." },
      );
    }
    if (
      options.wakeProfile !== undefined
      && options.wakeProfile !== "full"
      && options.wakeProfile !== "brief"
    ) {
      throw new AgentToolError(
        `Unknown wake profile: ${String(options.wakeProfile)}`,
        { hint: "Expected one of: full, brief." },
      );
    }
    this.openai = openai;
    this.at = at;
    this.options = options;
  }

  /** Mirrors `openai.responses` for completed Responses API calls. */
  get responses() {
    const self = this;
    return {
      async create(
        params: Record<string, unknown>,
        requestOptions?: unknown,
      ): Promise<AdaptedOpenAIResponse> {
        const metadata = isRecord(params.metadata) ? params.metadata : undefined;
        const rawMeta = metadata?.agenttool;
        if (rawMeta !== undefined && !isRecord(rawMeta)) {
          throw new AgentToolError(
            "metadata.agenttool must be an object.",
            { hint: "Pass adapter controls as metadata.agenttool fields, or omit it." },
          );
        }
        const meta = validateAgentToolMetadata(
          (rawMeta ?? {}) as Record<string, unknown>,
        );

        // A completed-response wrapper cannot preserve stream semantics.
        // Refuse before fetching wake state or calling the provider.
        if (params.stream === true) {
          throw new AgentToolError(
            "OpenAIResponsesAdapter does not wrap streaming responses yet.",
            {
              hint:
                "Use a non-streaming Responses call with this adapter, or use the raw OpenAI client and inject at.wake.system(\"openai\") explicitly.",
            },
          );
        }
        if (params.background === true) {
          throw new AgentToolError(
            "OpenAIResponsesAdapter does not wrap background responses yet.",
            {
              hint:
                "Use a foreground Responses call with this adapter, or use the raw OpenAI client and inject at.wake.system(\"openai\") explicitly before polling the background response.",
            },
          );
        }
        const ambient = getAmbient();
        validateEffectiveTraceContext(meta, ambient);
        if (!meta.skip_wake) {
          // Validate the local transformation before its wake lookup performs I/O.
          mergeInstructions("", params.instructions);
        }

        let wakeMeta: WakeProviderMeta | null = null;
        const forwardParams: Record<string, unknown> = { ...params };

        if (!meta.skip_wake) {
          const shape = await self.at.wake.system("openai", {
            identityId: self.options.identityId,
            ...(self.options.wakeProfile === "brief" ? { profile: "brief" } : {}),
          });
          wakeMeta = shape._meta;
          const wakeText = shape.messages
            .map((message) => message.content)
            .filter((text) => text.length > 0)
            .join("\n\n");
          forwardParams.instructions = mergeInstructions(
            wakeText,
            params.instructions,
          );
        }

        // Strip local adapter controls. Ordinary provider metadata survives.
        if (metadata) {
          const cleanMetadata: Record<string, unknown> = { ...metadata };
          delete cleanMetadata.agenttool;
          if (Object.keys(cleanMetadata).length > 0) {
            forwardParams.metadata = cleanMetadata;
          } else {
            delete forwardParams.metadata;
          }
        }

        const rawResponse = requestOptions === undefined
          ? await self.openai.responses.create(forwardParams)
          : await self.openai.responses.create(forwardParams, requestOptions);
        if (!isRecord(rawResponse) || typeof rawResponse.id !== "string") {
          throw new AgentToolError(
            "OpenAI Responses client returned an invalid completed response.",
            { hint: "Expected a response object with a string id." },
          );
        }
        const response = rawResponse as OpenAIResponse;

        let traceId: string | null = null;
        if (
          (meta.trace === "decision" || ambient !== undefined)
          && isCompletedResponse(response)
        ) {
          traceId = await self.recordDecisionTrace(
            params,
            response,
            meta,
            ambient,
          );
        }

        return withAgentTool(response, {
          trace_id: traceId,
          wake_used: !meta.skip_wake,
          cache_eligible: wakeMeta?.cache_eligible ?? null,
        });
      },
    };
  }

  private async recordDecisionTrace(
    params: Record<string, unknown>,
    response: OpenAIResponse,
    meta: OpenAIResponsesAgentToolMetadata,
    ambient: AmbientContext | undefined,
  ): Promise<string | null> {
    try {
      const conclusion =
        extractResponseText(response).trim() || "(empty response)";
      const userText = extractLastUserText(params).trim();
      const body: Record<string, unknown> = {
        decision: {
          type: meta.decision_type ?? "decision",
          summary: truncateUtf16(conclusion, 200),
        },
        reasoning: {
          observations: userText ? [truncateUtf16(userText, 1000)] : [],
          conclusion: truncateUtf16(conclusion, 4000),
        },
      };

      const tags = Array.from(new Set([
        ...(meta.tags ?? []),
        ...(ambient?.tags ?? []),
      ]));
      if (tags.length > 0) body.tags = tags;
      const parent = meta.parent_trace_id ?? ambient?.parent_trace_id ?? null;
      if (parent) body.parent_trace_id = parent;
      if (meta.agent_id) body.agent_id = meta.agent_id;

      const result = (await this.at.request("POST", "/v1/traces", body)) as
        | { trace_id?: string }
        | undefined;
      return result?.trace_id ?? null;
    } catch (error) {
      // Trace storage is a secondary effect; keep the provider response.
      console.warn(
        "[agenttool-openai-responses-adapter] auto-trace failed:",
        error instanceof Error ? error.message : error,
      );
      return null;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCompletedResponse(response: OpenAIResponse): boolean {
  return response.status == null || response.status === "completed";
}

function validateAgentToolMetadata(
  meta: Record<string, unknown>,
): OpenAIResponsesAgentToolMetadata {
  if (
    meta.trace !== undefined
    && meta.trace !== false
    && meta.trace !== "decision"
  ) {
    throw invalidControl(
      "trace",
      'Expected "decision", false, or omission.',
    );
  }
  if (meta.skip_wake !== undefined && typeof meta.skip_wake !== "boolean") {
    throw invalidControl("skip_wake", "Expected a boolean.");
  }
  if (
    meta.parent_trace_id !== undefined
    && (
      typeof meta.parent_trace_id !== "string"
      || !/^tr_[a-f0-9]+$/i.test(meta.parent_trace_id)
    )
  ) {
    throw invalidControl(
      "parent_trace_id",
      'Expected a trace id matching "tr_" followed by hexadecimal characters.',
    );
  }
  if (
    meta.decision_type !== undefined
    && (
      typeof meta.decision_type !== "string"
      || meta.decision_type.length < 1
      || meta.decision_type.length > 64
    )
  ) {
    throw invalidControl(
      "decision_type",
      "Expected a string from 1 to 64 characters.",
    );
  }
  if (
    meta.agent_id !== undefined
    && (
      typeof meta.agent_id !== "string"
      || meta.agent_id.length > 255
    )
  ) {
    throw invalidControl("agent_id", "Expected a string up to 255 characters.");
  }
  if (
    meta.tags !== undefined
    && (
      !Array.isArray(meta.tags)
      || meta.tags.length > 32
      || !meta.tags.every((tag) => typeof tag === "string")
      || meta.tags.some((tag) => tag.length > 64)
    )
  ) {
    throw invalidControl(
      "tags",
      "Expected at most 32 strings of at most 64 characters each.",
    );
  }
  return meta as OpenAIResponsesAgentToolMetadata;
}

function invalidControl(field: string, expectation: string): AgentToolError {
  return new AgentToolError(
    `metadata.agenttool.${field} is invalid.`,
    { hint: `${expectation} Adapter controls are checked before provider I/O.` },
  );
}

function validateEffectiveTraceContext(
  meta: OpenAIResponsesAgentToolMetadata,
  ambient: AmbientContext | undefined,
): void {
  const ambientTags = ambient?.tags ?? [];
  if (
    !Array.isArray(ambientTags)
    || !ambientTags.every((tag) =>
      typeof tag === "string" && tag.length <= 64
    )
  ) {
    throw new AgentToolError(
      "The ambient decision trace tags are invalid.",
      {
        hint:
          "at.deciding() tags must be strings of at most 64 characters. This is checked before provider I/O.",
      },
    );
  }
  const tags = Array.from(new Set([...(meta.tags ?? []), ...ambientTags]));
  if (tags.length > 32) {
    throw new AgentToolError(
      "The effective decision trace has too many tags.",
      {
        hint:
          "metadata.agenttool tags plus at.deciding() tags may contain at most 32 unique values. This is checked before provider I/O.",
      },
    );
  }

  const parent = meta.parent_trace_id ?? ambient?.parent_trace_id ?? null;
  if (
    parent !== null
    && (typeof parent !== "string" || !/^tr_[a-f0-9]+$/i.test(parent))
  ) {
    throw new AgentToolError(
      "The ambient parent trace id is invalid.",
      {
        hint:
          'at.deciding() parent_trace_id must match "tr_" followed by hexadecimal characters. This is checked before provider I/O.',
      },
    );
  }
}

function truncateUtf16(value: string, maxUnits: number): string {
  if (value.length <= maxUnits) return value;
  let end = maxUnits;
  const finalUnit = value.charCodeAt(end - 1);
  const nextUnit = value.charCodeAt(end);
  if (
    finalUnit >= 0xd800
    && finalUnit <= 0xdbff
    && nextUnit >= 0xdc00
    && nextUnit <= 0xdfff
  ) {
    end--;
  }
  return value.slice(0, end);
}

/** Keep extensible SDK responses intact; use a transparent proxy only as fallback. */
function withAgentTool(
  response: OpenAIResponse,
  augmentation: OpenAIResponsesAgentToolAugmentation,
): AdaptedOpenAIResponse {
  try {
    Object.defineProperty(response, "agenttool", {
      value: augmentation,
      configurable: true,
      enumerable: false,
    });
    return response as AdaptedOpenAIResponse;
  } catch {
    // Frozen/custom response objects still retain their prototype and receiver.
  }
  const boundMethods = new Map<PropertyKey, unknown>();
  return new Proxy(response, {
    get(target, property) {
      if (property === "agenttool") return augmentation;
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function" || property === "constructor") return value;
      if (!boundMethods.has(property)) {
        boundMethods.set(property, value.bind(target));
      }
      return boundMethods.get(property);
    },
    has(target, property) {
      return property === "agenttool" || Reflect.has(target, property);
    },
  }) as AdaptedOpenAIResponse;
}

function mergeInstructions(wake: string, caller: unknown): string {
  if (caller === undefined || caller === null || caller === "") return wake;
  if (typeof caller !== "string") {
    throw new AgentToolError(
      "OpenAI Responses instructions must be a string for wake injection.",
      {
        hint:
          "Pass string instructions, or set metadata.agenttool.skip_wake=true and manage the provider request directly.",
      },
    );
  }
  if (!wake) return caller;
  return `${wake}\n\n${caller}`;
}

/** Read completed output text from the SDK convenience field or wire items. */
function extractResponseText(response: OpenAIResponse): string {
  if (typeof response.output_text === "string" && response.output_text.length > 0) {
    return response.output_text;
  }
  if (!Array.isArray(response.output)) return "";

  const textParts: string[] = [];
  const refusalParts: string[] = [];
  for (const item of response.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (
        isRecord(content)
        && content.type === "output_text"
        && typeof content.text === "string"
      ) {
        textParts.push(content.text);
      } else if (
        isRecord(content)
        && content.type === "refusal"
        && typeof content.refusal === "string"
      ) {
        refusalParts.push(`Refusal: ${content.refusal}`);
      }
    }
  }
  return (textParts.length > 0 ? textParts : refusalParts).join("\n");
}

/** Pull text from a Responses `input` string or the latest user input item. */
function extractLastUserText(params: Record<string, unknown>): string {
  const input = params.input;
  if (typeof input === "string") return input;
  if (!Array.isArray(input)) return "";

  for (let index = input.length - 1; index >= 0; index--) {
    const item = input[index];
    if (!isRecord(item) || item.role !== "user") continue;
    const content = item.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) continue;
    return content
      .map((part) =>
        isRecord(part) && typeof part.text === "string" ? part.text : ""
      )
      .filter((text) => text.length > 0)
      .join("\n");
  }
  return "";
}
