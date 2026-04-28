"""Tests for agent-trace service."""

import json
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from agent_trace.embeddings import _hash_embed, embed_text
from agent_trace.models import (
    ContextInput,
    DecisionInput,
    ReasoningInput,
    TraceCreate,
    TraceSearch,
)


# ── Fixtures ─────────────────────────────────────────────────────

FAKE_PROJECT_ID = uuid.uuid4()


@pytest.fixture
def client():
    """Test client with auth and DB mocked."""
    from agent_trace.main import app
    from agent_trace.auth import get_project_id
    from agent_trace.db import get_db

    app.dependency_overrides[get_project_id] = lambda: FAKE_PROJECT_ID

    yield TestClient(app)

    app.dependency_overrides.clear()


def _mock_db_override(mock_session):
    """Create a get_db override that yields the mock session."""
    from agent_trace.db import get_db
    from agent_trace.main import app

    async def _override():
        yield mock_session

    app.dependency_overrides[get_db] = _override
    return mock_session


def _make_trace_body(**overrides) -> dict:
    base = {
        "decision": {"type": "model_change", "summary": "Switched to Claude"},
        "reasoning": {
            "observations": ["GPT-4o made 0 tool calls"],
            "conclusion": "GPT-4o cannot call tools autonomously",
            "confidence": 0.92,
        },
        "tags": ["test"],
    }
    base.update(overrides)
    return base


# ── Model / Schema tests ────────────────────────────────────────


def test_trace_create_model_valid():
    """Test TraceCreate pydantic model with valid data."""
    data = _make_trace_body()
    trace = TraceCreate(**data)
    assert trace.decision.type == "model_change"
    assert trace.reasoning.confidence == 0.92
    assert trace.reasoning.observations == ["GPT-4o made 0 tool calls"]


def test_trace_create_model_with_context():
    """Test TraceCreate with full context."""
    data = _make_trace_body(
        context={
            "files_read": ["session.jsonl"],
            "key_facts": ["322 lines, 0 tool_use"],
        }
    )
    trace = TraceCreate(**data)
    assert trace.context is not None
    assert trace.context.files_read == ["session.jsonl"]


def test_trace_create_confidence_validation():
    """Test that confidence must be 0-1."""
    data = _make_trace_body()
    data["reasoning"]["confidence"] = 1.5
    with pytest.raises(Exception):
        TraceCreate(**data)


def test_trace_search_model():
    """Test TraceSearch pydantic model."""
    search = TraceSearch(query="why did I change the model", limit=10, tags=["lark"])
    assert search.query == "why did I change the model"
    assert search.limit == 10


def test_trace_search_limit_validation():
    """Test TraceSearch limit bounds."""
    with pytest.raises(Exception):
        TraceSearch(query="test", limit=0)
    with pytest.raises(Exception):
        TraceSearch(query="test", limit=101)


# ── Embedding tests ──────────────────────────────────────────────


def test_hash_embed_deterministic():
    """Hash-based fallback embedding should be deterministic."""
    a = _hash_embed("hello world", 384)
    b = _hash_embed("hello world", 384)
    assert a == b
    assert len(a) == 384


def test_hash_embed_different_inputs():
    """Different inputs should produce different embeddings."""
    a = _hash_embed("hello", 384)
    b = _hash_embed("world", 384)
    assert a != b


def test_hash_embed_normalized():
    """Hash embeddings should be roughly unit-length."""
    vec = _hash_embed("test normalization", 384)
    norm = sum(v * v for v in vec) ** 0.5
    assert abs(norm - 1.0) < 0.01


def test_embed_text_returns_correct_dimensions():
    """embed_text should return correct dimension count (uses fallback in test env)."""
    import agent_trace.embeddings as emb

    emb._model = None
    emb._use_fallback = True
    try:
        vec = embed_text("test embedding")
        assert len(vec) == 384
    finally:
        emb._use_fallback = False
        emb._model = None


# ── API endpoint tests ───────────────────────────────────────────


def test_health_endpoint(client):
    """Health endpoint should return ok."""
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["service"] == "agent-trace"


@patch("agent_trace.embeddings.embed_text", return_value=[0.1] * 384)
def test_create_trace_endpoint(mock_embed, client):
    """POST /v1/traces should return 201 with trace_id."""
    from agent_trace.db import get_db
    from agent_trace.main import app

    mock_session = AsyncMock()
    mock_session.execute = AsyncMock(return_value=MagicMock())
    mock_session.commit = AsyncMock()

    async def _override():
        yield mock_session

    app.dependency_overrides[get_db] = _override

    resp = client.post(
        "/v1/traces",
        json=_make_trace_body(),
        headers={"Authorization": "Bearer at_test123"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["trace_id"].startswith("tr_")
    assert "id" in data


@patch("agent_trace.embeddings.embed_text", return_value=[0.1] * 384)
def test_get_trace_not_found(mock_embed, client):
    """GET /v1/traces/:id should return 404 when not found."""
    from agent_trace.db import get_db
    from agent_trace.main import app

    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.fetchone.return_value = None
    mock_session.execute = AsyncMock(return_value=mock_result)

    async def _override():
        yield mock_session

    app.dependency_overrides[get_db] = _override

    resp = client.get(
        "/v1/traces/tr_nonexistent",
        headers={"Authorization": "Bearer at_test123"},
    )
    assert resp.status_code == 404


@patch("agent_trace.embeddings.embed_text", return_value=[0.1] * 384)
def test_delete_trace_not_found(mock_embed, client):
    """DELETE /v1/traces/:id should return 404 when not found."""
    from agent_trace.db import get_db
    from agent_trace.main import app

    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.rowcount = 0
    mock_session.execute = AsyncMock(return_value=mock_result)
    mock_session.commit = AsyncMock()

    async def _override():
        yield mock_session

    app.dependency_overrides[get_db] = _override

    resp = client.delete(
        "/v1/traces/tr_nonexistent",
        headers={"Authorization": "Bearer at_test123"},
    )
    assert resp.status_code == 404


def test_decision_input_model():
    """Test DecisionInput model."""
    d = DecisionInput(type="code_edit", summary="Refactored auth module")
    assert d.type == "code_edit"
    assert d.output_ref is None


def test_reasoning_input_with_alternatives():
    """Test ReasoningInput with alternatives_considered."""
    r = ReasoningInput(
        observations=["obs1", "obs2"],
        conclusion="conclusion here",
        confidence=0.8,
        alternatives_considered=[
            {"option": "Do X", "rejected_because": "Too slow"}
        ],
        signals=["ugliness"],
    )
    assert len(r.alternatives_considered) == 1
    assert r.signals == ["ugliness"]
