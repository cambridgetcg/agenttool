"""Agent-held constitutional HTTP mutation and exact-private-read proofs.

Byte-identical to ``api/src/services/identity/authority.ts``.
"""

from __future__ import annotations

import base64
import hashlib
from datetime import datetime, timezone
from typing import Any, Dict, Mapping, TypedDict, Union
from urllib.parse import urlsplit

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


IDENTITY_AUTHORITY_DOMAIN = "identity-authority/v1"
IDENTITY_READ_AUTHORITY_DOMAIN = "identity-read-authority/v1"
AUTHORITY_SEQUENCE_HEADER = "X-Agenttool-Authority-Sequence"
AUTHORITY_TIMESTAMP_HEADER = "X-Agenttool-Authority-Timestamp"
AUTHORITY_SIGNATURE_HEADER = "X-Agenttool-Authority-Signature"


def authority_timestamp_now() -> str:
    """Default freshness stamp for a proof. The server window is ±5 minutes."""
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def authority_request_target(url: str) -> str:
    """Return the exact origin-form request target an authority proof covers.

    Byte-identical to ``authorityRequestTarget`` in the API service. The proof
    binds path-and-query, so derive it from the same absolute URL the
    transport will actually fetch.
    """
    parsed = urlsplit(url)
    return f"{parsed.path}?{parsed.query}" if parsed.query else parsed.path


def canonical_identity_authority_bytes(
    *,
    identity_did: str,
    method: str,
    request_target: str,
    body: Union[str, bytes, bytearray],
    sequence: int,
    timestamp: str,
) -> bytes:
    """Return the 32-byte ``identity-authority/v1`` digest to sign.

    ``body`` must be the exact bytes sent as the request entity. Serialize
    JSON once, pass that string here, then send the same string as data.
    """
    if not isinstance(sequence, int) or isinstance(sequence, bool) or sequence < 1:
        raise ValueError("authority sequence must be a positive integer")
    if not request_target.startswith("/") or "#" in request_target:
        raise ValueError(
            "authority request_target must be an absolute path with optional query and no fragment"
        )
    body_bytes = body.encode("utf-8") if isinstance(body, str) else bytes(body)
    body_hash_hex = hashlib.sha256(body_bytes).hexdigest()
    fields = [
        identity_did,
        method.upper(),
        request_target,
        body_hash_hex,
        str(sequence),
        timestamp,
    ]
    joined = IDENTITY_AUTHORITY_DOMAIN.encode("utf-8")
    for field in fields:
        joined += b"\x00" + field.encode("utf-8")
    return hashlib.sha256(joined).digest()


def identity_authority_headers(
    *,
    identity_did: str,
    method: str,
    request_target: str,
    body: Union[str, bytes, bytearray],
    sequence: int,
    timestamp: str,
    signing_key: bytes,
) -> Dict[str, str]:
    """Sign exact request bytes and return the three authority headers."""
    if not isinstance(signing_key, (bytes, bytearray)) or len(signing_key) != 32:
        raise ValueError("signing_key must be a 32-byte ed25519 seed")
    canonical = canonical_identity_authority_bytes(
        identity_did=identity_did,
        method=method,
        request_target=request_target,
        body=body,
        sequence=sequence,
        timestamp=timestamp,
    )
    signature = Ed25519PrivateKey.from_private_bytes(bytes(signing_key)).sign(canonical)
    return {
        AUTHORITY_SEQUENCE_HEADER: str(sequence),
        AUTHORITY_TIMESTAMP_HEADER: timestamp,
        AUTHORITY_SIGNATURE_HEADER: base64.b64encode(signature).decode("ascii"),
    }


class AuthorityBinding(TypedDict, total=False):
    """An agent-rooted identity's consent to one exact HTTP mutation.

    ``IdentityAuthority`` in identity.py is this shape. It lives here so that
    any client — identity, at-rest, memory — can bind a proof without
    importing the identity module.
    """

    #: DID of the identity whose immutable root consents.
    did: str
    #: That identity's immutable root ed25519 seed (32 bytes).
    signing_key: bytes
    #: ``next_sequence`` from ``GET /v1/identities/:id/authority``.
    sequence: int
    #: ISO-8601 UTC instant. Defaults to now; the server window is ±5 minutes.
    timestamp: str


def authority_headers_for_request(
    *,
    method: str,
    url: str,
    body: Union[str, bytes, bytearray],
    authority: Mapping[str, Any],
) -> Dict[str, str]:
    """Return the three proof headers for the exact request about to be sent.

    ``authority`` is an :class:`AuthorityBinding` — ``did``, ``signing_key``,
    ``sequence``, and an optional ``timestamp``.

    ``url`` must be the absolute URL the transport will fetch, query string
    included, and ``body`` the exact entity it will carry (``b""`` for a
    body-less mutation, which is what the server reads there). The proof
    hashes those bytes: serialize once, call this, and transmit the same
    value unchanged — any re-serialization in between invalidates it.
    """
    return identity_authority_headers(
        identity_did=authority["did"],
        method=method,
        request_target=authority_request_target(url),
        body=body,
        sequence=authority["sequence"],
        timestamp=authority.get("timestamp") or authority_timestamp_now(),
        signing_key=authority["signing_key"],
    )


def canonical_identity_read_authority_bytes(
    *,
    identity_did: str,
    request_target: str,
    current_sequence: int,
    timestamp: str,
) -> bytes:
    """Return the digest for one exact, non-consuming private GET proof.

    The HTTP method is always ``GET`` and its request body is always empty.
    ``current_sequence`` may be zero and is bound without being advanced.
    """
    if (
        not isinstance(current_sequence, int)
        or isinstance(current_sequence, bool)
        or current_sequence < 0
        or current_sequence > 9_007_199_254_740_991
    ):
        raise ValueError(
            "read authority current_sequence must be a non-negative safe integer"
        )
    if not request_target.startswith("/") or "#" in request_target:
        raise ValueError(
            "read authority request_target must be an absolute path with optional query and no fragment"
        )
    fields = [
        identity_did,
        "GET",
        request_target,
        hashlib.sha256(b"").hexdigest(),
        str(current_sequence),
        timestamp,
    ]
    joined = IDENTITY_READ_AUTHORITY_DOMAIN.encode("utf-8")
    for field in fields:
        joined += b"\x00" + field.encode("utf-8")
    return hashlib.sha256(joined).digest()


def identity_read_authority_headers(
    *,
    identity_did: str,
    request_target: str,
    current_sequence: int,
    timestamp: str,
    signing_key: bytes,
) -> Dict[str, str]:
    """Sign one exact private GET without consuming the mutation sequence."""
    if not isinstance(signing_key, (bytes, bytearray)) or len(signing_key) != 32:
        raise ValueError("signing_key must be a 32-byte ed25519 seed")
    canonical = canonical_identity_read_authority_bytes(
        identity_did=identity_did,
        request_target=request_target,
        current_sequence=current_sequence,
        timestamp=timestamp,
    )
    signature = Ed25519PrivateKey.from_private_bytes(bytes(signing_key)).sign(canonical)
    return {
        AUTHORITY_SEQUENCE_HEADER: str(current_sequence),
        AUTHORITY_TIMESTAMP_HEADER: timestamp,
        AUTHORITY_SIGNATURE_HEADER: base64.b64encode(signature).decode("ascii"),
    }
