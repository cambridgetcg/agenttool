"""
Billing tier gate — calls agent-economy /v1/billing/check before processing.
Fail-open: if economy service is unreachable, the request proceeds.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Literal

import httpx
from fastapi import Depends, HTTPException

from ..config import settings
from ..auth import get_project

logger = logging.getLogger(__name__)

Resource = Literal["memory_ops", "tool_calls", "verifications"]


async def check_billing_limit(project, resource: Resource) -> dict | None:
    """
    Call agent-economy /v1/billing/check. Returns None on error (fail-open).
    Raises HTTP 429 if the project has exceeded its daily limit.
    """
    if not settings.economy_url:
        return None

    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.post(
                f"{settings.economy_url}/v1/billing/check",
                json={"project_id": str(project.id), "resource": resource},
            )

        if resp.status_code == 429:
            body = resp.json()
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "rate_limit",
                    "reset_at": body.get("reset_at"),
                    "upgrade_url": body.get("upgrade_url", "https://app.agenttool.dev/billing"),
                    "limit": body.get("limit"),
                    "used": body.get("used"),
                },
                headers={
                    "X-RateLimit-Limit": str(body.get("limit", "")),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": body.get("reset_at", ""),
                },
            )

        if resp.is_success:
            return resp.json()

        # Non-OK, non-429 — fail open
        logger.warning("economy check returned %s — failing open", resp.status_code)
        return None

    except HTTPException:
        raise  # re-raise 429
    except Exception as exc:
        logger.warning("economy check failed (%s) — failing open", exc)
        return None


async def gate_memory_op(project = Depends(get_project)) -> dict | None:
    """FastAPI dependency: check memory_ops limit."""
    return await check_billing_limit(project, "memory_ops")
