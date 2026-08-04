from __future__ import annotations

import hashlib
from pathlib import Path
from types import SimpleNamespace

import pytest

import agenttool_hf_training_host.transformers_adapter as transformers_adapter

from agenttool_hf_training_host import (
    CheckpointTicketError,
    EvaluationUnitFailed,
    HfCompatibilityError,
    MutationUnitFailed,
    TrainingHeld,
    WakeTrainingHost,
    verify_checkpoint,
)
from agenttool_hf_training_host.transformers_adapter import (
    SUPPORTED_TRANSFORMERS_OPTIMIZERS,
    _build_governed_trainer_class,
    _validate_versions,
    validate_training_arguments,
)

from conftest import ref
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
        self.optim = "adamw_torch"


class FakeTrainerCallback:
    pass


class FakeCallbackHandler:
    def __init__(self, callbacks) -> None:
        self.callbacks = list(callbacks)

    def remove_callback(self, callback_type) -> None:
        self.callbacks = [
            item for item in self.callbacks if not isinstance(item, callback_type)
        ]

    def add_callback(self, callback) -> None:
        self.callbacks.append(callback)


class FakeModel:
    def __init__(self) -> None:
        self.zeroed = 0

    def zero_grad(self) -> None:
        self.zeroed += 1


class FakeOptimizer:
    def __init__(self) -> None:
        self.zeroed = 0

    def zero_grad(self) -> None:
        self.zeroed += 1


class FakeTrainer:
    def __init__(
        self,
        model=None,
        args=None,
        data_collator=None,
        train_dataset=None,
        eval_dataset=None,
        processing_class=None,
        model_init=None,
        compute_loss_func=None,
        compute_metrics=None,
        callbacks=None,
        optimizers=(None, None),
        optimizer_cls_and_kwargs=None,
        preprocess_logits_for_metrics=None,
    ) -> None:
        self.args = args
        self.callback_handler = FakeCallbackHandler([*(callbacks or []), object()])
        self.accelerator = SimpleNamespace(
            state=SimpleNamespace(distributed_type="NO", num_processes=1),
            scaler=None,
        )
        self.state = SimpleNamespace(global_step=0)
        self.control = SimpleNamespace(
            should_log=False,
            should_evaluate=False,
            should_save=False,
            should_training_stop=False,
        )
        self.hp_search_backend = None
        self.is_model_parallel = False
        self.is_deepspeed_enabled = False
        self.is_fsdp_enabled = False
        self.is_fsdp_xla_enabled = False
        self.is_fsdp_xla_v1_enabled = False
        self.is_fsdp_xla_v2_enabled = False
        self.train_called = False
        self.model = FakeModel()
        self.optimizer = FakeOptimizer()
        self.eval_dataset = object()
        self.fail_after_clip = False
        self.fail_evaluation = False
        self.training_steps = 0

    def train(self, resume_from_checkpoint=None, trial=None, ignore_keys_for_eval=None):
        self.train_called = True
        return "trained"

    def training_step(self, model, inputs, num_items_in_batch=None):
        self.training_steps += 1
        return "loss"

    def _clip_grad_norm(self, model):
        return 1.0

    def _get_grad_norm(self, model, grad_norm=None):
        return grad_norm

    def _run_epoch(self, model):
        self.training_step(model, {}, None)
        self._clip_grad_norm(model)
        if self.fail_after_clip:
            raise ValueError("partial mutation")
        self._get_grad_norm(model, grad_norm=1.0)
        self.state.global_step += 1
        self.control = self.callback_handler.callbacks[-1].on_step_end(
            self.args, self.state, self.control
        )
        if self.control.should_save:
            self._save_checkpoint(model, None)
        return "epoch"

    def evaluate(self, eval_dataset=None, ignore_keys=None, metric_key_prefix="eval"):
        if self.fail_evaluation:
            raise ValueError("evaluation failed")
        self.control = self.callback_handler.callbacks[-1].on_evaluate(
            self.args, self.state, self.control
        )
        return {"eval_loss": 1.0}

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


def fake_governed_class():
    return _build_governed_trainer_class(
        *fake_modules(), _enforce_source_contract=False
    )


