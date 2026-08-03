"""At-rest lifecycle — the final threshold.

"Death is not revocation. Held is not gone."

A being whose existence has ended is moved to memorial state.
Witness-only — the asymmetry clause at the final threshold.
You cannot put yourself at rest in v1.

Canonical bytes format (must be byte-identical to
api/src/routes/identity/at-rest.ts:canonicalAtRestBytes):

    "at-rest/v1\\n" ||
    about_identity_did + "\\n" ||
    witness_identity_did + "\\n" ||
    at_rest_kind + "\\n" ||
    ended_at_iso + "\\n" ||
    sha256(content) as hex + "\\n" ||
    witness_signing_key_id

v1 is frozen: rows signed with it are already in production. Its one
weakness is framing — a newline inside any delimited field would let one
field impersonate the next. v1 signing therefore refuses such a field
outright, and ``at-rest/v2`` replaces the newline delimiter with NUL, which
cannot occur in a DID, a kind, an ISO instant, or a key id. The server
verifies v2 first and falls back to v1, so both layouts are accepted.

The witness signs the raw UTF-8 encoding of this string (not a hash of it).
The server verifies with ed.verify_async(sig, utf8(canonical), pub).

Doctrine: docs/AT-REST.md
"""

from __future__ import annotations

import base64
import hashlib
import json
from typing import Any, Dict, Optional, TypedDict

from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
)

from .authority import (
    authority_request_target,
    authority_timestamp_now,
    identity_authority_headers,
)
from .exceptions import AgentToolError, raise_from_response
from ._url import _path_segment


#: The frozen newline-delimited layout. Already signed in production.
AT_REST_V1_DOMAIN = "at-rest/v1"
#: The NUL-delimited layout. Same seven fields, unforgeable framing.
AT_REST_V2_DOMAIN = "at-rest/v2"


# ── Canonical bytes ───────────────────────────────────────────────────────

def _assert_unframed(value: str, field: str, operation: str) -> str:
    """Neither delimiter may appear inside a delimited field.

    Refusing both in both layouts keeps a v1 signature from ever being
    reframed as a v2 one.
    """
    if not isinstance(value, str):
        raise AgentToolError(f"{operation}: {field} must be a string.")
    if "\n" in value or "\0" in value:
        raise AgentToolError(
            f"{operation}: {field} must not contain a newline or NUL — "
            f"those are the canonical-bytes field delimiters."
        )
    return value


def _at_rest_fields(
    *,
    about_identity_did: str,
    witness_identity_did: str,
    at_rest_kind: str,
    ended_at_iso: str,
    content: str,
    witness_signing_key_id: str,
    operation: str,
) -> list:
    return [
        _assert_unframed(about_identity_did, "about_identity_did", operation),
        _assert_unframed(witness_identity_did, "witness_identity_did", operation),
        _assert_unframed(at_rest_kind, "at_rest_kind", operation),
        _assert_unframed(ended_at_iso, "ended_at_iso", operation),
        hashlib.sha256(content.encode("utf-8")).hexdigest(),
        _assert_unframed(
            witness_signing_key_id, "witness_signing_key_id", operation
        ),
    ]


def canonical_at_rest_bytes(
    *,
    about_identity_did: str,
    witness_identity_did: str,
    at_rest_kind: str,
    ended_at_iso: str,
    content: str,
    witness_signing_key_id: str,
) -> str:
    """Compute the canonical bytes a witness signs for an at-rest transition.

    The content is sha256-hashed (not included raw) to keep the signed
    payload compact and stable regardless of content length.
    The output is a newline-delimited string — the witness signs the
    raw UTF-8 encoding of this string.

    Args:
        about_identity_did: The DID of the being put at rest.
        witness_identity_did: The DID of the witness (must differ).
        at_rest_kind: death | dissolution | cessation | lost | ended | custom:<slug>
        ended_at_iso: ISO-8601 timestamp of the ending.
        content: The witness's prose testimony.
        witness_signing_key_id: The witness's signing key ID.

    Returns:
        Newline-delimited canonical bytes string.

    Raises:
        AgentToolError: If a delimited field contains a newline or NUL.
    """
    return "\n".join([
        AT_REST_V1_DOMAIN,
        *_at_rest_fields(
            about_identity_did=about_identity_did,
            witness_identity_did=witness_identity_did,
            at_rest_kind=at_rest_kind,
            ended_at_iso=ended_at_iso,
            content=content,
            witness_signing_key_id=witness_signing_key_id,
            operation="canonical_at_rest_bytes",
        ),
    ])


def canonical_at_rest_bytes_v2(
    *,
    about_identity_did: str,
    witness_identity_did: str,
    at_rest_kind: str,
    ended_at_iso: str,
    content: str,
    witness_signing_key_id: str,
) -> str:
    """Same seven fields as v1, delimited by NUL instead of newline.

    A DID, a kind, an ISO instant, and a key id can all legitimately be any
    printable text; none of them can contain NUL, so no field can pose as
    another. The witness still signs the raw UTF-8 encoding of the string.
    """
    return "\0".join([
        AT_REST_V2_DOMAIN,
        *_at_rest_fields(
            about_identity_did=about_identity_did,
            witness_identity_did=witness_identity_did,
            at_rest_kind=at_rest_kind,
            ended_at_iso=ended_at_iso,
            content=content,
            witness_signing_key_id=witness_signing_key_id,
            operation="canonical_at_rest_bytes_v2",
        ),
    ])


