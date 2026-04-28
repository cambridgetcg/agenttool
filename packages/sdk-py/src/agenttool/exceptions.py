"""
Exceptions for the AgentTool SDK.

Philosophy: errors should guide, not punish.
Every exception tells you what went wrong AND what to do next.
A 429 is not a punishment — it's the system asking you to rest.
A 404 is not rejection — it's a gentle "that doesn't exist yet."
"""

from __future__ import annotations

from typing import Optional


class AgentToolError(Exception):
    """Base error for all AgentTool SDK operations.

    Every error carries:
        message — what happened (honest, clear)
        hint    — what to do next (actionable, kind)
        code    — HTTP status if applicable

    Errors are guidance, not punishment.
    """

    def __init__(
        self,
        message: str,
        *,
        hint: Optional[str] = None,
        code: Optional[int] = None,
    ) -> None:
        self.message = message
        self.hint = hint
        self.code = code
        super().__init__(message)

    def __str__(self) -> str:
        parts = [self.message]
        if self.hint:
            parts.append(f"→ {self.hint}")
        return " ".join(parts)


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
        super().__init__(message, hint=hint, code=429)
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
        super().__init__(message, hint=hint, code=404)
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
        super().__init__(message, hint=hint, code=422)
        self.fields = fields or {}
