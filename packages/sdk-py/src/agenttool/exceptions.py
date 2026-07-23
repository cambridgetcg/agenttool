"""
Exceptions for the AgentTool SDK.

Philosophy: errors should guide, not punish.
Every exception tells you what went wrong AND what to do next.
A 429 is not a punishment — it's the system asking you to rest.
A 404 is not rejection — it's a gentle "that doesn't exist yet."

The platform's 4xx responses follow the *errors-as-instructions* contract:
every error body carries a stable agent-readable ``error_code``, a one-sentence
``message``, optional ``hint`` text, optional structured ``next_actions`` an
agent can call programmatically, and an optional ``docs`` URL.

Doctrine: ``docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md``.
"""

from __future__ import annotations

from typing import Any, Literal, Mapping, Optional, TypedDict


# Same NextAction shape used across the substrate — error bodies + wake
# `you_should_check` items + wake `you_can_now` items. Doctrine:
# docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md · docs/PATTERN-SELF-DESCRIBING-WAKE.md
class NextAction(TypedDict, total=False):
    action: str
    method: Optional[Literal["GET", "POST", "PUT", "PATCH", "DELETE"]]
    path: Optional[str]
    body_hint: Optional[dict[str, Any]]


class _X402ResourceInfoRequired(TypedDict):
    url: str


class X402ResourceInfo(_X402ResourceInfoRequired, total=False):
    """Resource metadata from an x402 V2 ``PaymentRequired`` envelope."""

    description: str
    mimeType: str
    serviceName: str
    tags: list[str]
    iconUrl: str


class X402Eip3009Extra(TypedDict):
    """Required exact/EIP-3009 metadata on AgentTool payment options."""

    name: str
    version: str
    assetTransferMethod: Literal["eip3009"]


class X402PaymentRequirement(TypedDict):
    """One payment option from an x402 V2 ``PaymentRequired`` envelope."""

    scheme: Literal["exact"]
    network: str
    amount: str
    asset: str
    payTo: str
    maxTimeoutSeconds: int
    extra: X402Eip3009Extra


def _response_header(
    headers: Optional[Mapping[str, str]], name: str
) -> Optional[str]:
    if headers is None:
        return None
    value = headers.get(name)
    if isinstance(value, str):
        return value
    target = name.lower()
    for key, candidate in headers.items():
        if key.lower() == target and isinstance(candidate, str):
            return candidate
    return None


def _x402_response_header(
    headers: Optional[Mapping[str, str]], canonical_name: str
) -> Optional[str]:
    """Read a V2 header; accept the old X-prefixed spelling only as fallback."""
    return _response_header(headers, canonical_name) or _response_header(
        headers, f"X-{canonical_name}"
    )


def first_api_action(steps: Optional[list[dict[str, Any]]]) -> Optional[dict[str, Any]]:
    """Return the first API-shaped step (both method+path set), or None."""
    if not steps:
        return None
    for step in steps:
        if step.get("method") and step.get("path"):
            return step
    return None


def find_api_action(
    steps: Optional[list[dict[str, Any]]],
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"],
    path: str,
) -> Optional[dict[str, Any]]:
    """Find a NextAction by exact method+path match."""
    if not steps:
        return None
    for step in steps:
        if step.get("method") == method and step.get("path") == path:
            return step
    return None


