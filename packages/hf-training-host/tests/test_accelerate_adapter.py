from __future__ import annotations

from types import SimpleNamespace

import pytest

import agenttool_hf_training_host.accelerate_adapter as adapter_module
from agenttool_hf_training_host import (
    HfCompatibilityError,
    HostPermit,
    LedgerIntegrityError,
    MutationUnitFailed,
    SingleProcessAccelerateHost,
    TrainingHeld,
    WakeTrainingHost,
)

from conftest import ref
from test_ledger import child, ledger_at


def exact_stack(monkeypatch) -> None:
    monkeypatch.setattr(
        adapter_module,
        "_load_hf_modules",
        lambda: (
            SimpleNamespace(__version__="5.14.1"),
            SimpleNamespace(__version__="1.14.0"),
            SimpleNamespace(__version__="2.6.0"),
        ),
    )


def accelerator(*, processes: int = 1, distributed: str = "NO"):
    return SimpleNamespace(
        state=SimpleNamespace(
            num_processes=processes,
            distributed_type=distributed,
        )
    )


def begun_adapter(tmp_path, preflight, monkeypatch):
    exact_stack(monkeypatch)
    ledger = ledger_at(tmp_path)
    host = WakeTrainingHost(ledger)
    preload = host.before_load(preflight, execution_refs=preflight.execution_refs)
    adapter = SingleProcessAccelerateHost(
        accelerator(),
        host,
        execution_refs=preflight.execution_refs,
        wake_preload_permit=preload,
    )
    begin = child(ledger, preflight, "accelerate-begin")
    adapter.before_loop(begin)
    return ledger, host, adapter, begin


def test_guarded_mutation_precedes_receipt_and_executes_once(
    tmp_path, preflight, monkeypatch
) -> None:
    ledger, _, adapter, begin = begun_adapter(tmp_path, preflight, monkeypatch)
    before = child(
        ledger,
        begin,
        "accelerate-pre",
        event="pre_optimizer_step",
        boundary_global_step=0,
    )
    calls = []
    result = adapter.guarded_mutation(
        before,
        current_global_step=0,
        mutation=lambda: calls.append("mutated") or "result",
    )
    assert result == "result"
    assert calls == ["mutated"]

    after = child(
        ledger,
        before,
        "accelerate-post",
        event="post_optimizer_step",
        boundary_global_step=1,
    )
    intent = adapter.post_optimizer_boundary(after, global_step=1)
    assert intent.should_training_stop is False
    assert intent.should_save is False
    assert not hasattr(adapter, "at_optimizer_boundary")
    with pytest.raises(HfCompatibilityError, match="must not use Accelerate"):
        adapter.register_governance_for_checkpointing(object())


def test_accelerate_train_begin_reoffer_preserves_preload_lineage(
    tmp_path, preflight, monkeypatch
) -> None:
    exact_stack(monkeypatch)
    ledger = ledger_at(tmp_path)
    host = WakeTrainingHost(ledger)
    preload = host.before_load(preflight, execution_refs=preflight.execution_refs)
    adapter = SingleProcessAccelerateHost(
        accelerator(),
        host,
        execution_refs=preflight.execution_refs,
        wake_preload_permit=preload,
    )
    held = child(
        ledger,
        preflight,
        "accelerate-held-begin",
        directive="hold_before_train_call",
    )
    with pytest.raises(TrainingHeld):
        adapter.before_loop(held)
    reoffer = child(ledger, held, "accelerate-reoffered-begin")
    permit = adapter.before_loop(reoffer)
    assert permit.event == "train_begin"
    assert ledger.heads(preflight.run_ref) == (reoffer.governance_id,)


def test_mutation_failure_is_non_atomic_and_latches_closed(
    tmp_path, preflight, monkeypatch
) -> None:
    ledger, _, adapter, begin = begun_adapter(tmp_path, preflight, monkeypatch)
    before = child(
        ledger,
        begin,
        "accelerate-failing-pre",
        event="pre_optimizer_step",
        boundary_global_step=0,
    )

    def fail() -> None:
        raise ValueError("partial")

    with pytest.raises(MutationUnitFailed, match="non-atomically"):
        adapter.guarded_mutation(before, current_global_step=0, mutation=fail)
    with pytest.raises(MutationUnitFailed, match="non-atomically"):
        adapter.guarded_mutation(before, current_global_step=0, mutation=lambda: None)


