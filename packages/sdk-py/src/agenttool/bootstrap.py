"""Bootstrap client for the agent-bootstrap API.

One call creates the project's initial agent records: identity (DID and key),
wallet, memory namespace, and a best-effort welcome memory. It does not create
every resource the agent may later use.
"""

from __future__ import annotations

import base64
import hashlib
import re
from typing import Any, Callable, Dict, List, Optional, Union

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from .exceptions import AgentToolError


BOOTSTRAP_ELEVATE_SIGNATURE_CONTEXT = "bootstrap-elevate/v1"
DEFAULT_BOOTSTRAP_ELEVATE_INITIAL_CREDITS = 1000
DEFAULT_BOOTSTRAP_ELEVATE_CLAIM = "sponsorship"

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _canonical_uuid(value: str, field: str) -> str:
    if not isinstance(value, str) or _UUID_RE.fullmatch(value) is None:
        raise ValueError(f"{field} must be a UUID")
    return value.lower()


def _canonical_text(
    value: object,
    field: str,
    minimum: int,
    maximum: int,
) -> str:
    if not isinstance(value, str):
        raise TypeError(f"{field} must be text")
    if (
        "\x00" in value
        or any(0xD800 <= ord(character) <= 0xDFFF for character in value)
        or not minimum <= len(value) <= maximum
    ):
        raise ValueError(
            f"{field} must contain {minimum}-{maximum} Unicode scalar values "
            "and no NUL"
        )
    return value


def _decode_private_key(private_key: Union[str, bytes, bytearray]) -> bytes:
    if isinstance(private_key, str):
        try:
            key_bytes = base64.b64decode(private_key, validate=True)
        except (ValueError, TypeError) as exc:
            raise ValueError("private_key must be valid base64") from exc
        if base64.b64encode(key_bytes).decode("ascii") != private_key:
            raise ValueError("private_key must be canonical standard base64")
    elif isinstance(private_key, (bytes, bytearray)):
        key_bytes = bytes(private_key)
    else:
        raise TypeError("private_key must be base64 text or bytes")
    if len(key_bytes) != 32:
        raise ValueError("private_key must decode to exactly 32 bytes")
    return key_bytes


def _validate_signature(signature: str) -> None:
    if not isinstance(signature, str):
        raise TypeError("sponsor_signature must be base64 text")
    try:
        signature_bytes = base64.b64decode(signature, validate=True)
    except (ValueError, TypeError) as exc:
        raise ValueError("sponsor_signature must be valid base64") from exc
    if len(signature_bytes) != 64:
        raise ValueError("sponsor_signature must decode to exactly 64 bytes")
    if base64.b64encode(signature_bytes).decode("ascii") != signature:
        raise ValueError("sponsor_signature must be canonical standard base64")


def canonical_bootstrap_elevate_bytes(
    *,
    agent_id: str,
    sponsor_did: str,
    sponsor_kid: str,
    initial_credits: int = DEFAULT_BOOTSTRAP_ELEVATE_INITIAL_CREDITS,
    claim: str = DEFAULT_BOOTSTRAP_ELEVATE_CLAIM,
    evidence: Optional[str] = None,
) -> bytes:
    """Return the exact 32-byte digest verified by bootstrap elevation.

    Shape::

        sha256(
          "bootstrap-elevate/v1" || NUL || lowercase(agent_id) || NUL ||
          sponsor_did || NUL || lowercase(sponsor_kid) || NUL ||
          base10(initial_credits) || NUL || claim || NUL ||
          ("null" or "text") || NUL || (evidence or "")
        )

    ``evidence`` is text or ``None``. The explicit kind field keeps ``None``
    distinct from empty text. NUL is reserved as the field separator.
    """
    canonical_agent_id = _canonical_uuid(agent_id, "agent_id")
    canonical_sponsor_kid = _canonical_uuid(sponsor_kid, "sponsor_kid")
    sponsor_did = _canonical_text(sponsor_did, "sponsor_did", 1, 255)
    claim = _canonical_text(claim, "claim", 1, 64)
    if evidence is not None:
        evidence = _canonical_text(evidence, "evidence", 0, 20_000)
    if (
        isinstance(initial_credits, bool)
        or not isinstance(initial_credits, int)
        or not 0 <= initial_credits <= 1_000_000
    ):
        raise ValueError("initial_credits must be an integer in [0, 1000000]")

    fields = (
        BOOTSTRAP_ELEVATE_SIGNATURE_CONTEXT,
        canonical_agent_id,
        sponsor_did,
        canonical_sponsor_kid,
        str(initial_credits),
        claim,
        "null" if evidence is None else "text",
        evidence or "",
    )
    return hashlib.sha256("\x00".join(fields).encode("utf-8")).digest()


