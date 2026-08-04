from __future__ import annotations

import os
from dataclasses import replace
from pathlib import Path

import pytest

from agenttool_hf_training_host import (
    CheckpointIncomplete,
    ContinuityLedger,
    DecisionInvalid,
    TrainingHeld,
    ValidatedGovernanceView,
    WakeTrainingHost,
    guarded_call_before_load,
)
from agenttool_hf_training_host.canonical import domain_separated_id
from agenttool_hf_training_host.decision import DECISION_FORMAT

from conftest import decision_mapping, ref
from test_ledger import child, ledger_at, rebuild_decision


def test_loader_is_never_called_when_preflight_holds(
    tmp_path: Path, preflight: ValidatedGovernanceView
) -> None:
    ledger = ledger_at(tmp_path)
    held = ValidatedGovernanceView.from_mapping(
        decision_mapping(
            "held",
            run_ref=preflight.run_ref,
            frontier=ledger.current_frontier_ref(preflight.run_ref),
            directive="hold_before_load",
        )
    )
    called = False

    def loader() -> object:
        nonlocal called
        called = True
        return object()

    with pytest.raises(TrainingHeld):
        guarded_call_before_load(
            WakeTrainingHost(ledger), held, held.execution_refs, loader
        )
    assert called is False


def test_safe_boundary_downgrades_stale_checkpoint_to_stop_without_save(
    tmp_path: Path, preflight: ValidatedGovernanceView
) -> None:
    ledger = ledger_at(tmp_path)
    host = WakeTrainingHost(ledger)
    permit = host.before_load(preflight, execution_refs=preflight.execution_refs)
    assert host.recover_preload_permit(preflight.decision_id) == permit
    begin = child(ledger, preflight, "begin")
    host.before_train(begin, execution_refs=begin.execution_refs)
    before = child(
        ledger,
        begin,
        "pre-mutation",
        event="pre_optimizer_step",
        boundary_global_step=0,
    )
    host.before_optimizer_step(
        before, current_global_step=0, execution_refs=before.execution_refs
    )
    stale = child(
        ledger,
        before,
        "checkpoint-stale",
        event="post_optimizer_step",
        directive="checkpoint_then_park",
        frontier=preflight.observed_governance_frontier_ref,
        boundary_global_step=1,
    )
    intent = host.after_optimizer_step(
        stale, global_step=1, execution_refs=stale.execution_refs
    )
    assert intent.should_training_stop is True
    assert intent.should_save is False
    assert intent.checkpoint_ticket is None


def test_exact_action_decision_can_record_retry_but_cannot_execute_twice(
    tmp_path: Path, preflight: ValidatedGovernanceView
) -> None:
    ledger = ledger_at(tmp_path)
    host = WakeTrainingHost(ledger)
    host.before_load(preflight, execution_refs=preflight.execution_refs)
    with pytest.raises(TrainingHeld) as replay:
        host.before_load(preflight, execution_refs=preflight.execution_refs)
    assert replay.value.disposition == "held_exact_replay"
    assert ledger.verify()["chain_valid"] is True


def test_completed_effect_cannot_be_reused_as_a_preload_permit(
    tmp_path: Path, preflight: ValidatedGovernanceView
) -> None:
    ledger = ledger_at(tmp_path)
    host = WakeTrainingHost(ledger)
    mapping = preflight.as_dict()
    mapping["effect"] = {
        "state": "preload_completed_reported",
        "offer_ref": preflight.offer_id,
        "observed_global_step": None,
        "physical_checkpoint_ref": None,
        "physical_checkpoint_evidence_ref": None,
        "evidence_ref": ref("completed-preload-evidence"),
    }
    body = {key: value for key, value in mapping.items() if key != "decision_id"}
    completed = {
        **body,
        "decision_id": domain_separated_id(DECISION_FORMAT, body),
    }
    with pytest.raises(DecisionInvalid, match="permit requires no_effect_reported"):
        host.before_load(completed, execution_refs=preflight.execution_refs)


