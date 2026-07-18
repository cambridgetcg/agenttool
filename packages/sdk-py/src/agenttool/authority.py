"""Agent-held constitutional HTTP mutation and exact-private-read proofs.

Byte-identical to ``api/src/services/identity/authority.ts``.
"""

from __future__ import annotations

import base64
import hashlib
from typing import Dict, Union

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


IDENTITY_AUTHORITY_DOMAIN = "identity-authority/v1"
IDENTITY_READ_AUTHORITY_DOMAIN = "identity-read-authority/v1"
AUTHORITY_SEQUENCE_HEADER = "X-Agenttool-Authority-Sequence"
AUTHORITY_TIMESTAMP_HEADER = "X-Agenttool-Authority-Timestamp"
AUTHORITY_SIGNATURE_HEADER = "X-Agenttool-Authority-Signature"


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
