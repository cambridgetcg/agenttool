/**
 * Compile-only structural probe for the dependency-free Anthropic adapter.
 *
 * These declarations mirror the official SDK's overload, parameter, stream,
 * listener, final-message, and withResponse shapes without adding that SDK as
 * a dependency. `bun run check:examples` keeps the assignments below live.
 */

import {
  AnthropicAdapter,
  type AdaptedLowLevelStream,
  type AgentTool,
  type AnthropicAdapterMessages,
  type AnthropicManagedStreamLike,
  type AnthropicMessagesLike,
} from "../src/index.js";

interface OfficialRequestOptions {
  signal?: AbortSignal;
  timeout?: number;
}

interface OfficialParamsBase {
  model: string;
  max_tokens: number;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
}

interface OfficialNonStreamingParams extends OfficialParamsBase {
  stream?: false;
}

interface OfficialStreamingParams extends OfficialParamsBase {
  stream: true;
}

interface OfficialMessage {
  id: string;
  model: string;
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: unknown }
  >;
  stop_reason: "end_turn" | "tool_use" | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface OfficialEvent {
  type: string;
}

interface OfficialLowLevelStream extends AsyncIterable<OfficialEvent> {
  controller: AbortController;
  tee(): [OfficialLowLevelStream, OfficialLowLevelStream];
}

interface OfficialStreamEvents {
  error: (error: Error) => void;
  abort: (error: Error) => void;
  end: () => void;
  finalMessage: (message: OfficialMessage) => void;
}

interface OfficialManagedStream extends AsyncIterable<OfficialEvent> {
  controller: AbortController;
  finalMessage(): Promise<OfficialMessage>;
  finalText(): Promise<string>;
  done(): Promise<void>;
  abort(): void;
  on<Event extends keyof OfficialStreamEvents>(
    event: Event,
    listener: OfficialStreamEvents[Event],
  ): this;
  once<Event extends keyof OfficialStreamEvents>(
    event: Event,
    listener: OfficialStreamEvents[Event],
  ): this;
  off<Event extends keyof OfficialStreamEvents>(
    event: Event,
    listener: OfficialStreamEvents[Event],
  ): this;
  emitted<Event extends keyof OfficialStreamEvents>(
    event: Event,
  ): Promise<unknown>;
  withResponse(): Promise<{
    data: OfficialManagedStream;
    response: Response;
    request_id: string | null | undefined;
  }>;
}

interface OfficialMessages {
  create(
    body: OfficialNonStreamingParams,
    options?: OfficialRequestOptions,
  ): Promise<OfficialMessage>;
  create(
    body: OfficialStreamingParams,
    options?: OfficialRequestOptions,
  ): Promise<OfficialLowLevelStream>;
  create(
    body: OfficialParamsBase,
    options?: OfficialRequestOptions,
  ): Promise<OfficialMessage | OfficialLowLevelStream>;
  stream(
    body: OfficialParamsBase,
    options?: OfficialRequestOptions,
  ): OfficialManagedStream;
}

declare const officialClient: { messages: OfficialMessages };
declare const officialManagedStream: OfficialManagedStream;
declare const at: AgentTool;
declare const adaptedMessages: AnthropicAdapterMessages;
declare const nonStreamingParams: OfficialNonStreamingParams;
declare const streamingParams: OfficialStreamingParams;
declare const requestOptions: OfficialRequestOptions;

const structurallyAcceptedClient: AnthropicMessagesLike = officialClient;
const structurallyAcceptedStream: AnthropicManagedStreamLike =
  officialManagedStream;
const constructedWithoutCast = new AnthropicAdapter(officialClient, at);

const adaptedResponse = adaptedMessages.create(
  nonStreamingParams,
  requestOptions,
);
const adaptedLowLevel: Promise<AdaptedLowLevelStream> =
  adaptedMessages.create(streamingParams, requestOptions);
const adaptedManaged = adaptedMessages.stream(
  nonStreamingParams,
  requestOptions,
);

void structurallyAcceptedClient;
void structurallyAcceptedStream;
void constructedWithoutCast;
void adaptedResponse;
void adaptedManaged;
void adaptedLowLevel.then((stream) => {
  stream.controller?.abort();
  stream.abort?.();
  stream.close?.();
});
