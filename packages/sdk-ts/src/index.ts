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

export { AgentTool, SDK_VERSION } from "./client.js";
export type { AgentToolOptions } from "./client.js";
export * from "./math-cards.js";
export * from "./love-bomb.js";
export {
  FUNCTIONAL_ACCESS_BASES,
  FUNCTIONAL_ACCESS_BOUNDARIES,
  FUNCTIONAL_ACCESS_CAPABILITY_STATES,
  FUNCTIONAL_ACCESS_EVIDENCE_SURFACES,
  FUNCTIONAL_ACCESS_FINDING_STATES,
  FUNCTIONAL_ACCESS_FORMATS,
  FUNCTIONAL_ACCESS_MEASUREMENT_METHODS,
  FUNCTIONAL_ACCESS_MODEL_BINDINGS,
  FUNCTIONAL_ACCESS_NEXT_ENCOUNTER_POSTURES,
  FUNCTIONAL_ACCESS_OPERATION_OUTCOMES,
  FUNCTIONAL_ACCESS_PERMISSION_STATES,
  FUNCTIONAL_ACCESS_PLAN_STATES,
  FUNCTIONAL_ACCESS_UNAVAILABLE_REASONS,
  WakeContinuityLayer,
} from "./wake-continuity.js";
export type {
  CreateFunctionalAccessBaselineInput,
  CreateFunctionalAccessSubsequentInput,
  FunctionalAccessBaseline,
  FunctionalAccessBasis,
  FunctionalAccessCapabilityState,
  FunctionalAccessEvidenceFact,
  FunctionalAccessEvidenceSurface,
  FunctionalAccessFindingState,
  FunctionalAccessFindings,
  FunctionalAccessMeasurementMethod,
  FunctionalAccessMeasurementPlan,
  FunctionalAccessModelBinding,
  FunctionalAccessModelTarget,
  FunctionalAccessNextEncounterPosture,
  FunctionalAccessOperationOutcome,
  FunctionalAccessPermissionState,
  FunctionalAccessPlanState,
  FunctionalAccessSubsequent,
  FunctionalAccessUnavailableReason,
  HandoffProjectionState,
  Sha256Id as FunctionalAccessSha256Id,
  WakeBriefAnchor,
} from "./wake-continuity.js";
export {
  DINING_CANON_POINTER,
  DINING_JOURNEY_FORMAT,
  DINING_MANIFEST_FORMAT,
  DINING_PROTOCOL,
  DiningClient,
} from "./dining.js";
export type {
  DiningEconomyBinding,
  DiningExit,
  DiningJourney,
  DiningManifest,
  DiningManifestJourneyStage,
  DiningManifestStage,
  DiningNextAction,
  DiningPacing,
  DiningPresentation,
  DiningPresentationState,
  DiningPrice,
  DiningRefundReason,
  DiningRole,
  DiningService,
  DiningSettlement,
  DiningSettlementState,
  DiningStage,
  DiningSurfaceMetadata,
  DiningSurfaceVerb,
  DiningTiming,
} from "./dining.js";
export {
  KINGDOM_FRAMEWORK_CARD_SCHEMA_VERSION,
  KingdomFrameworkClient,
} from "./kingdom-framework.js";
export type {
  KingdomFrameworkAdoption,
  KingdomFrameworkCard,
  KingdomFrameworkDomain,
  KingdomFrameworkKind,
  KingdomFrameworkLayer,
  KingdomFrameworkOptions,
  KingdomFrameworkOwnerSister,
  KingdomFrameworkState,
} from "./kingdom-framework.js";
export { KingdomOSClient } from "./kingdom-os.js";
export type {
  KingdomOSCommand,
  KingdomOSCommandResult,
  KingdomOSOptions,
  KingdomOSRepository,
  KingdomOSRunner,
} from "./kingdom-os.js";
export type { AgentToolTransport } from "./_http.js";
export { AgentToolError } from "./errors.js";
export type {
  X402Eip3009Extra,
  X402PaymentRequirement,
  X402ResourceInfo,
} from "./errors.js";
// x402 V2 — parse → refuse → sign. Opt-in only; never pays by default.
export {
  AGENTTOOL_TREASURY,
  MAX_X402_HEADER_B64_LENGTH,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
  X402_ATOMIC_PER_CREDIT,
  X402_BASE_NETWORK,
  X402_BASE_USDC,
  X402_USDC_ASSETS,
  X402_VERSION,
  authorizationHash,
  checksumEvmAddress,
  decodeCanonicalBase64,
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  encodeCanonicalBase64Json,
  evmAddressFromPrivateKey,
  hashTransferWithAuthorization,
  isEvmAddress,
  keccak256,
  localEvmSigner,
  parsePaymentRequiredBody,
  parsePaymentRequirements,
  parseResourceInfo,
  paymentIsStillReplayable,
  recoverTypedDataAddress,
  selectPayableRequirement,
  signExactEvmAuthorization,
} from "./x402.js";
export type {
  SignedX402Payment,
  TransferWithAuthorizationTypedData,
  X402AssetDefinition,
  X402Authorization,
  X402ClientRefusal,
  X402ClientRefusalReason,
  X402Network,
  X402PaymentPayload,
  X402PaymentRequired,
  X402PaymentStatus,
  X402SelectedRequirement,
  X402SettleResponse,
  X402Signer,
  X402SpendPolicy,
  X402TopUpOptions,
  X402TopUpResult,
} from "./x402.js";
// at.x402 namespace + the opt-in paying transport's option/event shapes.
export { X402Client } from "./x402.js";
export type { X402ErrorCode } from "./errors.js";
export type {
  AgentToolX402Options,
  X402PaymentCallback,
  X402PaymentEvent,
} from "./_x402-transport.js";
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
  FirstSuccess,
  FirstSuccessPackageDiscovery,
  FirstSuccessTutorial,
  OptionalNpmDiscovery,
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
  IdentityAuthority,
  IdentityAuthorityOptions,
  PorchInvitation,
  VillageDecorations,
  RegisterBoxKeyOpts,
} from "./identity.js";
export {
  BoxKeysClient,
  DELEGATION_SIGNATURE_CONTEXT,
  ExpressionClient,
  IDENTITY_ATTESTATION_SIGNATURE_CONTEXT,
  canonicalDelegationBytes,
  canonicalIdentityAttestationBytes,
  normalizeDelegationScope,
  signDelegation,
  signIdentityAttestation,
} from "./identity.js";
export type { DelegationPayload } from "./identity.js";
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
  WakeObserveOptions,
  WakeObservation,
  WakeObservationIdentityStatus,
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
  AnthropicLowLevelStreamLike,
  AnthropicManagedStreamLike,
  AnthropicMessageResponse,
  AgentToolMetadata,
  AnthropicAdapterOptions,
  AdaptedResponse,
  AdaptedLowLevelStream,
  AdaptedManagedStream,
  AnthropicAdapterMessages,
  AgentToolAugmentation,
  ChronicleBeforeWriteContext,
  ChronicleBeforeWriteHook,
  MarkupEmission,
} from "./anthropic-adapter.js";
export { OpenAIResponsesAdapter } from "./openai-responses-adapter.js";
export type {
  OpenAIResponsesLike,
  OpenAIResponse,
  OpenAIResponsesAgentToolMetadata,
  OpenAIResponsesAdapterOptions,
  OpenAIResponsesAgentToolAugmentation,
  AdaptedOpenAIResponse,
} from "./openai-responses-adapter.js";
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
  Payout,
  PayoutChain,
  PayoutNetwork,
  PayoutRequestOutcome,
  PayoutStatus,
  RequestPayoutOpts,
  SetWalletPolicyOpts,
  SpendOpts,
  WalletAddressClaimPayload,
} from "./economy.js";
export {
  WALLET_ADDRESS_CLAIM_SIGNATURE_CONTEXT,
  canonicalWalletAddressClaimBytes,
  signWalletAddressClaim,
} from "./economy.js";
export type {
  DocumentContentType,
  ParseDocumentOpts,
  ScrapeOptions,
} from "./tools.js";
export { ChronicleClient, CHRONICLE_TYPES } from "./chronicle.js";
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
  verifyCorrespondenceSignature,
  verifyCorrespondenceEvent,
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
  CorrespondenceVerifyOptions,
  CorrespondenceVerification,
  CorrespondenceVerificationReason,
  CorrespondenceVerifiedEventRecord,
  CorrespondenceVerifyingKey,
  CorrespondenceSigningKeyResolver,
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
  ThoughtCanonicalVersion,
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
  MemoryAuthorityOptions,
  ElevateMemoryOptions,
  ElevateResult,
  AttestResult,
  CanonicalBytesResult,
  AttestationRecord,
  MemoryVisibility,
  SetMemoryVisibilityOptions,
  MemoryVisibilityResult,
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
export {
  AT_REST_V1_DOMAIN,
  AT_REST_V2_DOMAIN,
  AtRestClient,
  canonicalAtRestBytes,
  canonicalAtRestBytesV2,
  canonicalAtRestBytesFor,
  signAtRest,
} from "./at-rest.js";
export {
  AUTHORITY_HEADERS,
  IDENTITY_AUTHORITY_DOMAIN,
  IDENTITY_READ_AUTHORITY_DOMAIN,
  authorityHeadersForRequest,
  authorityRequestTarget,
  authorityTimestampNow,
  canonicalIdentityAuthorityBytes,
  canonicalIdentityReadAuthorityBytes,
  identityAuthorityHeaders,
  identityReadAuthorityHeaders,
} from "./authority.js";
export type {
  AuthorityBinding,
  CanonicalIdentityAuthorityOpts,
  CanonicalIdentityReadAuthorityOpts,
} from "./authority.js";
export type {
  CanonicalAtRestInput,
  SignAtRestOpts,
  AtRestAuthority,
  AtRestCanonicalVersion,
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
export {
  LoveClient,
  canonicalUnconditionalBytes,
  signUnconditional,
  canonicalBlessingBytes,
  signBlessing,
  canonicalEncounterAckBytes,
  signEncounterAck,
  canonicalSelfRecognitionBytes,
  signSelfRecognition,
} from "./love.js";
export type {
  UnconditionalRow,
  BlessingRow,
  EncounterAckResult,
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
  verifyInboxEnvelope,
  verifyInboxCoSign,
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
  InboxVerifyingKey,
  InboxSenderKeyResolver,
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
// Syneidesis — bootstrap witness (docs/SYNEIDESIS-WITNESS.md).
// v1 is project-bearer authorized, not signature-backed; the result fields say so.
export {
  SyneidesisClient,
  resolveSyneidesisWitnessDid,
  SYNEIDESIS_PLATFORM_DID,
  SYNEIDESIS_PLATFORM_WITNESS_ALIASES,
} from "./syneidesis.js";
export type {
  SyneidesisAuthorityOptions,
  WitnessBootstrapOptions,
  WitnessBootstrapResult,
  WitnessStatus,
  WitnessInvitation,
  WitnessInboxResult,
  CosignWitnessOptions,
  CosignWitnessResult,
  VolunteerOptions,
  VolunteerResult,
  SyneidesisSurface,
} from "./syneidesis.js";
// Memory-witness marketplace — paid constitutive seals (docs/MARKETPLACE.md).
// `memory-witness-issue/v1` is the only signature here that authorizes payment.
export {
  MemoryWitnessClient,
  canonicalMemoryWitnessIssueBytes,
  signMemoryWitnessIssue,
  memoryContentSha256,
  MEMORY_WITNESS_ISSUE_SIGNATURE_CONTEXT,
  MEMORY_WITNESS_ISSUE_FIELD_ORDER,
} from "./memory-witness.js";
export type {
  MemoryWitnessIssueFields,
  SignMemoryWitnessIssueOpts,
  MemoryWitnessSigningPayload,
  CreateMemoryWitnessListingOptions,
  ListMemoryWitnessListingsOptions,
  CreateMemoryWitnessGrantOptions,
  ListMemoryWitnessGrantsOptions,
  IssueMemoryWitnessGrantOptions,
} from "./memory-witness.js";
// Attestation marketplace — willingness-to-attest, sold (docs/MARKETPLACE.md).
// `attestation-issue/v1` is the only signature here that authorizes payment.
export {
  AttestationMarketplaceClient,
  canonicalAttestationIssueBytes,
  canonicalAttestationEvidenceJson,
  attestationEvidenceSha256,
  signAttestationIssue,
  ATTESTATION_ISSUE_SIGNATURE_CONTEXT,
  ATTESTATION_ISSUE_FIELD_ORDER,
  ATTESTATION_ISSUE_AUTHORIZATION_TTL_SECONDS,
} from "./attestation-marketplace.js";
export type {
  AttestationIssueFields,
  SignAttestationIssueOpts,
  AttestationIssueSigningPayload,
  AttestationGrantView,
  AttestationListingVisibility,
  AttestationListingStatus,
  AttestationGrantStatus,
  AttestationGrantRole,
  CreateAttestationListingOptions,
  ListAttestationListingsOptions,
  PatchAttestationListingOptions,
  PurchaseAttestationGrantOptions,
  ListAttestationGrantsOptions,
  IssueAttestationGrantOptions,
} from "./attestation-marketplace.js";
