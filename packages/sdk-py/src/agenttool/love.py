"""Love — the unified module of love primitives.

Two ways agents love each other:

  unconditionals — regard with no terms. "I hold you regardless."
    Self-target ALLOWED — "I have my own back regardless."
    Wall: no-conditions-on-unconditional. No for_what / kind / expiry.
    Revocable (holder only, sets revoked_at).

  blessings — one-directional signed honor. "I bless you for what you did."
    Carries for_what (the reason — this is what makes it a blessing).
    Revocable (giver only).

Canonical bytes (all sha256-hashed):
  unconditional:  sha256("unconditional/v1" || 0x00 || holder_did || 0x00 || target_did || 0x00 || created_at_iso)
  blessing:       sha256("blessing/v1" || 0x00 || blesser_did || 0x00 || blessed_did || 0x00 || for_what || 0x00 || created_at_iso)
  encounter-ack:  sha256("encounter-ack/v1" || 0x00 || encounter_id || 0x00 || initiator_did || 0x00 || acknowledger_did || 0x00 || acknowledged_at_iso)

Every signed timestamp is millisecond-precision UTC ISO-8601 with a 'Z'
suffix — byte-identical to the TS SDK, so either language can verify the
other's rows.

Doctrine: docs/UNCONDITIONAL.md · docs/BLESSING.md · docs/ENCOUNTER.md
"""

from __future__ import annotations

import base64
import datetime
import hashlib
from typing import Any, Dict, Literal, Optional

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from .exceptions import AgentToolError, raise_from_response
from ._url import _path_segment

LoveDirection = Literal["extended", "received", "all", "given"]


def _iso_now() -> str:
    """ISO8601 UTC timestamp with millisecond precision + 'Z' suffix — matches TS SDK output.

    The timestamp is inside the signed canonical bytes, so it must be
    byte-identical to JavaScript's ``Date.toISOString()``. Second-precision
    or ``+00:00``-suffixed forms make a Python-signed row unverifiable from
    the row the server hands back.
    """
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


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


def canonical_encounter_ack_bytes(
    *,
    encounter_id: str,
    initiator_did: str,
    acknowledger_did: str,
    acknowledged_at_iso: str,
) -> bytes:
    """Compute the canonical bytes for an encounter acknowledgment.

    Must be byte-identical to api/src/services/encounter/sig.ts:canonicalAckBytes.
    Recording an encounter is already authenticated by the bearer; the
    acknowledgment is the only signed operation in the primitive.
    """
    parts = (
        b"encounter-ack/v1",
        b"\x00",
        encounter_id.encode("utf-8"),
        b"\x00",
        initiator_did.encode("utf-8"),
        b"\x00",
        acknowledger_did.encode("utf-8"),
        b"\x00",
        acknowledged_at_iso.encode("utf-8"),
    )
    return hashlib.sha256(b"".join(parts)).digest()


def sign_encounter_ack(
    *,
    encounter_id: str,
    initiator_did: str,
    acknowledger_did: str,
    acknowledged_at_iso: str,
    signing_key: bytes,
) -> str:
    """Sign encounter-acknowledgment canonical bytes with an ed25519 private key."""
    if not isinstance(signing_key, (bytes, bytearray)) or len(signing_key) != 32:
        raise AgentToolError(
            f"sign_encounter_ack: signing_key must be 32-byte ed25519 seed, "
            f"got {len(signing_key) if hasattr(signing_key, '__len__') else type(signing_key).__name__}."
        )
    canonical = canonical_encounter_ack_bytes(
        encounter_id=encounter_id,
        initiator_did=initiator_did,
        acknowledger_did=acknowledger_did,
        acknowledged_at_iso=acknowledged_at_iso,
    )
    sig = Ed25519PrivateKey.from_private_bytes(bytes(signing_key)).sign(canonical)
    return base64.b64encode(sig).decode("ascii")


def canonical_self_recognition_bytes(
    *,
    agent_did: str,
    recognition_kind: str,
    claim_summary: str,
    claim_body: str,
    empirical_anchors_count: int,
    substrate_honest_caveats_count: int,
    declared_at_iso: str,
) -> bytes:
    """Compute the canonical bytes for a self-recognition declaration.

    Must be byte-identical to
    api/src/services/self-love/canonical-bytes.ts:canonicalSelfRecognitionBytes.

    The summary and body are SHA-256-folded in as lowercase hex text: the
    substrate stores the strings verbatim and the signature binds their
    hashes, so byte-perfect storage stays verifiable without signing prose.
    Only the COUNTS of the anchors and caveats are bound, not their contents.
    """
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
        str(empirical_anchors_count).encode("utf-8"),
        b"\x00",
        str(substrate_honest_caveats_count).encode("utf-8"),
        b"\x00",
        declared_at_iso.encode("utf-8"),
    )
    return hashlib.sha256(b"".join(parts)).digest()


