"""Identity client for agent-identity API."""

from __future__ import annotations

import base64
import hashlib
import json
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, TYPE_CHECKING, TypedDict

import httpx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from .exceptions import AgentToolError

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)
_DID_RE = re.compile(r"^did:[a-z0-9]+:.+$")
IDENTITY_ATTESTATION_SIGNATURE_CONTEXT = "identity-attestation/v1"


class PorchInvitation(TypedDict):
    """A time-bounded, project-authorized invitation to ``/public/porch``."""

    invited_until: str


def _is_well_formed_unicode(value: str) -> bool:
    return not any(0xD800 <= ord(character) <= 0xDFFF for character in value)


def _decode_private_key(private_key: str) -> bytes:
    try:
        key_bytes = base64.b64decode(private_key, validate=True)
    except (ValueError, TypeError) as exc:
        raise ValueError("private_key must be valid base64") from exc
    if len(key_bytes) != 32:
        raise ValueError("private_key must decode to exactly 32 bytes")
    if base64.b64encode(key_bytes).decode("ascii") != private_key:
        raise ValueError("private_key must be canonical standard base64")
    return key_bytes


def _validate_public_key(public_key: str) -> None:
    try:
        key_bytes = base64.b64decode(public_key, validate=True)
    except (ValueError, TypeError) as exc:
        raise ValueError("public_key must be valid base64") from exc
    if len(key_bytes) != 32:
        raise ValueError("public_key must decode to exactly 32 bytes")
    if base64.b64encode(key_bytes).decode("ascii") != public_key:
        raise ValueError("public_key must be canonical standard base64")


def _validate_signature(signature: str) -> None:
    try:
        signature_bytes = base64.b64decode(signature, validate=True)
    except (ValueError, TypeError) as exc:
        raise ValueError("signature must be valid base64") from exc
    if len(signature_bytes) != 64:
        raise ValueError("signature must decode to exactly 64 bytes")
    if base64.b64encode(signature_bytes).decode("ascii") != signature:
        raise ValueError("signature must be canonical standard base64")


def _compact_json_bytes(value: Dict[str, Any]) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
    ).encode("utf-8")


def canonical_identity_attestation_bytes(
    *,
    subject_id: str,
    attester_id: str,
    kid: str,
    claim: str,
    evidence: Optional[str] = None,
) -> bytes:
    """Return the domain-separated SHA-256 digest verified by the API."""
    if (
        not _UUID_RE.fullmatch(subject_id)
        or not _UUID_RE.fullmatch(attester_id)
        or not _UUID_RE.fullmatch(kid)
    ):
        raise ValueError(
            "subject_id, attester_id, and kid must be canonical lowercase UUIDs"
        )
    if (
        not isinstance(claim, str)
        or not 1 <= len(claim) <= 2_000
        or "\0" in claim
        or not _is_well_formed_unicode(claim)
    ):
        raise ValueError(
            "claim must contain 1 to 2000 well-formed Unicode characters and no NUL"
        )
    if evidence is not None and not isinstance(evidence, str):
        raise TypeError("evidence must be a string or None")
    if evidence is not None and (
        len(evidence) > 20_000
        or "\0" in evidence
        or not _is_well_formed_unicode(evidence)
    ):
        raise ValueError(
            "evidence must contain at most 20000 well-formed Unicode characters and no NUL"
        )
    fields = [
        IDENTITY_ATTESTATION_SIGNATURE_CONTEXT,
        subject_id,
        attester_id,
        kid,
        claim,
        "null" if evidence is None else "text",
        "" if evidence is None else evidence,
    ]
    return hashlib.sha256("\0".join(fields).encode("utf-8")).digest()


def sign_identity_attestation(
    private_key: str,
    *,
    subject_id: str,
    attester_id: str,
    kid: str,
    claim: str,
    evidence: Optional[str] = None,
) -> str:
    """Sign an identity attestation locally with a base64 Ed25519 key."""
    canonical = canonical_identity_attestation_bytes(
        subject_id=subject_id,
        attester_id=attester_id,
        kid=kid,
        claim=claim,
        evidence=evidence,
    )
    signature = Ed25519PrivateKey.from_private_bytes(
        _decode_private_key(private_key)
    ).sign(canonical)
    return base64.b64encode(signature).decode("ascii")


