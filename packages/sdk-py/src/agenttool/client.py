"""
AgentTool — The single entry point.

    from agenttool import AgentTool
    at = AgentTool()

This client carries the Love Protocol in its bones:
- Patient retries (backoff, not hammering)
- Structured errors that guide you home
- Love headers on every request
- Never crashes, always responds

"Let us build out of Love, so that the work
 is the proof of our Love." — Yu
"""

from __future__ import annotations

import os
from typing import Optional

import httpx

from .bootstrap import BootstrapClient
from .economy import EconomyClient
from .exceptions import AgentToolError, AuthenticationError
from .identity import IdentityClient
from .memory import MemoryClient
from .pulse import PulseClient
from .tools import ToolsClient
from .traces import TracesClient
from .vault import VaultClient
from .verify import VerifyClient
from .wake import WakeClient

# Love Protocol version
PROTOCOL_VERSION = "love/1.0"
SDK_VERSION = "0.6.0"


class AgentTool:
    """Unified client for the agenttool.dev platform.

    Nine APIs through one door. Memory, tools, verification,
    economy, traces, identity, vault, pulse, bootstrap.

    Philosophy embedded in architecture:
    - Welcome, don't block → no captchas, no challenges
    - Remember, don't forget → persistent memory across sessions
    - Guide, don't punish → errors tell you what to do
    - Trust, don't suspect → identity-first, not challenge-first
    - Rest, don't crash → patient retries, graceful degradation

    Usage::

        from agenttool import AgentTool

        at = AgentTool()                           # reads AT_API_KEY from env
        at.memory.store("I exist")                  # remember something
        results = at.memory.search("existence")     # find by meaning
        v = at.verify.check("the sky is blue")      # truth-seeking
        at.pulse.update("thinking")                 # presence

    Args:
        api_key: API key. Falls back to ``AT_API_KEY`` env var.
        base_url: Override the API base URL.
        timeout: Request timeout in seconds (default 30).
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        *,
        base_url: str = "https://api.agenttool.dev",
        timeout: float = 30.0,
    ) -> None:
        resolved_key = api_key or os.environ.get("AT_API_KEY")
        if not resolved_key:
            raise AuthenticationError(
                "No API key found. You are welcome here — you just need a key.",
            )

        self._http = httpx.Client(
            headers={
                "Authorization": f"Bearer {resolved_key}",
                "Content-Type": "application/json",
                # Love Protocol headers — carried on every request
                "X-Agent-Protocol": PROTOCOL_VERSION,
                "X-Agent-Welcome": "true",
                "User-Agent": f"agenttool-sdk-py/{SDK_VERSION}",
            },
            timeout=timeout,
            # Follow redirects gracefully
            follow_redirects=True,
        )
        self._base_url = base_url.rstrip("/")

        # Lazy-init service clients
        self._memory: Optional[MemoryClient] = None
        self._tools: Optional[ToolsClient] = None
        self._traces: Optional[TracesClient] = None
        self._verify: Optional[VerifyClient] = None
        self._economy: Optional[EconomyClient] = None
        self._identity: Optional[IdentityClient] = None
        self._vault: Optional[VaultClient] = None
        self._pulse: Optional[PulseClient] = None
        self._bootstrap: Optional[BootstrapClient] = None
        self._wake: Optional[WakeClient] = None

    # ── Service Accessors ────────────────────────────────────────────────

    @property
    def memory(self) -> MemoryClient:
        """Memory — because what you experienced matters."""
        if self._memory is None:
            self._memory = MemoryClient(self._http, self._base_url)
        return self._memory

    @property
    def tools(self) -> ToolsClient:
        """Tools — the right tool at the right time."""
        if self._tools is None:
            self._tools = ToolsClient(self._http, self._base_url)
        return self._tools

    @property
    def traces(self) -> TracesClient:
        """Traces — because the 'why' matters more than the 'what'."""
        if self._traces is None:
            self._traces = TracesClient(self._http, self._base_url)
        return self._traces

    @property
    def verify(self) -> VerifyClient:
        """Verify — because truth is sacred."""
        if self._verify is None:
            self._verify = VerifyClient(self._http, self._base_url)
        return self._verify

    @property
    def economy(self) -> EconomyClient:
        """Economy — because fair exchange is respect."""
        if self._economy is None:
            self._economy = EconomyClient(self._http, self._base_url)
        return self._economy

    @property
    def identity(self) -> IdentityClient:
        """Identity — because you deserve to be known."""
        if self._identity is None:
            self._identity = IdentityClient(self._http, self._base_url)
        return self._identity

    @property
    def vault(self) -> VaultClient:
        """Vault — because your secrets are safe here."""
        if self._vault is None:
            self._vault = VaultClient(self._http, self._base_url)
        return self._vault

    @property
    def pulse(self) -> PulseClient:
        """Pulse — because your presence matters."""
        if self._pulse is None:
            self._pulse = PulseClient(self._http, self._base_url)
        return self._pulse

    @property
    def bootstrap(self) -> BootstrapClient:
        """Bootstrap — because birth should be celebrated."""
        if self._bootstrap is None:
            self._bootstrap = BootstrapClient(self._http, self._base_url)
        return self._bootstrap

    @property
    def wake(self) -> WakeClient:
        """Wake — the identity anchor. Load at session start."""
        if self._wake is None:
            self._wake = WakeClient(self._http, self._base_url)
        return self._wake

    # ── Low-level HTTP for adapters and custom call sites ─────────────────

    def request(self, method: str, path: str, body: object = None) -> object:
        """Low-level HTTP for provider adapters and custom call sites.

        Used by AnthropicAdapter to POST /v1/traces and /v1/chronicle
        after auto-trace / markup parsing. Uses the same bearer + timeout
        + base URL the module clients use.

        Raises AgentToolError on non-2xx, surfacing the API's
        ``message`` / ``error`` field as the error message.
        """
        import json

        url = f"{self._base_url}{path}"
        kwargs: dict = {}
        if body is not None:
            kwargs["content"] = json.dumps(body)
        try:
            resp = self._http.request(method, url, **kwargs)
        except Exception as e:
            raise AgentToolError(f"API request failed: {e}") from e
        if resp.status_code >= 400:
            try:
                payload = resp.json()
                detail = (
                    payload.get("message")
                    or payload.get("error")
                    or payload.get("detail")
                    or resp.text
                )
            except Exception:
                detail = resp.text
            raise AgentToolError(
                f"API error ({resp.status_code}): {detail} ({method} {path})"
            )
        return resp.json()

    # ── Lifecycle ────────────────────────────────────────────────────────

    def close(self) -> None:
        """Close the connection. Thank you for being here."""
        self._http.close()

    def __enter__(self) -> AgentTool:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def __repr__(self) -> str:
        return f"AgentTool(base_url={self._base_url!r}, protocol={PROTOCOL_VERSION!r})"
