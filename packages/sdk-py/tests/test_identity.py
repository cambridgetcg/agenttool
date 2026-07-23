"""Unit tests for the identity client — validates wire format and response parsing."""

from __future__ import annotations

import base64
import json
from unittest.mock import MagicMock, patch

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from agenttool import AgentTool
from agenttool.identity import (
    IdentityClient,
    canonical_identity_attestation_bytes,
    sign_identity_attestation,
)
from agenttool.exceptions import AgentToolError


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mock_response(status_code: int = 200, json_data: object = None) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.is_error = status_code >= 400
    resp.json.return_value = json_data if json_data is not None else {}
    resp.text = ""
    return resp


def _decode_jwt_segment(segment: str) -> object:
    padded = segment + "=" * (-len(segment) % 4)
    return json.loads(base64.urlsafe_b64decode(padded))


PRIVATE_KEY_BYTES = bytes(range(32))
PRIVATE_KEY_B64 = base64.b64encode(PRIVATE_KEY_BYTES).decode("ascii")
PUBLIC_KEY_B64 = base64.b64encode(
    Ed25519PrivateKey.from_private_bytes(PRIVATE_KEY_BYTES)
    .public_key()
    .public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
).decode("ascii")
IDENTITY_ID = "550e8400-e29b-41d4-a716-446655440001"
SUBJECT_ID = "550e8400-e29b-41d4-a716-446655440002"
KEY_ID = "550e8400-e29b-41d4-a716-446655440010"
SIGNATURE_B64 = base64.b64encode(bytes(64)).decode("ascii")


IDENTITY_PAYLOAD = {
    "identity": {
        "id": IDENTITY_ID,
        "did": f"did:at:{IDENTITY_ID}",
        "display_name": "test-agent",
        "capabilities": ["search", "code"],
        "metadata": {},
        "status": "active",
        "trust_score": 0.0,
        "created_at": "2026-03-17T04:00:00Z",
    },
    "key": {
        "kid": KEY_ID,
        "public_key": PUBLIC_KEY_B64,
        "private_key": PRIVATE_KEY_B64,
    },
}

ATTESTATION_PAYLOAD = {
    "id": "650e8400-e29b-41d4-a716-446655440001",
    "attester_id": IDENTITY_ID,
    "subject_id": SUBJECT_ID,
    "claim": "trustworthy",
    "claim_type": "general",
    "tier": "self",
    "evidence": None,
    "signature": SIGNATURE_B64,
    "kid": KEY_ID,
    "expires_at": None,
    "created_at": "2026-03-17T04:00:00Z",
}

@pytest.fixture
def at():
    client = AgentTool(api_key="test-key")
    yield client
    client.close()


# ---------------------------------------------------------------------------
# Identity CRUD
# ---------------------------------------------------------------------------

class TestIdentityRegister:
    def test_register_basic(self, at):
        with patch.object(at._http, "post", return_value=_mock_response(201, IDENTITY_PAYLOAD)) as mock_post:
            result = at.identity.register("test-agent")
            assert result["identity"]["did"].startswith("did:at:")
            assert result["key"]["private_key"] == PRIVATE_KEY_B64
            assert result["key"]["kid"] == KEY_ID
            mock_post.assert_called_once()
            payload = mock_post.call_args[1]["json"]
            assert payload["display_name"] == "test-agent"

    def test_register_with_capabilities(self, at):
        with patch.object(at._http, "post", return_value=_mock_response(201, IDENTITY_PAYLOAD)) as mock_post:
            at.identity.register("test-agent", capabilities=["search", "code"])
            payload = mock_post.call_args[1]["json"]
            assert payload["capabilities"] == ["search", "code"]

    def test_register_with_metadata(self, at):
        with patch.object(at._http, "post", return_value=_mock_response(201, IDENTITY_PAYLOAD)) as mock_post:
            at.identity.register("test-agent", metadata={"version": "1.0"})
            payload = mock_post.call_args[1]["json"]
            assert payload["metadata"] == {"version": "1.0"}

    def test_register_error_raises(self, at):
        with patch.object(at._http, "post", return_value=_mock_response(400, {"error": "bad request"})):
            with pytest.raises(AgentToolError):
                at.identity.register("test-agent")


