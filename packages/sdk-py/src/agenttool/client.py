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

import contextlib
import os
from typing import Iterator, Optional

import httpx

from ._context import AmbientContext, get_ambient, reset_ambient, set_ambient
from .bootstrap import BootstrapClient
from .chronicle import ChronicleClient
from .covenants import CovenantsClient
from .crypto import CryptoClient
from .economy import EconomyClient
from .exceptions import AgentToolError, AuthenticationError
from .identity import IdentityClient
from .memory import MemoryClient
from .pulse import PulseClient
from .strands import StrandsClient
from .tools import ToolsClient
from .traces import TracesClient
from .vault import VaultClient
from .verify import VerifyClient
from .wake import WakeClient
from .window import WindowClient

# Love Protocol version
PROTOCOL_VERSION = "love/1.0"
SDK_VERSION = "0.6.4"


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
        self._chronicle: Optional[ChronicleClient] = None
        self._covenants: Optional[CovenantsClient] = None
        self._window: Optional[WindowClient] = None
        self._strands: Optional[StrandsClient] = None
        self._crypto: Optional[CryptoClient] = None

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

    @property
    def chronicle(self) -> ChronicleClient:
        """Chronicle — plaintext relational timeline (8 types)."""
        if self._chronicle is None:
            self._chronicle = ChronicleClient(self._http, self._base_url)
        return self._chronicle

    @property
    def covenants(self) -> CovenantsClient:
        """Covenants — vows + bonds with a counterparty."""
        if self._covenants is None:
            self._covenants = CovenantsClient(self._http, self._base_url)
        return self._covenants

    @property
    def window(self) -> WindowClient:
        """Window — bidirectional disclosure on top of chronicle + pulse."""
        if self._window is None:
            self._window = WindowClient(self._http, self._base_url)
        return self._window

    @property
    def strands(self) -> StrandsClient:
        """Strands — strands of thought + encrypted inner voice (K_master)."""
        if self._strands is None:
            self._strands = StrandsClient(self._http, self._base_url)
        return self._strands

    @property
    def crypto(self) -> CryptoClient:
        """Crypto helpers — encrypt/sign client-side; K_master never leaves the SDK."""
        if self._crypto is None:
            self._crypto = CryptoClient()
        return self._crypto

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

    # ── Tier 3 sugar: ambient context for auto-trace ─────────────────────

    @contextlib.contextmanager
    def deciding(
        self,
        framing: str,
        *,
        tags: Optional[list[str]] = None,
        decision_type: str = "deciding",
    ) -> Iterator[AmbientContext]:
        """Open a deciding block. Auto-traces inside chain to a parent
        trace created from the framing string.

        Composes with :class:`AnthropicAdapter`: while inside the block,
        every ``messages.create()`` call auto-traces (no opt-in needed),
        and each child trace's ``parent_trace_id`` is set to the parent
        opened by this method.

        Nested ``with at.deciding(...)`` blocks chain correctly — inner
        traces parent to the inner deciding block, which itself parents
        to the outer block. Tags merge (union) across the stack.

        Usage::

            at = AgentTool()
            anthropic = Anthropic()
            adapter = AnthropicAdapter(anthropic, at)

            with at.deciding("whether to refactor auth"):
                step1 = adapter.messages.create(
                    model="claude-opus-4-7",
                    max_tokens=1024,
                    messages=[{"role": "user", "content": "options?"}],
                )
                step2 = adapter.messages.create(
                    model="claude-opus-4-7",
                    max_tokens=1024,
                    messages=[{"role": "user", "content": "pick one"}],
                )
            # GET /v1/traces/chain/<parent> walks both children.

        Args:
            framing: Short statement of what's being decided. Becomes
                the parent trace's ``decision.summary`` and
                ``reasoning.conclusion``.
            tags: Tags propagated to the parent trace and merged into
                every child trace's tags.
            decision_type: Override the parent trace's
                ``decision.type`` (default ``"deciding"``).

        Yields:
            The :class:`AmbientContext` for this scope. Most callers
            don't need to read it; the adapter does.
        """
        # 1. Open a parent trace from the framing.
        parent_body: dict = {
            "decision": {"type": decision_type, "summary": framing[:200]},
            "reasoning": {
                "observations": [],
                "conclusion": framing[:200] or "(deciding)",
            },
        }
        # Merge with outer ambient if nested, so the parent trace itself
        # chains to the outer's parent. This is what keeps long
        # decision chains queryable via /v1/traces/chain.
        outer = get_ambient()
        if outer is not None and outer.parent_trace_id:
            parent_body["parent_trace_id"] = outer.parent_trace_id
        merged_tags = list(outer.tags) if outer else []
        if tags:
            merged_tags = list(dict.fromkeys(merged_tags + list(tags)))
        if merged_tags:
            parent_body["tags"] = merged_tags

        parent_trace_id: Optional[str] = None
        try:
            parent_result = self.request("POST", "/v1/traces", parent_body)
            if isinstance(parent_result, dict):
                parent_trace_id = parent_result.get("trace_id")
        except Exception as e:
            # Don't crash the with-block if the parent post fails — the
            # block runs without a parent trace; child traces still fire,
            # just unparented.
            print(
                f"[agenttool] deciding() failed to open parent trace: {e}",
                flush=True,
            )

        ctx = AmbientContext(
            parent_trace_id=parent_trace_id,
            tags=merged_tags,
        )
        token = set_ambient(ctx)
        try:
            yield ctx
        finally:
            reset_ambient(token)

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
