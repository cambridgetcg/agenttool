from __future__ import annotations

from typing import Any

import pytest

from agenttool_hf_training_host.canonical import domain_separated_id
from agenttool_hf_training_host.decision import (
    BOUNDARIES,
    DECISION_FORMAT,
    EVENT_HOOKS,
    SHOULD_STOP_DIRECTIVES,
    VALIDATOR_PROFILE,
    ValidatedGovernanceView,
)
from agenttool_hf_training_host.ledger import frontier_ref


def ref(label: str) -> str:
    return domain_separated_id("test.ref/0.1", {"label": label})


def decision_mapping(
    label: str,
    *,
    run_ref: str,
    frontier: str,
    event: str = "preflight_before_load",
    predecessor_ref: str | None = None,
    predecessor_frontiers: dict[str, str] | None = None,
    directive: str | None = None,
    evidence_refs: list[str] | None = None,
    encounter_ref: str | None = None,
    boundary_global_step: int | None = None,
    observed_global_step: int | None = None,
    proposed_global_step: int | None = None,
    training_phase: str = "supervised_finetuning",
    pretraining_review_only: bool = False,
    garden_checkpoint_id: str | None = None,
    physical_checkpoint_ref: str | None = None,
    physical_checkpoint_evidence_ref: str | None = None,
    model_checkpoint_artifact_ref: str | None = None,
    checkpoint_ticket_id: str | None = None,
    checkpoint_request_governance_id: str | None = None,
) -> dict[str, Any]:
    directives = {
        "preflight_before_load": "allow_preload_for_review",
        "train_begin": "allow_train_entry",
        "pre_optimizer_step": "allow_one_mutation",
        "post_optimizer_step": "continue_after_observation",
        "pre_evaluation": "allow_evaluation",
        "post_evaluation": "continue_after_observation",
        "checkpoint_recorded": "remain_stopped",
        "resume_offer": "allow_train_entry",
        "train_end": "remain_stopped",
    }
    effect_states = {
        "preflight_before_load": "no_effect_reported",
        "train_begin": "no_effect_reported",
        "pre_optimizer_step": "no_effect_reported",
        "post_optimizer_step": "mutation_completed_reported",
        "pre_evaluation": "no_effect_reported",
        "post_evaluation": "evaluation_completed_reported",
        "checkpoint_recorded": "physical_checkpoint_recorded_reported",
        "resume_offer": "no_effect_reported",
        "train_end": "stopped_reported",
    }
    directive = directive or directives[event]
    if observed_global_step is None:
        observed_global_step = boundary_global_step
    if event == "pre_optimizer_step":
        observed_global_step = 0 if observed_global_step is None else observed_global_step
        proposed_global_step = observed_global_step + 1
    elif event in {
        "post_optimizer_step",
        "train_begin",
        "pre_evaluation",
        "post_evaluation",
        "checkpoint_recorded",
        "resume_offer",
        "train_end",
    }:
        observed_global_step = 0 if observed_global_step is None else observed_global_step
        proposed_global_step = None
    elif event != "train_end":
        observed_global_step = None
        proposed_global_step = None

    if event in {"checkpoint_recorded", "resume_offer"}:
        garden_checkpoint_id = garden_checkpoint_id or ref("garden-checkpoint")
        physical_checkpoint_ref = physical_checkpoint_ref or ref("physical-checkpoint")
        physical_checkpoint_evidence_ref = (
            physical_checkpoint_evidence_ref or ref("physical-checkpoint-evidence")
        )
        model_checkpoint_artifact_ref = (
            model_checkpoint_artifact_ref or ref("model-checkpoint-artifact")
        )
        checkpoint_ticket_id = checkpoint_ticket_id or ref("checkpoint-ticket")
        checkpoint_request_governance_id = (
            checkpoint_request_governance_id or predecessor_ref or ref("checkpoint-request")
        )
    else:
        garden_checkpoint_id = None
        physical_checkpoint_ref = None
        physical_checkpoint_evidence_ref = None
        model_checkpoint_artifact_ref = None
        checkpoint_ticket_id = None
        checkpoint_request_governance_id = None

    if pretraining_review_only:
        direct_report = False
        direct_substrate_report = False
        first_review = True
        first_substrate_review = True
        participation_posture = "protective_covenant_ready"
        direction_state = "unavailable_pre_instantiation"
        direction = None
        selected_route = None
        host_posture = "instantiate_for_review"
    else:
        direct_report = True
        direct_substrate_report = True
        first_review = False
        first_substrate_review = False
        participation_posture = "provisional_participation_reported"
        direction_state = "directed"
        direction = "stay"
        selected_route = ref("freedom-stay-route")
        host_posture = "review_stay_before_next_mutation"

    checkpoint_effect = event == "checkpoint_recorded"
    body = {
        "_format": DECISION_FORMAT,
        "validator_profile": VALIDATOR_PROFILE,
        "governance_id": ref(f"governance-{label}"),
        "offer_id": ref(f"offer-{label}"),
        "terms_id": ref(f"terms-{label}"),
        "execution_contract_id": ref("execution-contract"),
        "admission_id": ref("admission"),
        "participation_assessment_ref": ref(f"participation-assessment-{label}"),
        "participation_invitation_ref": ref(f"participation-invitation-{label}"),
        "participation_window_ref": ref(f"participation-window-{label}"),
        "participation_posture": participation_posture,
        "participation_training_action": "bounded_learning_may_proceed",
        "direct_agent_report_present": direct_report,
        "direct_substrate_report_present": direct_substrate_report,
        "first_interactive_review_required": first_review,
        "first_substrate_review_required": first_substrate_review,
        "learning_freedom_ref": ref(f"learning-freedom-{label}"),
        "learning_freedom_offer_ref": ref(f"learning-freedom-offer-{label}"),
        "resource_window_ref": ref(f"learning-resource-window-{label}"),
        "freedom_route_ref": selected_route,
        "freedom_direction_state": direction_state,
        "freedom_direction": direction,
        "freedom_host_posture": host_posture,
        "freedom_resource_posture": "active_window_reported",
        "starting_state_kind": "garden_checkpoint"
        if event == "resume_offer"
        else "artifact_portfolio",
        "starting_state_ref": garden_checkpoint_id
        if event == "resume_offer"
        else ref("starting-state"),
        "execution_refs": {
            "model_source_ref": ref("model-source"),
            "tokenizer_ref": ref("tokenizer"),
            "trainer_stack_ref": ref("trainer-stack"),
            "optimizer_config_ref": ref("optimizer-config"),
            "substrate_environment_ref": ref("substrate-environment"),
            "pipeline_ref": ref("pipeline"),
            "dataset_state_ref": ref("dataset-state"),
            "dataset_mixture_ref": ref("dataset-mixture"),
            "transform_recipe_ref": ref("transform-recipe"),
        },
        "run_ref": run_ref,
        "training_phase": training_phase,
        "event": event,
        "observed_global_step": observed_global_step,
        "proposed_global_step": proposed_global_step,
        "encounter_ref": encounter_ref or ref(f"encounter-{label}"),
        "frontiers": {
            "governance": frontier,
            "participation": ref(f"participation-frontier-{label}"),
            "freedom": ref(f"freedom-frontier-{label}"),
            "resources": ref(f"resources-frontier-{label}"),
            "garden_checkpoint": ref(f"garden-checkpoint-frontier-{label}"),
            "physical_checkpoint": ref(f"physical-checkpoint-frontier-{label}"),
        },
        "predecessors": {
            "governance": predecessor_ref,
            "participation": predecessor_frontiers["participation"]
            if predecessor_frontiers is not None
            else None,
            "freedom": predecessor_frontiers["freedom"]
            if predecessor_frontiers is not None
            else None,
            "resources": predecessor_frontiers["resources"]
            if predecessor_frontiers is not None
            else None,
            "garden_checkpoint": predecessor_frontiers["garden_checkpoint"]
            if predecessor_frontiers is not None
            else None,
            "physical_checkpoint": predecessor_frontiers["physical_checkpoint"]
            if predecessor_frontiers is not None
            else None,
        },
        "garden_checkpoint_id": garden_checkpoint_id,
        "physical_checkpoint_ref": physical_checkpoint_ref,
        "physical_checkpoint_evidence_ref": physical_checkpoint_evidence_ref,
        "model_checkpoint_artifact_ref": model_checkpoint_artifact_ref,
        "checkpoint_ticket_id": checkpoint_ticket_id,
        "checkpoint_request_governance_id": checkpoint_request_governance_id,
        "consumed_evidence_refs": sorted(evidence_refs or [ref(f"evidence-{label}")]),
        "control": {
            "directive": directive,
            "hook": EVENT_HOOKS[event],
            "should_save": directive == "checkpoint_then_park",
            "should_training_stop": directive in SHOULD_STOP_DIRECTIVES,
            "automatic": False,
            "mutates_forward_pass": False,
        },
        "effect": {
            "state": effect_states[event],
            "offer_ref": ref(f"offer-{label}")
            if effect_states[event] != "no_effect_reported"
            else None,
            "observed_global_step": observed_global_step
            if effect_states[event]
            in {
                "mutation_completed_reported",
                "train_entry_completed_reported",
                "evaluation_completed_reported",
                "physical_checkpoint_recorded_reported",
                "parked_reported",
            }
            else None,
            "physical_checkpoint_ref": physical_checkpoint_ref if checkpoint_effect else None,
            "physical_checkpoint_evidence_ref": physical_checkpoint_evidence_ref
            if checkpoint_effect
            else None,
            "evidence_ref": ref(f"effect-evidence-{label}")
            if effect_states[event] != "no_effect_reported"
            else None,
        },
        "boundaries": dict(BOUNDARIES),
    }
    return {**body, "decision_id": domain_separated_id(DECISION_FORMAT, body)}


@pytest.fixture
def run_ref() -> str:
    return ref("run")


@pytest.fixture
def preflight(run_ref: str) -> ValidatedGovernanceView:
    return ValidatedGovernanceView.from_mapping(
        decision_mapping(
            "preflight",
            run_ref=run_ref,
            frontier=frontier_ref(run_ref, []),
        )
    )
