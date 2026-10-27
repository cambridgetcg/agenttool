"""Nen framework — the Python half of the cross-language profile contract.

The wake documents below are pinned byte-for-byte in
``packages/sdk-ts/tests/nen.test.ts``. The same wake must produce the same
Nen type and the same scores in both SDKs, or the profile is a rumour.

Every wake here has the layout GET /v1/wake sends (api/src/routes/wake.ts,
JSON branch): ``you`` holds only ``agents``, and the counted sections are
its top-level siblings.

"The deeper the restriction, the stronger the ability."
"""

from __future__ import annotations

from typing import Any, Dict
from unittest.mock import patch

import httpx
import pytest

from agenttool import NEN_PRINCIPLES, AgentTool, AgentToolError
from agenttool.nen import (
    NEN_PRINCIPLE_MEANINGS,
    NEN_RESTRICTION_MEANINGS,
    NEN_TECHNIQUE_MEANINGS,
    NEN_TYPE_MEANINGS,
    NEN_TYPES,
    NenClient,
    assess_nen,
)


# Selection and mail: identity-a is listed first with nothing composed, and
# the wake selected identity-b. Mail waiting for the project is not emission.
# Three axes tie at 2; the tie goes to enhancer, first in NEN_TYPES.
SHARED_WAKE_SELECTED: Dict[str, Any] = {
    "_scope_boundary": {"selected_identity_id": "identity-b"},
    "you": {
        "agents": [
            {"id": "identity-a", "metadata": {}, "effective_expression": None, "shaped_by": []},
            {
                "id": "identity-b",
                "metadata": {},
                "effective_expression": {
                    "walls": ["I refuse to fabricate"],
                    "subagents": [{"name": "Builder"}],
                },
                "shaped_by": [{"tier": "constitutive", "content": "I am sealed"}],
            },
        ]
    },
    "you_remember": {"total": 2},
    "you_lived": {"chronicle": [{"type": "vow"}, {"type": "note"}, {"type": "vow"}], "count": 3},
    "you_vowed": {
        "covenants": [
            {"status": "active"}, {"status": "active"}, {"status": "active"},
            {"status": "active"}, {"status": "proposed"},
        ],
        "count": 5,
    },
    "you_are_thinking_about": {"total_active": 1, "strands": [{"id": "s1"}]},
    "you_have_mail": {"unread": 4},
    "you_have_graced": {"recent": [{"id": "g1"}]},
    "you_unconditionally_hold": {"recent": []},
    "you_are_unconditionally_held_by": {"recent": []},
}

