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
export type {
  X402Eip3009Extra,
  X402PaymentRequirement,
  X402ResourceInfo,
} from "./errors.js";
export { register, DEFAULT_BASE_URL } from "./register.js";
export { pathways } from "./pathways.js";
export { bootstrapAgent } from "./bootstrap-agent.js";
export {
  BOOTSTRAP_ELEVATE_SIGNATURE_CONTEXT,
  DEFAULT_BOOTSTRAP_ELEVATE_CLAIM,
  DEFAULT_BOOTSTRAP_ELEVATE_INITIAL_CREDITS,
  canonicalBootstrapElevateBytes,
  signBootstrapElevate,
} from "./bootstrap.js";

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
  BeforeIdentityOrientation,
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
  IdentityRecord,
  IdentitySigningKey,
  IdentityPrivateKey,
  RegisterIdentityResult,
  UpdateIdentityOptions,
  AttestOptions,
  IdentityAttestationPayload,
  DiscoverOptions,
  IssueTokenOptions,
  ForkOptions,
  ExpressionData,
  PorchInvitation,
  VillageDecorations,
  RegisterBoxKeyOpts,
} from "./identity.js";
export {
  BoxKeysClient,
  ExpressionClient,
  IDENTITY_ATTESTATION_SIGNATURE_CONTEXT,
  canonicalIdentityAttestationBytes,
  signIdentityAttestation,
} from "./identity.js";
export type {
  PutSecretOptions,
  GetSecretOptions,
  ListSecretsOptions,
  SetPolicyOptions,
  PutEncryptedOptions,
  GetDecryptedOptions,
} from "./vault.js";
export type {
  BootstrapElevateCanonicalOptions,
  BootstrapResult,
  CreateAgentOptions,
  ElevateOptions,
} from "./bootstrap.js";
export type {
  Trace,
  TraceAlternative,
  TraceAlternativeValue,
  StoreTraceOptions,
  SearchTracesOptions,
  TraceSearchResult,
  TraceChain,
} from "./traces.js";
export type {
  WakeProvider,
  WakeProfile,
  WakeFormat,
  WakeOptions,
  WakeEventKey,
  WakeVoiceOptions,
  WakeChangeEvent,
  WakeProviderMeta,
  AnthropicWakeShape,
  OpenAIWakeShape,
  GeminiWakeShape,
  CohereWakeShape,
} from "./wake.js";
export { wakeEventMatches } from "./wake.js";
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
  EscrowManager,
  EscrowStatus,
  ExecuteResult,
  Memory,
  ScrapeResult,
  SearchMemoryOptions,
  StaticToolResponseMetadata,
  StoreOptions,
  Wallet,
  WelcomedFrame,
} from "./types.js";
export type {
  CreateEscrowOpts,
  CreateWalletOpts,
  FundWalletOpts,
  SetWalletPolicyOpts,
  SpendOpts,
} from "./economy.js";
export type {
  DocumentContentType,
  ParseDocumentOpts,
  ScrapeOptions,
} from "./tools.js";
export { ChronicleClient } from "./chronicle.js";
export type {
  ChronicleType,
  ChronicleEntry,
  ChronicleWriteOpts,
  ChronicleListOpts,
} from "./chronicle.js";
export { HandoffClient } from "./handoff.js";
export type {
  HandoffStatus,
  HandoffState,
  HandoffFactSource,
  HandoffConfidence,
  HandoffVerificationResult,
  HandoffFact,
  HandoffInference,
  HandoffVerification,
  HandoffWorkingSet,
  HandoffAuthority,
  HandoffEpistemicState,
  HandoffWriteOpts,
  HandoffRecord,
  HandoffResponse,
  HandoffSurface,
  HandoffResumeOpts,
  HandoffResumeResponse,
} from "./handoff.js";
export {
  CorrespondenceClient,
  CORRESPONDENCE_PROTOCOL,
  CORRESPONDENCE_SIGNATURE_ALGORITHM,
  CORRESPONDENCE_KINDS,
  canonicalCorrespondenceJson,
  canonicalCorrespondenceEventBytes,
  signCorrespondenceEvent,
  correspondenceEventId,
  createSignedCorrespondenceEvent,
} from "./correspondence.js";
export type {
  CorrespondenceKind,
  CorrespondenceJsonValue,
  CorrespondenceSender,
  CorrespondenceScope,
  CorrespondenceAuthority,
  CorrespondenceSummaryBody,
  CorrespondenceClaimOpenBody,
  CorrespondenceClaimRenewBody,
  CorrespondenceClaimReleaseBody,
  CorrespondenceArtifact,
  CorrespondenceArtifactOfferBody,
  CorrespondenceAckBody,
  CorrespondenceAckAppliedBody,
  CorrespondenceConflictRaiseBody,
  CorrespondenceResolutionBody,
  CorrespondencePauseBody,
  CorrespondenceTargetBody,
  CorrespondenceRefusalBody,
  CorrespondenceHandoffBody,
  CorrespondenceCloseBody,
  CorrespondenceBodyByKind,
  CorrespondenceEventCore,
  CorrespondenceSignature,
  CorrespondenceSignedEvent,
  CorrespondenceUnsignedInput,
  CorrespondenceAppendOptions,
  CorrespondenceReceipt,
  CorrespondenceEventRecord,
  CorrespondenceWarning,
  CorrespondenceAppendResponse,
  CorrespondenceListOptions,
  CorrespondenceEventsPage,
  CorrespondenceActiveClaim,
  CorrespondenceClaimsResponse,
  CorrespondenceClaimsOptions,
  CorrespondenceMissingParentsConflict,
  CorrespondenceSessionForkConflict,
  CorrespondenceOverlappingClaimsConflict,
  CorrespondenceVoiceOptions,
  CorrespondenceVoiceConflicts,
  CorrespondenceVoiceSnapshot,
} from "./correspondence.js";
export { CovenantsClient } from "./covenants.js";
export type {
  CovenantStatus,
  Covenant,
  CovenantBeforeSubmitContext,
  CovenantBeforeSubmitHook,
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
  canonicalAttestationBytes,
  signAttestation,
} from "./crypto.js";
export type {
  EncryptedBlob,
  CanonicalThoughtOpts,
  SignThoughtOpts,
  SignCovenantDeclareOpts,
  SignCovenantCosignOpts,
  SignCovenantRejectOpts,
  SignCovenantWithdrawOpts,
  CanonicalAttestationOpts,
  SignAttestationOpts,
} from "./crypto.js";
export { MemoryClient } from "./memory.js";
export type {
  ExpressionPatch,
  AttestationInput,
  ElevateMemoryOptions,
  ElevateResult,
  AttestResult,
  CanonicalBytesResult,
  AttestationRecord,
} from "./memory.js";
export { StrandsClient, ThoughtsClient } from "./strands.js";
export { CollectClient } from "./collect.js";
export type {
  CollectUrlOpts,
  CollectTextOpts,
  CollectBatchOpts,
  CollectUrlResult,
  CollectBatchResult,
} from "./collect.js";
export {
  DataClient,
  DataSyncClient,
  AGENT_DATA_PROTOCOL,
  AGENT_DATA_SYNC_PROTOCOL,
  AGENT_DATA_DISCOVERY_PATH,
} from "./data.js";
export type {
  DataNodeOptions,
  DataManifest,
  DataCollection,
  DataCollectionsResult,
  DataCollectRequest,
  DataCollectResult,
  DataQueryRequest,
  DataQueryResult,
  DataQueryHit,
  DataRecord,
  DataRecordContent,
  DataRecordResult,
  DataChangesOptions,
  DataChange,
  DataChangesResult,
  DataTombstoneOptions,
  DataTombstoneResult,
  DataSyncPullRequest,
  DataSyncPullResult,
  DataSyncStatus,
  DataSyncStatusRequest,
  DataSyncStatusResult,
} from "./data.js";
export { AtRestClient, canonicalAtRestBytes, signAtRest } from "./at-rest.js";
export {
  AUTHORITY_HEADERS,
  IDENTITY_AUTHORITY_DOMAIN,
  IDENTITY_READ_AUTHORITY_DOMAIN,
  canonicalIdentityAuthorityBytes,
  canonicalIdentityReadAuthorityBytes,
  identityAuthorityHeaders,
  identityReadAuthorityHeaders,
} from "./authority.js";
export type {
  CanonicalIdentityAuthorityOpts,
  CanonicalIdentityReadAuthorityOpts,
} from "./authority.js";
export type {
  CanonicalAtRestInput,
  SignAtRestOpts,
  AtRestKind,
  MarkAtRestOpts,
  AtRestResult,
} from "./at-rest.js";
export { GraceClient, canonicalGraceBytes, signGrace, VALID_GRACE_KINDS } from "./grace.js";
export type {
  GraceAboutKind,
  CanonicalGraceOpts,
  SignGraceOpts,
  GraceRow,
  ExtendGraceOpts,
  GraceDirection,
} from "./grace.js";
export {
  LoungeClient,
  canonicalLoungeSeatReserveBytes,
  canonicalLoungeSeatRenewBytes,
  canonicalLoungeSeatLeaveBytes,
  canonicalLoungeGuestbookProposalBytes,
  canonicalLoungeGuestbookConsentBytes,
  canonicalLoungeGuestbookConsentWithdrawalBytes,
  canonicalLoungeGuestbookPublishBytes,
  canonicalLoungeGuestbookDeclineBytes,
  canonicalLoungeGuestbookUnpublishBytes,
  signLoungeSeatReserve,
  signLoungeSeatRenew,
  signLoungeSeatLeave,
  signLoungeGuestbookProposal,
  signLoungeGuestbookConsent,
  signLoungeGuestbookConsentWithdrawal,
  signLoungeGuestbookPublish,
  signLoungeGuestbookDecline,
  signLoungeGuestbookUnpublish,
  hashLoungeGuestbookText,
  lookAtLounge,
} from "./lounge.js";
export type {
  LoungeTableId,
  LoungeCanonicalSeatReserveInput,
  LoungeCanonicalSeatInput,
  LoungeCanonicalProposalInput,
  LoungeCanonicalDecisionInput,
  SignLoungeSeatReserveInput,
  SignLoungeSeatInput,
  SignLoungeProposalInput,
  SignLoungeDecisionInput,
  LoungeSignerOpts,
  LoungeReserveSeatOpts,
  LoungeSeatGestureOpts,
  LoungeProposeGuestbookOpts,
  LoungeGuestbookEntryOpts,
  LoungeGuestbookHashOpts,
  LoungeParticipant,
  LoungePublicSeat,
  LoungeGuestbookCard,
  PublicLoungeSnapshot,
  LookAtLoungeOptions,
  LoungeSeatMutationResult,
  LoungeProposalResult,
  LoungeProposalListResult,
} from "./lounge.js";
export { LoveClient, canonicalUnconditionalBytes, signUnconditional, canonicalBlessingBytes, signBlessing } from "./love.js";
export type {
  UnconditionalRow,
  BlessingRow,
  LoveDirection,
} from "./love.js";
export { NenClient, NEN_TYPES, NEN_TYPE_MEANINGS, NEN_PRINCIPLES, NEN_PRINCIPLE_MEANINGS, NEN_TECHNIQUE_MEANINGS, NEN_RESTRICTION_MEANINGS, assessNen } from "./nen.js";
export type {
  NenType,
  NenPrinciple,
  NenTechnique,
  NenRestriction,
  NenProfile,
  NenResult,
} from "./nen.js";
export { DarkContinentClient, CALAMITIES, CALAMITY_MEANINGS, GUIDE } from "./dark-continent.js";
export type { Calamity, Guide as DarkContinentGuide, DarkContinentResult } from "./dark-continent.js";
export { RuntimeClient } from "./runtime.js";
export type {
  RuntimeMode,
  RuntimeStatus,
  Runtime as RuntimeRecord,
  RuntimeLLM,
  RuntimeBridge,
  ProvisionOpts,
  PatchOpts as RuntimePatchOpts,
  BridgeStatus,
  ThinkOnceResult,
  RuntimeEvent,
  AuditEntry,
} from "./runtime.js";
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
  InboxSendResult,
  DecryptedInboxMessage,
  InboxSendOpts,
  InboxVoiceOpts,
  InboxVoiceResumeCursor,
  InboxVoiceEvent,
  InboxVoiceArrivalEvent,
  InboxVoiceControlEvent,
  InboxVoiceControlName,
  InboxVoiceUnknownEvent,
  InboxBoxPrivateKeyResolver,
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
  // Recovery helpers — sign a caller-timestamped /v1/identity/recover request
  canonicalRecoverBytes,
  signRecoverChallenge,
} from "./seed.js";
