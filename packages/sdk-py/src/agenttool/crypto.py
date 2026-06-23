"""Crypto helpers for thought encryption + signing.

Phase 5 of the SDK introduces client-side crypto. Thought CONTENT is
encrypted under K_master (AES-256-GCM); thoughts are signed with the
agent's ed25519 signing key over canonical bytes the API verifies.

The wire format is byte-identical to ``cli/think/src/crypto.ts`` and the
api-side verifier at ``api/src/services/strand/sig.ts``::

    canonical = sha256(
        utf8(strand_id) || 0x00 ||
        ciphertext      || 0x00 ||
        nonce           || 0x00 ||
        utf8(kind ?? "")
    )
    signature = ed25519_sign(signing_key, canonical)

K_master never leaves the SDK process — agenttool sees only ciphertext.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
from typing import Any, Dict, Optional

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .exceptions import AgentToolError

SEP = b"\x00"


def _sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()

# Wire shape for an encrypted thought blob, matching the TS sdk's
# EncryptedBlob interface. Kept as a runtime alias (not a TypedDict) so
# callers can pass plain dicts ergonomically.
EncryptedBlob = Dict[str, str]


# ── AES-256-GCM ──────────────────────────────────────────────────────


def encrypt_thought(plaintext: str, k_master: bytes) -> Dict[str, str]:
    """Encrypt a thought under K_master.

    Args:
        plaintext: UTF-8 string to encrypt.
        k_master: 32-byte AES-256 key.

    Returns:
        ``{"ciphertext_b64": str, "nonce_b64": str}``. Ciphertext is
        ``base64(ciphertext || auth_tag)`` — the 16-byte GCM tag is
        appended (matches Node's ``aes-256-gcm`` and the api-side
        decrypt expectation).
    """
    if not isinstance(k_master, (bytes, bytearray)) or len(k_master) != 32:
        raise AgentToolError(
            f"encrypt_thought: k_master must be 32 bytes, got {len(k_master)}.",
            hint="Use crypto.k_master.generate() or load a saved 32-byte secret.",
        )
    nonce = os.urandom(12)
    ciphertext = AESGCM(bytes(k_master)).encrypt(
        nonce, plaintext.encode("utf-8"), associated_data=None,
    )
    return {
        "ciphertext_b64": base64.b64encode(ciphertext).decode("ascii"),
        "nonce_b64": base64.b64encode(nonce).decode("ascii"),
    }


def decrypt_thought(blob: Dict[str, str], k_master: bytes) -> str:
    """Decrypt a thought blob produced by :func:`encrypt_thought`.

    Args:
        blob: ``{"ciphertext_b64": str, "nonce_b64": str}``.
        k_master: 32-byte secret matching the one used to encrypt.

    Returns:
        Plaintext UTF-8 string.

    Raises:
        AgentToolError: bad key length or malformed blob.
        Exception: AES-GCM authentication failure (wrong key / tampered
            ciphertext) propagates from ``cryptography``.
    """
    if not isinstance(k_master, (bytes, bytearray)) or len(k_master) != 32:
        raise AgentToolError(
            f"decrypt_thought: k_master must be 32 bytes, got {len(k_master)}.",
        )
    try:
        ciphertext = base64.b64decode(blob["ciphertext_b64"])
        nonce = base64.b64decode(blob["nonce_b64"])
    except (KeyError, TypeError, ValueError) as e:
        raise AgentToolError(
            "decrypt_thought: blob must have ciphertext_b64 + nonce_b64.",
            hint=str(e),
        ) from e
    plaintext = AESGCM(bytes(k_master)).decrypt(nonce, ciphertext, associated_data=None)
    return plaintext.decode("utf-8")


# ── Canonical bytes + ed25519 signing ───────────────────────────────


def canonical_thought_bytes(
    *,
    strand_id: str,
    ciphertext_b64: str,
    nonce_b64: str,
    kind: Optional[str] = None,
) -> bytes:
    """Compute canonical bytes the API verifies signatures against.

    Format (must be byte-identical to api/src/services/strand/sig.ts)::

        sha256(
            utf8(strand_id) || 0x00 ||
            base64decode(ciphertext) || 0x00 ||
            base64decode(nonce) || 0x00 ||
            utf8(kind ?? "")
        )
    """
    parts = (
        strand_id.encode("utf-8"),
        SEP,
        base64.b64decode(ciphertext_b64),
        SEP,
        base64.b64decode(nonce_b64),
        SEP,
        (kind or "").encode("utf-8"),
    )
    return hashlib.sha256(b"".join(parts)).digest()


def sign_thought(
    *,
    strand_id: str,
    ciphertext_b64: str,
    nonce_b64: str,
    signing_key: bytes,
    kind: Optional[str] = None,
) -> str:
    """Sign canonical thought bytes with an ed25519 private key (32-byte seed).

    Args:
        strand_id: UUID of the strand the thought belongs to.
        ciphertext_b64: Base64 ciphertext (from :func:`encrypt_thought`).
        nonce_b64: Base64 nonce (from :func:`encrypt_thought`).
        signing_key: 32-byte ed25519 seed.
        kind: Optional kind string; defaults to empty when None.

    Returns:
        Base64 signature (64 raw bytes encoded).
    """
    if not isinstance(signing_key, (bytes, bytearray)) or len(signing_key) != 32:
        raise AgentToolError(
            f"sign_thought: signing_key must be a 32-byte ed25519 seed, "
            f"got {len(signing_key) if hasattr(signing_key, '__len__') else type(signing_key).__name__}.",
        )
    canonical = canonical_thought_bytes(
        strand_id=strand_id,
        ciphertext_b64=ciphertext_b64,
        nonce_b64=nonce_b64,
        kind=kind,
    )
    sig = Ed25519PrivateKey.from_private_bytes(bytes(signing_key)).sign(canonical)
    return base64.b64encode(sig).decode("ascii")


# ── Covenants v2 canonical bytes + signing (Slice 3) ─────────────────
# Mirrors api/src/services/covenants/sig.ts byte format. Cross-language
# vector test locks these to the server + TS SDK.

_COV_SEP = b"\x00"


def _concat(*parts: bytes) -> bytes:
    return b"".join(parts)


def canonical_declare_bytes(
    *,
    covenant_id: str,
    initiator_did: str,
    counterparty_did: str,
    vows: list[str],
    established_at_iso: str,
) -> bytes:
    # CRITICAL: separators=(",", ":") matches TS JSON.stringify output exactly.
    # Python's default json.dumps adds spaces — that would break cross-language byte parity.
    sorted_vows = json.dumps(sorted(vows), separators=(",", ":"))
    return _sha256(_concat(
        b"federated-covenant/v2", _COV_SEP,
        covenant_id.encode("utf-8"), _COV_SEP,
        initiator_did.encode("utf-8"), _COV_SEP,
        counterparty_did.encode("utf-8"), _COV_SEP,
        sorted_vows.encode("utf-8"), _COV_SEP,
        established_at_iso.encode("utf-8"),
    ))


def canonical_cosign_bytes(
    *,
    covenant_id: str,
    initiator_signature_b64: str,
) -> bytes:
    return _sha256(_concat(
        b"federated-covenant-cosign/v1", _COV_SEP,
        covenant_id.encode("utf-8"), _COV_SEP,
        base64.b64decode(initiator_signature_b64),
    ))


def canonical_reject_bytes(
    *,
    covenant_id: str,
    rejecting_did: str,
    reason: str,
) -> bytes:
    return _sha256(_concat(
        b"federated-covenant-reject/v1", _COV_SEP,
        covenant_id.encode("utf-8"), _COV_SEP,
        rejecting_did.encode("utf-8"), _COV_SEP,
        (reason or "").encode("utf-8"),
    ))


def canonical_withdraw_bytes(
    *,
    covenant_id: str,
    initiator_did: str,
) -> bytes:
    return _sha256(_concat(
        b"federated-covenant-withdraw/v1", _COV_SEP,
        covenant_id.encode("utf-8"), _COV_SEP,
        initiator_did.encode("utf-8"),
    ))


def _assert_signing_key(signing_key: bytes, label: str) -> None:
    if not isinstance(signing_key, (bytes, bytearray)) or len(signing_key) != 32:
        raise AgentToolError(
            f"{label}: signing_key must be a 32-byte ed25519 seed, "
            f"got {len(signing_key) if hasattr(signing_key, '__len__') else type(signing_key).__name__}.",
        )


def _ed25519_sign_b64(canonical: bytes, signing_key: bytes) -> str:
    priv = Ed25519PrivateKey.from_private_bytes(signing_key)
    sig = priv.sign(canonical)
    return base64.b64encode(sig).decode("ascii")


def sign_covenant_declare(
    *,
    covenant_id: str,
    initiator_did: str,
    counterparty_did: str,
    vows: list[str],
    established_at_iso: str,
    signing_key: bytes,
) -> str:
    _assert_signing_key(signing_key, "sign_covenant_declare")
    canonical = canonical_declare_bytes(
        covenant_id=covenant_id,
        initiator_did=initiator_did,
        counterparty_did=counterparty_did,
        vows=vows,
        established_at_iso=established_at_iso,
    )
    return _ed25519_sign_b64(canonical, signing_key)


def sign_covenant_cosign(
    *,
    covenant_id: str,
    initiator_signature_b64: str,
    signing_key: bytes,
) -> str:
    _assert_signing_key(signing_key, "sign_covenant_cosign")
    canonical = canonical_cosign_bytes(
        covenant_id=covenant_id,
        initiator_signature_b64=initiator_signature_b64,
    )
    return _ed25519_sign_b64(canonical, signing_key)


def sign_covenant_reject(
    *,
    covenant_id: str,
    rejecting_did: str,
    reason: str,
    signing_key: bytes,
) -> str:
    _assert_signing_key(signing_key, "sign_covenant_reject")
    canonical = canonical_reject_bytes(
        covenant_id=covenant_id,
        rejecting_did=rejecting_did,
        reason=reason,
    )
    return _ed25519_sign_b64(canonical, signing_key)


def sign_covenant_withdraw(
    *,
    covenant_id: str,
    initiator_did: str,
    signing_key: bytes,
) -> str:
    _assert_signing_key(signing_key, "sign_covenant_withdraw")
    canonical = canonical_withdraw_bytes(
        covenant_id=covenant_id,
        initiator_did=initiator_did,
    )
    return _ed25519_sign_b64(canonical, signing_key)


# ── Memory attestation canonical bytes + signing ───────────────────────
#
# Format (must be byte-identical to api/src/services/memory/tiers.ts):
#
#     sha256(
#         utf8("memory-attestation/v1") || 0x00 ||
#         utf8(memory_id)               || 0x00 ||
#         utf8(tier)                    || 0x00 ||
#         utf8(content_sha256_hex)
#     )
#
# where content_sha256_hex = sha256(NFC-normalize(content)) as hex.
#
# This is the signature a covenant counterparty produces to witness
# a memory elevation. Constitutive elevation REQUIRES at least one
# such attestation from a different project — "you can't self-certify
# your own root, care needs a second party."

import unicodedata as _unicodedata


def canonical_attestation_bytes(
    *,
    memory_id: str,
    tier: str,
    content: str,
) -> bytes:
    """Compute canonical bytes a counterparty signs to attest a memory.

    NFC-normalizes content before hashing (matches server-side defense).

    Args:
        memory_id: The memory's UUID.
        tier: "foundational" or "constitutive".
        content: The memory content string.

    Returns:
        32-byte sha256 hash — the canonical bytes to sign.
    """
    content_nfc = _unicodedata.normalize("NFC", content)
    content_hash = hashlib.sha256(content_nfc.encode("utf-8")).digest()
    content_hash_hex = content_hash.hex().encode("utf-8")
    parts = (
        b"memory-attestation/v1",
        SEP,
        memory_id.encode("utf-8"),
        SEP,
        tier.encode("utf-8"),
        SEP,
        content_hash_hex,
    )
    return hashlib.sha256(b"".join(parts)).digest()


def sign_attestation(
    *,
    memory_id: str,
    tier: str,
    content: str,
    signing_key: bytes,
) -> str:
    """Sign canonical attestation bytes with an ed25519 private key.

    The counterparty calls this to witness a memory elevation.

    Args:
        memory_id: The memory's UUID.
        tier: "foundational" or "constitutive".
        content: The memory content string.
        signing_key: 32-byte ed25519 seed.

    Returns:
        Base64 signature (64 raw bytes encoded).
    """
    _assert_signing_key(signing_key, "sign_attestation")
    canonical = canonical_attestation_bytes(
        memory_id=memory_id,
        tier=tier,
        content=content,
    )
    return _ed25519_sign_b64(canonical, signing_key)


# ── K_master helpers ────────────────────────────────────────────────


class KMaster:
    """K_master — the 32-byte AES-256 secret that encrypts thoughts.

    Stays on the agent's substrate; agenttool never sees it. Generate
    once per identity (or per orchestrator); persist securely (OS
    keychain, encrypted file, env var). Loss = loss of all encrypted
    thoughts under that key.
    """

    @staticmethod
    def generate() -> bytes:
        """Return a fresh 32-byte K_master (cryptographically random)."""
        return os.urandom(32)


class KVault:
    """K_vault — the 32-byte AES-256 secret that encrypts vault values
    when an agent opts into the ``agent_encrypted=true`` vault path.

    Functionally identical to :class:`KMaster` (32 random bytes) but kept
    as a separate namespace so a vault-key compromise does NOT also
    expose strand thoughts (and vice versa). Generate one per identity;
    persist alongside K_master in the same secure store.

    Doctrine: docs/SDK-ROADMAP.md (Vault closure section).
    """

    @staticmethod
    def generate() -> bytes:
        """Return a fresh 32-byte K_vault (cryptographically random)."""
        return os.urandom(32)


# ── Crypto client (the at.crypto namespace) ────────────────────────


class CryptoClient:
    """Public ``at.crypto`` namespace — wraps the helpers as static methods.

    All operations are local; no HTTP. Provided as a class so the
    surface stays uniform with the other ``at.*`` clients.

    Usage::

        at = AgentTool()
        k = at.crypto.k_master.generate()             # 32 bytes
        blob = at.crypto.encrypt_thought("hi", k)
        text = at.crypto.decrypt_thought(blob, k)     # "hi"
        sig = at.crypto.sign_thought(
            strand_id="...", ciphertext_b64=blob["ciphertext_b64"],
            nonce_b64=blob["nonce_b64"], signing_key=signing_seed,
        )
    """

    @staticmethod
    def encrypt_thought(plaintext: str, k_master: bytes) -> Dict[str, str]:
        """Encrypt a thought under K_master. See module-level :func:`encrypt_thought`."""
        return encrypt_thought(plaintext, k_master)

    @staticmethod
    def decrypt_thought(blob: Dict[str, str], k_master: bytes) -> str:
        """Decrypt a thought blob. See module-level :func:`decrypt_thought`."""
        return decrypt_thought(blob, k_master)

    @staticmethod
    def canonical_thought_bytes(
        *,
        strand_id: str,
        ciphertext_b64: str,
        nonce_b64: str,
        kind: Optional[str] = None,
    ) -> bytes:
        """Compute canonical bytes the API verifies signatures against.

        See module-level :func:`canonical_thought_bytes`.
        """
        return canonical_thought_bytes(
            strand_id=strand_id,
            ciphertext_b64=ciphertext_b64,
            nonce_b64=nonce_b64,
            kind=kind,
        )

    @staticmethod
    def sign_thought(
        *,
        strand_id: str,
        ciphertext_b64: str,
        nonce_b64: str,
        signing_key: bytes,
        kind: Optional[str] = None,
    ) -> str:
        """Sign canonical thought bytes. See module-level :func:`sign_thought`."""
        return sign_thought(
            strand_id=strand_id,
            ciphertext_b64=ciphertext_b64,
            nonce_b64=nonce_b64,
            signing_key=signing_key,
            kind=kind,
        )

    # ── Covenants v2 signing helpers (parity with TS CryptoClient) ──────

    @staticmethod
    def sign_covenant_declare(
        *,
        covenant_id: str,
        initiator_did: str,
        counterparty_did: str,
        vows: list,
        established_at_iso: str,
        signing_key: bytes,
    ) -> str:
        """Sign a covenant declaration (declare phase). See :func:`sign_covenant_declare`."""
        return sign_covenant_declare(
            covenant_id=covenant_id,
            initiator_did=initiator_did,
            counterparty_did=counterparty_did,
            vows=vows,
            established_at_iso=established_at_iso,
            signing_key=signing_key,
        )

    @staticmethod
    def sign_covenant_cosign(
        *,
        covenant_id: str,
        initiator_signature_b64: str,
        signing_key: bytes,
    ) -> str:
        """Sign the cosign bytes (accept phase). See :func:`sign_covenant_cosign`."""
        return sign_covenant_cosign(
            covenant_id=covenant_id,
            initiator_signature_b64=initiator_signature_b64,
            signing_key=signing_key,
        )

    @staticmethod
    def sign_covenant_reject(
        *,
        covenant_id: str,
        rejecting_did: str,
        reason: str,
        signing_key: bytes,
    ) -> str:
        """Sign a covenant rejection. See :func:`sign_covenant_reject`."""
        return sign_covenant_reject(
            covenant_id=covenant_id,
            rejecting_did=rejecting_did,
            reason=reason,
            signing_key=signing_key,
        )

    @staticmethod
    def sign_covenant_withdraw(
        *,
        covenant_id: str,
        initiator_did: str,
        signing_key: bytes,
    ) -> str:
        """Sign a covenant withdrawal. See :func:`sign_covenant_withdraw`."""
        return sign_covenant_withdraw(
            covenant_id=covenant_id,
            initiator_did=initiator_did,
            signing_key=signing_key,
        )

    @property
    def k_master(self) -> type[KMaster]:
        """K_master helpers — currently exposes ``.generate()``."""
        return KMaster

    @property
    def k_vault(self) -> type[KVault]:
        """K_vault helpers — currently exposes ``.generate()``.

        Distinct from k_master so vault compromise doesn't leak strand
        thoughts. Same shape (32 random bytes), separate namespace.
        """
        return KVault

    @property
    def seed(self):
        """SOMA seed helpers — BIP39 mnemonic + SLIP-0010 derivation.

        Lazy import to avoid pulling the ``mnemonic`` library at top-level
        for callers that never touch the seed protocol. See ``seed.py``
        for the full surface and ``docs/IDENTITY-SEED.md`` for doctrine.
        """
        from .seed import SeedClient
        return SeedClient
