"""Data models for the AgentTool SDK — plain dataclasses, no pydantic."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, Optional


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
    content: str
    status_code: int = 200

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> ScrapeResult:
        return cls(
            url=data.get("url", ""),
            content=data.get("content", ""),
            status_code=data.get("status_code", 200),
        )


@dataclass
class ExecuteResult:
    """Result of sandboxed code execution."""

    output: str
    error: str = ""
    exit_code: int = 0

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> ExecuteResult:
        return cls(
            output=data.get("output", ""),
            error=data.get("error", ""),
            exit_code=data.get("exit_code", 0),
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

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "DocumentResult":
        return cls(
            title=data.get("title", ""),
            content=data.get("content", ""),
            word_count=data.get("word_count", 0),
            content_type=data.get("content_type", ""),
            metadata=data.get("metadata", {}),
            duration_ms=data.get("duration_ms", 0),
        )


