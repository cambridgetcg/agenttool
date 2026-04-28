"""Tests for Redis cache module — unit tests with mocked Redis."""

from __future__ import annotations

import json
import uuid
from unittest.mock import AsyncMock, patch

import pytest

from src.cache.redis import (
    set_working_memory,
    get_working_memory,
    delete_working_memory,
    cache_memory,
    get_cached_memory,
    invalidate_memory,
)


@pytest.fixture
def project_id():
    return uuid.uuid4()


@pytest.fixture
def memory_id():
    return uuid.uuid4()


@pytest.fixture
def mock_redis():
    """Mock the Redis connection."""
    mock = AsyncMock()
    with patch("src.cache.redis.get_redis", return_value=mock):
        yield mock


@pytest.mark.asyncio
class TestWorkingMemory:
    async def test_set_and_get(self, mock_redis, project_id):
        mock_redis.get = AsyncMock(return_value="active context data")

        await set_working_memory(project_id, "current_task", "active context data", ttl=600)

        mock_redis.setex.assert_called_once()
        call_args = mock_redis.setex.call_args
        assert call_args[0][1] == 600  # TTL
        assert call_args[0][2] == "active context data"

        result = await get_working_memory(project_id, "current_task")
        assert result == "active context data"

    async def test_get_missing(self, mock_redis, project_id):
        mock_redis.get = AsyncMock(return_value=None)
        result = await get_working_memory(project_id, "nonexistent")
        assert result is None

    async def test_delete(self, mock_redis, project_id):
        mock_redis.delete = AsyncMock(return_value=1)
        result = await delete_working_memory(project_id, "task")
        assert result is True

    async def test_delete_nonexistent(self, mock_redis, project_id):
        mock_redis.delete = AsyncMock(return_value=0)
        result = await delete_working_memory(project_id, "nonexistent")
        assert result is False


@pytest.mark.asyncio
class TestReadCache:
    async def test_cache_and_retrieve(self, mock_redis, project_id, memory_id):
        data = {"id": str(memory_id), "content": "cached memory", "type": "semantic"}
        mock_redis.get = AsyncMock(return_value=json.dumps(data))

        await cache_memory(project_id, memory_id, data)
        mock_redis.setex.assert_called_once()

        result = await get_cached_memory(project_id, memory_id)
        assert result is not None
        assert result["content"] == "cached memory"

    async def test_cache_miss(self, mock_redis, project_id, memory_id):
        mock_redis.get = AsyncMock(return_value=None)
        result = await get_cached_memory(project_id, memory_id)
        assert result is None

    async def test_invalidate(self, mock_redis, project_id, memory_id):
        await invalidate_memory(project_id, memory_id)
        mock_redis.delete.assert_called_once()

    async def test_corrupted_cache_returns_none(self, mock_redis, project_id, memory_id):
        mock_redis.get = AsyncMock(return_value="not valid json {{{")
        result = await get_cached_memory(project_id, memory_id)
        assert result is None