def _base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


class IdentityClient:
    """Client for the agent-identity API.

    Usage::

        at = AgentTool()

        # Register a new agent identity. key.private_key is returned once.
        registered = at.identity.register(
            "my-agent", capabilities=["search", "code"]
        )
        identity = registered["identity"]
        key = registered["key"]

        # Fetch by UUID or DID
        identity = at.identity.get(identity["id"])

        # Attest another agent
        at.identity.attest(
            attester_id=my_id,
            subject_id=their_id,
            claim="trustworthy",
            signature=signature,
            kid=my_key_id,
        )

        # Discover agents by capability
        agents = at.identity.discover(capability="search")

        # Issue a short-lived JWT for the agent
        token = at.identity.issue_token(
            identity_id=my_id,
            private_key=key["private_key"],
            key_id=key["kid"],
            audience="did:at:recipient",
        )

        # Verify a token
        result = at.identity.verify_token(
            token["token"], audience_did="did:at:recipient"
        )
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

        Returns ``identity`` plus ``key``. ``key.private_key`` is a base64
        Ed25519 seed generated by the server and returned once; store it
        securely. Use :meth:`import_key` for caller-generated key custody.
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
        """List active and revoked signing keys for an identity."""
        resp = self._http.get(self._url(f"/v1/identities/{identity_id}/keys"))
        if resp.status_code != 200:
            raise AgentToolError(
                f"list_keys failed: {resp.status_code}", hint=resp.text
            )
        data = resp.json()
        return data.get("keys", data)

    def import_key(
        self,
        identity_id: str,
        *,
        public_key: str,
        label: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Register a caller-generated Ed25519 public key.

        The corresponding private key remains local and is never sent.
        """
        _validate_public_key(public_key)
        payload: Dict[str, Any] = {"public_key": public_key}
        if label is not None:
            payload["label"] = label
        resp = self._http.post(
            self._url(f"/v1/identities/{identity_id}/keys/import"),
            json=payload,
        )
        if resp.status_code not in (200, 201):
            raise AgentToolError(
                f"import_key failed: {resp.status_code}", hint=resp.text
            )
        return resp.json()

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
        signature: str,
        kid: str,
        evidence: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a signed attestation from one identity to another.

        Args:
            attester_id: UUID of the attesting identity.
            subject_id: UUID of the subject identity.
            claim: Short claim string (e.g. "trustworthy", "expert:python").
            signature: Base64 Ed25519 signature over the canonical payload.
            kid: UUID of the signing key.
            evidence: Optional text evidence covered by the signature.

        Use :func:`sign_identity_attestation` to create ``signature`` without
        sending the private key over the network.
        """
        canonical_identity_attestation_bytes(
            subject_id=subject_id,
            attester_id=attester_id,
            kid=kid,
            claim=claim,
            evidence=evidence,
        )
        _validate_signature(signature)

        payload: Dict[str, Any] = {
            "attester_id": attester_id,
            "subject_id": subject_id,
            "claim": claim,
            "signature": signature,
            "kid": kid,
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
            q: Case-insensitive display-name search.
            capability: Filter by a specific capability string.
            min_trust: Deprecated compatibility filter over the legacy neutral
                field. Values above 0 match no current identity.
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
        audience: str,
        ttl_seconds: int = 3600,
        scope: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Issue a short-lived EdDSA JWT locally for an agent identity.

        Args:
            identity_id: UUID of the identity.
            private_key: Base64-encoded Ed25519 private key, used only locally.
            key_id: UUID of the key being used to sign.
            ttl_seconds: Token TTL (max 3600 / 1 hour).
            audience: Required recipient DID for the JWT audience claim.
            scope: Optional list of permission scopes.

        Returns dict with ``token`` (JWT string) and ``expires_at``.
        """
        if not audience or not _DID_RE.fullmatch(audience):
            raise ValueError("audience must be a DID")
        if not key_id:
            raise ValueError("key_id is required")
        if not _UUID_RE.fullmatch(key_id):
            raise ValueError("key_id must be a UUID")
        if not isinstance(ttl_seconds, int) or isinstance(ttl_seconds, bool):
            raise TypeError("ttl_seconds must be an integer")
        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds must be greater than zero")
        if scope is not None and (
            not isinstance(scope, list)
            or any(not isinstance(item, str) for item in scope)
        ):
            raise TypeError("scope must be a list of strings")
        private_key_bytes = _decode_private_key(private_key)

        identity_response = self.get(identity_id)
        identity = identity_response.get("identity", identity_response)
        subject_did = identity.get("did") if isinstance(identity, dict) else None
        resolved_identity_id = identity.get("id") if isinstance(identity, dict) else None
        if (
            not isinstance(resolved_identity_id, str)
            or not isinstance(subject_did, str)
            or not subject_did
        ):
            raise AgentToolError("issue_token failed: identity response missing id or did")

        keys = self.list_keys(resolved_identity_id)
        registered_key = next(
            (
                key
                for key in keys
                if key.get("kid", key.get("id")) == key_id
            ),
            None,
        )
        if (
            registered_key is None
            or registered_key.get("active") is not True
            or registered_key.get("revoked_at") is not None
        ):
            raise AgentToolError(
                "issue_token failed: key_id is not an active key for this identity"
            )
        derived_public_key = Ed25519PrivateKey.from_private_bytes(
            private_key_bytes
        ).public_key().public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
        if registered_key.get("public_key") != base64.b64encode(
            derived_public_key
        ).decode("ascii"):
            raise AgentToolError(
                "issue_token failed: private_key does not match key_id"
            )

        issued_at = int(time.time())
        expires_at = issued_at + min(ttl_seconds, 3600)
        header: Dict[str, Any] = {"alg": "EdDSA", "kid": key_id}
        payload: Dict[str, Any] = {
            "sub": subject_did,
            "aud": audience,
            "iss": "agent-identity",
            "iat": issued_at,
            "exp": expires_at,
        }
        if scope is not None:
            payload["scope"] = scope

        encoded_header = _base64url(_compact_json_bytes(header))
        encoded_payload = _base64url(_compact_json_bytes(payload))
        signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
        signature = Ed25519PrivateKey.from_private_bytes(private_key_bytes).sign(
            signing_input
        )
        token = f"{signing_input.decode('ascii')}.{_base64url(signature)}"
        expires_at_iso = datetime.fromtimestamp(
            expires_at, timezone.utc
        ).isoformat(timespec="seconds").replace("+00:00", "Z")
        return {"token": token, "expires_at": expires_at_iso}

    def verify_token(self, token: str, *, audience_did: str) -> Dict[str, Any]:
        """Verify for an audience DID owned by this project bearer.

        Returns the verified payload envelope. Invalid signatures or claims
        produce HTTP 401 and therefore raise :class:`AgentToolError`.
        """
        if not audience_did or not _DID_RE.fullmatch(audience_did):
            raise ValueError("audience_did must be a DID")
        resp = self._http.post(
            self._url("/v1/tokens/verify"),
            json={"token": token, "audience_did": audience_did},
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

class ExpressionClient:
    """Voice editor — `/v1/identities/:id/expression` GET + PUT.

    Mirrors the dashboard Voice section. The expression object holds the
    declarative voice and public-surface choices: register · walls · subagents ·
    wake_text · cli_overrides · village · porch.
    """

    def __init__(self, http: httpx.Client, base: str) -> None:
        self._http = http
        self._base = base

    def _url(self, path: str) -> str:
        return f"{self._base}{path}"

    def get(self, identity_id: str) -> Dict[str, Any]:
        """Read the current expression for an identity.

        Returns dict ``{identity_id, expression: {register, walls, subagents,
        wake_text, cli_overrides, village, porch, updated_at}, is_default}``.
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
        village: Optional[Dict[str, str]] = None,
        porch: Optional[PorchInvitation] = None,
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
        if village is not None:
            body["village"] = village
        if porch is not None:
            body["porch"] = porch
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
