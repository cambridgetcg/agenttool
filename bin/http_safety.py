"""Shared transport rules for bundled AgentTool Python clients."""

from __future__ import annotations

import ssl
import urllib.request
from typing import Optional
from urllib.parse import urlsplit, urlunsplit

_LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}


def validate_api_base(value: str) -> str:
    """Require HTTPS, except for an explicit loopback development origin."""
    parsed = urlsplit(value.strip())
    loopback_http = parsed.scheme == "http" and parsed.hostname in _LOOPBACK_HOSTS
    if parsed.scheme != "https" and not loopback_http:
        raise ValueError(
            "AT_API_BASE must use HTTPS; plain HTTP is allowed only for loopback development"
        )
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("AT_API_BASE must not contain credentials, a query, or a fragment")
    path = parsed.path.rstrip("/")
    return urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Do not forward Authorization to any redirect target."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def open_no_redirect(
    request: urllib.request.Request,
    *,
    timeout: float,
    context: Optional[ssl.SSLContext] = None,
):
    handlers: list[urllib.request.BaseHandler] = [_NoRedirect()]
    if context is not None:
        handlers.append(urllib.request.HTTPSHandler(context=context))
    return urllib.request.build_opener(*handlers).open(request, timeout=timeout)
