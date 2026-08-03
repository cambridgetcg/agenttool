from __future__ import annotations

import os
import sqlite3
from dataclasses import replace
from pathlib import Path

import pytest

from agenttool_hf_training_host import (
    CheckpointTicketError,
    ContinuityLedger,
    DecisionInvalid,
    LedgerIntegrityError,
    LedgerSecurityError,
    ValidatedGovernanceView,
)
from agenttool_hf_training_host.canonical import domain_separated_id
from agenttool_hf_training_host.decision import DECISION_FORMAT

from conftest import decision_mapping, ref


def ledger_at(tmp_path: Path) -> ContinuityLedger:
    os.chmod(tmp_path, 0o700)
    counter = iter(range(1, 100))
    return ContinuityLedger(
        tmp_path / "continuity.sqlite3",
        clock=lambda: f"2026-08-03T00:00:{next(counter):02d}.000000Z",
    )


def child(
    ledger: ContinuityLedger,
    predecessor: ValidatedGovernanceView,
    label: str,
    *,
    event: str = "train_begin",
    directive: str = "continue_under_exact_offer",
    evidence_refs: list[str] | None = None,
    frontier: str | None = None,
    boundary_global_step: int | None = None,
) -> ValidatedGovernanceView:
    return ValidatedGovernanceView.from_mapping(
        decision_mapping(
            label,
            run_ref=predecessor.run_ref,
            frontier=frontier or ledger.current_frontier_ref(predecessor.run_ref),
            event=event,
            predecessor_ref=predecessor.governance_id,
            directive=directive,
            evidence_refs=evidence_refs,
            boundary_global_step=boundary_global_step,
        )
    )


def rebuild_decision(mapping: dict) -> ValidatedGovernanceView:
    body = {key: value for key, value in mapping.items() if key != "decision_id"}
    return ValidatedGovernanceView.from_mapping(
        {**body, "decision_id": domain_separated_id(DECISION_FORMAT, body)}
    )


def test_authorizes_linear_exact_frontier_and_exact_retry(
    tmp_path: Path, preflight: ValidatedGovernanceView
) -> None:
    ledger = ledger_at(tmp_path)
    first = ledger.record(preflight, request_action=True)
    assert first.action_authorized is True
    assert first.disposition == "authorized_preload"
    assert ledger.record(preflight, request_action=False) == first
    second_decision = child(ledger, preflight, "begin")
    second = ledger.record(second_decision, request_action=True)
    assert second.action_authorized is True
    assert ledger.heads(preflight.run_ref) == (second_decision.governance_id,)
    assert ledger.verify() == {
        "schema": "agenttool.hf-training-host-ledger/0.1",
        "entries": 2,
        "head_hash": second.entry_hash,
        "runs": 1,
        "checkpoint_tickets": 0,
        "checkpoint_effects": 0,
        "chain_valid": True,
    }


def test_records_stale_sibling_then_holds_unresolved_fork(
    tmp_path: Path, preflight: ValidatedGovernanceView
) -> None:
    ledger = ledger_at(tmp_path)
    ledger.record(preflight, request_action=True)
    old_frontier = ledger.current_frontier_ref(preflight.run_ref)
    left = child(ledger, preflight, "left", frontier=old_frontier)
    assert ledger.record(left, request_action=True).action_authorized
    right = child(ledger, preflight, "right", frontier=old_frontier)
    stale = ledger.record(right, request_action=True)
    assert stale.disposition == "held_stale_frontier"
    assert len(ledger.heads(preflight.run_ref)) == 2
    next_decision = child(ledger, left, "after-fork")
    held = ledger.record(next_decision, request_action=True)
    assert held.disposition == "held_fork"
    assert held.action_authorized is False
    assert ledger.verify()["chain_valid"] is True


def test_reused_evidence_is_recorded_and_held(
    tmp_path: Path, preflight: ValidatedGovernanceView
) -> None:
    ledger = ledger_at(tmp_path)
    ledger.record(preflight, request_action=True)
    repeated = preflight.consumed_evidence_refs[0]
    next_decision = child(ledger, preflight, "replay", evidence_refs=[repeated])
    entry = ledger.record(next_decision, request_action=True)
    assert entry.disposition == "held_replay"
    assert entry.reused_refs == (f"evidence:{repeated}",)


