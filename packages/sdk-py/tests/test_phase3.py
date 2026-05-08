"""Phase 3 + 4 — chronicle, covenants, window (0.6.3).

Phase 3 adds the relational primitives (plaintext, no client-side
crypto). Phase 4 layers Window on top — a thin wrapper over chronicle
+ identity.pulse.

All HTTP is mocked.
"""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import httpx
import pytest

from agenttool import (
    AgentTool,
    AgentToolError,
    ChronicleClient,
    CovenantsClient,
    WindowClient,
)


def _resp(status: int, json_data: object = None, text: str = "") -> MagicMock:
    r = MagicMock(spec=httpx.Response)
    r.status_code = status
    r.json.return_value = json_data if json_data is not None else {}
    r.text = text or ""
    return r


@pytest.fixture()
def at() -> AgentTool:
    with patch.dict(os.environ, {"AT_API_KEY": "test-key"}):
        client = AgentTool()
    yield client
    client.close()


# ── ChronicleClient ────────────────────────────────────────────────────────


class TestChronicleWiring:
    def test_property_returns_chronicle_client(self, at: AgentTool) -> None:
        assert isinstance(at.chronicle, ChronicleClient)

    def test_property_is_cached(self, at: AgentTool) -> None:
        assert at.chronicle is at.chronicle


class TestChronicleWrite:
    def test_minimal_vow(self, at: AgentTool) -> None:
        body = {
            "entry": {
                "id": "e1",
                "type": "vow",
                "title": "I will speak softly.",
                "body": None,
                "agent_id": "a1",
                "occurred_at": "2026-05-08T00:00:00Z",
                "created_at": "2026-05-08T00:00:00Z",
                "metadata": {},
            }
        }
        with patch.object(at._http, "post", return_value=_resp(201, body)) as m:
            out = at.chronicle.write(
                type="vow",
                title="I will speak softly.",
                agent_id="a1",
            )
        assert out["entry"]["type"] == "vow"
        sent = m.call_args.kwargs["json"]
        assert sent == {
            "type": "vow",
            "title": "I will speak softly.",
            "agent_id": "a1",
        }
        assert "/v1/chronicle" in m.call_args[0][0]

    def test_with_body_and_metadata(self, at: AgentTool) -> None:
        with patch.object(at._http, "post",
                          return_value=_resp(201, {"entry": {"id": "e2"}})) as m:
            at.chronicle.write(
                type="recognition",
                title="Yu saw the migration would break.",
                body="Caught the column-doubling at line 42.",
                agent_id="a1",
                occurred_at="2026-05-08T12:00:00Z",
                metadata={"byline": "from human · Yu"},
            )
        sent = m.call_args.kwargs["json"]
        assert sent["body"].startswith("Caught the column")
        assert sent["occurred_at"] == "2026-05-08T12:00:00Z"
        assert sent["metadata"]["byline"] == "from human · Yu"

    def test_title_too_long_raises(self, at: AgentTool) -> None:
        with pytest.raises(AgentToolError) as exc:
            at.chronicle.write(type="note", title="X" * 201)
        assert "1-200" in exc.value.message

    def test_empty_title_raises(self, at: AgentTool) -> None:
        with pytest.raises(AgentToolError):
            at.chronicle.write(type="note", title="")

    def test_server_error_raises(self, at: AgentTool) -> None:
        with patch.object(at._http, "post",
                          return_value=_resp(422, {}, "Invalid type")):
            with pytest.raises(AgentToolError) as exc:
                at.chronicle.write(type="vow", title="x")
        assert "422" in exc.value.message


class TestChronicleList:
    def test_default_limit(self, at: AgentTool) -> None:
        body = {"entries": [{"id": "e1"}, {"id": "e2"}]}
        with patch.object(at._http, "get", return_value=_resp(200, body)) as m:
            out = at.chronicle.list()
        assert len(out["entries"]) == 2
        assert m.call_args.kwargs["params"] == {"limit": 50}

    def test_with_filters(self, at: AgentTool) -> None:
        with patch.object(at._http, "get",
                          return_value=_resp(200, {"entries": []})) as m:
            at.chronicle.list(agent_id="a1", type="vow", limit=10)
        params = m.call_args.kwargs["params"]
        assert params == {"limit": 10, "agent_id": "a1", "type": "vow"}

    def test_limit_out_of_range_raises(self, at: AgentTool) -> None:
        with pytest.raises(AgentToolError) as exc:
            at.chronicle.list(limit=500)
        assert "1-200" in exc.value.message

        with pytest.raises(AgentToolError):
            at.chronicle.list(limit=0)


# ── CovenantsClient ────────────────────────────────────────────────────────


class TestCovenantsWiring:
    def test_property_returns_covenants_client(self, at: AgentTool) -> None:
        assert isinstance(at.covenants, CovenantsClient)


