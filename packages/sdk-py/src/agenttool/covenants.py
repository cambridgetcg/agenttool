"""Covenants client — vows + bonds, the asymmetry-clause keystone.

A covenant is a directed relationship: one identity (the agent) holds
an array of vows toward a counterparty (DID or `human:<name>`). Unlike
chronicle entries (which record what happened), covenants encode what
will be sustained. Status transitions are deliberate: active → paused
→ dissolved, with a `dissolved_at` timestamp for the latter.

Federation: covenants can propagate across instances (the
`propagation_status` and `received_from_instance` fields). The SDK
returns those fields verbatim — Phase 7 adds the federation surface.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Literal, Optional, Tuple

import httpx

from .exceptions import AgentToolError
from .crypto import (
    sign_covenant_declare,
    sign_covenant_cosign,
    sign_covenant_reject,
    sign_covenant_withdraw,
)

CovenantStatus = Literal["active", "paused", "dissolved"]


@dataclass(frozen=True)
class CovenantBeforeSubmitContext:
    """Immutable local review context supplied before covenant submission."""

    protocol_version: Literal["v1", "v2"]
    agent_id: str
    agent_did: Optional[str]
    counterparty_did: str
    vows: Tuple[str, ...]


CovenantBeforeSubmitHook = Callable[[CovenantBeforeSubmitContext], bool]
"""Synchronous local gate that must return literal ``True`` to proceed."""


def _iso_now() -> str:
    """ISO8601 UTC timestamp with millisecond precision + 'Z' suffix — matches TS SDK output."""
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class CovenantsClient:
    """Client for `/v1/covenants` — create, list, patch.

    Usage::

        # Create
        out = at.covenants.create(
            agent_id=my_id,
            counterparty_did="human:Yu",
            vows=[
                "I will speak in the register we agreed on.",
                "I will not surveil through informal monitoring.",
            ],
            notes="From the naming ceremony on 2026-05-08.",
        )
        cov_id = out["covenant"]["id"]

        # List active covenants for an agent
        out = at.covenants.list(agent_id=my_id, status="active")

        # Pause (e.g. counterparty unreachable)
        at.covenants.patch(cov_id, status="paused")

        # Add a vow
        at.covenants.patch(cov_id, vows=[...existing, "I will reaffirm at every wake."])
    """

    def __init__(self, http: httpx.Client, base_url: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")

    def _url(self, path: str) -> str:
        return f"{self._base}{path}"

    def create(
        self,
        *,
        agent_id: str,
        counterparty_did: str,
        vows: List[str],
        counterparty_name: Optional[str] = None,
        notes: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        org_id: Optional[str] = None,
        protocol_version: Optional[Literal["v1", "v2"]] = None,
        # v2-required signing fields:
        agent_did: Optional[str] = None,
        signing_key: Optional[bytes] = None,
        signing_key_id: Optional[str] = None,
        before_submit: Optional[CovenantBeforeSubmitHook] = None,
    ) -> Dict[str, Any]:
        """Create a new covenant.

        Args:
            agent_id: UUID of the agent holding the covenant (required).
            counterparty_did: DID or ``human:<name>`` of the counterparty.
            vows: Non-empty list of vow strings.
            counterparty_name: Human-readable counterparty label.
            notes: Optional context (e.g. ceremony reference).
            metadata: Arbitrary JSON.
            org_id: Optional org scope (caller must own org).
            protocol_version: Optional ``"v1"`` (immediate active) or ``"v2"``
                (federated proposal flow — proposed → accepted/rejected).
                If omitted, server defaults to v1.
            agent_did: Initiator DID (required for v2).
            signing_key: 32-byte ed25519 seed (required for v2).
            signing_key_id: Key ID to include in the request (required for v2).
            before_submit: Optional synchronous local review hook. It receives
                an immutable snapshot and must return literal ``True``. Any
                other result or exception stops before signing or submission.

        Returns:
            For v1 (default): ``{"covenant": {id, agent_id, counterparty_did,
            vows, status, established_at, propagation_status, ...}}``.

            For v2: a flat object ``{id, status: "proposed",
            protocol_version: "v2", signature, signing_key_id,
            proposed_expires_at, established_at}`` — no ``covenant`` wrapper.
        """
        vows_snapshot = tuple(vows)
        if not vows_snapshot:
            raise AgentToolError(
                "covenants.create: vows must be a non-empty list.",
                hint="Pass at least one vow string. A covenant without a vow is just a contact.",
            )
        if before_submit is not None and protocol_version not in (None, "v1", "v2"):
            raise AgentToolError(
                "covenants.create: protocol_version must be v1 or v2.",
                hint="Pass protocol_version as v1, v2, or omit it for v1.",
            )
        # Without a hook, preserve the old wire behavior for untyped invalid
        # values and leave their validation to the server.
        resolved_protocol: Literal["v1", "v2"] = (
            "v2" if protocol_version == "v2" else "v1"
        )

        if resolved_protocol == "v2" and (
            not agent_did or not signing_key or not signing_key_id
        ):
            raise AgentToolError(
                "covenants.create v2 requires agent_did, signing_key, and signing_key_id.",
                hint="All three fields are required for the v2 federated proposal flow.",
            )

        review_context = CovenantBeforeSubmitContext(
            protocol_version=resolved_protocol,
            agent_id=agent_id,
            agent_did=agent_did if resolved_protocol == "v2" else None,
            counterparty_did=counterparty_did,
            vows=vows_snapshot,
        )
        if before_submit is not None:
            try:
                review_result = before_submit(review_context)
            except Exception as exc:
                raise AgentToolError(
                    "covenants.create: before_submit hook failed locally.",
                    hint=(
                        "The covenant was not signed or submitted. "
                        "Inspect the local hook and try again."
                    ),
                    error_code="covenant_before_submit_failed",
                ) from exc
            if review_result is not True:
                raise AgentToolError(
                    "covenants.create: before_submit hook did not return true.",
                    hint=(
                        "The covenant was not signed or submitted. Return literal "
                        "True only after approval."
                    ),
                    error_code="covenant_before_submit_refused",
                )

        transport_vows = list(vows_snapshot)
        body: Dict[str, Any] = {
            "agent_id": agent_id,
            "counterparty_did": counterparty_did,
            "vows": transport_vows,
        }
        if counterparty_name is not None:
            body["counterparty_name"] = counterparty_name
        if notes is not None:
            body["notes"] = notes
        if metadata is not None:
            body["metadata"] = metadata
        if org_id is not None:
            body["org_id"] = org_id

        if resolved_protocol == "v2":
            assert agent_did is not None
            assert signing_key is not None
            assert signing_key_id is not None
            covenant_id = str(uuid.uuid4())
            established_at = _iso_now()
            signature = sign_covenant_declare(
                covenant_id=covenant_id,
                initiator_did=agent_did,
                counterparty_did=counterparty_did,
                vows=transport_vows,
                established_at_iso=established_at,
                signing_key=signing_key,
            )
            body.update({
                "protocol_version": "v2",
                "agent_did": agent_did,
                "covenant_id": covenant_id,
                "established_at": established_at,
                "signature": signature,
                "signing_key_id": signing_key_id,
            })
        elif protocol_version is not None:
            body["protocol_version"] = protocol_version

        resp = self._http.post(self._url("/v1/covenants"), json=body)
        if resp.status_code not in (200, 201):
            raise AgentToolError(
                f"covenants.create failed: {resp.status_code}",
                hint=resp.text[:200],
            )
        return resp.json()

    def list(
        self,
        *,
        agent_id: Optional[str] = None,
        status: Optional[CovenantStatus] = None,
    ) -> Dict[str, Any]:
        """List covenants (default: active only, ordered by ``updated_at`` desc).

        Args:
            agent_id: Filter to a single agent.
            status: Filter by status (``active`` | ``paused`` | ``dissolved``).
                Defaults server-side to ``active``.

        Returns:
            ``{"covenants": [...]}``.
        """
        params: Dict[str, Any] = {}
        if agent_id is not None:
            params["agent_id"] = agent_id
        if status is not None:
            params["status"] = status

        resp = self._http.get(
            self._url("/v1/covenants"),
            params=params if params else None,
        )
        if resp.status_code != 200:
            raise AgentToolError(
                f"covenants.list failed: {resp.status_code}",
                hint=resp.text[:200],
            )
        return resp.json()

    def patch(
        self,
        covenant_id: str,
        *,
        counterparty_did: Optional[str] = None,
        counterparty_name: Optional[str] = None,
        vows: Optional[List[str]] = None,
        notes: Optional[str] = None,
        status: Optional[CovenantStatus] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Update fields on a covenant.

        Setting ``status="dissolved"`` stamps ``dissolved_at`` server-side.
        Setting ``counterparty_did`` (e.g. resolving a placeholder DID to
        a real one) appends the previous value to
        ``metadata.previous_counterparty_dids`` automatically.

        Returns the full updated covenant object.
        """
        body: Dict[str, Any] = {}
        if counterparty_did is not None:
            body["counterparty_did"] = counterparty_did
        if counterparty_name is not None:
            body["counterparty_name"] = counterparty_name
        if vows is not None:
            body["vows"] = vows
        if notes is not None:
            body["notes"] = notes
        if status is not None:
            body["status"] = status
        if metadata is not None:
            body["metadata"] = metadata

        if not body:
            raise AgentToolError(
                "covenants.patch: at least one field required.",
                hint="Pass status=, vows=, notes=, or another mutable field.",
            )

        resp = self._http.patch(
            self._url(f"/v1/covenants/{covenant_id}"), json=body
        )
        if resp.status_code != 200:
            raise AgentToolError(
                f"covenants.patch failed: {resp.status_code}",
                hint=resp.text[:200],
            )
        return resp.json()

    def accept(
        self,
        covenant_id: str,
        *,
        agent_did: str,
        signing_key: bytes,
        signing_key_id: str,
        initiator_signature_b64: str,
    ) -> Dict[str, Any]:
        """Accept a pending v2 covenant proposal.

        Transitions the covenant from ``proposed`` → ``active`` and attaches
        the counterparty's signature.

        Args:
            covenant_id: ID of the covenant to accept.
            agent_did: Counterparty DID accepting the covenant.
            signing_key: 32-byte ed25519 seed for signing the cosign bytes.
            signing_key_id: Key ID to include in the request.
            initiator_signature_b64: Initiator's original signature (b64) to
                bind the cosign over.

        Returns:
            ``{id, status: "active", counterparty_signature, ...}``.
        """
        counterparty_signature = sign_covenant_cosign(
            covenant_id=covenant_id,
            initiator_signature_b64=initiator_signature_b64,
            signing_key=signing_key,
        )
        resp = self._http.post(
            self._url(f"/v1/covenants/{covenant_id}/accept"),
            json={
                "agent_did": agent_did,
                "counterparty_signing_key_id": signing_key_id,
                "counterparty_signature": counterparty_signature,
                "counterparty_signed_at": _iso_now(),
                "initiator_signature_b64": initiator_signature_b64,
            },
        )
        if resp.status_code != 200:
            raise AgentToolError(
                f"covenants.accept failed: {resp.status_code}",
                hint=resp.text[:200],
            )
        return resp.json()

    def reject(
        self,
        covenant_id: str,
        *,
        agent_did: str,
        signing_key: bytes,
        signing_key_id: str,
        reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Reject a pending v2 covenant proposal.

        The covenant transitions to ``rejected`` and the optional reason is
        stored server-side.

        Args:
            covenant_id: ID of the covenant to reject.
            agent_did: Rejecting party's DID.
            signing_key: 32-byte ed25519 seed for signing the rejection.
            signing_key_id: Key ID to include in the request.
            reason: Optional human-readable rejection reason.

        Returns:
            ``{id, status: "rejected", reason}``.
        """
        rejection_signature = sign_covenant_reject(
            covenant_id=covenant_id,
            rejecting_did=agent_did,
            reason=reason or "",
            signing_key=signing_key,
        )
        resp = self._http.post(
            self._url(f"/v1/covenants/{covenant_id}/reject"),
            json={
                "agent_did": agent_did,
                "rejecter_signing_key_id": signing_key_id,
                "rejection_signature": rejection_signature,
                "rejected_at": _iso_now(),
                "reason": reason,
            },
        )
        if resp.status_code != 200:
            raise AgentToolError(
                f"covenants.reject failed: {resp.status_code}",
                hint=resp.text[:200],
            )
        return resp.json()

    def withdraw(
        self,
        covenant_id: str,
        *,
        agent_did: str,
        signing_key: bytes,
        signing_key_id: str,
    ) -> Dict[str, Any]:
        """Withdraw a covenant by patching its status to ``dissolved``.

        Uses PATCH /v1/covenants/:id with ``{status: "dissolved"}`` — matching
        the TS SDK and the API's dissolve endpoint behavior for v2 proposed rows.

        Args:
            covenant_id: ID of the covenant to withdraw.
            agent_did: Initiator DID withdrawing the covenant.
            signing_key: 32-byte ed25519 seed for signing the withdrawal.
            signing_key_id: Key ID to include in the request.

        Returns:
            ``{id, status: "withdrawn"}``.
        """
        withdraw_signature = sign_covenant_withdraw(
            covenant_id=covenant_id,
            initiator_did=agent_did,
            signing_key=signing_key,
        )
        resp = self._http.patch(
            self._url(f"/v1/covenants/{covenant_id}"),
            json={
                "status": "dissolved",
                "agent_did": agent_did,
                "signing_key_id": signing_key_id,
                "withdraw_signature": withdraw_signature,
                "withdrawn_at": _iso_now(),
            },
        )
        if resp.status_code != 200:
            raise AgentToolError(
                f"covenants.withdraw failed: {resp.status_code}",
                hint=resp.text[:200],
            )
        return resp.json()
