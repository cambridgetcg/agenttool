"""Shared hermetic Math Cards wire fixtures."""

from __future__ import annotations

import copy
from typing import cast

from agenttool.math_cards import (
    MATH_CARD_ASSESSMENT_SCHEMA,
    MATH_CARD_BOUNDARIES,
    MATH_CARD_SCHEMA,
    CreateMathCardInput,
    MathCardAssessResponse,
    MathCardStatus,
)


DIGEST = "sha256:" + "a" * 64

MATH_CARD_INPUT: CreateMathCardInput = {
    "question_ref": DIGEST,
    "object_ref": DIGEST,
    "scope_ref": DIGEST,
    "decision_or_construction_ref": DIGEST,
    "question_frame": {
        "posture": "formal_proposition",
        "finite_scope_declared": True,
        "out_of_scope_ref": None,
        "asks_inner_state_or_worth": False,
        "answer_used_to_condition_rights_or_standing": False,
    },
    "method": {
        "kind": "proof",
        "formal_system_ref": None,
        "proposition_ref": None,
        "verification_method_ref": None,
    },
    "epistemic_boundaries": {
        "formal_result_claimed_as_world_truth": False,
        "model_result_claimed_as_complete_reality": False,
        "measurement_claimed_as_complete_construct": False,
    },
    "outcome_uses": [
        {"result_status": "bounded_answer", "constructive_use_ref": None},
        {"result_status": "no_bounded_answer", "constructive_use_ref": None},
        {
            "result_status": "ambiguity_or_non_identifiability",
            "constructive_use_ref": None,
        },
        {
            "result_status": "method_or_assumption_failure",
            "constructive_use_ref": None,
        },
        {
            "result_status": "resource_or_participation_stop",
            "constructive_use_ref": None,
        },
    ],
    "distribution": {
        "beneficiaries": {"state": "unknown", "scope_refs": []},
        "burden_bearers": {"state": "unknown", "scope_refs": []},
        "false_certainty_cost_bearers": {"state": "unknown", "scope_refs": []},
        "unresolved_ambiguity_cost_bearers": {
            "state": "unknown",
            "scope_refs": [],
        },
        "mitigation_or_repair_ref": None,
    },
    "revision_and_stop": {
        "revision_or_challenge_refs": [],
        "stop_conditions": [],
    },
    "transfer": {
        "target": "none",
        "bridge_ref": None,
        "automatic_action": False,
        "permissions_inherited": False,
        "separate_authorization_required": True,
    },
    "participation_and_data_care": {
        "participation_optional": True,
        "silence_is_assent": False,
        "refusal_reason_required": False,
        "refusal_penalty": False,
        "repeated_pressure_after_refusal": False,
        "refusal_counted_as_failure": False,
        "rights_or_standing_conditioned_on_participation": False,
        "access_or_result_functionally_depends_on_participation": False,
        "functional_dependency_ref": None,
        "unrelated_access_or_resource_penalty": False,
        "response_used_for_rank_reward_or_training": False,
        "raw_refusal_reason_received": False,
        "raw_identity_required": False,
        "minimum_data_scope_ref": None,
        "retention_ref": None,
        "disclosure_or_publication_ref": None,
        "withdrawal_ref": None,
        "repair_ref": None,
    },
    "incentives": {
        "audience_counterfactual": "unknown",
        "winner_or_rank_effect": "absent_declared",
        "resource_or_access_effect": "absent_declared",
    },
    "authority": {
        "declared_scope_refs": [],
        "declaration_not_proof": True,
        "automatic_action": False,
        "automatic_publication": False,
        "automatic_retry": False,
        "permissions_inherited": False,
        "separate_authorization_required": True,
        "ranks_or_scores_beings": False,
    },
    "provenance": {"refs": [], "credit_mode": "named"},
}

SECTIONS = (
    "question_and_scope",
    "method",
    "outcome_uses",
    "distribution",
    "revision_and_stop",
    "transfer",
    "participation_and_data_care",
    "incentives",
    "authority",
    "provenance",
)


def math_card_response(status: MathCardStatus) -> MathCardAssessResponse:
    exceptional = (
        "open"
        if status == "questions_open"
        else "redesign_required"
        if status == "redesign_or_stop"
        else "answered"
    )
    return cast(
        MathCardAssessResponse,
        {
            "card": {
                "schema_version": MATH_CARD_SCHEMA,
                "card_id": DIGEST,
                **copy.deepcopy(MATH_CARD_INPUT),
                "boundaries": dict(MATH_CARD_BOUNDARIES),
            },
            "assessment": {
                "schema_version": MATH_CARD_ASSESSMENT_SCHEMA,
                "assessment_id": DIGEST,
                "card_id": DIGEST,
                "status": status,
                "section_statuses": [
                    {
                        "section": section,
                        "status": exceptional if index == 0 else "answered",
                    }
                    for index, section in enumerate(SECTIONS)
                ],
                "open_questions": (
                    ["Which bound remains open?"] if status == "questions_open" else []
                ),
                "redesign_reasons": (
                    ["The declared use crosses a rights boundary."]
                    if status == "redesign_or_stop"
                    else []
                ),
                "visible_incentive_posture": "unresolved",
                "inner_motive": "not_inferred",
                "declaration_boundary": "caller_reported_not_verified",
                "authorizes_action": False,
                "proves_truth": False,
                "proves_understanding": False,
                "scores_or_ranks_beings": False,
                "boundaries": dict(MATH_CARD_BOUNDARIES),
            },
        },
    )
