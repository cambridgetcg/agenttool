"""Thin client for a separately operated agent-data/v1 node.

The data node is a distinct security boundary from api.agenttool.dev. This
client owns a separate HTTP session and optional bearer so the AgentTool
project bearer is never reused or sent to the node implicitly.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

import httpx

from .exceptions import AgentToolError


AGENT_DATA_PROTOCOL = "agent-data/v1"
AGENT_DATA_DISCOVERY_PATH = "/.well-known/agent-data"


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
            follow_redirects=True,
        )

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