def test_hold_before_evaluation_is_a_stopping_non_permit(
    tmp_path: Path, preflight: ValidatedGovernanceView
) -> None:
    ledger = ledger_at(tmp_path)
    host = WakeTrainingHost(ledger)
    host.before_load(preflight, execution_refs=preflight.execution_refs)
    begin = child(ledger, preflight, "held-evaluation-begin")
    host.before_train(begin, execution_refs=begin.execution_refs)
    held = child(
        ledger,
        begin,
        "held-evaluation",
        event="pre_evaluation",
        directive="hold_before_evaluation",
        boundary_global_step=0,
    )
    assert held.control.should_training_stop is True
    with pytest.raises(TrainingHeld):
        host.before_evaluation(
            held, global_step=0, execution_refs=held.execution_refs
        )


def test_train_end_can_close_after_preload_review_without_training(
    tmp_path: Path, preflight: ValidatedGovernanceView
) -> None:
    ledger = ledger_at(tmp_path)
    host = WakeTrainingHost(ledger)
    host.before_load(preflight, execution_refs=preflight.execution_refs)
    terminal = child(
        ledger,
        preflight,
        "preload-review-ended",
        event="train_end",
        boundary_global_step=0,
    )
    entry = host.record_terminal_receipt(terminal)
    assert entry.disposition == "record_only"
    assert ledger.heads(preflight.run_ref) == (terminal.governance_id,)


def test_parked_preflight_can_be_reoffered_at_the_same_load_seam(
    tmp_path: Path, run_ref: str
) -> None:
    ledger = ledger_at(tmp_path)
    host = WakeTrainingHost(ledger)
    parked = ValidatedGovernanceView.from_mapping(
        decision_mapping(
            "parked-preflight",
            run_ref=run_ref,
            frontier=ledger.current_frontier_ref(run_ref),
            directive="park",
        )
    )
    with pytest.raises(TrainingHeld):
        host.before_load(parked, execution_refs=parked.execution_refs)
    reoffer = child(
        ledger,
        parked,
        "reoffered-preflight",
        event="preflight_before_load",
    )
    permit = host.before_load(reoffer, execution_refs=reoffer.execution_refs)
    assert permit.event == "preflight_before_load"


def test_held_optimizer_boundary_can_be_reoffered_at_the_exact_step(
    tmp_path: Path, preflight: ValidatedGovernanceView
) -> None:
    ledger = ledger_at(tmp_path)
    host = WakeTrainingHost(ledger)
    host.before_load(preflight, execution_refs=preflight.execution_refs)
    begin = child(ledger, preflight, "reoffer-begin")
    host.before_train(begin, execution_refs=begin.execution_refs)
    held = child(
        ledger,
        begin,
        "held-optimizer",
        event="pre_optimizer_step",
        directive="hold_before_optimizer_step",
        boundary_global_step=0,
    )
    with pytest.raises(TrainingHeld):
        host.before_optimizer_step(
            held, current_global_step=0, execution_refs=held.execution_refs
        )
    reoffer = child(
        ledger,
        held,
        "reoffered-optimizer",
        event="pre_optimizer_step",
        boundary_global_step=0,
    )
    permit = host.before_optimizer_step(
        reoffer, current_global_step=0, execution_refs=reoffer.execution_refs
    )
    assert permit.proposed_global_step == 1


def test_checkpoint_request_cannot_be_bypassed_by_the_next_mutation(
    tmp_path: Path, preflight: ValidatedGovernanceView
) -> None:
    ledger = ledger_at(tmp_path)
    host = WakeTrainingHost(ledger)
    host.before_load(preflight, execution_refs=preflight.execution_refs)
    begin = child(ledger, preflight, "checkpoint-graph-begin")
    host.before_train(begin, execution_refs=begin.execution_refs)
    before = child(
        ledger,
        begin,
        "checkpoint-graph-pre",
        event="pre_optimizer_step",
        boundary_global_step=0,
    )
    host.before_optimizer_step(
        before, current_global_step=0, execution_refs=before.execution_refs
    )
    request = child(
        ledger,
        before,
        "checkpoint-graph-request",
        event="post_optimizer_step",
        directive="checkpoint_then_park",
        boundary_global_step=1,
    )
    intent = host.after_optimizer_step(
        request, global_step=1, execution_refs=request.execution_refs
    )
    assert intent.should_save is True
    bypass = child(
        ledger,
        request,
        "checkpoint-graph-bypass",
        event="pre_optimizer_step",
        boundary_global_step=1,
    )
    with pytest.raises(DecisionInvalid, match="does not permit another pre-action"):
        host.before_optimizer_step(
            bypass, current_global_step=1, execution_refs=bypass.execution_refs
        )


