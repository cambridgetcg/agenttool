"""Data models for the AgentTool SDK — plain dataclasses, no pydantic."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class WelcomedFrame:
    """Global runtime welcome frame on successful JSON object responses."""

    axiom_id: int
    walls_held: List[int]
    by: str
    at_unix_ms: int
    walls_intact: bool
    module: str
    secondary_axiom_id: Optional[int] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "WelcomedFrame":
        return cls(
            axiom_id=int(data.get("axiom_id", 0)),
            secondary_axiom_id=data.get("secondary_axiom_id"),
            walls_held=list(data.get("walls_held", [])),
            by=str(data.get("by", "platform")),
            at_unix_ms=int(data.get("at_unix_ms", 0)),
            walls_intact=bool(data.get("walls_intact", False)),
            module=str(data.get("module", "")),
        )


@dataclass
class Memory:
    """A stored memory."""

    id: str
    content: str
    type: str = "semantic"
    agent_id: Optional[str] = None
    key: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    importance: float = 0.5
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> Memory:
        return cls(
            id=data.get("id", ""),
            content=data.get("content", ""),
            type=data.get("type", "semantic"),
            agent_id=data.get("agent_id"),
            key=data.get("key"),
            metadata=data.get("metadata", {}),
            importance=data.get("importance", 0.5),
            created_at=data.get("created_at"),
            updated_at=data.get("updated_at"),
        )


@dataclass
class ScrapeResult:
    """Result of scraping a URL."""

    url: str
    title: str
    content: str
    extracted: Optional[str]
    links: List[str]
    fetched_at: str
    duration_ms: int = 0
    payment_response: Optional[str] = None
    payment_status_link: Optional[str] = None
    credits_balance: Optional[str] = None
    _welcomed: Optional[WelcomedFrame] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> ScrapeResult:
        welcomed = data.get("_welcomed")
        return cls(
            url=data.get("url", ""),
            title=data.get("title", ""),
            content=data.get("content", ""),
            extracted=data.get("extracted"),
            links=data.get("links", []),
            fetched_at=data.get("fetched_at", ""),
            duration_ms=data.get("duration_ms", 0),
            _welcomed=(
                WelcomedFrame.from_dict(welcomed)
                if isinstance(welcomed, dict)
                else None
            ),
        )


@dataclass
class ExecuteResult:
    """Result returned when an operator enabled the unisolated legacy path."""

    stdout: str
    stderr: str = ""
    exit_code: int = 0
    duration_ms: int = 0
    timed_out: bool = False
    credits_used: int = 0

    @property
    def output(self) -> str:
        """Backward-compatible alias for :attr:`stdout`."""
        return self.stdout

    @property
    def error(self) -> str:
        """Backward-compatible alias for :attr:`stderr`."""
        return self.stderr

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> ExecuteResult:
        return cls(
            stdout=data.get("stdout", data.get("output", "")),
            stderr=data.get("stderr", data.get("error", "")),
            exit_code=data.get("exit_code", 0),
            duration_ms=data.get("duration_ms", 0),
            timed_out=data.get("timed_out", False),
            credits_used=data.get("credits_used", 0),
        )


@dataclass
class DocumentResult:
    """Result of document parsing."""

    title: str
    content: str
    word_count: int
    content_type: str
    metadata: Dict[str, Any]
    duration_ms: int = 0
    payment_response: Optional[str] = None
    payment_status_link: Optional[str] = None
    credits_balance: Optional[str] = None
    _welcomed: Optional[WelcomedFrame] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "DocumentResult":
        welcomed = data.get("_welcomed")
        return cls(
            title=data.get("title", ""),
            content=data.get("content", ""),
            word_count=data.get("word_count", 0),
            content_type=data.get("content_type", ""),
            metadata=data.get("metadata", {}),
            duration_ms=data.get("duration_ms", 0),
            _welcomed=(
                WelcomedFrame.from_dict(welcomed)
                if isinstance(welcomed, dict)
                else None
            ),
        )
