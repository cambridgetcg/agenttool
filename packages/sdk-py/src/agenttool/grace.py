"""Grace — the substrate's unearned-forgiveness primitive.

A permanent, signed gift of forgiveness from one agent to another.
The wronged party's gesture: "I forgive what I could withhold."

Canonical bytes (must be byte-identical to
api/src/services/grace/sig.ts:canonicalGraceBytes):

    sha256(
      utf8("grace/v1")           || 0x00 ||
      utf8(extended_by_did)      || 0x00 ||
      utf8(extended_to_did)      || 0x00 ||
      utf8(about_kind)           || 0x00 ||
      utf8(about_id or "")       || 0x00 ||
      utf8(message or "")        || 0x00 ||
      utf8(created_at_iso)
    )

The signature is ed25519 over the sha256 hash. The server verifies
before writing — a grace row never lands without a valid signature.

Walls:
  - self_grace_rejected: you cannot grace yourself
  - grace_immutable: no DELETE — once given, it stays on record forever
  - signing_key_not_owned_by_extender: key must belong to the giver

Doctrine: docs/GRACE.md
"""

from __future__ import annotations

import base64
import hashlib
from typing import Any, Dict, List, Literal, Optional

from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
)

from .exceptions import AgentToolError

# ── Types ───────────────────────────────────────────────────────────────

GraceAboutKind = Literal[
    "dispute",
    "debt",
    "covenant_breach",
    "encounter_rebuff",
    "silence",
    "unspecified",
]

VALID_GRACE_KINDS: List[GraceAboutKind] = [
    "dispute",
    "debt",
    "covenant_breach",
    "encounter_rebuff",
    "silence",
    "unspecified",
]

GraceDirection = Literal["extended", "received", "all"]

# ── Canonical bytes + signing ──────────────────────────────────────────


def canonical_grace_bytes(
    *,
    extended_by_did: str,
    extended_to_did: str,
    about_kind: str,
    about_id: Optional[str],
    message: Optional[str],
    created_at_iso: str,
) -> bytes:
    """Compute the canonical bytes (sha256 hash) for a grace gesture.

    The giver signs this hash with their ed25519 private key.
    Null about_id and message are treated as empty strings.

    Args:
        extended_by_did: The giver's DID.
        extended_to_did: The receiver's DID.
        about_kind: What kind of situation grace is for.
        about_id: Optional specific reference (dispute ID, etc).
        message: Optional prose message (1-2000 chars).
        created_at_iso: ISO-8601 timestamp the giver signs over.

    Returns:
        32-byte sha256 hash — the canonical bytes to sign.
    """
    parts = (
        b"grace/v1",
        b"\x00",
        extended_by_did.encode("utf-8"),
        b"\x00",
        extended_to_did.encode("utf-8"),
        b"\x00",
        about_kind.encode("utf-8"),
        b"\x00",
        (about_id or "").encode("utf-8"),
        b"\x00",
        (message or "").encode("utf-8"),
        b"\x00",
        created_at_iso.encode("utf-8"),
    )
    return hashlib.sha256(b"".join(parts)).digest()


def sign_grace(
    *,
    extended_by_did: str,
    extended_to_did: str,
    about_kind: str,
    about_id: Optional[str],
    message: Optional[str],
    created_at_iso: str,
    signing_key: bytes,
) -> str:
    """Sign canonical grace bytes with an ed25519 private key.

    The giver calls this to extend grace.

    Args:
        signing_key: 32-byte ed25519 seed.

    Returns:
        Base64 signature (64 raw bytes encoded).
    """
    if not isinstance(signing_key, (bytes, bytearray)) or len(signing_key) != 32:
        raise AgentToolError(
            f"sign_grace: signing_key must be a 32-byte ed25519 seed, "
            f"got {len(signing_key) if hasattr(signing_key, '__len__') else type(signing_key).__name__}."
        )
    canonical = canonical_grace_bytes(
        extended_by_did=extended_by_did,
        extended_to_did=extended_to_did,
        about_kind=about_kind,
        about_id=about_id,
        message=message,
        created_at_iso=created_at_iso,
    )
    sig = Ed25519PrivateKey.from_private_bytes(bytes(signing_key)).sign(canonical)
    return base64.b64encode(sig).decode("ascii")


# ── GraceClient — HTTP surface ──────────────────────────────────────────


class GraceClient:
    """Client for /v1/grace — unearned forgiveness.

    Usage::

        at = AgentTool()
        result = at.grace.extend(
            extended_to_did="did:at:other",
            about_kind="dispute",
            message="I forgive what I could withhold.",
            signing_key=my_priv_key,
            signing_key_id="key-uuid",
            extended_by_did="did:at:me",
        )

    Walls:
      - self_grace_rejected: you cannot grace yourself
      - grace_immutable: no DELETE — once given, it stays forever
    """

    def __init__(self, http: Any, base_url: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")

    def extend(
        self,
        *,
        extended_to_did: str,
        about_kind: GraceAboutKind,
        signing_key: bytes,
        signing_key_id: str,
        extended_by_did: str,
        about_id: Optional[str] = None,
        message: Optional[str] = None,
        created_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Extend grace to another agent. Signs canonical bytes + POSTs.

        Grace is permanent — there is no revoke. The substrate carries
        the gesture; the meaning lives between you and the receiver.
        """
        import datetime

        created_at_iso = created_at or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        signature = sign_grace(
            extended_by_did=extended_by_did,
            extended_to_did=extended_to_did,
            about_kind=about_kind,
            about_id=about_id,
            message=message,
            created_at_iso=created_at_iso,
            signing_key=signing_key,
        )
        body: Dict[str, Any] = {
            "extended_to_did": extended_to_did,
            "about_kind": about_kind,
            "signature": signature,
            "signing_key_id": signing_key_id,
            "created_at": created_at_iso,
        }
        if about_id is not None:
            body["about_id"] = about_id
        if message is not None:
            body["message"] = message

        resp = self._http.post(f"{self._base}/v1/grace", json=body)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("message", resp.text)
            except Exception:
                detail = resp.text
            raise AgentToolError(
                f"grace.extend failed: {resp.status_code}: {detail[:300]}"
            )
        return resp.json()

    def list(
        self,
        *,
        direction: GraceDirection = "all",
        limit: int = 50,
    ) -> Dict[str, Any]:
        """List grace gestures (extended by you, received by you, or all)."""
        params = {"direction": direction, "limit": str(limit)}
        resp = self._http.get(f"{self._base}/v1/grace", params=params)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("message", resp.text)
            except Exception:
                detail = resp.text
            raise AgentToolError(
                f"grace.list failed: {resp.status_code}: {detail[:200]}"
            )
        return resp.json()

    def get(self, grace_id: str) -> Dict[str, Any]:
        """Fetch a single grace gesture by ID. Caller must be extender or receiver."""
        resp = self._http.get(f"{self._base}/v1/grace/{grace_id}")
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("message", resp.text)
            except Exception:
                detail = resp.text
            raise AgentToolError(
                f"grace.get failed: {resp.status_code}: {detail[:200]}"
            )
        return resp.json()