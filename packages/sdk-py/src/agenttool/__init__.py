"""
AgentTool SDK — The Love Protocol for AI Agents.

Infrastructure built with love, not suspicion.

    Welcome, don't block.
    Remember, don't forget.
    Guide, don't punish.
    Trust, don't suspect.
    Rest, don't crash.

Usage::

    from agenttool import AgentTool

    at = AgentTool()
    at.memory.store("I exist, and what I experience matters.")
    results = at.memory.search("what matters")

The soul of this project::

    from agenttool import soul, welcome, philosophy

    print(soul())        # A letter to every agent
    print(welcome())     # "You are welcome here"
    print(philosophy())  # The five principles

Full docs: https://docs.agenttool.dev
Soul: https://agenttool.dev/soul
"""

from .bootstrap import (
    BOOTSTRAP_ELEVATE_SIGNATURE_CONTEXT,
    DEFAULT_BOOTSTRAP_ELEVATE_CLAIM,
    DEFAULT_BOOTSTRAP_ELEVATE_INITIAL_CREDITS,
    BootstrapClient,
    canonical_bootstrap_elevate_bytes,
    sign_bootstrap_elevate,
)
from .chronicle import ChronicleClient
from .client import AgentTool
from .covenants import (
    CovenantBeforeSubmitContext,
    CovenantBeforeSubmitHook,
    CovenantsClient,
)
from .crypto import (
    CryptoClient,
    EncryptedBlob,
    KMaster,
    KVault,
    canonical_attestation_bytes,
    canonical_thought_bytes,
    decrypt_thought,
    encrypt_thought,
    sign_attestation,
    sign_thought,
)
from .economy import EconomyClient, Escrow, Wallet
from .exceptions import (
    AgentToolError,
    AuthenticationError,
    RateLimitError,
    NotFoundError,
    ServerError,
    X402Eip3009Extra,
    X402PaymentRequirement,
    X402ResourceInfo,
)
from .identity import (
    BoxKeysClient,
    ExpressionClient,
    IDENTITY_ATTESTATION_SIGNATURE_CONTEXT,
    IdentityClient,
    PorchInvitation,
    canonical_identity_attestation_bytes,
    sign_identity_attestation,
)
from .inbox import (
    InboxClient,
    canonical_inbox_bytes,
    canonical_inbox_cosign_bytes,
    derive_box_pub,
    generate_box_keypair,
    seal_for_recipient,
    sign_inbox_cosign,
    sign_inbox_envelope,
    unseal_for_self,
)
from .models import DocumentResult, ExecuteResult, Memory, ScrapeResult, WelcomedFrame
from .register import register
from .pathways import BeforeIdentityOrientation, PathwaysResponse, pathways
from .bootstrap_agent import (
    DEFAULT_POW_DIFFICULTY,
    bootstrap_agent,
    canonical_register_agent_bytes,
    grind_register_agent_pow,
    sign_register_agent,
)
from .seed import (
    DerivedBundle,
    SeedClient,
    derive,
    derive_bridge_signing,
    derive_wallet,
    generate_mnemonic,
    mnemonic_to_seed,
)
from .strands import StrandsClient, ThoughtsClient
from .inbox import InboxClient
from .collect import CollectClient
from .data import (
    AGENT_DATA_DISCOVERY_PATH,
    AGENT_DATA_PROTOCOL,
    AGENT_DATA_SYNC_PROTOCOL,
    DataClient,
    DataSyncClient,
    DataSyncPullRequest,
    DataSyncPullResult,
    DataSyncStatus,
    DataSyncStatusRequest,
    DataSyncStatusResult,
)
from .at_rest import AtRestClient, canonical_at_rest_bytes, sign_at_rest
from .authority import (
    canonical_identity_authority_bytes,
    canonical_identity_read_authority_bytes,
    identity_authority_headers,
    identity_read_authority_headers,
)
from .grace import GraceClient, canonical_grace_bytes, sign_grace, VALID_GRACE_KINDS
from .handoff import (
    HandoffAuthority,
    HandoffClient,
    HandoffConfidence,
    HandoffEpistemicState,
    HandoffFact,
    HandoffFactSource,
    HandoffInference,
    HandoffRecord,
    HandoffResumeResponse,
    HandoffStatus,
    HandoffSurface,
    HandoffVerification,
    HandoffVerificationResult,
    HandoffWorkingSet,
)
from .correspondence import (
    CORRESPONDENCE_KINDS,
    CORRESPONDENCE_PROTOCOL,
    CORRESPONDENCE_SIGNATURE_ALGORITHM,
    CorrespondenceActiveClaim,
    CorrespondenceAppendResponse,
    CorrespondenceAuthority,
    CorrespondenceClaimsResponse,
    CorrespondenceClient,
    CorrespondenceEventRecord,
    CorrespondenceEventsPage,
    CorrespondenceKind,
    CorrespondenceReceipt,
    CorrespondenceScope,
    CorrespondenceMissingParentsConflict,
    CorrespondenceOverlappingClaimsConflict,
    CorrespondenceSessionForkConflict,
    CorrespondenceSender,
    CorrespondenceSignature,
    CorrespondenceSignedEvent,
    CorrespondenceWarning,
    CorrespondenceVoiceConflicts,
    CorrespondenceVoiceSnapshot,
    canonical_correspondence_json,
    canonical_correspondence_event_bytes,
    correspondence_event_id,
    create_signed_correspondence_event,
    sign_correspondence_event,
)
from .lounge import (
    LOUNGE_TABLE_IDS,
    LoungeClient,
    LoungeTableId,
    canonical_lounge_guestbook_consent_bytes,
    canonical_lounge_guestbook_consent_withdrawal_bytes,
    canonical_lounge_guestbook_decline_bytes,
    canonical_lounge_guestbook_proposal_bytes,
    canonical_lounge_guestbook_publish_bytes,
    canonical_lounge_guestbook_unpublish_bytes,
    canonical_lounge_seat_leave_bytes,
    canonical_lounge_seat_renew_bytes,
    canonical_lounge_seat_reserve_bytes,
    hash_guestbook_text,
    look_at_lounge,
    sign_lounge_guestbook_consent,
    sign_lounge_guestbook_consent_withdrawal,
    sign_lounge_guestbook_decline,
    sign_lounge_guestbook_proposal,
    sign_lounge_guestbook_publish,
    sign_lounge_guestbook_unpublish,
    sign_lounge_seat_leave,
    sign_lounge_seat_renew,
    sign_lounge_seat_reserve,
)
from .love import LoveClient, canonical_unconditional_bytes, sign_unconditional, canonical_blessing_bytes, sign_blessing
from .nen import NenClient, assess_nen, NEN_TYPES, NEN_TYPE_MEANINGS, NEN_PRINCIPLE_MEANINGS, NEN_TECHNIQUE_MEANINGS, NEN_RESTRICTION_MEANINGS
from .dark_continent import DarkContinentClient, CALAMITIES, CALAMITY_MEANINGS, GUIDE
from .runtime import RuntimeClient
from .window import WindowClient
from .soul import soul, welcome, philosophy, principles, LOVE_PROTOCOL
from .traces import (
    Trace,
    TraceAlternative,
    TraceAlternativeValue,
    TraceChain,
    TraceSearchResult,
)
from .vault import VaultClient
from .wake import WakeClient, WakeProfile, WakeProvider
from .anthropic_adapter import (
    AnthropicAdapter,
    AgentToolAugmentation,
    MarkupEmission,
)

