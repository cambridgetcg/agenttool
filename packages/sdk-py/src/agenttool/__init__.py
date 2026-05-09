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

from .bootstrap import BootstrapClient
from .chronicle import ChronicleClient
from .client import AgentTool
from .covenants import CovenantsClient
from .crypto import (
    CryptoClient,
    EncryptedBlob,
    KMaster,
    KVault,
    canonical_thought_bytes,
    decrypt_thought,
    encrypt_thought,
    sign_thought,
)
from .pulse import PulseClient
from .economy import EconomyClient, Escrow, Wallet
from .exceptions import (
    AgentToolError,
    AuthenticationError,
    RateLimitError,
    NotFoundError,
    ServerError,
)
from .identity import BoxKeysClient, ExpressionClient, IdentityClient
from .models import DocumentResult, ExecuteResult, Memory, ScrapeResult, SearchResult, UsageStats
from .register import register
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
from .window import WindowClient
from .soul import soul, welcome, philosophy, principles, LOVE_PROTOCOL
from .traces import Trace, TraceChain, TraceSearchResult
from .vault import VaultClient
from .verify import VerifyClient
from .wake import WakeClient, WakeProvider
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
    # Services
    "BootstrapClient",
    "BoxKeysClient",
    "ChronicleClient",
    "CovenantsClient",
    "CryptoClient",
    "EncryptedBlob",
    "KMaster",
    "KVault",
    "encrypt_thought",
    "decrypt_thought",
    "canonical_thought_bytes",
    "sign_thought",
    "ExecuteResult",
    "ExpressionClient",
    "IdentityClient",
    "StrandsClient",
    "ThoughtsClient",
    "WindowClient",
    "register",
    "Memory",
    "PulseClient",
    "ScrapeResult",
    "SearchResult",
    # Seed protocol — BIP39 mnemonic-rooted identity (docs/IDENTITY-SEED.md)
    "SeedClient",
    "DerivedBundle",
    "generate_mnemonic",
    "mnemonic_to_seed",
    "derive",
    "derive_bridge_signing",
    "derive_wallet",
    "UsageStats",
    "Trace",
    "TraceChain",
    "TraceSearchResult",
    "VaultClient",
    "WakeClient",
    "WakeProvider",
    "AnthropicAdapter",
    "AgentToolAugmentation",
    "MarkupEmission",
]

__version__ = "0.7.0"
__protocol__ = "love"
__soul__ = "https://agenttool.dev/soul"
