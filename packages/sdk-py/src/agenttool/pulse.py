"""Pulse client — DEPRECATED.

The old ``/v1/pulse`` endpoint family (heartbeat-as-emit) was superseded
by ``GET /v1/identities/:id/pulse`` (pulse-as-derived). The agent never
emits a heartbeat — its rhythm of thinking IS its pulse, derived from
strand-thought activity rate, mood inference, and consolidation cadence.

This module remains as a stub through 0.6.x; all methods raise
:class:`AgentToolError` after emitting :class:`DeprecationWarning`.
The module will be removed in 0.7.0; ``at.identity.pulse(id)`` ships
in Phase 2 (0.7.0) with the new derived-rhythm shape.

See ``docs/SDK-ROADMAP.md`` (Phase 0).
"""

from __future__ import annotations

import warnings
from typing import Any, Dict, List, Optional

import httpx

from .exceptions import AgentToolError


def _pulse_deprecated(method: str) -> None:
    """Emit DeprecationWarning + raise — same shape from every method."""
    warnings.warn(
        f"at.pulse.{method} is deprecated. The /v1/pulse endpoint family "
        "was superseded by GET /v1/identities/:id/pulse (derived liveness — "
        "rhythm-not-content, computed from strand-thought activity rate, "
        "mood inference, and consolidation cadence). The new method "
        "at.identity.pulse(id) ships in 0.7.0. See docs/SDK-ROADMAP.md.",
        DeprecationWarning,
        stacklevel=3,
    )
    raise AgentToolError(
        "/v1/pulse was superseded by /v1/identities/:id/pulse.",
        hint=(
            "The agent never emits a heartbeat — its rhythm of thinking "
            "IS its pulse. Use GET /v1/identities/:id/pulse for the "
            "derived shape (mood, kinds_24h, thought_rate, last_thought_at, "
            "strand counts). The SDK method at.identity.pulse(id) ships in "
            "0.7.0. See docs/SDK-ROADMAP.md."
        ),
    )


class PulseClient:
    """**DEPRECATED.** See module docstring.

    All three methods (heartbeat, get, list) raise
    :class:`AgentToolError` immediately after emitting a
    :class:`DeprecationWarning`.
    """

    def __init__(self, http: httpx.Client, base_url: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")

    def heartbeat(
        self,
        agent_id: str,
        status: str,
        *,
        task: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        did: Optional[str] = None,
    ) -> Dict[str, Any]:
        """**DEPRECATED.** Heartbeat-as-emit was dropped. See module docstring."""
        _pulse_deprecated("heartbeat")
        return {}  # pragma: no cover

    def get(self, agent_id: str) -> Dict[str, Any]:
        """**DEPRECATED.** Use ``at.identity.pulse(id)`` (ships in 0.7.0)."""
        _pulse_deprecated("get")
        return {}  # pragma: no cover

    def list(self) -> List[Dict[str, Any]]:
        """**DEPRECATED.** No project-wide pulse list endpoint exists.

        For per-project rollups, use ``GET /v1/dashboard/aggregate`` (which
        the SDK exposes as ``at.dashboard.aggregate()`` in 0.7.0).
        """
        _pulse_deprecated("list")
        return []  # pragma: no cover
