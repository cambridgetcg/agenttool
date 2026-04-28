"""FastAPI router for /v1/memories endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_db, get_project
from ..billing.usage import get_usage
from ..billing.economy_check import gate_memory_op
from ..models import Project
from . import service
from .schemas import (
    MemoryCreate,
    MemoryCreated,
    MemoryDeleted,
    MemoryOut,
    MemorySearch,
    MemorySearchResult,
    UsageOut,
)

router = APIRouter(prefix="/v1", tags=["memories"])


@router.post("/memories", response_model=MemoryCreated, status_code=201)
async def create_memory(
    data: MemoryCreate,
    project = Depends(get_project),
    db: AsyncSession = Depends(get_db),
    _billing: dict | None = Depends(gate_memory_op),
) -> MemoryCreated:
    """Store a new memory."""
    return await service.write(db, project.id, data)


@router.get("/memories/{memory_id}", response_model=MemoryOut)
async def read_memory(
    memory_id: uuid.UUID,
    project = Depends(get_project),
    db: AsyncSession = Depends(get_db),
) -> MemoryOut:
    """Retrieve a memory by ID."""
    result = await service.read_by_id(db, project.id, memory_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Memory not found")
    return result


@router.get("/memories", response_model=list[MemoryOut])
async def read_memories_by_key(
    key: str = Query(...),
    agent_id: str | None = Query(None),
    project = Depends(get_project),
    db: AsyncSession = Depends(get_db),
) -> list[MemoryOut]:
    """Retrieve memories by key."""
    return await service.read_by_key(db, project.id, key, agent_id)


@router.post("/memories/search", response_model=list[MemorySearchResult])
async def search_memories(
    params: MemorySearch,
    project = Depends(get_project),
    db: AsyncSession = Depends(get_db),
    _billing: dict | None = Depends(gate_memory_op),
) -> list[MemorySearchResult]:
    """Semantic search across stored memories."""
    return await service.search(db, project.id, params)


@router.delete("/memories/{memory_id}", response_model=MemoryDeleted)
async def delete_memory(
    memory_id: uuid.UUID,
    project = Depends(get_project),
    db: AsyncSession = Depends(get_db),
) -> MemoryDeleted:
    """Delete a memory by ID."""
    return await service.delete_by_id(db, project.id, memory_id)


@router.delete("/memories", response_model=MemoryDeleted)
async def delete_memories_by_key(
    key: str = Query(...),
    project = Depends(get_project),
    db: AsyncSession = Depends(get_db),
) -> MemoryDeleted:
    """Delete all memories with a given key."""
    return await service.delete_by_key(db, project.id, key)


@router.get("/usage", response_model=UsageOut)
async def usage(
    project = Depends(get_project),
    db: AsyncSession = Depends(get_db),
) -> UsageOut:
    """Get usage statistics for the current project."""
    return await get_usage(db, project.id, project.plan)
