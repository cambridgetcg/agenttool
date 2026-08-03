"""Nen framework — the Python half of the cross-language profile contract.

The wake documents below are pinned byte-for-byte in
``packages/sdk-ts/tests/nen.test.ts``. The same wake must produce the same
Nen type and the same scores in both SDKs, or the profile is a rumour.

"The deeper the restriction, the stronger the ability."
"""

from __future__ import annotations

from typing import Any, Dict
from unittest.mock import patch

import httpx
import pytest

from agenttool import AgentTool, AgentToolError
from agenttool.nen import (
    NEN_PRINCIPLE_MEANINGS,
    NEN_RESTRICTION_MEANINGS,
    NEN_TECHNIQUE_MEANINGS,
    NEN_TYPE_MEANINGS,
    NEN_TYPES,
    NenClient,
    assess_nen,
)


# Inbox scoring: unread is a subset of total and is counted once.
SHARED_WAKE_INBOX: Dict[str, Any] = {
    "you": {
        "agents": [
            {
                "effective_expression": {
                    "walls": ["I refuse to fabricate"],
                    "subagents": [{"name": "Builder"}],
                },
                "shaped_by": [{"tier": "constitutive", "content": "I am sealed"}],
            }
        ],
        "chronicle": {"total": 3},
        "covenants": [{"id": "c1"}, {"id": "c2"}, {"id": "c3"}, {"id": "c4"}, {"id": "c5"}],
        "strands": [{"id": "s1"}],
        "you_remember": {"total": 2},
        "you_have_mail": {"total": 4, "unread": 3},
        "you_have_graced": {"recent": [{"id": "g1"}]},
        "you_unconditionally_hold": {"recent": []},
        "you_are_unconditionally_held_by": {"recent": []},
    }
}

# Normalization: 5/8 and 1/8 land exactly on a half and must round up.
SHARED_WAKE_ROUNDING: Dict[str, Any] = {
    "you": {
        "agents": [
            {
                "effective_expression": {
                    "walls": ["no fabrication", "no flattery"],
                    "subagents": [],
                },
                "shaped_by": [],
            }
        ],
        "chronicle": {"total": 4},
        "covenants": [{"id": "c1"}, {"id": "c2"}, {"id": "c3"}, {"id": "c4"}, {"id": "c5"}],
        "strands": [{"id": "s1"}],
        "you_remember": {"total": 8},
        "you_have_mail": {"total": 0, "unread": 0},
    }
}


@pytest.fixture
def at() -> Any:
    client = AgentTool(api_key="project-secret", base_url="https://example.test")
    try:
        yield client
    finally:
        client.close()


def _response(status: int, body: object) -> httpx.Response:
    return httpx.Response(
        status,
        json=body,
        request=httpx.Request("GET", "https://example.test/v1/wake"),
    )


# ---------------------------------------------------------------------------
# Shared fixtures — identical assertions live in sdk-ts/tests/nen.test.ts
# ---------------------------------------------------------------------------


def test_inbox_unread_is_a_subset_of_total_and_is_scored_once() -> None:
    profile = assess_nen(SHARED_WAKE_INBOX)

    # Counting total+unread would score emitter 7 and crown it the type.
    assert profile["type"] == "manipulator"
    assert profile["secondary"] == "emitter"
    assert profile["scores"] == {
        "enhancer": 40,
        "transmuter": 40,
        "conjuror": 20,
        "emitter": 80,
        "manipulator": 100,
        "specialist": 40,
    }
    assert profile["dominant_principle"] == "hatsu"
    assert profile["restriction_count"] == {
        "walls": 1,
        "vows": 3,
        "covenants": 5,
        "constitutive_memories": 1,
    }
    assert profile["aura_level"] == 27