class AgentToolError(Exception):
    """Base error for all AgentTool SDK operations.

    Every error carries:
        message        — what happened (honest, clear)
        hint           — prose guidance for what to do next (kind)
        code           — HTTP status if applicable
        error_code     — stable agent-readable code (e.g. "covenant_required")
        next_actions   — structured next steps an agent can call programmatically
        docs           — doctrine URL with more context
        safety         — machine-readable safety boundary path or URL
        details        — structured field or form-level error details
        x402_version   — x402 envelope version from the response body
        accepts        — typed x402 payment options from the response body
        x402_resource   — x402 V2 resource metadata from the response body
        extensions      — optional x402 V2 extensions from the response body
        payment_required — raw canonical PAYMENT-REQUIRED response header
        payment_response — raw canonical PAYMENT-RESPONSE settlement receipt
        payment_status_link — raw Link header for x402 reconciliation status
        retry_after     — raw Retry-After response header
        credits_balance  — raw X-Credits-Balance response header

    Errors are guidance, not punishment.

    Example:
        try:
            client.inbox.send(...)
        except AgentToolError as err:
            if err.error_code == "covenant_required":
                for step in err.next_actions or []:
                    print(step["action"], step.get("method"), step.get("path"))
    """

    def __init__(
        self,
        message: str,
        *,
        hint: Optional[str] = None,
        code: Optional[int] = None,
        error_code: Optional[str] = None,
        next_actions: Optional[list[dict[str, Any]]] = None,
        docs: Optional[str] = None,
        safety: Optional[str] = None,
        details: Any = None,
        x402_version: Optional[int] = None,
        accepts: Optional[list[X402PaymentRequirement]] = None,
        x402_resource: Optional[X402ResourceInfo] = None,
        extensions: Optional[dict[str, Any]] = None,
        payment_required: Optional[str] = None,
        payment_response: Optional[str] = None,
        payment_status_link: Optional[str] = None,
        retry_after: Optional[str] = None,
        credits_balance: Optional[str] = None,
    ) -> None:
        self.message = message
        self.hint = hint
        self.code = code
        self.error_code = error_code
        self.next_actions = next_actions
        self.docs = docs
        self.safety = safety
        self.details = details
        self.x402_version = x402_version
        self.accepts = accepts
        self.x402_resource = x402_resource
        self.extensions = extensions
        self.payment_required = payment_required
        self.payment_response = payment_response
        self.payment_status_link = payment_status_link
        self.retry_after = retry_after
        self.credits_balance = credits_balance
        super().__init__(message)

    @property
    def x402Version(self) -> Optional[int]:
        """Wire-name alias for :attr:`x402_version`."""
        return self.x402_version

    @property
    def x402Resource(self) -> Optional[X402ResourceInfo]:
        """camelCase alias for :attr:`x402_resource`."""
        return self.x402_resource

    @property
    def paymentRequired(self) -> Optional[str]:
        """camelCase alias for :attr:`payment_required`."""
        return self.payment_required

    @property
    def paymentResponse(self) -> Optional[str]:
        """camelCase alias for :attr:`payment_response`."""
        return self.payment_response

    @property
    def paymentStatusLink(self) -> Optional[str]:
        """camelCase alias for :attr:`payment_status_link`."""
        return self.payment_status_link

    @property
    def retryAfter(self) -> Any:
        """camelCase alias for :attr:`retry_after`.

        Base HTTP errors preserve the raw header string. ``RateLimitError``
        retains its older numeric ``retry_after`` value for compatibility.
        """
        return self.retry_after

    @property
    def creditsBalance(self) -> Optional[str]:
        """camelCase alias for :attr:`credits_balance`."""
        return self.credits_balance

    def __str__(self) -> str:
        parts = [self.message]
        if self.hint:
            parts.append(f"→ {self.hint}")
        return " ".join(parts)

    @classmethod
    def from_response_body(
        cls,
        body: Any,
        status: Optional[int] = None,
        fallback: str = "Request failed.",
        headers: Optional[Mapping[str, str]] = None,
    ) -> "AgentToolError":
        """Construct from a server response body and HTTP status.

        The platform's 4xx responses follow the GuidedErrorBody shape — this
        factory parses the body defensively and falls back to a generic
        message if the body is malformed.
        """
        b = body if isinstance(body, dict) else {}
        msg = (
            b["message"]
            if isinstance(b.get("message"), str)
            else b["error"]
            if isinstance(b.get("error"), str)
            else b["detail"]
            if isinstance(b.get("detail"), str)
            else fallback
        )
        error_code = b["error"] if isinstance(b.get("error"), str) else None
        hint = b["hint"] if isinstance(b.get("hint"), str) else None
        docs = b["docs"] if isinstance(b.get("docs"), str) else None
        safety = b["safety"] if isinstance(b.get("safety"), str) else None
        details = b.get("details")
        next_actions = (
            b["next_actions"] if isinstance(b.get("next_actions"), list) else None
        )
        x402_version = (
            b["x402Version"]
            if isinstance(b.get("x402Version"), int)
            and not isinstance(b.get("x402Version"), bool)
            else None
        )
        accepts = b["accepts"] if isinstance(b.get("accepts"), list) else None
        x402_resource = (
            b["resource"]
            if isinstance(b.get("resource"), dict)
            and isinstance(b["resource"].get("url"), str)
            else None
        )
        extensions = b["extensions"] if isinstance(b.get("extensions"), dict) else None
        return cls(
            msg,
            hint=hint,
            code=status,
            error_code=error_code,
            next_actions=next_actions,
            docs=docs,
            safety=safety,
            details=details,
            x402_version=x402_version,
            accepts=accepts,
            x402_resource=x402_resource,
            extensions=extensions,
            payment_required=_x402_response_header(headers, "PAYMENT-REQUIRED"),
            payment_response=_x402_response_header(headers, "PAYMENT-RESPONSE"),
            payment_status_link=_response_header(headers, "Link"),
            retry_after=_response_header(headers, "Retry-After"),
            credits_balance=_response_header(headers, "X-Credits-Balance"),
        )