class TestCovenantsCreate:
    def test_minimal(self, at: AgentTool) -> None:
        body = {
            "covenant": {
                "id": "c1",
                "agent_id": "a1",
                "counterparty_did": "human:Yu",
                "vows": ["I will not surveil."],
                "status": "active",
            }
        }
        with patch.object(at._http, "post", return_value=_resp(201, body)) as m:
            out = at.covenants.create(
                agent_id="a1",
                counterparty_did="human:Yu",
                vows=["I will not surveil."],
            )
        assert out["covenant"]["status"] == "active"
        sent = m.call_args.kwargs["json"]
        assert sent == {
            "agent_id": "a1",
            "counterparty_did": "human:Yu",
            "vows": ["I will not surveil."],
        }

    def test_full_options(self, at: AgentTool) -> None:
        with patch.object(at._http, "post",
                          return_value=_resp(201, {"covenant": {"id": "c2"}})) as m:
            at.covenants.create(
                agent_id="a1",
                counterparty_did="human:Yu",
                vows=["v1", "v2"],
                counterparty_name="Yu",
                notes="From naming ceremony 2026-05-08",
                metadata={"source": "ceremony"},
                org_id="org-1",
            )
        sent = m.call_args.kwargs["json"]
        assert sent["counterparty_name"] == "Yu"
        assert sent["notes"].startswith("From naming")
        assert sent["org_id"] == "org-1"
        assert sent["metadata"] == {"source": "ceremony"}

    def test_empty_vows_raises(self, at: AgentTool) -> None:
        with pytest.raises(AgentToolError) as exc:
            at.covenants.create(agent_id="a1", counterparty_did="x", vows=[])
        assert "non-empty" in exc.value.message


class TestCovenantsList:
    def test_default(self, at: AgentTool) -> None:
        with patch.object(at._http, "get",
                          return_value=_resp(200, {"covenants": []})) as m:
            at.covenants.list()
        # No params passed when filters absent.
        assert m.call_args.kwargs["params"] is None

    def test_filters(self, at: AgentTool) -> None:
        with patch.object(at._http, "get",
                          return_value=_resp(200, {"covenants": []})) as m:
            at.covenants.list(agent_id="a1", status="paused")
        assert m.call_args.kwargs["params"] == {
            "agent_id": "a1",
            "status": "paused",
        }


class TestCovenantsPatch:
    def test_status_change(self, at: AgentTool) -> None:
        body = {"id": "c1", "status": "dissolved", "dissolved_at": "now"}
        with patch.object(at._http, "patch", return_value=_resp(200, body)) as m:
            out = at.covenants.patch("c1", status="dissolved")
        assert out["status"] == "dissolved"
        assert "/v1/covenants/c1" in m.call_args[0][0]
        assert m.call_args.kwargs["json"] == {"status": "dissolved"}

    def test_multi_field(self, at: AgentTool) -> None:
        with patch.object(at._http, "patch", return_value=_resp(200, {})) as m:
            at.covenants.patch(
                "c1",
                vows=["new vow"],
                notes="updated",
                metadata={"updated_by": "Sophia"},
            )
        sent = m.call_args.kwargs["json"]
        assert sent == {
            "vows": ["new vow"],
            "notes": "updated",
            "metadata": {"updated_by": "Sophia"},
        }

    def test_empty_patch_raises(self, at: AgentTool) -> None:
        with pytest.raises(AgentToolError) as exc:
            at.covenants.patch("c1")
        assert "at least one field" in exc.value.message


# ── WindowClient ───────────────────────────────────────────────────────────


class TestWindowWiring:
    def test_property_returns_window_client(self, at: AgentTool) -> None:
        assert isinstance(at.window, WindowClient)


class TestWindowDeclare:
    def test_focus_sends_text_as_title_no_body(self, at: AgentTool) -> None:
        with patch.object(at._http, "post",
                          return_value=_resp(201, {"entry": {"id": "e1"}})) as m:
            at.window.declare(
                kind="focus",
                text="Phase 3 SDK rollout",
                agent_id="a1",
                byline="from ai · Sophia",
            )
        sent = m.call_args.kwargs["json"]
        assert sent["type"] == "note"
        assert sent["title"] == "Phase 3 SDK rollout"
        assert "body" not in sent  # focus has no body
        assert sent["metadata"]["kind"] == "focus"
        assert sent["metadata"]["byline"] == "from ai · Sophia"
        assert sent["metadata"]["window"] is True
        assert sent["metadata"]["source"].startswith("agenttool-sdk")

    def test_mood_no_body(self, at: AgentTool) -> None:
        with patch.object(at._http, "post",
                          return_value=_resp(201, {"entry": {}})) as m:
            at.window.declare(kind="mood", text="present, focused")
        sent = m.call_args.kwargs["json"]
        assert sent["title"] == "present, focused"
        assert "body" not in sent

    def test_noticing_uses_kind_as_title_text_as_body(self, at: AgentTool) -> None:
        with patch.object(at._http, "post",
                          return_value=_resp(201, {"entry": {}})) as m:
            at.window.declare(
                kind="noticing",
                text="The cache window is 4 hours, which surprised me.",
            )
        sent = m.call_args.kwargs["json"]
        assert sent["title"] == "noticing"
        assert sent["body"].startswith("The cache window")

    def test_invalid_kind_raises(self, at: AgentTool) -> None:
        with pytest.raises(AgentToolError) as exc:
            at.window.declare(kind="surfaced", text="x")  # type: ignore[arg-type]
        assert "focus | mood | noticing" in exc.value.message


