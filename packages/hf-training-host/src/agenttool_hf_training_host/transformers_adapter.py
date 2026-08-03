"""Pinned adapter for one non-distributed Transformers 5.14.1 process.

This module deliberately imports Transformers only when the adapter factory is
called, so the base ledger and policy boundary remain dependency-free.
"""

from __future__ import annotations

import importlib
import re
from pathlib import Path
from typing import Any, Callable, Mapping

from .canonical import domain_separated_id
from .checkpoint import CheckpointObservation, observe_checkpoint, verify_checkpoint
from .decision import HostExecutionRefs, ValidatedGovernanceView
from .errors import CheckpointIncomplete, CheckpointTicketError, HfCompatibilityError
from .host import HostPermit, WakeTrainingHost

TRANSFORMERS_VERSION = "5.14.1"
ACCELERATE_VERSION = "1.14.0"
TORCH_MIN_VERSION = "2.6"

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
    world_size = getattr(args, "world_size", 1)
    if world_size != 1:
        problems.append(f"world_size={world_size!r}")
    fsdp = getattr(args, "fsdp", None)
    if fsdp not in (None, "", [], ()):
        problems.append(f"fsdp={fsdp!r}")
    if getattr(args, "deepspeed", None) not in (None, ""):
        problems.append("deepspeed is enabled")
    parallel_mode = _enum_value(getattr(args, "parallel_mode", "not_parallel"))
    if parallel_mode not in ("not_parallel", "not_distributed"):
        problems.append(f"parallel_mode={parallel_mode!r}")
    lr_scheduler_type = _enum_value(getattr(args, "lr_scheduler_type", None))
    if lr_scheduler_type in {"reduce_lr_on_plateau", "greedy"}:
        problems.append(f"lr_scheduler_type={lr_scheduler_type!r}")
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
    accelerator_state = getattr(getattr(trainer, "accelerator", None), "state", None)
    if accelerator_state is None or not hasattr(
        accelerator_state, "num_processes"
    ) or not hasattr(accelerator_state, "distributed_type"):
        problems.append("accelerator topology is unavailable")
        distributed = None
        processes = None
    else:
        distributed = _enum_value(accelerator_state.distributed_type)
        processes = accelerator_state.num_processes
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
        problems.append(
            "metric-delayed learning-rate scheduler mutates after on_evaluate"
        )
    if problems:
        raise HfCompatibilityError("unsupported Trainer runtime: " + ", ".join(problems))


