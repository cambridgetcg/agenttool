from __future__ import annotations

import os
from dataclasses import replace
from pathlib import Path

import pytest

from agenttool_hf_training_host import (
    ContinuityLedger,
    DecisionInvalid,
    TrainingHeld,
    ValidatedGovernanceView,
    WakeTrainingHost,
    guarded_call_before_load,
)

from conftest import decision_mapping
from test_ledger import child, ledger_at


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
    stale = child(
        ledger,
        begin,
        "checkpoint-stale",
        event="step_boundary",
        directive="checkpoint_then_stop_at_safe_boundary",
        frontier=preflight.observed_governance_frontier_ref,
        boundary_global_step=3,
    )
    intent = host.at_safe_boundary(
        stale, global_step=3, execution_refs=stale.execution_refs
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


def test_exact_boundary_replay_fails_toward_stop_without_second_action(
    tmp_path: Path, preflight: ValidatedGovernanceView
) -> None:
    ledger = ledger_at(tmp_path)
    host = WakeTrainingHost(ledger)
    host.before_load(preflight, execution_refs=preflight.execution_refs)
    begin = child(ledger, preflight, "begin")
    host.before_train(begin, execution_refs=begin.execution_refs)
    continuation = child(
        ledger,
        begin,
        "continue",
        event="step_boundary",
        directive="continue_under_exact_offer",
        boundary_global_step=2,
    )
    with pytest.raises(DecisionInvalid, match="bind the current"):
        host.at_safe_boundary(
            continuation,
            global_step=3,
            execution_refs=continuation.execution_refs,
        )
    first = host.at_safe_boundary(
        continuation, global_step=2, execution_refs=continuation.execution_refs
    )
    assert first.should_training_stop is False
    replay = host.at_safe_boundary(
        continuation, global_step=2, execution_refs=continuation.execution_refs
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
    mismatched["model_or_checkpoint_ref"] = preflight.offer_id
    with pytest.raises(DecisionInvalid, match="live execution refs"):
        host.before_load(preflight, execution_refs=mismatched)

    forged = replace(preflight, event="train_begin")
    with pytest.raises(DecisionInvalid):
        host.before_load(forged, execution_refs=preflight.execution_refs)