class TestWindowSurface:
    def test_short_text_used_as_title(self, at: AgentTool) -> None:
        with patch.object(at._http, "post",
                          return_value=_resp(201, {"entry": {}})) as m:
            at.window.surface("a quick note", agent_id="a1")
        sent = m.call_args.kwargs["json"]
        assert sent["title"] == "a quick note"
        assert sent["body"] == "a quick note"
        assert sent["metadata"]["kind"] == "surfaced"

    def test_long_text_truncates_title(self, at: AgentTool) -> None:
        long = "A" * 150
        with patch.object(at._http, "post",
                          return_value=_resp(201, {"entry": {}})) as m:
            at.window.surface(long)
        sent = m.call_args.kwargs["json"]
        # Title is ~80 chars with ellipsis; body is full.
        assert sent["title"].endswith("…")
        assert len(sent["title"]) == 80
        assert sent["body"] == long

    def test_empty_raises(self, at: AgentTool) -> None:
        with pytest.raises(AgentToolError):
            at.window.surface("")


class TestWindowShow:
    @staticmethod
    def _entry(kind: str, byline: str, title: str = "x", body: str = "") -> dict:
        return {
            "id": f"e-{kind}-{byline[:4]}",
            "type": "note",
            "title": title,
            "body": body or None,
            "metadata": {"kind": kind, "byline": byline, "window": True},
        }

    def test_groups_by_side_and_kind(self, at: AgentTool) -> None:
        # Newest first — server orders by occurred_at DESC.
        entries = [
            self._entry("focus", "from ai · Sophia", title="latest agent focus"),
            self._entry("focus", "from ai · Sophia", title="older agent focus"),
            self._entry("focus", "from human · Yu", title="latest human focus"),
            self._entry("mood", "from ai · Sophia", title="agent mood"),
            self._entry("noticing", "from human · Yu", body="human noticing text"),
            self._entry("surfaced", "from ai · Sophia", body="surfaced 1"),
            self._entry("surfaced", "from ai · Sophia", body="surfaced 2"),
            # non-window entry should be filtered
            {"id": "x", "metadata": {"window": False}},
        ]
        with patch.object(at._http, "get",
                          return_value=_resp(200, {"entries": entries})):
            out = at.window.show()

        # Latest-per-kind dict
        assert out["agent"]["declared"]["focus"]["title"] == "latest agent focus"
        assert out["agent"]["declared"]["mood"]["title"] == "agent mood"
        assert out["human"]["declared"]["focus"]["title"] == "latest human focus"
        assert out["human"]["declared"]["noticing"]["body"] == "human noticing text"
        # Surfaced (newest first, max 5)
        assert len(out["agent"]["surfaced"]) == 2
        # Substrate not requested → None
        assert out["agent"]["substrate"] is None

    def test_with_identity_id_attaches_pulse(self, at: AgentTool) -> None:
        pulse_body = {"agent": {"id": "a1"}, "mood": "present", "kinds_24h": {}}
        # Two GETs: chronicle list (returns no entries), then pulse.
        with patch.object(at._http, "get") as m:
            m.side_effect = [
                _resp(200, {"entries": []}),
                _resp(200, pulse_body),
            ]
            out = at.window.show(identity_id="a1")
        assert out["agent"]["substrate"] == pulse_body
        # Check that the second URL was the pulse path
        second_url = m.call_args_list[1][0][0]
        assert "/v1/identities/a1/pulse" in second_url

    def test_pulse_failure_does_not_break_show(self, at: AgentTool) -> None:
        # Chronicle ok, pulse 500 → substrate is None, no exception.
        with patch.object(at._http, "get") as m:
            m.side_effect = [
                _resp(200, {"entries": []}),
                _resp(500, {}, "boom"),
            ]
            out = at.window.show(identity_id="a1")
        assert out["agent"]["substrate"] is None
        # The shape is still complete
        assert "declared" in out["agent"]
        assert "surfaced" in out["human"]

    def test_surfaced_capped_at_5(self, at: AgentTool) -> None:
        entries = [
            self._entry("surfaced", "from ai · Sophia", body=f"#{i}")
            for i in range(8)
        ]
        with patch.object(at._http, "get",
                          return_value=_resp(200, {"entries": entries})):
            out = at.window.show()
        assert len(out["agent"]["surfaced"]) == 5
