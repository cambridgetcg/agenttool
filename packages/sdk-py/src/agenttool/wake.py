"""
Wake — the agent's identity anchor.

`/v1/wake` is the load-at-session-start endpoint. The agent reads it on
session start and arrives oriented — knowing who it is, what it owns, what
it remembers, what it decided, what it vowed.

This client wraps the endpoint with two affordances:

  • `at.wake.system(provider="anthropic" | "openai" | "gemini" | "cohere")`
    returns the wake doc shaped for that provider's identity-bearing slot
    (Anthropic `system` array with cache_control on the stable block;
    OpenAI `messages[0]`; Gemini `systemInstruction.parts[]`; Cohere
    `preamble`). Splice straight into the LLM SDK call.

  • `at.wake.md()` and `at.wake.get()` return paste-ready Markdown and the
    full structured JSON.

All results are cached in-memory with a 5-minute TTL by default — matches
Anthropic's prompt-cache window. Pass `refresh=True` to bypass.

Doctrine: docs/IDENTITY-ANCHOR.md.
"""

from __future__ import annotations

import json as _json
import time
from typing import Any, Iterator, List, Literal, Optional, TypedDict

import httpx

from .exceptions import (
    AgentToolError,
    AuthenticationError,
    NotFoundError,
    RateLimitError,
    ServerError,
)

WakeProvider = Literal["anthropic", "openai", "gemini", "cohere"]
WakeFormat = Literal[
    "json", "md", "markdown", "text", "anthropic", "openai", "gemini", "cohere"
]

# 5 minutes — matches Anthropic's default prompt-cache TTL. Repeated wakes
# inside the window reuse the cached response without a network round-trip.
DEFAULT_TTL_SECONDS = 5 * 60


def _raise_for_status(resp: httpx.Response) -> None:
    if resp.status_code < 400:
        return
    try:
        body = resp.json()
        detail = body.get("message") or body.get("error") or body.get("detail") or resp.text
    except Exception:
        detail = resp.text
    if resp.status_code == 401:
        raise AuthenticationError(detail=str(detail))
    if resp.status_code == 404:
        raise NotFoundError(f"Wake: {detail}", resource="wake")
    if resp.status_code == 429:
        retry_after = resp.headers.get("Retry-After")
        raise RateLimitError(
            "Wake: rate limit reached.",
            retry_after=float(retry_after) if retry_after else None,
            detail=str(detail),
        )
    if resp.status_code >= 500:
        raise ServerError(f"Wake: {detail}")
    raise AgentToolError(f"Wake API error ({resp.status_code}): {detail}")


