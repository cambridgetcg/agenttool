"""Tools client for agent-tools API."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import httpx

from .exceptions import AgentToolError
from .models import DocumentResult, ExecuteResult, ScrapeResult, SearchResult


class ToolsClient:
    """Client for the agent-tools API.

    Usage::

        at = AgentTool()
        results = at.tools.search("latest AI news")
        page = at.tools.scrape("https://example.com")
        out = at.tools.execute("print(1+1)")
    """

    def __init__(self, http: httpx.Client, base_url: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")

    def _url(self, path: str) -> str:
        return f"{self._base}{path}"

    def search(self, query: str, *, num_results: int = 5) -> List[SearchResult]:
        """Web search.

        Args:
            query: Search query string.
            num_results: Number of results to return.

        Returns:
            List of SearchResult objects.
        """
        body: Dict[str, Any] = {"query": query, "num_results": num_results}
        resp = self._http.post(self._url("/v1/search/search"), json=body)
        self._check(resp)
        data = resp.json()
        results = data if isinstance(data, list) else data.get("results", [])
        return [SearchResult.from_dict(r) for r in results]

    def scrape(self, url: str) -> ScrapeResult:
        """Scrape a URL and return its content.

        Args:
            url: The URL to scrape.

        Returns:
            ScrapeResult with the page content.
        """
        body: Dict[str, Any] = {"url": url}
        resp = self._http.post(self._url("/v1/scrape/scrape"), json=body)
        self._check(resp)
        return ScrapeResult.from_dict(resp.json())

    def execute(self, code: str, *, language: str = "python") -> ExecuteResult:
        """Execute code in a sandbox.

        Args:
            code: Source code to execute.
            language: "python" or "javascript".

        Returns:
            ExecuteResult with output, error, and exit code.
        """
        body: Dict[str, Any] = {"code": code, "language": language}
        resp = self._http.post(self._url("/v1/execute"), json=body)
        self._check(resp)
        return ExecuteResult.from_dict(resp.json())

    def parse_document(
        self,
        *,
        url: Optional[str] = None,
        base64: Optional[str] = None,
        content_type: Optional[str] = None,
    ) -> DocumentResult:
        """Parse a document and extract readable text.

        Supports HTML (via Mozilla Readability) and plain text.
        Pass either ``url`` (fetched server-side) or ``base64`` encoded content.

        Args:
            url: URL to fetch and parse. Follows redirects.
            base64: Base64-encoded document content.
            content_type: MIME type hint (e.g. ``text/html``, ``text/plain``).
                Auto-detected from URL response headers when omitted.

        Returns:
            :class:`DocumentResult` with title, content, word_count, metadata.

        Example::

            doc = at.tools.parse_document(url="https://example.com/paper.html")
            print(doc.title, doc.word_count)
        """
        if not url and not base64:
            raise AgentToolError(
                "parse_document requires either url or base64.",
                hint="Pass url='...' or base64='...', content_type='text/html'",
            )
        body: Dict[str, Any] = {}
        if url:
            body["url"] = url
        if base64:
            body["base64"] = base64
        if content_type:
            body["content_type"] = content_type

        resp = self._http.post(self._url("/v1/document/document"), json=body)
        self._check(resp)
        return DocumentResult.from_dict(resp.json())

    @staticmethod
    def _check(resp: httpx.Response) -> None:
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail", resp.text)
            except Exception:
                detail = resp.text
            raise AgentToolError(
                f"Tools API error ({resp.status_code}): {detail}",
                hint="Check your API key and request parameters.",
            )
