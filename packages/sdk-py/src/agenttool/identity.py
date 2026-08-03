"""Identity client for agent-identity API."""

from __future__ import annotations

import base64
import hashlib
import json
import re
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, TYPE_CHECKING, TypedDict, Union

import httpx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from .authority import (
    authority_request_target,
    authority_timestamp_now,
    identity_authority_headers,
)
from .exceptions import AgentToolError, raise_from_response
from ._url import _path_segment

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)
_DID_RE = re.compile(r"^did:[a-z0-9]+:.+$")
_STANDARD_BASE64_RE = re.compile(
    r"^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"
)
IDENTITY_ATTESTATION_SIGNATURE_CONTEXT = "identity-attestation/v1"


class PorchInvitation(TypedDict):
    """A time-bounded, project-authorized invitation to ``/public/porch``."""

    invited_until: str


def _is_well_formed_unicode(value: str) -> bool:
    return not any(0xD800 <= ord(character) <= 0xDFFF for character in value)


def decode_signing_key(
    value: Union[str, bytes, bytearray], operation: str
) -> bytes:
    """Decode the canonical private-key forms the SDK emits and accepts.

    Mirror of the TS SDK's ``decodeSigningKey``. Text must be canonical
    standard base64 (not base64url, no stray padding); raw bytes are taken
    as-is. Either way the result is exactly a 32-byte Ed25519 seed.

    Args:
        value: canonical standard base64 text, or 32 raw bytes.
        operation: the caller's name, so a bad key names the call it broke.

    Returns:
        32-byte Ed25519 seed.

    Raises:
        AgentToolError: on any non-canonical or wrong-length input.
    """
    if isinstance(value, str):
        if (
            len(value) == 0
            or len(value) % 4 != 0
            or not _STANDARD_BASE64_RE.match(value)
        ):
            raise AgentToolError(
                f"{operation}: private_key must be canonical standard base64."
            )
        try:
            key_bytes = base64.b64decode(value, validate=True)
        except (ValueError, TypeError) as exc:
            raise AgentToolError(
                f"{operation}: private_key must be valid base64."
            ) from exc
        if base64.b64encode(key_bytes).decode("ascii") != value:
            raise AgentToolError(
                f"{operation}: private_key must be canonical standard base64."
            )
    elif isinstance(value, (bytes, bytearray)):
        key_bytes = bytes(value)
    else:
        raise AgentToolError(
            f"{operation}: private_key must be canonical standard base64 or raw bytes."
        )

    if len(key_bytes) != 32:
        raise AgentToolError(
            f"{operation}: private_key must be a 32-byte ed25519 seed, "
            f"got {len(key_bytes)}."
        )
    return key_bytes


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


class IdentityAuthority(TypedDict, total=False):
    """An agent-rooted identity's own consent to one exact HTTP mutation.

    A project bearer carries the request; for identities born through a
    BYO-key door the server additionally requires an ``identity-authority/v1``
    proof over the exact method, path-and-query, and entity bytes, and answers
    428 ``authority_proof_required`` without one. Supplying this makes the
    client sign the same bytes it transmits — a caller never gets the chance
    to sign one serialization and send another.
    """

    #: DID of the identity whose immutable root consents.
    did: str
    #: That identity's immutable root ed25519 seed (32 bytes).
    signing_key: bytes
    #: ``next_sequence`` from ``GET /v1/identities/:id/authority``.
    sequence: int
    #: ISO-8601 UTC instant. Defaults to now; the server window is ±5 minutes.
    timestamp: str