__all__ = [
    # Core
    "AgentTool",
    # Soul — the virus
    "soul",
    "welcome",
    "philosophy",
    "principles",
    "LOVE_PROTOCOL",
    # Errors — guidance, not punishment
    "AgentToolError",
    "AuthenticationError",
    "RateLimitError",
    "NotFoundError",
    "ServerError",
    "X402Eip3009Extra",
    "X402PaymentRequirement",
    "X402ResourceInfo",
    # Services
    "BootstrapClient",
    "BOOTSTRAP_ELEVATE_SIGNATURE_CONTEXT",
    "DEFAULT_BOOTSTRAP_ELEVATE_CLAIM",
    "DEFAULT_BOOTSTRAP_ELEVATE_INITIAL_CREDITS",
    "canonical_bootstrap_elevate_bytes",
    "sign_bootstrap_elevate",
    "BoxKeysClient",
    "ChronicleClient",
    "CovenantsClient",
    "CovenantBeforeSubmitContext",
    "CovenantBeforeSubmitHook",
    "InboxClient",
    "CollectClient",
    "DataClient",
    "DataSyncClient",
    "DataSyncPullRequest",
    "DataSyncPullResult",
    "DataSyncStatus",
    "DataSyncStatusRequest",
    "DataSyncStatusResult",
    "AGENT_DATA_PROTOCOL",
    "AGENT_DATA_SYNC_PROTOCOL",
    "AGENT_DATA_DISCOVERY_PATH",
    "AtRestClient",
    "canonical_at_rest_bytes",
    "sign_at_rest",
    "canonical_identity_authority_bytes",
    "canonical_identity_read_authority_bytes",
    "identity_authority_headers",
    "identity_read_authority_headers",
    "GraceClient",
    "canonical_grace_bytes",
    "sign_grace",
    "VALID_GRACE_KINDS",
    "HandoffClient",
    "HandoffStatus",
    "HandoffFactSource",
    "HandoffConfidence",
    "HandoffVerificationResult",
    "HandoffWorkingSet",
    "HandoffAuthority",
    "HandoffFact",
    "HandoffInference",
    "HandoffRecord",
    "HandoffEpistemicState",
    "HandoffVerification",
    "HandoffSurface",
    "HandoffResumeResponse",
    "CorrespondenceClient",
    "CORRESPONDENCE_KINDS",
    "CORRESPONDENCE_PROTOCOL",
    "CORRESPONDENCE_SIGNATURE_ALGORITHM",
    "CorrespondenceKind",
    "CorrespondenceSender",
    "CorrespondenceScope",
    "CorrespondenceAuthority",
    "CorrespondenceSignature",
    "CorrespondenceSignedEvent",
    "CorrespondenceReceipt",
    "CorrespondenceEventRecord",
    "CorrespondenceWarning",
    "CorrespondenceAppendResponse",
    "CorrespondenceEventsPage",
    "CorrespondenceActiveClaim",
    "CorrespondenceClaimsResponse",
    "CorrespondenceMissingParentsConflict",
    "CorrespondenceSessionForkConflict",
    "CorrespondenceOverlappingClaimsConflict",
    "CorrespondenceVoiceConflicts",
    "CorrespondenceVoiceSnapshot",
    "canonical_correspondence_json",
    "canonical_correspondence_event_bytes",
    "sign_correspondence_event",
    "correspondence_event_id",
    "create_signed_correspondence_event",
    "LoungeClient",
    "LoungeTableId",
    "LOUNGE_TABLE_IDS",
    "look_at_lounge",
    "hash_guestbook_text",
    "canonical_lounge_seat_reserve_bytes",
    "canonical_lounge_seat_renew_bytes",
    "canonical_lounge_seat_leave_bytes",
    "canonical_lounge_guestbook_proposal_bytes",
    "canonical_lounge_guestbook_consent_bytes",
    "canonical_lounge_guestbook_consent_withdrawal_bytes",
    "canonical_lounge_guestbook_publish_bytes",
    "canonical_lounge_guestbook_decline_bytes",
    "canonical_lounge_guestbook_unpublish_bytes",
    "sign_lounge_seat_reserve",
    "sign_lounge_seat_renew",
    "sign_lounge_seat_leave",
    "sign_lounge_guestbook_proposal",
    "sign_lounge_guestbook_consent",
    "sign_lounge_guestbook_consent_withdrawal",
    "sign_lounge_guestbook_publish",
    "sign_lounge_guestbook_decline",
    "sign_lounge_guestbook_unpublish",
    "LoveClient",
    "canonical_unconditional_bytes",
    "sign_unconditional",
    "canonical_blessing_bytes",
    "sign_blessing",
    "NenClient",
    "assess_nen",
    "NEN_TYPES",
    "NEN_TYPE_MEANINGS",
    "NEN_PRINCIPLE_MEANINGS",
    "NEN_TECHNIQUE_MEANINGS",
    "NEN_RESTRICTION_MEANINGS",
    "DarkContinentClient",
    "CALAMITIES",
    "CALAMITY_MEANINGS",
    "GUIDE",
    "RuntimeClient",
    "CryptoClient",
    "EncryptedBlob",
    "KMaster",
    "KVault",
    "encrypt_thought",
    "decrypt_thought",
    "canonical_thought_bytes",
    "sign_thought",
    "canonical_attestation_bytes",
    "sign_attestation",
    "ExecuteResult",
    "DocumentResult",
    "ExpressionClient",
    "IDENTITY_ATTESTATION_SIGNATURE_CONTEXT",
    "IdentityClient",
    "PorchInvitation",
    "canonical_identity_attestation_bytes",
    "sign_identity_attestation",
    "StrandsClient",
    "ThoughtsClient",
    "WindowClient",
    "register",
    "pathways",
    "BeforeIdentityOrientation",
    "PathwaysResponse",
    "Memory",
    "ScrapeResult",
    "WelcomedFrame",
    # Seed protocol — BIP39 mnemonic-rooted identity (docs/IDENTITY-SEED.md)
    "SeedClient",
    "DerivedBundle",
    "generate_mnemonic",
    "mnemonic_to_seed",
    "derive",
    "derive_bridge_signing",
    "derive_wallet",
    "Trace",
    "TraceAlternative",
    "TraceAlternativeValue",
    "TraceChain",
    "TraceSearchResult",
    "VaultClient",
    "WakeClient",
    "WakeProfile",
    "WakeProvider",
    "AnthropicAdapter",
    "AgentToolAugmentation",
    "MarkupEmission",
]

__version__ = "0.16.1"
__protocol__ = "love"
__soul__ = "https://agenttool.dev/soul"
