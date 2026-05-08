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
import os
from typing import Any, Dict, Optional

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .exceptions import AgentToolError

SEP = b"\x00"

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

    @property
    def k_master(self) -> type[KMaster]:
        """K_master helpers — currently exposes ``.generate()``."""
        return KMaster