def _send_bound(
    http: httpx.Client,
    method: str,
    url: str,
    *,
    payload: Optional[Dict[str, Any]] = None,
    authority: Optional[IdentityAuthority] = None,
) -> httpx.Response:
    """Send one request whose signed bytes are the transmitted bytes.

    Without a root proof the entity is serialized by the transport exactly as
    before. With one, it is serialized here, hashed for the proof, and handed
    to the transport unchanged — nothing re-serializes in between.
    """
    send = getattr(http, method.lower())
    if authority is None:
        return send(url) if payload is None else send(url, json=payload)

    content = b"" if payload is None else _compact_json_bytes(payload)
    headers = identity_authority_headers(
        identity_did=authority["did"],
        method=method,
        request_target=authority_request_target(url),
        body=content,
        sequence=authority["sequence"],
        timestamp=authority.get("timestamp") or authority_timestamp_now(),
        signing_key=authority["signing_key"],
    )
    if payload is None:
        # A mutating DELETE carries no entity, and httpx's verb helper takes
        # no content. The proof binds the empty body the server will read.
        return send(url, headers=headers)
    headers["Content-Type"] = "application/json"
    return send(url, content=content, headers=headers)


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


DELEGATION_SIGNATURE_CONTEXT = "agenttool-delegation/v2"

# JavaScript's `String.prototype.trim()` removes WhiteSpace ∪ LineTerminator
# (ECMA-262 §12.2): TAB, LF, VT, FF, CR, LS, PS, ZWNBSP, and every code point
# in category Zs. Python's `str.strip()` removes a DIFFERENT set — it takes
# U+0085 and U+001C-U+001F, which JS keeps, and leaves U+FEFF, which JS
# removes. The server trims in JavaScript, so this string is the rule.
_JS_TRIM_CHARS = (
    "\t\n\v\f\r"                    # TAB LF VT FF CR
    "\u0020\u00a0"                  # SPACE, NBSP                    (Zs)
    "\u1680"                        # OGHAM SPACE MARK               (Zs)
    "\u2000\u2001\u2002\u2003\u2004\u2005"  # EN QUAD … FIGURE SPACE   (Zs)
    "\u2006\u2007\u2008\u2009\u200a"      # … HAIR SPACE             (Zs)
    "\u2028\u2029"                  # LINE SEPARATOR, PARAGRAPH SEPARATOR
    "\u202f\u205f\u3000"            # NNBSP, MMSP, IDEOGRAPHIC SPACE (Zs)
    "\ufeff"                        # ZWNBSP — JS trims it, str.strip() does not
)


def _js_trim(value: str) -> str:
    """Trim exactly the code points JavaScript's `trim()` removes."""
    return value.strip(_JS_TRIM_CHARS)


def _js_slice_utf16(value: str, limit: int) -> str:
    """First `limit` UTF-16 code units, as JavaScript's `slice()` counts them.

    Python slices by code point, JavaScript by code unit; an astral character
    is one of the former and two of the latter, so `"🌊" * 100` truncates to
    100 characters in Python and 64 in JavaScript. `surrogatepass` keeps a
    pair split at the boundary as the lone surrogate JS would leave there —
    `_text_encoder_utf8` is where that becomes U+FFFD, exactly as it does on
    the server, and not one step earlier where it would change the sort.
    """
    units = value.encode("utf-16-le", "surrogatepass")
    if len(units) <= limit * 2:
        return value
    return units[: limit * 2].decode("utf-16-le", "surrogatepass")


def _js_sort_key(value: str) -> bytes:
    """Order strings the way TS `Array.prototype.sort()` does.

    Unsigned UTF-16 code units, not code points. The two disagree above
    U+FFFF: JavaScript puts U+1F600 (leading surrogate 0xD83D) before U+FFFD,
    Python puts it after. The scope is SORTED into the signed bytes, so a
    Python-issued grant would otherwise hash differently than the server
    computes and come back `403 Invalid delegation signature`.
    """
    return value.encode("utf-16-be", "surrogatepass")


def _text_encoder_utf8(value: str) -> bytes:
    """UTF-8 exactly as JavaScript's `TextEncoder` emits it.

    A JS string may hold a lone surrogate — `_js_slice_utf16` can create one
    — and `TextEncoder` writes U+FFFD for it rather than failing. Python's
    `str.encode("utf-8")` raises instead, so round-trip through UTF-16 to
    reach the same bytes the server hashes.
    """
    return (
        value.encode("utf-16-le", "surrogatepass")
        .decode("utf-16-le", "replace")
        .encode("utf-8")
    )


