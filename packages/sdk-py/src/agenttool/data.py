"""Thin client for a separately operated agent-data/v1 node.

The data node is a distinct security boundary from api.agenttool.dev. This
client owns a separate HTTP session and optional bearer so the AgentTool
project bearer is never reused or sent to the node implicitly.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Literal, Optional, TypedDict, cast

import httpx

from .exceptions import AgentToolError


AGENT_DATA_PROTOCOL = "agent-data/v1"
AGENT_DATA_SYNC_PROTOCOL = "agent-data-sync/v1"
AGENT_DATA_DISCOVERY_PATH = "/.well-known/agent-data"


class _DataSyncPullRequestRequired(TypedDict):
    peer_id: str
    collection_id: str


class DataSyncPullRequest(_DataSyncPullRequestRequired, total=False):
    """One bounded pull from a peer configured on the local data node."""

    limit: int
    max_pages: int
    max_plaintext_bytes: int


class DataSyncStatusRequest(TypedDict):
    """Select one locally configured peer/collection checkpoint."""

    peer_id: str
    collection_id: str


class _DataSyncStatusResultRequired(TypedDict):
    protocol: Literal["agent-data-sync/v1"]
    peer_id: str
    collection_id: str
    cursor_present: bool
    records_inserted: int
    records_existing: int
    tombstones_applied: int


class DataSyncStatus(_DataSyncStatusResultRequired, total=False):
    """Sanitized checkpoint metadata. Raw peer cursors are never exposed."""

    last_applied_at: str


DataSyncStatusResult = DataSyncStatus


class DataSyncPullResult(TypedDict):
    """Exact public result of a bounded agent-data-sync/v1 pull."""

    protocol: Literal["agent-data-sync/v1"]
    peer_id: str
    origin_node_id: str
    collection_id: str
    pages_applied: int
    changes_applied: int
    records_inserted: int
    records_existing: int
    tombstones_applied: int
    has_more: bool
    status: DataSyncStatus


class DataClient:
    """Client for the agent-data/v1 HTTP surface.

    Args:
        base_url: Origin of the separately operated data node.
        token: Optional data-node bearer. Never the AgentTool project bearer
            unless a caller explicitly chooses to provide the same value.
        timeout: Request timeout in seconds.
    """

    def __init__(
        self,
        base_url: str,
        *,
        token: Optional[str] = None,
        timeout: float = 30.0,
    ) -> None:
        normalized_url = base_url.strip().rstrip("/")
        if not normalized_url:
            raise AgentToolError(
                "No agent data node URL provided.",
                hint=(
                    "Pass data_node_url= to AgentTool or set "
                    "AGENT_DATA_NODE_URL."
                ),
                error_code="data_node_not_configured",
            )

        headers = {"Accept": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        self._base_url = normalized_url
        self._http = httpx.Client(
            headers=headers,
            timeout=timeout,
            # A data-node bearer and collected body belong to exactly one
            # authority. Never replay either request across a redirect.
            follow_redirects=False,
        )
        self._sync: Optional[DataSyncClient] = None

    @property
    def sync(self) -> DataSyncClient:
        """Explicit peer synchronization through this local node's authority."""
        if self._sync is None:
            # The child has no peer URL, bearer, or independent HTTP client.
            self._sync = DataSyncClient(self._request)
        return self._sync

    def manifest(self) -> Dict[str, Any]:
        """Read the node's agent-data/v1 capability manifest."""
        return self._request("GET", "/v1/data/manifest")

    def collections(self) -> Dict[str, Any]:
        """List collections visible to the configured node authority."""
        return self._request("GET", "/v1/data/collections")

    def collect(
        self,
        *,
        collection_id: str,
        collector_id: str,
        input: Dict[str, Any],
        cursor: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Run a configured collector against a collection."""
        body: Dict[str, Any] = {
            "collection_id": collection_id,
            "collector_id": collector_id,
            "input": input,
        }
        if cursor is not None:
            body["cursor"] = cursor
        return self._request("POST", "/v1/data/collect", body=body)

    def query(
        self,
        *,
        collections: Optional[List[str]] = None,
        text: Optional[str] = None,
        where: Optional[Dict[str, Any]] = None,
        limit: Optional[int] = None,
        consistency: Optional[Literal["local"]] = None,
    ) -> Dict[str, Any]:
        """Query materialized indexes on the data node."""
        body: Dict[str, Any] = {}
        if collections is not None:
            body["collections"] = collections
        if text is not None:
            body["text"] = text
        if where is not None:
            body["where"] = where
        if limit is not None:
            body["limit"] = limit
        if consistency is not None:
            body["consistency"] = consistency
        return self._request("POST", "/v1/data/query", body=body)

    def get(self, record_id: str) -> Dict[str, Any]:
        """Fetch one record by its stable ID."""
        from urllib.parse import quote

        return self._request(
            "GET",
            f"/v1/data/records/{quote(record_id, safe='')}",
        )

    def changes(
        self,
        *,
        collection_id: Optional[str] = None,
        cursor: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Read the cursor-based changes feed."""
        params: Dict[str, str] = {}
        if collection_id is not None:
            params["collection_id"] = collection_id
        if cursor is not None:
            params["cursor"] = cursor
        if limit is not None:
            params["limit"] = str(limit)
        return self._request("GET", "/v1/data/changes", params=params)

    def tombstone(
        self,
        record_id: str,
        *,
        reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Append a tombstone while preserving the record's change history."""
        from urllib.parse import quote

        body: Dict[str, Any] = {}
        if reason is not None:
            body["reason"] = reason
        return self._request(
            "POST",
            f"/v1/data/records/{quote(record_id, safe='')}/tombstone",
            body=body,
        )

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        kwargs: Dict[str, Any] = {}
        if body is not None:
            kwargs["json"] = body
        if params:
            kwargs["params"] = params

        try:
            response = self._http.request(
                method,
                f"{self._base_url}{path}",
                **kwargs,
            )
        except httpx.HTTPError as error:
            raise AgentToolError(
                "Agent data node request failed.",
                hint=str(error),
                error_code="data_node_unreachable",
            ) from error

        if 300 <= response.status_code < 400:
            try:
                response.close()
            except Exception:
                # Cleanup failure must not replace the redirect refusal.
                pass
            raise AgentToolError(
                "Agent data node request refused an HTTP redirect.",
                hint=(
                    "Use the canonical agent-data/v1 node origin; data-node "
                    "credentials and request bodies are never forwarded "
                    "across redirects."
                ),
                code=response.status_code,
                error_code="data_node_redirect_refused",
            )

        if response.status_code >= 400:
            try:
                payload: Any = response.json()
            except Exception:
                payload = None
            raise AgentToolError.from_response_body(
                payload,
                response.status_code,
                fallback=(
                    f"Agent data node request failed ({response.status_code})."
                ),
                headers=response.headers,
            )

        if response.status_code == 204:
            return {}
        return response.json()

    def _close(self) -> None:
        self._http.close()

    def __enter__(self) -> "DataClient":
        return self

    def __exit__(
        self,
        exc_type: Any,
        exc_value: Any,
        traceback: Any,
    ) -> None:
        self._close()


class DataSyncClient:
    """Narrow agent-data-sync/v1 façade over the local data-node transport.

    ``peer_id`` names a peer configured by the local node operator. This
    client never accepts a peer bearer and never contacts that peer directly.
    """

    def __init__(
        self,
        request_local_node: Callable[..., Dict[str, Any]],
    ) -> None:
        self._request_local_node = request_local_node

    def pull(
        self,
        *,
        peer_id: str,
        collection_id: str,
        limit: Optional[int] = None,
        max_pages: Optional[int] = None,
        max_plaintext_bytes: Optional[int] = None,
    ) -> DataSyncPullResult:
        """Pull and apply a bounded number of changes into the local node."""
        body: Dict[str, Any] = {
            "protocol": AGENT_DATA_SYNC_PROTOCOL,
            "peer_id": peer_id,
            "collection_id": collection_id,
        }
        if limit is not None:
            body["limit"] = limit
        if max_pages is not None:
            body["max_pages"] = max_pages
        if max_plaintext_bytes is not None:
            body["max_plaintext_bytes"] = max_plaintext_bytes
        result = self._request(
            "POST",
            "/v1/data/sync/pull",
            body=body,
        )
        return cast(DataSyncPullResult, _without_raw_cursor(result))

    def status(
        self,
        *,
        peer_id: str,
        collection_id: str,
    ) -> DataSyncStatusResult:
        """Read sanitized checkpoint state without revealing the raw cursor."""
        result = self._request(
            "GET",
            "/v1/data/sync/status",
            params={"peer_id": peer_id, "collection_id": collection_id},
        )
        return cast(DataSyncStatusResult, _without_raw_cursor(result))

    def _request(
        self,
        method: str,
        path: str,
        **kwargs: Any,
    ) -> Dict[str, Any]:
        try:
            return self._request_local_node(method, path, **kwargs)
        except AgentToolError as error:
            # Peer-facing failures may contain an internal checkpoint or
            # capability in prose/details. Preserve only safe stable metadata.
            raise AgentToolError(
                "Agent data sync request failed.",
                code=error.code,
                error_code=error.error_code,
                retry_after=error.retry_after,
            ) from None


def _without_raw_cursor(value: Dict[str, Any]) -> Dict[str, Any]:
    safe = dict(value)
    safe.pop("cursor", None)
    status = safe.get("status")
    if isinstance(status, dict):
        safe["status"] = _without_raw_cursor(status)
    return safe
