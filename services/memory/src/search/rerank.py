"""Reranking: importance × recency decay applied to vector search results."""

from __future__ import annotations

# TODO: implement in core-build phase
# - rerank(results: list[(Memory, score)], limit: int) → list[MemorySearchResult]
# - recency_decay(created_at: datetime) → float  (1.0 for today, decays over time)