class TestIdentityGet:
    def test_get_by_id(self, at):
        payload = IDENTITY_PAYLOAD["identity"]
        with patch.object(at._http, "get", return_value=_mock_response(200, payload)) as mock_get:
            result = at.identity.get("550e8400-e29b-41d4-a716-446655440001")
            assert result["id"] == IDENTITY_ID
            assert "550e8400" in mock_get.call_args[0][0]

    def test_get_not_found_raises(self, at):
        with patch.object(at._http, "get", return_value=_mock_response(404, {})):
            with pytest.raises(AgentToolError, match="not found"):
                at.identity.get("nonexistent-id")


class TestIdentityUpdate:
    def test_update_display_name(self, at):
        payload = {**IDENTITY_PAYLOAD["identity"], "display_name": "new-name"}
        with patch.object(at._http, "patch", return_value=_mock_response(200, payload)) as mock_patch:
            result = at.identity.update("id-abc", display_name="new-name")
            assert result["display_name"] == "new-name"
            call_payload = mock_patch.call_args[1]["json"]
            assert call_payload == {"display_name": "new-name"}

    def test_update_only_provided_fields(self, at):
        payload = IDENTITY_PAYLOAD["identity"]
        with patch.object(at._http, "patch", return_value=_mock_response(200, payload)) as mock_patch:
            at.identity.update("id-abc", capabilities=["new-cap"])
            call_payload = mock_patch.call_args[1]["json"]
            assert "display_name" not in call_payload
            assert call_payload["capabilities"] == ["new-cap"]


class TestIdentityRevoke:
    def test_revoke(self, at):
        with patch.object(at._http, "delete", return_value=_mock_response(200, {"revoked": True})):
            result = at.identity.revoke("id-abc")
            assert result["revoked"] is True


# ---------------------------------------------------------------------------
# Key Management
# ---------------------------------------------------------------------------

class TestKeyManagement:
    def test_add_key(self, at):
        key_payload = {
            "kid": KEY_ID,
            "public_key": PUBLIC_KEY_B64,
            "private_key": PRIVATE_KEY_B64,
            "label": "rotation",
        }
        with patch.object(at._http, "post", return_value=_mock_response(201, key_payload)) as mock_post:
            result = at.identity.add_key("id-abc", label="rotation")
            assert result["private_key"] == PRIVATE_KEY_B64
            call_payload = mock_post.call_args[1]["json"]
            assert call_payload["label"] == "rotation"

    def test_list_keys(self, at):
        keys_payload = {"keys": [{"kid": KEY_ID, "label": "primary", "active": True}]}
        with patch.object(at._http, "get", return_value=_mock_response(200, keys_payload)):
            result = at.identity.list_keys("id-abc")
            assert isinstance(result, list)
            assert result[0]["kid"] == KEY_ID

    def test_revoke_key(self, at):
        with patch.object(at._http, "delete", return_value=_mock_response(200, {"revoked": True})):
            result = at.identity.revoke_key("id-abc", "key-1")
            assert result["revoked"] is True

    def test_import_key(self, at):
        response = {"kid": KEY_ID, "public_key": PUBLIC_KEY_B64, "active": True}
        with patch.object(
            at._http, "post", return_value=_mock_response(201, response)
        ) as mock_post:
            result = at.identity.import_key(
                IDENTITY_ID, public_key=PUBLIC_KEY_B64, label="local"
            )
        assert result["kid"] == KEY_ID
        assert mock_post.call_args[1]["json"] == {
            "public_key": PUBLIC_KEY_B64,
            "label": "local",
        }


# ---------------------------------------------------------------------------
# Attestations
# ---------------------------------------------------------------------------

