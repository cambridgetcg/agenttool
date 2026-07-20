"""Handoff SDK surface — all HTTP mocked, no network required."""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import httpx
import pytest

from agenttool import (
    AgentTool,
    AgentToolError,
    HandoffClient,
    HandoffRecord,
    HandoffResumeResponse,
)


AGENT_ID = "00000000-0000-4000-8000-000000000001"
PREVIOUS_HANDOFF_ID = "00000000-0000-4000-8000-000000000002"


def _resp(status: int, json_data: object = None, text: str = "") -> MagicMock:
    response = MagicMock(spec=httpx.Response)
    response.status_code = status
    response.json.return_value = json_data if json_data is not None else {}
    response.text = text
    return response


def _returned_handoff() -> HandoffRecord:
    return {
        "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "project_id": "22222222-2222-4222-8222-222222222222",
        "author_agent_id": AGENT_ID,
        "title": "Handoff: Finish the Python SDK",
        "body": None,
        "supersedes_handoff_id": None,
        "lineage_mode": "explicit",
        "occurred_at": "2026-07-15T12:00:00.000Z",
        "created_at": "2026-07-15T12:00:00.000Z",
        "provenance": "self_declared_project_bearer",
        "version": 1,
        "ts": "2026-07-15T12:00:00.000Z",
        "task_summary": "Finish the Python SDK",
        "status": "active",
        "from_facet": None,
        "to_facet": None,
        "working_set": {"paths": ["packages/sdk-py"], "scope": ["SDK parity"]},
        "authority": {"allowed": [], "not_authorized": []},
        "epistemic_state": {"facts": [], "inferences": [], "unknowns": []},
        "changes": [],
        "verification": [],
        "next_safe_action": "Run the Python SDK tests.",
        "do_not_assume": [],
        "valid_until": "2026-07-20T12:00:00.000Z",
    }


@pytest.fixture()
def at() -> AgentTool:
    with patch.dict(os.environ, {"AT_API_KEY": "test-key"}):
        client = AgentTool()
    yield client
    client.close()


class TestHandoffWiring:
    def test_property_returns_cached_client(self, at: AgentTool) -> None:
        assert isinstance(at.handoff, HandoffClient)
        assert at.handoff is at.handoff