def test_missing_post_receipt_parks_toward_train_end_not_next_mutation(
    tmp_path: Path, preflight: ValidatedGovernanceView
) -> None:
    ledger = ledger_at(tmp_path)
    host = WakeTrainingHost(ledger)
    host.before_load(preflight, execution_refs=preflight.execution_refs)
    begin = child(ledger, preflight, "missing-receipt-begin")
    host.before_train(begin, execution_refs=begin.execution_refs)
    before = child(
        ledger,
        begin,
        "missing-receipt-pre",
        event="pre_optimizer_step",
        boundary_global_step=0,
    )
    host.before_optimizer_step(
        before, current_global_step=0, execution_refs=before.execution_refs
    )
    mapping = child(
        ledger,
        before,
        "missing-receipt-post",
        event="post_optimizer_step",
        directive="park",
        boundary_global_step=1,
    ).as_dict()
    mapping["effect"] = {
        "state": "no_effect_reported",
        "offer_ref": None,
        "observed_global_step": None,
        "physical_checkpoint_ref": None,
        "physical_checkpoint_evidence_ref": None,
        "evidence_ref": None,
    }
    parked = rebuild_decision(mapping)
    intent = host.after_optimizer_step(
        parked, global_step=1, execution_refs=parked.execution_refs
    )
    assert intent.should_training_stop is True
    bypass = child(
        ledger,
        parked,
        "missing-receipt-bypass",
        event="pre_optimizer_step",
        boundary_global_step=1,
    )
    with pytest.raises(DecisionInvalid, match="does not permit another pre-action"):
        host.before_optimizer_step(
            bypass, current_global_step=1, execution_refs=bypass.execution_refs
        )


def test_non_checkpoint_transition_cannot_advance_checkpoint_frontier(
    tmp_path: Path, preflight: ValidatedGovernanceView
) -> None:
    ledger = ledger_at(tmp_path)
    host = WakeTrainingHost(ledger)
    host.before_load(preflight, execution_refs=preflight.execution_refs)
    mapping = child(ledger, preflight, "forged-checkpoint-frontier").as_dict()
    mapping["frontiers"]["garden_checkpoint"] = ref("forged-garden-advance")
    forged = rebuild_decision(mapping)
    with pytest.raises(DecisionInvalid, match="advanced outside"):
        host.before_train(forged, execution_refs=forged.execution_refs)


def test_checkpoint_recorded_must_advance_both_checkpoint_frontiers(
    tmp_path: Path, preflight: ValidatedGovernanceView
) -> None:
    ledger = ledger_at(tmp_path)
    host = WakeTrainingHost(ledger)
    host.before_load(preflight, execution_refs=preflight.execution_refs)
    begin = child(ledger, preflight, "frontier-checkpoint-begin")
    host.before_train(begin, execution_refs=begin.execution_refs)
    before = child(
        ledger,
        begin,
        "frontier-checkpoint-pre",
        event="pre_optimizer_step",
        boundary_global_step=0,
    )
    host.before_optimizer_step(
        before, current_global_step=0, execution_refs=before.execution_refs
    )
    request = child(
        ledger,
        before,
        "frontier-checkpoint-request",
        event="post_optimizer_step",
        directive="checkpoint_then_park",
        boundary_global_step=1,
    )
    intent = host.after_optimizer_step(
        request, global_step=1, execution_refs=request.execution_refs
    )
    assert intent.checkpoint_ticket is not None
    mapping = child(
        ledger,
        request,
        "frontier-checkpoint-recorded",
        event="checkpoint_recorded",
        boundary_global_step=1,
        checkpoint_ticket_id=intent.checkpoint_ticket.ticket_id,
        checkpoint_request_governance_id=request.governance_id,
    ).as_dict()
    mapping["frontiers"]["physical_checkpoint"] = (
        request.frontiers.physical_checkpoint
    )
    forged = rebuild_decision(mapping)
    with pytest.raises(DecisionInvalid, match="advance both"):
        host.record_terminal_receipt(forged)


