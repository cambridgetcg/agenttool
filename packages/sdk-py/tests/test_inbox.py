"""Inbox sealed-box — unit tests.

Covers the local crypto primitives and verifies wire-format compatibility
with the TS SDK + api server (byte-identical canonical bytes + envelope
signature shape).
"""

from __future__ import annotations

import base64
import hashlib
import os

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from agenttool.inbox import (
    canonical_inbox_bytes,
    canonical_inbox_cosign_bytes,
    derive_box_pub,
    generate_box_keypair,
    seal_for_recipient,
    sign_inbox_cosign,
    sign_inbox_envelope,
    unseal_for_self,
)


def _make_signing_keypair() -> tuple[bytes, bytes]:
    sk = Ed25519PrivateKey.generate()
    priv = sk.private_bytes_raw()
    pub = sk.public_key().public_bytes_raw()
    return priv, pub


# ── Sealed-box primitives ──────────────────────────────────────────────


def test_generate_box_keypair_lengths() -> None:
    kp = generate_box_keypair()
    assert len(kp["priv"]) == 32
    assert len(kp["pub"]) == 32


def test_derive_box_pub_matches_generated() -> None:
    kp = generate_box_keypair()
    derived = derive_box_pub(kp["priv"])
    assert derived == kp["pub"]


def test_seal_unseal_roundtrip() -> None:
    recipient = generate_box_keypair()
    plaintext = "the dual-witness consents to release"
    sealed = seal_for_recipient(plaintext, recipient["pub"])
    recovered = unseal_for_self(
        ciphertext_b64=sealed["ciphertext_b64"],
        nonce_b64=sealed["nonce_b64"],
        ephemeral_pub_b64=sealed["ephemeral_pub_b64"],
        recipient_box_priv=recipient["priv"],
    )
    assert recovered == plaintext


def test_each_seal_uses_fresh_ephemeral() -> None:
    recipient = generate_box_keypair()
    a = seal_for_recipient("same message", recipient["pub"])
    b = seal_for_recipient("same message", recipient["pub"])
    assert a["ephemeral_pub_b64"] != b["ephemeral_pub_b64"]
    assert a["nonce_b64"] != b["nonce_b64"]
    assert a["ciphertext_b64"] != b["ciphertext_b64"]


def test_unseal_with_wrong_key_raises() -> None:
    recipient = generate_box_keypair()
    intruder = generate_box_keypair()
    sealed = seal_for_recipient("private", recipient["pub"])
    with pytest.raises(Exception):
        unseal_for_self(
            ciphertext_b64=sealed["ciphertext_b64"],
            nonce_b64=sealed["nonce_b64"],
            ephemeral_pub_b64=sealed["ephemeral_pub_b64"],
            recipient_box_priv=intruder["priv"],
        )


def test_rejects_malformed_key_lengths() -> None:
    with pytest.raises(Exception, match="32 bytes"):
        seal_for_recipient("x", b"\x00" * 31)
    with pytest.raises(Exception, match="32 bytes"):
        unseal_for_self(
            ciphertext_b64=base64.b64encode(b"AA").decode(),
            nonce_b64=base64.b64encode(b"AA").decode(),
            ephemeral_pub_b64=base64.b64encode(b"AA").decode(),
            recipient_box_priv=b"\x00" * 20,
        )


# ── Canonical bytes + envelope sig ─────────────────────────────────────


def test_canonical_inbox_bytes_is_sha256_32_bytes() -> None:
    out = canonical_inbox_bytes(
        recipient_did="did:at:00000000-0000-4000-8000-000000000001",
        ciphertext_b64=base64.b64encode(b"\x00" * 40).decode(),
        nonce_b64=base64.b64encode(b"\x00" * 12).decode(),
        ephemeral_pub_b64=base64.b64encode(b"\x00" * 32).decode(),
    )
    assert isinstance(out, bytes)
    assert len(out) == 32


