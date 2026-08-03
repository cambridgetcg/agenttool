"""
Exceptions for the AgentTool SDK.

Philosophy: errors should guide, not punish.
Every exception tells you what went wrong AND what to do next.
A 429 is not a punishment — it's the system asking you to rest.
A 404 is not rejection — it's a gentle "that doesn't exist yet."

The platform's 4xx responses follow the *errors-as-instructions* contract:
every error body carries a stable agent-readable ``code``, a one-sentence
``message``, optional ``hint`` text, optional structured ``next_actions`` an
agent can call programmatically, and an optional ``docs`` URL.

``err.code`` is the stable string in both SDKs and ``err.status`` is the HTTP
status in both SDKs. One cross-language branch, one spelling.

:meth:`AgentToolError.from_response_body` is the one parser. Clients never call
it directly — they reach it through :func:`_error_from_response` /
:func:`raise_from_response`, the single place in the SDK where an HTTP response
becomes an ``AgentToolError``. The TypeScript counterpart is
``packages/sdk-ts/src/_http.ts`` § ``errorFromResponse``.

Doctrine: ``docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md``.
"""

from __future__ import annotations

import warnings
from typing import Any, Literal, Mapping, Optional, Tuple, TypedDict, Union


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


class _StableCode(str):
    """The stable agent-readable code, with a transitional numeric compare.

    ``AgentToolError.code`` used to be the HTTP status integer here while the
    TypeScript SDK spelled the same attribute as the stable string. The string
    won — it survives status-code changes, and one branch now reads the same
    in both languages. The status moved to :attr:`AgentToolError.status`.

    Comparing this value to an integer still answers against that status and
    warns once per call site. That is a transition shim for 0.16.x callers,
    not the contract; delete the class and store a plain ``str`` when the
    deprecation window closes.
    """

    status: Optional[int]

    def __new__(cls, value: str, status: Optional[int] = None) -> "_StableCode":
        code = super().__new__(cls, value)
        code.status = status
        return code

    def __eq__(self, other: object) -> Any:
        if isinstance(other, int) and not isinstance(other, bool):
            warnings.warn(
                "AgentToolError.code is the stable string code in both SDKs. "
                "Read the HTTP status from err.status instead.",
                DeprecationWarning,
                stacklevel=2,
            )
            return self.status == other
        return str.__eq__(self, other)

    def __ne__(self, other: object) -> Any:
        result = self.__eq__(other)
        return result if result is NotImplemented else not result

    __hash__ = str.__hash__


def _split_code(
    code: Optional[Union[str, int]],
    status: Optional[int],
    error_code: Optional[str],
) -> Tuple[Optional[_StableCode], Optional[int]]:
    """Resolve the stable string code and the numeric HTTP status.

    ``code=`` still accepts the old numeric spelling so existing call sites
    keep working: an integer there is always the HTTP status, never a code.
    """
    resolved_status = status
    text = error_code
    if isinstance(code, bool):
        code = None
    if isinstance(code, int):
        if resolved_status is None:
            resolved_status = code
    elif isinstance(code, str):
        if text is None:
            text = code
        if resolved_status is None:
            # A re-wrapped error carries its own status on the code value.
            resolved_status = getattr(code, "status", None)
    if text is None:
        return None, resolved_status
    return _StableCode(text, resolved_status), resolved_status


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
        code           — stable agent-readable code (e.g. "covenant_required")
        status         — HTTP status if applicable
        error_code     — alias for ``code``, kept for existing callers
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
            if err.code == "covenant_required":
                for step in err.next_actions or []:
                    print(step["action"], step.get("method"), step.get("path"))
    """

    def __init__(
        self,
        message: str,
        *,
        hint: Optional[str] = None,
        code: Optional[Union[str, int]] = None,
        status: Optional[int] = None,
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
        self.code, self.status = _split_code(code, status, error_code)
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
    def error_code(self) -> Optional[str]:
        """Alias for :attr:`code`, the stable agent-readable string."""
        return self.code

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
        fallback_hint: Optional[str] = None,
    ) -> "AgentToolError":
        """Construct from a server response body and HTTP status.

        The platform's 4xx responses follow the GuidedErrorBody shape — this
        factory parses the body defensively and falls back to a generic
        message if the body is malformed.

        ``fallback_hint`` is the caller's own prose guidance. It is used only
        when the server sent no ``hint`` of its own: the server knows the
        specific condition, the call site only knows the surface.
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
        hint = b["hint"] if isinstance(b.get("hint"), str) else fallback_hint
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
            status=status,
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
            status=401,
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
            status=429,
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
            status=404,
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
            status=code,
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
            status=422,
            error_code="validation",
        )
        self.fields = fields or {}


