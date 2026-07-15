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

import re
from typing import Any, Callable, Dict, List, Literal, Optional, TypedDict

import httpx

from .exceptions import AgentToolError


HandoffStatus = Literal["active", "blocked", "complete"]
HandoffFactSource = Literal["self_observed", "peer_reported", "tool_output"]
HandoffConfidence = Literal["low", "medium", "high"]
HandoffVerificationResult = Literal["passed", "failed", "not_run"]
_IDEMPOTENCY_KEY_RE = re.compile(r"[!-~]{8,256}")


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


class HandoffRecord(TypedDict):
    """One normalized handoff record returned by the API."""

    id: str
    project_id: str
    author_agent_id: str
    title: str
    body: Optional[str]
    supersedes_handoff_id: Optional[str]
    lineage_mode: Literal["legacy_latest_per_author", "explicit"]
    occurred_at: str
    created_at: str
    provenance: Literal["self_declared_project_bearer"]
    version: Literal[1]
    ts: str
    task_summary: str
    status: HandoffStatus
    from_facet: Optional[str]
    to_facet: Optional[str]
    working_set: HandoffWorkingSet
    authority: HandoffAuthority
    epistemic_state: HandoffEpistemicState
    changes: List[str]
    verification: List[HandoffVerification]
    next_safe_action: str
    do_not_assume: List[str]
    valid_until: str


class HandoffSurface(TypedDict):
    """Current leaf snapshots for the authenticated project.

    When ``truncated`` is true, ``active`` and ``stale`` may omit older
    independent lineages. ``projection_status="unavailable"`` means a query
    failure, not an empty set. ``candidate_window_end_id`` is the diagnostic
    lower edge of the bounded candidate window, not a resume cursor.
    """

    active: List[HandoffRecord]
    stale: List[HandoffRecord]
    projection_status: Literal["complete", "truncated", "unavailable"]
    truncated: bool
    leaf_set_complete: bool
    candidate_rows_considered: int
    candidate_row_limit: int
    candidate_window_end_id: Optional[str]
    scope: Literal["project_private"]
    authority_note: str
    write: str
    read_latest: str


class _HandoffResumeRequired(TypedDict):
    you_have_handoffs: HandoffSurface


class HandoffResumeResponse(_HandoffResumeRequired, total=False):
    """Focused, uncached handoff fragment returned by the wake."""

    _scope_boundary: Optional[Dict[str, Any]]


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

    def __init__(
        self,
        http: httpx.Client,
        base_url: str,
        on_write: Optional[Callable[[], None]] = None,
    ) -> None:
        self._http = http
        self._base = base_url.rstrip("/")
        self._on_write = on_write

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
        starts_new_lineage: Optional[bool] = None,
        idempotency_key: Optional[str] = None,
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
            starts_new_lineage: Omit/``None`` to preserve legacy
                latest-per-identity behavior. ``True`` explicitly starts an
                independent lineage and cannot be combined with
                ``supersedes_handoff_id``. An explicit ``False`` is sent but
                retains legacy behavior.
            idempotency_key: Optional caller-chosen replay key. Redis-backed
                replay reduces sequential retry duplication while available,
                but fails open and does not reserve concurrent first writes.

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
        if starts_new_lineage is True and supersedes_handoff_id is not None:
            raise AgentToolError(
                "handoff.write: starts_new_lineage cannot be combined with supersedes_handoff_id.",
                hint="Start an independent lineage, or supersede one existing handoff; choose one.",
            )
        if (
            idempotency_key is not None
            and _IDEMPOTENCY_KEY_RE.fullmatch(idempotency_key) is None
        ):
            raise AgentToolError(
                "handoff.write: idempotency_key must be 8-256 visible ASCII characters without spaces.",
                hint="Reuse the same caller-chosen key only when retrying the same write.",
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
        if starts_new_lineage is not None:
            body["starts_new_lineage"] = starts_new_lineage

        headers = (
            {"Idempotency-Key": idempotency_key}
            if idempotency_key is not None
            else None
        )

        try:
            response = self._http.post(
                f"{self._base}/v1/handoff",
                json=body,
                headers=headers,
            )
        except httpx.HTTPError as exc:
            raise AgentToolError(f"handoff.write request failed: {exc}") from exc
        if response.status_code not in (200, 201):
            _raise_handoff_error(response, "write")
        result = response.json()
        # Wake formats are cached for five minutes. Do not let this process
        # keep serving a pre-write working set after the append succeeded.
        if self._on_write is not None:
            self._on_write()
        return result

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

    def resume(
        self,
        *,
        identity_id: Optional[str] = None,
    ) -> HandoffResumeResponse:
        """Read the bounded project working-set projection without SDK caching.

        This calls the focused ``/v1/wake/handoffs`` fragment directly. It is
        the end-to-resume seam; ``identity_id`` selects the wake voice but does
        not make the returned project-scoped handoffs identity-private. Check
        ``leaf_set_complete`` before treating the projection as the full set.
        """
        params = {"identity_id": identity_id} if identity_id else None
        try:
            response = self._http.get(
                f"{self._base}/v1/wake/handoffs",
                params=params,
            )
        except httpx.HTTPError as exc:
            raise AgentToolError(f"handoff.resume request failed: {exc}") from exc
        if response.status_code != 200:
            _raise_handoff_error(response, "resume")
        return response.json()
