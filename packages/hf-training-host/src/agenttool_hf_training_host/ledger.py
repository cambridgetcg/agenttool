"""Append-only local replay and governance-frontier ledger."""

from __future__ import annotations

import json
import os
import re
import sqlite3
import stat
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Mapping

from .canonical import canonical_json, domain_separated_id
from .decision import ValidatedGovernanceView
from .errors import (
    CheckpointIncomplete,
    CheckpointTicketError,
    LedgerIntegrityError,
    LedgerSecurityError,
)

FRONTIER_FORMAT = "kingdom.hf-training-governance-frontier/0.2"
ENTRY_FORMAT = "kingdom.hf-training-host-ledger-entry/0.2"
TICKET_FORMAT = "kingdom.hf-training-host-checkpoint-ticket/0.2"
CHECKPOINT_EFFECT_FORMAT = "kingdom.hf-training-host-checkpoint-effect/0.2"
ACTION_CLAIM_FORMAT = "kingdom.hf-training-host-action-claim/0.2"
SCHEMA_VERSION = "agenttool.hf-training-host-ledger/0.2"
_APPLICATION_ID = 0x41544846  # "ATHF"
_SHA256_ID = re.compile(r"^sha256:[0-9a-f]{64}$")

_SCHEMA = f"""
CREATE TABLE IF NOT EXISTS ledger_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS ledger_entries (
  sequence INTEGER PRIMARY KEY,
  decision_id TEXT NOT NULL UNIQUE,
  governance_id TEXT NOT NULL,
  offer_id TEXT NOT NULL,
  run_ref TEXT NOT NULL,
  predecessor_ref TEXT,
  decision_json TEXT NOT NULL,
  request_action INTEGER NOT NULL CHECK (request_action IN (0, 1)),
  disposition TEXT NOT NULL,
  action_authorized INTEGER NOT NULL CHECK (action_authorized IN (0, 1)),
  frontier_match INTEGER NOT NULL CHECK (frontier_match IN (0, 1)),
  predecessor_current INTEGER NOT NULL CHECK (predecessor_current IN (0, 1)),
  fork_present INTEGER NOT NULL CHECK (fork_present IN (0, 1)),
  conflict_present INTEGER NOT NULL CHECK (conflict_present IN (0, 1)),
  reused_refs_json TEXT NOT NULL,
  frontier_before TEXT NOT NULL,
  frontier_after TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  prev_entry_hash TEXT,
  entry_hash TEXT NOT NULL UNIQUE
) STRICT;
CREATE TABLE IF NOT EXISTS ledger_consumptions (
  kind TEXT NOT NULL CHECK (kind IN ('encounter', 'evidence')),
  ref TEXT NOT NULL,
  entry_sequence INTEGER NOT NULL REFERENCES ledger_entries(sequence),
  PRIMARY KEY (kind, ref)
) STRICT;
CREATE TABLE IF NOT EXISTS ledger_action_claims (
  decision_id TEXT PRIMARY KEY REFERENCES ledger_entries(decision_id),
  entry_sequence INTEGER NOT NULL UNIQUE REFERENCES ledger_entries(sequence),
  entry_hash TEXT NOT NULL,
  claimed_at TEXT NOT NULL,
  claim_id TEXT NOT NULL UNIQUE
) STRICT;
CREATE TABLE IF NOT EXISTS checkpoint_tickets (
  ticket_id TEXT PRIMARY KEY,
  decision_id TEXT NOT NULL REFERENCES ledger_entries(decision_id),
  global_step INTEGER NOT NULL CHECK (global_step >= 0),
  entry_sequence INTEGER NOT NULL REFERENCES ledger_entries(sequence),
  issued_at TEXT NOT NULL,
  UNIQUE (decision_id, global_step)
) STRICT;
CREATE TABLE IF NOT EXISTS checkpoint_ticket_consumptions (
  ticket_id TEXT PRIMARY KEY REFERENCES checkpoint_tickets(ticket_id),
  consumed_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS checkpoint_effects (
  effect_id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL UNIQUE REFERENCES checkpoint_tickets(ticket_id),
  state TEXT NOT NULL CHECK (state IN ('checkpoint_observed', 'checkpoint_incomplete')),
  checkpoint_ref TEXT,
  evidence_ref TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  CHECK (
    (state = 'checkpoint_observed' AND checkpoint_ref IS NOT NULL) OR
    (state = 'checkpoint_incomplete' AND checkpoint_ref IS NULL)
  )
) STRICT;
CREATE TRIGGER IF NOT EXISTS ledger_meta_no_update
BEFORE UPDATE ON ledger_meta BEGIN SELECT RAISE(ABORT, 'append-only ledger_meta'); END;
CREATE TRIGGER IF NOT EXISTS ledger_meta_no_delete
BEFORE DELETE ON ledger_meta BEGIN SELECT RAISE(ABORT, 'append-only ledger_meta'); END;
CREATE TRIGGER IF NOT EXISTS ledger_entries_no_update
BEFORE UPDATE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'append-only ledger_entries'); END;
CREATE TRIGGER IF NOT EXISTS ledger_entries_no_delete
BEFORE DELETE ON ledger_entries BEGIN SELECT RAISE(ABORT, 'append-only ledger_entries'); END;
CREATE TRIGGER IF NOT EXISTS ledger_consumptions_no_update
BEFORE UPDATE ON ledger_consumptions BEGIN SELECT RAISE(ABORT, 'append-only ledger_consumptions'); END;
CREATE TRIGGER IF NOT EXISTS ledger_consumptions_no_delete
BEFORE DELETE ON ledger_consumptions BEGIN SELECT RAISE(ABORT, 'append-only ledger_consumptions'); END;
CREATE TRIGGER IF NOT EXISTS ledger_action_claims_no_update
BEFORE UPDATE ON ledger_action_claims BEGIN SELECT RAISE(ABORT, 'append-only ledger_action_claims'); END;
CREATE TRIGGER IF NOT EXISTS ledger_action_claims_no_delete
BEFORE DELETE ON ledger_action_claims BEGIN SELECT RAISE(ABORT, 'append-only ledger_action_claims'); END;
CREATE TRIGGER IF NOT EXISTS checkpoint_tickets_no_update
BEFORE UPDATE ON checkpoint_tickets BEGIN SELECT RAISE(ABORT, 'append-only checkpoint_tickets'); END;
CREATE TRIGGER IF NOT EXISTS checkpoint_tickets_no_delete
BEFORE DELETE ON checkpoint_tickets BEGIN SELECT RAISE(ABORT, 'append-only checkpoint_tickets'); END;
CREATE TRIGGER IF NOT EXISTS checkpoint_ticket_consumptions_no_update
BEFORE UPDATE ON checkpoint_ticket_consumptions BEGIN SELECT RAISE(ABORT, 'append-only checkpoint_ticket_consumptions'); END;
CREATE TRIGGER IF NOT EXISTS checkpoint_ticket_consumptions_no_delete
BEFORE DELETE ON checkpoint_ticket_consumptions BEGIN SELECT RAISE(ABORT, 'append-only checkpoint_ticket_consumptions'); END;
CREATE TRIGGER IF NOT EXISTS checkpoint_effects_no_update
BEFORE UPDATE ON checkpoint_effects BEGIN SELECT RAISE(ABORT, 'append-only checkpoint_effects'); END;
CREATE TRIGGER IF NOT EXISTS checkpoint_effects_no_delete
BEFORE DELETE ON checkpoint_effects BEGIN SELECT RAISE(ABORT, 'append-only checkpoint_effects'); END;
"""

