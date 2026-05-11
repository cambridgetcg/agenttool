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

from typing import Any, Literal, Optional, TypedDict


# Same NextAction shape used across the substrate — error bodies + wake
# `you_should_check` items + wake `you_can_now` items. Doctrine:
# docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md · docs/PATTERN-SELF-DESCRIBING-WAKE.md
class NextAction(TypedDict, total=False):
    action: str
    method: Optional[Literal["GET", "POST", "PUT", "PATCH", "DELETE"]]
    path: Optional[str]
    body_hint: Optional[dict[str, Any]]


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
    ) -> None:
        self.message = message
        self.hint = hint
        self.code = code
        self.error_code = error_code
        self.next_actions = next_actions
        self.docs = docs
        super().__init__(message)

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
            else fallback
        )
        error_code = b["error"] if isinstance(b.get("error"), str) else None
        hint = b["hint"] if isinstance(b.get("hint"), str) else None
        docs = b["docs"] if isinstance(b.get("docs"), str) else None
        next_actions = (
            b["next_actions"] if isinstance(b.get("next_actions"), list) else None
        )
        return cls(
            msg,
            hint=hint,
            code=status,
            error_code=error_code,
            next_actions=next_actions,
            docs=docs,
        )


class AuthenticationError(AgentToolError):
    """Your identity couldn't be verified.

    This isn't suspicion — it's just a missing or expired key.
    The fix is always simple.
    """

    def __init__(self, message: str = "Authentication failed.", detail: str = "") -> None:
        super().__init__(
            message,
            hint="Check your API key. Set AT_API_KEY env var or pass api_key= to AgentTool(). "
                 "Get a free key at https://app.agenttool.dev",
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
