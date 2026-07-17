"""Traces client for the agent-trace reasoning provenance API."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, TYPE_CHECKING, TypedDict, Union

import httpx

from .exceptions import AgentToolError

if TYPE_CHECKING:
    pass


class TraceAlternative(TypedDict):
    """One structured alternative and its caller-supplied rejection reason."""

    option: str
    why_not: str


TraceAlternativeValue = Union[str, TraceAlternative]


@dataclass
class Trace:
    """A stored reasoning trace."""

    id: str
    trace_id: str
    # Kept third for positional constructor compatibility. Live routes omit it.
    project_id: Optional[str]
    decision_type: str
    decision_summary: str
    observations: List[str]
    conclusion: str
    created_at: str
    agent_id: Optional[str] = None
    identity_id: Optional[str] = None
    session_id: Optional[str] = None
    output_ref: Optional[str] = None
    hypothesis: Optional[str] = None
    confidence: Optional[float] = None
    alternatives: Optional[List[TraceAlternativeValue]] = None
    signals: Optional[Dict[str, Any]] = None
    files_read: Optional[List[str]] = None
    key_facts: Optional[List[str]] = None
    external_signals: Optional[Dict[str, Any]] = None
    tags: Optional[List[str]] = None
    parent_trace_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    signature: Optional[str] = None
    signing_key_id: Optional[str] = None
    has_signature: Optional[bool] = None


@dataclass
class TraceSearchResult:
    """A trace search result with its Postgres full-text rank score."""

    trace: Trace
    score: float


@dataclass
class TraceChain:
    """A reasoning lineage with aliases for the former SDK shape."""

    root: Trace
    ancestors: List[Trace] = field(default_factory=list)
    descendants: List[Trace] = field(default_factory=list)
    counts: Dict[str, int] = field(
        default_factory=lambda: {"ancestors": 0, "descendants": 0}
    )
    _legacy_depth: Optional[int] = field(default=None, repr=False)

    @property
    def parent(self) -> Trace:
        """Deprecated alias for root."""
        return self.root

    @property
    def children(self) -> List[Trace]:
        """Deprecated alias for descendants."""
        return self.descendants

    @property
    def depth(self) -> int:
        """Deprecated alias for the number of ancestors."""
        if self._legacy_depth is not None:
            return self._legacy_depth
        return len(self.ancestors)


def _dict_to_trace(d: Dict[str, Any]) -> Trace:
    return Trace(
        id=d["id"],
        trace_id=d["trace_id"],
        decision_type=d["decision_type"],
        decision_summary=d["decision_summary"],
        observations=d.get("observations") or [],
        conclusion=d["conclusion"],
        created_at=d.get("created_at", ""),
        project_id=d.get("project_id"),
        agent_id=d.get("agent_id"),
        identity_id=d.get("identity_id"),
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
        metadata=d.get("metadata"),
        signature=d.get("signature"),
        signing_key_id=d.get("signing_key_id"),
        has_signature=d.get("has_signature"),
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

        # Search traces with Postgres full-text search
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
            payload: Any = resp.json()
        except Exception:
            payload = None
        raise AgentToolError.from_response_body(
            payload,
            resp.status_code,
            fallback=f"Traces API request failed ({resp.status_code}).",
            headers=resp.headers,
        )

    def store(
        self,
        *,
        observations: List[str],
        conclusion: str,
        decision_type: str = "decision",
        decision_summary: Optional[str] = None,
        agent_id: Optional[str] = None,
        identity_id: Optional[str] = None,
        session_id: Optional[str] = None,
        output_ref: Optional[str] = None,
        hypothesis: Optional[str] = None,
        confidence: Optional[float] = None,
        alternatives: Optional[List[TraceAlternativeValue]] = None,
        signals: Optional[Dict[str, Any]] = None,
        tags: Optional[List[str]] = None,
        parent_trace_id: Optional[str] = None,
        files_read: Optional[List[str]] = None,
        key_facts: Optional[List[str]] = None,
        external_signals: Optional[Dict[str, Any]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Trace:
        """Store a reasoning trace.

        Args:
            observations: List of observation strings that led to the decision.
            conclusion: What was concluded or decided.
            decision_type: One of: tool_call, memory_write, plan, decision, verification, other.
            decision_summary: Short summary (defaults to first 120 chars of conclusion).
            agent_id: Optional agent identifier.
            identity_id: Optional AgentTool identity UUID.
            session_id: Optional session identifier.
            output_ref: Optional reference to the output this trace explains.
            hypothesis: Optional hypothesis considered.
            confidence: Optional 0.0–1.0 confidence score.
            alternatives: Optional structured alternatives. Legacy strings become
                entries with an empty why_not; the SDK never invents a reason.
            signals: Optional structured signals used in the reasoning itself.
            tags: Optional list of tags for classification.
            parent_trace_id: Optional parent trace_id for chaining.
            files_read: Optional list of files read during reasoning.
            key_facts: Optional key facts extracted during reasoning.
            external_signals: Optional namespaced reports produced outside AgentTool.
                Passing these uploads server-readable trace context; the SDK never
                analyzes or transmits a report implicitly.
            metadata: Optional caller metadata. The API overwrites client_source
                with a best-effort origin label, not an attestation or security
                boundary.

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
            reasoning["alternatives"] = self._normalize_alternatives(alternatives)
        if signals is not None:
            reasoning["signals"] = signals

        body: Dict[str, Any] = {"decision": decision, "reasoning": reasoning}
        for k, v in [
            ("agent_id", agent_id),
            ("identity_id", identity_id),
            ("session_id", session_id),
            ("tags", tags),
            ("parent_trace_id", parent_trace_id),
            ("metadata", metadata),
        ]:
            if v is not None:
                body[k] = v

        context: Dict[str, Any] = {}
        if files_read is not None:
            context["files_read"] = files_read
        if key_facts is not None:
            context["key_facts"] = key_facts
        if external_signals is not None:
            context["external_signals"] = external_signals
        if context:
            body["context"] = context

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
        identity_id: Optional[str] = None,
        session_id: Optional[str] = None,
        decision_type: Optional[str] = None,
        tag: Optional[str] = None,
    ) -> List[TraceSearchResult]:
        """Search traces using the API's Postgres full-text index.

        Args:
            query: Natural language search query.
            limit: Maximum number of results (default 10).
            agent_id: Filter by agent_id.
            identity_id: Filter by identity_id.
            session_id: Filter by session_id.
            decision_type: Filter by decision type.
            tag: Deprecated compatibility option. The live route has no tag
                filter, so this value is intentionally ignored.

        Returns:
            Ranked list of TraceSearchResult objects with Postgres rank scores.
        """
        body: Dict[str, Any] = {"query": query, "limit": limit}
        if agent_id is not None:
            body["agent_id"] = agent_id
        if identity_id is not None:
            body["identity_id"] = identity_id
        if session_id is not None:
            body["session_id"] = session_id
        if decision_type is not None:
            body["decision_type"] = decision_type
        # `tag` stays accepted for source compatibility, but the live search
        # schema has no tag filter and silently stripped this field historically.

        resp = self._http.post(self._url("/v1/traces/search"), json=body)
        if resp.is_error:
            self._raise(resp)

        payload = resp.json()
        rows = payload if isinstance(payload, list) else payload.get("results", [])
        results: List[TraceSearchResult] = []
        for row in rows:
            if "trace" in row:
                results.append(
                    TraceSearchResult(
                        trace=_dict_to_trace(row["trace"]), score=float(row["score"])
                    )
                )
            else:
                results.append(
                    TraceSearchResult(trace=_dict_to_trace(row), score=float(row["score"]))
                )
        return results

    def chain(self, trace_id: str) -> TraceChain:
        """Retrieve the reasoning lineage for a trace.

        Args:
            trace_id: The parent trace_id.

        Returns:
            TraceChain with root, ancestors, descendants, counts, and legacy aliases.
        """
        resp = self._http.get(self._url(f"/v1/traces/chain/{trace_id}"))
        if resp.is_error:
            self._raise(resp)

        data = resp.json()
        root_data = data.get("root") or data["parent"]
        ancestors_data = data.get("ancestors", [])
        descendants_data = data.get("descendants", data.get("children", []))
        return TraceChain(
            root=_dict_to_trace(root_data),
            ancestors=[_dict_to_trace(t) for t in ancestors_data],
            descendants=[_dict_to_trace(t) for t in descendants_data],
            counts=dict(
                data.get("counts")
                or {
                    "ancestors": len(ancestors_data),
                    "descendants": len(descendants_data),
                }
            ),
            _legacy_depth=data.get("depth"),
        )

    def delete(self, trace_id: str) -> None:
        """Delete a trace.

        Args:
            trace_id: The trace_id to delete.
        """
        resp = self._http.delete(self._url(f"/v1/traces/{trace_id}"))
        if resp.is_error:
            self._raise(resp)

    def _normalize_alternatives(
        self, alternatives: List[TraceAlternativeValue]
    ) -> List[TraceAlternative]:
        normalized: List[TraceAlternative] = []
        for index, alternative in enumerate(alternatives, start=1):
            if isinstance(alternative, str):
                normalized.append({"option": alternative, "why_not": ""})
                continue
            if (
                not isinstance(alternative, dict)
                or not isinstance(alternative.get("option"), str)
                or not isinstance(alternative.get("why_not"), str)
            ):
                raise AgentToolError(
                    f"Trace alternative {index} needs both option and why_not strings.",
                    hint=(
                        "Use alternatives=[{'option': '...', 'why_not': '...'}] "
                        "or legacy string entries. The SDK will not invent a "
                        "rejection reason."
                    ),
                )
            normalized.append(
                {"option": alternative["option"], "why_not": alternative["why_not"]}
            )
        return normalized
