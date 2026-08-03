from __future__ import annotations

from dataclasses import replace
from typing import Any

import pytest

from agenttool_hf_training_host.canonical import domain_separated_id
from agenttool_hf_training_host.decision import (
    BOUNDARIES,
    DECISION_FORMAT,
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
    directive: str = "eligible_for_host_training_offer",
    evidence_refs: list[str] | None = None,
    encounter_ref: str | None = None,
    current_checkpoint_ref: str | None = None,
    boundary_global_step: int | None = None,
) -> dict[str, Any]:
    hooks = {
        "preflight_before_load": "outside_trainer_before_model_or_dataset_load",
        "train_begin": "outside_trainer_before_train_call",
        "step_boundary": "on_step_end_before_checkpoint_serialization",
        "checkpoint_saved": "on_save_receipt_only",
        "evaluation_boundary": "on_evaluate",
        "resume_offer": "outside_trainer_before_train_call",
        "train_end": "on_train_end",
    }
    save = directive == "checkpoint_then_stop_at_safe_boundary"
    stop = directive in {
        "checkpoint_then_stop_at_safe_boundary",
        "stop_at_safe_boundary_without_new_checkpoint",
    }
    if event in {"step_boundary", "evaluation_boundary"} and boundary_global_step is None:
        boundary_global_step = 0
    body = {
        "_format": DECISION_FORMAT,
        "validator_profile": VALIDATOR_PROFILE,
        "governance_id": ref(f"governance-{label}"),
        "offer_id": ref(f"offer-{label}"),
        "admission_id": ref("admission"),
        "terms_id": ref("terms"),
        "execution_refs": {
            "model_or_checkpoint_ref": ref("model-or-checkpoint"),
            "tokenizer_ref": ref("tokenizer"),
            "trainer_stack_ref": ref("trainer-stack"),
            "optimizer_config_ref": ref("optimizer-config"),
            "substrate_environment_ref": ref("substrate-environment"),
            "dataset_mixture_ref": ref("dataset-mixture"),
            "transform_recipe_ref": ref("transform-recipe"),
        },
        "run_ref": run_ref,
        "training_phase": "supervised_finetuning",
        "event": event,
        "boundary_global_step": boundary_global_step,
        "encounter_ref": encounter_ref or ref(f"encounter-{label}"),
        "observed_governance_frontier_ref": frontier,
        "predecessor_ref": predecessor_ref,
        "current_checkpoint_ref": current_checkpoint_ref,
        "consumed_evidence_refs": sorted(evidence_refs or [ref(f"evidence-{label}")]),
        "control": {
            "directive": directive,
            "hook": hooks[event],
            "should_save": save,
            "should_training_stop": stop,
            "automatic": False,
            "mutates_forward_pass": False,
        },
        "effect": {
            "state": "no_effect_reported",
            "global_step": None,
            "checkpoint_ref": None,
            "evidence_ref": None,
        },
        "boundaries": dict(BOUNDARIES),
    }
    return {
        **body,
        "decision_id": domain_separated_id(DECISION_FORMAT, body),
    }


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