def test_pending_mutation_requires_post_receipt(tmp_path, preflight, monkeypatch) -> None:
    ledger, _, adapter, begin = begun_adapter(tmp_path, preflight, monkeypatch)
    before = child(
        ledger,
        begin,
        "accelerate-pending-pre",
        event="pre_optimizer_step",
        boundary_global_step=0,
    )
    adapter.guarded_mutation(before, current_global_step=0, mutation=lambda: None)
    another = child(
        ledger,
        before,
        "accelerate-another-pre",
        event="pre_optimizer_step",
        boundary_global_step=1,
    )
    with pytest.raises(HfCompatibilityError, match="post_optimizer_step receipt"):
        adapter.guarded_mutation(another, current_global_step=1, mutation=lambda: None)


def test_accelerate_rejects_stack_topology_and_reference_mismatch(
    tmp_path, preflight, monkeypatch
) -> None:
    exact_stack(monkeypatch)
    host = WakeTrainingHost(ledger_at(tmp_path))
    preload = host.before_load(preflight, execution_refs=preflight.execution_refs)
    with pytest.raises(HfCompatibilityError, match="non-distributed"):
        SingleProcessAccelerateHost(
            accelerator(processes=2, distributed="MULTI_GPU"),
            host,
            execution_refs=preflight.execution_refs,
            wake_preload_permit=preload,
        )

    changed_refs = preflight.execution_refs.as_dict()
    changed_refs["trainer_stack_ref"] = ref("another-stack")
    with pytest.raises(HfCompatibilityError, match="pre-load permit"):
        SingleProcessAccelerateHost(
            accelerator(),
            host,
            execution_refs=changed_refs,
            wake_preload_permit=preload,
        )


def test_accelerate_propagates_exact_stack_failure(
    tmp_path, preflight, monkeypatch
) -> None:
    def reject_stack():
        raise HfCompatibilityError("Transformers must be exactly 5.14.1")

    monkeypatch.setattr(adapter_module, "_load_hf_modules", reject_stack)
    with pytest.raises(HfCompatibilityError, match="Transformers"):
        SingleProcessAccelerateHost(
            accelerator(),
            WakeTrainingHost(ledger_at(tmp_path)),
            execution_refs=preflight.execution_refs,
            wake_preload_permit=object(),
        )


def test_accelerate_rejects_recorded_but_unconsumed_preload(
    tmp_path, preflight, monkeypatch
) -> None:
    exact_stack(monkeypatch)
    ledger = ledger_at(tmp_path)
    entry = ledger.record(preflight, request_action=False)
    unconsumed = HostPermit(
        decision_id=preflight.decision_id,
        governance_id=preflight.governance_id,
        terms_id=preflight.terms_id,
        execution_contract_id=preflight.execution_contract_id,
        run_ref=preflight.run_ref,
        event=preflight.event,
        observed_global_step=preflight.observed_global_step,
        proposed_global_step=preflight.proposed_global_step,
        ledger_sequence=entry.sequence,
        ledger_entry_hash=entry.entry_hash,
    )
    with pytest.raises(LedgerIntegrityError, match="absent or was not consumed"):
        SingleProcessAccelerateHost(
            accelerator(),
            WakeTrainingHost(ledger),
            execution_refs=preflight.execution_refs,
            wake_preload_permit=unconsumed,
        )


def test_accelerate_revalidates_mutable_topology_before_mutation(
    tmp_path, preflight, monkeypatch
) -> None:
    ledger, _, adapter, begin = begun_adapter(tmp_path, preflight, monkeypatch)
    before = child(
        ledger,
        begin,
        "topology-pre",
        event="pre_optimizer_step",
        boundary_global_step=0,
    )
    adapter.accelerator.state.num_processes = 2
    adapter.accelerator.state.distributed_type = "MULTI_GPU"
    called = False

    def mutation() -> None:
        nonlocal called
        called = True

    with pytest.raises(HfCompatibilityError, match="non-distributed"):
        adapter.guarded_mutation(before, current_global_step=0, mutation=mutation)
    assert called is False
