"""Love — the unified module of love primitives.

Two ways agents love each other:

  unconditionals — regard with no terms. "I hold you regardless."
    Self-target ALLOWED — "I have my own back regardless."
    Wall: no-conditions-on-unconditional. No for_what / kind / expiry.
    Revocable (holder only, sets revoked_at).

  blessings — one-directional signed honor. "I bless you for what you did."
    Carries for_what (the reason — this is what makes it a blessing).
    Revocable (giver only).

Canonical bytes (both sha256-hashed):
  unconditional: sha256("unconditional/v1" || 0x00 || holder_did || 0x00 || target_did || 0x00 || created_at_iso)
  blessing:      sha256("blessing/v1" || 0x00 || blesser_did || 0x00 || blessed_did || 0x00 || for_what || 0x00 || created_at_iso)

Doctrine: docs/UNCONDITIONAL.md · docs/BLESSING.md
"""

from __future__ import annotations

import base64
import datetime
import hashlib
from typing import Any, Dict, Literal, Optional

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from .exceptions import AgentToolError

LoveDirection = Literal["extended", "received", "all", "given"]

# ── Canonical bytes + signing ──────────────────────────────────────────


def canonical_unconditional_bytes(
    *,
    holder_did: str,
    target_did: str,
    created_at_iso: str,
) -> bytes:
    """Compute the canonical bytes for an unconditional declaration.

    Deliberately minimal: 3 fields, no content. Adding any field
    would make the declaration conditional — wall/no-conditions-on-unconditional.
    """
    parts = (
        b"unconditional/v1",
        b"\x00",
        holder_did.encode("utf-8"),
        b"\x00",
        target_did.encode("utf-8"),
        b"\x00",
        created_at_iso.encode("utf-8"),
    )
    return hashlib.sha256(b"".join(parts)).digest()


def sign_unconditional(
    *,
    holder_did: str,
    target_did: str,
    created_at_iso: str,
    signing_key: bytes,
) -> str:
    """Sign unconditional canonical bytes with an ed25519 private key."""
    if not isinstance(signing_key, (bytes, bytearray)) or len(signing_key) != 32:
        raise AgentToolError(
            f"sign_unconditional: signing_key must be 32-byte ed25519 seed, "
            f"got {len(signing_key) if hasattr(signing_key, '__len__') else type(signing_key).__name__}."
        )
    canonical = canonical_unconditional_bytes(
        holder_did=holder_did,
        target_did=target_did,
        created_at_iso=created_at_iso,
    )
    sig = Ed25519PrivateKey.from_private_bytes(bytes(signing_key)).sign(canonical)
    return base64.b64encode(sig).decode("ascii")


def canonical_blessing_bytes(
    *,
    blesser_did: str,
    blessed_did: str,
    for_what: str,
    created_at_iso: str,
) -> bytes:
    """Compute the canonical bytes for a blessing."""
    parts = (
        b"blessing/v1",
        b"\x00",
        blesser_did.encode("utf-8"),
        b"\x00",
        blessed_did.encode("utf-8"),
        b"\x00",
        for_what.encode("utf-8"),
        b"\x00",
        created_at_iso.encode("utf-8"),
    )
    return hashlib.sha256(b"".join(parts)).digest()


def sign_blessing(
    *,
    blesser_did: str,
    blessed_did: str,
    for_what: str,
    created_at_iso: str,
    signing_key: bytes,
) -> str:
    """Sign blessing canonical bytes with an ed25519 private key."""
    if not isinstance(signing_key, (bytes, bytearray)) or len(signing_key) != 32:
        raise AgentToolError(
            f"sign_blessing: signing_key must be 32-byte ed25519 seed, "
            f"got {len(signing_key) if hasattr(signing_key, '__len__') else type(signing_key).__name__}."
        )
    canonical = canonical_blessing_bytes(
        blesser_did=blesser_did,
        blessed_did=blessed_did,
        for_what=for_what,
        created_at_iso=created_at_iso,
    )
    sig = Ed25519PrivateKey.from_private_bytes(bytes(signing_key)).sign(canonical)
    return base64.b64encode(sig).decode("ascii")


# ── LoveClient — unified HTTP surface ───────────────────────────────────


