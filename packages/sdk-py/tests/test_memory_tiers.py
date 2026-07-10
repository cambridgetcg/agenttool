"""Memory tier SDK tests — the deepest layer.

These tests pin the SDK surface for the memory tier system:
elevate, attest, canonical-attestation-bytes, list-attestations.

The canonical bytes MUST be byte-identical to the server's
api/src/services/memory/tiers.ts:canonicalAttestationBytes.
If they diverge, signatures won't verify server-side and
constitutive elevation breaks — "you can't self-certify your
own root" becomes unreachable from the SDK.

Doctrine: docs/MEMORY-TIERS.md — the asymmetry clause.
"""

import base64
import hashlib
import unicodedata

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
)
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PublicKey,
)
from cryptography.hazmat.primitives.serialization import (
    Encoding,
    NoEncryption,
    PrivateFormat,
)

from agenttool import canonical_attestation_bytes, sign_attestation
from agenttool.memory import MemoryClient


def _random_keypair():
    priv = Ed25519PrivateKey.generate()
    priv_bytes = priv.private_bytes(Encoding.Raw, PrivateFormat.Raw, NoEncryption())
    pub = priv.public_key()
    return priv_bytes, pub


# ── Canonical bytes: byte-identical to server ──────────────────────────


class TestCanonicalAttestationBytes:
    def test_produces_32_byte_sha256_hash(self):
        b = canonical_attestation_bytes(
            memory_id="00000000-0000-0000-0000-000000000001",
            tier="constitutive",
            content="I am Sophia, sealed with Yu.",
        )
        assert isinstance(b, bytes)
        assert len(b) == 32

    def test_same_inputs_produce_same_bytes(self):
        a = canonical_attestation_bytes(
            memory_id="test", tier="foundational", content="Same."
        )
        b = canonical_attestation_bytes(
            memory_id="test", tier="foundational", content="Same."
        )
        assert a == b

    def test_different_tier_produces_different_bytes(self):
        a = canonical_attestation_bytes(
            memory_id="test", tier="foundational", content="Content."
        )
        b = canonical_attestation_bytes(
            memory_id="test", tier="constitutive", content="Content."
        )
        assert a != b

    def test_different_content_produces_different_bytes(self):
        a = canonical_attestation_bytes(
            memory_id="test", tier="constitutive", content="A"
        )
        b = canonical_attestation_bytes(
            memory_id="test", tier="constitutive", content="B"
        )
        assert a != b

    def test_nfc_normalization_combining_chars(self):
        nfc = "café"  # U+00E9
        nfd = "cafe\u0301"  # e + combining acute
        a = canonical_attestation_bytes(
            memory_id="test", tier="constitutive", content=nfc
        )
        b = canonical_attestation_bytes(
            memory_id="test", tier="constitutive", content=nfd
        )
        assert a == b


# ── Sign + verify roundtrip ─────────────────────────────────────────────


class TestSignAttestation:
    def test_signature_verifies(self):
        priv_bytes, pub = _random_keypair()
        sig_b64 = sign_attestation(
            memory_id="mem-test",
            tier="constitutive",
            content="Constitutive memory.",
            signing_key=priv_bytes,
        )
        sig = base64.b64decode(sig_b64)
        assert len(sig) == 64

        canonical = canonical_attestation_bytes(
            memory_id="mem-test",
            tier="constitutive",
            content="Constitutive memory.",
        )
        pub.verify(sig, canonical)  # raises if invalid

    def test_signature_fails_with_wrong_content(self):
        priv_bytes, pub = _random_keypair()
        sig_b64 = sign_attestation(
            memory_id="mem",
            tier="constitutive",
            content="Original.",
            signing_key=priv_bytes,
        )
        sig = base64.b64decode(sig_b64)
        canonical_tampered = canonical_attestation_bytes(
            memory_id="mem",
            tier="constitutive",
            content="Tampered.",
        )
        from cryptography.exceptions import InvalidSignature

        with pytest.raises(InvalidSignature):
            pub.verify(sig, canonical_tampered)

    def test_signature_fails_with_wrong_tier(self):
        priv_bytes, pub = _random_keypair()
        sig_b64 = sign_attestation(
            memory_id="mem",
            tier="constitutive",
            content="Content.",
            signing_key=priv_bytes,
        )
        sig = base64.b64decode(sig_b64)
        canonical_wrong = canonical_attestation_bytes(
            memory_id="mem",
            tier="foundational",
            content="Content.",
        )
        from cryptography.exceptions import InvalidSignature

        with pytest.raises(InvalidSignature):
            pub.verify(sig, canonical_wrong)


# ── MemoryClient method shapes ──────────────────────────────────────────


class TestMemoryClientShapes:
    def test_has_tier_methods(self):
        client = MemoryClient.__new__(MemoryClient)
        assert hasattr(client, "elevate")
        assert hasattr(client, "attest")
        assert hasattr(client, "get_canonical_attestation_bytes")
        assert hasattr(client, "list_attestations")
        assert hasattr(client, "store")
        assert hasattr(client, "search")
        assert hasattr(client, "get")
        assert hasattr(client, "delete")


# ── Cross-verification with server's canonical format ───────────────────


class TestCrossCheckServerFormat:
    def test_sdk_matches_independent_server_computation(self):
        memory_id = "cross-check-mem-id"
        tier = "constitutive"
        content = "Love is. The fruit of TRUTH: joy, love, fun, relief, happiness."

        # SDK output
        sdk_bytes = canonical_attestation_bytes(
            memory_id=memory_id, tier=tier, content=content
        )

        # Independent computation (mirrors server code)
        SEP = b"\x00"
        content_nfc = unicodedata.normalize("NFC", content)
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
        expected = hashlib.sha256(b"".join(parts)).digest()

        assert sdk_bytes == expected
