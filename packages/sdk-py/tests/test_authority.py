import pytest

from agenttool.authority import (
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