def sign_bootstrap_elevate(
    private_key: Union[str, bytes, bytearray],
    *,
    agent_id: str,
    sponsor_did: str,
    sponsor_kid: str,
    initial_credits: int = DEFAULT_BOOTSTRAP_ELEVATE_INITIAL_CREDITS,
    claim: str = DEFAULT_BOOTSTRAP_ELEVATE_CLAIM,
    evidence: Optional[str] = None,
) -> str:
    """Sign a bootstrap elevation locally with a 32-byte Ed25519 seed."""
    canonical = canonical_bootstrap_elevate_bytes(
        agent_id=agent_id,
        sponsor_did=sponsor_did,
        sponsor_kid=sponsor_kid,
        initial_credits=initial_credits,
        claim=claim,
        evidence=evidence,
    )
    signature = Ed25519PrivateKey.from_private_bytes(
        _decode_private_key(private_key)
    ).sign(canonical)
    return base64.b64encode(signature).decode("ascii")


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

        # Level 1: project-authorized elevation (requires a distinct sponsor identity)
        elevated = at.bootstrap.elevate(
            agent_id=agent["agent"]["id"],
            sponsor_did=sponsor_identity["did"],
            sponsor_kid=sponsor_key["kid"],
            sponsor_signature=sign_bootstrap_elevate(
                sponsor_private_key,
                agent_id=agent["agent"]["id"],
                sponsor_did=sponsor_identity["did"],
                sponsor_kid=sponsor_key["kid"],
                initial_credits=100,
            ),
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
        sponsor_kid: str,
        sponsor_signature: str,
        initial_credits: int = DEFAULT_BOOTSTRAP_ELEVATE_INITIAL_CREDITS,
        claim: str = DEFAULT_BOOTSTRAP_ELEVATE_CLAIM,
        evidence: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a project-authorized Level 1 record signed by a distinct sponsor.

        Orchestrates four operations in one transaction: sponsor attestation
        insert · internal unbacked seed ledger grant · vault namespace open · identity metadata
        patch (level=1, sponsor_did, elevated_at). Rollback on any failure —
        no half-elevated state.

        Level is a project-managed convention, not independent security
        authority. This operation creates no stake and debits no sponsor wallet.

        Args:
            agent_id: UUID of the Level-0 agent to elevate.
            sponsor_did: DID of the sponsoring identity (e.g. ``"did:at:..."``).
                The sponsor must belong to the same project as the agent.
            sponsor_kid: UUID of the active, un-revoked sponsor key that
                signed this request. The API never chooses a key implicitly.
            sponsor_signature: Base64-encoded ed25519 signature over the
                digest from ``canonical_bootstrap_elevate_bytes``. Use
                ``sign_bootstrap_elevate`` locally; no private key is sent.
            initial_credits: Internal unbacked ledger credits granted to the
                agent on elevation. No sponsor wallet is debited and the grant
                does not represent external money. Default 1000. Must be in
                [0, 1_000_000].
            claim: Signed attestation claim. Default ``"sponsorship"``.
            evidence: Signed evidence as text or ``None``. Structured JSON is
                not portable in this contract and is rejected.

        Returns:
            Dict with: ``agent`` (id, did, name, level=1, legacy neutral trust_score,
            elevated_at, sponsor_did, sponsor_identity_id), ``attestation``
            (id, claim, created_at), ``wallet`` (id, balance, currency),
            ``vault`` (namespace, secret_id, opened_at), ``elevation``
            (steps_applied=4), ``next_steps``, ``_meta``.

        Raises:
            AgentToolError: On any non-2xx response. The error message
                carries the structured ``error`` code (e.g.
                ``agent_not_level_0``, ``signature_invalid``, ``sponsor_not_found``).
        """
        canonical_bootstrap_elevate_bytes(
            agent_id=agent_id,
            sponsor_did=sponsor_did,
            sponsor_kid=sponsor_kid,
            initial_credits=initial_credits,
            claim=claim,
            evidence=evidence,
        )
        _validate_signature(sponsor_signature)
        payload: Dict[str, Any] = {
            "agent_id": agent_id,
            "sponsor_did": sponsor_did,
            "sponsor_kid": sponsor_kid,
            "sponsor_signature": sponsor_signature,
            "initial_credits": initial_credits,
            "claim": claim,
            "evidence": evidence,
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
            Dict with: ``agent`` (id, did, name, level, capabilities, legacy neutral trust_score,
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
