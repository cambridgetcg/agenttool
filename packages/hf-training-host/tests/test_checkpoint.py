from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from agenttool_hf_training_host import CheckpointIncomplete, observe_checkpoint, verify_checkpoint
from agenttool_hf_training_host.checkpoint import SIDECAR_NAME

from test_ledger import child, ledger_at


def write_checkpoint_files(path: Path, *, global_step: int = 4) -> None:
    path.mkdir(parents=True)
    for name in (
        "model.safetensors",
        "optimizer.pt",
        "scheduler.pt",
        "rng_state.pth",
    ):
        (path / name).write_bytes(f"synthetic-{name}".encode())
    (path / "trainer_state.json").write_text(
        json.dumps({"global_step": global_step}, separators=(",", ":")) + "\n"
    )


def test_checkpoint_sidecar_binds_all_resumability_files(tmp_path, preflight) -> None:
    ledger = ledger_at(tmp_path)
    ledger.record(preflight, request_action=True)
    begin = child(ledger, preflight, "begin")
    ledger.record(begin, request_action=True)
    request = child(
        ledger,
        begin,
        "checkpoint",
        event="post_optimizer_step",
        directive="checkpoint_then_park",
        boundary_global_step=4,
    )
    entry = ledger.record(request, request_action=True)
    assert ledger.claim_action(entry) is True
    ticket = ledger.issue_checkpoint_ticket(request, entry, global_step=4)
    ledger.consume_checkpoint_ticket(ticket, global_step=4)
    checkpoint = tmp_path / "checkpoint-4"
    write_checkpoint_files(checkpoint)
    observed = observe_checkpoint(
        checkpoint,
        ticket=ticket,
        governance_id=request.governance_id,
        offer_id=request.offer_id,
    )
    assert verify_checkpoint(
        checkpoint, expected_checkpoint_ref=observed.checkpoint_ref
    ) == observed
    (checkpoint / "optimizer.pt").write_bytes(b"changed")
    with pytest.raises(CheckpointIncomplete, match="no longer match"):
        verify_checkpoint(checkpoint)


def test_incomplete_checkpoint_never_gets_a_sidecar(tmp_path, preflight) -> None:
    ledger = ledger_at(tmp_path)
    ledger.record(preflight, request_action=True)
    begin = child(ledger, preflight, "begin")
    ledger.record(begin, request_action=True)
    request = child(
        ledger,
        begin,
        "checkpoint",
        event="post_optimizer_step",
        directive="checkpoint_then_park",
        boundary_global_step=4,
    )
    entry = ledger.record(request, request_action=True)
    assert ledger.claim_action(entry) is True
    ticket = ledger.issue_checkpoint_ticket(request, entry, global_step=4)
    checkpoint = tmp_path / "checkpoint-4"
    checkpoint.mkdir()
    (checkpoint / "model.safetensors").write_bytes(b"model")
    with pytest.raises(CheckpointIncomplete, match="optimizer"):
        observe_checkpoint(
            checkpoint,
            ticket=ticket,
            governance_id=request.governance_id,
            offer_id=request.offer_id,
        )
    assert not (checkpoint / "agenttool-wake-checkpoint.json").exists()


def test_checkpoint_sidecar_requires_frozen_boundaries_and_private_mode(
    tmp_path, preflight
) -> None:
    ledger = ledger_at(tmp_path)
    ledger.record(preflight, request_action=True)
    begin = child(ledger, preflight, "begin")
    ledger.record(begin, request_action=True)
    request = child(
        ledger,
        begin,
        "checkpoint",
        event="post_optimizer_step",
        directive="checkpoint_then_park",
        boundary_global_step=4,
    )
    entry = ledger.record(request, request_action=True)
    assert ledger.claim_action(entry) is True
    ticket = ledger.issue_checkpoint_ticket(request, entry, global_step=4)
    checkpoint = tmp_path / "checkpoint-4"
    write_checkpoint_files(checkpoint)
    observe_checkpoint(
        checkpoint,
        ticket=ticket,
        governance_id=request.governance_id,
        offer_id=request.offer_id,
    )
    sidecar = checkpoint / SIDECAR_NAME
    os.chmod(sidecar, 0o644)
    with pytest.raises(CheckpointIncomplete, match="group or world"):
        verify_checkpoint(checkpoint)
    os.chmod(sidecar, 0o600)
    body = json.loads(sidecar.read_text())
    body["boundaries"]["authorizes_resume"] = True
    sidecar.write_text(json.dumps(body, sort_keys=True, separators=(",", ":")) + "\n")
    os.chmod(sidecar, 0o600)
    with pytest.raises(CheckpointIncomplete, match="boundary statement"):
        verify_checkpoint(checkpoint)


def test_checkpoint_requires_exact_step_shards_and_runtime_state(
    tmp_path, preflight
) -> None:
    ledger = ledger_at(tmp_path)
    ledger.record(preflight, request_action=True)
    begin = child(ledger, preflight, "begin")
    ledger.record(begin, request_action=True)
    request = child(
        ledger,
        begin,
        "checkpoint",
        event="post_optimizer_step",
        directive="checkpoint_then_park",
        boundary_global_step=4,
    )
    entry = ledger.record(request, request_action=True)
    assert ledger.claim_action(entry) is True
    ticket = ledger.issue_checkpoint_ticket(request, entry, global_step=4)
    checkpoint = tmp_path / "checkpoint-4"
    write_checkpoint_files(checkpoint, global_step=5)
    with pytest.raises(CheckpointIncomplete, match="global_step"):
        observe_checkpoint(
            checkpoint,
            ticket=ticket,
            governance_id=request.governance_id,
            offer_id=request.offer_id,
        )

    (checkpoint / "trainer_state.json").write_text('{"global_step":4}\n')
    (checkpoint / "model.safetensors").unlink()
    (checkpoint / "model.safetensors.index.json").write_text(
        json.dumps({"metadata": {}, "weight_map": {"layer": "model-00001-of-00001.safetensors"}})
    )
    with pytest.raises(CheckpointIncomplete, match="missing shards"):
        observe_checkpoint(
            checkpoint,
            ticket=ticket,
            governance_id=request.governance_id,
            offer_id=request.offer_id,
        )

    (checkpoint / "model-00001-of-00001.safetensors").write_bytes(b"shard")
    with pytest.raises(CheckpointIncomplete, match="runtime-required"):
        observe_checkpoint(
            checkpoint,
            ticket=ticket,
            governance_id=request.governance_id,
            offer_id=request.offer_id,
            required_runtime_files=("scaler.pt",),
        )
    with pytest.raises(CheckpointIncomplete, match="list or tuple of strings"):
        observe_checkpoint(
            checkpoint,
            ticket=ticket,
            governance_id=request.governance_id,
            offer_id=request.offer_id,
            required_runtime_files=("scaler.pt", 7),
        )