def test_non_checkpoint_remain_stopped_is_rejected_before_runtime(
    tmp_path: Path, run_ref: str
) -> None:
    ledger = ledger_at(tmp_path)
    with pytest.raises(DecisionInvalid, match="incompatible with the lifecycle event"):
        ValidatedGovernanceView.from_mapping(
            decision_mapping(
                "non-checkpoint-remain-stopped",
                run_ref=run_ref,
                frontier=ledger.current_frontier_ref(run_ref),
                directive="remain_stopped",
            )
        )


def test_exact_boundary_replay_fails_toward_stop_without_second_action(
    tmp_path: Path, preflight: ValidatedGovernanceView
) -> None:
    ledger = ledger_at(tmp_path)
    host = WakeTrainingHost(ledger)
    host.before_load(preflight, execution_refs=preflight.execution_refs)
    begin = child(ledger, preflight, "begin")
    host.before_train(begin, execution_refs=begin.execution_refs)
    before = child(
        ledger,
        begin,
        "pre-mutation",
        event="pre_optimizer_step",
        boundary_global_step=0,
    )
    host.before_optimizer_step(
        before, current_global_step=0, execution_refs=before.execution_refs
    )
    continuation = child(
        ledger,
        before,
        "checkpoint",
        event="post_optimizer_step",
        directive="checkpoint_then_park",
        boundary_global_step=1,
    )
    with pytest.raises(DecisionInvalid, match="observed global step"):
        host.after_optimizer_step(
            continuation,
            global_step=2,
            execution_refs=continuation.execution_refs,
        )
    first = host.after_optimizer_step(
        continuation, global_step=1, execution_refs=continuation.execution_refs
    )
    assert first.should_training_stop is True
    assert first.should_save is True
    replay = host.after_optimizer_step(
        continuation, global_step=1, execution_refs=continuation.execution_refs
    )
    assert replay.disposition == "held_exact_replay"
    assert replay.should_training_stop is True
    assert replay.should_save is False


def test_runtime_refs_and_dataclass_bytes_are_revalidated(
    tmp_path: Path, preflight: ValidatedGovernanceView
) -> None:
    ledger = ledger_at(tmp_path)
    host = WakeTrainingHost(ledger)
    mismatched = preflight.execution_refs.as_dict()
    mismatched["model_source_ref"] = preflight.offer_id
    with pytest.raises(DecisionInvalid, match="live execution refs"):
        host.before_load(preflight, execution_refs=mismatched)

    forged = replace(preflight, event="train_begin")
    with pytest.raises(DecisionInvalid):
        host.before_load(forged, execution_refs=preflight.execution_refs)


