"""``wallet-address-claim/v1`` — Python side of the cross-language vector.

The digests below are the wire contract, taken from the shared fixture
``docs/specs/canonical-bytes-vectors.json`` (``wallet-address-claim/v1``).
``packages/sdk-ts/tests/wallet-address-claim.test.ts`` pins the identical
values. The SERVER half (``api/src/services/economy/crypto/address-claim.ts``
and its test) is being written on a concurrent branch and is not in this tree.
If any of the three drift, an agent signing here cannot register an address
and the failure surfaces only as an opaque ``claim_signature_invalid``.

Doctrine: ``docs/CANONICAL-BYTES.md`` § wallet-address-claim/v1.
"""

from __future__ import annotations

import base64

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)
from cryptography.exceptions import InvalidSignature

from agenttool.economy import (
    WALLET_ADDRESS_CLAIM_SIGNATURE_CONTEXT,
    canonical_wallet_address_claim_bytes,
    sign_wallet_address_claim,
)

VECTOR = dict(
    wallet_id="45083026-1993-4486-a84e-e041006e5f19",
    chain="base",
    address="0x5B38Da6a701c568545dCfcB03FcB875f56beddC4",
    claim_pubkey_b64="6LkbszvJhomCix4hHE9kLH9hEk9CR72JUBiYnTuyrEk=",
)
VECTOR_DIGEST_HEX = "bac589a625f4fc23bba16974a993c3c9b7cde82d4428fb01e4b532a0399fb8a7"
VECTOR_DIGEST_HEX_EMPTY_PATH = (
    "3eacff64cc581ac48c7f362714902dbc096286b3d31ba6b5a48fe8718f068996"
)


def test_domain_tag_is_the_one_the_server_verifies():
    assert WALLET_ADDRESS_CLAIM_SIGNATURE_CONTEXT == "wallet-address-claim/v1"


def test_reproduces_the_pinned_digest():
    digest = canonical_wallet_address_claim_bytes(
        derivation_path="m/44'/169'/5'/0'", **VECTOR
    )
    assert digest.hex() == VECTOR_DIGEST_HEX


def test_omitted_derivation_path_is_an_empty_field_not_a_dropped_one():
    omitted = canonical_wallet_address_claim_bytes(**VECTOR)
    explicit = canonical_wallet_address_claim_bytes(derivation_path="", **VECTOR)
    assert omitted.hex() == VECTOR_DIGEST_HEX_EMPTY_PATH
    assert explicit.hex() == VECTOR_DIGEST_HEX_EMPTY_PATH


def test_pubkey_is_folded_as_raw_bytes_not_base64_text():
    # The one non-UTF-8 field. Encoding the base64 string instead would produce
    # a digest the server never accepts.
    raw = base64.b64decode(VECTOR["claim_pubkey_b64"])
    assert len(raw) == 32
    assert len(VECTOR["claim_pubkey_b64"].encode("utf-8")) != len(raw)


def test_every_field_is_bound():
    base_digest = canonical_wallet_address_claim_bytes(**VECTOR)
    other_pub = base64.b64encode(
        Ed25519PrivateKey.generate().public_key().public_bytes_raw()
    ).decode("ascii")
    for override in (
        {"wallet_id": "45083026-1993-4486-a84e-e041006e5f18"},
        {"chain": "polygon"},
        {"address": "0x5B38Da6a701c568545dCfcB03FcB875f56beddC5"},
        {"claim_pubkey_b64": other_pub},
    ):
        mutated = canonical_wallet_address_claim_bytes(**{**VECTOR, **override})
        assert mutated != base_digest


@pytest.mark.parametrize(
    "override, match",
    [
        ({"claim_pubkey_b64": "AAAA"}, "32 bytes"),
        ({"claim_pubkey_b64": "not base64 !!"}, "valid base64"),
        ({"chain": ""}, "non-empty"),
        ({"address": "0x00\x0041"}, "NUL"),
    ],
)
def test_refuses_malformed_input(override, match):
    with pytest.raises(ValueError, match=match):
        canonical_wallet_address_claim_bytes(**{**VECTOR, **override})


def test_signature_verifies_under_the_claimed_key():
    private = Ed25519PrivateKey.generate()
    priv_b64 = base64.b64encode(private.private_bytes_raw()).decode("ascii")
    pub_raw = private.public_key().public_bytes_raw()
    payload = {**VECTOR, "claim_pubkey_b64": base64.b64encode(pub_raw).decode("ascii")}

    signature = base64.b64decode(sign_wallet_address_claim(priv_b64, **payload))
    assert len(signature) == 64
    Ed25519PublicKey.from_public_bytes(pub_raw).verify(
        signature, canonical_wallet_address_claim_bytes(**payload)
    )


def test_signature_does_not_carry_over_to_another_address():
    private = Ed25519PrivateKey.generate()
    priv_b64 = base64.b64encode(private.private_bytes_raw()).decode("ascii")
    pub_raw = private.public_key().public_bytes_raw()
    payload = {**VECTOR, "claim_pubkey_b64": base64.b64encode(pub_raw).decode("ascii")}

    signature = base64.b64decode(sign_wallet_address_claim(priv_b64, **payload))
    moved = canonical_wallet_address_claim_bytes(**{**payload, "address": "0xdeadbeef"})
    with pytest.raises(InvalidSignature):
        Ed25519PublicKey.from_public_bytes(pub_raw).verify(signature, moved)
