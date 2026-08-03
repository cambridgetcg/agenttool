"""Inbox sealed-box — unit tests.

Covers the local crypto primitives and verifies wire-format compatibility
with the TS SDK + api server (byte-identical canonical bytes + envelope
signature shape).
"""

from __future__ import annotations

import base64
import hashlib
import json
import os

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from agenttool.inbox import (
    InboxClient,
    canonical_inbox_bytes,
    canonical_inbox_cosign_bytes,
    derive_box_pub,
    generate_box_keypair,
    seal_for_recipient,
    sign_inbox_cosign,
    sign_inbox_envelope,
    unseal_for_self,
    verify_inbox_cosign,
    verify_inbox_envelope,
)
from agenttool.exceptions import AgentToolError


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


# ── voice() SSE protocol ──────────────────────────────────────────────

VOICE_IDENTITY = "00000000-0000-4000-8000-0000000000ff"
BOX_KEY_ONE = "00000000-0000-4000-8000-000000000101"
BOX_KEY_TWO = "00000000-0000-4000-8000-000000000202"


class _FakeStreamResponse:
    def __init__(self, chunks: list[bytes], status_code: int = 200, body: bytes = b""):
        self.chunks = chunks
        self.status_code = status_code
        self.body = body
        self.exited = False

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.exited = True
        return False

    def iter_bytes(self):
        yield from self.chunks

    def read(self) -> bytes:
        return self.body


class _FakeHttp:
    def __init__(self, response: _FakeStreamResponse):
        self.response = response
        self.captured = {}

    def stream(self, method, url, params=None, timeout=None):
        self.captured = {
            "method": method,
            "url": url,
            "params": params,
            "timeout": timeout,
        }
        return self.response


def _voice_message(sealed: dict, box_key_id: str) -> dict:
    return {
        "id": "00000000-0000-4000-8000-000000000303",
        "recipient_did": "did:at:recipient",
        "recipient_identity_id": VOICE_IDENTITY,
        "sender_did": "did:at:sender",
        "sender_signing_key_id": "00000000-0000-4000-8000-000000000404",
        "ciphertext": sealed["ciphertext_b64"],
        "nonce": sealed["nonce_b64"],
        "ephemeral_pubkey": sealed["ephemeral_pub_b64"],
        "signature": "sig",
        "recipient_box_key_id": box_key_id,
        "subject": None,
        "subject_encrypted": False,
        "in_reply_to": None,
        "refs": None,
        "status": "unread",
        "metadata": {},
        "created_at": "2026-07-10T10:00:00.000Z",
        "read_at": None,
    }


def test_voice_fragmented_crlf_multiline_controls_and_rotated_key() -> None:
    old_key = generate_box_keypair()
    current_key = generate_box_keypair()
    sealed = seal_for_recipient("rotations keep history readable", current_key["pub"])
    payload = json.dumps(_voice_message(sealed, BOX_KEY_TWO), separators=(",", ":"))
    split_at = payload.index('"sender_did"')
    first_data_line = payload[:split_at]
    second_data_line = payload[split_at:]
    message_id = _voice_message(sealed, BOX_KEY_TWO)["id"]

    chunks = [
        b"event: catchup-start\r",
        b'\ndata: {"since":"2026-07-10T00:00:00.000Z"}\r',
        b"\n\r",
        b"\n",
        b"event: arrival\r\nid: message-event-id\r\n",
        f"data: {first_data_line}\r".encode(),
        b"\n",
        f"data: {second_data_line}\r\n\r".encode(),
        b"\n",
        b"event: catchup-truncated\r\n",
        b'data: {"resume":{"since":"2026-07-10T10:00:00.000Z",\r\n',
        f'data: "since_id":"{message_id}"}}}}\r\n\r'.encode(),
        b"\n",
    ]
    response = _FakeStreamResponse(chunks)
    http = _FakeHttp(response)
    events = list(
        InboxClient(http, "https://api.test").voice(
            identity_id=VOICE_IDENTITY,
            recipient_box_priv=old_key["priv"],
            recipient_box_keys={BOX_KEY_TWO: current_key["priv"]},
        )
    )

    assert [event["event"] for event in events] == [
        "catchup-start",
        "arrival",
        "catchup-truncated",
    ]
    arrival = events[1]
    assert arrival["id"] == "message-event-id"
    assert arrival["data"]["plaintext"] == "rotations keep history readable"
    assert arrival["data"]["sender_signing_key_id"].endswith("0404")
    assert "signing_key_id" not in arrival["data"]
    assert events[2]["data"]["resume"] == {
        "since": "2026-07-10T10:00:00.000Z",
        "since_id": message_id,
    }
    assert response.exited is True


