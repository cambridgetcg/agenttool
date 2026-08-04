"""Typed failures for the bounded HF training host."""


class HfTrainingHostError(RuntimeError):
    """Base class for host and ledger failures."""


class DecisionInvalid(HfTrainingHostError):
    """The caller-supplied validated-governance view is malformed."""


class LedgerSecurityError(HfTrainingHostError):
    """The ledger path or SQLite schema does not meet local safety checks."""


class LedgerIntegrityError(HfTrainingHostError):
    """The append-only ledger no longer verifies."""


class TrainingHeld(HfTrainingHostError):
    """A start, resume, or continuation was held rather than authorized."""

    def __init__(self, reason: str, *, decision_id: str, disposition: str) -> None:
        super().__init__(reason)
        self.decision_id = decision_id
        self.disposition = disposition


class CheckpointTicketError(HfTrainingHostError):
    """A checkpoint ticket is missing, mismatched, replayed, or already spent."""


class HfCompatibilityError(HfTrainingHostError):
    """The installed HF stack or requested execution mode is outside v0.2."""


class MutationUnitFailed(HfTrainingHostError):
    """A claimed non-atomic mutation unit failed and the adapter latched closed."""


class EvaluationUnitFailed(HfTrainingHostError):
    """A claimed evaluation unit failed and the adapter latched closed."""


class CheckpointIncomplete(HfTrainingHostError):
    """A requested checkpoint could not be verified as resumable."""