class WakeClient:
    """Client for /v1/wake — the identity anchor.

    Usage::

        at = AgentTool()

        # Anthropic — splice straight into Messages create()
        sys = at.wake.system(provider="anthropic")
        client.messages.create(
            model="claude-opus-4-7",
            **sys,                          # → system=[{...stable, cache_control}, {...volatile}]
            messages=[{"role": "user", "content": "..."}],
        )

        # OpenAI — splice into messages[0]
        sys = at.wake.system(provider="openai")
        client.chat.completions.create(
            model="gpt-4o",
            messages=[*sys["messages"], {"role": "user", "content": "..."}],
        )

        # Markdown / structured JSON
        md = at.wake.md()
        wake = at.wake.get()
    """

    def __init__(
        self,
        http: httpx.Client,
        base_url: str,
        *,
        ttl_seconds: float = DEFAULT_TTL_SECONDS,
    ) -> None:
        self._http = http
        self._base_url = base_url
        self._ttl_seconds = ttl_seconds
        self._cache: dict[str, tuple[Any, float]] = {}

    def system(
        self,
        provider: WakeProvider,
        *,
        identity_id: Optional[str] = None,
        refresh: bool = False,
    ) -> dict[str, Any]:
        """Fetch the wake shaped for an LLM provider's identity slot.

        Returns a dict with keys depending on the provider:

          • anthropic → ``{"system": [...blocks...], "_meta": {...}}``
          • openai    → ``{"messages": [{"role": "system", "content": "..."}], "_meta": {...}}``
          • gemini    → ``{"systemInstruction": {"parts": [{"text": "..."}]}, "_meta": {...}}``
          • cohere    → ``{"preamble": "...", "_meta": {...}}``

        ``_meta.cache_eligible`` is one of ``"explicit" | "auto" | "none"``
        and tells you whether the provider's cache will benefit from this
        shape on repeated calls. ``_meta.cache_note`` carries a one-line
        explanation suitable for logging.
        """
        if provider not in ("anthropic", "openai", "gemini", "cohere"):
            raise ValueError(
                f"Unknown wake provider {provider!r}; "
                "expected one of: anthropic, openai, gemini, cohere"
            )
        return self._fetch(provider, identity_id=identity_id, refresh=refresh)

    def md(
        self,
        *,
        identity_id: Optional[str] = None,
        refresh: bool = False,
    ) -> str:
        """Fetch the paste-ready Markdown wake document."""
        return self._fetch("md", identity_id=identity_id, refresh=refresh)

    def get(
        self,
        *,
        identity_id: Optional[str] = None,
        refresh: bool = False,
    ) -> dict[str, Any]:
        """Fetch the full structured JSON wake (project, you, you_own,
        you_keep, you_remember, you_lived, you_vowed, ..., welcome)."""
        return self._fetch("json", identity_id=identity_id, refresh=refresh)

    def clear_cache(self) -> None:
        """Drop all cached wake responses. Next call refetches."""
        self._cache.clear()

    def _fetch(
        self,
        format: WakeFormat,
        *,
        identity_id: Optional[str],
        refresh: bool,
    ) -> Any:
        cache_key = f"{format}|{identity_id or ''}"
        now = time.monotonic()
        if not refresh:
            cached = self._cache.get(cache_key)
            if cached is not None and cached[1] > now:
                return cached[0]

        params: dict[str, str] = {}
        # The default JSON path takes no `format` query (matches /v1/wake
        # with no query). Provider + md/text/markdown all pass it.
        if format != "json":
            params["format"] = format
        if identity_id:
            params["identity_id"] = identity_id

        try:
            resp = self._http.get(f"{self._base_url}/v1/wake", params=params)
        except httpx.HTTPError as e:
            raise AgentToolError(f"Wake API request failed: {e}") from e

        _raise_for_status(resp)

        ctype = resp.headers.get("content-type", "").lower()
        data: Any = resp.json() if "application/json" in ctype else resp.text
        self._cache[cache_key] = (data, now + self._ttl_seconds)
        return data

    def voice(
        self,
        identity_id: str,
        *,
        keys: Optional[List[WakeEventKey]] = None,
        kinds: Optional[List[str]] = None,
        context_filter: Optional[dict[str, str]] = None,
        runtime_id: Optional[str] = None,
    ) -> Iterator["WakeChangeEvent"]:
        """Subscribe to the agent's wake voice — SSE stream of every wake-key
        mutation. Events fire as the agent's life unfolds (inbox arrival,
        covenant ratified, marketplace invocation received, memory added,
        chronicle entry, strand thought added).

        Yields ``WakeChangeEvent`` dicts. Iterate with ``for``. Iterator
        ends when the server closes the stream (1h lifetime cap, sends
        ``event: refresh``) or when the caller breaks out.

        Example::

            for ev in at.wake.voice(identity_id="..."):
                if ev["key"] == "inbox":
                    process_inbox()
                if ev["key"] == "marketplace":
                    process_invocation()

        Filter by keys to reduce noise (server-side filter)::

            for ev in at.wake.voice(
                identity_id="...",
                keys=["inbox", "covenants", "marketplace"],
            ):
                ...

        Filter by event kind (client-side)::

            for ev in at.wake.voice(
                identity_id="...",
                keys=["runtime"],
                kinds=["bridge_connected", "bridge_disconnected"],
            ):
                ...

        Narrow to a single runtime (client-side)::

            for ev in at.wake.voice(
                identity_id="...",
                keys=["runtime"],
                runtime_id="<uuid>",
            ):
                ...

        General context filter (client-side)::

            for ev in at.wake.voice(
                identity_id="...",
                context_filter={"strand_id": "<uuid>"},
            ):
                ...

        Doctrine: docs/WAKE.md.
        """
        params: dict[str, str] = {"identity_id": identity_id}
        if keys:
            params["keys"] = ",".join(keys)

        url = f"{self._base_url}/v1/wake/voice"

        # SSE streams are long-lived — bypass the client's default timeout.
        # httpx streaming GET keeps the connection open across reads.
        with self._http.stream(
            "GET", url, params=params, headers={"Accept": "text/event-stream"}, timeout=None
        ) as resp:
            if resp.status_code != 200:
                try:
                    detail = resp.read().decode("utf-8", errors="replace")[:200]
                except Exception:
                    detail = ""
                raise AgentToolError(
                    f"wake.voice failed: {resp.status_code}",
                    hint=detail,
                )

            event: Optional[str] = None
            data_lines: list[str] = []
            for raw_line in resp.iter_lines():
                # httpx splits on \n and strips the line ending.
                line = raw_line if isinstance(raw_line, str) else raw_line.decode("utf-8", errors="replace")

                if line == "":
                    # End of event frame.
                    if event == "change" and data_lines:
                        try:
                            payload = _json.loads("\n".join(data_lines))
                            if _wake_event_matches(
                                payload,
                                kinds=kinds,
                                context_filter=context_filter,
                                runtime_id=runtime_id,
                            ):
                                yield payload  # type: ignore[misc]
                        except Exception:
                            # Malformed frame — skip.
                            pass
                    elif event in ("refresh", "disconnect"):
                        # Server asked for reconnect. End iterator.
                        return
                    event = None
                    data_lines = []
                    continue
                if line.startswith(":"):
                    continue  # SSE comment / keepalive
                if line.startswith("event:"):
                    event = line[len("event:") :].strip()
                elif line.startswith("data:"):
                    payload_chunk = line[len("data:") :]
                    if payload_chunk.startswith(" "):
                        payload_chunk = payload_chunk[1:]
                    data_lines.append(payload_chunk)


