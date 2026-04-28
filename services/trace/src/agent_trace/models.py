import uuid
from datetime import datetime

from pydantic import BaseModel, Field


# ── Request schemas ──────────────────────────────────────────────


class DecisionInput(BaseModel):
    type: str  # model_change | code_edit | message | plan | tool_call
    summary: str
    output_ref: str | None = None


class ReasoningInput(BaseModel):
    observations: list[str]
    hypothesis: str | None = None
    conclusion: str
    confidence: float | None = Field(None, ge=0.0, le=1.0)
    alternatives_considered: list[dict] | None = None
    signals: list[str] | None = None


class ContextInput(BaseModel):
    files_read: list[str] | None = None
    key_facts: list[str] | None = None
    external_signals: dict | None = None


class TraceCreate(BaseModel):
    decision: DecisionInput
    reasoning: ReasoningInput
    context: ContextInput | None = None
    tags: list[str] | None = None
    parent_trace_id: str | None = None
    agent_id: str | None = None
    identity_id: str | None = None  # optional link to agent-identity
    session_id: str | None = None


class TraceSearch(BaseModel):
    query: str
    limit: int = Field(5, ge=1, le=100)
    tags: list[str] | None = None
    agent_id: str | None = None
    identity_id: str | None = None  # optional filter by identity
    session_id: str | None = None


# ── Response schemas ─────────────────────────────────────────────


class TraceCreated(BaseModel):
    trace_id: str
    id: uuid.UUID


class TraceOut(BaseModel):
    id: uuid.UUID
    trace_id: str
    agent_id: str | None
    identity_id: str | None = None
    project_id: uuid.UUID
    session_id: str | None
    created_at: datetime

    decision_type: str
    decision_summary: str
    output_ref: str | None

    observations: list
    hypothesis: str | None
    conclusion: str
    confidence: float | None
    alternatives: list | None
    signals: list | None

    files_read: list | None
    key_facts: list | None
    external_signals: dict | None

    tags: list | None
    parent_trace_id: str | None


class TraceSearchResult(BaseModel):
    trace_id: str
    decision_summary: str
    conclusion: str
    confidence: float | None
    created_at: datetime
    score: float


class TraceChain(BaseModel):
    root: TraceOut
    children: list[TraceOut]
