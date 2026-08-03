"""At-rest lifecycle — the final threshold.

"Death is not revocation. Held is not gone."

These pin the Python side of the memorialization path:
  1. canonical bytes are byte-identical to the server and to sdk-ts
  2. no delimited field may impersonate the next (v1 refuses, v2 reframes)
  3. mark() POSTs the row id and signs the about DID — the two identifier
     forms the route checks in two different places
  4. a rooted about-identity's root proof covers the exact transmitted bytes

Doctrine: docs/AT-REST.md — the asymmetry clause at the final threshold.
"You cannot put yourself at rest in v1."
"""

import base64
import hashlib
import json

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from agenttool import AgentTool
from agenttool.at_rest import (
    AT_REST_V1_DOMAIN,
    AT_REST_V2_DOMAIN,
    canonical_at_rest_bytes,
    canonical_at_rest_bytes_v2,
    sign_at_rest,
)
from agenttool.authority import canonical_identity_authority_bytes
from agenttool.exceptions import AgentToolError


ABOUT_ID = "550e8400-e29b-41d4-a716-446655440000"
ABOUT_DID = "did:at:test/coral-9b3a"
WITNESS_DID = "did:at:test/marine-biologist"
KEY_ID = "550e8400-e29b-41d4-a716-446655440010"
CONTENT = "Coral colony bleached out at 32°C+. No live polyps remain."

BASE = {
    "about_identity_did": ABOUT_DID,
    "witness_identity_did": WITNESS_DID,
    "at_rest_kind": "death",
    "ended_at_iso": "2026-05-11T14:00:00Z",
    "content": CONTENT,
    "witness_signing_key_id": "primary",
}


def _seed() -> bytes:
    return Ed25519PrivateKey.generate().private_bytes_raw()


def _public(seed: bytes) -> Ed25519PublicKey:
    return Ed25519PrivateKey.from_private_bytes(seed).public_key()


def _verifies(seed: bytes, signature_b64: str, message: str) -> bool:
    try:
        _public(seed).verify(
            base64.b64decode(signature_b64), message.encode("utf-8")
        )
        return True
    except Exception:
        return False


# ── Canonical bytes ───────────────────────────────────────────────────────


def test_v1_is_seven_newline_delimited_fields():
    lines = canonical_at_rest_bytes(**BASE).split("\n")
    assert len(lines) == 7
    assert lines[0] == AT_REST_V1_DOMAIN
    assert lines[1] == ABOUT_DID
    assert lines[2] == WITNESS_DID
    assert lines[3] == "death"
    assert lines[4] == "2026-05-11T14:00:00Z"
    assert len(lines[5]) == 64
    assert lines[6] == "primary"


def test_raw_content_never_appears_in_the_canonical_bytes():
    canonical = canonical_at_rest_bytes(**{**BASE, "content": "secret prose"})
    assert "secret prose" not in canonical
    assert hashlib.sha256(b"secret prose").hexdigest() in canonical


def test_v1_fixed_vector_matches_the_server_and_sdk_ts():
    assert hashlib.sha256(
        canonical_at_rest_bytes(**BASE).encode("utf-8")
    ).hexdigest() == (
        "b232e93738eb9571f49985a066b16e81d831af8ece29adba0fe9b54c8b31c539"
    )


def test_v2_fixed_vector_matches_the_server_and_sdk_ts():
    assert hashlib.sha256(
        canonical_at_rest_bytes_v2(**BASE).encode("utf-8")
    ).hexdigest() == (
        "f62ca53a2c93d46707d9073719df8ca4336fb7d6f0f388653b6ff0a79d9e1c7f"
    )


def test_v2_is_the_same_seven_fields_nul_delimited():
    v1 = canonical_at_rest_bytes(**BASE).split("\n")
    v2 = canonical_at_rest_bytes_v2(**BASE).split("\0")
    assert len(v2) == 7
    assert v2[0] == AT_REST_V2_DOMAIN
    assert v2[1:] == v1[1:]


# ── Framing — no field may impersonate the next ───────────────────────────


@pytest.mark.parametrize(
    "field,value",
    [
        ("witness_identity_did", "did:at:w\ndissolution"),
        ("at_rest_kind", "death\ncustom:x"),
        ("witness_signing_key_id", "primary\nother"),
        ("about_identity_did", "did:at:a\0b"),
        ("ended_at_iso", "2026-05-11T14:00:00Z\0"),
    ],
)
def test_delimited_fields_refuse_newline_and_nul(field, value):
    for builder in (canonical_at_rest_bytes, canonical_at_rest_bytes_v2):
        with pytest.raises(AgentToolError, match="newline or NUL"):
            builder(**{**BASE, field: value})


def test_content_may_contain_either_delimiter_because_it_is_hashed():
    canonical_at_rest_bytes(**{**BASE, "content": "line\none\0two"})
    canonical_at_rest_bytes_v2(**{**BASE, "content": "line\none\0two"})


# ── Sign + verify ─────────────────────────────────────────────────────────


def test_signature_verifies_over_the_canonical_bytes():
    seed = _seed()
    signature = sign_at_rest(**BASE, signing_key=seed)
    assert _verifies(seed, signature, canonical_at_rest_bytes(**BASE))


