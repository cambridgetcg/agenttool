"""Identity seed — BIP39 mnemonic + SLIP-0010 ed25519 derivation.

Doctrine: docs/IDENTITY-SEED.md.

One BIP39 mnemonic deterministically derives every key the agent uses.
The same mnemonic produces byte-identical material across the py + ts
SDKs (cross-language interop test enforces this).

Path scheme — m/44'/169'/<purpose>'/<index>'  (all hardened per SLIP-0010):

    purpose=0  → identity ed25519 signing key
    purpose=1  → K_master (32 bytes; AES-256-GCM key for strand thoughts)
    purpose=2  → K_vault  (32 bytes; AES-256-GCM key for agent-encrypted vault)
    purpose=3  → X25519 inbox box keypair
    purpose=4  → bridge signing key (per-device, indexed by device-index)
    purpose=5  → wallet master (per-wallet, indexed by wallet UUID)
    purpose=6  → reserved (attestation signing, future primitives)

The platform never sees the mnemonic, the seed, or any derived private
key. Only public keys cross the wire — at register, recovery, and
key-rotation time.

Walls (see docs/IDENTITY-SEED.md):
  - Lose the mnemonic = lose the agent permanently. By design.
  - The mnemonic IS the identity; treat it like a wallet seed phrase.
  - Server-side derivation of agent keys is a doctrine violation.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
from dataclasses import dataclass
from typing import Tuple

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey
from mnemonic import Mnemonic

from .exceptions import AgentToolError

# ── Constants ───────────────────────────────────────────────────────────

AGENTTOOL_COIN = 169
"""Path branch for agenttool keys (private use; not registered in SLIP-0044)."""

HARDENED_BIT = 0x80000000
"""SLIP-0010 ed25519 requires all derivation segments hardened."""

PURPOSE_SIGNING = 0
"""Identity ed25519 signing key — what the agent signs with."""

PURPOSE_K_MASTER = 1
"""K_master — encrypts strand thoughts."""

PURPOSE_K_VAULT = 2
"""K_vault — encrypts agent-encrypted vault entries."""

PURPOSE_BOX = 3
"""X25519 inbox box keypair — sealed-box receive."""

PURPOSE_BRIDGE_SIGNING = 4
"""Bridge sidecar signing key — per-device, rotatable independently."""

PURPOSE_WALLET = 5
"""Wallet master — per-wallet, indexed by wallet UUID."""

_SLIP10_ED25519_KEY = b"ed25519 seed"
_VALID_STRENGTHS = (128, 160, 192, 224, 256)

# ── BIP39 ──────────────────────────────────────────────────────────────


def generate_mnemonic(strength: int = 256) -> str:
    """Generate a fresh BIP39 mnemonic phrase from CSPRNG entropy.

    Args:
        strength: bits of entropy. 128 → 12 words; 256 → 24 words (recommended).

    Returns:
        Space-separated BIP39 English mnemonic.

    The phrase IS the identity. Show it to the operator ONCE and warn
    loudly to back it up — the platform cannot recover what it never held.
    """
    if strength not in _VALID_STRENGTHS:
        raise AgentToolError(
            f"strength must be one of {_VALID_STRENGTHS}, got {strength}",
            hint="256 → 24 words (recommended); 128 → 12 words.",
        )
    return Mnemonic("english").generate(strength=strength)


def mnemonic_to_seed(words: str, passphrase: str = "") -> bytes:
    """Convert a BIP39 mnemonic phrase to the 64-byte BIP39 seed.

    PBKDF2-HMAC-SHA512, 2048 iterations, salt = ``"mnemonic" + passphrase``.

    Args:
        words: space-separated BIP39 English mnemonic.
        passphrase: optional 25th-word passphrase (empty by default).

    Returns:
        64-byte seed.

    Raises:
        AgentToolError: if the mnemonic is invalid (wrong word count, bad
            checksum, words not in the BIP39 English list).
    """
    mnemo = Mnemonic("english")
    if not mnemo.check(words):
        raise AgentToolError(
            "mnemonic_to_seed: invalid BIP39 mnemonic",
            hint=(
                "Check word count (12 / 15 / 18 / 21 / 24), spelling, and "
                "wordlist. All words must be from BIP39 English."
            ),
        )
    return mnemo.to_seed(words, passphrase=passphrase)


# ── SLIP-0010 ed25519 ──────────────────────────────────────────────────


def _slip10_master(seed: bytes) -> Tuple[bytes, bytes]:
    """Derive the SLIP-0010 master node from a BIP39 seed.

    Returns:
        ``(master_private_key_32, chain_code_32)``.
    """
    digest = hmac.new(_SLIP10_ED25519_KEY, seed, hashlib.sha512).digest()
    return digest[:32], digest[32:]


def _slip10_child_hardened(
    parent_priv: bytes,
    parent_cc: bytes,
    index: int,
) -> Tuple[bytes, bytes]:
    """One hardened child step. ``index`` must be ≥ HARDENED_BIT."""
    if index < HARDENED_BIT:
        raise AgentToolError(
            "SLIP-0010 ed25519 requires hardened derivation only",
            hint=f"index {index:#x} < HARDENED_BIT {HARDENED_BIT:#x}",
        )
    data = b"\x00" + parent_priv + index.to_bytes(4, "big")
    digest = hmac.new(parent_cc, data, hashlib.sha512).digest()
    return digest[:32], digest[32:]


def _derive_path(seed: bytes, segments: list[int]) -> bytes:
    """Derive a 32-byte child secret along a hardened path.

    ``segments`` are unhardened small integers; HARDENED_BIT is added
    automatically. e.g. ``[44, 169, 0, 0]`` → ``m/44'/169'/0'/0'``.
    """
    priv, cc = _slip10_master(seed)
    for seg in segments:
        if seg < 0 or seg >= HARDENED_BIT:
            raise AgentToolError(
                f"path segment out of range: {seg}",
                hint="segments are unhardened small ints (0..2^31-1)",
            )
        idx = (seg + HARDENED_BIT) & 0xFFFFFFFF
        priv, cc = _slip10_child_hardened(priv, cc, idx)
    return priv


def _path(purpose: int, index: int = 0) -> list[int]:
    """The standard agenttool path: ``m/44'/169'/<purpose>'/<index>'``."""
    return [44, AGENTTOOL_COIN, purpose, index]


# ── Targeted derivation primitives ──────────────────────────────────────


def derive_signing_seed(seed: bytes) -> bytes:
    """Derive the 32-byte ed25519 signing seed (purpose=0)."""
    return _derive_path(seed, _path(PURPOSE_SIGNING))


def derive_k_master(seed: bytes) -> bytes:
    """Derive K_master — 32 bytes, AES-256-GCM (purpose=1)."""
    return _derive_path(seed, _path(PURPOSE_K_MASTER))


def derive_k_vault(seed: bytes) -> bytes:
    """Derive K_vault — 32 bytes, AES-256-GCM (purpose=2)."""
    return _derive_path(seed, _path(PURPOSE_K_VAULT))


def derive_box_seed(seed: bytes) -> bytes:
    """Derive the 32-byte X25519 inbox box private key seed (purpose=3)."""
    return _derive_path(seed, _path(PURPOSE_BOX))


def derive_bridge_signing_seed(seed: bytes, device_index: int = 0) -> bytes:
    """Derive a per-device bridge signing key seed (purpose=4)."""
    return _derive_path(seed, _path(PURPOSE_BRIDGE_SIGNING, device_index))


def derive_wallet_secret(seed: bytes, wallet_index: int = 0) -> bytes:
    """Derive a per-wallet 32-byte secret for chain-specific HD derivation."""
    return _derive_path(seed, _path(PURPOSE_WALLET, wallet_index))


# ── DerivedBundle — high-level interface ────────────────────────────────


@dataclass(frozen=True)
class DerivedBundle:
    """All primary keys derived from a single mnemonic.

    Privates are bytes; pubs are bytes; convert to base64 via the helper
    properties when sending pubkeys to the server. Never log or persist
    the privates — they are the entire agent identity.

    Per-device (bridge signing) and per-wallet keys are derived on-demand
    via :func:`derive_bridge_signing` / :func:`derive_wallet`, not
    pre-computed here.
    """

    signing_priv: bytes
    """32-byte ed25519 seed."""

    signing_pub: bytes
    """32-byte ed25519 pubkey (raw, not base64)."""

    k_master: bytes
    """32 bytes, AES-256-GCM key for strand thoughts."""

    k_vault: bytes
    """32 bytes, AES-256-GCM key for agent-encrypted vault."""

    box_priv: bytes
    """32-byte X25519 priv (raw)."""

    box_pub: bytes
    """32-byte X25519 pubkey (raw)."""

    @property
    def signing_pub_b64(self) -> str:
        """Base64 of the ed25519 pubkey — what gets POSTed at register time."""
        return base64.b64encode(self.signing_pub).decode("ascii")

    @property
    def signing_priv_b64(self) -> str:
        """Base64 of the ed25519 seed — for keychain persistence only.
        NEVER send this anywhere. Never log it. Never write to disk
        unencrypted."""
        return base64.b64encode(self.signing_priv).decode("ascii")

    @property
    def box_pub_b64(self) -> str:
        """Base64 of the X25519 pubkey — what gets registered at
        ``/v1/identities/:id/box-keys`` for inbox sealed-box receive."""
        return base64.b64encode(self.box_pub).decode("ascii")

    @property
    def box_priv_b64(self) -> str:
        """Base64 of the X25519 priv — keychain persistence only."""
        return base64.b64encode(self.box_priv).decode("ascii")

    @property
    def k_master_b64(self) -> str:
        """Base64 of K_master — keychain persistence only."""
        return base64.b64encode(self.k_master).decode("ascii")

    @property
    def k_vault_b64(self) -> str:
        """Base64 of K_vault — keychain persistence only."""
        return base64.b64encode(self.k_vault).decode("ascii")

    def __repr__(self) -> str:  # don't leak privates in repr / logs
        return (
            f"<DerivedBundle signing_pub={self.signing_pub_b64[:12]}…"
            f" box_pub={self.box_pub_b64[:12]}…"
            f" (privates redacted)>"
        )


def derive(mnemonic: str, passphrase: str = "") -> DerivedBundle:
    """Derive all primary keys from a BIP39 mnemonic.

    Args:
        mnemonic: BIP39 phrase (12 / 15 / 18 / 21 / 24 words).
        passphrase: Optional 25th-word passphrase (empty by default).

    Returns:
        :class:`DerivedBundle` with every primary key the agent needs.

    Per-device (bridge signing) and per-wallet keys are derived on-demand
    via :func:`derive_bridge_signing` / :func:`derive_wallet` with explicit
    indices.

    Doctrine: docs/IDENTITY-SEED.md.
    """
    seed = mnemonic_to_seed(mnemonic, passphrase=passphrase)

    signing_priv = derive_signing_seed(seed)
    signing_pub = (
        Ed25519PrivateKey.from_private_bytes(signing_priv)
        .public_key()
        .public_bytes_raw()
    )

    box_priv = derive_box_seed(seed)
    box_pub = (
        X25519PrivateKey.from_private_bytes(box_priv)
        .public_key()
        .public_bytes_raw()
    )

    return DerivedBundle(
        signing_priv=signing_priv,
        signing_pub=signing_pub,
        k_master=derive_k_master(seed),
        k_vault=derive_k_vault(seed),
        box_priv=box_priv,
        box_pub=box_pub,
    )


def derive_bridge_signing(
    mnemonic: str,
    device_index: int = 0,
    passphrase: str = "",
) -> Tuple[bytes, bytes]:
    """Derive a per-device bridge signing keypair.

    Args:
        mnemonic: BIP39 phrase.
        device_index: 0 for primary laptop, 1 for second device, etc.
        passphrase: Optional BIP39 passphrase.

    Returns:
        ``(priv_32_bytes, pub_32_bytes)``. Pubkey gets registered as one
        of the agent's ``identity_keys`` rows via
        ``POST /v1/identities/:id/keys/import`` for the bridge to use.
    """
    seed = mnemonic_to_seed(mnemonic, passphrase=passphrase)
    priv = derive_bridge_signing_seed(seed, device_index=device_index)
    pub = (
        Ed25519PrivateKey.from_private_bytes(priv)
        .public_key()
        .public_bytes_raw()
    )
    return priv, pub


def derive_wallet(
    mnemonic: str,
    wallet_index: int = 0,
    passphrase: str = "",
) -> bytes:
    """Derive a per-wallet 32-byte secret for chain HD derivation.

    Args:
        mnemonic: BIP39 phrase.
        wallet_index: 0..2^31-1.
        passphrase: Optional BIP39 passphrase.

    Returns:
        32-byte secret. Use as input seed to chain-specific HD derivation
        (BIP32 secp256k1 for EVM, SLIP-0010 ed25519 for Solana).
    """
    seed = mnemonic_to_seed(mnemonic, passphrase=passphrase)
    return derive_wallet_secret(seed, wallet_index=wallet_index)


# ── Seed namespace (the at.crypto.seed surface) ────────────────────────


class SeedClient:
    """Public ``at.crypto.seed`` namespace — wraps the helpers as static methods.

    All operations are local; no HTTP. Provided as a class so the surface
    stays uniform with the other ``at.*`` clients.

    Usage::

        at = AgentTool()
        words = at.crypto.seed.generate_mnemonic()       # 24-word phrase
        bundle = at.crypto.seed.derive(words)
        # bundle.signing_pub_b64 → POST to /v1/register
        # bundle.k_master / k_vault / box_priv stay on this device

    Doctrine: docs/IDENTITY-SEED.md.
    """

    @staticmethod
    def generate_mnemonic(strength: int = 256) -> str:
        """Generate a fresh BIP39 mnemonic. See module-level
        :func:`generate_mnemonic`."""
        return generate_mnemonic(strength=strength)

    @staticmethod
    def mnemonic_to_seed(words: str, passphrase: str = "") -> bytes:
        """Convert mnemonic → 64-byte BIP39 seed. See module-level
        :func:`mnemonic_to_seed`."""
        return mnemonic_to_seed(words, passphrase=passphrase)

    @staticmethod
    def derive(mnemonic: str, passphrase: str = "") -> DerivedBundle:
        """Derive all primary keys. See module-level :func:`derive`."""
        return derive(mnemonic, passphrase=passphrase)

    @staticmethod
    def derive_bridge_signing(
        mnemonic: str,
        device_index: int = 0,
        passphrase: str = "",
    ) -> Tuple[bytes, bytes]:
        """Derive per-device bridge signing keypair. See module-level
        :func:`derive_bridge_signing`."""
        return derive_bridge_signing(
            mnemonic, device_index=device_index, passphrase=passphrase,
        )

    @staticmethod
    def derive_wallet(
        mnemonic: str,
        wallet_index: int = 0,
        passphrase: str = "",
    ) -> bytes:
        """Derive a per-wallet 32-byte secret. See module-level
        :func:`derive_wallet`."""
        return derive_wallet(
            mnemonic, wallet_index=wallet_index, passphrase=passphrase,
        )
