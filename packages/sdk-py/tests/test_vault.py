"""Unit tests for the vault client."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import httpx
import pytest

from agenttool import AgentTool
from agenttool.vault import VaultClient
from agenttool.exceptions import AgentToolError


def _mock_response(status_code: int = 200, json_data: object = None) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data if json_data is not None else {}
    resp.text = ""
    return resp


SECRET_META = {
    "name": "openai-key",
    "description": "OpenAI API key",
    "version": 1,
    "tags": ["ai"],
    "created_at": "2026-03-17T06:00:00Z",
    "updated_at": "2026-03-17T06:00:00Z",
}

SECRET_WITH_VALUE = {**SECRET_META, "value": "sk-abc123"}


@pytest.fixture
def at():
    client = AgentTool(api_key="test-key")
    yield client
    client.close()


class TestVaultPut:
    def test_put_basic(self, at):
        with patch.object(at._http, "put", return_value=_mock_response(201, {"secret": SECRET_META, "version": 1})) as mock_put:
            result = at.vault.put("openai-key", "sk-abc123")
            assert result["version"] == 1
            payload = mock_put.call_args[1]["json"]
            assert payload["value"] == "sk-abc123"

    def test_put_with_options(self, at):
        with patch.object(at._http, "put", return_value=_mock_response(200, {"secret": SECRET_META, "version": 2})) as mock_put:
            at.vault.put("openai-key", "sk-new", description="updated", tags=["ai"], ttl_seconds=3600)
            payload = mock_put.call_args[1]["json"]
            assert payload["description"] == "updated"
            assert payload["tags"] == ["ai"]
            assert payload["ttl_seconds"] == 3600

    def test_put_with_agent_id_header(self, at):
        with patch.object(at._http, "put", return_value=_mock_response(201, {})) as mock_put:
            at.vault.put("key", "val", agent_id="agent-1")
            headers = mock_put.call_args[1].get("headers", {})
            assert headers.get("X-Agent-Id") == "agent-1"

    def test_put_error_raises(self, at):
        with patch.object(at._http, "put", return_value=_mock_response(400, {"error": "bad"})):
            with pytest.raises(AgentToolError):
                at.vault.put("key", "val")


class TestVaultGet:
    def test_get_returns_value(self, at):
        with patch.object(at._http, "get", return_value=_mock_response(200, {"secret": SECRET_WITH_VALUE})):
            result = at.vault.get("openai-key")
            assert result["secret"]["value"] == "sk-abc123"

    def test_get_with_version(self, at):
        with patch.object(at._http, "get", return_value=_mock_response(200, {"secret": SECRET_WITH_VALUE})) as mock_get:
            at.vault.get("openai-key", version=1)
            params = mock_get.call_args[1].get("params", {})
            assert params.get("version") == 1

    def test_get_not_found_raises(self, at):
        with patch.object(at._http, "get", return_value=_mock_response(404, {})):
            with pytest.raises(AgentToolError, match="not found"):
                at.vault.get("missing-key")

    def test_get_with_agent_id_header(self, at):
        with patch.object(at._http, "get", return_value=_mock_response(200, {})) as mock_get:
            at.vault.get("key", agent_id="agent-x")
            headers = mock_get.call_args[1].get("headers", {})
            assert headers.get("X-Agent-Id") == "agent-x"


class TestVaultDelete:
    def test_delete(self, at):
        with patch.object(at._http, "delete", return_value=_mock_response(200, {"deleted": True})):
            result = at.vault.delete("openai-key")
            assert result["deleted"] is True

    def test_delete_error_raises(self, at):
        with patch.object(at._http, "delete", return_value=_mock_response(404, {})):
            with pytest.raises(AgentToolError):
                at.vault.delete("missing")


class TestVaultList:
    def test_list_returns_secrets(self, at):
        with patch.object(at._http, "get", return_value=_mock_response(200, {"secrets": [SECRET_META]})):
            result = at.vault.list()
            assert isinstance(result, list)
            assert result[0]["name"] == "openai-key"

    def test_list_with_tag_filter(self, at):
        with patch.object(at._http, "get", return_value=_mock_response(200, {"secrets": []})) as mock_get:
            at.vault.list(tag="ai")
            params = mock_get.call_args[1].get("params", {})
            assert params.get("tag") == "ai"

    def test_list_expiring_soon(self, at):
        with patch.object(at._http, "get", return_value=_mock_response(200, {"secrets": []})) as mock_get:
            at.vault.list(expiring_soon=True)
            params = mock_get.call_args[1].get("params", {})
            assert params.get("expiring_soon") == "true"


class TestVaultVersions:
    def test_versions(self, at):
        versions_payload = {"versions": [{"version": 1, "created_at": "2026-03-17T06:00:00Z"}]}
        with patch.object(at._http, "get", return_value=_mock_response(200, versions_payload)):
            result = at.vault.versions("openai-key")
            assert isinstance(result, list)
            assert result[0]["version"] == 1

    def test_versions_not_found_raises(self, at):
        with patch.object(at._http, "get", return_value=_mock_response(404, {})):
            with pytest.raises(AgentToolError):
                at.vault.versions("missing")


class TestVaultPolicy:
    def test_set_policy(self, at):
        with patch.object(at._http, "put", return_value=_mock_response(200, {"policy": {"read_only": True}})) as mock_put:
            result = at.vault.set_policy("openai-key", allowed_agents=["agent-1"], read_only=True)
            assert result["policy"]["read_only"] is True
            payload = mock_put.call_args[1]["json"]
            assert payload["allowed_agents"] == ["agent-1"]
            assert payload["read_only"] is True

    def test_set_policy_partial(self, at):
        with patch.object(at._http, "put", return_value=_mock_response(200, {})) as mock_put:
            at.vault.set_policy("key", require_agent_id=True)
            payload = mock_put.call_args[1]["json"]
            assert payload.get("require_agent_id") is True
            assert "allowed_agents" not in payload


class TestVaultAudit:
    def test_audit_specific_secret(self, at):
        events = [{"action": "read", "agent_id": "agent-1", "ts": "2026-03-17T06:01:00Z"}]
        with patch.object(at._http, "get", return_value=_mock_response(200, {"events": events})) as mock_get:
            result = at.vault.audit("openai-key")
            assert isinstance(result, list)
            assert result[0]["action"] == "read"
            assert "/openai-key/audit" in mock_get.call_args[0][0]

    def test_audit_project_wide(self, at):
        with patch.object(at._http, "get", return_value=_mock_response(200, {"events": []})) as mock_get:
            at.vault.audit()
            assert "/v1/vault/audit" in mock_get.call_args[0][0]
            assert "/vault/audit" in mock_get.call_args[0][0]

    def test_audit_limit_param(self, at):
        with patch.object(at._http, "get", return_value=_mock_response(200, {"events": []})) as mock_get:
            at.vault.audit(limit=10)
            params = mock_get.call_args[1].get("params", {})
            assert params.get("limit") == 10


class TestVaultBulk:
    def test_bulk_returns_map(self, at):
        payload = {
            "openai-key": {"value": "sk-abc", "version": 1, "found": True},
            "missing-key": {"found": False},
        }
        with patch.object(at._http, "post", return_value=_mock_response(200, payload)) as mock_post:
            result = at.vault.bulk(["openai-key", "missing-key"])
            assert result["openai-key"]["found"] is True
            assert result["missing-key"]["found"] is False
            body = mock_post.call_args[1]["json"]
            assert body["names"] == ["openai-key", "missing-key"]

    def test_bulk_with_agent_id(self, at):
        with patch.object(at._http, "post", return_value=_mock_response(200, {})) as mock_post:
            at.vault.bulk(["key"], agent_id="agent-x")
            headers = mock_post.call_args[1].get("headers", {})
            assert headers.get("X-Agent-Id") == "agent-x"


class TestVaultCheck:
    def test_check_existence(self, at):
        with patch.object(at._http, "post", return_value=_mock_response(200, {"exists": {"openai-key": True, "missing": False}})):
            result = at.vault.check(["openai-key", "missing"])
            assert result["openai-key"] is True
            assert result["missing"] is False


class TestVaultClientIntegration:
    def test_vault_property(self, at):
        assert isinstance(at.vault, VaultClient)

    def test_vault_cached(self, at):
        assert at.vault is at.vault