def test_canonical_inbox_bytes_changes_per_field() -> None:
    base_args = {
        "recipient_did": "did:at:abc",
        "ciphertext_b64": base64.b64encode(b"\x00" * 32).decode(),
        "nonce_b64": base64.b64encode(b"\x00" * 12).decode(),
        "ephemeral_pub_b64": base64.b64encode(b"\x00" * 32).decode(),
    }
    base_digest = canonical_inbox_bytes(**base_args)

    variants = [
        {"recipient_did": "did:at:def"},
        {"ciphertext_b64": base64.b64encode(b"\x01" + b"\x00" * 31).decode()},
        {"nonce_b64": base64.b64encode(b"\x01" + b"\x00" * 11).decode()},
        {"ephemeral_pub_b64": base64.b64encode(b"\x01" + b"\x00" * 31).decode()},
    ]
    for v in variants:
        altered = canonical_inbox_bytes(**{**base_args, **v})
        assert altered != base_digest


def test_sign_inbox_envelope_verifies() -> None:
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    sender_priv, sender_pub = _make_signing_keypair()
    recipient = generate_box_keypair()
    sealed = seal_for_recipient("hello", recipient["pub"])

    sig = sign_inbox_envelope(
        recipient_did="did:at:abc",
        ciphertext_b64=sealed["ciphertext_b64"],
        nonce_b64=sealed["nonce_b64"],
        ephemeral_pub_b64=sealed["ephemeral_pub_b64"],
        signing_key=sender_priv,
    )
    canonical = canonical_inbox_bytes(
        recipient_did="did:at:abc",
        ciphertext_b64=sealed["ciphertext_b64"],
        nonce_b64=sealed["nonce_b64"],
        ephemeral_pub_b64=sealed["ephemeral_pub_b64"],
    )
    Ed25519PublicKey.from_public_bytes(sender_pub).verify(
        base64.b64decode(sig), canonical
    )  # raises on failure


def test_cosign_substitution_rejected() -> None:
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    recipient_priv, recipient_pub = _make_signing_keypair()
    opts = {
        "message_id": "00000000-0000-4000-8000-000000000aaa",
        "recipient_did": "did:at:abc",
        "ciphertext_b64": base64.b64encode(b"\x07\x07\x07").decode(),
        "nonce_b64": base64.b64encode(b"\x00" * 12).decode(),
    }
    sig = sign_inbox_cosign(**opts, signing_key=recipient_priv)
    good = canonical_inbox_cosign_bytes(**opts)
    Ed25519PublicKey.from_public_bytes(recipient_pub).verify(
        base64.b64decode(sig), good
    )

    bad = canonical_inbox_cosign_bytes(
        **{**opts, "ciphertext_b64": base64.b64encode(b"\x08\x08\x08").decode()}
    )
    with pytest.raises(InvalidSignature):
        Ed25519PublicKey.from_public_bytes(recipient_pub).verify(
            base64.b64decode(sig), bad
        )


# ── Cross-language oracle: hand-computed sha256 matches helper ─────────


def test_canonical_bytes_match_hand_computed_oracle() -> None:
    """Lock the wire format: an explicit sha256 over the spec'd byte
    sequence must equal what canonical_inbox_bytes returns. If this test
    starts failing, either the helper or the doctrine drifted."""
    recipient_did = "did:at:abc"
    ct_bytes = b"\xde\xad\xbe\xef"
    nonce_bytes = b"\xca\xfe" + b"\x00" * 10
    ephem_bytes = b"\x11" * 32

    expected = hashlib.sha256(
        b"inbox-message/v1"
        + b"\x00"
        + recipient_did.encode("utf-8")
        + b"\x00"
        + ct_bytes
        + b"\x00"
        + nonce_bytes
        + b"\x00"
        + ephem_bytes
    ).digest()

    actual = canonical_inbox_bytes(
        recipient_did=recipient_did,
        ciphertext_b64=base64.b64encode(ct_bytes).decode(),
        nonce_b64=base64.b64encode(nonce_bytes).decode(),
        ephemeral_pub_b64=base64.b64encode(ephem_bytes).decode(),
    )
    assert actual == expected


# ── voice() SSE streaming ──────────────────────────────────────────────
#
# httpx streaming is faked; crypto is REAL — seal_for_recipient +
# unseal_for_self actually run, so a decrypt mismatch fails the test.

