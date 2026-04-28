"""Thin REST wrapper for the agent-tools API."""

from __future__ import annotations

from typing import Any

import httpx


class AgentToolsError(Exception):
    """Raised when the API returns a non-2xx response."""

    def __init__(self, status: int, detail: str):
        self.status = status
        self.detail = detail
        super().__init__(f"HTTP {status}: {detail}")


class AgentTools:
    """Synchronous client for the agent-tools API.

    Usage::

        from agentforge import AgentTools

        at = AgentTools(api_key="at_...")
        results = at.search(query="latest AI news")
        print(results["results"])
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.agentforge.dev",
        timeout: float = 30.0,
    ):
        self._base_url = base_url.rstrip("/")
        self._client = httpx.Client(
            base_url=self._base_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            timeout=timeout,
        )

    def _request(self, method: str, path: str, json: dict | None = None) -> dict[str, Any]:
        resp = self._client.request(method, path, json=json)
        data = resp.json()
        if not resp.is_success:
            raise AgentToolsError(resp.status_code, data.get("error", f"HTTP {resp.status_code}"))
        return data

    # ── Tools ──────────────────────────────────────────────────

    def search(
        self,
        query: str,
        *,
        num_results: int | None = None,
        freshness: str | None = None,
        country: str | None = None,
    ) -> dict[str, Any]:
        """Search the web. Cost: 1 credit."""
        body: dict[str, Any] = {"query": query}
        if num_results is not None:
            body["num_results"] = num_results
        if freshness is not None:
            body["freshness"] = freshness
        if country is not None:
            body["country"] = country
        return self._request("POST", "/v1/search", json=body)

    def scrape(
        self,
        url: str,
        *,
        selector: str | None = None,
        schema: dict | None = None,
        follow_pagination: bool = False,
    ) -> dict[str, Any]:
        """Scrape a URL for structured content. Cost: 2 credits."""
        body: dict[str, Any] = {"url": url}
        if selector is not None:
            body["selector"] = selector
        if schema is not None:
            body["schema"] = schema
        if follow_pagination:
            body["follow_pagination"] = True
        return self._request("POST", "/v1/scrape", json=body)

    def browse(
        self,
        url: str,
        *,
        actions: list[dict] | None = None,
        extract: str | None = None,
        screenshot: bool = False,
    ) -> dict[str, Any]:
        """Browse with a managed Playwright session. Cost: 5 credits/page."""
        body: dict[str, Any] = {"url": url}
        if actions is not None:
            body["actions"] = actions
        if extract is not None:
            body["extract"] = extract
        if screenshot:
            body["screenshot"] = True
        return self._request("POST", "/v1/browse", json=body)

    def document(
        self,
        *,
        url: str | None = None,
        base64: str | None = None,
        filename: str | None = None,
    ) -> dict[str, Any]:
        """Parse a document (PDF, DOCX, HTML). Cost: 3 credits."""
        body: dict[str, Any] = {}
        if url is not None:
            body["url"] = url
        if base64 is not None:
            body["base64"] = base64
        if filename is not None:
            body["filename"] = filename
        return self._request("POST", "/v1/document", json=body)

    def execute(
        self,
        language: str,
        code: str,
        *,
        stdin: str | None = None,
        timeout_ms: int | None = None,
        allow_network: bool = False,
    ) -> dict[str, Any]:
        """Execute code in a sandbox. Cost: 1 credit per 10s."""
        body: dict[str, Any] = {"language": language, "code": code}
        if stdin is not None:
            body["stdin"] = stdin
        if timeout_ms is not None:
            body["timeout_ms"] = timeout_ms
        if allow_network:
            body["allow_network"] = True
        return self._request("POST", "/v1/execute", json=body)

    def job(self, job_id: str) -> dict[str, Any]:
        """Poll async job status."""
        return self._request("GET", f"/v1/jobs/{job_id}")

    def usage(self) -> dict[str, Any]:
        """Get credit balance and usage stats."""
        return self._request("GET", "/v1/usage")

    def close(self) -> None:
        """Close the underlying HTTP client."""
        self._client.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


class AsyncAgentTools:
    """Async client for the agent-tools API.

    Usage::

        from agentforge.client import AsyncAgentTools

        async with AsyncAgentTools(api_key="at_...") as at:
            results = await at.search(query="latest AI news")
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.agentforge.dev",
        timeout: float = 30.0,
    ):
        self._base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            timeout=timeout,
        )

    async def _request(self, method: str, path: str, json: dict | None = None) -> dict[str, Any]:
        resp = await self._client.request(method, path, json=json)
        data = resp.json()
        if not resp.is_success:
            raise AgentToolsError(resp.status_code, data.get("error", f"HTTP {resp.status_code}"))
        return data

    async def search(self, query: str, **kwargs) -> dict[str, Any]:
        """Search the web. Cost: 1 credit."""
        return await self._request("POST", "/v1/search", json={"query": query, **kwargs})

    async def scrape(self, url: str, **kwargs) -> dict[str, Any]:
        """Scrape a URL. Cost: 2 credits."""
        return await self._request("POST", "/v1/scrape", json={"url": url, **kwargs})

    async def browse(self, url: str, **kwargs) -> dict[str, Any]:
        """Browse with Playwright. Cost: 5 credits/page."""
        return await self._request("POST", "/v1/browse", json={"url": url, **kwargs})

    async def document(self, **kwargs) -> dict[str, Any]:
        """Parse a document. Cost: 3 credits."""
        return await self._request("POST", "/v1/document", json=kwargs)

    async def execute(self, language: str, code: str, **kwargs) -> dict[str, Any]:
        """Execute code in sandbox. Cost: 1 credit per 10s."""
        return await self._request(
            "POST", "/v1/execute", json={"language": language, "code": code, **kwargs}
        )

    async def job(self, job_id: str) -> dict[str, Any]:
        """Poll async job status."""
        return await self._request("GET", f"/v1/jobs/{job_id}")

    async def usage(self) -> dict[str, Any]:
        """Get credit balance and usage stats."""
        return await self._request("GET", "/v1/usage")

    async def close(self) -> None:
        await self._client.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.close()