_REQUIRED_TRIGGERS = {
    "ledger_meta_no_update",
    "ledger_meta_no_delete",
    "ledger_entries_no_update",
    "ledger_entries_no_delete",
    "ledger_consumptions_no_update",
    "ledger_consumptions_no_delete",
    "ledger_action_claims_no_update",
    "ledger_action_claims_no_delete",
    "checkpoint_tickets_no_update",
    "checkpoint_tickets_no_delete",
    "checkpoint_ticket_consumptions_no_update",
    "checkpoint_ticket_consumptions_no_delete",
    "checkpoint_effects_no_update",
    "checkpoint_effects_no_delete",
}


def _schema_signature(connection: sqlite3.Connection) -> tuple[tuple[str, str, str], ...]:
    rows = connection.execute(
        """
        SELECT type, name, sql
        FROM sqlite_schema
        WHERE name NOT LIKE 'sqlite_%'
        ORDER BY type, name
        """
    ).fetchall()
    return tuple(
        (row[0], row[1], " ".join((row[2] or "").split()))
        for row in rows
    )


@lru_cache(maxsize=1)
def _expected_schema_signature() -> tuple[tuple[str, str, str], ...]:
    with sqlite3.connect(":memory:") as connection:
        connection.executescript(_SCHEMA)
        return _schema_signature(connection)


def frontier_ref(run_ref: str, head_refs: tuple[str, ...] | list[str]) -> str:
    """Bind one run's complete sorted set of locally observed governance heads."""

    heads = tuple(sorted(head_refs))
    if len(set(heads)) != len(heads):
        raise LedgerIntegrityError("frontier head refs must be unique")
    return domain_separated_id(
        FRONTIER_FORMAT,
        {"run_ref": run_ref, "head_refs": list(heads)},
    )


@dataclass(frozen=True, slots=True)
class LedgerEntry:
    sequence: int
    decision_id: str
    governance_id: str
    offer_id: str
    run_ref: str
    predecessor_ref: str | None
    request_action: bool
    disposition: str
    action_authorized: bool
    frontier_match: bool
    predecessor_current: bool
    fork_present: bool
    conflict_present: bool
    reused_refs: tuple[str, ...]
    frontier_before: str
    frontier_after: str
    observed_at: str
    prev_entry_hash: str | None
    entry_hash: str


@dataclass(frozen=True, slots=True)
class ActionPreview:
    disposition: str
    action_authorized: bool


@dataclass(frozen=True, slots=True)
class CheckpointTicket:
    ticket_id: str
    decision_id: str
    global_step: int
    entry_sequence: int
    issued_at: str


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def _require_posix_security() -> None:
    if (
        os.name != "posix"
        or not hasattr(os, "getuid")
        or not hasattr(os, "O_NOFOLLOW")
    ):
        raise LedgerSecurityError(
            "ledger v0.2 requires POSIX ownership, mode, and no-follow semantics"
        )


def _entry_body(
    *,
    sequence: int,
    decision: ValidatedGovernanceView,
    request_action: bool,
    disposition: str,
    action_authorized: bool,
    frontier_match: bool,
    predecessor_current: bool,
    fork_present: bool,
    conflict_present: bool,
    reused_refs: tuple[str, ...],
    frontier_before: str,
    frontier_after: str,
    observed_at: str,
    prev_entry_hash: str | None,
) -> dict[str, Any]:
    return {
        "sequence": sequence,
        "decision": decision.as_dict(),
        "request_action": request_action,
        "disposition": disposition,
        "action_authorized": action_authorized,
        "frontier_match": frontier_match,
        "predecessor_current": predecessor_current,
        "fork_present": fork_present,
        "conflict_present": conflict_present,
        "reused_refs": list(reused_refs),
        "frontier_before": frontier_before,
        "frontier_after": frontier_after,
        "observed_at": observed_at,
        "prev_entry_hash": prev_entry_hash,
    }


def _classify(
    decision: ValidatedGovernanceView,
    *,
    request_action: bool,
    frontier_match: bool,
    predecessor_current: bool,
    fork_present: bool,
    conflict_present: bool,
    reused_refs: tuple[str, ...],
) -> tuple[str, bool]:
    if not request_action:
        return "record_only", False
    if decision.control.directive in {
        "hold_before_load",
        "hold_before_train_call",
        "hold_before_optimizer_step",
        "hold_before_evaluation",
        "park",
        "stop",
        "contain_and_repair",
        "remain_stopped",
    }:
        return "safety_stop", False
    if fork_present:
        return "held_fork", False
    if not frontier_match:
        return "held_stale_frontier", False
    if not predecessor_current:
        return "held_predecessor", False
    if reused_refs:
        return "held_replay", False
    if conflict_present:
        return "held_conflict", False
    if decision.control.directive == "allow_preload_for_review":
        return "authorized_preload", True
    if decision.control.directive == "allow_train_entry":
        return "authorized_train", True
    if decision.control.directive == "allow_one_mutation":
        return "authorized_mutation", True
    if decision.control.directive == "allow_evaluation":
        return "authorized_evaluation", True
    if decision.control.directive == "checkpoint_then_park":
        return "authorized_checkpoint_park", True
    return "held_control", False


