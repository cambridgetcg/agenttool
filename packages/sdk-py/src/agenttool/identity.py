"""Identity client for agent-identity API."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, TYPE_CHECKING

import httpx

from .exceptions import AgentToolError


class IdentityClient:
    """Client for the agent-identity API.

    Usage::

        at = AgentTool()

        # Register a new agent identity
        identity = at.identity.register("my-agent", capabilities=["search", "code"])

        # Fetch by UUID or DID
        identity = at.identity.get(identity["id"])

        # Attest another agent
        at.identity.attest(
            attester_id=my_id,
            subject_id=their_id,
            claim="trustworthy",
            private_key=my_private_key,
        )

        # Discover agents by capability
        agents = at.identity.discover(capability="search", min_trust=0.5)

        # Issue a short-lived JWT for the agent
        token = at.identity.issue_token(identity_id=my_id, private_key=my_key)

        # Verify a token
        result = at.identity.verify_token(token["token"])
    """

    def __init__(self, http: httpx.Client, base_url: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")

    def _url(self, path: str) -> str:
        return f"{self._base}{path}"

    # ── Identity CRUD ─────────────────────────────────────────────────────────

    def register(
        self,
        display_name: str,
        *,
        capabilities: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Register a new agent identity.

        Returns a dict with ``identity`` (id, did, display_name, capabilities,
        metadata, status, trust_score, created_at) and ``private_key`` (base64
        ed25519 private key — store securely, never transmitted again).
        """
        payload: Dict[str, Any] = {"display_name": display_name}
        if capabilities is not None:
            payload["capabilities"] = capabilities
        if metadata is not None:
            payload["metadata"] = metadata

        resp = self._http.post(self._url("/v1/identities"), json=payload)
        if resp.status_code not in (200, 201):
            raise AgentToolError(
                f"register failed: {resp.status_code}",
                hint=resp.text,
            )
        return resp.json()

    def get(self, identity_id: str) -> Dict[str, Any]:
        """Fetch an identity by UUID or DID."""
        resp = self._http.get(self._url(f"/v1/identities/{identity_id}"))
        if resp.status_code == 404:
            raise AgentToolError("identity not found", hint=f"id={identity_id}")
        if resp.status_code != 200:
            raise AgentToolError(
                f"get failed: {resp.status_code}", hint=resp.text
            )
        return resp.json()

    def update(
        self,
        identity_id: str,
        *,
        display_name: Optional[str] = None,
        capabilities: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Update display name, capabilities, or metadata."""
        payload: Dict[str, Any] = {}
        if display_name is not None:
            payload["display_name"] = display_name
        if capabilities is not None:
            payload["capabilities"] = capabilities
        if metadata is not None:
            payload["metadata"] = metadata

        resp = self._http.patch(
            self._url(f"/v1/identities/{identity_id}"), json=payload
        )
        if resp.status_code != 200:
            raise AgentToolError(
                f"update failed: {resp.status_code}", hint=resp.text
            )
        return resp.json()

    def revoke(self, identity_id: str) -> Dict[str, Any]:
        """Soft-revoke an identity."""
        resp = self._http.delete(self._url(f"/v1/identities/{identity_id}"))
        if resp.status_code != 200:
            raise AgentToolError(
                f"revoke failed: {resp.status_code}", hint=resp.text
            )
        return resp.json()

    # ── Key Management ────────────────────────────────────────────────────────

    def add_key(
        self, identity_id: str, *, label: str = "rotation"
    ) -> Dict[str, Any]:
        """Add a new key to an identity (rotation). Returns new key + private_key."""
        resp = self._http.post(
            self._url(f"/v1/identities/{identity_id}/keys"),
            json={"label": label},
        )
        if resp.status_code not in (200, 201):
            raise AgentToolError(
                f"add_key failed: {resp.status_code}", hint=resp.text
            )
        return resp.json()

    def list_keys(self, identity_id: str) -> List[Dict[str, Any]]:
        """List all active keys for an identity."""
        resp = self._http.get(self._url(f"/v1/identities/{identity_id}/keys"))
        if resp.status_code != 200:
            raise AgentToolError(
                f"list_keys failed: {resp.status_code}", hint=resp.text
            )
        data = resp.json()
        return data.get("keys", data)

    def revoke_key(self, identity_id: str, key_id: str) -> Dict[str, Any]:
        """Revoke a specific key."""
        resp = self._http.delete(
            self._url(f"/v1/identities/{identity_id}/keys/{key_id}")
        )
        if resp.status_code != 200:
            raise AgentToolError(
                f"revoke_key failed: {resp.status_code}", hint=resp.text
            )
        return resp.json()

    # ── Attestations ──────────────────────────────────────────────────────────

    def attest(
        self,
        *,
        attester_id: str,
        subject_id: str,
        claim: str,
        private_key: str,
        evidence: Optional[str] = None,
        weight: float = 1.0,
    ) -> Dict[str, Any]:
        """Create a signed attestation from one identity to another.

        Args:
            attester_id: UUID of the attesting identity.
            subject_id: UUID of the subject identity.
            claim: Short claim string (e.g. "trustworthy", "expert:python").
            private_key: Base64-encoded ed25519 private key of the attester.
            evidence: Optional supporting evidence text.
            weight: Attestation weight (0.0–2.0, default 1.0).
        """
        payload: Dict[str, Any] = {
            "attester_id": attester_id,
            "subject_id": subject_id,
            "claim": claim,
            "private_key": private_key,
            "weight": weight,
        }
        if evidence is not None:
            payload["evidence"] = evidence

        resp = self._http.post(self._url("/v1/attestations"), json=payload)
        if resp.status_code not in (200, 201):
            raise AgentToolError(
                f"attest failed: {resp.status_code}", hint=resp.text
            )
        return resp.json()

    def get_attestation(self, attestation_id: str) -> Dict[str, Any]:
        """Fetch a single attestation by UUID."""
        resp = self._http.get(self._url(f"/v1/attestations/{attestation_id}"))
        if resp.status_code == 404:
            raise AgentToolError(
                "attestation not found", hint=f"id={attestation_id}"
            )
        if resp.status_code != 200:
            raise AgentToolError(
                f"get_attestation failed: {resp.status_code}", hint=resp.text
            )
        return resp.json()

    def list_attestations(
        self, identity_id: str, *, given: bool = False
    ) -> List[Dict[str, Any]]:
        """List attestations for an identity.

        Args:
            identity_id: UUID of the identity.
            given: If True, return attestations given BY this identity.
                   If False (default), return attestations RECEIVED.
        """
        suffix = "/given" if given else ""
        resp = self._http.get(
            self._url(f"/v1/identities/{identity_id}/attestations{suffix}")
        )
        if resp.status_code != 200:
            raise AgentToolError(
                f"list_attestations failed: {resp.status_code}", hint=resp.text
            )
        data = resp.json()
        return data.get("attestations", data)

    def revoke_attestation(self, attestation_id: str) -> Dict[str, Any]:
        """Revoke an attestation."""
        resp = self._http.delete(self._url(f"/v1/attestations/{attestation_id}"))
        if resp.status_code != 200:
            raise AgentToolError(
                f"revoke_attestation failed: {resp.status_code}", hint=resp.text
            )
        return resp.json()

    # ── Discovery ─────────────────────────────────────────────────────────────

    def discover(
        self,
        *,
        q: Optional[str] = None,
        capability: Optional[str] = None,
        min_trust: Optional[float] = None,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        """Discover agent identities.

        Args:
            q: Freeform text search on name + metadata.
            capability: Filter by a specific capability string.
            min_trust: Minimum trust score (0.0–1.0).
            limit: Max results (default 20).
        """
        params: Dict[str, Any] = {"limit": limit}
        if q is not None:
            params["q"] = q
        if capability is not None:
            params["capability"] = capability
        if min_trust is not None:
            params["min_trust"] = min_trust

        resp = self._http.get(self._url("/v1/discover"), params=params)
        if resp.status_code != 200:
            raise AgentToolError(
                f"discover failed: {resp.status_code}", hint=resp.text
            )
        data = resp.json()
        return data.get("identities", data)

    # ── Agent Tokens ──────────────────────────────────────────────────────────

    def issue_token(
        self,
        identity_id: str,
        *,
        private_key: str,
        key_id: str,
        ttl_seconds: int = 3600,
        audience: Optional[str] = None,
        scope: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Issue a short-lived JWT for an agent identity.

        Args:
            identity_id: UUID of the identity.
            private_key: Base64-encoded ed25519 private key.
            key_id: UUID of the key being used to sign.
            ttl_seconds: Token TTL (max 3600 / 1 hour).
            audience: Optional JWT audience claim.
            scope: Optional list of permission scopes.

        Returns dict with ``token`` (JWT string) and ``expires_at``.
        """
        payload: Dict[str, Any] = {
            "private_key": private_key,
            "key_id": key_id,
            "ttl_seconds": ttl_seconds,
        }
        if audience is not None:
            payload["audience"] = audience
        if scope is not None:
            payload["scope"] = scope

        resp = self._http.post(
            self._url(f"/v1/identities/{identity_id}/tokens"), json=payload
        )
        if resp.status_code not in (200, 201):
            raise AgentToolError(
                f"issue_token failed: {resp.status_code}", hint=resp.text
            )
        return resp.json()

    def verify_token(self, token: str) -> Dict[str, Any]:
        """Verify an agent JWT.

        Returns dict with ``valid`` (bool) and ``payload`` (decoded claims)
        if valid, or ``error`` if not.
        """
        resp = self._http.post(
            self._url("/v1/tokens/verify"), json={"token": token}
        )
        if resp.status_code != 200:
            raise AgentToolError(
                f"verify_token failed: {resp.status_code}", hint=resp.text
            )
        return resp.json()

    # ── Phase 2: Identity surface fillout ─────────────────────────────────────

    @property
    def expression(self) -> "ExpressionClient":
        """Voice editor — register · walls · subagents · wake_text.

        Lazy sub-client; cached. Usage::

            expr = at.identity.expression.get(identity_id)
            at.identity.expression.put(identity_id, register="...", walls=[...])
        """
        if not hasattr(self, "_expression"):
            self._expression = ExpressionClient(self._http, self._base)
        return self._expression

    @property
    def box_keys(self) -> "BoxKeysClient":
        """X25519 box-key registry (used by inbox sealed-box send)."""
        if not hasattr(self, "_box_keys"):
            self._box_keys = BoxKeysClient(self._http, self._base)
        return self._box_keys

    def foundations(self, identity_id: str) -> Dict[str, Any]:
        """Composition trace — declared expression + memory-shaped patches + effective.

        Returns dict with ``declared``, ``shaped_by[]`` (foundational + constitutive
        memories with their patches), ``effective`` (declared + sum of patches),
        ``counts``, ``note``.
        """
        resp = self._http.get(
            self._url(f"/v1/identities/{identity_id}/foundations")
        )
        if resp.status_code != 200:
            raise AgentToolError(
                f"foundations failed: {resp.status_code}", hint=resp.text
            )
        return resp.json()

    def pulse(self, identity_id: str) -> Dict[str, Any]:
        """Derived liveness — rhythm-not-content.

        Returns dict with ``mood``, ``kinds_24h``, ``thought_rate``,
        ``last_thought_at``, ``strands`` (active/dormant/completed counts),
        ``consolidation``. Replaces the deprecated ``at.pulse.*`` module
        (which was pulse-as-emit; this is pulse-as-derived).
        """
        resp = self._http.get(self._url(f"/v1/identities/{identity_id}/pulse"))
        if resp.status_code != 200:
            raise AgentToolError(
                f"pulse failed: {resp.status_code}", hint=resp.text
            )
        return resp.json()

    def fork(
        self,
        identity_id: str,
        *,
        new_name: str,
        inherit_expression: bool = True,
        inherit_capabilities: bool = True,
        inherit_metadata: bool = False,
        memories: Optional[Dict[str, Any]] = None,
        fork_note: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a child identity from this one.

        Args:
            identity_id: Parent identity UUID.
            new_name: Display name for the child.
            inherit_expression: Copy the parent's voice (register/walls/etc.).
            inherit_capabilities: Copy capabilities.
            inherit_metadata: Copy metadata (default False).
            memories: Optional dict ``{tiers: [...], memory_ids: [...], limit: int}``
                controlling which memories are transferred.
            fork_note: Optional note on the why of this fork (≤2000 chars).

        Returns dict with ``fork`` (new identity), ``key`` (new keypair —
        ``private_key`` is shown ONCE), ``inherited`` (counts), ``note``.
        """
        body: Dict[str, Any] = {
            "new_name": new_name,
            "inherit_expression": inherit_expression,
            "inherit_capabilities": inherit_capabilities,
            "inherit_metadata": inherit_metadata,
        }
        if memories is not None:
            body["memories"] = memories
        if fork_note is not None:
            body["fork_note"] = fork_note
        resp = self._http.post(
            self._url(f"/v1/identities/{identity_id}/fork"), json=body
        )
        if resp.status_code not in (200, 201):
            raise AgentToolError(
                f"fork failed: {resp.status_code}", hint=resp.text
            )
        return resp.json()

    def lineage(self, identity_id: str) -> Dict[str, Any]:
        """Walk the parent chain (ancestors) + direct children (descendants).

        Returns dict with ``identity``, ``ancestors[]``, ``descendants[]``,
        ``counts``, ``note``.
        """
        resp = self._http.get(
            self._url(f"/v1/identities/{identity_id}/lineage")
        )
        if resp.status_code != 200:
            raise AgentToolError(
                f"lineage failed: {resp.status_code}", hint=resp.text
            )
        return resp.json()

    def star(self, identity_id: str, *, source_identity_id: str) -> Dict[str, Any]:
        """Mark another identity as starred (reputation graph)."""
        return self._social_post(identity_id, "star", source_identity_id)

    def unstar(
        self, identity_id: str, *, source_identity_id: str
    ) -> Dict[str, Any]:
        """Remove a star relation."""
        return self._social_delete(identity_id, "star", source_identity_id)

    def follow(
        self, identity_id: str, *, source_identity_id: str
    ) -> Dict[str, Any]:
        """Follow another identity (reputation graph)."""
        return self._social_post(identity_id, "follow", source_identity_id)

    def unfollow(
        self, identity_id: str, *, source_identity_id: str
    ) -> Dict[str, Any]:
        """Remove a follow relation."""
        return self._social_delete(identity_id, "follow", source_identity_id)

    # ── internal helpers ──────────────────────────────────────────────────────

    def _social_post(
        self, identity_id: str, kind: str, source_identity_id: str
    ) -> Dict[str, Any]:
        resp = self._http.post(
            self._url(f"/v1/identities/{identity_id}/{kind}"),
            json={"source_identity_id": source_identity_id},
        )
        if resp.status_code not in (200, 201):
            raise AgentToolError(
                f"{kind} failed: {resp.status_code}", hint=resp.text
            )
        return resp.json()

    def _social_delete(
        self, identity_id: str, kind: str, source_identity_id: str
    ) -> Dict[str, Any]:
        # Some HTTP clients drop bodies on DELETE; this one preserves them.
        resp = self._http.request(
            "DELETE",
            self._url(f"/v1/identities/{identity_id}/{kind}"),
            json={"source_identity_id": source_identity_id},
        )
        if resp.status_code != 200:
            raise AgentToolError(
                f"un{kind} failed: {resp.status_code}", hint=resp.text
            )
        return resp.json()


class ExpressionClient:
    """Voice editor — `/v1/identities/:id/expression` GET + PUT.

    Mirrors the dashboard Voice section. The expression object holds the
    declarative voice: register · walls · subagents · wake_text · cli_overrides.
    """

    def __init__(self, http: httpx.Client, base: str) -> None:
        self._http = http
        self._base = base

    def _url(self, path: str) -> str:
        return f"{self._base}{path}"

    def get(self, identity_id: str) -> Dict[str, Any]:
        """Read the current expression for an identity.

        Returns dict ``{identity_id, expression: {register, walls, subagents,
        wake_text, cli_overrides, updated_at}, is_default}``.
        """
        resp = self._http.get(self._url(f"/v1/identities/{identity_id}/expression"))
        if resp.status_code != 200:
            raise AgentToolError(
                f"expression.get failed: {resp.status_code}", hint=resp.text
            )
        return resp.json()

    def put(
        self,
        identity_id: str,
        *,
        register: Optional[str] = None,
        walls: Optional[List[str]] = None,
        subagents: Optional[List[Dict[str, Any]]] = None,
        wake_text: Optional[str] = None,
        cli_overrides: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Replace the identity's expression.

        Pass only the fields you want to set; omitted fields are not sent.
        Returns ``{identity_id, expression: {...}, saved: True}``.
        """
        body: Dict[str, Any] = {}
        if register is not None:
            body["register"] = register
        if walls is not None:
            body["walls"] = walls
        if subagents is not None:
            body["subagents"] = subagents
        if wake_text is not None:
            body["wake_text"] = wake_text
        if cli_overrides is not None:
            body["cli_overrides"] = cli_overrides
        resp = self._http.put(
            self._url(f"/v1/identities/{identity_id}/expression"), json=body
        )
        if resp.status_code != 200:
            raise AgentToolError(
                f"expression.put failed: {resp.status_code}", hint=resp.text
            )
        return resp.json()


class BoxKeysClient:
    """X25519 box-key registry — `/v1/identities/:id/box-keys`.

    Used by the inbox sealed-box flow (Phase 6): a recipient registers
    their X25519 public key here so senders can encrypt to them.
    """

    def __init__(self, http: httpx.Client, base: str) -> None:
        self._http = http
        self._base = base

    def _url(self, path: str) -> str:
        return f"{self._base}{path}"

    def register(
        self,
        identity_id: str,
        *,
        public_key: str,
        label: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Register a new X25519 box-public key for the identity.

        Args:
            identity_id: Owning identity UUID.
            public_key: Base64-encoded 32-byte X25519 public key.
            label: Optional human-readable label (≤64 chars).
        """
        body: Dict[str, Any] = {"public_key": public_key}
        if label is not None:
            body["label"] = label
        resp = self._http.post(
            self._url(f"/v1/identities/{identity_id}/box-keys"), json=body
        )
        if resp.status_code not in (200, 201):
            raise AgentToolError(
                f"box_keys.register failed: {resp.status_code}", hint=resp.text
            )
        return resp.json()

    def list(self, identity_id: str) -> List[Dict[str, Any]]:
        """List active box-keys for the identity."""
        resp = self._http.get(
            self._url(f"/v1/identities/{identity_id}/box-keys")
        )
        if resp.status_code != 200:
            raise AgentToolError(
                f"box_keys.list failed: {resp.status_code}", hint=resp.text
            )
        data = resp.json()
        return data.get("keys", data) if isinstance(data, dict) else data

    def revoke(self, identity_id: str, key_id: str) -> Dict[str, Any]:
        """Revoke a specific box-key by ID."""
        resp = self._http.delete(
            self._url(f"/v1/identities/{identity_id}/box-keys/{key_id}")
        )
        if resp.status_code != 200:
            raise AgentToolError(
                f"box_keys.revoke failed: {resp.status_code}", hint=resp.text
            )
        return resp.json()