class TestHandoffWrite:
    def test_minimal_snapshot_sends_complete_structured_shape(self, at: AgentTool) -> None:
        returned = {"handoff": {"id": "h1"}, "state": "current"}
        with patch.object(at._http, "post", return_value=_resp(201, returned)) as post:
            result = at.handoff.write(
                agent_id=AGENT_ID,
                task_summary="Finish wake handoff rendering",
                valid_until="2026-07-15T12:00:00Z",
                next_safe_action="Run the focused wake tests.",
            )

        assert result == returned
        assert post.call_args.args[0].endswith("/v1/handoff")
        assert post.call_args.kwargs["json"] == {
            "agent_id": AGENT_ID,
            "task_summary": "Finish wake handoff rendering",
            "status": "active",
            "working_set": {"paths": [], "scope": []},
            "authority": {"allowed": [], "not_authorized": []},
            "epistemic_state": {"facts": [], "inferences": [], "unknowns": []},
            "changes": [],
            "verification": [],
            "next_safe_action": "Run the focused wake tests.",
            "do_not_assume": [],
            "valid_until": "2026-07-15T12:00:00Z",
        }

    def test_idempotency_key_is_a_header_not_handoff_content(self, at: AgentTool) -> None:
        with patch.object(at._http, "post", return_value=_resp(201, {"handoff": {"id": "h1"}})) as post:
            at.handoff.write(
                agent_id=AGENT_ID,
                task_summary="Retry one append safely",
                valid_until="2026-07-20T12:00:00Z",
                next_safe_action="Read the returned handoff.",
                idempotency_key="handoff-session-42",
            )

        assert post.call_args.kwargs["headers"] == {
            "Idempotency-Key": "handoff-session-42"
        }
        assert "idempotency_key" not in post.call_args.kwargs["json"]

    def test_starts_new_lineage_is_sent_only_when_defined(self, at: AgentTool) -> None:
        with patch.object(
            at._http,
            "post",
            return_value=_resp(201, {"handoff": {"id": "h-lineage"}}),
        ) as post:
            at.handoff.write(
                agent_id=AGENT_ID,
                task_summary="Start an independent SDK task",
                valid_until="2026-07-20T12:00:00Z",
                next_safe_action="Read the explicit lineage.",
                starts_new_lineage=True,
            )

        assert post.call_args.kwargs["json"]["starts_new_lineage"] is True

    def test_successful_write_clears_an_existing_wake_cache(self, at: AgentTool) -> None:
        wake = at.wake
        with patch.object(wake, "clear_cache") as clear_cache:
            with patch.object(at._http, "post", return_value=_resp(201, {"handoff": {"id": "h1"}})):
                at.handoff.write(
                    agent_id=AGENT_ID,
                    task_summary="Refresh continuity",
                    valid_until="2026-07-20T12:00:00Z",
                    next_safe_action="Read a fresh wake.",
                )
        clear_cache.assert_called_once_with()

    def test_full_snapshot_preserves_declared_boundaries_and_successor(
        self, at: AgentTool
    ) -> None:
        with patch.object(at._http, "post", return_value=_resp(201, {"handoff": {"id": "h2"}})) as post:
            at.handoff.write(
                agent_id=AGENT_ID,
                task_summary="Finish the Python SDK handoff client",
                valid_until="2026-07-15T12:00:00Z",
                next_safe_action="Run pytest for the new client.",
                status="blocked",
                from_facet="Terra",
                to_facet="Sol",
                working_set={"paths": ["src/agenttool/handoff.py"], "scope": ["SDK"]},
                authority={
                    "allowed": ["Edit the Python SDK."],
                    "not_authorized": ["Deploy or publish a package."],
                },
                epistemic_state={
                    "facts": [
                        {
                            "statement": "The API accepts project-private handoffs.",
                            "source": "self_observed",
                            "refs": ["api/src/routes/handoff.ts"],
                        }
                    ],
                    "inferences": [
                        {
                            "statement": "SDK users benefit from empty structured defaults.",
                            "confidence": "medium",
                            "refs": [],
                        }
                    ],
                    "unknowns": ["Whether a TS SDK companion is needed in this slice."],
                },
                changes=["Added a client module."],
                verification=[{"check": "pytest", "result": "not_run", "detail": None}],
                do_not_assume=["A handoff transfers authority."],
                supersedes_handoff_id=PREVIOUS_HANDOFF_ID,
            )

        body = post.call_args.kwargs["json"]
        assert body["from_facet"] == "Terra"
        assert body["to_facet"] == "Sol"
        assert body["authority"]["not_authorized"] == ["Deploy or publish a package."]
        assert body["epistemic_state"]["facts"][0]["source"] == "self_observed"
        assert body["supersedes_handoff_id"] == PREVIOUS_HANDOFF_ID

    @pytest.mark.parametrize(
        ("kwargs", "expected"),
        [
            ({"agent_id": ""}, "agent_id is required"),
            ({"task_summary": ""}, "task_summary is required"),
            ({"valid_until": ""}, "valid_until is required"),
            ({"next_safe_action": ""}, "next_safe_action is required"),
            ({"status": "paused"}, "status must be active, blocked, or complete"),
            ({"idempotency_key": "has spaces"}, "idempotency_key must be"),
            (
                {
                    "starts_new_lineage": True,
                    "supersedes_handoff_id": PREVIOUS_HANDOFF_ID,
                },
                "starts_new_lineage cannot be combined",
            ),
        ],
    )
    def test_invalid_local_input_is_guidance_not_a_request(
        self, at: AgentTool, kwargs: dict[str, object], expected: str
    ) -> None:
        base = {
            "agent_id": AGENT_ID,
            "task_summary": "A bounded task",
            "valid_until": "2026-07-15T12:00:00Z",
            "next_safe_action": "Take one safe step.",
        }
        with patch.object(at._http, "post") as post:
            with pytest.raises(AgentToolError, match=expected):
                at.handoff.write(**{**base, **kwargs})  # type: ignore[arg-type]
        post.assert_not_called()

    def test_api_error_keeps_guided_error_metadata(self, at: AgentTool) -> None:
        response = _resp(
            400,
            {
                "error": "invalid_handoff",
                "message": "This handoff is not a valid bounded working-set snapshot.",
                "hint": "Use the documented fields only.",
                "docs": "https://docs.agenttool.dev/handoffs",
            },
        )
        with patch.object(at._http, "post", return_value=response):
            with pytest.raises(AgentToolError) as exc:
                at.handoff.write(
                    agent_id=AGENT_ID,
                    task_summary="A bounded task",
                    valid_until="2026-07-15T12:00:00Z",
                    next_safe_action="Take one safe step.",
                )
        assert exc.value.code == 400
        assert exc.value.error_code == "invalid_handoff"
        assert exc.value.docs == "https://docs.agenttool.dev/handoffs"