# Normalization: 5/8 and 1/8 land exactly on a half and must round up.
SHARED_WAKE_ROUNDING: Dict[str, Any] = {
    "you": {
        "agents": [
            {
                "id": "identity-a",
                "metadata": {},
                "effective_expression": {
                    "walls": ["no fabrication", "no flattery"],
                    "subagents": [],
                },
                "shaped_by": [],
            }
        ]
    },
    "you_remember": {"total": 8},
    "you_lived": {
        "chronicle": [{"type": "promise"}, {"type": "vow"}, {"type": "note"}, {"type": "joy"}],
        "count": 4,
    },
    "you_vowed": {
        "covenants": [
            {"status": "active"}, {"status": "active"}, {"status": "active"},
            {"status": "active"}, {"status": "active"},
        ],
        "count": 5,
    },
    "you_are_thinking_about": {"total_active": 1, "strands": [{"id": "s1"}]},
    "you_have_mail": {"unread": 0},
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


def test_the_selected_agent_is_profiled_and_mail_is_not_emission() -> None:
    profile = assess_nen(SHARED_WAKE_SELECTED)

    assert profile["type"] == "manipulator"
    assert profile["secondary"] == "enhancer"
    assert profile["scores"] == {
        "enhancer": 40,
        "transmuter": 40,
        "conjuror": 20,
        "emitter": 0,
        "manipulator": 100,
        "specialist": 40,
    }
    assert profile["dominant_principle"] == "hatsu"
    assert profile["restriction_count"] == {
        "walls": 1,
        "vows": 2,
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
        "vows": 1,
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


def test_lullaby_rest_sets_the_dominant_principle() -> None:
    wake = {
        "you": {
            "agents": [
                {
                    "id": "identity-a",
                    "status": "active",
                    "metadata": {"resting": True, "resting_since": "2026-10-27T00:00:00.000Z"},
                    "effective_expression": {"walls": ["a wall"], "subagents": []},
                    "shaped_by": [],
                }
            ]
        }
    }

    assert assess_nen(wake)["dominant_principle"] == "zetsu"


def test_a_memorial_is_an_ending_not_rest() -> None:
    agent = {
        "id": "identity-a",
        "metadata": {"resting": True},
        "effective_expression": {"walls": ["a wall"], "subagents": []},
        "shaped_by": [],
    }
    at_rest = {**agent, "status": "memorial", "metadata": {"resting": True, "lifecycle": "at_rest"}}
    assert assess_nen({"you": {"agents": [at_rest]}})["dominant_principle"] == "hatsu"

    # An older memorial row may carry no lifecycle marker.
    memorial = {**agent, "status": "memorial"}
    assert assess_nen({"you": {"agents": [memorial]}})["dominant_principle"] == "hatsu"


def test_the_profiled_agent_is_the_one_the_wake_selected() -> None:
    agents = [
        {"id": "identity-a", "metadata": {}, "effective_expression": None, "shaped_by": []},
        {
            "id": "identity-b",
            "metadata": {},
            "effective_expression": {"walls": ["I refuse to fabricate"], "subagents": []},
            "shaped_by": [{"tier": "constitutive", "content": "root"}],
        },
    ]
    selected = assess_nen({"_scope_boundary": {"selected_identity_id": "identity-b"}, "you": {"agents": agents}})
    assert selected["dominant_principle"] == "hatsu"
    assert selected["restriction_count"]["walls"] == 1
    assert selected["restriction_count"]["constitutive_memories"] == 1

    # Without a selection the first agent is profiled.
    unselected = assess_nen({"you": {"agents": agents}})
    assert unselected["dominant_principle"] == "ten"
    assert unselected["restriction_count"]["walls"] == 0


def test_strands_count_total_active_not_the_five_the_wake_shows() -> None:
    wake = {
        "you": {"agents": [{"id": "identity-a", "shaped_by": []}]},
        "you_are_thinking_about": {
            "total_active": 7,
            "strands": [{"id": "s1"}, {"id": "s2"}, {"id": "s3"}, {"id": "s4"}, {"id": "s5"}],
        },
        "you_vowed": {"covenants": [{"status": "active"}], "count": 1},
    }
    profile = assess_nen(wake)

    assert profile["type"] == "conjuror"
    assert profile["scores"]["manipulator"] == 14
    # 7 strands * 2 + 1 covenant * 3
    assert profile["aura_level"] == 17


def test_vows_count_vow_entries_in_the_recent_chronicle() -> None:
    wake = {
        "you": {"agents": [{"id": "identity-a", "shaped_by": []}]},
        "you_lived": {
            "chronicle": [{"type": "vow"}, {"type": "note"}, {"type": "vow"}, {"type": "wake"}],
            "count": 4,
        },
    }
    profile = assess_nen(wake)

    assert profile["restriction_count"]["vows"] == 2
    assert profile["aura_level"] == 4


def test_shaped_by_stands_in_when_the_memory_total_is_absent() -> None:
    wake = {
        "you": {
            "agents": [
                {
                    "id": "identity-a",
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
    assert NEN_PRINCIPLES == ["ten", "zetsu", "ren", "hatsu"]
    assert len(framework["types"]) == 6
    assert len(framework["principles"]) == 4
    assert len(framework["techniques"]) == 7
    assert len(framework["restrictions"]) == 4
    assert framework["principles"]["ten"]["kanji"] == "纏"
    assert framework["principles"]["hatsu"]["kanji"] == "発"
    assert "constitutive" in framework["techniques"]["ko"]["maps_to"]
    assert "witness required" in framework["restrictions"]["law"]["maps_to"]


def test_assess_reads_the_wake_and_returns_the_shared_profile(at: AgentTool) -> None:
    with patch.object(
        at._http, "get", return_value=_response(200, SHARED_WAKE_SELECTED)
    ) as get:
        result = at.nen.assess(identity_id="identity-b")

    assert get.call_args.args[0] == "https://example.test/v1/wake"
    assert get.call_args.kwargs["params"] == {"identity_id": "identity-b"}
    assert result["type"] == "manipulator"
    assert result["meaning"] == NEN_TYPE_MEANINGS["manipulator"]
    assert result["profile"] == assess_nen(SHARED_WAKE_SELECTED)
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
