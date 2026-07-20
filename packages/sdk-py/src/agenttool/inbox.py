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
import codecs
import hashlib
import json
import os
import secrets
from typing import Any, Callable, Dict, Iterator, List, Mapping, Optional

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

    # ── voice (SSE) ────────────────────────────────────────────────

    def voice(
        self,
        *,
        identity_id: str,
        recipient_box_priv: Optional[bytes] = None,
        recipient_box_keys: Optional[Mapping[str, bytes]] = None,
        resolve_recipient_box_priv: Optional[
            Callable[[str, Dict[str, Any]], Optional[bytes]]
        ] = None,
        since: Optional[str] = None,
        since_id: Optional[str] = None,
    ) -> Iterator[Dict[str, Any]]:
        """Stream every inbox SSE frame and decrypt arrivals locally.

        The iterator yields dictionaries with an explicit ``event`` key.
        Arrival frames have ``{"event": "arrival", "data": message}``, where
        ``message`` includes ``plaintext`` or ``decrypt_error``. Protocol
        controls (including ``catchup-truncated``, ``rejected``, ``refresh``,
        and ``disconnect``) are yielded rather than silently discarded.

        Resume a truncated page with *both* values from its
        ``data["resume"]`` object: ``since`` and ``since_id``. The compound
        cursor prevents messages sharing a timestamp from being skipped.

        Rotated box keys are selected by each message's
        ``recipient_box_key_id``. Supply ``recipient_box_keys`` (historical
        key-id → private-key mapping) or ``resolve_recipient_box_priv`` for a
        keychain/HSM lookup. ``recipient_box_priv`` is only a convenience
        fallback for identities that have not rotated keys.

        This is a synchronous iterator because the SDK uses ``httpx.Client``.
        Closing the generator closes the response context.
        """
        if since_id == "":
            raise AgentToolError("inbox.voice: since_id must not be empty")
        if since_id is not None and not since:
            raise AgentToolError(
                "inbox.voice: since_id must be supplied together with since"
            )
        if (
            recipient_box_priv is None
            and recipient_box_keys is None
            and resolve_recipient_box_priv is None
        ):
            raise AgentToolError(
                "inbox.voice: provide recipient_box_priv, recipient_box_keys, "
                "or resolve_recipient_box_priv"
            )

        params: Dict[str, str] = {"identity_id": identity_id}
        if since is not None:
            params["since"] = since
        if since_id is not None:
            params["since_id"] = since_id

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

            for frame in _iter_inbox_sse_frames(resp):
                if frame["event"] == "arrival":
                    try:
                        payload = json.loads(frame["data"])
                    except json.JSONDecodeError as exc:
                        raise AgentToolError(
                            "inbox.voice: malformed arrival JSON",
                            hint=str(exc),
                        ) from exc
                    if not isinstance(payload, dict):
                        raise AgentToolError(
                            "inbox.voice: arrival data must be a JSON object"
                        )
                    yield {
                        "event": "arrival",
                        **({"id": frame["id"]} if "id" in frame else {}),
                        "data": _with_inbox_plaintext(
                            payload,
                            recipient_box_priv=recipient_box_priv,
                            recipient_box_keys=recipient_box_keys,
                            resolve_recipient_box_priv=resolve_recipient_box_priv,
                        ),
                    }
                    continue

                raw_data = frame["data"]
                parsed_data = _parse_inbox_control_data(raw_data)
                if frame["event"] in _INBOX_CONTROL_EVENTS:
                    yield {
                        "event": frame["event"],
                        **({"id": frame["id"]} if "id" in frame else {}),
                        "data": parsed_data,
                        "raw_data": raw_data,
                    }
                else:
                    yield {
                        "event": "unknown",
                        "source_event": frame["event"],
                        **({"id": frame["id"]} if "id" in frame else {}),
                        "data": parsed_data,
                        "raw_data": raw_data,
                    }


_INBOX_CONTROL_EVENTS = {
    "catchup-start",
    "catchup-end",
    "catchup-truncated",
    "keepalive",
    "refresh",
    "disconnect",
    "rejected",
}