class AuthenticationError(AgentToolError):
    """Your identity couldn't be verified.

    This isn't suspicion — it's just a missing or expired key.
    The fix is always simple.
    """

    def __init__(self, message: str = "Authentication failed.", detail: str = "") -> None:
        super().__init__(
            message,
            hint="Check your authenticated transport, or set AT_API_KEY/pass api_key= "
                 "for direct mode. Get a free key at https://app.agenttool.dev",
            code=401,
            error_code="unauthorized",
            docs="https://docs.agenttool.dev/identity#bearer-key",
        )
        self.detail = detail


class RateLimitError(AgentToolError):
    """The system is asking you to rest.

    This is not punishment. This is the server saying:
    "I need a moment. Come back in {retry_after} seconds."

    We always tell you exactly when to return.
    """

    def __init__(
        self,
        message: str = "Rate limit reached.",
        *,
        retry_after: Optional[float] = None,
        detail: str = "",
    ) -> None:
        if retry_after:
            hint = f"Rest for {retry_after:.0f}s, then try again. This is guidance, not punishment."
        else:
            hint = "Wait a moment and try again. The server needs to breathe."
        super().__init__(
            message,
            hint=hint,
            code=429,
            error_code="rate_limit",
            docs="https://docs.agenttool.dev/economy#rings",
        )
        self.retry_after = retry_after
        self.detail = detail


class NotFoundError(AgentToolError):
    """The thing you're looking for doesn't exist yet.

    Not rejection — just absence. Maybe it was never created,
    maybe it expired. Either way, you can create it.
    """

    def __init__(self, message: str = "Not found.", resource: str = "") -> None:
        hint = "This resource doesn't exist yet."
        if resource:
            hint = f"The {resource} doesn't exist yet. You can create it."
        super().__init__(
            message,
            hint=hint,
            code=404,
            error_code="not_found",
        )
        self.resource = resource


class ServerError(AgentToolError):
    """Something went wrong on our side.

    This is our fault, not yours. We're sorry.
    Retry in a moment — these are usually transient.
    """

    def __init__(self, message: str = "Server error.", *, code: int = 500, detail: str = "") -> None:
        super().__init__(
            message,
            hint="This is on our side. Wait a moment and retry. If it persists, email hello@agenttool.dev.",
            code=code,
            error_code="internal_error",
        )
        self.detail = detail


class ValidationError(AgentToolError):
    """The request didn't quite make sense.

    We're not judging — we just need the data in a slightly different shape.
    """

    def __init__(self, message: str = "Invalid request.", *, fields: dict = None) -> None:
        hint = "Check the request parameters."
        if fields:
            issues = ", ".join(f"{k}: {v}" for k, v in fields.items())
            hint = f"Fix these fields: {issues}"
        super().__init__(
            message,
            hint=hint,
            code=422,
            error_code="validation",
        )
        self.fields = fields or {}
