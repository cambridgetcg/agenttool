"""Locked cross-language vectors for covenants v2 canonical bytes.

Every digest here is pinned against the identical fixture set in
packages/sdk-ts/tests/covenants-crypto.test.ts and the server verifier at
api/src/services/covenants/sig.ts. Non-ASCII and astral-plane vows are
first-class fixtures: Python's ``json.dumps`` escapes non-ASCII by default
and Python's ``sorted`` orders by code point while TS orders by UTF-16 code
unit — both divergences produce a signature the server rejects with an
opaque 400.
"""

import base64
import hashlib
import json

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

# Vow sets shared byte-for-byte with the TS suite.
#   non_ascii — dies under json.dumps' default ensure_ascii=True
#   astral    — sorted() puts "～" (U+FF5E) before "😀" (U+1F600) by code
#               point; TS puts "😀" first by UTF-16 code unit (0xD83D)
#   empty     — the empty vow string must survive canonicalization
VOW_SETS = dict(
    ascii=["respond within 24h", "preserve context"],
    non_ascii=["café", "naïve", "日本語", "abc"],
    astral=["a", "～", "\U0001F600"],
    empty=["", "a"],
)

LOCK = dict(
    declare_ascii="505be2d0cce4dc4c5c42d9b20f787f67f903cf8c6e741b1f1f8183eb6329cf5c",
    declare_non_ascii="164cf179a8b892782ea1e0e13bf9baef3f6fb04a9cd15f0b2934b0045af2d84c",
    declare_astral="c687f28a96faf7b1985e736c1c85589cba002e53a2d2e58cdb31acc761b8ba5d",
    declare_empty="f14dc30185bd7a877060459e74a00d268e7d1cf655fd33c91f815c2355524afd",
    cosign="6f2e7333ec7ef86ff0b0346a34511a7a988a1499a2b7430475dedabe76a6f680",
    reject="da83afa09eaaa6ffea78167e58c96519540c2f3991285142b90db65b542c078c",
    reject_unicode="20eacf2c0cc6803e45adb8daffee9a1b04d0722b08193c4eb698344059ef3c38",
    reject_empty="a3aff0f87793a8042a8e99a53b4995ffd8bd25933a50bd2cbe07e7a8f4c5498c",
    withdraw="b16284e310143c80c17537a80e42a8eb87205e7475d89abf9096a0621ebce9bb",
)


def _declare(vows: list) -> str:
    return canonical_declare_bytes(**{**FIXED, "vows": vows}).hex()


def test_declare_matches_locked_vector():
    assert canonical_declare_bytes(**FIXED).hex() == LOCK["declare_ascii"]


def test_declare_non_ascii_matches_locked_vector():
    assert _declare(VOW_SETS["non_ascii"]) == LOCK["declare_non_ascii"]


def test_declare_astral_matches_locked_vector():
    assert _declare(VOW_SETS["astral"]) == LOCK["declare_astral"]


def test_declare_empty_vow_matches_locked_vector():
    assert _declare(VOW_SETS["empty"]) == LOCK["declare_empty"]


def test_declare_is_sort_stable_for_every_vow_set():
    for vows in VOW_SETS.values():
        assert _declare(vows) == _declare(list(reversed(vows)))


def test_declare_sorts_astral_by_utf16_code_unit_not_code_point():
    # Code-point order is ["a", "～", "😀"]; UTF-16 order is ["a", "😀", "～"].
    # Only the latter agrees with TS Array.prototype.sort(), so the digest
    # must NOT be the one a naive code-point sort would produce.
    naive_json = json.dumps(
        sorted(VOW_SETS["astral"]), ensure_ascii=False, separators=(",", ":"),
    )
    naive = hashlib.sha256(b"\x00".join([
        b"federated-covenant/v2",
        FIXED["covenant_id"].encode("utf-8"),
        FIXED["initiator_did"].encode("utf-8"),
        FIXED["counterparty_did"].encode("utf-8"),
        naive_json.encode("utf-8"),
        FIXED["established_at_iso"].encode("utf-8"),
    ])).hexdigest()
    assert _declare(VOW_SETS["astral"]) != naive


def test_declare_emits_raw_utf8_not_ascii_escapes():
    # ensure_ascii=True would hash "caf\\u00e9" where TS hashes "café".
    escaped_json = json.dumps(
        sorted(VOW_SETS["non_ascii"], key=lambda v: v.encode("utf-16-be")),
        separators=(",", ":"),
    )
    escaped = hashlib.sha256(b"\x00".join([
        b"federated-covenant/v2",
        FIXED["covenant_id"].encode("utf-8"),
        FIXED["initiator_did"].encode("utf-8"),
        FIXED["counterparty_did"].encode("utf-8"),
        escaped_json.encode("utf-8"),
        FIXED["established_at_iso"].encode("utf-8"),
    ])).hexdigest()
    assert _declare(VOW_SETS["non_ascii"]) != escaped


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


def test_reject_non_ascii_reason_matches_locked_vector():
    assert canonical_reject_bytes(
        covenant_id=FIXED["covenant_id"],
        rejecting_did=FIXED["counterparty_did"],
        reason="範囲が違う 😀",
    ).hex() == LOCK["reject_unicode"]


def test_reject_empty_reason_matches_locked_vector():
    assert canonical_reject_bytes(
        covenant_id=FIXED["covenant_id"],
        rejecting_did=FIXED["counterparty_did"],
        reason="",
    ).hex() == LOCK["reject_empty"]


def test_withdraw_matches_locked_vector():
    assert canonical_withdraw_bytes(
        covenant_id=FIXED["covenant_id"],
        initiator_did=FIXED["initiator_did"],
    ).hex() == LOCK["withdraw"]