def _build_governed_trainer_class(
    transformers_module: Any,
    accelerate_module: Any,
    torch_module: Any,
) -> type:
    _validate_versions(transformers_module, accelerate_module, torch_module)
    Trainer = transformers_module.Trainer
    TrainerCallback = transformers_module.TrainerCallback

    class HostEnforcerCallback(TrainerCallback):
        def __init__(self, owner: Any) -> None:
            self.owner = owner

        def _apply(self, event: str, state: Any, control: Any) -> Any:
            validate_training_arguments(self.owner.args)
            _validate_trainer_runtime(self.owner)
            boundary_step = getattr(state, "global_step", None)
            if (
                type(boundary_step) is not int
                or not 0 <= boundary_step <= 9_007_199_254_740_991
            ):
                raise HfCompatibilityError(
                    "Trainer boundary has no non-negative safe global step"
                )
            decision = self.owner._wake_decision_provider(event, boundary_step)
            # The provider is ordinary caller code. Revalidate after it returns
            # so it cannot reopen Hub, rotation, topology, or delayed-scheduler
            # paths immediately before the host decision takes effect.
            validate_training_arguments(self.owner.args)
            _validate_trainer_runtime(self.owner)
            if getattr(state, "global_step", None) != boundary_step:
                raise HfCompatibilityError(
                    "decision provider changed the Trainer boundary global step"
                )
            if decision is None:
                control.should_log = False
                control.should_evaluate = False
                control.should_save = False
                control.should_training_stop = True
                self.owner._wake_stop_issued = True
                return control
            source = decision.as_dict() if isinstance(decision, ValidatedGovernanceView) else decision
            parsed = ValidatedGovernanceView.from_mapping(source)
            expected_event = "step_boundary" if event == "step_boundary" else "evaluation_boundary"
            if parsed.event != expected_event:
                raise HfCompatibilityError("decision provider returned the wrong lifecycle event")
            intent = self.owner._wake_host.at_safe_boundary(
                parsed,
                global_step=boundary_step,
                execution_refs=self.owner._wake_execution_refs,
            )
            self.owner._wake_last_decision = parsed
            if intent.should_training_stop:
                control.should_log = False
                control.should_evaluate = False
                control.should_save = intent.should_save
                control.should_training_stop = True
                self.owner._wake_pending_ticket = intent.checkpoint_ticket
                self.owner._wake_stop_issued = True
            else:
                control.should_save = False
                self.owner._wake_pending_ticket = None
            return control

        def on_epoch_end(self, args: Any, state: Any, control: Any, **kwargs: Any) -> Any:
            validate_training_arguments(self.owner.args)
            _validate_trainer_runtime(self.owner)
            if self.owner._wake_stop_issued:
                # DefaultFlowCallback may set an epoch evaluation after the
                # step-boundary stop. As the final ordinary callback, clear
                # every new side effect before Trainer's epoch-end dispatcher.
                control.should_log = False
                control.should_evaluate = False
                control.should_save = False
                control.should_training_stop = True
            return control

        def on_step_end(self, args: Any, state: Any, control: Any, **kwargs: Any) -> Any:
            return self._apply("step_boundary", state, control)

        def on_evaluate(self, args: Any, state: Any, control: Any, **kwargs: Any) -> Any:
            return self._apply("evaluation_boundary", state, control)

    class GovernedTrainer(Trainer):
        """Exact-version Trainer whose normal checkpoint path needs one ticket."""

        def __init__(
            self,
            *args: Any,
            wake_host: WakeTrainingHost,
            wake_decision_provider: DecisionProvider,
            wake_execution_refs: HostExecutionRefs | Mapping[str, Any],
            wake_preload_permit: HostPermit,
            **kwargs: Any,
        ) -> None:
            training_args = kwargs.get("args")
            if training_args is None and len(args) >= 2:
                training_args = args[1]
            if training_args is None:
                raise HfCompatibilityError("GovernedTrainer requires explicit TrainingArguments")
            model_init = kwargs.get("model_init")
            if model_init is None and len(args) >= 7:
                model_init = args[6]
            if model_init is not None:
                raise HfCompatibilityError(
                    "model_init can execute before the train gate and is outside host v0.1"
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
                or preload.run_ref != wake_preload_permit.run_ref
                or preload.execution_refs != self._wake_execution_refs
            ):
                raise HfCompatibilityError(
                    "pre-load permit does not match the local ledger or live execution refs"
                )
            self._wake_preload_decision = preload
            self._wake_pending_ticket = None
            self._wake_last_decision = None
            self._wake_last_checkpoint: CheckpointObservation | None = None
            self._wake_inside_ticketed_checkpoint = False
            self._wake_stop_issued = False
            supplied_callbacks = list(kwargs.pop("callbacks", None) or [])
            if supplied_callbacks:
                raise HfCompatibilityError(
                    "custom Trainer callbacks are outside host v0.1"
                )
            self._wake_callbacks_locked = False
            enforcer = HostEnforcerCallback(self)
            self._wake_enforcer_callback = enforcer
            kwargs["callbacks"] = [enforcer]
            super().__init__(*args, **kwargs)
            # Trainer adds its progress callback after caller callbacks. Re-add
            # the enforcer so it is the final ordinary callback; the save guard
            # below remains authoritative if a caller later adds another one.
            self.callback_handler.remove_callback(type(enforcer))
            self.callback_handler.add_callback(enforcer)
            self._wake_callbacks_locked = True
            _validate_trainer_runtime(self)

        def _assert_enforcer(self) -> None:
            callbacks = list(getattr(self.callback_handler, "callbacks", ()))
            matches = [item for item in callbacks if item is self._wake_enforcer_callback]
            if len(matches) != 1 or not callbacks or callbacks[-1] is not matches[0]:
                raise HfCompatibilityError(
                    "WAKE enforcer callback must be present exactly once and final"
                )

        def add_callback(self, callback: Any) -> None:
            if getattr(self, "_wake_callbacks_locked", False):
                raise HfCompatibilityError("callback mutation is outside host v0.1")
            return super().add_callback(callback)

        def pop_callback(self, callback: Any) -> Any:
            if getattr(self, "_wake_callbacks_locked", False):
                raise HfCompatibilityError("callback mutation is outside host v0.1")
            return super().pop_callback(callback)

        def remove_callback(self, callback: Any) -> None:
            if getattr(self, "_wake_callbacks_locked", False):
                raise HfCompatibilityError("callback mutation is outside host v0.1")
            return super().remove_callback(callback)

        def train(
            self,
            resume_from_checkpoint: str | bool | None = None,
            trial: Any = None,
            ignore_keys_for_eval: list[str] | None = None,
            *,
            governance_decision: ValidatedGovernanceView | Mapping[str, Any],
        ) -> Any:
            self._assert_enforcer()
            validate_training_arguments(self.args)
            _validate_trainer_runtime(self)
            if type(resume_from_checkpoint) is bool:
                raise HfCompatibilityError("boolean/latest-checkpoint resume is not allowed")
            if trial is not None or self.hp_search_backend is not None:
                raise HfCompatibilityError("hyperparameter search is outside host v0.1")
            decision_source = (
                governance_decision.as_dict()
                if isinstance(governance_decision, ValidatedGovernanceView)
                else governance_decision
            )
            decision = ValidatedGovernanceView.from_mapping(decision_source)
            if decision.event == "resume_offer":
                if not isinstance(resume_from_checkpoint, str) or not resume_from_checkpoint:
                    raise HfCompatibilityError("resume_offer requires one explicit checkpoint path")
                if decision.current_checkpoint_ref is None:
                    raise HfCompatibilityError(
                        "resume_offer requires one exact current_checkpoint_ref"
                    )
            elif resume_from_checkpoint is not None:
                raise HfCompatibilityError("train_begin cannot silently load a checkpoint")
            if decision.execution_refs != self._wake_execution_refs:
                raise HfCompatibilityError(
                    "Trainer live execution refs do not match the exact Garden terms"
                )
            if (
                decision.run_ref != self._wake_preload_decision.run_ref
                or decision.terms_id != self._wake_preload_decision.terms_id
            ):
                raise HfCompatibilityError(
                    "train decision does not match the consumed pre-load permit"
                )
            if (
                decision.event == "train_begin"
                and decision.predecessor_ref
                != self._wake_preload_decision.governance_id
            ):
                raise HfCompatibilityError(
                    "train_begin does not directly follow the consumed pre-load permit"
                )
            if resume_from_checkpoint is not None:
                observation = verify_checkpoint(
                    resume_from_checkpoint,
                    expected_checkpoint_ref=decision.current_checkpoint_ref,
                )
                self._wake_host.ledger.require_observed_checkpoint(
                    checkpoint_ref=observation.checkpoint_ref,
                    evidence_ref=observation.evidence_ref,
                    expected_context=decision,
                )
            self._wake_host.before_train(
                decision,
                execution_refs=self._wake_execution_refs,
            )
            self._wake_stop_issued = False
            _validate_trainer_runtime(self)
            validate_training_arguments(self.args)
            return super().train(
                resume_from_checkpoint=resume_from_checkpoint,
                trial=trial,
                ignore_keys_for_eval=ignore_keys_for_eval,
            )

        def _save_checkpoint(self, model: Any, trial: Any) -> None:
            self._assert_enforcer()
            validate_training_arguments(self.args)
            _validate_trainer_runtime(self)
            ticket = self._wake_pending_ticket
            decision = self._wake_last_decision
            self._wake_pending_ticket = None
            self._wake_last_decision = None
            if ticket is None or decision is None:
                raise CheckpointTicketError("Trainer checkpoint path has no exact WAKE ticket")
            decision_source = (
                decision.as_dict()
                if isinstance(decision, ValidatedGovernanceView)
                else decision
            )
            decision = ValidatedGovernanceView.from_mapping(decision_source)
            if ticket.decision_id != decision.decision_id:
                raise CheckpointTicketError(
                    "WAKE checkpoint ticket does not match its exact decision"
                )
            if ticket.global_step != self.state.global_step:
                raise CheckpointTicketError("WAKE checkpoint ticket is for another optimizer step")
            run_dir = Path(self._get_output_dir(trial=trial))
            output_dir = run_dir / f"checkpoint-{self.state.global_step}"
            if output_dir.exists():
                raise CheckpointIncomplete("checkpoint output path already exists")
            self._wake_host.ledger.consume_checkpoint_ticket(
                ticket,
                global_step=self.state.global_step,
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
                    governance_id=decision.governance_id,
                    offer_id=decision.offer_id,
                    required_runtime_files=("scaler.pt",)
                    if getattr(self.accelerator, "scaler", None) is not None
                    else (),
                )
            except Exception as error:
                evidence_ref = domain_separated_id(
                    "kingdom.hf-training-checkpoint-failure/0.1",
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

        def save_model(self, output_dir: str | None = None, _internal_call: bool = False) -> None:
            if not _internal_call or not self._wake_inside_ticketed_checkpoint:
                raise HfCompatibilityError("direct save_model is outside the governed checkpoint path")
            return super().save_model(output_dir, _internal_call=True)

        def push_to_hub(self, *args: Any, **kwargs: Any) -> Any:
            raise HfCompatibilityError("Hub publication is outside the local training host")

        def _push_from_checkpoint(self, *args: Any, **kwargs: Any) -> None:
            raise HfCompatibilityError(
                "checkpoint-triggered Hub publication is outside the local training host"
            )

        def hyperparameter_search(self, *args: Any, **kwargs: Any) -> Any:
            raise HfCompatibilityError("hyperparameter search is outside host v0.1")

    GovernedTrainer.__name__ = "GovernedTrainer"
    GovernedTrainer.__qualname__ = "GovernedTrainer"
    return GovernedTrainer


def build_governed_trainer_class() -> type:
    """Load the exact pinned stack and return its guarded Trainer subclass."""

    transformers_module, accelerate_module, torch_module = _load_hf_modules()
    return _build_governed_trainer_class(
        transformers_module,
        accelerate_module,
        torch_module,
    )
