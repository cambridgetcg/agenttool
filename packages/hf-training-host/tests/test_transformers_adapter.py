from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from agenttool_hf_training_host import (
    CheckpointTicketError,
    HfCompatibilityError,
    WakeTrainingHost,
    verify_checkpoint,
)
from agenttool_hf_training_host.transformers_adapter import (
    _build_governed_trainer_class,
    _validate_versions,
    validate_training_arguments,
)

from test_checkpoint import write_checkpoint_files
from test_ledger import child, ledger_at


class FakeArgs:
    def __init__(self, output_dir: Path) -> None:
        self.output_dir = str(output_dir)
        self.save_strategy = "no"
        self.push_to_hub = False
        self.enable_jit_checkpoint = False
        self.load_best_model_at_end = False
        self.save_only_model = False
        self.save_on_each_node = False
        self.auto_find_batch_size = False
        self.save_total_limit = None
        self.restore_callback_states_from_checkpoint = False
        self.report_to = []
        self.world_size = 1
        self.fsdp = []
        self.deepspeed = None
        self.parallel_mode = "not_parallel"


class FakeTrainerCallback:
    pass


class FakeCallbackHandler:
    def __init__(self, callbacks) -> None:
        self.callbacks = list(callbacks)

    def remove_callback(self, callback_type) -> None:
        self.callbacks = [item for item in self.callbacks if not isinstance(item, callback_type)]

    def add_callback(self, callback) -> None:
        self.callbacks.append(callback)


class FakeTrainer:
    def __init__(self, *args, callbacks=None, **kwargs) -> None:
        self.args = kwargs["args"]
        self.callback_handler = FakeCallbackHandler([*(callbacks or []), object()])
        self.accelerator = SimpleNamespace(
            state=SimpleNamespace(distributed_type="NO", num_processes=1)
        )
        self.state = SimpleNamespace(global_step=0)
        self.hp_search_backend = None
        self.is_model_parallel = False
        self.is_deepspeed_enabled = False
        self.is_fsdp_enabled = False
        self.is_fsdp_xla_enabled = False
        self.is_fsdp_xla_v1_enabled = False
        self.is_fsdp_xla_v2_enabled = False
        self.train_called = False

    def train(self, resume_from_checkpoint=None, trial=None, ignore_keys_for_eval=None):
        self.train_called = True
        return "trained"

    def _get_output_dir(self, trial=None):
        return self.args.output_dir

    def _save_checkpoint(self, model, trial):
        write_checkpoint_files(
            Path(self.args.output_dir) / f"checkpoint-{self.state.global_step}",
            global_step=self.state.global_step,
        )

    def save_model(self, output_dir=None, _internal_call=False):
        return None


def fake_modules():
    transformers = SimpleNamespace(
        __version__="5.14.1",
        Trainer=FakeTrainer,
        TrainerCallback=FakeTrainerCallback,
    )
    accelerate = SimpleNamespace(__version__="1.14.0")
    torch = SimpleNamespace(__version__="2.6.0")
    return transformers, accelerate, torch


def test_argument_contract_rejects_automatic_or_distributed_paths(tmp_path) -> None:
    args = FakeArgs(tmp_path)
    args.save_strategy = "best"
    args.world_size = 2
    with pytest.raises(HfCompatibilityError) as failure:
        validate_training_arguments(args)
    assert "save_strategy" in str(failure.value)
    assert "world_size" in str(failure.value)

    for scheduler_type in ("reduce_lr_on_plateau", "greedy"):
        args = FakeArgs(tmp_path)
        args.lr_scheduler_type = scheduler_type
        with pytest.raises(HfCompatibilityError, match=scheduler_type):
            validate_training_arguments(args)


@pytest.mark.parametrize("version", ["2.5.1", "2.6.0rc1", "2.6junk"])
def test_version_contract_rejects_unsafe_or_ambiguous_torch(version) -> None:
    transformers, accelerate, _ = fake_modules()
    with pytest.raises(HfCompatibilityError, match="Torch"):
        _validate_versions(
            transformers,
            accelerate,
            SimpleNamespace(__version__=version),
        )


