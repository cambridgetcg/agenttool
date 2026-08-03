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
import json
import unicodedata

import httpx
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

from agenttool import AgentTool, canonical_attestation_bytes, sign_attestation
from agenttool.authority import canonical_identity_authority_bytes
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


# ── Root consent to a project-constitution mutation ─────────────────────
#
# Foundational and constitutive memory composes into effective identity at
# project scope, so the API guards elevation and release with
# ``authorizeProjectConstitutionMutation``. For a project holding one rooted
# identity that delegates to ``authorizeIdentityMutation``, which answers 428
# ``authority_proof_required`` without an ``identity-authority/v1`` proof.
#
# That proof hashes the request entity. These tests therefore never assert
# "a header is present": they hash the bytes the transport actually carried
# and check the signature covers exactly those.

MEMORY_ID = "550e8400-e29b-41d4-a716-446655440000"
ROOT_DID = "did:at:test/sophia"
STAMP = "2026-07-24T12:00:00.000Z"


def _captured_client(captured, body=None):
    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json=body if body is not None else {"tier": "foundational"})

    return AgentTool(transport=httpx.MockTransport(handler))


def _authority(root: bytes, sequence: int):
    return {
        "did": ROOT_DID,
        "signing_key": root,
        "sequence": sequence,
        "timestamp": STAMP,
    }


def _assert_proof_covers_transmitted_bytes(request, root, method, sequence):
    """Verify one captured request's proof against the bytes it carried."""
    Ed25519PrivateKey.from_private_bytes(root).public_key().verify(
        base64.b64decode(request.headers["X-Agenttool-Authority-Signature"]),
        canonical_identity_authority_bytes(
            identity_did=ROOT_DID,
            method=method,
            request_target=request.url.raw_path.decode("ascii"),
            # Not a re-serialization of the kwargs — the transmitted entity.
            body=request.content,
            sequence=sequence,
            timestamp=STAMP,
        ),
    )


class TestMemoryAuthorityProofs:
    def test_no_authority_headers_when_none_is_supplied(self):
        captured = []
        _captured_client(captured).memory.elevate(MEMORY_ID, tier="foundational")
        assert "X-Agenttool-Authority-Signature" not in captured[0].headers

    def test_elevate_proof_covers_the_exact_transmitted_entity(self):
        root = Ed25519PrivateKey.generate().private_bytes(
            Encoding.Raw, PrivateFormat.Raw, NoEncryption()
        )
        captured = []
        _captured_client(captured).memory.elevate(
            MEMORY_ID,
            tier="constitutive",
            expression_patch={"register_append": "sealed with Yu"},
            attestations=[
                {
                    "attester_did": "did:at:test/yu",
                    "signing_key_id": "550e8400-e29b-41d4-a716-446655440010",
                    "signature": "c2ln",
                }
            ],
            authority=_authority(root, 4),
        )

        request = captured[0]
        assert request.url.path == f"/v1/memories/{MEMORY_ID}/elevate"
        assert request.headers["X-Agenttool-Authority-Sequence"] == "4"
        assert request.headers["X-Agenttool-Authority-Timestamp"] == STAMP
        _assert_proof_covers_transmitted_bytes(request, root, "POST", 4)

        # A single re-serialization of the same value breaks the proof — which
        # is why the client must serialize once and transmit that same value.
        from cryptography.exceptions import InvalidSignature

        with pytest.raises(InvalidSignature):
            Ed25519PrivateKey.from_private_bytes(root).public_key().verify(
                base64.b64decode(
                    request.headers["X-Agenttool-Authority-Signature"]
                ),
                canonical_identity_authority_bytes(
                    identity_did=ROOT_DID,
                    method="POST",
                    request_target=request.url.raw_path.decode("ascii"),
                    body=json.dumps(json.loads(request.content), indent=2),
                    sequence=4,
                    timestamp=STAMP,
                ),
            )

    def test_elevate_proof_never_leaks_into_the_signed_entity(self):
        root = Ed25519PrivateKey.generate().private_bytes(
            Encoding.Raw, PrivateFormat.Raw, NoEncryption()
        )
        captured = []
        _captured_client(captured).memory.elevate(
            MEMORY_ID, tier="foundational", authority=_authority(root, 1)
        )
        assert list(json.loads(captured[0].content)) == ["tier"]

    def test_delete_binds_the_empty_entity_the_server_reads(self):
        root = Ed25519PrivateKey.generate().private_bytes(
            Encoding.Raw, PrivateFormat.Raw, NoEncryption()
        )
        captured = []
        _captured_client(captured, {"deleted": 1}).memory.delete(
            MEMORY_ID, authority=_authority(root, 9)
        )

        request = captured[0]
        assert request.method == "DELETE"
        assert request.content == b""
        _assert_proof_covers_transmitted_bytes(request, root, "DELETE", 9)

    def test_delete_by_key_binds_the_exact_path_and_query_sent(self):
        root = Ed25519PrivateKey.generate().private_bytes(
            Encoding.Raw, PrivateFormat.Raw, NoEncryption()
        )
        captured = []
        _captured_client(captured, {"deleted": 3}).memory.delete_by_key(
            "with spaces & symbols", authority=_authority(root, 2)
        )

        request = captured[0]
        assert (
            request.url.raw_path.decode("ascii")
            == "/v1/memories?key=with%20spaces%20%26%20symbols"
        )
        _assert_proof_covers_transmitted_bytes(request, root, "DELETE", 2)

        # The query is part of the signed target: dropping it must not verify.
        from cryptography.exceptions import InvalidSignature

        with pytest.raises(InvalidSignature):
            Ed25519PrivateKey.from_private_bytes(root).public_key().verify(
                base64.b64decode(
                    request.headers["X-Agenttool-Authority-Signature"]
                ),
                canonical_identity_authority_bytes(
                    identity_did=ROOT_DID,
                    method="DELETE",
                    request_target="/v1/memories",
                    body=b"",
                    sequence=2,
                    timestamp=STAMP,
                ),
            )