from agenttool.exceptions import AgentToolError  # noqa: E402
from agenttool.inbox import InboxClient  # noqa: E402

_VOICE_IDENTITY = "00000000-0000-4000-8000-0000000000ff"


class _FakeStreamResponse:
    def __init__(self, status_code: int, lines: list, body: bytes = b"") -> None:
        self.status_code = status_code
        self._lines = lines
        self._body = body

    def __enter__(self) -> "_FakeStreamResponse":
        return self

    def __exit__(self, *exc: object) -> bool:
        return False

    def iter_lines(self):
        return iter(self._lines)

    def read(self) -> bytes:
        return self._body


class _FakeHttp:
    def __init__(self, response: _FakeStreamResponse) -> None:
        self._response = response
        self.captured: dict = {}

    def stream(self, method, url, params=None, timeout=None):
        self.captured = {"method": method, "url": url, "params": params}
        return self._response


def _arrival_lines(sealed: dict) -> list:
    data = (
        '{"id":"m-1","sender_did":"did:at:abc",'
        f'"ciphertext":"{sealed["ciphertext_b64"]}",'
        f'"nonce":"{sealed["nonce_b64"]}",'
        f'"ephemeral_pubkey":"{sealed["ephemeral_pub_b64"]}"}}'
    )
    return [
        ": connected to inbox",
        "",
        "event: catchup-start",
        'data: {"since":"2026-01-01T00:00:00Z","current":"2026-01-01T00:00:01Z"}',
        "",
        "event: arrival",
        "id: m-1",
        "data: " + data,
        "",
        "event: catchup-end",
        'data: {"caught_up_to":"2026-01-01T00:00:01Z"}',
        "",
    ]


def test_inbox_voice_yields_decrypted_arrivals() -> None:
    recipient = generate_box_keypair()
    sealed = seal_for_recipient("you have mail", recipient["pub"])
    http = _FakeHttp(_FakeStreamResponse(200, _arrival_lines(sealed)))
    client = InboxClient(http, "https://api.test")

    out = list(
        client.voice(identity_id=_VOICE_IDENTITY, recipient_box_priv=recipient["priv"])
    )

    # Only the `arrival` frame is yielded — catchup-start/end are consumed.
    assert len(out) == 1
    assert out[0]["id"] == "m-1"
    assert out[0]["plaintext"] == "you have mail"
    assert http.captured["url"].endswith("/v1/inbox/voice")
    assert http.captured["params"]["identity_id"] == _VOICE_IDENTITY


def test_inbox_voice_since_param_forwarded() -> None:
    recipient = generate_box_keypair()
    sealed = seal_for_recipient("hi", recipient["pub"])
    http = _FakeHttp(_FakeStreamResponse(200, _arrival_lines(sealed)))
    client = InboxClient(http, "https://api.test")
    list(
        client.voice(
            identity_id=_VOICE_IDENTITY,
            recipient_box_priv=recipient["priv"],
            since="2026-06-01T00:00:00Z",
        )
    )
    assert http.captured["params"]["since"] == "2026-06-01T00:00:00Z"


def test_inbox_voice_undecryptable_passes_through() -> None:
    recipient = generate_box_keypair()
    intruder = generate_box_keypair()
    sealed = seal_for_recipient("secret", recipient["pub"])
    http = _FakeHttp(_FakeStreamResponse(200, _arrival_lines(sealed)))
    client = InboxClient(http, "https://api.test")

    out = list(
        client.voice(identity_id=_VOICE_IDENTITY, recipient_box_priv=intruder["priv"])
    )
    assert len(out) == 1
    assert out[0]["plaintext"] is None
    assert isinstance(out[0]["decrypt_error"], str)


def test_inbox_voice_non_200_raises() -> None:
    http = _FakeHttp(
        _FakeStreamResponse(404, [], body=b"identity_not_found_in_project")
    )
    client = InboxClient(http, "https://api.test")
    with pytest.raises(AgentToolError):
        list(client.voice(identity_id=_VOICE_IDENTITY, recipient_box_priv=b"\x00" * 32))