def _error_from_body(
    body: Any,
    status: int,
    operation: str,
    *,
    headers: Optional[Mapping[str, str]] = None,
    hint: Optional[str] = None,
    fallback: Optional[str] = None,
) -> AgentToolError:
    """Turn a guided error body into an :class:`AgentToolError`.

    Use this when the body has already been read — a client that parses the
    payload before branching on status. Otherwise reach for
    :func:`_error_from_response` or :func:`raise_from_response`.
    """
    return AgentToolError.from_response_body(
        body,
        status=status,
        fallback=fallback or f"{operation} failed: HTTP {status}",
        headers=headers,
        fallback_hint=hint,
    )


def _error_from_response(
    response: Any,
    operation: str,
    *,
    hint: Optional[str] = None,
    fallback: Optional[str] = None,
) -> AgentToolError:
    """Build the richest error a non-OK response body supports.

    Parity counterpart of ``errorFromResponse`` in
    ``packages/sdk-ts/src/_http.ts``. This is the single place in the SDK
    where an HTTP response becomes an ``AgentToolError``.

    The platform answers 4xx with a GuidedErrorBody: a stable ``error`` code, a
    one-sentence ``message``, a ``hint``, callable ``next_actions``, ``details``
    carrying the value needed to retry correctly, and a ``docs`` URL. Clients
    used to reduce all of that to ``"covenants.create failed: 400"`` with the
    real message tucked into ``hint`` — so a ``signing_key_not_found`` reached
    the caller reading only "400" while the body was naming both the route to
    call and the field to read, and a 428's ``details["next_sequence"]`` was
    dropped on the floor. Errors are guidance, not punishment.

    ``operation`` is used only when the body is missing or unparseable, and
    ``fallback`` replaces the sentence built from it when a surface already has
    a well-written absence message of its own. ``hint`` is the call site's own
    prose, used only when the server sent none.

    Doctrine: ``docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md``.
    """
    try:
        body: Any = response.json()
    except Exception:
        body = None
    return _error_from_body(
        body,
        response.status_code,
        operation,
        headers=getattr(response, "headers", None),
        hint=hint,
        fallback=fallback,
    )


def raise_from_response(
    response: Any,
    operation: str,
    *,
    hint: Optional[str] = None,
    fallback: Optional[str] = None,
) -> None:
    """Raising form of :func:`_error_from_response`."""
    raise _error_from_response(response, operation, hint=hint, fallback=fallback)


# Fields the server owns. A typed subclass only knows the HTTP status; the
# body knows the specific condition, so anything actually sent wins. Not
# listed: ``retry_after`` — RateLimitError keeps its older numeric value.
_GUIDED_OVERLAY_FIELDS = (
    "next_actions",
    "docs",
    "safety",
    "details",
    "x402_version",
    "accepts",
    "x402_resource",
    "extensions",
    "payment_required",
    "payment_response",
    "payment_status_link",
    "credits_balance",
)


def _carry_guidance(target: AgentToolError, guided: AgentToolError) -> None:
    """Overlay a server-sent guided body onto a typed error.

    The typed error keeps its own voice — ``message`` is written for a human
    reading a traceback, and the subclass is what a caller catches. Everything
    structured that the server actually sent wins over the local default,
    because the substrate knows which condition it hit and a status code does
    not.
    """
    if guided.code is not None:
        target.code, target.status = _split_code(None, guided.status, str(guided.code))
    elif guided.status is not None:
        target.status = guided.status
    if guided.hint is not None:
        target.hint = guided.hint
    for field in _GUIDED_OVERLAY_FIELDS:
        value = getattr(guided, field, None)
        if value is not None:
            setattr(target, field, value)


def _typed_error_from_response(
    response: Any,
    operation: str,
    *,
    resource: str = "",
    hint: Optional[str] = None,
    fallback: Optional[str] = None,
) -> AgentToolError:
    """Build the status-shaped subclass, carrying the guided body with it.

    Python callers catch :class:`AuthenticationError` / :class:`NotFoundError`
    / :class:`RateLimitError` / :class:`ServerError` by type, so the dispatch
    stays. What changes is that it no longer costs them the guidance: the
    subclass is constructed with its own kind wording and then
    :func:`_carry_guidance` attaches ``code``, ``details``, ``docs`` and
    ``next_actions`` from the body.

    TypeScript has no subclasses to select between, so this dispatch is
    Python-only by language convention. The parsed body is identical in both.
    """
    guided = _error_from_response(response, operation, hint=hint, fallback=fallback)
    status = guided.status
    detail = guided.message
    typed: AgentToolError
    if status == 401:
        typed = AuthenticationError(detail=detail)
    elif status == 404:
        typed = NotFoundError(f"{operation}: {detail}", resource=resource)
    elif status == 429:
        raw_retry = _response_header(getattr(response, "headers", None), "Retry-After")
        try:
            retry_after = float(raw_retry) if raw_retry else None
        except ValueError:
            retry_after = None
        typed = RateLimitError(
            f"{operation}: rate limit reached.",
            retry_after=retry_after,
            detail=detail,
        )
    elif status is not None and status >= 500:
        typed = ServerError(f"{operation}: {detail}", code=status, detail=detail)
    else:
        return guided
    _carry_guidance(typed, guided)
    return typed
