import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from agent_trace.db import auth_engine, engine
from agent_trace.routes.health import router as health_router
from agent_trace.routes.traces import router as traces_router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("agent-trace starting up")
    yield
    logger.info("agent-trace shutting down")
    await engine.dispose()
    await auth_engine.dispose()


app = FastAPI(
    title="agent-trace",
    description="Reasoning provenance service for AI agents",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(traces_router)