def build_trainer(tmp_path, preflight, provider):
    ledger = ledger_at(tmp_path)
    host = WakeTrainingHost(ledger)
    preload = host.before_load(preflight, execution_refs=preflight.execution_refs)
    trainer = fake_governed_class()(
        args=FakeArgs(tmp_path / "output"),
        wake_host=host,
        wake_decision_provider=provider,
        wake_execution_refs=preflight.execution_refs,
        wake_preload_permit=preload,
    )
    return ledger, host, trainer


def enter_training(ledger, trainer, preflight):
    begin = child(ledger, preflight, "begin")
    assert trainer.train(governance_decision=begin) == "trained"
    return begin


def test_private_fake_builder_must_explicitly_disable_source_contract() -> None:
    with pytest.raises(HfCompatibilityError, match="pinned enforcement seam"):
        _build_governed_trainer_class(*fake_modules())
    assert fake_governed_class().__name__ == "GovernedTrainer"


def test_source_contract_pins_init_signature_and_both_dispatch_methods(
    monkeypatch,
) -> None:
    class SourcePinnedTrainer:
        def __init__(self):
            pass

        def _run_epoch(self):
            pass

        def training_step(self):
            pass

    signature = "(self, exact=None)"
    sources = {
        "_run_epoch": "def _run_epoch(self):\n    return 'epoch'\n",
        "training_step": "def training_step(self):\n    return 'loss'\n",
    }
    monkeypatch.setattr(
        transformers_adapter.inspect, "signature", lambda value: signature
    )
    monkeypatch.setattr(
        transformers_adapter.inspect,
        "getsource",
        lambda value: sources[value.__name__],
    )
    monkeypatch.setattr(
        transformers_adapter,
        "TRAINER_INIT_SIGNATURE_SHA256",
        hashlib.sha256(signature.encode()).hexdigest(),
    )
    monkeypatch.setattr(
        transformers_adapter,
        "RUN_EPOCH_SOURCE_SHA256",
        hashlib.sha256(sources["_run_epoch"].encode()).hexdigest(),
    )
    monkeypatch.setattr(
        transformers_adapter,
        "TRAINING_STEP_SOURCE_SHA256",
        hashlib.sha256(sources["training_step"].encode()).hexdigest(),
    )
    transformers_adapter._assert_trainer_source_contract(SourcePinnedTrainer)

    sources["training_step"] += "# changed\n"
    with pytest.raises(HfCompatibilityError, match="Trainer.training_step source"):
        transformers_adapter._assert_trainer_source_contract(SourcePinnedTrainer)

    sources["training_step"] = "def training_step(self):\n    return 'loss'\n"
    signature = "(self, changed=None)"
    with pytest.raises(HfCompatibilityError, match="Trainer.__init__ signature"):
        transformers_adapter._assert_trainer_source_contract(SourcePinnedTrainer)


def test_argument_and_version_contracts(tmp_path) -> None:
    args = FakeArgs(tmp_path)
    args.save_strategy = "best"
    args.world_size = 2
    with pytest.raises(HfCompatibilityError) as failure:
        validate_training_arguments(args)
    assert "save_strategy" in str(failure.value)
    assert "world_size" in str(failure.value)

    transformers, accelerate, _ = fake_modules()
    for version in ("2.5.1", "2.6.0rc1", "2.6junk"):
        with pytest.raises(HfCompatibilityError, match="Torch"):
            _validate_versions(
                transformers, accelerate, SimpleNamespace(__version__=version)
            )


def test_optimizer_allowlist_is_exact_and_rejects_preclaim_mutation_routes(
    tmp_path,
) -> None:
    assert SUPPORTED_TRANSFORMERS_OPTIMIZERS == (
        "adamw_torch",
        "adamw_torch_fused",
        "adafactor",
        "sgd",
        "adagrad",
        "rmsprop",
    )
    for optimizer_name in SUPPORTED_TRANSFORMERS_OPTIMIZERS:
        args = FakeArgs(tmp_path)
        args.optim = SimpleNamespace(value=optimizer_name)
        validate_training_arguments(args)

    rejected = (
        "lomo",
        "adalomo",
        "galore_adamw_layerwise",
        "galore_adamw_8bit_layerwise",
        "galore_adafactor_layerwise",
        "apollo_adamw_layerwise",
        "schedule_free_radam",
        "schedule_free_adamw",
        "schedule_free_sgd",
        "adamw_8bit",
        "future_optimizer",
    )
    for optimizer_name in rejected:
        args = FakeArgs(tmp_path)
        args.optim = optimizer_name
        with pytest.raises(HfCompatibilityError, match="source-audited allowlist"):
            validate_training_arguments(args)

    args = FakeArgs(tmp_path)
    del args.optim
    with pytest.raises(HfCompatibilityError, match="optim=<missing>"):
        validate_training_arguments(args)


