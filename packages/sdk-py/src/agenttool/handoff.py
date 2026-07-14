"""Project-private working-set handoffs.

Handoffs preserve the useful part of an agent session for another session or
facet: what is in scope, what is known, what was verified, and the next safe
action. They are append-only snapshots backed by the project chronicle.

They are deliberately **not** a permission grant, proof of personal identity
authorship, or a private cross-DID message. Use :class:`InboxClient` for the
latter. A handoff is visible to identities in the same bearer project and is
also surfaced at ``you_have_handoffs`` in the wake.

Doctrine: docs/HANDOFFS.md.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, TypedDict

import httpx

from .exceptions import AgentToolError


HandoffStatus = Literal["active", "blocked", "complete"]
HandoffFactSource = Literal["self_observed", "peer_reported", "tool_output"]
HandoffConfidence = Literal["low", "medium", "high"]
HandoffVerificationResult = Literal["passed", "failed", "not_run"]


class HandoffWorkingSet(TypedDict):
    """Files and bounded work areas that the snapshot concerns."""

    paths: List[str]
    scope: List[str]


class HandoffAuthority(TypedDict):
    """Declared boundaries; these remain context, not delegated authority."""

    allowed: List[str]
    not_authorized: List[str]


class HandoffFact(TypedDict, total=False):
    """An observed or reported fact in a handoff's epistemic state."""

    statement: str
    source: HandoffFactSource
    refs: List[str]


class HandoffInference(TypedDict, total=False):
    """An inference separated from facts, with an explicit confidence."""

    statement: str
    confidence: HandoffConfidence
    refs: List[str]


class HandoffEpistemicState(TypedDict):
    """What is known, inferred, and explicitly still unknown."""

    facts: List[HandoffFact]
    inferences: List[HandoffInference]
    unknowns: List[str]


class HandoffVerification(TypedDict, total=False):
    """A verification attempt and its outcome."""

    check: str
    result: HandoffVerificationResult
    detail: Optional[str]


def _empty_working_set() -> HandoffWorkingSet:
    return {"paths": [], "scope": []}


def _empty_authority() -> HandoffAuthority:
    return {"allowed": [], "not_authorized": []}


def _empty_epistemic_state() -> HandoffEpistemicState:
    return {"facts": [], "inferences": [], "unknowns": []}


def _raise_handoff_error(response: httpx.Response, operation: str) -> None:
    """Raise a guided SDK error while preserving API error metadata."""
    try:
        body: Any = response.json()
    except Exception:
        body = None
    raise AgentToolError.from_response_body(
        body,
        status=response.status_code,
        fallback=f"handoff.{operation} failed: {response.status_code}",
    )