def test_governed_trainer_gates_train_and_verifies_one_ticket_checkpoint(
    tmp_path, preflight
) -> None:
    ledger = ledger_at(tmp_path)
    host = WakeTrainingHost(ledger)
    preload = host.before_load(
        preflight, execution_refs=preflight.execution_refs
    )
    begin = child(ledger, preflight, "begin")
    decisions = {}
    transformers, accelerate, torch = fake_modules()
    GovernedTrainer = _build_governed_trainer_class(transformers, accelerate, torch)
    trainer = GovernedTrainer(
        args=FakeArgs(tmp_path / "output"),
        wake_host=host,
        wake_decision_provider=lambda event, step: decisions.get((event, step)),
        wake_execution_refs=preflight.execution_refs,
        wake_preload_permit=preload,
    )
    assert trainer.train(governance_decision=begin) == "trained"
    assert trainer.train_called is True
    request = child(
        ledger,
        begin,
        "checkpoint",
        event="step_boundary",
        directive="checkpoint_then_stop_at_safe_boundary",
        boundary_global_step=6,
    )
    decisions[("step_boundary", 6)] = request
    trainer.state.global_step = 6
    callback = trainer.callback_handler.callbacks[-1]
    control = SimpleNamespace(
        should_log=True,
        should_evaluate=True,
        should_save=False,
        should_training_stop=False,
    )
    callback.on_step_end(trainer.args, trainer.state, control)
    assert control.should_save is True
    assert control.should_training_stop is True
    assert control.should_log is False
    assert control.should_evaluate is False
    trainer._save_checkpoint(object(), None)
    observation = verify_checkpoint(tmp_path / "output" / "checkpoint-6")
    assert trainer._wake_last_checkpoint == observation
    verification = ledger.verify()
    assert verification["checkpoint_tickets"] == 1
    assert verification["checkpoint_effects"] == 1

    control.should_log = True
    control.should_evaluate = True
    control.should_save = True
    callback.on_epoch_end(trainer.args, trainer.state, control)
    assert control.should_log is False
    assert control.should_evaluate is False
    assert control.should_save is False
    assert control.should_training_stop is True


def test_unauthorized_callback_save_reaches_guard_before_filesystem(tmp_path, preflight) -> None:
    ledger = ledger_at(tmp_path)
    host = WakeTrainingHost(ledger)
    preload = host.before_load(
        preflight, execution_refs=preflight.execution_refs
    )
    transformers, accelerate, torch = fake_modules()
    GovernedTrainer = _build_governed_trainer_class(transformers, accelerate, torch)
    output = tmp_path / "output"
    trainer = GovernedTrainer(
        args=FakeArgs(output),
        wake_host=host,
        wake_decision_provider=lambda event, step: None,
        wake_execution_refs=preflight.execution_refs,
        wake_preload_permit=preload,
    )
    trainer.state.global_step = 1
    with pytest.raises(CheckpointTicketError, match="no exact WAKE ticket"):
        trainer._save_checkpoint(object(), None)
    assert not (output / "checkpoint-1").exists()


def test_train_rejects_boolean_latest_resume_before_base_call(tmp_path, preflight) -> None:
    ledger = ledger_at(tmp_path)
    host = WakeTrainingHost(ledger)
    preload = host.before_load(
        preflight, execution_refs=preflight.execution_refs
    )
    transformers, accelerate, torch = fake_modules()
    GovernedTrainer = _build_governed_trainer_class(transformers, accelerate, torch)
    trainer = GovernedTrainer(
        args=FakeArgs(tmp_path / "output"),
        wake_host=host,
        wake_decision_provider=lambda event, step: None,
        wake_execution_refs=preflight.execution_refs,
        wake_preload_permit=preload,
    )
    with pytest.raises(HfCompatibilityError, match="boolean/latest"):
        trainer.train(resume_from_checkpoint=True, governance_decision=preflight)
    assert trainer.train_called is False


def test_mutated_arguments_and_delayed_scheduler_are_revalidated(
    tmp_path, preflight
) -> None:
    ledger = ledger_at(tmp_path)
    host = WakeTrainingHost(ledger)
    preload = host.before_load(preflight, execution_refs=preflight.execution_refs)
    begin = child(ledger, preflight, "begin")
    transformers, accelerate, torch = fake_modules()
    GovernedTrainer = _build_governed_trainer_class(transformers, accelerate, torch)
    trainer = GovernedTrainer(
        args=FakeArgs(tmp_path / "output"),
        wake_host=host,
        wake_decision_provider=lambda event, step: None,
        wake_execution_refs=preflight.execution_refs,
        wake_preload_permit=preload,
    )

    trainer.args.push_to_hub = True
    with pytest.raises(HfCompatibilityError, match="push_to_hub"):
        trainer.train(governance_decision=begin)
    assert trainer.train_called is False

    trainer.args.push_to_hub = False
    ReduceLROnPlateau = type(
        "ReduceLROnPlateau",
        (),
        {"__module__": "torch.optim.lr_scheduler"},
    )
    trainer.lr_scheduler = ReduceLROnPlateau()
    with pytest.raises(HfCompatibilityError, match="metric-delayed"):
        trainer.train(governance_decision=begin)
    assert trainer.train_called is False