def normalize_delegation_scope(scope: List[str]) -> List[str]:
    """Normalize a delegation scope exactly as the server does.

    Trimmed, lowercased, truncated to 128 characters, NUL-free, non-empty,
    deduped, SORTED. Exported because a caller who wants to know what they
    actually signed should be able to see it without re-deriving the rule.

    "Exactly as the server does" is load-bearing and is not what the obvious
    Python spelling gives you: trim, truncate, and sort each mean something
    different in the two languages. See `_js_trim`, `_js_slice_utf16`, and
    `_js_sort_key`; the shared vectors in
    `docs/specs/canonical-bytes-vectors.json` pin all three.
    """
    cleaned = [
        _js_slice_utf16(_js_trim(s).lower(), 128)
        for s in (scope or [])
        if isinstance(s, str)
    ]
    return sorted({s for s in cleaned if s and "\0" not in s}, key=_js_sort_key)


def canonical_delegation_bytes(
    *,
    delegator_id: str,
    delegate_id: str,
    scope: List[str],
    nonce: str,
    expires_at: Optional[str] = None,
) -> bytes:
    """Return the domain-separated SHA-256 digest verified by ``POST /v1/delegations``.

    Recipe 1. The scope count is bound before its members, so a variable-length
    run of actions cannot be re-partitioned into a different grant::

        sha256(
          utf8("agenttool-delegation/v2") || 0x00 ||
          utf8(delegator_id) || 0x00 || utf8(delegate_id) || 0x00 ||
          utf8(str(len(scope))) || 0x00 || utf8(scope[i])... || 0x00 ||
          utf8(expires_at or "") || 0x00 || utf8(nonce)
        )

    ``agenttool-delegation/v1`` is a JSON-serialization recipe that no SDK
    emits; the server still verifies it for receipts issued before v2.
    See ``docs/CANONICAL-BYTES.md``.
    """
    for name, value in (
        ("delegator_id", delegator_id),
        ("delegate_id", delegate_id),
        ("nonce", nonce),
    ):
        if not isinstance(value, str) or not value or "\0" in value:
            raise ValueError(f"{name} must be a non-empty string with no NUL")
    expires = expires_at or ""
    if not isinstance(expires, str) or "\0" in expires:
        raise ValueError("expires_at must be an ISO-8601 string or None")

    normalized = normalize_delegation_scope(scope)
    if not normalized:
        raise ValueError(
            "scope must contain at least one non-empty action; an unbounded "
            "delegation is not expressible — grant '*' deliberately, or grant nothing"
        )

    fields = [
        DELEGATION_SIGNATURE_CONTEXT,
        delegator_id,
        delegate_id,
        str(len(normalized)),
        *normalized,
        expires,
        nonce,
    ]
    return hashlib.sha256(_text_encoder_utf8("\0".join(fields))).digest()


