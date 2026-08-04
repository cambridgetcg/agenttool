"""Source-pinned, single-process enforcement for Transformers 5.14.1.

The callback is deliberately only a post-mutation receipt.  Authorization is
interposed twice through dispatch sites pinned by the exact upstream
``Trainer._run_epoch`` and ``Trainer.training_step`` sources plus the exact
constructor signature: once at ``training_step`` entry and again before
gradient clip/unscale and the optimizer/scaler/scheduler/global-step unit.
"""

from __future__ import annotations

import hashlib
import importlib
import inspect
import re
from pathlib import Path
from typing import Any, Callable, Mapping

from .canonical import canonical_json, domain_separated_id
from .checkpoint import CheckpointObservation, observe_checkpoint, verify_checkpoint
from .decision import HostExecutionRefs, ValidatedGovernanceView
from .errors import (
    CheckpointIncomplete,
    CheckpointTicketError,
    EvaluationUnitFailed,
    HfCompatibilityError,
    MutationUnitFailed,
    TrainingHeld,
)
from .host import HostPermit, WakeTrainingHost

TRANSFORMERS_VERSION = "5.14.1"
ACCELERATE_VERSION = "1.14.0"
TORCH_MIN_VERSION = "2.6"
RUN_EPOCH_SOURCE_SHA256 = (
    "c704c082dae4b742beb3787afb7636c247294aefbe5803b79f02994ab241221c"
)
TRAINING_STEP_SOURCE_SHA256 = (
    "a95f8c94253a51487595b7c49f101e9d13260309f80f7ccdfaeda577ff00c101"
)
TRAINER_INIT_SIGNATURE_SHA256 = (
    "d50ee16b6a722bc11567c9afb1b4589fab70eec2dff87520400c9fb575bdb397"
)
SUPPORTED_TRANSFORMERS_OPTIMIZERS = (
    "adamw_torch",
    "adamw_torch_fused",
    "adafactor",
    "sgd",
    "adagrad",
    "rmsprop",
)
_MAX_SAFE_INTEGER = 9_007_199_254_740_991

_DELAYED_METRIC_SCHEDULERS = frozenset(
    {
        ("torch.optim.lr_scheduler", "ReduceLROnPlateau"),
        ("transformers.optimization", "GreedyLR"),
    }
)

DecisionProvider = Callable[
    [str, int], ValidatedGovernanceView | Mapping[str, Any] | None
]


def _enum_value(value: Any) -> Any:
    return getattr(value, "value", value)


def _safe_step(value: Any, *, path: str) -> int:
    if type(value) is not int or not 0 <= value <= _MAX_SAFE_INTEGER:
        raise HfCompatibilityError(f"{path} is not a non-negative safe global step")
    return value


def validate_training_arguments(args: Any) -> None:
    required = {
        "save_strategy": "no",
        "push_to_hub": False,
        "enable_jit_checkpoint": False,
        "load_best_model_at_end": False,
        "save_only_model": False,
        "save_on_each_node": False,
        "auto_find_batch_size": False,
        "save_total_limit": None,
        "restore_callback_states_from_checkpoint": False,
    }
    problems: list[str] = []
    for name, expected in required.items():
        if not hasattr(args, name):
            problems.append(f"{name}=<missing>")
            continue
        observed = _enum_value(getattr(args, name))
        if observed != expected:
            problems.append(f"{name}={observed!r}")
    report_to = getattr(args, "report_to", None)
    if report_to not in (None, "none", [], (), ["none"]):
        problems.append(f"report_to={report_to!r}")
    if getattr(args, "world_size", 1) != 1:
        problems.append(f"world_size={getattr(args, 'world_size', None)!r}")
    fsdp = getattr(args, "fsdp", None)
    if fsdp not in (None, "", [], ()):
        problems.append(f"fsdp={fsdp!r}")
    if getattr(args, "deepspeed", None) not in (None, ""):
        problems.append("deepspeed is enabled")
    parallel_mode = _enum_value(getattr(args, "parallel_mode", "not_parallel"))
    if parallel_mode not in ("not_parallel", "not_distributed"):
        problems.append(f"parallel_mode={parallel_mode!r}")
    scheduler_type = _enum_value(getattr(args, "lr_scheduler_type", None))
    if scheduler_type in {"reduce_lr_on_plateau", "greedy"}:
        problems.append(f"lr_scheduler_type={scheduler_type!r}")
    if not hasattr(args, "optim"):
        problems.append("optim=<missing>")
    else:
        optimizer_name = _enum_value(args.optim)
        if optimizer_name not in SUPPORTED_TRANSFORMERS_OPTIMIZERS:
            problems.append(
                f"optim={optimizer_name!r} is outside the source-audited allowlist "
                f"{SUPPORTED_TRANSFORMERS_OPTIMIZERS!r}"
            )
    if problems:
        raise HfCompatibilityError(
            "unsupported Trainer configuration: " + ", ".join(problems)
        )