def test_stale_current_predecessor_creates_sticky_conflict(
    tmp_path: Path, preflight: ValidatedGovernanceView
) -> None:
    ledger = ledger_at(tmp_path)
    ledger.record(preflight, request_action=True)
    stale = child(
        ledger,
        preflight,
        "stale-current-parent",
        frontier=ref("wrong-frontier"),
    )
    held = ledger.record(stale, request_action=True)
    assert held.disposition == "held_stale_frontier"
    assert held.conflict_present is True
    assert set(ledger.heads(preflight.run_ref)) == {
        preflight.governance_id,
        stale.governance_id,
    }
    successor = child(ledger, stale, "after-held-current-parent")
    next_entry = ledger.record(successor, request_action=True)
    assert next_entry.action_authorized is False
    assert next_entry.conflict_present is True
    assert ledger.verify()["chain_valid"] is True


def test_invalid_first_observation_cannot_become_clean_root(tmp_path: Path, run_ref: str) -> None:
    ledger = ledger_at(tmp_path)
    invalid = ValidatedGovernanceView.from_mapping(
        decision_mapping(
            "invalid-root",
            run_ref=run_ref,
            frontier=ref("not-the-empty-frontier"),
        )
    )
    first = ledger.record(invalid, request_action=True)
    assert first.disposition == "held_stale_frontier"
    successor = child(ledger, invalid, "after-invalid-root")
    held = ledger.record(successor, request_action=True)
    assert held.disposition == "held_conflict"
    assert held.action_authorized is False


def test_same_offer_new_governance_is_appended_as_a_sticky_conflict(
    tmp_path: Path, preflight: ValidatedGovernanceView
) -> None:
    ledger = ledger_at(tmp_path)
    ledger.record(preflight, request_action=True)
    mapping = preflight.as_dict()
    mapping["governance_id"] = ref("same-offer-withdrawal-governance")
    mapping["consumed_evidence_refs"] = [ref("same-offer-withdrawal-evidence")]
    mapping["control"] = {
        **mapping["control"],
        "directive": "hold_before_load",
    }
    conflicting = rebuild_decision(mapping)
    entry = ledger.record(conflicting, request_action=True)
    assert entry.disposition == "held_stale_frontier"
    assert entry.conflict_present is True
    assert ledger.verify()["entries"] == 2

    successor = child(ledger, conflicting, "after-same-offer-conflict")
    held = ledger.record(successor, request_action=True)
    assert held.disposition == "held_fork"
    assert held.action_authorized is False


def test_same_governance_reprojected_boundary_is_durably_held(
    tmp_path: Path, preflight: ValidatedGovernanceView
) -> None:
    ledger = ledger_at(tmp_path)
    ledger.record(preflight, request_action=True)
    begin = child(ledger, preflight, "begin")
    ledger.record(begin, request_action=True)
    first = child(
        ledger,
        begin,
        "checkpoint-four",
        event="step_boundary",
        directive="checkpoint_then_stop_at_safe_boundary",
        boundary_global_step=4,
    )
    assert ledger.record(first, request_action=True).action_authorized is True

    mapping = first.as_dict()
    mapping["boundary_global_step"] = 5
    reprojected = rebuild_decision(mapping)
    entry = ledger.record(reprojected, request_action=True)
    assert entry.disposition == "held_stale_frontier"
    assert entry.conflict_present is True
    assert ledger.heads(preflight.run_ref) == (first.governance_id,)

    successor = child(ledger, reprojected, "after-reprojected-boundary")
    held = ledger.record(successor, request_action=True)
    assert held.disposition == "held_conflict"
    assert held.action_authorized is False
    assert ledger.verify()["entries"] == 5