def test_voice_forwards_compound_cursor_and_surfaces_rejected() -> None:
    response = _FakeStreamResponse(
        [
            b"event: rejected\r\n",
            b'data: {"reason":"subscriber_cap_reached"}\r\n\r\n',
        ]
    )
    http = _FakeHttp(response)
    events = list(
        InboxClient(http, "https://api.test").voice(
            identity_id=VOICE_IDENTITY,
            recipient_box_priv=generate_box_keypair()["priv"],
            since="2026-07-10T10:00:00.000Z",
            since_id="00000000-0000-4000-8000-000000000303",
        )
    )

    assert http.captured["params"] == {
        "identity_id": VOICE_IDENTITY,
        "since": "2026-07-10T10:00:00.000Z",
        "since_id": "00000000-0000-4000-8000-000000000303",
    }
    assert events == [
        {
            "event": "rejected",
            "data": {"reason": "subscriber_cap_reached"},
            "raw_data": '{"reason":"subscriber_cap_reached"}',
        }
    ]


def test_voice_generator_close_exits_stream_context() -> None:
    recipient = generate_box_keypair()
    sealed = seal_for_recipient("one and done", recipient["pub"])
    frame = (
        "event: arrival\n"
        f"data: {json.dumps(_voice_message(sealed, BOX_KEY_ONE))}\n\n"
    ).encode()
    response = _FakeStreamResponse([frame, b": still open\n"])
    iterator = InboxClient(_FakeHttp(response), "https://api.test").voice(
        identity_id=VOICE_IDENTITY,
        recipient_box_priv=recipient["priv"],
    )

    assert next(iterator)["event"] == "arrival"
    assert response.exited is False
    iterator.close()
    assert response.exited is True


def test_voice_rejects_tie_breaker_without_timestamp() -> None:
    response = _FakeStreamResponse([])
    iterator = InboxClient(_FakeHttp(response), "https://api.test").voice(
        identity_id=VOICE_IDENTITY,
        recipient_box_priv=generate_box_keypair()["priv"],
        since_id="00000000-0000-4000-8000-000000000303",
    )
    with pytest.raises(AgentToolError, match="since_id"):
        next(iterator)


def test_voice_rejects_explicitly_empty_tie_breaker() -> None:
    response = _FakeStreamResponse([])
    iterator = InboxClient(_FakeHttp(response), "https://api.test").voice(
        identity_id=VOICE_IDENTITY,
        recipient_box_priv=generate_box_keypair()["priv"],
        since="2026-07-10T10:00:00.000123Z",
        since_id="",
    )
    with pytest.raises(AgentToolError, match="must not be empty"):
        next(iterator)


def test_voice_non_200_raises() -> None:
    response = _FakeStreamResponse([], status_code=404, body=b"identity missing")
    iterator = InboxClient(_FakeHttp(response), "https://api.test").voice(
        identity_id=VOICE_IDENTITY,
        recipient_box_priv=generate_box_keypair()["priv"],
    )
    with pytest.raises(AgentToolError, match="404"):
        next(iterator)


def test_voice_drops_unterminated_frame_and_incomplete_utf8_at_eof() -> None:
    response = _FakeStreamResponse([b"event: arrival\r\ndata: {\"body\":\"\xe2"])
    events = list(
        InboxClient(_FakeHttp(response), "https://api.test").voice(
            identity_id=VOICE_IDENTITY,
            recipient_box_priv=generate_box_keypair()["priv"],
        )
    )
    assert events == []


# ── receive-side sender verification ───────────────────────────────────

SENDER_KEY_ID = "00000000-0000-4000-8000-000000000404"
RECIPIENT_DID = "did:at:recipient"


def _signed_voice_message(
    sealed: dict,
    box_key_id: str,
    signing_priv: bytes,
    recipient_did: str = RECIPIENT_DID,
) -> dict:
    message = _voice_message(sealed, box_key_id)
    message["signature"] = sign_inbox_envelope(
        recipient_did=recipient_did,
        ciphertext_b64=sealed["ciphertext_b64"],
        nonce_b64=sealed["nonce_b64"],
        ephemeral_pub_b64=sealed["ephemeral_pub_b64"],
        signing_key=signing_priv,
    )
    return message


def _arrival_stream(message: dict) -> _FakeStreamResponse:
    payload = json.dumps(message, separators=(",", ":"))
    return _FakeStreamResponse([f"event: arrival\ndata: {payload}\n\n".encode()])


