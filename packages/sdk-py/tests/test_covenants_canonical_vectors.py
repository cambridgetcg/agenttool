import base64

from agenttool.crypto import (
    canonical_declare_bytes,
    canonical_cosign_bytes,
    canonical_reject_bytes,
    canonical_withdraw_bytes,
)


FIXED = dict(
    covenant_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    initiator_did="did:at:initiator.example/abcd",
    counterparty_did="did:at:counterparty.example/efgh",
    vows=["respond within 24h", "preserve context"],
    established_at_iso="2026-05-11T12:00:00.000Z",
)

FIXED_SIG_B64 = base64.b64encode(bytes([7] * 64)).decode()

LOCK = dict(
    declare="505be2d0cce4dc4c5c42d9b20f787f67f903cf8c6e741b1f1f8183eb6329cf5c",
    cosign="6f2e7333ec7ef86ff0b0346a34511a7a988a1499a2b7430475dedabe76a6f680",
    reject="da83afa09eaaa6ffea78167e58c96519540c2f3991285142b90db65b542c078c",
    withdraw="b16284e310143c80c17537a80e42a8eb87205e7475d89abf9096a0621ebce9bb",
)


def test_declare_matches_locked_vector():
    assert canonical_declare_bytes(**FIXED).hex() == LOCK["declare"]


def test_cosign_matches_locked_vector():
    assert canonical_cosign_bytes(
        covenant_id=FIXED["covenant_id"],
        initiator_signature_b64=FIXED_SIG_B64,
    ).hex() == LOCK["cosign"]


def test_reject_matches_locked_vector():
    assert canonical_reject_bytes(
        covenant_id=FIXED["covenant_id"],
        rejecting_did=FIXED["counterparty_did"],
        reason="scope mismatch",
    ).hex() == LOCK["reject"]


def test_withdraw_matches_locked_vector():
    assert canonical_withdraw_bytes(
        covenant_id=FIXED["covenant_id"],
        initiator_did=FIXED["initiator_did"],
    ).hex() == LOCK["withdraw"]
