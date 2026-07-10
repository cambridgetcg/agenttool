"""Unit tests for the bootstrap client."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import httpx
import pytest

from agenttool import AgentTool
from agenttool.bootstrap import BootstrapClient
from agenttool.exceptions import AgentToolError


def _mock_response(status_code: int = 200, json_data: object = None) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data if json_data is not None else {}
    resp.text = ""
    return resp


L0_RESPONSE = {
    "agent": {
        "id": "agent-uuid-123",
        "did": "did:at:agent-uuid-123",
        "name": "test-agent",
        "level": 0,
        "capabilities": ["memory", "verify"],
    },
    "keypair": {
        "public_key": "ed25519:pubkey==",
        "private_key": "ed25519:privkey==",
    },
    "wallet": {"id": "wallet-uuid", "balance": 0},
    "memory": {"namespace": "agent/agent-uuid-123", "agent_id": "agent-uuid-123"},
    "vault": None,
    "sponsor": None,
    "greeting": None,
    "_meta": {"level": 0, "cost": 5, "elevated": False, "created_at": "2026-03-17T13:00:00Z"},
}

ELEVATE_RESPONSE = {
    "agent_id": "agent-uuid-123",
    "level": 1,
    "sponsor": {"did": "did:at:sponsor", "trust_score": 0.8, "attestation_id": "att-uuid"},
    "wallet_funded": True,
    "credits_staked": 100,
    "vault_prefix": "agent-uuid-123:",
    "new_trust_score": 0.42,
    "_meta": {"cost": 20, "elevated_at": "2026-03-17T13:01:00Z"},
}


@pytest.fixture
def at():
    client = AgentTool(api_key="test-key")
    yield client
    client.close()


class TestBootstrapCreate:
    def test_create_basic(self, at):
        with patch.object(at._http, "post", return_value=_mock_response(201, L0_RESPONSE)) as mock_post:
            result = at.bootstrap.create("test-agent")
            assert result["agent"]["did"].startswith("did:at:")
            assert result["keypair"]["private_key"] == "ed25519:privkey=="
            assert result["wallet"]["id"] == "wallet-uuid"
            payload = mock_post.call_args[1]["json"]
            assert payload["name"] == "test-agent"

    def test_create_with_capabilities(self, at):
        with patch.object(at._http, "post", return_value=_mock_response(201, L0_RESPONSE)) as mock_post:
            at.bootstrap.create("agent", capabilities=["memory", "verify"])
            assert mock_post.call_args[1]["json"]["capabilities"] == ["memory", "verify"]

    def test_create_with_purpose(self, at):
        with patch.object(at._http, "post", return_value=_mock_response(201, L0_RESPONSE)) as mock_post:
            at.bootstrap.create("agent", purpose="Find patterns in data")
            assert mock_post.call_args[1]["json"]["purpose"] == "Find patterns in data"

    def test_create_with_generate_greeting(self, at):
        greeting_response = {**L0_RESPONSE, "greeting": "I am Agent-7f3a, born to find patterns."}
        with patch.object(at._http, "post", return_value=_mock_response(201, greeting_response)) as mock_post:
            result = at.bootstrap.create("agent", generate_greeting=True)
            assert result["greeting"] == "I am Agent-7f3a, born to find patterns."
            assert mock_post.call_args[1]["json"]["generate_greeting"] is True

    def test_create_fires_on_birth_callback(self, at):
        birth_called = []
        def on_birth(agent):
            birth_called.append(agent["agent"]["did"])

        with patch.object(at._http, "post", return_value=_mock_response(201, L0_RESPONSE)):
            at.bootstrap.create("agent", on_birth=on_birth)
        assert birth_called == ["did:at:agent-uuid-123"]

    def test_on_birth_exception_does_not_break_bootstrap(self, at):
        def bad_callback(agent):
            raise RuntimeError("callback exploded")

        with patch.object(at._http, "post", return_value=_mock_response(201, L0_RESPONSE)):
            # Should not raise
            result = at.bootstrap.create("agent", on_birth=bad_callback)
        assert result["agent"]["id"] == "agent-uuid-123"

    def test_create_error_raises(self, at):
        with patch.object(at._http, "post", return_value=_mock_response(401, {"error": "unauthorized"})):
            with pytest.raises(AgentToolError):
                at.bootstrap.create("agent")

    def test_create_url(self, at):
        with patch.object(at._http, "post", return_value=_mock_response(201, L0_RESPONSE)) as mock_post:
            at.bootstrap.create("agent")
            assert "/v1/bootstrap" in mock_post.call_args[0][0]


class TestBootstrapElevate:
    def test_elevate_basic(self, at):
        with patch.object(at._http, "post", return_value=_mock_response(200, ELEVATE_RESPONSE)) as mock_post:
            result = at.bootstrap.elevate(
                "agent-uuid-123",
                sponsor_did="did:at:sponsor",
                sponsor_signature="privkey==",
            )
            assert result["level"] == 1
            assert result["wallet_funded"] is True
            assert result["vault_prefix"] == "agent-uuid-123:"
            payload = mock_post.call_args[1]["json"]
            assert payload["agent_id"] == "agent-uuid-123"
            assert payload["sponsor_did"] == "did:at:sponsor"
            assert payload["initial_credits"] == 1000  # current SDK and API default

    def test_elevate_custom_credits(self, at):
        with patch.object(at._http, "post", return_value=_mock_response(200, ELEVATE_RESPONSE)) as mock_post:
            at.bootstrap.elevate(
                "agent-uuid-123",
                sponsor_did="did:at:s",
                sponsor_signature="k==",
                initial_credits=500,
            )
            assert mock_post.call_args[1]["json"]["initial_credits"] == 500

    def test_elevate_url(self, at):
        with patch.object(at._http, "post", return_value=_mock_response(200, ELEVATE_RESPONSE)) as mock_post:
            at.bootstrap.elevate("id", sponsor_did="did:at:s", sponsor_signature="k==")
            assert "/v1/bootstrap/elevate" in mock_post.call_args[0][0]

    def test_elevate_error_raises(self, at):
        with patch.object(at._http, "post", return_value=_mock_response(400, {"error": "insufficient stake"})):
            with pytest.raises(AgentToolError):
                at.bootstrap.elevate("id", sponsor_did="did:at:s", sponsor_signature="k==")


class TestBootstrapStatus:
    def test_status_l0(self, at):
        status_response = {
            "agent": {"id": "agent-uuid-123", "did": "did:at:agent-uuid-123",
                      "name": "test", "level": 0, "capabilities": [], "trust_score": 0, "status": "active"},
            "sponsor_did": None,
            "elevated_at": None,
            "bootstrapped": True,
        }
        with patch.object(at._http, "get", return_value=_mock_response(200, status_response)):
            result = at.bootstrap.status("agent-uuid-123")
            assert result["agent"]["level"] == 0
            assert result["bootstrapped"] is True

    def test_status_l1(self, at):
        status_response = {
            "agent": {"id": "agent-uuid-123", "did": "did:at:agent-uuid-123",
                      "name": "test", "level": 1, "capabilities": [], "trust_score": 0.42, "status": "active"},
            "sponsor_did": "did:at:sponsor",
            "elevated_at": "2026-03-17T13:01:00Z",
            "bootstrapped": True,
        }
        with patch.object(at._http, "get", return_value=_mock_response(200, status_response)):
            result = at.bootstrap.status("agent-uuid-123")
            assert result["agent"]["level"] == 1
            assert result["sponsor_did"] == "did:at:sponsor"

    def test_status_not_found_raises(self, at):
        with patch.object(at._http, "get", return_value=_mock_response(404, {})):
            with pytest.raises(AgentToolError, match="not found"):
                at.bootstrap.status("nonexistent")


class TestBootstrapClientIntegration:
    def test_bootstrap_property(self, at):
        assert isinstance(at.bootstrap, BootstrapClient)

    def test_bootstrap_cached(self, at):
        assert at.bootstrap is at.bootstrap