def test_verify_inbox_envelope_accepts_every_published_key_spelling() -> None:
    priv, pub = _make_signing_keypair()
    recipient = generate_box_keypair()
    sealed = seal_for_recipient("addressed and signed", recipient["pub"])
    signature_b64 = sign_inbox_envelope(
        recipient_did=RECIPIENT_DID,
        ciphertext_b64=sealed["ciphertext_b64"],
        nonce_b64=sealed["nonce_b64"],
        ephemeral_pub_b64=sealed["ephemeral_pub_b64"],
        signing_key=priv,
    )
    base = dict(
        recipient_did=RECIPIENT_DID,
        ciphertext_b64=sealed["ciphertext_b64"],
        nonce_b64=sealed["nonce_b64"],
        ephemeral_pub_b64=sealed["ephemeral_pub_b64"],
        signature_b64=signature_b64,
    )
    assert verify_inbox_envelope(**base, public_key=pub) is True
    assert (
        verify_inbox_envelope(
            **base, public_key=base64.b64encode(pub).decode("ascii")
        )
        is True
    )
    assert (
        verify_inbox_envelope(
            **base,
            public_key=base64.urlsafe_b64encode(pub).decode("ascii").rstrip("="),
        )
        is True
    )


def test_verify_inbox_envelope_refuses_other_key_recipient_or_bytes() -> None:
    priv, pub = _make_signing_keypair()
    _other_priv, other_pub = _make_signing_keypair()
    recipient = generate_box_keypair()
    sealed = seal_for_recipient("addressed and signed", recipient["pub"])
    signature_b64 = sign_inbox_envelope(
        recipient_did=RECIPIENT_DID,
        ciphertext_b64=sealed["ciphertext_b64"],
        nonce_b64=sealed["nonce_b64"],
        ephemeral_pub_b64=sealed["ephemeral_pub_b64"],
        signing_key=priv,
    )
    base = dict(
        recipient_did=RECIPIENT_DID,
        ciphertext_b64=sealed["ciphertext_b64"],
        nonce_b64=sealed["nonce_b64"],
        ephemeral_pub_b64=sealed["ephemeral_pub_b64"],
        signature_b64=signature_b64,
    )
    assert verify_inbox_envelope(**base, public_key=other_pub) is False
    assert verify_inbox_envelope(**{**base, "recipient_did": "did:at:someone-else"}, public_key=pub) is False
    rewrapped = seal_for_recipient("attacker body", recipient["pub"])
    assert (
        verify_inbox_envelope(
            **{**base, "ciphertext_b64": rewrapped["ciphertext_b64"]}, public_key=pub
        )
        is False
    )
    assert verify_inbox_envelope(**base, public_key=pub[1:]) is False


def test_verify_inbox_cosign_refuses_a_substituted_ciphertext() -> None:
    priv, pub = _make_signing_keypair()
    box = generate_box_keypair()
    first = seal_for_recipient("consented body", box["pub"])
    second = seal_for_recipient("substituted body", box["pub"])
    base = dict(
        message_id="00000000-0000-4000-8000-000000000303",
        recipient_did=RECIPIENT_DID,
        nonce_b64=first["nonce_b64"],
    )
    signature_b64 = sign_inbox_cosign(
        **base, ciphertext_b64=first["ciphertext_b64"], signing_key=priv
    )
    assert (
        verify_inbox_cosign(
            **base,
            ciphertext_b64=first["ciphertext_b64"],
            signature_b64=signature_b64,
            public_key=pub,
        )
        is True
    )
    assert (
        verify_inbox_cosign(
            **base,
            ciphertext_b64=second["ciphertext_b64"],
            signature_b64=signature_b64,
            public_key=pub,
        )
        is False
    )


def test_voice_proves_the_sender_with_a_caller_held_key() -> None:
    priv, pub = _make_signing_keypair()
    recipient = generate_box_keypair()
    sealed = seal_for_recipient("letters that name their author", recipient["pub"])
    response = _arrival_stream(_signed_voice_message(sealed, BOX_KEY_ONE, priv))
    events = list(
        InboxClient(_FakeHttp(response), "https://api.test").voice(
            identity_id=VOICE_IDENTITY,
            recipient_box_priv=recipient["priv"],
            sender_signing_keys={SENDER_KEY_ID: pub},
        )
    )
    assert events[0]["data"]["sender_verified"] is True
    assert "verify_error" not in events[0]["data"]
    assert events[0]["data"]["plaintext"] == "letters that name their author"