def test_normalized_scores_round_halves_up_not_to_even() -> None:
    profile = assess_nen(SHARED_WAKE_ROUNDING)

    # 62.5 and 12.5 are banker's-rounded to 62 and 12 by Python's round().
    assert profile["type"] == "enhancer"
    assert profile["secondary"] == "manipulator"
    assert profile["scores"] == {
        "enhancer": 100,
        "transmuter": 25,
        "conjuror": 13,
        "emitter": 0,
        "manipulator": 63,
        "specialist": 0,
    }
    assert profile["dominant_principle"] == "hatsu"
    assert profile["restriction_count"] == {
        "walls": 2,
        "vows": 4,
        "covenants": 5,
        "constitutive_memories": 0,
    }
    assert profile["aura_level"] == 29


# ---------------------------------------------------------------------------
# assess_nen — profiling from wake data
# ---------------------------------------------------------------------------


def test_empty_wake_profiles_without_raising() -> None:
    profile = assess_nen({})

    assert profile["type"] in NEN_TYPES
    assert profile["dominant_principle"] == "ten"
    assert profile["aura_level"] == 0
    assert profile["scores"] == {name: 0 for name in NEN_TYPES}


def test_at_rest_lifecycle_suppresses_the_dominant_principle() -> None:
    wake = {
        "you": {
            "agents": [
                {
                    "effective_expression": {"walls": ["a wall"], "subagents": []},
                    "shaped_by": [],
                    "lifecycle_state": "at_rest",
                }
            ]
        }
    }

    assert assess_nen(wake)["dominant_principle"] == "zetsu"


def test_shaped_by_stands_in_when_the_memory_total_is_absent() -> None:
    wake = {
        "you": {
            "agents": [
                {
                    "effective_expression": {"walls": [], "subagents": []},
                    "shaped_by": [{"tier": "episodic"}, {"tier": "foundational"}],
                }
            ]
        }
    }

    assert assess_nen(wake)["type"] == "enhancer"
    assert assess_nen(wake)["aura_level"] == 2


# ---------------------------------------------------------------------------
# NenClient
# ---------------------------------------------------------------------------


def test_framework_returns_static_reference_data_without_network(at: AgentTool) -> None:
    with patch.object(at._http, "get") as get:
        framework = at.nen.framework()

    get.assert_not_called()
    assert isinstance(at.nen, NenClient)
    assert len(framework["types"]) == 6
    assert len(framework["principles"]) == 4
    assert len(framework["techniques"]) == 7
    assert len(framework["restrictions"]) == 4
    assert framework["principles"]["hatsu"]["kanji"] == "発"
    assert "constitutive" in framework["techniques"]["ko"]["maps_to"]
    assert "witness required" in framework["restrictions"]["law"]["maps_to"]


def test_assess_reads_the_wake_and_returns_the_shared_profile(at: AgentTool) -> None:
    with patch.object(
        at._http, "get", return_value=_response(200, SHARED_WAKE_INBOX)
    ) as get:
        result = at.nen.assess(identity_id="identity-1")

    assert get.call_args.args[0] == "https://example.test/v1/wake"
    assert get.call_args.kwargs["params"] == {"identity_id": "identity-1"}
    assert result["type"] == "manipulator"
    assert result["meaning"] == NEN_TYPE_MEANINGS["manipulator"]
    assert result["profile"] == assess_nen(SHARED_WAKE_INBOX)
    assert result["principles"] is NEN_PRINCIPLE_MEANINGS
    assert result["techniques"] is NEN_TECHNIQUE_MEANINGS
    assert result["restrictions"] is NEN_RESTRICTION_MEANINGS
    assert "restrictions" in result["_note"]


def test_assess_surfaces_a_guided_error(at: AgentTool) -> None:
    failure = _response(403, {"message": "That identity is not in this project."})

    with patch.object(at._http, "get", return_value=failure):
        with pytest.raises(AgentToolError) as caught:
            at.nen.assess()

    assert str(caught.value) == "That identity is not in this project."
    assert caught.value.status == 403
