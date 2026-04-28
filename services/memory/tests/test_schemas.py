"""Tests for Pydantic schemas — validation without DB."""

import uuid
from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from src.memory.schemas import MemoryCreate, MemorySearch, MemoryOut, MemorySearchResult


class TestMemoryCreate:
    def test_valid_episodic(self):
        m = MemoryCreate(type="episodic", content="Something happened")
        assert m.type == "episodic"
        assert m.importance == 0.5
        assert m.metadata == {}
        assert m.ttl_seconds is None

    def test_valid_working_with_ttl(self):
        m = MemoryCreate(type="working", content="Active context", ttl_seconds=600)
        assert m.type == "working"
        assert m.ttl_seconds == 600

    def test_valid_semantic_with_all_fields(self):
        m = MemoryCreate(
            type="semantic",
            content="The speed of light is 3e8 m/s",
            key="physics.c",
            agent_id="research-agent-1",
            metadata={"domain": "physics"},
            importance=0.9,
        )
        assert m.key == "physics.c"
        assert m.agent_id == "research-agent-1"
        assert m.importance == 0.9

    def test_invalid_type_rejected(self):
        with pytest.raises(ValidationError):
            MemoryCreate(type="invalid", content="test")

    def test_empty_content_rejected(self):
        with pytest.raises(ValidationError):
            MemoryCreate(type="episodic", content="")

    def test_importance_bounds(self):
        with pytest.raises(ValidationError):
            MemoryCreate(type="episodic", content="test", importance=1.5)
        with pytest.raises(ValidationError):
            MemoryCreate(type="episodic", content="test", importance=-0.1)

    def test_importance_at_boundaries(self):
        m0 = MemoryCreate(type="episodic", content="test", importance=0.0)
        m1 = MemoryCreate(type="episodic", content="test", importance=1.0)
        assert m0.importance == 0.0
        assert m1.importance == 1.0


class TestMemorySearch:
    def test_valid_search(self):
        s = MemorySearch(query="what happened yesterday")
        assert s.limit == 10
        assert s.min_score == 0.0

    def test_search_with_filters(self):
        s = MemorySearch(
            query="deployment steps",
            type="procedural",
            agent_id="deploy-agent",
            limit=5,
            min_score=0.7,
        )
        assert s.type == "procedural"
        assert s.limit == 5

    def test_empty_query_rejected(self):
        with pytest.raises(ValidationError):
            MemorySearch(query="")

    def test_limit_bounds(self):
        with pytest.raises(ValidationError):
            MemorySearch(query="test", limit=0)
        with pytest.raises(ValidationError):
            MemorySearch(query="test", limit=101)


class TestMemoryOut:
    def test_from_dict(self):
        m = MemoryOut(
            id=uuid.uuid4(),
            type="episodic",
            key=None,
            content="Hello",
            agent_id=None,
            metadata={},
            importance=0.5,
            created_at=datetime.now(timezone.utc),
            accessed_at=None,
        )
        assert m.content == "Hello"

    def test_search_result_has_score(self):
        r = MemorySearchResult(
            id=uuid.uuid4(),
            type="semantic",
            key="test",
            content="Test content",
            agent_id=None,
            metadata={},
            importance=0.8,
            created_at=datetime.now(timezone.utc),
            accessed_at=None,
            score=0.92,
        )
        assert r.score == 0.92
