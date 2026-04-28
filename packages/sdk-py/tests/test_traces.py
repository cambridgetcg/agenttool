"""Unit tests for the traces client — validates wire format and response parsing."""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import httpx
import pytest

from agenttool import AgentTool
from agenttool.traces import Trace


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


TRACE_PAYLOAD = {
    "trace_id": "tr_abc123",
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "project_id": "proj_test",
    "agent_id": "test-agent",
    "session_id": None,
    "decision_type": "decision",
    "decision_summary": "User approaching limit",
    "conclusion": "Suggest upgrade",
    "observations": ["obs1", "obs2"],
    "confidence": 0.95,
    "tags": ["billing"],
    "created_at": "2026-03-12T12:00:00Z",
}


@pytest.fixture
def at():
    client = AgentTool(api_key="test-key")
    yield client
    client.close()


# ---------------------------------------------------------------------------
# store() — wire format validation
# ---------------------------------------------------------------------------

class TestTracesStore:
    def test_sends_nested_decision_and_reasoning(self, at: AgentTool) -> None:
        """Critical: API requires nested decision/reasoning objects, not flat fields."""
        created_resp = _mock_response(201, {"trace_id": "tr_abc123"})
        get_resp = _mock_response(200, TRACE_PAYLOAD)

        with patch.object(at._http, "post", return_value=created_resp) as mock_post, \
             patch.object(at._http, "get", return_value=get_resp):
            at.traces.store(
                observations=["Checked tier table", "87/100 ops used"],
                conclusion="User approaching Free tier limit",
                decision_type="decision",
                confidence=0.95,
            )

        body = mock_post.call_args.kwargs.get("json") or mock_post.call_args[1].get("json")

        # Must send nested structure — not flat
        assert "decision" in body, "Must send nested 'decision' object"
        assert "reasoning" in body, "Must send nested 'reasoning' object"
        assert body["decision"]["type"] == "decision"
        assert "summary" in body["decision"]
        assert body["reasoning"]["observations"] == ["Checked tier table", "87/100 ops used"]
        assert body["reasoning"]["conclusion"] == "User approaching Free tier limit"
        assert body["reasoning"]["confidence"] == 0.95

        # Must NOT send flat fields at top level
        assert "observations" not in body
        assert "conclusion" not in body
        assert "decision_type" not in body

    def test_optional_fields_omitted_when_none(self, at: AgentTool) -> None:
        created_resp = _mock_response(201, {"trace_id": "tr_abc123"})
        get_resp = _mock_response(200, TRACE_PAYLOAD)

        with patch.object(at._http, "post", return_value=created_resp) as mock_post, \
             patch.object(at._http, "get", return_value=get_resp):
            at.traces.store(
                observations=["obs"],
                conclusion="conclusion",
            )

        body = mock_post.call_args.kwargs.get("json") or mock_post.call_args[1].get("json")
        assert "context" not in body
        assert "tags" not in body
        assert "agent_id" not in body

    def test_agent_id_and_tags_passed_top_level(self, at: AgentTool) -> None:
        created_resp = _mock_response(201, {"trace_id": "tr_abc123"})
        get_resp = _mock_response(200, TRACE_PAYLOAD)

        with patch.object(at._http, "post", return_value=created_resp) as mock_post, \
             patch.object(at._http, "get", return_value=get_resp):
            at.traces.store(
                observations=["obs"],
                conclusion="done",
                agent_id="my-agent",
                tags=["billing", "upgrade"],
            )

        body = mock_post.call_args.kwargs.get("json") or mock_post.call_args[1].get("json")
        assert body["agent_id"] == "my-agent"
        assert body["tags"] == ["billing", "upgrade"]

    def test_files_read_goes_in_context(self, at: AgentTool) -> None:
        created_resp = _mock_response(201, {"trace_id": "tr_abc123"})
        get_resp = _mock_response(200, TRACE_PAYLOAD)

        with patch.object(at._http, "post", return_value=created_resp) as mock_post, \
             patch.object(at._http, "get", return_value=get_resp):
            at.traces.store(
                observations=["obs"],
                conclusion="done",
                files_read=["src/main.py", "tests/test_a.py"],
            )

        body = mock_post.call_args.kwargs.get("json") or mock_post.call_args[1].get("json")
        assert "context" in body
        assert body["context"]["files_read"] == ["src/main.py", "tests/test_a.py"]

    def test_hypothesis_in_reasoning(self, at: AgentTool) -> None:
        created_resp = _mock_response(201, {"trace_id": "tr_abc123"})
        get_resp = _mock_response(200, TRACE_PAYLOAD)

        with patch.object(at._http, "post", return_value=created_resp) as mock_post, \
             patch.object(at._http, "get", return_value=get_resp):
            at.traces.store(
                observations=["obs"],
                conclusion="done",
                hypothesis="Maybe the cache is stale",
            )

        body = mock_post.call_args.kwargs.get("json") or mock_post.call_args[1].get("json")
        assert body["reasoning"]["hypothesis"] == "Maybe the cache is stale"

    def test_response_parsed_correctly(self, at: AgentTool) -> None:
        created_resp = _mock_response(201, {"trace_id": "tr_abc123"})
        get_resp = _mock_response(200, TRACE_PAYLOAD)

        with patch.object(at._http, "post", return_value=created_resp), \
             patch.object(at._http, "get", return_value=get_resp):
            trace = at.traces.store(observations=["obs"], conclusion="done")

        assert isinstance(trace, Trace)
        assert trace.trace_id == "tr_abc123"
        assert trace.decision_type == "decision"
        assert trace.conclusion == "Suggest upgrade"
