"""Canonical-byte framing tests — strand-thought/v1 vs /v2.

v1 NUL-delimits raw binary it does not length-bound, so a ciphertext or
nonce carrying a 0x00 byte can reparse as a different (ciphertext, nonce)
split under one signature. v2 length-prefixes every variable-length field.

Every hex digest below is pinned and cross-checked against the TypeScript
SDK (packages/sdk-ts/tests/crypto-canon.test.ts) and the api verifier at
api/src/services/strand/sig.ts. If a digest moves, the wire format moved.
"""

import base64
import hashlib

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from agenttool.crypto import canonical_thought_bytes, sign_thought
from agenttool.exceptions import AgentToolError


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


SAMPLE_SIGNING_SEED = bytes(range(32))

# A thought whose ciphertext AND nonce both carry interior 0x00 bytes —
# exactly the shape v1's NUL framing cannot bound.
THOUGHT = dict(
    strand_id="11111111-2222-3333-4444-555555555555",
    ciphertext_b64=_b64(bytes([1, 0, 2, 3, 255, 0])),
    nonce_b64=_b64(bytes([9, 0, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9])),
    kind="observation",
)

LOCK = dict(
    v1="d2e7735e862e2096f05300f99672f163ab84d8efedbf559b2b1cadb02c040d3f",
    v2="7cf47e17a004eb82fedfc0c7843a0a21d3fba718ba8ac70f657694dd2f44f547",
    v1_no_kind="45ddb28a8253d21bf794969e3a343f08b916130052fb20aabeb89022f9c7b35b",
    v2_no_kind="c4b0b2e9b375a956ab233adefd6f592b32ca87c53c87c0ef5afd2cca289e89fb",
)

# Two DIFFERENT (ciphertext, nonce) splits of the same v1 byte string:
#   "s" 00 [01] 00 [02 00 03] 00 "k"  ==  "s" 00 [01 00 02] 00 [03] 00 "k"
AMBIGUOUS_LEFT = dict(
    strand_id="s", ciphertext_b64=_b64(bytes([1])), nonce_b64=_b64(bytes([2, 0, 3])), kind="k",
)
AMBIGUOUS_RIGHT = dict(
    strand_id="s", ciphertext_b64=_b64(bytes([1, 0, 2])), nonce_b64=_b64(bytes([3])), kind="k",
)


class TestThoughtCanonicalVectors:
    def test_v1_matches_locked_vector(self) -> None:
        assert canonical_thought_bytes(**THOUGHT).hex() == LOCK["v1"]

    def test_v1_is_the_default(self) -> None:
        assert canonical_thought_bytes(**THOUGHT) == canonical_thought_bytes(
            **THOUGHT, version="v1",
        )

    def test_v2_matches_locked_vector(self) -> None:
        assert canonical_thought_bytes(**THOUGHT, version="v2").hex() == LOCK["v2"]

    def test_v1_and_v2_are_domain_separated(self) -> None:
        assert LOCK["v1"] != LOCK["v2"]

    def test_kind_none_matches_locked_vectors(self) -> None:
        kw = dict(THOUGHT, kind=None)
        assert canonical_thought_bytes(**kw).hex() == LOCK["v1_no_kind"]
        assert canonical_thought_bytes(**kw, version="v2").hex() == LOCK["v2_no_kind"]

    def test_v2_matches_manual_sha256(self) -> None:
        # Reproduce the v2 formula end-to-end so any drift here surfaces.
        strand_id = "abc"
        ciphertext = b"hello-ct"
        nonce = b"123456789012"
        kind = "obs"
        def framed(field: bytes) -> bytes:
            return len(field).to_bytes(4, "big") + field
        expected = hashlib.sha256(
            b"strand-thought/v2"
            + framed(strand_id.encode("utf-8"))
            + framed(ciphertext)
            + framed(nonce)
            + framed(kind.encode("utf-8")),
        ).digest()
        actual = canonical_thought_bytes(
            strand_id=strand_id,
            ciphertext_b64=_b64(ciphertext),
            nonce_b64=_b64(nonce),
            kind=kind,
            version="v2",
        )
        assert actual == expected

    def test_unknown_version_raises(self) -> None:
        with pytest.raises(AgentToolError) as exc:
            canonical_thought_bytes(**THOUGHT, version="v3")
        assert "unknown version" in exc.value.message


class TestNulFramingAmbiguity:
    def test_v1_collides_across_two_ciphertext_nonce_splits(self) -> None:
        # Documents the v1 defect rather than blessing it: one signature,
        # two readings of the same bytes.
        assert canonical_thought_bytes(**AMBIGUOUS_LEFT) == canonical_thought_bytes(
            **AMBIGUOUS_RIGHT,
        )

    def test_v2_separates_the_two_splits(self) -> None:
        assert canonical_thought_bytes(
            **AMBIGUOUS_LEFT, version="v2",
        ) != canonical_thought_bytes(**AMBIGUOUS_RIGHT, version="v2")

    def test_v1_signature_reuses_across_splits_but_v2_does_not(self) -> None:
        sig_v1 = sign_thought(**AMBIGUOUS_LEFT, signing_key=SAMPLE_SIGNING_SEED)
        assert sig_v1 == sign_thought(**AMBIGUOUS_RIGHT, signing_key=SAMPLE_SIGNING_SEED)
        sig_v2 = sign_thought(
            **AMBIGUOUS_LEFT, signing_key=SAMPLE_SIGNING_SEED, version="v2",
        )
        assert sig_v2 != sign_thought(
            **AMBIGUOUS_RIGHT, signing_key=SAMPLE_SIGNING_SEED, version="v2",
        )


class TestSignThoughtVersions:
    def test_v2_signature_verifies_against_v2_bytes(self) -> None:
        sig_b64 = sign_thought(
            **THOUGHT, signing_key=SAMPLE_SIGNING_SEED, version="v2",
        )
        priv = Ed25519PrivateKey.from_private_bytes(SAMPLE_SIGNING_SEED)
        priv.public_key().verify(
            base64.b64decode(sig_b64),
            canonical_thought_bytes(**THOUGHT, version="v2"),
        )

    def test_v1_and_v2_signatures_differ(self) -> None:
        assert sign_thought(**THOUGHT, signing_key=SAMPLE_SIGNING_SEED) != sign_thought(
            **THOUGHT, signing_key=SAMPLE_SIGNING_SEED, version="v2",
        )