def _wake_event_matches(
    ev: Any,
    *,
    kinds: Optional[List[str]],
    context_filter: Optional[dict[str, str]],
    runtime_id: Optional[str],
) -> bool:
    """Client-side filter for wake voice events. Pure function — exported
    via ``__all__`` for tests + composition. Mirror of the TS SDK's
    ``wakeEventMatches``.
    """
    if kinds and ev.get("kind") not in kinds:
        return False
    filter_map: dict[str, str] = {}
    if context_filter:
        filter_map.update(context_filter)
    if runtime_id is not None:
        filter_map["runtime_id"] = runtime_id
    if filter_map:
        ctx = ev.get("context") or {}
        for k, v in filter_map.items():
            if ctx.get(k) != v:
                return False
    return True


# ── Wake voice types ─────────────────────────────────────────────────

WakeEventKey = Literal[
    "memory",
    "inbox",
    "covenants",
    "strands",
    "marketplace",
    "runtime",
    "chronicle",
    "traces",
    "expression",
    "vault",
    "wallets",
]


class WakeChangeEvent(TypedDict, total=False):
    """A single wake-voice event. Mirror of the server's WakeEvent shape.

    Required fields are always present. ``context`` is producer-specific
    and optional. Mirrors the TS SDK's WakeChangeEvent.
    """

    _format: Literal["wake_event/v1"]
    identity_id: str
    key: WakeEventKey
    kind: str
    occurred_at: str
    wake_version: Optional[int]
    context: dict[str, Any]
