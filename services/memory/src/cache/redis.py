"""Redis cache: working memory TTL store and read-through cache."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime

import redis.asyncio as aioredis

from ..config import settings

logger = logging.getLogger(__name__)

_pool: aioredis.Redis | None = None


async def get_redis() -> aioredis.Redis:
    """Get or create the Redis connection pool."""
    global _pool
    if _pool is None:
        _pool = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _pool


async def close_redis() -> None:
    """Close the Redis connection pool."""
    global _pool
    if _pool is not None:
        await _pool.aclose()
        _pool = None


# --- Working Memory (TTL-based) ---

def _working_key(project_id: uuid.UUID, key: str) -> str:
    return f"wm:{project_id}:{key}"


async def set_working_memory(
    project_id: uuid.UUID,
    key: str,
    value: str,
    ttl: int | None = None,
) -> None:
    """Store a working memory entry with TTL (seconds). Defaults to config TTL."""
    r = await get_redis()
    rkey = _working_key(project_id, key)
    effective_ttl = ttl or settings.working_memory_ttl
    await r.setex(rkey, effective_ttl, value)


async def get_working_memory(project_id: uuid.UUID, key: str) -> str | None:
    """Retrieve a working memory entry. Returns None if expired or missing."""
    r = await get_redis()
    return await r.get(_working_key(project_id, key))


async def delete_working_memory(project_id: uuid.UUID, key: str) -> bool:
    """Delete a working memory entry. Returns True if it existed."""
    r = await get_redis()
    return bool(await r.delete(_working_key(project_id, key)))


# --- Read-through Cache ---

def _cache_key(project_id: uuid.UUID, memory_id: uuid.UUID) -> str:
    return f"mc:{project_id}:{memory_id}"


async def cache_memory(project_id: uuid.UUID, memory_id: uuid.UUID, data: dict) -> None:
    """Cache a memory read result for 5 minutes."""
    r = await get_redis()
    rkey = _cache_key(project_id, memory_id)
    await r.setex(rkey, 300, json.dumps(data, default=str))


async def get_cached_memory(project_id: uuid.UUID, memory_id: uuid.UUID) -> dict | None:
    """Get a cached memory, or None if not cached."""
    r = await get_redis()
    raw = await r.get(_cache_key(project_id, memory_id))
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


async def invalidate_memory(project_id: uuid.UUID, memory_id: uuid.UUID) -> None:
    """Invalidate a cached memory entry."""
    r = await get_redis()
    await r.delete(_cache_key(project_id, memory_id))
