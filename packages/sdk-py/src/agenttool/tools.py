"""Tools client for agent-tools API.

Wraps the substrate primitives the consolidated API exposes:
``/v1/scrape``, ``/v1/browse``, ``/v1/document``, ``/v1/execute``,
``/v1/jobs/:id``. Substrate-not-resold-APIs — agents bring their own
LLM / search keys via ``at.vault`` and call providers directly.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import httpx

from .exceptions import AgentToolError
from .models import DocumentResult, ExecuteResult, ScrapeResult


class ToolsClient:
    """Client for the agent-tools API.

    Usage::

        at = AgentTool()
        # Both remote paths are disabled by default on the API.
        page = at.tools.scrape("https://example.com")
        out = at.tools.execute("print(1+1)")

    Web search is BYOK as of 0.7.1 — store your provider key in
    ``at.vault`` and call it via ``at.tools.execute``.
    """

    def __init__(self, http: httpx.Client, base_url: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")

    def _url(self, path: str) -> str:
        return f"{self._base}{path}"

    def scrape(self, url: str) -> ScrapeResult:
        """Scrape a URL and return its content.

        Args:
            url: The URL to scrape.

        Returns:
            ScrapeResult with the page content.
        """
        # Path bug fix (0.6.1): was /v1/scrape/scrape (404 in the
        # consolidated API). The real endpoint is POST /v1/scrape.
        body: Dict[str, Any] = {"url": url}
        resp = self._http.post(self._url("/v1/scrape"), json=body)
        self._check(resp)
        return ScrapeResult.from_dict(resp.json())

    def execute(self, code: str, *, language: str = "python") -> ExecuteResult:
        """Call the disabled-by-default legacy host-execute route.

        This is not a tenant sandbox. The API returns 503 unless its operator
        explicitly opts into the unisolated path.

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

            import base64
            doc = at.tools.parse_document(
                base64=base64.b64encode(b"local document").decode(),
                content_type="text/plain",
            )
            print(doc.title, doc.word_count)
        """
        if bool(url) == bool(base64):
            raise AgentToolError(
                "parse_document requires exactly one of url or base64.",
                hint="Pass url='...' or base64='...', content_type='text/html'",
            )
        if base64 and len(base64) > 1_400_000:
            raise AgentToolError(
                "parse_document base64 exceeds the 1,400,000 character limit."
            )
        body: Dict[str, Any] = {}
        if url:
            body["url"] = url
        if base64:
            body["base64"] = base64
        if content_type:
            body["content_type"] = content_type

        # Path bug fix (0.6.1): was /v1/document/document (404). The
        # real endpoint is POST /v1/document.
        resp = self._http.post(self._url("/v1/document"), json=body)
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