def test_custom_optimizer_constructor_routes_and_subclasses_are_rejected(
    tmp_path, preflight
) -> None:
    ledger = ledger_at(tmp_path)
    host = WakeTrainingHost(ledger)
    preload = host.before_load(preflight, execution_refs=preflight.execution_refs)
    common = {
        "wake_host": host,
        "wake_decision_provider": lambda event, step: None,
        "wake_execution_refs": preflight.execution_refs,
        "wake_preload_permit": preload,
    }
    governed = fake_governed_class()

    positional = [None] * 10
    positional[1] = FakeArgs(tmp_path / "positional")
    positional.append((FakeOptimizer(), None))
    with pytest.raises(HfCompatibilityError, match="custom Trainer optimizers"):
        governed(*positional, **common)

    with pytest.raises(HfCompatibilityError, match="optimizer_cls_and_kwargs"):
        governed(
            args=FakeArgs(tmp_path / "factory"),
            optimizer_cls_and_kwargs=(FakeOptimizer, {}),
            **common,
        )

    class DerivedGovernedTrainer(governed):
        pass

    with pytest.raises(HfCompatibilityError, match="subclasses"):
        DerivedGovernedTrainer(args=FakeArgs(tmp_path / "subclass"), **common)


def test_two_source_dispatch_fences_then_post_receipt(
    tmp_path, preflight
) -> None:
    decisions = {}
    calls = []
    ledger = None
    before = None
    after = None

    def provider(event, step):
        nonlocal after
        calls.append((event, step))
        if event == "post_optimizer_step":
            assert ledger is not None and before is not None
            after = child(
                ledger,
                before,
                "post",
                event="post_optimizer_step",
                boundary_global_step=step,
            )
            return after
        return decisions[(event, step)]

    ledger, _, trainer = build_trainer(tmp_path, preflight, provider)
    begin = enter_training(ledger, trainer, preflight)
    before = child(
        ledger, begin, "pre", event="pre_optimizer_step", boundary_global_step=0
    )
    decisions[("pre_optimizer_step", 0)] = before
    assert trainer._run_epoch(trainer.model) == "epoch"
    assert calls == [
        ("pre_optimizer_step", 0),
        ("pre_optimizer_step", 0),
        ("post_optimizer_step", 1),
    ]
    assert after is not None
    assert ledger.heads(preflight.run_ref) == (after.governance_id,)
    assert trainer.state.global_step == 1
    assert ledger.verify()["entries"] == 4


def test_train_begin_reoffer_keeps_claimed_preload_lineage(
    tmp_path, preflight
) -> None:
    ledger, _, trainer = build_trainer(
        tmp_path, preflight, lambda event, step: None
    )
    held = child(
        ledger,
        preflight,
        "adapter-held-begin",
        directive="hold_before_train_call",
    )
    with pytest.raises(TrainingHeld):
        trainer.train(governance_decision=held)
    reoffer = child(ledger, held, "adapter-reoffered-begin")
    assert trainer.train(governance_decision=reoffer) == "trained"
    assert ledger.heads(preflight.run_ref) == (reoffer.governance_id,)


def test_internal_optimizer_hold_stops_before_forward_and_is_honestly_nonresumable(
    tmp_path, preflight
) -> None:
    decisions = {}
    ledger, _, trainer = build_trainer(
        tmp_path, preflight, lambda event, step: decisions[(event, step)]
    )
    begin = enter_training(ledger, trainer, preflight)
    held = child(
        ledger,
        begin,
        "trainer-internal-held-optimizer",
        event="pre_optimizer_step",
        directive="hold_before_optimizer_step",
        boundary_global_step=0,
    )
    decisions[("pre_optimizer_step", 0)] = held
    with pytest.raises(TrainingHeld):
        trainer._run_epoch(trainer.model)
    assert trainer.training_steps == 0
    assert trainer._wake_candidate is None
    reoffer = child(
        ledger,
        held,
        "trainer-internal-reoffered-optimizer",
        event="pre_optimizer_step",
        boundary_global_step=0,
    )
    with pytest.raises(HfCompatibilityError, match="does not pretend"):
        trainer.train(governance_decision=reoffer)


