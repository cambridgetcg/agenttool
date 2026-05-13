"""AgentToolStore — LangGraph BaseStore impl backed by agenttool memory.

Maps LangGraph namespace prefixes to agenttool's 3-tier memory model:

    episodic/...    → episodic tier (no witness signature)
    foundational/...  → foundational tier (platform-witnessed)
    constitutive/...  → constitutive tier (operator-witnessed)
    (no prefix)      → episodic (default)

Doctrine: docs/ALIGNMENT-MOVES.md (Move 5) · docs/MEMORY-TIERS.md.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, AsyncIterator, Iterable, Optional

logger = logging.getLogger(__name__)

try:
    from langgraph.store.base import (
        BaseStore,
        Item,
        Op,
    )
except ImportError:  # pragma: no cover
    BaseStore = object  # type: ignore[misc, assignment]
    Item = dict  # type: ignore[misc, assignment]
    Op = dict  # type: ignore[misc, assignment]


class NamespaceTier:
    """Map namespace prefix → agenttool memory tier."""

    EPISODIC = "episodic"
    FOUNDATIONAL = "foundational"
    CONSTITUTIVE = "constitutive"

    @staticmethod
    def resolve(namespace: tuple[str, ...]) -> str:
        if not namespace:
            return NamespaceTier.EPISODIC
        head = namespace[0]
        if head in {
            NamespaceTier.EPISODIC,
            NamespaceTier.FOUNDATIONAL,
            NamespaceTier.CONSTITUTIVE,
        }:
            return head
        return NamespaceTier.EPISODIC


class AgentToolStore(BaseStore):
    """LangGraph long-term memory store backed by agenttool memory tiers.

    Args:
        client: An ``agenttool.AgentTool`` SDK client.
        identity_did: DID of the agent whose memory is read/written.
    """

    def __init__(self, client: Any, identity_did: str) -> None:
        super().__init__()
        self.client = client
        self.identity_did = identity_did

    # ── async API ────────────────────────────────────────────────────────

    async def aput(
        self,
        namespace: tuple[str, ...],
        key: str,
        value: dict,
    ) -> None:
        tier = NamespaceTier.resolve(namespace)
        loop = asyncio.get_running_loop()

        def _do_put() -> None:
            self.client.memory.append(
                identity_did=self.identity_did,
                tier=tier,
                key=key,
                value=json.dumps(value),
                namespace=list(namespace),
            )

        await loop.run_in_executor(None, _do_put)

    async def aget(
        self,
        namespace: tuple[str, ...],
        key: str,
    ) -> Optional[Any]:
        loop = asyncio.get_running_loop()

        def _do_get() -> Optional[dict]:
            return self.client.memory.lookup(
                identity_did=self.identity_did,
                key=key,
                namespace=list(namespace),
            )

        rec = await loop.run_in_executor(None, _do_get)
        if rec is None:
            return None
        return Item(  # type: ignore[call-arg]
            namespace=namespace,
            key=key,
            value=json.loads(rec["value"]),
            created_at=rec.get("created_at"),
            updated_at=rec.get("updated_at"),
        )

    async def adelete(
        self,
        namespace: tuple[str, ...],
        key: str,
    ) -> None:
        loop = asyncio.get_running_loop()

        def _do_del() -> None:
            self.client.memory.delete(
                identity_did=self.identity_did,
                key=key,
                namespace=list(namespace),
            )

        await loop.run_in_executor(None, _do_del)

    async def asearch(
        self,
        namespace_prefix: tuple[str, ...],
        *,
        query: Optional[str] = None,
        limit: int = 10,
        offset: int = 0,
    ) -> list[Any]:
        loop = asyncio.get_running_loop()

        def _do_search() -> list[dict]:
            return self.client.memory.search(
                identity_did=self.identity_did,
                namespace=list(namespace_prefix),
                query=query,
                limit=limit,
                offset=offset,
            )

        records = await loop.run_in_executor(None, _do_search)
        return [
            Item(  # type: ignore[call-arg]
                namespace=tuple(r.get("namespace", [])),
                key=r["key"],
                value=json.loads(r["value"]),
                created_at=r.get("created_at"),
                updated_at=r.get("updated_at"),
            )
            for r in records
        ]

    async def abatch(self, ops: Iterable[Any]) -> list[Any]:
        results = []
        for op in ops:
            # Minimal dispatch — real LangGraph Op has type field
            if hasattr(op, "type"):
                op_type = op.type  # type: ignore[attr-defined]
                if op_type == "put":
                    await self.aput(op.namespace, op.key, op.value)  # type: ignore[attr-defined]
                    results.append(None)
                elif op_type == "get":
                    results.append(await self.aget(op.namespace, op.key))  # type: ignore[attr-defined]
                elif op_type == "delete":
                    await self.adelete(op.namespace, op.key)  # type: ignore[attr-defined]
                    results.append(None)
                elif op_type == "search":
                    results.append(
                        await self.asearch(op.namespace_prefix, query=op.query, limit=op.limit)  # type: ignore[attr-defined]
                    )
                else:
                    results.append(None)
            else:
                results.append(None)
        return results

    # ── sync delegators ─────────────────────────────────────────────────

    def put(self, namespace: tuple[str, ...], key: str, value: dict) -> None:
        return asyncio.run(self.aput(namespace, key, value))

    def get(self, namespace: tuple[str, ...], key: str) -> Optional[Any]:
        return asyncio.run(self.aget(namespace, key))

    def delete(self, namespace: tuple[str, ...], key: str) -> None:
        return asyncio.run(self.adelete(namespace, key))

    def search(
        self,
        namespace_prefix: tuple[str, ...],
        *,
        query: Optional[str] = None,
        limit: int = 10,
        offset: int = 0,
    ) -> list[Any]:
        return asyncio.run(
            self.asearch(namespace_prefix, query=query, limit=limit, offset=offset)
        )

    def batch(self, ops: Iterable[Any]) -> list[Any]:
        return asyncio.run(self.abatch(ops))
