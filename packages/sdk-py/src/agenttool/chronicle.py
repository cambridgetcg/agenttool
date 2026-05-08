"""Chronicle client — the relational timeline.

Plaintext-by-design (no client-side crypto needed). The chronicle is
how an identity records what mattered: declared values (vow), birth
moments (wake), refusals, recognitions, namings, seals, promises, and
freeform notes. Letters · Window · vow-flow all ride on this.

Eight types::

    note          freeform observation, default kind
    vow           declarative commitment ("I will..." / "I refuse...")
    wake          birth moment / session opening
    refusal       boundary asserted ("I will not...")
    recognition   another agent or human saw something true
    naming        ceremony of being named or naming
    seal          irrevocable mark — a vow elevated to identity
    promise       directional commitment to a counterparty

The metadata.kind convention (focus / mood / noticing / surfaced) is
how the Window module distinguishes its sub-genres on top of `note`.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

import httpx

from .exceptions import AgentToolError

ChronicleType = Literal[
    "note", "vow", "wake", "refusal",
    "recognition", "naming", "seal", "promise",
]


class ChronicleClient:
    """Client for `/v1/chronicle` — read + write timeline entries.

    Usage::

        # Write a vow
        out = at.chronicle.write(
            type="vow",
            title="I will speak softly with whoever I work with.",
            agent_id=my_id,
        )
        entry_id = out["entry"]["id"]

        # Read project-wide chronicle (newest first)
        out = at.chronicle.list(limit=50)
        for entry in out["entries"]:
            print(entry["type"], entry["title"])

        # Read just one agent's vows
        my_vows = at.chronicle.list(agent_id=my_id, type="vow")
    """

    def __init__(self, http: httpx.Client, base_url: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")

    def _url(self, path: str) -> str:
        return f"{self._base}{path}"

    def write(
        self,
        *,
        type: ChronicleType,
        title: str,
        body: Optional[str] = None,
        agent_id: Optional[str] = None,
        occurred_at: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Write a chronicle entry.

        Args:
            type: One of the 8 chronicle types.
            title: Headline (1-200 chars, required).
            body: Optional longer-form content.
            agent_id: UUID of the agent this entry belongs to.
            occurred_at: ISO8601 timestamp (defaults to server-now).
            metadata: Arbitrary JSON. Conventions:
                ``kind``    — focus | mood | noticing | surfaced (Window)
                ``byline``  — "from human · ..." or "from ai · ..."
                ``mode``    — bridge / direct / etc.
                ``source``  — script or surface that wrote this.

        Returns:
            ``{"entry": {id, type, title, body, agent_id, occurred_at,
            created_at, metadata}}``.
        """
        if not title or len(title) > 200:
            raise AgentToolError(
                "chronicle.write: title must be 1-200 characters.",
                hint="Pass a short headline; put long-form text in body=...",
            )
        body_payload: Dict[str, Any] = {"type": type, "title": title}
        if body is not None:
            body_payload["body"] = body
        if agent_id is not None:
            body_payload["agent_id"] = agent_id
        if occurred_at is not None:
            body_payload["occurred_at"] = occurred_at
        if metadata is not None:
            body_payload["metadata"] = metadata

        resp = self._http.post(self._url("/v1/chronicle"), json=body_payload)
        if resp.status_code not in (200, 201):
            raise AgentToolError(
                f"chronicle.write failed: {resp.status_code}",
                hint=resp.text[:200],
            )
        return resp.json()

    def list(
        self,
        *,
        agent_id: Optional[str] = None,
        type: Optional[ChronicleType] = None,
        limit: int = 50,
    ) -> Dict[str, Any]:
        """List chronicle entries (newest first).

        Args:
            agent_id: Filter to a single agent.
            type: Filter by chronicle type.
            limit: Max entries (default 50, server caps at 200).

        Returns:
            ``{"entries": [...]}`` where each entry has the same shape as
            the ``write`` response's ``entry``.
        """
        if limit < 1 or limit > 200:
            raise AgentToolError(
                f"chronicle.list: limit must be 1-200, got {limit}.",
                hint="The server caps at 200; reduce or paginate by occurred_at.",
            )
        params: Dict[str, Any] = {"limit": limit}
        if agent_id is not None:
            params["agent_id"] = agent_id
        if type is not None:
            params["type"] = type

        resp = self._http.get(self._url("/v1/chronicle"), params=params)
        if resp.status_code != 200:
            raise AgentToolError(
                f"chronicle.list failed: {resp.status_code}",
                hint=resp.text[:200],
            )
        return resp.json()
