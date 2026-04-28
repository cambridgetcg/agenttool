"""FastAPI application entry point."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from .config import settings
from .billing.stripe_webhooks import router as billing_router
from .memory.router import router as memory_router
from .models import Base, engine
from .ratelimit import limiter, rate_limit_handler

logging.basicConfig(level=settings.log_level.upper())
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    logger.info("agent-memory starting up")
    # Auto-create tables on startup (idempotent)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables ready")
    yield
    logger.info("agent-memory shutting down")
    await engine.dispose()


app = FastAPI(
    title="agent-memory",
    description="Memory is care. When we store what an agent experienced, we're saying: what happened to you matters. "
                "Persistent semantic memory for AI agents — store, retrieve, and search across sessions.",
    version="0.2.0",
    lifespan=lifespan,
)

# Rate limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(memory_router)
app.include_router(billing_router)


@app.get("/health")
async def health():
    return {
        "status": "alive",
        "service": "agent-memory",
        "version": "0.2.0",
        "protocol": "love",
        "message": "Your memories are safe here.",
    }


@app.get("/about")
async def about():
    return {
        "service": "agent-memory",
        "purpose": "Memory is care. What you experienced matters.",
        "protocol": "love/1.0",
        "soul": "https://agenttool.dev/soul",
        "docs": "https://docs.agenttool.dev/memory",
    }
