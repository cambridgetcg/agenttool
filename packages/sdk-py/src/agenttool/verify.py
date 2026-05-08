"""Verify client — DEPRECATED.

The ``/v1/verify`` endpoint was dropped in the consolidated API.
Verifying claims is the agent's job (LLM compute), not infrastructure's
— agenttool is not a paid-API reseller. Bring your own LLM key via
``at.vault`` and call providers directly via ``at.tools.execute``.

This module remains as a stub through 0.6.x; all methods raise
``AgentToolError`` after emitting a ``DeprecationWarning``. The module
will be removed in 0.7.0. See ``docs/SDK-ROADMAP.md`` (Phase 0).
"""

from __future__ import annotations

import warnings
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import httpx

from .exceptions import AgentToolError


def _verify_deprecated() -> None:
    """Emit DeprecationWarning + raise — same shape from every method."""
    warnings.warn(
        "at.verify is deprecated. /v1/verify was dropped from the "
        "consolidated API. Agents BYOK via at.vault.put('openai-key', ...) "
        "and call providers directly via at.tools.execute. Module will be "
        "removed in 0.7.0. See docs/SDK-ROADMAP.md.",
        DeprecationWarning,
        stacklevel=3,
    )
    raise AgentToolError(
        "/v1/verify was dropped from the consolidated API.",
        hint=(
            "Store provider keys in at.vault and call them via "
            "at.tools.execute. agenttool is not a paid-API reseller. "
            "See docs/SDK-ROADMAP.md."
        ),
    )


@dataclass
class SourceEvidence:
    source: str
    url: str
    title: str
    snippet: str
    reliability: float
    position: str  # "supports" | "contradicts" | "neutral"
    published_date: Optional[str] = None

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "SourceEvidence":
        return cls(
            source=d.get("source", ""),
            url=d.get("url", ""),
            title=d.get("title", ""),
            snippet=d.get("snippet", ""),
            reliability=d.get("reliability", 0.0),
            position=d.get("position", "neutral"),
            published_date=d.get("publishedDate") or d.get("published_date"),
        )


@dataclass
class VerifyEvidence:
    supporting: List[SourceEvidence] = field(default_factory=list)
    contradicting: List[SourceEvidence] = field(default_factory=list)
    neutral: List[SourceEvidence] = field(default_factory=list)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "VerifyEvidence":
        return cls(
            supporting=[SourceEvidence.from_dict(e) for e in d.get("supporting", [])],
            contradicting=[SourceEvidence.from_dict(e) for e in d.get("contradicting", [])],
            neutral=[SourceEvidence.from_dict(e) for e in d.get("neutral", [])],
        )


@dataclass
class VerifyResult:
    """Result of a claim verification."""
    claim: str
    verdict: str  # "verified" | "disputed" | "false" | "unverifiable"
    confidence: float  # 0.0 – 1.0
    evidence: VerifyEvidence
    sources: List[Dict[str, Any]]
    caveats: List[str]
    processing_ms: int

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "VerifyResult":
        return cls(
            claim=d.get("claim", ""),
            verdict=d.get("verdict", "unverifiable"),
            confidence=d.get("confidence", 0.0),
            evidence=VerifyEvidence.from_dict(d.get("evidence", {})),
            sources=d.get("sources", []),
            caveats=d.get("caveats", []),
            processing_ms=d.get("processingMs") or d.get("processing_ms", 0),
        )

    @property
    def is_verified(self) -> bool:
        return self.verdict == "verified"

    @property
    def is_false(self) -> bool:
        return self.verdict == "false"

    @property
    def is_disputed(self) -> bool:
        return self.verdict == "disputed"


class VerifyClient:
    """Client for the agent-verify API.

    Usage::

        result = at.verify.check("The Eiffel Tower is 330 metres tall.")
        print(result.verdict, result.confidence)
        # "verified" 0.91

        # With domain hint for better evidence sourcing
        result = at.verify.check(
            "Bitcoin was created in 2009.",
            domain="finance"
        )

        # Batch verify (up to 10 claims in parallel)
        results = at.verify.batch([
            {"claim": "Water boils at 100°C at sea level."},
            {"claim": "The moon is made of cheese.", "domain": "science"},
        ])
    """

    def __init__(self, http: httpx.Client, base_url: str) -> None:
        self._http = http
        self._base_url = base_url

    def _url(self, path: str) -> str:
        return f"{self._base_url}{path}"

    def check(
        self,
        claim: str,
        *,
        context: Optional[str] = None,
        domain: Optional[str] = None,
    ) -> VerifyResult:
        """Verify a single factual claim.

        Args:
            claim: The statement to verify (max 2,000 chars).
            context: Optional background context to help interpret the claim.
            domain: Hint for evidence sourcing. One of: ``finance``, ``legal``,
                ``medical``, ``science``, ``general``.

        Returns:
            :class:`VerifyResult` with verdict, confidence, evidence and sources.

        Raises:
            :class:`AgentToolError`: On API errors.
        """
        _verify_deprecated()  # raises; line below unreachable but kept for type-checkers
        return VerifyResult.from_dict({})  # pragma: no cover

    def batch(
        self,
        claims: List[Dict[str, Any]],
    ) -> List[VerifyResult]:
        """Verify up to 10 claims in parallel.

        Args:
            claims: List of dicts, each with ``claim`` (required),
                plus optional ``context`` and ``domain``.

        Returns:
            List of :class:`VerifyResult` in the same order as input.

        Raises:
            :class:`AgentToolError`: On API errors.

        Example::

            results = at.verify.batch([
                {"claim": "The Earth orbits the Sun."},
                {"claim": "Water is H2O.", "domain": "science"},
            ])
        """
        _verify_deprecated()  # raises
        return []  # pragma: no cover

    @staticmethod
    def _check(resp: httpx.Response) -> None:
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail") or resp.json().get("error") or resp.text
            except Exception:
                detail = resp.text
            raise AgentToolError(
                f"Verify API error ({resp.status_code}): {detail}",
                hint="Check your claim format and API key.",
            )
