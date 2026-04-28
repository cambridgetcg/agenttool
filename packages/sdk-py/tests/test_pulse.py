"""Unit tests for the pulse client."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import httpx
import pytest

from agenttool import AgentTool
from agenttool.pulse import PulseClient
from agenttool.exceptions import AgentToolError


def _mock_response(status_code: int = 200, json_data: object = None) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data if json_data is not None else {}
    resp.text = ""
    return resp


AGENT_STATE = {
    "agent_id": "agent-1",
    "status": "thinking",
    "task": "solving math",
    "last_seen": "2026-03-22T10:00:00Z",
}


@pytest.fixture
def at():
    client = AgentTool(api_key="test-key")
    yield client
    client.close()


class TestPulseHeartbeat:
    def test_heartbeat_basic(self, at):
        with patch.object(at._http, "put", return_value=_mock_response(200, {"ok": True, "recorded_at": "2026-03-22T10:00:00Z"})) as mock_put:
            result = at.pulse.heartbeat("agent-1", "thinking")
            assert result["ok"] is True
            payload = mock_put.call_args[1]["json"]
            assert payload["status"] == "thinking"
            assert "/v1/pulse/agent-1" in mock_put.call_args[0][0]

    def test_heartbeat_with_options(self, at):
        with patch.object(at._http, "put", return_value=_mock_response(200, {"ok": True})) as mock_put:
            at.pulse.heartbeat("agent-1", "learning", task="reading docs", metadata={"progress": 0.5}, did="did:example:123")
            payload = mock_put.call_args[1]["json"]
            assert payload["status"] == "learning"
            assert payload["task"] == "reading docs"
            assert payload["metadata"] == {"progress": 0.5}
            assert payload["did"] == "did:example:123"

    def test_heartbeat_error_raises(self, at):
        with patch.object(at._http, "put", return_value=_mock_response(400, {"error": "bad"})):
            with pytest.raises(AgentToolError):
                at.pulse.heartbeat("agent-1", "invalid")


class TestPulseGet:
    def test_get_returns_state(self, at):
        with patch.object(at._http, "get", return_value=_mock_response(200, AGENT_STATE)):
            result = at.pulse.get("agent-1")
            assert result["status"] == "thinking"
            assert result["agent_id"] == "agent-1"

    def test_get_not_found_raises(self, at):
        with patch.object(at._http, "get", return_value=_mock_response(404, {})):
            with pytest.raises(AgentToolError, match="not found"):
                at.pulse.get("missing-agent")


class TestPulseList:
    def test_list_returns_agents(self, at):
        with patch.object(at._http, "get", return_value=_mock_response(200, {"agents": [AGENT_STATE]})):
            result = at.pulse.list()
            assert isinstance(result, list)
            assert result[0]["agent_id"] == "agent-1"

    def test_list_empty(self, at):
        with patch.object(at._http, "get", return_value=_mock_response(200, {"agents": []})):
            result = at.pulse.list()
            assert result == []


class TestPulseClientIntegration:
    def test_pulse_property(self, at):
        assert isinstance(at.pulse, PulseClient)

    def test_pulse_cached(self, at):
        assert at.pulse is at.pulse
