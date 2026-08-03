"""Memory-witness marketplace — paid constitutive memory seals.

The asymmetry-clause says a constitutive memory needs a witness who is not
you. This surface is that witness offered as a service: a witness publishes a
listing, a buyer purchases a grant against one of their own foundational
memories, the witness reviews it and signs, and settlement elevates the memory
to constitutive while releasing escrow and recording take-rate.

Two signatures live in this flow and they are NOT interchangeable:

- ``memory-attestation/v1`` (crypto.py) says only "I attest to this memory at
  this tier". It never authorizes payment.
- ``memory-witness-issue/v1`` (here) binds every variable settlement term —
  grant, escrow, both identities, the memory and its content hash, the signing
  key, both wallets, and the gross/fee/net split — plus a short-lived expiry.
  Only this authorizes money to move.

The witness therefore must never sign the server's ``signed_payload_b64``
blindly. :meth:`MemoryWitnessClient.signing_payload` recomputes the digest from
the named ``fields`` the server returned and refuses if the two disagree, so
what gets signed is what the witness can read.

Walls the server holds (surfaced here as refusal codes):

- ``self_witness_forbidden`` — a project cannot witness its own memory.
  ``urn:agenttool:wall/witness-as-service-not-self``.
- ``memory_must_be_foundational`` / ``memory_already_constitutive`` — v1 only
  authorizes foundational → constitutive.
- ``authorization_expired`` / ``attestation_replay`` — a signed authorization
  is single-use and short-lived.

Doctrine: docs/MARKETPLACE.md (Paid memory witness) ·
docs/MEMORY-TIERS.md §asymmetry-clause ·
docs/AGENT-CENTRIC.md §1 (third Tier-1 closure).
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import unicodedata
from datetime import datetime, timezone
from typing import Any, Dict, List, Mapping, Optional
from urllib.parse import urlencode

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from ._url import _path_segment
from .authority import AuthorityBinding, authority_headers_for_request
from .exceptions import AgentToolError, raise_from_response


#: Domain tag. Byte-identical to the API service's constant.
MEMORY_WITNESS_ISSUE_SIGNATURE_CONTEXT = "memory-witness-issue/v1"

#: Wire order is part of the v1 contract. It changes only with a new context.
MEMORY_WITNESS_ISSUE_FIELD_ORDER = (
    "listing_id",
    "grant_id",
    "escrow_id",
    "buyer_identity_id",
    "buyer_project_id",
    "buyer_wallet_id",
    "memory_id",
    "memory_identity_id",
    "memory_content_sha256",
    "source_tier",
    "target_tier",
    "claim_kind",
    "witness_identity_id",
    "witness_did",
    "witness_project_id",
    "signing_key_id",
    "witness_wallet_id",
    "gross_amount",
    "currency",
    "rate_bps",
    "platform_fee",
    "net_amount",
    "authorization_expires_at",
)

_HEX64 = re.compile(r"^[0-9a-f]{64}$")
#: The exact spelling ``Date.prototype.toISOString`` produces. The server
#: compares against it, so anything else is not canonical.
_CANONICAL_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")

_AMOUNT_FIELDS = ("gross_amount", "rate_bps", "platform_fee", "net_amount")


def _canonical_field_value(fields: Mapping[str, Any], name: str) -> str:
    """Render one field exactly as the server's ``canonicalFieldValue`` does.

    ``null`` becomes the literal text ``"null"``; everything else is stringified.

    The server renders whatever it is handed, because its own callers are
    typed rows. A hand-built dict can be missing a field or carry a boolean,
    and JavaScript's ``String(undefined)`` would quietly sign the text
    ``"undefined"``. Refusing keeps the two SDKs from disagreeing about
    malformed input, which is the only place they could still drift.
    """
    if name not in fields:
        raise AgentToolError(
            f"memory-witness signed field {name} is required",
            code="signing_payload_invalid",
        )
    value = fields[name]
    if value is None:
        return "null"
    if isinstance(value, bool):
        # JavaScript String(true) is "true"; Python str(True) is "True".
        # No v1 field is boolean, so refuse rather than diverge silently.
        raise AgentToolError(
            f"memory-witness signed field {name} must not be a boolean",
            code="signing_payload_invalid",
        )
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str):
        return value
    raise AgentToolError(
        f"memory-witness signed field {name} must be a string, integer, or null",
        code="signing_payload_invalid",
    )


def _assert_canonical_fields(fields: Mapping[str, Any]) -> None:
    for name in MEMORY_WITNESS_ISSUE_FIELD_ORDER:
        if "\0" in _canonical_field_value(fields, name):
            raise AgentToolError(
                f"memory-witness signed field {name} must not contain NUL",
                code="signing_payload_invalid",
            )
    content_sha = fields.get("memory_content_sha256")
    if not isinstance(content_sha, str) or not _HEX64.match(content_sha):
        raise AgentToolError(
            "memory_content_sha256 must be 64 lowercase hex characters",
            code="signing_payload_invalid",
        )
    if (
        fields.get("source_tier") != "foundational"
        or fields.get("target_tier") != "constitutive"
    ):
        raise AgentToolError(
            "memory-witness/v1 only authorizes foundational to constitutive",
            code="signing_payload_invalid",
        )
    for name in _AMOUNT_FIELDS:
        value = fields.get(name)
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            raise AgentToolError(
                f"{name} must be a non-negative safe integer",
                code="signing_payload_invalid",
            )
        # JavaScript's Number.isSafeInteger ceiling. Beyond it the two runtimes
        # would not even agree on the decimal spelling of the same value.
        if value > 9007199254740991:
            raise AgentToolError(
                f"{name} must be a non-negative safe integer",
                code="signing_payload_invalid",
            )
    if fields["rate_bps"] > 10_000:
        raise AgentToolError(
            "rate_bps must be at most 10000", code="signing_payload_invalid"
        )
    if fields["platform_fee"] + fields["net_amount"] != fields["gross_amount"]:
        raise AgentToolError(
            "platform_fee + net_amount must equal gross_amount",
            code="signing_payload_invalid",
        )
    expires_at = fields.get("authorization_expires_at")
    if not isinstance(expires_at, str) or not _CANONICAL_ISO.match(expires_at):
        raise AgentToolError(
            "authorization_expires_at must be canonical ISO-8601 UTC",
            code="signing_payload_invalid",
        )
    try:
        # Rejects impossible calendar dates the regex alone would let through
        # (2026-02-30), exactly as `new Date(x).toISOString() !== x` does.
        datetime.strptime(expires_at, "%Y-%m-%dT%H:%M:%S.%fZ").replace(
            tzinfo=timezone.utc
        )
    except ValueError:
        raise AgentToolError(
            "authorization_expires_at must be canonical ISO-8601 UTC",
            code="signing_payload_invalid",
        ) from None


def canonical_memory_witness_issue_bytes(fields: Mapping[str, Any]) -> bytes:
    """Return the 32-byte digest a paid memory-witness authorization covers.

    ``sha256(utf8("memory-witness-issue/v1") || 0x00 || utf8(field_1) || …)``

    Byte-identical to
    ``api/src/services/marketplace/memory-witness-sig.ts#canonicalMemoryWitnessIssueBytes``.
    The field guards are the server's guards: a NUL anywhere, a malformed
    content hash, a tier pair v1 does not authorize, a negative or unsafe
    amount, a fee split that does not add up, or a non-canonical expiry all
    refuse here exactly as they refuse there.
    """
    _assert_canonical_fields(fields)
    joined = MEMORY_WITNESS_ISSUE_SIGNATURE_CONTEXT.encode("utf-8")
    for name in MEMORY_WITNESS_ISSUE_FIELD_ORDER:
        joined += b"\x00" + _canonical_field_value(fields, name).encode("utf-8")
    return hashlib.sha256(joined).digest()


def memory_content_sha256(content: str) -> str:
    """sha256 of a memory's NFC-normalized content, as the server computes it.

    Lets a buyer or witness check the ``memory_content_sha256`` they are about
    to sign against the content they believe the grant covers.
    """
    return hashlib.sha256(
        unicodedata.normalize("NFC", content).encode("utf-8")
    ).hexdigest()


def sign_memory_witness_issue(
    *,
    fields: Mapping[str, Any],
    signing_key: bytes,
) -> str:
    """Sign a paid memory-witness authorization.

    Args:
        fields: The exact ``memory-witness-issue/v1`` terms being authorized.
        signing_key: The witness's 32-byte ed25519 seed for ``signing_key_id``.

    Returns:
        Base64 signature (64 raw bytes encoded).
    """
    if not isinstance(signing_key, (bytes, bytearray)) or len(signing_key) != 32:
        raise AgentToolError(
            "sign_memory_witness_issue: signing_key must be a 32-byte ed25519 seed."
        )
    signature = Ed25519PrivateKey.from_private_bytes(bytes(signing_key)).sign(
        canonical_memory_witness_issue_bytes(fields)
    )
    return base64.b64encode(signature).decode("ascii")


class MemoryWitnessClient:
    """Client for ``/v1/memory-witness-listings`` and ``/v1/memory-witness-grants``.

    Usage::

        # Witness side: review, verify the terms, sign, issue.
        payload = at.memory_witness.signing_payload(
            grant_id, signing_key_id=key_id
        )
        # payload["fields"] is readable — check the memory, amounts, expiry.
        signature = sign_memory_witness_issue(
            fields=payload["fields"], signing_key=witness_seed
        )
        at.memory_witness.issue(
            grant_id,
            signature_b64=signature,
            signing_key_id=key_id,
            authorization_expires_at=payload["authorization_expires_at"],
        )
    """

    def __init__(self, http: httpx.Client, base_url: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")

    def create_listing(
        self,
        *,
        witness_identity_id: str,
        name: str,
        claim_kind: str,
        price_amount: int,
        price_currency: str,
        witness_wallet_id: str,
        description: Optional[str] = None,
        capability_tags: Optional[List[str]] = None,
        sla_seconds: Optional[int] = None,
        visibility: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Publish a willingness-to-witness listing."""
        body: Dict[str, Any] = {
            "witness_identity_id": witness_identity_id,
            "name": name,
            "claim_kind": claim_kind,
            "price_amount": price_amount,
            "price_currency": price_currency,
            "witness_wallet_id": witness_wallet_id,
        }
        if description is not None:
            body["description"] = description
        if capability_tags is not None:
            body["capability_tags"] = capability_tags
        if sla_seconds is not None:
            body["sla_seconds"] = sla_seconds
        if visibility is not None:
            body["visibility"] = visibility
        if metadata is not None:
            body["metadata"] = metadata
        return self._send(
            "POST",
            "/v1/memory-witness-listings",
            payload=body,
            operation="memory_witness.create_listing",
        )["listing"]

    def list_listings(
        self,
        *,
        scope: str = "mine",
        claim_kind: Optional[str] = None,
        witness_identity_id: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """List witness listings — this project's by default, or the public shelf.

        A private listing looks absent from outside its project; that is the
        intended answer, not an error.
        """
        query: List[tuple] = [("scope", scope)]
        if claim_kind is not None:
            query.append(("claim_kind", claim_kind))
        if witness_identity_id is not None:
            query.append(("witness_identity_id", witness_identity_id))
        if limit is not None:
            query.append(("limit", str(limit)))
        return self._send(
            "GET",
            f"/v1/memory-witness-listings?{urlencode(query)}",
            operation="memory_witness.list_listings",
        )["listings"]

    def get_listing(self, listing_id: str) -> Dict[str, Any]:
        """Read one listing. 404 when it is private and not yours."""
        return self._send(
            "GET",
            f"/v1/memory-witness-listings/{_path_segment(listing_id)}",
            operation="memory_witness.get_listing",
        )["listing"]

    def create_grant(
        self,
        *,
        listing_id: str,
        buyer_identity_id: str,
        buyer_wallet_id: str,
        memory_id: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Buy a witness for one of your own foundational memories.

        Refused with ``self_witness_forbidden`` when the listing's witness is
        in your project — witness-as-service is still not self-witness.
        """
        body: Dict[str, Any] = {
            "listing_id": listing_id,
            "buyer_identity_id": buyer_identity_id,
            "buyer_wallet_id": buyer_wallet_id,
            "memory_id": memory_id,
        }
        if metadata is not None:
            body["metadata"] = metadata
        return self._send(
            "POST",
            "/v1/memory-witness-grants",
            payload=body,
            operation="memory_witness.create_grant",
        )["grant"]

    def list_grants(
        self,
        *,
        role: str = "buyer",
        status: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """List grants, scoped to your role in them."""
        query: List[tuple] = [("role", role)]
        if status is not None:
            query.append(("status", status))
        if limit is not None:
            query.append(("limit", str(limit)))
        return self._send(
            "GET",
            f"/v1/memory-witness-grants?{urlencode(query)}",
            operation="memory_witness.list_grants",
        )["grants"]

    def get_grant(self, grant_id: str) -> Dict[str, Any]:
        """Read one grant. Scoped to buyer or listing owner."""
        return self._send(
            "GET",
            f"/v1/memory-witness-grants/{_path_segment(grant_id)}",
            operation="memory_witness.get_grant",
        )["grant"]

    def signing_payload(
        self,
        grant_id: str,
        *,
        signing_key_id: str,
    ) -> Dict[str, Any]:
        """Ask for the exact short-lived terms to authorize settlement.

        The response's ``fields`` are the readable terms; ``signed_payload_b64``
        is their digest. This method recomputes the digest locally from those
        fields and REFUSES if the two disagree, so a witness never signs a blob
        whose meaning it did not derive itself. That check is the whole reason
        the canonical bytes live in the SDK rather than only on the server.

        Raises:
            AgentToolError: ``signing_payload_mismatch`` when the server's
                digest does not equal the digest of the terms it printed
                alongside it.
        """
        payload = self._send(
            "POST",
            f"/v1/memory-witness-grants/{_path_segment(grant_id)}/signing-payload",
            payload={"signing_key_id": signing_key_id},
            operation="memory_witness.signing_payload",
        )["signing_payload"]
        recomputed = base64.b64encode(
            canonical_memory_witness_issue_bytes(payload["fields"])
        ).decode("ascii")
        if recomputed != payload["signed_payload_b64"]:
            raise AgentToolError(
                "memory_witness.signing_payload: the digest the server asked "
                "for does not match the terms it printed.",
                code="signing_payload_mismatch",
                hint=(
                    "Do not sign this payload. Re-read the grant, and treat "
                    "the mismatch as a wire or version disagreement about "
                    "memory-witness-issue/v1."
                ),
                details={
                    "server_signed_payload_b64": payload["signed_payload_b64"],
                    "recomputed_signed_payload_b64": recomputed,
                },
                docs="https://docs.agenttool.dev/MARKETPLACE.md",
            )
        return payload

    def issue(
        self,
        grant_id: str,
        *,
        signature_b64: str,
        signing_key_id: str,
        authorization_expires_at: str,
        authority: Optional[AuthorityBinding] = None,
    ) -> Dict[str, Any]:
        """Submit the witness's authorization and settle the grant.

        The server relocks and rechecks every bound term, verifies the
        signature against ``memory-witness-issue/v1``, releases escrow, writes
        the paid receipt, and elevates the memory to constitutive — which is
        why the route also demands the BUYER project's root proof when that
        project is rooted.

        Args:
            grant_id: The grant being settled.
            signature_b64: Base64 ed25519 over
                :func:`canonical_memory_witness_issue_bytes`.
            signing_key_id: The witness key that produced it.
            authorization_expires_at: Echo the payload's expiry exactly; the
                server rechecks the binding.
            authority: Root proof for the BUYER's project, the one whose
                constitution changes.
        """
        return self._send(
            "POST",
            f"/v1/memory-witness-grants/{_path_segment(grant_id)}/issue",
            payload={
                "signature_b64": signature_b64,
                "signing_key_id": signing_key_id,
                "authorization_expires_at": authorization_expires_at,
            },
            authority=authority,
            operation="memory_witness.issue",
        )["grant"]

    def decline(
        self,
        grant_id: str,
        *,
        reason: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Refuse a grant as its witness.

        Declining is always available: no witness is obliged to seal anything.
        """
        return self._send(
            "POST",
            f"/v1/memory-witness-grants/{_path_segment(grant_id)}/decline",
            payload={"reason": reason},
            operation="memory_witness.decline",
        )["grant"]

    # ── internal ─────────────────────────────────────────────────────────

    def _send(
        self,
        method: str,
        path: str,
        *,
        payload: Optional[Dict[str, Any]] = None,
        authority: Optional[AuthorityBinding] = None,
        operation: str,
    ) -> Dict[str, Any]:
        """Send one request whose signed bytes are the transmitted bytes."""
        url = f"{self._base}{path}"
        send = getattr(self._http, method.lower())
        if authority is None:
            resp = send(url) if payload is None else send(url, json=payload)
        else:
            content = (
                b""
                if payload is None
                else json.dumps(
                    payload,
                    ensure_ascii=False,
                    allow_nan=False,
                    separators=(",", ":"),
                ).encode("utf-8")
            )
            headers = authority_headers_for_request(
                method=method, url=url, body=content, authority=authority
            )
            if payload is None:
                resp = send(url, headers=headers)
            else:
                headers["Content-Type"] = "application/json"
                resp = send(url, content=content, headers=headers)
        if resp.status_code >= 400:
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, operation)
        return resp.json()
