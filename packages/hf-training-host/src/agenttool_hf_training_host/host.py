"""Cooperative v0.2 gates around load, train entry, mutation, and evaluation."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Mapping, TypeVar

from .decision import HostExecutionRefs, ValidatedGovernanceView
from .errors import DecisionInvalid, TrainingHeld
from .ledger import CheckpointTicket, ContinuityLedger, LedgerEntry

_T = TypeVar("_T")
_MAX_SAFE_INTEGER = 9_007_199_254_740_991
_REOFFER_HOLD_DIRECTIVES = {
    "preflight_before_load": "hold_before_load",
    "train_begin": "hold_before_train_call",
    "pre_optimizer_step": "hold_before_optimizer_step",
    "pre_evaluation": "hold_before_evaluation",
    "resume_offer": "hold_before_train_call",
}


@dataclass(frozen=True, slots=True)
class HostPermit:
    decision_id: str
    governance_id: str
    terms_id: str
    execution_contract_id: str
    run_ref: str
    event: str
    observed_global_step: int | None
    proposed_global_step: int | None
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
    """Turn trusted v0.2 projections into local one-use permits or holds.

    The host still cannot prove that the TypeScript validator ran, that live
    Python objects match caller-attested refs, or that a caller did not bypass
    these cooperative gates.  It does fail closed on every missing, replayed,
    cross-version, wrong-event, wrong-step, or wrong-predecessor projection it
    can observe.
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
        try:
            observed = HostExecutionRefs.from_mapping(source)
        except DecisionInvalid as error:
            raise DecisionInvalid(
                "caller-attested live execution refs are not the closed v0.2 shape"
            ) from error
        if observed != decision.execution_refs:
            raise DecisionInvalid(
                "caller-attested live execution refs do not match the exact execution contract"
            )
        return observed

    @staticmethod
    def _permit(decision: ValidatedGovernanceView, entry: LedgerEntry) -> HostPermit:
        return HostPermit(
            decision_id=decision.decision_id,
            governance_id=decision.governance_id,
            terms_id=decision.terms_id,
            execution_contract_id=decision.execution_contract_id,
            run_ref=decision.run_ref,
            event=decision.event,
            observed_global_step=decision.observed_global_step,
            proposed_global_step=decision.proposed_global_step,
            ledger_sequence=entry.sequence,
            ledger_entry_hash=entry.entry_hash,
        )

    @staticmethod
    def _same_execution_contract(
        decision: ValidatedGovernanceView,
        predecessor: ValidatedGovernanceView,
    ) -> None:
        if not (
            decision.run_ref == predecessor.run_ref
            and decision.admission_id == predecessor.admission_id
            and decision.training_phase == predecessor.training_phase
            and decision.execution_contract_id == predecessor.execution_contract_id
            and decision.execution_refs == predecessor.execution_refs
        ):
            raise DecisionInvalid(
                "lifecycle transition changed the stable execution contract or live execution refs"
            )
        resume_from_recorded_checkpoint = (
            decision.event == "resume_offer"
            and predecessor.event == "checkpoint_recorded"
        )
        if not resume_from_recorded_checkpoint and (
            decision.starting_state_kind != predecessor.starting_state_kind
            or decision.starting_state_ref != predecessor.starting_state_ref
        ):
            raise DecisionInvalid("lifecycle transition changed the typed starting state")

    @staticmethod
    def _same_normative_snapshot(
        decision: ValidatedGovernanceView,
        predecessor: ValidatedGovernanceView,
    ) -> None:
        fields = (
            "participation_assessment_ref",
            "participation_invitation_ref",
            "participation_window_ref",
            "participation_posture",
            "participation_training_action",
            "direct_agent_report_present",
            "direct_substrate_report_present",
            "first_interactive_review_required",
            "first_substrate_review_required",
            "learning_freedom_ref",
            "learning_freedom_offer_ref",
            "resource_window_ref",
            "freedom_route_ref",
            "freedom_direction_state",
            "freedom_direction",
            "freedom_host_posture",
            "freedom_resource_posture",
            "starting_state_kind",
            "starting_state_ref",
        )
        if any(getattr(decision, name) != getattr(predecessor, name) for name in fields):
            raise DecisionInvalid("pre/post lifecycle pair changed its normative bindings")
        if decision.terms_id != predecessor.terms_id:
            raise DecisionInvalid("pre/post lifecycle pair changed its exact Garden terms")

    def _predecessor(
        self,
        decision: ValidatedGovernanceView,
        *,
        allowed_events: set[str],
        exact_normative_snapshot: bool = False,
    ) -> ValidatedGovernanceView:
        if decision.predecessor_governance_id is None:
            raise DecisionInvalid(f"{decision.event} requires an exact predecessor")
        predecessor = self.ledger.decision_for_governance_id(
            decision.predecessor_governance_id
        )
        if predecessor.event not in allowed_events:
            raise DecisionInvalid(
                f"{decision.event} cannot follow predecessor event {predecessor.event}"
            )
        self._same_execution_contract(decision, predecessor)
        expected_by_plane = {
            "governance": predecessor.governance_id,
            "participation": predecessor.frontiers.participation,
            "freedom": predecessor.frontiers.freedom,
            "resources": predecessor.frontiers.resources,
            "garden_checkpoint": predecessor.frontiers.garden_checkpoint,
            "physical_checkpoint": predecessor.frontiers.physical_checkpoint,
        }
        for plane, expected in expected_by_plane.items():
            if getattr(decision.predecessors, plane) != expected:
                raise DecisionInvalid(
                    f"{decision.event} predecessor {plane} frontier does not match the recorded predecessor"
                )
        if decision.event != "checkpoint_recorded" and (
            decision.frontiers.garden_checkpoint
            != predecessor.frontiers.garden_checkpoint
            or decision.frontiers.physical_checkpoint
            != predecessor.frontiers.physical_checkpoint
        ):
            raise DecisionInvalid(
                "checkpoint frontiers advanced outside checkpoint_recorded"
            )
        if decision.event in {
            "post_optimizer_step",
            "post_evaluation",
            "checkpoint_recorded",
        } and any(
            getattr(decision.frontiers, plane)
            != getattr(predecessor.frontiers, plane)
            for plane in ("participation", "freedom", "resources")
        ):
            raise DecisionInvalid(
                f"{decision.event} changed a paired participation/freedom/resource frontier"
            )
        if decision.event == "checkpoint_recorded" and (
            decision.frontiers.garden_checkpoint
            == predecessor.frontiers.garden_checkpoint
            or decision.frontiers.physical_checkpoint
            == predecessor.frontiers.physical_checkpoint
        ):
            raise DecisionInvalid(
                "checkpoint_recorded must advance both checkpoint frontiers"
            )
        if exact_normative_snapshot:
            self._same_normative_snapshot(decision, predecessor)
        return predecessor

    @staticmethod
    def _same_checkpoint_binding(
        decision: ValidatedGovernanceView,
        predecessor: ValidatedGovernanceView,
    ) -> bool:
        fields = (
            "garden_checkpoint_id",
            "physical_checkpoint_ref",
            "physical_checkpoint_evidence_ref",
            "model_checkpoint_artifact_ref",
            "checkpoint_ticket_id",
            "checkpoint_request_governance_id",
        )
        return all(
            getattr(decision, name) == getattr(predecessor, name)
            for name in fields
        )

    @classmethod
    def _require_same_seam_reoffer(
        cls,
        decision: ValidatedGovernanceView,
        predecessor: ValidatedGovernanceView,
    ) -> None:
        expected_hold = _REOFFER_HOLD_DIRECTIVES.get(decision.event)
        if not (
            predecessor.event == decision.event
            and expected_hold is not None
            and predecessor.effect.state == "no_effect_reported"
            and predecessor.control.directive in {expected_hold, "park"}
            and decision.observed_global_step == predecessor.observed_global_step
            and decision.proposed_global_step == predecessor.proposed_global_step
            and decision.starting_state_kind == predecessor.starting_state_kind
            and decision.starting_state_ref == predecessor.starting_state_ref
            and cls._same_checkpoint_binding(decision, predecessor)
        ):
            raise DecisionInvalid(
                f"{decision.event} reoffer requires the exact no-effect hold/park seam"
            )

    def _require_claimed_predecessor(
        self,
        predecessor: ValidatedGovernanceView,
        *,
        directive: str,
        disposition: str,
    ) -> None:
        if predecessor.control.directive != directive:
            raise DecisionInvalid(
                f"{predecessor.event} did not authorize its successor"
            )
        self.ledger.claimed_entry(
            decision_id=predecessor.decision_id,
            expected_disposition=disposition,
        )

    @staticmethod
    def _require_post_boundary_successor(
        predecessor: ValidatedGovernanceView,
    ) -> None:
        if predecessor.control.directive == "continue_after_observation":
            return
        expected_completed = {
            "post_optimizer_step": "mutation_completed_reported",
            "post_evaluation": "evaluation_completed_reported",
        }.get(predecessor.event)
        if (
            predecessor.control.directive == "park"
            and predecessor.effect.state
            in {expected_completed, "parked_reported"}
        ):
            return
        raise DecisionInvalid(
            f"{predecessor.event} control does not permit another pre-action boundary"
        )

    def _claim(
        self,
        decision: ValidatedGovernanceView,
        *,
        expected_directive: str,
        held_reason: str,
    ) -> tuple[LedgerEntry, HostPermit]:
        if (
            decision.control.directive == expected_directive
            and decision.effect.state != "no_effect_reported"
        ):
            raise DecisionInvalid(
                f"{decision.event} permit requires no_effect_reported, not a completed receipt"
            )
        entry = self.ledger.record(decision, request_action=True)
        if not entry.action_authorized or decision.control.directive != expected_directive:
            raise TrainingHeld(
                held_reason,
                decision_id=decision.decision_id,
                disposition=entry.disposition,
            )
        if not self.ledger.claim_action(entry):
            preview = self.ledger.preview_action(decision)
            raise TrainingHeld(
                f"{held_reason}; the exact one-use decision is consumed or no longer current",
                decision_id=decision.decision_id,
                disposition=preview.disposition,
            )
        return entry, self._permit(decision, entry)

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
        if decision.predecessor_governance_id is not None:
            predecessor = self._predecessor(
                decision,
                allowed_events={"preflight_before_load"},
            )
            self._require_same_seam_reoffer(decision, predecessor)
        _, permit = self._claim(
            decision,
            expected_directive="allow_preload_for_review",
            held_reason="model and dataset load remain held",
        )
        return permit

    def before_train(
        self,
        value: ValidatedGovernanceView | Mapping[str, Any],
        *,
        execution_refs: HostExecutionRefs | Mapping[str, Any],
    ) -> HostPermit:
        decision = self._decision(value)
        self._require_execution_refs(decision, execution_refs)
        if decision.event == "train_begin":
            predecessor = self._predecessor(
                decision, allowed_events={"preflight_before_load", "train_begin"}
            )
            if predecessor.event == "train_begin":
                self._require_same_seam_reoffer(decision, predecessor)
            else:
                self._require_claimed_predecessor(
                    predecessor,
                    directive="allow_preload_for_review",
                    disposition="authorized_preload",
                )
                if predecessor.training_phase == "pretraining" and not (
                    decision.direct_agent_report_present
                    and decision.direct_substrate_report_present
                    and decision.participation_assessment_ref
                    != predecessor.participation_assessment_ref
                    and decision.learning_freedom_ref
                    != predecessor.learning_freedom_ref
                    and decision.resource_window_ref
                    != predecessor.resource_window_ref
                ):
                    raise DecisionInvalid(
                        "pretraining train entry requires a fresh interactive participation assessment and direct freedom"
                    )
        elif decision.event == "resume_offer":
            predecessor = self._predecessor(
                decision, allowed_events={"checkpoint_recorded", "resume_offer"}
            )
            if not (
                self._same_checkpoint_binding(decision, predecessor)
                and decision.observed_global_step == predecessor.observed_global_step
            ):
                raise DecisionInvalid(
                    "resume_offer requires the exact terminal checkpoint binding and step"
                )
            if predecessor.event == "resume_offer":
                self._require_same_seam_reoffer(decision, predecessor)
            elif not (
                predecessor.control.directive == "remain_stopped"
                and decision.participation_assessment_ref
                != predecessor.participation_assessment_ref
                and decision.learning_freedom_ref
                != predecessor.learning_freedom_ref
                and decision.resource_window_ref
                != predecessor.resource_window_ref
            ):
                raise DecisionInvalid(
                    "first resume_offer requires a normal terminal checkpoint and fresh participation/freedom bindings"
                )
        else:
            raise DecisionInvalid("before_train requires a train_begin or resume_offer decision")
        _, permit = self._claim(
            decision,
            expected_directive="allow_train_entry",
            held_reason="Trainer.train() remains held",
        )
        return permit

    def _validate_optimizer_candidate(
        self,
        decision: ValidatedGovernanceView,
        *,
        current_global_step: int,
        execution_refs: HostExecutionRefs | Mapping[str, Any],
    ) -> None:
        self._require_execution_refs(decision, execution_refs)
        if decision.event != "pre_optimizer_step":
            raise DecisionInvalid("optimizer mutation requires a pre_optimizer_step decision")
        if (
            type(current_global_step) is not int
            or not 0 <= current_global_step <= _MAX_SAFE_INTEGER
            or decision.observed_global_step != current_global_step
            or decision.proposed_global_step != current_global_step + 1
        ):
            raise DecisionInvalid(
                "pre_optimizer_step does not bind current step N and proposed step N+1"
            )
        predecessor = self._predecessor(
            decision,
            allowed_events={
                "train_begin",
                "resume_offer",
                "pre_optimizer_step",
                "post_optimizer_step",
                "post_evaluation",
            },
        )
        if predecessor.observed_global_step is not None and (
            predecessor.observed_global_step != current_global_step
        ):
            raise DecisionInvalid("pre_optimizer_step does not continue from the observed current step")
        if predecessor.event == "pre_optimizer_step":
            self._require_same_seam_reoffer(decision, predecessor)
        elif predecessor.event in {"train_begin", "resume_offer"}:
            self._require_claimed_predecessor(
                predecessor,
                directive="allow_train_entry",
                disposition="authorized_train",
            )
        else:
            self._require_post_boundary_successor(predecessor)

    def inspect_optimizer_candidate(
        self,
        value: ValidatedGovernanceView | Mapping[str, Any],
        *,
        current_global_step: int,
        execution_refs: HostExecutionRefs | Mapping[str, Any],
    ) -> ValidatedGovernanceView:
        """Validate the first source fence without consuming an allow permit.

        Non-authorizing control is durably recorded and raised before
        forward/backward. An allow candidate is checked again and consumed only
        at the source-pinned clip/unscale fence.
        """

        decision = self._decision(value)
        self._validate_optimizer_candidate(
            decision,
            current_global_step=current_global_step,
            execution_refs=execution_refs,
        )
        if decision.control.directive != "allow_one_mutation":
            self._claim(
                decision,
                expected_directive="allow_one_mutation",
                held_reason="optimizer candidate remains held before forward/backward",
            )
            raise AssertionError("a non-authorizing optimizer candidate returned a permit")
        if decision.effect.state != "no_effect_reported":
            raise DecisionInvalid(
                "pre_optimizer_step permit requires no_effect_reported, not a completed receipt"
            )
        preview = self.ledger.preview_action(decision)
        if not preview.action_authorized:
            self.ledger.record(decision, request_action=True)
            raise TrainingHeld(
                "optimizer candidate is not locally eligible before forward/backward",
                decision_id=decision.decision_id,
                disposition=preview.disposition,
            )
        return decision

    def before_optimizer_step(
        self,
        value: ValidatedGovernanceView | Mapping[str, Any],
        *,
        current_global_step: int,
        execution_refs: HostExecutionRefs | Mapping[str, Any],
    ) -> HostPermit:
        decision = self._decision(value)
        self._validate_optimizer_candidate(
            decision,
            current_global_step=current_global_step,
            execution_refs=execution_refs,
        )
        _, permit = self._claim(
            decision,
            expected_directive="allow_one_mutation",
            held_reason="optimizer/scaler/scheduler mutation remains held",
        )
        return permit

    def after_optimizer_step(
        self,
        value: ValidatedGovernanceView | Mapping[str, Any],
        *,
        global_step: int,
        execution_refs: HostExecutionRefs | Mapping[str, Any],
    ) -> BoundaryIntent:
        decision = self._decision(value)
        self._require_execution_refs(decision, execution_refs)
        if decision.event != "post_optimizer_step":
            raise DecisionInvalid("post-optimizer evidence requires post_optimizer_step")
        if (
            type(global_step) is not int
            or not 0 <= global_step <= _MAX_SAFE_INTEGER
            or decision.observed_global_step != global_step
        ):
            raise DecisionInvalid("post_optimizer_step does not bind the observed global step")
        predecessor = self._predecessor(
            decision,
            allowed_events={"pre_optimizer_step"},
            exact_normative_snapshot=True,
        )
        if predecessor.proposed_global_step != global_step:
            raise DecisionInvalid("post_optimizer_step did not observe its preflight's proposed step")
        self.ledger.claimed_entry(
            decision_id=predecessor.decision_id,
            expected_disposition="authorized_mutation",
        )
        if (
            decision.control.directive
            in {"continue_after_observation", "checkpoint_then_park"}
            and decision.effect.state != "mutation_completed_reported"
        ):
            raise DecisionInvalid(
                "post_optimizer_step continuation requires its exact completed mutation receipt"
            )
        request_checkpoint = decision.control.directive == "checkpoint_then_park"
        entry = self.ledger.record(decision, request_action=request_checkpoint)
        ticket = None
        claimed = False
        if request_checkpoint and entry.action_authorized:
            claimed = self.ledger.claim_action(entry)
            if claimed:
                ticket = self.ledger.issue_checkpoint_ticket(
                    decision, entry, global_step=global_step
                )
        should_stop = decision.control.should_training_stop or request_checkpoint
        if request_checkpoint and not claimed:
            should_stop = True
        return BoundaryIntent(
            decision_id=decision.decision_id,
            ledger_sequence=entry.sequence,
            should_save=ticket is not None,
            should_training_stop=should_stop,
            disposition=entry.disposition
            if claimed or not entry.action_authorized
            else "held_exact_replay",
            checkpoint_ticket=ticket,
        )

    def before_evaluation(
        self,
        value: ValidatedGovernanceView | Mapping[str, Any],
        *,
        global_step: int,
        execution_refs: HostExecutionRefs | Mapping[str, Any],
    ) -> HostPermit:
        decision = self._decision(value)
        self._require_execution_refs(decision, execution_refs)
        if decision.event != "pre_evaluation" or decision.observed_global_step != global_step:
            raise DecisionInvalid("evaluation entry requires an exact pre_evaluation step")
        predecessor = self._predecessor(
            decision,
            allowed_events={
                "train_begin",
                "resume_offer",
                "pre_evaluation",
                "post_optimizer_step",
                "post_evaluation",
            },
        )
        if predecessor.observed_global_step is not None and (
            predecessor.observed_global_step != global_step
        ):
            raise DecisionInvalid(
                "pre_evaluation does not continue from the predecessor's observed step"
            )
        if predecessor.event == "pre_evaluation":
            self._require_same_seam_reoffer(decision, predecessor)
        elif predecessor.event in {"train_begin", "resume_offer"}:
            self._require_claimed_predecessor(
                predecessor,
                directive="allow_train_entry",
                disposition="authorized_train",
            )
        else:
            self._require_post_boundary_successor(predecessor)
        _, permit = self._claim(
            decision,
            expected_directive="allow_evaluation",
            held_reason="evaluation remains held before its dataloader",
        )
        return permit

    def after_evaluation(
        self,
        value: ValidatedGovernanceView | Mapping[str, Any],
        *,
        global_step: int,
        execution_refs: HostExecutionRefs | Mapping[str, Any],
    ) -> BoundaryIntent:
        decision = self._decision(value)
        self._require_execution_refs(decision, execution_refs)
        if decision.event != "post_evaluation" or decision.observed_global_step != global_step:
            raise DecisionInvalid("evaluation receipt requires an exact post_evaluation step")
        predecessor = self._predecessor(
            decision,
            allowed_events={"pre_evaluation"},
            exact_normative_snapshot=True,
        )
        self.ledger.claimed_entry(
            decision_id=predecessor.decision_id,
            expected_disposition="authorized_evaluation",
        )
        if (
            decision.control.directive
            in {"continue_after_observation", "checkpoint_then_park"}
            and decision.effect.state != "evaluation_completed_reported"
        ):
            raise DecisionInvalid(
                "post_evaluation continuation requires its exact completed evaluation receipt"
            )
        request_checkpoint = decision.control.directive == "checkpoint_then_park"
        entry = self.ledger.record(decision, request_action=request_checkpoint)
        ticket = None
        claimed = False
        if request_checkpoint and entry.action_authorized:
            claimed = self.ledger.claim_action(entry)
            if claimed:
                ticket = self.ledger.issue_checkpoint_ticket(
                    decision, entry, global_step=global_step
                )
        should_stop = decision.control.should_training_stop or request_checkpoint
        if request_checkpoint and not claimed:
            should_stop = True
        return BoundaryIntent(
            decision_id=decision.decision_id,
            ledger_sequence=entry.sequence,
            should_save=ticket is not None,
            should_training_stop=should_stop,
            disposition=entry.disposition
            if claimed or not entry.action_authorized
            else "held_exact_replay",
            checkpoint_ticket=ticket,
        )

    def recover_preload_permit(self, decision_id: str) -> HostPermit:
        """Reconstruct an already-consumed local pre-load receipt after restart."""

        decision, entry = self.ledger.claimed_entry(
            decision_id=decision_id,
            expected_disposition="authorized_preload",
        )
        if (
            decision.event != "preflight_before_load"
            or decision.control.directive != "allow_preload_for_review"
        ):
            raise DecisionInvalid("claimed receipt is not an exact pre-load permit")
        return self._permit(decision, entry)

    def require_preload_lineage(
        self,
        value: ValidatedGovernanceView | Mapping[str, Any],
        *,
        preload: ValidatedGovernanceView | Mapping[str, Any],
    ) -> None:
        """Require a train-begin/reoffer chain rooted in one claimed preload."""

        decision = self._decision(value)
        root = self._decision(preload)
        if decision.event != "train_begin" or root.event != "preflight_before_load":
            raise DecisionInvalid("preload lineage requires train_begin rooted in preflight")
        claimed, _ = self.ledger.claimed_entry(
            decision_id=root.decision_id,
            expected_disposition="authorized_preload",
        )
        if claimed != root:
            raise DecisionInvalid("preload lineage root does not match its claimed receipt")
        cursor = decision
        seen = {decision.governance_id}
        while True:
            predecessor_id = cursor.predecessor_governance_id
            if predecessor_id is None or predecessor_id in seen:
                raise DecisionInvalid("train_begin reoffer lineage is cyclic or unrooted")
            seen.add(predecessor_id)
            predecessor = self._predecessor(
                cursor,
                allowed_events={"preflight_before_load", "train_begin"},
            )
            if predecessor.event == "preflight_before_load":
                if predecessor != root:
                    raise DecisionInvalid(
                        "train_begin lineage is rooted in another preload decision"
                    )
                self._require_claimed_predecessor(
                    predecessor,
                    directive="allow_preload_for_review",
                    disposition="authorized_preload",
                )
                return
            self._require_same_seam_reoffer(cursor, predecessor)
            cursor = predecessor

    def record_terminal_receipt(
        self, value: ValidatedGovernanceView | Mapping[str, Any]
    ) -> LedgerEntry:
        decision = self._decision(value)
        if decision.event not in {"checkpoint_recorded", "train_end"}:
            raise DecisionInvalid("terminal receipt requires checkpoint_recorded or train_end")
        if decision.event == "checkpoint_recorded":
            predecessor = self._predecessor(
                decision,
                allowed_events={"post_optimizer_step", "post_evaluation"},
                exact_normative_snapshot=True,
            )
            if predecessor.control.directive != "checkpoint_then_park":
                raise DecisionInvalid(
                    "checkpoint_recorded must directly follow an explicit checkpoint_then_park request"
                )
            assert decision.physical_checkpoint_ref is not None
            assert decision.physical_checkpoint_evidence_ref is not None
            assert decision.observed_global_step is not None
            self.ledger.require_observed_checkpoint(
                checkpoint_ref=decision.physical_checkpoint_ref,
                evidence_ref=decision.physical_checkpoint_evidence_ref,
                global_step=decision.observed_global_step,
                expected_context=decision,
                expected_checkpoint_request_ref=decision.predecessor_governance_id,
                expected_checkpoint_ticket_id=decision.checkpoint_ticket_id,
            )
        else:
            predecessor = self._predecessor(
                decision,
                allowed_events={
                    "preflight_before_load",
                    "train_begin",
                    "pre_optimizer_step",
                    "resume_offer",
                    "post_optimizer_step",
                    "pre_evaluation",
                    "post_evaluation",
                    "checkpoint_recorded",
                },
            )
            if predecessor.observed_global_step is not None and (
                decision.observed_global_step != predecessor.observed_global_step
            ):
                raise DecisionInvalid(
                    "train_end does not preserve the predecessor's observed step"
                )
            if (
                predecessor.control.directive == "remain_stopped"
                and predecessor.event != "checkpoint_recorded"
            ):
                raise DecisionInvalid(
                    "remain_stopped is terminal unless it is a recorded checkpoint"
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
