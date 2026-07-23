"""Unit tests for the traces client — validates wire format and response parsing."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import httpx
import pytest

from agenttool import AgentTool, AgentToolError
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
    resp.headers = {}
    return resp


RHETORLINT_SIGNAL = {
    "schema": "rhetorlint.signal/0.1",
    "kind": "rhetorlint.analysis",
    "boundary": {
        "observes": "visible-language-patterns",
        "doesNot": [
            "infer-speaker-intent",
            "detect-deception",
            "determine-factual-truth",
        ],
        "note": (
            "RhetorLint marks visible language patterns. It does not infer "
            "speaker intent, detect deception, or determine whether a claim "
            "is factually true."
        ),
    },
    "rhetorlint": "0.1",
    "engine": {
        "name": "@rhetorlint/core",
        "version": "0.1.1",
        "rules": "@rhetorlint/rules-en@0.1.0",
    },
    "source": {"chars": 0, "words": 0, "locale": "en"},
    "density": {"tells": 0, "per100Words": 0},
    "summary": {"families": [], "rules": []},
}


TRACE_PAYLOAD = {
    "trace_id": "tr_abc123",
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "agent_id": "test-agent",
    "identity_id": "550e8400-e29b-41d4-a716-446655440001",
    "session_id": None,
    "parent_trace_id": None,
    "decision_type": "decision",
    "decision_summary": "User approaching limit",
    "output_ref": None,
    "conclusion": "Suggest upgrade",
    "observations": ["obs1", "obs2"],
    "hypothesis": None,
    "confidence": 0.95,
    "alternatives": None,
    "signals": {"source_count": 2},
    "files_read": None,
    "key_facts": None,
    "external_signals": {"rhetorlint": RHETORLINT_SIGNAL},
    "tags": ["billing"],
    "metadata": {"client_source": "sdk-py"},
    "signature": None,
    "signing_key_id": None,
    "has_signature": False,
    "created_at": "2026-07-17T12:00:00Z",
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

    def test_full_context_and_redacted_rhetorlint_signal_round_trip(
        self, at: AgentTool
    ) -> None:
        created_resp = _mock_response(201, {"trace_id": "tr_abc123"})
        get_resp = _mock_response(200, TRACE_PAYLOAD)

        with patch.object(at._http, "post", return_value=created_resp) as mock_post, \
             patch.object(at._http, "get", return_value=get_resp):
            trace = at.traces.store(
                observations=["Reviewed response language"],
                conclusion="Keep the report namespaced and explicit",
                decision_summary="Attach local language analysis",
                output_ref="memory:review",
                agent_id="test-agent",
                identity_id="550e8400-e29b-41d4-a716-446655440001",
                session_id="session-1",
                alternatives=[
                    {
                        "option": "Upload automatically",
                        "why_not": "The report must remain explicit and opt-in",
                    }
                ],
                signals={"source_count": 2},
                key_facts=["RhetorLint reads language, not people"],
                external_signals={"rhetorlint": RHETORLINT_SIGNAL},
                metadata={"review": "local-language-analysis"},
            )

        body = mock_post.call_args.kwargs.get("json") or mock_post.call_args[1].get("json")
        assert body["decision"] == {
            "type": "decision",
            "summary": "Attach local language analysis",
            "output_ref": "memory:review",
        }
        assert body["reasoning"]["alternatives"] == [
            {
                "option": "Upload automatically",
                "why_not": "The report must remain explicit and opt-in",
            }
        ]
        assert body["reasoning"]["signals"] == {"source_count": 2}
        assert body["context"] == {
            "key_facts": ["RhetorLint reads language, not people"],
            "external_signals": {"rhetorlint": RHETORLINT_SIGNAL},
        }
        assert body["identity_id"] == "550e8400-e29b-41d4-a716-446655440001"
        assert body["metadata"] == {"review": "local-language-analysis"}
        assert "key_facts" not in body["reasoning"]

        assert trace.external_signals == {"rhetorlint": RHETORLINT_SIGNAL}
        assert "marks" not in RHETORLINT_SIGNAL
        assert "strip" not in RHETORLINT_SIGNAL
        assert "rewrite" not in RHETORLINT_SIGNAL
        assert trace.identity_id == "550e8400-e29b-41d4-a716-446655440001"

    def test_preserves_string_alternatives_without_fabricating_reason(
        self, at: AgentTool
    ) -> None:
        created_resp = _mock_response(201, {"trace_id": "tr_abc123"})
        get_resp = _mock_response(200, TRACE_PAYLOAD)

        with patch.object(at._http, "post", return_value=created_resp) as mock_post, \
             patch.object(at._http, "get", return_value=get_resp):
            at.traces.store(
                observations=[],
                conclusion="done",
                alternatives=["Do nothing"],
            )

        body = mock_post.call_args.kwargs.get("json") or mock_post.call_args[1].get("json")
        assert body["reasoning"]["alternatives"] == [
            {"option": "Do nothing", "why_not": ""}
        ]

    def test_prefers_live_validation_message_on_error(self, at: AgentTool) -> None:
        error_resp = _mock_response(
            400,
            {
                "error": "validation",
                "message": "The trace needs a small adjustment.",
                "details": {"fieldErrors": {"reasoning": ["Required"]}},
            },
        )
        error_resp.headers = {
            "Retry-After": "9",
            "PAYMENT-REQUIRED": "test-challenge",
        }

        with patch.object(at._http, "post", return_value=error_resp), \
             pytest.raises(AgentToolError) as exc_info:
            at.traces.store(observations=[], conclusion="done")

        assert exc_info.value.message == "The trace needs a small adjustment."
        assert exc_info.value.error_code == "validation"
        assert exc_info.value.code == 400
        assert exc_info.value.retry_after == "9"
        assert exc_info.value.payment_required == "test-challenge"

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


class TestTraceResponseShapes:
    def test_search_unwraps_results_and_omits_unsupported_tag(
        self, at: AgentTool
    ) -> None:
        search_resp = _mock_response(
            200,
            {"results": [{**TRACE_PAYLOAD, "score": 0.8125}], "count": 1},
        )

        with patch.object(at._http, "post", return_value=search_resp) as mock_post:
            results = at.traces.search(
                "upgrade",
                limit=3,
                identity_id="550e8400-e29b-41d4-a716-446655440001",
                decision_type="decision",
                tag="legacy-ignored",
            )

        assert len(results) == 1
        assert results[0].score == 0.8125
        assert results[0].trace.trace_id == "tr_abc123"
        body = mock_post.call_args.kwargs.get("json") or mock_post.call_args[1].get("json")
        assert body == {
            "query": "upgrade",
            "limit": 3,
            "identity_id": "550e8400-e29b-41d4-a716-446655440001",
            "decision_type": "decision",
        }

    def test_chain_returns_live_lineage_and_deprecated_aliases(
        self, at: AgentTool
    ) -> None:
        ancestor = {
            **TRACE_PAYLOAD,
            "id": "550e8400-e29b-41d4-a716-446655440003",
            "trace_id": "tr_a11ce1",
        }
        descendant = {
            **TRACE_PAYLOAD,
            "id": "550e8400-e29b-41d4-a716-446655440004",
            "trace_id": "tr_dec0de",
            "parent_trace_id": "tr_abc123",
        }
        chain_resp = _mock_response(
            200,
            {
                "root": TRACE_PAYLOAD,
                "ancestors": [ancestor],
                "descendants": [descendant],
                "counts": {"ancestors": 1, "descendants": 1},
            },
        )

        with patch.object(at._http, "get", return_value=chain_resp):
            chain = at.traces.chain("tr_abc123")

        assert chain.root.trace_id == "tr_abc123"
        assert chain.ancestors[0].trace_id == "tr_a11ce1"
        assert chain.descendants[0].trace_id == "tr_dec0de"
        assert chain.counts == {"ancestors": 1, "descendants": 1}
        assert chain.parent is chain.root
        assert chain.children is chain.descendants
        assert chain.depth == 1