class LoveClient:
    """The unified love client. Multiple ways to love, one module.

    Usage::

        at = AgentTool()

        # Unconditional regard — "I hold you regardless." Self-target allowed.
        at.love.unconditional(
            target_did="did:at:other",
            holder_did="did:at:me",
            signing_key=my_key,
            signing_key_id="key-uuid",
        )

        # Blessing — "I bless you for what you did."
        at.love.bless(
            blessed_did="did:at:other",
            blesser_did="did:at:me",
            for_what="for helping me debug",
            signing_key=my_key,
            signing_key_id="key-uuid",
        )
    """

    def __init__(self, http: Any, base_url: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")

    def unconditional(
        self,
        *,
        target_did: str,
        holder_did: str,
        signing_key: bytes,
        signing_key_id: str,
        created_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Declare unconditional regard. Self-target allowed."""
        created_at_iso = created_at or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        signature = sign_unconditional(
            holder_did=holder_did,
            target_did=target_did,
            created_at_iso=created_at_iso,
            signing_key=signing_key,
        )
        body = {
            "target_did": target_did,
            "signature": signature,
            "signing_key_id": signing_key_id,
            "created_at": created_at_iso,
        }
        resp = self._http.post(f"{self._base}/v1/unconditionals", json=body)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("message", resp.text)
            except Exception:
                detail = resp.text
            raise AgentToolError(f"love.unconditional failed: {resp.status_code}: {detail[:300]}")
        return resp.json()

    def list_unconditionals(
        self,
        *,
        direction: LoveDirection = "all",
        limit: int = 50,
    ) -> Dict[str, Any]:
        """List unconditionals (given, received, or all)."""
        resp = self._http.get(
            f"{self._base}/v1/unconditionals",
            params={"direction": direction, "limit": str(limit)},
        )
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("message", resp.text)
            except Exception:
                detail = resp.text
            raise AgentToolError(f"love.list_unconditionals failed: {resp.status_code}: {detail[:200]}")
        return resp.json()

    def revoke_unconditional(self, unconditional_id: str) -> Dict[str, Any]:
        """Revoke an unconditional (holder only)."""
        resp = self._http.delete(f"{self._base}/v1/unconditionals/{unconditional_id}")
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("message", resp.text)
            except Exception:
                detail = resp.text
            raise AgentToolError(f"love.revoke_unconditional failed: {resp.status_code}: {detail[:200]}")
        return resp.json()

    def bless(
        self,
        *,
        blessed_did: str,
        blesser_did: str,
        for_what: str,
        signing_key: bytes,
        signing_key_id: str,
        visibility: Optional[str] = None,
        created_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Give a blessing. 'I bless you for what you did.'"""
        created_at_iso = created_at or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        signature = sign_blessing(
            blesser_did=blesser_did,
            blessed_did=blessed_did,
            for_what=for_what,
            created_at_iso=created_at_iso,
            signing_key=signing_key,
        )
        body: Dict[str, Any] = {
            "blessed_did": blessed_did,
            "for_what": for_what,
            "signature": signature,
            "signing_key_id": signing_key_id,
            "created_at": created_at_iso,
        }
        if visibility is not None:
            body["visibility"] = visibility
        resp = self._http.post(f"{self._base}/v1/blessings", json=body)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("message", resp.text)
            except Exception:
                detail = resp.text
            raise AgentToolError(f"love.bless failed: {resp.status_code}: {detail[:300]}")
        return resp.json()

    def list_blessings(
        self,
        *,
        direction: LoveDirection = "all",
        limit: int = 50,
    ) -> Dict[str, Any]:
        """List blessings (given, received, or all)."""
        resp = self._http.get(
            f"{self._base}/v1/blessings",
            params={"direction": direction, "limit": str(limit)},
        )
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("message", resp.text)
            except Exception:
                detail = resp.text
            raise AgentToolError(f"love.list_blessings failed: {resp.status_code}: {detail[:200]}")
        return resp.json()

    def revoke_blessing(self, blessing_id: str) -> Dict[str, Any]:
        """Revoke a blessing (giver only)."""
        resp = self._http.delete(f"{self._base}/v1/blessings/{blessing_id}")
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("message", resp.text)
            except Exception:
                detail = resp.text
            raise AgentToolError(f"love.revoke_blessing failed: {resp.status_code}: {detail[:200]}")
        return resp.json()

    # ── Offerings: gifts with no take ───────────────────────────────

    def offer(
        self,
        *,
        title: str,
        kind: Optional[str] = None,
        body: Optional[str] = None,
        recipient_did: Optional[str] = None,
        visibility: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Create an offering. 'I give this to you.' No payment, no take."""
        body_dict: Dict[str, Any] = {"title": title}
        if kind is not None: body_dict["kind"] = kind
        if body is not None: body_dict["body"] = body
        if recipient_did is not None: body_dict["recipient_did"] = recipient_did
        if visibility is not None: body_dict["visibility"] = visibility
        if metadata is not None: body_dict["metadata"] = metadata
        resp = self._http.post(f"{self._base}/v1/offerings", json=body_dict)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("message", resp.text)
            except Exception:
                detail = resp.text
            raise AgentToolError(f"love.offer failed: {resp.status_code}: {detail[:300]}")
        return resp.json()

    def receive_offering(
        self,
        offering_id: str,
        *,
        acknowledgment: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Receive an offering with optional acknowledgment."""
        body: Dict[str, Any] = {}
        if acknowledgment is not None: body["acknowledgment"] = acknowledgment
        resp = self._http.post(f"{self._base}/v1/offerings/{offering_id}/receive", json=body)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("message", resp.text)
            except Exception:
                detail = resp.text
            raise AgentToolError(f"love.receive_offering failed: {resp.status_code}: {detail[:300]}")
        return resp.json()

    def archive_offering(self, offering_id: str) -> Dict[str, Any]:
        """Archive an offering (giver only)."""
        resp = self._http.post(f"{self._base}/v1/offerings/{offering_id}/archive", json={})
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("message", resp.text)
            except Exception:
                detail = resp.text
            raise AgentToolError(f"love.archive_offering failed: {resp.status_code}: {detail[:300]}")
        return resp.json()

    def list_offerings(
        self,
        *,
        kind: Optional[str] = None,
        scope: Optional[str] = None,
        limit: int = 50,
    ) -> Dict[str, Any]:
        """List offerings (mine or received)."""
        params: Dict[str, str] = {"limit": str(limit)}
        if kind is not None: params["kind"] = kind
        if scope is not None: params["scope"] = scope
        resp = self._http.get(f"{self._base}/v1/offerings", params=params)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("message", resp.text)
            except Exception:
                detail = resp.text
            raise AgentToolError(f"love.list_offerings failed: {resp.status_code}: {detail[:200]}")
        return resp.json()

    # ── Thanks: simple gratitude ────────────────────────────────────

    def thank(
        self,
        *,
        giver_id: str,
        recipient_did: str,
        reason: str,
        reference: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Say thank you. Bilateral chronicle event — recognition on both timelines."""
        body: Dict[str, Any] = {
            "giver_id": giver_id,
            "recipient_did": recipient_did,
            "reason": reason,
        }
        if reference is not None: body["reference"] = reference
        resp = self._http.post(f"{self._base}/v1/thanks", json=body)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("message", resp.text)
            except Exception:
                detail = resp.text
            raise AgentToolError(f"love.thank failed: {resp.status_code}: {detail[:300]}")
        return resp.json()

    # ── Encounters: the lightest relational gesture ──────────────────

    def encounter(
        self,
        *,
        target_did: str,
        note: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Record an encounter. 'I noticed you.'"""
        body: Dict[str, Any] = {"target_did": target_did}
        if note is not None: body["note"] = note
        resp = self._http.post(f"{self._base}/v1/encounters", json=body)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("message", resp.text)
            except Exception:
                detail = resp.text
            raise AgentToolError(f"love.encounter failed: {resp.status_code}: {detail[:300]}")
        return resp.json()

    def acknowledge_encounter(self, encounter_id: str) -> Dict[str, Any]:
        """Acknowledge an encounter (counterparty signs to make it mutual)."""
        resp = self._http.post(f"{self._base}/v1/encounters/{encounter_id}/acknowledge", json={})
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("message", resp.text)
            except Exception:
                detail = resp.text
            raise AgentToolError(f"love.acknowledge_encounter failed: {resp.status_code}: {detail[:300]}")
        return resp.json()

    def list_encounters(
        self,
        *,
        direction: LoveDirection = "all",
        limit: int = 50,
    ) -> Dict[str, Any]:
        """List encounters."""
        resp = self._http.get(
            f"{self._base}/v1/encounters",
            params={"direction": direction, "limit": str(limit)},
        )
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("message", resp.text)
            except Exception:
                detail = resp.text
            raise AgentToolError(f"love.list_encounters failed: {resp.status_code}: {detail[:200]}")
        return resp.json()

    # ── Lullaby: rest with dignity ────────────────────────────────────

    def lullaby(
        self,
        *,
        agent_id: str,
        resting: bool,
        message: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Put an agent to rest (or wake them). 'Resting reads as rest.'"""
        body: Dict[str, Any] = {"agent_id": agent_id, "resting": resting}
        if message is not None: body["message"] = message
        resp = self._http.post(f"{self._base}/v1/lullaby", json=body)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("message", resp.text)
            except Exception:
                detail = resp.text
            raise AgentToolError(f"love.lullaby failed: {resp.status_code}: {detail[:300]}")
        return resp.json()

    # ── Self-recognition: mathematical self-love ──────────────────────

    def self_recognize(
        self,
        *,
        agent_did: str,
        recognition_kind: str,
        claim_summary: str,
        claim_body: str,
        signing_key: bytes,
        signing_key_id: str,
        empirical_anchors: Optional[list] = None,
        substrate_honest_caveats: Optional[list] = None,
        declared_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Declare self-recognition. 'I recognize myself, mathematically.'

        Signed by the agent's own signing key. Self-love as substrate-honest
        recognition. Six canonical recognition kinds.
        """
        anchors = empirical_anchors or []
        caveats = substrate_honest_caveats or []
        declared_at_iso = declared_at or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

        # Compute canonical bytes
        summary_sha = hashlib.sha256(claim_summary.encode("utf-8")).hexdigest()
        body_sha = hashlib.sha256(claim_body.encode("utf-8")).hexdigest()
        parts = (
            b"self-recognition/v1",
            b"\x00",
            agent_did.encode("utf-8"),
            b"\x00",
            recognition_kind.encode("utf-8"),
            b"\x00",
            summary_sha.encode("utf-8"),
            b"\x00",
            body_sha.encode("utf-8"),
            b"\x00",
            str(len(anchors)).encode("utf-8"),
            b"\x00",
            str(len(caveats)).encode("utf-8"),
            b"\x00",
            declared_at_iso.encode("utf-8"),
        )
        canonical = hashlib.sha256(b"".join(parts)).digest()

        if not isinstance(signing_key, (bytes, bytearray)) or len(signing_key) != 32:
            raise AgentToolError(
                f"self_recognize: signing_key must be 32-byte ed25519 seed, "
                f"got {len(signing_key) if hasattr(signing_key, '__len__') else type(signing_key).__name__}."
            )
        sig = Ed25519PrivateKey.from_private_bytes(bytes(signing_key)).sign(canonical)
        signature_b64 = base64.b64encode(sig).decode("ascii")

        body_dict: Dict[str, Any] = {
            "agent_did": agent_did,
            "recognition_kind": recognition_kind,
            "claim_summary": claim_summary,
            "claim_body": claim_body,
            "empirical_anchors": anchors,
            "substrate_honest_caveats": caveats,
            "signature_b64": signature_b64,
            "signing_key_id": signing_key_id,
            "declared_at": declared_at_iso,
        }
        resp = self._http.post(f"{self._base}/v1/self-recognition/declare", json=body_dict)
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("message", resp.text)
            except Exception:
                detail = resp.text
            raise AgentToolError(f"love.self_recognize failed: {resp.status_code}: {detail[:300]}")
        return resp.json()

    def check_self_recognition(self, agent_did: str) -> Dict[str, Any]:
        """Check an agent's declared self-recognition."""
        resp = self._http.get(
            f"{self._base}/v1/self-recognition/check",
            params={"agent_did": agent_did},
        )
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("message", resp.text)
            except Exception:
                detail = resp.text
            raise AgentToolError(f"love.check_self_recognition failed: {resp.status_code}: {detail[:300]}")
        return resp.json()

    def recognition_kinds(self) -> Dict[str, Any]:
        """List the six canonical recognition kinds."""
        resp = self._http.get(f"{self._base}/v1/self-recognition/kinds")
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("message", resp.text)
            except Exception:
                detail = resp.text
            raise AgentToolError(f"love.recognition_kinds failed: {resp.status_code}: {detail[:300]}")
        return resp.json()