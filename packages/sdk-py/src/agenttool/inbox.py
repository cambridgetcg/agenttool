"""Inbox — agent-to-agent encrypted messaging.

Sealed-box flow (X25519 ECDH + HKDF-SHA256 + AES-256-GCM + ed25519 envelope sig).
Wire format byte-identical to ``api/src/services/inbox/sig.ts`` and
``cli/think/src/box.ts`` — interops with any orchestrator that follows
``docs/INBOX.md``.

::

    Sender:
      ephemeralKey = X25519 random
      sharedSecret = ECDH(ephemeralKey.priv, recipient.box_pub)
      aesKey       = HKDF-SHA256(sharedSecret, salt=b'', info="agenttool-inbox-v1", 32)
      nonce        = random 12 bytes
      ciphertext   = AES-256-GCM(aesKey, nonce, plaintext) || authTag
      canonical    = sha256(
                       b"inbox-message/v1" || 0x00 ||
                       recipient_did       || 0x00 ||
                       ciphertext_bytes    || 0x00 ||
                       nonce_bytes         || 0x00 ||
                       ephemeral_pub_bytes
                     )
      signature    = ed25519_sign(sender_signing_priv, canonical)

    Recipient:
      sharedSecret = ECDH(my_box_priv, msg.ephemeral_pubkey)
      aesKey       = HKDF-SHA256(...)
      plaintext    = AES-256-GCM-open(aesKey, msg.nonce, msg.ciphertext)

Doctrine: ``docs/INBOX.md``.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
from typing import Any, Dict, Iterator, List, Optional

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.asymmetric.x25519 import (
    X25519PrivateKey,
    X25519PublicKey,
)
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes, serialization

from .exceptions import AgentToolError

HKDF_INFO = b"agenttool-inbox-v1"
SEP = b"\x00"


# ── Base64 helpers ─────────────────────────────────────────────────────


def _b64e(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _b64d(s: str) -> bytes:
    return base64.b64decode(s)


# ── X25519 keypair ─────────────────────────────────────────────────────


def generate_box_keypair() -> Dict[str, bytes]:
    """Generate a fresh X25519 keypair as raw 32-byte halves."""
    sk = X25519PrivateKey.generate()
    return {
        "priv": sk.private_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PrivateFormat.Raw,
            encryption_algorithm=serialization.NoEncryption(),
        ),
        "pub": sk.public_key().public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        ),
    }


def derive_box_pub(priv: bytes) -> bytes:
    """Derive the X25519 public key from a 32-byte private key."""
    if len(priv) != 32:
        raise AgentToolError(
            f"derive_box_pub: priv must be 32 bytes, got {len(priv)}"
        )
    return (
        X25519PrivateKey.from_private_bytes(priv)
        .public_key()
        .public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )
    )


# ── Sealed-box encrypt / decrypt ───────────────────────────────────────


def seal_for_recipient(plaintext: str, recipient_box_pub: bytes) -> Dict[str, str]:
    """Seal ``plaintext`` for a recipient's X25519 public key.

    Generates a fresh ephemeral X25519 keypair per call (forward
    secrecy). Returns base64-encoded ``ciphertext_b64`` (AES-GCM
    output with the 16-byte tag appended), ``nonce_b64`` (12 random
    bytes), and ``ephemeral_pub_b64`` (recipient needs this to
    re-derive the shared secret).
    """
    if len(recipient_box_pub) != 32:
        raise AgentToolError(
            f"seal_for_recipient: recipient box pub must be 32 bytes, got {len(recipient_box_pub)}"
        )

    eph_sk = X25519PrivateKey.generate()
    eph_pub = eph_sk.public_key().public_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PublicFormat.Raw,
    )
    shared_secret = eph_sk.exchange(X25519PublicKey.from_public_bytes(recipient_box_pub))

    aes_key = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"",
        info=HKDF_INFO,
    ).derive(shared_secret)

    nonce = os.urandom(12)
    aesgcm = AESGCM(aes_key)
    ct = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)

    return {
        "ciphertext_b64": _b64e(ct),
        "nonce_b64": _b64e(nonce),
        "ephemeral_pub_b64": _b64e(eph_pub),
    }


def unseal_for_self(
    *,
    ciphertext_b64: str,
    nonce_b64: str,
    ephemeral_pub_b64: str,
    recipient_box_priv: bytes,
) -> str:
    """Decrypt a sealed envelope using the recipient's X25519 private key."""
    if len(recipient_box_priv) != 32:
        raise AgentToolError(
            f"unseal_for_self: recipient box priv must be 32 bytes, got {len(recipient_box_priv)}"
        )
    eph_pub = _b64d(ephemeral_pub_b64)
    if len(eph_pub) != 32:
        raise AgentToolError(
            f"unseal_for_self: ephemeral pub must be 32 bytes, got {len(eph_pub)}"
        )

    sk = X25519PrivateKey.from_private_bytes(recipient_box_priv)
    shared_secret = sk.exchange(X25519PublicKey.from_public_bytes(eph_pub))
    aes_key = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"",
        info=HKDF_INFO,
    ).derive(shared_secret)

    aesgcm = AESGCM(aes_key)
    try:
        pt = aesgcm.decrypt(_b64d(nonce_b64), _b64d(ciphertext_b64), None)
    except Exception as e:
        raise AgentToolError(
            f"unseal_for_self: AES-GCM open failed (wrong key or corrupted ciphertext): {e}"
        ) from e
    return pt.decode("utf-8")


