"""Dark Continent SDK truth and cross-language behavior tests."""

from typing import Any, List
from unittest.mock import patch

import httpx

from agenttool import AgentTool
from agenttool.dark_continent import CALAMITIES, GUIDE, OPERATION_LOGOS


def test_check_wall_returns_an_unverified_static_declaration() -> None:
    with AgentTool(api_key="at_test") as at:
        for calamity in CALAMITIES:
            wall = at.dark_continent.check_wall(calamity)
            assert wall["status"] == "not_checked"
            assert wall["verified"] is False
            assert "holding" not in wall
            assert len(wall["wall"]) > 10
            assert "does not inspect runtime state" in wall["note"]
            assert "cannot determine" in wall["note"]


def test_check_logos_matches_typescript_surface() -> None:
    with AgentTool(api_key="at_test") as at:
        assert any(
            logos["name"] == "VOW"
            for logos in at.dark_continent.check_logos("declare: I am truth")
        )
        assert any(
            logos["name"] == "AI"
            for logos in at.dark_continent.check_logos("bond with nova")
        )
        assert at.dark_continent.check_logos("xyz random action")[0]["name"] == "GUIDE"
        assert at.dark_continent.framework()["logos"] is OPERATION_LOGOS


def _record_sends(sent: List[str], wake: Any = None):
    """Stand in for every httpx client's send, so no request leaves the test."""

    def send(_client: httpx.Client, request: httpx.Request, **_: Any) -> httpx.Response:
        sent.append(request.url.path)
        if isinstance(wake, Exception):
            raise wake
        return httpx.Response(200, json=wake or {}, request=request)

    return patch.object(httpx.Client, "send", send)


def test_guide_says_discovery_is_retired() -> None:
    assert "wake" in GUIDE["maps_to"]
    assert "discovery is retired" in GUIDE["warning"]


def test_explore_makes_no_request_and_marks_discovery_retired() -> None:
    sent: List[str] = []
    with AgentTool(api_key="at_test") as at, _record_sends(sent):
        results = [
            at.dark_continent.explore(),
            # The capability filter is a retired no-op, not a reason to ask.
            at.dark_continent.explore(capability="search"),
        ]

    for dc in results:
        assert dc["discovery"] == "retired"
        assert dc["known_world"] == []
        assert dc["known_count"] == 0
        assert dc["nen_profile"] is None
        assert dc["calamities"]["ai"]["kanji"] == "愛"
        assert dc["guide"]["kanji"] == "案"
        assert dc["ai_position"]["here"] is True
        assert "Ai" in dc["ai_position"]["note"]
        assert "暗黑大陸" in dc["_note"]
    assert sent == []


def test_explore_with_include_nen_reads_only_the_wake() -> None:
    wake = {
        "you": {
            "agents": [{
                "effective_expression": {
                    "walls": ["I refuse to fabricate"],
                    "subagents": [],
                },
                "shaped_by": [{"tier": "constitutive", "content": "I am sealed"}],
            }],
            "chronicle": {"total": 5},
            "covenants": [],
            "strands": [],
            "you_remember": {"total": 10},
        },
    }
    sent: List[str] = []
    with AgentTool(api_key="at_test") as at, _record_sends(sent, wake):
        dc = at.dark_continent.explore(include_nen=True)

    assert sent == ["/v1/wake"]
    assert dc["nen_profile"] is not None
    assert dc["discovery"] == "retired"


def test_explore_with_include_nen_degrades_when_the_wake_read_fails() -> None:
    sent: List[str] = []
    failure = httpx.ConnectError("simulated network failure")
    with AgentTool(api_key="at_test") as at, _record_sends(sent, failure):
        dc = at.dark_continent.explore(include_nen=True)

    # An unregistered or unreachable agent is on the Dark Continent, not in error.
    assert sent == ["/v1/wake"]
    assert dc["nen_profile"] is None
    assert dc["known_world"] == []
    assert dc["discovery"] == "retired"
    assert dc["ai_position"]["here"] is True