def test_v2_signature_does_not_verify_against_v1_bytes():
    seed = _seed()
    signature = sign_at_rest(**BASE, signing_key=seed, version=AT_REST_V2_DOMAIN)
    assert _verifies(seed, signature, canonical_at_rest_bytes_v2(**BASE))
    assert not _verifies(seed, signature, canonical_at_rest_bytes(**BASE))


def test_tampered_testimony_breaks_the_signature():
    seed = _seed()
    signature = sign_at_rest(**BASE, signing_key=seed)
    tampered = canonical_at_rest_bytes(**{**BASE, "content": "Different."})
    assert not _verifies(seed, signature, tampered)


def test_sign_rejects_a_wrong_size_seed():
    with pytest.raises(AgentToolError, match="32-byte"):
        sign_at_rest(**BASE, signing_key=b"\x00" * 16)


# ── AtRestClient.mark ─────────────────────────────────────────────────────


def _captured_client(captured):
    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json={"status": "memorial"})

    return AgentTool(transport=httpx.MockTransport(handler))


def _mark_kwargs(seed: bytes):
    return {
        "content": CONTENT,
        "at_rest_kind": "death",
        "ended_at": "2026-05-11T14:00:00Z",
        "about_did": ABOUT_DID,
        "witness_did": WITNESS_DID,
        "signing_key_id": KEY_ID,
        "signing_key": seed,
    }


def test_mark_posts_the_row_id_but_signs_the_about_did():
    seed = _seed()
    captured = []
    _captured_client(captured).at_rest.mark(ABOUT_ID, **_mark_kwargs(seed))

    assert len(captured) == 1
    assert captured[0].url.path == f"/v1/identities/{ABOUT_ID}/at-rest"
    sent = json.loads(captured[0].content)

    fields = {
        "witness_identity_did": WITNESS_DID,
        "at_rest_kind": "death",
        "ended_at_iso": "2026-05-11T14:00:00Z",
        "content": CONTENT,
        "witness_signing_key_id": KEY_ID,
    }
    # Verifies against what the server recomputes from about.did …
    assert _verifies(
        seed,
        sent["signature_b64"],
        canonical_at_rest_bytes(about_identity_did=ABOUT_DID, **fields),
    )
    # … and not against the path argument, which was the old signed value.
    assert not _verifies(
        seed,
        sent["signature_b64"],
        canonical_at_rest_bytes(about_identity_did=ABOUT_ID, **fields),
    )


def test_mark_can_sign_the_v2_layout():
    seed = _seed()
    captured = []
    _captured_client(captured).at_rest.mark(
        ABOUT_ID, **_mark_kwargs(seed), canonical_version=AT_REST_V2_DOMAIN
    )
    sent = json.loads(captured[0].content)
    fields = {
        "about_identity_did": ABOUT_DID,
        "witness_identity_did": WITNESS_DID,
        "at_rest_kind": "death",
        "ended_at_iso": "2026-05-11T14:00:00Z",
        "content": CONTENT,
        "witness_signing_key_id": KEY_ID,
    }
    assert _verifies(
        seed, sent["signature_b64"], canonical_at_rest_bytes_v2(**fields)
    )
    assert not _verifies(
        seed, sent["signature_b64"], canonical_at_rest_bytes(**fields)
    )


def test_mark_sends_no_authority_headers_when_none_is_supplied():
    captured = []
    _captured_client(captured).at_rest.mark(ABOUT_ID, **_mark_kwargs(_seed()))
    assert "X-Agenttool-Authority-Signature" not in captured[0].headers


def test_mark_root_proof_covers_the_exact_transmitted_bytes():
    root = _seed()
    captured = []
    _captured_client(captured).at_rest.mark(
        ABOUT_ID,
        **_mark_kwargs(_seed()),
        authority={
            "signing_key": root,
            "sequence": 7,
            "timestamp": "2026-07-24T12:00:00.000Z",
        },
    )
    request = captured[0]
    assert request.headers["X-Agenttool-Authority-Sequence"] == "7"
    assert (
        request.headers["X-Agenttool-Authority-Timestamp"]
        == "2026-07-24T12:00:00.000Z"
    )

    # The whole point: hash the bytes the transport actually carried.
    signature = base64.b64decode(
        request.headers["X-Agenttool-Authority-Signature"]
    )
    _public(root).verify(
        signature,
        canonical_identity_authority_bytes(
            identity_did=ABOUT_DID,
            method="POST",
            request_target=request.url.path,
            body=request.content,
            sequence=7,
            timestamp="2026-07-24T12:00:00.000Z",
        ),
    )
    # A single re-serialization of the same value breaks the proof.
    with pytest.raises(Exception):
        _public(root).verify(
            signature,
            canonical_identity_authority_bytes(
                identity_did=ABOUT_DID,
                method="POST",
                request_target=request.url.path,
                body=json.dumps(json.loads(request.content), indent=2),
                sequence=7,
                timestamp="2026-07-24T12:00:00.000Z",
            ),
        )