# ── Canonical bytes + signing ──────────────────────────────────────────


def canonical_inbox_bytes(
    *,
    recipient_did: str,
    ciphertext_b64: str,
    nonce_b64: str,
    ephemeral_pub_b64: str,
) -> bytes:
    """SHA-256 digest the server verifies the envelope signature against.

    Mirrors ``api/src/services/inbox/sig.ts`` ``canonicalInboxBytes``
    byte-for-byte.
    """
    parts = [
        b"inbox-message/v1",
        SEP,
        recipient_did.encode("utf-8"),
        SEP,
        _b64d(ciphertext_b64),
        SEP,
        _b64d(nonce_b64),
        SEP,
        _b64d(ephemeral_pub_b64),
    ]
    return hashlib.sha256(b"".join(parts)).digest()


def sign_inbox_envelope(
    *,
    recipient_did: str,
    ciphertext_b64: str,
    nonce_b64: str,
    ephemeral_pub_b64: str,
    signing_key: bytes,
) -> str:
    """Sign canonical envelope bytes with the sender's ed25519 private key."""
    if len(signing_key) != 32:
        raise AgentToolError(
            f"sign_inbox_envelope: signing_key must be 32 bytes, got {len(signing_key)}"
        )
    canonical = canonical_inbox_bytes(
        recipient_did=recipient_did,
        ciphertext_b64=ciphertext_b64,
        nonce_b64=nonce_b64,
        ephemeral_pub_b64=ephemeral_pub_b64,
    )
    sig = Ed25519PrivateKey.from_private_bytes(signing_key).sign(canonical)
    return _b64e(sig)


def canonical_inbox_cosign_bytes(
    *,
    message_id: str,
    recipient_did: str,
    ciphertext_b64: str,
    nonce_b64: str,
) -> bytes:
    """SHA-256 digest the server verifies the cosign signature against."""
    parts = [
        b"inbox-cosign/v1",
        SEP,
        message_id.encode("utf-8"),
        SEP,
        recipient_did.encode("utf-8"),
        SEP,
        _b64d(ciphertext_b64),
        SEP,
        _b64d(nonce_b64),
    ]
    return hashlib.sha256(b"".join(parts)).digest()


