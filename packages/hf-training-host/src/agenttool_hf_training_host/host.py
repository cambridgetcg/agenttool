"""Cooperative host gates around model loading, train(), and safe boundaries."""

from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Callable
from typing import Any, Mapping, TypeVar

from .decision import HostExecutionRefs, ValidatedGovernanceView
from .errors import DecisionInvalid, TrainingHeld
from .ledger import CheckpointTicket, ContinuityLedger, LedgerEntry

_T = TypeVar("_T")


@dataclass(frozen=True, slots=True)
class HostPermit:
    decision_id: str
    governance_id: str
    terms_id: str
    run_ref: str
    event: str
    ledger_sequence: int
    ledger_entry_hash: str


@dataclass(frozen=True, slots=True)
class BoundaryIntent:
    decision_id: str
    ledger_sequence: int
    should_save: bool
    should_training_stop: bool
    disposition: str
    checkpoint_ticket: CheckpointTicket | None


class WakeTrainingHost:
    """Turns validated views into local permits or conservative holds.

    The methods return intentions and ledger receipts only. They do not load a
    model, start training, write a checkpoint, broadcast across ranks, or prove
    that an external side effect occurred.
    """

    def __init__(self, ledger: ContinuityLedger) -> None:
        self.ledger = ledger

    @staticmethod
    def _decision(value: ValidatedGovernanceView | Mapping[str, Any]) -> ValidatedGovernanceView:
        source = value.as_dict() if isinstance(value, ValidatedGovernanceView) else value
        return ValidatedGovernanceView.from_mapping(source)

    @staticmethod
    def _require_execution_refs(
        decision: ValidatedGovernanceView,
        value: HostExecutionRefs | Mapping[str, Any],
    ) -> HostExecutionRefs:
        source = value.as_dict() if isinstance(value, HostExecutionRefs) else value
        observed = HostExecutionRefs.from_mapping(source)
        if observed != decision.execution_refs:
            raise DecisionInvalid(
                "caller-attested live execution refs do not match the exact Garden terms"
            )
        return observed

    @staticmethod
    def _permit(decision: ValidatedGovernanceView, entry: LedgerEntry) -> HostPermit:
        return HostPermit(
            decision_id=decision.decision_id,
            governance_id=decision.governance_id,
            terms_id=decision.terms_id,
            run_ref=decision.run_ref,
            event=decision.event,
            ledger_sequence=entry.sequence,
            ledger_entry_hash=entry.entry_hash,
        )

    def before_load(
        self,
        value: ValidatedGovernanceView | Mapping[str, Any],
        *,
        execution_refs: HostExecutionRefs | Mapping[str, Any],
    ) -> HostPermit:
        decision = self._decision(value)
        self._require_execution_refs(decision, execution_refs)
        if decision.event != "preflight_before_load":
            raise DecisionInvalid("before_load requires a preflight_before_load decision")
        entry = self.ledger.record(decision, request_action=True)
        if not entry.action_authorized or decision.control.directive != "eligible_for_host_training_offer":
            raise TrainingHeld(
                "model and dataset load remain held",
                decision_id=decision.decision_id,
                disposition=entry.disposition,
            )
        if not self.ledger.claim_action(entry):
            raise TrainingHeld(
                "model and dataset load decision was already consumed",
                decision_id=decision.decision_id,
                disposition="held_exact_replay",
            )
        return self._permit(decision, entry)

    def before_train(
        self,
        value: ValidatedGovernanceView | Mapping[str, Any],
        *,
        execution_refs: HostExecutionRefs | Mapping[str, Any],
    ) -> HostPermit:
        decision = self._decision(value)
        self._require_execution_refs(decision, execution_refs)
        if decision.event not in {"train_begin", "resume_offer"}:
            raise DecisionInvalid("before_train requires a train_begin or resume_offer decision")
        entry = self.ledger.record(decision, request_action=True)
        if not entry.action_authorized or decision.control.directive != "continue_under_exact_offer":
            raise TrainingHeld(
                "Trainer.train() remains held",
                decision_id=decision.decision_id,
                disposition=entry.disposition,
            )
        if not self.ledger.claim_action(entry):
            raise TrainingHeld(
                "Trainer.train() decision was already consumed",
                decision_id=decision.decision_id,
                disposition="held_exact_replay",
            )
        return self._permit(decision, entry)

    def recover_preload_permit(self, decision_id: str) -> HostPermit:
        """Reconstruct an already-consumed local pre-load receipt after restart."""

        decision, entry = self.ledger.claimed_entry(
            decision_id=decision_id,
            expected_disposition="authorized_preload",
        )
        if (
            decision.event != "preflight_before_load"
            or decision.control.directive != "eligible_for_host_training_offer"
        ):
            raise DecisionInvalid("claimed receipt is not an exact pre-load permit")
        return self._permit(decision, entry)

    def at_safe_boundary(
        self,
        value: ValidatedGovernanceView | Mapping[str, Any],
        *,
        global_step: int,
        execution_refs: HostExecutionRefs | Mapping[str, Any],
    ) -> BoundaryIntent:
        decision = self._decision(value)
        self._require_execution_refs(decision, execution_refs)
        if decision.event not in {"step_boundary", "evaluation_boundary"}:
            raise DecisionInvalid("safe-boundary control requires a step or evaluation decision")
        if (
            type(global_step) is not int
            or not 0 <= global_step <= 9_007_199_254_740_991
            or decision.boundary_global_step != global_step
        ):
            raise DecisionInvalid(
                "safe-boundary decision does not bind the current non-negative global step"
            )
        entry = self.ledger.record(decision, request_action=True)
        claimed = entry.action_authorized and self.ledger.claim_action(entry)
        disposition = entry.disposition if claimed or not entry.action_authorized else "held_exact_replay"
        if claimed and decision.control.directive == "continue_under_exact_offer":
            save, stop = False, False
            ticket = None
        elif (
            claimed
            and decision.control.directive == "checkpoint_then_stop_at_safe_boundary"
        ):
            save, stop = True, True
            ticket = self.ledger.issue_checkpoint_ticket(
                decision,
                entry,
                global_step=global_step,
            )
        else:
            # Uncertainty, replay, stale state, forks, and explicit holds all
            # fail toward stopping. An unverified checkpoint is never added.
            save, stop = False, True
            ticket = None
        return BoundaryIntent(
            decision_id=decision.decision_id,
            ledger_sequence=entry.sequence,
            should_save=save,
            should_training_stop=stop,
            disposition=disposition,
            checkpoint_ticket=ticket,
        )

    def record_terminal_receipt(
        self, value: ValidatedGovernanceView | Mapping[str, Any]
    ) -> LedgerEntry:
        decision = self._decision(value)
        if decision.event not in {"checkpoint_saved", "train_end"}:
            raise DecisionInvalid("terminal receipt requires checkpoint_saved or train_end")
        if decision.event == "checkpoint_saved":
            if (
                decision.effect.state != "checkpointed_and_paused_reported"
                or decision.effect.checkpoint_ref is None
                or decision.effect.evidence_ref is None
                or decision.effect.global_step is None
                or decision.current_checkpoint_ref != decision.effect.checkpoint_ref
            ):
                raise DecisionInvalid(
                    "checkpoint_saved requires exact checkpoint, evidence, and global-step refs"
                )
            self.ledger.require_observed_checkpoint(
                checkpoint_ref=decision.effect.checkpoint_ref,
                evidence_ref=decision.effect.evidence_ref,
                global_step=decision.effect.global_step,
                expected_context=decision,
                expected_checkpoint_request_ref=decision.predecessor_ref,
            )
        return self.ledger.record(decision, request_action=False)


def guarded_call_before_load(
    host: WakeTrainingHost,
    decision: ValidatedGovernanceView | Mapping[str, Any],
    execution_refs: HostExecutionRefs | Mapping[str, Any],
    loader: Callable[..., _T],
    /,
    *args: Any,
    **kwargs: Any,
) -> _T:
    """Call a model/dataset loader only after the outside-load gate passes."""

    host.before_load(decision, execution_refs=execution_refs)
    return loader(*args, **kwargs)
