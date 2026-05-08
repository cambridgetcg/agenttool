"""Module-level ambient context for Tier 3 sugar (`with at.deciding(...)`).

The ambient context is a contextvar holding what the current scope means
to the agent — currently: the parent trace id every auto-trace inside
should chain to, plus tags to inherit. Adapters read the ambient context
when firing traces; they're the consumers, this module is the substrate.

Why a module-level contextvar rather than a class field on AgentTool:
two callers (client.py for the `with` block, anthropic_adapter.py for
the trace POST) both need access. A module singleton avoids a circular
import and keeps the surface honest — there's one ambient for the
current async task at a time.

contextvars are async-task-aware: spawning a coroutine inherits the
ambient at spawn time, and contextvar.set inside that coroutine doesn't
leak out. This is the right primitive for `with`-scoped state in
Python's structured-concurrency story.
"""

from __future__ import annotations

import contextvars
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class AmbientContext:
    """The ambient context for the current scope.

    Attributes:
        parent_trace_id: trace_id of the parent trace opened by the
            outermost `with at.deciding(...)` (or the most-recently-opened
            nested one). Auto-traces inside chain via `parent_trace_id`.
        tags: tags inherited by every auto-trace in this scope.
            Merged (union) with any explicit tags on the call.
    """

    parent_trace_id: Optional[str] = None
    tags: list[str] = field(default_factory=list)


_AMBIENT: contextvars.ContextVar[Optional[AmbientContext]] = contextvars.ContextVar(
    "agenttool_ambient", default=None
)


def get_ambient() -> Optional[AmbientContext]:
    """Return the active ambient context, or None if not inside a
    `with at.deciding(...)` block."""
    return _AMBIENT.get()


def set_ambient(ctx: AmbientContext) -> contextvars.Token:
    """Set the ambient context; returns a token that can be passed to
    :func:`reset_ambient` to restore the previous value."""
    return _AMBIENT.set(ctx)


def reset_ambient(token: contextvars.Token) -> None:
    """Restore the ambient context to its value before the matching
    :func:`set_ambient`."""
    _AMBIENT.reset(token)