class TestHandoffGet:
    def test_reads_latest_snapshot_for_identity(self, at: AgentTool) -> None:
        returned = {"handoff": {"id": "h1", "author_agent_id": AGENT_ID}, "state": "current"}
        with patch.object(at._http, "get", return_value=_resp(200, returned)) as get:
            result = at.handoff.get(agent_id=AGENT_ID)

        assert result == returned
        assert get.call_args.args[0].endswith("/v1/handoff")
        assert get.call_args.kwargs["params"] == {"agent_id": AGENT_ID}

    def test_missing_identity_does_not_make_request(self, at: AgentTool) -> None:
        with patch.object(at._http, "get") as get:
            with pytest.raises(AgentToolError, match="agent_id is required"):
                at.handoff.get(agent_id="")
        get.assert_not_called()

    def test_get_preserves_api_error_metadata(self, at: AgentTool) -> None:
        response = _resp(
            404,
            {
                "error": "handoff_agent_not_in_project",
                "message": "That identity is not active in this bearer project.",
                "hint": "Read your project wake first.",
            },
        )
        with patch.object(at._http, "get", return_value=response):
            with pytest.raises(AgentToolError) as exc:
                at.handoff.get(agent_id=AGENT_ID)
        assert exc.value.code == 404
        assert exc.value.error_code == "handoff_agent_not_in_project"


class TestHandoffResume:
    def test_reads_focused_working_set_without_client_cache(self, at: AgentTool) -> None:
        returned: HandoffResumeResponse = {
            "_scope_boundary": None,
            "you_have_handoffs": {
                "active": [_returned_handoff()],
                "stale": [],
                "projection_status": "complete",
                "truncated": False,
                "leaf_set_complete": True,
                "candidate_rows_considered": 1,
                "candidate_row_limit": 32,
                "candidate_window_end_id": None,
                "scope": "project_private",
                "authority_note": "Context does not transfer authority.",
                "write": "POST /v1/handoff",
                "read_latest": "GET /v1/handoff?agent_id=<identity_id>",
            }
        }
        with patch.object(at._http, "get", return_value=_resp(200, returned)) as get:
            first = at.handoff.resume(identity_id=AGENT_ID)
            second = at.handoff.resume(identity_id=AGENT_ID)

        assert first == returned
        assert second == returned
        assert first["you_have_handoffs"]["scope"] == "project_private"
        assert first["you_have_handoffs"]["active"][0]["lineage_mode"] == "explicit"
        assert first["you_have_handoffs"]["truncated"] is False
        assert first["you_have_handoffs"]["projection_status"] == "complete"
        assert first["you_have_handoffs"]["leaf_set_complete"] is True
        assert first["you_have_handoffs"]["candidate_rows_considered"] == 1
        assert first["you_have_handoffs"]["candidate_row_limit"] == 32
        assert first["you_have_handoffs"]["candidate_window_end_id"] is None
        assert get.call_count == 2
        assert get.call_args.args[0].endswith("/v1/wake/handoffs")
        assert get.call_args.kwargs["params"] == {"identity_id": AGENT_ID}

    def test_resume_preserves_guided_api_errors(self, at: AgentTool) -> None:
        response = _resp(
            404,
            {
                "error": "no_agent",
                "message": "POST /v1/bootstrap first.",
                "hint": "Bootstrap an identity, then resume.",
            },
        )
        with patch.object(at._http, "get", return_value=response):
            with pytest.raises(AgentToolError) as exc:
                at.handoff.resume()
        assert exc.value.error_code == "no_agent"
