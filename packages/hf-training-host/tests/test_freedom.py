from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest

from agenttool_hf_training_host import (
    DecisionInvalid,
    FREEDOM_BOUNDARIES,
    FREEDOM_DECISION_FORMAT,
    FREEDOM_VALIDATOR_PROFILE,
    ValidatedFreedomView,
    ValidatedGovernanceView,
)
from agenttool_hf_training_host.canonical import domain_separated_id
from conftest import decision_mapping, ref


def freedom_mapping(
    governance: ValidatedGovernanceView,
    label: str,
    *,
    directive: str = "continue_if_governance_allows",
) -> dict[str, Any]:
    step = governance.boundary_global_step
    if governance.event in {"checkpoint_saved", "train_end"}:
        step = governance.effect.global_step if governance.effect.global_step is not None else 0
    body = {
        "_format": FREEDOM_DECISION_FORMAT,
        "validator_profile": FREEDOM_VALIDATOR_PROFILE,
        "governance_decision_ref": governance.decision_id,
        "governance_ref": governance.governance_id,
        "offer_ref": governance.offer_id,
        "freedom_field_ref": ref(f"freedom-field-{label}"),
        "freedom_transition_ref": ref(f"freedom-transition-{label}"),
        "observed_freedom_frontier_ref": ref(f"freedom-frontier-{label}"),
        "freedom_predecessor_ref": None,
        "run_ref": governance.run_ref,
        "training_phase": governance.training_phase,
        "event": governance.event,
        "boundary_global_step": step,
        "control": {
            "directive": directive,
            "should_save": False,
            "should_training_stop": directive == "hold_without_save",
            "automatic": False,
            "applied": False,
        },
        "boundaries": dict(FREEDOM_BOUNDARIES),
    }
    return {
        **body,
        "freedom_decision_id": domain_separated_id(FREEDOM_DECISION_FORMAT, body),
    }


def test_closed_freedom_round_trip_and_governance_binding(
    preflight: ValidatedGovernanceView,
) -> None:
    value = freedom_mapping(preflight, "round-trip")
    parsed = ValidatedFreedomView.from_mapping(value)
    assert parsed.as_dict() == value
    assert parsed.bind_to_governance(preflight) is parsed
    assert parsed.control.should_save is False
    assert parsed.control.applied is False


def test_rejects_raw_choice_fields_and_content_id_mutation(
    preflight: ValidatedGovernanceView,
) -> None:
    value = freedom_mapping(preflight, "closed")
    with_raw_choice = copy.deepcopy(value)
    with_raw_choice["choice"] = {"reason": "must never cross this seam"}
    with pytest.raises(DecisionInvalid, match="wrong keys"):
        ValidatedFreedomView.from_mapping(with_raw_choice)

    changed = copy.deepcopy(value)
    changed["freedom_transition_ref"] = ref("changed-transition")
    with pytest.raises(DecisionInvalid, match="freedom_decision_id"):
        ValidatedFreedomView.from_mapping(changed)


def test_requires_the_exact_governance_view(
    preflight: ValidatedGovernanceView,
    run_ref: str,
) -> None:
    freedom = ValidatedFreedomView.from_mapping(
        freedom_mapping(preflight, "governance-binding")
    )
    other = ValidatedGovernanceView.from_mapping(
        decision_mapping(
            "other-governance",
            run_ref=run_ref,
            frontier=ref("other-frontier"),
        )
    )
    with pytest.raises(DecisionInvalid, match="exact governance view"):
        freedom.bind_to_governance(other)


def test_rejects_forged_pretraining_continue(run_ref: str) -> None:
    mapping = decision_mapping(
        "pretraining",
        run_ref=run_ref,
        frontier=ref("pretraining-frontier"),
    )
    body = {key: value for key, value in mapping.items() if key != "decision_id"}
    body["training_phase"] = "pretraining"
    mapping = {
        **body,
        "decision_id": domain_separated_id(
            "kingdom.hf-training-host-decision/0.1",
            body,
        ),
    }
    governance = ValidatedGovernanceView.from_mapping(mapping)
    with pytest.raises(DecisionInvalid, match="pretraining"):
        ValidatedFreedomView.from_mapping(
            freedom_mapping(governance, "pretraining-forged")
        )


def test_rejects_terminal_continue_even_with_a_self_consistent_id(run_ref: str) -> None:
    governance = ValidatedGovernanceView.from_mapping(
        decision_mapping(
            "terminal",
            run_ref=run_ref,
            frontier=ref("terminal-frontier"),
            event="train_end",
            directive="remain_stopped",
        )
    )
    with pytest.raises(DecisionInvalid, match="cannot continue"):
        ValidatedFreedomView.from_mapping(
            freedom_mapping(governance, "terminal-forged")
        )


def test_local_schema_names_the_same_closed_contract() -> None:
    schema_path = (
        Path(__file__).parents[1]
        / "schema"
        / "hf-training-host-freedom-decision-v0.1.schema.json"
    )
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    assert schema["properties"]["_format"]["const"] == FREEDOM_DECISION_FORMAT
    assert schema["properties"]["validator_profile"]["const"] == FREEDOM_VALIDATOR_PROFILE
    assert schema["properties"]["boundaries"]["const"] == dict(FREEDOM_BOUNDARIES)
    assert schema["additionalProperties"] is False