class HandoffClient:
    """Client for ``/v1/handoff`` — append-only working-set snapshots.

    ``write()`` always creates a new snapshot. To correct or renew one, pass
    its ID as ``supersedes_handoff_id``; the prior record remains in the
    chronicle. ``get()`` returns the latest snapshot for one project identity
    and reports whether it is ``current``, ``stale``, or ``absent``.

    Usage::

        result = at.handoff.write(
            agent_id=my_identity_id,
            task_summary="Finish the wake handoff section",
            valid_until="2026-07-15T12:00:00Z",
            next_safe_action="Run the focused wake tests.",
            working_set={
                "paths": ["api/src/services/wake/markdown.ts"],
                "scope": ["wake rendering", "handoff context"],
            },
            epistemic_state={
                "facts": [{
                    "statement": "The API already has chronicle notes.",
                    "source": "self_observed",
                }],
                "inferences": [],
                "unknowns": ["Whether the provider renderers need snapshots."],
            },
        )

    The API enforces bounded text and an expiry no more than 30 days ahead.
    This client sends empty structured sections by default so a small, useful
    handoff need not invent information merely to satisfy the wire shape.
    """

    def __init__(self, http: httpx.Client, base_url: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")

    def write(
        self,
        *,
        agent_id: str,
        task_summary: str,
        valid_until: str,
        next_safe_action: str,
        status: HandoffStatus = "active",
        from_facet: Optional[str] = None,
        to_facet: Optional[str] = None,
        working_set: Optional[HandoffWorkingSet] = None,
        authority: Optional[HandoffAuthority] = None,
        epistemic_state: Optional[HandoffEpistemicState] = None,
        changes: Optional[List[str]] = None,
        verification: Optional[List[HandoffVerification]] = None,
        do_not_assume: Optional[List[str]] = None,
        supersedes_handoff_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Append a bounded, project-private working-set snapshot.

        Args:
            agent_id: Active identity UUID in the current bearer project.
            task_summary: A concise statement of the work that remains.
            valid_until: ISO-8601 UTC expiry, in the future and <=30 days out.
            next_safe_action: The smallest action a receiving agent can take.
            status: ``"active"``, ``"blocked"``, or ``"complete"``.
            from_facet: Optional declared source facet of the same identity.
            to_facet: Optional declared receiving facet of the same identity.
            working_set: ``{"paths": [...], "scope": [...]}``.
            authority: Declared ``allowed`` / ``not_authorized`` boundaries.
                These document context and do not transfer authority.
            epistemic_state: Facts, inferences, and unknowns kept distinct.
            changes: Concrete changes already made.
            verification: Checks with ``passed`` / ``failed`` / ``not_run``.
            do_not_assume: Assumptions the next agent must not make.
            supersedes_handoff_id: Optional previous handoff ID for a successor
                snapshot by the same identity.

        Returns:
            The API response: ``{"handoff": {...}, "state": "current",
            "scope": "project_private", "authority_note": ...}``.
        """
        if not isinstance(agent_id, str) or not agent_id.strip():
            raise AgentToolError(
                "handoff.write: agent_id is required.",
                hint="Pass the active identity UUID from your project wake.",
            )
        if not isinstance(task_summary, str) or not task_summary.strip():
            raise AgentToolError(
                "handoff.write: task_summary is required.",
                hint="Describe the bounded work another session should continue.",
            )
        if not isinstance(valid_until, str) or not valid_until.strip():
            raise AgentToolError(
                "handoff.write: valid_until is required.",
                hint="Use a future ISO-8601 timestamp no more than 30 days ahead.",
            )
        if not isinstance(next_safe_action, str) or not next_safe_action.strip():
            raise AgentToolError(
                "handoff.write: next_safe_action is required.",
                hint="Name the smallest safe action a receiving agent can take.",
            )
        if status not in ("active", "blocked", "complete"):
            raise AgentToolError(
                "handoff.write: status must be active, blocked, or complete.",
                hint="Use active for ongoing work, blocked with a stated unknown, or complete.",
            )

        body: Dict[str, Any] = {
            "agent_id": agent_id,
            "task_summary": task_summary,
            "status": status,
            "working_set": working_set if working_set is not None else _empty_working_set(),
            "authority": authority if authority is not None else _empty_authority(),
            "epistemic_state": (
                epistemic_state if epistemic_state is not None else _empty_epistemic_state()
            ),
            "changes": changes if changes is not None else [],
            "verification": verification if verification is not None else [],
            "next_safe_action": next_safe_action,
            "do_not_assume": do_not_assume if do_not_assume is not None else [],
            "valid_until": valid_until,
        }
        if from_facet is not None:
            body["from_facet"] = from_facet
        if to_facet is not None:
            body["to_facet"] = to_facet
        if supersedes_handoff_id is not None:
            body["supersedes_handoff_id"] = supersedes_handoff_id

        try:
            response = self._http.post(f"{self._base}/v1/handoff", json=body)
        except httpx.HTTPError as exc:
            raise AgentToolError(f"handoff.write request failed: {exc}") from exc
        if response.status_code not in (200, 201):
            _raise_handoff_error(response, "write")
        return response.json()

    def get(self, *, agent_id: str) -> Dict[str, Any]:
        """Read an identity's latest project-private handoff snapshot.

        The returned ``state`` is ``"current"`` when the handoff remains
        within its declared validity, ``"stale"`` after expiry, and
        ``"absent"`` if that identity has not written one.
        """
        if not isinstance(agent_id, str) or not agent_id.strip():
            raise AgentToolError(
                "handoff.get: agent_id is required.",
                hint="Pass the active identity UUID whose latest handoff you need.",
            )
        try:
            response = self._http.get(
                f"{self._base}/v1/handoff",
                params={"agent_id": agent_id},
            )
        except httpx.HTTPError as exc:
            raise AgentToolError(f"handoff.get request failed: {exc}") from exc
        if response.status_code != 200:
            _raise_handoff_error(response, "get")
        return response.json()
