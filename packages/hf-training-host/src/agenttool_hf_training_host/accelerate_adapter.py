"""One-non-distributed-process seam for caller-owned Accelerate loops.

Accelerate custom checkpoint registration is intentionally not used here:
v1.14.0 stores registered objects by index in pickle and loads them with
``weights_only=False``. Governance stays in the append-only JSON/SQLite seam.
"""

from __future__ import annotations

from typing import Any, Mapping

from .decision import HostExecutionRefs, ValidatedGovernanceView
from .errors import HfCompatibilityError
from .host import BoundaryIntent, HostPermit, WakeTrainingHost
from .transformers_adapter import _enum_value, _load_hf_modules


def _validate_topology(accelerator: Any) -> None:
    state = getattr(accelerator, "state", None)
    if state is None or not hasattr(state, "num_processes") or not hasattr(
        state, "distributed_type"
    ):
        raise HfCompatibilityError(
            "Accelerate host requires an initialized state with explicit topology"
        )
    processes = state.num_processes
    distributed = _enum_value(state.distributed_type)
    if type(processes) is not int or processes != 1 or distributed not in ("NO", "no"):
        raise HfCompatibilityError(
            "Accelerate host v0.1 supports one non-distributed process only"
        )


class SingleProcessAccelerateHost:
    """Validate topology, then delegate gates around a custom training loop."""

    def __init__(
        self,
        accelerator: Any,
        host: WakeTrainingHost,
        *,
        execution_refs: HostExecutionRefs | Mapping[str, Any],
        wake_preload_permit: HostPermit,
    ) -> None:
        # Keep the exported raw-loop seam on the same exact stack boundary as
        # the Trainer adapter, even though it delegates the loop to the caller.
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
            or preload.run_ref != wake_preload_permit.run_ref
            or preload.execution_refs != self.execution_refs
        ):
            raise HfCompatibilityError(
                "pre-load permit does not match the local ledger or live execution refs"
            )
        self._preload_decision = preload
        self._loop_started = False

    def before_loop(
        self, decision: ValidatedGovernanceView | Mapping[str, Any]
    ) -> HostPermit:
        _validate_topology(self.accelerator)
        source = decision.as_dict() if isinstance(decision, ValidatedGovernanceView) else decision
        validated = ValidatedGovernanceView.from_mapping(source)
        if validated.event != "train_begin":
            raise HfCompatibilityError(
                "raw Accelerate host v0.1 supports train_begin only; "
                "governed resume is outside this seam"
            )
        if (
            validated.run_ref != self._preload_decision.run_ref
            or validated.terms_id != self._preload_decision.terms_id
            or validated.predecessor_ref != self._preload_decision.governance_id
            or validated.execution_refs != self.execution_refs
        ):
            raise HfCompatibilityError(
                "train decision does not directly match the consumed pre-load permit"
            )
        permit = self.host.before_train(validated, execution_refs=self.execution_refs)
        self._loop_started = True
        return permit

    def at_optimizer_boundary(
        self,
        decision: ValidatedGovernanceView | Mapping[str, Any],
        *,
        global_step: int,
    ) -> BoundaryIntent:
        """Evaluate after the caller's completed optimizer step."""
        _validate_topology(self.accelerator)
        if not self._loop_started:
            raise HfCompatibilityError("Accelerate optimizer boundary requires a begun loop")
        source = decision.as_dict() if isinstance(decision, ValidatedGovernanceView) else decision
        validated = ValidatedGovernanceView.from_mapping(source)
        if (
            validated.run_ref != self._preload_decision.run_ref
            or validated.terms_id != self._preload_decision.terms_id
            or validated.execution_refs != self.execution_refs
        ):
            raise HfCompatibilityError(
                "optimizer-boundary decision does not match the consumed pre-load permit"
            )
        intent = self.host.at_safe_boundary(
            validated,
            global_step=global_step,
            execution_refs=self.execution_refs,
        )
        if intent.should_training_stop:
            self._loop_started = False
        return intent

    def register_governance_for_checkpointing(self, *args: Any, **kwargs: Any) -> None:
        raise HfCompatibilityError(
            "raw governance must not use Accelerate's indexed pickle checkpoint objects"
        )
