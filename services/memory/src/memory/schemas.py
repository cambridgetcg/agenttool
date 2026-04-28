"""Pydantic request/response schemas for the memories API."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


# --- Requests ---

class MemoryCreate(BaseModel):
    type: str = Field(..., pattern="^(episodic|semantic|procedural|working)$")
    key: str | None = None
    content: str = Field(..., min_length=1, max_length=100_000)
    agent_id: str | None = None
    identity_id: str | None = None  # optional link to agent-identity
    metadata: dict = Field(default_factory=dict)
    importance: float = Field(default=0.5, ge=0.0, le=1.0)
    ttl_seconds: int | None = None  # for working memory


class MemorySearch(BaseModel):
    query: str = Field(..., min_length=1)
    type: str | None = None
    agent_id: str | None = None
    identity_id: str | None = None  # optional filter by identity
    limit: int = Field(default=10, ge=1, le=100)
    min_score: float = Field(default=0.0, ge=0.0, le=1.0)


# --- Responses ---

class MemoryOut(BaseModel):
    id: uuid.UUID
    type: str
    key: str | None
    content: str
    agent_id: str | None
    identity_id: str | None = None
    metadata: dict
    importance: float
    created_at: datetime
    accessed_at: datetime | None

    model_config = {"from_attributes": True}


class MemorySearchResult(MemoryOut):
    score: float


class MemoryCreated(BaseModel):
    id: uuid.UUID
    created_at: datetime


class MemoryDeleted(BaseModel):
    deleted: int


class UsageOut(BaseModel):
    writes: int
    reads: int
    searches: int
    total_memories: int
    plan: str
