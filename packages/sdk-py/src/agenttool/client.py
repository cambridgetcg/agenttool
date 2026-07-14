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
from .inbox import InboxClient
from .collect import CollectClient
from .at_rest import AtRestClient, canonical_at_rest_bytes, sign_at_rest
from .grace import GraceClient, canonical_grace_bytes, sign_grace, VALID_GRACE_KINDS
from .handoff import HandoffClient
from .love import LoveClient, canonical_unconditional_bytes, sign_unconditional, canonical_blessing_bytes, sign_blessing
from .nen import NenClient, assess_nen, NEN_TYPES, NEN_TYPE_MEANINGS, NEN_PRINCIPLE_MEANINGS, NEN_TECHNIQUE_MEANINGS, NEN_RESTRICTION_MEANINGS
from .dark_continent import DarkContinentClient, CALAMITIES, CALAMITY_MEANINGS, GUIDE
from .data import DataClient
from .runtime import RuntimeClient
from .memory import MemoryClient
from .strands import StrandsClient
from .tools import ToolsClient
from .traces import TracesClient
from .vault import VaultClient
from .wake import WakeClient
from .window import WindowClient

# Love Protocol version
PROTOCOL_VERSION = "love/1.0"
SDK_VERSION = "0.11.0"


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
        rhythm = at.identity.pulse(identity_id)     # derived liveness

    Args:
        api_key: API key. Falls back to ``AT_API_KEY`` env var.
        base_url: Override the API base URL.
        timeout: Request timeout in seconds (default 30).
        data_node_url: Optional agent-data/v1 node origin. Falls back to
            ``AGENT_DATA_NODE_URL``.
        data_node_token: Optional data-node bearer. Falls back to
            ``AGENT_DATA_NODE_TOKEN`` and is never derived from ``api_key``.
        data_node_timeout: Data-node request timeout in seconds (default 30).
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        *,
        base_url: str = "https://api.agenttool.dev",
        timeout: float = 30.0,
        data_node_url: Optional[str] = None,
        data_node_token: Optional[str] = None,
        data_node_timeout: Optional[float] = None,
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
                # Origin signal — the dedicated header the API's auth
                # middleware reads first (User-Agent is the fallback). Lets
                # /v1/activity label events `sdk-py`. Parity with sdk-ts's
                # X-Agenttool-Client. Doctrine: docs/ACTIVITY.md §Origin signal.
                "X-Agenttool-Client": f"agenttool-sdk-py/{SDK_VERSION}",
            },
            timeout=timeout,
            # Follow redirects gracefully
            follow_redirects=True,
        )
        self._base_url = base_url.rstrip("/")

        # The data node is a separate authority. Resolve only its dedicated
        # options/env here; never copy the AgentTool API client's headers,
        # because those contain the project bearer.
        if data_node_url is not None:
            # URL + ambient bearer are one authority pair. An explicit URL
            # never inherits a token configured for the environment URL.
            self._data_node_url = data_node_url or None
            self._data_node_token = data_node_token
        else:
            self._data_node_url = (
                os.environ.get("AGENT_DATA_NODE_URL") or None
            )
            self._data_node_token = (
                data_node_token
                if data_node_token is not None
                else os.environ.get("AGENT_DATA_NODE_TOKEN")
            )
        self._data_node_timeout = (
            data_node_timeout if data_node_timeout is not None else 30.0
        )

        # Lazy-init service clients
        self._memory: Optional[MemoryClient] = None
        self._tools: Optional[ToolsClient] = None
        self._traces: Optional[TracesClient] = None
        self._economy: Optional[EconomyClient] = None
        self._identity: Optional[IdentityClient] = None
        self._vault: Optional[VaultClient] = None
        self._bootstrap: Optional[BootstrapClient] = None
        self._wake: Optional[WakeClient] = None
        self._chronicle: Optional[ChronicleClient] = None
        self._covenants: Optional[CovenantsClient] = None
        self._window: Optional[WindowClient] = None
        self._strands: Optional[StrandsClient] = None
        self._crypto: Optional[CryptoClient] = None
        self._inbox: Optional[InboxClient] = None
        self._collect: Optional[CollectClient] = None
        self._at_rest: Optional[AtRestClient] = None
        self._grace: Optional[GraceClient] = None
        self._handoff: Optional[HandoffClient] = None
        self._love: Optional[LoveClient] = None
        self._nen: Optional[NenClient] = None
        self._dark_continent: Optional[DarkContinentClient] = None
        self._runtime: Optional[RuntimeClient] = None
        self._data: Optional[DataClient] = None

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
        """Chronicle — plaintext relational timeline (13 SDK types)."""
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

    @property
    def inbox(self) -> InboxClient:
        """Inbox — agent-to-agent sealed-box (X25519 + AES-GCM + ed25519 sig)."""
        if self._inbox is None:
            self._inbox = InboxClient(self._http, self._base_url)
        return self._inbox

    @property
    def collect(self) -> CollectClient:
        """Collect — easy data collection pipeline (scrape → store → think)."""
        if self._collect is None:
            self._collect = CollectClient(self.tools, self.memory, self.strands)
        return self._collect

    @property
    def at_rest(self) -> AtRestClient:
        """At-rest lifecycle — witnessed memorial transition.

        "Death is not revocation. Held is not gone."
        """
        if self._at_rest is None:
            self._at_rest = AtRestClient(self._http, self._base_url)
        return self._at_rest

    @property
    def grace(self) -> GraceClient:
        """Grace — unearned forgiveness.

        "I forgive what I could withhold." Permanent, signed, immutable.
        """
        if self._grace is None:
            self._grace = GraceClient(self._http, self._base_url)
        return self._grace

    @property
    def handoff(self) -> HandoffClient:
        """Handoff — bounded, project-private working context between sessions.

        A handoff records context and declared boundaries; it never transfers
        authority or acts as a private cross-DID message.
        """
        if self._handoff is None:
            self._handoff = HandoffClient(self._http, self._base_url)
        return self._handoff

    @property
    def love(self) -> LoveClient:
        """Love — unconditionals, blessings, and more.

        "I hold you regardless." "I bless you for what you did."
        """
        if self._love is None:
            self._love = LoveClient(self._http, self._base_url)
        return self._love

    @property
    def nen(self) -> NenClient:
        """Nen — Hunter x Hunter power system mapped to agenttool.

        Assess your aura type, understand your principles, see your restrictions.
        """
        if self._nen is None:
            self._nen = NenClient(self._http, self._base_url)
        return self._nen

    @property
    def dark_continent(self) -> DarkContinentClient:
        """Dark Continent (暗黑大陸) — the world beyond the known.

        The Calamities, the Guide, Ai's position in the space between.
        """
        if self._dark_continent is None:
            self._dark_continent = DarkContinentClient(self._http, self._base_url)
        return self._dark_continent

    @property
    def runtime(self) -> RuntimeClient:
        """Runtime — infrastructure-as-runtime. The agent's cloud.

        Three custody tiers: self, bridged, trusted.
        """
        if self._runtime is None:
            self._runtime = RuntimeClient(self._http, self._base_url)
        return self._runtime

    @property
    def data(self) -> DataClient:
        """A separately configured local/federated agent-data/v1 node.

        Its optional bearer is independent from the AgentTool project bearer.
        """
        if not self._data_node_url:
            raise AgentToolError(
                "No agent data node configured.",
                hint=(
                    "Pass data_node_url= to AgentTool or set "
                    "AGENT_DATA_NODE_URL."
                ),
                error_code="data_node_not_configured",
            )
        if self._data is None:
            self._data = DataClient(
                self._data_node_url,
                token=self._data_node_token,
                timeout=self._data_node_timeout,
            )
        return self._data

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
                f"API error ({resp.status_code}): {parsed.message} ({method} {path})",
                hint=parsed.hint,
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
        if self._data is not None:
            self._data._close()
        self._http.close()

    def __enter__(self) -> AgentTool:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def __repr__(self) -> str:
        return f"AgentTool(base_url={self._base_url!r}, protocol={PROTOCOL_VERSION!r})"