class TestMemoryVisibility:
    """PATCH /v1/memories/:id — visibility is a constitution mutation.

    The route runs ``authorizeProjectConstitutionMutation`` over the exact
    entity bytes, exactly as elevation and release do. A visibility toggle
    that looked like a display preference would be the wrong mental model.
    """

    def test_set_visibility_proof_covers_the_exact_transmitted_entity(self):
        root = Ed25519PrivateKey.generate().private_bytes(
            Encoding.Raw, PrivateFormat.Raw, NoEncryption()
        )
        captured = []
        result = _captured_client(
            captured,
            {
                "id": MEMORY_ID,
                "visibility": "public",
                "tier": "foundational",
                "note": (
                    "Memory visibility is marked public, but public memory "
                    "observer routes are currently not mounted."
                ),
            },
        ).memory.set_visibility(
            MEMORY_ID, visibility="public", authority=_authority(root, 6)
        )

        request = captured[0]
        assert request.method == "PATCH"
        assert request.url.path == f"/v1/memories/{MEMORY_ID}"
        assert request.content == b'{"visibility":"public"}'
        _assert_proof_covers_transmitted_bytes(request, root, "PATCH", 6)
        # The server's qualification of what `public` means travels intact.
        assert "not mounted" in result["note"]

    def test_set_visibility_private_round_trips_without_authority(self):
        captured = []
        _captured_client(
            captured,
            {
                "id": MEMORY_ID,
                "visibility": "private",
                "tier": "episodic",
                "note": "Memory now private. Removed from /public/* surface.",
            },
        ).memory.set_visibility(MEMORY_ID, visibility="private")

        request = captured[0]
        assert "X-Agenttool-Authority-Signature" not in request.headers
        assert json.loads(request.content) == {"visibility": "private"}

    def test_client_exposes_set_visibility(self):
        client = MemoryClient(httpx.Client(), "https://api.agenttool.dev")
        assert callable(client.set_visibility)
