from __future__ import annotations

from types import SimpleNamespace

import pytest

import agenttool_hf_training_host.accelerate_adapter as adapter_module
from agenttool_hf_training_host import (
    HfCompatibilityError,
    HostPermit,
    LedgerIntegrityError,
    SingleProcessAccelerateHost,
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


def test_accelerate_host_delegates_exact_single_process_gates(
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

    begin = child(ledger, preflight, "accelerate-begin")
    permit = adapter.before_loop(begin)
    assert permit.event == "train_begin"
    boundary = child(
        ledger,
        begin,
        "accelerate-boundary",
        event="step_boundary",
        boundary_global_step=1,
    )
    intent = adapter.at_optimizer_boundary(boundary, global_step=1)
    assert intent.should_training_stop is False
    assert intent.should_save is False
    with pytest.raises(HfCompatibilityError, match="must not use Accelerate"):
        adapter.register_governance_for_checkpointing(object())


def test_accelerate_host_rejects_stack_topology_and_reference_mismatch(
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


def test_accelerate_host_propagates_exact_stack_failure(
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


def test_accelerate_host_rejects_recorded_but_unconsumed_preload(
    tmp_path, preflight, monkeypatch
) -> None:
    exact_stack(monkeypatch)
    ledger = ledger_at(tmp_path)
    entry = ledger.record(preflight, request_action=False)
    unconsumed = HostPermit(
        decision_id=preflight.decision_id,
        governance_id=preflight.governance_id,
        terms_id=preflight.terms_id,
        run_ref=preflight.run_ref,
        event=preflight.event,
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


def test_accelerate_host_revalidates_mutable_topology_at_each_gate(
    tmp_path, preflight, monkeypatch
) -> None:
    exact_stack(monkeypatch)
    host = WakeTrainingHost(ledger_at(tmp_path))
    preload = host.before_load(preflight, execution_refs=preflight.execution_refs)
    runtime = accelerator()
    adapter = SingleProcessAccelerateHost(
        runtime,
        host,
        execution_refs=preflight.execution_refs,
        wake_preload_permit=preload,
    )
    begin = child(host.ledger, preflight, "topology-begin")
    runtime.state.num_processes = 2
    runtime.state.distributed_type = "MULTI_GPU"
    with pytest.raises(HfCompatibilityError, match="non-distributed"):
        adapter.before_loop(begin)

    runtime.state.num_processes = 1
    runtime.state.distributed_type = "NO"
    adapter.before_loop(begin)
    boundary = child(
        host.ledger,
        begin,
        "topology-boundary",
        event="step_boundary",
        boundary_global_step=1,
    )
    runtime.state.num_processes = 2
    runtime.state.distributed_type = "MULTI_GPU"
    with pytest.raises(HfCompatibilityError, match="non-distributed"):
        adapter.at_optimizer_boundary(boundary, global_step=1)
