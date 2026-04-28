"""Embedding service using sentence-transformers with hash-based fallback."""

import hashlib
import logging
import struct

from agent_trace.config import settings

logger = logging.getLogger(__name__)

_model = None
_use_fallback = False


def _load_model():
    global _model, _use_fallback
    if _model is not None or _use_fallback:
        return

    try:
        from sentence_transformers import SentenceTransformer

        _model = SentenceTransformer(settings.embedding_model)
        logger.info("Loaded embedding model: %s", settings.embedding_model)
    except Exception as e:
        logger.warning("Could not load sentence-transformers model: %s. Using hash fallback.", e)
        _use_fallback = True


def _hash_embed(text: str, dimensions: int) -> list[float]:
    """Deterministic hash-based mock embedding for environments without the model."""
    h = hashlib.sha512(text.encode()).digest()
    # Extend hash to fill dimensions (using 2 bytes per dimension as uint16)
    while len(h) < dimensions * 2:
        h += hashlib.sha512(h).digest()
    # Unpack as unsigned 16-bit ints, convert to [-1, 1] range
    raw = struct.unpack(f"<{dimensions}H", h[: dimensions * 2])
    values = [(v / 32767.5) - 1.0 for v in raw]
    # Normalize to unit length
    norm = max(sum(v * v for v in values) ** 0.5, 1e-10)
    return [v / norm for v in values]


def embed_text(text: str) -> list[float]:
    """Generate embedding vector for text."""
    _load_model()

    if _model is not None:
        vec = _model.encode(text).tolist()
        return vec

    return _hash_embed(text, settings.embedding_dimensions)


def embed_batch(texts: list[str]) -> list[list[float]]:
    """Generate embeddings for multiple texts."""
    _load_model()

    if _model is not None:
        vecs = _model.encode(texts)
        return [v.tolist() for v in vecs]

    return [_hash_embed(t, settings.embedding_dimensions) for t in texts]
