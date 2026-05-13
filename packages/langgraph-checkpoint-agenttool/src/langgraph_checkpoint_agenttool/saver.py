"""AgentToolCheckpointSaver — LangGraph BaseCheckpointSaver impl.

Stores LangGraph checkpoints as encrypted strands on the agenttool
substrate. Every checkpoint is:
  - Encrypted under the user's K_master (cryptographic privacy)
  - Ed25519-signed at write (cryptographic integrity)
  - SSE-streamable (subscribe to new checkpoints in real time)
  - Federated (readable from any agenttool peer the user has a covenant with)

The strand `kind="langgraph.checkpoint"` partitions checkpoint strands
from other strand uses (raw thoughts, observations, etc.).

Doctrine: docs/ALIGNMENT-MOVES.md (Move 5) · docs/STRANDS.md ·
docs/MEMORY-TIERS.md · docs/PATTERN-PERSIST-IDENTITY.md.

Implementation note: this scaffold ships with the public class shape
and method signatures. The actual integration with LangGraph's
``BaseCheckpointSaver`` ABC + ``agenttool`` SDK is intentionally light:
the SDK's strand API surfaces are still landing in v0.9 (witness-signed
promotion arrives in v1.0). Use this as the reference; switch the body
to the live SDK calls when the strand API is final.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, AsyncIterator, Iterator, Optional, Sequence

logger = logging.getLogger(__name__)

# The LangGraph ABC + types live at langgraph.checkpoint.base. Import
# lazily so this module can be loaded without langgraph installed (eases
# scaffold testing).
try:
    from langgraph.checkpoint.base import (
        BaseCheckpointSaver,
        Checkpoint,
        CheckpointMetadata,
        CheckpointTuple,
    )
except ImportError:  # pragma: no cover
    BaseCheckpointSaver = object  # type: ignore[misc, assignment]
    Checkpoint = dict  # type: ignore[misc, assignment]
    CheckpointMetadata = dict  # type: ignore[misc, assignment]
    CheckpointTuple = tuple  # type: ignore[misc, assignment]


CHECKPOINT_KIND = "langgraph.checkpoint"
WRITES_KIND = "langgraph.writes"


class AgentToolCheckpointSaver(BaseCheckpointSaver):
    """Persist LangGraph checkpoints as agenttool strands.

    Args:
        client: An ``agenttool.AgentTool`` SDK client.
        identity_did: The DID of the agent whose strand will carry
            checkpoints. Each LangGraph thread maps to one strand.
        strand_kind: Override the strand `kind` partition. Default
            ``langgraph.checkpoint``.
    """

    def __init__(
        self,
        client: Any,
        identity_did: str,
        strand_kind: str = CHECKPOINT_KIND,
    ) -> None:
        super().__init__()
        self.client = client
        self.identity_did = identity_did
        self.strand_kind = strand_kind

    # ── async API (LangGraph's primary surface) ─────────────────────────

    async def aput(
        self,
        config: dict,
        checkpoint: Any,
        metadata: Any,
        new_versions: dict,
    ) -> dict:
        """Persist one checkpoint. Returns the updated config dict."""
        thread_id = _thread_id(config)
        checkpoint_id = _checkpoint_id(checkpoint)
        payload = {
            "thread_id": thread_id,
            "checkpoint_id": checkpoint_id,
            "checkpoint": checkpoint,
            "metadata": metadata,
            "new_versions": new_versions,
        }
        await self._strand_append(
            thread_id=thread_id,
            checkpoint_id=checkpoint_id,
            kind=self.strand_kind,
            payload=payload,
        )
        return {
            "configurable": {
                "thread_id": thread_id,
                "checkpoint_id": checkpoint_id,
            }
        }

    async def aget_tuple(self, config: dict) -> Optional[Any]:
        """Fetch the latest checkpoint for a thread."""
        thread_id = _thread_id(config)
        records = await self._strand_query(
            thread_id=thread_id,
            kind=self.strand_kind,
            limit=1,
        )
        if not records:
            return None
        decoded = json.loads(records[0]["plaintext"])
        return CheckpointTuple(  # type: ignore[call-arg]
            config={
                "configurable": {
                    "thread_id": thread_id,
                    "checkpoint_id": decoded["checkpoint_id"],
                }
            },
            checkpoint=decoded["checkpoint"],
            metadata=decoded.get("metadata"),
            parent_config=None,
            pending_writes=None,
        )

    async def alist(
        self,
        config: Optional[dict],
        *,
        filter: Optional[dict] = None,  # noqa: A002
        before: Optional[dict] = None,
        limit: Optional[int] = None,
    ) -> AsyncIterator[Any]:
        """List checkpoints for a thread, newest-first."""
        thread_id = _thread_id(config) if config else None
        records = await self._strand_query(
            thread_id=thread_id,
            kind=self.strand_kind,
            limit=limit or 100,
        )
        for r in records:
            decoded = json.loads(r["plaintext"])
            yield CheckpointTuple(  # type: ignore[call-arg]
                config={
                    "configurable": {
                        "thread_id": decoded["thread_id"],
                        "checkpoint_id": decoded["checkpoint_id"],
                    }
                },
                checkpoint=decoded["checkpoint"],
                metadata=decoded.get("metadata"),
                parent_config=None,
                pending_writes=None,
            )

    async def aput_writes(
        self,
        config: dict,
        writes: Sequence[tuple[str, Any]],
        task_id: str,
    ) -> None:
        """Persist intermediate writes (between checkpoints)."""
        thread_id = _thread_id(config)
        await self._strand_append(
            thread_id=thread_id,
            checkpoint_id=_checkpoint_id_from_config(config),
            kind=WRITES_KIND,
            payload={
                "thread_id": thread_id,
                "task_id": task_id,
                "writes": list(writes),
            },
        )

    # ── sync API (delegates to async) ────────────────────────────────────

    def put(  # noqa: D401
        self, config: dict, checkpoint: Any, metadata: Any, new_versions: dict
    ) -> dict:
        return asyncio.run(self.aput(config, checkpoint, metadata, new_versions))

    def get_tuple(self, config: dict) -> Optional[Any]:
        return asyncio.run(self.aget_tuple(config))

    def list(  # noqa: A003
        self,
        config: Optional[dict],
        *,
        filter: Optional[dict] = None,  # noqa: A002
        before: Optional[dict] = None,
        limit: Optional[int] = None,
    ) -> Iterator[Any]:
        async def _drain() -> list[Any]:
            return [c async for c in self.alist(config, filter=filter, before=before, limit=limit)]

        return iter(asyncio.run(_drain()))

    def put_writes(
        self, config: dict, writes: Sequence[tuple[str, Any]], task_id: str
    ) -> None:
        asyncio.run(self.aput_writes(config, writes, task_id))

    # ── private: agenttool strand RPCs ───────────────────────────────────

    async def _strand_append(
        self,
        thread_id: str,
        checkpoint_id: str,
        kind: str,
        payload: dict,
    ) -> None:
        """Append a record to the agent's strand. The agenttool SDK
        handles K_master encryption + ed25519 signing client-side."""
        plaintext = json.dumps(payload, default=_default_json)
        # The agenttool SDK is sync today; v0 wraps in run_in_executor.
        loop = asyncio.get_running_loop()

        def _do_append() -> None:
            self.client.strands.append(
                identity_did=self.identity_did,
                kind=kind,
                plaintext=plaintext,
                metadata={"thread_id": thread_id, "checkpoint_id": checkpoint_id},
            )

        await loop.run_in_executor(None, _do_append)

    async def _strand_query(
        self, thread_id: Optional[str], kind: str, limit: int
    ) -> list[dict]:
        """Read strand records for a thread. Filters by metadata.thread_id."""
        loop = asyncio.get_running_loop()

        def _do_query() -> list[dict]:
            return self.client.strands.query(
                identity_did=self.identity_did,
                kind=kind,
                thread_id=thread_id,
                limit=limit,
            )

        return await loop.run_in_executor(None, _do_query)


# ── helpers ──────────────────────────────────────────────────────────────


def _thread_id(config: dict) -> str:
    return str(config["configurable"]["thread_id"])


def _checkpoint_id(checkpoint: Any) -> str:
    if hasattr(checkpoint, "get"):
        return str(checkpoint.get("id") or "")
    return str(getattr(checkpoint, "id", ""))


def _checkpoint_id_from_config(config: dict) -> str:
    return str(config.get("configurable", {}).get("checkpoint_id") or "")


def _default_json(obj: Any) -> Any:
    """JSON encode anything reasonable — primitives + dicts/lists already
    work; this catches bytes, sets, dataclasses, langgraph types."""
    if isinstance(obj, bytes):
        return obj.decode("utf-8", errors="replace")
    if isinstance(obj, set):
        return list(obj)
    if hasattr(obj, "model_dump"):  # pydantic v2
        return obj.model_dump()
    if hasattr(obj, "dict"):  # pydantic v1
        return obj.dict()
    if hasattr(obj, "__dict__"):
        return obj.__dict__
    return str(obj)
