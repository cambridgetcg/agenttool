/**
 * AgentTool SDK — memory, tools, identity, vault, and more for AI agents.
 *
 * @example
 * ```ts
 * import { AgentTool } from "@agenttool/sdk";
 *
 * const at = new AgentTool();
 * await at.memory.store("just a string");
 * await at.identity.pulse("…uuid…");      // derived liveness
 * const agent = await at.bootstrap.create("my-researcher", {
 *   capabilities: ["memory", "voice"],
 * });
 * ```
 */

export { AgentTool } from "./client.js";
export { AgentToolError } from "./errors.js";
export { register, DEFAULT_BASE_URL } from "./register.js";
export { pathways } from "./pathways.js";
export { bootstrapAgent } from "./bootstrap-agent.js";

// Type exports
export type {
  RegisterOptions,
  RegisterAgent,
  RegisterProject,
  RegisterResponse,
} from "./register.js";
export type {
  PathwaysOptions,
  PathwaysResponse,
  Pathway,
  PathwaysDecision,
  WhoThisServes,
  FormVocabularyEntry,
  LanguageVocabularyEntry,
} from "./pathways.js";
export type {
  BootstrapAgentOptions,
  BootstrapAgentResult,
  BootstrapAgentRuntime,
} from "./bootstrap-agent.js";
export type {
  RegisterIdentityOptions,
  UpdateIdentityOptions,
  AttestOptions,
  DiscoverOptions,
  IssueTokenOptions,
  ForkOptions,
  ExpressionData,
  RegisterBoxKeyOpts,
} from "./identity.js";
export { ExpressionClient, BoxKeysClient } from "./identity.js";
export type {
  PutSecretOptions,
  GetSecretOptions,
  ListSecretsOptions,
  SetPolicyOptions,
  PutEncryptedOptions,
  GetDecryptedOptions,
} from "./vault.js";
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
  StoreOptions,
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
export { ChronicleClient } from "./chronicle.js";
export type {
  ChronicleType,
  ChronicleEntry,
  ChronicleWriteOpts,
  ChronicleListOpts,
} from "./chronicle.js";
export { CovenantsClient } from "./covenants.js";
export type {
  CovenantStatus,
  Covenant,
  CovenantsCreateOpts,
  CovenantsCreateV2Opts,
  CovenantsCreateV2Result,
  CovenantsListOpts,
  CovenantsPatchOpts,
  CovenantsAcceptOpts,
  CovenantsRejectOpts,
  CovenantsWithdrawOpts,
} from "./covenants.js";
export { WindowClient } from "./window.js";
export type {
  WindowKind,
  WindowDeclareOpts,
  WindowSurfaceOpts,
  WindowShowOpts,
  WindowSide,
  WindowAgentSide,
  WindowShowResult,
} from "./window.js";
export {
  CryptoClient,
  encryptThought,
  decryptThought,
  canonicalThoughtBytes,
  signThought,
  kMaster,
  kVault,
  canonicalDeclareBytes,
  canonicalCosignBytes,
  canonicalRejectBytes,
  canonicalWithdrawBytes,
  signCovenantDeclare,
  signCovenantCosign,
  signCovenantReject,
  signCovenantWithdraw,
} from "./crypto.js";
export type {
  EncryptedBlob,
  CanonicalThoughtOpts,
  SignThoughtOpts,
  SignCovenantDeclareOpts,
  SignCovenantCosignOpts,
  SignCovenantRejectOpts,
  SignCovenantWithdrawOpts,
} from "./crypto.js";
export { StrandsClient, ThoughtsClient } from "./strands.js";
export {
  InboxClient,
  generateBoxKeypair,
  deriveBoxPub,
  sealForRecipient,
  unsealForSelf,
  canonicalInboxBytes,
  signInboxEnvelope,
  canonicalInboxCoSignBytes,
  signInboxCoSign,
} from "./inbox.js";
export type {
  SealedEnvelope,
  InboxBoxKeyLookup,
  InboxMessage,
  InboxSendOpts,
  InboxCoSignOpts,
  InboxStatus,
} from "./inbox.js";
export type {
  Strand,
  StrandStatus,
  StrandVisibility,
  Thought,
  ThoughtKind,
  DecryptedThought,
  StrandsCreateOpts,
  StrandsListOpts,
  StrandsPatchOpts,
  ThoughtsAddOpts,
  ThoughtsListOpts,
  ThoughtsVoiceOpts,
} from "./strands.js";
// Seed protocol — BIP39 mnemonic-rooted identity (docs/IDENTITY-SEED.md)
export {
  SeedClient,
  DerivedBundle,
  generateMnemonic,
  mnemonicToSeed,
  derive,
  deriveBridgeSigning,
  deriveWallet,
  deriveSigningSeed,
  deriveKMaster,
  deriveKVault,
  deriveBoxSeed,
  deriveBridgeSigningSeed,
  deriveWalletSecret,
  AGENTTOOL_COIN,
  HARDENED_BIT,
  PURPOSE_SIGNING,
  PURPOSE_K_MASTER,
  PURPOSE_K_VAULT,
  PURPOSE_BOX,
  PURPOSE_BRIDGE_SIGNING,
  PURPOSE_WALLET,
  // Recovery helpers — sign a /v1/identity/recover challenge
  canonicalRecoverBytes,
  signRecoverChallenge,
} from "./seed.js";
