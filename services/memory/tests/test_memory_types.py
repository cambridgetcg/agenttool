"""Tests for memory type rules and search schema edge cases."""

import pytest
from pydantic import ValidationError

from src.memory.schemas import MemoryCreate, MemorySearch, MemoryOut, MemorySearchResult
import uuid
from datetime import datetime, timezone


VALID_TYPES = ["episodic", "semantic", "procedural", "working"]


class TestMemoryTypes:
    """All four memory types must be accepted; nothing else."""

    @pytest.mark.parametrize("mem_type", VALID_TYPES)
    def test_valid_type(self, mem_type):
        m = MemoryCreate(type=mem_type, content="test content")
        assert m.type == mem_type

    @pytest.mark.parametrize("bad_type", ["short_term", "long_term", "EPISODIC", "", "flash", "core"])
    def test_invalid_type_rejected(self, bad_type):
        with pytest.raises(ValidationError):
            MemoryCreate(type=bad_type, content="test")

    def test_only_working_should_use_ttl(self):
        """TTL is valid on any type but semantically only meaningful for working."""
        m = MemoryCreate(type="episodic", content="event", ttl_seconds=600)
        assert m.ttl_seconds == 600  # schema allows it; service enforces semantics

    def test_working_memory_with_short_ttl(self):
        m = MemoryCreate(type="working", content="active context", ttl_seconds=60)
        assert m.ttl_seconds == 60

    def test_working_memory_with_no_ttl(self):
        m = MemoryCreate(type="working", content="no expiry")
        assert m.ttl_seconds is None


class TestImportance:
    def test_default_importance(self):
        m = MemoryCreate(type="semantic", content="fact")
        assert m.importance == 0.5

    def test_min_importance(self):
        m = MemoryCreate(type="semantic", content="fact", importance=0.0)
        assert m.importance == 0.0

    def test_max_importance(self):
        m = MemoryCreate(type="semantic", content="critical fact", importance=1.0)
        assert m.importance == 1.0

    def test_importance_above_1_rejected(self):
        with pytest.raises(ValidationError):
            MemoryCreate(type="semantic", content="fact", importance=1.01)

    def test_importance_below_0_rejected(self):
        with pytest.raises(ValidationError):
            MemoryCreate(type="semantic", content="fact", importance=-0.01)

    def test_high_importance_memory(self):
        m = MemoryCreate(type="episodic", content="critical event", importance=0.95)
        assert m.importance == 0.95


class TestContent:
    def test_min_content_length(self):
        m = MemoryCreate(type="episodic", content="x")
        assert m.content == "x"

    def test_empty_content_rejected(self):
        with pytest.raises(ValidationError):
            MemoryCreate(type="episodic", content="")

    def test_max_content_length(self):
        m = MemoryCreate(type="semantic", content="x" * 100_000)
        assert len(m.content) == 100_000

    def test_over_max_content_rejected(self):
        with pytest.raises(ValidationError):
            MemoryCreate(type="semantic", content="x" * 100_001)

    def test_unicode_content(self):
        m = MemoryCreate(type="episodic", content="日本語テスト 🧠 Ñoño")
        assert "日本語" in m.content


class TestSearchSchema:
    def test_default_limit(self):
        s = MemorySearch(query="user preferences")
        assert s.limit == 10

    def test_custom_limit(self):
        s = MemorySearch(query="find facts", limit=50)
        assert s.limit == 50

    def test_max_limit(self):
        s = MemorySearch(query="all", limit=100)
        assert s.limit == 100

    def test_over_max_limit_rejected(self):
        with pytest.raises(ValidationError):
            MemorySearch(query="all", limit=101)

    def test_zero_limit_rejected(self):
        with pytest.raises(ValidationError):
            MemorySearch(query="all", limit=0)

    def test_default_min_score(self):
        s = MemorySearch(query="test")
        assert s.min_score == 0.0

    def test_high_min_score_filter(self):
        s = MemorySearch(query="precise recall", min_score=0.9)
        assert s.min_score == 0.9

    def test_min_score_above_1_rejected(self):
        with pytest.raises(ValidationError):
            MemorySearch(query="test", min_score=1.01)

    def test_type_filter(self):
        s = MemorySearch(query="events", type="episodic")
        assert s.type == "episodic"

    def test_agent_id_filter(self):
        s = MemorySearch(query="preferences", agent_id="agent-42")
        assert s.agent_id == "agent-42"

    def test_empty_query_rejected(self):
        with pytest.raises(ValidationError):
            MemorySearch(query="")


class TestResponseSchemas:
    def _make_memory_out(self, **kwargs):
        defaults = {
            "id": uuid.uuid4(),
            "type": "episodic",
            "key": None,
            "content": "test memory",
            "agent_id": "agent-1",
            "metadata": {},
            "importance": 0.5,
            "created_at": datetime.now(timezone.utc),
            "accessed_at": None,
        }
        defaults.update(kwargs)
        return MemoryOut(**defaults)

    def test_memory_out_basic(self):
        m = self._make_memory_out()
        assert isinstance(m.id, uuid.UUID)
        assert m.type == "episodic"

    def test_memory_search_result_has_score(self):
        result = MemorySearchResult(
            id=uuid.uuid4(),
            type="semantic",
            key="physics.c",
            content="speed of light",
            agent_id=None,
            metadata={},
            importance=0.9,
            created_at=datetime.now(timezone.utc),
            accessed_at=None,
            score=0.97,
        )
        assert result.score == 0.97
        assert result.content == "speed of light"

    def test_memory_out_with_key(self):
        m = self._make_memory_out(key="user.prefs.theme")
        assert m.key == "user.prefs.theme"

    def test_memory_out_metadata(self):
        m = self._make_memory_out(metadata={"source": "chat", "session": "s42"})
        assert m.metadata["source"] == "chat"
