from __future__ import annotations

import copy

import pytest

from agenttool_hf_training_host import DecisionInvalid, ValidatedGovernanceView


def test_closed_decision_round_trip(preflight: ValidatedGovernanceView) -> None:
    assert ValidatedGovernanceView.from_mapping(preflight.as_dict()) == preflight
    assert preflight.control.automatic is False
    assert preflight.control.mutates_forward_pass is False


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("validator_profile",), "pretend-validator"),
        (("control", "should_save"), True),
        (("boundaries", "content_id_authenticates_validator"), True),
    ],
)
def test_rejects_forged_or_inconsistent_fields(
    preflight: ValidatedGovernanceView,
    path: tuple[str, ...],
    value: object,
) -> None:
    candidate = copy.deepcopy(preflight.as_dict())
    target = candidate
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    with pytest.raises(DecisionInvalid):
        ValidatedGovernanceView.from_mapping(candidate)


def test_content_id_detects_mutation(preflight: ValidatedGovernanceView) -> None:
    candidate = preflight.as_dict()
    candidate["run_ref"] = candidate["admission_id"]
    with pytest.raises(DecisionInvalid, match="decision_id"):
        ValidatedGovernanceView.from_mapping(candidate)
