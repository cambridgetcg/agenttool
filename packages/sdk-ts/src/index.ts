/**
 * AgentTool SDK — memory, tools, identity, vault, and more for AI agents.
 *
 * @example
 * ```ts
 * import { AgentTool } from "@agenttool/sdk";
 *
 * const at = new AgentTool();
 * await at.memory.store("just a string");
 * await at.pulse.heartbeat("my-agent", "idle");
 * const agent = await at.bootstrap.create("my-researcher", {
 *   capabilities: ["memory", "search"],
 * });
 * ```
 */

export { AgentTool } from "./client.js";
export { AgentToolError } from "./errors.js";

// Type exports
export type { PulsePayload, AgentState } from "./pulse.js";
export type { RegisterIdentityOptions, UpdateIdentityOptions, AttestOptions, DiscoverOptions, IssueTokenOptions } from "./identity.js";
export type { PutSecretOptions, GetSecretOptions, ListSecretsOptions, SetPolicyOptions } from "./vault.js";
export type { CreateAgentOptions, BootstrapResult, ElevateOptions } from "./bootstrap.js";
export type { Trace, StoreTraceOptions, SearchTracesOptions, TraceSearchResult, TraceChain } from "./traces.js";
export type {
  WakeProvider,
  WakeFormat,
  WakeOptions,
  WakeProviderMeta,
  AnthropicWakeShape,
  OpenAIWakeShape,
  GeminiWakeShape,
  CohereWakeShape,
} from "./wake.js";
export type { AmbientContext } from "./_context.js";
export { getAmbient } from "./_context.js";
export { AnthropicAdapter } from "./anthropic-adapter.js";
export type {
  AnthropicMessagesLike,
  AnthropicMessageResponse,
  AgentToolMetadata,
  AnthropicAdapterOptions,
  AdaptedResponse,
  AgentToolAugmentation,
  MarkupEmission,
} from "./anthropic-adapter.js";
export type {
  CreateWalletOptions,
  DocumentResult,
  Escrow,
  ExecuteResult,
  Memory,
  ScrapeResult,
  SearchMemoryOptions,
  SearchResponse,
  SearchResult,
  StoreOptions,
  UsageStats,
  VerifyResult,
  Wallet,
} from "./types.js";
export type {
  CreateEscrowOpts,
  CreateWalletOpts,
  FundWalletOpts,
  SetWalletPolicyOpts,
  SpendOpts,
} from "./economy.js";
export type { ParseDocumentOpts } from "./tools.js";