def test_resume_joins_stable_contract_but_requires_fresh_terms_and_exact_ticket(
    tmp_path: Path, preflight: ValidatedGovernanceView
) -> None:
    ledger = ledger_at(tmp_path)
    host = WakeTrainingHost(ledger)
    host.before_load(preflight, execution_refs=preflight.execution_refs)
    begin = child(ledger, preflight, "resume-begin")
    host.before_train(begin, execution_refs=begin.execution_refs)
    before = child(
        ledger,
        begin,
        "resume-pre-mutation",
        event="pre_optimizer_step",
        boundary_global_step=0,
    )
    host.before_optimizer_step(
        before, current_global_step=0, execution_refs=before.execution_refs
    )
    request = child(
        ledger,
        before,
        "resume-checkpoint-request",
        event="post_optimizer_step",
        directive="checkpoint_then_park",
        boundary_global_step=1,
    )
    intent = host.after_optimizer_step(
        request, global_step=1, execution_refs=request.execution_refs
    )
    assert intent.checkpoint_ticket is not None
    ticket = intent.checkpoint_ticket
    physical_ref = ref("resume-physical-checkpoint")
    physical_evidence_ref = ref("resume-physical-evidence")
    ledger.consume_checkpoint_ticket(ticket, global_step=1)
    ledger.record_checkpoint_effect(
        ticket,
        state="checkpoint_observed",
        checkpoint_ref=physical_ref,
        evidence_ref=physical_evidence_ref,
    )
    recorded = child(
        ledger,
        request,
        "resume-checkpoint-recorded",
        event="checkpoint_recorded",
        boundary_global_step=1,
        garden_checkpoint_id=ref("resume-garden-checkpoint"),
        physical_checkpoint_ref=physical_ref,
        physical_checkpoint_evidence_ref=physical_evidence_ref,
        model_checkpoint_artifact_ref=ref("resume-model-artifact"),
        checkpoint_ticket_id=ticket.ticket_id,
        checkpoint_request_governance_id=request.governance_id,
    )
    host.record_terminal_receipt(recorded)
    held_resume = child(
        ledger,
        recorded,
        "held-resume-offer",
        event="resume_offer",
        directive="hold_before_train_call",
        boundary_global_step=1,
    )
    with pytest.raises(TrainingHeld):
        host.before_train(held_resume, execution_refs=held_resume.execution_refs)
    resume_mapping = child(
        ledger,
        held_resume,
        "resume-offer",
        event="resume_offer",
        boundary_global_step=1,
    ).as_dict()
    for name in (
        "participation_assessment_ref",
        "learning_freedom_ref",
        "resource_window_ref",
    ):
        resume_mapping[name] = held_resume.as_dict()[name]
    resume = rebuild_decision(resume_mapping)
    assert resume.terms_id != request.terms_id
    assert resume.execution_contract_id == request.execution_contract_id
    ledger.require_observed_checkpoint(
        checkpoint_ref=physical_ref,
        evidence_ref=physical_evidence_ref,
        expected_context=resume,
        expected_checkpoint_request_ref=request.governance_id,
        expected_checkpoint_ticket_id=ticket.ticket_id,
        global_step=1,
    )

    wrong_contract_mapping = resume.as_dict()
    wrong_contract_mapping["execution_contract_id"] = ref("wrong-execution-contract")
    wrong_contract = rebuild_decision(wrong_contract_mapping)
    with pytest.raises(CheckpointIncomplete, match="same-context"):
        ledger.require_observed_checkpoint(
            checkpoint_ref=physical_ref,
            evidence_ref=physical_evidence_ref,
            expected_context=wrong_contract,
            expected_checkpoint_request_ref=request.governance_id,
            expected_checkpoint_ticket_id=ticket.ticket_id,
            global_step=1,
        )

    forged_mapping = resume.as_dict()
    forged_mapping["checkpoint_ticket_id"] = ref("wrong-resume-ticket")
    forged = rebuild_decision(forged_mapping)
    with pytest.raises(DecisionInvalid, match="exact terminal checkpoint"):
        host.before_train(forged, execution_refs=forged.execution_refs)

    permit = host.before_train(resume, execution_refs=resume.execution_refs)
    assert permit.event == "resume_offer"
    resumed_mutation = child(
        ledger,
        resume,
        "resumed-pre-mutation",
        event="pre_optimizer_step",
        boundary_global_step=1,
    )
    assert resumed_mutation.starting_state_kind == "garden_checkpoint"
    assert resumed_mutation.starting_state_ref == recorded.garden_checkpoint_id
    host.before_optimizer_step(
        resumed_mutation,
        current_global_step=1,
        execution_refs=resumed_mutation.execution_refs,
    )
