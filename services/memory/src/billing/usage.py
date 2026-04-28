"""Usage event tracking for billing."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Memory, UsageEvent
from ..memory.schemas import UsageOut


async def record_event(
    db: AsyncSession,
    project_id: uuid.UUID,
    event_type: str,
    count: int = 1,
) -> None:
    """Record a usage event (write, read, search, delete)."""
    event = UsageEvent(
        project_id=project_id,
        event_type=event_type,
        count=count,
    )
    db.add(event)
    await db.flush()


async def get_usage(db: AsyncSession, project_id: uuid.UUID, plan: str) -> UsageOut:
    """Get usage summary for a project."""
    # Count events by type
    result = await db.execute(
        select(UsageEvent.event_type, func.sum(UsageEvent.count))
        .where(UsageEvent.project_id == project_id)
        .group_by(UsageEvent.event_type)
    )
    counts = {row[0]: row[1] for row in result}

    # Count total memories
    mem_count = await db.execute(
        select(func.count()).select_from(Memory).where(Memory.project_id == project_id)
    )
    total_memories = mem_count.scalar() or 0

    return UsageOut(
        writes=counts.get("write", 0),
        reads=counts.get("read", 0),
        searches=counts.get("search", 0),
        total_memories=total_memories,
        plan=plan,
    )
