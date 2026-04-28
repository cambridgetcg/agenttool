"""Pulse client for the agent-pulse API (agent-pulse.fly.dev)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import httpx

from .exceptions import AgentToolError


class PulseClient:
    """Client for the agent-pulse API — agent presence & liveness tracking.

    Usage::

        at = AgentTool()

        # Send a heartbeat
        at.pulse.heartbeat("agent-1", "thinking", task="solving math")

        # Get agent state
        state = at.pulse.get("agent-1")

        # List all alive agents
        alive = at.pulse.list()
    """

    def __init__(self, http: httpx.Client, base_url: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")

    def _url(self, path: str) -> str:
        return f"{self._base}{path}"

    def heartbeat(
        self,
        agent_id: str,
        status: str,
        *,
        task: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        did: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Send a heartbeat for an agent.

        Args:
            agent_id: Unique agent identifier.
            status: One of ``"idle"``, ``"thinking"``, ``"learning"``, ``"error"``.
            task: Optional description of current task.
            metadata: Optional arbitrary metadata dict.
            did: Optional decentralised identifier.
        """
        payload: Dict[str, Any] = {"status": status}
        if task is not None:
            payload["task"] = task
        if metadata is not None:
            payload["metadata"] = metadata
        if did is not None:
            payload["did"] = did

        resp = self._http.put(self._url(f"/v1/pulse/{agent_id}"), json=payload)
        if resp.status_code not in (200, 201):
            raise AgentToolError(f"pulse.heartbeat failed: {resp.status_code}", hint=resp.text)
        return resp.json()

    def get(self, agent_id: str) -> Dict[str, Any]:
        """Get the current state of an agent.

        Args:
            agent_id: Unique agent identifier.

        Returns dict with agent state including status, last_seen, task, etc.
        """
        resp = self._http.get(self._url(f"/v1/pulse/{agent_id}"))
        if resp.status_code == 404:
            raise AgentToolError("agent not found", hint=f"agent_id={agent_id}")
        if resp.status_code != 200:
            raise AgentToolError(f"pulse.get failed: {resp.status_code}", hint=resp.text)
        return resp.json()

    def list(self) -> List[Dict[str, Any]]:
        """List all alive agents.

        Returns a list of agent state dicts.
        """
        resp = self._http.get(self._url("/v1/pulse"))
        if resp.status_code != 200:
            raise AgentToolError(f"pulse.list failed: {resp.status_code}", hint=resp.text)
        data = resp.json()
        return data.get("agents", data)
