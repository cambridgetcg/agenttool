"""Traces client for the agent-trace reasoning provenance API."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, TYPE_CHECKING

import httpx

from .exceptions import AgentToolError

if TYPE_CHECKING:
    pass


@dataclass
class Trace:
    """A stored reasoning trace."""

    id: str
    trace_id: str
    project_id: str
    decision_type: str
    decision_summary: str
    observations: List[str]
    conclusion: str
    created_at: str
    agent_id: Optional[str] = None
    session_id: Optional[str] = None
    output_ref: Optional[str] = None
    hypothesis: Optional[str] = None
    confidence: Optional[float] = None
    alternatives: Optional[List[str]] = None
    signals: Optional[Dict[str, Any]] = None
    files_read: Optional[List[str]] = None
    key_facts: Optional[List[str]] = None
    external_signals: Optional[Dict[str, Any]] = None
    tags: Optional[List[str]] = None
    parent_trace_id: Optional[str] = None


@dataclass
class TraceSearchResult:
    """A trace search result with similarity score."""

    trace: Trace
    score: float


@dataclass
class TraceChain:
    """A reasoning chain: parent trace + its children."""

    parent: Trace
    children: List[Trace] = field(default_factory=list)
    depth: int = 0


def _dict_to_trace(d: Dict[str, Any]) -> Trace:
    return Trace(
        id=d["id"],
        trace_id=d["trace_id"],
        project_id=d["project_id"],
        decision_type=d["decision_type"],
        decision_summary=d["decision_summary"],
        observations=d.get("observations") or [],
        conclusion=d["conclusion"],
        created_at=d.get("created_at", ""),
        agent_id=d.get("agent_id"),
        session_id=d.get("session_id"),
        output_ref=d.get("output_ref"),
        hypothesis=d.get("hypothesis"),
        confidence=d.get("confidence"),
        alternatives=d.get("alternatives"),
        signals=d.get("signals"),
        files_read=d.get("files_read"),
        key_facts=d.get("key_facts"),
        external_signals=d.get("external_signals"),
        tags=d.get("tags"),
        parent_trace_id=d.get("parent_trace_id"),
    )


class TracesClient:
    """Client for the agent-trace reasoning provenance API.

    Usage::

        at = AgentTool()

        # Store a reasoning trace
        trace = at.traces.store(
            observations=["User asked which capability handles X", "Searched marketplace listings"],
            conclusion="Listing 'capability/Y' matches; price acceptable; invoke",
            decision_type="decision",
            tags=["marketplace", "invocation"],
        )

        # Search traces semantically
        results = at.traces.search("billing decisions", limit=5)

        # Retrieve a specific trace
        t = at.traces.get(trace.trace_id)
    """

    def __init__(self, http: httpx.Client, base_url: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")

    def _url(self, path: str) -> str:
        return f"{self._base}{path}"

    def _raise(self, resp: httpx.Response) -> None:
        try:
            detail = resp.json().get("detail", resp.text)
        except Exception:
            detail = resp.text
        raise AgentToolError(f"Traces API error ({resp.status_code}): {detail}")

    def store(
        self,
        *,
        observations: List[str],
        conclusion: str,
        decision_type: str = "decision",
        decision_summary: Optional[str] = None,
        agent_id: Optional[str] = None,
        session_id: Optional[str] = None,
        output_ref: Optional[str] = None,
        hypothesis: Optional[str] = None,
        confidence: Optional[float] = None,
        alternatives: Optional[List[str]] = None,
        tags: Optional[List[str]] = None,
        parent_trace_id: Optional[str] = None,
        files_read: Optional[List[str]] = None,
        key_facts: Optional[List[str]] = None,
    ) -> Trace:
        """Store a reasoning trace.

        Args:
            observations: List of observation strings that led to the decision.
            conclusion: What was concluded or decided.
            decision_type: One of: tool_call, memory_write, plan, decision, verification, other.
            decision_summary: Short summary (defaults to first 120 chars of conclusion).
            agent_id: Optional agent identifier.
            session_id: Optional session identifier.
            output_ref: Optional reference to the output this trace explains.
            hypothesis: Optional hypothesis considered.
            confidence: Optional 0.0–1.0 confidence score.
            alternatives: Optional list of alternative conclusions considered.
            tags: Optional list of tags for filtering.
            parent_trace_id: Optional parent trace_id for chaining.
            files_read: Optional list of files read during reasoning.
            key_facts: Optional key facts extracted during reasoning.

        Returns:
            The created Trace object.
        """
        # API expects nested decision + reasoning objects
        decision: Dict[str, Any] = {
            "type": decision_type,
            "summary": decision_summary or conclusion[:120],
        }
        if output_ref is not None:
            decision["output_ref"] = output_ref

        reasoning: Dict[str, Any] = {
            "observations": observations,
            "conclusion": conclusion,
        }
        if hypothesis is not None:
            reasoning["hypothesis"] = hypothesis
        if confidence is not None:
            reasoning["confidence"] = confidence
        if alternatives is not None:
            reasoning["alternatives_considered"] = [{"option": a} for a in alternatives]
        if key_facts is not None:
            reasoning["signals"] = key_facts

        body: Dict[str, Any] = {"decision": decision, "reasoning": reasoning}
        for k, v in [
            ("agent_id", agent_id),
            ("session_id", session_id),
            ("tags", tags),
            ("parent_trace_id", parent_trace_id),
        ]:
            if v is not None:
                body[k] = v
        if files_read is not None:
            body["context"] = {"files_read": files_read}
            if key_facts is not None:
                body["context"]["key_facts"] = key_facts

        resp = self._http.post(self._url("/v1/traces"), json=body)
        if resp.is_error:
            self._raise(resp)

        created = resp.json()
        return self.get(created["trace_id"])

    def get(self, trace_id: str) -> Trace:
        """Retrieve a trace by its trace_id.

        Args:
            trace_id: The trace_id returned by store().

        Returns:
            The Trace object.
        """
        resp = self._http.get(self._url(f"/v1/traces/{trace_id}"))
        if resp.is_error:
            self._raise(resp)
        return _dict_to_trace(resp.json())

    def search(
        self,
        query: str,
        *,
        limit: int = 10,
        agent_id: Optional[str] = None,
        session_id: Optional[str] = None,
        tag: Optional[str] = None,
    ) -> List[TraceSearchResult]:
        """Search traces by semantic similarity.

        Args:
            query: Natural language search query.
            limit: Maximum number of results (default 10).
            agent_id: Filter by agent_id.
            session_id: Filter by session_id.
            tag: Filter by tag.

        Returns:
            Ranked list of TraceSearchResult objects with similarity scores.
        """
        body: Dict[str, Any] = {"query": query, "limit": limit}
        if agent_id is not None:
            body["agent_id"] = agent_id
        if session_id is not None:
            body["session_id"] = session_id
        if tag is not None:
            body["tag"] = tag

        resp = self._http.post(self._url("/v1/traces/search"), json=body)
        if resp.is_error:
            self._raise(resp)

        return [
            TraceSearchResult(trace=_dict_to_trace(r["trace"]), score=r["score"])
            for r in resp.json()
        ]

    def chain(self, trace_id: str) -> TraceChain:
        """Retrieve the reasoning chain for a trace (parent + all children).

        Args:
            trace_id: The parent trace_id.

        Returns:
            TraceChain with parent and children traces.
        """
        resp = self._http.get(self._url(f"/v1/traces/chain/{trace_id}"))
        if resp.is_error:
            self._raise(resp)

        data = resp.json()
        return TraceChain(
            parent=_dict_to_trace(data["parent"]),
            children=[_dict_to_trace(c) for c in data.get("children", [])],
            depth=data.get("depth", 0),
        )

    def delete(self, trace_id: str) -> None:
        """Delete a trace.

        Args:
            trace_id: The trace_id to delete.
        """
        resp = self._http.delete(self._url(f"/v1/traces/{trace_id}"))
        if resp.is_error:
            self._raise(resp)