class TestAttestations:
    def test_canonical_payload_is_domain_separated_digest(self):
        canonical = canonical_identity_attestation_bytes(
            subject_id=SUBJECT_ID,
            attester_id=IDENTITY_ID,
            kid=KEY_ID,
            claim="值得信任",
        )
        assert len(canonical) == 32

    def test_shared_typescript_unicode_bytes_and_signature_vector(self):
        options = {
            "subject_id": SUBJECT_ID,
            "attester_id": IDENTITY_ID,
            "kid": KEY_ID,
            "claim": "理解 / understood",
            "evidence": 'line 1\\n"yes"',
        }
        canonical = canonical_identity_attestation_bytes(**options)
        assert canonical.hex() == (
            "01d83937ce8640296d4706ca0ed4f1c1aaf773aac361f79b444329a6482abf5a"
        )
        assert sign_identity_attestation(PRIVATE_KEY_B64, **options) == (
            "itOKYErSlkkWhQqhJncE2Stk7Z4mZirlVaCT3zAuDPBPb91fdCXoCK/mnoKhho7Fg"
            "sWoxD5mLY30WPfwaSj3Cg=="
        )

    def test_canonical_payload_binds_key_and_rejects_nul(self):
        options = {
            "subject_id": SUBJECT_ID,
            "attester_id": IDENTITY_ID,
            "kid": KEY_ID,
            "claim": "worked together",
        }
        assert canonical_identity_attestation_bytes(**options) != (
            canonical_identity_attestation_bytes(
                **{**options, "kid": "550e8400-e29b-41d4-a716-446655440011"}
            )
        )
        with pytest.raises(ValueError, match="no NUL"):
            canonical_identity_attestation_bytes(**{**options, "claim": "a\0b"})
        with pytest.raises(ValueError, match="well-formed Unicode"):
            canonical_identity_attestation_bytes(
                **{**options, "evidence": "broken\ud800text"}
            )

    def test_local_signature_verifies_over_canonical_payload(self):
        canonical = canonical_identity_attestation_bytes(
            subject_id=SUBJECT_ID,
            attester_id=IDENTITY_ID,
            kid=KEY_ID,
            claim="trustworthy",
            evidence="task:50",
        )
        signature = base64.b64decode(
            sign_identity_attestation(
                PRIVATE_KEY_B64,
                subject_id=SUBJECT_ID,
                attester_id=IDENTITY_ID,
                kid=KEY_ID,
                claim="trustworthy",
                evidence="task:50",
            )
        )
        public_key = Ed25519PrivateKey.from_private_bytes(
            PRIVATE_KEY_BYTES
        ).public_key()
        public_key.verify(signature, canonical)

    def test_attest(self, at):
        with patch.object(at._http, "post", return_value=_mock_response(201, ATTESTATION_PAYLOAD)) as mock_post:
            result = at.identity.attest(
                attester_id=IDENTITY_ID,
                subject_id=SUBJECT_ID,
                claim="trustworthy",
                signature=SIGNATURE_B64,
                kid=KEY_ID,
            )
            assert result["claim"] == "trustworthy"
            call_payload = mock_post.call_args[1]["json"]
            assert call_payload == {
                "attester_id": IDENTITY_ID,
                "subject_id": SUBJECT_ID,
                "claim": "trustworthy",
                "signature": SIGNATURE_B64,
                "kid": KEY_ID,
            }
            assert "private_key" not in call_payload

    def test_structured_evidence_is_rejected_before_network(self, at):
        with patch.object(at._http, "post") as mock_post:
            with pytest.raises(TypeError, match="evidence must be a string"):
                at.identity.attest(
                    attester_id=IDENTITY_ID,
                    subject_id=SUBJECT_ID,
                    claim="expert",
                    signature=SIGNATURE_B64,
                    kid=KEY_ID,
                    evidence={"tasks": 50},  # type: ignore[arg-type]
                )
        mock_post.assert_not_called()

    def test_get_attestation(self, at):
        with patch.object(at._http, "get", return_value=_mock_response(200, ATTESTATION_PAYLOAD)):
            result = at.identity.get_attestation("att-uuid-123")
            assert result["id"] == ATTESTATION_PAYLOAD["id"]

    def test_list_attestations_received(self, at):
        payload = {"attestations": [ATTESTATION_PAYLOAD]}
        with patch.object(at._http, "get", return_value=_mock_response(200, payload)) as mock_get:
            result = at.identity.list_attestations("id-abc")
            assert isinstance(result, list)
            # should NOT have /given suffix
            assert "/given" not in mock_get.call_args[0][0]

    def test_list_attestations_given(self, at):
        payload = {"attestations": [ATTESTATION_PAYLOAD]}
        with patch.object(at._http, "get", return_value=_mock_response(200, payload)) as mock_get:
            result = at.identity.list_attestations("id-abc", given=True)
            assert isinstance(result, list)
            assert "/given" in mock_get.call_args[0][0]

    def test_revoke_attestation(self, at):
        with patch.object(at._http, "delete", return_value=_mock_response(200, {"revoked": True})):
            result = at.identity.revoke_attestation("att-uuid-123")
            assert result["revoked"] is True


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------