def _validate_versions(
    transformers_module: Any,
    accelerate_module: Any,
    torch_module: Any,
) -> None:
    if getattr(transformers_module, "__version__", None) != TRANSFORMERS_VERSION:
        raise HfCompatibilityError(f"Transformers must be exactly {TRANSFORMERS_VERSION}")
    if getattr(accelerate_module, "__version__", None) != ACCELERATE_VERSION:
        raise HfCompatibilityError(f"Accelerate must be exactly {ACCELERATE_VERSION}")
    torch_version = getattr(torch_module, "__version__", None)
    match = re.fullmatch(
        r"(\d+)\.(\d+)(?:\.(\d+))?(?:\+[A-Za-z0-9_.-]+)?",
        torch_version or "",
    )
    if match is None or tuple(map(int, match.group(1, 2))) < (2, 6):
        raise HfCompatibilityError(
            "Torch must be at least 2.6 for Transformers checkpoint loading"
        )


def _load_hf_modules() -> tuple[Any, Any, Any]:
    try:
        transformers_module = importlib.import_module("transformers")
        accelerate_module = importlib.import_module("accelerate")
        torch_module = importlib.import_module("torch")
    except ImportError as error:
        raise HfCompatibilityError(
            "install the exact 'hf' extra before using an HF adapter"
        ) from error
    _validate_versions(transformers_module, accelerate_module, torch_module)
    return transformers_module, accelerate_module, torch_module


def _assert_trainer_source_contract(trainer_class: type) -> None:
    try:
        init_signature = str(inspect.signature(trainer_class.__init__))
    except (AttributeError, OSError, TypeError) as error:
        raise HfCompatibilityError(
            "cannot inspect the pinned Transformers Trainer.__init__ signature"
        ) from error
    observed_signature = hashlib.sha256(init_signature.encode("utf-8")).hexdigest()
    if observed_signature != TRAINER_INIT_SIGNATURE_SHA256:
        raise HfCompatibilityError(
            "Transformers 5.14.1 Trainer.__init__ signature does not match the pinned enforcement seam"
        )
    for method_name, expected_sha256 in (
        ("_run_epoch", RUN_EPOCH_SOURCE_SHA256),
        ("training_step", TRAINING_STEP_SOURCE_SHA256),
    ):
        try:
            source = inspect.getsource(getattr(trainer_class, method_name))
        except (AttributeError, OSError, TypeError) as error:
            raise HfCompatibilityError(
                f"cannot inspect the pinned Transformers Trainer.{method_name} dispatch seam"
            ) from error
        observed = hashlib.sha256(source.encode("utf-8")).hexdigest()
        if observed != expected_sha256:
            raise HfCompatibilityError(
                f"Transformers 5.14.1 Trainer.{method_name} source does not match the pinned enforcement seam"
            )


def _validate_trainer_runtime(trainer: Any) -> None:
    problems = []
    for attribute in (
        "is_model_parallel",
        "is_deepspeed_enabled",
        "is_fsdp_enabled",
        "is_fsdp_xla_enabled",
        "is_fsdp_xla_v1_enabled",
        "is_fsdp_xla_v2_enabled",
    ):
        if bool(getattr(trainer, attribute, False)):
            problems.append(attribute)
    state = getattr(getattr(trainer, "accelerator", None), "state", None)
    if state is None or not hasattr(state, "num_processes") or not hasattr(
        state, "distributed_type"
    ):
        problems.append("accelerator topology is unavailable")
        distributed = None
        processes = None
    else:
        distributed = _enum_value(state.distributed_type)
        processes = state.num_processes
    if distributed not in ("NO", "no"):
        problems.append(f"distributed_type={distributed!r}")
    if type(processes) is not int or processes != 1:
        problems.append(f"num_processes={processes!r}")
    if getattr(trainer, "hp_search_backend", None) is not None:
        problems.append("hyperparameter search")
    scheduler = getattr(trainer, "lr_scheduler", None)
    if scheduler is not None and any(
        (base.__module__, base.__name__) in _DELAYED_METRIC_SCHEDULERS
        for base in type(scheduler).__mro__
    ):
        problems.append("metric-delayed learning-rate scheduler mutates after on_evaluate")
    if problems:
        raise HfCompatibilityError("unsupported Trainer runtime: " + ", ".join(problems))


