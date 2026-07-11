"""Tools client for agent-tools API.

Wraps the substrate primitives the consolidated API exposes:
``/v1/scrape``, ``/v1/browse``, ``/v1/document``, ``/v1/execute``,
``/v1/jobs/:id``. Substrate-not-resold-APIs — agents bring their own
LLM / search keys via ``at.vault`` and call providers directly.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, TypeVar

import httpx

from .exceptions import AgentToolError
from .models import DocumentResult, ExecuteResult, ScrapeResult


_StaticToolResult = TypeVar("_StaticToolResult", ScrapeResult, DocumentResult)
_DOCUMENT_MAX_BASE64_CHARS = 1_400_000
_DOCUMENT_MAX_DECODED_BYTES = 1_000_000
_BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
_CANONICAL_BASE64 = re.compile(
    r"(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?"
)


def _payment_response_header(headers: httpx.Headers) -> Optional[str]:
    """Read V2 first; the X-prefixed name is transition-only fallback."""
    return headers.get("PAYMENT-RESPONSE") or headers.get("X-PAYMENT-RESPONSE")


def _strict_base64_decoded_bytes(value: str) -> Optional[int]:
    if (
        not value
        or len(value) % 4 != 0
        or _CANONICAL_BASE64.fullmatch(value) is None
    ):
        return None
    padding = 2 if value.endswith("==") else 1 if value.endswith("=") else 0
    # RFC 4648 requires unused bits in the final symbol to be zero. Reject
    # alternate encodings such as AB== (the canonical spelling is AA==).
    if padding == 2:
        if _BASE64_ALPHABET.index(value[-3]) & 0x0F:
            return None
    elif padding == 1:
        if _BASE64_ALPHABET.index(value[-2]) & 0x03:
            return None
    return (len(value) // 4) * 3 - padding


class ToolsClient:
    """Client for the agent-tools API.

    Usage::

        at = AgentTool()
        # Static scrape uses the bounded public-URL path; execute is disabled.
        page = at.tools.scrape("https://example.com")
        out = at.tools.execute("print(1+1)")

    Web search is BYOK as of 0.7.1. Retrieve provider credentials only inside
    your own trusted process and call the provider from infrastructure you
    control; hosted execute does not inject vault values and is not a tenant
    sandbox.
    """

    def __init__(self, http: httpx.Client, base_url: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")

    def _url(self, path: str) -> str:
        return f"{self._base}{path}"

    def scrape(
        self,
        url: str,
        *,
        selector: Optional[str] = None,
        extract_links: bool = False,
        payment_signature: Optional[str] = None,
    ) -> ScrapeResult:
        """Scrape a public HTTP(S) URL through the server's bounded fetch path.

        The server reads the bytes; HTTP is cleartext and returned content is
        untrusted. Responses are capped before parsing.

        Args:
            url: The URL to scrape.
            selector: Optional CSS selector whose text should be extracted.
            extract_links: Return up to 100 distinct absolute HTTP(S) links.
            payment_signature: Opaque, already signed x402 V2
                ``PAYMENT-SIGNATURE`` base64-JSON header value. The SDK does
                not sign it.

        Returns:
            ScrapeResult with the page content.
        """
        # Path bug fix (0.6.1): was /v1/scrape/scrape (404 in the
        # consolidated API). The real endpoint is POST /v1/scrape.
        body: Dict[str, Any] = {"url": url, "extract_links": extract_links}
        if selector is not None:
            body["selector"] = selector
        kwargs: Dict[str, Any] = {"json": body}
        if payment_signature is not None:
            kwargs["headers"] = {"PAYMENT-SIGNATURE": payment_signature}
        resp = self._http.post(self._url("/v1/scrape"), **kwargs)
        self._check(resp)
        result = ScrapeResult.from_dict(resp.json())
        return self._attach_static_metadata(result, resp)

    def execute(self, code: str, *, language: str = "python") -> ExecuteResult:
        """Call the disabled-by-default legacy host-execute route.

        This is not a tenant sandbox. The API returns 503 unless its operator
        explicitly opts into the unisolated path.

        Args:
            code: Source code to execute.
            language: "python" or "javascript".

        Returns:
            ExecuteResult with stdout, stderr, exit code, duration, timeout,
            and charged-credit fields.
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
        payment_signature: Optional[str] = None,
    ) -> DocumentResult:
        """Parse a document and extract readable text.

        Supports HTML (via Mozilla Readability) and plain text.
        Pass either ``url`` (fetched server-side) or ``base64`` encoded content.

        Args:
            url: Public HTTP(S) URL fetched server-side through the bounded
                path. Redirect destinations are revalidated. HTTP is cleartext
                and remote bytes are server-readable and untrusted.
            base64: Base64-encoded document content.
            content_type: MIME type hint (e.g. ``text/html``, ``text/plain``).
                Valid only for base64 input. URL input always uses the bounded
                upstream response header.
            payment_signature: Opaque, already signed x402 V2
                ``PAYMENT-SIGNATURE`` base64-JSON header value. The SDK does
                not sign it.

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
        has_url = url is not None
        has_base64 = base64 is not None
        if has_url == has_base64:
            raise AgentToolError(
                "parse_document requires exactly one of url or base64.",
                hint="Pass url='...' or base64='...', content_type='text/html'",
            )
        if base64 is not None and len(base64) > _DOCUMENT_MAX_BASE64_CHARS:
            raise AgentToolError(
                "parse_document base64 exceeds the 1,400,000 character limit."
            )
        if base64 is not None:
            decoded_bytes = _strict_base64_decoded_bytes(base64)
            if decoded_bytes is None:
                raise AgentToolError(
                    "parse_document base64 must use canonical padded RFC 4648 "
                    "encoding."
                )
            if decoded_bytes > _DOCUMENT_MAX_DECODED_BYTES:
                raise AgentToolError(
                    "parse_document decoded base64 exceeds the 1,000,000 byte "
                    "limit."
                )
        if url is not None and content_type is not None:
            raise AgentToolError(
                "parse_document content_type is only valid with base64 input.",
                hint="URL documents use the bounded upstream Content-Type header.",
            )
        body: Dict[str, Any] = {}
        if url is not None:
            body["url"] = url
        if base64 is not None:
            body["base64"] = base64
        if content_type is not None:
            body["content_type"] = content_type

        # Path bug fix (0.6.1): was /v1/document/document (404). The
        # real endpoint is POST /v1/document.
        kwargs: Dict[str, Any] = {"json": body}
        if payment_signature is not None:
            kwargs["headers"] = {"PAYMENT-SIGNATURE": payment_signature}
        resp = self._http.post(self._url("/v1/document"), **kwargs)
        self._check(resp)
        result = DocumentResult.from_dict(resp.json())
        return self._attach_static_metadata(result, resp)

    @staticmethod
    def _attach_static_metadata(
        result: _StaticToolResult,
        resp: httpx.Response,
    ) -> _StaticToolResult:
        result.payment_response = _payment_response_header(resp.headers)
        result.payment_status_link = resp.headers.get("Link")
        result.credits_balance = resp.headers.get("X-Credits-Balance")
        return result

    @staticmethod
    def _check(resp: httpx.Response) -> None:
        if resp.status_code >= 400:
            try:
                response_body = resp.json()
            except Exception:
                response_body = None
            parsed = AgentToolError.from_response_body(
                response_body,
                resp.status_code,
                resp.text,
                headers=resp.headers,
            )
            raise AgentToolError(
                f"Tools API error ({resp.status_code}): {parsed.message}",
                hint=(
                    parsed.hint
                    or "Check your API key and request parameters."
                ),
                code=resp.status_code,
                error_code=parsed.error_code,
                next_actions=parsed.next_actions,
                docs=parsed.docs,
                safety=parsed.safety,
                details=parsed.details,
                x402_version=parsed.x402_version,
                accepts=parsed.accepts,
                x402_resource=parsed.x402_resource,
                extensions=parsed.extensions,
                payment_required=parsed.payment_required,
                payment_response=parsed.payment_response,
                payment_status_link=parsed.payment_status_link,
                retry_after=parsed.retry_after,
                credits_balance=parsed.credits_balance,
            )