class ContinuityLedger:
    """A mode-0600 SQLite journal with append-only application tables.

    The journal detects ordinary replay, rollback, stale-frontier, and sibling
    conditions among records it has observed. It does not authenticate the
    caller, prove that its local view is globally complete, or resist a writer
    who can replace the database file.
    """

    def __init__(self, path: str | os.PathLike[str], *, clock: Callable[[], str] = _utc_now) -> None:
        _require_posix_security()
        self.path = Path(path)
        self._clock = clock
        if sqlite3.sqlite_version_info < (3, 37, 0):
            raise LedgerSecurityError("SQLite 3.37.0 or newer is required for STRICT tables")
        created = self._prepare_path()
        if created:
            with self._connect() as connection:
                connection.executescript(_SCHEMA)
                connection.execute(f"PRAGMA application_id = {_APPLICATION_ID}")
                connection.execute("PRAGMA user_version = 2")
                connection.execute(
                    "INSERT INTO ledger_meta(key, value) VALUES ('schema', ?)",
                    (SCHEMA_VERSION,),
                )
        self._check_schema()

    def _prepare_path(self) -> bool:
        if not self.path.is_absolute():
            raise LedgerSecurityError("ledger path must be absolute")
        parent = self.path.parent
        try:
            parent_info = parent.lstat()
        except FileNotFoundError as error:
            raise LedgerSecurityError("ledger parent directory must already exist") from error
        if stat.S_ISLNK(parent_info.st_mode) or not stat.S_ISDIR(parent_info.st_mode):
            raise LedgerSecurityError("ledger parent must be a real directory, not a symlink")
        if parent_info.st_mode & 0o022:
            raise LedgerSecurityError("ledger parent must not be group- or world-writable")
        if self.path.exists() or self.path.is_symlink():
            info = self.path.lstat()
            if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
                raise LedgerSecurityError("ledger path must be a regular file, not a symlink")
            if hasattr(os, "getuid") and info.st_uid != os.getuid():
                raise LedgerSecurityError("ledger file must be owned by the current user")
            if info.st_mode & 0o077:
                raise LedgerSecurityError("ledger file mode must not grant group or world access")
            return False
        flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(self.path, flags, 0o600)
        os.close(descriptor)
        return True

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=5.0)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA trusted_schema = OFF")
        connection.execute("PRAGMA synchronous = FULL")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    def _check_schema(self) -> None:
        try:
            with self._connect() as connection:
                application_id = connection.execute("PRAGMA application_id").fetchone()[0]
                version = connection.execute("PRAGMA user_version").fetchone()[0]
                meta = connection.execute(
                    "SELECT value FROM ledger_meta WHERE key = 'schema'"
                ).fetchone()
                meta_rows = connection.execute(
                    "SELECT key, value FROM ledger_meta ORDER BY key"
                ).fetchall()
                triggers = {
                    row[0]
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'trigger'"
                    )
                }
                signature = _schema_signature(connection)
        except sqlite3.DatabaseError as error:
            raise LedgerSecurityError("existing ledger is not an initialized AgentTool database") from error
        if application_id != _APPLICATION_ID or version != 2:
            raise LedgerSecurityError("ledger SQLite application or schema version is unexpected")
        if meta is None or meta[0] != SCHEMA_VERSION:
            raise LedgerSecurityError("ledger schema marker is missing or unexpected")
        if [(row[0], row[1]) for row in meta_rows] != [("schema", SCHEMA_VERSION)]:
            raise LedgerSecurityError("ledger metadata contains unexpected rows")
        if not _REQUIRED_TRIGGERS.issubset(triggers):
            raise LedgerSecurityError("ledger append-only triggers are incomplete")
        if signature != _expected_schema_signature():
            raise LedgerSecurityError("ledger schema definitions do not match v0.2 exactly")

    @staticmethod
    def _heads(connection: sqlite3.Connection, run_ref: str) -> tuple[str, ...]:
        rows = connection.execute(
            """
            SELECT DISTINCT parent.governance_id
            FROM ledger_entries AS parent
            WHERE parent.run_ref = ?
              AND NOT EXISTS (
                SELECT 1 FROM ledger_entries AS child
                WHERE child.run_ref = parent.run_ref
                  AND child.predecessor_ref = parent.governance_id
                  AND child.conflict_present = 0
              )
            ORDER BY parent.governance_id
            """,
            (run_ref,),
        ).fetchall()
        return tuple(row[0] for row in rows)

    def heads(self, run_ref: str) -> tuple[str, ...]:
        with self._connect() as connection:
            return self._heads(connection, run_ref)

    def current_frontier_ref(self, run_ref: str) -> str:
        return frontier_ref(run_ref, self.heads(run_ref))

    def decision_for_governance_id(self, governance_id: str) -> ValidatedGovernanceView:
        """Return one unambiguous locally recorded governance predecessor."""

        if not isinstance(governance_id, str) or _SHA256_ID.fullmatch(governance_id) is None:
            raise LedgerIntegrityError("predecessor governance ID is not a content identifier")
        self.verify()
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT decision_json FROM ledger_entries WHERE governance_id = ? ORDER BY sequence",
                (governance_id,),
            ).fetchall()
        if len(rows) != 1:
            raise LedgerIntegrityError(
                "predecessor governance ID is absent or has ambiguous host projections"
            )
        return ValidatedGovernanceView.from_mapping(json.loads(rows[0]["decision_json"]))

    @staticmethod
    def _row_to_entry(row: sqlite3.Row) -> LedgerEntry:
        return LedgerEntry(
            sequence=row["sequence"],
            decision_id=row["decision_id"],
            governance_id=row["governance_id"],
            offer_id=row["offer_id"],
            run_ref=row["run_ref"],
            predecessor_ref=row["predecessor_ref"],
            request_action=bool(row["request_action"]),
            disposition=row["disposition"],
            action_authorized=bool(row["action_authorized"]),
            frontier_match=bool(row["frontier_match"]),
            predecessor_current=bool(row["predecessor_current"]),
            fork_present=bool(row["fork_present"]),
            conflict_present=bool(row["conflict_present"]),
            reused_refs=tuple(json.loads(row["reused_refs_json"])),
            frontier_before=row["frontier_before"],
            frontier_after=row["frontier_after"],
            observed_at=row["observed_at"],
            prev_entry_hash=row["prev_entry_hash"],
            entry_hash=row["entry_hash"],
        )

    def preview_action(
        self,
        value: ValidatedGovernanceView | Mapping[str, Any],
    ) -> ActionPreview:
        """Non-consuming eligibility snapshot for a first source fence.

        The later append/claim transaction rechecks everything. This preview
        only prevents already-observable stale, forked, conflicted, replayed,
        or previously consumed work from reaching forward/backward first.
        """

        source = value.as_dict() if isinstance(value, ValidatedGovernanceView) else value
        decision = ValidatedGovernanceView.from_mapping(source)
        decision_json = canonical_json(decision.as_dict())
        self.verify()
        with self._connect() as connection:
            connection.execute("BEGIN")
            prior = connection.execute(
                "SELECT * FROM ledger_entries WHERE decision_id = ?",
                (decision.decision_id,),
            ).fetchone()
            if prior is not None:
                if prior["decision_json"] != decision_json:
                    raise LedgerIntegrityError(
                        "an existing decision ID has different canonical bytes"
                    )
                claimed = connection.execute(
                    "SELECT 1 FROM ledger_action_claims WHERE decision_id = ?",
                    (decision.decision_id,),
                ).fetchone() is not None
                if claimed:
                    return ActionPreview("held_exact_replay", False)
                if bool(prior["action_authorized"]):
                    heads = self._heads(connection, prior["run_ref"])
                    run_conflict = connection.execute(
                        "SELECT 1 FROM ledger_entries WHERE run_ref = ? AND conflict_present = 1 LIMIT 1",
                        (prior["run_ref"],),
                    ).fetchone() is not None
                    if run_conflict:
                        return ActionPreview("held_conflict", False)
                    if len(heads) > 1:
                        return ActionPreview("held_fork", False)
                    if heads != (prior["governance_id"],):
                        return ActionPreview("held_predecessor", False)
                return ActionPreview(
                    prior["disposition"],
                    bool(prior["action_authorized"]),
                )

            heads = self._heads(connection, decision.run_ref)
            before = frontier_ref(decision.run_ref, heads)
            frontier_match = decision.observed_governance_frontier_ref == before
            predecessor_current = (
                decision.predecessor_ref is None
                if not heads
                else decision.predecessor_ref in heads
            )
            fork_present = len(heads) > 1
            refs = (("encounter", decision.encounter_ref),) + tuple(
                ("evidence", ref) for ref in decision.consumed_evidence_refs
            )
            reused = tuple(
                sorted(
                    f"{kind}:{ref}"
                    for kind, ref in refs
                    if connection.execute(
                        "SELECT 1 FROM ledger_consumptions WHERE kind = ? AND ref = ?",
                        (kind, ref),
                    ).fetchone()
                    is not None
                )
            )
            prior_conflict = connection.execute(
                "SELECT 1 FROM ledger_entries WHERE run_ref = ? AND conflict_present = 1 LIMIT 1",
                (decision.run_ref,),
            ).fetchone() is not None
            conflict_present = (
                prior_conflict
                or fork_present
                or not frontier_match
                or not predecessor_current
                or bool(reused)
            )
            disposition, action_authorized = _classify(
                decision,
                request_action=True,
                frontier_match=frontier_match,
                predecessor_current=predecessor_current,
                fork_present=fork_present,
                conflict_present=conflict_present,
                reused_refs=reused,
            )
            return ActionPreview(disposition, action_authorized)

    def record(
        self,
        value: ValidatedGovernanceView | Mapping[str, Any],
        *,
        request_action: bool = False,
    ) -> LedgerEntry:
        source = value.as_dict() if isinstance(value, ValidatedGovernanceView) else value
        decision = ValidatedGovernanceView.from_mapping(source)
        decision_json = canonical_json(decision.as_dict())
        connection = self._connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            prior = connection.execute(
                "SELECT * FROM ledger_entries WHERE decision_id = ?",
                (decision.decision_id,),
            ).fetchone()
            if prior is not None:
                if prior["decision_json"] != decision_json:
                    raise LedgerIntegrityError("an existing decision ID has different canonical bytes")
                connection.commit()
                return self._row_to_entry(prior)

            heads = self._heads(connection, decision.run_ref)
            before = frontier_ref(decision.run_ref, heads)
            frontier_match = decision.observed_governance_frontier_ref == before
            predecessor_current = (
                decision.predecessor_ref is None if not heads else decision.predecessor_ref in heads
            )
            fork_present = len(heads) > 1
            refs = (("encounter", decision.encounter_ref),) + tuple(
                ("evidence", ref) for ref in decision.consumed_evidence_refs
            )
            reused = tuple(
                sorted(
                    f"{kind}:{ref}"
                    for kind, ref in refs
                    if connection.execute(
                        "SELECT 1 FROM ledger_consumptions WHERE kind = ? AND ref = ?",
                        (kind, ref),
                    ).fetchone()
                    is not None
                )
            )
            prior_conflict = connection.execute(
                "SELECT 1 FROM ledger_entries WHERE run_ref = ? AND conflict_present = 1 LIMIT 1",
                (decision.run_ref,),
            ).fetchone() is not None
            conflict_present = (
                prior_conflict
                or fork_present
                or not frontier_match
                or not predecessor_current
                or bool(reused)
            )
            disposition, action_authorized = _classify(
                decision,
                request_action=request_action,
                frontier_match=frontier_match,
                predecessor_current=predecessor_current,
                fork_present=fork_present,
                conflict_present=conflict_present,
                reused_refs=reused,
            )
            after_heads = set(heads)
            advances_linear_frontier = not conflict_present
            if advances_linear_frontier and decision.predecessor_ref in after_heads:
                after_heads.remove(decision.predecessor_ref)
            after_heads.add(decision.governance_id)
            after = frontier_ref(decision.run_ref, tuple(after_heads))
            latest = connection.execute(
                "SELECT sequence, entry_hash FROM ledger_entries ORDER BY sequence DESC LIMIT 1"
            ).fetchone()
            sequence = 1 if latest is None else latest["sequence"] + 1
            previous_hash = None if latest is None else latest["entry_hash"]
            observed_at = self._clock()
            body = _entry_body(
                sequence=sequence,
                decision=decision,
                request_action=request_action,
                disposition=disposition,
                action_authorized=action_authorized,
                frontier_match=frontier_match,
                predecessor_current=predecessor_current,
                fork_present=fork_present,
                conflict_present=conflict_present,
                reused_refs=reused,
                frontier_before=before,
                frontier_after=after,
                observed_at=observed_at,
                prev_entry_hash=previous_hash,
            )
            entry_hash = domain_separated_id(ENTRY_FORMAT, body)
            connection.execute(
                """
                INSERT INTO ledger_entries(
                  sequence, decision_id, governance_id, offer_id, run_ref,
                  predecessor_ref, decision_json, request_action, disposition,
                  action_authorized, frontier_match, predecessor_current,
                  fork_present, conflict_present, reused_refs_json, frontier_before,
                  frontier_after, observed_at, prev_entry_hash, entry_hash
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    sequence,
                    decision.decision_id,
                    decision.governance_id,
                    decision.offer_id,
                    decision.run_ref,
                    decision.predecessor_ref,
                    decision_json,
                    int(request_action),
                    disposition,
                    int(action_authorized),
                    int(frontier_match),
                    int(predecessor_current),
                    int(fork_present),
                    int(conflict_present),
                    canonical_json(list(reused)),
                    before,
                    after,
                    observed_at,
                    previous_hash,
                    entry_hash,
                ),
            )
            reused_set = set(reused)
            for kind, ref in refs:
                if f"{kind}:{ref}" not in reused_set:
                    connection.execute(
                        "INSERT INTO ledger_consumptions(kind, ref, entry_sequence) VALUES (?, ?, ?)",
                        (kind, ref, sequence),
                    )
            connection.commit()
            row = connection.execute(
                "SELECT * FROM ledger_entries WHERE sequence = ?", (sequence,)
            ).fetchone()
            assert row is not None
            return self._row_to_entry(row)
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def issue_checkpoint_ticket(
        self,
        decision: ValidatedGovernanceView,
        entry: LedgerEntry,
        *,
        global_step: int,
    ) -> CheckpointTicket:
        decision = ValidatedGovernanceView.from_mapping(decision.as_dict())
        if type(global_step) is not int or global_step < 0:
            raise CheckpointTicketError("checkpoint global_step must be a non-negative integer")
        if decision.observed_global_step != global_step:
            raise CheckpointTicketError(
                "checkpoint ticket global_step does not match the exact boundary decision"
            )
        issued_at = self._clock()
        try:
            with self._connect() as connection:
                connection.execute("BEGIN IMMEDIATE")
                stored = connection.execute(
                    "SELECT * FROM ledger_entries WHERE sequence = ?",
                    (entry.sequence,),
                ).fetchone()
                if stored is None:
                    raise CheckpointTicketError("checkpoint entry is absent from the ledger")
                stored_entry = self._row_to_entry(stored)
                if stored_entry != entry or (
                    stored["decision_json"] != canonical_json(decision.as_dict())
                    or stored_entry.decision_id != decision.decision_id
                    or not stored_entry.action_authorized
                    or stored_entry.disposition != "authorized_checkpoint_park"
                    or decision.control.directive
                    != "checkpoint_then_park"
                ):
                    raise CheckpointTicketError(
                        "checkpoint ticket requires the exact authorized ledger entry"
                    )
                claim = connection.execute(
                    "SELECT 1 FROM ledger_action_claims WHERE decision_id = ? AND entry_sequence = ?",
                    (decision.decision_id, entry.sequence),
                ).fetchone()
                if claim is None:
                    raise CheckpointTicketError(
                        "checkpoint ticket requires a consumed host action"
                    )
                body = {
                    "decision_id": decision.decision_id,
                    "global_step": global_step,
                    "ledger_entry_hash": entry.entry_hash,
                    "issued_at": issued_at,
                }
                ticket_id = domain_separated_id(TICKET_FORMAT, body)
                connection.execute(
                    """
                    INSERT INTO checkpoint_tickets(
                      ticket_id, decision_id, global_step, entry_sequence, issued_at
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    (ticket_id, decision.decision_id, global_step, entry.sequence, issued_at),
                )
        except sqlite3.IntegrityError as error:
            raise CheckpointTicketError("checkpoint ticket was already issued") from error
        return CheckpointTicket(ticket_id, decision.decision_id, global_step, entry.sequence, issued_at)

    def claim_action(self, entry: LedgerEntry) -> bool:
        """Consume one authorized host action exactly once.

        Recording a decision is retry-idempotent, but executing the operation
        it permits is not. A process crash before this claim can retry; after a
        successful claim, the caller needs a newly validated offer.
        """

        if not entry.action_authorized:
            raise LedgerIntegrityError("cannot claim an action from a held ledger entry")
        claimed_at = self._clock()
        body = {
            "decision_id": entry.decision_id,
            "entry_sequence": entry.sequence,
            "entry_hash": entry.entry_hash,
            "claimed_at": claimed_at,
        }
        claim_id = domain_separated_id(ACTION_CLAIM_FORMAT, body)
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            stored = connection.execute(
                "SELECT decision_id, governance_id, run_ref, entry_hash, action_authorized FROM ledger_entries WHERE sequence = ?",
                (entry.sequence,),
            ).fetchone()
            if stored is None or (
                stored["decision_id"] != entry.decision_id
                or stored["entry_hash"] != entry.entry_hash
                or not bool(stored["action_authorized"])
            ):
                raise LedgerIntegrityError("action claim does not match an authorized ledger entry")
            existing = connection.execute(
                "SELECT 1 FROM ledger_action_claims WHERE decision_id = ?",
                (entry.decision_id,),
            ).fetchone()
            if existing is not None:
                return False
            heads = self._heads(connection, stored["run_ref"])
            run_conflict = connection.execute(
                "SELECT 1 FROM ledger_entries WHERE run_ref = ? AND conflict_present = 1 LIMIT 1",
                (stored["run_ref"],),
            ).fetchone() is not None
            if run_conflict or heads != (stored["governance_id"],):
                return False
            connection.execute(
                """
                INSERT INTO ledger_action_claims(
                  decision_id, entry_sequence, entry_hash, claimed_at, claim_id
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (entry.decision_id, entry.sequence, entry.entry_hash, claimed_at, claim_id),
            )
        return True

    def require_action_claim(
        self,
        *,
        decision_id: str,
        entry_sequence: int,
        entry_hash: str,
        expected_disposition: str,
    ) -> ValidatedGovernanceView:
        """Re-read an exact, already-consumed action receipt from this ledger."""

        if expected_disposition not in {
            "authorized_preload",
            "authorized_train",
            "authorized_mutation",
            "authorized_evaluation",
            "authorized_checkpoint_park",
        }:
            raise LedgerIntegrityError("expected action disposition is not supported")
        if type(entry_sequence) is not int or entry_sequence < 1:
            raise LedgerIntegrityError("action receipt sequence is not supported")
        for name, value in (("decision_id", decision_id), ("entry_hash", entry_hash)):
            if not isinstance(value, str) or _SHA256_ID.fullmatch(value) is None:
                raise LedgerIntegrityError(f"action receipt {name} is not a content identifier")
        self.verify()
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT entry.*
                FROM ledger_entries AS entry
                JOIN ledger_action_claims AS claim
                  ON claim.decision_id = entry.decision_id
                 AND claim.entry_sequence = entry.sequence
                 AND claim.entry_hash = entry.entry_hash
                WHERE entry.decision_id = ?
                  AND entry.sequence = ?
                  AND entry.entry_hash = ?
                  AND entry.disposition = ?
                  AND entry.action_authorized = 1
                """,
                (decision_id, entry_sequence, entry_hash, expected_disposition),
            ).fetchone()
        if row is None:
            raise LedgerIntegrityError("action receipt is absent or was not consumed")
        return ValidatedGovernanceView.from_mapping(json.loads(row["decision_json"]))

    def claimed_entry(
        self,
        *,
        decision_id: str,
        expected_disposition: str,
    ) -> tuple[ValidatedGovernanceView, LedgerEntry]:
        """Recover a non-secret local receipt without consuming a new action."""

        if not isinstance(decision_id, str) or _SHA256_ID.fullmatch(decision_id) is None:
            raise LedgerIntegrityError("claimed decision ID is not a content identifier")
        if expected_disposition not in {
            "authorized_preload",
            "authorized_train",
            "authorized_mutation",
            "authorized_evaluation",
            "authorized_checkpoint_park",
        }:
            raise LedgerIntegrityError("expected action disposition is not supported")
        self.verify()
        with self._connect() as connection:
            row = connection.execute(
                """
                SELECT entry.*
                FROM ledger_entries AS entry
                JOIN ledger_action_claims AS claim
                  ON claim.decision_id = entry.decision_id
                 AND claim.entry_sequence = entry.sequence
                 AND claim.entry_hash = entry.entry_hash
                WHERE entry.decision_id = ?
                  AND entry.disposition = ?
                  AND entry.action_authorized = 1
                """,
                (decision_id, expected_disposition),
            ).fetchone()
        if row is None:
            raise LedgerIntegrityError("claimed action receipt is absent")
        return (
            ValidatedGovernanceView.from_mapping(json.loads(row["decision_json"])),
            self._row_to_entry(row),
        )

    def consume_checkpoint_ticket(self, ticket: CheckpointTicket, *, global_step: int) -> None:
        if global_step != ticket.global_step:
            raise CheckpointTicketError("checkpoint ticket does not match the current global step")
        try:
            with self._connect() as connection:
                connection.execute("BEGIN IMMEDIATE")
                row = connection.execute(
                    "SELECT decision_id, global_step, entry_sequence, issued_at FROM checkpoint_tickets WHERE ticket_id = ?",
                    (ticket.ticket_id,),
                ).fetchone()
                if row is None or (
                    row["decision_id"] != ticket.decision_id
                    or row["global_step"] != ticket.global_step
                    or row["entry_sequence"] != ticket.entry_sequence
                    or row["issued_at"] != ticket.issued_at
                ):
                    raise CheckpointTicketError("checkpoint ticket is absent or does not match the ledger")
                connection.execute(
                    "INSERT INTO checkpoint_ticket_consumptions(ticket_id, consumed_at) VALUES (?, ?)",
                    (ticket.ticket_id, self._clock()),
                )
        except sqlite3.IntegrityError as error:
            raise CheckpointTicketError("checkpoint ticket was already consumed") from error

    def record_checkpoint_effect(
        self,
        ticket: CheckpointTicket,
        *,
        state: str,
        checkpoint_ref: str | None,
        evidence_ref: str,
    ) -> str:
        if state not in {"checkpoint_observed", "checkpoint_incomplete"}:
            raise CheckpointTicketError("unsupported checkpoint effect state")
        if state == "checkpoint_observed" and checkpoint_ref is None:
            raise CheckpointTicketError("an observed checkpoint requires its exact reference")
        if state == "checkpoint_incomplete" and checkpoint_ref is not None:
            raise CheckpointTicketError("an incomplete checkpoint must not claim a reference")
        if checkpoint_ref is not None and (
            not isinstance(checkpoint_ref, str)
            or _SHA256_ID.fullmatch(checkpoint_ref) is None
        ):
            raise CheckpointTicketError("checkpoint_ref must be a content identifier or null")
        if not isinstance(evidence_ref, str) or _SHA256_ID.fullmatch(evidence_ref) is None:
            raise CheckpointTicketError("evidence_ref must be a content identifier")
        try:
            with self._connect() as connection:
                connection.execute("BEGIN IMMEDIATE")
                stored = connection.execute(
                    """
                    SELECT ticket.decision_id, ticket.global_step,
                           ticket.entry_sequence, ticket.issued_at,
                           consumption.ticket_id AS consumed_ticket_id
                    FROM checkpoint_tickets AS ticket
                    LEFT JOIN checkpoint_ticket_consumptions AS consumption
                      ON consumption.ticket_id = ticket.ticket_id
                    WHERE ticket.ticket_id = ?
                    """,
                    (ticket.ticket_id,),
                ).fetchone()
                if stored is None or (
                    stored["decision_id"] != ticket.decision_id
                    or stored["global_step"] != ticket.global_step
                    or stored["entry_sequence"] != ticket.entry_sequence
                    or stored["issued_at"] != ticket.issued_at
                ):
                    raise CheckpointTicketError(
                        "checkpoint effect ticket does not match the ledger"
                    )
                if stored["consumed_ticket_id"] is None:
                    raise CheckpointTicketError("checkpoint effect requires a consumed ticket")
                recorded_at = self._clock()
                body = {
                    "ticket_id": ticket.ticket_id,
                    "state": state,
                    "checkpoint_ref": checkpoint_ref,
                    "evidence_ref": evidence_ref,
                    "recorded_at": recorded_at,
                }
                effect_id = domain_separated_id(CHECKPOINT_EFFECT_FORMAT, body)
                connection.execute(
                    """
                    INSERT INTO checkpoint_effects(
                      effect_id, ticket_id, state, checkpoint_ref, evidence_ref, recorded_at
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (effect_id, ticket.ticket_id, state, checkpoint_ref, evidence_ref, recorded_at),
                )
        except sqlite3.IntegrityError as error:
            raise CheckpointTicketError("checkpoint effect was already recorded") from error
        return effect_id

    def require_observed_checkpoint(
        self,
        *,
        checkpoint_ref: str,
        evidence_ref: str,
        expected_context: ValidatedGovernanceView | Mapping[str, Any],
        expected_checkpoint_request_ref: str | None = None,
        expected_checkpoint_ticket_id: str | None = None,
        global_step: int | None = None,
    ) -> None:
        """Require a complete checkpoint effect already witnessed by this ledger."""

        for name, value in (
            ("checkpoint_ref", checkpoint_ref),
            ("evidence_ref", evidence_ref),
        ):
            if not isinstance(value, str) or _SHA256_ID.fullmatch(value) is None:
                raise CheckpointIncomplete(f"{name} must be a content identifier")
        if global_step is not None and (type(global_step) is not int or global_step < 0):
            raise CheckpointIncomplete("global_step must be null or a non-negative integer")
        context_source = (
            expected_context.as_dict()
            if isinstance(expected_context, ValidatedGovernanceView)
            else expected_context
        )
        context = ValidatedGovernanceView.from_mapping(context_source)
        if expected_checkpoint_request_ref is not None and (
            not isinstance(expected_checkpoint_request_ref, str)
            or _SHA256_ID.fullmatch(expected_checkpoint_request_ref) is None
        ):
            raise CheckpointIncomplete(
                "expected checkpoint-request ref must be a content identifier or null"
            )
        if expected_checkpoint_ticket_id is not None and (
            not isinstance(expected_checkpoint_ticket_id, str)
            or _SHA256_ID.fullmatch(expected_checkpoint_ticket_id) is None
        ):
            raise CheckpointIncomplete(
                "expected checkpoint-ticket ID must be a content identifier or null"
            )
        self.verify()
        with self._connect() as connection:
            matches = connection.execute(
                """
                SELECT ticket.ticket_id, ticket.global_step,
                       entry.governance_id, entry.decision_json
                FROM checkpoint_effects AS effect
                JOIN checkpoint_tickets AS ticket ON ticket.ticket_id = effect.ticket_id
                JOIN checkpoint_ticket_consumptions AS consumption
                  ON consumption.ticket_id = ticket.ticket_id
                JOIN ledger_action_claims AS claim
                  ON claim.decision_id = ticket.decision_id
                 AND claim.entry_sequence = ticket.entry_sequence
                JOIN ledger_entries AS entry
                  ON entry.sequence = ticket.entry_sequence
                 AND entry.decision_id = ticket.decision_id
                WHERE effect.state = 'checkpoint_observed'
                  AND effect.checkpoint_ref = ?
                  AND effect.evidence_ref = ?
                  AND entry.action_authorized = 1
                  AND entry.disposition = 'authorized_checkpoint_park'
                """,
                (checkpoint_ref, evidence_ref),
            ).fetchall()
        matched_context = False
        for row in matches:
            request = ValidatedGovernanceView.from_mapping(
                json.loads(row["decision_json"])
            )
            if (
                request.run_ref == context.run_ref
                and request.execution_contract_id == context.execution_contract_id
                and request.execution_refs == context.execution_refs
                and (global_step is None or row["global_step"] == global_step)
                and (
                    expected_checkpoint_request_ref is None
                    or row["governance_id"] == expected_checkpoint_request_ref
                )
                and (
                    expected_checkpoint_ticket_id is None
                    or row["ticket_id"] == expected_checkpoint_ticket_id
                )
            ):
                matched_context = True
                break
        if not matched_context:
            raise CheckpointIncomplete(
                "checkpoint has no exact same-context observed effect in this local ledger"
            )

    def verify(self) -> dict[str, Any]:
        self._check_schema()
        with self._connect() as connection:
            integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
            if integrity != "ok":
                raise LedgerIntegrityError(f"SQLite integrity check failed: {integrity}")
            foreign_key_failure = connection.execute("PRAGMA foreign_key_check").fetchone()
            if foreign_key_failure is not None:
                raise LedgerIntegrityError("ledger foreign-key bindings do not verify")
            rows = connection.execute("SELECT * FROM ledger_entries ORDER BY sequence").fetchall()
            stored_consumptions = {
                (row["kind"], row["ref"]): row["entry_sequence"]
                for row in connection.execute(
                    "SELECT kind, ref, entry_sequence FROM ledger_consumptions"
                )
            }
            tickets = connection.execute(
                """
                SELECT ticket.ticket_id, ticket.decision_id, ticket.global_step,
                       ticket.entry_sequence, ticket.issued_at, entry.entry_hash,
                       entry.disposition, entry.action_authorized,
                       entry.decision_id AS recorded_decision_id,
                       claim.decision_id AS claimed_decision_id
                FROM checkpoint_tickets AS ticket
                JOIN ledger_entries AS entry ON entry.sequence = ticket.entry_sequence
                LEFT JOIN ledger_action_claims AS claim
                  ON claim.decision_id = ticket.decision_id
                 AND claim.entry_sequence = ticket.entry_sequence
                ORDER BY ticket.ticket_id
                """
            ).fetchall()
            ticket_consumptions = {
                row[0]
                for row in connection.execute(
                    "SELECT ticket_id FROM checkpoint_ticket_consumptions"
                )
            }
            effects = connection.execute(
                "SELECT effect_id, ticket_id, state, checkpoint_ref, evidence_ref, recorded_at FROM checkpoint_effects"
            ).fetchall()
            action_claims = connection.execute(
                """
                SELECT claim.decision_id, claim.entry_sequence, claim.entry_hash,
                       claim.claimed_at, claim.claim_id, entry.action_authorized,
                       entry.decision_id AS recorded_decision_id,
                       entry.entry_hash AS recorded_entry_hash
                FROM ledger_action_claims AS claim
                JOIN ledger_entries AS entry ON entry.sequence = claim.entry_sequence
                ORDER BY claim.entry_sequence
                """
            ).fetchall()
            raw_counts = {
                table: connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                for table in (
                    "ledger_action_claims",
                    "checkpoint_tickets",
                    "checkpoint_ticket_consumptions",
                    "checkpoint_effects",
                )
            }
        if (
            raw_counts["ledger_action_claims"] != len(action_claims)
            or raw_counts["checkpoint_tickets"] != len(tickets)
            or raw_counts["checkpoint_ticket_consumptions"] != len(ticket_consumptions)
            or raw_counts["checkpoint_effects"] != len(effects)
        ):
            raise LedgerIntegrityError("ledger auxiliary joins hide unbound rows")
        heads_by_run: dict[str, set[str]] = {}
        conflicted_runs: set[str] = set()
        expected_consumptions: dict[tuple[str, str], int] = {}
        previous_hash: str | None = None
        for expected_sequence, row in enumerate(rows, start=1):
            if row["sequence"] != expected_sequence:
                raise LedgerIntegrityError("ledger sequences are not contiguous")
            raw_decision = json.loads(row["decision_json"])
            decision = ValidatedGovernanceView.from_mapping(raw_decision)
            if canonical_json(raw_decision) != row["decision_json"]:
                raise LedgerIntegrityError("stored decision JSON is not canonical")
            if (
                decision.decision_id != row["decision_id"]
                or decision.governance_id != row["governance_id"]
                or decision.offer_id != row["offer_id"]
                or decision.run_ref != row["run_ref"]
                or decision.predecessor_ref != row["predecessor_ref"]
            ):
                raise LedgerIntegrityError("ledger index fields do not match decision bytes")
            heads = heads_by_run.setdefault(decision.run_ref, set())
            before = frontier_ref(decision.run_ref, tuple(heads))
            frontier_match = decision.observed_governance_frontier_ref == before
            predecessor_current = (
                decision.predecessor_ref is None if not heads else decision.predecessor_ref in heads
            )
            fork_present = len(heads) > 1
            refs = (("encounter", decision.encounter_ref),) + tuple(
                ("evidence", ref) for ref in decision.consumed_evidence_refs
            )
            reused = tuple(
                sorted(
                    f"{kind}:{ref}" for kind, ref in refs if (kind, ref) in expected_consumptions
                )
            )
            conflict_present = (
                decision.run_ref in conflicted_runs
                or fork_present
                or not frontier_match
                or not predecessor_current
                or bool(reused)
            )
            disposition, action_authorized = _classify(
                decision,
                request_action=bool(row["request_action"]),
                frontier_match=frontier_match,
                predecessor_current=predecessor_current,
                fork_present=fork_present,
                conflict_present=conflict_present,
                reused_refs=reused,
            )
            advances_linear_frontier = not conflict_present
            if advances_linear_frontier and decision.predecessor_ref in heads:
                heads.remove(decision.predecessor_ref)
            heads.add(decision.governance_id)
            if conflict_present:
                conflicted_runs.add(decision.run_ref)
            after = frontier_ref(decision.run_ref, tuple(heads))
            observed_reused = tuple(json.loads(row["reused_refs_json"]))
            if (
                disposition != row["disposition"]
                or action_authorized != bool(row["action_authorized"])
                or frontier_match != bool(row["frontier_match"])
                or predecessor_current != bool(row["predecessor_current"])
                or fork_present != bool(row["fork_present"])
                or conflict_present != bool(row["conflict_present"])
                or reused != observed_reused
                or before != row["frontier_before"]
                or after != row["frontier_after"]
                or previous_hash != row["prev_entry_hash"]
            ):
                raise LedgerIntegrityError("ledger-derived state does not match an entry")
            body = _entry_body(
                sequence=row["sequence"],
                decision=decision,
                request_action=bool(row["request_action"]),
                disposition=disposition,
                action_authorized=action_authorized,
                frontier_match=frontier_match,
                predecessor_current=predecessor_current,
                fork_present=fork_present,
                conflict_present=conflict_present,
                reused_refs=reused,
                frontier_before=before,
                frontier_after=after,
                observed_at=row["observed_at"],
                prev_entry_hash=previous_hash,
            )
            expected_hash = domain_separated_id(ENTRY_FORMAT, body)
            if expected_hash != row["entry_hash"]:
                raise LedgerIntegrityError("ledger entry hash chain does not verify")
            for kind, ref in refs:
                expected_consumptions.setdefault((kind, ref), row["sequence"])
            previous_hash = expected_hash
        if expected_consumptions != stored_consumptions:
            raise LedgerIntegrityError("consumption index does not match first observations")
        for claim in action_claims:
            expected_claim = domain_separated_id(
                ACTION_CLAIM_FORMAT,
                {
                    "decision_id": claim["decision_id"],
                    "entry_sequence": claim["entry_sequence"],
                    "entry_hash": claim["entry_hash"],
                    "claimed_at": claim["claimed_at"],
                },
            )
            if (
                not bool(claim["action_authorized"])
                or claim["decision_id"] != claim["recorded_decision_id"]
                or claim["entry_hash"] != claim["recorded_entry_hash"]
                or expected_claim != claim["claim_id"]
            ):
                raise LedgerIntegrityError("action claim does not bind an authorized ledger entry")
        known_tickets: set[str] = set()
        for ticket in tickets:
            expected_ticket = domain_separated_id(
                TICKET_FORMAT,
                {
                    "decision_id": ticket["decision_id"],
                    "global_step": ticket["global_step"],
                    "ledger_entry_hash": ticket["entry_hash"],
                    "issued_at": ticket["issued_at"],
                },
            )
            if (
                expected_ticket != ticket["ticket_id"]
                or ticket["decision_id"] != ticket["recorded_decision_id"]
                or ticket["decision_id"] != ticket["claimed_decision_id"]
                or ticket["disposition"] != "authorized_checkpoint_park"
                or not bool(ticket["action_authorized"])
            ):
                raise LedgerIntegrityError("checkpoint ticket does not bind an authorized ledger entry")
            known_tickets.add(ticket["ticket_id"])
        if not ticket_consumptions.issubset(known_tickets):
            raise LedgerIntegrityError("checkpoint ticket consumption references an unknown ticket")
        for effect in effects:
            if effect["ticket_id"] not in ticket_consumptions:
                raise LedgerIntegrityError("checkpoint effect does not bind a consumed ticket")
            if (effect["state"] == "checkpoint_observed") != (
                effect["checkpoint_ref"] is not None
            ):
                raise LedgerIntegrityError(
                    "checkpoint effect state does not match its checkpoint reference"
                )
            expected_effect = domain_separated_id(
                CHECKPOINT_EFFECT_FORMAT,
                {
                    "ticket_id": effect["ticket_id"],
                    "state": effect["state"],
                    "checkpoint_ref": effect["checkpoint_ref"],
                    "evidence_ref": effect["evidence_ref"],
                    "recorded_at": effect["recorded_at"],
                },
            )
            if expected_effect != effect["effect_id"]:
                raise LedgerIntegrityError("checkpoint effect ID does not verify")
        return {
            "schema": SCHEMA_VERSION,
            "entries": len(rows),
            "head_hash": previous_hash,
            "runs": len(heads_by_run),
            "checkpoint_tickets": len(tickets),
            "checkpoint_effects": len(effects),
            "chain_valid": True,
        }