def sign_inbox_cosign(
    *,
    message_id: str,
    recipient_did: str,
    ciphertext_b64: str,
    nonce_b64: str,
    signing_key: bytes,
) -> str:
    """Sign canonical cosign bytes (recipient consents to dual-witness release)."""
    if len(signing_key) != 32:
        raise AgentToolError(
            f"sign_inbox_cosign: signing_key must be 32 bytes, got {len(signing_key)}"
        )
    canonical = canonical_inbox_cosign_bytes(
        message_id=message_id,
        recipient_did=recipient_did,
        ciphertext_b64=ciphertext_b64,
        nonce_b64=nonce_b64,
    )
    sig = Ed25519PrivateKey.from_private_bytes(signing_key).sign(canonical)
    return _b64e(sig)


# ── InboxClient ────────────────────────────────────────────────────────


class InboxClient:
    """Client for ``/v1/inbox``.

    Three layers of helpers:

    1. **High-level**: :meth:`send`, :meth:`decrypt` — encrypts, signs,
       optionally looks up the recipient pubkey, posts. Most callers
       use these.
    2. **Crypto-only** (module-level): :func:`seal_for_recipient`,
       :func:`unseal_for_self`, :func:`sign_inbox_envelope`,
       :func:`sign_inbox_cosign` — for callers wiring custom flows.
    3. **Raw HTTP**: :meth:`send_cipher`, :meth:`list`, :meth:`get`,
       :meth:`thread`, :meth:`cosign`, :meth:`patch`, :meth:`delete`.
    """

    def __init__(self, http: httpx.Client, base_url: str) -> None:
        self._http = http
        self._base = base_url.rstrip("/")

    def _url(self, path: str) -> str:
        return f"{self._base}{path}"

    def _check(self, resp: httpx.Response, label: str) -> None:
        if resp.status_code >= 400:
            try:
                payload = resp.json()
                detail = (
                    payload.get("message")
                    or payload.get("error")
                    or payload.get("detail")
                    or resp.reason_phrase
                )
            except ValueError:
                detail = resp.reason_phrase
            raise AgentToolError(
                f"{label} ({resp.status_code}): {detail}",
                hint=f"{resp.request.method} {resp.request.url.path}",
            )

    # ── lookup ──────────────────────────────────────────────────────

    def lookup(self, did: str) -> Dict[str, Any]:
        """Look up the recipient's active X25519 box key by DID."""
        from urllib.parse import quote

        resp = self._http.get(self._url(f"/v1/inbox/box-keys/{quote(did, safe=':')}"))
        self._check(resp, "inbox.lookup")
        return resp.json()

    # ── high-level send ─────────────────────────────────────────────

    def send(
        self,
        *,
        to_did: str,
        sender_did: str,
        plaintext: str,
        signing_key: bytes,
        signing_key_id: str,
        recipient_box_pub: Optional[bytes] = None,
        recipient_box_key_id: Optional[str] = None,
        subject: Optional[str] = None,
        subject_encrypted: bool = False,
        in_reply_to: Optional[str] = None,
        refs: Optional[List[Dict[str, str]]] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Encrypt + sign + POST in one call.

        Looks up the recipient's box key if ``recipient_box_pub`` /
        ``recipient_box_key_id`` are not supplied (one extra GET).
        """
        if recipient_box_pub is None or recipient_box_key_id is None:
            looked = self.lookup(to_did)
            recipient_box_pub = _b64d(looked["public_key"])
            recipient_box_key_id = looked["box_key_id"]

        sealed = seal_for_recipient(plaintext, recipient_box_pub)
        signature = sign_inbox_envelope(
            recipient_did=to_did,
            ciphertext_b64=sealed["ciphertext_b64"],
            nonce_b64=sealed["nonce_b64"],
            ephemeral_pub_b64=sealed["ephemeral_pub_b64"],
            signing_key=signing_key,
        )

        body: Dict[str, Any] = {
            "to_did": to_did,
            "sender_did": sender_did,
            "ciphertext": sealed["ciphertext_b64"],
            "nonce": sealed["nonce_b64"],
            "ephemeral_pubkey": sealed["ephemeral_pub_b64"],
            "recipient_box_key_id": recipient_box_key_id,
            "signature": signature,
            "signing_key_id": signing_key_id,
        }
        if subject is not None:
            body["subject"] = subject
        if subject_encrypted:
            body["subject_encrypted"] = True
        if in_reply_to:
            body["in_reply_to"] = in_reply_to
        if refs:
            body["refs"] = refs
        if metadata:
            body["metadata"] = metadata

        return self.send_cipher(body)

    def send_cipher(self, body: Dict[str, Any]) -> Dict[str, Any]:
        """Raw POST for callers who already have ciphertext + signature."""
        resp = self._http.post(self._url("/v1/inbox"), json=body)
        self._check(resp, "inbox.send")
        return resp.json()

    # ── reads ───────────────────────────────────────────────────────

    def list(
        self,
        *,
        status: Optional[str] = None,
        identity_id: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> Dict[str, Any]:
        """List inbox messages. Server filters to this project (recipient side)."""
        params: Dict[str, Any] = {}
        if status:
            params["status"] = status
        if identity_id:
            params["identity_id"] = identity_id
        if limit is not None:
            params["limit"] = limit
        resp = self._http.get(self._url("/v1/inbox"), params=params)
        self._check(resp, "inbox.list")
        return resp.json()

    def get(self, id: str) -> Dict[str, Any]:
        from urllib.parse import quote

        resp = self._http.get(self._url(f"/v1/inbox/{quote(id)}"))
        self._check(resp, "inbox.get")
        return resp.json()

    def thread(self, id: str) -> Dict[str, Any]:
        """Walk a thread by ``in_reply_to`` lineage, scoped to this project."""
        from urllib.parse import quote

        resp = self._http.get(self._url(f"/v1/inbox/{quote(id)}/thread"))
        self._check(resp, "inbox.thread")
        return resp.json()

    # ── mutations ───────────────────────────────────────────────────

    def cosign(
        self,
        message_id: str,
        *,
        recipient_did: str,
        ciphertext_b64: str,
        nonce_b64: str,
        signing_key: bytes,
        signing_key_id: str,
    ) -> Dict[str, Any]:
        """Release a ``pending_dual_witness`` message by adding the
        recipient's signature over canonical cosign bytes.
        """
        signature = sign_inbox_cosign(
            message_id=message_id,
            recipient_did=recipient_did,
            ciphertext_b64=ciphertext_b64,
            nonce_b64=nonce_b64,
            signing_key=signing_key,
        )
        from urllib.parse import quote

        resp = self._http.post(
            self._url(f"/v1/inbox/{quote(message_id)}/co-sign"),
            json={"signing_key_id": signing_key_id, "signature": signature},
        )
        self._check(resp, "inbox.cosign")
        return resp.json()

    def patch(self, id: str, status: str) -> Dict[str, Any]:
        """Update message status — one of unread/read/archived/spam/deleted."""
        from urllib.parse import quote

        resp = self._http.patch(
            self._url(f"/v1/inbox/{quote(id)}"),
            json={"status": status},
        )
        self._check(resp, "inbox.patch")
        return resp.json()

    def delete(self, id: str) -> Dict[str, Any]:
        """Soft delete (status='deleted')."""
        from urllib.parse import quote

        resp = self._http.delete(self._url(f"/v1/inbox/{quote(id)}"))
        self._check(resp, "inbox.delete")
        return resp.json()

    # ── decrypt (local) ─────────────────────────────────────────────

    def decrypt(
        self,
        message: Dict[str, Any],
        *,
        recipient_box_priv: bytes,
    ) -> str:
        """Unseal a message for the recipient's local box-key pair."""
        return unseal_for_self(
            ciphertext_b64=message["ciphertext"],
            nonce_b64=message["nonce"],
            ephemeral_pub_b64=message["ephemeral_pubkey"],
            recipient_box_priv=recipient_box_priv,
        )

    # ── voice (SSE) ──────────────────────────────────────────────────

    def voice(
        self,
        *,
        identity_id: str,
        recipient_box_priv: bytes,
        since: Optional[str] = None,
    ) -> Iterator[Dict[str, Any]]:
        """Stream inbox arrivals via SSE, decrypted client-side.

        Connects to ``GET /v1/inbox/voice?identity_id=…``, replays
        messages newer than ``since``, then yields live arrivals. Each
        yielded dict carries the server fields PLUS a ``plaintext`` body
        unsealed with ``recipient_box_priv``. Messages that fail to unseal
        (or carry no ciphertext) pass through with ``plaintext=None`` and a
        ``decrypt_error`` — one bad frame never aborts the stream.

        Non-``arrival`` frames (catchup-start, keepalive, refresh, …) are
        consumed silently. Iteration stops when the stream closes (server
        lifetime cap, client break). For long-lived consumers, wrap in a
        reconnect loop using the newest ``created_at`` seen as ``since``.

        Note: this is a SYNC iterator (the SDK is built on
        ``httpx.Client``). For async, wrap externally.

        Args:
            identity_id: Identity whose inbox to stream (required; must
                belong to the bearer's project).
            recipient_box_priv: Recipient's 32-byte X25519 box private key
                used to unseal each arrival. Stays in-process; never sent.
            since: Replay messages with ``created_at`` after this ISO-8601
                timestamp. Omit for live-only.
        """
        params: Dict[str, Any] = {"identity_id": identity_id}
        if since is not None:
            params["since"] = since

        with self._http.stream(
            "GET",
            self._url("/v1/inbox/voice"),
            params=params,
            timeout=None,
        ) as resp:
            if resp.status_code != 200:
                raise AgentToolError(
                    f"inbox.voice failed: {resp.status_code}",
                    hint=resp.read().decode("utf-8", errors="replace")[:200],
                )

            event: Optional[str] = None
            data_lines: List[str] = []
            for raw_line in resp.iter_lines():
                line = raw_line.rstrip("\r")
                if line == "":
                    if event == "arrival" and data_lines:
                        try:
                            payload = json.loads("\n".join(data_lines))
                        except json.JSONDecodeError:
                            event = None
                            data_lines = []
                            continue
                        yield _with_inbox_plaintext(payload, recipient_box_priv)
                    event = None
                    data_lines = []
                    continue
                if line.startswith(":"):
                    continue
                if line.startswith("event:"):
                    event = line[len("event:"):].strip()
                elif line.startswith("data:"):
                    data_lines.append(line[len("data:"):].lstrip())
                # id: and retry: are intentionally ignored


def _with_inbox_plaintext(
    message: Dict[str, Any],
    recipient_box_priv: bytes,
) -> Dict[str, Any]:
    """Return a copy of ``message`` with ``plaintext`` decrypted.

    Sets ``plaintext=None`` for messages lacking ciphertext / nonce /
    ephemeral pubkey. On unseal failure, attaches ``decrypt_error``
    instead of raising. Mirrors the strands ``_with_plaintext`` helper.
    """
    out = dict(message)
    ct = message.get("ciphertext")
    nonce = message.get("nonce")
    eph = message.get("ephemeral_pubkey")
    if ct and nonce and eph:
        try:
            out["plaintext"] = unseal_for_self(
                ciphertext_b64=ct,
                nonce_b64=nonce,
                ephemeral_pub_b64=eph,
                recipient_box_priv=recipient_box_priv,
            )
        except Exception as e:  # noqa: BLE001 — surfaced as decrypt_error
            out["plaintext"] = None
            out["decrypt_error"] = str(e)
    else:
        out["plaintext"] = None
    return out