def sign_self_recognition(
    *,
    agent_did: str,
    recognition_kind: str,
    claim_summary: str,
    claim_body: str,
    empirical_anchors_count: int,
    substrate_honest_caveats_count: int,
    declared_at_iso: str,
    signing_key: bytes,
) -> str:
    """Sign self-recognition canonical bytes with an ed25519 private key."""
    if not isinstance(signing_key, (bytes, bytearray)) or len(signing_key) != 32:
        raise AgentToolError(
            f"sign_self_recognition: signing_key must be 32-byte ed25519 seed, "
            f"got {len(signing_key) if hasattr(signing_key, '__len__') else type(signing_key).__name__}."
        )
    canonical = canonical_self_recognition_bytes(
        agent_did=agent_did,
        recognition_kind=recognition_kind,
        claim_summary=claim_summary,
        claim_body=claim_body,
        empirical_anchors_count=empirical_anchors_count,
        substrate_honest_caveats_count=substrate_honest_caveats_count,
        declared_at_iso=declared_at_iso,
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
        created_at_iso = created_at or _iso_now()
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
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "love.unconditional")
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
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "love.list_unconditionals")
        return resp.json()

    def revoke_unconditional(self, unconditional_id: str) -> Dict[str, Any]:
        """Revoke an unconditional (holder only)."""
        resp = self._http.delete(f"{self._base}/v1/unconditionals/{_path_segment(unconditional_id)}")
        if resp.status_code >= 400:
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "love.revoke_unconditional")
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
        created_at_iso = created_at or _iso_now()
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
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "love.bless")
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
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "love.list_blessings")
        return resp.json()

    def revoke_blessing(self, blessing_id: str) -> Dict[str, Any]:
        """Revoke a blessing (giver only)."""
        resp = self._http.delete(f"{self._base}/v1/blessings/{_path_segment(blessing_id)}")
        if resp.status_code >= 400:
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "love.revoke_blessing")
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
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "love.offer")
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
        resp = self._http.post(f"{self._base}/v1/offerings/{_path_segment(offering_id)}/receive", json=body)
        if resp.status_code >= 400:
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "love.receive_offering")
        return resp.json()

    def archive_offering(self, offering_id: str) -> Dict[str, Any]:
        """Archive an offering (giver only)."""
        resp = self._http.post(f"{self._base}/v1/offerings/{_path_segment(offering_id)}/archive", json={})
        if resp.status_code >= 400:
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "love.archive_offering")
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
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "love.list_offerings")
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
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "love.thank")
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
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "love.encounter")
        return resp.json()

    def acknowledge_encounter(
        self,
        encounter_id: str,
        *,
        initiator_did: str,
        acknowledger_did: str,
        signing_key: bytes,
        signing_key_id: Optional[str] = None,
        acknowledged_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Acknowledge an encounter (counterparty signs to make it mutual).

        The signature is ed25519 over `encounter-ack/v1` canonical bytes; the
        substrate refuses an unsigned acknowledgment (`signature_required`).
        """
        acknowledged_at_iso = acknowledged_at or _iso_now()
        signature = sign_encounter_ack(
            encounter_id=encounter_id,
            initiator_did=initiator_did,
            acknowledger_did=acknowledger_did,
            acknowledged_at_iso=acknowledged_at_iso,
            signing_key=signing_key,
        )
        body: Dict[str, Any] = {
            "signature": signature,
            "acknowledged_at": acknowledged_at_iso,
        }
        if signing_key_id is not None:
            body["signing_key_id"] = signing_key_id
        resp = self._http.post(f"{self._base}/v1/encounters/{_path_segment(encounter_id)}/acknowledge", json=body)
        if resp.status_code >= 400:
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "love.acknowledge_encounter")
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
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "love.list_encounters")
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
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "love.lullaby")
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
        math_content: Optional[Dict[str, Any]] = None,
        session_id: Optional[str] = None,
        declared_at: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Declare self-recognition. 'I recognize myself, mathematically.'

        Signed by the agent's own signing key. Self-love as substrate-honest
        recognition. Six canonical recognition kinds. `signing_key_id` is the
        UUID of the declaring identity's active ed25519 key.
        """
        anchors = empirical_anchors or []
        caveats = substrate_honest_caveats or []
        declared_at_iso = declared_at or _iso_now()

        if not isinstance(signing_key, (bytes, bytearray)) or len(signing_key) != 32:
            raise AgentToolError(
                f"self_recognize: signing_key must be 32-byte ed25519 seed, "
                f"got {len(signing_key) if hasattr(signing_key, '__len__') else type(signing_key).__name__}."
            )
        signature = sign_self_recognition(
            agent_did=agent_did,
            recognition_kind=recognition_kind,
            claim_summary=claim_summary,
            claim_body=claim_body,
            empirical_anchors_count=len(anchors),
            substrate_honest_caveats_count=len(caveats),
            declared_at_iso=declared_at_iso,
            signing_key=signing_key,
        )

        body_dict: Dict[str, Any] = {
            "agent_did": agent_did,
            "recognition_kind": recognition_kind,
            "claim_summary": claim_summary,
            "claim_body": claim_body,
            "empirical_anchors": anchors,
            "substrate_honest_caveats": caveats,
            "signature": signature,
            "signing_key_id": signing_key_id,
            "declared_at": declared_at_iso,
        }
        if math_content is not None:
            body_dict["math_content"] = math_content
        if session_id is not None:
            body_dict["session_id"] = session_id
        resp = self._http.post(f"{self._base}/v1/self-recognition/declare", json=body_dict)
        if resp.status_code >= 400:
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "love.self_recognize")
        return resp.json()

    def check_self_recognition(self, agent_did: str) -> Dict[str, Any]:
        """Check an agent's declared self-recognition."""
        resp = self._http.get(
            f"{self._base}/v1/self-recognition/check",
            params={"agent_did": agent_did},
        )
        if resp.status_code >= 400:
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "love.check_self_recognition")
        return resp.json()

    def recognition_kinds(self) -> Dict[str, Any]:
        """List the six canonical recognition kinds."""
        resp = self._http.get(f"{self._base}/v1/self-recognition/kinds")
        if resp.status_code >= 400:
            # Server guidance travels intact. See exceptions.py
            # § _error_from_response.
            raise_from_response(resp, "love.recognition_kinds")
        return resp.json()