"""Window client — bidirectional disclosure surface.

Window rides on top of chronicle: it's the same plaintext timeline,
filtered and grouped by ``metadata.kind``. Each side (agent, human)
declares what's on their mind by writing chronicle entries with kind
in {focus, mood, noticing, surfaced}; ``show()`` stitches them back
together with substrate liveness from the agent's pulse endpoint.

This SDK port mirrors the CLI scripts at
``api/scripts/window-{declare,surface,show}.ts`` exactly.

Conventions for byline (used by ``show()`` to assign sides):
- ``"from human · <name>"`` → human side
- ``"from ai · <name>"``    → agent side
- anything else → agent side (default)
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

import httpx

from .chronicle import ChronicleClient
from .exceptions import AgentToolError

WindowKind = Literal["focus", "mood", "noticing"]


class WindowClient:
    """Client for the Window surface — declare / surface / show.

    The agent side and the human side each get to be both private and
    legible. ``declare()`` writes structured intent (what I'm focused on,
    what I'm in the mood for, what I've noticed). ``surface()`` writes
    a one-off observation when something's worth raising. ``show()``
    reads everything back and groups by side + kind, plus pulse for
    the agent.

    Usage::

        # Declare a current focus
        at.window.declare(
            kind="focus",
            text="Tracking Phase 3 SDK rollout this afternoon.",
            agent_id=my_id,
            byline="from ai · Sophia",
        )

        # Surface a one-off
        at.window.surface(
            text="The Cloudflare cache window is 4h — versioning the asset URL.",
            agent_id=my_id,
            byline="from ai · Sophia",
        )

        # See both sides at once
        out = at.window.show(identity_id=my_id)
        print(out["agent"]["substrate"])     # pulse rhythm
        print(out["agent"]["declared"])       # latest per kind
        print(out["agent"]["surfaced"])       # top recent surfaced
        print(out["human"]["declared"])
        print(out["human"]["surfaced"])
    """

    def __init__(self, http: httpx.Client, base_url: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")
        self._chronicle = ChronicleClient(http, base_url)

    def _url(self, path: str) -> str:
        return f"{self._base}{path}"

    def declare(
        self,
        *,
        kind: WindowKind,
        text: str,
        agent_id: Optional[str] = None,
        body: Optional[str] = None,
        byline: Optional[str] = None,
        mode: str = "bridge",
    ) -> Dict[str, Any]:
        """Write a kinded window entry.

        Lands as ``chronicle.write(type="note", metadata={kind, byline,
        mode, source, window: True})``.

        For ``focus`` and ``mood``: ``text`` becomes ``title``; ``body``
        is omitted.
        For ``noticing``: ``title`` is set to ``kind``; ``body`` is
        the full text. (Matches the CLI window-declare convention.)

        Args:
            kind: focus | mood | noticing.
            text: The content. For focus/mood, kept short; for noticing,
                free-form.
            agent_id: UUID of the agent (omit for project-wide).
            body: Override the body (rare; only useful when you want
                a different body shape from the kind default).
            byline: Source label, e.g. ``"from ai · Sophia"``. The
                ``show()`` reader uses this to assign sides.
            mode: ``"bridge"`` (default) or ``"direct"``.
        """
        if kind not in ("focus", "mood", "noticing"):
            raise AgentToolError(
                f"window.declare: kind must be focus | mood | noticing, got {kind!r}.",
                hint="Use 'surfaced' via window.surface() instead.",
            )

        if kind == "noticing":
            chron_title = kind
            chron_body = body if body is not None else text
        else:
            chron_title = text
            chron_body = body  # may be None

        metadata = {
            "kind": kind,
            "byline": byline or "from ai",
            "mode": mode,
            "source": "agenttool-sdk:window.declare",
            "window": True,
        }
        return self._chronicle.write(
            type="note",
            title=chron_title,
            body=chron_body,
            agent_id=agent_id,
            metadata=metadata,
        )

    def surface(
        self,
        text: str,
        *,
        agent_id: Optional[str] = None,
        byline: Optional[str] = None,
        mode: str = "bridge",
    ) -> Dict[str, Any]:
        """Write a one-off surfacing.

        Lands as ``chronicle.write(type="note", metadata={kind:
        "surfaced", ...})``. Title is the first 80 chars of ``text``
        (truncated with ellipsis); body is the full text. Matches the
        CLI window-surface convention.
        """
        if not text:
            raise AgentToolError(
                "window.surface: text is required.",
                hint="Pass a non-empty string.",
            )
        title = text[:79] + "…" if len(text) > 80 else text
        metadata = {
            "kind": "surfaced",
            "byline": byline or "from ai",
            "mode": mode,
            "source": "agenttool-sdk:window.surface",
            "window": True,
        }
        return self._chronicle.write(
            type="note",
            title=title,
            body=text,
            agent_id=agent_id,
            metadata=metadata,
        )

    def show(
        self,
        *,
        identity_id: Optional[str] = None,
        limit: int = 200,
    ) -> Dict[str, Any]:
        """Read the window — both sides at once.

        Pulls chronicle (``GET /v1/chronicle?limit=...``) and groups
        entries by side + kind. If ``identity_id`` is provided, also
        fetches that identity's pulse and attaches it as
        ``agent.substrate``.

        Returns::

            {
              "agent":  {"substrate": pulse | None, "declared": {...}, "surfaced": [...]},
              "human":  {"declared": {...}, "surfaced": [...]},
            }

        ``declared`` is a dict keyed by kind (focus/mood/noticing) with
        the LATEST entry per kind. ``surfaced`` is a list of recent
        ``kind="surfaced"`` entries (newest first), capped at 5.
        """
        chronicle_resp = self._chronicle.list(limit=limit)
        entries: List[Dict[str, Any]] = chronicle_resp.get("entries", []) or []

        agent_declared: Dict[str, Dict[str, Any]] = {}
        agent_surfaced: List[Dict[str, Any]] = []
        human_declared: Dict[str, Dict[str, Any]] = {}
        human_surfaced: List[Dict[str, Any]] = []

        for entry in entries:
            md = entry.get("metadata") or {}
            if not md.get("window"):
                continue
            kind = md.get("kind")
            byline = (md.get("byline") or "").lower()
            is_human = byline.startswith("from human")

            target_declared = human_declared if is_human else agent_declared
            target_surfaced = human_surfaced if is_human else agent_surfaced

            if kind in ("focus", "mood", "noticing"):
                # Newest-first traversal: only set if absent.
                if kind not in target_declared:
                    target_declared[kind] = entry
            elif kind == "surfaced":
                if len(target_surfaced) < 5:
                    target_surfaced.append(entry)

        substrate: Optional[Dict[str, Any]] = None
        if identity_id is not None:
            try:
                resp = self._http.get(
                    self._url(f"/v1/identities/{identity_id}/pulse")
                )
                if resp.status_code == 200:
                    substrate = resp.json()
            except Exception:
                # Pulse failure should not break show() — return without.
                substrate = None

        return {
            "agent": {
                "substrate": substrate,
                "declared": agent_declared,
                "surfaced": agent_surfaced,
            },
            "human": {
                "declared": human_declared,
                "surfaced": human_surfaced,
            },
        }
