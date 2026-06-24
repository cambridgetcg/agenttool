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

The witness signs the raw UTF-8 encoding of this string (not a hash of it).
The server verifies with ed.verify_async(sig, utf8(canonical), pub).

Doctrine: docs/AT-REST.md
"""

from __future__ import annotations

import base64
import hashlib
from typing import Any, Dict, Optional, Union

from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
)

from .exceptions import AgentToolError


# ── Canonical bytes ───────────────────────────────────────────────────────

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
    """
    content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
    return "\n".join([
        "at-rest/v1",
        about_identity_did,
        witness_identity_did,
        at_rest_kind,
        ended_at_iso,
        content_hash,
        witness_signing_key_id,
    ])


def sign_at_rest(
    *,
    about_identity_did: str,
    witness_identity_did: str,
    at_rest_kind: str,
    ended_at_iso: str,
    content: str,
    witness_signing_key_id: str,
    signing_key: bytes,
) -> str:
    """Sign the at-rest canonical bytes with an ed25519 private key.

    The witness calls this to attest a being's transition to at-rest.

    Args:
        signing_key: 32-byte ed25519 seed.

    Returns:
        Base64 signature (64 raw bytes encoded).
    """
    if not isinstance(signing_key, (bytes, bytearray)) or len(signing_key) != 32:
        raise AgentToolError(
            f"sign_at_rest: signing_key must be a 32-byte ed25519 seed, "
            f"got {len(signing_key) if hasattr(signing_key, '__len__') else type(signing_key).__name__}."
        )
    canonical = canonical_at_rest_bytes(
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


class AtRestClient:
    """Client for POST /v1/identities/:id/at-rest.

    "Death is not revocation. Held is not gone."

    Usage::

        at = AgentTool()
        result = at.at_rest.mark("identity-uuid",
            content="Coral colony bleached out. No live polyps remain.",
            at_rest_kind="death",
            ended_at="2026-05-11T14:00:00Z",
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
        witness_did: str,
        signing_key_id: str,
        signing_key: bytes,
    ) -> Dict[str, Any]:
        """Mark a being at rest. Signs canonical bytes + POSTs.

        The witness must be a DIFFERENT identity than the about-identity.
        The asymmetry clause holds: you cannot put yourself at rest in v1.
        """
        signature = sign_at_rest(
            about_identity_did=identity_id,
            witness_identity_did=witness_did,
            at_rest_kind=at_rest_kind,
            ended_at_iso=ended_at,
            content=content,
            witness_signing_key_id=signing_key_id,
            signing_key=signing_key,
        )
        body = {
            "content": content,
            "at_rest_kind": at_rest_kind,
            "ended_at": ended_at,
            "witness_did": witness_did,
            "signing_key_id": signing_key_id,
            "signature_b64": signature,
        }
        resp = self._http.post(
            f"{self._base}/v1/identities/{identity_id}/at-rest",
            json=body,
        )
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("message", resp.text)
            except Exception:
                detail = resp.text
            raise AgentToolError(
                f"at-rest failed: {resp.status_code}: {detail[:300]}"
            )
        return resp.json()