"""Core memory service: write, read, search, delete."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..billing.usage import record_event
from ..embed import embed_text
from ..models import Memory
from .schemas import MemoryCreate, MemoryCreated, MemoryDeleted, MemoryOut, MemorySearch, MemorySearchResult


async def write(db: AsyncSession, project_id: uuid.UUID, data: MemoryCreate) -> MemoryCreated:
    """Write a new memory. Embeds content and stores in PostgreSQL."""
    # Generate embedding
    embedding = await embed_text(data.content)

    # Calculate expires_at for working memory
    expires_at = None
    if data.type == "working" and data.ttl_seconds:
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=data.ttl_seconds)

    # Insert via raw SQL to handle pgvector embedding column
    result = await db.execute(
        text("""
            INSERT INTO memories (project_id, agent_id, identity_id, type, key, content, embedding, metadata, importance, expires_at)
            VALUES (:project_id, :agent_id, :identity_id, :type, :key, :content, :embedding, :metadata, :importance, :expires_at)
            RETURNING id, created_at
        """),
        {
            "project_id": project_id,
            "agent_id": data.agent_id,
            "identity_id": data.identity_id,
            "type": data.type,
            "key": data.key,
            "content": data.content,
            "embedding": str(embedding),
            "metadata": json.dumps(data.metadata) if data.metadata else "{}",
            "importance": data.importance,
            "expires_at": expires_at,
        },
    )
    row = result.fetchone()

    await record_event(db, project_id, "write")
    await db.commit()

    return MemoryCreated(id=row.id, created_at=row.created_at)


async def read_by_id(db: AsyncSession, project_id: uuid.UUID, memory_id: uuid.UUID) -> MemoryOut | None:
    """Read a memory by its ID."""
    result = await db.execute(
        select(Memory).where(Memory.id == memory_id, Memory.project_id == project_id)
    )
    memory = result.scalar_one_or_none()
    if memory is None:
        return None

    # Update accessed_at
    await db.execute(
        update(Memory)
        .where(Memory.id == memory_id)
        .values(accessed_at=datetime.now(timezone.utc))
    )
    await record_event(db, project_id, "read")
    await db.commit()

    return _memory_to_out(memory)


async def read_by_key(
    db: AsyncSession,
    project_id: uuid.UUID,
    key: str,
    agent_id: str | None = None,
) -> list[MemoryOut]:
    """Read memories by key, optionally filtered by agent_id."""
    stmt = select(Memory).where(Memory.project_id == project_id, Memory.key == key)
    if agent_id:
        stmt = stmt.where(Memory.agent_id == agent_id)
    result = await db.execute(stmt)
    memories = result.scalars().all()

    if memories:
        await record_event(db, project_id, "read", count=len(memories))
        await db.commit()

    return [_memory_to_out(m) for m in memories]


async def search(db: AsyncSession, project_id: uuid.UUID, params: MemorySearch) -> list[MemorySearchResult]:
    """Semantic search across memories using pgvector cosine similarity."""
    # Embed the query
    query_embedding = await embed_text(params.query)

    # Build pgvector cosine distance query
    type_filter = "AND type = :type" if params.type else ""
    agent_filter = "AND agent_id = :agent_id" if params.agent_id else ""
    identity_filter = "AND identity_id = :identity_id" if params.identity_id else ""

    sql = f"""
        SELECT id, project_id, agent_id, identity_id, type, key, content, metadata, importance,
               accessed_at, created_at, expires_at,
               1 - (embedding <=> :embedding) AS score
        FROM memories
        WHERE project_id = :project_id
          AND (expires_at IS NULL OR expires_at > now())
          {type_filter}
          {agent_filter}
          {identity_filter}
        ORDER BY embedding <=> :embedding
        LIMIT :limit
    """

    bind_params: dict = {
        "project_id": project_id,
        "embedding": str(query_embedding),
        "limit": params.limit,
    }
    if params.type:
        bind_params["type"] = params.type
    if params.agent_id:
        bind_params["agent_id"] = params.agent_id
    if params.identity_id:
        bind_params["identity_id"] = params.identity_id

    result = await db.execute(text(sql), bind_params)
    rows = result.fetchall()

    await record_event(db, project_id, "search")
    await db.commit()

    # Apply reranking: score × importance × recency_decay
    results = []
    now = datetime.now(timezone.utc)
    for row in rows:
        raw_score = row.score
        if raw_score < params.min_score:
            continue

        # Recency decay: halves every 30 days
        age_days = (now - row.created_at.replace(tzinfo=timezone.utc)).total_seconds() / 86400
        recency = 0.5 ** (age_days / 30.0)

        final_score = raw_score * row.importance * (0.5 + 0.5 * recency)

        results.append(MemorySearchResult(
            id=row.id,
            type=row.type,
            key=row.key,
            content=row.content,
            agent_id=row.agent_id,
            identity_id=getattr(row, "identity_id", None),
            metadata=row.metadata or {},
            importance=row.importance,
            created_at=row.created_at,
            accessed_at=row.accessed_at,
            score=round(final_score, 4),
        ))

    results.sort(key=lambda r: r.score, reverse=True)
    return results[:params.limit]


async def delete_by_id(db: AsyncSession, project_id: uuid.UUID, memory_id: uuid.UUID) -> MemoryDeleted:
    """Delete a memory by ID."""
    result = await db.execute(
        delete(Memory).where(Memory.id == memory_id, Memory.project_id == project_id)
    )
    count = result.rowcount
    if count:
        await record_event(db, project_id, "delete")
        await db.commit()
    return MemoryDeleted(deleted=count)


async def delete_by_key(db: AsyncSession, project_id: uuid.UUID, key: str) -> MemoryDeleted:
    """Delete all memories with a given key."""
    result = await db.execute(
        delete(Memory).where(Memory.project_id == project_id, Memory.key == key)
    )
    count = result.rowcount
    if count:
        await record_event(db, project_id, "delete", count=count)
        await db.commit()
    return MemoryDeleted(deleted=count)


def _memory_to_out(m: Memory) -> MemoryOut:
    """Convert ORM Memory to MemoryOut schema."""
    return MemoryOut(
        id=m.id,
        type=m.type,
        key=m.key,
        content=m.content,
        agent_id=m.agent_id,
        metadata=m.metadata_ or {},
        importance=m.importance,
        created_at=m.created_at,
        accessed_at=m.accessed_at,
    )