def test_mutation_after_boundary_cannot_reopen_checkpoint_side_effects(
    tmp_path, preflight
) -> None:
    ledger = ledger_at(tmp_path)
    host = WakeTrainingHost(ledger)
    preload = host.before_load(preflight, execution_refs=preflight.execution_refs)
    begin = child(ledger, preflight, "begin")
    decisions = {}
    transformers, accelerate, torch = fake_modules()
    GovernedTrainer = _build_governed_trainer_class(transformers, accelerate, torch)
    output = tmp_path / "output"
    trainer = GovernedTrainer(
        args=FakeArgs(output),
        wake_host=host,
        wake_decision_provider=lambda event, step: decisions.get((event, step)),
        wake_execution_refs=preflight.execution_refs,
        wake_preload_permit=preload,
    )
    assert trainer.train(governance_decision=begin) == "trained"
    request = child(
        ledger,
        begin,
        "checkpoint",
        event="step_boundary",
        directive="checkpoint_then_stop_at_safe_boundary",
        boundary_global_step=3,
    )
    decisions[("step_boundary", 3)] = request
    trainer.state.global_step = 3
    control = SimpleNamespace(
        should_log=False,
        should_evaluate=False,
        should_save=False,
        should_training_stop=False,
    )
    trainer.callback_handler.callbacks[-1].on_step_end(
        trainer.args, trainer.state, control
    )
    trainer.args.push_to_hub = True
    with pytest.raises(HfCompatibilityError, match="push_to_hub"):
        trainer._save_checkpoint(object(), None)
    assert not (output / "checkpoint-3").exists()
    with pytest.raises(HfCompatibilityError, match="checkpoint-triggered Hub"):
        trainer._push_from_checkpoint(str(output / "checkpoint-3"))


def test_decision_provider_cannot_mutate_arguments_before_checkpoint(
    tmp_path, preflight
) -> None:
    ledger = ledger_at(tmp_path)
    host = WakeTrainingHost(ledger)
    preload = host.before_load(preflight, execution_refs=preflight.execution_refs)
    begin = child(ledger, preflight, "begin")
    transformers, accelerate, torch = fake_modules()
    GovernedTrainer = _build_governed_trainer_class(transformers, accelerate, torch)
    output = tmp_path / "output"
    trainer = None
    request = child(
        ledger,
        begin,
        "checkpoint",
        event="step_boundary",
        directive="checkpoint_then_stop_at_safe_boundary",
        boundary_global_step=2,
    )

    def mutating_provider(event, step):
        assert trainer is not None
        trainer.args.save_total_limit = 1
        return request

    trainer = GovernedTrainer(
        args=FakeArgs(output),
        wake_host=host,
        wake_decision_provider=mutating_provider,
        wake_execution_refs=preflight.execution_refs,
        wake_preload_permit=preload,
    )
    assert trainer.train(governance_decision=begin) == "trained"
    trainer.state.global_step = 2
    control = SimpleNamespace(
        should_log=False,
        should_evaluate=False,
        should_save=False,
        should_training_stop=False,
    )
    with pytest.raises(HfCompatibilityError, match="save_total_limit"):
        trainer.callback_handler.callbacks[-1].on_step_end(
            trainer.args, trainer.state, control
        )
    assert not output.exists()
    assert ledger.verify()["checkpoint_tickets"] == 0


def test_decision_provider_cannot_rewrite_the_boundary_step(
    tmp_path, preflight
) -> None:
    ledger = ledger_at(tmp_path)
    host = WakeTrainingHost(ledger)
    preload = host.before_load(preflight, execution_refs=preflight.execution_refs)
    begin = child(ledger, preflight, "begin")
    decisions = {}
    trainer = None

    def mutating_provider(event, step):
        assert trainer is not None
        trainer.state.global_step = step + 1
        return decisions[(event, step)]

    transformers, accelerate, torch = fake_modules()
    GovernedTrainer = _build_governed_trainer_class(transformers, accelerate, torch)
    trainer = GovernedTrainer(
        args=FakeArgs(tmp_path / "output"),
        wake_host=host,
        wake_decision_provider=mutating_provider,
        wake_execution_refs=preflight.execution_refs,
        wake_preload_permit=preload,
    )
    assert trainer.train(governance_decision=begin) == "trained"
    request = child(
        ledger,
        begin,
        "checkpoint",
        event="step_boundary",
        directive="checkpoint_then_stop_at_safe_boundary",
        boundary_global_step=5,
    )
    decisions[("step_boundary", 5)] = request
    trainer.state.global_step = 5
    control = SimpleNamespace(
        should_log=False,
        should_evaluate=False,
        should_save=False,
        should_training_stop=False,
    )
    with pytest.raises(HfCompatibilityError, match="changed.*global step"):
        trainer.callback_handler.callbacks[-1].on_step_end(
            trainer.args, trainer.state, control
        )
    assert ledger.verify()["checkpoint_tickets"] == 0