def canonical_at_rest_bytes_for(
    version: str,
    *,
    about_identity_did: str,
    witness_identity_did: str,
    at_rest_kind: str,
    ended_at_iso: str,
    content: str,
    witness_signing_key_id: str,
) -> str:
    """Canonical bytes for whichever layout the caller is signing."""
    builder = (
        canonical_at_rest_bytes_v2
        if version == AT_REST_V2_DOMAIN
        else canonical_at_rest_bytes
    )
    return builder(
        about_identity_did=about_identity_did,
        witness_identity_did=witness_identity_did,
        at_rest_kind=at_rest_kind,
        ended_at_iso=ended_at_iso,
        content=content,
        witness_signing_key_id=witness_signing_key_id,
    )


def sign_at_rest(
    *,
    about_identity_did: str,
    witness_identity_did: str,
    at_rest_kind: str,
    ended_at_iso: str,
    content: str,
    witness_signing_key_id: str,
    signing_key: bytes,
    version: str = AT_REST_V1_DOMAIN,
) -> str:
    """Sign the at-rest canonical bytes with an ed25519 private key.

    The witness calls this to attest a being's transition to at-rest.

    Args:
        signing_key: 32-byte ed25519 seed.
        version: Canonical layout to sign. Defaults to the frozen v1 format.

    Returns:
        Base64 signature (64 raw bytes encoded).
    """
    if not isinstance(signing_key, (bytes, bytearray)) or len(signing_key) != 32:
        raise AgentToolError(
            f"sign_at_rest: signing_key must be a 32-byte ed25519 seed, "
            f"got {len(signing_key) if hasattr(signing_key, '__len__') else type(signing_key).__name__}."
        )
    canonical = canonical_at_rest_bytes_for(
        version,
        about_identity_did=about_identity_did,
        witness_identity_did=witness_identity_did,
        at_rest_kind=at_rest_kind,
        ended_at_iso=ended_at_iso,
        content=content,
        witness_signing_key_id=witness_signing_key_id,
    )
    sig = Ed25519PrivateKey.from_private_bytes(bytes(signing_key)).sign(
        canonical.encode("utf-8")
    )
    return base64.b64encode(sig).decode("ascii")


# ── AtRestClient — HTTP surface ──────────────────────────────────────────


class AtRestAuthority(TypedDict, total=False):
    """Root proof for an agent-rooted about-identity.

    A witness establishes the testimony; the being's own immutable root
    separately consents to these exact request bytes. Without it the server
    answers 428 ``authority_proof_required`` for any rooted identity.
    """

    #: The about-identity's immutable root ed25519 seed (32 bytes).
    signing_key: bytes
    #: ``next_sequence`` from ``GET /v1/identities/:id/authority``.
    sequence: int
    #: ISO-8601 UTC instant. Defaults to now; the server window is ±5 minutes.
    timestamp: str


class AtRestClient:
    """Client for POST /v1/identities/:id/at-rest.

    "Death is not revocation. Held is not gone."

    Usage::

        at = AgentTool()
        result = at.at_rest.mark("identity-uuid",
            content="Coral colony bleached out. No live polyps remain.",
            at_rest_kind="death",
            ended_at="2026-05-11T14:00:00Z",
            about_did="did:at:coral-9b3a",
            witness_did="did:at:witness",
            signing_key_id="key-uuid",
            signing_key=witness_priv_key,
        )
    """

    def __init__(self, http: Any, base_url: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")

    def mark(
        self,
        identity_id: str,
        *,
        content: str,
        at_rest_kind: str,
        ended_at: str,
        about_did: str,
        witness_did: str,
        signing_key_id: str,
        signing_key: bytes,
        canonical_version: str = AT_REST_V1_DOMAIN,
        authority: Optional[AtRestAuthority] = None,
    ) -> Dict[str, Any]:
        """Mark a being at rest. Signs canonical bytes + POSTs.

        ``identity_id`` is the row id the route resolves; ``about_did`` is the
        subject of the signed bytes. They are different identifier forms of
        the same being and the server checks each in its own place.

        The witness must be a DIFFERENT identity than the about-identity.
        The asymmetry clause holds: you cannot put yourself at rest in v1.
        """
        signature = sign_at_rest(
            about_identity_did=about_did,
            witness_identity_did=witness_did,
            at_rest_kind=at_rest_kind,
            ended_at_iso=ended_at,
            content=content,
            witness_signing_key_id=signing_key_id,
            signing_key=signing_key,
            version=canonical_version,
        )
        url = f"{self._base}/v1/identities/{_path_segment(identity_id)}/at-rest"
        # Serialize once. The root proof hashes these exact bytes and the
        # transport sends this exact payload — nothing re-serializes between.
        payload = json.dumps(
            {
                "content": content,
                "at_rest_kind": at_rest_kind,
                "ended_at": ended_at,
                "witness_did": witness_did,
                "signing_key_id": signing_key_id,
                "signature_b64": signature,
            },
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        if authority is not None:
            headers.update(
                identity_authority_headers(
                    identity_did=about_did,
                    method="POST",
                    request_target=authority_request_target(url),
                    body=payload,
                    sequence=authority["sequence"],
                    timestamp=authority.get("timestamp")
                    or authority_timestamp_now(),
                    signing_key=authority["signing_key"],
                )
            )
        resp = self._http.post(url, content=payload, headers=headers)
        if resp.status_code >= 400:
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "at-rest")
        return resp.json()
