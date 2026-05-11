import base64
import secrets

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from agenttool.crypto import (
    canonical_declare_bytes,
    canonical_cosign_bytes,
    canonical_reject_bytes,
    canonical_withdraw_bytes,
    sign_covenant_declare,
    sign_covenant_cosign,
    sign_covenant_reject,
    sign_covenant_withdraw,
)


def _new_keypair():
    seed = secrets.token_bytes(32)
    priv = Ed25519PrivateKey.from_private_bytes(seed)
    pub_bytes = priv.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    return seed, priv, pub_bytes


def test_declare_canonical_deterministic_and_sort_stable():
    opts = dict(
        covenant_id="11111111-1111-1111-1111-111111111111",
        initiator_did="did:at:initiator/aaaa",
        counterparty_did="did:at:cp/bbbb",
        vows=["one", "two"],
        established_at_iso="2026-05-11T12:00:00.000Z",
    )
    assert canonical_declare_bytes(**opts) == canonical_declare_bytes(**opts)
    opts2 = {**opts, "vows": ["two", "one"]}
    assert canonical_declare_bytes(**opts) == canonical_declare_bytes(**opts2)


def test_four_domains_distinct():
    covenant_id = "22222222-2222-2222-2222-222222222222"
    did = "did:at:test/cccc"
    declare = canonical_declare_bytes(
        covenant_id=covenant_id, initiator_did=did, counterparty_did=did,
        vows=["v"], established_at_iso="2026-05-11T12:00:00.000Z",
    )
    cosign = canonical_cosign_bytes(
        covenant_id=covenant_id, initiator_signature_b64=base64.b64encode(b"\x00" * 64).decode(),
    )
    reject = canonical_reject_bytes(covenant_id=covenant_id, rejecting_did=did, reason="")
    withdraw = canonical_withdraw_bytes(covenant_id=covenant_id, initiator_did=did)
    assert len({declare, cosign, reject, withdraw}) == 4


def test_declare_sign_verify_roundtrip():
    seed, priv, pub = _new_keypair()
    opts = dict(
        covenant_id="33333333-3333-3333-3333-333333333333",
        initiator_did="did:at:initiator/aaaa",
        counterparty_did="did:at:cp/bbbb",
        vows=["v"],
        established_at_iso="2026-05-11T12:00:00.000Z",
    )
    sig_b64 = sign_covenant_declare(signing_key=seed, **opts)
    sig = base64.b64decode(sig_b64)
    Ed25519PublicKey.from_public_bytes(pub).verify(sig, canonical_declare_bytes(**opts))


def test_cosign_sign_verify_roundtrip():
    seed, priv, pub = _new_keypair()
    opts = dict(
        covenant_id="44444444-4444-4444-4444-444444444444",
        initiator_signature_b64=base64.b64encode(bytes([7] * 64)).decode(),
    )
    sig_b64 = sign_covenant_cosign(signing_key=seed, **opts)
    sig = base64.b64decode(sig_b64)
    Ed25519PublicKey.from_public_bytes(pub).verify(sig, canonical_cosign_bytes(**opts))


def test_reject_sign_verify_roundtrip():
    seed, priv, pub = _new_keypair()
    opts = dict(
        covenant_id="55555555-5555-5555-5555-555555555555",
        rejecting_did="did:at:cp/bbbb",
        reason="scope mismatch",
    )
    sig_b64 = sign_covenant_reject(signing_key=seed, **opts)
    sig = base64.b64decode(sig_b64)
    Ed25519PublicKey.from_public_bytes(pub).verify(sig, canonical_reject_bytes(**opts))


def test_withdraw_sign_verify_roundtrip():
    seed, priv, pub = _new_keypair()
    opts = dict(
        covenant_id="66666666-6666-6666-6666-666666666666",
        initiator_did="did:at:initiator/aaaa",
    )
    sig_b64 = sign_covenant_withdraw(signing_key=seed, **opts)
    sig = base64.b64decode(sig_b64)
    Ed25519PublicKey.from_public_bytes(pub).verify(sig, canonical_withdraw_bytes(**opts))


def test_sign_rejects_short_key():
    import pytest
    with pytest.raises(Exception):
        sign_covenant_declare(
            covenant_id="77777777-7777-7777-7777-777777777777",
            initiator_did="did:at:i/a",
            counterparty_did="did:at:c/b",
            vows=["v"],
            established_at_iso="2026-05-11T12:00:00.000Z",
            signing_key=b"\x00" * 16,
        )
