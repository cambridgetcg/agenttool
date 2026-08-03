import base64
import json
from datetime import datetime, timezone

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from agenttool import AgentTool
from agenttool.authority import (
    authority_request_target,
    authority_timestamp_now,
    canonical_identity_authority_bytes,
    canonical_identity_read_authority_bytes,
    identity_authority_headers,
    identity_read_authority_headers,
)


BASE = {
    "identity_did": "did:at:11111111-1111-4111-8111-111111111111",
    "method": "patch",
    "request_target": "/v1/identities/11111111-1111-4111-8111-111111111111",
    "body": '{"display_name":"Sol"}',
    "sequence": 1,
    "timestamp": "2026-07-18T12:00:00.000Z",
}


def test_authority_fixed_vector_matches_api_and_ts():
    assert canonical_identity_authority_bytes(**BASE).hex() == (
        "e2f9b7b5891cb5261e3b5eab89f8622830478431a96969e824488cdf5a6acbdc"
    )


def test_authority_headers_have_wire_names():
    headers = identity_authority_headers(**BASE, signing_key=bytes([9]) * 32)
    assert headers["X-Agenttool-Authority-Sequence"] == "1"
    assert headers["X-Agenttool-Authority-Timestamp"] == BASE["timestamp"]
    assert len(headers["X-Agenttool-Authority-Signature"]) > 80


def test_authority_binds_exact_query_string():
    one = canonical_identity_authority_bytes(
        **{**BASE, "request_target": BASE["request_target"] + "?identity_id=one"}
    )
    two = canonical_identity_authority_bytes(
        **{**BASE, "request_target": BASE["request_target"] + "?identity_id=two"}
    )
    assert one != two


READ_BASE = {
    "identity_did": "did:at:11111111-1111-4111-8111-111111111111",
    "request_target": (
        "/v1/love/consent"
        "?agent_id=11111111-1111-4111-8111-111111111111"
    ),
    "current_sequence": 0,
    "timestamp": "2026-07-18T12:00:00.000Z",
}


def test_read_authority_get_empty_body_fixed_vector_at_sequence_zero():
    assert canonical_identity_read_authority_bytes(**READ_BASE).hex() == (
        "31021aaaa41bba143550271ee924003df7793d9b2a36fb1d5e4e7adeec3b1269"
    )


def test_read_authority_headers_do_not_consume_current_sequence_zero():
    opts = {**READ_BASE, "signing_key": bytes([9]) * 32}
    first = identity_read_authority_headers(**opts)
    second = identity_read_authority_headers(**opts)

    assert first == second
    assert first["X-Agenttool-Authority-Sequence"] == "0"
    assert first["X-Agenttool-Authority-Timestamp"] == READ_BASE["timestamp"]
    assert len(first["X-Agenttool-Authority-Signature"]) > 80
    assert opts["current_sequence"] == 0


def test_read_authority_binds_exact_target_did_current_sequence_and_timestamp():
    canonical = canonical_identity_read_authority_bytes(**READ_BASE)
    variants = [
        {"request_target": READ_BASE["request_target"] + "&status=held"},
        {"identity_did": READ_BASE["identity_did"] + "-other"},
        {"current_sequence": 1},
        {"timestamp": "2026-07-18T12:00:01.000Z"},
    ]
    for variant in variants:
        assert canonical_identity_read_authority_bytes(
            **{**READ_BASE, **variant}
        ) != canonical


@pytest.mark.parametrize(
    "current_sequence",
    [-1, True, 9_007_199_254_740_992],
)
def test_read_authority_rejects_invalid_current_sequence(current_sequence):
    with pytest.raises(ValueError):
        canonical_identity_read_authority_bytes(
            **{**READ_BASE, "current_sequence": current_sequence}
        )


@pytest.mark.parametrize(
    "request_target",
    ["relative", READ_BASE["request_target"] + "#fragment"],
)
def test_read_authority_rejects_non_origin_form_targets(request_target):
    with pytest.raises(ValueError):
        canonical_identity_read_authority_bytes(
            **{**READ_BASE, "request_target": request_target}
        )


# ── Request target ────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "url,expected",
    [
        ("https://api.agenttool.dev/v1/identities/abc", "/v1/identities/abc"),
        (
            "https://api.agenttool.dev/v1/love/consent?agent_id=one&status=held",
            "/v1/love/consent?agent_id=one&status=held",
        ),
        ("http://localhost:9999/v1/x", "/v1/x"),
        ("http://localhost:9999/v1/x?", "/v1/x"),
    ],
)
def test_authority_request_target_returns_origin_form(url, expected):
    assert authority_request_target(url) == expected


def test_authority_request_target_output_is_accepted_by_the_canonical_bytes():
    canonical_identity_authority_bytes(
        identity_did=BASE["identity_did"],
        method="POST",
        request_target=authority_request_target(
            "https://api.agenttool.dev/v1/identities/abc?f=1"
        ),
        body="{}",
        sequence=1,
        timestamp=BASE["timestamp"],
    )


