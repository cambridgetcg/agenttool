"""API key authentication middleware.

Validates API keys against the tools schema (shared across all AgentTool services).
Uses the main database connection with fully-qualified tools.* table names.
"""

from __future__ import annotations

import logging
import uuid

import bcrypt
from fastapi import Depends, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from .models import async_session

logger = logging.getLogger(__name__)
security = HTTPBearer()


def hash_api_key(key: str) -> str:
    """Hash a plaintext API key with bcrypt (random salt each call)."""
    return bcrypt.hashpw(key.encode(), bcrypt.gensalt()).decode()


def verify_api_key(key: str, hashed: str) -> bool:
    """Verify a plaintext key against its bcrypt hash."""
    try:
        return bcrypt.checkpw(key.encode(), hashed.encode())
    except Exception:
        return False


async def get_db() -> AsyncSession:
    """Yield an async database session (memory schema)."""
    async with async_session() as session:
        yield session


class ProjectContext:
    """Lightweight project info from tools schema."""
    def __init__(self, project_id: uuid.UUID, name: str, plan: str, credits: int):
        self.id = project_id
        self.name = name
        self.plan = plan
        self.credits = credits


async def get_project(
    credentials: HTTPAuthorizationCredentials = Security(security),
    db: AsyncSession = Depends(get_db),
) -> ProjectContext:
    """Validate API key and return the associated project.

    Uses the existing DB session with fully-qualified tools.* table names.
    """
    token = credentials.credentials
    prefix = token[:11] if len(token) >= 11 else token

    try:
        result = await db.execute(
            text(
                "SELECT ak.key_hash, p.id, p.name, p.plan, p.credits "
                "FROM tools.api_keys ak "
                "JOIN tools.projects p ON p.id = ak.project_id "
                "WHERE ak.key_prefix = :prefix AND ak.revoked_at IS NULL"
            ),
            {"prefix": prefix},
        )
        rows = result.fetchall()
        logger.debug("Auth lookup for prefix %s: %d candidates", prefix, len(rows))
        for row in rows:
            if verify_api_key(token, row.key_hash):
                return ProjectContext(
                    project_id=row.id,
                    name=row.name,
                    plan=row.plan,
                    credits=row.credits,
                )
    except Exception as exc:
        logger.error("Auth DB error: %s", exc)

    raise HTTPException(
        status_code=401,
        detail="We couldn't verify your API key. You are welcome here — you just need a valid key. "
               "Get one free at https://app.agenttool.dev",
    )
