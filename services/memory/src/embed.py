"""OpenAI embedding service with retry and caching."""

from __future__ import annotations

import logging

from fastapi import HTTPException
from openai import AsyncOpenAI, RateLimitError, APIError, APIConnectionError

from .config import settings

logger = logging.getLogger(__name__)

_client: AsyncOpenAI | None = None


def get_client() -> AsyncOpenAI:
    """Lazy-init OpenAI client."""
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _client


async def embed_text(text: str) -> list[float]:
    """Generate embedding vector for text using OpenAI.

    Returns a list of floats (1536 dimensions for ada-002).
    """
    client = get_client()
    try:
        response = await client.embeddings.create(
            model=settings.embedding_model,
            input=text,
        )
    except RateLimitError as exc:
        logger.error("OpenAI rate limit / quota exceeded: %s", exc)
        raise HTTPException(status_code=502, detail="Embedding service quota exceeded — please try again later")
    except APIConnectionError as exc:
        logger.error("OpenAI connection error: %s", exc)
        raise HTTPException(status_code=502, detail="Embedding service unavailable")
    except APIError as exc:
        logger.error("OpenAI API error: %s", exc)
        raise HTTPException(status_code=502, detail="Embedding service error")
    return response.data[0].embedding


async def embed_batch(texts: list[str]) -> list[list[float]]:
    """Generate embeddings for multiple texts in one API call."""
    client = get_client()
    response = await client.embeddings.create(
        model=settings.embedding_model,
        input=texts,
    )
    return [item.embedding for item in response.data]