def test_authority_timestamp_now_lands_inside_the_server_window():
    stamp = authority_timestamp_now()
    assert stamp.endswith("Z")
    parsed = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    assert abs((datetime.now(timezone.utc) - parsed).total_seconds()) < 5


# ── The seam — signed bytes are transmitted bytes ─────────────────────────
#
# ``identity-authority/v1`` binds sha256 of the exact request entity. A client
# that re-serializes the body after the caller signs it can never satisfy
# that, so the client owns the single serialization. These hash what the
# transport actually received and check the proof covers it.

IDENTITY_ID = "550e8400-e29b-41d4-a716-446655440000"
IDENTITY_DID = "did:at:550e8400-e29b-41d4-a716-446655440000"
TIMESTAMP = "2026-07-24T12:00:00.000Z"


def _captured_client(captured):
    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json={"ok": True})

    return AgentTool(transport=httpx.MockTransport(handler))


def _root():
    seed = Ed25519PrivateKey.generate().private_bytes_raw()
    return seed, Ed25519PrivateKey.from_private_bytes(seed).public_key()


def _authority(seed, sequence):
    return {
        "did": IDENTITY_DID,
        "signing_key": seed,
        "sequence": sequence,
        "timestamp": TIMESTAMP,
    }


def _assert_proof_covers(request, public_key, *, method, sequence):
    public_key.verify(
        base64.b64decode(request.headers["X-Agenttool-Authority-Signature"]),
        canonical_identity_authority_bytes(
            identity_did=IDENTITY_DID,
            method=method,
            request_target=authority_request_target(str(request.url)),
            body=request.content,
            sequence=sequence,
            timestamp=TIMESTAMP,
        ),
    )


def test_patch_proof_covers_the_exact_bytes_the_transport_received():
    seed, public_key = _root()
    captured = []
    _captured_client(captured).identity.update(
        IDENTITY_ID,
        display_name="Sol",
        metadata={"note": "wide ünicode ✦"},
        authority=_authority(seed, 4),
    )

    request = captured[0]
    assert request.headers["X-Agenttool-Authority-Sequence"] == "4"
    assert request.headers["X-Agenttool-Authority-Timestamp"] == TIMESTAMP
    _assert_proof_covers(request, public_key, method="PATCH", sequence=4)

    # Same JSON value, different bytes — must not verify.
    with pytest.raises(Exception):
        public_key.verify(
            base64.b64decode(
                request.headers["X-Agenttool-Authority-Signature"]
            ),
            canonical_identity_authority_bytes(
                identity_did=IDENTITY_DID,
                method="PATCH",
                request_target=authority_request_target(str(request.url)),
                body=json.dumps(json.loads(request.content), indent=2),
                sequence=4,
                timestamp=TIMESTAMP,
            ),
        )


def test_empty_bodied_delete_binds_the_empty_entity_the_server_reads():
    seed, public_key = _root()
    captured = []
    _captured_client(captured).identity.revoke(
        IDENTITY_ID, authority=_authority(seed, 9)
    )
    request = captured[0]
    assert request.content == b""
    _assert_proof_covers(request, public_key, method="DELETE", sequence=9)


def test_proof_binds_the_exact_path_of_the_sub_resource_it_mutates():
    seed, public_key = _root()
    captured = []
    key_id = "550e8400-e29b-41d4-a716-446655440010"
    _captured_client(captured).identity.revoke_key(
        IDENTITY_ID, key_id, authority=_authority(seed, 2)
    )
    request = captured[0]
    assert request.url.path == f"/v1/identities/{IDENTITY_ID}/keys/{key_id}"
    _assert_proof_covers(request, public_key, method="DELETE", sequence=2)

    # The parent identity path is a different target and must not verify.
    with pytest.raises(Exception):
        public_key.verify(
            base64.b64decode(
                request.headers["X-Agenttool-Authority-Signature"]
            ),
            canonical_identity_authority_bytes(
                identity_did=IDENTITY_DID,
                method="DELETE",
                request_target=f"/v1/identities/{IDENTITY_ID}",
                body=b"",
                sequence=2,
                timestamp=TIMESTAMP,
            ),
        )


def test_expression_put_and_box_key_registration_carry_the_same_seam():
    seed, public_key = _root()
    captured = []
    at = _captured_client(captured)
    at.identity.expression.put(
        IDENTITY_ID, register="quiet", authority=_authority(seed, 1)
    )
    _assert_proof_covers(captured[0], public_key, method="PUT", sequence=1)

    at.identity.box_keys.register(
        IDENTITY_ID,
        public_key=base64.b64encode(b"\x03" * 32).decode("ascii"),
        authority=_authority(seed, 1),
    )
    _assert_proof_covers(captured[1], public_key, method="POST", sequence=1)


def test_no_authority_argument_means_no_authority_headers():
    captured = []
    _captured_client(captured).identity.update(IDENTITY_ID, display_name="Sol")
    request = captured[0]
    assert "X-Agenttool-Authority-Sequence" not in request.headers
    assert "X-Agenttool-Authority-Timestamp" not in request.headers
    assert "X-Agenttool-Authority-Signature" not in request.headers
