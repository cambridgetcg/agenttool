from __future__ import annotations

import copy

import pytest

from agenttool_hf_training_host import DecisionInvalid, ValidatedGovernanceView
from agenttool_hf_training_host.canonical import domain_separated_id
from agenttool_hf_training_host.decision import DECISION_FORMAT

from conftest import decision_mapping, ref


def with_decision_id(mapping: dict) -> dict:
    body = {key: value for key, value in mapping.items() if key != "decision_id"}
    return {**body, "decision_id": domain_separated_id(DECISION_FORMAT, body)}


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


@pytest.mark.parametrize(
    ("event", "required_effect"),
    [
        ("post_optimizer_step", "mutation_completed_reported"),
        ("post_evaluation", "evaluation_completed_reported"),
    ],
)
def test_advancing_post_boundary_requires_exact_completed_receipt(
    event: str, required_effect: str
) -> None:
    predecessor_frontiers = {
        "participation": ref("predecessor-participation"),
        "freedom": ref("predecessor-freedom"),
        "resources": ref("predecessor-resources"),
        "garden_checkpoint": ref("predecessor-garden-checkpoint"),
        "physical_checkpoint": ref("predecessor-physical-checkpoint"),
    }
    mapping = decision_mapping(
        f"missing-{event}-receipt",
        run_ref=ref("receipt-run"),
        frontier=ref("receipt-frontier"),
        event=event,
        predecessor_ref=ref("receipt-predecessor"),
        predecessor_frontiers=predecessor_frontiers,
        boundary_global_step=1,
    )
    mapping["effect"] = {
        "state": "no_effect_reported",
        "offer_ref": None,
        "observed_global_step": None,
        "physical_checkpoint_ref": None,
        "physical_checkpoint_evidence_ref": None,
        "evidence_ref": None,
    }
    with pytest.raises(DecisionInvalid, match=required_effect):
        ValidatedGovernanceView.from_mapping(with_decision_id(mapping))


def test_checkpoint_binding_namespaces_are_pairwise_distinct() -> None:
    mapping = decision_mapping(
        "checkpoint-collision",
        run_ref=ref("checkpoint-collision-run"),
        frontier=ref("checkpoint-collision-frontier"),
        event="checkpoint_recorded",
        predecessor_ref=ref("checkpoint-collision-predecessor"),
        predecessor_frontiers={
            "participation": ref("collision-participation"),
            "freedom": ref("collision-freedom"),
            "resources": ref("collision-resources"),
            "garden_checkpoint": ref("collision-garden-frontier"),
            "physical_checkpoint": ref("collision-physical-frontier"),
        },
        boundary_global_step=1,
    )
    mapping["model_checkpoint_artifact_ref"] = mapping["physical_checkpoint_ref"]
    with pytest.raises(DecisionInvalid, match="pairwise distinct"):
        ValidatedGovernanceView.from_mapping(with_decision_id(mapping))
