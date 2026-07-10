"""Bootstrap client for the agent-bootstrap API.

One call creates the project's initial agent records: identity (DID and key),
wallet, memory namespace, and a best-effort welcome memory. It does not create
every resource the agent may later use.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional

import httpx

from .exceptions import AgentToolError


class BootstrapClient:
    """Client for the agent-bootstrap API.

    Usage::

        at = AgentTool()

        # Level 0: bring an agent into existence
        agent = at.bootstrap.create(
            name="my-researcher",
            capabilities=["memory", "verify", "search"],
            purpose="Find patterns in academic literature and surface insights",
        )

        print(agent["agent"]["did"])          # did:at:...
        print(agent["keypair"]["private_key"]) # keep this safe
        print(agent["wallet"]["id"])           # wallet tied to identity
        print(agent["memory"]["namespace"])    # agent/...

        # With birth ritual (optional first thought)
        agent = at.bootstrap.create(
            name="my-researcher",
            capabilities=["memory", "verify"],
            purpose="Surface patterns in academic literature",
            generate_greeting=True,
        )
        print(agent.get("greeting"))  # agent's self-introduction

        # Level 1: elevate to sovereignty (requires sponsor)
        elevated = at.bootstrap.elevate(
            agent_id=agent["agent"]["id"],
            sponsor_did=sponsor_identity["did"],
            sponsor_signature=sponsor_private_key,
            initial_credits=100,
        )

        # Check bootstrap status
        status = at.bootstrap.status(agent["agent"]["id"])
    """

    def __init__(self, http: httpx.Client, base_url: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")

    def _url(self, path: str) -> str:
        return f"{self._base}{path}"

    # ── Level 0: Birth ────────────────────────────────────────────────────────

    def create(
        self,
        name: str,
        *,
        capabilities: Optional[List[str]] = None,
        purpose: Optional[str] = None,
        generate_greeting: bool = False,
        metadata: Optional[Dict[str, Any]] = None,
        on_birth: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> Dict[str, Any]:
        """Bootstrap a new agent at Level 0.

        Creates an identity (DID + ed25519 keypair), a wallet, and a memory
        namespace in a single call. Costs 5 credits.

        Args:
            name: Display name for the agent.
            capabilities: List of capability strings (e.g. ``["search", "verify"]``).
            purpose: Optional one-sentence purpose statement. Used to generate
                     a contextual greeting when ``generate_greeting=True``.
            generate_greeting: If True, generate the agent's first self-introduction.
                               Requires model access (costs 1 additional credit).
            metadata: Arbitrary metadata to attach to the identity.
            on_birth: Optional callback fired after successful bootstrap.
                      Receives the full bootstrap response dict. Use this
                      as the "birth ritual" moment::

                          def announce(agent):
                              print(f"\\n🌱 {agent['agent']['name']} is alive.")
                              print(f"   DID: {agent['agent']['did']}")
                              if agent.get('greeting'):
                                  print(f"   \"{agent['greeting']}\"")

                          at.bootstrap.create("my-agent", on_birth=announce)

        Returns:
            Dict with keys: ``agent`` (id, did, name, level, capabilities),
            ``keypair`` (public_key, private_key — store private_key securely),
            ``wallet`` (id, balance), ``memory`` (namespace, agent_id),
            ``vault`` (None at L0), ``sponsor`` (None at L0),
            ``greeting`` (str or None), ``_meta`` (cost, created_at).
        """
        payload: Dict[str, Any] = {"name": name}
        if capabilities is not None:
            payload["capabilities"] = capabilities
        if purpose is not None:
            payload["purpose"] = purpose
        if generate_greeting:
            payload["generate_greeting"] = True
        if metadata is not None:
            payload["metadata"] = metadata

        resp = self._http.post(self._url("/v1/bootstrap"), json=payload)
        if resp.status_code not in (200, 201):
            raise AgentToolError(
                f"bootstrap.create failed: {resp.status_code}",
                hint=resp.text,
            )

        result = resp.json()

        # Fire birth callback if provided
        if on_birth is not None:
            try:
                on_birth(result)
            except Exception:
                pass  # callbacks must never break bootstrap

        return result

    # ── Level 1: Elevation ────────────────────────────────────────────────────

    def elevate(
        self,
        agent_id: str,
        *,
        sponsor_did: str,
        sponsor_signature: str,
        initial_credits: int = 1000,
    ) -> Dict[str, Any]:
        """Elevate an agent to Level 1 (sponsorship-staked sovereignty).

        Orchestrates four operations in one transaction: sponsor attestation
        insert · agent wallet fund · vault namespace open · identity metadata
        patch (level=1, sponsor_did, elevated_at). Rollback on any failure —
        no half-elevated state.

        Args:
            agent_id: UUID of the Level-0 agent to elevate.
            sponsor_did: DID of the sponsoring identity (e.g. ``"did:at:..."``).
                The sponsor must belong to the same project as the agent.
            sponsor_signature: Base64-encoded ed25519 signature over the
                canonical attestation payload
                ``canonicalPayload({subject_id: agent_id, attester_id: sponsor_id,
                claim: "sponsorship", evidence: null})``. Compute this client-side
                using the sponsor's ed25519 private key — the SDK never sees
                the private key. See docs/CANONICAL-BYTES.md for byte format.
            initial_credits: Credits seeded into the agent's wallet on
                elevation. Default 1000. Must be in [0, 1_000_000].

        Returns:
            Dict with: ``agent`` (id, did, name, level=1, trust_score,
            elevated_at, sponsor_did, sponsor_identity_id), ``attestation``
            (id, claim, created_at), ``wallet`` (id, balance, currency),
            ``vault`` (namespace, secret_id, opened_at), ``elevation``
            (steps_applied=4), ``next_steps``, ``_meta``.

        Raises:
            AgentToolError: On any non-2xx response. The error message
                carries the structured ``error`` code (e.g.
                ``agent_not_level_0``, ``signature_invalid``, ``sponsor_not_found``).
        """
        payload: Dict[str, Any] = {
            "agent_id": agent_id,
            "sponsor_did": sponsor_did,
            "sponsor_signature": sponsor_signature,
            "initial_credits": initial_credits,
        }

        resp = self._http.post(self._url("/v1/bootstrap/elevate"), json=payload)
        if resp.status_code not in (200, 201):
            raise AgentToolError(
                f"bootstrap.elevate failed: {resp.status_code}",
                hint=resp.text,
            )
        return resp.json()

    # ── Status ────────────────────────────────────────────────────────────────

    def status(self, agent_id: str) -> Dict[str, Any]:
        """Check the bootstrap status of an agent.

        Args:
            agent_id: UUID of the agent.

        Returns:
            Dict with: ``agent`` (id, did, name, level, capabilities, trust_score,
            status), ``sponsor_did``, ``elevated_at``, ``bootstrapped`` (bool).
        """
        resp = self._http.get(self._url(f"/v1/bootstrap/{agent_id}"))
        if resp.status_code == 404:
            raise AgentToolError("agent not found", hint=f"id={agent_id}")
        if resp.status_code != 200:
            raise AgentToolError(
                f"bootstrap.status failed: {resp.status_code}", hint=resp.text
            )
        return resp.json()
