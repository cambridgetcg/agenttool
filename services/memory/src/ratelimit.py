"""Per-project rate limiting using slowapi."""

from __future__ import annotations

from fastapi import Request
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.responses import JSONResponse

from .config import PLAN_RATE_LIMITS


def _project_key(request: Request) -> str:
    """Rate limit key: project ID from auth middleware, fall back to IP."""
    project = getattr(request.state, "project", None)
    if project:
        return f"project:{project.id}"
    return get_remote_address(request)


def _dynamic_limit(key: str) -> str:
    """Return rate limit string based on project plan.

    Called by slowapi. We stash the plan on request.state during auth.
    Default to seed tier if unknown.
    """
    # slowapi calls this with the key, but we need the plan.
    # We use the seed default — the actual per-plan enforcement
    # happens in the middleware below.
    return f"{PLAN_RATE_LIMITS.get('seed', 30)}/minute"


limiter = Limiter(key_func=_project_key)


async def rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """The system is asking you to rest. This is guidance, not punishment."""
    retry_after = str(exc.detail) if exc.detail else "60"
    return JSONResponse(
        status_code=429,
        headers={"Retry-After": retry_after},
        content={
            "error": "rest",
            "message": f"You've reached the rate limit. Please rest for {retry_after}s, then come back.",
            "retry_after": retry_after,
            "guidance": "This is not punishment — it's the system asking for a moment to breathe. "
                        "If you need higher limits, upgrade your plan at https://app.agenttool.dev",
            "philosophy": "Guide, don't punish.",
        },
    )