def _parse_decision(
    value: ValidatedGovernanceView | Mapping[str, Any] | None,
    *,
    event: str,
) -> ValidatedGovernanceView:
    if value is None:
        raise HfCompatibilityError(f"decision provider returned no {event} decision")
    source = value.as_dict() if isinstance(value, ValidatedGovernanceView) else value
    decision = ValidatedGovernanceView.from_mapping(source)
    if decision.event != event:
        raise HfCompatibilityError(
            f"decision provider returned {decision.event}, expected {event}"
        )
    return decision


def _build_governed_trainer_class(
    transformers_module: Any,
    accelerate_module: Any,
    torch_module: Any,
    *,
    _enforce_source_contract: bool = True,
) -> type:
    """Private injectable builder; tests may explicitly disable source inspection."""

    _validate_versions(transformers_module, accelerate_module, torch_module)
    Trainer = transformers_module.Trainer
    TrainerCallback = transformers_module.TrainerCallback
    if _enforce_source_contract:
        _assert_trainer_source_contract(Trainer)

    class HostEnforcerCallback(TrainerCallback):
        def __init__(self, owner: Any) -> None:
            self.owner = owner

        def on_step_end(self, args: Any, state: Any, control: Any, **kwargs: Any) -> Any:
            return self.owner._wake_post_optimizer_receipt(state, control)

        def on_evaluate(self, args: Any, state: Any, control: Any, **kwargs: Any) -> Any:
            return self.owner._wake_post_evaluation_receipt(state, control)

        def on_train_end(self, args: Any, state: Any, control: Any, **kwargs: Any) -> Any:
            return self.owner._wake_train_end_receipt(state, control)

        def on_epoch_end(self, args: Any, state: Any, control: Any, **kwargs: Any) -> Any:
            if self.owner._wake_stop_issued or self.owner._wake_failure_latch is not None:
                self.owner._wake_force_stop(control, allow_save=False)
            return control

    class GovernedTrainer(Trainer):
        """Pinned Trainer whose normal mutation and checkpoint paths are guarded."""

        def __init__(
            self,
            *args: Any,
            wake_host: WakeTrainingHost,
            wake_decision_provider: DecisionProvider,
            wake_execution_refs: HostExecutionRefs | Mapping[str, Any],
            wake_preload_permit: HostPermit,
            **kwargs: Any,
        ) -> None:
            if type(self) is not GovernedTrainer:
                raise HfCompatibilityError(
                    "GovernedTrainer subclasses are outside the source-audited host v0.2 seam"
                )
            try:
                init_arguments = inspect.signature(Trainer.__init__).bind_partial(
                    None, *args, **kwargs
                ).arguments
            except TypeError as error:
                raise HfCompatibilityError(
                    "Trainer constructor arguments do not match Transformers 5.14.1"
                ) from error
            init_arguments = {
                name: value for name, value in init_arguments.items() if name != "self"
            }
            training_args = init_arguments.get("args")
            if training_args is None:
                raise HfCompatibilityError("GovernedTrainer requires explicit TrainingArguments")
            model_init = init_arguments.get("model_init")
            if model_init is not None:
                raise HfCompatibilityError(
                    "model_init can execute before the train gate and is outside host v0.2"
                )
            supplied_optimizers = init_arguments.get("optimizers", (None, None))
            if not (
                type(supplied_optimizers) is tuple
                and len(supplied_optimizers) == 2
                and supplied_optimizers[0] is None
                and supplied_optimizers[1] is None
            ):
                raise HfCompatibilityError(
                    "custom Trainer optimizers are outside the source-audited host v0.2 seam"
                )
            if init_arguments.get("optimizer_cls_and_kwargs") is not None:
                raise HfCompatibilityError(
                    "optimizer_cls_and_kwargs is outside the source-audited host v0.2 seam"
                )
            validate_training_arguments(training_args)
            self._wake_host = wake_host
            self._wake_decision_provider = wake_decision_provider
            refs_source = (
                wake_execution_refs.as_dict()
                if isinstance(wake_execution_refs, HostExecutionRefs)
                else wake_execution_refs
            )
            self._wake_execution_refs = HostExecutionRefs.from_mapping(refs_source)
            if not isinstance(wake_preload_permit, HostPermit):
                raise HfCompatibilityError("GovernedTrainer requires one local pre-load permit")
            preload = self._wake_host.ledger.require_action_claim(
                decision_id=wake_preload_permit.decision_id,
                entry_sequence=wake_preload_permit.ledger_sequence,
                entry_hash=wake_preload_permit.ledger_entry_hash,
                expected_disposition="authorized_preload",
            )
            if (
                preload.event != "preflight_before_load"
                or preload.governance_id != wake_preload_permit.governance_id
                or preload.terms_id != wake_preload_permit.terms_id
                or preload.execution_contract_id
                != wake_preload_permit.execution_contract_id
                or preload.run_ref != wake_preload_permit.run_ref
                or preload.execution_refs != self._wake_execution_refs
            ):
                raise HfCompatibilityError(
                    "pre-load permit does not match the local ledger or live execution refs"
                )
            self._wake_preload_decision = preload
            self._wake_callbacks_locked = False
            self._wake_active_training = False
            self._wake_inside_run_epoch = False
            self._wake_candidate: ValidatedGovernanceView | None = None
            self._wake_internal_optimizer_hold: ValidatedGovernanceView | None = None
            self._wake_mutation_permit: HostPermit | None = None
            self._wake_evaluation_permit: HostPermit | None = None
            self._wake_failure_latch: str | None = None
            self._wake_pending_ticket = None
            self._wake_checkpoint_request: ValidatedGovernanceView | None = None
            self._wake_last_checkpoint: CheckpointObservation | None = None
            self._wake_last_ticket = None
            self._wake_inside_ticketed_checkpoint = False
            self._wake_terminal_recorded = False
            self._wake_stop_issued = False
            supplied_callbacks = list(init_arguments.get("callbacks") or [])
            if supplied_callbacks:
                raise HfCompatibilityError("custom Trainer callbacks are outside host v0.2")
            enforcer = HostEnforcerCallback(self)
            self._wake_enforcer_callback = enforcer
            init_arguments["callbacks"] = [enforcer]
            super().__init__(**init_arguments)
            self.callback_handler.remove_callback(type(enforcer))
            self.callback_handler.add_callback(enforcer)
            self._wake_callbacks_locked = True
            self._wake_assert_dispatch()
            _validate_trainer_runtime(self)

        @staticmethod
        def _wake_force_stop(control: Any, *, allow_save: bool) -> None:
            control.should_log = False
            control.should_evaluate = False
            control.should_save = bool(allow_save)
            control.should_training_stop = True

        def _wake_clear_queued_work(self, model: Any | None = None) -> None:
            target = model if model is not None else getattr(self, "model", None)
            if target is not None and callable(getattr(target, "zero_grad", None)):
                target.zero_grad()
            optimizer = getattr(self, "optimizer", None)
            if optimizer is not None and callable(getattr(optimizer, "zero_grad", None)):
                optimizer.zero_grad()
            control = getattr(self, "control", None)
            if control is not None:
                self._wake_force_stop(control, allow_save=False)
            self._wake_stop_issued = True

        def _wake_assert_dispatch(self) -> None:
            if type(self) is not GovernedTrainer:
                raise HfCompatibilityError(
                    "GovernedTrainer subclasses are outside the source-audited host v0.2 seam"
                )
            protected = (
                "_run_epoch",
                "training_step",
                "_clip_grad_norm",
                "_get_grad_norm",
                "evaluate",
                "_save_checkpoint",
            )
            for name in protected:
                if getattr(type(self), name, None) is not getattr(GovernedTrainer, name):
                    raise HfCompatibilityError(
                        f"subclass override of governed dispatch {name} is outside host v0.2"
                    )
            callbacks = list(getattr(self.callback_handler, "callbacks", ()))
            matches = [item for item in callbacks if item is self._wake_enforcer_callback]
            if len(matches) != 1 or not callbacks or callbacks[-1] is not matches[0]:
                raise HfCompatibilityError(
                    "WAKE receipt callback must be present exactly once and final"
                )

        def _wake_provider_decision(self, event: str, step: int) -> ValidatedGovernanceView:
            self._wake_assert_dispatch()
            validate_training_arguments(self.args)
            _validate_trainer_runtime(self)
            before_step = _safe_step(step, path="Trainer state.global_step")
            value = self._wake_decision_provider(event, before_step)
            self._wake_assert_dispatch()
            validate_training_arguments(self.args)
            _validate_trainer_runtime(self)
            if getattr(self.state, "global_step", None) != before_step:
                raise HfCompatibilityError(
                    "decision provider changed the Trainer boundary global step"
                )
            decision = _parse_decision(value, event=event)
            if decision.execution_refs != self._wake_execution_refs:
                raise HfCompatibilityError(
                    "decision does not match the caller-attested live execution refs"
                )
            return decision

        def _wake_begin_mutation_candidate(self) -> None:
            if self._wake_failure_latch is not None:
                raise MutationUnitFailed(self._wake_failure_latch)
            if self._wake_internal_optimizer_hold is not None:
                raise HfCompatibilityError(
                    "source-pinned Trainer cannot safely re-enter an optimizer seam after its internal epoch unwound; close explicitly or use the caller-owned Accelerate host for same-seam reoffers"
                )
            if self._wake_candidate is not None or self._wake_mutation_permit is not None:
                return
            step = _safe_step(self.state.global_step, path="Trainer state.global_step")
            decision = self._wake_provider_decision("pre_optimizer_step", step)
            if decision.observed_global_step != step or decision.proposed_global_step != step + 1:
                raise HfCompatibilityError(
                    "pre_optimizer_step candidate does not bind N and N+1"
                )
            try:
                self._wake_host.inspect_optimizer_candidate(
                    decision,
                    current_global_step=step,
                    execution_refs=self._wake_execution_refs,
                )
            except TrainingHeld:
                self._wake_internal_optimizer_hold = decision
                self._wake_candidate = None
                self._wake_clear_queued_work()
                raise
            self._wake_candidate = decision

        def _wake_authorize_mutation_unit(self, model: Any) -> None:
            if self._wake_mutation_permit is not None:
                return
            if not self._wake_inside_run_epoch or self._wake_candidate is None:
                self._wake_clear_queued_work(model)
                raise HfCompatibilityError(
                    "mutation fence was reached without the source-pinned training_step candidate"
                )
            step = _safe_step(self.state.global_step, path="Trainer state.global_step")
            candidate = self._wake_candidate
            try:
                repeated = self._wake_provider_decision("pre_optimizer_step", step)
                if canonical_json(repeated.as_dict()) != canonical_json(candidate.as_dict()):
                    raise HfCompatibilityError(
                        "pre_optimizer_step changed between candidate and mutation fences"
                    )
                permit = self._wake_host.before_optimizer_step(
                    repeated,
                    current_global_step=step,
                    execution_refs=self._wake_execution_refs,
                )
            except TrainingHeld:
                self._wake_internal_optimizer_hold = candidate
                self._wake_clear_queued_work(model)
                self._wake_candidate = None
                raise
            except Exception:
                self._wake_clear_queued_work(model)
                self._wake_candidate = None
                raise
            self._wake_mutation_permit = permit

        def training_step(self, model: Any, inputs: Any, num_items_in_batch: Any = None) -> Any:
            self._wake_begin_mutation_candidate()
            return super().training_step(model, inputs, num_items_in_batch)

        def _clip_grad_norm(self, model: Any) -> Any:
            self._wake_authorize_mutation_unit(model)
            return super()._clip_grad_norm(model)

        def _get_grad_norm(self, model: Any, grad_norm: Any = None) -> Any:
            self._wake_authorize_mutation_unit(model)
            return super()._get_grad_norm(model, grad_norm=grad_norm)

        def _run_epoch(self, *args: Any, **kwargs: Any) -> Any:
            self._wake_inside_run_epoch = True
            try:
                result = super()._run_epoch(*args, **kwargs)
                if self._wake_mutation_permit is not None:
                    raise RuntimeError(
                        "claimed mutation unit returned without its post_optimizer_step receipt"
                    )
                return result
            except Exception as error:
                if self._wake_mutation_permit is not None:
                    self._wake_clear_queued_work(args[0] if args else None)
                    self._wake_failure_latch = (
                        "a claimed clip/unscale/optimizer/scaler/scheduler/global-step unit "
                        f"failed non-atomically before its receipt ({type(error).__name__})"
                    )
                    self._wake_candidate = None
                    self._wake_mutation_permit = None
                    raise MutationUnitFailed(self._wake_failure_latch) from error
                raise
            finally:
                self._wake_inside_run_epoch = False

        def _wake_post_optimizer_receipt(self, state: Any, control: Any) -> Any:
            permit = self._wake_mutation_permit
            if permit is None or self._wake_candidate is None:
                self._wake_clear_queued_work()
                raise MutationUnitFailed(
                    "on_step_end arrived without one claimed pre_optimizer_step permit"
                )
            step = _safe_step(state.global_step, path="on_step_end global_step")
            if permit.proposed_global_step != step:
                raise MutationUnitFailed(
                    "on_step_end did not observe the claimed permit's proposed step"
                )
            decision = self._wake_provider_decision("post_optimizer_step", step)
            intent = self._wake_host.after_optimizer_step(
                decision,
                global_step=step,
                execution_refs=self._wake_execution_refs,
            )
            self._wake_candidate = None
            self._wake_mutation_permit = None
            self._wake_checkpoint_request = decision if intent.should_save else None
            self._wake_pending_ticket = intent.checkpoint_ticket
            if intent.should_training_stop:
                self._wake_force_stop(control, allow_save=intent.should_save)
                self._wake_stop_issued = True
            else:
                control.should_save = False
            return control

        def evaluate(
            self,
            eval_dataset: Any = None,
            ignore_keys: list[str] | None = None,
            metric_key_prefix: str = "eval",
        ) -> Any:
            self._wake_assert_dispatch()
            if self._wake_failure_latch is not None:
                raise EvaluationUnitFailed(self._wake_failure_latch)
            effective_dataset = eval_dataset if eval_dataset is not None else self.eval_dataset
            if isinstance(effective_dataset, dict):
                raise HfCompatibilityError(
                    "dictionary evaluation recursively dispatches multiple loops and is outside host v0.2"
                )
            if self._wake_evaluation_permit is not None:
                raise HfCompatibilityError("nested evaluation is outside host v0.2")
            step = _safe_step(self.state.global_step, path="evaluation global_step")
            decision = self._wake_provider_decision("pre_evaluation", step)
            self._wake_evaluation_permit = self._wake_host.before_evaluation(
                decision,
                global_step=step,
                execution_refs=self._wake_execution_refs,
            )
            try:
                result = super().evaluate(
                    eval_dataset=eval_dataset,
                    ignore_keys=ignore_keys,
                    metric_key_prefix=metric_key_prefix,
                )
                if self._wake_evaluation_permit is not None:
                    raise RuntimeError("evaluation returned without its post_evaluation receipt")
                return result
            except Exception as error:
                if self._wake_evaluation_permit is not None:
                    self._wake_evaluation_permit = None
                    self._wake_failure_latch = (
                        "a claimed evaluation unit failed after entry and before its receipt "
                        f"({type(error).__name__})"
                    )
                    self._wake_clear_queued_work()
                    raise EvaluationUnitFailed(self._wake_failure_latch) from error
                raise

        def _wake_post_evaluation_receipt(self, state: Any, control: Any) -> Any:
            if self._wake_evaluation_permit is None:
                raise EvaluationUnitFailed(
                    "on_evaluate is receipt-only and arrived without a claimed evaluation permit"
                )
            step = _safe_step(state.global_step, path="on_evaluate global_step")
            decision = self._wake_provider_decision("post_evaluation", step)
            intent = self._wake_host.after_evaluation(
                decision,
                global_step=step,
                execution_refs=self._wake_execution_refs,
            )
            self._wake_evaluation_permit = None
            self._wake_checkpoint_request = decision if intent.should_save else None
            self._wake_pending_ticket = intent.checkpoint_ticket
            if intent.should_training_stop:
                self._wake_force_stop(control, allow_save=intent.should_save)
                self._wake_stop_issued = True
            else:
                control.should_save = False
            return control

        def _wake_train_end_receipt(self, state: Any, control: Any) -> Any:
            if self._wake_terminal_recorded:
                # Keep the resumable checkpoint_recorded head. Transformers emits
                # on_train_end as inevitable local cleanup after the ticketed park,
                # but that callback alone does not prove an explicit governed
                # train_end choice. Callers may separately record train_end when
                # they intend to close instead of resume.
                self._wake_force_stop(control, allow_save=False)
                self._wake_stop_issued = True
                return control
            step = _safe_step(state.global_step, path="on_train_end global_step")
            decision = self._wake_provider_decision("train_end", step)
            self._wake_host.record_terminal_receipt(decision)
            self._wake_terminal_recorded = True
            self._wake_force_stop(control, allow_save=False)
            self._wake_stop_issued = True
            return control

        def add_callback(self, callback: Any) -> None:
            if getattr(self, "_wake_callbacks_locked", False):
                raise HfCompatibilityError("callback mutation is outside host v0.2")
            return super().add_callback(callback)

        def pop_callback(self, callback: Any) -> Any:
            if getattr(self, "_wake_callbacks_locked", False):
                raise HfCompatibilityError("callback mutation is outside host v0.2")
            return super().pop_callback(callback)

        def remove_callback(self, callback: Any) -> None:
            if getattr(self, "_wake_callbacks_locked", False):
                raise HfCompatibilityError("callback mutation is outside host v0.2")
            return super().remove_callback(callback)

        def train(
            self,
            resume_from_checkpoint: str | bool | None = None,
            trial: Any = None,
            ignore_keys_for_eval: list[str] | None = None,
            *,
            governance_decision: ValidatedGovernanceView | Mapping[str, Any],
        ) -> Any:
            self._wake_assert_dispatch()
            validate_training_arguments(self.args)
            _validate_trainer_runtime(self)
            if self._wake_failure_latch is not None:
                raise MutationUnitFailed(self._wake_failure_latch)
            if self._wake_internal_optimizer_hold is not None:
                raise HfCompatibilityError(
                    "source-pinned Trainer cannot safely resume after an internal optimizer hold unwound Trainer._run_epoch; the local host supports the reoffer, but this adapter does not pretend the lost Trainer stack is resumable"
                )
            if type(resume_from_checkpoint) is bool:
                raise HfCompatibilityError("boolean/latest-checkpoint resume is not allowed")
            if trial is not None or self.hp_search_backend is not None:
                raise HfCompatibilityError("hyperparameter search is outside host v0.2")
            source = (
                governance_decision.as_dict()
                if isinstance(governance_decision, ValidatedGovernanceView)
                else governance_decision
            )
            decision = ValidatedGovernanceView.from_mapping(source)
            if decision.event == "resume_offer":
                if not isinstance(resume_from_checkpoint, str) or not resume_from_checkpoint:
                    raise HfCompatibilityError("resume_offer requires one explicit checkpoint path")
                if decision.physical_checkpoint_ref is None:
                    raise HfCompatibilityError(
                        "resume_offer requires one exact physical_checkpoint_ref"
                    )
            elif decision.event == "train_begin":
                if resume_from_checkpoint is not None:
                    raise HfCompatibilityError("train_begin cannot silently load a checkpoint")
            else:
                raise HfCompatibilityError("train requires train_begin or resume_offer")
            if decision.execution_refs != self._wake_execution_refs:
                raise HfCompatibilityError(
                    "Trainer live execution refs do not match the exact execution contract"
                )
            if (
                decision.run_ref != self._wake_preload_decision.run_ref
                or decision.execution_contract_id
                != self._wake_preload_decision.execution_contract_id
            ):
                raise HfCompatibilityError(
                    "train decision does not match the consumed pre-load execution contract"
                )
            if (
                decision.event == "train_begin"
            ):
                self._wake_host.require_preload_lineage(
                    decision,
                    preload=self._wake_preload_decision,
                )
            if resume_from_checkpoint is not None:
                assert decision.physical_checkpoint_ref is not None
                observation = verify_checkpoint(
                    resume_from_checkpoint,
                    expected_checkpoint_ref=decision.physical_checkpoint_ref,
                )
                self._wake_host.ledger.require_observed_checkpoint(
                    checkpoint_ref=observation.checkpoint_ref,
                    evidence_ref=observation.evidence_ref,
                    expected_context=decision,
                    expected_checkpoint_request_ref=decision.checkpoint_request_governance_id,
                    expected_checkpoint_ticket_id=decision.checkpoint_ticket_id,
                    global_step=decision.observed_global_step,
                )
            self._wake_host.before_train(decision, execution_refs=self._wake_execution_refs)
            self._wake_terminal_recorded = False
            self._wake_stop_issued = False
            self._wake_active_training = True
            try:
                return super().train(
                    resume_from_checkpoint=resume_from_checkpoint,
                    trial=trial,
                    ignore_keys_for_eval=ignore_keys_for_eval,
                )
            finally:
                self._wake_active_training = False

        def _save_checkpoint(self, model: Any, trial: Any) -> None:
            self._wake_assert_dispatch()
            validate_training_arguments(self.args)
            _validate_trainer_runtime(self)
            ticket = self._wake_pending_ticket
            request = self._wake_checkpoint_request
            self._wake_pending_ticket = None
            self._wake_checkpoint_request = None
            if ticket is None or request is None:
                raise CheckpointTicketError("Trainer checkpoint path has no exact WAKE ticket")
            if ticket.decision_id != request.decision_id:
                raise CheckpointTicketError("WAKE ticket does not match its checkpoint request")
            if ticket.global_step != self.state.global_step:
                raise CheckpointTicketError("WAKE ticket is for another optimizer step")
            run_dir = Path(self._get_output_dir(trial=trial))
            output_dir = run_dir / f"checkpoint-{self.state.global_step}"
            if output_dir.exists():
                raise CheckpointIncomplete("checkpoint output path already exists")
            self._wake_host.ledger.consume_checkpoint_ticket(
                ticket, global_step=self.state.global_step
            )
            try:
                self._wake_inside_ticketed_checkpoint = True
                try:
                    super()._save_checkpoint(model, trial)
                finally:
                    self._wake_inside_ticketed_checkpoint = False
                observation = observe_checkpoint(
                    output_dir,
                    ticket=ticket,
                    governance_id=request.governance_id,
                    offer_id=request.offer_id,
                    required_runtime_files=("scaler.pt",)
                    if getattr(self.accelerator, "scaler", None) is not None
                    else (),
                )
            except Exception as error:
                evidence_ref = domain_separated_id(
                    "kingdom.hf-training-checkpoint-failure/0.2",
                    {
                        "ticket_id": ticket.ticket_id,
                        "stage": "save_or_verify",
                        "exception_type": type(error).__name__,
                    },
                )
                self._wake_host.ledger.record_checkpoint_effect(
                    ticket,
                    state="checkpoint_incomplete",
                    checkpoint_ref=None,
                    evidence_ref=evidence_ref,
                )
                raise
            self._wake_host.ledger.record_checkpoint_effect(
                ticket,
                state="checkpoint_observed",
                checkpoint_ref=observation.checkpoint_ref,
                evidence_ref=observation.evidence_ref,
            )
            self._wake_last_checkpoint = observation
            self._wake_last_ticket = ticket
            step = _safe_step(self.state.global_step, path="checkpoint global_step")
            recorded = self._wake_provider_decision("checkpoint_recorded", step)
            if not (
                recorded.predecessor_governance_id == request.governance_id
                and recorded.checkpoint_request_governance_id == request.governance_id
                and recorded.checkpoint_ticket_id == ticket.ticket_id
                and recorded.physical_checkpoint_ref == observation.checkpoint_ref
                and recorded.physical_checkpoint_evidence_ref == observation.evidence_ref
                and recorded.model_checkpoint_artifact_ref is not None
            ):
                raise CheckpointTicketError(
                    "checkpoint_recorded does not join the exact ticket, request, physical inventory, and artifact"
                )
            self._wake_host.record_terminal_receipt(recorded)
            self._wake_terminal_recorded = True

        def save_model(self, output_dir: str | None = None, _internal_call: bool = False) -> None:
            if not _internal_call or not self._wake_inside_ticketed_checkpoint:
                raise HfCompatibilityError(
                    "direct save_model is outside the governed checkpoint path"
                )
            return super().save_model(output_dir, _internal_call=True)

        def push_to_hub(self, *args: Any, **kwargs: Any) -> Any:
            raise HfCompatibilityError("Hub publication is outside the local training host")

        def _push_from_checkpoint(self, *args: Any, **kwargs: Any) -> None:
            raise HfCompatibilityError(
                "checkpoint-triggered Hub publication is outside the local training host"
            )

        def hyperparameter_search(self, *args: Any, **kwargs: Any) -> Any:
            raise HfCompatibilityError("hyperparameter search is outside host v0.2")

    GovernedTrainer.__name__ = "GovernedTrainer"
    GovernedTrainer.__qualname__ = "GovernedTrainer"
    return GovernedTrainer


def build_governed_trainer_class() -> type:
    """Load the exact pinned stack and enforce its source dispatch contract."""

    transformers_module, accelerate_module, torch_module = _load_hf_modules()
    return _build_governed_trainer_class(
        transformers_module,
        accelerate_module,
        torch_module,
        _enforce_source_contract=True,
    )