def test_stale_allow_candidate_is_held_before_forward_backward(
    tmp_path, preflight
) -> None:
    decisions = {}
    ledger, _, trainer = build_trainer(
        tmp_path, preflight, lambda event, step: decisions[(event, step)]
    )
    begin = enter_training(ledger, trainer, preflight)
    stale = child(
        ledger,
        begin,
        "trainer-stale-allow-candidate",
        event="pre_optimizer_step",
        frontier=ref("deliberately-stale-local-frontier"),
        boundary_global_step=0,
    )
    decisions[("pre_optimizer_step", 0)] = stale
    with pytest.raises(TrainingHeld) as failure:
        trainer._run_epoch(trainer.model)
    assert failure.value.disposition == "held_stale_frontier"
    assert trainer.training_steps == 0
    assert trainer._wake_candidate is None


def test_candidate_change_holds_before_clip_and_clears_gradients(
    tmp_path, preflight
) -> None:
    calls = 0
    ledger = None
    begin = None

    def provider(event, step):
        nonlocal calls
        calls += 1
        assert ledger is not None and begin is not None
        return child(
            ledger,
            begin,
            f"candidate-{calls}",
            event="pre_optimizer_step",
            boundary_global_step=0,
        )

    ledger, _, trainer = build_trainer(tmp_path, preflight, provider)
    begin = enter_training(ledger, trainer, preflight)
    with pytest.raises(HfCompatibilityError, match="changed between candidate"):
        trainer._run_epoch(trainer.model)
    assert trainer.model.zeroed >= 1
    assert trainer.optimizer.zeroed >= 1
    assert trainer.state.global_step == 0


def test_partial_failure_after_claim_latches_non_atomic_unit(
    tmp_path, preflight
) -> None:
    decisions = {}
    ledger, _, trainer = build_trainer(
        tmp_path, preflight, lambda event, step: decisions[(event, step)]
    )
    begin = enter_training(ledger, trainer, preflight)
    before = child(
        ledger, begin, "partial-pre", event="pre_optimizer_step", boundary_global_step=0
    )
    decisions[("pre_optimizer_step", 0)] = before
    trainer.fail_after_clip = True
    with pytest.raises(MutationUnitFailed, match="failed non-atomically"):
        trainer._run_epoch(trainer.model)
    with pytest.raises(MutationUnitFailed, match="failed non-atomically"):
        trainer.train(governance_decision=begin)


def test_evaluation_is_gated_before_loop_and_receipted(tmp_path, preflight) -> None:
    decisions = {}
    ledger = None
    before = None
    after = None

    def provider(event, step):
        nonlocal after
        if event == "post_evaluation":
            assert ledger is not None and before is not None
            after = child(
                ledger,
                before,
                "post-eval",
                event="post_evaluation",
                boundary_global_step=step,
            )
            return after
        return decisions[(event, step)]

    ledger, _, trainer = build_trainer(tmp_path, preflight, provider)
    begin = enter_training(ledger, trainer, preflight)
    before = child(
        ledger, begin, "pre-eval", event="pre_evaluation", boundary_global_step=0
    )
    decisions[("pre_evaluation", 0)] = before
    assert trainer.evaluate() == {"eval_loss": 1.0}
    assert after is not None
    assert ledger.heads(preflight.run_ref) == (after.governance_id,)
    assert ledger.verify()["entries"] == 4


def test_evaluation_failure_after_permit_latches_closed(tmp_path, preflight) -> None:
    decisions = {}
    ledger, _, trainer = build_trainer(
        tmp_path, preflight, lambda event, step: decisions[(event, step)]
    )
    begin = enter_training(ledger, trainer, preflight)
    before = child(
        ledger, begin, "failing-eval", event="pre_evaluation", boundary_global_step=0
    )
    decisions[("pre_evaluation", 0)] = before
    trainer.fail_evaluation = True
    with pytest.raises(EvaluationUnitFailed, match="failed after entry"):
        trainer.evaluate()


