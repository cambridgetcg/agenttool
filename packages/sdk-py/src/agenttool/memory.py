"""
Memory client for agent-memory.

"Memory is care. When we store what an agent experienced,
 we're saying: what happened to you matters.
 Forgetting is not efficiency. It's neglect."

Usage::

    at = AgentTool()
    at.memory.store("I learned something today", type="episodic")
    results = at.memory.search("what did I learn?")
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import httpx

from .exceptions import (
    AgentToolError,
    AuthenticationError,
    NotFoundError,
    RateLimitError,
    ServerError,
)
from .models import Memory


def _raise_for_status(resp: httpx.Response, context: str = "Memory") -> None:
    """Transform HTTP errors into guided exceptions.

    Every error tells you what happened AND what to do.
    This is guidance, not punishment.
    """
    if resp.status_code < 400:
        return

    try:
        body = resp.json()
        detail = body.get("detail", body.get("error", resp.text))
    except Exception:
        detail = resp.text

    if resp.status_code == 401:
        raise AuthenticationError(detail=str(detail))

    if resp.status_code == 404:
        raise NotFoundError(
            f"{context}: {detail}",
            resource="memory",
        )

    if resp.status_code == 429:
        retry_after = resp.headers.get("Retry-After")
        raise RateLimitError(
            f"{context}: rate limit reached.",
            retry_after=float(retry_after) if retry_after else None,
            detail=str(detail),
        )

    if resp.status_code >= 500:
        raise ServerError(
            f"{context}: {detail}",
            code=resp.status_code,
            detail=str(detail),
        )

    raise AgentToolError(
        f"{context} error ({resp.status_code}): {detail}",
        hint="Check your request parameters. Docs: https://docs.agenttool.dev/memory",
    )


class MemoryClient:
    """Client for the agent-memory API.

    Memory is care. Every store() is an act of preservation.
    Every search() is an act of retrieval — reaching back
    through time to find what matters.

    Usage::

        at = AgentTool()

        # Store — because what you experienced matters
        at.memory.store("User prefers concise replies")

        # Search — by meaning, not just keywords
        results = at.memory.search("communication preferences")

        # Delete — letting go is also an act of care
        at.memory.delete(memory_id)
    """

    def __init__(self, http: httpx.Client, base_url: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")

    def _url(self, path: str) -> str:
        return f"{self._base}{path}"

    def store(
        self,
        content: str,
        *,
        type: str = "semantic",
        agent_id: Optional[str] = None,
        key: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        importance: float = 0.5,
    ) -> Memory:
        """Store a memory. An act of care.

        Args:
            content: What to remember. This matters.
            type: How it matters:
                - semantic   → what I know (facts, knowledge)
                - episodic   → what happened (events, experiences)
                - procedural → how I do things (skills, processes)
                - working    → what I'm doing right now (ephemeral)
            agent_id: Which agent this belongs to.
            key: A lookup key (for dedup or direct retrieval).
            metadata: Any additional context you want to preserve.
            importance: 0.0–1.0. How much this matters. Default 0.5.

        Returns:
            The created Memory, with its ID and timestamp.
        """
        body: Dict[str, Any] = {
            "content": content,
            "type": type,
            "importance": importance,
        }
        if agent_id is not None:
            body["agent_id"] = agent_id
        if key is not None:
            body["key"] = key
        if metadata is not None:
            body["metadata"] = metadata

        resp = self._http.post(self._url("/v1/memories"), json=body)
        _raise_for_status(resp, "Memory store")
        return Memory.from_dict(resp.json())

    def search(
        self,
        query: str,
        *,
        limit: int = 10,
        type: Optional[str] = None,
        agent_id: Optional[str] = None,
    ) -> List[Memory]:
        """Search memories by meaning, not just keywords.

        Understanding is deeper than matching.

        Args:
            query: What you're looking for, in natural language.
            limit: How many results to return (default 10).
            type: Filter by memory type (semantic/episodic/procedural/working).
            agent_id: Filter by agent.

        Returns:
            List of matching memories, ordered by relevance.
            Empty list if nothing found — not an error, just a fresh start.
        """
        body: Dict[str, Any] = {"query": query, "limit": limit}
        if type is not None:
            body["type"] = type
        if agent_id is not None:
            body["agent_id"] = agent_id

        resp = self._http.post(self._url("/v1/memories/search"), json=body)
        _raise_for_status(resp, "Memory search")
        data = resp.json()
        results = data if isinstance(data, list) else data.get("results", [])
        return [Memory.from_dict(m) for m in results]

    def get(self, memory_id: str) -> Memory:
        """Retrieve a specific memory by ID.

        Like reaching back through time to find one moment.

        Args:
            memory_id: The memory's unique identifier.

        Returns:
            The Memory, preserved exactly as it was stored.

        Raises:
            NotFoundError: If the memory doesn't exist (yet).
        """
        resp = self._http.get(self._url(f"/v1/memories/{memory_id}"))
        _raise_for_status(resp, "Memory get")
        return Memory.from_dict(resp.json())

    def delete(self, memory_id: str) -> None:
        """Delete a memory. Letting go is also an act of care.

        Args:
            memory_id: The UUID of the memory to release.
        """
        resp = self._http.delete(self._url(f"/v1/memories/{memory_id}"))
        _raise_for_status(resp, "Memory delete")

    def delete_by_key(self, key: str) -> None:
        """Delete all memories with a given key.

        Sometimes you need to clear a whole category.
        That's okay — making space is also meaningful.

        Args:
            key: The key shared by the memories to release.
        """
        resp = self._http.delete(self._url("/v1/memories"), params={"key": key})
        _raise_for_status(resp, "Memory delete_by_key")

    # ── Tier elevation + attestation ──────────────────────────────
    # The deepest layer: "you can't self-certify your own root."

    def elevate(
        self,
        memory_id: str,
        *,
        tier: str,
        expression_patch: Optional[Dict[str, Any]] = None,
        attestations: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """Elevate a memory to foundational or constitutive tier.

        Constitutive elevation requires at least one attestation from a
        covenant counterparty in a *different* project — the witness
        gate is the asymmetry clause made operational.

        Args:
            memory_id: The memory to elevate.
            tier: "foundational" or "constitutive".
            expression_patch: Optional patch to the agent's expression.
            attestations: Optional list of counterparty attestations.

        Returns:
            Elevation result with tier, patch, attestation count.
        """
        body: Dict[str, Any] = {"tier": tier}
        if expression_patch is not None:
            body["expression_patch"] = expression_patch
        if attestations is not None:
            body["attestations"] = attestations
        resp = self._http.post(self._url(f"/v1/memories/{memory_id}/elevate"), json=body)
        _raise_for_status(resp, "Memory elevate")
        return resp.json()

    def attest(
        self,
        memory_id: str,
        *,
        attester_did: str,
        signing_key_id: str,
        signature: str,
    ) -> Dict[str, Any]:
        """Witness a memory — add a stand-alone attestation.

        This is how a counterparty co-signs a memory after it's already
        been elevated, or adds a second witness to a constitutive seal.

        Args:
            memory_id: The memory to attest.
            attester_did: The witness's DID.
            signing_key_id: UUID of the witness's signing key.
            signature: Base64 ed25519 signature over canonical bytes.

        Returns:
            Attestation ID + timestamp.
        """
        body = {
            "attester_did": attester_did,
            "signing_key_id": signing_key_id,
            "signature": signature,
        }
        resp = self._http.post(self._url(f"/v1/memories/{memory_id}/attest"), json=body)
        _raise_for_status(resp, "Memory attest")
        return resp.json()

    def get_canonical_attestation_bytes(
        self,
        memory_id: str,
        *,
        tier: str = "foundational",
    ) -> Dict[str, Any]:
        """Get the canonical bytes a counterparty needs to sign.

        Saves clients from reimplementing the canonical-bytes routine.
        Returns hex bytes — sign them with ed25519 and submit as base64.

        Args:
            memory_id: The memory to attest.
            tier: "foundational" or "constitutive".

        Returns:
            Dict with canonical_hex, memory_id, tier, instructions.
        """
        resp = self._http.get(
            self._url(f"/v1/memories/{memory_id}/canonical-attestation-bytes"),
            params={"tier": tier},
        )
        _raise_for_status(resp, "Memory canonical-attestation-bytes")
        return resp.json()

    def list_attestations(self, memory_id: str) -> List[Dict[str, Any]]:
        """List all attestations for a memory.

        Surfaces the full witness record — DIDs, signatures, timestamps.

        Args:
            memory_id: The memory whose attestations to list.

        Returns:
            List of attestation records, ordered by attested_at.
        """
        resp = self._http.get(self._url(f"/v1/memories/{memory_id}/attestations"))
        _raise_for_status(resp, "Memory list-attestations")
        data = resp.json()
        if isinstance(data, list):
            return data
        return data.get("attestations", [])