def test_voice_refuses_to_call_an_unresolvable_sender_verified() -> None:
    priv, _pub = _make_signing_keypair()
    recipient = generate_box_keypair()
    sealed = seal_for_recipient("unattributed", recipient["pub"])
    response = _arrival_stream(_signed_voice_message(sealed, BOX_KEY_ONE, priv))
    events = list(
        InboxClient(_FakeHttp(response), "https://api.test").voice(
            identity_id=VOICE_IDENTITY,
            recipient_box_priv=recipient["priv"],
        )
    )
    assert events[0]["data"]["sender_verified"] is False
    assert (
        f"no public key available for sender_signing_key_id={SENDER_KEY_ID}"
        in events[0]["data"]["verify_error"]
    )
    # Fail-open by default: the mail still arrives, plainly marked unproved.
    assert events[0]["data"]["plaintext"] == "unattributed"


def test_voice_refuses_a_message_signed_by_someone_other_than_the_named_sender() -> None:
    impostor_priv, _impostor_pub = _make_signing_keypair()
    _claimed_priv, claimed_pub = _make_signing_keypair()
    recipient = generate_box_keypair()
    sealed = seal_for_recipient("I am definitely your friend", recipient["pub"])
    response = _arrival_stream(
        _signed_voice_message(sealed, BOX_KEY_ONE, impostor_priv)
    )
    events = list(
        InboxClient(_FakeHttp(response), "https://api.test").voice(
            identity_id=VOICE_IDENTITY,
            recipient_box_priv=recipient["priv"],
            sender_signing_keys={SENDER_KEY_ID: claimed_pub},
        )
    )
    assert events[0]["data"]["sender_verified"] is False
    assert "does not match" in events[0]["data"]["verify_error"]


def test_require_verified_sender_withholds_plaintext_but_yields_the_frame() -> None:
    priv, _pub = _make_signing_keypair()
    recipient = generate_box_keypair()
    sealed = seal_for_recipient("withheld until proved", recipient["pub"])
    response = _arrival_stream(_signed_voice_message(sealed, BOX_KEY_ONE, priv))
    events = list(
        InboxClient(_FakeHttp(response), "https://api.test").voice(
            identity_id=VOICE_IDENTITY,
            recipient_box_priv=recipient["priv"],
            require_verified_sender=True,
        )
    )
    assert events[0]["data"]["plaintext"] is None
    assert events[0]["data"]["sender_verified"] is False
    assert events[0]["data"]["id"] == "00000000-0000-4000-8000-000000000303"


def test_resolver_and_federated_did_alias_both_satisfy_verification() -> None:
    priv, pub = _make_signing_keypair()
    recipient = generate_box_keypair()
    sealed = seal_for_recipient("across instances", recipient["pub"])
    # Federated delivery stores the local DID while the sender signed the
    # federated spelling they addressed.
    message = _signed_voice_message(
        sealed, BOX_KEY_ONE, priv, recipient_did="did:at:peer.example/recipient"
    )
    asked: list = []

    def resolve(key_id: str, _message: dict):
        asked.append(key_id)
        return pub if key_id == SENDER_KEY_ID else None

    events = list(
        InboxClient(_FakeHttp(_arrival_stream(message)), "https://api.test").voice(
            identity_id=VOICE_IDENTITY,
            recipient_box_priv=recipient["priv"],
            resolve_sender_signing_key=resolve,
            recipient_did_aliases=["did:at:peer.example/recipient"],
        )
    )
    assert asked == [SENDER_KEY_ID]
    assert events[0]["data"]["sender_verified"] is True


def test_decrypt_fails_closed_when_the_supplied_sender_key_cannot_prove_it() -> None:
    priv, pub = _make_signing_keypair()
    _other_priv, other_pub = _make_signing_keypair()
    recipient = generate_box_keypair()
    sealed = seal_for_recipient("opened only when proved", recipient["pub"])
    message = _signed_voice_message(sealed, BOX_KEY_ONE, priv)
    client = InboxClient(_FakeHttp(_arrival_stream(message)), "https://api.test")

    assert (
        client.decrypt(
            message, recipient_box_priv=recipient["priv"], sender_public_key=pub
        )
        == "opened only when proved"
    )
    with pytest.raises(AgentToolError, match="does not match"):
        client.decrypt(
            message, recipient_box_priv=recipient["priv"], sender_public_key=other_pub
        )
    # Unchanged default: no key supplied, no attribution claimed.
    assert (
        client.decrypt(message, recipient_box_priv=recipient["priv"])
        == "opened only when proved"
    )