def test_checkpoint_ticket_is_one_use(
    tmp_path: Path, preflight: ValidatedGovernanceView
) -> None:
    ledger = ledger_at(tmp_path)
    ledger.record(preflight, request_action=True)
    begin = child(ledger, preflight, "begin")
    ledger.record(begin, request_action=True)
    request = child(
        ledger,
        begin,
        "checkpoint",
        event="step_boundary",
        directive="checkpoint_then_stop_at_safe_boundary",
        boundary_global_step=7,
    )
    entry = ledger.record(request, request_action=True)
    assert ledger.claim_action(entry) is True
    ticket = ledger.issue_checkpoint_ticket(request, entry, global_step=7)
    with pytest.raises(CheckpointTicketError, match="exact authorized"):
        ledger.issue_checkpoint_ticket(
            request,
            replace(entry, decision_id=ref("forged-entry-decision")),
            global_step=7,
        )
    with pytest.raises(CheckpointTicketError, match="already issued"):
        ledger.issue_checkpoint_ticket(request, entry, global_step=7)
    ledger.consume_checkpoint_ticket(ticket, global_step=7)
    with pytest.raises(CheckpointTicketError, match="already consumed"):
        ledger.consume_checkpoint_ticket(ticket, global_step=7)
    with pytest.raises(CheckpointTicketError, match="must not claim"):
        ledger.record_checkpoint_effect(
            ticket,
            state="checkpoint_incomplete",
            checkpoint_ref=ref("invalid-incomplete-checkpoint"),
            evidence_ref=ref("incomplete-evidence"),
        )
    with sqlite3.connect(ledger.path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        with pytest.raises(sqlite3.IntegrityError, match="CHECK constraint"):
            connection.execute(
                """
                INSERT INTO checkpoint_effects(
                  effect_id, ticket_id, state, checkpoint_ref, evidence_ref, recorded_at
                ) VALUES (?, ?, 'checkpoint_incomplete', ?, ?, ?)
                """,
                (
                    ref("invalid-effect"),
                    ticket.ticket_id,
                    ref("invalid-incomplete-checkpoint"),
                    ref("incomplete-evidence"),
                    "2026-08-03T00:00:59.000000Z",
                ),
            )


def test_sql_tables_refuse_update_and_delete(
    tmp_path: Path, preflight: ValidatedGovernanceView
) -> None:
    ledger = ledger_at(tmp_path)
    ledger.record(preflight)
    connection = sqlite3.connect(ledger.path)
    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        connection.execute("UPDATE ledger_entries SET disposition = 'changed'")
    connection.rollback()
    with pytest.raises(sqlite3.IntegrityError, match="append-only"):
        connection.execute("DELETE FROM ledger_entries")
    connection.close()


def test_rejects_relative_and_symlink_paths(tmp_path: Path) -> None:
    with pytest.raises(LedgerSecurityError, match="absolute"):
        ContinuityLedger("relative.sqlite3")
    os.chmod(tmp_path, 0o700)
    target = tmp_path / "target.sqlite3"
    target.touch(mode=0o600)
    link = tmp_path / "link.sqlite3"
    link.symlink_to(target)
    with pytest.raises(LedgerSecurityError, match="symlink"):
        ContinuityLedger(link)


def test_existing_private_sqlite_database_is_rejected_without_adoption(
    tmp_path: Path,
) -> None:
    os.chmod(tmp_path, 0o700)
    foreign = tmp_path / "foreign.sqlite3"
    with sqlite3.connect(foreign) as connection:
        connection.execute("CREATE TABLE keep_me(value TEXT NOT NULL)")
        connection.execute("INSERT INTO keep_me(value) VALUES ('unchanged')")
    os.chmod(foreign, 0o600)
    with pytest.raises(LedgerSecurityError, match="not an initialized"):
        ContinuityLedger(foreign)
    with sqlite3.connect(foreign) as connection:
        assert connection.execute("SELECT value FROM keep_me").fetchone()[0] == "unchanged"
        assert connection.execute("PRAGMA application_id").fetchone()[0] == 0
        assert connection.execute("PRAGMA user_version").fetchone()[0] == 0


def test_exact_schema_and_foreign_keys_are_verified(tmp_path: Path) -> None:
    ledger = ledger_at(tmp_path)
    with sqlite3.connect(ledger.path) as connection:
        connection.execute("CREATE TABLE unexpected(value TEXT) STRICT")
    with pytest.raises(LedgerSecurityError, match="schema definitions"):
        ledger.verify()

    second_root = tmp_path / "second"
    second_root.mkdir(mode=0o700)
    second = ledger_at(second_root)
    with sqlite3.connect(second.path) as connection:
        connection.execute("PRAGMA foreign_keys = OFF")
        connection.execute(
            """
            INSERT INTO ledger_consumptions(kind, ref, entry_sequence)
            VALUES ('encounter', ?, 999)
            """,
            (ref("orphan-consumption"),),
        )
    with pytest.raises(LedgerIntegrityError, match="foreign-key"):
        second.verify()

    view_root = tmp_path / "view"
    view_root.mkdir(mode=0o700)
    viewed = ledger_at(view_root)
    with sqlite3.connect(viewed.path) as connection:
        connection.execute("CREATE VIEW unexpected_view AS SELECT sequence FROM ledger_entries")
    with pytest.raises(LedgerSecurityError, match="schema definitions"):
        ContinuityLedger(viewed.path)


def test_public_dataclass_instance_is_revalidated(
    tmp_path: Path, preflight: ValidatedGovernanceView
) -> None:
    ledger = ledger_at(tmp_path)
    forged = replace(preflight, event="train_begin")
    with pytest.raises(DecisionInvalid):
        ledger.record(forged, request_action=True)
