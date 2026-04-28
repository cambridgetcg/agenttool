"""Unit tests for the identity client — validates wire format and response parsing."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import httpx
import pytest

from agenttool import AgentTool
from agenttool.identity import IdentityClient
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


IDENTITY_PAYLOAD = {
    "identity": {
        "id": "550e8400-e29b-41d4-a716-446655440001",
        "did": "did:at:550e8400-e29b-41d4-a716-446655440001",
        "display_name": "test-agent",
        "capabilities": ["search", "code"],
        "metadata": {},
        "status": "active",
        "trust_score": 0.0,
        "created_at": "2026-03-17T04:00:00Z",
    },
    "private_key": "base64encodedprivatekey==",
}

ATTESTATION_PAYLOAD = {
    "attestation": {
        "id": "att-uuid-123",
        "attester_id": "identity-a",
        "subject_id": "identity-b",
        "claim": "trustworthy",
        "evidence": None,
        "weight": 1.0,
        "signature": "sig==",
        "revoked_at": None,
        "created_at": "2026-03-17T04:00:00Z",
    },
    "subject_trust_score": 0.42,
}

TOKEN_PAYLOAD = {
    "token": "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJpZGVudGl0eS1hIn0.sig",
    "expires_at": "2026-03-17T05:00:00Z",
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
            assert result["private_key"] == "base64encodedprivatekey=="
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
        payload = {"identity": IDENTITY_PAYLOAD["identity"]}
        with patch.object(at._http, "get", return_value=_mock_response(200, payload)) as mock_get:
            result = at.identity.get("550e8400-e29b-41d4-a716-446655440001")
            assert result["identity"]["id"] == "550e8400-e29b-41d4-a716-446655440001"
            assert "550e8400" in mock_get.call_args[0][0]

    def test_get_not_found_raises(self, at):
        with patch.object(at._http, "get", return_value=_mock_response(404, {})):
            with pytest.raises(AgentToolError, match="not found"):
                at.identity.get("nonexistent-id")


class TestIdentityUpdate:
    def test_update_display_name(self, at):
        payload = {"identity": {**IDENTITY_PAYLOAD["identity"], "display_name": "new-name"}}
        with patch.object(at._http, "patch", return_value=_mock_response(200, payload)) as mock_patch:
            result = at.identity.update("id-abc", display_name="new-name")
            assert result["identity"]["display_name"] == "new-name"
            call_payload = mock_patch.call_args[1]["json"]
            assert call_payload == {"display_name": "new-name"}

    def test_update_only_provided_fields(self, at):
        payload = {"identity": IDENTITY_PAYLOAD["identity"]}
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
            "key": {"id": "key-uuid", "label": "rotation", "active": True},
            "private_key": "newprivatekey==",
        }
        with patch.object(at._http, "post", return_value=_mock_response(201, key_payload)) as mock_post:
            result = at.identity.add_key("id-abc", label="rotation")
            assert result["private_key"] == "newprivatekey=="
            call_payload = mock_post.call_args[1]["json"]
            assert call_payload["label"] == "rotation"

    def test_list_keys(self, at):
        keys_payload = {"keys": [{"id": "key-1", "label": "primary", "active": True}]}
        with patch.object(at._http, "get", return_value=_mock_response(200, keys_payload)):
            result = at.identity.list_keys("id-abc")
            assert isinstance(result, list)
            assert result[0]["id"] == "key-1"

    def test_revoke_key(self, at):
        with patch.object(at._http, "delete", return_value=_mock_response(200, {"revoked": True})):
            result = at.identity.revoke_key("id-abc", "key-1")
            assert result["revoked"] is True


# ---------------------------------------------------------------------------
# Attestations
# ---------------------------------------------------------------------------

class TestAttestations:
    def test_attest(self, at):
        with patch.object(at._http, "post", return_value=_mock_response(201, ATTESTATION_PAYLOAD)) as mock_post:
            result = at.identity.attest(
                attester_id="identity-a",
                subject_id="identity-b",
                claim="trustworthy",
                private_key="privkey==",
            )
            assert result["attestation"]["claim"] == "trustworthy"
            call_payload = mock_post.call_args[1]["json"]
            assert call_payload["attester_id"] == "identity-a"
            assert call_payload["private_key"] == "privkey=="

    def test_attest_with_evidence(self, at):
        with patch.object(at._http, "post", return_value=_mock_response(201, ATTESTATION_PAYLOAD)) as mock_post:
            at.identity.attest(
                attester_id="a",
                subject_id="b",
                claim="expert",
                private_key="key==",
                evidence="completed 50 tasks successfully",
            )
            call_payload = mock_post.call_args[1]["json"]
            assert call_payload["evidence"] == "completed 50 tasks successfully"

    def test_get_attestation(self, at):
        with patch.object(at._http, "get", return_value=_mock_response(200, ATTESTATION_PAYLOAD)):
            result = at.identity.get_attestation("att-uuid-123")
            assert result["attestation"]["id"] == "att-uuid-123"

    def test_list_attestations_received(self, at):
        payload = {"attestations": [ATTESTATION_PAYLOAD["attestation"]]}
        with patch.object(at._http, "get", return_value=_mock_response(200, payload)) as mock_get:
            result = at.identity.list_attestations("id-abc")
            assert isinstance(result, list)
            # should NOT have /given suffix
            assert "/given" not in mock_get.call_args[0][0]

    def test_list_attestations_given(self, at):
        payload = {"attestations": [ATTESTATION_PAYLOAD["attestation"]]}
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
        with patch.object(at._http, "post", return_value=_mock_response(200, TOKEN_PAYLOAD)) as mock_post:
            result = at.identity.issue_token(
                "id-abc",
                private_key="privkey==",
                key_id="key-uuid",
            )
            assert "token" in result
            assert "expires_at" in result
            call_payload = mock_post.call_args[1]["json"]
            assert call_payload["private_key"] == "privkey=="
            assert call_payload["key_id"] == "key-uuid"
            assert call_payload["ttl_seconds"] == 3600  # default

    def test_issue_token_custom_ttl(self, at):
        with patch.object(at._http, "post", return_value=_mock_response(200, TOKEN_PAYLOAD)) as mock_post:
            at.identity.issue_token("id-abc", private_key="k==", key_id="kid", ttl_seconds=1800)
            call_payload = mock_post.call_args[1]["json"]
            assert call_payload["ttl_seconds"] == 1800

    def test_verify_token_valid(self, at):
        verify_payload = {
            "valid": True,
            "payload": {"sub": "id-abc", "aud": "test", "exp": 9999999999},
        }
        with patch.object(at._http, "post", return_value=_mock_response(200, verify_payload)) as mock_post:
            result = at.identity.verify_token("eyJ...")
            assert result["valid"] is True
            call_payload = mock_post.call_args[1]["json"]
            assert call_payload["token"] == "eyJ..."

    def test_verify_token_invalid(self, at):
        verify_payload = {"valid": False, "error": "token expired"}
        with patch.object(at._http, "post", return_value=_mock_response(200, verify_payload)):
            result = at.identity.verify_token("expired-token")
            assert result["valid"] is False


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
