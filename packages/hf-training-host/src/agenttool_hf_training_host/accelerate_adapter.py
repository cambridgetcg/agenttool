"""Cooperative v0.2 seam for one caller-owned, non-distributed loop.

Only work executed inside :meth:`guarded_mutation` is covered.  Retaining the
Accelerator or optimizer and calling clip/unscale/step/scheduler APIs directly
is an explicit bypass outside this cooperative threat model.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Mapping, TypeVar

from .decision import HostExecutionRefs, ValidatedGovernanceView
from .errors import HfCompatibilityError, MutationUnitFailed
from .host import BoundaryIntent, HostPermit, WakeTrainingHost
from .transformers_adapter import _enum_value, _load_hf_modules

_T = TypeVar("_T")


def _validate_topology(accelerator: Any) -> None:
    state = getattr(accelerator, "state", None)
    if state is None or not hasattr(state, "num_processes") or not hasattr(
        state, "distributed_type"
    ):
        raise HfCompatibilityError(
            "Accelerate host requires initialized state with explicit topology"
        )
    processes = state.num_processes
    distributed = _enum_value(state.distributed_type)
    if type(processes) is not int or processes != 1 or distributed not in ("NO", "no"):
        raise HfCompatibilityError(
            "Accelerate host v0.2 supports one non-distributed process only"
        )


class SingleProcessAccelerateHost:
    """Guard a caller-owned mutation unit, then accept its post receipt."""

    def __init__(
        self,
        accelerator: Any,
        host: WakeTrainingHost,
        *,
        execution_refs: HostExecutionRefs | Mapping[str, Any],
        wake_preload_permit: HostPermit,
    ) -> None:
        _load_hf_modules()
        _validate_topology(accelerator)
        self.accelerator = accelerator
        self.host = host
        source = (
            execution_refs.as_dict()
            if isinstance(execution_refs, HostExecutionRefs)
            else execution_refs
        )
        self.execution_refs = HostExecutionRefs.from_mapping(source)
        if not isinstance(wake_preload_permit, HostPermit):
            raise HfCompatibilityError("Accelerate host requires one local pre-load permit")
        preload = self.host.ledger.require_action_claim(
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
            or preload.execution_refs != self.execution_refs
        ):
            raise HfCompatibilityError(
                "pre-load permit does not match the local ledger or live execution refs"
            )
        self._preload_decision = preload
        self._loop_started = False
        self._pending_mutation: HostPermit | None = None
        self._failure_latch: str | None = None

    def before_loop(
        self, decision: ValidatedGovernanceView | Mapping[str, Any]
    ) -> HostPermit:
        _validate_topology(self.accelerator)
        source = decision.as_dict() if isinstance(decision, ValidatedGovernanceView) else decision
        validated = ValidatedGovernanceView.from_mapping(source)
        if validated.event != "train_begin":
            raise HfCompatibilityError(
                "raw Accelerate v0.2 supports a fresh train_begin only; resume is outside this seam"
            )
        if (
            validated.run_ref != self._preload_decision.run_ref
            or validated.execution_contract_id
            != self._preload_decision.execution_contract_id
            or validated.execution_refs != self.execution_refs
        ):
            raise HfCompatibilityError(
                "train decision does not match the consumed pre-load contract"
            )
        self.host.require_preload_lineage(
            validated,
            preload=self._preload_decision,
        )
        permit = self.host.before_train(validated, execution_refs=self.execution_refs)
        self._loop_started = True
        return permit

    def guarded_mutation(
        self,
        decision: ValidatedGovernanceView | Mapping[str, Any],
        *,
        current_global_step: int,
        mutation: Callable[[], _T],
    ) -> _T:
        """Wrap clip/unscale, optimizer, scaler, scheduler, and step increment.

        The callable is one non-atomic unit.  A failure after its permit is
        durable evidence of partial execution; this adapter latches closed.
        """

        _validate_topology(self.accelerator)
        if self._failure_latch is not None:
            raise MutationUnitFailed(self._failure_latch)
        if not self._loop_started:
            raise HfCompatibilityError("guarded mutation requires a begun loop")
        if self._pending_mutation is not None:
            raise HfCompatibilityError(
                "the prior mutation still requires its post_optimizer_step receipt"
            )
        permit = self.host.before_optimizer_step(
            decision,
            current_global_step=current_global_step,
            execution_refs=self.execution_refs,
        )
        try:
            result = mutation()
        except Exception as error:
            self._failure_latch = (
                "a claimed caller-owned mutation unit failed non-atomically "
                f"({type(error).__name__})"
            )
            self._loop_started = False
            raise MutationUnitFailed(self._failure_latch) from error
        self._pending_mutation = permit
        return result

    def post_optimizer_boundary(
        self,
        decision: ValidatedGovernanceView | Mapping[str, Any],
        *,
        global_step: int,
    ) -> BoundaryIntent:
        """Record post-mutation evidence; this never authorizes past work."""

        _validate_topology(self.accelerator)
        permit = self._pending_mutation
        if permit is None:
            raise HfCompatibilityError(
                "post_optimizer_boundary is receipt-only and has no guarded mutation"
            )
        if permit.proposed_global_step != global_step:
            self._failure_latch = "caller-owned mutation did not report its proposed global step"
            self._loop_started = False
            raise MutationUnitFailed(self._failure_latch)
        try:
            intent = self.host.after_optimizer_step(
                decision,
                global_step=global_step,
                execution_refs=self.execution_refs,
            )
        except Exception as error:
            self._failure_latch = (
                "a completed caller-owned mutation failed before its post receipt "
                f"({type(error).__name__})"
            )
            self._loop_started = False
            raise MutationUnitFailed(self._failure_latch) from error
        self._pending_mutation = None
        if intent.should_training_stop:
            self._loop_started = False
        return intent

    def register_governance_for_checkpointing(self, *args: Any, **kwargs: Any) -> None:
        raise HfCompatibilityError(
            "raw governance must not use Accelerate's indexed pickle checkpoint objects"
        )