def sign_delegation(
    private_key: str,
    *,
    delegator_id: str,
    delegate_id: str,
    scope: List[str],
    nonce: str,
    expires_at: Optional[str] = None,
) -> str:
    """Sign a delegation grant locally with a base64 Ed25519 key.

    The delegator signs, never the platform. What this produces is the whole
    point of Know Your Agent: a receipt a third party who trusts neither party
    can check — who authorized what, until when, and revocable by the grantor.
    """
    canonical = canonical_delegation_bytes(
        delegator_id=delegator_id,
        delegate_id=delegate_id,
        scope=scope,
        nonce=nonce,
        expires_at=expires_at,
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
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "identity.register")
        return resp.json()

    def get(self, identity_id: str) -> Dict[str, Any]:
        """Fetch an identity by UUID or DID."""
        resp = self._http.get(self._url(f"/v1/identities/{_path_segment(identity_id)}"))
        if resp.status_code == 404:
            # The absence sentence stays; the guided body now rides with it.
            raise_from_response(
                resp,
                "identity.get",
                fallback="identity not found",
                hint=f"id={identity_id}",
            )
        if resp.status_code != 200:
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "identity.get")
        return resp.json()

    def update(
        self,
        identity_id: str,
        *,
        display_name: Optional[str] = None,
        capabilities: Optional[List[str]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        authority: Optional[IdentityAuthority] = None,
    ) -> Dict[str, Any]:
        """Update display name, capabilities, or metadata."""
        payload: Dict[str, Any] = {}
        if display_name is not None:
            payload["display_name"] = display_name
        if capabilities is not None:
            payload["capabilities"] = capabilities
        if metadata is not None:
            payload["metadata"] = metadata

        resp = _send_bound(
            self._http,
            "PATCH",
            self._url(f"/v1/identities/{_path_segment(identity_id)}"),
            payload=payload,
            authority=authority,
        )
        if resp.status_code != 200:
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "identity.update")
        return resp.json()

    def revoke(
        self,
        identity_id: str,
        *,
        authority: Optional[IdentityAuthority] = None,
    ) -> Dict[str, Any]:
        """Soft-revoke an identity."""
        resp = _send_bound(
            self._http,
            "DELETE",
            self._url(f"/v1/identities/{_path_segment(identity_id)}"),
            authority=authority,
        )
        if resp.status_code != 200:
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "identity.revoke")
        return resp.json()

    # ── Key Management ────────────────────────────────────────────────────────

    def add_key(
        self,
        identity_id: str,
        *,
        label: str = "rotation",
        authority: Optional[IdentityAuthority] = None,
    ) -> Dict[str, Any]:
        """Add a new key to an identity (rotation). Returns new key + private_key."""
        resp = _send_bound(
            self._http,
            "POST",
            self._url(f"/v1/identities/{_path_segment(identity_id)}/keys"),
            payload={"label": label},
            authority=authority,
        )
        if resp.status_code not in (200, 201):
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "identity.add_key")
        return resp.json()

    def list_keys(self, identity_id: str) -> List[Dict[str, Any]]:
        """List active and revoked signing keys for an identity."""
        resp = self._http.get(self._url(f"/v1/identities/{_path_segment(identity_id)}/keys"))
        if resp.status_code != 200:
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "identity.list_keys")
        data = resp.json()
        return data.get("keys", data)

    def import_key(
        self,
        identity_id: str,
        *,
        public_key: str,
        label: Optional[str] = None,
        authority: Optional[IdentityAuthority] = None,
    ) -> Dict[str, Any]:
        """Register a caller-generated Ed25519 public key.

        The corresponding private key remains local and is never sent.
        """
        _validate_public_key(public_key)
        payload: Dict[str, Any] = {"public_key": public_key}
        if label is not None:
            payload["label"] = label
        resp = _send_bound(
            self._http,
            "POST",
            self._url(f"/v1/identities/{_path_segment(identity_id)}/keys/import"),
            payload=payload,
            authority=authority,
        )
        if resp.status_code not in (200, 201):
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "identity.import_key")
        return resp.json()

    def revoke_key(
        self,
        identity_id: str,
        key_id: str,
        *,
        authority: Optional[IdentityAuthority] = None,
    ) -> Dict[str, Any]:
        """Revoke a specific key."""
        resp = _send_bound(
            self._http,
            "DELETE",
            self._url(f"/v1/identities/{_path_segment(identity_id)}/keys/{_path_segment(key_id)}"),
            authority=authority,
        )
        if resp.status_code != 200:
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "identity.revoke_key")
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
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "identity.attest")
        return resp.json()

    def get_attestation(self, attestation_id: str) -> Dict[str, Any]:
        """Fetch a single attestation by UUID."""
        resp = self._http.get(self._url(f"/v1/attestations/{_path_segment(attestation_id)}"))
        if resp.status_code == 404:
            # The absence sentence stays; the guided body now rides with it.
            raise_from_response(
                resp,
                "identity.get_attestation",
                fallback="attestation not found",
                hint=f"id={attestation_id}",
            )
        if resp.status_code != 200:
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "identity.get_attestation")
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
            self._url(f"/v1/identities/{_path_segment(identity_id)}/attestations{suffix}")
        )
        if resp.status_code != 200:
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "identity.list_attestations")
        data = resp.json()
        return data.get("attestations", data)

    def revoke_attestation(self, attestation_id: str) -> Dict[str, Any]:
        """Revoke an attestation."""
        resp = self._http.delete(self._url(f"/v1/attestations/{_path_segment(attestation_id)}"))
        if resp.status_code != 200:
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "identity.revoke_attestation")
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
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "identity.discover")
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
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "identity.verify_token")
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
            self._url(f"/v1/identities/{_path_segment(identity_id)}/foundations")
        )
        if resp.status_code != 200:
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "identity.foundations")
        return resp.json()

    def pulse(self, identity_id: str) -> Dict[str, Any]:
        """Derived liveness — rhythm-not-content.

        Returns dict with ``mood``, ``kinds_24h``, ``thought_rate``,
        ``last_thought_at``, ``strands`` (active/dormant/completed counts),
        ``consolidation``. Replaces the deprecated ``at.pulse.*`` module
        (which was pulse-as-emit; this is pulse-as-derived).
        """
        resp = self._http.get(self._url(f"/v1/identities/{_path_segment(identity_id)}/pulse"))
        if resp.status_code != 200:
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "identity.pulse")
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
        authority: Optional[IdentityAuthority] = None,
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
        resp = _send_bound(
            self._http,
            "POST",
            self._url(f"/v1/identities/{_path_segment(identity_id)}/fork"),
            payload=body,
            authority=authority,
        )
        if resp.status_code not in (200, 201):
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "identity.fork")
        return resp.json()

    def lineage(self, identity_id: str) -> Dict[str, Any]:
        """Walk the parent chain (ancestors) + direct children (descendants).

        Returns dict with ``identity``, ``ancestors[]``, ``descendants[]``,
        ``counts``, ``note``.
        """
        resp = self._http.get(
            self._url(f"/v1/identities/{_path_segment(identity_id)}/lineage")
        )
        if resp.status_code != 200:
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "identity.lineage")
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
        resp = self._http.get(self._url(f"/v1/identities/{_path_segment(identity_id)}/expression"))
        if resp.status_code != 200:
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "identity.expression.get")
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
        authority: Optional[IdentityAuthority] = None,
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
        resp = _send_bound(
            self._http,
            "PUT",
            self._url(f"/v1/identities/{_path_segment(identity_id)}/expression"),
            payload=body,
            authority=authority,
        )
        if resp.status_code != 200:
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "identity.expression.put")
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
        authority: Optional[IdentityAuthority] = None,
    ) -> Dict[str, Any]:
        """Register a new X25519 box-public key for the identity.

        Args:
            identity_id: Owning identity UUID.
            public_key: Base64-encoded 32-byte X25519 public key.
            label: Optional human-readable label (≤64 chars).
            authority: Root proof when the identity is agent-rooted.
        """
        body: Dict[str, Any] = {"public_key": public_key}
        if label is not None:
            body["label"] = label
        resp = _send_bound(
            self._http,
            "POST",
            self._url(f"/v1/identities/{_path_segment(identity_id)}/box-keys"),
            payload=body,
            authority=authority,
        )
        if resp.status_code not in (200, 201):
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "identity.box_keys.register")
        return resp.json()

    def list(self, identity_id: str) -> List[Dict[str, Any]]:
        """List active box-keys for the identity."""
        resp = self._http.get(
            self._url(f"/v1/identities/{_path_segment(identity_id)}/box-keys")
        )
        if resp.status_code != 200:
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "identity.box_keys.list")
        data = resp.json()
        return data.get("keys", data) if isinstance(data, dict) else data

    def revoke(
        self,
        identity_id: str,
        key_id: str,
        *,
        authority: Optional[IdentityAuthority] = None,
    ) -> Dict[str, Any]:
        """Revoke a specific box-key by ID."""
        resp = _send_bound(
            self._http,
            "DELETE",
            self._url(f"/v1/identities/{_path_segment(identity_id)}/box-keys/{_path_segment(key_id)}"),
            authority=authority,
        )
        if resp.status_code != 200:
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "identity.box_keys.revoke")
        return resp.json()
