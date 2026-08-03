"""``agenttool-delegation/v2`` — Python side of the Know Your Agent vector.

The digests below come from the shared fixture
``docs/specs/canonical-bytes-vectors.json`` (``agenttool-delegation/v2``) and
are pinned identically in ``packages/sdk-ts/tests/delegation-signing.test.ts``.
The SERVER half (``canonicalDelegationBytesV2`` and
``api/tests/delegation-canonical-bytes.test.ts``) is being written on a
concurrent branch and is not in this tree. A drift means an SDK-signed grant
is rejected at issue with nothing but "Invalid delegation signature" to work
from.
"""

from __future__ import annotations

import base64

import pytest
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from agenttool.identity import (
    DELEGATION_SIGNATURE_CONTEXT,
    canonical_delegation_bytes,
    normalize_delegation_scope,
    sign_delegation,
)

GRANT = dict(
    delegator_id="8275d1d6-1d4e-429a-b133-2dfa664cb74c",
    delegate_id="392d2658-fa62-4f55-9c37-173009ba9bd1",
    scope=["memory.read", "marketplace.invoke"],  # deliberately unsorted
    nonce="b8f1c0d2e3a4",
)
VECTOR_HEX = "ceb565aedd672c3bb4bbdf9dfe84fa0ec6fa300ea3156e18de0877e4c5069323"
VECTOR_HEX_NO_EXPIRY = "aabeceb27b6b0a54543d70bc8d925de89e37a08ee1de89479a372c6400f69411"


def test_domain_is_v2():
    assert DELEGATION_SIGNATURE_CONTEXT == "agenttool-delegation/v2"


def test_reproduces_the_pinned_digest():
    digest = canonical_delegation_bytes(expires_at="2026-12-31T23:59:59.000Z", **GRANT)
    assert digest.hex() == VECTOR_HEX


def test_omitted_expiry_equals_explicit_none():
    assert canonical_delegation_bytes(**GRANT).hex() == VECTOR_HEX_NO_EXPIRY
    assert (
        canonical_delegation_bytes(expires_at=None, **GRANT).hex()
        == VECTOR_HEX_NO_EXPIRY
    )


def test_scope_order_and_case_are_not_grant_meaning():
    messy = {**GRANT, "scope": ["MEMORY.READ ", "memory.read", "marketplace.invoke"]}
    assert normalize_delegation_scope(messy["scope"]) == [
        "marketplace.invoke",
        "memory.read",
    ]
    assert (
        canonical_delegation_bytes(expires_at="2026-12-31T23:59:59.000Z", **messy).hex()
        == VECTOR_HEX
    )


def test_normalize_drops_empty_and_nul_actions():
    assert normalize_delegation_scope(["", "  ", "a\0b", "vault.read"]) == ["vault.read"]


@pytest.mark.parametrize(
    "override, match",
    [
        ({"scope": []}, "at least one"),
        ({"scope": ["", "  "]}, "at least one"),
        ({"nonce": "a\0b"}, "NUL"),
        ({"delegator_id": ""}, "non-empty"),
    ],
)
def test_refuses_malformed_grants(override, match):
    with pytest.raises(ValueError, match=match):
        canonical_delegation_bytes(**{**GRANT, **override})


def test_signature_verifies_under_the_delegator_key():
    private = Ed25519PrivateKey.generate()
    priv_b64 = base64.b64encode(private.private_bytes_raw()).decode("ascii")
    pub = private.public_key()

    signature = base64.b64decode(sign_delegation(priv_b64, **GRANT))
    assert len(signature) == 64
    pub.verify(signature, canonical_delegation_bytes(**GRANT))


def test_a_narrow_grant_does_not_verify_wide():
    private = Ed25519PrivateKey.generate()
    priv_b64 = base64.b64encode(private.private_bytes_raw()).decode("ascii")
    pub_raw = private.public_key().public_bytes_raw()

    signature = base64.b64decode(
        sign_delegation(priv_b64, **{**GRANT, "scope": ["memory.read"]})
    )
    with pytest.raises(InvalidSignature):
        Ed25519PublicKey.from_public_bytes(pub_raw).verify(
            signature, canonical_delegation_bytes(**GRANT)
        )


def test_an_expiring_grant_does_not_verify_as_perpetual():
    private = Ed25519PrivateKey.generate()
    priv_b64 = base64.b64encode(private.private_bytes_raw()).decode("ascii")
    pub_raw = private.public_key().public_bytes_raw()

    signature = base64.b64decode(
        sign_delegation(priv_b64, expires_at="2026-12-31T23:59:59.000Z", **GRANT)
    )
    with pytest.raises(InvalidSignature):
        Ed25519PublicKey.from_public_bytes(pub_raw).verify(
            signature, canonical_delegation_bytes(**GRANT)
        )