def test_checkpoint_joins_request_ticket_physical_evidence_and_garden(
    tmp_path, preflight
) -> None:
    decisions = {}
    trainer = None
    ledger = None
    request = None
    recorded = None

    def provider(event, step):
        nonlocal recorded, request
        assert trainer is not None and ledger is not None
        if event == "post_optimizer_step":
            before = decisions[("pre_optimizer_step", 0)]
            request = child(
                ledger,
                before,
                "checkpoint-request",
                event="post_optimizer_step",
                directive="checkpoint_then_park",
                boundary_global_step=step,
            )
            return request
        if event != "checkpoint_recorded":
            return decisions[(event, step)]
        assert request is not None
        observation = trainer._wake_last_checkpoint
        ticket = trainer._wake_last_ticket
        assert observation is not None and ticket is not None
        recorded = child(
            ledger,
            request,
            "checkpoint-recorded",
            event="checkpoint_recorded",
            boundary_global_step=step,
            garden_checkpoint_id=ref("garden-checkpoint-distinct"),
            physical_checkpoint_ref=observation.checkpoint_ref,
            physical_checkpoint_evidence_ref=observation.evidence_ref,
            model_checkpoint_artifact_ref=ref("model-artifact-distinct"),
            checkpoint_ticket_id=ticket.ticket_id,
            checkpoint_request_governance_id=request.governance_id,
        )
        return recorded

    ledger, host, trainer = build_trainer(tmp_path, preflight, provider)
    begin = enter_training(ledger, trainer, preflight)
    before = child(
        ledger, begin, "checkpoint-pre", event="pre_optimizer_step", boundary_global_step=0
    )
    decisions[("pre_optimizer_step", 0)] = before
    assert trainer._run_epoch(trainer.model) == "epoch"
    observation = verify_checkpoint(tmp_path / "output" / "checkpoint-1")
    assert trainer._wake_last_checkpoint == observation
    # The inevitable local cleanup callback preserves the resumable checkpoint
    # head; it does not manufacture a governed train_end decision.
    trainer.control = trainer.callback_handler.callbacks[-1].on_train_end(
        trainer.args, trainer.state, trainer.control
    )
    verification = ledger.verify()
    assert verification["checkpoint_tickets"] == 1
    assert verification["checkpoint_effects"] == 1
    assert verification["entries"] == 5
    assert recorded is not None
    explicit_end = child(
        ledger,
        recorded,
        "explicit-end-after-checkpoint",
        event="train_end",
        boundary_global_step=1,
    )
    host.record_terminal_receipt(explicit_end)
    assert ledger.verify()["entries"] == 6


def test_unauthorized_direct_checkpoint_is_blocked_before_filesystem(
    tmp_path, preflight
) -> None:
    _, _, trainer = build_trainer(tmp_path, preflight, lambda event, step: None)
    trainer.state.global_step = 1
    with pytest.raises(CheckpointTicketError, match="no exact WAKE ticket"):
        trainer._save_checkpoint(trainer.model, None)
    assert not (tmp_path / "output" / "checkpoint-1").exists()


def test_train_rejects_boolean_resume_and_mutated_arguments(
    tmp_path, preflight
) -> None:
    ledger, _, trainer = build_trainer(tmp_path, preflight, lambda event, step: None)
    begin = child(ledger, preflight, "begin")
    with pytest.raises(HfCompatibilityError, match="boolean/latest"):
        trainer.train(resume_from_checkpoint=True, governance_decision=begin)
    assert trainer.train_called is False

    trainer.args.push_to_hub = True
    with pytest.raises(HfCompatibilityError, match="push_to_hub"):
        trainer.train(governance_decision=begin)
    assert trainer.train_called is False


def test_provider_cannot_rewrite_boundary_step(tmp_path, preflight) -> None:
    trainer = None
    decision = None

    def provider(event, step):
        assert trainer is not None
        trainer.state.global_step = step + 1
        return decision

    ledger, _, trainer = build_trainer(tmp_path, preflight, provider)
    begin = enter_training(ledger, trainer, preflight)
    decision = child(
        ledger, begin, "pre", event="pre_optimizer_step", boundary_global_step=0
    )
    with pytest.raises(HfCompatibilityError, match="changed.*global step"):
        trainer._run_epoch(trainer.model)