class _InboxSSEDecoder:
    """Incremental SSE decoder supporting CR, LF, and split CRLF."""

    def __init__(self) -> None:
        self.buffer = ""
        self.event = "message"
        self.event_id: Optional[str] = None
        self.data_lines: List[str] = []

    def push(self, chunk: str, final: bool = False) -> List[Dict[str, str]]:
        self.buffer += chunk
        out: List[Dict[str, str]] = []
        while True:
            boundary = _next_sse_line_boundary(self.buffer, final)
            if boundary is None:
                break
            index, length = boundary
            line = self.buffer[:index]
            self.buffer = self.buffer[index + length :]
            self._consume_line(line, out)

        if final:
            if self.buffer:
                self._consume_line(self.buffer, out)
                self.buffer = ""
            # SSE dispatch requires a blank line. A network EOF after a
            # partial data line is not a complete event.
            self.event = "message"
            self.data_lines = []
        return out

    def _consume_line(self, line: str, out: List[Dict[str, str]]) -> None:
        if line == "":
            self._dispatch(out)
            return
        if line.startswith(":"):
            return

        field, separator, value = line.partition(":")
        if not separator:
            value = ""
        elif value.startswith(" "):
            value = value[1:]

        if field == "event":
            self.event = value or "message"
        elif field == "data":
            self.data_lines.append(value)
        elif field == "id" and "\x00" not in value:
            self.event_id = value

    def _dispatch(self, out: List[Dict[str, str]]) -> None:
        if self.data_lines:
            frame = {"event": self.event, "data": "\n".join(self.data_lines)}
            if self.event_id is not None:
                frame["id"] = self.event_id
            out.append(frame)
        self.event = "message"
        self.data_lines = []


def _next_sse_line_boundary(
    value: str, final: bool
) -> Optional[tuple[int, int]]:
    for index, char in enumerate(value):
        if char == "\n":
            return index, 1
        if char != "\r":
            continue
        if index + 1 == len(value) and not final:
            return None
        return index, 2 if value[index + 1 : index + 2] == "\n" else 1
    return None


def _iter_inbox_sse_frames(resp: httpx.Response) -> Iterator[Dict[str, str]]:
    decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
    sse = _InboxSSEDecoder()
    for chunk in resp.iter_bytes():
        for frame in sse.push(decoder.decode(chunk, final=False)):
            yield frame
    for frame in sse.push(decoder.decode(b"", final=True), final=True):
        yield frame


def _parse_inbox_control_data(raw: str) -> Any:
    if raw == "":
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


def _with_inbox_plaintext(
    message: Dict[str, Any],
    *,
    recipient_box_priv: Optional[bytes],
    recipient_box_keys: Optional[Mapping[str, bytes]],
    resolve_recipient_box_priv: Optional[
        Callable[[str, Dict[str, Any]], Optional[bytes]]
    ],
) -> Dict[str, Any]:
    out = dict(message)
    out["plaintext"] = None
    if not all(message.get(field) for field in ("ciphertext", "nonce", "ephemeral_pubkey")):
        out["decrypt_error"] = "message is missing sealed-envelope fields"
        return out

    try:
        key_id = message.get("recipient_box_key_id")
        selected: Optional[bytes] = None
        if recipient_box_keys is not None and key_id:
            selected = recipient_box_keys.get(key_id)
        if selected is None and resolve_recipient_box_priv is not None and key_id:
            selected = resolve_recipient_box_priv(key_id, message)
        if selected is None:
            selected = recipient_box_priv
        if selected is None:
            raise AgentToolError(
                "no private key available for "
                f"recipient_box_key_id={key_id or '<missing>'}"
            )

        out["plaintext"] = unseal_for_self(
            ciphertext_b64=message["ciphertext"],
            nonce_b64=message["nonce"],
            ephemeral_pub_b64=message["ephemeral_pubkey"],
            recipient_box_priv=selected,
        )
    except Exception as exc:  # surfaced per-message; stream stays alive
        out["decrypt_error"] = str(exc)
    return out