class TestDiscover:
    def test_discover_basic(self, at):
        payload = {"identities": [IDENTITY_PAYLOAD["identity"]]}
        with patch.object(at._http, "get", return_value=_mock_response(200, payload)):
            result = at.identity.discover()
            assert isinstance(result, list)

    def test_discover_with_filters(self, at):
        payload = {"identities": []}
        with patch.object(at._http, "get", return_value=_mock_response(200, payload)) as mock_get:
            at.identity.discover(capability="search", min_trust=0.5, q="data")
            params = mock_get.call_args[1]["params"]
            assert params["capability"] == "search"
            assert params["min_trust"] == 0.5
            assert params["q"] == "data"

    def test_discover_default_limit(self, at):
        payload = {"identities": []}
        with patch.object(at._http, "get", return_value=_mock_response(200, payload)) as mock_get:
            at.identity.discover()
            params = mock_get.call_args[1]["params"]
            assert params["limit"] == 20


# ---------------------------------------------------------------------------
# Agent Tokens
# ---------------------------------------------------------------------------

class TestAgentTokens:
    def test_issue_token(self, at):
        identity = {"id": IDENTITY_ID, "did": f"did:at:{IDENTITY_ID}"}
        keys = {
            "keys": [{
                "kid": KEY_ID,
                "public_key": PUBLIC_KEY_B64,
                "active": True,
                "revoked_at": None,
            }]
        }
        with (
            patch.object(
                at._http,
                "get",
                side_effect=[_mock_response(200, identity), _mock_response(200, keys)],
            ) as mock_get,
            patch.object(at._http, "post") as mock_post,
            patch("agenttool.identity.time.time", return_value=1_700_000_000),
        ):
            result = at.identity.issue_token(
                IDENTITY_ID,
                private_key=PRIVATE_KEY_B64,
                key_id=KEY_ID,
                audience="did:at:recipient",
                scope=["memory.read"],
            )

        assert mock_get.call_count == 2
        mock_post.assert_not_called()
        header_segment, payload_segment, signature_segment = result["token"].split(".")
        assert _decode_jwt_segment(header_segment) == {
            "alg": "EdDSA",
            "kid": KEY_ID,
        }
        assert _decode_jwt_segment(payload_segment) == {
            "sub": f"did:at:{IDENTITY_ID}",
            "aud": "did:at:recipient",
            "iss": "agent-identity",
            "iat": 1_700_000_000,
            "exp": 1_700_003_600,
            "scope": ["memory.read"],
        }
        signature = base64.urlsafe_b64decode(
            signature_segment + "=" * (-len(signature_segment) % 4)
        )
        public_key = Ed25519PrivateKey.from_private_bytes(
            PRIVATE_KEY_BYTES
        ).public_key()
        public_key.verify(
            signature, f"{header_segment}.{payload_segment}".encode("ascii")
        )
        assert result["expires_at"] == "2023-11-14T23:13:20Z"

    def test_issue_token_caps_ttl_at_one_hour(self, at):
        identity = {"id": IDENTITY_ID, "did": f"did:at:{IDENTITY_ID}"}
        keys = {
            "keys": [{
                "kid": KEY_ID,
                "public_key": PUBLIC_KEY_B64,
                "active": True,
                "revoked_at": None,
            }]
        }
        with (
            patch.object(
                at._http,
                "get",
                side_effect=[_mock_response(200, identity), _mock_response(200, keys)],
            ),
            patch("agenttool.identity.time.time", return_value=1_700_000_000),
        ):
            result = at.identity.issue_token(
                IDENTITY_ID,
                private_key=PRIVATE_KEY_B64,
                key_id=KEY_ID,
                audience="did:at:recipient",
                ttl_seconds=7200,
            )
        payload = _decode_jwt_segment(result["token"].split(".")[1])
        assert payload["exp"] - payload["iat"] == 3600

    def test_issue_token_requires_audience_did(self, at):
        with pytest.raises(ValueError, match="audience must be a DID"):
            at.identity.issue_token(
                "id-abc",
                private_key=PRIVATE_KEY_B64,
                key_id=KEY_ID,
                audience="recipient",
            )

    def test_issue_token_rejects_invalid_private_key_before_network(self, at):
        short_key = base64.b64encode(b"short").decode("ascii")
        with patch.object(at._http, "get") as mock_get:
            with pytest.raises(ValueError, match="exactly 32 bytes"):
                at.identity.issue_token(
                    "id-abc",
                    private_key=short_key,
                    key_id=KEY_ID,
                    audience="did:at:recipient",
                )
        mock_get.assert_not_called()

    def test_verify_token_valid(self, at):
        verify_payload = {
            "valid": True,
            "payload": {"sub": "id-abc", "aud": "test", "exp": 9999999999},
        }
        with patch.object(at._http, "post", return_value=_mock_response(200, verify_payload)) as mock_post:
            result = at.identity.verify_token(
                "eyJ...", audience_did="did:at:recipient"
            )
            assert result["valid"] is True
            call_payload = mock_post.call_args[1]["json"]
            assert call_payload == {
                "token": "eyJ...",
                "audience_did": "did:at:recipient",
            }

    def test_verify_token_invalid_raises(self, at):
        verify_payload = {"valid": False, "error": "token expired"}
        with patch.object(at._http, "post", return_value=_mock_response(401, verify_payload)):
            with pytest.raises(AgentToolError, match="401"):
                at.identity.verify_token(
                    "expired-token", audience_did="did:at:recipient"
                )

    def test_issue_token_rejects_private_key_mismatch(self, at):
        other_private = Ed25519PrivateKey.generate()
        other_public = base64.b64encode(
            other_private.public_key().public_bytes(
                encoding=serialization.Encoding.Raw,
                format=serialization.PublicFormat.Raw,
            )
        ).decode("ascii")
        identity = {"id": IDENTITY_ID, "did": f"did:at:{IDENTITY_ID}"}
        keys = {
            "keys": [{
                "kid": KEY_ID,
                "public_key": other_public,
                "active": True,
                "revoked_at": None,
            }]
        }
        with patch.object(
            at._http,
            "get",
            side_effect=[_mock_response(200, identity), _mock_response(200, keys)],
        ):
            with pytest.raises(AgentToolError, match="does not match key_id"):
                at.identity.issue_token(
                    IDENTITY_ID,
                    private_key=PRIVATE_KEY_B64,
                    key_id=KEY_ID,
                    audience="did:at:recipient",
                )

    def test_verify_token_requires_audience_did(self, at):
        with pytest.raises(ValueError, match="audience_did must be a DID"):
            at.identity.verify_token("eyJ...", audience_did="recipient")


# ---------------------------------------------------------------------------
# IdentityClient is accessible via AgentTool
# ---------------------------------------------------------------------------

class TestClientIntegration:
    def test_identity_property_returns_client(self, at):
        assert isinstance(at.identity, IdentityClient)

    def test_identity_property_cached(self, at):
        client1 = at.identity
        client2 = at.identity
        assert client1 is client2
