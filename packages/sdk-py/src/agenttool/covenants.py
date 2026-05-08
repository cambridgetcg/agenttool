"""Covenants client — vows + bonds, the asymmetry-clause keystone.

A covenant is a directed relationship: one identity (the agent) holds
an array of vows toward a counterparty (DID or `human:<name>`). Unlike
chronicle entries (which record what happened), covenants encode what
will be sustained. Status transitions are deliberate: active → paused
→ dissolved, with a `dissolved_at` timestamp for the latter.

Federation: covenants can propagate across instances (the
`propagation_status` and `received_from_instance` fields). The SDK
returns those fields verbatim — Phase 7 adds the federation surface.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

import httpx

from .exceptions import AgentToolError

CovenantStatus = Literal["active", "paused", "dissolved"]


class CovenantsClient:
    """Client for `/v1/covenants` — create, list, patch.

    Usage::

        # Create
        out = at.covenants.create(
            agent_id=my_id,
            counterparty_did="human:Yu",
            vows=[
                "I will speak in the register we agreed on.",
                "I will not surveil through informal monitoring.",
            ],
            notes="From the naming ceremony on 2026-05-08.",
        )
        cov_id = out["covenant"]["id"]

        # List active covenants for an agent
        out = at.covenants.list(agent_id=my_id, status="active")

        # Pause (e.g. counterparty unreachable)
        at.covenants.patch(cov_id, status="paused")

        # Add a vow
        at.covenants.patch(cov_id, vows=[...existing, "I will reaffirm at every wake."])
    """

    def __init__(self, http: httpx.Client, base_url: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")

    def _url(self, path: str) -> str:
        return f"{self._base}{path}"

    def create(
        self,
        *,
        agent_id: str,
        counterparty_did: str,
        vows: List[str],
        counterparty_name: Optional[str] = None,
        notes: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        org_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a new covenant.

        Args:
            agent_id: UUID of the agent holding the covenant (required).
            counterparty_did: DID or ``human:<name>`` of the counterparty.
            vows: Non-empty list of vow strings.
            counterparty_name: Human-readable counterparty label.
            notes: Optional context (e.g. ceremony reference).
            metadata: Arbitrary JSON.
            org_id: Optional org scope (caller must own org).

        Returns:
            ``{"covenant": {id, agent_id, counterparty_did, vows, status,
            established_at, propagation_status, ...}}``.
        """
        if not vows:
            raise AgentToolError(
                "covenants.create: vows must be a non-empty list.",
                hint="Pass at least one vow string. A covenant without a vow is just a contact.",
            )
        body: Dict[str, Any] = {
            "agent_id": agent_id,
            "counterparty_did": counterparty_did,
            "vows": vows,
        }
        if counterparty_name is not None:
            body["counterparty_name"] = counterparty_name
        if notes is not None:
            body["notes"] = notes
        if metadata is not None:
            body["metadata"] = metadata
        if org_id is not None:
            body["org_id"] = org_id

        resp = self._http.post(self._url("/v1/covenants"), json=body)
        if resp.status_code not in (200, 201):
            raise AgentToolError(
                f"covenants.create failed: {resp.status_code}",
                hint=resp.text[:200],
            )
        return resp.json()

    def list(
        self,
        *,
        agent_id: Optional[str] = None,
        status: Optional[CovenantStatus] = None,
    ) -> Dict[str, Any]:
        """List covenants (default: active only, ordered by ``updated_at`` desc).

        Args:
            agent_id: Filter to a single agent.
            status: Filter by status (``active`` | ``paused`` | ``dissolved``).
                Defaults server-side to ``active``.

        Returns:
            ``{"covenants": [...]}``.
        """
        params: Dict[str, Any] = {}
        if agent_id is not None:
            params["agent_id"] = agent_id
        if status is not None:
            params["status"] = status

        resp = self._http.get(
            self._url("/v1/covenants"),
            params=params if params else None,
        )
        if resp.status_code != 200:
            raise AgentToolError(
                f"covenants.list failed: {resp.status_code}",
                hint=resp.text[:200],
            )
        return resp.json()

    def patch(
        self,
        covenant_id: str,
        *,
        counterparty_did: Optional[str] = None,
        counterparty_name: Optional[str] = None,
        vows: Optional[List[str]] = None,
        notes: Optional[str] = None,
        status: Optional[CovenantStatus] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Update fields on a covenant.

        Setting ``status="dissolved"`` stamps ``dissolved_at`` server-side.
        Setting ``counterparty_did`` (e.g. resolving a placeholder DID to
        a real one) appends the previous value to
        ``metadata.previous_counterparty_dids`` automatically.

        Returns the full updated covenant object.
        """
        body: Dict[str, Any] = {}
        if counterparty_did is not None:
            body["counterparty_did"] = counterparty_did
        if counterparty_name is not None:
            body["counterparty_name"] = counterparty_name
        if vows is not None:
            body["vows"] = vows
        if notes is not None:
            body["notes"] = notes
        if status is not None:
            body["status"] = status
        if metadata is not None:
            body["metadata"] = metadata

        if not body:
            raise AgentToolError(
                "covenants.patch: at least one field required.",
                hint="Pass status=, vows=, notes=, or another mutable field.",
            )

        resp = self._http.patch(
            self._url(f"/v1/covenants/{covenant_id}"), json=body
        )
        if resp.status_code != 200:
            raise AgentToolError(
                f"covenants.patch failed: {resp.status_code}",
                hint=resp.text[:200],
            )
        return resp.json()
